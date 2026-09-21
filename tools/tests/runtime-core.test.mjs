import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { resolve, sep } from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import {
  convertedValue as convertLegacyD10Value,
  migrate as migrateLegacyD10Modifiers
} from '../migrations/2026-08-11-dice-only-modifiers-to-formulas.mjs';
import {
  normalizeDiceCount,
  normalizeDiceFormula
} from '../migrations/2026-08-13-normalize-dice-count-parens.mjs';

const root = resolve(import.meta.dirname, '..', '..');
const source = path => readFileSync(resolve(root, path), 'utf8');

function baseContext(extra = {}) {
  const context = vm.createContext({
    console,
    setTimeout,
    clearTimeout,
    structuredClone,
    ...extra
  });
  context.window = context;
  // debug-log.js는 system.json scripts[0]이라 런타임에서 window.DX3rdDebug의 존재가
  // 항상 보장된다. 그래서 프로덕션 코드 225곳이 가드 없이 window.DX3rdDebug.log(...)를
  // 부른다. 그 전제를 하네스에서도 재현해야 하므로 실제 모듈을 그대로 싣는다
  // (스텁이 아니라 실물이라, 조기 반환 동작까지 함께 검증된다).
  load(context, 'scripts/core/debug-log.js');
  return context;
}

function load(context, path) {
  vm.runInContext(source(path), context, { filename: path });
}

/**
 * 문서 스키마(구 template.json). 로드 시점에 window/Hooks 만 쓰므로 vm 없이 꺼낼 수 있다.
 * vm 컨텍스트를 쓰면 안 된다 — Foundry 의 isPlainObject 가 교차 realm 객체를 거부한다.
 */
function documentSchema() {
  const sandbox = {};
  new Function('window', 'Hooks', source('scripts/data/document-schema.js'))(sandbox, { once() {} });
  return sandbox.DX3rdDocumentSchema;
}

test('dedicated D10 modifier fields migrate to equivalent general roll formulas', () => {
  // 괄호는 안쪽에 연산이 있을 때만 남는다. 없으면 `[level]+1d10` = level + (1d10) 이 되어
  // 뜻이 달라지기 때문이고, 단일 항이면 괄호도 선행 `+` 도 아무 일을 하지 않는다.
  assert.equal(convertLegacyD10Value('damage_roll', '+[level]*2'), '([level]*2)d10');
  assert.equal(convertLegacyD10Value('guard_roll', '[level]+1'), '([level]+1)d10');
  assert.equal(convertLegacyD10Value('reduce_roll', '2d10'), '2d10');
  assert.equal(convertLegacyD10Value('dxroll', 3), '3d10');
  assert.equal(convertLegacyD10Value('damage_roll', '+2'), '2d10');

  const doc = {
    system: {
      attributes: {
        damage: {key: 'damage_roll', label: 'melee', value: '+2', action: 'attack'},
        guard: {key: 'guard_roll', label: 'guard_roll', value: '[level]'},
        ordinary: {key: 'add', label: '-', value: '1d10'}
      },
      effect: {attributes: {
        reduction: {key: 'reduce_roll', label: 'reduce_roll', value: '2d10'},
        orphanLabel: {key: 'reduce', label: 'reduce_roll', value: '1d10'}
      }}
    }
  };
  const failures = [];
  migrateLegacyD10Modifiers(doc, {fail: message => failures.push(message)});

  assert.deepEqual(doc.system.attributes.damage,
    {key: 'attack', label: 'melee', value: '2d10', action: 'attack'});
  assert.deepEqual(doc.system.attributes.guard,
    {key: 'guard', label: '-', value: '[level]d10'});
  assert.deepEqual(doc.system.attributes.ordinary,
    {key: 'add', label: '-', value: '1d10'});
  assert.deepEqual(doc.system.effect.attributes.reduction,
    {key: 'reduce', label: '-', value: '2d10'});
  assert.deepEqual(doc.system.effect.attributes.orphanLabel,
    {key: 'reduce', label: '-', value: '1d10'});
  assert.deepEqual(failures, []);
});

test('DX dice formulas in modifier rows are reported instead of silently converted', () => {
  const doc = {system: {attributes: {bad: {key: 'dxroll', label: '-', value: '10dx7'}}}};
  const failures = [];
  migrateLegacyD10Modifiers(doc, {fail: message => failures.push(message)});
  assert.equal(doc.system.attributes.bad.key, 'dxroll');
  assert.equal(failures.length, 1);
  assert.match(failures[0], /10dx7/);
});

test('runtime authoring exposes only general modifier fields', () => {
  const forbidden = ['damage_roll', 'guard_roll', 'reduce_roll', 'dxroll'];
  const runtimeFiles = walkJs(resolve(root, 'scripts'));
  const storedSources = [
    resolve(root, '_source/item-mech-overrides.json'),
    resolve(root, '_source/effect-mech-overrides.json')
  ];
  for (const path of [...runtimeFiles, ...storedSources]) {
    const text = readFileSync(path, 'utf8');
    for (const key of forbidden) {
      assert.equal(text.includes(key), false, `${path} still contains ${key}`);
    }
  }
});

function walkJs(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const path = resolve(directory, entry.name);
    return entry.isDirectory() ? walkJs(path) : (entry.name.endsWith('.js') ? [path] : []);
  });
}

test('basic encroachment sums the shared encroach.init field on every non-record item', () => {
  class ActorMock {
    prepareData() {}
    async _preUpdate() {}
    importFromJSON() {}
  }
  const context = baseContext({
    foundry: {
      documents: { Actor: ActorMock },
      utils: {}
    },
    Actor: ActorMock,
    CONFIG: { Actor: {} },
    game: { settings: { get: () => '-' } }
  });
  load(context, 'scripts/document/actor.js');
  const result = vm.runInContext(`DX3rdItemEncroachInit.sum([
    {type:'effect', system:{encroach:{init:2}}},
    {type:'etc', system:{encroach:{init:'5'}}},
    {type:'protect', system:{encroach:{init:-1}}},
    {type:'record', system:{encroach:{init:99}, encroachment:3}},
    {type:'etc', system:{encroach:{value:'4'}}}
  ])`, context);
  assert.equal(result, 6);
  assert.match(
    source('scripts/document/actor.js'),
    /sumItemEncroachInit\(actorItems\)/,
    'prepareData must reuse the in-scope normalized actor item list'
  );
});

test('actor preparation helpers are real prototype methods, not swallowed by comments', () => {
  class ActorMock {
    prepareData() {}
    async _preUpdate() {}
    importFromJSON() {}
  }
  const context = baseContext({
    foundry: {
      documents: { Actor: ActorMock },
      utils: {}
    },
    Actor: ActorMock,
    CONFIG: { Actor: {} },
    game: { settings: { get: () => '-' } }
  });
  load(context, 'scripts/document/actor.js');

  const prototype = context.CONFIG.Actor.documentClass.prototype;
  assert.equal(typeof prototype._prepareActorEnc, 'function',
    '침식률 준비 메서드가 없으면 모든 캐릭터 prepareData가 첫 단계에서 중단된다');
  assert.equal(typeof prototype._makeContribReader, 'function',
    '보정치 리더가 없으면 캐릭터와 에너미의 파생 어트리뷰트를 계산할 수 없다');
});

test('saving points are recalculated from the current maximum and owned item costs', () => {
  class ActorMock {
    prepareData() {}
    async _preUpdate() {}
    importFromJSON() {}
  }
  const context = baseContext({
    foundry: {
      documents: { Actor: ActorMock },
      utils: {}
    },
    Actor: ActorMock,
    CONFIG: { Actor: {} },
    game: { settings: { get: () => '-' } }
  });
  load(context, 'scripts/document/actor.js');
  const result = JSON.parse(vm.runInContext(`JSON.stringify({
    unused: DX3rdSaving.remain(20, []),
    partlyUsed: DX3rdSaving.remain(20, [
      {type:'weapon', system:{saving:{value:3}}},
      {type:'protect', system:{saving:{value:'5'}}},
      {type:'connection', system:{saving:{value:7, acquisition:'purchase'}}},
      {type:'etc', system:{saving:{value:4, acquisition:'other'}}},
      {type:'effect', system:{saving:{value:99}}}
    ]),
    overspent: DX3rdSaving.remain(6, [
      {type:'vehicle', system:{saving:{value:10}}}
    ])
  })`, context));
  // 초과 지출은 0으로 감추지 않는다 — 몇 점 모자란지가 화면에 보여야 한다.
  assert.deepEqual(result, { unused: 20, partlyUsed: 12, overspent: -4 });

  const actor = source('scripts/document/actor.js').replace(/\s+/g, ' ');
  assert.ok(actor.includes('attrs.saving.remain = calculateSavingRemain(attrs.saving.max, actorItems);'),
    '과거 remain=0에 Math.min을 적용하면 잔여 상비점이 영구히 0으로 고정된다');
});

test('current stock is derived from remaining saving points and recorded adjustments', () => {
  class ActorMock {
    prepareData() {}
    async _preUpdate() {}
    importFromJSON() {}
  }
  const context = baseContext({
    foundry: {
      documents: { Actor: ActorMock },
      utils: {}
    },
    Actor: ActorMock,
    CONFIG: { Actor: {} },
    game: { settings: { get: () => '-' } }
  });
  load(context, 'scripts/document/actor.js');
  const result = JSON.parse(vm.runInContext(`JSON.stringify({
    spent: DX3rdStock.derive(12, -3, 0),
    gained: DX3rdStock.derive(12, 5, 0),
    overspent: DX3rdStock.derive(2, -9, 0),
    negativeBase: DX3rdStock.derive(-5, -2, 0)
  })`, context));
  // 0 클램프 금지: 초과 지출분이 화면에서 사라지고 modifier에 숨은 음수로 쌓인다.
  assert.deepEqual(result, {
    spent: {base: 12, modifier: -3, value: 9, max: 12, min: 0},
    gained: {base: 12, modifier: 5, value: 17, max: 12, min: 0},
    overspent: {base: 2, modifier: -9, value: -7, max: 2, min: 0},
    negativeBase: {base: -5, modifier: -2, value: -7, max: -5, min: 0}
  });

  const actorSource = source('scripts/document/actor.js').replace(/\s+/g, ' ');
  assert.ok(actorSource.includes('Math.max(Number(attrs.saving.remain) || 0, 0) + stockBonus'),
    '상비점 초과분을 재산점 기본값으로 넘기면 한 번의 초과 지출이 두 점수에 이중으로 물린다');

  const dialog = source('scripts/sheets/actor-edit-dialogs.js').replace(/\s+/g, ' ');
  assert.ok(dialog.includes('"system.attributes.stock.modifier": nextStock - baseStock'),
    '최소값에 고정된 숨은 음수 수정치가 다음 증감을 삼키면 안 된다');
  assert.ok(dialog.includes('"flags.dx3rd-emanim.stockHistory": [...history, entry].slice(-100)'));
  assert.ok(dialog.includes('const reason = String(reasonField?.value || \'\').trim()'),
    '현재 재산점 변경은 사유 없이 기록되면 안 된다');

  const template = source('templates/actor/actor-sheet-v2.html');
  const baseIndex = template.indexOf('system.attributes.stock.base');
  const currentIndex = template.indexOf('system.attributes.stock.value', baseIndex);
  assert.ok(baseIndex >= 0 && currentIndex > baseIndex,
    '재산점은 기본 / 현재 순서로 표시해야 한다');
  assert.match(template, /stock-point-fields" data-action="useStock"/,
    '재산점 수치 자체를 눌러 기록 다이얼로그를 열 수 있어야 한다');

  const backtrack = source('scripts/sheets/backtrack-workflow.js');
  assert.match(backtrack, /updates\['system\.attributes\.stock\.modifier'\]\s*=\s*0/,
    '백트랙 초기화는 파생 current 값을 저장하지 않고 누적 수정치를 초기화해야 한다');
  assert.match(source('scripts/dx3rd-applied-effects.js'),
    /stock_point:\s*'system\.attributes\.stock\.base'/,
    'stock_point 효과는 사용 기록이 아니라 기본 재산점에 기여해야 한다');
});

test('the document schema declares every field live documents and sheets actually store', () => {
  // template.json 은 스키마가 아니라 기본값 병합이라 선언에 없는 키도 살아남았다. DataModel 은
  // 미선언 키를 정리 단계에서 지우므로, 라이브 팩·월드 실측으로 찾아낸 이 필드들이 선언에서
  // 빠지면 그 데이터가 조용히 사라진다. 각 항목 옆 숫자는 발견 당시의 실측 문서 수다.
  const schema = documentSchema();
  const merged = (kind, type) => {
    const def = schema[kind][type];
    const out = {};
    for (const name of def.templates || []) Object.assign(out, schema[kind].templates[name]);
    for (const [key, value] of Object.entries(def)) if (key !== 'templates') out[key] = value;
    return out;
  };

  assert.equal(merged('Item', 'effect').level.value, 0, 'effect.level.value (1937건)');
  assert.equal(merged('Item', 'effect').weaponSelect, false, 'effect.weaponSelect (233건)');
  assert.equal(merged('Item', 'effect').weaponTmp, '-', 'effect.weaponTmp');
  assert.ok(Array.isArray(merged('Item', 'effect').weapon), 'effect.weapon');
  assert.equal(merged('Item', 'psionic').level.value, 0, 'psionic 시트도 같은 필드를 쓴다');
  assert.ok(Array.isArray(merged('Item', 'combo').effectIds), 'combo.effectIds — 구성 이펙트의 정본');
  assert.equal(merged('Item', 'combo').effectTmp, '-', 'combo.effectTmp');
  assert.equal(merged('Item', 'combo').weaponTmp, '-', 'combo.weaponTmp');
  assert.equal(merged('Item', 'spell').temporarySpell, false, 'spell.temporarySpell');
  assert.equal(merged('Item', 'connection').used.disable, 'notCheck', 'connection.used (17건)');
  assert.equal(merged('Item', 'etc').hp.value, '', 'etc.hp (4건)');
  assert.equal(merged('Item', 'protect').hp.value, '', 'protect.hp (1건)');
  assert.equal(merged('Item', 'rois').encroach.init, 0, 'rois.encroach (4건)');
  assert.equal(merged('Item', 'record').encroachment, 0, 'record.encroachment (13건)');
  assert.equal(merged('Actor', 'character').description, '', '액터 약력 (42건)');
  assert.equal(merged('Actor', 'enemy').description, '');

  // 라이브 실측으로는 잡히지 않은 셋 — 기능은 있는데 아직 그 값을 담은 문서가 없었을 뿐이다.
  // 소스 정적 검사(tools/audit-schema-coverage.mjs)가 찾아냈다. 선언이 빠지면 각각
  // 마법서 스펠 등재 · 캐스팅 판정 선택 · 커넥션 매크로가 저장 직후 사라진다.
  assert.ok(Array.isArray(merged('Item', 'book').spells), 'book.spells — 마법서에 등재한 스펠 id');
  assert.equal(merged('Item', 'spell').roll, '-', 'spell.roll — 판정 종류(-/CastingRoll)');
  assert.equal(merged('Item', 'connection').macro, '', 'connection.macro');

  // 지속 효과 UI를 공유하는 타입은 카드 축을 실제 문서에 보존해야 한다. 이 필드가 없으면
  // 기본 버킷의 드롭다운만 바뀐 것처럼 보이고 다음 DataModel 정리에서 원래 값으로 돌아간다.
  for (const type of ['spell', 'psionic', 'combo']) {
    assert.equal(merged('Item', type).active.action, '', `${type}.active.action`);
    assert.equal(merged('Item', type).active.applyMode, 'onUse', `${type}.active.applyMode`);
    assert.equal(merged('Item', type).effect.action, '', `${type}.effect.action`);
  }

  // 버킷은 저작 전에는 없어야 한다 — 기본값으로 빈 객체를 채우면 「버킷이 있는가」 판정이 흔들린다.
  const schemaSource = source('scripts/data/document-schema.js');
  assert.match(schemaSource, /buckets = new fields\.ObjectField\(\{ required: false, nullable: true, initial: undefined \}\)/,
    '버킷은 initial 없는 선택 필드여야 한다');
  // 체크박스가 남긴 "on" 을 BooleanField 가 false 로 접는다(실측 38건). migrateData 가 되돌린다.
  assert.match(schemaSource, /static migrateData\(source\) \{\s*return repairLegacyCheckboxes/,
    '레거시 체크박스 문자열 복구가 migrateData 에 걸려 있어야 한다');
});

test('the sheet context copies item.system instead of aliasing the live DataModel', () => {
  // `item.system` 은 DataModel 인스턴스다. foundry.utils.deepClone 은 isPlainObject 가 아니면
  // **원본 참조를 그대로 돌려주므로**, 그냥 넘기면 시트 준비 코드의 기본값 대입(prepareSystem)과
  // 시트별 준비(콤보의 effectItems·플레이스홀더 등)가 라이브 문서에 그대로 꽂힌다 —
  // 시트를 여는 것만으로 문서가 변형된다. template.json 시절엔 평범한 객체라 복제됐다.
  const sheetSource = source('scripts/sheets/item-sheet.js');
  const clone = sheetSource.match(/function cloneSystem\(system\) \{[\s\S]*?\n {4}\}/);
  assert.ok(clone, 'cloneSystem 이 있어야 한다');
  const code = clone[0].replace(/^\s*\/\/.*$/gm, ''); // 주석 제외 — 아래 금지어를 설명이 언급한다
  assert.match(code, /instanceof foundry\.abstract\.DataModel/,
    'DataModel 이면 한 겹 전개해 평범한 객체로 만든 뒤 복제해야 한다');
  assert.doesNotMatch(code, /toObject\(/,
    'toObject() 는 _source 만 돌려주어 prepareDerivedData 가 붙인 파생값을 잃는다');
});

test('non-effect item sheets store a mutually exclusive permanent, purchased or other acquisition', () => {
  const schema = documentSchema();
  assert.equal(schema.Item.templates.item.saving.acquisition, 'permanent');

  for (const path of [
    'templates/item/active-item-sheet-v2.html',
    'templates/item/connection-sheet-v2.html',
    'templates/item/book-sheet-v2.html'
  ]) {
    const template = source(path);
    assert.match(template, /name="system\.saving\.acquisition" value="permanent"/, `${path}: 상비 선택 누락`);
    assert.match(template, /name="system\.saving\.acquisition" value="purchase"/, `${path}: 구매 선택 누락`);
    assert.match(template, /name="system\.saving\.acquisition" value="other"/, `${path}: 기타 선택 누락`);
    assert.match(template, /class="bio-heading"/, `${path}: 해설 제목 중앙 기준점 누락`);
    assert.match(template, /class="dx3rd-check-visual"/, `${path}: DX3rd 체크 비주얼 누락`);
  }

  const sheetCss = source('styles/appv2-sheets.css').replace(/\s+/g, ' ');
  assert.ok(sheetCss.includes('.cell--bio > .bio-title-v2 { justify-content: center;'),
    '우측 획득 방식 컨트롤 때문에 해설 제목의 시각 중심이 흔들리면 안 된다');

  const sync = source('scripts/compendium-sync.js');
  assert.match(sync, /'system\.saving\.acquisition'/,
    '컴펜디움 동기화가 액터 소유본의 획득 방식을 덮어쓰면 안 된다');

  const main = source('scripts/main.js').replace(/\s+/g, ' ');
  assert.ok(main.includes("changedKeys.some(key => key.startsWith('system.saving.'))"));
  assert.ok(main.includes("key === 'system.equipment' || key === 'system.active.state'"));
  assert.ok(main.includes('_dx3rdRerenderSheet(actor.sheet)'),
    '아이템 시트에서 획득 방식이나 장착 상태를 바꿨을 때 열린 액터 시트도 갱신돼야 한다');
});

test('equipment toggles commit derived state before rerendering the actor sheet', () => {
  const data = source('scripts/sheets/actor-sheet-data.js').replace(/\s+/g, ' ');
  assert.ok(data.includes('const update = { "system.equipment": equipped };'));
  assert.ok(data.includes('update["system.active.state"] = true;'),
    '장착 보정 활성화를 별도 비동기 훅 업데이트에만 맡기면 첫 렌더가 이전 수치를 본다');
  assert.ok(data.includes('update["system.active.state"] = false;'),
    '장착 해제와 보정 해제도 같은 업데이트로 확정해야 한다');

  const sheet = source('scripts/sheets/actor-sheet-v2.js').replace(/\s+/g, ' ');
  const start = sheet.indexOf('async _onEquipmentChange(event)');
  const end = sheet.indexOf('async _onSyndromeChange(event)', start);
  const handler = sheet.slice(start, end);
  assert.ok(handler.includes('event.stopImmediatePropagation()'),
    'submitOnChange와 장비 전용 저장이 경합하면 체크 상태가 되돌아갈 수 있다');
  assert.ok(handler.includes('await compat.requestRender(this)'),
    '아이템 갱신 뒤 AppV2 액터 시트를 다시 그려야 파생 수치가 즉시 보인다');

  const actor = source('scripts/document/actor.js').replace(/\s+/g, ' ');
  assert.ok(actor.includes("const equippedWeapons = itemsOfType('weapon').filter(i => i.system?.equipment === true);"));
  // base 는 무기를 가리지 않는 전체 버킷(`_`)만 받는다. 종류 한정분은 방어 창이 실제로
  // 고른 무기에 대해서만 더한다 — `a weapon-limited guard bonus …` 테스트 참조.
  assert.ok(actor.includes('attrs.guard.base = Math.max(grd._, attrs.guard.min || 0, 0);'));
  assert.ok(actor.includes('attrs.guard.value = Math.max(attrs.guard.base + equipmentGuardBonus'),
    '시트 가드치는 장착 무기의 고정 가드치를 포함해야 한다');
  const damage = source('scripts/handlers/universal-damage-dialog.js').replace(/\s+/g, ' ');
  assert.ok(damage.includes('const guard = targetActor.system.attributes.guard?.base'),
    '방어 다이얼로그가 표시용 장착 가드를 다시 더해 이중 적용하면 안 된다');
  assert.ok(data.includes('actor.reset?.()'),
    '장비 문서 갱신 직후 파생 데이터를 무효화해야 장갑치도 이전 캐시에 머물지 않는다');
});

test('effect level includes active effect_level bonuses and ignores disabled effects', () => {
  const context = baseContext();
  context.DX3rdAppliedEffects = {
    collect: () => ({
      active: {
        attributes: {
          a: { key: 'effect_level', label: 'effect_level', value: '+2' },
          b: { key: 'dice', label: 'dice', value: '+99' }
        }
      },
      disabled: {
        _disabled: true,
        attributes: {
          a: { key: 'effect_level', label: 'effect_level', value: '+5' }
        }
      }
    })
  };
  load(context, 'scripts/effect-level.js');
  const result = JSON.parse(vm.runInContext(`JSON.stringify({
    normal: DX3rdEffectLevel.value(
      {type:'effect', system:{level:{init:3, upgrade:false}}},
      {system:{attributes:{encroachment:{level:1}}}}
    ),
    upgraded: DX3rdEffectLevel.value(
      {type:'effect', system:{level:{init:3, upgrade:true}}},
      {system:{attributes:{encroachment:{level:1}}}, _dx3rdUsageEncLevel:2}
    ),
    bonus: DX3rdEffectLevel.bonus({system:{attributes:{}}})
  })`, context));
  assert.deepEqual(result, { normal: 5, upgraded: 7, bonus: 2 });
});

test('a preparation item freezes onto one attack card and reaches only actors that were hit', async () => {
  const flags = new Map();
  const sourceItem = {
    id: 'ammo1', name: '항 레니게이드 탄', type: 'once',
    system: {
      attackRoll: '-',
      active: {state: false, disable: '-', runTiming: 'instant', action: ''},
      effect: {
        disable: 'round', runTiming: 'afterHit',
        attributes: {penalty: {key: 'dice', label: '-', value: '[level]'}}
      }
    },
    getFlag: () => ({})
  };
  const actor = {
    id: 'attacker', name: '공격자', type: 'character',
    items: new Map([[sourceItem.id, sourceItem]]),
    getFlag: (_scope, key) => flags.get(key),
    setFlag: async (_scope, key, value) => { flags.set(key, structuredClone(value)); },
    unsetFlag: async (_scope, key) => { flags.delete(key); }
  };
  const target = {id: 'target', name: '대상'};
  const tokens = new Map([['token1', {id: 'token1', actor: target}]]);
  const context = baseContext({
    game: {
      actors: new Map([[actor.id, actor], [target.id, target]]),
      user: {isGM: true, targets: new Set()}, macros: {getName: () => null},
      scenes: {active: null}, settings: {get: () => false},
      i18n: {localize: key => key, format: key => key}
    },
    canvas: {tokens: {get: id => tokens.get(id), placeables: [], controlled: []}},
    ui: {notifications: {warn: () => {}, error: () => {}, info: () => {}}, windows: {}},
    Hooks: {once: () => {}, on: () => {}, callAll: () => {}},
    CONFIG: {statusEffects: []},
    foundry: {utils: {
      deepClone: value => structuredClone(value),
      getProperty: () => undefined
    }}
  });
  context.DX3rdFormulaEvaluator = {
    prepareRollFormula: () => '7', evaluate: () => 7,
    isRollTimeKey: () => false, hasDice: () => false
  };
  load(context, 'scripts/item-effect-adapter.js');
  load(context, 'scripts/handlers/universal-handler.js');
  load(context, 'scripts/handlers/universal-apply.js');

  const handler = context.DX3rdUniversalHandler;
  assert.equal(await handler.armPendingAttackRider(actor, sourceItem, 'use'), true);
  assert.equal(flags.get('pendingAttackRiders')[0].hitAttributes.penalty.value, 7,
    '다음 클라이언트가 복원할 수 없는 사용 시점 수식은 대기 전에 동결해야 한다');

  const messageFlags = new Map();
  const attackMessage = {
    getFlag: (_scope, key) => messageFlags.get(key),
    setFlag: async (_scope, key, value) => { messageFlags.set(key, structuredClone(value)); }
  };
  const bound = await handler.bindPendingAttackRiders(actor, attackMessage);
  assert.equal(bound.length, 1);
  assert.equal(flags.has('pendingAttackRiders'), false, '한 공격에 귀속된 대기 효과가 다음 공격에도 남으면 안 된다');

  const applied = [];
  handler.dispatchItemAttributes = async (_source, item, appliedActor, attrs, options) => {
    applied.push({item: item.id, actor: appliedActor.id, value: attrs.penalty.value, options});
  };
  await handler.processPendingAttackRiders(actor, bound, [target.id], ['token1']);
  assert.deepEqual(plain(applied), [{
    item: sourceItem.id, actor: target.id, value: 7, options: {preEvaluated: true}
  }]);
});

test('a preparation rider with an afterDamage bucket reaches only actors that lost HP', async () => {
  const flags = new Map();
  const sourceItem = {
    id: 'snare1', name: '중력의 족쇄', type: 'effect',
    system: {
      attackRoll: '-',
      active: {state: false, disable: '-', runTiming: 'instant', action: ''},
      effect: {
        disable: 'round', runTiming: 'afterDamage',
        attributes: {penalty: {key: 'battleMove', label: 'battleMove', value: '[level]'}}
      }
    },
    getFlag: () => ({})
  };
  const actor = {
    id: 'attacker', name: '공격자', type: 'character',
    items: new Map([[sourceItem.id, sourceItem]]),
    getFlag: (_scope, key) => flags.get(key),
    setFlag: async (_scope, key, value) => { flags.set(key, structuredClone(value)); },
    unsetFlag: async (_scope, key) => { flags.delete(key); }
  };
  const hitOnly = {id: 'hit-only', name: '0데미지 명중 대상'};
  const damaged = {id: 'damaged', name: '피해 대상'};
  const context = baseContext({
    game: {
      actors: new Map([[actor.id, actor], [hitOnly.id, hitOnly], [damaged.id, damaged]]),
      user: {isGM: true, targets: new Set()}, macros: {getName: () => null},
      scenes: {active: null}, settings: {get: () => false},
      i18n: {localize: key => key, format: key => key}
    },
    canvas: {tokens: {get: () => null, placeables: [], controlled: []}},
    ui: {notifications: {warn: () => {}, error: () => {}, info: () => {}}, windows: {}},
    Hooks: {once: () => {}, on: () => {}, callAll: () => {}},
    CONFIG: {statusEffects: []},
    foundry: {utils: {
      deepClone: value => structuredClone(value),
      getProperty: () => undefined
    }}
  });
  context.DX3rdFormulaEvaluator = {
    prepareRollFormula: () => '9', evaluate: () => 9,
    isRollTimeKey: () => false, hasDice: () => false
  };
  load(context, 'scripts/item-effect-adapter.js');
  load(context, 'scripts/handlers/universal-handler.js');
  load(context, 'scripts/handlers/universal-apply.js');

  const handler = context.DX3rdUniversalHandler;
  assert.equal(await handler.armPendingAttackRider(actor, sourceItem, 'use'), true);
  const rider = flags.get('pendingAttackRiders')[0];
  assert.equal(rider.targetAttributes.penalty.value, 9,
    'afterDamage 버킷은 targetAttributes로 동결된다');
  assert.equal(handler.hasUsableAttribute(rider.hitAttributes), false,
    'afterHit 버킷이 없으면 hitAttributes는 비어 있어야 한다');

  const applied = [];
  handler.dispatchItemAttributes = async (_source, item, appliedActor, attrs, options) => {
    applied.push({item: item.id, actor: appliedActor.id, options});
  };
  // 명중만 했을 뿐 HP가 줄지 않은 대상에게는 발동하지 않는다.
  await handler.processPendingAttackRiders(actor, [rider], [hitOnly.id], []);
  assert.deepEqual(applied, [], 'afterDamage 라이더는 명중 경로에서 적용되면 안 된다');
  // HP를 실제로 잃은 대상에게만 적용된다.
  await handler.processDamagedAttackRiders(actor, [rider], [damaged]);
  assert.deepEqual(plain(applied), [{
    item: sourceItem.id, actor: damaged.id, options: {preEvaluated: true}
  }]);
});

test('a preparation item with afterDamage extensions arms a rider even without a target bucket', async () => {
  const flags = new Map();
  // 맹독 물방울 형태: 수정치 채널이 비어 있고 payload 전체가 afterDamage 조건 익스텐션
  const sourceItem = {
    id: 'venom1', name: '맹독 물방울', type: 'effect',
    system: {
      attackRoll: '-',
      active: {state: false, disable: '-', runTiming: 'instant', action: ''},
      effect: {disable: 'notCheck', runTiming: 'instant', attributes: {}}
    },
    getFlag: (_scope, key) => key === 'itemExtend' ? {
      condition: {conditions: [
        {timing: 'afterDamage', target: 'targetToken', type: 'poisoned', poisonedRank: '[level]', activate: true},
        {timing: 'instant', target: 'self', type: 'fear', activate: true}   // 다른 타이밍은 싣지 않는다
      ]}
    } : undefined
  };
  const actor = {
    id: 'attacker', name: '공격자', type: 'character',
    items: new Map([[sourceItem.id, sourceItem]]),
    getFlag: (_scope, key) => flags.get(key),
    setFlag: async (_scope, key, value) => { flags.set(key, structuredClone(value)); },
    unsetFlag: async (_scope, key) => { flags.delete(key); }
  };
  const context = baseContext({
    game: {
      actors: new Map([[actor.id, actor]]),
      user: {isGM: true, targets: new Set()}, macros: {getName: () => null},
      scenes: {active: null}, settings: {get: () => false},
      i18n: {localize: key => key, format: key => key}
    },
    canvas: {tokens: {get: () => null, placeables: [], controlled: []}},
    ui: {notifications: {warn: () => {}, error: () => {}, info: () => {}}, windows: {}},
    Hooks: {once: () => {}, on: () => {}, callAll: () => {}},
    CONFIG: {statusEffects: []},
    foundry: {utils: {
      deepClone: value => structuredClone(value),
      getProperty: () => undefined
    }}
  });
  context.DX3rdFormulaEvaluator = {
    prepareRollFormula: () => '0', evaluate: () => 0,
    isRollTimeKey: () => false, hasDice: () => false
  };
  load(context, 'scripts/item-effect-adapter.js');
  load(context, 'scripts/handlers/universal-handler.js');
  load(context, 'scripts/handlers/universal-apply.js');

  const handler = context.DX3rdUniversalHandler;
  assert.equal(await handler.armPendingAttackRider(actor, sourceItem, 'use'), true,
    '익스텐션만 있는 준비 아이템도 라이더를 장전해야 한다');
  const rider = flags.get('pendingAttackRiders')[0];
  assert.equal(rider.extensions.length, 1);
  assert.equal(rider.extensions[0].type, 'condition');
  assert.equal(rider.extensions[0].data.type, 'poisoned');

  // 버킷이 없는 라이더는 명중 경로에서 빈 AE를 쓰지 않는다
  const applied = [];
  handler.dispatchItemAttributes = async () => applied.push(1);
  await handler.processPendingAttackRiders(actor, [rider], ['target'], ['token1']);
  assert.equal(applied.length, 0, '익스텐션 전용 라이더는 명중 적용 경로에서 아무것도 쓰면 안 된다');
});

test('accepted after-damage work is never rejected by the already-spent usage counter', () => {
  const damage = source('scripts/handlers/universal-damage-dialog.js').replace(/\s+/g, ' ');
  const main = source('scripts/main.js').replace(/\s+/g, ' ');
  assert.ok(damage.includes(
    'shouldExecuteMacro || pendingAttackRiders.length > 0) { const needsDialog'),
    '매크로 유무와 무관하게 선행 효과를 같은 damageRequestId 큐에 등록해야 한다');
  assert.doesNotMatch(damage, /const shouldRegister = shouldExecuteMacro/,
    '매크로가 횟수 게이트의 숨은 우회 조건이면 안 된다');
  assert.doesNotMatch(damage, /isUsageExhausted/,
    '승인·소비가 끝난 행동의 후속 단계에서 현재 횟수를 다시 검사하면 max 1 효과가 죽는다');
  assert.doesNotMatch(main, /isUsageExhausted/,
    '원격 GM 보고 경로도 같은 승인 계약을 따라야 한다');
  assert.doesNotMatch(damage, /Used count increased on afterDamage/,
    '후속 확인 버튼에서 횟수를 두 번째로 소비하면 안 된다');
  assert.match(damage, /attackHit:\s*!reactionSuccess/,
    '방어창은 HP 변화와 별도로 명중 여부를 보고해야 한다');
  assert.ok(damage.includes('Object.entries(activationRequest.hitReports || {})')
    && damage.includes('activationRequest.pendingAttackRiders, hitTargets, hitTokenIds'),
  '로컬 명중 라이더는 HP 피해 목록이 아니라 명중 목록을 사용해야 한다');
  assert.ok(main.includes('Object.entries(request.hitReports || {})')
    && main.includes('request.pendingAttackRiders, hitTargets, hitTokenIds'),
  '원격 GM 경로도 같은 명중 목록을 사용해야 한다');

  const roll = source('scripts/handlers/universal-roll-dialog.js');
  const combo = source('scripts/handlers/combo-handler.js');
  assert.match(roll,
    /onAttackRollComplete\(actor, item, targets, rollResult, isFumble, attackMessage\);[\s\S]{0,120}maybeAutoRollDamage/,
    '일반 무기 공격은 선행 효과를 카드에 귀속한 뒤 자동 데미지를 시작해야 한다');
  assert.match(combo,
    /onAttackRollComplete\([\s\S]{0,180}attackMessage\);[\s\S]{0,120}maybeAutoRollDamage/,
    '고정 달성치 공격도 같은 순서를 따라야 한다');
});

function socketContext() {
  let ready;
  let listener;
  const gm1 = { id: 'gm1', isGM: true, active: true };
  const gm2 = { id: 'gm2', isGM: true, active: true };
  const player1 = { id: 'p1', isGM: false, active: true };
  const player2 = { id: 'p2', isGM: false, active: true };
  const userList = [gm1, gm2, player1, player2];
  userList.activeGM = gm1;
  userList.get = id => userList.find(user => user.id === id) || null;
  const actor = {
    id: 'a1',
    testUserPermission: user => user.id === player1.id || user.isGM
  };
  const context = baseContext({
    Hooks: { once: (name, callback) => { if (name === 'ready') ready = callback; } },
    canvas: { tokens: { placeables: [] } },
    game: {
      user: gm1,
      users: userList,
      actors: new Map([[actor.id, actor]]),
      socket: {
        on: (_channel, callback) => { listener = callback; },
        emit: () => {}
      }
    }
  });
  return { context, users: { gm1, gm2, player1, player2 }, actor, ready: () => ready(), listener: data => listener(data) };
}

test('runtime utils create versioned socket envelopes and escape HTML', () => {
  const context = baseContext();
  load(context, 'scripts/core/runtime-utils.js');
  const result = JSON.parse(vm.runInContext(`JSON.stringify({
    envelope: DX3rdRuntimeUtils.createSocketEnvelope({type: 'damageRequest', payload: {value: 3}}, {senderId: 'u1'}),
    escaped: DX3rdRuntimeUtils.escapeHTML('<b title="x">&</b>')
  })`, context));
  assert.equal(result.envelope.type, 'damageRequest');
  assert.equal(result.envelope.protocolVersion, 1);
  assert.equal(result.envelope.senderId, 'u1');
  assert.match(result.envelope.requestId, /^damageRequest:/);
  assert.equal(result.escaped, '&lt;b title=&quot;x&quot;&gt;&amp;&lt;/b&gt;');
});

test('after-damage targeting preserves self and targetAll while narrowing selected targets', () => {
  const context = baseContext();
  load(context, 'scripts/core/runtime-utils.js');
  const resolve = context.DX3rdRuntimeUtils.resolveAfterDamageTarget;

  assert.deepEqual(plain(resolve('self', ['t1'])),
    {target: 'self', selectedTargetIds: [], targetsFrozen: true});
  assert.deepEqual(plain(resolve('targetToken', ['t1', 't1', 't2'])),
    {target: 'targetToken', selectedTargetIds: ['t1', 't2'], targetsFrozen: true});
  assert.deepEqual(plain(resolve('targetAll', ['t1'])),
    {target: 'targetAll', selectedTargetIds: ['t1'], targetsFrozen: true},
    'targetAll을 targetToken으로 바꾸면 시전자가 대상에서 사라진다');
  assert.deepEqual(plain(resolve('targetAll', [])),
    {target: 'self', selectedTargetIds: [], targetsFrozen: true},
    '피해 대상이 없을 때 빈 배열이 GM의 현재 선택 대상으로 다시 해석되면 안 된다');
  assert.deepEqual(plain(resolve('damagedTargets', ['t2'])),
    {target: 'targetToken', selectedTargetIds: ['t2'], targetsFrozen: true});
});

test('after-damage completion counts tokens even when they share one actor', () => {
  const context = baseContext();
  load(context, 'scripts/core/runtime-utils.js');
  const request = {
    targetActorIds: ['same-actor', 'same-actor'],
    targetTokenIds: ['token-1', 'token-2'],
    damageReports: {},
    hitReports: {},
    reportActorIds: {}
  };
  const first = context.DX3rdRuntimeUtils.recordAfterDamageReport(request, {
    targetTokenId: 'token-1', targetActorId: 'same-actor', hpChange: 0, attackHit: true
  });
  const second = context.DX3rdRuntimeUtils.recordAfterDamageReport(request, {
    targetTokenId: 'token-2', targetActorId: 'same-actor', hpChange: 0, attackHit: false
  });
  assert.equal(first.complete, false);
  assert.equal(second.complete, true);
  assert.equal(second.reportCount, 2);
  assert.deepEqual(plain(request.hitReports), {'token-1': true, 'token-2': false},
    '명중 여부는 HP 감소 여부와 독립적으로 보존되어야 한다');
});

test('legacy after-damage reports infer hits only from actual HP loss', () => {
  const context = baseContext();
  load(context, 'scripts/core/runtime-utils.js');
  const request = {
    targetActorIds: ['actor-1', 'actor-2'],
    targetTokenIds: ['token-1', 'token-2']
  };
  context.DX3rdRuntimeUtils.recordAfterDamageReport(request, {
    targetTokenId: 'token-1', targetActorId: 'actor-1', hpChange: 0
  });
  context.DX3rdRuntimeUtils.recordAfterDamageReport(request, {
    targetTokenId: 'token-2', targetActorId: 'actor-2', hpChange: 2
  });
  assert.deepEqual(plain(request.hitReports), {'token-1': false, 'token-2': true});
});

test('an empty frozen after-damage target never falls back to the current UI targets', async () => {
  let wrongTargetUpdated = false;
  const wrongTarget = {id: 'wrong', update: async () => { wrongTargetUpdated = true; }};
  const actor = {id: 'caster', name: 'caster'};
  const context = baseContext({
    DX3rdUniversalHandler: {},
    game: {user: {targets: new Set([{id: 'wrong-token', actor: wrongTarget}])}},
    canvas: {tokens: {get: () => null}},
    ui: {notifications: {warn: () => {}, error: () => {}}}
  });
  load(context, 'scripts/handlers/universal-healing.js');
  await context.DX3rdUniversalHandler.executeHealExtensionNow(actor, {
    formulaDice: 0,
    formulaAdd: 1,
    target: 'targetToken',
    selectedTargetIds: [],
    targetsFrozen: true
  });
  assert.equal(wrongTargetUpdated, false);
});

test('a self after-damage extension does not wake target-only siblings when nobody was damaged', async () => {
  const calls = [];
  const actor = {id: 'caster', name: 'caster', items: new Map()};
  const handler = {
    executeHealExtensionNow: async () => calls.push('heal'),
    executeDamageExtensionNow: async () => calls.push('damage'),
    executeStatusClearExtension: async () => calls.push('clear'),
    executeConditionExtensionNow: async () => calls.push('condition'),
    executeItemExtension: async () => calls.push('item'),
    addToAfterMainQueue: async () => calls.push('afterMain')
  };
  const context = baseContext({
    DX3rdUniversalHandler: handler,
    game: {actors: new Map([[actor.id, actor]])},
    canvas: {tokens: {placeables: []}}
  });
  load(context, 'scripts/core/runtime-utils.js');
  load(context, 'scripts/handlers/universal-damage-dialog.js');
  await handler.processAfterDamageExtensionRequest({
    attackerId: actor.id,
    itemId: 'item',
    targetActorIds: ['victim'],
    targetTokenIds: ['token'],
    damageReports: {token: 0},
    reportActorIds: {token: 'victim'},
    extensions: {
      heal: {target: 'self', timing: 'afterDamage'},
      condition: [{target: 'targetToken', timing: 'afterDamage', type: 'fear'}]
    }
  });
  assert.deepEqual(calls, ['heal']);
});

test('rider extensions armed by a preparation item execute on the damaged target with their source item', async () => {
  const calls = [];
  const riderItem = {id: 'venom1', name: '맹독 물방울', type: 'effect', system: {}};
  const actor = {id: 'attacker', name: '공격자', items: new Map([[riderItem.id, riderItem], ['sword', {id: 'sword', name: '검'}]])};
  const handler = {
    executeHealExtensionNow: async () => calls.push('heal'),
    executeDamageExtensionNow: async () => calls.push('damage'),
    executeStatusClearExtension: async () => calls.push('clear'),
    executeConditionExtensionNow: async (_actor, data, item) =>
      calls.push({data, item: item?.id}),
    executeItemExtension: async () => calls.push('item'),
    addToAfterMainQueue: async () => calls.push('afterMain')
  };
  const context = baseContext({
    DX3rdUniversalHandler: handler,
    game: {actors: new Map([[actor.id, actor]])},
    canvas: {tokens: {placeables: []}}
  });
  load(context, 'scripts/core/runtime-utils.js');
  load(context, 'scripts/handlers/universal-damage-dialog.js');

  // 데미지를 입은 공격 — 라이더 익스텐션이 피해 토큰 상관관계로 실행되어야 한다
  await handler.processAfterDamageExtensionRequest({
    attackerId: actor.id,
    itemId: 'sword',
    targetActorIds: ['victim'],
    targetTokenIds: ['token1'],
    damageReports: {token1: {targetTokenId: 'token1', actorId: 'victim', hpChange: 5, attackHit: true}},
    extensions: {
      riderExtensions: [{
        itemId: 'venom1', itemName: '맹독 물방울', type: 'condition',
        data: {timing: 'afterDamage', target: 'targetToken', type: 'poisoned', poisonedRank: '[level]', activate: true}
      }]
    }
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].item, 'venom1', '라이더 익스텐션은 공격 아이템이 아니라 원본 아이템 컨텍스트로 실행되어야 한다');
  assert.equal(calls[0].data.target, 'targetToken');
  assert.deepEqual(plain(calls[0].data.selectedTargetIds), ['token1']);
  assert.equal(calls[0].data.triggerItemName, '맹독 물방울');
  assert.equal(calls[0].data.triggerItemId, 'venom1');

  // 피해가 없으면 targetToken 라이더 익스텐션은 실행되지 않는다
  calls.length = 0;
  await handler.processAfterDamageExtensionRequest({
    attackerId: actor.id,
    itemId: 'sword',
    targetActorIds: ['victim'],
    targetTokenIds: ['token1'],
    damageReports: {token1: {targetTokenId: 'token1', actorId: 'victim', hpChange: 0, attackHit: true}},
    extensions: {
      riderExtensions: [{
        itemId: 'venom1', itemName: '맹독 물방울', type: 'condition',
        data: {timing: 'afterDamage', target: 'targetToken', type: 'poisoned', activate: true}
      }]
    }
  });
  assert.equal(calls.length, 0, 'HP 피해가 없으면 실행되지 않아야 한다');
});

test('cancelled and expired after-damage requests release both queues', () => {
  let expiryCallback = null;
  const context = baseContext({
    DX3rdUniversalHandler: {},
    setTimeout: callback => { expiryCallback = callback; return 7; },
    clearTimeout: () => {}
  });
  load(context, 'scripts/handlers/universal-damage-dialog.js');
  context.DX3rdAfterDamageExtensionQueue = {q1: {}, q2: {}};
  context.DX3rdAfterDamageActivationQueue = {q1: {}, q2: {}};
  context.DX3rdTargetApplyQueue = {};
  context.DX3rdUniversalHandler.discardAfterDamageRequest('q1');
  assert.equal(context.DX3rdAfterDamageExtensionQueue.q1, undefined);
  assert.equal(context.DX3rdAfterDamageActivationQueue.q1, undefined);

  context.DX3rdUniversalHandler.scheduleAfterDamageRequestExpiry('q2');
  assert.equal(typeof expiryCallback, 'function');
  expiryCallback();
  assert.equal(context.DX3rdAfterDamageExtensionQueue.q2, undefined);
  assert.equal(context.DX3rdAfterDamageActivationQueue.q2, undefined);
});

test('HP transitions are classified at zero and below, on the initiating client only', () => {
  const context = baseContext({
    game: { user: { id: 'u1' } },
    ChatMessage: { getSpeaker: () => ({}) }
  });
  load(context, 'scripts/core/runtime-utils.js');
  const classify = context.DX3rdRuntimeUtils.classifyHpTransition;

  assert.equal(classify(5, 0), 'defeated');
  assert.equal(classify(5, -3), 'defeated', 'HP costs may legitimately cross below zero');
  assert.equal(classify(0, 4), 'revived');
  assert.equal(classify(-3, 4), 'revived');
  assert.equal(classify(-3, 0), null);
  assert.equal(classify(4, 3), null);

  const conditions = source('scripts/condtions.js');
  const hpHooks = conditions.slice(conditions.indexOf('const _previousHpValues'),
    conditions.indexOf('window.addDeathMarkToToken = addDeathMarkToToken'));
  assert.match(hpHooks, /preUpdateActor[\s\S]*?userId !== game\.user\.id/);
  assert.match(hpHooks, /updateActor[\s\S]*?userId !== game\.user\.id/);
  assert.match(hpHooks, /classifyHpTransition\?\.\(oldHp, newHp\)/);
  assert.doesNotMatch(hpHooks, /if \(!game\.user\.isGM\) return/,
    'player-originated HP updates must not depend on a cache that exists only on the player');
});

test('extension grouping preserves condition source lifetimes', () => {
  const context = baseContext();
  load(context, 'scripts/core/runtime-utils.js');
  const grouped = JSON.parse(vm.runInContext(`JSON.stringify(DX3rdRuntimeUtils.groupExtensionsByKey([
    {type:'heal', timing:'instant', target:'self', itemId:'a', formulaAdd:2},
    {type:'heal', timing:'instant', target:'self', itemId:'b', formulaAdd:3},
    {type:'condition', timing:'instant', target:'targetToken', itemId:'a', disable:'round', conditionType:'fear'},
    {type:'condition', timing:'instant', target:'targetToken', itemId:'b', disable:'turn', conditionType:'fear'}
  ]))`, context));
  assert.equal(grouped.length, 3);
  assert.equal(grouped.find(bucket => bucket.type === 'heal').sources.length, 2);
  assert.deepEqual(grouped.filter(bucket => bucket.type === 'condition').map(bucket => bucket.duration).sort(), ['round', 'turn']);
});

test('conditional combo damage executes once per bucket at every runtime stage', async () => {
  let authoredTiming = 'instant';
  const combo = {
    id: 'c1', name: '조건부 콤보', type: 'combo',
    system: { effectIds: [], weapon: [], attackRoll: '-', active: {} },
    getFlag: () => ({
      damage: { activate: true, timing: authoredTiming, target: 'self', conditionalFormula: true, ignoreReduce: true }
    })
  };
  const actor = {
    id: 'a1', name: '사용자', type: 'character', system: {}, effects: [],
    items: new Map([[combo.id, combo]]),
    updateEmbeddedDocuments: async () => {}
  };
  actor.items[Symbol.iterator] = function* () { yield* this.values(); };
  const context = baseContext({
    game: {
      actors: new Map([[actor.id, actor]]),
      user: { targets: new Set() },
      settings: { get: () => '' },
      i18n: { localize: key => key }
    },
    canvas: { tokens: { placeables: [] } },
    ui: { notifications: { warn: () => {}, error: () => {}, info: () => {} } },
    Hooks: { on: () => {}, once: () => {} },
    CONFIG: { statusEffects: [] },
    foundry: { utils: { deepClone: value => structuredClone(value) } }
  });
  load(context, 'scripts/core/runtime-utils.js');
  load(context, 'scripts/handlers/universal-handler.js');
  load(context, 'scripts/handlers/universal-extensions.js');
  load(context, 'scripts/handlers/combo-handler.js');

  const handler = context.DX3rdUniversalHandler;
  const grouped = handler.groupExtensionsByKey([{
    type: 'damage', timing: 'afterSuccess', target: 'self', parentRunTiming: 'instant',
    itemId: combo.id, itemName: combo.name, actorId: actor.id,
    conditionalFormula: true, ignoreReduce: true
  }]);
  const [bucket] = handler.mergeGroupedExtensionBuckets(actor, grouped);
  bucket.selectedTargetIds = ['t1'];
  assert.equal(bucket.custom, true);
  assert.equal(bucket.merged, null);
  assert.equal(handler.damageDataFromExtensionBucket(bucket).sourceItemId, combo.id);

  const executed = [];
  const queued = [];
  handler.executeDamageExtensionNow = async (_actor, data) => { executed.push(data); };
  handler.addToAfterMainQueue = async (_actor, data, _item, type) => { queued.push([type, data]); };

  // Immediate combo use goes through ComboHandler; serialized follow-ups go through UniversalHandler.
  await context.DX3rdComboHandler.processInstantExtensions(actor, combo, 'attack');
  authoredTiming = 'afterMain';
  await context.DX3rdComboHandler.processInstantExtensions(actor, combo, 'attack');
  await handler.processComboAfterSuccess({ actorId: actor.id, comboItemId: combo.id, extensions: [bucket] });
  await handler.processComboAfterDamage({ actorId: actor.id, comboItemId: combo.id, extensions: [bucket] });
  await handler.processComboAfterSuccess({ actorId: actor.id, comboItemId: combo.id, afterMainExtensions: [bucket] });

  assert.equal(executed.length, 3, 'instant, afterSuccess, and afterDamage each execute one bucket');
  for (const data of executed) {
    assert.equal(data.conditionalFormula, true);
    assert.equal(data.ignoreReduce, true);
  }
  assert.equal(queued.length, 2, 'afterMain queues from both instant and serialized follow-up stages');
  for (const [type, data] of queued) {
    assert.equal(type, 'damage');
    assert.equal(data.conditionalFormula, true, 'afterMain must prompt when the queue entry executes');
  }

  const comboSource = source('scripts/handlers/combo-handler.js');
  const universalSource = source('scripts/handlers/universal-handler.js');
  assert.doesNotMatch(comboSource, /Skipping custom bucket/);
  assert.doesNotMatch(universalSource, /bucket\.type === 'damage' && !bucket\.custom/);
});

test('temporary combos process after-damage members before requiring an embedded combo item', () => {
  const damageHandler = source('scripts/handlers/universal-damage-dialog.js').replace(/\s+/g, ' ');
  const comboProcess = damageHandler.indexOf('await window.DX3rdUniversalHandler.processComboAfterDamage(comboData, damagedActors, damagedTokenIds)');
  const itemLookup = damageHandler.indexOf('const attackerItem = attacker.items.get(itemId)', comboProcess);
  assert.ok(comboProcess >= 0 && itemLookup > comboProcess,
    '임시 콤보는 액터 아이템 조회보다 먼저 멤버의 afterDamage 데이터를 처리해야 한다');
  assert.ok(damageHandler.includes('if (!attackerItem && needsAttackerItem)'),
    '원본 아이템이 꼭 필요한 저장 아이템 후속 작업만 누락 문서로 중단해야 한다');
  assert.ok(damageHandler.includes('Temporary combo afterDamage request removed from queue'),
    '임시 콤보 완료 후 큐를 정리하지 않으면 같은 ID의 다음 요청이 막힌다');
});

test('temporary and saved combos keep member target requirements before paying costs', () => {
  const { adapter } = equipmentHookContext();
  const member = {
    type: 'effect',
    system: {
      attackRoll: 'melee',
      getTarget: false,
      attributes: {},
      effect: {attributes: {}},
      active: {state: false, disable: 'notCheck', runTiming: 'instant', applyMode: 'onUse'}
    },
    getFlag: () => ({
      cards: [{
        id: 'poison',
        type: 'condition',
        data: {activate: true, action: 'use', timing: 'afterDamage', target: 'targetToken', type: 'poisoned'}
      }]
    })
  };
  // 장비가 아닌 것은 공격하는 것이 곧 사용이라(actionCoversBucket), 공격으로 발현해도
  // 사용 카드가 함께 걸린다 — 그러면 그 카드가 요구하는 대상도 함께 필요하다.
  assert.equal(adapter.requiresTarget(member, 'attack'), true,
    '이펙트의 공격 발현은 사용 카드를 함께 태우므로 그 대상 요구도 보여야 한다');
  assert.equal(adapter.requiresTarget(member, 'use'), true,
    '콤보 사전 검사는 멤버의 사용 카드에 필요한 대상을 찾아야 한다');
  // 그래도 활성화는 절대 상속되지 않는다 — 활성화 전용 카드는 대상을 요구하지 않는다.
  const activationMember = {
    ...member,
    getFlag: () => ({
      cards: [{
        id: 'poison',
        type: 'condition',
        data: {activate: true, action: 'activation', timing: 'afterDamage', target: 'targetToken', type: 'poisoned'}
      }]
    })
  };
  assert.equal(adapter.requiresTarget(activationMember, 'attack'), false,
    '활성화 전용 카드는 어떤 발현 액션에서도 대상을 요구하지 않는다');
  // 장비는 예외다 — 사용/공격 선택창이 실제로 있어 두 발현점이 갈린다.
  const gearMember = {...member, type: 'weapon', system: {...member.system, equipment: true}};
  assert.equal(adapter.requiresTarget(gearMember, 'attack'), false,
    '장비의 공격은 그 장비의 사용 카드를 태우지 않는다');

  const handler = source('scripts/handlers/universal-handler.js').replace(/\s+/g, ' ');
  assert.ok(handler.includes("window.DX3rdComboHandler?.comboMemberEntries?.(actor, item)"),
    '콤보는 일반 구성 아이템뿐 아니라 무기 슬롯도 검사해야 한다');
  assert.ok(handler.includes("window.DX3rdItemEffectAdapter?.requiresTarget?.(memberItem, memberAction)"),
    '활성화 전용 카드가 아니라 구성 멤버의 역할 액션 카드만 대상 요구를 만들어야 한다');
  assert.ok(handler.includes("!!window.DX3rdItemEffectAdapter?.requiresTarget?.(item, action) || comboMemberRequiresTarget"),
    '대상 요구는 어댑터의 내용 판정과 멤버 검사로만 이뤄져야 한다');
  assert.ok(!handler.includes("!!item.system?.getTarget || !!window.DX3rdItemEffectAdapter"),
    'getTarget 플래그만으로 대상 선택을 강제하면 내용 없는 아이템의 사용이 죽는다');
});

test('the standalone target gate follows consumable target content, not the checkbox', () => {
  const { adapter } = equipmentHookContext();
  const base = {
    type: 'effect',
    getFlag: () => undefined,
    system: {
      roll: '-', difficulty: '자동성공', skill: '-', timing: 'major',
      active: { state: false, disable: '-', runTiming: 'instant', applyMode: 'onUse' },
      attributes: {}
    }
  };

  // 실측된 형태: getTarget:'on'이 붙은 채 대상 채널이 비어 있는 아이템(거인의 생명·파워 부스터).
  // 선택된 토큰을 소비하는 것이 아무것도 없으므로 사용은 대상 없이 성립해야 한다.
  const deadGate = {...base, system: {...base.system, getTarget: true, target: '단독',
    effect: { disable: 'notCheck', runTiming: 'instant', attributes: {} }}};
  assert.equal(adapter.requiresTarget(deadGate, 'use'), false,
    '대상 채널이 비었으면 getTarget 플래그가 있어도 대상을 요구하지 않는다');

  // 대상=자신인데 getTarget이 잡혀 있는 자기 전용 익스텐션(꼬리를 무는 뱀) — 캔버스 토큰 없이도 쓸 수 있어야 한다.
  const selfExt = {...base, system: {...base.system, getTarget: true, target: '자신',
    effect: { disable: 'notCheck', runTiming: 'instant', attributes: {} }},
    getFlag: () => ({heal: {activate: true, timing: 'instant', target: 'self', formulaAdd: '1d10'}})};
  assert.equal(adapter.requiresTarget(selfExt, 'use'), false,
    '자기 대상 익스텐션만 있으면 대상 선택을 요구하지 않는다');

  // 살아 있는 대상 보정(전술·어드바이스) — 선택 없이 쓰면 적용될 곳이 없으므로 여전히 막힌다.
  const liveTarget = {...base, system: {...base.system, getTarget: true, target: '단독',
    effect: { disable: 'major', runTiming: 'instant',
      attributes: { t1: { key: 'major_dice', value: '+[레벨]' } } }}};
  assert.equal(adapter.requiresTarget(liveTarget, 'use'), true,
    '살아 있는 대상 보정이 있으면 대상 선택을 계속 요구한다');

  // 플래그 없이도 targetToken 익스텐션은 대상을 요구한다(익스텐션 자체가 대상 지정을 저작한다).
  const extDriven = {...base, system: {...base.system, getTarget: false,
    effect: { disable: 'notCheck', runTiming: 'instant', attributes: {} }},
    getFlag: () => ({heal: {activate: true, timing: 'instant', target: 'targetToken', formulaAdd: '1d10'}})};
  assert.equal(adapter.requiresTarget(extDriven, 'use'), true,
    'targetToken 익스텐션은 getTarget 플래그 없이도 대상을 요구한다');

  // 대상 채널이 notCheck면 적용 자체가 안 되므로 게이트도 서지 않는다.
  const notCheck = {...liveTarget, system: {...liveTarget.system,
    effect: {...liveTarget.system.effect, disable: 'notCheck'}}};
  assert.equal(adapter.requiresTarget(notCheck, 'use'), false,
    'notCheck 대상 채널은 적용되지 않으므로 대상을 요구하지 않는다');
});

test('combo follow-up target modifiers use each bucket lifecycle and preserve its action', () => {
  const combo = source('scripts/handlers/combo-handler.js').replace(/\s+/g, ' ');
  assert.ok(combo.includes("window.DX3rdItemEffectAdapter.targetFiresAt(item, action, 'afterSuccess')"));
  assert.ok(combo.includes("window.DX3rdItemEffectAdapter.targetFiresAt(memberItem, memberAction, 'afterSuccess')"));
  assert.ok(combo.includes("window.DX3rdItemEffectAdapter.targetFiresAt(item, 'attack', 'afterDamage')"));
  assert.ok(combo.includes("action: memberAction, ...frozenTargetData(memberItem)"),
    '성공 후 적용을 실행할 때 수집 당시 멤버 액션을 잃으면 다른 버킷이 적용될 수 있다');

  const handler = source('scripts/handlers/universal-handler.js').replace(/\s+/g, ' ');
  assert.ok(handler.includes("for (const { itemId, itemName, action = null, selectedTargetIds = null, frozenAttributes = null } of applies)"));
  assert.ok(handler.includes("await this.applyToTargets(actor, item, 'afterSuccess', forcedTargets, action, { frozenAttributes })"));
  assert.ok(handler.includes("await this.applyToTargets(actor, item, 'afterDamage', damagedActors, action, { frozenAttributes })"));
  assert.ok(!handler.includes("if (item && item.system?.effect?.runTiming === 'afterDamage')"),
    '실행 단계에서 평탄 runTiming을 다시 확인하면 하위 버킷이 또 누락된다');
});

test('combo after-damage self modifiers use the attack bucket lifecycle', async () => {
  const context = baseContext({
    game: {
      user: { targets: new Set() },
      macros: { getName: () => null },
      i18n: { localize: key => key, format: key => key }
    },
    ui: { notifications: { warn: () => {} } },
    CONFIG: { statusEffects: [] },
    Hooks: { once: () => {}, on: () => {} },
    foundry: { utils: { deepClone: value => structuredClone(value), getProperty: () => undefined } },
    DX3rdUniversalHandler: {
      comboMemberItems: () => [],
      groupExtensionsByKey: () => new Map(),
      mergeGroupedExtensionBuckets: () => []
    }
  });
  load(context, 'scripts/item-effect-adapter.js');
  load(context, 'scripts/handlers/combo-handler.js');

  const makeCombo = bucketDisable => ({
    id: `combo-${bucketDisable}`,
    name: `combo-${bucketDisable}`,
    type: 'combo',
    system: {
      attackRoll: 'melee',
      active: {
        state: false,
        action: 'use',
        disable: bucketDisable === 'round' ? 'notCheck' : 'round',
        runTiming: 'afterDamage',
        buckets: { attack: { disable: bucketDisable } }
      },
      attributes: { attack: { key: 'attack', value: '3', action: 'attack' } },
      effect: { disable: 'notCheck', runTiming: 'instant', attributes: {} }
    },
    getFlag: () => ({})
  });

  const enabled = makeCombo('round');
  assert.equal(context.DX3rdItemEffectAdapter.selfFiresAt(enabled, 'attack', 'afterDamage'), true);
  assert.equal((await context.DX3rdComboHandler.collectAfterDamageData({ id: 'actor' }, enabled)).activations.length, 1,
    '명시 attack 버킷이 root notCheck를 덮어썼으면 데미지 후 자기 보정을 예약해야 한다');

  const disabled = makeCombo('notCheck');
  assert.equal(context.DX3rdItemEffectAdapter.selfFiresAt(disabled, 'attack', 'afterDamage'), false);
  assert.equal((await context.DX3rdComboHandler.collectAfterDamageData({ id: 'actor' }, disabled)).activations.length, 0,
    '명시 attack 버킷의 notCheck를 root disable로 덮어 적용하면 안 된다');
});

test('afterHit target modifiers are an attack trigger distinct from HP loss', () => {
  const context = baseContext({
    game: { i18n: { localize: key => key, format: key => key } },
    ui: { notifications: { warn: () => {} } },
    CONFIG: { statusEffects: [] },
    Hooks: { once: () => {}, on: () => {} }
  });
  load(context, 'scripts/item-effect-adapter.js');
  const adapter = context.DX3rdItemEffectAdapter;

  const makeItem = runTiming => ({
    id: 'item', name: 'item', type: 'effect',
    system: {
      attackRoll: 'melee', getTarget: true,
      active: { state: false, disable: '-', runTiming: 'instant' },
      effect: { disable: 'scene', runTiming,
        attributes: { g: { key: 'guard', label: 'guard', value: '-3' } } }
    },
    getFlag: () => ({})
  });

  const hitItem = makeItem('afterHit');
  assert.equal(adapter.eventAction(hitItem, 'afterHit'), 'attack',
    'afterHit 버킷은 공격 판정의 후속이다');
  assert.equal(adapter.triggerFor('attack', 'afterHit'), 'hit',
    'afterHit는 명중 리포트로 해결된다');
  assert.equal(adapter.targetFiresAt(hitItem, 'attack', 'afterHit'), true);
  assert.equal(adapter.targetFiresAt(hitItem, 'attack', 'afterDamage'), false,
    'afterHit 버킷은 HP 감소 트리거에 발동하지 않는다 — 그 반대도 마찬가지다');
  assert.ok(Object.keys(adapter.targetBucketAttributes(hitItem, 'attack', 'afterHit')).length > 0);
  assert.equal(Object.keys(adapter.targetBucketAttributes(hitItem, 'attack', 'afterDamage')).length, 0);

  const damageItem = makeItem('afterDamage');
  assert.equal(adapter.targetFiresAt(damageItem, 'attack', 'afterDamage'), true);
  assert.equal(adapter.targetFiresAt(damageItem, 'attack', 'afterHit'), false,
    '「1점이라도 HP데미지」 계열은 명중만으로 발동하면 안 된다');
});

test('combo afterHit target modifiers are collected separately from the damaged applies', async () => {
  const member = {
    id: 'member-hit', name: '중력의 수갑', type: 'effect',
    system: {
      attackRoll: '-', getTarget: true,
      active: { state: false, disable: '-', runTiming: 'instant' },
      attributes: {}, macro: '', macros: [],
      effect: { disable: 'scene', runTiming: 'afterHit',
        attributes: { d: { key: 'dice', label: 'dice', value: '-(2)' } } }
    },
    getFlag: () => ({})
  };
  const targetActor = { id: 'hit-actor', name: '명중된 대상', isOwner: true, effects: [] };
  const hitToken = { id: 'hit-token', actor: targetActor };
  const context = baseContext({
    game: {
      user: { targets: new Set(), isGM: true },
      macros: { getName: () => null },
      actors: new Map([[targetActor.id, targetActor]]),
      i18n: { localize: key => key, format: key => key }
    },
    canvas: { tokens: { controlled: [], placeables: [hitToken], get: id => id === hitToken.id ? hitToken : null } },
    ui: { notifications: { warn: () => {} } },
    CONFIG: { statusEffects: [] },
    Hooks: { once: () => {}, on: () => {} },
    foundry: { utils: { deepClone: value => structuredClone(value), getProperty: () => undefined } }
  });
  load(context, 'scripts/item-effect-adapter.js');
  load(context, 'scripts/handlers/universal-handler.js');
  load(context, 'scripts/handlers/universal-apply.js');
  load(context, 'scripts/handlers/combo-handler.js');
  context.DX3rdUniversalHandler.comboMemberItems = () => [member];
  context.DX3rdUniversalHandler.groupExtensionsByKey = () => new Map();
  context.DX3rdUniversalHandler.mergeGroupedExtensionBuckets = () => [];
  context.DX3rdUniversalHandler.hasExecutableMacros = () => false;

  const combo = {
    id: 'combo', name: 'combo', type: 'combo',
    system: {
      attackRoll: 'melee', getTarget: true,
      active: { state: false, disable: 'notCheck', runTiming: 'instant' },
      attributes: {}, macro: '', macros: [],
      effect: { disable: 'notCheck', runTiming: 'instant', attributes: {} }
    },
    getFlag: () => ({})
  };
  const actor = { id: 'actor', items: new Map([[member.id, member], [combo.id, combo]]) };
  context.game.actors.set(actor.id, actor);

  const data = await context.DX3rdComboHandler.collectAfterDamageData(actor, combo);
  assert.equal(data.applies.length, 0, 'afterHit 멤버는 damaged 대상 적용 목록에 들어가면 안 된다');
  assert.equal(data.hitApplies.length, 1, 'afterHit 멤버는 hitApplies로 수집된다');
  assert.equal(data.hitApplies[0].itemId, 'member-hit');
  assert.equal(data.hitApplies[0].frozenAttributes.d.key, 'dice',
    '사용 시점에 동결된 버킷이 실려야 한다');
  assert.equal(data.hitApplies[0].action, 'attack',
    'afterHit 버킷은 attack 버킷으로 분류돼야 한다 — use로 남으면 실행 게이트가 조용히 걸러낸다');

  const applied = [];
  context.DX3rdUniversalHandler.dispatchItemAttributes =
    async (_source, _item, target) => applied.push(target.id);
  await context.DX3rdUniversalHandler.processComboAfterHit({ actorId: actor.id, ...data },
    [], [hitToken.id]);
  assert.deepEqual(applied, [targetActor.id],
    '데미지 0이어도 명중 리포트에 포함된 대상에게 afterHit 버킷이 적용돼야 한다');

  applied.length = 0;
  await context.DX3rdUniversalHandler.processComboAfterHit({ actorId: actor.id, ...data }, [], []);
  assert.deepEqual(applied, [], '미스(명중 대상 없음)에는 발동하지 않는다');
});

test('attack riders route afterHit and afterDamage buckets to their own report lists', async () => {
  const hitActor = { id: 'hit-actor', name: '명중된 대상', isOwner: true, effects: [] };
  const hitToken = { id: 'hit-token', actor: hitActor };
  const context = baseContext({
    game: {
      user: { targets: new Set(), isGM: true },
      macros: { getName: () => null },
      actors: new Map([[hitActor.id, hitActor]]),
      i18n: { localize: key => key, format: key => key }
    },
    canvas: { tokens: { controlled: [], placeables: [hitToken], get: id => id === hitToken.id ? hitToken : null } },
    ui: { notifications: { warn: () => {} } },
    CONFIG: { statusEffects: [] },
    Hooks: { once: () => {}, on: () => {} },
    foundry: { utils: { deepClone: value => structuredClone(value), getProperty: () => undefined } }
  });
  load(context, 'scripts/item-effect-adapter.js');
  load(context, 'scripts/handlers/universal-handler.js');
  load(context, 'scripts/handlers/universal-apply.js');
  const handler = context.DX3rdUniversalHandler;

  const makeItem = (id, attackRoll, runTiming) => ({
    id, name: id, type: 'effect',
    system: {
      attackRoll, getTarget: true,
      active: { state: false, disable: '-', runTiming: 'instant' },
      attributes: {}, macro: '', macros: [],
      effect: { disable: 'scene', runTiming,
        attributes: { d: { key: 'dice', label: 'dice', value: '-(2)' } } }
    },
    getFlag: () => ({})
  });
  // ① 단독 공격 아이템의 자기 afterHit 버킷 (fromAttackItem)
  const attackItem = makeItem('attack-hit', 'melee', 'afterHit');
  // ② 준비형 afterHit — 「명중할 경우」 탄환류 (베넘 블러드 등)
  const prepHit = makeItem('prep-hit', '-', 'afterHit');
  // ③ 준비형 afterDamage — 「1점이라도 HP데미지」 계열 (재앙의 진홍 등)
  const prepDamage = makeItem('prep-damage', '-', 'afterDamage');

  const flags = {};
  const attacker = {
    id: 'attacker', name: '공격자',
    items: new Map([[attackItem.id, attackItem], [prepHit.id, prepHit], [prepDamage.id, prepDamage]]),
    getFlag: (scope, key) => flags[`${scope}.${key}`],
    setFlag: async (scope, key, value) => { flags[`${scope}.${key}`] = value; },
    unsetFlag: async (scope, key) => { delete flags[`${scope}.${key}`]; }
  };

  assert.equal(await handler.armPendingAttackRider(attacker, attackItem, 'attack'), true,
    'afterHit 공격 아이템의 자기 버킷이 라이더로 실려야 한다');
  assert.equal(await handler.armPendingAttackRider(attacker, attackItem, 'use'), false,
    '공격 아이템을 「사용」만 하면 라이더를 싣지 않는다 — 공격 행위가 운반한다');
  assert.equal(await handler.armPendingAttackRider(attacker, prepHit, 'use'), true);
  assert.equal(await handler.armPendingAttackRider(attacker, prepDamage, 'use'), true);

  const riders = flags['dx3rd-emanim.pendingAttackRiders'];
  assert.equal(riders.length, 3);
  const byId = Object.fromEntries(riders.map(rider => [rider.itemId, rider]));
  assert.equal(byId['attack-hit'].fromAttackItem, true);
  assert.equal(byId['attack-hit'].hitAttributes.d.key, 'dice',
    '공격 아이템의 afterHit 버킷이 동결돼야 한다');
  assert.equal(byId['prep-hit'].hitAttributes.d.key, 'dice');
  assert.equal(Object.keys(byId['prep-damage'].hitAttributes).length, 0,
    'afterDamage 라이더의 hit 버킷은 비어 있어야 한다');
  assert.equal(byId['prep-damage'].targetAttributes.d.key, 'dice');

  const applied = [];
  handler.dispatchItemAttributes =
    async (_source, item, target) => applied.push(`${item.id}→${target.id}`);

  // 시나리오 1: 미스 — hit·damaged 리포트 모두 없음
  await handler.processPendingAttackRiders(attacker, riders, [], []);
  await handler.processDamagedAttackRiders(attacker, riders, []);
  assert.deepEqual(applied, [], '미스에는 어떤 라이더도 발동하지 않는다');

  // 시나리오 2: 데미지 0 명중 — afterHit만 발동, afterDamage는 불발
  await handler.processPendingAttackRiders(attacker, riders, [hitActor.id], [hitToken.id]);
  await handler.processDamagedAttackRiders(attacker, riders, []);
  assert.deepEqual(applied.sort(), ['attack-hit→hit-actor', 'prep-hit→hit-actor'],
    '데미지 0 명중에는 afterHit 버킷만 명중 대상에 적용된다');
  applied.length = 0;

  // 시나리오 3: 명중 + HP 감소 — afterHit는 hit 목록에, afterDamage는 damaged 목록에 각각 한 번씩
  await handler.processPendingAttackRiders(attacker, riders, [hitActor.id], [hitToken.id]);
  await handler.processDamagedAttackRiders(attacker, riders, [hitActor]);
  assert.deepEqual(applied.sort(),
    ['attack-hit→hit-actor', 'prep-damage→hit-actor', 'prep-hit→hit-actor'],
    '공격 아이템의 afterDamage 이중 적용이 없고 각 버킷이 정확히 한 번씩 발동한다');
});

test('the damage-report completion routes hit and damaged work on separate lists', () => {
  const handler = source('scripts/handlers/universal-handler.js').replace(/\s+/g, ' ');
  assert.ok(handler.includes("rider.hitAttributes"),
    '라이더의 afterHit 버킷은 hitAttributes로 동결돼 명중 리포트에 적용된다');
  assert.ok(handler.includes("processDamagedAttackRiders"),
    '라이더의 afterDamage 버킷은 damaged 대상에만 적용돼야 한다');
  assert.ok(handler.includes("processComboAfterHit"));

  for (const file of ['scripts/main.js', 'scripts/handlers/universal-damage-dialog.js']) {
    const body = source(file).replace(/\s+/g, ' ');
    assert.ok(body.includes('processComboAfterHit'), `${file}: 콤보 afterHit 실행 호출이 없다`);
    assert.ok(body.includes('processDamagedAttackRiders'), `${file}: 라이더 damaged 실행 호출이 없다`);
  }
});

test('combo after-success target modifiers keep the targets selected at use time', async () => {
  const useActor = { id: 'target-at-use', name: '사용 시 대상', isOwner: true, effects: [] };
  const clickActor = { id: 'target-at-click', name: '클릭 시 대상', isOwner: true, effects: [] };
  const useToken = { id: 'token-at-use', actor: useActor };
  const clickToken = { id: 'token-at-click', actor: clickActor };
  const tokens = new Map([[useToken.id, useToken], [clickToken.id, clickToken]]);
  const context = baseContext({
    game: {
      user: { targets: new Set([useToken]), isGM: true },
      macros: { getName: () => null },
      actors: new Map(),
      scenes: { active: null },
      i18n: { localize: key => key, format: key => key }
    },
    canvas: { tokens: { get: id => tokens.get(id), placeables: [...tokens.values()], controlled: [] } },
    ui: { notifications: { warn: () => {}, error: () => {}, info: () => {} }, windows: {} },
    CONFIG: { statusEffects: [] },
    Hooks: { once: () => {}, on: () => {} },
    foundry: { utils: { deepClone: value => structuredClone(value), getProperty: () => undefined } }
  });
  load(context, 'scripts/item-effect-adapter.js');
  load(context, 'scripts/handlers/universal-handler.js');
  load(context, 'scripts/handlers/universal-apply.js');
  load(context, 'scripts/handlers/combo-handler.js');
  context.DX3rdUniversalHandler.comboMemberItems = () => [];
  context.DX3rdUniversalHandler.groupExtensionsByKey = () => new Map();
  context.DX3rdUniversalHandler.mergeGroupedExtensionBuckets = () => [];

  const combo = {
    id: 'combo', name: 'combo', type: 'combo',
    system: {
      attackRoll: 'melee', getTarget: true, scene: false,
      active: { state: false, disable: 'notCheck', runTiming: 'instant' },
      attributes: {}, macro: '', macros: [],
      effect: {
        disable: 'round', runTiming: 'afterSuccess',
        attributes: { dice: { key: 'dice', value: '1' } }
      }
    },
    getFlag: () => ({})
  };
  const actor = { id: 'caster', items: new Map([[combo.id, combo]]) };
  context.game.actors.set(actor.id, actor);
  const comboData = await context.DX3rdComboHandler.collectAfterSuccessData(actor, combo);
  assert.deepEqual(plain(comboData.applies[0].selectedTargetIds), [useToken.id]);

  const applied = [];
  context.DX3rdUniversalHandler.dispatchItemAttributes = async (_source, _item, target) => applied.push(target.id);
  context.game.user.targets = new Set([clickToken]);
  await context.DX3rdUniversalHandler.processComboAfterSuccess({ actorId: actor.id, ...comboData });
  assert.deepEqual(applied, [useActor.id], '성공 버튼을 누를 때의 UI 타겟으로 바뀌면 안 된다');
});

test('combo follow-up macros reserve once and execute legacy and embedded rows once each', async () => {
  const executions = { A: 0, B: 0, C: 0 };
  const worldMacros = new Map([
    ['A', { getFlag: () => 'afterSuccess', execute: async () => { executions.A += 1; } }],
    ['B', { getFlag: () => 'afterSuccess', execute: async () => { executions.B += 1; } }],
    // Embedded kind:'macro' rows own their timing; this world flag is intentionally irrelevant.
    ['C', { getFlag: () => 'instant', execute: async () => { executions.C += 1; } }]
  ]);
  const context = baseContext({
    game: {
      user: { targets: new Set(), isGM: true },
      macros: { getName: name => worldMacros.get(name) || null },
      actors: new Map(),
      i18n: { localize: key => key, format: key => key }
    },
    canvas: { tokens: { controlled: [], placeables: [], get: () => null } },
    ui: { notifications: { warn: () => {}, error: () => {}, info: () => {} }, windows: {} },
    CONFIG: { statusEffects: [] },
    Hooks: { once: () => {}, on: () => {} },
    foundry: {
      utils: {
        deepClone: value => structuredClone(value),
        getProperty: () => undefined,
        AsyncFunction: Object.getPrototypeOf(async function () {}).constructor
      }
    }
  });
  load(context, 'scripts/item-effect-adapter.js');
  load(context, 'scripts/handlers/universal-handler.js');
  load(context, 'scripts/handlers/combo-handler.js');
  context.DX3rdUniversalHandler.comboMemberItems = () => [];
  context.DX3rdUniversalHandler.groupExtensionsByKey = () => new Map();
  context.DX3rdUniversalHandler.mergeGroupedExtensionBuckets = () => [];

  const combo = {
    id: 'combo-macros', name: 'macro combo', type: 'combo', actor: null,
    system: {
      attackRoll: 'melee',
      active: { state: false, disable: 'notCheck', runTiming: 'instant' },
      attributes: {},
      effect: { disable: 'notCheck', runTiming: 'instant', attributes: {} },
      macro: '[A][B]',
      macros: [{ timing: 'afterSuccess', action: 'attack', kind: 'macro', macroName: 'C' }]
    },
    getFlag: () => ({})
  };
  const actor = { id: 'caster', items: new Map([[combo.id, combo]]) };
  context.game.actors.set(actor.id, actor);

  const collected = await context.DX3rdComboHandler.collectAfterSuccessData(actor, combo);
  assert.equal(collected.macros.length, 1,
    '레거시 두 행과 내장 한 행이 있어도 아이템 실행 예약은 하나여야 한다');
  assert.equal('macroName' in collected.macros[0], false,
    '새 페이로드는 실행기가 무시하는 개별 매크로 이름을 직렬화하지 않는다');
  await context.DX3rdUniversalHandler.processComboAfterSuccess({ actorId: actor.id, ...collected });
  assert.deepEqual(executions, { A: 1, B: 1, C: 1 });

  executions.A = executions.B = executions.C = 0;
  await context.DX3rdUniversalHandler.processComboAfterSuccess({
    actorId: actor.id,
    comboItemId: combo.id,
    // Compatibility: old cards serialized one entry per legacy name.
    macros: [
      { itemId: combo.id, itemName: combo.name, macroName: 'A', timing: 'afterSuccess', action: 'attack' },
      { itemId: combo.id, itemName: combo.name, macroName: 'B', timing: 'afterSuccess', action: 'attack' }
    ]
  });
  assert.deepEqual(executions, { A: 1, B: 1, C: 1 },
    '구형 카드의 중복 예약도 같은 아이템 실행을 한 번만 호출해야 한다');

  combo.system.macro = '';
  combo.system.macros = [{ timing: 'afterDamage', action: 'attack', kind: 'macro', macroName: 'C' }];
  const afterDamage = await context.DX3rdComboHandler.collectAfterDamageData(actor, combo);
  assert.equal(afterDamage.macros.length, 1, '내장 매크로만 있어도 데미지 후 실행을 예약해야 한다');
  executions.C = 0;
  await context.DX3rdUniversalHandler.processComboAfterDamage(
    { actorId: actor.id, ...afterDamage }, [], []);
  assert.equal(executions.C, 1, '데미지 후 내장 매크로도 정확히 한 번 실행돼야 한다');
});

test('legacy instant macros remain timing-only while embedded macros keep their action', async () => {
  const executions = { legacy: 0, use: 0, activation: 0 };
  const worldMacros = new Map([
    ['Legacy', { getFlag: () => 'instant', execute: async () => { executions.legacy += 1; } }],
    ['Use', { getFlag: () => 'instant', execute: async () => { executions.use += 1; } }],
    ['Activation', { getFlag: () => 'instant', execute: async () => { executions.activation += 1; } }]
  ]);
  const context = baseContext({
    game: {
      user: { targets: new Set() },
      macros: { getName: name => worldMacros.get(name) || null },
      i18n: { localize: key => key, format: key => key }
    },
    canvas: { tokens: { controlled: [], placeables: [] } },
    ui: { notifications: { warn: () => {}, error: () => {}, info: () => {} }, windows: {} },
    CONFIG: { statusEffects: [] },
    Hooks: { once: () => {}, on: () => {} },
    foundry: { utils: { deepClone: value => structuredClone(value), getProperty: () => undefined } }
  });
  load(context, 'scripts/item-effect-adapter.js');
  load(context, 'scripts/handlers/universal-handler.js');

  const item = {
    id: 'always-effect', name: '상시 이펙트', type: 'effect', actor: null,
    system: {
      timing: 'always', attackRoll: '-', macro: '[Legacy]',
      active: { state: false, applyMode: 'toggle', action: 'activation' },
      attributes: { dice: { key: 'dice', value: '1' } },
      effect: { attributes: {} },
      macros: [
        { timing: 'instant', action: 'use', kind: 'macro', macroName: 'Use' },
        { timing: 'instant', action: 'activation', kind: 'macro', macroName: 'Activation' }
      ]
    }
  };

  assert.equal(context.DX3rdUniversalHandler.hasExecutableMacros(item, 'instant', 'activation'), true);
  await context.DX3rdUniversalHandler.executeMacros(item, 'instant', 'activation');
  assert.deepEqual(executions, { legacy: 1, use: 0, activation: 1 },
    '활성화에서는 레거시 즉시 매크로와 activation 내장 행만 실행돼야 한다');

  executions.legacy = executions.use = executions.activation = 0;
  await context.DX3rdUniversalHandler.executeMacros(item, 'instant', 'use');
  assert.deepEqual(executions, { legacy: 1, use: 1, activation: 0 },
    '사용에서는 같은 레거시 매크로와 use 내장 행만 실행돼야 한다');
});

test('combo after-damage extensions preserve authored targets at immediate and after-main stages', () => {
  const handler = source('scripts/handlers/universal-handler.js');
  const body = handler.slice(handler.indexOf('async processComboAfterDamage'), handler.indexOf('async handleSuccessButton'));
  assert.match(body, /const afterDamageTarget = bucket => window\.DX3rdRuntimeUtils\.resolveAfterDamageTarget/);
  assert.ok((body.match(/const targetData = afterDamageTarget\(bucket\)/g) || []).length >= 6,
    '즉시와 afterMain의 회복·데미지·상태이상이 같은 대상 규칙을 써야 한다');
  assert.doesNotMatch(body, /\? 'targetToken' : bucket\.target/,
    '피해자가 있다는 이유만으로 self·targetAll 저작을 targetToken으로 덮으면 안 된다');
});

test('each damage application keeps an independent after-damage request id through every client', () => {
  const damage = source('scripts/handlers/universal-damage-dialog.js').replace(/\s+/g, ' ');
  const main = source('scripts/main.js').replace(/\s+/g, ' ');
  const contracts = source('scripts/socket-contracts.js').replace(/\s+/g, ' ');

  assert.ok(damage.includes("const damageRequestId = window.DX3rdRuntimeUtils.createRequestId('afterDamage')"));
  assert.ok(damage.includes('const extensionQueueKey = damageRequestId'));
  assert.ok(damage.includes('const activationQueueKey = damageRequestId'));
  // 인접성이 아니라 사실을 본다 — 페이로드에 필드가 하나 끼어들었다고 깨지면 안 된다.
  assert.match(damage, /const payload = \{[\s\S]*?itemId: item\?\.id \|\| null,[\s\S]*?damageRequestId[\s\S]*?\};/,
    '모든 방어 다이얼로그가 공격 1회 식별자를 받아야 한다');
  assert.ok(damage.includes('targetTokenIds: targetTokenIds'));
  assert.ok(damage.includes('recordAfterDamageReport(extensionRequest'),
    '같은 Actor를 공유하는 토큰도 각각 독립 보고로 완료되어야 한다');
  assert.ok(main.includes('const queueKey = damageRequestId'));
  assert.ok(main.includes('const extensionRequest = window.DX3rdAfterDamageExtensionQueue?.[queueKey]'));
  assert.ok(main.includes('const request = window.DX3rdAfterDamageActivationQueue?.[queueKey]'),
    '대상측 보고 하나가 같은 공격의 확장·활성화 큐를 모두 완료해야 한다');
  assert.match(contracts, /isId\(data\.payload\.damageRequestId\)/);
  assert.match(contracts, /isId\(data\.payload\.targetTokenId\)/);
  assert.match(contracts, /isId\(data\.dialogData\.damageRequestId\)/);
  assert.ok(damage.includes('close: cancelDamageRequest'));
  assert.ok(main.includes("data.type === 'cancelAfterDamageRequest'"));
});

test('registered reaction combos cannot suppress member target requirements', () => {
  const damage = source('scripts/handlers/universal-damage-dialog.js').replace(/\s+/g, ' ');
  const start = damage.indexOf('const useRegisteredReaction = async (itemId) =>');
  const end = damage.indexOf('const useInstantReactionCombo = async () =>', start);
  const body = damage.slice(start, end);
  assert.match(body, /item\.type, null, .*?undefined, \{/,
    'getTarget을 미지정으로 넘겨야 공용 게이트가 콤보 구성원까지 검사한다');
  assert.doesNotMatch(body, /item\.system\?\.getTarget/);
});

test('a rejected instant combo stays open instead of deleting the builder document', () => {
  const sheet = source('scripts/sheets/combo-sheet-v2.js').replace(/\s+/g, ' ');
  assert.match(sheet, /const used = await handler\.handleItemUse\( actor\.id, this\.item\.id, 'combo', null,/,
    '즉석 콤보 실행 결과를 받아 성공 여부를 판정해야 한다');
  assert.match(sheet, /if \(used === true\) \{ .*?InstantComboRetention\?\.retain.*?await this\.close\(\)/,
    '성공한 즉석 콤보만 숨김 출처로 보존한 뒤 시트를 닫아야 한다');
  assert.match(sheet, /const discard = .*?DX3rdIsInstantCombo.*?InstantComboRetention\?\.isRetained/,
    '거절/취소한 작성 문서는 삭제하고, 사용한 숨김 출처는 닫을 때 삭제하면 안 된다');
});

test('a hidden instant combo survives pending and applied work, then cleans itself up', async () => {
  const helpers = source('scripts/helpers.js');
  const marker = helpers.indexOf('window.DX3rdIsInstantCombo = function');
  const start = helpers.lastIndexOf('(function()', marker);
  const end = helpers.indexOf('// A non-modal picker replacing', start);
  assert.ok(marker >= 0 && start >= 0 && end > start);

  const applied = {};
  const context = baseContext({
    foundry: { utils: { deepClone: value => structuredClone(value) } },
    game: {
      actors: [],
      settings: { get: () => [] }
    }
  });
  context.DX3rdAppliedEffects = { collect: () => applied };
  vm.runInContext(helpers.slice(start, end), context, {filename: 'instant-combo-retention.js'});

  const actor = {id: 'a1', items: new Map()};
  context.game.actors.push(actor);
  let deleted = false;
  const item = {
    id: 'c1', _id: 'c1', type: 'combo', name: '[콤보]', actor,
    flags: {'dx3rd-emanim': {instantCombo: true}},
    system: {active: {state: false}},
    getFlag(scope, key) { return this.flags?.[scope]?.[key]; },
    async update(changes) {
      for (const [path, value] of Object.entries(changes)) {
        const keys = path.split('.');
        let cursor = this;
        while (keys.length > 1) cursor = cursor[keys.shift()] ??= {};
        cursor[keys[0]] = structuredClone(value);
      }
    },
    async delete() { deleted = true; actor.items.delete(this.id); }
  };
  actor.items.set(item.id, item);

  const retention = context.DX3rdInstantComboRetention;
  await retention.retain(item, {afterSuccess: true});
  assert.equal(retention.isRetained(item), true);
  assert.equal(await retention.tryCleanup(item), false, '후속 실행 대기 중에는 삭제하면 안 된다');

  item.system.active.state = true;
  await retention.complete(actor, item.id, 'afterSuccess');
  assert.equal(deleted, false, '자기 지속 효과가 활성인 동안 출처 Item이 남아야 한다');

  item.system.active.state = false;
  applied.buff = {itemId: item.id};
  assert.equal(await retention.tryCleanup(item), false, '적용 효과가 남아 있는 동안 출처 Item이 남아야 한다');
  delete applied.buff;
  assert.equal(await retention.tryCleanup(item), true);
  assert.equal(deleted, true);
});

test('instant combo body follow-ups use the embedded source first and a serialized fallback later', () => {
  const combo = source('scripts/handlers/combo-handler.js').replace(/\s+/g, ' ');
  const handler = source('scripts/handlers/universal-handler.js').replace(/\s+/g, ' ');
  const apply = source('scripts/handlers/universal-apply.js').replace(/\s+/g, ' ');
  const actorData = source('scripts/sheets/actor-sheet-data.js').replace(/\s+/g, ' ');

  assert.match(combo, /comboItemSnapshot: window\.DX3rdIsInstantCombo/,
    '후속 데이터 자체가 콤보 본체 스냅샷을 운반해야 소켓/재굴림 경로도 복원된다');
  assert.match(handler, /const embedded = actor\?\.items\?\.get\?\.\(itemId\).*?comboItemSnapshot.*?DX3rdHydrateInstantCombo/,
    '존속 중에는 실제 Document를, 정리 뒤에는 스냅샷을 사용해야 한다');
  assert.ok((handler.match(/resolveComboFollowupItem\(actor, comboData, itemId\)/g) || []).length >= 6,
    '자기 보정·매크로·대상 보정의 성공 후/데미지 후 경로가 모두 같은 복원기를 써야 한다');
  assert.match(apply, /if \(forceFrozen\) \{ .*?selfBucketAttributes.*?_applyItemAttributes/,
    '삭제 뒤 자기 보정은 존재하지 않는 active.state 대신 같은 수명의 동결 AE로 남겨야 한다');
  assert.match(actorData, /if \(window\.DX3rdIsInstantCombo\?\.\(item\)\) return/,
    '숨김 출처가 액터 시트의 일반 콤보 목록에 나타나면 안 된다');
});

test('item handler failures and static roll errors are rejected before completion', () => {
  const handler = source('scripts/handlers/universal-handler.js').replace(/\s+/g, ' ');
  const preflight = handler.indexOf('if (!this.validateItemUsePreflight(actor, item, itemType, action))');
  const cost = handler.indexOf('const usageAllowed = await this.processItemUsageCost(actor, item, { action,', preflight);
  assert.ok(preflight >= 0 && cost > preflight,
    '판정 설정 오류는 침식치·HP·사용 횟수를 쓰기 전에 거절해야 한다');
  assert.ok(handler.includes('if (handlerResult === false) return false;'),
    '타입 핸들러의 명시적 실패를 채팅 완료 표시와 임시 콤보 정리까지 전파해야 한다');

  const modeChoice = handler.indexOf("if ((connectionHasRoll || itemType === 'book') && options.comboMode === undefined)");
  const firstCost = handler.indexOf('const usageAllowed = await this.processItemUsageCost(actor, item, { action,');
  assert.ok(modeChoice >= 0 && firstCost > modeChoice,
    '커넥션/마도서의 취소·콤보 선택은 비용 지불 전에 끝나야 한다');
});

test('manual other-target compendium effects cannot bypass target or select self', () => {
  const handler = source('scripts/handlers/universal-handler.js').replace(/\s+/g, ' ');
  assert.ok(handler.includes("const requiresTarget = manualTargetOtherOnly || (getTarget !== undefined"),
    '호출부의 getTarget=false가 수동 대상 이펙트의 대상 요구를 꺼서는 안 된다');
  assert.ok(handler.includes("manualTargetOtherOnly && targets.some(target => target.actor?.id === actor.id)"),
    '수동 대상 이펙트는 사용한 액터 자신을 대상으로 허용하면 안 된다');
  assert.ok(handler.includes("game.i18n.localize('DX3rd.TargetOtherOnly')"),
    '자기 대상 거부는 현지화된 안내를 사용해야 한다');
});

test('numeric success buttons execute serialized combo after-success data', () => {
  const chat = source('scripts/chat/chat-ui.js');
  const start = chat.indexOf("dx3rdRegisterGlobalListener('dx3rd-success'");
  const end = chat.indexOf("dx3rdRegisterGlobalListener('dx3rd-win-check'", start);
  const handler = chat.slice(start, end).replace(/\s+/g, ' ');
  assert.ok(handler.includes("const comboAfterSuccess = message.getFlag('dx3rd-emanim', 'comboAfterSuccess')"));
  assert.ok(handler.includes('await window.DX3rdUniversalHandler.processComboAfterSuccess(comboAfterSuccess,'),
    '삭제된 임시 콤보를 itemId로 다시 찾으면 멤버 성공 후 효과가 사라진다');
});

test('damage rolls replace the attack card slot instead of creating a second card', () => {
  const chat = source('scripts/chat/chat-ui.js').replace(/\s+/g, ' ');
  assert.ok(chat.includes(
    'actor, item, rollResult, preservedValues, comboAfterDamageData, message'
  ), '데미지 처리기에 클릭한 공격 메시지를 전달해야 한다');

  const rollDialog = source('scripts/handlers/universal-roll-dialog.js');
  assert.match(rollDialog, /class="damage-roll-message dx3rd-attack-card__actions"/,
    '공용 공격 판정 카드에도 병합 대상 영역이 있어야 한다');

  const damage = source('scripts/handlers/universal-damage-dialog.js').replace(/\s+/g, ' ');
  assert.ok(damage.includes(
    'sourceMessage ? await this.mergeDamageRollIntoMessage(sourceMessage, damageApplyContent, damageRoll) : await ChatMessage.create(messageData)'
  ), '공격 메시지가 있으면 새 메시지 대신 원본 카드를 갱신해야 한다');
  assert.ok(damage.includes('this.renderAttackRollButton(actor, item, {repeatable: true})'),
    '굴림과 적용이 끝난 자리에도 명중 재굴림 버튼을 둬야 한다');
  assert.ok(!damage.includes('<button class="damage-apply-btn"'),
    '새 데미지 결과 카드에는 별도의 적용 버튼을 남기지 않는다');
  assert.ok(damage.includes("damageRoot.querySelector('.dx3rd-damage-actions')"));
  assert.ok(damage.includes("damageActions.insertAdjacentHTML('beforeend', damageRollButton)"),
    '완료된 데미지 카드에도 데미지 재굴림 버튼을 유지해야 한다');
  assert.ok(!damage.includes('<div class="dice-roll">${rollHTML}</div>'),
    'Roll.render 결과를 dice-roll로 중첩하면 데미지 결과 폭과 툴팁 배치가 깨진다');
  assert.ok(damage.includes("'flags.dx3rd-emanim.damageRollMerged': true"),
    '재굴림 시 Roll 배열을 끝없이 늘리지 않도록 병합 상태를 기록해야 한다');
});

test('the damage dialog accepts a dice formula as its damage modifier', () => {
  const template = source('templates/dialog/damage-calc-dialog.html').replace(/\s+/g, ' ');
  const damage = source('scripts/handlers/universal-damage-dialog.js').replace(/\s+/g, ' ');

  assert.match(template, /<input type="text" id="add-damage" value="0">/,
    'HTML number inputs reject Roll formulas such as 1d10');
  assert.doesNotMatch(damage, /parseInt\(form\?\.querySelector\('#add-damage'\)/,
    'the confirmation path must not truncate 1d10 to 1');
  assert.match(damage,
    /prepareRollFormula\(addDamageInput, item, actor\)[\s\S]*joinFormulaTerms\(totalDamageAddFormula, addDamage\)/,
    'the entered formula must be prepared and joined into the one final damage Roll');
});

test('attack and damage automation settings preserve the same card workflow', () => {
  const main = source('scripts/main.js').replace(/\s+/g, ' ');
  assert.match(main, /game\.settings\.register\('dx3rd-emanim', 'autoAttackRoll', \{[\s\S]*?scope: 'client'[\s\S]*?default: true/);
  assert.match(main, /game\.settings\.register\('dx3rd-emanim', 'autoDamageRoll', \{[\s\S]*?scope: 'client'[\s\S]*?default: false/);

  const damage = source('scripts/handlers/universal-damage-dialog.js').replace(/\s+/g, ' ');
  assert.ok(damage.includes("if (!autoAttackRoll && !options.forceRoll) { await this.createPendingAttackCard(actor, item); return true; }"),
    '명중 자동 굴림을 끄면 실제 굴림보다 카드가 먼저 만들어져야 한다');
  assert.ok(damage.includes("game.settings.get('dx3rd-emanim', 'autoDamageRoll') !== true"),
    '피해 자동 굴림은 명시적으로 켠 클라이언트에서만 실행해야 한다');
  assert.ok(damage.includes('button.click();'),
    '자동 피해도 수동 데미지 버튼과 동일한 채팅 실행 경로를 타야 한다');
  assert.ok(damage.includes("'.damage-dialog button[data-action=\"confirm\"]'"),
    '피해 자동 굴림은 산출 창을 열기만 하지 말고 기본값으로 확정해야 한다');

  const chat = source('scripts/chat/chat-ui.js').replace(/\s+/g, ' ');
  assert.ok(chat.includes('forceRoll: true, sourceMessage: message'),
    '수동 명중 버튼은 처음 만든 카드를 결과 카드로 갱신해야 한다');
  assert.ok(chat.includes("const repeatable = button.dataset.repeatable === 'true'"),
    '피해 결과 아래의 명중 버튼은 완료 잠금 없이 다시 사용할 수 있어야 한다');
  assert.ok(chat.includes("const isAttackCardButton = !!button.closest('.dx3rd-attack-card')"),
    '공격 카드 안의 명중 버튼은 판정창을 여는 즉시 완료로 잠기면 안 된다');
  assert.ok(chat.includes("button && !button.closest('.dx3rd-attack-card')"),
    '기존 완료 플래그가 있어도 결과 카드의 재명중 버튼을 완료로 복원하면 안 된다');
  assert.ok(chat.includes("if (isCompleted && !isAttackCardButton)"),
    '공격 카드의 데미지 버튼은 완료 플래그 때문에 두 번 눌러야 해서는 안 된다');

  const roll = source('scripts/handlers/universal-roll-dialog.js').replace(/\s+/g, ' ');
  assert.ok(roll.includes('actionContent: `${this.renderAttackRollButton(actor, item, {repeatable: true})}${damageRollButtonContent}`'),
    '명중 결과 뒤에는 명중과 데미지 버튼을 함께 표시해야 한다');
  assert.ok(roll.includes('effectiveStat.rollFormula, sourceMessage);'),
    '장비 공격이 공용 판정 분기로 들어가도 원본 수동 카드를 잃으면 안 된다');
  assert.ok(roll.includes('if (sourceMessage && isAttackRoll) {'),
    '공용 공격 판정도 새 메시지 대신 수동 카드를 갱신해야 한다');
});

test('all attack paths use the shared Midi-QOL-inspired merged card hierarchy', () => {
  const rollDialog = source('scripts/handlers/universal-roll-dialog.js').replace(/\s+/g, ' ');
  assert.ok(rollDialog.includes('renderAttackChatCard({actor, item, flavorText = \'\', rollHtml = \'\', actionContent = \'\'})'));
  assert.ok(rollDialog.includes("const isEquipmentAttack = !!item && ['weapon', 'vehicle'].includes(item.type);"),
    '직접 무기/비클 공격은 attackRoll 필드가 없어도 공격 카드로 분류해야 한다');
  assert.ok(rollDialog.includes('isEquipmentAttack || (authoredAttackRoll'),
    '장비 공격이 일반 메이저 판정 카드로 빠지면 데미지 버튼과 새 디자인이 모두 사라진다');
  assert.ok((rollDialog.match(/this\.renderAttackChatCard\(/g) || []).length >= 2,
    '직접 공격과 공용 판정 공격이 같은 카드 렌더러를 사용해야 한다');
  assert.ok(rollDialog.includes('<header class="dx3rd-attack-card__header">'));
  assert.ok(!rollDialog.includes('dx3rd-attack-card__chevron'),
    '동작하지 않는 공격 카드 접기 아이콘을 다시 노출하면 안 된다');
  assert.ok(rollDialog.includes('<footer class="damage-roll-message dx3rd-attack-card__actions">'));
  assert.ok(rollDialog.includes('<div class="dx3rd-card-buttons">${actionContent}</div>'),
    '초기 데미지 롤 버튼도 결과 필드와 분리된 액션 행에 있어야 한다');

  const combo = source('scripts/handlers/combo-handler.js');
  assert.match(combo, /DX3rdUniversalHandler\.renderAttackChatCard\(/,
    '고정 달성치 콤보 공격도 별도 구형 카드로 남으면 안 된다');

  const css = source('styles/styles.css');
  assert.match(css, /\.dx3rd-attack-card \.dx3rd-attack-card__header/);
  assert.match(css, /\.dx3rd-attack-card \.dx3rd-attack-card__actions/);
  assert.match(css, /\.dx3rd-attack-card \.dx3rd-damage-result[\s\S]*display:\s*block/);
  assert.match(css, /\.dx3rd-attack-card \.dx3rd-card-buttons[\s\S]*display:\s*flex/);
  const cardBlock = css.slice(css.indexOf('.dx3rd-attack-card {'), css.indexOf('.dx3rd-item-chat .item-header'));
  assert.doesNotMatch(cardBlock, /border-left\s*:/,
    '공격 카드 자체가 사용자 색상처럼 보이는 임의의 좌측 강조선을 추가하면 안 된다');
  assert.match(cardBlock, /font-family:\s*inherit/);
  assert.match(cardBlock, /font-size:\s*inherit/,
    '공격 카드의 기본 글꼴 크기는 기존 DX3rd 채팅 메시지 설정을 상속해야 한다');
  assert.doesNotMatch(cardBlock, /font-size:\s*[0-9.]+rem/,
    '고정 rem 크기가 DX3rd 채팅 폰트 설정을 덮어쓰면 안 된다');
});

test('a fixed attack bonus survives alongside a dice attack formula', () => {
  // mergeAttackBonuses 는 고정치(attack)와 다이스식(attackFormula)을 **따로** 담는다.
  // 옛 `attackFormula || attack` 은 둘 다 있을 때 고정분을 통째로 버렸다 —
  // 「공격력 +2 이펙트 + 2d10 무기」 콤보에서 +2 가 조용히 사라졌다.
  const context = baseContext({
    game: { i18n: { localize: key => key }, settings: { get: () => '' }, user: { targets: new Set() } },
    ui: { notifications: { warn: () => {}, error: () => {}, info: () => {} } },
    Hooks: { on: () => {}, once: () => {} },
    CONFIG: {},
    foundry: { utils: {} }
  });
  load(context, 'scripts/handlers/universal-handler.js');
  const join = context.DX3rdUniversalHandler.joinFormulaTerms;

  assert.equal(join(5, '2d10'), '5 + 2d10', '고정치와 다이스식은 둘 다 실려야 한다');
  assert.equal(join(0, '2d10'), '2d10');
  assert.equal(join(5, ''), '5');
  assert.equal(join(0, ''), '0', '전부 비면 Roll 이 먹는 "0" 이어야 한다');
  assert.equal(join(-3, '1d10'), '-3 + 1d10', '음수 고정치는 뺄셈 항으로 이어져야 한다');

  // 두 발현 경로가 같은 함수를 써야 한 쪽만 항이 빠지는 자리가 다시 생기지 않는다.
  for (const path of ['scripts/handlers/universal-roll-dialog.js', 'scripts/handlers/combo-handler.js']) {
    const text = source(path).replace(/\s+/g, ' ');
    assert.match(text, /joinFormulaTerms\(\s*(effectiveWeaponBonus|attackBonus\?)\.attack,\s*(effectiveWeaponBonus|attackBonus\?)\.attackFormula\)/,
      `${path}: 공격력 고정치와 다이스식을 함께 이어야 한다`);
    assert.doesNotMatch(text, /\.attackFormula \|\| String\(/,
      `${path}: 둘 중 하나만 고르면 나머지 성분이 사라진다`);
  }
});

test('the enemy achievement path does not re-add the actor attack folded into the sheet total', () => {
  // 콤보의 system.attack.value 는 시트 표시용 **총합**이다(combo-data.calculateSubmittedAttack:
  // 액터 공격력 + 무기 + 이펙트). 데미지 기본치는 preservedValues.actorAttack 을 따로 더하므로,
  // 이 값을 무기 성분으로 다시 실으면 액터 공격력이 두 번 세어진다.
  const combo = source('scripts/handlers/combo-handler.js');
  const body = combo.slice(combo.indexOf('async createAttackMessageWithAchievement'));
  assert.doesNotMatch(body, /system\?\.attack\?\.value/,
    '에너미 달성치 경로가 시트 표시 총합을 무기 공격력으로 재사용하면 안 된다');
  assert.match(body.replace(/\s+/g, ' '), /preservedItemAttackFormula = handler\.joinFormulaTerms\( ?attackBonus\?\.attack, attackBonus\?\.attackFormula\)/,
    'PC 경로(executeStatRoll)와 같은 성분 — 무기·이펙트 보너스 — 만 실어야 한다');
  assert.match(body, /actorAttack: bonuses\.actorAttack/, '액터 공격력은 여전히 한 번은 실려야 한다');

  // 시트의 그 칸은 표시 전용이므로 손으로 넣은 값을 잃을 걱정이 없다.
  assert.match(source('templates/item/combo-sheet-v2.html'),
    /value="\{\{system\.attack\.value\}\}" disabled/,
    '콤보 공격력 칸이 편집 가능해지면 이 전제를 다시 봐야 한다');
});

test('a combo preview does not count activation buckets its members never fire', () => {
  // 구성 멤버의 활성화 버킷은 콤보로 켜지지 않는다(combo-handler.memberSelfModifiersFireAt).
  // 미리보기가 그 행까지 더하면 시트 판정치만 높고 실제 굴림에는 안 들어간다.
  const context = baseContext({
    game: { i18n: { localize: key => key } },
    ui: { notifications: { warn: () => {} } },
    CONFIG: { statusEffects: [] },
    Hooks: { once: () => {}, on: () => {} },
    foundry: { utils: { deepClone: value => structuredClone(value), getProperty: () => undefined } }
  });
  load(context, 'scripts/item-effect-adapter.js');
  load(context, 'scripts/handlers/combo-handler.js');
  load(context, 'scripts/sheets/combo-data.js');
  context.DX3rdFormulaEvaluator = { evaluate: value => Number(value) || 0 };

  const member = (id, attributes, active) => ({ id, type: 'effect', system: { timing: 'major', attributes, active } });
  const activationOnly = member('act', { a0: { key: 'add', value: '2' } },
    { state: false, disable: 'major', runTiming: 'instant', applyMode: 'toggle', action: 'activation' });
  const onUse = member('use', { a0: { key: 'add', value: '3' } },
    { state: false, disable: 'major', runTiming: 'instant', applyMode: 'onUse', action: '' });
  const onAttack = member('attack', { a0: { key: 'add', value: '4' } },
    { state: false, disable: 'major', runTiming: 'instant', applyMode: 'onUse', action: 'attack' });

  const actor = {
    items: new Map([[activationOnly.id, activationOnly], [onUse.id, onUse], [onAttack.id, onAttack]]),
    effects: []
  };
  actor.items[Symbol.iterator] = function* () { yield* this.values(); };

  const rollContext = { rollType: 'major', isAbility: false, skillKey: 'melee', effectiveBaseKey: 'body' };
  const preview = ids => context.DX3rdComboData
    .calculateRegisteredEffectRollBonus(actor, ids, rollContext, 10).add;
  const fires = item => context.DX3rdComboHandler
    .memberSelfModifiersFireAt(item, context.DX3rdItemEffectAdapter.invocationAction(item), 'instant');

  assert.equal(fires(onUse), true, '전제 확인 — 사용 버킷은 콤보로 발현한다');
  assert.equal(fires(activationOnly), false, '전제 확인 — 활성화 버킷은 콤보로 발현하지 않는다');
  assert.equal(preview(['use']), 3, '발현하는 보정은 그대로 세야 한다');
  assert.equal(preview(['act']), 0, '발현하지 않는 활성화 버킷을 미리보기가 더하면 안 된다');
  assert.equal(preview(['act', 'use']), 3, '섞여 있어도 발현분만 센다');
  assert.equal(context.DX3rdComboData
    .calculateRegisteredEffectRollBonus(actor, ['attack'], rollContext, 10, 'attack').add, 4,
  '명시한 공격 버킷은 공격 콤보의 미리보기와 런타임에서 함께 발현해야 한다');
});

test('a combo preview never counts the target channel against the caster', () => {
  // system.effect.attributes 는 **대상**에게 걸리는 채널이다(universal-apply.applyToTargets 는
  // game.user.targets / 씬 토큰 / forcedTargets 에만 걸고 시전자를 절대 포함하지 않는다).
  // 미리보기가 이것을 자기 판정에 더하면 「대상 다이스 -N」 디버프는 내 콤보 판정만 깎고
  // 「대상 공격력 +N」 타인 버프는 내 공격력을 부풀린다(팩 실측 157건이 이 키를 들고 있다).
  const context = baseContext({
    game: { i18n: { localize: key => key } },
    ui: { notifications: { warn: () => {} } },
    CONFIG: { statusEffects: [] },
    Hooks: { once: () => {}, on: () => {} },
    foundry: { utils: { deepClone: value => structuredClone(value), getProperty: () => undefined } }
  });
  load(context, 'scripts/item-effect-adapter.js');
  load(context, 'scripts/sheets/combo-data.js');
  context.DX3rdFormulaEvaluator = { evaluate: value => Number(value) || 0 };

  const member = (id, system) => ({ id, type: 'effect', system: { timing: 'major', active: {}, ...system } });
  const selfRow = member('self', { attributes: { a0: { key: 'add', value: '3' } } });
  const targetRow = member('tgt', {
    getTarget: true,
    attributes: {},
    effect: { attributes: { a0: { key: 'add', value: '3' } }, action: '', runTiming: 'instant' }
  });

  const actor = { items: new Map([[selfRow.id, selfRow], [targetRow.id, targetRow]]), effects: [] };
  actor.items[Symbol.iterator] = function* () { yield* this.values(); };

  const rollContext = { rollType: 'major', isAbility: false, skillKey: 'melee', effectiveBaseKey: 'body' };
  const preview = ids => context.DX3rdComboData
    .calculateRegisteredEffectRollBonus(actor, ids, rollContext, 10).add;

  assert.equal(preview(['self']), 3, '전제 확인 — 자기 채널은 그대로 세야 한다');
  assert.equal(preview(['tgt']), 0, '대상 채널을 시전자 미리보기에 더하면 안 된다');
  assert.equal(preview(['self', 'tgt']), 3, '섞여 있어도 자기 채널만 센다');

  assert.doesNotMatch(source('scripts/sheets/combo-data.js'), /effect\?\.attributes/,
    '미리보기 계산이 대상 채널을 다시 읽으면 안 된다');
});

test('a vehicle registered in the weapon slot still carries its attack into the roll', () => {
  // 무기 슬롯 드롭다운(helpers.js)과 공격 무기 선택 창(weapon-for-attack-dialog)은 비클을
  // 정당한 등재 대상으로 싣는데 calculateRegisteredWeaponBonus 두 벌만 걸러 냈다. 그러면
  // 비클만 등록한 콤보는 weaponIds 가 비어 hasAvailableWeapons 가 false 가 되고, 무기 경로가
  // 통째로 건너뛰어져 비클 공격력이 판정에도 데미지 버튼에도 실리지 않는다.
  // 비클은 공격력만 쓴다 — add 도 attack-used 도 없다(선택 창의 분기와 같은 규칙).
  const context = baseContext({
    game: { i18n: { localize: key => key }, settings: { get: () => '' }, user: { targets: new Set() } },
    ui: { notifications: { warn: () => {}, error: () => {}, info: () => {} } },
    Hooks: { on: () => {}, once: () => {} },
    CONFIG: { statusEffects: [] },
    foundry: { utils: { deepClone: value => structuredClone(value), getProperty: () => undefined } }
  });
  load(context, 'scripts/item-effect-adapter.js');
  load(context, 'scripts/handlers/universal-handler.js');
  // 콤보 쪽 무기 보너스는 구성원 열거(comboMemberItems)를 거쳐 복수무기 규칙을 읽으므로
  // 믹스인까지 실어야 실제 경로가 돈다.
  load(context, 'scripts/handlers/universal-extensions.js');
  load(context, 'scripts/handlers/combo-handler.js');
  context.DX3rdFormulaEvaluator = {
    evaluate: value => Number(String(value ?? '0').replace('+', '')) || 0,
    prepareRollFormula: value => String(value ?? '0'),
    hasDice: value => /d\d/.test(String(value ?? ''))
  };

  const vehicle = { id: 'v1', name: '비클', type: 'vehicle', system: { attack: '7', add: '99' } };
  context.DX3rdResolveWeapon = (_actor, id) => (id === 'v1' ? vehicle : null);
  const actor = { items: new Map(), effects: [] };
  actor.items[Symbol.iterator] = function* () { yield* this.values(); };
  const combo = { system: { weapon: ['v1'], effectIds: [] } };

  for (const [label, handler] of [
    ['universal', context.DX3rdUniversalHandler],
    ['combo', context.DX3rdComboHandler]
  ]) {
    const bonus = handler.calculateRegisteredWeaponBonus(actor, combo);
    // vm 컨텍스트의 배열은 교차 realm 이라 deepEqual 이 거부한다 — 전개해서 비교한다.
    assert.deepEqual([...bonus.weaponIds], ['v1'], `${label}: 비클도 무기 경로를 열어야 한다`);
    assert.equal(bonus.attack, 7, `${label}: 비클 공격력이 실려야 한다`);
    assert.equal(bonus.add, 0, `${label}: 비클에는 데미지 수정치가 없다`);
  }

  // attack-used 를 올리는 쪽은 여전히 weapon 타입만이어야 한다(비클에는 그 필드가 없다).
  assert.match(source('scripts/chat/chat-ui.js').replace(/\s+/g, ' '),
    /if \(!weaponItem \|\| weaponItem\.type !== 'weapon'\) continue;/,
    '무기 ID 목록에 비클이 섞여도 attack-used 증가는 무기에만 걸려야 한다');
});

test('damage rerolls spend registered weapon attack counts only once per attack card', () => {
  const chat = source('scripts/chat/chat-ui.js').replace(/\s+/g, ' ');
  assert.ok(chat.includes("message.getFlag('dx3rd-emanim', 'weaponAttackUseSpent') === true"),
    '재굴림은 채팅 메시지에 남은 최초 소비 기록을 확인해야 한다');
  assert.ok(chat.includes("await message.setFlag('dx3rd-emanim', 'weaponAttackUseSpent', true)"),
    '최초 데미지 굴림은 카드가 교체돼도 남는 소비 기록을 저장해야 한다');
  assert.ok(chat.includes('await dx3rdSpendWeaponAttacksOnce(message, actor, weaponIdsJson);'),
    '데미지 버튼은 매번 무기를 직접 증가시키지 말고 1회 소비 경로를 거쳐야 한다');
  assert.equal((chat.match(/'system\.attack-used\.state': \(attackUsed\.state \|\| 0\) \+ 1/g) || []).length, 1,
    '채팅 데미지 경로의 attack-used 증가는 1회 소비 함수 안에만 있어야 한다');
});

test('attack rerolls preserve the attack card spend marker and skip enemy shortcut weapon spend', () => {
  const chat = source('scripts/chat/chat-ui.js').replace(/\s+/g, ' ');
  const combo = source('scripts/handlers/combo-handler.js').replace(/\s+/g, ' ');

  assert.ok(chat.includes("actor.id, item.id, item.type, undefined, undefined, { reroll: true, sourceMessage: message }"),
    '콤보 공격 재굴림은 원래 공격 카드와 재굴림 문맥을 사용 파이프라인에 넘겨야 한다');
  assert.ok(combo.includes("skipWeaponAttackSpend: options.reroll === true"),
    '에너미 고정 달성치 콤보도 공격 재굴림이면 무기 횟수 선차감을 건너뛰어야 한다');
  assert.equal((combo.match(/options\.sourceMessage \|\| null/g) || []).length, 3,
    '일반·무기 보너스·고정 달성치 콤보가 모두 원래 공격 카드를 재사용해야 한다');
  assert.ok(combo.includes('attackMessage = sourceMessage'),
    '고정 달성치 경로도 새 카드가 아니라 원래 카드를 갱신해야 한다');
});

test('adding a vehicle turns a blank combo into a configured attack combo', async () => {
  const getProperty = (object, path) => path.split('.').reduce((value, key) => value?.[key], object);
  const context = baseContext({
    game: { i18n: { localize: key => key } },
    ui: { notifications: { warn: () => {} } },
    Hooks: { once: () => {}, on: () => {} },
    foundry: { utils: { getProperty } }
  });
  load(context, 'scripts/sheets/combo-data.js');

  const vehicle = { id: 'v1', type: 'vehicle', system: { skill: 'drive:car', attack: '7' } };
  context.DX3rdResolveWeapon = (_actor, id) => id === vehicle.id ? vehicle : null;
  const actor = {
    system: { attributes: { attack: { value: 2, melee: 3 }, skills: { 'drive:car': { base: 'body' } } } },
    items: new Map()
  };
  let written = null;
  const combo = {
    system: {
      weapon: ['v1'], effectIds: [], skill: '-', base: '-', roll: '-', attackRoll: '-',
      attack: { value: '-' }
    },
    update: async updates => { written = updates; }
  };

  assert.equal(await context.DX3rdComboData.applyWeaponAutoAttack(combo, actor, 'v1'), true);
  assert.equal(written['system.skill'], 'drive:car');
  assert.equal(written['system.base'], 'body');
  assert.equal(written['system.attackRoll'], 'melee');
  assert.equal(written['system.roll'], 'major');
  assert.equal(written['system.attack.value'], 12, 'actor 2 + melee 3 + vehicle 7');
});

test('removing the last combo source clears inherited fields', async () => {
  const getProperty = (object, path) => path.split('.').reduce((value, key) => value?.[key], object);
  const context = baseContext({
    game: { i18n: { localize: key => key } },
    ui: { notifications: { warn: () => {} } },
    Hooks: { once: () => {}, on: () => {} },
    foundry: { utils: { getProperty } }
  });
  load(context, 'scripts/sheets/combo-data.js');

  const effect = { id: 'e1', type: 'effect', system: { timing: 'major', skill: 'melee', attackRoll: 'melee' } };
  const actor = { system: { attributes: { attack: {}, skills: { melee: { base: 'body' } } } }, items: new Map([[effect.id, effect]]) };
  const staleSystem = () => ({
    effectIds: ['e1'], weapon: [], skill: 'melee', base: 'body', roll: 'major', difficulty: '대결',
    timing: 'major', range: '시야', target: '1체', attackRoll: 'melee', attack: { value: 9 }
  });

  let effectRemoval = null;
  const effectCombo = { system: staleSystem(), update: async updates => { effectRemoval = updates; } };
  await context.DX3rdComboData.removeRegisteredEffect(effectCombo, actor, 'e1');

  for (const [path, expected] of Object.entries({
    'system.skill': '-', 'system.base': '-', 'system.roll': '-', 'system.difficulty': '',
    'system.timing': '-', 'system.range': '', 'system.target': '-', 'system.attackRoll': '-',
    'system.attack.value': '-'
  })) assert.equal(effectRemoval[path], expected, `last effect: ${path}`);

  let weaponRemoval = null;
  const weaponCombo = { system: { ...staleSystem(), effectIds: [], weapon: [] }, update: async updates => { weaponRemoval = updates; } };
  await context.DX3rdComboData.applyWeaponRemoved(weaponCombo, actor);
  assert.equal(weaponRemoval['system.skill'], '-');
  assert.equal(weaponRemoval['system.attackRoll'], '-');
  assert.equal(weaponRemoval['system.attack.value'], '-');
});

test('removing the last effect keeps a vehicle attack but drops effect-only metadata', async () => {
  const getProperty = (object, path) => path.split('.').reduce((value, key) => value?.[key], object);
  const context = baseContext({
    game: { i18n: { localize: key => key } },
    ui: { notifications: { warn: () => {} } },
    Hooks: { once: () => {}, on: () => {} },
    foundry: { utils: { getProperty } }
  });
  load(context, 'scripts/sheets/combo-data.js');

  const effect = {
    id: 'e1', type: 'effect',
    system: { timing: 'reaction', roll: 'dodge', difficulty: '대결', range: '시야', target: '범위', skill: 'dodge' }
  };
  const vehicle = { id: 'v1', type: 'vehicle', system: { skill: 'drive:car', attack: '7' } };
  context.DX3rdResolveWeapon = (_actor, id) => id === vehicle.id ? vehicle : null;
  const actor = {
    system: { attributes: { attack: { value: 0, melee: 0 }, skills: { 'drive:car': { base: 'body' } } } },
    items: new Map([[effect.id, effect]])
  };
  let written = null;
  const combo = {
    system: {
      effectIds: ['e1'], weapon: ['v1'], timing: 'reaction', roll: 'dodge', difficulty: '대결',
      range: '시야', target: '범위', skill: 'dodge', base: 'body', attackRoll: '-', attack: { value: '-' }
    },
    update: async updates => { written = updates; }
  };

  await context.DX3rdComboData.removeRegisteredEffect(combo, actor, 'e1');
  assert.equal(written['system.skill'], 'drive:car');
  assert.equal(written['system.attackRoll'], 'melee');
  assert.equal(written['system.attack.value'], 7);
  assert.equal(written['system.timing'], 'major');
  assert.equal(written['system.roll'], 'major');
  assert.equal(written['system.difficulty'], '');
  assert.equal(written['system.range'], '');
  assert.equal(written['system.target'], '-');
});

test('removing a weapon clears its attack fields while retaining a non-attack effect', async () => {
  const getProperty = (object, path) => path.split('.').reduce((value, key) => value?.[key], object);
  const context = baseContext({
    game: { i18n: { localize: key => key } },
    ui: { notifications: { warn: () => {} } },
    Hooks: { once: () => {}, on: () => {} },
    foundry: { utils: { getProperty } }
  });
  load(context, 'scripts/sheets/combo-data.js');

  const effect = { id: 'e1', type: 'effect', system: { timing: 'major', skill: 'negotiation', attackRoll: '-' } };
  const weapon = { id: 'w1', type: 'weapon', system: { type: 'melee', skill: 'melee', attack: 8 } };
  context.DX3rdResolveWeapon = (_actor, id) => id === weapon.id ? weapon : null;
  const actor = {
    system: { attributes: { attack: { value: 0, melee: 0 }, skills: { negotiation: { base: 'social' } } } },
    items: new Map([[effect.id, effect]])
  };
  let written = null;
  const combo = {
    // WeaponTabManager has already removed w1 from this array before invoking the hook.
    system: {
      effectIds: ['e1'], weapon: [], skill: 'melee', base: 'body', roll: 'major',
      attackRoll: 'melee', attack: { value: 8 }
    },
    update: async updates => { written = updates; }
  };

  await context.DX3rdComboData.applyWeaponRemoved(combo, actor, 'w1');
  assert.equal(written['system.skill'], 'negotiation');
  assert.equal(written['system.base'], 'social');
  assert.equal(written['system.attackRoll'], '-');
  assert.equal(written['system.attack.value'], '-');
});

test('combat deletion elects one GM and cleans both active-scene actors and combatants', () => {
  const combat = source('scripts/combat/combat.js');
  const collector = combat.slice(combat.indexOf('function collectCombatActors'), combat.indexOf('async function resetRoundActorStates'));
  const deletion = combat.slice(combat.indexOf("Hooks.on('deleteCombat'"), combat.indexOf('// An updateActor hook'));

  assert.match(collector, /game\.scenes\.active\?\.tokens/);
  assert.match(collector, /combat\?\.combatants/);
  assert.match(deletion, /DX3rdSocketRouter/);
  assert.match(deletion, /isResponsibleGM\(\)/);
  assert.match(deletion, /collectCombatActors\(combat\)/);
  assert.match(deletion, /collectCombatActors\(combat, \{combatantsOnly: true\}\)/);
});

test('reviveSelf clears the registered dead status id before healing', async () => {
  const context = baseContext({
    game: { i18n: { localize: key => key }, settings: { get: () => '' }, user: { targets: new Set() } },
    ui: { notifications: { warn: () => {}, error: () => {}, info: () => {} } },
    Hooks: { on: () => {}, once: () => {} },
    CONFIG: {},
    foundry: { utils: {} }
  });
  load(context, 'scripts/handlers/universal-handler.js');

  const toggles = [];
  let update = null;
  const actor = {
    effects: [{ statuses: new Set(['dead']) }],
    system: { attributes: { hp: { value: 0, max: 20 }, encroachment: { value: 10 } } },
    toggleStatusEffect: async (id, options) => toggles.push([id, options.active]),
    update: async value => { update = value; }
  };

  assert.equal(await context.DX3rdUniversalHandler.reviveSelf(actor, { hpTo: 5 }), true);
  assert.deepEqual(toggles, [['dead', false]]);
  assert.equal(update['system.attributes.hp.value'], 5);
});

test("a non-attack combo previews its members' own roll bonus, as the runtime applies it", () => {
  // combo-handler.calculateEffectAttackBonus 는 콤보의 attackRoll 을 보지 않는다 —
  // 구성 이펙트의 system.add 는 교섭/지각/리액션 콤보에서도 판정 다이얼로그의
  // effectiveStat.add 로 들어간다. 미리보기만 공격 콤보로 막혀 있어서 시트 수정치가
  // 늘 실제 굴림보다 낮았다(라이브 실측: 미리보기 0 / 실제 +6).
  // 반대로 무기 수정치는 런타임이 `!weaponSelect && attackRoll !== '-'` 에서만 걷으므로
  // 공격 콤보 전용이 맞다. 고정분과 다이스분이 같은 게이트에 있어야 한다.
  const context = baseContext({
    game: { i18n: { localize: key => key } },
    ui: { notifications: { warn: () => {} } },
    CONFIG: { statusEffects: [] },
    Hooks: { once: () => {}, on: () => {} },
    foundry: { utils: { deepClone: value => structuredClone(value), getProperty: () => undefined } }
  });
  load(context, 'scripts/item-effect-adapter.js');
  load(context, 'scripts/sheets/combo-data.js');
  context.DX3rdFormulaEvaluator = {
    evaluate: value => Number(String(value ?? '0').replace('+', '')) || 0,
    prepareRollFormula: value => String(value ?? '0'),
    hasDice: value => /d\d/.test(String(value ?? ''))
  };

  const effect = {
    id: 'e1', type: 'effect',
    system: { timing: 'major', roll: '-', attackRoll: '-', skill: 'negotiation', add: '+6', attack: '0', active: {} }
  };
  const weapon = { id: 'w1', type: 'weapon', system: { type: 'melee', attack: '0', add: '+2' } };
  context.DX3rdResolveWeapon = (_actor, id) => (id === 'w1' ? weapon : null);

  const actor = {
    system: {
      attributes: {
        social: { dice: 3, add: 0, critical: 10, major: { dice: 3, add: 0, critical: 10 } },
        skills: { negotiation: { base: 'social', dice: 3, add: 0 } },
        critical: { min: 2 }
      }
    },
    items: new Map([[effect.id, effect]]),
    effects: []
  };
  actor.items[Symbol.iterator] = function* () { yield* this.values(); };

  const summarize = attackRoll => {
    const data = { system: { skill: 'negotiation', base: 'social', roll: 'major', effectIds: ['e1'], attackRoll } };
    const item = { system: { attackRoll, weapon: ['w1'], active: {} } };
    context.DX3rdComboData.prepareRollSummary(data, item, actor, true);
    return data.system.add.value;
  };

  assert.equal(summarize('-'), '6', '비공격 콤보도 구성 이펙트의 수정치를 세야 한다');
  assert.equal(summarize('melee'), '8', '공격 콤보는 이펙트 6 + 무기 2');
});

test("an effect's own roll bonus reads the same alone as it does inside a combo", () => {
  // 콤보는 includeComboModifiers 로 읽는데 단독 사용만 그 플래그가 없어서, attackRoll 없는
  // 판정 이펙트의 system.add 가 콤보에서만 걸렸다. 두 호출이 같은 기준을 써야 한다.
  const context = baseContext({
    game: { i18n: { localize: key => key } },
    ui: { notifications: { warn: () => {} } },
    CONFIG: { statusEffects: [] },
    Hooks: { once: () => {}, on: () => {} },
    foundry: { utils: { deepClone: value => structuredClone(value), getProperty: () => undefined } }
  });
  load(context, 'scripts/item-effect-adapter.js');
  context.DX3rdFormulaEvaluator = {
    evaluate: value => Number(String(value ?? '0').replace('+', '')) || 0,
    prepareRollFormula: value => String(value ?? '0'),
    hasDice: value => /d\d/.test(String(value ?? ''))
  };
  const adapter = context.DX3rdItemEffectAdapter;
  const judgeOnly = { name: '조합 수정치', type: 'effect', system: { attackRoll: '-', add: '+6', attack: '0' } };
  assert.equal(adapter.effectAttackBonus(judgeOnly, null, { includeComboModifiers: true })?.add, 6,
    '전제 확인 — 콤보 기준으로는 읽힌다');

  assert.match(source('scripts/handlers/effect-handler.js').replace(/\s+/g, ' '),
    /effectAttackBonus\?\.\(item, actor, \{includeComboModifiers: true\}\)/,
    '단독 사용도 콤보와 같은 기준으로 읽어야 한다');
});

test('an effect rolls only when its difficulty names something to roll against', async () => {
  // 난이도는 목표치가 적히는 칸이고, 그중 두 값은 「굴릴 것이 없다」는 뜻이다 —
  // 자동성공(굴리지 않고 성공)과 '-'/빈칸(목표치 미저작). 기능 미지정도 같다(굴릴 능력치가 없다).
  // 그 셋은 판정 없이 그냥 사용되어야 한다. 반대로 대결·숫자·효과참조는 굴린다.
  // 공격 이펙트(attackRoll)만 예외 — 명중 굴림이 데미지 단계를 만드는 유일한 통로라
  // 난이도가 비어 있어도(월드 실측 14건) 굴려야 한다.
  const context = baseContext({
    game: {
      i18n: { localize: key => key, format: key => key },
      actors: new Map(),
      items: new Map(),
      settings: { get: () => 10 },
      user: { targets: new Set() }
    },
    ui: { notifications: { warn: () => {}, error: () => {}, info: () => {} } },
    Hooks: { once: () => {}, on: () => {} }
  });
  load(context, 'scripts/combo-range-target.js');
  load(context, 'scripts/item-effect-adapter.js');
  load(context, 'scripts/handlers/universal-handler.js');
  load(context, 'scripts/handlers/effect-handler.js');

  let rolled = null;
  context.DX3rdUniversalHandler.showStatRollDialog = (_actor, stat, label, rollType) => {
    rolled = { stat, label, rollType };
  };
  context.DX3rdUniversalHandler.resolveStatAndLabel = () => ({ stat: { value: 5 }, label: '기능' });
  context.DX3rdUniversalHandler.calculateRegisteredWeaponBonus = () => ({ weaponIds: [] });

  const actor = { id: 'caster', name: '시전자', items: new Map(), system: { attributes: {} } };
  context.game.actors.set(actor.id, actor);

  const use = async (system) => {
    const item = { id: 'e1', name: '이펙트', type: 'effect', system, getFlag: () => undefined };
    actor.items.set(item.id, item);
    rolled = null;
    await context.DX3rdEffectHandler.handle(actor.id, item.id, undefined, {});
    return rolled;
  };

  const base = { skill: 'melee', roll: 'major', attackRoll: '-', timing: 'major' };
  assert.equal(await use({ ...base, difficulty: '자동성공' }), null, '자동성공: 굴리지 않는다');
  assert.equal(await use({ ...base, difficulty: '-' }), null, "'-': 굴리지 않는다");
  assert.equal(await use({ ...base, difficulty: '' }), null, '빈칸: 굴리지 않는다');
  assert.equal(await use({ ...base, skill: '-', difficulty: '자동성공' }), null,
    '기능도 난이도도 굴릴 것을 말하지 않으면 굴리지 않는다');

  assert.ok(await use({ ...base, difficulty: '대결' }), '대결: 굴린다');
  assert.ok(await use({ ...base, difficulty: '12' }), '숫자: 굴린다');
  assert.ok(await use({ ...base, difficulty: '효과참조' }), '효과참조: 굴린다');
  assert.ok(await use({ ...base, attackRoll: 'melee', difficulty: '' }),
    '공격 이펙트는 난이도가 비어도 명중을 굴린다');

  // 「기능 -, 난이도 대결」은 실제로 저작되는 형태다(월드 실측 1건). 굴릴 능력치를 대지 않았을 뿐
  // 굴린다는 말은 하고 있으므로, 빈 다이스 풀로 창을 열어 사용자가 채운다.
  const blank = await use({ ...base, skill: '-', difficulty: '대결' });
  assert.ok(blank, '기능이 없어도 난이도가 대결이면 굴린다');
  assert.equal(blank.label, '-', '댈 기능이 없다는 것을 라벨이 숨기지 않는다');
  assert.equal(blank.stat.dice, 0, '빈 풀로 열린다');

  // 끄는 방향만이다 — 난이도가 대결이어도 판정 토글이 '-' 인 이펙트는 그대로 굴리지 않는다.
  // (컴펜디움 348건이 그 형태이고, 그 대결은 조합될 콤보의 것이지 멤버 단독 사용의 것이 아니다.)
  assert.equal(await use({ ...base, roll: '-', difficulty: '대결' }), null,
    '난이도만으로 판정이 새로 생기면 안 된다');
});

test('an item whose 대상 is 자신 targets the caster instead of blocking on an empty target list', async () => {
  // 「대상: 자신」은 대상을 이미 지정한 것이다. 그런데도 T 를 직접 눌러야 게이트를 통과했고,
  // 누르지 않으면 사용 자체가 막혔다. 눌러 준 것으로 간주한다 — 이후 단계는 전부
  // game.user.targets 를 읽으므로 다른 코드가 이 사정을 알 필요가 없다.
  const context = baseContext({
    game: { i18n: { localize: key => key, format: key => key }, user: { targets: new Set() } },
    ui: { notifications: { warn: () => {}, error: () => {}, info: () => {} } },
    Hooks: { once: () => {}, on: () => {} }
  });
  load(context, 'scripts/combo-range-target.js');
  load(context, 'scripts/handlers/universal-handler.js');
  const handler = context.DX3rdUniversalHandler;

  assert.equal(handler.itemTargetsSelf({ system: { target: '자신' } }), true);
  assert.equal(handler.itemTargetsSelf({ system: { target: '단독' } }), false);
  assert.equal(handler.itemTargetsSelf({ system: { target: '' } }), false, '미저작을 자신으로 읽으면 안 된다');

  const token = { id: 'tok', name: '시전자 토큰' };
  token.setTarget = (targeted, { user, releaseOthers }) => {
    assert.equal(releaseOthers, true);
    if (targeted) user.targets.add(token);
  };
  const actor = { name: '시전자', getActiveTokens: () => [token] };
  const selfTargets = handler.autoTargetSelf(actor);
  assert.equal(selfTargets.length, 1);
  assert.equal(selfTargets[0].id, token.id, '시전자 자신의 토큰이 대상이 된다');

  // 캔버스에 토큰이 없으면 지어내지 않는다 — 호출부가 평소의 「대상을 지정하라」로 떨어진다.
  context.game.user.targets = new Set();
  assert.equal(handler.autoTargetSelf({ name: '토큰 없음', getActiveTokens: () => [] }).length, 0);

  // 자신이 대상이 될 수 없는 아이템(수동 지정 전용)은 이 자동 지정에서 제외된다.
  const gate = source('scripts/handlers/universal-handler.js').replace(/\s+/g, ' ');
  assert.match(gate, /if \(targets\.length === 0 && !manualTargetOtherOnly && this\.itemTargetsSelf\(item\)\)/);
});

test('every created item gets a marker, and an activation-bound one dies with the activation', async () => {
  // 생성물의 수명은 표식(AE)이 쥔다. 무기에만 표식을 달아 두어 방어구·비클은 회수할 주인이 없었고,
  // 「활성화」로 저작한 생성물은 활성화를 꺼도 남았다. 반대로 「사용」으로 만든 것은 그 아이템의 활성화
  // 상태와 무관한 자기 수명을 가지므로 함께 지워지면 안 된다.
  const context = baseContext({
    game: {
      i18n: { localize: key => key, format: key => key },
      macros: { getName: () => null },
      user: { id: 'u1', targets: new Set() },
      actors: new Map()
    },
    ui: { notifications: { warn: () => {}, error: () => {}, info: () => {} } },
    Hooks: { on: () => {}, once: () => {} },
    CONST: { ACTIVE_EFFECT_SHOW_ICON: { ALWAYS: 2 } },
    foundry: { utils: { deepClone: value => structuredClone(value), getProperty: () => undefined } }
  });
  load(context, 'scripts/item-effect-adapter.js');
  load(context, 'scripts/handlers/universal-handler.js');
  load(context, 'scripts/handlers/universal-extensions.js');
  const handler = context.DX3rdUniversalHandler;
  context.DX3rdFormulaEvaluator = { evaluate: value => Number(String(value).replace('+', '')) || 0, getItemLevel: () => 1 };
  handler.showEquipmentSelectionDialog = async () => ({ confirmed: true });

  const items = new Map();
  const effects = [];
  const actor = {
    id: 'a', name: 'actor', uuid: 'Actor.a', effects,
    get items() { return Object.assign(items, { filter: fn => [...items.values()].filter(fn) }); },
    async createEmbeddedDocuments(type, data) {
      if (type === 'Item') {
        const made = { id: `i${items.size + 1}`, ...data[0] };
        items.set(made.id, made);
        return [made];
      }
      const flags = data[0].flags || {};
      const made = {
        id: `ae${effects.length + 1}`, ...data[0], flags,
        getFlag(scope, key) { return this.flags[scope]?.[key]; },
        async setFlag(scope, key, value) { (this.flags[scope] ??= {})[key] = value; return this; },
        async unsetFlag(scope, key) { delete this.flags[scope]?.[key]; return this; }
      };
      effects.push(made);
      return [made];
    },
    async deleteEmbeddedDocuments(type, ids) {
      if (type === 'Item') ids.forEach(id => items.delete(id));
      else ids.forEach(id => {
        const at = effects.findIndex(effect => effect.id === id);
        if (at >= 0) effects.splice(at, 1);
      });
      return [];
    }
  };

  const source = action => ({
    id: 'src', name: '생성 이펙트', type: 'effect', img: '',
    system: { timing: 'major', attackRoll: '-', attributes: {}, active: { state: false, applyMode: 'onUse' } },
    getFlag: () => undefined,
    _action: action
  });
  const payload = action => ({ activate: true, action, name: '검', attack: '+3', type: 'melee', skill: 'melee', add: '+0', guard: '0', range: '지근', amount: '1' });

  // 방어구·비클도 표식을 받는다(예전엔 무기만이었다).
  await handler.createProtectItem(actor, payload('use'), source('use'));
  await handler.createVehicleItem(actor, payload('use'), source('use'));
  assert.equal(effects.length, 2, '방어구·비클 생성도 표식을 남긴다');

  // 「활성화」로 만든 것: 활성화를 끄면 표식이 지워지고, 훅이 생성물을 회수한다.
  effects.length = 0;
  items.clear();
  const activationItem = source('activation');
  await handler.createWeaponItems(actor, payload('activation'), activationItem);
  assert.equal(items.size, 1);
  assert.equal(context.DX3rdUniversalHandler.grantPayload(effects[0]).action, 'activation');
  const cleared = await handler.clearActivationGrants(actor, activationItem);
  assert.equal(cleared, 1, '활성화 생성물의 표식은 활성화가 꺼질 때 지워진다');

  // 「사용」으로 만든 것은 같은 아이템의 활성화가 꺼져도 남는다.
  effects.length = 0;
  items.clear();
  const useItem = source('use');
  await handler.createWeaponItems(actor, payload('use'), useItem);
  assert.equal(await handler.clearActivationGrants(actor, useItem), 0,
    '사용으로 만든 생성물은 활성화 상태와 무관하다');
  assert.equal(effects.length, 1, '표식이 남아 있어야 자기 수명대로 회수된다');

  // 회수는 한 곳뿐이다 — 표식 삭제 훅. 종류별 분기가 아니라 기록된 id 목록으로 지운다.
  await handler.revertItemGrant(actor, effects[0]);
  assert.equal(items.size, 0, '표식이 사라지면 그것이 만든 아이템도 사라진다');

  // 아이템에 이미 보정 AE 가 있으면 표식은 **그 문서에 얹힌다**. 따로 만들면 이름·이미지가 같은 AE 가
  // 둘 서서, 사용자가 지운 「그 효과」가 어느 쪽인지 알 수 없어진다(생성물이 남던 원인).
  effects.length = 0;
  items.clear();
  const hostItem = source('use');
  const appliedAe = {
    id: 'applied-ae', name: '생성 이펙트', img: '',
    flags: { 'dx3rd-emanim': { appliedKey: `applied_${hostItem.id}`, applied: { itemId: hostItem.id } } },
    getFlag(scope, key) { return this.flags[scope]?.[key]; },
    async setFlag(scope, key, value) { this.flags[scope][key] = value; return this; },
    async unsetFlag(scope, key) { delete this.flags[scope][key]; return this; }
  };
  effects.push(appliedAe);
  context.DX3rdAppliedEffects = { getEffectsByItem: () => [appliedAe] };
  await handler.createWeaponItems(actor, payload('use'), hostItem);
  assert.equal(effects.length, 1, '보정 AE 가 있으면 표식용 AE 를 따로 만들지 않는다');
  assert.equal(handler.grantPayload(appliedAe)?.kind, 'weapon', '표식은 그 보정 AE 가 들고 있다');

  // 만료·비활성화로 그 AE 가 사라질 때는 생성물을 함께 죽이지 않는다 — 수명이 다른 두 가지다.
  await handler.rehomeGrant(actor, appliedAe);
  assert.equal(handler.grantPayload(appliedAe), null, '표식은 그 문서를 떠난다');
  assert.equal(effects.length, 2, '떠난 표식은 자기 문서를 새로 가진다');
  assert.equal(items.size, 1, '재배치는 생성물을 건드리지 않는다');

  // 반대 순서도 한 문서로 모인다. 활성화 경로에서는 표식이 먼저 쓰이고 토글 AE 가 50ms 뒤에 생기므로,
  // 순서만으로는 보장할 수 없다 — 나중에 온 보정 AE 가 떠 있는 표식을 흡수한다.
  const orphan = effects.find(effect => handler.grantPayload(effect));
  assert.ok(orphan, '전제 확인 — 떠 있는 표식이 있다');
  assert.equal(await handler.adoptOrphanGrants(actor, appliedAe), true);
  assert.equal(handler.grantPayload(appliedAe)?.kind, 'weapon', '보정 AE 가 표식을 넘겨받는다');
  assert.equal(effects.includes(orphan), false, '떠 있던 표식 문서는 사라진다');
  assert.equal(items.size, 1, '흡수는 생성물을 건드리지 않는다');
});

test('an activation-bound card is switchable even when the item has no modifier rows', () => {
  // 「활성화 시 무기 생성」만 저작한 이펙트는 자기 보정 행이 없어 시트에 활성화 토글이 아예 없었다.
  // 그러면 active.state 를 올릴 방법이 없고, 그 상태 변화가 유일한 발화점인 활성화 라우터도 돌지 않는다 —
  // 카드에는 「활성화」라고 적혀 있는데 활성화할 수단이 없는 상태였다.
  const sheetData = source('scripts/sheets/actor-sheet-data.js').replace(/\s+/g, ' ');
  assert.match(sheetData, /if \(adapter\?\.hasActionEffects\?\.\(item, 'activation'\)\) return true;/);
  const beforeModifierGate = sheetData.indexOf("hasActionEffects?.(item, 'activation')");
  const modifierGate = sheetData.indexOf('if (!hasUsableEffectAttributes(item.system?.attributes)) return false;');
  assert.ok(beforeModifierGate > -1 && beforeModifierGate < modifierGate,
    '보정 행 유무 검사보다 먼저 통과해야 의미가 있다');

  // 끄는 쪽도 같은 라우터가 잡는다.
  const adapter = source('scripts/item-effect-adapter.js').replace(/\s+/g, ' ');
  assert.match(adapter, /if \(activeOff\) \{ try \{ await handler\.clearActivationGrants\?\.\(actor, item\); \}/);
});

test('the screen HUD clears a condition through its status effect, and asks first', () => {
  const hud = source('scripts/dx3rd-condition-hud.js').replace(/\s+/g, ' ');
  // 상태이상 해제는 상태 AE 를 끄는 한 통로뿐이다. system.conditions 를 직접 쓰면 condtions.js 의
  // 동기화 훅(다이얼로그·부수효과·채팅)을 건너뛰어 시트와 토큰 오버레이가 갈린다.
  assert.match(hud, /await actor\.toggleStatusEffect\(meta\.status, \{ active: false \}\)/);
  assert.doesNotMatch(hud, /actor\.update\([^)]*system\.conditions/,
    'HUD 가 액터의 conditions 를 직접 고치면 안 된다');
  // 아이콘이 사라지는 방향은 전부 확인을 받는다(상태이상 해제 · 표식 제거 · 보정 해제).
  assert.match(hud, /HudConditionClearConfirm[\s\S]{0,80}return;/);
  assert.match(hud, /HudGrantRemoveConfirm[\s\S]{0,80}return;/);
  assert.match(hud, /HudAppliedDisableConfirm[\s\S]{0,80}return;/);
  // 권한 없는 사용자가 남의 토큰 상태를 끄려다 콘솔 오류로 끝나지 않게 한다.
  assert.match(hud, /if \(!actor\.isOwner\) \{ ui\.notifications\.warn/);
});

test('attacking with equipment never spends what only its "on use" content would', async () => {
  // 장비에서 공격과 사용은 다른 일이다. 공격이 「사용 시」 카드를 실행하지 않는데(processItemExtensions 가
  // 액션으로 거른다) 사용 횟수만 빠져나가던 문제 — 면제 판정이 **보정 행만** 보고 있었기 때문이다.
  // 사용 버킷에 익스텐션이나 매크로만 저작한 장비가 거기서 빠져나갔다.
  const context = baseContext({
    game: {
      i18n: { localize: key => key, format: key => key },
      settings: { get: () => true },
      user: { targets: new Set() },
      actors: new Map()
    },
    ui: { notifications: { warn: () => {}, error: () => {}, info: () => {} } },
    Hooks: { on: () => {}, once: () => {} },
    foundry: { utils: { deepClone: value => structuredClone(value), getProperty: () => undefined } }
  });
  load(context, 'scripts/item-effect-adapter.js');
  load(context, 'scripts/handlers/universal-handler.js');
  load(context, 'scripts/declared-equipment.js');
  const handler = context.DX3rdUniversalHandler;

  const gear = (type, extra = {}) => ({
    id: 'g1', name: '장비', type, img: '',
    system: {
      equipment: true, type: 'melee', skill: 'melee', attack: '5', attackRoll: 'melee', timing: 'major',
      used: { state: 0, max: 3, disable: 'scene' }, 'attack-used': { state: 0, max: 0, disable: 'notCheck' },
      attributes: {}, active: { state: false, disable: 'scene', runTiming: 'instant', action: '', applyMode: 'toggle' },
      effect: { disable: 'notCheck', runTiming: 'instant', action: '', attributes: {} }, macros: [],
      ...(extra.system || {})
    },
    getFlag: (scope, key) => key === 'itemExtend' ? extra.ext : undefined
  });

  // 사용 버킷에 무엇이 들어 있든 — 보정 행이든 익스텐션이든 매크로든 — 공격은 그것을 소비하지 않는다.
  assert.equal(handler.attackDefersUsage(
    gear('weapon', { system: { attributes: { r: { key: 'add', label: '-', value: '+5', action: 'use' } } } })), true,
    '보정 행(문서화된 선언형)');
  assert.equal(handler.attackDefersUsage(
    gear('weapon', { ext: { heal: { activate: true, action: 'use', timing: 'instant', value: '10' } } })), true,
    '사용 익스텐션');
  assert.equal(handler.attackDefersUsage(
    gear('weapon', { system: { macros: [{ timing: 'instant', action: 'use', kind: 'code', command: '1' }] } })), true,
    '사용 매크로');

  // 사용 버킷이 없는 소모성 무기는 그대로 공격에서 소비한다.
  assert.equal(handler.attackDefersUsage(gear('weapon')), false, '카드가 없는 소모성 무기');
  assert.equal(handler.attackDefersUsage(
    gear('weapon', { ext: { damage: { activate: true, action: 'attack', timing: 'afterDamage', value: '5' } } })), false,
    '공격 카드만 있는 무기');

  // 장비 한정이다. 이펙트·콤보는 공격하는 것이 곧 사용이라, 넓히면 사용 카드를 하나 저작한 것만으로
  // 공격 이펙트가 침식률도 횟수도 내지 않게 된다.
  const attackEffect = gear('effect', { ext: { heal: { activate: true, action: 'use', timing: 'instant', value: '10' } } });
  delete attackEffect.system.equipment;
  assert.equal(handler.attackDefersUsage(attackEffect), false, '이펙트는 공격이 곧 사용이다');

  // 면제된 장비의 사용 카드가 영영 못 쓰이는 것은 아니다 — 시트의 사용 경로가 action:'use' 로 들어와
  // 거기서 비용과 횟수를 낸다(그 경로만 effectOnlyUse 로 공격 판정을 건너뛴다).
  const universal = source('scripts/handlers/universal-handler.js').replace(/\s+/g, ' ');
  assert.match(universal, /const declarationOnly = action === 'attack' && this\.attackDefersUsage\(item\);/);
  assert.match(universal, /const effectOnlyUse = action === 'use' && window\.DX3rdItemEffectAdapter\?\.isAttackItem\(item\);/);
});

test('an always-on self modifier is never switched off by a use that does not own its channel', async () => {
  // 상시 이펙트(컴펜디움 형태: timing='always', applyMode='onUse', disable='-')의 자기 채널은 **추론으로**
  // 활성화 채널이 된다. 그런데 「얼어붙는 채널의 잔재라면 내린다」는 가드가 *명시* 버킷만 물어봐서,
  // 그 상시 이펙트가 콤보 멤버로 실행되는 순간 active.state 가 내려갔다 — 소멸 타이밍이 없으니 다시 켜지지도
  // 않아, 가드 보정이 한 번 붙고 나면 영영 사라졌다.
  const context = baseContext({
    game: { i18n: { localize: key => key, format: key => key }, settings: { get: () => true },
      user: { targets: new Set() }, actors: new Map() },
    ui: { notifications: { warn: () => {}, error: () => {}, info: () => {} } },
    Hooks: { on: () => {}, once: () => {} },
    foundry: { utils: { deepClone: value => structuredClone(value), getProperty: () => undefined } }
  });
  load(context, 'scripts/item-effect-adapter.js');
  load(context, 'scripts/handlers/universal-handler.js');
  load(context, 'scripts/handlers/universal-apply.js');
  const handler = context.DX3rdUniversalHandler;
  const frozen = [];
  handler._applyItemAttributes = async (_actor, _item, _target, attrs) =>
    frozen.push(Object.values(attrs || {}).map(entry => entry.key));

  const make = active => {
    const item = {
      id: 'e1', name: '강인한 골격', type: 'effect',
      system: {
        timing: 'always', roll: '-', attackRoll: '-', skill: '-',
        attributes: { g: { key: 'guard', label: '-', value: '+[level]' } },
        active: { state: true, disable: '-', runTiming: 'instant', action: '', applyMode: 'onUse', ...active },
        effect: { disable: 'notCheck', runTiming: 'instant', action: '', attributes: {} }, macros: []
      },
      getFlag: () => undefined
    };
    item.update = async updates => {
      for (const [path, value] of Object.entries(updates)) {
        const parts = path.split('.');
        let node = item;
        for (const part of parts.slice(0, -1)) node = node[part];
        node[parts.at(-1)] = value;
      }
    };
    return item;
  };

  // 전제 확인 — 이 채널은 추론으로만 활성화다(명시 버킷은 없다).
  const always = make();
  assert.equal(context.DX3rdItemEffectAdapter.usesActivationSelfChannel(always), true);
  assert.equal(context.DX3rdItemEffectAdapter.hasExplicitBucket(always, 'self', 'activation'), false);

  // 콤보 멤버 실행(combo-handler 의 호출: forceToggle 없음) 이후에도 켜져 있어야 한다.
  await handler.applySelfModifiers({ id: 'a' }, always, { action: 'use' });
  assert.equal(always.system.active.state, true, '상시 채널을 남의 사용이 끄면 안 된다');

  // 반대쪽은 그대로다 — 진짜 얼어붙는 채널의 잔재 상태는 여전히 내려간다(이중 가산 방지).
  const frozenChannel = make();
  frozenChannel.system.timing = 'major';
  assert.equal(context.DX3rdItemEffectAdapter.usesActivationSelfChannel(frozenChannel), false, '전제 확인');
  await handler.applySelfModifiers({ id: 'a' }, frozenChannel, { action: 'use' });
  assert.equal(frozenChannel.system.active.state, false, '얼어붙는 채널의 잔재는 계속 내려간다');
});

test('the roll dialog only shows attack power when the roll can spend it', () => {
  // 공격력은 데미지 굴림에서만 소비된다(preservedValues 는 `if (isAttackRoll)` 안에서만 만든다).
  // 비공격 판정의 판정치 옆에 두면 이번 굴림에 적용되는 것처럼 읽힌다.
  const dialog = source('scripts/handlers/universal-roll-dialog.js').replace(/\s+/g, ' ');
  assert.match(dialog, /if \(isAttackRoll\) \{ bonusTerms\.push\(`\$\{game\.i18n\.localize\('DX3rd\.Attack'\)\}/,
    '공격력 항은 공격 판정에서만 보여야 한다');
  assert.match(dialog, /bonusTerms\.push\(`\$\{game\.i18n\.localize\('DX3rd\.Add'\)\}/,
    '수정치 항은 판정 종류와 무관하게 보여야 한다');
  // 고정치만 찍으면 공격력이 '2d10' 인 무기가 "공격 +0" 으로 보여 값이 없는 것과 구분되지 않는다.
  for (const field of ['attack', 'add']) {
    assert.match(dialog, new RegExp(`joinFormulaTerms\\(weaponBonus\\.${field}, weaponBonus\\.${field}Formula\\)`),
      `${field}: 안내 줄도 고정치와 다이스식을 함께 보여야 한다`);
  }
  assert.doesNotMatch(dialog, /attackSign|addSign/, '고정치만 찍던 옛 표기가 남으면 안 된다');
});

test('instant combo uses the neutral combo label and saves without its brackets', () => {
  assert.ok(source('scripts/handlers/universal-roll-dialog.js')
    .includes("name: `[${game.i18n.localize('DX3rd.Combo')}]`"),
    '임시 콤보 표시명은 [임시] 콤보가 아니라 [콤보]여야 한다');
  const sheet = source('scripts/sheets/combo-sheet-v2.js').replace(/\s+/g, ' ');
  assert.ok(sheet.includes('const instantLabel = `[${defaultName}]`;'));
  assert.ok(sheet.includes("this.item.name.replace(instantLabel, '').trim() || defaultName"),
    '저장할 때 [콤보] 표지가 실제 이름에 남으면 안 된다');
});

test('created weapon amount evaluates the source effect level formula', async () => {
  const context = baseContext({
    game: { i18n: { localize: () => '(임시)' } },
    Hooks: { on: () => {}, once: () => {} },
    CONST: { ACTIVE_EFFECT_SHOW_ICON: { ALWAYS: 2, NEVER: 0 } }
  });
  context.DX3rdUniversalHandler = {};
  context.DX3rdFormulaEvaluator = {
    getItemLevel: () => 2,
    evaluate: formula => formula === '[level]+1' ? 3 : Number(formula) || 0
  };
  load(context, 'scripts/handlers/universal-extensions.js');

  const created = [];
  const grants = [];
  const actor = {
    uuid: 'Actor.test',
    createEmbeddedDocuments: async (type, documents) => {
      // 생성물의 수명을 쥐는 표식 AE 는 무기와 같은 API 로 만들어지므로 따로 센다.
      (type === 'ActiveEffect' ? grants : created).push(...documents);
      return documents.map((d, i) => ({ ...d, id: `${type}-${i}` }));
    }
  };
  const result = await context.DX3rdUniversalHandler.createWeaponItems(actor, {
    name: '일본도', type: 'melee', skill: 'melee', add: '-1', attack: '5', guard: '3', range: '지근', amount: '[level]+1'
  }, { type: 'effect', img: 'sword.svg', system: { level: { value: 2 } } });

  assert.equal(created.length, 3);
  assert.equal(result.length, 3);
  assert.equal(created[0].name, '일본도(임시)');

  // 생성물의 수명은 표식 하나가 쥔다. 표식이 없으면 지울 방법이 사라지고, 무기마다
  // 하나씩 붙이면 한 장을 지웠을 때 나머지가 유령이 된다.
  assert.equal(grants.length, 1, '생성 무기 묶음마다 표식 AE 는 하나여야 한다');
  const payload = grants[0].flags['dx3rd-emanim'].itemGrant;
  assert.equal(payload.kind, 'weapon');
  assert.equal(payload.createdItemIds.length, 3, '표식이 자기가 만든 무기를 전부 알아야 지울 수 있다');
  // vm 컨텍스트의 배열은 다른 realm 이라 deepEqual 이 통하지 않는다 — 길이로 본다.
  assert.equal(grants[0].system.changes.length, 0,
    '표식은 계산에 관여하지 않는다 — changes 가 생기면 코어가 액터 데이터를 건드린다');
});

test('runtime number prompt clamps variable HP input to the configured maximum', async () => {
  let dialogConfig;
  const context = baseContext({
    foundry: {
      applications: { api: { DialogV2: { wait: async config => { dialogConfig = config; return config; } } } },
      utils: { escapeHTML: value => String(value) }
    },
    game: { i18n: { localize: key => key } },
    ui: { notifications: { error: () => {} } }
  });
  load(context, 'scripts/handlers/universal-dialogs.js');

  await context.DX3rdUniversalNumberPromptV2({
    title: '변동 소비', label: '소비 HP', defaultValue: 9, maxValue: 3
  });
  assert.match(dialogConfig.content, /value="3"/);
  assert.match(dialogConfig.content, /max="3"/);

  const confirm = dialogConfig.buttons.find(button => button.action === 'confirm');
  const result = confirm.callback(null, {
    form: { querySelector: () => ({ value: '99' }) }
  });
  assert.equal(result, 3);
});

test('socket router ignores a repeated requestId', async () => {
  let ready;
  let listener;
  const users = {
    activeGM: { id: 'gm', isGM: true, active: true },
    get: id => id === 'gm' ? users.activeGM : null,
    find: predicate => [users.activeGM].find(predicate)
  };
  const context = baseContext({
    Hooks: { once: (name, callback) => { if (name === 'ready') ready = callback; } },
    game: {
      user: users.activeGM,
      users,
      socket: {
        on: (_channel, callback) => { listener = callback; },
        emit: () => {}
      }
    }
  });
  load(context, 'scripts/core/runtime-utils.js');
  load(context, 'scripts/socket-router.js');
  let handled = 0;
  let typedHandled = 0;
  context.DX3rdSocketRouter.register(() => { handled++; });
  context.DX3rdSocketRouter.registerType('damageRequest', () => { typedHandled++; }, {
    responsibleGMOnly: true,
    validate: data => data.payload?.value === 3
  });
  ready();
  const envelope = vm.runInContext(`DX3rdRuntimeUtils.createSocketEnvelope({type:'damageRequest', requestId:'same', payload:{value:3}}, {senderId:'gm'})`, context);
  await listener(envelope);
  await listener(envelope);
  assert.equal(handled, 1);
  assert.equal(typedHandled, 1);
  assert.equal(context.DX3rdSocketRouter.canUserControlActor('gm', { testUserPermission: () => false }), true);
});

test('socket contracts reject legacy, unknown, forged-role, and non-owner mutations', async () => {
  const fixture = socketContext();
  const { context, users } = fixture;
  load(context, 'scripts/core/runtime-utils.js');
  load(context, 'scripts/socket-router.js');
  load(context, 'scripts/socket-contracts.js');
  let handled = 0;
  let genericHandled = 0;
  context.DX3rdSocketRouter.registerType('damageRequest', () => { handled++; }, { consume: true });
  context.DX3rdSocketRouter.register(() => { genericHandled++; });
  fixture.ready();

  const envelope = (type, senderId, extra = {}) => vm.runInContext(
    `DX3rdRuntimeUtils.createSocketEnvelope(${JSON.stringify({type, ...extra})}, {senderId:${JSON.stringify(senderId)}})`,
    context
  );
  await fixture.listener(envelope('damageRequest', users.player1.id, { requestData: { actorId: 'a1' } }));
  await fixture.listener(envelope('damageRequest', users.player2.id, { requestData: { actorId: 'a1' } }));
  await fixture.listener(vm.runInContext(`({type:'damageRequest', requestData:{actorId:'a1'}})`, context));
  await fixture.listener(envelope('unknownMutation', users.player1.id, { payload: {} }));
  await fixture.listener(envelope('showTurnActor', users.player1.id, { actorName: '위조', imgSrc: '' }));
  assert.equal(handled, 1);
  assert.equal(genericHandled, 0);
});

test('responsible GM selection is deterministic with multiple active GMs', () => {
  const fixture = socketContext();
  const { context, users } = fixture;
  load(context, 'scripts/core/runtime-utils.js');
  load(context, 'scripts/socket-router.js');
  assert.equal(context.DX3rdSocketRouter.getResponsibleGM().id, users.gm1.id);
  context.game.user = users.gm2;
  assert.equal(context.DX3rdSocketRouter.isResponsibleGM(), false);
  context.game.user = users.gm1;
  assert.equal(context.DX3rdSocketRouter.isResponsibleGM(), true);
});

test('actor-owned socket work elects one active owner with a responsible GM fallback', () => {
  const fixture = socketContext();
  const { context, users } = fixture;
  load(context, 'scripts/core/runtime-utils.js');
  load(context, 'scripts/socket-router.js');

  const shared = {
    id: 'shared',
    testUserPermission: user => user.id === users.player1.id || user.id === users.player2.id || user.isGM
  };
  users.player2.character = { id: shared.id };
  assert.equal(context.DX3rdSocketRouter.getResponsibleActorExecutor(shared).id, users.player2.id,
    '자기 캐릭터로 지정한 활성 OWNER를 공유 OWNER보다 우선해야 한다');

  users.player2.character = null;
  assert.equal(context.DX3rdSocketRouter.getResponsibleActorExecutor(shared).id, users.player1.id,
    '지정 캐릭터가 없으면 사용자 ID 순서로 한 OWNER만 선택해야 한다');
  users.player1.active = false;
  assert.equal(context.DX3rdSocketRouter.getResponsibleActorExecutor(shared).id, users.player2.id,
    '접속하지 않은 OWNER는 실행자로 뽑으면 안 된다');
  users.player2.active = false;
  assert.equal(context.DX3rdSocketRouter.getResponsibleActorExecutor(shared).id, users.gm1.id,
    '활성 플레이어 OWNER가 없으면 책임 GM이 처리해야 한다');
});

test('actor-owned socket work uses local loopback for the sender and broadcast for a remote executor', async () => {
  const fixture = socketContext();
  const { context, users } = fixture;
  const emitted = [];
  context.game.socket.emit = (...args) => emitted.push(args);
  load(context, 'scripts/core/runtime-utils.js');
  load(context, 'scripts/socket-router.js');
  let handled = 0;
  let loopbackData;
  context.DX3rdSocketRouter.registerType('actorOwnedProbe', () => {}, {
    contract: true,
    validate: data => data.payload?.value === 1
  });
  context.DX3rdSocketRouter.registerType('actorOwnedProbe', data => {
    handled++;
    loopbackData = data;
  }, { consume: true });

  const shared = {
    id: 'shared',
    testUserPermission: user => user.id === users.player1.id || user.id === users.player2.id || user.isGM
  };
  users.player2.character = { id: shared.id };
  context.game.user = users.player2;
  const requestId = context.DX3rdSocketRouter.emitToActorExecutor(
    { type: 'actorOwnedProbe', payload: { value: 1 } },
    shared
  );
  await new Promise(resolvePromise => setImmediate(resolvePromise));

  assert.match(requestId, /^actorOwnedProbe:/);
  assert.equal(emitted.length, 0, '발신자가 실행자이면 다른 클라이언트로 broadcast하면 안 된다');
  assert.equal(handled, 1, '로컬 루프백도 계약과 typed dispatch를 통과해 한 번 실행되어야 한다');
  assert.equal(loopbackData.executorUserId, users.player2.id);
  assert.equal(context.DX3rdSocketRouter.isActorExecutorMessage(loopbackData, shared), true);

  context.DX3rdSocketRouter.emitToActorExecutor(
    { type: 'actorOwnedProbe', payload: { value: 0 } },
    shared
  );
  await new Promise(resolvePromise => setImmediate(resolvePromise));
  assert.equal(handled, 1, '로컬 루프백도 잘못된 페이로드를 계약 단계에서 거부해야 한다');

  context.game.user = users.player1;
  assert.equal(context.DX3rdSocketRouter.isActorExecutorMessage(loopbackData, shared), false,
    '권한이 있는 다른 공동 OWNER라도 지정 실행자가 아니면 실행하면 안 된다');

  context.game.user = users.gm1;
  const remoteRequestId = context.DX3rdSocketRouter.emitToActorExecutor(
    { type: 'actorOwnedProbe', payload: { value: 1 } },
    shared
  );
  assert.match(remoteRequestId, /^actorOwnedProbe:/);
  assert.equal(emitted.length, 1);
  assert.equal(emitted[0].length, 2, '원격 실행자는 v13/v14 공통 일반 broadcast로 보내야 한다');
  assert.equal(emitted[0][0], 'system.dx3rd-emanim');
  assert.equal(emitted[0][1].executorUserId, users.player2.id);
});

test('actor-executor socket contracts require the sender-selected user id', async () => {
  const fixture = socketContext();
  const { context, users } = fixture;
  load(context, 'scripts/core/runtime-utils.js');
  load(context, 'scripts/socket-router.js');
  load(context, 'scripts/socket-contracts.js');
  let handled = 0;
  context.DX3rdSocketRouter.register(() => { handled++; });
  fixture.ready();

  const envelope = extra => vm.runInContext(
    `DX3rdRuntimeUtils.createSocketEnvelope(${JSON.stringify({
      type: 'executeAfterDamageMacro',
      payload: { attackerId: 'a1', itemId: 'i1' },
      ...extra
    })}, {senderId:${JSON.stringify(users.gm1.id)}})`,
    context
  );
  await fixture.listener(envelope());
  await fixture.listener(envelope({ executorUserId: users.player1.id }));
  assert.equal(handled, 1, '실행자 ID가 없는 actor-owned 명령은 계약 단계에서 거부해야 한다');
});

test('every actor-owned socket route uses sender selection and receiver validation', () => {
  assert.doesNotMatch(source('scripts/socket-router.js'), /\{\s*recipients\s*:/,
    'actor executor routing must not depend on Foundry server-internal recipients');
  const typed = source('scripts/socket-document-handlers.js');
  const main = source('scripts/main.js');
  const registeredBranch = (type, nextType) => {
    const start = typed.indexOf(`register('${type}'`);
    const end = nextType ? typed.indexOf(`register('${nextType}'`, start + 1) : typed.length;
    assert.ok(start >= 0 && end > start, `typed socket branch not found: ${type}`);
    return typed.slice(start, end);
  };
  for (const [type, nextType] of [
    ['showDefenseDialog', 'applyItemAttributes'],
    ['applyItemAttributes', 'userTyping']
  ]) {
    assert.match(registeredBranch(type, nextType), /isActorExecutorMessage\(data, targetActor\)/,
      `${type} must validate the sender-selected target owner`);
  }

  const genericBranch = type => {
    const marker = `data.type === '${type}'`;
    const start = main.indexOf(marker);
    const end = main.indexOf("data.type === '", start + marker.length);
    assert.ok(start >= 0, `generic socket branch not found: ${type}`);
    return main.slice(start, end >= 0 ? end : main.length);
  };
  for (const [type, actorName] of [
    ['executeAfterDamageMacro', 'attacker'],
    ['showAfterDamageDialog', 'actor'],
    ['executeAfterDamageActivation', 'actor'],
    ['showNoDamageNotification', 'actor']
  ]) {
    assert.match(genericBranch(type), new RegExp(`isActorExecutorMessage\\(data, ${actorName}\\)`),
      `${type} must validate the sender-selected actor owner`);
  }

  const ownerTypes = new Set([
    'executeAfterDamageMacro',
    'showAfterDamageDialog',
    'executeAfterDamageActivation',
    'showNoDamageNotification',
    'showDefenseDialog',
    'applyItemAttributes'
  ]);
  const emissionSource = [
    source('scripts/main.js'),
    source('scripts/handlers/universal-apply.js'),
    source('scripts/handlers/universal-damage-dialog.js')
  ].join('\n');
  const emissions = [...emissionSource.matchAll(
    /DX3rdSocketRouter\.(emitToActorExecutor|emit)\(\{\s*type:\s*'([^']+)'/g
  )].filter(match => ownerTypes.has(match[2]));
  assert.equal(emissions.length, 12, 'actor-owned emission 목록이 바뀌면 새 경로도 명시적으로 분류해야 한다');
  for (const [, method, type] of emissions) {
    assert.equal(method, 'emitToActorExecutor', `${type} must use actor-executor routing`);
  }
});

test('typed GM boundary consumes messages on non-responsible clients', async () => {
  const fixture = socketContext();
  const { context, users } = fixture;
  load(context, 'scripts/core/runtime-utils.js');
  load(context, 'scripts/socket-router.js');
  let typedHandled = 0;
  let genericHandled = 0;
  context.DX3rdSocketRouter.registerType('gmBoundary', () => { typedHandled++; }, {
    consume: true,
    responsibleGMOnly: true
  });
  context.DX3rdSocketRouter.register(() => { genericHandled++; });
  context.game.user = users.gm2;
  fixture.ready();

  const envelope = vm.runInContext(
    `DX3rdRuntimeUtils.createSocketEnvelope({type:'gmBoundary'}, {senderId:'p1'})`,
    context
  );
  await fixture.listener(envelope);
  assert.equal(typedHandled, 0);
  assert.equal(genericHandled, 0);
});

test('every emitted literal socket type has a registered contract', () => {
  const fixture = socketContext();
  const { context } = fixture;
  load(context, 'scripts/core/runtime-utils.js');
  load(context, 'scripts/socket-router.js');
  load(context, 'scripts/socket-contracts.js');
  const registered = new Set(JSON.parse(vm.runInContext('JSON.stringify(DX3rdSocketContracts.types)', context)));
  const emitted = new Set();
  const pattern = /(?:DX3rdSocketRouter|socketRouter)\.emit(?:ToActorExecutor)?\(\{\s*type:\s*['"]([^'"]+)['"]/g;
  for (const path of walkJs(resolve(root, 'scripts'))) {
    const text = readFileSync(path, 'utf8');
    for (const match of text.matchAll(pattern)) emitted.add(match[1]);
  }
  assert.deepEqual([...emitted].filter(type => !registered.has(type)), []);
});

test('AfterMain queue serializes concurrent writes and retains only failures', async () => {
  const store = { afterMainQueue: [] };
  let encroachProcessed = 0;
  const gm = { id: 'gm', isGM: true, active: true };
  const actor = { id: 'a1', uuid: 'Actor.a1', name: '테스트', items: new Map() };
  const users = {
    activeGM: gm,
    get: id => id === gm.id ? gm : null,
    find: predicate => [gm].find(predicate)
  };
  const context = baseContext({
    Hooks: { once: () => {} },
    canvas: { tokens: { placeables: [] } },
    ui: { notifications: { error: () => {} } },
    game: {
      user: { ...gm, targets: new Set() },
      users,
      actors: new Map([[actor.id, actor]]),
      items: new Map(),
      socket: { on: () => {}, emit: () => {} },
      settings: {
        get: (_scope, key) => structuredClone(store[key]),
        set: async (_scope, key, value) => {
          await new Promise(resolveDelay => setTimeout(resolveDelay, 2));
          store[key] = structuredClone(value);
        }
      },
      i18n: { format: (key, data) => `${key}:${data.count}` }
    }
  });
  context.fromUuid = async uuid => uuid === actor.uuid ? actor : null;
  context.DX3rdUniversalHandler = {
    executeHealExtensionNow: async () => {},
    executeDamageExtensionNow: async () => { throw new Error('expected failure'); },
    executeEncroachExtensionNow: async () => { encroachProcessed++; }
  };
  load(context, 'scripts/core/runtime-utils.js');
  load(context, 'scripts/socket-router.js');
  load(context, 'scripts/handlers/universal-after-main.js');

  await Promise.all([
    context.DX3rdUniversalHandler.addToAfterMainQueue(actor, { amount: 1 }, null, 'heal', { queueId: 'q1' }),
    context.DX3rdUniversalHandler.addToAfterMainQueue(actor, { amount: 2 }, null, 'damage', { queueId: 'q2' }),
    context.DX3rdUniversalHandler.addToAfterMainQueue(actor, { fixed: true, value: '2' }, null, 'encroach', { queueId: 'q-enc' })
  ]);
  await context.DX3rdUniversalHandler.addToAfterMainQueue(actor, { amount: 99 }, null, 'heal', { queueId: 'q1' });
  assert.equal(store.afterMainQueue.length, 3);
  assert.equal('actor' in store.afterMainQueue[0], false);
  assert.equal('item' in store.afterMainQueue[0], false);

  const result = await context.DX3rdUniversalHandler.processAfterMainQueue();
  assert.deepEqual(JSON.parse(JSON.stringify(result)), { processed: 2, failed: 1 });
  assert.equal(encroachProcessed, 1);
  assert.equal(store.afterMainQueue.length, 1);
  assert.equal(store.afterMainQueue[0].queueId, 'q2');
  assert.equal(store.afterMainQueue[0].blocked, true);
  assert.equal(store.afterMainQueue[0].attempts, 1);

  const blockedResult = await context.DX3rdUniversalHandler.processAfterMainQueue();
  assert.deepEqual(JSON.parse(JSON.stringify(blockedResult)), { processed: 0, failed: 1 });
  assert.equal(store.afterMainQueue[0].attempts, 1);
  assert.equal(await context.DX3rdUniversalHandler.retryAfterMainQueueEntry('q2'), true);
  assert.equal(store.afterMainQueue[0].blocked, false);
  const retryResult = await context.DX3rdUniversalHandler.processAfterMainQueueEntry('q2');
  assert.equal(retryResult.found, true);
  assert.equal(retryResult.processed, false);
  assert.equal(store.afterMainQueue[0].attempts, 2);
  assert.equal(await context.DX3rdUniversalHandler.removeAfterMainQueueEntry('q2'), true);
  assert.equal(store.afterMainQueue.length, 0);

  await context.DX3rdUniversalHandler.addToAfterMainQueue(actor, { amount: 3 }, null, 'heal', { queueId: 'q3' });
  context.fromUuid = async () => null;
  context.game.actors.delete(actor.id);
  const missingActorResult = await context.DX3rdUniversalHandler.processAfterMainQueue();
  assert.deepEqual(JSON.parse(JSON.stringify(missingActorResult)), { processed: 0, failed: 1 });
  assert.equal(store.afterMainQueue[0].blocked, true);
  assert.match(store.afterMainQueue[0].lastError, /Actor not found/);
  assert.equal(await context.DX3rdUniversalHandler.clearAfterMainQueue(), true);
  assert.equal(store.afterMainQueue.length, 0);
});

test('chat message flags take precedence and legacy messages are classified', () => {
  const translations = {
    'DX3rd.ActionEnd': '행동 종료',
    'DX3rd.ActionDelay': '행동 지연',
    'DX3rd.Apply': '적용',
    'DX3rd.Clear': '해제',
    'DX3rd.Healing': '회복',
    'DX3rd.DamageToHP': 'HP 데미지',
    'DX3rd.PoisonedCheck': '사독 체크'
  };
  const context = baseContext({ game: { i18n: { localize: key => translations[key] || key } } });
  load(context, 'scripts/chat-message-types.js');
  let update = null;
  context.documentMock = { updateSource: value => { update = value; } };
  const result = JSON.parse(vm.runInContext(`JSON.stringify({
    explicit: DX3rdChatMessageTypes.getType({content:'HP 회복', flags:{'dx3rd-emanim':{messageType:'custom'}}}),
    legacyHealFlag: DX3rdChatMessageTypes.getType({flags:{'dx3rd-emanim':{messageType:'heal'}}}),
    healing: DX3rdChatMessageTypes.getType({content:'HP 3 회복'}),
    action: DX3rdChatMessageTypes.getType({content:'<button class="damage-roll-btn">굴림</button>'}),
    ensured: DX3rdChatMessageTypes.ensureFlag(documentMock, {content:'HP 3 회복'})
  })`, context));
  assert.deepEqual(result, {
    explicit: 'custom',
    legacyHealFlag: 'healing',
    healing: 'healing',
    action: 'systemAction',
    ensured: 'healing'
  });
  assert.deepEqual(JSON.parse(JSON.stringify(update)), {
    flags: { 'dx3rd-emanim': { messageType: 'healing' } }
  });

  vm.runInContext(`DX3rdChatMessageTypes.ensureFlag(documentMock, {
    content:'HP 4 회복',
    flags:{'dx3rd-emanim':{comboAfterDamage:{itemId:'i1'}}}
  })`, context);
  assert.deepEqual(JSON.parse(JSON.stringify(update)), {
    flags: { 'dx3rd-emanim': { comboAfterDamage: { itemId: 'i1' }, messageType: 'healing' } }
  });
});

test('compendium sync follows once/etc reclassification without touching same-name decoys', () => {
  const context = baseContext({
    Hooks: { once: () => {} },
    foundry: { utils: {} },
    game: { i18n: { localize: key => key } }
  });
  load(context, 'scripts/compendium-sync.js');
  const {
    resolveSource, isSyncEligible, prepareReplacement, needsReplacement,
    exclusionKey, filterPlan
  } = context.window.DX3rdCompendiumSync;

  // 컴펜디움: 응급치료 키트는 etc → once로 재분류됐고, 돌팔매는 이펙트로만 존재한다.
  const pack = [
    { type: 'once', name: '응급치료 키트' },
    { type: 'etc', name: '의료 트렁크' },
    { type: 'effect', name: '돌팔매' },
    { type: 'once', name: '만능약' },
    { type: 'etc', name: '만능약' }        // 동명이물: 두 타입으로 존재
  ];
  const index = new Map(pack.map(doc => [`${doc.type}|${doc.name}`, doc]));
  const nameTypes = new Map();
  for (const doc of pack) {
    if (!nameTypes.has(doc.name)) nameTypes.set(doc.name, new Set());
    nameTypes.get(doc.name).add(doc.type);
  }

  const item = (id, name, type) => ({ id, name, type });
  const actorOf = (...items) => ({ items });

  // 정확 매칭은 그대로 우선한다.
  const trunk = item('i1', '의료 트렁크', 'etc');
  assert.equal(resolveSource(index, nameTypes, actorOf(trunk), trunk).type, 'etc');

  // 재분류된 소모품은 별칭으로 따라가 최신 데이터를 받는다.
  const kit = item('i2', '응급치료 키트', 'etc');
  assert.equal(resolveSource(index, nameTypes, actorOf(kit), kit).type, 'once');

  // 이펙트가 생성한 무기는 이름이 같아도 매칭되지 않는다(별칭 대상 타입이 아님).
  const sling = item('i3', '돌팔매', 'weapon');
  assert.equal(resolveSource(index, nameTypes, actorOf(sling), sling), null);

  // 컴펜디움에 같은 이름이 두 타입으로 있으면 모호하므로 건드리지 않는다.
  const ambiguous = item('i4', '만능약', 'combo');
  assert.equal(resolveSource(index, nameTypes, actorOf(ambiguous), ambiguous), null);

  // 액터가 이미 재분류 후 타입의 사본을 갖고 있으면 중복 교체하지 않는다.
  const oldKit = item('i5', '응급치료 키트', 'etc');
  const newKit = item('i6', '응급치료 키트', 'once');
  assert.equal(resolveSource(index, nameTypes, actorOf(oldKit, newKit), oldKit), null);
  assert.equal(resolveSource(index, nameTypes, actorOf(oldKit, newKit), newKit).type, 'once');

  // 맨손은 액터마다 커스터마이즈되므로 컴펜디움 데이터로 되돌리지 않는다.
  assert.equal(isSyncEligible({ type: 'weapon', name: '맨손' }), false);
  assert.equal(isSyncEligible({ type: 'weapon', name: '나이프' }), true);

  // once 원본의 일반 가방 아이콘은 preCreateItem에서 알약 아이콘으로 바뀐다.
  // 비교도 같은 결과를 기대해야 한 번 갱신한 아이템이 영원히 다시 잡히지 않는다.
  const currentOnce = {
    id: 'i7',
    sort: 0,
    type: 'once',
    actor: null,
    toObject: () => ({
      _id: 'i7',
      name: '응급치료 키트',
      type: 'once',
      img: 'icons/svg/pill.svg',
      system: { quantity: 2 },
      effects: [],
      flags: {}
    })
  };
  const sourceOnce = {
    toObject: () => ({
      _id: 'source',
      name: '응급치료 키트',
      type: 'once',
      img: 'icons/svg/item-bag.svg',
      system: { quantity: 1 },
      effects: [],
      flags: {}
    })
  };
  assert.equal(prepareReplacement(currentOnce, sourceOnce).img, 'icons/svg/pill.svg');
  assert.equal(needsReplacement(currentOnce, sourceOnce), false);

  // 월드에 저장한 제외 선택은 해당 액터의 해당 아이템만 빼고, 빈 액터 행도 제거한다.
  const actorA = { id: 'a1', items: [trunk, kit] };
  const actorB = { id: 'a2', items: [sling] };
  const filtered = filterPlan([
    { actor: actorA, matches: [{ item: trunk }, { item: kit }] },
    { actor: actorB, matches: [{ item: sling }] }
  ], {
    [exclusionKey(actorA.id, kit.id)]: true,
    [exclusionKey(actorB.id, sling.id)]: true
  });
  assert.equal(filtered.length, 1);
  assert.equal(filtered[0].actor.id, 'a1');
  assert.deepEqual(Array.from(filtered[0].matches, match => match.item.id), ['i1']);
});

test('compendium sync keeps hand edits and only takes what the compendium actually changed', () => {
  const context = baseContext({
    Hooks: { once: () => {} },
    foundry: { utils: {} },
    game: { i18n: { localize: key => key } }
  });
  load(context, 'scripts/compendium-sync.js');
  const { mergeReplacement, leafChanges, decodeBaseline } = context.window.DX3rdCompendiumSync;

  const packDoc = (system) => ({
    toObject: () => ({
      _id: 'src', name: '나이프', type: 'weapon', img: 'a.png',
      system: JSON.parse(JSON.stringify(system)), effects: [], flags: {}
    })
  });
  const worldItem = (system, flags = {}) => ({
    id: 'i1', sort: 0, type: 'weapon', actor: null,
    toObject: () => ({
      _id: 'i1', name: '나이프', type: 'weapon', img: 'a.png',
      system: JSON.parse(JSON.stringify(system)), effects: [],
      flags: JSON.parse(JSON.stringify(flags))
    })
  });

  // ① 기준선이 없으면 예전대로 전체 교체하고, 그 사실을 hasBaseline 으로 알린다.
  const v1 = { attack: 1, guard: 2, description: '원문' };
  const fresh = mergeReplacement(worldItem(v1), packDoc(v1));
  assert.equal(fresh.hasBaseline, false);
  const baseline = fresh.data.flags['dx3rd-emanim'].syncBaseline;
  assert.ok(baseline.leaves.includes('system.attack\t'), '잎 경로별 해시가 기록돼야 한다');

  // ② 기준선이 있으면: 컴펜디움만 바뀐 잎은 반영, 사용자만 바꾼 잎은 유지.
  const mine = { attack: 1, guard: 99, description: '원문' };      // 가드치를 손으로 고쳤다
  const theirs = { attack: 5, guard: 2, description: '원문' };     // 컴펜디움은 공격력을 고쳤다
  const merged = mergeReplacement(worldItem(mine, { 'dx3rd-emanim': { syncBaseline: baseline } }), packDoc(theirs));
  assert.equal(merged.hasBaseline, true);
  assert.equal(merged.data.system.attack, 5, '컴펜디움만 바뀐 값은 최신을 받아야 한다');
  assert.equal(merged.data.system.guard, 99, '사용자가 손본 값은 갱신이 지워선 안 된다');
  assert.deepEqual(plain(merged.kept), ['system.guard']);
  assert.deepEqual(plain(merged.conflicts), []);

  // 기준선은 병합 결과가 아니라 컴펜디움 값으로 다시 찍힌다. 그래야 다음 갱신이
  // 「그 뒤에 사용자가 또 손댔는가」를 판정할 수 있다.
  const rebased = decodeBaseline(merged.data);
  assert.equal(rebased.get('system.guard'), decodeBaseline(fresh.data).get('system.guard'));
  assert.notEqual(rebased.get('system.attack'), decodeBaseline(fresh.data).get('system.attack'));

  // ③ 양쪽이 같은 잎을 바꾸면 충돌. 기본은 사용자 값 유지, 선택하면 컴펜디움 우선.
  const bothChanged = { attack: 7, guard: 2, description: '원문' };
  const item = worldItem({ attack: 3, guard: 2, description: '원문' },
    { 'dx3rd-emanim': { syncBaseline: baseline } });
  const conflict = mergeReplacement(item, packDoc(bothChanged));
  assert.deepEqual(plain(conflict.conflicts), ['system.attack']);
  assert.equal(conflict.data.system.attack, 3, '충돌의 기본값은 현재 값 유지다');
  const forced = mergeReplacement(item, packDoc(bothChanged), { preferCompendium: true });
  assert.equal(forced.data.system.attack, 7);

  // ④ 컴펜디움이 잎을 지웠고 사용자는 손대지 않았으면 삭제도 따라간다.
  const dropped = mergeReplacement(
    worldItem(v1, { 'dx3rd-emanim': { syncBaseline: baseline } }),
    packDoc({ attack: 1, description: '원문' })
  );
  assert.equal('guard' in dropped.data.system, false, '컴펜디움의 삭제도 갱신이다');

  // ⑤ 인스턴스 상태는 병합 대상이 아니다 — 기준선이 뭐라 하든 항상 내 것이다.
  const equipped = mergeReplacement(
    worldItem({ attack: 1, guard: 2, description: '원문', equipment: true },
      { 'dx3rd-emanim': { syncBaseline: baseline } }),
    packDoc({ attack: 1, guard: 2, description: '원문', equipment: false })
  );
  assert.equal(equipped.data.system.equipment, true);

  // ⑥ 표시용 변경 목록은 최상위 필드 이름이 아니라 잎 경로여야 한다.
  const rows = leafChanges(
    worldItem(mine, { 'dx3rd-emanim': { syncBaseline: baseline } }),
    merged.data
  );
  assert.deepEqual(plain(rows), [{ path: 'system.attack', before: 1, after: 5 }]);

  // 기준선 flag 만 새로 찍히는 것은 「갱신 필요」가 아니다. 그렇지 않으면 매 실행마다
  // 모든 아이템이 삭제·재생성된다.
  const stampedOnly = mergeReplacement(worldItem(v1), packDoc(v1));
  assert.deepEqual(plain(leafChanges(worldItem(v1), stampedOnly.data)), []);
});

// applied-toggle 하네스: 토글 AE 동기화의 경합/배치/상시 자동활성을 실물 모듈로 검증한다.
// AE 저장소와 setMany 완료 시점을 테스트가 직접 통제해, 콤보가 멤버를 연달아 켜는
// 실제 타이밍(쓰기 도중 다음 토글 도착)을 재현한다.
// vm 컨텍스트에서 만든 배열/객체는 프로토타입이 달라 deepStrictEqual 이 참조 비교로 실패한다.
const plain = value => JSON.parse(JSON.stringify(value));

function toggleContext() {
  const hooks = {};
  const gm = { id: 'gm1', isGM: true, active: true };
  const users = [gm];
  const effects = [];
  const writes = [];
  let gate = null;

  const actor = {
    id: 'a1',
    name: '테스트 액터',
    type: 'character',
    documentName: 'Actor',
    items: [],
    effects,
    system: { attributes: {} },
    testUserPermission: () => true,
    async deleteEmbeddedDocuments(_type, ids) {
      for (const id of ids) {
        const index = effects.findIndex(effect => effect.id === id);
        if (index >= 0) effects.splice(index, 1);
      }
      writes.push({ op: 'delete', count: ids.length });
    },
    async updateEmbeddedDocuments(type, updates) {
      writes.push({ op: 'updateItems', count: updates.length });
      for (const update of updates) {
        const item = actor.items.find(i => i.id === update._id);
        if (item && 'system.active.state' in update) item.system.active.state = update['system.active.state'];
      }
      return updates;
    }
  };

  const context = baseContext({
    Hooks: {
      on: (name, callback) => { (hooks[name] ??= []).push(callback); },
      once: (name, callback) => { (hooks[name] ??= []).push(callback); }
    },
    game: { user: gm, users, actors: [actor], i18n: { localize: key => key } },
    ui: { notifications: { warn: () => {}, error: () => {} } },
    foundry: { utils: { flattenObject: object => object, hasProperty: () => true } }
  });
  context.DX3rdFormulaEvaluator = {
    prepareRollFormula: value => String(value ?? '0'),
    isRollTimeKey: () => false,
    hasDice: () => false,
    evaluate: value => Number(value) || 0
  };
  context.DX3rdAppliedEffects = {
    set: async () => { throw new Error('setMany 가 있으면 개별 set 을 쓰면 안 된다'); },
    setMany: async (_actor, entries) => {
      writes.push({ op: 'setMany', keys: entries.map(([key]) => key) });
      if (gate) await gate;
      for (const [key, payload] of entries) {
        effects.push({
          id: `ae_${key}`,
          disabled: false,
          getFlag: (_scope, field) => (field === 'appliedKey' ? key : payload)
        });
      }
      return entries.length;
    }
  };
  load(context, 'scripts/dx3rd-applied-toggle.js');

  const addItem = (id, { type = 'effect', state = false, attributes = {}, timing = '-' } = {}) => {
    const item = {
      id, name: id, img: 'i.png', type, parent: actor,
      system: { active: { state }, attributes, timing },
      async update(changes) {
        if ('system.active.state' in changes) item.system.active.state = changes['system.active.state'];
        writes.push({ op: 'updateItem', id });
        for (const callback of hooks.updateItem || []) callback(item);
      }
    };
    actor.items.push(item);
    return item;
  };

  return {
    context, actor, effects, writes, hooks, addItem,
    toggle: window => window,
    hold: () => { let release; gate = new Promise(resolve => { release = resolve; }); return () => { gate = null; release(); }; },
    appliedKeys: () => effects.map(effect => effect.getFlag('dx3rd-emanim', 'appliedKey')).sort()
  };
}

test('applied toggle sync replans after an in-flight write so late toggles are not dropped', async () => {
  const fixture = toggleContext();
  const { context, addItem } = fixture;
  const first = addItem('e1', { attributes: { a0: { key: 'add', value: '2' } } });
  const second = addItem('e2', { attributes: { a0: { key: 'attack', value: '3' } } });

  // 첫 멤버를 켜고 AE 쓰기를 진행 중 상태로 붙잡는다(콤보의 순차 토글 재현).
  first.system.active.state = true;
  const release = fixture.hold();
  const inflight = context.DX3rdAppliedToggle.sync(fixture.actor);
  await Promise.resolve();

  // 쓰기가 끝나기 전에 두 번째 멤버가 켜진다 → 진행 중 계획에는 없다.
  second.system.active.state = true;
  const late = context.DX3rdAppliedToggle.sync(fixture.actor);
  release();
  await inflight;
  await late;

  // 예전 동작: 진행 중 Promise 만 기다려 e2 의 AE 가 없는 상태로 공격값을 읽었다.
  assert.deepEqual(plain(fixture.appliedKeys()), ['toggle:e1', 'toggle:e2']);
});

test('applied toggle writes all toggled effects in one batched call', async () => {
  const fixture = toggleContext();
  const { context, addItem } = fixture;
  addItem('e1', { state: true, attributes: { a0: { key: 'add', value: '2' } } });
  addItem('e2', { state: true, attributes: { a0: { key: 'add', value: '3' } } });
  addItem('e3', { state: true, attributes: { a0: { key: 'add', value: '4' } } });

  await context.DX3rdAppliedToggle.sync(fixture.actor);

  const batches = fixture.writes.filter(write => write.op === 'setMany');
  assert.equal(batches.length, 1, 'AE 쓰기는 1회 왕복이어야 한다');
  assert.deepEqual(plain(batches[0].keys).sort(), ['toggle:e1', 'toggle:e2', 'toggle:e3']);
  assert.deepEqual(plain(fixture.appliedKeys()), ['toggle:e1', 'toggle:e2', 'toggle:e3']);
});

test('a stale active flag does not project an on-use item onto the toggle channel', async () => {
  const fixture = toggleContext();
  const { context, addItem } = fixture;
  load(context, 'scripts/item-effect-adapter.js');
  addItem('frozen', {state: true, attributes: {a0: {key: 'add', value: '2'}}})
    .system.active.applyMode = 'onUse';

  await context.DX3rdAppliedToggle.sync(fixture.actor);

  assert.deepEqual(plain(fixture.appliedKeys()), [],
    '이전 버전이 남긴 active.state 때문에 사용 시 보정이 활성화 보정으로 되살아나면 안 된다');
});

test('always-on effects imported from a compendium are activated on creation', async () => {
  const fixture = toggleContext();
  const { context, addItem, hooks } = fixture;
  // 시트가 활성 토글을 그리는 기준과 같은 단일 소스를 쓴다.
  context.DX3rdActorSheetData = {
    usesSelfEffectActiveToggle: item => item.system?.timing === 'always'
      && Object.values(item.system?.attributes || {}).some(a => a?.key && a.key !== '-' && String(a.value ?? '') !== '')
  };

  // 컴펜디움 빌드는 전부 active.state=false 다(_source/build-effects.mjs).
  const always = addItem('e1', { timing: 'always', attributes: { a0: { key: 'add', value: '2' } } });
  const major = addItem('e2', { timing: 'major', attributes: { a0: { key: 'add', value: '2' } } });

  for (const callback of hooks.createItem || []) callback(always);
  for (const callback of hooks.createItem || []) callback(major);
  await new Promise(resolve => setTimeout(resolve, 0)); // 같은 틱 배치 플러시 대기

  assert.equal(always.system.active.state, true, '상시 이펙트는 취득만으로 켜져야 한다');
  assert.equal(major.system.active.state, false, '상시가 아닌 이펙트는 건드리지 않는다');
  // 같은 틱에 온 생성은 액터당 1회 배치로 켜야 한다(임포트 시 아이템 수만큼 왕복 방지).
  assert.equal(fixture.writes.filter(write => write.op === 'updateItems').length, 1);
});

test('always-on repair activates every stale import in one batch per actor', async () => {
  const fixture = toggleContext();
  const { context, addItem } = fixture;
  context.DX3rdActorSheetData = {
    usesSelfEffectActiveToggle: item => item.system?.timing === 'always'
  };
  addItem('e1', { timing: 'always' });
  addItem('e2', { timing: 'always' });
  addItem('e3', { timing: 'major' });

  const result = await context.DX3rdAppliedToggle.activateAlwaysOn(fixture.actor);

  assert.deepEqual(plain(result), { scanned: 2, activated: 2 });
  assert.equal(fixture.writes.filter(write => write.op === 'updateItems').length, 1, '액터당 1회 배치');
  assert.equal(fixture.actor.items.find(i => i.id === 'e3').system.active.state, false);
});

// 판정 다이얼로그(showStatRollDialog)는 실제 DOM 없이는 돌 수 없다. DialogV2.element을
// 가짜 루트로 갈아끼워, 잠금 해제한 표시 칸의 "직접 수정 = 최종 판정치 덮어쓰기" 배선을 검증한다.
// (칸이 실제로 열려 있는지는 content HTML을 함께 확인한다.)
function fakeElement(value = '') {
  const listeners = new Map();
  const classes = new Set();
  let raw = String(value);
  return {
    // 실제 input.value는 무엇을 넣어도 문자열이 된다. 그 강제 변환까지 흉내내야
    // 코드가 문자열/숫자를 섞어 다루는 실수를 테스트가 놓치지 않는다.
    get value() { return raw; },
    set value(next) { raw = String(next); },
    title: '',
    disabled: false,
    dataset: {},
    classList: {
      add: name => classes.add(name),
      remove: name => classes.delete(name),
      contains: name => classes.has(name),
      toggle: (name, on) => { if (on) classes.add(name); else classes.delete(name); }
    },
    addEventListener: (type, fn) => {
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type).push(fn);
    },
    async fire(type, event = {}) {
      for (const fn of listeners.get(type) || []) await fn({ currentTarget: this, preventDefault: () => {}, ...event });
    },
    // 사용자 입력: 값을 넣고 input 이벤트를 흘린다.
    async input(next) { this.value = next; await this.fire('input'); }
  };
}

function rollDialogContext(stat) {
  const fields = {
    '.dx-dice-display': fakeElement(0), '.dx-dice-input': fakeElement(0),
    '.dx-critical-display': fakeElement(0), '.dx-critical-input': fakeElement(0),
    '.dx-add-display': fakeElement(0), '.dx-add-input': fakeElement(0),
    '.dx-difficulty': fakeElement('')
  };
  const buttons = ['major', 'reaction', 'dodge'].map(type => {
    const button = fakeElement();
    button.dataset.rollType = type;
    button.click = () => button.fire('click');
    return button;
  });
  const root = {
    querySelector: selector => {
      if (selector === '.roll-type-btn.selected') return buttons.find(b => b.classList.contains('selected')) || null;
      return fields[selector] || null;
    },
    querySelectorAll: selector => (selector === '.roll-type-btn' ? buttons : [])
  };

  let content = '';
  class DialogV2 {
    constructor(config) { content = config.content; this.element = root; }
    async render() { return this; }
    close() { this.closed = true; }
  }

  const rolls = [];
  const warnings = [];
  const context = baseContext({
    document: { activeElement: null },
    foundry: { applications: { api: { DialogV2 } }, utils: { deepClone: structuredClone } },
    // 수정치 다이스식 검증에 쓰는 최소 Roll.validate. Foundry처럼 "3+"(연산자로 끝나는 식)은
    // 반드시 거부해야 한다 — 항 사이 연산자만 허용하는 형태로 좁힌다.
    Roll: { validate: formula => /^\s*\d+(d\d+)?(\s*[-+*/]\s*\d+(d\d+)?)*\s*$/.test(formula) },
    game: {
      i18n: { localize: key => key },
      settings: { get: (_scope, key) => (key === 'defaultCritical' ? 10 : '') },
      user: { targets: new Set() }
    },
    canvas: { tokens: { placeables: [] } },
    ui: { notifications: { warn: message => warnings.push(message), error: () => {} } }
  });
  // 모듈이 같은 객체에 executeStatRoll을 믹스인하므로, 스텁은 로드 후에 덮어써야 한다.
  context.DX3rdUniversalHandler = {};
  load(context, 'scripts/handlers/universal-roll-dialog.js');
  context.DX3rdUniversalHandler.executeStatRoll =
    async (_actor, dice, critical, add) => { rolls.push({ dice, critical, add }); };

  const actor = { id: 'a1', isOwner: true, items: [], system: { attributes: {}, conditions: {} } };
  const open = () => context.DX3rdUniversalHandler.showStatRollDialog(actor, stat, '백병');
  return { fields, buttons, rolls, warnings, open, contentHtml: () => content };
}

test('roll dialog fields are unlocked and a direct edit overrides the computed pool', async () => {
  const fixture = rollDialogContext({
    name: '백병', dice: 5, critical: 10, add: 0,
    major: { dice: 5, critical: 10, add: 3 },
    reaction: { dice: 4, critical: 9, add: 1 },
    dodge: { dice: 6, critical: 10, add: 0 }
  });
  await fixture.open();

  // 잠금이 실제로 풀렸는지: 표시 칸에 disabled가 남아 있으면 안 된다.
  const html = fixture.contentHtml();
  assert.doesNotMatch(html, /class="dx-(dice|critical|add)-display"[^>]*disabled/);
  assert.match(html, /class="dx-dice-display"[^>]*title="DX3rd.RollFieldOverrideHint"/);
  // 다이스/크리티컬은 정수 칸이어야 한다. text로 두면 "1d10"이 조용히 1로 잘린다.
  assert.match(html, /type="number" class="dx-dice-display"/);
  assert.match(html, /type="number" class="dx-critical-display"/);

  const [major, reaction] = fixture.buttons;
  const { fields, rolls } = fixture;

  // 1) 기본값: 메이저 5dx10+3
  await major.fire('click');
  assert.deepEqual(plain(rolls.at(-1)), { dice: 5, critical: 10, add: 3 });

  // 2) 아래 "추가" 칸은 자동 계산에 더한다.
  await fields['.dx-dice-input'].input(2);
  assert.equal(fields['.dx-dice-display'].value, '7');
  await major.fire('click');
  assert.deepEqual(plain(rolls.at(-1)), { dice: 7, critical: 10, add: 3 });

  // 3) 표시 칸 직접 수정이 자동 계산(수정치 포함)을 덮는다.
  await fields['.dx-dice-display'].input(20);
  assert.ok(fields['.dx-dice-display'].classList.contains('dx3rd-overridden'));
  await major.fire('click');
  assert.deepEqual(plain(rolls.at(-1)), { dice: 20, critical: 10, add: 3 });

  // 4) 판정 타입이 바뀌면 기준값이 달라지므로 덮어쓰기는 무효 (리액션 4+2 / 크리 9 / 수정 1)
  await reaction.fire('mouseenter');
  assert.equal(fields['.dx-dice-display'].value, '6');
  assert.equal(fields['.dx-dice-display'].classList.contains('dx3rd-overridden'), false);
  await reaction.fire('click');
  assert.deepEqual(plain(rolls.at(-1)), { dice: 6, critical: 9, add: 1 });

  // 5) 크리티컬 직접 수정도 하한 2로 잠긴다(2 미만 입력 방어).
  await major.fire('mouseenter');
  await fields['.dx-critical-display'].input(1);
  await major.fire('click');
  assert.equal(rolls.at(-1).critical, 2);

  // 6) 비우면 자동 계산으로 복귀한다.
  await fields['.dx-critical-display'].input('');
  await major.fire('click');
  assert.deepEqual(plain(rolls.at(-1)), { dice: 7, critical: 10, add: 3 });

  // 7) 수정치 칸을 다시 만지면 그 항목의 덮어쓰기가 풀린다.
  await fields['.dx-add-display'].input(99);
  await fields['.dx-add-input'].input(5);
  assert.equal(fields['.dx-add-display'].value, '8');
  await major.fire('click');
  assert.deepEqual(plain(rolls.at(-1)), { dice: 7, critical: 10, add: 8 });
});

test('roll dialog add field carries a dice formula through to the roll term', async () => {
  const fixture = rollDialogContext({
    name: '백병', dice: 5, critical: 10, add: 0,
    major: { dice: 5, critical: 10, add: 3 },
    reaction: { dice: 4, critical: 10, add: 0 },
    dodge: { dice: 6, critical: 10, add: 0 }
  });
  await fixture.open();
  const [major] = fixture.buttons;
  const addDisplay = fixture.fields['.dx-add-display'];

  // 표시된 3에 이어 붙이는 형태. 수정치는 판정 롤의 항으로 실리므로 문자열째 전달돼야 한다.
  await addDisplay.input('3+1d10');
  await major.fire('click');
  assert.equal(fixture.rolls.at(-1).add, '3+1d10');
  assert.equal(fixture.rolls.at(-1).dice, 5);

  // 깨진 식은 조용히 다른 값으로 굴리지 않고 경고하고 멈춘다.
  const before = fixture.rolls.length;
  await addDisplay.input('3+');
  await major.fire('click');
  assert.equal(fixture.rolls.length, before, '깨진 식으로는 굴리지 않는다');
  assert.equal(fixture.warnings.length, 1);

  // 포커스를 잃으면 깨진 식을 버리고 표시를 자동 계산값으로 정규화한다.
  await addDisplay.fire('blur');
  assert.equal(addDisplay.value, '3');
  await major.fire('click');
  assert.equal(fixture.rolls.at(-1).add, 3);
});

test('roll dialog Enter key rolls the displayed type instead of closing the dialog', async () => {
  const fixture = rollDialogContext({
    name: '백병', dice: 5, critical: 10, add: 0,
    major: { dice: 5, critical: 10, add: 0 },
    reaction: { dice: 4, critical: 10, add: 0 },
    dodge: { dice: 6, critical: 10, add: 0 }
  });
  await fixture.open();

  // 마지막으로 표시된 타입(회피)이 Enter의 대상이 된다.
  await fixture.buttons[2].fire('mouseenter');
  await fixture.buttons[2].fire('mouseleave');
  await fixture.fields['.dx-dice-display'].fire('keydown', { key: 'Enter' });

  assert.equal(fixture.rolls.length, 1);
  assert.equal(fixture.rolls[0].dice, 6);
});

// ---------------------------------------------------------------------------
// 자기 지속 효과의 활성화 채널
// 시트 토글 · 직접 사용 · 콤보 멤버가 같은 판정을 봐야 한다. 셋 중 하나만 어긋나도
// "지속 효과가 꺼진 채로 사용해도 안 켜지는" 이펙트나, 반대로 "켜기만 하고 끌 수 없는"
// 이펙트가 생긴다. 규칙이 예전처럼 호출부마다 복제되면 이 테스트가 먼저 깨진다.
// ---------------------------------------------------------------------------
function selfChannelContext() {
  const context = baseContext({
    game: { i18n: { localize: key => key, format: key => key } },
    ui: { notifications: { warn: () => {} } },
    CONFIG: { statusEffects: [] },
    Hooks: { once: () => {}, on: () => {} },
    foundry: { utils: { getProperty: () => undefined, deepClone: value => structuredClone(value) } }
  });
  load(context, 'scripts/item-effect-adapter.js');
  load(context, 'scripts/sheets/actor-sheet-data.js');
  return context;
}

// handleItemUse / combo-handler 가 공유하는 게이트를 그대로 재현한다.
function useGate(adapter, item, options = {}) {
  const action = adapter.invocationAction(item, options);
  const useMeansActivate = adapter.useMeansActivation(item);
  const matches = adapter.extensionActionMatches(item, 'selfModifiers', item.system?.active || {}, action, 'instant')
    || useMeansActivate;
  const activeDisable = item.system?.active?.disable ?? '-';
  const skipToggle = item.type === 'once' && activeDisable === '-';
  const fires = matches && item.system?.active?.runTiming === 'instant'
    && !item.system?.active?.state && activeDisable !== 'notCheck' && !skipToggle;
  if (!fires) return 'skip';
  return (useMeansActivate || (item.system?.active?.applyMode || 'onUse') === 'toggle') ? 'toggle' : 'frozen';
}

const selfChannelCases = () => {
  const attrs = { a0: { key: 'add', value: '2' } };
  const active = extra => ({ state: false, disable: '-', runTiming: 'instant', ...extra });
  return [
    // [이름, 아이템, 사용 시 채널, 시트 토글 노출]
    ['상시 자기버프(컴펜디움 기본)',
      { type: 'effect', system: { timing: 'always', attributes: attrs, active: active({ applyMode: 'onUse' }) } }, 'toggle', true],
    ['상시 자기버프(이미 켜짐)',
      { type: 'effect', system: { timing: 'always', attributes: attrs, active: active({ state: true, applyMode: 'onUse' }) } }, 'skip', true],
    ['메이저 자기버프(기본)',
      { type: 'effect', system: { timing: 'major', attributes: attrs, active: active({ disable: 'major', applyMode: 'onUse' }) } }, 'frozen', false],
    ['메이저+카드액션=활성화',
      { type: 'effect', system: { timing: 'major', attributes: attrs, active: active({ action: 'activation', applyMode: 'toggle' }) } }, 'toggle', true],
    ['상시 공격이펙트',
      { type: 'effect', system: { timing: 'always', attackRoll: 'melee', attributes: attrs, active: active({ applyMode: 'onUse' }) } }, 'frozen', false],
    ['상시 자기버프+빈 대상보정 행',
      { type: 'effect', system: { timing: 'always', attributes: attrs, effect: { attributes: { b0: { key: '-', value: '' } } }, active: active({ applyMode: 'onUse' }) } }, 'toggle', true],
    ['상시 대상버프',
      { type: 'effect', system: { timing: 'always', attributes: attrs, effect: { attributes: { b0: { key: 'add', value: '1' } } }, active: active({ applyMode: 'onUse' }) } }, 'frozen', false],
    ['무기(장착 중 상시)',
      { type: 'weapon', system: { attributes: attrs, active: active({ applyMode: 'toggle' }) } }, 'skip', false],
    ['방어구(장착 중 상시)',
      { type: 'protect', system: { attributes: attrs, active: active({ applyMode: 'toggle' }) } }, 'skip', false],
    // 「마이너 액션을 소비해서 선언하면 …」류 장비. 장착만으로 켜면 첫 소멸 훅 뒤 죽는다.
    // 무기는 기본 발동이 '공격'인데, 선언형 보정은 공격에 딸려 붙으면 안 된다 —
    // 쓸지 말지는 명중판정 직전에 고르는 것이 이 계열의 전부다. 선언(action:'use')일 때
    // 걸리는 것은 바로 아래 테스트에서 따로 본다.
    ['무기(선언형)',
      { type: 'weapon', system: { attributes: attrs, active: active({ applyMode: 'onUse', disable: 'major' }) } }, 'skip', false],
    ['방어구(선언형)',
      { type: 'protect', system: { attributes: attrs, active: active({ applyMode: 'onUse', disable: 'reaction' }) } }, 'frozen', false],
    ['마술(spell)',
      { type: 'spell', system: { attributes: attrs, active: active({ disable: 'scene' }) } }, 'frozen', false],
    ['once 즉시해소',
      { type: 'once', system: { attributes: attrs, active: active({ applyMode: 'onUse' }) } }, 'skip', false],
    ['disable=notCheck',
      { type: 'effect', system: { timing: 'always', attributes: attrs, active: active({ disable: 'notCheck', applyMode: 'onUse' }) } }, 'skip', true]
  ];
};

test('using an item activates self modifiers whose channel is activation', () => {
  const context = selfChannelContext();
  const adapter = context.DX3rdItemEffectAdapter;
  for (const [label, item, expected] of selfChannelCases()) {
    assert.equal(useGate(adapter, item), expected, label);
  }

  // 선언형 장비는 「공격」이 아니라 「선언」에서 걸린다. 판정 창의 선언 토글이 확정할 때
  // action:'use' 로 부르는 경로가 바로 이것이라, 여기가 막히면 토글이 아무것도 못 한다.
  const declared = { type: 'weapon',
    system: { attributes: { a0: { key: 'add', value: '2' } },
      active: { state: false, disable: 'major', runTiming: 'instant', applyMode: 'onUse' } } };
  assert.equal(useGate(adapter, declared, { action: 'attack' }), 'skip', '공격만으로 선언형이 터지면 안 된다');
  assert.equal(useGate(adapter, declared, { action: 'use' }), 'frozen', '선언하면 동결 채널로 걸려야 한다');
});

test('sheet toggle and the use gate never disagree about the activation channel', () => {
  const context = selfChannelContext();
  const adapter = context.DX3rdItemEffectAdapter;
  const showsToggle = context.DX3rdActorSheetData.usesSelfEffectActiveToggle;
  for (const [label, item, , expectedToggle] of selfChannelCases()) {
    assert.equal(showsToggle(item), expectedToggle, `${label} — 시트 토글`);
    // 장비는 장착 체크가 원본이라 토글을 숨기지만 채널 자체는 '활성화'다. 그 외에는
    // 토글 노출과 활성화 채널 판정이 반드시 같아야 한다(켜고 끌 채널이 없는 이펙트 금지).
    if (['weapon', 'protect', 'vehicle'].includes(item.type)) continue;
    assert.equal(showsToggle(item), adapter.usesActivationSelfChannel(item), `${label} — 채널 일치`);
  }
});

function appliedEffectsContext() {
  const context = baseContext({
    game: { i18n: { localize: key => key }, user: { isGM: true } },
    ui: { notifications: { warn: () => {}, error: () => {} } },
    Hooks: { once: () => {}, on: () => {} },
    CONFIG: { statusEffects: [] },
    foundry: { utils: { deepClone: value => structuredClone(value), getProperty: () => undefined } }
  });
  load(context, 'scripts/item-effect-adapter.js');
  load(context, 'scripts/dx3rd-applied-effects.js');
  return context;
}

/** appliedKey 하나가 걸린 액터. item 은 그 AE 의 출처. */
function actorWithApplied(appliedKey, item) {
  return {
    items: new Map([[item.id, item]]),
    effects: [{
      id: `ae_${appliedKey}`,
      disabled: false,
      getFlag: (_scope, field) => (field === 'appliedKey' ? appliedKey : { itemId: item.id })
    }]
  };
}

test('only the activation channel routes an applied buff back to the item toggle', () => {
  const context = appliedEffectsContext();
  const getSource = context.DX3rdAppliedEffects.getToggleSourceItem;
  const attributes = { 0: { key: 'add', value: '2' } };

  // 동결 채널: active.state 는 켜져 있어도 false 다. 아이템으로 라우팅하면 toggleActive 가
  // 늘 "켜기"로 읽어 toggle AE 를 하나 더 만든다(같은 보정 2중 가산) → AE.disabled 가 상태여야 한다.
  const frozen = { id: 'i1', type: 'effect', system: { timing: 'major', attributes, active: { applyMode: 'onUse', state: false } } };
  assert.equal(getSource(actorWithApplied('applied_i1', frozen), 'applied_i1'), null);

  // 활성화 채널(상시 이펙트): 진짜 상태는 아이템의 active.state 다.
  const always = { id: 'i2', type: 'effect', system: { timing: 'always', attributes, active: { applyMode: 'onUse', state: true } } };
  assert.equal(getSource(actorWithApplied('applied_i2', always), 'applied_i2'), always);

  // 'toggle:' 파생은 정의상 아이템이 상태다(플래그를 못 읽어도 키만으로 해석).
  const toggled = { id: 'i3', type: 'effect', system: { timing: 'major', attributes, active: { applyMode: 'toggle', state: true } } };
  assert.equal(getSource(actorWithApplied('toggle:i3', toggled), 'toggle:i3'), toggled);

  // 장비는 장착 체크가 원본이므로 아이템 토글로 라우팅하면 안 된다(sync 가 되돌린다).
  const armor = { id: 'i4', type: 'protect', system: { attributes, active: {}, equipment: true } };
  assert.equal(getSource(actorWithApplied('applied_i4', armor), 'applied_i4'), null);
});

test('a frozen self buff already in prepareData is not added again by a combo roll', () => {
  const context = baseContext({
    game: { i18n: { localize: key => key } },
    ui: { notifications: { warn: () => {} } },
    Hooks: { once: () => {}, on: () => {} }
  });
  load(context, 'scripts/sheets/combo-data.js');
  const getPersistent = context.DX3rdComboData.getPersistentEffectIds;

  const effectItem = (id, state = false) => [id, { id, type: 'effect', system: { active: { state } } }];
  const appliedAE = (itemId, disabled = false) => ({
    id: `ae_${itemId}`, disabled,
    getFlag: (_scope, field) => (field === 'appliedKey' ? `applied_${itemId}` : { itemId })
  });

  const actor = {
    items: new Map([effectItem('toggled', true), effectItem('frozen'), effectItem('frozenOff'), effectItem('idle')]),
    effects: [appliedAE('frozen'), appliedAE('frozenOff', true)]
  };
  actor.items[Symbol.iterator] = function* () { yield* this.values(); };

  const persistent = getPersistent(actor);
  assert.ok(persistent.has('toggled'), '활성화 채널 — 기존 동작');
  assert.ok(persistent.has('frozen'), '동결 채널도 이미 total 에 있다 — 콤보가 또 더하면 2중');
  assert.ok(!persistent.has('frozenOff'), '꺼둔 AE 는 total 에 없다 → 콤보가 더해야 한다');
  assert.ok(!persistent.has('idle'), '걸린 적 없는 이펙트는 콤보가 더해야 한다');
});

test('no apply path hijacks a toggle-derived applied key', () => {
  // 같은 아이템에서 왔다는 이유로 'toggle:' 키를 집어 덮어쓰면, 동결값이 다음 sync 에
  // 되돌려지거나(payloadChanged) 걸 보정이 없을 때 남의 토글 AE 를 지운다.
  // 적용 경로가 둘(_applyItemAttributes / _applyEffectDataToActor)이므로 전부 검사한다.
  const text = readFileSync(resolve(root, 'scripts/handlers/universal-apply.js'), 'utf8');
  const lookups = [...text.matchAll(/const existingEff = [\s\S]{0,400}?;/g)].map(match => match[0]);
  assert.ok(lookups.length >= 2, '적용 경로를 찾지 못했다 — 정규식이 낡았다');
  for (const lookup of lookups) {
    assert.match(lookup, /appliedKey[\s\S]*startsWith\('toggle:'\)/, '토글 파생 키를 제외해야 한다');
  }
});

/**
 * universal-apply.js 만 단독으로 싣는 컨텍스트. 믹스인 대상(DX3rdUniversalHandler)을 빈
 * 객체로 두면 Object.assign 이 그대로 동작해, 핸들러 본체 없이 적용 경로만 실행할 수 있다.
 */
function applyHandlerContext({ isGM = true } = {}) {
  const writes = [];
  const emitted = [];
  const context = baseContext({
    game: { i18n: { localize: key => key }, user: { isGM, targets: new Set() } },
    ui: { notifications: { info: () => {}, warn: () => {}, error: () => {} }, windows: {} },
    foundry: { utils: { deepClone: value => structuredClone(value) } }
  });
  context.DX3rdUniversalHandler = {};
  context.DX3rdFormulaEvaluator = {
    prepareRollFormula: value => String(value ?? ''),
    isRollTimeKey: () => false,
    hasDice: () => false,
    evaluate: value => Number(value) || 0
  };
  context.DX3rdAppliedEffects = {
    set: (actor, key, payload) => { writes.push({ actor, key, payload }); return payload; },
    remove: (actor, key) => { writes.push({ actor, key, payload: null }); return true; }
  };
  context.DX3rdSocketRouter = {
    emit: message => emitted.push(message),
    emitToActorExecutor: message => emitted.push(message)
  };
  load(context, 'scripts/handlers/universal-apply.js');
  return { context, handler: context.DX3rdUniversalHandler, writes, emitted };
}

test('an empty forced target list never falls back to current UI targets', async () => {
  const { context, handler } = applyHandlerContext();
  const wrongTarget = { id: 'wrong-target', name: '현재 UI 대상', isOwner: true, effects: [] };
  context.game.user.targets = new Set([{ id: 'wrong-token', actor: wrongTarget }]);
  const applied = [];
  handler.dispatchItemAttributes = async (_source, _item, target) => applied.push(target.id);

  await handler.applyToTargets(
    { id: 'caster', name: '시전자' },
    {
      id: 'effect', name: '데미지 후 대상 보정', type: 'effect',
      system: {
        getTarget: true,
        effect: {
          disable: 'round', runTiming: 'afterDamage',
          attributes: { dice: { key: 'dice', value: '1' } }
        }
      }
    },
    'afterDamage',
    [],
    'attack'
  );

  assert.deepEqual(applied, [], '고정된 피해 대상이 0명이면 현재 UI 타겟에 적용하면 안 된다');
});

test('a serialized target buff keeps the sub-bucket label instead of the key', async () => {
  // label 을 key 로 덮어쓰면 actor.js bucket 이 '_'(무한정)으로 흘려보낸다 →
  // 백병 한정 보정이 사격·맨손 공격까지 올려주는 과적용이 된다.
  const { handler, writes } = applyHandlerContext();
  const target = { id: 't1', name: '대상', effects: [] };
  await handler._applyEffectDataToActor(
    { name: '시전자' },
    { id: 'i1', name: '이펙트' },
    target,
    { a0: { key: 'attack', label: 'melee', value: '3' } }
  );
  const attributes = writes[0]?.payload?.attributes || {};
  assert.deepEqual(plain(attributes['attack:melee']), { key: 'attack', label: 'melee', value: 3 });
});

test('a serialized target buff does not overwrite the item toggle AE', async () => {
  const { handler, writes } = applyHandlerContext();
  const toggleAE = { getFlag: (_scope, field) => (field === 'appliedKey' ? 'toggle:i1' : { itemId: 'i1' }) };
  const target = { id: 't1', name: '자신', effects: [toggleAE] };
  await handler._applyEffectDataToActor(
    { name: '시전자' },
    { id: 'i1', name: '이펙트' },
    target,
    { a0: { key: 'dice', value: '2' } }
  );
  assert.ok(writes[0]?.key?.startsWith('applied_i1_'), `토글 키를 집었다: ${writes[0]?.key}`);
});

test('a target you cannot write is handed to the GM, one you own is applied locally', async () => {
  const { handler, writes, emitted } = applyHandlerContext({ isGM: false });
  const caster = { id: 'a1', name: '시전자' };
  const item = { id: 'i1', name: '이펙트', system: { effect: { disable: 'round' } } };
  const attrs = { a0: { key: 'dice', value: '2' } };

  await handler.dispatchItemAttributes(caster, item, { id: 't1', name: '적', isOwner: false, effects: [] }, attrs);
  assert.equal(writes.length, 0, '쓸 권한이 없으면 직접 쓰면 안 된다');
  assert.equal(emitted[0]?.type, 'applyItemAttributes');

  await handler.dispatchItemAttributes(caster, item, { id: 't2', name: '나', isOwner: true, effects: [] }, attrs);
  assert.equal(emitted.length, 1, '소유한 대상은 GM 이 없어도 로컬에서 적용돼야 한다');
  assert.equal(writes.length, 1);
});

test('a remote target receives runtime and usage-level formulas frozen by the using client', async () => {
  const { context, handler, writes, emitted } = applyHandlerContext({ isGM: false });
  context.DX3rdFormulaEvaluator = {
    prepareRollFormula(value, _item, actor) {
      return String(value ?? '')
        .replace(/\[소비HP\*3\]/g, String((Number(actor?._dx3rdRuntimeInput) || 0) * 3))
        .replace(/\[level\]/gi, String(Number(actor?._dx3rdUsageEncLevel) || 0));
    },
    isRollTimeKey: () => false,
    hasDice: () => false,
    evaluate(value, item, actor) {
      return Number(this.prepareRollFormula(value, item, actor)) || 0;
    }
  };

  const caster = {
    id: 'a1', name: '시전자', _dx3rdRuntimeInput: 4, _dx3rdUsageEncLevel: 2
  };
  const item = {
    id: 'i1', name: '선혈의 연주자', img: 'x.png', actor: caster,
    system: { effect: { disable: 'round' } }
  };
  const attrs = {
    a0: { key: 'attack', value: '[소비HP*3]' },
    a1: { key: 'init', value: '[level]' }
  };
  const target = { id: 't1', name: '다른 소유자의 대상', isOwner: false, effects: [] };

  await handler.dispatchItemAttributes(caster, item, target, attrs);
  const payload = emitted[0]?.payload;
  assert.equal(payload?.preEvaluated, true);
  assert.equal(payload?.targetAttributes?.a0?.value, 12,
    '소비 HP는 사용 클라이언트의 일시 문맥에서 동결되어야 한다');
  assert.equal(payload?.targetAttributes?.a1?.value, 2,
    '사용 전 침식률 단계도 소켓을 넘기 전에 동결되어야 한다');

  delete caster._dx3rdRuntimeInput;
  delete caster._dx3rdUsageEncLevel;
  await handler._applyItemAttributes(caster, item, target, payload.targetAttributes, { preEvaluated: true });
  assert.equal(writes[0]?.payload?.attributes?.attack?.value, 12,
    '수신 클라이언트는 동결값을 자기 문맥으로 재평가하면 안 된다');
  assert.equal(writes[0]?.payload?.attributes?.init?.value, 2);
});

test('the sheet apply button uses the same target pipeline as item use', async () => {
  // 직렬화 경로로 보내면 원본 Item 을 잃어 [level] 이 0 으로 떨어지고 권한 분기도 없다.
  const { context, handler, writes } = applyHandlerContext();
  const target = { id: 't1', name: '대상', isOwner: true, effects: [] };
  context.game.user.targets = [{ actor: target }];
  const item = {
    id: 'i1',
    name: '이펙트',
    img: 'x.png',
    system: { effect: { disable: 'round', attributes: { a0: { key: 'attack', label: 'melee', value: '2' } } } }
  };

  const applied = await handler.applyChosenItemEffect({ id: 'a1', name: '시전자' }, item);
  assert.equal(applied, true);
  // 직렬화 경로는 키에 타임스탬프를 붙인다 — 사용 파이프라인과 같은 키여야 한다.
  assert.equal(writes[0]?.key, 'applied_i1');
});

test('direct use may activate a toggle bucket, but combo members never force activation', () => {
  const universal = source('scripts/handlers/universal-handler.js');
  const combo = source('scripts/handlers/combo-handler.js');

  assert.match(universal, /applySelfModifiers\(actor, item, \{ forceToggle: useMeansActivate, action, timing: 'instant' \}\)/,
    '단독 사용은 활성화 채널을 켤 수 있어야 한다');
  assert.match(combo, /applySelfModifiers\(actor, memberItem, \{ action: memberAction, timing: 'instant' \}\)/,
    '콤보 멤버는 기존 발동 액션만 넘겨야 한다');
  assert.doesNotMatch(combo, /applySelfModifiers\(actor, memberItem, \{[^}]*forceToggle/,
    '콤보에 넣었다는 이유로 활성화 버킷을 강제로 켜면 안 된다');
  // 구성원 목록의 출처는 comboMemberItems 한 곳이고, 그것은 effect 슬롯(normalizeEffectIds)만
  // 읽으면서 무기/비클을 걸러 낸다. 무기 슬롯은 공격 수치·attack-used 라는 자기 경로가 따로 있어
  // 여기에 합치면 선택형 「사용」 효과까지 자동 발동한다.
  assert.match(combo, /comboMemberItems\?\.\(actor, comboItem\)/,
    '구성원 열거는 공용 comboMemberItems 를 거쳐야 한다');
  const extensions = source('scripts/handlers/universal-extensions.js');
  assert.match(extensions.replace(/\s+/g, ' '),
    /comboMemberItems\(actor, comboItem\) \{ return this\.normalizeEffectIds\(comboItem\)/,
    'comboMemberItems 는 effect 슬롯만 읽어야 한다 — 무기 슬롯을 합치면 안 된다');
  assert.match(extensions.replace(/\s+/g, ' '),
    /isComboMemberItem\(item\) \{ return Boolean\(item\) && !\['weapon', 'vehicle'\]\.includes\(item\.type\)/,
    '무기/비클은 자기 경로가 따로 있으므로 구성원에서 제외해야 한다');
});

test('the exhausted-use setting reaches every place that could block on exhaustion', () => {
  // allowExhaustedUse 는 소진 **판정**이 아니라 그것을 **차단으로 이을지**만 정한다(기본 허용).
  // 채팅 카드가 이 설정을 보지 않고 버튼을 아예 렌더하지 않아서, 설정을 켜 두어도 카드에서는
  // 누를 것이 없었다 — 시트에서 직접 누르면 통과하므로 「설정이 안 먹는다」로 보였다.
  const chatCard = source('scripts/sheets/actor-chat.js');
  assert.match(chatCard, /window\.DX3rdItemExhausted\?\.allowExhaustedUse\?\.\(\) !== false/,
    '채팅 카드도 설정을 봐야 한다');
  assert.doesNotMatch(chatCard, /showUseButton = false|showAttackButton = false/,
    '소진을 이유로 버튼을 무조건 숨기면 설정이 무력해진다');
  assert.match(chatCard, /markExhausted\(useText, useExhausted\)/,
    '남길 때는 방어·리액션 목록과 같이 「소진」을 표시해야 한다');

  // afterSuccess 활성화만 경고조차 없이 조용히 건너뛰었다. 나머지 소진 지점은 전부
  // reportUsageExhausted 로 알림과 채팅 기록을 남긴다.
  const chat = source('scripts/chat/chat-ui.js').replace(/\s+/g, ' ');
  assert.match(chat, /proceed = await window\.DX3rdUniversalHandler\.reportUsageExhausted\(actor, item, detail\)/,
    '무기/비클의 afterSuccess 소진도 공용 보고 경로를 타야 한다');
  assert.doesNotMatch(chat, /if \(usedDisable === 'notCheck' \|\| usedState < usedMax\) \{ if \(window\.DX3rdChatHandlers/,
    '설정을 보지 않는 조용한 건너뛰기를 되살리지 말 것');

  // 시트의 소진 표시는 설정과 무관하게 남는다 — 차단과 표시는 다른 축이다.
  assert.match(source('templates/actor/actor-sheet-v2.html'), /isItemExhausted item \.\.\/actor\)\}\}item-exhausted/,
    '소진 표시는 설정과 무관하게 그대로 둔다');
});

test('every usage condition gate is switchable, and none of them blocks by default', () => {
  // 소진 게이트와 같은 축이다 — 위반 「판정」은 그대로 하고, 그것을 「차단으로 이을지」만
  // 설정이 정한다. 게이트 하나라도 설정 밖에 남으면 그 진입점에서만 설정이 무력해지고,
  // 사용자에게는 「설정이 안 먹는다」로 보인다(소진에서 실제로 넷이 그랬다).
  const GATES = {
    resurrect: 'allowResurrectViolation',
    encroachLimit: 'allowEncroachLimitViolation',
    berserk: 'allowBerserkViolation',
    pressure: 'allowPressureViolation'
  };

  const helpers = source('scripts/helpers.js');
  const main = source('scripts/main.js').replace(/\s+/g, ' ');
  const handler = source('scripts/handlers/universal-handler.js');

  for (const [gate, setting] of Object.entries(GATES)) {
    assert.match(helpers, new RegExp(`${gate}: '${setting}'`),
      `${gate} 게이트가 설정 판독기에 등록돼야 한다`);
    // 기본값은 「막지 않음」이다. default: false 로 뒤집으면 기존 월드가 갑자기 막힌다.
    assert.match(main, new RegExp(`'${setting}', \\{[^}]*default: true`),
      `${setting} 은 월드 설정으로 등록되고 기본값이 true(막지 않음)여야 한다`);
    assert.match(handler, new RegExp(`reportUsageGate\\(actor, item, '${gate}'`),
      `${gate} 위반은 공용 보고 경로를 타야 한다`);
  }

  // 다섯 번째 게이트는 방어 무시다. 보고 자리가 universal-handler 가 아니라 데미지 창이라
  // 위 루프의 마지막 검사가 성립하지 않을 뿐, 설정·기본값의 규칙은 완전히 같다.
  assert.match(helpers, /defenseBypass: 'allowDefenseBypassViolation'/,
    '방어 무시 게이트가 설정 판독기에 등록돼야 한다');
  assert.match(main, /'allowDefenseBypassViolation', \{[^}]*default: true/,
    'allowDefenseBypassViolation 도 기본값이 true(막지 않음)여야 한다');

  // 게이트 자리에 직접 return false 를 두면 설정을 건너뛴다. 넷 다 보고 경로 뒤에만 있어야 한다.
  const flat = handler.replace(/\s+/g, ' ');
  assert.doesNotMatch(flat, /Resurrect item blocked - HP is not 0/,
    '리저렉트 HP 검사가 설정을 보지 않고 직접 막던 자리를 되살리지 말 것');
  assert.doesNotMatch(flat, /Item usage blocked - Encroachment below limit/,
    '침식률 제한이 설정을 보지 않고 직접 막던 자리를 되살리지 말 것');
  assert.doesNotMatch(flat, /리저렉트 아이템은 침식률 100% 미만에서만 사용 가능/,
    '리저렉트 침식률 검사는 한 벌뿐이다 — limit 블록 안의 사본은 도달 불가였고, 지금은 설정을 무시했을 자리다');

  // 막지 않을 때도 경고와 채팅 기록은 남는다 — GM 이 「원래는 못 쓰는 것을 썼다」를 놓치면 안 된다.
  assert.match(flat, /async reportUsageGate\(actor, item, gate, detail\) \{[^]*?DX3rd\.GateUseAllowed/,
    '허용 경로에서도 사유를 남겨야 한다');

  // [폭주] 는 게이트가 두 자리다 — 진짜 차단(processItemUsageCost)과, 판정 다이얼로그의
  // 리액션·닷지 버튼 비활성화. 뒤쪽이 설정을 보지 않으면 버튼이 죽은 채라 설정이 무력해진다.
  const rollDialog = source('scripts/handlers/universal-roll-dialog.js').replace(/\s+/g, ' ');
  assert.match(rollDialog, /isReactionDodgeBlocked = berserkActive[^;]*DX3rdUsageGates\?\.allows\?\.\('berserk'\) === false/,
    '판정 다이얼로그의 리액션·닷지 비활성화도 allowBerserkViolation 을 봐야 한다');
  assert.match(rollDialog, /isExceptionItem = [^;]*DX3rdUsageGates\?\.conditionExempt\?\.\(item, 'berserk'\)/,
    '예외 판정은 DX3rdUsageGates.conditionExempt 한 곳이어야 한다');
  assert.doesNotMatch(rollDialog, /BerserkReactionExceptionItems/,
    '이름 목록을 직접 파싱하던 자리를 되살리지 말 것 — 아이템 저작을 보지 못한다');

  // 세 번째 자리: 데미지 적용 창의 가드. 같은 규칙이므로 같은 게이트를 쓴다.
  const damageDialog = source('scripts/handlers/universal-damage-dialog.js').replace(/\s+/g, ' ');
  assert.match(damageDialog, /berserkBlocksGuard\(\) && window\.DX3rdUsageGates\?\.allows\?\.\('berserk'\) === false/,
    '가드 입력 비활성화도 allowBerserkViolation 을 봐야 한다');
  assert.match(damageDialog, /guardAllowed = await window\.DX3rdUniversalHandler\?\.reportUsageGate\?\.\(.{0,160}?'berserk'/,
    '허용 상태로 가드했으면 공용 보고 경로로 경고를 남겨야 한다');
  // 계산 시점에 다시 보지 않으면, 창을 열어 둔 사이 [폭주]에 걸린 대상에게 설정이 무력해진다.
  assert.match(damageDialog, /guardChecked: guardAllowed/,
    '보고 결과가 실제 가드 계산에 반영돼야 한다 — 경고만 하고 그대로 깎으면 차단 설정이 무력하다');
});

test('an effect can be authored as exempt from pressure and berserk', () => {
  // 게이트 설정은 테이블 단위, 예외 저작은 아이템 단위다. 게이트를 켜 둔(=차단하는)
  // 테이블에서도 원문상 예외인 이펙트는 통과해야 한다.
  const helpers = source('scripts/helpers.js').replace(/\s+/g, ' ');
  assert.match(helpers, /conditionExempt: function\(item, condition\)/,
    '예외 판정은 한 곳이어야 한다');
  assert.match(helpers, /item\?\.system\?\.conditionExempt\?\.\[condition\] === true/,
    '아이템 저작을 근거로 삼아야 한다');
  assert.match(helpers, /DX3rd\.PressureExceptionItems[^]*?DX3rd\.BerserkReactionExceptionItems/,
    '구 이름 목록 설정도 계속 인정한다 — 그것만 쓰던 월드가 있다');

  // 미선언 필드는 저장되는 것처럼 보이고 다음 로드에서 사라진다.
  assert.match(source('scripts/data/document-schema.js'),
    /conditionExempt: \{ pressure: false, berserk: false \}/,
    '스키마에 선언하지 않으면 체크가 조용히 풀린다');

  // 저작 자리는 확장 도구의 이펙트 설정 하나뿐이고, 체크박스는 _checked 로 읽는다
  // (문자열 "on" 은 BooleanField._cast 가 false 로 뒤집는다).
  const dialog = source('scripts/dialog/item-extend-dialog.js').replace(/\s+/g, ' ');
  assert.match(dialog, /'system\.conditionExempt\.pressure': this\._checked\(/,
    '[중압] 예외는 _checked 로 저장해야 한다');
  assert.match(dialog, /'system\.conditionExempt\.berserk': this\._checked\(/,
    '[폭주] 예외는 _checked 로 저장해야 한다');
  assert.match(source('templates/dialog/item-extend-dialog.html'),
    /name="effectSettingsPressureExempt"/,
    '확장 도구의 이펙트 설정에 체크 칸이 있어야 한다');

  // 게이트는 예외를 먼저 보고, 예외가 아닐 때만 설정에 묻는다.
  const handler = source('scripts/handlers/universal-handler.js').replace(/\s+/g, ' ');
  for (const condition of ['pressure', 'berserk']) {
    assert.match(handler,
      new RegExp(`conditionExempt\\?\\.\\(item, '${condition}'\\)[^]*?reportUsageGate\\(actor, item, '${condition}'`),
      `${condition} 은 예외 판정을 먼저 통과시켜야 한다`);
  }
});

test('the actor sheet only shows a usage counter for items that have one', () => {
  const sheet = source('templates/actor/actor-sheet-v2.html');
  assert.doesNotMatch(sheet, /used-input" value="\{\{item\.system\.used\.state\}\}" \{\{#ifEquals/,
    '사용 횟수를 쓰지 않는 아이템에 비활성 「0 / 0」 칸을 내지 말 것');
  // 카운터를 그리는 자리는 전부 같은 게이트를 쓴다(이펙트·이지·엑스트라·사이오닉 + 장비 탭 4곳).
  const gates = sheet.match(/\{\{#unless \(eq item\.system\.used\.disable "notCheck"\)\}\}/g) || [];
  const inputs = sheet.match(/class="checkbox-input used-input"[^>]*value="\{\{item\.system\.used\.state\}\}"/g) || [];
  assert.equal(gates.length, inputs.length,
    '사용 횟수 칸과 게이트 수가 같아야 한다 — 하나라도 게이트 밖이면 그 목록만 늘 표시된다');

  // 두 자리 값이 잘리지 않도록 이 칸만 넓힌다(공용 .checkbox-input 은 22px 그대로).
  assert.match(source('styles/appv2-sheets.css').replace(/\s+/g, ' '),
    /\.item-addon \.used-input \{ flex: 0 0 30px; width: 30px;/,
    '사용 횟수 칸의 고정폭이 사라지면 두 자리가 다시 잘린다');
});

test('weapon row counters prioritize attacks and save only the selected schema axis', async () => {
  const sheet = source('templates/actor/actor-sheet-v2.html');
  assert.match(sheet, /\{\{#if item\.showAttackCounter\}\}[\s\S]*?data-counter="attack-used"[\s\S]*?item\.system\.attack-used\.state[\s\S]*?\{\{else\}\}[\s\S]*?item\.system\.used\.state/);
  const context = baseContext();
  load(context, 'scripts/sheets/actor-sheet-data.js');
  const writes = [];
  const item = { update: async change => writes.push(change) };
  const actor = { items: { get: () => item } };
  await context.DX3rdActorSheetData.updateOwnedItemUsedState(actor, 'weapon', '2', 'attack-used');
  await context.DX3rdActorSheetData.updateOwnedItemUsedState(actor, 'weapon', '1');
  await context.DX3rdActorSheetData.updateOwnedItemUsedState(actor, 'weapon', '3', 'unexpected');
  assert.equal(JSON.stringify(writes), JSON.stringify([
    { 'system.attack-used.state': 2 }, { 'system.used.state': 1 }, { 'system.used.state': 3 }
  ]));
});

test('a non-attack combo does not spend its registered weapons on nothing', () => {
  // calculateRegisteredWeaponBonus 의 호출부는 둘 다 attackRoll !== '-' 안에 있다. 그래서
  // 비공격 콤보는 등록 무기를 판정에도 데미지에도 싣지 않는데, 예전에는 그 무기의
  // attack-used 만 선증가시켰다 — 게다가 이 자리에는 소진 게이트가 없어(다른 소비 지점은
  // allowExhaustedUse 를 보거나 reportUsageExhausted 로 알린다) max 를 조용히 넘겼다.
  const combo = source('scripts/handlers/combo-handler.js');
  assert.match(combo, /const skipPreIncrement = !isEnemyAchievementShortcut \|\| options\.skipWeaponAttackSpend === true;/,
    '선증가는 에너미 명중 달성치 경로에서만 — 공격 콤보는 데미지 롤이, 비공격 콤보는 아무도 안 센다');

  const roll = source('scripts/handlers/combo-handler.js').replace(/\s+/g, ' ');
  assert.match(roll, /calculateRegisteredWeaponBonus\(actor, item\)/,
    '전제 확인 — 무기 보너스는 여전히 공격 경로에서 계산한다');
});

test('one predicate decides who counts as a combo member', () => {
  // 사용 횟수 「검사」(universal-handler)·「증가」(combo-handler)·「실행」(comboMemberEntries)이
  // 서로 다른 기준으로 멤버를 고르면, 검사는 건너뛰는데 횟수는 올라가고 실행까지 되는 비대칭이
  // 난다. 실제로 셋이 각각 `type === 'effect'` / 무기·비클만 제외 / 필터 없음 이었다.
  const universal = source('scripts/handlers/universal-handler.js');
  const combo = source('scripts/handlers/combo-handler.js');

  assert.match(universal, /for \(const effect of this\.comboMemberItems\(actor, item\)\)/,
    '사용 횟수 검사도 공용 멤버 목록을 써야 한다');
  assert.doesNotMatch(universal, /if \(effect && effect\.type === 'effect'\)/,
    '검사 쪽에서 멤버 자격을 다시 판정하면 안 된다(레벨 가산의 effect 한정은 별개 축이라 남는다)');
  assert.doesNotMatch(combo, /entry\.role !== 'weapon' && !\['weapon', 'vehicle'\]/,
    '횟수 증가 쪽에서 타입을 다시 판정하면 안 된다');

  // 저장 형식 해석도 한 곳이어야 한다 — 자체 구현본은 콤보의 system.effect 가 설정 객체라는
  // 것을 몰라 'instant' 같은 값을 아이템 id 로 집어 들었다.
  for (const path of ['scripts/helpers.js', 'scripts/sheets/actor-chat.js', 'scripts/handlers/combo-handler.js']) {
    assert.doesNotMatch(source(path), /Object\.values\(rawEffects\)/,
      `${path}: effectIds 해석을 자체 구현하지 말고 normalizeEffectIds 를 쓸 것`);
  }
});

test('the combo member dropdown offers every usable item type, not only effects', () => {
  // 「판정 없이 그냥 사용」하는 아이템(once 소모품, etc, connection, …)은 「사용」 액션이 있는데도
  // 드롭다운이 effect 만 나열해서 콤보에 넣을 방법이 없었다 — 리저렉트가 된 것은 effect 타입이라서다.
  const context = baseContext({ Hooks: { once() {}, on() {} } });
  load(context, 'scripts/handlers/universal-handler.js');
  load(context, 'scripts/handlers/universal-extensions.js');
  const handler = context.DX3rdUniversalHandler;

  // 후보로 올리는 것은 전부 실행 가능한 멤버여야 한다 — 후보 ⊂ 멤버 불변식.
  for (const type of ['effect', 'psionic', 'spell', 'book', 'connection', 'etc', 'once']) {
    assert.equal(handler.isComboMemberOption({type}), true, `${type} 는 멤버 후보여야 한다`);
    assert.equal(handler.isComboMemberItem({type}), true, `${type} 는 실행 멤버여야 한다`);
  }
  // 무기/비클은 무기 슬롯(system.weapon) 경로가 따로 있고, 방어구는 사용 메뉴가 콤보를 제공하지
  // 않는다(_onItemToChat 의 allowCombo). 나머지 타입에는 사용 액션 자체가 없다.
  for (const type of ['weapon', 'vehicle', 'protect', 'combo', 'works', 'syndrome', 'rois', 'record']) {
    assert.equal(handler.isComboMemberOption({type}), false, `${type} 은 멤버 후보가 아니어야 한다`);
  }

  // 드롭다운이 공용 판정을 거치지 않으면 런타임과 다시 어긋난다.
  const comboData = source('scripts/sheets/combo-data.js').replace(/\s+/g, ' ');
  assert.match(comboData, /isComboMemberOption/,
    '멤버 추가 드롭다운은 공용 판정 isComboMemberOption 을 써야 한다');
  assert.doesNotMatch(comboData, /items\.filter\(item => item\.type === 'effect'\)/,
    '드롭다운이 effect 타입으로 다시 좁히면 안 된다');
});

test('the combo sheet member options include non-effect usable items', () => {
  const context = baseContext({ Hooks: { once() {}, on() {} } });
  context.DX3rdItemSheetData = {};
  load(context, 'scripts/handlers/universal-handler.js');
  load(context, 'scripts/handlers/universal-extensions.js');
  load(context, 'scripts/sheets/combo-data.js');

  const make = (type, i) => ({id: `${type}-${i}`, name: `${type}-${i}`, type, sort: i});
  const items = [
    make('effect', 1), make('once', 2), make('etc', 3), make('connection', 4),
    make('spell', 5), make('psionic', 6), make('book', 7),
    make('weapon', 8), make('vehicle', 9), make('protect', 10),
    make('combo', 11), make('rois', 12)
  ];
  const data = {};
  context.DX3rdComboData.prepareActorEffectOptions(data, {items});

  assert.deepEqual(Object.keys(data.actorEffect).sort(), [
    'effect-1', 'once-2', 'etc-3', 'connection-4', 'spell-5', 'psionic-6', 'book-7'
  ].sort());
});

test('the combo preview counts non-effect members and their live applied effects', () => {
  // 런타임은 멤버의 사용 버킷을 타입 무관하게 발화한다 — 미리보기가 effect 만 세면
  // once 멤버의 +수정치가 시트 숫자에서 빠진다. 그리고 사용으로 이미 걸려 있는 적용 AE 는
  // 타입과 무관하게 「이미 적용 중」으로 빠져야 한다(이중 계산 방지).
  const context = baseContext({
    game: { i18n: { localize: key => key }, user: { targets: new Set() } },
    foundry: { utils: { deepClone: value => structuredClone(value) } },
    Hooks: { once() {}, on() {} }
  });
  load(context, 'scripts/item-effect-adapter.js');
  load(context, 'scripts/handlers/universal-handler.js');
  load(context, 'scripts/handlers/universal-extensions.js');
  load(context, 'scripts/sheets/combo-data.js');
  context.DX3rdFormulaEvaluator = { evaluate: value => Number(value) || 0 };
  const comboData = context.DX3rdComboData;

  const member = {
    id: 'once-1', name: '소모품', type: 'once',
    system: {
      active: { state: false, disable: 'session', runTiming: 'instant', applyMode: 'onUse' },
      attributes: { a0: { key: 'add', value: '2' } }
    },
    getFlag: () => ({})
  };
  const actor = { id: 'a1', items: new Map([[member.id, member]]), effects: [] };
  actor.items[Symbol.iterator] = function* () { yield* this.values(); };
  const rollContext = { rollType: 'major', isAbility: false, skillKey: 'melee', effectiveBaseKey: 'body' };

  let bonus = comboData.calculateRegisteredEffectRollBonus(actor, [member.id], rollContext, 10, 'use');
  assert.equal(bonus.add, 2, 'once 멤버의 사용 수정치도 미리보기에 합산되어야 한다');

  // 이미 적용 중(applyMode onUse 로 남은 AE)이면 미리보기에서 빠진다 — effect 와 같은 규칙.
  actor.effects = [{ disabled: false, getFlag: (_s, k) => (k === 'applied' ? { itemId: member.id } : undefined) }];
  bonus = comboData.calculateRegisteredEffectRollBonus(actor, [member.id], rollContext, 10, 'use');
  assert.equal(bonus.add, 0, '적용 중인 멤버는 이중 계산하면 안 된다');
});

test('combo members preserve prior use and attack behavior while blocking activation', () => {
  const context = baseContext({
    game: { i18n: { localize: key => key, format: key => key } },
    ui: { notifications: { warn: () => {} } },
    CONFIG: { statusEffects: [] },
    Hooks: { once: () => {}, on: () => {} },
    foundry: { utils: { deepClone: value => structuredClone(value), getProperty: () => undefined } }
  });
  load(context, 'scripts/item-effect-adapter.js');
  load(context, 'scripts/handlers/combo-handler.js');
  const combo = context.DX3rdComboHandler;
  const base = {
    type: 'effect',
    system: {
      timing: 'major',
      attributes: { a0: { key: 'add', value: '2' } },
      active: { state: false, disable: 'major', runTiming: 'instant', applyMode: 'toggle', action: 'activation' }
    }
  };

  assert.equal(combo.comboMemberAction({ type: 'effect', system: {} }), 'use');
  assert.equal(combo.comboMemberAction({ type: 'effect', system: { attackRoll: 'melee' } }), 'attack');
  assert.equal(combo.comboMemberAction({ type: 'weapon', system: {} }, 'weapon'), 'attack');
  assert.equal(combo.comboMemberAction({ type: 'etc', system: {} }), 'use');
  assert.equal(combo.comboMemberAction({ type: 'once', system: {} }), 'use');
  const attackAuthored = {
    type: 'effect',
    system: {
      attributes: {a0: {key: 'add', value: '2'}},
      active: {state: false, disable: 'major', runTiming: 'instant', action: 'attack', applyMode: 'onUse'}
    }
  };
  assert.equal(combo.comboMemberAction(attackAuthored, 'attack'), 'attack',
    '비공격 이펙트라도 명시한 공격 버킷은 공격 콤보에서 발현해야 한다');
  assert.equal(combo.comboMemberAction(attackAuthored, 'activation'), 'use',
    '콤보 포함이 활성화 액션을 물려주면 안 된다');
  assert.equal(combo.memberSelfModifiersFireAt(base, 'use', 'instant'), false,
    '활성화 전용 카드는 콤보로 켜지면 안 된다');
  const split = structuredClone(base);
  split.system.attributes.a1 = { key: 'dice', value: '1', action: 'use' };
  assert.equal(combo.memberSelfModifiersFireAt(split, 'use', 'instant'), true,
    '같은 아이템에 명시된 사용 버킷은 콤보에서도 발현해야 한다');

  const extensionMember = action => ({
    id: `member-${action}`, name: action, type: 'effect',
    system: { active: { runTiming: 'instant' } },
    getFlag: () => ({ heal: { activate: true, action, timing: 'instant', target: 'self' } })
  });
  const collected = combo.collectExtensions(
    { id: 'actor' },
    [extensionMember('activation'), extensionMember('use'), extensionMember('attack')],
    { comboItemId: 'combo', action: 'attack' }
  );
  assert.deepEqual(plain(collected.map(entry => entry.itemId)), ['member-use', 'member-attack'],
    '구성 멤버 익스텐션은 사용/공격을 이전처럼 보존하고 활성화만 제외해야 한다');

  const attackExtension = {
    id: 'weapon-1', name: '무기', type: 'weapon',
    system: { active: { runTiming: 'instant' } },
    getFlag: () => ({ condition: { activate: true, action: 'attack', timing: 'afterDamage', target: 'targetToken', type: 'poisoned' } })
  };
  const weaponCollected = combo.collectExtensions(
    { id: 'actor' }, [attackExtension], { comboItemId: 'combo', action: 'use' }
  );
  assert.deepEqual(plain(weaponCollected.map(entry => [entry.itemId, entry.type])), [['weapon-1', 'condition']],
    '기존 공격 시 상태이상/확장도구 수집은 유지해야 한다');
});

test('every use message includes its item description as smaller chat text', () => {
  const handler = source('scripts/handlers/universal-handler.js');
  const styles = source('styles/styles.css');
  // 타입 게이트를 되살리면 같은 "○○ 사용" 카드가 아이템 타입에 따라 해설을 냈다 말았다 한다.
  assert.doesNotMatch(handler, /item\.type === 'effect' \|\| isFist/);
  assert.match(handler, /const hasDescriptionText = [\s\S]*?if \(hasDescriptionText\) \{/,
    '해설 노출은 타입이 아니라 실제 글자 유무로만 판단해야 한다');
  assert.match(handler, /DX3rdDescriptionManager\?\.createEnrichedBiography/);
  assert.match(handler, /class="item-description dx3rd-usage-description"/);
  assert.match(styles, /\.dx3rd-item-chat \.dx3rd-usage-description\s*\{[^}]*font-size:\s*0\.82em/s);
});

test('effect-like items use the authored self channel instead of a type-forced toggle', async () => {
  // effect/spell/psionic/combo 모두 actor.js의 자체계산에서는 빠지지만, 적용 방식까지 토글로
  // 고정되는 것은 아니다. onUse는 동결 AE, toggle은 active.state + toggle AE를 사용한다.
  const cases = [
    { type: 'spell', active: { runTiming: 'instant', disable: 'scene', applyMode: 'onUse' }, toggled: false },
    { type: 'psionic', active: { runTiming: 'instant', disable: 'scene', applyMode: 'onUse' }, toggled: false },
    { type: 'combo', active: { runTiming: 'instant', disable: 'scene', applyMode: 'onUse' }, toggled: false },
    { type: 'effect', active: { runTiming: 'instant', disable: 'scene', applyMode: 'onUse' }, toggled: false }
  ];

  for (const testCase of cases) {
    const { handler, writes } = applyHandlerContext();
    const updates = [];
    const actor = { id: 'a1', name: '시전자', effects: [] };
    const item = {
      id: 'i1',
      name: '대상 아이템',
      img: 'x.png',
      type: testCase.type,
      actor,
      system: { active: testCase.active, attributes: { a0: { key: 'attack', label: 'melee', value: '2' } } },
      update: data => { updates.push(data); return true; }
    };

    const toggled = await handler.applySelfModifiers(actor, item);
    assert.equal(toggled, testCase.toggled, `${testCase.type} 의 채널이 어긋났다`);
    if (testCase.toggled) {
      assert.deepEqual(plain(updates), [{ 'system.active.state': true }], `${testCase.type} 는 토글이어야 한다`);
      assert.equal(writes.length, 0, `${testCase.type} 는 동결 AE 를 만들면 안 된다`);
    } else {
      assert.equal(updates.length, 0, `${testCase.type} 는 active.state 를 켜면 안 된다`);
      // 자기 보정 채널은 대상 보정(applied_<id>)과 키를 나눠 쓴다 — 자신을 타겟으로 잡았을 때
      // 서로 덮어쓰지 않게 하기 위해서다.
      assert.equal(writes[0]?.key, 'applied_self_i1', `${testCase.type} 는 동결 AE 여야 한다`);
    }
  }
});

test('every activation gate refuses notCheck and a later runTiming', () => {
  // 'notCheck' = "자기 보정 적용 안 함". 어느 한 경로만 게이트를 빠뜨리면 그 경로로 켠 버프는
  // disable 훅이 매칭할 타이밍 문자열이 없어 영원히 안 꺼진다.
  const gates = [
    ['scripts/handlers/universal-handler.js', /async activateItem[\s\S]{0,1300}?\n    },/],
    ['scripts/handlers/universal-handler.js', /async ensureActivated[\s\S]{0,1300}?\n    },/],
    // 콤보 멤버는 사용 버킷 전용 게이트가 bucketLifecycle 의 disable/runTiming 을 함께 본다.
    ['scripts/handlers/combo-handler.js', /memberSelfModifiersFireAt[\s\S]{0,1000}?return adapter\.selfFiresAt[^;]*;/],
    ['scripts/handlers/universal-handler.js', /const selfPending[\s\S]{0,800}?selfPending && !skipToggle\)\s*\{/]
  ];
  for (const [path, pattern] of gates) {
    const text = readFileSync(resolve(root, path), 'utf8');
    const match = text.match(pattern);
    assert.ok(match, `${path} 에서 활성화 게이트를 찾지 못했다 — 정규식이 낡았다`);
    assert.match(match[0], /notCheck|selfModifiersPending|selfFiresAt/,
      `${path} 의 게이트가 notCheck 를 거르지 않는다(직접 검사도, 어댑터 위임도 아니다)`);
  }
  // ensureActivated 는 runTiming 게이트가 없어 afterSuccess 저작을 캐스팅 시점에 켰다.
  const handlerText = readFileSync(resolve(root, 'scripts/handlers/universal-handler.js'), 'utf8');
  const ensure = handlerText.match(/async ensureActivated[\s\S]{0,1300}?\n    },/);
  assert.match(ensure[0], /runTiming (?:===|!==) 'instant'/, 'ensureActivated 도 runTiming 을 봐야 한다');
  assert.match(ensure[0], /usesActivationSelfChannel/,
    'ensureActivated가 사용/공격 버킷을 active.state 토글로 바꾸면 안 된다');
  assert.doesNotMatch(ensure[0], /item\.update\(\{\s*'system\.active\.state': true/,
    '활성화는 공용 채널 적용기를 거쳐야 한다');

  const chat = source('scripts/chat/chat-ui.js');
  const invoke = chat.match(/Spell invoke[\s\S]{0,2500}?processAfterSuccessSelfModifiers[\s\S]{0,600}?applyToTargets/)
    || chat.match(/const successAction = window\.DX3rdItemEffectAdapter[\s\S]{0,1000}?applyToTargets/);
  assert.ok(invoke, '스펠 성공 발동 경로를 찾지 못했다');
  assert.doesNotMatch(invoke[0], /'system\.active\.state': true/,
    '스펠 성공도 사용 시 버킷을 활성화 토글로 바꾸면 안 된다');
  assert.match(chat, /const extensionMatches =[\s\S]{0,300}?successAction, 'afterSuccess'/,
    '스펠 성공 익스텐션도 저작한 발현 액션을 따라야 한다');
  assert.match(chat, /registerAfterMainExtensions\(actor, item, itemExtend, successAction\)/,
    '스펠의 afterMain 예약에서 발현 액션을 잃으면 안 된다');
});

test('a use-bucket expiry does not switch off a longer-lived activation bucket', async () => {
  const context = baseContext({
    game: { i18n: { localize: key => key } },
    Hooks: { once: () => {}, on: () => {} },
    CONFIG: { statusEffects: [] }
  });
  const removals = [];
  context.DX3rdAppliedEffects = {
    collect: () => ({}),
    removeMany: async (_actor, keys) => { removals.push([...keys]); return keys.length; }
  };
  context.DX3rdConditionSources = { clearByTiming: async () => 0 };
  load(context, 'scripts/item-effect-adapter.js');
  load(context, 'scripts/disable-hooks.js');

  const updates = [];
  const item = {
    id: 'mixed', type: 'effect',
    system: {
      active: {
        state: true,
        action: 'use',
        applyMode: 'onUse',
        disable: 'roll',
        runTiming: 'instant',
        buckets: { activation: { disable: 'scene' } }
      },
      used: { state: 0, disable: 'notCheck' },
      attributes: {
        onUse: { key: 'stat_add', label: 'body', value: '1d10' },
        always: { key: 'stat_add', label: 'body', value: '8', action: 'activation' }
      }
    },
    update: async data => {
      updates.push(data);
      if (data['system.active.state'] === false) item.system.active.state = false;
    }
  };
  const actor = {
    id: 'a1', name: '혼합 버킷 액터', type: 'character',
    items: [item], effects: [], system: { attributes: { applied: {} } }
  };

  await context.DX3rdDisableHooks.executeDisableHook('roll', actor);
  assert.deepEqual(plain(updates), [],
    '사용 버킷의 판정 수명이 끝나도 활성화 버킷은 꺼지면 안 된다');
  assert.equal(item.system.active.state, true,
    '두 번째 임시 콤보도 이미 켜진 활성화 보정을 이어받아야 한다');

  await context.DX3rdDisableHooks.executeDisableHook('scene', actor);
  assert.deepEqual(plain(updates), [{ 'system.active.state': false }],
    '활성화 버킷 자신의 수명에는 정상적으로 꺼져야 한다');
  assert.deepEqual(plain(removals), [['toggle:mixed']],
    '수명 종료는 디바운스 훅을 기다리지 않고 파생 토글 AE까지 삭제해야 한다');
});

// ---------------------------------------------------------------------------
// 지속 효과 카드의 두 축
// ① 적용 대상(자신 / 대상) ② 발동 시점(장착 중 상시 / 사용·공격 시 선언).
// 한 장의 카드로 묶여 있는 동안에는 어느 쪽 설정을 보는지 시트에서 알 수 없었고,
// 장비는 발동 축이 타입으로 하드코딩돼 선언형까지 장착만으로 켜졌다.
// ---------------------------------------------------------------------------
function equipmentHookContext() {
  const hooks = {};
  const context = baseContext({
    game: { i18n: { localize: key => key, format: key => key }, user: { id: 'u1' } },
    ui: { notifications: { warn: () => {} } },
    CONFIG: { statusEffects: [] },
    Hooks: { once: () => {}, on: (name, callback) => { hooks[name] = callback; } },
    foundry: {
      utils: {
        deepClone: value => structuredClone(value),
        getProperty: (object, path) => path.split('.').reduce((node, key) => node?.[key], object),
        randomID: (() => { let seq = 0; return () => `k${++seq}`; })()
      }
    }
  });
  load(context, 'scripts/item-effect-adapter.js');
  return { context, adapter: context.DX3rdItemEffectAdapter, hooks };
}

/** 장착 상태만 다른 장비 하나. update 호출을 기록한다. */
function equipmentItem({ type = 'weapon', applyMode = 'toggle', disable = '-', state = false, equipment = true }) {
  const updates = [];
  const item = {
    id: 'e1', type, documentName: 'Item',
    parent: { documentName: 'Actor', items: [], statuses: new Set() },
    getFlag: () => [],
    system: { equipment, attributes: { a0: { key: 'add', value: '2' } }, active: { state, disable, runTiming: 'instant', applyMode } },
    update: data => { updates.push(data); return true; }
  };
  item.parent.items = [item];
  return { item, updates };
}

test('equipment self modifiers follow the authored channel, not the item type', () => {
  const { adapter } = equipmentHookContext();
  const channel = item => adapter.inferAction(item, 'selfModifiers', item.system.active);

  // 저작이 없으면 template 기본값 'toggle' = 장착 중 상시. 기존 데이터의 동작 그대로다.
  assert.equal(channel(equipmentItem({ type: 'weapon' }).item), 'activation');
  assert.equal(channel(equipmentItem({ type: 'protect' }).item), 'activation');
  assert.equal(channel(equipmentItem({ type: 'vehicle' }).item), 'activation');
  // 선언형으로 저작하면 선언(사용) 채널이어야 한다 — 장착만으로 켜지지 않고,
  // 무기라고 해서 공격에 딸려 붙지도 않는다(그러면 쓸지 말지 고를 자리가 없다).
  assert.equal(channel(equipmentItem({ type: 'weapon', applyMode: 'onUse', disable: 'major' }).item), 'use');
  assert.equal(channel(equipmentItem({ type: 'protect', applyMode: 'onUse', disable: 'reaction' }).item), 'use');
  // 카드에서 「활성화」를 명시하면 그것이 최우선이다.
  const explicit = equipmentItem({ type: 'weapon', applyMode: 'onUse', disable: 'major' }).item;
  explicit.system.active.action = 'activation';
  assert.equal(channel(explicit), 'activation');
});

test('equipping activates only the always-on channel, unequipping always deactivates', async () => {
  const { hooks } = equipmentHookContext();
  const onUpdate = hooks.updateItem;
  assert.ok(onUpdate, 'updateItem 훅이 등록되지 않았다');

  // 상시 채널: 장착으로 켠다.
  const always = equipmentItem({ applyMode: 'toggle' });
  await onUpdate(always.item, { 'system.equipment': true }, {}, 'u1');
  assert.deepEqual(plain(always.updates), [{ 'system.active.state': true }]);

  // 선언형: 장착해도 켜지 않는다(사용 시 handleItemUse 가 동결 AE 로 건다).
  const declared = equipmentItem({ applyMode: 'onUse', disable: 'major' });
  await onUpdate(declared.item, { 'system.equipment': true }, {}, 'u1');
  assert.equal(declared.updates.length, 0, '선언형 장비를 장착만으로 켜면 안 된다');

  // 해제는 채널과 무관하게 끈다 — actor.prepareData 의 activeItems 는 active.state 만 보므로
  // 선언으로 켜 둔 보정이 벗은 뒤에도 남으면 그대로 샌다.
  for (const applyMode of ['toggle', 'onUse']) {
    const worn = equipmentItem({ applyMode, state: true, equipment: false });
    await onUpdate(worn.item, { 'system.equipment': false }, {}, 'u1');
    assert.deepEqual(plain(worn.updates), [{ 'system.active.state': false }], `${applyMode} 장비를 벗어도 보정이 남는다`);
  }
});

test('the persistent modifier card is split by apply target', () => {
  const { adapter } = equipmentHookContext();
  const build = system => adapter.prepareSheetContext({
    type: 'effect', system: { timing: 'major', getTarget: true, ...system },
    getFlag: () => ({})
  });

  const both = build({
    attributes: { a0: { key: 'add', value: '2' } },
    effect: { attributes: { b0: { key: 'add', value: '1' } }, disable: 'scene', runTiming: 'instant' },
    active: { state: false, disable: 'major', runTiming: 'instant', applyMode: 'onUse' }
  });
  assert.deepEqual(plain(both.modifierCards.map(card => card.id)), ['modifiers.self', 'modifiers.target'],
    '자신/대상 보정은 각각 한 장의 카드여야 한다');
  // 카드마다 자기 채널의 발동 시점을 표시한다(예전엔 "자신 N / 대상 M" 요약 한 줄뿐이었다).
  assert.equal(both.modifierCards[0].action, 'use');
  assert.equal(both.modifierCards[1].targetLabel, 'DX3rd.EffectTargetSelected');
  // 켜고 끌 것이 있는 쪽은 활성화 채널뿐이다. 동결 채널(applyMode='onUse')의 상태는 AE 에
  // 있고 active.state 는 쓰지 않으므로, 체크박스를 내주면 그걸 켠 아이템이 이중 가산된다.
  assert.equal(both.modifierCards[0].toggleable, false);
  assert.equal(both.modifierCards[1].toggleable, false, '대상 보정에는 켜고 끌 토글이 없다');

  const alwaysOn = build({
    attributes: { a0: { key: 'add', value: '2' } },
    effect: { attributes: {} },
    active: { state: false, disable: 'scene', runTiming: 'instant', applyMode: 'toggle' }
  });
  assert.equal(alwaysOn.modifierCards[0].toggleable, true, '활성화 채널은 체크박스를 가진다');

  // 한쪽만 저작하면 그 카드만 나온다.
  const selfOnly = build({
    attributes: { a0: { key: 'add', value: '2' } },
    effect: { attributes: {} },
    active: { state: false, disable: 'major', runTiming: 'instant', applyMode: 'onUse' }
  });
  assert.deepEqual(plain(selfOnly.modifierCards.map(card => card.id)), ['modifiers.self']);
});

test('the equipped always-on card says so instead of "on activation"', () => {
  const { adapter } = equipmentHookContext();
  const context = adapter.prepareSheetContext({
    type: 'protect',
    system: {
      equipment: true, attributes: { a0: { key: 'armor', value: '2' } }, effect: { attributes: {} },
      active: { state: true, disable: '-', runTiming: 'instant', applyMode: 'toggle' }
    },
    getFlag: () => ({})
  });
  assert.equal(context.modifierCards[0].triggerLabel, 'DX3rd.EffectTriggerEquipped');
});

// --- 지속 효과 채널 분리 검증 (자신/대상 · 상시/사용 시) ---------------------

test('the self-modifier gate is channel-aware, not a blanket "already active" check', () => {
  const { adapter } = equipmentHookContext();
  const attrs = { a0: { key: 'add', value: '1' } };
  const build = active => ({ type: 'effect', system: { timing: 'major', attributes: attrs, active } });
  const pending = item => adapter.selfModifiersPending(item);

  // 활성화 채널: active.state 가 곧 적용 상태이므로 이미 켜져 있으면 할 일이 없다.
  assert.equal(pending(build({ state: false, disable: 'scene', applyMode: 'toggle' })), true);
  assert.equal(pending(build({ state: true, disable: 'scene', applyMode: 'toggle' })), false);

  // 동결 채널: 상태는 AE 쪽에 있고 active.state 와 무관하다. 켜져 있다는 이유로 건너뛰면
  // (구버전 장착 훅·시트 체크박스로 state 가 켜진 아이템) 사용해도 영영 아무 일이 없다.
  assert.equal(pending(build({ state: false, disable: 'major', applyMode: 'onUse' })), true);
  assert.equal(pending(build({ state: true, disable: 'major', applyMode: 'onUse' })), true);

  // notCheck = 자기 보정을 적용하지 않음. 콤보 멤버 경로에만 빠져 있던 게이트다.
  assert.equal(pending(build({ state: false, disable: 'notCheck', applyMode: 'onUse' })), false);
  assert.equal(pending(build({ state: false, disable: 'notCheck', applyMode: 'toggle' })), false);
});

test('using a frozen-channel item clears a stale activation flag instead of stacking', async () => {
  const { handler, writes } = applyHandlerContext();
  const updates = [];
  const actor = { id: 'a1', name: '나', effects: [] };
  const item = {
    id: 'i1', name: '선언형 장비', img: 'x.png', type: 'weapon',
    system: {
      attributes: { a0: { key: 'attack', value: '5' } }, effect: {},
      active: { state: true, disable: 'major', applyMode: 'onUse' }
    },
    update: async data => { updates.push(data); item.system.active.state = data['system.active.state']; }
  };

  const toggled = await handler.applySelfModifiers(actor, item);
  assert.equal(toggled, false, 'applyMode=onUse 는 동결 채널이어야 한다');
  // 켜진 채로 두면 같은 보정을 두 번 센다 — 장비는 actor.js activeItems 자체계산이,
  // 이펙트류는 toggle:<id> AE 가 더하는데 여기서 동결 AE 까지 걸리기 때문.
  assert.deepEqual(plain(updates), [{ 'system.active.state': false }]);
  assert.equal(writes[0]?.payload?.channel, 'self');
});

test('the self and target modifier buckets do not overwrite each other on one actor', async () => {
  const { handler, writes } = applyHandlerContext();
  const actor = { id: 'a1', name: '시전자', isOwner: true, effects: [] };
  const item = {
    id: 'i1', name: '이펙트', img: 'x.png',
    system: {
      attributes: { a0: { key: 'add', value: '5' } },
      effect: { disable: 'round', attributes: { b0: { key: 'dice', value: '2' } } },
      active: { disable: 'scene' }
    }
  };

  // handleItemUse 의 순서: 자기 보정(2단계) → 대상 보정(3단계). 자신을 타겟으로 잡은 경우다.
  await handler.applySelfFrozenBuff(actor, item);
  // 스텁 set 은 effects 를 건드리지 않으므로, 첫 AE 가 붙은 상태를 직접 재현한다.
  const first = writes[0];
  actor.effects.push({ getFlag: (_scope, field) => (field === 'appliedKey' ? first.key : first.payload) });
  await handler._applyItemAttributes(actor, item, actor, item.system.effect.attributes);

  assert.notEqual(writes[1].key, writes[0].key, '대상 보정이 자기 보정 AE 를 덮어썼다');
  assert.equal(plain(writes[0].payload.attributes).add.value, 5);
  assert.equal(plain(writes[1].payload.attributes).dice.value, 2);
  // 수명도 채널마다 다르다(active.disable / effect.disable) — 덮어쓰면 자기 버프가
  // 대상 쪽 수명을 물려받아 엉뚱한 타이밍에 사라진다.
  assert.equal(writes[0].payload.disable, 'scene');
  assert.equal(writes[1].payload.disable, 'round');
});

test('the applied payload keeps its channel through the flag whitelist', () => {
  // normalizePayload 는 화이트리스트다. channel 이 빠지면 저장되지 않아, 채널 구분이
  // 다음 조회(_applyItemAttributes 의 existingEff, disable-hooks 의 수명 판정)에서 통째로 증발한다.
  const context = baseContext({
    game: { i18n: { localize: key => key } },
    CONFIG: { statusEffects: [] },
    Hooks: { on: () => {}, once: () => {} },
    CONST: { ACTIVE_EFFECT_MODES: { ADD: 2, CUSTOM: 0 } },
    foundry: { utils: { deepClone: value => structuredClone(value) } }
  });
  context.DX3rdFormulaEvaluator = { evaluate: value => Number(value) || 0, isRollTimeKey: () => false, hasDice: () => false };
  load(context, 'scripts/dx3rd-applied-effects.js');
  const built = context.DX3rdAppliedEffects.buildAEData({ id: 'a1' }, 'applied_self_i1', {
    itemId: 'i1', channel: 'self', attributes: { add: { key: 'add', value: 3 } }
  });
  assert.equal(built.flags['dx3rd-emanim'].applied.channel, 'self');

  const target = context.DX3rdAppliedEffects.buildAEData({ id: 'a1' }, 'applied_i1', { itemId: 'i1' });
  assert.equal(target.flags['dx3rd-emanim'].applied.channel, 'target', '미기재는 대상 채널로 본다');

  // 버킷(발현 액션)도 화이트리스트를 통과해야 한다 — 빠지면 활성화 버킷과 기본 버킷이
  // 같은 AE 로 취급돼 나중에 걸린 쪽이 앞의 것을 지운다.
  const activation = context.DX3rdAppliedEffects.buildAEData({ id: 'a1' }, 'applied_act_i1', {
    itemId: 'i1', action: 'activation'
  });
  assert.equal(activation.flags['dx3rd-emanim'].applied.action, 'activation');
  assert.equal(target.flags['dx3rd-emanim'].applied.action, null, '미기재는 기본 버킷이다');
});

// --- 항목별 발현 액션(지속 효과 보정 버킷) ---

/** 자기/대상 보정 행에 action 을 저작한 이펙트 하나. */
function bucketItem(overrides = {}) {
  const item = {
    id: 'i1', name: '이펙트', img: 'x.png', type: 'effect',
    getFlag: () => ({}),
    system: {
      timing: 'major', getTarget: true,
      attributes: {},
      effect: { disable: 'scene', runTiming: 'instant', attributes: {} },
      active: { state: false, disable: 'major', runTiming: 'instant', applyMode: 'onUse' },
      ...overrides
    },
    // 카드의 축을 바꾸는 어댑터 함수는 실제로 문서를 갱신한다. Foundry 의 평탄 경로 갱신 중
    // 이 코드가 쓰는 두 형태(경로 설정 / `-=키` 삭제)만 흉내낸다.
    async update(changes) {
      for (const [path, value] of Object.entries(changes || {})) {
        const keys = path.split('.');
        const last = keys.pop();
        let node = item;
        for (const key of keys) {
          node[key] ??= {};
          node = node[key];
        }
        if (last.startsWith('-=')) delete node[last.slice(2)];
        else node[last] = value;
      }
      return item;
    }
  };
  return item;
}

test('one non-equipment attack preserves separate use and attack modifier lifetimes', async () => {
  const { context, handler, writes } = applyHandlerContext();
  context.Hooks = { once() {}, on() {} };
  context.CONFIG = { statusEffects: [] };
  load(context, 'scripts/item-effect-adapter.js');
  const actor = { id: 'a1', isOwner: true, effects: [] };
  const item = bucketItem({
    attributes: {
      use: { key: 'dice', value: '1', action: 'use' },
      attack: { key: 'add', value: '2', action: 'attack' },
      activation: { key: 'guard', value: '9', action: 'activation' }
    },
    active: { action: 'use', applyMode: 'onUse', state: false, disable: 'scene', runTiming: 'instant',
      buckets: { attack: { disable: 'round', runTiming: 'instant' } } }
  });
  await handler.applySelfModifiers(actor, item, { action: 'attack', timing: 'instant' });
  assert.equal(writes.length, 2);
  assert.deepEqual(writes.map(row => [row.key, row.payload.disable, Object.keys(row.payload.attributes)]), [
    ['applied_self_i1', 'scene', ['dice']], ['applied_self_atk_i1', 'round', ['add']]
  ]);
  assert.equal(item.system.active.state, false);
});

test('attack expansion applies only the live modifier cards at the current timing', async () => {
  const { context, handler, writes } = applyHandlerContext();
  context.Hooks = { once() {}, on() {} };
  context.CONFIG = { statusEffects: [] };
  load(context, 'scripts/item-effect-adapter.js');
  const actor = { id: 'a1', isOwner: true, effects: [] };
  const item = bucketItem({
    attributes: { use: { key: 'dice', value: '1', action: 'use' }, attack: { key: 'add', value: '2', action: 'attack' } },
    active: { action: 'use', applyMode: 'onUse', state: false, disable: 'notCheck', runTiming: 'instant',
      buckets: { attack: { disable: 'round', runTiming: 'afterSuccess' } } }
  });
  const adapter = context.DX3rdItemEffectAdapter;
  assert.equal(adapter.selfModifiersPending(item, 'attack'), true);
  assert.equal(adapter.selfFiresAt(item, 'attack', 'instant'), false);
  assert.equal(adapter.selfFiresAt(item, 'attack', 'afterSuccess'), true);
  await handler.applySelfModifiers(actor, item, { action: 'attack', timing: 'instant' });
  assert.equal(writes.length, 0);
  await handler.applySelfModifiers(actor, item, { action: 'attack', timing: 'afterSuccess' });
  assert.equal(writes.length, 1);
  assert.equal(writes[0].payload.disable, 'round');
  assert.deepEqual(Object.keys(writes[0].payload.attributes), ['add']);
});

test('combo member extension cost and prompt selection share legacy use/attack inclusion', () => {
  const { context } = applyHandlerContext();
  context.Hooks = { once() {}, on() {} };
  context.CONFIG = { statusEffects: [] };
  load(context, 'scripts/item-effect-adapter.js');
  load(context, 'scripts/handlers/combo-handler.js');
  const item = bucketItem();
  const matches = action => context.DX3rdComboHandler.memberExtensionActionMatches(item, 'damage', { action });
  assert.equal(matches('use'), true);
  assert.equal(matches('attack'), true);
  assert.equal(matches('activation'), false);
  const handlerSource = source('scripts/handlers/universal-handler.js');
  assert.equal((handlerSource.match(/memberExtensionActionMatches\(memberItem, 'damage', data\)/g) || []).length, 2,
    'both the runtime prompt and extension HP cost must use the collection predicate');
});

test('combo member attack extensions pay their HP and runtime costs even in a use combo', async () => {
  const { context } = applyHandlerContext();
  context.Hooks = { once() {}, on() {} };
  context.CONFIG = { statusEffects: [] };
  load(context, 'scripts/item-effect-adapter.js');
  load(context, 'scripts/handlers/universal-handler.js');
  load(context, 'scripts/handlers/combo-handler.js');
  const handler = context.DX3rdUniversalHandler;
  const updates = [];
  const actor = { id: 'a1', name: 'actor', system: { attributes: { hp: { value: 20 }, encroachment: { value: 0 } } },
    update: async changes => updates.push(plain(changes)) };
  const member = bucketItem();
  member.getFlag = (_scope, key) => key === 'itemExtend' ? { damage: {
    activate: true, action: 'attack', timing: 'instant', target: 'self', hpCostActivate: true, hpCost: '5',
    runtimePrompt: true, runtimeConsumeHP: true, runtimeDefault: 3
  } } : {};
  const combo = bucketItem({ getTarget: false });
  combo.type = 'combo';
  handler.comboMemberItems = () => [member];
  let prompts = 0;
  context.DX3rdUniversalNumberPromptV2 = async () => { prompts++; return 3; };
  assert.equal(await handler.processItemUsageCost(actor, combo, { action: 'use', skipMessage: true }), true);
  assert.equal(prompts, 1);
  assert.deepEqual(updates, [{ 'system.attributes.hp.value': 12 }]);
  updates.length = 0;
  context.DX3rdUniversalNumberPromptV2 = async () => null;
  assert.equal(await handler.processItemUsageCost(actor, combo, { action: 'use', skipMessage: true }), false);
  assert.equal(updates.length, 0, 'cancel must not deduct any cost');
});

test('one channel can hold several apply-action buckets, one card each', () => {
  const { adapter } = equipmentHookContext();
  const item = bucketItem({
    attributes: {
      a0: { key: 'add', value: '2' },                          // 미지정 → 채널 기본(사용)
      a1: { key: 'dice', value: '1', action: 'activation' },   // 활성화 버킷
      a2: { key: 'attack', value: '3', action: 'attack' }      // 공격 버킷
    }
  });
  const cards = adapter.prepareSheetContext(item).modifierCards;
  // 표시 순서는 활성화 → 사용 → 공격. 기본 버킷만 레거시 id 를 유지한다.
  assert.deepEqual(plain(cards.map(card => card.id)),
    ['modifiers.self@activation', 'modifiers.self', 'modifiers.self@attack']);
  assert.deepEqual(plain(cards.map(card => card.action)), ['activation', 'use', 'attack']);
  assert.deepEqual(plain(cards.map(card => card.count)), [1, 1, 1]);
  // 켜고 끌 토글은 활성화 버킷에만 있다.
  assert.deepEqual(plain(cards.map(card => card.toggleable)), [true, false, false]);
  // 활성화 버킷을 저작하면 그 아이템에는 켜고 끌 상태가 필요하다(채널 기본이 동결이어도).
  assert.equal(adapter.usesActivationSelfChannel(item), true);
});

test('each bucket pane carries only its own rows', () => {
  const { adapter } = equipmentHookContext();
  // 카드를 발현 액션별로 갈라 놓고 행 목록을 한 벌 공유하면, 「활성화」 카드를 열어도
  // 「사용 시」 카드의 행이 그대로 실려 카드를 나눈 의미가 사라진다.
  const item = bucketItem({
    attributes: {
      a0: { key: 'add', value: '2' },                          // 사용(채널 기본)
      a1: { key: 'dice', value: '1', action: 'activation' }     // 활성화
    },
    effect: { disable: 'scene', runTiming: 'afterSuccess', attributes: { b0: { key: 'add', value: '1' } } }
  });
  const panes = adapter.prepareSheetContext(item).modifierOverview.buckets;
  const rowsOf = id => (panes.find(pane => pane.id === id)?.rows || []).map(row => row.key);
  assert.deepEqual(plain(rowsOf('modifiers.self@activation')), ['a1']);
  assert.deepEqual(plain(rowsOf('modifiers.self')), ['a0']);
  assert.deepEqual(plain(rowsOf('modifiers.target')), ['b0']);
  // 행에는 소속을 고르는 드롭다운이 없다 — 축(적용 대상 · 발현 액션)은 카드가 정한다.
  const activationRow = panes.find(pane => pane.id === 'modifiers.self@activation').rows[0];
  assert.equal(activationRow.bucketOptions, undefined);
  // 그 두 축은 카드가 둘 다 들고 있어야 한다(시트 카드의 드롭다운 두 개).
  const cards = adapter.prepareSheetContext(item).modifierCards;
  const activationCard = cards.find(card => card.id === 'modifiers.self@activation');
  assert.equal(activationCard.channel, 'self');
  assert.equal(plain(activationCard.channelOptions.map(option => option.value)).join(','), 'self,target');
  assert.equal(plain(activationCard.actionOptions.map(option => option.value)).join(','),
    'activation,use,attack');
});

test('the extend dialog pane does not re-offer the card axes', () => {
  // 카드는 「사용 시」인데 페인 안쪽은 「활성화」로 보이는 불일치가 실제로 났다: 같은 축을 두
  // 군데서 그리면 한쪽이 틀려도 알 수 없고(여기서는 블록 파라미터를 ../bucket.action 으로 잘못
  // 짚어 어느 항목도 selected 가 아니었다 → 브라우저가 첫 항목을 보여 준다), 고쳐 놓아도
  // 축을 두 번 고르게 하는 구조는 그대로다. 페인에는 그 축의 UI 를 아예 두지 않는다.
  const template = source('templates/dialog/item-extend-dialog.html');
  assert.equal(template.includes('modifier-action-binding'), false,
    '확장 도구 페인에 발현 액션 드롭다운을 되살리지 말 것 — 시트 카드가 그 축의 주인이다');
  assert.equal(template.includes('modifier-bucket-select'), false,
    '버킷 스위처를 되살리지 말 것');
  // 편집 중인 버킷을 알리는 이름표는 그래서 필수다(축 UI 가 없으므로 유일한 표시).
  assert.match(template, /dx3rd-modifier-config-title/);
  // 블록 파라미터를 부모 컨텍스트로 짚는 실수는 조용히 틀린 값을 그린다 — 템플릿 전체에서 금지.
  assert.equal(/\.\.\/(bucket|card|row)\./.test(template), false,
    '블록 파라미터는 중첩 each 안에서도 그대로 보인다 — ../ 로 짚지 말 것');
});

test('the extend dialog resolves its item by uuid, in one place', () => {
  // actorId + itemId 조합은 미연결 토큰에서 끊긴다: 합성 액터의 id 는 원본과 같아
  // game.actors.get() 이 **원본** 액터를 돌려준다. 토큰에만 있는 아이템은 못 찾고(창이
  // 통째로 비어 「먹통」), 같은 id 가 원본에도 있으면 더 나쁘다 — 편집이 원본 문서로 샌다.
  // 컴펜디움 아이템도 game.items.get() 으로는 안 잡힌다.
  const dialog = source('scripts/dialog/item-extend-dialog.js');
  assert.match(dialog, /_resolveItem\(\)\s*\{[\s\S]*fromUuidSync/,
    '_resolveItem 은 uuid 를 먼저 본다');
  // 조회가 한 곳이어야 폴백이 빠진 경로가 안 남는다.
  assert.equal((dialog.match(/game\.actors\.get\(this\.actorId\)/g) || []).length, 2,
    'actorId 직접 조회는 _resolveItem 과 _prepareContext 의 폴백 두 곳뿐이어야 한다');
  assert.equal(source('scripts/sheets/active-item-sheet-v2.js').includes('itemUuid: this.item.uuid'), true,
    '시트는 uuid 를 넘겨야 한다');
});

test('switching a card channel moves that bucket\'s rows, not the whole channel', async () => {
  const { adapter } = equipmentHookContext();
  // 적용 대상은 데이터가 사는 자리 그 자체다 — 카드의 축을 바꾸면 그 카드의 행만 옮겨야
  // 하고, 같은 채널의 다른 버킷(여기서는 기본 버킷 a0)은 제자리에 남아야 한다.
  const item = bucketItem({
    attributes: {
      a0: { key: 'add', value: '2' },                          // 자신 · 사용(채널 기본)
      a1: { key: 'dice', value: '1', action: 'activation' }     // 자신 · 활성화
    },
    effect: { disable: 'scene', runTiming: 'afterSuccess', attributes: {} }
  });
  const moved = await adapter.updateModifierChannel(item, 'modifiers.self@activation', 'target');
  assert.equal(moved.merged, false);
  assert.equal(Object.keys(item.system.attributes).join(','), 'a0');
  const targetRows = Object.values(item.system.effect.attributes);
  assert.equal(targetRows.length, 1);
  assert.equal(targetRows[0].key, 'dice');
  // 대상 채널의 기본 액션이 아니면 명시 태그로 남아야 그 버킷이 유지된다.
  const targetAction = adapter.channelAction(item, 'target');
  assert.equal(targetRows[0].action, targetAction === 'activation' ? '' : 'activation');
  // 비운 명시 버킷의 수명 오버라이드는 주인이 없다 — 남겨 두면 다시 그 액션을 쓸 때 되살아난다.
  assert.equal(item.system.active?.buckets?.activation, undefined);
});

test('a modifier row without an authored action keeps following its channel', () => {
  const { adapter } = equipmentHookContext();
  const legacy = bucketItem({ attributes: { a0: { key: 'add', value: '2' } } });
  // 레거시 데이터(action 필드 없음)는 지금까지처럼 채널 하나 = 카드 하나다.
  assert.deepEqual(plain(adapter.prepareSheetContext(legacy).modifierCards.map(card => card.id)),
    ['modifiers.self']);
  assert.equal(adapter.usesActivationSelfChannel(legacy), false);
  // 동결 채널이므로 사용/공격 어느 쪽으로 발동해도 걸린다(무기 모드 메뉴의 「사용」 등).
  assert.deepEqual(Object.keys(adapter.selfFrozenAttributes(legacy, 'use')), ['a0']);
  assert.deepEqual(Object.keys(adapter.selfFrozenAttributes(legacy, 'attack')), ['a0']);
  // 상태가 켜져 있는 동안 세는 규칙도 그대로다(rois/connection 의 자체계산 보존).
  assert.equal(adapter.appliesWhileActive(legacy, legacy.system.attributes.a0), true);
});

test('activation and frozen buckets partition the rows, never share one', () => {
  const { adapter } = equipmentHookContext();
  // 채널 기본이 '활성화'(상시 이펙트)인데 한 행만 「사용 시」로 저작한 경우.
  const mixed = bucketItem({
    timing: 'always',
    attributes: {
      a0: { key: 'add', value: '2' },                     // 미지정 → 활성화(토글 AE)
      a1: { key: 'dice', value: '1', action: 'use' }       // 사용 시(동결 AE)
    },
    effect: { disable: 'notCheck', runTiming: 'instant', attributes: {} }
  });
  assert.equal(adapter.selfChannelIsToggle(mixed), true);
  // 동결 버킷에는 명시 저작 행만 들어간다 — 미지정 행이 함께 들어가면 토글 AE 와
  // 이중 가산된다.
  assert.deepEqual(Object.keys(adapter.selfFrozenAttributes(mixed, 'use')), ['a1']);
  // 토글/자체계산 쪽은 그 반대다.
  assert.equal(adapter.appliesWhileActive(mixed, mixed.system.attributes.a0), true);
  assert.equal(adapter.appliesWhileActive(mixed, mixed.system.attributes.a1), false);

  // 반대 방향: 채널 기본이 동결인데 한 행만 「활성화」로 저작한 경우.
  const declared = bucketItem({
    attributes: {
      a0: { key: 'add', value: '2' },                            // 미지정 → 동결
      a1: { key: 'dice', value: '1', action: 'activation' }       // 활성화(토글 AE)
    }
  });
  assert.deepEqual(Object.keys(adapter.selfFrozenAttributes(declared, 'use')), ['a0']);
  assert.equal(adapter.appliesWhileActive(declared, declared.system.attributes.a0), false,
    '동결 AE 가 들고 있는 행을 자체계산에서 또 세면 이중 가산이다');
  assert.equal(adapter.appliesWhileActive(declared, declared.system.attributes.a1), true);
});

test('an authored bucket action passes the channel gate it does not match', () => {
  const { adapter } = equipmentHookContext();
  // 대상 보정 채널의 기본은 '사용'(비공격 이펙트)인데 한 행을 「활성화」로 저작했다.
  const item = bucketItem({
    effect: {
      disable: 'scene', runTiming: 'instant',
      attributes: {
        b0: { key: 'add', value: '1' },                           // 사용 시
        b1: { key: 'dice', value: '2', action: 'activation' }      // 활성화 시
      }
    }
  });
  assert.equal(adapter.targetActionMatches(item, 'use'), true);
  assert.equal(adapter.targetActionMatches(item, 'activation'), true,
    '명시 저작한 버킷이 채널 게이트에서 막히면 저작이 아무 일도 못 한다');
  assert.deepEqual(Object.keys(adapter.targetBucketAttributes(item, 'use')), ['b0']);
  assert.deepEqual(Object.keys(adapter.targetBucketAttributes(item, 'activation')), ['b1']);

  // 저작이 전혀 없는 아이템은 지금까지처럼 채널 게이트만 본다.
  const legacy = bucketItem({
    effect: { disable: 'scene', runTiming: 'instant', attributes: { b0: { key: 'add', value: '1' } } }
  });
  assert.equal(adapter.targetActionMatches(legacy, 'activation'), false);
});

test('an item with both buckets toggles and freezes in one use, without double counting', async () => {
  const { context, handler, writes } = applyHandlerContext();
  // 어댑터를 같은 컨텍스트에 실어, 실제 런타임처럼 apply 경로가 버킷 판정을 위임하게 한다.
  context.Hooks = { once: () => {}, on: () => {} };
  context.CONFIG = { statusEffects: [] };
  load(context, 'scripts/item-effect-adapter.js');
  const adapter = context.DX3rdItemEffectAdapter;

  const updates = [];
  const actor = { id: 'a1', name: '시전자', isOwner: true, effects: [] };
  const item = {
    id: 'i1', name: '이펙트', img: 'x.png', type: 'effect', actor,
    getFlag: () => ({}),
    system: {
      timing: 'always',
      attributes: {
        a0: { key: 'add', value: '2' },                        // 미지정 → 활성화(토글 AE)
        a1: { key: 'attack', value: '3', action: 'use' }        // 사용 시(동결 AE)
      },
      effect: { disable: 'notCheck', runTiming: 'instant', attributes: {} },
      active: { state: false, disable: 'major', runTiming: 'instant', applyMode: 'onUse' }
    },
    update: data => { updates.push(data); Object.assign(item.system.active, data['system.active.state'] !== undefined ? { state: data['system.active.state'] } : {}); return true; }
  };

  const toggled = await handler.applySelfModifiers(actor, item, { forceToggle: true, action: 'use' });
  assert.equal(toggled, true, '활성화 버킷이 있으면 토글이어야 한다');
  assert.deepEqual(plain(updates), [{ 'system.active.state': true }]);
  // 동결 AE 에는 「사용 시」로 저작한 행만 들어간다. 미지정 행은 토글 AE 쪽이다 —
  // 둘 다 걸리면 같은 보정이 두 번 센다.
  assert.equal(writes.length, 1, '동결 버킷도 함께 걸려야 한다');
  // 채널 기본이 아닌 버킷은 키에 자기 액션을 달고 나온다 — 한 채널에 동결 버킷이 둘
  // (선언 시/공격 시) 있을 수 있고, 키를 공유하면 나중 것이 앞의 것을 지운다.
  assert.equal(writes[0].key, 'applied_self_use_i1');
  assert.deepEqual(Object.keys(plain(writes[0].payload.attributes)), ['attack'],
    '사용 버킷의 보정만 동결된다');
  assert.equal(adapter.appliesWhileActive(item, item.system.attributes.a1), false);
});

test('an attack bucket on an always-on weapon does not switch the equipped bucket on', async () => {
  const { context, handler, writes } = applyHandlerContext();
  context.Hooks = { once: () => {}, on: () => {} };
  context.CONFIG = { statusEffects: [] };
  load(context, 'scripts/item-effect-adapter.js');

  const updates = [];
  const actor = { id: 'a1', name: '시전자', isOwner: true, effects: [] };
  // 상시 무기(장착이 상태의 원본)에 「공격 시」 보정을 저작한 경우.
  const item = {
    id: 'w1', name: '무기', img: 'x.png', type: 'weapon', actor,
    getFlag: () => ({}),
    system: {
      equipment: true,
      attributes: {
        a0: { key: 'add', value: '1' },                            // 미지정 → 장착 중 상시(토글)
        a1: { key: 'attack', value: '2', action: 'attack' }          // 그 무기로 공격할 때
      },
      effect: { attributes: {} },
      active: { state: false, disable: 'major', runTiming: 'instant', applyMode: 'toggle' }
    },
    update: data => { updates.push(data); return true; }
  };

  const toggled = await handler.applySelfModifiers(actor, item, { action: 'attack' });
  assert.equal(toggled, false, '공격 버킷은 토글이 아니라 동결이다');
  assert.deepEqual(plain(updates), [],
    '공격으로 state 를 켜면 장착 중 상시 버킷이 함께 터지고 장착 표시와도 어긋난다');
  assert.equal(writes.length, 1);
  assert.equal(writes[0].key, 'applied_self_atk_w1');
  assert.deepEqual(Object.keys(plain(writes[0].payload.attributes)), ['attack'],
    '공격 버킷의 보정만 걸린다 — 미지정 행은 토글 AE 쪽이다');
});

test('moving a bucket action retags only that bucket, and merges when it meets the default', async () => {
  const { adapter } = equipmentHookContext();
  const updates = [];
  const item = bucketItem({
    attributes: {
      a0: { key: 'add', value: '2' },
      a1: { key: 'dice', value: '1', action: 'attack' }
    }
  });
  item.update = data => { updates.push(data); return true; };

  // 명시 버킷을 옮기면 그 행만 바뀐다(채널은 건드리지 않는다). 그 버킷이 들고 있던
  // 수명(발현·소멸 타이밍)은 새 자리로 따라간다 — 액션만 바꿨는데 타이밍이 채널 기본으로
  // 되돌아가면 카드가 조용히 다른 시점에 걸린다.
  await adapter.updateAction(item, 'modifiers.self@attack', 'activation');
  assert.deepEqual(plain(Object.assign({}, ...updates.splice(0))), {
    'system.attributes.a1.action': 'activation',
    'system.active.buckets.activation.disable': 'major'
  });

  // 새 액션이 채널 기본과 같아지면 명시를 지워 기본 버킷으로 합친다
  // (같은 액션의 카드가 두 장으로 갈라지지 않게). 합쳐진 뒤의 수명 주인은 채널 필드다.
  item.system.attributes.a1.action = 'attack';
  await adapter.updateAction(item, 'modifiers.self@attack', 'use');
  assert.deepEqual(plain(Object.assign({}, ...updates.splice(0))), { 'system.attributes.a1.action': '' });

  // 기본 버킷을 옮기면 채널 자체가 옮겨진다(지금까지의 동작).
  await adapter.updateAction(item, 'modifiers.self', 'activation');
  const channelMove = plain(updates.pop());
  assert.equal(channelMove['system.active.action'], 'activation');
  assert.equal(channelMove['system.active.applyMode'], 'toggle');
});

test('each bucket owns its apply timing, so neither of them is dead on arrival', () => {
  const { adapter } = equipmentHookContext();
  // 대상 채널의 기본 버킷은 즉시(사용 시), 공격 버킷은 데미지 적용 후로 저작했다.
  const item = bucketItem({
    effect: {
      disable: 'scene', runTiming: 'instant',
      buckets: { attack: { runTiming: 'afterDamage', disable: 'round' } },
      attributes: {
        b0: { key: 'add', value: '1' },
        b1: { key: 'dice', value: '2', action: 'attack' }
      }
    }
  });
  // 발현 타이밍은 버킷마다 다르다. 채널 필드 하나로 게이트를 걸면 둘 중 하나는 어느
  // 발현점에도 걸리지 못하고 조용히 죽는다.
  assert.equal(adapter.bucketLifecycle(item, 'target', 'use').runTiming, 'instant');
  assert.equal(adapter.bucketLifecycle(item, 'target', 'attack').runTiming, 'afterDamage');
  assert.equal(adapter.targetFiresAt(item, 'use', 'instant'), true);
  assert.equal(adapter.targetFiresAt(item, 'attack', 'afterDamage'), true);
  assert.equal(adapter.targetFiresAt(item, 'attack', 'instant'), true,
    '비장비의 공격 발현은 즉시 사용 버킷도 커버하되 공격 버킷은 자기 시점을 기다린다');
  assert.deepEqual(Object.keys(adapter.targetBucketAttributes(item, 'attack', 'instant')), ['b0']);
  assert.deepEqual(Object.keys(adapter.targetBucketAttributes(item, 'attack', 'afterDamage')), ['b1']);
  // 소멸 타이밍도 버킷의 것이다(기본 버킷은 채널 필드를 그대로 상속).
  assert.equal(adapter.bucketLifecycle(item, 'target', 'use').disable, 'scene');
  assert.equal(adapter.bucketLifecycle(item, 'target', 'attack').disable, 'round');
  // 카드는 자기 수명 필드 경로를 들고 있다 — 기본 버킷은 채널, 명시 버킷은 buckets.<액션>.
  const cards = adapter.prepareSheetContext(item).modifierCards;
  assert.deepEqual(plain(cards.map(card => card.disableName)),
    ['system.effect.disable', 'system.effect.buckets.attack.disable']);
  // 발현 타이밍이 다르면 대상도 달라진다(데미지 적용 후 = 데미지 받은 대상).
  assert.deepEqual(plain(cards.map(card => card.target)), ['targetToken', 'damagedTargets']);
  // 명시 버킷 카드만 지울 수 있다(기본 버킷을 지우면 미지정 행이 통째로 사라진다).
  assert.deepEqual(plain(cards.map(card => card.deletable)), [false, true]);
});

test('a use bucket and an attack bucket never share one applied effect', async () => {
  const { context, handler, writes } = applyHandlerContext();
  context.Hooks = { once: () => {}, on: () => {} };
  context.CONFIG = { statusEffects: [] };
  load(context, 'scripts/item-effect-adapter.js');

  // 무기는 판정 다이얼로그의 선언(action:'use')과 그 무기로 공격(action:'attack')이 둘 다
  // 발현점이다. 키를 공유하면 공격 적용이 선언 적용을 덮어써 지운다.
  // 장비여야 하는 것이 요점이다 — 장비 이외에는 공격이 곧 사용이라(actionCoversBucket) 두 버킷이
  // 한 번의 발현으로 함께 걸리고, 두 번 써서 덮어쓸 일 자체가 없다.
  const actor = { id: 'a1', name: '시전자', isOwner: true, effects: [] };
  const item = {
    id: 'i1', name: '무기', img: 'x.png', type: 'weapon', actor, getFlag: () => ({}),
    system: {
      timing: 'major', equipment: true,
      attributes: {
        a0: { key: 'guard', value: '5', action: 'use' },         // 선언(사용 시)
        a1: { key: 'attack', value: '3', action: 'attack' }      // 공격 시
      },
      effect: { disable: 'notCheck', attributes: {} },
      active: { state: false, disable: 'major', runTiming: 'instant', applyMode: 'onUse' }
    }
  };

  await handler.applySelfFrozenBuff(actor, item, 'use');
  const declared = writes[0];
  actor.effects.push({ getFlag: (_s, field) => (field === 'appliedKey' ? declared.key : declared.payload) });
  await handler.applySelfFrozenBuff(actor, item, 'attack');

  assert.equal(declared.key, 'applied_self_i1', '채널 기본 버킷은 레거시 키를 유지한다');
  assert.equal(writes[1].key, 'applied_self_atk_i1');
  assert.deepEqual(Object.keys(plain(declared.payload.attributes)), ['guard']);
  assert.deepEqual(Object.keys(plain(writes[1].payload.attributes)), ['attack']);
  assert.equal(writes[1].payload.action, 'attack', '버킷 판별자가 페이로드에 실려야 소멸 훅이 찾는다');
});

test('the disable-timing dropdown never reuses the usage-count wording for "off"', () => {
  // 「비활성화」 드롭다운에서 `-` 는 「적용되고 사라지지 않음」이고 `notCheck` 는 「이 채널을 아예
  // 적용하지 않음」이다. 그런데 그 옵션이 사용 횟수 칸과 문자열(DX3rd.NotCheck = 「체크 안한다」)을
  // 공유하고 있어 「비활성화를 체크하지 않는다 = 안 사라진다」로 읽혔다 — 실측 월드 10문서가 그 값에
  // 보정 행을 저작해 두고 통째로 죽어 있었다(오리진(정령)의 init/guard/armor +([level]*3) 등).
  // 사용 횟수 칸에서는 같은 문자열이 자연스럽게 읽히므로 그쪽은 그대로 둔다.
  const files = [
    'templates/dialog/item-extend-dialog.html',
    'templates/item/combo-sheet-v2.html',
    'templates/item/connection-sheet-v2.html',
    'templates/item/psionic-sheet-v2.html',
    'templates/item/rois-sheet-v2.html',
    'templates/item/spell-sheet-v2.html'
  ];
  const OFF = '<option value="notCheck">{{localize "DX3rd.DisableTimingOff"}}</option>';
  const USED = '<option value="notCheck">{{localize "DX3rd.NotCheck"}}</option>';
  let disableSelects = 0;
  for (const file of files) {
    const lines = source(file).split('\n');
    lines.forEach((line, index) => {
      // A disable-timing select is the one bound to a persistent-effect channel or bucket.
      if (!/<select[^>]*name="(system\.(active|effect)\.disable|\{\{bucket\.disableName\}\})"/.test(line)) return;
      disableSelects++;
      assert.ok(/title="\{\{localize "DX3rd\.DisableTimingHint"\}\}"/.test(line),
        `${file}:${index + 1} 비활성화 드롭다운은 -/적용 안 함의 차이를 툴팁으로 말해야 한다`);
      // The option sits on the same line (single-line selects) or within the block that follows.
      const block = lines.slice(index, index + 14).join('\n');
      assert.ok(block.includes(OFF), `${file}:${index + 1} 비활성화의 notCheck 는 「적용 안 함」이어야 한다`);
      assert.ok(!block.includes(USED), `${file}:${index + 1} 사용 횟수 문구를 재사용하면 안 된다`);
    });
  }
  assert.equal(disableSelects, 9, '비활성화 드롭다운을 새로 만들면 이 검사에도 함께 들어와야 한다');

  const ko = JSON.parse(source('lang/ko.json'));
  assert.equal(ko['DX3rd.NotCheck'], '체크 안한다', '사용 횟수 쪽 문구는 그대로다');
  assert.ok(ko['DX3rd.DisableTimingOff'] && ko['DX3rd.DisableTimingHint']);
});

test('an attack effect fires the card it was authored on, because attacking is using', () => {
  const { adapter } = equipmentHookContext();
  // yuricross '포텐스': 백병 공격력 +[level]d10 을 「사용 시」 카드에 저작한 attackRoll='melee' 이펙트.
  // invocationAction 은 공격 이펙트에 늘 'attack' 을 돌려주고 사용/공격 선택창은 무기·비클 전용이라,
  // 그 카드는 어떤 경로로도 발현하지 않아 데미지 수정치가 조용히 사라졌다.
  const potens = {
    type: 'effect', id: 'potens', name: '포텐스',
    system: {
      attackRoll: 'melee', skill: 'body', difficulty: '대결', target: '자신',
      active: {state: false, disable: 'roll', runTiming: 'instant', action: 'use', applyMode: 'onUse'},
      attributes: {
        a: {key: 'stat_add', label: 'body', value: '+[level]d10'},
        b: {key: 'attack', label: 'melee', value: '+[level]d10'},
        d: {key: 'stat_add', label: 'body', value: '+[level]', action: 'activation'}
      },
      effect: {disable: 'notCheck', runTiming: 'instant', action: '', attributes: {}}
    },
    getFlag: () => ({})
  };
  const action = adapter.invocationAction(potens, {});
  assert.equal(action, 'attack', '공격 이펙트의 발현 액션은 attack 이다');
  assert.equal(
    adapter.extensionActionMatches(potens, 'selfModifiers', potens.system.active, action, 'instant'),
    true, '「사용 시」 자기 보정 카드는 그 이펙트의 공격 발현에서 걸려야 한다');
  assert.deepEqual(Object.keys(adapter.selfFrozenAttributes(potens, action)).sort(), ['a', 'b'],
    '활성화 행은 토글 AE 가 들고, 나머지 두 행만 동결된다');

  // 활성화는 절대 흡수되지 않는다 — 그 축까지 합치면 상시 이펙트가 공격만으로 켜진다.
  assert.equal(adapter.actionCoversBucket(potens, 'attack', 'activation'), false);
  assert.equal(adapter.actionCoversBucket(potens, 'use', 'attack'), false,
    '사용은 공격 카드를 태우지 않는다 — 흡수는 한 방향뿐이다');

  // 장비는 예외다: 사용/공격 선택창이 실제로 있고, attackDefersUsage 가 「공격이 사용 카드의 값을
  // 치르지 않는다」를 지킨다. 여기서 넓히면 그 짝이 무너진다.
  for (const type of ['weapon', 'protect', 'vehicle']) {
    assert.equal(adapter.actionCoversBucket({type}, 'attack', 'use'), false, `${type} 는 예외로 남는다`);
  }

  // 게이트와 어댑터가 갈리면 카드는 다시 도달 불가가 된다.
  const handler = source('scripts/handlers/universal-handler.js').replace(/\s+/g, ' ');
  assert.ok(handler.includes("adapter.extensionActionMatches(item, 'selfModifiers', item.system?.active || {}, action, 'instant')"),
    'handleItemUse 의 자기 보정 게이트는 어댑터 한 곳을 물어봐야 한다');
});

test('adding a persistent modifier card claims the next free bucket', async () => {
  const { adapter } = equipmentHookContext();
  const updates = [];
  const item = bucketItem({ attributes: {} });
  item.update = data => {
    updates.push(data);
    for (const [path, value] of Object.entries(data)) {
      if (path.startsWith('system.attributes.')) item.system.attributes[path.split('.')[2]] = value;
    }
    return true;
  };

  // 첫 장은 비어 있는 채널 기본 버킷에 들어간다(지금까지의 "보정 한 줄 추가" 흐름).
  assert.equal(await adapter.addModifierBucket(item, 'self'), 'modifiers.self');
  assert.equal(Object.values(item.system.attributes)[0].action, '');

  // 두 번째부터는 아직 안 쓰는 발현 액션으로 새 카드가 생기고, 수명을 채널에서 물려받는다.
  const second = await adapter.addModifierBucket(item, 'self');
  assert.equal(second, 'modifiers.self@activation');
  const seeded = updates.pop();
  assert.equal(seeded['system.active.buckets.activation.disable'], 'major');
  assert.equal(Object.values(item.system.attributes).filter(attr => attr.action === 'activation').length, 1);
});

// --- 선언형 장비(사용 시 발동) 저작 지원 ---

test('an authored on-use weapon fires on its declaration, not on every attack', () => {
  const { adapter } = equipmentHookContext();
  const makeItem = (active, attribute = { key: 'guard', value: '+5' }) => ({
    type: 'weapon',
    system: { attributes: { a0: attribute }, effect: { attributes: {} }, active },
    getFlag: () => ({})
  });
  const build = active => adapter.prepareSheetContext(makeItem(active));

  // 「가드를 시행할 때 선언한다」(가드 실드) — 공격이 아니라 선언이 발동점이다.
  // 무기의 기본 추론은 'attack' 이라, action 을 저작하지 않으면 공격해야만 붙는다.
  const declared = { state: false, disable: 'guard', runTiming: 'instant', applyMode: 'onUse', action: 'use' };
  const card = build(declared).modifierCards[0];
  assert.equal(card.action, 'use');
  assert.equal(card.toggleable, false, '동결 채널에는 켜고 끌 상태가 없다');
  assert.equal(card.active, true, '저작돼 있으면 살아 있는 카드다');
  // 그 규칙은 collectPersistent 한 곳에 있어야 한다. 시트 컨텍스트에서만 덧칠했더니
  // 같은 카드가 hasActionEffects 에는 죽은 것으로 보여 「사용」 진입점이 닫혔다.
  const selfCard = active => adapter.collectPersistent(makeItem(active)).find(c => c.id === 'modifiers.self');
  assert.equal(selfCard(declared).active, true);
  assert.equal(selfCard({ ...declared, disable: 'notCheck' }).active, false, 'notCheck 는 채널과 무관하게 적용 안 함이다');
  assert.equal(selfCard({ state: false, disable: 'scene', runTiming: 'instant' }).active, false,
    '활성화 채널은 켜져 있을 때만 살아 있다');

  const item = makeItem(declared);
  assert.equal(adapter.usesActivationSelfChannel(item), false);
  // 장착만으로 켜지지 않으므로, 사용할 때마다 새로 걸어야 한다.
  assert.equal(adapter.selfModifiersPending(item), true);
  // 무기 모드 메뉴에 「사용」을 낼지 결정하는 실제 판정.
  assert.equal(adapter.hasActionEffects(item, 'use'), true);
  assert.equal(adapter.hasActionEffects(item, 'attack'), false);

  // applyMode 만 저작돼 있어도 선언형이다. 예전에는 무기 기본값 'attack' 으로 떨어져
  // 별도 선언 진입점이 열리지 않았고, 그 무기로 공격하면 보정이 저절로 터졌다.
  const inferred = { state: false, disable: 'major', runTiming: 'instant', applyMode: 'onUse' };
  assert.equal(build(inferred).modifierCards[0].action, 'use');
  assert.equal(adapter.hasActionEffects(makeItem(inferred, { key: 'attack', value: '+10' }), 'use'), true);
  assert.equal(adapter.hasActionEffects(makeItem(inferred, { key: 'attack', value: '+10' }), 'attack'), false,
    '공격만으로 선언형 보정이 붙으면 쓸지 말지 고를 자리가 없다');

  // 「공격 시」는 선언과 다른 갈래다(그 무기로 공격할 때 자동). 명시 저작은 존중한다.
  // (vm 렐름 배열이라 deepEqual 은 구조가 같아도 실패한다 — 문자열로 본다.)
  const authoredAttack = { state: false, disable: 'major', runTiming: 'instant', applyMode: 'onUse', action: 'attack' };
  assert.equal(build(authoredAttack).modifierCards[0].action, 'attack');
  assert.equal(build(authoredAttack).modifierCards[0].actionOptions.map(o => o.value).join(','),
    'activation,use,attack');
  // 하지만 그건 저작을 옮겼기 때문이다. 선언형(②)은 「공격 시」 버킷이 같은 아이템에 생겨도
  // 공격으로 자동 발동하지 않는다 — 그 선택이 이 계열 장비의 전부다.
  const split = {
    type: 'weapon',
    system: {
      attributes: {
        a0: { key: 'add', value: '+5' },                          // 미지정 → 선언(채널 기본 'use')
        a1: { key: 'attack', value: '+2', action: 'attack' }        // 그 무기로 공격할 때 자동
      },
      effect: { attributes: {} },
      active: { state: false, disable: 'major', runTiming: 'instant', applyMode: 'onUse' }
    },
    getFlag: () => ({})
  };
  assert.deepEqual(Object.keys(adapter.selfFrozenAttributes(split, 'attack')), ['a1'],
    '공격만으로 선언형 보정까지 걸리면 회수를 쓸지 고를 자리가 없다');
  assert.deepEqual(Object.keys(adapter.selfFrozenAttributes(split, 'use')), ['a0'],
    '선언은 선언 버킷만 건다');

  // 저작이 없는 기존 장비는 그대로 상시(장착이 상태의 원본)여야 한다.
  const legacy = build({ state: false, disable: 'scene', runTiming: 'instant' }).modifierCards[0];
  assert.equal(legacy.action, 'activation');
  assert.equal(legacy.toggleable, true);
});

test('attack items expose a separate use entry when something is bound to it', () => {
  // 무기 모드 메뉴는 공격/콤보/효과 적용뿐이었다. 선언형 자기 보정을 'use' 로 저작해도
  // 그것을 고를 방법이 「효과 적용 → 자신」(자기 타겟팅 필요)밖에 없었고, 그 경로는
  // handleItemUse 를 타지 않아 사용 횟수도 침식 비용도 걷히지 않는다.
  const text = source('scripts/helpers.js');
  const menu = text.slice(text.indexOf('DX3rdChooseItemMode'));
  assert.match(menu.slice(0, 1600), /isAttack && window\.DX3rdItemEffectAdapter\?\.hasActionEffects\?\.\(item, 'use'\)/,
    '메뉴는 어댑터 판정으로 「사용」을 열어야 한다 — 타입으로 단정하면 상시 장비까지 열린다');
  assert.match(menu.slice(0, 1600), /value: 'use'/);
  // 수신측은 이미 있다: 공격 아이템의 'use' 는 공격 굴림 없이 효과만 발현한다.
  assert.match(source('scripts/handlers/universal-handler.js'),
    /effectOnlyUse = action === 'use' && window\.DX3rdItemEffectAdapter\?\.isAttackItem\(item\)/);
  // 두 진입점(시트 이름 클릭 / handleItemUse 자체 메뉴) 모두 mode 'use' 를 액션으로 옮긴다.
  assert.match(source('scripts/sheets/actor-sheet-v2.js'), /action: mode === 'use' \? 'use' : undefined/);
  assert.match(source('scripts/handlers/universal-handler.js'), /action: mode === 'use' \? 'use' : 'attack'/);
});

// --- 다이얼로그 안 장비 선언 ---

function declaredEquipmentContext() {
  const context = baseContext({
    game: { i18n: { localize: key => key, format: (key, data) => `${key}:${data?.count}` } },
    ui: { notifications: { error: () => {} } },
    CONFIG: { statusEffects: [] },
    Hooks: { on: () => {}, once: () => {} },
    foundry: { utils: { deepClone: value => structuredClone(value), getProperty: (object, path) => path.split('.').reduce((node, key) => node?.[key], object) } }
  });
  load(context, 'scripts/item-effect-adapter.js');
  load(context, 'scripts/declared-equipment.js');
  return context;
}

/** 장착된 선언형 무기 하나. */
function declarableItem(overrides = {}) {
  const { key = 'penetrate', value = '99', active = {}, used = {}, type = 'weapon' } = overrides;
  return {
    id: overrides.id || 'w1', name: overrides.name || '로켓 런처', img: 'x.png', type,
    system: {
      equipment: overrides.equipment ?? true,
      attributes: { a0: { key, value } },
      effect: { attributes: {} },
      active: { state: false, disable: 'major', runTiming: 'instant', applyMode: 'onUse', action: 'use', ...active },
      used: { state: 0, max: 1, level: false, disable: 'session', ...used }
    }
  };
}

function actorWith(items, effects = []) {
  return { id: 'a1', isOwner: true, items, effects };
}

test('only equipped, on-use, unspent equipment is offered for declaration', () => {
  const { DX3rdDeclaredEquipment: mod } = declaredEquipmentContext();
  const ok = declarableItem();
  assert.deepEqual(plain(mod.collect(actorWith([ok]), 'attack').map(e => e.name)), ['로켓 런처']);

  // 문맥이 다르면 내지 않는다 — 방어 창에 관통 버튼이 뜨면 누를 수 없는 버튼만 늘어난다.
  assert.equal(mod.collect(actorWith([ok]), 'defense').length, 0);

  // 장착 안 함 / 상시 채널 / notCheck 는 각각 제외된다.
  assert.equal(mod.collect(actorWith([declarableItem({ equipment: false })]), 'attack').length, 0);
  assert.equal(mod.collect(actorWith([declarableItem({ active: { applyMode: 'toggle', action: 'activation' } })]), 'attack').length, 0);
  assert.equal(mod.collect(actorWith([declarableItem({ active: { disable: 'notCheck' } })]), 'attack').length, 0);
  // used 체크 자체가 꺼져 있으면 무제한.
  const unlimited = mod.collect(actorWith([declarableItem({ used: { disable: 'notCheck' } })]), 'attack');
  assert.equal(unlimited[0].limited, false);

  // 이미 선언해 자기 보정 AE 가 붙어 있으면 두 번 내지 않는다.
  const declared = actorWith([ok], [{ getFlag: (_s, f) => (f === 'appliedKey' ? 'applied_self_w1' : null) }]);
  assert.equal(mod.collect(declared, 'attack').length, 0);
  // 남의 액터에는 버튼을 내주지 않는다(방어 다이얼로그는 GM 화면에도 뜬다).
  assert.equal(mod.collect({ ...actorWith([ok]), isOwner: false }, 'attack').length, 0);

  // 명중 뒤 고르는 장비는 판정 전 선언과 별개다. 양쪽에 모두 나오면 선언 때는 타이밍
  // 게이트로 적용되지 않고, 데미지 버튼에서 같은 장비를 다시 묻게 된다.
  const afterSuccess = declarableItem({
    name: '샷건', key: 'attack', value: '+2',
    active: { runTiming: 'afterSuccess', disable: 'major' },
    used: { disable: 'notCheck' }
  });
  assert.equal(mod.collect(actorWith([afterSuccess]), 'attack').length, 0,
    'afterSuccess 장비는 판정 전 선언 목록에 나오면 안 된다');
});

test('after-success major damage bonuses affect only the preserved attack snapshot', async () => {
  const context = baseContext({
    game: { i18n: { localize: key => key } },
    ui: { notifications: { warn: () => {}, error: () => {}, info: () => {} } },
    CONFIG: { statusEffects: [] },
    Hooks: { on: () => {}, once: () => {} },
    foundry: {
      utils: {
        deepClone: value => structuredClone(value),
        getProperty: (object, path) => path.split('.').reduce((node, key) => node?.[key], object),
        randomID: () => 'k1'
      }
    }
  });
  context.DX3rdFormulaEvaluator = {
    prepareRollFormula: value => String(value),
    hasDice: value => /d\d+/i.test(value),
    evaluate: value => Number(value)
  };
  context.DX3rdUniversalHandler = {
    resolveAttackType: item => item.system?.type || null,
    isFistWeaponName: () => false,
    joinFormulaTerms: (...terms) => terms.filter(Boolean).join(' + ')
  };
  load(context, 'scripts/item-effect-adapter.js');
  load(context, 'scripts/handlers/universal-apply.js');

  const applied = [];
  context.DX3rdUniversalHandler.applySelfModifiers = async (_actor, _item, options) => applied.push(options);
  const shotgun = {
    id: 'shotgun', name: '샷건', type: 'weapon',
    system: {
      type: 'ranged',
      active: { state: false, disable: 'major', runTiming: 'afterSuccess', applyMode: 'onUse', action: 'use' },
      attributes: { a0: { key: 'attack', label: 'ranged', value: '+2' } },
      effect: { attributes: {} }
    }
  };
  const actor = { id: 'a1', items: new Map([['shotgun', shotgun]]) };

  const current = await context.DX3rdUniversalHandler.processAfterSuccessSelfModifiers(actor, shotgun, {
    action: 'use', attackItem: shotgun, expiredTimings: ['roll', 'major']
  });
  assert.deepEqual(plain(current), { attack: 2, attackFormula: '', penetrate: 0 },
    '명중 뒤 고른 공격력은 현재 데미지 스냅샷에 들어가야 한다');
  assert.deepEqual(applied, [],
    '이미 끝난 major 수명의 보정을 액터에 붙이면 다음 판정으로 샌다');

  shotgun.system.active.disable = 'round';
  await context.DX3rdUniversalHandler.processAfterSuccessSelfModifiers(actor, shotgun, {
    action: 'use', attackItem: shotgun, expiredTimings: ['roll', 'major']
  });
  assert.deepEqual(plain(applied), [{ action: 'use', timing: 'afterSuccess', bucketAttributes: shotgun.system.attributes }],
    '아직 끝나지 않은 수명은 정상적으로 액터에 남아야 한다');
});

test('exhausted equipment stays on the list but is marked, unless the world blocks it', () => {
  const context = declaredEquipmentContext();
  const mod = context.DX3rdDeclaredEquipment;
  // 횟수 체크를 켜 두고 상한이 0이면 무제한이 아니라 소진이다(helpers isItemExhausted 와 같은 규칙).
  const spent = actorWith([declarableItem({ used: { state: 1, max: 1 } })]);
  const zeroMax = actorWith([declarableItem({ used: { max: 0 } })]);

  // 기본값(허용): 목록에 남되 소진 표시가 붙는다 — 「0회 남음」이 아니라 「소진」.
  assert.equal(mod.collect(spent, 'attack').length, 1);
  assert.equal(mod.collect(spent, 'attack')[0].exhausted, true);
  assert.equal(mod.collect(zeroMax, 'attack')[0].exhausted, true);
  const html = mod.sectionHtml(mod.collect(spent, 'attack'));
  assert.match(html, /dx3rd-declare-button is-exhausted/, '소진된 것은 버튼에서 구별돼야 한다');
  assert.match(html, /DX3rd\.Exhausted/);
  assert.doesNotMatch(html, /DX3rd\.DeclareUsesLeft/, '소진이면 잔여 회수 대신 소진을 낸다');

  // 설정을 끄면 예전처럼 목록에서 아예 빠진다.
  context.DX3rdItemExhausted = { allowExhaustedUse: () => false };
  assert.equal(mod.collect(spent, 'attack').length, 0);
  assert.equal(mod.collect(zeroMax, 'attack').length, 0);
  // 남은 회수가 있는 것은 설정과 무관하다.
  assert.equal(mod.collect(actorWith([declarableItem()]), 'attack').length, 1);
});

test('damage-side declarations belong to the accuracy roll, not the damage window', () => {
  const { DX3rdDeclaredEquipment: mod } = declaredEquipmentContext();
  // 룰상 「명중판정을 실행하기 직전에 선언할 것」이다. 데미지 산출 창은 이미 맞은 뒤라
  // 거기서 고르게 하면 빗나갔을 때 회수를 아끼는 자리가 생긴다.
  const penetrate = declarableItem();
  assert.equal(mod.collect(actorWith([penetrate]), 'attack').length, 1);
  assert.equal(mod.collect(actorWith([penetrate]), 'roll').length, 0,
    '공격이 아닌 일반 판정 창에 관통 버튼이 뜨면 안 된다');

  // 판정 보정은 두 문맥 모두에서 나온다 — 명중판정도 판정이다.
  const rollMod = declarableItem({ id: 'w2', name: '볼트액션 라이플', key: 'major_dice', value: '+3' });
  assert.equal(mod.collect(actorWith([rollMod]), 'roll').length, 1);
  assert.equal(mod.collect(actorWith([rollMod]), 'attack').length, 1);

  // 데미지 산출 창에는 선언 자리가 없어야 한다.
  const damageFile = source('scripts/handlers/universal-damage-dialog.js');
  assert.equal(damageFile.includes("collect(actor, 'damage')"), false,
    '데미지 산출 창은 더 이상 선언을 수집하지 않는다');
  assert.equal(source('templates/dialog/damage-calc-dialog.html').includes('declareSection'), false,
    '데미지 산출 템플릿에 선언 섹션이 남아 있으면 안 된다');
});

/** 상대를 깎는 보정만 가진 장비(자기 채널은 비어 있다). */
function targetDeclarableItem(overrides = {}) {
  const { key = 'dodge_dice', value = '-(4)', action = 'use' } = overrides;
  return {
    id: overrides.id || 't1', name: overrides.name || '발리스틱 나이프', img: 'x.png', type: 'weapon',
    system: {
      equipment: true,
      attributes: {},
      effect: { disable: 'major', runTiming: 'instant', action, attributes: { e0: { key, value } } },
      active: { state: false, disable: '-', runTiming: 'instant', applyMode: 'toggle', action: '' },
      used: { state: 0, max: 3, level: false, disable: 'session' }
    }
  };
}

test('target-only declarations reach the roll dialog, and helping buffs do not', () => {
  const { DX3rdDeclaredEquipment: mod } = declaredEquipmentContext();
  // 「명중판정 직전에 선언하면 그 공격에 대한 리액션의 크리티컬치 +1」(폴른 피스톨)처럼
  // 자기 보정 없이 **상대만** 깎는 장비가 있다. 자격 판정이 자기 채널만 보면 선언 목록에
  // 아예 뜨지 않고, 그러면 대상 채널의 폴백대로 공격할 때마다 자동으로 붙어 회수 제한도
  // 지불되지 않는다 — 쓸지 말지 고르는 것이 이 계열 장비의 전부인데 그 선택이 사라진다.
  const knife = targetDeclarableItem();
  const offered = mod.collect(actorWith([knife]), 'attack');
  assert.deepEqual(plain(offered.map(e => e.name)), ['발리스틱 나이프']);
  assert.match(offered[0].summary, /DX3rd\.Target/,
    '대상에게 걸리는 것은 표시로 구별돼야 한다 — 안 그러면 자기 강화로 읽힌다');
  assert.equal(offered[0].limited, true, '선언 경로가 회수를 정산하므로 잔여 표시도 따라와야 한다');

  // 채널 기본이 공격(= 원문에 선언이 없는 무조건 적용)이면 선언 대상이 아니다.
  assert.equal(mod.collect(actorWith([targetDeclarableItem({ action: '' })]), 'attack').length, 0);

  // 「당신 이외의 캐릭터가 판정하기 직전에 선언하여 그 판정에 다이스 +3」(커맨드 모빌)처럼
  // 남을 **돕는** 대상 보정은 내 명중판정 창에 올려 봐야 상대에게 걸려 뜻이 반대가 된다.
  assert.equal(mod.collect(actorWith([targetDeclarableItem({ key: 'dice', value: '+(3)' })]), 'attack').length, 0);

  // 타겟이 없으면 회수만 날아가므로, 대상 보정을 거는 선언은 대상 요구를 켜서 넘겨야 한다.
  const component = source('scripts/declared-equipment.js').replace(/\s+/g, ' ');
  assert.match(component, /const needsTarget = declaredEntries\(item\)\.some\(\(\{channel\}\) => channel === 'target'\);/);
  assert.match(component, /handleItemUse\( actor\.id, item\.id, item\.type, undefined, needsTarget,/);
});

test('the declare section renders nothing when there is nothing to declare', () => {
  const { DX3rdDeclaredEquipment: mod } = declaredEquipmentContext();
  assert.equal(mod.sectionHtml([]), '', '후보가 없으면 섹션 자체가 없어야 한다 — 호출측이 분기를 다시 쓰지 않도록');

  const html = mod.sectionHtml(mod.collect(actorWith([declarableItem()]), 'attack'));
  assert.match(html, /data-item-id="w1"/);
  assert.match(html, /DX3rd\.Penetrate 99/, '어느 보정인지 버튼에 보여야 한다');
  assert.match(html, /DX3rd\.DeclareUsesLeft:1/, '남은 횟수를 보여야 한다');
});

test('every dialog declares through the same shared component', () => {
  // 두 창이 각자 수집 규칙을 다시 쓰면 같은 장비가 창마다 다르게 보인다.
  for (const path of ['scripts/handlers/universal-roll-dialog.js', 'scripts/handlers/universal-damage-dialog.js']) {
    assert.match(source(path), /DX3rdDeclaredEquipment\?\.bind\(/, `${path} 는 공용 배선을 써야 한다`);
  }
  // 판정 창은 명중판정일 때만 공격력·관통 계열까지 넓힌다.
  assert.match(source('scripts/handlers/universal-roll-dialog.js'),
    /collect\(actor, isAttackRoll \? 'attack' : 'roll'\)/,
    '판정 창은 명중판정 여부로 문맥을 갈라야 한다');
  // 방어 창은 방어자의 장비를 따로 수집한다 — 배선은 이 한 벌뿐이어야 한다.
  const damageFile = source('scripts/handlers/universal-damage-dialog.js');
  assert.match(damageFile, /collect\(targetActor, 'defense'\)/);
  assert.equal((damageFile.match(/DX3rdDeclaredEquipment\?\.bind\(/g) || []).length, 1,
    '방어 창만 배선한다 — 데미지 산출 창 배선이 되살아나면 잡는다');
  // 선언은 실제 사용 파이프라인을 탄다 — 회수·침식이 여기서 정산된다.
  const component = source('scripts/declared-equipment.js').replace(/\s+/g, ' ');
  assert.ok(component.includes("handleItemUse( actor.id, item.id, item.type, undefined, needsTarget, {action: 'use', comboMode: 'normal'})"),
    '선언은 action:use 로 실제 사용 파이프라인을 타야 한다 — AE 만 직접 걸면 회수·침식이 새어 나간다');

  // 두 창 모두 굴림/확정 시점에 commit 해야 한다 — 토글만으로 소모되면 안 된다.
  assert.match(source('scripts/handlers/universal-roll-dialog.js'), /await commitDeclarations\(\);/,
    '판정 창은 굴림 버튼에서 확정해야 한다');
  assert.match(damageFile, /await declareControl\.commit\(\)/,
    '방어 창은 「확인」에서 확정해야 한다');

  // 공격만으로는 회수도 침식도 나가지 않아야 한다. 게이트는 선언 UI 와 같은 함수(isDeclarable)를
  // 반드시 **포함**해야 "목록엔 뜨는데 이미 소모된" 어긋남이 생기지 않는다. 그 위에 사용 버킷의
  // 익스텐션·매크로까지 넓힌 것이 attackDefersUsage 다.
  const handler = source('scripts/handlers/universal-handler.js').replace(/\s+/g, ' ');
  assert.ok(handler.includes("const declarationOnly = action === 'attack' && this.attackDefersUsage(item);"),
    '선언형 장비의 공격은 비용·회수를 치르지 않아야 한다');
  assert.match(handler, /attackDefersUsage\(item\) \{[\s\S]{0,400}?DX3rdDeclaredEquipment\?\.isDeclarable\?\.\(item\)/,
    '선언 UI 의 판정을 그대로 품어야 두 곳이 갈리지 않는다');
  assert.ok(handler.includes('if (!declarationOnly) { const usageAllowed = await this.processItemUsageCost'),
    '비용 처리와 사용 횟수 증가가 그 게이트 안에 있어야 한다');

  // 방어 창은 다른 경로(시트에서 직접 사용)로 오른 방어 수치도 따라가야 한다.
  assert.match(damageFile, /Hooks\.on\(hook, watchDefenseSource\)/,
    '방어 창은 액터 쪽 변화를 감시해야 한다 — 드롭다운 경로만 갱신하면 시트 사용이 안 보인다');
  assert.match(damageFile, /Hooks\.off\(hook, id\)/, '창이 닫히면 감시를 걷어야 한다');
});

test('the defense dialog folds guard weapons into one dropdown', () => {
  // 무기를 많이 가진 캐릭터에서는 체크박스 목록만으로 창이 화면을 넘어갔다.
  const template = source('templates/dialog/defense-dialog.html');
  assert.match(template, /<select id="weapon-guard-select"/, '무기 선택은 드롭다운이어야 한다');
  assert.equal(template.includes('<input type="checkbox" class="weapon-checkbox"'), false,
    '템플릿이 체크박스를 다시 늘어놓으면 공간 절약이 무의미해진다');

  // 합산 규칙은 하나로 남는다 — 칩 안의 숨은 체크박스가 기존 조회를 그대로 탄다.
  const damageFile = source('scripts/handlers/universal-damage-dialog.js');
  assert.equal((damageFile.match(/querySelectorAll\('\.weapon-checkbox:checked'\)/g) || []).length, 1,
    '가드치를 읽는 곳은 readCheckedWeaponGuard 하나뿐이어야 한다');
  assert.match(damageFile, /hidden\.className = 'weapon-checkbox'/);
  assert.match(damageFile, /dx3rd-weapon-guard-remove/, '고른 무기는 다시 뺄 수 있어야 한다');
  // 폭주는 무기 가드 자체를 잠근다.
  assert.match(damageFile, /weaponSelectEl\.disabled = true/);
});

test('a spent item is warned about, not blocked, unless the world says otherwise', () => {
  // 자동화가 다듬어지는 중이라, 횟수 데이터 하나가 틀렸다고 그 자리에서 못 쓰게 되면
  // 세션이 멈춘다. 기본값은 허용이고, 막을지는 월드 설정이 정한다.
  const main = source('scripts/main.js').replace(/\s+/g, ' ');
  assert.ok(main.includes("game.settings.register('dx3rd-emanim', 'allowExhaustedUse', { name: 'DX3rd.AllowExhaustedUse'"),
    '설정이 등록돼 있어야 한다');
  assert.match(main, /allowExhaustedUse',[^}]*default: true/s, '기본값은 허용(ON)이다');

  // 소진 판정과 차단은 분리돼 있어야 한다 — 표시는 설정과 무관하게 남는다.
  const helpers = source('scripts/helpers.js').replace(/\s+/g, ' ');
  assert.ok(helpers.includes("return game.settings.get('dx3rd-emanim', 'allowExhaustedUse') !== false;"),
    '설정 조회는 공용 유틸 한 곳에 있어야 한다');
  assert.match(helpers, /allowExhaustedUse: function\(\) \{\s*try \{/,
    '설정 등록 전(init 이전) 호출에도 견뎌야 한다');

  // 사용 경로의 두 소진 지점이 같은 보고 함수를 탄다.
  const handler = source('scripts/handlers/universal-handler.js').replace(/\s+/g, ' ');
  assert.equal((handler.match(/await this\.reportUsageExhausted\(actor, item, detail\)/g) || []).length, 2,
    '콤보 멤버 소진과 아이템 자신의 소진이 같은 경로를 써야 한다');
  assert.ok(handler.includes("const allowed = window.DX3rdItemExhausted?.allowExhaustedUse?.() !== false;"),
    '보고 함수가 차단 여부를 정한다');
  assert.equal(handler.includes('사용 횟수가 모두 소진되었습니다'), false,
    '옛 차단 문구가 남아 있으면 두 경로가 갈라진 것이다');

  // 방어 창의 리액션 목록도 소진된 것을 지우지 않고 표시만 한다.
  assert.match(source('scripts/handlers/universal-apply.js'),
    /name: exhausted \? `\$\{name\} \(\$\{game\.i18n\.localize\('DX3rd\.Exhausted'\)\}\)` : name/,
    '소진된 리액션은 이름에 소진 표시가 붙어야 한다');
});

test('reaction dialog offers every auto-action item without keyword filtering', () => {
  const apply = source('scripts/handlers/universal-apply.js');
  assert.match(apply,
    /const directTiming = \['reaction', 'dodge', 'major-reaction', 'auto'\]\.includes\(timing\)/,
    '오토 액션 타이밍은 방어 키워드가 없어도 리액션 드롭다운 후보여야 한다');
  assert.ok(!apply.includes('const autoDefense ='),
    '오토 액션을 설명의 방어 키워드로 다시 거르면 안 된다');
});

test('a major/reaction item uses the dodge profile when invoked from the defense dialog', () => {
  const context = baseContext();
  load(context, 'scripts/handlers/universal-handler.js');
  const resolveRoll = context.DX3rdUniversalHandler.resolveInvocationRollType;

  const dualTiming = {system: {timing: 'major-reaction', roll: 'major'}};
  assert.equal(resolveRoll(dualTiming, {rollType: 'dodge'}), 'dodge',
    'the defense context must select dodge instead of the item\'s stored major profile');
  assert.equal(resolveRoll(dualTiming, {}), 'major', 'ordinary use keeps the authored roll profile');
  assert.equal(resolveRoll({system: {timing: 'major', roll: 'major'}}, {rollType: 'dodge'}), 'major',
    'a major-only item cannot be turned into a reaction by the caller');
  assert.equal(resolveRoll({system: {timing: 'major-reaction', roll: '-'}}, {rollType: 'dodge'}), '-',
    'a modifier-only item must remain no-roll');

  const damage = source('scripts/handlers/universal-damage-dialog.js').replace(/\s+/g, ' ');
  assert.match(damage,
    /useRegisteredReaction[\s\S]*handleItemUse\([\s\S]*rollType: 'dodge',[\s\S]*predefinedDifficulty/,
    'registered defense items must receive the same dodge context as temporary defense combos');

  for (const path of [
    'scripts/handlers/effect-handler.js',
    'scripts/handlers/psionic-handler.js',
    'scripts/handlers/combo-handler.js'
  ]) {
    assert.match(source(path), /resolveInvocationRollType\(item, options\)/,
      `${path} must honor the invocation roll context`);
  }
});

test('a defense-built temporary combo neither asks for a target nor turns into activation', () => {
  const builder = source('scripts/handlers/universal-roll-dialog.js').replace(/\s+/g, ' ');
  const sheet = source('scripts/sheets/combo-sheet-v2.js').replace(/\s+/g, ' ');

  assert.match(builder, /defenseContext: isDefenseSeed/,
    'the defense-only context must survive on the temporary combo document');
  assert.match(sheet, /isDefenseCombo \? false : undefined/,
    'only a defense temporary combo may bypass member target selection');
  assert.match(sheet, /const selectedDefenseRoll = this\.item\.system\?\.roll/,
    'the defense combo must use the roll type currently selected on its sheet');
  assert.match(sheet, /action: 'use',[\s\S]*\['reaction', 'dodge'\]\.includes\(selectedDefenseRoll\)[\s\S]*rollType: selectedDefenseRoll/,
    'reaction/dodge profiles are contextual, while a no-roll guard combo stays no-roll');

  // Registered reaction combos deliberately retain the normal member target gate. The defense
  // dropdown must therefore keep this argument undefined; the exception belongs only to the
  // temporary combo sheet above.
  const damage = source('scripts/handlers/universal-damage-dialog.js').replace(/\s+/g, ' ');
  assert.match(damage,
    /useRegisteredReaction[\s\S]*handleItemUse\( targetActor\.id, itemId, item\.type, null,[^\S\r\n]*\/\/[\s\S]*?undefined,/,
    'saved reaction combos must still honor target-requiring members');
});

test('an effect with no skill applies its modifiers instead of refusing to run', () => {
  const handler = source('scripts/handlers/effect-handler.js');
  // 리액션 창에서 고르는 「다이스 +N」류 이펙트는 굴릴 기능이 없다. 예전에는 경고만 띄우고
  // 중단해 코스트만 나가고 아무 일도 일어나지 않았다. 지금은 기능 미지정이 중단 사유가 아니다 —
  // 난이도가 굴릴 것을 말하지 않으면 판정 없이 효과만, 말하면 빈 풀로 굴린다.
  assert.equal(handler.includes('이펙트의 기능이 설정되지 않았습니다'), false,
    '기능 미지정은 오류가 아니다');
  // 두 판정 경로(무기 보너스 유무)가 같은 한 함수를 쓴다 — 규칙을 두 벌 쓰면 갈린다.
  assert.equal((handler.match(/this\.resolveRollStat\(actor, item\)/g) || []).length, 2,
    '무기 보너스 경로도 같은 해석기를 써야 한다');
  assert.match(handler, /blankRollStat\(\), label: '-'/,
    '기능 미지정은 빈 풀로 굴린다');
  // 기능이 지정됐는데 데이터가 없는 것은 여전히 저작 오류다.
  assert.match(handler, /ui\.notifications\.warn\(game\.i18n\.localize\('DX3rd\.SkillDataNotFound'\)\)/);
});

test('a critical reduction lands even when no effect declares a critical floor', () => {
  const actor = source('scripts/document/actor.js').replace(/\s+/g, ' ');
  // stat.critical = Math.max(critical.min, 10 + 보정) 이므로 하한치의 기본값이 10이면
  // 「크리티컬치 -1」이 통째로 먹힌다. 선언이 없을 때의 하한은 룰 기본치 2다.
  assert.equal(actor.includes("R.min('critical_min', criticalMin)"), false,
    'defaultCritical 을 하한 seed 로 쓰면 선언 없는 크리티컬 감소가 사라진다');
  assert.equal(actor.includes("R.min('critical_min', attrs.critical?.min || defaultCritical)"), false,
    '파생값을 다시 seed 로 먹이면 하한이 되돌아오지 않는다');
  assert.equal((actor.match(/R\.min\('critical_min', Infinity\)/g) || []).length, 2,
    'character/enemy 두 경로 모두 선언된 하한치에서만 도출해야 한다');
  assert.equal((actor.match(/Number\.isFinite\(declaredCriticalMin\) \? declaredCriticalMin : 2/g) || []).length, 2);
});

/** bind() 를 돌리기 위한 최소 DOM 대역. 실제 버튼의 클릭/클래스/disabled 만 흉내낸다. */
function fakeSection(ids) {
  const buttons = ids.map(id => {
    const classes = new Set();
    return {
      dataset: { itemId: id },
      disabled: false,
      _handlers: [],
      classList: {
        add: c => classes.add(c),
        remove: c => classes.delete(c),
        toggle: (c, on) => (on ? classes.add(c) : classes.delete(c)),
        contains: c => classes.has(c)
      },
      setAttribute: () => {},
      querySelector: () => null,
      addEventListener: (_type, fn) => buttons.find(b => b.dataset.itemId === id)._handlers.push(fn),
      click: () => buttons.find(b => b.dataset.itemId === id)._handlers
        .forEach(fn => fn({ preventDefault() {}, stopPropagation() {} }))
    };
  });
  return { root: { querySelectorAll: () => buttons }, buttons };
}

test('toggling costs nothing; only the roll commits the use', async () => {
  const context = declaredEquipmentContext();
  const used = [];
  context.DX3rdUniversalHandler = { handleItemUse: async (_a, itemId) => { used.push(itemId); return true; } };

  const item = declarableItem();
  const actor = actorWith([item]);
  actor.items.get = id => (id === item.id ? item : null);

  const { root, buttons } = fakeSection([item.id]);
  const control = context.DX3rdDeclaredEquipment.bind(root, actor);

  // 토글만 해서는 아무것도 소모되지 않는다 — 굴리지 않고 닫는 경우가 바로 이 상태다.
  buttons[0].click();
  assert.equal(control.hasPending(), true);
  assert.deepEqual(used, [], '토글 단계에서 handleItemUse 가 불리면 안 된다 — 창만 닫아도 회수가 날아간다');

  // 다시 누르면 해제된다(즉시 선언이던 시절엔 되돌릴 수 없었다).
  buttons[0].click();
  assert.equal(control.hasPending(), false);

  buttons[0].click();
  const applied = await control.commit();
  assert.deepEqual(used, [item.id], '확정 시점에 한 번만 사용해야 한다');
  assert.equal(applied.length, 1);
  assert.equal(buttons[0].classList.contains('declared'), true);
  assert.equal(buttons[0].disabled, true, '확정된 버튼은 같은 판정에서 다시 눌리면 안 된다');

  // 확정 후에는 선택이 비므로, 굴림을 두 번 눌러도 두 번 소모되지 않는다.
  await control.commit();
  assert.deepEqual(used, [item.id]);
});

test('a refused use releases the toggle instead of locking it', async () => {
  const context = declaredEquipmentContext();
  context.DX3rdUniversalHandler = { handleItemUse: async () => false };

  const item = declarableItem();
  const actor = actorWith([item]);
  actor.items.get = id => (id === item.id ? item : null);

  const { root, buttons } = fakeSection([item.id]);
  const control = context.DX3rdDeclaredEquipment.bind(root, actor);
  buttons[0].click();
  const applied = await control.commit();

  // 비용을 못 내 거부된 항목까지 잠가 버리면, 조건을 고친 뒤 다시 고를 수 없다.
  // (applied 는 vm 렐름 배열이라 deepEqual 이 구조가 같아도 실패한다 — 길이로 본다.)
  assert.equal(applied.length, 0);
  assert.equal(buttons[0].disabled, false);
  assert.equal(buttons[0].classList.contains('declared'), false);
});

test('a parametric range/target option waits for its number instead of collapsing to "-"', async () => {
  const context = baseContext({ game: { i18n: { localize: key => key } } });
  load(context, 'scripts/combo-range-target.js');

  const handlers = new Map();
  const bind = (id, node) => Object.assign(node, {
    addEventListener: (name, fn) => handlers.set(`${id}:${name}`, fn)
  });
  // 템플릿은 hidden 속성으로 숨긴다. 인라인 display 로 되살리려던 옛 코드는 [hidden] 을
  // 이기지 못해 입력칸이 끝내 안 보였고, 빈 파라미터가 '-' 로 저장돼 선택이 되돌아갔다.
  const select = bind('sel', { value: '단독' });
  const param = bind('param', {
    value: '', hidden: true, focused: false,
    style: { removeProperty() {} },
    focus() { this.focused = true; }
  });
  const store = { value: '단독' };
  const field = {
    dataset: { rt: 'target' },
    querySelector: selector => (selector === '.rt-option' ? select
      : selector === '.rt-param' ? param : store)
  };

  const updates = [];
  context.window.DX3rdRangeTarget.setupFieldListeners(
    { querySelectorAll: () => [field] }, {}, { update: (item, change) => updates.push(change) });

  select.value = '대상수';
  await handlers.get('sel:change')();
  assert.equal(param.hidden, false, '파라미터 입력칸이 실제로 드러나야 한다');
  assert.equal(param.focused, true);
  assert.equal(updates.length, 0, '숫자가 비어 있는 동안에는 저장하지 않는다');

  param.value = '3';
  await handlers.get('param:change')();
  assert.equal(updates.length, 1);
  assert.equal(updates[0]['system.target'], '3체');
  assert.equal(store.value, '3체');
});

test('a nameless sheet checkbox saves through the form, and keeps the authored difficulty', () => {
  // 판정을 켜는 것뿐인데 난이도까지 비우면 저작해 둔 목표치(12 / 대결 / 효과참조)가 사라진다.
  for (const path of ['scripts/sheets/item-sheet.js', 'scripts/sheets/combo-data.js']) {
    const text = source(path);
    assert.match(text, /const stale = !currentDifficulty \|\| currentDifficulty === freepassText \|\| currentDifficulty === '-';/, path);
    assert.match(text, /'system\.difficulty': stale \? '' : currentDifficulty/, path);
  }

  // name 없는 체크박스를 별도 item.update 로 저장하면 같은 change 이벤트의 submitOnChange
  // 저장과 경합한다. 전부 _prepareSubmitData 로 접어 넣은 상태를 고정한다.
  const folded = {
    'scripts/sheets/effect-sheet-v2.js': ['.difficulty-check', '[data-target-field="system.getTarget"]'],
    'scripts/sheets/combo-sheet-v2.js': ['.difficulty-check'],
    'scripts/sheets/psionic-sheet-v2.js': ['.difficulty-check'],
    'scripts/sheets/spell-sheet-v2.js': ['.casting-roll-check', '[data-target-field="system.getTarget"]']
  };
  for (const [path, selectors] of Object.entries(folded)) {
    const text = source(path);
    for (const selector of selectors) {
      assert.equal(text.includes(`listen('change', '${selector}'`), false, `${path}: ${selector}`);
      assert.equal(text.includes(`matches?.('${selector}')`), true, `${path}: ${selector}`);
    }
  }
});

test('the description edit toggle hides by opacity, and the HTML source view fills the editor', () => {
  const css = source('styles/appv2-sheets.css').replace(/\s+/g, ' ');

  // 코어가 button.toggle 의 display 를 세 벌 잡고 있고 테마 모듈 CSS 는 시스템보다 뒤에
  // 실린다. display 로 다투면 「항상 보임」/「끝내 안 보임」 중 하나로 무너지므로,
  // 박스는 늘 flex 로 두고 드러남만 opacity 로 가른다.
  const hidden = css.indexOf('.application.sheet.dx3rd-emanim.item prose-mirror button.toggle:enabled {');
  assert.ok(hidden > -1, '아이템 시트 편집 토글 기본 규칙이 있어야 한다');
  const hiddenBlock = css.slice(hidden, css.indexOf('}', hidden));
  assert.ok(hiddenBlock.includes('opacity: 0;'), '기본 상태는 opacity 로 감춘다');
  assert.equal(hiddenBlock.includes('display: none'), false, 'display 로 감추면 코어/모듈과 다툰다');

  assert.ok(css.includes('.application.sheet.dx3rd-emanim.item prose-mirror:hover button.toggle:enabled, '
    + '.application.sheet.dx3rd-emanim.item prose-mirror:focus-within button.toggle:enabled { opacity: 1;'),
    '해설에 마우스를 올렸을 때(또는 포커스가 안에 있을 때)만 드러나야 한다');

  // 소스 보기의 code-mirror 는 height:100%/min-height:150px 뿐이라 신축 지시가 없으면
  // 150px 상자로 쪼그라든다.
  assert.ok(css.includes('prose-mirror.editing-source code-mirror.source-editor { flex: 1 1 auto; height: auto;'),
    'HTML 소스 편집창이 prose-mirror 를 그대로 채워야 한다');
});

test('every socket type is handled in exactly one layer, so no branch is dead on arrival', () => {
  // 타입 핸들러는 consume:true 로 등록되고, 라우터는 consumed 면 제네릭 리스너를 아예
  // 건너뛴다(socket-router.js 의 `if (consumed) return;`). 그래서 같은 타입을 두 계층에
  // 모두 적으면 뒤쪽(main.js) 은 **한 번도 실행되지 않는다** — 문법도 맞고 검사도 통과하니
  // 고쳐도 조용히 무효가 된다. 실제로 그렇게 25개 분기 275줄이 남아 있었고, 그 사이
  // healRejected 는 죽은 쪽이 하드코딩 한국어, 산 쪽이 i18n 으로 갈라져 있었다.
  const literals = (text, pattern) => {
    const out = new Set();
    for (const match of text.matchAll(pattern)) {
      for (const literal of match[1].matchAll(/['"]([^'"]+)['"]/g)) out.add(literal[1]);
    }
    return out;
  };
  const registrationPattern = /register(?:Type)?\(\s*(\[[^\]]*\]|'[^']*'|"[^"]*")/g;

  const typed = new Set();
  for (const path of ['scripts/socket-document-handlers.js', 'scripts/combat/combat-socket.js',
    'scripts/handlers/universal-after-main.js']) {
    for (const type of literals(source(path), registrationPattern)) typed.add(type);
  }

  const main = source('scripts/main.js');
  const listener = main.slice(main.indexOf('socketRouter.register(async (data)'));
  assert.ok(listener.length > 0, 'main.js 의 제네릭 소켓 리스너를 찾지 못했다');
  const generic = new Set([...listener.matchAll(/data\.type === ['"]([^'"]+)['"]/g)].map(m => m[1]));

  const shadowed = [...generic].filter(type => typed.has(type));
  assert.deepEqual(shadowed, [],
    `제네릭 분기가 타입 핸들러에 가려 실행되지 않는다: ${shadowed.join(', ')}`);

  // 반대 방향도 같은 함정이다 — 계약만 있고 어느 계층도 받지 않으면 메시지가 조용히 버려진다.
  const contracts = literals(source('scripts/socket-contracts.js'),
    /contract\(\s*(\[[^\]]*\]|'[^']*'|"[^"]*")/g);
  const orphaned = [...contracts].filter(type => !typed.has(type) && !generic.has(type));
  assert.deepEqual(orphaned, [], `계약은 있는데 처리자가 없다: ${orphaned.join(', ')}`);

  // 그리고 처리자가 있는데 계약이 없으면 발신자 권한 검사를 건너뛴다.
  const ungoverned = [...typed, ...generic].filter(type => !contracts.has(type));
  assert.deepEqual(ungoverned, [], `계약 없이 처리되는 타입: ${ungoverned.join(', ')}`);
});

// DialogV2.wait 은 버튼 콜백이 nullish 를 돌려주면 그 자리에 **버튼의 action 문자열**을 채운다
// (foundry client/applications/api/dialog.mjs 의 `(await callback(...)) ?? button?.action`).
// 그래서 취소 콜백의 `() => null` 은 호출부에 truthy 한 "cancel" 로 도착한다 — X 로 닫으면
// null 이 오므로(같은 파일의 `resolve(result ?? null)`) 두 취소 경로가 조용히 갈린다.
// 실제로 컴펜디움 동기화는 취소가 계획으로 오해되어 터졌고, 자원/침식 입력 창은 취소해도
// 그대로 진행돼 HP 에 NaN 을 쓸 수 있었다.
test('a dialog button callback never returns nullish, so cancel cannot arrive as its action string', () => {
  const offenders = [];
  for (const path of walkJs(resolve(root, 'scripts'))) {
    const text = readFileSync(path, 'utf8');
    // `new DialogV2(...)` 를 직접 만들어 자기 Promise 를 resolve 하는 자리는 이 경로를
    // 타지 않는다. wait() 를 쓰는 파일만 본다.
    if (!text.includes('DialogV2.wait')) continue;
    const relative = path.slice(resolve(root).length + 1).split(sep).join('/');
    // 블록 본문은 중첩 함수의 `return null` 과 최상위 반환을 정적으로 구별할 수 없으므로
    // 검사하지 않는다(실제 함정은 전부 한 줄 화살표였다). 대신 한 줄 화살표는 전부 본다.
    for (const match of text.matchAll(/callback:\s*(?:async\s*)?\([^)]*\)\s*=>\s*([^\n{][^\n]*)/g)) {
      const body = match[1].trim().replace(/[,;]\s*$/, '');
      // `|| null` 도 같은 함정이다 — 미선택 상태로 확인을 누르면 "confirm" 이 값이 된다.
      if (/^(null|undefined)$/.test(body) || /\|\|\s*(null|undefined)$/.test(body)) {
        offenders.push(`${relative}: ${match[0].trim().slice(0, 70)}`);
      }
    }
  }
  assert.deepEqual([...new Set(offenders)], [],
    `DialogV2 콜백이 nullish 를 반환한다(action 문자열로 바꿔치기된다): ${offenders.join(' | ')}`);
});

// 다이스 개수 자리의 괄호는 안쪽에 연산이 있을 때만 뜻을 갖는다. 벗기면 안 되는 것을 벗기면
// `([level]+1)d10`(= level+1 개) 이 `[level]+1d10`(= level + 1d10) 으로 조용히 뒤바뀐다.
// 반대로 잉여 `+` 는 Foundry 가 버리므로(grammar.pegjs 의 leading, parser.mjs 의 `=== "-"`)
// 떼어도 값이 변하지 않는다 — `-` 는 부호를 뒤집으므로 절대 건드리지 않는다.
test('dice-count parentheses are stripped only where they carry no meaning', () => {
  const unchanged = [
    '([level]+1)d10',   // 연산이 있다 — 괄호가 없으면 결합이 달라진다
    '([level]*2)d10',
    '([level]*2+1)d10',
    '(-2)d10',          // 선행 `-` 는 의미가 있다
    '(1d10)d10',        // 동적 개수 — 안쪽이 단일 항이 아니다
    '2d10',
    '[level]d10',
    '1d10 + 3',
    '(3)',              // 뒤에 다이스가 없으면 개수 자리가 아니다
    ''
  ];
  for (const formula of unchanged) {
    assert.equal(normalizeDiceCount(formula), formula, `${formula} 는 그대로여야 한다`);
  }

  assert.equal(normalizeDiceCount('(+3)d10'), '3d10');
  assert.equal(normalizeDiceCount('(+[level])d10'), '[level]d10');
  assert.equal(normalizeDiceCount('(2)d10'), '2d10');
  assert.equal(normalizeDiceCount('(+[level]+1)d10'), '([level]+1)d10');
  assert.equal(normalizeDiceCount('(+([level]+1))d10'), '([level]+1)d10');
  assert.equal(normalizeDiceCount('1d10 + (+2)d10'), '1d10 + 2d10');

  // 두 번 돌려도 같아야 한다(팩 마이그레이션 하네스의 멱등성 검증과 같은 요구).
  for (const formula of [...unchanged, '(+3)d10', '(+([level]+1))d10']) {
    assert.equal(normalizeDiceCount(normalizeDiceCount(formula)), normalizeDiceCount(formula));
  }
});

// 선행 `+` 를 떼는 축은 다이스식 전용이다. 일반 수정치의 `+5`·`+[level]*2` 는 이 컴펜디움의
// 확립된 표기이고(보정 행 1107건 중 선행 `+` 616 · 무부호 361), 무부호로 쓰는 키가 따로 있다
// (`critical_min`·`penetrate`·`reduce` 는 전부 무부호 = 가산이 아니라 값의 성질을 따르는 자리).
// 그 축까지 통일하면 「가산인가 대입인가」의 구분이 표기에서 사라진다.
test('the leading-plus cleanup applies to dice formulas only, never to plain modifiers', () => {
  assert.equal(normalizeDiceFormula('+2d10'), '2d10');
  assert.equal(normalizeDiceFormula('+([level]*3)+1d10'), '([level]*3)+1d10');
  assert.equal(normalizeDiceFormula('(+3)d10'), '3d10');

  for (const plain of ['+5', '+[level]*2', '+[level]+1', '-3', '5', '[level]*3']) {
    assert.equal(normalizeDiceFormula(plain), plain, `${plain} 은 다이스식이 아니므로 그대로여야 한다`);
  }
  // 음수는 다이스식이어도 뜻이 있다.
  assert.equal(normalizeDiceFormula('-2d10'), '-2d10');
  // 두 번 돌려도 같다.
  for (const formula of ['+2d10', '+([level]*3)+1d10', '+5', '-2d10']) {
    assert.equal(normalizeDiceFormula(normalizeDiceFormula(formula)), normalizeDiceFormula(formula));
  }
});

// 저장 기본값에 해당하는 <option> 이 없는 <select> 는 조용히 값을 바꾼다. 브라우저가 첫
// 항목을 표시하고, AppV2 의 submitOnChange 가 그 표시값을 문서에 굳히기 때문이다 —
// 시트를 열어 아무 칸이나 건드리는 것만으로. weaponTmp 가 '-' 에서 'virtual-melee' 로
// 새어 나가 컴펜디움 동기화가 매번 같은 아이템을 「갱신 필요」로 잡았고, 팩에도 13건이
// 굳은 채 커밋돼 있었다(2026-08-14 정리).
//
// 기능 드롭다운(`system.skill` 계열)이 안전한 이유는 옵션 생성기가 '-' 를 먼저 넣기
// 때문이다(helpers.js 의 getSkillSelectOptions). 동적 목록을 쓰면서 그런 보장이 없는
// select 는 정적 <option> 으로 「비어 있음」을 직접 제공해야 한다.
test('a dynamic select always offers an option for its stored default', () => {
  const templateRoot = resolve(root, 'templates');
  const walkHtml = (directory) => readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const full = resolve(directory, entry.name);
    return entry.isDirectory() ? walkHtml(full) : (entry.name.endsWith('.html') ? [full] : []);
  });

  // 옵션 생성기가 '-' 를 보장하는 컨텍스트. 여기서 나온 목록은 정적 option 이 없어도 안전하다.
  const GUARANTEED = ['skillOptions', 'effectSkillOptions', 'weaponSkillOptions', 'vehicleSkillOptions'];
  const offenders = [];
  for (const file of walkHtml(templateRoot)) {
    const text = readFileSync(file, 'utf8');
    for (const match of text.matchAll(/<select\b([^>]*)>([\s\S]*?)<\/select>/g)) {
      const [, attrs, body] = match;
      const name = attrs.match(/name\s*=\s*"([^"]+)"/)?.[1];
      if (!name) continue;                                   // name 이 없으면 폼에 실리지 않는다
      if (!/\{\{#each\b/.test(body)) continue;                 // 정적 목록은 저작자가 값을 다 적었다
      if (/<option\s+value="[^"{}]*"/.test(body)) continue;   // 정적 option 이 「비어 있음」을 제공한다
      if (GUARANTEED.some(source => body.includes(source))) continue;
      const line = text.slice(0, match.index).split('\n').length;
      offenders.push(`${file.slice(resolve(root).length + 1).split(sep).join('/')}:${line} name="${name}"`);
    }
  }
  assert.deepEqual(offenders, [],
    `저장 기본값을 표시할 수 없는 select 가 있다(첫 항목이 폼 제출로 굳는다): ${offenders.join(' | ')}`);
});

// 가상 무기는 「무기 없음」 한 장뿐이고, 아무것도 고르지 않은 것과 결과가 같아야 한다.
//
// 예전 두 장(`RC : 백병`/`RC : 사격`)은 「대응 무기가 없어도 백병/사격 채널을 준다」가
// 목적이었는데, 그 목적은 이미 아이템 자신의 attackRoll 이 달성한다(resolveAttackType →
// resolveAttackBonuses → isAttackRoll). 실측(팩+월드 3872건)에서 system.weapon 에 등록된
// 가상 무기는 0건이고, 대신 무기 드롭다운의 첫 항목이 되어 weaponTmp 유출의 표적이 됐다.
// 남은 역할은 「빈 선택을 거부하는 무기 선택 창에서 무기 없이 빠져나가기」 하나뿐이다.
test('the virtual weapon is a single blank row that carries nothing into the roll', () => {
  const context = baseContext();
  load(context, 'scripts/virtual-weapons.js');
  const virtual = context.DX3rdVirtualWeapons;

  const rows = virtual.list('melee');
  assert.equal(rows.length, 1, '가상 무기는 한 장이다');
  const [row] = rows;
  assert.equal(row.name, '-', '이름은 아무것도 고르지 않은 것처럼 보여야 한다');
  // 공격 종류만 이 판정의 attackRoll 을 따르고, 더할 수치는 하나도 없다.
  assert.equal(row.system.type, 'melee');
  assert.equal(row.system.skill, 'melee');
  for (const field of ['attack', 'add', 'guard', 'range']) {
    assert.equal(row.system[field], '',
      `${field} 는 0 이 아니라 빈칸이어야 표에 아무것도 그려지지 않는다`);
  }
  assert.equal(row.system['attack-used'].disable, 'notCheck', '소진 개념이 없다');
  assert.equal(virtual.list('ranged')[0].system.type, 'ranged');
  // 문맥이 없으면 공격 종류도 비운다 — 없는 값을 지어내지 않는다.
  assert.equal(virtual.list()[0].system.type, '');

  // 옛 두 id 는 해석만 해 준다(새로 만들지는 않는다). 그래야 남아 있는 저장값이
  // 갑자기 undefined 로 풀려 호출부가 터지지 않는다.
  for (const [legacy, type] of [['virtual-melee', 'melee'], ['virtual-ranged', 'ranged']]) {
    assert.ok(virtual.isVirtual(legacy), `${legacy} 는 여전히 가상 id 로 인식된다`);
    assert.equal(virtual.get(legacy).system.type, type, '옛 id 는 제 이름에서 종류를 되찾는다');
    assert.equal(virtual.get(legacy).id, virtual.ID, '되찾아도 id 는 새 한 장으로 통일된다');
  }
  assert.equal(virtual.isVirtual('some-real-item-id'), false);
  // DX3rdResolveWeapon 은 콤보 계산 6곳이 옵셔널 체이닝 없이 부르므로 사라지면 안 된다.
  assert.equal(typeof context.DX3rdResolveWeapon, 'function');
  assert.equal(context.DX3rdResolveWeapon({items: {get: () => 'real'}}, 'x'), 'real');

  // 선택 결과가 운반값에 남지 않는다: 가상만 고르면 무기 보너스 자체가 null 이고,
  // 실무기와 함께 골라도 이름·id 목록에 끼지 않는다.
  const dialog = source('scripts/dialog/weapon-for-attack-dialog.js');
  assert.match(dialog, /realWeaponIds\s*=\s*selectedWeaponIds\.filter\(id => !isVirtual\(id\)\)/);
  assert.match(dialog, /if \(realWeaponIds\.length === 0\) return null;/);
  assert.match(dialog, /await this\.callback\(bonus\);/);
  assert.match(dialog, /for \(const weaponId of realWeaponIds\)/);
  assert.match(dialog, /weaponIds: realWeaponIds/);

  // 시트의 무기 등록 드롭다운에는 넣지 않는다 — 거기엔 이미 같은 뜻의 정적 `-` 옵션이 있어
  // 두 벌이 되고, 등록해 봐야 수치 기여가 0 이라 목록만 흐려진다.
  // (옛 저장값이 등록돼 있을 때 편집 버튼을 막는 isVirtual 가드는 그대로 둔다 —
  //  여기서 막는 것은 목록에 **얹는** 쪽이다.)
  assert.doesNotMatch(source('scripts/helpers.js'), /DX3rdVirtualWeapons\?\.list/,
    '무기 등록 드롭다운은 가상 무기를 싣지 않는다');

  // 반대로 공격 시 선택 창 셋은 반드시 실어야 한다(그것이 남은 유일한 역할이다).
  for (const path of ['scripts/handlers/effect-handler.js', 'scripts/handlers/combo-handler.js',
                      'scripts/handlers/psionic-handler.js']) {
    assert.match(source(path), /DX3rdVirtualWeapons\?\.list\?\.\(attackRollType\)/,
      `${path} 는 이 판정의 공격 종류로 「무기 없음」 행을 만들어야 한다`);
  }
});

// 「사용 시 무기를 고른다」로 저작한 공격은 이 창이 유일한 통로다. 그래서 이 창은
// **막다른 길이 되어서는 안 된다** — 여기서 못 나가면 콤보 시트의 무기 슬롯에 고정하는
// 것 말고 방법이 없어지고, 그것은 저작 의도를 되돌리는 것이다.
test('the weapon picker is never a dead end: it can always hand the roll back', () => {
  const dialog = source('scripts/dialog/weapon-for-attack-dialog.js');

  // ⑴ 리스너는 렌더마다 다시 붙으므로 앞의 것을 끊어야 한다. 행 클릭 핸들러가 두 벌이면
  //    한 번 누를 때 두 번 토글되어 **체크가 영영 들어가지 않고**, 확인은 빈 선택으로 떨어진다.
  assert.match(dialog, /this\._listeners\?\.abort\(\)/,
    '이전 렌더의 리스너를 끊는다');
  assert.match(dialog, /this\._listeners = new AbortController\(\)/);
  for (const bind of [/root\.addEventListener\('click'[\s\S]*?\{signal\}\)/,
                      /weapon-confirm[\s\S]*?\{signal\}\)/,
                      /weapon-cancel[\s\S]*?\{signal\}\)/]) {
    assert.match(dialog, bind, '모든 리스너가 같은 signal 로 묶인다');
  }

  // ⑵ 빈 선택은 오류가 아니라 「무기 없음」이다. 목록의 `-` 행과 같은 뜻이므로 경고로
  //    막지 않는다(예전에는 여기서 정지해 창을 닫는 것 말고 할 수 있는 일이 없었다).
  assert.doesNotMatch(dialog, /무기를 선택해주세요/,
    '고르지 않고 확인하는 것은 무기 없이 진행하는 것이다');

  // ⑶ 콜백이 던져도 창이 남아 조용히 멈추지 않는다 — 먼저 닫고, 실패는 반드시 알린다.
  const confirm = dialog.slice(dialog.indexOf('async confirmSelection()'));
  const closeAt = confirm.indexOf('await this.close()');
  const callbackAt = confirm.indexOf('await this.callback(bonus)');
  assert.ok(closeAt > -1 && callbackAt > closeAt, '넘기기 전에 닫는다');
  assert.match(confirm, /catch \(error\)[\s\S]*?ui\.notifications\.error\(game\.i18n\.localize\('DX3rd\.WeaponSelectionFailed'\)\)/,
    '실패는 콘솔과 알림으로 남는다');
  assert.match(confirm, /if \(this\._submitting\) return;/,
    '확인 두 번 누른다고 판정 창이 둘 열리지 않는다');

  // ⑷ 그 알림 문구와 목록 안내는 실제로 존재해야 한다.
  const ko = JSON.parse(source('lang/ko.json'));
  for (const key of ['DX3rd.WeaponSelectionFailed', 'DX3rd.WeaponSelectionHint']) {
    assert.ok(ko[key], `${key} 가 ko.json 에 있어야 한다`);
  }
  assert.match(source('templates/dialog/weapon-for-attack-dialog.html'),
    /DX3rd\.WeaponSelectionHint/, '고르지 않아도 된다는 것을 창에서 알린다');
});

// 공격력 보정 행의 라벨은 「능력치/기능」이 아니라 **공격 종류 버킷**이다
// (`-`/melee/ranged/fist). 열 헤더는 한 벌뿐인데 한 목록에 키가 다른 행이 섞이므로,
// 뜻을 알리는 것은 옵션 글자와 툴팁뿐이다. 그리고 `fist`(맨손 한정)는 런타임이 처음부터
// 집계하는데 이 목록에 없어 저작할 방법이 없었다 — 실측 0건의 원인이 그것이었다.
test('the weapon-type modifier label offers every bucket the runtime counts, and never leaves a stored value unrepresented', () => {
  const helpers = source('scripts/helpers.js');
  const block = helpers.slice(helpers.indexOf("if (selectedKey === 'attack'"));
  const pane = block.slice(0, block.indexOf('} else if'));
  assert.ok(pane.length > 100 && pane.length < block.length,
    '공격/가드 종류 드롭다운 블록을 찾지 못했다');

  // 라벨이 무기 종류 버킷인 키. 이 둘은 **같은 목록**을 써야 한다 — 갈라 두면 「맨손의
  // 공격력과 가드치에 각각 +N」(강인한 골격) 한 문장을 두 어휘로 저작하게 된다.
  const actor = source('scripts/document/actor.js');
  for (const key of ['attack', 'guard']) {
    assert.ok(pane.includes(`selectedKey === '${key}'`),
      `'${key}' 행이 종류 드롭다운을 받지 못한다`);
    // actor.js 가 가르는 버킷과 드롭다운이 갈리면 저작할 수 없는 버킷이 생긴다.
    const buckets = actor.match(new RegExp(`R\\.bucket\\('${key}',\\s*\\[([^\\]]+)\\]\\)`));
    assert.ok(buckets, `actor.js 가 ${key} 를 라벨 버킷으로 가르는 곳을 찾지 못했다`);
    for (const label of buckets[1].match(/'([a-z]+)'/g).map(s => s.slice(1, -1))) {
      assert.ok(pane.includes(`addOption(select, '${label}'`),
        `종류 드롭다운에 '${label}' 버킷이 없어 저작할 방법이 없다(${key})`);
    }
    // 고정 수치와 다이스식이 같은 버킷 목록을 써야 한다. 갈리면 그 버킷의 다이스식이
    // `_`(전체)로 새어 무기를 가리지 않고 굴러간다.
    assert.ok(actor.includes(`R.actionDiceFormula('${key}', [${buckets[1]}])`),
      `${key} 의 다이스식이 같은 버킷 목록을 쓰지 않는다`);
  }

  // 전체(무한정)를 고르는 행. 값은 `-` 그대로여야 기존 데이터와 뜻이 같다.
  assert.match(pane, /addOption\(select, '-', game\.i18n\.localize\('DX3rd\.AttackTypeAll'\)\)/,
    "`-`(전체)는 뜻을 말하는 글자로 보여야 한다 — `-` 로는 이 칸이 무기 종류라는 것을 알 수 없다");
  assert.match(pane, /'DX3rd\.AttackTypeHint' : 'DX3rd\.GuardTypeHint'/,
    '툴팁이 키에 따라 갈리지 않으면 가드 행에 공격 설명이 붙는다');

  // 목록에 없는 저장값을 그대로 대입하면 브라우저가 첫 항목을 보여 준다(= 칸이 비거나
  // 뜻이 바뀐다). 뜻이 같은 `-` 로 명시해 맞춘다. [드롭다운의 저장 기본값] 절과 같은 함정.
  assert.match(pane, /includes\(currentValue\)\s*\?\s*currentValue\s*:\s*'-'/,
    "저장값이 목록에 없을 때 `-` 로 떨어지지 않으면 칸이 빈 채로 보인다");

  for (const key of ['DX3rd.AttackTypeAll', 'DX3rd.AttackTypeHint', 'DX3rd.GuardTypeHint', 'DX3rd.Fist']) {
    assert.ok(key in JSON.parse(source('lang/ko.json')), `${key} 가 ko.json 에 없다`);
  }

  // 빌더의 행 조립기는 라벨 기본값을 키 이름으로 둔다. 다른 키에서는 런타임이 라벨을 읽지
  // 않아 무해하지만 이 둘만은 뜻이 있는 자리라, 키 이름이 굳으면 드롭다운에 없는 값이
  // 된다(팩 attack 146건 · guard 57건). 이 예외가 사라지면 재빌드가 그 표기를 되살린다.
  const privateBuilder = resolve(root, '_source/apply-overrides.mjs');
  if (existsSync(privateBuilder)) {
    assert.match(readFileSync(privateBuilder, 'utf8'),
      /\(a\.key === 'attack' \|\| a\.key === 'guard'\) \? '-' : a\.key/,
      "attrRow 가 두 키의 라벨을 '-' 로 떨어뜨리지 않으면 재빌드가 키 이름 라벨을 되살린다");
  }
});

test('a weapon-limited guard bonus is counted only for the weapon actually used to guard', () => {
  const actor = source('scripts/document/actor.js');
  const handler = source('scripts/handlers/universal-handler.js');
  const dialog = source('scripts/handlers/universal-damage-dialog.js');

  // 버킷분이 base 로 내려가면 무기를 고르지 않아도 붙는다 — 「맨손의 가드치 +3」이
  // 총으로 가드할 때도, 아예 무기를 고르지 않았을 때도 붙는다는 뜻이다.
  assert.match(actor, /attrs\.guard\.base = Math\.max\(grd\._/,
    'guard.base 가 전체 버킷(`_`)만 받지 않으면 종류 한정 보정이 무조건 붙는다');
  for (const bucket of ['melee', 'ranged', 'fist']) {
    assert.ok(actor.includes(`attrs.guard.${bucket} = grd.${bucket};`),
      `guard.${bucket} 을 내보내지 않으면 방어 창이 그 몫을 꺼낼 수 없다`);
  }

  // 맨손 판정이 종별보다 먼저다 — 맨손의 system.type 은 melee 라, 순서를 뒤집으면
  // fist 버킷이 영영 걸리지 않는다.
  const resolve = handler.slice(handler.indexOf('resolveGuardBuckets = function'),
    handler.indexOf('getWeaponGuardBonus = function'));
  const fistAt = resolve.indexOf('isFistWeaponName');
  const typeAt = resolve.indexOf("type === 'melee'");
  assert.ok(fistAt > -1 && typeAt > -1 && fistAt < typeAt,
    '맨손 판정이 종별 판정보다 뒤에 있으면 맨손이 melee 로 뭉개져 fist 가 죽는다');

  // **맨손은 fist 와 melee 를 둘 다 받는다 — 배타가 아니라 가산이다.** 룰상 맨손은
  // 「종별: 백병」이라 「백병 무기의 가드치에 +N」이 맨손으로 가드할 때도 붙어야 하고,
  // 공격력 쪽이 이미 그렇다(맨손의 system.type 이 melee 라 melee 버킷이 붙고 그 위에
  // getFistAttackBonus 가 fist 를 **더한다**). 여기서 하나만 고르면 같은 라벨 어휘가 두
  // 키에서 다른 뜻이 되어 「맨손 및 백병」을 저작할 수 없다.
  assert.ok(!/return 'fist';/.test(resolve),
    '맨손에서 조기 반환하면 melee 버킷이 빠져 공격력 쪽과 뜻이 갈린다');
  assert.match(resolve, /buckets\.push\('fist'\)/, '맨손 버킷을 누적하지 않는다');
  assert.match(handler.slice(handler.indexOf('getWeaponGuardBonus = function')),
    /for \(const bucket of this\.resolveGuardBuckets\(weapon\)\)/,
    '가드 보정 합산이 버킷 하나만 보면 맨손의 백병분이 사라진다');

  // 무기가 정해지는 곳은 방어 다이얼로그의 무기 목록 하나다. 여기서 합류시키지 않으면
  // 버킷에 남겨 둔 몫이 아무 데도 도달하지 않는다(= 조용히 사라진다).
  assert.match(dialog, /getWeaponGuardBonus\(targetActor, weapon\)/,
    '방어 창이 무기별 버킷 보정을 꺼내지 않으면 버킷에 남긴 몫이 사라진다');
  assert.match(dialog, /const guardFixed = \([\s\S]{0,120}\)\s*\n?\s*\+ bucket\.fixed;/,
    '무기 고유 가드치와 버킷 보정이 한 값으로 합쳐지지 않는다');
  // 다이스식도 같이 실려야 한다. 고정분만 합치면 `[레벨]d10` 짜리 버킷 보정이 0이 된다.
  assert.match(dialog, /bucket\.formula\]\.filter\(Boolean\)\.join\(' \+ '\)/,
    '버킷의 다이스식이 무기 가드 수식에 합류하지 않는다');

  // 방어 중 효과가 가드를 바꿨을 때의 **차분**은 심은 값과 읽는 값이 같은 양이어야 한다.
  // 창의 입력칸은 `base` 에서 출발하는데(장착 무기분은 무기 선택으로 따로 더한다) 차분을
  // `value`(= base + 장착 무기분)로 읽으면, 첫 차분에 장착 무기분이 통째로 얹혀 이중
  // 가산이 된다. 버킷 보정이 생기면서 그 차이가 더 커졌다.
  const seed = dialog.indexOf('let lastKnownDefense');
  const refresh = dialog.slice(seed, dialog.indexOf('lastKnownDefense = current;', seed));
  assert.ok(!/guard\?\.value \|\| 0/.test(refresh),
    '차분 계산이 guard.value 를 읽으면 장착 무기 가드치가 이중 가산된다');
  assert.match(refresh, /guard\?\.base/,
    '차분 계산은 입력칸의 출발값과 같은 guard.base 를 읽어야 한다');
});

test('the fist item is restored from its pre-change snapshot, never from hardcoded defaults', () => {
  const ext = source('scripts/handlers/universal-extensions.js');

  // 기본치의 출처는 한 곳뿐이다. 예전에는 이 리터럴이 생성 1곳 + 복원 3곳에 복제돼 있었고,
  // 복원 쪽이 「되돌리기」가 아니라 「덮어쓰기」라 손본 맨손과 영구 변경(《사이버 암》)을
  // 전투가 끝날 때마다 지웠다.
  assert.match(ext, /defaultFistSystem\(\)\s*\{/, 'defaultFistSystem 이 없다');

  // 변경 직전 스냅샷이 복원의 유일한 근거다. 이것이 사라지면 복원은 다시 리터럴로 돌아간다.
  assert.match(ext, /fistOriginal/, '맨손 원본 스냅샷 플래그가 없다');
  assert.match(ext, /snapshotFistItem\(fistItem\)\s*\{[\s\S]*?getFlag\('dx3rd-emanim', 'fistOriginal'\)\)\s*return/,
    '스냅샷이 기존 값을 덮어쓰면 《파괴의 손톱》 뒤에 《백열》을 쓸 때 원본이 사라진다');

  // 변경하는 필드와 되돌리는 필드는 같은 목록이어야 한다 — 갈리면 「변경은 됐는데 복원이
  // 안 되는 필드」가 조용히 생긴다.
  const fields = ext.match(/FIST_MUTABLE_FIELDS: \[([^\]]+)\]/)?.[1];
  assert.ok(fields, 'FIST_MUTABLE_FIELDS 를 찾지 못했다');
  const declared = fields.split(',').map(s => s.trim().replace(/^'|'$/g, ''));
  const defaults = ext.match(/defaultFistSystem\(\)\s*\{\s*return \{([\s\S]*?)\};/)?.[1] ?? '';
  for (const key of declared) {
    assert.ok(defaults.includes(`${key}:`), `defaultFistSystem 에 ${key} 가 없다`);
  }

  // 복원 경로는 셋이 공유하는 하나뿐이다. 한 곳이라도 자기 리터럴로 되돌리면 그 진입점에서만
  // 스냅샷이 무시되어, 사용자에게는 「전투 종료로는 살아남는데 씬 초기화로는 날아간다」가 된다.
  for (const path of ['scripts/combat/combat.js', 'scripts/ui/scene-controls.js']) {
    const text = source(path);
    assert.match(text, /restoreFistItems\(actor\)/, `${path} 가 공용 복원 경로를 부르지 않는다`);
    assert.doesNotMatch(text, /['"]system\.attack['"]:\s*['"]-5['"]/,
      `${path} 에 맨손 리터럴 리셋이 되살아났다`);
  }

  // 영구 변경(《사이버 암》)은 「복원하지 않음」을 **스냅샷을 남기지 않음**으로 표현한다.
  // 두 생성 가지가 모두 이 플래그를 봐야 한다 — 한쪽만 보면 맨손이 있느냐 없느냐에 따라
  // 같은 이펙트가 영구가 됐다 안 됐다 한다.
  assert.match(ext, /if \(!permanent\) await this\.snapshotFistItem\(fistItem\)/,
    '영구 변경이 스냅샷을 남기면 전투 종료마다 되돌아간다');
  assert.match(ext, /flags: permanent \? \{\} :/,
    '맨손을 새로 만드는 가지도 영구 변경이면 스냅샷을 두지 않아야 한다');

  // 저작 경로가 없으면 이 플래그는 영영 꺼진 채다(맨손 한정 `fist` 라벨이 그랬다).
  const dialog = source('scripts/dialog/item-extend-dialog.js');
  assert.match(dialog, /fistPermanent: this\._checked\('input\[name="weaponFistPermanent"\]', root\)/,
    '확장 도구가 영구 변경 값을 수집하지 않는다');
  assert.match(dialog, /fistAdditive: this\._checked\('input\[name="weaponFistAdditive"\]', root\)/,
    '확장 도구가 가산형 맨손 변경 값을 수집하지 않는다');
  assert.match(dialog, /fistStackable: this\._checked\('input\[name="weaponFistStackable"\]', root\)/,
    '확장 도구가 동일 가산 효과의 중첩 허용 값을 수집하지 않는다');
  assert.match(source('templates/dialog/item-extend-dialog.html'), /name="weaponFistPermanent"/,
    '확장 도구 무기 탭에 영구 변경 입력이 없다');
  assert.match(source('templates/dialog/item-extend-dialog.html'), /name="weaponFistAdditive"/,
    '확장 도구 무기 탭에 가산형 맨손 변경 입력이 없다');
  assert.match(source('templates/dialog/item-extend-dialog.html'), /name="weaponFistStackable"/,
    '확장 도구 무기 탭에 동일 효과 중첩 입력이 없다');
  // 맨손 체크가 꺼지면 뜻이 없는 값이므로 저작이 남지 않아야 한다.
  assert.match(dialog, /if \(permanentField && \(!isFistMode \|\| additive\)\) permanentField\.checked = false/,
    '맨손 모드가 꺼질 때 영구 변경 저작이 남으면 안 된다');

  const ko = JSON.parse(source('lang/ko.json'));
  for (const key of ['DX3rd.FistPermanent', 'DX3rd.FistPermanentHint', 'DX3rd.FistAdditive', 'DX3rd.FistAdditiveHint',
    'DX3rd.FistStackable', 'DX3rd.FistStackableHint']) {
    assert.ok(key in ko, `${key} 가 ko.json 에 없다`);
  }
});

test('additive fist changes survive replacement layers and only their numeric contribution stacks', () => {
  const context = baseContext({
    game: { i18n: { localize: key => key }, user: { id: 'u1' } },
    Hooks: { on: () => {}, once: () => {} },
    CONST: { ACTIVE_EFFECT_SHOW_ICON: { ALWAYS: 2 } }
  });
  context.DX3rdUniversalHandler = {};
  load(context, 'scripts/handlers/universal-extensions.js');
  const handler = context.DX3rdUniversalHandler;

  const original = {
    name: '맨손', type: 'melee', skill: 'melee', add: '+0', attack: '-5', guard: '0', range: '지근'
  };
  const replace9 = {
    kind: 'fist', mode: 'replace', order: 1,
    applied: { name: '파괴의 손톱[맨손]', type: 'melee', skill: 'melee', add: '+0', attack: '+9', guard: '+1', range: '지근' }
  };
  const add4 = { kind: 'fist', mode: 'additive', order: 2, applied: { add: '+1', attack: '+4', guard: '+3' } };
  const replace12 = {
    kind: 'fist', mode: 'replace', order: 3,
    applied: { name: '백열[맨손]', type: 'melee', skill: 'melee', add: '-1', attack: '+12', guard: '0', range: '지근' }
  };
  const add2 = { kind: 'fist', mode: 'additive', order: 4, applied: { add: '0', attack: '+2', guard: '+1' } };

  const beforeReplacement = handler.composeFistData(original, [add4]);
  assert.equal(beforeReplacement.attack, '-1', '가산형만 있으면 기본 맨손 -5에 더해야 한다');
  assert.equal(beforeReplacement.name, '맨손', '가산형은 맨손 이름을 덮어쓰지 않는다');

  const afterReplacement = handler.composeFistData(original, [add4, replace9]);
  assert.equal(afterReplacement.attack, '+13', '나중 대체가 먼저 걸린 가산분을 지우면 안 된다');
  assert.equal(afterReplacement.guard, '+4');
  assert.equal(afterReplacement.name, '파괴의 손톱[맨손]');

  const fullStack = handler.composeFistData(original, [replace9, add4, replace12, add2]);
  assert.equal(fullStack.attack, '+18', '대체끼리는 최신 하나만 남고 가산형끼리는 전부 합산해야 한다');
  assert.equal(fullStack.add, '0', '명중 수정치도 최신 대체값에 가산해야 한다');
  assert.equal(fullStack.guard, '+4');
  assert.equal(fullStack.name, '백열[맨손]', '가산형이 최신이어도 대체층의 이름을 유지해야 한다');

  const withoutLatestReplacement = handler.composeFistData(original, [replace9, add4, add2]);
  assert.equal(withoutLatestReplacement.attack, '+15', '최신 대체를 제거하면 이전 대체와 가산층을 재조합해야 한다');

  const legacyReplacement = handler.composeFistData(original, [{ ...replace9, mode: undefined }, add4]);
  assert.equal(legacyReplacement.attack, '+13', '모드가 없는 기존 표식은 대체형으로 호환해야 한다');
});

test('a combo awaits each fist change and keeps an earlier additive member over a later replacement', async () => {
  const context = baseContext({
    game: {
      i18n: { localize: key => key === 'DX3rd.Fist' ? '맨손' : key, format: key => key },
      user: { id: 'u1', targets: new Set() }, actors: new Map()
    },
    ui: { notifications: { warn: () => {}, error: () => {}, info: () => {} } },
    Hooks: { on: () => {}, once: () => {} },
    CONST: { ACTIVE_EFFECT_SHOW_ICON: { ALWAYS: 2 } },
    CONFIG: { statusEffects: [] }
  });
  context.DX3rdUniversalHandler = {};
  context.DX3rdFormulaEvaluator = {
    getItemLevel: () => 1,
    evaluate: formula => Number(String(formula).replace('+', '')) || 0
  };
  load(context, 'scripts/core/runtime-utils.js');
  load(context, 'scripts/handlers/universal-extensions.js');
  load(context, 'scripts/handlers/combo-handler.js');
  const handler = context.DX3rdUniversalHandler;
  handler.executeMacros = async () => {};
  handler.applyToTargets = async () => {};

  const flags = {};
  const fist = {
    id: 'fist', name: '맨손', type: 'weapon',
    system: { type: 'melee', skill: 'melee', add: '+0', attack: '-5', guard: '0', range: '지근' },
    getFlag(scope, key) { return flags[scope]?.[key]; },
    async setFlag(scope, key, value) { (flags[scope] ??= {})[key] = structuredClone(value); },
    async unsetFlag(scope, key) { delete flags[scope]?.[key]; },
    async update(changes) {
      for (const [path, value] of Object.entries(changes)) {
        if (path === 'name') this.name = value;
        else if (path.startsWith('system.')) this.system[path.slice(7)] = value;
      }
    }
  };
  const extensionItem = (id, weapon) => ({
    id, name: id, type: 'effect', img: '',
    system: { active: { runTiming: 'instant' }, used: { disable: 'notCheck' } },
    getFlag: (_scope, key) => key === 'itemExtend' ? { weapon: { activate: true, fist: true, ...weapon } } : undefined
  });
  const additive = extensionItem('가산', {
    fistAdditive: true, add: '+1', attack: '+4', guard: '+3', type: 'melee', skill: 'melee', range: '지근'
  });
  const replacement = extensionItem('대체', {
    name: '파괴의 손톱', add: '+0', attack: '+9', guard: '+1', type: 'melee', skill: 'melee', range: '지근'
  });
  const combo = {
    id: 'combo', name: '맨손 조합', type: 'combo',
    // A duplicate member id is deliberately included: the same additive source refreshes by default rather than
    // silently doubling its scene-long modifier.
    system: { effectIds: [additive.id, additive.id, replacement.id], weapon: [], attackRoll: '-', active: {} },
    getFlag: (_scope, key) => key === 'itemExtend' ? {} : undefined
  };
  const items = new Map([[fist.id, fist], [additive.id, additive], [replacement.id, replacement], [combo.id, combo]]);
  items.find = predicate => [...items.values()].find(predicate);
  items.filter = predicate => [...items.values()].filter(predicate);
  const effects = [];
  const actor = {
    id: 'actor', name: 'actor', type: 'character', uuid: 'Actor.actor', items, effects,
    async updateEmbeddedDocuments() {},
    async createEmbeddedDocuments(type, documents) {
      assert.equal(type, 'ActiveEffect');
      return documents.map(data => {
        const effect = {
          ...data, id: `ae${effects.length + 1}`, flags: structuredClone(data.flags || {}),
          getFlag(scope, key) { return this.flags[scope]?.[key]; },
          async setFlag(scope, key, value) { (this.flags[scope] ??= {})[key] = structuredClone(value); },
          async unsetFlag(scope, key) { delete this.flags[scope]?.[key]; }
        };
        effects.push(effect);
        return effect;
      });
    }
  };
  context.game.actors.set(actor.id, actor);

  await context.DX3rdComboHandler.processInstantExtensions(actor, combo, 'attack');
  assert.equal(fist.name, '파괴의 손톱[맨손]', '콤보의 나중 대체형이 맨손 데이터의 주인이 된다');
  assert.equal(fist.system.attack, '+13', '앞서 실행된 가산형이 나중 대체형에 지워지면 안 된다');
  assert.equal(fist.system.add, '+1');
  assert.equal(fist.system.guard, '+4');
  assert.equal(effects.length, 2, '서로 다른 소스마다 표식이 생기되 같은 가산 소스의 중복 등록은 갱신해야 한다');

  const replacementEffect = effects.find(effect => handler.grantPayload(effect)?.sourceItemId === replacement.id);
  await handler.revertItemGrant(actor, replacementEffect);
  assert.equal(fist.system.attack, '-1', '대체형을 제거하면 기본 맨손과 남은 가산형을 다시 조립해야 한다');
});

test('an equipment grant is undone by deleting its marker, never by disabling it', () => {
  const ext = source('scripts/handlers/universal-extensions.js');

  // 되돌리는 것은 삭제뿐이다. disabled 에 반응하면 「잠깐 꺼 두기」가 곧 파괴가 되어,
  // 껐다 켜도 생성물이 돌아오지 않는다. 코어가 disabled AE 를 appliedEffects 에서 빼므로
  // 토큰 오버레이 아이콘은 그것만으로 사라진다.
  assert.match(ext, /Hooks\.on\('deleteActiveEffect'/, '표식 삭제 훅이 없다');
  assert.doesNotMatch(ext, /Hooks\.on\('updateActiveEffect'/,
    'updateActiveEffect 훅을 달면 비활성화가 파괴가 된다');

  // 맨손 표식은 여러 개 쌓일 수 있다(「이미 있어도 중복 가능」한 이펙트). 하나가 사라지면
  // 남은 것 중 최신 상태로 다시 맞추고, 전부 사라졌을 때만 스택의 바닥으로 되돌린다.
  assert.match(ext, /const remaining = this\.fistGrantEffects\(actor, effect\.id\)/,
    '삭제된 표식을 뺀 나머지로 재계산해야 중간 것을 지워도 일관된다');
  assert.match(ext, /await this\.realignFistItem\(actor, fistItem, effect\.id\)/,
    '남은 표식이 있으면 최신 대체와 모든 가산형을 다시 조립해야 한다');
  assert.match(ext, /await this\.restoreFistItems\(actor\)/,
    '표식이 전부 사라지면 최초 원본으로 되돌아가야 한다');

  // 영구 변경에는 표식을 붙이지 않는다 — 되돌릴 스냅샷이 없으므로 지울 수 있는 표식을
  // 두면 「지웠는데 아무 일도 안 일어나는」 거짓말이 된다.
  const grantCalls = ext.match(/await this\.createOrRefreshFistGrant\(/g) ?? [];
  assert.equal(grantCalls.length, 2,
    '맨손을 고치는 가지와 새로 만드는 가지 둘 다 영구 변경을 걸러야 한다');

  // 정리 로직이 두 벌이 되면 반드시 갈린다. 전투 종료·씬 초기화는 표식을 지우기만 한다.
  for (const path of ['scripts/combat/combat.js', 'scripts/ui/scene-controls.js']) {
    assert.match(source(path), /clearItemGrants\(actor\)/,
      `${path} 가 표식을 지우지 않으면 유령 표식이 남는다`);
  }

  // 컨디션 동기화 훅이 표식의 합성 status 를 상태이상으로 오인하면 안 된다.
  assert.match(source('scripts/condtions.js'),
    /if \(effect\.getFlag\?\.\('dx3rd-emanim', 'itemGrant'\)\) return;/,
    '컨디션 훅이 장비 변경 표식을 걸러내지 않는다');

  const ko = JSON.parse(source('lang/ko.json'));
  for (const key of ['DX3rd.GrantFistDescription', 'DX3rd.GrantWeaponDescription']) {
    assert.ok(key in ko, `${key} 가 ko.json 에 없다`);
  }
});

/**
 * 오버레이 다이얼로그가 쓰는 DOM 표면만 흉내 내는 최소 스텁.
 * 하네스에 jsdom 이 없으므로, 실물 스크립트를 그대로 싣기 위해 필요한 만큼만 만든다.
 */
function overlayDomStub() {
  const byId = new Map();
  const createElement = tag => {
    const el = {
      tagName: tag,
      id: '',
      className: '',
      innerHTML: '',
      textContent: '',
      style: {},
      children: [],
      parent: null,
      listeners: {},
      classList: {
        add(name) { el.className = `${el.className} ${name}`.trim(); },
        contains(name) { return el.className.split(/\s+/).includes(name); }
      },
      setAttribute() {},
      appendChild(child) {
        child.parent = el;
        el.children.push(child);
        if (child.id) byId.set(child.id, child);
        return child;
      },
      addEventListener(type, fn) { (el.listeners[type] ||= []).push(fn); },
      removeEventListener() {},
      remove() {
        if (el.id) byId.delete(el.id);
        if (el.parent) el.parent.children = el.parent.children.filter(c => c !== el);
        el.parent = null;
      },
      click() { for (const fn of el.listeners.click || []) fn({}); },
      querySelector() { return null; },
      querySelectorAll() { return []; }
    };
    return el;
  };
  const body = createElement('body');
  return {
    body,
    document: {
      createElement,
      body,
      getElementById: id => byId.get(id) ?? null,
      addEventListener() {},
      removeEventListener() {}
    }
  };
}

function overlayApi() {
  const { document, body } = overlayDomStub();
  const context = baseContext({ document, foundry: { utils: { escapeHTML: String } } });
  load(context, 'scripts/dialog/overlay-dialog.js');
  const descendants = el => el.children.flatMap(c => [c, ...descendants(c)]);
  const find = cls => descendants(body).filter(e => e.classList.contains(cls));
  return { api: context.window.DX3rdOverlayDialog, body, find, descendants };
}

test('an overlay dialog resolves its button value, and null for every dismissal', async () => {
  const { api, find } = overlayApi();

  const chosen = api.wait({ id: 'a', title: 't', buttons: [{ label: '백병', value: 'melee' }] });
  find('dx3rd-overlay-dialog__button').find(b => b.textContent === '백병').click();
  assert.equal(await chosen, 'melee', 'a button carries its value out');

  const dismissed = api.wait({ id: 'a', title: 't', buttons: [{ label: '사격', value: 'ranged' }] });
  find('dx3rd-overlay-dialog__close')[0].click();
  assert.equal(await dismissed, null,
    'the close button resolves null — callers treat that as "no choice", and unlike DialogV2 '
    + 'no button action string is substituted in, so a cancellation cannot pose as a value');

  // A callback returning nothing folds into the same "dismissed" signal.
  const empty = api.wait({ id: 'a', title: 't', buttons: [{ label: 'x', callback: () => undefined }] });
  find('dx3rd-overlay-dialog__button')[0].click();
  assert.equal(await empty, null);
});

test('a displaced overlay resolves instead of stranding whatever awaited it', async () => {
  const { api, find } = overlayApi();

  // The condition prompt reuses one id for hatred, fear and berserk. Replacing an overlay
  // by dropping only its DOM node would leave the first await hanging forever, stalling the
  // whole condition-apply path; the replacement must resolve it as a dismissal.
  const first = api.wait({ id: 'dx3rd-condition-choice', title: 'hatred', buttons: [{ label: 'A', value: 'a' }] });
  const second = api.wait({ id: 'dx3rd-condition-choice', title: 'fear', buttons: [{ label: 'B', value: 'b' }] });

  assert.equal(await first, null, 'the displaced overlay resolves rather than hanging');

  const live = find('dx3rd-overlay-dialog__button');
  assert.equal(live.length, 1, 'only the replacement is still on screen');
  live[0].click();
  assert.equal(await second, 'b', 'the replacement still resolves normally');
});

test('the condition prompt asks through the overlay, never through a DialogV2 cancel workaround', () => {
  const conditions = source('scripts/handlers/universal-condition-apply.js');

  assert.match(conditions, /_promptConditionChoice = async function/,
    'the three special-condition prompts share one helper');
  assert.equal((conditions.match(/_promptConditionChoice\(\{/g) || []).length, 3,
    'hatred, fear and berserk all go through it');
  // Scoped to real usage, not the word: the helper's own comment explains why DialogV2 is avoided.
  assert.doesNotMatch(conditions, /DialogV2\s*\??\.\s*(wait|prompt|confirm)/,
    'no DialogV2 call is left here; its cancel callback substitutes the button action string '
    + 'for nullish, which is exactly the trap these prompts had to work around');
  assert.doesNotMatch(conditions, /callback: \(\) => false/,
    'and the workaround that trap forced is gone with it');
});

function defenceAdapter() {
  const context = baseContext({
    foundry: { utils: { deepClone: structuredClone, mergeObject: Object.assign } },
    game: { i18n: { localize: k => k }, settings: { get: () => undefined } },
    Hooks: { on() {}, once() {} },
    ui: { notifications: { warn() {}, error() {}, info() {} } }
  });
  load(context, 'scripts/item-effect-adapter.js');
  return context.window.DX3rdItemEffectAdapter;
}

test('a bypassed defence is only given back by the counter the rules print for it', () => {
  const adapter = defenceAdapter();
  const none = adapter.resolveDefense({}, {});
  assert.deepEqual(
    { a: none.armorIgnored, g: none.guardBlocked, r: none.reactionBlocked },
    { a: false, g: false, r: false },
    'an ordinary attack bypasses nothing, so the dialog is untouched');

  // 《이지스 링》 answers armor and only armor.
  assert.equal(adapter.resolveDefense({ armor: true }, {}).armorIgnored, true);
  assert.equal(adapter.resolveDefense({ armor: true }, { armor: true }).armorIgnored, false);
  assert.equal(adapter.resolveDefense({ armor: true }, { guard: true }).armorIgnored, true,
    'the guard counter must not double as an armor counter');

  // 《마그넷 체인》《비호하는 짐승》《에너지 실드》: "「리액션을 실행할 수 없다」거나 「가드를 실행할
  // 수 없다」는 효과를 가진 공격에 대해서도 가드를 실행할 수 있다".
  assert.equal(adapter.resolveDefense({ guard: true }, {}).guardBlocked, true);
  assert.equal(adapter.resolveDefense({ guard: true }, { guard: true }).guardBlocked, false);

  const viaReaction = adapter.resolveDefense({ reaction: true }, { guard: true });
  assert.equal(viaReaction.guardRestored, true,
    'a bypassed reaction also opens the guard — the counter names both cases');
  assert.equal(viaReaction.reactionBlocked, true,
    'but the guard counter does not hand the reaction back; it grants a guard');

  // 《전지의 파편》 is the card that does: "…공격에 대해서도 닷지를 실행할 수 있다".
  assert.equal(adapter.resolveDefense({ reaction: true }, { reaction: true }).reactionBlocked, false);
  assert.equal(adapter.resolveDefense({ guard: true }, { reaction: true }).guardBlocked, true,
    'and the reaction counter is not a guard counter either — the two cards are not interchangeable');
});

test('a total armor bypass outranks numeric penetration instead of stacking with it', () => {
  const damage = source('scripts/handlers/universal-damage-dialog.js');
  assert.match(damage, /armorIgnored \? 0 : Math\.max\(0, armorValue - penetrate\)/,
    '"장갑치를 무시" and "장갑치를 [LVx8]만큼 무시" are different rules; combining them could only '
    + 'produce a negative armor, and the boolean is the all-or-nothing one');
  assert.match(damage, /const effectiveGuard = \(guardChecked && !guardBlocked\)/,
    'a blocked guard is not merely unchecked — it is removed from the calculation');
  // enforcedDefense, not the raw resolution: the gate below can drop the block, and a guard that
  // counts must have been rolled.
  assert.match(damage, /rollDeferred\(\(guardChecked && !enforcedDefense\.guardBlocked\)/,
    'and its dice are not rolled at all, or chat would show a guard roll that was never subtracted');
});

test('a bypassed defence is locked by the same switch as every other usage gate', () => {
  // 다른 게이트와 같은 축이다 — 「가드를 실행할 수 없다」는 판정은 그대로 하고, 그것을
  // 차단으로 이을지만 설정이 정한다. 기본은 막지 않음이므로 칸은 잠긴 것처럼 보이되 살아 있다.
  const damage = source('scripts/handlers/universal-damage-dialog.js');
  assert.match(damage, /const bypassBlocks = \(\) => window\.DX3rdUsageGates\?\.allows\?\.\('defenseBypass'\) === false/,
    '방어 무시의 차단 여부는 공용 설정 판독기 한 곳에서 읽어야 한다');

  // 잠금은 표시일 뿐이고, 계산에서 빠지는지는 enforceBypass 한 곳이 정한다. 두 곳으로 갈리면
  // 「입력은 살아 있는데 값이 안 먹는다」가 조용히 난다.
  assert.match(damage, /const enforceBypass = \(defense\) => bypassBlocks\(\)\s*\?\s*defense\s*:\s*\{ \.\.\.defense, guardBlocked: false, reactionBlocked: false \}/,
    '허용 설정에서 풀리는 것은 방어측이 선언하는 두 축뿐이다');
  // 장갑은 선언하는 것이 아니라 시트에 이미 적힌 숫자다. 그것까지 풀면 선택을 돌려주는 것이 아니라
  // 「장갑치를 무시한다」가 기본값에서 조용히 죽고, 맞을 때마다 채팅 경고가 한 줄씩 쌓인다.
  assert.doesNotMatch(damage, /\{ \.\.\.defense,[^}]*armorIgnored: false/,
    '장갑 무시는 설정과 무관하게 계산에서 유지돼야 한다');
  assert.match(damage, /\['#armor', armorIgnored, 'DX3rd\.BypassLockArmor', false\]/,
    '장갑 칸은 소프트 잠금 대상이 아니다 — 다만 왜 안 빠지는지는 툴팁이 말한다');
  assert.match(damage, /\.\.\.enforceBypass\(previewDefense\(\)\)/,
    '표시용 계산도 같은 경계를 지나야 한다 — 창의 숫자와 확정값이 갈리면 안 된다');
  assert.match(damage, /el\.disabled = base\.disabled \|\| \(blocked && !lenient\);/,
    '허용 상태에서 입력을 실제로 비활성화하면 설정이 무력해진다');
  assert.match(damage, /classList\.toggle\('dx3rd-soft-locked', blocked && lenient\)/,
    '대신 잠긴 것처럼 보이게만 한다');
  // 잠금을 풀 때 원래 상태로 돌려놔야 한다. 무기 가드 픽커는 무기가 없으면 템플릿이 이미
  // 비활성화해 두고, 「+」 버튼은 제 툴팁을 갖고 있다 — 맹목적으로 되살리면 둘 다 망가진다.
  assert.match(damage, /lockBaseline\.set\(selector, \{ disabled: el\.disabled === true, title: el\.getAttribute\('title'\) \}\)/,
    '잠그기 전 상태를 기억해야 한다');
  assert.match(damage, /if \(base\.title === null\) el\.removeAttribute\('title'\);/,
    '원래 툴팁이 없던 칸만 지우고, 있던 칸은 되돌려야 한다');
  assert.match(damage, /DX3rd\.BypassLockGuard/,
    '왜 잠겨 보이는지는 툴팁이 말해야 한다');

  // 막지 않을 때도 경고와 채팅 기록은 남는다 — 다른 게이트와 같은 공용 보고 경로다.
  assert.match(damage.replace(/\s+/g, ' '),
    /reportUsageGate\?\.\( targetActor, \{ name: game\.i18n\.localize\(labelKey\) \}, 'defenseBypass'/,
    '무시되는 방어를 강행했으면 공용 보고 경로로 남겨야 한다');
  // 렌더 시점의 잠금은 한 번뿐이므로, 확정 시점에 다시 보지 않으면 창을 열어 둔 사이 설정이
  // 바뀌거나 무효화가 체크된 것이 계산에 닿지 않는다([폭주] 가드와 같은 함정이다).
  assert.match(damage, /const enforcedDefense = enforceBypass\(defense\);/,
    '확정 시점에 게이트를 다시 봐야 한다');
  assert.match(damage, /armorIgnored: enforcedDefense\.armorIgnored/,
    '그 결과가 실제 데미지 계산에 반영돼야 한다');
});

test('a defence counter is only honoured once its own cost has actually been paid', () => {
  const damage = source('scripts/handlers/universal-damage-dialog.js');
  assert.match(damage, /processItemUsageCost\(targetActor, restoreItem\)/,
    '《마그넷 체인》 is once per scenario; ticking it must spend the use');
  assert.match(damage, /if \(paid === false\) continue;/,
    'and a counter whose cost was refused must not give the defence back anyway');
  // The attacker's client resolves the union, because the defender cannot see the attacker's
  // combo members or registered weapons.
  assert.match(damage, /const bypassDefense = window\.DX3rdItemEffectAdapter\.attackBypassDefense\(actor, item\)/);
});

test('modifier rows with a condition contribute only while the status holds on the carrier', () => {
  class ActorMock {
    prepareData() {}
    async _preUpdate() {}
    importFromJSON() {}
  }
  const context = baseContext({
    foundry: { documents: { Actor: ActorMock }, utils: {} },
    Actor: ActorMock,
    CONFIG: { Actor: {} },
    game: { settings: { get: () => '-' }, i18n: { localize: k => k, format: k => k } },
    ui: { notifications: { warn: () => {} } },
    Hooks: { once: () => {}, on: () => {} }
  });
  load(context, 'scripts/core/runtime-utils.js');
  load(context, 'scripts/item-effect-adapter.js');
  load(context, 'scripts/document/actor.js');
  // evaluate() 만 있으면 되는 실측 단위 — 수식 평가 자체는 별도 테스트가 덮는다.
  context.DX3rdFormulaEvaluator = {
    evaluate: v => Number(v) || 0,
    isRollTimeKey: () => false,
    hasDice: () => false,
    prepareRollFormula: s => s
  };
  const proto = context.CONFIG.Actor.documentClass.prototype;
  const actor = Object.create(proto);
  actor.system = { conditions: { berserk: { active: false }, poisoned: { active: false } } };

  const holds = context.DX3rdRuntimeUtils.modifierConditionHolds;
  assert.equal(holds(actor, null), true, '조건 없는 행은 항상 적용된다');
  assert.equal(holds(actor, '-'), true);
  assert.equal(holds(actor, 'berserk'), false, '[폭주] 미보유');
  assert.equal(holds(actor, 'badStatus'), false, 'BS 미보유');
  actor.system.conditions.poisoned.active = true;
  assert.equal(holds(actor, 'badStatus'), true, '어느 BS든 하나면 badStatus 는 참이다');
  assert.equal(holds(actor, 'berserk'), false, '다른 상태로는 berserk 조건이 서지 않는다');
  actor.system.conditions.berserk.active = true;
  assert.equal(holds(actor, 'berserk'), true);

  // 활성 아이템 채널(토글 중 읽히는 행)
  const item = {
    id: 'fx', name: '렉클리스 포스', type: 'effect',
    system: { attributes: { r: { key: 'major_dice', label: 'major_dice', value: '2', condition: 'berserk' } } }
  };
  const unconditional = {
    id: 'fx2', name: '무조건', type: 'effect',
    system: { attributes: { r: { key: 'major_dice', label: 'major_dice', value: '1' } } }
  };
  actor.system.conditions.berserk.active = false;
  actor.system.conditions.poisoned.active = false;
  let reader = actor._makeContribReader([item, unconditional], {});
  assert.equal(reader.sum('major_dice'), 1, '폭주가 아니면 조건 행만 빠진다');
  actor.system.conditions.berserk.active = true;
  reader = actor._makeContribReader([item, unconditional], {});
  assert.equal(reader.sum('major_dice'), 3, '폭주 중에는 조건 행이 합산된다');

  // 적용된 이펙트 채널(AE 에 동결돼 실린 행) — badStatus 는 받는 액터 기준으로 판정된다.
  const applied = {
    eff1: { attributes: { a: { key: 'attack', label: '-', value: 3, condition: 'badStatus' },
                          b: { key: 'attack', label: '-', value: 1 } } }
  };
  actor.system.conditions.berserk.active = false;
  actor.system.conditions.poisoned.active = false;
  let idx = actor._indexAppliedEffects(applied);
  assert.equal((idx.attack || []).reduce((s, e) => s + Number(e.val), 0), 1,
    'BS 가 없으면 badStatus 행은 적용 목록에서 빠진다');
  actor.system.conditions.dazed = { active: true };
  idx = actor._indexAppliedEffects(applied);
  assert.equal((idx.attack || []).reduce((s, e) => s + Number(e.val), 0), 4,
    'BS(dazed)가 생기면 badStatus 행이 합산된다');
});

test('modifier row conditions survive the applied-effect serialization paths', () => {
  const apply = source('scripts/handlers/universal-apply.js');
  const occurrences = apply.match(/\.\.\.\(attrData\.condition \? \{ condition: attrData\.condition \} : \{\}\)/g) || [];
  assert.equal(occurrences.length, 2,
    '대상 적용(_applyItemAttributes)과 이펙트 데이터 적용(_applyEffectDataToActor) 둘 다 condition 을 실어야 한다');
  const toggle = source('scripts/dx3rd-applied-toggle.js');
  assert.match(toggle, /\.\.\.\(a\.condition \? \{ condition: a\.condition \} : \{\}\)/,
    '토글 동결 경로도 condition 을 보존해야 한다 — 여기서 평가하면 받는 시점의 상태로 굳는다');
  const attrRow = source('_source/apply-overrides.mjs');
  assert.match(attrRow, /if \(a\.condition\) row\.condition = a\.condition;/,
    'attrRow 가 condition 을 버리면 _source 오버라이드의 저작이 팩까지 도달하지 않는다');
});

test('a stackable bucket adds a new applied AE per application instead of overwriting', async () => {
  const { context, handler, writes } = applyHandlerContext();
  // 실물 어댑터를 싣는다 — bucketLifecycle 의 stack 판독이 런타임 그대로 동작해야 한다.
  context.Hooks = { once: () => {}, on: () => {} };
  load(context, 'scripts/item-effect-adapter.js');
  let seq = 0;
  context.foundry.utils.randomID = () => `inst${++seq}`;
  // set 은 실물과 같은 업서트 — 같은 appliedKey 의 AE 가 있으면 그 문서를 갱신한다.
  context.DX3rdAppliedEffects.set = (actor, key, payload) => {
    let eff = actor.effects.find(e => e.getFlag('dx3rd-emanim', 'appliedKey') === key);
    if (!eff) { eff = { getFlag: (_s, f) => (f === 'appliedKey' ? key : payload) }; actor.effects.push(eff); }
    else eff.getFlag = (_s, f) => (f === 'appliedKey' ? key : payload);
    writes.push({ actor, key, payload });
    return eff;
  };

  const caster = { id: 'a1', name: '시전자' };
  const stackable = {
    id: 'i1', name: '중력의 수갑', type: 'effect',
    system: {
      effect: {
        disable: 'scene', runTiming: 'afterHit', stack: true,
        attributes: { a0: { key: 'dice', label: 'dice', value: '-2' } }
      }
    }
  };
  const target = { id: 't1', name: '대상', effects: [] };

  await handler._applyItemAttributes(caster, stackable, target, stackable.system.effect.attributes);
  await handler._applyItemAttributes(caster, stackable, target, stackable.system.effect.attributes);

  assert.equal(writes.length, 2);
  assert.notEqual(writes[0].key, writes[1].key, '스택 버킷은 적용마다 새 인스턴스 키를 받아야 한다');
  for (const w of writes) assert.match(w.key, /^applied_i1_inst\d+$/);
  assert.equal(writes[0].payload.attributes['dice:dice'].value, -2);
  assert.equal(writes[1].payload.attributes['dice:dice'].value, -2, '각 스택은 한 번분만 얹는다 — 합산은 기여 색인이 한다');
  assert.equal(target.effects.length, 2, '두 번 명중하면 두 개의 AE 가 남아야 한다');

  // 대조군: stack 이 없으면 같은 버킷의 기존 AE 키를 찾아 덮어쓴다(기존 동작 그대로).
  const plainItem = {
    id: 'i2', name: '일반 버킷', type: 'effect',
    system: { effect: { disable: 'scene', runTiming: 'afterHit',
      attributes: { a0: { key: 'dice', label: 'dice', value: '-1' } } } }
  };
  const target2 = { id: 't2', name: '대상2', effects: [] };
  writes.length = 0;
  await handler._applyItemAttributes(caster, plainItem, target2, plainItem.system.effect.attributes);
  await handler._applyItemAttributes(caster, plainItem, target2, plainItem.system.effect.attributes);
  assert.equal(writes.length, 2);
  assert.equal(writes[0].key, 'applied_i2');
  assert.equal(writes[1].key, 'applied_i2', '비스택 버킷은 두 번째 적용이 첫 AE 를 갱신해야 한다');
  assert.equal(target2.effects.length, 1);
});

test('a stackable bucket with nothing to apply does not erase earlier stacks', async () => {
  const { context, handler, writes } = applyHandlerContext();
  context.Hooks = { once: () => {}, on: () => {} };
  load(context, 'scripts/item-effect-adapter.js');
  let seq = 0;
  context.foundry.utils.randomID = () => `inst${++seq}`;
  context.DX3rdAppliedEffects.set = (actor, key, payload) => {
    const eff = { getFlag: (_s, f) => (f === 'appliedKey' ? key : payload) };
    actor.effects.push(eff);
    writes.push({ actor, key, payload });
    return eff;
  };
  const item = {
    id: 'i1', name: '중력의 수갑', type: 'effect',
    system: { effect: { disable: 'scene', runTiming: 'afterHit', stack: true,
      attributes: { a0: { key: 'dice', label: 'dice', value: '-2' } } } }
  };
  const target = { id: 't1', name: '대상', effects: [] };
  await handler._applyItemAttributes({ id: 'a1', name: '시전자' }, item, target, item.system.effect.attributes);
  assert.equal(target.effects.length, 1);

  // 빈 페이로드가 와도(적용할 보정이 하나도 없어도) 기존 스택을 지우면 안 된다.
  const before = writes.length;
  await handler._applyItemAttributes({ id: 'a1', name: '시전자' }, item, target, {});
  assert.equal(writes.length, before, '빈 적용은 아무것도 쓰거나 지우지 않아야 한다');
  assert.equal(target.effects.length, 1, '기존 스택이 남아 있어야 한다');
});
