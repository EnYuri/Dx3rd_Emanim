/**
 * Double Cross 3rd chat-card UI.
 *
 * Owns delegated chat-button events, the toggle manager, and card handlers. It must load before
 * main.js, whose ready hook calls DX3rdChatToggleManager.initialize().
 */

// Native replacement for jQuery's idempotent off('type.ns').on('type.ns', ...) pattern.
// Each key (formerly an event namespace) replaces its previous listener before registration.
window.DX3rdGlobalListeners = window.DX3rdGlobalListeners || {};
function dx3rdRegisterGlobalListener(key, type, handler, options) {
    const reg = window.DX3rdGlobalListeners;
    const prev = reg[key];
    if (prev) document.removeEventListener(prev.type, prev.handler, prev.options);
    reg[key] = { type, handler, options };
    document.addEventListener(type, handler, options);
}

// Compatibility reader for jQuery's automatic .data(key) coercion. Native dataset values are
// strings, so reproduce its boolean/null/number/JSON conversion and kebab-to-camel key mapping.
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
        try { return JSON.parse(raw); } catch { /* Keep the raw value. */ }
    }
    return raw;
}

// Read a URI-encoded formula from data-* without coercion. dx3rdReadData promotes a formula such
// as "10" to Number, which would fail later string checks and silently drop a fixed attack value.
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

function dx3rdMergeAfterSuccessDamageBonus(preservedValues, bonus) {
    if (!preservedValues || !bonus) return preservedValues;
    preservedValues.actorAttack = (Number(preservedValues.actorAttack) || 0) + (Number(bonus.attack) || 0);
    preservedValues.actorAttackFormula = window.DX3rdUniversalHandler?.joinFormulaTerms
        ? window.DX3rdUniversalHandler.joinFormulaTerms(preservedValues.actorAttackFormula, bonus.attackFormula)
        : [preservedValues.actorAttackFormula, bonus.attackFormula].filter(Boolean).join(' + ');
    preservedValues.actorPenetrate = Math.max(0,
        (Number(preservedValues.actorPenetrate) || 0) + (Number(bonus.penetrate) || 0));
    return preservedValues;
}

function dx3rdExpiredRollTimings(rollType) {
    if (rollType === 'major') return ['roll', 'major'];
    if (rollType === 'reaction' || rollType === 'dodge') return ['roll', 'reaction'];
    return ['roll'];
}

// A damage result can be rerolled from the same attack card. That reroll repeats the attack's
// follow-up processing, but it must not spend a registered weapon's attack count again. Persist
// the spend marker on the ChatMessage because the card HTML is replaced after every damage roll.
// The in-memory lock also closes the same-client double-click window before setFlag propagates.
const dx3rdWeaponAttackSpendLocks = new Set();
async function dx3rdSpendWeaponAttacksOnce(message, actor, weaponIdsRaw) {
    if (!message || !actor || typeof weaponIdsRaw !== 'string' || weaponIdsRaw.trim() === '') return false;
    if (message.getFlag('dx3rd-emanim', 'weaponAttackUseSpent') === true) return false;

    const lockKey = message.id;
    if (dx3rdWeaponAttackSpendLocks.has(lockKey)) return false;
    dx3rdWeaponAttackSpendLocks.add(lockKey);
    try {
        // Another click may have completed while this one was waiting to acquire the local path.
        if (message.getFlag('dx3rd-emanim', 'weaponAttackUseSpent') === true) return false;

        const weaponIds = [...new Set(weaponIdsRaw.split(',').map(id => id.trim()).filter(Boolean))];
        const updates = [];
        for (const weaponId of weaponIds) {
            const weaponItem = actor.items.get(weaponId);
            // Vehicles have no attack-used counter.
            if (!weaponItem || weaponItem.type !== 'weapon') continue;
            const attackUsed = weaponItem.system['attack-used'] || {};
            if ((attackUsed.disable || 'notCheck') === 'notCheck') continue;
            updates.push({
                _id: weaponItem.id,
                'system.attack-used.state': (attackUsed.state || 0) + 1
            });
        }
        if (updates.length === 0) return false;

        // Claim the one-time spend before writing the items so a reroll cannot enter this block.
        await message.setFlag('dx3rd-emanim', 'weaponAttackUseSpent', true);
        try {
            await actor.updateEmbeddedDocuments('Item', updates);
        } catch (error) {
            // A failed batch spent nothing; release the marker so the player can retry.
            await message.unsetFlag('dx3rd-emanim', 'weaponAttackUseSpent');
            throw error;
        }
        return true;
    } finally {
        dx3rdWeaponAttackSpendLocks.delete(lockKey);
    }
}

// Toggle a chat button's completion suffix. dataset.originalText replaces the old jQuery cache.
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

