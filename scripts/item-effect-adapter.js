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
   *
   * 채널 기본값이 동결이어도, 보정 항목 하나라도 「활성화」로 **명시 저작**돼 있으면
   * 그 아이템에는 켜고 끌 상태가 필요하다(항목별 발현 액션 — modifierBuckets 참조).
   */
  function usesActivationSelfChannel(item) {
    if (!item) return false;
    if (inferAction(item, 'selfModifiers', item.system?.active || {}) === 'activation') return true;
    return hasExplicitBucket(item, 'self', 'activation');
  }

  /**
   * 아이템을 직접 사용/공격했을 때, 자기 보정을 동결이 아니라 토글로 켜야 하는가.
   * 장비(무기/방어구/비클)는 장착 체크(system.equipment)가 활성 상태의 원본이므로 제외한다 —
   * 사용만으로 켜면 미장착 장비의 보정이 살아난다.
   */
  function useMeansActivation(item) {
    if (!item || EQUIPMENT_TYPES.includes(item.type)) return false;
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
    if (usesActivationSelfChannel(item)) {
      if (item.system?.active?.state !== true) return true;
      // 활성화 버킷은 이미 켜져 있어도, 같은 아이템에 「사용/공격 시」로 저작된 동결 버킷이
      // 있으면 그쪽은 사용할 때마다 새로 걸어야 한다.
      return hasFrozenSelfBucket(item);
    }
    return true;
  }

  // ---------------------------------------------------------------------------
  // 항목별 발현 액션(지속 효과 보정 버킷)
  //
  // 자기 보정(system.attributes)·대상 보정(system.effect.attributes)은 각각 채널 하나이고
  // 발현 액션도 채널당 하나였다. 그래서 「장착하고 있는 동안 +1, 선언하면 추가로 +2」처럼
  // 한 아이템 안에서 발현 시점이 다른 지속 보정을 나눠 저작할 수 없었다 — 보정을 몇 개
  // 추가하든 액션은 하나로 묶였다.
  //
  // 보정 항목마다 선택적 `action` 필드를 두어 버킷으로 나눈다. 미지정(레거시 데이터 전량)은
  // 채널 기본값을 그대로 상속하므로 기존 아이템의 동작은 바뀌지 않는다. 게이트를 넓히는 것도
  // **명시 저작이 있을 때만**이다.
  // ---------------------------------------------------------------------------

  function attributeEntries(map) {
    return Object.entries(map || {}).filter(([, entry]) => entry && typeof entry === 'object');
  }

  function attributeMap(item, channel) {
    return channel === 'self' ? item?.system?.attributes : item?.system?.effect?.attributes;
  }

  const EQUIPMENT_TYPES = ['weapon', 'protect', 'vehicle'];

  /** 항목에 **명시 저작된** 발현 액션(없으면 null). */
  function explicitAction(item, channel, entry) {
    return normalizeAction(entry?.action);
  }

  /** 채널 기본 발현 액션 — 항목에 명시가 없을 때 상속되는 값(지금까지의 채널 판정 그대로). */
  function channelAction(item, channel) {
    return channel === 'self'
      ? inferAction(item, 'selfModifiers', item?.system?.active || {})
      : inferAction(item, 'targetModifiers', item?.system?.effect || {});
  }

  /** 항목의 실효 발현 액션(표시·버킷 분류용). */
  function attributeAction(item, channel, entry) {
    return explicitAction(item, channel, entry) || channelAction(item, channel);
  }

  /**
   * 버킷 하나의 발현·소멸 타이밍.
   *
   * 발현 액션(활성화/사용/공격)과 발현 타이밍(즉시/성공 후/데미지 후)은 **다른 축**이다.
   * 액션만 버킷으로 나누고 타이밍을 채널 필드 하나로 두면, 대상 채널의 `runTiming` 이
   * 발현점을 하나로 못 박기 때문에 사용/공격 버킷 중 한쪽은 어느 발현점에도 걸리지 못하고
   * 조용히 죽는다(afterDamage 경로는 runTiming==='afterDamage' 를, instant 경로는
   * runTiming==='instant' 를 요구한다). 그래서 버킷마다 자기 타이밍을 갖는다.
   *
   * 기본 버킷(채널 기본 액션)은 채널의 평탄 필드를 그대로 쓰고, 명시 버킷만
   * `system.<active|effect>.buckets.<action>` 에 자기 값을 둔다(없는 값은 채널에서 상속).
   * 이 규칙 덕에 기존 데이터는 손댈 것이 없다. 버킷은 문서 스키마
   * (`scripts/data/document-schema.js`)에서 채널마다 선택 ObjectField 로 선언돼 있어
   * 저작하기 전에는 생기지 않고, 저작한 내용은 그대로 보존된다.
   *
   * 게이트 판정은 **전부 이 함수를 통과해야 한다** — 호출부가 system.effect.runTiming 을
   * 직접 읽으면 버킷별 타이밍이 무시돼 위의 사문화가 되살아난다.
   */
  function bucketLifecycle(item, channel, action = null) {
    const chan = channel === 'self' ? 'self' : 'target';
    const root = (chan === 'self' ? item?.system?.active : item?.system?.effect) || {};
    const fallbackDisable = chan === 'self' ? '-' : 'notCheck';
    const expected = normalizeAction(action) || channelAction(item, chan);
    const isDefault = expected === channelAction(item, chan);
    const override = isDefault ? null : ((root.buckets || {})[expected] || null);
    const pick = (key, fallback) => {
      const value = override?.[key];
      return (value === undefined || value === null || value === '') ? fallback : value;
    };
    return {
      channel: chan, action: expected, isDefault,
      overridden: !!override,
      disable: pick('disable', root.disable ?? fallbackDisable),
      // 활성화 버킷의 발현점은 상태가 켜지는 순간 하나뿐이다 — 판정 타이밍을 갖지 않는다.
      runTiming: expected === 'activation' ? 'instant' : pick('runTiming', root.runTiming || 'instant'),
      path: isDefault
        ? (chan === 'self' ? 'system.active' : 'system.effect')
        : `${chan === 'self' ? 'system.active' : 'system.effect'}.buckets.${expected}`
    };
  }

  /** 그 발현 액션의 대상 보정이 이 타이밍에 걸리는가(버킷 자기 runTiming 기준). */
  function targetFiresAt(item, action = null, timing = 'instant') {
    const expected = normalizeAction(action) || eventAction(item, timing);
    const lifecycle = bucketLifecycle(item, 'target', expected);
    if (lifecycle.disable === 'notCheck') return false;
    return lifecycle.runTiming === '-' || lifecycle.runTiming === timing;
  }

  function hasExplicitBucket(item, channel, action) {
    const expected = normalizeAction(action);
    if (!expected) return false;
    return attributeEntries(attributeMap(item, channel))
      .some(([, entry]) => explicitAction(item, channel, entry) === expected);
  }

  /**
   * 자기 보정 채널이 토글(활성화)인가 — 즉 **미지정** 항목이 활성화 버킷에 속하는가.
   * applySelfModifiers 의 채널 분기와 반드시 같은 기준이어야 한다. 어긋나면 미지정 항목이
   * 토글 AE 와 동결 AE 중 어디에도 없거나(보정 소멸) 양쪽에 다 들어간다(이중 가산).
   */
  function selfChannelIsToggle(item) {
    if (!item) return false;
    if (channelAction(item, 'self') === 'activation') return true;
    // applyMode 를 저작할 수 없는 토글 타입(spell/psionic/combo)은 토글 채널로 고정된다.
    const toggleTypes = window.DX3rdAppliedToggle?.TOGGLE_TYPES || ['effect', 'spell', 'psionic', 'combo'];
    const active = item.system?.active || {};
    if (toggleTypes.includes(item.type) && !('applyMode' in active)) return true;
    return (active.applyMode || 'onUse') === 'toggle';
  }

  /**
   * active.state 가 켜져 있는 동안 세는 자기 보정 항목인가.
   * actor.prepareData 의 자체계산(activeItems)과 토글 AE(DX3rdAppliedToggle)의 공통 규칙.
   */
  function appliesWhileActive(item, entry) {
    const explicit = explicitAction(item, 'self', entry);
    if (explicit) return explicit === 'activation';
    // 미지정 항목은 지금까지처럼 전부 센다. 채널 기본을 상속시키면 rois/connection 처럼
    // 채널 액션은 '사용'으로 잡히면서 상태가 곧 적용 상태인 타입의 보정이 통째로 사라진다.
    // 예외는 동결 채널에 「활성화」 항목이 섞여 있는 경우다 — 그때 미지정 항목은 동결 AE 가
    // 들고 있으므로 여기서 또 세면 같은 보정이 두 번 붙는다.
    return selfChannelIsToggle(item) || !hasExplicitBucket(item, 'self', 'activation');
  }

  /**
   * 이 발현 액션으로 발동할 때 active.state(토글)를 켜야 하는가.
   *
   * 자기 채널의 토글 상태는 아이템당 불리언 **하나**다. 그래서 「공격 시」처럼 동결 버킷만
   * 있는 액션으로 발동했을 때 그것까지 켜면, 그 아이템의 **활성화 버킷이 공격만으로 함께
   * 터진다** — 장비라면 장착이 상태의 원본이므로 표시까지 어긋난다(dx3rd-applied-toggle 의
   * sync 가 되돌린다). 액션 미지정 호출은 지금까지의 의미(채널 판정에 맡김)를 유지한다.
   */
  function selfToggleBucketMatches(item, action = null) {
    const expected = normalizeAction(action);
    if (!expected) return true;
    if (expected === 'activation') return true;
    // 미지정 행이 토글 AE 에 들어가는 채널이면, 그 행들의 소속(채널 기본 버킷)으로 발동할
    // 때는 토글이 맞다. 예: applyMode='toggle' + 채널 기본이 '사용'.
    return selfChannelIsToggle(item) && channelAction(item, 'self') === expected;
  }

  /**
   * 사용/공격 시 동결로 걸 **실제 값이 있는** 자기 보정이 하나라도 있는가.
   * 시트가 저장하는 빈 행(key '-' / 값 공백)까지 세면, 걸 것이 없는데도 동결 경로가 돌아
   * 이미 붙어 있던 자기 AE 를 지운다(_applyItemAttributes 의 "걸 게 없으면 제거" 분기).
   */
  function hasFrozenSelfBucket(item, action = null) {
    return hasUsableEntries(selfFrozenAttributes(item, action));
  }

  /**
   * 사용/공격 시 동결 적용할 자기 보정만 골라낸다(applySelfFrozenBuff 전용).
   * @param {Item} item
   * @param {string|null} action - 'use' | 'attack' (null 이면 활성화가 아닌 전부)
   */
  function selfFrozenAttributes(item, action = null) {
    const expected = normalizeAction(action);
    const toggleChannel = selfChannelIsToggle(item);
    // 미지정 행은 채널 기본 버킷의 것이다. 다만 동결 채널의 기존 데이터는 사용/공격 어느
    // 액션으로 발동해도 걸려야 한다 — 같은 아이템이 판정 다이얼로그의 선언(use)으로도,
    // 그 무기로 공격(attack)으로도 들어온다. 그래서 액션을 따지지 않는 것이 기본이고,
    // **저작자가 이 채널을 실제로 나눈 경우에만** 기본 버킷으로 좁힌다. 좁히지 않으면
    // 「선언 시 A / 공격 시 B」를 저작한 아이템이 공격 때 A+B 를 함께 걸어 버린다.
    const split = ['use', 'attack'].some(candidate => hasExplicitBucket(item, 'self', candidate));
    const fallback = channelAction(item, 'self');
    const out = {};
    for (const [key, entry] of attributeEntries(attributeMap(item, 'self'))) {
      const explicit = explicitAction(item, 'self', entry);
      if (explicit) {
        if (explicit === 'activation') continue;
        if (expected && explicit !== expected) continue;
      } else if (toggleChannel) {
        continue;   // 미지정 항목은 토글 AE 가 들고 있다
      } else if (split && expected && fallback !== expected) {
        continue;   // 나뉜 채널에서 미지정 항목은 기본 버킷에만 속한다
      }
      out[key] = entry;
    }
    return out;
  }

  /** 지금 발현 액션에서 대상에게 걸 보정만 골라낸다(applyToTargets 전용). */
  function targetBucketAttributes(item, action = null, timing = 'instant') {
    const expected = normalizeAction(action) || eventAction(item, timing);
    const channelMatches = channelAction(item, 'target') === expected;
    const out = {};
    for (const [key, entry] of attributeEntries(attributeMap(item, 'target'))) {
      const explicit = explicitAction(item, 'target', entry);
      if (explicit ? explicit === expected : channelMatches) out[key] = entry;
    }
    return out;
  }

  /**
   * 시트에 그릴 지속 보정 버킷. 채널(자신/대상) × 실효 발현 액션으로 묶는다.
   * 기본 버킷(= 미지정 항목이 속하는 채널 기본 액션)만 레거시 카드 id 를 그대로 쓴다 —
   * 확장 도구의 채널 설정과 액터 시트가 그 id 로 자기/대상 채널을 찾는다.
   */
  /** 카드 = 버킷 = 편집 페인. 기본 버킷만 레거시 id 를 유지한다(액터 시트·확장 도구가 참조). */
  function bucketId(item, channel, action) {
    const base = channel === 'self' ? 'modifiers.self' : 'modifiers.target';
    return action === channelAction(item, channel) ? base : `${base}@${action}`;
  }

  /** 버킷 카드 id 를 (채널, 액션)으로 되돌린다. 'main'/'sub' 는 기본 버킷의 옛 별칭이다. */
  function parseBucketId(item, id) {
    const raw = String(id || '');
    if (raw === 'main' || raw === 'sub') {
      const channel = raw === 'sub' ? 'target' : 'self';
      return {channel, action: channelAction(item, channel), isDefault: true};
    }
    const [base, suffix] = raw.split('@');
    const channel = base === 'modifiers.target' || base === 'modifiers.sub' ? 'target' : 'self';
    const explicit = normalizeAction(suffix);
    return {
      channel,
      action: explicit || channelAction(item, channel),
      isDefault: !explicit || explicit === channelAction(item, channel)
    };
  }

  /** 그 채널에서 아직 버킷이 없는 발현 액션. 카드 추가(=버킷 추가)가 고를 후보다. */
  function freeBucketActions(item, channel) {
    const used = new Set(modifierBuckets(item).filter(bucket => bucket.channel === channel)
      .map(bucket => bucket.action));
    return ['activation', 'use', 'attack'].filter(action => !used.has(action));
  }

  function modifierBuckets(item) {
    const buckets = [];
    for (const channel of ['self', 'target']) {
      const entries = attributeEntries(attributeMap(item, channel));
      if (!entries.length) continue;
      const fallback = channelAction(item, channel);
      const groups = new Map();
      for (const [key, entry] of entries) {
        const action = attributeAction(item, channel, entry);
        if (!groups.has(action)) groups.set(action, []);
        groups.get(action).push(key);
      }
      for (const action of ['activation', 'use', 'attack']) {
        const keys = groups.get(action);
        if (!keys) continue;
        buckets.push({
          channel, action, keys,
          isDefault: action === fallback,
          lifecycle: bucketLifecycle(item, channel, action),
          id: bucketId(item, channel, action)
        });
      }
    }
    return buckets;
  }

  function inferAction(item, kind, data = {}) {
    const explicit = normalizeAction(data?.action);

    // 장비(무기/방어구/비클)의 자기 보정 버킷에는 성격이 다른 두 가지가 섞여 있다.
    //  ① 상시 속성 — 「장비하고 있는 동안 …」(기타의 〈예술:음악〉 +1, 레이저 라이플의 관통).
    //     장착이 상태의 원본이고 '사용 선언'이라는 개념 자체가 없다.
    //  ② 선언형 일시 보정 — 「마이너 액션을 소비해서 선언하면 …」(볼트액션 라이플 명중 +5,
    //     가드 실드의 가드치 +5). 선언해야 붙고 소멸 타이밍에 꺼진다.
    // 타입만 보고 전부 ①로 단정하면 ②까지 장착만으로 켜졌다가, 첫 소멸 훅
    // (disable-hooks 는 active.state 를 내린다)에 꺼진 뒤 장착 중인데도 재장착 전까지
    // 다시 안 켜진다. 구분 축은 이미 applyMode 에 있으니 그것을 존중한다 —
    // 장비의 template 기본값이 'toggle'(=①)이므로 명시 저작이 없는 기존 데이터의 동작은 그대로다.
    //
    //  ③ 그 무기로 공격할 때만 붙는 보정 — 「공격 시」. ①과 달리 장착만으로는 안 붙고
    //     (①은 그 무기를 들고 **다른** 무기로 공격해도 붙는다), ②와 달리 선언도 소비도 없다.
    //
    // **②가 공격으로 자동 발동하는 일은 ③을 열어도 없다.** 룰이 「명중판정을 실행하기 직전에
    // 선언할 것」이라, 그 무기로 공격하는 것만으로 ②가 터지면 한 번뿐인 회수를 쓸지 말지 고를
    // 자리가 사라진다 — 그 선택이 곧 이 계열 장비의 전부다. 불변식을 지키는 것은 두 가지다:
    // ②는 판정 다이얼로그의 선언 토글이 action:'use' 로 확정할 때만 걸리고(declared-equipment 의
    // declaredAttributes = selfFrozenAttributes(item,'use')), ③에는 「공격 시」로 **명시 저작한
    // 행만** 들어간다. 미지정 데이터는 아래 applyMode 폴백이 반드시 ①/② 중 하나로 보내므로
    // ③으로 흘러들 경로가 없다(컴펜디움 실측: 장비의 명시 저작 22건 전부 'use', 'attack' 0건).
    if (kind === 'selfModifiers' && EQUIPMENT_TYPES.includes(item.type)) {
      if (explicit) return explicit;
      const mode = data?.applyMode || item.system?.active?.applyMode || 'toggle';
      return mode === 'onUse' ? 'use' : 'activation';
    }
    if (explicit) return explicit;

    const timing = data?.timing || data?.runTiming || 'instant';
    if (kind === 'selfModifiers') {
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
    // 보정 카드는 채널 × 실효 발현 액션(버킷)마다 한 장이다. 예전에는 채널당 한 장이라
    // 「장착 중 상시 +1」과 「선언하면 +2」를 한 아이템에 나눠 저작할 방법이 없었다.
    // 버킷이 하나도 없는(보정 행이 없는) 채널도 카드 한 장은 남긴다 — hasActionEffects /
    // requiresTarget 이 카드 목록으로 진입점을 판정하고, 시트는 count 로 걸러 그린다.
    const buckets = modifierBuckets(item);
    const bucketsFor = channel => {
      const own = buckets.filter(bucket => bucket.channel === channel);
      if (own.length) return own;
      const action = channelAction(item, channel);
      return [{channel, action, keys: [], isDefault: true,
        lifecycle: bucketLifecycle(item, channel, action),
        id: channel === 'self' ? 'modifiers.self' : 'modifiers.target'}];
    };
    const cards = [];
    const pushBucketCard = (bucket, descriptor) => {
      cards.push(descriptorBase(item, descriptor));
      const card = cards[cards.length - 1];
      card.count = bucket.keys.length;
      card.isDefaultBucket = bucket.isDefault;
      // 카드가 곧 버킷이므로 수명 필드도 카드가 들고 있다(시트 배지·확장 도구 페인이 함께 읽는다).
      card.disable = bucket.lifecycle.disable;
      card.runTiming = bucket.lifecycle.runTiming;
      card.bucketOverridden = bucket.lifecycle.overridden;
      // 기본 버킷은 채널 그 자체라 지울 수 없다(지우면 채널의 미지정 행이 통째로 사라진다).
      card.deletable = !bucket.isDefault && bucket.keys.length > 0;
    };
    for (const bucket of bucketsFor('self')) {
      pushBucketCard(bucket, {
        id: bucket.id, family: 'persistent', kind: 'selfModifiers',
        data: {...selfData, action: bucket.action, timing: bucket.lifecycle.runTiming},
        // 「살아 있는가」의 기준은 버킷마다 다르다. 활성화 버킷은 active.state 가 곧 적용
        // 상태지만, 동결 버킷(사용/공격 시)의 상태는 AE 가 들고 있고 active.state 는
        // 쓰지 않는다 — 저작돼 있으면 살아 있는 카드다(대상 보정 카드와 같은 판정).
        // state 로 단정하면 시트에서 늘 회색이고, 그보다 나쁘게는 hasActionEffects 가
        // false 를 반환해 무기 모드 메뉴의 「사용」 진입점이 통째로 닫힌다.
        active: bucket.keys.length > 0 && (bucket.action === 'activation'
          ? !!system.active?.state
          : bucket.lifecycle.disable !== 'notCheck'),
        title: localize('DX3rd.SelfModifiers'),
        summary: localize('DX3rd.EffectModifierCount').replace('{count}', bucket.keys.length),
        target: 'self', editor: 'selfModifiers'
      });
    }
    for (const bucket of bucketsFor('target')) {
      pushBucketCard(bucket, {
        id: bucket.id, family: 'persistent', kind: 'targetModifiers',
        data: {...targetData, action: bucket.action, timing: bucket.lifecycle.runTiming},
        active: bucket.keys.length > 0 && bucket.lifecycle.disable !== 'notCheck',
        title: localize('DX3rd.TargetModifiers'),
        summary: localize('DX3rd.EffectModifierCount').replace('{count}', bucket.keys.length),
        target: targetForTargetModifiers(item, bucket.lifecycle.runTiming),
        editor: 'targetModifiers'
      });
    }
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
    const selfModifierCount = Object.keys(item.system?.attributes || {}).length;
    const targetModifierCount = Object.keys(item.system?.effect?.attributes || {}).length;
    const anySelfActive = persistent.some(card => card.kind === 'selfModifiers' && card.active);
    const modifierOverview = {
      id: 'modifiers',
      active: targetModifierCount > 0 || anySelfActive,
      selfActive: anySelfActive,
      toggleable: selfModifierCount > 0,
      selfCount: selfModifierCount,
      targetCount: targetModifierCount,
      totalCount: selfModifierCount + targetModifierCount,
      // 확장 도구의 채널 설정은 "기본 발현 액션"(명시가 없는 행이 상속하는 값)이다.
      // 기본 버킷 카드가 없을 수도 있으므로(모든 행을 명시 저작한 경우) 채널에서 직접 읽는다.
      selfAction: channelAction(item, 'self'),
      targetAction: channelAction(item, 'target'),
      initialScope: targetModifierCount > 0 && selfModifierCount === 0 ? 'modifiers.target' : 'modifiers.self',
      summary: `${localize('DX3rd.Self')} ${selfModifierCount} / ${localize('DX3rd.Target')} ${targetModifierCount}`
    };
    // 지속 효과 보정 카드는 축이 두 개다. 한 장에 묶여 있던 시절엔 둘 다 안 보였다:
    //  ① 적용 대상 — 자신(system.attributes) / 대상(system.effect.attributes). 데이터는 원래
    //     분리돼 있는데 카드가 하나라 "자신 N / 대상 M" 요약으로만 보였고, 소멸 타이밍·발현
    //     액션도 채널마다 따로인 것이 드러나지 않았다.
    //  ② 발현 액션 — 활성화 / 사용 시 / 공격 시. 채널당 하나로 묶여 있어, 보정을 몇 개
    //     추가하든 한 아이템의 지속 효과는 같은 시점에만 발현할 수 있었다. 이제 항목마다
    //     액션을 저작할 수 있고(확장 도구의 행별 「발현 액션」), 카드도 버킷마다 한 장이다.
    const isEquipment = EQUIPMENT_TYPES.includes(item.type);
    const actionOptions = [
      {value: 'activation', label: actionLabel('activation')},
      {value: 'use', label: actionLabel('use')},
      {value: 'attack', label: actionLabel('attack')}
    ];
    // 장비의 자기 보정도 세 갈래를 다 내준다. 「사용 시」(=선언)와 「공격 시」는 다른 것이고
    // (inferAction 의 ②/③), 「공격 시」로 옮기지 않는 한 선언형은 선언에서만 걸린다.
    const selfActionOptions = actionOptions;
    modifierOverview.selfActionOptions = selfActionOptions;
    modifierOverview.targetActionOptions = actionOptions;
    // 카드의 두 번째 축. 적용 대상(자신/대상)은 데이터 채널 그 자체이므로 카드에서 고른다 —
    // 편집 페인이나 행에 두면 카드 제목이 말하는 채널과 안쪽 값이 어긋날 수 있다.
    const channelOptions = [
      {value: 'self', label: localize('DX3rd.Self')},
      {value: 'target', label: localize('DX3rd.Target')}
    ];
    modifierOverview.channelOptions = channelOptions;
    // 버킷마다 한 장. 보정 행이 하나도 없는 채널의 자리표시 카드는 그리지 않는다
    // (collectPersistent 가 진입점 판정을 위해 남겨 둔 count:0 카드).
    const drawn = persistent
      .filter(card => ['selfModifiers', 'targetModifiers'].includes(card.kind) && card.count > 0);
    // 같은 채널의 카드가 두 장 이상이면 제목이 똑같아 구분이 안 된다 — 요약에 발현 액션을 적는다.
    const multiBucket = kind => drawn.filter(card => card.kind === kind).length > 1;
    const modifierCards = drawn
      .map(card => multiBucket(card.kind)
        ? {...card, summary: `${card.actionLabel} · ${card.summary}`}
        : card)
      .map(card => {
        // 버킷의 수명 필드는 그 버킷이 소유한다 — 기본 버킷은 채널의 평탄 필드,
        // 명시 버킷은 자기 buckets.<action> 경로. 확장 도구의 페인이 이 name 으로 직접 쓴다.
        const lifecycle = bucketLifecycle(item, card.kind === 'selfModifiers' ? 'self' : 'target', card.action);
        const bucketFields = {
          disableName: `${lifecycle.path}.disable`,
          runTimingName: `${lifecycle.path}.runTiming`,
          bucketPath: lifecycle.path,
          channel: card.kind === 'selfModifiers' ? 'self' : 'target',
          channelOptions,
          // 발현 타이밍은 대상 채널의 버킷만 자기 것을 가질 수 있다. 자기 채널의 발현은
          // active.state 플래그 하나라 버킷마다 다른 시점이 있을 수 없으므로, 명시 버킷
          // 페인에는 아예 내주지 않는다(읽는 곳이 없는 필드를 고르게 두면 안 걸리는 저작이 된다).
          showRunTiming: card.kind === 'targetModifiers' || lifecycle.isDefault,
          bucketLabel: `${localize(card.kind === 'selfModifiers' ? 'DX3rd.Self' : 'DX3rd.Target')} · ${card.actionLabel}`
        };
        if (card.kind === 'targetModifiers') {
          return {...card, ...bucketFields, editor: 'modifiers', toggleable: false, actionOptions};
        }
        // 켜고 끌 것이 있는 쪽은 활성화 버킷뿐이다. 동결 버킷(사용/공격 시)의 상태는 AE 에
        // 있고 active.state 는 쓰지 않는데도 체크박스를 내주면, 그걸 켠 아이템은 이중
        // 가산되거나(장비 자체계산 + 동결 AE) 발동 게이트에 걸려 사용해도 아무 일이 없었다.
        // 상시로 쓰고 싶으면 그 카드의 「발현 액션」을 '활성화'로 바꾸면 체크박스가 나타난다.
        return {
          ...card, ...bucketFields,
          editor: 'modifiers', toggleable: card.action === 'activation',
          actionOptions: selfActionOptions,
          // active(카드가 살아 있는가)는 여기서 손보지 않는다 — collectPersistent 가 버킷별로
          // 이미 판정한다. 시트에서만 덧칠했더니 같은 카드가 hasActionEffects 에는 죽은 것으로
          // 보여, 선언형 무기의 「사용」 진입점이 열리지 않았다.
          // 장비의 상시 버킷은 '활성화 시'가 아니라 장착이 상태의 원본이다.
          triggerLabel: isEquipment && card.action === 'activation'
            ? localize('DX3rd.EffectTriggerEquipped')
            : card.triggerLabel
        };
      });
    // 확장 도구는 카드(=버킷)마다 페인 한 장이다. 행이 없는 채널도 기본 버킷 페인은 남겨
    // 첫 보정을 넣을 자리를 준다. **행의 소속을 고르는 드롭다운은 없다** — 행은 자기가 추가된
    // 카드의 것이고, 카드의 두 축(적용 대상 · 발현 액션)은 시트 카드에서 고른다. 페인 안이나
    // 행마다 같은 축을 또 내주면 한 축을 세 군데서 고르게 되어 어느 값이 실제로 걸리는지
    // 알 수 없다(그 상태가 실제로 오작동을 냈다).
    const bucketPaneFor = (channel, action) => {
      const drawnCard = modifierCards.find(card =>
        (card.kind === 'selfModifiers' ? 'self' : 'target') === channel && card.action === action);
      if (drawnCard) return drawnCard;
      const lifecycle = bucketLifecycle(item, channel, action);
      return {
        id: bucketId(item, channel, action), kind: channel === 'self' ? 'selfModifiers' : 'targetModifiers',
        action, actionLabel: actionLabel(action), count: 0, deletable: false,
        disable: lifecycle.disable, runTiming: lifecycle.runTiming,
        disableName: `${lifecycle.path}.disable`, runTimingName: `${lifecycle.path}.runTiming`,
        bucketPath: lifecycle.path,
        showRunTiming: channel === 'target' || lifecycle.isDefault,
        bucketLabel: `${localize(channel === 'self' ? 'DX3rd.Self' : 'DX3rd.Target')} · ${actionLabel(action)}`
        // actionOptions 는 시트 카드만 쓴다 — 확장 도구 페인은 발현 액션을 고르지 않는다.
      };
    };
    const bucketPanes = [];
    for (const channel of ['self', 'target']) {
      const seen = new Set();
      for (const card of modifierCards.filter(card =>
        (card.kind === 'selfModifiers' ? 'self' : 'target') === channel)) {
        seen.add(card.action);
        bucketPanes.push({...card, isSelf: channel === 'self'});
      }
      const fallbackAction = channelAction(item, channel);
      if (!seen.has(fallbackAction)) {
        bucketPanes.push({...bucketPaneFor(channel, fallbackAction), isSelf: channel === 'self'});
      }
    }
    // 보정 행 목록. 행마다 소속 버킷을 들려 보낸다(계산·필터용이며, 고르는 UI 는 없다).
    const allRows = ['self', 'target'].flatMap(channel =>
      attributeEntries(attributeMap(item, channel)).map(([key, entry]) => ({
        key, attr: entry,
        pos: channel === 'self' ? 'main' : 'sub',
        path: channel === 'self' ? `system.attributes.${key}` : `system.effect.attributes.${key}`,
        bucket: bucketId(item, channel, attributeAction(item, channel, entry))
      })));
    // 그리고 **버킷마다 자기 행만** 들고 있어야 한다. 카드를 발현 액션별로 갈라 놓고 행 목록을
    // 한 벌 공유하면 「활성화」 카드를 열어도 「사용 시」 카드의 행이 그대로 실려, 카드를 나눈
    // 의미가 사라진다(어느 카드를 편집하는지도 알 수 없다). 행을 다른 카드로 옮기려면 그
    // 카드의 축(적용 대상/발현 액션)을 바꾸거나, 옮길 카드에서 다시 추가한다.
    modifierOverview.buckets = bucketPanes.map(pane =>
      ({...pane, rows: allRows.filter(row => row.bucket === pane.id)}));
    modifierOverview.rows = allRows;
    if (!bucketPanes.some(pane => pane.id === modifierOverview.initialScope)) {
      modifierOverview.initialScope = bucketPanes[0]?.id || 'modifiers.self';
    }
    const immediateAddOptions = DIRECT_TYPES.map(type => ({value: type, label: directTitle(type)}));
    // 지속 효과 보정 카드는 버킷 한 개다 — 추가하면 그 채널에서 아직 안 쓰는 발현 액션으로
    // 새 카드가 생긴다. 더 만들 발현 액션이 없을 때만 "추가됨"으로 비활성화한다.
    const addedLabel = localize('DX3rd.AlreadyAdded');
    const bucketSlotsLeft = freeBucketActions(item, 'self').length + freeBucketActions(item, 'target').length;
    const persistentAddOptions = [
      {value: 'modifiers', label: localize('DX3rd.PersistentModifiers'), disabled: bucketSlotsLeft === 0},
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

  /**
   * 대상 보정을 지금 발현 액션에서 걸어야 하는가.
   * 채널 기본이 다르더라도, 항목 하나라도 그 액션으로 **명시 저작**돼 있으면 통과시킨다 —
   * 그렇지 않으면 항목별 발현 액션을 저작해도 채널 게이트에서 통째로 막힌다.
   */
  function targetActionMatches(item, action, timing = 'instant') {
    if (extensionActionMatches(item, 'targetModifiers', item.system?.effect || {}, action, timing)) return true;
    const expected = normalizeAction(action) || eventAction(item, timing);
    return hasExplicitBucket(item, 'target', expected);
  }

  function macroActionMatches(item, macro, action, timing = 'instant') {
    return extensionActionMatches(item, 'macro', macro || {}, action, timing);
  }

  /** 액션과 무관하게 선택 대상이 필요한 활성 효과가 하나라도 있는가(콤보 멤버 사전 검사용). */
  function requiresAnyTarget(item) {
    return [...collectImmediate(item), ...collectPersistent(item)].some(card =>
      card.active && ['targetToken', 'damagedTargets'].includes(card.target));
  }

  function requiresTarget(item, action = invocationAction(item)) {
    const expected = normalizeAction(action) || invocationAction(item);
    const targetCards = collectPersistent(item).filter(card => card.kind === 'targetModifiers');
    if (targetCards.some(card => card.active && card.action === expected
      && ['targetToken', 'damagedTargets'].includes(card.target))) return true;
    return [...collectImmediate(item), ...collectPersistent(item)].some(card =>
      card.active && card.action === expected && ['targetToken', 'damagedTargets'].includes(card.target));
  }

  function hasActionEffects(item, action) {
    const expected = normalizeAction(action);
    if (!expected) return false;
    return [...collectImmediate(item), ...collectPersistent(item)]
      .some(card => card.active && card.action === expected);
  }

  /** 채널 자체의 발현 액션을 옮기는 갱신 데이터(기본 버킷을 옮길 때만 쓴다). */
  function channelActionUpdates(channel, action) {
    if (channel === 'self') {
      return {
        'system.active.action': action,
        'system.active.applyMode': action === 'activation' ? 'toggle' : 'onUse',
        ...(action === 'activation' ? {'system.active.runTiming': 'instant'} : {})
      };
    }
    return {
      'system.effect.action': action,
      ...(action === 'activation' ? {'system.effect.runTiming': 'instant'} : {})
    };
  }

  /**
   * 보정 버킷 하나의 발현 액션을 바꾼다.
   *  · 기본 버킷(id 에 @액션 이 없는 카드) — 채널 자체를 옮긴다(지금까지의 동작). 이 버킷에
   *    있던 명시 저작은 채널과 같은 값이었으므로 지워, 옮긴 채널을 함께 따라가게 한다.
   *  · 명시 버킷(id 가 modifiers.self@use 같은 카드) — 그 항목들만 옮긴다. 새 액션이 채널
   *    기본과 같아지면 명시를 지워 기본 버킷으로 합친다(카드가 두 장으로 갈라지지 않게).
   */
  /** 버킷 수명 오버라이드(buckets.<action>) 삭제 갱신. v13/v14 삭제 표기를 함께 지원한다. */
  function bucketOverrideDeletion(channel, action) {
    const root = channel === 'self' ? 'system.active' : 'system.effect';
    const ForcedDeletion = foundry.data?.operators?.ForcedDeletion;
    return ForcedDeletion
      ? {[`${root}.buckets`]: {[action]: new ForcedDeletion()}}
      : {[`${root}.buckets.-=${action}`]: null};
  }

  async function updateModifierBucketAction(item, id, action) {
    const {channel, isDefault} = parseBucketId(item, id);
    const [, bucketSuffix] = String(id).split('@');
    const path = channel === 'self' ? 'system.attributes' : 'system.effect.attributes';
    const root = channel === 'self' ? 'system.active' : 'system.effect';
    const explicitBucket = normalizeAction(bucketSuffix);
    const current = explicitBucket || channelAction(item, channel);
    if (current === action) return true;
    // 옮기기 전의 수명(발현·소멸 타이밍)을 새 자리로 들고 간다 — 발현 액션만 바꿨는데
    // 타이밍이 채널 기본으로 되돌아가면 카드가 조용히 다른 시점에 걸린다.
    const carried = bucketLifecycle(item, channel, current);

    const updates = {};
    const map = attributeMap(item, channel);
    if (explicitBucket && !isDefault) {
      const merged = channelAction(item, channel) === action;
      for (const [key, entry] of attributeEntries(map)) {
        if (explicitAction(item, channel, entry) !== explicitBucket) continue;
        updates[`${path}.${key}.action`] = merged ? '' : action;
      }
      if (!Object.keys(updates).length) return false;
      // 기본 버킷으로 합쳐지면 그 채널의 평탄 필드가 수명의 주인이 된다(오버라이드는 버린다).
      if (!merged) {
        updates[`${root}.buckets.${action}.disable`] = carried.disable;
        // 발현 타이밍을 버킷이 가질 수 있는 것은 대상 채널뿐이다 — 자기 채널의 발현은
        // active.state 플래그 하나로 표현되므로 버킷마다 다른 시점을 가질 수가 없다.
        if (channel === 'target' && action !== 'activation') {
          updates[`${root}.buckets.${action}.runTiming`] = carried.runTiming;
        }
      }
      await item.update(updates);
      if (carried.overridden) await item.update(bucketOverrideDeletion(channel, explicitBucket));
      return true;
    }

    Object.assign(updates, channelActionUpdates(channel, action));
    for (const [key, entry] of attributeEntries(map)) {
      if (explicitAction(item, channel, entry) === current) updates[`${path}.${key}.action`] = '';
    }
    await item.update(updates);
    // 옮겨 온 액션에 이미 명시 버킷이 있었다면 그것은 이제 기본 버킷이다 — 채널의 평탄 필드가
    // 수명의 주인이므로 오버라이드를 지운다(두 버킷이 한 카드로 합쳐진다).
    if ((item.system?.[channel === 'self' ? 'active' : 'effect']?.buckets || {})[action]) {
      await item.update(bucketOverrideDeletion(channel, action));
    }
    if (channel === 'self' && EQUIPMENT_TYPES.includes(item.type) && item.system?.equipment) {
      const shouldBeActive = usesActivationSelfChannel(item) && item.system?.active?.disable !== 'notCheck';
      if (item.system?.active?.state !== shouldBeActive) {
        await item.update({'system.active.state': shouldBeActive}, {dx3rdActivationFromEquipment: true});
      }
    }
    return true;
  }

  /**
   * 보정 카드의 적용 대상(채널)을 바꾼다 — 그 카드의 행 전부를 같은 발현 액션을 가진
   * 반대 채널의 버킷으로 옮긴다. 카드 = 버킷이므로 축을 바꾸면 카드 id 도 바뀐다
   * (호출부가 새 id 를 기억해야 펴 둔 페인이 유지된다).
   *
   * 수명은 들고 가지 않는다. 자기 보정(system.active.*)과 대상 보정(system.effect.*)은 수명
   * 필드가 애초에 다른 축이고, 목적지에서는 그 채널의 규칙(기본 버킷 = 평탄 필드, 명시 버킷 =
   * 채널 상속)이 주인이어야 한다 — 옮겨 온 값을 덮어쓰면 그 채널에 원래 있던 행의 수명까지
   * 같이 바뀐다.
   *
   * 목적지에 같은 발현 액션의 카드가 이미 있으면 두 카드는 **합쳐진다** — 같은 채널 × 같은
   * 액션은 정의상 한 버킷이다. 카드가 사라진 것처럼 보이므로 합쳐졌다는 사실을 반환값으로
   * 알려 호출부가 알릴 수 있게 한다.
   */
  async function updateModifierChannel(item, id, channel) {
    if (!item) return null;
    const to = channel === 'target' ? 'target' : 'self';
    const from = parseBucketId(item, id);
    if (!from || from.channel === to) return null;
    const action = from.action;
    const keys = attributeEntries(attributeMap(item, from.channel))
      .filter(([, entry]) => attributeAction(item, from.channel, entry) === action)
      .map(([key]) => key);
    if (!keys.length) return null;
    const toId = bucketId(item, to, action);
    const merged = attributeEntries(attributeMap(item, to))
      .some(([, entry]) => attributeAction(item, to, entry) === action);
    for (const key of keys) await moveModifierToBucket(item, key, id, toId);
    // 명시 버킷을 통째로 비웠으면 그 수명 오버라이드는 주인 없는 값이다.
    if (!from.isDefault) await item.update(bucketOverrideDeletion(from.channel, action));
    return {id: bucketId(item, to, action), merged};
  }

  async function updateAction(item, id, action) {
    action = normalizeAction(action);
    if (!item || !action) return false;
    if (String(id).startsWith('modifiers.self') || String(id).startsWith('modifiers.target')) {
      return updateModifierBucketAction(item, id, action);
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
    // 켜고 끄는 대상은 어느 버킷이든 자기 보정의 상태(system.active.state) 하나뿐이다.
    if (id === 'modifiers' || String(id).startsWith('modifiers.self')) {
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
    if (family === 'persistent' && kind === 'modifiers') {
      return addModifierBucket(item);
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

  /**
   * 지속 보정 버킷(=카드)을 새로 만든다. 채널에서 아직 안 쓰는 발현 액션 하나를 잡아 빈 보정
   * 한 줄을 그 액션으로 저작하고, 수명 필드를 채널 값에서 복사해 자기 것으로 갖게 한다.
   * 채널 기본 버킷이 아직 비어 있으면 새 버킷을 만들지 않고 그 자리에 줄을 넣는다 —
   * 첫 보정을 추가하는 흐름(지금까지의 동작)이 그대로 유지된다.
   */
  async function addModifierBucket(item, channel = null, action = null) {
    if (!item) return null;
    const channels = channel ? [channel] : ['self', 'target'];
    for (const chan of channels) {
      const path = chan === 'self' ? 'system.attributes' : 'system.effect.attributes';
      const existing = modifierBuckets(item).filter(bucket => bucket.channel === chan);
      const fallbackAction = channelAction(item, chan);
      const key = foundry.utils.randomID();
      // 기본 버킷이 비어 있으면 거기에 넣는다(action 미지정 = 채널 상속).
      if (!existing.some(bucket => bucket.action === fallbackAction)) {
        await item.update({[`${path}.${key}`]: {key: '-', label: '-', value: '', action: ''}});
        return bucketId(item, chan, fallbackAction);
      }
      const free = normalizeAction(action) ? [normalizeAction(action)] : freeBucketActions(item, chan);
      if (!free.length) continue;
      const next = free[0];
      const carried = bucketLifecycle(item, chan, fallbackAction);
      const root = chan === 'self' ? 'system.active' : 'system.effect';
      const updates = {[`${path}.${key}`]: {key: '-', label: '-', value: '', action: next}};
      updates[`${root}.buckets.${next}.disable`] = carried.disable;
      if (chan === 'target' && next !== 'activation') {
        updates[`${root}.buckets.${next}.runTiming`] = carried.runTiming;
      }
      await item.update(updates);
      return `${chan === 'self' ? 'modifiers.self' : 'modifiers.target'}@${next}`;
    }
    return null;
  }

  /** 명시 버킷 하나를 지운다(그 버킷의 보정 행 + 수명 오버라이드). 기본 버킷은 지울 수 없다. */
  async function deleteModifierBucket(item, id) {
    const {channel, isDefault, action} = parseBucketId(item, id);
    if (isDefault) return false;
    const path = channel === 'self' ? 'system.attributes' : 'system.effect.attributes';
    const keys = attributeEntries(attributeMap(item, channel))
      .filter(([, entry]) => explicitAction(item, channel, entry) === action)
      .map(([key]) => key);
    if (!keys.length) return false;
    const ForcedDeletion = foundry.data?.operators?.ForcedDeletion;
    const updates = ForcedDeletion
      ? {[path]: Object.fromEntries(keys.map(key => [key, new ForcedDeletion()]))}
      : Object.fromEntries(keys.map(key => [`${path}.-=${key}`, null]));
    await item.update(updates);
    await item.update(bucketOverrideDeletion(channel, action));
    return true;
  }

  async function deleteEffect(item, id) {
    if (!item || !id) return false;
    if (String(id).startsWith('modifiers.')) return deleteModifierBucket(item, id);
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

  /**
   * 보정 행을 자신↔대상 채널로 옮긴다.
   * @param {string} [action] 옮긴 자리에서 찍을 발현 액션('' = 채널 기본 상속).
   * @returns {Promise<string|false>} 옮긴 자리의 키(채널 안에서 키가 겹치면 새로 발급된다).
   */
  async function moveModifier(item, attributeKey, source, target, action = undefined) {
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
    const moved = foundry.utils.deepClone(attribute);
    if (action !== undefined) moved.action = normalizeAction(action) || '';
    const updates = {[`${targetParent}.${destinationKey}`]: moved};
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
    return destinationKey;
  }

  /**
   * 보정 행의 소속 버킷을 바꾼다(채널 이동 + 발현 액션 태깅을 한 번에).
   * 확장 도구의 행별 선택이 이것 하나만 부른다 — 자신/대상 드롭다운과 발현 액션 드롭다운을
   * 따로 두면 같은 행에 두 번 손대야 하고, 그 사이 상태가 어긋난 버킷이 생긴다.
   */
  async function moveModifierToBucket(item, attributeKey, fromId, toId) {
    if (!item || !attributeKey || String(fromId) === String(toId)) return false;
    const from = parseBucketId(item, fromId);
    const to = parseBucketId(item, toId);
    const tag = to.isDefault ? '' : to.action;
    if (from.channel !== to.channel) {
      return !!(await moveModifier(item, attributeKey,
        from.channel === 'self' ? 'main' : 'sub',
        to.channel === 'self' ? 'main' : 'sub', tag));
    }
    const path = to.channel === 'self' ? 'system.attributes' : 'system.effect.attributes';
    if (!attributeMap(item, to.channel)?.[attributeKey]) return false;
    await item.update({[`${path}.${attributeKey}.action`]: tag});
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
    const isEquipment = EQUIPMENT_TYPES.includes(item.type);
    // 장착 해제는 채널과 무관하게 끈다. actor.prepareData 의 activeItems 는 active.state 만
    // 보고 system.equipment 를 보지 않으므로, 선언(사용)으로 켜 둔 장비 보정이 벗은 뒤에도
    // 남으면 그대로 새어 나간다.
    if (isEquipment && equippedOff && item.system?.active?.state === true) {
      await item.update({'system.active.state': false}, {dx3rdActivationFromEquipment: true});
      return;
    }
    // 장착으로 켜는 것은 상시 채널(applyMode 'toggle')뿐이다 — 선언형(onUse)은
    // 사용 시점에 handleItemUse 가 켠다(inferAction 의 장비 분기 주석 참조).
    // 항목 하나만 「활성화」로 저작한 선언형 장비도 그 버킷을 위해 상태를 켜야 한다
    // (usesActivationSelfChannel 이 명시 버킷까지 본다).
    const equipmentSelfActivation = isEquipment
      && usesActivationSelfChannel(item)
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
    extensionActionMatches, targetActionMatches, macroActionMatches, requiresTarget, requiresAnyTarget, extensionEntries,
    hasActionEffects, updateAction, toggleEffect, addEffect, deleteEffect, moveModifier,
    directTitle, isConfiguredCondition,
    // 지속 효과 버킷(카드 = 채널 × 발현 액션, 카드마다 자기 발현·소멸 타이밍)
    channelAction, attributeAction, selfChannelIsToggle, appliesWhileActive, hasExplicitBucket,
    selfToggleBucketMatches,
    selfFrozenAttributes, hasFrozenSelfBucket, targetBucketAttributes, modifierBuckets, actionLabel,
    bucketLifecycle, targetFiresAt, bucketId, parseBucketId, freeBucketActions,
    addModifierBucket, deleteModifierBucket, moveModifierToBucket, updateModifierChannel
  };
})();
