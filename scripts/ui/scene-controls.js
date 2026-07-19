/**
 * Double Cross 3rd - 씬 컨트롤 툴바
 * main.js 에서 분리. 좌측 씬 컨트롤에 등장/충동/공포 판정 도구를 추가하고
 * 그 선택 다이얼로그와 판정 절차를 담당한다.
 */

/**
 * 장면 등장에 따른 침식률 상승을 적용하고 결과를 채팅에 출력한다.
 * `entryEncroachment` 설정이 켜져 있으면 +1 고정, 꺼져 있으면 1d10 굴림으로 처리한다.
 * 씬 컨트롤의 등장 도구와 장면 개막 다이얼로그가 공유한다.
 * @param {Actor} character
 */
async function dx3rdApplyEntryEncroachment(character) {
    const speaker = window.DX3rdRuntimeUtils.getActorOnlySpeaker(character);
    const useFixedValue = game.settings.get('dx3rd-emanim', 'entryEncroachment');

    // 고정값이 아니면 1d10을 굴려 상승분을 정한다.
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

    // 굴림이 있었던 경우에만 주사위 결과를 이어서 출력한다.
    if (roll) await ChatMessage.create({ speaker, rolls: [roll] });
}

/**
 * 등장 / 충동 판정 / 공포 판정 선택 다이얼로그를 띄우고 선택된 절차를 실행한다.
 * 씬 컨트롤 툴바와 액터 시트 헤더 버튼이 공유한다.
 * @param {Actor} [preferredActor] - 액터 시트에서 호출한 경우 그 시트의 액터.
 *   지정하면 선택 토큰/할당 캐릭터보다 우선한다.
 */
