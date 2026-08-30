// The spell item handler
(function() {
const DialogV2 = foundry.applications?.api?.DialogV2;

/**
 * Execute macros by prefix (GM only)
 * @param {string} prefix - Macro name prefix
 */
async function executeMacrosByPrefix(prefix) {
    // The GM alone runs macros
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
                        // Returning nullish would let DialogV2 substitute the button's action string.
                        return false;
                    }
                    return selectedId;
                }
            },
            {
                action: 'cancel',
                icon: 'fas fa-times',
                label: game.i18n.localize('DX3rd.Cancel'),
                callback: () => false
            }
        ],
        close: () => null
    });
}

/**
 * Shared metadata for the three spell tables (disaster / calamity / catastrophe).
 * They differ only in localization key, effect key prefix and effect lifetime; the procedure is identical.
 * Description text keys follow the `${i18n}Text${resultNumber}` convention.
 */
const SPELL_TABLES = {
    disaster:    { i18n: 'DX3rd.SpellDisaster',    keyPrefix: 'spell_disaster',    disable: 'scene' },
    calamity:    { i18n: 'DX3rd.SpellCalamity',    keyPrefix: 'spell_calamity',    disable: 'scene' },
    catastrophe: { i18n: 'DX3rd.SpellCatastrophe', keyPrefix: 'spell_catastrophe', disable: 'session' }
};

