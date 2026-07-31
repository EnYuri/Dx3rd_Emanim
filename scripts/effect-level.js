// 이펙트의 실제 레벨 계산
// ---------------------------------------------------------------------------
// 기본 레벨 + 침식률 상승분 + Applied 효과의 effect_level 보정을 한 곳에서 계산한다.
// 《경계선상의 거주자》처럼 최대 레벨을 넘어도 되는 보정이 있으므로 max로 제한하지 않는다.
// ---------------------------------------------------------------------------
(function () {
  function appliedLevelBonus(actor) {
    if (!actor) return 0;
    const applied = window.DX3rdAppliedEffects?.collect
      ? window.DX3rdAppliedEffects.collect(actor)
      : (actor.system?.attributes?.applied || {});
    let total = 0;
    for (const payload of Object.values(applied)) {
      if (!payload || payload._disabled === true) continue;
      for (const [attributeName, attributeValue] of Object.entries(payload.attributes || {})) {
        const isObject = attributeValue && typeof attributeValue === 'object';
        const key = isObject ? attributeValue.key : attributeName;
        if (key !== 'effect_level') continue;
        const value = isObject && 'value' in attributeValue
          ? attributeValue.value
          : attributeValue;
        total += Number(value) || 0;
      }
    }
    return total;
  }

  function value(item, actor = item?.actor, options = {}) {
    if (!item || item.type !== 'effect') return 0;
    const level = options.level || item.system?.level || {};
    const base = Number(level.init ?? level.value) || 0;
    let encroachment = 0;
    if (level.upgrade && actor) {
      const frozen = options.encroachmentLevel
        ?? actor._dx3rdUsageEncLevel;
      encroachment = frozen !== undefined && frozen !== null
        ? Number(frozen) || 0
        : Number(actor.system?.attributes?.encroachment?.level) || 0;
    }
    return base + encroachment + appliedLevelBonus(actor);
  }

  window.DX3rdEffectLevel = {
    bonus: appliedLevelBonus,
    value,
  };
})();
