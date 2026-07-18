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
    'showNoDamageNotification',
    'applyEffectToTarget'
  ], { senderRole: 'gm', validate: hasObject('payload') });

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
      && isId(data.payload.itemId) && isIdArray(data.payload.targetActorIds),
    authorize: ownsActor('payload.attackerId')
  });
  contract('registerTargetApply', {
    validate: data => isObject(data.payload) && isId(data.payload.sourceActorId)
      && isId(data.payload.targetActorId) && isId(data.payload.itemId),
    authorize: ownsActor('payload.sourceActorId')
  });
  contract(['reportDamageForApply', 'reportDamageForActivation'], {
    validate: data => isObject(data.payload) && isId(data.payload.targetActorId) && isId(data.payload.itemId),
    authorize: ownsActor('payload.targetActorId')
  });
  contract('showDefenseDialog', {
    validate: data => isObject(data.dialogData) && isId(data.dialogData.attackerId)
      && isId(data.dialogData.targetActorId),
    authorize: ownsActor('dialogData.attackerId')
  });
  contract('applyItemAttributes', {
    validate: data => isObject(data.payload) && isId(data.payload.sourceActorId)
      && isId(data.payload.targetActorId) && isId(data.payload.itemId),
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
