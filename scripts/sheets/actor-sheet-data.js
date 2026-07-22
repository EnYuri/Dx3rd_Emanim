/**
 * Shared actor sheet data preparation for 이전 시트 and AppV2 sheets.
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

        // getUserLevel 은 INHERIT 를 이미 기본 권한으로 풀어서 돌려준다.
        // (actor.permission 은 "현재 사용자"의 권한 레벨 숫자이므로 user 별 조회에 쓸 수 없다.)
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
        // 각 아이템의 토글은 독립 상태다. 이펙트가 콤보에 포함되어 있더라도 이펙트
        // 토글이 콤보의 active.state를 켜거나 끄면 안 되며, 구성 이펙트의 지속 여부도
        // 해당 이펙트 자신의 active.state만 결정한다.
        if (!!item.system?.active?.state !== active) {
            await item.update({ "system.active.state": active });
        }

        // 사용 시 생성된 비-toggle AE와 레거시 applied만 먼저 정리한다. toggle AE는
        // 아래 sync가 각 아이템의 독립 active.state를 보고 toggle AE를 유지 또는 삭제한다.
        if (!active) {
            await window.DX3rdAppliedEffects?.removeByItem?.(actor, item.id, { includeToggle: false });
        }

        // effect/spell/psionic/combo의 지속 보정은 AppliedToggle이 AE로 변환한다.
        // 아이템 갱신 훅만 기다리면 다음 판정이 AE 생성 전의 파생치를 읽을 수 있으므로,
        // 사용자가 토글 직후 판정해도 같은 상태를 보도록 진행 중인 동기화까지 대기한다.
        await window.DX3rdAppliedToggle?.sync?.(actor);

        // 액터 시트의 행과 별도로 열려 있는 이펙트 시트는 item.update만으로 즉시
        // 재렌더되지 않을 수 있다. 같은 원본 문서를 다시 그려 두 체크박스가 항상
        // 동일한 active.state/출처 AE 상태를 표시하게 한다.
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

    // 능력/스킬 굴림 dispatch와 콤보 빌더 위임. 이전 시트/AppV2 액터 시트가 같은 경로를 쓴다.
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

    // 드래그/드롭 정렬 dispatch. 이전 시트/AppV2 액터 시트가 같은 경로를 쓴다.
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

    // 같은 액터 내 아이템 순서 변경(sort). 정렬을 수행했으면 true.
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

    // 외부 아이템 드롭 → 타입별 제한 체크 후 생성. 생성한 아이템을 반환하고, 막혔으면 null.
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

    // 스킬 생성/편집 다이얼로그 오픈. 이전 시트/AppV2 액터 시트가 같은 경로를 쓴다.
    // 다이얼로그는 ApplicationV2 기반이라 buttons/default 설정은 받지 않는다(클래스가 자체 렌더).
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

    // 로이스 Titus화. 이전 시트/AppV2 액터 시트가 같은 경로를 쓴다.
    // 채팅 '사용' 버튼(DX3rdRoisHandler.handle)과 동일하게 handleTitus를 직접 호출한다.
    // handleItemUse 경유 시 비용 게이트 추가 부과 + instant 매크로 이중 실행 문제가 있어 직접 호출로 통일.
    function useTitus(actor, item) {
        if (!window.DX3rdRoisHandler?.handleTitus) {
            ui.notifications.error(localize("DX3rd.RoisHandlerMissing"));
            return Promise.resolve();
        }
        return window.DX3rdRoisHandler.handleTitus(actor.id, item.id);
    }

    // 아이템을 채팅으로 출력하기 전 게이트(권한 + 사용횟수 소진). 이전 시트/AppV2 액터 시트가 같은 경로를 쓴다.
    // raw 전송(_sendItemToChat → DX3rdActorChat)은 외부 호출자(combat-ui/action-ui)도 직접 쓰므로
    // 여기서는 게이트 판정만 반환하고 전송은 시트가 수행한다.
    function checkItemChatGate(actor, item) {
        if (!actor || !item) {
            return { ok: false, level: "warn", message: game.i18n.localize("DX3rd.NoPermission") };
        }
        if (!actor.isOwner && !game.user.isGM) {
            return { ok: false, level: "warn", message: game.i18n.localize("DX3rd.NoPermission") };
        }
        if (window.DX3rdItemExhausted?.isItemExhausted(item)) {
            return { ok: false, level: "warn", message: format("DX3rd.ItemExhausted", {name: item.name}) };
        }
        return { ok: true };
    }

    // 아이템 사용/공격 굴림 dispatch. 현재는 AppV2 시트 전용 버튼이지만,
    // V2 default 승격을 대비해 단일 테스트 경로를 확보한다(UniversalHandler 직접 호출 통일).
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

    // 대상 탭 효과와 자기 효과 탭을 구분해 적용한다. 자신이 타겟이고 둘 다 있으면
    // UniversalHandler가 대상 효과/자기 효과 선택 메뉴를 제공한다.
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

    // 효과 탭(system.attributes)과 대상 탭(system.effect.attributes)을 구분한다.
    // 0과 false도 유효한 효과값이므로, 값의 진실값이 아닌 입력 여부로 판단한다.
    function hasUsableEffectAttributes(attributes) {
        return Object.values(attributes || {}).some(attribute =>
            attribute?.key && attribute.key !== "-" && String(attribute.value ?? "").trim() !== ""
        );
    }

    // 활성 토글은 장착/사용과 별개로 유지되는 '상시 자기 효과'에만 의미가 있다.
    // 장비는 equipment 체크가 원본이고, 상시가 아닌 아이템은 사용 액션이 발동점이며,
    // 대상 효과는 효과 적용 경로로 실행하므로 모두 숨긴다.
    function usesSelfEffectActiveToggle(item) {
        if (!item || ["weapon", "protect", "vehicle"].includes(item.type)) return false;
        // 로이스(D로이스 등)는 timing 필드가 없다. 자체 상시 버프(attributes)가 저작돼 있으면
        // 활성/비활성 토글을 노출한다. 계산은 장비와 동일한 actor.js 자체계산 채널을 탄다.
        if (item.type === "rois") return hasUsableEffectAttributes(item.system?.attributes);
        if (item.system?.timing !== "always") return false;
        // 백병/사격 공격 이펙트는 지속 버프가 아니라 즉시 공격력 보정 채널이므로 토글을 숨긴다.
        const attackRoll = item.system?.attackRoll;
        if (attackRoll && attackRoll !== "-") return false;
        const hasSelfEffect = hasUsableEffectAttributes(item.system?.attributes);
        const hasTargetEffect = hasUsableEffectAttributes(item.system?.effect?.attributes);
        if (!hasSelfEffect || hasTargetEffect) return false;
        return !window.DX3rdItemEffectAdapter
            || window.DX3rdItemEffectAdapter.extensionActionMatches(item, "selfModifiers", item.system?.active || {}, "activation", item.system?.active?.runTiming || "instant");
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

        // 렌더 전용 플래그다. Item 문서 데이터에는 저장되지 않는다.
        item.showActiveToggle = usesSelfEffectActiveToggle(item);
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

        const appliedSource = window.DX3rdAppliedEffects?.collect
            ? window.DX3rdAppliedEffects.collect(actor)
            : (actor.system.attributes.applied ?? {});
        actorData.applied = Object.entries(appliedSource).map(([appliedKey, appliedEffect], index) => ({
            _id: appliedKey,
            name: appliedEffect.name || "알 수 없는 효과",
            img: appliedEffect.img || "icons/svg/aura.svg",
            system: {
                description: generateAppliedEffectDescription(appliedEffect, appliedKey)
            },
            disable: appliedEffect.disable || "-",
            enabled: !appliedEffect._disabled,
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
