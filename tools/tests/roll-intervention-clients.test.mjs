import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import test from 'node:test';
import vm from 'node:vm';

const root = resolve(import.meta.dirname, '..', '..');
const source = path => readFileSync(resolve(root, path), 'utf8');
const plain = value => JSON.parse(JSON.stringify(value));

// Separate browser realms, real contracts/router/intervention engine/DX term. Only
// Foundry documents, UI, transport and random faces are supplied by the fixture.
function clients({rollerUserId = 'roller', waves = [[8, 2, 2]], selected = [1],
  nextFaces = [4], spend, transport, itemConfig = {}, realUsage = false,
  commitTimeoutMs = 60000, postUseFailure = false, usageCostFailure = false,
  rollActorId = 'subject'} = {}) {
  const nodes = new Map();
  const sent = [];
  const spent = [];
  const errors = [];
  const notifications = [];
  function updateDocument(document, changes) {
    for (const [path, value] of Object.entries(changes)) {
      const keys = path.split('.');
      let target = document;
      for (const key of keys.slice(0, -1)) target = target[key] ??= {};
      target[keys.at(-1)] = value;
    }
  }
  for (const userId of ['roller', 'helper', 'gm']) {
    const once = [];
    const hooks = new Map();
    const faces = [...nextFaces];
    const users = ['roller', 'helper', 'gm'].map(id => ({
      id, isGM: id === 'gm', active: true, character: {id: id === 'helper' ? 'assistant' : 'subject'}
    }));
    users.get = id => users.find(user => user.id === id);
    users.activeGM = users.get('gm');
    const actor = (id, owner) => ({
      id, uuid: `Actor.${id}`, name: id, items: [],
      system: {attributes: {encroachment: {value: 50, level: 0}, hp: {value: 20}, skills: {}}, conditions: {}},
      getFlag: () => undefined,
      async update(changes) {
        updateDocument(this, changes);
        if (usageCostFailure && userId === 'helper' && id === 'assistant') {
          this.items.length = 0;
          throw new Error('cost update failed after persisting encroachment');
        }
      },
      testUserPermission: user => user.isGM || user.id === owner
    });
    const subject = actor('subject', 'roller');
    const assistant = actor('assistant', 'helper');
    assistant.items.push({id: 'fairy', name: '요정의 손', type: 'effect',
      getFlag: () => undefined,
      async update(changes) { updateDocument(this, changes); },
      system: {
      timing: 'auto', skill: '-', roll: '-', difficulty: '자동성공', target: '단독',
      getTarget: true, limit: '-', attributes: {}, resourceCost: {enabled: false},
      active: {state: false, disable: '-', runTiming: 'instant', action: '', applyMode: 'onUse'},
      effect: {disable: 'notCheck', runTiming: 'instant', action: '', attributes: {}},
      used: {state: 0, max: 3, level: false, disable: 'session'}, encroach: {value: '4'},
      rollIntervention: {enabled: true, phase: 'afterRoll', kinds: ['check'],
        operation: 'setFaces', value: '10', target: 'any', selection: 'one', count: '1',
        perRollMax: 1, ...itemConfig}
    }});
    const actors = [subject, assistant];
    for (const actor of actors) actor.items.get = id => actor.items.find(item => item.id === id);
    actors.get = id => actors.find(actor => actor.id === id);

    class Die {
      constructor(data = {}) {
        Object.assign(this, data);
        this.number = Number(data.number) || 1;
        this.faces = Number(data.faces) || 10;
        this.options = data.options || {};
        this.results = [];
      }
      async evaluate() {
        this.results = Array.from({length: this.number}, () => {
          assert.ok(faces.length, 'fixture must supply each explosion face');
          return {result: faces.shift(), active: true};
        });
        this._evaluated = true;
        return this;
      }
      toJSON() { return {}; }
    }
    class DiceTerm extends Die {}
    DiceTerm.REGISTERED_TERMS = {};
    DiceTerm.fromParseNode = () => null;
    class RollTerm {}
    RollTerm.CLASSES = {};
    RollTerm.fromData = data => data;
    RollTerm._fromData = data => data;
    class Roll {}
    Roll.fromData = data => data;

    class Dialog {
      constructor(options) { this.options = options; this.listeners = []; }
      addEventListener(type, fn) { if (type === 'close') this.listeners.push(fn); }
      async render() {
        this.rendered = true;
        // An observer never clicks anything. The helper picks its own candidate.
        const button = userId === 'helper'
          ? this.options.buttons.find(button => button.action.startsWith('use-')) : null;
        if (button) setTimeout(async () => {
          await this.options.submit(button.callback(), this);
          this.close();
        }, 0);
      }
      close() { this.rendered = false; for (const fn of this.listeners) fn(); }
      static async wait(options) {
        return options.buttons[0].callback({}, {
          form: {querySelectorAll: () => selected.map(value => ({value: String(value)}))}
        });
      }
    }

    const sandbox = vm.createContext({
      console: {log() {}, warn: (...args) => errors.push(args.join(' ')), error: (...args) => errors.push(args.join(' '))},
      setTimeout: (fn, delay, ...args) => setTimeout(fn,
        userId === rollerUserId && delay === 60000 ? commitTimeoutMs : delay, ...args),
      clearTimeout, setInterval, clearInterval,
      structuredClone,
      Handlebars: {registerHelper() {}},
      Hooks: {
        once: (name, fn) => { if (name === 'ready') once.push(fn); },
        on: (name, fn) => { if (!hooks.has(name)) hooks.set(name, []); hooks.get(name).push(fn); },
        callAll: (name, context) => { for (const fn of hooks.get(name) || []) fn(context); }
      },
      CONFIG: {Dice: {terms: {}}},
      foundry: {
        utils: {randomID: () => `${userId}-roll`, deepClone: structuredClone,
          getProperty: (o, path) => path.split('.').reduce((node, key) => node?.[key], o)},
        dice: {terms: {Die, DiceTerm}, RollTerm, Roll},
        applications: {api: {DialogV2: Dialog}}
      },
      ChatMessage: {getSpeaker: () => ({}), create: async () => ({delete: async () => {}})},
      canvas: {tokens: {placeables: actors.map(actor => ({id: `token-${actor.id}`, actor}))}},
      ui: {notifications: {
        info() {}, warn() {}, error: message => notifications.push({userId, message})
      }},
      game: {
        user: {...users.get(userId), targets: new Set()}, users, actors, messages: [],
        settings: {get: (_system, key) => key === 'defaultCritical' ? 10 : false},
        i18n: {localize: key => key, format: key => key},
        socket: {
          on: (_channel, fn) => { nodes.get(userId).receive = fn; },
          emit: (_channel, envelope) => {
            const message = plain(envelope);
            sent.push(message);
            for (const [recipient, node] of nodes) {
              if (recipient === userId) continue; // Foundry broadcasts exclude their sender.
              const delay = transport?.(message, recipient) ?? 0;
              if (delay === false) continue;
              setTimeout(() => {
                // JSON must be parsed in the recipient's realm, as in a browser.
                const data = vm.runInContext(`JSON.parse(${JSON.stringify(JSON.stringify(message))})`, node.sandbox);
                void node.receive(data).catch(error => errors.push(String(error)));
              }, delay);
            }
          }
        }
      },
      DX3rdUniversalHandler: {
        normalizeEffectIds: () => [],
        handleItemUse: async (actorId, itemId) => {
          spent.push({userId, actorId, itemId});
          return spend ? spend({userId, actorId, itemId, nodes, sent}) : true;
        }
      }
    });
    sandbox.window = sandbox;
    const node = {sandbox, subject, assistant};
    nodes.set(userId, node);
    for (const path of ['scripts/core/runtime-utils.js', 'scripts/socket-router.js',
      'scripts/socket-contracts.js', 'scripts/dice/dice-term.js',
      'scripts/dice/roll-interventions.js',
      ...(realUsage ? ['scripts/core/debug-log.js', 'scripts/helpers.js', 'scripts/item-effect-adapter.js',
        'scripts/handlers/universal-handler.js', 'scripts/handlers/universal-extensions.js',
        'scripts/handlers/universal-apply.js'] : []),
      'scripts/dice/roll-intervention-effects.js',
      'scripts/socket-roll-interventions.js']) {
      vm.runInContext(source(path), sandbox, {filename: path});
    }
    if (realUsage && postUseFailure && userId === 'helper') {
      sandbox.DX3rdUniversalHandler.armPendingAfterSuccessApply = async () => {
        throw new Error('after-use failure after costs were paid');
      };
    }
    node.ready = () => Promise.all(once.map(fn => fn()));
  }

  async function resolveRoll() {
    await Promise.all(Array.from(nodes.values(), node => node.ready()));
    const node = nodes.get(rollerUserId);
    const Term = node.sandbox.foundry.dice.terms.DX3rdDiceTerm;
    const term = Term.fromData({number: waves[0].length, critical: 10, options: {},
      chainRolls: plain(waves), chainMaxes: waves.map(wave => Math.max(...wave)),
      results: waves.flat().map(result => ({result, active: true})),
      _totalValue: waves.reduce((sum, wave) => sum + Math.max(...wave), 0)});
    const roll = {
      terms: [term, {total: '+'}, {total: 3}], options: {},
      _total: term.total + 3,
      get total() { return this._total; },
      _evaluateTotal() { return term.total + 3; },
      render: async () => '<div class="dice-roll"></div>'
    };
    const result = await node.sandbox.DX3rdRollInterventions.resolve(`${waves[0].length}dx10 + 3`, {
      actor: rollActorId === 'assistant' ? node.assistant : node.subject, kind: 'check', subtype: 'major',
      createRoll: async () => roll
    });
    await new Promise(resolve => setTimeout(resolve, 0));
    return {result, term, nodes, sent, spent, errors, notifications};
  }
  return {resolveRoll, nodes, sent, spent, errors};
}

