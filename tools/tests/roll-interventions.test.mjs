import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import test from 'node:test';
import vm from 'node:vm';

const root = resolve(import.meta.dirname, '..', '..');
const source = path => readFileSync(resolve(root, path), 'utf8');

function context() {
  let id = 0;
  class RollMock {
    constructor(formula) {
      this.formula = formula;
      this.total = ++id;
      this.terms = [];
      this.options = {};
    }
    async roll() {
      return this;
    }
  }
  const sandbox = vm.createContext({
    console,
    Roll: RollMock,
    foundry: {
      utils: {randomID: () => `roll-${id}`},
      dice: {terms: {Die: class {}}}
    },
    Hooks: {callAll() {}, on() {}, once() {}}
  });
  sandbox.window = sandbox;
  vm.runInContext(source('scripts/dice/roll-interventions.js'), sandbox);
  return sandbox;
}

test('a before-roll intervention changes the formula before evaluation', async () => {
  const sandbox = context();
  sandbox.DX3rdRollInterventions.register('beforeRoll', rollContext => {
    rollContext.formula = '2d10';
  });
  const roll = await sandbox.DX3rdRollInterventions.resolve('1d10', {interactive: false});
  assert.equal(roll.formula, '2d10');
});

test('a whole-roll reroll replaces the roll and offers the finalized result again', async () => {
  const sandbox = context();
  let visits = 0;
  sandbox.DX3rdRollInterventions.register('afterRoll', () => {
    visits++;
    return visits === 1 ? {type: 'rerollAll', sourceActorId: 'A', sourceItemId: 'I'} : null;
  });
  const roll = await sandbox.DX3rdRollInterventions.resolve('1d10', {interactive: false});
  assert.equal(visits, 2);
  assert.equal(roll.total, 2);
  assert.deepEqual(
    JSON.parse(JSON.stringify(roll.options.dx3rdIntervention.history)),
    [{type: 'rerollAll', sourceActorId: 'A', sourceItemId: 'I', sourceGroup: null, generation: 1, value: null, dice: []}]
  );
});

test('a selected ordinary die is changed before the roll total is finalized', async () => {
  const sandbox = context();
  const term = {
    faces: 10,
    results: [{result: 3, active: true}],
    get total() {
      return this.results[0].result;
    }
  };
  const roll = {
    terms: [term],
    options: {},
    _total: 3,
    _evaluateTotal() {
      return term.total;
    }
  };
  let visits = 0;
  sandbox.DX3rdRollInterventions.register('afterRoll', rollContext => {
    visits++;
    if (visits > 1) return null;
    const [die] = sandbox.DX3rdRollInterventions.availableDice(rollContext);
    return {type: 'setFaces', value: 10, dice: [die]};
  });
  const result = await sandbox.DX3rdRollInterventions.resolve('1d10', {
    createRoll: async () => roll,
    kind: 'damage',
    interactive: false
  });
  assert.equal(result.terms[0].results[0].result, 10);
  assert.equal(result._total, 10);
  assert.equal(visits, 2);
});

test('changing a DX die rebuilds the critical chain from the changed wave', async () => {
  const queue = [9, 2, 7];
  class DieMock {
    constructor(data = {}) {
      Object.assign(this, data);
      this.number = Number(data.number) || 1;
      this.faces = Number(data.faces) || 10;
      this.options = data.options || {};
      this.results = [];
    }
    async evaluate() {
      this.results = Array.from({length: this.number}, () => ({
        result: queue.shift(),
        active: true
      }));
      this._evaluated = true;
      return this;
    }
    toJSON() {
      return {};
    }
  }
  class DiceTermMock extends DieMock {}
  DiceTermMock.REGISTERED_TERMS = {};
  DiceTermMock.fromParseNode = () => null;
  class RollTermMock {}
  RollTermMock.CLASSES = {};
  RollTermMock.fromData = value => value;
  RollTermMock._fromData = value => value;
  class RollMock {}
  RollMock.fromData = value => value;
  const sandbox = vm.createContext({
    console,
    setTimeout: callback => callback(),
    game: {settings: {get: () => 10}, i18n: {localize: value => value}},
    CONFIG: {Dice: {terms: {}}},
    foundry: {
      dice: {
        terms: {Die: DieMock, DiceTerm: DiceTermMock},
        RollTerm: RollTermMock,
        Roll: RollMock
      },
      applications: {api: {}}
    }
  });
  sandbox.window = sandbox;
  vm.runInContext(source('scripts/dice/dice-term.js'), sandbox);
  const DXTerm = sandbox.foundry.dice.terms.DX3rdDiceTerm;
  const term = new DXTerm({number: 2, modifiers: [10]});
  await term.evaluate();
  assert.equal(term.total, 9);
  await term.applyInterventions([{
    waveIndex: 0,
    dieIndex: 0,
    operation: 'setFaces',
    value: 10
  }]);
  assert.deepEqual(JSON.parse(JSON.stringify(term.chainRolls)), [[10, 2], [7]]);
  assert.equal(term.total, 17);
  await term.applyInterventions([{
    waveIndex: 0,
    dieIndex: 0,
    operation: 'setFaces',
    value: 1
  }]);
  assert.deepEqual(JSON.parse(JSON.stringify(term.chainRolls)), [[1, 2]]);
  assert.equal(term.total, 2);
});

