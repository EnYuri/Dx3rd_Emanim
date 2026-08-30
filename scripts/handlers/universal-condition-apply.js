// ========== The condition system ========== //
/**
 * Record the extension's source on the core status AE. The status itself stays a Foundry status effect, but it is
 * released safely only when each source's disable lifetime ends.
 */
window.DX3rdConditionSources = window.DX3rdConditionSources || {
  validDurations: new Set(['roll', 'major', 'main', 'reaction', 'guard', 'round', 'scene', 'session']),

  async track(actor, statusId, { duration, itemId, sourceActorId, preExisting = false } = {}) {
    if (!this.validDurations.has(duration) || !itemId) return;
    const effect = actor.effects.find(e => e.statuses?.has(statusId));
    if (!effect) return;

    const sources = foundry.utils.deepClone(effect.getFlag('dx3rd-emanim', 'conditionSources') || {});
    const meta = foundry.utils.deepClone(effect.getFlag('dx3rd-emanim', 'conditionSourceMeta') || {});
    const sourceKey = `${sourceActorId || actor.id}:${itemId}:${statusId}`;
    if (!Object.keys(sources).length && preExisting) meta.external = true;
    sources[sourceKey] = { duration, itemId, sourceActorId: sourceActorId || actor.id };
    await effect.update({
      'flags.dx3rd-emanim.conditionSources': sources,
      'flags.dx3rd-emanim.conditionSourceMeta': meta
    });
  },

  async clearByTiming(actor, timing) {
    if (!this.validDurations.has(timing)) return 0;
    let cleared = 0;
    for (const effect of actor.effects) {
      const sources = foundry.utils.deepClone(effect.getFlag('dx3rd-emanim', 'conditionSources') || {});
      const expired = Object.entries(sources).filter(([, source]) => source?.duration === timing);
      if (!expired.length) continue;
      for (const [key] of expired) delete sources[key];

      if (Object.keys(sources).length) {
        await effect.update({ 'flags.dx3rd-emanim.conditionSources': sources });
        cleared += expired.length;
        continue;
      }

      const meta = effect.getFlag('dx3rd-emanim', 'conditionSourceMeta') || {};
      if (meta.external) {
        await effect.update({
          'flags.dx3rd-emanim.conditionSources': {},
          'flags.dx3rd-emanim.conditionSourceMeta': {}
        });
      } else {
        const statusId = Array.from(effect.statuses || [])[0];
        if (statusId) await actor.toggleStatusEffect(statusId, { active: false });
      }
      cleared += expired.length;
    }
    return cleared;
  }
};

/**
 * Pick one option from a short list, rendered as one button per option.
 *
 * Cancelling — the close button, Escape, or dismissing — resolves null, which every caller
 * treats as "no choice" through a truthy check.
 *
 * This uses the overlay rather than DialogV2 on purpose. A DialogV2 cancel callback that
 * returns nullish has the button's own action string ("cancel") substituted in, which would
 * arrive here as a valid choice; each of these call sites previously carried a `() => false`
 * workaround for that. The overlay has no such substitution.
 *
 * @param {object} args
 * @param {string} args.title                                Overlay header.
 * @param {string} args.label                                Prompt shown above the buttons.
 * @param {Array<{value: string, label: string}>} args.options
 * @returns {Promise<string|null>} The chosen value, or null when cancelled.
 */
window.DX3rdUniversalHandler._promptConditionChoice = async function({ title, label, options } = {}) {
  const rows = (Array.isArray(options) ? options : []).filter(o => o && o.value !== undefined);
  if (!rows.length) return null;
  return await window.DX3rdOverlayDialog.wait({
    id: 'dx3rd-condition-choice',
    title,
    // The prompt is the only markup here; option labels reach the DOM through textContent.
    content: `<div class="dx3rd-overlay-dialog__prompt">${window.DX3rdRuntimeUtils.escapeHTML(label ?? '')}</div>`,
    closeOnEsc: true,
    buttons: rows.map(o => ({ label: String(o.label ?? o.value), value: o.value }))
  });
};

/**
 * Return the array of condition entries enabled in itemExtend.condition (the conditions array, or the older single form)
 * @param {Object} condData - itemExtend.condition
 * @returns {Array<{timing, target, type, poisonedRank, activate}>}
 */
