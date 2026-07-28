// 아이템 효과 정규화 어댑터
// ---------------------------------------------------------------------------
// effect/weapon/protect/etc/once에 흩어진 기계화 필드를 저장 형식 변경 없이
// 공통 효과 카드로 투영한다. 시트와 실행기가 같은 action 판정을 사용하도록 이 파일을
// helpers 직후에 로드하며, 실제 실행은 기존 UniversalHandler 함수에 계속 위임한다.
(function () {
  const SCOPE = 'dx3rd-emanim';
  const ACTIONS = new Set(['activation', 'use', 'attack']);
  // 확장 도구가 실제 편집 UI를 제공하는 슬롯. encroach 실행기는 남아 있지만 독립된
  // 확장 데이터/편집 폼이 없으므로 빈 가상 카드는 만들지 않는다.
  const DIRECT_TYPES = ['heal', 'damage', 'statusClear', 'weapon', 'protect', 'vehicle'];
  const EXECUTION_TYPES = [...DIRECT_TYPES, 'encroach'];
  const ATTACK_TYPES = new Set(['weapon', 'vehicle']);
  const PARTIALS = [
    'systems/dx3rd-emanim/templates/item/parts/immediate-effects-v2.html',
    'systems/dx3rd-emanim/templates/item/parts/persistent-effects-v2.html'
  ];

  const localize = key => game.i18n.localize(key);
  const hasEntries = value => value && typeof value === 'object' && Object.keys(value).length > 0;
  // 실제로 적용되는 보정이 하나라도 있는가. 키가 비었거나 '-'인 껍데기 항목은 저장 형식상
  // 흔하므로, 액션 판정은 hasEntries(키 존재)가 아니라 이쪽을 써야 시트 표시와 어긋나지 않는다.
  const hasUsableEntries = value => Object.values(value || {}).some(entry =>
    entry?.key && entry.key !== '-' && String(entry.value ?? '').trim() !== '');
  const normalizeAction = value => ACTIONS.has(value) ? value : null;

  function isAttackItem(item) {
    if (!item) return false;
    if (ATTACK_TYPES.has(item.type)) return true;
    return item.system?.attackRoll && item.system.attackRoll !== '-';
  }

  function hasConfiguredFormula(value) {
    const text = String(value ?? '').trim();
    return text !== '' && text !== '-' && text !== '0';
  }

  /**
   * 직접 공격 및 콤보 구성 이펙트의 수정치/공격력을 기존 weaponBonus 운반 형식으로 투영한다.
   * 고정식은 즉시 수치화하고 다이스식은 명중/데미지 확정 시점까지 보존한다.
   */
  function effectAttackBonus(item, actor, {includeComboModifiers = false} = {}) {
    if (item?.type !== 'effect' || (!isAttackItem(item) && !includeComboModifiers)) return null;
    const rawAdd = item.system?.add ?? '0';
    const rawAttack = item.system?.attack ?? '0';
    if (!hasConfiguredFormula(rawAdd) && !hasConfiguredFormula(rawAttack)) return null;

    const formula = window.DX3rdFormulaEvaluator;
    if (!formula) return null;
    const bonus = {
      attack: 0,
      add: 0,
      attackFormula: '',
      addFormula: '',
      weaponName: String(item.name || '').split('||')[0].trim(),
      weaponIds: [],
      sourceLabel: localize('DX3rd.AttackSource')
    };
    const addTerm = (target, raw) => {
      const prepared = formula.prepareRollFormula(String(raw ?? '0'), item, actor);
      if (formula.hasDice(prepared)) bonus[target] = prepared;
      else bonus[target === 'attackFormula' ? 'attack' : 'add'] = Number(formula.evaluate(raw, item, actor)) || 0;
    };
    addTerm('attackFormula', rawAttack);
    addTerm('addFormula', rawAdd);
    return bonus;
  }

  /** 기존 무기 보너스와 직접 공격 이펙트 보너스를 중복 평가 없이 한 운반 객체로 합친다. */
  function mergeAttackBonuses(...entries) {
    const bonuses = entries.flat().filter(Boolean);
    if (!bonuses.length) return null;
    const names = [];
    const weaponIds = [];
    const merged = {
      attack: 0,
      add: 0,
      attackFormula: '',
      addFormula: '',
      weaponName: '',
      weaponIds,
      sourceLabel: bonuses.find(bonus => bonus.sourceLabel)?.sourceLabel || ''
    };
    for (const bonus of bonuses) {
      merged.attack += Number(bonus.attack) || 0;
      merged.add += Number(bonus.add) || 0;
      if (bonus.attackFormula) merged.attackFormula = [merged.attackFormula, bonus.attackFormula].filter(Boolean).join(' + ');
      if (bonus.addFormula) merged.addFormula = [merged.addFormula, bonus.addFormula].filter(Boolean).join(' + ');
      if (bonus.weaponName && !names.includes(bonus.weaponName)) names.push(bonus.weaponName);
      for (const id of (bonus.weaponIds || [])) if (id && !weaponIds.includes(id)) weaponIds.push(id);
    }
    merged.weaponName = names.join(', ');
    return merged;
  }

  function invocationAction(item, options = {}) {
    const explicit = normalizeAction(options.action || options.dx3rdAction);
    if (explicit) return explicit;
    return isAttackItem(item) ? 'attack' : 'use';
  }

  function eventAction(item, timing = 'instant', options = {}) {
    const explicit = normalizeAction(options.action || options.dx3rdAction);
    if (explicit) return explicit;
    if (timing === 'afterDamage') return 'attack';
    return invocationAction(item, options);
  }

  /**
   * 자기 보정을 '활성화' 액션으로 **명시 저작**했는가(상시 여부와 무관).
   * 효과 카드에서 액션을 「활성화」로 고르면 updateAction 이 이 두 필드를 함께 쓴다.
   */
  function declaresActivationSelfModifiers(item) {
    return normalizeAction(item?.system?.active?.action) === 'activation'
      || (item?.system?.active?.applyMode || 'onUse') === 'toggle';
  }

  /**
   * 자기 보정 채널이 '활성화'인가 — 즉 발동/해제가 active.state 토글로 이뤄지는가.
   * 시트의 활성 체크박스, 직접 사용 게이트, 콤보 멤버 처리가 **모두 이 한 함수만** 본다.
   * 규칙을 호출부에서 다시 쓰면 미묘하게 갈라져, 토글도 없고 사용에도 안 걸리는
   * 이펙트가 생긴다(실제로 그 버그가 있었다).
   */
  function usesActivationSelfChannel(item) {
    return !!item && inferAction(item, 'selfModifiers', item.system?.active || {}) === 'activation';
  }

  /**
   * 아이템을 직접 사용/공격했을 때, 자기 보정을 동결이 아니라 토글로 켜야 하는가.
   * 장비(무기/방어구/비클)는 장착 체크(system.equipment)가 활성 상태의 원본이므로 제외한다 —
   * 사용만으로 켜면 미장착 장비의 보정이 살아난다.
   */
  function useMeansActivation(item) {
    if (!item || ['weapon', 'protect', 'vehicle'].includes(item.type)) return false;
    return usesActivationSelfChannel(item);
  }

  /**
   * 지금 자기 보정을 걸어야 하는가(instant 발동점 공통 게이트).
   * 단독 사용·콤보 멤버 두 경로가 `!active.state` 를 각자 복붙하고 있었는데, 그 조건은
   * **활성화 채널에만** 맞는 판정이다. 활성화 채널은 active.state 가 곧 적용 상태이므로
   * 이미 켜져 있으면 할 일이 없다. 반면 동결 채널(applyMode='onUse')의 상태는 AE 쪽에 있고
   * active.state 와 무관하다 — 사용할 때마다 그 시점 값으로 새로 걸어야 한다.
   * 둘을 같은 조건으로 막아 두면, 어쩌다 state 가 켜진 동결 채널 아이템(구버전 장착 훅이
   * 켜 둔 선언형 장비, 시트 체크박스)은 사용해도 영영 아무 일도 하지 않는다.
   */
  function selfModifiersPending(item) {
    if (!item) return false;
    if ((item.system?.active?.disable ?? '-') === 'notCheck') return false;
    if (usesActivationSelfChannel(item)) return item.system?.active?.state !== true;
    return true;
  }

  function inferAction(item, kind, data = {}) {
    const explicit = normalizeAction(data?.action);
    if (explicit) return explicit;

    const timing = data?.timing || data?.runTiming || 'instant';
    if (kind === 'selfModifiers') {
      // 장비(무기/방어구/비클)의 자기 보정 버킷에는 성격이 다른 두 가지가 섞여 있다.
      //  ① 상시 속성 — 「장비하고 있는 동안 …」(기타의 〈예술:음악〉 +1, 레이저 라이플의 관통).
      //     장착이 상태의 원본이고 '사용 선언'이라는 개념 자체가 없다.
      //  ② 선언형 일시 보정 — 「마이너 액션을 소비해서 선언하면 …」(볼트액션 라이플 명중 +5,
      //     가드 실드의 가드치 +5). 선언해야 붙고 소멸 타이밍에 꺼진다.
      // 타입만 보고 전부 ①로 단정하면 ②까지 장착만으로 켜졌다가, 첫 소멸 훅
      // (disable-hooks 는 active.state 를 내린다)에 꺼진 뒤 장착 중인데도 재장착 전까지
      // 다시 안 켜진다. 구분 축은 이미 applyMode 에 있으니 그것을 존중한다 —
      // 장비의 template 기본값이 'toggle'(=①)이므로 명시 저작이 없는 기존 데이터의
      // 동작은 그대로다.
      if (['weapon', 'protect', 'vehicle'].includes(item.type)) {
        return (item.system?.active?.applyMode || 'toggle') === 'onUse' ? invocationAction(item) : 'activation';
      }
      if ((item.system?.active?.applyMode || 'onUse') === 'toggle') return 'activation';
      // 기존 액터 시트에서 자기 보정만 가진 상시 비공격 이펙트는 이름 클릭으로 on/off하던
      // 지속 토글이었다. 명시 action이 없는 기존 데이터는 이 의미를 그대로 보존한다.
      if (item.type === 'effect' && item.system?.timing === 'always' && !isAttackItem(item)
        && hasUsableEntries(item.system?.attributes)
        && !hasUsableEntries(item.system?.effect?.attributes)) return 'activation';
      return invocationAction(item);
    }
    if (timing === 'afterDamage') return 'attack';
    if (kind === 'targetModifiers' || kind === 'damage' || kind === 'condition' || kind === 'macro') {
      return isAttackItem(item) ? 'attack' : 'use';
    }
    return invocationAction(item);
  }

  function triggerFor(action, timing = 'instant') {
    if (action === 'activation') return 'activate';
    if (timing === 'afterSuccess') return action === 'attack' ? 'hit' : 'success';
    if (timing === 'afterDamage') return 'damageApplied';
    if (timing === 'afterMain') return 'afterMain';
    if (timing === 'onInvoke') return 'invoke';
    return action === 'attack' ? 'attack' : 'use';
  }

  function actionLabel(action) {
    return localize({
      activation: 'DX3rd.EffectActionActivation',
      use: 'DX3rd.EffectActionUse',
      attack: 'DX3rd.EffectActionAttack'
    }[action] || 'DX3rd.EffectActionUse');
  }

  function triggerLabel(trigger) {
    return localize({
      activate: 'DX3rd.EffectTriggerActivate',
      use: 'DX3rd.EffectTriggerUse',
      attack: 'DX3rd.EffectTriggerAttack',
      success: 'DX3rd.EffectTriggerSuccess',
      hit: 'DX3rd.EffectTriggerHit',
      damageApplied: 'DX3rd.EffectTriggerDamageApplied',
      afterMain: 'DX3rd.AfterMain',
      invoke: 'DX3rd.OnInvoke'
    }[trigger] || 'DX3rd.Instant');
  }

  function targetLabel(target) {
    return localize({
      self: 'DX3rd.EffectTargetSelf',
      targetToken: 'DX3rd.EffectTargetSelected',
      targetAll: 'DX3rd.EffectTargetAll',
      scene: 'DX3rd.EffectTargetScene',
      damagedTargets: 'DX3rd.EffectTargetDamaged'
    }[target] || 'DX3rd.EffectTargetSelf');
  }

  function targetForTargetModifiers(item, timing) {
    if (timing === 'afterDamage') return 'damagedTargets';
    if (item.system?.scene) return 'scene';
    if (item.system?.getTarget) return 'targetToken';
    return 'self';
  }

  function formulaSummary(data = {}) {
    const dice = String(data.formulaDice ?? data.dice ?? '').trim();
    const add = String(data.formulaAdd ?? data.add ?? '').trim();
    // 레거시 확장 데이터는 주사위가 없을 때 formulaDice: 0을 저장한다.
    // 이를 주사위 개수로 해석하면 빈 수식이 카드에서 0d10으로 보이므로 제외한다.
    const diceTerm = dice && dice !== '0'
      ? (window.DX3rdFormulaEvaluator?.hasDice?.(dice) ? dice : `${dice}d10`)
      : '';
    const addTerm = add && add !== '0' ? add : '';
    if (diceTerm && addTerm) return `${diceTerm} + ${addTerm}`;
    return addTerm || diceTerm || '-';
  }

  function directTitle(type) {
    return localize({
      heal: 'DX3rd.Heal',
      damage: 'DX3rd.DamageToHP',
      statusClear: 'DX3rd.StatusClear',
      encroach: 'DX3rd.Encroachment',
      weapon: 'DX3rd.CreateWeapon',
      protect: 'DX3rd.CreateProtect',
      vehicle: 'DX3rd.CreateVehicle'
    }[type] || 'DX3rd.Effect');
  }

  function isOwn(object, key) {
    return Object.prototype.hasOwnProperty.call(object || {}, key);
  }

  function isConfiguredCondition(condition = {}) {
    return condition.configured === true || !!condition.type || condition.activate === true;
  }

  /**
   * 기존 종류별 슬롯과 신규 무제한 cards[]를 하나의 실행 목록으로 정규화한다.
   * 신규 카드는 {id, type, data}이며 같은 type을 몇 개든 가질 수 있다.
   */
  function extensionEntries(itemOrExtend) {
    const ext = itemOrExtend?.getFlag
      ? (itemOrExtend.getFlag(SCOPE, 'itemExtend') || {})
      : (itemOrExtend || {});
    const entries = [];
    for (const type of EXECUTION_TYPES) {
      if (isOwn(ext, type)) entries.push({id: `legacy.${type}`, type, data: ext[type] || {}, legacy: true});
    }
    conditionEntries(ext).forEach((data, index) => {
      if (isConfiguredCondition(data)) entries.push({id: `legacy.condition.${index}`, type: 'condition', data, legacy: true});
    });
    for (const card of Array.isArray(ext.cards) ? ext.cards : []) {
      if (!card?.id || ![...DIRECT_TYPES, 'condition'].includes(card.type)) continue;
      entries.push({id: card.id, type: card.type, data: card.data || {}, legacy: false});
    }
    return entries;
  }

  function directSummary(type, data = {}) {
    if (type === 'heal' || type === 'damage') return formulaSummary(data);
    if (type === 'encroach') return String(data.value ?? data.formula ?? data.amount ?? '-');
    if (type === 'statusClear') return localize('DX3rd.Condition');
    return data.name || data.itemName || '-';
  }

  function conditionLabel(type) {
    if (!type) return '-';
    const configured = (CONFIG.statusEffects || []).find(effect => effect.id === type);
    return configured?.name ? localize(configured.name) : type;
  }

  function conditionEntries(itemExtend = {}) {
    const raw = itemExtend.condition || {};
    if (Array.isArray(raw.conditions)) {
      const out = raw.conditions.slice(0, 3).map(value => ({...value}));
      while (out.length < 3) out.push({timing: 'instant', target: 'self', type: '', activate: false});
      return out;
    }
    const legacy = raw.type || raw.conditionTypes?.[0]
      ? [{...raw, type: raw.type || raw.conditionTypes?.[0]}]
      : [];
    while (legacy.length < 3) legacy.push({timing: 'instant', target: 'self', type: '', activate: false});
    return legacy.slice(0, 3);
  }

  function descriptorBase(item, {id, family, kind, data, active, title, summary, target, editor}) {
    const action = inferAction(item, kind, data);
    const timing = data?.timing || data?.runTiming || 'instant';
    const trigger = triggerFor(action, timing);
    return {
      id, family, kind, active: !!active, title, summary: summary || '-', target,
      action, actionLabel: actionLabel(action), trigger, triggerLabel: triggerLabel(trigger),
      targetLabel: targetLabel(target), editor, toggleable: target === 'self'
    };
  }

  function collectImmediate(item) {
    const cards = [];
    for (const entry of extensionEntries(item).filter(entry => DIRECT_TYPES.includes(entry.type))) {
      const {type, data} = entry;
      const target = data.target || 'self';
      cards.push(descriptorBase(item, {
        id: entry.legacy ? `extend.${type}` : `card.${entry.id}`,
        family: 'immediate', kind: type, data,
        active: data.activate,
        title: directTitle(type), summary: directSummary(type, data), target,
        editor: type
      }));
    }
    const macros = Array.isArray(item.system?.macros) ? item.system.macros : [];
    macros.forEach((macro, index) => {
      const title = macro.kind === 'macro' ? (macro.macroName || localize('DX3rd.Macro')) : localize('DX3rd.MacroKindCode');
      cards.push(descriptorBase(item, {
        id: `macro.${index}`,
        family: 'immediate', kind: 'macro', data: macro,
        active: !macro.disabled,
        title, summary: macro.timing || 'instant', target: 'self', editor: 'macro'
      }));
    });
    return cards;
  }

  function collectPersistent(item) {
    const system = item.system || {};
    const ext = item.getFlag?.(SCOPE, 'itemExtend') || {};
    const selfData = {...(system.active || {}), timing: system.active?.runTiming || 'instant'};
    const targetData = {...(system.effect || {}), timing: system.effect?.runTiming || 'instant'};
    const cards = [
      descriptorBase(item, {
        id: 'modifiers.self', family: 'persistent', kind: 'selfModifiers', data: selfData,
        // 「살아 있는가」의 기준은 채널마다 다르다. 활성화 채널은 active.state 가 곧 적용
        // 상태지만, 동결 채널(applyMode='onUse')의 상태는 AE 가 들고 있고 active.state 는
        // 쓰지 않는다 — 저작돼 있으면 살아 있는 카드다(대상 보정 카드와 같은 판정).
        // state 로 단정하면 시트에서 늘 회색이고, 그보다 나쁘게는 hasActionEffects 가
        // false 를 반환해 무기 모드 메뉴의 「사용」 진입점이 통째로 닫힌다.
        active: hasEntries(system.attributes) && (usesActivationSelfChannel(item)
          ? !!system.active?.state
          : (system.active?.disable ?? '-') !== 'notCheck'),
        title: localize('DX3rd.SelfModifiers'),
        summary: localize('DX3rd.EffectModifierCount').replace('{count}', Object.keys(system.attributes || {}).length),
        target: 'self', editor: 'selfModifiers'
      }),
      descriptorBase(item, {
        id: 'modifiers.target', family: 'persistent', kind: 'targetModifiers', data: targetData,
        active: hasEntries(system.effect?.attributes) && system.effect?.disable !== 'notCheck',
        title: localize('DX3rd.TargetModifiers'),
        summary: localize('DX3rd.EffectModifierCount').replace('{count}', Object.keys(system.effect?.attributes || {}).length),
        target: targetForTargetModifiers(item, targetData.timing), editor: 'targetModifiers'
      })
    ];
    extensionEntries(ext).filter(entry => entry.type === 'condition').forEach((entry, index) => {
      const condition = entry.data;
      cards.push(descriptorBase(item, {
        id: entry.legacy ? `condition.${entry.id.split('.').pop()}` : `card.${entry.id}`,
        family: 'persistent', kind: 'condition', data: condition,
        active: condition.activate && condition.type,
        title: localize('DX3rd.Condition'),
        summary: conditionLabel(condition.type),
        target: condition.target || 'self', editor: entry.legacy ? `condition${Number(entry.id.split('.').pop()) + 1}` : 'condition'
      }));
    });
    return cards;
  }

  function prepareSheetContext(item) {
    const immediate = collectImmediate(item);
    const persistent = collectPersistent(item);
    const selfModifiers = persistent.find(card => card.id === 'modifiers.self');
    const targetModifiers = persistent.find(card => card.id === 'modifiers.target');
    const selfModifierCount = Object.keys(item.system?.attributes || {}).length;
    const targetModifierCount = Object.keys(item.system?.effect?.attributes || {}).length;
    const modifierOverview = {
      id: 'modifiers',
      active: targetModifierCount > 0 || !!selfModifiers?.active,
      selfActive: !!selfModifiers?.active,
      toggleable: selfModifierCount > 0,
      selfCount: selfModifierCount,
      targetCount: targetModifierCount,
      totalCount: selfModifierCount + targetModifierCount,
      selfAction: selfModifiers?.action || 'use',
      targetAction: targetModifiers?.action || 'use',
      initialScope: selfModifierCount > 0 ? 'main' : (targetModifierCount > 0 ? 'sub' : 'main'),
      summary: `${localize('DX3rd.Self')} ${selfModifierCount} / ${localize('DX3rd.Target')} ${targetModifierCount}`
    };
    // 지속 효과 보정은 시트에서 두 장의 카드로 나눈다. 축이 두 개인데 한 장에 묶여 있었다:
    //  ① 적용 대상 — 자신(system.attributes) / 대상(system.effect.attributes). 데이터는 원래
    //     분리돼 있는데 카드가 하나라 "자신 N / 대상 M" 요약으로만 보였고, 소멸 타이밍·발현
    //     액션도 채널마다 따로인 것이 드러나지 않았다.
    //  ② 발동 시점 — 상시(활성화 채널) / 사용·공격 시(동결 채널). 자기 보정 카드의
    //     「발현 액션」이 정하지만 편집 창 안쪽에만 있어 아무도 저작하지 않았다.
    const isEquipment = ['weapon', 'protect', 'vehicle'].includes(item.type);
    const modifierCards = [];
    if (selfModifierCount) {
      // 켜고 끌 것이 있는 쪽은 활성화 채널뿐이다. 동결 채널(사용 시)의 상태는 AE 에 있고
      // active.state 는 쓰지 않는데도 체크박스를 내주면, 그걸 켠 아이템은 이중 가산되거나
      // (장비 자체계산 + 동결 AE) 발동 게이트에 걸려 사용해도 아무 일이 없었다.
      // 상시로 쓰고 싶으면 「발현 액션」을 '활성화'로 바꾸면 체크박스가 나타난다.
      const selfIsActivation = usesActivationSelfChannel(item);
      modifierCards.push({
        ...selfModifiers,
        editor: 'modifiers', count: selfModifierCount, toggleable: selfIsActivation,
        // active(카드가 살아 있는가)는 여기서 손보지 않는다 — collectPersistent 가 채널별로
        // 이미 판정한다. 시트에서만 덧칠했더니 같은 카드가 hasActionEffects 에는 죽은 것으로
        // 보여, 선언형 무기의 「사용」 진입점이 열리지 않았다.
        // 장비의 상시 채널은 '활성화 시'가 아니라 장착이 상태의 원본이다.
        triggerLabel: isEquipment && selfModifiers.action === 'activation'
          ? localize('DX3rd.EffectTriggerEquipped')
          : selfModifiers.triggerLabel
      });
    }
    if (targetModifierCount) {
      modifierCards.push({
        ...targetModifiers,
        editor: 'modifiers', count: targetModifierCount, toggleable: false
      });
    }
    const actionOptions = [
      {value: 'activation', label: actionLabel('activation')},
      {value: 'use', label: actionLabel('use')},
      {value: 'attack', label: actionLabel('attack')}
    ];
    const immediateAddOptions = DIRECT_TYPES.map(type => ({value: type, label: directTitle(type)}));
    // 지속 효과 카드는 종류당 한 장뿐인 것이 있다(지속 효과 보정은 아이템당 한 장이고,
    // 추가 버튼은 그 카드에 보정 줄을 더할 뿐이다). 이미 만들어진 종류는 선택지를 지우지 않고
    // "추가됨"으로 비활성화해, 눌러도 새 카드가 안 생기는 혼란을 없앤다.
    const addedLabel = localize('DX3rd.AlreadyAdded');
    const persistentAddOptions = [
      {value: 'modifiers', label: localize('DX3rd.PersistentModifiers'), disabled: modifierOverview.totalCount > 0},
      {value: 'condition', label: localize('DX3rd.Condition'), disabled: false}
    ].map(option => option.disabled ? {...option, label: `${option.label} (${addedLabel})`} : option);
    return {
      immediate, persistent, modifierOverview, modifierCards, actionOptions,
      immediateAddOptions, persistentAddOptions,
      persistentAddDisabled: persistentAddOptions.every(option => option.disabled),
      persistentConditionCount: persistent.filter(card => card.id.startsWith('condition.') || card.id.startsWith('card.')).length,
      immediateActiveCount: immediate.filter(card => card.active).length,
      persistentActiveCount: (modifierOverview.active ? 1 : 0)
        + persistent.filter(card => card.id.startsWith('condition.') && card.active).length
    };
  }

  function extensionActionMatches(item, kind, data, action, timing = 'instant') {
    const expected = normalizeAction(action) || eventAction(item, timing);
    return inferAction(item, kind, data) === expected;
  }

  function targetActionMatches(item, action, timing = 'instant') {
    return extensionActionMatches(item, 'targetModifiers', item.system?.effect || {}, action, timing);
  }

  function macroActionMatches(item, macro, action, timing = 'instant') {
    return extensionActionMatches(item, 'macro', macro || {}, action, timing);
  }

  function requiresTarget(item, action = invocationAction(item)) {
    const expected = normalizeAction(action) || invocationAction(item);
    const targetCard = collectPersistent(item).find(card => card.id === 'modifiers.target');
    if (targetCard?.active && targetCard.action === expected && ['targetToken', 'damagedTargets'].includes(targetCard.target)) return true;
    return [...collectImmediate(item), ...collectPersistent(item)].some(card =>
      card.active && card.action === expected && ['targetToken', 'damagedTargets'].includes(card.target));
  }

  function hasActionEffects(item, action) {
    const expected = normalizeAction(action);
    if (!expected) return false;
    return [...collectImmediate(item), ...collectPersistent(item)]
      .some(card => card.active && card.action === expected);
  }

  async function updateAction(item, id, action) {
    action = normalizeAction(action);
    if (!item || !action) return false;
    if (id === 'modifiers.self') {
      await item.update({
        'system.active.action': action,
        'system.active.applyMode': action === 'activation' ? 'toggle' : 'onUse',
        ...(action === 'activation' ? {'system.active.runTiming': 'instant'} : {})
      });
      if (['weapon', 'protect', 'vehicle'].includes(item.type) && item.system?.equipment) {
        const shouldBeActive = action === 'activation' && item.system?.active?.disable !== 'notCheck';
        if (item.system?.active?.state !== shouldBeActive) {
          await item.update({'system.active.state': shouldBeActive}, {dx3rdActivationFromEquipment: true});
        }
      }
      return true;
    }
    if (id === 'modifiers.target') {
      await item.update({
        'system.effect.action': action,
        ...(action === 'activation' ? {'system.effect.runTiming': 'instant'} : {})
      });
      return true;
    }
    if (id.startsWith('macro.')) {
      const index = Number(id.split('.')[1]);
      const macros = foundry.utils.deepClone(item.system?.macros || []);
      if (!macros[index]) return false;
      macros[index].action = action;
      if (action === 'activation') macros[index].timing = 'instant';
      await item.update({'system.macros': macros});
      return true;
    }

    if (id.startsWith('card.')) {
      const cardId = id.slice('card.'.length);
      const ext = foundry.utils.deepClone(item.getFlag(SCOPE, 'itemExtend') || {});
      const cards = Array.isArray(ext.cards) ? ext.cards : [];
      const card = cards.find(entry => entry?.id === cardId);
      if (!card) return false;
      card.data = {...(card.data || {}), action};
      if (action === 'activation') card.data.timing = 'instant';
      ext.cards = cards;
      await item.setFlag(SCOPE, 'itemExtend', ext);
      return true;
    }

    const ext = foundry.utils.deepClone(item.getFlag(SCOPE, 'itemExtend') || {});
    if (id.startsWith('condition.')) {
      const index = Number(id.split('.')[1]);
      const conditions = conditionEntries(ext);
      conditions[index].action = action;
      if (action === 'activation') conditions[index].timing = 'instant';
      ext.condition = {conditions};
    } else if (id.startsWith('extend.')) {
      const type = id.slice('extend.'.length);
      ext[type] = {...(ext[type] || {}), action};
      if (action === 'activation') ext[type].timing = 'instant';
    } else return false;
    await item.setFlag(SCOPE, 'itemExtend', ext);
    return true;
  }

  async function toggleEffect(item, id, active) {
    if (!item) return false;
    // 'modifiers' 는 자신/대상이 한 장이던 시절의 카드 id 다. 분리 후에도 남겨 둔다 —
    // 켜고 끄는 대상은 어느 쪽이든 자기 보정(system.active.state) 하나뿐이다.
    if (id === 'modifiers' || id === 'modifiers.self') {
      const selfCount = Object.keys(item.system?.attributes || {}).length;
      if (!selfCount) return false;
      await item.update({'system.active.state': !!active});
      return true;
    }
    if (id.startsWith('macro.')) {
      const index = Number(id.split('.')[1]);
      const macros = foundry.utils.deepClone(item.system?.macros || []);
      if (!macros[index]) return false;
      macros[index].disabled = !active;
      await item.update({'system.macros': macros});
      return true;
    }
    if (id.startsWith('card.')) {
      const cardId = id.slice('card.'.length);
      const ext = foundry.utils.deepClone(item.getFlag(SCOPE, 'itemExtend') || {});
      const cards = Array.isArray(ext.cards) ? ext.cards : [];
      const card = cards.find(entry => entry?.id === cardId);
      if (!card) return false;
      card.data = {...(card.data || {}), activate: !!active};
      ext.cards = cards;
      await item.setFlag(SCOPE, 'itemExtend', ext);
      return true;
    }
    if (!id.startsWith('extend.') && !id.startsWith('condition.')) return false;
    const ext = foundry.utils.deepClone(item.getFlag(SCOPE, 'itemExtend') || {});
    if (id.startsWith('condition.')) {
      const index = Number(id.split('.')[1]);
      const conditions = conditionEntries(ext);
      conditions[index].activate = !!active;
      ext.condition = {conditions};
    } else {
      const type = id.slice('extend.'.length);
      ext[type] = {...(ext[type] || {}), activate: !!active};
    }
    await item.setFlag(SCOPE, 'itemExtend', ext);
    return true;
  }

  function createDirectData(item, type) {
    const base = {
      configured: true,
      action: invocationAction(item),
      timing: 'instant',
      target: 'self',
      activate: true
    };
    if (type === 'heal' || type === 'damage') {
      return {...base, formulaDice: 0, formulaAdd: ''};
    }
    if (type === 'statusClear') return {...base, exclude: []};
    if (type === 'weapon') return {...base, name: '', type: 'melee', skill: 'melee', amount: 1};
    if (type === 'protect') return {...base, name: ''};
    if (type === 'vehicle') return {...base, name: '', skill: 'drive'};
    return base;
  }

  async function addEffect(item, family, kind) {
    if (!item) return null;
    const ext = foundry.utils.deepClone(item.getFlag(SCOPE, 'itemExtend') || {});
    if (family === 'immediate' && DIRECT_TYPES.includes(kind)) {
      const id = foundry.utils.randomID();
      const cards = Array.isArray(ext.cards) ? ext.cards : [];
      cards.push({id, type: kind, data: createDirectData(item, kind)});
      ext.cards = cards;
      await item.setFlag(SCOPE, 'itemExtend', ext);
      return `card.${id}`;
    }
    if (family === 'persistent' && kind === 'condition') {
      const id = foundry.utils.randomID();
      const cards = Array.isArray(ext.cards) ? ext.cards : [];
      cards.push({id, type: 'condition', data: {
        configured: true,
        action: invocationAction(item),
        timing: 'instant',
        target: 'self',
        type: '',
        poisonedRank: null,
        disable: null,
        activate: true
      }});
      ext.cards = cards;
      await item.setFlag(SCOPE, 'itemExtend', ext);
      return `card.${id}`;
    }
    return null;
  }

  async function deleteEffect(item, id) {
    if (!item || !id) return false;
    if (id.startsWith('card.')) {
      const cardId = id.slice('card.'.length);
      const ext = foundry.utils.deepClone(item.getFlag(SCOPE, 'itemExtend') || {});
      const cards = Array.isArray(ext.cards) ? ext.cards : [];
      const next = cards.filter(card => card?.id !== cardId);
      if (next.length === cards.length) return false;
      ext.cards = next;
      await item.setFlag(SCOPE, 'itemExtend', ext);
      return true;
    }
    if (id.startsWith('extend.')) {
      const type = id.slice('extend.'.length);
      if (!DIRECT_TYPES.includes(type)) return false;
      const ext = item.getFlag(SCOPE, 'itemExtend') || {};
      if (!isOwn(ext, type)) return false;
      const ForcedDeletion = foundry.data?.operators?.ForcedDeletion;
      if (ForcedDeletion) {
        await item.update({[`flags.${SCOPE}.itemExtend`]: {[type]: new ForcedDeletion()}});
      } else {
        await item.update({[`flags.${SCOPE}.itemExtend.-=${type}`]: null});
      }
      return true;
    }
    if (id.startsWith('condition.')) {
      const index = Number(id.split('.')[1]);
      if (!Number.isInteger(index) || index < 0 || index > 2) return false;
      const ext = foundry.utils.deepClone(item.getFlag(SCOPE, 'itemExtend') || {});
      const conditions = conditionEntries(ext);
      conditions[index] = {timing: 'instant', target: 'self', type: '', activate: false};
      ext.condition = {conditions};
      await item.setFlag(SCOPE, 'itemExtend', ext);
      return true;
    }
    return false;
  }

  async function moveModifier(item, attributeKey, source, target) {
    if (!item || !attributeKey || source === target) return false;
    if (!['main', 'sub'].includes(source) || !['main', 'sub'].includes(target)) return false;
    const sourceMap = source === 'main' ? item.system?.attributes : item.system?.effect?.attributes;
    const targetMap = target === 'main' ? item.system?.attributes : item.system?.effect?.attributes;
    const attribute = sourceMap?.[attributeKey];
    if (!attribute) return false;

    let destinationKey = attributeKey;
    if (targetMap?.[destinationKey]) destinationKey = foundry.utils.randomID();
    const sourceParent = source === 'main' ? 'system.attributes' : 'system.effect.attributes';
    const targetParent = target === 'main' ? 'system.attributes' : 'system.effect.attributes';
    const updates = {[`${targetParent}.${destinationKey}`]: foundry.utils.deepClone(attribute)};
    const ForcedDeletion = foundry.data?.operators?.ForcedDeletion;
    if (ForcedDeletion) updates[sourceParent] = {[attributeKey]: new ForcedDeletion()};
    else updates[`${sourceParent}.-=${attributeKey}`] = null;

    // 대상을 고른 첫 순간부터 실제 적용 가능한 기본 상태로 만든다. 이후 수명과
    // 장면 대상 여부는 통합 채널 설정에서 사용자가 계속 조절할 수 있다.
    if (target === 'sub') {
      if (item.system?.effect?.disable === 'notCheck') updates['system.effect.disable'] = '-';
      if (!item.system?.scene) updates['system.getTarget'] = true;
    }
    await item.update(updates);
    return true;
  }

  Hooks.once('init', async () => {
    const loadTemplatesCompat = foundry.applications?.handlebars?.loadTemplates;
    if (typeof loadTemplatesCompat === 'function') await loadTemplatesCompat(PARTIALS);
  });

  // 장착/활성 토글은 기존 문서 상태가 진실의 원본이다. 그 상태가 false→true로
  // 바뀐 순간에만 '활성화'로 묶인 기존 실행기들을 호출해, 별도 효과 엔진 없이
  // 세 번째 발현 액션을 완성한다. userId로 발신 클라이언트 한 곳만 실행한다.
  Hooks.on('updateItem', async (item, changed, options, userId) => {
    if (userId && userId !== game.user?.id) return;
    const actor = item?.parent;
    if (!actor || actor.documentName !== 'Actor') return;
    const changedValue = path => Object.prototype.hasOwnProperty.call(changed || {}, path)
      ? changed[path]
      : foundry.utils.getProperty(changed, path);
    const activeOn = changedValue('system.active.state') === true;
    const equipmentChange = changedValue('system.equipment');
    const equippedOn = equipmentChange === true;
    const equippedOff = equipmentChange === false;

    // 장비가 제공하는 상태(현재는 비행)는 장착 여부가 원본이다. 같은 상태를 제공하는
    // 다른 장비가 남아 있으면 한 장비를 해제해도 상태를 끄지 않는다.
    if (equippedOn || equippedOff) {
      const changedStatuses = item.getFlag?.(SCOPE, 'equipmentStatuses') || [];
      for (const statusId of changedStatuses) {
        const shouldBeActive = actor.items.some(candidate =>
          candidate.system?.equipment === true
          && (candidate.getFlag?.(SCOPE, 'equipmentStatuses') || []).includes(statusId));
        if (actor.statuses?.has(statusId) !== shouldBeActive) {
          await actor.toggleStatusEffect(statusId, {active: shouldBeActive});
        }
      }
    }

    // 장비 보너스(system.attributes)는 actor.prepareData가 active.state를 기준으로 소비한다.
    // 활성화 액션으로 묶인 장비의 장착 상태를 이 원본 상태와 동기화하고, true 갱신에서
    // 다시 들어온 훅 한 번만 나머지 활성화 효과를 실행한다.
    const isEquipment = ['weapon', 'protect', 'vehicle'].includes(item.type);
    // 장착 해제는 채널과 무관하게 끈다. actor.prepareData 의 activeItems 는 active.state 만
    // 보고 system.equipment 를 보지 않으므로, 선언(사용)으로 켜 둔 장비 보정이 벗은 뒤에도
    // 남으면 그대로 새어 나간다.
    if (isEquipment && equippedOff && item.system?.active?.state === true) {
      await item.update({'system.active.state': false}, {dx3rdActivationFromEquipment: true});
      return;
    }
    // 장착으로 켜는 것은 상시 채널(applyMode 'toggle')뿐이다 — 선언형(onUse)은
    // 사용 시점에 handleItemUse 가 켠다(inferAction 의 장비 분기 주석 참조).
    const equipmentSelfActivation = isEquipment
      && extensionActionMatches(item, 'selfModifiers', item.system?.active || {}, 'activation', 'instant')
      && item.system?.active?.disable !== 'notCheck';
    if (equippedOn && equipmentSelfActivation && item.system?.active?.state !== true) {
      await item.update({'system.active.state': true}, {dx3rdActivationFromEquipment: true});
      return;
    }
    if (!activeOn && !equippedOn) return;
    const handler = window.DX3rdUniversalHandler;
    if (!handler) return;
    try {
      await handler.executeMacros(item, 'instant', 'activation');
      await handler.applyToTargets(actor, item, 'instant', null, 'activation');
      await handler.processItemExtensions(actor, item, 'instant', 'activation');
      const ext = item.getFlag?.(SCOPE, 'itemExtend') || {};
      handler.registerAfterMainExtensions?.(actor, item, ext, 'activation');
    } catch (error) {
      console.error('DX3rd | activation effect routing failed:', item?.name, error);
    }
  });

  window.DX3rdItemEffectAdapter = {
    ACTIONS, DIRECT_TYPES, PARTIALS,
    isAttackItem, effectAttackBonus, mergeAttackBonuses, invocationAction, eventAction, inferAction, triggerFor,
    declaresActivationSelfModifiers, usesActivationSelfChannel, useMeansActivation, selfModifiersPending,
    collectImmediate, collectPersistent, prepareSheetContext, conditionEntries,
    extensionActionMatches, targetActionMatches, macroActionMatches, requiresTarget, extensionEntries,
    hasActionEffects, updateAction, toggleEffect, addEffect, deleteEffect, moveModifier,
    directTitle, isConfiguredCondition
  };
})();
