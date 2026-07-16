// DX3rd 채팅 메시지 분류. 신규 메시지는 flags를 저장하고, 기존 콘텐츠는 호환용으로만 판별한다.
(function() {
  const SCOPE = 'dx3rd-emanim';
  const TYPES = Object.freeze({
    CONDITION: 'condition',
    HEALING: 'healing',
    DAMAGE: 'damage',
    POISON_CHECK: 'poisonCheck',
    ROLL: 'roll',
    SYSTEM_ACTION: 'systemAction',
    UNKNOWN: 'unknown'
  });

  function explicitType(source) {
    const messageType = source?.flags?.[SCOPE]?.messageType
      || source?._source?.flags?.[SCOPE]?.messageType
      || source?.getFlag?.(SCOPE, 'messageType')
      || null;
    return messageType === 'heal' ? TYPES.HEALING : messageType;
  }

  function classifyLegacy(source = {}) {
    const content = String(source.content || '');
    const localize = key => game.i18n.localize(key);
    const condition = content.includes(localize('DX3rd.ActionEnd'))
      || content.includes(localize('DX3rd.ActionDelay'))
      || content.includes(localize('DX3rd.Apply'))
      || content.includes(localize('DX3rd.Clear'));
    if (condition) return TYPES.CONDITION;
    if (content.includes('HP') && content.includes(localize('DX3rd.Healing'))) return TYPES.HEALING;
    if (content.includes('HP') && content.includes(localize('DX3rd.DamageToHP'))) return TYPES.DAMAGE;
    if (content.includes(localize('DX3rd.PoisonedCheck'))) return TYPES.POISON_CHECK;
    if (source.rolls?.length > 0) return TYPES.ROLL;
    if (['damage-roll-btn', 'damage-apply-btn', 'attack-roll-btn', 'dx3rd-win-check-btn'].some(name => content.includes(name))) {
      return TYPES.SYSTEM_ACTION;
    }
    return TYPES.UNKNOWN;
  }

  function getType(source) {
    return explicitType(source) || classifyLegacy(source);
  }

  function buildFlags(messageType, metadata = {}) {
    return { [SCOPE]: { ...metadata, messageType } };
  }

  function ensureFlag(document, source) {
    const current = explicitType(source) || explicitType(document);
    if (current) return current;
    const messageType = classifyLegacy(source);
    if (messageType !== TYPES.UNKNOWN) {
      const existing = source?.flags?.[SCOPE] || document?._source?.flags?.[SCOPE] || {};
      document?.updateSource?.({ flags: { [SCOPE]: { ...existing, messageType } } });
    }
    return messageType;
  }

  window.DX3rdChatMessageTypes = Object.freeze({
    SCOPE,
    TYPES,
    explicitType,
    classifyLegacy,
    getType,
    buildFlags,
    ensureFlag
  });
})();
