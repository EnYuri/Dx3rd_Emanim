// ========== 상태이상 시스템 ========== //
/**
 * 코어 상태 AE에 익스텐션의 출처를 기록한다. 상태 자체는 Foundry의 상태 효과로
 * 유지하되, 각 출처의 disable 수명이 끝날 때만 안전하게 해제한다.
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
 * itemExtend.condition에서 활성화된 조건 항목 배열 반환 (conditions 배열 또는 기존 단일 형식)
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
 * 상태이상 익스텐션 실행
 * @param {Actor} actor - 사용자 액터
 * @param {Object} conditionData - 상태이상 데이터
 * @param {Item} item - 연동된 아이템 (옵션)
 */
window.DX3rdUniversalHandler.executeConditionExtension = async function(actor, conditionData, item = null) {
  window.DX3rdDebug.log('DX3rd | executeConditionExtension called', { actor: actor.name, conditionData, item: item?.name });
  
  const { timing } = conditionData;
  
  // afterMain, afterDamage, afterSuccess는 각 버튼/호출 지점에서 직접 큐에 등록하므로 여기서는 처리 안 함
  if (timing === 'afterMain' || timing === 'afterDamage' || timing === 'afterSuccess') {
    window.DX3rdDebug.log(`DX3rd | ${timing} timing - will be handled by caller or button handler`);
    return;
  }
  
  // instant 타이밍이면 즉시 실행
  await this.executeConditionExtensionNow(actor, conditionData, item);
};

/**
 * 상태이상 익스텐션 즉시 실행
 * @param {Actor} actor - 사용자 액터
 * @param {Object} conditionData - 상태이상 데이터
 * @param {Item} item - 연동된 아이템 (옵션)
 */
window.DX3rdUniversalHandler.executeConditionExtensionNow = async function(actor, conditionData, item = null) {
  window.DX3rdDebug.log('DX3rd | executeConditionExtensionNow called', { actor: actor.name, conditionData, item: item?.name });
  
  const { target, selectedTargetIds, triggerItemName, poisonedRank } = conditionData;
  
  // conditionTypes 배열이 있으면 복수 상태이상 → executeConditionExtensionsNowBulk 호출
  const conditionTypes = conditionData.conditionTypes;
  if (Array.isArray(conditionTypes) && conditionTypes.length > 0) {
    const bulkData = {
      conditionTypes,
      target,
      selectedTargetIds: selectedTargetIds || [],
      triggerItemName: triggerItemName || item?.name || null,
      poisonedRank: poisonedRank || null,
      itemId: item?.id || null,
      duration: conditionData.disable || null,
      sourceActorId: actor.id
    };
    await this.executeConditionExtensionsNowBulk(actor, bulkData);
    return;
  }
  
  // 단일 상태이상: conditionType 또는 type 필드
  const conditionType = conditionData.conditionType || conditionData.type;
  if (!conditionType) {
    console.error('DX3rd | conditionType is missing from conditionData:', conditionData);
    ui.notifications.error('상태이상 타입이 지정되지 않았습니다.');
    return;
  }
  
  window.DX3rdDebug.log(`DX3rd | Condition type: ${conditionType}`);

  // 단일/복수 상태이상은 반드시 같은 경로로 처리한다. 그래야 특수 입력과
  // 사독 랭크도 발동 클라이언트에서 한 번만 확정된다.
  await this.executeConditionExtensionsNowBulk(actor, {
    conditionTypes: [conditionType],
    target,
    selectedTargetIds: selectedTargetIds || [],
    triggerItemName: triggerItemName || item?.name || null,
    poisonedRank: poisonedRank || null,
    itemId: item?.id || null,
    duration: conditionData.disable || null,
    sourceActorId: actor.id
  });
};

/**
 * 상태이상 다건 즉시 실행(같은 타이밍/같은 대상 버킷용)
 * @param {Actor} actor
 * @param {Object} bulkData - { conditionTypes: string[], target, selectedTargetIds, triggerItemName, poisonedRank }
 */
