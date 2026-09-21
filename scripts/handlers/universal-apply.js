// Universal handler - the target effect application (applyToTargets) & defense reaction candidate cluster
// Split out of universal-handler.js. It MUST load after that file and mixes into the same object.
// (applyToTargets / _applyItemAttributes / applySelfFrozenBuff / applySelfModifiers /
//  applyChosenItemEffect / applyEffectData / _applyEffectDataToActor /
//  _cleanDefenseReactionName / _getEffectsCompendiumIndex / _isDefenseReactionCandidate /
//  getDefenseReactionItems / _getDefaultDodgeRollData)
(function() {
  if (!window.DX3rdUniversalHandler) {
    console.error('DX3rd | universal-apply.js loaded before universal-handler.js; apply methods unavailable.');
    return;
  }

  Object.assign(window.DX3rdUniversalHandler, {
    /**
     * Is this an attribute map with at least one value to actually apply?
     * The sheet stores the empty rows a user added (key '-' / blank value) as-is, so "there are rows"
     * does not mean there is anything to apply. Without this distinction, using an effect that only
     * buffs the user (its target tab is empty) on a target through a combo would drape an empty,
     * modifier-less AE (a dummy) over that target.
     * @param {Object} attributes - system.effect.attributes or system.attributes
     * @returns {boolean}
     */
    hasUsableAttribute(attributes) {
      return Object.values(attributes || {}).some(attribute =>
        attribute?.key && attribute.key !== '-' && String(attribute.value ?? '').trim() !== ''
      );
    },

    /**
     * Apply item effects to targeted actors if conditions are met.
     * Conditions: system.getTarget is true AND system.effect.disable !== 'notCheck'
     * @param {Actor} actor - The actor using the item
     * @param {Item} item - The item being used
     * @param {string} timing - the execution timing ('instant', 'afterSuccess', 'afterDamage')
     * @param {Array} forcedTargets - a forced target list (optional, an array of Actor objects)
     */
    async applyToTargets(actor, item, timing = 'instant', forcedTargets = null, action = null, opts = {}) {
      try {
        const adapter = window.DX3rdItemEffectAdapter;
        if (adapter && !adapter.targetActionMatches(item, action, timing)) return;
        // The action of the bucket to apply at the current trigger action. When a row's own "trigger action"
        // is authored differently from the channel default, only rows with the action chosen here reach the target.
        const bucketAction = adapter
          ? (adapter.ACTIONS.has(action) ? action : adapter.eventAction(item, timing))
          : action;

        // Is either getTarget or scene checked?
        const getTarget = item.system?.getTarget || false;
        const scene = item.system?.scene || false;
        if (!getTarget && !scene) return;

        // The trigger and expiry timing come from **that bucket's** values. Gating on the single channel field
        // (system.effect.runTiming) means that when a use bucket and an attack bucket share one channel, one of
        // them can never fire and dies silently (see the bucketLifecycle comment).
        const lifecycle = adapter
          ? adapter.bucketLifecycle(item, 'target', bucketAction)
          : {runTiming: item.system?.effect?.runTiming ?? '-', disable: item.system?.effect?.disable || '-'};

        // When runTiming is not '-', check that the timing matches
        if (!adapter && lifecycle.runTiming !== '-' && lifecycle.runTiming !== timing) {
          return;
        }

        // A notCheck expiry timing must never be applied
        if (!adapter && lifecycle.disable === 'notCheck') {
          return;
        }

        // Only the current trigger action's bucket among the target tab's attributes. With no value to apply we stop
        // here — so using an effect that only buffs the user (its target tab is empty) on a target through a combo
        // does not attach an empty AE to that target.
        // opts.frozenAttributes carries a bucket already evaluated on the item-use client
        // (serialized combo follow-ups, rider snapshots) — do not re-derive it here.
        const targetAttributes = opts.frozenAttributes ?? (adapter
          ? adapter.targetBucketAttributes(item, bucketAction, timing)
          : (item.system.effect?.attributes || {}));
        if (!this.hasUsableAttribute(targetAttributes)) {
          window.DX3rdDebug.log('DX3rd | applyToTargets skipped (no usable target attribute):', item.name);
          return;
        }

        let targetActors = [];
        const hasForcedTargets = Array.isArray(forcedTargets);
        
        // An array is an authoritative frozen target set even when it is empty. Treating [] as
        // absent makes after-damage follow-ups wake up the executor's unrelated current UI targets.
        if (hasForcedTargets) {
          targetActors = forcedTargets;
        }
        // With scene checked, apply to every token actor in the current scene
        else if (scene) {
          const currentScene = game.scenes.active;
          if (currentScene) {
            // With canvas.tokens present, take them from the rendered tokens (the currently visible scene)
            if (canvas && canvas.tokens) {
              targetActors = canvas.tokens.placeables.map(t => t.actor).filter(a => a);
            } else {
              // With no canvas, take them from the scene data
              targetActors = Array.from(currentScene.tokens).map(t => t.actor).filter(a => a);
            }
          }
        } else if (getTarget) {
          // With getTarget checked, use the current targets
          const targets = Array.from(game.user.targets);
          if (targets.length === 0) {
            ui.notifications.warn('타겟을 지정해주세요.');
            return;
          }
          
          targetActors = targets.map(t => t.actor).filter(a => a);
          if (targetActors.length === 0) {
            ui.notifications.warn('유효한 타겟을 찾을 수 없습니다.');
            return;
          }
        }

        // Apply at once. afterDamage without forcedTargets used to queue a "register and wait" entry
        // in DX3rdTargetApplyQueue, but every live caller reaches this timing with forcedTargets
        // already resolved (the damaged-actor list from the report), so the queue was unreachable.
        // The activation queue now carries the frozen snapshot instead (fromAttackItem rider).
        for (const targetActor of targetActors) {
          await this.dispatchItemAttributes(actor, item, targetActor, targetAttributes,
            {preEvaluated: opts.frozenAttributes != null});
        }
      } catch (e) {
        console.error('DX3rd | UniversalHandler.applyToTargets failed', e);
      }
    },

    /**
     * Freeze target formulas in the initiating client's context before crossing a socket boundary.
     * Runtime input and the pre-use encroachment level are transient Actor properties which the
     * recipient cannot reconstruct. Roll-time dice formulas keep their dice after token substitution.
     */
    freezeTransferredItemAttributes(actor, item, attributes) {
      const frozen = foundry.utils.deepClone(attributes || {});
      const evaluator = window.DX3rdFormulaEvaluator;
      for (const attr of Object.values(frozen)) {
        if (!attr || attr.value === undefined || attr.value === null) continue;
        if (typeof attr.value === 'boolean') continue;
        const prepared = evaluator?.prepareRollFormula
          ? evaluator.prepareRollFormula(attr.value, item, actor)
          : String(attr.value ?? '0');
        attr.value = evaluator?.isRollTimeKey?.(attr.key) && evaluator?.hasDice?.(prepared)
          ? prepared
          : (evaluator?.evaluate ? evaluator.evaluate(attr.value, item, actor) : Number(attr.value) || 0);
      }
      return frozen;
    },

    /**
     * Apply the item attributes to a target actor, letting a client with write permission do it.
     * Creating an AE directly on someone else's actor fails with a permission error, so it goes over the socket when we cannot write.
     * Conversely, a target we own (ourselves included) is handled locally — it applies even with no GM connected, and
     * the runtime input at use time (actor._dx3rdRuntimeInput: [consumedHP] and the like) exists only on this client,
     * so only local evaluation keeps those values alive.
     * @param {Actor} actor - the using actor
     * @param {Item} item - the item being used
     * @param {Actor} targetActor - the actor to apply to
     * @param {Object} targetAttributes - the attributes to apply (the original formulas, verbatim)
     */
    async dispatchItemAttributes(actor, item, targetActor, targetAttributes, {preEvaluated = false} = {}) {
      if (!targetActor) return;
      if (game.user.isGM || targetActor.isOwner) {
        await this._applyItemAttributes(actor, item, targetActor, targetAttributes, {preEvaluated});
        return;
      }
      const transferredAttributes = preEvaluated
        ? foundry.utils.deepClone(targetAttributes || {})
        : this.freezeTransferredItemAttributes(actor, item, targetAttributes);
      const sent = window.DX3rdSocketRouter.emitToActorExecutor({
        type: 'applyItemAttributes',
        payload: {
          sourceActorId: actor.id,
          itemId: item.id,
          targetActorId: targetActor.id,
          targetAttributes: transferredAttributes,
          preEvaluated: true
        }
      }, targetActor);
      if (sent) {
        window.DX3rdDebug.log('DX3rd | Apply attributes request sent via socket for:', targetActor.name);
      } else {
        // No client can apply to this actor (no active owner, no active GM) — surface the skip.
        ui.notifications.warn(`${targetActor.name}: 효과를 적용할 수 있는 사용자가 없어 적용이 생략됐습니다.`);
      }
    },

    /**
     * Internal: Apply item attributes to a single target actor.
     * @param {Actor} actor - The actor using the item
     * @param {Item} item - The item being used
     * @param {Actor} targetActor - The target actor
     * @param {Object} targetAttributes - The attributes to apply
     * @param {Object} [opts] - Optional overrides.
     * @param {string} [opts.disable] - Override the applied lifecycle (self on-use freezes use active.disable).
     * @param {boolean} [opts.preEvaluated=false] - Values were frozen by the initiating client; do not evaluate again.
     */
    async _applyItemAttributes(actor, item, targetActor, targetAttributes, opts = {}) {
      if (!targetActor) {
        ui.notifications.error('대상을 찾을 수 없습니다.');
        return;
      }

      // An item's self modifiers (system.attributes) and target modifiers (system.effect.attributes) are separate
      // channels with different expiry timings (active.disable / effect.disable) and different meanings, yet there
      // was a single key `applied_<itemId>` — so **they overwrote each other whenever the caster targeted themself**.
      // handleItemUse runs self modifiers (step 2) before target modifiers (step 3), so the self buff silently
      // vanished and only the target-side lifetime survived. The key is split per channel and lookups narrow by channel.
      const channel = opts.channel === 'self' ? 'self' : 'target';
      // Within one channel, buckets with different trigger actions must remain separate AEs too — sharing one key
      // makes whichever applies later overwrite and erase the earlier one. Such items really exist:
      // a weapon has two trigger points, the roll dialog's declaration (action:'use') and attacking with it
      // (action:'attack'), so authoring "+1 on declaration / +2 on attack" had the attack erase the declaration's share.
      // The bucket is derived from the effective trigger action of the incoming rows (a row's action field rides along
      // in the socket payload too, so no extra argument has to be wired). The channel's default bucket keeps the key
      // it has always used — a key that disagreed with a legacy AE would leave the expiry hook unable to find the old one.
      const adapter = window.DX3rdItemEffectAdapter;
      const entries = Object.values(targetAttributes || {});
      const effective = new Set(entries.map(attr =>
        adapter ? adapter.attributeAction(item, channel, attr) : null));
      if (adapter && effective.size > 1) {
        // Split even frozen/socket payloads here, so every entry point keeps card-owned AEs.
        for (const action of effective) {
          const attributes = Object.fromEntries(Object.entries(targetAttributes).filter(([, attr]) =>
            adapter.attributeAction(item, channel, attr) === action));
          await this._applyItemAttributes(actor, item, targetActor, attributes, opts);
        }
        return;
      }
      const channelDefault = adapter ? adapter.channelAction(item, channel) : null;
      const single = effective.size === 1 ? [...effective][0] : null;
      const bucketAction = single && single !== channelDefault ? single : null;
      const lifecycle = adapter
        ? adapter.bucketLifecycle(item, channel, bucketAction || channelDefault)
        : null;
      const bucketSuffix = {activation: 'act_', use: 'use_', attack: 'atk_'}[bucketAction] || '';
      // A stackable bucket ("stacks each time it hits") never reuses the previous AE — every
      // application gets its own instance key, so N applications contribute N times and the
      // bucket's own lifetime (e.g. scene) sweeps them all together.
      const stackable = lifecycle?.stack === true;
      let appliedKey = channel === 'self'
        ? `applied_self_${bucketSuffix}${item.id}`
        : `applied_${bucketSuffix}${item.id}`;
      if (stackable) appliedKey = `${appliedKey}_${foundry.utils.randomID()}`;

      // Look for an existing AE (same item and same channel keeps the key and replaces only the contents).
      // But a 'toggle:' derived AE is owned by DX3rdAppliedToggle — grabbing that key just because it came from the
      // same item and overwriting it would have the frozen values reverted by the next sync (payloadChanged), or,
      // with nothing to apply, have the branch below delete someone else's toggle AE.
      // An older AE with no channel marking is treated as the target channel (back then only the target path created
      // this key, and a self frozen AE moves to the new key, so there is no risk of grabbing the wrong one).
      // A stackable application is always a new instance — it must not adopt an earlier stack's key.
      const existingEff = stackable ? null : targetActor.effects.find(e => {
        if (String(e.getFlag?.('dx3rd-emanim', 'appliedKey') || '').startsWith('toggle:')) return false;
        const applied = e.getFlag?.('dx3rd-emanim', 'applied');
        if (applied?.itemId !== item.id) return false;
        if ((applied?.channel === 'self' ? 'self' : 'target') !== channel) return false;
        // The bucket has to match too (an activation bucket and a default bucket coexist).
        return (applied?.action || null) === bucketAction;
      });
      if (existingEff) {
        appliedKey = existingEff.getFlag('dx3rd-emanim', 'appliedKey') || appliedKey;
      }

      // Extract the source item's description (for display in the expandable area)
      const itemDesc = item.system?.description;
      const itemDescription = (typeof itemDesc === 'object' && itemDesc != null && 'value' in itemDesc)
        ? (itemDesc.value || '')
        : (typeof itemDesc === 'string' ? itemDesc : '');

      // Build the applied effect information
      const appliedEffect = {
        itemId: item.id,
        channel,
        action: bucketAction,
        name: item.name,
        img: item.img,
        source: actor.name,
        timestamp: Date.now(),
        // The lifetime belongs to the bucket too. Each card can author its own expiry timing, so reading the channel
        // field directly would make it expire on another card's lifetime (disable-hooks reads this value first).
        disable: opts.disable ?? (lifecycle
          ? lifecycle.disable
          : (channel === 'self'
            ? (item.system?.active?.disable ?? '-')
            : (item.system.effect?.disable ?? '-'))),
        description: itemDescription,
        attributes: {}
      };

      // Apply the effects
      for (const [attrKey, attrData] of Object.entries(targetAttributes)) {
        if (!attrData || !attrData.value) continue;

        // key is required. label preserves the original label:
        //   - the stat_* family carries a display name (an attribute or skill) in label.
        //   - attack carries a sub-bucket (fist/melee/ranged) in label → the consumer (actor.js bucket) sub-buckets
        //     by label, so overwriting label with key here would lose the fist / melee restriction (Degeneration Organ and the like).
        //   - for every other key (add/guard/dice/critical/major_*, …) the consumer ignores label, so label=null is harmless.
        const key = attrData.key;
        if (!key || key === '-') continue;
        const rawLabel = (attrData.label && attrData.label !== '-') ? attrData.label : null;

        // Fields rolled at damage, defense or check time keep their source formula even when moved into a target effect (AE).
        // They must NOT be frozen to a numeric 0 in prepareData; each consumer rolls them once with a Roll at the real action.
        // The key list uses the single definition in DX3rdFormulaEvaluator.ROLL_TIME_KEYS.
        const prepared = opts.preEvaluated
          ? attrData.value
          : window.DX3rdFormulaEvaluator.prepareRollFormula(attrData.value, item, actor);
        const evaluated = opts.preEvaluated
          ? attrData.value
          : (window.DX3rdFormulaEvaluator.isRollTimeKey(key) && window.DX3rdFormulaEvaluator.hasDice(prepared)
            ? prepared
            : window.DX3rdFormulaEvaluator.evaluate(attrData.value, item, actor));
        // Store under a key:label pair so different labels of the same key (fist/melee/ranged, per-skill stat_*) do not overwrite each other
        const storageKey = rawLabel ? `${key}:${rawLabel}` : key;
        appliedEffect.attributes[storageKey] = {
          key,
          label: rawLabel,
          value: evaluated,
          // A row-level condition rides along unevaluated — it is re-evaluated against the
          // holder on every derivation (see DX3rdRuntimeUtils.modifierConditionHolds).
          ...(attrData.condition ? { condition: attrData.condition } : {})
        };
      }

      // Counting the socket payload too, no AE is created when not a single modifier is left.
      // But an AE already attached from the same item is deleted — it used to be overwritten with an empty AE and
      // thereby neutralized, so simply returning would change the behavior to leaving the old modifiers in place.
      if (Object.keys(appliedEffect.attributes).length === 0) {
        window.DX3rdDebug.log('DX3rd | _applyItemAttributes skipped (nothing to apply):', item.name, '→', targetActor.name);
        if (existingEff) await window.DX3rdAppliedEffects.remove(targetActor, appliedKey);
        return;
      }

      // Add the effect (stored as a native ActiveEffect)
      try {
        await window.DX3rdAppliedEffects.set(targetActor, appliedKey, foundry.utils.deepClone(appliedEffect));
        ui.notifications.info(`${targetActor.name}에게 ${item.name}의 효과가 적용되었습니다.`);

        // Re-render the actor sheet when it is open
        const actorSheet = Object.values(ui.windows).find(app => app.actor?.id === targetActor.id);
        if (actorSheet) {
          actorSheet.render(false);
        }
      } catch (error) {
        console.error('DX3rd | UniversalHandler._applyItemAttributes error:', error);
        ui.notifications.error('어트리뷰트 적용 중 오류가 발생했습니다.');
      }
    },

    /**
     * Compute the share of the self modifiers that fired after this attack hit which the damage stage should consume.
     * It is added only to the actorAttack / penetrate preserved at accuracy time, so a major modifier already
     * folded in is not read again and counted twice.
     */
    async resolveAfterSuccessDamageBonus(actor, sourceItem, action, attackItem, bucketAttributes = null) {
      const result = { attack: 0, attackFormula: '', penetrate: 0 };
      const adapter = window.DX3rdItemEffectAdapter;
      if (!actor || !sourceItem || !attackItem || !adapter) return result;

      const attributes = bucketAttributes || adapter.selfBucketAttributes(sourceItem, action);
      const attackType = this.resolveAttackType?.(attackItem) || null;
      let fistAttack = false;
      if (attackItem.type === 'weapon') {
        fistAttack = !!this.isFistWeaponName?.(attackItem.name);
      } else {
        const weaponIds = Array.isArray(attackItem.system?.weapon) ? attackItem.system.weapon : [];
        fistAttack = weaponIds.some(id => {
          const weapon = window.DX3rdResolveWeapon?.(actor, id) || actor.items?.get?.(id);
          return !!this.isFistWeaponName?.(weapon?.name);
        });
      }
      const labelMatches = label => {
        const normalized = String(label ?? '').trim();
        if (!normalized || normalized === '-') return true;
        if (normalized === 'melee' || normalized === 'ranged') return normalized === attackType;
        if (normalized === 'fist') return fistAttack;
        return true;
      };

      const evaluator = window.DX3rdFormulaEvaluator;
      for (const entry of Object.values(attributes || {})) {
        if (!entry || !labelMatches(entry.label)) continue;
        const key = entry.key;
        if (key !== 'attack' && key !== 'penetrate') continue;
        const prepared = evaluator?.prepareRollFormula
          ? evaluator.prepareRollFormula(String(entry.value ?? '0'), sourceItem, actor)
          : String(entry.value ?? '0');
        const hasDice = evaluator?.hasDice?.(prepared) === true;
        if (key === 'attack') {
          if (hasDice) {
            result.attackFormula = this.joinFormulaTerms(result.attackFormula, prepared);
          } else {
            result.attack += Number(evaluator?.evaluate?.(entry.value, sourceItem, actor) ?? entry.value) || 0;
          }
          continue;
        }

        if (!hasDice) {
          result.penetrate += Number(evaluator?.evaluate?.(entry.value, sourceItem, actor) ?? entry.value) || 0;
          continue;
        }
        try {
          const roll = await (new Roll(prepared)).evaluate();
          result.penetrate += Number(roll.total) || 0;
        } catch (error) {
          console.warn(`DX3rd | afterSuccess penetrate roll failed: ${prepared}`, error);
          ui.notifications.warn(`${game.i18n.localize('DX3rd.DamageRollFormulaInvalid')}: ${prepared}`);
        }
      }
      return result;
    },

    /**
     * Handle one self modifier after a success. A roll/major lifetime that has already passed is not left on the
     * actor; only the attack value and armor-ignore needed for the current damage are returned.
     */
    async processAfterSuccessSelfModifiers(actor, item, {
      action = null, attackItem = null, expiredTimings = [], forceFrozen = false
    } = {}) {
      const empty = { attack: 0, attackFormula: '', penetrate: 0 };
      const adapter = window.DX3rdItemEffectAdapter;
      if (!actor || !item || !adapter) return empty;
      const expected = action || adapter.channelAction(item, 'self');
      if (!adapter.selfFiresAt(item, expected, 'afterSuccess')) return empty;

      const hasFrozen = adapter.hasFrozenSelfBucket(item, expected);
      const hasToggle = adapter.selfToggleBucketMatches(item, expected);
      if (!hasFrozen && (!hasToggle || item.system?.active?.state === true)) return empty;

      const contribution = { ...empty };
      const expired = new Set(expiredTimings);
      const buckets = adapter.modifierExecutionBuckets(item, 'self', expected, 'afterSuccess', {
        frozen: !forceFrozen
      });
      for (const bucket of buckets) {
        const bonus = await this.resolveAfterSuccessDamageBonus(actor, item, expected, attackItem, bucket.attributes);
        contribution.attack += bonus.attack;
        contribution.attackFormula = this.joinFormulaTerms(contribution.attackFormula, bonus.attackFormula);
        contribution.penetrate += bonus.penetrate;
        if (!expired.has(bucket.lifecycle.disable)) {
          await this.applySelfModifiers(actor, item, {
            action: bucket.action, timing: 'afterSuccess', bucketAttributes: bucket.attributes,
            ...(forceFrozen ? {forceFrozen: true} : {})
          });
        }
      }
      return contribution;
    },

    /**
     * The self frozen buff on use (applyMode='onUse') — freezes item.system.attributes onto the user once, at use time.
     * Unlike the toggle (active.state) channel it is never recomputed, so a runtime input value
     * ([consumedHP] and the like, actor._dx3rdRuntimeInput) is captured as-is by _applyItemAttributes' frozen evaluation.
     * The lifetime is active.disable (major/main/round/scene, …) — disable-hooks removes it per lifetime.
     * active.state is not turned on, so this is not a dx3rd-applied-toggle resync target.
     * @param {Actor} actor - the using actor (= the target)
     * @param {Item} item - the item being used
     */
    async applySelfFrozenBuff(actor, item, action = null, timing = null) {
      // Among the buckets split by per-row "trigger action", pick only what this action should freeze.
      // Rows authored as "activation" are held by the toggle AE (DX3rdAppliedToggle) and are excluded —
      // applying them here too would attach the same modifier twice.
      const adapter = window.DX3rdItemEffectAdapter;
      if (adapter) {
        for (const bucket of adapter.modifierExecutionBuckets(item, 'self', action, timing, {frozen: true})) {
          await this._applyItemAttributes(actor, item, actor, bucket.attributes, {channel: 'self'});
        }
        return;
      }
      const attrs = item.system?.attributes;
      if (!attrs || Object.keys(attrs).length === 0) return;
      // The lifetime (active.disable or that bucket's override) is resolved from the bucket directly by
      // _applyItemAttributes — pinning the channel value here would ignore the per-bucket expiry timing.
      await this._applyItemAttributes(actor, item, actor, attrs, {channel: 'self'});
    },

    /**
     * Split the self-modifier trigger channel at use time (instant) by applyMode.
     *   - toggle: active.state=true. DX3rdAppliedToggle re-evaluates the attributes on every actor / item update,
     *     so a following formula like [level] keeps up. The lifetime is managed by disable-hooks through active.disable.
     *   - onUse : apply an applied AE once, freezing the values at use time. On the toggle channel,
     *     actor._dx3rdRuntimeInput is already gone by the time of re-evaluation and [consumedHP] and the like collapse to 0,
     *     so a buff that uses runtime input must be on this channel.
     *
     * The afterSuccess / afterDamage trigger points go through this function too. By then handleItemUse's
     * _dx3rdRuntimeInput has already been cleaned up, so a value like [consumedHP] cannot be freshly frozen — but
     * splitting toggle and frozen types by the same rule to prevent double counting matters more.
     * An afterSuccess modifier whose roll/major lifetime has already ended is folded into the current damage
     * snapshot only, by processAfterSuccessSelfModifiers; only buckets whose lifetime survives are applied here.
     *
     * opts.forceToggle: use the toggle channel regardless of applyMode. Used by the path that turns on an item whose
     *   self-modifier action is 'activation' (an always-on effect, say) by using it directly — such items default to
     *   applyMode='onUse' in the compendium, so left alone only a frozen AE would attach and active.state would stay off.
     *   The sheet's "self persistent effects" display and a combo's persistence test both read active.state, so anything
     *   fired with the meaning of "activation" MUST be a toggle.
     * opts.action: the current trigger action ('use' | 'attack'). Decides which of the frozen buckets split by per-row
     *   "trigger action" to apply. When omitted, every non-activation row is applied (legacy).
     * @param {Actor} actor - the using actor (= the target)
     * @param {Item} item
     * @param {Object} [opts]
     * @param {boolean} [opts.forceToggle=false]
     * @param {string|null} [opts.action=null]
     * @returns {boolean} true when active.state was turned on
     */
    async applySelfModifiers(actor, item, { forceToggle = false, forceFrozen = false, action = null, timing = null, bucketAttributes = null } = {}) {
      const active = item.system?.active || {};
      const applyMode = active.applyMode || 'onUse';
      const adapter = window.DX3rdItemEffectAdapter;
      if (bucketAttributes) {
        await this._applyItemAttributes(actor, item, actor, bucketAttributes, {channel: 'self'});
        return false;
      }
      // A serialized instant-combo body has no Document state left to toggle. Preserve the authored
      // bucket as a normal frozen AE with the same lifecycle, so post-cleanup chat rerolls remain
      // meaningful without inventing a non-existent active.state update.
      if (forceFrozen) {
        const attrs = adapter && timing !== null
          ? Object.assign({}, ...adapter.modifierExecutionBuckets(item, 'self', action, timing).map(bucket => bucket.attributes))
          : adapter?.selfBucketAttributes?.(item, action) || item.system?.attributes || {};
        await this._applyItemAttributes(actor, item, actor, attrs, {channel: 'self'});
        return false;
      }
      // Because of per-row "trigger actions", one item can have an activation bucket and a frozen bucket at once.
      // The two are stored in different AEs (toggle:<id> / applied_self_<id>) and their rows never overlap
      // (selfFrozenAttributes / appliesWhileActive), so both apply without double counting.
      // Whether this item's self channel is the activation channel — **inference included**. An always-on effect
      // (timing 'always', no explicit bucket) resolves to activation through inferAction alone, so asking only about
      // an *explicitly authored* bucket answered "no" for exactly the items the guard below exists to protect.
      const usesActivationChannel = adapter ? adapter.usesActivationSelfChannel(item) : false;
      if (!forceToggle && applyMode === 'onUse') {
        // active.state is the 'activation' channel's state. An item running on the frozen channel having it on is
        // a leftover (declaration gear turned on by an old equip hook, or the sheet checkbox). Left alone the same
        // modifier counts twice — for gear through actor.js activeItems' self-computation, for effect types through the
        // toggle:<id> AE, while the frozen AE attaches here as well. So it is lowered before applying.
        //
        // But an item whose self channel IS the activation channel must never be lowered here: active.state is that
        // channel's applied state, not a leftover. The test used to be `hasExplicitBucket(item,'self','activation')`,
        // which misses the inferred case — so an always-on defence effect (강인한 골격, 레니게이드 월, 무적의 육체:
        // compendium shape timing='always', applyMode='onUse', disable='-') was **switched off** the first time it ran
        // as a combo member, and with no expiry timing nothing ever switched it back on. The guard bonus was applied
        // once and then silently gone until the player re-checked the box.
        // (This call site is the one without forceToggle — handleItemUse passes useMeansActivation, so a standalone
        //  use never hit it; combo members, afterSuccess/afterDamage and applyChosenItemEffect all did.)
        if (item.system?.active?.state === true && !usesActivationChannel) {
          await item.update({ 'system.active.state': false });
        }
        await this.applySelfFrozenBuff(actor, item, action, timing);
        return false;
      }
      // Even on the toggle channel, the state is left alone **when this action has no toggle bucket**. e.g. an always-on
      // weapon (applyMode='toggle') with an "on attack" modifier authored — turning state on here would set off the
      // while-equipped always-on bucket from an attack alone, and since equipping is the source of the state for gear,
      // the display would go wrong too. What should apply is that action's frozen bucket only.
      // forceToggle is the exception, because the caller has already decided "this trigger includes an activation"
      // (useMeansActivation — the path that turns on an always-on effect by using it directly).
      if (!forceToggle && !(adapter?.selfToggleBucketMatches?.(item, action) ?? true)) {
        await this.applySelfFrozenBuff(actor, item, action, timing);
        return false;
      }
      await item.update({ 'system.active.state': true });
      // Even on the toggle channel, rows authored as "on use / on attack" never go into the toggle AE, so they are
      // frozen here instead (explicitly authored rows only → they cannot overlap with unspecified ones).
      if (adapter?.hasFrozenSelfBucket?.(item, action)) {
        await this.applySelfFrozenBuff(actor, item, action, timing);
      }
      return true;
    },

    /**
     * The sheet's dedicated "apply effect" path.
     * The target tab (system.effect.attributes) and the self effect tab (system.attributes) mean different things,
     * so which one to apply is only asked when the caster is targeted and both are present.
     */
    async applyChosenItemEffect(actor, item, options = {}) {
      const targets = Array.from(game.user.targets || []);
      if (!targets.length) {
        ui.notifications.warn(game.i18n.localize('DX3rd.SelectTarget'));
        return false;
      }

      const targetAttributes = item.system?.effect?.attributes || {};
      const selfAttributes = item.system?.attributes || {};
      const hasTargetEffect = this.hasUsableAttribute(targetAttributes);
      const hasSelfEffect = this.hasUsableAttribute(selfAttributes);
      const includesSelf = targets.some(target => target.actor?.id === actor.id);

      if (!hasTargetEffect && !hasSelfEffect) {
        ui.notifications.warn(game.i18n.localize('DX3rd.NoApplicableEffect'));
        return false;
      }

      let source = null;
      if (includesSelf && hasTargetEffect && hasSelfEffect) {
        if (typeof window.DX3rdChooseEffectApplySource !== 'function') {
          ui.notifications.error(game.i18n.localize('DX3rd.DialogV2Unavailable'));
          return false;
        }
        source = await window.DX3rdChooseEffectApplySource(options.menuAnchor);
        if (source === null) return false;
      } else if (hasTargetEffect) {
        source = 'target';
      } else if (includesSelf && hasSelfEffect) {
        source = 'self';
      } else {
        // A self effect applies only to the caster who was targeted. It is never propagated to other actors.
        ui.notifications.warn(game.i18n.localize('DX3rd.NoApplicableEffect'));
        return false;
      }

      if (source === 'self') {
        await this._applyItemAttributes(actor, item, actor, selfAttributes, {
          disable: item.system?.active?.disable ?? '-',
          channel: 'self'
        });
        return true;
      }

      // The item is NOT serialized and sent to applyEffectData. That path loses the original Item, so
      //  (1) formulas are evaluated with item=null, leaving [level]/[Lv] unsubstituted and collapsing to 0,
      //  (2) attack's label (fist/melee/ranged) is overwritten by key, releasing the restriction, and
      //  (3) with no permission branch, a write to someone else's actor (an enemy) fails.
      // It goes through the same single path as the use pipeline (applyToTargets).
      for (const target of targets) {
        const targetActor = target.actor;
        if (!targetActor) continue;
        await this.dispatchItemAttributes(actor, item, targetActor, targetAttributes);
      }
      return true;
    },

    /**
     * Apply effect data from itemData to targeted actors
     * @param {Actor} actor - The actor using the item
     * @param {Object} itemData - Item data with effect information
     */
    async applyEffectData(actor, itemData) {
      try {
        
        // Check the effect data
        const targetAttributes = itemData.effect?.attributes || {};

        // Having only empty rows also counts as "nothing to apply" (preventing an empty AE).
        if (!this.hasUsableAttribute(targetAttributes)) {
          return;
        }

        // Use the current targets
        const targets = Array.from(game.user.targets);
        
        if (targets.length === 0) {
          ui.notifications.warn('타겟을 지정해주세요.');
          return;
        }
        
        const targetActors = targets.map(t => t.actor).filter(a => a);
        
        if (targetActors.length === 0) {
          ui.notifications.warn('유효한 타겟을 찾을 수 없습니다.');
          return;
        }

        // Apply the effect to every targeted actor
        for (const targetActor of targetActors) {
          await this._applyEffectDataToActor(actor, itemData, targetActor, targetAttributes);
        }
      } catch (e) {
        console.error('DX3rd | UniversalHandler.applyEffectData failed', e);
      }
    },

    /**
     * Apply effect data to a single target actor
     * @param {Actor} actor - The actor using the item
     * @param {Object} itemData - Item data
     * @param {Actor} targetActor - The target actor
     * @param {Object} targetAttributes - The attributes to apply
     */
    async _applyEffectDataToActor(actor, itemData, targetActor, targetAttributes) {
      if (!targetActor) {
        ui.notifications.error('대상을 찾을 수 없습니다.');
        return;
      }

      // The serialized path only carries itemData — recover the live item when the source actor still owns it
      // so [level]/[Lv] and other item context in formulas evaluate instead of collapsing to 0.
      const sourceItem = actor?.items?.get?.(itemData.id || itemData._id) || null;

      let appliedKey = `applied_${itemData.id || itemData.name}_${Date.now()}`;

      // Look for an existing AE (the same item id keeps the key and overwrites).
      // For the same reason as in _applyItemAttributes, a 'toggle:' derived AE is excluded —
      // that key is owned by DX3rdAppliedToggle, so grabbing and overwriting it would be reverted by the next
      // sync, or, with nothing to apply, have the branch below delete someone else's toggle AE.
      const existingEff = itemData.id
        ? targetActor.effects.find(e =>
          !String(e.getFlag?.('dx3rd-emanim', 'appliedKey') || '').startsWith('toggle:')
          && e.getFlag?.('dx3rd-emanim', 'applied')?.itemId === itemData.id)
        : null;
      if (existingEff) {
        appliedKey = existingEff.getFlag('dx3rd-emanim', 'appliedKey') || appliedKey;
      }

      // Extract the source item's description (itemData: when it came from a chat card and the like)
      const dataDesc = itemData.system?.description ?? itemData.description;
      const dataDescription = (typeof dataDesc === 'object' && dataDesc != null && 'value' in dataDesc)
        ? (dataDesc.value || '')
        : (typeof dataDesc === 'string' ? dataDesc : '');

      // Build the applied effect information
      const appliedEffect = {
        itemId: itemData.id || null,
        name: itemData.name,
        img: itemData.img,
        source: actor.name,
        timestamp: Date.now(),
        disable: itemData.effect?.disable || '-',
        description: dataDescription,
        attributes: {}
      };

      // Apply the effects
      for (const [attrKey, attrData] of Object.entries(targetAttributes)) {
        if (!attrData || !attrData.value) continue;

        // key is required. label preserves the original (the same convention as _applyItemAttributes).
        // Labels other than stat_* used to be overwritten by key, which erased attack's
        // sub-bucket (fist/melee/ranged) so the consumer (actor.js bucket) let it through as '_' (unrestricted)
        // → a melee-only modifier would over-apply to ranged and fist attacks as well.
        const key = attrData.key;
        if (!key || key === '-') continue;
        const rawLabel = (attrData.label && attrData.label !== '-') ? attrData.label : null;

        // A serialization path such as a chat card also never freezes a trigger-time roll formula to a number.
        // The key list uses the single definition in DX3rdFormulaEvaluator.ROLL_TIME_KEYS.
        const prepared = window.DX3rdFormulaEvaluator?.prepareRollFormula
          ? window.DX3rdFormulaEvaluator.prepareRollFormula(attrData.value, sourceItem, actor)
          : String(attrData.value ?? '0');
        const evaluated = window.DX3rdFormulaEvaluator?.isRollTimeKey?.(key)
          && window.DX3rdFormulaEvaluator?.hasDice?.(prepared)
          ? prepared
          : (window.DX3rdFormulaEvaluator?.evaluate
            ? window.DX3rdFormulaEvaluator.evaluate(attrData.value, sourceItem, actor)
            : Number(attrData.value) || 0);

        // Store under a key:label pair so different labels of the same key do not overwrite each other.
        const storageKey = rawLabel ? `${key}:${rawLabel}` : key;
        appliedEffect.attributes[storageKey] = {
          key,
          label: rawLabel,
          value: evaluated,
          ...(attrData.condition ? { condition: attrData.condition } : {})
        };
      }

      // No AE is created when not a single modifier is left (preventing an empty dummy AE).
      // An AE already attached from the same item is deleted (keeping the old neutralize-by-empty-AE behavior).
      if (Object.keys(appliedEffect.attributes).length === 0) {
        window.DX3rdDebug.log('DX3rd | _applyEffectDataToActor skipped (nothing to apply):', itemData.name, '→', targetActor.name);
        if (existingEff) await window.DX3rdAppliedEffects.remove(targetActor, appliedKey);
        return;
      }

      // Add the effect (stored as a native ActiveEffect)
      try {
        await window.DX3rdAppliedEffects.set(targetActor, appliedKey, foundry.utils.deepClone(appliedEffect));
        ui.notifications.info(`${targetActor.name}에게 ${itemData.name}의 효과가 적용되었습니다.`);

        // Re-render the actor sheet when it is open
        const actorSheet = Object.values(ui.windows).find(app => app.actor?.id === targetActor.id);
        if (actorSheet) {
          actorSheet.render(false);
        }
      } catch (error) {
        console.error('DX3rd | UniversalHandler._applyEffectDataToActor error:', error);
        ui.notifications.error('어트리뷰트 적용 중 오류가 발생했습니다.');
      }
    },

    _cleanDefenseReactionName(name = '') {
      return String(name)
        .replace(/\|\|.+$/, '')
        .replace(/\[DX3rd\.\w+\]/g, '')
        .trim();
    },

    async _getEffectsCompendiumIndex() {
      if (this._effectsCompendiumIndex) return this._effectsCompendiumIndex;

      const pack = game.packs?.get?.('dx3rd-emanim.effects')
        || Array.from(game.packs || []).find(p =>
          p.metadata?.system === 'dx3rd-emanim' && p.metadata?.name === 'effects'
        );

      const index = new Map();
      if (!pack?.getIndex) {
        this._effectsCompendiumIndex = index;
        return index;
      }

      // The pack can change mid-session (compendium sync, manual edits) — rebuild on the next call.
      if (!this._effectsCompendiumHooked) {
        this._effectsCompendiumHooked = true;
        Hooks.on('updateCompendium', changedPack => {
          if (changedPack === pack || changedPack?.collection === pack.collection) {
            this._effectsCompendiumIndex = null;
          }
        });
      }

      try {
        // Index entries are lightweight ({_id, name, type, img, system:{…}}) — materializing every full Item
        // just to read name/timing/attributes made the first defense dialog stall on a ~1.5k-entry pack.
        // Only the fields _isDefenseReactionCandidate reads are indexed.
        const docs = await pack.getIndex({ fields: ['system.timing', 'system.attributes'] });
        for (const doc of docs) {
          const key = this._cleanDefenseReactionName(doc.name);
          if (key && !index.has(key)) index.set(key, doc);
        }
      } catch (e) {
        console.warn('DX3rd | Failed to load effects compendium for defense reactions', e);
      }

      this._effectsCompendiumIndex = index;
      return index;
    },

    _isDefenseReactionCandidate(item, compendiumItem = null) {
      if (!item || !['effect', 'combo', 'psionic'].includes(item.type)) return false;

      const system = item.system || {};
      const compSystem = compendiumItem?.system || {};
      const timing = system.timing || compSystem.timing || '-';
      // The attributes read here are **the self channel (system.attributes) only**.
      // system.effect.attributes is the channel applied to a target, so scraping it too would list every attack
      // effect that "cuts the opponent's dodge dice" or "cuts the opponent's guard value" (Divine Lightning,
      // Guard Crash, Infiltration and 40 others) as a defense reaction candidate.
      // A guard-support effect applied to an ally is caught by directTiming when its timing is reaction.
      const selfAttrs = {
        ...(compSystem.attributes || {}),
        ...(system.attributes || {})
      };
      const attrText = Object.values(selfAttrs).map(attr => {
        if (!attr) return '';
        if (typeof attr === 'string') return attr;
        return `${attr.key || ''} ${attr.label || ''} ${attr.value || ''}`;
      }).join(' ');

      // So it can be declared freely mid-defense, an auto action is shown regardless of whether its description has a defense keyword.
      const directTiming = ['reaction', 'dodge', 'major-reaction', 'auto'].includes(timing);
      const defensiveAttr = /(dodge|reaction|guard|armor|reduce)/i.test(attrText);

      return directTiming || defensiveAttr;
    },

    async getDefenseReactionItems(actor) {
      if (!actor?.items) return [];

      const compendiumIndex = await this._getEffectsCompendiumIndex();
      // Whether an exhausted entry is dropped from the list is decided by the world setting. When kept, "exhausted" is
      // appended after the name so the dropdown makes it immediately clear that it is selectable but normally unusable.
      const allowExhausted = window.DX3rdItemExhausted?.allowExhaustedUse?.() !== false;
      const items = [];
      for (const item of actor.items) {
        if (window.DX3rdIsInstantCombo?.(item)) continue;
        const compendiumItem = compendiumIndex.get(this._cleanDefenseReactionName(item.name));
        if (!this._isDefenseReactionCandidate(item, compendiumItem)) continue;
        const exhausted = window.DX3rdItemExhausted?.isItemExhausted(item) || false;
        if (exhausted && !allowExhausted) continue;

        const name = this._cleanDefenseReactionName(item.name);
        items.push({
          id: item.id,
          type: item.type,
          name: exhausted ? `${name} (${game.i18n.localize('DX3rd.Exhausted')})` : name,
          exhausted,
          timing: item.system?.timing || compendiumItem?.system?.timing || '-'
        });
      }

      return items.sort((a, b) => {
        const order = {dodge: 0, reaction: 1, 'major-reaction': 2, auto: 3};
        const ao = order[a.timing] ?? 9;
        const bo = order[b.timing] ?? 9;
        return ao === bo ? a.name.localeCompare(b.name) : ao - bo;
      });
    },

    /**
     * Group the getDefenseReactionItems result by type, for the dropdown's optgroups.
     * The order inside each group preserves the original (timing → name).
     * @param {Array} items - the return value of getDefenseReactionItems
     * @returns {Array<{type: string, label: string, items: Array}>}
     */
    groupDefenseReactionItems(items) {
      const labels = {
        combo: 'DX3rd.Combo',
        effect: 'DX3rd.Effect',
        psionic: 'DX3rd.Psionic'
      };
      // Display order: combo → effect → psionic
      return ['combo', 'effect', 'psionic']
        .map(type => ({
          type,
          label: game.i18n.localize(labels[type]),
          items: (items || []).filter(item => item.type === type)
        }))
        .filter(group => group.items.length > 0);
    },

    /**
     * The defender's items that can undo the bypass this attack actually used.
     *
     * Only axes the attack really bypassed are offered — 《이지스 링》 is pointless against an attack
     * that never ignored armor, and listing it there would invite spending a once-a-scene use on
     * nothing. The guard counter answers either bypassed axis, because 《마그넷 체인》 and friends read
     * "「리액션을 실행할 수 없다」거나 「가드를 실행할 수 없다」…에 대해서도 가드를 실행할 수 있다".
     *
     * Any item type may carry the flag (《이지스 링》 is `etc`, 《그래비티 앱소버》 is a weapon), so unlike
     * getDefenseReactionItems this is not restricted to effect/combo/psionic.
     *
     * @param {Actor} actor
     * @param {{armor: boolean, guard: boolean, reaction: boolean}} bypass
     * @returns {Array<{id: string, name: string, axis: 'armor'|'guard', exhausted: boolean}>}
     */
    getDefenseRestoreItems(actor, bypass = {}) {
      if (!actor?.items) return [];
      const adapter = window.DX3rdItemEffectAdapter;
      const allowExhausted = window.DX3rdItemExhausted?.allowExhaustedUse?.() !== false;
      const offered = [];
      for (const item of actor.items) {
        const restore = adapter.restoreDefense(item);
        const axis = (restore.armor && bypass.armor === true) ? 'armor'
          : (restore.reaction && bypass.reaction === true) ? 'reaction'
            : (restore.guard && (bypass.guard === true || bypass.reaction === true)) ? 'guard'
              : null;
        if (!axis) continue;
        const exhausted = window.DX3rdItemExhausted?.isItemExhausted(item) || false;
        if (exhausted && !allowExhausted) continue;
        offered.push({
          id: item.id,
          // Same "exhausted" suffix convention as the reaction dropdown.
          name: exhausted ? `${item.name} (${game.i18n.localize('DX3rd.Exhausted')})` : item.name,
          axis,
          exhausted
        });
      }
      return offered.sort((a, b) => a.name.localeCompare(b.name));
    },

    /**
     * The bypass notice plus its counter checkboxes, for the defense dialog.
     * Returns '' when the attack bypassed nothing, so the dialog is unchanged in the ordinary case.
     */
    defenseBypassSectionHtml(bypass = {}, restoreItems = []) {
      const esc = window.DX3rdRuntimeUtils.escapeHTML;
      const axes = [
        ['armor', 'DX3rd.BypassDefenseArmor'],
        ['guard', 'DX3rd.BypassDefenseGuard'],
        ['reaction', 'DX3rd.BypassDefenseReaction']
      ].filter(([axis]) => bypass[axis] === true);
      if (!axes.length) return '';
      const tags = axes
        .map(([, key]) => `<span class="dx3rd-bypass-tag">${esc(game.i18n.localize(key))}</span>`)
        .join('');
      const rows = restoreItems.map(entry => `
        <label class="dx3rd-bypass-restore${entry.exhausted ? ' is-exhausted' : ''}">
          <input type="checkbox" class="dx3rd-bypass-restore-check"
                 data-item-id="${esc(entry.id)}" data-axis="${esc(entry.axis)}">
          <span>${esc(entry.name)}</span>
        </label>`).join('');
      return `
        <div class="dx3rd-bypass-section">
          <div class="dx3rd-bypass-title">${esc(game.i18n.localize('DX3rd.BypassNotice'))} ${tags}</div>
          ${rows ? `<div class="dx3rd-bypass-restores">${rows}</div>` : ''}
        </div>`;
    },

    _getDefaultDodgeRollData(actor) {
      const evade = actor.system?.attributes?.skills?.evade;
      if (evade) {
        const name = evade.name?.startsWith?.('DX3rd.')
          ? game.i18n.localize(evade.name)
          : (evade.name || game.i18n.localize('DX3rd.evade'));
        return { stat: evade, label: name };
      }

      return {
        stat: actor.system?.attributes?.body,
        label: game.i18n.localize('DX3rd.Body')
      };
    },
  });
})();