// Native height animation replacing jQuery slideDown/slideUp. The dataset guard prevents overlap.
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
// Reflect flag changes in every client's rendered message DOM.
Hooks.on('updateChatMessage', (message, changes, options, userId) => {
    try {
        const flagChanges = changes?.flags?.['dx3rd-emanim'];
        if (!flagChanges) return;
        
        const messageElements = Array.from(document.querySelectorAll(`[data-message-id="${message.id}"]`));
        if (messageElements.length === 0) return;
        const findButtons = (sel) => messageElements.flatMap(me => Array.from(me.querySelectorAll(sel)));

        // Editing is a message-wide state.
        if (flagChanges.editingBy !== undefined) {
            const editing = !!message.flags?.['dx3rd-emanim']?.editingBy;
            for (const me of messageElements) me.classList.toggle('dx3rd-editing-message', editing);
        }

        const completeText = game.i18n.localize('DX3rd.Complete');
        
        // Route every message-wide completion flag through the same text updater.
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
                if (flag === 'attackRollCompleted' && button.closest('.dx3rd-attack-card')) continue;
                if (flag === 'damageRollCompleted' && button.closest('.dx3rd-attack-card')) continue;
                dx3rdApplyCompleteText(button, isCompleted, completeText);
            }
        }

        // Item-use completion is keyed by item rather than by message.
        if (flagChanges.itemUseCompleted !== undefined) {
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

// Expose lifecycle cleanup through the /disable chat command.
Hooks.on('chatMessage', (chatLog, message, chatData) => {
    const disablePattern = /^\/disable\s+(roll|major|reaction|guard|main|round|scene|session)$/i;
    const match = message.match(disablePattern);
    
    if (match) {
        const timing = match[1].toLowerCase();
        window.DX3rdDisableHooks.executeDisableHook(timing);
        return false; // Consume the command instead of creating a chat message.
    }
    
    return true;
});

// Restore completion state whenever Foundry renders a chat message.
Hooks.on('renderChatMessageHTML', (message, html, data) => {
    const completeText = game.i18n.localize('DX3rd.Complete');

    // The current world setting wins over the expansion state stored in historical card HTML.
    const expandItemCards = game.settings.get('dx3rd-emanim', 'expandChatItemCards');
    html.querySelectorAll('.dx3rd-item-chat .collapsible-content').forEach(element => {
        element.classList.toggle('collapsed', !expandItemCards);
        element.style.display = expandItemCards ? '' : 'none';
    });
    
    // The sender-name → Lois action resolves its target from this header attribute.
    if (message.speaker && message.speaker.actor) {
        const messageHeader = html.querySelector('.message-header');
        if (messageHeader && !messageHeader.getAttribute('data-actor-id')) {
            messageHeader.setAttribute('data-actor-id', message.speaker.actor);
        }
    }
    
    // Restore the completed state of the invoke-spell button
    const invokeCompleted = message.getFlag('dx3rd-emanim', 'invokeCompleted');
    if (invokeCompleted === true) {
        const button = html.querySelector('.invoke-spell');
        if (button) {
            const currentText = button.textContent.trim();
            
            // Avoid appending twice when "완료" is already present
            if (!currentText.includes(completeText)) {
                const itemDataStr = button.getAttribute('data-item-data');
                let itemName = game.i18n.localize('DX3rd.Spell');
                
                if (itemDataStr) {
                    try {
                        const itemData = JSON.parse(itemDataStr);
                        itemName = itemData.name || itemName;
                    } catch (e) {
                        // Ignore a parse failure
                    }
                }
                
                button.textContent = `${itemName} ${game.i18n.localize('DX3rd.Invoking')} ${completeText}`;
            }
        }
    }
    
    // Restore per-action completion markers for legacy card HTML.
    const damageRollCompleted = message.getFlag('dx3rd-emanim', 'damageRollCompleted');
    if (damageRollCompleted === true) {
        const button = html.querySelector('.damage-roll-btn');
        if (button && !button.closest('.dx3rd-attack-card')) {
            const currentText = button.textContent.trim();
            if (!currentText.includes(completeText)) {
                const originalText = currentText || game.i18n.localize('DX3rd.DamageRoll');
                button.textContent = `${originalText} ${completeText}`;
            }
        }
    }
    
    const damageApplyCompleted = message.getFlag('dx3rd-emanim', 'damageApplyCompleted');
    if (damageApplyCompleted === true) {
        const button = html.querySelector('.damage-apply-btn');
        if (button) {
            const currentText = button.textContent.trim();
            if (!currentText.includes(completeText)) {
                const originalText = currentText || game.i18n.localize('DX3rd.DamageApply');
                button.textContent = `${originalText} ${completeText}`;
            }
        }
    }
    
    const attackRollCompleted = message.getFlag('dx3rd-emanim', 'attackRollCompleted');
    if (attackRollCompleted === true) {
        const button = html.querySelector('.attack-roll-btn');
        if (button && !button.closest('.dx3rd-attack-card')) {
            const currentText = button.textContent.trim();
            if (!currentText.includes(completeText)) {
                const originalText = currentText || game.i18n.localize('DX3rd.AttackRoll');
                button.textContent = `${originalText} ${completeText}`;
            }
        }
    }
    
    const successCompleted = message.getFlag('dx3rd-emanim', 'successCompleted');
    if (successCompleted === true) {
        const button = html.querySelector('.dx3rd-success-btn');
        if (button) {
            const currentText = button.textContent.trim();
            if (!currentText.includes(completeText)) {
                const originalText = currentText || game.i18n.localize('DX3rd.Success');
                button.textContent = `${originalText} ${completeText}`;
            }
        }
    }
    
    const winCheckCompleted = message.getFlag('dx3rd-emanim', 'winCheckCompleted');
    if (winCheckCompleted === true) {
        const button = html.querySelector('.dx3rd-win-check-btn');
        if (button) {
            const currentText = button.textContent.trim();
            if (!currentText.includes(completeText)) {
                const originalText = currentText || game.i18n.localize('DX3rd.WinCheck');
                button.textContent = `${originalText} ${completeText}`;
            }
        }
    }
    
    // Item-use buttons restore their item-scoped completion flags separately.
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
                    const originalText = currentText || game.i18n.localize('DX3rd.Use');
                    button.textContent = `${originalText} ${completeText}`;
                }
            }
        });
    }

    // Armor cards can unequip their source item directly.
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
 * Forward an HP-damage extension from a player client to the GM.
 *
 * Resolve conditional formulas on the player's client first and send nothing if the prompt is
 * cancelled. Both afterSuccess and afterDamage use this path so their behavior cannot drift.
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