test('a remote DX declaration applies after the real item-use pipeline pays its costs', {timeout: 3000}, async () => {
  const {result, term, nodes, errors} = await clients({realUsage: true}).resolveRoll();
  assert.deepEqual(errors, []);
  const helper = nodes.get('helper').assistant;
  assert.equal(helper.system.attributes.encroachment.value, 54);
  assert.equal(helper.items.get('fairy').system.used.state, 1);
  assert.deepEqual(plain(term.chainRolls), [[8, 10, 2], [4]]);
  assert.equal(result.total, 17);
});

test('an exception after paying for a DX declaration must not finalize the unchanged roll', {timeout: 3000}, async () => {
  const {result, nodes, sent, errors} = await clients({
    realUsage: true, postUseFailure: true, commitTimeoutMs: 150
  }).resolveRoll();
  const helper = nodes.get('helper').assistant;
  assert.equal(helper.system.attributes.encroachment.value, 54);
  assert.equal(helper.items.get('fairy').system.used.state, 1);
  assert.equal(result, null, 'publishing the old result would conceal that a paid intervention failed');
  assert.ok(sent.some(message => message.payload.stage === 'commit' && message.payload.error),
    'the source must report its exception instead of waiting for a silent timeout');
  assert.ok(errors.some(error => error.includes('after-use failure')));
});

