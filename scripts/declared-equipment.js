/**
 * 선언형 장비(applyMode='onUse') 를 판정·데미지·방어 다이얼로그 안에서 바로 선언하게 해 주는 공용 부품.
 *
 * 왜 필요한가: 「이 무기에 의한 사격공격의 명중판정을 실행하기 직전에 선언할 것」(로켓 런처) 같은
 * 장비는 발동점이 공격이 아니라 선언이라 시트에서 이름 클릭 → 「사용」을 먼저 눌러야 했다.
 * 콤보로 공격하는 흐름에서 완전히 벗어나 있어서, 실제로는 아무도 쓰지 않는 기능이 된다.
 * 콤보 경로는 등록된 무기의 attack-used 만 올릴 뿐 handleItemUse 를 부르지 않으므로
 * (combo-handler.js), 콤보에 무기를 넣는 것만으로는 이 보정이 절대 붙지 않는다.
 *
 * 설계 두 가지:
 *  1) **토글이고, 실제 사용은 판정을 확정할 때 일어난다.** 누르는 즉시 handleItemUse 를 돌리면
 *     창을 닫기만 해도 회수·침식이 날아간다 — 굴리지 않은 판정에 값을 치르는 셈이라 곤란하다.
 *     그래서 토글은 「이번 판정에 쓰겠다」는 표시만 남기고, 굴림 버튼이 commit() 을 부르는
 *     시점에 비로소 handleItemUse(action:'use') 가 돌아 회수·침식이 정산되고 AE 가 붙는다.
 *     계산 경로는 여전히 실제 파이프라인 하나뿐이라 이중 가산이 생길 자리가 없다 — 표시 수치를
 *     다이얼로그가 직접 더하면 actor.prepareData 와 어긋나므로 그 방식은 쓰지 않는다.
 *     대신 commit() 이 끝난 뒤 호출측이 판정치를 다시 읽어 표시와 굴림에 반영한다.
 *  2) **문맥별로 나눠 보여준다.** 명중 보정과 관통은 필요한 시점이 다르므로, 지금 이 창에서
 *     의미 있는 항목만 낸다. 아무것도 없으면 섹션 자체를 그리지 않는다.
 */
