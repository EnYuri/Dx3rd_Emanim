/**
 * Double Cross 3rd - the scene control toolbar
 * Split out of main.js. It adds the appearance / impulse / fear roll tools to the left scene controls and owns
 * their selection dialog and roll procedures.
 */

/**
 * Apply the encroachment rise from appearing in a scene and print the result to chat.
 * With the `entryEncroachment` setting on it is a fixed +1; with it off, a 1d10 roll.
 * Shared by the scene control's appearance tool and the scene opening dialog.
 * @param {Actor} character
 */
async function dx3rdApplyEntryEncroachment(character) {
    const speaker = window.DX3rdRuntimeUtils.getActorOnlySpeaker(character);
    const useFixedValue = game.settings.get('dx3rd-emanim', 'entryEncroachment');

    // When it is not a fixed value, roll 1d10 to decide the rise.
    let roll = null;
    let increase = 1;
    if (!useFixedValue) {
        roll = new Roll('1d10');
        await roll.evaluate();
        increase = roll.total;
    }

    const currentEncroachment = Number(character.system.attributes.encroachment.value) || 0;
    const newEncroachment = currentEncroachment + increase;
    await character.update({ 'system.attributes.encroachment.value': newEncroachment });

    const safeCharacterName = window.DX3rdRuntimeUtils.escapeHTML(character.name);
    await ChatMessage.create({
        content: `
            <div class="dx3rd-item-chat">
                <div style="font-weight: bold;">${safeCharacterName} ${game.i18n.localize("DX3rd.EnterScene")}</div>
                <div>${game.i18n.localize("DX3rd.Encroachment")} +${increase} ( ${currentEncroachment} → ${newEncroachment} )</div>
            </div>`,
        speaker
    });

    // The dice result is printed afterwards only when a roll actually happened.
    if (roll) await ChatMessage.create({ speaker, rolls: [roll] });
}

/**
 * Show the appearance / impulse roll / fear roll selection dialog and run the chosen procedure.
 * Shared by the scene control toolbar and the actor sheet's header buttons.
 * @param {Actor} [preferredActor] - the sheet's actor when called from an actor sheet.
 *   When given, it takes precedence over the selected token / assigned character.
 */
function dx3rdOpenEnterSceneDialog(preferredActor = null) {
    // Show the appearance / impulse / fear roll selection dialog (the DOM way)
    const choice = new Promise((resolve) => {
        const onSelect = (selection) => {
            dialog.remove();
            resolve(selection);
        };

        // Check the CRC stage setting
        const stageCRCEnabled = game.settings.get("dx3rd-emanim", "stageCRC");

        const dialog = document.createElement("div");
        dialog.id = "dx3rd-urge-dialog";

        // The fear roll button is shown only when the CRC stage setting is on
        const panicButtonHTML = stageCRCEnabled ? `
                <button
                    id="dx3rd-panic-test-button"
                    class="dx3rd-urge-dialog-button"
                >${game.i18n.localize("DX3rd.PanicTest")}</button>
        ` : '';

        dialog.innerHTML = `
            <div class="dx3rd-urge-dialog-title">${game.i18n.localize("DX3rd.EnterSceneQuestion")}</div>
            <div class="dx3rd-urge-dialog-buttons">
                <button
                    id="dx3rd-enter-scene-button"
                    class="dx3rd-urge-dialog-button"
                >${game.i18n.localize("DX3rd.EnterScene")}</button>
                <button
                    id="dx3rd-urge-test-button"
                    class="dx3rd-urge-dialog-button"
                >${game.i18n.localize("DX3rd.UrgeTest")}</button>
                ${panicButtonHTML}
                <hr class="dx3rd-urge-dialog-divider">
                <button
                    id="dx3rd-cancel-button"
                    class="dx3rd-urge-dialog-button dx3rd-urge-dialog-cancel"
                >${game.i18n.localize("DX3rd.Cancel")}</button>
            </div>
        `;

        // An already open dialog is cleared away first.
        // Stacking them duplicates the id, so the querySelector below grabs the old dialog's buttons and the dialog
        // visible on top has no listeners at all — it cannot even be cancelled.
        document.querySelectorAll("#dx3rd-urge-dialog").forEach(el => el.remove());

        document.body.appendChild(dialog);

        // The lookup is scoped to this dialog (never query the whole document — that is what caused the duplication above).
        dialog.querySelector("#dx3rd-enter-scene-button").addEventListener("click", () => onSelect("enterScene"));
        dialog.querySelector("#dx3rd-urge-test-button").addEventListener("click", () => onSelect("urgeTest"));
        if (stageCRCEnabled) {
            dialog.querySelector("#dx3rd-panic-test-button").addEventListener("click", () => onSelect("panicTest"));
        }
        dialog.querySelector("#dx3rd-cancel-button").addEventListener("click", () => onSelect(null));
    });

    // Handle it according to the chosen entry
    choice.then(async (selection) => {
        if (!selection) return;

        // The sheet's actor when called from a sheet, else the assigned character, else the selected token's actor
        let character = preferredActor || game.user.character;
        if (!character) {
            const controlledTokens = canvas.tokens?.controlled || [];
            if (controlledTokens.length > 0 && controlledTokens[0].actor) {
                character = controlledTokens[0].actor;
            } else {
                ui.notifications.warn("플레이어 캐릭터가 설정되지 않았거나 선택한 토큰이 없습니다.");
                return;
            }
        }

        const isExplicitActor = Boolean(preferredActor);
        if (selection === "enterScene") {
            await dx3rdApplyEntryEncroachment(character);
        } else if (selection === "urgeTest") {
            await dx3rdRunWillTest('urge', character, isExplicitActor);
        } else if (selection === "panicTest") {
            await dx3rdRunWillTest('panic', character, isExplicitActor);
        }
    });
}

