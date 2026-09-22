(function () {
  const phases = new Map([
    ['beforeRoll', []],
    ['afterRoll', []]
  ]);
  let sequence = 0;

  function register(phase, handler, options = {}) {
    if (!phases.has(phase)) throw new Error(`Unknown roll intervention phase: ${phase}`);
    if (typeof handler !== 'function') throw new TypeError('Roll intervention handler must be a function.');
    const entry = {handler, priority: Number(options.priority) || 0, sequence: sequence++};
    const entries = phases.get(phase);
    entries.push(entry);
    entries.sort((a, b) => a.priority - b.priority || a.sequence - b.sequence);
    return () => {
      const index = entries.indexOf(entry);
      if (index >= 0) entries.splice(index, 1);
    };
  }

  async function runPhase(phase, context) {
    context.phase = phase;
    for (const {handler} of phases.get(phase) || []) {
      const result = await handler(context);
      if (result === false) context.cancelled = true;
      else if (result) context.commands.push(...(Array.isArray(result) ? result : [result]));
      if (context.cancelled) break;
    }
  }

  function diceTerms(roll) {
    return (roll?.terms || []).filter(term => Array.isArray(term?.results));
  }

  function dxTerm(roll) {
    return diceTerms(roll).find(term =>
      term?.constructor?.name === 'DX3rdDiceTerm' || term?.constructor?.DENOMINATION === 'dx');
  }

  function standardDice(roll) {
    const dice = [];
    diceTerms(roll).forEach((term, termIndex) => {
      if (term === dxTerm(roll)) return;
      term.results.forEach((result, dieIndex) => {
        if (result?.active === false || result?.discarded === true) return;
        dice.push({
          term,
          termIndex,
          dieIndex,
          result: Number(result.result) || 0,
          faces: Number(term.faces) || 0
        });
      });
    });
    return dice;
  }

  function availableDice(context) {
    // A remote declarer holds no Roll — the offer carries the faces it may touch, and the
    // selection comes back as {waveIndex/termIndex, dieIndex} references for this client to apply.
    if (Array.isArray(context?.diceSnapshot)) return context.diceSnapshot;
    const term = dxTerm(context.roll);
    if (context.kind === 'check') {
      // Check interventions may only touch DX 판정 dice — never standard dice terms.
      const dice = term?.getInterventionDice?.() || [];
      return dice.map(die => ({...die, kind: 'dx'}));
    }
    return standardDice(context.roll).map(die => ({...die, kind: 'standard'}));
  }

  // The pool is the first dice term of the frozen formula — `10dx7` for a check, `2d10` for a
  // damage / backtrack / scene roll. Pre-roll interventions (《재밍》 "그 판정에 [LV]개의 다이스
  // 페널티", No.19 지도자 "5개의 다이스를 추가하고 크리티컬치에 -1") work on that term, because
  // before the roll exists there is nothing else to touch.
  const POOL_TERM = /(\d+)d(x?)(\d+)?/i;

  function parsePool(formula, override = null) {
    const match = POOL_TERM.exec(String(formula));
    if (!match) return null;
    const isDx = !!match[2];
    // `override.dice` is the caller's *unclamped* pool. The formula already reads `1dx…` when the
    // pool was 0 or less (one die still rolls for the animation), so parsing it back would hide
    // the shortfall and a further penalty would start from 1 instead of from the real count.
    const declared = Number(override?.dice);
    return {
      dice: Number.isFinite(declared) ? declared : Number(match[1]) || 0,
      critical: isDx ? (Number(override?.critical) || Number(match[3]) || null) : null,
      faces: isDx ? 10 : (Number(match[3]) || 10),
      isDx
    };
  }

  function rewritePool(formula, pool) {
    const term = pool.isDx
      ? `${Math.max(1, pool.dice)}dx${pool.critical ?? ''}`
      : `${Math.max(1, pool.dice)}d${pool.faces}`;
    return String(formula).replace(POOL_TERM, term);
  }

  function applyPool(context, command) {
    const pool = context.pool;
    if (!pool) return;
    const value = Number(command.value) || 0;
    // 「(하한치 5)」(No.G01 선별자)·「(최저 1)」(스몰 월드)처럼 선언마다 자기 하한을 적는 것이 있다.
    const floor = Number(command.floor);
    const hasFloor = Number.isFinite(floor);
    if (command.type === 'adjustDice') pool.dice = Math.max(hasFloor ? floor : -Infinity, pool.dice + value);
    else if (command.type === 'setDice') pool.dice = Math.max(hasFloor ? floor : -Infinity, value);
    else if (command.type === 'adjustCritical') {
      if (!pool.isDx) return;
      // DX3rdDiceTerm clamps the critical at 2 as well; clamping here too keeps the formula printed
      // on the chat card identical to the one the term actually rolled. An authored floor only ever
      // raises that bound — the term cannot roll below 2 whatever the declaration says.
      pool.critical = Math.max(2, hasFloor ? floor : 2, (pool.critical ?? 10) + value);
    }
    // Rules (rule-section:39-41): a modified pool of 0 or less auto-fails, achievement 0. One die
    // is still rolled for the animation, so the caller — not the formula — carries that verdict.
    context.autoFail = pool.dice <= 0;
    context.formula = rewritePool(context.formula, pool);
  }

  async function rollOne(faces, options = {}) {
    const term = new foundry.dice.terms.Die({number: 1, faces, options});
    await term.evaluate();
    return Number(term.results?.[0]?.result) || 1;
  }

  function recomputeRoll(roll) {
    for (const term of diceTerms(roll)) {
      if (typeof term._evaluateTotal === 'function') term._total = term._evaluateTotal();
    }
    if (typeof roll?._evaluateTotal === 'function') roll._total = roll._evaluateTotal();
    else if (roll) {
      const totals = (roll.terms || []).map(term => Number(term?.total)).filter(Number.isFinite);
      roll._total = totals.reduce((sum, value) => sum + value, 0);
    }
    return roll;
  }

  async function applySelected(context, command) {
    const refs = Array.isArray(command.dice) ? command.dice : [];
    if (!refs.length) return;
    const term = dxTerm(context.roll);
    const dxRefs = refs.filter(ref => ref.kind === 'dx' || Number.isInteger(ref.waveIndex));
    if (dxRefs.length && term?.applyInterventions) {
      await term.applyInterventions(dxRefs.map(ref => ({
        waveIndex: ref.waveIndex,
        dieIndex: ref.dieIndex,
        operation: command.type,
        value: command.value
      })));
    }
    for (const ref of refs.filter(ref => ref.kind !== 'dx' && !Number.isInteger(ref.waveIndex))) {
      const targetTerm = context.roll?.terms?.[ref.termIndex];
      const result = targetTerm?.results?.[ref.dieIndex];
      if (!result) continue;
      if (command.type === 'rerollSelected') {
        result.result = await rollOne(Number(targetTerm.faces) || 10, targetTerm.options);
      } else if (command.type === 'setFaces') {
        result.result = Math.max(1, Math.min(Number(targetTerm.faces) || 10, Number(command.value) || 1));
      } else if (command.type === 'adjustFaces') {
        result.result = Math.max(1, Math.min(
          Number(targetTerm.faces) || 10,
          (Number(result.result) || 0) + (Number(command.value) || 0)
        ));
      }
    }
    recomputeRoll(context.roll);
  }

  async function applyCommand(context, command) {
    if (!command || typeof command !== 'object') return;
    if (command.type === 'rerollAll') {
      context.roll = await context.createRoll(context.formula);
      context.generation++;
    } else if (['rerollSelected', 'setFaces', 'adjustFaces'].includes(command.type)) {
      await applySelected(context, command);
    } else if (['adjustDice', 'setDice', 'adjustCritical'].includes(command.type)) {
      applyPool(context, command);
    } else if (command.type === 'replaceTotal') {
      context.overrideTotal = Number(command.value) || 0;
    } else if (command.type === 'adjustTotal') {
      // 달성치 수정(《그래비티 바인드》 "-[LV×3]", 《천재》 "+【정신】")은 합계를 덮어쓰지 않고
      // 누적된다. 덮어쓰면 뒤이은 재굴림이 수정분을 지우고, 같은 굴림에 두 번 걸리는 선언
      // (《블랙 아웃》 "한 번의 판정에 여러 번 사용")이 마지막 하나만 남는다.
      context.totalAdjust += Number(command.value) || 0;
      const floor = Number(command.floor);
      if (Number.isFinite(floor)) context.totalFloor = Math.max(context.totalFloor, floor);
    }
    context.history.push({
      type: command.type,
      sourceActorId: command.sourceActorId || null,
      sourceItemId: command.sourceItemId || null,
      sourceGroup: command.sourceGroup || null,
      generation: context.generation,
      value: command.value ?? null,
      dice: (command.dice || []).map(({kind, termIndex, waveIndex, dieIndex}) =>
        ({kind, termIndex, waveIndex, dieIndex}))
    });
    context.revision++;
  }

  async function evaluate(formula, options = {}) {
    const method = options.method === 'evaluate' ? 'evaluate' : 'roll';
    const createRoll = options.createRoll || (async currentFormula => {
      const roll = new Roll(currentFormula);
      await roll[method]();
      return roll;
    });
    const context = {
      rollId: options.rollId || foundry.utils.randomID(),
      revision: 0,
      generation: 0,
      formula: String(formula),
      originalFormula: String(formula),
      actor: options.actor || null,
      item: options.item || null,
      kind: options.kind || 'misc',
      subtype: options.subtype || null,
      skillKey: options.skillKey || null,
      targets: options.targets || [],
      interactive: options.interactive !== false,
      metadata: options.metadata || {},
      roll: null,
      overrideTotal: null,
      totalAdjust: 0,
      totalFloor: 0,
      pool: null,
      autoFail: false,
      history: [],
      commands: [],
      cancelled: false,
      finalized: false,
      createRoll
    };

    context.pool = parsePool(context.formula, options.pool);
    context.autoFail = !!context.pool && context.pool.dice <= 0;

    // The pre-roll phase drains its commands the same way the post-roll phase does, so a second
    // declaration sees the pool the first one already reduced. Without the loop the commands were
    // collected and then dropped — the afterRoll loop resets `commands` before reading it.
    let changed;
    do {
      context.commands = [];
      Hooks.callAll('dx3rd.beforeRoll', context);
      await runPhase('beforeRoll', context);
      if (context.cancelled) {
        Hooks.callAll('dx3rd.rollCancelled', context);
        return context;
      }
      const commands = context.commands.splice(0);
      changed = commands.length > 0;
      for (const command of commands) await applyCommand(context, command);
    } while (changed);
    context.roll = await createRoll(context.formula);

    do {
      context.commands = [];
      Hooks.callAll('dx3rd.afterRoll', context);
      await runPhase('afterRoll', context);
      if (context.cancelled) {
        Hooks.callAll('dx3rd.rollCancelled', context);
        return context;
      }
      const commands = context.commands.splice(0);
      changed = commands.length > 0;
      for (const command of commands) await applyCommand(context, command);
    } while (changed);

    context.finalized = true;
    Hooks.callAll('dx3rd.rollFinalized', context);
    return context;
  }

  async function resolve(formula, options = {}) {
    const context = await evaluate(formula, options);
    if (context.cancelled) return null;
    if (context.roll && (context.overrideTotal !== null || context.totalAdjust)) {
      const base = context.overrideTotal !== null ? context.overrideTotal : Number(context.roll.total) || 0;
      // 달성치의 하한은 0이고, 선언이 자기 하한을 더 높게 적었으면 그것을 쓴다(《스몰 월드》 「최저 1」).
      context.roll._total = Math.max(context.totalFloor, base + context.totalAdjust);
    }
    context.roll.options ??= {};
    context.roll.options.dx3rdIntervention = {
      rollId: context.rollId,
      revision: context.revision,
      autoFail: context.autoFail,
      history: context.history
    };
    return context.roll;
  }

  window.DX3rdRollInterventions = Object.freeze({
    register,
    evaluate,
    resolve,
    availableDice,
    recomputeRoll,
    parsePool,
    rewritePool
  });
})();
