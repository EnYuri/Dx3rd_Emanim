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
    //  · 더블클릭(dblclick) → 내장 상태이상은 해제, 표식은 제거, 그 밖은 활성/비활성 토글
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

  /**
   * 확인 다이얼로그. 되돌리기 어려운 방향(해제·제거)에만 물어본다 —
   * 다시 켜는 것은 잃는 것이 없으므로 묻지 않는다.
   */
  async function confirmDestructive(message) {
    const DialogV2 = foundry.applications?.api?.DialogV2;
    if (!DialogV2?.confirm) return true; // 물어볼 수단이 없으면 막지 않는다(기존 동작 유지)
    return !!(await DialogV2.confirm({
      window: { title: game.i18n.localize('DX3rd.HudRemoveTitle') },
      content: `<p>${message}</p>`,
      rejectClose: false,
      modal: true
    }));
  }

  /**
   * 더블클릭: 커스텀 applied → 활성/비활성 토글, 장비 변경 표식 → 제거(생성물 회수).
   * 둘 다 화면에서 아이콘이 사라지는 방향이라 실수로 눌리기 쉬워, 그 방향에서만 확인을 받는다.
   */
  async function onHudDblClick(event) {
    const actor = getTargetToken()?.actor;
    if (!actor) return;

    // 내장 상태이상: 해제. 상태 AE 를 끄는 것이 유일한 통로이고(condtions.js 의 훅이 system.conditions 를
    // 따라 내린다), 액터를 직접 고치면 그 동기화를 건너뛰어 시트와 토큰이 갈린다.
    const conditionIcon = event.target.closest('.dx3rd-condition-hud-icon[data-condition]');
    if (conditionIcon) {
      event.preventDefault();
      const key = conditionIcon.dataset.condition;
      const meta = CONDITION_META[key];
      if (!meta) return;
      if (!actor.isOwner) {
        ui.notifications.warn(game.i18n.localize('DX3rd.NoPermission'));
        return;
      }
      const label = game.i18n.localize(meta.i18n);
      if (!await confirmDestructive(game.i18n.format('DX3rd.HudConditionClearConfirm', { name: label }))) return;
      await actor.toggleStatusEffect(meta.status, { active: false });
      return;
    }

    const grantIcon = event.target.closest('.dx3rd-grant-hud-icon[data-effect-id]');
    if (grantIcon) {
      event.preventDefault();
      const effect = actor.effects?.get?.(grantIcon.dataset.effectId);
      if (!effect) return;
      const name = effect.name || game.i18n.localize('DX3rd.Effect');
      if (!await confirmDestructive(game.i18n.format('DX3rd.HudGrantRemoveConfirm', { name }))) return;
      // 회수는 deleteActiveEffect 훅 한 곳이 한다 — 여기에 다시 쓰면 두 벌이 되어 반드시 갈린다.
      await actor.deleteEmbeddedDocuments('ActiveEffect', [effect.id]);
      return;
    }

    const appliedIcon = event.target.closest('.dx3rd-applied-hud-icon[data-applied-key]');
    if (!appliedIcon) return;
    event.preventDefault();
    const key = appliedIcon.dataset.appliedKey;
    if (appliedIcon.dataset.disabled !== 'true') {
      const name = appliedIcon.dataset.effectName || game.i18n.localize('DX3rd.Applied');
      if (!await confirmDestructive(game.i18n.format('DX3rd.HudAppliedDisableConfirm', { name }))) return;
    }
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
        disabled: !!eff.disabled,
        // 같은 AE 가 그 아이템이 만든 것의 표식을 겸할 수 있다(한 아이템 = 한 AE). 표식만 따로 세우면
        // 이름·아이콘이 같은 아이콘이 둘 서므로, 여기서는 이 아이콘에 표식 테두리를 준다.
        hasGrant: !!window.DX3rdUniversalHandler?.grantPayload?.(eff)
      });
    }
    return result;
  }

  /**
   * 장비 변경 표식(무기·방어구·비클 생성, 맨손 데이터 변경)의 AE 목록.
   *
   * 이 표식이 생성물의 수명을 쥔 유일한 주인인데도 지금까지 이 HUD 에 나오지 않았다 — appliedKey 가 없기
   * 때문이다. 그래서 사용자가 여기 보이는 (같은 이름의) 보정 AE 를 지우고 「무기가 안 사라진다」고 읽었다.
   * 둘은 다른 AE 이고 수명도 다르므로, 보정 AE 삭제에 생성물 회수를 묶는 대신 표식 자신을 여기에 세운다.
   */
  function getGrantEffects(actor) {
    const H = window.DX3rdUniversalHandler;
    if (!H?.grantPayload) return [];
    const rows = [];
    for (const eff of (actor?.effects || [])) {
      const grant = H.grantPayload(eff);
      if (!grant) continue;
      // 보정 AE 가 겸하고 있는 표식은 그 아이콘이 대신 표시한다(위의 hasGrant).
      if (eff.getFlag?.(MODULE_ID, 'appliedKey')) continue;
      rows.push({
        id: eff.id,
        name: eff.name || game.i18n.localize('DX3rd.Effect'),
        img: eff.img || 'icons/svg/sword.svg',
        kind: grant.kind
      });
    }
    return rows;
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
    const grants = getGrantEffects(actor);
    if (active.length === 0 && applied.length === 0 && grants.length === 0) {
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
      const hint = `${title} — ${game.i18n.localize('DX3rd.HudConditionHint')}`;
      iconWrap.setAttribute('data-tooltip', hint);
      iconWrap.title = hint;
      iconWrap.style.cursor = 'pointer';

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
    for (const { key, name, img: imgSrc, disable, disabled, hasGrant } of applied) {
      const disableLabel = Handlebars?.helpers?.disable ? String(Handlebars.helpers.disable(disable)) : disable;
      const baseTitle = `${name}${disable && disable !== '-' ? ` (${game.i18n.localize('DX3rd.DisableTiming')}: ${disableLabel})` : ''}`;
      // 상호작용 안내를 툴팁에 덧붙인다(우클릭 편집 / 더블클릭 토글).
      const title = `${baseTitle}${disabled ? ` — ${game.i18n.localize('DX3rd.DisableTiming')}` : ''}`;

      const iconWrap = document.createElement('div');
      iconWrap.className = 'dx3rd-condition-hud-icon dx3rd-applied-hud-icon'
        + (disabled ? ' dx3rd-applied-disabled' : '')
        + (hasGrant ? ' dx3rd-grant-hud-icon' : '');
      iconWrap.dataset.appliedKey = key;
      iconWrap.dataset.effectName = name;
      iconWrap.dataset.disabled = String(!!disabled);
      iconWrap.setAttribute('data-tooltip', title);
      iconWrap.title = title;
      iconWrap.style.cursor = 'pointer';

      const img = document.createElement('img');
      img.src = imgSrc;
      img.alt = name;
      iconWrap.appendChild(img);

      hudEl.appendChild(iconWrap);
    }

    // 장비 변경 표식(더블클릭 → 제거, 생성물 회수)
    for (const { id, name, img: imgSrc, kind } of grants) {
      const description = game.i18n.localize(kind === 'fist'
        ? 'DX3rd.GrantFistDescription' : 'DX3rd.GrantItemDescription');
      const title = `${name} — ${description}`;

      const iconWrap = document.createElement('div');
      iconWrap.className = 'dx3rd-condition-hud-icon dx3rd-grant-hud-icon';
      iconWrap.dataset.effectId = id;
      iconWrap.dataset.effectName = name;
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
