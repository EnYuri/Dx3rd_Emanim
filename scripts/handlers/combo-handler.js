// The combo item handler
(function() {
window.DX3rdDebug.log("DX3rd | ComboHandler script loading...");

window.DX3rdComboHandler = {
    /**
     * Before paying the cost, confirm that a check-type combo can actually enter its check.
     * An enemy's fixed accuracy-result attack can use the existing shortcut path without a stat.
     */
    validateUse(actor, item) {
        const rollType = item?.system?.roll ?? '-';
        if (rollType === '-') return true;
        const fixedEnemyAttack = actor?.type === 'enemy'
            && item.system?.attackAchievement
            && item.system.attackAchievement !== '-'
            && item.system.attackAchievement !== ''
            && item.system?.attackRoll
            && item.system.attackRoll !== '-';
        if (fixedEnemyAttack) return true;
        return !!this.resolveComboStat(actor, item);
    },

    /**
     * Get the display name from a skill key (custom skills and localization included)
     */
    /** The skill display name. The actual logic is shared with effect through DX3rdSkillManager. */
    getSkillDisplayName(skillKey, skillStat) {
        return window.DX3rdSkillManager.getSkillDisplayName(skillKey, skillStat);
    },

    /**
     * Resolve the check stat / label from a combo's skill setting (shared).
     * - Handles attributes (body/sense/mind/social), syndromes, text, Cthulhu Mythos and ordinary skills (+ a custom base)
     * - Finding F: unified so the weapon check path (handleComboRollWithWeapon) and the ordinary path resolve identically
     * @returns {{stat:object, label:string}|null} null after a warning on failure
     */
    resolveComboStat(actor, item) {
        const skillKey = item.system?.skill;
        if (!skillKey || skillKey === '-') {
            ui.notifications.warn('콤보의 기능이 설정되지 않았습니다.');
            return null;
        }

        const attributes = ['body', 'sense', 'mind', 'social'];
        let stat = null;
        let label = '';

        if (attributes.includes(skillKey)) {
            // An attribute
            stat = actor.system.attributes[skillKey];
            label = game.i18n.localize(`DX3rd.${skillKey.charAt(0).toUpperCase() + skillKey.slice(1)}`);
        } else if (skillKey === 'syndrome') {
            // A syndrome
            stat = actor.system.attributes.syndrome;
            label = stat?.name || game.i18n.localize('DX3rd.Syndrome');
            if (label && label.startsWith('DX3rd.')) label = game.i18n.localize(label);
        } else if (skillKey === 'text') {
            // Text
            stat = actor.system.attributes.text;
            label = stat?.name || game.i18n.localize('DX3rd.Text');
            if (label && label.startsWith('DX3rd.')) label = game.i18n.localize(label);
        } else if (skillKey === 'cthulhu') {
            // Cthulhu Mythos
            stat = actor.system.attributes.skills?.cthulhu;
            label = stat?.name || game.i18n.localize('DX3rd.cthulhu');
            if (label && label.startsWith('DX3rd.')) label = game.i18n.localize(label);
        } else {
            // A skill — check the system.base setting
            const customBase = item.system?.base;
            if (customBase && customBase !== '-' && attributes.includes(customBase)) {
                // Using a custom base — compute the skill's modifier
                const baseStat = actor.system.attributes[customBase];
                const skillStat = actor.system.attributes.skills?.[skillKey];
                const originalBaseStat = actor.system.attributes[skillStat?.base];

                if (baseStat && skillStat && originalBaseStat) {
                    // The skill's own modifier
                    const skillDiceBonus = (skillStat.dice || 0) - (originalBaseStat.dice || 0);
                    const skillAddBonus = (skillStat.add || 0) - (originalBaseStat.add || 0);

                    // Build a new stat object from the custom base plus the skill modifier
                    stat = {
                        ...baseStat,
                        dice: (baseStat.dice || 0) + skillDiceBonus,
                        add: (baseStat.add || 0) + skillAddBonus,
                        major: {
                            dice: (baseStat.major?.dice || 0) + skillDiceBonus,
                            add: (baseStat.major?.add || 0) + skillAddBonus,
                            critical: baseStat.major?.critical || 10
                        },
                        reaction: {
                            dice: (baseStat.reaction?.dice || 0) + skillDiceBonus,
                            add: (baseStat.reaction?.add || 0) + skillAddBonus,
                            critical: baseStat.reaction?.critical || 10
                        },
                        dodge: {
                            dice: (baseStat.dodge?.dice || 0) + skillDiceBonus,
                            add: (baseStat.dodge?.add || 0) + skillAddBonus,
                            critical: baseStat.dodge?.critical || 10
                        }
                    };

                    const skillLabel = this.getSkillDisplayName(skillKey, skillStat);
                    label = `${game.i18n.localize(`DX3rd.${customBase.charAt(0).toUpperCase() + customBase.slice(1)}`)}(${skillLabel})`;
                    window.DX3rdDebug.log(`DX3rd | ComboHandler - Using custom base: ${customBase} for skill: ${skillKey}`);
                    window.DX3rdDebug.log(`DX3rd | ComboHandler - Skill bonus: dice=${skillDiceBonus}, add=${skillAddBonus}`);
                } else {
                    // Fallback: use the default base
                    stat = baseStat;
                    label = game.i18n.localize(`DX3rd.${customBase.charAt(0).toUpperCase() + customBase.slice(1)}`);
                }
            } else {
                // Use the default skill
                stat = actor.system.attributes.skills?.[skillKey];
                if (stat) label = this.getSkillDisplayName(skillKey, stat);
            }
        }

        if (!stat) {
            ui.notifications.warn('기능 데이터를 찾을 수 없습니다.');
            return null;
        }

        return { stat, label };
    },

    async handle(actorId, itemIdOrObject, getTarget, options = {}) {
        window.DX3rdDebug.log("DX3rd | ComboHandler handle called", { actorId, itemIdOrObject, getTarget });
        
        const actor = game.actors.get(actorId);
        if (!actor) { 
            ui.notifications.warn(game.i18n.localize('DX3rd.ActorNotFound'));
            return false;
        }
        
        // A string itemIdOrObject is looked up in the actor's items; an object is used as-is (a temporary combo)
        let item;
        if (typeof itemIdOrObject === 'string') {
            // Look in the actor's items first, then fall back to game.items
            item = actor.items.get(itemIdOrObject) || game.items.get(itemIdOrObject);
            if (!item) { 
                ui.notifications.warn(game.i18n.localize('DX3rd.ItemNotFound'));
                return false;
            }
        } else if (typeof itemIdOrObject === 'object') {
            // A temporary combo item object
            item = itemIdOrObject;
            window.DX3rdDebug.log("DX3rd | ComboHandler - Using temporary combo item", item);
        } else {
            ui.notifications.warn(game.i18n.localize('DX3rd.InvalidItemParameter'));
            return false;
        }
        const comboAction = window.DX3rdItemEffectAdapter?.invocationAction?.(item) || 'attack';
        if (!this.validateUse(actor, item)) return false;

        // 0. A temporary combo (an object built in the builder) never goes through handleItemUse, so the cost is settled here.
        //    A stored combo (a string id) has already had processItemUsageCost called by handleItemUse, so it is not settled twice.
        //    What is settled: the encroachment total (rules 807-809), the HP cost, the use gates and the unified use message.
        //    Incrementing the effects' use counts belongs to processInstantExtensions, so it does not overlap with the cost settlement.
        if (typeof itemIdOrObject === 'object') {
            const usageAllowed = await window.DX3rdUniversalHandler.processItemUsageCost(actor, item, {
                action: comboAction,
                rollType: options.rollType
            });
            if (!usageAllowed) {
                window.DX3rdDebug.log("DX3rd | ComboHandler - Temp combo usage blocked by cost gate");
                return false;
            }
        }

        // 1. Merge and run the instant extensions (shared — independent of roll type)
        await this.processInstantExtensions(actor, item, comboAction, {
            skipWeaponAttackSpend: options.reroll === true
        });

        // 2. Branch on the combo roll type
        const rollType = window.DX3rdUniversalHandler.resolveInvocationRollType(item, options);
        
        if (rollType === '-') {
            // No-roll: only the instant work was needed, so we are done
            window.DX3rdDebug.log("DX3rd | ComboHandler - No-roll combo completed");
        } else {
            // Roll: show the roll dialog (afterSuccess is handled from the chat button)
            const rollStarted = await this.handleComboRoll(actor, item, rollType, getTarget, options);
            if (rollStarted === false) return false;
        }

        // The post-use callback attached by the calling context (a defense dialog, say). A check-type combo does not
        // wait for the roll dialog, so what it covers here is the instant extensions and self effects already applied.
        // The check result itself comes back separately through meta.afterRollCallback.
        const afterUseCallback = item.meta?.afterUseCallback;
        if (typeof afterUseCallback === 'function') {
            try {
                await afterUseCallback({ actor, item, rolled: rollType !== '-' });
            } catch (e) {
                console.warn('DX3rd | ComboHandler - afterUseCallback threw', e);
            }
        }
        return true;
    },
    
    /**
     * A combined member item's existing trigger action. Combo inclusion never changes it,
     * and in particular never implies "activation".
     */
    comboMemberAction(memberItem, fallback = 'attack') {
        const adapter = window.DX3rdItemEffectAdapter;
        return adapter?.comboMemberAction?.(memberItem, fallback)
            || adapter?.invocationAction?.(memberItem)
            || fallback;
    },

    /**
     * A combo's ordinary member slots. The weapon slot is handled separately by the attack-value and attack-used paths;
     * merging it in here would also fire a weapon's optional "use" effects automatically.
     */
    comboMemberEntries(actor, comboItem) {
        const handler = window.DX3rdUniversalHandler;
        return (handler?.comboMemberItems?.(actor, comboItem) || [])
            .map(item => ({item, role: 'member'}));
    },

    /**
     * Does a member's self modifiers have a bucket that fires at the current action and timing?
     * An activation bucket is never lit automatically by a combo; only an explicit use bucket is allowed separately.
     */
    memberSelfModifiersFireAt(effectItem, action, timing) {
        const adapter = window.DX3rdItemEffectAdapter;
        if (!adapter) {
            const active = effectItem.system?.active || {};
            return action === 'use' && active.runTiming === timing && active.disable !== 'notCheck';
        }
        return adapter.selfFiresAt(effectItem, action, timing);
    },

    /** Legacy member extensions preserve use and attack, but never activation.
     * Costs and runtime prompts use this same predicate as collection.
     */
    memberExtensionActionMatches(item, kind, data) {
        const adapter = window.DX3rdItemEffectAdapter;
        return !adapter || adapter.inferAction(item, kind, data) !== 'activation';
    },

    async retainInstantComboFollowups(item, afterSuccessData, afterDamageData) {
        if (!window.DX3rdIsInstantCombo?.(item)) return;
        const retention = window.DX3rdInstantComboRetention;
        await retention?.retain?.(item, {
            afterSuccess: retention?.hasFollowupWork?.(afterSuccessData) === true,
            afterDamage: retention?.hasFollowupWork?.(afterDamageData) === true
        });
    },

    /**
     * Collect the extension definitions from the given source items (the combo itself plus its included effects).
     * A unification of the pushExtensionsFrom logic that was copy-pasted across three methods
     * (processInstant / collectAfterSuccess / collectAfterDamage).
     * @param {Actor} actor
     * @param {Array} srcItems - the items carrying extension flags (collected in order, front first)
     * @param {Object} [opts]
     * @param {boolean} [opts.includeItemCreation=true] - whether weapon/protect/vehicle creation extensions are included (false for afterDamage, which is instant-only)
     * @param {string|null} [opts.comboItemId=null] - the combo's own id. When given, the action gate applies to the
     *   combo itself only, and member extensions are all collected as before.
     * @returns {Array} the collected extension definitions
     */
    collectExtensions(actor, srcItems, { includeItemCreation = true, action = 'attack', comboItemId = null } = {}) {
        const collected = [];
        const gatedByAction = srcItem => !comboItemId || srcItem.id === comboItemId;
        for (const srcItem of srcItems) {
            if (!srcItem) continue;
            const gated = gatedByAction(srcItem);
            const ext = srcItem.getFlag('dx3rd-emanim', 'itemExtend') || {};
            // Store the parent item's runTiming (used to decide the extension's registration timing)
            const parentRunTiming = srcItem.system?.active?.runTiming || 'instant';
            const baseData = {
                itemId: srcItem.id,
                itemName: srcItem.name,
                actorId: actor.id,
                parentRunTiming
            };

            const pushIf = (typeKey, d) => {
                if (!d || !d.activate) return;
                // Member extensions preserve both use and attack as before.
                // But combo inclusion alone must never cause activation behavior.
                if (!gated && !this.memberExtensionActionMatches(srcItem, typeKey, d)) return;
                if (typeKey === 'heal' || typeKey === 'damage' || typeKey === 'condition') {
                    if (gated && window.DX3rdItemEffectAdapter
                        && !window.DX3rdItemEffectAdapter.extensionActionMatches(srcItem, typeKey, d, action, d.timing || 'instant')) return;
                    collected.push({
                        type: typeKey, ...baseData,
                        timing: d.timing || 'instant',
                        target: d.target || 'self',
                        formulaDice: d.formulaDice ?? d.dice ?? 0,
                        formulaAdd: d.formulaAdd ?? d.add ?? 0,
                        ignoreReduce: !!d.ignoreReduce,
                        resurrect: !!d.resurrect,
                        rivival: !!d.rivival,
                        conditionType: d.type,
                        poisonedRank: d.poisonedRank || null,
                        disable: d.disable || null,
                        conditionalFormula: !!d.conditionalFormula
                    });
                } else if (typeKey === 'statusClear') {
                    if (gated && window.DX3rdItemEffectAdapter
                        && !window.DX3rdItemEffectAdapter.extensionActionMatches(srcItem, typeKey, d, action, d.timing || 'instant')) return;
                    collected.push({
                        type: typeKey, ...baseData,
                        timing: d.timing || 'instant',
                        target: d.target || 'self',
                        extensionData: d
                    });
                } else if (typeKey === 'weapon' || typeKey === 'protect' || typeKey === 'vehicle') {
                    // Item creation extensions are instant-only (excluded from the afterDamage collection)
                    if (!includeItemCreation) return;
                    if (gated && window.DX3rdItemEffectAdapter
                        && !window.DX3rdItemEffectAdapter.extensionActionMatches(srcItem, typeKey, d, action, 'instant')) return;
                    collected.push({
                        type: typeKey, ...baseData,
                        timing: 'instant',
                        extensionData: d // keep the full data
                    });
                }
            };
            const entries = window.DX3rdItemEffectAdapter?.extensionEntries?.(ext)
                || Object.entries(ext).map(([type, data]) => ({type, data}));
            for (const entry of entries) pushIf(entry.type, entry.data);
        }
        return collected;
    },

    /**
     * Merge and run the instant extensions (shared handling, independent of roll type).
     * Collects, merges and runs the instant extensions of the combo plus its included effects.
     */
    async processInstantExtensions(actor, item, action = null, options = {}) {
        window.DX3rdDebug.log("DX3rd | ComboHandler - Processing instant extensions (common for all roll types)");
        const handler = window.DX3rdUniversalHandler;
        if (!handler) return;
        action ||= window.DX3rdItemEffectAdapter?.invocationAction?.(item) || 'attack';

        // The combo's own instant macros / applied were already run in handleItemUse → avoid duplicates
        window.DX3rdDebug.log('DX3rd | ComboHandler - Skipping combo item instant macro/apply (already done in handleItemUse)');

        // 2) Immediate handling of the member items + extension collection
        const memberEntries = this.comboMemberEntries(actor, item);
        window.DX3rdDebug.log('DX3rd | ComboHandler - Members normalized', {
            members: memberEntries.map(entry => ({ id: entry.item.id, type: entry.item.type, role: entry.role }))
        });

        // Save the currently selected targets (shared when the merged instant work runs)
        const selectedTargetIds = Array.from(game.user.targets || []).map(t => t.id);

        // The combo's own immediate activation / macros / applied are handled in handleItemUse → the extensions are collected together below
        window.DX3rdDebug.log('DX3rd | ComboHandler - Collecting extensions from combo item:', item.name);

        // Increment the attack count of the included weapons.
        //
        // **The only case incremented here is the enemy accuracy-result path.**
        // (1) An attack-check combo (attackRoll !== '-') has chat-ui's damage-roll-btn handler increment only the
        //     weapons actually used (data-weapon-ids) at damage-roll time. Incrementing early here is not only a
        //     double increment — calculateRegisteredWeaponBonus would see that weapon as "already exhausted" and drop
        //     its bonus, so the weapon's values vanish from the very attack that used it.
        // (2) A non-attack combo (attackRoll === '-') **never uses the registered weapons at all** —
        //     both call sites of calculateRegisteredWeaponBonus are inside the attackRoll gate, so the weapon rides
        //     into neither the check nor the damage. It nonetheless used to spend the attack count here, and since
        //     this spot has no exhaustion gate (every other spend site either reads allowExhaustedUse or reports
        //     through reportUsageExhausted) it quietly went over max.
        //     The combo sheet's weapon picker appears regardless of attackRoll, so authoring alone reaches this path.
        // (3) Only the enemy accuracy-result path is handled without a roll and puts no weapon id on the damage button
        //     (chat-ui's increment handler never runs), so it must be incremented here.
        const isAttackCombo = item.system?.attackRoll && item.system.attackRoll !== '-';
        const isEnemyAchievementShortcut = actor.type === 'enemy' &&
            item.system?.attackAchievement && item.system.attackAchievement !== '-' && item.system.attackAchievement !== '' &&
            isAttackCombo;
        const skipPreIncrement = !isEnemyAchievementShortcut || options.skipWeaponAttackSpend === true;
        const weaponIds = item.system?.weapon || [];
        if (!skipPreIncrement && Array.isArray(weaponIds) && weaponIds.length > 0) {
            for (const weaponId of weaponIds) {
                if (!weaponId || weaponId === '-') continue;
                const weaponItem = actor.items.get(weaponId);
                if (!weaponItem) {
                    console.warn('DX3rd | ComboHandler - Weapon item not found:', weaponId);
                    continue;
                }
                // Only the weapon type increments attack-used (a vehicle has no attack-used field)
                if (weaponItem.type === 'weapon') {
                    const attackUsedDisable = weaponItem.system['attack-used']?.disable || 'notCheck';
                    if (attackUsedDisable !== 'notCheck') {
                        const currentAttackUsedState = weaponItem.system['attack-used']?.state || 0;
                        await weaponItem.update({ 'system.attack-used.state': currentAttackUsedState + 1 });
                        window.DX3rdDebug.log('DX3rd | ComboHandler - Weapon attack count increased:', weaponItem.name, currentAttackUsedState, '→', currentAttackUsedState + 1);
                    }
                }
            }
        } else if (skipPreIncrement) {
            const reason = options.skipWeaponAttackSpend === true
                ? 'attack reroll; already spent by the original attack'
                : (isAttackCombo ? 'attack combo; counted at damage roll' : 'non-attack combo; registered weapons are not used');
            window.DX3rdDebug.log(`DX3rd | ComboHandler - Skipping weapon attack-used pre-increment (${reason})`);
        }

        // Increment the use count of the ordinary member items (unless notCheck) — the weapon slot is handled by
        // the separate attack-used path. Doing one update per member would chain that many DB round trips,
        // actor re-derivations and sheet re-renders, making combo activation noticeably slow.
        // A combo is one act of use, so the counters go up in a single write (all of them, before the members run).
        // The type decision was already made by comboMemberEntries (→ isComboMemberItem) — rewriting it here would
        // split the basis of "check, increment, run" yet again.
        const usedUpdates = memberEntries
            .filter(entry => entry.role !== 'weapon')
            .map(entry => entry.item)
            .filter(memberItem => (memberItem.system?.used?.disable || 'notCheck') !== 'notCheck')
            .map(memberItem => ({ _id: memberItem.id, 'system.used.state': (memberItem.system?.used?.state || 0) + 1 }));
        if (usedUpdates.length) {
            await actor.updateEmbeddedDocuments('Item', usedUpdates);
            window.DX3rdDebug.log('DX3rd | ComboHandler - Effect used counts increased (batched):', usedUpdates.length);
        }

        const processedMemberItems = [];
        for (const { item: memberItem, role } of memberEntries) {
            window.DX3rdDebug.log('DX3rd | ComboHandler - Processing member item:', memberItem.name, 'ID:', memberItem.id, 'role:', role);

            // Immediate handling of the member items
            try {
                const memberAction = this.comboMemberAction(memberItem, action);
                if (this.memberSelfModifiersFireAt(memberItem, memberAction, 'instant')) {
                    const toggled = await handler.applySelfModifiers(actor, memberItem, { action: memberAction, timing: 'instant' });
                    window.DX3rdDebug.log(`DX3rd | ComboHandler - Member self modifiers applied (${toggled ? 'toggle' : 'frozen'}):`, memberItem.name);
                }
                await handler.executeMacros(memberItem, 'instant', memberAction);
                await handler.applyToTargets(actor, memberItem, 'instant', null, memberAction);
            } catch (e) {
                console.warn('DX3rd | ComboHandler - member instant process skipped:', memberItem?.name, e);
            }

            processedMemberItems.push(memberItem);
        }
        // The updateItem hook's AE sync is asynchronous. Wait for any sync in flight so a member whose current
        // action bucket is the toggle channel has its modifiers in the actor's derived values before the attack check.
        await window.DX3rdAppliedToggle?.sync?.(actor);

        // Collect all the extensions (the combo itself + every member item)
        const collectedExtensions = this.collectExtensions(actor, [item, ...processedMemberItems], {
            includeItemCreation: true, action, comboItemId: item.id
        });

        window.DX3rdDebug.log('DX3rd | ComboHandler - Total collected extensions before merge:', collectedExtensions.length);
        window.DX3rdDebug.log('DX3rd | ComboHandler - Collected extensions:', collectedExtensions);

        // 3) Merge the extensions (same timing + same target, custom kept separate)
        try {
            const buckets = handler.groupExtensionsByKey(collectedExtensions);
            const merged = handler.mergeGroupedExtensionBuckets(actor, buckets);
            window.DX3rdDebug.log('DX3rd | ComboHandler - Merged extension buckets:', merged);
            window.DX3rdDebug.log('DX3rd | ComboHandler - Bucket count by timing:', {
                instant: merged.filter(b => b.timing === 'instant').length,
                afterMain: merged.filter(b => b.timing === 'afterMain').length,
                afterMainInstant: merged.filter(b => b.timing === 'afterMain' && b.parentRunTiming === 'instant').length,
                afterSuccess: merged.filter(b => b.timing === 'afterSuccess').length,
                afterDamage: merged.filter(b => b.timing === 'afterDamage').length
            });

            // Handle the instant and afterMain buckets
            for (const b of merged) {
                window.DX3rdDebug.log('DX3rd | ComboHandler - Processing bucket:', b.type, 'timing:', b.timing, 'target:', b.target, 'parentRunTiming:', b.parentRunTiming);
                
                // instant runs at once, afterMain is queued, everything else is skipped
                if (b.timing === 'instant') {
                    // The instant timing runs immediately
                    window.DX3rdDebug.log('DX3rd | ComboHandler - Executing instant extension:', b.type);
                    if (b.type === 'heal' && !b.custom) {
                    const healData = {
                        formulaDice: b.merged?.dice || 0,
                        formulaAdd: b.merged?.add || 0,
                        target: b.target,
                        selectedTargetIds,
                        resurrect: b.resurrect || false,
                        rivival: b.rivival || false,
                        // A merged combo trigger — the trigger item name is the combo's name
                        triggerItemName: item.name
                    };
                    await handler.executeHealExtensionNow(actor, healData, null);
                } else if (b.type === 'damage') {
                    const damageData = handler.damageDataFromExtensionBucket(b, {
                        selectedTargetIds,
                        triggerItemName: item.name
                    });
                    await handler.executeDamageExtensionNow(actor, damageData, null);
                } else if (b.type === 'condition' && !b.custom) {
                    // For the same target, different conditions are merged into a single dialog
                    const conditionTypes = b.merged?.conditions || [];
                    await handler.executeConditionExtensionsNowBulk(actor, {
                        conditionTypes,
                        target: b.target,
                        selectedTargetIds,
                        triggerItemName: item.name,
                        poisonedRank: b.poisonedRank || null,
                        itemId: b.sourceItemId || null,
                        duration: b.duration || null,
                        sourceActorId: b.sourceActorId || actor.id
                    });
                } else if (b.type === 'statusClear') {
                    for (const src of b.sources) {
                        const srcItem = actor.items.get(src.itemId);
                        await handler.executeStatusClearExtension(actor, {
                            ...(src.raw.extensionData || {}),
                            target: b.target,
                            selectedTargetIds,
                            triggerItemName: item.name
                        }, srcItem || null);
                    }
                } else if (b.type === 'weapon' || b.type === 'protect' || b.type === 'vehicle') {
                    // Item creation is not merged; one is created per source
                    for (const src of b.sources) {
                        const srcItem = actor.items.get(src.itemId);
                        if (!srcItem) continue;
                        try {
                            await handler.executeItemExtension(actor, b.type, src.raw.extensionData || {}, srcItem);
                            window.DX3rdDebug.log(`DX3rd | ComboHandler - Created ${b.type} from:`, srcItem.name);
                        } catch (e) {
                            console.warn(`DX3rd | ComboHandler - Failed to create ${b.type} from ${srcItem.name}:`, e);
                        }
                    }
                    }
                } else if (b.timing === 'afterMain' && b.parentRunTiming === 'instant') {
                    // The afterMain timing is queued.
                    // But only when parentRunTiming is instant (afterSuccess / afterDamage register at their own timing)
                    window.DX3rdDebug.log('DX3rd | ComboHandler - Registering afterMain extension (parentRunTiming=instant):', b.type, 'merged data:', b.merged);
                    if (b.type === 'heal') {
                        const healData = {
                            formulaDice: b.merged?.dice || 0,
                            formulaAdd: b.merged?.add || 0,
                            target: b.target,
                            selectedTargetIds,
                            resurrect: false,
                            rivival: false,
                            triggerItemName: item.name
                        };
                        window.DX3rdDebug.log('DX3rd | ComboHandler - AfterMain heal data:', healData);
                        await handler.addToAfterMainQueue(actor, healData, null, 'heal');
                    } else if (b.type === 'damage') {
                        const damageData = handler.damageDataFromExtensionBucket(b, {
                            selectedTargetIds,
                            triggerItemName: item.name
                        });
                        window.DX3rdDebug.log('DX3rd | ComboHandler - AfterMain damage data:', damageData);
                        await handler.addToAfterMainQueue(actor, damageData, null, 'damage');
                    } else if (b.type === 'condition') {
                        const conditionData = {
                            conditionTypes: b.merged?.conditions || [],
                            target: b.target,
                            selectedTargetIds,
                            triggerItemName: item.name,
                            poisonedRank: b.poisonedRank || null,
                            itemId: b.sourceItemId || null,
                            duration: b.duration || null,
                            sourceActorId: b.sourceActorId || actor.id
                        };
                        window.DX3rdDebug.log('DX3rd | ComboHandler - AfterMain condition data:', conditionData);
                        await handler.addToAfterMainQueue(actor, conditionData, null, 'condition');
                    } else if (b.type === 'statusClear') {
                        for (const src of b.sources) {
                            const srcItem = actor.items.get(src.itemId);
                            await handler.addToAfterMainQueue(actor, {
                                ...(src.raw.extensionData || {}),
                                target: b.target,
                                selectedTargetIds,
                                triggerItemName: item.name
                            }, srcItem || null, 'statusClear');
                        }
                    }
                } else {
                    // Timings other than instant and afterMain are skipped (afterSuccess and afterDamage are handled separately)
                    window.DX3rdDebug.log('DX3rd | ComboHandler - Skipping bucket (not instant/afterMain):', b.type, 'timing:', b.timing);
                }
            }
        } catch (e) {
            console.warn('DX3rd | ComboHandler - merge/execute instant extensions failed:', e);
        }
    },
    
    /**
     * Collect and merge the afterSuccess extensions (for a combo with a roll).
     * Activations, macros and applied are collected and returned along with them.
     * @returns {Object} { activations: [], macros: [], applies: [], extensions: [merged buckets] }
     */
    async collectAfterSuccessData(actor, item) {
        window.DX3rdDebug.log("DX3rd | ComboHandler - Collecting afterSuccess data for combo:", item.name);
        const handler = window.DX3rdUniversalHandler;
        if (!handler) return null;
        const action = window.DX3rdItemEffectAdapter?.invocationAction?.(item) || 'attack';

        const result = {
            comboItemId: item.id || null,
            activations: [], // { itemId, itemName }
            macros: [],      // { itemId, itemName, macroName, timing }
            applies: [],     // { itemId, itemName }
            extensions: [],  // merged buckets (afterSuccess)
            afterMainExtensions: [], // merged buckets (afterMain, when runTiming is afterSuccess)
            // The hidden source normally remains embedded, but a serialized fallback keeps old chat
            // cards and post-cleanup rerolls able to execute combo-body work.
            comboItemSnapshot: window.DX3rdIsInstantCombo?.(item)
                ? window.DX3rdSerializeInstantCombo(item) : null
        };

        const memberEntries = this.comboMemberEntries(actor, item);
        const selectedTargetIds = Array.from(game.user.targets || []).map(t => t.id);
        // A selected-target modifier must keep the targets from combo use time. Scene-wide
        // modifiers continue through the scene branch in applyToTargets, so they intentionally
        // carry no forced-target snapshot here. An empty array is authoritative: it must not fall
        // back to whichever tokens happen to be targeted when the success button is clicked.
        const frozenTargetData = sourceItem => sourceItem.system?.getTarget && !sourceItem.system?.scene
            ? { selectedTargetIds: [...selectedTargetIds] }
            : {};

        // Collect from the combo itself
        window.DX3rdDebug.log('DX3rd | ComboHandler - Checking combo body for afterSuccess:', {
            activeRunTiming: item.system?.active?.runTiming,
            activeState: item.system?.active?.state,
            effectRunTiming: item.system?.effect?.runTiming,
            getTarget: item.system?.getTarget
        });
        
        // 1) Self modifiers. Read the current action bucket's trigger and expiry timing, not the flat active fields.
        const adapter = window.DX3rdItemEffectAdapter;
        const comboSelfFires = adapter
            ? adapter.selfFiresAt(item, action, 'afterSuccess')
            : item.system?.active?.runTiming === 'afterSuccess';
        const comboSelfPending = adapter
            ? (adapter.hasFrozenSelfBucket(item, action)
                || (adapter.selfToggleBucketMatches(item, action) && !item.system?.active?.state))
            : !item.system?.active?.state;
        if (comboSelfFires && comboSelfPending) {
            result.activations.push({ itemId: item.id, itemName: item.name, action });
            window.DX3rdDebug.log('DX3rd | ComboHandler - Added combo activation:', item.name);
        }
        // 2) Macros. Using the same test as the actual executor, reserve once per item, timing and action.
        // executeMacros handles every legacy and embedded macro matching that execution, in order.
        if (handler.hasExecutableMacros?.(item, 'afterSuccess', action)) {
            result.macros.push({ itemId: item.id, itemName: item.name, timing: 'afterSuccess', action });
            window.DX3rdDebug.log('DX3rd | ComboHandler - Added combo macro run:', item.name);
        }
        // 3) Applied (a combo needs a check for whether applied is present)
        const comboTargetFires = window.DX3rdItemEffectAdapter
            ? window.DX3rdItemEffectAdapter.targetFiresAt(item, action, 'afterSuccess')
            : item.system?.effect?.runTiming === 'afterSuccess';
        if ((item.system?.getTarget || item.system?.scene) && comboTargetFires) {
            // Freeze the bucket now, like afterDamage does — the success button runs detached,
            // after handleItemUse has restored _dx3rdRuntimeInput / _dx3rdUsageEncLevel.
            const comboTargetAttrs = adapter
                ? adapter.targetBucketAttributes(item, action, 'afterSuccess')
                : (item.system?.effect?.attributes || {});
            result.applies.push({ itemId: item.id, itemName: item.name, action, ...frozenTargetData(item),
                frozenAttributes: handler.freezeTransferredItemAttributes?.(actor, item, comboTargetAttrs) || null });
            window.DX3rdDebug.log('DX3rd | ComboHandler - Added combo apply:', item.name);
        }
        // 4) The extensions are all collected below

        // Collect from every member item
        const memberItems = [];
        for (const { item: memberItem, role } of memberEntries) {
            memberItems.push(memberItem);

            window.DX3rdDebug.log('DX3rd | ComboHandler - Checking member for afterSuccess:', memberItem.name, {
                role,
                activeRunTiming: memberItem.system?.active?.runTiming,
                activeState: memberItem.system?.active?.state,
                effectRunTiming: memberItem.system?.effect?.runTiming,
                getTarget: memberItem.system?.getTarget
            });

            const memberAction = this.comboMemberAction(memberItem, action);
            // 1) Self persistent modifiers. Only the existing trigger action is reserved; the activation bucket is not lit.
            if (this.memberSelfModifiersFireAt(memberItem, memberAction, 'afterSuccess')) {
                result.activations.push({ itemId: memberItem.id, itemName: memberItem.name, action: memberAction });
                window.DX3rdDebug.log('DX3rd | ComboHandler - Added member modifiers:', memberItem.name, memberAction);
            }
            // 2) Macros — an item with only embedded macros also reserves a follow-up execution.
            if (handler.hasExecutableMacros?.(memberItem, 'afterSuccess', memberAction)) {
                result.macros.push({
                    itemId: memberItem.id,
                    itemName: memberItem.name,
                    timing: 'afterSuccess',
                    action: memberAction
                });
                window.DX3rdDebug.log('DX3rd | ComboHandler - Added member macro run:', memberItem.name);
            }
            // 3) Applied
            const memberTargetFires = window.DX3rdItemEffectAdapter
                ? window.DX3rdItemEffectAdapter.targetFiresAt(memberItem, memberAction, 'afterSuccess')
                : memberItem.system?.effect?.runTiming === 'afterSuccess';
            if ((memberItem.system?.getTarget || memberItem.system?.scene) && memberTargetFires) {
                const memberTargetAttrs = window.DX3rdItemEffectAdapter
                    ? window.DX3rdItemEffectAdapter.targetBucketAttributes(memberItem, memberAction, 'afterSuccess')
                    : (memberItem.system?.effect?.attributes || {});
                result.applies.push({
                    itemId: memberItem.id,
                    itemName: memberItem.name,
                    action: memberAction,
                    ...frozenTargetData(memberItem),
                    frozenAttributes: handler.freezeTransferredItemAttributes?.(actor, memberItem, memberTargetAttrs) || null
                });
                window.DX3rdDebug.log('DX3rd | ComboHandler - Added member apply:', memberItem.name);
            }
            // 4) The extensions are all collected below
        }

        // Collect all the extensions (the combo itself + every member item)
        const collectedExtensions = this.collectExtensions(actor, [item, ...memberItems], {
            includeItemCreation: true, action, comboItemId: item.id
        });

        // Merge the extensions (afterSuccess + afterMain)
        window.DX3rdDebug.log('DX3rd | ComboHandler - Collected extensions count:', collectedExtensions.length);
        
        // Merge the afterSuccess-timing extensions
        const afterSuccessExtensions = collectedExtensions.filter(e => e.timing === 'afterSuccess');
        window.DX3rdDebug.log('DX3rd | ComboHandler - AfterSuccess extensions count:', afterSuccessExtensions.length);
        if (afterSuccessExtensions.length > 0) {
            const buckets = handler.groupExtensionsByKey(afterSuccessExtensions);
            const merged = handler.mergeGroupedExtensionBuckets(actor, buckets);
            window.DX3rdDebug.log('DX3rd | ComboHandler - Merged afterSuccess buckets:', merged.length);
            result.extensions = merged.map(b => ({
                ...b,
                selectedTargetIds // save the current targets
            }));
        }
        
        // Merge the afterMain-timing extensions (only those whose parentRunTiming is afterSuccess)
        const afterMainExtensions = collectedExtensions.filter(e => 
            e.timing === 'afterMain' && e.parentRunTiming === 'afterSuccess'
        );
        window.DX3rdDebug.log('DX3rd | ComboHandler - AfterMain extensions (parentRunTiming=afterSuccess):', afterMainExtensions.length);
        if (afterMainExtensions.length > 0) {
            const buckets = handler.groupExtensionsByKey(afterMainExtensions);
            const merged = handler.mergeGroupedExtensionBuckets(actor, buckets);
            window.DX3rdDebug.log('DX3rd | ComboHandler - Merged afterMain buckets:', merged.length);
            result.afterMainExtensions = merged.map(b => ({
                ...b,
                selectedTargetIds // save the current targets
            }));
        }

        window.DX3rdDebug.log('DX3rd | ComboHandler - Collected afterSuccess data:', result);
        return result;
    },
    
    /**
     * Collect and merge the afterDamage extensions (for a combo with a roll).
     * The same structure as afterSuccess, but filtered to the afterDamage timing only.
     * @returns {Object} { activations: [], macros: [], applies: [], extensions: [merged buckets] }
     */
    async collectAfterDamageData(actor, item) {
        window.DX3rdDebug.log("DX3rd | ComboHandler - Collecting afterDamage data for combo:", item.name);
        const handler = window.DX3rdUniversalHandler;
        if (!handler) return null;

        const result = {
            comboItemId: item.id || null,
            activations: [], // { itemId, itemName }
            macros: [],      // { itemId, itemName, macroName, timing }
            applies: [],     // { itemId, itemName }
            hitApplies: [],  // { itemId, itemName } — 'afterHit' buckets, resolved against hit targets
            extensions: [],  // merged buckets (afterDamage)
            afterMainExtensions: [], // merged buckets (afterMain, when runTiming is afterDamage)
            comboItemSnapshot: window.DX3rdIsInstantCombo?.(item)
                ? window.DX3rdSerializeInstantCombo(item) : null
        };

        const memberEntries = this.comboMemberEntries(actor, item);
        const selectedTargetIds = Array.from(game.user.targets || []).map(t => t.id);

        // Collect from the combo itself
        // 1) Self modifiers. As on the after-success path, read the attack bucket's own lifetime contract.
        // Reading the flat active.disable directly would silently drop an explicit attack bucket whose disable
        // differs from the default bucket's, or conversely apply a notCheck bucket.
        const adapter = window.DX3rdItemEffectAdapter;
        const comboSelfFires = adapter
            ? adapter.selfFiresAt(item, 'attack', 'afterDamage')
            : item.system?.active?.runTiming === 'afterDamage' && (item.system?.active?.disable ?? '-') !== 'notCheck';
        const comboSelfPending = adapter
            ? (adapter.hasFrozenSelfBucket(item, 'attack')
                || (adapter.selfToggleBucketMatches(item, 'attack') && !item.system?.active?.state))
            : !item.system?.active?.state;
        if (comboSelfFires && comboSelfPending) {
            result.activations.push({ itemId: item.id, itemName: item.name, action: 'attack' });
        }
        // 2) Macros — legacy and embedded are checked by the same test and reserve one execution only.
        if (handler.hasExecutableMacros?.(item, 'afterDamage', 'attack')) {
            result.macros.push({ itemId: item.id, itemName: item.name, timing: 'afterDamage', action: 'attack' });
            window.DX3rdDebug.log('DX3rd | ComboHandler - Added combo macro run (afterDamage):', item.name);
        }
        // 3) Applied
        const comboTargetFires = window.DX3rdItemEffectAdapter
            ? window.DX3rdItemEffectAdapter.targetFiresAt(item, 'attack', 'afterDamage')
            : item.system?.effect?.runTiming === 'afterDamage';
        if ((item.system?.getTarget || item.system?.scene) && comboTargetFires) {
            // Freeze the bucket now — the report/apply runs detached, after handleItemUse has
            // restored _dx3rdRuntimeInput / _dx3rdUsageEncLevel, so a later evaluation would
            // collapse [소비HP]/[input] and read the post-cost level.
            const comboTargetAttrs = adapter
                ? adapter.targetBucketAttributes(item, 'attack', 'afterDamage')
                : (item.system?.effect?.attributes || {});
            result.applies.push({ itemId: item.id, itemName: item.name, action: 'attack',
                frozenAttributes: handler.freezeTransferredItemAttributes?.(actor, item, comboTargetAttrs) || null });
        }
        // 3b) Applied on hit — 'afterHit' buckets resolve against attackHit, not HP loss.
        const comboHitFires = adapter
            ? adapter.targetFiresAt(item, 'attack', 'afterHit')
            : item.system?.effect?.runTiming === 'afterHit';
        if ((item.system?.getTarget || item.system?.scene) && comboHitFires) {
            const comboHitAttrs = adapter
                ? adapter.targetBucketAttributes(item, 'attack', 'afterHit')
                : (item.system?.effect?.attributes || {});
            result.hitApplies.push({ itemId: item.id, itemName: item.name, action: 'attack',
                frozenAttributes: handler.freezeTransferredItemAttributes?.(actor, item, comboHitAttrs) || null });
        }
        // 4) The extensions are all collected below

        // Collect from every member item
        const memberItems = [];
        for (const { item: memberItem, role } of memberEntries) {
            memberItems.push(memberItem);

            const memberAction = this.comboMemberAction(memberItem, 'attack');
            // 1) Self persistent modifiers
            if (this.memberSelfModifiersFireAt(memberItem, memberAction, 'afterDamage')) {
                result.activations.push({ itemId: memberItem.id, itemName: memberItem.name, action: memberAction });
            }
            // 2) Macros
            if (handler.hasExecutableMacros?.(memberItem, 'afterDamage', memberAction)) {
                result.macros.push({
                    itemId: memberItem.id,
                    itemName: memberItem.name,
                    timing: 'afterDamage',
                    action: memberAction
                });
                window.DX3rdDebug.log('DX3rd | ComboHandler - Added member macro run (afterDamage):', memberItem.name);
            }
            // 3) Applied
            const memberTargetFires = window.DX3rdItemEffectAdapter
                ? window.DX3rdItemEffectAdapter.targetFiresAt(memberItem, memberAction, 'afterDamage')
                : memberItem.system?.effect?.runTiming === 'afterDamage';
            if ((memberItem.system?.getTarget || memberItem.system?.scene) && memberTargetFires) {
                const memberTargetAttrs = window.DX3rdItemEffectAdapter
                    ? window.DX3rdItemEffectAdapter.targetBucketAttributes(memberItem, memberAction, 'afterDamage')
                    : (memberItem.system?.effect?.attributes || {});
                result.applies.push({ itemId: memberItem.id, itemName: memberItem.name, action: memberAction,
                    frozenAttributes: handler.freezeTransferredItemAttributes?.(actor, memberItem, memberTargetAttrs) || null });
            }
            // 3b) Applied on hit — 'afterHit' buckets resolve against attackHit, not HP loss.
            const memberHitFires = window.DX3rdItemEffectAdapter
                ? window.DX3rdItemEffectAdapter.targetFiresAt(memberItem, memberAction, 'afterHit')
                : memberItem.system?.effect?.runTiming === 'afterHit';
            if ((memberItem.system?.getTarget || memberItem.system?.scene) && memberHitFires) {
                const memberHitAttrs = window.DX3rdItemEffectAdapter
                    ? window.DX3rdItemEffectAdapter.targetBucketAttributes(memberItem, memberAction, 'afterHit')
                    : (memberItem.system?.effect?.attributes || {});
                result.hitApplies.push({ itemId: memberItem.id, itemName: memberItem.name, action: memberAction,
                    frozenAttributes: handler.freezeTransferredItemAttributes?.(actor, memberItem, memberHitAttrs) || null });
            }
            // 4) The extensions are all collected below
        }

        // Collect all the extensions (the combo itself + every member item). afterDamage excludes item creation
        const collectedExtensions = this.collectExtensions(actor, [item, ...memberItems], {
            includeItemCreation: false, action: 'attack', comboItemId: item.id
        });

        // Merge the extensions (afterDamage + afterMain)
        window.DX3rdDebug.log('DX3rd | ComboHandler - Collected extensions count:', collectedExtensions.length);
        
        // Merge the afterDamage-timing extensions
        const afterDamageExtensions = collectedExtensions.filter(e => e.timing === 'afterDamage');
        window.DX3rdDebug.log('DX3rd | ComboHandler - AfterDamage extensions count:', afterDamageExtensions.length);
        if (afterDamageExtensions.length > 0) {
            const buckets = handler.groupExtensionsByKey(afterDamageExtensions);
            const merged = handler.mergeGroupedExtensionBuckets(actor, buckets);
            window.DX3rdDebug.log('DX3rd | ComboHandler - Merged afterDamage buckets:', merged.length);
            result.extensions = merged.map(b => ({
                ...b,
                selectedTargetIds // save the current targets
            }));
        }
        
        // Merge the afterMain-timing extensions (only those whose parentRunTiming is afterDamage)
        const afterMainExtensions = collectedExtensions.filter(e => 
            e.timing === 'afterMain' && e.parentRunTiming === 'afterDamage'
        );
        window.DX3rdDebug.log('DX3rd | ComboHandler - AfterMain extensions (parentRunTiming=afterDamage):', afterMainExtensions.length);
        if (afterMainExtensions.length > 0) {
            const buckets = handler.groupExtensionsByKey(afterMainExtensions);
            const merged = handler.mergeGroupedExtensionBuckets(actor, buckets);
            window.DX3rdDebug.log('DX3rd | ComboHandler - Merged afterMain buckets:', merged.length);
            result.afterMainExtensions = merged.map(b => ({
                ...b,
                selectedTargetIds // save the current targets
            }));
        }

        window.DX3rdDebug.log('DX3rd | ComboHandler - Collected afterDamage data:', result);
        return result;
    },
    
    /**
     * Handle a check combo (system.roll !== '-').
     * Encroachment and activation were already handled in handleItemUse.
     */
    async handleComboRoll(actor, item, rollType, getTarget, options = {}) {
        window.DX3rdDebug.log("DX3rd | ComboHandler - Combo roll processing", { rollType });
        
        const handler = window.DX3rdUniversalHandler;
        const adapter = window.DX3rdItemEffectAdapter;
        if (!handler) {
            console.error("DX3rd | UniversalHandler not found");
            return false;
        }
        const effectAttackBonus = this.calculateEffectAttackBonus(actor, item);
        
        // For an enemy with an accuracy result entered, create the damage-roll button directly without a roll (dice / modifier corrections included)
        if (actor.type === 'enemy' && item.system?.attackAchievement && 
            item.system.attackAchievement !== '-' && item.system.attackAchievement !== '' &&
            item.system?.attackRoll && item.system.attackRoll !== '-') {
            const baseAchievement = Number(item.system.attackAchievement);
            if (!isNaN(baseAchievement) && baseAchievement > 0) {
                const registeredWeaponBonus = this.calculateRegisteredWeaponBonus(actor, item);
                const shortcutAttackBonus = adapter?.mergeAttackBonuses?.(effectAttackBonus, registeredWeaponBonus)
                    || effectAttackBonus || registeredWeaponBonus;
                const achievementValue = await this.getAchievementWithModifiers(actor, item, baseAchievement, shortcutAttackBonus);
                await this.createAttackMessageWithAchievement(
                    actor, item, achievementValue, shortcutAttackBonus, options.sourceMessage || null);
                return true;
            }
        }
        
        // With weapon selection enabled, show the weapon selection dialog
        if (item.system?.weaponSelect && item.system?.attackRoll && item.system.attackRoll !== '-') {
            await this.showWeaponSelectionForAttack(actor, item, rollType, options, effectAttackBonus);
            return true;
        }
        
        // With weapon selection disabled but this being an attack check, apply the registered weapon bonus
        if (!item.system?.weaponSelect && item.system?.attackRoll && item.system.attackRoll !== '-') {
            window.DX3rdDebug.log('DX3rd | ComboHandler - Attack roll without weapon selection, using registered weapons');
            const registeredWeaponBonus = this.calculateRegisteredWeaponBonus(actor, item);
            
            // Apply the bonus when at least one of the registered weapons is still usable
            const hasAvailableWeapons = registeredWeaponBonus.weaponIds.length > 0;
            
            if (hasAvailableWeapons) {
                // Apply the combined effects' own values together with the weapon.
                const weaponBonus = adapter?.mergeAttackBonuses?.(effectAttackBonus, registeredWeaponBonus)
                    || registeredWeaponBonus;
                return this.handleComboRollWithWeapon(actor, item, rollType, weaponBonus, options);
            }
            // With weaponSelect false, do not open the weapon dialog and proceed as an ordinary check
        }

        if (effectAttackBonus) {
            return this.handleComboRollWithWeapon(actor, item, rollType, effectAttackBonus, options);
        }
        
        // Restore the metadata handed in by a book-decipher combo, a defense dialog's temporary combo, and the like
        const predefinedDifficulty = item.meta?.predefinedDifficulty || null;
        const originalItem = item.meta?.originalItem || null;
        const metaAfterRoll = item.meta?.afterRollCallback || null;
        const rollItemForDialog = originalItem || item;

        // Get the stat data from the item's skill (Finding F: through the shared resolver)
        const resolved = this.resolveComboStat(actor, item);
        if (!resolved) return false;
        const { stat, label } = resolved;

        // Collect the afterSuccess and afterDamage data
        const afterSuccessData = await this.collectAfterSuccessData(actor, item);
        const afterDamageData = await this.collectAfterDamageData(actor, item);
        await this.retainInstantComboFollowups(item, afterSuccessData, afterDamageData);

        // Show the check dialog (passing the afterSuccess and afterDamage data).
        // For a grimoire-decipher combo, use the original book item and the predefined difficulty
        handler.showStatRollDialog(
            actor,
            stat,
            label,
            rollType,
            rollItemForDialog,
            null,
            null,
            afterSuccessData,
            afterDamageData,
            options.predefinedDifficulty || predefinedDifficulty,
            false,
            false,
            options.afterRollCallback || metaAfterRoll,
            false,
            options.sourceMessage || null
        );
        return true;
    },

    /**
     * Show the weapon selection dialog for an attack
     */
    async showWeaponSelectionForAttack(actor, item, rollType, options = {}, effectAttackBonus = null) {
        const attackRollType = item.system.attackRoll;
        
        // Get all the actor's weapons plus vehicles (no type filtering)
        const allWeapons = actor.items.filter(w => w.type === 'weapon' || w.type === 'vehicle');
        // Expose the single "no weapon" row at the top, so the check can proceed even with no weapons at all.
        const virtualWeapons = window.DX3rdVirtualWeapons?.list?.(attackRollType) || [];
        const weapons = [...virtualWeapons, ...allWeapons];

        // Show the weapon selection dialog
        new window.DX3rdWeaponForAttackDialog({
            actor: actor,
            weapons: weapons,
            attackRoll: attackRollType,
            title: game.i18n.localize('DX3rd.WeaponSelection'),
            callback: async (weaponBonus) => {
                const combined = window.DX3rdItemEffectAdapter?.mergeAttackBonuses?.(effectAttackBonus, weaponBonus)
                    || weaponBonus || effectAttackBonus;
                await this.handleComboRollWithWeapon(actor, item, rollType, combined, options);
            }
        }).render(true);
        return true;
    },

    /** Sum the combined effects' own modifiers and attack values. */
    calculateEffectAttackBonus(actor, item) {
        const adapter = window.DX3rdItemEffectAdapter;
        if (!adapter) return null;
        const bonuses = this.comboMemberEntries(actor, item)
            .map(({item: effect}) => adapter.effectAttackBonus?.(effect, actor, {includeComboModifiers: true}))
            .filter(Boolean);
        return adapter.mergeAttackBonuses?.(bonuses) || null;
    },
    
    /**
     * Compute the bonus of the weapons registered on the weapon tab (only those with attacks left)
     */
    calculateRegisteredWeaponBonus(actor, item) {
        const weaponBonus = { attack: 0, add: 0, attackFormula: '', addFormula: '', weaponName: '', weaponIds: [] };
        
        // Get the weapons registered on the weapon tab
        const registeredWeapons = item.system?.weapon || [];
        const multiWeapon = this.comboMemberEntries(actor, item)
            .map(({item: effect}) => effect.system?.multiWeapon)
            .find(rule => rule?.enabled);
        const selectedWeapons = registeredWeapons.filter(id => id && id !== '-');
        if (selectedWeapons.length > 1 && !multiWeapon) {
            ui.notifications.warn('복수 무기 합산 이펙트 없이 여러 무기를 사용합니다. 모든 무기를 합산합니다.');
        }
        
        window.DX3rdDebug.log('DX3rd | ComboHandler - Registered weapons:', registeredWeapons);
        
        // Sum each registered weapon's bonus (only those with attacks left)
        for (const weaponId of selectedWeapons) {
            if (weaponId && weaponId !== '-') {
                // Get the weapon data from the actor's items or from the virtual weapons
                const weaponItem = window.DX3rdResolveWeapon(actor, weaponId);
                // A vehicle is a legitimate entry in the weapon slot too (it uses only the attack value; no add, no attack-used).
                // See the comment on the function of the same name in universal-handler for the full rationale.
                if (weaponItem && (weaponItem.type === 'weapon' || weaponItem.type === 'vehicle')) {
                    const isVehicle = weaponItem.type === 'vehicle';
                    if (!isVehicle && multiWeapon?.weaponType && multiWeapon.weaponType !== '-' && weaponItem.system?.type !== multiWeapon.weaponType) {
                        ui.notifications.warn(`복수 무기 조건: ${weaponItem.name}은(는) 요구 종별(${multiWeapon.weaponType})과 다릅니다. 합산은 유지합니다.`);
                    }
                    if (!isVehicle && multiWeapon?.requireSameSkill && weaponBonus.weaponIds.length) {
                        const first = window.DX3rdResolveWeapon(actor, weaponBonus.weaponIds[0]);
                        if (first?.system?.skill !== weaponItem.system?.skill) {
                            ui.notifications.warn(`복수 무기 조건: ${weaponItem.name}은(는) 첫 무기와 기능이 다릅니다. 합산은 유지합니다.`);
                        }
                    }
                    if (!isVehicle) {
                        // Check the attack count (weapon only; a vehicle has no attack-used)
                        const attackUsedDisable = weaponItem.system['attack-used']?.disable || 'notCheck';
                        const attackUsedState = weaponItem.system['attack-used']?.state || 0;
                        const attackUsedMax = weaponItem.system['attack-used']?.max || 0;
                        const isAttackExhausted = attackUsedDisable !== 'notCheck' && (attackUsedMax <= 0 || attackUsedState >= attackUsedMax);

                        // Exclude a weapon whose attacks are spent — whether that blocks is decided by the world setting.
                        if (isAttackExhausted && window.DX3rdItemExhausted?.allowExhaustedUse?.() === false) {
                            window.DX3rdDebug.log(`DX3rd | ComboHandler - Weapon ${weaponItem.name} attack exhausted, skipping (${attackUsedState}/${attackUsedMax})`);
                            continue;
                        }
                    }

                    // Fixed modifiers are summed at once; dice formulas are preserved until attack / damage is settled.
                    const formula = window.DX3rdFormulaEvaluator;
                    const addFormulaTerm = (target, raw) => {
                        const prepared = formula.prepareRollFormula(String(raw ?? '0'), weaponItem, actor);
                        if (formula.hasDice(prepared)) weaponBonus[target] = [weaponBonus[target], prepared].filter(Boolean).join(' + ');
                        else weaponBonus[target === 'attackFormula' ? 'attack' : 'add'] += Number(formula.evaluate(raw, weaponItem, actor)) || 0;
                    };
                    addFormulaTerm('attackFormula', weaponItem.system?.attack);
                    if (!isVehicle) addFormulaTerm('addFormula', weaponItem.system?.add);

                    // Add the weapon name (ruby text removed)
                    const cleanWeaponName = weaponItem.name.split('||')[0].trim();
                    if (!weaponBonus.weaponName) {
                        weaponBonus.weaponName = cleanWeaponName;
                    } else {
                        weaponBonus.weaponName += `, ${cleanWeaponName}`;
                    }
                    
                    // Add the weapon id
                    weaponBonus.weaponIds.push(weaponId);
                    
                    window.DX3rdDebug.log(`DX3rd | ComboHandler - Weapon ${weaponItem.name}:`, {
                        attack: weaponBonus.attack,
                        attackFormula: weaponBonus.attackFormula,
                        add: weaponBonus.add,
                        addFormula: weaponBonus.addFormula
                    });
                } else if (weaponItem) {
                    window.DX3rdDebug.log(`DX3rd | ComboHandler - Item ${weaponItem.name} is not a weapon, skipping`);
                } else {
                    console.warn(`DX3rd | ComboHandler - Weapon not found: ${weaponId}`);
                }
            }
        }
        
        window.DX3rdDebug.log('DX3rd | ComboHandler - Total weapon bonus:', weaponBonus);
        return weaponBonus;
    },

    /**
     * Handle a check with the weapon bonus applied
     */
    async handleComboRollWithWeapon(actor, item, rollType, weaponBonus, options = {}) {
        const handler = window.DX3rdUniversalHandler;
        
        // Restore the metadata handed in by a book-decipher combo, a defense dialog's temporary combo, and the like
        const predefinedDifficulty = item.meta?.predefinedDifficulty || null;
        const originalItem = item.meta?.originalItem || null;
        const metaAfterRoll = item.meta?.afterRollCallback || null;
        const rollItemForDialog = originalItem || item;

        // Get the stat data from the item's skill (Finding F: through the shared resolver — syndrome/text/cthulhu branches included)
        const resolved = this.resolveComboStat(actor, item);
        if (!resolved) return false;
        const { stat, label } = resolved;

        // Collect the afterSuccess and afterDamage data
        const afterSuccessData = await this.collectAfterSuccessData(actor, item);
        const afterDamageData = await this.collectAfterDamageData(actor, item);
        await this.retainInstantComboFollowups(item, afterSuccessData, afterDamageData);

        window.DX3rdDebug.log('DX3rd | ComboHandler - Weapon bonus to apply:', weaponBonus);
        handler.showStatRollDialog(
            actor,
            stat,
            label,
            rollType,
            rollItemForDialog,
            null,
            weaponBonus,
            afterSuccessData,
            afterDamageData,
            options.predefinedDifficulty || predefinedDifficulty,
            false,
            false,
            options.afterRollCallback || metaAfterRoll,
            false,
            options.sourceMessage || null
        );
        return true;
    },

    /**
     * Fold the dice / modifier corrections into an enemy's accuracy result (+2 per die; a modifier adds as-is).
     * Sums the overall, major and this-check attribute/skill dice and modifier corrections.
     * @param {Actor} actor - the enemy actor
     * @param {Item} item - the combo item
     * @param {number} baseAchievement - the accuracy result from the sheet
     * @returns {number} the corrected result
     */
    async getAchievementWithModifiers(actor, item, baseAchievement, attackBonus = null) {
        const fixedItemAdd = Number(attackBonus?.add) || 0;
        let formulaItemAdd = 0;
        if (attackBonus?.addFormula) {
            const addRoll = await new Roll(attackBonus.addFormula).roll();
            formulaItemAdd = Number(addRoll.total) || 0;
        }
        const itemAdjustedAchievement = baseAchievement + fixedItemAdd + formulaItemAdd;
        const skillKey = item.system?.skill;
        if (!skillKey || skillKey === '-') return Math.max(1, Math.floor(itemAdjustedAchievement));
        
        const attributes = ['body', 'sense', 'mind', 'social'];
        let stat = null;
        
        if (attributes.includes(skillKey)) {
            stat = actor.system.attributes[skillKey];
        } else if (['syndrome', 'text', 'cthulhu'].includes(skillKey)) {
            stat = actor.system.attributes[skillKey] || actor.system.attributes.skills?.[skillKey];
        } else {
            const customBase = item.system?.base;
            if (customBase && customBase !== '-' && attributes.includes(customBase)) {
                const baseStat = actor.system.attributes[customBase];
                const skillStat = actor.system.attributes.skills?.[skillKey];
                const originalBaseStat = skillStat?.base ? actor.system.attributes[skillStat.base] : null;
                if (baseStat && skillStat && originalBaseStat) {
                    const skillDiceBonus = (skillStat.dice || 0) - (originalBaseStat.dice || 0);
                    const skillAddBonus = (skillStat.add || 0) - (originalBaseStat.add || 0);
                    stat = {
                        dice: (baseStat.dice || 0) + skillDiceBonus,
                        add: (baseStat.add || 0) + skillAddBonus,
                        total: baseStat.total,
                        major: {
                            dice: (baseStat.major?.dice || 0) + skillDiceBonus,
                            add: (baseStat.major?.add || 0) + skillAddBonus
                        }
                    };
                } else {
                    stat = baseStat;
                }
            } else {
                stat = actor.system.attributes.skills?.[skillKey];
            }
        }
        
        if (!stat) return Math.max(1, Math.floor(itemAdjustedAchievement));
        
        // For a skill with no .major (an enemy, say), fold in that attribute's major correction
        let majorDice = stat.major?.dice ?? stat.dice ?? 0;
        let majorAdd = stat.major?.add ?? stat.add ?? 0;
        if ((stat.major == null) && stat.base && actor.system.attributes[stat.base]?.major) {
            const ab = actor.system.attributes[stat.base];
            const majorBonusDice = (ab.major?.dice ?? ab.dice ?? 0) - (ab.dice ?? 0);
            const majorBonusAdd = (ab.major?.add ?? ab.add ?? 0) - (ab.add ?? 0);
            majorDice = (stat.dice ?? 0) + majorBonusDice;
            majorAdd = (stat.add ?? 0) + majorBonusAdd;
        }
        
        let baseDice, baseAdd;
        
        if (attributes.includes(skillKey)) {
            baseDice = stat.total ?? 0;
            baseAdd = 0;
        } else if (stat.base && actor.system.attributes[stat.base]) {
            baseDice = actor.system.attributes[stat.base]?.dice ?? 0;
            baseAdd = stat.total ?? 0;
        } else {
            baseDice = stat.dice ?? 0;
            baseAdd = stat.add ?? 0;
        }
        
        const diceModifier = majorDice - baseDice;
        const addModifier = majorAdd - baseAdd;
        const adjusted = itemAdjustedAchievement + (diceModifier * 2) + addModifier;
        return Math.max(1, Math.floor(adjusted));
    },
    
    /**
     * Create the attack message and the damage-roll button from an enemy's accuracy result (with no roll).
     * @param {Actor} actor - the actor
     * @param {Item} item - the combo item
     * @param {number} achievementValue - the accuracy result
     */
    async createAttackMessageWithAchievement(actor, item, achievementValue, attackBonus = null, sourceMessage = null) {
        const handler = window.DX3rdUniversalHandler;
        if (!handler) {
            console.error("DX3rd | UniversalHandler not found");
            return;
        }
        
        // The check has already been made, so the afterSuccess / afterDamage data is collected exactly as for an ordinary attack (for the post-main work when the damage-roll button is clicked)
        const afterSuccessData = await this.collectAfterSuccessData(actor, item);
        const afterDamageData = await this.collectAfterDamageData(actor, item);
        await this.retainInstantComboFollowups(item, afterSuccessData, afterDamageData);
        
        // Get the skill name
        const skillKey = item.system?.skill;
        let skillName = '';
        if (skillKey && skillKey !== '-') {
            if (['body', 'sense', 'mind', 'social'].includes(skillKey)) {
                skillName = game.i18n.localize(`DX3rd.${skillKey.charAt(0).toUpperCase() + skillKey.slice(1)}`);
            } else {
                const skillStat = actor.system.attributes.skills?.[skillKey];
                if (skillStat) {
                    skillName = skillStat.name || skillKey;
                } else {
                    skillName = skillKey;
                }
            }
        }
        
        // Only the references are frozen at accuracy time; the attack's dice formula is held until the damage roll is settled.
        //
        // `system.attack.value` must NOT be used here. That value is the sheet's display **total**
        // (combo-data.calculateSubmittedAttack: actor attack + weapon + effect), so it already contains the
        // actor's attack, while the damage base adds preservedValues.actorAttack below separately
        // → the actor's attack would be counted twice. On top of that, that sheet field is display-only and
        // disabled, so a hand-entered value could never ride along. The same components as the PC path
        // (executeStatRoll) — weapon and effect bonuses only — are carried, keeping both paths on one premise.
        const preservedItemAttackFormula = handler.joinFormulaTerms(
            attackBonus?.attack, attackBonus?.attackFormula);

        // Derive the attack type and actor bonuses (the same path as at accuracy and damage time).
        // The penetrate dice formula is rolled at this check and frozen to a number.
        const bonuses = await handler.resolveAttackBonusesRolled(actor, item);

        const preservedValues = {
            actorAttack: bonuses.actorAttack,
            actorAttackFormula: bonuses.actorAttackFormula,
            actorPenetrate: bonuses.actorPenetrate,
            weaponAttackFormula: preservedItemAttackFormula
        };

        // Emit the attack roll message (ruby text removed)
        const cleanItemName = item.name.split('||')[0].trim();
        let flavorText = `${cleanItemName} - ${skillName} (${game.i18n.localize('DX3rd.AttackRoll')})`;
        flavorText += `\n· ${game.i18n.localize('DX3rd.Achievement')}: ${achievementValue}`;
        
        // Add the target information
        const targets = Array.from(game.user.targets);
        if (targets.length > 0) {
            const rollResult = achievementValue;
            const targetDisplayNames = [];
            
            for (const target of targets) {
                const targetActor = target.actor;
                const targetName = targetActor?.name || target.name;
                if (!targetName) continue;
                
                // Check whether the target is an enemy with evasion enabled
                if (targetActor && targetActor.type === 'enemy') {
                    const evasionDisabled = targetActor.system?.attributes?.evasion?.disabled;
                    const evasionValue = targetActor.system?.attributes?.evasion?.value;
                    
                    if (evasionDisabled === false && evasionValue !== undefined && evasionValue !== null) {
                        const evasionNum = Number(evasionValue) || 0;
                        const isHit = rollResult > evasionNum;
                        const resultText = isHit 
                            ? `${game.i18n.localize('DX3rd.Hit')}: ${game.i18n.localize('DX3rd.Evasion')} ${evasionNum}`
                            : `${game.i18n.localize('DX3rd.Failure')}: ${game.i18n.localize('DX3rd.Evasion')} ${evasionNum}`;
                        targetDisplayNames.push(`${targetName}(${resultText})`);
                    } else {
                        targetDisplayNames.push(targetName);
                    }
                } else {
                    targetDisplayNames.push(targetName);
                }
            }
            
            if (targetDisplayNames.length > 0) {
                flavorText += `\n· ${game.i18n.localize('DX3rd.Target')}: ${targetDisplayNames.join(', ')}`;
            }
        }
        
        // Create the damage-roll button
        let damageRollButtonContent = `<button class="damage-roll-btn" 
                    data-actor-id="${actor.id}" 
                    data-item-id="${item.id}"
                    data-roll-result="${achievementValue}"
                    data-preserved-actor-attack="${preservedValues.actorAttack}"
                    data-preserved-actor-attack-formula="${encodeURIComponent(preservedValues.actorAttackFormula || '')}"
                    data-preserved-actor-penetrate="${preservedValues.actorPenetrate}"`;
        
        // Add the attack-value data attributes per item type
        if (item.type === 'weapon') {
            damageRollButtonContent += `\n                    data-preserved-attack-formula="${encodeURIComponent(preservedValues.weaponAttackFormula)}"`;
            damageRollButtonContent += `\n                    data-weapon-ids="${item.id}"`;
        } else if (item.type === 'vehicle') {
            damageRollButtonContent += `\n                    data-preserved-attack-formula="${encodeURIComponent(preservedValues.weaponAttackFormula)}"`;
        } else {
            damageRollButtonContent += `\n                    data-preserved-attack-formula="${encodeURIComponent(preservedValues.weaponAttackFormula)}"`;
        }
        
        damageRollButtonContent += `>
                ${game.i18n.localize('DX3rd.DamageRoll')}
            </button>`;
        
        // Bundle the attack message, target info, roll result and damage-roll button into one message
        const attackMessageContent = window.DX3rdUniversalHandler.renderAttackChatCard({
            actor,
            item,
            flavorText: `<p>${flavorText.replace(/\n/g, '<br>')}</p>`,
            actionContent: `${window.DX3rdUniversalHandler.renderAttackRollButton(actor, item, {repeatable: true})}${damageRollButtonContent}`
        });
        
        // Store the combo afterSuccess / afterDamage flags (so clicking the damage-roll button runs processComboAfterSuccess and the rest of the post-main work)
        const messageData = {
            speaker: ChatMessage.getSpeaker({ actor: actor }),
            content: attackMessageContent
        };
        if (afterSuccessData || afterDamageData || window.DX3rdIsInstantCombo?.(item)) {
            messageData.flags = { 'dx3rd-emanim': {} };
            if (afterSuccessData) {
                messageData.flags['dx3rd-emanim'].comboAfterSuccess = {
                    actorId: actor.id,
                    comboItemId: item.id || null,
                    ...afterSuccessData
                };
            }
            if (afterDamageData) {
                messageData.flags['dx3rd-emanim'].comboAfterDamage = {
                    actorId: actor.id,
                    comboItemId: item.id || null,
                    ...afterDamageData
                };
            }
            if (window.DX3rdIsInstantCombo?.(item)) {
                messageData.flags['dx3rd-emanim'].tempComboItem = window.DX3rdSerializeInstantCombo(item);
            }
        }
        
        let attackMessage;
        if (sourceMessage) {
            const flagUpdates = {};
            const systemFlags = messageData.flags?.['dx3rd-emanim'] || {};
            for (const [key, value] of Object.entries(systemFlags)) {
                flagUpdates[`flags.dx3rd-emanim.${key}`] = value;
            }
            await sourceMessage.update({
                content: attackMessageContent,
                'flags.dx3rd-emanim.pendingAttackRoll': false,
                'flags.dx3rd-emanim.attackRollCompleted': false,
                ...flagUpdates
            });
            attackMessage = sourceMessage;
        } else {
            attackMessage = await ChatMessage.create(messageData);
        }
        // Run the disable hooks after the major roll (on this actor only)
        if (window.DX3rdDisableHooks) {
            await window.DX3rdDisableHooks.executeDisableHook('roll', actor);
            await window.DX3rdDisableHooks.executeDisableHook('major', actor);
        }

        // Fixed enemy achievements still represent a concrete attack. Bind prepared ammunition/
        // riders before auto damage starts, just like the ordinary accuracy-roll paths.
        await window.DX3rdUniversalHandler.onAttackRollComplete(
            actor, item, targets, achievementValue, false, attackMessage);
        await window.DX3rdUniversalHandler.maybeAutoRollDamage?.(attackMessage);
        
        return true;
    }
};

window.DX3rdDebug.log("DX3rd | ComboHandler script loaded");
})();
