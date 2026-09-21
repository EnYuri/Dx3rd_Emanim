(function () {
  const pendingRemoteUses = new Map();
  const CONNECTION_REROLLS = new Set([
    'UGN첩보부', '경찰OB', '대학교수', '매점부 정보망', '불법거주자',
    '블로거', '정보게시판', '컨설턴트', '프리랜서 기자'
  ]);

  const PRESETS = new Map([
    ['하드 럭', {phase: 'afterRoll', kinds: ['check'], operation: 'rerollSelected', target: 'self', selection: 'one', count: '1', perRollMax: 1}],
    ['요정의 손', {phase: 'afterRoll', kinds: ['check'], operation: 'setFaces', target: 'any', selection: 'one', count: '1', value: 10, perRollMax: 1}],
    ['검정의 손', {phase: 'afterRoll', kinds: ['check'], operation: 'setFaces', target: 'combinedItem', selection: 'one', count: '1', value: 10, perRollMax: 1}],
    ['망상구현자', {phase: 'afterRoll', kinds: ['check'], operation: 'chooseOneOrTen', target: 'any', selection: 'one', count: '1', perRollMax: 1, attackOnly: true}],
    ['망상을 본뜬 몸', {phase: 'afterRoll', kinds: ['check'], operation: 'chooseOneOrTen', target: 'any', selection: 'one', count: '1', perRollMax: 1, attackOnly: true}],
    ['지배의 영역', {phase: 'afterRoll', kinds: ['check'], operation: 'setFaces', target: 'any', selection: 'one', count: '1', value: 1, perRollMax: 1}],
    ['절대지배', {phase: 'afterRoll', kinds: ['check'], operation: 'setFaces', target: 'any', selection: 'exact', count: '[level]+1', value: 1, perRollMax: 1, requiredItem: '지배의 영역'}],
    ['요정의 고리', {phase: 'afterRoll', kinds: ['check'], operation: 'setFaces', target: 'any', selection: 'one', count: '1', value: 10, perRollMax: 1, requiredItem: '요정의 손', requiresPriorUse: true}],
    ['No.32 크로노 트리거', {phase: 'afterRoll', kinds: ['check'], operation: 'adjustFaces', target: 'self', selection: 'one', count: '1', chooseDelta: true, perRollMax: 3, oncePerDie: true}],
    ['No.83 한 줄기 희망', {phase: 'afterRoll', kinds: ['check'], operation: 'setFaces', target: 'self', selection: 'one', count: '1', value: 10, perRollMax: 1}],
    ['도끼', {phase: 'afterRoll', kinds: ['damage'], operation: 'rerollSelected', target: 'sourceItem', selection: 'one', count: '1', perRollMax: 1}],
    ['폴른 액스', {phase: 'afterRoll', kinds: ['damage'], operation: 'rerollSelected', target: 'sourceItem', selection: 'upTo', count: '3', perRollMax: 1}],
    ['바람을 울리는 손톱', {phase: 'afterRoll', kinds: ['damage'], operation: 'rerollSelected', target: 'combinedItem', selection: 'upTo', count: '[level]', perRollMax: 1}],
    ['No.14 안정체', {phase: 'afterRoll', kinds: ['backtrack'], subtypes: ['normal', 'double'], operation: 'rerollAll', target: 'self', perRollMax: 1}],
    ['No.60 시인', {phase: 'afterRoll', kinds: ['backtrack'], subtypes: ['normal', 'double'], operation: 'setFaces', target: 'self', selection: 'highest', value: 1, perRollMax: 1, automatic: true}],
    ['소중한 일품', {phase: 'afterRoll', kinds: ['sceneEncroachment'], operation: 'rerollAll', target: 'self', perRollMax: 1}],
    ['스타베트로D', {phase: 'afterRoll', kinds: ['sceneEncroachment'], operation: 'setFaces', target: 'self', selection: 'one', count: '1', value: 10, perRollMax: 1}],
    ['에나베트로D', {phase: 'afterRoll', kinds: ['sceneEncroachment'], operation: 'setFaces', target: 'self', selection: 'one', count: '1', value: 1, perRollMax: 1}]
  ]);

  function cleanName(item) {
    return String(item?.name || '').replace(/\|\|.*$/, '').trim();
  }

  function asList(value) {
    if (Array.isArray(value)) return value;
    return value ? [value] : [];
  }

  function itemConfig(item) {
    const authored = item?.system?.rollIntervention;
    // Sheet multi-selects can submit a scalar; normalize so filters always see lists.
    if (authored?.enabled) {
      return {...authored, kinds: asList(authored.kinds), subtypes: asList(authored.subtypes)};
    }
    const name = cleanName(item);
    if (CONNECTION_REROLLS.has(name)) {
      return {phase: 'afterRoll', kinds: ['check'], operation: 'rerollAll', target: 'sourceItem', perRollMax: 1};
    }
    return PRESETS.get(name) || null;
  }

  // 「선/후 보정」 카드 → 개입 설정. 저작자가 고르는 것은 선언 시점과 무엇을 얼마나뿐이고,
  // 나머지(다이스 선택·웨이브·전제 아이템 …)는 이 계열에 존재하지 않으므로 넘기지 않는다.
  const MODIFIER_OPERATIONS = {dice: 'adjustDice', critical: 'adjustCritical', achievement: 'adjustTotal'};

  function modifierConfig(item) {
    const authored = item?.system?.rollModifier;
    if (!authored?.enabled) return null;
    const operation = MODIFIER_OPERATIONS[authored.scope] || MODIFIER_OPERATIONS.dice;
    return {
      // 「직전에 선언하고 달성치를 고친다」(귀인의 예장)는 실재하는 형태다 — 선언 시점과
      // 무엇을 고치는지는 별개 축이라, 시점에서 조작을 유도하지 않는다.
      phase: authored.timing === 'after' ? 'afterRoll' : 'beforeRoll',
      operation,
      value: authored.value,
      floor: authored.floor,
      kinds: asList(authored.kinds),
      subtypes: asList(authored.subtypes),
      target: authored.target || 'other',
      attackOnly: !!authored.attackOnly,
      skillKey: authored.skillKey || '',
      perRollMax: Number(authored.perRollMax) || 1,
      fromModifierCard: true
    };
  }

  function itemConfigs(item) {
    // 한 아이템이 두 카드를 모두 저작할 수 있다(눈을 고치는 굴림 재정의 + 달성치를 깎는 선/후 보정).
    return [modifierConfig(item), itemConfig(item)].filter(Boolean);
  }

  function ownedActors(context) {
    const actors = [];
    const seen = new Set();
    for (const token of canvas.tokens?.placeables || []) {
      const actor = token.actor;
      const key = actor?.uuid || actor?.id;
      if (!actor || !key || seen.has(key)) continue;
      if (!window.DX3rdSocketRouter?.getResponsibleActorExecutor?.(actor)) continue;
      seen.add(key);
      actors.push({actor, tokenId: token.id});
    }
    return actors;
  }

  function applies(entry, context) {
    const {actor, item, config} = entry;
    // Exhaustion is still gated at spend time (processItemUsageCost warns and, under the default
    // allowExhaustedUse setting, lets it through). Hide the candidate only when the same check
    // there would hard-block the spend — otherwise the list offers a button that can never work.
    if (window.DX3rdItemExhausted?.isItemExhausted?.(item)
      && window.DX3rdItemExhausted?.allowExhaustedUse?.() === false) return false;
    if ((config.phase || 'afterRoll') !== context.phase) return false;
    // 굴리기 전에는 눈이 아직 없고, 굴린 뒤에는 다이스 수를 더 이상 바꿀 수 없다. 저작 실수로
    // 도달할 수 없는 조작이 후보 버튼으로 뜨면 눌러도 아무 일이 없으므로 여기서 떨군다.
    // (달성치 수정만 양쪽에 있다 — 굴리기 전에 선언해도 적용은 합계에 대고 한다.)
    const poolOnly = ['adjustDice', 'setDice', 'adjustCritical'].includes(config.operation);
    if (context.phase === 'beforeRoll' && !poolOnly && config.operation !== 'adjustTotal') return false;
    if (context.phase === 'afterRoll' && poolOnly) return false;
    if (Array.isArray(config.kinds) && config.kinds.length && !config.kinds.includes(context.kind)) return false;
    if (Array.isArray(config.subtypes) && config.subtypes.length && !config.subtypes.includes(context.subtype)) return false;
    if (config.attackOnly
      && !context.metadata?.isAttackRoll
      && !['reaction', 'dodge'].includes(context.subtype)) return false;
    if (config.target === 'self' && actor?.id !== context.actor?.id) return false;
    // 「대상이 판정을 실행하기 직전에」 계열은 남의 굴림에 거는 것이고, 원문이 자신을 대상으로
    // 삼을 수 없다고 적는 것(《소실하는 천사》)도 여럿이다. 그 기본값을 카드가 고를 수 있게 둔다.
    if (config.target === 'other' && actor?.id === context.actor?.id) return false;
    if (config.target === 'sourceItem' && item?.id !== context.item?.id) return false;
    if (config.target === 'combinedItem') {
      const ids = window.DX3rdUniversalHandler?.normalizeEffectIds?.(context.item)
        || (Array.isArray(context.item?.system?.effectIds) ? context.item.system.effectIds : []);
      if (item?.id !== context.item?.id && !ids.includes(item?.id)) return false;
    }
    if (config.skillKey && config.skillKey !== context.skillKey) return false;
    if (config.requiredItem) {
      const required = Array.from(actor.items || []).find(candidate => cleanName(candidate) === config.requiredItem);
      if (!required) return false;
      // An exhausted prerequisite blocks the spend the same way an exhausted candidate does.
      if (window.DX3rdItemExhausted?.isItemExhausted?.(required)
        && window.DX3rdItemExhausted?.allowExhaustedUse?.() === false) return false;
      if (config.requiresPriorUse && !context.history.some(record =>
        record.sourceActorId === actor.id && record.sourceItemId === required.id)) return false;
      entry.requiredItem = required;
    }
    const used = context.history.filter(record =>
      record.sourceActorId === actor?.id
      && (config.automatic
        ? record.sourceGroup === cleanName(item)
        : record.sourceItemId === item?.id)
      && (!config.automatic || record.generation === context.generation)).length;
    return used < (Number(config.perRollMax) || 1);
  }

  function candidates(context) {
    const entries = [];
    for (const {actor, tokenId} of ownedActors(context)) {
      for (const item of actor.items || []) {
        for (const config of itemConfigs(item)) entries.push({actor, tokenId, item, config});
      }
    }
    return entries.filter(entry => applies(entry, context));
  }

  const MODIFIER_LABELS = {
    adjustDice: 'DX3rd.RollModifierScopeDice',
    adjustCritical: 'DX3rd.RollModifierScopeCritical',
    adjustTotal: 'DX3rd.RollModifierScopeAchievement'
  };

  // 선/후 보정은 누를 때까지 무엇이 얼마나 바뀌는지 보이지 않으면 고를 수가 없다 — 이름만으로는
  // 「다이스 -1」인지 「달성치 -3」인지 구별되지 않으므로 버튼에 그 값을 같이 적는다.
  function describeEntry(entry) {
    const key = MODIFIER_LABELS[entry.config.operation];
    if (!entry.config.fromModifierCard || !key) return '';
    const value = previewValue(entry.config, entry.item, entry.actor);
    if (!value) return '';
    return ` (${game.i18n.localize(key)} ${value})`;
  }

  async function chooseCandidate(entries, context) {
    const DialogV2 = foundry.applications?.api?.DialogV2;
    if (!DialogV2 || !entries.length) return null;
    const before = context?.phase === 'beforeRoll';
    const buttons = entries.map((entry, index) => ({
      action: `use-${index}`,
      label: `${entry.item.name} — ${entry.actor.name}${describeEntry(entry)}`,
      callback: () => index
    }));
    buttons.push({
      action: 'finish',
      label: game.i18n.localize(before ? 'DX3rd.RollModifierProceed' : 'DX3rd.RollInterventionFinish'),
      default: true,
      callback: () => 'finish'
    });
    const prompt = before
      ? game.i18n.format('DX3rd.RollModifierPrompt', {actor: context?.actor?.name || ''})
      : game.i18n.localize('DX3rd.RollInterventionPrompt');
    return DialogV2.wait({
      window: {title: game.i18n.localize(before ? 'DX3rd.RollModifierTitle' : 'DX3rd.RollInterventionTitle')},
      position: {width: 640, height: 'auto'},
      content: `<p>${prompt}</p>${before ? poolSummary(context) : ''}`,
      rejectClose: false,
      classes: ['dx3rd-roll-intervention-dialog'],
      buttons
    });
  }

  // 굴리기 전에는 보여 줄 눈이 없다. 대신 지금 걸려 있는 풀을 적어, 선언이 무엇을 깎는지
  // (그리고 이미 0이 되어 자동 실패인지) 그 자리에서 보이게 한다.
  function poolSummary(context) {
    const pool = context?.pool;
    if (!pool) return '';
    const parts = [game.i18n.format('DX3rd.RollModifierPoolDice', {count: pool.dice})];
    if (pool.isDx && pool.critical) {
      parts.push(game.i18n.format('DX3rd.RollModifierPoolCritical', {value: pool.critical}));
    }
    if (pool.dice <= 0) parts.push(game.i18n.localize('DX3rd.PoolZero'));
    return `<p class="dx3rd-roll-intervention-pool">${parts.join(' / ')}</p>`;
  }

  function resolveCount(raw, item, actor) {
    const value = window.DX3rdFormulaEvaluator?.evaluate
      ? window.DX3rdFormulaEvaluator.evaluate(String(raw ?? 1), item, actor)
      : Number(raw);
    return Math.max(1, Math.floor(Number(value) || 1));
  }

  // 「[LV×3]점 감소」처럼 값 자체가 수식인 선언이 있으므로 사용하는 **그 아이템·액터**로 평가한다.
  // 굴림의 주인이 아니라 거는 쪽의 레벨·능력치가 기준이다.
  //
  // **동기 `evaluate` 를 쓰면 안 된다** — 그것은 다이스식을 경고 없이 0으로 삼킨다(`helpers.js`
  // 의 `if (this.hasDice(formulaStr)) return 0`). 「달성치에 +4D10」(《창조주의 힘》)·「+2D」
  // (《UGN의 지원 정보》)이 실재하므로 action-time 해석기로 정확히 한 번 굴리고, 굴린 눈은
  // 채팅에 남겨 선언한 값이 어디서 나왔는지 보이게 한다.
  async function resolveValue(config, item, actor) {
    const raw = config.value;
    // 값이 없는 조작(재굴림 계열)은 null 로 남겨 기록에도 「값 없음」으로 남는다.
    if (raw === '' || raw == null) return null;
    const evaluator = window.DX3rdFormulaEvaluator;
    if (!evaluator?.evaluateRoll) return Number(raw) || 0;
    const result = await evaluator.evaluateRoll(String(raw), item, actor);
    if (result?.roll) {
      await ChatMessage.create({
        flavor: `${item?.name || ''} — ${result.formula}`,
        rolls: [result.roll],
        speaker: ChatMessage.getSpeaker({actor})
      });
    }
    return Number(result?.total) || 0;
  }

  // 후보 버튼에 적는 미리보기. 여기서 굴리면 고르지도 않은 선언이 다이스를 소비하므로,
  // 다이스식은 수식 그대로 보여 주고 결정적 수식만 숫자로 접는다.
  function previewValue(config, item, actor) {
    const raw = config.value;
    if (raw === '' || raw == null) return '';
    const evaluator = window.DX3rdFormulaEvaluator;
    if (evaluator?.hasDice?.(String(raw))) {
      return evaluator.prepareRollFormula?.(String(raw), item, actor) || String(raw);
    }
    const value = evaluator?.evaluate ? evaluator.evaluate(String(raw), item, actor) : Number(raw);
    const number = Number(value) || 0;
    return number ? `${number > 0 ? '+' : ''}${number}` : '';
  }

  // 「(최저 1)」·「(하한치 5)」. 결정적 수식만 받는다 — 하한이 굴림마다 흔들릴 이유가 없다.
  function resolveFloor(config, item, actor) {
    const raw = config.floor;
    if (raw === '' || raw == null) return null;
    const value = window.DX3rdFormulaEvaluator?.evaluate
      ? window.DX3rdFormulaEvaluator.evaluate(String(raw), item, actor)
      : Number(raw);
    return Number.isFinite(Number(value)) ? Number(value) : null;
  }

  async function chooseValue(config, item, actor) {
    if (config.operation === 'chooseOneOrTen') {
      const result = await foundry.applications.api.DialogV2.wait({
        window: {title: game.i18n.localize('DX3rd.RollInterventionValue')},
        content: `<p>${game.i18n.localize('DX3rd.RollInterventionValuePrompt')}</p>`,
        rejectClose: false,
        buttons: [
          {action: 'one', label: '1', callback: () => 1},
          {action: 'ten', label: '10', callback: () => 10}
        ]
      });
      return result == null ? null : {type: 'setFaces', value: result};
    }
    if (config.chooseDelta) {
      const result = await foundry.applications.api.DialogV2.wait({
        window: {title: game.i18n.localize('DX3rd.RollInterventionValue')},
        content: `<p>${game.i18n.localize('DX3rd.RollInterventionDeltaPrompt')}</p>`,
        rejectClose: false,
        buttons: [
          {action: 'minus', label: '-1', callback: () => -1},
          {action: 'plus', label: '+1', callback: () => 1}
        ]
      });
      return result == null ? null : {type: 'adjustFaces', value: result};
    }
    // 값 평가는 **소비가 끝난 뒤**에 한다 — 여기서 굴리면 다이스 선택이나 소비에서 취소된
    // 선언이 이미 다이스를 써 버린다. 사용자에게 직접 묻는 두 갈래만 지금 값을 확정한다.
    void item; void actor;
    return {type: config.operation};
  }

  function dieKey(die) {
    const group = Number.isInteger(die?.waveIndex) ? `w${die.waveIndex}` : `t${die?.termIndex}`;
    return `${group}:${die?.dieIndex}`;
  }

  async function chooseDice(context, config, item, actor) {
    let dice = window.DX3rdRollInterventions.availableDice(context);
    if (config.waveScope === 'first') dice = dice.filter(die => die.waveIndex === 0);
    if (config.oncePerDie) {
      const operationType = config.operation === 'chooseOneOrTen' ? 'setFaces' : config.operation;
      const locked = new Set();
      for (const record of context.history || []) {
        if (record.generation !== context.generation || record.type !== operationType) continue;
        for (const die of record.dice || []) locked.add(dieKey(die));
      }
      dice = dice.filter(die => !locked.has(dieKey(die)));
    }
    if (!dice.length) return null;
    if (config.selection === 'all') return dice;
    const max = Math.min(dice.length, resolveCount(config.count, item, actor));
    const upTo = config.selection === 'upTo';
    const rows = dice.map((die, index) => {
      const classes = [
        die.critical ? 'critical' : '',
        die.result === 1 ? 'fumble' : '',
        die.result === die.faces ? 'maximum' : ''
      ].filter(Boolean).join(' ');
      return `
      <label class="dx3rd-roll-intervention-die ${classes}">
        <input type="checkbox" name="die" value="${index}">
        <span class="dx3rd-roll-intervention-face">${die.result}</span>
      </label>`;
    }).join('');
    while (true) {
      const selected = await foundry.applications.api.DialogV2.wait({
        window: {title: game.i18n.localize('DX3rd.RollInterventionDice')},
        content: `
          <p>${game.i18n.format(
            upTo ? 'DX3rd.RollInterventionSelectUpTo' : 'DX3rd.RollInterventionSelectExact',
            {count: max}
          )}</p>
          <div class="dx3rd-roll-intervention-grid">${rows}</div>`,
        rejectClose: false,
        buttons: [{
          action: 'confirm',
          label: game.i18n.localize('DX3rd.Confirm'),
          default: true,
          callback: (_event, button) => Array.from(
            button.form?.querySelectorAll('input[name="die"]:checked') || []
          ).map(input => dice[Number(input.value)]).filter(Boolean)
        }]
      });
      if (!Array.isArray(selected)) return null;
      if ((!upTo && selected.length === max) || (upTo && selected.length >= 1 && selected.length <= max)) {
        return selected;
      }
      ui.notifications.warn(game.i18n.format(
        upTo ? 'DX3rd.RollInterventionSelectUpTo' : 'DX3rd.RollInterventionSelectExact',
        {count: max}
      ));
    }
  }

  async function spendLocal(entry, context) {
    // **개입 선언도 그 아이템을 「쓰는」 것이다.** 비용·사용 횟수·자기 보정·매크로·대상 보정·
    // 확장 도구·afterMain 등록은 전부 `handleItemUse` 한 곳에서 나오므로, 그 조각을 여기에 다시
    // 조립하지 않는다(조립하면 반드시 갈린다 — 실제로 확장 도구가 통째로 빠져 있어서 「달성치 +5,
    // 단 HP 5점 감소」의 대가가 나가지 않았다). `skipHandlerDispatch` 가 건너뛰는 것은 **새 굴림을
    // 여는 단계뿐**이다 — 지금 이 코드는 `resolve` 안에서 도는 중이라 타입 핸들러가 판정을 열면
    // 바깥 굴림이 끝나기 전에 또 하나의 `resolve` 가 시작된다.
    const spendItem = async item => {
      const used = await window.DX3rdUniversalHandler?.handleItemUse?.(
        entry.actor.id, item.id, item.type, null, undefined,
        {action: 'use', rollType: context.subtype, skipHandlerDispatch: true}
      );
      return used !== false;
    };
    if (entry.requiredItem && !await spendItem(entry.requiredItem)) return false;
    if (!await spendItem(entry.item)) return false;
    if (entry.requiredItem) {
      context.history.push({
        type: 'requiredItem',
        sourceActorId: entry.actor.id,
        sourceItemId: entry.requiredItem.id,
        generation: context.generation,
        value: null,
        dice: []
      });
    }
    return true;
  }

  async function spend(entry, context) {
    if (entry.actor.isOwner || game.user?.isGM) return spendLocal(entry, context);
    const router = window.DX3rdSocketRouter;
    if (!router) return false;
    const requestKey = foundry.utils.randomID();
    const response = new Promise(resolve => {
      const timeout = setTimeout(() => {
        pendingRemoteUses.delete(requestKey);
        resolve(false);
      }, 30000);
      pendingRemoteUses.set(requestKey, approved => {
        clearTimeout(timeout);
        pendingRemoteUses.delete(requestKey);
        resolve(approved);
      });
    });
    const sent = router.emitToActorExecutor({
      type: 'requestRollInterventionUse',
      payload: {
        requestKey,
        requesterUserId: game.user.id,
        rollerActorId: context.actor.id,
        sourceActorId: entry.actor.id,
        sourceTokenId: entry.tokenId,
        sourceItemId: entry.item.id,
        requiredItemId: entry.requiredItem?.id || null,
        rollType: context.subtype || null
      }
    }, entry.actor);
    if (!sent) {
      pendingRemoteUses.delete(requestKey);
      return false;
    }
    const approved = await response;
    if (approved && entry.requiredItem) {
      context.history.push({
        type: 'requiredItem',
        sourceActorId: entry.actor.id,
        sourceItemId: entry.requiredItem.id,
        generation: context.generation,
        value: null,
        dice: []
      });
    }
    return approved;
  }

  window.DX3rdRollInterventions.register('afterRoll', context => {
    const entry = candidates(context).find(candidate => candidate.config.automatic);
    if (!entry) return null;
    const dice = window.DX3rdRollInterventions.availableDice(context);
    if (!dice.length) return null;
    const highest = dice.reduce((best, die) => die.result > best.result ? die : best);
    return {
      type: entry.config.operation,
      value: entry.config.value,
      dice: [highest],
      sourceActorId: entry.actor.id,
      sourceItemId: entry.item.id,
      sourceGroup: cleanName(entry.item)
    };
  }, {priority: 50});

  // The projected achievement the card shows must follow the same rule `resolve()` uses, or the
  // preview lies about the very thing the declaration just changed (《그래비티 바인드》 -3 was
  // invisible because `totalAdjust` is only folded in at resolve time).
  function projectedTotal(context) {
    if (context.autoFail) return 0;
    const base = context.overrideTotal !== null && context.overrideTotal !== undefined
      ? Number(context.overrideTotal) || 0
      : Number(context.roll?.total) || 0;
    return Math.max(Number(context.totalFloor) || 0, base + (Number(context.totalAdjust) || 0));
  }

  async function ensurePreview(context) {
    const rollHtml = context.roll?.render
      ? (await context.roll.render()).replace('class="dice-roll"', 'class="dice-roll expanded"')
      : '';
    const projected = projectedTotal(context);
    const note = context.autoFail
      ? ` <span class="dx3rd-roll-intervention-preview-note">(${
        game.i18n.localize('DX3rd.PoolZero')})</span>`
      : '';
    const content = `<div class="dx3rd-roll-intervention-preview-banner">${
      game.i18n.localize('DX3rd.RollInterventionPreview')}</div>${rollHtml}`
      + `<div class="dx3rd-roll-intervention-preview-total">${
        game.i18n.localize('DX3rd.RollInterventionProjectedTotal')}: <strong>${projected}</strong>${note}</div>`;
    // 값이 바뀔 때마다 제자리에서 고치면 카드가 로그 위쪽에 묻힌다. 옛 메시지를 지우고 다시
    // 만들어 늘 최신 메시지로 세운다 — 삭제를 먼저 기다려야 순서가 어긋나지 않는다.
    const previous = context.__previewMessage;
    context.__previewMessage = null;
    if (previous) await previous.delete().catch(() => {});
    context.__previewMessage = await ChatMessage.create({
      content,
      rolls: [context.roll],
      speaker: ChatMessage.getSpeaker({actor: context.actor}),
      flags: {'dx3rd-emanim': {rollInterventionPreview: true}}
    });
    return context.__previewMessage;
  }

  // 지우는 쪽은 이미 사라진 카드를 만날 수 있다(재생성이 삭제 → 생성이므로). 던지면 굴림
  // 마무리가 멈추므로 삼킨다 — 남은 잔류는 ready 스윕이 걷는다.
  function dropPreview(context) {
    const message = context.__previewMessage;
    context.__previewMessage = null;
    message?.delete().catch(() => {});
  }

  Hooks.on('dx3rd.rollFinalized', dropPreview);
  Hooks.on('dx3rd.rollCancelled', dropPreview);
  Hooks.once('ready', async () => {
    const stale = game.messages.filter(message =>
      message.getFlag('dx3rd-emanim', 'rollInterventionPreview'));
    if (stale.length) await ChatMessage.deleteDocuments(stale.map(message => message.id));
  });

  // 선(先) 보정 — 「대상이 판정을 실행하기 직전에 사용할 것」. 이 시점에는 눈이 없으므로 다이스
  // 선택도 임시 굴림값 미리보기도 없다. 카드가 말한 조작과 값이 선언의 전부다.
  window.DX3rdRollInterventions.register('beforeRoll', async context => {
    const entries = candidates(context);
    if (!entries.length) return null;
    const automatic = entries.find(entry => entry.config.automatic);
    if (automatic) {
      return {
        type: automatic.config.operation,
        value: await resolveValue(automatic.config, automatic.item, automatic.actor),
        floor: resolveFloor(automatic.config, automatic.item, automatic.actor),
        sourceActorId: automatic.actor.id,
        sourceItemId: automatic.item.id,
        sourceGroup: cleanName(automatic.item)
      };
    }
    if (!context.interactive) return null;
    const manual = entries.filter(entry => !entry.config.automatic);
    if (!manual.length) return null;
    const selectedIndex = await chooseCandidate(manual, context);
    if (!Number.isInteger(selectedIndex)) return null;
    const entry = manual[selectedIndex];
    if (!await spend(entry, context)) return null;
    return {
      type: entry.config.operation,
      value: await resolveValue(entry.config, entry.item, entry.actor),
      floor: resolveFloor(entry.config, entry.item, entry.actor),
      sourceActorId: entry.actor.id,
      sourceItemId: entry.item.id
    };
  }, {priority: 100});

  window.DX3rdRollInterventions.register('afterRoll', async context => {
    if (!context.interactive) return null;
    const entries = candidates(context).filter(entry => !entry.config.automatic);
    if (!entries.length) return null;
    await ensurePreview(context);
    const selectedIndex = await chooseCandidate(entries, context);
    if (!Number.isInteger(selectedIndex)) return null;
    const entry = entries[selectedIndex];
    const operation = await chooseValue(entry.config, entry.item, entry.actor);
    if (!operation) return null;
    let dice = [];
    if (['rerollSelected', 'setFaces', 'adjustFaces'].includes(operation.type)) {
      dice = await chooseDice(context, entry.config, entry.item, entry.actor);
      if (!dice?.length) return null;
    }
    if (!await spend(entry, context)) return null;
    // 사용자에게 직접 물은 갈래(1/10 선택·±1 선택)는 이미 값을 들고 있다. 그 밖은 지금 평가한다 —
    // 다이스식이면 여기서 정확히 한 번 굴린다.
    const value = operation.value ?? await resolveValue(entry.config, entry.item, entry.actor);
    return {
      ...operation,
      value,
      floor: resolveFloor(entry.config, entry.item, entry.actor),
      dice,
      sourceActorId: entry.actor.id,
      sourceItemId: entry.item.id
    };
  }, {priority: 100});

  async function handleRemoteUseRequest(data) {
    const payload = data.payload || {};
    const actor = canvas.tokens?.placeables?.find(token => token.id === payload.sourceTokenId)?.actor
      || game.actors.get(payload.sourceActorId)
      || canvas.tokens?.placeables?.find(token => token.actor?.id === payload.sourceActorId)?.actor;
    if (!window.DX3rdSocketRouter.isActorExecutorMessage(data, actor)) return;
    const item = actor.items.get(payload.sourceItemId);
    const requiredItem = payload.requiredItemId ? actor.items.get(payload.requiredItemId) : null;
    let approved = false;
    if (item) {
      approved = await foundry.applications.api.DialogV2.confirm({
        window: {title: game.i18n.localize('DX3rd.RollInterventionApprovalTitle')},
        content: `<p>${game.i18n.format('DX3rd.RollInterventionApprovalPrompt', {
          actor: actor.name,
          item: item.name
        })}</p>`
      });
      if (approved) {
        approved = await spendLocal({actor, item, requiredItem}, {
          subtype: payload.rollType,
          generation: 0,
          history: []
        });
      }
    }
    window.DX3rdSocketRouter.emit({
      type: 'respondRollInterventionUse',
      payload: {
        requestKey: payload.requestKey,
        requesterUserId: payload.requesterUserId,
        sourceActorId: payload.sourceActorId,
        approved: !!approved
      }
    });
  }

  function handleRemoteUseResponse(data) {
    const payload = data.payload || {};
    if (payload.requesterUserId !== game.user.id) return;
    pendingRemoteUses.get(payload.requestKey)?.(!!payload.approved);
  }

  window.DX3rdRollInterventionEffects = Object.freeze({
    itemConfig,
    modifierConfig,
    itemConfigs,
    resolveValue,
    previewValue,
    resolveFloor,
    candidates,
    chooseDice,
    handleRemoteUseRequest,
    handleRemoteUseResponse
  });
})();
