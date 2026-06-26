// Combo 아이템 핸들러
(function() {
console.log("DX3rd | ComboHandler script loading...");

window.DX3rdComboHandler = {
    /**
     * 스킬 키로부터 표시 이름 가져오기 (커스텀 스킬 및 로컬라이징 처리)
     */
    getSkillDisplayName(skillKey, skillStat) {
        if (!skillKey) return '';
        
        let label = skillStat?.name || '';
        if (label && label.startsWith('DX3rd.')) {
            // customSkills 설정 확인
            const customSkills = game.settings.get("dx3rd-emanim", "customSkills") || {};
            const customSkill = customSkills[skillKey];
            
            if (customSkill) {
                // 커스텀 이름이 있으면 우선 사용
                return typeof customSkill === 'object' ? customSkill.name : customSkill;
            } else {
                // 커스텀 이름이 없으면 기본 로컬라이징
                return game.i18n.localize(label);
            }
        }
        return label || skillKey;
    },
    
    async handle(actorId, itemIdOrObject, getTarget) {
        console.log("DX3rd | ComboHandler handle called", { actorId, itemIdOrObject, getTarget });
        
        const actor = game.actors.get(actorId);
        if (!actor) { 
            ui.notifications.warn("Actor not found"); 
            return; 
        }
        
        // itemIdOrObject가 문자열이면 액터의 아이템에서 조회, 객체면 그대로 사용 (임시 콤보)
        let item;
        if (typeof itemIdOrObject === 'string') {
            // 액터의 아이템에서 먼저 찾고, 없으면 game.items에서 찾기
            item = actor.items.get(itemIdOrObject) || game.items.get(itemIdOrObject);
            if (!item) { 
                ui.notifications.warn("Item not found"); 
                return; 
            }
        } else if (typeof itemIdOrObject === 'object') {
            // 임시 콤보 아이템 객체
            item = itemIdOrObject;
            console.log("DX3rd | ComboHandler - Using temporary combo item", item);
        } else {
            ui.notifications.warn("Invalid item parameter");
            return;
        }

        // 1. instant 익스텐션 병합·실행 (공통 - 롤 타입 무관)
        await this.processInstantExtensions(actor, item);

        // 2. 콤보 롤 타입 분기
        const rollType = item.system?.roll ?? '-';
        
        if (rollType === '-') {
            // No-roll: instant만 처리했으므로 끝
            console.log("DX3rd | ComboHandler - No-roll combo completed");
        } else {
            // Roll: 롤 다이얼로그 표시 (afterSuccess는 채팅 버튼에서 처리)
            await this.handleComboRoll(actor, item, rollType, getTarget);
        }
    },
    
    /**
     * 주어진 소스 아이템들(콤보 본체 + 포함 이펙트)에서 익스텐션 정의를 수집한다.
     * 기존 3개 메서드(processInstant/collectAfterSuccess/collectAfterDamage)에 복붙되어 있던
     * pushExtensionsFrom 로직을 단일화한 것.
     * @param {Actor} actor
     * @param {Array} srcItems - 익스텐션 플래그를 가진 아이템 배열 (앞에서부터 순서대로 수집)
     * @param {Object} [opts]
     * @param {boolean} [opts.includeItemCreation=true] - weapon/protect/vehicle 생성 익스텐션 포함 여부 (afterDamage는 instant 전용이라 false)
     * @returns {Array} 수집된 익스텐션 정의 배열
     */
    collectExtensions(actor, srcItems, { includeItemCreation = true } = {}) {
        const collected = [];
        for (const srcItem of srcItems) {
            if (!srcItem) continue;
            const ext = srcItem.getFlag('dx3rd-emanim', 'itemExtend') || {};
            // 부모 아이템의 runTiming 저장 (익스텐션의 등록 타이밍 결정에 사용)
            const parentRunTiming = srcItem.system?.active?.runTiming || 'instant';
            const baseData = {
                itemId: srcItem.id,
                itemName: srcItem.name,
                actorId: actor.id,
                parentRunTiming
            };

            const pushIf = (typeKey) => {
                const d = ext[typeKey];
                if (!d) return;

                // 상태이상의 경우 conditions 배열 형식이면 상위 activate 체크 건너뛰기
                const isConditionArray = typeKey === 'condition' && Array.isArray(d.conditions) && d.conditions.length > 0;
                if (!isConditionArray && !d.activate) return;

                if (typeKey === 'heal' || typeKey === 'damage' || typeKey === 'condition') {
                    if (isConditionArray) {
                        // conditions 배열 형식: 각 조건을 개별 extension으로 추가
                        for (const c of d.conditions) {
                            if (!c.activate || !c.type) continue;
                            collected.push({
                                type: typeKey, ...baseData,
                                timing: c.timing || 'instant',
                                target: c.target || 'self',
                                formulaDice: 0,
                                formulaAdd: 0,
                                ignoreReduce: false,
                                resurrect: false,
                                rivival: false,
                                conditionType: c.type,
                                poisonedRank: c.poisonedRank || null,
                                conditionalFormula: false
                            });
                        }
                    } else {
                        // 기존 단일 형식 또는 heal/damage
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
                            conditionalFormula: !!d.conditionalFormula
                        });
                    }
                } else if (typeKey === 'weapon' || typeKey === 'protect' || typeKey === 'vehicle') {
                    // 아이템 생성 익스텐션은 instant만 지원 (afterDamage 수집에서는 제외)
                    if (!includeItemCreation) return;
                    collected.push({
                        type: typeKey, ...baseData,
                        timing: 'instant',
                        extensionData: d // 전체 데이터 보존
                    });
                }
            };
            pushIf('heal');
            pushIf('damage');
            pushIf('condition');
            pushIf('weapon');
            pushIf('protect');
            pushIf('vehicle');
        }
        return collected;
    },

    /**
     * instant 익스텐션 병합 및 실행 (롤 타입 무관 공통 처리)
     * 콤보 + 포함된 이펙트들의 instant 익스텐션을 수집·병합·실행
     */
    async processInstantExtensions(actor, item) {
        console.log("DX3rd | ComboHandler - Processing instant extensions (common for all roll types)");
        const handler = window.DX3rdUniversalHandler;
        if (!handler) return;

        // 콤보 본체의 instant 매크로/어플라이드는 이미 handleItemUse에서 실행됨 → 중복 방지
        console.log('DX3rd | ComboHandler - Skipping combo item instant macro/apply (already done in handleItemUse)');

        // 2) 포함 이펙트의 즉시 처리 + 익스텐드 수집
        const effectIds = handler.normalizeEffectIds(item);
        console.log('DX3rd | ComboHandler - Effects normalized', { effectIds });

        // 현재 선택된 타겟을 저장(instant 병합 실행 시 공유)
        const selectedTargetIds = Array.from(game.user.targets || []).map(t => t.id);

        // 콤보 본체 즉시 활성화/매크로/어플라이드는 handleItemUse에서 처리됨 → 익스텐드는 아래에서 일괄 수집
        console.log('DX3rd | ComboHandler - Collecting extensions from combo item:', item.name);

        // 포함된 무기의 공격 횟수 증가 (notCheck가 아닌 경우)
        // 단, 공격 판정 콤보(attackRoll !== '-')는 실제 데미지 롤 시점에 main.js의 damage-roll-btn 핸들러가
        // 실제로 사용된 무기(data-weapon-ids)만 +1 하므로 여기서 미리 올리면 이중 증가가 된다.
        // 게다가 미리 올리면 calculateRegisteredWeaponBonus가 해당 무기를 "이미 소진"으로 보고
        // 보너스를 빼버려, 정작 그 공격에 무기 보너스가 빠지는 버그가 생긴다. → 공격 콤보는 건너뜀.
        const isAttackCombo = item.system?.attackRoll && item.system.attackRoll !== '-';
        // 단, 에너미 명중 달성치 경로는 롤 없이 처리되어 데미지 버튼에 무기 ID를 싣지 않으므로
        // (main.js의 증가 핸들러가 동작하지 않음) 이 경우는 예외로 여기서 미리 증가시킨다.
        const isEnemyAchievementShortcut = actor.type === 'enemy' &&
            item.system?.attackAchievement && item.system.attackAchievement !== '-' && item.system.attackAchievement !== '' &&
            isAttackCombo;
        const skipPreIncrement = isAttackCombo && !isEnemyAchievementShortcut;
        const weaponIds = item.system?.weapon || [];
        if (!skipPreIncrement && Array.isArray(weaponIds) && weaponIds.length > 0) {
            for (const weaponId of weaponIds) {
                if (!weaponId || weaponId === '-') continue;
                const weaponItem = actor.items.get(weaponId);
                if (!weaponItem) {
                    console.warn('DX3rd | ComboHandler - Weapon item not found:', weaponId);
                    continue;
                }
                // weapon 타입만 attack-used 증가 (vehicle은 attack-used 필드 없음)
                if (weaponItem.type === 'weapon') {
                    const attackUsedDisable = weaponItem.system['attack-used']?.disable || 'notCheck';
                    if (attackUsedDisable !== 'notCheck') {
                        const currentAttackUsedState = weaponItem.system['attack-used']?.state || 0;
                        await weaponItem.update({ 'system.attack-used.state': currentAttackUsedState + 1 });
                        console.log('DX3rd | ComboHandler - Weapon attack count increased:', weaponItem.name, currentAttackUsedState, '→', currentAttackUsedState + 1);
                    }
                }
            }
        } else if (skipPreIncrement) {
            console.log('DX3rd | ComboHandler - Skipping weapon attack-used pre-increment (attack combo; counted at damage roll)');
        }

        const effectItems = [];
        for (const effectId of effectIds) {
            if (!effectId || effectId === '-') continue;
            const effectItem = actor.items.get(effectId);
            if (!effectItem) {
                console.warn('DX3rd | ComboHandler - Effect item not found:', effectId);
                continue;
            }
            console.log('DX3rd | ComboHandler - Processing effect item:', effectItem.name, 'ID:', effectId);

            // 포함된 이펙트의 사용 횟수 증가 (notCheck가 아닌 경우)
            const effectUsedDisable = effectItem.system?.used?.disable || 'notCheck';
            if (effectUsedDisable !== 'notCheck') {
                const currentEffectUsedState = effectItem.system?.used?.state || 0;
                await effectItem.update({ 'system.used.state': currentEffectUsedState + 1 });
                console.log('DX3rd | ComboHandler - Effect used count increased:', effectItem.name, currentEffectUsedState, '→', currentEffectUsedState + 1);
            }

            // 이펙트 즉시 처리
            try {
                if (effectItem.system?.active?.runTiming === 'instant' && !effectItem.system?.active?.state) {
                    await effectItem.update({ 'system.active.state': true });
                    console.log('DX3rd | ComboHandler - Effect activated (instant):', effectItem.name);
                }
                await handler.executeMacros(effectItem, 'instant');
                await handler.applyToTargets(actor, effectItem, 'instant');
            } catch (e) {
                console.warn('DX3rd | ComboHandler - effect instant process skipped:', effectItem?.name, e);
            }

            effectItems.push(effectItem);
        }

        // 익스텐드 일괄 수집 (콤보 본체 + 포함 이펙트)
        const collectedExtensions = this.collectExtensions(actor, [item, ...effectItems], { includeItemCreation: true });

        console.log('DX3rd | ComboHandler - Total collected extensions before merge:', collectedExtensions.length);
        console.log('DX3rd | ComboHandler - Collected extensions:', collectedExtensions);

        // 3) 익스텐드 병합 (같은 타이밍 + 같은 대상, custom 분리)
        try {
            const buckets = handler.groupExtensionsByKey(collectedExtensions);
            const merged = handler.mergeGroupedExtensionBuckets(actor, buckets);
            console.log('DX3rd | ComboHandler - Merged extension buckets:', merged);
            console.log('DX3rd | ComboHandler - Bucket count by timing:', {
                instant: merged.filter(b => b.timing === 'instant').length,
                afterMain: merged.filter(b => b.timing === 'afterMain').length,
                afterMainInstant: merged.filter(b => b.timing === 'afterMain' && b.parentRunTiming === 'instant').length,
                afterSuccess: merged.filter(b => b.timing === 'afterSuccess').length,
                afterDamage: merged.filter(b => b.timing === 'afterDamage').length
            });

            // instant 및 afterMain 버킷 처리
            for (const b of merged) {
                console.log('DX3rd | ComboHandler - Processing bucket:', b.type, 'timing:', b.timing, 'target:', b.target, 'parentRunTiming:', b.parentRunTiming);
                
                // instant는 즉시 실행, afterMain은 큐에 등록, 나머지는 건너뜀
                if (b.timing === 'instant') {
                    // instant 타이밍 즉시 실행
                    console.log('DX3rd | ComboHandler - Executing instant extension:', b.type);
                    if (b.type === 'heal' && !b.custom) {
                    const healData = {
                        formulaDice: b.merged?.dice || 0,
                        formulaAdd: b.merged?.add || 0,
                        target: b.target,
                        selectedTargetIds,
                        resurrect: b.resurrect || false,
                        rivival: b.rivival || false,
                        // 콤보 병합 트리거 - 트리거 아이템 이름은 콤보 이름
                        triggerItemName: item.name
                    };
                    await handler.executeHealExtensionNow(actor, healData, null);
                } else if (b.type === 'damage' && !b.custom) {
                    const damageData = {
                        formulaDice: b.merged?.dice || 0,
                        formulaAdd: b.merged?.add || 0,
                        target: b.target,
                        selectedTargetIds,
                        ignoreReduce: b.ignoreReduce || false,
                        triggerItemName: item.name
                    };
                    await handler.executeDamageExtensionNow(actor, damageData, null);
                } else if (b.type === 'condition' && !b.custom) {
                    // 같은 대상이면 서로 다른 컨디션도 한 번의 다이얼로그로 병합 처리
                    const conditionTypes = b.merged?.conditions || [];
                    await handler.executeConditionExtensionsNowBulk(actor, {
                        conditionTypes,
                        target: b.target,
                        selectedTargetIds,
                        triggerItemName: item.name,
                        poisonedRank: b.poisonedRank || null
                    });
                } else if (b.type === 'weapon' || b.type === 'protect' || b.type === 'vehicle') {
                    // 아이템 생성은 병합하지 않고 각 소스별로 개별 생성
                    for (const src of b.sources) {
                        const srcItem = actor.items.get(src.itemId);
                        if (!srcItem) continue;
                        try {
                            await handler.executeItemExtension(actor, b.type, src.raw.extensionData || {}, srcItem);
                            console.log(`DX3rd | ComboHandler - Created ${b.type} from:`, srcItem.name);
                        } catch (e) {
                            console.warn(`DX3rd | ComboHandler - Failed to create ${b.type} from ${srcItem.name}:`, e);
                        }
                    }
                    } else if (b.custom) {
                        // 버킷 단위 custom(임의 공식)은 기존 단일 다이얼로그 흐름으로 처리하도록 개별 소스 실행을 유지
                        // → 별도 병합 다이얼로그 구현 전까지는 스킵 (중복 창 방지 목적)
                        console.log('DX3rd | ComboHandler - Skipping custom bucket for now (kept for existing dialog):', b);
                    }
                } else if (b.timing === 'afterMain' && b.parentRunTiming === 'instant') {
                    // afterMain 타이밍은 큐에 등록
                    // 단, parentRunTiming이 instant인 경우만 여기서 등록 (afterSuccess/afterDamage는 해당 타이밍에서 등록)
                    console.log('DX3rd | ComboHandler - Registering afterMain extension (parentRunTiming=instant):', b.type, 'merged data:', b.merged);
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
                        console.log('DX3rd | ComboHandler - AfterMain heal data:', healData);
                        handler.addToAfterMainQueue(actor, healData, null, 'heal');
                    } else if (b.type === 'damage') {
                        const damageData = {
                            formulaDice: b.merged?.dice || 0,
                            formulaAdd: b.merged?.add || 0,
                            target: b.target,
                            selectedTargetIds,
                            ignoreReduce: b.ignoreReduce || false,
                            triggerItemName: item.name
                        };
                        console.log('DX3rd | ComboHandler - AfterMain damage data:', damageData);
                        handler.addToAfterMainQueue(actor, damageData, null, 'damage');
                    } else if (b.type === 'condition') {
                        const conditionData = {
                            conditionTypes: b.merged?.conditions || [],
                            target: b.target,
                            selectedTargetIds,
                            triggerItemName: item.name,
                            poisonedRank: b.poisonedRank || null
                        };
                        console.log('DX3rd | ComboHandler - AfterMain condition data:', conditionData);
                        handler.addToAfterMainQueue(actor, conditionData, null, 'condition');
                    }
                } else {
                    // instant, afterMain이 아닌 타이밍은 건너뜀 (afterSuccess, afterDamage는 별도 처리)
                    console.log('DX3rd | ComboHandler - Skipping bucket (not instant/afterMain):', b.type, 'timing:', b.timing);
                }
            }
        } catch (e) {
            console.warn('DX3rd | ComboHandler - merge/execute instant extensions failed:', e);
        }
    },
    
    /**
     * afterSuccess 익스텐션 수집 및 병합 (롤 있는 콤보용)
     * 활성화/매크로/어플라이드도 함께 수집하여 반환
     * @returns {Object} { activations: [], macros: [], applies: [], extensions: [merged buckets] }
     */
    async collectAfterSuccessData(actor, item) {
        console.log("DX3rd | ComboHandler - Collecting afterSuccess data for combo:", item.name);
        const handler = window.DX3rdUniversalHandler;
        if (!handler) return null;

        const result = {
            activations: [], // { itemId, itemName }
            macros: [],      // { itemId, itemName, macroName, timing }
            applies: [],     // { itemId, itemName }
            extensions: [],  // merged buckets (afterSuccess)
            afterMainExtensions: [] // merged buckets (afterMain, runTiming이 afterSuccess인 경우)
        };

        // effect 참조 정규화 (임시 콤보의 effect.data도 지원)
        const effectIds = handler.normalizeEffectIds(item);
        const selectedTargetIds = Array.from(game.user.targets || []).map(t => t.id);

        // 콤보 본체 수집
        console.log('DX3rd | ComboHandler - Checking combo body for afterSuccess:', {
            activeRunTiming: item.system?.active?.runTiming,
            activeState: item.system?.active?.state,
            effectRunTiming: item.system?.effect?.runTiming,
            getTarget: item.system?.getTarget
        });
        
        // 1) 활성화 (disable이 'notCheck'가 아닌 경우에만)
        const activeDisable = item.system?.active?.disable ?? '-';
        if (item.system?.active?.runTiming === 'afterSuccess' && !item.system?.active?.state && activeDisable !== 'notCheck') {
            result.activations.push({ itemId: item.id, itemName: item.name });
            console.log('DX3rd | ComboHandler - Added combo activation:', item.name);
        }
        // 2) 매크로 (문자열 파싱)
        const comboMacroString = item.system?.macro || '';
        if (comboMacroString) {
            const macroMatches = comboMacroString.match(/\[([^\]]+)\]/g) || [];
            for (const match of macroMatches) {
                const macroName = match.slice(1, -1);
                const macro = game.macros?.getName(macroName);
                if (macro) {
                    const macroTiming = macro.getFlag('dx3rd-emanim', 'runTiming') || 'instant';
                    if (macroTiming === 'afterSuccess') {
                        result.macros.push({ itemId: item.id, itemName: item.name, macroName: macroName, timing: macroTiming });
                        console.log('DX3rd | ComboHandler - Added combo macro:', macroName);
                    }
                }
            }
        }
        // 3) 어플라이드 (콤보는 어플라이드가 있는지 확인 필요)
        if (item.system?.getTarget && item.system?.effect?.runTiming === 'afterSuccess') {
            result.applies.push({ itemId: item.id, itemName: item.name });
            console.log('DX3rd | ComboHandler - Added combo apply:', item.name);
        }
        // 4) 익스텐션은 아래에서 일괄 수집

        // 포함된 이펙트들 수집
        const effectItems = [];
        for (const effectId of effectIds) {
            if (!effectId || effectId === '-') continue;
            const effectItem = actor.items.get(effectId);
            if (!effectItem) continue;
            effectItems.push(effectItem);

            console.log('DX3rd | ComboHandler - Checking effect for afterSuccess:', effectItem.name, {
                activeRunTiming: effectItem.system?.active?.runTiming,
                activeState: effectItem.system?.active?.state,
                effectRunTiming: effectItem.system?.effect?.runTiming,
                getTarget: effectItem.system?.getTarget
            });

            // 1) 활성화 (disable이 'notCheck'가 아닌 경우에만)
            const effectActiveDisable = effectItem.system?.active?.disable ?? '-';
            if (effectItem.system?.active?.runTiming === 'afterSuccess' && !effectItem.system?.active?.state && effectActiveDisable !== 'notCheck') {
                result.activations.push({ itemId: effectItem.id, itemName: effectItem.name });
                console.log('DX3rd | ComboHandler - Added effect activation:', effectItem.name);
            }
            // 2) 매크로 (문자열 파싱)
            const effectMacroString = effectItem.system?.macro || '';
            if (effectMacroString) {
                const macroMatches = effectMacroString.match(/\[([^\]]+)\]/g) || [];
                for (const match of macroMatches) {
                    const macroName = match.slice(1, -1);
                    const macro = game.macros?.getName(macroName);
                    if (macro) {
                        const macroTiming = macro.getFlag('dx3rd-emanim', 'runTiming') || 'instant';
                        if (macroTiming === 'afterSuccess') {
                            result.macros.push({ itemId: effectItem.id, itemName: effectItem.name, macroName: macroName, timing: macroTiming });
                            console.log('DX3rd | ComboHandler - Added effect macro:', macroName, 'from:', effectItem.name);
                        }
                    }
                }
            }
            // 3) 어플라이드
            if (effectItem.system?.getTarget && effectItem.system?.effect?.runTiming === 'afterSuccess') {
                result.applies.push({ itemId: effectItem.id, itemName: effectItem.name });
                console.log('DX3rd | ComboHandler - Added effect apply:', effectItem.name);
            }
            // 4) 익스텐션은 아래에서 일괄 수집
        }

        // 익스텐드 일괄 수집 (콤보 본체 + 포함 이펙트)
        const collectedExtensions = this.collectExtensions(actor, [item, ...effectItems], { includeItemCreation: true });

        // 익스텐션 병합 (afterSuccess + afterMain)
        console.log('DX3rd | ComboHandler - Collected extensions count:', collectedExtensions.length);
        
        // afterSuccess 타이밍 익스텐션 병합
        const afterSuccessExtensions = collectedExtensions.filter(e => e.timing === 'afterSuccess');
        console.log('DX3rd | ComboHandler - AfterSuccess extensions count:', afterSuccessExtensions.length);
        if (afterSuccessExtensions.length > 0) {
            const buckets = handler.groupExtensionsByKey(afterSuccessExtensions);
            const merged = handler.mergeGroupedExtensionBuckets(actor, buckets);
            console.log('DX3rd | ComboHandler - Merged afterSuccess buckets:', merged.length);
            result.extensions = merged.map(b => ({
                ...b,
                selectedTargetIds // 현재 타겟 저장
            }));
        }
        
        // afterMain 타이밍 익스텐션 병합 (parentRunTiming이 afterSuccess인 것만)
        const afterMainExtensions = collectedExtensions.filter(e => 
            e.timing === 'afterMain' && e.parentRunTiming === 'afterSuccess'
        );
        console.log('DX3rd | ComboHandler - AfterMain extensions (parentRunTiming=afterSuccess):', afterMainExtensions.length);
        if (afterMainExtensions.length > 0) {
            const buckets = handler.groupExtensionsByKey(afterMainExtensions);
            const merged = handler.mergeGroupedExtensionBuckets(actor, buckets);
            console.log('DX3rd | ComboHandler - Merged afterMain buckets:', merged.length);
            result.afterMainExtensions = merged.map(b => ({
                ...b,
                selectedTargetIds // 현재 타겟 저장
            }));
        }

        console.log('DX3rd | ComboHandler - Collected afterSuccess data:', result);
        return result;
    },
    
    /**
     * afterDamage 익스텐션 수집 및 병합 (롤 있는 콤보용)
     * afterSuccess와 동일한 구조이지만 afterDamage 타이밍만 필터
     * @returns {Object} { activations: [], macros: [], applies: [], extensions: [merged buckets] }
     */
    async collectAfterDamageData(actor, item) {
        console.log("DX3rd | ComboHandler - Collecting afterDamage data for combo:", item.name);
        const handler = window.DX3rdUniversalHandler;
        if (!handler) return null;

        const result = {
            activations: [], // { itemId, itemName }
            macros: [],      // { itemId, itemName, macroName, timing }
            applies: [],     // { itemId, itemName }
            extensions: [],  // merged buckets (afterDamage)
            afterMainExtensions: [] // merged buckets (afterMain, runTiming이 afterDamage인 경우)
        };

        // effect 참조 정규화 (임시 콤보의 effect.data도 지원)
        const effectIds = handler.normalizeEffectIds(item);
        const selectedTargetIds = Array.from(game.user.targets || []).map(t => t.id);

        // 콤보 본체 수집
        // 1) 활성화 (disable이 'notCheck'가 아닌 경우에만)
        const activeDisable = item.system?.active?.disable ?? '-';
        if (item.system?.active?.runTiming === 'afterDamage' && !item.system?.active?.state && activeDisable !== 'notCheck') {
            result.activations.push({ itemId: item.id, itemName: item.name });
        }
        // 2) 매크로 (문자열 파싱)
        const comboMacroStringDamage = item.system?.macro || '';
        if (comboMacroStringDamage) {
            const macroMatches = comboMacroStringDamage.match(/\[([^\]]+)\]/g) || [];
            for (const match of macroMatches) {
                const macroName = match.slice(1, -1);
                const macro = game.macros?.getName(macroName);
                if (macro) {
                    const macroTiming = macro.getFlag('dx3rd-emanim', 'runTiming') || 'instant';
                    if (macroTiming === 'afterDamage') {
                        result.macros.push({ itemId: item.id, itemName: item.name, macroName: macroName, timing: macroTiming });
                        console.log('DX3rd | ComboHandler - Added combo macro (afterDamage):', macroName);
                    }
                }
            }
        }
        // 3) 어플라이드
        if (item.system?.getTarget && item.system?.effect?.runTiming === 'afterDamage') {
            result.applies.push({ itemId: item.id, itemName: item.name });
        }
        // 4) 익스텐션은 아래에서 일괄 수집

        // 포함된 이펙트들 수집
        const effectItems = [];
        for (const effectId of effectIds) {
            const effectItem = actor.items.get(effectId);
            if (!effectItem) continue;
            effectItems.push(effectItem);

            // 1) 활성화 (disable이 'notCheck'가 아닌 경우에만)
            const effectActiveDisable = effectItem.system?.active?.disable ?? '-';
            if (effectItem.system?.active?.runTiming === 'afterDamage' && !effectItem.system?.active?.state && effectActiveDisable !== 'notCheck') {
                result.activations.push({ itemId: effectItem.id, itemName: effectItem.name });
            }
            // 2) 매크로 (문자열 파싱)
            const effectMacroStringDamage = effectItem.system?.macro || '';
            if (effectMacroStringDamage) {
                const macroMatches = effectMacroStringDamage.match(/\[([^\]]+)\]/g) || [];
                for (const match of macroMatches) {
                    const macroName = match.slice(1, -1);
                    const macro = game.macros?.getName(macroName);
                    if (macro) {
                        const macroTiming = macro.getFlag('dx3rd-emanim', 'runTiming') || 'instant';
                        if (macroTiming === 'afterDamage') {
                            result.macros.push({ itemId: effectItem.id, itemName: effectItem.name, macroName: macroName, timing: macroTiming });
                            console.log('DX3rd | ComboHandler - Added effect macro (afterDamage):', macroName, 'from:', effectItem.name);
                        }
                    }
                }
            }
            // 3) 어플라이드
            if (effectItem.system?.getTarget && effectItem.system?.effect?.runTiming === 'afterDamage') {
                result.applies.push({ itemId: effectItem.id, itemName: effectItem.name });
            }
            // 4) 익스텐션은 아래에서 일괄 수집
        }

        // 익스텐드 일괄 수집 (콤보 본체 + 포함 이펙트). afterDamage는 아이템 생성 익스텐션 제외(instant 전용)
        const collectedExtensions = this.collectExtensions(actor, [item, ...effectItems], { includeItemCreation: false });

        // 익스텐션 병합 (afterDamage + afterMain)
        console.log('DX3rd | ComboHandler - Collected extensions count:', collectedExtensions.length);
        
        // afterDamage 타이밍 익스텐션 병합
        const afterDamageExtensions = collectedExtensions.filter(e => e.timing === 'afterDamage');
        console.log('DX3rd | ComboHandler - AfterDamage extensions count:', afterDamageExtensions.length);
        if (afterDamageExtensions.length > 0) {
            const buckets = handler.groupExtensionsByKey(afterDamageExtensions);
            const merged = handler.mergeGroupedExtensionBuckets(actor, buckets);
            console.log('DX3rd | ComboHandler - Merged afterDamage buckets:', merged.length);
            result.extensions = merged.map(b => ({
                ...b,
                selectedTargetIds // 현재 타겟 저장
            }));
        }
        
        // afterMain 타이밍 익스텐션 병합 (parentRunTiming이 afterDamage인 것만)
        const afterMainExtensions = collectedExtensions.filter(e => 
            e.timing === 'afterMain' && e.parentRunTiming === 'afterDamage'
        );
        console.log('DX3rd | ComboHandler - AfterMain extensions (parentRunTiming=afterDamage):', afterMainExtensions.length);
        if (afterMainExtensions.length > 0) {
            const buckets = handler.groupExtensionsByKey(afterMainExtensions);
            const merged = handler.mergeGroupedExtensionBuckets(actor, buckets);
            console.log('DX3rd | ComboHandler - Merged afterMain buckets:', merged.length);
            result.afterMainExtensions = merged.map(b => ({
                ...b,
                selectedTargetIds // 현재 타겟 저장
            }));
        }

        console.log('DX3rd | ComboHandler - Collected afterDamage data:', result);
        return result;
    },
    
    /**
     * 판정 콤보 처리 (system.roll !== '-')
     * 침식률/활성화는 이미 handleItemUse에서 처리됨
     */
    async handleComboRoll(actor, item, rollType, getTarget) {
        console.log("DX3rd | ComboHandler - Combo roll processing", { rollType });
        
        const handler = window.DX3rdUniversalHandler;
        if (!handler) {
            console.error("DX3rd | UniversalHandler not found");
            return;
        }
        
        // 에너미이고 명중 달성치가 입력되어 있으면 롤 없이 바로 데미지 롤 버튼 생성 (다이스/수정치 보정 반영)
        if (actor.type === 'enemy' && item.system?.attackAchievement && 
            item.system.attackAchievement !== '-' && item.system.attackAchievement !== '' &&
            item.system?.attackRoll && item.system.attackRoll !== '-') {
            const baseAchievement = Number(item.system.attackAchievement);
            if (!isNaN(baseAchievement) && baseAchievement > 0) {
                const achievementValue = this.getAchievementWithModifiers(actor, item, baseAchievement);
                await this.createAttackMessageWithAchievement(actor, item, achievementValue);
                return;
            }
        }
        
        // 무기 선택이 활성화된 경우, 무기 선택 다이얼로그 표시
        if (item.system?.weaponSelect && item.system?.attackRoll && item.system.attackRoll !== '-') {
            await this.showWeaponSelectionForAttack(actor, item, rollType);
            return;
        }
        
        // 무기 선택이 비활성화되어 있지만 공격 판정인 경우, 등록된 무기 보너스 적용
        if (!item.system?.weaponSelect && item.system?.attackRoll && item.system.attackRoll !== '-') {
            console.log('DX3rd | ComboHandler - Attack roll without weapon selection, using registered weapons');
            const registeredWeaponBonus = this.calculateRegisteredWeaponBonus(actor, item);
            
            // 등록된 무기 중 사용 가능한 무기가 하나라도 있으면 보너스 적용
            const hasAvailableWeapons = registeredWeaponBonus.weaponIds.length > 0;
            
            if (hasAvailableWeapons) {
                // 사용 가능한 무기가 있으면 보너스 적용
                const weaponBonus = (registeredWeaponBonus.attack > 0 || registeredWeaponBonus.add !== 0) 
                    ? registeredWeaponBonus 
                    : null;
                
                await this.handleComboRollWithWeapon(actor, item, rollType, weaponBonus);
                return;
            }
            // weaponSelect가 false이면 무기 선택 다이얼로그를 열지 않고 일반 판정으로 진행
        }
        
        // 북 해독 콤보 등에서 전달된 메타데이터 복원
        const predefinedDifficulty = item.meta?.predefinedDifficulty || null;
        const originalItem = item.meta?.originalItem || null;
        const rollItemForDialog = originalItem || item;

        // 아이템의 스킬로 stat 데이터 가져오기
        const skillKey = item.system?.skill;
        if (!skillKey || skillKey === '-') {
            ui.notifications.warn('콤보의 기능이 설정되지 않았습니다.');
            return;
        }
        
        // 스킬 또는 능력치 데이터 가져오기
        const attributes = ['body', 'sense', 'mind', 'social'];
        let stat = null;
        let label = '';
        
        if (attributes.includes(skillKey)) {
            // 능력치
            stat = actor.system.attributes[skillKey];
            label = game.i18n.localize(`DX3rd.${skillKey.charAt(0).toUpperCase() + skillKey.slice(1)}`);
        } else if (skillKey === 'syndrome') {
            // 신드롬
            stat = actor.system.attributes.syndrome;
            label = stat?.name || game.i18n.localize('DX3rd.Syndrome');
            if (label && label.startsWith('DX3rd.')) {
                label = game.i18n.localize(label);
            }
        } else if (skillKey === 'text') {
            // 텍스트
            stat = actor.system.attributes.text;
            label = stat?.name || game.i18n.localize('DX3rd.Text');
            if (label && label.startsWith('DX3rd.')) {
                label = game.i18n.localize(label);
            }
        } else if (skillKey === 'cthulhu') {
            // 크툴루 신화
            stat = actor.system.attributes.skills?.cthulhu;
            label = stat?.name || game.i18n.localize('DX3rd.cthulhu');
            if (label && label.startsWith('DX3rd.')) {
                label = game.i18n.localize(label);
            }
        } else {
            // 스킬 - system.base 설정 확인
            const customBase = item.system?.base;
            if (customBase && customBase !== '-' && attributes.includes(customBase)) {
                // 커스텀 base 사용 - 스킬 보정 계산
                const baseStat = actor.system.attributes[customBase];
                const skillStat = actor.system.attributes.skills?.[skillKey];
                const originalBaseStat = actor.system.attributes[skillStat?.base];
                
                if (baseStat && skillStat && originalBaseStat) {
                    // 스킬의 순수 보정 계산
                    const skillDiceBonus = (skillStat.dice || 0) - (originalBaseStat.dice || 0);
                    const skillAddBonus = (skillStat.add || 0) - (originalBaseStat.add || 0);
                    
                    // 커스텀 base + 스킬 보정으로 새로운 stat 객체 생성
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
                    console.log(`DX3rd | ComboHandler - Using custom base: ${customBase} for skill: ${skillKey}`);
                    console.log(`DX3rd | ComboHandler - Skill bonus: dice=${skillDiceBonus}, add=${skillAddBonus}`);
                    console.log(`DX3rd | ComboHandler - Final stat:`, stat);
                } else {
                    // 폴백: 기본 base 사용
                    stat = baseStat;
                    label = game.i18n.localize(`DX3rd.${customBase.charAt(0).toUpperCase() + customBase.slice(1)}`);
                }
            } else {
                // 기본 스킬 사용
                stat = actor.system.attributes.skills?.[skillKey];
                if (stat) {
                    label = this.getSkillDisplayName(skillKey, stat);
                }
            }
        }
        
        if (!stat) {
            ui.notifications.warn('기능 데이터를 찾을 수 없습니다.');
            return;
        }
        
        // afterSuccess와 afterDamage 데이터 수집
        const afterSuccessData = await this.collectAfterSuccessData(actor, item);
        const afterDamageData = await this.collectAfterDamageData(actor, item);
        
        // 판정 다이얼로그 표시 (afterSuccess와 afterDamage 데이터 전달)
        // 마도서 해독 콤보인 경우, 원본 북 아이템과 미리 정의된 난이도를 사용
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
            predefinedDifficulty
        );
    },
    
    /**
     * 공격용 무기 선택 다이얼로그 표시
     */
    async showWeaponSelectionForAttack(actor, item, rollType) {
        const attackRollType = item.system.attackRoll;
        
        // 액터의 모든 무기 + 비클 가져오기 (종별 필터링 제거)
        const allWeapons = actor.items.filter(w => w.type === 'weapon' || w.type === 'vehicle');
        
        if (allWeapons.length === 0) {
            ui.notifications.warn('무기/비클이 없습니다.');
            return;
        }
        
        // 무기 선택 다이얼로그 표시
        new window.DX3rdWeaponForAttackDialog({
            actor: actor,
            weapons: allWeapons,
            attackRoll: attackRollType,
            title: game.i18n.localize('DX3rd.WeaponSelection'),
            callback: async (weaponBonus) => {
                // 무기 보너스를 적용하여 판정 다이얼로그 표시
                await this.handleComboRollWithWeapon(actor, item, rollType, weaponBonus);
            }
        }).render(true);
    },
    
    /**
     * 무기 탭에 등록된 무기들의 보너스 계산 (공격 횟수가 남은 무기만)
     */
    calculateRegisteredWeaponBonus(actor, item) {
        const weaponBonus = { attack: 0, add: 0, weaponName: '', weaponIds: [] };
        
        // 무기 탭에 등록된 무기들 가져오기
        const registeredWeapons = item.system?.weapon || [];
        
        console.log('DX3rd | ComboHandler - Registered weapons:', registeredWeapons);
        
        // 각 등록된 무기의 보너스 합산 (공격 횟수가 남은 무기만)
        for (const weaponId of registeredWeapons) {
            if (weaponId && weaponId !== '-') {
                // 액터의 아이템에서 직접 무기 데이터 가져오기
                const weaponItem = actor.items.get(weaponId);
                if (weaponItem && weaponItem.type === 'weapon') {
                    // 공격 횟수 체크 (weapon만, vehicle은 attack-used 없음)
                    const attackUsedDisable = weaponItem.system['attack-used']?.disable || 'notCheck';
                    const attackUsedState = weaponItem.system['attack-used']?.state || 0;
                    const attackUsedMax = weaponItem.system['attack-used']?.max || 0;
                    const isAttackExhausted = attackUsedDisable !== 'notCheck' && (attackUsedMax <= 0 || attackUsedState >= attackUsedMax);
                    
                    // 공격 횟수가 소진된 무기는 제외
                    if (isAttackExhausted) {
                        console.log(`DX3rd | ComboHandler - Weapon ${weaponItem.name} attack exhausted, skipping (${attackUsedState}/${attackUsedMax})`);
                        continue;
                    }
                    
                    // 공격력 합산 (문자열로 저장됨)
                    const attackValue = Number(weaponItem.system?.attack) || 0;
                    weaponBonus.attack += attackValue;
                    
                    // 수정치 합산 (문자열로 저장됨)
                    const addValue = Number(weaponItem.system?.add) || 0;
                    weaponBonus.add += addValue;
                    
                    // 무기 이름 추가 (루비 텍스트 제거)
                    const cleanWeaponName = weaponItem.name.split('||')[0].trim();
                    if (!weaponBonus.weaponName) {
                        weaponBonus.weaponName = cleanWeaponName;
                    } else {
                        weaponBonus.weaponName += `, ${cleanWeaponName}`;
                    }
                    
                    // 무기 ID 추가
                    weaponBonus.weaponIds.push(weaponId);
                    
                    console.log(`DX3rd | ComboHandler - Weapon ${weaponItem.name}: attack=${attackValue}, add=${addValue}`);
                } else if (weaponItem) {
                    console.log(`DX3rd | ComboHandler - Item ${weaponItem.name} is not a weapon, skipping`);
                } else {
                    console.warn(`DX3rd | ComboHandler - Weapon not found: ${weaponId}`);
                }
            }
        }
        
        console.log('DX3rd | ComboHandler - Total weapon bonus:', weaponBonus);
        return weaponBonus;
    },

    /**
     * 무기 보너스를 적용한 판정 처리
     */
    async handleComboRollWithWeapon(actor, item, rollType, weaponBonus) {
        const handler = window.DX3rdUniversalHandler;
        
        // 북 해독 콤보 등에서 전달된 메타데이터 복원
        const predefinedDifficulty = item.meta?.predefinedDifficulty || null;
        const originalItem = item.meta?.originalItem || null;
        const rollItemForDialog = originalItem || item;

        // 아이템의 스킬로 stat 데이터 가져오기
        const skillKey = item.system?.skill;
        if (!skillKey || skillKey === '-') {
            ui.notifications.warn('콤보의 기능이 설정되지 않았습니다.');
            return;
        }
        
        // 스킬 또는 능력치 데이터 가져오기
        const attributes = ['body', 'sense', 'mind', 'social'];
        let stat = null;
        let label = '';
        
        if (attributes.includes(skillKey)) {
            stat = actor.system.attributes[skillKey];
            label = game.i18n.localize(`DX3rd.${skillKey.charAt(0).toUpperCase() + skillKey.slice(1)}`);
        } else {
            // 스킬 - system.base 설정 확인
            const customBase = item.system?.base;
            if (customBase && customBase !== '-' && attributes.includes(customBase)) {
                // 커스텀 base 사용 - 스킬 보정 계산
                const baseStat = actor.system.attributes[customBase];
                const skillStat = actor.system.attributes.skills?.[skillKey];
                const originalBaseStat = actor.system.attributes[skillStat?.base];
                
                if (baseStat && skillStat && originalBaseStat) {
                    // 스킬의 순수 보정 계산
                    const skillDiceBonus = (skillStat.dice || 0) - (originalBaseStat.dice || 0);
                    const skillAddBonus = (skillStat.add || 0) - (originalBaseStat.add || 0);
                    
                    // 커스텀 base + 스킬 보정으로 새로운 stat 객체 생성
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
                    console.log(`DX3rd | ComboHandler - Using custom base: ${customBase} for skill: ${skillKey}`);
                    console.log(`DX3rd | ComboHandler - Skill bonus: dice=${skillDiceBonus}, add=${skillAddBonus}`);
                    console.log(`DX3rd | ComboHandler - Final stat:`, stat);
                } else {
                    // 폴백: 기본 base 사용
                    stat = baseStat;
                    label = game.i18n.localize(`DX3rd.${customBase.charAt(0).toUpperCase() + customBase.slice(1)}`);
                }
            } else {
                // 기본 스킬 사용
                stat = actor.system.attributes.skills?.[skillKey];
                if (stat) {
                    label = this.getSkillDisplayName(skillKey, stat);
                }
            }
        }
        
        if (!stat) {
            ui.notifications.warn('기능 데이터를 찾을 수 없습니다.');
            return;
        }
        
        // afterSuccess와 afterDamage 데이터 수집
        const afterSuccessData = await this.collectAfterSuccessData(actor, item);
        const afterDamageData = await this.collectAfterDamageData(actor, item);
        
        console.log('DX3rd | ComboHandler - Weapon bonus to apply:', weaponBonus);
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
            predefinedDifficulty
        );
    },
    
    /**
     * 에너미 명중 달성치에 다이스/수정치 보정 반영 (다이스 1개당 +2, 수정치는 그대로 가산)
     * 전체·메이저·해당 판정 능력치/기능의 다이스·수정치 보정을 합산하여 반영
     * @param {Actor} actor - 에너미 액터
     * @param {Item} item - 콤보 아이템
     * @param {number} baseAchievement - 시트의 명중 달성치
     * @returns {number} 보정 반영된 달성치
     */
    getAchievementWithModifiers(actor, item, baseAchievement) {
        const skillKey = item.system?.skill;
        if (!skillKey || skillKey === '-') return baseAchievement;
        
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
        
        if (!stat) return baseAchievement;
        
        // 스킬인데 .major가 없으면 (에너미 등) 해당 능력치의 메이저 보정을 반영
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
        const adjusted = baseAchievement + (diceModifier * 2) + addModifier;
        return Math.max(1, Math.floor(adjusted));
    },
    
    /**
     * 에너미의 명중 달성치를 사용하여 공격 메시지 및 데미지 롤 버튼 생성 (롤 없이)
     * @param {Actor} actor - 액터
     * @param {Item} item - 콤보 아이템
     * @param {number} achievementValue - 명중 달성치
     */
    async createAttackMessageWithAchievement(actor, item, achievementValue) {
        const handler = window.DX3rdUniversalHandler;
        if (!handler) {
            console.error("DX3rd | UniversalHandler not found");
            return;
        }
        
        // 판정을 이미 한 것이므로, 일반 공격과 동일하게 afterSuccess/afterDamage 데이터 수집 (데미지 롤 버튼 클릭 시 메인 프로세스 이후 처리용)
        const afterSuccessData = await this.collectAfterSuccessData(actor, item);
        const afterDamageData = await this.collectAfterDamageData(actor, item);
        
        // 사용 시 활성화: 비활성화 타이밍이 "판정 이후"인 콤보는 판정을 이미 한 것으로 보므로, 데미지 롤 버튼을 만들기 전에 afterSuccess 활성화 처리
        for (const { itemId } of (afterSuccessData?.activations || [])) {
            const targetItem = actor.items.get(itemId);
            if (targetItem?.system?.active?.runTiming === 'afterSuccess' && !targetItem.system?.active?.state) {
                await targetItem.update({ 'system.active.state': true });
            }
        }
        
        // 스킬 이름 가져오기
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
        
        // 현재 시점의 액터 값들 저장
        const itemAttackValue = window.DX3rdFormulaEvaluator.evaluate(item.system.attack, item, actor);
        
        // 공격 타입 확인
        let attackType = null;
        if (item.type === 'weapon') {
            attackType = item.system.type || null; // 'melee' or 'ranged'
        } else if (item.type === 'vehicle') {
            attackType = 'melee'; // 비클은 항상 melee
        } else if (item.system?.attackRoll && item.system.attackRoll !== '-') {
            attackType = item.system.attackRoll; // 'melee' or 'ranged'
        }
        
        // 공격 타입에 맞는 attack 보너스 계산
        let actorAttack = actor.system.attributes.attack?.value || 0;
        if (attackType === 'melee' && actor.system.attributes.attack?.melee) {
            actorAttack += actor.system.attributes.attack.melee;
        } else if (attackType === 'ranged' && actor.system.attributes.attack?.ranged) {
            actorAttack += actor.system.attributes.attack.ranged;
        }
        // 맨손 한정 공격력(축퇴기관 등): 무기가 맨손일 때만 가산
        actorAttack += window.DX3rdUniversalHandler?.getFistAttackBonus?.(actor, item) || 0;

        // 공격 타입에 맞는 damage_roll 보너스 계산
        let actorDamageRoll = actor.system.attributes.damage_roll?.value || 0;
        if (attackType === 'melee' && actor.system.attributes.damage_roll?.melee) {
            actorDamageRoll += actor.system.attributes.damage_roll.melee;
        } else if (attackType === 'ranged' && actor.system.attributes.damage_roll?.ranged) {
            actorDamageRoll += actor.system.attributes.damage_roll.ranged;
        }
        
        const preservedValues = {
            actorAttack: actorAttack,
            actorDamageRoll: actorDamageRoll,
            actorPenetrate: actor.system.attributes.penetrate?.value || 0
        };
        
        // 아이템 타입별 공격력 키 설정
        if (item.type === 'weapon') {
            preservedValues.weaponAttack = itemAttackValue;
        } else if (item.type === 'vehicle') {
            preservedValues.vehicleAttack = itemAttackValue;
        } else {
            preservedValues.itemAttack = itemAttackValue;
        }
        
        // 공격 굴림 메시지 출력 (루비 텍스트 제거)
        const cleanItemName = item.name.split('||')[0].trim();
        let flavorText = `${cleanItemName} - ${skillName} (${game.i18n.localize('DX3rd.AttackRoll')})`;
        flavorText += `\n· ${game.i18n.localize('DX3rd.Achievement')}: ${achievementValue}`;
        
        // 대상 정보 추가
        const targets = Array.from(game.user.targets);
        if (targets.length > 0) {
            const rollResult = achievementValue;
            const targetDisplayNames = [];
            
            for (const target of targets) {
                const targetActor = target.actor;
                const targetName = targetActor?.name || target.name;
                if (!targetName) continue;
                
                // 대상이 에너미이고 이베이전이 활성화되어 있는 경우 확인
                if (targetActor && targetActor.type === 'enemy') {
                    const evasionDisabled = targetActor.system?.attributes?.evasion?.disabled;
                    const evasionValue = targetActor.system?.attributes?.evasion?.value;
                    
                    if (evasionDisabled === false && evasionValue !== undefined && evasionValue !== null) {
                        const evasionNum = Number(evasionValue) || 0;
                        const isHit = rollResult >= evasionNum;
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
        
        // 데미지 롤 버튼 생성
        let damageRollButtonContent = `<button class="damage-roll-btn" 
                    data-actor-id="${actor.id}" 
                    data-item-id="${item.id}"
                    data-roll-result="${achievementValue}"
                    data-preserved-actor-attack="${preservedValues.actorAttack}"
                    data-preserved-actor-damage-roll="${preservedValues.actorDamageRoll}"
                    data-preserved-actor-penetrate="${preservedValues.actorPenetrate}"`;
        
        // 아이템 타입별 공격력 데이터 속성 추가
        if (item.type === 'weapon') {
            damageRollButtonContent += `\n                    data-preserved-weapon-attack="${preservedValues.weaponAttack}"`;
            damageRollButtonContent += `\n                    data-weapon-ids="${item.id}"`;
        } else if (item.type === 'vehicle') {
            damageRollButtonContent += `\n                    data-preserved-vehicle-attack="${preservedValues.vehicleAttack}"`;
        } else {
            damageRollButtonContent += `\n                    data-preserved-item-attack="${preservedValues.itemAttack}"`;
        }
        
        damageRollButtonContent += `>
                ${game.i18n.localize('DX3rd.DamageRoll')}
            </button>`;
        
        // 공격 메시지, 대상 정보, 롤 결과, 데미지 롤 버튼을 하나의 메시지로 묶기
        const attackMessageContent = `
          <div class="dx3rd-item-chat">
            <div>
              <p>${flavorText.replace(/\n/g, '<br>')}</p>
            </div>
            <div class="damage-roll-message">
              ${damageRollButtonContent}
            </div>
          </div>
        `;
        
        // 콤보 afterSuccess/afterDamage 플래그 저장 (데미지 롤 버튼 클릭 시 processComboAfterSuccess 등 메인 프로세스 이후 처리 실행용)
        const messageData = {
            speaker: ChatMessage.getSpeaker({ actor: actor }),
            content: attackMessageContent
        };
        if (afterSuccessData || afterDamageData || (item.id && item.id.startsWith('_temp_combo_'))) {
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
            if (item.id && item.id.startsWith('_temp_combo_')) {
                messageData.flags['dx3rd-emanim'].tempComboItem = item;
            }
        }
        
        await ChatMessage.create(messageData);
        
        // 메이저 롤 후 비활성화 훅 실행 (자기 자신에게만)
        if (window.DX3rdDisableHooks) {
            await window.DX3rdDisableHooks.executeDisableHook('roll', actor);
            await window.DX3rdDisableHooks.executeDisableHook('major', actor);
        }
        
        return true;
    }
};

console.log("DX3rd | ComboHandler script loaded");
})();
