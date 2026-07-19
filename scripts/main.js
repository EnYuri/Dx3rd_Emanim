/**
 * Double Cross 3rd 시스템의 메인 스크립트
 */

/**
 * 충동 판정 / 공포 판정 실행. 두 판정은 로컬라이즈 키와 판정 플래그만 다르고 절차가 동일하다.
 * 의지 기능으로 판정하되 없으면 정신 능력치로 대체하고, 판정 후 2d10만큼 침식률을 올린다.
 * @param {'urge'|'panic'} kind        판정 종류
 * @param {Actor} fallbackCharacter    선택된 토큰이 없을 때 사용할 액터
 */


// 시스템 설정 샘플
Hooks.once('init', async function() {
    
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

    // 아이템 채팅 카드의 상세 정보/설명 초기 표시 상태
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
            { value: "guard_roll", label: "DX3rd.GuardRollDice" },
            { value: "penetrate", label: "DX3rd.Penetrate" },
            { value: "reduce", label: "DX3rd.ReduceDamage" },
            { value: "reduce_roll", label: "DX3rd.ReduceRollDice" },
            { value: "dxroll", label: "DX3rd.DxRollDice" },
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

    // 상세 디버그 로그. 평시에는 꺼두고, 아이템 사용/데미지 흐름을 추적할 때만 켠다.
    game.settings.register('dx3rd-emanim', 'debugLogging', {
        name: 'DX3rd.DebugLogging',
        hint: '아이템 사용·확장·데미지 처리 과정의 상세 로그를 콘솔에 출력합니다. 문제 추적용이며 평소에는 꺼두세요.',
        scope: 'client',
        config: true,
        type: Boolean,
        default: false,
        onChange: () => window.DX3rdDebug?.invalidate()
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

    game.settings.register('dx3rd-emanim', 'rangeHighlightColor', {
        name: 'DX3rd.RangeHighlightColor',
        hint: '기본 색상(녹색) 대신 사용자 색상을 사용합니다.',
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

// 시트·다이얼로그 템플릿 선반입.
// 원격 호스팅(Forge 등)에서는 템플릿을 처음 쓸 때의 fetch가 그대로 네트워크 왕복이라,
// 시트나 다이얼로그를 처음 여는 순간에 눈에 띄는 지연이 된다. 미리 받아두면 그 지연이 사라진다.
// 일부러 await 하지 않는다 — 월드 기동을 붙잡지 않고 배경에서 채우며, 아직 안 받힌 템플릿은
// 기존대로 그 자리에서 로드되므로 실패해도 기능에 영향이 없다.
// 새 템플릿을 추가하면 이 목록에도 넣을 것(item-effect-adapter.js의 PARTIALS와 같은 규약).
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
    // 아래는 코드에서 경로를 변수로 조립하는 것들(actor-edit-dialogs / enemy-stat-dialogs).
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
    
    // Disable Hooks 채팅 명령어 등록
    
    // 채팅 메시지 생성 전, 설정에 맞춰 스피커 보정
    Hooks.on('preCreateChatMessage', (doc, data) => {
        try {
            // 현재 클라이언트에서 생성하는 메시지에만 적용
            if (data.author && data.author !== game.user.id) return;
            
            const content = data.content || '';
            // flags 우선. 기존/외부 메시지는 콘텐츠 판별 후 신규 문서에 구조화 flag를 백필한다.
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

            // 롤 타입 메시지 또는 시스템 버튼이 포함된 메시지이고 
            // 이미 액터가 스피커로 명시적으로 설정된 경우 변경 무시
            // (어택 롤, 스탯 롤, 데미지 롤, 데미지 롤 버튼, 데미지 적용 버튼 등)
            const isRollMessage = messageType === messageTypes.TYPES.ROLL || data.rolls?.length > 0;
            const hasSystemButton = messageType === messageTypes.TYPES.SYSTEM_ACTION;
            
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
        // 장면 개막이 두 번 오면 다이얼로그가 겹치고 id가 중복된다.
        // 그러면 아래 조회가 옛 다이얼로그의 버튼을 잡아 위에 보이는 쪽이 먹통이 되므로 먼저 치운다.
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

        // 조회 범위를 이 다이얼로그로 한정한다(document 전역 조회 금지).
        dialog.querySelector("#dx3rd-scene-enter-ok").addEventListener("click", async () => {
            dialog.remove();
            await runEnterScene();
        });
        dialog.querySelector("#dx3rd-scene-enter-cancel").addEventListener("click", () => dialog.remove());
    }

    // 소켓 처리기 등록: 실제 system socket 수신은 DX3rdSocketRouter가 한 번만 맡는다.
    const socketRouter = window.DX3rdSocketRouter;
    if (!socketRouter) {
        console.error('DX3rd | Socket router is unavailable.');
        return;
    }
    const findSocketActor = actorId => game.actors.get(actorId)
        || canvas.tokens?.placeables?.find(token => token.actor?.id === actorId)?.actor
        || null;
    const isAuthorizedActorRequest = (data, actorId) => {
        if (!data.senderId) return true; // 구버전 클라이언트 호환
        const actor = findSocketActor(actorId);
        const authorized = Boolean(actor && socketRouter.canUserControlActor(data.senderId, actor));
        if (!authorized) console.warn(`DX3rd | Unauthorized socket request ignored: ${data.type} (${data.senderId} → ${actorId})`);
        return authorized;
    };
    socketRouter.register(async (data) => {

        if (data.type === 'showSceneEnterDialog') {
            if (data.userId === game.user.id) {
                showSceneEnterDialogOnly();
            }
            return;
        }

        if (data.type === 'actionTrackerConsume') {
            if (socketRouter.isResponsibleGM()
                && data.payload
                && isAuthorizedActorRequest(data, data.payload.actorId)) {
                await window.DX3rdTurnProcessUI?.updateUsage?.(data.payload);
            }
            return;
        }

        if (data.type === 'healRequest' || data.type === 'healApply') {
            // HP 회복: 대표 GM만 권한 중계한다. 사용자에게 승인 단계는 없다.
            if (socketRouter.isResponsibleGM()
                && data.requestData
                && isAuthorizedActorRequest(data, data.requestData.actorId)
                && window.DX3rdUniversalHandler?.handleHealRequest) {
                await window.DX3rdUniversalHandler.handleHealRequest(data.requestData);
            }
            return;
        }

        if (data.type === 'statusClearRequest' || data.type === 'statusClearApply') {
            // 상태이상 소거: 대표 GM만 권한 중계한다. 사용자에게 승인 단계는 없다.
            if (socketRouter.isResponsibleGM()
                && data.requestData
                && isAuthorizedActorRequest(data, data.requestData.actorId)
                && window.DX3rdUniversalHandler?.handleStatusClearRequest) {
                await window.DX3rdUniversalHandler.handleStatusClearRequest(data.requestData);
            }
            return;
        }

        if (data.type === 'encroachRequest') {
            // 침식률 조정(대상 침식 감소) 요청 (GM만 처리)
            if (socketRouter.isResponsibleGM()
                && data.requestData
                && isAuthorizedActorRequest(data, data.requestData.actorId)
                && window.DX3rdUniversalHandler?.handleEncroachRequest) {
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
        
        if (data.type === 'damageRequest' || data.type === 'damageApply') {
            // HP 데미지: 대표 GM만 권한 중계한다. 사용자에게 승인 단계는 없다.
            if (socketRouter.isResponsibleGM()
                && data.requestData
                && isAuthorizedActorRequest(data, data.requestData.actorId)
                && window.DX3rdUniversalHandler?.handleDamageRequest) {
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
            
            // GM이 다이얼로그 표시
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
                    {
                        action: 'cancel',
                        icon: 'fas fa-times',
                        label: game.i18n.localize('DX3rd.Cancel')
                    }
                ]
            }).render(true);
            
            return;
        }
        
        if (data.type === 'spellCatastrophe7Request') {
            // SpellCatastrophe 7 요청 (GM만 처리)
            if (!socketRouter.isResponsibleGM()
                || !window.DX3rdSpellHandler
                || !data.requestData
                || !isAuthorizedActorRequest(data, data.requestData.actorId)) return;
            
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
            if (!socketRouter.isResponsibleGM()
                || !window.DX3rdSpellHandler
                || !data.requestData
                || !isAuthorizedActorRequest(data, data.requestData.actorId)) return;
            
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
        
        if (data.type === 'conditionRequest' || data.type === 'conditionApply') {
            // 상태이상 부여: 대표 GM이 비소유 대상에 한해 조용히 권한을 중계한다.
            if (socketRouter.isResponsibleGM()
                && data.requestData
                && isAuthorizedActorRequest(data, data.requestData.actorId)
                && window.DX3rdUniversalHandler?.handleConditionRequest) {
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
            if (socketRouter.isResponsibleGM() && window.DX3rdUniversalHandler?.handleRemoveConditionRequest) {
                await window.DX3rdUniversalHandler.handleRemoveConditionRequest(data.data);
            }
            return;
        }
        
        if (data.type === 'conditionRequestBulk' || data.type === 'conditionApplyBulk') {
            // 상태이상 다건 부여: 대표 GM이 비소유 대상에 한해 조용히 권한을 중계한다.
            if (socketRouter.isResponsibleGM()
                && data.data
                && isAuthorizedActorRequest(data, data.data.actorId)
                && window.DX3rdUniversalHandler?.handleConditionRequestBulk) {
                await window.DX3rdUniversalHandler.handleConditionRequestBulk(data.data);
            }
            return;
        }
        
        if (data.type === 'registerAfterDamageExtension') {
            // AfterDamage 익스텐드 큐 등록 요청 (GM만 처리)
            if (!socketRouter.isResponsibleGM()
                || !data.payload
                || !isAuthorizedActorRequest(data, data.payload.attackerId)
                || !Array.isArray(data.payload.targetActorIds)) return;
            
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
                if (!socketRouter.isResponsibleGM()) return;
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
            if (game.user.isGM && (!socketRouter.isResponsibleGM() || nonGMOwners.length > 0)) {
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
            if (game.user.isGM && (!socketRouter.isResponsibleGM() || nonGMOwners.length > 0)) {
                return;
            }
            
            const item = sourceActor.items.get(itemId);
            if (item && window.DX3rdUniversalHandler && window.DX3rdUniversalHandler._applyItemAttributes) {
                await window.DX3rdUniversalHandler._applyItemAttributes(sourceActor, item, targetActor, targetAttributes);
            }
        } else if (data.type === 'registerAfterDamageActivation') {
            // GM 전용: afterDamage 활성화 요청 등록
            if (!socketRouter.isResponsibleGM()
                || !data.payload
                || !isAuthorizedActorRequest(data, data.payload.attackerId)
                || !Array.isArray(data.payload.targetActorIds)) {
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
            
        } else if (data.type === 'reportDamageForActivation') {
            // GM 전용: 타겟의 HP 변화 보고 수집
            if (!socketRouter.isResponsibleGM()
                || !data.payload
                || !isAuthorizedActorRequest(data, data.payload.targetActorId)) {
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
                        window.DX3rdSocketRouter.emit({
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
                        window.DX3rdSocketRouter.emit({
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
                            window.DX3rdSocketRouter.emit({
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
                            window.DX3rdSocketRouter.emit({
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
        } else if (data.type === 'registerTargetApply') {
            // GM 전용: afterDamage 타이밍의 타겟 효과 적용 요청 등록
            if (!socketRouter.isResponsibleGM()
                || !data.payload
                || !isAuthorizedActorRequest(data, data.payload.sourceActorId)
                || !data.payload.targetActorId) {
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
            if (!socketRouter.isResponsibleGM()
                || !data.payload
                || !isAuthorizedActorRequest(data, data.payload.targetActorId)) {
                return;
            }
            
            const { targetActorId, itemId, hpChange } = data.payload;
            const queueKey = `${targetActorId}_${itemId}`;
            
            // 저장된 요청 확인
            const applyRequest = window.DX3rdTargetApplyQueue[queueKey];
            if (applyRequest) {
                if (hpChange >= 1) {
                    // HP 감소했으면 타겟에게 효과 적용 지시
                    window.DX3rdSocketRouter.emit({
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
                        
                        if (game.user.isGM && !socketRouter.isResponsibleGM()) return;
                        if (game.user.isGM) {
                            // GM이면 직접 적용
                            await window.DX3rdUniversalHandler._applyItemAttributes(actor, item, targetActor, targetAttributes);
                        } else {
                            // 일반 유저는 소켓 전송
                            window.DX3rdSocketRouter.emit({
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
            if (game.user.isGM && (!socketRouter.isResponsibleGM() || nonGMOwners.length > 0)) {
                return;
            }
            
            const item = sourceActor.items.get(itemId);
            if (item && window.DX3rdUniversalHandler && window.DX3rdUniversalHandler._applyItemAttributes) {
                await window.DX3rdUniversalHandler._applyItemAttributes(sourceActor, item, targetActor, targetAttributes);
            }
        }
    });
});


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
        
        // 계통 기능치(운전/예술/지식/정보 등 customSkills)는 새 캐릭터에 자동 주입하지 않는다.
        // 취득한 계통 기능치만 시트의 '+'(기능치 추가)로 그때그때 등록한다. 컴펜디움 콘텐츠는
        // 판정 기능으로 계통 하위 기능치를 참조하지 않으며(build-effects SKILL_MAP), 혹시 참조하는
        // 홈브루가 있어도 effect-handler 가 연결 능력치로 폴백해 판정이 진행된다.
        // (cthulhu 만 stageCRC 규칙상 위에서 별도 시드)

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

// 컴펜디움 웍스를 액터에 추가할 때, 표에 지정된 전문 기능도 함께 만든다.
// 〈운전:〉·〈지식:〉처럼 세부명이 비어 있는 기능은 사용자가 액터 시트에서
// 이름을 정하면 되며, 여기서는 해당 웍스의 기능치 보너스가 즉시 적용되도록 한다.
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

// ========== AfterMain 큐 관리: 전투 시작 시 초기화 ========== //
// 전투 종료 시 초기화는 combat.js의 deleteCombat 훅에서 처리
Hooks.on('createCombat', async (combat, options, userId) => {
    if (!game.user.isGM) return;
    if (window.DX3rdUniversalHandler) {
        await window.DX3rdUniversalHandler.clearAfterMainQueue();
    }
});

// ─────────────────────────────────────────────────────────────────────────────
// 열린 시트의 파생 표시값 실시간 갱신
//
// 액터/이펙트의 데이터 계층은 이미 실시간이다(prepareData가 침식 레벨을 먼저 갱신하고
// 활성 아이템 보너스를 매번 evaluate). 하지만 Foundry는 "자기 문서가 업데이트될 때만"
// 시트를 다시 그리므로, 콤보/이펙트 시트를 열어둔 채 침식률이 오르거나(→ 레벨 상승)
// 다른 곳에서 등록 이펙트를 수정하면 시트에 표시된 다이스/수정치/레벨이 옛 값으로 남는다.
// 아래 훅이 의존 관계에 있는 "열려 있는" 시트만 골라 다시 그려 표시값을 실시간화한다.
// (render(false)는 문서를 갱신하지 않으므로 재귀 렌더 루프가 없다.)

// 사용자가 지금 편집 중(포커스가 시트 안에 있음)인 시트는 재렌더하지 않는다.
// 재렌더가 DOM을 교체해 입력 포커스/타이핑을 날리는 것을 막는다.
function _dx3rdRerenderSheetNow(app) {
    if (!app?.rendered) return;
    const active = document.activeElement;
    if (active && app.element?.contains(active)) return;
    app.render(false);
}

// 아이템 사용 한 번은 액터 업데이트를 연달아 일으킬 수 있고(HP·침식률·applied 등),
// 그때마다 같은 시트를 다시 그리면 낭비다. 대기 집합에 모아 한 프레임 뒤 한 번만 그린다.
// rendered/포커스 검사는 "그리는 시점"에 하므로, 대기 중 닫히거나 사용자가 입력을 시작한
// 시트는 자연히 건너뛴다 — 즉시 실행보다 오히려 정확하다.
const _dx3rdPendingRerenders = new Set();
const _dx3rdFlushRerenders = foundry.utils.debounce(() => {
    const apps = [..._dx3rdPendingRerenders];
    _dx3rdPendingRerenders.clear();
    for (const app of apps) _dx3rdRerenderSheetNow(app);
}, 50);

function _dx3rdRerenderSheet(app) {
    if (!app) return;                          // 아직 열린 적 없는 시트는 생성하지 않는다
    _dx3rdPendingRerenders.add(app);
    _dx3rdFlushRerenders();
}

// 침식률 등 액터 능력치가 바뀌면, 그 값을 표시/계산에 쓰는 열린 아이템 시트를 갱신.
Hooks.on('updateActor', (actor, changed, options, userId) => {
    const hasAttributeChange = foundry.utils.hasProperty(changed, 'system.attributes') ||
        Object.keys(changed || {}).some(key => key.startsWith('system.attributes.'));
    if (!hasAttributeChange) return;
    for (const item of actor.items) {
        if (!['combo', 'effect', 'psionic'].includes(item.type)) continue;
        _dx3rdRerenderSheet(item._sheet);      // 아직 열린 적 없으면 생성하지 않는다
    }
});

// 즉석 콤보는 저장 버튼을 누르기 전까지 월드 데이터가 아니다.
// 브라우저 새로고침/비정상 창 종료로 남은 문서는 기동 중 자동 삭제하지 않는다.
// 명시적으로 저장한 콤보는 instantCombo 플래그가 없으므로 절대 정리 대상이 아니다.
window.DX3rdInstantComboCleanup = {
    audit() {
        const rows = [];
        for (const actor of game.actors) {
            const items = actor.items.filter(item => window.DX3rdIsInstantCombo?.(item));
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

// 이펙트가 바뀌면, 그 이펙트를 등록한 콤보의 저장 파생값도 같은 조합 규칙으로 동기화하고
// 열린 콤보 시트를 갱신한다. 이펙트 자신의 시트는 Foundry가 updateItem 시 자동으로 다시 그린다.
Hooks.on('updateItem', async (item, changed, options, userId) => {
    const actor = item.actor;
    if (!actor || item.type !== 'effect') return;
    // 이름·이미지·정렬 변경은 콤보의 계산값에 영향이 없다.
    // Foundry 버전/호출 경로에 따라 changes가 중첩 객체 또는 점 표기 키가 될 수 있다.
    const hasSystemChange = foundry.utils.hasProperty(changed, 'system') ||
        Object.keys(changed || {}).some(key => key.startsWith('system.'));
    if (!hasSystemChange) return;

    // 훅은 모든 접속 클라이언트에서 실행된다. 저장 동기화는 변경을 일으킨 본인이,
    // 그것도 해당 액터에 쓰기 권한이 있을 때만 한 번 수행한다. 재렌더는 표시값 갱신이므로
    // 쓰기가 아니고, 시트를 열어둔 모든 클라이언트에서 그대로 수행한다.
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
