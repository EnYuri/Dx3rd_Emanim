// Typed socket handlers for document mutations and lightweight canvas synchronization.
(function() {
  const router = window.DX3rdSocketRouter;
  if (!router) {
    console.error('DX3rd | Socket router is unavailable for document handlers.');
    return;
  }
  const register = (types, handler, options = {}) => router.registerType(types, handler, {
    ...options,
    consume: true
  });

  register('actionTrackerConsume', data => window.DX3rdTurnProcessUI?.updateUsage?.(data.payload), {
    responsibleGMOnly: true
  });

  register(['healRequest', 'healApply'], data => {
    return window.DX3rdUniversalHandler?.handleHealRequest?.(data.requestData);
  }, { responsibleGMOnly: true });

  register(['statusClearRequest', 'statusClearApply'], data => {
    return window.DX3rdUniversalHandler?.handleStatusClearRequest?.(data.requestData);
  }, { responsibleGMOnly: true });

  register('encroachRequest', data => {
    return window.DX3rdUniversalHandler?.handleEncroachRequest?.(data.requestData);
  }, { responsibleGMOnly: true });

  register(['damageRequest', 'damageApply'], data => {
    return window.DX3rdUniversalHandler?.handleDamageRequest?.(data.requestData);
  }, { responsibleGMOnly: true });

  register(['conditionRequest', 'conditionApply'], data => {
    return window.DX3rdUniversalHandler?.handleConditionRequest?.(data.requestData);
  }, { responsibleGMOnly: true });

  register(['conditionRequestBulk', 'conditionApplyBulk'], data => {
    return window.DX3rdUniversalHandler?.handleConditionRequestBulk?.(data.data);
  }, { responsibleGMOnly: true });

  register('removeConditionRequest', data => {
    return window.DX3rdUniversalHandler?.handleRemoveConditionRequest?.(data.data);
  }, { responsibleGMOnly: true });

  register(['healRejected', 'damageRejected', 'conditionRejected'], data => {
    if (data.data.userId !== game.user.id) return;
    const labels = {
      healRejected: 'DX3rd.HealRequestRejected',
      damageRejected: 'DX3rd.DamageRequestRejected',
      conditionRejected: 'DX3rd.ConditionRequestRejected'
    };
    ui.notifications.warn(game.i18n.localize(labels[data.type]));
  });

  register('setSpellCalamityHighlight', async data => {
    const token = canvas.tokens?.placeables?.find(candidate => candidate.id === data.data.tokenId);
    if (!token || !data.data.position) return;
    await window.DX3rdSpellHandler?.drawSpellCalamityHighlight?.(
      token,
      data.data.range,
      data.data.userColor,
      data.data.position
    );
    window.DX3rdSpellCalamityHighlightData ||= [];
    window.DX3rdSpellCalamityHighlightData.push(data.data);
  });

  register('clearSpellCalamityHighlight', data => {
    return window.DX3rdSpellHandler?.clearSpellCalamityHighlight?.(data.data.tokenId);
  });

  register(['addDeathMark', 'removeDeathMark'], async data => {
    if (canvas.scene?.id !== data.data.sceneId) return;
    const tokenObj = canvas.scene.tokens.get(data.data.tokenId)?.object;
    if (!tokenObj) return;
    if (data.type === 'addDeathMark' && !tokenObj.dx3rdDeathMark) {
      await window.addDeathMarkToToken?.(tokenObj);
      tokenObj.refresh();
    } else if (data.type === 'removeDeathMark' && tokenObj.dx3rdDeathMark) {
      window.removeDeathMarkFromToken?.(tokenObj);
      tokenObj.refresh();
    }
  });

  register('spellCatastrophe7Request', async data => {
    const actor = game.actors.get(data.requestData.actorId);
    const item = data.requestData.itemId ? actor?.items.get(data.requestData.itemId) : null;
    if (actor) await window.DX3rdSpellHandler?.executeSpellCatastrophe7?.(actor, item);
  }, { responsibleGMOnly: true });

  register('spellCatastrophe8Request', async data => {
    const actor = game.actors.get(data.requestData.actorId);
    const item = data.requestData.itemId ? actor?.items.get(data.requestData.itemId) : null;
    if (actor) await window.DX3rdSpellHandler?.executeSpellCatastrophe8?.(actor, item);
  }, { responsibleGMOnly: true });

  register('showDefenseDialog', async data => {
    const targetActor = game.actors.get(data.dialogData.targetActorId);
    if (!targetActor?.isOwner) return;
    if (game.user.isGM) {
      if (!router.isResponsibleGM()) return;
      const activePlayerOwner = game.users.some(user => !user.isGM && user.active
        && targetActor.testUserPermission(user, 'OWNER'));
      if (activePlayerOwner) return;
    }
    await window.DX3rdUniversalHandler?.showDefenseDialog?.({...data.dialogData});
  });

  register('applyItemAttributes', async data => {
    const { sourceActorId, itemId, targetActorId, targetAttributes } = data.payload;
    const sourceActor = game.actors.get(sourceActorId);
    const targetActor = game.actors.get(targetActorId);
    if (!sourceActor || !targetActor?.isOwner) return;
    if (game.user.isGM) {
      if (!router.isResponsibleGM()) return;
      const activePlayerOwner = game.users.some(user => !user.isGM && user.active
        && targetActor.testUserPermission(user, 'OWNER'));
      if (activePlayerOwner) return;
    }
    const item = sourceActor.items.get(itemId);
    if (item) {
      await window.DX3rdUniversalHandler?._applyItemAttributes?.(
        sourceActor,
        item,
        targetActor,
        targetAttributes
      );
    }
  });

  register('userTyping', () => {});
})();
