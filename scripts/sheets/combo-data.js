/** Shared template-context preparation for the legacy and AppV2 combo sheets. */
(function() {
  const itemSheetData = window.DX3rdItemSheetData;
  const abilityKeys = ['body', 'sense', 'mind', 'social'];

  function normalizeIdList(value, fallback = []) {
    const source = value ?? fallback ?? [];
    return (Array.isArray(source) ? source : [source]).filter(id => typeof id === 'string' && id && id !== '-');
  }

  // The combo member effect ids. **The canonical reading of the stored format is the single normalizeEffectIds
  // in universal-extensions**; this only adds a shell that also accepts the sheet context plain object (data).
  // Rewriting the parsing here would leave the sheet and the runtime looking at different lists (the old local
  // implementation did not know the system.effect.data shape). The schema always fills effectIds, so data is unreachable.
  function getEffectIds(item, data = null) {
    const handler = window.DX3rdUniversalHandler;
    const normalize = target => (handler?.normalizeEffectIds
      ? handler.normalizeEffectIds(target)
      : normalizeIdList(target?.system?.effectIds));
    const fromItem = normalize(item);
    if (fromItem.length || item?.system?.effectIds != null) return fromItem;
    return normalize(data);
  }

  function getWeaponIds(item, data = null) {
    return normalizeIdList(item.system?.weapon ?? data?.system?.weapon);
  }

  // The runtime's member predicate, with the former effect-only rule as the fallback. The handler module
  // loads before this file, so the fallback is only a defensive guard for an unusual load order.
  function isComboMember(item) {
    return window.DX3rdUniversalHandler?.isComboMemberItem?.(item) ?? item?.type === 'effect';
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

  /** The current combination summary shown on a combo chat card whose description is empty. */
  function buildAutomaticDescription(item, actor) {
    const parts = [];
    const levelLabel = game.i18n.localize('DX3rd.LevelAbbreviation');

    for (const effectId of getEffectIds(item)) {
      const member = actor?.items.get(effectId);
      if (!isComboMember(member)) continue;
      // A member of another type has no LV readout — list its name alone.
      if (member.type !== 'effect') {
        const memberName = String(member.name || '').trim();
        if (memberName) parts.push(escapeHtml(memberName));
        continue;
      }
      const name = getAutomaticEffectName(member);
      if (!name) continue;
      parts.push(`${escapeHtml(name)} ${levelLabel}${getEffectDisplayLevel(member, actor)}`);
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

  // Decide whether a combo field counts as "empty" (unset / default)
  function isEmptyComboField(value) {
    return value === undefined || value === null || value === '' || value === '-';
  }

  // Rulebook p.147: every combined effect must agree in timing and skill.
  // '-' means the data has not been filled in yet, so it alone never blocks a combination.
  //
  // An effect whose timing is "not fixed" is exempt from this agreement check.
  //   auto: declarable at any moment with no timing constraint, so it rides on a combination of any timing.
  //   always: it has no trigger timing at all.
  // A combo's timing is decided by the members with a fixed timing, not by these.
  const UNBOUND_TIMINGS = new Set(['auto', 'always']);
  // Which timings an effect that serves several can actually be treated as.
  // Itself must come first, so that combining that effect alone leaves the displayed timing at its original value.
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

    // A dual-purpose timing narrows to the intersection of the candidate sets (a major/reaction effect belongs to both combinations).
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
    // When the combo's own timing is empty or not a fixed value, the members decide the timing.
    if (isEmptyComboField(comboTiming) || UNBOUND_TIMINGS.has(comboTiming)) return true;
    // When the members are only auto/always (= no fixed-timing member), no constraint is placed on the combo's timing.
    if (!combined.value || UNBOUND_TIMINGS.has(combined.value)) return true;
    return timingCandidates(comboTiming).includes(combined.value)
      || timingCandidates(combined.value).includes(comboTiming);
  }

  // Sentinel skill values that are not a check "skill" (excluded as a source for the combo's check skill).
  //   syndrome: Concentrate / Reflex and the like — a pure modifier combined only into a check that used an effect (resolved through a separate attribute).
  //   text/cthulhu: no data at present (ignored).
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

  // A combination-eligibility violation is "warn and proceed" by principle (validateComboCombination never blocks).
  // So the candidates must not be left empty even when conflicting skills make the intersection empty — emptying them
  // would leave the combo's check skill, attack check and attack value all uncomputed, making it effectively unusable,
  // contrary to the warn-only principle. With no intersection, the union is offered so the user can choose.
  function getComboSkillCandidates(effects) {
    const compatible = getCompatibleSkillChoices(effects);
    if (compatible.length) return compatible;
    const union = [];
    for (const list of effects.map(effectSkillChoices)) {
      for (const skill of list) if (!union.includes(skill)) union.push(skill);
    }
    return union;
  }

  // Recompute the combo's check skill (skill/base), attack check (attackRoll) and attack value by "combination priority".
  //
  // Priority (always recomputed): an effect's explicit skill > a weapon's explicit skill > inference from the weapon type (ranged→Ranged, melee→Melee).
  //   Basis: the rule "the effect takes precedence" (rulebook-1-2 3251) — when equipment (a weapon) contradicts an effect, the effect wins.
  //   A skill change (making a weapon's accuracy check <RC> / Ranged) lives in the effect's flavor text and cannot be decided mechanically,
  //   so the only mechanical signal, the effect's `system.skill`, is used as the priority signal.
  //
  // A user's manual value is never locked permanently — adding or removing an effect / weapon overwrites it by this priority again.
  //   (The user has priority at the moment of their "last edit": that edit holds until the next add or remove.)
  // With no candidate at all (no effect / weapon skill signal), the existing value is preserved (protecting a purely manual combo).
  //
  // Passing effectIds/weaponIds computes from that prospective list (for calls before an add / remove is saved).
  function deriveComboAttackFields(comboItem, actor, { effectIds, weaponIds } = {}) {
    const updates = {};
    const cs = comboItem?.system || {};
    const effIds = normalizeIdList(effectIds ?? getEffectIds(comboItem));
    const wpnIds = normalizeIdList(weaponIds ?? getWeaponIds(comboItem));

    const effects = effIds.map(id => actor?.items.get(id)).filter(Boolean);
    const weapons = wpnIds
      .map(id => window.DX3rdResolveWeapon?.(actor, id) || actor?.items.get(id))
      .filter(item => item && ['weapon', 'vehicle'].includes(item.type));

    // --- The check skill (skill/base) ---
    // Basis: the rule "accuracy check" (rulebook-1-2 p.145) — an accuracy check uses "the skill specified on the weapon and the effect",
    //   and by "the effect takes precedence" (p.147) the effect's specified skill beats the weapon's.
    //   An effect's "specified skill" is normally its skill field (system.skill), but a special effect that redefines it in its
    //   body text (flavor) — "change the accuracy check to <RC> / Ranged / Mind" — cannot be decided mechanically, so the
    //   dedicated field system.comboSkill (skill change when combined) is the priority signal and the skill field is the fallback.
    let skill = null;
    const compatibleSkills = getComboSkillCandidates(effects);
    // B: the effect's specified skill — the combine-time skill change (comboSkill) first, falling back to the effect's skill field.
    //   But skill='syndrome' (Concentrate / Reflex and the like) is not a check skill; it is a sentinel for "a pure modifier
    //   combined only into a check that used an effect", so it is excluded as a source for the combo's check skill (resolved through a separate attribute).
    //   Also, an effect whose original allows several skills such as <Melee><Ranged> (two or more skillChoices) has not "specified"
    //   a single skill, so the effect-precedence rule does not apply. In that case, when the combined weapon's skill / type is among the
    //   choices it settles it (preventing a combo built with a pistol from becoming a melee check).
    if (compatibleSkills.length === 1) {
      skill = compatibleSkills[0];
    } else if (compatibleSkills.length > 1) {
      const weaponSignal = [...weapons.map(w => w.system?.skill), ...weapons.map(w => w.system?.type)]
        .find(sig => !isEmptyComboField(sig) && compatibleSkills.includes(sig));
      skill = weaponSignal || (compatibleSkills.includes(cs.skill) ? cs.skill : compatibleSkills[0]);
    }
    // C: the weapon's explicit skill
    if (!skill) {
      const wpnSkill = weapons.find(w => !isEmptyComboField(w.system?.skill));
      if (wpnSkill) skill = wpnSkill.system.skill;
    }
    // D: inference from the weapon type
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

    // --- Attribute (base) substitution: the combine-time attribute change (comboBase) — keep the skill, swap only the check attribute ---
    //   Basis: rules p.136, a check = attribute (dice count) + skill (result level). "Make the combined check <Mind>" and the like
    //   keep the skill's (Melee's, say) level and change only the check attribute, so base is overwritten rather than skill.
    //   (e.g. Control Sword = keeps the Melee skill + the Mind attribute.) Applied first, regardless of whether the skill changed.
    const effComboBase = effects.find(e => abilityKeys.includes(e.system?.comboBase));
    if (effComboBase) {
      const cb = effComboBase.system.comboBase;
      if (cb !== (updates['system.base'] ?? cs.base)) updates['system.base'] = cb;
    }

    // --- The attack check (attackRoll): an effect's explicit attackRoll > the effect's skill > the weapon's type / skill ---
    // Some existing items have only skill (or comboSkill) filled with melee / ranged instead of attackRoll.
    // The attack type can be determined from those too, so they are used as a fallback.
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
    // Vehicles use their selected driving skill for the check, but the attack itself follows the
    // same melee path as direct vehicle attacks in UniversalHandler.
    if (!attackRoll && weapons.some(w => w.type === 'vehicle')) attackRoll = 'melee';
    if (attackRoll && attackRoll !== cs.attackRoll) {
      updates['system.attackRoll'] = attackRoll;
      // With a newly created attack check and an empty roll, enable the accuracy check (major)
      if (isEmptyComboField(cs.roll)) updates['system.roll'] = 'major';
    }

    // --- Recompute the attack value ---
    const finalAttackRoll = updates['system.attackRoll'] ?? cs.attackRoll;
    if (finalAttackRoll && finalAttackRoll !== '-') {
      updates['system.attack.value'] = calculateSubmittedAttack(actor, finalAttackRoll, wpnIds, effIds);
    }

    return updates;
  }

  // When adding an effect to a combo: inherit the description tab's defaults (timing / check type / difficulty) and the
  // fixed weapon only when empty, and recompute the check skill / attack check by combination priority.
  // prospectiveEffectIds: the prospective effect list not yet saved (including the effect just added).
  function computeInheritedComboFields(comboItem, effectItem, actor, prospectiveEffectIds = null) {
    const updates = {};
    const es = effectItem?.system || {};
    const cs = comboItem?.system || {};

    // Timing (inherited only when empty). Range and target are fully recomputed by combineEffectsRangeTarget.
    if (isEmptyComboField(cs.timing) && !isEmptyComboField(es.timing)) updates['system.timing'] = es.timing;

    // Weapon: inherited when the effect fixes a weapon (weaponSelect: false) and the combo's weapon slot is empty
    const currentWeapons = getWeaponIds(comboItem);
    let effectiveWeapons = currentWeapons;
    if (currentWeapons.length === 0 && es.weaponSelect === false && Array.isArray(es.weapon)) {
      const inheritedWeapons = es.weapon.filter(w => w && w !== '-');
      if (inheritedWeapons.length > 0) {
        updates['system.weapon'] = inheritedWeapons;
        effectiveWeapons = inheritedWeapons;
      }
    }

    // Check skill / attack check / attack value: recomputed by combination priority (including the effect / fixed weapon just added).
    Object.assign(updates, deriveComboAttackFields(comboItem, actor, {
      effectIds: prospectiveEffectIds ?? getEffectIds(comboItem),
      weaponIds: effectiveWeapons
    }));

    // An effect with no attack check can still require a check of its own. Previously roll='major' was filled in only when
    // attackRoll was present, so adding an ordinary check effect left the description tab at '-'.
    // The combo check / difficulty the user already chose is preserved; the effect's value is inherited only at the default.
    if (isEmptyComboField(cs.roll) && !isEmptyComboField(es.roll)) {
      updates['system.roll'] = es.roll;
    }
    if (isEmptyComboField(cs.difficulty) && !isEmptyComboField(es.difficulty)) {
      updates['system.difficulty'] = es.difficulty;
    }

    return updates;
  }

  // When adding a weapon to a combo: recompute the check skill / attack check / attack value by combination priority (attack combo automation).
  // (The weapon has already been added to the slot when this is called.)
  function computeInheritedWeaponFields(comboItem, weaponItem, actor) {
    return deriveComboAttackFields(comboItem, actor);
  }

  // A change of combined weapon changes the range of any effect that uses the "weapon" range, so range/target are recomputed into updates too.
  function applyWeaponRangeRecalc(updates, comboItem, actor) {
    const combined = combineEffectsRangeTarget(actor, getEffectIds(comboItem), getWeaponIds(comboItem));
    if (combined?.range?.resolved) updates['system.range'] = combined.range.value;
    if (combined?.target?.resolved) updates['system.target'] = combined.target.value;
  }

  // Called right after a weapon / vehicle is added: rebuild the combo as an attack combo.
  async function applyWeaponAutoAttack(comboItem, actor, weaponId) {
    if (!comboItem || !weaponId || weaponId === '-') return false;
    const weaponItem = window.DX3rdResolveWeapon(actor, weaponId);
    if (!weaponItem || !['weapon', 'vehicle'].includes(weaponItem.type)) return false;
    const updates = computeInheritedWeaponFields(comboItem, weaponItem, actor);
    applyWeaponRangeRecalc(updates, comboItem, actor);
    if (Object.keys(updates).length === 0) return false;
    await comboItem.update(updates);
    return true;
  }

  // Called right after a weapon is removed: recompute the check skill / attack check from the remaining effects / weapons (reapplying the priority).
  async function applyWeaponRemoved(comboItem, actor, removedWeaponId = null) {
    if (!comboItem) return false;
    const updates = deriveComboAttackFields(comboItem, actor);
    applyWeaponRangeRecalc(updates, comboItem, actor);
    const removedWeapon = removedWeaponId
      ? (window.DX3rdResolveWeapon?.(actor, removedWeaponId) || actor?.items.get(removedWeaponId))
      : null;
    if (removedWeapon && !Object.hasOwn(updates, 'system.attackRoll')) {
      const removedAttackRoll = removedWeapon.type === 'vehicle'
        ? 'melee'
        : [removedWeapon.system?.type, removedWeapon.system?.skill]
          .find(value => value === 'melee' || value === 'ranged');
      if (removedAttackRoll && comboItem.system?.attackRoll === removedAttackRoll) {
        updates['system.attackRoll'] = '-';
        updates['system.attack.value'] = '-';
      }
    }
    if (removedWeapon && !Object.hasOwn(updates, 'system.skill')) {
      const removedSkill = removedWeapon.system?.skill || removedWeapon.system?.type;
      if (removedSkill && comboItem.system?.skill === removedSkill) {
        updates['system.skill'] = '-';
        updates['system.base'] = '-';
      }
    }
    applyEmptyComboReset(updates, comboItem, getEffectIds(comboItem), getWeaponIds(comboItem));
    if (Object.keys(updates).length === 0) return false;
    await comboItem.update(updates);
    return true;
  }

  // Once every registered source is gone, values inherited from those sources must not survive as
  // an apparently usable combo. This reset is deliberately limited to an empty combo: while any
  // member remains, deriveComboAttackFields and the range/target combiners preserve authored values.
  function applyEmptyComboReset(updates, comboItem, effectIds, weaponIds) {
    if (normalizeIdList(effectIds).length || normalizeIdList(weaponIds).length) return;
    const defaults = {
      'system.skill': '-',
      'system.base': '-',
      'system.roll': '-',
      'system.difficulty': '',
      'system.timing': '-',
      'system.range': '',
      'system.target': '-',
      'system.attackRoll': '-',
      'system.attack.value': '-'
    };
    for (const [path, value] of Object.entries(defaults)) {
      if (foundry.utils.getProperty(comboItem, path) !== value) updates[path] = value;
    }
  }

  // Combine the range / target across every combined effect (the most restrictive value). A self-rule violation is flagged as selfConflict.
  // Rulebook p.13 "reducing the range": an effect whose range is "weapon" takes the range of the combined weapon.
  //   When weaponIds is passed, the "weapon" marker is substituted with those weapons' ranges before the minimum is computed.
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
        // The "weapon" marker: the combined weapons' actual ranges go in instead (with no weapon it is ignored as unranked).
        for (const wr of weaponRanges) ranges.push(wr);
      } else {
        ranges.push(range);
      }
      targets.push(eff.system?.target);
    }
    return { range: RT.combineRange(ranges), target: RT.combineTarget(targets) };
  }

  // Combine the difficulty across every combined effect (rulebook p.13 "changing the difficulty": contest auto-promotion > highest number > automatic success).
  function combineEffectsDifficulty(actor, effectIds) {
    const RT = window.DX3rdRangeTarget;
    if (!RT?.combineDifficulty) return null;
    const list = normalizeIdList(effectIds)
      .map(id => actor?.items.get(id)?.system?.difficulty)
      .filter(v => v !== undefined && v !== null);
    return RT.combineDifficulty(list);
  }

  // Apply the combined difficulty to the combo through updates (roll consistency corrections included).
  //  - number / contest: a check is needed, so an empty combo roll is enabled as major.
  //  - automatic success: no check is needed, so roll is left at '-' unless another signal (an attack check) set it.
  // When it cannot be decided automatically (only effect-reference / unspecified), the user's value is preserved.
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

  // Validate combination eligibility (rulebook p.13-14). On a violation the warning i18n keys are returned (proceeding is allowed).
  //  - Skill agreement: warn when the check skills (comboSkill first, otherwise skill) differ.
  //    '-' (a wildcard) and 'syndrome' (combine-only, adopting the other skill) are excluded from the comparison.
  //  - Attack type: a melee effect and a ranged effect cannot be combined.
  function validateComboCombination(actor, effectIds) {
    const warnings = [];
    const effects = normalizeIdList(effectIds).map(id => actor?.items.get(id)).filter(e => e?.type === 'effect');

    // Skill agreement
    const skillLists = effects.map(effectSkillChoices).filter(a => a.length);
    if (skillLists.length > 1 && getCompatibleSkillChoices(effects).length === 0) warnings.push('DX3rd.ComboSkillMismatch');

    // Attack type conflict (melee vs ranged) — the "allowed attack types" are derived per effect and an empty intersection is a conflict.
    //   An effect whose original is <Melee><Ranged> allows both, so it is not a conflict signal by itself
    //   (the cause of a warning appearing with a single effect added). An explicit attackRoll / comboSkill settles the type.
    let allowedAttack = null; // null = no type constraint yet
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

  // When a registered effect's original is edited, re-align the stored derived values of the combos referencing it.
  //
  // A timing or weapon choice the combo entered directly does not track its source, so it is not overwritten here.
  // Encroachment, skill / base attribute / attack check / attack value, and range / target, on the other hand, can be
  // safely recomputed by the same combination rules as at add / remove time.
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
    // Difficulty: recomputed by the combination rules when a registered effect's original changes.
    applyCombinedDifficulty(updates, comboItem, actor, effectIds);

    // Keep only what actually differs, to avoid an updateItem loop and pointless document updates.
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
    // Combination eligibility warnings (skill mismatch / melee+ranged conflict) — proceeding is allowed.
    for (const key of validateComboCombination(actor, newEffects)) {
      ui.notifications.warn(game.i18n.localize(key));
    }

    // Inherit timing / fixed weapon (empty values only) + recompute the check skill / attack check by combination priority (including the effect just added).
    const updates = {
      'system.effectIds': newEffects,
      'system.encroach.value': calculateEncroachment(actor, newEffects),
      ...computeInheritedComboFields(item, actor?.items.get(effectId), actor, newEffects)
    };

    // When they all share one timing, fill in the combo's empty display value. With only unknown ('-') present, wait for the user's input.
    // A combo whose display value was set by auto/always members alone also hands over to a fixed-timing effect once one
    // is added — the combo's timing must not be frozen just because an auto member went in first.
    const storedTiming = item.system?.timing;
    const timingIsUnbound = isEmptyComboField(storedTiming) || UNBOUND_TIMINGS.has(storedTiming);
    if (timingIsUnbound && combinedTiming.value && combinedTiming.value !== storedTiming) {
      updates['system.timing'] = combinedTiming.value;
    }

    // Range / target: recomputed across every combined effect (the smaller one). A "weapon" range is substituted with the combined weapon's.
    //   With no rankable result (all effect-reference and the like), the user's value is preserved.
    const effectiveWeapons = normalizeIdList(updates['system.weapon'] ?? getWeaponIds(item));
    const combined = combineEffectsRangeTarget(actor, newEffects, effectiveWeapons);
    if (combined?.range?.resolved) updates['system.range'] = combined.range.value;
    if (combined?.target?.resolved) updates['system.target'] = combined.target.value;

    // Difficulty: recomputed by the combination rules (contest auto-promotion > highest number > automatic success).
    applyCombinedDifficulty(updates, item, actor, newEffects);

    await item.update(updates);

    // Warn when a self-target effect is mixed with non-self ones (proceeding is allowed).
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

    const removedEffect = actor?.items.get(effectId);
    const newEffects = getEffectIds(item).filter(id => id !== effectId);
    const weaponIds = getWeaponIds(item);
    const updates = {
      'system.effectIds': newEffects,
      'system.encroach.value': calculateEncroachment(actor, newEffects),
      // Recompute the check skill / attack check from the effects / weapons left after the removal (reapplying the priority; e.g. reverting to the weapon's skill when an RC-changing effect is removed).
      ...deriveComboAttackFields(item, actor, { effectIds: newEffects })
    };
    const combinedTiming = getCombinedEffectTiming(actor, newEffects);
    if (combinedTiming.value) updates['system.timing'] = combinedTiming.value;
    // Recompute the range / target from the remaining effects ("weapon" substituted with the combined weapon; preserved when nothing is rankable).
    const combined = combineEffectsRangeTarget(actor, newEffects, weaponIds);
    if (combined?.range?.resolved) updates['system.range'] = combined.range.value;
    if (combined?.target?.resolved) updates['system.target'] = combined.target.value;
    // Difficulty: recomputed by the combination rules from the remaining effects.
    applyCombinedDifficulty(updates, item, actor, newEffects);

    // If the removed effect was the last source for a descriptive field, discard only a value that
    // still equals that source. A manually authored value which differs from the removed effect is
    // preserved. With equipment still registered, its attack remains a major-action combo.
    const removedSystem = removedEffect?.system || {};
    const fallbackTiming = weaponIds.length ? 'major' : '-';
    const fallbackRoll = weaponIds.length ? 'major' : '-';
    const resetIfRemovedValue = (path, removedValue, fallback, replacementResolved = false) => {
      if (replacementResolved || isEmptyComboField(removedValue)) return;
      if (foundry.utils.getProperty(item, path) === removedValue) updates[path] = fallback;
    };
    resetIfRemovedValue('system.timing', removedSystem.timing, fallbackTiming, Boolean(combinedTiming.value));
    resetIfRemovedValue('system.range', removedSystem.range, '', Boolean(combined?.range?.resolved));
    resetIfRemovedValue('system.target', removedSystem.target, '-', Boolean(combined?.target?.resolved));
    resetIfRemovedValue('system.difficulty', removedSystem.difficulty, '', Object.hasOwn(updates, 'system.difficulty'));
    resetIfRemovedValue('system.roll', removedSystem.roll, fallbackRoll, Object.hasOwn(updates, 'system.roll'));

    applyEmptyComboReset(updates, item, newEffects, weaponIds);
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
      // Merely enabling the check must not erase an authored target value (the same rule as on the item-sheet side).
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

  // The combo sheet is a pre-execution preview, so it never rolls dice. When a chosen weapon has a dice formula,
  // it is shown as its source text, separate from the fixed modifiers (the actual roll is done by the handler at execution time).
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

  // A direct attack's / combined modifier effect's own modifiers and attack value are summed the same way as a weapon's.
  // A dice formula is not rolled on the sheet; only its source text is preserved.
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
   * Does a row's "trigger action" apply at this item's trigger action (for the preview sum)?
   * Adding a bucket authored as "on use" only into an attack combo's preview would show a value higher than what actually applies.
   *
   * @param {boolean} [asComboMember] Is this item firing **as a combo member**?
   *   Using a combo itself directly doubles as an activation (handleItemUse's useMeansActivation), but
   *   **a member's activation bucket is NEVER lit by a combo** — combo-handler's memberSelfModifiersFireAt
   *   lets through only the buckets matching the trigger action (use/attack).
   *   That filter, however, always counted the activation rows, so combining an always-on (applyMode='toggle')
   *   effect that was switched off made only the sheet preview higher by that modifier while the actual roll
   *   never included it. (When it was on, forEachInactiveRegisteredEffect excluded it anyway, so that case was right.)
   */
  /** The options passed to the member-eligibility sum (the combo itself keeps the defaults — direct use doubles as an activation). */
  const comboMemberOptions = parentAction => ({asComboMember: true, parentAction});

  function bucketFilter(sourceItem, channel, {asComboMember = false, parentAction = null} = {}) {
    const adapter = window.DX3rdItemEffectAdapter;
    if (!adapter || !sourceItem) return () => true;
    const action = asComboMember
      ? (adapter.comboMemberAction?.(sourceItem, parentAction) || adapter.invocationAction(sourceItem))
      : adapter.invocationAction(sourceItem);
    const activationFires = !asComboMember;
    const firingRows = new Set(adapter.modifierExecutionBuckets(sourceItem, channel, action, 'instant')
      .flatMap(bucket => Object.values(bucket.attributes)));
    return entry => {
      if (adapter.attributeAction(sourceItem, channel, entry) !== 'activation') return firingRows.has(entry);
      return activationFires && adapter.bucketLifecycle(sourceItem, channel, 'activation').disable !== 'notCheck';
    };
  }

  function forEachMainAttribute(attributes, callback, sourceItem = null, options = {}) {
    if (!attributes) return;
    const includes = bucketFilter(sourceItem, 'self', options);
    for (const attrData of Object.values(attributes)) {
      if (!attrData || !attrData.key || !attrData.value) continue;
      if (!includes(attrData)) continue;
      // A row carrying `condition` contributes only while it holds on the actor — the applied
      // AE gates it dynamically, so summing it unconditionally inflates the preview above
      // what the actual roll receives (the same class of mismatch bucketFilter exists for).
      if (attrData.condition && options.actor
          && !window.DX3rdRuntimeUtils?.modifierConditionHolds?.(options.actor, attrData.condition)) continue;
      callback({
        key: attrData.key,
        label: attrData.label,
        value: attrData.value
      });
    }
  }

  // The target channel (system.effect.attributes) is **never counted in the caster's preview.** applyToTargets applies
  // that channel only to game.user.targets / scene tokens / forcedTargets and never includes the caster
  // (universal-apply.js), and for the attack value the runtime reads only the top-level system.attack/add
  // (effectAttackBonus in item-effect-adapter). This channel used to be summed into the caster's own dice/add/critical/
  // attack, so combining "target dice -[level]*2" (Gravity Area) made only my combo preview lower by that much, while
  // a buff for someone else such as "target attack +[level]*4" (Legion of Ice and Fire) inflated my own attack value
  // (measured across the packs: 157 documents carry this key; documents with both getTarget and scene off — a "dead
  // channel" — number 0, so every one of them is genuine target authoring). Do not bring it back.

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
    }, sourceItem, {...options, actor});
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
    return bonus;
  }

  // The set of effect ids the actor's prepareData is "already applying persistently".
  // These effects are already folded into the attribute / skill / roll totals, so they must not be counted again in a
  // combo / effect roll or attack bonus calculation. The test covers both channels:
  //   · the activation channel — the effect's own active.state=true (unrelated to the containing combo's state)
  //   · the frozen channel   — an applied AE attached by use with applyMode='onUse' (active.state stays false)
  // Looking only at active.state misses the frozen channel, so a combo roll in the same round adds a self buff whose
  // lifetime (active.disable) is still running one more time.
  function getPersistentEffectIds(actor) {
    const ids = new Set();
    if (!actor) return ids;
    for (const it of actor.items) {
      if (isComboMember(it) && it.system?.active?.state === true) {
        ids.add(it.id);
      }
    }
    for (const eff of (actor.effects || [])) {
      if (eff.disabled) continue;   // a disabled AE is not in the total → the combo has to add it
      const itemId = eff.getFlag?.('dx3rd-emanim', 'applied')?.itemId;
      if (!itemId) continue;
      // An applied AE can come from any member type (a 'once' item's on-use channel too), not only effects.
      if (isComboMember(actor.items?.get(itemId))) ids.add(itemId);
    }
    return ids;
  }

  function forEachInactiveRegisteredEffect(actor, effectIds, callback) {
    const persistent = getPersistentEffectIds(actor);
    for (const effectId of normalizeIdList(effectIds)) {
      const effectItem = actor?.items.get(effectId);
      // Members of other types fire their use bucket at runtime, so the preview must read them too.
      if (!isComboMember(effectItem)) continue;

      // An independently active effect prepareData is already applying persistently is excluded (preventing double counting).
      if (persistent.has(effectId)) continue;

      callback(effectItem);
    }
  }

  function calculateRegisteredEffectRollBonus(actor, effectIds, rollContext, criticalMin, parentAction = null) {
    const bonus = createRollBonus(criticalMin);

    // Count only the modifiers that fire in the member's own right (the activation bucket is excluded — see the bucketFilter comment).
    forEachInactiveRegisteredEffect(actor, effectIds, effectItem => {
      addMainAttributeBonuses(
        bonus, effectItem.system?.attributes, effectItem, actor, rollContext, comboMemberOptions(parentAction)
      );
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

    // The member slot is not effect-only — every item with a 'use' action may be combined, and the
    // runtime (isComboMemberItem) already executes them. isComboMemberOption names the offerable set;
    // with the handler absent the former effect-only list is the safer fallback than offering nothing.
    const isMemberOption = window.DX3rdUniversalHandler?.isComboMemberOption;
    const memberItems = actor.items
      .filter(item => (isMemberOption ? isMemberOption(item) : item.type === 'effect'))
      .sort((a, b) => (a.sort || 0) - (b.sort || 0));
    memberItems.forEach(item => {
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
    }, item, {...options, actor});

    return attackBonus;
  }

  // The target channel's attack rows are likewise not counted — see the comment above addRollAttributeBonus.
  function calculateItemAttackBonus(item, actor, attackRoll) {
    if (item.system?.active?.state === true) return 0;
    return addMainAttackBonuses(item, actor, attackRoll);
  }

  function calculateRegisteredEffectAttackBonus(actor, effectIds, attackRoll) {
    let attackBonus = 0;

    forEachInactiveRegisteredEffect(actor, effectIds, effectItem => {
      attackBonus += addMainAttackBonuses(effectItem, actor, attackRoll, comboMemberOptions('attack'));
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
      // When system.attackRoll is '-' or unset
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
    // A member effect's own modifiers ride along **even when this is not an attack combo** — combo-handler's
    // calculateEffectAttackBonus computes without looking at attackRoll and lands in the roll dialog's
    // effectiveStat.add (measured across the packs: all 13 documents are combine-only values with no attackRoll:
    // Temptation, Perfect Copy, Machine Morphing, Skill Focus, Accuracy, …). Only this sum was gated behind an attack
    // combo, so the sheet modifier of a negotiation / perception / reaction combo was always lower than the real roll.
    // It was self-contradictory too, since the dice share (directEffectAdd.diceTerms) below was always shown outside the condition.
    //
    // A weapon modifier, conversely, IS attack-combo-only — the runtime's calculateRegisteredWeaponBonus is called only
    // under `!weaponSelect && attackRoll !== '-'`. The fixed share and the dice share go behind the same gate.
    const directEffectAdd = getDirectEffectFormulaParts(actor, data.system.effectIds, 'add');
    add += directEffectAdd.fixed;
    if (isAttackCombo) add += calculateWeaponAddBonus(actor, getWeaponIds(item, data));

    if (rollType && rollType !== '-') {
      const isAbility = abilityKeys.includes(skillKey);
      const effectiveBaseKey = getEffectiveBaseKey(baseKey, isAbility, skillKey, skillData);
      const rollContext = {rollType, isAbility, skillKey, effectiveBaseKey};

      // Add the combo item's own attributes bonus (only when it is not activated)
      // stat_bonus and skill_bonus are excluded (they affect the attribute / skill totals, so they are separate from the dice/add calculation)
      if (item.system?.active?.state !== true) {
        const comboBonus = calculateItemRollBonus(item, actor, rollContext, criticalMin);
        dice += comboBonus.dice;
        add += comboBonus.add;
        critical += comboBonus.criticalMod;
        criticalMin = comboBonus.criticalMin;
      }

      // Add the effects' attributes bonus (only the ones not activated)
      const comboAction = window.DX3rdItemEffectAdapter?.invocationAction?.(item)
        || (isAttackCombo ? 'attack' : 'use');
      const effectBonus = calculateRegisteredEffectRollBonus(
        actor, data.system.effectIds, rollContext, criticalMin, comboAction
      );
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
    
    // Add the actor information (for the enemy check)
    if (actor) {
      data.actor = {
        id: actor.id,
        type: actor.type
      };
    } else {
      data.actor = null;
    }

    // Initialize the combo sheet fields (preserving the existing data)
    prepareComboBaseFields(data, item);
    
    // Check system.roll and system.attackRoll
    const {hasRoll} = prepareRollAndAttackPlaceholders(data, item);

    // Build the actor's effect item list (sorted by the sort value)
    prepareActorEffectOptions(data, actor);

    // Load the effect item data and compute the encroachment automatically
    data.system.effectItems = prepareEffectItems(actor, data.system.effectIds);

    // Write the computed total encroachment into data.system.encroach
    data.system.encroach = { value: calculateEncroachment(actor, data.system.effectIds) };

    // With roll set, compute the dice / critical / modifier automatically
    prepareRollSummary(data, item, actor, hasRoll);

    // Compute the attack value (checking attackRoll on the real item data)
    prepareAttackSummary(data, item, actor);

    // Prepare the weapon tab data (through WeaponTabManager)
    data = window.DX3rdWeaponTabManager.prepareWeaponTabData(data, item);

    // Initialize attributes (preserving the existing data)
    itemSheetData.preserveAttributeData(item, data);

    // Add the actor's skill data
    itemSheetData.prepareSkillOptions(item, data, 'combo', {includeActorType: true});
    const effects = getEffectIds(item).map(id => actor?.items.get(id)).filter(Boolean);
    // Keep candidates even for a conflicting combination (melee+ranged) so the skill dropdown is never empty (warn and proceed).
    data.comboSkillChoices = getComboSkillCandidates(effects);
    if (data.comboSkillChoices.length) data.system.skillOptions = data.system.skillOptions.filter(o => o.value === '-' || data.comboSkillChoices.includes(o.value));

    // Add the data for the Description editor (through helpers.js)
    data = await itemSheetData.enrichSheetData(item, data);

    // Initialize the getTarget / scene checkboxes
    itemSheetData.prepareTargetFlags(item, data);

    // The range / target / difficulty dropdown context
    if (window.DX3rdRangeTarget) {
      data.rangeField = window.DX3rdRangeTarget.fieldContext('range', data.system.range);
      data.targetField = window.DX3rdRangeTarget.fieldContext('target', data.system.target);
      data.difficultyField = window.DX3rdRangeTarget.difficultyFieldContext(data.system.difficulty);
    }

    // Pass the actor data to the template
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
    // What the member effects add to the combo's check preview. Drifting from the runtime (combo-handler's
    // memberSelfModifiersFireAt) makes the sheet numbers differ from the real roll, so it is exposed for verification.
    calculateRegisteredEffectRollBonus,
    // The combo check preview (dice / modifier / critical). Drifting from the runtime's roll dialog makes the sheet
    // numbers differ from the real roll, so it is exposed for verification.
    prepareRollSummary,
    calculateEncroachment,
    calculateSubmittedAttack,
    prepareSubmittedCombatValues,
    prepareActorEffectOptions,
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
