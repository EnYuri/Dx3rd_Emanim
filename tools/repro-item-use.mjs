import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import vm from 'node:vm';

const root = resolve(import.meta.dirname, '..');
const source = path => readFileSync(resolve(root, path), 'utf8');

function baseContext(extra = {}) {
  const context = vm.createContext({ console, setTimeout, clearTimeout, structuredClone, ...extra });
  context.window = context;
  vm.runInContext(source('scripts/core/debug-log.js'), context, { filename: 'debug-log.js' });
  return context;
}
const load = (context, path) => vm.runInContext(source(path), context, { filename: path });

// ---- world stubs ----------------------------------------------------------
const calls = [];
const messages = [];
const warns = [];

const mkItem = (id, type, system, flags = {}) => ({
  id, name: id, type, img: '',
  system,
  getFlag(scope, key) { return key === 'itemExtend' ? flags.itemExtend : flags[key]; },
  async update(changes) {
    calls.push(`item.update:${id}:${JSON.stringify(changes)}`);
    for (const [path, value] of Object.entries(changes)) {
      const keys = path.split('.');
      let node = this;
      for (let i = 0; i < keys.length - 1; i++) node = node[keys[i]] ??= {};
      node[keys.at(-1)] = value;
    }
  }
});

const actor = {
  id: 'a1', name: 'actor', type: 'character', uuid: 'Actor.a1',
  items: new Map(), effects: [],
  system: {
    attributes: { encroachment: { value: 50, level: 1 }, hp: { value: 10 }, skills: {} },
    conditions: {}
  },
  getFlag: () => undefined,
  setFlag: async () => {},
  async update(changes) { calls.push(`actor.update:${JSON.stringify(changes)}`); },
  async createEmbeddedDocuments() { return []; },
  async updateEmbeddedDocuments() {}
};
actor.items.find = p => [...actor.items.values()].find(p);
actor.items.filter = p => [...actor.items.values()].filter(p);

const context = baseContext({
  game: {
    actors: new Map([[actor.id, actor]]),
    items: new Map(),
    user: { id: 'u1', isGM: true, targets: new Set() },
    users: { activeGM: { id: 'u1' }, get: () => null },
    settings: { get: () => false },
    i18n: { localize: k => k, format: k => k },
    macros: { filter: () => [], getName: () => null },
    scenes: { active: null },
    socket: { emit: () => {}, on: () => {} }
  },
  ui: { notifications: { warn: m => warns.push(String(m)), error: m => warns.push('ERR:' + m), info: () => {} } },
  canvas: { tokens: { placeables: [], controlled: [], get: () => null } },
  Hooks: { once: () => {}, on: () => {}, callAll: () => {} },
  CONFIG: { statusEffects: [] },
  CONST: { CHAT_MESSAGE_STYLES: { OTHER: 0 }, ACTIVE_EFFECT_SHOW_ICON: { ALWAYS: 2 } },
  ChatMessage: {
    getSpeaker: () => ({}),
    create: async data => { messages.push(typeof data === 'object' ? data.content : data); }
  },
  foundry: {
    utils: { deepClone: v => structuredClone(v), getProperty: (o, p) => p.split('.').reduce((n, k) => n?.[k], o), randomID: () => 'rid' },
    applications: { api: { DialogV2: { wait: async () => null } } }
  },
  Item: class {},
  DialogV2: { wait: async () => null }
});

context.DX3rdFormulaEvaluator = {
  getItemLevel: () => 1,
  evaluate: f => Number(String(f).replace('+', '')) || 0,
  prepareRollFormula: f => String(f),
  hasDice: () => false,
  isRollTimeKey: () => false
};

load(context, 'scripts/item-effect-adapter.js');
load(context, 'scripts/handlers/universal-handler.js');
load(context, 'scripts/handlers/universal-extensions.js');
load(context, 'scripts/handlers/universal-apply.js');