window.DX3rdUniversalHandler._getConditionEntries = function(condData) {
  if (!condData) return [];
  if (Array.isArray(condData.conditions)) {
    return condData.conditions.filter(c => c && c.activate && c.type);
  }
  if (condData.activate && (condData.type || (condData.conditionTypes && condData.conditionTypes.length))) {
    const types = condData.conditionTypes || [condData.type];
    return types.filter(t => t).map(t => ({
      timing: condData.timing || 'instant',
      target: condData.target || 'self',
      type: t,
      poisonedRank: t === 'poisoned' ? (condData.poisonedRank ?? null) : null,
      disable: condData.disable || null,
      activate: true
    }));
  }
  return [];
};

/**
 * Run a condition extension
 * @param {Actor} actor - the using actor
 * @param {Object} conditionData - the condition data
 * @param {Item} item - the linked item (optional)
 */
window.DX3rdUniversalHandler.executeConditionExtension = async function(actor, conditionData, item = null) {
  window.DX3rdDebug.log('DX3rd | executeConditionExtension called', { actor: actor.name, conditionData, item: item?.name });
  
  const { timing } = conditionData;
  
  // afterMain, afterDamage and afterSuccess register on the queue at their own button / call site, so they are not handled here
  if (timing === 'afterMain' || timing === 'afterDamage' || timing === 'afterSuccess') {
    window.DX3rdDebug.log(`DX3rd | ${timing} timing - will be handled by caller or button handler`);
    return;
  }
  
  // With the instant timing, run it right away
  await this.executeConditionExtensionNow(actor, conditionData, item);
};

/**
 * Run a condition extension immediately
 * @param {Actor} actor - the using actor
 * @param {Object} conditionData - the condition data
 * @param {Item} item - the linked item (optional)
 */
window.DX3rdUniversalHandler.executeConditionExtensionNow = async function(actor, conditionData, item = null) {
  window.DX3rdDebug.log('DX3rd | executeConditionExtensionNow called', { actor: actor.name, conditionData, item: item?.name });
  
  const { target, selectedTargetIds, targetsFrozen = false, triggerItemName, poisonedRank } = conditionData;
  
  // With a conditionTypes array present → several conditions → call executeConditionExtensionsNowBulk
  const conditionTypes = conditionData.conditionTypes;
  if (Array.isArray(conditionTypes) && conditionTypes.length > 0) {
    const bulkData = {
      conditionTypes,
      target,
      selectedTargetIds: selectedTargetIds || [],
      targetsFrozen,
      triggerItemName: triggerItemName || item?.name || null,
      poisonedRank: poisonedRank || null,
      itemId: item?.id || null,
      duration: conditionData.disable || null,
      sourceActorId: actor.id
    };
    await this.executeConditionExtensionsNowBulk(actor, bulkData);
    return;
  }
  
  // A single condition: the conditionType or type field
  const conditionType = conditionData.conditionType || conditionData.type;
  if (!conditionType) {
    console.error('DX3rd | conditionType is missing from conditionData:', conditionData);
    ui.notifications.error('상태이상 타입이 지정되지 않았습니다.');
    return;
  }
  
  window.DX3rdDebug.log(`DX3rd | Condition type: ${conditionType}`);

  // Single and multiple conditions must go through the same path. That is what keeps the special inputs and the
  // poison rank settled exactly once, on the firing client.
  await this.executeConditionExtensionsNowBulk(actor, {
    conditionTypes: [conditionType],
    target,
    selectedTargetIds: selectedTargetIds || [],
    targetsFrozen,
    triggerItemName: triggerItemName || item?.name || null,
    poisonedRank: poisonedRank || null,
    itemId: item?.id || null,
    duration: conditionData.disable || null,
    sourceActorId: actor.id
  });
};

/**
 * Run several conditions immediately (for the same timing / same target bucket)
 * @param {Actor} actor
 * @param {Object} bulkData - { conditionTypes: string[], target, selectedTargetIds, triggerItemName, poisonedRank }
 */
