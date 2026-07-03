// Spell 아이템 핸들러
(function() {
const DialogV2 = foundry.applications?.api?.DialogV2;

/**
 * Execute macros by prefix (GM only)
 * @param {string} prefix - Macro name prefix
 */
async function executeMacrosByPrefix(prefix) {
    // GM만 매크로 실행
    if (!game.user.isGM) {
        return;
    }
    
    const macros = game.macros.filter(m => m.name.startsWith(prefix));
    if (macros.length === 0) {
        return;
    }
    
    for (const macro of macros) {
        try {
            await macro.execute();
        } catch (error) {
            console.error(`DX3rd | Error executing macro ${macro.name}:`, error);
        }
    }
}

async function promptRoisSelection({ title, content }) {
    if (!DialogV2?.wait) {
        ui.notifications.error(game.i18n.localize('DX3rd.DialogV2Unavailable'));
        return null;
    }

    return await DialogV2.wait({
        window: { title },
        content,
        rejectClose: false,
        buttons: [
            {
                action: 'confirm',
                icon: 'fas fa-check',
                label: game.i18n.localize('DX3rd.Confirm'),
                default: true,
                callback: (event, button) => {
                    const selectedId = button.form?.querySelector('#rois-select')?.value;
                    if (!selectedId) {
                        ui.notifications.warn('로이스를 선택해주세요.');
                        return null;
                    }
                    return selectedId;
                }
            },
            {
                action: 'cancel',
                icon: 'fas fa-times',
                label: game.i18n.localize('DX3rd.Cancel'),
                callback: () => null
            }
        ],
        close: () => null
    });
}

window.DX3rdSpellHandler = {
    async handle(actorId, itemId, getTarget) {
        const actor = game.actors.get(actorId);
        if (!actor) { ui.notifications.warn("Actor not found"); return; }
        // 액터의 아이템에서 먼저 찾고, 없으면 game.items에서 찾기
        const item = actor.items.get(itemId) || game.items.get(itemId);
        if (!item) { ui.notifications.warn("Item not found"); return; }

        // 스펠 롤 타입 분기: '-'는 기존 로직, 'CastingRoll'은 별도 처리
        const rollType = item.system?.roll ?? '-';
        if (rollType === 'CastingRoll') {
            await this.handleCastingRoll(actor, item, getTarget);
            return;
        }

        // 기본(-) 동작: 침식률/활성화/익스텐션은 이미 handleItemUse에서 처리됨
    }
    ,
    async handleCastingRoll(actor, item, getTarget) {
        // 주의: CastingRoll 분기에서는 침식률 증가/매크로 실행/타겟 적용을 즉시 수행하지 않음
        // 여기는 난이도 선택 및 이후 로직의 진입점만 담당

        // 난이도 선택/출력
        const invokeStr = String(item.system?.invoke?.value ?? '').trim();
        const evocationStr = String(item.system?.evocation?.value ?? '').trim();
        const hasInvoke = invokeStr !== '' && invokeStr !== '-';
        const hasEvocation = evocationStr !== '' && evocationStr !== '-';

        // 둘 중 하나만 있는 경우: 해당 값을 난이도로 콘솔 출력
        if (hasInvoke && !hasEvocation) {
            await this.showCastingRollDialog(actor, item, invokeStr, getTarget);
            return;
        }
        if (!hasInvoke && hasEvocation) {
            await this.showCastingRollDialog(actor, item, evocationStr, getTarget);
            return;
        }

        // 둘 다 있는 경우: 다이얼로그로 선택
        if (hasInvoke && hasEvocation) {
            if (!DialogV2?.wait) {
                ui.notifications.error(game.i18n.localize('DX3rd.DialogV2Unavailable'));
                return;
            }
            const title = game.i18n.localize('DX3rd.CastingRoll');
            const diffLabel = game.i18n.localize('DX3rd.Invoke');
            const selectedDifficulty = await DialogV2.wait({
                window: { title },
                content: '',
                rejectClose: false,
                buttons: [
                    {
                        action: 'invoke',
                        label: `${diffLabel}(${invokeStr})`,
                        default: true,
                        callback: () => invokeStr
                    },
                    {
                        action: 'evocation',
                        label: `${diffLabel}(${evocationStr})`,
                        callback: () => evocationStr
                    }
                ]
            });
            if (selectedDifficulty) await this.showCastingRollDialog(actor, item, selectedDifficulty, getTarget);
            return;
        }

        // 둘 다 비어있거나 '-'인 경우: 마술 굴림 없이 바로 발동 버튼 생성
        const handler = window.DX3rdUniversalHandler;
        if (handler) {
            await handler.ensureActivated(item, actor);
            
            // 발동 버튼 생성
            await this._createInvokeButton(actor, item, getTarget);
        }
    }
    ,
    async showCastingRollDialog(actor, item, difficulty, getTarget) {
        if (!DialogV2?.wait) {
            ui.notifications.error(game.i18n.localize('DX3rd.DialogV2Unavailable'));
            return;
        }

        const l = (k) => game.i18n.localize(k);
        const diceLabel = l('DX3rd.CastingDice');
        const addLabel = l('DX3rd.CastingAdd');
        const diffLabel = l('DX3rd.Invoke');
        const eibonLabel = l('DX3rd.Eibon');
        const angelLabel = l('DX3rd.Angel');
        const rollLabel = l('DX3rd.CastingRoll');

        const castDice = Number(actor.system?.attributes?.cast?.dice ?? 0);
        const castAdd = Number(actor.system?.attributes?.cast?.add ?? 0);
        const eibonDice = Number(actor.system?.attributes?.cast?.eibon ?? 0);

        const content = `
            <div class="dx3rd-casting-dialog">
                <div class="dx3rd-row dx3rd-3col">
                    <div>
                        <div class="label">${diceLabel}</div>
                        <input type="text" name="dice" value="${castDice}" data-dtype="Number" readonly>
                    </div>
                    <div>
                        <div class="label">${addLabel}</div>
                        <input type="text" name="add" value="${castAdd}" data-dtype="Number" readonly>
                    </div>
                    <div>
                        <div class="label">${diffLabel}</div>
                        <input type="text" name="difficulty" value="${difficulty}" data-dtype="String" readonly>
                    </div>
                </div>
                <div class="dx3rd-row dx3rd-8col" style="margin-top:8px;">
                    <div></div>
                    <div class="checkbox-container">
                        <label>${eibonLabel}</label>
                    </div>
                    <div class="checkbox-container">
                        <input type="checkbox" name="eibon" id="eibon-checkbox">
                    </div>
                    <div class="checkbox-container">
                        <label>${angelLabel}</label>
                    </div>
                    <div class="checkbox-container">
                        <input type="checkbox" name="angel" id="angel-checkbox">
                    </div>
                    <div></div>
                </div>
            </div>
        `;

        await DialogV2.wait({
            window: { title: `${rollLabel} - ${diffLabel} ${difficulty}` },
            classes: ['dx3rd-emanim', 'dx3rd-rolling-dialog'],
            content,
            rejectClose: false,
            buttons: [
                {
                    action: 'roll',
                    label: rollLabel,
                    default: true,
                    callback: async (event, button) => {
                        const useEibon = button.form?.elements?.eibon?.checked || false;
                        const useAngel = button.form?.elements?.angel?.checked || false;
                        
                        await this.performCastingRoll(actor, item, {
                            castDice,
                            castAdd,
                            eibonDice,
                            difficulty,
                            useEibon,
                            useAngel,
                            getTarget
                        });
                    }
                }
            ],
            render: (event, dialog) => {
                const root = dialog.element;
                if (!root) return;
                // 체크박스 변경 이벤트 리스너 추가
                root.querySelector('#eibon-checkbox')?.addEventListener('change', () => {
                    this.updateDiceDisplay(root, castDice, eibonDice);
                });
                root.querySelector('#angel-checkbox')?.addEventListener('change', () => {
                    this.updateDiceDisplay(root, castDice, eibonDice);
                });
            }
        });
    }
    ,
    updateDiceDisplay(root, castDice, eibonDice) {
        const useEibon = root.querySelector('#eibon-checkbox')?.checked || false;
        const diceInput = root.querySelector('input[name="dice"]');
        if (!diceInput) return;
        
        if (useEibon && eibonDice > 0) {
            // 에이본의 금주법이 체크된 경우: 마술주사위 + 에이본의 주사위(빨간색)
            const totalDice = castDice + eibonDice;
            diceInput.value = `${castDice} + ${eibonDice}`;
            diceInput.style.color = '#ff8a80';
        } else {
            // 에이본의 금주법이 체크되지 않은 경우: 기본 마술주사위
            diceInput.value = castDice;
            diceInput.style.color = '#f5f5f5';
        }
    }
    ,
    async performCastingRoll(actor, item, options) {
        const { castDice, castAdd, eibonDice, difficulty, useEibon, useAngel, getTarget } = options;

        // 주사위 개수 계산
        let totalDice = castDice;
        if (useEibon) {
            totalDice += eibonDice;
        }

        // DS 제거 옵션 구성
        let dsOptions = [];
        if (useEibon && eibonDice > 0) {
            dsOptions.push(eibonDice);
        }
        if (useAngel) {
            dsOptions.push('a');
        }

        // 롤 공식 구성
        let formula = `${totalDice}ds`;
        if (dsOptions.length > 0) {
            formula += `[${dsOptions.join(', ')}]`;
        }
        if (castAdd !== 0) {
            formula += castAdd >= 0 ? `+${castAdd}` : `${castAdd}`;
        }

        // 주사위 굴림 실행
        const roll = await (new Roll(formula)).roll();

        // 성공/실패 판정
        const difficultyNum = Number(difficulty) || 0;
        const isSuccess = roll.total >= difficultyNum;
        const resultText = isSuccess ? 
            game.i18n.localize('DX3rd.Success') : 
            game.i18n.localize('DX3rd.Failure');

        // 채팅 메시지 생성
        const invokeStr = String(item.system?.invoke?.value ?? '').trim();
        const evocationStr = String(item.system?.evocation?.value ?? '').trim();
        const hasInvoke = invokeStr !== '' && invokeStr !== '-';
        const hasEvocation = evocationStr !== '' && evocationStr !== '-';
        
        let difficultyDisplay = difficulty;
        
        // 둘 다 있는 경우 선택한 발동치를 볼드체로 강조
        if (hasInvoke && hasEvocation) {
            const selectedDifficulty = difficulty;
            if (selectedDifficulty === invokeStr) {
                difficultyDisplay = `<strong>${invokeStr}</strong>/${evocationStr}`;
            } else if (selectedDifficulty === evocationStr) {
                difficultyDisplay = `${invokeStr}/<strong>${evocationStr}</strong>`;
            }
        }
        
        // 주사위 굴림 결과를 HTML로 변환하여 메시지에 포함
        const rollHTML = await roll.render();
        const rollMessage = `<div class="dice-roll">${rollHTML}</div>`;
        
        const flavor = `
            <div class="dx3rd-item-chat">
                <div class="dx3rd-bold">
                    ${item.name} ( ${resultText} )
                </div>
                <div>
                    ${game.i18n.localize('DX3rd.Invoke')}: ${difficultyDisplay}
                </div>
                ${rollMessage}
            </div>
        `;
        
        const combinedContent = flavor;

        await ChatMessage.create({
            content: combinedContent,
            speaker: ChatMessage.getSpeaker({ actor: actor }),
            rolls: [roll]
        });

        // 3. 최종 폭주 주사위(10) 개수 확인 및 재앙 버튼 생성
        let finalOverflowCount = 0;
        for (const term of roll.terms) {
            if (term.constructor.name === 'DS3rdDiceTerm' && term.overflowCount !== undefined) {
                finalOverflowCount = term.overflowCount;
                break;
            }
        }

        // 폭주 주사위 개수에 따라 재앙 버튼 생성
        if (finalOverflowCount >= 1) {
            await this._createDisasterButton(actor, item, finalOverflowCount);
        }

        // 4. 성공 시 처리 - 발동 버튼만 생성 (활성화/매크로/효과는 발동 버튼에서)
        if (isSuccess) {
            // 마술 굴림 성공 시 발동 버튼 생성
            await this._createInvokeButton(actor, item, getTarget);
        }
    },

    /**
     * Create a spell invocation button in chat
     * @param {Actor} actor
     * @param {Item} item
     * @param {boolean} getTarget - getTarget 체크 유무
     */
    async _createInvokeButton(actor, item, getTarget) {
        const invokeLabel = game.i18n.localize('DX3rd.Invoking');
        
        // getTarget 값 결정 (인자로 받은 값 우선, 없으면 아이템 시스템 값)
        const finalGetTarget = getTarget !== undefined ? getTarget : (item.system.getTarget || false);
        
        // 아이템 정보를 저장 (효과 데이터 포함)
        const itemData = {
            id: item.id,
            name: item.name,
            img: item.img,
            macro: item.system.macro,
            getTarget: finalGetTarget,
            effect: {
                disable: item.system.effect?.disable || '-',
                attributes: item.system.effect?.attributes || {}
            }
        };
        const itemDataJson = JSON.stringify(itemData).replace(/"/g, '&quot;');
        
        const content = `
            <div class="spell-invoke-message">
                <button class="chat-btn invoke-spell" 
                        data-actor-id="${actor.id}" 
                        data-item-id="${item.id}"
                        data-item-data="${itemDataJson}"
                        data-get-target="${finalGetTarget}"
                        style="width: 100%; padding: 6px 12px; font-size: 14px; cursor: pointer;">
                    ${item.name} ${invokeLabel}
                </button>
            </div>
        `;
        
        await ChatMessage.create({
            content: content,
            speaker: ChatMessage.getSpeaker({ actor: actor })
        });
    },

    /**
     * Create disaster button based on overflow count
     * @param {Actor} actor
     * @param {Item} item
     * @param {number} overflowCount - Final overflow dice count
     */
    async _createDisasterButton(actor, item, overflowCount) {
        let disasterType = '';
        let disasterLabel = '';

        // 폭주 주사위 개수에 따라 재앙 타입 결정
        if (overflowCount === 1) {
            disasterType = 'disaster';
            disasterLabel = game.i18n.localize('DX3rd.SpellDisaster');
        } else if (overflowCount >= 2 && overflowCount <= 3) {
            disasterType = 'calamity';
            disasterLabel = game.i18n.localize('DX3rd.SpellCalamity');
        } else if (overflowCount >= 4) {
            disasterType = 'catastrophe';
            disasterLabel = game.i18n.localize('DX3rd.SpellCatastrophe');
        }

        const content = `
            <div class="spell-overflow-message">
                <button class="chat-btn spell-overflow" 
                        data-actor-id="${actor.id}" 
                        data-item-id="${item.id}"
                        data-disaster-type="${disasterType}"
                        data-overflow-count="${overflowCount}">
                    ${disasterLabel} (${game.i18n.localize('DX3rd.OverflowDice')}: ${overflowCount}개)
                </button>
            </div>
        `;

        await ChatMessage.create({
            content: content,
            speaker: ChatMessage.getSpeaker({ actor: actor }),
            flags: {
                'dx3rd-emanim': {
                    disasterType: disasterType,
                    overflowCount: overflowCount
                }
            }
        });
    },

    /**
     * Handle spell disaster button click
     * @param {Actor} actor
     * @param {Item} item
     * @param {string} disasterType - disaster, calamity, catastrophe
     * @param {number} overflowCount
     */
    async handleDisasterButton(actor, item, disasterType, overflowCount) {
        if (disasterType === 'disaster') {
            await this.rollSpellDisaster(actor, item);
        } else if (disasterType === 'calamity') {
            await this.rollSpellCalamity(actor, item);
        } else if (disasterType === 'catastrophe') {
            await this.rollSpellCatastrophe(actor, item);
        }
    },

    /**
     * Roll spell disaster table (1d10)
     * @param {Actor} actor
     * @param {Item} item
     */
    async rollSpellDisaster(actor, item) {
        // 1d10 굴림
        const roll = await new Roll("1d10").roll();
        const result = roll.total;

        // 결과에 따른 텍스트 가져오기
        const textKey = `DX3rd.SpellDisasterText${result}`;
        let resultText = game.i18n.localize(textKey);

        // {count} 치환 (결과 1번만 사용)
        if (result === 1 && resultText.includes('{count}')) {
            // 결과 1: count = 10 - body.total (최소 1)
            const bodyTotal = actor.system?.attributes?.body?.total || 0;
            const count = Math.max(1, 10 - bodyTotal);
            resultText = resultText.replace('{count}', count);
        }

        // 주사위 굴림 결과를 HTML로 변환하여 메시지에 포함
        const rollHTML = await roll.render();
        const rollMessage = `<div class="dice-roll">${rollHTML}</div>`;

        // 채팅 메시지 생성
        const content = `
            <div class="dx3rd-item-chat">
                <div class="item-header">
                    <strong>${game.i18n.localize('DX3rd.SpellDisaster')}</strong>
                </div>
                <div class="item-details">
                    <p><strong>${game.i18n.localize('DX3rd.DisasterResult')}:</strong> ${result}</p>
                    <p>${resultText}</p>
                </div>
                ${rollMessage}
            </div>
        `;

        const combinedContent = content;

        await ChatMessage.create({
            content: combinedContent,
            speaker: ChatMessage.getSpeaker({ actor: actor }),
            rolls: [roll]
        });

        // 특정 결과에 대한 효과 적용
        if (result === 3) {
            // 3번: 행동치 -2
            await this.createSpellDisasterEffect(actor, 3, {
                init: -2
            });
        } else if (result === 4) {
            // 4번: 이 표를 다시 한 번 굴린다. 그 결과는 당신의 로이스 중 한 명(GM이 결정)에게 적용된다.
            await this.handleSpellDisaster4(actor, item);
        } else if (result === 8) {
            // 8번: 마술 주사위 -1
            await this.createSpellDisasterEffect(actor, 8, {
                cast_dice: -1
            });
        } else if (result === 9) {
            // 9번: 폭주 상태이상 활성화
            await actor.toggleStatusEffect("berserk", { active: true });
        } else if (result === 10) {
            // 10번: SpellCalamity 굴림
            await this.rollSpellCalamity(actor, item);
        }

        // 매크로 호출
        await executeMacrosByPrefix(`spell-disaster-${result}-macro`);
    },

    /**
     * Create spell disaster applied effect
     * @param {Actor} actor
     * @param {number} resultNumber - Disaster table result number
     * @param {Object} attributes - Effect attributes (e.g., {init: -2})
     */
    async createSpellDisasterEffect(actor, resultNumber, attributes) {
        try {
            // 효과 이름
            const effectName = `${game.i18n.localize('DX3rd.SpellDisaster')}(${resultNumber})`;
            
            // 중복 체크: 같은 이름의 효과가 이미 있는지 확인
            const appliedEffects = actor.system?.attributes?.applied || {};
            let alreadyExists = false;
            
            for (const [appliedKey, appliedEffect] of Object.entries(appliedEffects)) {
                if (appliedEffect && appliedEffect.name === effectName) {
                    alreadyExists = true;
                    break;
                }
            }
            
            if (alreadyExists) {
                ui.notifications.info(`${effectName} 효과가 이미 적용되어 있습니다.`);
                return;
            }
            
            // 고유 키 생성
            const effectKey = `spell_disaster_${resultNumber}_${Date.now()}`;
            
            // applied 효과 데이터 생성
            const effectData = {
                name: effectName,
                source: actor.name,
                disable: 'scene', // 장면 종료 시 제거
                img: 'icons/svg/aura.svg',
                attributes: attributes
            };
            
            // system.attributes.applied에 추가
            await actor.update({
                [`system.attributes.applied.${effectKey}`]: effectData
            });
            
            ui.notifications.info(`${effectName} 효과가 적용되었습니다.`);
            
        } catch (error) {
            console.error("DX3rd | Error in createSpellDisasterEffect:", error);
            throw error;
        }
    },

    /**
     * Roll spell calamity table (1d10)
     * @param {Actor} actor
     * @param {Item} item
     */
    async rollSpellCalamity(actor, item) {
        // 1d10 굴림
        const roll = await new Roll("1d10").roll();
        const result = roll.total;

        // 결과에 따른 텍스트 가져오기
        const textKey = `DX3rd.SpellCalamityText${result}`;
        let resultText = game.i18n.localize(textKey);

        // 5번과 9번 결과는 count를 1d10으로 먼저 계산
        let countValue = null;
        let countRollObj = null;
        if ((result === 5 || result === 9) && resultText.includes('{count}')) {
            countRollObj = await new Roll("1d10").roll();
            countValue = countRollObj.total;
            
            // 9번 결과는 simplifiedDistance에 따라 메시지 다르게 처리
            if (result === 9) {
                const simplifiedDistance = game.settings.get('dx3rd-emanim', 'simplifiedDistance');
                // {count}점은 항상 countValue 사용
                resultText = resultText.replace('{count}점', `${countValue}점`);
                // {count}m은 simplifiedDistance에 따라 다르게 처리
                if (simplifiedDistance) {
                    const displayCount = Math.floor(countValue / 2);
                    resultText = resultText.replace('{count}m', `${displayCount}칸`);
                } else {
                    resultText = resultText.replace('{count}m', `${countValue}m`);
                }
            } else {
                resultText = resultText.replace(/{count}/g, countValue); // replaceAll 대신 정규식 사용
            }
        } else if (resultText.includes('{count}')) {
            // 기타 결과는 1d6 사용
            const countRoll = await new Roll("1d6").roll();
            resultText = resultText.replace('{count}', countRoll.total);
        }

        // 7번 결과는 damage를 2d10으로 먼저 계산
        let damageValue = null;
        let damageRollObj = null;
        if (result === 7 && resultText.includes('{damage}')) {
            damageRollObj = await new Roll("2d10").roll();
            damageValue = damageRollObj.total;
            resultText = resultText.replace('{damage}', damageValue);
        } else if (resultText.includes('{damage}')) {
            // 기타 결과는 1d6 사용
            const damageRoll = await new Roll("1d6").roll();
            resultText = resultText.replace('{damage}', damageRoll.total);
        }

        // 주사위 굴림 결과를 HTML로 변환하여 메시지에 포함
        const rollHTML = await roll.render();
        const rollMessage = `<div class="dice-roll">${rollHTML}</div>`;

        // 채팅 메시지 생성
        const content = `
            <div class="dx3rd-item-chat">
                <div class="item-header">
                    <strong>${game.i18n.localize('DX3rd.SpellCalamity')}</strong>
                </div>
                <div class="item-details">
                    <p><strong>${game.i18n.localize('DX3rd.DisasterResult')}:</strong> ${result}</p>
                    <p>${resultText}</p>
                </div>
                ${rollMessage}
            </div>
        `;

        const combinedContent = content;

        await ChatMessage.create({
            content: combinedContent,
            speaker: ChatMessage.getSpeaker({ actor: actor }),
            rolls: [roll]
        });

        // 특정 결과에 대한 효과 적용
        if (result === 1) {
            // 1번: 이동력 절반
            await this.createSpellCalamityEffect(actor, 1, {
                move_half: true
            });
        } else if (result === 4) {
            // 4번: 기본침식률 영구적으로 +1 (레코드 아이템 생성)
            await this.createSpellCalamityRecord(actor, 4);
        } else if (result === 5) {
            // 5번: 혀가 꼬부라진다 (count 라운드 동안 마술 사용 불가)
            // countValue는 이미 위에서 1d10으로 계산됨
            if (countValue === null) {
                // 혹시 countValue가 없으면 다시 굴림
                const countRoll = await new Roll("1d10").roll();
                countValue = countRoll.total;
            }
            await this.createSpellCalamityEffect(actor, 5, {
                spell_disabled: true,
                spell_disabled_count: countValue
            });
        } else if (result === 7) {
            // 7번: 2d10 HP 데미지 (장갑치 무시)
            // damageValue와 damageRollObj는 이미 위에서 2d10으로 계산됨
            if (damageValue === null || damageRollObj === null) {
                // 혹시 값이 없으면 다시 굴림
                damageRollObj = await new Roll("2d10").roll();
                damageValue = damageRollObj.total;
            }
            await this.applySpellCalamityDamage(actor, 7, damageValue, damageRollObj);
        } else if (result === 8) {
            // 8번: 이 표를 다시 한 번 굴린다. 그 결과는 당신의 로이스 중 한 명(GM이 결정)에게 적용된다.
            await this.handleSpellCalamity8(actor, item);
        } else if (result === 9) {
            // 9번: count만큼 하이라이트 + count만큼 HP 데미지
            // countValue와 countRollObj는 이미 위에서 1d10으로 계산됨
            if (countValue === null || countRollObj === null) {
                // 혹시 값이 없으면 다시 굴림
                countRollObj = await new Roll("1d10").roll();
                countValue = countRollObj.total;
            }
            await this.applySpellCalamityHighlightAndDamage(actor, 9, countValue, countRollObj);
        } else if (result === 10) {
            // 10번: SpellCatastrophe 굴림
            await this.rollSpellCatastrophe(actor, item);
        }

        // 매크로 호출
        await executeMacrosByPrefix(`spell-calamity-${result}-macro`);
    },

    /**
     * Apply SpellCalamity result to a specific actor
     * @param {Actor} actor - Target actor
     * @param {Item} item - Item for spell effect
     * @param {number} result - SpellCalamity result (1-10)
     * @param {string} resultText - Result text (with placeholders replaced)
     * @param {Roll} roll - Roll object
     * @param {number|null} countValue - Count value (for results 5, 9)
     * @param {Roll|null} countRollObj - Count roll object (for results 5, 9)
     * @param {number|null} damageValue - Damage value (for result 7)
     * @param {Roll|null} damageRollObj - Damage roll object (for result 7)
     */
    async applySpellCalamityResultToActor(actor, item, result, resultText, roll, countValue = null, countRollObj = null, damageValue = null, damageRollObj = null) {
        try {
            // 주사위 굴림 결과를 HTML로 변환하여 메시지에 포함
            const rollHTML = await roll.render();
            const rollMessage = `<div class="dice-roll">${rollHTML}</div>`;

            // 채팅 메시지 생성
            const content = `
                <div class="dx3rd-item-chat">
                    <div class="item-header">
                        <strong>${game.i18n.localize('DX3rd.SpellCalamity')}</strong>
                    </div>
                    <div class="item-details">
                        <p><strong>${game.i18n.localize('DX3rd.DisasterResult')}:</strong> ${result}</p>
                        <p>${resultText}</p>
                    </div>
                    ${rollMessage}
                </div>
            `;

            const combinedContent = content;

            await ChatMessage.create({
                content: combinedContent,
                speaker: ChatMessage.getSpeaker({ actor: actor }),
                rolls: [roll]
            });

            // 특정 결과에 대한 효과 적용
            if (result === 1) {
                // 1번: 이동력 절반
                await this.createSpellCalamityEffect(actor, 1, {
                    move_half: true
                });
            } else if (result === 4) {
                // 4번: 기본침식률 영구적으로 +1 (레코드 아이템 생성)
                await this.createSpellCalamityRecord(actor, 4);
            } else if (result === 5) {
                // 5번: 혀가 꼬부라진다 (count 라운드 동안 마술 사용 불가)
                if (countValue === null) {
                    if (countRollObj) {
                        countValue = countRollObj.total;
                    } else {
                        const countRoll = await new Roll("1d10").roll();
                        countValue = countRoll.total;
                    }
                }
                await this.createSpellCalamityEffect(actor, 5, {
                    spell_disabled: true,
                    spell_disabled_count: countValue
                });
            } else if (result === 7) {
                // 7번: 2d10 HP 데미지 (장갑치 무시)
                if (damageValue === null || damageRollObj === null) {
                    if (damageRollObj) {
                        damageValue = damageRollObj.total;
                    } else {
                        damageRollObj = await new Roll("2d10").roll();
                        damageValue = damageRollObj.total;
                    }
                }
                await this.applySpellCalamityDamage(actor, 7, damageValue, damageRollObj);
            } else if (result === 8) {
                // 8번: 이 표를 다시 한 번 굴린다. 그 결과는 당신의 로이스 중 한 명(GM이 결정)에게 적용된다.
                await this.handleSpellCalamity8(actor, item);
            } else if (result === 9) {
                // 9번: count만큼 하이라이트 + count만큼 HP 데미지
                if (countValue === null || countRollObj === null) {
                    if (countRollObj) {
                        countValue = countRollObj.total;
                    } else {
                        countRollObj = await new Roll("1d10").roll();
                        countValue = countRollObj.total;
                    }
                }
                await this.applySpellCalamityHighlightAndDamage(actor, 9, countValue, countRollObj);
            } else if (result === 10) {
                // 10번: SpellCatastrophe 굴림
                await this.rollSpellCatastrophe(actor, item);
            }

            // 매크로 호출
            await executeMacrosByPrefix(`spell-calamity-${result}-macro`);
        } catch (error) {
            console.error("DX3rd | Error in applySpellCalamityResultToActor:", error);
            throw error;
        }
    },

    /**
     * Roll spell catastrophe table (1d10)
     * @param {Actor} actor
     * @param {Item} item
     */
    async rollSpellCatastrophe(actor, item) {
        // 1d10 굴림
        const roll = await new Roll("1d10").roll();
        const result = roll.total;

        // 결과에 따른 텍스트 가져오기
        const textKey = `DX3rd.SpellCatastropheText${result}`;
        let resultText = game.i18n.localize(textKey);

        // {count} 치환 (2번 결과: 1d10)
        let countValue = null;
        if (result === 2 && resultText.includes('{count}')) {
            const countRoll = await new Roll("1d10").roll();
            countValue = countRoll.total;
            resultText = resultText.replace('{count}', countValue);
        }

        // {damage} 치환 (7번 결과)
        if (result === 7 && resultText.includes('{damage}')) {
            const damageRoll = await new Roll("1d6").roll();
            resultText = resultText.replace('{damage}', damageRoll.total);
        }

        // 주사위 굴림 결과를 HTML로 변환하여 메시지에 포함
        const rollHTML = await roll.render();
        const rollMessage = `<div class="dice-roll">${rollHTML}</div>`;

        // 채팅 메시지 생성
        const content = `
            <div class="dx3rd-item-chat">
                <div class="item-header">
                    <strong>${game.i18n.localize('DX3rd.SpellCatastrophe')}</strong>
                </div>
                <div class="item-details">
                    <p><strong>${game.i18n.localize('DX3rd.DisasterResult')}:</strong> ${result}</p>
                    <p>${resultText}</p>
                </div>
                ${rollMessage}
            </div>
        `;

        const combinedContent = content;

        await ChatMessage.create({
            content: combinedContent,
            speaker: ChatMessage.getSpeaker({ actor: actor }),
            rolls: [roll]
        });

        // 특정 결과에 대한 효과 적용
        if (result === 2) {
            // 2번: 기본침식률 영구적으로 +count (레코드 아이템 생성)
            // countValue는 이미 위에서 1d10으로 계산됨
            if (countValue === null) {
                // 혹시 countValue가 없으면 다시 굴림
                const countRoll = await new Roll("1d10").roll();
                countValue = countRoll.total;
            }
            await this.createSpellCatastropheRecord(actor, 2, countValue, resultText);
        } else if (result === 3) {
            // 3번: 시나리오 동안 마술 사용 불가
            await this.createSpellCatastropheEffect(actor, 3, {
                spell_disabled: true
            });
        } else if (result === 5) {
            // 5번: 로이스 하나를 타이터스로 변경
            await this.handleSpellCatastrophe5(actor);
        } else if (result === 7) {
            // 7번: 폭발 - 5d10 데미지 (자신 + 인접 그리드의 모든 캐릭터)
            await this.handleSpellCatastrophe7(actor);
        } else if (result === 8) {
            // 8번: 마술 대폭주표를 굴린다. 그 결과는 당신을 포함하여 당신과 같은 인게이지에 있는 모든 캐릭터에게 적용된다.
            await this.handleSpellCatastrophe8(actor, item);
        } else if (result === 9) {
            // 9번: 이 표를 다시 한 번 굴린다. 그 결과는 당신의 로이스 중 한 명(GM이 결정)에게 적용된다.
            await this.handleSpellCatastrophe9(actor, item);
        } else if (result === 10) {
            // 10번: 캐릭터가 게임에서 영원히 제거된다(타이터스 소비로 무효화 가능).
            // 비가역적이므로 자동 상태변화는 하지 않고 경고만 표시 — 실제 제거/타이터스 소비는 GM이 수동 처리.
            ui.notifications.warn(`${actor.name}: ${game.i18n.localize('DX3rd.SpellCatastropheText10')}`);
        }

        // 매크로 호출
        await executeMacrosByPrefix(`spell-catastrophe-${result}-macro`);
    },

    /**
     * Create spell calamity applied effect
     * @param {Actor} actor
     * @param {number} resultNumber - Calamity table result number
     * @param {Object} attributes - Effect attributes
     */
    async createSpellCalamityEffect(actor, resultNumber, attributes) {
        try {
            // 효과 이름
            const effectName = `${game.i18n.localize('DX3rd.SpellCalamity')}(${resultNumber})`;
            
            // 중복 체크: 같은 이름의 효과가 이미 있는지 확인
            const appliedEffects = actor.system?.attributes?.applied || {};
            let alreadyExists = false;
            
            for (const [appliedKey, appliedEffect] of Object.entries(appliedEffects)) {
                if (appliedEffect && appliedEffect.name === effectName) {
                    alreadyExists = true;
                    break;
                }
            }
            
            if (alreadyExists) {
                ui.notifications.info(`${effectName} 효과가 이미 적용되어 있습니다.`);
                return;
            }
            
            // 고유 키 생성
            const effectKey = `spell_calamity_${resultNumber}_${Date.now()}`;
            
            // applied 효과 데이터 생성
            const effectData = {
                name: effectName,
                source: actor.name,
                disable: 'scene', // 장면 종료 시 제거
                img: 'icons/svg/aura.svg',
                attributes: attributes
            };
            
            // system.attributes.applied에 추가
            await actor.update({
                [`system.attributes.applied.${effectKey}`]: effectData
            });
            
            ui.notifications.info(`${effectName} 효과가 적용되었습니다.`);
            
        } catch (error) {
            console.error("DX3rd | Error in createSpellCalamityEffect:", error);
            throw error;
        }
    },

    /**
     * Create spell calamity record item
     * @param {Actor} actor
     * @param {number} resultNumber - Calamity table result number
     */
    async createSpellCalamityRecord(actor, resultNumber, encroachmentValue = 1) {
        try {
            // 레코드 아이템 데이터 생성
            const recordData = {
                name: game.i18n.localize('DX3rd.SpellCalamity'),
                type: 'record',
                system: {
                    description: game.i18n.localize(`DX3rd.SpellCalamityText${resultNumber}`),
                    exp: 0,
                    encroachment: encroachmentValue
                }
            };

            // 레코드 아이템 생성
            await actor.createEmbeddedDocuments('Item', [recordData]);

            ui.notifications.info(`${game.i18n.localize('DX3rd.SpellCalamity')} 레코드가 추가되었고, 기본침식률이 ${encroachmentValue} 증가했습니다.`);
            
        } catch (error) {
            console.error("DX3rd | Error in createSpellCalamityRecord:", error);
            throw error;
        }
    },

    /**
     * Create spell catastrophe record item
     * @param {Actor} actor
     * @param {number} resultNumber - Catastrophe table result number
     * @param {number} encroachmentValue - Encroachment value to add
     * @param {string} description - Description text (with placeholders replaced)
     */
    async createSpellCatastropheRecord(actor, resultNumber, encroachmentValue, description) {
        try {
            // 레코드 아이템 데이터 생성
            const recordData = {
                name: game.i18n.localize('DX3rd.SpellCatastrophe'),
                type: 'record',
                system: {
                    description: description || game.i18n.localize(`DX3rd.SpellCatastropheText${resultNumber}`),
                    exp: 0,
                    encroachment: encroachmentValue
                }
            };

            // 레코드 아이템 생성
            await actor.createEmbeddedDocuments('Item', [recordData]);

            ui.notifications.info(`${game.i18n.localize('DX3rd.SpellCatastrophe')} 레코드가 추가되었고, 기본침식률이 ${encroachmentValue} 증가했습니다.`);
            
        } catch (error) {
            console.error("DX3rd | Error in createSpellCatastropheRecord:", error);
            throw error;
        }
    },

    /**
     * Create spell catastrophe applied effect
     * @param {Actor} actor
     * @param {number} resultNumber - Catastrophe table result number
     * @param {Object} attributes - Effect attributes
     */
    async createSpellCatastropheEffect(actor, resultNumber, attributes) {
        try {
            // 효과 이름
            const effectName = `${game.i18n.localize('DX3rd.SpellCatastrophe')}(${resultNumber})`;
            
            // 중복 체크: 같은 이름의 효과가 이미 있는지 확인
            const appliedEffects = actor.system?.attributes?.applied || {};
            let alreadyExists = false;
            
            for (const [appliedKey, appliedEffect] of Object.entries(appliedEffects)) {
                if (appliedEffect && appliedEffect.name === effectName) {
                    alreadyExists = true;
                    break;
                }
            }
            
            if (alreadyExists) {
                ui.notifications.info(`${effectName} 효과가 이미 적용되어 있습니다.`);
                return;
            }
            
            // 고유 키 생성
            const effectKey = `spell_catastrophe_${resultNumber}_${Date.now()}`;
            
            // applied 효과 데이터 생성
            const effectData = {
                name: effectName,
                source: actor.name,
                disable: 'session', // 시나리오 종료 시 제거
                img: 'icons/svg/aura.svg',
                attributes: attributes
            };
            
            // system.attributes.applied에 추가
            await actor.update({
                [`system.attributes.applied.${effectKey}`]: effectData
            });
            
            ui.notifications.info(`${effectName} 효과가 적용되었습니다.`);
            
        } catch (error) {
            console.error("DX3rd | Error in createSpellCatastropheEffect:", error);
            throw error;
        }
    },

    /**
     * Handle SpellCatastrophe 5: 로이스 하나를 타이터스로 변경
     * @param {Actor} actor
     */
    async handleSpellCatastrophe5(actor) {
        try {
            // 타이터스가 체크되지 않은 로이스 아이템 필터링
            // system.type이 "M", "D", "E"인 경우 제외, "S"와 "-"만 포함
            // system.titus가 true가 아닌 경우만 포함
            const availableRois = actor.items.filter(item => {
                if (item.type !== 'rois') return false;
                
                const roisType = item.system?.type;
                // "M", "D", "E"인 경우 제외
                if (roisType === 'M' || roisType === 'D' || roisType === 'E') return false;
                
                // "S" 또는 "-" 또는 undefined인 경우만 포함
                // system.titus가 true가 아닌 경우만 포함
                const titus = item.system?.titus;
                const isTitusChecked = titus === true || titus === "true" || titus === 1 || titus === "1";
                
                return !isTitusChecked;
            });

            // 타이터스화할 로이스가 없으면 메시지 출력
            if (availableRois.length === 0) {
                const content = `
                    <div class="dx3rd-item-chat">
                        <div class="item-header">
                            <strong>${game.i18n.localize('DX3rd.SpellCatastrophe')}</strong>
                        </div>
                        <div class="item-details">
                            <p>${game.i18n.localize('DX3rd.SpellCatastropheText5-1')}</p>
                        </div>
                    </div>
                `;

                await ChatMessage.create({
                    content: content,
                    speaker: ChatMessage.getSpeaker({ actor: actor })
                });
                return;
            }

            // 드롭다운 옵션 생성
            const options = availableRois.map(rois => 
                `<option value="${rois.id}">${rois.name}</option>`
            ).join('');

            const template = `
                <div class="spell-catastrophe-5-dialog">
                    <div class="form-group">
                        <label>${game.i18n.localize('DX3rd.SpellCatastropheText5')}</label>
                        <select id="rois-select" style="width: 100%; text-align: center;">
                            <option value="">-</option>
                            ${options}
                        </select>
                    </div>
                </div>
                <style>
                .spell-catastrophe-5-dialog {
                    padding: 5px;
                }
                .spell-catastrophe-5-dialog .form-group {
                    display: flex;
                    flex-direction: column;
                    gap: 8px;
                    margin-top: 0px;
                    margin-bottom: 5px;
                }
                .spell-catastrophe-5-dialog label {
                    font-weight: bold;
                    font-size: 14px;
                }
                .spell-catastrophe-5-dialog select {
                    padding: 4px;
                    font-size: 14px;
                    border: 1px solid #ccc;
                    border-radius: 4px;
                    background: white;
                    color: black;
                }
                </style>
            `;

            const selectedId = await promptRoisSelection({
                title: game.i18n.localize('DX3rd.SpellCatastrophe'),
                content: template
            });
            if (!selectedId) return;

            const selectedRois = actor.items.get(selectedId);
            if (!selectedRois) {
                ui.notifications.error('선택한 로이스를 찾을 수 없습니다.');
                return;
            }

            // 타이터스 체크
            await selectedRois.update({
                'system.titus': true
            });

            // 채팅 메시지 출력
            const content = `
                <div class="dx3rd-item-chat">
                    <div class="item-details">
                        <p>${game.i18n.localize('DX3rd.Titus')}(${selectedRois.name})</p>
                    </div>
                </div>
            `;

            await ChatMessage.create({
                content: content,
                speaker: ChatMessage.getSpeaker({ actor: actor })
            });

        } catch (error) {
            console.error("DX3rd | Error in handleSpellCatastrophe5:", error);
            ui.notifications.error("SpellCatastrophe 5 처리 중 오류가 발생했습니다.");
        }
    },

    /**
     * Select a rois item (for SpellDisaster 4, SpellCalamity 8, SpellCatastrophe 9)
     * Filters: Exclude E, D, M types, exclude sublimation checked
     * If non-GM user, sends socket request to GM
     * @param {Actor} actor
     * @param {string} textKey - Localization key for dialog label
     * @param {string} title - Dialog title
     * @param {string} requestType - Socket request type ('spellDisaster4', 'spellCalamity8', 'spellCatastrophe9')
     * @param {Item} item - Item for spell effect
     * @returns {Promise<Item|null>} Selected rois item or null if cancelled
     */
    async selectRoisForSpellEffect(actor, textKey, title, requestType = null, item = null) {
        try {
            // GM이 아닌 경우 소켓으로 GM에게 전송
            if (!game.user.isGM && requestType) {
                const availableRois = actor.items.filter(item => {
                    if (item.type !== 'rois') return false;
                    const roisType = item.system?.type;
                    if (roisType === 'M' || roisType === 'D' || roisType === 'E') return false;
                    const sublimation = item.system?.sublimation;
                    const isSublimationChecked = sublimation === true || sublimation === "true" || sublimation === 1 || sublimation === "1";
                    return !isSublimationChecked;
                });

                if (availableRois.length === 0) {
                    ui.notifications.warn('적용할 수 있는 로이스가 없습니다.');
                    return null;
                }

                // 소켓으로 GM에게 전송
                game.socket.emit('system.dx3rd-emanim', {
                    type: 'spellRoisSelectRequest',
                    requestData: {
                        actorId: actor.id,
                        textKey: textKey,
                        title: title,
                        requestType: requestType,
                        itemId: item?.id || null,
                        availableRois: availableRois.map(rois => ({
                            id: rois.id,
                            name: rois.name
                        }))
                    }
                });

                ui.notifications.info('GM에게 로이스 선택 요청을 보냈습니다.');
                return null; // 비동기 처리이므로 null 반환
            }

            // GM인 경우 직접 다이얼로그 표시
            // 로이스 아이템 필터링
            // system.type이 "M", "D", "E"인 경우 제외
            // system.sublimation이 체크된 경우 제외
            const availableRois = actor.items.filter(item => {
                if (item.type !== 'rois') return false;
                
                const roisType = item.system?.type;
                // "M", "D", "E"인 경우 제외
                if (roisType === 'M' || roisType === 'D' || roisType === 'E') return false;
                
                // system.sublimation이 체크된 경우 제외
                const sublimation = item.system?.sublimation;
                const isSublimationChecked = sublimation === true || sublimation === "true" || sublimation === 1 || sublimation === "1";
                
                return !isSublimationChecked;
            });

            if (availableRois.length === 0) {
                ui.notifications.warn('적용할 수 있는 로이스가 없습니다.');
                return null;
            }

            // 드롭다운 옵션 생성
            const options = availableRois.map(rois => 
                `<option value="${rois.id}">${rois.name}</option>`
            ).join('');

            const template = `
                <div class="spell-rois-select-dialog">
                    <div class="form-group">
                        <label>${game.i18n.localize(textKey)}</label>
                        <select id="rois-select" style="width: 100%; text-align: center;">
                            <option value="">-</option>
                            ${options}
                        </select>
                    </div>
                </div>
                <style>
                .spell-rois-select-dialog {
                    padding: 5px;
                }
                .spell-rois-select-dialog .form-group {
                    display: flex;
                    flex-direction: column;
                    gap: 8px;
                    margin-top: 0px;
                    margin-bottom: 5px;
                }
                .spell-rois-select-dialog label {
                    font-weight: bold;
                    font-size: 14px;
                }
                .spell-rois-select-dialog select {
                    padding: 4px;
                    font-size: 14px;
                    border: 1px solid #ccc;
                    border-radius: 4px;
                    background: white;
                    color: black;
                }
                </style>
            `;

            const selectedId = await promptRoisSelection({
                title: title,
                content: template
            });
            if (!selectedId) return null;

            const selectedRois = actor.items.get(selectedId);
            if (!selectedRois) {
                ui.notifications.error('선택한 로이스를 찾을 수 없습니다.');
                return null;
            }

            return selectedRois;
        } catch (error) {
            console.error("DX3rd | Error in selectRoisForSpellEffect:", error);
            ui.notifications.error("로이스 선택 중 오류가 발생했습니다.");
            return null;
        }
    },

    /**
     * Find actor with the same name as the rois item
     * @param {string} roisName - Name of the rois item
     * @returns {Actor|null} Actor with matching name or null
     */
    findActorByRoisName(roisName) {
        // 모든 액터에서 같은 이름을 가진 액터 찾기
        const matchingActor = game.actors.find(actor => actor.name === roisName);
        return matchingActor || null;
    },

    /**
     * Handle SpellDisaster 4: 이 표를 다시 한 번 굴린다. 그 결과는 당신의 로이스 중 한 명(GM이 결정)에게 적용된다.
     * @param {Actor} actor
     * @param {Item} item
     */
    async handleSpellDisaster4(actor, item) {
        try {
            // 로이스 선택
            const selectedRois = await this.selectRoisForSpellEffect(
                actor,
                'DX3rd.SpellDisasterText4',
                game.i18n.localize('DX3rd.SpellDisaster'),
                'spellDisaster4',
                item
            );

            if (!selectedRois) {
                return; // 취소됨 또는 비GM 유저가 소켓 전송
            }

            // 선택한 로이스와 같은 이름의 액터 찾기
            const targetActor = this.findActorByRoisName(selectedRois.name);
            if (!targetActor) {
                ui.notifications.error(`"${selectedRois.name}"와 같은 이름을 가진 액터를 찾을 수 없습니다.`);
                return;
            }

            // SpellDisaster를 다시 굴림 (대상 액터에게)
            await this.rollSpellDisaster(targetActor, item);
        } catch (error) {
            console.error("DX3rd | Error in handleSpellDisaster4:", error);
            ui.notifications.error("SpellDisaster 4 처리 중 오류가 발생했습니다.");
        }
    },

    /**
     * Handle SpellCalamity 8: 이 표를 다시 한 번 굴린다. 그 결과는 당신의 로이스 중 한 명(GM이 결정)에게 적용된다.
     * @param {Actor} actor
     * @param {Item} item
     */
    async handleSpellCalamity8(actor, item) {
        try {
            // 로이스 선택
            const selectedRois = await this.selectRoisForSpellEffect(
                actor,
                'DX3rd.SpellCalamityText8',
                game.i18n.localize('DX3rd.SpellCalamity'),
                'spellCalamity8',
                item
            );

            if (!selectedRois) {
                return; // 취소됨 또는 비GM 유저가 소켓 전송
            }

            // 선택한 로이스와 같은 이름의 액터 찾기
            const targetActor = this.findActorByRoisName(selectedRois.name);
            if (!targetActor) {
                ui.notifications.error(`"${selectedRois.name}"와 같은 이름을 가진 액터를 찾을 수 없습니다.`);
                return;
            }

            // SpellCalamity를 다시 굴림 (대상 액터에게)
            await this.rollSpellCalamity(targetActor, item);
        } catch (error) {
            console.error("DX3rd | Error in handleSpellCalamity8:", error);
            ui.notifications.error("SpellCalamity 8 처리 중 오류가 발생했습니다.");
        }
    },

    /**
     * Handle SpellCatastrophe 9: 이 표를 다시 한 번 굴린다. 그 결과는 당신의 로이스 중 한 명(GM이 결정)에게 적용된다.
     * @param {Actor} actor
     * @param {Item} item
     */
    async handleSpellCatastrophe9(actor, item) {
        try {
            // 로이스 선택
            const selectedRois = await this.selectRoisForSpellEffect(
                actor,
                'DX3rd.SpellCatastropheText9',
                game.i18n.localize('DX3rd.SpellCatastrophe'),
                'spellCatastrophe9',
                item
            );

            if (!selectedRois) {
                return; // 취소됨 또는 비GM 유저가 소켓 전송
            }

            // 선택한 로이스와 같은 이름의 액터 찾기
            const targetActor = this.findActorByRoisName(selectedRois.name);
            if (!targetActor) {
                ui.notifications.error(`"${selectedRois.name}"와 같은 이름을 가진 액터를 찾을 수 없습니다.`);
                return;
            }

            // SpellCatastrophe를 다시 굴림 (대상 액터에게)
            await this.rollSpellCatastrophe(targetActor, item);
        } catch (error) {
            console.error("DX3rd | Error in handleSpellCatastrophe9:", error);
            ui.notifications.error("SpellCatastrophe 9 처리 중 오류가 발생했습니다.");
        }
    },

    /**
     * Handle SpellCatastrophe 8: 마술 대폭주표를 굴린다. 그 결과는 당신을 포함하여 당신과 같은 인게이지에 있는 모든 캐릭터에게 적용된다.
     * GM이 아닌 경우 소켓으로 전송, GM인 경우 직접 처리
     * @param {Actor} actor
     * @param {Item} item
     */
    async handleSpellCatastrophe8(actor, item) {
        try {
            // GM이 아닌 경우 소켓으로 전송
            if (!game.user.isGM) {
                game.socket.emit('system.dx3rd-emanim', {
                    type: 'spellCatastrophe8Request',
                    requestData: {
                        actorId: actor.id,
                        itemId: item?.id || null
                    }
                });
                ui.notifications.info('GM에게 SpellCatastrophe 8 처리 요청을 보냈습니다.');
                return;
            }

            // GM인 경우 직접 처리
            await this.executeSpellCatastrophe8(actor, item);
        } catch (error) {
            console.error("DX3rd | Error in handleSpellCatastrophe8:", error);
            ui.notifications.error("SpellCatastrophe 8 처리 중 오류가 발생했습니다.");
        }
    },

    /**
     * Execute SpellCatastrophe 8: 마술 대폭주표를 굴린다. 그 결과는 당신을 포함하여 당신과 같은 인게이지에 있는 모든 캐릭터에게 적용된다.
     * @param {Actor} actor
     * @param {Item} item
     */
    async executeSpellCatastrophe8(actor, item) {
        try {
            // 대상 액터 찾기 (본인 + 인접 그리드의 다른 토큰 액터)
            const targetActors = [];
            
            // 본인 추가
            targetActors.push(actor);
            
            // 자신의 토큰 찾기
            const actorToken = actor.getActiveTokens()[0] || canvas.tokens.placeables.find(t => t.actor?.id === actor.id);
            if (actorToken) {
                // 인접 그리드 찾기
                const handler = window.DX3rdUniversalHandler;
                if (handler && handler.getAdjacentGrids) {
                    const adjacentGrids = handler.getAdjacentGrids(actorToken);
                    
                    // 각 인접 그리드에 있는 토큰 찾기
                    for (const gridPos of adjacentGrids) {
                        // gridPos는 { x, y } 픽셀 좌표
                        // 해당 위치에 있는 토큰 찾기
                        const tokensAtGrid = canvas.tokens.placeables.filter(t => {
                            if (!t.actor || t.actor.type !== 'character') return false;
                            if (t.actor.id === actor.id) return false; // 자신은 이미 추가됨
                            
                            // 토큰의 중심점
                            const tokenCenter = t.center;
                            
                            // 그리드 좌표로 변환하여 거리 계산
                            const tokenGrid = canvas.grid.getOffset({ x: tokenCenter.x, y: tokenCenter.y });
                            const targetGrid = canvas.grid.getOffset({ x: gridPos.x, y: gridPos.y });
                            
                            const dx = tokenGrid.i - targetGrid.i;
                            const dy = tokenGrid.j - targetGrid.j;
                            const distance = Math.sqrt(dx * dx + dy * dy);
                            
                            // 거리가 0.5 이하면 같은 그리드로 간주
                            return distance <= 0.5;
                        });
                        
                        // 중복 제거하면서 추가
                        for (const token of tokensAtGrid) {
                            if (token.actor && !targetActors.find(a => a.id === token.actor.id)) {
                                targetActors.push(token.actor);
                            }
                        }
                    }
                }
            }

            // SpellCalamity를 한 번만 굴림
            const roll = await new Roll("1d10").roll();
            const result = roll.total;

            // 결과에 따른 텍스트 가져오기
            const textKey = `DX3rd.SpellCalamityText${result}`;
            let resultText = game.i18n.localize(textKey);

            // 5번과 9번 결과는 count를 1d10으로 먼저 계산
            let countValue = null;
            let countRollObj = null;
            if ((result === 5 || result === 9) && resultText.includes('{count}')) {
                countRollObj = await new Roll("1d10").roll();
                countValue = countRollObj.total;
                
                // 9번 결과는 simplifiedDistance에 따라 메시지 다르게 처리
                if (result === 9) {
                    const simplifiedDistance = game.settings.get('dx3rd-emanim', 'simplifiedDistance');
                    // {count}점은 항상 countValue 사용
                    resultText = resultText.replace('{count}점', `${countValue}점`);
                    // {count}m은 simplifiedDistance에 따라 다르게 처리
                    if (simplifiedDistance) {
                        const displayCount = Math.max(1, Math.floor(countValue / 2));
                        resultText = resultText.replace('{count}m', `${displayCount}칸`);
                    } else {
                        resultText = resultText.replace('{count}m', `${countValue}m`);
                    }
                } else {
                    resultText = resultText.replace(/{count}/g, countValue);
                }
            } else if (resultText.includes('{count}')) {
                // 기타 결과는 1d6 사용
                const countRoll = await new Roll("1d6").roll();
                resultText = resultText.replace('{count}', countRoll.total);
            }

            // 7번 결과는 damage를 2d10으로 먼저 계산
            let damageValue = null;
            let damageRollObj = null;
            if (result === 7 && resultText.includes('{damage}')) {
                damageRollObj = await new Roll("2d10").roll();
                damageValue = damageRollObj.total;
                resultText = resultText.replace('{damage}', damageValue);
            } else if (resultText.includes('{damage}')) {
                // 기타 결과는 1d6 사용
                const damageRoll = await new Roll("1d6").roll();
                resultText = resultText.replace('{damage}', damageRoll.total);
            }

            // 각 대상 액터에게 동일한 SpellCalamity 결과 적용
            for (const targetActor of targetActors) {
                if (!targetActor) continue;
                await this.applySpellCalamityResultToActor(
                    targetActor,
                    item,
                    result,
                    resultText,
                    roll,
                    countValue,
                    countRollObj,
                    damageValue,
                    damageRollObj
                );
            }
        } catch (error) {
            console.error("DX3rd | Error in executeSpellCatastrophe8:", error);
            ui.notifications.error("SpellCatastrophe 8 실행 중 오류가 발생했습니다.");
            throw error;
        }
    },

    /**
     * Handle SpellCatastrophe 7: 폭발 - 5d10 데미지 (자신 + 인접 그리드의 모든 캐릭터)
     * GM이 아닌 경우 소켓으로 전송, GM인 경우 직접 처리
     * @param {Actor} actor
     */
    async handleSpellCatastrophe7(actor) {
        try {
            // GM이 아닌 경우 소켓으로 전송
            if (!game.user.isGM) {
                game.socket.emit('system.dx3rd-emanim', {
                    type: 'spellCatastrophe7Request',
                    requestData: {
                        actorId: actor.id
                    }
                });
                ui.notifications.info('GM에게 SpellCatastrophe 7 처리 요청을 보냈습니다.');
                return;
            }

            // GM인 경우 직접 처리
            await this.executeSpellCatastrophe7(actor);
        } catch (error) {
            console.error("DX3rd | Error in handleSpellCatastrophe7:", error);
            ui.notifications.error("SpellCatastrophe 7 처리 중 오류가 발생했습니다.");
        }
    },

    /**
     * Execute SpellCatastrophe 7: 폭발 - 5d10 데미지 (자신 + 인접 그리드의 모든 캐릭터)
     * @param {Actor} actor
     */
    async executeSpellCatastrophe7(actor) {
        try {
            // 5d10 데미지 굴림
            const damageRoll = await new Roll("5d10").roll();
            const damageAmount = damageRoll.total;

            // 롤 결과를 HTML로 변환
            const rollHTML = await damageRoll.render();
            const rollMessage = `<div class="dice-roll">${rollHTML}</div>`;

            // 대상 토큰 찾기 (자신 + 인접 그리드의 모든 캐릭터)
            const targetActors = [];
            
            // 자신의 토큰 찾기
            const actorToken = actor.getActiveTokens()[0] || canvas.tokens.placeables.find(t => t.actor?.id === actor.id);
            if (actorToken) {
                // 토큰이 있으면 인접한 캐릭터까지 포함
                targetActors.push(actor);
                
                // 인접 그리드 찾기
                const handler = window.DX3rdUniversalHandler;
                if (handler && handler.getAdjacentGrids) {
                    const adjacentGrids = handler.getAdjacentGrids(actorToken);
                    
                    // 각 인접 그리드에 있는 토큰 찾기
                    for (const gridPos of adjacentGrids) {
                        // gridPos는 { x, y } 픽셀 좌표
                        // 해당 위치에 있는 토큰 찾기
                        const tokensAtGrid = canvas.tokens.placeables.filter(t => {
                            if (!t.actor || t.actor.type !== 'character') return false;
                            if (t.actor.id === actor.id) return false; // 자신은 이미 추가됨
                            
                            // 토큰의 중심점
                            const tokenCenter = t.center;
                            
                            // 그리드 좌표로 변환하여 거리 계산
                            const tokenGrid = canvas.grid.getOffset({ x: tokenCenter.x, y: tokenCenter.y });
                            const targetGrid = canvas.grid.getOffset({ x: gridPos.x, y: gridPos.y });
                            
                            const dx = tokenGrid.i - targetGrid.i;
                            const dy = tokenGrid.j - targetGrid.j;
                            const distance = Math.sqrt(dx * dx + dy * dy);
                            
                            // 거리가 0.5 이하면 같은 그리드로 간주
                            return distance <= 0.5;
                        });
                        
                        // 중복 제거하면서 추가
                        for (const token of tokensAtGrid) {
                            if (token.actor && !targetActors.find(a => a.id === token.actor.id)) {
                                targetActors.push(token.actor);
                            }
                        }
                    }
                }
            } else {
                // 토큰이 없으면 해당 액터에게만 데미지
                targetActors.push(actor);
            }

            // 각 대상에게 데미지 적용
            const damageMessages = [];
            for (const targetActor of targetActors) {
                if (!targetActor) continue;

                // 현재 HP와 reduce 값 가져오기
                const currentHP = targetActor.system?.attributes?.hp?.value || 0;
                const reduce = targetActor.system?.attributes?.reduce?.value || 0;

                // 실제 데미지 = 롤 데미지 - 데미지 경감 (장갑치는 무시, reduce만 고려)
                const actualDamage = Math.max(0, damageAmount - reduce);

                // HP 업데이트
                const newHP = Math.max(0, currentHP - actualDamage);
                const actualHpLoss = currentHP - newHP;
                await targetActor.update({ 'system.attributes.hp.value': newHP });

                // 데미지 메시지 생성
                const damageText = `${targetActor.name}: HP ${actualHpLoss} 데미지 (${game.i18n.localize('DX3rd.SpellCatastrophe')})`;
                damageMessages.push(damageText);
            }

            // 통합 데미지 메시지 출력
            const damageText = damageMessages.join('<br>');
            const content = `<div class="dx3rd-item-chat"><div class="item-details"><p>${damageText}</p></div>${rollMessage}</div>`;

            await ChatMessage.create({
                speaker: ChatMessage.getSpeaker({ actor: actor }),
                content: content,
                flags: {
                    'dx3rd-emanim': {
                        messageType: 'damage'
                    }
                }
            });

        } catch (error) {
            console.error("DX3rd | Error in executeSpellCatastrophe7:", error);
            ui.notifications.error("SpellCatastrophe 7 실행 중 오류가 발생했습니다.");
            throw error;
        }
    },

    /**
     * Apply spell calamity damage
     * @param {Actor} actor
     * @param {number} resultNumber - Calamity table result number
     * @param {number} damageAmount - Pre-calculated damage amount (optional)
     * @param {Roll} damageRoll - Pre-rolled damage roll object (optional)
     */
    async applySpellCalamityDamage(actor, resultNumber, damageAmount = null, damageRoll = null) {
        try {
            // damageAmount나 damageRoll이 없으면 2d10 굴림
            if (damageAmount === null || damageRoll === null) {
                damageRoll = await new Roll("2d10").roll();
                damageAmount = damageRoll.total;
            }
            
            // 롤 결과를 HTML로 변환
            const rollHTML = await damageRoll.render();
            const rollMessage = `<div class="dice-roll">${rollHTML}</div>`;
            
            // 현재 HP와 reduce 값 가져오기
            const currentHP = actor.system?.attributes?.hp?.value || 0;
            const reduce = actor.system?.attributes?.reduce?.value || 0;
            
            // 실제 데미지 = 롤 데미지 - 데미지 경감 (장갑치는 무시, reduce만 고려)
            const actualDamage = Math.max(0, damageAmount - reduce);
            
            // HP 업데이트
            const newHP = Math.max(0, currentHP - actualDamage);
            const actualHpLoss = currentHP - newHP;  // 실제 HP 감소량
            await actor.update({ 'system.attributes.hp.value': newHP });
            
            // 데미지 메시지 출력 (extend처럼)
            const damageText = `HP ${actualHpLoss} 데미지 (${game.i18n.localize('DX3rd.SpellCalamity')})`;
            const content = `<div class="dx3rd-item-chat"><div class="item-details"><p>${damageText}</p></div>${rollMessage}</div>`;
            
            await ChatMessage.create({
                speaker: ChatMessage.getSpeaker({ actor: actor }),
                content: content,
                flags: {
                    'dx3rd-emanim': {
                        messageType: 'damage'
                    }
                }
            });
            
        } catch (error) {
            console.error("DX3rd | Error in applySpellCalamityDamage:", error);
            throw error;
        }
    },

    /**
     * Apply spell calamity highlight and damage
     * @param {Actor} actor
     * @param {number} resultNumber - Calamity table result number
     * @param {number} count - Count value (1d10 result)
     * @param {Roll} countRoll - Count roll object (optional)
     */
    async applySpellCalamityHighlightAndDamage(actor, resultNumber, count, countRoll = null) {
        try {
            const simplifiedDistance = game.settings.get('dx3rd-emanim', 'simplifiedDistance');
            
            // 하이라이트 칸 수 계산 (최소값 1)
            const highlightRange = simplifiedDistance ? Math.max(1, Math.floor(count / 2)) : count;
            
            // 하이라이트 설정 (캔버스에 직접 그리기, 토큰을 따라오지 않음)
            const tokens = actor.getActiveTokens();
            if (tokens.length > 0 && highlightRange > 0) {
                const token = tokens[0];
                const handler = window.DX3rdUniversalHandler;
                
                if (handler) {
                    // 토큰의 현재 위치 저장 (하이라이트는 이 위치에 고정)
                    const tokenPosition = {
                        x: token.document.x,
                        y: token.document.y,
                        width: token.document.width,
                        height: token.document.height
                    };
                    
                    // 사용자 색상 가져오기
                    const useUserColor = game.settings.get('dx3rd-emanim', 'rangeHighlightColor') === true;
                    let userColorValue = null;
                    
                    if (useUserColor && game.user?.color) {
                        if (typeof game.user.color === 'object' && game.user.color !== null) {
                            userColorValue = Number(game.user.color);
                        } else if (typeof game.user.color === 'string') {
                            const hexColor = game.user.color.replace('#', '');
                            userColorValue = parseInt(hexColor, 16);
                        } else if (typeof game.user.color === 'number') {
                            userColorValue = game.user.color;
                        }
                    }
                    
                    // 하이라이트 데이터 저장 (토큰 이동 감지용)
                    const highlightData = {
                        actorId: actor.id,
                        tokenId: token.id,
                        range: highlightRange,
                        userColor: userColorValue,
                        position: tokenPosition,
                        timestamp: Date.now()
                    };
                    
                    // SpellCalamity 하이라이트 데이터 저장 (토큰 이동 감지용)
                    if (!window.DX3rdSpellCalamityHighlightData) {
                        window.DX3rdSpellCalamityHighlightData = [];
                    }
                    window.DX3rdSpellCalamityHighlightData.push(highlightData);
                    
                    // 하이라이트 그리기 (캔버스에 직접, 저장된 위치 사용)
                    await this.drawSpellCalamityHighlight(token, highlightRange, userColorValue, tokenPosition);
                    
                    // 다른 사용자들에게도 소켓으로 전송
                    game.socket.emit('system.dx3rd-emanim', {
                        type: 'setSpellCalamityHighlight',
                        data: highlightData
                    });
                    
                    // 토큰 이동 감지 후크 등록 (한 번만)
                    if (!window.DX3rdSpellCalamityTokenMoveHook) {
                        window.DX3rdSpellCalamityTokenMoveHook = Hooks.on('updateToken', async (tokenDoc, updateData, options, userId) => {
                            if (window.DX3rdSpellHandler && window.DX3rdSpellHandler.handleTokenMoveForSpellCalamity) {
                                await window.DX3rdSpellHandler.handleTokenMoveForSpellCalamity(tokenDoc, updateData);
                            }
                        });
                    }
                }
            }
            
            // HP 데미지 적용 (count만큼)
            const currentHP = actor.system?.attributes?.hp?.value || 0;
            const reduce = actor.system?.attributes?.reduce?.value || 0;
            
            // 실제 데미지 = count - 데미지 경감 (장갑치는 무시, reduce만 고려)
            const actualDamage = Math.max(0, count - reduce);
            
            // HP 업데이트
            const newHP = Math.max(0, currentHP - actualDamage);
            const actualHpLoss = currentHP - newHP;  // 실제 HP 감소량
            await actor.update({ 'system.attributes.hp.value': newHP });
            
            // 데미지 메시지 출력 (주사위 결과 포함)
            let damageText = `HP ${actualHpLoss} 데미지 (${game.i18n.localize('DX3rd.SpellCalamity')})`;
            let rollMessage = '';
            
            if (countRoll) {
                // 주사위 결과를 HTML로 변환
                const rollHTML = await countRoll.render();
                rollMessage = `<div class="dice-roll">${rollHTML}</div>`;
            }
            
            const content = rollMessage 
                ? `<div class="dx3rd-item-chat"><div class="item-details"><p>${damageText}</p></div>${rollMessage}</div>`
                : `<div class="dx3rd-item-chat"><div class="item-details"><p>${damageText}</p></div></div>`;
            
            await ChatMessage.create({
                speaker: ChatMessage.getSpeaker({ actor: actor }),
                content: content,
                flags: {
                    'dx3rd-emanim': {
                        messageType: 'damage'
                    }
                }
            });
            
        } catch (error) {
            console.error("DX3rd | Error in applySpellCalamityHighlightAndDamage:", error);
            throw error;
        }
    },

    /**
     * Draw spell calamity highlight on canvas (fixed position, doesn't follow token)
     * @param {Token} token - Token to use for position reference (or position object)
     * @param {number} range - Range value
     * @param {number} userColor - User color value
     * @param {Object} position - Fixed position object (optional, if not provided uses token position)
     */
    async drawSpellCalamityHighlight(token, range, userColor, position = null) {
        try {
            const handler = window.DX3rdUniversalHandler;
            if (!handler) return;
            
            // Graphics 객체 배열 초기화
            if (!window.DX3rdSpellCalamityHighlights) {
                window.DX3rdSpellCalamityHighlights = [];
            }
            
            // 기존 Graphics 객체 제거
            for (const graphics of window.DX3rdSpellCalamityHighlights) {
                if (graphics && graphics.parent) {
                    graphics.parent.removeChild(graphics);
                    graphics.destroy();
                }
            }
            window.DX3rdSpellCalamityHighlights = [];
            
            // 저장된 위치 사용 (토큰을 따라오지 않도록)
            const usePosition = position || {
                x: token.document.x,
                y: token.document.y,
                width: token.document.width,
                height: token.document.height
            };
            
            // 위치를 그리드 좌표로 변환 (기존 시스템과 동일한 방식)
            // getSnappedPosition은 doc에서 호출해야 하므로, 직접 그리드 좌표 계산
            const baseOff = canvas.grid.getOffset({ x: usePosition.x, y: usePosition.y });
            
            // 토큰이 점유하는 그리드 계산
            const tokenWidth = usePosition.width || 1;
            const tokenHeight = usePosition.height || 1;
            const occupied = [];
            for (let i = 0; i < tokenWidth; i++) {
                for (let j = 0; j < tokenHeight; j++) {
                    occupied.push({ i: baseOff.i + i, j: baseOff.j + j });
                }
            }
            
            // 범위 내 그리드 계산 (기존 시스템과 동일한 방식)
            const minI = Math.min(...occupied.map(c => c.i));
            const maxI = Math.max(...occupied.map(c => c.i));
            const minJ = Math.min(...occupied.map(c => c.j));
            const maxJ = Math.max(...occupied.map(c => c.j));
            
            const key = (i, j) => `${i},${j}`;
            const occSet = new Set(occupied.map(c => key(c.i, c.j)));
            
            // 후보 그리드 생성
            const candidates = [];
            for (let i = minI - range; i <= maxI + range; i++) {
                for (let j = minJ - range; j <= maxJ + range; j++) {
                    if (occSet.has(key(i, j))) continue; // 점유 칸 제외
                    candidates.push({ i, j });
                }
            }
            
            // 거리 계산 (기존 시스템과 동일: measurePath 사용)
            const centerOf = ({ i, j }) => canvas.grid.getCenterPoint({ i, j });
            function gridDistCenters(a, b) {
                const res = canvas.grid.measurePath([a, b], { gridSpaces: true });
                if (typeof res === "number") return res;
                if (res && typeof res.distance === "number") return res.distance;
                if (Array.isArray(res) && res[0]?.distance != null) return res[0].distance;
                return 0;
            }
            
            const within = [];
            for (const c of candidates) {
                const cC = centerOf(c);
                let dmin = Infinity;
                for (const o of occupied) {
                    const d = gridDistCenters(centerOf(o), cC);
                    if (d < dmin) dmin = d;
                    if (dmin === 0) break;
                }
                if (dmin >= 1 && dmin <= range) within.push({ ...c, dist: dmin });
            }
            
            // 중복 제거 + 정렬
            const result = [...new Map(within.map(c => [key(c.i, c.j), c])).values()]
                .sort((a, b) => a.j - b.j || a.i - b.i);
            
            // 토큰 중심점 계산 (저장된 위치 기준)
            const tokenCenterX = usePosition.x + (usePosition.width * canvas.grid.size) / 2;
            const tokenCenterY = usePosition.y + (usePosition.height * canvas.grid.size) / 2;
            const tokenCenter = { x: tokenCenterX, y: tokenCenterY };
            
            // 벽 충돌 체크 후 최종 그리드 선택
            const grids = [];
            for (const { i, j } of result) {
                const centerPoint = centerOf({ i, j });
                
                // 벽 충돌 체크: 토큰 중심에서 그리드 중심까지
                const hasWall = handler.checkWallCollision 
                    ? handler.checkWallCollision(tokenCenter, centerPoint)
                    : false;
                
                if (!hasWall) {
                    grids.push({ x: centerPoint.x, y: centerPoint.y });
                }
            }
            
            // 하이라이트 그리기 (기존 시스템과 동일한 방식)
            const gridSize = canvas.grid.size;
            const color = userColor || 0x00FF00; // 기본 색상: 녹색
            const gridType = canvas.grid.type;
            
            for (const grid of grids) {
                const graphics = new PIXI.Graphics();
                
                // 기존 시스템과 동일하게 beginFill만 사용 (lineStyle 없음)
                graphics.beginFill(color, 0.2);
                
                if (gridType === CONST.GRID_TYPES.SQUARE || gridType === CONST.GRID_TYPES.GRIDLESS) {
                    // 정사각형 그리드: 사각형 (중심점 기준, 1px 안쪽)
                    const centerX = grid.x; // 이미 중심점
                    const centerY = grid.y; // 이미 중심점
                    const halfSize = (gridSize / 2) - 1; // 1px 안쪽
                    graphics.drawRect(centerX - halfSize, centerY - halfSize, gridSize - 2, gridSize - 2);
                } else if (gridType === CONST.GRID_TYPES.HEXODDR || 
                          gridType === CONST.GRID_TYPES.HEXEVENR ||
                          gridType === CONST.GRID_TYPES.HEXODDQ ||
                          gridType === CONST.GRID_TYPES.HEXEVENQ) {
                    // 육각형 그리드: 실제 육각형 모양으로 하이라이트
                    if (handler && handler.drawHexHighlight) {
                        handler.drawHexHighlight(graphics, grid.x, grid.y, gridSize);
                    } else {
                        // fallback: 원으로 대체
                        graphics.drawCircle(grid.x, grid.y, gridSize / 2 - 1);
                    }
                }
                
                graphics.endFill();
                
                // Canvas의 그리드 레이어에 추가
                canvas.interface.grid.addChild(graphics);
                window.DX3rdSpellCalamityHighlights.push(graphics);
            }
            
        } catch (error) {
            console.error("DX3rd | Error in drawSpellCalamityHighlight:", error);
        }
    },

    /**
     * Handle token move for spell calamity highlight removal
     * @param {TokenDocument} tokenDoc - Token document
     * @param {Object} updateData - Update data
     */
    async handleTokenMoveForSpellCalamity(tokenDoc, updateData) {
        try {
            // 위치가 변경되었는지 확인
            if (!updateData.x && !updateData.y) return;
            
            // SpellCalamity 하이라이트 데이터 확인
            if (!window.DX3rdSpellCalamityHighlightData) return;
            
            const highlights = window.DX3rdSpellCalamityHighlightData;
            const index = highlights.findIndex(h => h.tokenId === tokenDoc.id);
            
            if (index !== -1) {
                // 하이라이트 제거
                this.clearSpellCalamityHighlight(tokenDoc.id);
            }
            
        } catch (error) {
            console.error("DX3rd | Error in handleTokenMoveForSpellCalamity:", error);
        }
    },

    /**
     * Clear spell calamity highlight
     * @param {string} tokenId - Token ID (optional, if not provided clears all)
     */
    clearSpellCalamityHighlight(tokenId = null) {
        try {
            // Graphics 객체 배열에서 하이라이트 제거
            if (window.DX3rdSpellCalamityHighlights && Array.isArray(window.DX3rdSpellCalamityHighlights)) {
                // 하이라이트 데이터와 Graphics 객체를 분리해서 관리
                // 여기서는 모든 Graphics 객체를 제거
                for (const graphics of window.DX3rdSpellCalamityHighlights) {
                    if (graphics && graphics.parent) {
                        graphics.parent.removeChild(graphics);
                        graphics.destroy();
                    }
                }
                window.DX3rdSpellCalamityHighlights = [];
            }
            
            // 하이라이트 데이터도 제거
            if (window.DX3rdSpellCalamityHighlightData) {
                if (tokenId) {
                    window.DX3rdSpellCalamityHighlightData = window.DX3rdSpellCalamityHighlightData.filter(
                        h => h.tokenId !== tokenId
                    );
                } else {
                    window.DX3rdSpellCalamityHighlightData = [];
                }
            }
            
            // 다른 사용자들에게도 소켓으로 전송
            if (tokenId) {
                game.socket.emit('system.dx3rd-emanim', {
                    type: 'clearSpellCalamityHighlight',
                    data: { tokenId: tokenId }
                });
            }
            
        } catch (error) {
            console.error("DX3rd | Error in clearSpellCalamityHighlight:", error);
        }
    }
};
})();
