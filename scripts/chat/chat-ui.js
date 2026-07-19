/**
 * Double Cross 3rd - 채팅 카드 UI
 * main.js 에서 분리. 채팅 메시지의 버튼 위임 처리, 토글 매니저, 카드 핸들러를 담당한다.
 * 반드시 main.js 보다 먼저 로드되어야 한다 — main.js 의 ready 훅이
 * DX3rdChatToggleManager.initialize() 를 호출한다.
 */

// ── jQuery 제거 지원 헬퍼 ────────────────────────────────────────────────
// jQuery `$(document).off('type.ns').on('type.ns', ...)` 멱등 재등록을 네이티브로 대체.
// key(구 네임스페이스)별로 이전 리스너를 removeEventListener 후 재등록한다.
window.DX3rdGlobalListeners = window.DX3rdGlobalListeners || {};
function dx3rdRegisterGlobalListener(key, type, handler, options) {
    const reg = window.DX3rdGlobalListeners;
    const prev = reg[key];
    if (prev) document.removeEventListener(prev.type, prev.handler, prev.options);
    reg[key] = { type, handler, options };
    document.addEventListener(type, handler, options);
}

// jQuery `.data(key)` 자동 변환 호환 리더. 네이티브 dataset은 문자열만 주므로,
// jQuery가 하던 boolean/null/number/JSON 변환을 재현한다. (data-key → dataset.key 카멜 변환)
function dx3rdReadData(el, key) {
    if (!el) return undefined;
    const camel = key.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
    const raw = el.dataset ? el.dataset[camel] : undefined;
    if (raw === undefined) return undefined;
    if (raw === 'true') return true;
    if (raw === 'false') return false;
    if (raw === 'null') return null;
    if (raw === '') return raw;
    if (/^-?\d+(?:\.\d+)?$/.test(raw) && String(Number(raw)) === raw) return Number(raw);
    const first = raw[0], last = raw[raw.length - 1];
    if ((first === '{' && last === '}') || (first === '[' && last === ']')) {
        try { return JSON.parse(raw); } catch (e) { /* 원문 유지 */ }
    }
    return raw;
}

// URI 인코딩해서 data-*로 실어 나른 수식 전용 리더. dx3rdReadData는 "10" 같은 순수 숫자
// 수식을 Number로 승격해버려, 고정 공격력이 문자열 검사에서 탈락해 통째로 유실된다.
// 수식은 항상 원문 문자열로 되읽는다. 속성이 없거나 비면 빈 문자열.
function dx3rdReadEncodedFormula(el, key) {
    if (!el?.dataset) return '';
    const camel = key.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
    const raw = el.dataset[camel];
    if (typeof raw !== 'string' || raw === '') return '';
    try {
        return decodeURIComponent(raw);
    } catch (e) {
        console.warn(`DX3rd | Could not read encoded formula (${key})`, e);
        return '';
    }
}

// 채팅 버튼 "완료" 텍스트 토글(네이티브). jQuery .data('original-text') 캐시는
// data-original-text 속성(dataset.originalText)으로 대체한다.
function dx3rdApplyCompleteText(button, isCompleted, completeText) {
    if (!button) return;
    if (isCompleted) {
        const currentText = button.textContent.trim();
        if (!currentText.includes(completeText)) {
            if (!button.dataset.originalText) button.dataset.originalText = currentText;
            const originalText = button.dataset.originalText || currentText;
            button.textContent = `${originalText} ${completeText}`;
        }
    } else {
        const originalText = button.dataset.originalText;
        if (originalText) {
            button.textContent = originalText;
        } else {
            const currentText = button.textContent.trim();
            button.textContent = currentText.replace(` ${completeText}`, '').trim();
        }
    }
}

// jQuery slideDown/slideUp(250, 'swing') 대체용 네이티브 높이 애니메이션.
// 요소에 `collapsed` 클래스 토글과 함께 사용. 진행 중 중복 실행을 막는다.
function dx3rdSlideToggle(el, expand, duration = 250) {
    if (!el) return;
    if (el.dataset.dx3rdAnimating === '1') return;
    el.dataset.dx3rdAnimating = '1';

    const cleanup = () => {
        el.style.transition = '';
        el.style.height = '';
        el.style.overflow = '';
        delete el.dataset.dx3rdAnimating;
    };

    if (expand) {
        el.classList.remove('collapsed');
        el.style.overflow = 'hidden';
        el.style.height = '0px';
        el.style.display = '';
        const target = el.scrollHeight;
        requestAnimationFrame(() => {
            el.style.transition = `height ${duration}ms ease`;
            el.style.height = target + 'px';
        });
        window.setTimeout(cleanup, duration + 20);
    } else {
        el.style.overflow = 'hidden';
        el.style.height = el.scrollHeight + 'px';
        requestAnimationFrame(() => {
            el.style.transition = `height ${duration}ms ease`;
            el.style.height = '0px';
        });
        window.setTimeout(() => {
            el.classList.add('collapsed');
            cleanup();
        }, duration + 20);
    }
}


// Enter 시 인라인 수정 저장 (편집 모드일 때만) - 다른 모듈로 이동됨

// 편집 플래그 변경 시 DOM 반영 (모든 클라이언트)
Hooks.on('updateChatMessage', (message, changes, options, userId) => {
    try {
        const flagChanges = changes?.flags?.['dx3rd-emanim'];
        if (!flagChanges) return;
        
        const messageElements = Array.from(document.querySelectorAll(`[data-message-id="${message.id}"]`));
        if (messageElements.length === 0) return;
        const findButtons = (sel) => messageElements.flatMap(me => Array.from(me.querySelectorAll(sel)));

        // 편집 플래그 처리
        if (flagChanges.editingBy !== undefined) {
            const editing = !!message.flags?.['dx3rd-emanim']?.editingBy;
            for (const me of messageElements) me.classList.toggle('dx3rd-editing-message', editing);
        }

        // 완료 플래그 처리 (버튼 텍스트 업데이트)
        const completeText = game.i18n.localize('DX3rd.Complete');
        
        // 완료 상태 토글 대상 버튼들 (동일 로직을 dx3rdApplyCompleteText로 통일)
        const completeFlagButtons = [
            { flag: 'successCompleted', sel: '.dx3rd-success-btn' },
            { flag: 'damageRollCompleted', sel: '.damage-roll-btn' },
            { flag: 'damageApplyCompleted', sel: '.damage-apply-btn' },
            { flag: 'attackRollCompleted', sel: '.attack-roll-btn' },
            { flag: 'invokeCompleted', sel: '.invoke-spell' },
            { flag: 'winCheckCompleted', sel: '.dx3rd-win-check-btn' }
        ];
        for (const { flag, sel } of completeFlagButtons) {
            if (flagChanges[flag] === undefined) continue;
            const isCompleted = message.flags?.['dx3rd-emanim']?.[flag] === true;
            for (const button of findButtons(sel)) {
                dx3rdApplyCompleteText(button, isCompleted, completeText);
            }
        }

        // itemUseCompleted 플래그 처리 (아이템별로 관리)
        if (flagChanges.itemUseCompleted !== undefined) {
            // 플래그가 undefined로 설정된 경우(삭제된 경우)도 처리
            const itemUseCompleted = message.flags?.['dx3rd-emanim']?.itemUseCompleted || {};

            for (const button of findButtons('.use-item-btn')) {
                const itemId = button.dataset.itemId;
                if (!itemId) continue;
                dx3rdApplyCompleteText(button, itemUseCompleted[itemId] === true, completeText);
            }
        }
    } catch (e) { 
        console.error('DX3rd | updateChatMessage hook error:', e);
    }
});

// 채팅 명령어로 Disable Hook 실행
Hooks.on('chatMessage', (chatLog, message, chatData) => {
    // /disable 명령어 처리
    const disablePattern = /^\/disable\s+(roll|major|reaction|guard|main|round|scene|session)$/i;
    const match = message.match(disablePattern);
    
    if (match) {
        const timing = match[1].toLowerCase();
        window.DX3rdDisableHooks.executeDisableHook(timing);
        return false; // 채팅 메시지 전송 차단
    }
    
    return true; // 일반 채팅 메시지는 정상 처리
});