function dx3rdOpenEnterSceneDialog(preferredActor = null) {
    // 등장/충동/공포 판정 선택 다이얼로그 표시 (DOM 방식)
    const choice = new Promise((resolve) => {
        const onSelect = (selection) => {
            dialog.remove();
            resolve(selection);
        };

        // CRC 스테이지 설정 확인
        const stageCRCEnabled = game.settings.get("dx3rd-emanim", "stageCRC");

        const dialog = document.createElement("div");
        dialog.id = "dx3rd-urge-dialog";

        // 공포 판정 버튼은 CRC 스테이지 설정이 켜져 있을 때만 표시
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

        // 이미 열려 있는 다이얼로그는 먼저 치운다.
        // 겹쳐 두면 id가 중복되어 아래 querySelector가 옛 다이얼로그의 버튼을 잡고,
        // 위에 보이는 다이얼로그는 리스너가 없어 취소조차 안 되는 상태가 된다.
        document.querySelectorAll("#dx3rd-urge-dialog").forEach(el => el.remove());

        document.body.appendChild(dialog);

        // 조회 범위를 이 다이얼로그로 한정한다(document 전역 조회 금지 — 위 중복 문제의 원인).
        dialog.querySelector("#dx3rd-enter-scene-button").addEventListener("click", () => onSelect("enterScene"));
        dialog.querySelector("#dx3rd-urge-test-button").addEventListener("click", () => onSelect("urgeTest"));
        if (stageCRCEnabled) {
            dialog.querySelector("#dx3rd-panic-test-button").addEventListener("click", () => onSelect("panicTest"));
        }
        dialog.querySelector("#dx3rd-cancel-button").addEventListener("click", () => onSelect(null));
    });

    // 선택된 항목에 따라 처리
    choice.then(async (selection) => {
        if (!selection) return;

        // 시트에서 부른 경우 그 액터, 아니면 할당된 캐릭터, 그것도 없으면 선택한 토큰의 액터
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
 * @param {boolean} [isExplicitActor] - 액터 시트에서 온 호출이면 true.
 *   이 경우 선택 토큰으로 대상을 덮어쓰지 않는다(시트의 주인이 대상이어야 하므로).
 */
async function dx3rdRunWillTest(kind, fallbackCharacter, isExplicitActor = false) {
    // 선택한 토큰이 있으면 해당 액터 사용, 없으면 할당된 캐릭터 사용
    let targetCharacter = fallbackCharacter;
    const controlledTokens = canvas.tokens?.controlled || [];
    if (!isExplicitActor && controlledTokens.length > 0 && controlledTokens[0].actor) {
        targetCharacter = controlledTokens[0].actor;
    }
    const speaker = window.DX3rdRuntimeUtils.getActorOnlySpeaker(targetCharacter);
    const testLabelKey = kind === 'urge' ? 'DX3rd.UrgeTest' : 'DX3rd.PanicTest';

    // 의지 기능 판정 실행 (없으면 mind로 대체)
    let willSkill = targetCharacter.system.attributes.skills?.will;
    let willSkillName = '';

    if (willSkill) {
        willSkillName = willSkill.name?.startsWith('DX3rd.')
            ? game.i18n.localize(willSkill.name)
            : (willSkill.name || game.i18n.localize('DX3rd.will'));
    } else {
        // 의지 기능이 없으면 mind 능력치 사용
        const mindStat = targetCharacter.system.attributes?.mind;
        if (!mindStat) {
            ui.notifications.warn('의지 기능과 정신 능력치를 찾을 수 없습니다.');
            return;
        }
        willSkill = mindStat;
        willSkillName = game.i18n.localize('DX3rd.Mind');
    }

    // 침식률 상승 콜백 함수 정의
    const handleEncroachmentIncrease = async () => {
        // 2d10 굴리기 (침식률 상승용)
        const encroachmentRoll = new Roll("2d10");
        await encroachmentRoll.evaluate();
        const rollValue = encroachmentRoll.total;

        // 현재 침식률 가져오기 (숫자로 명시적 변환)
        const currentEncroachment = Number(targetCharacter.system.attributes.encroachment.value) || 0;
        const newEncroachment = currentEncroachment + rollValue;

        await targetCharacter.update({
            'system.attributes.encroachment.value': newEncroachment
        });

        // GM인 경우 침식률 변화 표시 제거
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

        // 침식률 정보를 먼저 출력 (컨텐트에 포함)
        await ChatMessage.create({ content: messageContent, speaker });
        // 주사위 굴림 결과를 아래에 출력
        await ChatMessage.create({ speaker, rolls: [encroachmentRoll] });
    };

    // 의지 기능 판정 다이얼로그 표시 (난이도 필수, 판정 플래그, 침식률 상승 콜백)
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
            true, // requireDifficulty: 난이도 필수 입력
            kind === 'urge',  // isUrgeTest: 충동 판정 플래그
            handleEncroachmentIncrease, // afterRollCallback: 침식률 상승 콜백
            kind === 'panic'  // isPanicTest: 공포 판정 플래그
        );
    }
}

Hooks.on('getSceneControlButtons', (controls) => {
    // v13/v14 호환: tools가 Map(v14) 또는 Object(v13) 형태일 수 있음
    function addTool(toolsObj, name, data) {
        if (toolsObj instanceof Map) {
            toolsObj.set(name, data);
        } else {
            toolsObj[name] = data;
        }
    }
    if (controls.tokens?.tools) {
        // GM 전용: 장면 개막 버튼 (등장/충동 버튼보다 위에 배치)
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
                                    const fistName = game.i18n.localize("DX3rd.Fist");
                                    const tempItemText = game.i18n.localize("DX3rd.TemporaryItem");
                                    const engageText = game.i18n.localize("DX3rd.Engage");
                                    const conditionsToRemove = ["rigor", "pressure", "dazed", "poisoned", "hatred", "fear", "berserk", "boarding", "fly", "stealth"];

                                    // 1. 캐릭터 액터 Fist 초기화
                                    for (const actor of characterActors) {
                                        const fistItems = actor.items.filter(item => {
                                            if (item.type !== "weapon") return false;
                                            return item.name === fistName || item.name.includes(`[${fistName}]`);
                                        });
                                        for (const fistItem of fistItems) {
                                            await fistItem.update({
                                                name: fistName,
                                                "system.add": "+0",
                                                "system.attack": "-5",
                                                "system.guard": "0",
                                                "system.range": engageText
                                            });
                                        }
                                        const tempItems = actor.items.filter(item => {
                                            if (!["weapon", "protect", "vehicle"].includes(item.type)) return false;
                                            return item.name.endsWith(tempItemText);
                                        });
                                        if (tempItems.length > 0) {
                                            await actor.deleteEmbeddedDocuments("Item", tempItems.map(item => item.id));
                                        }
                                    }

                                    // 2. 모든 액터 action_end / action_delay / extra-turn 초기화
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

                                    // 3. Disable Hooks (캐릭터 + 에너미 대상)
                                    if (typeof DX3rdDisableHooks !== "undefined") {
                                        const timings = ["roll", "major", "reaction", "guard", "main", "round", "scene"];
                                        for (const timing of timings) {
                                            await DX3rdDisableHooks.executeDisableHook(timing, allActors);
                                        }
                                    }

                                    // 4. 모든 액터 상태이상 일괄 해제
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
                                                    const fistName = game.i18n.localize("DX3rd.Fist");
                                                    const tempItemText = game.i18n.localize("DX3rd.TemporaryItem");
                                                    const engageText = game.i18n.localize("DX3rd.Engage");
                                                    const conditionsToRemove = ["rigor", "pressure", "dazed", "poisoned", "hatred", "fear", "berserk", "boarding", "fly", "stealth"];

                                                    // 1. 캐릭터 액터 Fist 초기화
                                                    for (const actor of characterActors) {
                                                        const fistItems = actor.items.filter(item => {
                                                            if (item.type !== "weapon") return false;
                                                            return item.name === fistName || item.name.includes(`[${fistName}]`);
                                                        });
                                                        for (const fistItem of fistItems) {
                                                            await fistItem.update({
                                                                name: fistName,
                                                                "system.add": "+0",
                                                                "system.attack": "-5",
                                                                "system.guard": "0",
                                                                "system.range": engageText
                                                            });
                                                        }
                                                        const tempItems = actor.items.filter(item => {
                                                            if (!["weapon", "protect", "vehicle"].includes(item.type)) return false;
                                                            return item.name.endsWith(tempItemText);
                                                        });
                                                        if (tempItems.length > 0) {
                                                            await actor.deleteEmbeddedDocuments("Item", tempItems.map(item => item.id));
                                                        }
                                                    }

                                                    // 2. 모든 액터 action_end / action_delay / extra-turn 초기화
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

                                                    // 3. Disable Hooks (캐릭터 + 에너미 대상, 'session' 타이밍 포함)
                                                    if (typeof DX3rdDisableHooks !== "undefined") {
                                                        const timings = ["roll", "major", "reaction", "guard", "main", "round", "scene", "session"];
                                                        for (const timing of timings) {
                                                            await DX3rdDisableHooks.executeDisableHook(timing, allActors);
                                                        }
                                                    }

                                                    // 4. 모든 액터 상태이상 일괄 해제
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

                                                    // 장면 넘버링 초기화
                                                    game.settings.set("dx3rd-emanim", "sceneOpenNumber", 0);

                                                    // 채팅 메시지 출력
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

        // CRC 스테이지 설정 확인하여 버튼 이름 결정
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