window.DX3rdSpellHandler = {
    async handle(actorId, itemId, getTarget) {
        const actor = game.actors.get(actorId);
        if (!actor) { ui.notifications.warn(game.i18n.localize('DX3rd.ActorNotFound')); return; }
        // Look in the actor's items first, then fall back to game.items
        const item = actor.items.get(itemId) || game.items.get(itemId);
        if (!item) { ui.notifications.warn(game.i18n.localize('DX3rd.ItemNotFound')); return; }

        // Branch on the spell roll type: '-' is the original logic, 'CastingRoll' is handled separately
        const rollType = item.system?.roll ?? '-';
        if (rollType === 'CastingRoll') {
            await this.handleCastingRoll(actor, item, getTarget);
            return;
        }

        // Default ('-') behavior: encroachment, activation and extensions are already done in handleItemUse
    }
    ,
    async handleCastingRoll(actor, item, getTarget) {
        // Note: the CastingRoll branch does NOT immediately raise encroachment, run macros or apply to targets.
        // This is only the entry point for choosing a difficulty and everything that follows.

        // Choose and display the difficulty
        const invokeStr = String(item.system?.invoke?.value ?? '').trim();
        const evocationStr = String(item.system?.evocation?.value ?? '').trim();
        const hasInvoke = invokeStr !== '' && invokeStr !== '-';
        const hasEvocation = evocationStr !== '' && evocationStr !== '-';

        // Only one of the two is set: use it as the difficulty
        if (hasInvoke && !hasEvocation) {
            await this.showCastingRollDialog(actor, item, invokeStr, getTarget);
            return;
        }
        if (!hasInvoke && hasEvocation) {
            await this.showCastingRollDialog(actor, item, evocationStr, getTarget);
            return;
        }

        // Both are set: ask which one
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

        // Both empty or '-': skip the casting roll and create the invocation button directly
        const handler = window.DX3rdUniversalHandler;
        if (handler) {
            await handler.ensureActivated(item, actor);
            
            // Create the invocation button
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
        const castRollFormula = actor.system?.attributes?.cast?.rollFormula || {};
        const eibonDice = Number(actor.system?.attributes?.cast?.eibon ?? 0);

        // All three fields are editable. The magic-dice field means the FINAL count (Eibon included),
        // and whatever it says at roll time is what gets rolled.
        // Dice and add are arithmetic in the roll formula, so type=number takes integers only (no dice formulas).
        // The invocation value may be non-numeric in the item data, so it stays text and only the input is checked.
        const overrideHint = l('DX3rd.RollFieldOverrideHint');
        const content = `
            <div class="dx3rd-casting-dialog">
                <div class="dx3rd-row dx3rd-3col">
                    <div>
                        <div class="label">${diceLabel}</div>
                        <input type="number" name="dice" value="${castDice}" data-dtype="Number" title="${overrideHint}">
                    </div>
                    <div>
                        <div class="label">${addLabel}</div>
                        <input type="number" name="add" value="${castAdd}" data-dtype="Number" title="${overrideHint}">
                    </div>
                    <div>
                        <div class="label">${diffLabel}</div>
                        <input type="text" name="difficulty" value="${difficulty}" data-dtype="String" title="${overrideHint}">
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
                        const form = button.form;
                        const useEibon = form?.elements?.eibon?.checked || false;
                        const useAngel = form?.elements?.angel?.checked || false;

                        // The fields are unlocked, so the roll reads the inputs rather than constants.
                        // A non-numeric entry falls back to the original, so one typo cannot zero the check.
                        const readNumber = (name, fallback) => {
                            const raw = String(form?.elements?.[name]?.value ?? '').trim();
                            const parsed = Number(raw);
                            if (raw === '' || !Number.isFinite(parsed)) return fallback;
                            return parsed;
                        };
                        const dialogDice = Math.trunc(readNumber('dice', castDice + (useEibon ? eibonDice : 0)));
                        const dialogAdd = Math.trunc(readNumber('add', castAdd));

                        const rawDifficulty = String(form?.elements?.difficulty?.value ?? '').trim();
                        let finalDifficulty = difficulty;
                        if (rawDifficulty !== '') {
                            if (Number.isFinite(Number(rawDifficulty))) finalDifficulty = rawDifficulty;
                            else ui.notifications.warn(l('DX3rd.InvokeValueInvalid'));
                        }

                        await this.performCastingRoll(actor, item, {
                            dialogDice,
                            castAdd: dialogAdd,
                            castRollFormula,
                            eibonDice,
                            difficulty: finalDifficulty,
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
                // Wire up the checkbox change listeners
                root.querySelector('#eibon-checkbox')?.addEventListener('change', () => {
                    this.updateDiceDisplay(root, castDice, eibonDice);
                });
                root.querySelector('#angel-checkbox')?.addEventListener('change', () => {
                    this.updateDiceDisplay(root, castDice, eibonDice);
                });
                // Color a field the user edited (the magic-dice field is excluded — that color means Eibon).
                for (const name of ['add', 'difficulty']) {
                    const el = root.querySelector(`input[name="${name}"]`);
                    const original = el?.value ?? '';
                    el?.addEventListener('input', () => {
                        el.classList.toggle('dx3rd-overridden', el.value.trim() !== original.trim());
                    });
                }
            }
        });
    }
    ,
    updateDiceDisplay(root, castDice, eibonDice) {
        const useEibon = root.querySelector('#eibon-checkbox')?.checked || false;
        const diceInput = root.querySelector('input[name="dice"]');
        if (!diceInput) return;
        
        // Since the field was unlocked it means "the final magic-dice count". Even with Eibon checked it must
        // hold the sum rather than a string like "5 + 2", so the user can keep editing from that value.
        // Toggling the checkbox restores the computed value, overwriting a hand-edited one.
        if (useEibon && eibonDice > 0) {
            // Eibon's forbidden law is checked: magic dice + Eibon dice (in red)
            diceInput.value = castDice + eibonDice;
            diceInput.title = `${castDice} + ${eibonDice} (${game.i18n.localize('DX3rd.EibonDice')})`;
            diceInput.style.color = '#ff8a80';
        } else {
            // Eibon's forbidden law is unchecked: the plain magic dice
            diceInput.value = castDice;
            diceInput.title = game.i18n.localize('DX3rd.RollFieldOverrideHint');
            diceInput.style.color = '#f5f5f5';
        }
    }
    ,
    /**
     * Perform the casting roll
     * @param {Object} options
     *   - dialogDice: the final count settled in the dialog's magic-dice field (Eibon and user edits included)
     *   - castAdd: the magic modifier (user edits included)
     *   - eibonDice: the Eibon dice count, used to build the DS-removal options
     */
    async performCastingRoll(actor, item, options) {
        const { dialogDice, castAdd, castRollFormula = {}, eibonDice, difficulty, useEibon, useAngel, getTarget } = options;

        // cast_* dice formulas are rolled exactly once, here, when the casting-roll button is pressed.
        const rollFormulaBonus = async (kind) => {
            const formula = castRollFormula?.[kind];
            if (!formula) return { total: 0, text: '' };
            try {
                const result = await (new Roll(formula)).evaluate();
                return { total: Number(result.total) || 0, text: `${kind}: ${formula} → ${result.total}` };
            } catch (error) {
                console.warn(`DX3rd | casting formula failed (${kind}): ${formula}`, error);
                ui.notifications.warn(`${game.i18n.localize('DX3rd.DamageRollFormulaInvalid')}: ${formula}`);
                return { total: 0, text: `${kind}: ${formula} → 0` };
            }
        };
        const [formulaDice, formulaAdd] = await Promise.all([
            rollFormulaBonus('dice'), rollFormulaBonus('add')
        ]);

        // Dice count: dialogDice already includes the Eibon dice, so they are not added again here.
        // Only the cast_dice formula result is added now — a value the dialog could not have shown.
        // Zero or fewer is not a formula the ds dice term can build, so at least one die is rolled (guarding hand input).
        const totalDice = Math.max(1, dialogDice + formulaDice.total);

        // Build the DS-removal options
        let dsOptions = [];
        if (useEibon && eibonDice > 0) {
            dsOptions.push(eibonDice);
        }
        if (useAngel) {
            dsOptions.push('a');
        }

        // Build the roll formula
        let formula = `${totalDice}ds`;
        if (dsOptions.length > 0) {
            formula += `[${dsOptions.join(', ')}]`;
        }
        const totalAdd = castAdd + formulaAdd.total;
        if (totalAdd !== 0) {
            formula += totalAdd >= 0 ? `+${totalAdd}` : `${totalAdd}`;
        }

        // Roll the dice
        const roll = await (new Roll(formula)).roll();

        // Success / failure
        const difficultyNum = Number(difficulty) || 0;
        const isSuccess = roll.total >= difficultyNum;
        const resultText = isSuccess ? 
            game.i18n.localize('DX3rd.Success') : 
            game.i18n.localize('DX3rd.Failure');

        // Build the chat message
        const invokeStr = String(item.system?.invoke?.value ?? '').trim();
        const evocationStr = String(item.system?.evocation?.value ?? '').trim();
        const hasInvoke = invokeStr !== '' && invokeStr !== '-';
        const hasEvocation = evocationStr !== '' && evocationStr !== '-';
        
        let difficultyDisplay = difficulty;
        
        // With both set, bold the chosen invocation value
        if (hasInvoke && hasEvocation) {
            const selectedDifficulty = difficulty;
            if (selectedDifficulty === invokeStr) {
                difficultyDisplay = `<strong>${invokeStr}</strong>/${evocationStr}`;
            } else if (selectedDifficulty === evocationStr) {
                difficultyDisplay = `${invokeStr}/<strong>${evocationStr}</strong>`;
            }
        }
        
        // Render the roll result as HTML for the message
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

        // 3. Count the final overflow dice (10s) and create the disaster button
        let finalOverflowCount = 0;
        for (const term of roll.terms) {
            if (term.constructor.name === 'DS3rdDiceTerm' && term.overflowCount !== undefined) {
                finalOverflowCount = term.overflowCount;
                break;
            }
        }

        // Create the disaster button according to the overflow count
        if (finalOverflowCount >= 1) {
            await this._createDisasterButton(actor, item, finalOverflowCount);
        }

        // 4. On success — create only the invocation button (activation, macros and effects happen there)
        if (isSuccess) {
            // The casting roll succeeded, so create the invocation button
            await this._createInvokeButton(actor, item, getTarget);
        }
    },

    /**
     * Create a spell invocation button in chat
     * @param {Actor} actor
     * @param {Item} item
     * @param {boolean} getTarget - whether the getTarget box is checked
     */
    async _createInvokeButton(actor, item, getTarget) {
        const invokeLabel = game.i18n.localize('DX3rd.Invoking');
        
        // Settle getTarget (the argument wins; otherwise the item's own system value)
        const finalGetTarget = getTarget !== undefined ? getTarget : (item.system.getTarget || false);
        
        // Store the item information (effect data included)
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

        // Pick the disaster type from the overflow-dice count
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
        // Roll 1d10
        const roll = await new Roll("1d10").roll();
        const result = roll.total;

        // Fetch the text for this result
        const textKey = `DX3rd.SpellDisasterText${result}`;
        let resultText = game.i18n.localize(textKey);

        // Substitute {count} (only result 1 uses it)
        if (result === 1 && resultText.includes('{count}')) {
            // Result 1: count = 10 - body.total (minimum 1)
            const bodyTotal = actor.system?.attributes?.body?.total || 0;
            const count = Math.max(1, 10 - bodyTotal);
            resultText = resultText.replace('{count}', count);
        }

        // Render the roll result as HTML for the message
        const rollHTML = await roll.render();
        const rollMessage = `<div class="dice-roll">${rollHTML}</div>`;

        // Build the chat message
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

        // Apply the effects tied to specific results
        if (result === 3) {
            // 3: initiative -2
            await this.createSpellTableEffect(actor, 'disaster', 3, {
                init: -2
            });
        } else if (result === 4) {
            // 4: roll this table once more. The result applies to one of your Lois (the GM decides).
            await this.handleSpellDisaster4(actor, item);
        } else if (result === 8) {
            // 8: magic dice -1
            await this.createSpellTableEffect(actor, 'disaster', 8, {
                cast_dice: -1
            });
        } else if (result === 9) {
            // 9: apply the berserk status
            await actor.toggleStatusEffect("berserk", { active: true });
        } else if (result === 10) {
            // 10: roll SpellCalamity
            await this.rollSpellCalamity(actor, item);
        }

        // Run the macros
        await executeMacrosByPrefix(`spell-disaster-${result}-macro`);
    },

    /**
     * Create the applied effect for a spell-table result. An effect of the same name is not applied twice.
     * @param {Actor} actor
     * @param {'disaster'|'calamity'|'catastrophe'} kind - which table (see SPELL_TABLES)
     * @param {number} resultNumber - the table result number
     * @param {Object} attributes - the effect attributes (e.g. {init: -2})
     */
    async createSpellTableEffect(actor, kind, resultNumber, attributes) {
        const table = SPELL_TABLES[kind];
        if (!table) throw new Error(`DX3rd | Unknown spell table kind: ${kind}`);

        try {
            const effectName = `${game.i18n.localize(table.i18n)}(${resultNumber})`;

            // Duplicate check: is an effect of the same name already present?
            const appliedEffects = window.DX3rdAppliedEffects?.collect
                ? window.DX3rdAppliedEffects.collect(actor)
                : (actor.system?.attributes?.applied || {});

            const alreadyExists = Object.values(appliedEffects)
                .some(appliedEffect => appliedEffect && appliedEffect.name === effectName);

            if (alreadyExists) {
                ui.notifications.info(`${effectName} 효과가 이미 적용되어 있습니다.`);
                return;
            }

            // Store it as a native ActiveEffect
            await window.DX3rdAppliedEffects.set(actor, `${table.keyPrefix}_${resultNumber}_${Date.now()}`, {
                name: effectName,
                source: actor.name,
                disable: table.disable,
                img: 'icons/svg/aura.svg',
                attributes: attributes
            });

            ui.notifications.info(`${effectName} 효과가 적용되었습니다.`);

        } catch (error) {
            console.error(`DX3rd | Error in createSpellTableEffect(${kind}):`, error);
            throw error;
        }
    },

    /**
     * Create the record item for a spell-table result and raise the base encroachment.
     * @param {Actor} actor
     * @param {'disaster'|'calamity'|'catastrophe'} kind - which table (see SPELL_TABLES)
     * @param {number} resultNumber - the table result number
     * @param {number} encroachmentValue - how much base encroachment to add
     * @param {string} [description] - description text; the table's default wording when omitted.
     */
    async createSpellTableRecord(actor, kind, resultNumber, encroachmentValue = 1, description = null) {
        const table = SPELL_TABLES[kind];
        if (!table) throw new Error(`DX3rd | Unknown spell table kind: ${kind}`);

        try {
            const label = game.i18n.localize(table.i18n);

            await actor.createEmbeddedDocuments('Item', [{
                name: label,
                type: 'record',
                system: {
                    description: description || game.i18n.localize(`${table.i18n}Text${resultNumber}`),
                    exp: 0,
                    encroachment: encroachmentValue
                }
            }]);

            ui.notifications.info(`${label} 레코드가 추가되었고, 기본침식률이 ${encroachmentValue} 증가했습니다.`);

        } catch (error) {
            console.error(`DX3rd | Error in createSpellTableRecord(${kind}):`, error);
            throw error;
        }
    },

    /**
     * Roll spell calamity table (1d10)
     * @param {Actor} actor
     * @param {Item} item
     */
    async rollSpellCalamity(actor, item) {
        // Roll 1d10
        const roll = await new Roll("1d10").roll();
        const result = roll.total;

        // Fetch the text for this result
        const textKey = `DX3rd.SpellCalamityText${result}`;
        let resultText = game.i18n.localize(textKey);

        // Results 5 and 9 settle count with a 1d10 first
        let countValue = null;
        let countRollObj = null;
        if ((result === 5 || result === 9) && resultText.includes('{count}')) {
            countRollObj = await new Roll("1d10").roll();
            countValue = countRollObj.total;
            
            // Result 9 words the message differently depending on simplifiedDistance
            if (result === 9) {
                const simplifiedDistance = game.settings.get('dx3rd-emanim', 'simplifiedDistance');
                // {count}점 always uses countValue
                resultText = resultText.replace('{count}점', `${countValue}점`);
                // {count}m depends on simplifiedDistance
                if (simplifiedDistance) {
                    const displayCount = Math.floor(countValue / 2);
                    resultText = resultText.replace('{count}m', `${displayCount}칸`);
                } else {
                    resultText = resultText.replace('{count}m', `${countValue}m`);
                }
            } else {
                resultText = resultText.replace(/{count}/g, countValue); // a regex instead of replaceAll
            }
        } else if (resultText.includes('{count}')) {
            // Every other result uses 1d6
            const countRoll = await new Roll("1d6").roll();
            resultText = resultText.replace('{count}', countRoll.total);
        }

        // Result 7 settles damage with a 2d10 first
        let damageValue = null;
        let damageRollObj = null;
        if (result === 7 && resultText.includes('{damage}')) {
            damageRollObj = await new Roll("2d10").roll();
            damageValue = damageRollObj.total;
            resultText = resultText.replace('{damage}', damageValue);
        } else if (resultText.includes('{damage}')) {
            // Every other result uses 1d6
            const damageRoll = await new Roll("1d6").roll();
            resultText = resultText.replace('{damage}', damageRoll.total);
        }

        // Render the roll result as HTML for the message
        const rollHTML = await roll.render();
        const rollMessage = `<div class="dice-roll">${rollHTML}</div>`;

        // Build the chat message
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

        // Apply the effects tied to specific results
        if (result === 1) {
            // 1: movement halved
            await this.createSpellTableEffect(actor, 'calamity', 1, {
                move_half: true
            });
        } else if (result === 4) {
            // 4: base encroachment permanently +1 (creates a record item)
            await this.createSpellTableRecord(actor, 'calamity', 4);
        } else if (result === 5) {
            // 5: your tongue ties up (magic unusable for count rounds)
            // countValue was already settled with a 1d10 above
            if (countValue === null) {
                // Roll again should countValue somehow be missing
                const countRoll = await new Roll("1d10").roll();
                countValue = countRoll.total;
            }
            await this.createSpellTableEffect(actor, 'calamity', 5, {
                spell_disabled: true,
                spell_disabled_count: countValue
            });
        } else if (result === 7) {
            // 7: 2d10 HP damage (ignoring armor)
            // damageValue and damageRollObj were already settled with a 2d10 above
            if (damageValue === null || damageRollObj === null) {
                // Roll again should the values somehow be missing
                damageRollObj = await new Roll("2d10").roll();
                damageValue = damageRollObj.total;
            }
            await this.applySpellCalamityDamage(actor, 7, damageValue, damageRollObj);
        } else if (result === 8) {
            // 8: roll this table once more. The result applies to one of your Lois (the GM decides).
            await this.handleSpellCalamity8(actor, item);
        } else if (result === 9) {
            // 9: count highlights plus count HP damage
            // countValue and countRollObj were already settled with a 1d10 above
            if (countValue === null || countRollObj === null) {
                // Roll again should the values somehow be missing
                countRollObj = await new Roll("1d10").roll();
                countValue = countRollObj.total;
            }
            await this.applySpellCalamityHighlightAndDamage(actor, 9, countValue, countRollObj);
        } else if (result === 10) {
            // 10: roll SpellCatastrophe
            await this.rollSpellCatastrophe(actor, item);
        }

        // Run the macros
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
            // Render the roll result as HTML for the message
            const rollHTML = await roll.render();
            const rollMessage = `<div class="dice-roll">${rollHTML}</div>`;

            // Build the chat message
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

            // Apply the effects tied to specific results
            if (result === 1) {
                // 1: movement halved
                await this.createSpellTableEffect(actor, 'calamity', 1, {
                    move_half: true
                });
            } else if (result === 4) {
                // 4: base encroachment permanently +1 (creates a record item)
                await this.createSpellTableRecord(actor, 'calamity', 4);
            } else if (result === 5) {
                // 5: your tongue ties up (magic unusable for count rounds)
                if (countValue === null) {
                    if (countRollObj) {
                        countValue = countRollObj.total;
                    } else {
                        const countRoll = await new Roll("1d10").roll();
                        countValue = countRoll.total;
                    }
                }
                await this.createSpellTableEffect(actor, 'calamity', 5, {
                    spell_disabled: true,
                    spell_disabled_count: countValue
                });
            } else if (result === 7) {
                // 7: 2d10 HP damage (ignoring armor)
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
                // 8: roll this table once more. The result applies to one of your Lois (the GM decides).
                await this.handleSpellCalamity8(actor, item);
            } else if (result === 9) {
                // 9: count highlights plus count HP damage
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
                // 10: roll SpellCatastrophe
                await this.rollSpellCatastrophe(actor, item);
            }

            // Run the macros
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
        // Roll 1d10
        const roll = await new Roll("1d10").roll();
        const result = roll.total;

        // Fetch the text for this result
        const textKey = `DX3rd.SpellCatastropheText${result}`;
        let resultText = game.i18n.localize(textKey);

        // Substitute {count} (result 2: 1d10)
        let countValue = null;
        if (result === 2 && resultText.includes('{count}')) {
            const countRoll = await new Roll("1d10").roll();
            countValue = countRoll.total;
            resultText = resultText.replace('{count}', countValue);
        }

        // Substitute {damage} (result 7)
        // Note: the real damage is 5d10, rolled by executeSpellCatastrophe7 and applied per target in its own message.
        //   Rolling a 1d6 here to display would be a phantom number unrelated to what is applied, so the actual
        //   formula "5d10" is printed instead (the concrete total belongs to the damage message that follows).
        if (result === 7 && resultText.includes('{damage}')) {
            resultText = resultText.replace('{damage}', '5d10');
        }

        // Render the roll result as HTML for the message
        const rollHTML = await roll.render();
        const rollMessage = `<div class="dice-roll">${rollHTML}</div>`;

        // Build the chat message
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

        // Apply the effects tied to specific results
        if (result === 2) {
            // 2: base encroachment permanently +count (creates a record item)
            // countValue was already settled with a 1d10 above
            if (countValue === null) {
                // Roll again should countValue somehow be missing
                const countRoll = await new Roll("1d10").roll();
                countValue = countRoll.total;
            }
            await this.createSpellTableRecord(actor, 'catastrophe', 2, countValue, resultText);
        } else if (result === 3) {
            // 3: magic unusable for the rest of the scenario
            await this.createSpellTableEffect(actor, 'catastrophe', 3, {
                spell_disabled: true
            });
        } else if (result === 5) {
            // 5: turn one Lois into a Titus
            await this.handleSpellCatastrophe5(actor);
        } else if (result === 7) {
            // 7: explosion — 5d10 damage (self plus every character in an adjacent grid)
            await this.handleSpellCatastrophe7(actor);
        } else if (result === 8) {
            // 8: roll the magic-overflow table. The result applies to you and everyone in your engagement.
            await this.handleSpellCatastrophe8(actor, item);
        } else if (result === 9) {
            // 9: roll this table once more. The result applies to one of your Lois (the GM decides).
            await this.handleSpellCatastrophe9(actor, item);
        } else if (result === 10) {
            // 10: the character is removed from the game forever (a Titus can negate it).
            // Irreversible, so no automatic state change — only a warning. The GM handles removal / Titus spending by hand.
            ui.notifications.warn(`${actor.name}: ${game.i18n.localize('DX3rd.SpellCatastropheText10')}`);
        }

        // Run the macros
        await executeMacrosByPrefix(`spell-catastrophe-${result}-macro`);
    },

    /**
     * Handle SpellCatastrophe 5: turn one Lois into a Titus
     * @param {Actor} actor
     */
    async handleSpellCatastrophe5(actor) {
        try {
            // Keep only Lois items whose Titus box is unchecked.
            // system.type "M", "D" and "E" are excluded; only "S" and "-" remain.
            // Only items whose system.titus is not true are kept.
            const availableRois = actor.items.filter(item => {
                if (item.type !== 'rois') return false;
                
                const roisType = item.system?.type;
                // Exclude "M", "D" and "E"
                if (roisType === 'M' || roisType === 'D' || roisType === 'E') return false;
                
                // Keep only "S", "-" or undefined
                // Keep only items whose system.titus is not true
                const titus = item.system?.titus;
                const isTitusChecked = titus === true || titus === "true" || titus === 1 || titus === "1";
                
                return !isTitusChecked;
            });

            // Report when there is no Lois left to turn into a Titus
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

            // Build the dropdown options
            const options = availableRois.map(rois => 
                `<option value="${window.DX3rdRuntimeUtils.escapeHTML(rois.id)}">${window.DX3rdRuntimeUtils.escapeHTML(rois.name)}</option>`
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

            // Check the Titus box
            await selectedRois.update({
                'system.titus': true
            });

            // Emit the chat message
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
            // A non-GM sends the request to the GM over the socket
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

                // Send it to the GM over the socket
                window.DX3rdSocketRouter.emit({
                    type: 'spellRoisSelectRequest',
                    requestData: {
                        actorId: actor.id,
                        textKey: textKey,
                        title: title,
                        requestType: requestType,
                        itemId: item?.id || null,
                        availableRois: availableRois.map(rois => ({ id: rois.id }))
                    }
                });

                ui.notifications.info('GM에게 로이스 선택 요청을 보냈습니다.');
                return null; // handled asynchronously, so null is returned
            }

            // The GM shows the dialog directly
            // Filter the Lois items
            // Exclude system.type "M", "D" and "E"
            // Exclude items whose system.sublimation is checked
            const availableRois = actor.items.filter(item => {
                if (item.type !== 'rois') return false;
                
                const roisType = item.system?.type;
                // Exclude "M", "D" and "E"
                if (roisType === 'M' || roisType === 'D' || roisType === 'E') return false;
                
                // Exclude items whose system.sublimation is checked
                const sublimation = item.system?.sublimation;
                const isSublimationChecked = sublimation === true || sublimation === "true" || sublimation === 1 || sublimation === "1";
                
                return !isSublimationChecked;
            });

            if (availableRois.length === 0) {
                ui.notifications.warn('적용할 수 있는 로이스가 없습니다.');
                return null;
            }

            // Build the dropdown options
            const options = availableRois.map(rois => 
                `<option value="${window.DX3rdRuntimeUtils.escapeHTML(rois.id)}">${window.DX3rdRuntimeUtils.escapeHTML(rois.name)}</option>`
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
        // Look through every actor for one with this name
        const matchingActor = game.actors.find(actor => actor.name === roisName);
        return matchingActor || null;
    },

    /**
     * Handle SpellDisaster 4: roll this table once more. The result applies to one of your Lois (the GM decides).
     * @param {Actor} actor
     * @param {Item} item
     */
    async handleSpellDisaster4(actor, item) {
        try {
            // Choose the Lois
            const selectedRois = await this.selectRoisForSpellEffect(
                actor,
                'DX3rd.SpellDisasterText4',
                game.i18n.localize('DX3rd.SpellDisaster'),
                'spellDisaster4',
                item
            );

            if (!selectedRois) {
                return; // cancelled, or a non-GM sent it over the socket
            }

            // Find the actor whose name matches the chosen Lois
            const targetActor = this.findActorByRoisName(selectedRois.name);
            if (!targetActor) {
                ui.notifications.error(`"${selectedRois.name}"와 같은 이름을 가진 액터를 찾을 수 없습니다.`);
                return;
            }

            // Roll SpellDisaster again (on the target actor)
            await this.rollSpellDisaster(targetActor, item);
        } catch (error) {
            console.error("DX3rd | Error in handleSpellDisaster4:", error);
            ui.notifications.error("SpellDisaster 4 처리 중 오류가 발생했습니다.");
        }
    },

    /**
     * Handle SpellCalamity 8: roll this table once more. The result applies to one of your Lois (the GM decides).
     * @param {Actor} actor
     * @param {Item} item
     */
    async handleSpellCalamity8(actor, item) {
        try {
            // Choose the Lois
            const selectedRois = await this.selectRoisForSpellEffect(
                actor,
                'DX3rd.SpellCalamityText8',
                game.i18n.localize('DX3rd.SpellCalamity'),
                'spellCalamity8',
                item
            );

            if (!selectedRois) {
                return; // cancelled, or a non-GM sent it over the socket
            }

            // Find the actor whose name matches the chosen Lois
            const targetActor = this.findActorByRoisName(selectedRois.name);
            if (!targetActor) {
                ui.notifications.error(`"${selectedRois.name}"와 같은 이름을 가진 액터를 찾을 수 없습니다.`);
                return;
            }

            // Roll SpellCalamity again (on the target actor)
            await this.rollSpellCalamity(targetActor, item);
        } catch (error) {
            console.error("DX3rd | Error in handleSpellCalamity8:", error);
            ui.notifications.error("SpellCalamity 8 처리 중 오류가 발생했습니다.");
        }
    },

    /**
     * Handle SpellCatastrophe 9: roll this table once more. The result applies to one of your Lois (the GM decides).
     * @param {Actor} actor
     * @param {Item} item
     */
    async handleSpellCatastrophe9(actor, item) {
        try {
            // Choose the Lois
            const selectedRois = await this.selectRoisForSpellEffect(
                actor,
                'DX3rd.SpellCatastropheText9',
                game.i18n.localize('DX3rd.SpellCatastrophe'),
                'spellCatastrophe9',
                item
            );

            if (!selectedRois) {
                return; // cancelled, or a non-GM sent it over the socket
            }

            // Find the actor whose name matches the chosen Lois
            const targetActor = this.findActorByRoisName(selectedRois.name);
            if (!targetActor) {
                ui.notifications.error(`"${selectedRois.name}"와 같은 이름을 가진 액터를 찾을 수 없습니다.`);
                return;
            }

            // Roll SpellCatastrophe again (on the target actor)
            await this.rollSpellCatastrophe(targetActor, item);
        } catch (error) {
            console.error("DX3rd | Error in handleSpellCatastrophe9:", error);
            ui.notifications.error("SpellCatastrophe 9 처리 중 오류가 발생했습니다.");
        }
    },

    /**
     * Handle SpellCatastrophe 8: roll the magic-overflow table. The result applies to you and everyone in your engagement.
     * A non-GM sends it over the socket; the GM handles it directly.
     * @param {Actor} actor
     * @param {Item} item
     */
    async handleSpellCatastrophe8(actor, item) {
        try {
            // A non-GM sends it over the socket
            if (!game.user.isGM) {
                window.DX3rdSocketRouter.emit({
                    type: 'spellCatastrophe8Request',
                    requestData: {
                        actorId: actor.id,
                        itemId: item?.id || null
                    }
                });
                ui.notifications.info('GM에게 SpellCatastrophe 8 처리 요청을 보냈습니다.');
                return;
            }

            // The GM handles it directly
            await this.executeSpellCatastrophe8(actor, item);
        } catch (error) {
            console.error("DX3rd | Error in handleSpellCatastrophe8:", error);
            ui.notifications.error("SpellCatastrophe 8 처리 중 오류가 발생했습니다.");
        }
    },

    /**
     * Execute SpellCatastrophe 8: roll the magic-overflow table. The result applies to you and everyone in your engagement.
     * @param {Actor} actor
     * @param {Item} item
     */
    async executeSpellCatastrophe8(actor, item) {
        try {
            // Collect the target actors (self plus other token actors in adjacent grids)
            const targetActors = [];
            
            // Add self
            targetActors.push(actor);
            
            // Find this actor's token
            const actorToken = actor.getActiveTokens()[0] || canvas.tokens.placeables.find(t => t.actor?.id === actor.id);
            if (actorToken) {
                // Find the adjacent grids
                const handler = window.DX3rdUniversalHandler;
                if (handler && handler.getAdjacentGrids) {
                    const adjacentGrids = handler.getAdjacentGrids(actorToken);
                    
                    // Find the tokens standing in each adjacent grid
                    for (const gridPos of adjacentGrids) {
                        // gridPos is an { x, y } pixel coordinate
                        // Find the tokens at that position
                        const tokensAtGrid = canvas.tokens.placeables.filter(t => {
                            if (!t.actor || t.actor.type !== 'character') return false;
                            if (t.actor.id === actor.id) return false; // self is already added
                            
                            // The token's center point
                            const tokenCenter = t.center;
                            
                            // Convert to grid coordinates and measure the distance
                            const tokenGrid = canvas.grid.getOffset({ x: tokenCenter.x, y: tokenCenter.y });
                            const targetGrid = canvas.grid.getOffset({ x: gridPos.x, y: gridPos.y });
                            
                            const dx = tokenGrid.i - targetGrid.i;
                            const dy = tokenGrid.j - targetGrid.j;
                            const distance = Math.sqrt(dx * dx + dy * dy);
                            
                            // A distance of 0.5 or less counts as the same grid
                            return distance <= 0.5;
                        });
                        
                        // Add them, skipping duplicates
                        for (const token of tokensAtGrid) {
                            if (token.actor && !targetActors.find(a => a.id === token.actor.id)) {
                                targetActors.push(token.actor);
                            }
                        }
                    }
                }
            }

            // Roll SpellCalamity exactly once
            const roll = await new Roll("1d10").roll();
            const result = roll.total;

            // Fetch the text for this result
            const textKey = `DX3rd.SpellCalamityText${result}`;
            let resultText = game.i18n.localize(textKey);

            // Results 5 and 9 settle count with a 1d10 first
            let countValue = null;
            let countRollObj = null;
            if ((result === 5 || result === 9) && resultText.includes('{count}')) {
                countRollObj = await new Roll("1d10").roll();
                countValue = countRollObj.total;
                
                // Result 9 words the message differently depending on simplifiedDistance
                if (result === 9) {
                    const simplifiedDistance = game.settings.get('dx3rd-emanim', 'simplifiedDistance');
                    // {count}점 always uses countValue
                    resultText = resultText.replace('{count}점', `${countValue}점`);
                    // {count}m depends on simplifiedDistance
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
                // Every other result uses 1d6
                const countRoll = await new Roll("1d6").roll();
                resultText = resultText.replace('{count}', countRoll.total);
            }

            // Result 7 settles damage with a 2d10 first
            let damageValue = null;
            let damageRollObj = null;
            if (result === 7 && resultText.includes('{damage}')) {
                damageRollObj = await new Roll("2d10").roll();
                damageValue = damageRollObj.total;
                resultText = resultText.replace('{damage}', damageValue);
            } else if (resultText.includes('{damage}')) {
                // Every other result uses 1d6
                const damageRoll = await new Roll("1d6").roll();
                resultText = resultText.replace('{damage}', damageRoll.total);
            }

            // Apply the one SpellCalamity result to every target actor
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
     * Handle SpellCatastrophe 7: explosion — 5d10 damage (self plus every character in an adjacent grid)
     * A non-GM sends it over the socket; the GM handles it directly.
     * @param {Actor} actor
     */
    async handleSpellCatastrophe7(actor) {
        try {
            // A non-GM sends it over the socket
            if (!game.user.isGM) {
                window.DX3rdSocketRouter.emit({
                    type: 'spellCatastrophe7Request',
                    requestData: {
                        actorId: actor.id
                    }
                });
                ui.notifications.info('GM에게 SpellCatastrophe 7 처리 요청을 보냈습니다.');
                return;
            }

            // The GM handles it directly
            await this.executeSpellCatastrophe7(actor);
        } catch (error) {
            console.error("DX3rd | Error in handleSpellCatastrophe7:", error);
            ui.notifications.error("SpellCatastrophe 7 처리 중 오류가 발생했습니다.");
        }
    },

    /**
     * Execute SpellCatastrophe 7: explosion — 5d10 damage (self plus every character in an adjacent grid)
     * @param {Actor} actor
     */
    async executeSpellCatastrophe7(actor) {
        try {
            // Roll the 5d10 damage
            const damageRoll = await new Roll("5d10").roll();
            const damageAmount = damageRoll.total;

            // Render the roll result as HTML
            const rollHTML = await damageRoll.render();
            const rollMessage = `<div class="dice-roll">${rollHTML}</div>`;

            // Collect the target tokens (self plus every character in an adjacent grid)
            const targetActors = [];
            
            // Find this actor's token
            const actorToken = actor.getActiveTokens()[0] || canvas.tokens.placeables.find(t => t.actor?.id === actor.id);
            if (actorToken) {
                // With a token present, adjacent characters are included too
                targetActors.push(actor);
                
                // Find the adjacent grids
                const handler = window.DX3rdUniversalHandler;
                if (handler && handler.getAdjacentGrids) {
                    const adjacentGrids = handler.getAdjacentGrids(actorToken);
                    
                    // Find the tokens standing in each adjacent grid
                    for (const gridPos of adjacentGrids) {
                        // gridPos is an { x, y } pixel coordinate
                        // Find the tokens at that position
                        const tokensAtGrid = canvas.tokens.placeables.filter(t => {
                            if (!t.actor || t.actor.type !== 'character') return false;
                            if (t.actor.id === actor.id) return false; // self is already added
                            
                            // The token's center point
                            const tokenCenter = t.center;
                            
                            // Convert to grid coordinates and measure the distance
                            const tokenGrid = canvas.grid.getOffset({ x: tokenCenter.x, y: tokenCenter.y });
                            const targetGrid = canvas.grid.getOffset({ x: gridPos.x, y: gridPos.y });
                            
                            const dx = tokenGrid.i - targetGrid.i;
                            const dy = tokenGrid.j - targetGrid.j;
                            const distance = Math.sqrt(dx * dx + dy * dy);
                            
                            // A distance of 0.5 or less counts as the same grid
                            return distance <= 0.5;
                        });
                        
                        // Add them, skipping duplicates
                        for (const token of tokensAtGrid) {
                            if (token.actor && !targetActors.find(a => a.id === token.actor.id)) {
                                targetActors.push(token.actor);
                            }
                        }
                    }
                }
            } else {
                // With no token, only this actor takes damage
                targetActors.push(actor);
            }

            // Apply the damage to each target
            const damageMessages = [];
            for (const targetActor of targetActors) {
                if (!targetActor) continue;

                // Read the current HP and reduce value
                const currentHP = targetActor.system?.attributes?.hp?.value || 0;
                const reduce = targetActor.system?.attributes?.reduce?.value || 0;

                // Actual damage = rolled damage - reduction (armor is ignored; only reduce counts)
                const actualDamage = Math.max(0, damageAmount - reduce);

                // Write the HP
                const newHP = Math.max(0, currentHP - actualDamage);
                const actualHpLoss = currentHP - newHP;
                await targetActor.update({ 'system.attributes.hp.value': newHP });

                // Build the damage message
                const damageText = `${targetActor.name}: HP ${actualHpLoss} 데미지 (${game.i18n.localize('DX3rd.SpellCatastrophe')})`;
                damageMessages.push(damageText);
            }

            // Emit the merged damage message
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
            // Roll 2d10 when no damageAmount / damageRoll was passed in
            if (damageAmount === null || damageRoll === null) {
                damageRoll = await new Roll("2d10").roll();
                damageAmount = damageRoll.total;
            }
            
            // Render the roll result as HTML
            const rollHTML = await damageRoll.render();
            const rollMessage = `<div class="dice-roll">${rollHTML}</div>`;
            
            // Read the current HP and reduce value
            const currentHP = actor.system?.attributes?.hp?.value || 0;
            const reduce = actor.system?.attributes?.reduce?.value || 0;
            
            // Actual damage = rolled damage - reduction (armor is ignored; only reduce counts)
            const actualDamage = Math.max(0, damageAmount - reduce);
            
            // Write the HP
            const newHP = Math.max(0, currentHP - actualDamage);
            const actualHpLoss = currentHP - newHP;  // the HP actually lost
            await actor.update({ 'system.attributes.hp.value': newHP });
            
            // Emit the damage message (as an extension would)
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
            
            // Highlight radius in grid squares (minimum 1)
            const highlightRange = simplifiedDistance ? Math.max(1, Math.floor(count / 2)) : count;
            
            // Draw the highlight straight onto the canvas — it does not follow the token
            const tokens = actor.getActiveTokens();
            if (tokens.length > 0 && highlightRange > 0) {
                const token = tokens[0];
                const handler = window.DX3rdUniversalHandler;
                
                if (handler) {
                    // Freeze the token's current position (the highlight is pinned there)
                    const tokenPosition = {
                        x: token.document.x,
                        y: token.document.y,
                        width: token.document.width,
                        height: token.document.height
                    };
                    
                    // Read the user color
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
                    
                    // Store the highlight data (used to detect token movement)
                    const highlightData = {
                        actorId: actor.id,
                        tokenId: token.id,
                        range: highlightRange,
                        userColor: userColorValue,
                        position: tokenPosition,
                        timestamp: Date.now()
                    };
                    
                    // Store the SpellCalamity highlight data (used to detect token movement)
                    if (!window.DX3rdSpellCalamityHighlightData) {
                        window.DX3rdSpellCalamityHighlightData = [];
                    }
                    window.DX3rdSpellCalamityHighlightData.push(highlightData);
                    
                    // Draw the highlight (straight onto the canvas, at the stored position)
                    await this.drawSpellCalamityHighlight(token, highlightRange, userColorValue, tokenPosition);
                    
                    // Send it to the other clients over the socket
                    window.DX3rdSocketRouter.emit({
                        type: 'setSpellCalamityHighlight',
                        data: highlightData
                    });
                    
                    // Register the token-move hook (once)
                    if (!window.DX3rdSpellCalamityTokenMoveHook) {
                        window.DX3rdSpellCalamityTokenMoveHook = Hooks.on('updateToken', async (tokenDoc, updateData, options, userId) => {
                            if (window.DX3rdSpellHandler && window.DX3rdSpellHandler.handleTokenMoveForSpellCalamity) {
                                await window.DX3rdSpellHandler.handleTokenMoveForSpellCalamity(tokenDoc, updateData);
                            }
                        });
                    }
                }
            }
            
            // Apply the HP damage (equal to count)
            const currentHP = actor.system?.attributes?.hp?.value || 0;
            const reduce = actor.system?.attributes?.reduce?.value || 0;
            
            // Actual damage = count - reduction (armor is ignored; only reduce counts)
            const actualDamage = Math.max(0, count - reduce);
            
            // Write the HP
            const newHP = Math.max(0, currentHP - actualDamage);
            const actualHpLoss = currentHP - newHP;  // the HP actually lost
            await actor.update({ 'system.attributes.hp.value': newHP });
            
            // Emit the damage message (with the roll result)
            let damageText = `HP ${actualHpLoss} 데미지 (${game.i18n.localize('DX3rd.SpellCalamity')})`;
            let rollMessage = '';
            
            if (countRoll) {
                // Render the roll result as HTML
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
            
            // Initialize the Graphics array
            if (!window.DX3rdSpellCalamityHighlights) {
                window.DX3rdSpellCalamityHighlights = [];
            }
            
            // Remove the previous Graphics objects
            for (const graphics of window.DX3rdSpellCalamityHighlights) {
                if (graphics && graphics.parent) {
                    graphics.parent.removeChild(graphics);
                    graphics.destroy();
                }
            }
            window.DX3rdSpellCalamityHighlights = [];
            
            // Use the stored position, so the highlight does not follow the token
            const usePosition = position || {
                x: token.document.x,
                y: token.document.y,
                width: token.document.width,
                height: token.document.height
            };
            
            // Convert the position to grid coordinates (the same way as elsewhere in the system).
            // getSnappedPosition has to be called on the doc, so the grid offset is computed directly.
            const baseOff = canvas.grid.getOffset({ x: usePosition.x, y: usePosition.y });
            
            // The grids the token occupies
            const tokenWidth = usePosition.width || 1;
            const tokenHeight = usePosition.height || 1;
            const occupied = [];
            for (let i = 0; i < tokenWidth; i++) {
                for (let j = 0; j < tokenHeight; j++) {
                    occupied.push({ i: baseOff.i + i, j: baseOff.j + j });
                }
            }
            
            // The grids within range (the same way as elsewhere in the system)
            const minI = Math.min(...occupied.map(c => c.i));
            const maxI = Math.max(...occupied.map(c => c.i));
            const minJ = Math.min(...occupied.map(c => c.j));
            const maxJ = Math.max(...occupied.map(c => c.j));
            
            const key = (i, j) => `${i},${j}`;
            const occSet = new Set(occupied.map(c => key(c.i, c.j)));
            
            // Build the candidate grids
            const candidates = [];
            for (let i = minI - range; i <= maxI + range; i++) {
                for (let j = minJ - range; j <= maxJ + range; j++) {
                    if (occSet.has(key(i, j))) continue; // skip occupied squares
                    candidates.push({ i, j });
                }
            }
            
            // Distance (the same as elsewhere in the system: measurePath)
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
            
            // Dedupe and sort
            const result = [...new Map(within.map(c => [key(c.i, c.j), c])).values()]
                .sort((a, b) => a.j - b.j || a.i - b.i);
            
            // The token's center point (from the stored position)
            const tokenCenterX = usePosition.x + (usePosition.width * canvas.grid.size) / 2;
            const tokenCenterY = usePosition.y + (usePosition.height * canvas.grid.size) / 2;
            const tokenCenter = { x: tokenCenterX, y: tokenCenterY };
            
            // Pick the final grids after a wall-collision check
            const grids = [];
            for (const { i, j } of result) {
                const centerPoint = centerOf({ i, j });
                
                // Wall collision: from the token's center to the grid's center
                const hasWall = handler.checkWallCollision 
                    ? handler.checkWallCollision(tokenCenter, centerPoint)
                    : false;
                
                if (!hasWall) {
                    grids.push({ x: centerPoint.x, y: centerPoint.y });
                }
            }
            
            // Draw the highlight (the same way as elsewhere in the system)
            const gridSize = canvas.grid.size;
            const color = userColor || 0x00FF00; // default color: green
            const gridType = canvas.grid.type;
            
            for (const grid of grids) {
                const graphics = new PIXI.Graphics();
                
                // Like the rest of the system, beginFill only (no lineStyle)
                graphics.beginFill(color, 0.2);
                
                if (gridType === CONST.GRID_TYPES.SQUARE || gridType === CONST.GRID_TYPES.GRIDLESS) {
                    // A square grid: a rectangle (centered, inset by 1px)
                    const centerX = grid.x; // already the center point
                    const centerY = grid.y; // already the center point
                    const halfSize = (gridSize / 2) - 1; // inset by 1px
                    graphics.drawRect(centerX - halfSize, centerY - halfSize, gridSize - 2, gridSize - 2);
                } else if (gridType === CONST.GRID_TYPES.HEXODDR || 
                          gridType === CONST.GRID_TYPES.HEXEVENR ||
                          gridType === CONST.GRID_TYPES.HEXODDQ ||
                          gridType === CONST.GRID_TYPES.HEXEVENQ) {
                    // A hex grid: highlight the actual hexagon shape
                    if (handler && handler.drawHexHighlight) {
                        handler.drawHexHighlight(graphics, grid.x, grid.y, gridSize);
                    } else {
                        // fallback: a circle instead
                        graphics.drawCircle(grid.x, grid.y, gridSize / 2 - 1);
                    }
                }
                
                graphics.endFill();
                
                // Add it to the canvas grid layer
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
            // Did the position actually change?
            if (!updateData.x && !updateData.y) return;
            
            // Is there any SpellCalamity highlight data?
            if (!window.DX3rdSpellCalamityHighlightData) return;
            
            const highlights = window.DX3rdSpellCalamityHighlightData;
            const index = highlights.findIndex(h => h.tokenId === tokenDoc.id);
            
            if (index !== -1) {
                // Remove the highlight
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
            // Remove the highlights from the Graphics array
            if (window.DX3rdSpellCalamityHighlights && Array.isArray(window.DX3rdSpellCalamityHighlights)) {
                // The highlight data and the Graphics objects are managed separately;
                // here every Graphics object is removed.
                for (const graphics of window.DX3rdSpellCalamityHighlights) {
                    if (graphics && graphics.parent) {
                        graphics.parent.removeChild(graphics);
                        graphics.destroy();
                    }
                }
                window.DX3rdSpellCalamityHighlights = [];
            }
            
            // Drop the highlight data too
            if (window.DX3rdSpellCalamityHighlightData) {
                if (tokenId) {
                    window.DX3rdSpellCalamityHighlightData = window.DX3rdSpellCalamityHighlightData.filter(
                        h => h.tokenId !== tokenId
                    );
                } else {
                    window.DX3rdSpellCalamityHighlightData = [];
                }
            }
            
            // Send it to the other clients over the socket
            if (tokenId) {
                window.DX3rdSocketRouter.emit({
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
