// Connection 아이템 핸들러
(function() {
const DialogV2 = foundry.applications?.api?.DialogV2;

window.DX3rdConnectionHandler = {
    async handle(actorId, itemId, getTarget, options = {}) {
        const actor = game.actors.get(actorId);
        if (!actor) {
            ui.notifications.warn(game.i18n.localize('DX3rd.ActorNotFound'));
            return;
        }
        
        // 액터의 아이템에서 먼저 찾고, 없으면 game.items에서 찾기
        const item = actor.items.get(itemId) || game.items.get(itemId);
        if (!item) {
            ui.notifications.warn(game.i18n.localize('DX3rd.ItemNotFound'));
            return;
        }
        
        // 판정 기능이 없는 특수 커넥션은 인라인 자동화만 실행하고 끝낸다.
        const skillKey = item.system?.skill || '-';
        if (!skillKey || skillKey === '-') {
            return true;
        }
        
        // 공용 해석기는 액터에 전문 기능이 없어도 계통의 연결 능력치로 폴백한다.
        const resolved = window.DX3rdUniversalHandler?.resolveStatAndLabel(actor, item) || {};
        const skillData = resolved.stat || null;
        const skillName = resolved.label || '';
        
        if (!skillData) {
            ui.notifications.warn(game.i18n.localize('DX3rd.SkillNotFound'));
            return false;
        }
        
        // 토큰 자동 선택
        let previousToken = canvas.tokens.controlled[0];
        const actorTokens = canvas.tokens.placeables.filter(t => t.actor?.id === actorId);
        if (actorTokens.length > 0 && (!previousToken || previousToken.actor?.id !== actorId)) {
            previousToken = canvas.tokens.controlled[0];
            actorTokens[0].control({ releaseOthers: true });
        }
        
        let useCombo = false;
        if (options.comboMode !== 'normal') {
            if (typeof window.DX3rdChooseRollMode !== 'function') {
                ui.notifications.error(game.i18n.localize('DX3rd.DialogV2Unavailable'));
                return;
            }
            useCombo = await window.DX3rdChooseRollMode();
        }
        if (useCombo === null) return;

        if (useCombo) {
            // 콤보 빌더 열기 (skill 전달)
            if (window.DX3rdUniversalHandler && window.DX3rdUniversalHandler.openComboBuilder) {
                await window.DX3rdUniversalHandler.openComboBuilder(actor, 'skill', skillKey, item);
            }
            // 이전 토큰 복원
            if (previousToken && canvas.tokens) {
                previousToken.control({ releaseOthers: true });
            }
            return;
        }

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
        return true;
    }
};
})();
