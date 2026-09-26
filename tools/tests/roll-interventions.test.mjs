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
    phase: 'afterRoll',
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

// 이펙트가 정한 「적용 가능한 다이스 개수」는 선택 시점에 막아야 한다 — 최대치에 닿으면
// 나머지 체크박스가 비활성화되고, 하나를 빼면 다시 고를 수 있어야 한다.
test('the dice picker disables further boxes once the authored count is reached', async () => {
  const sandbox = context();
  const actor = {
    id: 'roller',
    uuid: 'Actor.roller',
    name: 'Roller',
    items: [{id: 'fairy-hand', name: '요정의 손', system: {}}],
    isOwner: true
  };
  sandbox.game = {
    user: {id: 'user', isGM: false},
    actors: [actor],
    i18n: {localize: value => value, format: (value, data) => `${value}:${data?.count}`}
  };
  sandbox.ui = {notifications: {warn() {}}};
  sandbox.canvas = {tokens: {placeables: [{id: 'token-roller', actor}]}};
  sandbox.DX3rdSocketRouter = {getResponsibleActorExecutor: () => ({id: 'user'})};

  const makeBox = () => {
    const listeners = [];
    return {
      checked: false,
      disabled: false,
      addEventListener: (_type, fn) => listeners.push(fn),
      toggle(state) {
        this.checked = state;
        listeners.forEach(fn => fn());
      }
    };
  };
  const boxes = [makeBox(), makeBox(), makeBox()];
  sandbox.foundry.applications = {
    api: {
      DialogV2: {
        wait: async options => {
          // 실제 wait 는 렌더될 때마다 render 콜백을 부른다 — 여기서는 수동으로 발화시킨다.
          options.render?.(null, {
            element: {querySelectorAll: selector => selector === 'input[name="die"]' ? boxes : []}
          });
          assert.ok(boxes.every(box => !box.disabled), '상한 이전에는 전부 고를 수 있다');
          boxes[0].toggle(true);
          assert.equal(boxes[1].disabled, true, '최대치에 닿으면 나머지는 못 고른다');
          assert.equal(boxes[2].disabled, true);
          boxes[0].toggle(false);
          assert.ok(boxes.every(box => !box.disabled), '하나를 빼면 다시 고를 수 있다');
          boxes[1].toggle(true);
          return [{kind: 'standard', termIndex: 0, dieIndex: 1}];
        }
      }
    }
  };
  vm.runInContext(source('scripts/dice/roll-intervention-effects.js'), sandbox);
  const roll = {
    terms: [{faces: 10, results: [
      {result: 3, active: true}, {result: 5, active: true}, {result: 7, active: true}
    ]}],
    options: {}
  };
  const picked = await sandbox.DX3rdRollInterventionEffects.chooseDice(
    {kind: 'damage', roll, generation: 0, history: []},
    {operation: 'setFaces', selection: 'one', count: '1'},
    actor.items[0],
    actor
  );
  assert.equal(picked.length, 1);
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
  const base = {actor, item: null, phase: 'afterRoll', subtype: 'major', metadata: {}, history: [], generation: 0};
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
  const base = {actor, item: null, phase: 'afterRoll', kind: 'check', subtype: 'major', metadata: {}, history: [], generation: 0};
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
    phase: 'afterRoll',
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

test('a pre-roll dice penalty shrinks the pool, and emptying it reports the auto-fail', async () => {
  const sandbox = context();
  const commands = [{type: 'adjustDice', value: -3, sourceActorId: 'A', sourceItemId: 'jamming'}];
  sandbox.DX3rdRollInterventions.register('beforeRoll', () => commands.shift() || null);
  const roll = await sandbox.DX3rdRollInterventions.resolve('5dx10 + 2', {
    interactive: false,
    pool: {dice: 5, critical: 10}
  });
  assert.equal(roll.formula, '2dx10 + 2');
  assert.equal(roll.options.dx3rdIntervention.autoFail, false);
});

test('a pool emptied before the roll still rolls one die but is reported as an auto-fail', async () => {
  const sandbox = context();
  const commands = [{type: 'adjustDice', value: -2, sourceActorId: 'A', sourceItemId: 'jamming'}];
  sandbox.DX3rdRollInterventions.register('beforeRoll', () => commands.shift() || null);
  const roll = await sandbox.DX3rdRollInterventions.resolve('2dx7', {
    interactive: false,
    pool: {dice: 2, critical: 7}
  });
  // 룰: 수정된 다이스가 0 이하면 자동 실패(달성치 0). 연출용으로 한 개는 굴리므로 수식은 1dx 다.
  assert.equal(roll.formula, '1dx7');
  assert.equal(roll.options.dx3rdIntervention.autoFail, true);
});

test('the pre-roll pool is read from the caller, not from the animation floor in the formula', async () => {
  const sandbox = context();
  const commands = [{type: 'adjustDice', value: -1, sourceActorId: 'A', sourceItemId: 'jamming'}];
  sandbox.DX3rdRollInterventions.register('beforeRoll', () => commands.shift() || null);
  // 호출부가 이미 0 이하를 1로 바닥 처리해 `1dx10` 을 넘긴 경우. 수식만 읽으면 페널티가 1에서
  // 출발해 실제 풀보다 얕게 깎인다.
  const roll = await sandbox.DX3rdRollInterventions.resolve('1dx10', {
    interactive: false,
    pool: {dice: 0, critical: 10}
  });
  assert.equal(roll.formula, '1dx10');
  assert.equal(roll.options.dx3rdIntervention.autoFail, true);
});

test('a pre-roll critical modifier never sinks the threshold below two', async () => {
  const sandbox = context();
  const commands = [{type: 'adjustCritical', value: -5, sourceActorId: 'A', sourceItemId: 'stone'}];
  sandbox.DX3rdRollInterventions.register('beforeRoll', () => commands.shift() || null);
  const roll = await sandbox.DX3rdRollInterventions.resolve('7dx6', {
    interactive: false,
    pool: {dice: 7, critical: 6}
  });
  assert.equal(roll.formula, '7dx2');
});

test('achievement modifiers accumulate on the total and never drive it below zero', async () => {
  const sandbox = context();
  const makeRoll = async () => ({total: 12, options: {}, terms: []});
  const one = context();
  one.DX3rdRollInterventions.register('afterRoll', (() => {
    const queue = [{type: 'adjustTotal', value: -5, sourceActorId: 'A', sourceItemId: 'bind'}];
    return () => queue.shift() || null;
  })());
  const lowered = await one.DX3rdRollInterventions.resolve('10dx10', {interactive: false, createRoll: makeRoll});
  assert.equal(lowered._total, 7);

  // 여러 선언이 같은 굴림에 겹친다(《블랙 아웃》 "한 번의 판정에 여러 번 사용"). 덮어쓰지 않고
  // 누적하며, 달성치는 0 아래로 내려가지 않는다.
  const queue = [
    {type: 'adjustTotal', value: -5, sourceActorId: 'A', sourceItemId: 'bind'},
    {type: 'adjustTotal', value: -9, sourceActorId: 'B', sourceItemId: 'slate'}
  ];
  sandbox.DX3rdRollInterventions.register('afterRoll', () => queue.shift() || null);
  const floored = await sandbox.DX3rdRollInterventions.resolve('10dx10', {interactive: false, createRoll: makeRoll});
  assert.equal(floored._total, 0);
});

test('the pre/post modifier card is its own declaration and each half only fires at its phase', () => {
  const sandbox = context();
  const modifier = (timing, scope, value) => ({
    enabled: true, timing, scope, value, kinds: ['check'], subtypes: [],
    target: 'other', attackOnly: false, skillKey: '', perRollMax: 1
  });
  const jamming = {id: 'jamming', name: '재밍', system: {rollModifier: modifier('before', 'dice', '-[level]')}};
  const bind = {id: 'bind', name: '그래비티 바인드', system: {rollModifier: modifier('after', 'achievement', '-[level]*3')}};
  const foe = {id: 'foe', uuid: 'Actor.foe', name: 'Foe', items: [jamming, bind], isOwner: true};
  const roller = {id: 'roller', uuid: 'Actor.roller', name: 'Roller', items: [], isOwner: true};
  sandbox.game = {user: {id: 'user', isGM: false}, actors: [foe, roller]};
  sandbox.canvas = {tokens: {placeables: [{id: 't1', actor: foe}, {id: 't2', actor: roller}]}};
  sandbox.DX3rdSocketRouter = {getResponsibleActorExecutor: () => ({id: 'user'})};
  vm.runInContext(source('scripts/dice/roll-intervention-effects.js'), sandbox);
  const effects = sandbox.DX3rdRollInterventionEffects;

  assert.equal(effects.modifierConfig(jamming).phase, 'beforeRoll');
  assert.equal(effects.modifierConfig(jamming).operation, 'adjustDice');
  assert.equal(effects.modifierConfig(bind).phase, 'afterRoll');
  assert.equal(effects.modifierConfig(bind).operation, 'adjustTotal');

  const base = {actor: roller, item: null, kind: 'check', subtype: 'major', metadata: {}, history: [], generation: 0};
  // 굴린 뒤에는 다이스 수를 더 이상 바꿀 수 없고, 굴리기 전에는 달성치 선언만 함께 설 수 있다.
  assert.deepEqual(
    Array.from(effects.candidates({...base, phase: 'beforeRoll'}), entry => entry.item.id),
    ['jamming']
  );
  assert.deepEqual(
    Array.from(effects.candidates({...base, phase: 'afterRoll'}), entry => entry.item.id),
    ['bind']
  );
  // 「자신 이외」로 저작한 선언은 자기 굴림에서는 후보가 되지 않는다.
  assert.equal(effects.candidates({...base, actor: foe, phase: 'beforeRoll'}).length, 0);
});

test('one item can carry both roll cards, and they stay separate declarations', () => {
  const sandbox = context();
  const item = {
    id: 'both',
    name: '양쪽',
    system: {
      rollIntervention: {
        enabled: true, phase: 'afterRoll', kinds: ['check'], subtypes: [], operation: 'setFaces',
        target: 'self', selection: 'one', count: '1', value: '10', perRollMax: 1
      },
      rollModifier: {
        enabled: true, timing: 'after', scope: 'achievement', value: '+5', kinds: ['check'],
        subtypes: [], target: 'self', perRollMax: 1
      }
    }
  };
  const actor = {id: 'roller', uuid: 'Actor.roller', name: 'Roller', items: [item], isOwner: true};
  sandbox.game = {user: {id: 'user', isGM: false}, actors: [actor]};
  sandbox.canvas = {tokens: {placeables: [{id: 't1', actor}]}};
  sandbox.DX3rdSocketRouter = {getResponsibleActorExecutor: () => ({id: 'user'})};
  vm.runInContext(source('scripts/dice/roll-intervention-effects.js'), sandbox);
  const effects = sandbox.DX3rdRollInterventionEffects;
  assert.equal(effects.itemConfigs(item).length, 2);
  const entries = effects.candidates({
    actor, item: null, phase: 'afterRoll', kind: 'check', subtype: 'major',
    metadata: {}, history: [], generation: 0
  });
  assert.deepEqual(Array.from(entries, entry => entry.config.operation), ['adjustTotal', 'setFaces']);
});

test('an authored floor bounds the value the declaration produces', async () => {
  const sandbox = context();
  // 《스몰 월드》 「그 판정의 달성치에 -[LV×5](최저 1) 한다」 — 기본 하한 0 보다 높게 적힌 경우.
  const queue = [{type: 'adjustTotal', value: -25, floor: 1, sourceActorId: 'A', sourceItemId: 'small-world'}];
  sandbox.DX3rdRollInterventions.register('afterRoll', () => queue.shift() || null);
  const roll = await sandbox.DX3rdRollInterventions.resolve('10dx10', {
    interactive: false,
    createRoll: async () => ({total: 12, options: {}, terms: []})
  });
  assert.equal(roll._total, 1);
});

test('a critical floor can only raise the bound, never sink it below the term minimum', async () => {
  const sandbox = context();
  // 《No.G01 선별자》 「크리티컬 수치에 -1(하한치 5)」.
  const queue = [{type: 'adjustCritical', value: -1, floor: 5, sourceActorId: 'A', sourceItemId: 'selector'}];
  sandbox.DX3rdRollInterventions.register('beforeRoll', () => queue.shift() || null);
  const raised = await sandbox.DX3rdRollInterventions.resolve('7dx5', {
    interactive: false, pool: {dice: 7, critical: 5}
  });
  assert.equal(raised.formula, '7dx5');

  // 하한을 2 아래로 적어도 DX 다이스 항이 굴릴 수 있는 최소는 2다.
  const other = context();
  const below = [{type: 'adjustCritical', value: -9, floor: 1, sourceActorId: 'A', sourceItemId: 'selector'}];
  other.DX3rdRollInterventions.register('beforeRoll', () => below.shift() || null);
  const clamped = await other.DX3rdRollInterventions.resolve('7dx6', {
    interactive: false, pool: {dice: 7, critical: 6}
  });
  assert.equal(clamped.formula, '7dx2');
});

test('a dice-valued declaration is rolled once by the action-time evaluator, never swallowed to zero', async () => {
  const sandbox = context();
  const item = {
    id: 'creator', name: '창조주의 힘',
    system: {rollModifier: {
      enabled: true, timing: 'after', scope: 'achievement', value: '+4d10', floor: '',
      kinds: ['check'], subtypes: [], target: 'other', attackOnly: false, skillKey: '', perRollMax: 1
    }}
  };
  const actor = {id: 'helper', uuid: 'Actor.helper', name: 'Helper', items: [item], isOwner: true};
  sandbox.game = {user: {id: 'user', isGM: false}, actors: [actor]};
  sandbox.canvas = {tokens: {placeables: [{id: 't1', actor}]}};
  sandbox.DX3rdSocketRouter = {getResponsibleActorExecutor: () => ({id: 'user'})};
  let rolls = 0;
  sandbox.DX3rdFormulaEvaluator = {
    hasDice: formula => /\dd\d/.test(formula),
    prepareRollFormula: formula => formula,
    evaluate: () => 0,
    evaluateRoll: async formula => {
      rolls++;
      return {total: 23, roll: null, formula};
    }
  };
  vm.runInContext(source('scripts/dice/roll-intervention-effects.js'), sandbox);
  const effects = sandbox.DX3rdRollInterventionEffects;
  const config = effects.modifierConfig(item);

  // 동기 evaluate 는 다이스식을 0으로 삼킨다(helpers.js). 그 경로를 타면 선언이 조용히 사라진다.
  assert.equal(sandbox.DX3rdFormulaEvaluator.evaluate('+4d10'), 0);
  assert.equal(await effects.resolveValue(config, item, actor), 23);
  assert.equal(rolls, 1);
  // 후보 버튼의 미리보기는 굴리지 않는다 — 고르지도 않은 선언이 다이스를 쓰면 안 된다.
  assert.equal(effects.previewValue(config, item, actor), '+4d10');
  assert.equal(rolls, 1);
});

test('an intervention declaration is an ordinary item use, minus only the step that opens a roll', () => {
  const effects = readFileSync(resolve(root, 'scripts/dice/roll-intervention-effects.js'), 'utf8');
  const handler = readFileSync(resolve(root, 'scripts/handlers/universal-handler.js'), 'utf8')
    .replace(/\s+/g, ' ');

  // 개입 소비는 `handleItemUse` 한 곳을 지나야 한다. 조각(비용·횟수·확장·afterMain)을 여기에
  // 다시 조립하면 반드시 갈린다 — 실제로 확장 도구가 통째로 빠져 「달성치 +5, 단 HP 5점 감소」의
  // 대가가 나가지 않았다.
  assert.match(effects, /handleItemUse\?\.\(\s*[\s\S]*?skipHandlerDispatch: true/,
    '개입 소비는 skipHandlerDispatch 모드의 handleItemUse 를 써야 한다');
  for (const reassembled of ['processItemUsageCost', 'processItemExtensions', 'registerAfterMainExtensions']) {
    // 주석의 언급은 허용하고 **호출**만 막는다.
    const called = effects.includes(`${reassembled}(`) || effects.includes(`${reassembled}?.(`);
    assert.ok(!called, `${reassembled} 를 개입 경로가 직접 부르면 handleItemUse 와 갈린다`);
  }
  assert.ok(!/system\.used\.state/.test(effects),
    '사용 횟수 증가도 handleItemUse 의 몫이다');

  // 그 모드가 건너뛰는 것은 **새 굴림을 여는 단계뿐**이다. 비용·자기 보정·매크로·대상 보정·
  // 확장·afterMain 은 그대로 지나야 하므로, 게이트는 타입 디스패치와 굴림 방식 선택창 둘이다.
  assert.ok(handler.includes('const handler = skipHandlerDispatch ? null : handlerMap[itemType];'),
    '타입 디스패치가 이 모드에서 꺼져야 resolve 안에서 또 하나의 resolve 가 시작되지 않는다');
  // 게이트를 늘리면 비용·확장까지 조용히 건너뛰게 된다. 지금 허용된 자리는 다섯 곳뿐이고
  // 전부 「굴림을 세우거나 여는 단계」다 — 선언 2 + 굴림 방식 선택창 1 + 판정 설정 검사 1 +
  // 디스패치 1 + 경고 1.
  assert.equal((handler.match(/skipHandlerDispatch/g) || []).length, 6,
    '개입 모드의 게이트는 굴림을 세우거나 여는 단계에만 있어야 한다');
  assert.ok(handler.includes('if (!skipHandlerDispatch && !this.validateItemUsePreflight('),
    '판정 설정 검사는 굴림이 없는 선언을 거절하면 안 된다(〈정보:…〉 커넥션 9건이 여기서 막혔다)');
  const cost = handler.indexOf('const usageAllowed = await this.processItemUsageCost(actor, item, { action,');
  const extensions = handler.indexOf("await this.processItemExtensions(actor, item, 'instant', action);");
  const dispatch = handler.indexOf('const handler = skipHandlerDispatch ? null : handlerMap[itemType];');
  assert.ok(cost > 0 && extensions > cost && dispatch > extensions,
    '비용과 확장은 디스패치보다 앞에 있어야 이 모드에서도 전부 지나간다');
});

test('a dependent consuming its prerequisite is hidden once the prerequisite is spent on the roll', () => {
  const sandbox = context();
  const domination = {id: 'dom', name: '지배의 영역', system: {}};
  const absolute = {id: 'abs', name: '절대지배', system: {rollIntervention: {
    enabled: true, phase: 'afterRoll', kinds: ['check'], subtypes: [], operation: 'setFaces',
    target: 'any', selection: 'exact', count: '[level]+1', value: '1', perRollMax: 1,
    requiredItem: '지배의 영역', requiresPriorUse: false
  }}};
  const actor = {id: 'ruler', uuid: 'Actor.ruler', name: 'Ruler', items: [domination, absolute], isOwner: true};
  sandbox.game = {user: {id: 'user', isGM: false}, actors: [actor]};
  sandbox.canvas = {tokens: {placeables: [{id: 't1', actor}]}};
  sandbox.DX3rdSocketRouter = {getResponsibleActorExecutor: () => ({id: 'user'})};
  vm.runInContext(source('scripts/dice/roll-intervention-effects.js'), sandbox);
  const base = {actor, item: null, phase: 'afterRoll', kind: 'check', subtype: 'major', metadata: {}, generation: 0};

  // 지배의 영역 미사용 → 단독·절대지배 둘 다 후보.
  assert.deepEqual(
    Array.from(sandbox.DX3rdRollInterventionEffects.candidates({...base, history: []}), e => e.item.id).sort(),
    ['abs', 'dom']
  );

  // 지배의 영역을 이 판정에 이미 사용했다면(단독 선사용) 절대지배의 동시 사용은
  // 성립하지 않는다 — 「한 번의 판정에 한 번」의 전제를 두 번 쓸 수 없다.
  const usedHistory = [{
    type: 'setFaces', sourceActorId: actor.id, sourceItemId: 'dom', generation: 0, dice: []
  }];
  assert.deepEqual(
    Array.from(sandbox.DX3rdRollInterventionEffects.candidates({...base, history: usedHistory}), e => e.item.id),
    []
  );

  // 절대지배가 전제를 소비한 뒤에는 지배의 영역 단독 후보도 내려간다(requiredItem 기록이
  // 전제의 사용 카운트에 잡히는 기존 동작 확인).
  const comboHistory = [
    {type: 'requiredItem', sourceActorId: actor.id, sourceItemId: 'dom', generation: 0, dice: []},
    {type: 'setFaces', sourceActorId: actor.id, sourceItemId: 'abs', generation: 0, dice: []}
  ];
  assert.deepEqual(
    Array.from(sandbox.DX3rdRollInterventionEffects.candidates({...base, history: comboHistory}), e => e.item.id),
    []
  );
});

test('an exhausted prerequisite keeps the dependent out exactly when its own use would be blocked', () => {
  const sandbox = context();
  const dom = {id: 'dom', name: '지배의 영역', system: {}};
  const absolute = {id: 'abs', name: '절대지배', system: {rollIntervention: {
    enabled: true, phase: 'afterRoll', kinds: ['check'], subtypes: [], operation: 'setFaces',
    target: 'any', selection: 'exact', count: '[level]+1', value: '1', perRollMax: 1,
    requiredItem: '지배의 영역', requiresPriorUse: false
  }}};
  const actor = {id: 'ruler', uuid: 'Actor.ruler', name: 'Ruler', items: [dom, absolute], isOwner: true};
  sandbox.game = {user: {id: 'user', isGM: false}, actors: [actor]};
  sandbox.canvas = {tokens: {placeables: [{id: 't1', actor}]}};
  sandbox.DX3rdSocketRouter = {getResponsibleActorExecutor: () => ({id: 'user'})};
  let allow = false;
  sandbox.DX3rdItemExhausted = {
    isItemExhausted: item => item === dom,
    allowExhaustedUse: () => allow
  };
  vm.runInContext(source('scripts/dice/roll-intervention-effects.js'), sandbox);
  const base = {actor, item: null, phase: 'afterRoll', kind: 'check', subtype: 'major', metadata: {}, history: [], generation: 0};

  // 엄격 모드 — 소진된 전제는 자기 자신도 못 쓰고, 그 위에 리미트도 설 수 없다.
  assert.deepEqual(
    Array.from(sandbox.DX3rdRollInterventionEffects.candidates(base), e => e.item.id), []);

  // 완화 설정 — 소진된 아이템도 경고를 남기고 쓸 수 있는 월드라면, 전제로서의 소비도
  // 같은 규칙으로 허용되므로 조합은 성립한다(실제 지불은 processItemUsageCost 가 경고한다).
  allow = true;
  const abs = Array.from(sandbox.DX3rdRollInterventionEffects.candidates(base))
    .find(e => e.item.id === 'abs');
  assert.equal(abs?.requiredItem?.id, 'dom');
});

test('a simultaneous prerequisite is spent per copy, so a fresh duplicate still carries the combo', () => {
  const sandbox = context();
  const domA = {id: 'dom-a', name: '지배의 영역||A', system: {}};
  const domB = {id: 'dom-b', name: '지배의 영역||B', system: {}};
  const absolute = {id: 'abs', name: '절대지배', system: {rollIntervention: {
    enabled: true, phase: 'afterRoll', kinds: ['check'], subtypes: [], operation: 'setFaces',
    target: 'any', selection: 'exact', count: '[level]+1', value: '1', perRollMax: 1,
    requiredItem: '지배의 영역', requiresPriorUse: false
  }}};
  const actor = {id: 'ruler', uuid: 'Actor.ruler', name: 'Ruler', items: [domA, domB, absolute], isOwner: true};
  sandbox.game = {user: {id: 'user', isGM: false}, actors: [actor]};
  sandbox.canvas = {tokens: {placeables: [{id: 't1', actor}]}};
  sandbox.DX3rdSocketRouter = {getResponsibleActorExecutor: () => ({id: 'user'})};
  vm.runInContext(source('scripts/dice/roll-intervention-effects.js'), sandbox);
  const base = {actor, item: null, phase: 'afterRoll', kind: 'check', subtype: 'major', metadata: {}, generation: 0};

  // 사본 A를 이번 판정에 썼어도 사본 B는 한도가 남아 있다 — 조합은 성립하고 B를 소비한다.
  const history = [{
    type: 'setFaces', sourceActorId: actor.id, sourceItemId: 'dom-a', generation: 0, dice: []
  }];
  const abs = Array.from(sandbox.DX3rdRollInterventionEffects.candidates({...base, history}))
    .find(e => e.item.id === 'abs');
  assert.equal(abs?.requiredItem?.id, 'dom-b');

  // 두 사본 모두 이번 판정에 소진되면 지불할 전제가 없어 조합이 내려간다.
  const bothUsed = [...history,
    {type: 'setFaces', sourceActorId: actor.id, sourceItemId: 'dom-b', generation: 0, dice: []}];
  assert.equal(
    sandbox.DX3rdRollInterventionEffects.candidates({...base, history: bothUsed})
      .find(e => e.item.id === 'abs'),
    undefined
  );
});

test('a prior-use dependent needs a spendable prerequisite copy, not just a used one', () => {
  const sandbox = context();
  const handA = {id: 'hand-a', name: '요정의 손||A', system: {}};
  const handB = {id: 'hand-b', name: '요정의 손||B', system: {}};
  const ring = {id: 'ring', name: '요정의 고리', system: {rollIntervention: {
    enabled: true, phase: 'afterRoll', kinds: ['check'], subtypes: [], operation: 'setFaces',
    target: 'any', selection: 'one', count: '1', value: '10', perRollMax: 1,
    requiredItem: '요정의 손', requiresPriorUse: true
  }}};
  const actor = {id: 'fairy', uuid: 'Actor.fairy', name: 'Fairy', items: [handA, handB, ring], isOwner: true};
  sandbox.game = {user: {id: 'user', isGM: false}, actors: [actor]};
  sandbox.canvas = {tokens: {placeables: [{id: 't1', actor}]}};
  sandbox.DX3rdSocketRouter = {getResponsibleActorExecutor: () => ({id: 'user'})};
  let allow = false;
  const exhaustedHands = new Set();
  sandbox.DX3rdItemExhausted = {
    isItemExhausted: item => exhaustedHands.has(item.id),
    allowExhaustedUse: () => allow
  };
  vm.runInContext(source('scripts/dice/roll-intervention-effects.js'), sandbox);
  const base = {actor, item: null, phase: 'afterRoll', kind: 'check', subtype: 'major', metadata: {}, generation: 0};
  // 이번 판정에 손 A를 쓴 기록 — 「한 번 더」 조건은 성립했다.
  const history = [{
    type: 'setFaces', sourceActorId: actor.id, sourceItemId: 'hand-a', generation: 0, dice: []
  }];

  // 쓰인 사본이 소진됐어도 다른 사본이 살아 있으면 그쪽을 소비해 조합이 성립한다.
  exhaustedHands.add('hand-a');
  const ringEntry = Array.from(sandbox.DX3rdRollInterventionEffects.candidates({...base, history}))
    .find(e => e.item.id === 'ring');
  assert.equal(ringEntry?.requiredItem?.id, 'hand-b');

  // 전부 소진이면(엄격 모드) 지불할 전제가 없어 고리도 내려간다.
  exhaustedHands.add('hand-b');
  assert.equal(
    sandbox.DX3rdRollInterventionEffects.candidates({...base, history})
      .find(e => e.item.id === 'ring'),
    undefined
  );
});

test('the prerequisite is spent and recorded before the dependent item', () => {
  const effects = readFileSync(resolve(root, 'scripts/dice/roll-intervention-effects.js'), 'utf8');
  const block = effects.slice(effects.indexOf('async function spendLocal'));
  const spendRequired = block.indexOf('spendItem(entry.requiredItem)');
  const recordRequired = block.indexOf("type: 'requiredItem'");
  const spendCandidate = block.indexOf('spendItem(entry.item)');
  assert.ok(spendRequired > 0, '전제를 먼저 지불해야 한다');
  assert.ok(recordRequired > spendRequired, '전제 지불 직후 사용 기록이 남아야 한다');
  assert.ok(spendCandidate > recordRequired, '리미트 지불은 기록 이후다 — 순서가 뒤집히면 전제가 새거나 두 번 나간다');
});

test('a prior-use prerequisite unlocks the dependent and name matching survives duplicate copies', () => {
  const sandbox = context();
  const handA = {id: 'hand-a', name: '요정의 손||A', system: {}};
  const handB = {id: 'hand-b', name: '요정의 손||B', system: {}};
  const ring = {id: 'ring', name: '요정의 고리', system: {rollIntervention: {
    enabled: true, phase: 'afterRoll', kinds: ['check'], subtypes: [], operation: 'setFaces',
    target: 'any', selection: 'one', count: '1', value: '10', perRollMax: 1,
    requiredItem: '요정의 손', requiresPriorUse: true
  }}};
  const actor = {id: 'fairy', uuid: 'Actor.fairy', name: 'Fairy', items: [handA, handB, ring], isOwner: true};
  sandbox.game = {user: {id: 'user', isGM: false}, actors: [actor]};
  sandbox.canvas = {tokens: {placeables: [{id: 't1', actor}]}};
  sandbox.DX3rdSocketRouter = {getResponsibleActorExecutor: () => ({id: 'user'})};
  vm.runInContext(source('scripts/dice/roll-intervention-effects.js'), sandbox);
  const base = {actor, item: null, phase: 'afterRoll', kind: 'check', subtype: 'major', metadata: {}, generation: 0};

  // 선사용 전 — 손 두 벌만 후보이고 고리는 없다.
  assert.deepEqual(
    Array.from(sandbox.DX3rdRollInterventionEffects.candidates({...base, history: []}), e => e.item.id).sort(),
    ['hand-a', 'hand-b']
  );

  // 둘째 벌(handB)을 쓴 기록이어도 전제는 이름 매칭이므로 선사용으로 인정하고 고리가 열린다.
  // 손의 남은 벌은 「한 번 더」 소비 대상으로 아직 후보에 남는다.
  const history = [{
    type: 'setFaces', sourceActorId: actor.id, sourceItemId: 'hand-b', generation: 0, dice: []
  }];
  assert.deepEqual(
    Array.from(sandbox.DX3rdRollInterventionEffects.candidates({...base, history}), e => e.item.id).sort(),
    ['hand-a', 'ring']
  );
});
