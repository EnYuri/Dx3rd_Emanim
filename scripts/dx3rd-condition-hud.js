// DX3rd Condition HUD - 선택된 토큰의 활성 상태이상 아이콘을 화면 우상단(사이드바 근처)에 표시
// dnd5e 처럼, 토큰을 선택하면 그 액터의 활성 컨디션 아이콘이 화면 우상단에 나열된다.
(function () {

  const MODULE_ID = 'dx3rd-emanim';
  const HUD_ID = 'dx3rd-condition-hud';

  // 아이콘/라벨을 가진 컨디션 목록 (system.conditions 키 → CONFIG.statusEffects 아이디)
  // defeated 는 status "dead" 아이콘을 사용한다.
  const CONDITION_META = {
    poisoned: { status: 'poisoned', i18n: 'DX3rd.Poisoned' },
    hatred:   { status: 'hatred',   i18n: 'DX3rd.Hatred' },
    fear:     { status: 'fear',     i18n: 'DX3rd.Fear' },
    berserk:  { status: 'berserk',  i18n: 'DX3rd.Berserk' },
    rigor:    { status: 'rigor',    i18n: 'DX3rd.Rigor' },
    pressure: { status: 'pressure', i18n: 'DX3rd.Pressure' },
    dazed:    { status: 'dazed',    i18n: 'DX3rd.Dazed' },
    boarding: { status: 'boarding', i18n: 'DX3rd.Boarding' },
    stealth:  { status: 'stealth',  i18n: 'DX3rd.Stealth' },
    fly:      { status: 'fly',      i18n: 'DX3rd.Fly' },
    defeated: { status: 'dead',     i18n: 'DX3rd.Defeated' }
  };

  let hudEl = null;
  let currentActorId = null;

  /** CONFIG.statusEffects 에서 아이콘 경로를 찾는다. */
  function getStatusImg(statusId) {
    const s = (CONFIG.statusEffects || []).find(e => e.id === statusId);
    return s?.img || s?.icon || 'icons/svg/aura.svg';
  }

  /** HUD 요소 생성(최초 1회). */
  function ensureHud() {
    if (hudEl && document.body.contains(hudEl)) return hudEl;
    hudEl = document.createElement('div');
    hudEl.id = HUD_ID;
    hudEl.style.display = 'none';
    // dnd5e 식 상호작용(위임 리스너, 재렌더에도 유지):
    //  · 우클릭(contextmenu) → 편집기
    //  · 더블클릭(dblclick) → 활성/비활성 토글
    hudEl.addEventListener('contextmenu', onHudContextMenu);
    hudEl.addEventListener('dblclick', onHudDblClick);
    document.body.appendChild(hudEl);
    return hudEl;
  }

  /** 우클릭: 커스텀 applied → 편집기(내장 컨디션은 대상 아님). */
  function onHudContextMenu(event) {
    const appliedIcon = event.target.closest('.dx3rd-applied-hud-icon[data-applied-key]');
    if (!appliedIcon) return;
    event.preventDefault();
    const actor = getTargetToken()?.actor;
    if (!actor) return;
    const key = appliedIcon.dataset.appliedKey;
    if (window.DX3rdActorAppliedDialogs?.edit) window.DX3rdActorAppliedDialogs.edit(actor, key);
  }

  /** 더블클릭: 커스텀 applied → 활성/비활성 토글. */
  function onHudDblClick(event) {
    const appliedIcon = event.target.closest('.dx3rd-applied-hud-icon[data-applied-key]');
    if (!appliedIcon) return;
    event.preventDefault();
    const actor = getTargetToken()?.actor;
    if (!actor) return;
    const key = appliedIcon.dataset.appliedKey;
    // 단일 소스 라우팅: toggle 파생은 아이템 토글, 그 외는 AE.disabled.
    if (window.DX3rdAppliedEffects?.toggleActive) window.DX3rdAppliedEffects.toggleActive(actor, key);
  }

  /**
   * 액터의 커스텀 applied ActiveEffect 목록을 [{key, name, img, disable}] 로 반환.
   * 스크린 HUD 는 토큰 오버레이와 구별된다 — per-effect showOnScreen(기본 ON)이 꺼진 것만 제외.
   */
  function getAppliedEffects(actor) {
    const result = [];
    for (const eff of (actor?.effects || [])) {
      const key = eff.getFlag?.(MODULE_ID, 'appliedKey');
      if (!key) continue;
      const payload = eff.getFlag?.(MODULE_ID, 'applied') || {};
      if (payload.showOnScreen === false) continue; // 화면 표시 OFF 인 효과만 제외(기본 ON)
      result.push({
        key,
        name: eff.name || payload.name || game.i18n.localize('DX3rd.Applied'),
        img: eff.img || payload.img || 'icons/svg/aura.svg',
        disable: payload.disable || '-',
        disabled: !!eff.disabled
      });
    }
    return result;
  }

  /** 사이드바 폭을 고려해 우측 오프셋을 갱신한다. */
  function updatePosition() {
    if (!hudEl) return;
    const sidebar = document.getElementById('sidebar') || document.getElementById('ui-right');
    let offset = 320;
    if (sidebar) {
      const rect = sidebar.getBoundingClientRect();
      // 사이드바가 화면 우측에 붙어있는 경우 그 폭 + 여백만큼 왼쪽으로 이동
      offset = Math.max(0, window.innerWidth - rect.left) + 12;
    }
    hudEl.style.right = `${offset}px`;
  }

  // 사이드바 접힘/펼침은 CSS 트랜지션이라, 훅 직후 1회 측정하면 애니메이션 중간값을 읽어
  // HUD 가 어긋난다. 트랜지션 종료(transitionend) 시 최종 위치로 스냅한다(부드러운 추적은 불필요).
  let sidebarBound = false;
  function bindSidebarTransition() {
    if (sidebarBound) return;
    const sidebar = document.getElementById('sidebar') || document.getElementById('ui-right');
    if (!sidebar) return;
    sidebar.addEventListener('transitionend', (ev) => {
      // width/left/transform 등 위치에 영향을 주는 속성 전이 종료 시에만 반응
      if (['width', 'left', 'right', 'transform', 'margin-right'].includes(ev.propertyName)) updatePosition();
    });
    sidebarBound = true;
  }

  /** 현재 표시 대상 토큰(단일 선택된 토큰) 반환. */
  function getTargetToken() {
    const controlled = canvas?.tokens?.controlled || [];
    if (controlled.length === 0) return null;
    // 여러 개면 첫 번째(가장 최근 선택은 보장 어려우니 첫 번째)만 표시
    return controlled[0];
  }

  /** 액터의 활성 컨디션 목록을 [{key, meta, extra}] 로 반환. */
  function getActiveConditions(actor) {
    const conditions = actor?.system?.conditions || {};
    const result = [];
    for (const [key, meta] of Object.entries(CONDITION_META)) {
      if (!conditions[key]?.active) continue;
      let extra = '';
      if (key === 'poisoned' && conditions.poisoned?.value) extra = `Rank.${conditions.poisoned.value}`;
      else if (key === 'hatred' && conditions.hatred?.target) extra = conditions.hatred.target;
      else if (key === 'fear' && conditions.fear?.target) extra = conditions.fear.target;
      else if (key === 'berserk' && conditions.berserk?.type && !['-', 'normal'].includes(conditions.berserk.type)) {
        const t = conditions.berserk.type;
        extra = game.i18n.localize(`DX3rd.Urge${t.charAt(0).toUpperCase() + t.slice(1)}`);
        if (extra?.startsWith('DX3rd.')) extra = t; // 로컬라이즈 실패 시 원문
      }
      result.push({ key, meta, extra });
    }
    return result;
  }

  /** HUD 다시 그리기. */
  function render() {
    ensureHud();
    const token = getTargetToken();
    const actor = token?.actor;
    currentActorId = actor?.id || null;

    if (!actor) {
      hudEl.style.display = 'none';
      hudEl.replaceChildren();
      return;
    }

    const active = getActiveConditions(actor);
    const applied = getAppliedEffects(actor);
    if (active.length === 0 && applied.length === 0) {
      hudEl.style.display = 'none';
      hudEl.replaceChildren();
      return;
    }

    hudEl.replaceChildren();

    // 내장 컨디션(클릭 대상 아님)
    for (const { key, meta, extra } of active) {
      const label = game.i18n.localize(meta.i18n);
      const title = extra ? `${label} (${extra})` : label;

      const iconWrap = document.createElement('div');
      iconWrap.className = 'dx3rd-condition-hud-icon';
      iconWrap.dataset.condition = key;
      iconWrap.setAttribute('data-tooltip', title);
      iconWrap.title = title;

      const img = document.createElement('img');
      img.src = getStatusImg(meta.status);
      img.alt = label;
      iconWrap.appendChild(img);

      if (extra) {
        const badge = document.createElement('span');
        badge.className = 'dx3rd-condition-hud-badge';
        badge.textContent = extra.length > 4 ? extra.slice(0, 3) + '…' : extra;
        iconWrap.appendChild(badge);
      }

      hudEl.appendChild(iconWrap);
    }

    // 커스텀 applied 효과(우클릭 → 편집기 / 더블클릭 → 활성 토글)
    for (const { key, name, img: imgSrc, disable, disabled } of applied) {
      const disableLabel = Handlebars?.helpers?.disable ? String(Handlebars.helpers.disable(disable)) : disable;
      const baseTitle = `${name}${disable && disable !== '-' ? ` (${game.i18n.localize('DX3rd.DisableTiming')}: ${disableLabel})` : ''}`;
      // 상호작용 안내를 툴팁에 덧붙인다(우클릭 편집 / 더블클릭 토글).
      const title = `${baseTitle}${disabled ? ` — ${game.i18n.localize('DX3rd.DisableTiming')}` : ''}`;

      const iconWrap = document.createElement('div');
      iconWrap.className = 'dx3rd-condition-hud-icon dx3rd-applied-hud-icon' + (disabled ? ' dx3rd-applied-disabled' : '');
      iconWrap.dataset.appliedKey = key;
      iconWrap.setAttribute('data-tooltip', title);
      iconWrap.title = title;
      iconWrap.style.cursor = 'pointer';

      const img = document.createElement('img');
      img.src = imgSrc;
      img.alt = name;
      iconWrap.appendChild(img);

      hudEl.appendChild(iconWrap);
    }

    updatePosition();
    hudEl.style.display = 'flex';
  }

  /** 지정 액터가 현재 표시 대상일 때만 다시 그린다. */
  function renderIfCurrent(actor) {
    if (!actor) return;
    if (actor.id === currentActorId || actor.id === getTargetToken()?.actor?.id) render();
  }

  Hooks.on('controlToken', () => render());
  Hooks.on('canvasReady', () => render());
  // HUD 가 액터에서 읽는 건 system.conditions(getActiveConditions) 와 actor.effects(getAppliedEffects)
  // 뿐이다. 후자는 아래 ActiveEffect 훅들이 잡으므로, 여기서는 conditions 변경만 보면 된다.
  // (가드가 없으면 전투 중 HP 가 깎일 때마다 HUD DOM 을 통째로 다시 짓는다.)
  // 이 훅은 모든 클라이언트에서 표시를 갱신해야 하므로 userId 로 거르지 않는다.
  Hooks.on('updateActor', (actor, changed) => {
    if (!window.DX3rdRuntimeUtils.updateTouchesPath(changed, 'system.conditions')) return;
    renderIfCurrent(actor);
  });
  Hooks.on('createActiveEffect', (effect) => renderIfCurrent(effect.parent));
  Hooks.on('updateActiveEffect', (effect) => renderIfCurrent(effect.parent));
  Hooks.on('deleteActiveEffect', (effect) => renderIfCurrent(effect.parent));
  // 사이드바 접힘/펼침 등 UI 변화 시 위치 재계산
  //  · 즉시 1회 + transitionend 최종 스냅(bindSidebarTransition) 조합으로 어긋남 방지.
  //  · transitionend 가 없는(즉시 토글) 환경 대비 지연 폴백 1회.
  Hooks.on('collapseSidebar', () => { updatePosition(); setTimeout(updatePosition, 350); });
  Hooks.on('renderSidebar', () => { bindSidebarTransition(); updatePosition(); });
  window.addEventListener('resize', () => updatePosition());

  Hooks.once('ready', () => {
    ensureHud();
    bindSidebarTransition();
    render();
  });

  // 외부에서 강제 갱신할 수 있도록 노출
  window.DX3rdConditionHUD = { render, updatePosition };

})();