window.DX3rdUniversalHandler.executeConditionExtensionsNowBulk = async function(actor, bulkData) {
  const { conditionTypes = [], target, selectedTargetIds, targetsFrozen = false, triggerItemName, poisonedRank, itemId, duration, sourceActorId } = bulkData || {};
  if (!Array.isArray(conditionTypes) || conditionTypes.length === 0) return;
  // Collect the targets (exactly once)
  const targets = [];
  if (target === 'self' || target === 'targetAll') targets.push(actor);
  if (target === 'targetToken' || target === 'targetAll') {
    if (targetsFrozen || (selectedTargetIds && selectedTargetIds.length > 0)) {
      (selectedTargetIds || []).forEach(tokenId => {
        const token = canvas.tokens.get(tokenId);
        if (token?.actor && !targets.find(a => a.id === token.actor.id)) targets.push(token.actor);
      });
    } else {
      const selected = Array.from(game.user.targets);
      selected.forEach(t => { if (t.actor && !targets.find(a => a.id === t.actor.id)) targets.push(t.actor); });
    }
  }
  if (targets.length === 0) {
    ui.notifications.warn('상태이상 대상이 없습니다.');
    return;
  }
  const requestData = {
    userId: game.user.id,
    actorId: actor.id,
    actorName: actor.name,
    targets: targets.map(t => ({ id: t.id, name: t.name })),
    conditionTypes,
    triggerItemName: triggerItemName || null,
    poisonedRank: poisonedRank || null,
    itemId: itemId || null,
    duration: duration || null,
    sourceActorId: sourceActorId || actor.id
  };
  // The special status choice and the poison roll are settled by the firer before the apply permission is relayed.
  // The owner / representative GM then applies only the settled values.
  const resolvedData = await this.handleConditionRequestBulk({
    ...requestData,
    targets: [],
    resolveOnly: true
  });
  if (!resolvedData) return;
  requestData.poisonedRank = resolvedData.poisonedRank;
  requestData.specialConditions = resolvedData.specialConditions;
  const localTargets = targets.filter(targetActor => game.user.isGM || targetActor.isOwner);
  const remoteTargets = targets.filter(targetActor => !localTargets.includes(targetActor));
  if (localTargets.length) {
    await this.handleConditionRequestBulk({
      ...requestData,
      targets: localTargets.map(targetActor => ({ id: targetActor.id, name: targetActor.name }))
    });
  }
  if (remoteTargets.length) {
    window.DX3rdSocketRouter.emit({
      type: 'conditionApplyBulk',
      data: {
        ...requestData,
        targets: remoteTargets.map(targetActor => ({ id: targetActor.id, name: targetActor.name }))
      }
    });
  }
};

/**
 * Handle a multi-condition request (GM only) — approved from a single dialog
 */