/**
 * @param {'urge'|'panic'} kind
 * @param {Actor} fallbackCharacter
 * @param {boolean} [isExplicitActor] - true when the call came from an actor sheet.
 *   In that case the target is not overwritten by the selected token (the sheet's owner has to be the target).
 */
async function dx3rdRunWillTest(kind, fallbackCharacter, isExplicitActor = false) {
    // Use the selected token's actor when there is one, otherwise the assigned character
    let targetCharacter = fallbackCharacter;
    const controlledTokens = canvas.tokens?.controlled || [];
    if (!isExplicitActor && controlledTokens.length > 0 && controlledTokens[0].actor) {
        targetCharacter = controlledTokens[0].actor;
    }
    const speaker = window.DX3rdRuntimeUtils.getActorOnlySpeaker(targetCharacter);
    const testLabelKey = kind === 'urge' ? 'DX3rd.UrgeTest' : 'DX3rd.PanicTest';

    // Run the Will skill roll (falling back to mind when it is absent)
    let willSkill = targetCharacter.system.attributes.skills?.will;
    let willSkillName = '';

    if (willSkill) {
        willSkillName = willSkill.name?.startsWith('DX3rd.')
            ? game.i18n.localize(willSkill.name)
            : (willSkill.name || game.i18n.localize('DX3rd.will'));
    } else {
        // With no Will skill, use the mind attribute
        const mindStat = targetCharacter.system.attributes?.mind;
        if (!mindStat) {
            ui.notifications.warn('의지 기능과 정신 능력치를 찾을 수 없습니다.');
            return;
        }
        willSkill = mindStat;
        willSkillName = game.i18n.localize('DX3rd.Mind');
    }

    // Define the encroachment rise callback
    const handleEncroachmentIncrease = async () => {
        // Roll 2d10 (for the encroachment rise)
        const encroachmentRoll = new Roll("2d10");
        await encroachmentRoll.evaluate();
        const rollValue = encroachmentRoll.total;

        // Get the current encroachment (converted to a number explicitly)
        const currentEncroachment = Number(targetCharacter.system.attributes.encroachment.value) || 0;
        const newEncroachment = currentEncroachment + rollValue;

        await targetCharacter.update({
            'system.attributes.encroachment.value': newEncroachment
        });

        // For a GM, drop the encroachment change display
        const encroachmentText = game.user.isGM
            ? `${game.i18n.localize("DX3rd.Encroachment")} +${rollValue}`
            : `${game.i18n.localize("DX3rd.Encroachment")} +${rollValue} ( ${currentEncroachment} → ${newEncroachment} )`;

        const messageContent = `
            <div class="dx3rd-item-chat">
                <div style="font-weight: bold;">
                    ${targetCharacter.name} ${game.i18n.localize(testLabelKey)}
                </div>
                <div>
                    ${encroachmentText}
                </div>
            </div>
        `;

        // Print the encroachment information first (included in the content)
        await ChatMessage.create({ content: messageContent, speaker });
        // Print the dice roll result below it
        await ChatMessage.create({ speaker, rolls: [encroachmentRoll] });
    };

    // Show the Will skill roll dialog (difficulty required, the roll flags, the encroachment rise callback)
    if (window.DX3rdUniversalHandler && window.DX3rdUniversalHandler.showStatRollDialog) {
        window.DX3rdUniversalHandler.showStatRollDialog(
            targetCharacter,
            willSkill,
            willSkillName,
            'major',
            null, // item
            null, // previousToken
            null, // weaponBonus
            null, // comboAfterSuccessData
            null, // comboAfterDamageData
            null, // predefinedDifficulty
            true, // requireDifficulty: the difficulty must be entered
            kind === 'urge',  // isUrgeTest: the impulse roll flag
            handleEncroachmentIncrease, // afterRollCallback: the encroachment rise callback
            kind === 'panic'  // isPanicTest: the fear roll flag
        );
    }
}

