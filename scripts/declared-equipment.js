/**
 * The shared part that lets declaration equipment (applyMode='onUse') be declared right inside the roll, damage
 * and defense dialogs.
 *
 * Why it is needed: equipment such as "declare it immediately before making the accuracy roll of a ranged attack
 * with this weapon" (the rocket launcher) fires on the declaration rather than on the attack, so it used to require
 * clicking the name on the sheet and pressing "use" first. That is completely outside the flow of attacking with a
 * combo, so in practice it became a feature nobody used. The combo path only increments the registered weapon's
 * attack-used and never calls handleItemUse (combo-handler.js), so putting a weapon in a combo can never apply it.
 *
 * Two design points:
 *  1) **It is a toggle, and the actual use happens when the roll is committed.** Running handleItemUse the moment
 *     it is pressed would burn the use count and the encroachment merely by closing the window — paying for a roll
 *     that never happened. So the toggle only records "I intend to use this for this roll", and only when the roll
 *     button calls commit() does handleItemUse(action:'use') run, settling the uses and encroachment and attaching
 *     the AE. The calculation still goes through the one real pipeline, so there is no place for double counting —
 *     the caller re-reads the roll values after commit() rather than having the dialog add the numbers itself.
 *  2) **They are shown split by context.** An accuracy modifier and penetration are needed at different moments, so
 *     only entries that mean something in this window are listed. With none, the section is not drawn at all.
 */