window.DX3rdUniversalHandler.handleConditionRequestBulk = async function(requestData) {
  const { userId, actorId, actorName, targets, conditionTypes = [], triggerItemName, resolveOnly = false } = requestData;
  let { poisonedRank } = requestData;
  if (conditionTypes.length === 0) return;
  
  // When the poison rank is a formula string it is evaluated to a number here (it may already have been evaluated during the merge)
  window.DX3rdDebug.log('DX3rd | handleConditionRequestBulk - Initial poisonedRank:', poisonedRank, 'conditionTypes:', conditionTypes);
  try {
    if (conditionTypes.includes('poisoned') && poisonedRank !== undefined && poisonedRank !== null) {
      // A number is used as-is; a string is evaluated exactly once, right after approval.
      if (typeof poisonedRank === 'number') {
        window.DX3rdDebug.log('DX3rd | Poisoned rank already evaluated:', poisonedRank);
      } else if (typeof poisonedRank === 'string' && poisonedRank.trim() !== '') {
        window.DX3rdDebug.log('DX3rd | Poisoned rank detected, checking if formula:', poisonedRank);
        if (typeof window.DX3rdFormulaEvaluator?.evaluateRoll === 'function') {
          const actor = game.actors.get(actorId);
          const item = requestData.itemId ? actor?.items.get(requestData.itemId) : null;
          const itemLevel = item?.system?.level?.value ?? 1;
          const itemForFormula = item ? item : { type: 'effect', system: { level: { value: itemLevel } } };
          const resolved = await window.DX3rdFormulaEvaluator.evaluateRoll(poisonedRank, itemForFormula, actor);
          const evaluated = resolved.total;
          if (resolved.roll) {
            await resolved.roll.toMessage({
              speaker: ChatMessage.getSpeaker({ actor }),
              flavor: `사독 랭크 (${resolved.formula}) → ${evaluated}`
            });
          }
          const num = Number(evaluated);
          window.DX3rdDebug.log('DX3rd | Evaluated poisonedRank formula:', poisonedRank, '→', evaluated, '→', num);
          if (!Number.isNaN(num) && Number.isFinite(num) && num > 0) poisonedRank = num;
        } else {
          poisonedRank = Number(poisonedRank) || 0;
        }
      }
    }
  } catch (e) {
    console.warn('DX3rd | Failed to evaluate poisonedRank formula in bulk:', e);
  }
  window.DX3rdDebug.log('DX3rd | handleConditionRequestBulk - Final poisonedRank:', poisonedRank);
  
  // 💡 For a special condition (hatred / fear / berserk), take the input in advance
  const specialConditions = { ...(requestData.specialConditions || {}) };
  for (const ct of conditionTypes) {
    if (specialConditions[ct] !== undefined) continue;
    if (ct === 'hatred') {
      // Hatred: choose another token in the current scene
      const currentScene = game.scenes.active;
      if (!currentScene) {
        ui.notifications.warn("활성화된 장면이 없습니다.");
        return;
      }
      
      // Get the target actor ID (the first target)
      const targetActorId = (targets && targets[0]) ? targets[0].id : null;
      
      const otherTokens = currentScene.tokens
        .filter(t => t.actor && t.actor.id !== targetActorId && !t.hidden)
        .map(t => ({ id: t.id, name: t.name }))
        .sort((a, b) => a.name.localeCompare(b.name, 'ko'));
      
      if (otherTokens.length === 0) {
        ui.notifications.warn("선택할 수 있는 토큰이 없습니다.");
        return;
      }
      
      // The token name is both the value and the button label; it never round-trips
      // through HTML, so no escaping is needed to get the original string back.
      const hatredTarget = await window.DX3rdUniversalHandler._promptConditionChoice({
        title: game.i18n.localize("DX3rd.Hatred"),
        label: game.i18n.localize("DX3rd.HatredInputText"),
        options: otherTokens.map(t => ({ value: t.name, label: t.name }))
      });
      
      if (hatredTarget) {
        specialConditions[ct] = hatredTarget;
        window.DX3rdDebug.log(`DX3rd | Hatred target set:`, hatredTarget);
      } else {
        window.DX3rdDebug.log(`DX3rd | Hatred cancelled`);
        return;
      }
    } else if (ct === 'fear') {
      // Fear: choose another token in the current scene
      const currentScene = game.scenes.active;
      if (!currentScene) {
        ui.notifications.warn("활성화된 장면이 없습니다.");
        return;
      }
      
      // Get the target actor ID (the first target)
      const targetActorId = (targets && targets[0]) ? targets[0].id : null;
      
      const otherTokens = currentScene.tokens
        .filter(t => t.actor && t.actor.id !== targetActorId && !t.hidden)
        .map(t => ({ id: t.id, name: t.name }))
        .sort((a, b) => a.name.localeCompare(b.name, 'ko'));
      
      if (otherTokens.length === 0) {
        ui.notifications.warn("선택할 수 있는 토큰이 없습니다.");
        return;
      }
      
      // The token name is both the value and the button label; it never round-trips
      // through HTML, so no escaping is needed to get the original string back.
      const fearTarget = await window.DX3rdUniversalHandler._promptConditionChoice({
        title: game.i18n.localize("DX3rd.Fear"),
        label: game.i18n.localize("DX3rd.FearInputText"),
        options: otherTokens.map(t => ({ value: t.name, label: t.name }))
      });
      
      if (fearTarget) {
        specialConditions[ct] = fearTarget;
        window.DX3rdDebug.log(`DX3rd | Fear target set:`, fearTarget);
      } else {
        window.DX3rdDebug.log(`DX3rd | Fear cancelled`);
        return;
      }
    } else if (ct === 'berserk') {
      // Berserk: choose the type
      const berserkTypes = [
        { value: "normal", label: game.i18n.localize("DX3rd.Normal") },
        { value: "release", label: game.i18n.localize("DX3rd.UrgeRelease") },
        { value: "hunger", label: game.i18n.localize("DX3rd.UrgeHunger") },
        { value: "bloodsucking", label: game.i18n.localize("DX3rd.UrgeBloodsucking") },
        { value: "slaughter", label: game.i18n.localize("DX3rd.UrgeSlaughter") },
        { value: "destruction", label: game.i18n.localize("DX3rd.UrgeDestruction") },
        { value: "tourture", label: game.i18n.localize("DX3rd.UrgeTourture") },
        { value: "distaste", label: game.i18n.localize("DX3rd.UrgeDistaste") },
        { value: "battlelust", label: game.i18n.localize("DX3rd.UrgeBattlelust") },
        { value: "delusion", label: game.i18n.localize("DX3rd.UrgeDelusion") },
        { value: "selfmutilation", label: game.i18n.localize("DX3rd.UrgeSelfmutilation") },
        { value: "fear", label: game.i18n.localize("DX3rd.UrgeFear") },
        { value: "hatred", label: game.i18n.localize("DX3rd.UrgeHatred") }
      ];
      
      const berserkType = await window.DX3rdUniversalHandler._promptConditionChoice({
        title: game.i18n.localize("DX3rd.Berserk"),
        label: game.i18n.localize("DX3rd.BerserkInputText"),
        options: berserkTypes
      });
      
      if (berserkType) {
        specialConditions[ct] = berserkType;
        window.DX3rdDebug.log(`DX3rd | Berserk type set:`, berserkType);
      } else {
        window.DX3rdDebug.log(`DX3rd | Berserk cancelled`);
        return;
      }
    }
  }

  if (resolveOnly) return { poisonedRank, specialConditions };
  
  // Apply
  for (const targetData of (targets || [])) {
    const targetActor = game.actors.get(targetData.id);
    if (!targetActor) continue;
    for (const ct of conditionTypes) {
      try {
        const already = targetActor.effects.find(e => e.statuses.has(ct));
        // For poison, pass the evaluated rank
        const rankToPass = (ct === 'poisoned' && poisonedRank) ? poisonedRank : null;
        // For a special condition, pass the value that was entered
        const specialTarget = specialConditions[ct] || null;
        window.DX3rdDebug.log(`DX3rd | Applying condition ${ct} to ${targetActor.name}, rankToPass:`, rankToPass, 'specialTarget:', specialTarget);
        if (already) {
          // Already active: call the update routine directly (using the default handler)
          let token = targetActor.token;
          if (!token && canvas.scene) {
            const tokenDoc = canvas.scene.tokens.find(t => t.actorId === targetActor.id);
            if (tokenDoc) token = tokenDoc.object || { actor: targetActor };
          }
          if (typeof window.handleConditionToggle === 'function') {
            await window.handleConditionToggle(token || { actor: targetActor }, ct, true, triggerItemName || null, rankToPass, specialTarget);
          } else if (typeof window.DX3rdHandleConditionToggle === 'function') {
            await window.DX3rdHandleConditionToggle(token || { actor: targetActor }, ct, true, triggerItemName || null, rankToPass, specialTarget);
          } else {
            // Fallback: store on the map, then toggle
            const key = `${targetActor.id}:${ct}`;
            if (!window.DX3rdConditionTriggerMap) window.DX3rdConditionTriggerMap = new Map();
            window.DX3rdConditionTriggerMap.set(key, { trigger: (triggerItemName||null), poisonedRank: rankToPass, specialTarget: specialTarget });
            await targetActor.toggleStatusEffect(ct, { active: true });
          }
        } else {
          // New: store on the map and create it by toggling → the hook posts the message
          const key = `${targetActor.id}:${ct}`;
          if (!window.DX3rdConditionTriggerMap) window.DX3rdConditionTriggerMap = new Map();
          window.DX3rdDebug.log(`DX3rd | Storing in map - key: ${key}, trigger: ${triggerItemName}, poisonedRank: ${rankToPass}, specialTarget: ${specialTarget}`);
          window.DX3rdConditionTriggerMap.set(key, { trigger: (triggerItemName||null), poisonedRank: rankToPass, specialTarget: specialTarget });
          await targetActor.toggleStatusEffect(ct, { active: true });
        }
        await window.DX3rdConditionSources.track(targetActor, ct, {
          duration: requestData.duration,
          itemId: requestData.itemId,
          sourceActorId: requestData.sourceActorId || actorId,
          preExisting: Boolean(already)
        });
      } catch (e) { console.error('DX3rd | Failed to apply condition', ct, 'to', targetActor?.name, e); }
    }
    // Chat is unified on the default message in the condtions hook (nothing is printed here)
  }
};

