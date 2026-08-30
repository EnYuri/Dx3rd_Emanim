// Universal handler healing extension entry points.
(function() {
  const handler = window.DX3rdUniversalHandler;
  if (!handler) {
    console.error('DX3rd | Universal handler is unavailable for healing extensions.');
    return;
  }

  handler.executeHealExtension = async function(actor, healData, item = null) {
    window.DX3rdDebug.log('DX3rd | executeHealExtension called', { actor: actor.name, healData, item: item?.name });
    const { timing } = healData;
    if (timing === 'afterMain' || timing === 'afterDamage' || timing === 'afterSuccess') {
      window.DX3rdDebug.log(`DX3rd | ${timing} timing - will be handled by caller or button handler`);
      return;
    }
    await this.executeHealExtensionNow(actor, healData, item);
  };
// HP recovery extension implementation.
/**
 * Run an HP heal extension
 * @param {Actor} actor - the using actor
 * @param {Object} healData - the heal data
 * @param {Item} item - the linked item (optional)
 */
/**
 * Run an HP heal extension immediately
 * @param {Actor} actor - the using actor
 * @param {Object} healData - the heal data
 * @param {Item} item - the linked item (optional)
 * @param {Object} options - options (skipDialog: skip the confirmation dialog)
 */
handler.executeHealExtensionNow = async function(actor, healData, item = null, options = {}) {
  // Validate the actor
  if (!actor || !actor.id) {
    console.error('DX3rd | executeHealExtensionNow: Invalid actor', actor);
    ui.notifications.error('액터 정보가 유효하지 않습니다.');
    return;
  }
  
  window.DX3rdDebug.log('DX3rd | executeHealExtensionNow called', { actor: actor.name, actorId: actor.id, healData, item: item?.name, options });
  
  const { formulaDice, formulaAdd, target, rivival, resurrect, selectedTargetIds, targetsFrozen = false, triggerItemName, healTo, encroachFixed, excludeSelf = false } = healData;
  const { skipDialog = false } = options;
  
  // Collect the targets
  const targets = [];
  
  if (target === 'self' || target === 'targetAll') {
    targets.push(actor);
  }
  
  if (target === 'targetToken' || target === 'targetAll') {
    // Use selectedTargetIds when present (restored from the queue)
    if (targetsFrozen || (selectedTargetIds && selectedTargetIds.length > 0)) {
      window.DX3rdDebug.log('DX3rd | Using saved target IDs from queue:', selectedTargetIds);
      (selectedTargetIds || []).forEach(tokenId => {
        const token = canvas.tokens.get(tokenId);
        if (token && token.actor && (!excludeSelf || token.actor.id !== actor.id) && !targets.find(a => a.id === token.actor.id)) {
          targets.push(token.actor);
        }
      });
    } else {
      // Use the currently selected targets (for immediate execution)
      const selectedTargets = Array.from(game.user.targets);
      selectedTargets.forEach(t => {
        if (t.actor && (!excludeSelf || t.actor.id !== actor.id) && !targets.find(a => a.id === t.actor.id)) {
          targets.push(t.actor);
        }
      });
    }
  }
  
  window.DX3rdDebug.log(`DX3rd | Heal targets collected: ${targets.map(t => t.name).join(', ')} (total: ${targets.length})`);
  
  if (targets.length === 0) {
    ui.notifications.warn(excludeSelf ? game.i18n.localize('DX3rd.HealTargetOtherOnly') : '회복 대상이 없습니다.');
    return;
  }
  
  // Get the item's level (1 when absent)
  const itemLevel = (item ? window.DX3rdFormulaEvaluator.getItemLevel(item) : 0) || 1;
  const itemForFormula = {
    type: item?.type || 'effect',
    system: {
      level: {
        value: itemLevel
      }
    }
  };
  
  window.DX3rdDebug.log(`DX3rd | Using item level for formula: ${itemLevel} (item: ${item?.name || 'none'})`);
  
  // Evaluate the formula (referencing the actor's attributes / skills)
  let evaluatedDice = 0;
  let evaluatedAdd = 0;
  
  if (formulaDice) {
    const diceFormula = String(formulaDice).trim();
    if (diceFormula && diceFormula !== '0') {
      // NdM is not a count expression; it is rolled as a Foundry Roll formula later, as-is.
      evaluatedDice = window.DX3rdFormulaEvaluator.hasDice(diceFormula)
        ? 0
        : window.DX3rdFormulaEvaluator.evaluate(diceFormula, itemForFormula, actor);
    }
  }
  
  if (formulaAdd) {
    const addFormula = String(formulaAdd).trim();
    if (addFormula && addFormula !== '0') {
      // A dice formula is rolled by the GM after approval. Only numeric expressions are precomputed here.
      evaluatedAdd = window.DX3rdFormulaEvaluator.hasDice(addFormula)
        ? 0
        : window.DX3rdFormulaEvaluator.evaluate(addFormula, itemForFormula, actor);
    }
  }
  // formulaAdd used to be a fixed additive value, but a Foundry core dice formula is now allowed too.
  // Only the references are substituted before handing it to the GM; the actual roll happens exactly once after approval.
  const resolvedAddFormula = window.DX3rdFormulaEvaluator.prepareRollFormula(formulaAdd || '0', itemForFormula, actor);
  const rawDiceFormula = String(formulaDice || '').trim();
  const resolvedDiceFormula = window.DX3rdFormulaEvaluator.hasDice(rawDiceFormula)
    ? window.DX3rdFormulaEvaluator.prepareRollFormula(rawDiceFormula, itemForFormula, actor)
    : (Math.max(0, parseInt(evaluatedDice) || 0) > 0 ? `${Math.max(0, parseInt(evaluatedDice) || 0)}d10` : '');
  const rollFormula = [resolvedDiceFormula, resolvedAddFormula !== '0' ? `(${resolvedAddFormula})` : '']
    .filter(Boolean)
    .join(' + ') || '0';
  
  window.DX3rdDebug.log(`DX3rd | Heal formula evaluated - Dice: ${formulaDice} → ${evaluatedDice}, Add: ${formulaAdd} → ${evaluatedAdd}`);

  // The cap-heal (revival) form: evaluate healTo (the target HP) — "max" is the maximum, a formula is evaluated against the actor / level
  let evaluatedHealTo = null;
  if (healTo !== undefined && healTo !== null && String(healTo).trim() !== '' && String(healTo).trim() !== '0') {
    const htRaw = String(healTo).trim();
    if (/^max$/i.test(htRaw)) evaluatedHealTo = 'max';
    else evaluatedHealTo = parseInt(window.DX3rdFormulaEvaluator.evaluate(htRaw, itemForFormula, actor)) || 0;
  }
  // The fixed encroachment side effect: a dice formula ("2d10") is handed to the GM-side roll, while a number / [formula] is evaluated on the user side
  let encFixedOut = '';
  if (encroachFixed !== undefined && encroachFixed !== null && String(encroachFixed).trim() !== '' && String(encroachFixed).trim() !== '-') {
    const ef = String(encroachFixed).trim();
    if (/d/i.test(ef) && !/\[/.test(ef)) {
      encFixedOut = ef;
    } else {
      encFixedOut = String(parseInt(window.DX3rdFormulaEvaluator.evaluate(ef, itemForFormula, actor)) || 0);
    }
  }
  window.DX3rdDebug.log(`DX3rd | Heal threshold/encroach - healTo: ${healTo} → ${evaluatedHealTo}, encroachFixed: ${encroachFixed} → ${encFixedOut}`);

  // The user rolls the result once. The computed result itself is transferred so an owned target and a
  // GM-relayed target never receive different results.
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
    // The trigger item's name: falls back to the item's name when there is no healData
    triggerItemName: (triggerItemName || item?.name || null),
    skipDialog: skipDialog  // for compatibility with older stored data
  };

  if (window.DX3rdFormulaEvaluator.hasDice(rollFormula)) {
    const roll = await new Roll(rollFormula).roll();
    requestData.resolvedAmount = roll.total;
    requestData.rollMessage = `<div class="dice-roll">${await roll.render()}</div>`;
  } else {
    requestData.resolvedAmount = window.DX3rdFormulaEvaluator.evaluate(rollFormula);
  }

  // The encroachment side-effect dice are not re-rolled per target either. The result is transferred so an owned
  // target and a GM-relayed target receive the same side effect.
  if (/d/i.test(encFixedOut)) {
    const encRoll = await new Roll(encFixedOut).roll();
    requestData.resolvedEncroachFixed = encRoll.total;
    await encRoll.toMessage({
      speaker: ChatMessage.getSpeaker({ actor }),
      flavor: `${game.i18n.localize('DX3rd.Encroachment') || '침식률'} +`
    });
  }

  // Your own actor is updated immediately; only targets you cannot modify are relayed quietly by the GM.
  const localTargets = targets.filter(targetActor => game.user.isGM || targetActor.isOwner);
  const remoteTargets = targets.filter(targetActor => !localTargets.includes(targetActor));
  if (localTargets.length) {
    await handler.handleHealRequest({ ...requestData, targets: localTargets.map(targetActor => ({ id: targetActor.id, name: targetActor.name })) });
  }
  if (remoteTargets.length) {
    window.DX3rdSocketRouter.emit({
      type: 'healApply',
      requestData: { ...requestData, targets: remoteTargets.map(targetActor => ({ id: targetActor.id, name: targetActor.name })) }
    });
  }
};

/**
 * Apply the HP heal. Owned targets are handled by the using client, the rest by the representative GM.
 */
handler.handleHealRequest = async function(requestData) {
  
  // Coming from afterSuccess: healData is present
  if (requestData.healData) {
    const actor = game.actors.get(requestData.actorId);
    const item = requestData.itemId ? actor?.items.get(requestData.itemId) : null;
    
    // Call executeHealExtensionNow directly
    await this.executeHealExtensionNow(actor, requestData.healData, item);
    return;
  }
  
  // Coming from instant: the existing logic
  const { userId, actorId, actorName, targets, formulaDice, formulaAdd, rollFormula, rivival, resurrect, triggerItemName, healTo, encroachFixed } = requestData;
  
  // Build the formula text
  let formulaText = '';
  formulaText = rollFormula || (formulaDice > 0 ? `${formulaDice}D10+${formulaAdd}` : `${formulaAdd}`);
  
  // Compute the heal amount (the dice roll runs exactly once)
  let healAmount = Number(requestData.resolvedAmount);
  let rollMessage = requestData.rollMessage || '';
  
  if (!Number.isFinite(healAmount) && (rollFormula ? window.DX3rdFormulaEvaluator.hasDice(rollFormula) : formulaDice > 0)) {
    const roll = await new Roll(rollFormula || `${formulaDice}d10 + ${formulaAdd}`).roll();
    healAmount = roll.total;
    
    // Render the roll result as HTML
    const rollHTML = await roll.render();
    rollMessage = `<div class="dice-roll">${rollHTML}</div>`;
    
    window.DX3rdDebug.log(`DX3rd | HP heal roll: ${formulaText} = ${healAmount}`);
  } else if (!Number.isFinite(healAmount)) {
    healAmount = rollFormula ? window.DX3rdFormulaEvaluator.evaluate(rollFormula) : formulaAdd;
    window.DX3rdDebug.log(`DX3rd | HP heal (no dice): ${healAmount}`);
  }
  
  // Apply the heal to each target
  for (const targetData of targets) {
    const targetActor = game.actors.get(targetData.id);
    if (!targetActor) continue;
    
    const currentHP = targetActor.system.attributes.hp?.value || 0;
    const maxHP = targetActor.system.attributes.hp?.max || 0;
    
    // With no incapacitation-recovery check and HP at 0, healing is impossible
    if (!rivival && currentHP === 0) {
      await ChatMessage.create({
        speaker: ChatMessage.getSpeaker({ actor: targetActor }),
        content: `전투 불능 상태로 HP 회복 불가`,
        flags: {
          'dx3rd-emanim': {
            messageType: 'healing'
          }
        }
      });
      window.DX3rdDebug.log(`DX3rd | HP heal blocked: ${targetActor.name} is incapacitated`);
      continue;
    }
    
    // Apply the HP heal
    //  - with healTo (a cap heal / revival) set, "raise the current HP to the target when it is lower"
    //  - otherwise the existing fixed additive heal
    let newHP;
    if (healTo !== null && healTo !== undefined && healTo !== '') {
      const targetHP = (String(healTo).toLowerCase() === 'max') ? maxHP : Math.min(parseInt(healTo) || 0, maxHP);
      newHP = Math.max(currentHP, targetHP);
    } else {
      newHP = Math.min(currentHP + healAmount, maxHP);
    }
    const actualHealAmount = newHP - currentHP;  // the actual amount healed
    
    // The berserk bloodsucking type cannot heal HP (losing it is still possible)
    const berserkActive = targetActor.system?.conditions?.berserk?.active || false;
    const berserkType = targetActor.system?.conditions?.berserk?.type || '';
    const berserkBloodsucking = berserkActive && berserkType === 'bloodsucking';
    
    if (berserkBloodsucking && actualHealAmount > 0) {
      await ChatMessage.create({
        speaker: ChatMessage.getSpeaker({ actor: targetActor }),
        content: `폭주(흡혈) 효과로 HP 회복 불가`,
        flags: {
          'dx3rd-emanim': {
            messageType: 'healing'
          }
        }
      });
      window.DX3rdDebug.log(`DX3rd | HP heal blocked: ${targetActor.name} has berserk bloodsucking`);
      continue;
    }
    
    const updates = { 'system.attributes.hp.value': newHP };

    // Accumulate the encroachment side effect: resurrect (the amount healed) + encroachFixed (a fixed value / dice). Both are summed when both are present.
    let encDelta = 0;
    if (resurrect) {
      encDelta += actualHealAmount;  // Resurrect: the encroachment rises by the HP actually healed
    }
    if (encroachFixed !== null && encroachFixed !== undefined && String(encroachFixed).trim() !== '' && String(encroachFixed).trim() !== '-') {
      const ef = String(encroachFixed).trim();
      if (/d/i.test(ef)) {
        const resolvedEncroachFixed = Number(requestData.resolvedEncroachFixed);
        if (Number.isFinite(resolvedEncroachFixed)) {
          encDelta += resolvedEncroachFixed;
        } else {
          // Compatibility with older stored requests: only the old form with no result is rolled here, once.
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
      window.DX3rdDebug.log(`DX3rd | Encroachment +${encDelta}: ${targetActor.name} (${currentEncroachment} → ${currentEncroachment + encDelta})`);
    }

    await targetActor.update(updates);

    // Revival (rivival): with HP > 0 after healing, the incapacitated (dead) status is cleared — the condition handler also handles the death mark / socket sync
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

    // Print the heal message (as that actor's speaker, handled as a system message)
    let healText = `HP ${actualHealAmount} 회복`;

    // Show triggerItemName when present (coming from afterMain)
    if (triggerItemName) {
      // Strip ||RubyText from the item name
      const cleanItemName = triggerItemName.split('||')[0];
      healText = `HP ${actualHealAmount} 회복 (${cleanItemName})`;
    }
    // The revival / encroachment display
    if (revivedCleared) healText += ` (${game.i18n.localize('DX3rd.Defeated') || '전투불능'} ${game.i18n.localize('DX3rd.Clear') || '소거'})`;
    if (encDelta) healText += ` (${game.i18n.localize('DX3rd.Encroachment') || '침식률'} +${encDelta})`;
    
    const safeHealText = window.DX3rdRuntimeUtils.escapeHTML(healText);
    const content = rollMessage 
      ? `<div class="dx3rd-item-chat"><div>${safeHealText}</div>${rollMessage}</div>`
      : `<div class="dx3rd-item-chat"><div>${safeHealText}</div></div>`;
    
    await ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ actor: targetActor }),
      content: content,
      flags: {
        'dx3rd-emanim': {
          messageType: 'healing'
        }
      }
    });
    
    window.DX3rdDebug.log(`DX3rd | HP healed: ${targetActor.name} +${healAmount} HP (${currentHP} → ${newHP})`);
  }
};


})();