test('compendium interventions are offered only by actors with tokens on the current canvas', () => {
  const sandbox = context();
  const visible = {
    id: 'visible',
    uuid: 'Actor.visible',
    name: 'Visible',
    items: [
      {id: 'hard-luck', name: '하드 럭', system: {}},
      {id: 'authored', name: 'Authored', system: {rollIntervention: {
        enabled: true,
        phase: 'afterRoll',
        kinds: ['check'],
        subtypes: [],
        operation: 'rerollAll',
        target: 'self',
        perRollMax: 1
      }}}
    ],
    isOwner: true
  };
  const hidden = {
    id: 'hidden',
    uuid: 'Actor.hidden',
    name: 'Hidden',
    items: [{id: 'fairy-hand', name: '요정의 손', system: {}}],
    isOwner: true
  };
  sandbox.game = {
    user: {id: 'user', isGM: false},
    actors: [visible, hidden]
  };
  sandbox.canvas = {
    tokens: {placeables: [{id: 'token-visible', actor: visible}]}
  };
  sandbox.DX3rdSocketRouter = {
    getResponsibleActorExecutor: () => ({id: 'user'})
  };
  vm.runInContext(source('scripts/dice/roll-intervention-effects.js'), sandbox);
  const entries = sandbox.DX3rdRollInterventionEffects.candidates({
    actor: visible,
    item: null,
    kind: 'check',
    subtype: 'major',
    metadata: {},
    history: [],
    generation: 0
  });
  assert.deepEqual(Array.from(entries, entry => entry.item.id), ['hard-luck', 'authored']);
});

test('an adjust effect cannot target the same die twice in one roll', async () => {
  const sandbox = context();
  const actor = {
    id: 'roller',
    uuid: 'Actor.roller',
    name: 'Roller',
    items: [{id: 'chrono', name: 'No.32 크로노 트리거', system: {}}],
    isOwner: true
  };
  let offered = '';
  sandbox.game = {
    user: {id: 'user', isGM: false},
    actors: [actor],
    i18n: {localize: value => value, format: (value, data) => `${value}:${data?.count}`}
  };
  sandbox.ui = {notifications: {warn() {}}};
  sandbox.canvas = {tokens: {placeables: [{id: 'token-roller', actor}]}};
  sandbox.DX3rdSocketRouter = {getResponsibleActorExecutor: () => ({id: 'user'})};
  sandbox.foundry.applications = {
    api: {
      DialogV2: {
        wait: async ({content}) => {
          offered = content;
          return [{kind: 'standard', termIndex: 0, dieIndex: 1}];
        }
      }
    }
  };
  vm.runInContext(source('scripts/dice/roll-intervention-effects.js'), sandbox);
  const roll = {
    terms: [{faces: 10, results: [{result: 3, active: true}, {result: 5, active: true}]}],
    options: {}
  };
  const rollContext = {
    actor,
    item: null,
    kind: 'damage',
    roll,
    generation: 0,
    history: [{
      type: 'adjustFaces',
      generation: 0,
      dice: [{kind: 'standard', termIndex: 0, dieIndex: 0}]
    }]
  };
  const picked = await sandbox.DX3rdRollInterventionEffects.chooseDice(
    rollContext,
    {operation: 'adjustFaces', selection: 'one', count: '1', oncePerDie: true},
    actor.items[0],
    actor
  );
  assert.equal((offered.match(/name="die"/g) || []).length, 1);
  assert.deepEqual(picked, [{kind: 'standard', termIndex: 0, dieIndex: 1}]);
});

