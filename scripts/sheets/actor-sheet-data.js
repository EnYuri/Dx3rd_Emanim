/**
 * Shared actor sheet data preparation for the previous sheets and the AppV2 sheets.
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

    function localize(key) {
        return game.i18n.localize(key);
    }

    function format(key, data = {}) {
        return game.i18n.format(key, data);
    }

    function shouldUseSimpleSheet(actor, user = game.user) {
        if (user.isGM) return false;

        // getUserLevel already resolves INHERIT into the default permission before returning.
        // (actor.permission is the "current user's" permission level number, so it cannot be used for a per-user lookup.)
        const permission = actor.getUserLevel(user) ?? CONST.DOCUMENT_OWNERSHIP_LEVELS.NONE;

        if (permission >= CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER) return false;
        if (permission === CONST.DOCUMENT_OWNERSHIP_LEVELS.LIMITED) return true;

        if (permission === CONST.DOCUMENT_OWNERSHIP_LEVELS.OBSERVER) {
            const actorType = actor.system?.actorType || "NPC";
            return !(actorType === "PlayerCharacter" || actorType === "Ally");
        }

        return true;
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

        // The width is not passed — the creation dialog and the table share the same nine columns, so the class
        // default (600) is used as-is. Passing 900 here would stretch the same table only while editing.
        return {
            title: game.i18n.localize("DX3rd.EditSkill"),
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
                message: localize("DX3rd.StageCRCItemsCreateDisabled")
            };
        }

        if (type === "works" && actor.items.filter(item => item.type === "works").length >= 1) {
            return {
                ok: false,
                level: "info",
                message: localize("DX3rd.WorksLimitOne")
            };
        }

        if (type === "syndrome" && actor.items.filter(item => item.type === "syndrome").length >= 3) {
            return {
                ok: false,
                level: "info",
                message: localize("DX3rd.SyndromeLimitThree")
            };
        }

        return { ok: true };
    }

    function getOwnedItemCreateData({ type = "item", effectType, roisType } = {}) {
        const key = `DX3rd.${type.charAt(0).toUpperCase()}${type.slice(1)}`;
        const typeLabel = game.i18n.localize(key);
        const itemData = {
            name: format("DX3rd.NewItemName", {type: typeLabel !== key ? typeLabel : type}),
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

        const active = !!checked;
        // Each item's toggle is an independent state. Even when an effect belongs to a combo, the effect's toggle
        // must not turn the combo's active.state on or off, and whether a member effect persists is decided solely
        // by that effect's own active.state.
        if (!!item.system?.active?.state !== active) {
            await item.update({ "system.active.state": active });
        }

        // Only the non-toggle AEs created on use and the legacy applied entries are cleaned up first. Toggle AEs are
        // kept or deleted by the sync below, according to each item's independent active.state.
        if (!active) {
            await window.DX3rdAppliedEffects?.removeByItem?.(actor, item.id, { includeToggle: false });
        }

        // The persistent modifiers of effect/spell/psionic/combo are converted into AEs by AppliedToggle.
        // Waiting only for the item update hook would let the next roll read derived values from before the AE was
        // created, so the in-flight sync is awaited too and a roll right after toggling sees the same state.
        await window.DX3rdAppliedToggle?.sync?.(actor);

        // An effect sheet opened separately from the actor sheet's row may not re-render immediately from item.update
        // alone. The same source document is redrawn so both checkboxes always show the identical active.state and
        // source AE state.
        const itemSheet = item.sheet;
        if (itemSheet?.rendered) {
            if (window.DX3rdApplicationCompat?.requestRender) {
                await window.DX3rdApplicationCompat.requestRender(itemSheet);
            } else {
                itemSheet.render(false);
            }
        }
        return item;
    }

    async function updateOwnedItemEquipmentState(actor, itemId, checked) {
        const item = getOwnedItem(actor, itemId);
        if (!item) return null;

        const equipped = !!checked;
        if (item.type === "vehicle" && equipped) {
            const updates = actor.items
                .filter(other => other.type === "vehicle" && other.id !== itemId && other.system?.equipment === true)
                .map(other => ({
                    _id: other.id,
                    "system.equipment": false,
                    ...(other.system?.active?.state === true ? {"system.active.state": false} : {})
                }));
            if (updates.length) await actor.updateEmbeddedDocuments("Item", updates);
        }

        // The equipped flag and the self-modifier active state are settled in one document update. Leaving it to the
        // updateItem hook alone would let the actor sheet render before the hook's asynchronous second update, so
        // derived values such as the guard value could show the previous state. The hook then sees that the target
        // state is already reached and carries on with the remaining activation work (macros, target effects, …).
        const update = { "system.equipment": equipped };
        if (!equipped && item.system?.active?.state === true) {
            update["system.active.state"] = false;
        } else if (
            equipped
            && window.DX3rdItemEffectAdapter?.usesActivationSelfChannel?.(item)
            && item.system?.active?.disable !== "notCheck"
            && item.system?.active?.state !== true
        ) {
            update["system.active.state"] = true;
        }
        await item.update(update);
        // Some Foundry versions have AppV2 read the parent Actor's previously prepared system right after an embedded
        // Item update. Re-preparing from the stored source immediately settles the armor / guard display.
        actor.reset?.();
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

    // The attribute / skill roll dispatch and the combo builder delegation. The previous sheets and the AppV2 actor sheet share this path.
    function openComboBuilder(actor, targetType, targetId) {
        const handler = window.DX3rdUniversalHandler;
        if (!handler?.openComboBuilder) {
            ui.notifications.error(format("DX3rd.HandlerMissing", {name: "ComboBuilder"}));
            return Promise.resolve();
        }
        return handler.openComboBuilder(actor, targetType, targetId);
    }

    function showStatRoll(actor, targetType, targetId, anchor = null) {
        const handler = window.DX3rdUniversalHandler;
        if (!handler?.showStatRollConfirmDialog) {
            ui.notifications.error(format("DX3rd.HandlerMissing", {name: "UniversalHandler"}));
            return;
        }
        handler.showStatRollConfirmDialog(
            actor,
            targetType,
            targetId,
            (type, id) => openComboBuilder(actor, type, id),
            null,
            anchor
        );
    }

    // The drag / drop sorting dispatch. The previous sheets and the AppV2 actor sheet share this path.
    function buildItemDragData(actor, item) {
        if (!actor || !item) return null;
        return {
            type: 'Item',
            uuid: item.uuid,
            actorId: actor.id,
            itemId: item.id,
            itemType: item.type,
            sortValue: item.sort || 0
        };
    }

    // Reordering items within the same actor (sort). Returns true when a sort was performed.
    async function sortOwnedItem(actor, data, targetEl) {
        const target = targetEl?.closest?.('[data-item-id]');
        if (!target) return false;

        const sourceItem = actor.items.get(data.itemId);
        const targetItem = actor.items.get(target.dataset.itemId);
        if (!sourceItem || !targetItem || sourceItem.id === targetItem.id || sourceItem.type !== targetItem.type) return false;

        const siblings = actor.items.filter(i => i.type === sourceItem.type && i.id !== sourceItem.id);
        const performIntegerSort = foundry.utils?.performIntegerSort
            || foundry.utils?.SortingHelpers?.performIntegerSort
            || SortingHelpers.performIntegerSort;
        const sortUpdates = performIntegerSort(sourceItem, { target: targetItem, siblings });
        await actor.updateEmbeddedDocuments('Item', sortUpdates.map(u => ({ _id: u.target.id, sort: u.update.sort })));
        return true;
    }

    // An external item drop → created after the per-type limit check. Returns the created item, or null when blocked.
    async function createDroppedItem(actor, item) {
        if (!item) return null;

        if (['spell', 'psionic', 'book'].includes(item.type) && !game.settings.get('dx3rd-emanim', 'stageCRC')) {
            ui.notifications.warn(localize('DX3rd.StageCRCItemsAddDisabled'));
            return null;
        }
        if (item.type === 'works' && actor.items.filter(i => i.type === 'works').length >= 1) {
            ui.notifications.info(localize('DX3rd.WorksLimitOne'));
            return null;
        }
        if (item.type === 'syndrome' && actor.items.filter(i => i.type === 'syndrome').length >= 3) {
            ui.notifications.info(localize('DX3rd.SyndromeLimitThree'));
            return null;
        }

        const created = await actor.createEmbeddedDocuments('Item', [item.toObject()]);
        return created?.[0] || null;
    }

    // Open the skill creation / edit dialog. The previous sheets and the AppV2 actor sheet share this path.
    // The dialog is ApplicationV2-based, so it takes no buttons/default settings (the class renders them itself).
    function openCreateSkillDialog(actor, abilityId) {
        if (!window.DX3rdSkillCreateDialog) {
            ui.notifications.error(format("DX3rd.HandlerMissing", {name: "DX3rdSkillCreateDialog"}));
            return;
        }
        const options = getCreateSkillDialogOptions(actor, abilityId);
        if (!options) return;
        new window.DX3rdSkillCreateDialog(options).render(true);
    }

    function openEditSkillDialog(actor, skillId) {
        if (!window.DX3rdSkillEditDialog) {
            ui.notifications.error(format("DX3rd.HandlerMissing", {name: "DX3rdSkillEditDialog"}));
            return;
        }
        const options = getEditSkillDialogOptions(actor, skillId);
        if (!options) return;
        new window.DX3rdSkillEditDialog(options).render(true);
    }

    // Turning a Lois into a Titus. The previous sheets and the AppV2 actor sheet share this path.
    // handleTitus is called directly, just as the chat 'use' button does (DX3rdRoisHandler.handle).
    // Going through handleItemUse charges the cost gate again and double-runs instant macros, so the direct call is used everywhere.
    function useTitus(actor, item) {
        if (!window.DX3rdRoisHandler?.handleTitus) {
            ui.notifications.error(localize("DX3rd.RoisHandlerMissing"));
            return Promise.resolve();
        }
        return window.DX3rdRoisHandler.handleTitus(actor.id, item.id);
    }

    // The gate before printing an item to chat (permission only). The previous sheets and the AppV2 actor sheet share this path.
    // The raw send (_sendItemToChat → DX3rdActorChat) is also used directly by external callers (combat-ui/action-ui),
    // so this only returns the gate decision and the sheet performs the send.
    //
    // Exhaustion is not blocked here. Printing to chat is "showing information" (left-clicking the name / the
    // right-click menu), not an actual use — not even being able to show an exhausted effect's card would make its
    // effect text and range unreadable. Blocking on exhaustion is the job of the real use path (the use-count check in
    // UniversalHandler.handleItemUse), so pressing the card's 'use' button is still refused properly without a gate here.
    function checkItemChatGate(actor, item) {
        if (!actor || !item) {
            return { ok: false, level: "warn", message: game.i18n.localize("DX3rd.NoPermission") };
        }
        if (!actor.isOwner && !game.user.isGM) {
            return { ok: false, level: "warn", message: game.i18n.localize("DX3rd.NoPermission") };
        }
        return { ok: true };
    }

    // The item use / attack roll dispatch. Today it is an AppV2-sheet-only button, but a single test path is secured
    // in preparation for V2 becoming the default (unifying on the direct UniversalHandler call).
    function useItem(actor, item, roisAction = undefined, getTarget = undefined, options = {}) {
        const handler = window.DX3rdUniversalHandler;
        if (!handler?.handleItemUse) {
            ui.notifications.error(format("DX3rd.HandlerMissing", {name: "UniversalHandler"}));
            return Promise.resolve(false);
        }
        if (!actor || !item) return Promise.resolve(false);
        return handler.handleItemUse(actor.id, item.id, item.type, roisAction, getTarget, options);
    }

    function attackRoll(actor, item) {
        const handler = window.DX3rdUniversalHandler;
        if (!handler?.handleAttackRoll) {
            ui.notifications.error(format("DX3rd.HandlerMissing", {name: "UniversalHandler"}));
            return Promise.resolve();
        }
        if (!actor || !item) return Promise.resolve();
        return handler.handleAttackRoll(actor, item);
    }

    // Target-tab effects and self-effect-tab effects are applied separately. When you are the target and both exist,
    // UniversalHandler offers a target-effect / self-effect selection menu.
    function applyItemEffect(actor, item, options = {}) {
        const handler = window.DX3rdUniversalHandler;
        if (!handler?.applyChosenItemEffect) {
            ui.notifications.error(format("DX3rd.HandlerMissing", {name: "UniversalHandler"}));
            return Promise.resolve();
        }
        if (!actor || !item) return Promise.resolve();
        return handler.applyChosenItemEffect(actor, item, options);
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

    // The effect tab (system.attributes) and the target tab (system.effect.attributes) are distinguished.
    // 0 and false are valid effect values too, so the test is whether something was entered, not the value's truthiness.
    function hasUsableEffectAttributes(attributes) {
        return Object.values(attributes || {}).some(attribute =>
            attribute?.key && attribute.key !== "-" && String(attribute.value ?? "").trim() !== ""
        );
    }

    // The active toggle only means something for an "always-on self effect" kept independently of equipping and using.
    // For equipment the equipment checkbox is the source, for a non-always item the use action is the firing point,
    // and target effects run through the apply-effect path, so all of those are hidden.
    // An activated Lois: it fires from a left-click 'use' (the same UX as an effect or a usable item).
    //  - it holds an embedded macro (roisActivate and the like), or
    //  - it has self-buff attributes and an expiry timing (active.disable) set (major and the like — it expires after firing).
    // An always-on buff (active.disable is '-'/'notCheck') is treated as an always-on toggle rather than an activated one.
    function roisHasActivation(item) {
        if (!item || item.type !== "rois") return false;
        const macros = item.system?.macros;
        if (Array.isArray(macros) && macros.some(m => m && m.command)) return true;
        if (hasUsableEffectAttributes(item.system?.attributes)) {
            const disable = item.system?.active?.disable ?? "-";
            if (disable !== "-" && disable !== "notCheck") return true;
        }
        return false;
    }

    // The fallback used only when the adapter is absent. Keeping two copies of the test rule would let them diverge
    // subtly and produce an effect with "no toggle and no firing on use", so normally only the adapter is asked.
    function activationSelfChannelFallback(item) {
        if (item?.system?.active?.action === "activation") return true;
        if ((item?.system?.active?.applyMode || "onUse") === "toggle") return true;
        if (item?.type !== "effect" || item.system?.timing !== "always") return false;
        const attackRoll = item.system?.attackRoll;
        if (attackRoll && attackRoll !== "-") return false;
        return !hasUsableEffectAttributes(item.system?.effect?.attributes);
    }

    // The active toggle only means something for an item whose self modifiers are on the 'activation' channel.
    // For equipment the equipment checkbox is the source, and an item whose firing point is the use action, or a
    // target effect, runs through its own path, so all of those are hidden. Even when it is not always-on, authoring
    // the self modifiers as 'activation' makes the toggle the firing / release channel — with an expiry timing of '-'
    // there is no automatic release, so without a toggle it could never be turned off once on.
    // An activated Lois: it fires from a left-click 'use' (the same UX as an effect or a usable item).
    function usesSelfEffectActiveToggle(item) {
        if (!item || ["weapon", "protect", "vehicle"].includes(item.type)) return false;
        // A Lois (a D-Lois and the like) has no timing field and so falls outside the adapter's always-on test. When it
        // authors its own "always" buff (attributes) the toggle is exposed; an activated one (macro / expiry timing) is excluded.
        // The calculation goes through the same actor.js own-computation channel as equipment.
        if (item.type === "rois") return hasUsableEffectAttributes(item.system?.attributes) && !roisHasActivation(item);
        const adapter = window.DX3rdItemEffectAdapter;
        // A card bound to the 활성화 action needs a state to switch, whether or not the item also carries modifier
        // rows. Requiring self modifiers first meant an effect whose only authored card was "create a weapon on
        // activation" had no toggle anywhere — so active.state could never flip, and the activation router (which
        // is what runs those cards) never fired. The card said 활성화 and activating it did nothing, because there
        // was nothing to activate with.
        if (adapter?.hasActionEffects?.(item, 'activation')) return true;
        // With no modifiers to draw and nothing bound to activation, a toggle is meaningless.
        if (!hasUsableEffectAttributes(item.system?.attributes)) return false;
        return adapter ? adapter.usesActivationSelfChannel(item) : activationSelfChannelFallback(item);
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

        // A render-only flag. It is never stored on the Item document data.
        item.showActiveToggle = usesSelfEffectActiveToggle(item);
        item.showRoisUse = roisHasActivation(item);
        if (item.system.used.disable === "notCheck") {
            item.system.used.displayMax = 0;
            if (item.system.used.level !== false) item.system.used.level = false;
            return;
        }

        let maxValue = item.system.used.max || 0;
        if (item.type === "once") maxValue = item.system.quantity || 1;

        if (item.system.used.level === true && item.type === "effect") {
            const finalLevel = window.DX3rdEffectLevel
                ? window.DX3rdEffectLevel.value(item, actor)
                : Number(item.system.level?.init) || 0;
            maxValue += finalLevel;
        } else if (item.system.used.level === true && item.type === "psionic") {
            maxValue += item.system.level?.init || 0;
        }

        item.system.used.displayMax = maxValue;
    }

    function categorizeItem(actorData, item) {
        // An improvised combo that has been used lives on only as the source document for follow-up / persistent effects.
        // Exposing it for reselection or editing like an ordinary combo would let the same temporary document be reused as a separate action.
        if (window.DX3rdIsInstantCombo?.(item)) return;
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

        const appliedSource = window.DX3rdAppliedEffects?.collect
            ? window.DX3rdAppliedEffects.collect(actor)
            : (actor.system.attributes.applied ?? {});
        // An AE can be both the item's modifier effect and the marker for what that item created — the two used to
        // be separate documents with the same name and image, so "the effect" the user deleted was whichever one
        // the list happened to show. Now the payload rides on the applied AE when there is one, and the row says so.
        const grantHosts = window.DX3rdUniversalHandler?.grantPayload
            ? actor.effects.filter(effect => window.DX3rdUniversalHandler.grantPayload(effect))
            : [];
        const grantedAppliedKeys = new Set(grantHosts
            .map(effect => effect.getFlag?.("dx3rd-emanim", "appliedKey"))
            .filter(Boolean));
        actorData.applied = Object.entries(appliedSource).map(([appliedKey, appliedEffect], index) => ({
            _id: appliedKey,
            name: appliedEffect.name || "알 수 없는 효과",
            img: appliedEffect.img || "icons/svg/aura.svg",
            system: {
                description: generateAppliedEffectDescription(appliedEffect, appliedKey)
            },
            disable: appliedEffect.disable || "-",
            enabled: !appliedEffect._disabled,
            // Removing this row also takes back what the item created (the payload is on this very document).
            hasGrant: grantedAppliedKeys.has(appliedKey),
            appliedEffect
        }));

        // Only the markers that could NOT be folded into an applied row get their own row — a create-only effect
        // has no modifier AE to ride on, and fist grants stack, so one item can own several. They are a different
        // kind of document (no applied key, no modifiers) and offer removal only: disabling one deliberately does
        // nothing (see the marker contract in universal-extensions.js), so a toggle here would be a lie.
        actorData.grants = grantHosts
            .filter(effect => !effect.getFlag?.("dx3rd-emanim", "appliedKey"))
            .map(effect => ({
                _id: effect.id,
                name: effect.name || game.i18n.localize("DX3rd.Effect"),
                img: effect.img || "icons/svg/sword.svg",
                description: game.i18n.localize(
                    window.DX3rdUniversalHandler.grantPayload(effect)?.kind === "fist"
                        ? "DX3rd.GrantFistDescription"
                        : "DX3rd.GrantItemDescription")
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
            itemData.system.level.value = Number(itemData.system.level.init || 0)
                + encLevel
                + (window.DX3rdEffectLevel?.bonus(actor) || 0);
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
        hasUsableEffectAttributes,
        usesSelfEffectActiveToggle,
        roisHasActivation,
        showStatRoll,
        openComboBuilder,
        buildItemDragData,
        sortOwnedItem,
        createDroppedItem,
        openCreateSkillDialog,
        openEditSkillDialog,
        useTitus,
        checkItemChatGate,
        useItem,
        attackRoll,
        applyItemEffect,
        prepareCharacterItems,
        generateAppliedEffectDescription,
        prepareSheetData
    };
})();
