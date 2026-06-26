// Etc 아이템 핸들러
(function() {
window.DX3rdEtcHandler = {
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

        // Etc 아이템은 항상 즉시 처리 (runTiming 고정)
        await this.handleInstantEtc(actor, item);
    },
    
    /**
     * 즉시 처리 Etc 아이템
     * 활성화, 적용, 매크로, 익스텐드 실행
     */
    async handleInstantEtc(actor, item) {
        const handler = window.DX3rdUniversalHandler;
        if (!handler) {
            console.error("DX3rd | UniversalHandler not found");
            return;
        }
        
        // 1. 활성화 처리
        await handler.activateItem(actor, item);
        
        // 2. 적용 처리
        await handler.applyToTargets(actor, item, 'instant');
        
        // 3. 매크로 실행
        await handler.executeMacros(item, 'instant');
        
        // 4. 익스텐드 실행
        await handler.processItemExtensions(actor, item, 'instant');
    }
};
})();
