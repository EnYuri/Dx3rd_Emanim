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
    game: { i18n: { localize: key => key } }
  });
  load(context, 'scripts/compendium-sync.js');
  const { resolveSource } = context.window.DX3rdCompendiumSync;

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
