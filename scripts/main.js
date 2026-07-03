/**
 * Double Cross 3rd 시스템의 메인 스크립트
 */

// 폰트 설정 등록 완료 플래그 (중복 실행 방지)
let _fontSettingsRegistered = false;

// 월드 폰트 목록을 가져와서 채팅 폰트 설정을 등록하는 함수
function registerChatFontSettings() {
    // 폰트가 로드될 때까지 기다린 후 폰트 목록 업데이트
    waitForFontsAndRegister();
}

// 폰트 로드 완료를 기다린 후 폰트 목록 업데이트 및 설정 등록
function waitForFontsAndRegister() {
    // document.fonts.ready를 사용하여 폰트 로드 완료 대기
    if (document.fonts && document.fonts.ready) {
        document.fonts.ready.then(() => {
            // 폰트 로드 완료 후 약간의 딜레이를 두고 등록 (CONFIG.fontDefinitions 준비 대기)
            setTimeout(() => {
                registerFontSettings();
            }, 500);
        }).catch(() => {
            // 폰트 API 실패 시 폴백으로 일정 시간 후 등록
            setTimeout(() => {
                registerFontSettings();
            }, 1000);
        });
    } else {
        // 폰트 API가 없는 경우 폴백
        setTimeout(() => {
            registerFontSettings();
        }, 1000);
    }
    
    // 최대 대기 시간 설정 (5초 후에는 강제로 등록)
    setTimeout(() => {
        registerFontSettings();
    }, 5000);
}

// 실제 폰트 설정 등록 함수
function registerFontSettings() {
    // 이미 등록된 경우 스킵 (중복 실행 방지)
    if (_fontSettingsRegistered) {
        return;
    }
    try {
        // Foundry VTT에서 사용 가능한 폰트 목록 가져오기
        let loadedFonts = [];
        
        // 방법 1: CONFIG.fontDefinitions.keys에서 폰트 가져오기
        try {
            const configFonts = Object.keys(CONFIG.fontDefinitions || {});
            loadedFonts = [...loadedFonts, ...configFonts];
        } catch (e) {
            console.warn('DX3rd | CONFIG.fontDefinitions 접근 실패:', e);
        }
        
        // 방법 2: document.fonts API 사용
        try {
            if (document.fonts && document.fonts.forEach) {
                document.fonts.forEach(font => {
                    const family = font.family;
                    if (family && typeof family === 'string') {
                        loadedFonts.push(family);
                    }
                });
            }
        } catch (e) {
            console.warn('DX3rd | document.fonts 접근 실패:', e);
        }
        
        // 제외할 폰트들 (패턴 매칭)
        const excludePatterns = [
            'modesto condensed',
            'modesto',
            'amiri',
            'signika',
            'bruno ace',
            'font awesome',
            'fontawesome',
            'fallback'
        ];
        
        // 필터링 및 중복 제거
        const filteredFonts = loadedFonts.filter(font => {
            if (!font || typeof font !== 'string') return false;
            const lowerFont = font.toLowerCase().replace(/['"]/g, '').trim();
            return !excludePatterns.some(pattern => lowerFont.includes(pattern));
        });
        
        const uniqueFonts = [...new Set(filteredFonts)];
        
        // 기본 폰트와 결합 (빈 문자열은 항상 포함)
        const allFonts = ['', ...uniqueFonts.filter(f => f && f.trim() !== '')];
        
        // 폰트 정렬: 빈 문자열을 제외하고 한글, 영어, 숫자 순으로 정렬
        const sortedFonts = allFonts.sort((a, b) => {
            // 빈 문자열은 항상 맨 앞
            if (a === '') return -1;
            if (b === '') return 1;
            
            // 나머지는 localeCompare로 정렬 (한글, 영어, 숫자 순)
            return a.localeCompare(b, ['ko', 'en'], { numeric: true, sensitivity: 'base' });
        });
        
        // 폰트 선택 옵션 객체 생성
        const fontChoices = {};
        sortedFonts.forEach(font => {
            if (font === '') {
                fontChoices[font] = '기본';
            } else {
                fontChoices[font] = font;
            }
        });
        
        // UI 버튼 폰트 설정
        game.settings.register('dx3rd-emanim', 'uiButtonFont', {
            name: 'DX3rd.UIButtonFont',
            hint: '전투 UI 버튼의 폰트를 설정합니다.',
            scope: 'world',
            config: true,
            type: String,
            choices: fontChoices,
            default: '',
            onChange: (value) => {
                // 전투 버튼 폰트 즉시 적용
                if (window.DX3rdCombatUI && window.DX3rdCombatUI.applyButtonFont) {
                    window.DX3rdCombatUI.applyButtonFont(value);
                }
            }
        });
        
        // UI 버튼 호버 사운드 설정
        game.settings.register('dx3rd-emanim', 'uiButtonHoverSound', {
            name: 'UI 버튼 호버 사운드',
            hint: '전투 UI 버튼에 마우스를 올렸을 때 재생되는 사운드를 설정합니다.',
            scope: 'world',
            config: true,
            type: String,
            filePicker: 'audio',
            default: 'sounds/notify.wav'
        });
        
        // UI 버튼 클릭 사운드 설정
        game.settings.register('dx3rd-emanim', 'uiButtonClickSound', {
            name: 'UI 버튼 클릭 사운드',
            hint: '전투 UI 버튼을 클릭했을 때 재생되는 사운드를 설정합니다.',
            scope: 'world',
            config: true,
            type: String,
            filePicker: 'audio',
            default: 'sounds/doors/sliding/test.ogg'
        });
        
        // UI 버튼 사운드 볼륨 설정
        game.settings.register('dx3rd-emanim', 'uiButtonSoundVolume', {
            name: 'UI 버튼 사운드 볼륨',
            hint: '전투 UI 버튼의 호버 및 클릭 사운드 볼륨을 설정합니다. (0.0 ~ 2.0)',
            scope: 'world',
            config: true,
            type: Number,
            range: {
                min: 0,
                max: 2,
                step: 0.1
            },
            default: 1.0
        });
        
        _fontSettingsRegistered = true;
    } catch (e) {
        console.warn('DX3rd | Failed to register chat font settings:', e);
    }
}

// 시스템 설정 샘플
Hooks.once('init', async function() {
    
    // 설정 등록: 익스텐션 자동 승인
    game.settings.register('dx3rd-emanim', 'DX3rd.AutoApplyExtensions', {
        name: 'DX3rd.ExtendConfirmSetting',
        hint: 'DX3rd.ExtendConfirmSettingHint',
        scope: 'world',
        config: true,
        type: Boolean,
        default: false
    });
    
    // 설정 등록: Pressure 예외 아이템 목록 (타이밍 오토인 아이템도 채팅 메시지 출력 가능)
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
    
    // 설정 등록: 폭주 reaction 예외 아이템 목록 (타이밍 reaction인 아이템도 사용 가능)
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
    
    // 설정 등록: AfterMain 큐 (월드에 저장)
    // v13/v14 호환: type: Array는 v14에서 경고가 발생할 수 있으므로 방어적으로 처리
    game.settings.register('dx3rd-emanim', 'afterMainQueue', {
        scope: 'world',
        config: false, // UI에 표시하지 않음
        type: Array,
        default: []
    });
    
    // Combat 클래스 등록
    CONFIG.Combat.documentClass = DX3rdCombat;
    CONFIG.Combatant.documentClass = DX3rdCombatant;
    
    // Handlebars 헬퍼 등록 (helpers.js에서 이미 등록된 것들은 제외)
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
        
        // notCheck는 애초에 applied 되지 않아야 하는 값이므로 예외 처리
        if (disable === 'notCheck') {
            return game.i18n.localize('DX3rd.NotCheck');
        }
        
        // 로컬라이징 키 생성 (After 접두사 사용)
        // afterRoll → AfterRoll, afterMajor → AfterMajor
        const disableKey = `DX3rd.After${disable.charAt(0).toUpperCase() + disable.slice(1)}`;
        
        // 로컬라이징 시도
        const localized = game.i18n.localize(disableKey);
        
        // 로컬라이징이 실패한 경우 (키가 없으면 원본 키가 반환됨)
        if (localized === disableKey) {
            console.warn(`DX3rd | Disable localization key not found: ${disableKey}`);
            return disable; // 원본 값 반환
        }
        
        return localized;
    });

    Handlebars.registerHelper('itemType', function(type) {
        if (type === "-") {
            return type;
        }
        return game.i18n.localize(`DX3rd.${type.charAt(0).toUpperCase() + type.slice(1)}`);
    });

    // Attributes 옵션을 위한 헬퍼 함수
    Handlebars.registerHelper('attributeOptions', function(selectedValue) {
        const options = [
            { value: "-", label: "-" },
            { value: "attack", label: "DX3rd.Attack" },
            { value: "damage_roll", label: "DX3rd.DamageRoll" },
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
            { value: "cast_dice", label: "DX3rd.CastingDice" },
            { value: "cast_add", label: "DX3rd.CastingAdd" }
        ];

        // stageCRC 설정 확인
        const stageCRCEnabled = game.settings.get("dx3rd-emanim", "stageCRC");

        let html = '';
        options.forEach(option => {
            // stageCRC가 비활성화되어 있고, cast_dice 또는 cast_add인 경우 건너뛰기
            if (!stageCRCEnabled && (option.value === 'cast_dice' || option.value === 'cast_add')) {
                return;
            }
            
            const selected = option.value === selectedValue ? 'selected' : '';
            html += `<option value="${option.value}" ${selected}>${game.i18n.localize(option.label)}</option>`;
        });
        
        return new Handlebars.SafeString(html);
    });

    Handlebars.registerHelper('usedFull', function(used, max) {
        return used && used.state >= max;
    });

    Handlebars.registerHelper('usedFullForCombo', function(actor, combo) {
        return combo && combo.system && combo.system.used && combo.system.used.state >= combo.system.used.max;
    });
    
    // 아이템 사용 횟수 완전 소진 여부 확인 (무기는 used + attack-used 모두 체크, 콤보는 포함된 이펙트 체크)
    Handlebars.registerHelper('isItemExhausted', function(item, actor) {
        // 템플릿 데이터에서 액터 정보를 아이템에 임시로 설정
        if (actor && !item.actor) {
            // Foundry 액터 객체로 변환
            let foundryActor = null;
            if (actor.id) {
                foundryActor = game.actors.get(actor.id);
            } else if (actor._id) {
                foundryActor = game.actors.get(actor._id);
            }
            
            if (foundryActor) {
                // 원본 객체를 수정하지 않기 위해 복사본 생성
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

    // 숫자 값을 안전하게 변환하는 헬퍼
    Handlebars.registerHelper('safeNumber', function(value) {
        const num = Number(value);
        return isNaN(num) ? 0 : num;
    });

    // 두 값을 더하는 헬퍼
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

    // 템플릿에서 Works 스킬 표시를 위해 actorSkills/skills에서 안전하게 속성 조회
    // 사용법: {{attrSkill actorSkills skills key 'name'}}
    Handlebars.registerHelper('attrSkill', function(actorSkills, skills, key, prop) {
        try {
            const itemSkills = skills || {};
            const baseSkills = actorSkills || {};
            const fromItem = itemSkills[key];
            const fromActor = baseSkills[key];
            const source = fromItem ?? fromActor ?? null;
            if (!source) return '';
            let value = source[prop];
            
            // name 속성인 경우 customSkills 설정 확인
            if (prop === 'name' && typeof value === 'string' && value.startsWith('DX3rd.')) {
                // 스킬 키 추출 (예: "DX3rd.rc" -> "rc")
                const skillKey = value.replace('DX3rd.', '');
                
                // customSkills 설정에서 커스텀 이름 확인
                const customSkills = game.settings.get("dx3rd-emanim", "customSkills") || {};
                
                // 커스텀 이름이 있으면 우선 사용
                if (customSkills[skillKey]) {
                    value = typeof customSkills[skillKey] === 'object' 
                        ? customSkills[skillKey].name 
                        : customSkills[skillKey];
                } else {
                    // 커스텀 이름이 없으면 기본 로컬라이징
                    value = game.i18n.localize(value);
                }
            }
            
            return (value === undefined || value === null) ? '' : value;
        } catch (e) {
            return '';
        }
    });

    // 템플릿 헬퍼 등록
    Handlebars.registerHelper('eq', function(a, b) {
        return a === b;
    });
    
    // 시스템 설정 등록
    
    // 스킬 설정 메뉴
    game.settings.registerMenu('dx3rd-emanim', 'skillsSettingsMenu', {
        name: 'DX3rd.SkillsSettings',
        label: 'DX3rd.ManageSkills',
        hint: '기본 스킬을 관리합니다.',
        icon: 'fas fa-cogs',
        type: window.DX3rdSkillsSettingsDialog,
        restricted: true
    });
    
    // 공식 데이터가 지정한 그룹스킬 카테고리(정보/지식/운전/예술)를 표준 정의로 시드.
    // 키 컨벤션: 그룹접두사_로마자(snake_case) — _source/mechanics.mjs CATEGORY_KEY와 동기 유지.
    // base: 정보=social, 지식=mind, 운전=body, 예술=sense (skills-settings-dialog 플레이스홀더 매핑과 일치).
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
        drive_bike:      { name: '운전: 2륜',       base: 'body' },
        ars_music:       { name: '예술: 음악',      base: 'sense' }
    };
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

    // 장면 개막 번호 (GM용, 설정 UI에는 미노출)
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

    game.settings.register('dx3rd-emanim', 'rangeHighlight', {
        name: 'DX3rd.RangeHighlight',
        hint: '아이템 채팅 출력 시 사정거리 하이라이트를 표시합니다.',
        scope: 'world',
        config: true,
        type: Boolean,
        default: true
    });

    game.settings.register('dx3rd-emanim', 'rangeHighlightColor', {
        name: 'DX3rd.RangeHighlightColor',
        hint: '기본 색상(녹색) 대신 사용자 색상을 사용합니다.',
        scope: 'world',
        config: true,
        type: Boolean,
        default: false
    });

    game.settings.register('dx3rd-emanim', 'combatSideControlEnabled', {
        name: 'DX3rd.CombatSideControlEnabled',
        hint: 'DX3rd.CombatSideControlEnabledHint',
        scope: 'world',
        config: true,
        type: Boolean,
        default: false
    });

    // 채팅 폰트 설정 - ready 훅에서 폰트 목록을 가져온 후 등록

    Handlebars.registerHelper('startsWith', function(str, prefix) {
        return typeof str === 'string' && str.startsWith(prefix);
    });

    // v13 {{#select}} 경고 억제용 커스텀 헬퍼
    // 기본 동작: 블록 내부 option들 중 선택값과 일치하는 value에 selected 주입
    // 주의: Foundry 코어의 경고 로거를 호출하지 않도록 별도 구현
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
});

// Scene Control 버튼 추가
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
                onClick: () => {
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
                            <form class="flexcol">
                                <div class="form-group">
                                    <label>#${nextNumber}</label>
                                    <input type="text" id="dx3rd-scene-title" name="sceneTitle" placeholder="${game.i18n.localize("DX3rd.SceneTitleInput")}" autofocus/>
                                </div>
                                <div class="dx3rd-scene-open-user-list">
                                    ${userListHTML}
                                </div>
                            </form>
                        </div>
                    `;
                    new Dialog({
                        title: game.i18n.localize("DX3rd.SceneOpen"),
                        content,
                        buttons: {
                            confirm: {
                                icon: '<i class="fas fa-check"></i>',
                                label: game.i18n.localize("DX3rd.Confirm"),
                                callback: async (html) => {
                                    const title = html.find("#dx3rd-scene-title").val()?.trim() ?? "";
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

                                    const content = title ? `<h3 style="color: white;  margin: 0px; border-bottom: 1px solid white;">#${nextNumber} ${title}</h3>` : `<h3 style="color: white;">#${nextNumber}</h3>`;
                                    await ChatMessage.create({
                                        content,
                                        speaker: { alias: game.user.name }
                                    });

                                    const checkedUserIds = [];
                                    html.find(".dx3rd-scene-open-user-row input[data-user-id]:checked").each(function() {
                                        checkedUserIds.push($(this).attr("data-user-id"));
                                    });
                                    for (const userId of checkedUserIds) {
                                        game.socket.emit("system.dx3rd-emanim", { type: "showSceneEnterDialog", userId });
                                    }
                                }
                            },
                            cancel: {
                                icon: '<i class="fas fa-times"></i>',
                                label: game.i18n.localize("DX3rd.Cancel")
                            },
                            sessionEnd: {
                                icon: '<i class="fas fa-stop"></i>',
                                label: game.i18n.localize("DX3rd.SessionEnd"),
                                callback: () => {
                                    new Dialog({
                                        title: game.i18n.localize("DX3rd.SessionEnd"),
                                        content: `<p>${game.i18n.localize("DX3rd.SessionEndQuestion")}</p>`,
                                        buttons: {
                                            confirm: {
                                                icon: '<i class="fas fa-check"></i>',
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
                                                        content: `<h3 style="color: white; margin: 0px; border-bottom: 1px solid white;">${game.i18n.localize("DX3rd.SessionEnd")}</h3>`,
                                                        speaker: { alias: game.user.name }
                                                    });
                                                }
                                            },
                                            cancel: {
                                                icon: '<i class="fas fa-times"></i>',
                                                label: game.i18n.localize("DX3rd.Cancel")
                                            }
                                        },
                                        default: "cancel"
                                    }).render(true);
                                }
                            }
                        },
                        default: "confirm"
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
            onClick: () => {
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
                    
                    document.body.appendChild(dialog);
                    
                    document.getElementById("dx3rd-enter-scene-button").addEventListener("click", () => onSelect("enterScene"));
                    document.getElementById("dx3rd-urge-test-button").addEventListener("click", () => onSelect("urgeTest"));
                    if (stageCRCEnabled) {
                        document.getElementById("dx3rd-panic-test-button").addEventListener("click", () => onSelect("panicTest"));
                    }
                    document.getElementById("dx3rd-cancel-button").addEventListener("click", () => onSelect(null));
                });
                
                // 선택된 항목에 따라 처리
                choice.then(async (selection) => {
                    if (!selection) return;
                    
                    // 할당된 캐릭터 확인, 없으면 선택한 토큰의 액터 사용
                    let character = game.user.character;
                    if (!character) {
                        const controlledTokens = canvas.tokens?.controlled || [];
                        if (controlledTokens.length > 0 && controlledTokens[0].actor) {
                            character = controlledTokens[0].actor;
                        } else {
                            ui.notifications.warn("플레이어 캐릭터가 설정되지 않았거나 선택한 토큰이 없습니다.");
                            return;
                        }
                    }
                    
                    if (selection === "enterScene") {
                        // 등장 처리
                        const entryEncroachment = game.settings.get('dx3rd-emanim', 'entryEncroachment');
                        
                        if (!entryEncroachment) {
                            // 등장 침식률 조정이 체크되지 않은 경우
                            // 1d10 굴리기
                            const roll = new Roll("1d10");
                            await roll.evaluate();
                            
                            // 주사위 결과값
                            const rollValue = roll.total;
                            
                            // 현재 침식률 가져오기 (숫자로 명시적 변환)
                            const currentEncroachment = Number(character.system.attributes.encroachment.value) || 0;
                            const newEncroachment = currentEncroachment + rollValue;
                            
                            // 침식률 업데이트
                            await character.update({
                                'system.attributes.encroachment.value': newEncroachment
                            });
                            
                            // 채팅 메시지 내용 구성
                            const messageContent = `
                                <div class="dx3rd-item-chat">
                                    <div style="font-weight: bold;">
                                        ${character.name} ${game.i18n.localize("DX3rd.EnterScene")}
                                    </div>
                                    <div>
                                        ${game.i18n.localize("DX3rd.Encroachment")} +${rollValue} ( ${currentEncroachment} → ${newEncroachment} )
                                    </div>
                                </div>
                            `;
                            
                            // 액터만 스피커로 지정 (token 미지정 → 모든 클라이언트에서 액터 초상화 사용, lichsoma-speaker-selecter 호환)
                            const enterSceneSpeaker = (() => {
                                const s = ChatMessage.getSpeaker({ actor: character });
                                return { ...s, token: null, scene: null };
                            })();
                            // 침식률 정보를 먼저 출력 (컨텐트에 포함)
                            await ChatMessage.create({
                                content: messageContent,
                                speaker: enterSceneSpeaker
                            });
                            
                            // 주사위 굴림 결과를 아래에 출력
                            await ChatMessage.create({
                                speaker: enterSceneSpeaker,
                                rolls: [roll]
                            });
                        } else {
                            // 등장 침식률 조정이 체크된 경우 (+1만 적용)
                            // 주사위 없이 +1만 적용
                            const encroachmentIncrease = 1;
                            
                            // 현재 침식률 가져오기 (숫자로 명시적 변환)
                            const currentEncroachment = Number(character.system.attributes.encroachment.value) || 0;
                            const newEncroachment = currentEncroachment + encroachmentIncrease;
                            
                            // 침식률 업데이트
                            await character.update({
                                'system.attributes.encroachment.value': newEncroachment
                            });
                            
                            // 채팅 메시지 내용 구성 (주사위 없이)
                            const messageContent = `
                                <div class="dx3rd-item-chat">
                                    <div style="font-weight: bold;">
                                        ${character.name} ${game.i18n.localize("DX3rd.EnterScene")}
                                    </div>
                                    <div>
                                        ${game.i18n.localize("DX3rd.Encroachment")} +${encroachmentIncrease} ( ${currentEncroachment} → ${newEncroachment} )
                                    </div>
                                </div>
                            `;
                            
                            // 액터만 스피커로 지정 (token 미지정 → GM 포함 모든 클라이언트에서 액터 초상화 사용)
                            const enterSceneSpeaker = (() => {
                                const s = ChatMessage.getSpeaker({ actor: character });
                                return { ...s, token: null, scene: null };
                            })();
                            // 주사위 없이 메시지만 출력
                            await ChatMessage.create({
                                content: messageContent,
                                speaker: enterSceneSpeaker
                            });
                        }
                    } else if (selection === "urgeTest") {
                        // 충동 판정 처리
                        // 선택한 토큰이 있으면 해당 액터 사용, 없으면 할당된 캐릭터 사용
                        let targetCharacter = character;
                        const controlledTokens = canvas.tokens?.controlled || [];
                        if (controlledTokens.length > 0 && controlledTokens[0].actor) {
                            targetCharacter = controlledTokens[0].actor;
                        }
                        // 액터만 스피커로 지정 (token 미지정 → GM 포함 모든 클라이언트에서 액터 초상화 사용)
                        const urgeTestSpeaker = (() => {
                            const s = ChatMessage.getSpeaker({ actor: targetCharacter });
                            return { ...s, token: null, scene: null };
                        })();
                        
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
                            
                            // 주사위 결과값
                            const rollValue = encroachmentRoll.total;
                            
                            // 현재 침식률 가져오기 (숫자로 명시적 변환)
                            const currentEncroachment = Number(targetCharacter.system.attributes.encroachment.value) || 0;
                            const newEncroachment = currentEncroachment + rollValue;
                            
                            // 침식률 업데이트
                            await targetCharacter.update({
                                'system.attributes.encroachment.value': newEncroachment
                            });
                            
                            // 채팅 메시지 내용 구성
                            // GM인 경우 침식률 변화 표시 제거
                            const encroachmentText = game.user.isGM 
                                ? `${game.i18n.localize("DX3rd.Encroachment")} +${rollValue}`
                                : `${game.i18n.localize("DX3rd.Encroachment")} +${rollValue} ( ${currentEncroachment} → ${newEncroachment} )`;
                            
                            const messageContent = `
                                <div class="dx3rd-item-chat">
                                    <div style="font-weight: bold;">
                                        ${targetCharacter.name} ${game.i18n.localize("DX3rd.UrgeTest")}
                                    </div>
                                    <div>
                                        ${encroachmentText}
                                    </div>
                                </div>
                            `;
                            
                            // 침식률 정보를 먼저 출력 (컨텐트에 포함)
                            await ChatMessage.create({
                                content: messageContent,
                                speaker: urgeTestSpeaker
                            });
                            
                            // 주사위 굴림 결과를 아래에 출력
                            await ChatMessage.create({
                                speaker: urgeTestSpeaker,
                                rolls: [encroachmentRoll]
                            });
                        };
                        
                        // 의지 기능 판정 다이얼로그 표시 (난이도 필수, 충동 판정 플래그, 침식률 상승 콜백)
                        if (window.DX3rdUniversalHandler && window.DX3rdUniversalHandler.showStatRollDialog) {
                            const originalShowStatRollDialog = window.DX3rdUniversalHandler.showStatRollDialog.bind(window.DX3rdUniversalHandler);
                            
                            originalShowStatRollDialog(
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
                                true, // isUrgeTest: 충동 판정 플래그
                                handleEncroachmentIncrease // afterRollCallback: 침식률 상승 콜백
                            );
                        }
                    } else if (selection === "panicTest") {
                        // 공포 판정 처리
                        // 선택한 토큰이 있으면 해당 액터 사용, 없으면 할당된 캐릭터 사용
                        let targetCharacter = character;
                        const controlledTokens = canvas.tokens?.controlled || [];
                        if (controlledTokens.length > 0 && controlledTokens[0].actor) {
                            targetCharacter = controlledTokens[0].actor;
                        }
                        // 액터만 스피커로 지정 (token 미지정 → GM 포함 모든 클라이언트에서 액터 초상화 사용)
                        const panicTestSpeaker = (() => {
                            const s = ChatMessage.getSpeaker({ actor: targetCharacter });
                            return { ...s, token: null, scene: null };
                        })();
                        
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
                            
                            // 주사위 결과값
                            const rollValue = encroachmentRoll.total;
                            
                            // 현재 침식률 가져오기 (숫자로 명시적 변환)
                            const currentEncroachment = Number(targetCharacter.system.attributes.encroachment.value) || 0;
                            const newEncroachment = currentEncroachment + rollValue;
                            
                            // 침식률 업데이트
                            await targetCharacter.update({
                                'system.attributes.encroachment.value': newEncroachment
                            });
                            
                            // 채팅 메시지 내용 구성
                            // GM인 경우 침식률 변화 표시 제거
                            const encroachmentText = game.user.isGM 
                                ? `${game.i18n.localize("DX3rd.Encroachment")} +${rollValue}`
                                : `${game.i18n.localize("DX3rd.Encroachment")} +${rollValue} ( ${currentEncroachment} → ${newEncroachment} )`;
                            
                            const messageContent = `
                                <div class="dx3rd-item-chat">
                                    <div style="font-weight: bold;">
                                        ${targetCharacter.name} ${game.i18n.localize("DX3rd.PanicTest")}
                                    </div>
                                    <div>
                                        ${encroachmentText}
                                    </div>
                                </div>
                            `;
                            
                            // 침식률 정보를 먼저 출력 (컨텐트에 포함)
                            await ChatMessage.create({
                                content: messageContent,
                                speaker: panicTestSpeaker
                            });
                            
                            // 주사위 굴림 결과를 아래에 출력
                            await ChatMessage.create({
                                speaker: panicTestSpeaker,
                                rolls: [encroachmentRoll]
                            });
                        };
                        
                        // 의지 기능 판정 다이얼로그 표시 (난이도 필수, 공포 판정 플래그, 침식률 상승 콜백)
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
                                false, // isUrgeTest: 충동 판정 플래그 (false)
                                handleEncroachmentIncrease, // afterRollCallback: 침식률 상승 콜백
                                true  // isPanicTest: 공포 판정 플래그
                            );
                        }
                    }
                });
            }
        });

        // 액션 UI 버튼 추가 (등장 버튼 아래)
        if (window.DX3rdActionUI) {
            const state = window.DX3rdActionUI.getSceneActionUIState();

            addTool(controls.tokens.tools, 'action-ui', {
                name: 'action-ui',
                title: 'DX3rd.ActionUI',
                icon: 'fa-solid fa-gamepad',
                toggle: true,
                active: state,
                onChange: () => {
                    window.DX3rdActionUI.toggleActionUIEnabled();
                }
            });
        }
    }
});