// 채팅 메시지 렌더링 시 완료 상태 복원
Hooks.on('renderChatMessageHTML', (message, html, data) => {
    const completeText = game.i18n.localize('DX3rd.Complete');

    // 저장된 카드 HTML의 상태와 관계없이 현재 월드 설정을 초기 표시 상태로 적용한다.
    const expandItemCards = game.settings.get('dx3rd-emanim', 'expandChatItemCards');
    html.querySelectorAll('.dx3rd-item-chat .collapsible-content').forEach(element => {
        element.classList.toggle('collapsed', !expandItemCards);
        element.style.display = expandItemCards ? '' : 'none';
    });
    
    // message-header에 data-actor-id 속성 추가 (로이스 추가 기능을 위해)
    if (message.speaker && message.speaker.actor) {
        const messageHeader = html.querySelector('.message-header');
        if (messageHeader && !messageHeader.getAttribute('data-actor-id')) {
            messageHeader.setAttribute('data-actor-id', message.speaker.actor);
        }
    }
    
    // invoke-spell 버튼 완료 상태 복원
    const invokeCompleted = message.getFlag('dx3rd-emanim', 'invokeCompleted');
    if (invokeCompleted === true) {
        const button = html.querySelector('.invoke-spell');
        if (button) {
            const currentText = button.textContent.trim();
            
            // 이미 "완료"가 포함되어 있으면 중복 추가 방지
            if (!currentText.includes(completeText)) {
                const itemDataStr = button.getAttribute('data-item-data');
                let itemName = game.i18n.localize('DX3rd.Spell');
                
                if (itemDataStr) {
                    try {
                        const itemData = JSON.parse(itemDataStr);
                        itemName = itemData.name || itemName;
                    } catch (e) {
                        // 파싱 실패 시 무시
                    }
                }
                
                button.textContent = `${itemName} ${game.i18n.localize('DX3rd.Invoking')} ${completeText}`;
            }
        }
    }
    
    // damage-roll-btn 완료 상태 복원
    const damageRollCompleted = message.getFlag('dx3rd-emanim', 'damageRollCompleted');
    if (damageRollCompleted === true) {
        const button = html.querySelector('.damage-roll-btn');
        if (button) {
            const currentText = button.textContent.trim();
            if (!currentText.includes(completeText)) {
                // 원본 텍스트는 버튼의 현재 텍스트에서 완료 텍스트를 제거하거나, 로컬라이즈 키에서 가져오기
                const originalText = currentText || game.i18n.localize('DX3rd.DamageRoll');
                button.textContent = `${originalText} ${completeText}`;
            }
        }
    }
    
    // damage-apply-btn 완료 상태 복원
    const damageApplyCompleted = message.getFlag('dx3rd-emanim', 'damageApplyCompleted');
    if (damageApplyCompleted === true) {
        const button = html.querySelector('.damage-apply-btn');
        if (button) {
            const currentText = button.textContent.trim();
            if (!currentText.includes(completeText)) {
                // 원본 텍스트는 버튼의 현재 텍스트에서 완료 텍스트를 제거하거나, 로컬라이즈 키에서 가져오기
                const originalText = currentText || game.i18n.localize('DX3rd.DamageApply');
                button.textContent = `${originalText} ${completeText}`;
            }
        }
    }
    
    // attack-roll-btn 완료 상태 복원
    const attackRollCompleted = message.getFlag('dx3rd-emanim', 'attackRollCompleted');
    if (attackRollCompleted === true) {
        const button = html.querySelector('.attack-roll-btn');
        if (button) {
            const currentText = button.textContent.trim();
            if (!currentText.includes(completeText)) {
                // 원본 텍스트는 버튼의 현재 텍스트에서 완료 텍스트를 제거하거나, 로컬라이즈 키에서 가져오기
                const originalText = currentText || game.i18n.localize('DX3rd.AttackRoll');
                button.textContent = `${originalText} ${completeText}`;
            }
        }
    }
    
    // dx3rd-success-btn 완료 상태 복원
    const successCompleted = message.getFlag('dx3rd-emanim', 'successCompleted');
    if (successCompleted === true) {
        const button = html.querySelector('.dx3rd-success-btn');
        if (button) {
            const currentText = button.textContent.trim();
            if (!currentText.includes(completeText)) {
                // 원본 텍스트는 버튼의 현재 텍스트에서 완료 텍스트를 제거
                const originalText = currentText || game.i18n.localize('DX3rd.Success');
                button.textContent = `${originalText} ${completeText}`;
            }
        }
    }
    
    // dx3rd-win-check-btn 완료 상태 복원
    const winCheckCompleted = message.getFlag('dx3rd-emanim', 'winCheckCompleted');
    if (winCheckCompleted === true) {
        const button = html.querySelector('.dx3rd-win-check-btn');
        if (button) {
            const currentText = button.textContent.trim();
            if (!currentText.includes(completeText)) {
                // 원본 텍스트는 버튼의 현재 텍스트에서 완료 텍스트를 제거하거나, 현재 텍스트 사용
                const originalText = currentText || game.i18n.localize('DX3rd.WinCheck');
                button.textContent = `${originalText} ${completeText}`;
            }
        }
    }
    
    // use-item-btn 완료 상태 복원 (아이템별로 관리)
    const itemUseCompleted = message.getFlag('dx3rd-emanim', 'itemUseCompleted') || {};
    if (Object.keys(itemUseCompleted).length > 0) {
        const allUseButtons = html.querySelectorAll('.use-item-btn');
        allUseButtons.forEach((button) => {
            const itemId = button.getAttribute('data-item-id');
            if (!itemId) return;
            
            const isCompleted = itemUseCompleted[itemId] === true;
            if (isCompleted) {
                const currentText = button.textContent.trim();
                if (!currentText.includes(completeText)) {
                    // 원본 텍스트는 버튼의 현재 텍스트에서 완료 텍스트를 제거하거나, 현재 텍스트 사용
                    const originalText = currentText || game.i18n.localize('DX3rd.Use');
                    button.textContent = `${originalText} ${completeText}`;
                }
            }
        });
    }

    // protect 장비 해제 버튼
    const unequipBtns = html.querySelectorAll('.protect-unequip-btn');
    unequipBtns.forEach(btn => {
        btn.addEventListener('click', async (e) => {
            e.preventDefault();
            const actorId = btn.getAttribute('data-actor-id');
            const itemId  = btn.getAttribute('data-item-id');
            if (!actorId || !itemId) return;

            const unequipped = await window.DX3rdProtectHandler?.handleUnequip(actorId, itemId);
            if (unequipped) {
                btn.textContent = game.i18n.localize('DX3rd.Unequipped');
                btn.disabled = true;
            }
        });
    });
});

/**
 * 플레이어 클라이언트에서 HP 데미지 익스텐션을 GM에게 넘긴다.
 * 조건부 공식이 걸려 있으면 본인 화면에서 먼저 입력을 받아 확정하고, 취소하면 전송하지 않는다.
 * DX3rdChatToggleManager 의 두 경로(afterSuccess / afterDamage)가 같은 절차를 복제하고
 * 있어 여기로 모았다 — 한쪽만 고쳐 어긋나는 것을 막는 것이 목적이다.
 *
 * 원본 두 곳은 handler 유무 검사만 달랐다(`handler.` vs `h?.`). 더 안전한 옵셔널 체이닝
 * 쪽으로 통일했으므로, 핸들러가 없는 비정상 상태에서 예외 대신 그대로 전송된다.
 */
async function _dx3rdEmitDamageRequestAsPlayer(actor, item, damageData) {
    const handler = window.DX3rdUniversalHandler;
    let payload = damageData;

    if (payload.conditionalFormula && handler?.promptConditionalDamageFormula) {
        const customFormula = await handler.promptConditionalDamageFormula();
        if (!customFormula) {
            ui.notifications.warn('조건부 공식 입력이 취소되어 HP 데미지 익스텐션을 건너뜁니다.');
            return;
        }
        payload = {
            ...payload,
            formulaDice: customFormula.dice,
            formulaAdd: customFormula.add,
            conditionalFormula: false
        };
    }

    window.DX3rdSocketRouter.emit({
        type: 'damageRequest',
        requestData: {
            actorId: actor.id,
            damageData: payload,
            itemId: item.id
        }
    });
}

