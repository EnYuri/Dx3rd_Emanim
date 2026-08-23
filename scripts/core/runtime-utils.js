// Pure DX3rd runtime utilities with no Foundry Document dependency.
// They remain browser globals for classic-script loading and are exercised in a VM by Node tests.
(function() {
  const AFTER_MAIN_TYPES = new Set(['heal', 'damage', 'condition', 'statusClear', 'encroach']);

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

  /**
   * Preserve an extension's authored target while limiting selected targets to actors that
   * actually took HP damage. `targetAll` still means caster + selected targets; collapsing it to
   * `targetToken` would silently drop the caster. The internal `damagedTargets` label is normalized
   * to the executor's selected-target vocabulary.
   */
  function resolveAfterDamageTarget(target = 'self', damagedTokenIds = [], fallbackTargetIds = []) {
    const authoredTarget = target || 'self';
    const damaged = [...new Set((damagedTokenIds || []).filter(id => typeof id === 'string' && id))];
    if (authoredTarget === 'self') return { target: 'self', selectedTargetIds: [], targetsFrozen: true };
    if (authoredTarget === 'targetToken' || authoredTarget === 'damagedTargets') {
      return { target: 'targetToken', selectedTargetIds: damaged, targetsFrozen: true };
    }
    // Extension executors treat an empty selectedTargetIds array as "use the current UI targets".
    // Once damage results are frozen that fallback is unsafe: if nobody was damaged, targetAll
    // means only the caster, not whoever the responsible GM happens to have targeted now.
    if (authoredTarget === 'targetAll') {
      return damaged.length > 0
        ? { target: 'targetAll', selectedTargetIds: damaged, targetsFrozen: true }
        : { target: 'self', selectedTargetIds: [], targetsFrozen: true };
    }
    return {
      target: authoredTarget,
      selectedTargetIds: [...new Set((fallbackTargetIds || []).filter(id => typeof id === 'string' && id))],
      targetsFrozen: true
    };
  }

  function recordAfterDamageReport(request, { targetTokenId, targetActorId, hpChange, attackHit } = {}) {
    if (!request || !targetTokenId || !targetActorId) {
      return { accepted: false, complete: false, reportCount: 0, targetCount: 0 };
    }
    const targetTokenIds = Array.isArray(request.targetTokenIds) ? request.targetTokenIds : [];
    const targetIndex = targetTokenIds.indexOf(targetTokenId);
    const expectedActorId = request.targetActorIds?.[targetIndex];
    if (targetIndex < 0 || expectedActorId !== targetActorId) {
      return {
        accepted: false,
        complete: false,
        reportCount: Object.keys(request.damageReports || {}).length,
        targetCount: targetTokenIds.length
      };
    }
    request.damageReports ||= {};
    request.hitReports ||= {};
    request.reportActorIds ||= {};
    const normalizedHpChange = Number(hpChange) || 0;
    request.damageReports[targetTokenId] = normalizedHpChange;
    // Older senders did not report hit state. Their safest compatible meaning is
    // the former trigger condition: actual HP loss implies a hit.
    request.hitReports[targetTokenId] = typeof attackHit === 'boolean'
      ? attackHit
      : normalizedHpChange > 0;
    request.reportActorIds[targetTokenId] = targetActorId;
    request.reportCount = Object.keys(request.damageReports).length;
    return {
      accepted: true,
      complete: request.reportCount >= targetTokenIds.length,
      reportCount: request.reportCount,
      targetCount: targetTokenIds.length
    };
  }

  function cloneSerializable(value) {
    if (value === undefined) return undefined;
    if (typeof structuredClone === 'function') {
      try { return structuredClone(value); } catch { /* Fall back to JSON. */ }
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
   * Check whether a document update payload touches a property path.
   *
   * Foundry does not give every hook the same update shape. Depending on the call path, the
   * payload may be nested ({system:{conditions:{...}}}), flattened ({"system.conditions.x":1}),
   * or mixed ({system:{"conditions.x":1}}). Centralizing the check prevents individual hooks
   * from silently missing one of those forms.
   *
   * @param {object} updateData update payload received by the hook
   * @param {string} path dot-delimited path, such as 'system.conditions'
   * @returns {boolean} whether the path or one of its descendants is present
   */
  function updateTouchesPath(updateData, path) {
    if (!isPlainObject(updateData) || typeof path !== 'string' || !path) return false;
    const segments = path.split('.');
    let node = updateData;
    for (let i = 0; i < segments.length; i++) {
      if (!isPlainObject(node)) return false;
      // The remainder may be flattened into a dot-delimited key at this depth.
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
   * Return an actor-only chat speaker.
   * Explicitly clearing token and scene prevents a controlled token from contaminating the
   * speaker and preserves actor portraits on every client (including lichsoma-speaker-selecter).
   */
  function getActorOnlySpeaker(actor) {
    const s = ChatMessage.getSpeaker({ actor });
    return { ...s, token: null, scene: null };
  }

  function classifyHpTransition(oldValue, newValue) {
    const oldHp = Number(oldValue);
    const newHp = Number(newValue);
    if (!Number.isFinite(oldHp) || !Number.isFinite(newHp)) return null;
    if (oldHp > 0 && newHp <= 0) return 'defeated';
    if (oldHp <= 0 && newHp > 0) return 'revived';
    return null;
  }

  window.DX3rdRuntimeUtils = Object.freeze({
    AFTER_MAIN_TYPES,
    getActorOnlySpeaker,
    isPlainObject,
    updateTouchesPath,
    escapeHTML,
    createRequestId,
    resolveAfterDamageTarget,
    recordAfterDamageReport,
    createSocketEnvelope,
    normalizeSocketEnvelope,
    validateSocketEnvelope,
    createAfterMainQueueEntry,
    extensionGroupKey,
    groupExtensionsByKey,
    classifyHpTransition
  });
})();
