// Disable Hooks - deactivates items and removes effects according to the timing
(function() {
    window.DX3rdDebug.log("DX3rd | DisableHooks script loading...");

    class DX3rdDisableHooks {
        /**
         * Deactivate the items belonging to a particular timing and remove their effects
         * @param {string} timing - the timing ('roll', 'major', 'reaction', 'guard', 'main', 'round', 'scene', 'session')
         * @param {Actor|Actor[]|null} targetActors - the target actor(s). null = every actor, a single Actor = only that one, an Array = only those in the array
         */
        static async executeDisableHook(timing, targetActors = null) {
            if (!timing) {
                console.warn("DX3rd | DisableHooks - timing is required");
                return;
            }

            window.DX3rdDebug.log(`DX3rd | DisableHooks - Executing ${timing} hook`, { targetActors });

            // Decide the target actors
            let actors = [];
            if (targetActors === null) {
                // null = the token actors on the current canvas (characters + enemies)
                const currentScene = game.scenes.active;
                if (currentScene) {
                    const tokensWithActors = currentScene.tokens.filter(t => t.actor && (t.actor.type === 'character' || t.actor.type === 'enemy'));
                    actors = tokensWithActors.map(t => t.actor);
                } else {
                    // With no active scene, an empty array
                    actors = [];
                }
            } else if (Array.isArray(targetActors)) {
                // An array = only those actors (the actor who made the roll / took the action, so both characters and enemies are handled)
                actors = targetActors.filter(a => a && (a.type === 'character' || a.type === 'enemy'));
            } else if (targetActors) {
                // A single actor is converted to an array (the actor who made the roll / took the action, so both characters and enemies are handled)
                if (targetActors.type === 'character' || targetActors.type === 'enemy') {
                    actors = [targetActors];
                }
            }
            let deactivatedCount = 0;
            let removedAppliedCount = 0;
            let resetUsageCount = 0;
            let clearedPendingRiderCount = 0;

            for (const actor of actors) {
                const updates = {};
                const itemsToDeactivate = [];
                const itemsToResetUsage = [];
                const appliedToRemove = [];

                // Prepared ammunition and similar effects belong to one main process. If no attack
                // claimed them, discard the actor-side pending snapshot at that process boundary.
                if (timing === 'main') {
                    const pendingRiders = actor.getFlag?.('dx3rd-emanim', 'pendingAttackRiders');
                    if (Array.isArray(pendingRiders) && pendingRiders.length > 0) {
                        await actor.unsetFlag('dx3rd-emanim', 'pendingAttackRiders');
                        clearedPendingRiderCount += pendingRiders.length;
                    }
                    // Same boundary for the afterSuccess apply snapshot: a success button that
                    // was never clicked must not hold the frozen bucket past this main process.
                    const pendingApply = actor.getFlag?.('dx3rd-emanim', 'pendingAfterSuccessApply');
                    if (Array.isArray(pendingApply) && pendingApply.length > 0) {
                        await actor.unsetFlag('dx3rd-emanim', 'pendingAfterSuccessApply');
                        clearedPendingRiderCount += pendingApply.length;
                    }
                }

                // Check every item on the actor
                for (const item of actor.items) {
                    let shouldDeactivate = false;
                    let shouldResetUsage = false;

                    // active.state is the state of the self modifiers' "activation" bucket. On a mixed item whose use /
                    // attack bucket is the channel's default bucket, system.active.disable is that bucket's lifetime,
                    // and the activation bucket can have its own lifetime at buckets.activation.disable.
                    // Looking only at the flat field turns the always-on bucket off when the first use bucket ends, and
                    // together with the correct rule that a combo does not relight the activation bucket, the modifier disappears.
                    const adapter = window.DX3rdItemEffectAdapter;
                    const activeDisable = adapter?.usesActivationSelfChannel?.(item)
                        ? adapter.bucketLifecycle(item, 'self', 'activation').disable
                        : item.system.active?.disable;
                    if (item.system.active?.state && activeDisable === timing) {
                        shouldDeactivate = true;
                    }

                    // Check used.disable (resetting the use count)
                    if (item.system.used?.disable === timing && item.system.used?.state > 0) {
                        shouldResetUsage = true;
                    }

                    if (shouldDeactivate) {
                        itemsToDeactivate.push(item);
                    }

                    if (shouldResetUsage) {
                        itemsToResetUsage.push(item);
                    }
                }

                // Check the applied effects (rebuilt from the native AEs)
                const appliedEffects = window.DX3rdAppliedEffects?.collect
                    ? window.DX3rdAppliedEffects.collect(actor)
                    : (actor.system.attributes.applied || {});
                for (const [appliedKey, appliedData] of Object.entries(appliedEffects)) {
                    // When appliedData is in object form
                    if (appliedData && typeof appliedData === 'object') {
                        let shouldRemove = false;
                        
                        // 1. The applied effect itself has a disable property (EXTRA TURN and the like)
                        if (appliedData.disable === timing) {
                            shouldRemove = true;
                        }
                        
                        // 2. An item-based applied effect — except that the self modifier channel is excluded.
                        // A frozen self buff's lifetime is active.disable, and case 1 above already covers that.
                        // Applying the target channel's effect.disable here too would make the self buff disappear first,
                        // on someone else's lifetime, for an item whose two channels expire at different times.
                        const sourceItemId = appliedData.channel === 'self' ? null : appliedData.itemId;
                        if (sourceItemId && !shouldRemove) {
                            // Find the source item (on the same actor, or another one)
                            let sourceItem = actor.items.get(sourceItemId);
                            
                            // When it was not found on the same actor, search every actor
                            if (!sourceItem) {
                                for (const otherActor of game.actors) {
                                    sourceItem = otherActor.items.get(sourceItemId);
                                    if (sourceItem) break;
                                }
                            }

                            // Check the source item's disable timing. An expiry timing belongs not to the channel but to
                            // **that bucket** (appliedData.action = the bucket discriminator; the default bucket is null).
                            // Reading the channel field directly would, on an item that authors a lifetime per card, make
                            // it disappear first on another card's lifetime.
                            if (sourceItem) {
                                const adapter = window.DX3rdItemEffectAdapter;
                                const effectDisable = adapter
                                    ? adapter.bucketLifecycle(sourceItem, 'target', appliedData.action).disable
                                    : sourceItem.system.effect?.disable;
                                if (effectDisable === timing) {
                                    shouldRemove = true;
                                }
                            }
                        }
                        
                        if (shouldRemove) {
                            appliedToRemove.push(appliedKey);
                        }
                    }
                }

                // Deactivate the items — a single embedded update instead of one write per item.
                // If the batch fails (one bad document fails the whole call), retry per item so the rest still settle.
                const deactivatedItems = [];
                let deactivateBatchFailed = itemsToDeactivate.length > 0;
                if (deactivateBatchFailed) {
                    try {
                        await actor.updateEmbeddedDocuments('Item',
                            itemsToDeactivate.map(item => ({ _id: item.id, 'system.active.state': false })));
                        deactivateBatchFailed = false;
                    } catch (error) {
                        console.error(`DX3rd | DisableHooks - Batch deactivation failed on actor ${actor.name}, retrying per item:`, error);
                    }
                }
                for (const item of itemsToDeactivate) {
                    try {
                        if (deactivateBatchFailed) await item.update({ 'system.active.state': false });
                        deactivatedItems.push(item);
                        deactivatedCount++;
                        window.DX3rdDebug.log(`DX3rd | DisableHooks - Deactivated item: ${item.name} (${item.type}) on actor ${actor.name}`);
                    } catch (error) {
                        console.error(`DX3rd | DisableHooks - Failed to deactivate item ${item.name}:`, error);
                    }
                }

                // Effect-like toggle modifiers live in toggle:<itemId> AEs, not on the item itself.
                // The general updateItem synchronizer is debounced by 50 ms, so remove these derived
                // AEs before returning; subsequent automation may read actor data immediately.
                const toggleTypes = new Set(window.DX3rdAppliedToggle?.TOGGLE_TYPES
                    || ['effect', 'spell', 'psionic', 'combo']);
                const expiredToggleKeys = deactivatedItems
                    .filter(item => toggleTypes.has(item.type))
                    .map(item => `toggle:${item.id}`);
                if (expiredToggleKeys.length) {
                    await window.DX3rdAppliedEffects.removeMany(actor, expiredToggleKeys);
                }

                // A core status AE granted by an extension ends only that source's lifetime.
                try {
                    const clearedConditions = await window.DX3rdConditionSources?.clearByTiming?.(actor, timing) || 0;
                    if (clearedConditions) {
                        window.DX3rdDebug.log(`DX3rd | DisableHooks - Cleared ${clearedConditions} condition source(s) from actor ${actor.name}`);
                    }
                } catch (error) {
                    console.error(`DX3rd | DisableHooks - Failed to clear condition sources on actor ${actor.name}:`, error);
                }

                // Reset the use counts — same batch-then-per-item strategy as the deactivation above.
                let resetBatchFailed = itemsToResetUsage.length > 0;
                if (resetBatchFailed) {
                    try {
                        await actor.updateEmbeddedDocuments('Item',
                            itemsToResetUsage.map(item => ({ _id: item.id, 'system.used.state': 0 })));
                        resetBatchFailed = false;
                    } catch (error) {
                        console.error(`DX3rd | DisableHooks - Batch usage reset failed on actor ${actor.name}, retrying per item:`, error);
                    }
                }
                for (const item of itemsToResetUsage) {
                    try {
                        if (resetBatchFailed) await item.update({ 'system.used.state': 0 });
                        resetUsageCount++;
                        window.DX3rdDebug.log(`DX3rd | DisableHooks - Reset usage for item: ${item.name} (${item.type}) on actor ${actor.name}`);
                    } catch (error) {
                        console.error(`DX3rd | DisableHooks - Failed to reset usage for item ${item.name}:`, error);
                    }
                }

                // Remove the applied effects (deleting the native AEs)
                if (appliedToRemove.length) {
                    removedAppliedCount += await window.DX3rdAppliedEffects.removeMany(actor, appliedToRemove);
                    window.DX3rdDebug.log(`DX3rd | DisableHooks - Removed applied effects: ${appliedToRemove.join(', ')} from actor ${actor.name}`);
                }

                // Update the actor
                if (Object.keys(updates).length > 0) {
                    try {
                        await actor.update(updates);
                    } catch (error) {
                        console.error(`DX3rd | DisableHooks - Failed to update actor ${actor.name}:`, error);
                    }
                }
            }

            // Hidden instant combos own their toggle AE until the authored lifecycle ends. Settle the
            // toggle projection first, then remove source documents that have no pending or applied work.
            const retainedActors = Array.from(game.actors || []).filter(actor =>
                Array.from(actor.items || []).some(item =>
                    window.DX3rdInstantComboRetention?.isRetained?.(item)));
            for (const actor of retainedActors) {
                await window.DX3rdAppliedToggle?.sync?.(actor);
            }
            await window.DX3rdInstantComboRetention?.sweep?.();

            window.DX3rdDebug.log(`DX3rd | DisableHooks - ${timing} hook completed. Actors: ${actors.length}, Deactivated: ${deactivatedCount}, Reset Usage: ${resetUsageCount}, Removed Applied: ${removedAppliedCount}, Cleared Pending Riders: ${clearedPendingRiderCount}`);
        }

        /**
         * Helper functions that can be added to the macro bar
         * @param {Actor|Actor[]|null} targetActors - the target actor(s). Omitted = every actor
         */
        static async afterRoll(targetActors = null) {
            await this.executeDisableHook('roll', targetActors);
        }

        static async afterMajor(targetActors = null) {
            await this.executeDisableHook('major', targetActors);
        }

        static async afterReaction(targetActors = null) {
            await this.executeDisableHook('reaction', targetActors);
        }

        static async afterMain(targetActors = null) {
            await this.executeDisableHook('main', targetActors);
        }

        static async afterRound(targetActors = null) {
            await this.executeDisableHook('round', targetActors);
        }

        static async afterScene(targetActors = null) {
            await this.executeDisableHook('scene', targetActors);
        }

        static async afterSession(targetActors = null) {
            await this.executeDisableHook('session', targetActors);
        }
    }

    // Expose globally
    window.DX3rdDisableHooks = DX3rdDisableHooks;

    // Also exposed as global functions, for easy use from a macro
    window.afterRoll = (targetActors = null) => DX3rdDisableHooks.afterRoll(targetActors);
    window.afterMajor = (targetActors = null) => DX3rdDisableHooks.afterMajor(targetActors);
    window.afterReaction = (targetActors = null) => DX3rdDisableHooks.afterReaction(targetActors);
    window.afterMain = (targetActors = null) => DX3rdDisableHooks.afterMain(targetActors);
    window.afterRound = (targetActors = null) => DX3rdDisableHooks.afterRound(targetActors);
    window.afterScene = (targetActors = null) => DX3rdDisableHooks.afterScene(targetActors);
    window.afterSession = (targetActors = null) => DX3rdDisableHooks.afterSession(targetActors);

    window.DX3rdDebug.log("DX3rd | DisableHooks script loaded");
})();
