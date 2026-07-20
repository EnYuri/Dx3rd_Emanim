// Universal handler AfterMain queue lifecycle.
(function() {
  const handler = window.DX3rdUniversalHandler;
  const utils = window.DX3rdRuntimeUtils;
  const socketRouter = window.DX3rdSocketRouter;
  const SETTING = 'afterMainQueue';
  if (!handler || !utils || !socketRouter) {
    console.error('DX3rd | AfterMain queue dependencies are unavailable.');
    return;
  }

  // 대표 GM 한 곳에서 설정 read-modify-write를 직렬화해 동시 요청의 덮어쓰기를 막는다.
  let mutationChain = Promise.resolve();
  function withQueueLock(task) {
    const result = mutationChain.then(task, task);
    mutationChain = result.catch(error => {
      console.error('DX3rd | AfterMain queue mutation failed:', error);
    });
    return result;
  }

  function getStoredQueue() {
    const stored = game.settings.get('dx3rd-emanim', SETTING);
    return Array.isArray(stored) ? stored : [];
  }

  function normalizeStoredEntry(entry) {
    if (!entry || !utils.AFTER_MAIN_TYPES.has(entry.type)) return null;
    const actor = entry.actor?.id ? entry.actor : { id: entry.actorId, uuid: entry.actorUuid };
    if (!actor.id) return null;
    try {
      const normalized = utils.createAfterMainQueueEntry({
        actor,
        item: entry.item?.id ? entry.item : (entry.itemId ? { id: entry.itemId, uuid: entry.itemUuid } : null),
        extensionData: entry.data,
        type: entry.type,
        queueId: entry.queueId,
        createdBy: entry.createdBy || null,
        createdAt: entry.createdAt || Date.now()
      });
      return {
        ...normalized,
        blocked: Boolean(entry.blocked),
        attempts: Number(entry.attempts) || 0,
        lastError: entry.lastError || null,
        failedAt: entry.failedAt || null
      };
    } catch (error) {
      console.warn('DX3rd | Invalid legacy AfterMain queue entry skipped:', error);
      return null;
    }
  }

  async function resolveActor(entry) {
    if (entry.actorUuid && typeof fromUuid === 'function') {
      const document = await fromUuid(entry.actorUuid).catch(() => null);
      if (document?.id) return document;
    }
    const worldActor = game.actors.get(entry.actorId);
    if (worldActor) return worldActor;
    return canvas.tokens?.placeables?.find(token => token.actor?.id === entry.actorId)?.actor || null;
  }

  async function resolveItem(entry, actor) {
    if (!entry.itemId && !entry.itemUuid) return null;
    if (entry.itemUuid && typeof fromUuid === 'function') {
      const document = await fromUuid(entry.itemUuid).catch(() => null);
      if (document?.id) return document;
    }
    return actor?.items?.get(entry.itemId) || game.items?.get(entry.itemId) || null;
  }

  async function executeQueueEntry(entry) {
    const actor = await resolveActor(entry);
    if (!actor) throw new Error(`Actor not found: ${entry.actorUuid || entry.actorId}`);
    const item = await resolveItem(entry, actor);
    if (entry.itemId && !item) throw new Error(`Item not found: ${entry.itemUuid || entry.itemId}`);

    if (entry.type === 'heal') await handler.executeHealExtensionNow(actor, entry.data, item);
    else if (entry.type === 'damage') await handler.executeDamageExtensionNow(actor, entry.data, item);
    else if (entry.type === 'condition') {
      if (Array.isArray(entry.data.conditionTypes)) await handler.executeConditionExtensionsNowBulk(actor, entry.data);
      else await handler.executeConditionExtensionNow(actor, entry.data, item);
    } else if (entry.type === 'statusClear') {
      await handler.executeStatusClearExtension(actor, entry.data, item);
    } else if (entry.type === 'encroach') {
      await handler.executeEncroachExtensionNow(actor, entry.data, item);
    }
  }

  handler.getAfterMainQueue = function() {
    return getStoredQueue().map(normalizeStoredEntry).filter(Boolean);
  };

  handler.addToAfterMainQueue = function(actor, extensionData, item, type = 'heal', options = {}) {
    const queueId = options.queueId || utils.createRequestId('afterMain');
    if (!socketRouter.isResponsibleGM()) {
      socketRouter.emit({
        type: 'addToAfterMainQueue',
        data: {
          actorId: actor?.id || null,
          actorUuid: actor?.uuid || null,
          extensionData,
          extensionType: type,
          itemId: item?.id || null,
          itemUuid: item?.uuid || null,
          queueId
        }
      });
      return Promise.resolve(queueId);
    }

    return withQueueLock(async () => {
      const queue = getStoredQueue().map(normalizeStoredEntry).filter(Boolean);
      if (queue.some(entry => entry.queueId === queueId)) {
        console.warn(`DX3rd | Duplicate AfterMain queue entry ignored: ${queueId}`);
        return queueId;
      }
      const entry = utils.createAfterMainQueueEntry({
        actor,
        item,
        extensionData,
        type,
        queueId,
        createdBy: options.createdBy || game.user.id
      });
      queue.push(entry);
      await game.settings.set('dx3rd-emanim', SETTING, queue);
      window.DX3rdDebug.log(`DX3rd | Added to AfterMain queue: ${type} for ${actor?.name || actor?.id || 'unknown'}, Queue length: ${queue.length}`);
      return queueId;
    });
  };

  handler.registerAfterMainExtensions = function(actor, item, itemExtend, action = null) {
    if (!itemExtend) return Promise.resolve([]);
    const selectedTargetIds = Array.from(game.user.targets).map(target => target.id);
    const pending = [];
    const enqueue = (type, data) => {
      const extensionData = {
        ...data,
        selectedTargetIds,
        triggerItemName: item?.name || null,
        triggerItemId: item?.id || null
      };
      pending.push(this.addToAfterMainQueue(actor, extensionData, item, type));
    };

    const matches = (type, data) => !window.DX3rdItemEffectAdapter
      || window.DX3rdItemEffectAdapter.extensionActionMatches(item, type, data, action, 'afterMain');
    const entries = window.DX3rdItemEffectAdapter?.extensionEntries?.(itemExtend) || [];
    const afterMain = entries.filter(entry => {
      const effectiveTiming = window.DX3rdItemEffectAdapter?.inferAction?.(item, entry.type, entry.data || {}) === 'activation'
        ? 'instant'
        : entry.data?.timing;
      return entry.data?.activate
        && effectiveTiming === 'afterMain'
        && (entry.type !== 'condition' || entry.data?.type)
        && matches(entry.type, entry.data);
    });
    for (const entry of afterMain) enqueue(entry.type, entry.data);
    if (afterMain.length > 0) {
      window.DX3rdDebug.log(`DX3rd | Registered afterMain extensions for ${actor.name} (${afterMain.length} entries)`);
    }
    return Promise.all(pending);
  };

  handler.processAfterMainQueue = function() {
    if (!socketRouter.isResponsibleGM()) return Promise.resolve({ processed: 0, failed: 0 });
    return withQueueLock(async () => {
      const queue = getStoredQueue().map(normalizeStoredEntry).filter(Boolean);
      if (!queue.length) {
        window.DX3rdDebug.log('DX3rd | AfterMain queue is empty');
        return { processed: 0, failed: 0 };
      }

      const failedEntries = [];
      let newFailures = 0;
      let processed = 0;
      window.DX3rdDebug.log(`DX3rd | Processing AfterMain queue: ${queue.length} items`);
      for (const entry of queue) {
        // 부분 적용 뒤 실패했을 수 있으므로 자동 재실행하지 않는다.
        // retryAfterMainQueueEntry로 명시적으로 해제한 항목만 다시 시도한다.
        if (entry.blocked) {
          failedEntries.push(entry);
          continue;
        }
        try {
          await executeQueueEntry(entry);
          processed++;
        } catch (error) {
          newFailures++;
          failedEntries.push({
            ...entry,
            blocked: true,
            attempts: (Number(entry.attempts) || 0) + 1,
            lastError: String(error?.message || error),
            failedAt: Date.now()
          });
          console.error(`DX3rd | AfterMain queue item failed (${entry.queueId}):`, error);
        }
      }

      await game.settings.set('dx3rd-emanim', SETTING, failedEntries);
      if (newFailures) {
        ui.notifications.error(game.i18n.format('DX3rd.AfterMainQueueFailed', { count: newFailures }));
      }
      window.DX3rdDebug.log(`DX3rd | AfterMain queue processed: ${processed}, retained failures: ${failedEntries.length}`);
      return { processed, failed: failedEntries.length };
    });
  };

  handler.clearAfterMainQueue = function() {
    if (!socketRouter.isResponsibleGM()) return Promise.resolve(false);
    return withQueueLock(async () => {
      await game.settings.set('dx3rd-emanim', SETTING, []);
      window.DX3rdDebug.log('DX3rd | AfterMain queue manually cleared');
      return true;
    });
  };

  handler.retryAfterMainQueueEntry = function(queueId) {
    if (!socketRouter.isResponsibleGM() || !queueId) return Promise.resolve(false);
    return withQueueLock(async () => {
      const queue = getStoredQueue().map(normalizeStoredEntry).filter(Boolean);
      const entry = queue.find(candidate => candidate.queueId === queueId);
      if (!entry) return false;
      entry.blocked = false;
      entry.lastError = null;
      entry.failedAt = null;
      await game.settings.set('dx3rd-emanim', SETTING, queue);
      return true;
    });
  };

  handler.processAfterMainQueueEntry = function(queueId) {
    if (!socketRouter.isResponsibleGM() || !queueId) return Promise.resolve({ found: false, processed: false });
    return withQueueLock(async () => {
      const queue = getStoredQueue().map(normalizeStoredEntry).filter(Boolean);
      const index = queue.findIndex(candidate => candidate.queueId === queueId);
      if (index < 0) return { found: false, processed: false };
      const entry = {...queue[index], blocked: false, lastError: null, failedAt: null};
      try {
        await executeQueueEntry(entry);
        queue.splice(index, 1);
        await game.settings.set('dx3rd-emanim', SETTING, queue);
        return { found: true, processed: true };
      } catch (error) {
        queue[index] = {
          ...entry,
          blocked: true,
          attempts: (Number(entry.attempts) || 0) + 1,
          lastError: String(error?.message || error),
          failedAt: Date.now()
        };
        await game.settings.set('dx3rd-emanim', SETTING, queue);
        console.error(`DX3rd | AfterMain queue retry failed (${queueId}):`, error);
        return { found: true, processed: false, error: queue[index].lastError };
      }
    });
  };

  handler.removeAfterMainQueueEntry = function(queueId) {
    if (!socketRouter.isResponsibleGM() || !queueId) return Promise.resolve(false);
    return withQueueLock(async () => {
      const queue = getStoredQueue().map(normalizeStoredEntry).filter(Boolean);
      const next = queue.filter(entry => entry.queueId !== queueId);
      if (next.length === queue.length) return false;
      await game.settings.set('dx3rd-emanim', SETTING, next);
      return true;
    });
  };

  // AfterMain 소켓 책임도 큐 모듈이 함께 소유한다. main.js의 거대 분기에서 분리한다.
  socketRouter.registerType('addToAfterMainQueue', async data => {
    const { extensionType, actorId, actorUuid, extensionData, itemId, itemUuid, queueId } = data.data;
    let actor = actorUuid && typeof fromUuid === 'function' ? await fromUuid(actorUuid).catch(() => null) : null;
    actor ||= game.actors.get(actorId);
    if (!actor) return;
    if (data.senderId && !socketRouter.canUserControlActor(data.senderId, actor)) {
      console.warn(`DX3rd | Unauthorized AfterMain request ignored: ${data.senderId} → ${actor.id}`);
      return;
    }
    let item = itemUuid && typeof fromUuid === 'function' ? await fromUuid(itemUuid).catch(() => null) : null;
    item ||= itemId ? actor.items.get(itemId) : null;
    await handler.addToAfterMainQueue(actor, extensionData, item, extensionType, {
      queueId: queueId || data.requestId,
      createdBy: data.senderId
    });
  }, {
    consume: true,
    responsibleGMOnly: true,
    validate: data => Boolean(data.data
      && utils.AFTER_MAIN_TYPES.has(data.data.extensionType)
      && (data.data.actorId || data.data.actorUuid))
  });
})();