test('check interventions are not offered on damage, backtrack, or scene encroachment rolls', () => {
  const sandbox = context();
  const actor = {
    id: 'roller',
    uuid: 'Actor.roller',
    name: 'Roller',
    items: [
      {id: 'hard-luck', name: '하드 럭', system: {}},
      {id: 'chrono', name: 'No.32 크로노 트리거', system: {}},
      {id: 'fairy-hand', name: '요정의 손', system: {}}
    ],
    isOwner: true
  };
  sandbox.game = {user: {id: 'user', isGM: false}, actors: [actor]};
  sandbox.canvas = {tokens: {placeables: [{id: 'token-roller', actor}]}};
  sandbox.DX3rdSocketRouter = {getResponsibleActorExecutor: () => ({id: 'user'})};
  vm.runInContext(source('scripts/dice/roll-intervention-effects.js'), sandbox);
  const base = {actor, item: null, subtype: 'major', metadata: {}, history: [], generation: 0};
  for (const kind of ['damage', 'backtrack', 'sceneEncroachment']) {
    const entries = sandbox.DX3rdRollInterventionEffects.candidates({...base, kind});
    assert.equal(entries.length, 0, `check presets leaked into ${kind}`);
  }
  const check = sandbox.DX3rdRollInterventionEffects.candidates({...base, kind: 'check'});
  assert.equal(check.length, 3);
});

test('a check roll never offers standard dice to interventions', () => {
  const sandbox = context();
  const roll = {
    terms: [{faces: 10, results: [{result: 3, active: true}]}],
    options: {}
  };
  assert.equal(sandbox.DX3rdRollInterventions.availableDice({kind: 'check', roll}).length, 0);
  assert.equal(sandbox.DX3rdRollInterventions.availableDice({kind: 'damage', roll}).length, 1);
});

test('an exhausted item is hidden from candidates only when exhausted use is blocked', () => {
  const sandbox = context();
  const exhausted = {id: 'hard-luck', name: '하드 럭', system: {used: {disable: 'check', state: 2, max: 2}}};
  const fresh = {id: 'fairy-hand', name: '요정의 손', system: {}};
  const actor = {id: 'roller', uuid: 'Actor.roller', name: 'Roller', items: [exhausted, fresh], isOwner: true};
  sandbox.game = {user: {id: 'user', isGM: false}, actors: [actor]};
  sandbox.canvas = {tokens: {placeables: [{id: 'token-roller', actor}]}};
  sandbox.DX3rdSocketRouter = {getResponsibleActorExecutor: () => ({id: 'user'})};
  let allow = false;
  sandbox.DX3rdItemExhausted = {
    isItemExhausted: item => item === exhausted,
    allowExhaustedUse: () => allow
  };
  vm.runInContext(source('scripts/dice/roll-intervention-effects.js'), sandbox);
  const base = {actor, item: null, kind: 'check', subtype: 'major', metadata: {}, history: [], generation: 0};
  assert.deepEqual(
    Array.from(sandbox.DX3rdRollInterventionEffects.candidates(base), entry => entry.item.id),
    ['fairy-hand']
  );
  allow = true;
  assert.deepEqual(
    Array.from(sandbox.DX3rdRollInterventionEffects.candidates(base), entry => entry.item.id),
    ['hard-luck', 'fairy-hand']
  );
});

test('duplicate automatic documents on one actor apply as one named source', () => {
  const sandbox = context();
  const actor = {
    id: 'poet',
    uuid: 'Actor.poet',
    name: 'Poet',
    items: [
      {id: 'effect-poet', name: 'No.60 시인', system: {}},
      {id: 'rois-poet', name: 'No.60 시인', system: {}}
    ],
    isOwner: true
  };
  sandbox.game = {user: {id: 'user', isGM: false}, actors: [actor]};
  sandbox.canvas = {tokens: {placeables: [{id: 'token-poet', actor}]}};
  sandbox.DX3rdSocketRouter = {getResponsibleActorExecutor: () => ({id: 'user'})};
  vm.runInContext(source('scripts/dice/roll-intervention-effects.js'), sandbox);
  const base = {
    actor,
    item: null,
    kind: 'backtrack',
    subtype: 'normal',
    metadata: {},
    generation: 0
  };
  assert.equal(sandbox.DX3rdRollInterventionEffects.candidates({...base, history: []}).length, 2);
  const history = [{
    sourceActorId: actor.id,
    sourceItemId: 'effect-poet',
    sourceGroup: 'No.60 시인',
    generation: 0
  }];
  assert.equal(sandbox.DX3rdRollInterventionEffects.candidates({...base, history}).length, 0);
});
