/**
 * The DX3rd document schema — it replaces the retired template.json.
 *
 * Foundry deprecated template.json in V14 and stops reading it in V16. The replacement path is system.json's
 * `documentTypes` (declaring the subtypes) plus `CONFIG.<Document>.dataModels` (the schema).
 *
 * ── What had to be preserved while moving ──────────────────────────────────────
 * The template.json path was not a schema but a **defaults merge** (`TypeDataField._cleanType`'s
 * `mergeObject(template, value, {insertKeys})`). Two things therefore came for free:
 *   ① Keys absent from the declaration were still stored and survived.
 *   ② Nobody enforced a value's type — a slot declared `attack: 0` holding `"4+[level]"` was preserved
 *      exactly as it was.
 * A DataModel does neither. An undeclared key is **erased** during cleaning, and a NumberField swallows a
 * formula string. So this file:
 *   ① took a full census of the live data (2745 pack documents + 2 worlds: 122 actors, 803 embedded items) and
 *      put every undeclared storage path it found into the declaration (the "measured addition" comments below),
 *   ② and receives primitives through DX3rdLooseField, which does **not** enforce a type. Only booleans are BooleanField.
 * That is, it reproduces template.json's merge semantics exactly while declaring only which keys exist.
 *
 * The only things the census flagged as undeclared that were **deliberately left out** are dead fields —
 * `system.system`/`system.name`/`system.type`/`system.img` (the nested copies migrations v1 and v2 delete),
 * `conditions.lostHP` (v3), and `system.roll-check`
 * (combo-data deletes it). The DataModel drops them automatically at load time, so the outcome is the same;
 * there is simply that much less for the migration to catch.
 *
 * `conditions.healing` was once on that list, but that was **a misdiagnosis**. v3 deleted it on the grounds that
 * "no code reads it", yet the cleanup process's healing handling (combat.js) was reading it even then. With the
 * declaration gone, that handling silently became a no-op — leaving the asymmetry of poison (a cleanup HP loss)
 * with no healing (a cleanup HP gain) — so it was restored. Do not take it out.
 *
 * An active item type that draws a persistent-effect card has to store both of the card's axes.
 * `active.action`/`applyMode` preserve the self modifiers' firing action and application channel, and
 * `effect.action` preserves the target modifiers' firing action. Without these fields the sheet looks as though
 * it changed, but the value disappears in the DataModel cleaning and the applier runs a different channel.
 */
