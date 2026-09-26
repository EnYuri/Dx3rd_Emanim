(function () {
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
      const executorId = window.DX3rdSocketRouter?.getResponsibleActorExecutor?.(actor)?.id || null;
      if (!executorId) continue;
      seen.add(key);
      actors.push({actor, tokenId: token.id, executorId});
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
      // 전제는 이름 매칭으로 저작한다 — 액터가 같은 이름의 아이템을 여러 벌 들고 있어도
      // 어느 쪽이 쓰였든 선사용·소비 판정이 성립해야 하므로 전부 모은다.
      const matches = Array.from(actor.items || [])
        .filter(candidate => cleanName(candidate) === config.requiredItem);
      if (!matches.length) return false;
      const exhausted = candidate => window.DX3rdItemExhausted?.isItemExhausted?.(candidate);
      // 전제의 소비는 실제 아이템 사용이다 — 소진된 사본은 후보 자신과 같은 규칙으로 막힌다
      // (월드 설정이 막을 때만). 지불 가능한 사본이 하나도 없으면 전제 위에 리미트는 설 수 없다.
      const spendable = candidate =>
        !exhausted(candidate) || window.DX3rdItemExhausted?.allowExhaustedUse?.() !== false;
      // 사용 기록과 판정당 한도는 사본별로 센다 — 후보 자신의 판정도 item id 단위이므로,
      // 같은 이름의 다른 사본이 쓰인 것이 이 사본의 잔여분을 갉아먹으면 모순된다.
      const usesOf = candidate => context.history.filter(record =>
        record.sourceActorId === actor.id && record.sourceItemId === candidate.id).length;
      // 이 사본이 이번 판정에 한 번 더 쓰일 수 있는가. 개입 카드가 없는 전제는 상시 전제
      // (소지 조건)이므로 판정당 한도를 두지 않는다.
      const roomLeft = candidate => {
        const max = Math.max(0, ...itemConfigs(candidate).map(card => Number(card.perRollMax) || 1));
        return !max || usesOf(candidate) < max;
      };
      if (config.requiresPriorUse) {
        // 「선사용 필요」(요정의 고리)는 전제가 이미 쓰였어야 성립하고, 그 다음 소비는
        // 이펙트가 명시적으로 부여하는 「한 번 더」다 — 전제 자신의 판정 한도는 보지 않는다.
        if (!matches.some(usesOf)) return false;
        // 한 번 더 쓰는 대상은 쓰인 사본이 자연스럽지만, 그 사본이 지불 불가면(엄격 모드에서
        // 소진 등) 아직 쓸 수 있는 다른 사본이 소비된다.
        entry.requiredItem = matches.find(candidate => spendable(candidate) && usesOf(candidate))
          || matches.find(spendable);
      } else {
        // 「전제와 동시에 사용」(절대지배→지배의 영역)은 전제 사본 하나의 판정당 사용을 하나
        // 소비한다 — 지불 가능한 사본이 하나도 없으면(전부 소진됐거나 각자의 판정당 한도를
        // 다 썼으면) 조합이 성립하지 않는다.
        entry.requiredItem = matches.find(candidate => spendable(candidate) && roomLeft(candidate));
      }
      if (!entry.requiredItem) return false;
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
    for (const {actor, tokenId, executorId} of ownedActors(context)) {
      for (const item of actor.items || []) {
        for (const config of itemConfigs(item)) entries.push({actor, tokenId, executorId, item, config});
      }
    }
    return entries.filter(entry => applies(entry, context));
  }

  // ── 선언은 그 액터를 맡은 클라이언트가 한다 ────────────────────────────────
  // GM 은 모든 액터의 OWNER 라, 후보를 굴리는 클라이언트 한 곳에 모으면 굴림마다 씬
  // 전원의 선언 목록이 GM 화면에 뜨고 — 게다가 `spend` 가 `isGM` 이면 로컬 소비라
  // GM 이 남의 이펙트를 소유자에게 묻지도 않고 써 버렸다. 그래서 후보는 **책임
  // 실행자별로** 나눈다 — 내 몫만 내 화면에 뜨고, 남의 몫은 굴림이 멈춰 있는 동안
  // 그 클라이언트에 제안으로 간다(`rollInterventionOffer`).
  function splitCandidates(context) {
    const entries = candidates(context).filter(entry => !entry.config.automatic);
    const mine = [];
    const remote = new Map();
    for (const entry of entries) {
      if (entry.executorId === game.user?.id) {
        mine.push(entry);
        continue;
      }
      // 응답할 사람이 없는 제안은 굴림을 세우기만 한다. (비활성 실행자는 애초에
      // getResponsibleActorExecutor 가 고르지 않지만, 선거와 전송 사이에 나갈 수 있다.)
      if (!game.users?.get(entry.executorId)?.active) continue;
      if (!remote.has(entry.actor.id)) {
        remote.set(entry.actor.id, {actor: entry.actor, tokenId: entry.tokenId, executorId: entry.executorId});
      }
    }
    return {mine, remote: Array.from(remote.values())};
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

  // '결과 확정' 계열 버튼 안쪽 오른쪽에 남은 시간(초)을 카운트다운으로 심고, 만료되면 그 버튼을
  // 누른 것과 같은 결과로 접는다. 어느 창이든 한 번 조작되면 굴림 쪽이 'engaged' 를 뿌려 모든
  // 창의 카운터를 거두므로, 반환하는 disarm 을 그 통지에 묶는다.
  function attachCountdown(dialog, settle, {timeoutMs = 0, action = 'finish', result = {type: 'finish'}} = {}) {
    let timer = null;
    let armed = true;
    const disarm = () => {
      armed = false;
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
      dialog.element?.querySelector?.('.dx3rd-roll-intervention-countdown')?.remove();
    };
    // 어떤 경로로든 창이 닫히면 남은 틱도 같이 거둔다 — 떼어진 span 에 매초 쓰다가 마감에
    // 이미 resolve 된 promise 를 다시 깨우는 일이 없게.
    dialog.addEventListener?.('close', disarm, {once: true});
    void Promise.resolve(dialog.render({force: true})).then(() => {
      if (!armed || !(timeoutMs > 0) || !dialog.rendered) return;
      const button = dialog.element?.querySelector?.(`button[data-action="${action}"]`)
        || Array.from(dialog.element?.querySelectorAll?.('footer button') || []).pop();
      if (!button) return;
      const marker = document.createElement('span');
      marker.className = 'dx3rd-roll-intervention-countdown';
      button.appendChild(marker);
      const deadline = Date.now() + timeoutMs;
      const tick = () => {
        const left = Math.ceil((deadline - Date.now()) / 1000);
        if (left > 0) {
          marker.textContent = `(${left}초)`;
          return;
        }
        disarm();
        settle(result);
        if (dialog.rendered) void dialog.close();
      };
      tick();
      timer = setInterval(tick, 250);
    }).catch(() => {});
    return disarm;
  }

  // 후보 창은 **원격 선언이 도착하면 닫아야** 하므로 `DialogV2.wait` 대신 인스턴스를 직접
  // 들고 있는다. wait 이 하는 일(제출/닫힘을 하나의 Promise 로 접기)을 그대로 하되 close 핸들을
  // 함께 돌려준다 — 굴림은 로컬 선택과 원격 선언 중 먼저 오는 쪽으로 결정된다.
  function openCandidateDialog(entries, context, {remote = [], rollerName = '', timeoutMs = 0} = {}) {
    const DialogV2 = foundry.applications?.api?.DialogV2;
    if (!DialogV2) return {promise: Promise.resolve({type: 'finish'}), close: () => {}, disarm: () => {}};
    const before = context?.phase === 'beforeRoll';
    let settle;
    const promise = new Promise(resolve => {
      settle = resolve;
    });
    const buttons = entries.map((entry, index) => ({
      action: `use-${index}`,
      label: `${entry.item.name} — ${entry.actor.name}${describeEntry(entry)}`,
      callback: () => ({type: 'local', index})
    }));
    buttons.push({
      action: 'finish',
      label: game.i18n.localize(before ? 'DX3rd.RollModifierProceed' : 'DX3rd.RollInterventionFinish'),
      default: true,
      callback: () => ({type: 'finish'})
    });
    const prompt = before
      ? game.i18n.format('DX3rd.RollModifierPrompt', {actor: context?.actor?.name || ''})
      : game.i18n.localize('DX3rd.RollInterventionPrompt');
    const header = rollerName
      ? `<p class="dx3rd-roll-intervention-remote">${
        game.i18n.format('DX3rd.RollInterventionRemotePrompt', {actor: rollerName})}</p>`
      : '';
    const waiting = remote.length
      ? `<p class="dx3rd-roll-intervention-waiting">${
        game.i18n.format('DX3rd.RollInterventionWaiting', {names: remote.map(t => t.actor.name).join(', ')})}</p>`
      : '';
    const dialog = new DialogV2({
      window: {title: game.i18n.localize(before ? 'DX3rd.RollModifierTitle' : 'DX3rd.RollInterventionTitle')},
      position: {width: 640, height: 'auto'},
      content: `${header}<p>${prompt}</p>${before ? poolSummary(context) : ''}${waiting}`,
      classes: ['dx3rd-roll-intervention-dialog'],
      buttons,
      submit: result => settle(result && typeof result === 'object' ? result : {type: 'finish'})
    });
    // X 로 닫는 것은 「그대로 진행」이다. 제출이 먼저 resolve 했으면 이 호출은 무시된다.
    dialog.addEventListener('close', () => settle({type: 'finish'}), {once: true});
    const disarm = attachCountdown(dialog, settle, {timeoutMs, action: 'finish', result: {type: 'finish'}});
    return {
      promise,
      disarm,
      close: () => {
        disarm();
        if (dialog.rendered) dialog.close();
      }
    };
  }

  // 개입 후보가 없는 책임 GM 에게 뜨는 관전 창. 후보 버튼 없이 「결과 확정」만 있고, 누르면
  // 라운드를 끝내 달라고 굴림 쪽에 청한다(declare 'finish'). X 로 닫는 것은 지켜보기를
  // 그만둘 뿐이라 라운드에 영향을 주지 않는다.
  function openObserverDialog(snapshot) {
    const DialogV2 = foundry.applications?.api?.DialogV2;
    if (!DialogV2) return {promise: Promise.resolve({type: 'dismiss'}), close: () => {}, disarm: () => {}};
    const before = snapshot?.phase === 'beforeRoll';
    let settle;
    const promise = new Promise(resolve => {
      settle = resolve;
    });
    const names = Array.isArray(snapshot?.waitingNames) ? snapshot.waitingNames.filter(Boolean) : [];
    const waiting = names.length
      ? `<p class="dx3rd-roll-intervention-waiting">${
        game.i18n.format('DX3rd.RollInterventionWaiting', {names: names.join(', ')})}</p>`
      : '';
    const dialog = new DialogV2({
      window: {title: game.i18n.localize(before ? 'DX3rd.RollModifierTitle' : 'DX3rd.RollInterventionTitle')},
      position: {width: 640, height: 'auto'},
      content: `<p class="dx3rd-roll-intervention-remote">${
        game.i18n.format('DX3rd.RollInterventionObserverPrompt', {actor: snapshot?.rollerActorName || ''})
      }</p>${waiting}`,
      classes: ['dx3rd-roll-intervention-dialog'],
      buttons: [{
        action: 'confirm',
        label: game.i18n.localize(before ? 'DX3rd.RollModifierProceed' : 'DX3rd.RollInterventionFinish'),
        default: true,
        callback: () => ({type: 'confirm'})
      }],
      submit: result => settle(result && typeof result === 'object' ? result : {type: 'dismiss'})
    });
    dialog.addEventListener('close', () => settle({type: 'dismiss'}), {once: true});
    const disarm = attachCountdown(dialog, settle, {
      timeoutMs: Number(snapshot?.timeoutMs) || 0,
      action: 'confirm',
      result: {type: 'confirm'}
    });
    return {
      promise,
      disarm,
      close: () => {
        disarm();
        if (dialog.rendered) dialog.close();
      }
    };
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
        // 개수 상한은 확인 후 경고하고 다시 묻는 대신 **선택 시점**에 막는다 — 최대치에
        // 닿으면 아직 고르지 않은 체크박스를 비활성화해 그 이상 고를 수 없게 한다.
        render: (_event, dialog) => {
          const boxes = Array.from(dialog.element?.querySelectorAll?.('input[name="die"]') || []);
          if (boxes.length <= max) return;
          const applyCap = () => {
            const full = boxes.filter(box => box.checked).length >= max;
            for (const box of boxes) box.disabled = full && !box.checked;
          };
          for (const box of boxes) box.addEventListener('change', applyCap);
          applyCap();
        },
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
    // 리미트 이펙트의 사용 흐름은 「선행 이펙트 사용·적용 → 리미트 이펙트 사용·적용」이다.
    // 전제는 이 선언 안에서 실제로 소비되어야 하므로 먼저 지불하고, 지불이 끝난 시점에
    // 「이번 판정에 사용됐다」는 기록도 곧바로 남긴다 — 후보 쪽 지불이 실패해도 전제는
    // 이미 쓰인 상태로 남는 것이 룰 흐름이고, 기록이 없으면 재시도 때 전제를 다시 소비한다.
    if (entry.requiredItem) {
      if (!await spendItem(entry.requiredItem)) return false;
      context.history.push({
        type: 'requiredItem',
        sourceActorId: entry.actor.id,
        sourceItemId: entry.requiredItem.id,
        generation: context.generation,
        value: null,
        dice: []
      });
    }
    if (!await spendItem(entry.item)) return false;
    return true;
  }

  // 후보는 「내가 책임 실행자인 액터」로 이미 좁혀져 있으므로 여기 오는 것은 전부 내가 소비할 수
  // 있는 것이다. 남의 액터 몫은 제안으로 그 클라이언트가 **직접** 소비한다 — GM 이 남의 이펙트를
  // 대신 쓰던 경로(구 requestRollInterventionUse)는 그래서 사라졌다.
  async function spend(entry, context) {
    return spendLocal(entry, context);
  }

  // 선택만 끝내고 **소비는 하지 않는다.** 원격 선언은 경합에서 밀릴 수 있어서, 자리를 잡기
  // (claim) 전에 비용을 내면 적용되지 않는 선언에 값만 치른다.
  async function prepareCommand(entry, context) {
    if (context.phase === 'beforeRoll') return {type: entry.config.operation, dice: null};
    const operation = await chooseValue(entry.config, entry.item, entry.actor);
    if (!operation) return null;
    if (['rerollSelected', 'setFaces', 'adjustFaces'].includes(operation.type)) {
      const dice = await chooseDice(context, entry.config, entry.item, entry.actor);
      if (!dice?.length) return null;
      return {...operation, dice};
    }
    return {...operation, dice: []};
  }

  // 값 평가는 **소비가 끝난 뒤** 정확히 한 번 — 다이스식이면 여기서 굴린다.
  async function finalizeCommand(entry, context, prepared) {
    const value = prepared.value ?? await resolveValue(entry.config, entry.item, entry.actor);
    const command = {
      type: prepared.type,
      value,
      floor: resolveFloor(entry.config, entry.item, entry.actor),
      sourceActorId: entry.actor.id,
      sourceItemId: entry.item.id
    };
    if (Array.isArray(prepared.dice)) command.dice = prepared.dice;
    return command;
  }

  const COMMAND_TYPES = new Set(['rerollAll', 'rerollSelected', 'setFaces', 'adjustFaces',
    'adjustDice', 'setDice', 'adjustCritical', 'replaceTotal', 'adjustTotal']);

  // 원격 커맨드는 다른 클라이언트가 보낸 **데이터**다. 그대로 적용하지 않고 형태를 강제한다.
  function sanitizeCommand(raw, sourceActorId) {
    if (!raw || typeof raw !== 'object' || !COMMAND_TYPES.has(raw.type)) return null;
    const asIndex = value => (Number.isInteger(value) ? value : null);
    return {
      type: raw.type,
      value: raw.value == null ? null : (Number(raw.value) || 0),
      floor: raw.floor == null ? null : (Number(raw.floor) || 0),
      dice: Array.isArray(raw.dice)
        ? raw.dice.map(die => ({
          kind: die?.kind === 'dx' ? 'dx' : 'standard',
          termIndex: asIndex(die?.termIndex),
          waveIndex: asIndex(die?.waveIndex),
          dieIndex: asIndex(die?.dieIndex)
        })).filter(die => Number.isInteger(die.dieIndex))
        : [],
      sourceActorId,
      sourceItemId: typeof raw.sourceItemId === 'string' ? raw.sourceItemId : null
    };
  }

  function serializeCommand(command) {
    return {
      type: command.type,
      value: command.value ?? null,
      floor: command.floor ?? null,
      dice: (command.dice || []).map(({kind, termIndex, waveIndex, dieIndex}) => ({
        kind: kind === 'dx' ? 'dx' : 'standard',
        termIndex: Number.isInteger(termIndex) ? termIndex : null,
        waveIndex: Number.isInteger(waveIndex) ? waveIndex : null,
        dieIndex: Number.isInteger(dieIndex) ? dieIndex : null
      })),
      sourceItemId: command.sourceItemId || null
    };
  }

  function resolveOfferActor(actorId, tokenId) {
    return canvas.tokens?.placeables?.find(token => token.id === tokenId)?.actor
      || game.actors.get(actorId)
      || canvas.tokens?.placeables?.find(token => token.actor?.id === actorId)?.actor
      || null;
  }

  // ── 굴림 클라이언트: 제안을 내고 선언을 기다린다 ──────────────────────────
  const OFFER_TIMEOUT_MS = 120000;
  const COMMIT_TIMEOUT_MS = 60000;
  const rounds = new Map();

  // 자동 확정 — 아무도 창을 조작하지 않으면 굴림이 그 자리에 멈추므로, 월드 설정이 켜져 있을
  // 때 '결과 확정' 버튼에 카운터를 띄워 만료되면 눌린 것으로 친다. 어느 창이든 한 번
  // 조작되면 카운터는 전부 내려간다.
  function autoConfirmMs() {
    try {
      if (game.settings?.get?.('dx3rd-emanim', 'rollInterventionAutoConfirm') === false) return 0;
      const seconds = Number(game.settings?.get?.('dx3rd-emanim', 'rollInterventionAutoConfirmSeconds'));
      return Number.isFinite(seconds) && seconds > 0 ? Math.round(seconds * 1000) : 0;
    } catch {
      return 0;
    }
  }

  // 제안에는 원격 클라이언트가 **같은 후보 판정과 같은 선택 UI** 를 돌리기 위한 것만 담는다.
  // Roll 자체는 보내지 않는다 — 다이스 선택 창에 필요한 것은 눈의 목록뿐이고, 적용은 굴림을
  // 들고 있는 이쪽에서 참조(waveIndex/dieIndex)로 한다.
  function offerSnapshot(context) {
    const dice = window.DX3rdRollInterventions.availableDice(context) || [];
    return {
      rollId: context.rollId || null,
      generation: context.generation || 0,
      phase: context.phase,
      kind: context.kind || 'misc',
      subtype: context.subtype || null,
      skillKey: context.skillKey || null,
      isAttackRoll: !!context.metadata?.isAttackRoll,
      rollerActorName: context.actor?.name || '',
      rollerActorId: context.actor?.id || null,
      rollItemId: context.item?.id || null,
      combinedIds: window.DX3rdUniversalHandler?.normalizeEffectIds?.(context.item) || [],
      pool: context.pool
        ? {dice: context.pool.dice, critical: context.pool.critical ?? null, isDx: !!context.pool.isDx}
        : null,
      dice: dice.map(die => ({
        kind: die.kind === 'dx' ? 'dx' : 'standard',
        termIndex: Number.isInteger(die.termIndex) ? die.termIndex : null,
        waveIndex: Number.isInteger(die.waveIndex) ? die.waveIndex : null,
        dieIndex: die.dieIndex,
        result: die.result,
        faces: die.faces,
        critical: !!die.critical
      })),
      history: (context.history || []).map(record => ({...record}))
    };
  }

  function sendOffer(context, target, roundKey, stage, extra = {}) {
    return window.DX3rdSocketRouter?.emitToActorExecutor?.({
      type: 'rollInterventionOffer',
      payload: {
        stage,
        roundKey,
        requesterUserId: game.user.id,
        // 계약의 발신자 권한은 **굴리는 액터**를 기준으로 본다. 액터 없는 굴림은 GM 만
        // 내보낼 수 있고(GM 은 어느 액터든 통제한다), 그 밖에는 여기서 조용히 거절된다.
        rollerActorId: context.actor?.id || target.actor.id,
        sourceActorId: target.actor.id,
        sourceTokenId: target.tokenId || null,
        ...extra
      }
    }, target.actor);
  }

  // 관전 창은 책임 GM 한 사람에게만 간다. executorUserId 를 직접 지목해 브로드캐스트로
  // 보내면 나머지 클라이언트는 받아도 실행자 검사(`isActorExecutorMessage`)에서 걸러진다.
  // 계약의 발신자 권한은 굴리는 액터 기준이므로 sourceActorId 에도 그 id 를 실어 보낸다.
  function emitObserver(state, stage, extra = {}) {
    const userId = state?.observer?.userId;
    if (!userId) return;
    const rollerActorId = state.context?.actor?.id || null;
    window.DX3rdSocketRouter?.emit?.({
      type: 'rollInterventionOffer',
      executorUserId: userId,
      payload: {
        stage,
        roundKey: state.roundKey,
        requesterUserId: game.user.id,
        rollerActorId,
        sourceActorId: rollerActorId,
        ...extra
      }
    });
  }

  function beginRound(context, remote, hasLocalChoices, timeoutMs = 0) {
    const roundKey = `${context.rollId || 'roll'}-${context.phase}-${context.generation}-${context.revision}`;
    const state = {
      roundKey,
      context,
      hasLocalChoices,
      targets: new Map(remote.map(target => [target.actor.id, target])),
      observer: null,
      claimedBy: null,
      engaged: false,
      timer: null,
      autoTimer: null,
      disarm: null,
      settle: null
    };
    state.promise = new Promise(resolve => {
      state.settle = resolve;
    });
    rounds.set(roundKey, state);
    // 120초 망은 「굴림이 영영 멈추지 않는다」는 보장이다 — 카운터가 해제된 뒤에도 남긴다.
    state.timer = setTimeout(() => finishRound(roundKey, {type: 'finish'}), OFFER_TIMEOUT_MS);
    if (timeoutMs > 0) {
      state.autoTimer = setTimeout(() => finishRound(roundKey, {type: 'finish'}), timeoutMs);
    }
    const snapshot = offerSnapshot(context);
    // 원격·관전 창도 같은 시한으로 각자의 카운터를 돌린다 — 발표는 표시용이고 권한은
    // 굴림 쪽의 autoTimer/버튼에 있다.
    snapshot.timeoutMs = timeoutMs;
    for (const target of state.targets.values()) sendOffer(context, target, roundKey, 'offer', {snapshot});
    // 책임 GM 은 개입 후보가 없어도 진행을 보고 「결과 확정」을 누를 수 있어야 한다. 이미
    // 후보 실행자거나 굴림 당사자면 그쪽 창이 같은 역할을 하므로 관전은 보내지 않는다.
    const gm = window.DX3rdSocketRouter?.getResponsibleGM?.();
    if (gm?.active && gm.id !== game.user?.id && context.actor?.id
      && !remote.some(target => target.executorId === gm.id)) {
      state.observer = {userId: gm.id};
      emitObserver(state, 'observe', {
        snapshot: {
          phase: context.phase,
          rollerActorName: context.actor?.name || '',
          waitingNames: remote.map(target => target.actor.name),
          timeoutMs
        }
      });
    }
    return state;
  }

  // 「어느 창이든 한 번 조작되면 모든 대기 카운터가 내려간다」— 선언을 시작한 클라이언트의
  // 'engage'(또는 도착한 'claim')가 여기로 온다. 라운드 자체는 그 선언이 commit/withdraw 로
  // 끝나거나 GM 이 확정할 때까지 기다린다.
  function disarmRound(state) {
    if (state.engaged) return;
    state.engaged = true;
    if (state.autoTimer) {
      clearTimeout(state.autoTimer);
      state.autoTimer = null;
    }
    state.disarm?.();
    for (const target of state.targets.values()) {
      sendOffer(state.context, target, state.roundKey, 'engaged');
    }
    emitObserver(state, 'engaged');
  }

  function finishRound(roundKey, outcome, {except = null} = {}) {
    const state = rounds.get(roundKey);
    if (!state) return;
    rounds.delete(roundKey);
    clearTimeout(state.timer);
    if (state.autoTimer) clearTimeout(state.autoTimer);
    for (const target of state.targets.values()) {
      if (target.actor.id === except) continue;
      sendOffer(state.context, target, roundKey, 'cancel');
    }
    emitObserver(state, 'cancel');
    state.settle(outcome);
  }

  function rejectClaim(payload) {
    const actor = resolveOfferActor(payload.sourceActorId, payload.sourceTokenId);
    if (!actor) return;
    window.DX3rdSocketRouter?.emitToActorExecutor?.({
      type: 'rollInterventionOffer',
      payload: {
        stage: 'reject',
        roundKey: payload.roundKey,
        requesterUserId: game.user.id,
        // 선언이 되돌려 준 굴림 액터를 그대로 쓴다. 계약의 발신자 권한이 그것을 보므로,
        // 여기서 선언자의 액터로 바꾸면 플레이어가 굴린 판정에서는 거절이 전달되지 않는다.
        rollerActorId: payload.rollerActorId || actor.id,
        sourceActorId: payload.sourceActorId,
        sourceTokenId: payload.sourceTokenId || null
      }
    }, actor);
  }

  function handleDeclaration(data) {
    const payload = data.payload || {};
    if (payload.requesterUserId !== game.user?.id) return;
    const state = rounds.get(payload.roundKey);
    const target = state?.targets.get(payload.sourceActorId);
    if (payload.stage === 'finish') {
      // 책임 GM 의 강제 확정 — 소켓 계약이 발신자를 GM 한정으로 묶는다.
      const sender = data.senderId ? game.users?.get?.(data.senderId) : null;
      if (sender && !sender.isGM) return;
      finishRound(payload.roundKey, {type: 'finish'});
      return;
    }
    if (payload.stage === 'engage') {
      // 어느 창이든 한 번 조작되면 모든 대기 카운터가 내려간다.
      if (!state || !target) return;
      disarmRound(state);
      return;
    }
    if (payload.stage === 'decline') {
      if (!state || !target) return;
      state.targets.delete(payload.sourceActorId);
      // 로컬 후보가 없으면 이 창은 순전히 대기창이다 — 전원이 물러났으면 그 자리에서 닫는다.
      if (!state.targets.size && !state.hasLocalChoices && !state.claimedBy) {
        finishRound(payload.roundKey, {type: 'finish'});
      }
      return;
    }
    if (payload.stage === 'claim') {
      // 자리를 잡지 못한 선언에는 **소비 전에** 거절을 돌려준다.
      if (!state || !target || state.claimedBy) {
        rejectClaim(payload);
        return;
      }
      state.claimedBy = payload.sourceActorId;
      // 자리를 잡았다 = 조작이다 — 어느 경로로 왔든 대기 카운터를 거둔다.
      disarmRound(state);
      clearTimeout(state.timer);
      state.timer = setTimeout(() => finishRound(payload.roundKey, {type: 'finish'}), COMMIT_TIMEOUT_MS);
      for (const other of state.targets.values()) {
        if (other.actor.id === payload.sourceActorId) continue;
        sendOffer(state.context, other, payload.roundKey, 'cancel');
      }
      sendOffer(state.context, target, payload.roundKey, 'accept');
      return;
    }
    if (payload.stage !== 'commit') return;
    if (!state || state.claimedBy !== payload.sourceActorId) return;
    const command = payload.ok ? sanitizeCommand(payload.command, payload.sourceActorId) : null;
    // 비용을 내지 못한 선언은 라운드를 무르고 다시 제안한다 — 지불에 실패했다는 이유로
    // 남은 사람의 개입 기회까지 사라지면 안 된다.
    finishRound(payload.roundKey,
      command
        ? {type: 'remote', command, requiredItemId: payload.requiredItemId || null}
        : {type: 'retry'},
      {except: payload.sourceActorId});
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

  // 한 굴림의 한 시점에서 도는 대화 루프. 내 몫은 이 자리에서 묻고, 남의 몫은 그 클라이언트에
  // 제안으로 보낸 뒤 **먼저 오는 쪽**을 취한다. 선언이 적용되면 위상 루프가 다시 돌아 갱신된
  // 상태로 다음 라운드를 연다.
  //
  // 선(先) 보정 — 「대상이 판정을 실행하기 직전에 사용할 것」 — 은 눈이 아직 없으므로 다이스
  // 선택도 임시 굴림값 미리보기도 없다. 카드가 말한 조작과 값이 선언의 전부다.
  async function runInteractivePhase(context) {
    if (!context.interactive) return null;
    const {mine, remote} = splitCandidates(context);
    if (!mine.length && !remote.length) return null;
    if (context.phase === 'afterRoll') await ensurePreview(context);

    const timeoutMs = autoConfirmMs();
    // 원격 후보가 없어도 라운드는 연다 — 책임 GM 의 관전 창과 강제 확정('finish')이
    // 로컬 선언에도 같은 손잡이를 가져야 하기 때문이다.
    const round = beginRound(context, remote, mine.length > 0, timeoutMs);
    // 창은 「지금 개입할 수 있는 사람」에게만 뜬다 — 후보가 없는 굴림 당사자에게 빈 대기창을
    // 띄우지 않는다(GM 은 심판이라 후보가 없어도 본다). 남의 선언이 걸려 있을 때 제3자 시야는
    // 책임 GM 의 관전 창이 담당한다(beginRound 의 observe 제안).
    const dialog = (mine.length || game.user?.isGM)
      ? openCandidateDialog(mine, context, {remote, timeoutMs})
      : null;
    // 원격 선언 시작('engage')이 오면 이 창의 카운터도 함께 거둔다.
    round.disarm = dialog?.disarm || null;
    const outcome = await (dialog ? Promise.race([dialog.promise, round.promise]) : round.promise);
    dialog?.close();
    // 이 라운드는 여기서 끝난다. 아직 답하지 않은 클라이언트의 창은 닫히고, 커맨드가 적용되면
    // 다음 라운드가 갱신된 상태로 곧바로 다시 제안한다.
    finishRound(round.roundKey, {type: 'finish'}, {except: outcome?.command?.sourceActorId || null});

    if (outcome?.type === 'remote') {
      const commands = [];
      if (outcome.requiredItemId) {
        commands.push({
          type: 'requiredItem',
          sourceActorId: outcome.command.sourceActorId,
          sourceItemId: outcome.requiredItemId,
          value: null,
          dice: []
        });
      }
      commands.push(outcome.command);
      return commands;
    }
    // 원격 선언이 비용을 내지 못했다. 라운드만 무르고 같은 시점을 다시 연다.
    if (outcome?.type === 'retry') return runInteractivePhase(context);
    if (outcome?.type !== 'local') return null;
    const entry = mine[outcome.index];
    if (!entry) return null;
    const prepared = await prepareCommand(entry, context);
    if (!prepared) return null;
    if (!await spend(entry, context)) return null;
    return finalizeCommand(entry, context, prepared);
  }

  window.DX3rdRollInterventions.register('beforeRoll', async context => {
    const automatic = candidates(context).find(entry => entry.config.automatic);
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
    return runInteractivePhase(context);
  }, {priority: 100});

  window.DX3rdRollInterventions.register('afterRoll', context => runInteractivePhase(context), {priority: 100});

  // ── 소유자 클라이언트: 제안을 받아 선언한다 ──────────────────────────────
  const offers = new Map();
  // 굴림 클라이언트가 사라져도 선언이 영영 매달려 있지 않게 한다(아직 아무것도 소비하지 않았다).
  const CLAIM_TIMEOUT_MS = 60000;

  // 제안에는 Roll 이 실려 오지 않는다. 후보 판정(`applies`)과 다이스 선택 창이 읽는 것만
  // 갖춘 대역 문맥을 세운다 — 굴림 자체는 보낸 쪽이 들고 있고, 선택은 참조로 돌아간다.
  function offerContext(snapshot) {
    return {
      rollId: snapshot.rollId || null,
      phase: snapshot.phase,
      kind: snapshot.kind,
      subtype: snapshot.subtype || null,
      skillKey: snapshot.skillKey || null,
      generation: snapshot.generation || 0,
      metadata: {isAttackRoll: !!snapshot.isAttackRoll},
      actor: {id: snapshot.rollerActorId || null, name: snapshot.rollerActorName || ''},
      item: {id: snapshot.rollItemId || null, system: {effectIds: snapshot.combinedIds || []}},
      history: Array.isArray(snapshot.history) ? snapshot.history : [],
      pool: snapshot.pool || null,
      diceSnapshot: Array.isArray(snapshot.dice) ? snapshot.dice : [],
      interactive: true,
      commands: []
    };
  }

  function declare(payload, actor, extra) {
    window.DX3rdSocketRouter?.emit?.({
      type: 'rollInterventionDeclare',
      payload: {
        roundKey: payload.roundKey,
        requesterUserId: payload.requesterUserId,
        rollerActorId: payload.rollerActorId || null,
        sourceActorId: actor.id,
        sourceTokenId: payload.sourceTokenId || null,
        ...extra
      }
    });
  }

  // 책임 GM 의 강제 확정 — 관전 창의 「결과 확정」과, GM 이 실행자인 후보 창의 같은 버튼이
  // 여기로 온다. 선언을 다는 액터가 없으므로 sourceActorId 없이 굴림 액터만 실어 보낸다.
  function declareFinish(payload) {
    window.DX3rdSocketRouter?.emit?.({
      type: 'rollInterventionDeclare',
      payload: {
        stage: 'finish',
        roundKey: payload.roundKey,
        requesterUserId: payload.requesterUserId,
        rollerActorId: payload.rollerActorId || null
      }
    });
  }

  // 책임 GM 의 관전 창 — 후보는 보여 주지 않고 「결과 확정」으로 라운드를 끝낼 수 있다.
  // 창을 닫아(X/관전 해제) 라운드에는 아무 영향이 없다.
  async function observeOffer(payload) {
    const dialog = openObserverDialog(payload.snapshot);
    const state = {observer: true, close: dialog.close, disarm: dialog.disarm, cancelled: false, settleAccept: null};
    offers.set(payload.roundKey, state);
    const choice = await dialog.promise;
    if (state.cancelled) return;
    offers.delete(payload.roundKey);
    if (choice?.type === 'confirm') declareFinish(payload);
  }

  async function handleOffer(data) {
    const payload = data.payload || {};
    const actor = resolveOfferActor(payload.sourceActorId, payload.sourceTokenId);
    if (!window.DX3rdSocketRouter.isActorExecutorMessage(data, actor)) return;
    const open = offers.get(payload.roundKey);
    if (payload.stage === 'engaged') {
      // 다른 클라이언트가 선언을 시작했다 — 이 창의 대기 카운터도 거둔다(창은 닫지 않는다).
      open?.disarm?.();
      return;
    }
    if (payload.stage === 'cancel' || payload.stage === 'reject') {
      if (!open) return;
      offers.delete(payload.roundKey);
      open.cancelled = true;
      // 선택 도중이든 자리를 기다리는 중이든 같은 자물쇠 하나를 푼다 — 이 promise 를 창을 연
      // 뒤에 만들면, 취소가 선택보다 먼저 올 때 그 대기가 영영 풀리지 않는다.
      open.settleAccept?.(false);
      open.close?.();
      if (payload.stage === 'reject') {
        ui.notifications.info(game.i18n.localize('DX3rd.RollInterventionSuperseded'));
      }
      return;
    }
    if (payload.stage === 'accept') {
      open?.settleAccept?.(true);
      return;
    }
    if (payload.stage === 'observe') {
      if (open || !payload.snapshot) return;
      return observeOffer(payload);
    }
    if (payload.stage !== 'offer' || !payload.snapshot || open) return;

    const context = offerContext(payload.snapshot);
    const entries = candidates(context).filter(entry =>
      entry.actor.id === actor.id && !entry.config.automatic);
    if (!entries.length) {
      declare(payload, actor, {stage: 'decline'});
      return;
    }
    const dialog = openCandidateDialog(entries, context, {
      rollerName: payload.snapshot.rollerActorName,
      timeoutMs: Number(payload.snapshot.timeoutMs) || 0
    });
    const state = {close: dialog.close, disarm: dialog.disarm, cancelled: false, settleAccept: null};
    state.accepted = new Promise(resolve => {
      state.settleAccept = resolve;
    });
    offers.set(payload.roundKey, state);
    const withdraw = () => {
      offers.delete(payload.roundKey);
      declare(payload, actor, {stage: 'decline'});
    };

    const choice = await dialog.promise;
    if (state.cancelled) return;
    if (choice?.type !== 'local') {
      // GM 의 '결과 확정'·창 닫기는 자기 몫을 내리는 것이 아니라 라운드 전체를 닫는다.
      if (game.user?.isGM) {
        offers.delete(payload.roundKey);
        declareFinish(payload);
        return;
      }
      return withdraw();
    }
    const entry = entries[choice.index];
    if (!entry) return withdraw();
    // 어느 창이든 한 번 조작되면 모든 대기 카운터가 내려간다 — 선언 시작을 굴림 쪽에 알린다.
    declare(payload, actor, {stage: 'engage'});
    const prepared = await prepareCommand(entry, context);
    if (state.cancelled) return;
    if (!prepared) return withdraw();

    // 값·다이스까지 정한 뒤 **소비 전에** 자리를 잡는다. 경합에서 밀리면 비용이 나가지 않는다.
    declare(payload, actor, {stage: 'claim'});
    let claimTimer = null;
    const accepted = await Promise.race([
      state.accepted,
      new Promise(resolve => {
        claimTimer = setTimeout(() => resolve(false), CLAIM_TIMEOUT_MS);
      })
    ]);
    // 답이 왔으면 타이머를 놓아 준다. 남겨 두면 죽은 promise 를 깨우려고 1분을 더 붙잡는다.
    clearTimeout(claimTimer);
    if (!accepted) {
      offers.delete(payload.roundKey);
      return;
    }
    const spent = await spend(entry, context);
    const command = spent ? await finalizeCommand(entry, context, prepared) : null;
    offers.delete(payload.roundKey);
    declare(payload, actor, {
      stage: 'commit',
      ok: !!command,
      command: command ? serializeCommand(command) : null,
      requiredItemId: (spent && entry.requiredItem?.id) || null
    });
  }

  window.DX3rdRollInterventionEffects = Object.freeze({
    itemConfig,
    modifierConfig,
    itemConfigs,
    resolveValue,
    previewValue,
    resolveFloor,
    candidates,
    splitCandidates,
    chooseDice,
    handleOffer,
    handleDeclaration
  });
})();
