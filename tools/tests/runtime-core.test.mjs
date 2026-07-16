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
    executeDamageExtensionNow: async () => { throw new Error('expected failure'); }
  };
  load(context, 'scripts/core/runtime-utils.js');
  load(context, 'scripts/socket-router.js');
  load(context, 'scripts/handlers/universal-after-main.js');

  await Promise.all([
    context.DX3rdUniversalHandler.addToAfterMainQueue(actor, { amount: 1 }, null, 'heal', { queueId: 'q1' }),
    context.DX3rdUniversalHandler.addToAfterMainQueue(actor, { amount: 2 }, null, 'damage', { queueId: 'q2' })
  ]);
  await context.DX3rdUniversalHandler.addToAfterMainQueue(actor, { amount: 99 }, null, 'heal', { queueId: 'q1' });
  assert.equal(store.afterMainQueue.length, 2);
  assert.equal('actor' in store.afterMainQueue[0], false);
  assert.equal('item' in store.afterMainQueue[0], false);

  const result = await context.DX3rdUniversalHandler.processAfterMainQueue();
  assert.deepEqual(JSON.parse(JSON.stringify(result)), { processed: 1, failed: 1 });
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