(function () {
  // The same shape as template.json (types / templates / per-type definitions). The tools read it directly.
  const DEFAULTS = {
    Actor: {
      types: ['character', 'enemy'],
      templates: {},
      character: {
        actorType: 'NPC',
        codeName: '',
        // Measured addition: the actor sheet's ProseMirror biography (42 documents across 2 worlds). It was absent from template.json.
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
          // The counterpart of poison. The cleanup process restores HP by value (combat.js).
          healing: { active: false, value: 0 },
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
          healing: { active: false, value: 0 },
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
          skills: {},
          // Attacker side — "this attack ignores the target's armor / guard / reaction".
          // Kept separate from `penetrate`, which is a *numeric* armor reduction that some rules
          // ask for specifically (e.g. 《플래시 스팅어》 "장갑치를 [LVx8]만큼 무시"). These three are
          // the all-or-nothing form, and they live on `base` because weapons, etc items and
          // D-Lois carry them as often as effects do (레일 건, 브레이커, No.59 잊을 수 없는 사람).
          bypassDefense: { armor: false, guard: false, reaction: false },
          // Defender side — the counter the rules actually print for each of the above.
          // `armor`: 《이지스 링》 "「장갑치를 무시하고 데미지를 산출하는」 이펙트의 효과를 무시".
          // `guard`: 《마그넷 체인》《비호하는 짐승》《에너지 실드》 "「리액션을 실행할 수 없다」거나
          //   「가드를 실행할 수 없다」는 효과를 가진 공격에 대해서도 가드를 실행할 수 있다" — either
          //   bypassed axis opens the *guard*, and it never opens the reaction.
          // `reaction`: 《전지의 파편》 "「리액션을 실행할 수 없다」 혹은 「닷지를 실행할 수 없다」는 효과를
          //   가진 공격에 대해서도 닷지를 실행할 수 있다" — the separate counter that does give the
          //   reaction back. The two are not interchangeable, which is why they are separate flags.
          restoreDefense: { armor: false, guard: false, reaction: false }
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
        // Measured addition: level.value is stored by all 1937 effects (1578 in the packs + 359 in the worlds).
        // document/item.js writes it on the chat card, and compendium-sync updates it.
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
        // Measured addition: the 3 fields used by the weapon-selection UI (effect-workspace-sheet-v2.html). 233 documents.
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
        },
        // The [pressure]/[berserk] exemption. Only effects whose rules text explicitly says something like "it can be
        // used even while in [pressure]" are turned on — authored in the extend tool's "effect detail settings", and
        // read by DX3rdUsageGates.conditionExempt. The two conditions block at different timings
        // (pressure = auto / berserk = reaction and dodge), so they were not merged into one field.
        conditionExempt: { pressure: false, berserk: false }
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
        active: { state: false, disable: '-', runTiming: 'instant', action: '', applyMode: 'onUse' },
        attributes: {},
        weaponSelect: false,
        getTarget: false,
        scene: false,
        macro: '',
        macros: [],
        effect: { disable: 'notCheck', runTiming: 'instant', action: '', attributes: {} },
        // Measured addition: the 3 fields used by the combo composition UI (72 documents across the worlds). effectIds is the canonical list of member effects.
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
        effect: { disable: 'notCheck', runTiming: 'instant', action: '', attributes: {} },
        active: { state: false, disable: '-', runTiming: 'instant', action: '', applyMode: 'onUse' },
        attributes: {},
        getTarget: false,
        scene: false,
        macro: '',
        macros: [],
        // Measured addition: the roll kind (`-` or `CastingRoll`). It is authored by the select in spell-sheet-v2.html
        // and by the casting-roll checkbox (`update({'system.roll': …})`). template.json never declared it, and it
        // worked only because the merge path preserved undeclared keys.
        roll: '-',
        // Measured addition: the temporary-spell checkbox in spell-sheet-v2.
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
        // Measured addition: psionic-sheet-v2 uses level.value and the 3 weapon-selection fields (the same shape as an effect).
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
        // Measured addition: 1 HP-consuming piece of armor (in the packs). The same shape as the other active types.
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
        // Measured addition: connection-sheet-v2 authors the use count (17 documents in the packs).
        used: { state: 0, max: 0, level: false, disable: 'notCheck' },
        // Measured addition: the macro field in connection-sheet-v2.html. This type does not use the embedded macro
        // list (`macros`); it authors a single macro only (see embedMacroTypes in item-sheet.js).
        macro: ''
      },
      book: {
        templates: ['base', 'item'],
        type: 'book',
        exp: 0,
        decipher: 0,
        macro: '',
        macros: [],
        // Measured addition: the list of spell ids registered in a spellbook. template.json never declared it and it
        // worked only because the merge path preserved undeclared keys (book-sheet-v2's addSpell/removeSpell replace
        // `system.spells` wholesale). Without the declaration, a registration silently disappears.
        // The pack / world census did not catch it — there simply was no spellbook document holding a spell yet.
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
        // Measured addition: 4 miscellaneous items that consume HP (in the packs).
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
        // Measured addition: 4 D-Lois with an encroachment value (in the packs). The same encroach shape as other items.
        encroach: { init: 0, value: '' }
      },
      record: {
        templates: ['base'],
        exp: 0,
        // Measured addition: the encroachment rate input in record-sheet-v2 (13 documents across the worlds).
        encroachment: 0
      }
    }
  };

  /** The final defaults for one type (the result of merging its templates). */
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
   * A field that does not enforce a type. It reproduces exactly how the template.json merge left values alone.
   * Documents really do hold a formula (`4+[level]`) or a notation such as `-` / `불가` in a numeric slot, so moving
   * to a NumberField would make those values disappear.
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
   * Turn a single default value into a field.
   * - an empty object = a free map (applied buckets, modifier rows, skills, …) → ObjectField
   * - any other object → SchemaField (recursively)
   * - any other value → BooleanField for booleans only, LooseField for the rest
   */
  function toField(value, context) {
    const fields = foundry.data.fields;
    const Loose = looseFieldClass();

    if (Array.isArray(value)) {
      // Arrays are received through LooseField too — a legacy document sometimes holds an object where an array
      // belongs (the effect array fallback in universal-extensions), and an ArrayField would blow that away to its default.
      return new Loose({ initial: () => structuredClone(value) });
    }
    if (value && typeof value === 'object') {
      if (Object.keys(value).length === 0) {
        return new fields.ObjectField({ required: true, initial: () => ({}) });
      }
      const schema = {};
      // Buckets attach directly under a channel group only. They must not follow down into subgroups.
      for (const [key, child] of Object.entries(value)) schema[key] = toField(child, { buckets: false });
      // A persistent-effect bucket comes into existence only when authored (`system.<active|effect>.buckets.<action>`).
      // Leaving it undeclared would have the cleaning step erase it, while giving it a default would create an empty
      // object even on documents that never had one, shaking the "is there a bucket" test. Hence an optional field with no initial.
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

  /** The DataModel schema for one type. */
  function buildSchema(kind, type) {
    const merged = mergeType(kind, type);
    if (!merged) return null;
    const schema = {};
    for (const [key, value] of Object.entries(merged)) {
      // Buckets attach to exactly two groups: the self channel (active) and the target channel (effect).
      const buckets = (kind === 'Item') && (key === 'active' || key === 'effect');
      schema[key] = toField(value, { buckets });
    }
    return schema;
  }

  /** The paths of the leaves whose default is a boolean (map descendants are excluded, having no type). */
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
   * Turn the string a checkbox left behind back into a boolean.
   *
   * The template.json path never inspected values, so there are documents storing the raw `"on"` a checkbox submitted
   * without `data-dtype` (measured: 38 getTarget documents). A BooleanField only treats a string as true when
   * `value === "true"`, so `"on"` **flips to false** — a regression in which an effect that needs a target silently
   * stops asking for one. It is reversed in migrateData, which runs right before the cleaning step,
   * so the stored value is restored first.
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