Hooks.on('getSceneControlButtons', (controls) => {
    // v13/v14 compatibility: tools may be a Map (v14) or an Object (v13)
    function addTool(toolsObj, name, data) {
        if (toolsObj instanceof Map) {
            toolsObj.set(name, data);
        } else {
            toolsObj[name] = data;
        }
    }
    if (controls.tokens?.tools) {
        // GM only: the scene opening button (placed above the appearance / impulse buttons)
        if (game.user.isGM) {
            addTool(controls.tokens.tools, "sceneOpen", {
                name: "sceneOpen",
                title: "DX3rd.SceneOpen",
                icon: "fa-solid fa-clapperboard",
                button: true,
                onChange: () => {
                    const currentNumber = game.settings.get("dx3rd-emanim", "sceneOpenNumber") ?? 0;
                    const nextNumber = currentNumber + 1;
                    const activePlayers = game.users.filter(u => u.active && !u.isGM);
                    const escapeHtml = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
                    const userListHTML = activePlayers.length > 0
                        ? activePlayers.map(u => {
                            const charName = escapeHtml(u.character?.name ?? "-");
                            const userName = escapeHtml(u.name);
                            const safeId = `dx3rd-scene-user-${u.id}`;
                            return `<label class="dx3rd-scene-open-user-row"><span>${charName}(${userName})</span> <input type="checkbox" id="${safeId}" name="${safeId}" data-user-id="${u.id}"/></label>`;
                        }).join("")
                        : `<p class="dx3rd-scene-open-no-users">${game.i18n.localize("DX3rd.NoConnectedPlayers")}</p>`;
                    const content = `
                        <div class="dx3rd-scene-open-dialog">
                            <div class="flexcol">
                                <div class="form-group">
                                    <label>#${nextNumber}</label>
                                    <input type="text" id="dx3rd-scene-title" name="sceneTitle" placeholder="${game.i18n.localize("DX3rd.SceneTitleInput")}" autofocus/>
                                </div>
                                <div class="dx3rd-scene-open-user-list">
                                    ${userListHTML}
                                </div>
                            </div>
                        </div>
                    `;
                    new foundry.applications.api.DialogV2({
                        window: { title: game.i18n.localize("DX3rd.SceneOpen") },
                        content,
                        buttons: [
                            {
                                action: "confirm",
                                icon: "fas fa-check",
                                label: game.i18n.localize("DX3rd.Confirm"),
                                default: true,
                                callback: async (event, button, dialog) => {
                                    const html = dialog.element;
                                    const title = html.querySelector("#dx3rd-scene-title")?.value?.trim() ?? "";
                                    game.settings.set("dx3rd-emanim", "sceneOpenNumber", nextNumber);

                                    const allActors = game.actors.filter(a => a.type === "character" || a.type === "enemy");
                                    const characterActors = game.actors.filter(a => a.type === "character");
                                    const tempItemText = game.i18n.localize("DX3rd.TemporaryItem");
                                    const conditionsToRemove = ["rigor", "pressure", "dazed", "poisoned", "hatred", "fear", "berserk", "boarding", "fly", "stealth"];

                                    // 1. Reset the character actors' fists — reverted only from the pre-change snapshot (never overwritten with literals).
                                    for (const actor of characterActors) {
                                        await window.DX3rdUniversalHandler.clearItemGrants(actor);
                                        await window.DX3rdUniversalHandler.restoreFistItems(actor);
                                        const tempItems = actor.items.filter(item => {
                                            if (!["weapon", "protect", "vehicle"].includes(item.type)) return false;
                                            return item.name.endsWith(tempItemText);
                                        });
                                        if (tempItems.length > 0) {
                                            await actor.deleteEmbeddedDocuments("Item", tempItems.map(item => item.id));
                                        }
                                    }

                                    // 2. Reset action_end / action_delay / extra-turn on every actor
                                    for (const actor of allActors) {
                                        const updates = {
                                            "system.conditions.action_end.active": false,
                                            "system.conditions.action_delay.active": false,
                                            "system.conditions.action_delay.value": 0
                                        };
                                        const extraTurnMax = actor.system?.conditions?.["extra-turn"]?.max ?? 0;
                                        if (extraTurnMax > 0) {
                                            updates["system.conditions.extra-turn.value"] = extraTurnMax;
                                        }
                                        await actor.update(updates);
                                    }

                                    // 3. Disable Hooks (for characters and enemies)
                                    if (typeof DX3rdDisableHooks !== "undefined") {
                                        const timings = ["roll", "major", "reaction", "guard", "main", "round", "scene"];
                                        for (const timing of timings) {
                                            await DX3rdDisableHooks.executeDisableHook(timing, allActors);
                                        }
                                    }

                                    // 4. Clear every actor's conditions in bulk
                                    if (!window.DX3rdConditionTriggerMap) {
                                        window.DX3rdConditionTriggerMap = new Map();
                                    }
                                    for (const actor of allActors) {
                                        for (const condition of conditionsToRemove) {
                                            if (actor.effects.find(e => e.statuses.has(condition))) {
                                                const mapKey = `${actor.id}:${condition}`;
                                                window.DX3rdConditionTriggerMap.set(mapKey, {
                                                    triggerItemName: "장면 개막",
                                                    suppressMessage: true,
                                                    bulkRemove: true
                                                });
                                                await actor.toggleStatusEffect(condition, { active: false });
                                                window.DX3rdConditionTriggerMap.delete(mapKey);
                                            }
                                        }
                                    }

                                    const content = `<h3 class="dx3rd-chat-heading">#${nextNumber}${title ? " " + title : ""}</h3>`;
                                    await ChatMessage.create({
                                        content,
                                        speaker: { alias: game.user.name }
                                    });

                                    const checkedUserIds = [];
                                    html.querySelectorAll(".dx3rd-scene-open-user-row input[data-user-id]:checked").forEach(el => {
                                        checkedUserIds.push(el.getAttribute("data-user-id"));
                                    });
                                    for (const userId of checkedUserIds) {
                                        window.DX3rdSocketRouter.emit({ type: "showSceneEnterDialog", userId });
                                    }
                                }
                            },
                            {
                                action: "cancel",
                                icon: "fas fa-times",
                                label: game.i18n.localize("DX3rd.Cancel")
                            },
                            {
                                action: "sessionEnd",
                                icon: "fas fa-stop",
                                label: game.i18n.localize("DX3rd.SessionEnd"),
                                callback: () => {
                                    new foundry.applications.api.DialogV2({
                                        window: { title: game.i18n.localize("DX3rd.SessionEnd") },
                                        content: `<p>${game.i18n.localize("DX3rd.SessionEndQuestion")}</p>`,
                                        buttons: [
                                            {
                                                action: "confirm",
                                                icon: "fas fa-check",
                                                label: game.i18n.localize("DX3rd.Confirm"),
                                                callback: async () => {
                                                    const allActors = game.actors.filter(a => a.type === "character" || a.type === "enemy");
                                                    const characterActors = game.actors.filter(a => a.type === "character");
                                                    const tempItemText = game.i18n.localize("DX3rd.TemporaryItem");
                                                    const conditionsToRemove = ["rigor", "pressure", "dazed", "poisoned", "hatred", "fear", "berserk", "boarding", "fly", "stealth"];

                                                    // 1. Reset the character actors' fists — reverted only from the pre-change snapshot (never overwritten with literals).
                                                    for (const actor of characterActors) {
                                                        await window.DX3rdUniversalHandler.clearItemGrants(actor);
                                                        await window.DX3rdUniversalHandler.restoreFistItems(actor);
                                                        const tempItems = actor.items.filter(item => {
                                                            if (!["weapon", "protect", "vehicle"].includes(item.type)) return false;
                                                            return item.name.endsWith(tempItemText);
                                                        });
                                                        if (tempItems.length > 0) {
                                                            await actor.deleteEmbeddedDocuments("Item", tempItems.map(item => item.id));
                                                        }
                                                    }

                                                    // 2. Reset action_end / action_delay / extra-turn on every actor
                                                    for (const actor of allActors) {
                                                        const updates = {
                                                            "system.conditions.action_end.active": false,
                                                            "system.conditions.action_delay.active": false,
                                                            "system.conditions.action_delay.value": 0
                                                        };
                                                        const extraTurnMax = actor.system?.conditions?.["extra-turn"]?.max ?? 0;
                                                        if (extraTurnMax > 0) {
                                                            updates["system.conditions.extra-turn.value"] = extraTurnMax;
                                                        }
                                                        await actor.update(updates);
                                                    }

                                                    // 3. Disable Hooks (for characters and enemies, including the 'session' timing)
                                                    if (typeof DX3rdDisableHooks !== "undefined") {
                                                        const timings = ["roll", "major", "reaction", "guard", "main", "round", "scene", "session"];
                                                        for (const timing of timings) {
                                                            await DX3rdDisableHooks.executeDisableHook(timing, allActors);
                                                        }
                                                    }

                                                    // 4. Clear every actor's conditions in bulk
                                                    if (!window.DX3rdConditionTriggerMap) {
                                                        window.DX3rdConditionTriggerMap = new Map();
                                                    }
                                                    for (const actor of allActors) {
                                                        for (const condition of conditionsToRemove) {
                                                            if (actor.effects.find(e => e.statuses.has(condition))) {
                                                                const mapKey = `${actor.id}:${condition}`;
                                                                window.DX3rdConditionTriggerMap.set(mapKey, {
                                                                    triggerItemName: "세션 종료",
                                                                    suppressMessage: true,
                                                                    bulkRemove: true
                                                                });
                                                                await actor.toggleStatusEffect(condition, { active: false });
                                                                window.DX3rdConditionTriggerMap.delete(mapKey);
                                                            }
                                                        }
                                                    }

                                                    // Reset the scene numbering
                                                    game.settings.set("dx3rd-emanim", "sceneOpenNumber", 0);

                                                    // Print the chat message
                                                    await ChatMessage.create({
                                                        content: `<h3 class="dx3rd-chat-heading">${game.i18n.localize("DX3rd.SessionEnd")}</h3>`,
                                                        speaker: { alias: game.user.name }
                                                    });
                                                }
                                            },
                                            {
                                                action: "cancel",
                                                icon: "fas fa-times",
                                                label: game.i18n.localize("DX3rd.Cancel"),
                                                default: true
                                            }
                                        ]
                                    }).render(true);
                                }
                            }
                        ]
                    }).render(true);
                }
            });
        }

        // Check the CRC stage setting to decide the button name
        const stageCRCEnabled = game.settings.get("dx3rd-emanim", "stageCRC");
        const buttonTitle = stageCRCEnabled ? "DX3rd.EnterUrgePanic" : "DX3rd.EnterUrge";

        addTool(controls.tokens.tools, "enterScene", {
            name: "enterScene",
            title: buttonTitle,
            icon: "fa-solid fa-dice",
            button: true,
            onChange: () => dx3rdOpenEnterSceneDialog()
        });

    }
});