// 채팅 토글 매니저
window.DX3rdChatToggleManager = {
    initialized: false,
    
    initialize() {
        if (this.initialized) return;
        this.initialized = true;
        
        // 전역 이벤트 위임 등록
        dx3rdRegisterGlobalListener('dx3rd-global-toggle', 'click', (event) => {
            const target = event.target.closest('.item-name-toggle, .combo-toggle-btn, .book-toggle-btn');
            if (!target) return;
            event.preventDefault();
            event.stopPropagation();

            // Foundry VTT 채팅 메시지 구조 확인
            const messageElement = target.closest('.message');

            // 클릭된 요소에 따라 다른 처리
            if (target.classList.contains('combo-toggle-btn')) {
                // 콤보 토글 버튼의 경우, 다이얼로그 표시
                const section = target.dataset.comboSection;
                if (window.DX3rdChatHandlers && window.DX3rdChatHandlers.showComboItemsDialog) {
                    window.DX3rdChatHandlers.showComboItemsDialog(messageElement, section);
                }
                return;
            } else if (target.classList.contains('book-toggle-btn')) {
                // 마도서 토글 버튼의 경우, 다이얼로그 표시
                const section = target.dataset.bookSection;
                if (window.DX3rdChatHandlers && window.DX3rdChatHandlers.showBookItemsDialog) {
                    window.DX3rdChatHandlers.showBookItemsDialog(messageElement, section);
                }
                return;
            }

            // 아이템 이름 토글의 경우, 모든 collapsible-content 토글
            const collapsibleElements = messageElement
                ? Array.from(messageElement.querySelectorAll('.collapsible-content'))
                : [];
            if (collapsibleElements.length === 0) return;

            for (const el of collapsibleElements) {
                // 애니메이션 중복 방지는 dx3rdSlideToggle 내부에서 처리
                dx3rdSlideToggle(el, el.classList.contains('collapsed'));
            }
        });
        
        // 기존 채팅 메시지 초기화
        if (window.DX3rdChatHandlers && window.DX3rdChatHandlers.initializeExistingMessages) {
            window.DX3rdChatHandlers.initializeExistingMessages();
        }
        
        // 술식 발동 버튼 클릭 리스너 등록
        dx3rdRegisterGlobalListener('dx3rd-invoke-spell', 'click', async (event) => {
            const button = event.target.closest('.invoke-spell');
            if (!button) return;
            event.preventDefault();
            event.stopPropagation();

            // getTarget 정보 읽기 (data 속성에서)
            const getTargetAttr = button.dataset.getTarget;
            const getTarget = getTargetAttr === true || getTargetAttr === 'true';
            
            // getTarget이 체크되어 있으면 타겟 확인
            if (getTarget) {
                const targets = Array.from(game.user.targets);
                if (targets.length === 0) {
                    ui.notifications.warn(game.i18n.localize('DX3rd.SelectTarget'));
                    return;
                }
            }
            
            // 메시지 찾기
            const messageElement = button.closest('.message');
            const messageId = messageElement?.dataset?.messageId;
            const message = game.messages.get(messageId);

            if (!message) {
                ui.notifications.error('메시지를 찾을 수 없습니다.');
                return;
            }

            const isCompleted = message.getFlag('dx3rd-emanim', 'invokeCompleted') === true;

            // 원본 텍스트 저장 (처음 한 번만)
            if (!button.dataset.originalText) {
                button.dataset.originalText = button.textContent.trim();
            }

            // 이미 완료된 버튼을 클릭한 경우 롤백
            if (isCompleted) {
                await message.unsetFlag('dx3rd-emanim', 'invokeCompleted');
                return;
            }

            const actorId = button.dataset.actorId;
            const itemId = button.dataset.itemId;
            const itemDataStr = button.getAttribute('data-item-data');
            
            if (!actorId) {
                ui.notifications.error('액터 정보를 찾을 수 없습니다.');
                return;
            }
            
            const actor = game.actors.get(actorId);
            if (!actor) {
                ui.notifications.error('액터를 찾을 수 없습니다.');
                return;
            }
            
            // 권한 체크
            if (!actor.isOwner && !game.user.isGM) {
                console.warn('DX3rd | User lacks permission to use this actor\'s actions');
                return;
            }
            
            // 저장된 아이템 데이터 파싱
            let itemData = null;
            if (itemDataStr) {
                try {
                    itemData = JSON.parse(itemDataStr);
                } catch (e) {
                    console.error('DX3rd | Failed to parse item data:', e);
                }
            }
            
            // 아이템 데이터가 없으면 실제 아이템에서 가져오기
            if (!itemData && itemId) {
                const item = actor.items.get(itemId);
                if (item) {
                    itemData = {
                        id: item.id,
                        name: item.name,
                        img: item.img,
                        macro: item.system.macro,
                        getTarget: item.system.getTarget,
                        effect: {
                            disable: item.system.effect?.disable || '-',
                            attributes: item.system.effect?.attributes || {}
                        }
                    };
                }
            }
            
            if (!itemData) {
                ui.notifications.error('아이템 정보를 찾을 수 없습니다.');
                return;
            }
            
            // 실제 아이템 가져오기 (최신 상태)
            const item = actor.items.get(itemId);
            if (!item) {
                ui.notifications.error('아이템을 찾을 수 없습니다.');
                return;
            }
            
            const handler = window.DX3rdUniversalHandler;
            if (handler) {
                // active.runTiming이 'afterSuccess'인 경우 활성화 (disable이 'notCheck'가 아닌 경우에만)
                const activeDisable = item.system?.active?.disable ?? '-';
                if (item.system.active?.runTiming === 'afterSuccess' && !item.system.active?.state && activeDisable !== 'notCheck') {
                    await item.update({ 'system.active.state': true });
                    console.log("DX3rd | Spell invoke - Active checked (afterSuccess timing)");
                }
                
                // 'afterSuccess' 매크로 실행 (50ms 딜레이)
                await new Promise(resolve => setTimeout(resolve, 50));
                await handler.executeMacros(item, 'afterSuccess');
                
                // 'afterSuccess' 타겟 효과 적용
                await handler.applyToTargets(actor, item, 'afterSuccess');
                
                // afterSuccess 타이밍 heal/damage/condition 익스텐션을 handleSuccessButton과 동일하게 처리
                const itemExtend = item.getFlag('dx3rd-emanim', 'itemExtend') || {};
                const selectedTargetIds = Array.from(game.user.targets).map(t => t.id);
                
                // heal afterSuccess
                if (itemExtend.heal?.activate && itemExtend.heal?.timing === 'afterSuccess') {
                    const healDataWithTargets = {
                        ...itemExtend.heal,
                        selectedTargetIds,
                        triggerItemName: item.name,
                        triggerItemId: item.id
                    };
                    
                    // GM이면 직접 처리만 (소켓 전송 안 함)
                    if (game.user.isGM) {
                        await handler.handleHealRequest({
                            actorId: actor.id,
                            healData: healDataWithTargets,
                            itemId: item.id
                        });
                    } else {
                        // 플레이어면 소켓 전송만
                        window.DX3rdSocketRouter.emit({
                            type: 'healRequest',
                            requestData: {
                                actorId: actor.id,
                                healData: healDataWithTargets,
                                itemId: item.id
                            }
                        });
                    }
                }
                
                // damage afterSuccess
                if (itemExtend.damage?.activate && itemExtend.damage?.timing === 'afterSuccess') {
                    let damageDataWithTargets = {
                        ...itemExtend.damage,
                        selectedTargetIds,
                        triggerItemName: item.name,
                        triggerItemId: item.id
                    };
                    
                    // GM이면 직접 처리만 (소켓 전송 안 함)
                    if (game.user.isGM) {
                        await handler.handleDamageRequest({
                            actorId: actor.id,
                            damageData: damageDataWithTargets,
                            itemId: item.id
                        });
                    } else {
                        // 플레이어: 조건부 공식 입력은 본인 클라이언트에서만 → 확정 후 GM 소켓 처리
                        await _dx3rdEmitDamageRequestAsPlayer(actor, item, damageDataWithTargets);
                    }
                }
                
                // condition afterSuccess (conditions 배열 또는 기존 단일 형식)
                const condEntries = handler._getConditionEntries?.(itemExtend.condition || {}) || [];
                const afterSuccessConds = condEntries.filter(c => c.timing === 'afterSuccess');
                for (const c of afterSuccessConds) {
                    const conditionDataWithTargets = {
                        ...c,
                        selectedTargetIds,
                        triggerItemName: item.name,
                        triggerItemId: item.id
                    };
                    await handler.executeConditionExtensionNow(actor, conditionDataWithTargets, item);
                }

                const cardEntries = (window.DX3rdItemEffectAdapter?.extensionEntries?.(itemExtend) || [])
                    .filter(entry => !entry.legacy && entry.data?.activate && entry.data?.timing === 'afterSuccess'
                        && window.DX3rdItemEffectAdapter.extensionActionMatches(item, entry.type, entry.data, null, 'afterSuccess'));
                for (const entry of cardEntries) {
                    await handler.executeItemExtension(actor, entry.type, {
                        ...entry.data, selectedTargetIds, triggerItemName: item.name, triggerItemId: item.id
                    }, item);
                }
                
                // runTiming이 afterSuccess인 경우, afterMain 익스텐드를 큐에 등록
                if (item.system.active?.runTiming === 'afterSuccess') {
                    await handler.registerAfterMainExtensions(actor, item, itemExtend);
                }
                
                console.log('DX3rd | Spell invoke - processed afterSuccess timing extensions');
            }
            
            // 발동 시 메이저 비활성화 훅 실행
            if (window.DX3rdDisableHooks) {
                await window.DX3rdDisableHooks.executeDisableHook('major', actor);
            }
            
            // 플래그 설정 (메시지에 저장)
            await message.setFlag('dx3rd-emanim', 'invokeCompleted', true);
            
            // 버튼 완료 상태로 표시
            button.textContent = `${itemData.name} ${game.i18n.localize('DX3rd.Invoking')} ${game.i18n.localize('DX3rd.Complete')}`;
            
            // 채팅 메시지 출력 (굴림이 있는 경우는 굴림 실행 시 이미 메시지가 생성되므로 여기서는 생성하지 않음)
            const rollType = item.system?.roll ?? '-';
            if (rollType !== 'CastingRoll') {
                const chatContent = `${item.name} ${game.i18n.localize('DX3rd.Invoking')}`;
                const invokeSpeaker = window.DX3rdRuntimeUtils.getActorOnlySpeaker(actor);
                await ChatMessage.create({
                    content: chatContent,
                    speaker: invokeSpeaker
                });
            }
        });
        
        // 마술 폭주 버튼 클릭 리스너 등록
        dx3rdRegisterGlobalListener('dx3rd-spell-overflow', 'click', async (event) => {
            const button = event.target.closest('.spell-overflow');
            if (!button) return;
            event.preventDefault();
            event.stopPropagation();

            const actorId = button.dataset.actorId;
            const itemId = button.dataset.itemId;
            const disasterType = button.dataset.disasterType;
            const overflowCount = Number(button.dataset.overflowCount);
            
            if (!actorId) {
                ui.notifications.error('액터 정보를 찾을 수 없습니다.');
                return;
            }
            
            const actor = game.actors.get(actorId);
            if (!actor) {
                ui.notifications.error('액터를 찾을 수 없습니다.');
                return;
            }
            
            // 권한 체크
            if (!actor.isOwner && !game.user.isGM) {
                console.warn('DX3rd | User lacks permission to use this actor\'s actions');
                return;
            }
            
            // 아이템 가져오기 (선택사항)
            const item = itemId ? actor.items.get(itemId) : null;
            
            // SpellHandler의 handleDisasterButton 호출
            if (window.DX3rdSpellHandler) {
                await window.DX3rdSpellHandler.handleDisasterButton(actor, item, disasterType, overflowCount);
            } else {
                ui.notifications.error('SpellHandler를 찾을 수 없습니다.');
            }
        });
        
        // 데미지 롤 버튼 클릭 리스너 등록
        dx3rdRegisterGlobalListener('dx3rd-damage-roll', 'click', async (event) => {
            const button = event.target.closest('.damage-roll-btn');
            if (!button) return;
            event.preventDefault();
            event.stopPropagation();

            const messageElement = button.closest('.message');
            const messageId = messageElement?.dataset?.messageId;
            const message = game.messages.get(messageId);

            if (!message) {
                ui.notifications.error('메시지를 찾을 수 없습니다.');
                return;
            }

            const isCompleted = message.getFlag('dx3rd-emanim', 'damageRollCompleted') === true;

            // 원본 텍스트 저장 (처음 한 번만)
            if (!button.dataset.originalText) {
                button.dataset.originalText = button.textContent;
            }

            // 이미 완료된 버튼을 클릭한 경우 롤백
            if (isCompleted) {
                await message.unsetFlag('dx3rd-emanim', 'damageRollCompleted');
                return;
            }

            const actorId = button.dataset.actorId;
            const itemId = button.dataset.itemId;
            const rollResult = dx3rdReadData(button, 'roll-result');

            // 콤보 afterSuccess 데이터 확인
            const comboAfterSuccess = message.getFlag('dx3rd-emanim', 'comboAfterSuccess');

            // 개별 보존된 값들 읽기
            const preservedActorAttack = dx3rdReadData(button, 'preserved-actor-attack');
            const preservedActorDamageRoll = dx3rdReadData(button, 'preserved-actor-damage-roll');
            const preservedActorPenetrate = dx3rdReadData(button, 'preserved-actor-penetrate');
            const preservedWeaponAttack = dx3rdReadData(button, 'preserved-weapon-attack');
            const weaponIdsJson = dx3rdReadData(button, 'weapon-ids');
            // 속성이 없을 때만 null로 남겨 구형 카드의 숫자 보존값(weaponAttack) 폴백을 살린다.
            const preservedAttackFormula = dx3rdReadEncodedFormula(button, 'preserved-attack-formula') || null;
            const preservedActorAttackFormula = dx3rdReadEncodedFormula(button, 'preserved-actor-attack-formula');
            const preservedActorDamageRollFormula = dx3rdReadEncodedFormula(button, 'preserved-actor-damage-roll-formula');

            if (!actorId || !itemId) return;
            
            const actor = game.actors.get(actorId);
            // 임시 콤보 확인
            let item = null;
            if (itemId) {
                // 먼저 채팅 메시지에 임시 콤보 데이터가 있는지 확인
                const tempComboItem = message.getFlag('dx3rd-emanim', 'tempComboItem');
                if (tempComboItem && tempComboItem.id === itemId) {
                    item = tempComboItem;
                    // 임시 콤보 객체에 필요한 메서드들 복원
                    if (!item.getFlag) {
                        item.getFlag = () => null;
                        item.setFlag = () => {};
                        item.unsetFlag = () => {};
                    }
                } else {
                    // 일반 아이템
                    item = actor.items.get(itemId);
                }
            }
            
            if (!actor || !item) return;
            
            // 권한 체크
            if (!actor.isOwner && !game.user.isGM) {
                console.warn('DX3rd | User lacks permission to use this actor\'s actions');
                return;
            }
            
            // 액터의 토큰 자동 선택
            const previousToken = canvas.tokens?.controlled?.[0] || null;
            const actorToken = canvas.tokens?.placeables.find(t => t.actor?.id === actor.id);
            if (actorToken) {
                actorToken.control({ releaseOthers: true });
            }
            
            // 보존된 값들 객체 생성
            const preservedValues = {
                actorAttack: preservedActorAttack || 0,
                actorAttackFormula: preservedActorAttackFormula,
                actorDamageRoll: preservedActorDamageRoll || 0,
                actorDamageRollFormula: preservedActorDamageRollFormula,
                actorPenetrate: preservedActorPenetrate || 0,
                // 이전 채팅 카드는 숫자 보존값을 계속 지원한다.
                weaponAttack: preservedWeaponAttack || 0,
                weaponAttackFormula: preservedAttackFormula
            };
            
            // 사용된 무기들의 attack-used.state 증가 (이펙트/콤보/사이오닉에서 무기 사용한 경우)
            if (weaponIdsJson && typeof weaponIdsJson === 'string' && weaponIdsJson.trim() !== '') {
                const weaponIds = weaponIdsJson.split(',').filter(id => id.trim() !== '');
                if (weaponIds.length > 0) {
                    for (const weaponId of weaponIds) {
                        const weaponItem = actor.items.get(weaponId.trim());
                        // weapon 타입만 attack-used 증가 (vehicle은 attack-used 필드 없음)
                        if (weaponItem && weaponItem.type === 'weapon') {
                            const attackUsedDisable = weaponItem.system['attack-used']?.disable || 'notCheck';
                            if (attackUsedDisable !== 'notCheck') {
                                const currentState = weaponItem.system['attack-used']?.state || 0;
                                await weaponItem.update({ 'system.attack-used.state': currentState + 1 });
                            }
                        }
                    }
                }
            }
            
            // 콤보 afterSuccess 처리 확인
            if (comboAfterSuccess && window.DX3rdUniversalHandler) {
                // 콤보의 병합된 afterSuccess 처리
                await window.DX3rdUniversalHandler.processComboAfterSuccess(comboAfterSuccess);
            }
            
            // 단일 아이템 afterSuccess 처리 (콤보가 아닌 경우만)
            if (!comboAfterSuccess) {
                // 성공 시(afterSuccess) 매크로 실행 (조건 없이 항상 실행)
                if (window.DX3rdUniversalHandler && window.DX3rdUniversalHandler.executeMacros) {
                    await window.DX3rdUniversalHandler.executeMacros(item, 'afterSuccess');
                }
                
                // 성공 시(afterSuccess) 활성화 및 대상 적용 (횟수 체크)
                const activeDisable = item.system?.active?.disable ?? '-';
                const shouldActivate = item.system.active?.runTiming === 'afterSuccess' && !item.system.active?.state && activeDisable !== 'notCheck';
                const shouldApplyToTargets = item.system.effect?.runTiming === 'afterSuccess';
            
                if (shouldActivate || shouldApplyToTargets) {
                    const usedDisable = item.system?.used?.disable || 'notCheck';
                    const usedState = item.system?.used?.state || 0;
                    const usedMax = item.system?.used?.max || 0;
                    
                    // 무기/비클은 다이얼로그 표시, 나머지는 자동 처리
                    if (item.type === 'weapon' || item.type === 'vehicle') {
                        // 횟수 제한 확인 후 다이얼로그 표시
                        if (usedDisable === 'notCheck' || usedState < usedMax) {
                            if (window.DX3rdChatHandlers && window.DX3rdChatHandlers.showAfterSuccessDialog) {
                                await window.DX3rdChatHandlers.showAfterSuccessDialog(actor, item, shouldActivate, shouldApplyToTargets);
                            }
                        }
                        // usedState >= usedMax인 경우 아무것도 안 함 (이미 소진)
                    } else {
                        // 무기/비클이 아닌 경우: 활성화 + 대상 적용 (횟수 증가는 사용 시점에 이미 처리됨)
                        const updates = {};
                        
                        // 1. 활성화
                        if (shouldActivate) {
                            updates['system.active.state'] = true;
                        }
                        
                        if (Object.keys(updates).length > 0) {
                            await item.update(updates);
                        }
                        
                        // 2. 대상 적용
                        if (shouldApplyToTargets && window.DX3rdUniversalHandler) {
                            await window.DX3rdUniversalHandler.applyToTargets(actor, item, 'afterSuccess');
                        }
                    }
                }
            }
            
            // comboAfterDamage 데이터 읽기 (데미지 적용 버튼에 전달)
            const comboAfterDamageData = message.getFlag('dx3rd-emanim', 'comboAfterDamage');
            
            // UniversalHandler의 데미지 롤 함수 호출 (롤 결과와 보존된 값들 포함)
            if (window.DX3rdUniversalHandler && window.DX3rdUniversalHandler.handleDamageRoll) {
                await window.DX3rdUniversalHandler.handleDamageRoll(actor, item, rollResult, preservedValues, comboAfterDamageData);
            }
            
            // afterSuccess 타이밍 heal/damage/condition 익스텐션을 GM을 통해 처리
            // 콤보의 경우 이미 processComboAfterSuccess에서 병합 처리되었으므로 건너뜀
            if (item && !comboAfterSuccess) {
                const itemExtend = item.getFlag('dx3rd-emanim', 'itemExtend') || {};
                const selectedTargetIds = Array.from(game.user.targets).map(t => t.id);
                
                // heal afterSuccess
                if (itemExtend.heal?.activate && itemExtend.heal?.timing === 'afterSuccess') {
                    const healDataWithTargets = {
                        ...itemExtend.heal,
                        selectedTargetIds,
                        triggerItemName: item.name,
                        triggerItemId: item.id
                    };
                    
                    // GM이면 직접 처리만 (소켓 전송 안 함)
                    if (game.user.isGM && window.DX3rdUniversalHandler) {
                        await window.DX3rdUniversalHandler.handleHealRequest({
                            actorId: actor.id,
                            healData: healDataWithTargets,
                            itemId: item.id
                        });
                    } else {
                        // 플레이어면 소켓 전송만
                        window.DX3rdSocketRouter.emit({
                            type: 'healRequest',
                            requestData: {
                                actorId: actor.id,
                                healData: healDataWithTargets,
                                itemId: item.id
                            }
                        });
                    }
                }
                
                // damage afterSuccess
                if (itemExtend.damage?.activate && itemExtend.damage?.timing === 'afterSuccess') {
                    let damageDataWithTargets = {
                        ...itemExtend.damage,
                        selectedTargetIds,
                        triggerItemName: item.name,
                        triggerItemId: item.id
                    };
                    
                    // GM이면 직접 처리만 (소켓 전송 안 함)
                    if (game.user.isGM && window.DX3rdUniversalHandler) {
                        await window.DX3rdUniversalHandler.handleDamageRequest({
                            actorId: actor.id,
                            damageData: damageDataWithTargets,
                            itemId: item.id
                        });
                    } else {
                        // 플레이어: 조건부 공식 입력은 본인 클라이언트에서만 → 확정 후 GM 소켓 처리
                        await _dx3rdEmitDamageRequestAsPlayer(actor, item, damageDataWithTargets);
                    }
                }
                
                // condition afterSuccess (conditions 배열 또는 기존 단일 형식)
                const condEntries = window.DX3rdUniversalHandler?._getConditionEntries?.(itemExtend.condition || {}) || [];
                const afterSuccessConds = condEntries.filter(c => c.timing === 'afterSuccess');
                for (const c of afterSuccessConds) {
                    const conditionDataWithTargets = {
                        ...c,
                        selectedTargetIds,
                        triggerItemName: item.name,
                        triggerItemId: item.id
                    };
                    if (window.DX3rdUniversalHandler) {
                        await window.DX3rdUniversalHandler.executeConditionExtensionNow(actor, conditionDataWithTargets, item);
                    }
                }

                const cardEntries = (window.DX3rdItemEffectAdapter?.extensionEntries?.(itemExtend) || [])
                    .filter(entry => !entry.legacy && entry.data?.activate && entry.data?.timing === 'afterSuccess'
                        && window.DX3rdItemEffectAdapter.extensionActionMatches(item, entry.type, entry.data, null, 'afterSuccess'));
                for (const entry of cardEntries) {
                    await window.DX3rdUniversalHandler.executeItemExtension(actor, entry.type, {
                        ...entry.data, selectedTargetIds, triggerItemName: item.name, triggerItemId: item.id
                    }, item);
                }
                
                // runTiming이 afterSuccess인 경우, afterMain 익스텐드를 큐에 등록
                if (item.system.active?.runTiming === 'afterSuccess' && window.DX3rdUniversalHandler) {
                    await window.DX3rdUniversalHandler.registerAfterMainExtensions(actor, item, itemExtend);
                }
            }
            
            // 플래그 설정 (updateChatMessage 훅에서 버튼 텍스트 업데이트)
            await message.setFlag('dx3rd-emanim', 'damageRollCompleted', true);
            
            // 이전 토큰 복원
            if (previousToken && canvas.tokens) {
                previousToken.control({ releaseOthers: true });
            }
        });
        
        // 성공 버튼 클릭 리스너 등록
        dx3rdRegisterGlobalListener('dx3rd-success', 'click', async (event) => {
            const button = event.target.closest('.dx3rd-success-btn');
            if (!button) return;
            event.preventDefault();
            event.stopPropagation();

            const messageElement = button.closest('.message');
            const messageId = messageElement?.dataset?.messageId;
            const message = game.messages.get(messageId);

            if (!message) {
                ui.notifications.error('메시지를 찾을 수 없습니다.');
                return;
            }

            const isCompleted = message.getFlag('dx3rd-emanim', 'successCompleted') === true;

            // 원본 텍스트 저장 (처음 한 번만)
            if (!button.dataset.originalText) {
                button.dataset.originalText = button.textContent.trim();
            }

            // 이미 완료된 버튼을 클릭한 경우 롤백
            if (isCompleted) {
                await message.unsetFlag('dx3rd-emanim', 'successCompleted');
                return;
            }

            const actorId = button.dataset.actorId;
            const itemId = button.dataset.itemId;
            const previousTokenId = button.dataset.previousTokenId;
            const weaponAttack = parseInt(button.dataset.weaponAttack) || 0;

            // UniversalHandler로 처리 (무기 공격력 전달)
            try {
                if (window.DX3rdUniversalHandler) {
                    await window.DX3rdUniversalHandler.handleSuccessButton(actorId, itemId, previousTokenId, weaponAttack);
                }
            } catch (e) {
                console.error('DX3rd | handleSuccessButton error:', e);
                // 에러가 발생해도 완료 처리는 진행
            }

            // 플래그 설정 (updateChatMessage 훅에서 버튼 텍스트 업데이트)
            await message.setFlag('dx3rd-emanim', 'successCompleted', true);

            // 버튼 텍스트 즉시 업데이트 (다른 클라이언트는 updateChatMessage 훅에서 처리)
            dx3rdApplyCompleteText(button, true, game.i18n.localize('DX3rd.Complete'));
        });
        
        // 승리 체크 버튼 클릭 리스너 등록
        dx3rdRegisterGlobalListener('dx3rd-win-check', 'click', async (event) => {
            const button = event.target.closest('.dx3rd-win-check-btn');
            if (!button) return;
            event.preventDefault();
            event.stopPropagation();

            const messageElement = button.closest('.message');
            const messageId = messageElement?.dataset?.messageId;
            const message = game.messages.get(messageId);

            if (!message) {
                ui.notifications.error('메시지를 찾을 수 없습니다.');
                return;
            }

            const isCompleted = message.getFlag('dx3rd-emanim', 'winCheckCompleted') === true;

            // 원본 텍스트 저장 (처음 한 번만)
            if (!button.dataset.originalText) {
                button.dataset.originalText = button.textContent;
            }

            // 이미 완료된 버튼을 클릭한 경우 롤백
            if (isCompleted) {
                await message.unsetFlag('dx3rd-emanim', 'winCheckCompleted');
                button.textContent = button.dataset.originalText;
                return;
            }

            const actorId = button.dataset.actorId;
            const itemId = button.dataset.itemId;
            const previousTokenId = button.dataset.previousTokenId;
            
            // 콤보 afterSuccess 데이터 확인
            const comboAfterSuccess = message.getFlag('dx3rd-emanim', 'comboAfterSuccess');
            
            // UniversalHandler로 처리
            if (window.DX3rdUniversalHandler) {
                if (comboAfterSuccess) {
                    // 콤보의 병합된 afterSuccess 처리
                    await window.DX3rdUniversalHandler.processComboAfterSuccess(comboAfterSuccess);
                } else {
                    // 단일 아이템 afterSuccess 처리 (기존)
                    await window.DX3rdUniversalHandler.handleSuccessButton(actorId, itemId, previousTokenId);
                }
            }
            
            // 플래그 설정 및 버튼 텍스트 변경
            await message.setFlag('dx3rd-emanim', 'winCheckCompleted', true);

            // 버튼 텍스트 즉시 업데이트 (다른 클라이언트는 updateChatMessage 훅에서 처리)
            dx3rdApplyCompleteText(button, true, game.i18n.localize('DX3rd.Complete'));
        });
        
        // 데미지 적용 버튼 클릭 리스너 등록
        dx3rdRegisterGlobalListener('dx3rd-damage-apply', 'click', async (event) => {
            const button = event.target.closest('.damage-apply-btn');
            if (!button) return;
            event.preventDefault();
            event.stopPropagation();

            const messageElement = button.closest('.message');
            const messageId = messageElement?.dataset?.messageId;
            const message = game.messages.get(messageId);

            if (!message) {
                ui.notifications.error('메시지를 찾을 수 없습니다.');
                return;
            }

            const isCompleted = message.getFlag('dx3rd-emanim', 'damageApplyCompleted') === true;

            // 원본 텍스트 저장 (처음 한 번만)
            if (!button.dataset.originalText) {
                button.dataset.originalText = button.textContent;
            }

            // 이미 완료된 버튼을 클릭한 경우 롤백
            if (isCompleted) {
                await message.unsetFlag('dx3rd-emanim', 'damageApplyCompleted');
                return;
            }

            const actorId = button.dataset.actorId;
            const itemId = button.dataset.itemId;
            const damage = dx3rdReadData(button, 'damage');
            const penetrate = dx3rdReadData(button, 'penetrate');
            const attackResult = Number(button.dataset.attackResult) || 0;
            
            // 권한 체크
            const actor = game.actors.get(actorId);
            if (!actor) {
                console.warn('DX3rd | Actor not found:', actorId);
                return;
            }
            
            if (!actor.isOwner && !game.user.isGM) {
                console.warn('DX3rd | User lacks permission to use this actor\'s actions');
                return;
            }
            
            // 액터의 토큰 자동 선택
            const previousToken = canvas.tokens?.controlled?.[0] || null;
            const actorToken = canvas.tokens?.placeables.find(t => t.actor?.id === actor.id);
            if (actorToken) {
                actorToken.control({ releaseOthers: true });
            }
            
            // 아이템 가져오기 (임시 콤보 확인)
            let item = null;
            if (itemId) {
                // 먼저 채팅 메시지에 임시 콤보 데이터가 있는지 확인
                const tempComboItem = message.getFlag('dx3rd-emanim', 'tempComboItem');
                if (tempComboItem && tempComboItem.id === itemId) {
                    item = tempComboItem;
                    // 임시 콤보 객체에 필요한 메서드들 복원
                    if (!item.getFlag) {
                        item.getFlag = () => null;
                        item.setFlag = () => {};
                        item.unsetFlag = () => {};
                    }
                } else {
                    // 일반 아이템
                    item = actor.items.get(itemId);
                }
            }
            
            // 타겟 체크
            const targets = Array.from(game.user.targets);
            if (targets.length === 0) {
                ui.notifications.warn(game.i18n.localize('DX3rd.SelectTarget'));
                // 이전 토큰 복원
                if (previousToken && canvas.tokens) {
                    previousToken.control({ releaseOthers: true });
                }
                return;
            }
            
            // Hatred 상태이상 체크 (타겟에 hatred.target이 포함되어야 함)
            const hatredActive = actor.system?.conditions?.hatred?.active || false;
            const hatredTarget = actor.system?.conditions?.hatred?.target || '';
            
            if (hatredActive && hatredTarget) {
              // 현재 타겟 중에 hatred.target이 있는지 확인
              const hasHatredTarget = targets.some(t => {
                const targetName = t.actor?.name || t.name;
                return targetName === hatredTarget;
              });
              
              if (!hasHatredTarget) {
                // 에러 메시지 출력 (로컬라이즈 키에서 {target} 플레이스홀더 치환)
                const hatredMessage = game.i18n.localize('DX3rd.MustAttackHatredTarget').replace('{target}', hatredTarget);
                const hatredSpeaker = window.DX3rdRuntimeUtils.getActorOnlySpeaker(actor);
                await ChatMessage.create({
                  speaker: hatredSpeaker,
                  content: `<div style="color: #ff6b6b;"><strong>${game.i18n.localize('DX3rd.Hatred')}: ${hatredMessage}</strong></div>`
                });
                
                // 이전 토큰 복원
                if (previousToken && canvas.tokens) {
                  previousToken.control({ releaseOthers: true });
                }
                return;
              }
            }
            
            // 콤보 afterDamage 데이터 가져오기
            const comboAfterDamageData = message.getFlag('dx3rd-emanim', 'comboAfterDamage');
            
            // UniversalHandler의 데미지 적용 함수 호출
            // comboAfterDamageData를 전달하여 방어 다이얼로그 콜백에서 처리
            if (window.DX3rdUniversalHandler && window.DX3rdUniversalHandler.handleDamageApply) {
                await window.DX3rdUniversalHandler.handleDamageApply(actor, item, damage, penetrate, targets, comboAfterDamageData, attackResult);
            }

            // 증오 자동 회복은 명중판정 시점(onAttackRollComplete)으로 이관됨.
            // 룰상 성공 여부와 무관하게 회복되므로, 빗나가 데미지 버튼을 누르지 않는 경우도 커버해야 한다.
            // 위 hatred 대상 강제 체크(3595)는 잘못된 대상에 데미지 적용을 막는 안전망으로 유지.

            // 플래그 설정 (updateChatMessage 훅에서 버튼 텍스트 업데이트)
            await message.setFlag('dx3rd-emanim', 'damageApplyCompleted', true);
            
            // 이전 토큰 복원
            if (previousToken && canvas.tokens) {
                previousToken.control({ releaseOthers: true });
            }
        });
        
        // 공격 롤 버튼 클릭 리스너 등록 (무기/비클 전용)
        dx3rdRegisterGlobalListener('dx3rd-attack-roll', 'click', async (event) => {
            const button = event.target.closest('.attack-roll-btn');
            if (!button) return;
            event.preventDefault();
            event.stopPropagation();

            const itemId = button.dataset.itemId;

            if (!itemId) return;

            // 메시지에서 액터 정보 찾기
            const messageElement = button.closest('.message');
            const messageId = messageElement?.dataset?.messageId;

            if (!messageId) return;

            const message = game.messages.get(messageId);
            if (!message) {
                ui.notifications.error('메시지를 찾을 수 없습니다.');
                return;
            }

            const isCompleted = message.getFlag('dx3rd-emanim', 'attackRollCompleted') === true;

            // 원본 텍스트 저장 (처음 한 번만)
            if (!button.dataset.originalText) {
                button.dataset.originalText = button.textContent;
            }
            
            // 이미 완료된 버튼을 클릭한 경우 롤백
            if (isCompleted) {
                await message.unsetFlag('dx3rd-emanim', 'attackRollCompleted');
                return;
            }
            
            if (!message.speaker || !message.speaker.actor) return;
            
            const actorId = message.speaker.actor;
            const actor = game.actors.get(actorId);
            if (!actor) return;
            
            // 권한 체크
            if (!actor.isOwner && !game.user.isGM) {
                console.warn('DX3rd | User lacks permission to use this actor\'s actions');
                return;
            }
            
            const item = actor.items.get(itemId);
            if (!item) return;
            
            // 공격 버튼: UniversalHandler로 통합 처리
            let attackRollSuccess = false;
            if (window.DX3rdUniversalHandler) {
                attackRollSuccess = await window.DX3rdUniversalHandler.handleAttackRoll(actor, item);
            }
            
            // 성공한 경우에만 플래그 설정
            if (attackRollSuccess) {
                await message.setFlag('dx3rd-emanim', 'attackRollCompleted', true);
            }
        });
        
        // 이펙트 사용 버튼 클릭 리스너 등록
        dx3rdRegisterGlobalListener('dx3rd-use-btn', 'click', async (event) => {
            const button = event.target.closest('.use-item-btn');
            if (!button) return;
            event.preventDefault();
            event.stopPropagation();

            const itemId = button.dataset.itemId;
            const roisAction = button.dataset.roisAction; // 'titus' or 'sublimation'

            if (!itemId) {
                return;
            }

            // 메시지에서 액터 정보 찾기
            const messageElement = button.closest('.message');
            const messageId = messageElement?.dataset?.messageId;
            const message = game.messages.get(messageId);

            if (!message) {
                return;
            }

            // 완료 상태 확인 및 롤백 처리
            const itemUseCompleted = message.getFlag('dx3rd-emanim', 'itemUseCompleted') || {};
            const isCompleted = itemUseCompleted[itemId] === true;

            // 원본 텍스트 저장 (처음 한 번만)
            if (!button.dataset.originalText) {
                button.dataset.originalText = button.textContent.trim();
            }
            
            // 이미 완료된 버튼을 클릭한 경우 롤백
            if (isCompleted) {
                const updatedItemUseCompleted = { ...itemUseCompleted };
                delete updatedItemUseCompleted[itemId];
                
                // 빈 객체가 되면 플래그 제거, 아니면 업데이트
                if (Object.keys(updatedItemUseCompleted).length === 0) {
                    await message.unsetFlag('dx3rd-emanim', 'itemUseCompleted');
                } else {
                    await message.setFlag('dx3rd-emanim', 'itemUseCompleted', updatedItemUseCompleted);
                }
                return;
            }
            
            const speakerElement = messageElement?.querySelector('.message-header .message-sender');
            const actorName = speakerElement?.textContent.trim() || '';
            
            // 액터 ID 찾기 (speaker 데이터에서)
            let actorId = null;
            try {
                if (message && message.speaker && message.speaker.actor) {
                    actorId = message.speaker.actor;
                }
            } catch (e) {
                // 액터 ID 추출 실패 시 무시
            }
            
            // 아이템 정보 찾기
            let itemType = 'unknown';
            
            try {
                if (actorId) {
                    const actor = game.actors.get(actorId);
                    
                    // 권한 체크
                    if (actor && !actor.isOwner && !game.user.isGM) {
                        console.warn('DX3rd | User lacks permission to use this actor\'s actions');
                        return;
                    }
                    if (actor) {
                        const item = actor.items.get(itemId);
                        if (item) {
                            itemType = item.type;
                        }
                    }
                }
            } catch (e) {
                // 아이템 정보 추출 실패 시 무시
            }
            
            // UniversalHandler로 통합 처리 (getTarget은 undefined로 전달하여 아이템에서 읽도록 함)
            let itemUseSuccess = false;
            if (window.DX3rdUniversalHandler && window.DX3rdUniversalHandler.handleItemUse) {
                itemUseSuccess = await window.DX3rdUniversalHandler.handleItemUse(actorId, itemId, itemType, roisAction, undefined);
            }
            
            // 성공한 경우에만 플래그 설정 (updateChatMessage 훅에서 버튼 텍스트 업데이트)
            if (itemUseSuccess) {
                const updatedItemUseCompleted = { ...itemUseCompleted, [itemId]: true };
                await message.setFlag('dx3rd-emanim', 'itemUseCompleted', updatedItemUseCompleted);
            }
        });
        
        // message-sender 클릭 시 로이스 추가 리스너 등록
        dx3rdRegisterGlobalListener('dx3rd-add-lois', 'click', async (event) => {
            const senderElement = event.target.closest('.message-header[data-actor-id] .message-sender');
            if (!senderElement) return;
            event.preventDefault();
            event.stopPropagation();

            const headerElement = senderElement.closest('.message-header');
            const targetActorId = headerElement?.getAttribute('data-actor-id');
            
            if (!targetActorId) {
                return;
            }
            
            // 대상 액터 가져오기
            const targetActor = game.actors.get(targetActorId);
            if (!targetActor) {
                ui.notifications.warn(game.i18n.localize('DX3rd.ActorNotFound'));
                return;
            }
            
            // 현재 액터 가져오기 (선택된 토큰 또는 할당된 액터)
            const controlledToken = canvas?.tokens?.controlled?.[0];
            const currentActor = controlledToken?.actor || game.user?.character;
            
            if (!currentActor) {
                ui.notifications.warn(game.i18n.localize('DX3rd.NoActorSelected'));
                return;
            }
            
            // 권한 체크
            if (!currentActor.isOwner && !game.user.isGM) {
                ui.notifications.warn(game.i18n.localize('DX3rd.NoPermission'));
                return;
            }
            
            // 이미 같은 로이스가 있는지 확인
            const existingLois = currentActor.items.find(item => 
                item.type === 'rois' && item.system?.actor === targetActorId
            );
            
            if (existingLois) {
                ui.notifications.info(game.i18n.localize('DX3rd.LoisAlreadyExists'));
                return;
            }
            
            // S 타입 로이스가 이미 있는지 확인
            const hasSType = currentActor.items.some(item => 
                item.type === 'rois' && item.system?.type === 'S'
            );
            
            // 로이스 추가 다이얼로그 표시
            const dialogContent = `
                <div class="dx3rd-add-lois-dialog">
                    <div class="lois-dialog-field">
                        <div class="lois-dialog-row">
                            <label class="lois-dialog-row-label">
                                ${game.i18n.localize('DX3rd.Type')}
                            </label>
                            <select id="lois-type-select" class="lois-dialog-select" ${hasSType ? 'disabled' : ''}>
                                <option value="-">-</option>
                                ${!hasSType ? '<option value="S">' + game.i18n.localize('DX3rd.Superier') + '</option>' : ''}
                            </select>
                        </div>
                        ${hasSType ? '<p class="lois-dialog-hint">' + game.i18n.localize('DX3rd.STypeAlreadyExists') + '</p>' : ''}
                    </div>
                    
                    <div class="lois-dialog-field">
                        <div class="lois-dialog-row">
                            <label class="lois-dialog-row-label">
                                ${game.i18n.localize('DX3rd.Positive')}
                            </label>
                            <input type="text" id="lois-positive-feeling" class="lois-dialog-input" placeholder="${game.i18n.localize('DX3rd.Feeling')}">
                            <input type="checkbox" id="lois-positive-state" class="lois-dialog-checkbox">
                            <label for="lois-positive-state" class="lois-dialog-checkbox-label"></label>
                        </div>
                    </div>
                    
                    <div class="lois-dialog-field">
                        <div class="lois-dialog-row">
                            <label class="lois-dialog-row-label">
                                ${game.i18n.localize('DX3rd.Negative')}
                            </label>
                            <input type="text" id="lois-negative-feeling" class="lois-dialog-input" placeholder="${game.i18n.localize('DX3rd.Feeling')}">
                            <input type="checkbox" id="lois-negative-state" class="lois-dialog-checkbox">
                            <label for="lois-negative-state" class="lois-dialog-checkbox-label"></label>
                        </div>
                    </div>
                </div>
            `;
            
            const result = await new Promise((resolve) => {
                const dialog = new foundry.applications.api.DialogV2({
                    window: { title: `${game.i18n.format('DX3rd.AddLoisConfirmTitle')}: ${targetActor.name}` },
                    content: dialogContent,
                    buttons: [
                        {
                            action: 'confirm',
                            icon: 'fas fa-check',
                            label: game.i18n.localize('DX3rd.Confirm'),
                            default: true,
                            callback: (event, button, dialog) => {
                                const root = dialog.element;
                                const type = root.querySelector('#lois-type-select')?.value;
                                const positiveState = !!root.querySelector('#lois-positive-state')?.checked;
                                const positiveFeeling = (root.querySelector('#lois-positive-feeling')?.value || '').trim();
                                const negativeState = !!root.querySelector('#lois-negative-state')?.checked;
                                const negativeFeeling = (root.querySelector('#lois-negative-feeling')?.value || '').trim();

                                resolve({
                                    type: hasSType ? '-' : type,
                                    positive: {
                                        state: positiveState,
                                        feeling: positiveFeeling
                                    },
                                    negative: {
                                        state: negativeState,
                                        feeling: negativeFeeling
                                    }
                                });
                            }
                        },
                        {
                            action: 'cancel',
                            icon: 'fas fa-times',
                            label: game.i18n.localize('DX3rd.Cancel'),
                            callback: () => resolve(null)
                        }
                    ],
                    render: (event, dialog) => {
                        // 상호 배타적 체크박스 처리
                        const root = dialog.element;
                        const positiveCheckbox = root.querySelector('#lois-positive-state');
                        const negativeCheckbox = root.querySelector('#lois-negative-state');

                        positiveCheckbox?.addEventListener('change', () => {
                            if (positiveCheckbox.checked && negativeCheckbox) negativeCheckbox.checked = false;
                        });

                        negativeCheckbox?.addEventListener('change', () => {
                            if (negativeCheckbox.checked && positiveCheckbox) positiveCheckbox.checked = false;
                        });
                    }
                });

                dialog.render(true);
            });
            
            if (!result) {
                return;
            }
            
            // 로이스 아이템 생성
            try {
                const loisItemData = {
                    name: targetActor.name,
                    type: 'rois',
                    img: targetActor.img || 'icons/svg/mystery-man.svg',
                    system: {
                        type: result.type,
                        positive: {
                            state: result.positive.state,
                            feeling: result.positive.feeling
                        },
                        negative: {
                            state: result.negative.state,
                            feeling: result.negative.feeling
                        },
                        actor: targetActorId,
                        titus: false,
                        sublimation: false,
                        used: {
                            state: 0,
                            max: 0,
                            level: false,
                            disable: 'notCheck'
                        }
                    }
                };
                
                await currentActor.createEmbeddedDocuments('Item', [loisItemData]);
                
                ui.notifications.info(game.i18n.format('DX3rd.LoisAdded', {
                    actorName: targetActor.name
                }));
            } catch (error) {
                console.error('DX3rd | Failed to add lois:', error);
                ui.notifications.error(game.i18n.localize('DX3rd.LoisAddFailed'));
            }
        });
    }
};

