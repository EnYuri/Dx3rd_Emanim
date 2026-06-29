// Protect 아이템 핸들러
(function() {
window.DX3rdProtectHandler = {
    async handle(actorId, itemId) {
        const actor = game.actors.get(actorId);
        const item = actor?.items.get(itemId) || game.items.get(itemId);

        if (!actor || !item) {
            console.error("DX3rd | ProtectHandler - Actor or Item not found", { actorId, itemId });
            return;
        }

        // 장비 장착 — actor.js prepareData가 equipment === true인 protect의
        // armor/init/dodge를 자동으로 합산하므로 이 플래그 설정이 핵심.
        if (!item.system.equipment) {
            await item.update({ 'system.equipment': true });
            console.log(`DX3rd | ProtectHandler - Equipped: ${item.name}`);
        }

        // 스탯 평가: 수식 문자열 → 숫자
        const evaluator = window.DX3rdFormulaEvaluator;
        const armorVal = item.system.armor ? evaluator.evaluate(item.system.armor, item, actor) : 0;
        const initVal  = item.system.init  ? evaluator.evaluate(item.system.init,  item, actor) : 0;
        const dodgeVal = item.system.dodge ? evaluator.evaluate(item.system.dodge, item, actor) : 0;

        const sign = v => (v >= 0 ? '+' : '') + v;
        const rows = [];
        if (armorVal !== 0) rows.push(
            `<div class="detail-row">` +
                `<span class="detail-key">${game.i18n.localize('DX3rd.Armor')}</span>` +
                `<span class="detail-value">${sign(armorVal)}</span>` +
            `</div>`
        );
        if (initVal !== 0) rows.push(
            `<div class="detail-row">` +
                `<span class="detail-key">${game.i18n.localize('DX3rd.Init')}</span>` +
                `<span class="detail-value">${sign(initVal)}</span>` +
            `</div>`
        );
        if (dodgeVal !== 0) rows.push(
            `<div class="detail-row">` +
                `<span class="detail-key">${game.i18n.localize('DX3rd.Dodge')}</span>` +
                `<span class="detail-value">${sign(dodgeVal)}</span>` +
            `</div>`
        );

        // 스탯이 없어도 해제 버튼은 항상 표시 (속성 기반 프로텍트 포함)
        const detailsBlock = rows.length > 0
            ? `<div class="effect-details">${rows.join('')}</div>`
            : '';

        ChatMessage.create({
            content:
                `<div class="dx3rd-item-chat">` +
                    detailsBlock +
                    `<div class="protect-actions">` +
                        `<button class="protect-unequip-btn" ` +
                            `data-actor-id="${actor.id}" data-item-id="${item.id}">` +
                            game.i18n.localize('DX3rd.Unequip') +
                        `</button>` +
                    `</div>` +
                `</div>`,
            speaker: { actor: actor.id, alias: actor.name }
        });
    },

    /**
     * 장비 해제 — 채팅 카드의 "장비 해제" 버튼 또는 매크로에서 직접 호출.
     */
    async handleUnequip(actorId, itemId) {
        const actor = game.actors.get(actorId);
        const item = actor?.items.get(itemId);

        if (!actor || !item) {
            console.error("DX3rd | ProtectHandler.handleUnequip - Actor or Item not found", { actorId, itemId });
            return false;
        }

        if (!item.system.equipment) {
            console.log(`DX3rd | ProtectHandler.handleUnequip - already unequipped: ${item.name}`);
            return false;
        }

        await item.update({ 'system.equipment': false });
        console.log(`DX3rd | ProtectHandler - Unequipped: ${item.name}`);

        let itemName = item.name;
        const rubyMatch = itemName.match(/^(.+)\|\|(.+)$/);
        if (rubyMatch) itemName = rubyMatch[1];

        ChatMessage.create({
            content:
                `<div class="dx3rd-item-chat">` +
                    `<div><strong>${itemName}</strong> — ${game.i18n.localize('DX3rd.Unequipped')}</div>` +
                `</div>`,
            speaker: { actor: actor.id, alias: actor.name }
        });

        return true;
    },

    /**
     * 셀 세이빙 (セルセイビング): GM이 프로텍트 아이템 파괴 판정을 요청할 때 호출.
     * — OverDrive로 생성된 방어구가 씬 종료 후에도 유지되는지 판정하는 굴림.
     *   성공하면 방어구 유지, 실패하면 장비 해제(파괴).
     * 현재는 UI 트리거를 제공하지 않으므로 매크로에서 직접 호출.
     * 예) DX3rdProtectHandler.handleSellSaving(actor, item)
     */
    async handleSellSaving(actor, item) {
        const difficulty = String(item.system.saving?.difficulty ?? '').trim();
        const required   = Number(item.system.saving?.value) || 0;

        if (!difficulty || difficulty === '-' || required === 0) {
            console.log(`DX3rd | ProtectHandler.handleSellSaving - no saving defined for ${item.name}`);
            return;
        }

        // 아이템 이름 정규화 (||RubyText 제거)
        let itemName = item.name;
        const rubyMatch = itemName.match(/^(.+)\|\|(.+)$/);
        if (rubyMatch) itemName = rubyMatch[1];

        const DialogV2 = foundry.applications?.api?.DialogV2;
        if (!DialogV2?.confirm) {
            ui.notifications.error('DialogV2를 사용할 수 없습니다.');
            return;
        }

        // 판정 다이얼로그: DX3rd 규칙에 따라 결과를 GM이 직접 입력
        const failed = await DialogV2.confirm({
            window: { title: `${itemName} — ${game.i18n.localize('DX3rd.SellSavingCheck')}` },
            content:
                `<p><strong>${game.i18n.localize('DX3rd.SellSavingDifficulty')}</strong>: ${difficulty}</p>` +
                `<p><strong>${game.i18n.localize('DX3rd.SellSavingRequired')}</strong>: ${required}</p>` +
                `<p>${game.i18n.localize('DX3rd.SellSavingFailedQuestion')}</p>`,
            yes: {
                icon: '<i class="fas fa-times-circle"></i>',
                label: game.i18n.localize('DX3rd.Failure')
            },
            no: {
                icon: '<i class="fas fa-check"></i>',
                label: game.i18n.localize('DX3rd.Cancel')
            },
            defaultYes: false
        });

        if (!failed) return;

        // 실패 → 장비 해제
        await item.update({ 'system.equipment': false });
        console.log(`DX3rd | ProtectHandler - SellSaving failed, unequipped: ${item.name}`);

        ChatMessage.create({
            content:
                `<div class="dx3rd-item-chat">` +
                    `<div><strong>${itemName}</strong> 셀 세이빙 실패 — 방어구 해제됨</div>` +
                `</div>`,
            speaker: { actor: actor.id, alias: actor.name }
        });
    }
};
})();
