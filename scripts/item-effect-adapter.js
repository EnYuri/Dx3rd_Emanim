// The item effect normalization adapter
// ---------------------------------------------------------------------------
// Projects the mechanization fields scattered across effect/weapon/protect/etc/once onto a shared
// effect card without changing the stored format. Loaded right after helpers so sheets and executors
// share one action decision; the actual execution stays delegated to the existing UniversalHandler functions.
(function () {
  const SCOPE = 'dx3rd-emanim';
  const ACTIONS = new Set(['activation', 'use', 'attack']);
  // The slots the extend dialog actually offers an editing UI for. The encroach executor still exists but
  // has no extension data or edit form of its own, so no empty virtual card is created for it.
  const DIRECT_TYPES = ['heal', 'damage', 'statusClear', 'weapon', 'protect', 'vehicle'];
  const EXECUTION_TYPES = [...DIRECT_TYPES, 'encroach'];
  const ATTACK_TYPES = new Set(['weapon', 'vehicle']);
  const PARTIALS = [
    'systems/dx3rd-emanim/templates/item/parts/immediate-effects-v2.html',
    'systems/dx3rd-emanim/templates/item/parts/persistent-effects-v2.html'
  ];

  const localize = key => game.i18n.localize(key);
  const hasEntries = value => value && typeof value === 'object' && Object.keys(value).length > 0;
  // Is there at least one modifier that actually applies? Shell entries whose key is missing or '-' are
  // common in the stored format, so the action decision must use this rather than hasEntries (key present) to match what the sheet shows.
  const hasUsableEntries = value => Object.values(value || {}).some(entry =>
    entry?.key && entry.key !== '-' && String(entry.value ?? '').trim() !== '');
  const normalizeAction = value => ACTIONS.has(value) ? value : null;

  function isAttackItem(item) {
    if (!item) return false;
    if (ATTACK_TYPES.has(item.type)) return true;
    return item.system?.attackRoll && item.system.attackRoll !== '-';
  }

  function hasConfiguredFormula(value) {
    const text = String(value ?? '').trim();
    return text !== '' && text !== '-' && text !== '0';
  }

  /**
   * Project a direct attack's / combo member effect's modifier and attack value into the existing weaponBonus carrier format.
   * Fixed formulas are turned into numbers at once; dice formulas are preserved until accuracy / damage is settled.
   */
  function effectAttackBonus(item, actor, {includeComboModifiers = false} = {}) {
    if (item?.type !== 'effect' || (!isAttackItem(item) && !includeComboModifiers)) return null;
    const rawAdd = item.system?.add ?? '0';
    const rawAttack = item.system?.attack ?? '0';
    if (!hasConfiguredFormula(rawAdd) && !hasConfiguredFormula(rawAttack)) return null;

    const formula = window.DX3rdFormulaEvaluator;
    if (!formula) return null;
    const bonus = {
      attack: 0,
      add: 0,
      attackFormula: '',
      addFormula: '',
      weaponName: String(item.name || '').split('||')[0].trim(),
      weaponIds: [],
      sourceLabel: localize('DX3rd.AttackSource')
    };
    const addTerm = (target, raw) => {
      const prepared = formula.prepareRollFormula(String(raw ?? '0'), item, actor);
      if (formula.hasDice(prepared)) bonus[target] = prepared;
      else bonus[target === 'attackFormula' ? 'attack' : 'add'] = Number(formula.evaluate(raw, item, actor)) || 0;
    };
    addTerm('attackFormula', rawAttack);
    addTerm('addFormula', rawAdd);
    return bonus;
  }

  /** Merge the existing weapon bonus and the direct attack effect bonus into one carrier without evaluating anything twice. */
  function mergeAttackBonuses(...entries) {
    const bonuses = entries.flat().filter(Boolean);
    if (!bonuses.length) return null;
    const names = [];
    const weaponIds = [];
    const merged = {
      attack: 0,
      add: 0,
      attackFormula: '',
      addFormula: '',
      weaponName: '',
      weaponIds,
      sourceLabel: bonuses.find(bonus => bonus.sourceLabel)?.sourceLabel || ''
    };
    for (const bonus of bonuses) {
      merged.attack += Number(bonus.attack) || 0;
      merged.add += Number(bonus.add) || 0;
      if (bonus.attackFormula) merged.attackFormula = [merged.attackFormula, bonus.attackFormula].filter(Boolean).join(' + ');
      if (bonus.addFormula) merged.addFormula = [merged.addFormula, bonus.addFormula].filter(Boolean).join(' + ');
      if (bonus.weaponName && !names.includes(bonus.weaponName)) names.push(bonus.weaponName);
      for (const id of (bonus.weaponIds || [])) if (id && !weaponIds.includes(id)) weaponIds.push(id);
    }
    merged.weaponName = names.join(', ');
    return merged;
  }

  function invocationAction(item, options = {}) {
    const explicit = normalizeAction(options.action || options.dx3rdAction);
    if (explicit) return explicit;
    return isAttackItem(item) ? 'attack' : 'use';
  }

  function eventAction(item, timing = 'instant', options = {}) {
    const explicit = normalizeAction(options.action || options.dx3rdAction);
    if (explicit) return explicit;
    if (timing === 'afterDamage' || timing === 'afterHit') return 'attack';
    return invocationAction(item, options);
  }

  /**
   * Are the self modifiers **explicitly authored** with the 'activation' action (regardless of whether it is always-on)?
   * Choosing "activation" on the effect card makes updateAction write both of these fields together.
   */
  function declaresActivationSelfModifiers(item) {
    return normalizeAction(item?.system?.active?.action) === 'activation'
      || (item?.system?.active?.applyMode || 'onUse') === 'toggle';
  }

  /**
   * Is the self-modifier channel 'activation' — that is, does firing / clearing happen through the active.state toggle?
   * The sheet's active checkbox, the direct-use gate and combo member handling ALL look only at this one function.
   * Rewriting the rule at a call site makes them drift subtly apart, producing an effect that neither toggles
   * nor applies on use (that bug actually happened).
   *
   * Even when the channel default is frozen, a single modifier row **explicitly authored** as "activation" means
   * the item needs a state to turn on and off (the per-row trigger action — see modifierBuckets).
   */
  function usesActivationSelfChannel(item) {
    if (!item) return false;
    if (inferAction(item, 'selfModifiers', item.system?.active || {}) === 'activation') return true;
    return hasExplicitBucket(item, 'self', 'activation');
  }

  /**
   * When the item is used / attacks directly, should the self modifiers be toggled on rather than frozen?
   * Equipment (weapon/protect/vehicle) is excluded because the equipped checkbox (system.equipment) is the source of the active state —
   * turning it on by use alone would revive the modifiers of unequipped gear.
   */
  function useMeansActivation(item) {
    if (!item || EQUIPMENT_TYPES.includes(item.type)) return false;
    return usesActivationSelfChannel(item);
  }

  /**
   * Should the self modifiers be applied right now (the shared gate at every instant trigger point)?
   * The standalone-use and combo-member paths each copy-pasted `!active.state`, but that condition is only
   * correct for **the activation channel**. There active.state IS the applied state, so nothing is left to do
   * once it is on. The frozen channel's state (applyMode='onUse') lives on the AE side and has nothing to do
   * with active.state — it must be re-applied with the values of the moment on every use.
   * Gating both on the same condition means a frozen-channel item whose state happens to be on (declaration
   * equipment turned on by an old equip hook, or the sheet checkbox) would do nothing forever, however often it is used.
   */
  function selfModifiersPending(item) {
    if (!item) return false;
    if ((item.system?.active?.disable ?? '-') === 'notCheck'
      && !modifierExecutionBuckets(item, 'self', null, null, {frozen: true}).length
      && bucketLifecycle(item, 'self', 'activation').disable === 'notCheck') return false;
    if (usesActivationSelfChannel(item)) {
      if (item.system?.active?.state !== true) return true;
      // Even with the activation bucket already on, a frozen bucket authored as "on use / on attack" on the
      // same item still has to be re-applied on every use.
      return hasFrozenSelfBucket(item);
    }
    return true;
  }

  // ---------------------------------------------------------------------------
  // Per-row trigger action (the persistent-effect modifier buckets)
  //
  // Self modifiers (system.attributes) and target modifiers (system.effect.attributes) were one channel each,
  // with one trigger action per channel. So persistent modifiers with different trigger points could not be
  // authored separately within one item — "+1 while equipped, +2 more when declared" — however many modifiers
  // you added, they were bound to a single action.
  //
  // An optional `action` field per modifier row splits a channel into buckets. Unspecified (all legacy data)
  // inherits the channel default, so existing items behave exactly as before. The gate widens **only when
  // there is explicit authoring**.
  // ---------------------------------------------------------------------------

  function attributeEntries(map) {
    return Object.entries(map || {}).filter(([, entry]) => entry && typeof entry === 'object');
  }

  function attributeMap(item, channel) {
    return channel === 'self' ? item?.system?.attributes : item?.system?.effect?.attributes;
  }

  const EQUIPMENT_TYPES = ['weapon', 'protect', 'vehicle'];

  /**
   * Does an invocation with `action` fire a bucket authored for `bucket`?
   *
   * For anything but equipment, attacking IS using. An attack effect has no separate "use" invocation:
   * invocationAction returns 'attack' whenever attackRoll is authored, and the use/attack chooser in
   * handleItemUse is weapon/vehicle only. So a card authored as "on use" on an attack effect never fired
   * at all — the modifier was silently unreachable (yuricross's '포텐스': 백병 공격력 +[level]d10 on the
   * 사용 card of an attackRoll='melee' effect, which never reached the damage roll).
   *
   * Equipment is the exception **on purpose**, and the two halves must stay together: there the chooser
   * exists, so "use" is separately reachable, and attackDefersUsage keeps an attack from spending what
   * only the use card would. Widening this to equipment would undo that.
   *
   * Structural questions ("is a bucket authored for X" — hasExplicitBucket, hasActionEffects,
   * comboMemberAction, selfToggleBucketMatches) stay exact. Only invocation-time matching goes through here.
   */
  function actionCoversBucket(item, action, bucket) {
    if (!bucket || action === bucket) return true;
    if (action !== 'attack' || bucket !== 'use') return false;
    return !!item && !EQUIPMENT_TYPES.includes(item.type);
  }

  /** The trigger action **explicitly authored** on a row (null when absent). */
  function explicitAction(item, channel, entry) {
    return normalizeAction(entry?.action);
  }

  /** The channel's default trigger action — what a row with no explicit value inherits (the channel decision as it always was). */
  function channelAction(item, channel) {
    return channel === 'self'
      ? inferAction(item, 'selfModifiers', item?.system?.active || {})
      : inferAction(item, 'targetModifiers', item?.system?.effect || {});
  }

  /** A row's effective trigger action (for display and bucket classification). */
  function attributeAction(item, channel, entry) {
    return explicitAction(item, channel, entry) || channelAction(item, channel);
  }

  /**
   * One bucket's trigger and expiry timing.
   *
   * The trigger action (activation / use / attack) and the trigger timing (instant / after success / after damage)
   * are **different axes**. Splitting only the action into buckets while leaving the timing in a single channel
   * field lets the target channel's `runTiming` pin the trigger point to one moment, so one of the use / attack
   * buckets can never fire and dies silently (the afterDamage path requires runTiming==='afterDamage', the
   * instant path requires runTiming==='instant'). So every bucket carries its own timing.
   *
   * The default bucket (the channel's default action) uses the channel's flat fields as-is; only an explicit
   * bucket keeps its own values in `system.<active|effect>.buckets.<action>` (anything absent is inherited from the channel).
   * That rule is what leaves existing data untouched. Buckets are declared in the document schema
   * (`scripts/data/document-schema.js`) as an optional ObjectField per channel, so they do not exist before
   * they are authored, and what is authored is preserved.
   *
   * Every gate decision **must go through this function** — a call site reading system.effect.runTiming
   * directly ignores the per-bucket timing and brings the dead-bucket bug above right back.
   */
  function bucketLifecycle(item, channel, action = null) {
    const chan = channel === 'self' ? 'self' : 'target';
    const root = (chan === 'self' ? item?.system?.active : item?.system?.effect) || {};
    const fallbackDisable = chan === 'self' ? '-' : 'notCheck';
    const expected = normalizeAction(action) || channelAction(item, chan);
    const isDefault = expected === channelAction(item, chan);
    const override = isDefault ? null : ((root.buckets || {})[expected] || null);
    const pick = (key, fallback) => {
      const value = override?.[key];
      return (value === undefined || value === null || value === '') ? fallback : value;
    };
    return {
      channel: chan, action: expected, isDefault,
      overridden: !!override,
      disable: pick('disable', root.disable ?? fallbackDisable),
      // An activation bucket has exactly one trigger point — the moment the state turns on. It has no check timing.
      runTiming: expected === 'activation' ? 'instant' : pick('runTiming', root.runTiming || 'instant'),
      // Reapplication stacks a new applied AE instead of overwriting the previous one
      // ("this effect stacks each time the attack hits" — 중력의 수갑). Default: overwrite, as always.
      stack: !!pick('stack', root.stack),
      path: isDefault
        ? (chan === 'self' ? 'system.active' : 'system.effect')
        : `${chan === 'self' ? 'system.active' : 'system.effect'}.buckets.${expected}`
    };
  }

  /** Do that trigger action's target modifiers fire at this timing (by the bucket's own runTiming)? */
  function targetFiresAt(item, action = null, timing = 'instant') {
    const expected = normalizeAction(action) || eventAction(item, timing);
    if (attributeEntries(attributeMap(item, 'target')).length) {
      return modifierExecutionBuckets(item, 'target', expected, timing).length > 0;
    }
    const lifecycle = bucketLifecycle(item, 'target', expected);
    if (lifecycle.disable === 'notCheck') return false;
    return lifecycle.runTiming === '-' || lifecycle.runTiming === timing;
  }

  /** Every self modifier belonging to that trigger action. Toggle vs frozen is decided separately, at apply time. */
  function selfBucketAttributes(item, action = null) {
    const expected = normalizeAction(action) || channelAction(item, 'self');
    const out = {};
    for (const [key, entry] of attributeEntries(attributeMap(item, 'self'))) {
      if (actionCoversBucket(item, expected, attributeAction(item, 'self', entry))) out[key] = entry;
    }
    return out;
  }

  /** Does that self-modifier bucket fire at this timing (by the bucket's own lifetime)? */
  function selfFiresAt(item, action = null, timing = 'instant') {
    const expected = normalizeAction(action) || eventAction(item, timing);
    return modifierExecutionBuckets(item, 'self', expected, timing).length > 0;
  }

  /** Expand an invocation into exact buckets before checking timing or creating AEs.
   * An attack may cover use too, but those cards must never share a lifetime or AE key.
   * The frozen selector retains the legacy unsplit-channel compatibility rule.
   */
  function modifierExecutionBuckets(item, channel, action = null, timing = null, {frozen = false} = {}) {
    const expected = normalizeAction(action) || eventAction(item, timing || 'instant');
    const selected = channel === 'self' && frozen
      ? selfFrozenAttributes(item, action)
      : Object.fromEntries(attributeEntries(attributeMap(item, channel)).filter(([, entry]) =>
        actionCoversBucket(item, expected, attributeAction(item, channel, entry))));
    const groups = new Map();
    for (const [key, entry] of attributeEntries(selected)) {
      const bucketAction = attributeAction(item, channel, entry);
      if (!groups.has(bucketAction)) groups.set(bucketAction, {});
      groups.get(bucketAction)[key] = entry;
    }
    return [...groups].map(([bucketAction, attributes]) => ({
      action: bucketAction, attributes, lifecycle: bucketLifecycle(item, channel, bucketAction)
    })).filter(bucket => hasUsableEntries(bucket.attributes)
      && bucket.lifecycle.disable !== 'notCheck'
      && (timing === null || bucket.lifecycle.runTiming === '-' || bucket.lifecycle.runTiming === timing));
  }

  function hasExplicitBucket(item, channel, action) {
    const expected = normalizeAction(action);
    if (!expected) return false;
    return attributeEntries(attributeMap(item, channel))
      .some(([, entry]) => explicitAction(item, channel, entry) === expected);
  }

  /**
   * Is the self-modifier channel a toggle (activation) — that is, do **unspecified** rows belong to the activation bucket?
   * This MUST use the same test as applySelfModifiers' channel branch. Drifting apart leaves unspecified rows in
   * neither the toggle AE nor the frozen AE (the modifier vanishes) or in both (counted twice).
   */
  function selfChannelIsToggle(item) {
    if (!item) return false;
    if (channelAction(item, 'self') === 'activation') return true;
    const active = item.system?.active || {};
    return (active.applyMode || 'onUse') === 'toggle';
  }

  /**
   * Is this a self-modifier row counted while active.state is on?
   * The shared rule for actor.prepareData's self-computation (activeItems) and the toggle AE (DX3rdAppliedToggle).
   */
  function appliesWhileActive(item, entry) {
    const explicit = explicitAction(item, 'self', entry);
    if (explicit) return explicit === 'activation';
    // Unspecified rows are all counted, as they always were. Inheriting the channel default would wipe out every
    // modifier on types like rois / connection, whose channel action resolves to 'use' while the state IS the applied state.
    // The exception is a frozen channel with "activation" rows mixed in — there the unspecified rows are held by the
    // frozen AE, so counting them here too would attach the same modifier twice.
    return selfChannelIsToggle(item) || !hasExplicitBucket(item, 'self', 'activation');
  }

  /**
   * Should firing with this trigger action turn active.state (the toggle) on?
   *
   * A channel's toggle state is **one** boolean per item. So turning it on when firing with an action that only
   * has frozen buckets — "on attack", say — makes **that item's activation bucket go off from the attack alone**;
   * for equipment, where equipping is the source of the state, even the display goes wrong (dx3rd-applied-toggle's
   * sync undoes it). A call with no action keeps its existing meaning (leave it to the channel decision).
   */
  function selfToggleBucketMatches(item, action = null) {
    const expected = normalizeAction(action);
    if (!expected) return true;
    if (expected === 'activation') return true;
    // When unspecified rows go into the toggle AE for this channel, firing with the action those rows belong to
    // (the channel's default bucket) is a toggle. e.g. applyMode='toggle' with a channel default of 'use'.
    return selfChannelIsToggle(item) && channelAction(item, 'self') === expected;
  }

  /**
   * Is there at least one self modifier **with an actual value** to freeze on use / attack?
   * Counting the empty rows the sheet stores (key '-' / blank value) makes the frozen path run with nothing to apply,
   * deleting the self AE that was already attached (_applyItemAttributes' "remove when there is nothing to apply" branch).
   */
  function hasFrozenSelfBucket(item, action = null) {
    return hasUsableEntries(selfFrozenAttributes(item, action));
  }

  /**
   * Pick out only the self modifiers to freeze on use / attack (for applySelfFrozenBuff).
   * @param {Item} item
   * @param {string|null} action - 'use' | 'attack' (null means everything that is not activation)
   */
  function selfFrozenAttributes(item, action = null) {
    const expected = normalizeAction(action);
    const toggleChannel = selfChannelIsToggle(item);
    // An unspecified row belongs to the channel's default bucket. But existing frozen-channel data has to apply
    // whichever action fires it — the same item arrives both through the roll dialog's declaration (use) and
    // through attacking with that weapon (attack). So ignoring the action is the default, and it narrows to the
    // default bucket **only when the author actually split this channel**. Without that narrowing, an item authored
    // as "A on declaration / B on attack" would apply A+B together on an attack.
    const split = ['use', 'attack'].some(candidate => hasExplicitBucket(item, 'self', candidate));
    const fallback = channelAction(item, 'self');
    const out = {};
    for (const [key, entry] of attributeEntries(attributeMap(item, 'self'))) {
      const explicit = explicitAction(item, 'self', entry);
      if (explicit) {
        if (explicit === 'activation') continue;
        if (expected && !actionCoversBucket(item, expected, explicit)) continue;
      } else if (toggleChannel) {
        continue;   // unspecified rows are held by the toggle AE
      } else if (split && expected && !actionCoversBucket(item, expected, fallback)) {
        continue;   // in a split channel, unspecified rows belong to the default bucket only
      }
      out[key] = entry;
    }
    return out;
  }

  /** Pick out only the modifiers to apply to targets for the current trigger action (for applyToTargets). */
  function targetBucketAttributes(item, action = null, timing = 'instant') {
    return Object.assign({}, ...modifierExecutionBuckets(item, 'target', action, timing)
      .map(bucket => bucket.attributes));
  }

  /**
   * The persistent-modifier buckets drawn on the sheet, grouped by channel (self/target) × effective trigger action.
   * Only the default bucket (= the channel default action that unspecified rows belong to) keeps the legacy card id —
   * the extend dialog's channel setting and the actor sheet find the self / target channel by that id.
   */
  /** Card = bucket = edit pane. Only the default bucket keeps the legacy id (referenced by the actor sheet and the extend dialog). */
  function bucketId(item, channel, action) {
    const base = channel === 'self' ? 'modifiers.self' : 'modifiers.target';
    return action === channelAction(item, channel) ? base : `${base}@${action}`;
  }

  /** Turn a bucket card id back into (channel, action). 'main'/'sub' are the old aliases of the default bucket. */
  function parseBucketId(item, id) {
    const raw = String(id || '');
    if (raw === 'main' || raw === 'sub') {
      const channel = raw === 'sub' ? 'target' : 'self';
      return {channel, action: channelAction(item, channel), isDefault: true};
    }
    const [base, suffix] = raw.split('@');
    const channel = base === 'modifiers.target' || base === 'modifiers.sub' ? 'target' : 'self';
    const explicit = normalizeAction(suffix);
    return {
      channel,
      action: explicit || channelAction(item, channel),
      isDefault: !explicit || explicit === channelAction(item, channel)
    };
  }

  /** The trigger actions with no bucket yet in that channel. These are the candidates for adding a card (= a bucket). */
  function freeBucketActions(item, channel) {
    const used = new Set(modifierBuckets(item).filter(bucket => bucket.channel === channel)
      .map(bucket => bucket.action));
    return ['activation', 'use', 'attack'].filter(action => !used.has(action));
  }

  function modifierBuckets(item) {
    const buckets = [];
    for (const channel of ['self', 'target']) {
      const entries = attributeEntries(attributeMap(item, channel));
      if (!entries.length) continue;
      const fallback = channelAction(item, channel);
      const groups = new Map();
      for (const [key, entry] of entries) {
        const action = attributeAction(item, channel, entry);
        if (!groups.has(action)) groups.set(action, []);
        groups.get(action).push(key);
      }
      for (const action of ['activation', 'use', 'attack']) {
        const keys = groups.get(action);
        if (!keys) continue;
        buckets.push({
          channel, action, keys,
          isDefault: action === fallback,
          lifecycle: bucketLifecycle(item, channel, action),
          id: bucketId(item, channel, action)
        });
      }
    }
    return buckets;
  }

  function inferAction(item, kind, data = {}) {
    const explicit = normalizeAction(data?.action);

    // The self-modifier bucket of equipment (weapon/protect/vehicle) mixes two things of different character.
    //  (1) Always-on properties — "while equipped, …" (a guitar's <Art: Music> +1, a laser rifle's penetration).
    //      Equipping is the source of the state and there is no notion of "declaring a use" at all.
    //  (2) Declared temporary modifiers — "spend a minor action to declare, then …" (a bolt-action rifle's accuracy +5,
    //      a guard shield's guard value +5). They attach on declaration and go off at their expiry timing.
    // Deciding everything is (1) from the type alone turns (2) on from equipping too; it then goes off at the first
    // expiry hook (disable-hooks lowers active.state) and never comes back until re-equipped, even while still equipped.
    // The distinguishing axis already exists in applyMode, so it is honored — the template default for equipment
    // is 'toggle' (= (1)), so existing data with no explicit authoring behaves exactly as before.
    //
    //  (3) A modifier that attaches only when attacking with that weapon — "on attack". Unlike (1) it does not attach
    //      from equipping alone ((1) attaches even when you hold that weapon and attack with **another** one), and
    //      unlike (2) there is no declaration and nothing is spent.
    // **Opening (3) does not make (2) fire automatically from an attack.** The rules say to "declare it immediately
    // before making the accuracy check", so if (2) went off merely by attacking with that weapon there would be no
    // place left to choose whether to spend the single use — and that choice is the whole point of this class of gear.
    // Two things hold the invariant: (2) attaches only when the roll dialog's declaration toggle settles it as
    // action:'use' (declared-equipment's declaredAttributes = selfFrozenAttributes(item,'use')), and (3) contains
    // **only rows explicitly authored** as "on attack". Unspecified data is always sent to (1) or (2) by the applyMode
    // fallback below, so there is no path into (3) (measured across the compendium: all 22 explicit gear rows are 'use', 0 are 'attack').
    if (kind === 'selfModifiers' && EQUIPMENT_TYPES.includes(item.type)) {
      if (explicit) return explicit;
      const mode = data?.applyMode || item.system?.active?.applyMode || 'toggle';
      return mode === 'onUse' ? 'use' : 'activation';
    }
    if (explicit) return explicit;

    const timing = data?.timing || data?.runTiming || 'instant';
    if (kind === 'selfModifiers') {
      if ((item.system?.active?.applyMode || 'onUse') === 'toggle') return 'activation';
      // In the old actor sheet an always-on non-attack effect with only self modifiers was a persistent toggle
      // switched on and off by clicking its name. Existing data with no explicit action preserves that meaning.
      if (item.type === 'effect' && item.system?.timing === 'always' && !isAttackItem(item)
        && hasUsableEntries(item.system?.attributes)
        && !hasUsableEntries(item.system?.effect?.attributes)) return 'activation';
      return invocationAction(item);
    }
    if (timing === 'afterDamage' || timing === 'afterHit') return 'attack';
    if (kind === 'targetModifiers' || kind === 'damage' || kind === 'condition' || kind === 'macro') {
      return isAttackItem(item) ? 'attack' : 'use';
    }
    return invocationAction(item);
  }

  function triggerFor(action, timing = 'instant') {
    if (action === 'activation') return 'activate';
    if (timing === 'afterSuccess') return action === 'attack' ? 'hit' : 'success';
    if (timing === 'afterHit') return 'hit';
    if (timing === 'afterDamage') return 'damageApplied';
    if (timing === 'afterMain') return 'afterMain';
    if (timing === 'onInvoke') return 'invoke';
    return action === 'attack' ? 'attack' : 'use';
  }

  function actionLabel(action) {
    return localize({
      activation: 'DX3rd.EffectActionActivation',
      use: 'DX3rd.EffectActionUse',
      attack: 'DX3rd.EffectActionAttack'
    }[action] || 'DX3rd.EffectActionUse');
  }

  function triggerLabel(trigger) {
    return localize({
      activate: 'DX3rd.EffectTriggerActivate',
      use: 'DX3rd.EffectTriggerUse',
      attack: 'DX3rd.EffectTriggerAttack',
      success: 'DX3rd.EffectTriggerSuccess',
      hit: 'DX3rd.EffectTriggerHit',
      damageApplied: 'DX3rd.EffectTriggerDamageApplied',
      afterMain: 'DX3rd.AfterMain',
      invoke: 'DX3rd.OnInvoke'
    }[trigger] || 'DX3rd.Instant');
  }

  function targetLabel(target) {
    return localize({
      self: 'DX3rd.EffectTargetSelf',
      targetToken: 'DX3rd.EffectTargetSelected',
      targetAll: 'DX3rd.EffectTargetAll',
      scene: 'DX3rd.EffectTargetScene',
      damagedTargets: 'DX3rd.EffectTargetDamaged',
      hitTargets: 'DX3rd.EffectTargetHit'
    }[target] || 'DX3rd.EffectTargetSelf');
  }

  function targetForTargetModifiers(item, timing) {
    if (timing === 'afterDamage') return 'damagedTargets';
    if (timing === 'afterHit') return 'hitTargets';
    if (item.system?.scene) return 'scene';
    if (item.system?.getTarget) return 'targetToken';
    return 'self';
  }

  function formulaSummary(data = {}) {
    const dice = String(data.formulaDice ?? data.dice ?? '').trim();
    const add = String(data.formulaAdd ?? data.add ?? '').trim();
    // Legacy extension data stores formulaDice: 0 when there are no dice.
    // Reading that as a dice count would show an empty formula as 0d10 on the card, so it is excluded.
    const diceTerm = dice && dice !== '0'
      ? (window.DX3rdFormulaEvaluator?.hasDice?.(dice) ? dice : `${dice}d10`)
      : '';
    const addTerm = add && add !== '0' ? add : '';
    if (diceTerm && addTerm) return `${diceTerm} + ${addTerm}`;
    return addTerm || diceTerm || '-';
  }

  function directTitle(type) {
    return localize({
      heal: 'DX3rd.Heal',
      damage: 'DX3rd.DamageToHP',
      statusClear: 'DX3rd.StatusClear',
      encroach: 'DX3rd.Encroachment',
      weapon: 'DX3rd.CreateWeapon',
      protect: 'DX3rd.CreateProtect',
      vehicle: 'DX3rd.CreateVehicle'
    }[type] || 'DX3rd.Effect');
  }

  function isOwn(object, key) {
    return Object.prototype.hasOwnProperty.call(object || {}, key);
  }

  function isConfiguredCondition(condition = {}) {
    return condition.configured === true || !!condition.type || condition.activate === true;
  }

  /**
   * Normalize the existing per-type slots and the new unbounded cards[] into one execution list.
   * A new card is {id, type, data} and there may be any number of cards of the same type.
   */
  function extensionEntries(itemOrExtend) {
    const ext = itemOrExtend?.getFlag
      ? (itemOrExtend.getFlag(SCOPE, 'itemExtend') || {})
      : (itemOrExtend || {});
    const entries = [];
    for (const type of EXECUTION_TYPES) {
      if (isOwn(ext, type)) entries.push({id: `legacy.${type}`, type, data: ext[type] || {}, legacy: true});
    }
    conditionEntries(ext).forEach((data, index) => {
      if (isConfiguredCondition(data)) entries.push({id: `legacy.condition.${index}`, type: 'condition', data, legacy: true});
    });
    for (const card of Array.isArray(ext.cards) ? ext.cards : []) {
      if (!card?.id || ![...DIRECT_TYPES, 'condition'].includes(card.type)) continue;
      entries.push({id: card.id, type: card.type, data: card.data || {}, legacy: false});
    }
    return entries;
  }

  function directSummary(type, data = {}) {
    if (type === 'heal' || type === 'damage') return formulaSummary(data);
    if (type === 'encroach') return String(data.value ?? data.formula ?? data.amount ?? '-');
    if (type === 'statusClear') return localize('DX3rd.Condition');
    return data.name || data.itemName || '-';
  }

  function conditionLabel(type) {
    if (!type) return '-';
    const configured = (CONFIG.statusEffects || []).find(effect => effect.id === type);
    return configured?.name ? localize(configured.name) : type;
  }

  function conditionEntries(itemExtend = {}) {
    const raw = itemExtend.condition || {};
    if (Array.isArray(raw.conditions)) {
      const out = raw.conditions.slice(0, 3).map(value => ({...value}));
      while (out.length < 3) out.push({timing: 'instant', target: 'self', type: '', activate: false});
      return out;
    }
    const legacy = raw.type || raw.conditionTypes?.[0]
      ? [{...raw, type: raw.type || raw.conditionTypes?.[0]}]
      : [];
    while (legacy.length < 3) legacy.push({timing: 'instant', target: 'self', type: '', activate: false});
    return legacy.slice(0, 3);
  }

  function descriptorBase(item, {id, family, kind, data, active, title, summary, target, editor}) {
    const action = inferAction(item, kind, data);
    const timing = data?.timing || data?.runTiming || 'instant';
    const trigger = triggerFor(action, timing);
    return {
      id, family, kind, active: !!active, title, summary: summary || '-', target,
      action, actionLabel: actionLabel(action), trigger, triggerLabel: triggerLabel(trigger),
      targetLabel: targetLabel(target), editor, toggleable: target === 'self'
    };
  }

  function collectImmediate(item) {
    const cards = [];
    for (const entry of extensionEntries(item).filter(entry => DIRECT_TYPES.includes(entry.type))) {
      const {type, data} = entry;
      const target = data.target || 'self';
      cards.push(descriptorBase(item, {
        id: entry.legacy ? `extend.${type}` : `card.${entry.id}`,
        family: 'immediate', kind: type, data,
        active: data.activate,
        title: directTitle(type), summary: directSummary(type, data), target,
        editor: type
      }));
    }
    const macros = Array.isArray(item.system?.macros) ? item.system.macros : [];
    macros.forEach((macro, index) => {
      const title = macro.kind === 'macro' ? (macro.macroName || localize('DX3rd.Macro')) : localize('DX3rd.MacroKindCode');
      cards.push(descriptorBase(item, {
        id: `macro.${index}`,
        family: 'immediate', kind: 'macro', data: macro,
        active: !macro.disabled,
        title, summary: macro.timing || 'instant', target: 'self', editor: 'macro'
      }));
    });
    // The roll-redefinition card mirrors `system.rollIntervention`, not the extend flag —
    // the card exists only while the authored declaration is enabled.
    const intervention = item.system?.rollIntervention;
    if (intervention?.enabled) {
      cards.push(descriptorBase(item, {
        id: 'rollIntervention', family: 'immediate', kind: 'rollIntervention',
        data: {timing: 'instant', target: 'self'},
        active: true,
        title: localize('DX3rd.RollRedefine'), summary: interventionSummary(intervention),
        target: 'self', editor: 'rollIntervention'
      }));
      const card = cards[cards.length - 1];
      // Its two axes live inside the declaration, not the action-binding select — state them on the badges.
      card.triggerLabel = intervention.phase === 'beforeRoll'
        ? localize('DX3rd.RollInterventionPhaseBefore')
        : localize('DX3rd.RollInterventionPhaseAfter');
      card.targetLabel = localize({
        self: 'DX3rd.RollInterventionTargetSelf',
        any: 'DX3rd.RollInterventionTargetAny',
        sourceItem: 'DX3rd.RollInterventionTargetSourceItem',
        combinedItem: 'DX3rd.RollInterventionTargetCombinedItem'
      }[intervention.target] || 'DX3rd.RollInterventionTargetSelf');
      card.toggleable = true;
    }
    return cards;
  }

  function interventionSummary(config = {}) {
    const kinds = (Array.isArray(config.kinds) ? config.kinds : [config.kinds].filter(Boolean))
      .map(kind => localize({
        check: 'DX3rd.RollInterventionKindCheck',
        damage: 'DX3rd.RollInterventionKindDamage',
        backtrack: 'DX3rd.RollInterventionKindBacktrack',
        sceneEncroachment: 'DX3rd.RollInterventionKindScene'
      }[kind] || 'DX3rd.RollInterventionKindCheck')).join('/');
    const operation = localize({
      rerollAll: 'DX3rd.RollInterventionOpRerollAll',
      rerollSelected: 'DX3rd.RollInterventionOpRerollSelected',
      setFaces: 'DX3rd.RollInterventionOpSetFaces',
      adjustFaces: 'DX3rd.RollInterventionOpAdjustFaces',
      chooseOneOrTen: 'DX3rd.RollInterventionOpChooseOneOrTen',
      replaceTotal: 'DX3rd.RollInterventionOpReplaceTotal'
    }[config.operation] || 'DX3rd.RollInterventionOpSetFaces');
    const value = config.value !== '' && config.value != null ? ` ${config.value}` : '';
    return `${kinds || '-'} · ${operation}${value}`;
  }

  function collectPersistent(item) {
    const system = item.system || {};
    const ext = item.getFlag?.(SCOPE, 'itemExtend') || {};
    const selfData = {...(system.active || {}), timing: system.active?.runTiming || 'instant'};
    const targetData = {...(system.effect || {}), timing: system.effect?.runTiming || 'instant'};
    // There is one modifier card per channel × effective trigger action (bucket). It used to be one per channel,
    // so there was no way to author "+1 always while equipped" and "+2 when declared" separately on one item.
    // A channel with no bucket at all (no modifier rows) still keeps one card — hasActionEffects / requiresTarget
    // decide entry points from the card list, and the sheet filters on count before drawing.
    const buckets = modifierBuckets(item);
    const bucketsFor = channel => {
      const own = buckets.filter(bucket => bucket.channel === channel);
      if (own.length) return own;
      const action = channelAction(item, channel);
      return [{channel, action, keys: [], isDefault: true,
        lifecycle: bucketLifecycle(item, channel, action),
        id: channel === 'self' ? 'modifiers.self' : 'modifiers.target'}];
    };
    const cards = [];
    const pushBucketCard = (bucket, descriptor) => {
      cards.push(descriptorBase(item, descriptor));
      const card = cards[cards.length - 1];
      card.count = bucket.keys.length;
      card.isDefaultBucket = bucket.isDefault;
      // The card IS the bucket, so it also holds the lifetime fields (the sheet badge and the extend pane read them together).
      card.disable = bucket.lifecycle.disable;
      card.runTiming = bucket.lifecycle.runTiming;
      card.bucketOverridden = bucket.lifecycle.overridden;
      // The default bucket is the channel itself and cannot be deleted (deleting it would drop every unspecified row in the channel).
      card.deletable = !bucket.isDefault && bucket.keys.length > 0;
    };
    for (const bucket of bucketsFor('self')) {
      pushBucketCard(bucket, {
        id: bucket.id, family: 'persistent', kind: 'selfModifiers',
        data: {...selfData, action: bucket.action, timing: bucket.lifecycle.runTiming},
        // What counts as "alive" differs per bucket. For an activation bucket active.state IS the applied state,
        // but a frozen bucket's (on use / on attack) state is held by the AE and does not use active.state —
        // if it is authored, the card is alive (the same test as a target-modifier card).
        // Deciding from state alone would leave it permanently grey on the sheet and, worse, make hasActionEffects
        // return false, closing the weapon mode menu's "use" entry point entirely.
        active: bucket.keys.length > 0 && (bucket.action === 'activation'
          ? !!system.active?.state
          : bucket.lifecycle.disable !== 'notCheck'),
        title: localize('DX3rd.SelfModifiers'),
        summary: localize('DX3rd.EffectModifierCount').replace('{count}', bucket.keys.length),
        target: 'self', editor: 'selfModifiers'
      });
    }
    for (const bucket of bucketsFor('target')) {
      pushBucketCard(bucket, {
        id: bucket.id, family: 'persistent', kind: 'targetModifiers',
        data: {...targetData, action: bucket.action, timing: bucket.lifecycle.runTiming},
        active: bucket.keys.length > 0 && bucket.lifecycle.disable !== 'notCheck',
        title: localize('DX3rd.TargetModifiers'),
        summary: localize('DX3rd.EffectModifierCount').replace('{count}', bucket.keys.length),
        target: targetForTargetModifiers(item, bucket.lifecycle.runTiming),
        editor: 'targetModifiers'
      });
    }
    extensionEntries(ext).filter(entry => entry.type === 'condition').forEach((entry, index) => {
      const condition = entry.data;
      cards.push(descriptorBase(item, {
        id: entry.legacy ? `condition.${entry.id.split('.').pop()}` : `card.${entry.id}`,
        family: 'persistent', kind: 'condition', data: condition,
        active: condition.activate && condition.type,
        title: localize('DX3rd.Condition'),
        summary: conditionLabel(condition.type),
        target: condition.target || 'self', editor: entry.legacy ? `condition${Number(entry.id.split('.').pop()) + 1}` : 'condition'
      }));
    });
    return cards;
  }

  function prepareSheetContext(item) {
    const immediate = collectImmediate(item);
    const persistent = collectPersistent(item);
    const selfModifierCount = Object.keys(item.system?.attributes || {}).length;
    const targetModifierCount = Object.keys(item.system?.effect?.attributes || {}).length;
    const anySelfActive = persistent.some(card => card.kind === 'selfModifiers' && card.active);
    const modifierOverview = {
      id: 'modifiers',
      active: targetModifierCount > 0 || anySelfActive,
      selfActive: anySelfActive,
      toggleable: selfModifierCount > 0,
      selfCount: selfModifierCount,
      targetCount: targetModifierCount,
      totalCount: selfModifierCount + targetModifierCount,
      // The extend dialog's channel setting is the "default trigger action" (what a row with no explicit value inherits).
      // The default bucket card may not exist (when every row is explicitly authored), so it is read from the channel directly.
      selfAction: channelAction(item, 'self'),
      targetAction: channelAction(item, 'target'),
      initialScope: targetModifierCount > 0 && selfModifierCount === 0 ? 'modifiers.target' : 'modifiers.self',
      summary: `${localize('DX3rd.Self')} ${selfModifierCount} / ${localize('DX3rd.Target')} ${targetModifierCount}`
    };
    // A persistent-modifier card has two axes. While they were bundled into one card, neither was visible:
    //  (1) Who it applies to — self (system.attributes) / target (system.effect.attributes). The data was always
    //      separate, but one card showed only a "self N / target M" summary, and the fact that expiry timing and
    //      trigger action are per-channel too never surfaced.
    //  (2) The trigger action — activation / on use / on attack. Bound to one per channel, an item's persistent
    //      effects could only fire at a single moment however many modifiers you added. Now the action can be
    //      authored per row (the extend dialog's per-row "trigger action"), and there is one card per bucket.
    const isEquipment = EQUIPMENT_TYPES.includes(item.type);
    const actionOptions = [
      {value: 'activation', label: actionLabel('activation')},
      {value: 'use', label: actionLabel('use')},
      {value: 'attack', label: actionLabel('attack')}
    ];
    // Equipment's self modifiers offer all three too. "On use" (= declaration) and "on attack" are different things
    // ((2) and (3) in inferAction), and unless it is moved to "on attack", a declared modifier fires only on declaration.
    const selfActionOptions = actionOptions;
    modifierOverview.selfActionOptions = selfActionOptions;
    modifierOverview.targetActionOptions = actionOptions;
    // The card's second axis. Who it applies to (self/target) IS the data channel, so it is chosen on the card —
    // putting it in the edit pane or on a row lets the channel the card title states disagree with the value inside.
    const channelOptions = [
      {value: 'self', label: localize('DX3rd.Self')},
      {value: 'target', label: localize('DX3rd.Target')}
    ];
    modifierOverview.channelOptions = channelOptions;
    // One card per bucket. The placeholder card for a channel with no modifier rows is not drawn
    // (the count:0 card collectPersistent keeps for the entry-point decision).
    const drawn = persistent
      .filter(card => ['selfModifiers', 'targetModifiers'].includes(card.kind) && card.count > 0);
    // Two or more cards in the same channel share a title and become indistinguishable — so the summary names the trigger action.
    const multiBucket = kind => drawn.filter(card => card.kind === kind).length > 1;
    const modifierCards = drawn
      .map(card => multiBucket(card.kind)
        ? {...card, summary: `${card.actionLabel} · ${card.summary}`}
        : card)
      .map(card => {
        // A bucket's lifetime fields belong to that bucket — the channel's flat fields for the default bucket,
        // its own buckets.<action> path for an explicit one. The extend dialog's pane writes through this name directly.
        const lifecycle = bucketLifecycle(item, card.kind === 'selfModifiers' ? 'self' : 'target', card.action);
        const bucketFields = {
          disableName: `${lifecycle.path}.disable`,
          runTimingName: `${lifecycle.path}.runTiming`,
          stackName: `${lifecycle.path}.stack`,
          stack: lifecycle.stack,
          bucketPath: lifecycle.path,
          channel: card.kind === 'selfModifiers' ? 'self' : 'target',
          channelOptions,
          // Only a target-channel bucket can have its own trigger timing. Self-channel triggering is a single
          // active.state flag, so there cannot be a different moment per bucket — an explicit bucket's pane does
          // not offer the field at all (offering a field nothing reads produces authoring that never applies).
          showRunTiming: card.kind === 'targetModifiers' || lifecycle.isDefault,
          bucketLabel: `${localize(card.kind === 'selfModifiers' ? 'DX3rd.Self' : 'DX3rd.Target')} · ${card.actionLabel}`
        };
        if (card.kind === 'targetModifiers') {
          return {...card, ...bucketFields, editor: 'modifiers', toggleable: false, actionOptions};
        }
        // Only the activation bucket has anything to turn on and off. A frozen bucket's (on use / on attack) state
        // lives in the AE and does not use active.state, so offering a checkbox there made an item turned on that way
        // either count twice (equipment self-computation + the frozen AE) or hit the trigger gate and do nothing on use.
        // To use it as always-on, change that card's "trigger action" to 'activation' and the checkbox appears.
        return {
          ...card, ...bucketFields,
          editor: 'modifiers', toggleable: card.action === 'activation',
          actionOptions: selfActionOptions,
          // active (is the card alive) is not touched up here — collectPersistent already decides it per bucket.
          // Painting over it only on the sheet made the same card look dead to hasActionEffects, so a declaration
          // weapon's "use" entry point never opened.
          // For equipment, an always-on bucket's state comes from being equipped, not from "on activation".
          triggerLabel: isEquipment && card.action === 'activation'
            ? localize('DX3rd.EffectTriggerEquipped')
            : card.triggerLabel
        };
      });
    // The extend dialog has one pane per card (= bucket). A channel with no rows keeps its default-bucket pane so
    // there is somewhere to put the first modifier. **There is no dropdown for choosing a row's bucket** — a row
    // belongs to the card it was added to, and a card's two axes (who it applies to · the trigger action) are chosen
    // on the sheet card. Offering the same axis again inside the pane or per row would mean choosing one axis in three
    // places, leaving it impossible to tell which value actually applies (that state really did misbehave).
    const bucketPaneFor = (channel, action) => {
      const drawnCard = modifierCards.find(card =>
        (card.kind === 'selfModifiers' ? 'self' : 'target') === channel && card.action === action);
      if (drawnCard) return drawnCard;
      const lifecycle = bucketLifecycle(item, channel, action);
      return {
        id: bucketId(item, channel, action), kind: channel === 'self' ? 'selfModifiers' : 'targetModifiers',
        action, actionLabel: actionLabel(action), count: 0, deletable: false,
        disable: lifecycle.disable, runTiming: lifecycle.runTiming,
        disableName: `${lifecycle.path}.disable`, runTimingName: `${lifecycle.path}.runTiming`,
        stackName: `${lifecycle.path}.stack`, stack: lifecycle.stack,
        bucketPath: lifecycle.path,
        showRunTiming: channel === 'target' || lifecycle.isDefault,
        bucketLabel: `${localize(channel === 'self' ? 'DX3rd.Self' : 'DX3rd.Target')} · ${actionLabel(action)}`
        // actionOptions is used by the sheet card only — the extend pane does not choose a trigger action.
      };
    };
    const bucketPanes = [];
    for (const channel of ['self', 'target']) {
      const seen = new Set();
      for (const card of modifierCards.filter(card =>
        (card.kind === 'selfModifiers' ? 'self' : 'target') === channel)) {
        seen.add(card.action);
        bucketPanes.push({...card, isSelf: channel === 'self'});
      }
      const fallbackAction = channelAction(item, channel);
      if (!seen.has(fallbackAction)) {
        bucketPanes.push({...bucketPaneFor(channel, fallbackAction), isSelf: channel === 'self'});
      }
    }
    // The modifier row list. Each row carries its owning bucket (for calculation and filtering; there is no UI to pick it).
    const allRows = ['self', 'target'].flatMap(channel =>
      attributeEntries(attributeMap(item, channel)).map(([key, entry]) => ({
        key, attr: entry,
        pos: channel === 'self' ? 'main' : 'sub',
        path: channel === 'self' ? `system.attributes.${key}` : `system.effect.attributes.${key}`,
        bucket: bucketId(item, channel, attributeAction(item, channel, entry))
      })));
    // And **each bucket must hold only its own rows**. Splitting the cards by trigger action while sharing one row
    // list means opening the "activation" card still shows the "on use" card's rows, so splitting the cards means
    // nothing (and you cannot even tell which card you are editing). To move a row to another card, change that
    // card's axis (who it applies to / the trigger action), or add it again from the target card.
    modifierOverview.buckets = bucketPanes.map(pane =>
      ({...pane, rows: allRows.filter(row => row.bucket === pane.id)}));
    modifierOverview.rows = allRows;
    if (!bucketPanes.some(pane => pane.id === modifierOverview.initialScope)) {
      modifierOverview.initialScope = bucketPanes[0]?.id || 'modifiers.self';
    }
    const immediateAddOptions = DIRECT_TYPES.map(type => ({value: type, label: directTitle(type)}));
    // A persistent-modifier card is one bucket — adding one creates a new card with a trigger action not yet used
    // in that channel. It is disabled as "already added" only when there is no trigger action left to create.
    const addedLabel = localize('DX3rd.AlreadyAdded');
    // One roll-redefinition declaration per item — once enabled, the card itself is the entry point.
    const interventionAdded = !!item.system?.rollIntervention?.enabled;
    immediateAddOptions.push({
      value: 'rollIntervention',
      label: interventionAdded
        ? `${localize('DX3rd.RollRedefine')} (${addedLabel})`
        : localize('DX3rd.RollRedefine'),
      disabled: interventionAdded
    });
    const bucketSlotsLeft = freeBucketActions(item, 'self').length + freeBucketActions(item, 'target').length;
    const persistentAddOptions = [
      {value: 'modifiers', label: localize('DX3rd.PersistentModifiers'), disabled: bucketSlotsLeft === 0},
      {value: 'condition', label: localize('DX3rd.Condition'), disabled: false}
    ].map(option => option.disabled ? {...option, label: `${option.label} (${addedLabel})`} : option);
    return {
      immediate, persistent, modifierOverview, modifierCards, actionOptions,
      immediateAddOptions, persistentAddOptions,
      persistentAddDisabled: persistentAddOptions.every(option => option.disabled),
      persistentConditionCount: persistent.filter(card => card.id.startsWith('condition.') || card.id.startsWith('card.')).length,
      immediateActiveCount: immediate.filter(card => card.active).length,
      persistentActiveCount: (modifierOverview.active ? 1 : 0)
        + persistent.filter(card => card.id.startsWith('condition.') && card.active).length
    };
  }

  function extensionActionMatches(item, kind, data, action, timing = 'instant') {
    const expected = normalizeAction(action) || eventAction(item, timing);
    return actionCoversBucket(item, expected, inferAction(item, kind, data));
  }

  /**
   * Should the target modifiers be applied for the current trigger action?
   * Even when the channel default differs, a single row **explicitly authored** with that action lets it through —
   * otherwise authoring a per-row trigger action would still be blocked wholesale by the channel gate.
   */
  function targetActionMatches(item, action, timing = 'instant') {
    if (attributeEntries(attributeMap(item, 'target')).length) {
      return modifierExecutionBuckets(item, 'target', action, timing).length > 0;
    }
    if (extensionActionMatches(item, 'targetModifiers', item.system?.effect || {}, action, timing)) return true;
    const expected = normalizeAction(action) || eventAction(item, timing);
    return hasExplicitBucket(item, 'target', expected);
  }

  function macroActionMatches(item, macro, action, timing = 'instant') {
    return extensionActionMatches(item, 'macro', macro || {}, action, timing);
  }

  /** Is there any active effect that needs a selected target, regardless of action? (a pre-check for combo members) */
  function requiresAnyTarget(item) {
    return [...collectImmediate(item), ...collectPersistent(item)].some(card =>
      card.active && ['targetToken', 'damagedTargets', 'hitTargets'].includes(card.target));
  }

  function requiresTarget(item, action = invocationAction(item)) {
    const expected = normalizeAction(action) || invocationAction(item);
    const targetCards = collectPersistent(item).filter(card => card.kind === 'targetModifiers');
    if (targetCards.some(card => card.active && actionCoversBucket(item, expected, card.action)
      && ['targetToken', 'damagedTargets', 'hitTargets'].includes(card.target))) return true;
    return [...collectImmediate(item), ...collectPersistent(item)].some(card =>
      card.active && actionCoversBucket(item, expected, card.action)
      && ['targetToken', 'damagedTargets', 'hitTargets'].includes(card.target));
  }

  function hasActionEffects(item, action) {
    const expected = normalizeAction(action);
    if (!expected) return false;
    return [...collectImmediate(item), ...collectPersistent(item)]
      .some(card => card.active && card.action === expected);
  }

  /**
   * A combo member normally keeps its own use/attack role. If the combo's action differs and the
   * member explicitly owns a live bucket for that action, honor the authored bucket instead.
   * Activation is never inherited from combo inclusion.
   */
  function comboMemberAction(item, parentAction = null) {
    const intrinsic = invocationAction(item);
    const parent = normalizeAction(parentAction);
    if (!parent || parent === 'activation' || parent === intrinsic) return intrinsic;
    return hasActionEffects(item, parent) ? parent : intrinsic;
  }

  /** The update data that moves the channel's own trigger action (used only when moving the default bucket). */
  function channelActionUpdates(channel, action) {
    if (channel === 'self') {
      return {
        'system.active.action': action,
        'system.active.applyMode': action === 'activation' ? 'toggle' : 'onUse',
        ...(action === 'activation' ? {'system.active.runTiming': 'instant'} : {})
      };
    }
    return {
      'system.effect.action': action,
      ...(action === 'activation' ? {'system.effect.runTiming': 'instant'} : {})
    };
  }

  /**
   * Change one modifier bucket's trigger action.
   *  · A default bucket (a card whose id has no @action) — the channel itself moves (the behavior so far). Explicit
   *    authoring in this bucket had the same value as the channel, so it is cleared to follow the moved channel.
   *  · An explicit bucket (a card whose id is like modifiers.self@use) — only those rows move. When the new action
   *    equals the channel default, the explicit value is cleared so it merges into the default bucket (rather than splitting into two cards).
   */
  /** The update that deletes a bucket lifetime override (buckets.<action>). Supports both the v13 and v14 deletion notations. */
  function bucketOverrideDeletion(channel, action) {
    const root = channel === 'self' ? 'system.active' : 'system.effect';
    const ForcedDeletion = foundry.data?.operators?.ForcedDeletion;
    return ForcedDeletion
      ? {[`${root}.buckets`]: {[action]: new ForcedDeletion()}}
      : {[`${root}.buckets.-=${action}`]: null};
  }

  async function updateModifierBucketAction(item, id, action) {
    const {channel, isDefault} = parseBucketId(item, id);
    const [, bucketSuffix] = String(id).split('@');
    const path = channel === 'self' ? 'system.attributes' : 'system.effect.attributes';
    const root = channel === 'self' ? 'system.active' : 'system.effect';
    const explicitBucket = normalizeAction(bucketSuffix);
    const current = explicitBucket || channelAction(item, channel);
    if (current === action) return true;
    // Carry the pre-move lifetime (trigger and expiry timing) to the new place — changing only the trigger action
    // while the timing reverts to the channel default would silently fire the card at a different moment.
    const carried = bucketLifecycle(item, channel, current);

    const updates = {};
    const map = attributeMap(item, channel);
    if (explicitBucket && !isDefault) {
      const merged = channelAction(item, channel) === action;
      for (const [key, entry] of attributeEntries(map)) {
        if (explicitAction(item, channel, entry) !== explicitBucket) continue;
        updates[`${path}.${key}.action`] = merged ? '' : action;
      }
      if (!Object.keys(updates).length) return false;
      // Once merged into the default bucket, the channel's flat fields own the lifetime (the override is discarded).
      if (!merged) {
        updates[`${root}.buckets.${action}.disable`] = carried.disable;
        // Only a target channel can have a per-bucket trigger timing — self-channel triggering is expressed by the
        // single active.state flag, so it cannot have a different moment per bucket.
        if (channel === 'target' && action !== 'activation') {
          updates[`${root}.buckets.${action}.runTiming`] = carried.runTiming;
        }
      }
      await item.update(updates);
      if (carried.overridden) await item.update(bucketOverrideDeletion(channel, explicitBucket));
      return true;
    }

    Object.assign(updates, channelActionUpdates(channel, action));
    for (const [key, entry] of attributeEntries(map)) {
      if (explicitAction(item, channel, entry) === current) updates[`${path}.${key}.action`] = '';
    }
    await item.update(updates);
    // If the action moved to already had an explicit bucket, that is now the default bucket — the channel's flat
    // fields own the lifetime, so the override is deleted (the two buckets merge into one card).
    if ((item.system?.[channel === 'self' ? 'active' : 'effect']?.buckets || {})[action]) {
      await item.update(bucketOverrideDeletion(channel, action));
    }
    if (channel === 'self' && EQUIPMENT_TYPES.includes(item.type) && item.system?.equipment) {
      const shouldBeActive = usesActivationSelfChannel(item) && item.system?.active?.disable !== 'notCheck';
      if (item.system?.active?.state !== shouldBeActive) {
        await item.update({'system.active.state': shouldBeActive}, {dx3rdActivationFromEquipment: true});
      }
    }
    return true;
  }

  /**
   * Change a modifier card's target channel — move every row of that card to the bucket with the same trigger
   * action in the opposite channel. Card = bucket, so changing an axis changes the card id too
   * (the caller must remember the new id for the open pane to stay open).
   *
   * The lifetime is not carried over. Self modifiers (system.active.*) and target modifiers (system.effect.*) have
   * lifetime fields on different axes to begin with, and at the destination that channel's rule must own them
   * (default bucket = the flat fields, explicit bucket = inherited from the channel) — overwriting with the carried
   * value would also change the lifetime of the rows already in that channel.
   *
   * When the destination already has a card with the same trigger action, the two cards **merge** — the same channel ×
   * the same action is one bucket by definition. It looks like a card disappeared, so the merge is reported in the
   * return value for the caller to announce.
   */
  async function updateModifierChannel(item, id, channel) {
    if (!item) return null;
    const to = channel === 'target' ? 'target' : 'self';
    const from = parseBucketId(item, id);
    if (!from || from.channel === to) return null;
    const action = from.action;
    const keys = attributeEntries(attributeMap(item, from.channel))
      .filter(([, entry]) => attributeAction(item, from.channel, entry) === action)
      .map(([key]) => key);
    if (!keys.length) return null;
    const toId = bucketId(item, to, action);
    const merged = attributeEntries(attributeMap(item, to))
      .some(([, entry]) => attributeAction(item, to, entry) === action);
    for (const key of keys) await moveModifierToBucket(item, key, id, toId);
    // Emptying an explicit bucket entirely leaves its lifetime override without an owner.
    if (!from.isDefault) await item.update(bucketOverrideDeletion(from.channel, action));
    return {id: bucketId(item, to, action), merged};
  }

  async function updateAction(item, id, action) {
    action = normalizeAction(action);
    if (!item || !action) return false;
    if (String(id).startsWith('modifiers.self') || String(id).startsWith('modifiers.target')) {
      return updateModifierBucketAction(item, id, action);
    }
    if (id.startsWith('macro.')) {
      const index = Number(id.split('.')[1]);
      const macros = foundry.utils.deepClone(item.system?.macros || []);
      if (!macros[index]) return false;
      macros[index].action = action;
      if (action === 'activation') macros[index].timing = 'instant';
      await item.update({'system.macros': macros});
      return true;
    }

    if (id.startsWith('card.')) {
      const cardId = id.slice('card.'.length);
      const ext = foundry.utils.deepClone(item.getFlag(SCOPE, 'itemExtend') || {});
      const cards = Array.isArray(ext.cards) ? ext.cards : [];
      const card = cards.find(entry => entry?.id === cardId);
      if (!card) return false;
      card.data = {...(card.data || {}), action};
      if (action === 'activation') card.data.timing = 'instant';
      ext.cards = cards;
      await item.setFlag(SCOPE, 'itemExtend', ext);
      return true;
    }

    const ext = foundry.utils.deepClone(item.getFlag(SCOPE, 'itemExtend') || {});
    if (id.startsWith('condition.')) {
      const index = Number(id.split('.')[1]);
      const conditions = conditionEntries(ext);
      conditions[index].action = action;
      if (action === 'activation') conditions[index].timing = 'instant';
      ext.condition = {conditions};
    } else if (id.startsWith('extend.')) {
      const type = id.slice('extend.'.length);
      ext[type] = {...(ext[type] || {}), action};
      if (action === 'activation') ext[type].timing = 'instant';
    } else return false;
    await item.setFlag(SCOPE, 'itemExtend', ext);
    return true;
  }

  async function toggleEffect(item, id, active) {
    if (!item) return false;
    if (id === 'rollIntervention') {
      await item.update({'system.rollIntervention.enabled': !!active});
      return true;
    }
    // 'modifiers' is the card id from when self and target were one card. It is kept after the split —
    // whichever bucket, what gets turned on and off is the one self-modifier state (system.active.state).
    if (id === 'modifiers' || String(id).startsWith('modifiers.self')) {
      const selfCount = Object.keys(item.system?.attributes || {}).length;
      if (!selfCount) return false;
      await item.update({'system.active.state': !!active});
      return true;
    }
    if (id.startsWith('macro.')) {
      const index = Number(id.split('.')[1]);
      const macros = foundry.utils.deepClone(item.system?.macros || []);
      if (!macros[index]) return false;
      macros[index].disabled = !active;
      await item.update({'system.macros': macros});
      return true;
    }
    if (id.startsWith('card.')) {
      const cardId = id.slice('card.'.length);
      const ext = foundry.utils.deepClone(item.getFlag(SCOPE, 'itemExtend') || {});
      const cards = Array.isArray(ext.cards) ? ext.cards : [];
      const card = cards.find(entry => entry?.id === cardId);
      if (!card) return false;
      card.data = {...(card.data || {}), activate: !!active};
      ext.cards = cards;
      await item.setFlag(SCOPE, 'itemExtend', ext);
      return true;
    }
    if (!id.startsWith('extend.') && !id.startsWith('condition.')) return false;
    const ext = foundry.utils.deepClone(item.getFlag(SCOPE, 'itemExtend') || {});
    if (id.startsWith('condition.')) {
      const index = Number(id.split('.')[1]);
      const conditions = conditionEntries(ext);
      conditions[index].activate = !!active;
      ext.condition = {conditions};
    } else {
      const type = id.slice('extend.'.length);
      ext[type] = {...(ext[type] || {}), activate: !!active};
    }
    await item.setFlag(SCOPE, 'itemExtend', ext);
    return true;
  }

  function createDirectData(item, type) {
    const base = {
      configured: true,
      action: invocationAction(item),
      timing: 'instant',
      target: 'self',
      activate: true
    };
    if (type === 'heal' || type === 'damage') {
      return {...base, formulaDice: 0, formulaAdd: ''};
    }
    if (type === 'statusClear') return {...base, exclude: []};
    if (type === 'weapon') return {...base, name: '', type: 'melee', skill: 'melee', amount: 1};
    if (type === 'protect') return {...base, name: ''};
    if (type === 'vehicle') return {...base, name: '', skill: 'drive'};
    return base;
  }

  async function addEffect(item, family, kind) {
    if (!item) return null;
    // The roll redefinition is an item system declaration, not an extend card — adding it flips the flag on.
    if (kind === 'rollIntervention') {
      if (!item.system?.rollIntervention?.enabled) {
        await item.update({'system.rollIntervention.enabled': true});
      }
      return 'rollIntervention';
    }
    const ext = foundry.utils.deepClone(item.getFlag(SCOPE, 'itemExtend') || {});
    if (family === 'immediate' && DIRECT_TYPES.includes(kind)) {
      const id = foundry.utils.randomID();
      const cards = Array.isArray(ext.cards) ? ext.cards : [];
      cards.push({id, type: kind, data: createDirectData(item, kind)});
      ext.cards = cards;
      await item.setFlag(SCOPE, 'itemExtend', ext);
      return `card.${id}`;
    }
    if (family === 'persistent' && kind === 'modifiers') {
      return addModifierBucket(item);
    }
    if (family === 'persistent' && kind === 'condition') {
      const id = foundry.utils.randomID();
      const cards = Array.isArray(ext.cards) ? ext.cards : [];
      cards.push({id, type: 'condition', data: {
        configured: true,
        action: invocationAction(item),
        timing: 'instant',
        target: 'self',
        type: '',
        poisonedRank: null,
        disable: null,
        activate: true
      }});
      ext.cards = cards;
      await item.setFlag(SCOPE, 'itemExtend', ext);
      return `card.${id}`;
    }
    return null;
  }

  /**
   * Create a new persistent-modifier bucket (= card). It takes a trigger action not yet used in the channel,
   * authors one empty modifier row with that action, and copies the lifetime fields from the channel so the bucket owns its own.
   * When the channel's default bucket is still empty, no new bucket is created and the row goes there instead —
   * the "add your first modifier" flow (the behavior so far) is preserved.
   */
  async function addModifierBucket(item, channel = null, action = null) {
    if (!item) return null;
    const channels = channel ? [channel] : ['self', 'target'];
    for (const chan of channels) {
      const path = chan === 'self' ? 'system.attributes' : 'system.effect.attributes';
      const existing = modifierBuckets(item).filter(bucket => bucket.channel === chan);
      const fallbackAction = channelAction(item, chan);
      const key = foundry.utils.randomID();
      // Put it in the default bucket when that one is empty (no action = inherit from the channel).
      if (!existing.some(bucket => bucket.action === fallbackAction)) {
        await item.update({[`${path}.${key}`]: {key: '-', label: '-', value: '', action: ''}});
        return bucketId(item, chan, fallbackAction);
      }
      const free = normalizeAction(action) ? [normalizeAction(action)] : freeBucketActions(item, chan);
      if (!free.length) continue;
      const next = free[0];
      const carried = bucketLifecycle(item, chan, fallbackAction);
      const root = chan === 'self' ? 'system.active' : 'system.effect';
      const updates = {[`${path}.${key}`]: {key: '-', label: '-', value: '', action: next}};
      updates[`${root}.buckets.${next}.disable`] = carried.disable;
      if (chan === 'target' && next !== 'activation') {
        updates[`${root}.buckets.${next}.runTiming`] = carried.runTiming;
      }
      await item.update(updates);
      return `${chan === 'self' ? 'modifiers.self' : 'modifiers.target'}@${next}`;
    }
    return null;
  }

  /** Delete one explicit bucket (its modifier rows plus the lifetime override). A default bucket cannot be deleted. */
  async function deleteModifierBucket(item, id) {
    const {channel, isDefault, action} = parseBucketId(item, id);
    if (isDefault) return false;
    const path = channel === 'self' ? 'system.attributes' : 'system.effect.attributes';
    const keys = attributeEntries(attributeMap(item, channel))
      .filter(([, entry]) => explicitAction(item, channel, entry) === action)
      .map(([key]) => key);
    if (!keys.length) return false;
    const ForcedDeletion = foundry.data?.operators?.ForcedDeletion;
    const updates = ForcedDeletion
      ? {[path]: Object.fromEntries(keys.map(key => [key, new ForcedDeletion()]))}
      : Object.fromEntries(keys.map(key => [`${path}.-=${key}`, null]));
    await item.update(updates);
    await item.update(bucketOverrideDeletion(channel, action));
    return true;
  }

  async function deleteEffect(item, id) {
    if (!item || !id) return false;
    if (id === 'rollIntervention') {
      await item.update({'system.rollIntervention.enabled': false});
      return true;
    }
    if (String(id).startsWith('modifiers.')) return deleteModifierBucket(item, id);
    if (id.startsWith('card.')) {
      const cardId = id.slice('card.'.length);
      const ext = foundry.utils.deepClone(item.getFlag(SCOPE, 'itemExtend') || {});
      const cards = Array.isArray(ext.cards) ? ext.cards : [];
      const next = cards.filter(card => card?.id !== cardId);
      if (next.length === cards.length) return false;
      ext.cards = next;
      await item.setFlag(SCOPE, 'itemExtend', ext);
      return true;
    }
    if (id.startsWith('extend.')) {
      const type = id.slice('extend.'.length);
      if (!DIRECT_TYPES.includes(type)) return false;
      const ext = item.getFlag(SCOPE, 'itemExtend') || {};
      if (!isOwn(ext, type)) return false;
      const ForcedDeletion = foundry.data?.operators?.ForcedDeletion;
      if (ForcedDeletion) {
        await item.update({[`flags.${SCOPE}.itemExtend`]: {[type]: new ForcedDeletion()}});
      } else {
        await item.update({[`flags.${SCOPE}.itemExtend.-=${type}`]: null});
      }
      return true;
    }
    if (id.startsWith('condition.')) {
      const index = Number(id.split('.')[1]);
      if (!Number.isInteger(index) || index < 0 || index > 2) return false;
      const ext = foundry.utils.deepClone(item.getFlag(SCOPE, 'itemExtend') || {});
      const conditions = conditionEntries(ext);
      conditions[index] = {timing: 'instant', target: 'self', type: '', activate: false};
      ext.condition = {conditions};
      await item.setFlag(SCOPE, 'itemExtend', ext);
      return true;
    }
    return false;
  }

  /**
   * Move a modifier row between the self and target channels.
   * @param {string} [action] the trigger action to stamp at the destination ('' = inherit the channel default).
   * @returns {Promise<string|false>} the key at the destination (a new one is issued when the key collides within the channel).
   */
  async function moveModifier(item, attributeKey, source, target, action = undefined) {
    if (!item || !attributeKey || source === target) return false;
    if (!['main', 'sub'].includes(source) || !['main', 'sub'].includes(target)) return false;
    const sourceMap = source === 'main' ? item.system?.attributes : item.system?.effect?.attributes;
    const targetMap = target === 'main' ? item.system?.attributes : item.system?.effect?.attributes;
    const attribute = sourceMap?.[attributeKey];
    if (!attribute) return false;

    let destinationKey = attributeKey;
    if (targetMap?.[destinationKey]) destinationKey = foundry.utils.randomID();
    const sourceParent = source === 'main' ? 'system.attributes' : 'system.effect.attributes';
    const targetParent = target === 'main' ? 'system.attributes' : 'system.effect.attributes';
    const moved = foundry.utils.deepClone(attribute);
    if (action !== undefined) moved.action = normalizeAction(action) || '';
    const updates = {[`${targetParent}.${destinationKey}`]: moved};
    const ForcedDeletion = foundry.data?.operators?.ForcedDeletion;
    if (ForcedDeletion) updates[sourceParent] = {[attributeKey]: new ForcedDeletion()};
    else updates[`${sourceParent}.-=${attributeKey}`] = null;

    // From the moment a target is chosen, put it in a state that can actually apply. The lifetime and whether
    // it is scene-targeted stay adjustable by the user in the shared channel settings.
    if (target === 'sub') {
      if (item.system?.effect?.disable === 'notCheck') updates['system.effect.disable'] = '-';
      if (!item.system?.scene) updates['system.getTarget'] = true;
    }
    await item.update(updates);
    return destinationKey;
  }

  /**
   * Change a modifier row's owning bucket (the channel move and the trigger-action tagging in one).
   * The extend dialog's per-row choice calls only this — keeping the self/target dropdown and the trigger-action
   * dropdown separate would mean touching the same row twice, with a mismatched bucket state in between.
   */
  async function moveModifierToBucket(item, attributeKey, fromId, toId) {
    if (!item || !attributeKey || String(fromId) === String(toId)) return false;
    const from = parseBucketId(item, fromId);
    const to = parseBucketId(item, toId);
    const tag = to.isDefault ? '' : to.action;
    if (from.channel !== to.channel) {
      return !!(await moveModifier(item, attributeKey,
        from.channel === 'self' ? 'main' : 'sub',
        to.channel === 'self' ? 'main' : 'sub', tag));
    }
    const path = to.channel === 'self' ? 'system.attributes' : 'system.effect.attributes';
    if (!attributeMap(item, to.channel)?.[attributeKey]) return false;
    await item.update({[`${path}.${attributeKey}.action`]: tag});
    return true;
  }

  Hooks.once('init', async () => {
    const loadTemplatesCompat = foundry.applications?.handlebars?.loadTemplates;
    if (typeof loadTemplatesCompat === 'function') await loadTemplatesCompat(PARTIALS);
  });

  // For an equip / active toggle the existing document state is the source of truth. Only the moment that state
  // flips false→true are the existing executors bound to 'activation' called, completing the third trigger action
  // without a separate effect engine. userId restricts execution to the originating client alone.
  Hooks.on('updateItem', async (item, changed, options, userId) => {
    if (userId && userId !== game.user?.id) return;
    const actor = item?.parent;
    if (!actor || actor.documentName !== 'Actor') return;
    const changedValue = path => Object.prototype.hasOwnProperty.call(changed || {}, path)
      ? changed[path]
      : foundry.utils.getProperty(changed, path);
    const activeState = changedValue('system.active.state');
    const activeOn = activeState === true;
    const activeOff = activeState === false;
    const equipmentChange = changedValue('system.equipment');
    const equippedOn = equipmentChange === true;
    const equippedOff = equipmentChange === false;

    // A status provided by equipment (currently flight) has being equipped as its source. Unequipping one item
    // does not clear the status while another item providing the same one is still equipped.
    if (equippedOn || equippedOff) {
      const changedStatuses = item.getFlag?.(SCOPE, 'equipmentStatuses') || [];
      for (const statusId of changedStatuses) {
        const shouldBeActive = actor.items.some(candidate =>
          candidate.system?.equipment === true
          && (candidate.getFlag?.(SCOPE, 'equipmentStatuses') || []).includes(statusId));
        if (actor.statuses?.has(statusId) !== shouldBeActive) {
          await actor.toggleStatusEffect(statusId, {active: shouldBeActive});
        }
      }
    }

    // Equipment bonuses (system.attributes) are consumed by actor.prepareData based on active.state.
    // The equipped state of gear bound to the activation action is synced to that source state, and only the hook
    // that comes back in on the true update runs the remaining activation effects.
    const isEquipment = EQUIPMENT_TYPES.includes(item.type);
    // Unequipping turns it off regardless of channel. actor.prepareData's activeItems looks only at active.state
    // and never at system.equipment, so gear modifiers turned on by declaration (use) would leak straight through
    // if they survived being taken off.
    if (isEquipment && equippedOff && item.system?.active?.state === true) {
      await item.update({'system.active.state': false}, {dx3rdActivationFromEquipment: true});
      return;
    }
    // Only the always-on channel (applyMode 'toggle') is turned on by equipping — a declaration type (onUse) is
    // turned on by handleItemUse at use time (see the equipment branch comment in inferAction).
    // Declaration gear with even one row authored as "activation" must turn the state on for that bucket too
    // (usesActivationSelfChannel looks at explicit buckets as well).
    const equipmentSelfActivation = isEquipment
      && usesActivationSelfChannel(item)
      && item.system?.active?.disable !== 'notCheck';
    if (equippedOn && equipmentSelfActivation && item.system?.active?.state !== true) {
      await item.update({'system.active.state': true}, {dx3rdActivationFromEquipment: true});
      return;
    }
    const handler = window.DX3rdUniversalHandler;
    if (!handler) return;
    // Switching the activation off is the same event as deleting the marker for whatever that activation created:
    // an activation-bound creation ("활성화" on the card) lives exactly as long as the item is on. Creations made by
    // *using* the item keep their own lifetime and are left alone (clearActivationGrants filters on the action).
    if (activeOff) {
      try { await handler.clearActivationGrants?.(actor, item); }
      catch (error) { console.error('DX3rd | activation grant cleanup failed:', item?.name, error); }
      return;
    }
    if (!activeOn && !equippedOn) return;
    try {
      await handler.executeMacros(item, 'instant', 'activation');
      await handler.applyToTargets(actor, item, 'instant', null, 'activation');
      await handler.processItemExtensions(actor, item, 'instant', 'activation');
      const ext = item.getFlag?.(SCOPE, 'itemExtend') || {};
      handler.registerAfterMainExtensions?.(actor, item, ext, 'activation');
    } catch (error) {
      console.error('DX3rd | activation effect routing failed:', item?.name, error);
    }
  });

  // ---- Defence bypass ------------------------------------------------------------------
  // "이 이펙트를 조합한 공격에 대해서는 가드를 실행할 수 없다" and its two siblings. Three axes,
  // because the rules print three and the counters key off which one was used.

  const BYPASS_AXES = ['armor', 'guard', 'reaction'];
  const RESTORE_AXES = ['armor', 'guard', 'reaction'];

  function readFlags(source, axes) {
    const out = {};
    for (const axis of axes) out[axis] = source?.[axis] === true;
    return out;
  }

  /** What this one item says the attack ignores. @returns {{armor: boolean, guard: boolean, reaction: boolean}} */
  function bypassDefense(item) {
    return readFlags(item?.system?.bypassDefense, BYPASS_AXES);
  }

  /** What this one item says it gives back. @returns {{armor: boolean, guard: boolean, reaction: boolean}} */
  function restoreDefense(item) {
    return readFlags(item?.system?.restoreDefense, RESTORE_AXES);
  }

  function registeredWeapons(actor, item) {
    const ids = Array.isArray(item?.system?.weapon) ? item.system.weapon : [];
    return ids.map(id => actor?.items?.get?.(String(id ?? ''))).filter(Boolean);
  }

  /**
   * Everything that contributes a bypass to one attack.
   *
   * Not just the item used: a combo inherits its members' bypass (that is what "이 이펙트를 조합한
   * 공격" means), and it inherits the registered weapon's too — 《레일 건》 and 《디스트로이어》 print
   * "가드를 실행할 수 없다" on the weapon, so firing them through a combo must carry it along.
   */
  function bypassSources(actor, item) {
    if (!item) return [];
    const members = window.DX3rdUniversalHandler?.comboMemberItems?.(actor, item) || [];
    const heads = [item, ...members];
    return [...heads, ...heads.flatMap(head => registeredWeapons(actor, head))];
  }

  /** Union of every bypass taking part in one attack. */
  function attackBypassDefense(actor, item) {
    const out = { armor: false, guard: false, reaction: false };
    for (const source of bypassSources(actor, item)) {
      const flags = bypassDefense(source);
      for (const axis of BYPASS_AXES) if (flags[axis]) out[axis] = true;
    }
    return out;
  }

  /**
   * What the defender may actually do, once the attacker's bypass and the defender's counter are
   * both accounted for. This is the only place that resolution is written — the defense dialog,
   * its damage maths and its warnings must all ask here, or they drift apart.
   *
   * The asymmetry is the rules text, not an oversight. 《마그넷 체인》《비호하는 짐승》《에너지 실드》 read
   * "「리액션을 실행할 수 없다」거나 「가드를 실행할 수 없다」는 효과를 가진 공격에 대해서도 **가드를**
   * 실행할 수 있다" — either bypassed axis opens the guard, and none of them opens the reaction.
   * Giving the reaction back is a different card: 《전지의 파편》 "…공격에 대해서도 **닷지를** 실행할 수
   * 있다". So a guard counter never substitutes for a reaction counter, or the other way round.
   *
   * @param {{armor: boolean, guard: boolean, reaction: boolean}} bypass  Frozen on the attacker's client.
   * @param {{armor: boolean, guard: boolean, reaction: boolean}} restore Declared by the defender.
   */
  function resolveDefense(bypass = {}, restore = {}) {
    const guardRestored = restore.guard === true && (bypass.guard === true || bypass.reaction === true);
    const reactionRestored = restore.reaction === true && bypass.reaction === true;
    return {
      // 《이지스 링》: "장갑치가 유효한 상태로 데미지를 산출한다".
      armorIgnored: bypass.armor === true && restore.armor !== true,
      guardBlocked: bypass.guard === true && !guardRestored,
      reactionBlocked: bypass.reaction === true && !reactionRestored,
      guardRestored,
      reactionRestored
    };
  }

  window.DX3rdItemEffectAdapter = {
    ACTIONS, DIRECT_TYPES, PARTIALS,
    isAttackItem, effectAttackBonus, mergeAttackBonuses, invocationAction, eventAction, inferAction, triggerFor,
    declaresActivationSelfModifiers, usesActivationSelfChannel, useMeansActivation, selfModifiersPending,
    collectImmediate, collectPersistent, prepareSheetContext, conditionEntries,
    extensionActionMatches, targetActionMatches, macroActionMatches, requiresTarget, requiresAnyTarget, extensionEntries,
    hasActionEffects, comboMemberAction, updateAction, toggleEffect, addEffect, deleteEffect, moveModifier,
    directTitle, isConfiguredCondition,
    // The persistent-effect buckets (card = channel × trigger action, each card with its own trigger and expiry timing)
    channelAction, attributeAction, selfChannelIsToggle, appliesWhileActive, hasExplicitBucket,
    actionCoversBucket,
    selfToggleBucketMatches,
    selfFrozenAttributes, selfBucketAttributes, hasFrozenSelfBucket, targetBucketAttributes, modifierBuckets, actionLabel,
    bucketLifecycle, modifierExecutionBuckets, selfFiresAt, targetFiresAt, bucketId, parseBucketId, freeBucketActions,
    addModifierBucket, deleteModifierBucket, moveModifierToBucket, updateModifierChannel,
    // Defence bypass (attacker) and its counter (defender)
    BYPASS_AXES, RESTORE_AXES, bypassDefense, restoreDefense, attackBypassDefense, resolveDefense
  };
})();
