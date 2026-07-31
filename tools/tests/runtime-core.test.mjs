import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';
import vm from 'node:vm';

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

test('created weapon amount evaluates the source effect level formula', async () => {
  const context = baseContext({
    game: { i18n: { localize: () => '(임시)' } }
  });
  context.DX3rdUniversalHandler = {};
  context.DX3rdFormulaEvaluator = {
    getItemLevel: () => 2,
    evaluate: formula => formula === '[level]+1' ? 3 : Number(formula) || 0
  };
  load(context, 'scripts/handlers/universal-extensions.js');

  const created = [];
  const actor = {
    createEmbeddedDocuments: async (_type, documents) => {
      created.push(...documents);
      return documents;
    }
  };
  const result = await context.DX3rdUniversalHandler.createWeaponItems(actor, {
    name: '일본도', type: 'melee', skill: 'melee', add: '-1', attack: '5', guard: '3', range: '지근', amount: '[level]+1'
  }, { type: 'effect', img: 'sword.svg', system: { level: { value: 2 } } });

  assert.equal(created.length, 3);
  assert.equal(result.length, 3);
  assert.equal(created[0].name, '일본도(임시)');
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
  const pattern = /(?:DX3rdSocketRouter|socketRouter)\.emit\(\{\s*type:\s*['"]([^'"]+)['"]/g;
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
  context.DX3rdSocketRouter = { emit: message => emitted.push(message) };
  load(context, 'scripts/handlers/universal-apply.js');
  return { context, handler: context.DX3rdUniversalHandler, writes, emitted };
}

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

test('every applySelfModifiers call site derives forceToggle from the adapter', () => {
  // 채널 판정을 호출부에서 다시 쓰거나 빠뜨리면, 같은 이펙트가 단독 사용과 콤보에서
  // 서로 다른 채널로 걸린다(콤보로 쓸 때만 active.state 가 꺼진 채 남았던 버그).
  const callers = walkJs(resolve(root, 'scripts'))
    .filter(path => !path.endsWith('universal-apply.js')) // 정의부
    .flatMap(path => {
      const text = readFileSync(path, 'utf8');
      return [...text.matchAll(/applySelfModifiers\((?<args>[^)]*)\)/g)]
        .map(match => ({ path, args: match.groups.args }));
    });

  assert.ok(callers.length >= 2, '호출부를 찾지 못했다 — 정규식이 낡았다');
  for (const caller of callers) {
    assert.match(caller.args, /forceToggle/, `${caller.path} 는 forceToggle 을 넘겨야 한다`);
  }
  for (const path of ['scripts/handlers/universal-handler.js', 'scripts/handlers/combo-handler.js']) {
    assert.match(readFileSync(resolve(root, path), 'utf8'), /useMeansActivation/,
      `${path} 는 어댑터의 단일 판정을 써야 한다`);
  }
});

test('a toggle-type item without an authored applyMode never takes the frozen channel', async () => {
  // spell/psionic/combo 는 template.json 에 applyMode 필드가 없어 기본값 'onUse'(동결)로
  // 떨어졌다. 그 뒤 active.state 가 켜지면 toggle:<id> AE 가 따로 생겨 같은 자기 보정이
  // 두 번 합산된다(actor.js 는 이 타입들을 자체계산에서 빼고 AE 만 본다).
  const cases = [
    { type: 'spell', active: { runTiming: 'instant', disable: 'scene' }, toggled: true },
    { type: 'psionic', active: { runTiming: 'instant', disable: 'scene' }, toggled: true },
    { type: 'combo', active: { runTiming: 'instant', disable: 'scene' }, toggled: true },
    // effect 는 스키마에 applyMode 가 있으므로 저작값을 그대로 따른다(동결 유지).
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
    ['scripts/handlers/universal-handler.js', /async activateItem[\s\S]{0,900}?\n    },/],
    ['scripts/handlers/universal-handler.js', /async ensureActivated[\s\S]{0,900}?\n    },/],
    // instant 발동점(단독 사용·콤보 멤버)은 게이트를 각자 쓰지 않고 어댑터 단일 기준에 위임한다.
    // notCheck 판정은 그 안에 있다(위 'the self-modifier gate is channel-aware' 가 검증).
    ['scripts/handlers/combo-handler.js', /memberPending[\s\S]{0,300}?runTiming === 'instant' && memberPending\)\s*\{/],
    ['scripts/handlers/universal-handler.js', /const selfPending[\s\S]{0,300}?selfPending && !skipToggle\)\s*\{/]
  ];
  for (const [path, pattern] of gates) {
    const text = readFileSync(resolve(root, path), 'utf8');
    const match = text.match(pattern);
    assert.ok(match, `${path} 에서 활성화 게이트를 찾지 못했다 — 정규식이 낡았다`);
    assert.match(match[0], /notCheck|selfModifiersPending/,
      `${path} 의 게이트가 notCheck 를 거르지 않는다(직접 검사도, 어댑터 위임도 아니다)`);
  }
  // ensureActivated 는 runTiming 게이트가 없어 afterSuccess 저작을 캐스팅 시점에 켰다.
  const handlerText = readFileSync(resolve(root, 'scripts/handlers/universal-handler.js'), 'utf8');
  const ensure = handlerText.match(/async ensureActivated[\s\S]{0,900}?\n    },/);
  assert.match(ensure[0], /runTiming === 'instant'/, 'ensureActivated 도 runTiming 을 봐야 한다');
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
  assert.equal(adapter.targetFiresAt(item, 'attack', 'instant'), false);
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
  const actor = { id: 'a1', name: '시전자', isOwner: true, effects: [] };
  const item = {
    id: 'i1', name: '이펙트', img: 'x.png', type: 'effect', actor, getFlag: () => ({}),
    system: {
      timing: 'major',
      attributes: {
        a0: { key: 'guard', value: '5' },                       // 미지정 → 채널 기본(사용)
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
  assert.ok(component.includes("handleItemUse( actor.id, item.id, item.type, undefined, false, {action: 'use', comboMode: 'normal'})"),
    '선언은 action:use 로 실제 사용 파이프라인을 타야 한다 — AE 만 직접 걸면 회수·침식이 새어 나간다');

  // 두 창 모두 굴림/확정 시점에 commit 해야 한다 — 토글만으로 소모되면 안 된다.
  assert.match(source('scripts/handlers/universal-roll-dialog.js'), /await commitDeclarations\(\);/,
    '판정 창은 굴림 버튼에서 확정해야 한다');
  assert.match(damageFile, /await declareControl\.commit\(\)/,
    '방어 창은 「확인」에서 확정해야 한다');

  // 공격만으로는 회수도 침식도 나가지 않아야 한다. 게이트 판정은 선언 UI 와 같은
  // 함수(isDeclarable)를 써야 "목록엔 뜨는데 이미 소모된" 어긋남이 생기지 않는다.
  const handler = source('scripts/handlers/universal-handler.js').replace(/\s+/g, ' ');
  assert.ok(handler.includes("const declarationOnly = action === 'attack' && !!window.DX3rdDeclaredEquipment?.isDeclarable?.(item);"),
    '선언형 장비의 공격은 비용·회수를 치르지 않아야 한다');
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
