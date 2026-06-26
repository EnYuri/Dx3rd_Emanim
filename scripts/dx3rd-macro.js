// DX3rd Macro Extension

/**
 * 아이템을 채팅으로 출력하는 매크로 생성
 */
async function createItemChatMacro(item) {
    // 액터 정보 확인
    const actor = item.actor;
    if (!actor) {
        ui.notifications.warn("액터가 소유한 아이템만 핫바에 추가할 수 있습니다.");
        return null;
    }
    
    // 매크로 생성
    const macroName = `${item.name}`;
    const command = `// ${item.name} - ${actor.name}
const actor = game.actors.get("${actor.id}");
const item = actor?.items.get("${item.id}");

if (!actor) {
    ui.notifications.error("액터를 찾을 수 없습니다: ${actor.name}");
    return;
}

if (!item) {
    ui.notifications.error("아이템을 찾을 수 없습니다: ${item.name}");
    return;
}

// 액터 시트의 _sendItemToChat 메서드 호출
const sheet = actor.sheet;
if (sheet && typeof sheet._sendItemToChat === 'function') {
    await sheet._sendItemToChat(item);
} else {
    ui.notifications.error("아이템을 채팅으로 출력할 수 없습니다.");
}`;
    
    // 기존 매크로 찾기 (같은 이름과 액터/아이템 ID가 일치하는 경우)
    let macro = game.macros.find(m => 
        m.name === macroName && 
        m.flags?.['dx3rd-emanim']?.actorId === actor.id && 
        m.flags?.['dx3rd-emanim']?.itemId === item.id
    );
    
    if (!macro) {
        // 새 매크로 생성
        macro = await Macro.create({
            name: macroName,
            type: 'script',
            img: item.img,
            command: command,
            flags: { 
                'dx3rd-emanim': { 
                    itemMacro: true,
                    actorId: actor.id,
                    itemId: item.id
                }
            }
        });
    } else {
        // 기존 매크로 업데이트
        await macro.update({
            img: item.img,
            command: command
        });
    }
    
    return macro;
}

// ready Hook에서 Hotbar의 드롭 이벤트 리스너 추가
Hooks.once('ready', () => {
    // 핫바 엘리먼트 찾기
    const hotbarElement = document.getElementById('hotbar');
    if (!hotbarElement) {
        console.error('DX3rd | Hotbar element not found');
        return;
    }
    
    // 드롭 이벤트 리스너 추가 (캡처 단계에서 먼저 처리)
    hotbarElement.addEventListener('drop', async (event) => {
        try {
            // 드래그 데이터 가져오기
            const TextEditorClass = foundry.applications.ux.TextEditor.implementation;
            const data = TextEditorClass.getDragEventData(event);
            
            // 아이템이 아니면 무시
            if (data.type !== 'Item') {
                return;
            }
            
            // 아이템 가져오기
            const item = await fromUuid(data.uuid);
            if (!item) {
                console.warn('DX3rd | Item not found:', data.uuid);
                return;
            }
            
            // 드롭된 슬롯 찾기
            const slotElement = event.target.closest('[data-slot]');
            if (!slotElement) {
                console.warn('DX3rd | Slot element not found');
                return;
            }
            
            const slot = slotElement.dataset.slot;
            // 기본 동작 방지
            event.preventDefault();
            event.stopPropagation();
            
            // 매크로 생성 및 할당
            const macro = await createItemChatMacro(item);
            if (macro) {
                await game.user.assignHotbarMacro(macro, slot);
            }
        } catch (error) {
            console.error('DX3rd | Error in hotbar drop handler:', error);
        }
    }, true); // 캡처 단계에서 처리
});

// 매크로 설정 창 확장
Hooks.once('ready', () => {
    // Advanced Macros 모듈과의 충돌 방지를 위해 prototype 수정 제거
    // 대신 renderMacroConfig 훅과 change 이벤트만 사용
    
    // 렌더링 후 필드 추가
    Hooks.on('renderMacroConfig', (app, html, data) => {
        const $html = $(html);
        
        // 이미 추가되었는지 확인
        if ($html.find('[name="runTiming"]').length > 0) {
            return;
        }
        
        // 매크로 객체 가져오기 (V13 호환)
        const macro = app.object || app.document;
        if (!macro) {
            console.warn('DX3rd | No macro object found in MacroConfig');
            return;
        }
        const currentTiming = macro.getFlag('dx3rd-emanim', 'runTiming') || 'instant';
        
        // 실행 타이밍 필드 HTML
        const runTimingField = `
            <div class="form-group">
                <label>${game.i18n.localize('DX3rd.RunTiming')}</label>
                <div class="form-fields">
                    <select name="runTiming" id="dx3rd-run-timing">
                        <option value="instant" ${currentTiming === 'instant' ? 'selected' : ''}>${game.i18n.localize('DX3rd.Instant')}</option>
                        <option value="onInvoke" ${currentTiming === 'onInvoke' ? 'selected' : ''}>${game.i18n.localize('DX3rd.OnInvoke')}</option>
                        <option value="afterSuccess" ${currentTiming === 'afterSuccess' ? 'selected' : ''}>${game.i18n.localize('DX3rd.AfterSuccess')}</option>
                        <option value="afterDamage" ${currentTiming === 'afterDamage' ? 'selected' : ''}>${game.i18n.localize('DX3rd.AfterDamage')}</option>
                    </select>
                </div>
            </div>
        `;
        
        // 유형 필드 뒤에 추가
        const typeField = $html.find('.form-group').first();
        if (typeField.length > 0) {
            typeField.after(runTimingField);
            
            // change 이벤트로 즉시 저장
            $html.find('#dx3rd-run-timing').on('change', async function() {
                const newTiming = $(this).val();
                try {
                    await macro.setFlag('dx3rd-emanim', 'runTiming', newTiming);
                    
                    ui.notifications.info(`실행 타이밍이 "${game.i18n.localize('DX3rd.' + newTiming.charAt(0).toUpperCase() + newTiming.slice(1))}"로 변경되었습니다.`);
                } catch (e) {
                    console.error('DX3rd | [' + macro.name + '] Failed to save run timing:', e);
                    ui.notifications.error('실행 타이밍 저장에 실패했습니다.');
                }
            });
        }
    });
});