// 액터 생성 시 토큰-액터 연동 활성화
Hooks.on('preCreateActor', (document, data, options, userId) => {
    // character, enemy 타입만 처리
    if (data.type !== 'character' && data.type !== 'enemy') {
        return;
    }
    
    const updates = {};
    
    // 0. 에너미 타입일 때 actorType을 Troop으로 설정 (다이얼로그 옵션 값과 일치)
    if (data.type === 'enemy') {
        const currentActorType = foundry.utils.getProperty(data, 'system.actorType');
        if (!currentActorType || currentActorType === 'NPC' || currentActorType === 'PlayerCharacter') {
            updates['system.actorType'] = 'Troop';
        }
    }
    
    // 1. prototypeToken 설정 (actorLink 기본 true)
    if (data.prototypeToken?.actorLink === undefined) {
        updates['prototypeToken.actorLink'] = true;
        updates['prototypeToken.bar1'] = { attribute: 'attributes.hp' };
        if (data.type === 'character') {
            updates['prototypeToken.bar2'] = { attribute: 'attributes.encroachment' };
        }
    }
    
    // 2. 기본 스킬 필수 속성 보장
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
            // 필수 속성 확인
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

// 스크립트 로딩 체크
Hooks.once('ready', function() {
    if (!window.DX3rdSkillCreateDialog || !window.DX3rdSkillEditDialog) {
        console.error('Double Cross 3rd | 스킬 다이얼로그 클래스가 로드되지 않았습니다.');
        ui.notifications.error('Double Cross 3rd | 시스템 초기화 중 오류가 발생했습니다.');
    }
    
    if (!window.DX3rdEquipmentSelectionDialog) {
        console.error('Double Cross 3rd | 장비 선택 다이얼로그 클래스가 로드되지 않았습니다.');
        ui.notifications.error('Double Cross 3rd | 시스템 초기화 중 오류가 발생했습니다.');
    }
    
    // GM 전용: afterDamage 관련 저장소 초기화
    if (game.user.isGM) {
        window.DX3rdTargetApplyQueue = {};
        window.DX3rdAfterDamageActivationQueue = {};
        window.DX3rdAfterDamageExtensionQueue = {};  // 익스텐드 큐 초기화
    }
    
    // 전역 채팅 토글 리스너 등록
    DX3rdChatToggleManager.initialize();
    
    // 월드 폰트 목록 가져오기 및 채팅 폰트 설정 등록
    registerChatFontSettings();
    
    
    // Disable Hooks 채팅 명령어 등록
    
    // 범위 하이라이트 관련 Combat Hooks 등록
    Hooks.on('updateCombat', (combat, changed, options, userId) => {
        // 턴이 변경되거나 라운드가 변경되면 하이라이트 큐 초기화 (강제 클리어)
        if (changed.turn !== undefined || changed.round !== undefined) {
            if (window.DX3rdUniversalHandler && window.DX3rdUniversalHandler.clearRangeHighlightQueue) {
                window.DX3rdUniversalHandler.clearRangeHighlightQueue(true); // force = true
            }
        }
    });
    
    Hooks.on('deleteCombat', (combat, options, userId) => {
        // 전투 종료 시 하이라이트 큐 초기화 (강제 클리어)
        if (window.DX3rdUniversalHandler && window.DX3rdUniversalHandler.clearRangeHighlightQueue) {
            window.DX3rdUniversalHandler.clearRangeHighlightQueue(true); // force = true
        }
    });
    
    // ESC 키로 범위 하이라이트 클리어 (다이얼로그 닫기보다 우선)
    $(document).off('keydown.dx3rd-range-highlight').on('keydown.dx3rd-range-highlight', (event) => {
        if (event.key === 'Escape' || event.keyCode === 27) {
            // 범위 하이라이트가 활성화되어 있는지 확인
            if (window.DX3rdUniversalHandler && 
                window.DX3rdUniversalHandler.rangeHighlightQueue && 
                window.DX3rdUniversalHandler.rangeHighlightQueue.current) {
                
                const currentHighlight = window.DX3rdUniversalHandler.rangeHighlightQueue.current;
                const highlightUserId = currentHighlight.userId;
                const currentUserId = game.user.id;
                const isCreator = highlightUserId && highlightUserId === currentUserId;
                const isGM = game.user.isGM;
                
                // 권한 체크: 하이라이트를 생성한 사용자 또는 GM만 클리어 가능
                if (isCreator || isGM) {
                    // 하이라이트가 있으면 먼저 클리어
            window.DX3rdUniversalHandler.clearRangeHighlightQueue();
                    
                    // 다른 유저들에게도 소켓으로 전송
                    game.socket.emit('system.dx3rd-emanim', {
                        type: 'clearRangeHighlight'
                    });
                    
                    // 이벤트 전파 중지 (다이얼로그 닫기 등 다른 동작 방지)
                    event.preventDefault();
                    event.stopPropagation();
                    return false;
                }
            }
        }
    });
    
    // 액터 격자 데이터 저장
    game.settings.register('dx3rd-emanim', 'actorGridActors', {
        name: 'Actor Grid Actors',
        scope: 'client',
        config: false,
        type: Array,
        default: []
    });

    // 폴더 상태 저장
    game.settings.register('dx3rd-emanim', 'folderStates', {
        name: 'Folder States',
        scope: 'client',
        config: false,
        type: Object,
        default: {}
    });

    // 채팅 메시지 생성 전, 설정에 맞춰 스피커 보정
    Hooks.on('preCreateChatMessage', (doc, data) => {
        try {
            // 현재 클라이언트에서 생성하는 메시지에만 적용
            if (data.author && data.author !== game.user.id) return;
            
            // 상태이상 메시지 감지: ActionEnd, ActionDelay, Apply, Clear가 포함된 메시지
            const content = data.content || '';
            const isConditionMessage = content.includes(game.i18n.localize("DX3rd.ActionEnd")) || 
                                       content.includes(game.i18n.localize("DX3rd.ActionDelay")) ||
                                       (content.includes(game.i18n.localize("DX3rd.Apply")) || 
                                        content.includes(game.i18n.localize("DX3rd.Clear")));
            
            // HP 회복/데미지 메시지 감지
            const isHpMessage = content.includes('HP') && (content.includes(game.i18n.localize('DX3rd.Healing')) || content.includes(game.i18n.localize('DX3rd.DamageToHP')));
            
            // 사독 체크 메시지 감지
            const isPoisonCheckMessage = content.includes(game.i18n.localize('DX3rd.PoisonedCheck'));
            
            if (isConditionMessage || isHpMessage || isPoisonCheckMessage) {
                return;
            }

            // 롤 타입 메시지 또는 시스템 버튼이 포함된 메시지이고 
            // 이미 액터가 스피커로 명시적으로 설정된 경우 변경 무시
            // (어택 롤, 스탯 롤, 데미지 롤, 데미지 롤 버튼, 데미지 적용 버튼 등)
            const isRollMessage = data.rolls?.length > 0;
            const hasSystemButton = content.includes('damage-roll-btn') || 
                                    content.includes('damage-apply-btn') || 
                                    content.includes('attack-roll-btn') ||
                                    content.includes('dx3rd-win-check-btn');
            
            if ((isRollMessage || hasSystemButton) && data.speaker && data.speaker.actor) {
                const speakerActor = game.actors.get(data.speaker.actor);
                if (speakerActor) {
                    return; // 이미 설정된 액터 스피커 유지
                }
            }

        } catch (e) {
            console.warn('DX3rd | preCreateChatMessage speaker adjust failed:', e);
        }
    });


    // 장면 개막 시 체크된 유저에게 "장면 등장" 전용 다이얼로그 표시 (충동/공포 버튼 없음)
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
        document.body.appendChild(dialog);

        const runEnterScene = async () => {
            const character = game.user.character;
            if (!character) {
                ui.notifications.warn("플레이어 캐릭터가 설정되지 않았습니다.");
                return;
            }
            // 액터만 스피커로 지정 (token 미지정 → GM 포함 모든 클라이언트에서 액터 초상화 사용)
            const enterSceneSpeaker = (() => {
                const s = ChatMessage.getSpeaker({ actor: character });
                return { ...s, token: null, scene: null };
            })();
            const entryEncroachment = game.settings.get("dx3rd-emanim", "entryEncroachment");
            if (!entryEncroachment) {
                const roll = new Roll("1d10");
                await roll.evaluate();
                const rollValue = roll.total;
                const currentEncroachment = Number(character.system.attributes.encroachment.value) || 0;
                const newEncroachment = currentEncroachment + rollValue;
                await character.update({ "system.attributes.encroachment.value": newEncroachment });
                const messageContent = `
                    <div class="dx3rd-item-chat">
                        <div style="font-weight: bold;">${character.name} ${game.i18n.localize("DX3rd.EnterScene")}</div>
                        <div>${game.i18n.localize("DX3rd.Encroachment")} +${rollValue} ( ${currentEncroachment} → ${newEncroachment} )</div>
                    </div>`;
                await ChatMessage.create({ content: messageContent, speaker: enterSceneSpeaker });
                await ChatMessage.create({ speaker: enterSceneSpeaker, rolls: [roll] });
            } else {
                const encroachmentIncrease = 1;
                const currentEncroachment = Number(character.system.attributes.encroachment.value) || 0;
                const newEncroachment = currentEncroachment + encroachmentIncrease;
                await character.update({ "system.attributes.encroachment.value": newEncroachment });
                const messageContent = `
                    <div class="dx3rd-item-chat">
                        <div style="font-weight: bold;">${character.name} ${game.i18n.localize("DX3rd.EnterScene")}</div>
                        <div>${game.i18n.localize("DX3rd.Encroachment")} +${encroachmentIncrease} ( ${currentEncroachment} → ${newEncroachment} )</div>
                    </div>`;
                await ChatMessage.create({ content: messageContent, speaker: enterSceneSpeaker });
            }
        };

        document.getElementById("dx3rd-scene-enter-ok").addEventListener("click", async () => {
            dialog.remove();
            await runEnterScene();
        });
        document.getElementById("dx3rd-scene-enter-cancel").addEventListener("click", () => dialog.remove());
    }

    // 소켓 리스너 등록
    game.socket.on('system.dx3rd-emanim', async (data) => {

        if (data.type === 'showSceneEnterDialog') {
            if (data.userId === game.user.id) {
                showSceneEnterDialogOnly();
            }
            return;
        }

        if (data.type === 'healRequest') {
            // HP 회복 요청 (GM만 처리)
            if (game.user.isGM && window.DX3rdUniversalHandler && window.DX3rdUniversalHandler.handleHealRequest) {
                await window.DX3rdUniversalHandler.handleHealRequest(data.requestData);
            }
            return;
        }

        if (data.type === 'statusClearRequest') {
            // 상태이상(배드 스테이터스) 소거 요청 (GM만 처리)
            if (game.user.isGM && window.DX3rdUniversalHandler && window.DX3rdUniversalHandler.handleStatusClearRequest) {
                await window.DX3rdUniversalHandler.handleStatusClearRequest(data.requestData);
            }
            return;
        }

        if (data.type === 'encroachRequest') {
            // 침식률 조정(대상 침식 감소) 요청 (GM만 처리)
            if (game.user.isGM && window.DX3rdUniversalHandler && window.DX3rdUniversalHandler.handleEncroachRequest) {
                await window.DX3rdUniversalHandler.handleEncroachRequest(data.requestData);
            }
            return;
        }
        
        if (data.type === 'healRejected') {
            // HP 회복 거부 알림 (요청자만 처리)
            if (data.data.userId === game.user.id) {
                ui.notifications.warn('GM이 HP 회복 요청을 거부했습니다.');
            }
            return;
        }
        
        if (data.type === 'addToAfterMainQueue') {
            // AfterMain 큐 추가 요청 (GM만 처리)
            if (!game.user.isGM) return;
            
            const { extensionType, actorId, extensionData, itemId } = data.data;
            const actor = game.actors.get(actorId);
            const item = itemId ? actor?.items.get(itemId) : null;
            
            if (actor && window.DX3rdUniversalHandler?.addToAfterMainQueue) {
                window.DX3rdUniversalHandler.addToAfterMainQueue(actor, extensionData, item, extensionType);
            }
            return;
        }
        
        if (data.type === 'setRangeHighlight') {
            // 범위 하이라이트 설정 요청 (모든 사용자가 처리)
            await window.DX3rdUniversalHandler.processRangeHighlightQueue(data.data);
            return;
        }
        
        if (data.type === 'setSpellCalamityHighlight') {
            // SpellCalamity 하이라이트 설정 요청 (모든 사용자가 처리)
            if (window.DX3rdSpellHandler && window.DX3rdSpellHandler.drawSpellCalamityHighlight) {
                const token = canvas.tokens?.placeables?.find(t => t.id === data.data.tokenId);
                if (token && data.data.position) {
                    await window.DX3rdSpellHandler.drawSpellCalamityHighlight(token, data.data.range, data.data.userColor, data.data.position);
                    // 하이라이트 데이터 저장
                    if (!window.DX3rdSpellCalamityHighlightData) {
                        window.DX3rdSpellCalamityHighlightData = [];
                    }
                    window.DX3rdSpellCalamityHighlightData.push(data.data);
                }
            }
            return;
        }
        
        if (data.type === 'clearSpellCalamityHighlight') {
            // SpellCalamity 하이라이트 제거 요청 (모든 사용자가 처리)
            if (window.DX3rdSpellHandler && window.DX3rdSpellHandler.clearSpellCalamityHighlight) {
                window.DX3rdSpellHandler.clearSpellCalamityHighlight(data.data.tokenId);
            }
            return;
        }
        
        if (data.type === 'addDeathMark') {
            // Death mark 추가 요청 (모든 사용자가 처리)
            if (canvas.scene && canvas.scene.id === data.data.sceneId) {
                const tokenDoc = canvas.scene.tokens.get(data.data.tokenId);
                if (tokenDoc) {
                    const tokenObj = tokenDoc.object;
                    if (tokenObj && !tokenObj.dx3rdDeathMark && window.addDeathMarkToToken) {
                        await window.addDeathMarkToToken(tokenObj);
                        tokenObj.refresh();
                    }
                }
            }
            return;
        }
        
        if (data.type === 'removeDeathMark') {
            // Death mark 제거 요청 (모든 사용자가 처리)
            if (canvas.scene && canvas.scene.id === data.data.sceneId) {
                const tokenDoc = canvas.scene.tokens.get(data.data.tokenId);
                if (tokenDoc) {
                    const tokenObj = tokenDoc.object;
                    if (tokenObj && tokenObj.dx3rdDeathMark && window.removeDeathMarkFromToken) {
                        window.removeDeathMarkFromToken(tokenObj);
                        tokenObj.refresh();
                    }
                }
            }
            return;
        }
        
        if (data.type === 'damageRequest') {
            // HP 데미지 요청 (GM만 처리)
            if (game.user.isGM && window.DX3rdUniversalHandler && window.DX3rdUniversalHandler.handleDamageRequest) {
                await window.DX3rdUniversalHandler.handleDamageRequest(data.requestData);
            }
            return;
        }
        
        if (data.type === 'damageRejected') {
            // HP 데미지 거부 알림 (요청자만 처리)
            if (data.data.userId === game.user.id) {
                ui.notifications.warn('GM이 HP 데미지 요청을 거부했습니다.');
            }
            return;
        }
        
        if (data.type === 'spellRoisSelectRequest') {
            // 로이스 선택 요청 (GM만 처리)
            if (!game.user.isGM || !window.DX3rdSpellHandler) return;
            
            const { actorId, textKey, title, requestType, itemId, availableRois } = data.requestData;
            const actor = game.actors.get(actorId);
            if (!actor) {
                console.error('DX3rd | Actor not found for rois select request:', actorId);
                return;
            }
            
            const item = itemId ? actor.items.get(itemId) : null;
            
            // GM이 다이얼로그 표시
            const options = availableRois.map(rois => 
                `<option value="${rois.id}">${rois.name}</option>`
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

            new Dialog({
                title: title,
                content: template,
                buttons: {
                    confirm: {
                        icon: '<i class="fas fa-check"></i>',
                        label: game.i18n.localize('DX3rd.Confirm'),
                        callback: async (html) => {
                            const selectedId = html.find('#rois-select').val();
                            if (!selectedId) {
                                ui.notifications.warn('로이스를 선택해주세요.');
                                return;
                            }

                            const selectedRois = actor.items.get(selectedId);
                            if (!selectedRois) {
                                ui.notifications.error('선택한 로이스를 찾을 수 없습니다.');
                                return;
                            }

                            // 선택한 로이스와 같은 이름의 액터 찾기
                            const targetActor = window.DX3rdSpellHandler.findActorByRoisName(selectedRois.name);
                            if (!targetActor) {
                                ui.notifications.error(`"${selectedRois.name}"와 같은 이름을 가진 액터를 찾을 수 없습니다.`);
                                return;
                            }

                            // 요청 타입에 따라 처리
                            if (requestType === 'spellDisaster4') {
                                await window.DX3rdSpellHandler.rollSpellDisaster(targetActor, item);
                            } else if (requestType === 'spellCalamity8') {
                                await window.DX3rdSpellHandler.rollSpellCalamity(targetActor, item);
                            } else if (requestType === 'spellCatastrophe9') {
                                await window.DX3rdSpellHandler.rollSpellCatastrophe(targetActor, item);
                            }
                        }
                    },
                    cancel: {
                        icon: '<i class="fas fa-times"></i>',
                        label: game.i18n.localize('DX3rd.Cancel'),
                        callback: () => {}
                    }
                },
                default: 'confirm',
                close: () => {}
            }).render(true);
            
            return;
        }
        
        if (data.type === 'spellCatastrophe7Request') {
            // SpellCatastrophe 7 요청 (GM만 처리)
            if (!game.user.isGM || !window.DX3rdSpellHandler) return;
            
            const { actorId } = data.requestData;
            const actor = game.actors.get(actorId);
            if (!actor) {
                console.error('DX3rd | Actor not found for SpellCatastrophe 7 request:', actorId);
                return;
            }
            
            // GM이 직접 처리
            await window.DX3rdSpellHandler.executeSpellCatastrophe7(actor);
            return;
        }
        
        if (data.type === 'spellCatastrophe8Request') {
            // SpellCatastrophe 8 요청 (GM만 처리)
            if (!game.user.isGM || !window.DX3rdSpellHandler) return;
            
            const { actorId, itemId } = data.requestData;
            const actor = game.actors.get(actorId);
            if (!actor) {
                console.error('DX3rd | Actor not found for SpellCatastrophe 8 request:', actorId);
                return;
            }
            
            const item = itemId ? actor.items.get(itemId) : null;
            
            // GM이 직접 처리
            await window.DX3rdSpellHandler.executeSpellCatastrophe8(actor, item);
            return;
        }
        
        if (data.type === 'conditionRequest') {
            // 상태이상 요청 (GM만 처리)
            if (game.user.isGM && window.DX3rdUniversalHandler && window.DX3rdUniversalHandler.handleConditionRequest) {
                await window.DX3rdUniversalHandler.handleConditionRequest(data.requestData);
            }
            return;
        }
        
        if (data.type === 'conditionRejected') {
            // 상태이상 거부 알림 (요청자만 처리)
            if (data.data.userId === game.user.id) {
                ui.notifications.warn('GM이 상태이상 요청을 거부했습니다.');
            }
            return;
        }

        if (data.type === 'removeConditionRequest') {
            // 대상측 배드 스테이터스 소거 요청 (GM만 처리)
            if (game.user.isGM && window.DX3rdUniversalHandler?.handleRemoveConditionRequest) {
                await window.DX3rdUniversalHandler.handleRemoveConditionRequest(data.data);
            }
            return;
        }
        
        if (data.type === 'conditionRequestBulk') {
            // 상태이상 다건 요청 (GM만 처리)
            if (game.user.isGM && window.DX3rdUniversalHandler && window.DX3rdUniversalHandler.handleConditionRequestBulk) {
                await window.DX3rdUniversalHandler.handleConditionRequestBulk(data.data);
            }
            return;
        }
        
        if (data.type === 'registerAfterDamageExtension') {
            // AfterDamage 익스텐드 큐 등록 요청 (GM만 처리)
            if (!game.user.isGM) return;
            
            const { attackerId, itemId, targetActorIds, extensions, triggerItemName } = data.payload;
            const queueKey = `${attackerId}_${itemId}`;
            
            if (!window.DX3rdAfterDamageExtensionQueue) {
              window.DX3rdAfterDamageExtensionQueue = {};
            }
            
            window.DX3rdAfterDamageExtensionQueue[queueKey] = {
              attackerId: attackerId,
              itemId: itemId,
              targetActorIds: targetActorIds,
              damageReports: {},
              reportCount: 0,
              extensions: extensions,
              triggerItemName: triggerItemName
            };
            
            return;
        }
        
        if (data.type === 'showDefenseDialog') {
            // 디펜스 다이얼로그 표시 요청
            const targetActor = game.actors.get(data.dialogData.targetActorId);
            
            if (!targetActor || !targetActor.isOwner) {
                return;
            }
            
            // GM이 아닌 접속 중인 소유자가 있으면 GM은 건너뛰기
            if (game.user.isGM) {
                const nonGMOwners = game.users.filter(u => 
                    !u.isGM && 
                    u.active && 
                    targetActor.testUserPermission(u, 'OWNER')
                );
                if (nonGMOwners.length > 0) {
                    return;
                }
            }
            
            // 기존 showDefenseDialog 사용 (queueIndex 포함)
            if (window.DX3rdUniversalHandler && window.DX3rdUniversalHandler.showDefenseDialog) {
                // dialogData를 payload 형식으로 변환
                // queueIndex가 있으면 afterDamage 큐 시스템, 없으면 기존 시스템
                const payload = {
                    ...data.dialogData, // 모든 필드 복사 (damage, penetrate, attackerName 등)
                    queueIndex: data.dialogData.queueIndex // 큐 인덱스 전달 (있으면)
                };
                
                await window.DX3rdUniversalHandler.showDefenseDialog(payload);
            }
            
            return;
        }
        
        if (data.type === 'clearRangeHighlight') {
            // 범위 하이라이트 제거 요청 (소켓으로 받은 경우는 권한 체크 없이 강제 클리어, 소켓 전송 건너뛰기)
            if (window.DX3rdUniversalHandler && window.DX3rdUniversalHandler.clearRangeHighlightQueue) {
                window.DX3rdUniversalHandler.clearRangeHighlightQueue(true, true); // force = true, skipSocket = true
            }
            return;
        }
        
        if (data.type === 'userTyping') {
            // 타이핑 상태 변경 처리 (다른 모듈로 이동됨)
            return;
        }
        
        if (data.type === 'executeAfterDamageMacro') {
            // afterDamage 매크로 실행 요청
            const { attackerId, itemId, targetName, hpChange } = data.payload;
            
            const attacker = game.actors.get(attackerId);
            if (!attacker) {
                console.warn('DX3rd | Attacker not found:', attackerId);
                return;
            }
            
            // 현재 유저가 공격자의 소유자인지 확인
            if (!attacker.isOwner) {
                return;
            }
            
            // GM이 아닌 소유자가 있는지 확인
            const nonGMOwners = game.users.filter(user => 
                !user.isGM && 
                attacker.testUserPermission(user, 'OWNER')
            );
            
            // GM이 아닌 소유자가 있으면 GM은 무시
            if (game.user.isGM && nonGMOwners.length > 0) {
                return;
            }
            
            const item = attacker.items.get(itemId);
            if (item && window.DX3rdUniversalHandler && window.DX3rdUniversalHandler.executeMacros) {
                await window.DX3rdUniversalHandler.executeMacros(item, 'afterDamage');
            }
        } else if (data.type === 'applyItemAttributes') {
            // 아이템 어트리뷰트 적용 요청
            const { sourceActorId, itemId, targetActorId, targetAttributes } = data.payload;
            
            const sourceActor = game.actors.get(sourceActorId);
            const targetActor = game.actors.get(targetActorId);
            
            if (!sourceActor || !targetActor) {
                console.warn('DX3rd | Actor not found');
                return;
            }
            
            // 현재 유저가 타겟 액터의 소유자인지 확인
            if (!targetActor.isOwner) {
                return;
            }
            
            // 접속 중인 GM이 아닌 소유자가 있는지 확인
            const nonGMOwners = game.users.filter(user => 
                !user.isGM && 
                user.active &&  // 접속 중인 유저만
                targetActor.testUserPermission(user, 'OWNER')
            );
            
            // 접속 중인 GM이 아닌 소유자가 있으면 GM은 무시
            if (game.user.isGM && nonGMOwners.length > 0) {
                return;
            }
            
            const item = sourceActor.items.get(itemId);
            if (item && window.DX3rdUniversalHandler && window.DX3rdUniversalHandler._applyItemAttributes) {
                await window.DX3rdUniversalHandler._applyItemAttributes(sourceActor, item, targetActor, targetAttributes);
            }
        } else if (data.type === 'registerAfterDamageActivation') {
            // GM 전용: afterDamage 활성화 요청 등록
            if (!game.user.isGM) {
                return;
            }
            
            const { attackerId, itemId, targetActorIds, shouldExecuteMacro, shouldActivate, shouldApplyToTargets, needsDialog, comboAfterDamageData } = data.payload;
            const queueKey = `${attackerId}_${itemId}`;
            
            // 이미 등록되어 있으면 무시 (중복 방지)
            if (window.DX3rdAfterDamageActivationQueue[queueKey]) {
                return;
            }
            
            window.DX3rdAfterDamageActivationQueue[queueKey] = {
                attackerId: attackerId,
                itemId: itemId,
                targetActorIds: targetActorIds,
                damageReports: {},
                reportCount: 0,
                shouldExecuteMacro: shouldExecuteMacro,
                shouldActivate: shouldActivate,
                shouldApplyToTargets: shouldApplyToTargets,
                needsDialog: needsDialog,
                comboAfterDamageData: comboAfterDamageData, // 콤보 데이터 저장
                timestamp: Date.now()
            };
            
            // 플레이어가 보낸 익스텐드 큐의 queueIndices를 가져와서 디펜스 다이얼로그에 포함
            const storedQueueIndices = window.DX3rdTempQueueIndices?.[queueKey];
            
            if (storedQueueIndices) {
                // payload에 queueIndices 추가해서 다시 디펜스 다이얼로그 전송 요청
                game.socket.emit('system.dx3rd-emanim', {
                    type: 'updateDefenseDialogWithQueue',
                    updateData: {
                        attackerId,
                        itemId,
                        queueIndices: storedQueueIndices
                    }
                });
                
                // 임시 저장소에서 제거
                delete window.DX3rdTempQueueIndices[queueKey];
            }
        } else if (data.type === 'reportDamageForActivation') {
            // GM 전용: 타겟의 HP 변화 보고 수집
            if (!game.user.isGM) {
                return;
            }
            
            const { attackerId, itemId, targetActorId, hpChange } = data.payload;
            const queueKey = `${attackerId}_${itemId}`;
            const request = window.DX3rdAfterDamageActivationQueue?.[queueKey];
            
            if (request) {
                // 보고 기록
                request.damageReports[targetActorId] = hpChange;
                request.reportCount++;
                
                // 모든 타겟이 보고했는지 확인
                if (request.reportCount === request.targetActorIds.length) {
                    // HP 데미지를 받은 타겟 목록
                    const damagedTargets = Object.entries(request.damageReports)
                        .filter(([id, hp]) => hp > 0)
                        .map(([id, hp]) => id);
                    
                    // 최신 아이템 상태로 횟수 체크
                    const attacker = game.actors.get(attackerId);
                    const currentItem = attacker?.items.get(itemId);
                    const usedDisable = currentItem?.system?.used?.disable || 'notCheck';
                    const usedState = currentItem?.system?.used?.state || 0;
                    const usedMax = currentItem?.system?.used?.max || 0;
                    const isUsageExhausted = usedDisable !== 'notCheck' && usedState >= usedMax && usedMax > 0;
                    
                    // 💡 콤보 afterDamage 처리 (HP 데미지 발생 후)
                    const comboData = request.comboAfterDamageData;
                    if (comboData && damagedTargets.length > 0) {
                        // damagedTargets는 Actor ID 배열이므로 Actor 객체로 변환
                        const damagedActors = damagedTargets.map(id => game.actors.get(id)).filter(a => a);
                        if (window.DX3rdUniversalHandler) {
                            await window.DX3rdUniversalHandler.processComboAfterDamage(comboData, damagedActors);
                        }
                    }
                    
                    // 1️⃣ 매크로 실행 (한 명이라도 HP 데미지 받았으면)
                    if (request.shouldExecuteMacro && damagedTargets.length > 0) {
                        game.socket.emit('system.dx3rd-emanim', {
                            type: 'executeAfterDamageMacro',
                            payload: {
                                attackerId: attackerId,
                                itemId: itemId,
                                hpChange: damagedTargets.length
                            }
                        });
                    }
                    
                    // 2️⃣ 활성화/효과 적용 처리
                    if (damagedTargets.length === 0) {
                        // 아무도 데미지 안 받음: NoDamage 알림
                        game.socket.emit('system.dx3rd-emanim', {
                            type: 'showNoDamageNotification',
                            payload: { attackerId: attackerId }
                        });
                    } else if (isUsageExhausted && (request.shouldActivate || request.shouldApplyToTargets)) {
                        // 횟수 소진: 활성화/적용 불가, 아무 작업도 하지 않음
                    } else {
                        // 최소 한 명 데미지 받음 & 횟수 남음: 처리 지시
                        const needsConfirmation = request.needsDialog && usedDisable !== 'notCheck';
                        
                        if (needsConfirmation) {
                            // 무기/비클 + 횟수 제한 있음: 다이얼로그
                            game.socket.emit('system.dx3rd-emanim', {
                                type: 'showAfterDamageDialog',
                                payload: {
                                    attackerId: attackerId,
                                    itemId: itemId,
                                    damagedTargets: damagedTargets,
                                    shouldActivate: request.shouldActivate,
                                    shouldApplyToTargets: request.shouldApplyToTargets
                                }
                            });
                        } else {
                            // 나머지 (무기/비클 notCheck 포함): 자동 활성화
                            game.socket.emit('system.dx3rd-emanim', {
                                type: 'executeAfterDamageActivation',
                                payload: {
                                    actorId: attackerId,
                                    itemId: itemId,
                                    damagedTargets: damagedTargets,
                                    shouldActivate: request.shouldActivate,
                                    shouldApplyToTargets: request.shouldApplyToTargets
                                }
                            });
                        }
                    }
                    
                    // 큐에서 제거
                    delete window.DX3rdAfterDamageActivationQueue[queueKey];
                }
            }
        } else if (data.type === 'executeAfterDamageMacro') {
            // 공격자: GM으로부터 매크로 실행 명령 받음
            const { attackerId, itemId, hpChange } = data.payload;
            
            const attacker = game.actors.get(attackerId);
            if (!attacker) {
                console.warn('DX3rd | Attacker not found:', attackerId);
                return;
            }
            
            // 현재 유저가 공격자의 소유자인지 확인
            if (!attacker.isOwner) {
                return;
            }
            
            // 접속 중인 GM이 아닌 소유자가 있는지 확인
            const nonGMOwners = game.users.filter(user => 
                !user.isGM && 
                user.active &&  // 접속 중인 유저만
                attacker.testUserPermission(user, 'OWNER')
            );
            
            // 접속 중인 GM이 아닌 소유자가 있으면 GM은 무시
            if (game.user.isGM && nonGMOwners.length > 0) {
                return;
            }
            
            const item = attacker.items.get(itemId);
            if (item && window.DX3rdUniversalHandler && window.DX3rdUniversalHandler.executeMacros) {
                await window.DX3rdUniversalHandler.executeMacros(item, 'afterDamage');
            }
        } else if (data.type === 'registerTargetApply') {
            // GM 전용: afterDamage 타이밍의 타겟 효과 적용 요청 등록
            if (!game.user.isGM) {
                return;
            }
            
            const { sourceActorId, itemId, targetActorId, targetAttributes } = data.payload;
            const queueKey = `${targetActorId}_${itemId}`;
            
            window.DX3rdTargetApplyQueue[queueKey] = {
                sourceActorId: sourceActorId,
                itemId: itemId,
                targetActorId: targetActorId,
                targetAttributes: targetAttributes,
                timestamp: Date.now()
            };
        } else if (data.type === 'reportDamageForApply') {
            // GM 전용: 타겟의 데미지 처리 결과 보고받음 (효과 적용용)
            if (!game.user.isGM) {
                return;
            }
            
            const { targetActorId, itemId, hpChange } = data.payload;
            const queueKey = `${targetActorId}_${itemId}`;
            
            // 저장된 요청 확인
            const applyRequest = window.DX3rdTargetApplyQueue[queueKey];
            if (applyRequest) {
                if (hpChange >= 1) {
                    // HP 감소했으면 타겟에게 효과 적용 지시
                    game.socket.emit('system.dx3rd-emanim', {
                        type: 'applyEffectToTarget',
                        payload: {
                            sourceActorId: applyRequest.sourceActorId,
                            itemId: applyRequest.itemId,
                            targetActorId: targetActorId,
                            targetAttributes: applyRequest.targetAttributes
                        }
                    });
                }
                
                // 요청 삭제 (HP 감소 여부 무관)
                delete window.DX3rdTargetApplyQueue[queueKey];
            }
        } else if (data.type === 'showAfterDamageDialog') {
            // 공격자: GM으로부터 afterDamage 다이얼로그 표시 명령 받음
            const { attackerId, itemId, damagedTargets, shouldActivate, shouldApplyToTargets } = data.payload;
            
            const actor = game.actors.get(attackerId);
            if (!actor) {
                console.warn('DX3rd | Attacker actor not found:', attackerId);
                return;
            }
            
            // 현재 유저가 공격자 소유자인지 확인
            if (!actor.isOwner) {
                return;
            }
            
            const item = actor.items.get(itemId);
            if (!item) {
                console.warn('DX3rd | Item not found:', itemId);
                return;
            }
            
            // 다이얼로그 표시
            if (window.DX3rdUniversalHandler && window.DX3rdUniversalHandler._showAfterDamageDialog) {
                await window.DX3rdUniversalHandler._showAfterDamageDialog(actor, item, damagedTargets, shouldActivate, shouldApplyToTargets);
            }
        } else if (data.type === 'executeAfterDamageActivation') {
            // 공격자: GM으로부터 자동 활성화 명령 받음
            const { actorId, itemId, damagedTargets, shouldActivate, shouldApplyToTargets } = data.payload;
            
            const actor = game.actors.get(actorId);
            if (!actor) {
                console.warn('DX3rd | Actor not found:', actorId);
                return;
            }
            
            // 현재 유저가 공격자 소유자인지 확인
            if (!actor.isOwner) {
                return;
            }
            
            const item = actor.items.get(itemId);
            if (!item) {
                console.warn('DX3rd | Item not found:', itemId);
                return;
            }
            
            // 자동 활성화 처리
            const updates = {};
            
            if (shouldActivate) {
                updates['system.active.state'] = true;
            }
            
            if (Object.keys(updates).length > 0) {
                await item.update(updates);
            }
            
            // HP 데미지 받은 타겟에게만 효과 적용
            if (shouldApplyToTargets) {
                for (const targetId of damagedTargets) {
                    const targetActor = game.actors.get(targetId);
                    if (targetActor) {
                        const targetAttributes = item.system.effect?.attributes || {};
                        
                        if (game.user.isGM) {
                            // GM이면 직접 적용
                            await window.DX3rdUniversalHandler._applyItemAttributes(actor, item, targetActor, targetAttributes);
                        } else {
                            // 일반 유저는 소켓 전송
                            game.socket.emit('system.dx3rd-emanim', {
                                type: 'applyItemAttributes',
                                payload: {
                                    sourceActorId: actor.id,
                                    itemId: item.id,
                                    targetActorId: targetId,
                                    targetAttributes: targetAttributes
                                }
                            });
                        }
                    }
                }
            }
        } else if (data.type === 'showNoDamageNotification') {
            // 공격자: 아무도 데미지를 받지 않음 알림
            const { attackerId } = data.payload;
            
            const actor = game.actors.get(attackerId);
            if (!actor) return;
            
            // 현재 유저가 공격자 소유자인지 확인
            if (!actor.isOwner) {
                return;
            }
            
            // 알림 다이얼로그 표시
            new Dialog({
                title: game.i18n.localize('DX3rd.NoDamage'),
                content: `<p>${game.i18n.localize('DX3rd.NoDamageText')}</p>`,
                buttons: {
                    confirm: {
                        icon: '<i class="fas fa-check"></i>',
                        label: game.i18n.localize('DX3rd.Confirm'),
                        callback: () => {}
                    }
                },
                default: 'confirm'
            }).render(true);
        } else if (data.type === 'applyEffectToTarget') {
            // 타겟 소유자: GM으로부터 효과 적용 명령 받음
            const { sourceActorId, itemId, targetActorId, targetAttributes } = data.payload;
            
            const sourceActor = game.actors.get(sourceActorId);
            const targetActor = game.actors.get(targetActorId);
            
            if (!sourceActor || !targetActor) {
                console.warn('DX3rd | Actor not found');
                return;
            }
            
            // 현재 유저가 타겟 액터의 소유자인지 확인
            if (!targetActor.isOwner) {
                return;
            }
            
            // 접속 중인 GM이 아닌 소유자가 있는지 확인
            const nonGMOwners = game.users.filter(user => 
                !user.isGM && 
                user.active &&  // 접속 중인 유저만
                targetActor.testUserPermission(user, 'OWNER')
            );
            
            // 접속 중인 GM이 아닌 소유자가 있으면 GM은 무시
            if (game.user.isGM && nonGMOwners.length > 0) {
                return;
            }
            
            const item = sourceActor.items.get(itemId);
            if (item && window.DX3rdUniversalHandler && window.DX3rdUniversalHandler._applyItemAttributes) {
                await window.DX3rdUniversalHandler._applyItemAttributes(sourceActor, item, targetActor, targetAttributes);
            }
        }
    });
});

// Enter 시 인라인 수정 저장 (편집 모드일 때만) - 다른 모듈로 이동됨

// 편집 플래그 변경 시 DOM 반영 (모든 클라이언트)
Hooks.on('updateChatMessage', (message, changes, options, userId) => {
    try {
        const flagChanges = changes?.flags?.['dx3rd-emanim'];
        if (!flagChanges) return;
        
        const $messageElement = $(`[data-message-id="${message.id}"]`);
        if (!$messageElement.length) return;
        
        // 편집 플래그 처리
        if (flagChanges.editingBy !== undefined) {
            if (message.flags?.['dx3rd-emanim']?.editingBy) {
                $messageElement.addClass('dx3rd-editing-message');
            } else {
                $messageElement.removeClass('dx3rd-editing-message');
            }
        }
        
        // 완료 플래그 처리 (버튼 텍스트 업데이트)
        const completeText = game.i18n.localize('DX3rd.Complete');
        
        // successCompleted 플래그 처리
        if (flagChanges.successCompleted !== undefined) {
            const button = $messageElement.find('.dx3rd-success-btn');
            if (button.length > 0) {
                const isCompleted = message.flags?.['dx3rd-emanim']?.successCompleted === true;
                if (isCompleted) {
                    // 완료 상태로 변경
                    const currentText = button.text().trim();
                    if (!currentText.includes(completeText)) {
                        // 원본 텍스트 저장 (없으면 현재 텍스트 사용)
                        if (!button.data('original-text')) {
                            button.data('original-text', currentText);
                        }
                        const originalText = button.data('original-text') || currentText;
                        button.text(`${originalText} ${completeText}`);
                    }
                } else {
                    // 롤백: 원본 텍스트로 복원
                    const originalText = button.data('original-text');
                    if (originalText) {
                        button.text(originalText);
                    } else {
                        // 원본 텍스트가 없으면 현재 텍스트에서 완료 텍스트 제거
                        const currentText = button.text().trim();
                        button.text(currentText.replace(` ${completeText}`, ''));
                    }
                }
            }
        }
        
        // damageRollCompleted 플래그 처리
        if (flagChanges.damageRollCompleted !== undefined) {
            const button = $messageElement.find('.damage-roll-btn');
            if (button.length > 0) {
                const isCompleted = message.flags?.['dx3rd-emanim']?.damageRollCompleted === true;
                if (isCompleted) {
                    // 완료 상태로 변경
                    const currentText = button.text().trim();
                    if (!currentText.includes(completeText)) {
                        // 원본 텍스트 저장 (없으면 현재 텍스트 사용)
                        if (!button.data('original-text')) {
                            button.data('original-text', currentText);
                        }
                        const originalText = button.data('original-text') || currentText;
                        button.text(`${originalText} ${completeText}`);
                    }
                } else {
                    // 롤백: 원본 텍스트로 복원
                    const originalText = button.data('original-text');
                    if (originalText) {
                        button.text(originalText);
                    } else {
                        // 원본 텍스트가 없으면 현재 텍스트에서 완료 텍스트 제거
                        const currentText = button.text().trim();
                        button.text(currentText.replace(` ${completeText}`, ''));
                    }
                }
            }
        }
        
        // damageApplyCompleted 플래그 처리
        if (flagChanges.damageApplyCompleted !== undefined) {
            const button = $messageElement.find('.damage-apply-btn');
            if (button.length > 0) {
                const isCompleted = message.flags?.['dx3rd-emanim']?.damageApplyCompleted === true;
                if (isCompleted) {
                    // 완료 상태로 변경
                    const currentText = button.text().trim();
                    if (!currentText.includes(completeText)) {
                        // 원본 텍스트 저장 (없으면 현재 텍스트 사용)
                        if (!button.data('original-text')) {
                            button.data('original-text', currentText);
                        }
                        const originalText = button.data('original-text') || currentText;
                        button.text(`${originalText} ${completeText}`);
                    }
                } else {
                    // 롤백: 원본 텍스트로 복원
                    const originalText = button.data('original-text');
                    if (originalText) {
                        button.text(originalText);
                    } else {
                        // 원본 텍스트가 없으면 현재 텍스트에서 완료 텍스트 제거
                        const currentText = button.text().trim();
                        button.text(currentText.replace(` ${completeText}`, ''));
                    }
                }
            }
        }
        
        // attackRollCompleted 플래그 처리
        if (flagChanges.attackRollCompleted !== undefined) {
            const button = $messageElement.find('.attack-roll-btn');
            if (button.length > 0) {
                const isCompleted = message.flags?.['dx3rd-emanim']?.attackRollCompleted === true;
                if (isCompleted) {
                    // 완료 상태로 변경
                    const currentText = button.text().trim();
                    if (!currentText.includes(completeText)) {
                        // 원본 텍스트 저장 (없으면 현재 텍스트 사용)
                        if (!button.data('original-text')) {
                            button.data('original-text', currentText);
                        }
                        const originalText = button.data('original-text') || currentText;
                        button.text(`${originalText} ${completeText}`);
                    }
                } else {
                    // 롤백: 원본 텍스트로 복원
                    const originalText = button.data('original-text');
                    if (originalText) {
                        button.text(originalText);
                    } else {
                        // 원본 텍스트가 없으면 현재 텍스트에서 완료 텍스트 제거
                        const currentText = button.text().trim();
                        button.text(currentText.replace(` ${completeText}`, ''));
                    }
                }
            }
        }
        
        // invokeCompleted 플래그 처리
        if (flagChanges.invokeCompleted !== undefined) {
            const button = $messageElement.find('.invoke-spell');
            if (button.length > 0) {
                const isCompleted = message.flags?.['dx3rd-emanim']?.invokeCompleted === true;
                if (isCompleted) {
                    // 완료 상태로 변경
                    const currentText = button.text().trim();
                    if (!currentText.includes(completeText)) {
                        // 원본 텍스트 저장 (없으면 현재 텍스트 사용)
                        if (!button.data('original-text')) {
                            button.data('original-text', currentText);
                        }
                        const originalText = button.data('original-text') || currentText;
                        button.text(`${originalText} ${completeText}`);
                    }
                } else {
                    // 롤백: 원본 텍스트로 복원
                    const originalText = button.data('original-text');
                    if (originalText) {
                        button.text(originalText);
                    } else {
                        // 원본 텍스트가 없으면 현재 텍스트에서 완료 텍스트 제거
                        const currentText = button.text().trim();
                        button.text(currentText.replace(` ${completeText}`, '').trim());
                    }
                }
            }
        }
        
        // winCheckCompleted 플래그 처리
        if (flagChanges.winCheckCompleted !== undefined) {
            const button = $messageElement.find('.dx3rd-win-check-btn');
            if (button.length > 0) {
                const isCompleted = message.flags?.['dx3rd-emanim']?.winCheckCompleted === true;
                if (isCompleted) {
                    // 완료 상태로 변경
                    const currentText = button.text().trim();
                    if (!currentText.includes(completeText)) {
                        // 원본 텍스트 저장 (없으면 현재 텍스트 사용)
                        if (!button.data('original-text')) {
                            button.data('original-text', currentText);
                        }
                        const originalText = button.data('original-text') || currentText;
                        button.text(`${originalText} ${completeText}`);
                    }
                } else {
                    // 롤백: 원본 텍스트로 복원
                    const originalText = button.data('original-text');
                    if (originalText) {
                        button.text(originalText);
                    } else {
                        // 원본 텍스트가 없으면 현재 텍스트에서 완료 텍스트 제거
                        const currentText = button.text().trim();
                        button.text(currentText.replace(` ${completeText}`, '').trim());
                    }
                }
            }
        }
        
        // itemUseCompleted 플래그 처리 (아이템별로 관리)
        if (flagChanges.itemUseCompleted !== undefined) {
            // 플래그가 undefined로 설정된 경우(삭제된 경우)도 처리
            const itemUseCompleted = message.flags?.['dx3rd-emanim']?.itemUseCompleted || {};
            const allUseButtons = $messageElement.find('.use-item-btn');
            
            allUseButtons.each((index, btn) => {
                const $button = $(btn);
                const itemId = $button.data('item-id');
                if (!itemId) return;
                
                const isCompleted = itemUseCompleted[itemId] === true;
                if (isCompleted) {
                    // 완료 상태로 변경
                    const currentText = $button.text().trim();
                    if (!currentText.includes(completeText)) {
                        // 원본 텍스트 저장 (없으면 현재 텍스트 사용)
                        if (!$button.data('original-text')) {
                            $button.data('original-text', currentText);
                        }
                        const originalText = $button.data('original-text') || currentText;
                        $button.text(`${originalText} ${completeText}`);
                    }
                } else {
                    // 롤백: 원본 텍스트로 복원
                    const originalText = $button.data('original-text');
                    if (originalText) {
                        $button.text(originalText);
                    } else {
                        // 원본 텍스트가 없으면 현재 텍스트에서 완료 텍스트 제거
                        const currentText = $button.text().trim();
                        $button.text(currentText.replace(` ${completeText}`, '').trim());
                    }
                }
            });
        }
    } catch (e) { 
        console.error('DX3rd | updateChatMessage hook error:', e);
    }
});

// 채팅 명령어로 Disable Hook 실행
Hooks.on('chatMessage', (chatLog, message, chatData) => {
    // /disable 명령어 처리
    const disablePattern = /^\/disable\s+(roll|major|reaction|guard|main|round|scene|session)$/i;
    const match = message.match(disablePattern);
    
    if (match) {
        const timing = match[1].toLowerCase();
        window.DX3rdDisableHooks.executeDisableHook(timing);
        return false; // 채팅 메시지 전송 차단
    }
    
    return true; // 일반 채팅 메시지는 정상 처리
});

// 채팅 메시지 렌더링 시 완료 상태 복원
Hooks.on('renderChatMessageHTML', (message, html, data) => {
    const completeText = game.i18n.localize('DX3rd.Complete');
    
    // message-header에 data-actor-id 속성 추가 (로이스 추가 기능을 위해)
    if (message.speaker && message.speaker.actor) {
        const messageHeader = html.querySelector('.message-header');
        if (messageHeader && !messageHeader.getAttribute('data-actor-id')) {
            messageHeader.setAttribute('data-actor-id', message.speaker.actor);
        }
    }
    
    // invoke-spell 버튼 완료 상태 복원
    const invokeCompleted = message.getFlag('dx3rd-emanim', 'invokeCompleted');
    if (invokeCompleted === true) {
        const button = html.querySelector('.invoke-spell');
        if (button) {
            const currentText = button.textContent.trim();
            
            // 이미 "완료"가 포함되어 있으면 중복 추가 방지
            if (!currentText.includes(completeText)) {
                const itemDataStr = button.getAttribute('data-item-data');
                let itemName = game.i18n.localize('DX3rd.Spell');
                
                if (itemDataStr) {
                    try {
                        const itemData = JSON.parse(itemDataStr);
                        itemName = itemData.name || itemName;
                    } catch (e) {
                        // 파싱 실패 시 무시
                    }
                }
                
                button.textContent = `${itemName} ${game.i18n.localize('DX3rd.Invoking')} ${completeText}`;
            }
        }
    }
    
    // damage-roll-btn 완료 상태 복원
    const damageRollCompleted = message.getFlag('dx3rd-emanim', 'damageRollCompleted');
    if (damageRollCompleted === true) {
        const button = html.querySelector('.damage-roll-btn');
        if (button) {
            const currentText = button.textContent.trim();
            if (!currentText.includes(completeText)) {
                // 원본 텍스트는 버튼의 현재 텍스트에서 완료 텍스트를 제거하거나, 로컬라이즈 키에서 가져오기
                const originalText = currentText || game.i18n.localize('DX3rd.DamageRoll');
                button.textContent = `${originalText} ${completeText}`;
            }
        }
    }
    
    // damage-apply-btn 완료 상태 복원
    const damageApplyCompleted = message.getFlag('dx3rd-emanim', 'damageApplyCompleted');
    if (damageApplyCompleted === true) {
        const button = html.querySelector('.damage-apply-btn');
        if (button) {
            const currentText = button.textContent.trim();
            if (!currentText.includes(completeText)) {
                // 원본 텍스트는 버튼의 현재 텍스트에서 완료 텍스트를 제거하거나, 로컬라이즈 키에서 가져오기
                const originalText = currentText || game.i18n.localize('DX3rd.DamageApply');
                button.textContent = `${originalText} ${completeText}`;
            }
        }
    }
    
    // attack-roll-btn 완료 상태 복원
    const attackRollCompleted = message.getFlag('dx3rd-emanim', 'attackRollCompleted');
    if (attackRollCompleted === true) {
        const button = html.querySelector('.attack-roll-btn');
        if (button) {
            const currentText = button.textContent.trim();
            if (!currentText.includes(completeText)) {
                // 원본 텍스트는 버튼의 현재 텍스트에서 완료 텍스트를 제거하거나, 로컬라이즈 키에서 가져오기
                const originalText = currentText || game.i18n.localize('DX3rd.AttackRoll');
                button.textContent = `${originalText} ${completeText}`;
            }
        }
    }
    
    // dx3rd-success-btn 완료 상태 복원
    const successCompleted = message.getFlag('dx3rd-emanim', 'successCompleted');
    if (successCompleted === true) {
        const button = html.querySelector('.dx3rd-success-btn');
        if (button) {
            const currentText = button.textContent.trim();
            if (!currentText.includes(completeText)) {
                // 원본 텍스트는 버튼의 현재 텍스트에서 완료 텍스트를 제거
                const originalText = currentText || game.i18n.localize('DX3rd.Success');
                button.textContent = `${originalText} ${completeText}`;
            }
        }
    }
    
    // dx3rd-win-check-btn 완료 상태 복원
    const winCheckCompleted = message.getFlag('dx3rd-emanim', 'winCheckCompleted');
    if (winCheckCompleted === true) {
        const button = html.querySelector('.dx3rd-win-check-btn');
        if (button) {
            const currentText = button.textContent.trim();
            if (!currentText.includes(completeText)) {
                // 원본 텍스트는 버튼의 현재 텍스트에서 완료 텍스트를 제거하거나, 현재 텍스트 사용
                const originalText = currentText || game.i18n.localize('DX3rd.WinCheck');
                button.textContent = `${originalText} ${completeText}`;
            }
        }
    }
    
    // use-item-btn 완료 상태 복원 (아이템별로 관리)
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
                    // 원본 텍스트는 버튼의 현재 텍스트에서 완료 텍스트를 제거하거나, 현재 텍스트 사용
                    const originalText = currentText || game.i18n.localize('DX3rd.Use');
                    button.textContent = `${originalText} ${completeText}`;
                }
            }
        });
    }

    // protect 장비 해제 버튼
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

