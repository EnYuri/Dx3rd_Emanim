// DX3rd system socket router - one transport listener, many feature handlers.
(function() {
  const MODULE_ID = 'dx3rd-emanim';
  const CHANNEL = `system.${MODULE_ID}`;
  const handlers = new Set();
  const typeHandlers = new Map();
  const processedRequests = new Map();
  const REQUEST_TTL_MS = 5 * 60 * 1000;
  const MAX_PROCESSED_REQUESTS = 5000;

  function getResponsibleGM() {
    return game.users.activeGM
      ?? game.users.find(user => user.isGM && user.active)
      ?? game.users.find(user => user.isGM)
      ?? null;
  }

  function isResponsibleGM() {
    const responsibleGM = getResponsibleGM();
    return Boolean(game.user.isGM && (!responsibleGM || game.user.id === responsibleGM.id));
  }

  function register(handler) {
    if (typeof handler !== 'function') {
      throw new TypeError('DX3rd socket handler must be a function.');
    }
    handlers.add(handler);
    return () => handlers.delete(handler);
  }

  function registerType(types, handler, options = {}) {
    if (typeof handler !== 'function') throw new TypeError('DX3rd typed socket handler must be a function.');
    const typeList = Array.isArray(types) ? types : [types];
    const records = [];
    for (const type of typeList) {
      if (typeof type !== 'string' || !type) throw new TypeError('DX3rd socket type must be a non-empty string.');
      const record = { handler, options };
      if (!typeHandlers.has(type)) typeHandlers.set(type, new Set());
      typeHandlers.get(type).add(record);
      records.push([type, record]);
    }
    return () => {
      for (const [type, record] of records) typeHandlers.get(type)?.delete(record);
    };
  }

  function getSender(data) {
    return data?.senderId ? game.users.get(data.senderId) : null;
  }

  async function validateTypeContract(data) {
    const records = typeHandlers.get(data.type);
    if (!records?.size) {
      console.warn(`DX3rd | Unregistered socket type ignored: ${data.type}`);
      return false;
    }

    const contracts = Array.from(records).filter(record => record.options.contract);
    const gates = contracts.length ? contracts : Array.from(records);
    const sender = getSender(data);

    if (data.protocolVersion === 0 && !gates.some(record => record.options.allowLegacy === true)) {
      console.warn(`DX3rd | Legacy socket message rejected: ${data.type}`);
      return false;
    }
    if (data.protocolVersion >= 1 && !sender) {
      console.warn(`DX3rd | Socket sender is unavailable: ${data.type} (${data.senderId || 'missing'})`);
      return false;
    }

    for (const { options } of gates) {
      if (options.senderRole === 'gm' && (!sender?.isGM || !sender.active)) {
        console.warn(`DX3rd | GM-only socket message rejected: ${data.type}`);
        return false;
      }
      if (options.senderRole === 'player' && (!sender?.active || sender.isGM)) {
        console.warn(`DX3rd | Player-only socket message rejected: ${data.type}`);
        return false;
      }
      if (typeof options.validate === 'function' && !await options.validate(data, sender)) {
        console.warn(`DX3rd | Invalid socket payload ignored: ${data.type}`);
        return false;
      }
      if (typeof options.authorize === 'function' && !await options.authorize(data, sender)) {
        console.warn(`DX3rd | Unauthorized socket message ignored: ${data.type}`);
        return false;
      }
    }
    return true;
  }

  function emit(message) {
    const envelope = window.DX3rdRuntimeUtils.createSocketEnvelope(message, { senderId: game.user.id });
    game.socket.emit(CHANNEL, envelope);
    return envelope.requestId;
  }

  function canUserControlActor(senderId, actor) {
    const user = senderId ? game.users.get(senderId) : null;
    if (!user || !actor) return false;
    if (user.isGM) return true;
    return Boolean(actor.testUserPermission?.(user, 'OWNER'));
  }

  function cleanProcessedRequests(now = Date.now()) {
    for (const [requestId, timestamp] of processedRequests) {
      if (now - timestamp > REQUEST_TTL_MS) processedRequests.delete(requestId);
    }
  }

  function acceptRequest(data) {
    if (!data.requestId) return data.protocolVersion === 0;
    const now = Date.now();
    cleanProcessedRequests(now);
    if (processedRequests.has(data.requestId)) {
      console.warn(`DX3rd | Duplicate socket request ignored: ${data.type} (${data.requestId})`);
      return false;
    }
    processedRequests.set(data.requestId, now);
    while (processedRequests.size > MAX_PROCESSED_REQUESTS) {
      processedRequests.delete(processedRequests.keys().next().value);
    }
    return true;
  }

  async function dispatchTyped(data) {
    const records = typeHandlers.get(data.type);
    if (!records?.size) return false;
    let consumed = false;
    for (const { handler, options } of records) {
      if (options.contract) continue;
      // A typed boundary owns its message even when this client is not the
      // designated executor. Otherwise skipped GM-only handlers can leak back
      // into the legacy generic listener and run twice or on the wrong client.
      if (options.consume) consumed = true;
      if (options.responsibleGMOnly && !isResponsibleGM()) continue;
      if (options.gmOnly && !game.user.isGM) continue;
      if (typeof options.validate === 'function' && !options.validate(data)) {
        console.warn(`DX3rd | Invalid socket payload ignored: ${data.type}`);
        continue;
      }
      await handler(data);
    }
    return consumed;
  }

  function registeredTypes() {
    return Array.from(typeHandlers.keys()).sort();
  }

  window.DX3rdSocketRouter = {
    CHANNEL,
    register,
    registerType,
    emit,
    getResponsibleGM,
    isResponsibleGM,
    canUserControlActor,
    registeredTypes
  };

  Hooks.once('ready', () => {
    game.socket.on(CHANNEL, async rawData => {
      const data = window.DX3rdRuntimeUtils.normalizeSocketEnvelope(rawData);
      const validation = window.DX3rdRuntimeUtils.validateSocketEnvelope(data);
      if (!validation.valid) {
        console.warn(`DX3rd | Invalid socket message ignored: ${validation.error}`);
        return;
      }
      if (!await validateTypeContract(data)) return;
      if (!acceptRequest(data)) return;

      let consumed = false;
      try {
        consumed = await dispatchTyped(data);
      } catch (error) {
        console.error(`DX3rd | Typed socket handler failed (${data.type}):`, error);
      }
      if (consumed) return;
      for (const handler of handlers) {
        try {
          await handler(data);
        } catch (error) {
          console.error('DX3rd | Socket handler failed:', error);
        }
      }
    });
  });
})();
