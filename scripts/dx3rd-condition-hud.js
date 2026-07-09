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
    document.body.appendChild(hudEl);
    return hudEl;
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
    if (active.length === 0) {
      hudEl.style.display = 'none';
      hudEl.replaceChildren();
      return;
    }

    hudEl.replaceChildren();
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
  Hooks.on('updateActor', (actor) => renderIfCurrent(actor));
  Hooks.on('createActiveEffect', (effect) => renderIfCurrent(effect.parent));
  Hooks.on('deleteActiveEffect', (effect) => renderIfCurrent(effect.parent));
  // 사이드바 접힘/펼침 등 UI 변화 시 위치 재계산
  Hooks.on('collapseSidebar', () => setTimeout(updatePosition, 50));
  Hooks.on('renderSidebar', () => updatePosition());
  window.addEventListener('resize', () => updatePosition());

  Hooks.once('ready', () => {
    ensureHud();
    render();
  });

  // 외부에서 강제 갱신할 수 있도록 노출
  window.DX3rdConditionHUD = { render, updatePosition };

})();
