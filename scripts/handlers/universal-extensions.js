// Universal handler - the item Extend processing & equipment creation cluster
// Split out of universal-handler.js. It MUST load after that file and mixes into the same object.
// (normalizeEffectIds / groupExtensionsByKey / mergeGroupedExtensionBuckets /
//  processItemExtensions / executeItemExtension / createWeaponItems / updateFistItem /
//  createProtectItem / createVehicleItem / evaluateFormulaForExtension /
//  showEquipmentSelectionDialog / sortItemsForEquipmentDialog / getEquipmentDialogTitle)
(function() {
  if (!window.DX3rdUniversalHandler) {
    console.error('DX3rd | universal-extensions.js loaded before universal-handler.js; extension methods unavailable.');
    return;
  }

  Object.assign(window.DX3rdUniversalHandler, {
    /**
     * Group DX3rd item extensions by type/timing/target/parentRunTiming with custom separation.
     * This only groups data and does not execute anything.
     * Key format: `${type}|${timing}|${target}|${parentRunTiming}|${customFlag}`
     * - type: 'heal' | 'damage' | 'condition'
     * - timing: 'instant' | 'afterSuccess' | 'afterDamage' | 'afterMain'
     * - target: 'self' | 'targetToken' | 'targetAll'
     * - parentRunTiming: the parent item's runTiming (deciding the afterMain registration timing)
     * - customFlag: '1' if any entry in bucket requires custom/conditional formula input, otherwise '0'
     * Each bucket contains: { type, timing, target, parentRunTiming, custom, sources: [{itemId, itemName, actorId, raw: {dice, add, options}}] }
     */
    /**
     * Normalize the included effect id list of a combo (or an item holding effect references).
     * Stored-format priority: system.effectIds (new) → system.effect.data (legacy) → system.effect (a very old array form).
     * Note: in the combo schema, system.effect is a { disable, runTiming, attributes } configuration object,
     * so it is explicitly filtered out to avoid being mistaken for an id list.
     * @returns {string[]} the effect id array with '-' and empty values removed
     */
    normalizeEffectIds(item) {
      const sys = item?.system || {};
      let raw = sys.effectIds;
      if (raw === undefined || raw === null) raw = sys.effect?.data;
      if (raw === undefined || raw === null) raw = sys.effect;

      if (Array.isArray(raw)) {
        return raw.filter(e => e && e !== '-');
      }
      if (raw && typeof raw === 'object') {
        // The system.effect configuration object ({disable/runTiming/attributes}) is not an id list
        if ('disable' in raw || 'runTiming' in raw || 'attributes' in raw) return [];
        return Object.values(raw)
          .map(v => (typeof v === 'string' ? v : (v?.id || null)))
          .filter(e => e && e !== '-');
      }
      if (typeof raw === 'string') {
        return (raw && raw !== '-') ? [raw] : [];
      }
      return [];
    },

    /**
     * Should what sits in a combo's member slot (system.effectIds) count as a member?
     *
     * The only authoring path is the combo sheet's add dropdown, and that offers effects only
     * (`combo-data.prepareActorEffects`, `combo-sheet-v2._addEffect`), so real data is all effects.
     * The predicate exists anyway because **the test was split across three places** — the use-count
     * "check" used `type === 'effect'`, the "increment" excluded only weapons and vehicles, and the "execution"
     * had no filter at all. A macro, migration or module pushing in another type produces the asymmetry of
     * **skipping the check while still incrementing the count and running it**.
     *
     * Not narrowing it to `=== 'effect'` is deliberate. Narrowing would silently drop an execution that runs today
     * in an old world containing another type. Keeping it wide costs at worst one extra check, and that check
     * warns rather than blocks under the default settings (`reportUsageExhausted`).
     * Only weapons and vehicles are excluded, because the weapon slot (`system.weapon`) has its own path through
     * the attack values and attack-used — catching both would process it twice.
     */
    isComboMemberItem(item) {
      return Boolean(item) && !['weapon', 'vehicle'].includes(item.type);
    },

    /** A combo's member items. Id normalization, existence checks and the type test all finish in one place. */
    comboMemberItems(actor, comboItem) {
      return this.normalizeEffectIds(comboItem)
        .map(id => actor?.items?.get(id))
        .filter(memberItem => this.isComboMemberItem(memberItem));
    },

    groupExtensionsByKey(extensions) {
      return window.DX3rdRuntimeUtils.groupExtensionsByKey(extensions);
    },

    mergeGroupedExtensionBuckets(actor, buckets) {
      const results = [];
      for (const bucket of buckets) {
        const { type, timing, target, custom, parentRunTiming } = bucket;
        if (custom) {
          // Keep sources; caller will open a single custom dialog for this bucket
          results.push({ ...bucket, merged: null });
          continue;
        }

        if (type === 'heal' || type === 'damage') {
          let totalDice = 0;
          let totalAdd = 0;
          const diceFormulaTerms = [];
          let hasRivival = false;
          let hasResurrect = false;
          let hasIgnoreReduce = false;
          
          for (const src of bucket.sources) {
            const { dice, add } = src.raw;
            const options = src.raw?.options || {};
            
            // rivival, resurrect and ignoreReduce merge with OR (true when any one is true)
            if (options.rivival) hasRivival = true;
            if (options.resurrect) hasResurrect = true;
            if (options.ignoreReduce) hasIgnoreReduce = true;
            
            // Build item context for proper [level] evaluation per source item
            const item = game.actors.get(src.actorId)?.items.get(src.itemId);
            const itemLevel = (item ? window.DX3rdFormulaEvaluator.getItemLevel(item) : 0) || 1;
            const itemForFormula = {
              type: item?.type || 'effect',
              system: { level: { value: itemLevel } }
            };
            // Evaluate dice/add formulas if they are strings
            let evaluatedDice = 0;
            let evaluatedAdd = 0;
            if (dice) {
              const diceStr = String(dice).trim();
              if (diceStr && diceStr !== '0') {
                if (window.DX3rdFormulaEvaluator.hasDice(diceStr)) {
                  // Each source effect's level / attribute references are resolved here so they survive the summation.
                  diceFormulaTerms.push(window.DX3rdFormulaEvaluator.prepareRollFormula(diceStr, itemForFormula, actor));
                } else {
                  evaluatedDice = window.DX3rdFormulaEvaluator.evaluate(diceStr, itemForFormula, actor);
                }
              }
            }
            if (add || add === 0) {
              const addStr = String(add).trim();
              if (addStr && addStr !== '0') {
                // The extend dialog uses a single formula input. An NdM formula stored in an additive field is
                // preserved too, so it can be substituted in its source item's context and rolled exactly once.
                if (window.DX3rdFormulaEvaluator.hasDice(addStr)) {
                  diceFormulaTerms.push(window.DX3rdFormulaEvaluator.prepareRollFormula(addStr, itemForFormula, actor));
                } else {
                  evaluatedAdd = window.DX3rdFormulaEvaluator.evaluate(addStr, itemForFormula, actor);
                }
              }
            }
            totalDice += Math.max(0, parseInt(evaluatedDice) || 0);
            totalAdd += parseInt(evaluatedAdd) || 0;
          }
          const mergedDice = diceFormulaTerms.length > 0
            ? [totalDice > 0 ? `${totalDice}d10` : '', ...diceFormulaTerms].filter(Boolean).join(' + ')
            : totalDice;
          results.push({
            type, timing, target, custom: false,
            parentRunTiming,
            merged: { dice: mergedDice, add: totalAdd },
            rivival: hasRivival,
            resurrect: hasResurrect,
            ignoreReduce: hasIgnoreReduce,
            sources: bucket.sources
          });
        } else if (type === 'condition') {
          const conditionSet = new Set();
          let maxPoisonedRank = 0;
          for (const src of bucket.sources) {
            const opts = src.raw?.options || {};
            const cts = opts.conditionTypes;
            if (Array.isArray(cts) && cts.length > 0) {
              cts.forEach(ct => {
                if (ct) {
                  conditionSet.add(ct);
                  // Collect and evaluate the poison ranks (the highest rank wins)
                  if (ct === 'poisoned' && opts.poisonedRank) {
                    const rankFormula = opts.poisonedRank;
                    const item = game.actors.get(src.actorId)?.items.get(src.itemId);
                    const itemLevel = (item ? window.DX3rdFormulaEvaluator.getItemLevel(item) : 0) || 1;
                    const itemForFormula = {
                      type: item?.type || 'effect',
                      system: { level: { value: itemLevel } }
                    };
                    let evaluatedRank = 0;
                    if (typeof rankFormula === 'string' && /\[/.test(rankFormula)) {
                      evaluatedRank = window.DX3rdFormulaEvaluator.evaluate(rankFormula, itemForFormula, actor);
                    } else {
                      evaluatedRank = Number(rankFormula) || 0;
                    }
                    maxPoisonedRank = Math.max(maxPoisonedRank, evaluatedRank);
                  }
                }
              });
            } else {
              const ct = opts.conditionType;
              if (ct) {
                conditionSet.add(ct);
                // Collect and evaluate the poison ranks (the highest rank wins)
                if (ct === 'poisoned' && opts.poisonedRank) {
                  const rankFormula = opts.poisonedRank;
                  const item = game.actors.get(src.actorId)?.items.get(src.itemId);
                  const itemLevel = (item ? window.DX3rdFormulaEvaluator.getItemLevel(item) : 0) || 1;
                  const itemForFormula = {
                    type: item?.type || 'effect',
                    system: { level: { value: itemLevel } }
                  };
                  let evaluatedRank = 0;
                  if (typeof rankFormula === 'string' && /\[/.test(rankFormula)) {
                    evaluatedRank = window.DX3rdFormulaEvaluator.evaluate(rankFormula, itemForFormula, actor);
                  } else {
                    evaluatedRank = Number(rankFormula) || 0;
                  }
                  maxPoisonedRank = Math.max(maxPoisonedRank, evaluatedRank);
                }
              }
            }
          }
          results.push({
            type, timing, target, custom: false,
            parentRunTiming,
            sourceItemId: bucket.sourceItemId || null,
            sourceActorId: bucket.sourceActorId || null,
            duration: bucket.duration || null,
            merged: { conditions: Array.from(conditionSet) },
            poisonedRank: maxPoisonedRank > 0 ? maxPoisonedRank : null,
            sources: bucket.sources
          });
        } else if (type === 'weapon' || type === 'protect' || type === 'vehicle' || type === 'statusClear') {
          // Item creation / status clear types: returned as their sources without merging (each has to run separately)
          results.push({
            type, timing, target, custom: false,
            parentRunTiming,
            merged: null, // item creation is never merged
            sources: bucket.sources
          });
        } else {
          // Unknown type: pass-through
          results.push({ ...bucket, merged: null });
        }
      }
      return results;
    },

    damageDataFromExtensionBucket(bucket, {
      target = null,
      selectedTargetIds = null,
      triggerItemName = null
    } = {}) {
      if (!bucket || bucket.type !== 'damage') return null;
      const sources = bucket.sources || [];
      const firstSource = sources[0]?.raw || {};
      // A custom bucket is deliberately not formula-merged. It represents one runtime formula
      // prompt for the whole same-timing/same-target bucket.
      const conditionalFormula = Boolean(bucket.custom);
      return {
        formulaDice: bucket.custom ? (firstSource.dice ?? 0) : (bucket.merged?.dice ?? 0),
        formulaAdd: bucket.custom ? (firstSource.add ?? 0) : (bucket.merged?.add ?? 0),
        target: target ?? bucket.target,
        selectedTargetIds: selectedTargetIds ?? bucket.selectedTargetIds ?? [],
        ignoreReduce: bucket.custom
          ? sources.some(source => Boolean(source.raw?.options?.ignoreReduce))
          : Boolean(bucket.ignoreReduce),
        conditionalFormula,
        sourceItemId: sources.length === 1 ? (sources[0].itemId || null) : null,
        triggerItemName
      };
    },

    /**
     * Process item extension effects when item is used
     * @param {Actor} actor
     * @param {Item} item
     * @param {string} timing - 'instant' | 'success' | 'damage' | null (null means every timing)
     */
    async processItemExtensions(actor, item, timing = null, action = null) {
      try {
        // Get the item's extension settings
        const itemExtend = item.getFlag('dx3rd-emanim', 'itemExtend');
        if (!itemExtend) {
          return; // ignore it when there are no extension settings
        }

        // Determine the execution timing of the linked (parent) item.
        // For effect, psionic, spell and the like it follows active.runTiming or roll.
        let parentItemTiming = 'instant'; // the default
        
        if (item.system?.active?.runTiming) {
          // When active.runTiming is present (effect, psionic, …)
          parentItemTiming = item.system.active.runTiming;
        } else if (item.type === 'spell') {
          // For a spell: roll '-' maps to instant and 'CastingRoll' to afterSuccess
          const rollType = item.system?.roll ?? '-';
          if (rollType === 'CastingRoll') {
            parentItemTiming = 'afterSuccess'; // a spell maps afterSuccess → success
          }
        }
        
        // afterSuccess maps to success (a spell firing = on success)
        if (parentItemTiming === 'afterSuccess') {
          parentItemTiming = 'success';
        }


        // The existing per-type slots and the new unbounded card array are handled as one execution list.
        const extensionEntries = window.DX3rdItemEffectAdapter?.extensionEntries?.(itemExtend)
          || Object.entries(itemExtend).map(([type, data]) => ({type, data}));
        for (const entry of extensionEntries) {
          const extensionType = entry.type;
          const extensionData = entry.data;
          window.DX3rdDebug.log(`DX3rd | Extension ${extensionType}:`, {
            activate: extensionData?.activate,
            parentTiming: parentItemTiming,
            requestedTiming: timing,
            extensionTiming: extensionData?.timing
          });
          
          if (extensionType === 'condition' && extensionData) {
            if (window.DX3rdItemEffectAdapter && !window.DX3rdItemEffectAdapter.extensionActionMatches(item, 'condition', extensionData, action, timing)) continue;
            const extensionTiming = window.DX3rdItemEffectAdapter?.inferAction?.(item, 'condition', extensionData) === 'activation'
              ? 'instant'
              : (extensionData.timing || 'instant');
            if (extensionData.activate && extensionData.type && extensionTiming === timing) {
              window.DX3rdDebug.log(`DX3rd | Executing condition extension - timing match: ${extensionTiming}, type: ${extensionData.type}`);
              await this.executeItemExtension(actor, 'condition', {...extensionData, timing: extensionTiming}, item);
            }
            continue;
          }
          
          if (extensionData && extensionData.activate) {
            if (window.DX3rdItemEffectAdapter && !window.DX3rdItemEffectAdapter.extensionActionMatches(item, extensionType, extensionData, action, timing)) continue;
            // heal, damage, statusClear and encroach extensions follow their own timing (regardless of the parent's)
            if (extensionType === 'heal' || extensionType === 'damage' || extensionType === 'statusClear' || extensionType === 'encroach') {
              const extensionTiming = window.DX3rdItemEffectAdapter?.inferAction?.(item, extensionType, extensionData) === 'activation'
                ? 'instant'
                : (extensionData.timing || 'instant');
              
              // Check that extensionTiming matches the requested timing
              if (extensionTiming === timing) {
                window.DX3rdDebug.log(`DX3rd | Executing ${extensionType} extension - timing match: ${extensionTiming}`);
                await this.executeItemExtension(actor, extensionType, {...extensionData, timing: extensionTiming}, item);
              } else {
                window.DX3rdDebug.log(`DX3rd | Skipping ${extensionType} extension - timing mismatch: extensionTiming=${extensionTiming}, requestedTiming=${timing}`);
              }
            } else {
              // An ordinary extension (weapon, protect, vehicle, …) follows the parent's timing
              const effectiveParentTiming = window.DX3rdItemEffectAdapter?.inferAction?.(item, extensionType, extensionData) === 'activation'
                ? 'instant'
                : parentItemTiming;
              if (effectiveParentTiming === timing) {
                await this.executeItemExtension(actor, extensionType, {...extensionData, timing: effectiveParentTiming}, item);
              } else {
              }
            }
          } else {
          }
        }
      } catch (e) {
        console.error('DX3rd | UniversalHandler.processItemExtensions failed', e);
      }
    },

    /**
     * Execute specific item extension
     * @param {Actor} actor
     * @param {string} extensionType
     * @param {Object} extensionData
     * @param {Item} item - Source item (optional)
     */
    async executeItemExtension(actor, extensionType, extensionData, item = null) {
      try {

        let createdItems = [];
        if (extensionType === 'weapon') {
          createdItems = await this.createWeaponItems(actor, extensionData, item);
        } else if (extensionType === 'protect') {
          createdItems = await this.createProtectItem(actor, extensionData, item);
        } else if (extensionType === 'vehicle') {
          createdItems = await this.createVehicleItem(actor, extensionData, item);
        } else if (extensionType === 'heal') {
          await this.executeHealExtension(actor, extensionData, item);
          return; // heal is not an item creation, so we finish here
        } else if (extensionType === 'damage') {
          await this.executeDamageExtension(actor, extensionData, item);
          return; // damage is not an item creation, so we finish here
        } else if (extensionType === 'condition') {
          await this.executeConditionExtension(actor, extensionData, item);
          return; // condition is not an item creation, so we finish here
        } else if (extensionType === 'statusClear') {
          await this.executeStatusClearExtension(actor, extensionData, item);
          return; // a status clear is not an item creation either
        } else if (extensionType === 'encroach') {
          await this.executeEncroachExtensionNow(actor, extensionData, item);
          return; // an encroachment adjustment is not an item creation either
        }
        
        // With items created, show the equipment selection dialog
        if (createdItems.length > 0) {
          await this.showEquipmentSelectionDialog(actor, createdItems, extensionType);
        }
      } catch (e) {
        console.error('DX3rd | executeItemExtension failed for type:', extensionType, e);
      }
    },

    /**
     * Create weapon items from extension data
     * @param {Actor} actor
     * @param {Object} data
     * @param {Item} item - Source item (optional)
     * @returns {Array} Created items
     */
    async createWeaponItems(actor, data, item = null) {
      // Handle the fist checkbox
      if (data.fist) {
        await this.updateFistItem(actor, data, item);
        // A fist modification needs no equipment dialog — return an empty array
        return [];
      }

      // Create an ordinary weapon
      const itemName = `${data.name}${game.i18n.localize('DX3rd.TemporaryItem')}`;
      const createdItems = [];
      
      // Get the item's level (1 when absent) — reflecting the encroachment correction dynamically
      const itemLevel = (item ? window.DX3rdFormulaEvaluator.getItemLevel(item) : 0) || 1;
      const itemForFormula = { type: item?.type || 'effect', system: { level: { value: itemLevel } } };
      const amount = Math.max(1, Math.floor(this.evaluateFormulaForExtension(data.amount || '1', itemForFormula, actor)) || 1);
      
      
      const evaluatedAdd = this.evaluateFormulaForExtension(data.add, itemForFormula, actor);
      const evaluatedAttack = this.evaluateFormulaForExtension(data.attack, itemForFormula, actor);
      const evaluatedGuard = this.evaluateFormulaForExtension(data.guard, itemForFormula, actor);
      const evaluatedRange = this.evaluateFormulaForExtension(data.range, itemForFormula, actor, true);

      for (let i = 0; i < amount; i++) {
        const itemData = {
          name: itemName,
          type: 'weapon',
          img: item?.img || undefined, // use the source item's image
          system: {
            type: data.type || 'melee',
            skill: data.skill || 'melee',
            add: evaluatedAdd,
            attack: evaluatedAttack,
            guard: evaluatedGuard,
            range: evaluatedRange,
            equipment: false,
            active: {
              state: false,
              disable: 'notCheck',
              runTiming: 'instant'
            },
            used: {
              state: 0,
              max: 0,
              disable: 'notCheck'
            },
            'attack-used': {
              state: 0,
              max: 0,
              disable: 'notCheck'
            }
          }
        };

        const createdItem = await actor.createEmbeddedDocuments('Item', [itemData]);
        createdItems.push(createdItem[0]);
      }

      // The creations' lifetime is held by the marker too. Weapon markers are independent, so any number can stack,
      // and deleting one removes only the weapon that marker created.
      if (createdItems.length) {
        await this.createItemGrant(actor, item, 'weapon', createdItems, data);
      }

      return createdItems;
    },

    /**
     * The fields an effect that changes the fist data overwrites. The snapshot and the restore must use the same
     * list, or a "field that gets changed but never restored" appears.
     */
    FIST_MUTABLE_FIELDS: ['type', 'skill', 'add', 'attack', 'guard', 'range'],

    /** Numeric fist fields that an explicitly additive fist change may contribute. */
    FIST_ADDITIVE_FIELDS: ['add', 'attack', 'guard'],

    /**
     * The default data of the fist an actor first receives. Only `main.js`'s fist creation and **this one place** use it —
     * these values used to be scattered as literals across one creation site and three reset sites, so an actor whose fist
     * had been hand-tuned reverted to them after every combat (it was an overwrite, not a restore).
     */
    defaultFistSystem() {
      return {
        type: 'melee',
        skill: 'melee',
        add: '+0',
        attack: '-5',
        guard: '0',
        range: game.i18n.localize('DX3rd.Engage')
      };
    },

    /** Find the fist item (named `맨손`, or `…[맨손]`). */
    findFistItem(actor) {
      const fistName = game.i18n.localize('DX3rd.Fist');
      return actor?.items?.find(it =>
        it.type === 'weapon' &&
        (it.name === fistName || it.name.endsWith(`[${fistName}]`))
      ) || null;
    },

    /**
     * Record what the fist looked like **immediately before** it was changed, on an item flag. The restore uses only this
     * value, and a fist with no flag means nobody ever changed it, so the restore leaves it alone
     * (= a hand-tuned fist and a permanent change both survive).
     *
     * **An existing snapshot is never overwritten.** Using Incandescence after Claws of Destruction makes the "current
     * value" the second call sees the first one's result, so overwriting would lose the original forever.
     */
    async snapshotFistItem(fistItem) {
      if (!fistItem || fistItem.getFlag('dx3rd-emanim', 'fistOriginal')) return;
      const sys = fistItem.system || {};
      const original = { name: fistItem.name };
      for (const key of this.FIST_MUTABLE_FIELDS) original[key] = sys[key];
      await fistItem.setFlag('dx3rd-emanim', 'fistOriginal', original);
    },

    // ── An equipment change's lifetime is held by an ActiveEffect ──────────
    //
    // A fist change and a weapon creation are held not by a fixed "when combat ends" trigger but **for as long as
    // the marker (AE) lives**. Deleting the AE reverts that change and removes the creation.
    // So the GM can revert it instantly from the effects tab, in any scene or scenario.
    //
    // **Disabling does NOT revert it.** Core drops a disabled AE from `appliedEffects`, so only the token overlay
    // icon disappears while the weapon / fist data stays.
    // Only **deletion** reverts — which is why there is no `updateActiveEffect` hook.
    //
    // Fist AEs **can stack** (some effects are "stackable even when already present").
    // So each AE carries the fist data it created (`applied`) and when it was applied (`order`), and when one
    // disappears the fist is re-aligned to **the most recent applied** among those left. Once they are all gone it
    // reverts to the item flag `fistOriginal` (= the bottom of the stack, the first original). That is why deleting
    // one in the middle does not shake the bottom.

    GRANT_FLAG: 'itemGrant',

    /** Is this AE an equipment-change marker? null when it is not. */
    grantPayload(effect) {
      return effect?.getFlag?.('dx3rd-emanim', this.GRANT_FLAG) ?? null;
    },

    /** The actor's fist-change AEs, oldest first. */
    fistGrantEffects(actor, excludeId = null) {
      return (actor?.effects ?? [])
        .filter(e => e.id !== excludeId && this.grantPayload(e)?.kind === 'fist')
        .sort((a, b) => (this.grantPayload(a).order ?? 0) - (this.grantPayload(b).order ?? 0));
    },

    /** Legacy fist grants have no mode and are replacement changes. */
    isAdditiveFistGrant(grant) {
      return grant?.mode === 'additive';
    },

    /** Keep the signed string convention used by weapon data. */
    formatFistNumber(value) {
      const number = Number(value) || 0;
      return number > 0 ? `+${number}` : String(number);
    },

    /**
     * Compose the visible fist from its immutable bottom and the live marker stack.
     *
     * Replacement changes are last-writer-wins. Additive changes never become that replacement layer: every live
     * additive contribution is summed onto the newest replacement (or the original when there is no replacement),
     * regardless of whether it was applied before or after that replacement.
     */
    composeFistData(original, grants) {
      const payloads = (grants || []).map(entry => this.grantPayload(entry) || entry).filter(Boolean);
      const replacements = payloads.filter(grant => !this.isAdditiveFistGrant(grant) && grant.applied);
      const latestReplacement = replacements.at(-1)?.applied;
      const base = latestReplacement || original || {};
      const composed = { name: base.name };
      for (const key of this.FIST_MUTABLE_FIELDS) {
        if (base[key] !== undefined) composed[key] = base[key];
      }
      for (const grant of payloads.filter(entry => this.isAdditiveFistGrant(entry))) {
        for (const key of this.FIST_ADDITIVE_FIELDS) {
          composed[key] = this.formatFistNumber((Number(composed[key]) || 0) + (Number(grant.applied?.[key]) || 0));
        }
      }
      return composed;
    },

    /** Recalculate the fist from all surviving markers instead of undoing one marker procedurally. */
    async realignFistItem(actor, fistItem, excludeId = null) {
      if (!actor || !fistItem) return false;
      const original = fistItem.getFlag('dx3rd-emanim', 'fistOriginal');
      if (!original) return false;
      const applied = this.composeFistData(original, this.fistGrantEffects(actor, excludeId));
      const update = { name: applied.name || game.i18n.localize('DX3rd.Fist') };
      for (const key of this.FIST_MUTABLE_FIELDS) {
        if (applied[key] !== undefined) update[`system.${key}`] = applied[key];
      }
      await fistItem.update(update);
      return true;
    },

    /**
     * Create a fist marker, or refresh the same additive source instead of accidentally stacking repeated uses.
     * Separate source item ids still add normally. A rare self-stacking effect must opt in explicitly.
     */
    async createOrRefreshFistGrant(actor, item, fistItem, applied, data, mode) {
      const stackable = mode === 'additive' && data?.fistStackable === true;
      const sourceItemId = item?.id ?? null;
      const action = window.DX3rdItemEffectAdapter?.inferAction?.(item, 'weapon', data) || null;
      const payload = {
        kind: 'fist', mode, action, sourceItemId,
        fistItemId: fistItem?.id ?? null,
        order: Date.now(), applied
      };
      if (mode === 'additive' && !stackable && sourceItemId) {
        const existing = this.fistGrantEffects(actor).find(effect => {
          const grant = this.grantPayload(effect);
          return this.isAdditiveFistGrant(grant) && grant.sourceItemId === sourceItemId;
        });
        if (existing) {
          // Keep its original ordering. Additive order is mathematically irrelevant, and retaining it avoids turning a
          // refresh into a delete/recreate lifecycle event in the effects list.
          payload.order = this.grantPayload(existing).order ?? payload.order;
          await existing.setFlag('dx3rd-emanim', this.GRANT_FLAG, payload);
          return existing;
        }
      }
      return this.createGrantEffect(actor, item, payload);
    },

    /**
     * The AE that should carry this item's grant payload.
     *
     * An item that both buffs and creates used to leave **two AEs with the same name and image** on the actor —
     * the applied modifier one and the marker. They were indistinguishable in the UI, so deleting "the effect"
     * hit whichever one was listed and the creation stayed behind. The grant is therefore written onto the item's
     * existing applied AE whenever there is one: one document, one row, one deletion.
     *
     * Returns null when the item has no applied AE yet (a create-only effect, or the modifier AE has not been
     * written yet) — the caller then makes a standalone marker, which is still the only row for that item.
     * An AE that already carries a payload is never reused: fist grants deliberately stack, and one flag cannot
     * hold two.
     */
    grantHost(actor, item) {
      if (!actor || !item?.id) return null;
      const effects = window.DX3rdAppliedEffects?.getEffectsByItem?.(actor, item.id) || [];
      return effects.find(effect => effect.getFlag?.('dx3rd-emanim', 'appliedKey')
        && !this.grantPayload(effect)) || null;
    },

    /**
     * Create an equipment-change marker AE, or attach the payload to the item's applied AE when it already has
     * one (grantHost). It never takes part in any calculation —
     * `system.changes` is left empty so core has no opening to touch the actor data, and the modifiers stay
     * with the single `DX3rdAppliedEffects` path as before.
     */
    async createGrantEffect(actor, item, payload, {reuseHost = true} = {}) {
      const host = reuseHost ? this.grantHost(actor, item) : null;
      if (host) {
        try {
          await host.setFlag('dx3rd-emanim', this.GRANT_FLAG, payload);
          return host;
        } catch (e) {
          console.error('DX3rd | 보정 AE 에 장비 변경 표식 부착 실패:', e);
        }
      }
      const key = `${payload.kind}-${item?.id ?? 'unknown'}-${payload.order}`;
      const data = {
        name: item?.name || game.i18n.localize('DX3rd.Effect'),
        img: item?.img || 'icons/svg/sword.svg',
        description: game.i18n.localize(payload.kind === 'fist'
          ? 'DX3rd.GrantFistDescription' : 'DX3rd.GrantWeaponDescription'),
        disabled: false,
        // Show an icon on the token — disabling drops it from this list, so only the icon disappears.
        showIcon: CONST.ACTIVE_EFFECT_SHOW_ICON?.ALWAYS ?? 2,
        statuses: [`dx3rd-grant-${key}`],   // a unique status = no icon merging
        origin: item ? `${actor.uuid}.Item.${item.id}` : actor.uuid,
        system: { changes: [] },
        flags: { 'dx3rd-emanim': { [this.GRANT_FLAG]: payload } }
      };
      try {
        const [created] = await actor.createEmbeddedDocuments('ActiveEffect', [data]);
        return created;
      } catch (e) {
        console.error('DX3rd | 장비 변경 표식 AE 생성 실패:', e);
        return null;
      }
    },

    /**
     * The marker for a created item (weapon / protect / vehicle). Every creation goes through here so the three
     * families cannot drift — armour and vehicles used to get no marker at all, which left the item they created
     * on the actor with nothing able to take it back.
     *
     * The payload records **which trigger action created it**, because that is what decides whether switching the
     * source item off should take the creation back with it (see clearActivationGrants).
     */
    async createItemGrant(actor, item, kind, createdItems, data = {}) {
      const created = (createdItems || []).filter(Boolean);
      if (!created.length) return null;
      const action = window.DX3rdItemEffectAdapter?.inferAction?.(item, kind, data) || null;
      return this.createGrantEffect(actor, item, {
        kind,
        action,
        sourceItemId: item?.id ?? null,
        createdItemIds: created.map(i => i.id),
        order: Date.now()
      });
    },

    /**
     * Move a grant payload off an applied AE that is about to be removed, onto a standalone marker.
     *
     * Sharing one document makes the two lifetimes one, and they are not: a buff can expire at the end of a major
     * action while the weapon it created lasts the scene. So an **automatic** removal (an expiry timing firing)
     * hands the payload to a marker of its own instead of destroying the creation with it. Only an explicit
     * deletion by the user cascades — that is `removeItemGrants`, called from the sheet's remove button.
     *
     * The flag is unset before the AE is deleted, so the delete hook sees no payload and reverts nothing.
     */
    async rehomeGrant(actor, effect) {
      const grant = this.grantPayload(effect);
      if (!actor || !grant) return false;
      try {
        await effect.unsetFlag('dx3rd-emanim', this.GRANT_FLAG);
        const source = actor.items?.get?.(grant.sourceItemId)
          || {id: grant.sourceItemId, name: effect.name, img: effect.img};
        await this.createGrantEffect(actor, source, grant, {reuseHost: false});
        return true;
      } catch (e) {
        console.error('DX3rd | 장비 변경 표식 재배치 실패:', e);
        return false;
      }
    },

    /**
     * The other half of grantHost: the applied AE can arrive **after** the marker.
     *
     * On the activation route the marker is written by the activation router while the toggle AE is still being
     * created (DX3rdAppliedToggle syncs on a 50ms debounce, and the router runs from an un-awaited hook), so
     * ordering alone cannot guarantee one document. When an applied AE for that item shows up, it takes one
     * orphan marker's payload over and the orphan is removed — flag first, so the delete hook reverts nothing.
     *
     * Only one orphan is adopted per applied AE: a flag holds one payload, and fist markers deliberately stack.
     */
    async adoptOrphanGrants(actor, hostEffect) {
      const itemId = hostEffect?.getFlag?.('dx3rd-emanim', 'applied')?.itemId
        || this.appliedKeyItemId(hostEffect?.getFlag?.('dx3rd-emanim', 'appliedKey'));
      if (!actor || !itemId || this.grantPayload(hostEffect)) return false;
      const orphan = (actor.effects ?? []).find(effect => effect.id !== hostEffect.id
        && !effect.getFlag?.('dx3rd-emanim', 'appliedKey')
        && this.grantPayload(effect)?.sourceItemId === itemId);
      if (!orphan) return false;
      const payload = this.grantPayload(orphan);
      try {
        await orphan.unsetFlag('dx3rd-emanim', this.GRANT_FLAG);
        await hostEffect.setFlag('dx3rd-emanim', this.GRANT_FLAG, payload);
        await actor.deleteEmbeddedDocuments('ActiveEffect', [orphan.id]);
        return true;
      } catch (e) {
        console.error('DX3rd | 장비 변경 표식 흡수 실패:', e);
        return false;
      }
    },

    /** The source item id spelled out by a legacy applied key. */
    appliedKeyItemId(appliedKey) {
      const key = String(appliedKey || '');
      for (const prefix of ['toggle:', 'applied_self_', 'applied_']) {
        if (key.startsWith(prefix)) return key.slice(prefix.length);
      }
      return null;
    },

    /** Every AE carrying a grant payload for that source item (the applied host included). */
    grantEffectsForItem(actor, itemId) {
      if (!actor || !itemId) return [];
      return (actor.effects ?? []).filter(effect => this.grantPayload(effect)?.sourceItemId === itemId);
    },

    /**
     * Delete every grant an item owns — the explicit "remove this effect and everything it made" path.
     * The creations themselves are taken back by the delete hook, never here.
     */
    async removeItemGrants(actor, itemId) {
      const ids = this.grantEffectsForItem(actor, itemId).map(effect => effect.id);
      if (ids.length) await actor.deleteEmbeddedDocuments('ActiveEffect', ids);
      return ids.length;
    },

    /**
     * Take back what an item's **activation** created, when that activation is switched off.
     *
     * An activation-bound creation is alive for exactly as long as the item is switched on — that is what choosing
     * 활성화 on the card means — so turning the toggle off has to be the same event as deleting the marker. Only
     * grants whose recorded action is 'activation' are cleared: a creation made by *using* the item has its own
     * lifetime (its marker, or the scene) and must survive the item's activation state changing underneath it.
     *
     * The items themselves are removed by the delete hook, not here — one restore path, never two.
     */
    async clearActivationGrants(actor, item) {
      const ids = (actor?.effects ?? [])
        .filter(effect => {
          const grant = this.grantPayload(effect);
          return grant?.action === 'activation' && grant.sourceItemId === item?.id;
        })
        .map(effect => effect.id);
      if (ids.length) await actor.deleteEmbeddedDocuments('ActiveEffect', ids);
      return ids.length;
    },

    /**
     * Cleanup for when an equipment-change marker disappears. Called by the `deleteActiveEffect` hook.
     * A created weapon is removed and the fist is re-aligned **by recomputing from the remaining markers**.
     */
    async revertItemGrant(actor, effect) {
      const grant = this.grantPayload(effect);
      if (!actor || !grant) return;

      // Every creating kind (weapon / protect / vehicle) is settled by the id list it recorded, so adding a fourth
      // creating extension needs no new branch here.
      if (Array.isArray(grant.createdItemIds)) {
        const ids = grant.createdItemIds.filter(id => actor.items.get(id));
        if (ids.length) await actor.deleteEmbeddedDocuments('Item', ids);
        return;
      }

      if (grant.kind !== 'fist') return;
      const fistItem = actor.items.get(grant.fistItemId) || this.findFistItem(actor);
      if (!fistItem) return;

      // This AE is already deleted. If any remain, rebuild from the newest replacement plus every additive marker.
      const remaining = this.fistGrantEffects(actor, effect.id);
      if (remaining.length) {
        await this.realignFistItem(actor, fistItem, effect.id);
        return;
      }
      // They are all gone → back to the bottom of the stack (the first original).
      await this.restoreFistItems(actor);
    },

    /**
     * Delete every equipment-change marker on that actor. The actual reverting is done by the delete hook, so
     * **do NOT rewrite the restore logic here** — two copies will inevitably diverge.
     */
    async clearItemGrants(actor) {
      const ids = (actor?.effects ?? []).filter(e => this.grantPayload(e)).map(e => e.id);
      if (ids.length) await actor.deleteEmbeddedDocuments('ActiveEffect', ids);
      return ids.length;
    },

    /**
     * Revert the fist data to what it was before the change. The **single restore path** shared by the end of a
     * scene / combat and the scene control's reset. An item with no snapshot is skipped.
     * @returns {number} the number of items reverted
     */
    async restoreFistItems(actor) {
      let restored = 0;
      for (const it of actor?.items ?? []) {
        if (it.type !== 'weapon') continue;
        const original = it.getFlag('dx3rd-emanim', 'fistOriginal');
        if (!original) continue;
        const update = { name: original.name || game.i18n.localize('DX3rd.Fist') };
        for (const key of this.FIST_MUTABLE_FIELDS) {
          if (original[key] !== undefined) update[`system.${key}`] = original[key];
        }
        await it.update(update);
        await it.unsetFlag('dx3rd-emanim', 'fistOriginal');
        restored++;
      }
      return restored;
    },

    /**
     * Update fist item from extension data
     * @param {Actor} actor
     * @param {Object} data
     * @param {Item} item - Source item (optional)
     */
    async updateFistItem(actor, data, item = null) {
      const fistName = game.i18n.localize('DX3rd.Fist');
      const additive = data.fistAdditive === true;

      // Additive changes need a marker so that later replacements can be recomposed around them. They therefore
      // cannot use the marker-less permanent-replacement route.
      if (additive && data.fistPermanent) {
        console.warn('DX3rd | An additive fist change cannot also be a permanent replacement; treating it as temporary.');
      }
      const permanent = data.fistPermanent === true && !additive;

      // Find the existing fist item (named fist, or ending in [fist])
      const fistItem = this.findFistItem(actor);

      if (fistItem) {
        // Keep the original before overwriting. Without it there is no basis to restore from.
        //
        // **A permanent change is the exception.** Cyber Arm replaces the fist **permanently on acquisition**, not
        // "for that scene" (per the weapons pack document: "this item is obtained when the [Cyber Arm] effect is acquired"),
        // so it is not something to revert. Leaving no snapshot makes `restoreFistItems` skip this item entirely —
        // that is, "do not restore" is expressed by "leave no basis".
        //
        // Using a scene-limited effect such as Claws of Destruction afterwards takes a snapshot at that moment, and the
        // restore's destination becomes **the Cyber Arm state** rather than the default fist. That is what the rules say.
        if (!permanent) await this.snapshotFistItem(fistItem);
        // Get the item's level (1 when absent)
        const itemLevel = (item ? window.DX3rdFormulaEvaluator.getItemLevel(item) : 0) || 1;
        const itemForFormula = { type: item?.type || 'effect', system: { level: { value: itemLevel } } };
        
        
        // Build the new name: "enteredName[fist]"
        const newName = data.name ? `${data.name}[${fistName}]` : fistName;
        
        // Evaluate the formulas
        const evaluatedAdd = this.evaluateFormulaForExtension(data.add, itemForFormula, actor);
        const evaluatedAttack = this.evaluateFormulaForExtension(data.attack, itemForFormula, actor);
        const evaluatedGuard = this.evaluateFormulaForExtension(data.guard, itemForFormula, actor);
        const evaluatedRange = this.evaluateFormulaForExtension(data.range, itemForFormula, actor, true);
        
        // Update the existing fist item
        const applied = additive ? {
          add: evaluatedAdd,
          attack: evaluatedAttack,
          guard: evaluatedGuard
        } : {
          name: newName,
          type: data.type || 'melee',
          skill: data.skill || 'melee',
          add: evaluatedAdd,
          attack: evaluatedAttack,
          guard: evaluatedGuard,
          range: evaluatedRange
        };
        // A permanent change gets no marker — with no basis to revert (no snapshot), a deletable marker would be
        // the lie of "I deleted it and nothing happened".
        if (!permanent) {
          await this.createOrRefreshFistGrant(
            actor, item, fistItem, applied, data, additive ? 'additive' : 'replace');
          await this.realignFistItem(actor, fistItem);
        } else {
          const update = { name: applied.name };
          for (const key of this.FIST_MUTABLE_FIELDS) update[`system.${key}`] = applied[key];
          await fistItem.update(update);
        }
      } else {
        // Create one when there is no fist item
        // Get the item's level (1 when absent)
        const itemLevel = (item ? window.DX3rdFormulaEvaluator.getItemLevel(item) : 0) || 1;
        const itemForFormula = { type: item?.type || 'effect', system: { level: { value: itemLevel } } };
        
        const newName = data.name ? `${data.name}[${fistName}]` : fistName;
        
        
        // Evaluate the formulas
        const evaluatedAdd = this.evaluateFormulaForExtension(data.add, itemForFormula, actor);
        const evaluatedAttack = this.evaluateFormulaForExtension(data.attack, itemForFormula, actor);
        const evaluatedGuard = this.evaluateFormulaForExtension(data.guard, itemForFormula, actor);
        const evaluatedRange = this.evaluateFormulaForExtension(data.range, itemForFormula, actor, true);
        
        const itemData = {
          name: newName,
          type: 'weapon',
          img: item?.img || undefined, // use the source item's image
          system: {
            type: data.type || 'melee',
            skill: data.skill || 'melee',
            add: evaluatedAdd,
            attack: evaluatedAttack,
            guard: evaluatedGuard,
            range: evaluatedRange,
            equipment: false,
            active: {
              state: false,
              disable: 'notCheck',
              runTiming: 'instant'
            },
            used: {
              state: 0,
              max: 0,
              disable: 'notCheck'
            },
            'attack-used': {
              state: 0,
              max: 0,
              disable: 'notCheck'
            }
          },
          // This is the branch that creates a fist because none existed. The restore's destination is the default fist
          // rather than a "pre-change value", so the defaults go into the snapshot — without them this one item would
          // be left out of the restore forever. A permanent change leaves no snapshot at all, for the reason above.
          flags: permanent ? {} : {
            'dx3rd-emanim': {
              fistOriginal: { name: fistName, ...this.defaultFistSystem() }
            }
          }
        };

        const [madeFist] = await actor.createEmbeddedDocuments('Item', [itemData]);
        if (!permanent) {
          const applied = additive ? {
              add: evaluatedAdd,
              attack: evaluatedAttack,
              guard: evaluatedGuard
            } : {
              name: newName,
              type: data.type || 'melee',
              skill: data.skill || 'melee',
              add: evaluatedAdd,
              attack: evaluatedAttack,
              guard: evaluatedGuard,
              range: evaluatedRange
            };
          await this.createOrRefreshFistGrant(
            actor, item, madeFist, applied, data, additive ? 'additive' : 'replace');
          await this.realignFistItem(actor, madeFist);
        }
      }
    },

    /**
     * Create protect item from extension data
     * @param {Actor} actor
     * @param {Object} data
     * @param {Item} item - Source item (optional)
     * @returns {Array} Created items
     */
    async createProtectItem(actor, data, item = null) {
      const itemName = `${data.name}${game.i18n.localize('DX3rd.TemporaryItem')}`;
      
      // Get the item's level (1 when absent) — reflecting the encroachment correction dynamically
      const itemLevel = (item ? window.DX3rdFormulaEvaluator.getItemLevel(item) : 0) || 1;
      const itemForFormula = { type: item?.type || 'effect', system: { level: { value: itemLevel } } };
      
      
      const evaluatedDodge = this.evaluateFormulaForExtension(data.dodge, itemForFormula, actor);
      const evaluatedInit = this.evaluateFormulaForExtension(data.init, itemForFormula, actor);
      const evaluatedArmor = this.evaluateFormulaForExtension(data.armor, itemForFormula, actor);

      const itemData = {
        name: itemName,
        type: 'protect',
        img: item?.img || undefined, // use the source item's image
        system: {
          dodge: evaluatedDodge,
          init: evaluatedInit,
          armor: evaluatedArmor,
          equipment: false,
          active: {
            state: false,
            disable: 'notCheck',
            runTiming: 'instant'
          },
          used: {
            state: 0,
            max: 0,
            disable: 'notCheck'
          }
        }
      };

      const createdItem = await actor.createEmbeddedDocuments('Item', [itemData]);
      // Armour and vehicles are created by the same extension family as weapons and had no marker, so the item
      // they created could never be taken back — deleting the effect left the temporary armour on the actor forever.
      await this.createItemGrant(actor, item, 'protect', [createdItem[0]], data);
      return [createdItem[0]];
    },

    /**
     * Create vehicle item from extension data
     * @param {Actor} actor
     * @param {Object} data
     * @param {Item} item - Source item (optional)
     * @returns {Array} Created items
     */
    async createVehicleItem(actor, data, item = null) {
      const itemName = `${data.name}${game.i18n.localize('DX3rd.TemporaryItem')}`;
      
      // Get the item's level (1 when absent) — reflecting the encroachment correction dynamically
      const itemLevel = (item ? window.DX3rdFormulaEvaluator.getItemLevel(item) : 0) || 1;
      const itemForFormula = { type: item?.type || 'effect', system: { level: { value: itemLevel } } };
      
      
      const evaluatedAttack = this.evaluateFormulaForExtension(data.attack, itemForFormula, actor);
      const evaluatedInit = this.evaluateFormulaForExtension(data.init, itemForFormula, actor);
      const evaluatedArmor = this.evaluateFormulaForExtension(data.armor, itemForFormula, actor);
      const evaluatedMove = this.evaluateFormulaForExtension(data.move, itemForFormula, actor);

      const itemData = {
        name: itemName,
        type: 'vehicle',
        img: item?.img || undefined, // use the source item's image
        system: {
          skill: data.skill || 'melee',
          attack: evaluatedAttack,
          init: evaluatedInit,
          armor: evaluatedArmor,
          move: evaluatedMove,
          equipment: false,
          active: {
            state: false,
            disable: 'notCheck',
            runTiming: 'instant'
          },
          used: {
            state: 0,
            max: 0,
            disable: 'notCheck'
          }
        }
      };

      const createdItem = await actor.createEmbeddedDocuments('Item', [itemData]);
      await this.createItemGrant(actor, item, 'vehicle', [createdItem[0]], data);
      return [createdItem[0]];
    },

    /**
     * Evaluate formula for item extension
     * @param {string} formula - Formula to evaluate
     * @param {Object} dummyItem - Dummy item with level=1
     * @param {Actor} actor - Actor for context
     * @returns {string} Evaluated value as string
     */
    evaluateFormulaForExtension(formula, dummyItem, actor, isRangeField = false) {
      try {
        // Handle an empty value
        if (!formula || formula === '' || formula === '-') {
          return '0';
        }
        
        // For a Range field, return the string as-is ("contact", "unlimited", …)
        if (isRangeField && isNaN(Number(formula))) {
          return formula;
        }
        
        // Already a number: return it converted to a string
        if (typeof formula === 'number') {
          return String(formula);
        }
        
        // Evaluate the formula through FormulaEvaluator
        const evaluated = window.DX3rdFormulaEvaluator.evaluate(formula, dummyItem, actor);
        
        // Convert the result to a string (keeping the sign)
        const result = evaluated >= 0 ? `+${evaluated}` : String(evaluated);
        
        return result;
      } catch (e) {
        console.error('DX3rd | evaluateFormulaForExtension failed', e);
        return '0';
      }
    },

    /**
     * Show equipment selection dialog after creating items
     * @param {Actor} actor
     * @param {Array} createdItems - Array of created item data
     * @param {string} itemType - 'weapon', 'protect', or 'vehicle'
     */
    async showEquipmentSelectionDialog(actor, createdItems, itemType) {
      try {
        // Get every item of that type
        const allItems = actor.items.filter(item => item.type === itemType);
        
        // Order: currently equipped → newly created → the rest
        const sortedItems = this.sortItemsForEquipmentDialog(allItems, createdItems);
        
        // Prepare the dialog data
        const dialogData = {
          actor: actor,
          items: sortedItems || [],
          createdItemIds: createdItems.map(item => item.id) || [],
          itemType: itemType || 'weapon',
          title: this.getEquipmentDialogTitle(itemType) || 'Equipment Selection'
        };


        // Show the dialog and wait for it to finish
        const dialog = new DX3rdEquipmentSelectionDialog(dialogData);
        dialog.render(true);
        
        // Wait until the dialog closes
        const result = await dialog.promise;
        window.DX3rdDebug.log('DX3rd | Equipment selection dialog completed:', result);
        return result;
      } catch (e) {
        console.error('DX3rd | showEquipmentSelectionDialog failed', e);
        return { confirmed: false };
      }
    },

    /**
     * Sort items for equipment dialog display
     * @param {Array} allItems
     * @param {Array} createdItems
     * @returns {Array} Sorted items
     */
    sortItemsForEquipmentDialog(allItems, createdItems) {
      const createdIds = createdItems.map(item => item.id);
      
      return allItems.sort((a, b) => {
        const aIsEquipped = a.system.equipment;
        const bIsEquipped = b.system.equipment;
        const aIsCreated = createdIds.includes(a.id);
        const bIsCreated = createdIds.includes(b.id);
        
        // 1. The currently equipped items
        if (aIsEquipped && !bIsEquipped) return -1;
        if (!aIsEquipped && bIsEquipped) return 1;
        
        // 2. The newly created items
        if (aIsCreated && !bIsCreated) return -1;
        if (!aIsCreated && bIsCreated) return 1;
        
        // 3. The rest keep their existing order (by name)
        return a.name.localeCompare(b.name);
      });
    },

    /**
     * Get equipment dialog title based on item type
     * @param {string} itemType
     * @returns {string} Localized title
     */
    getEquipmentDialogTitle(itemType) {
      const titles = {
        'weapon': 'DX3rd.Weapon',
        'protect': 'DX3rd.Protect', 
        'vehicle': 'DX3rd.Vehicle'
      };
      return game.i18n.localize(titles[itemType] || 'DX3rd.Item');
    },
  });

  // When an equipment-change marker disappears, revert that change.
  //
  // **It reacts to deletion only.** An `updateActiveEffect` hook is deliberately absent — this marker's contract is
  // that disabling merely has core drop it from `appliedEffects`, turning off the token overlay icon while leaving
  // the weapon / fist data alone. Adding a disabled reaction here would make "switch it off for a moment" equal
  // destruction, so the creations never come back on switching it on again. **Do not bring it back.**
  //
  // Only one client runs it (`game.user.id !== userId`). With everyone running, the same item deletion would be
  // attempted once per user and race.
  // An applied AE created after its item's marker takes that marker over, so the item ends up with one document
  // however the two calls happened to interleave (see adoptOrphanGrants).
  Hooks.on('createActiveEffect', async (effect, options, userId) => {
    if (game.user.id !== userId) return;
    const actor = effect?.parent;
    if (!actor?.items) return;
    if (!effect.getFlag?.('dx3rd-emanim', 'appliedKey')) return;
    try {
      await window.DX3rdUniversalHandler?.adoptOrphanGrants?.(actor, effect);
    } catch (e) {
      console.error('DX3rd | 장비 변경 표식 흡수 실패:', e);
    }
  });

  Hooks.on('deleteActiveEffect', async (effect, options, userId) => {
    if (game.user.id !== userId) return;
    const actor = effect?.parent;
    if (!actor?.items) return;
    const H = window.DX3rdUniversalHandler;
    if (!H?.grantPayload?.(effect)) return;
    try {
      await H.revertItemGrant(actor, effect);
    } catch (e) {
      console.error('DX3rd | 장비 변경 표식 정리 실패:', e);
    }
  });
})();