test('a lost paid DX commit must cancel the roll instead of finalizing its old result', {timeout: 3000}, async () => {
  const {result, spent, notifications} = await clients({
    commitTimeoutMs: 30,
    transport: message => message.payload.stage === 'commit' ? false : 0
  }).resolveRoll();
  assert.equal(spent.length, 1);
  assert.equal(result, null, 'a missing response after accept is not permission to publish the old result');
  assert.ok(notifications.some(entry => entry.userId === 'roller' && entry.message === 'DX3rd.RollInterventionTimeout'));
  assert.ok(notifications.some(entry => entry.userId === 'helper' && entry.message === 'DX3rd.RollInterventionTimeout'));
});

test('an exception inside the cost gate is not retried as an ordinary usage refusal', {timeout: 3000}, async () => {
  const {result, nodes, sent, notifications} = await clients({
    realUsage: true, usageCostFailure: true, commitTimeoutMs: 150
  }).resolveRoll();
  assert.equal(nodes.get('helper').assistant.system.attributes.encroachment.value, 54);
  assert.equal(result, null);
  const commits = sent.filter(message => message.payload.stage === 'commit');
  assert.equal(commits.length, 1);
  assert.equal(commits[0].payload.error, true);
  assert.ok(notifications.some(entry => entry.userId === 'helper' && entry.message === 'DX3rd.RollInterventionFailed'));
});

