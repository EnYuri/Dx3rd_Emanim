/** Shared template-context preparation for 이전 시트 and AppV2 combo sheets. */
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

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, character => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;'
    })[character]);
  }

  function getEffectDisplayLevel(effect, actor) {
    if (window.DX3rdEffectLevel) return window.DX3rdEffectLevel.value(effect, actor);
    const level = effect?.system?.level || {};
    const baseLevel = Number(level.init ?? level.value ?? 0) || 0;
    const encroachmentLevel = level.upgrade
      ? Number(actor?.system?.attributes?.encroachment?.level) || 0
      : 0;
    return baseLevel + encroachmentLevel;
  }

  function getAutomaticEffectName(effect) {
    const name = String(effect?.name || '').trim();
    const concentrate = game.i18n.localize('DX3rd.ConcentrateCanonical');
    const reflex = game.i18n.localize('DX3rd.ReflexCanonical');
    if (name.startsWith(concentrate)) return concentrate;
    if (name.startsWith(reflex)) return reflex;
    return name;
  }

  /** 설명이 비어 있는 콤보 채팅 카드에 표시할 현재 조합 요약. */
  function buildAutomaticDescription(item, actor) {
    const parts = [];
    const levelLabel = game.i18n.localize('DX3rd.LevelAbbreviation');

    for (const effectId of getEffectIds(item)) {
      const effect = actor?.items.get(effectId);
      if (!effect || effect.type !== 'effect') continue;
      const name = getAutomaticEffectName(effect);
      if (!name) continue;
      parts.push(`${escapeHtml(name)} ${levelLabel}${getEffectDisplayLevel(effect, actor)}`);
    }

    for (const weaponId of getWeaponIds(item)) {
      const weapon = window.DX3rdResolveWeapon?.(actor, weaponId) || actor?.items.get(weaponId);
      if (!weapon || !['weapon', 'vehicle'].includes(weapon.type)) continue;
      parts.push(escapeHtml(weapon.name));
    }

    return parts.length ? `<p>${parts.join(' + ')}</p>` : '';
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

  function calculateSubmittedAttack(actor, attackRoll, weaponIds, effectIds = []) {
    if (!attackRoll || attackRoll === '-') return '-';

    let totalAttack = 0;
    if (actor) {
      totalAttack += Number(actor.system.attributes.attack?.value) || 0;
      totalAttack += Number(actor.system.attributes.attack?.[attackRoll]) || 0;
    }

    for (const weaponId of normalizeIdList(weaponIds)) {
      totalAttack += Number(window.DX3rdResolveWeapon(actor, weaponId)?.system?.attack) || 0;
    }
    totalAttack += getDirectEffectFormulaParts(actor, effectIds, 'attack').fixed;

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
      attackValue: calculateSubmittedAttack(actor, effectiveAttackRoll, normalizedWeapons, normalizedEffectIds)
    };
  }

  // 콤보 필드가 "비어있다"(미설정/기본값)고 볼지 판정
  function isEmptyComboField(value) {
    return value === undefined || value === null || value === '' || value === '-';
  }

  // 룰북 p.147: 조합하는 모든 이펙트의 타이밍과 기능은 일치해야 한다.
  // '-'는 아직 데이터가 채워지지 않은 상태이므로, 그것만으로는 조합을 막지 않는다.
  //
  // 타이밍이 "고정되지 않은" 이펙트는 이 일치 검사에서 빠진다.
  //   auto(오토 액션): 타이밍 제약 없이 언제든 선언할 수 있으므로 어떤 타이밍의 조합에도 얹힌다.
  //   always(상시): 발동 타이밍 자체가 없다.
  // 콤보의 타이밍은 이런 멤버가 아니라 타이밍이 고정된 멤버들이 정한다.
  const UNBOUND_TIMINGS = new Set(['auto', 'always']);
  // 복수 타이밍을 겸하는 이펙트가 실제로 어느 타이밍으로 취급될 수 있는지.
  // 자기 자신을 맨 앞에 둬야, 그 이펙트만 조합됐을 때 표시 타이밍이 원래 값으로 남는다.
  const TIMING_ALIASES = {
    'major-reaction': ['major-reaction', 'major', 'reaction']
  };
  function timingCandidates(timing) {
    return TIMING_ALIASES[timing] || [timing];
  }

  function getCombinedEffectTiming(actor, effectIds) {
    const timings = normalizeIdList(effectIds)
      .map(id => actor?.items.get(id)?.system?.timing)
      .filter(timing => !isEmptyComboField(timing));
    const bound = timings.filter(timing => !UNBOUND_TIMINGS.has(timing));
    const unbound = timings.filter(timing => UNBOUND_TIMINGS.has(timing));

    // 겸용 타이밍은 후보 집합의 교집합으로 좁힌다(메이저/리액션 이펙트는 양쪽 조합 모두에 들어간다).
    let candidates = null;
    for (const timing of bound) {
      const allowed = timingCandidates(timing);
      candidates = candidates === null ? allowed : candidates.filter(t => allowed.includes(t));
    }

    let value = null;
    if (candidates?.length) value = candidates[0];
    else if (candidates === null && unbound.length) value = unbound[0];

    return {
      value,
      valid: candidates === null || candidates.length > 0,
      timings: [...new Set(bound)],
      unbound: [...new Set(unbound)]
    };
  }

  function isComboTimingCompatible(comboItem, actor, effectIds) {
    const combined = getCombinedEffectTiming(actor, effectIds);
    if (!combined.valid) return false;
    const comboTiming = comboItem?.system?.timing;
    // 콤보 자신의 타이밍이 비었거나 고정되지 않은 값이면 멤버 쪽이 타이밍을 정한다.
    if (isEmptyComboField(comboTiming) || UNBOUND_TIMINGS.has(comboTiming)) return true;
    // 멤버가 오토/상시뿐이면(=고정 타이밍 멤버 없음) 콤보 타이밍에 아무 제약도 걸지 않는다.
    if (!combined.value || UNBOUND_TIMINGS.has(combined.value)) return true;
    return timingCandidates(comboTiming).includes(combined.value)
      || timingCandidates(combined.value).includes(comboTiming);
  }

  // 판정 "기능"이 아닌 센티넬 skill 값(콤보 판정 기능 소스에서 제외).
  //   syndrome: 컨센트레이트/리플렉스 등 — 이펙트를 사용한 판정에만 조합되는 순수 수정치(별도 attribute로 해소).
  //   text/cthulhu: 현재 데이터 없음(무시).
  const NON_JUDGMENT_SKILLS = new Set(['syndrome']);
  function isNonJudgmentSkill(value) {
    return NON_JUDGMENT_SKILLS.has(value);
  }

  function effectSkillChoices(effect) {
    const s = effect?.system || {};
    if (!isEmptyComboField(s.comboSkill)) return [s.comboSkill];
    const choices = Array.isArray(s.skillChoices) ? s.skillChoices.filter(v => !isEmptyComboField(v) && !isNonJudgmentSkill(v)) : [];
    if (choices.length) return choices;
    return (!isEmptyComboField(s.skill) && !isNonJudgmentSkill(s.skill)) ? [s.skill] : [];
  }
  function getCompatibleSkillChoices(effects) {
    const lists = effects.map(effectSkillChoices).filter(a => a.length);
    if (!lists.length) return [];
    return lists[0].filter(skill => lists.every(list => list.includes(skill)));
  }

  // 조합 자격 위반은 "경고만 하고 진행"이 원칙이다(validateComboCombination은 차단하지 않는다).
  // 따라서 기능이 서로 충돌해 교집합이 비어도 후보를 비워두면 안 된다 — 비우면 콤보의
  // 판정 기능/공격판정/공격력이 전부 미계산으로 남아, 경고만 하겠다는 원칙과 달리
  // 사실상 사용 불가한 콤보가 된다. 교집합이 없으면 합집합을 후보로 내려 사용자가 고르게 한다.
  function getComboSkillCandidates(effects) {
    const compatible = getCompatibleSkillChoices(effects);
    if (compatible.length) return compatible;
    const union = [];
    for (const list of effects.map(effectSkillChoices)) {
      for (const skill of list) if (!union.includes(skill)) union.push(skill);
    }
    return union;
  }

  // 콤보의 판정 기능(skill/base)·공격판정(attackRoll)·공격력을 "조합 우선순위"로 재계산.
  //
  // 우선순위(항상 재계산): 이펙트 명시기능 > 무기 명시기능 > 무기 type 유추(ranged→사격, melee→백병).
  //   근거: 룰 「이펙트가 우선」(rulebook-1-2 3251) — 장비품(무기)의 효과가 이펙트와 모순되면 이펙트가 우선.
  //   기능 변경(무기 명중판정을 〈RC〉/사격으로)은 이펙트 플레이버 텍스트에 있어 기계 판별 불가하므로,
  //   유일한 기계 신호인 이펙트 `system.skill`을 우선 신호로 사용한다.
  //
  // 사용자 수동값은 영구 잠금하지 않는다 — 새 이펙트/무기를 추가·삭제하면 이 우선순위로 다시 덮어씀.
  //   (사용자는 "최종 수정" 시점에 우선권을 가진다: 그 수정은 다음 추가/삭제 전까지 유지된다.)
  // 후보(이펙트/무기 기능 신호)가 하나도 없으면 기존 값을 보존한다(순수 수동 콤보 보호).
  //
  // effectIds/weaponIds를 넘기면 그 예정 목록으로 계산(추가/삭제가 저장되기 전 호출 대비).
  function deriveComboAttackFields(comboItem, actor, { effectIds, weaponIds } = {}) {
    const updates = {};
    const cs = comboItem?.system || {};
    const effIds = normalizeIdList(effectIds ?? getEffectIds(comboItem));
    const wpnIds = normalizeIdList(weaponIds ?? getWeaponIds(comboItem));

    const effects = effIds.map(id => actor?.items.get(id)).filter(Boolean);
    const weapons = wpnIds.map(id => actor?.items.get(id)).filter(w => w && w.type === 'weapon');

    // --- 판정 기능(skill/base) ---
    // 근거: 룰 「명중판정」(rulebook-1-2 p.145) — 명중판정은 "무기 및 이펙트에 지정된 기능"으로 하며,
    //   「이펙트가 우선」(p.147)으로 이펙트 지정 기능이 무기 기능을 이긴다.
    //   이펙트의 "지정된 기능"은 보통 기능 항목(system.skill)이지만, 본문(플레이버)에서
    //   "명중판정을 〈RC〉/사격/정신 등으로 변경"한다고 재정의하는 특수 이펙트는 기계 판별 불가하므로,
    //   전용 필드 system.comboSkill(조합시 기능 변경)을 두어 우선 신호로 쓰고 기능 항목을 폴백한다.
    let skill = null;
    const compatibleSkills = getComboSkillCandidates(effects);
    // B: 이펙트 지정 기능 — 조합시 기능 변경(comboSkill) 우선, 없으면 이펙트 기능 항목(skill) 폴백.
    //   단 skill='syndrome'(컨센트레이트/리플렉스 등)은 판정 기능이 아니라 "이펙트를 사용한 판정에만
    //   조합되는 순수 수정치" 센티넬이므로 콤보의 판정 기능 소스에서 제외한다(별도 attribute로 해소됨).
    //   또한 원본이 〈백병〉〈사격〉처럼 복수 기능을 허용하는 이펙트(skillChoices 2개 이상)는 이펙트가
    //   기능을 하나로 "지정"한 것이 아니므로 이펙트 우선 규칙이 걸리지 않는다. 이 경우 조합된 무기의
    //   기능/종별이 선택지 안에 있으면 그것으로 확정한다(권총과 조합한 콤보가 백병 판정이 되는 것을 방지).
    if (compatibleSkills.length === 1) {
      skill = compatibleSkills[0];
    } else if (compatibleSkills.length > 1) {
      const weaponSignal = [...weapons.map(w => w.system?.skill), ...weapons.map(w => w.system?.type)]
        .find(sig => !isEmptyComboField(sig) && compatibleSkills.includes(sig));
      skill = weaponSignal || (compatibleSkills.includes(cs.skill) ? cs.skill : compatibleSkills[0]);
    }
    // C: 무기 명시 기능
    if (!skill) {
      const wpnSkill = weapons.find(w => !isEmptyComboField(w.system?.skill));
      if (wpnSkill) skill = wpnSkill.system.skill;
    }
    // D: 무기 type 유추
    if (!skill) {
      const wpnType = weapons.find(w => w.system?.type === 'melee' || w.system?.type === 'ranged');
      if (wpnType) skill = wpnType.system.type;
    }
    if (skill) {
      if (skill !== cs.skill) updates['system.skill'] = skill;
      const baseAttr = abilityKeys.includes(skill)
        ? skill
        : actor?.system?.attributes?.skills?.[skill]?.base;
      if (baseAttr && baseAttr !== cs.base) updates['system.base'] = baseAttr;
    }

    // --- 능력치(base) 치환: 조합시 능력치 변경(comboBase) — 기능은 유지하고 판정치(능력치)만 교체 ---
    //   근거: 룰 p.136 판정 = 능력치(다이스 수) + 기능(달성치 레벨). "조합한 판정을 〈정신〉으로"류는
    //   기능(백병 등)의 레벨은 유지한 채 판정 능력치만 바꾸는 것이므로 skill이 아니라 base만 덮는다.
    //   (예: 컨트롤 소드 = 백병 기능 유지 + 정신 능력치.) skill 변경 여부와 무관하게 우선 적용.
    const effComboBase = effects.find(e => abilityKeys.includes(e.system?.comboBase));
    if (effComboBase) {
      const cb = effComboBase.system.comboBase;
      if (cb !== (updates['system.base'] ?? cs.base)) updates['system.base'] = cb;
    }

    // --- 공격판정(attackRoll): 이펙트 명시 attackRoll > 이펙트 기능 > 무기 type/기능 ---
    // 일부 기존 아이템은 attackRoll 대신 skill(또는 comboSkill)만 백병/사격으로 채워져 있다.
    // 이 경우도 공격 종류를 판별할 수 있으므로 폴백으로 사용한다.
    let attackRoll = null;
    const effAR = effects.find(e => e.system?.attackRoll === 'melee' || e.system?.attackRoll === 'ranged');
    if (effAR) attackRoll = effAR.system.attackRoll;
    if (!attackRoll) {
      if (skill === 'melee' || skill === 'ranged') attackRoll = skill;
    }
    if (!attackRoll) {
      const wpnAR = weapons.find(w => w.system?.type === 'melee' || w.system?.type === 'ranged');
      if (wpnAR) attackRoll = wpnAR.system.type;
    }
    if (!attackRoll) {
      const wpnSkillAR = weapons.find(w => w.system?.skill === 'melee' || w.system?.skill === 'ranged');
      if (wpnSkillAR) attackRoll = wpnSkillAR.system.skill;
    }
    if (attackRoll && attackRoll !== cs.attackRoll) {
      updates['system.attackRoll'] = attackRoll;
      // 공격판정이 새로 생겼는데 roll이 비어있으면 명중 판정(major) 활성화
      if (isEmptyComboField(cs.roll)) updates['system.roll'] = 'major';
    }

    // --- 공격력 재계산 ---
    const finalAttackRoll = updates['system.attackRoll'] ?? cs.attackRoll;
    if (finalAttackRoll && finalAttackRoll !== '-') {
      updates['system.attack.value'] = calculateSubmittedAttack(actor, finalAttackRoll, wpnIds, effIds);
    }

    return updates;
  }

  // 이펙트를 콤보에 추가할 때: 해설 탭의 기본값(타이밍/판정 종류/난이도)과 고정무기를
  // 빈 값일 때만 상속하고, 판정 기능/공격판정은 조합 우선순위로 재계산.
  // prospectiveEffectIds: 아직 저장 전인 예정 이펙트 목록(방금 추가한 이펙트 포함).
  function computeInheritedComboFields(comboItem, effectItem, actor, prospectiveEffectIds = null) {
    const updates = {};
    const es = effectItem?.system || {};
    const cs = comboItem?.system || {};

    // 타이밍 (빈 값일 때만 상속). 사거리/대상은 combineEffectsRangeTarget으로 전체 재계산.
    if (isEmptyComboField(cs.timing) && !isEmptyComboField(es.timing)) updates['system.timing'] = es.timing;

    // 무기: 이펙트가 무기를 고정(weaponSelect: false)하고 콤보 무기 슬롯이 비어있으면 상속
    const currentWeapons = getWeaponIds(comboItem);
    let effectiveWeapons = currentWeapons;
    if (currentWeapons.length === 0 && es.weaponSelect === false && Array.isArray(es.weapon)) {
      const inheritedWeapons = es.weapon.filter(w => w && w !== '-');
      if (inheritedWeapons.length > 0) {
        updates['system.weapon'] = inheritedWeapons;
        effectiveWeapons = inheritedWeapons;
      }
    }

    // 판정 기능/공격판정/공격력: 조합 우선순위로 재계산(방금 추가한 이펙트/고정무기 포함).
    Object.assign(updates, deriveComboAttackFields(comboItem, actor, {
      effectIds: prospectiveEffectIds ?? getEffectIds(comboItem),
      weaponIds: effectiveWeapons
    }));

    // 공격판정이 없는 이펙트도 자체 판정을 요구할 수 있다. 기존에는 attackRoll이 있을 때만
    // roll='major'가 채워져, 일반 판정 이펙트를 넣어도 해설 탭이 '-'로 남았다.
    // 사용자가 이미 고른 콤보 판정/난이도는 보존하고, 기본값일 때만 이펙트 값을 상속한다.
    if (isEmptyComboField(cs.roll) && !isEmptyComboField(es.roll)) {
      updates['system.roll'] = es.roll;
    }
    if (isEmptyComboField(cs.difficulty) && !isEmptyComboField(es.difficulty)) {
      updates['system.difficulty'] = es.difficulty;
    }

    return updates;
  }

  // 무기를 콤보에 추가할 때: 조합 우선순위로 판정 기능/공격판정/공격력을 재계산(공격 콤보 자동화).
  // (무기는 이미 슬롯에 추가된 상태로 호출됨.)
  function computeInheritedWeaponFields(comboItem, weaponItem, actor) {
    return deriveComboAttackFields(comboItem, actor);
  }

  // 조합 무기가 바뀌면 「무기」 사정거리를 쓰는 이펙트의 사정거리가 달라지므로 range/target도 재계산해 updates에 반영.
  function applyWeaponRangeRecalc(updates, comboItem, actor) {
    const combined = combineEffectsRangeTarget(actor, getEffectIds(comboItem), getWeaponIds(comboItem));
    if (combined?.range?.resolved) updates['system.range'] = combined.range.value;
    if (combined?.target?.resolved) updates['system.target'] = combined.target.value;
  }

  // 무기 추가 직후 호출: 콤보를 공격 콤보로 재구성. 무기 아이템에만 적용(비클 제외).
  async function applyWeaponAutoAttack(comboItem, actor, weaponId) {
    if (!comboItem || !weaponId || weaponId === '-') return false;
    const weaponItem = window.DX3rdResolveWeapon(actor, weaponId);
    if (!weaponItem || weaponItem.type !== 'weapon') return false;
    const updates = computeInheritedWeaponFields(comboItem, weaponItem, actor);
    applyWeaponRangeRecalc(updates, comboItem, actor);
    if (Object.keys(updates).length === 0) return false;
    await comboItem.update(updates);
    return true;
  }

  // 무기 삭제 직후 호출: 남은 이펙트/무기로 판정 기능/공격판정을 재계산(우선순위 재적용).
  async function applyWeaponRemoved(comboItem, actor) {
    if (!comboItem) return false;
    const updates = deriveComboAttackFields(comboItem, actor);
    applyWeaponRangeRecalc(updates, comboItem, actor);
    if (Object.keys(updates).length === 0) return false;
    await comboItem.update(updates);
    return true;
  }

  // 조합된 전체 이펙트에서 사거리/대상을 합성(가장 제한적인 값). 자신 규칙 위반은 selfConflict로 표시.
  // 룰북 p.13 「사정거리의 축소」: 사정거리가 「무기」인 이펙트는 조합된 무기의 사정거리를 대입한다.
  //   weaponIds를 넘기면 그 무기들의 사정거리로 「무기」 지시자를 치환한 뒤 최소값을 계산한다.
  function combineEffectsRangeTarget(actor, effectIds, weaponIds = null) {
    const RT = window.DX3rdRangeTarget;
    if (!RT) return null;
    const ranges = [], targets = [];
    const weaponRanges = normalizeIdList(weaponIds ?? [])
      .map(id => actor?.items.get(id)?.system?.range)
      .filter(r => r && r !== '-');
    for (const id of normalizeIdList(effectIds)) {
      const eff = actor?.items.get(id);
      if (!eff) continue;
      const range = eff.system?.range;
      if (RT.isWeaponRange?.(range)) {
        // 「무기」 지시자: 조합된 무기들의 실제 사정거리를 대신 넣는다(무기가 없으면 순위 없음으로 무시).
        for (const wr of weaponRanges) ranges.push(wr);
      } else {
        ranges.push(range);
      }
      targets.push(eff.system?.target);
    }
    return { range: RT.combineRange(ranges), target: RT.combineTarget(targets) };
  }

  // 조합된 전체 이펙트에서 난이도를 합성(룰북 p.13 「난이도의 변경」: 대결 자동승격 > 최고 숫자 > 자동성공).
  function combineEffectsDifficulty(actor, effectIds) {
    const RT = window.DX3rdRangeTarget;
    if (!RT?.combineDifficulty) return null;
    const list = normalizeIdList(effectIds)
      .map(id => actor?.items.get(id)?.system?.difficulty)
      .filter(v => v !== undefined && v !== null);
    return RT.combineDifficulty(list);
  }

  // 합성 난이도를 콤보에 반영하기 위한 업데이트를 updates에 적용(roll 정합성 보정 포함).
  //  - 숫자/대결: 판정이 필요하므로 콤보 roll이 비어 있으면 major로 활성화.
  //  - 자동성공: 판정이 불필요하므로, 다른 신호(공격판정 등)로 roll이 설정되지 않았다면 '-'로 둔다.
  // 자동 결정 불가(효과참조/미지정만)면 사용자 값을 보존한다.
  function applyCombinedDifficulty(updates, comboItem, actor, effectIds) {
    const diff = combineEffectsDifficulty(actor, effectIds);
    if (!diff?.resolved) return;
    updates['system.difficulty'] = diff.value;

    const currentRoll = updates['system.roll'] ?? comboItem?.system?.roll;
    if (diff.value === '자동성공') {
      if (isEmptyComboField(currentRoll)) updates['system.roll'] = '-';
    } else if (isEmptyComboField(currentRoll)) {
      updates['system.roll'] = 'major';
    }
  }

  // 조합 자격 검증(룰북 p.13-14). 위반 시 경고 i18n 키 목록을 반환(진행은 허용).
  //  - 기능 일치: 판정 기능(comboSkill 우선, 없으면 skill)이 서로 다르면 경고.
  //    '-'(와일드카드)와 'syndrome'(조합 전용, 상대 기능을 채택)은 비교에서 제외.
  //  - 공격 유형: 백병(melee) 이펙트와 사격(ranged) 이펙트는 서로 조합 불가.
  function validateComboCombination(actor, effectIds) {
    const warnings = [];
    const effects = normalizeIdList(effectIds).map(id => actor?.items.get(id)).filter(e => e?.type === 'effect');

    // 기능 일치
    const skillLists = effects.map(effectSkillChoices).filter(a => a.length);
    if (skillLists.length > 1 && getCompatibleSkillChoices(effects).length === 0) warnings.push('DX3rd.ComboSkillMismatch');

    // 공격 유형 충돌(백병 vs 사격) — 이펙트마다 "허용 공격 유형"을 구해 교집합이 비면 충돌.
    //   원본이 〈백병〉〈사격〉인 이펙트는 양쪽 모두 허용하므로 그 자체로는 충돌 신호가 아니다
    //   (단일 이펙트만 넣어도 경고가 뜨던 원인). 명시 attackRoll/comboSkill이 있으면 그것이 유형을 확정한다.
    let allowedAttack = null; // null = 아직 유형 제약 없음
    for (const e of effects) {
      const es = e.system || {};
      const explicit = [es.attackRoll, es.comboSkill].find(v => v === 'melee' || v === 'ranged');
      const allowed = explicit
        ? [explicit]
        : (es.skillChoices?.length ? es.skillChoices : [es.skill]).filter(v => v === 'melee' || v === 'ranged');
      if (!allowed.length) continue;
      allowedAttack = allowedAttack === null
        ? new Set(allowed)
        : new Set(allowed.filter(v => allowedAttack.has(v)));
    }
    if (allowedAttack !== null && allowedAttack.size === 0) warnings.push('DX3rd.ComboAttackTypeConflict');

    return warnings;
  }

  // 등록 이펙트 원본이 편집됐을 때, 그 이펙트를 참조하는 콤보의 저장 파생값을 다시 맞춘다.
  //
  // 콤보가 직접 입력한 timing/무기 선택은 출처를 추적하지 않으므로 여기서 덮어쓰지 않는다.
  // 반면 침식치, 기능/기본능력치/공격판정/공격력, 사정거리/대상은 기존의 추가·삭제 시점과
  // 동일한 조합 규칙으로 안전하게 재계산할 수 있다.
  function getRegisteredEffectSyncUpdates(comboItem, actor) {
    if (!comboItem || !actor) return {};

    const effectIds = getEffectIds(comboItem);
    const updates = {
      'system.encroach.value': calculateEncroachment(actor, effectIds),
      ...deriveComboAttackFields(comboItem, actor, { effectIds })
    };

    const combined = combineEffectsRangeTarget(actor, effectIds, getWeaponIds(comboItem));
    if (combined?.range?.resolved) updates['system.range'] = combined.range.value;
    if (combined?.target?.resolved) updates['system.target'] = combined.target.value;
    // 난이도: 등록 이펙트 원본이 바뀌면 조합 규칙으로 재계산.
    applyCombinedDifficulty(updates, comboItem, actor, effectIds);

    // updateItem 루프와 불필요한 문서 갱신을 피하기 위해 실제로 달라진 값만 남긴다.
    return Object.fromEntries(Object.entries(updates).filter(([path, value]) =>
      foundry.utils.getProperty(comboItem, path) !== value
    ));
  }

  async function syncRegisteredEffectData(comboItem, actor) {
    const updates = getRegisteredEffectSyncUpdates(comboItem, actor);
    if (Object.keys(updates).length === 0) return false;
    await comboItem.update(updates);
    return true;
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
    const combinedTiming = getCombinedEffectTiming(actor, newEffects);
    if (!isComboTimingCompatible(item, actor, newEffects)) {
      ui.notifications.warn(game.i18n.localize('DX3rd.ComboTimingMismatch'));
    }
    // 조합 자격 경고(기능 불일치 / 백병+사격 충돌) — 진행은 허용.
    for (const key of validateComboCombination(actor, newEffects)) {
      ui.notifications.warn(game.i18n.localize(key));
    }

    // 타이밍/고정무기(빈 값만) 상속 + 판정 기능/공격판정은 조합 우선순위로 재계산(방금 추가 이펙트 포함).
    const updates = {
      'system.effectIds': newEffects,
      'system.encroach.value': calculateEncroachment(actor, newEffects),
      ...computeInheritedComboFields(item, actor?.items.get(effectId), actor, newEffects)
    };

    // 모두 같은 타이밍이면 빈 콤보 표시값을 채운다. 불명('-')만 포함된 경우에는 사용자 입력을 기다린다.
    // 오토/상시 멤버만 있어 표시값이 그쪽으로 잡혀 있던 콤보도, 타이밍이 고정된 이펙트가
    // 들어오면 그 값으로 넘긴다 — 오토 멤버를 먼저 넣었다는 이유로 콤보 타이밍이 굳으면 안 된다.
    const storedTiming = item.system?.timing;
    const timingIsUnbound = isEmptyComboField(storedTiming) || UNBOUND_TIMINGS.has(storedTiming);
    if (timingIsUnbound && combinedTiming.value && combinedTiming.value !== storedTiming) {
      updates['system.timing'] = combinedTiming.value;
    }

    // 사거리/대상: 전체 조합 이펙트에서 재계산(작은 쪽). 「무기」 사정거리는 조합 무기로 치환.
    //   rankable 결과가 없으면(모두 효과참조 등) 사용자 값 보존.
    const effectiveWeapons = normalizeIdList(updates['system.weapon'] ?? getWeaponIds(item));
    const combined = combineEffectsRangeTarget(actor, newEffects, effectiveWeapons);
    if (combined?.range?.resolved) updates['system.range'] = combined.range.value;
    if (combined?.target?.resolved) updates['system.target'] = combined.target.value;

    // 난이도: 조합 규칙(대결 자동승격 > 최고 숫자 > 자동성공)으로 재계산.
    applyCombinedDifficulty(updates, item, actor, newEffects);

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
      'system.encroach.value': calculateEncroachment(actor, newEffects),
      // 제거 후 남은 이펙트/무기로 판정 기능/공격판정 재계산(우선순위 재적용; 예: RC 변경 이펙트 제거 시 무기 기능으로 복귀).
      ...deriveComboAttackFields(item, actor, { effectIds: newEffects })
    };
    // 제거 후 남은 이펙트로 사거리/대상 재계산(「무기」는 조합 무기로 치환, rankable 없으면 보존).
    const combined = combineEffectsRangeTarget(actor, newEffects, getWeaponIds(item));
    if (combined?.range?.resolved) updates['system.range'] = combined.range.value;
    if (combined?.target?.resolved) updates['system.target'] = combined.target.value;
    // 난이도: 남은 이펙트로 조합 규칙 재계산.
    applyCombinedDifficulty(updates, item, actor, newEffects);
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
    const freepassText = game.i18n.localize('DX3rd.Freepass');
    const currentDifficulty = item.system?.difficulty || '';

    if (checked) {
      // 판정을 켜는 것뿐인데 저작해 둔 목표치까지 지우지 않는다(item-sheet 쪽과 같은 규칙).
      const stale = !currentDifficulty || currentDifficulty === freepassText || currentDifficulty === '-';
      return {
        'system.roll': 'major',
        'system.difficulty': stale ? '' : currentDifficulty,
        'system.-=roll-check': null
      };
    }

    return {
      'system.roll': '-',
      'system.difficulty': (currentDifficulty === freepassText || currentDifficulty === '-') ? currentDifficulty : freepassText,
      'system.attackRoll': '-',
      'system.-=roll-check': null
    };
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
      const weaponItem = window.DX3rdResolveWeapon(actor, weaponId);
      if (weaponItem) {
        const weaponAdd = Number(weaponItem.system?.add) || 0;
        weaponAddBonus += weaponAdd;
      }
    }
    return weaponAddBonus;
  }

  // 콤보 시트는 실행 전 미리보기이므로 다이스를 굴리지 않는다. 선택 무기에 다이스식이
  // 있으면 고정 보정과 분리해 원문을 보여 준다(실제 굴림은 핸들러가 실행 시점에 처리).
  function getWeaponDiceFormulaTerms(actor, weaponIds, field) {
    const formula = window.DX3rdFormulaEvaluator;
    const terms = [];
    for (const weaponId of normalizeIdList(weaponIds)) {
      const weapon = window.DX3rdResolveWeapon(actor, weaponId);
      if (!weapon) continue;
      const prepared = formula.prepareRollFormula(weapon.system?.[field] ?? '0', weapon, actor);
      if (formula.hasDice(prepared)) terms.push(prepared);
    }
    return terms;
  }

  // 직접 공격 및 조합 보정 이펙트의 자체 수정치/공격력도 무기와 같은 방식으로 합산한다.
  // 다이스식은 시트에서 굴리지 않고 원문만 보존한다.
  function getDirectEffectFormulaParts(actor, effectIds, field) {
    const adapter = window.DX3rdItemEffectAdapter;
    const result = {fixed: 0, diceTerms: []};
    if (!adapter) return result;
    for (const effectId of normalizeIdList(effectIds)) {
      const effect = actor?.items.get(effectId);
      const bonus = adapter.effectAttackBonus?.(effect, actor, {includeComboModifiers: true});
      if (!bonus) continue;
      result.fixed += Number(bonus[field]) || 0;
      const formulaValue = bonus[`${field}Formula`];
      if (formulaValue) result.diceTerms.push(formulaValue);
    }
    return result;
  }

  function joinPreviewFormula(fixedValue, diceTerms) {
    const terms = [];
    if (fixedValue) terms.push(String(fixedValue));
    terms.push(...diceTerms);
    return terms.length ? terms.join(' + ') : '0';
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

  /**
   * 항목별 「발현 액션」이 이 아이템의 발동 액션에서 걸리는가(미리보기 합산용).
   * 「사용 시」로만 저작된 버킷을 공격 콤보의 미리보기에 더하면 실제 적용값보다 높게 보인다.
   *
   * @param {boolean} [asComboMember] 이 아이템이 **콤보 구성 멤버로** 발현하는가.
   *   콤보 본체를 직접 사용하는 것은 활성화를 겸하지만(handleItemUse 의 useMeansActivation),
   *   **구성 멤버의 활성화 버킷은 콤보로 절대 켜지지 않는다** — combo-handler 의
   *   memberSelfModifiersFireAt 가 발동 액션(use/attack)과 일치하는 버킷만 통과시킨다.
   *   그런데 이 필터는 활성화 행을 늘 세고 있었고, 그래서 꺼져 있는 상시(applyMode='toggle')
   *   이펙트를 조합하면 시트 미리보기만 그 보정만큼 높고 실제 굴림에는 안 들어갔다.
   *   (켜져 있으면 forEachInactiveRegisteredEffect 가 애초에 제외하므로 그때는 맞았다.)
   */
  /** 구성 멤버 자격의 합산에 넘기는 옵션(콤보 본체는 기본값 그대로 — 직접 사용은 활성화를 겸한다). */
  const COMBO_MEMBER = {asComboMember: true};

  function bucketFilter(sourceItem, channel, {asComboMember = false} = {}) {
    const adapter = window.DX3rdItemEffectAdapter;
    if (!adapter || !sourceItem) return () => true;
    const action = adapter.invocationAction(sourceItem);
    const fallback = adapter.channelAction(sourceItem, channel);
    const split = ['use', 'attack'].some(candidate => adapter.hasExplicitBucket(sourceItem, channel, candidate));
    const activationFires = !asComboMember;
    return entry => {
      const explicit = entry?.action;
      if (!explicit || !adapter.ACTIONS.has(explicit)) {
        // 미지정 = 채널 기본 버킷. 채널을 나눈 아이템에서는 그 기본 버킷의 발현 액션에서만
        // 센다(selfFrozenAttributes 의 같은 규칙). 안 맞추면 미리보기가 실제 적용값보다 높다.
        if (fallback === 'activation') return activationFires;
        return !split || fallback === action;
      }
      if (explicit === 'activation') return activationFires;
      return explicit === action;
    };
  }

  function forEachMainAttribute(attributes, callback, sourceItem = null, options = {}) {
    if (!attributes) return;
    const includes = bucketFilter(sourceItem, 'self', options);
    for (const attrData of Object.values(attributes)) {
      if (!attrData || !attrData.key || !attrData.value) continue;
      if (!includes(attrData)) continue;
      callback({
        key: attrData.key,
        label: attrData.label,
        value: attrData.value
      });
    }
  }

  function forEachEffectAttribute(attributes, callback, sourceItem = null, options = {}) {
    if (!attributes) return;
    const includes = bucketFilter(sourceItem, 'target', options);
    for (const [attrName, attrValue] of Object.entries(attributes)) {
      if (attrValue && typeof attrValue === 'object' && !includes(attrValue)) continue;
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

  function addMainAttributeBonuses(bonus, attributes, sourceItem, actor, rollContext, options = {}) {
    forEachMainAttribute(attributes, ({key, label, value}) => {
      addRollAttributeBonus(bonus, {
        key,
        label,
        value,
        sourceItem,
        actor,
        ...rollContext
      });
    }, sourceItem, options);
  }

  function addEffectAttributeBonuses(bonus, attributes, sourceItem, actor, rollContext, options = {}) {
    forEachEffectAttribute(attributes, ({key, label, value}) => {
      addRollAttributeBonus(bonus, {
        key,
        label,
        value,
        sourceItem,
        actor,
        ...rollContext
      });
    }, sourceItem, options);
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

  // 액터에서 "이미 prepareData가 지속 적용 중"인 이펙트 id 집합.
  // 이 이펙트들은 능력치/스킬/굴림 total에 이미 반영되어 있으므로, 콤보/이펙트 굴림·공격
  // 보너스 계산에서 중복 가산하면 안 된다. 판정 기준은 두 채널 모두다:
  //   · 활성화 채널 — 이펙트 자신의 active.state=true (구성 콤보의 상태와는 무관)
  //   · 동결 채널   — applyMode='onUse' 로 사용해 걸린 applied AE (active.state 는 false로 남는다)
  // active.state 만 보면 동결 채널을 놓쳐, 수명(active.disable)이 남아 있는 자기버프를
  // 같은 라운드의 콤보 굴림이 한 번 더 더한다.
  function getPersistentEffectIds(actor) {
    const ids = new Set();
    if (!actor) return ids;
    for (const it of actor.items) {
      if (it.type === 'effect' && it.system?.active?.state === true) {
        ids.add(it.id);
      }
    }
    for (const eff of (actor.effects || [])) {
      if (eff.disabled) continue;   // 꺼둔 AE 는 total 에 없다 → 콤보가 더해야 한다
      const itemId = eff.getFlag?.('dx3rd-emanim', 'applied')?.itemId;
      if (!itemId) continue;
      if (actor.items?.get(itemId)?.type === 'effect') ids.add(itemId);
    }
    return ids;
  }

  function forEachInactiveRegisteredEffect(actor, effectIds, callback) {
    const persistent = getPersistentEffectIds(actor);
    for (const effectId of normalizeIdList(effectIds)) {
      const effectItem = actor?.items.get(effectId);
      if (!effectItem || effectItem.type !== 'effect') continue;

      // 이미 prepareData가 지속 적용 중인 독립 활성 이펙트는 제외한다(2중 계산 방지).
      if (persistent.has(effectId)) continue;

      callback(effectItem);
    }
  }

  function calculateRegisteredEffectRollBonus(actor, effectIds, rollContext, criticalMin) {
    const bonus = createRollBonus(criticalMin);

    // 구성 멤버 자격으로 발현하는 보정만 센다(활성화 버킷 제외 — bucketFilter 주석 참조).
    forEachInactiveRegisteredEffect(actor, effectIds, effectItem => {
      addMainAttributeBonuses(bonus, effectItem.system?.attributes, effectItem, actor, rollContext, COMBO_MEMBER);
      addEffectAttributeBonuses(bonus, effectItem.system?.effect?.attributes, effectItem, actor, rollContext, COMBO_MEMBER);
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
      weaponAttack += Number(window.DX3rdResolveWeapon(actor, weaponId)?.system?.attack) || 0;
    }
    return weaponAttack;
  }

  function matchesAttackLabel(label, attackRoll, emptyMatches = false) {
    if (!label) return emptyMatches;
    return label === '-' || label === attackRoll;
  }

  function addMainAttackBonuses(item, actor, attackRoll, options = {}) {
    let attackBonus = 0;

    forEachMainAttribute(item.system?.attributes, ({key, label, value}) => {
      if (key !== 'attack') return;
      if (!matchesAttackLabel(label || '-', attackRoll)) return;

      const bonusValue = window.DX3rdFormulaEvaluator?.evaluate(value, item, actor) || 0;
      attackBonus += Number(bonusValue) || 0;
    }, item, options);

    return attackBonus;
  }

  function addEffectAttackBonuses(item, actor, attackRoll, options = {}) {
    let attackBonus = 0;

    forEachEffectAttribute(item.system?.effect?.attributes, ({key, label, value}) => {
      if (key !== 'attack') return;
      if (!matchesAttackLabel(label, attackRoll, true)) return;

      attackBonus += Number(evaluateAttributeValue(value, item, actor, 0)) || 0;
    }, item, options);

    return attackBonus;
  }

  function calculateItemAttackBonus(item, actor, attackRoll) {
    if (item.system?.active?.state === true) return 0;
    return addMainAttackBonuses(item, actor, attackRoll) + addEffectAttackBonuses(item, actor, attackRoll);
  }

  function calculateRegisteredEffectAttackBonus(actor, effectIds, attackRoll) {
    let attackBonus = 0;

    forEachInactiveRegisteredEffect(actor, effectIds, effectItem => {
      attackBonus += addMainAttackBonuses(effectItem, actor, attackRoll, COMBO_MEMBER);
      attackBonus += addEffectAttackBonuses(effectItem, actor, attackRoll, COMBO_MEMBER);
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
      const directEffects = getDirectEffectFormulaParts(actor, data.system.effectIds, 'attack');
      const totalAttack = calculateActorAttack(actor, currentAttackRoll)
        + calculateWeaponAttack(actor, registeredWeapons)
        + directEffects.fixed
        + calculateItemAttackBonus(item, actor, currentAttackRoll)
        + calculateRegisteredEffectAttackBonus(actor, data.system.effectIds, currentAttackRoll);
      
      data.system.attack = { value: joinPreviewFormula(totalAttack, [
        ...getWeaponDiceFormulaTerms(actor, registeredWeapons, 'attack'),
        ...directEffects.diceTerms
      ]) };
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
    const isAttackCombo = !!currentAttackRoll && currentAttackRoll !== '-';
    // 구성 이펙트의 자체 수정치는 **공격 콤보가 아니어도** 실린다 — combo-handler 의
    // calculateEffectAttackBonus 가 attackRoll 을 보지 않고 계산해 판정 다이얼로그의
    // effectiveStat.add 로 들어간다(팩 실측 13건이 전부 attackRoll 없는 조합 전용 수치다:
    // 템테이션·완전복제·머신모핑·스킬 포커스·애큐러시 …). 이 합산만 공격 콤보로 막혀 있어서
    // 교섭·지각·리액션 콤보의 시트 수정치가 늘 실제 굴림보다 낮았다. 같은 함수 아래에서
    // 다이스분(directEffectAdd.diceTerms)은 조건 밖에서 늘 표시되고 있었으므로 자기모순이었다.
    //
    // 무기 수정치는 반대로 공격 콤보 전용이 맞다 — 런타임의 calculateRegisteredWeaponBonus 는
    // `!weaponSelect && attackRoll !== '-'` 에서만 불린다. 고정분과 다이스분을 같은 게이트에 둔다.
    const directEffectAdd = getDirectEffectFormulaParts(actor, data.system.effectIds, 'add');
    add += directEffectAdd.fixed;
    if (isAttackCombo) add += calculateWeaponAddBonus(actor, getWeaponIds(item, data));

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
    data.system.add = { value: joinPreviewFormula(add, [
      ...(isAttackCombo ? getWeaponDiceFormulaTerms(actor, getWeaponIds(item, data), 'add') : []),
      ...directEffectAdd.diceTerms
    ]) };
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
    const effects = getEffectIds(item).map(id => actor?.items.get(id)).filter(Boolean);
    // 충돌 조합(백병+사격 등)에서도 후보를 남겨 기능 드롭다운이 비지 않게 한다(경고만 하고 진행).
    data.comboSkillChoices = getComboSkillCandidates(effects);
    if (data.comboSkillChoices.length) data.system.skillOptions = data.system.skillOptions.filter(o => o.value === '-' || data.comboSkillChoices.includes(o.value));

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
    getEffectDisplayLevel,
    buildAutomaticDescription,
    getCombinedEffectTiming,
    getCompatibleSkillChoices,
    combineEffectsRangeTarget,
    isComboTimingCompatible,
    getPersistentEffectIds,
    // 구성 이펙트가 콤보 판정 미리보기에 더하는 보정. 런타임(combo-handler 의
    // memberSelfModifiersFireAt)과 어긋나면 시트 숫자가 실제 굴림과 달라지므로 노출해 검증한다.
    calculateRegisteredEffectRollBonus,
    // 콤보 판정 미리보기(다이스/수정치/크리티컬). 런타임 판정 다이얼로그와 어긋나면
    // 시트 숫자가 실제 굴림과 달라지므로 노출해 검증한다.
    prepareRollSummary,
    calculateEncroachment,
    calculateSubmittedAttack,
    prepareSubmittedCombatValues,
    addRegisteredEffect,
    computeInheritedComboFields,
    computeInheritedWeaponFields,
    deriveComboAttackFields,
    getRegisteredEffectSyncUpdates,
    syncRegisteredEffectData,
    applyWeaponAutoAttack,
    applyWeaponRemoved,
    openRegisteredEffectSheet,
    removeRegisteredEffect,
    updateBaseAttributeForSkill,
    getDifficultyToggleUpdate,
    isLimitValueValid
  };
})();
