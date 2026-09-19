// DX3rd Applied Effects adapter
// ---------------------------------------------------------------------------
// The facade for migrating the storage of applied effects (buffs) to native ActiveEffect documents.
// Every applied write / read / removal passes through this one place.
//
// Design principles (approach A):
//  - source of truth = one ActiveEffect document embedded on the actor (= one applied buff).
//  - The lossless original for the DX3rd calculation is kept verbatim as the payload in flags["dx3rd-emanim"].applied.
//    → prepareData (actor.js) consumes the legacy { [key]: payload } map that collect() rebuilds, through the
//       existing _indexAppliedEffects (calculation logic unchanged, single path).
//  - changes[] is always built with mode: CUSTOM. Unless an applyActiveEffect hook handler is registered, core
//    does not modify actor data at all for a CUSTOM change → the risk of double application (core auto-apply +
//    flag calculation) is eliminated at the root.
//    At the same time the changes array (v14: system.changes) stays on the document for external automation
//    modules to read (visibility only).
//  - Token overlay: showIcon=ALWAYS makes core (Token#_drawEffects) always render img on the token.
(function () {

  const SCOPE = 'dx3rd-emanim';
  const SYNTH_STATUS = 'dx3rd-applied'; // a unique synthetic status per appliedKey (exposed on actor.statuses, prevents icon merging)

  // The v14 change spec: numeric modes are deprecated (accessing CONST.ACTIVE_EFFECT_MODES warns) and replaced by
  // a string type (EffectChangeData#type, validated as /^[a-z0-9]+$/ or custom.{n}).
  // With no applyActiveEffect handler in core, 'custom' does not touch actor data, so there is no risk of double
  // application (core auto-apply + flag calculation). The calculation is the single flag path; changes is visibility only.
  const CHANGE_TYPE_CUSTOM = 'custom';

  // A key that is not roll-only and does have a document path → a change.key mapping for external readability.
  // (The mode is CUSTOM so it is never actually used; it only makes change.key pleasant for a human or a module to read.)
  const READABLE_PATH = {
    hp: 'system.attributes.hp.max',
    hp_max: 'system.attributes.hp.max',
    armor: 'system.attributes.armor.value',
    guard: 'system.attributes.guard.value',
    init: 'system.attributes.init.value',
    initiative: 'system.attributes.init.value',
    move: 'system.attributes.move.battle',
    move_battle: 'system.attributes.move.battle',
    battleMove: 'system.attributes.move.battle',
    move_full: 'system.attributes.move.full',
    fullMove: 'system.attributes.move.full',
    saving_max: 'system.attributes.saving.max',
    // stock_point is not a one-off change to the current resource points but a derived base resource-point bonus.
    stock_point: 'system.attributes.stock.base',
    attack: 'system.attributes.attack.value',
    effect_level: `flags.${SCOPE}.effectLevelBonus`
  };

  const ACTIVE_EFFECT_CLS = () =>
    foundry.documents?.ActiveEffect ?? globalThis.ActiveEffect;

  /** Build changes[] from attributes (a mix of object form {key,label,value} and raw form {dice:-5}). */
  function buildChanges(attributes = {}) {
    const changes = [];
    for (const [attrName, attrValue] of Object.entries(attributes || {})) {
      const isObj = (typeof attrValue === 'object' && attrValue !== null);
      const key = isObj ? attrValue.key : attrName;
      const label = isObj ? attrValue.label : null;
      const val = (isObj && 'value' in attrValue) ? attrValue.value : attrValue;
      if (key === undefined || key === null || key === '-') continue;

      // A human-readable change.key (the document path when there is one, else the dx3rd namespace)
      const readable = READABLE_PATH[key]
        || (label ? `flags.${SCOPE}.applied.${key}.${label}` : `flags.${SCOPE}.applied.${key}`);

      changes.push({
        key: readable,
        type: CHANGE_TYPE_CUSTOM, // not applied by core (no handler registered), visibility only
        value: String(val ?? ''),
        priority: 20
      });
    }
    return changes;
  }

  /** Normalize a payload (guarding against missing fields). */
  function normalizePayload(payload = {}) {
    return {
      itemId: payload.itemId ?? null,
      // Which modifier bucket did it come from? 'self' = system.attributes (a frozen self buff, lifetime active.disable),
      // anything else / unstated = system.effect.attributes (a target modifier, lifetime effect.disable).
      // This is a whitelist, so a field missing here is not stored on the flag → the channel distinction vanishes entirely.
      channel: payload.channel === 'self' ? 'self' : 'target',
      // Which firing-action bucket within the channel? The channel's default bucket is null (keeping the legacy key),
      // and every other bucket carries its own action and uses a separate key (applied_act_/use_/atk_<id>).
      // This is a whitelist, so a field missing here is not stored on the flag → different buckets are treated as the
      // same AE, the later one overwrites the earlier one, and the expiry hooks cannot find the bucket's lifetime.
      action: ['activation', 'use', 'attack'].includes(payload.action) ? payload.action : null,
      name: payload.name || game.i18n.localize('DX3rd.Applied'),
      img: payload.img || 'icons/svg/aura.svg',
      source: payload.source || '',
      timestamp: payload.timestamp ?? Date.now(),
      disable: payload.disable || '-',
      description: payload.description || '',
      // The overlay display distinguishes token from screen (a per-effect toggle in the effects tab edits it).
      //  - showOnToken: the icon on the token. OFF by default (projected through showIcon).
      //  - showOnScreen: the game screen's top-right HUD. ON by default.
      showOnToken: payload.showOnToken ?? false,
      showOnScreen: payload.showOnScreen ?? true,
      attributes: payload.attributes || {}
    };
  }

  /** Assemble the ActiveEffect creation data. */
  function buildAEData(actor, appliedKey, payload) {
    const p = normalizePayload(payload);
    return {
      name: p.name,
      img: p.img,
      description: p.description,
      disabled: false,
      // In v14 the token icon render test is not isTemporary but effect.showIcon
      // (Token#_drawEffects → appliedEffects.filter: showIcon===ALWAYS, or
      //  showIcon===CONDITIONAL && isTemporary). An applied buff is not duration-based, so CONDITIONAL would never
      //  draw it. → The overlay display is a per-effect choice (OFF by default):
      //  showOnToken means ALWAYS (an icon on the token), otherwise NEVER (still listed on the effects tab).
      //  img comes from effect.img, so registering in CONFIG.statusEffects is unnecessary. (Verified on v14.364.)
      showIcon: p.showOnToken
        ? (CONST.ACTIVE_EFFECT_SHOW_ICON?.ALWAYS ?? 2)
        : (CONST.ACTIVE_EFFECT_SHOW_ICON?.NEVER ?? 0),
      // A unique synthetic status per appliedKey → prevents icon merging and exposes it on actor.statuses (visibility only).
      statuses: [`${SYNTH_STATUS}-${appliedKey}`],
      origin: p.itemId ? `${actor.uuid}.Item.${p.itemId}` : actor.uuid,
      // v14: the change array lives at system.changes rather than top-level (the base AE data model).
      // The effect.changes getter returns system.changes, so external-module readability is preserved.
      system: { changes: buildChanges(p.attributes) },
      flags: {
        [SCOPE]: {
          appliedKey,     // the upsert matching key, and the key collect rebuilds from
          applied: p       // the lossless original for the calculation
        }
      }
    };
  }

  /** Find the applied ActiveEffect document for the given key. */
  function getEffect(actor, appliedKey) {
    if (!actor) return null;
    return actor.effects.find(e => e.getFlag?.(SCOPE, 'appliedKey') === appliedKey) || null;
  }

  /** Find every applied AE created from a particular source item. */
  function getEffectsByItem(actor, itemId) {
    if (!actor || !itemId) return [];
    const onUseKey = `applied_${itemId}`;
    const selfKey = `applied_self_${itemId}`;
    const toggleKey = `toggle:${itemId}`;
    const originSuffix = `.Item.${itemId}`;
    return actor.effects.filter(effect => {
      const appliedKey = effect.getFlag?.(SCOPE, 'appliedKey');
      const sourceItemId = effect.getFlag?.(SCOPE, 'applied')?.itemId;
      // Check the latest payload, the past appliedKey and the Foundry origin, all three.
      // That way an old AE missing one of those fields — activated → deactivated → reactivated — is not left behind.
      return sourceItemId === itemId
        || appliedKey === onUseKey
        || appliedKey === selfKey
        || appliedKey === toggleKey
        || String(effect.origin || '').endsWith(originSuffix);
    });
  }

  /** Find the keys of a particular source item among the transitional legacy system.attributes.applied. */
  function getLegacyAppliedKeysByItem(actor, itemId) {
    if (!actor || !itemId) return [];
    const legacy = actor.system?.attributes?.applied;
    if (!legacy || typeof legacy !== 'object') return [];
    const onUseKey = `applied_${itemId}`;
    const toggleKey = `toggle:${itemId}`;
    return Object.entries(legacy)
      .filter(([key, payload]) => key === onUseKey
        || key === toggleKey
        || payload?.itemId === itemId
        || String(payload?.origin || '').endsWith(`.Item.${itemId}`))
      .map(([key]) => key);
  }

  /**
   * The update data that overwrites an existing AE with a new payload. Shared by set/setMany.
   * flags are deep-merged on a document update. So that an attribute key removed by editing (e.g. a0) does not
   * linger and get applied twice, an existing key absent from the new payload is explicitly deleted.
   */
  function buildUpdateData(existing, data, preserveDisabled) {
    const prevAttrs = existing.getFlag(SCOPE, 'applied')?.attributes || {};
    const nextAttrs = data.flags[SCOPE].applied.attributes || {};
    const attrDeletions = {};
    for (const k of Object.keys(prevAttrs)) {
      if (!(k in nextAttrs)) attrDeletions[`flags.${SCOPE}.applied.attributes.-=${k}`] = null;
    }
    return {
      name: data.name,
      img: data.img,
      description: data.description,
      // Re-evaluating a toggle effect's formulas (sync) must not change a temporary disabled state.
      // An ordinary set call activates on update, as it always has.
      disabled: preserveDisabled ? existing.disabled : false,
      showIcon: data.showIcon,
      statuses: data.statuses,
      'system.changes': data.system.changes,
      [`flags.${SCOPE}.applied`]: data.flags[SCOPE].applied,
      ...attrDeletions
    };
  }

  /**
   * Two set()/setMany() calls for the same key can both pass the getEffect check before either create resolves and
   * end up creating twin AEs. One deterministic survivor is kept — the lowest document id, so every client agrees —
   * and every other document carrying the key is deleted (also sweeping strays left by an earlier race).
   * Returns the surviving documents for keys this call created.
   */
  async function dropAppliedKeyTwins(actor, appliedKeys) {
    const keys = new Set(appliedKeys);
    const byKey = new Map();
    for (const e of actor.effects) {
      const k = e.getFlag?.(SCOPE, 'appliedKey');
      if (!keys.has(k)) continue;
      const list = byKey.get(k);
      if (list) list.push(e);
      else byKey.set(k, [e]);
    }
    const survivors = new Map();
    const losers = [];
    for (const [k, list] of byKey) {
      if (!list.length) continue;
      list.sort((a, b) => (String(a.id) < String(b.id) ? -1 : (String(a.id) > String(b.id) ? 1 : 0)));
      survivors.set(k, list[0]);
      losers.push(...list.slice(1));
    }
    if (losers.length) {
      try {
        // A loser may be hosting an item-grant marker (adoptOrphanGrants merges markers into a matching AE);
        // rehome it first so the creation survives the duplicate cleanup.
        await rehomeGrants(actor, losers);
        await actor.deleteEmbeddedDocuments('ActiveEffect', losers.map(e => e.id));
      } catch (e) {
        console.warn('DX3rd | DX3rdAppliedEffects duplicate cleanup failed:', e);
      }
    }
    return survivors;
  }

  /** Create or update (upsert) an applied buff. */
  async function set(actor, appliedKey, payload, {preserveDisabled = false} = {}) {
    if (!actor || !appliedKey) return null;
    const data = buildAEData(actor, appliedKey, payload);
    const existing = getEffect(actor, appliedKey);
    try {
      if (existing) {
        await existing.update(buildUpdateData(existing, data, preserveDisabled));
        return existing;
      }
      await actor.createEmbeddedDocuments('ActiveEffect', [data]);
      // The create may have raced another set() for the same key — keep the deterministic survivor.
      const survivors = await dropAppliedKeyTwins(actor, [appliedKey]);
      return survivors.get(appliedKey) || null;
    } catch (e) {
      console.error('DX3rd | DX3rdAppliedEffects.set 실패:', appliedKey, e);
      return null;
    }
  }

  /**
   * Upsert several applied buffs in two DB round trips (one update + one create). It uses the same assembly as set().
   * On a path that turns several effects on at once, such as a combo, writing the AEs one at a time cascades that
   * many actor re-derivations and sheet re-renders into visible stutter.
   * @param {Actor} actor
   * @param {Array<[string, object]>} entries - an array of [appliedKey, payload] pairs
   * @returns {Promise<number>} the number of writes (updates + creations)
   */
  async function setMany(actor, entries = [], {preserveDisabled = false} = {}) {
    if (!actor || !entries?.length) return 0;
    const creates = [];
    const updates = [];
    const seenKeys = new Set();
    for (const [appliedKey, payload] of entries) {
      // A repeated key inside one batch would create twins — the first write wins.
      if (!appliedKey || seenKeys.has(appliedKey)) continue;
      seenKeys.add(appliedKey);
      const data = buildAEData(actor, appliedKey, payload);
      const existing = getEffect(actor, appliedKey);
      if (existing) updates.push({ _id: existing.id, ...buildUpdateData(existing, data, preserveDisabled) });
      else creates.push(data);
    }
    try {
      if (updates.length) await actor.updateEmbeddedDocuments('ActiveEffect', updates);
      if (creates.length) {
        await actor.createEmbeddedDocuments('ActiveEffect', creates);
        // The creates may have raced another set()/setMany() for the same keys — keep the deterministic survivors.
        await dropAppliedKeyTwins(actor, creates.map(d => d.flags?.[SCOPE]?.appliedKey).filter(Boolean));
      }
      return updates.length + creates.length;
    } catch (e) {
      console.error('DX3rd | DX3rdAppliedEffects.setMany 실패:', e);
      return 0;
    }
  }

  /** Remove the applied buff for the given key. */
  async function remove(actor, appliedKey, {keepGrants = true} = {}) {
    const eff = getEffect(actor, appliedKey);
    if (!eff) return false;
    // Default: what this item created keeps its own lifetime (see rehomeGrants). The sheet's remove button
    // cascades instead, by deleting the item's grants itself after this returns.
    if (keepGrants) await rehomeGrants(actor, [eff]);
    try {
      await eff.delete();
      return true;
    } catch (e) {
      console.error('DX3rd | DX3rdAppliedEffects.remove 실패:', appliedKey, e);
      return false;
    }
  }

  /** Set an applied buff's active/inactive (disabled) state. The dnd5e-style toggle source. */
  async function setDisabled(actor, appliedKey, disabled) {
    const eff = getEffect(actor, appliedKey);
    if (!eff) return false;
    try {
      await eff.update({ disabled: !!disabled });
      return true;
    } catch (e) {
      console.error('DX3rd | DX3rdAppliedEffects.setDisabled 실패:', appliedKey, e);
      return false;
    }
  }

  /** Invert an applied buff's active/inactive state. */
  async function toggleDisabled(actor, appliedKey) {
    const eff = getEffect(actor, appliedKey);
    if (!eff) return false;
    return setDisabled(actor, appliedKey, !eff.disabled);
  }

  // ---------------------------------------------------------------------------
  // Unified control of the "single source" of active/inactive.
  //  · The real state of a toggle-derived AE (appliedKey='toggle:<itemId>') is the source item's system.active.state
  //    (the applied-toggle sync derives / deletes the AE from it). So the checkbox / HUD flips the item toggle
  //    directly rather than AE.disabled → no dual state. Turning it off makes sync delete the AE, so it disappears
  //    from the list / HUD (the normal behaviour of a toggle effect).
  //  · Even when there is a source item, only one whose active.state is the actual state (the activation channel)
  //    flips the item. A frozen channel (applied_self_<itemId>, applyMode='onUse') has active.state false even while
  //    it is on, so routing through the item reads the state backwards → toggleActive always decides "turn on",
  //    creating one more toggle AE (the same modifier counted twice) and making it impossible to ever turn off.
  //    Here the AE's own disabled is the single source.
  //  · A standalone buff with no source (Panic, a macro, …) also toggles the AE's own disabled.
  //  · A toggle AE whose source item is gone falls back to AE.disabled.
  // ---------------------------------------------------------------------------

  /**
   * Return the source item that represents the state of an appliedKey (null when there is none → AE.disabled is the state).
   * A 'toggle:' derivation is by definition stated by its item; any other AE qualifies only when it came from an item
   * whose self-modifier channel is 'activation' (equipment is excluded, because the equipped checkbox is its source — useMeansActivation).
   */
  function getToggleSourceItem(actor, appliedKey) {
    const key = String(appliedKey || '');
    if (key.startsWith('toggle:')) return actor?.items?.get(key.slice('toggle:'.length)) || null;
    const itemId = getEffect(actor, key)?.getFlag?.(SCOPE, 'applied')?.itemId;
    const item = actor?.items?.get(itemId) || null;
    if (!item) return null;
    return window.DX3rdItemEffectAdapter?.useMeansActivation?.(item) ? item : null;
  }

  /** Set an applied effect active/inactive (single-source routing). */
  async function setActive(actor, appliedKey, active) {
    const item = getToggleSourceItem(actor, appliedKey);
    if (item) {
      const svc = window.DX3rdActorSheetData?.updateOwnedItemActiveState;
      if (svc) await svc(actor, item.id, !!active);            // the same path as the effect tab's checkbox
      else await item.update({ 'system.active.state': !!active });
      return true;
    }
    return setDisabled(actor, appliedKey, !active);
  }

  /** Invert an applied effect's active/inactive state (single-source routing). */
  async function toggleActive(actor, appliedKey) {
    const item = getToggleSourceItem(actor, appliedKey);
    if (item) return setActive(actor, appliedKey, !(item.system?.active?.state));
    const eff = getEffect(actor, appliedKey);
    if (!eff) return false;
    return setDisabled(actor, appliedKey, !eff.disabled);
  }

  /**
   * An equipment-change grant may be riding on the AE about to be deleted (one item = one AE, so the modifier
   * effect and the marker for what that item created share a document). Their **lifetimes** are not shared,
   * though — a buff can expire at the end of a major action while the weapon it made lasts the scene — so an
   * automatic removal hands the payload to a standalone marker first. Only the sheet's explicit remove cascades.
   */
  async function rehomeGrants(actor, effects) {
    const H = window.DX3rdUniversalHandler;
    if (!H?.grantPayload) return;
    for (const effect of effects) {
      if (H.grantPayload(effect)) await H.rehomeGrant(actor, effect);
    }
  }

  /** Remove several keys at once (batched). */
  async function removeMany(actor, appliedKeys = []) {
    if (!actor || !appliedKeys.length) return 0;
    const ids = [];
    const effects = [];
    for (const k of appliedKeys) {
      const eff = getEffect(actor, k);
      if (eff) { ids.push(eff.id); effects.push(eff); }
    }
    if (!ids.length) return 0;
    await rehomeGrants(actor, effects);
    try {
      await actor.deleteEmbeddedDocuments('ActiveEffect', ids);
      return ids.length;
    } catch (e) {
      console.error('DX3rd | DX3rdAppliedEffects.removeMany 실패:', e);
      return 0;
    }
  }

  /**
   * Remove every applied buff originating from a particular item.
   * `keepGrants` (the default) protects what that item created: this runs on ordinary lifecycle events
   * (deactivating, expiry), which must not destroy a creation that has its own lifetime. The sheet's remove
   * button passes false, because there the user is deleting the effect and everything it made.
   */
  async function removeByItem(actor, itemId, {includeToggle = true, keepGrants = true} = {}) {
    if (!actor || !itemId) return 0;
    const targets = getEffectsByItem(actor, itemId)
      .filter(effect => includeToggle || !String(effect.getFlag?.(SCOPE, 'appliedKey') || '').startsWith('toggle:'));
    if (keepGrants) await rehomeGrants(actor, targets.filter(effect => effect.getFlag?.(SCOPE, 'appliedKey')));
    const ids = targets.map(effect => effect.id);
    let removed = 0;
    // An active.state change and the AppliedToggle sync can happen in the same frame.
    // Re-checking each document and deleting individually makes an AE another path already deleted a normal no-op.
    for (const id of ids) {
      if (!actor.effects.get(id)) continue;
      try {
        await actor.deleteEmbeddedDocuments('ActiveEffect', [id]);
        removed++;
      } catch (e) {
        if (!/does not exist/i.test(String(e?.message || e))) {
          console.error('DX3rd | DX3rdAppliedEffects.removeByItem 실패:', itemId, e);
        }
      }
    }

    // Also clear the applied values from before the migration to native AEs. Leaving them means prepareData's
    // transition bridge reads them again even with no AE, so the HP / attribute modifiers linger.
    const legacyKeys = getLegacyAppliedKeysByItem(actor, itemId)
      .filter(key => includeToggle || key !== `toggle:${itemId}`);
    if (legacyKeys.length) {
      const deletions = Object.fromEntries(
        legacyKeys.map(key => [`system.attributes.applied.-=${key}`, null])
      );
      try {
        await actor.update(deletions);
        removed += legacyKeys.length;
      } catch (e) {
        console.error('DX3rd | DX3rdAppliedEffects.removeByItem 레거시 applied 정리 실패:', itemId, e);
      }
    }
    return removed;
  }

  /**
   * Rebuild the actor's applied ActiveEffects into the legacy { [appliedKey]: payload } map.
   * prepareData / the sheets / disable-hooks consume it in exactly the shape they always have.
   * Transition bridge: a legacy system.attributes.applied not yet migrated to an AE is merged in (the AE wins).
   */
  function collect(actor) {
    const out = {};
    if (!actor) return out;
    // appliedKey can appear on twin AEs for a moment while a concurrent-create race is being swept
    // (dropAppliedKeyTwins keeps the lowest document id) — prefer that same winner here.
    const winnerId = new Map();
    for (const e of actor.effects) {
      const key = e.getFlag?.(SCOPE, 'appliedKey');
      if (!key) continue;
      const payload = e.getFlag?.(SCOPE, 'applied');
      if (!payload) continue;
      const prev = winnerId.get(key);
      if (prev !== undefined && String(e.id) >= String(prev)) continue;
      winnerId.set(key, e.id);
      // Carry the AE's disabled state shallowly on a copy of the payload (avoiding polluting the original flag).
      //  · _indexAppliedEffects excludes _disabled === true from the calculation.
      //  · The sheet's Applied list / HUD shows the toggle state from _disabled.
      //  · normalizePayload is a whitelist, so _disabled is never stored back onto the flag.
      out[key] = { ...payload, _disabled: !!e.disabled };
    }
    // Transition bridge: in a fully migrated world the legacy field is deleted (undefined) or an empty {}, so this
    // is usually skipped. The early exit avoids a needless traversal and allocation on the prepareData hot path.
    const legacy = actor.system?.attributes?.applied;
    if (legacy && typeof legacy === 'object') {
      for (const k of Object.keys(legacy)) {
        if (k in out) continue;
        const v = legacy[k];
        if (v && typeof v === 'object') out[k] = v;
      }
    }
    return out;
  }

  window.DX3rdAppliedEffects = {
    SCOPE,
    SYNTH_STATUS,
    buildChanges,
    buildAEData,
    getEffect,
    getEffectsByItem,
    set,
    setMany,
    setDisabled,
    toggleDisabled,
    getToggleSourceItem,
    setActive,
    toggleActive,
    remove,
    removeMany,
    removeByItem,
    collect
  };

  // A left click on the token HUD's effect overlay deletes the ActiveEffect through Foundry's default behaviour.
  // Only applied AEs are intercepted, inverting disabled exactly like the actor sheet's applied-effect checkbox.
  // An ordinary status effect keeps Foundry's default behaviour.
  Hooks.on('renderTokenHUD', (hud, html) => {
    const root = html instanceof HTMLElement ? html : html?.[0];
    if (!root || root.dataset.dx3rdAppliedOverlayBound) return;
    root.dataset.dx3rdAppliedOverlayBound = 'true';

    root.addEventListener('click', async (event) => {
      const control = event.target.closest?.('.effect-control');
      if (!control) return;

      const actor = hud.object?.actor;
      if (!actor?.isOwner) return;
      const effectId = control.dataset.effectId;
      const statusId = control.dataset.statusId;
      const effect = (effectId ? actor.effects.get(effectId) : null)
        || (statusId ? actor.effects.find(e => e.statuses?.has(statusId)) : null);
      const appliedKey = effect?.getFlag?.(SCOPE, 'appliedKey');
      if (!appliedKey) return;

      // Blocked in the capture phase so Foundry's delete handler never runs.
      event.preventDefault();
      event.stopImmediatePropagation();
      await setDisabled(actor, appliedKey, !effect.disabled);
    }, true);
  });

  window.DX3rdDebug.log('DX3rd | AppliedEffects adapter loaded');
})();