/**
 * Handle a condition request (GM only)
 */
window.DX3rdUniversalHandler.handleConditionRequest = async function(requestData) {
  
  // Coming from afterSuccess: conditionData is present
  if (requestData.conditionData) {
    const actor = game.actors.get(requestData.actorId);
    const item = requestData.itemId ? actor?.items.get(requestData.itemId) : null;
    
    // Call executeConditionExtensionNow directly
    await this.executeConditionExtensionNow(actor, requestData.conditionData, item);
    return;
  }
  
  // Coming from instant: the existing logic
  const { userId, actorId, actorName, targets, conditionType, triggerItemName } = requestData;
  let { poisonedRank } = requestData;

  // The poison rank is resolved only right after approval. For a dice formula the Roll result is kept as well.
  try {
    if (conditionType === 'poisoned' && poisonedRank !== undefined && poisonedRank !== null && `${poisonedRank}`.trim() !== '') {
      if (typeof window.DX3rdFormulaEvaluator?.evaluateRoll === 'function' && typeof poisonedRank === 'string') {
        const actor = game.actors.get(actorId);
        // Use the item context when there is one (the request data may carry an itemId)
        const item = requestData.itemId ? actor?.items.get(requestData.itemId) : null;
        const itemLevel = item?.system?.level?.value ?? 1;
        const itemForFormula = item ? item : { type: 'effect', system: { level: { value: itemLevel } } };
        const resolved = await window.DX3rdFormulaEvaluator.evaluateRoll(poisonedRank, itemForFormula, actor);
        const evaluated = resolved.total;
        if (resolved.roll) {
          await resolved.roll.toMessage({
            speaker: ChatMessage.getSpeaker({ actor }),
            flavor: `사독 랭크 (${resolved.formula}) → ${evaluated}`
          });
        }
        const num = Number(evaluated);
        if (!Number.isNaN(num) && Number.isFinite(num) && num > 0) poisonedRank = num;
      }
    }
  } catch (e) {
    console.warn('DX3rd | Failed to evaluate poisonedRank formula:', e);
  }
  
  // Apply the condition to each target
  window.DX3rdDebug.log(`DX3rd | Applying condition to ${targets.length} targets, conditionType: ${conditionType}`);
  
  for (const targetData of targets) {
    const targetActor = game.actors.get(targetData.id);
    if (!targetActor) {
      console.warn(`DX3rd | Target actor not found: ${targetData.id}`);
      continue;
    }
    
    window.DX3rdDebug.log(`DX3rd | Applying ${conditionType} to ${targetActor.name}`);
    
    // Apply the condition through toggleStatusEffect
    try {
      const already = targetActor.effects.find(e => e.statuses.has(conditionType));
      if (already) {
        let token = targetActor.token;
        if (!token && canvas.scene) {
          const tokenDoc = canvas.scene.tokens.find(t => t.actorId === targetActor.id);
          if (tokenDoc) token = tokenDoc.object || { actor: targetActor };
        }
        if (typeof window.handleConditionToggle === 'function') {
          await window.handleConditionToggle(token || { actor: targetActor }, conditionType, true, triggerItemName || null, (conditionType==='poisoned' ? (poisonedRank||null) : null));
        } else if (typeof window.DX3rdHandleConditionToggle === 'function') {
          await window.DX3rdHandleConditionToggle(token || { actor: targetActor }, conditionType, true, triggerItemName || null, (conditionType==='poisoned' ? (poisonedRank||null) : null));
        } else {
          const key = `${targetActor.id}:${conditionType}`;
          if (!window.DX3rdConditionTriggerMap) window.DX3rdConditionTriggerMap = new Map();
          window.DX3rdConditionTriggerMap.set(key, { trigger: (triggerItemName||null), poisonedRank: (conditionType==='poisoned'? (poisonedRank||null): null) });
          await targetActor.toggleStatusEffect(conditionType, { active: true });
        }
      } else {
        const key = `${targetActor.id}:${conditionType}`;
        if (!window.DX3rdConditionTriggerMap) window.DX3rdConditionTriggerMap = new Map();
        window.DX3rdConditionTriggerMap.set(key, { trigger: (triggerItemName||null), poisonedRank: (conditionType==='poisoned'? (poisonedRank||null): null) });
        await targetActor.toggleStatusEffect(conditionType, { active: true });
      }
      window.DX3rdDebug.log(`DX3rd | toggleStatusEffect completed for ${targetActor.name}`);
      const hasEffect = targetActor.effects.find(e => e.statuses.has(conditionType));
      window.DX3rdDebug.log(`DX3rd | Condition effect exists: ${!!hasEffect}`);
    } catch (error) {
      console.error(`DX3rd | Failed to apply condition to ${targetActor.name}:`, error);
      continue;
    }
    // Chat is unified on the default message in the condtions hook (nothing is printed here)
  }
  
  window.DX3rdDebug.log(`DX3rd | All conditions applied successfully`);
};
