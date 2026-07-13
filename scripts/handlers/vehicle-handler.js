// 비클 아이템 핸들러: 사용은 장착 후 즉시 공격 흐름으로 연결한다.
(function() {
window.DX3rdVehicleHandler = {
    async handle(actorId, itemId, getTarget, options = {}) {
        const actor = game.actors.get(actorId);
        const item = actor?.items.get(itemId) || game.items.get(itemId);
        if (!actor || !item) {
            console.error('DX3rd | VehicleHandler - Actor or Item not found', {actorId, itemId});
            return false;
        }

        if (!item.system.equipment) {
            const equippedVehicles = actor.items.filter(other =>
                other.type === 'vehicle' && other.id !== item.id && other.system?.equipment === true
            );
            for (const vehicle of equippedVehicles) await vehicle.update({'system.equipment': false});
            await item.update({'system.equipment': true});
        }
        return this.handleAttackRoll(actor, item, options);
    },

    async handleAttackRoll(actor, item, options = {}) {
        return window.DX3rdUniversalHandler.handleAttackRoll(actor, item, options);
    }
};
})();
