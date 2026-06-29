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
    await item.update({
      'system.effectIds': newEffects,
      'system.encroach.value': calculateEncroachment(actor, newEffects)
    });
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
    await item.update({
      'system.effectIds': newEffects,
      'system.encroach.value': calculateEncroachment(actor, newEffects)
    });
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
    openRegisteredEffectSheet,
    removeRegisteredEffect,
    updateBaseAttributeForSkill,
    getDifficultyToggleUpdate,
    isDifficultyValueValid,
    getDifficultyValidationMessage,
    isLimitValueValid
  };
})();
