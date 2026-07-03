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
    const applied = actor?.system?.attributes?.applied || {};
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
      window: { title: `${name} - 상세 정보` },
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
      const ForcedDeletion = foundry.data?.operators?.ForcedDeletion;
      if (ForcedDeletion) {
        await actor.update({
          'system.attributes.applied': {[applied.key]: new ForcedDeletion()}
        });
      } else {
        await actor.update({[`system.attributes.applied.-=${applied.key}`]: null});
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
    confirmRemove,
    remove
  };
})();