(function() {
  const SCOPE = 'dx3rd-emanim';
  const EQUIPMENT_TYPES = ['weapon', 'protect', 'vehicle'];

  const localize = key => game.i18n?.localize?.(key) ?? key;

  // Modifier key → display label. A key absent here is shown verbatim (so as not to hide an authoring error).
  const KEY_LABELS = {
    dice: 'DX3rd.Dice', add: 'DX3rd.Add', critical: 'DX3rd.Critical', critical_min: 'DX3rd.CriticalMin',
    stat_dice: 'DX3rd.StatDice', stat_add: 'DX3rd.StatAdd', effect_level: 'DX3rd.EffectLevelBonus',
    major_dice: 'DX3rd.MajorDice', major_add: 'DX3rd.MajorAdd', major_critical: 'DX3rd.Critical',
    reaction_dice: 'DX3rd.ReactionDice', reaction_add: 'DX3rd.ReactionAdd',
    dodge_dice: 'DX3rd.DodgeDice', dodge_add: 'DX3rd.DodgeAdd',
    attack: 'DX3rd.Attack', penetrate: 'DX3rd.Penetrate',
    guard: 'DX3rd.Guard', armor: 'DX3rd.Armor', reduce: 'DX3rd.Reduce',
    battleMove: 'DX3rd.BattleMove', init: 'DX3rd.Init'
  };

  const ROLL_KEYS = ['dice', 'add', 'critical', 'critical_min', 'stat_dice', 'stat_add',
    'major_dice', 'major_add', 'major_critical',
    'reaction_dice', 'reaction_add', 'reaction_critical',
    'dodge_dice', 'dodge_add', 'dodge_critical'];
  const DAMAGE_KEYS = ['attack', 'penetrate'];

  /**
   * The modifier keys that are "meaningful in this window" per context.
   * Listing every piece of equipment would only pile up buttons that cannot be chosen right now.
   * Dodge / reaction dice are rolled in the roll window that follows, not in the defense dialog, so they belong to roll.
   *
   * Attack power, the damage roll and armor-ignoring are offered in the **accuracy roll window** ('attack') rather
   * than in the damage window. The rule says "declare it immediately before making the accuracy roll of a ranged
   * attack with this weapon" (the rocket launcher), and letting the choice come after seeing the hit would create a
   * place to save uses when the attack missed — most of this family is use-limited, so that difference is a straight gain.
   * Declaring ahead of the roll also folds the modifier naturally into the actorAttack/actorPenetrate computation,
   * so there is nothing to patch up in the damage window's displayed numbers either.
   */
  const CONTEXT_KEYS = {
    roll: new Set(ROLL_KEYS),
    attack: new Set([...ROLL_KEYS, ...DAMAGE_KEYS]),
    defense: new Set(['guard', 'armor', 'reduce'])
  };

  /**
   * The target-channel modifier keys that mean something in this window — only the ones that cut **the defending
   * roll against that attack**.
   *
   * The self-channel list must not be reused here. A helping modifier such as "declare it immediately before another
   * character makes a roll, giving that roll dice +3" (Command Mobile) would then show up in the accuracy window, and
   * applying it to my target inverts its meaning. Only what the opponent of the declarer's roll receives is kept.
   */
  const TARGET_CONTEXT_KEYS = {
    attack: new Set(['reaction_dice', 'reaction_add', 'reaction_critical',
      'dodge_dice', 'dodge_add', 'dodge_critical',
      'guard', 'armor', 'reduce'])
  };

  const attributeEntries = attributes => Object.values(attributes || {})
    .filter(entry => entry?.key && entry.key !== '-');

  /**
   * Only the self modifiers that fire on a declaration (action:'use'). "While equipped …" (the activation bucket) is
   * excluded, because being equipped is the source of that state and there is no notion of declaring it. One piece of
   * equipment can hold both buckets at once (a per-row firing action), so both the test and the summary must use this list.
   */
  function declaredAttributes(item) {
    const adapter = window.DX3rdItemEffectAdapter;
    if (adapter) {
      const lifecycle = adapter.bucketLifecycle(item, 'self', 'use');
      // afterSuccess equipment (a shotgun and the like, which modifies only the current damage after a hit) is not
      // something declared before the roll. Exposing it here too would mean it is not applied at declaration time
      // because of the runTiming gate, and the same equipment is asked about again after the hit — a duplicated UI.
      if (lifecycle.runTiming !== '-' && lifecycle.runTiming !== 'instant') return {};
      return adapter.selfFrozenAttributes(item, 'use');
    }
    return (item?.system?.active?.applyMode === 'onUse') ? (item?.system?.attributes || {}) : {};
  }

  /**
   * The modifiers a declaration applies **to the target** (the target channel's 'use' bucket).
   *
   * Some declaration equipment cuts the opponent rather than buffing the self — the Fallen Pistol's "the reaction
   * against that attack gets critical +1", the Ballistic Knife's "the dodge against that attack gets dice -4".
   * This family has an empty self channel, so it never appeared in the declaration list at all, and therefore it
   * applied **automatically on every attack** through the target channel's default action fallback (an attack item →
   * 'attack'). Even a use-limited one (the Fallen Pistol: three per scenario) paid nothing for it.
   *
   * The application path already exists — commit() → handleItemUse(action:'use') → universal-handler's
   * applyToTargets(actor, item, 'instant', null, 'use') picks this bucket up through targetBucketAttributes and
   * applies it to game.user.targets. What was missing was only the test for "does it qualify for the declaration
   * list", so it is merged with the self modifiers here.
   */
  function declaredTargetAttributes(item) {
    const adapter = window.DX3rdItemEffectAdapter;
    if (!adapter) return {};
    // Pick up both the ones whose channel default is 'use' and the ones whose rows explicitly author 'use' —
    // looking only at the channel default would miss per-row authoring such as the Full Auto Shotgun.
    const attributes = adapter.targetBucketAttributes(item, 'use', 'instant');
    if (!attributeEntries(attributes).length) return {};
    const lifecycle = adapter.bucketLifecycle(item, 'target', 'use');
    if (lifecycle.disable === 'notCheck') return {};
    if (lifecycle.runTiming !== '-' && lifecycle.runTiming !== 'instant') return {};
    return attributes;
  }

  /** Every modifier a declaration would apply. The channel is carried along in order to split the summary wording. */
  function declaredEntries(item) {
    const self = attributeEntries(declaredAttributes(item)).map(entry => ({entry, channel: 'self'}));
    const target = attributeEntries(declaredTargetAttributes(item)).map(entry => ({entry, channel: 'target'}));
    return [...self, ...target];
  }

  /** Is a single item declaration equipment (equipped, with a modifier in the declaration bucket)? */
  function isDeclarable(item) {
    if (!item || !EQUIPMENT_TYPES.includes(item.type)) return false;
    if (item.system?.equipment !== true) return false;
    const entries = declaredEntries(item);
    if (!entries.length) return false;
    // active.disable='notCheck' marks an intent not to use the **self channel**. A declaration that applies target
    // modifiers is unrelated to that field (its lifetime lives on system.effect), so it is not grounds for exclusion.
    if ((item.system?.active?.disable ?? '-') === 'notCheck') {
      return entries.some(({channel}) => channel === 'target');
    }
    return true;
  }

  /**
   * Are there uses left?
   * The criterion has to match what handleItemUse actually counts — that path increments used.state only when
   * used.disable is not 'notCheck'. And, as in helpers' isItemExhausted, **a max of 0 means exhausted, not unlimited**
   * (the use check was turned on without an upper bound being entered).
   * Whether an exhausted item is dropped from the list is decided by the world setting (allowExhaustedUse) — when it
   * is not dropped the remaining-uses display stays, so pressing it is a decision made while seeing "0 left".
   */
  function usesLeft(item) {
    const used = item.system?.used || {};
    if ((used.disable || 'notCheck') === 'notCheck') return { limited: false, left: Infinity, state: 0, max: 0 };
    const max = Number(used.max) || 0;
    const state = Number(used.state) || 0;
    return { limited: true, left: Math.max(0, max - state), state, max };
  }

  /**
   * Has it already been declared this time, with a self-modifier AE attached?
   *
   * Equipment with no self modifiers (target channel only) has no such lock — the AE it applies lands on the opponent,
   * so `applied_self_*` never comes into existence and cannot serve as the test. And for that family, re-declaring on
   * every roll is what the rules say ("declare it immediately before making the accuracy roll"), and the uses are
   * settled each time, so locking the button inside the window is enough to prevent duplicates.
   */
  function alreadyDeclared(actor, item) {
    if (!attributeEntries(declaredAttributes(item)).length) return false;
    const key = `applied_self_${item.id}`;
    return (actor?.effects || []).some(effect => effect.getFlag?.(SCOPE, 'appliedKey') === key);
  }

  /** Is this an entry to show in this context? Different keys mean something in different channels. */
  function entryInContext({entry, channel}, context) {
    if (!context) return true;
    const keys = channel === 'target' ? TARGET_CONTEXT_KEYS[context] : CONTEXT_KEYS[context];
    return !!keys?.has(entry.key);
  }

  function summarize(item, context) {
    const targetPrefix = localize('DX3rd.Target');
    return declaredEntries(item)
      .filter(candidate => entryInContext(candidate, context))
      .map(({entry, channel}) => {
        const name = KEY_LABELS[entry.key] ? localize(KEY_LABELS[entry.key]) : entry.key;
        // What is applied to the target means the opposite even for the same key, so without a prefix it reads as a self buff.
        const label = channel === 'target' ? `${targetPrefix} ${name}` : name;
        const value = String(entry.value ?? '').trim();
        return value ? `${label} ${value}` : label;
      })
      .join(', ');
  }

  /**
   * The equipment that can be declared right now.
   * @param {Actor} actor
   * @param {'roll'|'damage'|'defense'} context
   */
  function collect(actor, context) {
    if (!actor || !CONTEXT_KEYS[context]) return [];
    // The declaration button is not offered on someone else's actor — handleItemUse updates the item, so without
    // ownership pressing it just fails (the defense dialog can appear on the GM's screen too).
    if (actor.isOwner === false) return [];
    const allowExhausted = window.DX3rdItemExhausted?.allowExhaustedUse?.() !== false;
    return (actor.items || [])
      .filter(item => isDeclarable(item)
        && declaredEntries(item).some(candidate => entryInContext(candidate, context))
        && !alreadyDeclared(actor, item)
        && (allowExhausted || usesLeft(item).left > 0))
      .map(item => {
        const uses = usesLeft(item);
        return {
          id: item.id, name: item.name, img: item.img,
          summary: summarize(item, context),
          limited: uses.limited, left: uses.left, max: uses.max,
          exhausted: uses.limited && uses.left <= 0
        };
      });
  }

  const escapeHtml = text => String(text ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  /**
   * The section HTML. An empty string when there are no candidates, so the caller does not repeat the conditional.
   * The same markup serves the roll window assembled from template strings and the Handlebars-rendered window.
   */
  function sectionHtml(entries) {
    if (!entries.length) return '';
    const rows = entries.map(entry => {
      // An exhausted entry stays in the list too (when the setting allows). "Exhausted" is attached so that the fact
      // that it may be pressed but is not normally usable is visible right on the button.
      const count = entry.exhausted
        ? `<span class="dx3rd-declare-uses is-exhausted">${localize('DX3rd.Exhausted')}</span>`
        : (entry.limited
          ? `<span class="dx3rd-declare-uses">${game.i18n.format('DX3rd.DeclareUsesLeft', {count: entry.left})}</span>`
          : '');
      return `<button type="button" class="dx3rd-declare-button${entry.exhausted ? ' is-exhausted' : ''}" aria-pressed="false" data-item-id="${escapeHtml(entry.id)}">
        <span class="dx3rd-declare-name">${escapeHtml(entry.name)}</span>
        <span class="dx3rd-declare-summary">${escapeHtml(entry.summary)}</span>
        ${count}
      </button>`;
    }).join('');
    return `<div class="dx3rd-declare-section">
      <div class="dx3rd-declare-title">${localize('DX3rd.DeclarableEquipment')}</div>
      <div class="dx3rd-declare-list">${rows}</div>
    </div>`;
  }

  /**
   * The toggle wiring. A click only selects / deselects; the actual use happens in commit().
   * @param {HTMLElement} root  the DOM containing the section
   * @param {Actor} actor
   * @param {Function} [onToggle]  called whenever the selection changes (receives the array of selected items).
   * @returns {{selected: Function, commit: Function, hasPending: Function}}
   *   commit() uses the selected entries in turn and returns the array of items that were used successfully.
   *   Closing the window without rolling never calls commit(), so nothing is consumed.
   */
  function bind(root, actor, onToggle) {
    const chosen = new Map();
    const noop = { selected: () => [], commit: async () => [], hasPending: () => false };
    if (!root || !actor) return noop;

    const buttons = Array.from(root.querySelectorAll('.dx3rd-declare-button'));
    if (!buttons.length) return noop;

    for (const button of buttons) {
      button.addEventListener('click', event => {
        event.preventDefault();
        event.stopPropagation();
        // A button whose commit has finished is locked — so it is not consumed twice in the same roll.
        if (button.disabled) return;
        const item = actor.items.get(button.dataset.itemId);
        if (!item) return;
        const on = !chosen.has(item.id);
        if (on) chosen.set(item.id, item);
        else chosen.delete(item.id);
        button.classList.toggle('selected', on);
        button.setAttribute('aria-pressed', String(on));
        onToggle?.(Array.from(chosen.values()));
      });
    }

    /**
     * Actually use the selected equipment. Called exactly once, when the roll is committed.
     * One entry failing does not stop the rest — an entry that has already paid cannot be undone, so stopping
     * midway would silently leave a "partly applied" state. Failures are reported individually.
     */
    async function commit() {
      const applied = [];
      for (const [id, item] of chosen) {
        const button = buttons.find(b => b.dataset.itemId === id);
        if (button) button.disabled = true;
        try {
          // Something that applies self modifiers only needs no target (requiring one would block here). Something
          // that applies target modifiers must, conversely, **require** one — letting it through with no target
          // drains the uses and encroachment while applying to nothing (the Fallen Pistol has only three per scenario).
          const needsTarget = declaredEntries(item).some(({channel}) => channel === 'target');
          // comboMode='normal': skip the weapon's attack / combo selection menu.
          const used = await window.DX3rdUniversalHandler?.handleItemUse(
            actor.id, item.id, item.type, undefined, needsTarget, {action: 'use', comboMode: 'normal'});
          if (used === false) {
            if (button) { button.disabled = false; button.classList.remove('selected'); button.setAttribute('aria-pressed', 'false'); }
            continue;
          }
          applied.push(item);
          if (button) {
            button.classList.add('declared');
            button.querySelector('.dx3rd-declare-uses')?.remove();
            const summary = button.querySelector('.dx3rd-declare-summary');
            if (summary) summary.textContent = localize('DX3rd.Declared');
          }
        } catch (error) {
          console.error('DX3rd | 장비 선언 실패:', item?.name, error);
          ui.notifications.error(`${item?.name}: ${localize('DX3rd.Unable')}`);
          if (button) { button.disabled = false; button.classList.remove('selected'); button.setAttribute('aria-pressed', 'false'); }
        }
      }
      chosen.clear();
      return applied;
    }

    return {
      selected: () => Array.from(chosen.values()),
      hasPending: () => chosen.size > 0,
      commit
    };
  }

  window.DX3rdDeclaredEquipment = {
    CONTEXT_KEYS, TARGET_CONTEXT_KEYS, isDeclarable, collect, sectionHtml, bind
  };
})();