(function() {
  const SCOPE = 'dx3rd-emanim';
  const EQUIPMENT_TYPES = ['weapon', 'protect', 'vehicle'];

  const localize = key => game.i18n?.localize?.(key) ?? key;

  // 보정 키 → 표시 라벨. 여기 없는 키는 원문 그대로 보여준다(저작 오류를 숨기지 않기 위해).
  const KEY_LABELS = {
    dice: 'DX3rd.Dice', add: 'DX3rd.Add', critical: 'DX3rd.Critical', critical_min: 'DX3rd.CriticalMin',
    stat_dice: 'DX3rd.StatDice', stat_add: 'DX3rd.StatAdd', effect_level: 'DX3rd.EffectLevelBonus',
    major_dice: 'DX3rd.MajorDice', major_add: 'DX3rd.MajorAdd', major_critical: 'DX3rd.Critical',
    reaction_dice: 'DX3rd.ReactionDice', reaction_add: 'DX3rd.ReactionAdd',
    dodge_dice: 'DX3rd.DodgeDice', dodge_add: 'DX3rd.DodgeAdd',
    attack: 'DX3rd.Attack', damage_roll: 'DX3rd.DamageRoll', penetrate: 'DX3rd.Penetrate',
    guard: 'DX3rd.Guard', guard_roll: 'DX3rd.GuardRoll',
    armor: 'DX3rd.Armor', reduce: 'DX3rd.Reduce', reduce_roll: 'DX3rd.ReduceRoll',
    battleMove: 'DX3rd.BattleMove', init: 'DX3rd.Init'
  };

  const ROLL_KEYS = ['dice', 'add', 'critical', 'critical_min', 'stat_dice', 'stat_add',
    'major_dice', 'major_add', 'major_critical',
    'reaction_dice', 'reaction_add', 'reaction_critical',
    'dodge_dice', 'dodge_add', 'dodge_critical'];
  const DAMAGE_KEYS = ['attack', 'damage_roll', 'penetrate'];

  /**
   * 문맥별로 「지금 이 창에서 의미 있는」 보정 키.
   * 아무 장비나 늘어놓으면 지금 고를 수 없는 버튼만 늘어난다.
   * 닷지/리액션 다이스는 방어 다이얼로그가 아니라 그 뒤 판정 창에서 굴리므로 roll 쪽이다.
   *
   * 공격력·데미지 롤·장갑무시는 데미지 산출 창이 아니라 **명중판정 창**('attack')에 낸다.
   * 룰이 「이 무기에 의한 사격공격의 명중판정을 실행하기 직전에 선언할 것」(로켓 런처)이라,
   * 맞은 걸 보고 나서 고르게 하면 빗나갔을 때 회수를 아끼는 자리가 생긴다 — 이 계열은
   * 대부분 사용 횟수 제한이 있어서 그 차이가 그대로 이득이 된다.
   * 굴림보다 앞서 선언하면 그 보정은 actorAttack/actorPenetrate 산출에 자연히 들어가므로,
   * 데미지 창 쪽에서 표시 수치를 따로 손볼 일도 없어진다.
   */
  const CONTEXT_KEYS = {
    roll: new Set(ROLL_KEYS),
    attack: new Set([...ROLL_KEYS, ...DAMAGE_KEYS]),
    defense: new Set(['guard', 'guard_roll', 'armor', 'reduce', 'reduce_roll'])
  };

  /**
   * 대상 채널 보정 중 이 창에서 의미가 있는 키 — **그 공격에 대한 방어측 판정**을 깎는 것뿐.
   *
   * 자기 채널과 같은 목록을 쓰면 안 된다. 「당신 이외의 캐릭터가 판정을 실행하기 직전에
   * 선언하여 그 판정에 다이스 +3」(커맨드 모빌) 같은 **남을 돕는** 대상 보정까지 명중판정
   * 창에 올라오는데, 그건 내 공격의 상대에게 걸어 봐야 뜻이 반대가 된다. 선언자가 굴리는
   * 판정의 상대가 받는 것 = 리액션·닷지·가드·장갑 계열만 남긴다.
   */
  const TARGET_CONTEXT_KEYS = {
    attack: new Set(['reaction_dice', 'reaction_add', 'reaction_critical',
      'dodge_dice', 'dodge_add', 'dodge_critical',
      'guard', 'guard_roll', 'armor', 'reduce', 'reduce_roll'])
  };

  const attributeEntries = attributes => Object.values(attributes || {})
    .filter(entry => entry?.key && entry.key !== '-');

  /**
   * 선언(action:'use')으로 걸리는 자기 보정만. 「장비하고 있는 동안 …」(활성화 버킷)은
   * 장착이 상태의 원본이라 선언이라는 개념이 없으므로 제외된다. 한 장비가 두 버킷을
   * 동시에 가질 수 있으므로(항목별 발현 액션) 판정·요약 모두 이 목록을 써야 한다.
   */
  function declaredAttributes(item) {
    const adapter = window.DX3rdItemEffectAdapter;
    if (adapter) return adapter.selfFrozenAttributes(item, 'use');
    return (item?.system?.active?.applyMode === 'onUse') ? (item?.system?.attributes || {}) : {};
  }

  /**
   * 선언으로 **대상에게** 걸리는 보정(대상 채널의 'use' 버킷).
   *
   * 선언형 장비에는 자기 보정이 아니라 상대를 깎는 것도 있다 — 폴른 피스톨의 「그 공격에
   * 대한 리액션의 크리티컬치 +1」, 발리스틱 나이프의 「그 공격에 대한 닷지에 다이스 -4」.
   * 이 계열은 자기 채널이 비어 있어서 예전에는 선언 목록에 아예 뜨지 않았고, 그래서 대상
   * 채널의 기본 액션 폴백(공격 아이템 → 'attack')대로 **공격할 때마다 자동으로** 붙었다.
   * 회수 제한이 있는 것(폴른 피스톨: 시나리오 3회)조차 값을 치르지 않았다.
   *
   * 적용 경로는 이미 있다 — commit() → handleItemUse(action:'use') →
   * universal-handler 의 applyToTargets(actor, item, 'instant', null, 'use') 가
   * targetBucketAttributes 로 이 버킷을 그대로 집어 game.user.targets 에 건다.
   * 빠져 있던 것은 「선언 목록에 넣을 자격」 판정뿐이라 여기서 자기 보정과 합친다.
   */
  function declaredTargetAttributes(item) {
    const adapter = window.DX3rdItemEffectAdapter;
    if (!adapter) return {};
    // 채널 기본이 'use' 인 것과 행에 'use' 를 명시 저작한 것 양쪽을 집는다 —
    // 이 함수가 채널 기본만 보면 「풀 오토 샷 건」처럼 행 단위로 나눈 저작이 빠진다.
    const attributes = adapter.targetBucketAttributes(item, 'use', 'instant');
    if (!attributeEntries(attributes).length) return {};
    const lifecycle = adapter.bucketLifecycle(item, 'target', 'use');
    if (lifecycle.disable === 'notCheck') return {};
    if (lifecycle.runTiming !== '-' && lifecycle.runTiming !== 'instant') return {};
    return attributes;
  }

  /** 선언 시 걸릴 보정 전부. 채널을 달고 다니는 이유는 요약 문구를 나누기 위해서다. */
  function declaredEntries(item) {
    const self = attributeEntries(declaredAttributes(item)).map(entry => ({entry, channel: 'self'}));
    const target = attributeEntries(declaredTargetAttributes(item)).map(entry => ({entry, channel: 'target'}));
    return [...self, ...target];
  }

  /** 아이템 하나가 선언형 장비인가(장착 중 · 선언 버킷에 걸 보정 있음). */
  function isDeclarable(item) {
    if (!item || !EQUIPMENT_TYPES.includes(item.type)) return false;
    if (item.system?.equipment !== true) return false;
    const entries = declaredEntries(item);
    if (!entries.length) return false;
    // active.disable='notCheck' 는 **자기 채널**을 쓰지 않겠다는 표시다. 대상 보정을 거는
    // 선언은 그 필드와 무관하므로(수명은 system.effect 쪽이다) 제외 근거가 되지 않는다.
    if ((item.system?.active?.disable ?? '-') === 'notCheck') {
      return entries.some(({channel}) => channel === 'target');
    }
    return true;
  }

  /**
   * 사용 횟수가 남았는가.
   * 기준은 handleItemUse 가 실제로 세는 것과 같아야 한다 — 그쪽은 used.disable 이 'notCheck'
   * 가 아닐 때만 used.state 를 올린다. 그리고 helpers 의 isItemExhausted 와 마찬가지로
   * **max 가 0이면 무제한이 아니라 소진**이다(횟수 체크를 켜 두고 상한을 안 적은 것).
   * 소진돼도 목록에서 지울지는 월드 설정(allowExhaustedUse)이 정한다 — 지우지 않을 때도
   * 잔여 회수 표시는 그대로 두어, 「0회 남음」을 보고 누르는 것이 되게 한다.
   */
  function usesLeft(item) {
    const used = item.system?.used || {};
    if ((used.disable || 'notCheck') === 'notCheck') return { limited: false, left: Infinity, state: 0, max: 0 };
    const max = Number(used.max) || 0;
    const state = Number(used.state) || 0;
    return { limited: true, left: Math.max(0, max - state), state, max };
  }

  /**
   * 이번에 이미 선언해 자기 보정 AE 가 붙어 있는가.
   *
   * 자기 보정이 없는(대상 채널 전용) 장비에는 이 자물쇠가 없다 — 걸리는 AE 가 상대에게
   * 붙으므로 `applied_self_*` 는 영영 생기지 않아 판정 근거가 되지 못한다. 그리고 그쪽은
   * 판정마다 다시 선언하는 것이 원문이고(「명중판정을 실행하기 직전에 선언할 것」),
   * 회수도 그때마다 정산되므로 중복 방지는 창 안의 버튼 잠금으로 충분하다.
   */
  function alreadyDeclared(actor, item) {
    if (!attributeEntries(declaredAttributes(item)).length) return false;
    const key = `applied_self_${item.id}`;
    return (actor?.effects || []).some(effect => effect.getFlag?.(SCOPE, 'appliedKey') === key);
  }

  /** 이 문맥에서 낼 항목인가. 채널마다 의미 있는 키가 다르다. */
  function entryInContext({entry, channel}, context) {
    if (!context) return true;
    const keys = channel === 'target' ? TARGET_CONTEXT_KEYS[context] : CONTEXT_KEYS[context];
    return !!keys?.has(entry.key);
  }

  function summarize(item, context) {
    const targetPrefix = localize('DX3rd.Target');
    return declaredEntries(item)
      .filter(candidate => entryInContext(candidate, context))
      .map(({entry, channel}) => {
        const name = KEY_LABELS[entry.key] ? localize(KEY_LABELS[entry.key]) : entry.key;
        // 대상에게 걸리는 것은 같은 키라도 의미가 반대라, 붙이지 않으면 자기 강화로 읽힌다.
        const label = channel === 'target' ? `${targetPrefix} ${name}` : name;
        const value = String(entry.value ?? '').trim();
        return value ? `${label} ${value}` : label;
      })
      .join(', ');
  }

  /**
   * 지금 선언할 수 있는 장비 목록.
   * @param {Actor} actor
   * @param {'roll'|'damage'|'defense'} context
   */
  function collect(actor, context) {
    if (!actor || !CONTEXT_KEYS[context]) return [];
    // 남의 액터에는 선언 버튼을 내주지 않는다 — handleItemUse 가 아이템을 갱신하므로
    // 소유권이 없으면 눌러도 실패한다(방어 다이얼로그는 GM 화면에도 뜰 수 있다).
    if (actor.isOwner === false) return [];
    const allowExhausted = window.DX3rdItemExhausted?.allowExhaustedUse?.() !== false;
    return (actor.items || [])
      .filter(item => isDeclarable(item)
        && declaredEntries(item).some(candidate => entryInContext(candidate, context))
        && !alreadyDeclared(actor, item)
        && (allowExhausted || usesLeft(item).left > 0))
      .map(item => {
        const uses = usesLeft(item);
        return {
          id: item.id, name: item.name, img: item.img,
          summary: summarize(item, context),
          limited: uses.limited, left: uses.left, max: uses.max,
          exhausted: uses.limited && uses.left <= 0
        };
      });
  }

  const escapeHtml = text => String(text ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  /**
   * 섹션 HTML. 후보가 없으면 빈 문자열 — 호출측이 조건 분기를 다시 쓰지 않아도 되도록.
   * 템플릿 문자열로 조립하는 판정 창과 Handlebars 로 렌더한 창 양쪽에 같은 마크업을 쓴다.
   */
  function sectionHtml(entries) {
    if (!entries.length) return '';
    const rows = entries.map(entry => {
      // 소진된 것도(설정이 허용하면) 목록에 남는다. 「소진」을 붙여 두어, 눌러도 되지만
      // 원래는 못 쓰는 것이라는 사실이 버튼 위에서 바로 보이게 한다.
      const count = entry.exhausted
        ? `<span class="dx3rd-declare-uses is-exhausted">${localize('DX3rd.Exhausted')}</span>`
        : (entry.limited
          ? `<span class="dx3rd-declare-uses">${game.i18n.format('DX3rd.DeclareUsesLeft', {count: entry.left})}</span>`
          : '');
      return `<button type="button" class="dx3rd-declare-button${entry.exhausted ? ' is-exhausted' : ''}" aria-pressed="false" data-item-id="${escapeHtml(entry.id)}">
        <span class="dx3rd-declare-name">${escapeHtml(entry.name)}</span>
        <span class="dx3rd-declare-summary">${escapeHtml(entry.summary)}</span>
        ${count}
      </button>`;
    }).join('');
    return `<div class="dx3rd-declare-section">
      <div class="dx3rd-declare-title">${localize('DX3rd.DeclarableEquipment')}</div>
      <div class="dx3rd-declare-list">${rows}</div>
    </div>`;
  }

  /**
   * 토글 배선. 클릭은 선택/해제만 하고, 실제 사용은 commit() 에서 일어난다.
   * @param {HTMLElement} root  섹션을 포함하는 DOM
   * @param {Actor} actor
   * @param {Function} [onToggle]  선택이 바뀔 때마다 호출(선택된 item 배열을 받는다).
   * @returns {{selected: Function, commit: Function, hasPending: Function}}
   *   commit() 은 선택된 항목을 차례로 실제 사용하고, 사용에 성공한 item 배열을 돌려준다.
   *   판정을 굴리지 않고 창을 닫으면 commit() 이 불리지 않으므로 아무것도 소모되지 않는다.
   */
  function bind(root, actor, onToggle) {
    const chosen = new Map();
    const noop = { selected: () => [], commit: async () => [], hasPending: () => false };
    if (!root || !actor) return noop;

    const buttons = Array.from(root.querySelectorAll('.dx3rd-declare-button'));
    if (!buttons.length) return noop;

    for (const button of buttons) {
      button.addEventListener('click', event => {
        event.preventDefault();
        event.stopPropagation();
        // commit 이 끝난 버튼은 잠긴다 — 같은 판정에서 두 번 소모되지 않도록.
        if (button.disabled) return;
        const item = actor.items.get(button.dataset.itemId);
        if (!item) return;
        const on = !chosen.has(item.id);
        if (on) chosen.set(item.id, item);
        else chosen.delete(item.id);
        button.classList.toggle('selected', on);
        button.setAttribute('aria-pressed', String(on));
        onToggle?.(Array.from(chosen.values()));
      });
    }

    /**
     * 선택한 장비를 실제로 사용한다. 판정 확정 시점에 한 번만 부른다.
     * 한 항목이 실패해도 나머지는 계속 시도한다 — 이미 값을 치른 항목을 되돌릴 수는 없으므로,
     * 중간에 멈추면 "일부만 적용된" 상태가 조용히 남는다. 실패는 개별로 알린다.
     */
    async function commit() {
      const applied = [];
      for (const [id, item] of chosen) {
        const button = buttons.find(b => b.dataset.itemId === id);
        if (button) button.disabled = true;
        try {
          // 자기 보정만 거는 것은 타겟이 필요 없다(요구하면 여기서 막힌다). 대상 보정을
          // 거는 것은 반대로 **요구해야** 한다 — 타겟 없이 통과시키면 아무 데도 걸리지
          // 않은 채 회수·침식만 빠져나간다(폴른 피스톨은 시나리오 3회뿐이다).
          const needsTarget = declaredEntries(item).some(({channel}) => channel === 'target');
          // comboMode='normal': 무기의 공격/콤보 선택 메뉴를 건너뛴다.
          const used = await window.DX3rdUniversalHandler?.handleItemUse(
            actor.id, item.id, item.type, undefined, needsTarget, {action: 'use', comboMode: 'normal'});
          if (used === false) {
            if (button) { button.disabled = false; button.classList.remove('selected'); button.setAttribute('aria-pressed', 'false'); }
            continue;
          }
          applied.push(item);
          if (button) {
            button.classList.add('declared');
            button.querySelector('.dx3rd-declare-uses')?.remove();
            const summary = button.querySelector('.dx3rd-declare-summary');
            if (summary) summary.textContent = localize('DX3rd.Declared');
          }
        } catch (error) {
          console.error('DX3rd | 장비 선언 실패:', item?.name, error);
          ui.notifications.error(`${item?.name}: ${localize('DX3rd.Unable')}`);
          if (button) { button.disabled = false; button.classList.remove('selected'); button.setAttribute('aria-pressed', 'false'); }
        }
      }
      chosen.clear();
      return applied;
    }

    return {
      selected: () => Array.from(chosen.values()),
      hasPending: () => chosen.size > 0,
      commit
    };
  }

  window.DX3rdDeclaredEquipment = {
    CONTEXT_KEYS, TARGET_CONTEXT_KEYS, isDeclarable, collect, sectionHtml, bind
  };
})();