// 채팅 토글 매니저
window.DX3rdChatToggleManager = {
    initialized: false,
    
    initialize() {
        if (this.initialized) return;
        this.initialized = true;
        
        // 전역 이벤트 위임 등록
        $(document).off('click.dx3rd-global-toggle').on('click.dx3rd-global-toggle', '.item-name-toggle, .combo-toggle-btn, .book-toggle-btn', (event) => {
            event.preventDefault();
            event.stopPropagation();
            
            // Foundry VTT 채팅 메시지 구조 확인
            const messageElement = $(event.currentTarget).closest('.message');
            
            // 클릭된 요소에 따라 다른 선택자 사용
            let collapsibleElements;
            if ($(event.currentTarget).hasClass('combo-toggle-btn')) {
                // 콤보 토글 버튼의 경우, 다이얼로그 표시
                const section = $(event.currentTarget).data('combo-section');
                if (window.DX3rdChatHandlers && window.DX3rdChatHandlers.showComboItemsDialog) {
                    window.DX3rdChatHandlers.showComboItemsDialog(messageElement, section);
                }
                return;
            } else if ($(event.currentTarget).hasClass('book-toggle-btn')) {
                // 마도서 토글 버튼의 경우, 다이얼로그 표시
                const section = $(event.currentTarget).data('book-section');
                if (window.DX3rdChatHandlers && window.DX3rdChatHandlers.showBookItemsDialog) {
                    window.DX3rdChatHandlers.showBookItemsDialog(messageElement, section);
                }
                return;
            } else {
                // 아이템 이름 토글의 경우, 모든 collapsible-content 토글
                collapsibleElements = messageElement.find('.collapsible-content');
                if (collapsibleElements.length === 0) {
                    // message-content 내부에서 찾기
                    const messageContent = messageElement.find('.message-content');
                    collapsibleElements = messageContent.find('.collapsible-content');
                }
                if (collapsibleElements.length === 0) {
                    // 직접 message 내부에서 찾기
                    collapsibleElements = messageElement.find('.collapsible-content');
                }
            }
            
            if (collapsibleElements.length === 0) {
                return;
            }
            
            // 애니메이션 중복 방지
            if (collapsibleElements.is(':animated')) {
                return;
            }
            
            if (collapsibleElements.hasClass('collapsed')) {
                collapsibleElements.removeClass('collapsed').slideDown(250, 'swing');
            } else {
                collapsibleElements.slideUp(250, 'swing', () => {
                    collapsibleElements.addClass('collapsed');
                });
            }
        });
        
        // 기존 채팅 메시지 초기화
        if (window.DX3rdChatHandlers && window.DX3rdChatHandlers.initializeExistingMessages) {
            window.DX3rdChatHandlers.initializeExistingMessages();
        }
        
        // 술식 발동 버튼 클릭 리스너 등록
        $(document).off('click.dx3rd-invoke-spell').on('click.dx3rd-invoke-spell', '.invoke-spell', async (event) => {
            event.preventDefault();
            event.stopPropagation();
            
            const button = $(event.currentTarget);
            
            // getTarget 정보 읽기 (data 속성에서)
            const getTargetAttr = button.data('get-target');
            const getTarget = getTargetAttr === true || getTargetAttr === 'true';
            
            // getTarget이 체크되어 있으면 타겟 확인
            if (getTarget) {
                const targets = Array.from(game.user.targets);
                if (targets.length === 0) {
                    ui.notifications.warn(game.i18n.localize('DX3rd.SelectTarget'));
                    return;
                }
            }
            
            // 메시지 찾기
            const messageElement = button.closest('.message');
            const messageId = messageElement.data('message-id');
            const message = game.messages.get(messageId);
            
            if (!message) {
                ui.notifications.error('메시지를 찾을 수 없습니다.');
                return;
            }
            
            const isCompleted = message.getFlag('dx3rd-emanim', 'invokeCompleted') === true;
            
            // 원본 텍스트 저장 (처음 한 번만)
            if (!button.data('original-text')) {
                const originalText = button.text().trim();
                button.data('original-text', originalText);
            }
            
            // 이미 완료된 버튼을 클릭한 경우 롤백
            if (isCompleted) {
                await message.unsetFlag('dx3rd-emanim', 'invokeCompleted');
                return;
            }
            
            const actorId = button.data('actor-id');
            const itemId = button.data('item-id');
            const itemDataStr = button.attr('data-item-data');
            
            if (!actorId) {
                ui.notifications.error('액터 정보를 찾을 수 없습니다.');
                return;
            }
            
            const actor = game.actors.get(actorId);
            if (!actor) {
                ui.notifications.error('액터를 찾을 수 없습니다.');
                return;
            }
            
            // 권한 체크
            if (!actor.isOwner && !game.user.isGM) {
                console.warn('DX3rd | User lacks permission to use this actor\'s actions');
                return;
            }
            
            // 저장된 아이템 데이터 파싱
            let itemData = null;
            if (itemDataStr) {
                try {
                    itemData = JSON.parse(itemDataStr);
                } catch (e) {
                    console.error('DX3rd | Failed to parse item data:', e);
                }
            }
            
            // 아이템 데이터가 없으면 실제 아이템에서 가져오기
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
            
            // 실제 아이템 가져오기 (최신 상태)
            const item = actor.items.get(itemId);
            if (!item) {
                ui.notifications.error('아이템을 찾을 수 없습니다.');
                return;
            }
            
            const handler = window.DX3rdUniversalHandler;
            if (handler) {
                // active.runTiming이 'afterSuccess'인 경우 활성화 (disable이 'notCheck'가 아닌 경우에만)
                const activeDisable = item.system?.active?.disable ?? '-';
                if (item.system.active?.runTiming === 'afterSuccess' && !item.system.active?.state && activeDisable !== 'notCheck') {
                    await item.update({ 'system.active.state': true });
                    console.log("DX3rd | Spell invoke - Active checked (afterSuccess timing)");
                }
                
                // 'afterSuccess' 매크로 실행 (50ms 딜레이)
                await new Promise(resolve => setTimeout(resolve, 50));
                await handler.executeMacros(item, 'afterSuccess');
                
                // 'afterSuccess' 타겟 효과 적용
                await handler.applyToTargets(actor, item, 'afterSuccess');
                
                // afterSuccess 타이밍 heal/damage/condition 익스텐션을 handleSuccessButton과 동일하게 처리
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
                    
                    // GM이면 직접 처리만 (소켓 전송 안 함)
                    if (game.user.isGM) {
                        await handler.handleHealRequest({
                            actorId: actor.id,
                            healData: healDataWithTargets,
                            itemId: item.id
                        });
                    } else {
                        // 플레이어면 소켓 전송만
                        game.socket.emit('system.dx3rd-emanim', {
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
                    
                    // GM이면 직접 처리만 (소켓 전송 안 함)
                    if (game.user.isGM) {
                        await handler.handleDamageRequest({
                            actorId: actor.id,
                            damageData: damageDataWithTargets,
                            itemId: item.id
                        });
                    } else {
                        // 플레이어: 조건부 공식 입력은 본인 클라이언트에서만 → 확정 후 GM 소켓 처리
                        if (damageDataWithTargets.conditionalFormula && handler.promptConditionalDamageFormula) {
                            const customFormula = await handler.promptConditionalDamageFormula();
                            if (!customFormula) {
                                ui.notifications.warn('조건부 공식 입력이 취소되어 HP 데미지 익스텐션을 건너뜁니다.');
                            } else {
                                damageDataWithTargets = {
                                    ...damageDataWithTargets,
                                    formulaDice: customFormula.dice,
                                    formulaAdd: customFormula.add,
                                    conditionalFormula: false
                                };
                                game.socket.emit('system.dx3rd-emanim', {
                                    type: 'damageRequest',
                                    requestData: {
                                        actorId: actor.id,
                                        damageData: damageDataWithTargets,
                                        itemId: item.id
                                    }
                                });
                            }
                        } else {
                            game.socket.emit('system.dx3rd-emanim', {
                                type: 'damageRequest',
                                requestData: {
                                    actorId: actor.id,
                                    damageData: damageDataWithTargets,
                                    itemId: item.id
                                }
                            });
                        }
                    }
                }
                
                // condition afterSuccess (conditions 배열 또는 기존 단일 형식)
                const condEntries = handler._getConditionEntries?.(itemExtend.condition || {}) || [];
                const afterSuccessConds = condEntries.filter(c => c.timing === 'afterSuccess');
                for (const c of afterSuccessConds) {
                    const conditionDataWithTargets = {
                        ...c,
                        selectedTargetIds,
                        triggerItemName: item.name,
                        triggerItemId: item.id
                    };
                    if (game.user.isGM) {
                        await handler.handleConditionRequest({
                            actorId: actor.id,
                            conditionData: conditionDataWithTargets,
                            itemId: item.id
                        });
                    } else {
                        game.socket.emit('system.dx3rd-emanim', {
                            type: 'conditionRequest',
                            requestData: {
                                actorId: actor.id,
                                conditionData: conditionDataWithTargets,
                                itemId: item.id
                            }
                        });
                    }
                }
                
                // runTiming이 afterSuccess인 경우, afterMain 익스텐드를 큐에 등록
                if (item.system.active?.runTiming === 'afterSuccess') {
                    handler.registerAfterMainExtensions(actor, item, itemExtend);
                }
                
                console.log('DX3rd | Spell invoke - processed afterSuccess timing extensions');
            }
            
            // 발동 시 메이저 비활성화 훅 실행
            if (window.DX3rdDisableHooks) {
                await window.DX3rdDisableHooks.executeDisableHook('major', actor);
            }
            
            // 플래그 설정 (메시지에 저장)
            await message.setFlag('dx3rd-emanim', 'invokeCompleted', true);
            
            // 버튼 완료 상태로 표시
            button.text(`${itemData.name} ${game.i18n.localize('DX3rd.Invoking')} ${game.i18n.localize('DX3rd.Complete')}`);
            
            // 채팅 메시지 출력 (굴림이 있는 경우는 굴림 실행 시 이미 메시지가 생성되므로 여기서는 생성하지 않음)
            const rollType = item.system?.roll ?? '-';
            if (rollType !== 'CastingRoll') {
                const chatContent = `${item.name} ${game.i18n.localize('DX3rd.Invoking')}`;
                const invokeSpeaker = (() => {
                    const s = ChatMessage.getSpeaker({ actor: actor });
                    return { ...s, token: null, scene: null };
                })();
                await ChatMessage.create({
                    content: chatContent,
                    speaker: invokeSpeaker
                });
            }
        });
        
        // 마술 폭주 버튼 클릭 리스너 등록
        $(document).off('click.dx3rd-spell-overflow').on('click.dx3rd-spell-overflow', '.spell-overflow', async (event) => {
            event.preventDefault();
            event.stopPropagation();
            
            const button = $(event.currentTarget);
            const actorId = button.data('actor-id');
            const itemId = button.data('item-id');
            const disasterType = button.data('disaster-type');
            const overflowCount = button.data('overflow-count');
            
            if (!actorId) {
                ui.notifications.error('액터 정보를 찾을 수 없습니다.');
                return;
            }
            
            const actor = game.actors.get(actorId);
            if (!actor) {
                ui.notifications.error('액터를 찾을 수 없습니다.');
                return;
            }
            
            // 권한 체크
            if (!actor.isOwner && !game.user.isGM) {
                console.warn('DX3rd | User lacks permission to use this actor\'s actions');
                return;
            }
            
            // 아이템 가져오기 (선택사항)
            const item = itemId ? actor.items.get(itemId) : null;
            
            // SpellHandler의 handleDisasterButton 호출
            if (window.DX3rdSpellHandler) {
                await window.DX3rdSpellHandler.handleDisasterButton(actor, item, disasterType, overflowCount);
            } else {
                ui.notifications.error('SpellHandler를 찾을 수 없습니다.');
            }
        });
        
        // 데미지 롤 버튼 클릭 리스너 등록
        $(document).off('click.dx3rd-damage-roll').on('click.dx3rd-damage-roll', '.damage-roll-btn', async (event) => {
            event.preventDefault();
            event.stopPropagation();
            
            const button = $(event.currentTarget);
            const messageElement = button.closest('.message');
            const messageId = messageElement.data('message-id');
            const message = game.messages.get(messageId);
            
            if (!message) {
                ui.notifications.error('메시지를 찾을 수 없습니다.');
                return;
            }
            
            const isCompleted = message.getFlag('dx3rd-emanim', 'damageRollCompleted') === true;
            
            // 원본 텍스트 저장 (처음 한 번만)
            if (!button.data('original-text')) {
                button.data('original-text', button.text());
            }
            
            // 이미 완료된 버튼을 클릭한 경우 롤백
            if (isCompleted) {
                await message.unsetFlag('dx3rd-emanim', 'damageRollCompleted');
                return;
            }
            
            const actorId = button.data('actor-id');
            const itemId = button.data('item-id');
            const rollResult = button.data('roll-result');
            
            // 콤보 afterSuccess 데이터 확인
            const comboAfterSuccess = message.getFlag('dx3rd-emanim', 'comboAfterSuccess');
            
            // 개별 보존된 값들 읽기
            const preservedActorAttack = button.data('preserved-actor-attack');
            const preservedActorDamageRoll = button.data('preserved-actor-damage-roll');
            const preservedActorPenetrate = button.data('preserved-actor-penetrate');
            const preservedWeaponAttack = button.data('preserved-weapon-attack');
            const weaponIdsJson = button.data('weapon-ids');
            
            if (!actorId || !itemId) return;
            
            const actor = game.actors.get(actorId);
            // 임시 콤보 확인
            let item = null;
            if (itemId) {
                // 먼저 채팅 메시지에 임시 콤보 데이터가 있는지 확인
                const tempComboItem = message.getFlag('dx3rd-emanim', 'tempComboItem');
                if (tempComboItem && tempComboItem.id === itemId) {
                    item = tempComboItem;
                    // 임시 콤보 객체에 필요한 메서드들 복원
                    if (!item.getFlag) {
                        item.getFlag = () => null;
                        item.setFlag = () => {};
                        item.unsetFlag = () => {};
                    }
                } else {
                    // 일반 아이템
                    item = actor.items.get(itemId);
                }
            }
            
            if (!actor || !item) return;
            
            // 권한 체크
            if (!actor.isOwner && !game.user.isGM) {
                console.warn('DX3rd | User lacks permission to use this actor\'s actions');
                return;
            }
            
            // 액터의 토큰 자동 선택
            const previousToken = canvas.tokens?.controlled?.[0] || null;
            const actorToken = canvas.tokens?.placeables.find(t => t.actor?.id === actor.id);
            if (actorToken) {
                actorToken.control({ releaseOthers: true });
            }
            
            // 보존된 값들 객체 생성
            const preservedValues = {
                actorAttack: preservedActorAttack || 0,
                actorDamageRoll: preservedActorDamageRoll || 0,
                actorPenetrate: preservedActorPenetrate || 0,
                weaponAttack: preservedWeaponAttack || 0 // 이미 선택한 무기들의 공격력이 합산되어 있음
            };
            
            // 사용된 무기들의 attack-used.state 증가 (이펙트/콤보/사이오닉에서 무기 사용한 경우)
            if (weaponIdsJson && typeof weaponIdsJson === 'string' && weaponIdsJson.trim() !== '') {
                const weaponIds = weaponIdsJson.split(',').filter(id => id.trim() !== '');
                if (weaponIds.length > 0) {
                    for (const weaponId of weaponIds) {
                        const weaponItem = actor.items.get(weaponId.trim());
                        // weapon 타입만 attack-used 증가 (vehicle은 attack-used 필드 없음)
                        if (weaponItem && weaponItem.type === 'weapon') {
                            const attackUsedDisable = weaponItem.system['attack-used']?.disable || 'notCheck';
                            if (attackUsedDisable !== 'notCheck') {
                                const currentState = weaponItem.system['attack-used']?.state || 0;
                                await weaponItem.update({ 'system.attack-used.state': currentState + 1 });
                            }
                        }
                    }
                }
            }
            
            // 콤보 afterSuccess 처리 확인
            if (comboAfterSuccess && window.DX3rdUniversalHandler) {
                // 콤보의 병합된 afterSuccess 처리
                await window.DX3rdUniversalHandler.processComboAfterSuccess(comboAfterSuccess);
            }
            
            // 단일 아이템 afterSuccess 처리 (콤보가 아닌 경우만)
            if (!comboAfterSuccess) {
                // 성공 시(afterSuccess) 매크로 실행 (조건 없이 항상 실행)
                if (window.DX3rdUniversalHandler && window.DX3rdUniversalHandler.executeMacros) {
                    await window.DX3rdUniversalHandler.executeMacros(item, 'afterSuccess');
                }
                
                // 성공 시(afterSuccess) 활성화 및 대상 적용 (횟수 체크)
                const activeDisable = item.system?.active?.disable ?? '-';
                const shouldActivate = item.system.active?.runTiming === 'afterSuccess' && !item.system.active?.state && activeDisable !== 'notCheck';
                const shouldApplyToTargets = item.system.effect?.runTiming === 'afterSuccess';
            
                if (shouldActivate || shouldApplyToTargets) {
                    const usedDisable = item.system?.used?.disable || 'notCheck';
                    const usedState = item.system?.used?.state || 0;
                    const usedMax = item.system?.used?.max || 0;
                    
                    // 무기/비클은 다이얼로그 표시, 나머지는 자동 처리
                    if (item.type === 'weapon' || item.type === 'vehicle') {
                        // 횟수 제한 확인 후 다이얼로그 표시
                        if (usedDisable === 'notCheck' || usedState < usedMax) {
                            if (window.DX3rdChatHandlers && window.DX3rdChatHandlers.showAfterSuccessDialog) {
                                await window.DX3rdChatHandlers.showAfterSuccessDialog(actor, item, shouldActivate, shouldApplyToTargets);
                            }
                        }
                        // usedState >= usedMax인 경우 아무것도 안 함 (이미 소진)
                    } else {
                        // 무기/비클이 아닌 경우: 활성화 + 대상 적용 (횟수 증가는 사용 시점에 이미 처리됨)
                        const updates = {};
                        
                        // 1. 활성화
                        if (shouldActivate) {
                            updates['system.active.state'] = true;
                        }
                        
                        if (Object.keys(updates).length > 0) {
                            await item.update(updates);
                        }
                        
                        // 2. 대상 적용
                        if (shouldApplyToTargets && window.DX3rdUniversalHandler) {
                            await window.DX3rdUniversalHandler.applyToTargets(actor, item, 'afterSuccess');
                        }
                    }
                }
            }
            
            // comboAfterDamage 데이터 읽기 (데미지 적용 버튼에 전달)
            const comboAfterDamageData = message.getFlag('dx3rd-emanim', 'comboAfterDamage');
            
            // UniversalHandler의 데미지 롤 함수 호출 (롤 결과와 보존된 값들 포함)
            if (window.DX3rdUniversalHandler && window.DX3rdUniversalHandler.handleDamageRoll) {
                await window.DX3rdUniversalHandler.handleDamageRoll(actor, item, rollResult, preservedValues, comboAfterDamageData);
            }
            
            // afterSuccess 타이밍 heal/damage/condition 익스텐션을 GM을 통해 처리
            // 콤보의 경우 이미 processComboAfterSuccess에서 병합 처리되었으므로 건너뜀
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
                    
                    // GM이면 직접 처리만 (소켓 전송 안 함)
                    if (game.user.isGM && window.DX3rdUniversalHandler) {
                        await window.DX3rdUniversalHandler.handleHealRequest({
                            actorId: actor.id,
                            healData: healDataWithTargets,
                            itemId: item.id
                        });
                    } else {
                        // 플레이어면 소켓 전송만
                        game.socket.emit('system.dx3rd-emanim', {
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
                    
                    // GM이면 직접 처리만 (소켓 전송 안 함)
                    if (game.user.isGM && window.DX3rdUniversalHandler) {
                        await window.DX3rdUniversalHandler.handleDamageRequest({
                            actorId: actor.id,
                            damageData: damageDataWithTargets,
                            itemId: item.id
                        });
                    } else {
                        // 플레이어: 조건부 공식 입력은 본인 클라이언트에서만 → 확정 후 GM 소켓 처리
                        const h = window.DX3rdUniversalHandler;
                        if (damageDataWithTargets.conditionalFormula && h?.promptConditionalDamageFormula) {
                            const customFormula = await h.promptConditionalDamageFormula();
                            if (!customFormula) {
                                ui.notifications.warn('조건부 공식 입력이 취소되어 HP 데미지 익스텐션을 건너뜁니다.');
                            } else {
                                damageDataWithTargets = {
                                    ...damageDataWithTargets,
                                    formulaDice: customFormula.dice,
                                    formulaAdd: customFormula.add,
                                    conditionalFormula: false
                                };
                                game.socket.emit('system.dx3rd-emanim', {
                                    type: 'damageRequest',
                                    requestData: {
                                        actorId: actor.id,
                                        damageData: damageDataWithTargets,
                                        itemId: item.id
                                    }
                                });
                            }
                        } else {
                            game.socket.emit('system.dx3rd-emanim', {
                                type: 'damageRequest',
                                requestData: {
                                    actorId: actor.id,
                                    damageData: damageDataWithTargets,
                                    itemId: item.id
                                }
                            });
                        }
                    }
                }
                
                // condition afterSuccess (conditions 배열 또는 기존 단일 형식)
                const condEntries = window.DX3rdUniversalHandler?._getConditionEntries?.(itemExtend.condition || {}) || [];
                const afterSuccessConds = condEntries.filter(c => c.timing === 'afterSuccess');
                for (const c of afterSuccessConds) {
                    const conditionDataWithTargets = {
                        ...c,
                        selectedTargetIds,
                        triggerItemName: item.name,
                        triggerItemId: item.id
                    };
                    if (game.user.isGM && window.DX3rdUniversalHandler) {
                        await window.DX3rdUniversalHandler.handleConditionRequest({
                            actorId: actor.id,
                            conditionData: conditionDataWithTargets,
                            itemId: item.id
                        });
                    } else {
                        game.socket.emit('system.dx3rd-emanim', {
                            type: 'conditionRequest',
                            requestData: {
                                actorId: actor.id,
                                conditionData: conditionDataWithTargets,
                                itemId: item.id
                            }
                        });
                    }
                }
                
                // runTiming이 afterSuccess인 경우, afterMain 익스텐드를 큐에 등록
                if (item.system.active?.runTiming === 'afterSuccess' && window.DX3rdUniversalHandler) {
                    window.DX3rdUniversalHandler.registerAfterMainExtensions(actor, item, itemExtend);
                }
            }
            
            // 플래그 설정 (updateChatMessage 훅에서 버튼 텍스트 업데이트)
            await message.setFlag('dx3rd-emanim', 'damageRollCompleted', true);
            
            // 이전 토큰 복원
            if (previousToken && canvas.tokens) {
                previousToken.control({ releaseOthers: true });
            }
        });
        
        // 성공 버튼 클릭 리스너 등록
        $(document).off('click.dx3rd-success').on('click.dx3rd-success', '.dx3rd-success-btn', async (event) => {
            event.preventDefault();
            event.stopPropagation();
            
            const button = $(event.currentTarget);
            
            const messageElement = button.closest('.message');
            const messageId = messageElement.data('message-id');
            const message = game.messages.get(messageId);
            
            if (!message) {
                ui.notifications.error('메시지를 찾을 수 없습니다.');
                return;
            }
            
            const isCompleted = message.getFlag('dx3rd-emanim', 'successCompleted') === true;
            
            // 원본 텍스트 저장 (처음 한 번만)
            if (!button.data('original-text')) {
                const originalText = button.text().trim();
                button.data('original-text', originalText);
            }
            
            // 이미 완료된 버튼을 클릭한 경우 롤백
            if (isCompleted) {
                await message.unsetFlag('dx3rd-emanim', 'successCompleted');
                return;
            }
            
            const actorId = button.data('actor-id');
            const itemId = button.data('item-id');
            const previousTokenId = button.data('previous-token-id');
            const weaponAttack = parseInt(button.data('weapon-attack')) || 0;
            
            // UniversalHandler로 처리 (무기 공격력 전달)
            try {
                if (window.DX3rdUniversalHandler) {
                    await window.DX3rdUniversalHandler.handleSuccessButton(actorId, itemId, previousTokenId, weaponAttack);
                }
            } catch (e) {
                console.error('DX3rd | handleSuccessButton error:', e);
                // 에러가 발생해도 완료 처리는 진행
            }
            
            // 플래그 설정 (updateChatMessage 훅에서 버튼 텍스트 업데이트)
            await message.setFlag('dx3rd-emanim', 'successCompleted', true);
            
            // 버튼 텍스트 즉시 업데이트 (다른 클라이언트는 updateChatMessage 훅에서 처리)
            const completeText = game.i18n.localize('DX3rd.Complete');
            const currentText = button.text().trim();
            if (!currentText.includes(completeText)) {
                const originalText = button.data('original-text') || currentText;
                button.text(`${originalText} ${completeText}`);
            }
        });
        
        // 승리 체크 버튼 클릭 리스너 등록
        $(document).off('click.dx3rd-win-check').on('click.dx3rd-win-check', '.dx3rd-win-check-btn', async (event) => {
            event.preventDefault();
            event.stopPropagation();
            
            const button = $(event.currentTarget);
            const messageElement = button.closest('.message');
            const messageId = messageElement.data('message-id');
            const message = game.messages.get(messageId);
            
            if (!message) {
                ui.notifications.error('메시지를 찾을 수 없습니다.');
                return;
            }
            
            const isCompleted = message.getFlag('dx3rd-emanim', 'winCheckCompleted') === true;
            
            // 원본 텍스트 저장 (처음 한 번만)
            if (!button.data('original-text')) {
                button.data('original-text', button.text());
            }
            
            // 이미 완료된 버튼을 클릭한 경우 롤백
            if (isCompleted) {
                await message.unsetFlag('dx3rd-emanim', 'winCheckCompleted');
                button.text(button.data('original-text'));
                return;
            }
            
            const actorId = button.data('actor-id');
            const itemId = button.data('item-id');
            const previousTokenId = button.data('previous-token-id');
            
            // 콤보 afterSuccess 데이터 확인
            const comboAfterSuccess = message.getFlag('dx3rd-emanim', 'comboAfterSuccess');
            
            // UniversalHandler로 처리
            if (window.DX3rdUniversalHandler) {
                if (comboAfterSuccess) {
                    // 콤보의 병합된 afterSuccess 처리
                    await window.DX3rdUniversalHandler.processComboAfterSuccess(comboAfterSuccess);
                } else {
                    // 단일 아이템 afterSuccess 처리 (기존)
                    await window.DX3rdUniversalHandler.handleSuccessButton(actorId, itemId, previousTokenId);
                }
            }
            
            // 플래그 설정 및 버튼 텍스트 변경
            await message.setFlag('dx3rd-emanim', 'winCheckCompleted', true);
            
            // 버튼 텍스트 즉시 업데이트 (다른 클라이언트는 updateChatMessage 훅에서 처리)
            const completeText = game.i18n.localize('DX3rd.Complete');
            const currentText = button.text().trim();
            if (!currentText.includes(completeText)) {
                const originalText = button.data('original-text') || currentText;
                button.text(`${originalText} ${completeText}`);
            }
        });
        
        // 데미지 적용 버튼 클릭 리스너 등록
        $(document).off('click.dx3rd-damage-apply').on('click.dx3rd-damage-apply', '.damage-apply-btn', async (event) => {
            event.preventDefault();
            event.stopPropagation();
            
            const button = $(event.currentTarget);
            const messageElement = button.closest('.message');
            const messageId = messageElement.data('message-id');
            const message = game.messages.get(messageId);
            
            if (!message) {
                ui.notifications.error('메시지를 찾을 수 없습니다.');
                return;
            }
            
            const isCompleted = message.getFlag('dx3rd-emanim', 'damageApplyCompleted') === true;
            
            // 원본 텍스트 저장 (처음 한 번만)
            if (!button.data('original-text')) {
                button.data('original-text', button.text());
            }
            
            // 이미 완료된 버튼을 클릭한 경우 롤백
            if (isCompleted) {
                await message.unsetFlag('dx3rd-emanim', 'damageApplyCompleted');
                return;
            }
            
            const actorId = button.data('actor-id');
            const itemId = button.data('item-id');
            const damage = button.data('damage');
            const penetrate = button.data('penetrate');
            const attackResult = Number(button.data('attack-result')) || 0;
            
            // 권한 체크
            const actor = game.actors.get(actorId);
            if (!actor) {
                console.warn('DX3rd | Actor not found:', actorId);
                return;
            }
            
            if (!actor.isOwner && !game.user.isGM) {
                console.warn('DX3rd | User lacks permission to use this actor\'s actions');
                return;
            }
            
            // 액터의 토큰 자동 선택
            const previousToken = canvas.tokens?.controlled?.[0] || null;
            const actorToken = canvas.tokens?.placeables.find(t => t.actor?.id === actor.id);
            if (actorToken) {
                actorToken.control({ releaseOthers: true });
            }
            
            // 아이템 가져오기 (임시 콤보 확인)
            let item = null;
            if (itemId) {
                // 먼저 채팅 메시지에 임시 콤보 데이터가 있는지 확인
                const tempComboItem = message.getFlag('dx3rd-emanim', 'tempComboItem');
                if (tempComboItem && tempComboItem.id === itemId) {
                    item = tempComboItem;
                    // 임시 콤보 객체에 필요한 메서드들 복원
                    if (!item.getFlag) {
                        item.getFlag = () => null;
                        item.setFlag = () => {};
                        item.unsetFlag = () => {};
                    }
                } else {
                    // 일반 아이템
                    item = actor.items.get(itemId);
                }
            }
            
            // 타겟 체크
            const targets = Array.from(game.user.targets);
            if (targets.length === 0) {
                ui.notifications.warn(game.i18n.localize('DX3rd.SelectTarget'));
                // 이전 토큰 복원
                if (previousToken && canvas.tokens) {
                    previousToken.control({ releaseOthers: true });
                }
                return;
            }
            
            // Hatred 상태이상 체크 (타겟에 hatred.target이 포함되어야 함)
            const hatredActive = actor.system?.conditions?.hatred?.active || false;
            const hatredTarget = actor.system?.conditions?.hatred?.target || '';
            
            if (hatredActive && hatredTarget) {
              // 현재 타겟 중에 hatred.target이 있는지 확인
              const hasHatredTarget = targets.some(t => {
                const targetName = t.actor?.name || t.name;
                return targetName === hatredTarget;
              });
              
              if (!hasHatredTarget) {
                // 에러 메시지 출력 (로컬라이즈 키에서 {target} 플레이스홀더 치환)
                const hatredMessage = game.i18n.localize('DX3rd.MustAttackHatredTarget').replace('{target}', hatredTarget);
                const hatredSpeaker = (() => {
                  const s = ChatMessage.getSpeaker({ actor });
                  return { ...s, token: null, scene: null };
                })();
                await ChatMessage.create({
                  speaker: hatredSpeaker,
                  content: `<div style="color: #ff6b6b;"><strong>${game.i18n.localize('DX3rd.Hatred')}: ${hatredMessage}</strong></div>`
                });
                
                // 이전 토큰 복원
                if (previousToken && canvas.tokens) {
                  previousToken.control({ releaseOthers: true });
                }
                return;
              }
            }
            
            // 콤보 afterDamage 데이터 가져오기
            const comboAfterDamageData = message.getFlag('dx3rd-emanim', 'comboAfterDamage');
            
            // UniversalHandler의 데미지 적용 함수 호출
            // comboAfterDamageData를 전달하여 방어 다이얼로그 콜백에서 처리
            if (window.DX3rdUniversalHandler && window.DX3rdUniversalHandler.handleDamageApply) {
                await window.DX3rdUniversalHandler.handleDamageApply(actor, item, damage, penetrate, targets, comboAfterDamageData, attackResult);
            }

            // 증오 자동 회복은 명중판정 시점(onAttackRollComplete)으로 이관됨.
            // 룰상 성공 여부와 무관하게 회복되므로, 빗나가 데미지 버튼을 누르지 않는 경우도 커버해야 한다.
            // 위 hatred 대상 강제 체크(3595)는 잘못된 대상에 데미지 적용을 막는 안전망으로 유지.

            // 플래그 설정 (updateChatMessage 훅에서 버튼 텍스트 업데이트)
            await message.setFlag('dx3rd-emanim', 'damageApplyCompleted', true);
            
            // 이전 토큰 복원
            if (previousToken && canvas.tokens) {
                previousToken.control({ releaseOthers: true });
            }
        });
        
        // 공격 롤 버튼 클릭 리스너 등록 (무기/비클 전용)
        $(document).off('click.dx3rd-attack-roll').on('click.dx3rd-attack-roll', '.attack-roll-btn', async (event) => {
            event.preventDefault();
            event.stopPropagation();
            
            const button = $(event.currentTarget);
            const itemId = button.data('item-id');
            
            if (!itemId) return;
            
            // 메시지에서 액터 정보 찾기
            const messageElement = button.closest('.message');
            const messageId = messageElement[0]?.dataset?.messageId;
            
            if (!messageId) return;
            
            const message = game.messages.get(messageId);
            if (!message) {
                ui.notifications.error('메시지를 찾을 수 없습니다.');
                return;
            }
            
            const isCompleted = message.getFlag('dx3rd-emanim', 'attackRollCompleted') === true;
            
            // 원본 텍스트 저장 (처음 한 번만)
            if (!button.data('original-text')) {
                button.data('original-text', button.text());
            }
            
            // 이미 완료된 버튼을 클릭한 경우 롤백
            if (isCompleted) {
                await message.unsetFlag('dx3rd-emanim', 'attackRollCompleted');
                return;
            }
            
            if (!message.speaker || !message.speaker.actor) return;
            
            const actorId = message.speaker.actor;
            const actor = game.actors.get(actorId);
            if (!actor) return;
            
            // 권한 체크
            if (!actor.isOwner && !game.user.isGM) {
                console.warn('DX3rd | User lacks permission to use this actor\'s actions');
                return;
            }
            
            const item = actor.items.get(itemId);
            if (!item) return;
            
            // 공격 버튼: UniversalHandler로 통합 처리
            let attackRollSuccess = false;
            if (window.DX3rdUniversalHandler) {
                attackRollSuccess = await window.DX3rdUniversalHandler.handleAttackRoll(actor, item);
            }
            
            // 성공한 경우에만 플래그 설정
            if (attackRollSuccess) {
                await message.setFlag('dx3rd-emanim', 'attackRollCompleted', true);
            }
        });
        
        // 이펙트 사용 버튼 클릭 리스너 등록
        $(document).off('click.dx3rd-use-btn').on('click.dx3rd-use-btn', '.use-item-btn', async (event) => {
            event.preventDefault();
            event.stopPropagation();
            
            const button = $(event.currentTarget);
            const itemId = button.data('item-id');
            const roisAction = button.data('rois-action'); // 'titus' or 'sublimation'
            
            if (!itemId) {
                return;
            }
            
            // 메시지에서 액터 정보 찾기
            const messageElement = button.closest('.message');
            const messageId = messageElement.data('message-id');
            const message = game.messages.get(messageId);
            
            if (!message) {
                return;
            }
            
            // 완료 상태 확인 및 롤백 처리
            const itemUseCompleted = message.getFlag('dx3rd-emanim', 'itemUseCompleted') || {};
            const isCompleted = itemUseCompleted[itemId] === true;
            
            // 원본 텍스트 저장 (처음 한 번만)
            if (!button.data('original-text')) {
                const originalText = button.text().trim();
                button.data('original-text', originalText);
            }
            
            // 이미 완료된 버튼을 클릭한 경우 롤백
            if (isCompleted) {
                const updatedItemUseCompleted = { ...itemUseCompleted };
                delete updatedItemUseCompleted[itemId];
                
                // 빈 객체가 되면 플래그 제거, 아니면 업데이트
                if (Object.keys(updatedItemUseCompleted).length === 0) {
                    await message.unsetFlag('dx3rd-emanim', 'itemUseCompleted');
                } else {
                    await message.setFlag('dx3rd-emanim', 'itemUseCompleted', updatedItemUseCompleted);
                }
                return;
            }
            
            const speakerElement = messageElement.find('.message-header .message-sender');
            const actorName = speakerElement.text().trim();
            
            // 액터 ID 찾기 (speaker 데이터에서)
            let actorId = null;
            try {
                if (message && message.speaker && message.speaker.actor) {
                    actorId = message.speaker.actor;
                }
            } catch (e) {
                // 액터 ID 추출 실패 시 무시
            }
            
            // 아이템 정보 찾기
            let itemType = 'unknown';
            
            try {
                if (actorId) {
                    const actor = game.actors.get(actorId);
                    
                    // 권한 체크
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
                // 아이템 정보 추출 실패 시 무시
            }
            
            // UniversalHandler로 통합 처리 (getTarget은 undefined로 전달하여 아이템에서 읽도록 함)
            let itemUseSuccess = false;
            if (window.DX3rdUniversalHandler && window.DX3rdUniversalHandler.handleItemUse) {
                itemUseSuccess = await window.DX3rdUniversalHandler.handleItemUse(actorId, itemId, itemType, roisAction, undefined);
            }
            
            // 성공한 경우에만 플래그 설정 (updateChatMessage 훅에서 버튼 텍스트 업데이트)
            if (itemUseSuccess) {
                const updatedItemUseCompleted = { ...itemUseCompleted, [itemId]: true };
                await message.setFlag('dx3rd-emanim', 'itemUseCompleted', updatedItemUseCompleted);
            }
        });
        
        // message-sender 클릭 시 로이스 추가 리스너 등록
        $(document).off('click.dx3rd-add-lois').on('click.dx3rd-add-lois', '.message-header[data-actor-id] .message-sender', async (event) => {
            event.preventDefault();
            event.stopPropagation();
            
            const senderElement = $(event.currentTarget);
            const headerElement = senderElement.closest('.message-header');
            const targetActorId = headerElement.attr('data-actor-id');
            
            if (!targetActorId) {
                return;
            }
            
            // 대상 액터 가져오기
            const targetActor = game.actors.get(targetActorId);
            if (!targetActor) {
                ui.notifications.warn(game.i18n.localize('DX3rd.ActorNotFound'));
                return;
            }
            
            // 현재 액터 가져오기 (선택된 토큰 또는 할당된 액터)
            const controlledToken = canvas?.tokens?.controlled?.[0];
            const currentActor = controlledToken?.actor || game.user?.character;
            
            if (!currentActor) {
                ui.notifications.warn(game.i18n.localize('DX3rd.NoActorSelected'));
                return;
            }
            
            // 권한 체크
            if (!currentActor.isOwner && !game.user.isGM) {
                ui.notifications.warn(game.i18n.localize('DX3rd.NoPermission'));
                return;
            }
            
            // 이미 같은 로이스가 있는지 확인
            const existingLois = currentActor.items.find(item => 
                item.type === 'rois' && item.system?.actor === targetActorId
            );
            
            if (existingLois) {
                ui.notifications.info(game.i18n.localize('DX3rd.LoisAlreadyExists'));
                return;
            }
            
            // S 타입 로이스가 이미 있는지 확인
            const hasSType = currentActor.items.some(item => 
                item.type === 'rois' && item.system?.type === 'S'
            );
            
            // 로이스 추가 다이얼로그 표시
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
                const dialog = new Dialog({
                    title: `${game.i18n.format('DX3rd.AddLoisConfirmTitle')}: ${targetActor.name}`,
                    content: dialogContent,
                    buttons: {
                        confirm: {
                            icon: '<i class="fas fa-check"></i>',
                            label: game.i18n.localize('DX3rd.Confirm'),
                            callback: (html) => {
                                const type = html.find('#lois-type-select').val();
                                const positiveState = html.find('#lois-positive-state').is(':checked');
                                const positiveFeeling = html.find('#lois-positive-feeling').val().trim();
                                const negativeState = html.find('#lois-negative-state').is(':checked');
                                const negativeFeeling = html.find('#lois-negative-feeling').val().trim();
                                
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
                        cancel: {
                            icon: '<i class="fas fa-times"></i>',
                            label: game.i18n.localize('DX3rd.Cancel'),
                            callback: () => resolve(null)
                        }
                    },
                    default: 'confirm',
                    render: (html) => {
                        // 상호 배타적 체크박스 처리
                        const positiveCheckbox = html.find('#lois-positive-state');
                        const negativeCheckbox = html.find('#lois-negative-state');
                        
                        positiveCheckbox.on('change', function() {
                            if ($(this).is(':checked')) {
                                negativeCheckbox.prop('checked', false);
                            }
                        });
                        
                        negativeCheckbox.on('change', function() {
                            if ($(this).is(':checked')) {
                                positiveCheckbox.prop('checked', false);
                            }
                        });
                    }
                });
                
                dialog.render(true);
            });
            
            if (!result) {
                return;
            }
            
            // 로이스 아이템 생성
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

// Chat handler 객체 생성
window.DX3rdChatHandlers = {
    async showAfterSuccessDialog(actor, item, shouldActivate, shouldApplyToTargets) {
        // 커스텀 DOM 다이얼로그 생성
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
        
        // 제목
        const title = document.createElement("div");
        title.textContent = `${item.name}`;
        title.style.marginBottom = "16px";
        title.style.fontSize = "1em";
        title.style.fontWeight = "bold";
        title.style.cursor = "move";
        dialogDiv.appendChild(title);
        
        // 버튼 컨테이너
        const buttonContainer = document.createElement("div");
        buttonContainer.style.display = "flex";
        buttonContainer.style.flexDirection = "column";
        buttonContainer.style.gap = "8px";
        
        // "장비 효과 사용" 버튼
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
        useBtn.onclick = async () => {
            const updates = {};
            
            // 1. system.used.state 증가
            const currentUsedState = item.system?.used?.state || 0;
            updates['system.used.state'] = currentUsedState + 1;
            
            // 2. 활성화 (shouldActivate가 true이고 disable이 'notCheck'가 아닌 경우)
            if (shouldActivate) {
                const activeDisable = item.system?.active?.disable ?? '-';
                if (activeDisable !== 'notCheck') {
                    updates['system.active.state'] = true;
                }
            }
            
            if (Object.keys(updates).length > 0) {
                await item.update(updates);
            }
            
            // 3. 대상 적용 (shouldApplyToTargets가 true인 경우)
            if (shouldApplyToTargets && window.DX3rdUniversalHandler) {
                await window.DX3rdUniversalHandler.applyToTargets(actor, item, 'afterSuccess');
            }
            
            if (dialogDiv.parentNode) document.body.removeChild(dialogDiv);
        };
        buttonContainer.appendChild(useBtn);
        
        // "사용 안 함" 버튼
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
        notUseBtn.onclick = async () => {
            // 아무것도 안 함 (활성화 X, 대상 적용 X, state 증가 X)
            if (dialogDiv.parentNode) document.body.removeChild(dialogDiv);
        };
        buttonContainer.appendChild(notUseBtn);
        
        dialogDiv.appendChild(buttonContainer);
        
        // 드래그 기능 추가
        let isDragging = false;
        let offsetX;
        let offsetY;
        
        const onMouseDown = (e) => {
            // 버튼 클릭은 제외
            if (e.target.tagName === 'BUTTON') return;
            
            isDragging = true;
            
            // 다이얼로그의 현재 위치 계산
            const rect = dialogDiv.getBoundingClientRect();
            offsetX = e.clientX - rect.left;
            offsetY = e.clientY - rect.top;
            
            dialogDiv.style.cursor = "grabbing";
            title.style.cursor = "grabbing";
        };
        
        const onMouseMove = (e) => {
            if (!isDragging) return;
            
            e.preventDefault();
            
            // 마우스 위치에서 오프셋을 빼서 정확한 위치 계산
            const newLeft = e.clientX - offsetX;
            const newTop = e.clientY - offsetY;
            
            dialogDiv.style.left = newLeft + "px";
            dialogDiv.style.top = newTop + "px";
            dialogDiv.style.transform = "none";  // transform 제거
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
        
        // 다이얼로그 제거 시 이벤트 리스너도 제거
        const cleanup = () => {
            document.removeEventListener("mousemove", onMouseMove);
            document.removeEventListener("mouseup", onMouseUp);
        };
        
        // 다이얼로그가 제거될 때 cleanup 호출
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
    },
    
    async showAfterDamageDialog(actor, item, damagedTargets, shouldActivate, shouldApplyToTargets) {
        // 커스텀 DOM 다이얼로그 생성
        const dialogDiv = document.createElement("div");
        dialogDiv.className = "after-damage-dialog";
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
        
        // 제목
        const title = document.createElement("div");
        title.textContent = `${item.name}`;
        title.style.marginBottom = "16px";
        title.style.fontSize = "1em";
        title.style.fontWeight = "bold";
        title.style.cursor = "move";
        dialogDiv.appendChild(title);
        
        // 버튼 컨테이너
        const buttonContainer = document.createElement("div");
        buttonContainer.style.display = "flex";
        buttonContainer.style.flexDirection = "column";
        buttonContainer.style.gap = "8px";
        
        // "장비 효과 사용" 버튼
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
        useBtn.onclick = async () => {
            const updates = {};
            
            // 1. system.used.state 증가 (notCheck가 아닌 경우)
            const usedDisable = item.system?.used?.disable || 'notCheck';
            if (usedDisable !== 'notCheck') {
                const currentUsedState = item.system?.used?.state || 0;
                updates['system.used.state'] = currentUsedState + 1;
            }
            
            // 2. 활성화 (shouldActivate가 true이고 disable이 'notCheck'가 아닌 경우)
            if (shouldActivate) {
                const activeDisable = item.system?.active?.disable ?? '-';
                if (activeDisable !== 'notCheck') {
                    updates['system.active.state'] = true;
                }
            }
            
            if (Object.keys(updates).length > 0) {
                await item.update(updates);
            }
            
            // 3. HP 데미지 받은 타겟에게만 효과 적용
            if (shouldApplyToTargets) {
                for (const targetId of damagedTargets) {
                    const targetActor = game.actors.get(targetId);
                    if (targetActor) {
                        const targetAttributes = item.system.effect?.attributes || {};
                        
                        if (game.user.isGM) {
                            // GM이면 직접 적용
                            await window.DX3rdUniversalHandler._applyItemAttributes(actor, item, targetActor, targetAttributes);
                        } else {
                            // 일반 유저는 소켓 전송
                            game.socket.emit('system.dx3rd-emanim', {
                                type: 'applyItemAttributes',
                                payload: {
                                    sourceActorId: actor.id,
                                    itemId: item.id,
                                    targetActorId: targetId,
                                    targetAttributes: targetAttributes
                                }
                            });
                        }
                    }
                }
            }
            
            if (dialogDiv.parentNode) document.body.removeChild(dialogDiv);
        };
        buttonContainer.appendChild(useBtn);
        
        // "사용 안 함" 버튼
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
        notUseBtn.onclick = async () => {
            // 아무것도 안 함 (활성화 X, 대상 적용 X, state 증가 X)
            if (dialogDiv.parentNode) document.body.removeChild(dialogDiv);
        };
        buttonContainer.appendChild(notUseBtn);
        
        dialogDiv.appendChild(buttonContainer);
        
        // 드래그 기능 추가
        let isDragging = false;
        let offsetX;
        let offsetY;
        
        const onMouseDown = (e) => {
            // 버튼 클릭은 제외
            if (e.target.tagName === 'BUTTON') return;
            
            isDragging = true;
            
            // 다이얼로그의 현재 위치 계산
            const rect = dialogDiv.getBoundingClientRect();
            offsetX = e.clientX - rect.left;
            offsetY = e.clientY - rect.top;
            
            dialogDiv.style.cursor = "grabbing";
            title.style.cursor = "grabbing";
        };
        
        const onMouseMove = (e) => {
            if (!isDragging) return;
            
            e.preventDefault();
            
            // 마우스 위치에서 오프셋을 빼서 정확한 위치 계산
            const newLeft = e.clientX - offsetX;
            const newTop = e.clientY - offsetY;
            
            dialogDiv.style.left = newLeft + "px";
            dialogDiv.style.top = newTop + "px";
            dialogDiv.style.transform = "none";  // transform 제거
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
        
        // 다이얼로그 제거 시 이벤트 리스너도 제거
        const cleanup = () => {
            document.removeEventListener("mousemove", onMouseMove);
            document.removeEventListener("mouseup", onMouseUp);
        };
        
        // 다이얼로그가 제거될 때 cleanup 호출
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
    },
    
    
    initializeExistingMessages() {
        // 기존 채팅 메시지에서 토글 요소들을 찾아서 초기화
        const existingMessages = $('#chat-log .message');
        
        existingMessages.each((index, messageElement) => {
            const $message = $(messageElement);
            const collapsibleElements = $message.find('.collapsible-content');
            
            if (collapsibleElements.length > 0) {
                // 인라인 스타일 제거하고 CSS 클래스로 초기화
                collapsibleElements.each((i, element) => {
                    const $el = $(element);
                    $el.removeAttr('style').addClass('collapsed');
                });
            }
        });
    },
    
    showComboItemsDialog(messageElement, section) {
        // 메시지에서 액터 정보 추출
        let actorId = null;
        try {
            const messageData = messageElement[0];
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
        
        // 콤보 아이템 찾기
        const comboItems = actor.items.filter(item => item.type === 'combo');
        if (comboItems.length === 0) {
            return;
        }
        
        // 첫 번째 콤보 아이템 사용 (여러 개가 있다면 가장 최근에 생성된 것)
        const comboItem = comboItems[0];
        
        // 섹션에 따른 아이템 수집
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
        
        // 다이얼로그 표시
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
        
        // 다이얼로그 생성
        new Dialog({
            title: `${comboName} - ${sectionName}`,
            content: content,
            buttons: {
                close: {
                    icon: '<i class="fas fa-times"></i>',
                    label: game.i18n.localize('DX3rd.Close')
                }
            },
            default: 'close'
        }).render(true);
    },
    
    showBookItemsDialog(messageElement, section) {
        // 메시지에서 액터 정보 추출
        let actorId = null;
        try {
            const messageData = messageElement[0];
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
        
        // 마도서 아이템 찾기
        const bookItems = actor.items.filter(item => item.type === 'book');
        if (bookItems.length === 0) {
            return;
        }
        
        // 첫 번째 마도서 아이템 사용 (여러 개가 있다면 가장 최근에 생성된 것)
        const bookItem = bookItems[0];
        
        // 섹션에 따른 아이템 수집
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
        
        // 다이얼로그 표시
        this.createBookItemsDialog(sectionName, items, bookItem.name, actor);
    },
    
    getBookSpells(actor, bookItem) {
        const spells = [];
        if (bookItem.system.spells && Array.isArray(bookItem.system.spells)) {
            for (const spellId of bookItem.system.spells) {
                if (spellId && spellId !== '-') {
                    // 공용 아이템에서 조회
                    const spell = game.items.get(spellId);
                    
                    if (spell && spell.type === 'spell') {
                        // 액터가 같은 이름의 술식을 가지고 있는지 확인
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
        
        // 다이얼로그 생성
        new Dialog({
            title: `${bookName} - ${sectionName}`,
            content: content,
            buttons: {
                close: {
                    icon: '<i class="fas fa-times"></i>',
                    label: game.i18n.localize('DX3rd.Close')
                }
            },
            default: 'close'
        }).render(true);
    },
    
    _getSkillDisplay(skillKey, actor) {
        if (!skillKey || skillKey === '-') return '-';
        
        // 액터의 스킬에서 찾기
        if (actor) {
            const skill = actor.system?.attributes?.skills?.[skillKey];
            if (skill) {
                // 스킬 이름이 DX3rd.로 시작하면 커스텀 이름 또는 로컬라이징
                if (skill.name && skill.name.startsWith('DX3rd.')) {
                    // customSkills 설정 확인
                    const customSkills = game.settings.get("dx3rd-emanim", "customSkills") || {};
                    const customSkill = customSkills[skillKey];
                    
                    if (customSkill) {
                        // 커스텀 이름이 있으면 우선 사용
                        return typeof customSkill === 'object' ? customSkill.name : customSkill;
                    } else {
                        // 커스텀 이름이 없으면 기본 로컬라이징
                        return game.i18n.localize(skill.name);
                    }
                }
                return skill.name || skillKey;
            }
        }
        
        // 스킬이 없으면 기본 속성 체크
        const attributes = ['body', 'sense', 'mind', 'social'];
        if (attributes.includes(skillKey)) {
            return game.i18n.localize(`DX3rd.${skillKey.charAt(0).toUpperCase() + skillKey.slice(1)}`);
        }
        
        // 신드롬 체크
        if (skillKey === 'syndrome') {
            return game.i18n.localize('DX3rd.Syndrome');
        }
        
        // DX3rd. 접두사가 있는 스킬 키인 경우 로컬라이징 시도
        if (skillKey.startsWith('DX3rd.')) {
            return game.i18n.localize(skillKey);
        }
        
        return skillKey;
    }
};

// 액터 생성 시 커스텀 스킬 및 cthulhu 스킬 추가
Hooks.on('createActor', async (actor, options, userId) => {
    // 액터를 생성한 사용자의 클라이언트에서만 실행
    if (game.userId !== userId) {
        return;
    }
    
    if (actor.type === 'character') {
        const updates = {};
        
        // cthulhu 스킬 추가 (stageCRC 설정이 활성화되어 있고, 삭제되지 않은 경우)
        const stageCRCEnabled = game.settings.get("dx3rd-emanim", "stageCRC");
        const cthulhuDeleted = actor.getFlag('dx3rd-emanim', 'cthulhuDeleted') === true;
        const customSkills = game.settings.get("dx3rd-emanim", "customSkills") || {};
        
        if (stageCRCEnabled && !cthulhuDeleted && !actor.system.attributes.skills.cthulhu) {
            // customSkills에 cthulhu 정보가 있으면 사용, 없으면 기본값
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
        
        // 커스텀 스킬 추가 (customSkills는 위에서 이미 선언됨)
        for (const [skillKey, data] of Object.entries(customSkills)) {
            if (!actor.system.attributes.skills[skillKey]) {
                const skillName = typeof data === 'object' ? data.name : data;
                const skillBase = typeof data === 'object' ? data.base : 'body';
                
                updates[`system.attributes.skills.${skillKey}`] = {
                    name: skillName,
                    point: 0,
                    bonus: 0,
                    extra: 0,
                    total: 0,
                    dice: 0,
                    add: 0,
                    base: skillBase,
                    delete: true
                };
            }
        }
        
        if (Object.keys(updates).length > 0) {
            await actor.update(updates);
        }
        
        // 기본 무기 아이템(주먹) 추가
        // 액터를 생성한 사용자의 클라이언트에서만 실행되므로, 권한이 있는 사용자만 실행됨
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
                        type: 'melee',
                        skill: 'melee',
                        add: '+0',
                        attack: '-5',
                        guard: '0',
                        range: game.i18n.localize("DX3rd.Engage"),
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
                // 예상치 못한 에러만 로그 출력
                console.error('DX3rd | Failed to create fist item:', error);
            }
        }
    }
});

// 아이템 생성 시 기본 이미지 설정
Hooks.on('preCreateItem', async (item, data, options, userId) => {
    const defaultImg = 'icons/svg/item-bag.svg';
    
    // img가 기본값이거나 설정되지 않은 경우에만 타입별 이미지 적용
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

// ========== AfterMain 큐 관리: 전투 시작 시 초기화 ========== //
// 전투 종료 시 초기화는 combat.js의 deleteCombat 훅에서 처리
Hooks.on('createCombat', async (combat, options, userId) => {
    if (!game.user.isGM) return;
    if (window.DX3rdUniversalHandler) {
        await window.DX3rdUniversalHandler.clearAfterMainQueue();
    }
});