// Chat handler 객체 생성
window.DX3rdChatHandlers = {
    async showAfterSuccessDialog(actor, item, shouldActivate, shouldApplyToTargets) {
        // 커스텀 DOM 다이얼로그 생성
        const dialogDiv = document.createElement("div");
        dialogDiv.className = "after-success-dialog";
        dialogDiv.style.position = "fixed";
        dialogDiv.style.top = "50%";
        dialogDiv.style.left = "50%";
        dialogDiv.style.transform = "translate(-50%, -50%)";
        dialogDiv.style.background = "rgba(0, 0, 0, 0.85)";
        dialogDiv.style.color = "white";
        dialogDiv.style.padding = "20px";
        dialogDiv.style.border = "none";
        dialogDiv.style.borderRadius = "8px";
        dialogDiv.style.zIndex = "9999";
        dialogDiv.style.textAlign = "center";
        dialogDiv.style.fontSize = "16px";
        dialogDiv.style.boxShadow = "0 0 10px black";
        dialogDiv.style.minWidth = "280px";
        dialogDiv.style.cursor = "move";
        
        // 제목
        const title = document.createElement("div");
        title.textContent = `${item.name}`;
        title.style.marginBottom = "16px";
        title.style.fontSize = "1em";
        title.style.fontWeight = "bold";
        title.style.cursor = "move";
        dialogDiv.appendChild(title);
        
        // 버튼 컨테이너
        const buttonContainer = document.createElement("div");
        buttonContainer.style.display = "flex";
        buttonContainer.style.flexDirection = "column";
        buttonContainer.style.gap = "8px";
        
        // "장비 효과 사용" 버튼
        const useBtn = document.createElement("button");
        const equipText = game.i18n.localize('DX3rd.Equipment');
        const appliedText = game.i18n.localize('DX3rd.Applied');
        const useText = game.i18n.localize('DX3rd.Use');
        useBtn.textContent = `${equipText} ${appliedText} ${useText}`;
        useBtn.style.width = "100%";
        useBtn.style.height = "32px";
        useBtn.style.background = "white";
        useBtn.style.color = "black";
        useBtn.style.borderRadius = "4px";
        useBtn.style.border = "none";
        useBtn.style.fontWeight = "bold";
        useBtn.style.fontSize = "0.9em";
        useBtn.style.cursor = "pointer";
        useBtn.onclick = async () => {
            const updates = {};
            
            // 1. system.used.state 증가
            const currentUsedState = item.system?.used?.state || 0;
            updates['system.used.state'] = currentUsedState + 1;
            
            // 2. 활성화 (shouldActivate가 true이고 disable이 'notCheck'가 아닌 경우)
            if (shouldActivate) {
                const activeDisable = item.system?.active?.disable ?? '-';
                if (activeDisable !== 'notCheck') {
                    updates['system.active.state'] = true;
                }
            }
            
            if (Object.keys(updates).length > 0) {
                await item.update(updates);
            }
            
            // 3. 대상 적용 (shouldApplyToTargets가 true인 경우)
            if (shouldApplyToTargets && window.DX3rdUniversalHandler) {
                await window.DX3rdUniversalHandler.applyToTargets(actor, item, 'afterSuccess');
            }
            
            if (dialogDiv.parentNode) document.body.removeChild(dialogDiv);
        };
        buttonContainer.appendChild(useBtn);
        
        // "사용 안 함" 버튼
        const notUseBtn = document.createElement("button");
        notUseBtn.textContent = game.i18n.localize('DX3rd.NotUse');
        notUseBtn.style.width = "100%";
        notUseBtn.style.height = "32px";
        notUseBtn.style.background = "#666";
        notUseBtn.style.color = "white";
        notUseBtn.style.borderRadius = "4px";
        notUseBtn.style.border = "none";
        notUseBtn.style.fontWeight = "bold";
        notUseBtn.style.fontSize = "0.9em";
        notUseBtn.style.cursor = "pointer";
        notUseBtn.onclick = async () => {
            // 아무것도 안 함 (활성화 X, 대상 적용 X, state 증가 X)
            if (dialogDiv.parentNode) document.body.removeChild(dialogDiv);
        };
        buttonContainer.appendChild(notUseBtn);
        
        dialogDiv.appendChild(buttonContainer);
        
        // 드래그 기능 추가
        let isDragging = false;
        let offsetX;
        let offsetY;
        
        const onMouseDown = (e) => {
            // 버튼 클릭은 제외
            if (e.target.tagName === 'BUTTON') return;
            
            isDragging = true;
            
            // 다이얼로그의 현재 위치 계산
            const rect = dialogDiv.getBoundingClientRect();
            offsetX = e.clientX - rect.left;
            offsetY = e.clientY - rect.top;
            
            dialogDiv.style.cursor = "grabbing";
            title.style.cursor = "grabbing";
        };
        
        const onMouseMove = (e) => {
            if (!isDragging) return;
            
            e.preventDefault();
            
            // 마우스 위치에서 오프셋을 빼서 정확한 위치 계산
            const newLeft = e.clientX - offsetX;
            const newTop = e.clientY - offsetY;
            
            dialogDiv.style.left = newLeft + "px";
            dialogDiv.style.top = newTop + "px";
            dialogDiv.style.transform = "none";  // transform 제거
        };
        
        const onMouseUp = () => {
            if (isDragging) {
                isDragging = false;
                dialogDiv.style.cursor = "move";
                title.style.cursor = "move";
            }
        };
        
        dialogDiv.addEventListener("mousedown", onMouseDown);
        document.addEventListener("mousemove", onMouseMove);
        document.addEventListener("mouseup", onMouseUp);
        
        // 다이얼로그 제거 시 이벤트 리스너도 제거
        const cleanup = () => {
            document.removeEventListener("mousemove", onMouseMove);
            document.removeEventListener("mouseup", onMouseUp);
        };
        
        // 다이얼로그가 제거될 때 cleanup 호출
        const observer = new MutationObserver((mutations) => {
            mutations.forEach((mutation) => {
                mutation.removedNodes.forEach((node) => {
                    if (node === dialogDiv) {
                        cleanup();
                        observer.disconnect();
                    }
                });
            });
        });
        
        observer.observe(document.body, { childList: true });
        
        document.body.appendChild(dialogDiv);
    },
    
    
    initializeExistingMessages() {
        // 기존 채팅 메시지에서 토글 요소들을 찾아서 초기화
        // v14는 .chat-log, 레거시는 #chat-log 를 사용하므로 둘 다 지원
        const existingMessages = document.querySelectorAll('#chat-log .message, .chat-log .message');

        const expandItemCards = game.settings.get('dx3rd-emanim', 'expandChatItemCards');
        for (const messageElement of existingMessages) {
            const collapsibleElements = messageElement.querySelectorAll('.dx3rd-item-chat .collapsible-content');
            // 현재 월드 설정에 따라 초기 표시 상태를 통일한다.
            for (const el of collapsibleElements) {
                el.classList.toggle('collapsed', !expandItemCards);
                el.style.display = expandItemCards ? '' : 'none';
            }
        }
    },
    
    showComboItemsDialog(messageElement, section) {
        // 메시지에서 액터 정보 추출
        let actorId = null;
        try {
            const messageData = messageElement?.[0] || messageElement;
            if (messageData && messageData.dataset) {
                const messageId = messageData.dataset.messageId;
                if (messageId) {
                    const message = game.messages.get(messageId);
                    if (message && message.speaker && message.speaker.actor) {
                        actorId = message.speaker.actor;
                    }
                }
            }
        } catch (e) {
            return;
        }
        
        if (!actorId) {
            return;
        }
        
        const actor = game.actors.get(actorId);
        if (!actor) {
            return;
        }
        
        // 콤보 아이템 찾기
        const comboItems = actor.items.filter(item => item.type === 'combo');
        if (comboItems.length === 0) {
            return;
        }
        
        // 첫 번째 콤보 아이템 사용 (여러 개가 있다면 가장 최근에 생성된 것)
        const comboItem = comboItems[0];
        
        // 섹션에 따른 아이템 수집
        let items = [];
        let sectionName = '';
        
        if (section === 'effects') {
            items = this.getComboEffects(actor, comboItem);
            sectionName = game.i18n.localize('DX3rd.Effect');
        } else if (section === 'weapons') {
            items = this.getComboWeapons(actor, comboItem);
            sectionName = game.i18n.localize('DX3rd.Weapon');
        }
        
        if (items.length === 0) {
            ui.notifications.info(game.i18n.format('DX3rd.NoItems', {name: sectionName}));
            return;
        }
        
        // 다이얼로그 표시
        this.createComboItemsDialog(sectionName, items, comboItem.name, actor);
    },
    
    getComboEffects(actor, comboItem) {
        const effects = [];
        if (comboItem.system.effect && Array.isArray(comboItem.system.effect)) {
            for (const effectId of comboItem.system.effect) {
                if (effectId && effectId !== '-') {
                    const effect = actor.items.get(effectId);
                    if (effect && effect.type === 'effect') {
                        effects.push({
                            id: effect.id,
                            name: effect.name,
                            level: effect.system.level?.value || 0,
                            timing: effect.system.timing || '-',
                            skill: effect.system.skill || '-',
                            target: effect.system.target || '-',
                            range: effect.system.range || '-',
                            encroach: effect.system.encroach?.value || 0,
                            limit: effect.system.limit || '-'
                        });
                    }
                }
            }
        }
        return effects;
    },
    
    getComboWeapons(actor, comboItem) {
        const weapons = [];
        if (comboItem.system.weapon && Array.isArray(comboItem.system.weapon)) {
            for (const weaponId of comboItem.system.weapon) {
                if (weaponId && weaponId !== '-') {
                    const weapon = actor.items.get(weaponId);
                    if (weapon && weapon.type === 'weapon') {
                        weapons.push({
                            id: weapon.id,
                            name: weapon.name,
                            type: weapon.system.type || '-',
                            skill: weapon.system.skill || '-',
                            range: weapon.system.range || '-',
                            add: weapon.system.add || 0,
                            attack: weapon.system.attack || 0,
                            guard: weapon.system.guard || 0
                        });
                    }
                }
            }
        }
        return weapons;
    },
    
    createComboItemsDialog(sectionName, items, comboName, actor) {
        let content = `<div class="combo-items-dialog">`;
        content += `<ol class="items-list">`;
        
        for (const item of items) {
            content += `<li class="item combo-item">`;
            content += `<h4 class="item-name">`;
            content += `<span class="item-label">`;
            
            if (sectionName === game.i18n.localize('DX3rd.Effect')) {
                content += `<span class="level">${item.level}</span>`;
            }
            
            content += `${item.name}`;
            content += `</span>`;
            content += `</h4>`;
            
            content += `<table class="info-table">`;
            
            if (sectionName === game.i18n.localize('DX3rd.Effect')) {
                const timingDisplay = item.timing === '-' ? '-' : game.i18n.localize(`DX3rd.${item.timing.charAt(0).toUpperCase() + item.timing.slice(1)}`);
                const skillDisplay = this._getSkillDisplay(item.skill, actor);
                
                content += `<tr>`;
                content += `<th class="width-18">${game.i18n.localize("DX3rd.Timing")}</th>`;
                content += `<th class="width-18">${game.i18n.localize("DX3rd.Skill")}</th>`;
                content += `<th class="width-18">${game.i18n.localize("DX3rd.Target")}</th>`;
                content += `<th class="width-18">${game.i18n.localize("DX3rd.Range")}</th>`;
                content += `<th class="width-14">${game.i18n.localize("DX3rd.Encroach")}</th>`;
                content += `<th class="width-14">${game.i18n.localize("DX3rd.Limit")}</th>`;
                content += `</tr>`;
                content += `<tr>`;
                content += `<td class="width-18">${timingDisplay}</td>`;
                content += `<td class="width-18">${skillDisplay}</td>`;
                content += `<td class="width-18">${item.target}</td>`;
                content += `<td class="width-18">${item.range}</td>`;
                content += `<td class="width-14">${item.encroach}</td>`;
                content += `<td class="width-14">${item.limit}</td>`;
                content += `</tr>`;
            } else if (sectionName === game.i18n.localize('DX3rd.Weapon')) {
                const typeDisplay = item.type === '-' ? '-' : game.i18n.localize(`DX3rd.${item.type.charAt(0).toUpperCase() + item.type.slice(1)}`);
                const skillDisplay = this._getSkillDisplay(item.skill, actor);
                
                content += `<tr>`;
                content += `<th class="width-18">${game.i18n.localize("DX3rd.Type")}</th>`;
                content += `<th class="width-18">${game.i18n.localize("DX3rd.Skill")}</th>`;
                content += `<th class="width-18">${game.i18n.localize("DX3rd.Range")}</th>`;
                content += `<th class="width-18">${game.i18n.localize("DX3rd.Add")}</th>`;
                content += `<th class="width-14">${game.i18n.localize("DX3rd.Attack")}</th>`;
                content += `<th class="width-14">${game.i18n.localize("DX3rd.Guard")}</th>`;
                content += `</tr>`;
                content += `<tr>`;
                content += `<td class="width-18">${typeDisplay}</td>`;
                content += `<td class="width-18">${skillDisplay}</td>`;
                content += `<td class="width-18">${item.range}</td>`;
                content += `<td class="width-18">${item.add}</td>`;
                content += `<td class="width-14">${item.attack}</td>`;
                content += `<td class="width-14">${item.guard}</td>`;
                content += `</tr>`;
            }
            
            content += `</table>`;
            content += `</li>`;
        }
        
        content += `</ol>`;
        content += `</div>`;
        
        // 다이얼로그 생성
        new foundry.applications.api.DialogV2({
            window: { title: `${comboName} - ${sectionName}` },
            content: content,
            buttons: [
                {
                    action: 'close',
                    icon: 'fas fa-times',
                    label: game.i18n.localize('DX3rd.Close'),
                    default: true
                }
            ]
        }).render(true);
    },
    
    showBookItemsDialog(messageElement, section) {
        // 메시지에서 액터 정보 추출
        let actorId = null;
        try {
            const messageData = messageElement?.[0] || messageElement;
            if (messageData && messageData.dataset) {
                const messageId = messageData.dataset.messageId;
                if (messageId) {
                    const message = game.messages.get(messageId);
                    if (message && message.speaker && message.speaker.actor) {
                        actorId = message.speaker.actor;
                    }
                }
            }
        } catch (e) {
            return;
        }
        
        if (!actorId) {
            return;
        }
        
        const actor = game.actors.get(actorId);
        if (!actor) {
            return;
        }
        
        // 마도서 아이템 찾기
        const bookItems = actor.items.filter(item => item.type === 'book');
        if (bookItems.length === 0) {
            return;
        }
        
        // 첫 번째 마도서 아이템 사용 (여러 개가 있다면 가장 최근에 생성된 것)
        const bookItem = bookItems[0];
        
        // 섹션에 따른 아이템 수집
        let items = [];
        let sectionName = '';
        
        if (section === 'spells') {
            items = this.getBookSpells(actor, bookItem);
            sectionName = game.i18n.localize('DX3rd.Spell');
        }
        
        if (items.length === 0) {
            ui.notifications.info(game.i18n.format('DX3rd.NoItems', {name: sectionName}));
            return;
        }
        
        // 다이얼로그 표시
        this.createBookItemsDialog(sectionName, items, bookItem.name, actor);
    },
    
    getBookSpells(actor, bookItem) {
        const spells = [];
        if (bookItem.system.spells && Array.isArray(bookItem.system.spells)) {
            for (const spellId of bookItem.system.spells) {
                if (spellId && spellId !== '-') {
                    // 공용 아이템에서 조회
                    const spell = game.items.get(spellId);
                    
                    if (spell && spell.type === 'spell') {
                        // 액터가 같은 이름의 술식을 가지고 있는지 확인
                        const actorSpell = actor.items.find(item => 
                            item.type === 'spell' && item.name === spell.name
                        );
                        const isOwned = !!actorSpell;
                        
                        spells.push({
                            id: spell.id,
                            name: spell.name,
                            spellType: spell.system.spelltype || '-',
                            invoke: spell.system.invoke?.value || '-',
                            evocation: spell.system.evocation?.value || '-',
                            encroach: spell.system.encroach?.value || 0,
                            isOwned: isOwned
                        });
                    }
                }
            }
        }
        return spells;
    },
    
    createBookItemsDialog(sectionName, items, bookName, actor) {
        let content = `<div class="book-spell-list-dialog">`;
        content += `<ol class="items-list">`;
        
        for (const item of items) {
            const ownedClass = item.isOwned ? 'owned-spell' : '';
            content += `<li class="item book-spell-item ${ownedClass}">`;
            content += `<h4 class="item-name">`;
            content += `<span class="item-label">`;
            content += `${item.name}`;
            content += `</span>`;
            content += `</h4>`;
            
            content += `<table class="info-table">`;
            
            if (sectionName === game.i18n.localize('DX3rd.Spell')) {
                const spellTypeDisplay = item.spellType === '-' ? '-' : game.i18n.localize(`DX3rd.${item.spellType}`);
                
                let invokeDisplay = '';
                if (item.invoke === '-' && item.evocation === '-') {
                    invokeDisplay = game.i18n.localize('DX3rd.Freepass');
                } else if (item.invoke !== '-' && item.evocation === '-') {
                    invokeDisplay = item.invoke;
                } else if (item.invoke !== '-' && item.evocation !== '-') {
                    invokeDisplay = `${item.invoke}/${item.evocation}`;
                } else if (item.invoke === '-' && item.evocation !== '-') {
                    invokeDisplay = item.evocation;
                }
                
                content += `<tr>`;
                content += `<th class="width-33">${game.i18n.localize("DX3rd.Type")}</th>`;
                content += `<th class="width-33">${game.i18n.localize("DX3rd.Invoke")}</th>`;
                content += `<th class="width-33">${game.i18n.localize("DX3rd.Encroach")}</th>`;
                content += `</tr>`;
                content += `<tr>`;
                content += `<td class="width-33">${spellTypeDisplay}</td>`;
                content += `<td class="width-33">${invokeDisplay}</td>`;
                content += `<td class="width-33">${item.encroach}</td>`;
                content += `</tr>`;
            }
            
            content += `</table>`;
            content += `</li>`;
        }
        
        content += `</ol>`;
        content += `</div>`;
        
        // 다이얼로그 생성
        new foundry.applications.api.DialogV2({
            window: { title: `${bookName} - ${sectionName}` },
            content: content,
            buttons: [
                {
                    action: 'close',
                    icon: 'fas fa-times',
                    label: game.i18n.localize('DX3rd.Close'),
                    default: true
                }
            ]
        }).render(true);
    },
    
    _getSkillDisplay(skillKey, actor) {
        if (!skillKey || skillKey === '-') return '-';
        
        // 액터의 스킬에서 찾기
        if (actor) {
            const skill = actor.system?.attributes?.skills?.[skillKey];
            if (skill) {
                // 스킬 이름이 DX3rd.로 시작하면 커스텀 이름 또는 로컬라이징
                if (skill.name && skill.name.startsWith('DX3rd.')) {
                    // customSkills 설정 확인
                    const customSkills = game.settings.get("dx3rd-emanim", "customSkills") || {};
                    const customSkill = customSkills[skillKey];
                    
                    if (customSkill) {
                        // 커스텀 이름이 있으면 우선 사용
                        return typeof customSkill === 'object' ? customSkill.name : customSkill;
                    } else {
                        // 커스텀 이름이 없으면 기본 로컬라이징
                        return game.i18n.localize(skill.name);
                    }
                }
                return skill.name || skillKey;
            }
        }
        
        // 스킬이 없으면 기본 속성 체크
        const attributes = ['body', 'sense', 'mind', 'social'];
        if (attributes.includes(skillKey)) {
            return game.i18n.localize(`DX3rd.${skillKey.charAt(0).toUpperCase() + skillKey.slice(1)}`);
        }
        
        // 신드롬 체크
        if (skillKey === 'syndrome') {
            return game.i18n.localize('DX3rd.Syndrome');
        }
        
        // DX3rd. 접두사가 있는 스킬 키인 경우 로컬라이징 시도
        if (skillKey.startsWith('DX3rd.')) {
            return game.i18n.localize(skillKey);
        }
        
        return skillKey;
    }
};
