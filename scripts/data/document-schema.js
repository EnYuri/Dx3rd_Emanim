/**
 * DX3rd 문서 스키마 — 폐기된 template.json 을 대신한다.
 *
 * Foundry 는 V14 에서 template.json 을 deprecate 했고 V16 에서 읽지 않는다. 대체 경로는
 * system.json 의 `documentTypes`(서브타입 선언) + `CONFIG.<Document>.dataModels`(스키마)다.
 *
 * ── 옮기면서 지켜야 했던 것 ─────────────────────────────────────────────────────
 * template.json 경로는 스키마가 아니라 **기본값 병합**이었다(`TypeDataField._cleanType` 의
 * `mergeObject(template, value, {insertKeys})`). 그래서 두 가지가 공짜였다:
 *   ① 선언에 없는 키도 저장되고 살아남았다.
 *   ② 값의 타입을 아무도 강제하지 않았다 — `attack: 0` 으로 선언된 자리에 `"4+[level]"` 이
 *      들어 있어도 그대로 보존됐다.
 * DataModel 은 둘 다 하지 않는다. 미선언 키는 정리 단계에서 **지워지고**, NumberField 는
 * 수식 문자열을 삼킨다. 그래서 이 파일은:
 *   ① 라이브 팩 2745건 + 월드 2개(액터 122·임베드 아이템 803)를 전수 실측해 나온
 *      미선언 저장 경로를 전부 선언에 담았고(아래 「실측 보강」 주석),
 *   ② 원시값은 **타입을 강제하지 않는** DX3rdLooseField 로 받는다. 불리언만 BooleanField 다.
 * 즉 template.json 의 병합 의미를 그대로 재현하되, 어떤 키가 존재하는지만 선언한다.
 *
 * 실측에서 미선언으로 잡혔으나 **일부러 넣지 않은 것**은 죽은 필드뿐이다 —
 * `system.system`/`system.name`/`system.type`/`system.img`(마이그레이션 v1·v2 가 지우는
 * 중첩 사본), `conditions.lostHP`/`conditions.healing`(v3), `system.roll-check`
 * (combo-data 가 지운다). DataModel 이 로드 시점에 자동으로 떨궈 주므로 결과는 같고,
 * 그만큼 마이그레이션이 잡을 대상이 줄어들 뿐이다.
 *
 * spell/psionic/combo 에 `active.applyMode` 가 없는 것은 실수가 아니다 — 없어야
 * universal-apply 가 'onUse' 로 떨어진다(runtime-core.test.mjs 가 검증). 채우지 말 것.
 */
