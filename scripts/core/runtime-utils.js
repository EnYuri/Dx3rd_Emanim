// DX3rd 런타임에서 Foundry 문서에 의존하지 않는 순수 유틸리티.
// 브라우저 전역으로 노출해 classic script 로딩을 유지하고, Node 테스트에서도 VM으로 검증한다.
(function() {
  const AFTER_MAIN_TYPES = new Set(['heal', 'damage', 'condition', 'statusClear']);

  function isPlainObject(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
  }

  function createRequestId(prefix = 'request') {
    const randomUUID = globalThis.crypto?.randomUUID;
    if (typeof randomUUID === 'function') return `${prefix}:${randomUUID.call(globalThis.crypto)}`;
    return `${prefix}:${Date.now().toString(36)}:${Math.random().toString(36).slice(2, 12)}`;
  }

  function cloneSerializable(value) {
    if (value === undefined) return undefined;
    if (typeof structuredClone === 'function') {
      try { return structuredClone(value); } catch (error) { /* JSON fallback */ }
    }
    return JSON.parse(JSON.stringify(value));
  }

  function escapeHTML(value) {
    return String(value ?? '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#39;');
  }

  /**
   * 문서 업데이트 페이로드가 특정 경로를 건드리는지 판별한다.
   *
   * Foundry 는 훅에 넘기는 변경분을 항상 같은 모양으로 주지 않는다 — 호출 경로에 따라
   * 중첩 객체({system:{conditions:{...}}}), 최상위 점 표기({"system.conditions.x":1}),
   * 혼합({system:{"conditions.x":1}}) 셋 다 나온다. 훅마다 제각각 방어하다 한 형태를
   * 빠뜨리면(예: 중첩만 읽는 가드) 정상 경로가 조용히 죽으므로 여기로 모은다.
   *
   * @param {object} updateData 훅이 받은 변경분
   * @param {string} path 점 표기 경로 (예: 'system.conditions')
   * @returns {boolean} 해당 경로 또는 그 하위가 변경분에 포함되면 true
   */
  function updateTouchesPath(updateData, path) {
    if (!isPlainObject(updateData) || typeof path !== 'string' || !path) return false;
    const segments = path.split('.');
    let node = updateData;
    for (let i = 0; i < segments.length; i++) {
      if (!isPlainObject(node)) return false;
      // 남은 경로가 이 깊이에서 점 표기로 뭉쳐 있을 수 있다.
      const remainder = segments.slice(i).join('.');
      for (const key of Object.keys(node)) {
        if (key === remainder || key.startsWith(`${remainder}.`)) return true;
      }
      node = node[segments[i]];
    }
    return false;
  }

  function createSocketEnvelope(message, { senderId = null } = {}) {
    if (!isPlainObject(message)) throw new TypeError('DX3rd socket message must be an object.');
    const type = String(message.type || '').trim();
    if (!type) throw new TypeError('DX3rd socket message type is required.');
    return {
      ...message,
      type,
      protocolVersion: 1,
      requestId: message.requestId || createRequestId(type),
      senderId
    };
  }

  function normalizeSocketEnvelope(message) {
    if (!isPlainObject(message)) return null;
    const type = String(message.type || '').trim();
    if (!type) return null;
    return {
      ...message,
      type,
      protocolVersion: Number(message.protocolVersion) || 0,
      requestId: typeof message.requestId === 'string' && message.requestId ? message.requestId : null,
      senderId: typeof message.senderId === 'string' && message.senderId ? message.senderId : null
    };
  }

  function validateSocketEnvelope(message) {
    if (!message) return { valid: false, error: 'message must be an object' };
    if (!message.type) return { valid: false, error: 'type is required' };
    if (message.type.length > 128) return { valid: false, error: 'type is too long' };
    if (![0, 1].includes(message.protocolVersion)) {
      return { valid: false, error: `unsupported protocol version ${message.protocolVersion}` };
    }
    if (message.requestId !== null && typeof message.requestId !== 'string') {
      return { valid: false, error: 'requestId must be a string' };
    }
    if (message.requestId?.length > 256) return { valid: false, error: 'requestId is too long' };
    if (message.senderId?.length > 256) return { valid: false, error: 'senderId is too long' };
    return { valid: true, error: null };
  }

  function createAfterMainQueueEntry({
    actor,
    item = null,
    extensionData,
    type = 'heal',
    queueId = null,
    createdBy = null,
    createdAt = Date.now()
  }) {
    if (!actor?.id) throw new TypeError('AfterMain queue actor is required.');
    if (!AFTER_MAIN_TYPES.has(type)) throw new TypeError(`Unknown AfterMain queue type: ${type}`);
    return {
      queueId: queueId || createRequestId('afterMain'),
      type,
      actorId: actor.id,
      actorUuid: actor.uuid || null,
      itemId: item?.id || null,
      itemUuid: item?.uuid || null,
      data: cloneSerializable(extensionData || {}),
      createdBy,
      createdAt
    };
  }

  function extensionGroupKey(extension) {
    const type = extension.type;
    const timing = extension.timing || 'instant';
    const target = extension.target || 'self';
    const parentRunTiming = extension.parentRunTiming || 'instant';
    const isCustom = Boolean(extension.custom || extension.conditionalFormula);
    const conditionSourceKey = type === 'condition'
      ? `${extension.itemId || '-'}|${extension.disable || '-'}`
      : '-';
    return `${type}|${timing}|${target}|${parentRunTiming}|${isCustom ? '1' : '0'}|${conditionSourceKey}`;
  }

  function groupExtensionsByKey(extensions) {
    const buckets = new Map();
    for (const extension of extensions || []) {
      if (!extension?.type) continue;
      const type = extension.type;
      const timing = extension.timing || 'instant';
      const target = extension.target || 'self';
      const parentRunTiming = extension.parentRunTiming || 'instant';
      const isCustom = Boolean(extension.custom || extension.conditionalFormula);
      const key = extensionGroupKey(extension);
      if (!buckets.has(key)) {
        buckets.set(key, {
          type,
          timing,
          target,
          parentRunTiming,
          custom: isCustom,
          sourceItemId: type === 'condition' ? (extension.itemId || null) : null,
          sourceActorId: type === 'condition' ? (extension.actorId || null) : null,
          duration: type === 'condition' ? (extension.disable || null) : null,
          sources: []
        });
      }
      const bucket = buckets.get(key);
      bucket.custom ||= isCustom;

      if (type === 'weapon' || type === 'protect' || type === 'vehicle' || type === 'statusClear') {
        bucket.sources.push({
          itemId: extension.itemId,
          itemName: extension.itemName,
          actorId: extension.actorId,
          raw: { extensionData: extension.extensionData || {} }
        });
        continue;
      }

      bucket.sources.push({
        itemId: extension.itemId,
        itemName: extension.itemName,
        actorId: extension.actorId,
        raw: {
          dice: extension.formulaDice ?? extension.dice ?? 0,
          add: extension.formulaAdd ?? extension.add ?? 0,
          options: {
            ignoreReduce: Boolean(extension.ignoreReduce),
            resurrect: Boolean(extension.resurrect),
            rivival: Boolean(extension.rivival),
            conditionType: extension.conditionType,
            conditionTypes: extension.conditionTypes || (extension.conditionType ? [extension.conditionType] : (extension.type ? [extension.type] : [])),
            poisonedRank: extension.poisonedRank || null,
            disable: extension.disable || null,
            conditionalFormula: Boolean(extension.conditionalFormula)
          }
        }
      });
    }
    return Array.from(buckets.values());
  }

  /**
   * 액터만 스피커로 반환한다.
   * token/scene을 명시적으로 null로 고정해야 선택된 토큰에 스피커가 오염되지 않고,
   * GM을 포함한 모든 클라이언트에서 액터 초상화가 쓰인다(lichsoma-speaker-selecter 호환).
   */
  function getActorOnlySpeaker(actor) {
    const s = ChatMessage.getSpeaker({ actor });
    return { ...s, token: null, scene: null };
  }

  window.DX3rdRuntimeUtils = Object.freeze({
    AFTER_MAIN_TYPES,
    getActorOnlySpeaker,
    isPlainObject,
    updateTouchesPath,
    escapeHTML,
    createRequestId,
    createSocketEnvelope,
    normalizeSocketEnvelope,
    validateSocketEnvelope,
    createAfterMainQueueEntry,
    extensionGroupKey,
    groupExtensionsByKey
  });
})();
