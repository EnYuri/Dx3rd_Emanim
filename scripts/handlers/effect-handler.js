// Effect 아이템 핸들러
(function() {
window.DX3rdEffectHandler = {
    /**
     * 스킬 키로부터 표시 이름 가져오기 (커스텀 스킬 및 로컬라이징 처리)
     * ComboHandler.getSkillDisplayName과 동일한 로직 — 카테고리/커스텀 스킬 라벨 일관성 유지
     */
    getSkillDisplayName(skillKey, skillStat) {
        if (!skillKey) return '';
        let label = skillStat?.name || '';
        if (label && label.startsWith('DX3rd.')) {
            const customSkills = game.settings.get("dx3rd-emanim", "customSkills") || {};
            const customSkill = customSkills[skillKey];
            if (customSkill) {
                return typeof customSkill === 'object' ? customSkill.name : customSkill;
            }
            return game.i18n.localize(label);
        }
        return label || skillKey;
    },

    /**
     * 이펙트의 system.skill로부터 판정용 stat과 라벨을 해석한다.
     * 능력치(body/sense/mind/social), 신드롬(syndrome), 일반/커스텀 스킬을 모두 지원.
     * @returns {{stat: object|null, label: string}}
     */
    resolveStatAndLabel(actor, item) {
        const skillKey = item.system?.skill;
        const attributes = ['body', 'sense', 'mind', 'social'];

        if (attributes.includes(skillKey)) {
            return {
                stat: actor.system.attributes[skillKey],
                label: game.i18n.localize(`DX3rd.${skillKey.charAt(0).toUpperCase() + skillKey.slice(1)}`)
            };
        }

        if (skillKey === 'syndrome') {
            const stat = actor.system.attributes.syndrome;
            let label = stat?.name || game.i18n.localize('DX3rd.Syndrome');
            if (label && label.startsWith('DX3rd.')) label = game.i18n.localize(label);
            return { stat, label };
        }

        // 일반/커스텀 스킬
        const stat = actor.system.attributes.skills?.[skillKey];
        if (stat) return { stat, label: this.getSkillDisplayName(skillKey, stat) };

        // 폴백: 액터가 보유하지 않은 (계통) 기능치를 참조하면 연결 능력치로 판정한다.
        // (미습득 기능 = 능력치 판정, DX3 규칙과 일치. 계통 기능치를 새 캐릭터에 자동 시드하지
        //  않으므로, 홈브루 이펙트가 그런 기능치를 참조해도 판정이 중단되지 않게 한다.)
        const base = this._resolveSkillBase(skillKey);
        if (base && actor.system.attributes[base]) {
            const customSkills = game.settings.get("dx3rd-emanim", "customSkills") || {};
            const cs = customSkills[skillKey];
            const label = cs
                ? (typeof cs === 'object' ? cs.name : cs)
                : (skillKey.startsWith('DX3rd.') ? game.i18n.localize(skillKey) : skillKey);
            return { stat: actor.system.attributes[base], label };
        }

        return { stat: null, label: '' };
    },

    /**
     * 액터에 없는 기능치 키의 연결 능력치를 추정한다.
     * customSkills 설정의 base 를 우선 사용하고, 없으면 계통 키 접두사로 추론한다.
     */
    _resolveSkillBase(skillKey) {
        if (!skillKey) return null;
        const customSkills = game.settings.get("dx3rd-emanim", "customSkills") || {};
        const cs = customSkills[skillKey];
        if (cs && typeof cs === 'object' && cs.base) return cs.base;
        if (skillKey.startsWith('info_')) return 'social';
        if (skillKey.startsWith('know_')) return 'mind';
        if (skillKey.startsWith('drive_')) return 'body';
        if (skillKey.startsWith('ars_')) return 'sense';
        return null;
    },

    async handle(actorId, itemId, getTarget, options = {}) {
        const actor = game.actors.get(actorId);
        if (!actor) { 
            ui.notifications.warn("Actor not found"); 
            return; 
        }
        
        // 액터의 아이템에서 먼저 찾고, 없으면 game.items에서 찾기
        const item = actor.items.get(itemId) || game.items.get(itemId);
        if (!item) { 
            ui.notifications.warn("Item not found"); 
            return; 
        }

        // 이펙트 롤 타입 분기: '-'는 기본 로직, 그 외는 판정 처리
        const rollType = item.system?.roll ?? '-';
        // attackRoll(백병/사격)이 설정된 자체공격 이펙트는 roll이 '-'라도 공격 판정으로 라우팅한다.
        // (자동 기계화가 roll을 '-'로 둔 케이스의 안전망이며, 향후 공격 이펙트도 자동 커버한다.)
        const hasAttackRoll = item.system?.attackRoll && item.system.attackRoll !== '-';

        if (rollType === '-' && !hasAttackRoll) {
            // 기본 처리: 침식률 증가 및 통합 메시지 출력 (instant는 universal-handler에서 이미 처리됨)
            await this.handleBasicEffect(actor, item);
        } else {
            // 판정 처리: major/reaction/dodge. roll이 '-'인 공격 이펙트는 판정 종류를 timing에서 유추한다.
            let effectiveRoll = rollType;
            if (rollType === '-') {
                const timing = item.system?.timing;
                effectiveRoll = (timing === 'reaction' || timing === 'dodge') ? timing : 'major';
            }
            await this.handleEffectRoll(actor, item, effectiveRoll, getTarget, options);
        }
    },
    
    /**
     * 기본 이펙트 처리 (system.roll === '-')
     * 침식률/활성화/익스텐션은 이미 handleItemUse에서 처리됨
     */
    async handleBasicEffect(actor, item) {
        // 특별한 처리 없음 - 모든 것이 UniversalHandler에서 처리됨
    },
    
    /**
     * 판정 이펙트 처리 (system.roll !== '-')
     * 침식률/활성화는 이미 handleItemUse에서 처리됨
     */
    async handleEffectRoll(actor, item, rollType, getTarget, options = {}) {
        const handler = window.DX3rdUniversalHandler;
        if (!handler) {
            console.error("DX3rd | UniversalHandler not found");
            return;
        }
        
        // 무기 선택이 활성화된 경우, 무기 선택 다이얼로그 표시
        if (item.system?.weaponSelect && item.system?.attackRoll && item.system.attackRoll !== '-') {
            await this.showWeaponSelectionForAttack(actor, item, rollType, options);
            return;
        }
        
        // 무기 선택이 비활성화되어 있지만 공격 판정인 경우, 등록된 무기 보너스 적용
        if (!item.system?.weaponSelect && item.system?.attackRoll && item.system.attackRoll !== '-') {
            const registeredWeaponBonus = this.calculateRegisteredWeaponBonus(actor, item);
            
            // 등록된 무기 중 사용 가능한 무기가 하나라도 있으면 보너스 적용
            const hasAvailableWeapons = registeredWeaponBonus.weaponIds.length > 0;
            
            if (hasAvailableWeapons) {
                // 사용 가능한 무기가 있으면 보너스 적용
                const weaponBonus = (registeredWeaponBonus.attack > 0 || registeredWeaponBonus.add !== 0 || registeredWeaponBonus.attackFormula || registeredWeaponBonus.addFormula)
                    ? registeredWeaponBonus 
                    : null;
                
                await this.handleEffectRollWithWeapon(actor, item, rollType, weaponBonus, options);
                return;
            }
            // weaponSelect가 false이면 무기 선택 다이얼로그를 열지 않고 일반 판정으로 진행
        }
        
        // 아이템의 스킬로 stat 데이터 가져오기
        const skillKey = item.system?.skill;
        if (!skillKey || skillKey === '-') {
            ui.notifications.warn('이펙트의 기능이 설정되지 않았습니다.');
            return;
        }

        // 스킬 또는 능력치 데이터 가져오기 (능력치/신드롬/커스텀 스킬 공통 처리)
        const { stat, label } = this.resolveStatAndLabel(actor, item);

        if (!stat) {
            ui.notifications.warn('기능 데이터를 찾을 수 없습니다.');
            return;
        }

        // 판정 다이얼로그 표시 (특정 타입만)
        handler.showStatRollDialog(
            actor,
            stat,
            label,
            rollType,
            item,
            null,
            null,
            null,
            null,
            options.predefinedDifficulty || null,
            false,
            false,
            options.afterRollCallback || null
        );
    },
    
    /**
     * 공격용 무기 선택 다이얼로그 표시
     */
    async showWeaponSelectionForAttack(actor, item, rollType, options = {}) {
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
                // 무기 보너스를 적용하여 판정 다이얼로그 표시
                await this.handleEffectRollWithWeapon(actor, item, rollType, weaponBonus, options);
            }
        }).render(true);
    },
    
    /**
     * 무기 탭에 등록된 무기들의 보너스 계산 (공격 횟수가 남은 무기만)
     */
    calculateRegisteredWeaponBonus(actor, item) {
        const weaponBonus = { attack: 0, add: 0, attackFormula: '', addFormula: '', weaponName: '', weaponIds: [] };
        
        // 무기 탭에 등록된 무기들 가져오기
        const registeredWeapons = item.system?.weapon || [];
        
        // 각 등록된 무기의 보너스 합산 (공격 횟수가 남은 무기만)
        for (const weaponId of registeredWeapons) {
            if (weaponId && weaponId !== '-') {
                // 액터의 아이템에서 직접 무기 데이터 가져오기
                const weaponItem = window.DX3rdResolveWeapon(actor, weaponId);
                if (weaponItem && weaponItem.type === 'weapon') {
                    // 공격 횟수 체크 (weapon만, vehicle은 attack-used 없음)
                    const attackUsedDisable = weaponItem.system['attack-used']?.disable || 'notCheck';
                    const attackUsedState = weaponItem.system['attack-used']?.state || 0;
                    const attackUsedMax = weaponItem.system['attack-used']?.max || 0;
                    const isAttackExhausted = attackUsedDisable !== 'notCheck' && (attackUsedMax <= 0 || attackUsedState >= attackUsedMax);
                    
                    // 공격 횟수가 소진된 무기는 제외
                    if (isAttackExhausted) {
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
                    
                    // 무기 이름 추가
                    if (!weaponBonus.weaponName) {
                        weaponBonus.weaponName = weaponItem.name;
                    } else {
                        weaponBonus.weaponName += `, ${weaponItem.name}`;
                    }
                    
                    // 무기 ID 추가
                    weaponBonus.weaponIds.push(weaponId);
                } else if (weaponItem) {
                    // 무기가 아닌 경우 건너뛰기
                } else {
                    // 무기를 찾을 수 없는 경우 건너뛰기
                }
            }
        }
        
        return weaponBonus;
    },

    /**
     * 무기 보너스를 적용한 판정 처리
     */
    async handleEffectRollWithWeapon(actor, item, rollType, weaponBonus, options = {}) {
        const handler = window.DX3rdUniversalHandler;

        // 아이템의 스킬로 stat 데이터 가져오기
        const skillKey = item.system?.skill;
        if (!skillKey || skillKey === '-') {
            ui.notifications.warn('이펙트의 기능이 설정되지 않았습니다.');
            return;
        }

        // 스킬 또는 능력치 데이터 가져오기 (능력치/신드롬/커스텀 스킬 공통 처리)
        const { stat, label } = this.resolveStatAndLabel(actor, item);

        if (!stat) {
            ui.notifications.warn('기능 데이터를 찾을 수 없습니다.');
            return;
        }

        // 무기 보너스를 적용하여 판정 다이얼로그 표시
        handler.showStatRollDialog(
            actor,
            stat,
            label,
            rollType,
            item,
            null,
            weaponBonus,
            null,
            null,
            options.predefinedDifficulty || null,
            false,
            false,
            options.afterRollCallback || null
        );
    }
};
})();
