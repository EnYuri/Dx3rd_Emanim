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
    const term = dxTerm(context.roll);
    if (context.kind === 'check') {
      // Check interventions may only touch DX 판정 dice — never standard dice terms.
      const dice = term?.getInterventionDice?.() || [];
      return dice.map(die => ({...die, kind: 'dx'}));
    }
    return standardDice(context.roll).map(die => ({...die, kind: 'standard'}));
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
    } else if (command.type === 'replaceTotal') {
      context.overrideTotal = Number(command.value) || 0;
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
      history: [],
      commands: [],
      cancelled: false,
      finalized: false,
      createRoll
    };

    Hooks.callAll('dx3rd.beforeRoll', context);
    await runPhase('beforeRoll', context);
    if (context.cancelled) {
      Hooks.callAll('dx3rd.rollCancelled', context);
      return context;
    }
    context.roll = await createRoll(context.formula);

    let changed;
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
    if (context.overrideTotal !== null && context.roll) {
      context.roll._total = context.overrideTotal;
    }
    context.roll.options ??= {};
    context.roll.options.dx3rdIntervention = {
      rollId: context.rollId,
      revision: context.revision,
      history: context.history
    };
    return context.roll;
  }

  window.DX3rdRollInterventions = Object.freeze({
    register,
    evaluate,
    resolve,
    availableDice,
    recomputeRoll
  });
})();
