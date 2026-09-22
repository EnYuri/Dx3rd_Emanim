// DX3rd socket message contracts.
// Transport validation lives here; feature handlers remain free to focus on behavior.
(function() {
  const router = window.DX3rdSocketRouter;
  if (!router) {
    console.error('DX3rd | Socket router is unavailable for contract registration.');
    return;
  }

  const isObject = value => Boolean(value && typeof value === 'object' && !Array.isArray(value));
  const isId = value => typeof value === 'string' && value.length > 0 && value.length <= 256;
  const isIdArray = value => Array.isArray(value) && value.length <= 200 && value.every(isId);
  const at = (source, path) => path.split('.').reduce((value, key) => value?.[key], source);
  const hasObject = path => data => isObject(at(data, path));
  const hasIds = (...paths) => data => paths.every(path => isId(at(data, path)));
  const getActor = actorId => game.actors.get(actorId)
    || canvas.tokens?.placeables?.find(token => token.actor?.id === actorId)?.actor
    || null;
  const ownsActor = path => (data, sender) => {
    if (!sender?.active) return false;
    const actor = getActor(at(data, path));
    return router.canUserControlActor(sender.id, actor);
  };
  const ownsToken = path => (data, sender) => {
    if (!sender?.active) return false;
    const tokenId = at(data, path);
    const token = canvas.tokens?.placeables?.find(candidate => candidate.id === tokenId);
    return router.canUserControlActor(sender.id, token?.actor);
  };
  const activeSender = (_data, sender) => Boolean(sender?.active);
  const contract = (types, options = {}) => router.registerType(types, () => {}, {
    ...options,
    contract: true
  });

  // GM-originated commands and presentation sync.
  contract('showSceneEnterDialog', { senderRole: 'gm', validate: hasIds('userId') });
  contract('showTurnActor', {
    senderRole: 'gm',
    validate: data => typeof data.actorName === 'string' && typeof data.imgSrc === 'string'
  });
  contract('executeInitiativeProcess', { senderRole: 'gm', validate: hasIds('combatId') });
  contract([
    'executeAfterDamageMacro',
    'showAfterDamageDialog',
    'executeAfterDamageActivation',
    'showNoDamageNotification'
  ], { senderRole: 'gm', validate: data => hasObject('payload')(data) && isId(data.executorUserId) });

  // Owner-to-GM state requests.
  contract('actionTrackerConsume', {
    validate: data => isObject(data.payload) && isId(data.payload.actorId) && isId(data.payload.combatId),
    authorize: ownsActor('payload.actorId')
  });
  contract(['startMainProcessFromInitiative', 'executeDisableHook', 'advanceCombatProcess'], {
    validate: data => isId(data.actorId) && isId(data.combatId),
    authorize: ownsActor('actorId')
  });
  contract(['healRequest', 'healApply', 'damageRequest', 'damageApply', 'statusClearRequest', 'statusClearApply', 'encroachRequest'], {
    validate: data => isObject(data.requestData) && isId(data.requestData.actorId),
    authorize: ownsActor('requestData.actorId')
  });
  contract(['conditionRequest', 'conditionApply'], {
    validate: data => isObject(data.requestData) && isId(data.requestData.actorId),
    authorize: ownsActor('requestData.actorId')
  });
  contract(['conditionRequestBulk', 'conditionApplyBulk'], {
    validate: data => isObject(data.data) && isId(data.data.actorId),
    authorize: ownsActor('data.actorId')
  });
  contract('removeConditionRequest', {
    validate: data => isObject(data.data) && isId(data.data.sourceActorId) && isId(data.data.targetUuid),
    authorize: ownsActor('data.sourceActorId')
  });
  contract(['spellRoisSelectRequest', 'spellCatastrophe7Request', 'spellCatastrophe8Request'], {
    validate: data => isObject(data.requestData) && isId(data.requestData.actorId),
    authorize: ownsActor('requestData.actorId')
  });
  contract(['registerAfterDamageExtension', 'registerAfterDamageActivation'], {
    validate: data => isObject(data.payload) && isId(data.payload.attackerId)
      && isId(data.payload.itemId) && isId(data.payload.damageRequestId)
      && isIdArray(data.payload.targetActorIds) && isIdArray(data.payload.targetTokenIds)
      && data.payload.targetActorIds.length === data.payload.targetTokenIds.length
      && (data.payload.pendingAttackRiders === undefined
        || (Array.isArray(data.payload.pendingAttackRiders)
          && data.payload.pendingAttackRiders.every(rider => isObject(rider)
            && isId(rider.itemId) && isObject(rider.targetAttributes)
            && (rider.hitAttributes === undefined || isObject(rider.hitAttributes))
            && rider.preEvaluated === true))),
    authorize: ownsActor('payload.attackerId')
  });
  contract('reportDamageForActivation', {
    validate: data => isObject(data.payload) && isId(data.payload.targetActorId) && isId(data.payload.itemId)
      && isId(data.payload.damageRequestId) && isId(data.payload.targetTokenId)
      && (data.payload.attackHit === undefined || typeof data.payload.attackHit === 'boolean'),
    authorize: ownsActor('payload.targetActorId')
  });
  contract('showDefenseDialog', {
    validate: data => isObject(data.dialogData) && isId(data.dialogData.attackerId)
      && isId(data.dialogData.targetActorId) && isId(data.dialogData.targetTokenId)
      && isId(data.dialogData.damageRequestId) && isId(data.executorUserId),
    authorize: ownsActor('dialogData.attackerId')
  });
  contract('cancelAfterDamageRequest', {
    validate: data => isObject(data.payload) && isId(data.payload.damageRequestId)
      && isId(data.payload.targetActorId) && isId(data.payload.targetTokenId)
      && isId(data.payload.itemId),
    authorize: ownsActor('payload.targetActorId')
  });
  contract('applyItemAttributes', {
    validate: data => isObject(data.payload) && isId(data.payload.sourceActorId)
      && isId(data.payload.targetActorId) && isId(data.payload.itemId)
      && (data.payload.preEvaluated === undefined || typeof data.payload.preEvaluated === 'boolean')
      && isId(data.executorUserId),
    authorize: ownsActor('payload.sourceActorId')
  });
  // 굴림 개입은 두 방향이다. 제안(굴리는 쪽 → 그 액터의 책임 실행자)과 선언(실행자 → 굴리는 쪽).
  // 한 방향씩 발신자 권한이 다르다 — 제안은 굴리는 액터를, 선언은 선언하는 액터를 통제해야 한다.
  contract('rollInterventionOffer', {
    validate: data => isObject(data.payload) && isId(data.payload.roundKey)
      && isId(data.payload.requesterUserId) && isId(data.payload.rollerActorId)
      && isId(data.payload.sourceActorId)
      && (data.payload.sourceTokenId === null || data.payload.sourceTokenId === undefined
        || isId(data.payload.sourceTokenId))
      && ['offer', 'cancel', 'accept', 'reject'].includes(data.payload.stage)
      && (data.payload.stage !== 'offer' || isObject(data.payload.snapshot))
      && isId(data.executorUserId),
    authorize: ownsActor('payload.rollerActorId')
  });
  contract('rollInterventionDeclare', {
    validate: data => isObject(data.payload) && isId(data.payload.roundKey)
      && isId(data.payload.requesterUserId) && isId(data.payload.sourceActorId)
      && ['claim', 'commit', 'decline'].includes(data.payload.stage)
      && (data.payload.stage !== 'commit' || typeof data.payload.ok === 'boolean'),
    authorize: ownsActor('payload.sourceActorId')
  });
  contract('addToAfterMainQueue', {
    validate: data => isObject(data.data) && isId(data.data.actorId)
      && ['heal', 'damage', 'condition', 'statusClear'].includes(data.data.extensionType),
    authorize: ownsActor('data.actorId')
  });

  // Canvas-only synchronization still requires an active, identifiable sender.
  contract('setSpellCalamityHighlight', {
    validate: data => isObject(data.data) && isId(data.data.tokenId),
    authorize: ownsToken('data.tokenId')
  });
  contract('clearSpellCalamityHighlight', {
    validate: data => isObject(data.data) && isId(data.data.tokenId),
    authorize: activeSender
  });
  contract(['addDeathMark', 'removeDeathMark'], {
    validate: data => isObject(data.data) && isId(data.data.tokenId) && isId(data.data.sceneId),
    authorize: activeSender
  });

  // User-scoped notices are the only protocol-v0 compatibility surface.
  contract(['healRejected', 'damageRejected', 'conditionRejected'], {
    allowLegacy: true,
    validate: data => isObject(data.data) && isId(data.data.userId)
  });
  contract('userTyping', { allowLegacy: true, authorize: data => isObject(data) });

  window.DX3rdSocketContracts = Object.freeze({
    isObject,
    isId,
    isIdArray,
    types: Object.freeze(router.registeredTypes())
  });
})();
