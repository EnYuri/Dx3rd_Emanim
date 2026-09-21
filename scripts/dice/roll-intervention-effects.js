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
    if (config.phase && config.phase !== 'afterRoll') return false;
    if (Array.isArray(config.kinds) && config.kinds.length && !config.kinds.includes(context.kind)) return false;
    if (Array.isArray(config.subtypes) && config.subtypes.length && !config.subtypes.includes(context.subtype)) return false;
    if (config.attackOnly
      && !context.metadata?.isAttackRoll
      && !['reaction', 'dodge'].includes(context.subtype)) return false;
    if (config.target === 'self' && actor?.id !== context.actor?.id) return false;
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
        const config = itemConfig(item);
        if (config) entries.push({actor, tokenId, item, config});
      }
    }
    return entries.filter(entry => applies(entry, context));
  }

  async function chooseCandidate(entries) {
    const DialogV2 = foundry.applications?.api?.DialogV2;
    if (!DialogV2 || !entries.length) return null;
    const buttons = entries.map((entry, index) => ({
      action: `use-${index}`,
      label: `${entry.item.name} — ${entry.actor.name}`,
      callback: () => index
    }));
    buttons.push({
      action: 'finish',
      label: game.i18n.localize('DX3rd.RollInterventionFinish'),
      default: true,
      callback: () => 'finish'
    });
    return DialogV2.wait({
      window: {title: game.i18n.localize('DX3rd.RollInterventionTitle')},
      position: {width: 640, height: 'auto'},
      content: `<p>${game.i18n.localize('DX3rd.RollInterventionPrompt')}</p>`,
      rejectClose: false,
      classes: ['dx3rd-roll-intervention-dialog'],
      buttons
    });
  }

  function resolveCount(raw, item, actor) {
    const value = window.DX3rdFormulaEvaluator?.evaluate
      ? window.DX3rdFormulaEvaluator.evaluate(String(raw ?? 1), item, actor)
      : Number(raw);
    return Math.max(1, Math.floor(Number(value) || 1));
  }

  async function chooseValue(config) {
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
    return {type: config.operation, value: config.value};
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
    const spendItem = async item => {
      const allowed = await window.DX3rdUniversalHandler?.processItemUsageCost?.(entry.actor, item, {
        action: 'use',
        rollType: context.subtype
      });
      if (allowed === false) return false;
      const disable = item.system?.used?.disable || 'notCheck';
      if (disable !== 'notCheck') {
        await item.update({'system.used.state': (Number(item.system.used?.state) || 0) + 1});
      }
      return true;
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

  async function ensurePreview(context) {
    const rollHtml = context.roll?.render
      ? (await context.roll.render()).replace('class="dice-roll"', 'class="dice-roll expanded"')
      : '';
    const content = `<div class="dx3rd-roll-intervention-preview-banner">${
      game.i18n.localize('DX3rd.RollInterventionPreview')}</div>${rollHtml}`;
    if (context.__previewMessage) {
      return context.__previewMessage.update({rolls: [context.roll], content});
    }
    context.__previewMessage = await ChatMessage.create({
      content,
      rolls: [context.roll],
      speaker: ChatMessage.getSpeaker({actor: context.actor}),
      flags: {'dx3rd-emanim': {rollInterventionPreview: true}}
    });
    return context.__previewMessage;
  }

  Hooks.on('dx3rd.rollFinalized', context => context.__previewMessage?.delete());
  Hooks.on('dx3rd.rollCancelled', context => context.__previewMessage?.delete());
  Hooks.once('ready', async () => {
    const stale = game.messages.filter(message =>
      message.getFlag('dx3rd-emanim', 'rollInterventionPreview'));
    if (stale.length) await ChatMessage.deleteDocuments(stale.map(message => message.id));
  });

  window.DX3rdRollInterventions.register('afterRoll', async context => {
    if (!context.interactive) return null;
    const entries = candidates(context).filter(entry => !entry.config.automatic);
    if (!entries.length) return null;
    await ensurePreview(context);
    const selectedIndex = await chooseCandidate(entries);
    if (!Number.isInteger(selectedIndex)) return null;
    const entry = entries[selectedIndex];
    const operation = await chooseValue(entry.config);
    if (!operation) return null;
    let dice = [];
    if (['rerollSelected', 'setFaces', 'adjustFaces'].includes(operation.type)) {
      dice = await chooseDice(context, entry.config, entry.item, entry.actor);
      if (!dice?.length) return null;
    }
    if (!await spend(entry, context)) return null;
    return {
      ...operation,
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
    candidates,
    chooseDice,
    handleRemoteUseRequest,
    handleRemoteUseResponse
  });
})();
