// Universal handler damage extension entry points.
(function() {
  const handler = window.DX3rdUniversalHandler;
  if (!handler) {
    console.error('DX3rd | Universal handler is unavailable for damage extensions.');
    return;
  }

// HP damage extension implementation.
/**
 * Run an HP damage extension
 * @param {Actor} actor - the using actor
 * @param {Object} damageData - the damage data
 * @param {Item} item - the linked item (optional)
 */
handler.executeDamageExtension = async function(actor, damageData, item = null) {
  window.DX3rdDebug.log('DX3rd | executeDamageExtension called', { actor: actor.name, damageData, item: item?.name });
  
  const { timing } = damageData;
  
  // afterMain, afterDamage and afterSuccess register on the queue at their own button / call site, so they are not handled here
  if (timing === 'afterMain' || timing === 'afterDamage' || timing === 'afterSuccess') {
    window.DX3rdDebug.log(`DX3rd | ${timing} timing - will be handled by caller or button handler`);
    return;
  }
  
  // With the instant timing, run it right away
  await this.executeDamageExtensionNow(actor, damageData, item);
};

/**
 * The conditional formula input dialog for HP damage (shown only on the calling client)
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
 * Run an HP damage extension immediately
 * @param {Actor} actor - the using actor
 * @param {Object} damageData - the damage data
 * @param {Item} item - the linked item (optional)
 * @param {Object} options - options (skipDialog: skip the confirmation dialog)
 */
handler.executeDamageExtensionNow = async function(actor, damageData, item = null, options = {}) {
  // Validate the actor
  if (!actor || !actor.id) {
    console.error('DX3rd | executeDamageExtensionNow: Invalid actor', actor);
    ui.notifications.error('액터 정보가 유효하지 않습니다.');
    return;
  }
  
  // Merged combo buckets are serialized without Document instances. A single-source conditional
  // bucket keeps the source id so [level] and other item-relative tokens still use that item.
  if (!item && damageData?.sourceItemId) item = actor.items?.get(damageData.sourceItemId) || null;

  window.DX3rdDebug.log('DX3rd | executeDamageExtensionNow called', { actor: actor.name, actorId: actor.id, damageData, item: item?.name, options });
  
  let { formulaDice, formulaAdd, target, ignoreReduce, selectedTargetIds, targetsFrozen = false, triggerItemName, conditionalFormula } = damageData;
  const { skipDialog = false } = options;
  
  // With conditionalFormula checked, show the formula input dialog (on the calling client only)
  if (conditionalFormula) {
    const customFormula = await this.promptConditionalDamageFormula();
    
    if (!customFormula) {
      window.DX3rdDebug.log('DX3rd | Conditional formula input cancelled');
      return; // cancelling stops the damage from being applied
    }
    
    // Overwrite with the formula that was entered
    formulaDice = customFormula.dice;
    formulaAdd = customFormula.add;
    window.DX3rdDebug.log('DX3rd | Custom damage formula applied:', { formulaDice, formulaAdd });
  }
  
  // Collect the targets
  const targets = [];
  
  if (target === 'self' || target === 'targetAll') {
    targets.push(actor);
  }
  
  if (target === 'targetToken' || target === 'targetAll') {
    if (targetsFrozen || (selectedTargetIds && selectedTargetIds.length > 0)) {
      window.DX3rdDebug.log('DX3rd | Using saved target IDs from queue:', selectedTargetIds);
      (selectedTargetIds || []).forEach(tokenId => {
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
  
  window.DX3rdDebug.log(`DX3rd | Damage targets collected: ${targets.map(t => t.name).join(', ')} (total: ${targets.length})`);
  
  if (targets.length === 0) {
    ui.notifications.warn('데미지 대상이 없습니다.');
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
  
  // The original formula, with its references substituted, is handed to the GM and rolled exactly once after approval.
  const resolvedAddFormula = window.DX3rdFormulaEvaluator.prepareRollFormula(formulaAdd || '0', itemForFormula, actor);
  const rawDiceFormula = String(formulaDice || '').trim();
  const resolvedDiceFormula = window.DX3rdFormulaEvaluator.hasDice(rawDiceFormula)
    ? window.DX3rdFormulaEvaluator.prepareRollFormula(rawDiceFormula, itemForFormula, actor)
    : (Math.max(0, parseInt(evaluatedDice) || 0) > 0 ? `${Math.max(0, parseInt(evaluatedDice) || 0)}d10` : '');
  const rollFormula = [resolvedDiceFormula, resolvedAddFormula !== '0' ? `(${resolvedAddFormula})` : '']
    .filter(Boolean)
    .join(' + ') || '0';

  window.DX3rdDebug.log(`DX3rd | Damage formula evaluated - Dice: ${formulaDice} → ${evaluatedDice}, Add: ${formulaAdd} → ${evaluatedAdd}`);
  
  // The user rolls the result once. The same result is applied to owned targets and GM-relayed targets alike.
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
    skipDialog: skipDialog  // for compatibility with older stored data
  };

  if (window.DX3rdFormulaEvaluator.hasDice(rollFormula)) {
    const roll = await new Roll(rollFormula).roll();
    requestData.resolvedAmount = roll.total;
    requestData.rollMessage = `<div class="dice-roll">${await roll.render()}</div>`;
  } else {
    requestData.resolvedAmount = window.DX3rdFormulaEvaluator.evaluate(rollFormula);
  }

  // Your own actor is updated immediately; only targets you cannot modify are relayed quietly by the GM.
  const localTargets = targets.filter(targetActor => game.user.isGM || targetActor.isOwner);
  const remoteTargets = targets.filter(targetActor => !localTargets.includes(targetActor));
  if (localTargets.length) {
    await handler.handleDamageRequest({ ...requestData, targets: localTargets.map(targetActor => ({ id: targetActor.id, name: targetActor.name })) });
  }
  if (remoteTargets.length) {
    window.DX3rdSocketRouter.emit({
      type: 'damageApply',
      requestData: { ...requestData, targets: remoteTargets.map(targetActor => ({ id: targetActor.id, name: targetActor.name })) }
    });
  }
};

/**
 * Apply the HP damage. Owned targets are handled by the using client, the rest by the representative GM.
 */
handler.handleDamageRequest = async function(requestData) {
  
  window.DX3rdDebug.log('DX3rd | handleDamageRequest called with:', requestData);
  
  // Guard against requestData being undefined
  if (!requestData) {
    console.error('DX3rd | handleDamageRequest - requestData is undefined!');
    return;
  }
  
  // Coming from afterSuccess: damageData is present
  if (requestData.damageData) {
    const actor = game.actors.get(requestData.actorId);
    const item = requestData.itemId ? actor?.items.get(requestData.itemId) : null;
    
    // Call executeDamageExtensionNow directly
    await this.executeDamageExtensionNow(actor, requestData.damageData, item);
    return;
  }
  
  // Coming from instant: the existing logic
  const { userId, actorId, actorName, targets, formulaDice, formulaAdd, rollFormula, ignoreReduce, triggerItemName } = requestData;
  
  // Compute the damage (the dice roll runs exactly once)
  let damageAmount = Number(requestData.resolvedAmount);
  let rollMessage = requestData.rollMessage || '';
  
  if (!Number.isFinite(damageAmount) && (rollFormula ? window.DX3rdFormulaEvaluator.hasDice(rollFormula) : formulaDice > 0)) {
    const roll = await new Roll(rollFormula || `${formulaDice}d10 + ${formulaAdd}`).roll();
    damageAmount = roll.total;
    
    // Render the roll result as HTML
    const rollHTML = await roll.render();
    rollMessage = `<div class="dice-roll">${rollHTML}</div>`;
    
    window.DX3rdDebug.log(`DX3rd | HP damage roll: ${rollFormula} = ${damageAmount}`);
  } else if (!Number.isFinite(damageAmount)) {
    damageAmount = rollFormula ? window.DX3rdFormulaEvaluator.evaluate(rollFormula) : formulaAdd;
    window.DX3rdDebug.log(`DX3rd | HP damage (no dice): ${damageAmount}`);
  }
  
  // Apply the damage to each target
  for (const targetData of targets) {
    const targetActor = game.actors.get(targetData.id);
    if (!targetActor) continue;
    
    const currentHP = targetActor.system.attributes.hp?.value || 0;
    const reduce = targetActor.system.attributes.reduce?.value || 0;
    
    // The actual damage = the rolled damage - the damage reduction (unless reduction is ignored)
    // armor is ignored by default; only reduce is taken into account
    const actualDamage = ignoreReduce 
      ? damageAmount 
      : Math.max(0, damageAmount - reduce);
    
    const newHP = Math.max(0, currentHP - actualDamage);
    const actualHpLoss = currentHP - newHP;  // the actual HP loss
    await targetActor.update({ 'system.attributes.hp.value': newHP });
    
    // Print the damage message (as that actor's speaker, handled as a system message)
    let damageText = `HP ${actualHpLoss} 데미지`;
    
    // Show triggerItemName when present (coming from afterMain)
    if (triggerItemName) {
      const cleanItemName = triggerItemName.split('||')[0];
      damageText = `HP ${actualHpLoss} 데미지 (${cleanItemName})`;
    }
    
    const safeDamageText = window.DX3rdRuntimeUtils.escapeHTML(damageText);
    const content = rollMessage 
      ? `<div class="dx3rd-item-chat"><div>${safeDamageText}</div>${rollMessage}</div>`
      : `<div class="dx3rd-item-chat"><div>${safeDamageText}</div></div>`;
    
    await ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ actor: targetActor }),
      content: content,
      flags: {
        'dx3rd-emanim': {
          messageType: 'damage'
        }
      }
    });
    
    window.DX3rdDebug.log(`DX3rd | HP damaged: ${targetActor.name} -${actualDamage} HP (${currentHP} → ${newHP})`);
  }
};


})();
