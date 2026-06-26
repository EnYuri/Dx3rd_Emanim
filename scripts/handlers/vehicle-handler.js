// Vehicle 아이템 핸들러
(function() {
window.DX3rdVehicleHandler = {
    async handle(actorId, itemId) {
        const actor = game.actors.get(actorId);
        // 액터의 아이템에서 먼저 찾고, 없으면 game.items에서 찾기
        const item = actor?.items.get(itemId) || game.items.get(itemId);
        
        if (!actor || !item) {
            console.error("DX3rd | VehicleHandler - Actor or Item not found", { actorId, itemId });
            return;
        }
        
        // 장비 활성화 (침식률/활성화/익스텐션은 이미 handleItemUse에서 처리됨)
        if (!item.system.equipment) {
            // 비클은 하나만 장착 가능 — 기존 장착 비클 전부 해제
            const otherVehicles = actor.items.filter(i =>
                i.type === 'vehicle' && i.id !== itemId && i.system?.equipment === true
            );
            for (const v of otherVehicles) {
                await v.update({ 'system.equipment': false });
            }
            await item.update({ 'system.equipment': true });
        }

        // 공격/효과 다이얼로그 표시
        await this.showVehicleUseDialog(actor, item);
    },
    
    async showVehicleUseDialog(actor, item) {
        // 커스텀 DOM 다이얼로그 생성
        const dialogDiv = document.createElement("div");
        dialogDiv.className = "vehicle-use-custom-dialog";
        dialogDiv.style.position = "fixed";
        dialogDiv.style.top = "50%";
        dialogDiv.style.left = "50%";
        dialogDiv.style.transform = "translate(-50%, -50%)";
        dialogDiv.style.background = "rgba(0, 0, 0, 0.85)";
        dialogDiv.style.color = "white";
        dialogDiv.style.padding = "10px 20px 12px 20px";
        dialogDiv.style.border = "none";
        dialogDiv.style.borderRadius = "8px";
        dialogDiv.style.zIndex = "9999";
        dialogDiv.style.textAlign = "center";
        dialogDiv.style.fontSize = "16px";
        dialogDiv.style.boxShadow = "0 0 10px black";
        dialogDiv.style.minWidth = "260px";
        dialogDiv.style.cursor = "move";
        
        // 제목
        const title = document.createElement("div");
        title.textContent = `${item.name} ${game.i18n.localize('DX3rd.Use')}`;
        title.style.marginBottom = "12px";
        title.style.fontSize = "0.9em";
        dialogDiv.appendChild(title);
        
        // 버튼 컨테이너
        const buttonContainer = document.createElement("div");
        buttonContainer.style.width = "100%";
        buttonContainer.style.display = "flex";
        buttonContainer.style.flexDirection = "column";
        buttonContainer.style.gap = "8px";
        buttonContainer.style.marginTop = "4px";
        
        // 공격 굴림 버튼
        const attackBtn = document.createElement("button");
        attackBtn.textContent = game.i18n.localize('DX3rd.AttackRoll');
        attackBtn.style.width = "100%";
        attackBtn.style.height = "28px";
        attackBtn.style.background = "white";
        attackBtn.style.color = "black";
        attackBtn.style.borderRadius = "4px";
        attackBtn.style.border = "none";
        attackBtn.style.opacity = "0.5";
        attackBtn.style.fontWeight = "bold";
        attackBtn.style.fontSize = "0.75em";
        attackBtn.style.margin = "0";
        attackBtn.style.display = "flex";
        attackBtn.style.alignItems = "center";
        attackBtn.style.justifyContent = "center";
        attackBtn.style.padding = "0";
        attackBtn.style.cursor = "pointer";
        attackBtn.onclick = async () => {
            const result = await this.handleAttackRoll(actor, item);
            if (result !== false) {
                if (dialogDiv.parentNode) document.body.removeChild(dialogDiv);
            }
        };
        buttonContainer.appendChild(attackBtn);
        
        // 효과만 사용 버튼 (대상 체크 시만)
        if (item.system.getTarget) {
            const applyBtn = document.createElement("button");
            applyBtn.textContent = game.i18n.localize('DX3rd.OnlyApplied');
            applyBtn.style.width = "100%";
            applyBtn.style.height = "28px";
            applyBtn.style.background = "white";
            applyBtn.style.color = "black";
            applyBtn.style.borderRadius = "4px";
            applyBtn.style.border = "none";
            applyBtn.style.opacity = "0.5";
            applyBtn.style.fontWeight = "bold";
            applyBtn.style.fontSize = "0.75em";
            applyBtn.style.margin = "0";
            applyBtn.style.display = "flex";
            applyBtn.style.alignItems = "center";
            applyBtn.style.justifyContent = "center";
            applyBtn.style.padding = "0";
            applyBtn.style.cursor = "pointer";
            applyBtn.onclick = async () => {
                const result = await this.handleOnlyApplied(actor, item);
                if (result !== false) {
                    if (dialogDiv.parentNode) document.body.removeChild(dialogDiv);
                }
            };
            buttonContainer.appendChild(applyBtn);
        }
        
        dialogDiv.appendChild(buttonContainer);
        
        // 드래그 기능 추가
        let isDragging = false;
        let currentX;
        let currentY;
        let initialX;
        let initialY;
        
        dialogDiv.addEventListener("mousedown", (e) => {
            // 버튼 클릭은 제외
            if (e.target.tagName === 'BUTTON') return;
            
            isDragging = true;
            initialX = e.clientX - dialogDiv.offsetLeft;
            initialY = e.clientY - dialogDiv.offsetTop;
            dialogDiv.style.cursor = "grabbing";
        });
        
        document.addEventListener("mousemove", (e) => {
            if (!isDragging) return;
            
            e.preventDefault();
            currentX = e.clientX - initialX;
            currentY = e.clientY - initialY;
            
            dialogDiv.style.left = currentX + "px";
            dialogDiv.style.top = currentY + "px";
            dialogDiv.style.transform = "none";
        });
        
        document.addEventListener("mouseup", () => {
            if (isDragging) {
                isDragging = false;
                dialogDiv.style.cursor = "move";
            }
        });
        
        document.body.appendChild(dialogDiv);
    },
    
    async handleAttackRoll(actor, item) {
        return await window.DX3rdUniversalHandler.handleAttackRoll(actor, item);
    },
    
    async handleOnlyApplied(actor, item) {
        // 대상 확인
        const targets = Array.from(game.user.targets);
        if (targets.length === 0) {
            ui.notifications.warn(game.i18n.localize('DX3rd.SelectTarget'));
            return false; // 다이얼로그 닫지 않음
        }
        
        // universal-handler의 효과 적용 기능 사용
        const handler = window.DX3rdUniversalHandler;
        if (handler) {
            const itemData = {
                id: item.id,
                name: item.name,
                img: item.img,
                effect: {
                    disable: item.system.effect?.disable || '-',
                    attributes: item.system.effect?.attributes || {}
                }
            };
            
            await handler.applyEffectData(actor, itemData);
            return true; // 성공 시 다이얼로그 닫음
        } else {
            console.error("DX3rd | UniversalHandler not found");
            ui.notifications.error('효과 적용 중 오류가 발생했습니다.');
            return false; // 오류 시 다이얼로그 닫지 않음
        }
    }
};
})();
