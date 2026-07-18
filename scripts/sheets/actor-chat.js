/*
 * 액터 아이템 채팅 출력 서브시스템 (이전 시트/AppV2 공유).
 *
 * 원래 scripts/sheets/actor-sheet.js(이전 시트)에만 있던 _sendItemToChat 및 그
 * 보조 메서드(채팅 카드 HTML 생성, 토글 리스너, 루비 변환 등)를 그대로 옮겨
 * 한 클래스로 감쌌다. 클래스로 감싸면 this.actor(생성자 주입),
 * this._getSkillDisplay/this._createItemChatContent 등(프로토타입),
 * this.constructor._globalChatToggleListener(정적 싱글톤)가 원본과 동일하게
 * 동작하므로 본문은 한 줄도 수정하지 않았다.
 *
 * 외부(dx3rd-combat-ui / dx3rd-action-ui / dx3rd-macro)는 여전히
 * sheet._sendItemToChat(item) 으로 호출한다 — 이전 시트/AppV2 시트가 각각 얇은
 * 위임자를 두어 이 모듈로 넘긴다. 따라서 AppV2 액터 시트에서도 동일하게
 * 채팅 출력이 동작한다.
 */
(() => {
  "use strict";

  function hasMeaningfulDescription(value) {
    const html = String(value ?? '').trim();
    if (!html) return false;

    // 텍스트가 없어도 자체로 내용을 이루는 리치 텍스트 요소는 설명으로 취급한다.
    if (/<(?:img|video|audio|iframe|object|embed|canvas|svg|table|hr)\b/i.test(html)) return true;

    const template = document.createElement('template');
    template.innerHTML = html;
    return template.content.textContent.replace(/\u00a0/g, ' ').trim().length > 0;
  }

  class DX3rdActorChatHelper {
    constructor(actor) {
      this.actor = actor;
    }

        _getSkillDisplay(skillKey) {
            return window.DX3rdActorSheetData.getSkillDisplay(this.actor, skillKey);
        }

        // 채팅 미리보기는 행동을 실행하는 곳이 아니므로 다이스를 굴리지 않는다.
        // 수식에 다이스가 있으면 참조만 현재 값으로 치환한 원문을 표시하고,
        // 고정 수식만 기존처럼 계산된 숫자로 표시한다.
        _getDisplayFormula(value, item) {
            const formula = window.DX3rdFormulaEvaluator;
            const prepared = formula.prepareRollFormula(value, item, this.actor);
            return formula.hasDice(prepared)
                ? prepared
                : formula.evaluate(value, item, this.actor);
        }

        async _sendItemToChat(item) {
            try {
                // 액터 데이터 최신화 (침식률 변경 등 반영)
                await this.actor.prepareData();

                // 최신화된 아이템 데이터 가져오기
                const currentItem = this.actor.items.get(item.id);
                if (!currentItem) {
                    console.error('DX3rd | Item not found in actor:', item.id);
                    return;
                }

                // 아이템 타입별 정보 수집 (최신 데이터 사용)
                const itemData = {
                    id: currentItem.id,
                    name: currentItem.name,
                    type: currentItem.type,
                    description: currentItem.system.description || "",
                    img: currentItem.img
                };

                // 아이템 타입별 추가 정보 수집 (최신 데이터 사용)
                switch (currentItem.type) {
                    case 'effect':
                        // 침식률에 따른 레벨 계산
                        const baseLevel = Number(currentItem.system.level?.init || 0);
                        const upgrade = currentItem.system.level?.upgrade || false;
                        let calculatedLevel = baseLevel;

                        if (upgrade && this.actor.system?.attributes?.encroachment?.level) {
                            const encLevel = Number(this.actor.system.attributes.encroachment.level) || 0;
                            calculatedLevel += encLevel;
                        }

                        itemData.level = calculatedLevel;
                        itemData.maxLevel = Number(currentItem.system.level?.max) || itemData.level || 0;
                        itemData.timing = currentItem.system.timing || '-';
                        itemData.skill = currentItem.system.skill || '-';
                        itemData.target = currentItem.system.target || '-';
                        itemData.range = currentItem.system.range || '-';
                        itemData.attackRoll = currentItem.system.attackRoll || '-';
                        itemData.add = this._getDisplayFormula(currentItem.system.add ?? '0', currentItem);
                        itemData.attack = this._getDisplayFormula(currentItem.system.attack ?? '0', currentItem);
                        itemData.encroach = currentItem.system.encroach?.value || 0;
                        itemData.limit = currentItem.system.limit || '-';
                        itemData.used = currentItem.system.used || { disable: 'notCheck', state: 0, max: 0 };
                        break;
                    case 'spell':
                        itemData.spellType = currentItem.system.spelltype || '-';
                        itemData.invoke = currentItem.system.invoke?.value || '-';
                        itemData.evocation = currentItem.system.evocation?.value || '-';
                        itemData.encroach = currentItem.system.encroach?.value || 0;
                        itemData.attributes = currentItem.system.effect?.attributes || {};
                        itemData.used = currentItem.system.used || { disable: 'notCheck', state: 0, max: 0 };
                        break;
                    case 'psionic':
                        // 사이오닉은 침식률 보정 없이 init만 사용
                        const psionicBaseLevel = Number(currentItem.system.level?.init || 0);
                        itemData.level = psionicBaseLevel;
                        itemData.maxLevel = Number(currentItem.system.level?.max) || itemData.level || 0;
                        itemData.timing = currentItem.system.timing || '-';
                        itemData.skill = currentItem.system.skill || '-';
                        itemData.target = currentItem.system.target || '-';
                        itemData.range = currentItem.system.range || '-';
                        itemData.hp = currentItem.system.hp?.value || 0;
                        itemData.limit = currentItem.system.limit || '-';
                        itemData.used = currentItem.system.used || { disable: 'notCheck', state: 0, max: 0 };
                        break;
                    case 'weapon':
                        itemData.weaponType = currentItem.system.type || '-';
                        itemData.skill = currentItem.system.skill || '-';
                        itemData.range = currentItem.system.range || '-';
                        itemData.add = this._getDisplayFormula(currentItem.system.add, currentItem);
                        itemData.attack = this._getDisplayFormula(currentItem.system.attack, currentItem);
                        itemData.guard = this._getDisplayFormula(currentItem.system.guard, currentItem);
                        itemData.used = currentItem.system.used || { disable: 'notCheck', state: 0, max: 0 };
                        itemData['attack-used'] = currentItem.system['attack-used'] || { disable: 'notCheck', state: 0, max: 0 };
                        break;
                    case 'protect':
                        itemData.dodge = this._getDisplayFormula(currentItem.system.dodge, currentItem);
                        itemData.init = this._getDisplayFormula(currentItem.system.init, currentItem);
                        itemData.armor = this._getDisplayFormula(currentItem.system.armor, currentItem);
                        itemData.used = currentItem.system.used || { disable: 'notCheck', state: 0, max: 0 };
                        break;
                    case 'vehicle':
                        itemData.vehicleType = currentItem.system.type || '-';
                        itemData.skill = currentItem.system.skill || '-';
                        itemData.attack = this._getDisplayFormula(currentItem.system.attack, currentItem);
                        itemData.init = this._getDisplayFormula(currentItem.system.init, currentItem);
                        itemData.armor = this._getDisplayFormula(currentItem.system.armor, currentItem);
                        itemData.move = this._getDisplayFormula(currentItem.system.move, currentItem);
                        itemData.used = currentItem.system.used || { disable: 'notCheck', state: 0, max: 0 };
                        break;
                    case 'connection':
                        itemData.skill = currentItem.system.skill || '-';
                        itemData.add = currentItem.system.add || 0;
                        itemData.used = currentItem.system.used || { disable: 'notCheck', state: 0, max: 0 };
                        break;
                    case 'etc':
                        itemData.etcType = currentItem.system.type || '-';
                        itemData.add = currentItem.system.add || 0;
                        itemData.used = currentItem.system.used || { disable: 'notCheck', state: 0, max: 0 };
                        break;
                    case 'once':
                        itemData.quantity = currentItem.system.quantity || 1;
                        itemData.add = currentItem.system.add || 0;
                        itemData.used = currentItem.system.used || { disable: 'notCheck', state: 0, max: 0 };
                        break;
                    case 'combo':
                        itemData.skill = currentItem.system.skill || '-';
                        itemData.base = currentItem.system.base || '-';
                        itemData.roll = currentItem.system.roll || '-';
                        itemData.difficulty = currentItem.system.difficulty || '';
                        itemData.timing = currentItem.system.timing || '-';
                        itemData.range = currentItem.system.range || '';
                        itemData.target = currentItem.system.target || '';
                        itemData.limit = currentItem.system.limit || '-';
                        itemData.used = currentItem.system.used || { disable: 'notCheck', state: 0, max: 0 };
                        itemData.attackRoll = currentItem.system.attackRoll || '-';
                        
                        // 콤보 시트의 getData()에서 계산된 값들 가져오기
                        if (currentItem.sheet) {
                            try {
                                const sheetData = await currentItem.sheet.getData();
                                itemData.dice = sheetData.system?.dice?.value || 0;
                                itemData.critical = sheetData.system?.critical?.value || 10;
                                itemData.add = sheetData.system?.add?.value || 0;
                                itemData.attack = sheetData.system?.attack?.value || 0;
                                itemData.encroach = sheetData.system?.encroach?.value || 0;
                                itemData.attackLabel = sheetData.attackLabel || game.i18n.localize('DX3rd.Attack');
                            } catch (e) {
                                itemData.dice = 0;
                                itemData.critical = 10;
                                itemData.add = 0;
                                itemData.attack = 0;
                                itemData.encroach = 0;
                                itemData.attackLabel = game.i18n.localize('DX3rd.Attack');
                            }
                        } else {
                            itemData.dice = 0;
                            itemData.critical = 10;
                            itemData.add = 0;
                            itemData.attack = 0;
                            itemData.encroach = 0;
                            // attackRoll에 따라 라벨 설정
                            if (itemData.attackRoll === 'melee') {
                                itemData.attackLabel = game.i18n.localize('DX3rd.MeleeAttack');
                            } else if (itemData.attackRoll === 'ranged') {
                                itemData.attackLabel = game.i18n.localize('DX3rd.RangedAttack');
                            } else {
                                itemData.attackLabel = game.i18n.localize('DX3rd.Attack');
                            }
                        }

                        // 콤보에 포함된 이펙트와 무기 정보 수집
                        itemData.effects = [];
                        itemData.weapons = [];


                        const comboData = window.DX3rdComboData;
                        const comboEffectIds = comboData?.getEffectIds?.(currentItem)
                            || (Array.isArray(currentItem.system.effect) ? currentItem.system.effect : []);
                        const comboWeaponIds = comboData?.getWeaponIds?.(currentItem)
                            || (Array.isArray(currentItem.system.weapon) ? currentItem.system.weapon : []);

                        if (comboEffectIds.length) {
                            for (const effectId of comboEffectIds) {
                                if (effectId && effectId !== '-') {
                                    const effect = this.actor.items.get(effectId);
                                    if (effect && effect.type === 'effect') {
                                        itemData.effects.push({
                                            id: effect.id,
                                            name: effect.name,
                                            level: comboData?.getEffectDisplayLevel?.(effect, this.actor)
                                                ?? effect.system.level?.value
                                                ?? effect.system.level?.init
                                                ?? 0,
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

                        if (comboWeaponIds.length) {
                            for (const weaponId of comboWeaponIds) {
                                if (weaponId && weaponId !== '-') {
                                    const weaponOrVehicle = this.actor.items.get(weaponId);
                                    if (weaponOrVehicle && (weaponOrVehicle.type === 'weapon' || weaponOrVehicle.type === 'vehicle')) {
                                        // 비클인 경우 특별 처리
                                        if (weaponOrVehicle.type === 'vehicle') {
                                            itemData.weapons.push({
                                                id: weaponOrVehicle.id,
                                                name: weaponOrVehicle.name,
                                                type: game.i18n.localize('DX3rd.Melee'), // 종별: 백병
                                                skill: weaponOrVehicle.system.skill || '-',
                                                range: game.i18n.localize('DX3rd.Engage'), // 사정거리: 교전
                                                add: 0, // 수정치: 0
                                                attack: weaponOrVehicle.system.attack || 0,
                                                guard: 0
                                            });
                                        } else {
                                            // 일반 무기
                                            itemData.weapons.push({
                                                id: weaponOrVehicle.id,
                                                name: weaponOrVehicle.name,
                                                type: weaponOrVehicle.system.type || '-',
                                                skill: weaponOrVehicle.system.skill || '-',
                                                range: weaponOrVehicle.system.range || '-',
                                                add: weaponOrVehicle.system.add || 0,
                                                attack: weaponOrVehicle.system.attack || 0,
                                                guard: weaponOrVehicle.system.guard || 0
                                            });
                                        }
                                    }
                                }
                            }
                        }

                        if (!hasMeaningfulDescription(itemData.description)) {
                            itemData.description = comboData?.buildAutomaticDescription?.(currentItem, this.actor) || '';
                        }
                        break;
                    case 'book':
                        itemData.decipher = currentItem.system.decipher || 0;
                        itemData.exp = currentItem.system.exp || 0;

                        // 마도서에 포함된 술식 정보 수집
                        itemData.spells = [];

                        if (currentItem.system.spells && Array.isArray(currentItem.system.spells)) {
                            for (const spellId of currentItem.system.spells) {
                                if (spellId && spellId !== '-') {
                                    // 공용 아이템에서 조회
                                    const spell = game.items.get(spellId);

                                    if (spell && spell.type === 'spell') {
                                        // 액터가 같은 이름의 술식을 가지고 있는지 확인
                                        const actorSpell = this.actor.items.find(item =>
                                            item.type === 'spell' && item.name === spell.name
                                        );
                                        const isOwned = !!actorSpell;

                                        itemData.spells.push({
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
                        break;
                    case 'record':
                        itemData.exp = currentItem.system.exp || 0;
                        break;
                    case 'rois':
                        itemData.roisType = currentItem.system.type || '-';
                        itemData.positive = currentItem.system.positive || {};
                        itemData.negative = currentItem.system.negative || {};
                        itemData.titus = currentItem.system.titus || false;
                        itemData.sublimation = currentItem.system.sublimation || false;
                        break;
                }

                // 채팅 메시지 생성
                const chatData = {
                    style: CONST.CHAT_MESSAGE_STYLES.OTHER,
                    content: await this._createItemChatContent(itemData),
                    speaker: {
                        actor: this.actor.id,
                        alias: this.actor.name
                    }
                };

                // 채팅 메시지 전송
                const message = await ChatMessage.create(chatData);

                // 호출 시 타이밍의 매크로 실행
                if (window.DX3rdUniversalHandler && window.DX3rdUniversalHandler.executeMacros) {
                    await window.DX3rdUniversalHandler.executeMacros(currentItem, 'onInvoke');
                }

                // 콤보 아이템의 경우 포함된 이펙트의 onInvoke 매크로도 실행
                if (currentItem.type === 'combo') {
                    const rawEffects = (currentItem.system?.effectIds ?? currentItem.system?.effect?.data ?? currentItem.system?.effect) ?? [];
                    let effectIds = [];
                    if (Array.isArray(rawEffects)) {
                        effectIds = rawEffects.filter(e => e && e !== '-');
                    } else if (rawEffects && typeof rawEffects === 'object') {
                        effectIds = Object.values(rawEffects)
                            .map(v => (typeof v === 'string' ? v : (v?.id || null)))
                            .filter(e => e && e !== '-');
                    } else if (typeof rawEffects === 'string') {
                        if (rawEffects && rawEffects !== '-') effectIds = [rawEffects];
                    }
                    
                    for (const effectId of effectIds) {
                        if (!effectId || effectId === '-') continue;
                        const effectItem = this.actor.items.get(effectId);
                        if (!effectItem) {
                            console.warn('DX3rd | Combo chat - Effect item not found:', effectId);
                            continue;
                        }
                        
                        if (window.DX3rdUniversalHandler && window.DX3rdUniversalHandler.executeMacros) {
                            await window.DX3rdUniversalHandler.executeMacros(effectItem, 'onInvoke');
                        }
                    }
                }

                // 새로 생성된 메시지에 토글 기능 초기화
                setTimeout(() => {
                    const newMessage = this._getChatMessageElement(message.id);
                    if (newMessage) {
                        const expandItemCards = game.settings.get('dx3rd-emanim', 'expandChatItemCards');
                        newMessage.querySelectorAll('.collapsible-content').forEach(element => {
                            element.classList.toggle('collapsed', !expandItemCards);
                            element.style.display = expandItemCards ? '' : 'none';
                        });
                    }
                }, 500);

                // 토글 기능을 위한 이벤트 리스너 추가
                setTimeout(() => {
                    this._addChatToggleListeners(message.id);
                }, 500);

                // 기존 채팅 메시지 초기화는 main.js에서 처리됨

            } catch (error) {
                console.error('DX3rd | Error sending item to chat:', error);
                ui.notifications.error('아이템 정보를 채팅으로 전송하는 중 오류가 발생했습니다.');
            }
        }

        // 아이템 이름에서 || 패턴을 루비 문자로 변환하는 헬퍼 함수
        _formatItemNameWithRuby(itemName) {
            if (!itemName || typeof itemName !== 'string') {
                return itemName;
            }

            // || 패턴이 있는지 확인
            const rubyPattern = /^(.+)\|\|(.+)$/;
            const match = itemName.match(rubyPattern);

            if (match) {
                const [, mainName, rubyText] = match;
                return `<ruby class="dx3rd-ruby"><rb>${mainName}</rb><rt>${rubyText}</rt></ruby>`;
            }

            return itemName;
        }

        async _createItemChatContent(itemData) {
            let content = `<div class="dx3rd-item-chat">`;
            content += `<div class="item-header">`;
            content += `<img src="${itemData.img}" width="32" height="32" style="vertical-align: middle; margin-right: 8px;">`;

            // 아이템 이름에서 || 패턴 처리
            const formattedItemName = this._formatItemNameWithRuby(itemData.name);

            const itemNameStyle = `cursor: pointer;`;

            // 로이스 타입 표시
            if (itemData.type === 'rois') {
                let roisTypeDisplay = '';
                if (itemData.roisType && itemData.roisType !== '-') {
                    switch (itemData.roisType) {
                        case 'D':
                            roisTypeDisplay = game.i18n.localize('DX3rd.Descripted');
                            break;
                        case 'S':
                            roisTypeDisplay = game.i18n.localize('DX3rd.Superier');
                            break;
                        case 'M':
                            roisTypeDisplay = game.i18n.localize('DX3rd.Memory');
                            break;
                        case 'E':
                            roisTypeDisplay = game.i18n.localize('DX3rd.Exhaust');
                            break;
                        default:
                            roisTypeDisplay = itemData.roisType;
                    }
                    content += `<strong class="item-name-toggle" style="${itemNameStyle}">[${roisTypeDisplay}]${formattedItemName}</strong>`;
                } else {
                    // 타입이 "-"이거나 없으면 "로이스"로 표시
                    const roisLabel = game.i18n.localize('DX3rd.Rois');
                    content += `<strong class="item-name-toggle" style="${itemNameStyle}">[${roisLabel}]${formattedItemName}</strong>`;
                }
            } else {
                content += `<strong class="item-name-toggle" style="${itemNameStyle}">${formattedItemName}</strong>`;
            }
            content += `</div>`;

            // 아이템 타입별 상세 정보
            switch (itemData.type) {
                case 'effect':
                    content += `<div class="item-details effect-details collapsible-content collapsed">`;
                    content += `<div class="detail-row">`;
                    content += `<span class="detail-key">레벨:</span> <span class="detail-value">${itemData.level}</span>`;
                    content += `</div>`;
                    content += `<div class="detail-row">`;
                    const effectTimingDisplay = itemData.timing === '-' ? '-' : game.i18n.localize(`DX3rd.${itemData.timing.charAt(0).toUpperCase() + itemData.timing.slice(1)}`);
                    content += `<span class="detail-key">타이밍:</span> <span class="detail-value">${effectTimingDisplay}</span>`;
                    content += `</div>`;
                    content += `<div class="detail-row">`;
                    const effectSkillDisplay = this._getSkillDisplay(itemData.skill);
                    content += `<span class="detail-key">기능:</span> <span class="detail-value">${effectSkillDisplay}</span>`;
                    content += `</div>`;
                    content += `<div class="detail-row">`;
                    content += `<span class="detail-key">난이도:</span> <span class="detail-value">자동성공</span>`;
                    content += `</div>`;
                    content += `<div class="detail-row two-columns">`;
                    content += `<div class="detail-cell"><span class="detail-key">대상:</span> <span class="detail-value">${itemData.target}</span></div>`;
                    content += `<div class="detail-cell"><span class="detail-key">사정거리:</span> <span class="detail-value">${itemData.range}</span></div>`;
                    content += `</div>`;
                    if (itemData.attackRoll && itemData.attackRoll !== '-') {
                        const attackType = itemData.attackRoll === 'melee'
                            ? game.i18n.localize('DX3rd.Melee')
                            : game.i18n.localize('DX3rd.Ranged');
                        content += `<div class="detail-row two-columns">`;
                        content += `<div class="detail-cell"><span class="detail-key">${game.i18n.localize('DX3rd.AttackType')}:</span> <span class="detail-value">${attackType}</span></div>`;
                        content += `<div class="detail-cell"><span class="detail-key">${game.i18n.localize('DX3rd.Add')} / ${game.i18n.localize('DX3rd.Attack')}:</span> <span class="detail-value">${itemData.add} / ${itemData.attack}</span></div>`;
                        content += `</div>`;
                    }
                    content += `<div class="detail-row two-columns">`;
                    content += `<div class="detail-cell"><span class="detail-key">침식치:</span> <span class="detail-value">${itemData.encroach}</span></div>`;
                    content += `<div class="detail-cell"><span class="detail-key">제한:</span> <span class="detail-value">${itemData.limit}</span></div>`;
                    content += `</div>`;
                    content += `</div>`;
                    break;
                case 'psionic':
                    content += `<div class="item-details effect-details collapsible-content collapsed">`;
                    content += `<div class="detail-row">`;
                    content += `<span class="detail-key">레벨:</span> <span class="detail-value">${itemData.level}</span>`;
                    content += `</div>`;
                    content += `<div class="detail-row">`;
                    const psionicTimingDisplay = itemData.timing === '-' ? '-' : game.i18n.localize(`DX3rd.${itemData.timing.charAt(0).toUpperCase() + itemData.timing.slice(1)}`);
                    content += `<span class="detail-key">타이밍:</span> <span class="detail-value">${psionicTimingDisplay}</span>`;
                    content += `</div>`;
                    content += `<div class="detail-row">`;
                    const psionicSkillDisplay = this._getSkillDisplay(itemData.skill);
                    content += `<span class="detail-key">기능:</span> <span class="detail-value">${psionicSkillDisplay}</span>`;
                    content += `</div>`;
                    content += `<div class="detail-row">`;
                    content += `<span class="detail-key">난이도:</span> <span class="detail-value">자동성공</span>`;
                    content += `</div>`;
                    content += `<div class="detail-row two-columns">`;
                    content += `<div class="detail-cell"><span class="detail-key">대상:</span> <span class="detail-value">${itemData.target}</span></div>`;
                    content += `<div class="detail-cell"><span class="detail-key">사정거리:</span> <span class="detail-value">${itemData.range}</span></div>`;
                    content += `</div>`;
                    content += `<div class="detail-row two-columns">`;
                    content += `<div class="detail-cell"><span class="detail-key">HP:</span> <span class="detail-value">${itemData.hp}</span></div>`;
                    content += `<div class="detail-cell"><span class="detail-key">제한:</span> <span class="detail-value">${itemData.limit}</span></div>`;
                    content += `</div>`;
                    content += `</div>`;
                    break;
                case 'spell':
                    // 발동치 표시 로직
                    let invokeDisplay = '';
                    if (itemData.invoke === '-' && itemData.evocation === '-') {
                        invokeDisplay = '자동성공';
                    } else if (itemData.invoke !== '-' && itemData.evocation === '-') {
                        invokeDisplay = itemData.invoke;
                    } else if (itemData.invoke !== '-' && itemData.evocation !== '-') {
                        invokeDisplay = `${itemData.invoke}/${itemData.evocation}`;
                    } else if (itemData.invoke === '-' && itemData.evocation !== '-') {
                        invokeDisplay = itemData.evocation;
                    }

                    content += `<div class="item-details effect-details collapsible-content collapsed">`;
                    content += `<div class="detail-row">`;
                    const spellTypeDisplay = itemData.spellType === '-' ? '-' : game.i18n.localize(`DX3rd.${itemData.spellType}`);
                    content += `<span class="detail-key">종별:</span> <span class="detail-value">${spellTypeDisplay}</span>`;
                    content += `</div>`;
                    content += `<div class="detail-row">`;
                    content += `<span class="detail-key">발동치:</span> <span class="detail-value">${invokeDisplay}</span>`;
                    content += `</div>`;
                    content += `<div class="detail-row">`;
                    content += `<span class="detail-key">침식치:</span> <span class="detail-value">${itemData.encroach}</span>`;
                    content += `</div>`;
                    content += `</div>`;
                    break;
                case 'weapon':
                    content += `<div class="item-details effect-details collapsible-content collapsed">`;
                    content += `<div class="detail-row two-columns">`;
                    const weaponTypeDisplay = itemData.weaponType === '-' ? '-' : game.i18n.localize(`DX3rd.${itemData.weaponType.charAt(0).toUpperCase() + itemData.weaponType.slice(1)}`);
                    const weaponSkillDisplay = this._getSkillDisplay(itemData.skill);
                    content += `<div class="detail-cell"><span class="detail-key">종별:</span> <span class="detail-value">${weaponTypeDisplay}</span></div>`;
                    content += `<div class="detail-cell"><span class="detail-key">기능:</span> <span class="detail-value">${weaponSkillDisplay}</span></div>`;
                    content += `</div>`;
                    content += `<div class="detail-row two-columns">`;
                    content += `<div class="detail-cell"><span class="detail-key">수정치:</span> <span class="detail-value">${itemData.add}</span></div>`;
                    content += `<div class="detail-cell"><span class="detail-key">공격력:</span> <span class="detail-value">${itemData.attack}</span></div>`;
                    content += `</div>`;
                    content += `<div class="detail-row two-columns">`;
                    content += `<div class="detail-cell"><span class="detail-key">가드:</span> <span class="detail-value">${itemData.guard}</span></div>`;
                    content += `<div class="detail-cell"><span class="detail-key">사정거리:</span> <span class="detail-value">${itemData.range}</span></div>`;
                    content += `</div>`;
                    content += `</div>`;
                    break;
                case 'protect':
                    content += `<div class="item-details effect-details collapsible-content collapsed">`;
                    content += `<div class="detail-row two-columns">`;
                    content += `<div class="detail-cell"><span class="detail-key">종별:</span> <span class="detail-value">${game.i18n.localize("DX3rd.Protect")}</span></div>`;
                    content += `<div class="detail-cell"><span class="detail-key">장갑:</span> <span class="detail-value">${itemData.armor}</span></div>`;
                    content += `</div>`;
                    content += `<div class="detail-row two-columns">`;
                    content += `<div class="detail-cell"><span class="detail-key">닷지:</span> <span class="detail-value">${itemData.dodge}</span></div>`;
                    content += `<div class="detail-cell"><span class="detail-key">행동치:</span> <span class="detail-value">${itemData.init}</span></div>`;
                    content += `</div>`;
                    content += `</div>`;
                    break;
                case 'vehicle':
                    content += `<div class="item-details effect-details collapsible-content collapsed">`;
                    content += `<div class="detail-row two-columns">`;
                    const vehicleSkillDisplay = this._getSkillDisplay(itemData.skill);
                    content += `<div class="detail-cell"><span class="detail-key">종별:</span> <span class="detail-value">${game.i18n.localize("DX3rd.Vehicle")}</span></div>`;
                    content += `<div class="detail-cell"><span class="detail-key">기능:</span> <span class="detail-value">${vehicleSkillDisplay}</span></div>`;
                    content += `</div>`;
                    content += `<div class="detail-row two-columns">`;
                    content += `<div class="detail-cell"><span class="detail-key">공격력:</span> <span class="detail-value">${itemData.attack}</span></div>`;
                    content += `<div class="detail-cell"><span class="detail-key">행동치:</span> <span class="detail-value">${itemData.init}</span></div>`;
                    content += `</div>`;
                    content += `<div class="detail-row two-columns">`;
                    content += `<div class="detail-cell"><span class="detail-key">장갑:</span> <span class="detail-value">${itemData.armor}</span></div>`;
                    content += `<div class="detail-cell"><span class="detail-key">이동:</span> <span class="detail-value">${itemData.move}</span></div>`;
                    content += `</div>`;
                    content += `</div>`;
                    break;
                case 'connection':
                    content += `<div class="item-details effect-details collapsible-content collapsed">`;
                    content += `<div class="detail-row two-columns">`;
                    content += `<div class="detail-cell"><span class="detail-key">종별:</span> <span class="detail-value">${game.i18n.localize("DX3rd.Connection")}</span></div>`;
                    const connectionSkillDisplay = this._getSkillDisplay(itemData.skill);
                    content += `<div class="detail-cell"><span class="detail-key">기능:</span> <span class="detail-value">${connectionSkillDisplay}</span></div>`;
                    content += `</div>`;
                    content += `</div>`;
                    break;
                case 'etc':
                    content += `<div class="item-details effect-details collapsible-content collapsed">`;
                    content += `<div class="detail-row">`;
                    const etcTypeDisplay = itemData.etcType === '-' ? '-' : game.i18n.localize(`DX3rd.${itemData.etcType.charAt(0).toUpperCase() + itemData.etcType.slice(1)}`);
                    content += `<span class="detail-key">종별:</span> <span class="detail-value">${etcTypeDisplay}</span>`;
                    content += `</div>`;
                    content += `</div>`;
                    break;
                case 'once':
                    content += `<div class="item-details effect-details collapsible-content collapsed">`;
                    content += `<div class="detail-row">`;
                    content += `<span class="detail-key">종별:</span> <span class="detail-value">${game.i18n.localize("DX3rd.Once")}</span>`;
                    content += `</div>`;
                    content += `</div>`;
                    break;
                case 'book':
                    content += `<div class="item-details effect-details collapsible-content collapsed">`;
                    content += `<div class="detail-row">`;
                    content += `<span class="detail-key">종별:</span> <span class="detail-value">${game.i18n.localize("DX3rd.Book")}</span>`;
                    content += `</div>`;
                    content += `<div class="detail-row">`;
                    content += `<span class="detail-key">해독 난이도:</span> <span class="detail-value">${itemData.decipher || 0}</span>`;
                    content += `</div>`;
                    content += `</div>`;
                    break;
                case 'combo':
                    content += `<div class="item-details effect-details collapsible-content collapsed">`;
                    content += `<div class="detail-row">`;
                    const comboTimingDisplay = itemData.timing === '-' ? '-' : game.i18n.localize(`DX3rd.${itemData.timing.charAt(0).toUpperCase() + itemData.timing.slice(1)}`);
                    content += `<span class="detail-key">타이밍:</span> <span class="detail-value">${comboTimingDisplay}</span>`;
                    content += `</div>`;
                    content += `<div class="detail-row two-columns">`;
                    const comboSkillDisplay = this._getSkillDisplay(itemData.skill);
                    content += `<div class="detail-cell"><span class="detail-key">기능:</span> <span class="detail-value">${comboSkillDisplay}</span></div>`;
                    content += `<div class="detail-cell"><span class="detail-key">난이도:</span> <span class="detail-value">${itemData.difficulty || '-'}</span></div>`;
                    content += `</div>`;
                    content += `<div class="detail-row two-columns">`;
                    content += `<div class="detail-cell"><span class="detail-key">대상:</span> <span class="detail-value">${itemData.target || '-'}</span></div>`;
                    content += `<div class="detail-cell"><span class="detail-key">사정거리:</span> <span class="detail-value">${itemData.range || '-'}</span></div>`;
                    content += `</div>`;
                    content += `<div class="detail-row two-columns">`;
                    content += `<div class="detail-cell"><span class="detail-key">다이스:</span> <span class="detail-value">${itemData.dice || 0}</span></div>`;
                    content += `<div class="detail-cell"><span class="detail-key">크리티컬:</span> <span class="detail-value">${itemData.critical || 10}</span></div>`;
                    content += `</div>`;
                    content += `<div class="detail-row two-columns">`;
                    content += `<div class="detail-cell"><span class="detail-key">수정치:</span> <span class="detail-value">${itemData.add || 0}</span></div>`;
                    const comboAttackLabel = itemData.attackLabel || game.i18n.localize('DX3rd.Attack');
                    content += `<div class="detail-cell"><span class="detail-key">${comboAttackLabel}:</span> <span class="detail-value">${itemData.attack || 0}</span></div>`;
                    content += `</div>`;
                    content += `<div class="detail-row two-columns">`;
                    content += `<div class="detail-cell"><span class="detail-key">침식치:</span> <span class="detail-value">${itemData.encroach || 0}</span></div>`;
                    content += `<div class="detail-cell"><span class="detail-key">제한:</span> <span class="detail-value">${itemData.limit || '-'}</span></div>`;
                    content += `</div>`;
                    content += `</div>`;

                    break;
                case 'record':
                    content += `<div class="item-details effect-details">`;
                    content += `<div class="detail-row">`;
                    content += `<span class="detail-key">경험점:</span> <span class="detail-value">${itemData.exp}</span>`;
                    content += `</div>`;
                    content += `</div>`;
                    break;
                case 'rois':
                    // 로이스 타입별 조건부 표시
                    if (itemData.roisType !== 'D') {
                        // 긍정/부정 감정 표시 (D 타입이 아닌 경우, 항상 표시)
                        content += `<div class="item-details rois-details">`;
                        content += `<div class="detail-row">`;

                        // 긍정 감정
                        if (itemData.positive?.state) {
                            content += `<span class="detail-key" style="color:#73aae6; font-weight: bold;">긍정:</span> <span class="detail-value" style="color: rgb(115, 170, 230); font-weight: bold;">${itemData.positive.feeling || ''}</span>`;
                        } else {
                            content += `<span class="detail-key">${game.i18n.localize("DX3rd.Positive")}:</span> <span class="detail-value">${itemData.positive?.feeling || '-'}</span>`;
                        }
                        content += `</div>`;

                        // 부정 감정
                        content += `<div class="detail-row">`;
                        if (itemData.negative?.state) {
                            content += `<span class="detail-key" style="color:#f16060; font-weight: bold;">부정:</span> <span class="detail-value" style="color: rgb(241, 96, 96); font-weight: bold;">${itemData.negative.feeling || ''}</span>`;
                        } else {
                            content += `<span class="detail-key">${game.i18n.localize("DX3rd.Negative")}:</span> <span class="detail-value">${itemData.negative?.feeling || '-'}</span>`;
                        }
                        content += `</div>`;
                        content += `</div>`;
                    }
                    break;
            }

            // 설명이 있으면 추가
            if (hasMeaningfulDescription(itemData.description)) {
                content += `<div class="item-description collapsible-content collapsed">`;
                content += `<div class="description-content">${itemData.description}</div>`;
                content += `</div>`;
            }

            // 마도서에 포함된 술식 버튼 추가 (설명 아래, 토글 가능)
            if (itemData.type === 'book' && itemData.spells && itemData.spells.length > 0) {
                content += `<div class="item-actions collapsible-content collapsed" style="display: none;">`;
                content += `<button class="use-item-btn book-toggle-btn" data-book-section="spells">술식 목록</button>`;
                content += `</div>`;
            }

            // 콤보 아이템의 경우 이펙트/무기 버튼 추가 (토글 가능)
            if (itemData.type === 'combo') {
                if ((itemData.effects && itemData.effects.length > 0) || (itemData.weapons && itemData.weapons.length > 0)) {
                    content += `<div class="item-actions collapsible-content collapsed" style="display: none;">`;
                    if (itemData.effects && itemData.effects.length > 0) {
                        content += `<button class="use-item-btn combo-toggle-btn" data-combo-section="effects">이펙트</button>`;
                    }
                    if (itemData.weapons && itemData.weapons.length > 0) {
                        content += `<button class="use-item-btn combo-toggle-btn" data-combo-section="weapons">무기</button>`;
                    }
                    content += `</div>`;
                }
            }

            // 아이템 사용 버튼 추가
            if (itemData.type === 'effect' || itemData.type === 'psionic' || itemData.type === 'spell' || itemData.type === 'weapon' || itemData.type === 'protect' || itemData.type === 'vehicle' || itemData.type === 'connection' || itemData.type === 'etc' || itemData.type === 'once' || itemData.type === 'combo' || itemData.type === 'book') {
                content += `<div class="item-actions">`;

                // 무기와 비클은 공격 롤 버튼 추가
                if (itemData.type === 'weapon' || itemData.type === 'vehicle') {
                    let showAttackButton = true;

                    // 무기의 경우 attack-used 횟수 체크
                    if (itemData.type === 'weapon') {
                        const attackUsedDisable = itemData['attack-used']?.disable || 'notCheck';
                        const attackUsedState = itemData['attack-used']?.state || 0;
                        const attackUsedMax = itemData['attack-used']?.max || 0;

                        // notCheck가 아니고, state >= max이면 버튼 숨김 (max === 0도 0회 사용 가능)
                        if (attackUsedDisable !== 'notCheck' && attackUsedState >= attackUsedMax) {
                            showAttackButton = false;
                        }
                    }

                    if (showAttackButton) {
                        content += `<button class="attack-roll-btn" data-item-id="${itemData.id}">${game.i18n.localize('DX3rd.AttackRoll')}</button>`;
                    }
                }

                // 모든 아이템에 사용 버튼 추가 (단, used 횟수 체크)
                let showUseButton = true;

                // used가 있는 아이템 타입만 체크 (무기는 별도 처리)
                const itemsWithUsed = ['combo', 'effect', 'spell', 'psionic', 'weapon', 'protect', 'vehicle', 'connection', 'etc', 'once'];
                if (itemsWithUsed.includes(itemData.type) && itemData.type !== 'weapon') {
                    const usedDisable = itemData.used?.disable || 'notCheck';
                    const usedState = itemData.used?.state || 0;
                    const usedMax = itemData.used?.max || 0;
                    const usedLevel = itemData.used?.level || false;

                    // displayMax 계산 (used.level이 체크되어 있으면 레벨 추가)
                    let displayMax = Number(usedMax) || 0;
                    if (usedLevel && itemData.type === 'effect') {
                        // 이펙트 아이템의 경우 침식률에 따른 레벨 수정이 적용된 수치 사용
                        const baseLevel = Number(itemData.level) || 0;
                        // upgrade 여부는 itemData에서 직접 가져올 수 없으므로 currentItem에서 확인
                        const currentItem = this.actor.items.get(itemData.id);
                        const upgrade = currentItem?.system?.level?.upgrade || false;
                        let finalLevel = baseLevel;
                        
                        if (upgrade && this.actor.system?.attributes?.encroachment?.level) {
                            const encLevel = Number(this.actor.system.attributes.encroachment.level) || 0;
                            finalLevel += encLevel;
                        }
                        
                        displayMax += finalLevel;
                    } else if (usedLevel && itemData.type === 'psionic') {
                        // 사이오닉은 침식률 보정 없이 init만 더함
                        const baseLevel = Number(itemData.level) || 0;
                        displayMax += baseLevel;
                    }

                    // notCheck가 아니고, state >= displayMax이면 버튼 숨김 (displayMax === 0도 0회 사용 가능)
                    if (usedDisable !== 'notCheck' && usedState >= displayMax) {
                        showUseButton = false;
                    }
                }

                // 무기는 used만 체크 (attack-used는 공격 버튼에서 체크)
                if (itemData.type === 'weapon') {
                    const usedDisable = itemData.used?.disable || 'notCheck';
                    const usedState = itemData.used?.state || 0;
                    const usedMax = itemData.used?.max || 0;

                    // notCheck가 아니고, state >= max이면 버튼 숨김 (max === 0도 0회 사용 가능)
                    if (usedDisable !== 'notCheck' && usedState >= usedMax) {
                        showUseButton = false;
                    }
                }

                if (showUseButton) {
                    let useText;
                    if (itemData.type === 'book') {
                        // 북은 "마도서 해독"으로 표기 (Book + Decipher 로컬라이즈 조합)
                        useText = `${game.i18n.localize('DX3rd.Book')} ${game.i18n.localize('DX3rd.Decipher')}`;
                    } else {
                        useText = game.i18n.localize(`DX3rd.${itemData.type.charAt(0).toUpperCase() + itemData.type.slice(1)}`) + " " + game.i18n.localize("DX3rd.Use");
                    }
                    content += `<button class="use-item-btn" data-item-id="${itemData.id}" data-get-target="${itemData.getTarget || false}">${useText}</button>`;
                }

                content += `</div>`;
            } else if (itemData.type === 'rois') {
                // 로이스 버튼 (D, M, E 타입 제외, 승화 이미 사용된 경우 제외)
                if (itemData.roisType !== 'D' && itemData.roisType !== 'M' && itemData.roisType !== 'E' && !itemData.sublimation) {
                    let buttonText = '';
                    let roisAction = '';
                    if (!itemData.titus) {
                        buttonText = game.i18n.localize("DX3rd.Titus");
                        roisAction = 'titus';
                    } else {
                        buttonText = game.i18n.localize("DX3rd.Sublimation");
                        roisAction = 'sublimation';
                    }

                    content += `<div class="item-actions">`;
                    content += `<button class="use-item-btn" data-item-id="${itemData.id}" data-rois-action="${roisAction}">${buttonText}</button>`;
                    content += `</div>`;
                }
            }

            content += `</div>`;
            if (game.settings.get('dx3rd-emanim', 'expandChatItemCards')) {
                content = content
                    .replaceAll('collapsible-content collapsed', 'collapsible-content')
                    .replaceAll(
                        'class="item-actions collapsible-content" style="display: none;"',
                        'class="item-actions collapsible-content"'
                    );
            }
            return content;
        }

        _addChatToggleListeners(messageId) {
            // DOM이 완전히 렌더링될 때까지 대기
            setTimeout(() => {
                // Foundry VTT의 채팅 메시지 구조에 맞게 수정
                const messageElement = this._getChatMessageContent(messageId);
                if (!messageElement) {
                    return;
                }

                const toggleElement = messageElement.querySelector('.item-name-toggle');
                if (!toggleElement) {
                    return;
                }

                // 이벤트 위임을 사용하여 더 안정적으로 처리
                toggleElement.addEventListener('click', (event) => {
                    event.preventDefault();
                    event.stopPropagation();

                    this._toggleCollapsibleElements(messageElement.querySelectorAll('.collapsible-content'));
                });
            }, 1000); // 대기 시간을 더 늘림
        }

        _addGlobalChatToggleListeners() {
            // 전역 이벤트 위임으로 채팅 로그의 모든 토글 요소 처리
            if (this.constructor._globalChatToggleListener) {
                document.removeEventListener('click', this.constructor._globalChatToggleListener);
            }

            this.constructor._globalChatToggleListener = (event) => {
                const toggle = event.target?.closest?.('.item-name-toggle');
                if (!toggle) return;

                event.preventDefault();
                event.stopPropagation();

                // Foundry VTT 채팅 메시지 구조 확인
                const messageElement = toggle.closest('.message');
                if (!messageElement) return;

                // 다양한 선택자 시도
                let collapsibleElements = Array.from(messageElement.querySelectorAll('.collapsible-content'));
                if (collapsibleElements.length === 0) {
                    // message-content 내부에서 찾기
                    const messageContent = messageElement.querySelector('.message-content');
                    collapsibleElements = Array.from(messageContent?.querySelectorAll?.('.collapsible-content') || []);
                }

                if (collapsibleElements.length === 0) {
                    return;
                }

                this._toggleCollapsibleElements(collapsibleElements);
            };

            document.addEventListener('click', this.constructor._globalChatToggleListener);
        }

        _initializeExistingChatMessages() {
            // 기존 채팅 메시지에서 토글 요소들을 찾아서 초기화
            const expandItemCards = game.settings.get('dx3rd-emanim', 'expandChatItemCards');
            document.querySelectorAll('#chat-log .message, .chat-log .message').forEach(messageElement => {
                messageElement.querySelectorAll('.dx3rd-item-chat .collapsible-content').forEach(element => {
                    element.classList.toggle('collapsed', !expandItemCards);
                    element.style.display = expandItemCards ? '' : 'none';
                });
            });
        }

        _getChatMessageElement(messageId) {
            return document.querySelector(
                `#chat-log .message[data-message-id="${messageId}"], .chat-log .message[data-message-id="${messageId}"]`
            );
        }

        _getChatMessageContent(messageId) {
            const messageElement = this._getChatMessageElement(messageId);
            return messageElement?.querySelector('.message-content') || messageElement;
        }

        _toggleCollapsibleElements(elements) {
            const list = Array.from(elements || []);
            if (!list.length) return;

            const shouldShow = list.some(element => element.classList.contains('collapsed'));
            list.forEach(element => {
                element.classList.toggle('collapsed', !shouldShow);
                element.style.display = shouldShow ? '' : 'none';
            });
        }
  }

  window.DX3rdActorChat = {
    /** 아이템 정보를 채팅으로 출력한다. 이전 시트/AppV2 시트 및 외부 UI 공용. */
    sendItemToChat(actor, item) {
      if (!actor) return;
      return new DX3rdActorChatHelper(actor)._sendItemToChat(item);
    }
  };
})();
