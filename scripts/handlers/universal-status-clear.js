// Status-clear extension routines
(function() {
  const handler = window.DX3rdUniversalHandler;
  if (!handler) {
    console.error('DX3rd | Universal handler must load before status-clear routines');
    return;
  }

  // 배드 스테이터스 집합(시스템 status id): 폭주/증오/공포/경직/중압/방심/사독
  handler.BAD_STATUSES = ['berserk', 'hatred', 'fear', 'rigor', 'pressure', 'dazed', 'poisoned'];

  /**
   * 상태이상 소거 익스텐션 실행: 대상의 배드 스테이터스를 일괄 소거(exclude 제외).
   * 소유 대상은 즉시 소거하고, 권한이 없는 대상만 대표 GM이 자동 중계한다.
   */
  handler.executeStatusClearExtension = async function(actor, data, item = null) {
    if (!actor || !data) return;
    const { target = 'self', exclude = [], selectedTargetIds } = data;
    const targets = [];
    if (target === 'self' || target === 'targetAll') targets.push(actor);
    if (target === 'targetToken' || target === 'targetAll') {
      if (selectedTargetIds && selectedTargetIds.length > 0) {
        selectedTargetIds.forEach(id => {
          const token = canvas.tokens.get(id);
          if (token?.actor && !targets.find(targetActor => targetActor.id === token.actor.id)) targets.push(token.actor);
        });
      } else {
        Array.from(game.user.targets).forEach(token => {
          if (token.actor && !targets.find(targetActor => targetActor.id === token.actor.id)) targets.push(token.actor);
        });
      }
    }
    if (targets.length === 0) {
      ui.notifications.warn('상태이상 소거 대상이 없습니다.');
      return;
    }
    const requestData = {
      userId: game.user.id,
      actorName: actor.name,
      targets: targets.map(targetActor => ({ id: targetActor.id, name: targetActor.name })),
      exclude: Array.isArray(exclude) ? exclude : [],
      triggerItemName: item?.name || null
    };
    const localTargets = targets.filter(targetActor => game.user.isGM || targetActor.isOwner);
    const remoteTargets = targets.filter(targetActor => !localTargets.includes(targetActor));
    if (localTargets.length) {
      await handler.handleStatusClearRequest({ ...requestData, targets: localTargets.map(targetActor => ({ id: targetActor.id, name: targetActor.name })) });
    }
    if (remoteTargets.length) {
      game.socket.emit('system.dx3rd-emanim', {
        type: 'statusClearApply',
        requestData: { ...requestData, targets: remoteTargets.map(targetActor => ({ id: targetActor.id, name: targetActor.name })) }
      });
    }
  };

  /** 상태이상 소거 적용: 대상의 배드 스테이터스를 toggle off. */
  handler.handleStatusClearRequest = async function(requestData) {
    const { targets = [], exclude = [] } = requestData;
    const excludedStatuses = new Set(exclude || []);
    const removableStatuses = handler.BAD_STATUSES.filter(status => !excludedStatuses.has(status));
    for (const targetData of targets) {
      const targetActor = game.actors.get(targetData.id);
      if (!targetActor) continue;
      const cleared = [];
      for (const status of removableStatuses) {
        const isActive = (targetActor.statuses && targetActor.statuses.has(status)) || targetActor.system?.conditions?.[status]?.active;
        if (!isActive) continue;
        try {
          await targetActor.toggleStatusEffect(status, { active: false });
          cleared.push(status);
        } catch (error) {
          console.error('DX3rd | statusClear toggle failed', status, targetActor.name, error);
        }
      }
      console.log(`DX3rd | statusClear: ${targetActor.name} cleared [${cleared.join(',')}]`);
    }
  };
})();
