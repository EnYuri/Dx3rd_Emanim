// Rois 아이템 핸들러
(function() {
const DialogV2 = foundry.applications?.api?.DialogV2;

window.DX3rdRoisHandler = {
    async handle(actorId, itemId) {
        try {
            // 액터와 아이템 찾기
            const actor = game.actors.get(actorId);
            if (!actor) {
                console.error("DX3rd | Actor not found:", actorId);
                return;
            }
            
            const item = actor.items.get(itemId);
            if (!item) {
                console.error("DX3rd | Item not found:", itemId);
                return;
            }
            
            // 채팅 메시지에서 사용 버튼을 클릭한 경우
            // Titus가 체크되어 있지 않으면 Titus, 체크되어 있으면 Sublimation
            if (!item.system.titus) {
                await this.handleTitus(actorId, itemId);
            } else {
                await this.handleSublimation(actorId, itemId);
            }
            
        } catch (error) {
            console.error("DX3rd | Error in RoisHandler:", error);
            ui.notifications.error("로이스 아이템 사용 중 오류가 발생했습니다.");
        }
    },
    
    async handleTitus(actorId, itemId) {
        try {
            // 액터와 아이템 찾기
            const actor = game.actors.get(actorId);
            if (!actor) {
                console.error("DX3rd | Actor not found:", actorId);
                return;
            }
            
            const item = actor.items.get(itemId);
            if (!item) {
                console.error("DX3rd | Item not found:", itemId);
                return;
            }
            
            // Titus가 체크되어 있지 않은 경우에만 Titus 버튼 동작
            if (!item.system.titus) {
                // Titus 체크
                await item.update({
                    "system.titus": true
                });
                
                // 채팅 메시지 출력
                const chatData = {
                    speaker: ChatMessage.getSpeaker({ actor: actor }),
                    content: `<div class="dx3rd-item-chat">${game.i18n.localize("DX3rd.Titus")}(${item.name})</div>`,
                    style: CONST.CHAT_MESSAGE_STYLES.OTHER,
                };
                
                await ChatMessage.create(chatData);

                // D로이스 임베드 매크로 발동(티투스화 = 효과 발동 시점). 침식 상승 + applied 버프 등.
                if (window.DX3rdUniversalHandler?.executeMacros && Array.isArray(item.system?.macros) && item.system.macros.some(m => m && m.command)) {
                    await window.DX3rdUniversalHandler.executeMacros(item, 'instant');
                }

            } else {
                ui.notifications.info("이미 Titus가 활성화되어 있습니다.");
            }
            
        } catch (error) {
            console.error("DX3rd | Error in handleTitus:", error);
            ui.notifications.error("Titus 사용 중 오류가 발생했습니다.");
        }
    },
    
    async handleSublimation(actorId, itemId) {
        try {
            // 액터와 아이템 찾기
            const actor = game.actors.get(actorId);
            if (!actor) {
                console.error("DX3rd | Actor not found:", actorId);
                return;
            }
            
            const item = actor.items.get(itemId);
            if (!item) {
                console.error("DX3rd | Item not found:", itemId);
                return;
            }
            
            // 로이스 타입 확인
            const roisType = item.system.type || '-';
            
            // D(해설), M(메모리), E(소모) 로이스는 승화 불가
            if (roisType === 'D' || roisType === 'M' || roisType === 'E') {
                ui.notifications.warn("이 로이스는 승화할 수 없습니다.");
                return;
            }
            
            // Titus가 체크되어 있지 않으면 승화 불가
            if (!item.system.titus) {
                ui.notifications.warn("Titus가 활성화되어 있지 않습니다.");
                return;
            }
            
            // S로이스인지 확인
            const isSuperior = (roisType === 'S');
            
            // Sublimation 다이얼로그 템플릿 로드
            const template = 'systems/dx3rd-emanim/templates/dialog/sublimation-dialog.html';
            const html = await foundry.applications.handlebars.renderTemplate(template, { isSuperior });
            
            if (!DialogV2) {
                ui.notifications.error(game.i18n.localize('DX3rd.DialogV2Unavailable'));
                return;
            }

            // 다이얼로그 생성
            const dialog = new DialogV2({
                window: { title: `${game.i18n.localize("DX3rd.Sublimation")} - ${item.name}` },
                content: html,
                buttons: [{
                    action: "cancel",
                    icon: "fas fa-times",
                    label: game.i18n.localize("DX3rd.Cancel"),
                    default: true
                }]
            });
            await dialog.render(true);
            const root = dialog.element;
            if (!root) return;

            // SubAction 5와 9는 HP가 0일 때만 활성화
            const currentHP = actor.system.attributes.hp.value;
            if (currentHP > 0) {
                root.querySelector('.sublimation-action-btn[data-action="5"]')?.setAttribute('disabled', 'disabled');
                root.querySelector('.sublimation-action-btn[data-action="9"]')?.setAttribute('disabled', 'disabled');
            }

            // 각 버튼에 클릭 이벤트 추가
            root.querySelectorAll('.sublimation-action-btn').forEach(button => {
                button.addEventListener('click', async (event) => {
                    const actionNumber = event.currentTarget?.dataset?.action;
                    if (event.currentTarget?.disabled || !actionNumber) return;

                    // SubAction별 기능 구현
                    const actionText = game.i18n.localize(`DX3rd.SubAction${actionNumber}`);

                    // 승화 효과 적용 (각 SubAction별 반환값: 모든 액션은 true/false/결과값 반환)
                    const actionResult = await window.DX3rdRoisHandler.applySublimationEffect(actor, item, actionNumber);

                    // 취소된 경우만 null 반환 (0번 액션의 취소 또는 다이얼로그 닫기)
                    if (actionResult === null) {
                        return; // 승화 다이얼로그는 그대로 유지
                    }

                    // 채팅 메시지 출력
                    let content = `${game.i18n.localize("DX3rd.Sublimation")}(${item.name})<br>· ${actionText}`;

                    // SubAction 2인 경우 롤 결과 추가
                    if (actionNumber === "2" && actionResult) {
                        content += `<br>${actionResult}`;
                    }

                    // SubAction 9인 경우 상태이상 해제 여부 추가
                    if (actionNumber === "9" && actionResult) {
                        content += `<br>· ${game.i18n.localize("DX3rd.AllConditionClear")}`;
                    }

                    // 채팅 메시지 생성 (SubAction 0은 다이얼로그에서 이미 생성됨)
                    if (actionNumber !== "0") {
                        const chatData = {
                            speaker: ChatMessage.getSpeaker({ actor: actor }),
                            content: `<div class="dx3rd-item-chat">${content}</div>`,
                            style: CONST.CHAT_MESSAGE_STYLES.OTHER,
                        };

                        await ChatMessage.create(chatData);
                    }

                    // Sublimation 체크 (Titus는 유지)
                    await item.update({
                        "system.sublimation": true
                    });

                    // 다이얼로그 닫기
                    dialog.close();
                });
            });
            
        } catch (error) {
            console.error("DX3rd | Error in handleSublimation:", error);
            ui.notifications.error("Sublimation 사용 중 오류가 발생했습니다.");
        }
    },
    
    async applySublimationEffect(actor, item, actionNumber) {
        try {
            const effectName = `${game.i18n.localize("DX3rd.Sublimation")}(${item.name})`;
            
            // actionNumber를 문자열로 변환
            const action = String(actionNumber);
            
            switch(action) {
                case '1': // 판정에 10개의 주사위 추가
                    await this.createAppliedEffect(actor, effectName, 'roll', {
                        dice: 10
                    }, item.img);
                    return true;
                    
                case '2': // 판정의 달성치에 +1D10 추가
                    // 1d10 주사위 굴리기
                    const roll = new Roll('1d10');
                    await roll.evaluate();
                    const rollResult = roll.total;
                    
                    // 롤 렌더링 결과 반환
                    const rollHtml = await roll.render();
                    ui.notifications.info(`달성치에 +${rollResult}을 추가하세요.`);
                    return rollHtml;
                    
                case '3': // 판정의 크리티컬 수치에 -1의 수정
                    await this.createAppliedEffect(actor, effectName, 'roll', {
                        critical: -1,
                        critical_min: 2
                    }, item.img);
                    return true;
                    
                case '4': // 마술 굴림에 2개의 마술 주사위 추가
                    await this.createAppliedEffect(actor, effectName, 'major', {
                        cast_dice: 2
                    }, item.img);
                    return true;
                    
                case '5': // 전투불능에서 회복
                    // HP 회복: 10 + body.total
                    const bodyTotal = actor.system.attributes.body.total;
                    const healAmount = 10 + bodyTotal;
                    
                    // HP 증가 (0보다 작지 않도록)
                    const currentHP5 = actor.system.attributes.hp.value;
                    const maxHP5 = actor.system.attributes.hp.max;
                    const newHP5 = Math.min(Math.max(0, currentHP5 + healAmount), maxHP5);
                    
                    await actor.update({
                        'system.attributes.hp.value': newHP5
                    });
                    
                    ui.notifications.info(`HP를 ${healAmount}만큼 회복했습니다. (${currentHP5} → ${newHP5})`);
                    return true;
                    
                case '6': // 불리한 효과를 소거 (상태이상 해제)
                    // 상태이상 해제: rigor, pressure, dazed, poisoned, hatred, fear, berserk
                    const conditionsToRemove6 = ['rigor', 'pressure', 'dazed', 'poisoned', 'hatred', 'fear', 'berserk'];
                    const removedConditions6 = [];
                    
                    // 조건 맵에 메시지 제어 정보 저장
                    if (!window.DX3rdConditionTriggerMap) {
                        window.DX3rdConditionTriggerMap = new Map();
                    }
                    
                    for (const condition of conditionsToRemove6) {
                        if (actor.effects.find(e => e.statuses.has(condition))) {
                            // 메시지 제어 플래그 설정
                            const mapKey = `${actor.id}:${condition}`;
                            window.DX3rdConditionTriggerMap.set(mapKey, {
                                triggerItemName: item.name,
                                suppressMessage: true,
                                bulkRemove: true
                            });
                            
                            await actor.toggleStatusEffect(condition, { active: false });
                            removedConditions6.push(condition);
                        }
                    }
                    
                    // 상태이상 해제 결과 메시지
                    if (removedConditions6.length > 0) {
                        ui.notifications.info(`상태이상을 해제했습니다.`);
                        return true; // 상태이상 해제됨
                    } else {
                        ui.notifications.info(`해제할 상태이상이 없습니다.`);
                        return false; // 상태이상 해제 안됨
                    }
                    
                case '7': // 기타 효과
                    return true; // 기타 효과는 항상 성공으로 처리
                    
                case '8': // S로이스: 데미지 롤에 5개의 주사위 추가
                    await this.createAppliedEffect(actor, effectName, 'roll', {
                        damage_roll: 5
                    }, item.img);
                    return true;
                    
                case '9': // S로이스: 전투불능에서 완전회복
                    // HP 최대 회복
                    const maxHP9 = actor.system.attributes.hp.max;
                    await actor.update({
                        'system.attributes.hp.value': maxHP9
                    });
                    
                    // 상태이상 해제: rigor, pressure, dazed, poisoned, hatred, fear, berserk
                    const conditionsToRemove = ['rigor', 'pressure', 'dazed', 'poisoned', 'hatred', 'fear', 'berserk'];
                    const removedConditions = [];
                    
                    // 조건 맵에 메시지 제어 정보 저장
                    if (!window.DX3rdConditionTriggerMap) {
                        window.DX3rdConditionTriggerMap = new Map();
                    }
                    
                    for (const condition of conditionsToRemove) {
                        if (actor.effects.find(e => e.statuses.has(condition))) {
                            // 메시지 제어 플래그 설정
                            const mapKey = `${actor.id}:${condition}`;
                            window.DX3rdConditionTriggerMap.set(mapKey, {
                                triggerItemName: item.name,
                                suppressMessage: true,
                                bulkRemove: true
                            });
                            
                            await actor.toggleStatusEffect(condition, { active: false });
                            removedConditions.push(condition);
                        }
                    }
                    
                    // 모든 상태이상 해제 후 통합 메시지 출력
                    if (removedConditions.length > 0) {
                        ui.notifications.info(`HP를 최대까지 회복하고 상태이상을 해제했습니다.`);
                        return true; // 상태이상 해제됨
                    } else {
                        ui.notifications.info(`HP를 최대까지 회복했습니다.`);
                        return false; // 상태이상 해제 안됨
                    }
                    
                case '0': // S로이스: 이펙트 사용 횟수 회복
                    // 횟수제한이 있는 이펙트 중 state가 1 이상인 것들 찾기
                    const effectItems = actor.items.filter(i => i.type === 'effect');
                    
                    const recoverableEffects = effectItems.filter(effect => {
                        const notCheck = effect.system?.used?.disable || 'notCheck';
                        const state = effect.system?.used?.state || 0;
                        const max = effect.system?.used?.max || 0;
                        const level = effect.system?.used?.level || false;
                        
                        // displayMax 계산 (used.level이 체크되어 있으면 레벨 추가)
                        let displayMax = Number(max) || 0;
                        if (level && effect.type === 'effect') {
                            const baseLevel = Number(effect.system?.level?.init) || 0;
                            const upgrade = effect.system?.level?.upgrade || false;
                            let finalLevel = baseLevel;
                            
                            if (upgrade && actor.system?.attributes?.encroachment?.level) {
                                const encLevel = Number(actor.system.attributes.encroachment.level) || 0;
                                finalLevel += encLevel;
                            }
                            
                            displayMax += finalLevel;
                        } else if (level && effect.type === 'psionic') {
                            const baseLevel = Number(effect.system?.level?.init) || 0;
                            displayMax += baseLevel;
                        }
                        
                        console.log(`DX3rd | Effect ${effect.name}: notCheck=${notCheck}, state=${state}, max=${max}, level=${level}, displayMax=${displayMax}`);
                        
                        // notCheck가 false이고, state가 1 이상이며, displayMax가 0보다 큰 경우
                        return notCheck !== 'notCheck' && state >= 1 && displayMax > 0;
                    });
                    
                    if (recoverableEffects.length === 0) {
                        ui.notifications.info("회복할 수 있는 이펙트가 없습니다.");
                        return true;
                    }
                    
                    // 이펙트 회복 다이얼로그 표시
                    const template = 'systems/dx3rd-emanim/templates/dialog/effect-recovery-dialog.html';
                    const effectsData = recoverableEffects.map(effect => {
                        const state = effect.system?.used?.state || 0;
                        const max = effect.system?.used?.max || 0;
                        const level = effect.system?.used?.level || false;
                        
                        // displayMax 계산 (used.level이 체크되어 있으면 레벨 추가)
                        let displayMax = Number(max) || 0;
                        if (level && effect.type === 'effect') {
                            const baseLevel = Number(effect.system?.level?.init) || 0;
                            const upgrade = effect.system?.level?.upgrade || false;
                            let finalLevel = baseLevel;
                            
                            if (upgrade && actor.system?.attributes?.encroachment?.level) {
                                const encLevel = Number(actor.system.attributes.encroachment.level) || 0;
                                finalLevel += encLevel;
                            }
                            
                            displayMax += finalLevel;
                        } else if (level && effect.type === 'psionic') {
                            const baseLevel = Number(effect.system?.level?.init) || 0;
                            displayMax += baseLevel;
                        }
                        
                        const effectData = {
                            id: effect.id,
                            name: effect.name.split('||')[0], // || 이후 제거
                            state: String(Number(state) || 0),
                            max: String(Number(displayMax) || 0)
                        };
                        
                        return effectData;
                    });
                    
                    const html = await foundry.applications.handlebars.renderTemplate(template, { effects: effectsData });
                    
                    if (!DialogV2) {
                        ui.notifications.error(game.i18n.localize('DX3rd.DialogV2Unavailable'));
                        return null;
                    }

                    return new Promise((resolve) => {
                        const dialog = new DialogV2({
                            window: {
                                title: `${game.i18n.localize("DX3rd.Sublimation")} - 이펙트 사용 횟수 회복`
                            },
                            content: html,
                            position: {
                                width: 400,
                                height: 300
                            },
                            buttons: [{
                                action: "cancel",
                                label: "취소",
                                default: true
                            }]
                        });

                        dialog.addEventListener("close", () => resolve(null), { once: true });
                        Promise.resolve(dialog.render(true)).then(() => {
                            const root = dialog.element;
                            if (!root) return;

                            root.querySelectorAll('.effect-recovery-btn').forEach(button => {
                                button.addEventListener('click', async (event) => {
                                    const effectId = event.currentTarget?.dataset?.effectId;
                                    const effect = actor.items.get(effectId);

                                    if (effect) {
                                        const currentState = effect.system?.used?.state || 0;
                                        const newState = Math.max(0, currentState - 1);

                                        await effect.update({
                                            'system.used.state': newState
                                        });

                                        ui.notifications.info(`${effect.name.split('||')[0]}의 사용 횟수를 회복했습니다. (${currentState} → ${newState})`);

                                        // SubAction 0의 경우 채팅 메시지를 직접 생성
                                        const effectName = effect.name.split('||')[0];
                                        const chatData = {
                                            speaker: ChatMessage.getSpeaker({ actor: actor }),
                                            content: `<div class="dx3rd-item-chat">${game.i18n.localize("DX3rd.Sublimation")}(${item.name})<br>· ${effectName} 사용 횟수 회복</div>`,
                                            style: CONST.CHAT_MESSAGE_STYLES.OTHER
                                        };

                                        await ChatMessage.create(chatData);

                                        resolve(effectName); // 회복된 아이템 이름 반환
                                        dialog.close();
                                    }
                                });
                            });
                        });
                    });
                    
                default:
                    return null;
            }
            
        } catch (error) {
            console.error("DX3rd | Error in applySublimationEffect:", error);
            ui.notifications.error("승화 효과 적용 중 오류가 발생했습니다.");
            return null;
        }
    },
    
    async createAppliedEffect(actor, name, disable, attributes, img) {
        try {
            // system.attributes.applied에 직접 추가
            const applied = actor.system.attributes.applied || {};
            
            // 고유 키 생성 (타임스탬프 기반)
            const effectKey = `sublimation_${Date.now()}`;
            
            // applied 효과 데이터 생성 (disable은 최상위)
            const effectData = {
                name: name,
                source: actor.name,
                disable: disable || '-',
                img: img || 'icons/svg/aura.svg',
                attributes: attributes || {}
            };
            
            // system.attributes.applied에 추가
            await actor.update({
                [`system.attributes.applied.${effectKey}`]: effectData
            });
            
            ui.notifications.info(`${name} 효과가 적용되었습니다.`);
            
        } catch (error) {
            console.error("DX3rd | Error in createAppliedEffect:", error);
            throw error;
        }
    }
};
})();
