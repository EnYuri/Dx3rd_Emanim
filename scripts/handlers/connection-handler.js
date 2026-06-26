// Connection 아이템 핸들러
(function() {
window.DX3rdConnectionHandler = {
    async handle(actorId, itemId) {
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
        
        // Connection의 skill 가져오기
        const skillKey = item.system?.skill || '-';
        if (!skillKey || skillKey === '-') {
            ui.notifications.warn("Connection의 스킬이 설정되지 않았습니다.");
            return;
        }
        
        // 스킬 데이터 가져오기
        const attributes = ['body', 'sense', 'mind', 'social'];
        let skillData = null;
        let skillName = '';
        
        if (attributes.includes(skillKey)) {
            // 능력치
            skillData = actor.system.attributes[skillKey];
            skillName = game.i18n.localize(`DX3rd.${skillKey.charAt(0).toUpperCase() + skillKey.slice(1)}`);
        } else {
            // 스킬
            skillData = actor.system.attributes.skills?.[skillKey];
            if (skillData) {
                skillName = skillData.name;
                if (skillName && skillName.startsWith('DX3rd.')) {
                    skillName = game.i18n.localize(skillName);
                }
            }
        }
        
        if (!skillData) {
            ui.notifications.warn("스킬을 찾을 수 없습니다.");
            return;
        }
        
        // 토큰 자동 선택
        let previousToken = canvas.tokens.controlled[0];
        const actorTokens = canvas.tokens.placeables.filter(t => t.actor?.id === actorId);
        if (actorTokens.length > 0 && (!previousToken || previousToken.actor?.id !== actorId)) {
            previousToken = canvas.tokens.controlled[0];
            actorTokens[0].control({ releaseOthers: true });
        }
        
        // 콤보 확인 다이얼로그
        const title = game.i18n.localize('DX3rd.Combo');
        new Dialog({
            title,
            buttons: {
                yes: {
                    label: 'Yes',
                    callback: async () => {
                        // 콤보 빌더 열기 (skill 전달)
                        if (window.DX3rdUniversalHandler && window.DX3rdUniversalHandler.openComboBuilder) {
                            await window.DX3rdUniversalHandler.openComboBuilder(actor, 'skill', skillKey, item);
                        }
                        // 이전 토큰 복원
                        if (previousToken && canvas.tokens) {
                            previousToken.control({ releaseOthers: true });
                        }
                    }
                },
                no: {
                    label: 'No',
                    callback: () => {
                        // 바로 스킬 체크 (난이도 입력)
                        if (window.DX3rdUniversalHandler && window.DX3rdUniversalHandler.showStatRollDialog) {
                            window.DX3rdUniversalHandler.showStatRollDialog(
                                actor, 
                                skillData, 
                                skillName, 
                                'major', 
                                item, 
                                previousToken,
                                null, // weaponBonus
                                null, // comboAfterSuccessData
                                null, // comboAfterDamageData
                                null  // predefinedDifficulty (null로 설정하여 사용자가 입력)
                            );
                        }
                    }
                }
            },
            default: 'no'
        }).render(true);
    }
};
})();
