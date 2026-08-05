// Combo 아이템 핸들러
(function() {
window.DX3rdDebug.log("DX3rd | ComboHandler script loading...");

window.DX3rdComboHandler = {
    /**
     * 비용을 지불하기 전에 판정형 콤보가 실제로 판정에 진입할 수 있는지 확인한다.
     * 에너미의 고정 명중 달성치 공격은 stat 없이도 기존 단축 경로를 쓸 수 있다.
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
     * 스킬 키로부터 표시 이름 가져오기 (커스텀 스킬 및 로컬라이징 처리)
     */
    /** 스킬 표시 이름. 실제 로직은 DX3rdSkillManager 가 effect 와 공유한다. */
    getSkillDisplayName(skillKey, skillStat) {
        return window.DX3rdSkillManager.getSkillDisplayName(skillKey, skillStat);
    },

    /**
     * 콤보의 기능(skill) 설정으로부터 판정 stat/label 해석 (공용)
     * - 능력치(body/sense/mind/social), 신드롬, 텍스트, 크툴루 신화, 일반 스킬(+커스텀 base) 모두 처리
     * - Finding F: 무기 판정 경로(handleComboRollWithWeapon)와 일반 경로가 동일한 해석을 쓰도록 단일화
     * @returns {{stat:object, label:string}|null} 실패 시 경고 표시 후 null
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
            // 능력치
            stat = actor.system.attributes[skillKey];
            label = game.i18n.localize(`DX3rd.${skillKey.charAt(0).toUpperCase() + skillKey.slice(1)}`);
        } else if (skillKey === 'syndrome') {
            // 신드롬
            stat = actor.system.attributes.syndrome;
            label = stat?.name || game.i18n.localize('DX3rd.Syndrome');
            if (label && label.startsWith('DX3rd.')) label = game.i18n.localize(label);
        } else if (skillKey === 'text') {
            // 텍스트
            stat = actor.system.attributes.text;
            label = stat?.name || game.i18n.localize('DX3rd.Text');
            if (label && label.startsWith('DX3rd.')) label = game.i18n.localize(label);
        } else if (skillKey === 'cthulhu') {
            // 크툴루 신화
            stat = actor.system.attributes.skills?.cthulhu;
            label = stat?.name || game.i18n.localize('DX3rd.cthulhu');
            if (label && label.startsWith('DX3rd.')) label = game.i18n.localize(label);
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
                    window.DX3rdDebug.log(`DX3rd | ComboHandler - Using custom base: ${customBase} for skill: ${skillKey}`);
                    window.DX3rdDebug.log(`DX3rd | ComboHandler - Skill bonus: dice=${skillDiceBonus}, add=${skillAddBonus}`);
                } else {
                    // 폴백: 기본 base 사용
                    stat = baseStat;
                    label = game.i18n.localize(`DX3rd.${customBase.charAt(0).toUpperCase() + customBase.slice(1)}`);
                }
            } else {
                // 기본 스킬 사용
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
        
        // itemIdOrObject가 문자열이면 액터의 아이템에서 조회, 객체면 그대로 사용 (임시 콤보)
        let item;
        if (typeof itemIdOrObject === 'string') {
            // 액터의 아이템에서 먼저 찾고, 없으면 game.items에서 찾기
            item = actor.items.get(itemIdOrObject) || game.items.get(itemIdOrObject);
            if (!item) { 
                ui.notifications.warn(game.i18n.localize('DX3rd.ItemNotFound'));
                return false;
            }
        } else if (typeof itemIdOrObject === 'object') {
            // 임시 콤보 아이템 객체
            item = itemIdOrObject;
            window.DX3rdDebug.log("DX3rd | ComboHandler - Using temporary combo item", item);
        } else {
            ui.notifications.warn(game.i18n.localize('DX3rd.InvalidItemParameter'));
            return false;
        }
        const comboAction = window.DX3rdItemEffectAdapter?.invocationAction?.(item) || 'attack';
        if (!this.validateUse(actor, item)) return false;

        // 0. 임시 콤보(빌더에서 생성된 객체)는 handleItemUse를 거치지 않으므로 여기서 코스트를 정산한다.
        //    저장된 콤보(문자열 id)는 handleItemUse가 이미 processItemUsageCost를 호출했으므로 중복 정산하지 않는다.
        //    정산 내용: 침식치 합계(룰 807-809)·HP 코스트·사용 게이트·통합 사용 메시지.
        //    이펙트 사용횟수 증가는 processInstantExtensions가 담당하므로 코스트 정산과 이중으로 겹치지 않는다.
        if (typeof itemIdOrObject === 'object') {
            const usageAllowed = await window.DX3rdUniversalHandler.processItemUsageCost(actor, item, {action: comboAction});
            if (!usageAllowed) {
                window.DX3rdDebug.log("DX3rd | ComboHandler - Temp combo usage blocked by cost gate");
                return false;
            }
        }

        // 1. instant 익스텐션 병합·실행 (공통 - 롤 타입 무관)
        await this.processInstantExtensions(actor, item, comboAction);

        // 2. 콤보 롤 타입 분기
        const rollType = item.system?.roll ?? '-';
        
        if (rollType === '-') {
            // No-roll: instant만 처리했으므로 끝
            window.DX3rdDebug.log("DX3rd | ComboHandler - No-roll combo completed");
        } else {
            // Roll: 롤 다이얼로그 표시 (afterSuccess는 채팅 버튼에서 처리)
            const rollStarted = await this.handleComboRoll(actor, item, rollType, getTarget, options);
            if (rollStarted === false) return false;
        }

        // 호출 문맥(방어 다이얼로그 등)이 붙인 사용 직후 콜백. 판정형 콤보는 롤 다이얼로그를
        // 기다리지 않으므로, 여기서는 이미 반영된 instant 익스텐션·자기효과까지가 대상이다.
        // 판정 결과 자체는 meta.afterRollCallback 으로 따로 돌아간다.
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
     * 조합된 멤버 아이템의 기존 발동 액션. 콤보 포함은 이 값을 바꾸지 않으며,
     * 특히 「활성화」를 암시하지 않는다.
     */
    comboMemberAction(memberItem, fallback = 'attack') {
        return window.DX3rdItemEffectAdapter?.invocationAction?.(memberItem) || fallback;
    },

    /**
     * 콤보의 일반 구성 슬롯. 무기 슬롯은 공격 수치·attack-used 경로가 별도로 담당하며,
     * 여기에 합쳐 무기의 선택형 「사용」 효과까지 자동 발동시키지 않는다.
     */
    comboMemberEntries(actor, comboItem) {
        const handler = window.DX3rdUniversalHandler;
        return (handler?.normalizeEffectIds?.(comboItem) || [])
            .map(id => actor.items.get(id))
            .filter(Boolean)
            .map(item => ({item, role: 'member'}));
    },

    /**
     * 구성 멤버의 자기 보정 중 지금 액션·타이밍에 발현할 버킷이 있는가.
     * 활성화 버킷은 콤보로 자동 점등하지 않으며, 명시적인 사용 버킷만 별도로 허용한다.
     */
    memberSelfModifiersFireAt(effectItem, action, timing) {
        const adapter = window.DX3rdItemEffectAdapter;
        if (!adapter) {
            const active = effectItem.system?.active || {};
            return action === 'use' && active.runTiming === timing && active.disable !== 'notCheck';
        }
        const actionMatches = adapter.extensionActionMatches(
            effectItem, 'selfModifiers', effectItem.system?.active || {}, action, timing
        ) || adapter.hasExplicitBucket(effectItem, 'self', action);
        if (!actionMatches) return false;
        const lifecycle = adapter.bucketLifecycle(effectItem, 'self', action);
        if (lifecycle.disable === 'notCheck') return false;
        return lifecycle.runTiming === '-' || lifecycle.runTiming === timing;
    },

    /**
     * 주어진 소스 아이템들(콤보 본체 + 포함 이펙트)에서 익스텐션 정의를 수집한다.
     * 기존 3개 메서드(processInstant/collectAfterSuccess/collectAfterDamage)에 복붙되어 있던
     * pushExtensionsFrom 로직을 단일화한 것.
     * @param {Actor} actor
     * @param {Array} srcItems - 익스텐션 플래그를 가진 아이템 배열 (앞에서부터 순서대로 수집)
     * @param {Object} [opts]
     * @param {boolean} [opts.includeItemCreation=true] - weapon/protect/vehicle 생성 익스텐션 포함 여부 (afterDamage는 instant 전용이라 false)
     * @param {string|null} [opts.comboItemId=null] - 콤보 본체의 id. 지정 시 액션 게이트는
     *   본체에만 적용하고, 구성 멤버 익스텐션은 이전 동작대로 모두 수집한다.
     * @returns {Array} 수집된 익스텐션 정의 배열
     */
    collectExtensions(actor, srcItems, { includeItemCreation = true, action = 'attack', comboItemId = null } = {}) {
        const collected = [];
        const gatedByAction = srcItem => !comboItemId || srcItem.id === comboItemId;
        for (const srcItem of srcItems) {
            if (!srcItem) continue;
            const gated = gatedByAction(srcItem);
            const ext = srcItem.getFlag('dx3rd-emanim', 'itemExtend') || {};
            // 부모 아이템의 runTiming 저장 (익스텐션의 등록 타이밍 결정에 사용)
            const parentRunTiming = srcItem.system?.active?.runTiming || 'instant';
            const baseData = {
                itemId: srcItem.id,
                itemName: srcItem.name,
                actorId: actor.id,
                parentRunTiming
            };

            const pushIf = (typeKey, d) => {
                if (!d || !d.activate) return;
                // 구성 멤버 익스텐션은 기존처럼 use/attack 양쪽을 모두 보존한다.
                // 단, 콤보 포함만으로 activation 동작이 일어나서는 안 된다.
                if (!gated && window.DX3rdItemEffectAdapter
                    && window.DX3rdItemEffectAdapter.inferAction(srcItem, typeKey, d) === 'activation') return;
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
                    // 아이템 생성 익스텐션은 instant만 지원 (afterDamage 수집에서는 제외)
                    if (!includeItemCreation) return;
                    if (gated && window.DX3rdItemEffectAdapter
                        && !window.DX3rdItemEffectAdapter.extensionActionMatches(srcItem, typeKey, d, action, 'instant')) return;
                    collected.push({
                        type: typeKey, ...baseData,
                        timing: 'instant',
                        extensionData: d // 전체 데이터 보존
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
     * instant 익스텐션 병합 및 실행 (롤 타입 무관 공통 처리)
     * 콤보 + 포함된 이펙트들의 instant 익스텐션을 수집·병합·실행
     */
    async processInstantExtensions(actor, item, action = null) {
        window.DX3rdDebug.log("DX3rd | ComboHandler - Processing instant extensions (common for all roll types)");
        const handler = window.DX3rdUniversalHandler;
        if (!handler) return;
        action ||= window.DX3rdItemEffectAdapter?.invocationAction?.(item) || 'attack';

        // 콤보 본체의 instant 매크로/어플라이드는 이미 handleItemUse에서 실행됨 → 중복 방지
        window.DX3rdDebug.log('DX3rd | ComboHandler - Skipping combo item instant macro/apply (already done in handleItemUse)');

        // 2) 구성 아이템의 즉시 처리 + 익스텐드 수집
        const memberEntries = this.comboMemberEntries(actor, item);
        window.DX3rdDebug.log('DX3rd | ComboHandler - Members normalized', {
            members: memberEntries.map(entry => ({ id: entry.item.id, type: entry.item.type, role: entry.role }))
        });

        // 현재 선택된 타겟을 저장(instant 병합 실행 시 공유)
        const selectedTargetIds = Array.from(game.user.targets || []).map(t => t.id);

        // 콤보 본체 즉시 활성화/매크로/어플라이드는 handleItemUse에서 처리됨 → 익스텐드는 아래에서 일괄 수집
        window.DX3rdDebug.log('DX3rd | ComboHandler - Collecting extensions from combo item:', item.name);

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
                        window.DX3rdDebug.log('DX3rd | ComboHandler - Weapon attack count increased:', weaponItem.name, currentAttackUsedState, '→', currentAttackUsedState + 1);
                    }
                }
            }
        } else if (skipPreIncrement) {
            window.DX3rdDebug.log('DX3rd | ComboHandler - Skipping weapon attack-used pre-increment (attack combo; counted at damage roll)');
        }

        // 일반 구성 아이템의 사용 횟수 증가 (notCheck가 아닌 경우) — 무기 슬롯은 별도의
        // attack-used 경로가 담당한다. 멤버 수만큼 개별 update 를 하면
        // 그 수만큼 DB 왕복 + 액터 재파생 + 시트 재렌더가 연쇄돼 콤보 발동이 눈에 띄게 느려진다.
        // 콤보는 하나의 사용 행위이므로 카운터는 한 번에 올린다(멤버 처리 전에 전원 반영).
        const usedUpdates = memberEntries
            .filter(entry => entry.role !== 'weapon' && !['weapon', 'vehicle'].includes(entry.item.type))
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

            // 구성 아이템 즉시 처리
            try {
                const memberAction = this.comboMemberAction(memberItem, action);
                if (this.memberSelfModifiersFireAt(memberItem, memberAction, 'instant')) {
                    const toggled = await handler.applySelfModifiers(actor, memberItem, { action: memberAction });
                    window.DX3rdDebug.log(`DX3rd | ComboHandler - Member self modifiers applied (${toggled ? 'toggle' : 'frozen'}):`, memberItem.name);
                }
                await handler.executeMacros(memberItem, 'instant', memberAction);
                await handler.applyToTargets(actor, memberItem, 'instant', null, memberAction);
            } catch (e) {
                console.warn('DX3rd | ComboHandler - member instant process skipped:', memberItem?.name, e);
            }

            processedMemberItems.push(memberItem);
        }
        // updateItem 훅의 AE 동기화는 비동기다. 현재 액션 버킷이 토글 채널인 구성 멤버의
        // 보정이 공격 판정 전에 actor 파생값에 반영되도록 진행 중인 동기화까지 완료를 대기한다.
        await window.DX3rdAppliedToggle?.sync?.(actor);

        // 익스텐드 일괄 수집 (콤보 본체 + 전체 구성 아이템)
        const collectedExtensions = this.collectExtensions(actor, [item, ...processedMemberItems], {
            includeItemCreation: true, action, comboItemId: item.id
        });

        window.DX3rdDebug.log('DX3rd | ComboHandler - Total collected extensions before merge:', collectedExtensions.length);
        window.DX3rdDebug.log('DX3rd | ComboHandler - Collected extensions:', collectedExtensions);

        // 3) 익스텐드 병합 (같은 타이밍 + 같은 대상, custom 분리)
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

            // instant 및 afterMain 버킷 처리
            for (const b of merged) {
                window.DX3rdDebug.log('DX3rd | ComboHandler - Processing bucket:', b.type, 'timing:', b.timing, 'target:', b.target, 'parentRunTiming:', b.parentRunTiming);
                
                // instant는 즉시 실행, afterMain은 큐에 등록, 나머지는 건너뜀
                if (b.timing === 'instant') {
                    // instant 타이밍 즉시 실행
                    window.DX3rdDebug.log('DX3rd | ComboHandler - Executing instant extension:', b.type);
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
                    // 아이템 생성은 병합하지 않고 각 소스별로 개별 생성
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
                    } else if (b.custom) {
                        // 버킷 단위 custom(임의 공식)은 기존 단일 다이얼로그 흐름으로 처리하도록 개별 소스 실행을 유지
                        // → 별도 병합 다이얼로그 구현 전까지는 스킵 (중복 창 방지 목적)
                        window.DX3rdDebug.log('DX3rd | ComboHandler - Skipping custom bucket for now (kept for existing dialog):', b);
                    }
                } else if (b.timing === 'afterMain' && b.parentRunTiming === 'instant') {
                    // afterMain 타이밍은 큐에 등록
                    // 단, parentRunTiming이 instant인 경우만 여기서 등록 (afterSuccess/afterDamage는 해당 타이밍에서 등록)
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
                        const damageData = {
                            formulaDice: b.merged?.dice || 0,
                            formulaAdd: b.merged?.add || 0,
                            target: b.target,
                            selectedTargetIds,
                            ignoreReduce: b.ignoreReduce || false,
                            triggerItemName: item.name
                        };
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
                    // instant, afterMain이 아닌 타이밍은 건너뜀 (afterSuccess, afterDamage는 별도 처리)
                    window.DX3rdDebug.log('DX3rd | ComboHandler - Skipping bucket (not instant/afterMain):', b.type, 'timing:', b.timing);
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
        window.DX3rdDebug.log("DX3rd | ComboHandler - Collecting afterSuccess data for combo:", item.name);
        const handler = window.DX3rdUniversalHandler;
        if (!handler) return null;
        const action = window.DX3rdItemEffectAdapter?.invocationAction?.(item) || 'attack';

        const result = {
            activations: [], // { itemId, itemName }
            macros: [],      // { itemId, itemName, macroName, timing }
            applies: [],     // { itemId, itemName }
            extensions: [],  // merged buckets (afterSuccess)
            afterMainExtensions: [] // merged buckets (afterMain, runTiming이 afterSuccess인 경우)
        };

        const memberEntries = this.comboMemberEntries(actor, item);
        const selectedTargetIds = Array.from(game.user.targets || []).map(t => t.id);

        // 콤보 본체 수집
        window.DX3rdDebug.log('DX3rd | ComboHandler - Checking combo body for afterSuccess:', {
            activeRunTiming: item.system?.active?.runTiming,
            activeState: item.system?.active?.state,
            effectRunTiming: item.system?.effect?.runTiming,
            getTarget: item.system?.getTarget
        });
        
        // 1) 활성화 (disable이 'notCheck'가 아닌 경우에만)
        const activeDisable = item.system?.active?.disable ?? '-';
        const comboSelfMatches = !window.DX3rdItemEffectAdapter
            || window.DX3rdItemEffectAdapter.extensionActionMatches(item, 'selfModifiers', item.system?.active || {}, action, 'afterSuccess')
            || window.DX3rdItemEffectAdapter.hasExplicitBucket(item, 'self', action);
        if (comboSelfMatches && item.system?.active?.runTiming === 'afterSuccess' && !item.system?.active?.state && activeDisable !== 'notCheck') {
            result.activations.push({ itemId: item.id, itemName: item.name, action });
            window.DX3rdDebug.log('DX3rd | ComboHandler - Added combo activation:', item.name);
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
                    const macroActionMatches = !window.DX3rdItemEffectAdapter
                        || window.DX3rdItemEffectAdapter.macroActionMatches(item, {}, action, 'afterSuccess');
                    if (macroTiming === 'afterSuccess' && macroActionMatches) {
                        result.macros.push({ itemId: item.id, itemName: item.name, macroName: macroName, timing: macroTiming, action });
                        window.DX3rdDebug.log('DX3rd | ComboHandler - Added combo macro:', macroName);
                    }
                }
            }
        }
        // 3) 어플라이드 (콤보는 어플라이드가 있는지 확인 필요)
        const comboTargetFires = window.DX3rdItemEffectAdapter
            ? window.DX3rdItemEffectAdapter.targetFiresAt(item, action, 'afterSuccess')
            : item.system?.effect?.runTiming === 'afterSuccess';
        if ((item.system?.getTarget || item.system?.scene) && comboTargetFires) {
            result.applies.push({ itemId: item.id, itemName: item.name, action });
            window.DX3rdDebug.log('DX3rd | ComboHandler - Added combo apply:', item.name);
        }
        // 4) 익스텐션은 아래에서 일괄 수집

        // 전체 구성 아이템 수집
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
            // 1) 자기 지속 보정. 기존 발동 액션만 예약하며 활성화 버킷은 켜지 않는다.
            if (this.memberSelfModifiersFireAt(memberItem, memberAction, 'afterSuccess')) {
                result.activations.push({ itemId: memberItem.id, itemName: memberItem.name, action: memberAction });
                window.DX3rdDebug.log('DX3rd | ComboHandler - Added member modifiers:', memberItem.name, memberAction);
            }
            // 2) 매크로 (문자열 파싱)
            const effectMacroString = memberItem.system?.macro || '';
            if (effectMacroString) {
                const macroMatches = effectMacroString.match(/\[([^\]]+)\]/g) || [];
                for (const match of macroMatches) {
                    const macroName = match.slice(1, -1);
                    const macro = game.macros?.getName(macroName);
                    if (macro) {
                        const macroTiming = macro.getFlag('dx3rd-emanim', 'runTiming') || 'instant';
                        const macroActionMatches = !window.DX3rdItemEffectAdapter
                            || window.DX3rdItemEffectAdapter.macroActionMatches(memberItem, {}, memberAction, 'afterSuccess');
                        if (macroTiming === 'afterSuccess' && macroActionMatches) {
                            result.macros.push({ itemId: memberItem.id, itemName: memberItem.name, macroName: macroName, timing: macroTiming, action: memberAction });
                            window.DX3rdDebug.log('DX3rd | ComboHandler - Added member macro:', macroName, 'from:', memberItem.name);
                        }
                    }
                }
            }
            // 3) 어플라이드
            const memberTargetFires = window.DX3rdItemEffectAdapter
                ? window.DX3rdItemEffectAdapter.targetFiresAt(memberItem, memberAction, 'afterSuccess')
                : memberItem.system?.effect?.runTiming === 'afterSuccess';
            if ((memberItem.system?.getTarget || memberItem.system?.scene) && memberTargetFires) {
                result.applies.push({ itemId: memberItem.id, itemName: memberItem.name, action: memberAction });
                window.DX3rdDebug.log('DX3rd | ComboHandler - Added member apply:', memberItem.name);
            }
            // 4) 익스텐션은 아래에서 일괄 수집
        }

        // 익스텐드 일괄 수집 (콤보 본체 + 전체 구성 아이템)
        const collectedExtensions = this.collectExtensions(actor, [item, ...memberItems], {
            includeItemCreation: true, action, comboItemId: item.id
        });

        // 익스텐션 병합 (afterSuccess + afterMain)
        window.DX3rdDebug.log('DX3rd | ComboHandler - Collected extensions count:', collectedExtensions.length);
        
        // afterSuccess 타이밍 익스텐션 병합
        const afterSuccessExtensions = collectedExtensions.filter(e => e.timing === 'afterSuccess');
        window.DX3rdDebug.log('DX3rd | ComboHandler - AfterSuccess extensions count:', afterSuccessExtensions.length);
        if (afterSuccessExtensions.length > 0) {
            const buckets = handler.groupExtensionsByKey(afterSuccessExtensions);
            const merged = handler.mergeGroupedExtensionBuckets(actor, buckets);
            window.DX3rdDebug.log('DX3rd | ComboHandler - Merged afterSuccess buckets:', merged.length);
            result.extensions = merged.map(b => ({
                ...b,
                selectedTargetIds // 현재 타겟 저장
            }));
        }
        
        // afterMain 타이밍 익스텐션 병합 (parentRunTiming이 afterSuccess인 것만)
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
                selectedTargetIds // 현재 타겟 저장
            }));
        }

        window.DX3rdDebug.log('DX3rd | ComboHandler - Collected afterSuccess data:', result);
        return result;
    },
    
    /**
     * afterDamage 익스텐션 수집 및 병합 (롤 있는 콤보용)
     * afterSuccess와 동일한 구조이지만 afterDamage 타이밍만 필터
     * @returns {Object} { activations: [], macros: [], applies: [], extensions: [merged buckets] }
     */
    async collectAfterDamageData(actor, item) {
        window.DX3rdDebug.log("DX3rd | ComboHandler - Collecting afterDamage data for combo:", item.name);
        const handler = window.DX3rdUniversalHandler;
        if (!handler) return null;

        const result = {
            activations: [], // { itemId, itemName }
            macros: [],      // { itemId, itemName, macroName, timing }
            applies: [],     // { itemId, itemName }
            extensions: [],  // merged buckets (afterDamage)
            afterMainExtensions: [] // merged buckets (afterMain, runTiming이 afterDamage인 경우)
        };

        const memberEntries = this.comboMemberEntries(actor, item);
        const selectedTargetIds = Array.from(game.user.targets || []).map(t => t.id);

        // 콤보 본체 수집
        // 1) 활성화 (disable이 'notCheck'가 아닌 경우에만)
        const activeDisable = item.system?.active?.disable ?? '-';
        const comboSelfMatchesDamage = !window.DX3rdItemEffectAdapter
            || window.DX3rdItemEffectAdapter.extensionActionMatches(item, 'selfModifiers', item.system?.active || {}, 'attack', 'afterDamage')
            || window.DX3rdItemEffectAdapter.hasExplicitBucket(item, 'self', 'attack');
        if (comboSelfMatchesDamage && item.system?.active?.runTiming === 'afterDamage' && !item.system?.active?.state && activeDisable !== 'notCheck') {
            result.activations.push({ itemId: item.id, itemName: item.name, action: 'attack' });
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
                    const macroActionMatches = !window.DX3rdItemEffectAdapter
                        || window.DX3rdItemEffectAdapter.macroActionMatches(item, {}, 'attack', 'afterDamage');
                    if (macroTiming === 'afterDamage' && macroActionMatches) {
                        result.macros.push({ itemId: item.id, itemName: item.name, macroName: macroName, timing: macroTiming, action: 'attack' });
                        window.DX3rdDebug.log('DX3rd | ComboHandler - Added combo macro (afterDamage):', macroName);
                    }
                }
            }
        }
        // 3) 어플라이드
        const comboTargetFires = window.DX3rdItemEffectAdapter
            ? window.DX3rdItemEffectAdapter.targetFiresAt(item, 'attack', 'afterDamage')
            : item.system?.effect?.runTiming === 'afterDamage';
        if ((item.system?.getTarget || item.system?.scene) && comboTargetFires) {
            result.applies.push({ itemId: item.id, itemName: item.name, action: 'attack' });
        }
        // 4) 익스텐션은 아래에서 일괄 수집

        // 전체 구성 아이템 수집
        const memberItems = [];
        for (const { item: memberItem, role } of memberEntries) {
            memberItems.push(memberItem);

            const memberAction = this.comboMemberAction(memberItem, 'attack');
            // 1) 자기 지속 보정
            if (this.memberSelfModifiersFireAt(memberItem, memberAction, 'afterDamage')) {
                result.activations.push({ itemId: memberItem.id, itemName: memberItem.name, action: memberAction });
            }
            // 2) 매크로 (문자열 파싱)
            const effectMacroStringDamage = memberItem.system?.macro || '';
            if (effectMacroStringDamage) {
                const macroMatches = effectMacroStringDamage.match(/\[([^\]]+)\]/g) || [];
                for (const match of macroMatches) {
                    const macroName = match.slice(1, -1);
                    const macro = game.macros?.getName(macroName);
                    if (macro) {
                        const macroTiming = macro.getFlag('dx3rd-emanim', 'runTiming') || 'instant';
                        const macroActionMatches = !window.DX3rdItemEffectAdapter
                            || window.DX3rdItemEffectAdapter.macroActionMatches(memberItem, {}, memberAction, 'afterDamage');
                        if (macroTiming === 'afterDamage' && macroActionMatches) {
                            result.macros.push({ itemId: memberItem.id, itemName: memberItem.name, macroName: macroName, timing: macroTiming, action: memberAction });
                            window.DX3rdDebug.log('DX3rd | ComboHandler - Added member macro (afterDamage):', macroName, 'from:', memberItem.name);
                        }
                    }
                }
            }
            // 3) 어플라이드
            const memberTargetFires = window.DX3rdItemEffectAdapter
                ? window.DX3rdItemEffectAdapter.targetFiresAt(memberItem, memberAction, 'afterDamage')
                : memberItem.system?.effect?.runTiming === 'afterDamage';
            if ((memberItem.system?.getTarget || memberItem.system?.scene) && memberTargetFires) {
                result.applies.push({ itemId: memberItem.id, itemName: memberItem.name, action: memberAction });
            }
            // 4) 익스텐션은 아래에서 일괄 수집
        }

        // 익스텐드 일괄 수집 (콤보 본체 + 전체 구성 아이템). afterDamage는 아이템 생성 제외
        const collectedExtensions = this.collectExtensions(actor, [item, ...memberItems], {
            includeItemCreation: false, action: 'attack', comboItemId: item.id
        });

        // 익스텐션 병합 (afterDamage + afterMain)
        window.DX3rdDebug.log('DX3rd | ComboHandler - Collected extensions count:', collectedExtensions.length);
        
        // afterDamage 타이밍 익스텐션 병합
        const afterDamageExtensions = collectedExtensions.filter(e => e.timing === 'afterDamage');
        window.DX3rdDebug.log('DX3rd | ComboHandler - AfterDamage extensions count:', afterDamageExtensions.length);
        if (afterDamageExtensions.length > 0) {
            const buckets = handler.groupExtensionsByKey(afterDamageExtensions);
            const merged = handler.mergeGroupedExtensionBuckets(actor, buckets);
            window.DX3rdDebug.log('DX3rd | ComboHandler - Merged afterDamage buckets:', merged.length);
            result.extensions = merged.map(b => ({
                ...b,
                selectedTargetIds // 현재 타겟 저장
            }));
        }
        
        // afterMain 타이밍 익스텐션 병합 (parentRunTiming이 afterDamage인 것만)
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
                selectedTargetIds // 현재 타겟 저장
            }));
        }

        window.DX3rdDebug.log('DX3rd | ComboHandler - Collected afterDamage data:', result);
        return result;
    },
    
    /**
     * 판정 콤보 처리 (system.roll !== '-')
     * 침식률/활성화는 이미 handleItemUse에서 처리됨
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
        
        // 에너미이고 명중 달성치가 입력되어 있으면 롤 없이 바로 데미지 롤 버튼 생성 (다이스/수정치 보정 반영)
        if (actor.type === 'enemy' && item.system?.attackAchievement && 
            item.system.attackAchievement !== '-' && item.system.attackAchievement !== '' &&
            item.system?.attackRoll && item.system.attackRoll !== '-') {
            const baseAchievement = Number(item.system.attackAchievement);
            if (!isNaN(baseAchievement) && baseAchievement > 0) {
                const registeredWeaponBonus = this.calculateRegisteredWeaponBonus(actor, item);
                const shortcutAttackBonus = adapter?.mergeAttackBonuses?.(effectAttackBonus, registeredWeaponBonus)
                    || effectAttackBonus || registeredWeaponBonus;
                const achievementValue = await this.getAchievementWithModifiers(actor, item, baseAchievement, shortcutAttackBonus);
                await this.createAttackMessageWithAchievement(actor, item, achievementValue, shortcutAttackBonus);
                return true;
            }
        }
        
        // 무기 선택이 활성화된 경우, 무기 선택 다이얼로그 표시
        if (item.system?.weaponSelect && item.system?.attackRoll && item.system.attackRoll !== '-') {
            await this.showWeaponSelectionForAttack(actor, item, rollType, options, effectAttackBonus);
            return true;
        }
        
        // 무기 선택이 비활성화되어 있지만 공격 판정인 경우, 등록된 무기 보너스 적용
        if (!item.system?.weaponSelect && item.system?.attackRoll && item.system.attackRoll !== '-') {
            window.DX3rdDebug.log('DX3rd | ComboHandler - Attack roll without weapon selection, using registered weapons');
            const registeredWeaponBonus = this.calculateRegisteredWeaponBonus(actor, item);
            
            // 등록된 무기 중 사용 가능한 무기가 하나라도 있으면 보너스 적용
            const hasAvailableWeapons = registeredWeaponBonus.weaponIds.length > 0;
            
            if (hasAvailableWeapons) {
                // 조합된 이펙트의 자체 수치와 무기를 함께 적용한다.
                const weaponBonus = adapter?.mergeAttackBonuses?.(effectAttackBonus, registeredWeaponBonus)
                    || registeredWeaponBonus;
                return this.handleComboRollWithWeapon(actor, item, rollType, weaponBonus, options);
            }
            // weaponSelect가 false이면 무기 선택 다이얼로그를 열지 않고 일반 판정으로 진행
        }

        if (effectAttackBonus) {
            return this.handleComboRollWithWeapon(actor, item, rollType, effectAttackBonus, options);
        }
        
        // 북 해독 콤보 / 방어 다이얼로그 임시 콤보 등에서 전달된 메타데이터 복원
        const predefinedDifficulty = item.meta?.predefinedDifficulty || null;
        const originalItem = item.meta?.originalItem || null;
        const metaAfterRoll = item.meta?.afterRollCallback || null;
        const rollItemForDialog = originalItem || item;

        // 아이템의 스킬로 stat 데이터 가져오기 (Finding F: 공용 해석기 사용)
        const resolved = this.resolveComboStat(actor, item);
        if (!resolved) return false;
        const { stat, label } = resolved;

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
            options.predefinedDifficulty || predefinedDifficulty,
            false,
            false,
            options.afterRollCallback || metaAfterRoll
        );
        return true;
    },

    /**
     * 공격용 무기 선택 다이얼로그 표시
     */
    async showWeaponSelectionForAttack(actor, item, rollType, options = {}, effectAttackBonus = null) {
        const attackRollType = item.system.attackRoll;
        
        // 액터의 모든 무기 + 비클 가져오기 (종별 필터링 제거)
        const allWeapons = actor.items.filter(w => w.type === 'weapon' || w.type === 'vehicle');
        // 가상(월드) 무기 항상 노출 - 대응 무기가 없어도 백병/사격 공격 채널 제공
        const virtualWeapons = window.DX3rdVirtualWeapons?.list?.() || [];
        const weapons = [...virtualWeapons, ...allWeapons];

        // 무기 선택 다이얼로그 표시
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

    /** 콤보에 포함된 이펙트의 자체 수정치/공격력을 합산한다. */
    calculateEffectAttackBonus(actor, item) {
        const adapter = window.DX3rdItemEffectAdapter;
        if (!adapter) return null;
        const effectIds = item.system?.effectIds || (Array.isArray(item.system?.effect) ? item.system.effect : []);
        const bonuses = effectIds
            .map(id => actor.items.get(id))
            .filter(Boolean)
            .map(effect => adapter.effectAttackBonus?.(effect, actor, {includeComboModifiers: true}))
            .filter(Boolean);
        return adapter.mergeAttackBonuses?.(bonuses) || null;
    },
    
    /**
     * 무기 탭에 등록된 무기들의 보너스 계산 (공격 횟수가 남은 무기만)
     */
    calculateRegisteredWeaponBonus(actor, item) {
        const weaponBonus = { attack: 0, add: 0, attackFormula: '', addFormula: '', weaponName: '', weaponIds: [] };
        
        // 무기 탭에 등록된 무기들 가져오기
        const registeredWeapons = item.system?.weapon || [];
        const comboEffects = (item.system?.effectIds || []).map(id => actor.items.get(id)).filter(Boolean);
        const multiWeapon = comboEffects.map(effect => effect.system?.multiWeapon).find(rule => rule?.enabled);
        const selectedWeapons = registeredWeapons.filter(id => id && id !== '-');
        if (selectedWeapons.length > 1 && !multiWeapon) {
            ui.notifications.warn('복수 무기 합산 이펙트 없이 여러 무기를 사용합니다. 모든 무기를 합산합니다.');
        }
        
        window.DX3rdDebug.log('DX3rd | ComboHandler - Registered weapons:', registeredWeapons);
        
        // 각 등록된 무기의 보너스 합산 (공격 횟수가 남은 무기만)
        for (const weaponId of selectedWeapons) {
            if (weaponId && weaponId !== '-') {
                // 액터의 아이템 또는 가상 무기에서 무기 데이터 가져오기
                const weaponItem = window.DX3rdResolveWeapon(actor, weaponId);
                if (weaponItem && weaponItem.type === 'weapon') {
                    if (multiWeapon?.weaponType && multiWeapon.weaponType !== '-' && weaponItem.system?.type !== multiWeapon.weaponType) {
                        ui.notifications.warn(`복수 무기 조건: ${weaponItem.name}은(는) 요구 종별(${multiWeapon.weaponType})과 다릅니다. 합산은 유지합니다.`);
                    }
                    if (multiWeapon?.requireSameSkill && weaponBonus.weaponIds.length) {
                        const first = window.DX3rdResolveWeapon(actor, weaponBonus.weaponIds[0]);
                        if (first?.system?.skill !== weaponItem.system?.skill) {
                            ui.notifications.warn(`복수 무기 조건: ${weaponItem.name}은(는) 첫 무기와 기능이 다릅니다. 합산은 유지합니다.`);
                        }
                    }
                    // 공격 횟수 체크 (weapon만, vehicle은 attack-used 없음)
                    const attackUsedDisable = weaponItem.system['attack-used']?.disable || 'notCheck';
                    const attackUsedState = weaponItem.system['attack-used']?.state || 0;
                    const attackUsedMax = weaponItem.system['attack-used']?.max || 0;
                    const isAttackExhausted = attackUsedDisable !== 'notCheck' && (attackUsedMax <= 0 || attackUsedState >= attackUsedMax);
                    
                    // 공격 횟수가 소진된 무기는 제외 — 차단 여부는 월드 설정이 정한다.
                    if (isAttackExhausted && window.DX3rdItemExhausted?.allowExhaustedUse?.() === false) {
                        window.DX3rdDebug.log(`DX3rd | ComboHandler - Weapon ${weaponItem.name} attack exhausted, skipping (${attackUsedState}/${attackUsedMax})`);
                        continue;
                    }
                    
                    // 고정 보정은 즉시 합산하고, 다이스식은 공격/데미지 확정 시점까지 보존한다.
                    const formula = window.DX3rdFormulaEvaluator;
                    const addFormulaTerm = (target, raw) => {
                        const prepared = formula.prepareRollFormula(String(raw ?? '0'), weaponItem, actor);
                        if (formula.hasDice(prepared)) weaponBonus[target] = [weaponBonus[target], prepared].filter(Boolean).join(' + ');
                        else weaponBonus[target === 'attackFormula' ? 'attack' : 'add'] += Number(formula.evaluate(raw, weaponItem, actor)) || 0;
                    };
                    addFormulaTerm('attackFormula', weaponItem.system?.attack);
                    addFormulaTerm('addFormula', weaponItem.system?.add);
                    
                    // 무기 이름 추가 (루비 텍스트 제거)
                    const cleanWeaponName = weaponItem.name.split('||')[0].trim();
                    if (!weaponBonus.weaponName) {
                        weaponBonus.weaponName = cleanWeaponName;
                    } else {
                        weaponBonus.weaponName += `, ${cleanWeaponName}`;
                    }
                    
                    // 무기 ID 추가
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
     * 무기 보너스를 적용한 판정 처리
     */
    async handleComboRollWithWeapon(actor, item, rollType, weaponBonus, options = {}) {
        const handler = window.DX3rdUniversalHandler;
        
        // 북 해독 콤보 / 방어 다이얼로그 임시 콤보 등에서 전달된 메타데이터 복원
        const predefinedDifficulty = item.meta?.predefinedDifficulty || null;
        const originalItem = item.meta?.originalItem || null;
        const metaAfterRoll = item.meta?.afterRollCallback || null;
        const rollItemForDialog = originalItem || item;

        // 아이템의 스킬로 stat 데이터 가져오기 (Finding F: 공용 해석기 사용 — syndrome/text/cthulhu 분기 포함)
        const resolved = this.resolveComboStat(actor, item);
        if (!resolved) return false;
        const { stat, label } = resolved;

        // afterSuccess와 afterDamage 데이터 수집
        const afterSuccessData = await this.collectAfterSuccessData(actor, item);
        const afterDamageData = await this.collectAfterDamageData(actor, item);

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
            options.afterRollCallback || metaAfterRoll
        );
        return true;
    },

    /**
     * 에너미 명중 달성치에 다이스/수정치 보정 반영 (다이스 1개당 +2, 수정치는 그대로 가산)
     * 전체·메이저·해당 판정 능력치/기능의 다이스·수정치 보정을 합산하여 반영
     * @param {Actor} actor - 에너미 액터
     * @param {Item} item - 콤보 아이템
     * @param {number} baseAchievement - 시트의 명중 달성치
     * @returns {number} 보정 반영된 달성치
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
        const adjusted = itemAdjustedAchievement + (diceModifier * 2) + addModifier;
        return Math.max(1, Math.floor(adjusted));
    },
    
    /**
     * 에너미의 명중 달성치를 사용하여 공격 메시지 및 데미지 롤 버튼 생성 (롤 없이)
     * @param {Actor} actor - 액터
     * @param {Item} item - 콤보 아이템
     * @param {number} achievementValue - 명중 달성치
     */
    async createAttackMessageWithAchievement(actor, item, achievementValue, attackBonus = null) {
        const handler = window.DX3rdUniversalHandler;
        if (!handler) {
            console.error("DX3rd | UniversalHandler not found");
            return;
        }
        
        // 판정을 이미 한 것이므로, 일반 공격과 동일하게 afterSuccess/afterDamage 데이터 수집 (데미지 롤 버튼 클릭 시 메인 프로세스 이후 처리용)
        const afterSuccessData = await this.collectAfterSuccessData(actor, item);
        const afterDamageData = await this.collectAfterDamageData(actor, item);
        
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
        
        // 참조값만 명중 시점으로 고정하고, 공격력 다이스식은 데미지 굴림 확정까지 보류한다.
        //
        // 여기서 `system.attack.value` 를 쓰면 안 된다. 그 값은 시트 표시용 **총합**이라
        // (combo-data.calculateSubmittedAttack: 액터 공격력 + 무기 + 이펙트) 액터 공격력을
        // 이미 품고 있는데, 데미지 기본치는 아래 preservedValues.actorAttack 을 따로 더한다
        // → 액터 공격력이 두 번 세어졌다. 게다가 시트의 그 칸은 disabled 표시 전용이라
        // 손으로 넣은 값이 실릴 일도 없다. PC 경로(executeStatRoll)와 같은 성분 —
        // 무기·이펙트 보너스만 — 을 실어 두 경로의 전제를 하나로 맞춘다.
        const preservedItemAttackFormula = handler.joinFormulaTerms(
            attackBonus?.attack, attackBonus?.attackFormula);

        // 공격 타입/액터 보너스 산출 (명중·데미지 시점과 동일 경로)
        // 관통 다이스식은 이 판정 시점에 굴려 숫자로 굳힌다.
        const bonuses = await handler.resolveAttackBonusesRolled(actor, item);

        const preservedValues = {
            actorAttack: bonuses.actorAttack,
            actorAttackFormula: bonuses.actorAttackFormula,
            actorDamageRoll: bonuses.actorDamageRoll,
            actorDamageRollFormula: bonuses.actorDamageRollFormula,
            actorPenetrate: bonuses.actorPenetrate,
            weaponAttackFormula: preservedItemAttackFormula
        };

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
        
        // 데미지 롤 버튼 생성
        let damageRollButtonContent = `<button class="damage-roll-btn" 
                    data-actor-id="${actor.id}" 
                    data-item-id="${item.id}"
                    data-roll-result="${achievementValue}"
                    data-preserved-actor-attack="${preservedValues.actorAttack}"
                    data-preserved-actor-attack-formula="${encodeURIComponent(preservedValues.actorAttackFormula || '')}"
                    data-preserved-actor-damage-roll="${preservedValues.actorDamageRoll}"
                    data-preserved-actor-damage-roll-formula="${encodeURIComponent(preservedValues.actorDamageRollFormula || '')}"
                    data-preserved-actor-penetrate="${preservedValues.actorPenetrate}"`;
        
        // 아이템 타입별 공격력 데이터 속성 추가
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
        
        // 공격 메시지, 대상 정보, 롤 결과, 데미지 롤 버튼을 하나의 메시지로 묶기
        const attackMessageContent = window.DX3rdUniversalHandler.renderAttackChatCard({
            actor,
            item,
            flavorText: `<p>${flavorText.replace(/\n/g, '<br>')}</p>`,
            actionContent: `${window.DX3rdUniversalHandler.renderAttackRollButton(actor, item, {repeatable: true})}${damageRollButtonContent}`
        });
        
        // 콤보 afterSuccess/afterDamage 플래그 저장 (데미지 롤 버튼 클릭 시 processComboAfterSuccess 등 메인 프로세스 이후 처리 실행용)
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
        
        const attackMessage = await ChatMessage.create(messageData);
        await window.DX3rdUniversalHandler.maybeAutoRollDamage?.(attackMessage);
        
        // 메이저 롤 후 비활성화 훅 실행 (자기 자신에게만)
        if (window.DX3rdDisableHooks) {
            await window.DX3rdDisableHooks.executeDisableHook('roll', actor);
            await window.DX3rdDisableHooks.executeDisableHook('major', actor);
        }
        
        return true;
    }
};

window.DX3rdDebug.log("DX3rd | ComboHandler script loaded");
})();
