// Once 아이템 핸들러
(function() {
window.DX3rdOnceHandler = {
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

        // Once 아이템은 항상 즉시 처리 (runTiming 고정)
        await this.handleInstantOnce(actor, item);
    },
    
    /**
     * 즉시 처리 Once 아이템
     * 활성화/적용/매크로/익스텐드는 UniversalHandler.handleItemUse 가 인라인으로 이미 실행한다
     * (effect/weapon 핸들러와 동일 패턴). 여기서 다시 부르면 이중실행(효과 2회 적용 — 회복 2배 등)이
     * 되므로 중복 호출을 두지 않는다. once 특유의 타입 로직이 필요해지면 이 자리에 추가한다.
     */
    async handleInstantOnce(actor, item) {
        // no-op: handleItemUse 인라인 처리에 위임 (이중실행 방지)
    }
};
})();
