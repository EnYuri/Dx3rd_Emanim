// Psionic 아이템 핸들러
(function() {
window.DX3rdPsionicHandler = {
    async handle(actorId, itemId, getTarget) {
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

        // 사이오닉 롤 타입 분기: '-'는 기본 로직, 그 외는 판정 처리
        const rollType = item.system?.roll ?? '-';
        
        if (rollType === '-') {
            // 기본 처리: 침식률 증가 및 통합 메시지 출력 (instant는 universal-handler에서 이미 처리됨)
            await this.handleBasicPsionic(actor, item);
        } else {
            // 판정 처리: major/reaction/dodge
            await this.handlePsionicRoll(actor, item, rollType, getTarget);
        }
    },
    
    /**
     * 기본 사이오닉 처리 (system.roll === '-')
     * 침식률/활성화/익스텐션은 이미 handleItemUse에서 처리됨
     */
    async handleBasicPsionic(actor, item) {
        // 특별한 처리 없음 - 모든 것이 UniversalHandler에서 처리됨
    },
    
    /**
     * 판정 사이오닉 처리 (system.roll !== '-')
     * 침식률/활성화는 이미 handleItemUse에서 처리됨
     */
    async handlePsionicRoll(actor, item, rollType, getTarget) {
        const handler = window.DX3rdUniversalHandler;
        if (!handler) {
            console.error("DX3rd | UniversalHandler not found");
            return;
        }
        
        // 무기 선택이 활성화된 경우, 무기 선택 다이얼로그 표시
        if (item.system?.weaponSelect && item.system?.attackRoll && item.system.attackRoll !== '-') {
            await this.showWeaponSelectionForAttack(actor, item, rollType);
            return;
        }
        
        // 무기 선택이 비활성화되어 있지만 공격 판정인 경우, 등록된 무기 보너스 적용
        if (!item.system?.weaponSelect && item.system?.attackRoll && item.system.attackRoll !== '-') {
            const registeredWeaponBonus = this.calculateRegisteredWeaponBonus(actor, item);
            
            // 등록된 무기 중 사용 가능한 무기가 하나라도 있으면 보너스 적용
            const hasAvailableWeapons = registeredWeaponBonus.weaponIds.length > 0;
            
            if (hasAvailableWeapons) {
                // 사용 가능한 무기가 있으면 보너스 적용
                const weaponBonus = (registeredWeaponBonus.attack > 0 || registeredWeaponBonus.add !== 0) 
                    ? registeredWeaponBonus 
                    : null;
                
                await this.handlePsionicRollWithWeapon(actor, item, rollType, weaponBonus);
                return;
            }
            // weaponSelect가 false이면 무기 선택 다이얼로그를 열지 않고 일반 판정으로 진행
        }
        
        // 아이템의 스킬로 stat 데이터 가져오기
        const skillKey = item.system?.skill;
        if (!skillKey || skillKey === '-') {
            ui.notifications.warn('사이오닉의 기능이 설정되지 않았습니다.');
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
        } else {
            // 스킬
            stat = actor.system.attributes.skills?.[skillKey];
            if (stat) {
                label = stat.name;
                if (label && label.startsWith('DX3rd.')) {
                    label = game.i18n.localize(label);
                }
            }
        }
        
        if (!stat) {
            ui.notifications.warn('기능 데이터를 찾을 수 없습니다.');
            return;
        }
        
        // 판정 다이얼로그 표시 (특정 타입만)
        handler.showStatRollDialog(actor, stat, label, rollType, item);
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
                await this.handlePsionicRollWithWeapon(actor, item, rollType, weaponBonus);
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
                        continue;
                    }
                    
                    // 공격력 합산 (문자열로 저장됨)
                    const attackValue = Number(weaponItem.system?.attack) || 0;
                    weaponBonus.attack += attackValue;
                    
                    // 수정치 합산 (문자열로 저장됨)
                    const addValue = Number(weaponItem.system?.add) || 0;
                    weaponBonus.add += addValue;
                    
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
    async handlePsionicRollWithWeapon(actor, item, rollType, weaponBonus) {
        const handler = window.DX3rdUniversalHandler;
        
        // 아이템의 스킬로 stat 데이터 가져오기
        const skillKey = item.system?.skill;
        if (!skillKey || skillKey === '-') {
            ui.notifications.warn('사이오닉의 기능이 설정되지 않았습니다.');
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
            stat = actor.system.attributes.skills?.[skillKey];
            if (stat) {
                label = stat.name;
                if (label && label.startsWith('DX3rd.')) {
                    label = game.i18n.localize(label);
                }
            }
        }
        
        if (!stat) {
            ui.notifications.warn('기능 데이터를 찾을 수 없습니다.');
            return;
        }
        
        handler.showStatRollDialog(actor, stat, label, rollType, item, null, weaponBonus);
    }
};
})();