// Delegated chat-card actions and expansion state.
window.DX3rdChatToggleManager = {
    initialized: false,
    
    initialize() {
        if (this.initialized) return;
        this.initialized = true;
        
        // One delegated listener owns card expansion and section buttons.
        dx3rdRegisterGlobalListener('dx3rd-global-toggle', 'click', (event) => {
            const target = event.target.closest('.item-name-toggle, .combo-toggle-btn, .book-toggle-btn');
            if (!target) return;
            event.preventDefault();
            event.stopPropagation();

            const messageElement = target.closest('.message');

            if (target.classList.contains('combo-toggle-btn')) {
                // Combo section buttons open a focused item list instead of expanding the card.
                const section = target.dataset.comboSection;
                if (window.DX3rdChatHandlers && window.DX3rdChatHandlers.showComboItemsDialog) {
                    window.DX3rdChatHandlers.showComboItemsDialog(messageElement, section);
                }
                return;
            } else if (target.classList.contains('book-toggle-btn')) {
                // For the grimoire toggle button, show the dialog
                const section = target.dataset.bookSection;
                if (window.DX3rdChatHandlers && window.DX3rdChatHandlers.showBookItemsDialog) {
                    window.DX3rdChatHandlers.showBookItemsDialog(messageElement, section);
                }
                return;
            }

            // An item-name click expands or collapses every detail section in that message.
            const collapsibleElements = messageElement
                ? Array.from(messageElement.querySelectorAll('.collapsible-content'))
                : [];
            if (collapsibleElements.length === 0) return;

            for (const el of collapsibleElements) {
                dx3rdSlideToggle(el, el.classList.contains('collapsed'));
            }
        });
        
        // Initialize cards that predate this client session.
        if (window.DX3rdChatHandlers && window.DX3rdChatHandlers.initializeExistingMessages) {
            window.DX3rdChatHandlers.initializeExistingMessages();
        }
        
        // Register the click listener for the spell invocation button
        dx3rdRegisterGlobalListener('dx3rd-invoke-spell', 'click', async (event) => {
            const button = event.target.closest('.invoke-spell');
            if (!button) return;
            event.preventDefault();
            event.stopPropagation();

            // Read the getTarget information (from the data attribute) — only a fallback hint;
            // the resolved item's own content decides whether a pick is actually needed.
            const getTargetAttr = button.dataset.getTarget;
            const getTarget = getTargetAttr === true || getTargetAttr === 'true';
            
            // Find the message
            const messageElement = button.closest('.message');
            const messageId = messageElement?.dataset?.messageId;
            const message = game.messages.get(messageId);

            if (!message) {
                ui.notifications.error('메시지를 찾을 수 없습니다.');
                return;
            }

            const isCompleted = message.getFlag('dx3rd-emanim', 'invokeCompleted') === true;

            // Store the original text (only the first time)
            if (!button.dataset.originalText) {
                button.dataset.originalText = button.textContent.trim();
            }

            // Roll back when an already completed button is clicked
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
            
            // Permission check
            if (!actor.isOwner && !game.user.isGM) {
                console.warn('DX3rd | User lacks permission to use this actor\'s actions');
                return;
            }
            
            // Parse the stored item data
            let itemData = null;
            if (itemDataStr) {
                try {
                    itemData = JSON.parse(itemDataStr);
                } catch (e) {
                    console.error('DX3rd | Failed to parse item data:', e);
                }
            }
            
            // With no item data, take it from the real item
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
            
            // Get the real item (its latest state)
            const item = actor.items.get(itemId);
            if (!item) {
                ui.notifications.error('아이템을 찾을 수 없습니다.');
                return;
            }

            // Verify the target only when something would consume the pick — the same content-aware
            // test as handleItemUse. A stray getTarget flag with an empty target channel must not
            // strand the invoke.
            const needsTarget = window.DX3rdItemEffectAdapter?.requiresTarget?.(item)
                ?? (itemData.getTarget === true || getTarget);
            if (needsTarget && !(game.user.targets?.size > 0)) {
                ui.notifications.warn(game.i18n.localize('DX3rd.SelectTarget'));
                return;
            }
            
            const handler = window.DX3rdUniversalHandler;
            if (handler) {
                const successAction = window.DX3rdItemEffectAdapter?.eventAction?.(item, 'afterSuccess') || 'use';
                // A successful invoke fires the authored use/attack bucket. Setting active.state
                // directly would turn an onUse frozen modifier into an activation toggle and make
                // the sheet's manifestation choice meaningless.
                await handler.processAfterSuccessSelfModifiers?.(actor, item, {action: successAction});
                
                // Run the 'afterSuccess' macros (with a 50 ms delay)
                await new Promise(resolve => setTimeout(resolve, 50));
                await handler.executeMacros(item, 'afterSuccess', successAction);
                
                // Apply the 'afterSuccess' target effects — prefer the use-time frozen snapshot
                const frozenApplyAttrs = await handler.takePendingAfterSuccessApply?.(actor, item, successAction);
                await handler.applyToTargets(actor, item, 'afterSuccess', null, successAction,
                    { frozenAttributes: frozenApplyAttrs || null });
                
                // afterSuccess-timing heal/damage/condition extensions are handled exactly as in handleSuccessButton
                const itemExtend = item.getFlag('dx3rd-emanim', 'itemExtend') || {};
                const selectedTargetIds = Array.from(game.user.targets).map(t => t.id);
                const extensionMatches = (type, data) => !window.DX3rdItemEffectAdapter
                    || window.DX3rdItemEffectAdapter.extensionActionMatches(
                        item, type, data, successAction, 'afterSuccess');
                
                // heal afterSuccess
                if (itemExtend.heal?.activate && itemExtend.heal?.timing === 'afterSuccess'
                    && extensionMatches('heal', itemExtend.heal)) {
                    const healDataWithTargets = {
                        ...itemExtend.heal,
                        selectedTargetIds,
                        triggerItemName: item.name,
                        triggerItemId: item.id
                    };
                    
                    // A GM only handles it directly (no socket send)
                    if (game.user.isGM) {
                        await handler.handleHealRequest({
                            actorId: actor.id,
                            healData: healDataWithTargets,
                            itemId: item.id
                        });
                    } else {
                        // A player only sends over the socket
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
                if (itemExtend.damage?.activate && itemExtend.damage?.timing === 'afterSuccess'
                    && extensionMatches('damage', itemExtend.damage)) {
                    let damageDataWithTargets = {
                        ...itemExtend.damage,
                        selectedTargetIds,
                        triggerItemName: item.name,
                        triggerItemId: item.id
                    };
                    
                    // A GM only handles it directly (no socket send)
                    if (game.user.isGM) {
                        await handler.handleDamageRequest({
                            actorId: actor.id,
                            damageData: damageDataWithTargets,
                            itemId: item.id
                        });
                    } else {
                        // A player: the conditional formula input happens on their own client → the GM handles it over the socket once settled
                        await _dx3rdEmitDamageRequestAsPlayer(actor, item, damageDataWithTargets);
                    }
                }
                
                // condition afterSuccess (the conditions array, or the older single form)
                const condEntries = handler._getConditionEntries?.(itemExtend.condition || {}) || [];
                const afterSuccessConds = condEntries.filter(c => c.timing === 'afterSuccess'
                    && extensionMatches('condition', c));
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
                        && extensionMatches(entry.type, entry.data));
                for (const entry of cardEntries) {
                    await handler.executeItemExtension(actor, entry.type, {
                        ...entry.data, selectedTargetIds, triggerItemName: item.name, triggerItemId: item.id
                    }, item);
                }
                
                // When runTiming is afterSuccess, register the afterMain extensions on the queue
                if (item.system.active?.runTiming === 'afterSuccess') {
                    await handler.registerAfterMainExtensions(actor, item, itemExtend, successAction);
                }
                
                console.log('DX3rd | Spell invoke - processed afterSuccess timing extensions');
            }
            
            // Run the major deactivation hooks on firing
            if (window.DX3rdDisableHooks) {
                await window.DX3rdDisableHooks.executeDisableHook('major', actor);
            }
            
            // Set the flag (stored on the message)
            await message.setFlag('dx3rd-emanim', 'invokeCompleted', true);
            
            // Mark the button as completed
            button.textContent = `${itemData.name} ${game.i18n.localize('DX3rd.Invoking')} ${game.i18n.localize('DX3rd.Complete')}`;
            
            // Print the chat message (when there is a roll, the message was already created at roll time, so none is created here)
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
        
        // Register the click listener for the magic disaster button
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
            
            // Permission check
            if (!actor.isOwner && !game.user.isGM) {
                console.warn('DX3rd | User lacks permission to use this actor\'s actions');
                return;
            }
            
            // Get the item (optional)
            const item = itemId ? actor.items.get(itemId) : null;
            
            // Call SpellHandler's handleDisasterButton
            if (window.DX3rdSpellHandler) {
                await window.DX3rdSpellHandler.handleDisasterButton(actor, item, disasterType, overflowCount);
            } else {
                ui.notifications.error('SpellHandler를 찾을 수 없습니다.');
            }
        });
        
        // Roll damage from an attack or effect card.
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
            const isAttackCardButton = !!button.closest('.dx3rd-attack-card');

            // Cache the label once so rolling back can restore it.
            if (!button.dataset.originalText) {
                button.dataset.originalText = button.textContent;
            }

            // Clicking a completed action rolls its UI state back.
            if (isCompleted && !isAttackCardButton) {
                await message.unsetFlag('dx3rd-emanim', 'damageRollCompleted');
                return;
            }

            const actorId = button.dataset.actorId;
            const itemId = button.dataset.itemId;
            const rollResult = dx3rdReadData(button, 'roll-result');

            // Read the state captured when the attack card was created.
            const comboAfterSuccess = message.getFlag('dx3rd-emanim', 'comboAfterSuccess');

            const preservedActorAttack = dx3rdReadData(button, 'preserved-actor-attack');
            const preservedActorPenetrate = dx3rdReadData(button, 'preserved-actor-penetrate');
            const preservedWeaponAttack = dx3rdReadData(button, 'preserved-weapon-attack');
            const weaponIdsJson = dx3rdReadData(button, 'weapon-ids');
            // Keep a missing attribute null so legacy cards can fall back to numeric weaponAttack.
            const preservedAttackFormula = dx3rdReadEncodedFormula(button, 'preserved-attack-formula') || null;
            const preservedActorAttackFormula = dx3rdReadEncodedFormula(button, 'preserved-actor-attack-formula');

            if (!actorId || !itemId) return;
            
            const actor = game.actors.get(actorId);
            // A temporary combo may no longer exist as an embedded Item.
            let item = null;
            if (itemId) {
                // Prefer the retained embedded Item while its follow-ups are still live.
                const embeddedItem = actor?.items?.get?.(itemId);
                const tempComboItem = message.getFlag('dx3rd-emanim', 'tempComboItem');
                if (embeddedItem) {
                    item = embeddedItem;
                } else if (tempComboItem && tempComboItem.id === itemId) {
                    item = window.DX3rdHydrateInstantCombo?.(tempComboItem, actor) || tempComboItem;
                } else {
                    item = null;
                }
            }
            
            if (!actor || !item) return;
            
            // Only an owner or GM may continue this actor's action.
            if (!actor.isOwner && !game.user.isGM) {
                console.warn('DX3rd | User lacks permission to use this actor\'s actions');
                return;
            }
            
            // Keep the acting token selected for the damage workflow.
            const previousToken = canvas.tokens?.controlled?.[0] || null;
            const actorToken = canvas.tokens?.placeables.find(t => t.actor?.id === actor.id);
            if (actorToken) {
                actorToken.control({ releaseOthers: true });
            }
            
            // Preserve authored and roll-time values for the damage step.
            const preservedValues = {
                actorAttack: preservedActorAttack || 0,
                actorAttackFormula: preservedActorAttackFormula,
                actorPenetrate: preservedActorPenetrate || 0,
                // Historical cards store only a numeric weaponAttack value.
                weaponAttack: preservedWeaponAttack || 0,
                weaponAttackFormula: preservedAttackFormula
            };
            
            // Spend registered weapon attacks once per attack card. Damage rerolls keep running the
            // rest of this workflow, but the same shot does not consume another attack count.
            await dx3rdSpendWeaponAttacksOnce(message, actor, weaponIdsJson);
            
            const expiredSuccessTimings = ['roll', 'major'];

            // A combo owns the merged afterSuccess pipeline.
            if (comboAfterSuccess && window.DX3rdUniversalHandler) {
                // The combo snapshot carries its merged afterSuccess work.
                const bonus = await window.DX3rdUniversalHandler.processComboAfterSuccess(comboAfterSuccess, {
                    attackItem: item,
                    expiredTimings: expiredSuccessTimings
                });
                dx3rdMergeAfterSuccessDamageBonus(preservedValues, bonus);
            }
            
            // Non-combo items process their own afterSuccess lifecycle.
            if (!comboAfterSuccess) {
                // afterSuccess macros run once the roll has succeeded.
                if (window.DX3rdUniversalHandler && window.DX3rdUniversalHandler.executeMacros) {
                    await window.DX3rdUniversalHandler.executeMacros(item, 'afterSuccess');
                }
                
                const adapter = window.DX3rdItemEffectAdapter;
                const eventAction = adapter?.eventAction(item, 'afterSuccess');
                const candidateSelfActions = new Set(eventAction ? [eventAction] : []);
                // Optional equipment authored on the use channel (Shotgun) asks after its own hit.
                // It is a use decision attached to an attack result, not an automatic attack bucket.
                if ((item.type === 'weapon' || item.type === 'vehicle')
                    && item.system?.active?.runTiming === 'afterSuccess') {
                    candidateSelfActions.add(adapter?.channelAction(item, 'self'));
                }
                const selfActions = adapter
                    ? adapter.modifierBuckets(item)
                        .filter(bucket => bucket.channel === 'self'
                            && candidateSelfActions.has(bucket.action)
                            && adapter.selfFiresAt(item, bucket.action, 'afterSuccess'))
                        .map(bucket => bucket.action)
                    : [];
                const shouldActivate = adapter
                    ? selfActions.some(action => adapter.hasFrozenSelfBucket(item, action)
                        || (adapter.selfToggleBucketMatches(item, action) && !item.system?.active?.state))
                    : (item.system.active?.runTiming === 'afterSuccess'
                        && !item.system.active?.state && (item.system?.active?.disable ?? '-') !== 'notCheck');
                // Each target bucket owns its timing; do not substitute the channel-wide value.
                const shouldApplyToTargets = window.DX3rdItemEffectAdapter
                    ? window.DX3rdItemEffectAdapter.targetFiresAt(item, null, 'afterSuccess')
                    : item.system.effect?.runTiming === 'afterSuccess';
            
                if (shouldActivate || shouldApplyToTargets) {
                    const usedDisable = item.system?.used?.disable || 'notCheck';
                    const usedState = item.system?.used?.state || 0;
                    const usedMax = item.system?.used?.max || 0;
                    
                    // Equipment asks before applying; other item types continue automatically.
                    if (item.type === 'weapon' || item.type === 'vehicle') {
                        // Exhaustion blocks only when allowExhaustedUse says so. Always use the
                        // shared reporter so this path cannot silently skip unlike other gates.
                        const exhausted = usedDisable !== 'notCheck' && usedState >= usedMax;
                        let proceed = true;
                        if (exhausted) {
                            const detail = `${game.i18n.localize('DX3rd.ExhaustedUsageCount')} (${usedState}/${usedMax})`;
                            proceed = await window.DX3rdUniversalHandler.reportUsageExhausted(actor, item, detail);
                        }
                        if (proceed && window.DX3rdChatHandlers?.showAfterSuccessDialog) {
                            const accepted = await window.DX3rdChatHandlers.showAfterSuccessDialog(
                                actor, item, shouldActivate, shouldApplyToTargets);
                            if (accepted) {
                                const updates = {};
                                const currentUsedState = item.system?.used?.state || 0;
                                updates['system.used.state'] = currentUsedState + 1;
                                await item.update(updates);
                                for (const action of selfActions) {
                                    const bonus = await window.DX3rdUniversalHandler.processAfterSuccessSelfModifiers(
                                        actor, item, { action, attackItem: item, expiredTimings: expiredSuccessTimings });
                                    dx3rdMergeAfterSuccessDamageBonus(preservedValues, bonus);
                                }
                                if (shouldApplyToTargets && window.DX3rdUniversalHandler) {
                                    const frozenApplyAttrs = await window.DX3rdUniversalHandler
                                        .takePendingAfterSuccessApply?.(actor, item);
                                    await window.DX3rdUniversalHandler.applyToTargets(actor, item, 'afterSuccess',
                                        null, null, { frozenAttributes: frozenApplyAttrs || null });
                                }
                            }
                        }
                    } else {
                        // Usage was already spent; apply each authored self bucket through the same
                        // action-aware path as combos, and carry current-damage-only bonuses in the snapshot.
                        for (const action of selfActions) {
                            const bonus = await window.DX3rdUniversalHandler.processAfterSuccessSelfModifiers(
                                actor, item, { action, attackItem: item, expiredTimings: expiredSuccessTimings });
                            dx3rdMergeAfterSuccessDamageBonus(preservedValues, bonus);
                        }
                        if (shouldApplyToTargets && window.DX3rdUniversalHandler) {
                            const frozenApplyAttrs = await window.DX3rdUniversalHandler
                                .takePendingAfterSuccessApply?.(actor, item);
                            await window.DX3rdUniversalHandler.applyToTargets(actor, item, 'afterSuccess',
                                null, null, { frozenAttributes: frozenApplyAttrs || null });
                        }
                    }
                }
            }
            
            // Carry combo afterDamage data into the damage-application button.
            const comboAfterDamageData = message.getFlag('dx3rd-emanim', 'comboAfterDamage');
            
            // The universal handler renders the roll using the preserved attack state.
            if (window.DX3rdUniversalHandler && window.DX3rdUniversalHandler.handleDamageRoll) {
                await window.DX3rdUniversalHandler.handleDamageRoll(
                    actor, item, rollResult, preservedValues, comboAfterDamageData, message
                );
            }
            
            // Non-combo afterSuccess extensions run locally for a GM or are delegated by players.
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
                    
                    // The GM executes directly; players delegate exactly once.
                    if (game.user.isGM && window.DX3rdUniversalHandler) {
                        await window.DX3rdUniversalHandler.handleHealRequest({
                            actorId: actor.id,
                            healData: healDataWithTargets,
                            itemId: item.id
                        });
                    } else {
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
                    
                    // Conditional damage input belongs to the initiating player's client.
                    if (game.user.isGM && window.DX3rdUniversalHandler) {
                        await window.DX3rdUniversalHandler.handleDamageRequest({
                            actorId: actor.id,
                            damageData: damageDataWithTargets,
                            itemId: item.id
                        });
                    } else {
                        await _dx3rdEmitDamageRequestAsPlayer(actor, item, damageDataWithTargets);
                    }
                }
                
                // _getConditionEntries accepts both the current array and the legacy singleton.
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
                
                // Queue afterMain work only from an afterSuccess activation point.
                if (item.system.active?.runTiming === 'afterSuccess' && window.DX3rdUniversalHandler) {
                    await window.DX3rdUniversalHandler.registerAfterMainExtensions(actor, item, itemExtend);
                }
            }
            
            // updateChatMessage propagates this completion marker to every client.
            if (!isAttackCardButton) {
                await message.setFlag('dx3rd-emanim', 'damageRollCompleted', true);
            }
            
            // Restore the user's previous token selection.
            if (previousToken && canvas.tokens) {
                previousToken.control({ releaseOthers: true });
            }
        });
        
        // Resolve a numeric-difficulty success button.
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

            // Cache the label once so rolling back can restore it.
            if (!button.dataset.originalText) {
                button.dataset.originalText = button.textContent.trim();
            }

            // Clicking a completed action rolls its UI state back.
            if (isCompleted) {
                await message.unsetFlag('dx3rd-emanim', 'successCompleted');
                return;
            }

            const actorId = button.dataset.actorId;
            const itemId = button.dataset.itemId;
            const previousTokenId = button.dataset.previousTokenId;
            const weaponAttack = parseInt(button.dataset.weaponAttack) || 0;
            const expiredTimings = dx3rdExpiredRollTimings(button.dataset.rollType);
            const comboAfterSuccess = message.getFlag('dx3rd-emanim', 'comboAfterSuccess');

            // Numeric success uses the same combo snapshot as opposed and attack rolls. Temporary
            // combo documents are deleted after opening the roll dialog, so an itemId lookup alone
            // would lose every member's afterSuccess data.
            try {
                if (window.DX3rdUniversalHandler) {
                    if (comboAfterSuccess) {
                        await window.DX3rdUniversalHandler.processComboAfterSuccess(comboAfterSuccess, { expiredTimings });
                    } else {
                        await window.DX3rdUniversalHandler.handleSuccessButton(
                            actorId, itemId, previousTokenId, weaponAttack, { expiredTimings });
                    }
                }
            } catch (e) {
                console.error('DX3rd | handleSuccessButton error:', e);
                // Completion remains a UI action even if follow-up processing reports an error.
            }

            await message.setFlag('dx3rd-emanim', 'successCompleted', true);

            // Update locally now; other clients follow through updateChatMessage.
            dx3rdApplyCompleteText(button, true, game.i18n.localize('DX3rd.Complete'));
        });
        
        // Resolve an opposed-roll victory button.
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

            // Cache the label once so rolling back can restore it.
            if (!button.dataset.originalText) {
                button.dataset.originalText = button.textContent;
            }

            // Clicking a completed action rolls its UI state back.
            if (isCompleted) {
                await message.unsetFlag('dx3rd-emanim', 'winCheckCompleted');
                button.textContent = button.dataset.originalText;
                return;
            }

            const actorId = button.dataset.actorId;
            const itemId = button.dataset.itemId;
            const previousTokenId = button.dataset.previousTokenId;
            const expiredTimings = dx3rdExpiredRollTimings(button.dataset.rollType);
            
            const comboAfterSuccess = message.getFlag('dx3rd-emanim', 'comboAfterSuccess');
            
            // Combo snapshots own merged follow-up work; ordinary items use the legacy handler.
            if (window.DX3rdUniversalHandler) {
                if (comboAfterSuccess) {
                    await window.DX3rdUniversalHandler.processComboAfterSuccess(comboAfterSuccess, { expiredTimings });
                } else {
                    await window.DX3rdUniversalHandler.handleSuccessButton(
                        actorId, itemId, previousTokenId, 0, { expiredTimings });
                }
            }
            
            await message.setFlag('dx3rd-emanim', 'winCheckCompleted', true);

            // Update locally now; other clients follow through updateChatMessage.
            dx3rdApplyCompleteText(button, true, game.i18n.localize('DX3rd.Complete'));
        });
        
        // Apply a completed damage roll to its targets.
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

            // Cache the label once so rolling back can restore it.
            if (!button.dataset.originalText) {
                button.dataset.originalText = button.textContent;
            }

            // Clicking a completed action rolls its UI state back.
            if (isCompleted) {
                await message.unsetFlag('dx3rd-emanim', 'damageApplyCompleted');
                return;
            }

            const actorId = button.dataset.actorId;
            const itemId = button.dataset.itemId;
            const damage = dx3rdReadData(button, 'damage');
            const penetrate = dx3rdReadData(button, 'penetrate');
            const attackResult = Number(button.dataset.attackResult) || 0;

            const actor = game.actors.get(actorId);
            if (!actor) {
                console.warn('DX3rd | Actor not found:', actorId);
                return;
            }

            // Resolve either a temporary combo snapshot or an embedded item.
            let item = null;
            if (itemId) {
                const embeddedItem = actor?.items?.get?.(itemId);
                const tempComboItem = message.getFlag('dx3rd-emanim', 'tempComboItem');
                if (embeddedItem) {
                    item = embeddedItem;
                } else if (tempComboItem && tempComboItem.id === itemId) {
                    item = window.DX3rdHydrateInstantCombo?.(tempComboItem, actor) || tempComboItem;
                } else {
                    item = null;
                }
            }
            
            const comboAfterDamageData = message.getFlag('dx3rd-emanim', 'comboAfterDamage');
            const attackAfterDamageRiders = message.getFlag('dx3rd-emanim', 'attackAfterDamageRiders') || [];

            // runDamageApply owns permission, token, target, hatred, and application checks. This
            // keeps manual card clicks aligned with automatic application after the damage dialog.
            const applied = await window.DX3rdUniversalHandler?.runDamageApply?.({
                actor, item, damage, penetrate, attackResult, comboAfterDamageData, attackAfterDamageRiders
            });
            if (!applied) return;

            // updateChatMessage propagates this completion marker to every client.
            await message.setFlag('dx3rd-emanim', 'damageApplyCompleted', true);
        });
        
        // Reopen an attack workflow from a weapon or vehicle card.
        dx3rdRegisterGlobalListener('dx3rd-attack-roll', 'click', async (event) => {
            const button = event.target.closest('.attack-roll-btn');
            if (!button) return;
            event.preventDefault();
            event.stopPropagation();

            const itemId = button.dataset.itemId;

            if (!itemId) return;

            const messageElement = button.closest('.message');
            const messageId = messageElement?.dataset?.messageId;

            if (!messageId) return;

            const message = game.messages.get(messageId);
            if (!message) {
                ui.notifications.error('메시지를 찾을 수 없습니다.');
                return;
            }

            const repeatable = button.dataset.repeatable === 'true';
            const isAttackCardButton = !!button.closest('.dx3rd-attack-card');
            const isCompleted = !isAttackCardButton && !repeatable
                && message.getFlag('dx3rd-emanim', 'attackRollCompleted') === true;

            // Cache the label once so rolling back can restore it.
            if (!button.dataset.originalText) {
                button.dataset.originalText = button.textContent;
            }
            
            // Clicking a completed action rolls its UI state back.
            if (isCompleted) {
                await message.unsetFlag('dx3rd-emanim', 'attackRollCompleted');
                return;
            }
            
            if (!message.speaker || !message.speaker.actor) return;
            
            const actorId = message.speaker.actor;
            const actor = game.actors.get(actorId);
            if (!actor) return;
            
            if (!actor.isOwner && !game.user.isGM) {
                console.warn('DX3rd | User lacks permission to use this actor\'s actions');
                return;
            }
            
            const item = actor.items.get(itemId);
            if (!item) return;
            
            // Equipment reopens the accuracy workflow; other attack items reopen their use flow.
            let attackRollSuccess = false;
            if (window.DX3rdUniversalHandler) {
                if (item.type === 'weapon' || item.type === 'vehicle') {
                    attackRollSuccess = await window.DX3rdUniversalHandler.handleAttackRoll(actor, item, {
                        forceRoll: true,
                        sourceMessage: message
                    });
                } else {
                    attackRollSuccess = await window.DX3rdUniversalHandler.handleItemUse(
                        actor.id, item.id, item.type, undefined, undefined, {
                            reroll: true,
                            sourceMessage: message
                        }
                    );
                }
            }
            
            // Mark completion only after the handler accepts the action.
            if (attackRollSuccess && !isAttackCardButton && !repeatable) {
                await message.setFlag('dx3rd-emanim', 'attackRollCompleted', true);
            }
        });
        
        // Use an item directly from its chat card.
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

            const messageElement = button.closest('.message');
            const messageId = messageElement?.dataset?.messageId;
            const message = game.messages.get(messageId);

            if (!message) {
                return;
            }

            const itemUseCompleted = message.getFlag('dx3rd-emanim', 'itemUseCompleted') || {};
            const isCompleted = itemUseCompleted[itemId] === true;

            // Cache the label once so rolling back can restore it.
            if (!button.dataset.originalText) {
                button.dataset.originalText = button.textContent.trim();
            }
            
            // Clicking a completed action clears only this item's completion flag.
            if (isCompleted) {
                const updatedItemUseCompleted = { ...itemUseCompleted };
                delete updatedItemUseCompleted[itemId];
                
                // Remove the flag entirely once its per-item map becomes empty.
                if (Object.keys(updatedItemUseCompleted).length === 0) {
                    await message.unsetFlag('dx3rd-emanim', 'itemUseCompleted');
                } else {
                    await message.setFlag('dx3rd-emanim', 'itemUseCompleted', updatedItemUseCompleted);
                }
                return;
            }
            
            const speakerElement = messageElement?.querySelector('.message-header .message-sender');
            const actorName = speakerElement?.textContent.trim() || '';
            
            // Prefer the button actor, then fall back to the message speaker.
            let actorId = null;
            try {
                if (message && message.speaker && message.speaker.actor) {
                    actorId = message.speaker.actor;
                }
            } catch (e) {
            }
            
            // Resolve the embedded item from the actor that owns the card.
            let itemType = 'unknown';
            
            try {
                if (actorId) {
                    const actor = game.actors.get(actorId);
                    
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
            }
            
            // Leave getTarget undefined so the universal handler reads the item's current value.
            let itemUseSuccess = false;
            if (window.DX3rdUniversalHandler && window.DX3rdUniversalHandler.handleItemUse) {
                itemUseSuccess = await window.DX3rdUniversalHandler.handleItemUse(actorId, itemId, itemType, roisAction, undefined);
            }
            
            // Mark completion only after the handler accepts the action.
            if (itemUseSuccess) {
                const updatedItemUseCompleted = { ...itemUseCompleted, [itemId]: true };
                await message.setFlag('dx3rd-emanim', 'itemUseCompleted', updatedItemUseCompleted);
            }
        });
        
        // Clicking a message sender can create a Lois toward that actor.
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
            
            const targetActor = game.actors.get(targetActorId);
            if (!targetActor) {
                ui.notifications.warn(game.i18n.localize('DX3rd.ActorNotFound'));
                return;
            }
            
            // The source is the controlled token's actor, then the user's assigned actor.
            const controlledToken = canvas?.tokens?.controlled?.[0];
            const currentActor = controlledToken?.actor || game.user?.character;
            
            if (!currentActor) {
                ui.notifications.warn(game.i18n.localize('DX3rd.NoActorSelected'));
                return;
            }
            
            if (!currentActor.isOwner && !game.user.isGM) {
                ui.notifications.warn(game.i18n.localize('DX3rd.NoPermission'));
                return;
            }
            
            // Do not create a duplicate Lois for the same target actor.
            const existingLois = currentActor.items.find(item => 
                item.type === 'rois' && item.system?.actor === targetActorId
            );
            
            if (existingLois) {
                ui.notifications.info(game.i18n.localize('DX3rd.LoisAlreadyExists'));
                return;
            }
            
            // An actor may have at most one S-Lois.
            const hasSType = currentActor.items.some(item => 
                item.type === 'rois' && item.system?.type === 'S'
            );
            
            // Collect the Lois type and positive/negative emotions.
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
                        // Positive and negative main-emotion choices are mutually exclusive.
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
            
            // Persist the selected relationship as an embedded item.
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

