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
 *  1) **버튼(즉시 선언)이지 체크박스가 아니다.** 누르면 그 자리에서 handleItemUse(action:'use') 가
 *     돌아 회수·침식이 정산되고 자기 보정 AE 가 붙는다. 룰상 선언은 되돌릴 수 없고, 무엇보다
 *     계산 경로가 실제 파이프라인 하나뿐이라 이중 가산이 생길 여지가 없다. 표시 수치를
 *     다이얼로그가 직접 더하는 방식이면 actor.prepareData 와 어긋날 자리가 생긴다.
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
    stat_dice: 'DX3rd.StatDice', stat_add: 'DX3rd.StatAdd',
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

  const attributeEntries = attributes => Object.values(attributes || {})
    .filter(entry => entry?.key && entry.key !== '-');

  /** 아이템 하나가 선언형 장비인가(장착 중 · 동결 채널 · 자기 보정 있음). */
  function isDeclarable(item) {
    if (!item || !EQUIPMENT_TYPES.includes(item.type)) return false;
    if (item.system?.equipment !== true) return false;
    if ((item.system?.active?.disable ?? '-') === 'notCheck') return false;
    if (!attributeEntries(item.system?.attributes).length) return false;
    // 활성화 채널(「장비하고 있는 동안 …」)은 장착이 상태의 원본이라 선언이라는 개념이 없다.
    const adapter = window.DX3rdItemEffectAdapter;
    return adapter ? !adapter.usesActivationSelfChannel(item) : (item.system?.active?.applyMode === 'onUse');
  }

  /**
   * 사용 횟수가 남았는가.
   * 기준은 handleItemUse 가 실제로 세는 것과 같아야 한다 — 그쪽은 used.disable 이 'notCheck'
   * 가 아닐 때만 used.state 를 올린다. 그리고 helpers 의 isItemExhausted 와 마찬가지로
   * **max 가 0이면 무제한이 아니라 소진**이다(횟수 체크를 켜 두고 상한을 안 적은 것).
   * 여기가 유일한 게이트다 — handleItemUse 는 소진을 막지 않고 증가만 시킨다.
   */
  function usesLeft(item) {
    const used = item.system?.used || {};
    if ((used.disable || 'notCheck') === 'notCheck') return { limited: false, left: Infinity, state: 0, max: 0 };
    const max = Number(used.max) || 0;
    const state = Number(used.state) || 0;
    return { limited: true, left: Math.max(0, max - state), state, max };
  }

  /** 이번에 이미 선언해 자기 보정 AE 가 붙어 있는가. */
  function alreadyDeclared(actor, item) {
    const key = `applied_self_${item.id}`;
    return (actor?.effects || []).some(effect => effect.getFlag?.(SCOPE, 'appliedKey') === key);
  }

  function summarize(item, keys) {
    return attributeEntries(item.system.attributes)
      .filter(entry => !keys || keys.has(entry.key))
      .map(entry => {
        const label = KEY_LABELS[entry.key] ? localize(KEY_LABELS[entry.key]) : entry.key;
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
    const keys = CONTEXT_KEYS[context];
    if (!actor || !keys) return [];
    // 남의 액터에는 선언 버튼을 내주지 않는다 — handleItemUse 가 아이템을 갱신하므로
    // 소유권이 없으면 눌러도 실패한다(방어 다이얼로그는 GM 화면에도 뜰 수 있다).
    if (actor.isOwner === false) return [];
    return (actor.items || [])
      .filter(item => isDeclarable(item)
        && attributeEntries(item.system.attributes).some(entry => keys.has(entry.key))
        && !alreadyDeclared(actor, item)
        && usesLeft(item).left > 0)
      .map(item => {
        const uses = usesLeft(item);
        return {
          id: item.id, name: item.name, img: item.img,
          summary: summarize(item, keys),
          limited: uses.limited, left: uses.left, max: uses.max
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
      const count = entry.limited
        ? `<span class="dx3rd-declare-uses">${game.i18n.format('DX3rd.DeclareUsesLeft', {count: entry.left})}</span>`
        : '';
      return `<button type="button" class="dx3rd-declare-button" data-item-id="${escapeHtml(entry.id)}">
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
   * 버튼 배선. 클릭 = 즉시 선언(되돌릴 수 없음).
   * @param {HTMLElement} root  섹션을 포함하는 DOM
   * @param {Actor} actor
   * @param {Function} [onDeclared]  선언이 끝난 뒤 호출(표시 수치 갱신용). item 을 받는다.
   */
  function bind(root, actor, onDeclared) {
    if (!root || !actor) return;
    for (const button of root.querySelectorAll('.dx3rd-declare-button')) {
      button.addEventListener('click', async event => {
        event.preventDefault();
        event.stopPropagation();
        if (button.disabled) return;
        const item = actor.items.get(button.dataset.itemId);
        if (!item) return;
        // 연타로 두 번 소모되는 것을 막는다 — handleItemUse 는 await 사이에 재진입할 수 있다.
        button.disabled = true;
        try {
          // getTarget=false: 자기 보정이라 타겟이 필요 없다(요구하면 여기서 막힌다).
          // comboMode='normal': 무기의 공격/콤보 선택 메뉴를 건너뛴다.
          const used = await window.DX3rdUniversalHandler?.handleItemUse(
            actor.id, item.id, item.type, undefined, false, {action: 'use', comboMode: 'normal'});
          if (used === false) { button.disabled = false; return; }
          button.classList.add('declared');
          button.querySelector('.dx3rd-declare-uses')?.remove();
          const summary = button.querySelector('.dx3rd-declare-summary');
          if (summary) summary.textContent = localize('DX3rd.Declared');
          await onDeclared?.(item);
        } catch (error) {
          console.error('DX3rd | 장비 선언 실패:', item?.name, error);
          ui.notifications.error(`${item?.name}: ${localize('DX3rd.Unable')}`);
          button.disabled = false;
        }
      });
    }
  }

  window.DX3rdDeclaredEquipment = {
    CONTEXT_KEYS, isDeclarable, collect, sectionHtml, bind
  };
})();