const handler = context.DX3rdUniversalHandler;

// Spy on the heavy collaborators so we can watch the sequence.
for (const fn of ['applySelfModifiers', 'processResourceCost', 'executeMacros',
                  'applyToTargets', 'processItemExtensions', 'registerAfterMainExtensions',
                  'armPendingAttackRider', 'armPendingAfterSuccessApply', 'executeItemExtension']) {
  const orig = handler[fn]?.bind(handler);
  handler[fn] = async (...args) => {
    calls.push(`${fn}(${args.map(a => (a && typeof a === 'object' && a.id) ? a.id : a).join(',')})`);
    if (fn === 'executeItemExtension') return undefined; // don't run real executors (need full Foundry)
    return orig ? orig(...args) : undefined;
  };
}

// Handlers for each type: stub the ones that are big, keep the no-op shape.
for (const [type, key] of [['effect', 'DX3rdEffectHandler'], ['psionic', 'DX3rdPsionicHandler'],
    ['spell', 'DX3rdSpellHandler'], ['combo', 'DX3rdComboHandler'], ['book', 'DX3rdBookHandler'],
    ['connection', 'DX3rdConnectionHandler'], ['etc', 'DX3rdEtcHandler'], ['once', 'DX3rdOnceHandler'],
    ['protect', 'DX3rdProtectHandler'], ['weapon', 'DX3rdWeaponHandler'], ['vehicle', 'DX3rdVehicleHandler']]) {
  context[key] = { handle: async () => { calls.push(`${type}Handler.handle`); return true; } };
}

async function use(item, options = { comboMode: 'normal', action: 'use' }) {
  actor.items.set(item.id, item);
  const tag = `=== use ${item.type}:${item.id} ===`;
  calls.push(tag);
  const result = await handler.handleItemUse(actor.id, item.id, item.type, undefined, undefined, options);
  calls.push(`result=${result}`);
  return result;
}

const plainSystem = (over = {}) => ({
  timing: 'auto', target: '자신', range: '지근', skill: '-',
  active: { state: false, disable: '-', runTiming: 'instant', action: '', applyMode: 'onUse' },
  effect: { disable: 'notCheck', runTiming: 'instant', action: '', attributes: {} },
  used: { state: 0, max: 0, level: false, disable: 'notCheck' },
  encroach: { value: '0', init: 0 }, hp: { value: '' },
  attributes: {}, getTarget: false, limit: '-', resourceCost: { enabled: false },
  ...over
});

// 1. 리저렉트-like: effect, roll '-', difficulty 자동성공, heal extension
await use(mkItem('resz', 'effect', plainSystem({ difficulty: '자동성공', roll: '-', attackRoll: '-' }),
  { itemExtend: { heal: { formulaAdd: '[level]d10', timing: 'instant', target: 'self', activate: true } } }));

// 2. once consumable with a heal extension (예비심장-like)
await use(mkItem('heart', 'once', plainSystem({
    quantity: 1, used: { state: 0, max: 1, level: false, disable: 'session' } }),
  { itemExtend: { heal: { formulaAdd: '1d10', timing: 'instant', target: 'self', activate: true } } }));

// 3. etc item, no extensions
await use(mkItem('etc1', 'etc', plainSystem()));

// 4. check-effect (roll 'major')
await use(mkItem('chk', 'effect', plainSystem({ difficulty: '대결', roll: 'major', skill: 'melee' })));

// 5. no-roll effect whose 'use' content is authored in effect.attributes (target modifiers, instant)
await use(mkItem('tmod', 'effect', plainSystem({
    difficulty: '자동성공', roll: '-',
    effect: { disable: 'notCheck', runTiming: 'instant', action: 'use',
              attributes: { a1: { key: 'add', label: '-', value: '3' } } } })));