(function () {
  // template.json 과 같은 모양이다(types / templates / 타입별 정의). 도구가 그대로 읽는다.
  const DEFAULTS = {
    Actor: {
      types: ['character', 'enemy'],
      templates: {},
      character: {
        actorType: 'NPC',
        codeName: '',
        // 실측 보강: 액터 시트의 프로즈미러 약력(2개 월드 42건). template.json 에 없었다.
        description: '',
        emotions: {},
        attributes: {},
        details: {
          cover: '',
          ancestry: '',
          experience: '',
          meet: '',
          awaken: '',
          impulse: '',
          desire: ''
        },
        conditions: {
          poisoned: { active: false, value: 0 },
          hatred: { active: false, target: '' },
          fear: { active: false, target: '' },
          berserk: { active: false, type: '-' },
          rigor: { active: false },
          pressure: { active: false },
          dazed: { active: false },
          defeated: { active: false },
          action_end: { active: false },
          action_delay: { active: false, value: 0 },
          stealth: { active: false },
          fly: { active: false },
          boarding: { active: false },
          'extra-turn': { active: false, value: 0, max: 0 }
        }
      },
      enemy: {
        actorType: 'Troop',
        description: '',
        attributes: {},
        conditions: {
          poisoned: { active: false, value: 0 },
          hatred: { active: false, target: '' },
          fear: { active: false, target: '' },
          berserk: { active: false, type: '-' },
          rigor: { active: false },
          pressure: { active: false },
          dazed: { active: false },
          defeated: { active: false },
          action_end: { active: false },
          action_delay: { active: false, value: 0 },
          stealth: { active: false },
          fly: { active: false },
          boarding: { active: false },
          'extra-turn': { active: false, value: 0, max: 0 }
        }
      }
    },
    Item: {
      types: [
        'works', 'syndrome', 'combo', 'effect', 'spell', 'psionic', 'rois',
        'vehicle', 'weapon', 'protect', 'connection', 'book', 'once', 'etc', 'record'
      ],
      templates: {
        base: {
          description: '',
          skillTmp: 'melee',
          skills: {}
        },
        item: {
          saving: { value: 0, difficulty: '0', acquisition: 'permanent' },
          exp: 0,
          encroach: { init: 0, value: '' }
        }
      },
      effect: {
        templates: ['base'],
        type: 'normal',
        skill: '-',
        skillChoices: [],
        multiWeapon: { enabled: false, max: 1, requireSameSkill: false, weaponType: '-' },
        comboSkill: '-',
        comboBase: '-',
        difficulty: '',
        limit: '-',
        timing: '-',
        target: '',
        range: '',
        roll: '-',
        attackRoll: '-',
        add: '0',
        attack: '0',
        attackAchievement: '-',
        encroach: { init: 0, value: '' },
        hp: { value: '' },
        // 실측 보강: level.value 는 이펙트 1937건(팩 1578 + 월드 359) 전부가 저장한다.
        // document/item.js 가 채팅 카드에 쓰고 compendium-sync 가 갱신한다.
        level: { init: 1, max: 1, value: 0, upgrade: true },
        exp: { own: true, upgrade: true },
        effect: { disable: 'notCheck', runTiming: 'instant', action: '', attributes: {} },
        active: { state: false, disable: '-', runTiming: 'instant', action: '', applyMode: 'onUse' },
        used: { state: 0, max: 0, level: false, disable: 'notCheck' },
        attributes: {},
        getTarget: false,
        scene: false,
        macro: '',
        macros: [],
        // 실측 보강: 무기 선택 UI(effect-workspace-sheet-v2.html)가 쓰는 3필드. 233건.
        weaponSelect: false,
        weaponTmp: '-',
        weapon: [],
        resourceCost: {
          enabled: false,
          resource: 'hp',
          cap: '',
          mult: 1,
          attrKey: 'add',
          label: '-',
          disable: 'main'
        }
      },
      combo: {
        templates: ['base'],
        type: 'normal',
        base: '-',
        skill: '-',
        difficulty: '',
        timing: '-',
        range: '',
        target: '-',
        limit: '',
        roll: '-',
        attackRoll: '-',
        attackAchievement: '-',
        encroach: {},
        attack: {},
        add: {},
        dice: {},
        critical: {},
        guard: {},
        armor: {},
        major: {},
        reaction: {},
        dodge: {},
        weapon: [],
        active: { state: false, disable: '-', runTiming: 'instant' },
        attributes: {},
        weaponSelect: false,
        getTarget: false,
        scene: false,
        macro: '',
        macros: [],
        effect: { disable: 'notCheck', runTiming: 'instant', attributes: {} },
        // 실측 보강: 콤보 구성 UI 가 쓰는 3필드(월드 72건). effectIds 는 구성 이펙트의 정본이다.
        effectIds: [],
        effectTmp: '-',
        weaponTmp: '-'
      },
      spell: {
        templates: ['base'],
        spelltype: '-',
        exp: 0,
        invoke: { value: '0' },
        evocation: { value: '-' },
        encroach: { value: '0' },
        effect: { disable: 'notCheck', runTiming: 'instant', attributes: {} },
        active: { state: false, disable: '-', runTiming: 'instant' },
        attributes: {},
        getTarget: false,
        scene: false,
        macro: '',
        macros: [],
        // 실측 보강: 판정 종류(`-` 또는 `CastingRoll`). spell-sheet-v2.html 의 select 와
        // 캐스팅 판정 체크박스(`update({'system.roll': …})`)가 저작한다. template.json 에는
        // 선언이 없었고 병합 경로가 미선언 키를 보존해 준 덕에 동작했다.
        roll: '-',
        // 실측 보강: spell-sheet-v2 의 임시 주문 체크박스.
        temporarySpell: false
      },
      psionic: {
        templates: ['base'],
        type: 'normal',
        skill: '-',
        difficulty: '',
        limit: '-',
        timing: '-',
        target: '',
        range: '',
        roll: '-',
        attackRoll: '-',
        attackAchievement: '-',
        hp: { value: '' },
        // 실측 보강: psionic-sheet-v2 가 level.value 와 무기 선택 3필드를 쓴다(이펙트와 동형).
        level: { init: 1, max: 1, value: 0, upgrade: true },
        exp: { own: true, upgrade: true },
        effect: { disable: 'notCheck', runTiming: 'instant', attributes: {} },
        active: { state: false, disable: '-', runTiming: 'instant' },
        used: { state: 0, max: 0, level: false, disable: 'notCheck' },
        attributes: {},
        getTarget: false,
        scene: false,
        macro: '',
        macros: [],
        weaponSelect: false,
        weaponTmp: '-',
        weapon: []
      },
      weapon: {
        templates: ['base', 'item'],
        type: '-',
        skill: '-',
        add: 0,
        attack: 0,
        guard: 0,
        range: '',
        equipment: false,
        active: { state: false, disable: '-', runTiming: 'instant', action: '', applyMode: 'toggle' },
        used: { state: 0, max: 0, level: false, disable: 'notCheck' },
        'attack-used': { state: 0, max: 0, disable: 'notCheck' },
        effect: { disable: 'notCheck', runTiming: 'instant', action: '', attributes: {} },
        attributes: {},
        getTarget: false,
        scene: false,
        macro: '',
        macros: []
      },
      protect: {
        templates: ['base', 'item'],
        dodge: 0,
        init: 0,
        armor: 0,
        equipment: false,
        active: { state: false, disable: '-', runTiming: 'instant', action: '', applyMode: 'toggle' },
        used: { state: 0, max: 0, level: false, disable: 'notCheck' },
        effect: { disable: 'notCheck', runTiming: 'instant', action: '', attributes: {} },
        attributes: {},
        // 실측 보강: HP 소비 방어구 1건(팩). 다른 활성 타입과 같은 모양이다.
        hp: { value: '' },
        getTarget: false,
        scene: false,
        macro: '',
        macros: []
      },
      vehicle: {
        templates: ['base', 'item'],
        skill: '-',
        attack: 0,
        init: 0,
        armor: 0,
        move: 0,
        equipment: false,
        active: { state: false, disable: '-', runTiming: 'instant', action: '', applyMode: 'toggle' },
        used: { state: 0, max: 0, level: false, disable: 'notCheck' },
        effect: { disable: 'notCheck', runTiming: 'instant', action: '', attributes: {} },
        attributes: {},
        getTarget: false,
        scene: false,
        macro: '',
        macros: []
      },
      connection: {
        templates: ['base', 'item'],
        skill: '-',
        active: { state: false, disable: '-', runTiming: 'instant' },
        attributes: {},
        getTarget: false,
        effect: { disable: 'notCheck', runTiming: 'instant', attributes: {} },
        // 실측 보강: connection-sheet-v2 가 사용 횟수를 저작한다(팩 17건).
        used: { state: 0, max: 0, level: false, disable: 'notCheck' },
        // 실측 보강: connection-sheet-v2.html 의 매크로 칸. 임베드 매크로 목록(`macros`)을
        // 쓰는 타입은 아니고 단일 매크로만 저작한다(item-sheet.js 의 embedMacroTypes 참조).
        macro: ''
      },
      book: {
        templates: ['base', 'item'],
        type: 'book',
        exp: 0,
        decipher: 0,
        macro: '',
        macros: [],
        // 실측 보강: 마법서에 등재한 스펠 id 목록. template.json 은 이것을 선언한 적이 없고
        // 병합 경로가 미선언 키를 보존해 준 덕에 동작했다(book-sheet-v2 의 addSpell/removeSpell 이
        // `system.spells` 를 통째로 갱신한다). 선언하지 않으면 등재가 조용히 사라진다.
        // 팩·월드 실측으로는 잡히지 않았다 — 아직 스펠을 담은 마법서 문서가 없었을 뿐이다.
        spells: [],
        used: { state: 0, max: 0, level: true, disable: 'notCheck' }
      },
      once: {
        templates: ['base', 'item'],
        type: 'once',
        quantity: 1,
        macro: '',
        macros: [],
        active: { state: false, disable: '-', runTiming: 'instant', action: '', applyMode: 'onUse' },
        used: { state: 0, max: 1, level: false, disable: 'session' },
        effect: { disable: 'notCheck', runTiming: 'instant', action: '', attributes: {} },
        attributes: {},
        getTarget: false,
        scene: false
      },
      etc: {
        templates: ['base', 'item'],
        type: 'etc',
        quantity: 1,
        macro: '',
        macros: [],
        active: { state: false, disable: '-', runTiming: 'instant', action: '', applyMode: 'onUse' },
        used: { state: 0, max: 0, level: false, disable: 'notCheck' },
        effect: { disable: 'notCheck', runTiming: 'instant', action: '', attributes: {} },
        attributes: {},
        // 실측 보강: HP 를 소비하는 기타 아이템 4건(팩).
        hp: { value: '' },
        getTarget: false,
        scene: false
      },
      works: {
        templates: ['base'],
        attributes: {
          body: { value: 0 },
          sense: { value: 0 },
          mind: { value: 0 },
          social: { value: 0 }
        },
        skillTmp: 'melee',
        skills: {}
      },
      syndrome: {
        templates: ['base'],
        attributes: {
          body: { value: 0 },
          sense: { value: 0 },
          mind: { value: 0 },
          social: { value: 0 }
        }
      },
      rois: {
        templates: ['base'],
        type: '-',
        positive: { state: false, feeling: '' },
        negative: { state: false, feeling: '' },
        actor: null,
        titus: false,
        sublimation: false,
        macros: [],
        attributes: {},
        active: { state: false, disable: '-', runTiming: 'instant' },
        used: { state: 0, max: 0, level: false, disable: 'notCheck' },
        // 실측 보강: 침식치를 가진 D로이스 4건(팩). 다른 아이템과 같은 encroach 모양이다.
        encroach: { init: 0, value: '' }
      },
      record: {
        templates: ['base'],
        exp: 0,
        // 실측 보강: record-sheet-v2 의 침식률 입력(월드 13건).
        encroachment: 0
      }
    }
  };

  /** 타입 하나의 최종 기본값(템플릿 병합 결과). */
  function mergeType(kind, type) {
    const def = DEFAULTS[kind]?.[type];
    if (!def) return null;
    const merged = {};
    for (const name of def.templates || []) {
      Object.assign(merged, structuredClone(DEFAULTS[kind].templates[name] || {}));
    }
    for (const [key, value] of Object.entries(def)) {
      if (key === 'templates') continue;
      merged[key] = structuredClone(value);
    }
    return merged;
  }

  /**
   * 타입을 강제하지 않는 필드. template.json 병합이 값에 손대지 않던 것을 그대로 재현한다.
   * 수치 칸에 수식(`4+[level]`)이나 `-`/`불가` 같은 표기가 들어 있는 문서가 실제로 있어서
   * NumberField 로 옮기면 그 값들이 사라진다.
   */
  let LooseField = null;
  function looseFieldClass() {
    if (LooseField) return LooseField;
    LooseField = class DX3rdLooseField extends foundry.data.fields.DataField {
      static get _defaults() {
        return Object.assign(super._defaults, { required: true, nullable: true });
      }
      _cast(value) { return value; }
      _validateType() {}
    };
    return LooseField;
  }

  /**
   * 기본값 하나를 필드로 옮긴다.
   * - 빈 객체 = 자유 맵(applied 버킷, 보정 행, 스킬 등) → ObjectField
   * - 그 밖의 객체 → SchemaField (재귀)
   * - 그 밖의 값 → 불리언만 BooleanField, 나머지는 LooseField
   */
  function toField(value, context) {
    const fields = foundry.data.fields;
    const Loose = looseFieldClass();

    if (Array.isArray(value)) {
      // 배열도 LooseField 로 받는다 — 레거시 문서가 배열 자리에 객체를 넣어 둔 경우가 있고
      // (universal-extensions 의 effect 배열 폴백), ArrayField 는 그것을 기본값으로 날린다.
      return new Loose({ initial: () => structuredClone(value) });
    }
    if (value && typeof value === 'object') {
      if (Object.keys(value).length === 0) {
        return new fields.ObjectField({ required: true, initial: () => ({}) });
      }
      const schema = {};
      // 버킷은 채널 그룹 바로 아래에만 붙는다. 하위 그룹까지 따라 내려가면 안 된다.
      for (const [key, child] of Object.entries(value)) schema[key] = toField(child, { buckets: false });
      // 지속 효과 버킷은 저작했을 때만 생긴다(`system.<active|effect>.buckets.<action>`).
      // 선언하지 않으면 정리 단계에서 지워지고, 기본값을 주면 없던 문서에도 빈 객체가 생겨
      // `버킷이 있는가` 판정이 흔들린다. 그래서 initial 없이 선택 필드로만 둔다.
      if (context.buckets && !('buckets' in schema)) {
        schema.buckets = new fields.ObjectField({ required: false, nullable: true, initial: undefined });
      }
      return new fields.SchemaField(schema);
    }
    if (typeof value === 'boolean') {
      return new fields.BooleanField({ initial: value });
    }
    return new Loose({ initial: value === undefined ? null : value });
  }

  /** 타입 하나의 DataModel 스키마. */
  function buildSchema(kind, type) {
    const merged = mergeType(kind, type);
    if (!merged) return null;
    const schema = {};
    for (const [key, value] of Object.entries(merged)) {
      // 버킷을 붙일 곳은 자기 채널(active)과 대상 채널(effect) 두 그룹뿐이다.
      const buckets = (kind === 'Item') && (key === 'active' || key === 'effect');
      schema[key] = toField(value, { buckets });
    }
    return schema;
  }

  /** 기본값이 불리언인 잎의 경로 목록(맵 하위는 타입이 없으므로 제외). */
  const booleanPathCache = new Map();
  function booleanPaths(kind, type) {
    const cacheKey = `${kind}.${type}`;
    if (booleanPathCache.has(cacheKey)) return booleanPathCache.get(cacheKey);
    const paths = [];
    (function walk(node, prefix) {
      for (const [key, value] of Object.entries(node)) {
        const p = prefix ? `${prefix}.${key}` : key;
        if (typeof value === 'boolean') paths.push(p.split('.'));
        else if (value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length) {
          walk(value, p);
        }
      }
    })(mergeType(kind, type) || {}, '');
    booleanPathCache.set(cacheKey, paths);
    return paths;
  }

  /**
   * 체크박스가 남긴 문자열을 불리언으로 되돌린다.
   *
   * template.json 경로는 값을 검사하지 않았으므로, `data-dtype` 없이 제출된 체크박스의
   * 원시값 `"on"` 이 그대로 저장된 문서가 있다(실측: getTarget 38건). BooleanField 는
   * 문자열을 `value === "true"` 로만 참으로 보므로 `"on"` 이 **false 로 뒤집힌다** —
   * 대상 지정이 필요한 이펙트가 조용히 대상을 묻지 않게 되는 회귀다. 정리 직전에 도는
   * migrateData 에서 되돌려 둔다.
   */
  const FALSY_STRINGS = new Set(['', 'false', 'off', '0', 'null', 'undefined']);
  function repairLegacyCheckboxes(kind, type, source) {
    if (!source || typeof source !== 'object') return source;
    for (const parts of booleanPaths(kind, type)) {
      let node = source;
      for (let i = 0; i < parts.length - 1; i++) {
        node = node?.[parts[i]];
        if (!node || typeof node !== 'object') { node = null; break; }
      }
      if (!node) continue;
      const key = parts[parts.length - 1];
      const value = node[key];
      if (typeof value === 'string') node[key] = !FALSY_STRINGS.has(value.trim().toLowerCase());
    }
    return source;
  }

  function modelClass(kind, type) {
    return class DX3rdTypeDataModel extends foundry.abstract.TypeDataModel {
      static defineSchema() {
        return buildSchema(kind, type);
      }

      static migrateData(source) {
        return repairLegacyCheckboxes(kind, type, source);
      }
    };
  }

  function registerDataModels() {
    for (const kind of ['Actor', 'Item']) {
      const models = CONFIG[kind].dataModels ?? (CONFIG[kind].dataModels = {});
      for (const type of DEFAULTS[kind].types) models[type] = modelClass(kind, type);
    }
    window.DX3rdDebug.log(
      `DX3rd | 문서 스키마 등록: Actor ${DEFAULTS.Actor.types.length}종 / Item ${DEFAULTS.Item.types.length}종`
    );
  }

  window.DX3rdDocumentSchema = DEFAULTS;
  window.DX3rdDataModels = { mergeType, buildSchema, register: registerDataModels };

  Hooks.once('init', registerDataModels);
})();
