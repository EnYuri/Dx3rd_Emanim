// 아이템 우클릭 컨텍스트 메뉴 (이전 시트/AppV2 액터 시트 공용)
// - '시트 열기'는 항상, '콤보로 조합'은 이펙트/무기 아이템에서만 노출.
// - Foundry ContextMenu의 버전 편차를 피하려 자체 경량 팝업으로 구현(네이티브 DOM, jQuery 미사용).
// - 다이얼로그(alert/confirm)를 띄우지 않는다.
(function() {
  // '콤보로 조합' 진입을 허용하는 아이템 타입. 무기는 weaponItem 경로, 이펙트는 preselect 경로로 빌더를 연다.
  const COMBO_SOURCE_TYPES = new Set(['effect', 'weapon']);

  let activeMenu = null;

  function closeMenu() {
    if (!activeMenu) return;
    activeMenu.remove();
    activeMenu = null;
    document.removeEventListener('mousedown', onOutside, true);
    document.removeEventListener('keydown', onKeydown, true);
    window.removeEventListener('blur', closeMenu, true);
    window.removeEventListener('resize', closeMenu, true);
  }

  function onOutside(event) {
    if (activeMenu && !activeMenu.contains(event.target)) closeMenu();
  }

  function onKeydown(event) {
    if (event.key === 'Escape') closeMenu();
  }

  // 콤보 빌더 실행 (이펙트 preselect / 무기 weaponItem 경로 분기)
  async function launchComboBuilder(actor, item) {
    const handler = window.DX3rdUniversalHandler;
    if (!handler?.openComboBuilder) {
      ui.notifications.error(game.i18n.localize('DX3rd.HandlerNotFound') || 'UniversalHandler를 찾을 수 없습니다.');
      return;
    }

    if (item.type === 'weapon') {
      // 무기에서 시작: 무기 슬롯에 자동 등록되고 type(melee/ranged)으로 공격판정 초기화.
      await handler.openComboBuilder(actor, 'skill', '-', item);
      return;
    }

    // 이펙트에서 시작: 해당 이펙트를 미리 선택하고 스킬/능력치/공격판정을 시드로 상속.
    const skill = item.system?.skill;
    const targetId = (skill && skill !== '-') ? skill : '-';
    await handler.openComboBuilder(actor, 'skill', targetId, null, {
      preselectEffectIds: [item.id]
    });
  }

  function buildEntries(actor, item, sheet) {
    const entries = [];

    // 시트 열기 (기존 우클릭 동작 보존)
    entries.push({
      icon: 'fas fa-edit',
      label: game.i18n.localize('DX3rd.Edit'),
      onClick: () => item.sheet?.render(true)
    });

    // 콤보로 조합 (캐릭터 액터의 이펙트/무기에서만)
    if (actor?.type === 'character' && COMBO_SOURCE_TYPES.has(item.type)) {
      entries.push({
        icon: 'fas fa-dice-d20',
        label: game.i18n.localize('DX3rd.CombineIntoCombo'),
        onClick: () => launchComboBuilder(actor, item)
      });
    }

    return entries;
  }

  function renderMenu(event, entries) {
    closeMenu();

    const menu = document.createElement('nav');
    menu.className = 'dx3rd-item-context-menu';
    // 최소한의 인라인 스타일(테마 훅은 클래스로 노출) — 별도 CSS 등록 없이 자립.
    Object.assign(menu.style, {
      position: 'fixed',
      zIndex: '10000',
      minWidth: '150px',
      padding: '4px 0',
      background: '#1b1d24',
      border: '1px solid #000',
      borderRadius: '4px',
      boxShadow: '0 4px 12px rgba(0,0,0,0.5)',
      color: '#f0f0e0',
      fontSize: '13px'
    });

    for (const entry of entries) {
      const el = document.createElement('div');
      el.className = 'dx3rd-item-context-entry';
      Object.assign(el.style, {
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        padding: '4px 12px',
        cursor: 'pointer',
        whiteSpace: 'nowrap'
      });
      el.addEventListener('mouseenter', () => { el.style.background = 'rgba(255,255,255,0.12)'; });
      el.addEventListener('mouseleave', () => { el.style.background = 'transparent'; });
      el.innerHTML = `<i class="${entry.icon}"></i><span>${entry.label}</span>`;
      el.addEventListener('click', async () => {
        closeMenu();
        try {
          await entry.onClick();
        } catch (e) {
          console.error('DX3rd | ItemContextMenu entry failed', e);
        }
      });
      menu.appendChild(el);
    }

    document.body.appendChild(menu);

    // 뷰포트 경계 보정
    const rect = menu.getBoundingClientRect();
    let x = event.clientX;
    let y = event.clientY;
    if (x + rect.width > window.innerWidth) x = Math.max(0, window.innerWidth - rect.width - 4);
    if (y + rect.height > window.innerHeight) y = Math.max(0, window.innerHeight - rect.height - 4);
    menu.style.left = `${x}px`;
    menu.style.top = `${y}px`;

    activeMenu = menu;
    document.addEventListener('mousedown', onOutside, true);
    document.addEventListener('keydown', onKeydown, true);
    window.addEventListener('blur', closeMenu, true);
    window.addEventListener('resize', closeMenu, true);
  }

  // 공개 API: 시트의 우클릭 핸들러에서 호출.
  function open(event, { actor, item, sheet } = {}) {
    if (!actor || !item) return;
    const entries = buildEntries(actor, item, sheet);
    if (!entries.length) return;
    renderMenu(event, entries);
  }

  window.DX3rdItemContextMenu = { open, close: closeMenu };
})();
