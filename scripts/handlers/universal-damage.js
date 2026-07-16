// Universal handler damage extension entry points.
(function() {
  const handler = window.DX3rdUniversalHandler;
  if (!handler) {
    console.error('DX3rd | Universal handler is unavailable for damage extensions.');
    return;
  }

// HP damage extension implementation.
/**
 * HP 데미지 익스텐션 실행
 * @param {Actor} actor - 사용자 액터
 * @param {Object} damageData - 데미지 데이터
 * @param {Item} item - 연동된 아이템 (옵션)
 */
handler.executeDamageExtension = async function(actor, damageData, item = null) {
  console.log('DX3rd | executeDamageExtension called', { actor: actor.name, damageData, item: item?.name });
  
  const { timing } = damageData;
  
  // afterMain, afterDamage, afterSuccess는 각 버튼/호출 지점에서 직접 큐에 등록하므로 여기서는 처리 안 함
  if (timing === 'afterMain' || timing === 'afterDamage' || timing === 'afterSuccess') {
    console.log(`DX3rd | ${timing} timing - will be handled by caller or button handler`);
    return;
  }
  
  // instant 타이밍이면 즉시 실행
  await this.executeDamageExtensionNow(actor, damageData, item);
};

/**
 * HP 데미지 조건부 공식 입력 다이얼로그 (호출한 클라이언트에만 표시)
 * @returns {Promise<{dice: string, add: string}|null>}
 */
handler.promptConditionalDamageFormula = async function() {
  return await new Promise(async (resolve) => {
    const dialogContent = `
      <div style="padding: 10px;">
        <div style="margin-bottom: 10px;">
          <label style="display: block; margin-bottom: 5px;">${game.i18n.localize('DX3rd.Dice')} ${game.i18n.localize('DX3rd.Quantity')}:</label>
          <input type="text" id="custom-dice" value="" style="width: 100%; padding: 5px;">
        </div>
        <div style="margin-bottom: 10px;">
          <label style="display: block; margin-bottom: 5px;">${game.i18n.localize('DX3rd.Bonus')}:</label>
          <input type="text" id="custom-add" value="" style="width: 100%; padding: 5px;">
        </div>
      </div>
    `;

    const DialogV2 = foundry.applications?.api?.DialogV2;
    if (!DialogV2) {
      ui.notifications.error(game.i18n.localize('DX3rd.DialogV2Unavailable'));
      resolve(null);
      return;
    }

    const dialog = new DialogV2({
      window: { title: `${game.i18n.localize('DX3rd.Conditional')} ${game.i18n.localize('DX3rd.Formula')}` },
      content: dialogContent,
      buttons: [
        {
          action: 'confirm',
          icon: '<i class="fas fa-check"></i>',
          label: game.i18n.localize('DX3rd.Confirm'),
          default: true,
          callback: (event, button) => {
            const root = button.form || button.element?.closest('.application') || button.element?.ownerDocument;
            const dice = root?.querySelector('#custom-dice')?.value || '';
            const add = root?.querySelector('#custom-add')?.value || '';
            resolve({ dice, add });
          }
        },
        {
          action: 'cancel',
          icon: '<i class="fas fa-times"></i>',
          label: game.i18n.localize('DX3rd.Cancel'),
          callback: () => resolve(null)
        }
      ]
    });
    await dialog.render(true);

    const root = dialog.element;
    const diceInput = root?.querySelector('#custom-dice');
    const addInput = root?.querySelector('#custom-add');
    const confirmButton = root?.querySelector('button[data-action="confirm"]');

    const checkInputs = () => {
      const diceValue = diceInput?.value.trim() || '';
      const addValue = addInput?.value.trim() || '';

      if (confirmButton) {
        confirmButton.disabled = !diceValue && !addValue;
        confirmButton.style.opacity = confirmButton.disabled ? '0.5' : '1';
      }
    };

    checkInputs();
    diceInput?.addEventListener('input', checkInputs);
    addInput?.addEventListener('input', checkInputs);
  });
};

/**
 * HP 데미지 익스텐션 즉시 실행
 * @param {Actor} actor - 사용자 액터
 * @param {Object} damageData - 데미지 데이터
 * @param {Item} item - 연동된 아이템 (옵션)
 * @param {Object} options - 옵션 (skipDialog: 확인 다이얼로그 건너뛰기)
 */
handler.executeDamageExtensionNow = async function(actor, damageData, item = null, options = {}) {
  // actor 유효성 검사
  if (!actor || !actor.id) {
    console.error('DX3rd | executeDamageExtensionNow: Invalid actor', actor);
    ui.notifications.error('액터 정보가 유효하지 않습니다.');
    return;
  }
  
  console.log('DX3rd | executeDamageExtensionNow called', { actor: actor.name, actorId: actor.id, damageData, item: item?.name, options });
  
  let { formulaDice, formulaAdd, target, ignoreReduce, selectedTargetIds, triggerItemName, conditionalFormula } = damageData;
  const { skipDialog = false } = options;
  
  // conditionalFormula가 체크되어 있으면 공식 입력 다이얼로그 표시 (호출한 클라이언트에만)
  if (conditionalFormula) {
    const customFormula = await this.promptConditionalDamageFormula();
    
    if (!customFormula) {
      console.log('DX3rd | Conditional formula input cancelled');
      return; // 취소 시 데미지 적용 중단
    }
    
    // 입력받은 공식으로 덮어쓰기
    formulaDice = customFormula.dice;
    formulaAdd = customFormula.add;
    console.log('DX3rd | Custom damage formula applied:', { formulaDice, formulaAdd });
  }
  
  // 대상 수집
  const targets = [];
  
  if (target === 'self' || target === 'targetAll') {
    targets.push(actor);
  }
  
  if (target === 'targetToken' || target === 'targetAll') {
    if (selectedTargetIds && selectedTargetIds.length > 0) {
      console.log('DX3rd | Using saved target IDs from queue:', selectedTargetIds);
      selectedTargetIds.forEach(tokenId => {
        const token = canvas.tokens.get(tokenId);
        if (token && token.actor && !targets.find(a => a.id === token.actor.id)) {
          targets.push(token.actor);
        }
      });
    } else {
      const selectedTargets = Array.from(game.user.targets);
      selectedTargets.forEach(t => {
        if (t.actor && !targets.find(a => a.id === t.actor.id)) {
          targets.push(t.actor);
        }
      });
    }
  }
  
  console.log(`DX3rd | Damage targets collected: ${targets.map(t => t.name).join(', ')} (total: ${targets.length})`);
  
  if (targets.length === 0) {
    ui.notifications.warn('데미지 대상이 없습니다.');
    return;
  }
  
  // 아이템의 레벨 가져오기 (없으면 1)
  const itemLevel = (item ? window.DX3rdFormulaEvaluator.getItemLevel(item) : 0) || 1;
  const itemForFormula = {
    type: item?.type || 'effect',
    system: {
      level: {
        value: itemLevel
      }
    }
  };
  
  console.log(`DX3rd | Using item level for formula: ${itemLevel} (item: ${item?.name || 'none'})`);
  
  // 공식 평가 (액터의 능력치/기능치 참조)
  let evaluatedDice = 0;
  let evaluatedAdd = 0;
  
  if (formulaDice) {
    const diceFormula = String(formulaDice).trim();
    if (diceFormula && diceFormula !== '0') {
      // NdM은 수량식이 아니라 Foundry Roll 수식으로 뒤에서 그대로 굴린다.
      evaluatedDice = window.DX3rdFormulaEvaluator.hasDice(diceFormula)
        ? 0
        : window.DX3rdFormulaEvaluator.evaluate(diceFormula, itemForFormula, actor);
    }
  }
  
  if (formulaAdd) {
    const addFormula = String(formulaAdd).trim();
    if (addFormula && addFormula !== '0') {
      // 다이스식은 승인 뒤 GM이 굴린다. 여기서는 숫자식만 미리 계산한다.
      evaluatedAdd = window.DX3rdFormulaEvaluator.hasDice(addFormula)
        ? 0
        : window.DX3rdFormulaEvaluator.evaluate(addFormula, itemForFormula, actor);
    }
  }
  
  // 참조를 치환한 원문 수식을 GM에게 넘겨 승인 뒤 한 번만 굴린다.
  const resolvedAddFormula = window.DX3rdFormulaEvaluator.prepareRollFormula(formulaAdd || '0', itemForFormula, actor);
  const rawDiceFormula = String(formulaDice || '').trim();
  const resolvedDiceFormula = window.DX3rdFormulaEvaluator.hasDice(rawDiceFormula)
    ? window.DX3rdFormulaEvaluator.prepareRollFormula(rawDiceFormula, itemForFormula, actor)
    : (Math.max(0, parseInt(evaluatedDice) || 0) > 0 ? `${Math.max(0, parseInt(evaluatedDice) || 0)}d10` : '');
  const rollFormula = [resolvedDiceFormula, resolvedAddFormula !== '0' ? `(${resolvedAddFormula})` : '']
    .filter(Boolean)
    .join(' + ') || '0';

  console.log(`DX3rd | Damage formula evaluated - Dice: ${formulaDice} → ${evaluatedDice}, Add: ${formulaAdd} → ${evaluatedAdd}`);
  
  // 사용자가 결과를 한 번 굴린다. 소유 대상과 GM 중계 대상에 같은 결과를 적용한다.
  const requestData = {
    userId: game.user.id,
    actorId: actor.id,
    actorName: actor.name,
    targets: targets.map(t => ({ id: t.id, name: t.name })),
    formulaDice: Math.max(0, parseInt(evaluatedDice) || 0),
    formulaAdd: parseInt(evaluatedAdd) || 0,
    rollFormula,
    ignoreReduce: ignoreReduce || false,
    triggerItemName: (triggerItemName || item?.name || null),
    skipDialog: skipDialog  // 구 저장 데이터 호환용
  };

  if (window.DX3rdFormulaEvaluator.hasDice(rollFormula)) {
    const roll = await new Roll(rollFormula).roll();
    requestData.resolvedAmount = roll.total;
    requestData.rollMessage = `<div class="dice-roll">${await roll.render()}</div>`;
  } else {
    requestData.resolvedAmount = window.DX3rdFormulaEvaluator.evaluate(rollFormula);
  }

  // 자신의 액터는 즉시 갱신하고, 수정 권한이 없는 대상만 GM이 조용히 중계한다.
  const localTargets = targets.filter(targetActor => game.user.isGM || targetActor.isOwner);
  const remoteTargets = targets.filter(targetActor => !localTargets.includes(targetActor));
  if (localTargets.length) {
    await handler.handleDamageRequest({ ...requestData, targets: localTargets.map(targetActor => ({ id: targetActor.id, name: targetActor.name })) });
  }
  if (remoteTargets.length) {
    game.socket.emit('system.dx3rd-emanim', {
      type: 'damageApply',
      requestData: { ...requestData, targets: remoteTargets.map(targetActor => ({ id: targetActor.id, name: targetActor.name })) }
    });
  }
};

/**
 * HP 데미지 적용. 소유 대상은 사용자 클라이언트가, 그 외 대상은 대표 GM이 호출한다.
 */
handler.handleDamageRequest = async function(requestData) {
  
  console.log('DX3rd | handleDamageRequest called with:', requestData);
  
  // requestData가 undefined인 경우 체크
  if (!requestData) {
    console.error('DX3rd | handleDamageRequest - requestData is undefined!');
    return;
  }
  
  // afterSuccess에서 온 경우: damageData가 있음
  if (requestData.damageData) {
    const actor = game.actors.get(requestData.actorId);
    const item = requestData.itemId ? actor?.items.get(requestData.itemId) : null;
    
    // executeDamageExtensionNow 직접 호출
    await this.executeDamageExtensionNow(actor, requestData.damageData, item);
    return;
  }
  
  // instant에서 온 경우: 기존 로직
  const { userId, actorId, actorName, targets, formulaDice, formulaAdd, rollFormula, ignoreReduce, triggerItemName } = requestData;
  
  // 데미지 계산 (다이스롤은 한 번만 실행)
  let damageAmount = Number(requestData.resolvedAmount);
  let rollMessage = requestData.rollMessage || '';
  
  if (!Number.isFinite(damageAmount) && (rollFormula ? window.DX3rdFormulaEvaluator.hasDice(rollFormula) : formulaDice > 0)) {
    const roll = await new Roll(rollFormula || `${formulaDice}d10 + ${formulaAdd}`).roll();
    damageAmount = roll.total;
    
    // 롤 결과를 HTML로 변환
    const rollHTML = await roll.render();
    rollMessage = `<div class="dice-roll">${rollHTML}</div>`;
    
    console.log(`DX3rd | HP damage roll: ${rollFormula} = ${damageAmount}`);
  } else if (!Number.isFinite(damageAmount)) {
    damageAmount = rollFormula ? window.DX3rdFormulaEvaluator.evaluate(rollFormula) : formulaAdd;
    console.log(`DX3rd | HP damage (no dice): ${damageAmount}`);
  }
  
  // 각 대상에게 데미지 적용
  for (const targetData of targets) {
    const targetActor = game.actors.get(targetData.id);
    if (!targetActor) continue;
    
    const currentHP = targetActor.system.attributes.hp?.value || 0;
    const reduce = targetActor.system.attributes.reduce?.value || 0;
    
    // 실제 데미지 = 롤 데미지 - 데미지 경감 (경감 무시가 아닌 경우)
    // armor는 기본적으로 무시, reduce만 고려
    const actualDamage = ignoreReduce 
      ? damageAmount 
      : Math.max(0, damageAmount - reduce);
    
    const newHP = Math.max(0, currentHP - actualDamage);
    const actualHpLoss = currentHP - newHP;  // 실제 HP 감소량
    await targetActor.update({ 'system.attributes.hp.value': newHP });
    
    // 데미지 메시지 출력 (해당 액터 스피커로, 시스템 메시지로 처리)
    let damageText = `HP ${actualHpLoss} 데미지`;
    
    // triggerItemName이 있으면 표시 (afterMain에서 온 경우)
    if (triggerItemName) {
      const cleanItemName = triggerItemName.split('||')[0];
      damageText = `HP ${actualHpLoss} 데미지 (${cleanItemName})`;
    }
    
    const content = rollMessage 
      ? `<div class="dx3rd-item-chat"><div>${damageText}</div>${rollMessage}</div>`
      : `<div class="dx3rd-item-chat"><div>${damageText}</div></div>`;
    
    await ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ actor: targetActor }),
      content: content,
      flags: {
        'dx3rd-emanim': {
          messageType: 'damage'
        }
      }
    });
    
    console.log(`DX3rd | HP damaged: ${targetActor.name} -${actualDamage} HP (${currentHP} → ${newHP})`);
  }
};


})();