// 6. no-roll effect with SELF modifiers authored on 'use' (onUse frozen channel)
await use(mkItem('smod', 'effect', plainSystem({
    difficulty: '자동성공', roll: '-',
    attributes: { s1: { key: 'add', label: '-', value: '2', action: 'use' } } })));

// 7. no-roll effect with self modifiers, no explicit row action (channel default)
await use(mkItem('smod2', 'effect', plainSystem({
    difficulty: '자동성공', roll: '-',
    attributes: { s1: { key: 'add', label: '-', value: '2' } } })));

// 8. no-roll effect with an embedded macro row
await use(mkItem('mac1', 'effect', plainSystem({
    difficulty: '자동성공', roll: '-',
    macros: [{ timing: 'instant', kind: 'code', command: 'console.log("hi")' }] })));

// 9. always-on effect, real compendium shape (생명증강II: roll '-', disable '-', applyMode 'onUse')
await use(mkItem('alw', 'effect', plainSystem({
    difficulty: '자동성공', roll: '-', timing: 'always',
    active: { state: false, disable: '-', runTiming: 'instant', action: '', applyMode: 'onUse' },
    attributes: { s1: { key: 'add', label: '-', value: '2' } } })));

// 9b. always-on, scene lifetime (렉클리스 포스 shape)
await use(mkItem('alw2', 'effect', plainSystem({
    difficulty: '자동성공', roll: '-', timing: 'always',
    active: { state: false, disable: 'scene', runTiming: 'instant', action: '', applyMode: 'onUse' },
    attributes: { s1: { key: 'add', label: '-', value: '2' } } })));

// 10. effect whose ONLY content is on the activation channel, used via 「사용」
await use(mkItem('act1', 'effect', plainSystem({
    difficulty: '자동성공', roll: '-', timing: 'auto',
    attributes: { s1: { key: 'add', label: '-', value: '2', action: 'activation' } } })));

// 12. getTarget:true no-roll effect with LIVE target modifiers (전술 shape — disable 'major') — no tokens
await use(mkItem('gt1', 'effect', plainSystem({
    difficulty: '자동성공', roll: '-', target: '단독', getTarget: true,
    effect: { disable: 'major', runTiming: 'instant', action: '',
              attributes: { t1: { key: 'add', label: '-', value: '1' } } } })));

// 12b. same item but a target IS selected
context.game.user.targets.add({ actor: { id: 't1' }, id: 'tok1', name: 'target' });
await use(mkItem('gt2', 'effect', plainSystem({
    difficulty: '자동성공', roll: '-', target: '단독', getTarget: true,
    effect: { disable: 'major', runTiming: 'instant', action: '',
              attributes: { t1: { key: 'add', label: '-', value: '1' } } } })));
context.game.user.targets.clear();

// 12c. getTarget:true, target:'자신', NO token on canvas (autoTargetSelf fails)
await use(mkItem('gt3', 'effect', plainSystem({
    difficulty: '자동성공', roll: '-', target: '자신', getTarget: true })));

// 12d. getTarget:true but empty target channel + no ext (요정의 손 shape — dead gate)
await use(mkItem('gt4', 'effect', plainSystem({
    difficulty: '자동성공', roll: '-', target: '단독', getTarget: true })));

// 11. always-on with BOTH self attrs and target attrs (legacy activation rule needs target empty)
await use(mkItem('alw3', 'effect', plainSystem({
    difficulty: '자동성공', roll: '-', timing: 'always',
    active: { state: false, disable: '-', runTiming: 'instant', action: '', applyMode: 'onUse' },
    attributes: { s1: { key: 'add', label: '-', value: '2' } },
    effect: { disable: 'notCheck', runTiming: 'instant', action: '',
              attributes: { t1: { key: 'add', label: '-', value: '1' } } } })));

console.log(calls.join('\n'));
console.log('\n-- messages --\n' + messages.map(m => String(m).slice(0, 140)).join('\n'));
console.log('\n-- warns --\n' + warns.join('\n'));
