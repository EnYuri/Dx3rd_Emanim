// Disable Hooks - 타이밍에 따라 아이템 비활성화 및 효과 제거
(function() {
    console.log("DX3rd | DisableHooks script loading...");

    class DX3rdDisableHooks {
        /**
         * 특정 타이밍에 해당하는 아이템들을 비활성화하고 효과를 제거
         * @param {string} timing - 타이밍 ('roll', 'major', 'reaction', 'guard', 'main', 'round', 'scene', 'session')
         * @param {Actor|Actor[]|null} targetActors - 대상 액터(들). null이면 모든 액터, Actor 하나면 해당 액터만, Array면 배열의 액터들만
         */
        static async executeDisableHook(timing, targetActors = null) {
            if (!timing) {
                console.warn("DX3rd | DisableHooks - timing is required");
                return;
            }

            console.log(`DX3rd | DisableHooks - Executing ${timing} hook`, { targetActors });

            // 대상 액터 결정
            let actors = [];
            if (targetActors === null) {
                // null이면 현재 캔버스의 토큰 액터들 (캐릭터 + 에너미)
                const currentScene = game.scenes.active;
                if (currentScene) {
                    const tokensWithActors = currentScene.tokens.filter(t => t.actor && (t.actor.type === 'character' || t.actor.type === 'enemy'));
                    actors = tokensWithActors.map(t => t.actor);
                } else {
                    // 활성 씬이 없으면 빈 배열
                    actors = [];
                }
            } else if (Array.isArray(targetActors)) {
                // 배열이면 해당 액터들만 (판정/행동을 실행한 액터이므로 캐릭터·에너미 모두 처리)
                actors = targetActors.filter(a => a && (a.type === 'character' || a.type === 'enemy'));
            } else if (targetActors) {
                // 단일 액터면 배열로 변환 (판정/행동을 실행한 액터이므로 캐릭터·에너미 모두 처리)
                if (targetActors.type === 'character' || targetActors.type === 'enemy') {
                    actors = [targetActors];
                }
            }
            let deactivatedCount = 0;
            let removedAppliedCount = 0;
            let resetUsageCount = 0;

            for (const actor of actors) {
                const updates = {};
                const itemsToDeactivate = [];
                const itemsToResetUsage = [];
                const appliedToRemove = [];

                // 액터의 모든 아이템 확인
                for (const item of actor.items) {
                    let shouldDeactivate = false;
                    let shouldResetUsage = false;

                    // active.disable 확인
                    if (item.system.active?.state && item.system.active?.disable === timing) {
                        shouldDeactivate = true;
                    }

                    // used.disable 확인 (사용 횟수 리셋)
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

                // 적용된 효과(Applied) 확인
                const appliedEffects = actor.system.attributes.applied || {};
                for (const [appliedKey, appliedData] of Object.entries(appliedEffects)) {
                    // appliedData가 객체 형식인 경우
                    if (appliedData && typeof appliedData === 'object') {
                        let shouldRemove = false;
                        
                        // 1. applied 효과 자체에 disable 속성이 있는 경우 (EXTRA TURN 등)
                        if (appliedData.disable === timing) {
                            shouldRemove = true;
                        }
                        
                        // 2. 아이템 기반 applied 효과인 경우
                        const sourceItemId = appliedData.itemId;
                        if (sourceItemId && !shouldRemove) {
                            // 원본 아이템 찾기 (같은 액터 또는 다른 액터에서)
                            let sourceItem = actor.items.get(sourceItemId);
                            
                            // 같은 액터에서 찾지 못한 경우, 모든 액터에서 찾기
                            if (!sourceItem) {
                                for (const otherActor of game.actors) {
                                    sourceItem = otherActor.items.get(sourceItemId);
                                    if (sourceItem) break;
                                }
                            }

                            // 원본 아이템의 disable 타이밍 확인
                            if (sourceItem) {
                                const effectDisable = sourceItem.system.effect?.disable;
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

                // 아이템 비활성화
                for (const item of itemsToDeactivate) {
                    try {
                        await item.update({ 'system.active.state': false });
                        deactivatedCount++;
                        console.log(`DX3rd | DisableHooks - Deactivated item: ${item.name} (${item.type}) on actor ${actor.name}`);
                    } catch (error) {
                        console.error(`DX3rd | DisableHooks - Failed to deactivate item ${item.name}:`, error);
                    }
                }

                // 사용 횟수 리셋
                for (const item of itemsToResetUsage) {
                    try {
                        await item.update({ 'system.used.state': 0 });
                        resetUsageCount++;
                        console.log(`DX3rd | DisableHooks - Reset usage for item: ${item.name} (${item.type}) on actor ${actor.name}`);
                    } catch (error) {
                        console.error(`DX3rd | DisableHooks - Failed to reset usage for item ${item.name}:`, error);
                    }
                }

                // 적용된 효과 제거
                for (const appliedKey of appliedToRemove) {
                    updates[`system.attributes.applied.-=${appliedKey}`] = null;
                    removedAppliedCount++;
                    console.log(`DX3rd | DisableHooks - Removed applied effect: ${appliedKey} from actor ${actor.name}`);
                }

                // 액터 업데이트
                if (Object.keys(updates).length > 0) {
                    try {
                        await actor.update(updates);
                    } catch (error) {
                        console.error(`DX3rd | DisableHooks - Failed to update actor ${actor.name}:`, error);
                    }
                }
            }

            console.log(`DX3rd | DisableHooks - ${timing} hook completed. Actors: ${actors.length}, Deactivated: ${deactivatedCount}, Reset Usage: ${resetUsageCount}, Removed Applied: ${removedAppliedCount}`);
        }

        /**
         * 매크로 바에 추가할 수 있는 헬퍼 함수들
         * @param {Actor|Actor[]|null} targetActors - 대상 액터(들). 생략하면 모든 액터
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

    // 전역 노출
    window.DX3rdDisableHooks = DX3rdDisableHooks;

    // 매크로에서 쉽게 사용할 수 있도록 전역 함수로도 노출
    window.afterRoll = (targetActors = null) => DX3rdDisableHooks.afterRoll(targetActors);
    window.afterMajor = (targetActors = null) => DX3rdDisableHooks.afterMajor(targetActors);
    window.afterReaction = (targetActors = null) => DX3rdDisableHooks.afterReaction(targetActors);
    window.afterMain = (targetActors = null) => DX3rdDisableHooks.afterMain(targetActors);
    window.afterRound = (targetActors = null) => DX3rdDisableHooks.afterRound(targetActors);
    window.afterScene = (targetActors = null) => DX3rdDisableHooks.afterScene(targetActors);
    window.afterSession = (targetActors = null) => DX3rdDisableHooks.afterSession(targetActors);

    console.log("DX3rd | DisableHooks script loaded");
})();

