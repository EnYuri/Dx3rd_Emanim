/**
 * Shared actor sheet data preparation for AppV1 and AppV2 sheets.
 */
(function () {
    const LIST_KEYS = [
        "workList",
        "syndromeList",
        "comboList",
        "effectList",
        "easyEffectList",
        "extraEffectList",
        "spellList",
        "psionicsList",
        "roisList",
        "memoryList",
        "weaponList",
        "protectList",
        "vehicleList",
        "connectionList",
        "bookList",
        "etcList",
        "onceList",
        "recordList"
    ];

    function hasOwnerPermission(actor, user = game.user) {
        if (user.isGM) return true;
        return actor.testUserPermission(user, "OWNER");
    }

    function shouldUseSimpleSheet(actor, user = game.user) {
        if (user.isGM) return false;

        let permission = actor.permission[user.id];
        if (permission === CONST.DOCUMENT_OWNERSHIP_LEVELS.INHERIT || permission === undefined) {
            if (actor.testUserPermission(user, "OWNER")) {
                permission = CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER;
            } else if (actor.testUserPermission(user, "OBSERVER")) {
                permission = CONST.DOCUMENT_OWNERSHIP_LEVELS.OBSERVER;
            } else if (actor.testUserPermission(user, "LIMITED")) {
                permission = CONST.DOCUMENT_OWNERSHIP_LEVELS.LIMITED;
            } else {
                permission = CONST.DOCUMENT_OWNERSHIP_LEVELS.NONE;
            }
        }

        if (permission >= CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER) return false;
        if (permission === CONST.DOCUMENT_OWNERSHIP_LEVELS.LIMITED) return true;

        if (permission === CONST.DOCUMENT_OWNERSHIP_LEVELS.OBSERVER) {
            const actorType = actor.system?.actorType || "NPC";
            return !(actorType === "PlayerCharacter" || actorType === "Ally");
        }

        return true;
    }

    function getTemplate(actor, simple = shouldUseSimpleSheet(actor)) {
        if (actor.type === "enemy") {
            return "systems/dx3rd-emanim/templates/actor/actor-sheet-enemy.html";
        }
        if (simple) {
            return "systems/dx3rd-emanim/templates/actor/actor-sheet-simple.html";
        }
        return "systems/dx3rd-emanim/templates/actor/actor-sheet.html";
    }

    function getSkillDisplay(actor, skillKey) {
        if (!skillKey || skillKey === "-") return "-";

        const skill = actor.system?.attributes?.skills?.[skillKey];
        if (skill) {
            if (skill.name && skill.name.startsWith("DX3rd.")) {
                const customSkills = game.settings.get("dx3rd-emanim", "customSkills") || {};
                const customSkill = customSkills[skillKey];
                if (customSkill) return typeof customSkill === "object" ? customSkill.name : customSkill;
                return game.i18n.localize(skill.name);
            }
            return skill.name || skillKey;
        }

        const attributes = ["body", "sense", "mind", "social"];
        if (attributes.includes(skillKey)) {
            return game.i18n.localize(`DX3rd.${skillKey.charAt(0).toUpperCase() + skillKey.slice(1)}`);
        }

        if (skillKey === "syndrome") return game.i18n.localize("DX3rd.Syndrome");
        if (skillKey.startsWith("DX3rd.")) return game.i18n.localize(skillKey);
        return skillKey;
    }

    function getAbilityDice(actor, abilityId) {
        const baseAbility = actor.system?.attributes?.[abilityId];
        return baseAbility ? baseAbility.dice || 0 : 0;
    }

    function getCreateSkillDialogOptions(actor, abilityId) {
        if (!abilityId) return null;

        return {
            title: game.i18n.localize("DX3rd.CreateSkill"),
            skill: {
                key: "",
                name: "",
                point: 0,
                bonus: 0,
                extra: 0,
                works: 0,
                base: abilityId,
                dice: getAbilityDice(actor, abilityId),
                total: 0
            },
            actorId: actor.id
        };
    }

    function getEditSkillDialogOptions(actor, skillId) {
        if (!skillId) return null;
        const skill = actor.system?.attributes?.skills?.[skillId];
        if (!skill) return null;

        return {
            title: game.i18n.localize("DX3rd.EditSkill"),
            width: 900,
            skill: {
                key: skillId,
                name: skill.name || "",
                point: skill.point || 0,
                bonus: skill.bonus || 0,
                extra: skill.extra || 0,
                works: skill.works || 0,
                base: skill.base,
                dice: getAbilityDice(actor, skill.base),
                total: skill.total || 0,
                delete: skill.delete
            },
            actorId: actor.id
        };
    }

    function validateOwnedItemCreate(actor, type) {
        if (!game.settings.get("dx3rd-emanim", "stageCRC") && ["spell", "psionic", "book"].includes(type)) {
            return {
                ok: false,
                level: "warn",
                message: "CRC 스테이지 비활성화 시 스펠, 사이오닉, 마도서 아이템을 생성할 수 없습니다."
            };
        }

        if (type === "works" && actor.items.filter(item => item.type === "works").length >= 1) {
            return {
                ok: false,
                level: "info",
                message: "Each character can only have one Works item."
            };
        }

        if (type === "syndrome" && actor.items.filter(item => item.type === "syndrome").length >= 3) {
            return {
                ok: false,
                level: "info",
                message: "Each character can only have up to three Syndrome items."
            };
        }

        return { ok: true };
    }

    function getOwnedItemCreateData({ type = "item", effectType, roisType } = {}) {
        const key = `DX3rd.${type.charAt(0).toUpperCase()}${type.slice(1)}`;
        const typeLabel = game.i18n.localize(key);
        const itemData = {
            name: `New ${typeLabel !== key ? typeLabel : type}`,
            type,
            system: {}
        };

        if (effectType) itemData.system.type = effectType;
        if (roisType) itemData.system.type = roisType;
        if (type === "effect") itemData.system.level = { init: 1, max: 1 };

        return itemData;
    }

    async function createOwnedItem(actor, options = {}) {
        const type = options.type || "item";
        const validation = validateOwnedItemCreate(actor, type);
        if (!validation.ok) {
            const notify = ui.notifications[validation.level] || ui.notifications.warn;
            notify.call(ui.notifications, validation.message);
            return null;
        }

        const itemData = getOwnedItemCreateData({
            type,
            effectType: options.effectType,
            roisType: options.roisType
        });
        const created = await actor.createEmbeddedDocuments("Item", [itemData]);
        return created?.[0] || null;
    }

    function getOwnedItem(actor, itemId) {
        if (!actor || !itemId) return null;
        return actor.items.get(itemId) || null;
    }

    async function updateOwnedItemUsedState(actor, itemId, value) {
        const item = getOwnedItem(actor, itemId);
        if (!item) return null;

        const state = Number.parseInt(value, 10) || 0;
        await item.update({ "system.used.state": state });
        return item;
    }

    async function updateOwnedItemActiveState(actor, itemId, checked) {
        const item = getOwnedItem(actor, itemId);
        if (!item) return null;

        await item.update({ "system.active.state": !!checked });
        return item;
    }

    async function updateOwnedItemEquipmentState(actor, itemId, checked) {
        const item = getOwnedItem(actor, itemId);
        if (!item) return null;

        const equipped = !!checked;
        if (item.type === "vehicle" && equipped) {
            const updates = actor.items
                .filter(other => other.type === "vehicle" && other.id !== itemId && other.system?.equipment === true)
                .map(other => ({ _id: other.id, "system.equipment": false }));
            if (updates.length) await actor.updateEmbeddedDocuments("Item", updates);
        }

        await item.update({ "system.equipment": equipped });
        return item;
    }

    function getSyndromeSelectionUpdate(actor, itemId, checked) {
        const item = getOwnedItem(actor, itemId);
        if (!item || item.type !== "syndrome") {
            return { ok: false, reason: "invalidItem", selectedIds: null, changed: false };
        }

        const current = Array.isArray(actor.system?.attributes?.syndrome)
            ? [...actor.system.attributes.syndrome]
            : [];
        const selected = new Set(current);

        if (checked) selected.add(itemId);
        else selected.delete(itemId);

        const selectedIds = [...selected].filter(id => actor.items.get(id)?.type === "syndrome");
        const syndromeCount = actor.items.filter(actorItem => actorItem.type === "syndrome").length;
        const maxSelected = syndromeCount >= 3 ? 2 : syndromeCount;

        if (selectedIds.length > maxSelected) {
            return { ok: false, reason: "optionalLimit", selectedIds: current, changed: false };
        }

        const changed = selectedIds.length !== current.length || selectedIds.some((id, index) => id !== current[index]);
        return { ok: true, reason: null, selectedIds, changed };
    }

    async function updateActorSyndromeSelection(actor, itemId, checked) {
        const result = getSyndromeSelectionUpdate(actor, itemId, checked);
        if (!result.ok || !result.changed) return result;

        await actor.update({ "system.attributes.syndrome": result.selectedIds });
        return result;
    }

    function normalizeItems(items) {
        if (Array.isArray(items)) return items;
        try {
            return Array.from(items);
        } catch (error) {
            console.warn("DX3rd | Failed to convert actor sheet items to array:", error);
            return [];
        }
    }

    function prepareItemDisplayDefaults(item, actor) {
        if (!item.system) item.system = {};

        if (!item.system.used) {
            item.system.used = { state: 0, max: 0, level: false, disable: "notCheck" };
        } else {
            if (item.system.used.state == null) item.system.used.state = 0;
            if (item.system.used.max == null) item.system.used.max = 0;
            if (item.system.used.level == null) item.system.used.level = false;
            if (item.system.used.disable == null || item.system.used.disable === undefined) item.system.used.disable = "notCheck";
        }

        if (!item.system.active) item.system.active = { state: false };
        if (!item.system.encroach) item.system.encroach = { value: 0 };
        if (!item.system.level) item.system.level = { value: 0 };

        if (item.system.used.disable === "notCheck") {
            item.system.used.displayMax = 0;
            if (item.system.used.level !== false) item.system.used.level = false;
            return;
        }

        let maxValue = item.system.used.max || 0;
        if (item.type === "once") maxValue = item.system.quantity || 1;

        if (item.system.used.level === true && item.type === "effect") {
            const baseLevel = item.system.level?.init || 0;
            const upgrade = item.system.level?.upgrade || false;
            let finalLevel = baseLevel;
            if (upgrade && actor.system?.attributes?.encroachment?.level) {
                finalLevel += Number(actor.system.attributes.encroachment.level) || 0;
            }
            maxValue += finalLevel;
        } else if (item.system.used.level === true && item.type === "psionic") {
            maxValue += item.system.level?.init || 0;
        }

        item.system.used.displayMax = maxValue;
    }

    function categorizeItem(actorData, item) {
        if (item.type === "works") actorData.workList.push(item);
        else if (item.type === "syndrome") actorData.syndromeList.push(item);
        else if (item.type === "combo") actorData.comboList.push(item);
        else if (item.type === "effect") {
            if (item.system?.type === "normal") actorData.effectList.push(item);
            else if (item.system?.type === "easy") actorData.easyEffectList.push(item);
            else actorData.extraEffectList.push(item);
        } else if (item.type === "spell") actorData.spellList.push(item);
        else if (item.type === "psionics" || item.type === "psionic") actorData.psionicsList.push(item);
        else if (item.type === "rois") {
            if (item.system?.type === "M") actorData.memoryList.push(item);
            else actorData.roisList.push(item);
        } else if (item.type === "weapon") actorData.weaponList.push(item);
        else if (item.type === "protect") actorData.protectList.push(item);
        else if (item.type === "vehicle") actorData.vehicleList.push(item);
        else if (item.type === "connection") actorData.connectionList.push(item);
        else if (item.type === "book") actorData.bookList.push(item);
        else if (item.type === "etc") actorData.etcList.push(item);
        else if (item.type === "once") actorData.onceList.push(item);
        else if (item.type === "record") actorData.recordList.push(item);
    }

    function generateAppliedEffectDescription(appliedEffect, appliedKey) {
        const panicMatch = appliedKey && String(appliedKey).match(/^Panic(\d+)$/);
        if (panicMatch) {
            const n = parseInt(panicMatch[1], 10);
            if (n >= 1 && n <= 10) return game.i18n.localize(`DX3rd.PanicText${n}`);
        }

        const desc = appliedEffect.description;
        if (typeof desc === "string" && desc.trim()) return desc.trim();
        return "";
    }

    function prepareCharacterItems(actor, actorData, items) {
        const preparedItems = normalizeItems(items);
        for (const key of LIST_KEYS) actorData[key] = [];

        for (const item of preparedItems) {
            prepareItemDisplayDefaults(item, actor);
            categorizeItem(actorData, item);
        }

        const sortBySort = (a, b) => (a.sort || 0) - (b.sort || 0);
        for (const key of LIST_KEYS) actorData[key].sort(sortBySort);

        actorData.syndromeType = "-";
        if (actorData.syndromeList.length === 1) actorData.syndromeType = game.i18n.localize("DX3rd.PureBreed");
        else if (actorData.syndromeList.length === 2) actorData.syndromeType = game.i18n.localize("DX3rd.CrossBreed");
        else if (actorData.syndromeList.length === 3) actorData.syndromeType = game.i18n.localize("DX3rd.TriBreed");

        actorData.applied = Object.entries(actor.system.attributes.applied ?? {}).map(([appliedKey, appliedEffect], index) => ({
            _id: `applied_${index}`,
            name: appliedEffect.name || "알 수 없는 효과",
            img: appliedEffect.img || "icons/svg/aura.svg",
            system: {
                description: generateAppliedEffectDescription(appliedEffect, appliedKey)
            },
            disable: appliedEffect.disable || "-",
            appliedEffect
        }));
    }

    function prepareItemLevelDisplay(actor, itemData) {
        if (!["effect", "psionic"].includes(itemData.type)) return;

        if (!itemData.system) itemData.system = {};
        if (!itemData.system.level) itemData.system.level = {};
        if (itemData.system.level.init == null) itemData.system.level.init = 1;
        if (itemData.system.level.max == null) itemData.system.level.max = 1;

        if (itemData.type === "effect") {
            const upgrade = itemData.system.level.upgrade ?? false;
            const encLevel = upgrade ? Number(actor.system?.attributes?.encroachment?.level) || 0 : 0;
            itemData.system.level.value = Number(itemData.system.level.init || 0) + encLevel;
        } else {
            itemData.system.level.value = Number(itemData.system.level.init || 0);
        }
    }

    async function prepareSheetData(actor, data, { simple = shouldUseSimpleSheet(actor) } = {}) {
        const actorData = actor.toObject(false);
        data.actor = actorData;
        data.system = actor.system;

        data = await window.DX3rdDescriptionManager.enrichSheetData(data, actor);
        if (simple) return data;

        data.canEdit = hasOwnerPermission(actor);
        data.stageCRCDisabled = !game.settings.get("dx3rd-emanim", "stageCRC");
        data.items = actorData.items;

        for (const itemData of data.items) {
            const item = actor.items.get(itemData._id);
            itemData.id = item._id;
            itemData.isOther = ["book", "etc", "once"].includes(itemData.type);
            prepareItemLevelDisplay(actor, itemData);
        }

        data.items.sort((a, b) => (a.sort || 0) - (b.sort || 0));
        prepareCharacterItems(actor, actorData, data.items);

        data.dice = 0;
        data.critical = game.settings.get("dx3rd-emanim", "defaultCritical") || 10;
        data.add = 0;

        return data;
    }

    window.DX3rdActorSheetData = {
        hasOwnerPermission,
        shouldUseSimpleSheet,
        getTemplate,
        getSkillDisplay,
        getCreateSkillDialogOptions,
        getEditSkillDialogOptions,
        validateOwnedItemCreate,
        getOwnedItemCreateData,
        createOwnedItem,
        getOwnedItem,
        updateOwnedItemUsedState,
        updateOwnedItemActiveState,
        updateOwnedItemEquipmentState,
        getSyndromeSelectionUpdate,
        updateActorSyndromeSelection,
        prepareCharacterItems,
        generateAppliedEffectDescription,
        prepareSheetData
    };
})();
