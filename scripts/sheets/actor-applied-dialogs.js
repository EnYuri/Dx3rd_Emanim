/**
 * Double Cross 3rd Applied effect detail dialogs.
 *
 * Legacy actor sheet and AppV2 pilot share this module so the remaining
 * read-only applied-effect viewer no longer depends on the previous modal API.
 *
 * Public API: `window.DX3rdActorAppliedDialogs.open(actor, appliedIdOrKey)`
 *             `window.DX3rdActorAppliedDialogs.remove(actor, appliedIdOrKey)`
 */
(function() {
  const DialogV2 = foundry.applications?.api?.DialogV2;

  function escapeHTML(value) {
    return String(value ?? '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#39;');
  }

  function localizeAttribute(value) {
    return window.DX3rdAttributeLocalizer?.localize(value) || value;
  }

  function formatValue(value) {
    if (typeof value === 'number') return `${value >= 0 ? '+' : ''}${value}`;
    const numeric = Number(value);
    if (value !== '' && value !== null && value !== undefined && Number.isFinite(numeric)) {
      return `${numeric >= 0 ? '+' : ''}${numeric}`;
    }
    return value ?? '';
  }

  function localizeDisable(value) {
    const key = {
      notCheck: 'DX3rd.NotCheck',
      roll: 'DX3rd.AfterRoll',
      major: 'DX3rd.AfterMajor',
      reaction: 'DX3rd.AfterReaction',
      guard: 'DX3rd.AfterGuard',
      main: 'DX3rd.AfterMain',
      round: 'DX3rd.AfterRound',
      scene: 'DX3rd.AfterScene',
      session: 'DX3rd.AfterSession'
    }[value];
    return key ? game.i18n.localize(key) : (value || '-');
  }

  function findApplied(actor, appliedIdOrKey) {
    const applied = window.DX3rdAppliedEffects?.collect
      ? window.DX3rdAppliedEffects.collect(actor)
      : (actor?.system?.attributes?.applied || {});
    if (!appliedIdOrKey) return null;

    if (applied[appliedIdOrKey]) {
      return {
        key: appliedIdOrKey,
        effect: applied[appliedIdOrKey]
      };
    }

    if (String(appliedIdOrKey).startsWith('applied_')) {
      const index = Number.parseInt(String(appliedIdOrKey).replace('applied_', ''), 10);
      const keys = Object.keys(applied);
      const key = keys[index];
      if (key) {
        return {
          key,
          effect: applied[key]
        };
      }
    }

    return null;
  }

  function attributeRow(key, label, value) {
    return `
      <tr>
        <td>${escapeHTML(localizeAttribute(key))}</td>
        <td>${escapeHTML(localizeAttribute(label))}</td>
        <td>${escapeHTML(formatValue(value))}</td>
      </tr>
    `;
  }

  function renderDetails(appliedEffect = {}) {
    const rows = [];

    if (appliedEffect.key && appliedEffect.label && appliedEffect.value !== undefined) {
      rows.push(attributeRow(appliedEffect.key, appliedEffect.label, appliedEffect.value));
    }

    for (const [attrName, attrValue] of Object.entries(appliedEffect.attributes || {})) {
      const attrData = attrValue && typeof attrValue === 'object'
        ? attrValue
        : {
            key: attrName.split(':')[0] || attrName,
            label: attrName.split(':')[1] || attrName,
            value: attrValue
          };
      rows.push(attributeRow(
        attrData.key || attrName,
        attrData.label || '-',
        attrData.value ?? ''
      ));
    }

    const empty = `<p>${escapeHTML(game.i18n.localize('DX3rd.NoAppliedAttributes'))}</p>`;
    const table = rows.length
      ? `<table class="applied-effect-table"><thead><tr><th>Key</th><th>Label</th><th>${escapeHTML(game.i18n.localize('DX3rd.Value'))}</th></tr></thead><tbody>${rows.join('')}</tbody></table>`
      : empty;

    return `
      <div class="applied-effect-dialog">
        <p><strong>${escapeHTML(game.i18n.localize('DX3rd.Source'))}</strong>: ${escapeHTML(appliedEffect.source || '-')}</p>
        <p><strong>${escapeHTML(game.i18n.localize('DX3rd.DisableTiming'))}</strong>: ${escapeHTML(localizeDisable(appliedEffect.disable))}</p>
        ${appliedEffect.description ? `<div class="applied-effect-description">${appliedEffect.description}</div>` : ''}
        ${table}
      </div>
    `;
  }

  // === 편집기(전용 다이얼로그) ===============================================
  // 커스텀 applied 효과(AE flags.dx3rd-emanim.applied)만 편집한다. 이름/아이콘/
  // disable 타이밍/보정치 행(key·label·value)을 고쳐 DX3rdAppliedEffects.set 으로
  // 되쓴다(계산 무손실 원본 = flag payload). 내장 컨디션은 대상이 아니다.

  // disable 드롭다운 정본 옵션(effect/active-item 시트와 동일 집합).
  const DISABLE_OPTIONS = [
    ['-', '-'],
    ['notCheck', 'DX3rd.NotCheck'],
    ['roll', 'DX3rd.AfterRoll'],
    ['major', 'DX3rd.AfterMajor'],
    ['main', 'DX3rd.AfterMain'],
    ['reaction', 'DX3rd.AfterReaction'],
    ['guard', 'DX3rd.AfterGuard'],
    ['round', 'DX3rd.AfterRound'],
    ['scene', 'DX3rd.AfterScene'],
    ['session', 'DX3rd.AfterSession']
  ];

  function keySelectHTML(selected) {
    // 어트리뷰트 key 옵션은 effect 시트와 공유되는 Handlebars 헬퍼로 생성(단일 소스).
    const helper = Handlebars?.helpers?.attributeOptions;
    if (typeof helper === 'function') return String(helper(selected ?? '-'));
    return `<option value="${escapeHTML(selected ?? '-')}" selected>${escapeHTML(selected ?? '-')}</option>`;
  }

  function attrRowHTML(attr = {}) {
    return `
      <div class="dx3rd-ae-attr-row" style="display:flex;gap:4px;margin-bottom:4px;align-items:center;">
        <select class="ae-attr-key" style="flex:1 1 42%;">${keySelectHTML(attr.key)}</select>
        <input class="ae-attr-label" type="text" list="dx3rd-ae-label-list" value="${escapeHTML(attr.label ?? '')}" placeholder="label" style="flex:1 1 30%;min-width:0;">
        <input class="ae-attr-value" type="text" value="${escapeHTML(attr.value ?? '')}" placeholder="${escapeHTML(game.i18n.localize('DX3rd.Value'))}" style="flex:1 1 22%;min-width:0;">
        <a class="ae-attr-remove" title="${escapeHTML(game.i18n.localize('DX3rd.Remove'))}" style="flex:0 0 auto;cursor:pointer;"><i class="fas fa-trash"></i></a>
      </div>`;
  }

  // label(대상 능력/기능) 자동완성 옵션: 능력치 4종 + 액터의 기능 키 전체.
  // stat_bonus/stat_dice 의 label 은 이 키들을 참조하므로 실제 값으로 채운다.
  function labelDatalistOptions(actor) {
    const keys = ['body', 'sense', 'mind', 'social'];
    const skills = actor?.system?.attributes?.skills;
    if (skills && typeof skills === 'object') keys.push(...Object.keys(skills));
    return [...new Set(keys)]
      .map(k => `<option value="${escapeHTML(k)}"></option>`)
      .join('');
  }

  function renderEditForm(effect = {}, actor = null) {
    const rows = Object.entries(effect.attributes || {}).map(([k, v]) => {
      const attr = (v && typeof v === 'object') ? v : { key: k, label: '', value: v };
      return attrRowHTML(attr);
    }).join('');

    const disableSel = DISABLE_OPTIONS.map(([val, lbl]) => {
      const text = val === '-' ? '-' : game.i18n.localize(lbl);
      const sel = val === (effect.disable || '-') ? 'selected' : '';
      return `<option value="${val}" ${sel}>${escapeHTML(text)}</option>`;
    }).join('');

    return `
      <div class="dx3rd-ae-edit">
        <datalist id="dx3rd-ae-label-list">${labelDatalistOptions(actor)}</datalist>
        <div style="display:flex;gap:8px;align-items:center;margin-bottom:6px;">
          <img class="ae-img-preview" src="${escapeHTML(effect.img || 'icons/svg/aura.svg')}" width="40" height="40" style="flex:0 0 auto;border:none;object-fit:contain;">
          <div style="flex:1 1 auto;">
            <label style="font-size:.75em;color:gray;">${escapeHTML(game.i18n.localize('DX3rd.Name'))}</label>
            <input class="ae-name" type="text" value="${escapeHTML(effect.name || '')}" style="width:100%;">
          </div>
        </div>
        <div style="display:flex;gap:8px;margin-bottom:8px;">
          <div style="flex:2 1 auto;min-width:0;">
            <label style="font-size:.75em;color:gray;">${escapeHTML(game.i18n.localize('DX3rd.Image'))}</label>
            <div style="display:flex;gap:4px;">
              <input class="ae-img" type="text" value="${escapeHTML(effect.img || '')}" style="flex:1 1 auto;min-width:0;">
              <button type="button" class="ae-img-pick" style="flex:0 0 auto;width:auto;"><i class="fas fa-file-image"></i></button>
            </div>
          </div>
          <div style="flex:1 1 auto;min-width:0;">
            <label style="font-size:.75em;color:gray;">${escapeHTML(game.i18n.localize('DX3rd.DisableTiming'))}</label>
            <select class="ae-disable" style="width:100%;">${disableSel}</select>
          </div>
        </div>
        <div style="margin-bottom:8px;">
          <label style="font-size:.75em;color:gray;">${escapeHTML(game.i18n.localize('DX3rd.Description'))}</label>
          <textarea class="ae-description" rows="3" style="width:100%;resize:vertical;" placeholder="${escapeHTML(game.i18n.localize('DX3rd.Description'))}">${escapeHTML(effect.description || '')}</textarea>
        </div>
        <div style="display:flex;align-items:center;gap:16px;margin-bottom:8px;">
          <label style="display:flex;align-items:center;gap:6px;font-size:.8em;">
            <input class="ae-show-token" type="checkbox" ${effect.showOnToken ? 'checked' : ''} style="flex:0 0 auto;">
            ${escapeHTML(game.i18n.localize('DX3rd.ShowOnToken'))}
          </label>
          <label style="display:flex;align-items:center;gap:6px;font-size:.8em;">
            <input class="ae-show-screen" type="checkbox" ${effect.showOnScreen !== false ? 'checked' : ''} style="flex:0 0 auto;">
            ${escapeHTML(game.i18n.localize('DX3rd.ShowOnScreen'))}
          </label>
        </div>
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;">
          <label style="font-size:.75em;color:gray;">${escapeHTML(game.i18n.localize('DX3rd.Attributes'))}</label>
          <a class="ae-attr-add" title="${escapeHTML(game.i18n.localize('DX3rd.Add'))}" style="cursor:pointer;"><i class="fas fa-plus"></i></a>
        </div>
        <div class="ae-attr-list">${rows}</div>
      </div>`;
  }

  function wireEditForm(root) {
    if (!root) return;
    const list = root.querySelector('.ae-attr-list');

    root.querySelector('.ae-attr-add')?.addEventListener('click', (ev) => {
      ev.preventDefault();
      list?.insertAdjacentHTML('beforeend', attrRowHTML({ key: '-', label: '', value: '' }));
    });

    list?.addEventListener('click', (ev) => {
      const rm = ev.target.closest('.ae-attr-remove');
      if (!rm) return;
      ev.preventDefault();
      rm.closest('.dx3rd-ae-attr-row')?.remove();
    });

    // 아이콘 경로 입력 ↔ 미리보기 동기화
    const imgInput = root.querySelector('.ae-img');
    const preview = root.querySelector('.ae-img-preview');
    imgInput?.addEventListener('change', () => {
      if (preview && imgInput.value) preview.src = imgInput.value;
    });

    // 파일 피커(있으면 사용, 실패 시 텍스트 입력이 원본 진실)
    root.querySelector('.ae-img-pick')?.addEventListener('click', (ev) => {
      ev.preventDefault();
      try {
        const FP = foundry.applications?.apps?.FilePicker?.implementation || globalThis.FilePicker;
        if (!FP) return;
        new FP({
          type: 'image',
          current: imgInput?.value || '',
          callback: (path) => {
            if (imgInput) imgInput.value = path;
            if (preview) preview.src = path;
          }
        }).render(true);
      } catch (e) {
        console.warn('DX3rd | FilePicker 열기 실패:', e);
      }
    });
  }

  function parseEditForm(root, original = {}) {
    const name = root.querySelector('.ae-name')?.value?.trim() || game.i18n.localize('DX3rd.Applied');
    const img = root.querySelector('.ae-img')?.value?.trim() || 'icons/svg/aura.svg';
    const disable = root.querySelector('.ae-disable')?.value || '-';
    const description = root.querySelector('.ae-description')?.value ?? '';
    const showOnToken = !!root.querySelector('.ae-show-token')?.checked;
    const showOnScreen = !!root.querySelector('.ae-show-screen')?.checked;

    const attributes = {};
    let i = 0;
    root.querySelectorAll('.dx3rd-ae-attr-row').forEach((row) => {
      const key = row.querySelector('.ae-attr-key')?.value;
      if (!key || key === '-') return;
      const label = row.querySelector('.ae-attr-label')?.value?.trim() || '';
      const value = row.querySelector('.ae-attr-value')?.value ?? '';
      attributes[`attr${i++}`] = { key, label, value };
    });

    // 원본 payload 를 보존하고 편집 필드만 덮어쓴다(itemId/source/timestamp 유지).
    return { ...original, name, img, disable, description, showOnToken, showOnScreen, attributes };
  }

  async function edit(actor, appliedIdOrKey) {
    if (!DialogV2?.wait) {
      ui.notifications.error(game.i18n.localize('DX3rd.DialogV2Unavailable'));
      return false;
    }
    if (!window.DX3rdAppliedEffects?.set) {
      ui.notifications.error('DX3rdAppliedEffects 미로드');
      return false;
    }

    const applied = findApplied(actor, appliedIdOrKey);
    if (!applied) {
      ui.notifications.warn(game.i18n.localize('DX3rd.AppliedEffectNotFound'));
      return false;
    }

    // 토글(아이템 자동생성) 소스 효과는 편집이 유지되지 않는다 — DX3rdAppliedToggle 이
    // actor/item 업데이트마다 아이템 평가값으로 재동결하기 때문. 편집을 값이 실제로 유지되는
    // 원본 아이템 시트로 유도한다. (수동/매크로 생성 applied 는 아래 편집 다이얼로그로 진행)
    const KEY_PREFIX = window.DX3rdAppliedToggle?.KEY_PREFIX || 'toggle:';
    if (String(applied.key).startsWith(KEY_PREFIX)) {
      const itemId = applied.effect?.itemId || String(applied.key).slice(KEY_PREFIX.length);
      const item = actor.items?.get(itemId);
      if (item) {
        item.sheet.render(true);
        return true;
      }
      // 원본 아이템을 못 찾으면(삭제 등) 아래 편집 다이얼로그로 폴백한다.
    }

    const name = applied.effect?.name || game.i18n.localize('DX3rd.Applied');
    let saved = false;
    await DialogV2.wait({
      window: { title: `${name} - ${game.i18n.localize('DX3rd.Edit')}` },
      position: { width: 480 },
      classes: ['dx3rd-emanim', 'dialog'],
      content: renderEditForm(applied.effect, actor),
      render: (_event, dialog) => wireEditForm(dialog.element),
      buttons: [
        {
          action: 'save',
          icon: 'fas fa-save',
          label: game.i18n.localize('DX3rd.Save'),
          default: true,
          callback: async (_event, button) => {
            const root = button.form || button.closest?.('form');
            const payload = parseEditForm(root, applied.effect);
            const result = await window.DX3rdAppliedEffects.set(actor, applied.key, payload);
            if (result) {
              saved = true;
              ui.notifications.info(game.i18n.localize('DX3rd.AppliedUpdated'));
            } else {
              ui.notifications.error(game.i18n.localize('DX3rd.AppliedUpdateFailed'));
            }
          }
        },
        {
          action: 'cancel',
          icon: 'fas fa-times',
          label: game.i18n.localize('DX3rd.Cancel')
        }
      ],
      rejectClose: false
    });
    return saved;
  }

  async function open(actor, appliedIdOrKey) {
    if (!DialogV2?.prompt) {
      ui.notifications.error(game.i18n.localize('DX3rd.DialogV2Unavailable'));
      return false;
    }

    const applied = findApplied(actor, appliedIdOrKey);
    if (!applied) {
      ui.notifications.warn(game.i18n.localize('DX3rd.AppliedEffectNotFound'));
      return false;
    }

    const name = applied.effect?.name || game.i18n.localize('DX3rd.Applied');
    await DialogV2.prompt({
      window: { title: `${name} - ${game.i18n.localize('DX3rd.Detail')}` },
      classes: ['dx3rd-emanim', 'dialog'],
      content: renderDetails(applied.effect),
      ok: {
        icon: '<i class="fas fa-times"></i>',
        label: game.i18n.localize('DX3rd.Close')
      }
    });
    return true;
  }

  async function confirmRemove(applied) {
    if (!DialogV2?.confirm) {
      ui.notifications.error(game.i18n.localize('DX3rd.DialogV2Unavailable'));
      return false;
    }

    const name = applied?.effect?.name || applied?.key || game.i18n.localize('DX3rd.Applied');
    return DialogV2.confirm({
      window: { title: game.i18n.localize('DX3rd.RemoveApplied') },
      classes: ['dx3rd-emanim', 'dialog'],
      content: `<p>${escapeHTML(game.i18n.format('DX3rd.ConfirmRemoveApplied', {name}))}</p>`,
      yes: {
        icon: '<i class="fas fa-trash"></i>',
        label: game.i18n.localize('DX3rd.Remove')
      },
      no: {
        icon: '<i class="fas fa-times"></i>',
        label: game.i18n.localize('DX3rd.Cancel')
      },
      defaultYes: false
    });
  }

  async function remove(actor, appliedIdOrKey, {confirm = true} = {}) {
    const applied = findApplied(actor, appliedIdOrKey);
    if (!applied) {
      ui.notifications.warn(game.i18n.localize('DX3rd.AppliedNotFound'));
      return false;
    }

    if (confirm) {
      const confirmed = await confirmRemove(applied);
      if (!confirmed) return false;
    }

    try {
      // 네이티브 AE 우선 삭제, 없으면 레거시 필드 정리(전환기 대비)
      const removed = window.DX3rdAppliedEffects?.remove
        ? await window.DX3rdAppliedEffects.remove(actor, applied.key)
        : false;
      if (!removed) {
        const ForcedDeletion = foundry.data?.operators?.ForcedDeletion;
        if (ForcedDeletion) {
          await actor.update({
            'system.attributes.applied': {[applied.key]: new ForcedDeletion()}
          });
        } else {
          await actor.update({[`system.attributes.applied.-=${applied.key}`]: null});
        }
      }
      ui.notifications.info(game.i18n.localize('DX3rd.AppliedRemoved'));
      return true;
    } catch (error) {
      console.error('DX3rd | Error removing applied effect:', error);
      ui.notifications.error(game.i18n.localize('DX3rd.AppliedRemoveFailed'));
      return false;
    }
  }

  window.DX3rdActorAppliedDialogs = {
    findApplied,
    renderDetails,
    open,
    edit,
    confirmRemove,
    remove
  };
})();