// Chat-card dialog and item-list handlers.
window.DX3rdChatHandlers = {
    async showAfterSuccessDialog(actor, item, shouldActivate, shouldApplyToTargets) {
        let resolveChoice;
        const choice = new Promise(resolve => { resolveChoice = resolve; });
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
        
        const title = document.createElement("div");
        title.textContent = `${item.name}`;
        title.style.marginBottom = "16px";
        title.style.fontSize = "1em";
        title.style.fontWeight = "bold";
        title.style.cursor = "move";
        dialogDiv.appendChild(title);
        
        const buttonContainer = document.createElement("div");
        buttonContainer.style.display = "flex";
        buttonContainer.style.flexDirection = "column";
        buttonContainer.style.gap = "8px";
        
        // Return the choice to the attack-card pipeline. It owns spending, bucket application,
        // and the preserved damage snapshot, so damage cannot open before this decision finishes.
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
        useBtn.onclick = () => {
            if (dialogDiv.parentNode) document.body.removeChild(dialogDiv);
            resolveChoice(true);
        };
        buttonContainer.appendChild(useBtn);
        
        // Closing without use must not activate, target, or spend the item.
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
        notUseBtn.onclick = () => {
            if (dialogDiv.parentNode) document.body.removeChild(dialogDiv);
            resolveChoice(false);
        };
        buttonContainer.appendChild(notUseBtn);
        
        dialogDiv.appendChild(buttonContainer);
        
        // Keep the lightweight dialog draggable without depending on an Application class.
        let isDragging = false;
        let offsetX;
        let offsetY;
        
        const onMouseDown = (e) => {
            if (e.target.tagName === 'BUTTON') return;
            
            isDragging = true;
            
            const rect = dialogDiv.getBoundingClientRect();
            offsetX = e.clientX - rect.left;
            offsetY = e.clientY - rect.top;
            
            dialogDiv.style.cursor = "grabbing";
            title.style.cursor = "grabbing";
        };
        
        const onMouseMove = (e) => {
            if (!isDragging) return;
            
            e.preventDefault();
            
            const newLeft = e.clientX - offsetX;
            const newTop = e.clientY - offsetY;
            
            dialogDiv.style.left = newLeft + "px";
            dialogDiv.style.top = newTop + "px";
            dialogDiv.style.transform = "none"; // Stop using the initial centering transform after a drag.
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
        
        // Document-level drag listeners must not outlive the dialog.
        const cleanup = () => {
            document.removeEventListener("mousemove", onMouseMove);
            document.removeEventListener("mouseup", onMouseUp);
        };
        
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
        return choice;
    },
    
    
    initializeExistingMessages() {
        // Foundry v14 uses .chat-log; retain #chat-log for older supported cores.
        const existingMessages = document.querySelectorAll('#chat-log .message, .chat-log .message');

        const expandItemCards = game.settings.get('dx3rd-emanim', 'expandChatItemCards');
        for (const messageElement of existingMessages) {
            const collapsibleElements = messageElement.querySelectorAll('.dx3rd-item-chat .collapsible-content');
            // The current world setting wins over state stored in historical card HTML.
            for (const el of collapsibleElements) {
                el.classList.toggle('collapsed', !expandItemCards);
                el.style.display = expandItemCards ? '' : 'none';
            }
        }
    },
    
    showComboItemsDialog(messageElement, section) {
        // Resolve the actor through the ChatMessage rather than trusting card data.
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
        } catch {
            return;
        }
        
        if (!actorId) {
            return;
        }
        
        const actor = game.actors.get(actorId);
        if (!actor) {
            return;
        }
        
        const comboItems = actor.items.filter(item => item.type === 'combo'
            && !window.DX3rdIsInstantCombo?.(item));
        if (comboItems.length === 0) {
            return;
        }
        
        const comboItem = comboItems[0];
        
        // Collect only the requested card section.
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
        // Extract the actor information from the message
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
        
        // Find the grimoire item
        const bookItems = actor.items.filter(item => item.type === 'book');
        if (bookItems.length === 0) {
            return;
        }
        
        // Use the first grimoire item (the most recently created one when there are several)
        const bookItem = bookItems[0];
        
        // Collect the items by section
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
        
        // Show the dialog
        this.createBookItemsDialog(sectionName, items, bookItem.name, actor);
    },
    
    getBookSpells(actor, bookItem) {
        const spells = [];
        if (bookItem.system.spells && Array.isArray(bookItem.system.spells)) {
            for (const spellId of bookItem.system.spells) {
                if (spellId && spellId !== '-') {
                    // Look it up among the shared items
                    const spell = game.items.get(spellId);
                    
                    if (spell && spell.type === 'spell') {
                        // Check whether the actor has a spell of the same name
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
        
        // Create the dialog
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
        
        // Prefer an actor skill entry, including configured custom display names.
        if (actor) {
            const skill = actor.system?.attributes?.skills?.[skillKey];
            if (skill) {
                if (skill.name && skill.name.startsWith('DX3rd.')) {
                    const customSkills = game.settings.get("dx3rd-emanim", "customSkills") || {};
                    const customSkill = customSkills[skillKey];
                    
                    if (customSkill) {
                        return typeof customSkill === 'object' ? customSkill.name : customSkill;
                    } else {
                        return game.i18n.localize(skill.name);
                    }
                }
                return skill.name || skillKey;
            }
        }
        
        // Fall back to base attributes and syndrome keys.
        const attributes = ['body', 'sense', 'mind', 'social'];
        if (attributes.includes(skillKey)) {
            return game.i18n.localize(`DX3rd.${skillKey.charAt(0).toUpperCase() + skillKey.slice(1)}`);
        }
        
        if (skillKey === 'syndrome') {
            return game.i18n.localize('DX3rd.Syndrome');
        }
        
        // Finally localize an explicit DX3rd.* key even when it is not on the actor.
        if (skillKey.startsWith('DX3rd.')) {
            return game.i18n.localize(skillKey);
        }
        
        return skillKey;
    }
};
