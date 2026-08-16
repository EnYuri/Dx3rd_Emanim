/*
 * Shared actor-item chat output for AppV2 sheets and external UI callers.
 *
 * Sheet classes expose a thin _sendItemToChat(item) delegate while this service owns card HTML,
 * toggle listeners, ruby conversion, and the injected actor reference. External callers such as
 * dx3rd-macro can therefore keep using the sheet API without duplicating card behavior.
 */
(() => {
  "use strict";

  function hasMeaningfulDescription(value) {
    const html = String(value ?? '').trim();
    if (!html) return false;

    // Treat intrinsically meaningful rich elements as content even without text nodes.
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

        // Chat preview must not roll dice. Resolve references in dice formulas for display, while
        // deterministic formulas retain the existing evaluated-number presentation.
        _getDisplayFormula(value, item) {
            const formula = window.DX3rdFormulaEvaluator;
            const prepared = formula.prepareRollFormula(value, item, this.actor);
            return formula.hasDice(prepared)
                ? prepared
                : formula.evaluate(value, item, this.actor);
        }

        async _sendItemToChat(item) {
            try {
                // Refresh derived actor data before reading encroachment-sensitive values.
                await this.actor.prepareData();

                // Re-resolve the embedded item in case preparation replaced stale references.
                const currentItem = this.actor.items.get(item.id);
                if (!currentItem) {
                    console.error('DX3rd | Item not found in actor:', item.id);
                    return;
                }

                const itemData = {
                    id: currentItem.id,
                    name: currentItem.name,
                    type: currentItem.type,
                    description: currentItem.system.description || "",
                    img: currentItem.img
                };

                switch (currentItem.type) {
                    case 'effect':
                        // Effect level includes the actor's current encroachment bands.
                        const calculatedLevel = window.DX3rdEffectLevel
                            ? window.DX3rdEffectLevel.value(currentItem, this.actor)
                            : Number(currentItem.system.level?.init || 0);

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
                        // Psionic levels use init without encroachment scaling.
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
                        
                        // Compute combo display values through the same data module as the sheet.
                        // AppV2 has no getData(), and instantiating a sheet here previously made every
                        // derived value fall through to zero.
                        if (window.DX3rdComboData) {
                            try {
                                const sheetData = await window.DX3rdComboData.prepareSheetData({system: {}}, currentItem, this.actor);
                                itemData.dice = sheetData.system?.dice?.value || 0;
                                itemData.critical = sheetData.system?.critical?.value || 10;
                                itemData.add = sheetData.system?.add?.value || 0;
                                itemData.attack = sheetData.system?.attack?.value || 0;
                                itemData.encroach = sheetData.system?.encroach?.value || 0;
                                itemData.attackLabel = sheetData.attackLabel || game.i18n.localize('DX3rd.Attack');
                            } catch (e) {
                                // A visible failure is safer than silently rendering incorrect zeros.
                                console.warn('DX3rd | 콤보 채팅 파생값 계산 실패', currentItem?.name, e);
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
                            // The roll mode determines whether the card labels its attack value.
                            if (itemData.attackRoll === 'melee') {
                                itemData.attackLabel = game.i18n.localize('DX3rd.MeleeAttack');
                            } else if (itemData.attackRoll === 'ranged') {
                                itemData.attackLabel = game.i18n.localize('DX3rd.RangedAttack');
                            } else {
                                itemData.attackLabel = game.i18n.localize('DX3rd.Attack');
                            }
                        }

                        // Preserve member details for the combo card's expandable sections.
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
                                        // Vehicles use the fixed melee/engage projection expected by combo cards.
                                        if (weaponOrVehicle.type === 'vehicle') {
                                            itemData.weapons.push({
                                                id: weaponOrVehicle.id,
                                                name: weaponOrVehicle.name,
                                                type: game.i18n.localize('DX3rd.Melee'),
                                                skill: weaponOrVehicle.system.skill || '-',
                                                range: game.i18n.localize('DX3rd.Engage'),
                                                add: 0,
                                                attack: weaponOrVehicle.system.attack || 0,
                                                guard: 0
                                            });
                                        } else {
                                            // Weapons retain their authored combat fields.
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

                const chatData = {
                    style: CONST.CHAT_MESSAGE_STYLES.OTHER,
                    content: await this._createItemChatContent(itemData),
                    speaker: {
                        actor: this.actor.id,
                        alias: this.actor.name
                    }
                };

                const message = await ChatMessage.create(chatData);

                // Sending a card is the onInvoke lifecycle point.
                if (window.DX3rdUniversalHandler && window.DX3rdUniversalHandler.executeMacros) {
                    await window.DX3rdUniversalHandler.executeMacros(currentItem, 'onInvoke');
                }

                // Combo members receive the same onInvoke lifecycle as their parent card.
                if (currentItem.type === 'combo') {
                    // comboMemberItems centralizes normalization, lookup, and type filtering.
                    const memberItems = window.DX3rdUniversalHandler?.comboMemberItems?.(this.actor, currentItem) || [];

                    for (const effectItem of memberItems) {
                        if (window.DX3rdUniversalHandler.executeMacros) {
                            await window.DX3rdUniversalHandler.executeMacros(effectItem, 'onInvoke');
                        }
                    }
                }

                // Apply the current expansion setting after Foundry inserts the new message DOM.
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

                // Bind the local toggle after the message element becomes available.
                setTimeout(() => {
                    this._addChatToggleListeners(message.id);
                }, 500);

            } catch (error) {
                console.error('DX3rd | Error sending item to chat:', error);
                ui.notifications.error('아이템 정보를 채팅으로 전송하는 중 오류가 발생했습니다.');
            }
        }

        // Convert the system's base||reading convention to ruby markup.
        _formatItemNameWithRuby(itemName) {
            if (!itemName || typeof itemName !== 'string') {
                return itemName;
            }

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

            // Render ruby syntax in the visible item name.
            const formattedItemName = this._formatItemNameWithRuby(itemData.name);

            const itemNameStyle = `cursor: pointer;`;

            // Resolve the visible Lois classification.
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
                    // Missing classifications use the generic Lois label.
                    const roisLabel = game.i18n.localize('DX3rd.Rois');
                    content += `<strong class="item-name-toggle" style="${itemNameStyle}">[${roisLabel}]${formattedItemName}</strong>`;
                }
            } else {
                content += `<strong class="item-name-toggle" style="${itemNameStyle}">${formattedItemName}</strong>`;
            }
            content += `</div>`;

            // Render the type-specific details table.
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
                    // Invocation values can be fixed or formula-backed display data.
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
                    // D/M/E Lois types suppress emotion details.
                    if (itemData.roisType !== 'D') {
                        content += `<div class="item-details rois-details">`;
                        content += `<div class="detail-row">`;

                        if (itemData.positive?.state) {
                            content += `<span class="detail-key" style="color:#73aae6; font-weight: bold;">긍정:</span> <span class="detail-value" style="color: rgb(115, 170, 230); font-weight: bold;">${itemData.positive.feeling || ''}</span>`;
                        } else {
                            content += `<span class="detail-key">${game.i18n.localize("DX3rd.Positive")}:</span> <span class="detail-value">${itemData.positive?.feeling || '-'}</span>`;
                        }
                        content += `</div>`;

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

            // Rich descriptions become the card's collapsible body.
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

            // Combo cards expose their effect and weapon member lists.
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

            // Render the actions available for this item type.
            if (itemData.type === 'effect' || itemData.type === 'psionic' || itemData.type === 'spell' || itemData.type === 'weapon' || itemData.type === 'protect' || itemData.type === 'vehicle' || itemData.type === 'connection' || itemData.type === 'etc' || itemData.type === 'once' || itemData.type === 'combo' || itemData.type === 'book') {
                content += `<div class="item-actions">`;

                // allowExhaustedUse decides whether exhaustion hides an action. When allowed, keep
                // the action visible but label it as exhausted, matching defense and reaction lists.
                const allowExhausted = window.DX3rdItemExhausted?.allowExhaustedUse?.() !== false;
                const exhaustedLabel = game.i18n.localize('DX3rd.Exhausted');
                const markExhausted = (text, exhausted) => (exhausted ? `${text} (${exhaustedLabel})` : text);

                // Weapons and vehicles expose a separate attack-roll action.
                if (itemData.type === 'weapon' || itemData.type === 'vehicle') {
                    let attackExhausted = false;

                    // Only weapons have the attack-used counter.
                    if (itemData.type === 'weapon') {
                        const attackUsedDisable = itemData['attack-used']?.disable || 'notCheck';
                        const attackUsedState = itemData['attack-used']?.state || 0;
                        const attackUsedMax = itemData['attack-used']?.max || 0;

                        // A configured zero maximum means zero available uses.
                        attackExhausted = attackUsedDisable !== 'notCheck' && attackUsedState >= attackUsedMax;
                    }

                    if (!attackExhausted || allowExhausted) {
                        const label = markExhausted(game.i18n.localize('DX3rd.AttackRoll'), attackExhausted);
                        content += `<button class="attack-roll-btn" data-item-id="${itemData.id}">${label}</button>`;
                    }
                }

                let useExhausted = false;

                // Weapon use and attack-use are evaluated separately.
                const itemsWithUsed = ['combo', 'effect', 'spell', 'psionic', 'weapon', 'protect', 'vehicle', 'connection', 'etc', 'once'];
                if (itemsWithUsed.includes(itemData.type) && itemData.type !== 'weapon') {
                    const usedDisable = itemData.used?.disable || 'notCheck';
                    const usedState = itemData.used?.state || 0;
                    const usedMax = itemData.used?.max || 0;
                    const usedLevel = itemData.used?.level || false;

                    let displayMax = Number(usedMax) || 0;
                    if (usedLevel && itemData.type === 'effect') {
                        // Effects use the encroachment-adjusted level.
                        const currentItem = this.actor.items.get(itemData.id);
                        const finalLevel = window.DX3rdEffectLevel && currentItem
                            ? window.DX3rdEffectLevel.value(currentItem, this.actor)
                            : Number(itemData.level) || 0;
                        displayMax += finalLevel;
                    } else if (usedLevel && itemData.type === 'psionic') {
                        // Psionics add init without encroachment scaling.
                        const baseLevel = Number(itemData.level) || 0;
                        displayMax += baseLevel;
                    }

                    // A configured zero maximum means zero available uses.
                    if (usedDisable !== 'notCheck' && usedState >= displayMax) {
                        useExhausted = true;
                    }
                }

                // Weapon use exhaustion is independent of its attack action.
                if (itemData.type === 'weapon') {
                    const usedDisable = itemData.used?.disable || 'notCheck';
                    const usedState = itemData.used?.state || 0;
                    const usedMax = itemData.used?.max || 0;

                    // A configured zero maximum means zero available uses.
                    if (usedDisable !== 'notCheck' && usedState >= usedMax) {
                        useExhausted = true;
                    }
                }

                if (!useExhausted || allowExhausted) {
                    let useText;
                    if (itemData.type === 'book') {
                        // 북은 "마도서 해독"으로 표기 (Book + Decipher 로컬라이즈 조합)
                        useText = `${game.i18n.localize('DX3rd.Book')} ${game.i18n.localize('DX3rd.Decipher')}`;
                    } else {
                        useText = game.i18n.localize(`DX3rd.${itemData.type.charAt(0).toUpperCase() + itemData.type.slice(1)}`) + " " + game.i18n.localize("DX3rd.Use");
                    }
                    content += `<button class="use-item-btn" data-item-id="${itemData.id}" data-get-target="${itemData.getTarget || false}">${markExhausted(useText, useExhausted)}</button>`;
                }

                content += `</div>`;
            } else if (itemData.type === 'rois') {
                // Eligible Lois cards advance to Titus or Sublimation.
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
            // Foundry inserts the message DOM asynchronously after ChatMessage.create resolves.
            setTimeout(() => {
                const messageElement = this._getChatMessageContent(messageId);
                if (!messageElement) {
                    return;
                }

                const toggleElement = messageElement.querySelector('.item-name-toggle');
                if (!toggleElement) {
                    return;
                }

                toggleElement.addEventListener('click', (event) => {
                    event.preventDefault();
                    event.stopPropagation();

                    this._toggleCollapsibleElements(messageElement.querySelectorAll('.collapsible-content'));
                });
            }, 1000);
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
    /** Send an item's details to chat for sheets and external UI callers. */
    sendItemToChat(actor, item) {
      if (!actor) return;
      return new DX3rdActorChatHelper(actor)._sendItemToChat(item);
    }
  };
})();