test('a refused cost gate still releases the claim without cancelling an otherwise valid DX roll', {timeout: 3000}, async () => {
  const {result, sent, notifications} = await clients({spend: ({nodes}) => {
    nodes.get('helper').assistant.items.length = 0;
    nodes.get('roller').assistant.items.length = 0;
    nodes.get('gm').assistant.items.length = 0;
    return false;
  }}).resolveRoll();
  assert.equal(result.total, 11);
  assert.ok(sent.some(message => message.payload.stage === 'commit' && !message.payload.ok && !message.payload.error));
  assert.deepEqual(notifications, []);
});

test('retrying a refused declaration isolates replies from the previous offer attempt', {timeout: 3000}, async () => {
  let attempts = 0;
  const {result, term, sent, errors} = await clients({
    spend: () => ++attempts > 1,
    // The old observer cancellation arrives after the next offer has opened.
    transport: message => message.payload.stage === 'cancel' ? 25 : 0
  }).resolveRoll();
  const claims = sent.filter(message => message.payload.stage === 'claim');
  assert.equal(claims.length, 2);
  assert.notEqual(claims[0].payload.roundKey, claims[1].payload.roundKey,
    'late replies must not address the new offer after a refusal');
  assert.equal(result.total, 17);
  assert.deepEqual(plain(term.chainRolls), [[8, 10, 2], [4]]);
  assert.deepEqual(errors, []);
});

test('a failed local declaration also cancels the DX roll after reporting its paid cost', {timeout: 3000}, async () => {
  const {result, nodes, notifications} = await clients({
    rollerUserId: 'helper', rollActorId: 'assistant', realUsage: true, postUseFailure: true
  }).resolveRoll();
  assert.equal(nodes.get('helper').assistant.system.attributes.encroachment.value, 54);
  assert.equal(nodes.get('helper').assistant.items.get('fairy').system.used.state, 1);
  assert.equal(result, null);
  assert.ok(notifications.some(entry => entry.userId === 'helper' && entry.message === 'DX3rd.RollInterventionFailed'));
});

for (const rollerUserId of ['roller', 'gm']) {
  for (const [waves, selected, expected] of [
    [[[8, 2, 2]], [1], [[8, 10, 2], [4]]],
    [[[8, 2, 2]], [2], [[8, 2, 10], [4]]],
    [[[10, 10, 2], [8, 2]], [4], [[10, 10, 2], [8, 10], [4]]]
  ]) {
    test(`${rollerUserId} receives a player's fairy-hand declaration on DX face ${selected[0]}`, {timeout: 3000}, async () => {
      const {result, term, spent, sent, errors} = await clients({rollerUserId, waves, selected}).resolveRoll();
      assert.deepEqual(errors, []);
      assert.deepEqual(spent, [{userId: 'helper', actorId: 'assistant', itemId: 'fairy'}]);
      assert.deepEqual(plain(term.chainRolls), expected);
      assert.equal(result.total, expected.reduce((sum, wave) => sum + Math.max(...wave), 0) + 3);
      assert.equal(result.options.dx3rdIntervention.history.length, 1);
      assert.equal(result.options.dx3rdIntervention.history[0].value, 10);
      assert.ok(sent.some(message => message.payload.stage === 'commit' && message.payload.ok));
    });
  }
}