window.DX3rdUniversalHandler.executeConditionExtensionsNowBulk = async function(actor, bulkData) {
  const { conditionTypes = [], target, selectedTargetIds, triggerItemName, poisonedRank, itemId, duration, sourceActorId } = bulkData || {};
  if (!Array.isArray(conditionTypes) || conditionTypes.length === 0) return;
  // 대상 수집(단 한 번)
  const targets = [];
  if (target === 'self' || target === 'targetAll') targets.push(actor);
  if (target === 'targetToken' || target === 'targetAll') {
    if (selectedTargetIds && selectedTargetIds.length > 0) {
      selectedTargetIds.forEach(tokenId => {
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
  // 특수 상태 선택과 사독 굴림은 적용 권한을 중계하기 전에 발동자가 확정한다.
  // 이후 소유자/대표 GM은 확정된 값만 적용한다.
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
 * 상태이상 다건 요청 처리(GM 전용) - 한 번의 다이얼로그에서 승인
 */
window.DX3rdUniversalHandler.handleConditionRequestBulk = async function(requestData) {
  const { userId, actorId, actorName, targets, conditionTypes = [], triggerItemName, resolveOnly = false } = requestData;
  let { poisonedRank } = requestData;
  if (conditionTypes.length === 0) return;
  
  // 사독 랭크가 포뮬러 문자열인 경우 여기서 숫자로 평가 (병합 시 이미 평가됐을 수도 있음)
  window.DX3rdDebug.log('DX3rd | handleConditionRequestBulk - Initial poisonedRank:', poisonedRank, 'conditionTypes:', conditionTypes);
  try {
    if (conditionTypes.includes('poisoned') && poisonedRank !== undefined && poisonedRank !== null) {
      // 이미 숫자면 그대로 사용, 문자열은 승인 직후 한 번만 평가한다.
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
  
  // 💡 특수 상태이상(증오/공포/폭주)의 경우 미리 입력 받기
  const specialConditions = { ...(requestData.specialConditions || {}) };
  for (const ct of conditionTypes) {
    if (specialConditions[ct] !== undefined) continue;
    if (ct === 'hatred') {
      // 증오: 현재 씬의 다른 토큰 선택
      const currentScene = game.scenes.active;
      if (!currentScene) {
        ui.notifications.warn("활성화된 장면이 없습니다.");
        return;
      }
      
      // 대상 액터 ID 가져오기 (첫 번째 타겟)
      const targetActorId = (targets && targets[0]) ? targets[0].id : null;
      
      const otherTokens = currentScene.tokens
        .filter(t => t.actor && t.actor.id !== targetActorId && !t.hidden)
        .map(t => ({ id: t.id, name: t.name }))
        .sort((a, b) => a.name.localeCompare(b.name, 'ko'));
      
      if (otherTokens.length === 0) {
        ui.notifications.warn("선택할 수 있는 토큰이 없습니다.");
        return;
      }
      
      const options = otherTokens.map(t => `<option value="${t.name}">${t.name}</option>`).join('');
      const template = `
        <div class="condition-rank-dialog">
          <div class="form-group">
            <label>${game.i18n.localize("DX3rd.HatredInputText")}</label>
            <select id="condition-target" style="width: 100%; text-align: center;">
              ${options}
            </select>
          </div>
        </div>
        <style>
        .condition-rank-dialog { padding: 5px; }
        .condition-rank-dialog .form-group { display: flex; flex-direction: column; gap: 8px; margin-top: 0px; margin-bottom: 5px; }
        .condition-rank-dialog label { font-weight: bold; font-size: 14px; }
        .condition-rank-dialog select { padding: 4px; font-size: 14px; border: 1px solid #ccc; border-radius: 4px; background: white; color: black; }
        </style>
      `;
      
      const DialogV2 = foundry.applications?.api?.DialogV2;
      if (!DialogV2?.wait) {
        ui.notifications.error(game.i18n.localize('DX3rd.DialogV2Unavailable'));
        return;
      }

      const hatredTarget = await DialogV2.wait({
        window: { title: game.i18n.localize("DX3rd.Hatred") },
        content: template,
        rejectClose: false,
        buttons: [
          {
            action: 'confirm',
            icon: '<i class="fas fa-check"></i>',
            label: game.i18n.localize("DX3rd.Confirm"),
            default: true,
            callback: (event, button) => {
              const root = button.form || button.element?.closest('.application') || button.element?.ownerDocument;
              return root?.querySelector("#condition-target")?.value || null;
            }
          },
          {
            action: 'cancel',
            icon: '<i class="fas fa-times"></i>',
            label: game.i18n.localize("DX3rd.Cancel"),
            callback: () => null
          }
        ]
      });
      
      if (hatredTarget) {
        specialConditions[ct] = hatredTarget;
        window.DX3rdDebug.log(`DX3rd | Hatred target set:`, hatredTarget);
      } else {
        window.DX3rdDebug.log(`DX3rd | Hatred cancelled`);
        return;
      }
    } else if (ct === 'fear') {
      // 공포: 현재 씬의 다른 토큰 선택
      const currentScene = game.scenes.active;
      if (!currentScene) {
        ui.notifications.warn("활성화된 장면이 없습니다.");
        return;
      }
      
      // 대상 액터 ID 가져오기 (첫 번째 타겟)
      const targetActorId = (targets && targets[0]) ? targets[0].id : null;
      
      const otherTokens = currentScene.tokens
        .filter(t => t.actor && t.actor.id !== targetActorId && !t.hidden)
        .map(t => ({ id: t.id, name: t.name }))
        .sort((a, b) => a.name.localeCompare(b.name, 'ko'));
      
      if (otherTokens.length === 0) {
        ui.notifications.warn("선택할 수 있는 토큰이 없습니다.");
        return;
      }
      
      const options = otherTokens.map(t => `<option value="${t.name}">${t.name}</option>`).join('');
      const template = `
        <div class="condition-rank-dialog">
          <div class="form-group">
            <label>${game.i18n.localize("DX3rd.FearInputText")}</label>
            <select id="condition-target" style="width: 100%; text-align: center;">
              ${options}
            </select>
          </div>
        </div>
        <style>
        .condition-rank-dialog { padding: 5px; }
        .condition-rank-dialog .form-group { display: flex; flex-direction: column; gap: 8px; margin-top: 0px; margin-bottom: 5px; }
        .condition-rank-dialog label { font-weight: bold; font-size: 14px; }
        .condition-rank-dialog select { padding: 4px; font-size: 14px; border: 1px solid #ccc; border-radius: 4px; background: white; color: black; }
        </style>
      `;
      
      const DialogV2 = foundry.applications?.api?.DialogV2;
      if (!DialogV2?.wait) {
        ui.notifications.error(game.i18n.localize('DX3rd.DialogV2Unavailable'));
        return;
      }

      const fearTarget = await DialogV2.wait({
        window: { title: game.i18n.localize("DX3rd.Fear") },
        content: template,
        rejectClose: false,
        buttons: [
          {
            action: 'confirm',
            icon: '<i class="fas fa-check"></i>',
            label: game.i18n.localize("DX3rd.Confirm"),
            default: true,
            callback: (event, button) => {
              const root = button.form || button.element?.closest('.application') || button.element?.ownerDocument;
              return root?.querySelector("#condition-target")?.value || null;
            }
          },
          {
            action: 'cancel',
            icon: '<i class="fas fa-times"></i>',
            label: game.i18n.localize("DX3rd.Cancel"),
            callback: () => null
          }
        ]
      });
      
      if (fearTarget) {
        specialConditions[ct] = fearTarget;
        window.DX3rdDebug.log(`DX3rd | Fear target set:`, fearTarget);
      } else {
        window.DX3rdDebug.log(`DX3rd | Fear cancelled`);
        return;
      }
    } else if (ct === 'berserk') {
      // 폭주: 타입 선택
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
      
      const options = berserkTypes.map(t => `<option value="${t.value}">${t.label}</option>`).join('');
      const template = `
        <div class="condition-rank-dialog">
          <div class="form-group">
            <label>${game.i18n.localize("DX3rd.BerserkInputText")}</label>
            <select id="condition-type" style="width: 100%; text-align: center;">
              ${options}
            </select>
          </div>
        </div>
        <style>
        .condition-rank-dialog { padding: 5px; }
        .condition-rank-dialog .form-group { display: flex; flex-direction: column; gap: 8px; margin-top: 0px; margin-bottom: 5px; }
        .condition-rank-dialog label { font-weight: bold; font-size: 14px; }
        .condition-rank-dialog select { padding: 4px; font-size: 14px; border: 1px solid #ccc; border-radius: 4px; background: white; color: black; }
        </style>
      `;
      
      const DialogV2 = foundry.applications?.api?.DialogV2;
      if (!DialogV2?.wait) {
        ui.notifications.error(game.i18n.localize('DX3rd.DialogV2Unavailable'));
        return;
      }

      const berserkType = await DialogV2.wait({
        window: { title: game.i18n.localize("DX3rd.Berserk") },
        content: template,
        rejectClose: false,
        buttons: [
          {
            action: 'confirm',
            icon: '<i class="fas fa-check"></i>',
            label: game.i18n.localize("DX3rd.Confirm"),
            default: true,
            callback: (event, button) => {
              const root = button.form || button.element?.closest('.application') || button.element?.ownerDocument;
              return root?.querySelector("#condition-type")?.value || null;
            }
          },
          {
            action: 'cancel',
            icon: '<i class="fas fa-times"></i>',
            label: game.i18n.localize("DX3rd.Cancel"),
            callback: () => null
          }
        ]
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
  
  // 적용
  for (const targetData of (targets || [])) {
    const targetActor = game.actors.get(targetData.id);
    if (!targetActor) continue;
    for (const ct of conditionTypes) {
      try {
        const already = targetActor.effects.find(e => e.statuses.has(ct));
        // 사독이면 평가된 랭크 전달
        const rankToPass = (ct === 'poisoned' && poisonedRank) ? poisonedRank : null;
        // 특수 상태이상이면 입력받은 값 전달
        const specialTarget = specialConditions[ct] || null;
        window.DX3rdDebug.log(`DX3rd | Applying condition ${ct} to ${targetActor.name}, rankToPass:`, rankToPass, 'specialTarget:', specialTarget);
        if (already) {
          // 이미 활성: 직접 갱신 루틴 호출(기본 핸들러 사용)
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
            // 폴백: 맵에 저장 후 토글
            const key = `${targetActor.id}:${ct}`;
            if (!window.DX3rdConditionTriggerMap) window.DX3rdConditionTriggerMap = new Map();
            window.DX3rdConditionTriggerMap.set(key, { trigger: (triggerItemName||null), poisonedRank: rankToPass, specialTarget: specialTarget });
            await targetActor.toggleStatusEffect(ct, { active: true });
          }
        } else {
          // 신규: 맵 저장 후 토글로 생성 → 훅에서 메시지
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
    // 채팅은 condtions 훅에서 기본 메시지로 일원화 (여기서는 출력 안 함)
  }
};

/**
 * 상태이상 요청 처리 (GM 전용)
 */
window.DX3rdUniversalHandler.handleConditionRequest = async function(requestData) {
  
  // afterSuccess에서 온 경우: conditionData가 있음
  if (requestData.conditionData) {
    const actor = game.actors.get(requestData.actorId);
    const item = requestData.itemId ? actor?.items.get(requestData.itemId) : null;
    
    // executeConditionExtensionNow 직접 호출
    await this.executeConditionExtensionNow(actor, requestData.conditionData, item);
    return;
  }
  
  // instant에서 온 경우: 기존 로직
  const { userId, actorId, actorName, targets, conditionType, triggerItemName } = requestData;
  let { poisonedRank } = requestData;

  // 사독 랭크는 승인 직후에만 해석한다. 다이스식이라면 Roll 결과도 함께 남긴다.
  try {
    if (conditionType === 'poisoned' && poisonedRank !== undefined && poisonedRank !== null && `${poisonedRank}`.trim() !== '') {
      if (typeof window.DX3rdFormulaEvaluator?.evaluateRoll === 'function' && typeof poisonedRank === 'string') {
        const actor = game.actors.get(actorId);
        // 아이템 컨텍스트가 있다면 사용 (요청 데이터에 itemId가 있을 수도 있음)
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
  
  // 각 대상에게 상태이상 적용
  window.DX3rdDebug.log(`DX3rd | Applying condition to ${targets.length} targets, conditionType: ${conditionType}`);
  
  for (const targetData of targets) {
    const targetActor = game.actors.get(targetData.id);
    if (!targetActor) {
      console.warn(`DX3rd | Target actor not found: ${targetData.id}`);
      continue;
    }
    
    window.DX3rdDebug.log(`DX3rd | Applying ${conditionType} to ${targetActor.name}`);
    
    // toggleStatusEffect 사용하여 상태이상 적용
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
    // 채팅은 condtions 훅에서 기본 메시지로 일원화 (여기서는 출력 안 함)
  }
  
  window.DX3rdDebug.log(`DX3rd | All conditions applied successfully`);
};
