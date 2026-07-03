/** Shared template-context preparation for AppV1 and AppV2 combo sheets. */
(function() {
  const itemSheetData = window.DX3rdItemSheetData;
  const abilityKeys = ['body', 'sense', 'mind', 'social'];

  function normalizeIdList(value, fallback = []) {
    const source = value ?? fallback ?? [];
    return (Array.isArray(source) ? source : [source]).filter(id => typeof id === 'string' && id && id !== '-');
  }

  function getEffectIds(item, data = null) {
    const legacyEffect = item.system?.effect;
    return normalizeIdList(item.system?.effectIds ?? (Array.isArray(legacyEffect) ? legacyEffect : data?.system?.effectIds));
  }

  function getWeaponIds(item, data = null) {
    return normalizeIdList(item.system?.weapon ?? data?.system?.weapon);
  }

  function calculateEncroachment(actor, effectIds) {
    let totalDice = 0;
    let totalAdd = 0;

    for (const effectId of normalizeIdList(effectIds)) {
      const effectItem = actor?.items.get(effectId);
      if (!effectItem) continue;

      const encValue = String(effectItem.system.encroach?.value || '0').trim();
      const diceMatch = encValue.match(/(\d+)d10/i);
      const addMatch = encValue.match(/([+-]\d+)$/);

      if (diceMatch) {
        totalDice += parseInt(diceMatch[1]) || 0;
      }

      if (addMatch) {
        totalAdd += parseInt(addMatch[1]) || 0;
      } else if (!diceMatch && !isNaN(parseInt(encValue))) {
        totalAdd += parseInt(encValue) || 0;
      }
    }

    if (totalDice > 0 && totalAdd > 0) return `${totalDice}d10+${totalAdd}`;
    if (totalDice > 0) return `${totalDice}d10`;
    return String(totalAdd);
  }

  function prepareEffectItems(actor, effectIds) {
    const effectItems = {};
    for (const effectId of normalizeIdList(effectIds)) {
      const effectItem = actor?.items.get(effectId);
      if (effectItem) effectItems[effectId] = effectItem;
    }
    return effectItems;
  }

  function calculateSubmittedAttack(actor, attackRoll, weaponIds) {
    if (!attackRoll || attackRoll === '-') return '-';

    let totalAttack = 0;
    if (actor) {
      totalAttack += Number(actor.system.attributes.attack?.value) || 0;
      totalAttack += Number(actor.system.attributes.attack?.[attackRoll]) || 0;
    }

    for (const weaponId of normalizeIdList(weaponIds)) {
      totalAttack += Number(actor?.items.get(weaponId)?.system?.attack) || 0;
    }

    return totalAttack;
  }

  function prepareSubmittedCombatValues(item, actor, {
    effectIds,
    weapons,
    attackRoll
  } = {}) {
    const normalizedEffectIds = normalizeIdList(effectIds ?? item.system?.effectIds ?? item.system?.effect ?? []);
    const normalizedWeapons = normalizeIdList(weapons ?? item.system?.weapon ?? []);
    const effectiveAttackRoll = attackRoll ?? item.system?.attackRoll;

    return {
      effectIds: normalizedEffectIds,
      encroachValue: calculateEncroachment(actor, normalizedEffectIds),
      weapons: normalizedWeapons,
      attackValue: calculateSubmittedAttack(actor, effectiveAttackRoll, normalizedWeapons)
    };
  }

  // 콤보 필드가 "비어있다"(미설정/기본값)고 볼지 판정
  function isEmptyComboField(value) {
    return value === undefined || value === null || value === '' || value === '-';
  }

  // 이펙트를 콤보에 추가할 때, 콤보의 빈 필드만 이펙트 값으로 자동 채운다(사용자가 이미 설정한 값은 보존).
  // 정책: 사용자가 선택한 "빈 필드만 자동 채움".
  function computeInheritedComboFields(comboItem, effectItem, actor) {
    const updates = {};
    const es = effectItem?.system || {};
    const cs = comboItem?.system || {};

    // 스킬(+ 능력치 base)
    if (isEmptyComboField(cs.skill) && !isEmptyComboField(es.skill)) {
      updates['system.skill'] = es.skill;
      if (!isEmptyComboField(es.base)) updates['system.base'] = es.base;
    }
    if (updates['system.base'] === undefined && isEmptyComboField(cs.base) && !isEmptyComboField(es.base)) {
      updates['system.base'] = es.base;
    }

    // 타이밍 (빈 값일 때만 상속). 사거리/대상은 combineEffectsRangeTarget으로 전체 재계산하므로 여기서 제외.
    if (isEmptyComboField(cs.timing) && !isEmptyComboField(es.timing)) updates['system.timing'] = es.timing;

    // 공격판정 (melee/ranged만 상속)
    if (isEmptyComboField(cs.attackRoll) && (es.attackRoll === 'melee' || es.attackRoll === 'ranged')) {
      updates['system.attackRoll'] = es.attackRoll;
    }

    // 무기: 이펙트가 무기를 고정(weaponSelect: false)하고 콤보 무기 슬롯이 비어있으면 상속
    const currentWeapons = getWeaponIds(comboItem);
    if (currentWeapons.length === 0 && es.weaponSelect === false && Array.isArray(es.weapon)) {
      const inheritedWeapons = es.weapon.filter(w => w && w !== '-');
      if (inheritedWeapons.length > 0) updates['system.weapon'] = inheritedWeapons;
    }

    // 공격판정/무기가 바뀌었으면 공격력도 재계산
    if (updates['system.attackRoll'] !== undefined || updates['system.weapon'] !== undefined) {
      const finalAttackRoll = updates['system.attackRoll'] ?? cs.attackRoll;
      const finalWeapons = updates['system.weapon'] ?? currentWeapons;
      updates['system.attack.value'] = calculateSubmittedAttack(actor, finalAttackRoll, finalWeapons);
    }

    return updates;
  }

  // 무기를 콤보에 추가할 때, 콤보의 빈 공격 관련 필드만 무기 값으로 자동 채운다(공격 콤보 자동화).
  // - 무기 type(melee/ranged) → attackRoll
  // - 무기 skill(사격/RC/백병 등) → skill (+ base 능력치)
  // - 공격판정이 생기고 roll이 비어있으면 major로(명중 판정)
  // 정책: 이펙트 상속과 동일하게 "빈 필드만 자동 채움"(사용자 지정값 보존).
  function computeInheritedWeaponFields(comboItem, weaponItem, actor) {
    const updates = {};
    const ws = weaponItem?.system || {};
    const cs = comboItem?.system || {};

    // 공격판정: 무기 type이 melee/ranged면 빈 attackRoll 채움
    if (isEmptyComboField(cs.attackRoll) && (ws.type === 'melee' || ws.type === 'ranged')) {
      updates['system.attackRoll'] = ws.type;
    }

    // 기능: 무기의 공격 기능(사격/RC/백병 등)이 지정돼 있으면 상속.
    // 지정이 없으면 무기 type으로 기본 공격 기능을 유추(ranged→사격, melee→백병).
    if (isEmptyComboField(cs.skill)) {
      let skillKey = !isEmptyComboField(ws.skill) ? ws.skill : null;
      if (!skillKey) {
        if (ws.type === 'ranged') skillKey = 'ranged';
        else if (ws.type === 'melee') skillKey = 'melee';
      }
      if (skillKey) {
        updates['system.skill'] = skillKey;
        const baseAttr = abilityKeys.includes(skillKey)
          ? skillKey
          : actor?.system?.attributes?.skills?.[skillKey]?.base;
        if (baseAttr && isEmptyComboField(cs.base)) updates['system.base'] = baseAttr;
      }
    }

    // 공격판정이 생겼는데 roll이 비어있으면 명중 판정(major) 활성화
    if (updates['system.attackRoll'] !== undefined && isEmptyComboField(cs.roll)) {
      updates['system.roll'] = 'major';
    }

    // 공격판정이 확정됐으면 공격력 재계산(무기 슬롯엔 이미 추가된 무기가 포함됨)
    if (updates['system.attackRoll'] !== undefined) {
      const finalAttackRoll = updates['system.attackRoll'] ?? cs.attackRoll;
      updates['system.attack.value'] = calculateSubmittedAttack(actor, finalAttackRoll, getWeaponIds(comboItem));
    }

    return updates;
  }

  // 무기 추가 직후 호출: 콤보를 공격 콤보로 자동 구성(빈 값만). 무기 아이템에만 적용(비클 제외).
  async function applyWeaponAutoAttack(comboItem, actor, weaponId) {
    if (!comboItem || !weaponId || weaponId === '-') return false;
    const weaponItem = actor?.items.get(weaponId);
    if (!weaponItem || weaponItem.type !== 'weapon') return false;
    const updates = computeInheritedWeaponFields(comboItem, weaponItem, actor);
    if (Object.keys(updates).length === 0) return false;
    await comboItem.update(updates);
    return true;
  }

  // 조합된 전체 이펙트에서 사거리/대상을 합성(가장 제한적인 값). 자신 규칙 위반은 selfConflict로 표시.
  function combineEffectsRangeTarget(actor, effectIds) {
    const RT = window.DX3rdRangeTarget;
    if (!RT) return null;
    const ranges = [], targets = [];
    for (const id of normalizeIdList(effectIds)) {
      const eff = actor?.items.get(id);
      if (!eff) continue;
      ranges.push(eff.system?.range);
      targets.push(eff.system?.target);
    }
    return { range: RT.combineRange(ranges), target: RT.combineTarget(targets) };
  }

  async function addRegisteredEffect(item, actor, effectId) {
    if (!effectId || effectId === '-') {
      ui.notifications.warn("추가할 이펙트를 선택해주세요.");
      return false;
    }

    const currentEffects = getEffectIds(item);
    if (currentEffects.includes(effectId)) {
      ui.notifications.warn("이미 추가된 이펙트입니다.");
      return false;
    }

    const newEffects = [...currentEffects, effectId];
    // 빈 필드 자동 반영: 스킬/능력치/타이밍/공격판정/무기를 콤보 빈칸에 채움.
    const updates = {
      'system.effectIds': newEffects,
      'system.encroach.value': calculateEncroachment(actor, newEffects),
      ...computeInheritedComboFields(item, actor?.items.get(effectId), actor)
    };

    // 사거리/대상: 전체 조합 이펙트에서 재계산(작은 쪽). rankable 결과가 없으면(모두 효과참조 등) 사용자 값 보존.
    const combined = combineEffectsRangeTarget(actor, newEffects);
    if (combined?.range?.resolved) updates['system.range'] = combined.range.value;
    if (combined?.target?.resolved) updates['system.target'] = combined.target.value;

    await item.update(updates);

    // 자신 대상 이펙트를 비자신과 섞은 경우 경고(진행은 허용).
    if (combined?.target?.selfConflict) {
      ui.notifications.warn(game.i18n.localize('DX3rd.SelfCombineWarning'));
    }
    return true;
  }

  function openRegisteredEffectSheet(actor, effectId) {
    if (!effectId) {
      ui.notifications.warn("편집할 이펙트를 찾을 수 없습니다.");
      return false;
    }

    const effectItem = actor?.items.get(effectId);
    if (effectItem?.type === 'effect') {
      effectItem.sheet.render(true);
      return true;
    }

    ui.notifications.warn("이펙트 아이템을 찾을 수 없습니다.");
    return false;
  }

  async function removeRegisteredEffect(item, actor, effectId) {
    if (!effectId) {
      ui.notifications.warn("삭제할 이펙트를 찾을 수 없습니다.");
      return false;
    }

    const newEffects = getEffectIds(item).filter(id => id !== effectId);
    const updates = {
      'system.effectIds': newEffects,
      'system.encroach.value': calculateEncroachment(actor, newEffects)
    };
    // 제거 후 남은 이펙트로 사거리/대상 재계산(rankable 없으면 보존).
    const combined = combineEffectsRangeTarget(actor, newEffects);
    if (combined?.range?.resolved) updates['system.range'] = combined.range.value;
    if (combined?.target?.resolved) updates['system.target'] = combined.target.value;
    await item.update(updates);
    return true;
  }

  async function updateBaseAttributeForSkill(item, actor, skillValue) {
    if (!skillValue || skillValue === '-') return false;

    const baseAttribute = abilityKeys.includes(skillValue)
      ? skillValue
      : actor?.system?.attributes?.skills?.[skillValue]?.base;

    if (!baseAttribute) return false;

    await item.update({'system.base': baseAttribute});
    return true;
  }

  function getDifficultyToggleUpdate(item, checked) {
    if (checked) {
      return {
        'system.roll': 'major',
        'system.difficulty': '',
        'system.-=roll-check': null
      };
    }

    const freepassText = game.i18n.localize('DX3rd.Freepass');
    const currentDifficulty = item.system?.difficulty || '';
    return {
      'system.roll': '-',
      'system.difficulty': (currentDifficulty === freepassText || currentDifficulty === '-') ? currentDifficulty : freepassText,
      'system.attackRoll': '-',
      'system.-=roll-check': null
    };
  }

  function isDifficultyValueValid(item, value) {
    if (!value) return true;

    const rollValue = item.system?.roll || '-';
    const competitionText = game.i18n.localize('DX3rd.Competition');
    const referenceText = game.i18n.localize('DX3rd.Reference');
    const freepassText = game.i18n.localize('DX3rd.Freepass');

    if (rollValue === '-') return value === freepassText || value === '-';

    const numValue = Number(value);
    return (Number.isInteger(numValue) && numValue >= 1)
      || value === competitionText
      || value === referenceText;
  }

  function getDifficultyValidationMessage(item) {
    const rollValue = item.system?.roll || '-';
    const competitionText = game.i18n.localize('DX3rd.Competition');
    const referenceText = game.i18n.localize('DX3rd.Reference');
    const freepassText = game.i18n.localize('DX3rd.Freepass');

    if (rollValue === '-') {
      return `판정이 비활성화된 경우 난이도는 "${freepassText}" 또는 "-"만 입력할 수 있습니다.`;
    }
    return `판정이 활성화된 경우 난이도는 1 이상의 정수, "${competitionText}", 또는 "${referenceText}"만 입력할 수 있습니다.`;
  }

  function isLimitValueValid(value) {
    return !value || /^(-|\d+|\d+%)$/.test(value);
  }

  function getRollDataForType(baseData, rollType) {
    if (rollType === 'major') return baseData.major;
    if (rollType === 'reaction') return baseData.reaction;
    if (rollType === 'dodge') return baseData.dodge;
    return null;
  }

  function resolveRollBase(actor, skillKey, baseKey, rollType) {
    const isAbility = abilityKeys.includes(skillKey);
    let skillData = null;
    let baseData = null;

    if (isAbility) {
      skillData = actor.system.attributes[skillKey];
      baseData = skillData;
    } else {
      skillData = actor.system.attributes.skills?.[skillKey];
      const effectiveBase = (baseKey && baseKey !== '-') ? baseKey : skillData?.base;
      if (effectiveBase && abilityKeys.includes(effectiveBase)) {
        baseData = actor.system.attributes[effectiveBase];
      }
    }

    if (!skillData || !baseData) return null;

    let dice = 0;
    let add = 0;
    let critical = 10;
    let criticalMin = actor.system.attributes.critical?.min || 2;

    if (isAbility) {
      const baseRollData = getRollDataForType(baseData, rollType);
      if (baseRollData) {
        dice = baseRollData.dice || 0;
        add = baseRollData.add || 0;
        critical = baseRollData.critical || 10;
      }
    } else {
      const originalBase = skillData.base;
      const originalBaseData = actor.system.attributes[originalBase];
      const skillDiceBonus = (skillData.dice || 0) - (originalBaseData?.dice || 0);
      const skillAddBonus = (skillData.add || 0) - (originalBaseData?.add || 0);
      const baseRollData = getRollDataForType(baseData, rollType);

      if (baseRollData) {
        dice = (baseRollData.dice || 0) + skillDiceBonus;
        add = (baseRollData.add || 0) + skillAddBonus;
        critical = baseRollData.critical || 10;
      }
    }

    return {skillData, isAbility, dice, add, critical, criticalMin};
  }

  function calculateWeaponAddBonus(actor, weaponIds) {
    let weaponAddBonus = 0;
    for (const weaponId of normalizeIdList(weaponIds)) {
      const weaponItem = actor?.items.get(weaponId);
      if (weaponItem) {
        const weaponAdd = Number(weaponItem.system?.add) || 0;
        weaponAddBonus += weaponAdd;
      }
    }
    return weaponAddBonus;
  }

  function getEffectiveBaseKey(baseKey, isAbility, skillKey, skillData) {
    return (baseKey && baseKey !== '-') ? baseKey : (isAbility ? skillKey : skillData?.base);
  }

  function matchesRollTarget({isAbility, skillKey, effectiveBaseKey, label}) {
    if (!label) return false;
    if (isAbility) return label === skillKey;

    const matchesDirect = label === skillKey;
    const matchesGroup = window.DX3rdSkillGroupMatcher?.isSkillInGroup(skillKey, label);
    const matchesBase = effectiveBaseKey && label === effectiveBaseKey;
    return matchesDirect || matchesGroup || matchesBase;
  }

  function evaluateAttributeValue(value, sourceItem, actor, fallback = 0) {
    if (typeof value === 'object' && value && 'value' in value) {
      return Number(value.value) || fallback;
    }
    return window.DX3rdFormulaEvaluator?.evaluate(value, sourceItem, actor) || fallback;
  }

  function forEachMainAttribute(attributes, callback) {
    if (!attributes) return;
    for (const attrData of Object.values(attributes)) {
      if (!attrData || !attrData.key || !attrData.value) continue;
      callback({
        key: attrData.key,
        label: attrData.label,
        value: attrData.value
      });
    }
  }

  function forEachEffectAttribute(attributes, callback) {
    if (!attributes) return;
    for (const [attrName, attrValue] of Object.entries(attributes)) {
      const key = (typeof attrValue === 'object' && attrValue.key) ? attrValue.key : attrName;
      const label = (typeof attrValue === 'object' && attrValue.label) ? attrValue.label :
        (typeof attrName === 'string' && attrName.includes(':')) ? attrName.split(':')[1] : '';
      callback({key, label, value: attrValue});
    }
  }

  function addRollAttributeBonus(bonus, {key, label, value, sourceItem, actor, rollType, isAbility, skillKey, effectiveBaseKey}) {
    if (!key) return;

    const numericValue = () => Number(evaluateAttributeValue(value, sourceItem, actor, 0)) || 0;

    if (rollType === 'major') {
      if (key === 'major_dice' || key === 'dice') {
        bonus.dice += numericValue();
      } else if (key === 'major_add' || key === 'add') {
        bonus.add += numericValue();
      } else if (key === 'major_critical' || key === 'critical') {
        bonus.criticalMod += numericValue();
      }
    } else if (rollType === 'reaction') {
      if (key === 'reaction_dice' || key === 'dice') {
        bonus.dice += numericValue();
      } else if (key === 'reaction_add' || key === 'add') {
        bonus.add += numericValue();
      } else if (key === 'reaction_critical' || key === 'critical') {
        bonus.criticalMod += numericValue();
      }
    } else if (rollType === 'dodge') {
      if (key === 'reaction_dice' || key === 'dodge_dice' || key === 'dice') {
        bonus.dice += numericValue();
      } else if (key === 'reaction_add' || key === 'dodge_add' || key === 'add') {
        bonus.add += numericValue();
      } else if (key === 'reaction_critical' || key === 'dodge_critical' || key === 'critical') {
        bonus.criticalMod += numericValue();
      }
    }

    if (key === 'stat_dice' && label) {
      if (matchesRollTarget({isAbility, skillKey, effectiveBaseKey, label})) {
        bonus.dice += numericValue();
      }
    } else if (key === 'stat_add' && label) {
      if (matchesRollTarget({isAbility, skillKey, effectiveBaseKey, label})) {
        bonus.add += numericValue();
      }
    } else if (key === 'critical_min') {
      const minValue = Number(evaluateAttributeValue(value, sourceItem, actor, 10)) || 10;
      if (minValue < bonus.criticalMin) {
        bonus.criticalMin = minValue;
      }
    }
  }

  function addMainAttributeBonuses(bonus, attributes, sourceItem, actor, rollContext) {
    forEachMainAttribute(attributes, ({key, label, value}) => {
      addRollAttributeBonus(bonus, {
        key,
        label,
        value,
        sourceItem,
        actor,
        ...rollContext
      });
    });
  }

  function addEffectAttributeBonuses(bonus, attributes, sourceItem, actor, rollContext) {
    forEachEffectAttribute(attributes, ({key, label, value}) => {
      addRollAttributeBonus(bonus, {
        key,
        label,
        value,
        sourceItem,
        actor,
        ...rollContext
      });
    });
  }

  function createRollBonus(criticalMin) {
    return {
      dice: 0,
      add: 0,
      criticalMod: 0,
      criticalMin
    };
  }

  function applyRollBonus(base, bonus) {
    base.dice += bonus.dice;
    base.add += bonus.add;
    base.criticalMin = Math.max(2, bonus.criticalMin);
    base.critical = Math.max(base.criticalMin, base.critical + bonus.criticalMod);
    return base;
  }

  function calculateItemRollBonus(item, actor, rollContext, criticalMin) {
    const bonus = createRollBonus(criticalMin);
    addMainAttributeBonuses(bonus, item.system?.attributes, item, actor, rollContext);
    addEffectAttributeBonuses(bonus, item.system?.effect?.attributes, item, actor, rollContext);
    return bonus;
  }

  function forEachInactiveRegisteredEffect(actor, effectIds, callback) {
    for (const effectId of normalizeIdList(effectIds)) {
      const effectItem = actor?.items.get(effectId);
      if (!effectItem || effectItem.type !== 'effect') continue;

      // 활성화된 이펙트는 이미 액터의 prepareData에서 계산되었으므로 제외 (2중 계산 방지)
      if (effectItem.system?.active?.state === true) continue;

      callback(effectItem);
    }
  }

  function calculateRegisteredEffectRollBonus(actor, effectIds, rollContext, criticalMin) {
    const bonus = createRollBonus(criticalMin);

    forEachInactiveRegisteredEffect(actor, effectIds, effectItem => {
      addMainAttributeBonuses(bonus, effectItem.system?.attributes, effectItem, actor, rollContext);
      addEffectAttributeBonuses(bonus, effectItem.system?.effect?.attributes, effectItem, actor, rollContext);
    });

    return bonus;
  }

  function prepareComboBaseFields(data, item) {
    if (data.system.description === undefined) {
      data.system.description = item.system?.description || "";
    }

    data.system.skill = item.system?.skill || "-";
    data.system.base = item.system?.base || "-";
    data.system.roll = item.system?.roll || "-";
    data.system.difficulty = item.system?.difficulty || "";
    data.system.timing = item.system?.timing || "-";
    data.system.range = item.system?.range || "";
    data.system.target = item.system?.target || "";
    data.system.getTarget = item.system?.getTarget || false;
    data.system.limit = item.system?.limit || "-";

    itemSheetData.prepareActiveData(item, data, {
      disableFallback: "notCheck",
      undefinedOnly: true
    });

    itemSheetData.prepareEffectData(item, data, {
      undefinedOnly: true
    });

    data.system.macro = item.system?.macro || "";
    data.system.effectTmp = item.system?.effectTmp || "-";
    data.system.effectIds = getEffectIds(item, data);
    data.system.effectItems = {};
    data.system.attackAchievement = item.system?.attackAchievement || "-";
    data.system.encroach = item.system?.encroach || { value: 0 };
  }

  function prepareActorEffectOptions(data, actor) {
    data.actorEffect = {};
    if (!actor) return;

    const effectItems = actor.items.filter(item => item.type === 'effect')
      .sort((a, b) => (a.sort || 0) - (b.sort || 0));
    effectItems.forEach(item => {
      data.actorEffect[item.id] = item.name;
    });
  }

  function prepareRollAndAttackPlaceholders(data, item) {
    const hasRoll = data.system.roll && data.system.roll !== '-';
    const hasAttackRoll = data.system.attackRoll && data.system.attackRoll !== '-';

    if (!hasRoll) {
      data.system.dice = { value: '-' };
      data.system.critical = { value: '-', min: '-' };
      data.system.add = { value: '-' };
    } else {
      data.system.dice = item.system?.dice || { value: 0 };
      data.system.critical = item.system?.critical || { value: 0, min: 2 };
      data.system.add = item.system?.add || { value: 0 };
    }

    if (!hasAttackRoll) {
      data.system.attack = { value: '-' };
    } else {
      data.system.attack = item.system?.attack || { value: 0 };
    }

    return {hasRoll, hasAttackRoll};
  }

  function calculateActorAttack(actor, attackRoll) {
    if (!actor) return 0;

    let actorAttack = Number(actor.system.attributes.attack?.value) || 0;
    if (attackRoll === 'melee') {
      actorAttack += Number(actor.system.attributes.attack?.melee) || 0;
    } else if (attackRoll === 'ranged') {
      actorAttack += Number(actor.system.attributes.attack?.ranged) || 0;
    }
    return actorAttack;
  }

  function calculateWeaponAttack(actor, weaponIds) {
    let weaponAttack = 0;
    for (const weaponId of normalizeIdList(weaponIds)) {
      weaponAttack += Number(actor?.items.get(weaponId)?.system?.attack) || 0;
    }
    return weaponAttack;
  }

  function matchesAttackLabel(label, attackRoll, emptyMatches = false) {
    if (!label) return emptyMatches;
    return label === '-' || label === attackRoll;
  }

  function addMainAttackBonuses(item, actor, attackRoll) {
    let attackBonus = 0;

    forEachMainAttribute(item.system?.attributes, ({key, label, value}) => {
      if (key !== 'attack') return;
      if (!matchesAttackLabel(label || '-', attackRoll)) return;

      const bonusValue = window.DX3rdFormulaEvaluator?.evaluate(value, item, actor) || 0;
      attackBonus += Number(bonusValue) || 0;
    });

    return attackBonus;
  }

  function addEffectAttackBonuses(item, actor, attackRoll) {
    let attackBonus = 0;

    forEachEffectAttribute(item.system?.effect?.attributes, ({key, label, value}) => {
      if (key !== 'attack') return;
      if (!matchesAttackLabel(label, attackRoll, true)) return;

      attackBonus += Number(evaluateAttributeValue(value, item, actor, 0)) || 0;
    });

    return attackBonus;
  }

  function calculateItemAttackBonus(item, actor, attackRoll) {
    if (item.system?.active?.state === true) return 0;
    return addMainAttackBonuses(item, actor, attackRoll) + addEffectAttackBonuses(item, actor, attackRoll);
  }

  function calculateRegisteredEffectAttackBonus(actor, effectIds, attackRoll) {
    let attackBonus = 0;

    forEachInactiveRegisteredEffect(actor, effectIds, effectItem => {
      attackBonus += addMainAttackBonuses(effectItem, actor, attackRoll);
      attackBonus += addEffectAttackBonuses(effectItem, actor, attackRoll);
    });

    return attackBonus;
  }

  function getAttackLabel(attackRoll) {
    if (attackRoll === 'melee') return game.i18n.localize('DX3rd.MeleeAttack');
    if (attackRoll === 'ranged') return game.i18n.localize('DX3rd.RangedAttack');
    return game.i18n.localize('DX3rd.Attack');
  }

  function prepareAttackSummary(data, item, actor) {
    const currentAttackRoll = item.system.attackRoll || data.system.attackRoll;
    if (currentAttackRoll && currentAttackRoll !== '-') {
      const registeredWeapons = getWeaponIds(item, data);
      const totalAttack = calculateActorAttack(actor, currentAttackRoll)
        + calculateWeaponAttack(actor, registeredWeapons)
        + calculateItemAttackBonus(item, actor, currentAttackRoll)
        + calculateRegisteredEffectAttackBonus(actor, data.system.effectIds, currentAttackRoll);
      
      data.system.attack = { value: totalAttack };
      data.attackLabel = getAttackLabel(currentAttackRoll);
    } else {
      // system.attackRoll이 '-'이거나 설정되지 않은 경우
      data.system.attack = { value: '-' };
      data.attackLabel = getAttackLabel(currentAttackRoll);
    }
  }

  function prepareRollSummary(data, item, actor, hasRoll) {
    if (!hasRoll) return;

    const skillKey = data.system.skill;
    const baseKey = data.system.base || '-';
    if (!actor || !skillKey || skillKey === '-') return;

    const rollType = data.system.roll;
    const rollBase = resolveRollBase(actor, skillKey, baseKey, rollType);
    if (!rollBase) return;

    let {skillData, dice, add, critical, criticalMin} = rollBase;

    const currentAttackRoll = item.system.attackRoll || data.system.attackRoll;
    if (currentAttackRoll && currentAttackRoll !== '-') {
      add += calculateWeaponAddBonus(actor, getWeaponIds(item, data));
    }

    if (rollType && rollType !== '-') {
      const isAbility = abilityKeys.includes(skillKey);
      const effectiveBaseKey = getEffectiveBaseKey(baseKey, isAbility, skillKey, skillData);
      const rollContext = {rollType, isAbility, skillKey, effectiveBaseKey};

      // 콤보 아이템 자체의 attributes 보너스 추가 (활성화되지 않은 경우만)
      // stat_bonus, skill_bonus는 제외 (능력치/스킬 total 값에 영향을 주므로 dice/add 계산과는 별개)
      if (item.system?.active?.state !== true) {
        const comboBonus = calculateItemRollBonus(item, actor, rollContext, criticalMin);
        dice += comboBonus.dice;
        add += comboBonus.add;
        critical += comboBonus.criticalMod;
        criticalMin = comboBonus.criticalMin;
      }

      // 이펙트 attributes 보너스 추가 (활성화되지 않은 것만)
      const effectBonus = calculateRegisteredEffectRollBonus(actor, data.system.effectIds, rollContext, criticalMin);
      ({dice, add, critical, criticalMin} = applyRollBonus({dice, add, critical, criticalMin}, effectBonus));
    }

    data.system.dice = { value: dice };
    data.system.add = { value: add };
    data.system.critical = { value: critical, min: criticalMin };
  }

  async function prepareSheetData(data, item, actor) {
    
    // 액터 정보 추가 (에너미 체크용)
    if (actor) {
      data.actor = {
        id: actor.id,
        type: actor.type
      };
    } else {
      data.actor = null;
    }

    // 콤보 시트 필드 초기화 (기존 데이터 보존)
    prepareComboBaseFields(data, item);
    
    // system.roll과 system.attackRoll 확인
    const {hasRoll} = prepareRollAndAttackPlaceholders(data, item);

    // 액터 이펙트 아이템 목록 생성 (sort 값으로 정렬)
    prepareActorEffectOptions(data, actor);

    // 이펙트 아이템 데이터 로드 및 침식률 자동 계산
    data.system.effectItems = prepareEffectItems(actor, data.system.effectIds);

    // 계산된 총 침식률을 data.system.encroach에 반영
    data.system.encroach = { value: calculateEncroachment(actor, data.system.effectIds) };

    // roll이 설정되어 있으면 다이스/크리티컬/수정치 자동 계산
    prepareRollSummary(data, item, actor, hasRoll);

    // 공격력 계산 (실제 아이템 데이터에서 attackRoll 확인)
    prepareAttackSummary(data, item, actor);

    // 무기 탭 데이터 준비 (WeaponTabManager 사용)
    data = window.DX3rdWeaponTabManager.prepareWeaponTabData(data, item);

    // attributes 초기화 (기존 데이터 보존)
    itemSheetData.preserveAttributeData(item, data);

    // 액터 스킬 데이터 추가
    itemSheetData.prepareSkillOptions(item, data, 'combo', {includeActorType: true});

    // Description 에디터를 위한 데이터 추가 (helpers.js 사용)
    data = await itemSheetData.enrichSheetData(item, data);

    // getTarget / scene 체크박스 초기화
    itemSheetData.prepareTargetFlags(item, data);

    // 사정거리/대상/난이도 드롭다운 컨텍스트
    if (window.DX3rdRangeTarget) {
      data.rangeField = window.DX3rdRangeTarget.fieldContext('range', data.system.range);
      data.targetField = window.DX3rdRangeTarget.fieldContext('target', data.system.target);
      data.difficultyField = window.DX3rdRangeTarget.difficultyFieldContext(data.system.difficulty);
    }

    // 액터 데이터를 템플릿에 전달
    data.actor = actor;

    return data;
  }

  window.DX3rdComboData = {
    prepareSheetData,
    normalizeIdList,
    getEffectIds,
    getWeaponIds,
    calculateEncroachment,
    calculateSubmittedAttack,
    prepareSubmittedCombatValues,
    addRegisteredEffect,
    computeInheritedComboFields,
    computeInheritedWeaponFields,
    applyWeaponAutoAttack,
    openRegisteredEffectSheet,
    removeRegisteredEffect,
    updateBaseAttributeForSkill,
    getDifficultyToggleUpdate,
    isDifficultyValueValid,
    getDifficultyValidationMessage,
    isLimitValueValid
  };
})();
