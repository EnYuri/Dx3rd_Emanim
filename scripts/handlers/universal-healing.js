// Universal handler healing extension entry points.
(function() {
  const handler = window.DX3rdUniversalHandler;
  if (!handler) {
    console.error('DX3rd | Universal handler is unavailable for healing extensions.');
    return;
  }

  handler.executeHealExtension = async function(actor, healData, item = null) {
    console.log('DX3rd | executeHealExtension called', { actor: actor.name, healData, item: item?.name });
    const { timing } = healData;
    if (timing === 'afterMain' || timing === 'afterDamage' || timing === 'afterSuccess') {
      console.log(`DX3rd | ${timing} timing - will be handled by caller or button handler`);
      return;
    }
    await this.executeHealExtensionNow(actor, healData, item);
  };
// HP recovery extension implementation.
/**
 * HP 회복 익스텐션 실행
 * @param {Actor} actor - 사용자 액터
 * @param {Object} healData - 회복 데이터
 * @param {Item} item - 연동된 아이템 (옵션)
 */
/**
 * HP 회복 익스텐션 즉시 실행
 * @param {Actor} actor - 사용자 액터
 * @param {Object} healData - 회복 데이터
 * @param {Item} item - 연동된 아이템 (옵션)
 * @param {Object} options - 옵션 (skipDialog: 확인 다이얼로그 건너뛰기)
 */
handler.executeHealExtensionNow = async function(actor, healData, item = null, options = {}) {
  // actor 유효성 검사
  if (!actor || !actor.id) {
    console.error('DX3rd | executeHealExtensionNow: Invalid actor', actor);
    ui.notifications.error('액터 정보가 유효하지 않습니다.');
    return;
  }
  
  console.log('DX3rd | executeHealExtensionNow called', { actor: actor.name, actorId: actor.id, healData, item: item?.name, options });
  
  const { formulaDice, formulaAdd, target, rivival, resurrect, selectedTargetIds, triggerItemName, healTo, encroachFixed, excludeSelf = false } = healData;
  const { skipDialog = false } = options;
  
  // 대상 수집
  const targets = [];
  
  if (target === 'self' || target === 'targetAll') {
    targets.push(actor);
  }
  
  if (target === 'targetToken' || target === 'targetAll') {
    // selectedTargetIds가 있으면 사용 (큐에서 복원된 경우)
    if (selectedTargetIds && selectedTargetIds.length > 0) {
      console.log('DX3rd | Using saved target IDs from queue:', selectedTargetIds);
      selectedTargetIds.forEach(tokenId => {
        const token = canvas.tokens.get(tokenId);
        if (token && token.actor && (!excludeSelf || token.actor.id !== actor.id) && !targets.find(a => a.id === token.actor.id)) {
          targets.push(token.actor);
        }
      });
    } else {
      // 현재 선택된 타겟 사용 (즉시 실행인 경우)
      const selectedTargets = Array.from(game.user.targets);
      selectedTargets.forEach(t => {
        if (t.actor && (!excludeSelf || t.actor.id !== actor.id) && !targets.find(a => a.id === t.actor.id)) {
          targets.push(t.actor);
        }
      });
    }
  }
  
  console.log(`DX3rd | Heal targets collected: ${targets.map(t => t.name).join(', ')} (total: ${targets.length})`);
  
  if (targets.length === 0) {
    ui.notifications.warn(excludeSelf ? game.i18n.localize('DX3rd.HealTargetOtherOnly') : '회복 대상이 없습니다.');
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
  // formulaAdd는 고정 가산치였지만, 이제 Foundry 코어 다이스식도 허용한다.
  // 참조만 먼저 치환해 GM에게 전달하고 실제 굴림은 승인 뒤 정확히 한 번 수행한다.
  const resolvedAddFormula = window.DX3rdFormulaEvaluator.prepareRollFormula(formulaAdd || '0', itemForFormula, actor);
  const rawDiceFormula = String(formulaDice || '').trim();
  const resolvedDiceFormula = window.DX3rdFormulaEvaluator.hasDice(rawDiceFormula)
    ? window.DX3rdFormulaEvaluator.prepareRollFormula(rawDiceFormula, itemForFormula, actor)
    : (Math.max(0, parseInt(evaluatedDice) || 0) > 0 ? `${Math.max(0, parseInt(evaluatedDice) || 0)}d10` : '');
  const rollFormula = [resolvedDiceFormula, resolvedAddFormula !== '0' ? `(${resolvedAddFormula})` : '']
    .filter(Boolean)
    .join(' + ') || '0';
  
  console.log(`DX3rd | Heal formula evaluated - Dice: ${formulaDice} → ${evaluatedDice}, Add: ${formulaAdd} → ${evaluatedAdd}`);

  // 상한회복(부활)형: healTo(목표 HP) 평가 — "max"는 최대치, 공식이면 액터/레벨로 평가
  let evaluatedHealTo = null;
  if (healTo !== undefined && healTo !== null && String(healTo).trim() !== '' && String(healTo).trim() !== '0') {
    const htRaw = String(healTo).trim();
    if (/^max$/i.test(htRaw)) evaluatedHealTo = 'max';
    else evaluatedHealTo = parseInt(window.DX3rdFormulaEvaluator.evaluate(htRaw, itemForFormula, actor)) || 0;
  }
  // 고정 침식 부작용: 다이스식("2d10")은 GM측 롤로 넘기고, 숫자/[공식]은 사용자측에서 평가
  let encFixedOut = '';
  if (encroachFixed !== undefined && encroachFixed !== null && String(encroachFixed).trim() !== '' && String(encroachFixed).trim() !== '-') {
    const ef = String(encroachFixed).trim();
    if (/d/i.test(ef) && !/\[/.test(ef)) {
      encFixedOut = ef;
    } else {
      encFixedOut = String(parseInt(window.DX3rdFormulaEvaluator.evaluate(ef, itemForFormula, actor)) || 0);
    }
  }
  console.log(`DX3rd | Heal threshold/encroach - healTo: ${healTo} → ${evaluatedHealTo}, encroachFixed: ${encroachFixed} → ${encFixedOut}`);

  // 사용자가 결과를 한 번 굴린다. 소유 대상과 GM 중계 대상이 서로 다른 결과를
  // 받지 않도록, 계산 결과 자체를 전달한다.
  const requestData = {
    userId: game.user.id,
    actorId: actor.id,
    actorName: actor.name,
    targets: targets.map(t => ({ id: t.id, name: t.name })),
    formulaDice: Math.max(0, parseInt(evaluatedDice) || 0),
    formulaAdd: parseInt(evaluatedAdd) || 0,
    rollFormula,
    healTo: evaluatedHealTo,
    encroachFixed: encFixedOut,
    rivival: rivival || false,
    resurrect: healData.resurrect || false,
    // 트리거 아이템 이름: healData가 없으면 아이템 이름으로 대체
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

  // 침식 부작용 주사위도 대상별로 다시 굴리지 않는다. 결과를 함께 전달해
  // 소유 대상과 GM 중계 대상이 동일한 부작용을 받게 한다.
  if (/d/i.test(encFixedOut)) {
    const encRoll = await new Roll(encFixedOut).roll();
    requestData.resolvedEncroachFixed = encRoll.total;
    await encRoll.toMessage({
      speaker: ChatMessage.getSpeaker({ actor }),
      flavor: `${game.i18n.localize('DX3rd.Encroachment') || '침식률'} +`
    });
  }

  // 자신의 액터는 즉시 갱신하고, 수정 권한이 없는 대상만 GM이 조용히 중계한다.
  const localTargets = targets.filter(targetActor => game.user.isGM || targetActor.isOwner);
  const remoteTargets = targets.filter(targetActor => !localTargets.includes(targetActor));
  if (localTargets.length) {
    await handler.handleHealRequest({ ...requestData, targets: localTargets.map(targetActor => ({ id: targetActor.id, name: targetActor.name })) });
  }
  if (remoteTargets.length) {
    game.socket.emit('system.dx3rd-emanim', {
      type: 'healApply',
      requestData: { ...requestData, targets: remoteTargets.map(targetActor => ({ id: targetActor.id, name: targetActor.name })) }
    });
  }
};

/**
 * HP 회복 적용. 소유 대상은 사용자 클라이언트가, 그 외 대상은 대표 GM이 호출한다.
 */
handler.handleHealRequest = async function(requestData) {
  
  // afterSuccess에서 온 경우: healData가 있음
  if (requestData.healData) {
    const actor = game.actors.get(requestData.actorId);
    const item = requestData.itemId ? actor?.items.get(requestData.itemId) : null;
    
    // executeHealExtensionNow 직접 호출
    await this.executeHealExtensionNow(actor, requestData.healData, item);
    return;
  }
  
  // instant에서 온 경우: 기존 로직
  const { userId, actorId, actorName, targets, formulaDice, formulaAdd, rollFormula, rivival, resurrect, triggerItemName, healTo, encroachFixed } = requestData;
  
  // 공식 텍스트 생성
  let formulaText = '';
  formulaText = rollFormula || (formulaDice > 0 ? `${formulaDice}D10+${formulaAdd}` : `${formulaAdd}`);
  
  // 회복량 계산 (다이스롤은 한 번만 실행)
  let healAmount = Number(requestData.resolvedAmount);
  let rollMessage = requestData.rollMessage || '';
  
  if (!Number.isFinite(healAmount) && (rollFormula ? window.DX3rdFormulaEvaluator.hasDice(rollFormula) : formulaDice > 0)) {
    const roll = await new Roll(rollFormula || `${formulaDice}d10 + ${formulaAdd}`).roll();
    healAmount = roll.total;
    
    // 롤 결과를 HTML로 변환
    const rollHTML = await roll.render();
    rollMessage = `<div class="dice-roll">${rollHTML}</div>`;
    
    console.log(`DX3rd | HP heal roll: ${formulaText} = ${healAmount}`);
  } else if (!Number.isFinite(healAmount)) {
    healAmount = rollFormula ? window.DX3rdFormulaEvaluator.evaluate(rollFormula) : formulaAdd;
    console.log(`DX3rd | HP heal (no dice): ${healAmount}`);
  }
  
  // 각 대상에게 회복 적용
  for (const targetData of targets) {
    const targetActor = game.actors.get(targetData.id);
    if (!targetActor) continue;
    
    const currentHP = targetActor.system.attributes.hp?.value || 0;
    const maxHP = targetActor.system.attributes.hp?.max || 0;
    
    // 전투 불능 회복 체크가 없고 HP가 0이면 회복 불가
    if (!rivival && currentHP === 0) {
      await ChatMessage.create({
        speaker: ChatMessage.getSpeaker({ actor: targetActor }),
        content: `전투 불능 상태로 HP 회복 불가`,
        flags: {
          'dx3rd-emanim': {
            messageType: 'heal'
          }
        }
      });
      console.log(`DX3rd | HP heal blocked: ${targetActor.name} is incapacitated`);
      continue;
    }
    
    // HP 회복 적용
    //  - healTo(상한회복/부활)가 지정되면 "현재 HP가 목표보다 낮을 때 목표까지 끌어올림"
    //  - 그 외에는 기존 고정 가산 회복
    let newHP;
    if (healTo !== null && healTo !== undefined && healTo !== '') {
      const targetHP = (String(healTo).toLowerCase() === 'max') ? maxHP : Math.min(parseInt(healTo) || 0, maxHP);
      newHP = Math.max(currentHP, targetHP);
    } else {
      newHP = Math.min(currentHP + healAmount, maxHP);
    }
    const actualHealAmount = newHP - currentHP;  // 실제 회복량 계산
    
    // 폭주 bloodsucking 타입이면 HP 회복 불가 (감소는 가능)
    const berserkActive = targetActor.system?.conditions?.berserk?.active || false;
    const berserkType = targetActor.system?.conditions?.berserk?.type || '';
    const berserkBloodsucking = berserkActive && berserkType === 'bloodsucking';
    
    if (berserkBloodsucking && actualHealAmount > 0) {
      await ChatMessage.create({
        speaker: ChatMessage.getSpeaker({ actor: targetActor }),
        content: `폭주(흡혈) 효과로 HP 회복 불가`,
        flags: {
          'dx3rd-emanim': {
            messageType: 'heal'
          }
        }
      });
      console.log(`DX3rd | HP heal blocked: ${targetActor.name} has berserk bloodsucking`);
      continue;
    }
    
    const updates = { 'system.attributes.hp.value': newHP };

    // 침식률 부작용 누적: resurrect(회복분) + encroachFixed(고정치/다이스). 둘 다 있어도 합산.
    let encDelta = 0;
    if (resurrect) {
      encDelta += actualHealAmount;  // 리저렉트: 실제 회복한 HP만큼 침식률 증가
    }
    if (encroachFixed !== null && encroachFixed !== undefined && String(encroachFixed).trim() !== '' && String(encroachFixed).trim() !== '-') {
      const ef = String(encroachFixed).trim();
      if (/d/i.test(ef)) {
        const resolvedEncroachFixed = Number(requestData.resolvedEncroachFixed);
        if (Number.isFinite(resolvedEncroachFixed)) {
          encDelta += resolvedEncroachFixed;
        } else {
          // 이전 저장 요청 호환: 결과가 없는 구 형식만 여기서 한 번 굴린다.
          const encRoll = await new Roll(ef).roll();
          await encRoll.toMessage({
            speaker: ChatMessage.getSpeaker({ actor: targetActor }),
            flavor: `${game.i18n.localize('DX3rd.Encroachment') || '침식률'} +`
          });
          encDelta += encRoll.total;
        }
      } else {
        encDelta += parseInt(ef) || 0;
      }
    }
    if (encDelta) {
      const currentEncroachment = targetActor.system.attributes.encroachment?.value || 0;
      updates['system.attributes.encroachment.value'] = currentEncroachment + encDelta;
      console.log(`DX3rd | Encroachment +${encDelta}: ${targetActor.name} (${currentEncroachment} → ${currentEncroachment + encDelta})`);
    }

    await targetActor.update(updates);

    // 부활(rivival): 회복 후 HP>0이면 전투불능(dead) 상태 소거 — 조건 핸들러가 death mark/소켓 동기까지 처리
    let revivedCleared = false;
    if (rivival && newHP > 0) {
      const deadEff = targetActor.effects.find(e => e.statuses?.has('dead'));
      if (deadEff) {
        try {
          await targetActor.toggleStatusEffect('dead', { active: false });
          revivedCleared = true;
        } catch (e) {
          console.error('DX3rd | clear dead status failed', e);
        }
      }
    }

    // 회복 메시지 출력 (해당 액터 스피커로, 시스템 메시지로 처리)
    let healText = `HP ${actualHealAmount} 회복`;

    // triggerItemName이 있으면 표시 (afterMain에서 온 경우)
    if (triggerItemName) {
      // 아이템 이름에서 ||RubyText 제거
      const cleanItemName = triggerItemName.split('||')[0];
      healText = `HP ${actualHealAmount} 회복 (${cleanItemName})`;
    }
    // 부활/침식 표시
    if (revivedCleared) healText += ` (${game.i18n.localize('DX3rd.Defeated') || '전투불능'} ${game.i18n.localize('DX3rd.Clear') || '소거'})`;
    if (encDelta) healText += ` (${game.i18n.localize('DX3rd.Encroachment') || '침식률'} +${encDelta})`;
    
    const content = rollMessage 
      ? `<div class="dx3rd-item-chat"><div>${healText}</div>${rollMessage}</div>`
      : `<div class="dx3rd-item-chat"><div>${healText}</div></div>`;
    
    await ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ actor: targetActor }),
      content: content,
      flags: {
        'dx3rd-emanim': {
          messageType: 'heal'
        }
      }
    });
    
    console.log(`DX3rd | HP healed: ${targetActor.name} +${healAmount} HP (${currentHP} → ${newHP})`);
  }
};


})();
