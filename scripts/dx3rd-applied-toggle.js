// DX3rd Applied Toggle synchronization
// ---------------------------------------------------------------------------
// The dnd5e-style cleanup (Phase 2): toggling an "effect-like" item (effect/spell/psionic/combo)
// projects its persistent contribution onto a native ActiveEffect (an appliedKey AE). That way
//   (1) it shows up on the sheet's Applied tab (collect() reads appliedKey AEs — the top requirement), and
//   (2) the calculation reads the same source (_indexAppliedEffects), making it a single path.
// In exchange actor.js excludes these four types from its own computation (activeItems) to avoid double counting.
//
// Equipment (weapon/protect/vehicle), records (rois), items (connection) and the rest (once/etc) stay with the
// item's own computation (activeItems) — a pure stat change is not an AE.
//
// Freezing vs. following: AE payload.attributes holds "evaluated numbers" (because _indexAppliedEffects consumes
// an object-shaped value as-is). Formula following such as [level] is handled by re-setting on every
// updateActor/updateItem (inherited from the old mirror logic; a one-render lag at the moment of toggling is
// accepted — it self-heals).
//
// The appliedKey namespace is `toggle:<itemId>`. Only an item's own active.state creates that item's persistent AE.
// A combo projects only its own attributes as toggle:<comboId>; whether its member effects persist is managed by
// each effect's independent toggle.
(function () {

  const SCOPE = 'dx3rd-emanim';
  const KEY_PREFIX = 'toggle:';
  // Effect-likes (→AE). The rest (equipment/records/items/etc.) stay with actor.js's own computation.
  const TOGGLE_TYPES = ['effect', 'spell', 'psionic', 'combo'];

  /**
   * Does an item hook have to trigger an applied-toggle sync for this type?
   * A combo references its member effects, so an effect change syncs regardless of whether it is active.
   * Other types are never read by desiredPayloads(), so there is no need to re-scan the actor's whole set of
   * toggle effects on every equipment tweak, stocking change or rename.
   */
  function isToggleSourceItem(item) {
    return !!item && TOGGLE_TYPES.includes(item.type);
  }

  // Re-entrancy is guarded per actor. A global flag would make every other actor's sync skip while the first
  // actor holds it during a backfill or a concurrent sync (different actors must not interfere).
  // The in-flight sync Promise per actor. A follow-up call for the same actor does not bail out with false but
  // waits for the current work to finish. That guarantees the path where a combo turns an effect on and then
  // immediately reads the attack value does not read a number from before the AE landed.
  const syncing = new Map();

  /** Is this client the single party responsible for writing that actor's AEs (GM first, else the lowest-id owner)? */
  function isResponsible(actor) {
    const owners = game.users.filter(u => u.active && actor.testUserPermission?.(u, 'OWNER'));
    if (!owners.length) return game.user.isGM; // no active owning user → the GM handles it
    const gm = owners.find(u => u.isGM);
    const responsible = gm || owners.sort((a, b) => a.id.localeCompare(b.id))[0];
    return responsible?.id === game.user.id;
  }

  /** Convert an item's attributes into { storeKey: {key,label,value} } with the values frozen to evaluated numbers. */
  function evaluatedAttrs(item, actor) {
    const out = {};
    const map = item.system?.attributes;
    if (!map) return out;
    const EV = window.DX3rdFormulaEvaluator;
    const adapter = window.DX3rdItemEffectAdapter;
    for (const [storeK, a] of Object.entries(map)) {
      if (!a || a.key === undefined || a.key === null || a.key === '-') continue;
      // A modifier whose per-row "firing action" is authored as use/attack is not applied while the state is on;
      // it is applied as a frozen AE at that moment → excluding it from the toggle AE avoids double counting.
      if (adapter && !adapter.appliesWhileActive(item, a)) continue;
      // The sheet stores an empty row the user added (blank value) as-is. An empty value means there is no modifier
      // to apply — letting it through makes evaluate fall to 0 and leaves an item that is nothing but a "0 modifier"
      // (the same criterion as universal-apply's hasUsableAttribute). Presence-flag (boolean) rows are the exception,
      if (typeof a.value !== 'boolean' && String(a.value ?? '').trim() === '') continue;
      let value;
      if (typeof a.value === 'boolean') value = a.value;           // a presence flag (move_half and the like)
      else {
        const prepared = EV?.prepareRollFormula?.(a.value, item, actor) ?? String(a.value ?? '0');
        // A modifier that has to be rolled at action time keeps its original formula in the AE too.
        // The key list uses the single definition DX3rdFormulaEvaluator.ROLL_TIME_KEYS.
        value = EV?.isRollTimeKey?.(a.key) && EV?.hasDice?.(prepared)
          ? prepared
          : (Number(EV?.evaluate(a.value, item, actor)) || 0);
      }
      out[storeK] = { key: a.key, label: a.label ?? null, value };
    }
    return out;
  }

  /** Item → applied payload (values frozen at evaluation time). */
  function buildPayload(item, actor) {
    const desc = item.system?.effect?.description || item.system?.description || '';
    return {
      itemId: item.id,
      name: item.name,
      img: item.img,
      source: item.type,
      // The toggle's lifetime is managed by active.state → the AE itself is not subject to automatic disabling.
      disable: '-',
      description: desc,
      // Overlay defaults: token OFF / screen ON (a per-effect toggle in the effects tab edits it).
      showOnToken: false,
      showOnScreen: true,
      attributes: evaluatedAttrs(item, actor)
    };
  }

  /** Build the desired { appliedKey: payload } set from the actor's current independent toggle state. */
  function desiredPayloads(actor) {
    const desired = new Map();
    const add = (item) => {
      const key = `${KEY_PREFIX}${item.id}`;
      if (desired.has(key)) return;
      const payload = buildPayload(item, actor);
      // An item with no self modifiers (system.attributes) at all gets no AE.
      // A target-only effect (with only the target tab's system.effect.attributes filled in) still turns
      // active.state on when used (the activation paths that look only at the runTiming/disable gate —
      // handleItemUse, activateItem, the chat afterSuccess/afterDamage buttons). Turning that into a payload
      // as-is would put a dummy AE with zero values on the caster themselves.
      // The single source of the toggle state is item.system.active.state (not the AE's existence), so
      // dropping it here does not affect the active display or the combo persistence test.
      // Dummies that already exist are removed by syncPlan's toDelete on the next sync (self-heal).
      if (!Object.keys(payload.attributes).length) return;
      desired.set(key, payload);
    };
    const adapter = window.DX3rdItemEffectAdapter;
    const toggled = (actor.items || []).filter(i =>
      i.system?.active?.state === true
      && TOGGLE_TYPES.includes(i.type)
      // Old versions could leave active.state on for an onUse channel. That stale flag must remove
      // its old toggle AE, not keep projecting a modifier whose authored channel is now frozen.
      && (!adapter?.usesActivationSelfChannel || adapter.usesActivationSelfChannel(i)));
    for (const item of toggled) {
      add(item);
    }
    return desired;
  }

  // The paths under actor.system the formula evaluator (DX3rdFormulaEvaluator) reads while evaluating a payload are
  // only the attribute totals (body/sense/mind/social), the skill totals, encroachment.level and the applied map
  // feeding them (the legacy bridge — an applied write changes both totals and the effect_level bonus).
  // If only the paths below changed, a re-evaluation is guaranteed to be a complete no-op, so the whole sync is skipped.
  // This is a deliberately growing IGNORE list, not a whitelist: forgetting one costs a wasted resync, while a
  // forgotten whitelist entry would silently freeze payloads the day the evaluator learns a new token.
  //   · attributes.hp: the combat damage/heal hot path — no payload formula reads hp.
  //   · conditions: condition flags drive usage gates and token statuses, never formulas.
  //   · attributes.init/move/evasion/guard/armor/reduce/attack/critical/stock/saving/exp: derived combat displays —
  //     modifier rows target these keys, but no formula token resolves them.
  //   · description/details/emotions/actorType/codeName: sheet and bio data.
  const PAYLOAD_IRRELEVANT_SYSTEM = [
    'attributes.hp',
    'conditions',
    'description', 'details', 'emotions', 'actorType', 'codeName',
    'attributes.init', 'attributes.move', 'attributes.evasion',
    'attributes.guard', 'attributes.armor', 'attributes.reduce',
    'attributes.attack', 'attributes.critical',
    'attributes.stock', 'attributes.saving', 'attributes.exp'
  ];

  /** Can a change to changed.system affect the payload evaluation (false when only irrelevant paths changed)? */
  function systemChangeAffectsPayload(changed) {
    const sys = changed?.system;
    if (!sys) return false;
    const leaves = Object.keys(foundry.utils.flattenObject(sys));
    if (!leaves.length) return false;
    // '-=' marks a key deletion (e.g. 'attributes.-=hp') — strip it so deletions match the same path lists.
    return leaves.some(k => {
      const leaf = k.replace(/-=/g, '');
      return !PAYLOAD_IRRELEVANT_SYSTEM.some(p => leaf === p || leaf.startsWith(p + '.'));
    });
  }

  /** Do an existing AE's payload and the new payload differ materially (detecting formula following)? */
  function payloadChanged(eff, payload) {
    const prev = eff.getFlag?.(SCOPE, 'applied') || {};
    if (prev.name !== payload.name || prev.img !== payload.img) return true;
    if ((prev.disable || '-') !== (payload.disable || '-')) return true;
    return JSON.stringify(prev.attributes || {}) !== JSON.stringify(payload.attributes || {});
  }

  /** The plan for correcting one actor's toggle AEs. The read-only inspection and the actual application share it. */
  function syncPlan(actor) {
    const desired = desiredPayloads(actor);
    const existing = (actor.effects || []).filter(e =>
      String(e.getFlag?.(SCOPE, 'appliedKey') || '').startsWith(KEY_PREFIX));
    const existingByKey = new Map(existing.map(e => [e.getFlag(SCOPE, 'appliedKey'), e]));
    const toDelete = existing.filter(e => !desired.has(e.getFlag(SCOPE, 'appliedKey'))).map(e => e.id);
    const toSet = [];
    for (const [key, payload] of desired) {
      const eff = existingByKey.get(key);
      if (!eff || payloadChanged(eff, payload)) toSet.push([key, payload]);
    }
    return { toDelete, toSet };
  }

  /** Run a plan once. AE writes are batched (avoiding one re-derivation and re-render per item). */
  function runPlan(actor, { toDelete, toSet }) {
    return (async () => {
      try {
        if (toDelete.length) {
          await actor.deleteEmbeddedDocuments('ActiveEffect', toDelete, { render: false });
        }
        if (toSet.length) {
          // Re-evaluating the payload after an attribute/level change must not undo a temporary AE disable.
          if (window.DX3rdAppliedEffects.setMany) {
            await window.DX3rdAppliedEffects.setMany(actor, toSet, {preserveDisabled: true});
          } else {
            for (const [key, payload] of toSet) {
              await window.DX3rdAppliedEffects.set(actor, key, payload, {preserveDisabled: true});
            }
          }
        }
        return true;
      } catch (e) {
        console.error('DX3rd | applied-toggle sync 실패:', actor?.name, e);
        return false;
      }
    })();
  }

  // The cap on replanning passes. Normally two passes (wait for the in-flight one → replan on the latest state) converge.
  // A hook that arrives during a write is dropped by the hook guard below, so picking that change up is this
  // replanning pass's job — turning several combo members on at once can need one pass per member.
  const MAX_SYNC_PASSES = 6;

  /**
   * Upsert/remove the actor's toggle AE set to match the current toggle state.
   *
   * When a sync is in flight, "just waiting for it and finishing" is wrong — the plan (syncPlan) is fixed at its
   * start, so an effect turned on afterwards is not reflected. That gap became a real bug on the path where a combo
   * turns its member effects on one after another (combo-handler processInstantExtensions): only the first member's
   * sync was awaited before reading the attack value, so the remaining members' modifiers silently dropped out
   * (reproducing intermittently, depending on hook timing). → Wait for completion, then replan on the latest state.
   */
  async function sync(actor) {
    if (!actor) return false;
    if (actor.type !== 'character' && actor.type !== 'enemy') return false;
    if (!isResponsible(actor)) return false;
    if (!window.DX3rdAppliedEffects?.set) return false;

    // An explicit call is handling this actor right now, so a pending hook timer is unnecessary.
    // (Leaving it would be a no-op with an empty plan, but this avoids a needless replan right after a roll.)
    const pendingTimer = hookSyncTimers.get(actor.id);
    if (pendingTimer) {
      clearTimeout(pendingTimer);
      hookSyncTimers.delete(actor.id);
    }

    let changed = false;
    for (let pass = 0; pass < MAX_SYNC_PASSES; pass++) {
      const inflight = syncing.get(actor.id);
      if (inflight) {
        await inflight.catch(() => false);
        continue; // replan on the latest state
      }
      const plan = syncPlan(actor);
      if (!plan.toDelete.length && !plan.toSet.length) return changed; // no-op → prevents a hook cascade
      // The in-flight marker is set and cleared by this function. Clearing it inside runPlan would, when every
      // write returned synchronously, delete before set() and leave the marker in place forever.
      const task = runPlan(actor, plan);
      syncing.set(actor.id, task);
      try {
        changed = (await task) || changed;
      } finally {
        syncing.delete(actor.id);
      }
    }
    console.warn('DX3rd | applied-toggle sync did not settle within', MAX_SYNC_PASSES, 'passes:', actor?.name);
    return changed;
  }

  /**
   * An explicit full correction. No sweeping AE injection happens at world startup.
   * When old data needs repairing, the GM runs it from the console only, via
   * `window.DX3rdAppliedToggle.syncAll()`.
   */
  async function syncAll() {
    if (!game.user?.isGM) {
      ui.notifications?.warn('DX3rd | GM만 적용 효과 전체 보정을 실행할 수 있습니다.');
      return { scanned: 0, changed: 0 };
    }
    let scanned = 0;
    let changed = 0;
    for (const actor of game.actors) {
      if (actor.type !== 'character' && actor.type !== 'enemy') continue;
      scanned++;
      if (await sync(actor)) changed++;
    }
    window.DX3rdDebug.log(`DX3rd | AppliedToggle explicit sync: ${scanned} actors scanned, ${changed} changed.`);
    return { scanned, changed };
  }

  // ---------------------------------------------------------------------------
  // Auto-activating an "always" effect on acquisition
  //
  // Compendium items are all built with active.state=false (_source/build-effects.mjs). So importing an effect with
  // the "always" timing brings it in with its persistent modifier off, and unless the sheet checkbox is ticked by
  // hand, an effect the rules say is always on silently drops out. Worse, using that effect inside a combo turns it
  // on at activation time, so it looks as if it applied to that one use — which is observed as "it intermittently
  // fails to add up".
  //
  // The criterion must be identical to the one the sheet uses to draw the active toggle
  // (the single source actor-sheet-data usesSelfEffectActiveToggle). If they diverge, an item appears that is
  // auto-activated without even having a toggle.
  // The intervention happens exactly once, at creation — a state the user turned off stays off.
  // ---------------------------------------------------------------------------
  function isAlwaysOnCandidate(item) {
    if (!item || item.system?.active?.state === true) return false;
    // The sheet's toggle criterion is wider than the auto-activation criterion: an effect that authors its self
    // modifiers as 'activation' draws a toggle even when it is not always-on (it needs a channel to turn off again).
    // Turning those on by mere acquisition would fire an effect that has never been used → auto-activation applies
    // to always-on only. Only that case is excluded here; a Lois's always-on buff (no timing field) is left alone.
    const adapter = window.DX3rdItemEffectAdapter;
    const declaredActivation = adapter
      ? adapter.declaresActivationSelfModifiers(item)
      : (item.system?.active?.action === 'activation' || item.system?.active?.applyMode === 'toggle');
    if (declaredActivation && item.system?.timing !== 'always') return false;
    const predicate = window.DX3rdActorSheetData?.usesSelfEffectActiveToggle;
    if (typeof predicate !== 'function') return false;
    try {
      return !!predicate(item);
    } catch (e) {
      console.warn('DX3rd | always-on 판정 실패:', item?.name, e);
      return false;
    }
  }

  /** The per-actor always-on activation queue. Creations arriving in the same tick are turned on in one batch. */
  const alwaysOnPending = new Map();

  function ownedItemById(actor, id) {
    return actor.items?.get?.(id) ?? (actor.items || []).find?.(item => item.id === id) ?? null;
  }

  /**
   * Queue an always-on candidate and return true. An actor import or a multi-drag from a compendium fires createItem
   * once per item, so updating them one at a time would cost that many DB round trips plus re-derivations.
   */
  function queueAlwaysOn(item) {
    const actor = item?.parent;
    if (!actor || actor.documentName !== 'Actor') return false;
    if (actor.type !== 'character' && actor.type !== 'enemy') return false;
    if (!isAlwaysOnCandidate(item)) return false;
    if (!isResponsible(actor)) return false;

    let entry = alwaysOnPending.get(actor.id);
    if (!entry) {
      entry = { actor, ids: new Set() };
      alwaysOnPending.set(actor.id, entry);
      Promise.resolve().then(() => flushAlwaysOn(actor.id));
    }
    entry.ids.add(item.id);
    return true;
  }

  async function flushAlwaysOn(actorId) {
    const entry = alwaysOnPending.get(actorId);
    if (!entry) return 0;
    alwaysOnPending.delete(actorId);

    // An item deleted or manually activated after being queued drops out here.
    const updates = [...entry.ids]
      .map(id => ownedItemById(entry.actor, id))
      .filter(item => isAlwaysOnCandidate(item))
      .map(item => ({ _id: item.id, 'system.active.state': true }));
    if (!updates.length) return 0;
    try {
      await entry.actor.updateEmbeddedDocuments('Item', updates);
      window.DX3rdDebug.log('DX3rd | always-on effects auto-activated:', updates.length, '→', entry.actor.name);
      return updates.length;
    } catch (e) {
      console.error('DX3rd | always-on 자동 활성화 실패:', entry.actor?.name, e);
      return 0;
    }
  }

  /**
   * A bulk correction for always-on effects imported already switched off.
   * It does not run automatically — the GM runs it from the console via
   * `window.DX3rdAppliedToggle.activateAlwaysOn()` (all) or
   * `window.DX3rdAppliedToggle.activateAlwaysOn(actor)` (a single actor).
   */
  async function activateAlwaysOn(actor = null) {
    const actors = actor ? [actor] : Array.from(game.actors || []);
    if (!actor && !game.user?.isGM) {
      ui.notifications?.warn('DX3rd | GM만 상시 이펙트 전체 보정을 실행할 수 있습니다.');
      return { scanned: 0, activated: 0 };
    }
    let scanned = 0;
    let activated = 0;
    for (const a of actors) {
      if (a.type !== 'character' && a.type !== 'enemy') continue;
      const targets = (a.items || []).filter(isAlwaysOnCandidate);
      scanned += targets.length;
      if (!targets.length) continue;
      if (!isResponsible(a)) continue;
      try {
        // Turning items on one at a time runs that many re-derivations and hooks → one batch per actor.
        await a.updateEmbeddedDocuments('Item', targets.map(i => ({ _id: i.id, 'system.active.state': true })));
        activated += targets.length;
      } catch (e) {
        console.error('DX3rd | 상시 이펙트 일괄 활성화 실패:', a?.name, e);
        continue;
      }
      await sync(a);
    }
    console.log(`DX3rd | AlwaysOn repair: ${activated}/${scanned} effects activated.`);
    return { scanned, activated };
  }

  /** A read-only full inspection for the GM settings menu. */
  function auditAll() {
    const result = { scanned: 0, actors: 0, createOrUpdate: 0, remove: 0, rows: [] };
    for (const actor of game.actors) {
      if (actor.type !== 'character' && actor.type !== 'enemy') continue;
      result.scanned++;
      const { toDelete, toSet } = syncPlan(actor);
      if (!toDelete.length && !toSet.length) continue;
      result.actors++;
      result.createOrUpdate += toSet.length;
      result.remove += toDelete.length;
      result.rows.push({ actor, createOrUpdate: toSet.length, remove: toDelete.length });
    }
    return result;
  }

  // ---------------------------------------------------------------------------
  // Hook-triggered syncs are coalesced briefly (one timer per actor).
  //
  // A combo awaits its member effects one at a time, so syncing immediately from the hook writes one AE per item
  // (measured: 3 members = create ActiveEffect ×3 = 3 round trips + 3 re-derivations). Deferring briefly gathers
  // those writes into the combo's single explicit `await sync(actor)` (combo-handler), making it one setMany batch.
  // An explicit call runs immediately with no delay, so the guarantee right before a roll is unchanged — a hook sync
  // was fire-and-forget from the start, and nothing waits on its completion.
  // ---------------------------------------------------------------------------
  const HOOK_SYNC_DELAY_MS = 50;
  const hookSyncTimers = new Map();

  function requestSync(actor) {
    if (!actor) return;
    const prev = hookSyncTimers.get(actor.id);
    if (prev) clearTimeout(prev);
    hookSyncTimers.set(actor.id, setTimeout(() => {
      hookSyncTimers.delete(actor.id);
      sync(actor);
    }, HOOK_SYNC_DELAY_MS));
  }

  Hooks.on('updateActor', (actor, changed) => {
    // The payload references only actor.system stats/skills/level (evaluatedAttrs). A change outside system
    // (flags/token/name/image/ownership) cannot affect the payload, so the re-evaluation is skipped
    // — removing the cost of recomputing all of desiredPayloads on hot paths such as token movement or flag updates.
    // The toggle state (active.state) lives on the item and is handled by the updateItem hook, so nothing is missed here.
    if (!foundry.utils.hasProperty(changed, 'system')) return;
    // A change touching only irrelevant paths (e.g. attributes.hp) would re-evaluate to a complete no-op → skip (removes the combat HP hot path).
    if (!systemChangeAffectsPayload(changed)) return;
    requestSync(actor);
  });
  Hooks.on('updateItem', (item) => {
    const a = item.parent;
    if (isToggleSourceItem(item) && a?.documentName === 'Actor') requestSync(a);
  });
  Hooks.on('createItem', (item) => {
    const a = item.parent;
    if (a?.documentName !== 'Actor') return;
    // An always-on effect has to be on from acquisition alone. The updateItem hook carries the AE projection afterwards.
    if (queueAlwaysOn(item)) return;
    if (isToggleSourceItem(item)) requestSync(a);
  });
  Hooks.on('deleteItem', (item) => {
    const a = item.parent;
    if (isToggleSourceItem(item) && a?.documentName === 'Actor') requestSync(a);
  });
  // No sweep over every actor creating and deleting AEs during world startup.
  // Later item/actor change hooks sync just the actor that needs it, immediately.
  Hooks.once('ready', () => window.DX3rdDebug.log('DX3rd | AppliedToggle startup sweep skipped; explicit repair is available.'));

  window.DX3rdAppliedToggle = { SCOPE, KEY_PREFIX, TOGGLE_TYPES, sync, syncAll, auditAll, desiredPayloads, isResponsible, activateAlwaysOn, isAlwaysOnCandidate };

  window.DX3rdDebug.log('DX3rd | AppliedToggle sync loaded');
})();
