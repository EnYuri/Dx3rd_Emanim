// The Rois item handler
(function() {
const DialogV2 = foundry.applications?.api?.DialogV2;

window.DX3rdRoisHandler = {
    async handle(actorId, itemId) {
        try {
            // Find the actor and the item
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
            
            // The use button on the chat message was clicked
            // Titus when it is not checked, Sublimation when it is
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
            // Find the actor and the item
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
            
            // The Titus button acts only when Titus is not checked
            if (!item.system.titus) {
                // Check Titus
                await item.update({
                    "system.titus": true
                });
                
                // Output the chat message
                const chatData = {
                    speaker: ChatMessage.getSpeaker({ actor: actor }),
                    content: `<div class="dx3rd-item-chat">${game.i18n.localize("DX3rd.Titus")}(${item.name})</div>`,
                    style: CONST.CHAT_MESSAGE_STYLES.OTHER,
                };
                
                await ChatMessage.create(chatData);

                // Fire the D-Lois embedded macro (becoming a Titus = the effect's firing point). Encroachment rise, applied buffs, and so on.
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
            // Find the actor and the item
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
            
            // Check the Lois type
            const roisType = item.system.type || '-';
            
            // A D (commentary), M (memory) or E (consumed) Lois cannot be sublimated
            if (roisType === 'D' || roisType === 'M' || roisType === 'E') {
                ui.notifications.warn("이 로이스는 승화할 수 없습니다.");
                return;
            }
            
            // Sublimation is impossible unless Titus is checked
            if (!item.system.titus) {
                ui.notifications.warn("Titus가 활성화되어 있지 않습니다.");
                return;
            }
            
            // Check whether it is an S-Lois
            const isSuperior = (roisType === 'S');
            
            // Load the Sublimation dialog template
            const template = 'systems/dx3rd-emanim/templates/dialog/sublimation-dialog.html';
            const html = await foundry.applications.handlebars.renderTemplate(template, { isSuperior });
            
            if (!DialogV2) {
                ui.notifications.error(game.i18n.localize('DX3rd.DialogV2Unavailable'));
                return;
            }

            // Create the dialog
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

            // SubActions 5 and 9 are enabled only when HP is 0
            const currentHP = actor.system.attributes.hp.value;
            if (currentHP > 0) {
                root.querySelector('.sublimation-action-btn[data-action="5"]')?.setAttribute('disabled', 'disabled');
                root.querySelector('.sublimation-action-btn[data-action="9"]')?.setAttribute('disabled', 'disabled');
            }

            // Add a click event to each button
            root.querySelectorAll('.sublimation-action-btn').forEach(button => {
                button.addEventListener('click', async (event) => {
                    const actionNumber = event.currentTarget?.dataset?.action;
                    if (event.currentTarget?.disabled || !actionNumber) return;

                    // The per-SubAction implementation
                    const actionText = game.i18n.localize(`DX3rd.SubAction${actionNumber}`);

                    // Apply the sublimation effect (each SubAction returns true/false/a result value)
                    const actionResult = await window.DX3rdRoisHandler.applySublimationEffect(actor, item, actionNumber);

                    // null is returned only when cancelled (cancelling action 0, or closing the dialog)
                    if (actionResult === null) {
                        return; // the sublimation dialog stays open
                    }

                    // Output the chat message
                    let content = `${game.i18n.localize("DX3rd.Sublimation")}(${item.name})<br>· ${actionText}`;

                    // For SubAction 2, add the roll result
                    if (actionNumber === "2" && actionResult) {
                        content += `<br>${actionResult}`;
                    }

                    // For SubAction 9, add whether the conditions were cleared
                    if (actionNumber === "9" && actionResult) {
                        content += `<br>· ${game.i18n.localize("DX3rd.AllConditionClear")}`;
                    }

                    // Create the chat message (SubAction 0 already created it in its dialog)
                    if (actionNumber !== "0") {
                        const chatData = {
                            speaker: ChatMessage.getSpeaker({ actor: actor }),
                            content: `<div class="dx3rd-item-chat">${content}</div>`,
                            style: CONST.CHAT_MESSAGE_STYLES.OTHER,
                        };

                        await ChatMessage.create(chatData);
                    }

                    // Check Sublimation (Titus is kept)
                    await item.update({
                        "system.sublimation": true
                    });

                    // Close the dialog
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
            
            // Convert actionNumber to a string
            const action = String(actionNumber);
            
            switch(action) {
                case '1': // add ten dice to the roll
                    await this.createAppliedEffect(actor, effectName, 'roll', {
                        dice: 10
                    }, item.img);
                    return true;
                    
                case '2': // add +1D10 to the roll's result value
                    // Roll 1d10
                    const roll = new Roll('1d10');
                    await roll.evaluate();
                    const rollResult = roll.total;
                    
                    // Return the rendered roll
                    const rollHtml = await roll.render();
                    ui.notifications.info(`달성치에 +${rollResult}을 추가하세요.`);
                    return rollHtml;
                    
                case '3': // apply a -1 modifier to the roll's critical value
                    await this.createAppliedEffect(actor, effectName, 'roll', {
                        critical: -1,
                        critical_min: 2
                    }, item.img);
                    return true;
                    
                case '4': // add two magic dice to the magic roll
                    await this.createAppliedEffect(actor, effectName, 'major', {
                        cast_dice: 2
                    }, item.img);
                    return true;
                    
                case '5': // recover from being incapacitated
                    // HP recovery: 10 + body.total
                    const bodyTotal = actor.system.attributes.body.total;
                    const healAmount = 10 + bodyTotal;
                    
                    // Increase HP (never below 0)
                    const currentHP5 = actor.system.attributes.hp.value;
                    const maxHP5 = actor.system.attributes.hp.max;
                    const newHP5 = Math.min(Math.max(0, currentHP5 + healAmount), maxHP5);
                    
                    await actor.update({
                        'system.attributes.hp.value': newHP5
                    });
                    
                    ui.notifications.info(`HP를 ${healAmount}만큼 회복했습니다. (${currentHP5} → ${newHP5})`);
                    return true;
                    
                case '6': // remove an unfavourable effect (clear a condition)
                    // Clear the conditions: rigor, pressure, dazed, poisoned, hatred, fear, berserk
                    const conditionsToRemove6 = ['rigor', 'pressure', 'dazed', 'poisoned', 'hatred', 'fear', 'berserk'];
                    const removedConditions6 = [];
                    
                    // Store the message control information in the condition map
                    if (!window.DX3rdConditionTriggerMap) {
                        window.DX3rdConditionTriggerMap = new Map();
                    }
                    
                    for (const condition of conditionsToRemove6) {
                        if (actor.effects.find(e => e.statuses.has(condition))) {
                            // Set the message control flag
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
                    
                    // The condition-clearing result message
                    if (removedConditions6.length > 0) {
                        ui.notifications.info(`상태이상을 해제했습니다.`);
                        return true; // a condition was cleared
                    } else {
                        ui.notifications.info(`해제할 상태이상이 없습니다.`);
                        return false; // no condition was cleared
                    }
                    
                case '7': // other effects
                    return true; // other effects always count as a success
                    
                case '8': // S-Lois: add five dice to the damage roll
                    await this.createAppliedEffect(actor, effectName, 'roll', {
                        attack: '5d10'
                    }, item.img);
                    return true;
                    
                case '9': // S-Lois: full recovery from being incapacitated
                    // Recover HP to the maximum
                    const maxHP9 = actor.system.attributes.hp.max;
                    await actor.update({
                        'system.attributes.hp.value': maxHP9
                    });
                    
                    // Clear the conditions: rigor, pressure, dazed, poisoned, hatred, fear, berserk
                    const conditionsToRemove = ['rigor', 'pressure', 'dazed', 'poisoned', 'hatred', 'fear', 'berserk'];
                    const removedConditions = [];
                    
                    // Store the message control information in the condition map
                    if (!window.DX3rdConditionTriggerMap) {
                        window.DX3rdConditionTriggerMap = new Map();
                    }
                    
                    for (const condition of conditionsToRemove) {
                        if (actor.effects.find(e => e.statuses.has(condition))) {
                            // Set the message control flag
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
                    
                    // One combined message after every condition has been cleared
                    if (removedConditions.length > 0) {
                        ui.notifications.info(`HP를 최대까지 회복하고 상태이상을 해제했습니다.`);
                        return true; // a condition was cleared
                    } else {
                        ui.notifications.info(`HP를 최대까지 회복했습니다.`);
                        return false; // no condition was cleared
                    }
                    
                case '0': // S-Lois: recover an effect's use count
                    // Find the use-limited effects whose state is 1 or more
                    const effectItems = actor.items.filter(i => i.type === 'effect');
                    
                    const recoverableEffects = effectItems.filter(effect => {
                        const notCheck = effect.system?.used?.disable || 'notCheck';
                        const state = effect.system?.used?.state || 0;
                        const max = effect.system?.used?.max || 0;
                        const level = effect.system?.used?.level || false;
                        
                        // Compute displayMax (adding the level when used.level is checked)
                        let displayMax = Number(max) || 0;
                        if (level && effect.type === 'effect') {
                            const finalLevel = window.DX3rdEffectLevel
                                ? window.DX3rdEffectLevel.value(effect, actor)
                                : Number(effect.system?.level?.init) || 0;
                            displayMax += finalLevel;
                        } else if (level && effect.type === 'psionic') {
                            const baseLevel = Number(effect.system?.level?.init) || 0;
                            displayMax += baseLevel;
                        }
                        
                        window.DX3rdDebug.log(`DX3rd | Effect ${effect.name}: notCheck=${notCheck}, state=${state}, max=${max}, level=${level}, displayMax=${displayMax}`);
                        
                        // notCheck is false, state is 1 or more, and displayMax is greater than 0
                        return notCheck !== 'notCheck' && state >= 1 && displayMax > 0;
                    });
                    
                    if (recoverableEffects.length === 0) {
                        ui.notifications.info("회복할 수 있는 이펙트가 없습니다.");
                        return true;
                    }
                    
                    // Show the effect recovery dialog
                    const template = 'systems/dx3rd-emanim/templates/dialog/effect-recovery-dialog.html';
                    const effectsData = recoverableEffects.map(effect => {
                        const state = effect.system?.used?.state || 0;
                        const max = effect.system?.used?.max || 0;
                        const level = effect.system?.used?.level || false;
                        
                        // Compute displayMax (adding the level when used.level is checked)
                        let displayMax = Number(max) || 0;
                        if (level && effect.type === 'effect') {
                            const finalLevel = window.DX3rdEffectLevel
                                ? window.DX3rdEffectLevel.value(effect, actor)
                                : Number(effect.system?.level?.init) || 0;
                            displayMax += finalLevel;
                        } else if (level && effect.type === 'psionic') {
                            const baseLevel = Number(effect.system?.level?.init) || 0;
                            displayMax += baseLevel;
                        }
                        
                        const effectData = {
                            id: effect.id,
                            name: effect.name.split('||')[0], // drop everything after ||
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

                                        // For SubAction 0, create the chat message directly
                                        const effectName = effect.name.split('||')[0];
                                        const chatData = {
                                            speaker: ChatMessage.getSpeaker({ actor: actor }),
                                            content: `<div class="dx3rd-item-chat">${game.i18n.localize("DX3rd.Sublimation")}(${item.name})<br>· ${effectName} 사용 횟수 회복</div>`,
                                            style: CONST.CHAT_MESSAGE_STYLES.OTHER
                                        };

                                        await ChatMessage.create(chatData);

                                        resolve(effectName); // return the name of the recovered item
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
            // Generate a unique key (timestamp based)
            const effectKey = `sublimation_${Date.now()}`;

            // Build the applied effect data (disable sits at the top level)
            const effectData = {
                name: name,
                source: actor.name,
                disable: disable || '-',
                img: img || 'icons/svg/aura.svg',
                attributes: attributes || {}
            };

            // Store it as a native ActiveEffect
            await window.DX3rdAppliedEffects.set(actor, effectKey, effectData);

            ui.notifications.info(`${name} 효과가 적용되었습니다.`);
            
        } catch (error) {
            console.error("DX3rd | Error in createAppliedEffect:", error);
            throw error;
        }
    }
};
})();
