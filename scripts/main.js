/**
 * The main script of the Double Cross 3rd system
 */

/**
 * Run an urge check / panic check. The two differ only in localization keys and the check flag; the procedure is identical.
 * The check uses the Will skill, falling back to the Mind attribute when absent, and raises encroachment by 2d10 afterwards.
 * @param {'urge'|'panic'} kind        which check
 * @param {Actor} fallbackCharacter    the actor to use when no token is selected
 */


// Sample system settings
Hooks.once('init', async function() {
    
    // Setting: the Pressure exception item list (an item with the auto timing can still emit a chat message)
    game.settings.register('dx3rd-emanim', 'DX3rd.PressureExceptionItems', {
        name: 'DX3rd.PressureExceptionItems',
        hint: 'DX3rd.PressureExceptionItemsHint',
        scope: 'world',
        config: true,
        type: String,
        default: '',
        onChange: value => {
        }
    });
    
    // Setting: the berserk reaction exception item list (an item with the reaction timing can still be used)
    game.settings.register('dx3rd-emanim', 'DX3rd.BerserkReactionExceptionItems', {
        name: 'DX3rd.BerserkReactionExceptionItems',
        hint: 'DX3rd.BerserkReactionExceptionItemsHint',
        scope: 'world',
        config: true,
        type: String,
        default: '',
        onChange: value => {
        }
    });

    // The initial display state of an item chat card's details / description
    game.settings.register('dx3rd-emanim', 'expandChatItemCards', {
        name: 'DX3rd.ExpandChatItemCards',
        hint: 'DX3rd.ExpandChatItemCardsHint',
        scope: 'world',
        config: true,
        type: Boolean,
        default: true,
        onChange: value => {
            document.querySelectorAll('#chat-log .dx3rd-item-chat .collapsible-content, .chat-log .dx3rd-item-chat .collapsible-content')
                .forEach(element => {
                    element.classList.toggle('collapsed', !value);
                    element.style.display = value ? '' : 'none';
                });
        }
    });

    // Attack automation is closer to a per-user feel for play, so it is a client setting.
    // With the automatic accuracy roll off, using a weapon creates only the card first and the card's accuracy-roll button proceeds.
    game.settings.register('dx3rd-emanim', 'autoAttackRoll', {
        name: 'DX3rd.AutoAttackRoll',
        hint: 'DX3rd.AutoAttackRollHint',
        scope: 'client',
        config: true,
        type: Boolean,
        default: true
    });

    // When on, the damage calculation dialog opens right after the accuracy result card is created.
    // The actual application after that is confirmed uses the same shared path as the manual damage button.
    game.settings.register('dx3rd-emanim', 'autoDamageRoll', {
        name: 'DX3rd.AutoDamageRoll',
        hint: 'DX3rd.AutoDamageRollHint',
        scope: 'client',
        config: true,
        type: Boolean,
        default: false
    });
    
    // Should an item / effect whose uses are spent be blocked?
    // The default is **not to block** — the automation is still being refined, and being unable to use an effect
    // on the spot because one use count in the compendium is wrong would stop the session.
    // The warning and the exhausted marking still remain, so the GM does not miss the fact.
    game.settings.register('dx3rd-emanim', 'allowExhaustedUse', {
        name: 'DX3rd.AllowExhaustedUse',
        hint: 'DX3rd.AllowExhaustedUseHint',
        scope: 'world',
        config: true,
        type: Boolean,
        default: true
    });

    // The usage condition gates — the same basis as the exhaustion gate (the default warns rather than blocks).
    // Reading is done in one place by helpers' DX3rdUsageGates and reporting / blocking by universal-handler's
    // reportUsageGate. Adding a setting here means the key MUST be registered in both of those too —
    // a setting with nowhere reading it becomes "the setting does not work".
    game.settings.register('dx3rd-emanim', 'allowResurrectViolation', {
        name: 'DX3rd.AllowResurrectViolation',
        hint: 'DX3rd.AllowResurrectViolationHint',
        scope: 'world',
        config: true,
        type: Boolean,
        default: true
    });

    game.settings.register('dx3rd-emanim', 'allowEncroachLimitViolation', {
        name: 'DX3rd.AllowEncroachLimitViolation',
        hint: 'DX3rd.AllowEncroachLimitViolationHint',
        scope: 'world',
        config: true,
        type: Boolean,
        default: true
    });

    game.settings.register('dx3rd-emanim', 'allowBerserkViolation', {
        name: 'DX3rd.AllowBerserkViolation',
        hint: 'DX3rd.AllowBerserkViolationHint',
        scope: 'world',
        config: true,
        type: Boolean,
        default: true
    });

    game.settings.register('dx3rd-emanim', 'allowPressureViolation', {
        name: 'DX3rd.AllowPressureViolation',
        hint: 'DX3rd.AllowPressureViolationHint',
        scope: 'world',
        config: true,
        type: Boolean,
        default: true
    });

    game.settings.register('dx3rd-emanim', 'allowDefenseBypassViolation', {
        name: 'DX3rd.AllowDefenseBypassViolation',
        hint: 'DX3rd.AllowDefenseBypassViolationHint',
        scope: 'world',
        config: true,
        type: Boolean,
        default: true
    });

    // Setting: the AfterMain queue (stored in the world)
    // v13/v14 compatibility: type: Array can warn in v14, so it is handled defensively
    game.settings.register('dx3rd-emanim', 'afterMainQueue', {
        scope: 'world',
        config: false, // not shown in the UI
        type: Array,
        default: []
    });
    
    // Register the Combat class
    CONFIG.Combat.documentClass = DX3rdCombat;
    CONFIG.Combatant.documentClass = DX3rdCombatant;
    
    // Register the Handlebars helpers (excluding those already registered in helpers.js)
    Handlebars.registerHelper('spelltype', function(type) {
        if (type === "-") {
            return type;
        }
        return game.i18n.localize(`DX3rd.${type.charAt(0).toUpperCase() + type.slice(1)}`);
    });

    Handlebars.registerHelper('disable', function(disable) {
        if (!disable || disable === '-') {
            return '-';
        }
        
        // notCheck should never have been applied in the first place, so it is special-cased
        if (disable === 'notCheck') {
            return game.i18n.localize('DX3rd.NotCheck');
        }
        
        // Build the localization key (with the After prefix)
        // afterRoll → AfterRoll, afterMajor → AfterMajor
        const disableKey = `DX3rd.After${disable.charAt(0).toUpperCase() + disable.slice(1)}`;
        
        // Try to localize
        const localized = game.i18n.localize(disableKey);
        
        // Localization failed (a missing key returns the key itself)
        if (localized === disableKey) {
            console.warn(`DX3rd | Disable localization key not found: ${disableKey}`);
            return disable; // return the original value
        }
        
        return localized;
    });

    Handlebars.registerHelper('itemType', function(type) {
        if (type === "-") {
            return type;
        }
        return game.i18n.localize(`DX3rd.${type.charAt(0).toUpperCase() + type.slice(1)}`);
    });

    // The helper for the Attributes options
    Handlebars.registerHelper('attributeOptions', function(selectedValue) {
        const options = [
            { value: "-", label: "-" },
            { value: "attack", label: "DX3rd.Attack" },
            { value: "dice", label: "DX3rd.Dice" },
            { value: "critical", label: "DX3rd.Critical" },
            { value: "critical_min", label: "DX3rd.CriticalMin" },
            { value: "add", label: "DX3rd.Add" },
            { value: "hp", label: "DX3rd.HP" },
            { value: "init", label: "DX3rd.Init" },
            { value: "armor", label: "DX3rd.Armor" },
            { value: "guard", label: "DX3rd.Guard" },
            { value: "penetrate", label: "DX3rd.Penetrate" },
            { value: "reduce", label: "DX3rd.ReduceDamage" },
            { value: "saving_max", label: "DX3rd.Saving" },
            { value: "stock_point", label: "DX3rd.Stock" },
            { value: "battleMove", label: "DX3rd.BattleMove" },
            { value: "fullMove", label: "DX3rd.FullMove" },
            { value: "major_dice", label: "DX3rd.MajorDice" },
            { value: "major_add", label: "DX3rd.MajorAdd" },
            { value: "major_critical", label: "DX3rd.MajorCritical" },
            { value: "reaction_dice", label: "DX3rd.ReactionDice" },
            { value: "reaction_add", label: "DX3rd.ReactionAdd" },
            { value: "reaction_critical", label: "DX3rd.ReactionCritical" },
            { value: "dodge_dice", label: "DX3rd.DodgeDice" },
            { value: "dodge_add", label: "DX3rd.DodgeAdd" },
            { value: "dodge_critical", label: "DX3rd.DodgeCritical" },
            { value: "stat_bonus", label: "DX3rd.StatBonus" },
            { value: "stat_add", label: "DX3rd.StatAdd" },
            { value: "stat_dice", label: "DX3rd.StatDice" },
            { value: "effect_level", label: "DX3rd.EffectLevelBonus" },
            { value: "cast_dice", label: "DX3rd.CastingDice" },
            { value: "cast_add", label: "DX3rd.CastingAdd" }
        ];

        // Check the stageCRC setting
        const stageCRCEnabled = game.settings.get("dx3rd-emanim", "stageCRC");

        let html = '';
        options.forEach(option => {
            // Skip cast_dice and cast_add when stageCRC is disabled
            if (!stageCRCEnabled && (option.value === 'cast_dice' || option.value === 'cast_add')) {
                return;
            }
            
            const selected = option.value === selectedValue ? 'selected' : '';
            html += `<option value="${option.value}" ${selected}>${game.i18n.localize(option.label)}</option>`;
        });
        
        return new Handlebars.SafeString(html);
    });

    // Per-row modifier condition: the row contributes only while the condition holds on the
    // actor carrying the modifier (DX3rdRuntimeUtils.modifierConditionHolds). 'badStatus' is a
    // pseudo-key meaning "any bad status"; the rest name system.conditions keys.
    Handlebars.registerHelper('modifierConditionOptions', function(selectedValue) {
        const options = [
            { value: '', label: 'DX3rd.ConditionNone' },
            { value: 'badStatus', label: 'DX3rd.BadStatus' },
            { value: 'berserk', label: 'DX3rd.Berserk' },
            { value: 'hatred', label: 'DX3rd.Hatred' },
            { value: 'fear', label: 'DX3rd.Fear' },
            { value: 'rigor', label: 'DX3rd.Rigor' },
            { value: 'pressure', label: 'DX3rd.Pressure' },
            { value: 'dazed', label: 'DX3rd.Dazed' },
            { value: 'poisoned', label: 'DX3rd.Poisoned' },
            { value: 'stealth', label: 'DX3rd.Stealth' },
            { value: 'fly', label: 'DX3rd.Fly' },
            { value: 'boarding', label: 'DX3rd.Boarding' },
            { value: 'healing', label: 'DX3rd.Healing' },
            { value: 'defeated', label: 'DX3rd.Defeated' },
            { value: 'action_end', label: 'DX3rd.ActionEnd' },
            { value: 'action_delay', label: 'DX3rd.ActionDelay' },
            { value: 'extra-turn', label: 'DX3rd.ExtraTurn' }
        ];
        let html = '';
        for (const option of options) {
            const selected = option.value === (selectedValue || '') ? 'selected' : '';
            html += `<option value="${option.value}" ${selected}>${game.i18n.localize(option.label)}</option>`;
        }
        return new Handlebars.SafeString(html);
    });

    Handlebars.registerHelper('usedFull', function(used, max) {
        return used && used.state >= max;
    });

    Handlebars.registerHelper('usedFullForCombo', function(actor, combo) {
        return combo && combo.system && combo.system.used && combo.system.used.state >= combo.system.used.max;
    });
    
    // Are an item's uses fully spent? (a weapon checks both used and attack-used; a combo checks its included effects)
    Handlebars.registerHelper('isItemExhausted', function(item, actor) {
        // Temporarily attach the actor info from the template data to the item
        if (actor && !item.actor) {
            // Convert to a Foundry actor object
            let foundryActor = null;
            if (actor.id) {
                foundryActor = game.actors.get(actor.id);
            } else if (actor._id) {
                foundryActor = game.actors.get(actor._id);
            }
            
            if (foundryActor) {
                // Work on a copy so the original object is not modified
                const itemCopy = foundry.utils.deepClone(item);
                itemCopy.actor = foundryActor;
                return window.DX3rdItemExhausted?.isItemExhausted(itemCopy) || false;
            }
        }
        return window.DX3rdItemExhausted?.isItemExhausted(item) || false;
    });

    Handlebars.registerHelper('usedMax', function(used, max) {
        return used && used.max ? used.max : max;
    });

    // A helper that converts a numeric value safely
    Handlebars.registerHelper('safeNumber', function(value) {
        const num = Number(value);
        return isNaN(num) ? 0 : num;
    });

    // A helper that adds two values
    Handlebars.registerHelper('add', function(value1, value2) {
        const num1 = Number(value1) || 0;
        const num2 = Number(value2) || 0;
        return num1 + num2;
    });

    Handlebars.registerHelper('ifIn', function(array, value, options) {
        try {
            let list;
            if (Array.isArray(array)) list = array;
            else if (array && typeof array === 'object') list = Object.values(array);
            else if (typeof array === 'string') list = [array];
            else list = [];
            return list.includes(value) ? options.fn(this) : options.inverse(this);
        } catch (_) {
            return options.inverse(this);
        }
    });

    Handlebars.registerHelper('ifEquals', function(arg1, arg2, options) {
        return (arg1 == arg2) ? options.fn(this) : options.inverse(this);
    });

    Handlebars.registerHelper('ifNotEquals', function(arg1, arg2, options) {
        return (arg1 != arg2) ? options.fn(this) : options.inverse(this);
    });

    // Safely read a property from actorSkills / skills for the Works skill display in a template
    // Usage: {{attrSkill actorSkills skills key 'name'}}
    Handlebars.registerHelper('attrSkill', function(actorSkills, skills, key, prop) {
        try {
            const itemSkills = skills || {};
            const baseSkills = actorSkills || {};
            const fromItem = itemSkills[key];
            const fromActor = baseSkills[key];
            const source = fromItem ?? fromActor ?? null;
            if (!source) return '';
            let value = source[prop];
            
            // For the name property, check the customSkills setting
            if (prop === 'name' && typeof value === 'string' && value.startsWith('DX3rd.')) {
                // Extract the skill key (e.g. "DX3rd.rc" -> "rc")
                const skillKey = value.replace('DX3rd.', '');
                
                // Look for a custom name in the customSkills setting
                const customSkills = game.settings.get("dx3rd-emanim", "customSkills") || {};
                
                // A custom name wins when present
                if (customSkills[skillKey]) {
                    value = typeof customSkills[skillKey] === 'object' 
                        ? customSkills[skillKey].name 
                        : customSkills[skillKey];
                } else {
                    // With no custom name, fall back to the default localization
                    value = game.i18n.localize(value);
                }
            }
            
            return (value === undefined || value === null) ? '' : value;
        } catch (e) {
            return '';
        }
    });

    // Register the template helpers
    Handlebars.registerHelper('eq', function(a, b) {
        return a === b;
    });
    
    // Register the system settings
    
    // The skill settings menu
    game.settings.registerMenu('dx3rd-emanim', 'skillsSettingsMenu', {
        name: 'DX3rd.SkillsSettings',
        label: 'DX3rd.ManageSkills',
        hint: '기본 스킬을 관리합니다.',
        icon: 'fas fa-cogs',
        type: window.DX3rdSkillsSettingsDialog,
        restricted: true
    });
    
    // Seed the group-skill categories the official data defines (info / knowledge / driving / art) as standard definitions.
    // Key convention: groupPrefix_romanization (snake_case) — kept in sync with CATEGORY_KEY in _source/mechanics.mjs.
    // base: info=social, knowledge=mind, driving=body, art=sense (matching the skills-settings-dialog placeholder mapping).
    const DEFAULT_CATEGORY_SKILLS = {
        info_web:        { name: '정보: 웹',        base: 'social' },
        info_police:     { name: '정보: 경찰',      base: 'social' },
        info_rumor:      { name: '정보: 소문',      base: 'social' },
        info_study:      { name: '정보: 학문',      base: 'social' },
        info_academia:   { name: '정보: 아카데미아', base: 'social' },
        info_underworld: { name: '정보: 뒷세계',    base: 'social' },
        info_media:      { name: '정보: 미디어',    base: 'social' },
        info_ugn:        { name: '정보: UGN',       base: 'social' },
        info_business:   { name: '정보: 비즈니스',  base: 'social' },
        info_fh:         { name: '정보: FH',        base: 'social' },
        info_military:   { name: '정보: 군사',      base: 'social' },
        info_hero:       { name: '정보: 히어로',    base: 'social' },
        info_villain:    { name: '정보: 빌런',      base: 'social' },
        know_renegade:   { name: '지식: 레니게이드', base: 'mind' },
        know_engineering:{ name: '지식: 기계공학',  base: 'mind' },
        know_occult:     { name: '지식: 오컬트',    base: 'mind' },
        know_general:    { name: '지식:',            base: 'mind' },
        drive_bike:      { name: '운전: 2륜',       base: 'body' },
        drive_car:       { name: '운전: 4륜',       base: 'body' },
        drive_aircraft:  { name: '운전: 항공기',    base: 'body' },
        drive_ship:      { name: '운전: 선박',      base: 'body' },
        drive_horse:     { name: '운전: 말',        base: 'body' },
        drive_spacecraft:{ name: '운전: 우주선',    base: 'body' },
        drive_multitank: { name: '운전: 다각전차',  base: 'body' },
        drive_walker:    { name: '운전: 다족병기',  base: 'body' },
        drive_general:   { name: '운전:',            base: 'body' },
        info_general:    { name: '정보:',            base: 'social' },
        ars_music:       { name: '예술: 음악',      base: 'sense' }
    };
    window.DX3rdDefaultCategorySkills = DEFAULT_CATEGORY_SKILLS;
    game.settings.register('dx3rd-emanim', 'customSkills', {
        name: 'Custom Skills',
        hint: '커스텀 스킬 설정을 저장합니다.',
        scope: 'world',
        config: false,
        type: Object,
        default: DEFAULT_CATEGORY_SKILLS
    });
    
    game.settings.register('dx3rd-emanim', 'defaultEncroachmentType', {
        name: 'DX3rd.EncroachmentRule',
        hint: '새 캐릭터의 기본 침식도 타입을 설정합니다.',
        scope: 'world',
        config: true,
        type: String,
        choices: {
            '-': 'DX3rd.EncroachmentCore',
            'ea': 'DX3rd.EncroachmentEA',
            'origin': 'DX3rd.EncroachmentOrigin'
        },
        default: '-'
    });

    game.settings.register('dx3rd-emanim', 'stageCRC', {
        name: 'DX3rd.StageCRC',
        hint: 'CRC 스테이지를 활성화 합니다.',
        scope: 'world',
        config: true,
        type: Boolean,
        default: false
    });

    game.settings.register('dx3rd-emanim', 'entryEncroachment', {
        name: 'DX3rd.EntryEncroachment',
        hint: 'CRC 등장 침식치 규칙을 적용합니다.',
        scope: 'world',
        config: true,
        type: Boolean,
        default: false
    });

    // Verbose debug logging. Kept off normally; turned on only to trace an item use / damage flow.
    game.settings.register('dx3rd-emanim', 'debugLogging', {
        name: 'DX3rd.DebugLogging',
        hint: '아이템 사용·확장·데미지 처리 과정의 상세 로그를 콘솔에 출력합니다. 문제 추적용이며 평소에는 꺼두세요.',
        scope: 'client',
        config: true,
        type: Boolean,
        default: false,
        onChange: () => window.DX3rdDebug?.invalidate()
    });

    // The scene-opening number (for the GM, not exposed in the settings UI)
    game.settings.register('dx3rd-emanim', 'sceneOpenNumber', {
        scope: 'world',
        config: false,
        type: Number,
        default: 0
    });

    game.settings.register('dx3rd-emanim', 'defaultCritical', {
        name: 'DX3rd.DefaultCriticalValue',
        hint: '기본 크리티컬 값을 설정합니다.',
        scope: 'world',
        config: true,
        type: Number,
        choices: {
            10: '10',
            11: '11'
        },
        default: 10
    });

    game.settings.register('dx3rd-emanim', 'simplifiedDistance', {
        name: 'DX3rd.SimplifiedDistance',
        hint: '간이 거리 계산식을 사용합니다.',
        scope: 'world',
        config: true,
        type: Boolean,
        default: false
    });
    
    game.settings.register('dx3rd-emanim', 'deathMarkIcon', {
        name: 'DX3rd.DeathMarkIcon',
        hint: '전투불능(dead) 상태일 때 토큰 위에 표시할 아이콘을 설정합니다.',
        scope: 'world',
        config: true,
        type: String,
        filePicker: 'image',
        default: 'icons/svg/skull.svg'
    });

    game.settings.register('dx3rd-emanim', 'reducePoison', {
        name: 'DX3rd.ReducePoison',
        hint: '이 설정을 활성화 할 경우, 사독 데미지가 경감됩니다.',
        scope: 'world',
        config: true,
        type: Boolean,
        default: false
    });

    game.settings.register('dx3rd-emanim', 'rangeHighlightColor', {
        name: 'DX3rd.RangeHighlightColor',
        hint: '기본 색상(녹색) 대신 사용자 색상을 사용합니다.',
        scope: 'world',
        config: true,
        type: Boolean,
        default: false
    });

    // The chat font setting — registered in the ready hook, after the font list is available

    Handlebars.registerHelper('startsWith', function(str, prefix) {
        return typeof str === 'string' && str.startsWith(prefix);
    });

    // A custom helper that suppresses the v13 {{#select}} warning.
    // Default behavior: inject selected into the option inside the block whose value matches the selection
    // Note: implemented separately so Foundry core's warning logger is never called
    try {
        Handlebars.unregisterHelper && Handlebars.unregisterHelper('select');
    } catch (e) {}
    Handlebars.registerHelper('select', function(selected, options) {
        try {
            const raw = options.fn(this);
            const esc = Handlebars.escapeExpression(selected ?? '');
            const pattern = new RegExp('(value=\\"' + esc.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\$&') + '\\")');
            const replaced = raw.replace(pattern, '$1 selected');
            return new Handlebars.SafeString(replaced);
        } catch (err) {
            return options.fn(this);
        }
    });

    // Guard against a core error from ProseMirror's "save" button.
    // A toggled editor is destroyOnSave, so saving IS view.destroy(), yet
    // ProseMirrorMenu._onAction unconditionally calls this.view.focus() after running the command.
    // A destroyed view has a null docView, so selectionToDOM throws a TypeError —
    // the save itself has already finished so nothing breaks, but the error is logged every time.
    // It is swallowed only for a destroyed view; an error from a live editor is rethrown as-is.
    const ProseMirrorMenu = foundry.prosemirror?.ProseMirrorMenu || globalThis.ProseMirror?.ProseMirrorMenu;
    if (ProseMirrorMenu?.prototype?._onAction) {
        const onAction = ProseMirrorMenu.prototype._onAction;
        ProseMirrorMenu.prototype._onAction = function(event) {
            try {
                return onAction.call(this, event);
            } catch (err) {
                if (this.view?.docView) throw err;
                window.DX3rdDebug?.log('DX3rd | ProseMirror menu action on a destroyed view', err);
            }
        };
    }
});

// Add the Scene Control buttons
Hooks.on('preCreateActor', (document, data, options, userId) => {
    // Handle the character and enemy types only
    if (data.type !== 'character' && data.type !== 'enemy') {
        return;
    }
    
    const updates = {};
    
    // 0. For the enemy type, set actorType to Troop (matching the dialog's option value)
    if (data.type === 'enemy') {
        const currentActorType = foundry.utils.getProperty(data, 'system.actorType');
        if (!currentActorType || currentActorType === 'NPC' || currentActorType === 'PlayerCharacter') {
            updates['system.actorType'] = 'Troop';
        }
    }
    
    // 1. Set up prototypeToken (actorLink defaults to true)
    if (data.prototypeToken?.actorLink === undefined) {
        updates['prototypeToken.actorLink'] = true;
        updates['prototypeToken.bar1'] = { attribute: 'attributes.hp' };
        if (data.type === 'character') {
            updates['prototypeToken.bar2'] = { attribute: 'attributes.encroachment' };
        }
    }
    
    // 2. Guarantee the required properties of the default skills
    const defaultSkillBases = {
        melee: 'body', evade: 'body',
        ranged: 'sense', perception: 'sense',
        rc: 'mind', will: 'mind', cthulhu: 'mind',
        negotiation: 'social', procure: 'social'
    };
    
    for (const [skillKey, base] of Object.entries(defaultSkillBases)) {
        const skillPath = `system.attributes.skills.${skillKey}`;
        const existingSkill = foundry.utils.getProperty(data, skillPath);
        
        if (existingSkill) {
            // Check the required properties
            if (existingSkill.point === undefined) {
                updates[`${skillPath}.point`] = 0;
            }
            if (existingSkill.bonus === undefined) {
                updates[`${skillPath}.bonus`] = 0;
            }
            if (existingSkill.extra === undefined) {
                updates[`${skillPath}.extra`] = 0;
            }
            if (existingSkill.base === undefined) {
                updates[`${skillPath}.base`] = base;
            }
            if (existingSkill.delete === undefined) {
                updates[`${skillPath}.delete`] = false;
            }
        }
    }
    
    if (Object.keys(updates).length > 0) {
        document.updateSource(updates);
    }
});

// Preload the sheet and dialog templates.
// On remote hosting (the Forge and the like) the fetch on a template's first use is a real network round trip,
// so it becomes a visible delay the first time a sheet or dialog opens. Preloading removes that delay.
// Deliberately not awaited — it fills in the background without holding up world startup, and a template not yet
// fetched still loads on demand as before, so a failure here has no effect on functionality.
// Add any new template to this list too (the same convention as PARTIALS in item-effect-adapter.js).
const DX3RD_PRELOAD_TEMPLATES = [
    'systems/dx3rd-emanim/templates/actor/actor-sheet-v2.html',
    'systems/dx3rd-emanim/templates/item/active-item-sheet-v2.html',
    'systems/dx3rd-emanim/templates/item/book-sheet-v2.html',
    'systems/dx3rd-emanim/templates/item/combo-sheet-v2.html',
    'systems/dx3rd-emanim/templates/item/connection-sheet-v2.html',
    'systems/dx3rd-emanim/templates/item/effect-workspace-sheet-v2.html',
    'systems/dx3rd-emanim/templates/item/psionic-sheet-v2.html',
    'systems/dx3rd-emanim/templates/item/record-sheet-v2.html',
    'systems/dx3rd-emanim/templates/item/rois-sheet-v2.html',
    'systems/dx3rd-emanim/templates/item/spell-sheet-v2.html',
    'systems/dx3rd-emanim/templates/item/syndrome-sheet-v2.html',
    'systems/dx3rd-emanim/templates/item/works-sheet-v2.html',
    'systems/dx3rd-emanim/templates/dialog/after-main-queue-manager.html',
    'systems/dx3rd-emanim/templates/dialog/damage-calc-dialog.html',
    'systems/dx3rd-emanim/templates/dialog/defense-dialog.html',
    'systems/dx3rd-emanim/templates/dialog/effect-recovery-dialog.html',
    'systems/dx3rd-emanim/templates/dialog/equipment-selection-dialog.html',
    'systems/dx3rd-emanim/templates/dialog/item-extend-dialog.html',
    'systems/dx3rd-emanim/templates/dialog/skill-create-dialog.html',
    'systems/dx3rd-emanim/templates/dialog/skill-edit-dialog.html',
    'systems/dx3rd-emanim/templates/dialog/skills-settings-dialog.html',
    'systems/dx3rd-emanim/templates/dialog/spell-selection-dialog.html',
    'systems/dx3rd-emanim/templates/dialog/sublimation-dialog.html',
    'systems/dx3rd-emanim/templates/dialog/weapon-for-attack-dialog.html',
    // Below are the ones whose paths the code assembles from variables (actor-edit-dialogs / enemy-stat-dialogs).
    'systems/dx3rd-emanim/templates/dialog/ability-dialog.html',
    'systems/dx3rd-emanim/templates/dialog/actor-type-dialog.html',
    'systems/dx3rd-emanim/templates/dialog/armor-dialog.html',
    'systems/dx3rd-emanim/templates/dialog/evasion-dialog.html',
    'systems/dx3rd-emanim/templates/dialog/hp-dialog.html',
    'systems/dx3rd-emanim/templates/dialog/init-dialog.html',
    'systems/dx3rd-emanim/templates/dialog/move-dialog.html'
];

Hooks.once('ready', () => {
    const loadTemplatesCompat = foundry.applications?.handlebars?.loadTemplates;
    if (typeof loadTemplatesCompat !== 'function') return;
    Promise.resolve(loadTemplatesCompat(DX3RD_PRELOAD_TEMPLATES))
        .catch(e => console.warn('DX3rd | Template preload skipped:', e));
});

// Script loading check
Hooks.once('ready', async function() {
    // When an existing world has already stored customSkills, changing setting.default alone does not add the new
    // standard skills. User-defined entries are preserved and only the missing official keys are filled in by the GM.
    if (game.user.isGM && window.DX3rdDefaultCategorySkills) {
        const current = game.settings.get('dx3rd-emanim', 'customSkills') || {};
        const merged = {...window.DX3rdDefaultCategorySkills, ...current};
        if (Object.keys(merged).length !== Object.keys(current).length) {
            await game.settings.set('dx3rd-emanim', 'customSkills', merged);
        }
    }
    if (!window.DX3rdSkillCreateDialog || !window.DX3rdSkillEditDialog) {
        console.error('Double Cross 3rd | 스킬 다이얼로그 클래스가 로드되지 않았습니다.');
        ui.notifications.error('Double Cross 3rd | 시스템 초기화 중 오류가 발생했습니다.');
    }
    
    if (!window.DX3rdEquipmentSelectionDialog) {
        console.error('Double Cross 3rd | 장비 선택 다이얼로그 클래스가 로드되지 않았습니다.');
        ui.notifications.error('Double Cross 3rd | 시스템 초기화 중 오류가 발생했습니다.');
    }
    
    // GM only: initialize the afterDamage storage
    if (game.user.isGM) {
        window.DX3rdAfterDamageActivationQueue = {};
        window.DX3rdAfterDamageExtensionQueue = {};  // initialize the extension queue
    }
    
    // Register the global chat toggle listener
    DX3rdChatToggleManager.initialize();
    
    // Register the Disable Hooks chat commands
    
    // Before a chat message is created, adjust the speaker according to the settings
    Hooks.on('preCreateChatMessage', (doc, data) => {
        try {
            // Applies only to messages created on this client
            if (data.author && data.author !== game.user.id) return;
            
            const content = data.content || '';
            // Flags come first. Existing / external messages are identified by content and the structured flag is backfilled onto the new document.
            const messageTypes = window.DX3rdChatMessageTypes;
            const messageType = messageTypes.ensureFlag(doc, data);
            if ([
                messageTypes.TYPES.CONDITION,
                messageTypes.TYPES.HEALING,
                messageTypes.TYPES.DAMAGE,
                messageTypes.TYPES.POISON_CHECK
            ].includes(messageType)) {
                return;
            }

            // For a roll-type message, or one containing a system button, where the actor is already
            // explicitly set as the speaker, the change is ignored
            // (attack rolls, stat rolls, damage rolls, the damage-roll button, the apply-damage button, …)
            const isRollMessage = messageType === messageTypes.TYPES.ROLL || data.rolls?.length > 0;
            const hasSystemButton = messageType === messageTypes.TYPES.SYSTEM_ACTION;
            
            if ((isRollMessage || hasSystemButton) && data.speaker && data.speaker.actor) {
                const speakerActor = game.actors.get(data.speaker.actor);
                if (speakerActor) {
                    return; // keep the actor speaker already set
                }
            }

        } catch (e) {
            console.warn('DX3rd | preCreateChatMessage speaker adjust failed:', e);
        }
    });


    // On scene opening, show the dedicated "scene entry" dialog to the checked users (no urge / panic buttons)
    function showSceneEnterDialogOnly() {
        const dialog = document.createElement("div");
        dialog.id = "dx3rd-scene-enter-dialog";
        dialog.className = "dx3rd-urge-dialog";
        dialog.innerHTML = `
            <div class="dx3rd-urge-dialog-title">${game.i18n.localize("DX3rd.EnterSceneQuestion")}</div>
            <div class="dx3rd-urge-dialog-buttons">
                <button type="button" id="dx3rd-scene-enter-ok" class="dx3rd-urge-dialog-button">${game.i18n.localize("DX3rd.EnterScene")}</button>
                <hr class="dx3rd-urge-dialog-divider">
                <button type="button" id="dx3rd-scene-enter-cancel" class="dx3rd-urge-dialog-button dx3rd-urge-dialog-cancel">${game.i18n.localize("DX3rd.Cancel")}</button>
            </div>
        `;
        // A second scene opening would stack the dialogs and duplicate the id.
        // The lookup below would then grab the old dialog's button and the visible one would go dead, so it is cleared first.
        document.querySelectorAll("#dx3rd-scene-enter-dialog").forEach(el => el.remove());
        document.body.appendChild(dialog);

        const runEnterScene = async () => {
            const character = game.user.character;
            if (!character) {
                ui.notifications.warn("플레이어 캐릭터가 설정되지 않았습니다.");
                return;
            }
            await dx3rdApplyEntryEncroachment(character);
        };

        // Scope the lookup to this dialog (never query the whole document).
        dialog.querySelector("#dx3rd-scene-enter-ok").addEventListener("click", async () => {
            dialog.remove();
            await runEnterScene();
        });
        dialog.querySelector("#dx3rd-scene-enter-cancel").addEventListener("click", () => dialog.remove());
    }

    // Register the socket handlers: the actual system socket reception is owned solely by DX3rdSocketRouter.
    const socketRouter = window.DX3rdSocketRouter;
    if (!socketRouter) {
        console.error('DX3rd | Socket router is unavailable.');
        return;
    }
    const findSocketActor = actorId => game.actors.get(actorId)
        || canvas.tokens?.placeables?.find(token => token.actor?.id === actorId)?.actor
        || null;
    const isAuthorizedActorRequest = (data, actorId) => {
        if (!data.senderId) return true; // compatibility with older clients
        const actor = findSocketActor(actorId);
        const authorized = Boolean(actor && socketRouter.canUserControlActor(data.senderId, actor));
        if (!authorized) console.warn(`DX3rd | Unauthorized socket request ignored: ${data.type} (${data.senderId} → ${actorId})`);
        return authorized;
    };
    socketRouter.register(async (data) => {

        // A defense report can reach this GM before the attacker's registration does — the two
        // travel on different senders' sockets, and the report path is identical for both queues.
        // processDamageReportPayload records into whichever queue entries exist and match;
        // bufferReportIfAnyQueueMissing keeps the report for the sibling registration that has
        // not arrived yet (or for a request that may never register — it ages out in runtime-utils).
        async function processDamageReportPayload(payload) {
            const { attackerId, itemId, damageRequestId, targetActorId, targetTokenId, hpChange, attackHit } = payload;
            const queueKey = damageRequestId;
            const extensionRequest = window.DX3rdAfterDamageExtensionQueue?.[queueKey];
            const extensionMatches = extensionRequest
                && extensionRequest.attackerId === attackerId
                && extensionRequest.itemId === itemId;
            if (extensionMatches) {
                const report = window.DX3rdRuntimeUtils.recordAfterDamageReport(extensionRequest, {
                    targetTokenId,
                    targetActorId,
                    hpChange,
                    attackHit
                });
                if (report.accepted && report.complete && !extensionRequest.processing) {
                    extensionRequest.processing = true;
                    try {
                        await window.DX3rdUniversalHandler?.processAfterDamageExtensionRequest?.(extensionRequest);
                    } catch (error) {
                        console.error('DX3rd | AfterDamage extension request failed:', error);
                    } finally {
                        // A partially applied extension request is not safe to retry automatically.
                        delete window.DX3rdAfterDamageExtensionQueue[queueKey];
                        window.DX3rdUniversalHandler?.releaseAfterDamageRequestExpiry?.(queueKey);
                    }
                }
            }
            const request = window.DX3rdAfterDamageActivationQueue?.[queueKey];
            const requestMatches = request
                && request.attackerId === attackerId
                && request.itemId === itemId;

            if (requestMatches) {
                const report = window.DX3rdRuntimeUtils.recordAfterDamageReport(request, {
                    targetTokenId,
                    targetActorId,
                    hpChange,
                    attackHit
                });

                // Have every target reported?
                // **What is counted is the number of targets that reported, not the number of reports.** When the same
                // target reports twice (a resend, a double click) the counter runs ahead and `===` never holds, leaving
                // that request in the queue and blocking the next registration.
                if (report.accepted && report.complete && !request.processing) {
                    request.processing = true;
                    try {
                    // The targets that took HP damage
                    const damagedReports = Object.entries(request.damageReports)
                        .filter(([, hp]) => hp > 0);
                    const damagedTokenIds = damagedReports.map(([tokenId]) => tokenId);
                    const damagedTargets = [...new Set(damagedReports
                        .map(([tokenId]) => request.reportActorIds[tokenId])
                        .filter(Boolean))];
                    const hitTokenIds = Object.entries(request.hitReports || {})
                        .filter(([, hit]) => hit === true)
                        .map(([tokenId]) => tokenId);
                    const hitTargets = [...new Set(hitTokenIds
                        .map(tokenId => request.reportActorIds[tokenId])
                        .filter(Boolean))];

                    const attacker = game.actors.get(attackerId);
                    const currentItem = attacker?.items.get(itemId);
                    const usedDisable = currentItem?.system?.used?.disable || 'notCheck';

                    // damagedTargets is an array of Actor IDs, so convert to Actor objects.
                    // Built once here — both the combo afterDamage work and the preparation
                    // riders' damage-triggered buckets resolve against the same list.
                    const damagedActors = damagedTokenIds.map(tokenId => canvas.tokens.get(tokenId)?.actor)
                        .filter(Boolean);
                    for (const actorId of damagedTargets) {
                        const damagedActor = game.actors.get(actorId);
                        if (damagedActor && !damagedActors.some(candidate => candidate.id === damagedActor.id)) {
                            damagedActors.push(damagedActor);
                        }
                    }

                    // Combo afterDamage handling (after the HP damage happened)
                    const comboData = request.comboAfterDamageData;
                    if (comboData && damagedTargets.length > 0) {
                        if (window.DX3rdUniversalHandler) {
                            await window.DX3rdUniversalHandler.processComboAfterDamage(comboData, damagedActors, damagedTokenIds);
                        }
                    } else if (comboData) {
                        // The afterDamage trigger did not fire, but the hidden source no longer has
                        // pending work for this attack. Release it just like a completed trigger.
                        await window.DX3rdInstantComboRetention?.complete?.(attacker, itemId, 'afterDamage');
                    }

                    if (hitTargets.length > 0) {
                        await window.DX3rdUniversalHandler?.processPendingAttackRiders?.(
                            attacker, request.pendingAttackRiders, hitTargets, hitTokenIds);
                        // Combo 'afterHit' buckets fire on attackHit — including a hit reduced
                        // to 0 HP damage — independently of the damaged-target work above.
                        if (comboData && (comboData.hitApplies || []).length > 0) {
                            await window.DX3rdUniversalHandler?.processComboAfterHit?.(
                                comboData, hitTargets, hitTokenIds);
                        }
                    }
                    if (damagedTargets.length > 0) {
                        await window.DX3rdUniversalHandler?.processDamagedAttackRiders?.(
                            attacker, request.pendingAttackRiders, damagedActors);
                    }

                    // 1. Run the macros (if at least one target took HP damage)
                    if (request.shouldExecuteMacro && damagedTargets.length > 0) {
                        window.DX3rdSocketRouter.emitToActorExecutor({
                            type: 'executeAfterDamageMacro',
                            payload: {
                                attackerId: attackerId,
                                itemId: itemId,
                                hpChange: damagedTargets.length
                            }
                        }, attacker);
                    }

                    // 2. Activation / effect application
                    if (damagedTargets.length === 0) {
                        // Nobody took damage: the NoDamage notification
                        window.DX3rdSocketRouter.emitToActorExecutor({
                            type: 'showNoDamageNotification',
                            payload: { attackerId: attackerId }
                        }, attacker);
                    } else if (request.shouldActivate || request.shouldApplyToTargets) {
                        // The originating action already passed the usage gate and spent its count.
                        // This confirmation controls only the optional after-damage effect.
                        const needsConfirmation = request.needsDialog && usedDisable !== 'notCheck';
                        // The attack item's own afterDamage bucket rides the request as a snapshot
                        // frozen at use time — prefer it over re-evaluating on the executor.
                        const attackItemRider = (request.pendingAttackRiders || [])
                            .find(rider => rider?.fromAttackItem === true && rider.itemId === itemId);
                        const frozenTargetAttributes = attackItemRider?.targetAttributes || null;

                        if (needsConfirmation) {
                            // Weapon / vehicle with a use limit: show a dialog
                            window.DX3rdSocketRouter.emitToActorExecutor({
                                type: 'showAfterDamageDialog',
                                payload: {
                                    attackerId: attackerId,
                                    itemId: itemId,
                                    damagedTargets: damagedTargets,
                                    shouldActivate: request.shouldActivate,
                                    shouldApplyToTargets: request.shouldApplyToTargets,
                                    frozenTargetAttributes
                                }
                            }, attacker);
                        } else {
                            // Everything else (weapon / vehicle notCheck included): activate automatically
                            window.DX3rdSocketRouter.emitToActorExecutor({
                                type: 'executeAfterDamageActivation',
                                payload: {
                                    actorId: attackerId,
                                    itemId: itemId,
                                    damagedTargets: damagedTargets,
                                    shouldActivate: request.shouldActivate,
                                    shouldApplyToTargets: request.shouldApplyToTargets,
                                    frozenTargetAttributes
                                }
                            }, attacker);
                        }
                    }

                    } finally {
                        // A partially applied activation request is not safe to retry automatically.
                        delete window.DX3rdAfterDamageActivationQueue[queueKey];
                        window.DX3rdUniversalHandler?.releaseAfterDamageRequestExpiry?.(queueKey);
                    }
                }
            }
        }

        function bufferReportIfAnyQueueMissing(payload) {
            const key = payload?.damageRequestId;
            if (!key) return;
            const extensionPending = Boolean(window.DX3rdAfterDamageExtensionQueue?.[key]);
            const activationPending = Boolean(window.DX3rdAfterDamageActivationQueue?.[key]);
            if (extensionPending && activationPending) return;
            window.DX3rdRuntimeUtils?.bufferEarlyDamageReport?.(payload);
        }

        async function drainEarlyDamageReports(damageRequestId) {
            const early = window.DX3rdRuntimeUtils?.takeEarlyDamageReports?.(damageRequestId) || [];
            for (const earlyPayload of early) {
                await processDamageReportPayload(earlyPayload);
                // The sibling queue may register later — keep the report available for it.
                bufferReportIfAnyQueueMissing(earlyPayload);
            }
        }

        if (data.type === 'showSceneEnterDialog') {
            if (data.userId === game.user.id) {
                showSceneEnterDialogOnly();
            }
            return;
        }

        if (data.type === 'spellRoisSelectRequest') {
            // A Lois selection request (handled by the GM only)
            if (!socketRouter.isResponsibleGM()
                || !window.DX3rdSpellHandler
                || !data.requestData
                || !isAuthorizedActorRequest(data, data.requestData.actorId)) return;
            
            const { actorId, textKey, title, requestType, itemId, availableRois } = data.requestData;
            if (!['spellDisaster4', 'spellCalamity8', 'spellCatastrophe9'].includes(requestType)) return;
            const actor = game.actors.get(actorId);
            if (!actor) {
                console.error('DX3rd | Actor not found for rois select request:', actorId);
                return;
            }
            
            const item = itemId ? actor.items.get(itemId) : null;
            
            // The GM shows the dialog
            const roisItems = (Array.isArray(availableRois) ? availableRois : [])
                .map(reference => actor.items.get(reference?.id))
                .filter(rois => {
                    if (rois?.type !== 'rois' || ['M', 'D', 'E'].includes(rois.system?.type)) return false;
                    const sublimation = rois.system?.sublimation;
                    return ![true, 'true', 1, '1'].includes(sublimation);
                });
            const options = roisItems.map(rois =>
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

            new foundry.applications.api.DialogV2({
                window: { title: title },
                content: template,
                buttons: [
                    {
                        action: 'confirm',
                        icon: 'fas fa-check',
                        label: game.i18n.localize('DX3rd.Confirm'),
                        default: true,
                        callback: async (event, button, dialog) => {
                            const selectedId = dialog.element.querySelector('#rois-select')?.value;
                            if (!selectedId) {
                                ui.notifications.warn('로이스를 선택해주세요.');
                                return;
                            }

                            const selectedRois = actor.items.get(selectedId);
                            if (!selectedRois) {
                                ui.notifications.error('선택한 로이스를 찾을 수 없습니다.');
                                return;
                            }

                            // Find the actor whose name matches the chosen Lois
                            const targetActor = window.DX3rdSpellHandler.findActorByRoisName(selectedRois.name);
                            if (!targetActor) {
                                ui.notifications.error(`"${selectedRois.name}"와 같은 이름을 가진 액터를 찾을 수 없습니다.`);
                                return;
                            }

                            // Handle it according to the request type
                            if (requestType === 'spellDisaster4') {
                                await window.DX3rdSpellHandler.rollSpellDisaster(targetActor, item);
                            } else if (requestType === 'spellCalamity8') {
                                await window.DX3rdSpellHandler.rollSpellCalamity(targetActor, item);
                            } else if (requestType === 'spellCatastrophe9') {
                                await window.DX3rdSpellHandler.rollSpellCatastrophe(targetActor, item);
                            }
                        }
                    },
                    {
                        action: 'cancel',
                        icon: 'fas fa-times',
                        label: game.i18n.localize('DX3rd.Cancel')
                    }
                ]
            }).render(true);
            
            return;
        }
        
        if (data.type === 'cancelAfterDamageRequest') {
            if (!socketRouter.isResponsibleGM()
                || !data.payload
                || !isAuthorizedActorRequest(data, data.payload.targetActorId)) return;
            const { damageRequestId, targetActorId, itemId } = data.payload;
            window.DX3rdUniversalHandler?.discardAfterDamageRequest?.(damageRequestId, {
                targetActorId,
                itemId,
                reason: 'cancelled'
            });
            return;
        }

        if (data.type === 'registerAfterDamageExtension') {
            // A request to register an AfterDamage extension queue entry (handled by the GM only)
            if (!socketRouter.isResponsibleGM()
                || !data.payload
                || !isAuthorizedActorRequest(data, data.payload.attackerId)
                || !Array.isArray(data.payload.targetActorIds)) return;
            
            const { attackerId, itemId, damageRequestId, targetActorIds, targetTokenIds, extensions, triggerItemName } = data.payload;
            const queueKey = damageRequestId;
            
            if (!window.DX3rdAfterDamageExtensionQueue) {
              window.DX3rdAfterDamageExtensionQueue = {};
            }
            
            window.DX3rdAfterDamageExtensionQueue[queueKey] = {
              attackerId: attackerId,
              itemId: itemId,
              damageRequestId,
              targetActorIds: targetActorIds,
              targetTokenIds: targetTokenIds,
              damageReports: {},
              hitReports: {},
              reportActorIds: {},
              reportCount: 0,
              extensions: extensions,
              triggerItemName: triggerItemName,
              createdAt: Date.now()
            };
            window.DX3rdUniversalHandler?.scheduleAfterDamageRequestExpiry?.(damageRequestId);
            // Reports that beat this registration (cross-sender socket ordering) replay now.
            await drainEarlyDamageReports(damageRequestId);

            return;
        }
        
        if (data.type === 'executeAfterDamageMacro') {
            // A request to run an afterDamage macro
            const { attackerId, itemId, targetName, hpChange } = data.payload;
            
            const attacker = game.actors.get(attackerId);
            if (!attacker) {
                console.warn('DX3rd | Attacker not found:', attackerId);
                return;
            }
            
            if (!socketRouter.isActorExecutorMessage(data, attacker)) return;
            
            const item = attacker.items.get(itemId);
            if (item && window.DX3rdUniversalHandler && window.DX3rdUniversalHandler.executeMacros) {
                await window.DX3rdUniversalHandler.executeMacros(item, 'afterDamage');
            }
        } else if (data.type === 'registerAfterDamageActivation') {
            // GM only: register an afterDamage activation request
            if (!socketRouter.isResponsibleGM()
                || !data.payload
                || !isAuthorizedActorRequest(data, data.payload.attackerId)
                || !Array.isArray(data.payload.targetActorIds)) {
                return;
            }
            
            const { attackerId, itemId, damageRequestId, targetActorIds, targetTokenIds, shouldExecuteMacro, shouldActivate, shouldApplyToTargets, needsDialog, comboAfterDamageData, pendingAttackRiders } = data.payload;
            const queueKey = damageRequestId;

            window.DX3rdAfterDamageActivationQueue[queueKey] = {
                attackerId: attackerId,
                itemId: itemId,
                damageRequestId,
                targetActorIds: targetActorIds,
                targetTokenIds: targetTokenIds,
                damageReports: {},
                hitReports: {},
                reportActorIds: {},
                reportCount: 0,
                shouldExecuteMacro: shouldExecuteMacro,
                shouldActivate: shouldActivate,
                shouldApplyToTargets: shouldApplyToTargets,
                needsDialog: needsDialog,
                comboAfterDamageData: comboAfterDamageData, // store the combo data
                pendingAttackRiders: Array.isArray(pendingAttackRiders) ? pendingAttackRiders : [],
                createdAt: Date.now()
            };
            window.DX3rdUniversalHandler?.scheduleAfterDamageRequestExpiry?.(damageRequestId);
            // Reports that beat this registration (cross-sender socket ordering) replay now.
            await drainEarlyDamageReports(damageRequestId);

        } else if (data.type === 'reportDamageForActivation') {
            // GM only: collect the targets' HP change reports
            if (!socketRouter.isResponsibleGM()
                || !data.payload
                || !isAuthorizedActorRequest(data, data.payload.targetActorId)) {
                return;
            }

            await processDamageReportPayload(data.payload);
            // If a sibling queue entry has not registered yet, hold the report for its drain.
            bufferReportIfAnyQueueMissing(data.payload);
        } else if (data.type === 'showAfterDamageDialog') {
            // Attacker: told by the GM to show the afterDamage dialog
            const { attackerId, itemId, damagedTargets, shouldActivate, shouldApplyToTargets, frozenTargetAttributes } = data.payload;
            
            const actor = game.actors.get(attackerId);
            if (!actor) {
                console.warn('DX3rd | Attacker actor not found:', attackerId);
                return;
            }
            
            if (!socketRouter.isActorExecutorMessage(data, actor)) return;
            
            const item = actor.items.get(itemId);
            if (!item) {
                console.warn('DX3rd | Item not found:', itemId);
                return;
            }
            
            // Show the dialog
            if (window.DX3rdUniversalHandler && window.DX3rdUniversalHandler._showAfterDamageDialog) {
                await window.DX3rdUniversalHandler._showAfterDamageDialog(actor, item, damagedTargets, shouldActivate, shouldApplyToTargets, frozenTargetAttributes);
            }
        } else if (data.type === 'executeAfterDamageActivation') {
            // Attacker: told by the GM to auto-activate
            const { actorId, itemId, damagedTargets, shouldActivate, shouldApplyToTargets, frozenTargetAttributes } = data.payload;
            
            const actor = game.actors.get(actorId);
            if (!actor) {
                console.warn('DX3rd | Actor not found:', actorId);
                return;
            }
            
            if (!socketRouter.isActorExecutorMessage(data, actor)) return;
            
            const item = actor.items.get(itemId);
            if (!item) {
                console.warn('DX3rd | Item not found:', itemId);
                return;
            }
            
            // Handle the auto-activation
            const updates = {};
            
            if (shouldActivate) {
                updates['system.active.state'] = true;
            }
            
            if (Object.keys(updates).length > 0) {
                await item.update(updates);
            }
            
            // Apply the effect only to targets that took HP damage
            if (shouldApplyToTargets) {
                for (const targetId of damagedTargets) {
                    const targetActor = game.actors.get(targetId);
                    if (targetActor) {
                        // After the damage is applied is an attack trigger point — buckets with a different per-row "trigger action" are excluded.
                        // A frozen snapshot travels in the payload because this client's scratch
                        // context (_dx3rdRuntimeInput / _dx3rdUsageEncLevel) is long gone.
                        const targetAttributes = frozenTargetAttributes ?? (window.DX3rdItemEffectAdapter
                            ? window.DX3rdItemEffectAdapter.targetBucketAttributes(item, 'attack', 'afterDamage')
                            : (item.system.effect?.attributes || {}));

                        if (game.user.isGM && !socketRouter.isResponsibleGM()) return;
                        if (game.user.isGM) {
                            // The GM applies it directly
                            await window.DX3rdUniversalHandler._applyItemAttributes(actor, item, targetActor, targetAttributes,
                                {preEvaluated: frozenTargetAttributes != null});
                        } else {
                            // An ordinary user freezes the formulas on the using client and hands them to the target's owner.
                            await window.DX3rdUniversalHandler.dispatchItemAttributes(actor, item, targetActor, targetAttributes,
                                {preEvaluated: frozenTargetAttributes != null});
                        }
                    }
                }
            }
        } else if (data.type === 'showNoDamageNotification') {
            // Attacker: the notification that nobody took damage
            const { attackerId } = data.payload;
            
            const actor = game.actors.get(attackerId);
            if (!actor) return;
            
            if (!socketRouter.isActorExecutorMessage(data, actor)) return;
            
            // Show the notification dialog
            new foundry.applications.api.DialogV2({
                window: { title: game.i18n.localize('DX3rd.NoDamage') },
                content: `<p>${game.i18n.localize('DX3rd.NoDamageText')}</p>`,
                buttons: [
                    {
                        action: 'confirm',
                        icon: 'fas fa-check',
                        label: game.i18n.localize('DX3rd.Confirm'),
                        default: true
                    }
                ]
            }).render(true);
        }
    });
});


// Add the custom skills and the Cthulhu skill when an actor is created
Hooks.on('createActor', async (actor, options, userId) => {
    // Runs only on the client of the user that created the actor
    if (game.userId !== userId) {
        return;
    }
    
    if (actor.type === 'character') {
        const updates = {};
        
        // Add the Cthulhu skill (when the stageCRC setting is on and it was not deleted)
        const stageCRCEnabled = game.settings.get("dx3rd-emanim", "stageCRC");
        const cthulhuDeleted = actor.getFlag('dx3rd-emanim', 'cthulhuDeleted') === true;
        const customSkills = game.settings.get("dx3rd-emanim", "customSkills") || {};
        
        if (stageCRCEnabled && !cthulhuDeleted && !actor.system.attributes.skills.cthulhu) {
            // Use the Cthulhu info from customSkills when present, otherwise the defaults
            const cthulhuData = customSkills.cthulhu;
            const cthulhuName = cthulhuData 
                ? (typeof cthulhuData === 'object' ? cthulhuData.name : cthulhuData)
                : "DX3rd.cthulhu";
            const cthulhuBase = cthulhuData && typeof cthulhuData === 'object' && cthulhuData.base
                ? cthulhuData.base
                : "mind";
            
            updates['system.attributes.skills.cthulhu'] = {
                name: cthulhuName,
                point: 0,
                bonus: 0,
                extra: 0,
                total: 0,
                dice: 0,
                add: 0,
                base: cthulhuBase,
                delete: true
            };
        }
        
        // Group skills (driving / art / knowledge / info and other customSkills) are NOT auto-injected into a new character.
        // Only the group skills actually acquired are registered on the fly through the sheet's '+' (add skill). Compendium
        // content never references a group's sub-skill as a check skill (build-effects SKILL_MAP), and even if some homebrew
        // did, effect-handler falls back to the linked attribute so the check still proceeds.
        // (Only cthulhu is seeded separately above, per the stageCRC rule.)

        if (Object.keys(updates).length > 0) {
            await actor.update(updates);
        }
        
        // Add the default weapon item (fist)
        // Runs only on the client of the user that created the actor, so only a permitted user executes it
        const hasFist = actor.items.find(item => 
            item.type === 'weapon' && item.name === game.i18n.localize("DX3rd.Fist")
        );
        
        if (!hasFist) {
            try {
                await actor.createEmbeddedDocuments('Item', [{
                    name: game.i18n.localize("DX3rd.Fist"),
                    type: 'weapon',
                    img: 'icons/skills/melee/unarmed-punch-fist-yellow-red.webp',
                    system: {
                        // There is exactly one source for the defaults (defaultFistSystem in `universal-extensions.js`).
                        // These literals used to be duplicated across three restore paths as well, and those acted as an
                        // overwrite rather than a restore, wiping a hand-tuned fist after every combat.
                        ...window.DX3rdUniversalHandler.defaultFistSystem(),
                        description: game.i18n.localize("DX3rd.FistDescription"),
                        equipment: false,
                        active: {
                            state: false,
                            disable: '-'
                        },
                        effect: {
                            disable: '-',
                            attributes: {}
                        },
                        attributes: {},
                        macro: '',
                        saving: {
                            difficulty: '',
                            value: 0
                        },
                        exp: 0
                    }
                }]);
            } catch (error) {
                // Log only unexpected errors
                console.error('DX3rd | Failed to create fist item:', error);
            }
        }
    }
});

// Set the default image when an item is created
Hooks.on('preCreateItem', async (item, data, options, userId) => {
    const defaultImg = 'icons/svg/item-bag.svg';
    
    // Apply the per-type image only when img is the default or unset
    if (!data.img || data.img === defaultImg) {
        const typeImages = {
            'combo': 'icons/svg/explosion.svg',
            'effect': 'icons/svg/explosion.svg',
            'psionic': 'icons/svg/explosion.svg',
            'spell': 'icons/svg/explosion.svg',
            'weapon': 'icons/svg/sword.svg',
            'protect': 'icons/svg/shield.svg',
            'vehicle': 'icons/svg/target.svg',
            'book': 'icons/svg/book.svg',
            'record': 'icons/svg/book.svg',
            'connection': 'icons/svg/mystery-man.svg',
            'rois': 'icons/svg/mystery-man.svg',
            'etc': 'icons/svg/item-bag.svg',
            'once': 'icons/svg/pill.svg'
        };
        
        if (typeImages[item.type]) {
            item.updateSource({ img: typeImages[item.type] });
        }
    }
});

// When a compendium Works is added to an actor, also create the specialized skills its table specifies.
// A skill whose detail name is blank — <Driving:>, <Knowledge:> — is named by the user on the actor sheet;
// what matters here is that the Works' skill bonus applies immediately.
Hooks.on('createItem', async (item, options, userId) => {
    const actor = item.actor;
    if (!actor || actor.type !== 'character' || item.type !== 'works') return;
    if (game.userId !== userId) return;

    const updates = {};
    for (const [key, skill] of Object.entries(item.system?.skills || {})) {
        if (!key || actor.system?.attributes?.skills?.[key]) continue;
        updates[`system.attributes.skills.${key}`] = {
            name: skill.name || key,
            point: 0,
            bonus: 0,
            extra: 0,
            total: 0,
            dice: 0,
            add: 0,
            base: skill.base || 'body',
            delete: true
        };
    }
    if (Object.keys(updates).length > 0) {
        try {
            await actor.update(updates);
        } catch (error) {
            console.error('DX3rd | 웍스 전문 기능 생성 실패', error);
        }
    }
});

// ========== AfterMain queue management: reset at the start of combat ========== //
// The reset at the end of combat is handled by combat.js's deleteCombat hook
Hooks.on('createCombat', async (combat, options, userId) => {
    if (!game.user.isGM) return;
    if (window.DX3rdUniversalHandler) {
        await window.DX3rdUniversalHandler.clearAfterMainQueue();
    }
});

// ─────────────────────────────────────────────────────────────────────────────
// Live refresh of the derived display values on open sheets
//
// The actor / effect data layer is already live (prepareData updates the encroachment level first and evaluates
// the active items' bonuses every time). But Foundry re-renders a sheet only "when its own document updates",
// so with a combo / effect sheet left open, a rising encroachment (→ a level up) or an edit to a registered effect
// elsewhere leaves the dice / modifier / level shown on the sheet at their old values.
// The hooks below pick out only the "open" sheets that depend on the change and re-render them so the display is live.
// (render(false) does not update the document, so there is no recursive render loop.)

// A sheet the user is currently editing (focus is inside it) is not re-rendered.
// This prevents a re-render from replacing the DOM and losing the input focus or what is being typed.
function _dx3rdRerenderSheetNow(app) {
    if (!app?.rendered) return;
    const active = document.activeElement;
    if (active && app.element?.contains(active)) return;
    app.render(false);
}

// A single item use can cause several actor updates in a row (HP, encroachment, applied, …), and re-rendering the
// same sheet each time is wasteful. They are collected in a pending set and drawn once, a frame later.
// The rendered / focus checks happen "at draw time", so a sheet closed while pending, or one the user has started
// typing into, is naturally skipped — which is more accurate than running immediately.
const _dx3rdPendingRerenders = new Set();
const _dx3rdFlushRerenders = foundry.utils.debounce(() => {
    const apps = [..._dx3rdPendingRerenders];
    _dx3rdPendingRerenders.clear();
    for (const app of apps) _dx3rdRerenderSheetNow(app);
}, 50);

function _dx3rdRerenderSheet(app) {
    if (!app) return;                          // a sheet never opened is not created
    _dx3rdPendingRerenders.add(app);
    _dx3rdFlushRerenders();
}

// When an actor attribute such as encroachment changes, refresh the open item sheets that display or compute from it.
Hooks.on('updateActor', (actor, changed, options, userId) => {
    const hasAttributeChange = foundry.utils.hasProperty(changed, 'system.attributes') ||
        Object.keys(changed || {}).some(key => key.startsWith('system.attributes.'));
    if (!hasAttributeChange) return;
    for (const item of actor.items) {
        if (!['combo', 'effect', 'psionic'].includes(item.type)) continue;
        _dx3rdRerenderSheet(item._sheet);      // never opened means never created
    }
});

// The stock cost, acquisition method and the equipped / active state of an actor-owned item all change the actor's derived values.
// Editing on the item sheet may make Foundry re-render only that item's sheet, so an open actor sheet is refreshed too.
// The actor sheet's equip checkbox renders immediately through its own handler, and this hook merges with that.
Hooks.on('updateItem', (item, changed, options, userId) => {
    const actor = item.actor;
    if (!actor) return;
    const changedKeys = Object.keys(changed || {});
    const changesSaving = foundry.utils.hasProperty(changed, 'system.saving')
        || changedKeys.some(key => key.startsWith('system.saving.'));
    const changesEquipment = foundry.utils.hasProperty(changed, 'system.equipment')
        || foundry.utils.hasProperty(changed, 'system.active.state')
        || changedKeys.some(key => key === 'system.equipment' || key === 'system.active.state');
    if (!changesSaving && !changesEquipment) return;
    if (changesEquipment) actor.reset?.();
    _dx3rdRerenderSheet(actor.sheet);
});

// An instant combo is not world data until the save button is pressed.
// A document left behind by a browser refresh or an abnormal window close is not auto-deleted at startup.
// An explicitly saved combo has no instantCombo flag, so it is never a cleanup target.
window.DX3rdInstantComboCleanup = {
    audit() {
        const rows = [];
        for (const actor of game.actors) {
            // Retained instant combos are live sources for delayed/persistent effects, not orphans.
            const items = actor.items.filter(item => window.DX3rdIsInstantCombo?.(item)
                && !window.DX3rdInstantComboRetention?.isRetained?.(item));
            if (items.length) rows.push({ actor, items });
        }
        return { actors: rows.length, items: rows.reduce((count, row) => count + row.items.length, 0), rows };
    },
    async repair() {
        if (!game.user.isGM) return { actors: 0, items: 0 };
        const audit = this.audit();
        let removed = 0;
        for (const { actor, items } of audit.rows) {
            await actor.deleteEmbeddedDocuments('Item', items.map(item => item.id), { render: false });
            removed += items.length;
        }
        console.log(`DX3rd | Explicit instant combo cleanup: ${removed} removed.`);
        return { actors: audit.actors, items: removed };
    }
};

// When an effect changes, the stored derived values of the combos that registered it are synced by the same combination
// rule and the open combo sheets refreshed. The effect's own sheet is re-rendered automatically by Foundry on updateItem.
Hooks.on('updateItem', async (item, changed, options, userId) => {
    const actor = item.actor;
    if (!actor || item.type !== 'effect') return;
    // A name, image or sort change has no effect on a combo's computed values.
    // Depending on the Foundry version and the call path, changes may be a nested object or dot-notation keys.
    const hasSystemChange = foundry.utils.hasProperty(changed, 'system') ||
        Object.keys(changed || {}).some(key => key.startsWith('system.'));
    if (!hasSystemChange) return;

    // Hooks run on every connected client. The stored sync is performed once, by the user that caused the change,
    // and only when they have write permission on that actor. A re-render only refreshes the display, so it is not
    // a write and is performed as-is on every client with the sheet open.
    const canSync = userId === game.user.id && actor.isOwner;

    const comboData = window.DX3rdComboData;
    const getEffectIds = comboData?.getEffectIds;
    for (const combo of actor.items) {
        if (combo.type !== 'combo') continue;
        const ids = getEffectIds ? getEffectIds(combo)
            : (Array.isArray(combo.system?.effectIds) ? combo.system.effectIds : []);
        if (!ids.includes(item.id)) continue;

        if (canSync) {
            try {
                await comboData?.syncRegisteredEffectData?.(combo, actor);
            } catch (error) {
                console.error('DX3rd | Failed to synchronize combo after registered effect update', error);
            }
        }
        _dx3rdRerenderSheet(combo._sheet);
    }
});
