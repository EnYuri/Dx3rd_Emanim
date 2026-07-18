/**
 * Double Cross 3rd shared item-sheet data
 */
(function() {
    const DialogV2 = foundry.applications?.api?.DialogV2;

    function localize(key) {
        return game.i18n.localize(key);
    }

    function cloneSystem(system) {
        return foundry.utils.deepClone(system || {});
    }

    function prepareSystem(item, {system = null, clone = false} = {}) {
        const prepared = clone ? cloneSystem(system ?? item?.system) : (system || {});

        prepared.actorSkills = item?.actor?.system?.attributes?.skills || {};
        prepared.skills ??= {};
        prepared.used ??= {
            state: 0,
            max: 0,
            level: false,
            disable: 'notCheck'
        };
        prepared.saving ??= {
            value: 0,
            difficulty: '0'
        };
        prepared.equipment ??= true;

        if (item?.type === 'effect') {
            prepared.level ??= {};
            prepared.level.init ??= 0;
            prepared.level.max ??= 0;
            prepared.level.value ??= 0;
        }

        return prepared;
    }

    function prepareSheetData(item, data) {
        data.dtypes = ['String', 'Number', 'Boolean'];
        data.system = prepareSystem(item, {system: data.system || {}});
        return data;
    }

    async function enrichDescription(item, description) {
        const TextEditorClass = foundry.applications?.ux?.TextEditor?.implementation;
        if (!TextEditorClass) return description || '';

        return TextEditorClass.enrichHTML(description || '', {
            secrets: item.isOwner,
            rollData: item.getRollData()
        });
    }

    async function prepareAppV2Context(item, context) {
        const system = prepareSystem(item, {clone: true});
        const enrichedDescription = await enrichDescription(item, system.description);

        return Object.assign(context, {
            item,
            system,
            enrichedDescription,
            dtypes: ['String', 'Number', 'Boolean']
        });
    }

    async function enrichSheetData(item, data) {
        if (data.system.description === undefined) {
            data.system.description = item.system?.description || '';
        }

        if (window.DX3rdDescriptionManager) {
            return window.DX3rdDescriptionManager.enrichSheetData(data, item);
        }

        return data;
    }

    function prepareSkillOptions(item, data, sheetType, {includeActorType = false, warnIfMissing = false} = {}) {
        const actor = item?.actor;
        data.system.actorSkills = actor?.system?.attributes?.skills || {};

        const manager = window.DX3rdSkillManager;
        if (manager?.getSkillSelectOptions) {
            data.system.skillOptions = manager.getSkillSelectOptions(
                sheetType,
                data.system.actorSkills,
                includeActorType ? actor?.type : undefined
            );
        } else {
            if (warnIfMissing) console.error('DX3rd | SkillManager not found');
            data.system.skillOptions = [];
        }

        return data.system.skillOptions;
    }

    function prepareActiveData(item, data, {disableFallback = '-', runTimingFallback = 'instant', undefinedOnly = false} = {}) {
        data.system.active ??= {};
        if (undefinedOnly) {
            if (data.system.active.state === undefined) data.system.active.state = item.system?.active?.state || false;
            if (data.system.active.disable === undefined) data.system.active.disable = item.system?.active?.disable || disableFallback;
            if (data.system.active.runTiming === undefined) data.system.active.runTiming = item.system?.active?.runTiming || runTimingFallback;
        } else {
            if (!data.system.active.state) data.system.active.state = item.system?.active?.state || false;
            if (!data.system.active.disable) data.system.active.disable = item.system?.active?.disable || disableFallback;
            if (!data.system.active.runTiming) data.system.active.runTiming = item.system?.active?.runTiming || runTimingFallback;
        }
        return data.system.active;
    }

    function prepareEffectData(item, data, {disableFallback = 'notCheck', runTimingFallback = 'instant', undefinedOnly = false} = {}) {
        data.system.effect ??= {};
        if (undefinedOnly) {
            if (data.system.effect.disable === undefined) data.system.effect.disable = item.system?.effect?.disable || disableFallback;
            if (data.system.effect.runTiming === undefined) data.system.effect.runTiming = item.system?.effect?.runTiming || runTimingFallback;
        } else {
            if (!data.system.effect.disable) data.system.effect.disable = item.system?.effect?.disable || disableFallback;
            if (!data.system.effect.runTiming) data.system.effect.runTiming = item.system?.effect?.runTiming || runTimingFallback;
        }
        return data.system.effect;
    }

    function preserveAttributeData(item, data, {effect = true} = {}) {
        data.system.attributes ??= {};
        if (item.system?.attributes) {
            data.system.attributes = {...item.system.attributes};
        }

        if (effect) {
            data.system.effect ??= {};
            data.system.effect.attributes ??= {};
            if (item.system?.effect?.attributes) {
                data.system.effect.attributes = {...item.system.effect.attributes};
            }
        }

        return data.system.attributes;
    }

    function prepareTargetFlags(item, data) {
        if (data.system.getTarget === undefined) {
            data.system.getTarget = item.system?.getTarget || false;
        }
        if (data.system.scene === undefined) {
            data.system.scene = item.system?.scene || false;
        }
        return {
            getTarget: data.system.getTarget,
            scene: data.system.scene
        };
    }

    function normalizeIdList(value, fallback = []) {
        const source = value ?? fallback ?? [];
        return (Array.isArray(source) ? source : [source]).filter(id => typeof id === 'string' && id && id !== '-');
    }

    function getRollDifficultyToggleUpdate(item, checked) {
        if (checked) {
            return {
                'system.roll': 'major',
                'system.difficulty': ''
            };
        }

        const freepassText = localize('DX3rd.Freepass');
        const currentDifficulty = item.system?.difficulty || '';
        return {
            'system.roll': '-',
            'system.difficulty': (currentDifficulty === freepassText || currentDifficulty === '-') ? currentDifficulty : freepassText,
            'system.attackRoll': '-'
        };
    }

    function getRollChangeUpdate(rollValue) {
        return (rollValue === '-' || rollValue === 'dodge') ? {'system.attackRoll': '-'} : {};
    }

    function isRollDifficultyValueValid(item, value) {
        if (!value) return true;

        const rollValue = item.system?.roll || '-';
        const competitionText = localize('DX3rd.Competition');
        const referenceText = localize('DX3rd.Reference');
        const freepassText = localize('DX3rd.Freepass');

        if (rollValue === '-') return value === freepassText || value === '-';

        const numValue = Number(value);
        return (Number.isInteger(numValue) && numValue >= 1)
            || value === competitionText
            || value === referenceText;
    }

    function getRollDifficultyValidationMessage(item) {
        const rollValue = item.system?.roll || '-';
        const freepassText = localize('DX3rd.Freepass');
        const competitionText = localize('DX3rd.Competition');
        const referenceText = localize('DX3rd.Reference');

        if (rollValue === '-') {
            return `판정이 비활성화된 경우 난이도는 "${freepassText}" 또는 "-"만 입력할 수 있습니다.`;
        }
        return `판정이 활성화된 경우 난이도는 1 이상의 정수, "${competitionText}", 또는 "${referenceText}"만 입력할 수 있습니다.`;
    }

    function prepareEffectLevelData(item, actor = item?.actor, sourceLevel = item?.system?.level || {}) {
        const rawInit = Number(sourceLevel.init ?? 0);
        const rawMax = Number(sourceLevel.max ?? 1);
        const init = Number.isFinite(rawInit) ? rawInit : 0;
        const max = Number.isFinite(rawMax) ? rawMax : 1;
        const upgrade = Boolean(sourceLevel.upgrade);
        const encroachmentLevel = upgrade ? Number(actor?.system?.attributes?.encroachment?.level) || 0 : 0;

        return {
            ...sourceLevel,
            init,
            max,
            upgrade,
            value: init + encroachmentLevel
        };
    }

    function preparePsionicLevelData(item, sourceLevel = item?.system?.level || {}) {
        const rawInit = Number(sourceLevel.init ?? 1);
        const rawMax = Number(sourceLevel.max ?? 1);
        const init = Number.isFinite(rawInit) ? rawInit : 1;
        const max = Number.isFinite(rawMax) ? rawMax : 1;

        return {
            ...sourceLevel,
            init,
            max,
            value: init
        };
    }

    function getEmbeddedMacros(item) {
        return Array.isArray(item?.system?.macros) ? foundry.utils.deepClone(item.system.macros) : [];
    }

    function createEmbeddedMacro() {
        // kind: 'code'(인라인 코드) | 'macro'(월드 매크로 이름참조). 기본은 코드.
        return {timing: 'instant', kind: 'code', command: '', macroName: '', disabled: false};
    }

    // 월드 매크로 이름 목록(임베드 행의 '월드 매크로' 드롭다운 채움용, 이름순)
    function getWorldMacroOptions() {
        return (game.macros?.contents || [])
            .map(m => ({name: m.name}))
            .sort((a, b) => a.name.localeCompare(b.name));
    }

    // 레거시 단일 매크로 필드(system.macro = "[이름][이름]…" 월드 매크로 이름참조)를
    // 임베드 매크로 행(kind:'macro')으로 1회 이관하고 필드를 비운다. 대괄호 참조가 없으면 손대지 않음.
    async function migrateLegacyMacroField(item) {
        const raw = item?.system?.macro;
        if (!raw || typeof raw !== 'string') return null;
        const names = (raw.match(/\[([^\]]+)\]/g) || []).map(s => s.slice(1, -1).trim()).filter(Boolean);
        if (names.length === 0) return null;
        const macros = getEmbeddedMacros(item);
        let changed = false;
        for (const name of names) {
            if (macros.some(m => m.kind === 'macro' && m.macroName === name)) continue; // 중복 이관 방지
            const wm = game.macros?.getName(name);
            const timing = wm?.getFlag?.('dx3rd-emanim', 'runTiming') || 'instant';
            macros.push({timing, kind: 'macro', command: '', macroName: name, disabled: false});
            changed = true;
        }
        if (!changed) {
            // 참조가 모두 이미 이관됨 → 남은 필드만 비운다.
            await item.update({'system.macro': ''});
            return macros;
        }
        await item.update({'system.macros': macros, 'system.macro': ''});
        return macros;
    }

    async function addEmbeddedMacro(item) {
        const macros = getEmbeddedMacros(item);
        macros.push(createEmbeddedMacro());
        await item.update({'system.macros': macros});
        return macros;
    }

    async function removeEmbeddedMacro(item, index) {
        const macros = getEmbeddedMacros(item);
        if (index < 0 || index >= macros.length) return null;
        macros.splice(index, 1);
        await item.update({'system.macros': macros});
        return macros;
    }

    async function updateEmbeddedMacro(item, index, property, value) {
        const macros = getEmbeddedMacros(item);
        if (!macros[index]) return null;
        macros[index][property] = property === 'disabled' ? Boolean(value) : value;
        await item.update({'system.macros': macros});
        return macros;
    }

    const macroSupportedTypes = ['effect', 'combo', 'spell', 'psionic', 'weapon', 'protect', 'vehicle', 'book', 'once', 'etc'];
    // 임베드 매크로(system.macros[]) UI를 제공하는 타입. 이들은 월드 매크로 드롭·이름참조도 임베드 행으로 통합한다.
    // 즉시 효과 탭(parts/immediate-effects-v2.html)의 매크로 섹션을 노출하는 타입 전체.
    const embedMacroTypes = ['effect', 'weapon', 'etc', 'vehicle', 'protect', 'once', 'combo', 'spell', 'psionic'];

    async function handleMacroDrop(item, event, {fallback = null, fallbackOnInvalidData = false} = {}) {
        let data;
        try {
            data = JSON.parse(event.dataTransfer?.getData?.('text/plain') || '');
        } catch (err) {
            return fallbackOnInvalidData ? fallback?.() : undefined;
        }

        if (data.type !== 'Macro') {
            return fallback?.();
        }

        if (!macroSupportedTypes.includes(item.type)) {
            ui.notifications.warn(localize('DX3rd.MacroNotSupported') || '이 아이템 타입은 매크로를 지원하지 않습니다.');
            return undefined;
        }

        const macro = await fromUuid(data.uuid);
        if (!macro) return undefined;

        // 임베드 매크로 UI를 쓰는 타입(이펙트)은 드롭을 임베드 행(kind:'macro')으로 추가한다.
        if (embedMacroTypes.includes(item.type)) {
            const macros = getEmbeddedMacros(item);
            if (macros.some(m => m.kind === 'macro' && m.macroName === macro.name)) {
                ui.notifications.info(localize('DX3rd.MacroAlreadyAdded') || '이미 추가된 매크로입니다.');
                return undefined;
            }
            const timing = macro.getFlag?.('dx3rd-emanim', 'runTiming') || 'instant';
            macros.push({timing, kind: 'macro', command: '', macroName: macro.name, disabled: false});
            await item.update({'system.macros': macros});
            ui.notifications.info(game.i18n.format('DX3rd.MacroAdded', {name: macro.name}) || `매크로 "${macro.name}"이(가) 추가되었습니다.`);
            return true;
        }

        // 그 외 타입: 레거시 단일 필드에 이름참조 추가(기존 동작 보존).
        const macroText = `[${macro.name}]`;
        const currentMacro = item.system.macro || '';
        if (currentMacro.includes(macroText)) {
            ui.notifications.info(localize('DX3rd.MacroAlreadyAdded') || '이미 추가된 매크로입니다.');
            return undefined;
        }

        await item.update({
            'system.macro': currentMacro ? `${currentMacro} ${macroText}` : macroText
        });

        ui.notifications.info(game.i18n.format('DX3rd.MacroAdded', {name: macro.name}) || `매크로 "${macro.name}"이(가) 추가되었습니다.`);
        return true;
    }

    async function confirmDeleteSkill(name) {
        if (!DialogV2?.confirm) {
            ui.notifications.error(game.i18n.localize('DX3rd.DialogV2Unavailable'));
            return false;
        }

        return DialogV2.confirm({
            window: {title: localize('DX3rd.DeleteSkill')},
            content: `<p>${game.i18n.format('DX3rd.ConfirmDeleteSkill', {name})}</p>`,
            yes: {
                icon: '<i class="fas fa-trash"></i>',
                label: localize('DX3rd.Delete')
            },
            no: {
                icon: '<i class="fas fa-times"></i>',
                label: localize('DX3rd.Cancel')
            },
            defaultYes: false
        });
    }

    async function deleteSkillEntry(item, skillKey, {allowAttributes = false} = {}) {
        if (!item || !skillKey) return false;

        const targetType = item.system.skills?.[skillKey]
            ? 'skills'
            : allowAttributes && item.system.attributes?.[skillKey]
                ? 'attributes'
                : null;
        const targetItem = targetType ? item.system[targetType]?.[skillKey] : null;
        if (!targetItem) {
            console.warn('DX3rd | No item sheet entry found with key:', skillKey);
            return false;
        }

        if (targetType === 'attributes') {
            await item.update({
                [`system.${targetType}.-=${skillKey}`]: null
            });
            return true;
        }

        const confirmed = await confirmDeleteSkill(targetItem.name || skillKey);
        if (!confirmed) return false;

        await item.update({
            [`system.${targetType}.-=${skillKey}`]: null
        });
        return true;
    }

    const itemSheetData = Object.freeze({
        prepareSheetData,
        prepareAppV2Context,
        enrichSheetData,
        prepareSkillOptions,
        prepareActiveData,
        prepareEffectData,
        preserveAttributeData,
        prepareTargetFlags,
        normalizeIdList,
        getRollDifficultyToggleUpdate,
        getRollChangeUpdate,
        isRollDifficultyValueValid,
        getRollDifficultyValidationMessage,
        prepareEffectLevelData,
        preparePsionicLevelData,
        getEmbeddedMacros,
        addEmbeddedMacro,
        removeEmbeddedMacro,
        updateEmbeddedMacro,
        getWorldMacroOptions,
        migrateLegacyMacroField,
        handleMacroDrop
    });

    // AppV2 시트가 사용하는 공용 데이터·대화상자 API만 노출한다.
    window.DX3rdItemSheetDialogs = { confirmDeleteSkill, deleteSkillEntry };
    window.DX3rdItemSheetData = itemSheetData;
})();
