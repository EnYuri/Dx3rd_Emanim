// Universal handler dialog helpers shared by item activation workflows.
(function() {
  window.DX3rdUniversalAlertDialogV2 = async function({ title, content, label } = {}) {
    const DialogV2 = foundry.applications?.api?.DialogV2;
    if (!DialogV2?.wait) {
      ui.notifications.error(game.i18n.localize('DX3rd.DialogV2Unavailable'));
      return;
    }

    return DialogV2.wait({
      window: { title },
      content,
      buttons: [{
        action: 'confirm',
        icon: '<i class="fas fa-check"></i>',
        label: label || game.i18n.localize('DX3rd.Confirm'),
        default: true
      }]
    });
  };

  // 사용 시 수치 입력 프롬프트 (변동형 이펙트: "소모한 HP만큼" 등).
  // 확인 시 입력한 숫자(음수/소수 방어), 취소 시 null 반환.
  window.DX3rdUniversalNumberPromptV2 = async function({ title, label, defaultValue = 0, maxValue = null } = {}) {
    const DialogV2 = foundry.applications?.api?.DialogV2;
    if (!DialogV2?.wait) {
      ui.notifications.error(game.i18n.localize('DX3rd.DialogV2Unavailable'));
      return null;
    }
    const safeLabel = foundry.utils.escapeHTML ? foundry.utils.escapeHTML(String(label ?? '')) : String(label ?? '');
    const numericMax = Number(maxValue);
    const hasMax = Number.isFinite(numericMax) && numericMax >= 0;
    const maxAttribute = hasMax ? ` max="${Math.floor(numericMax)}"` : '';
    const initialValue = Math.max(0, Math.floor(Number(defaultValue) || 0));
    const boundedInitialValue = hasMax ? Math.min(initialValue, Math.floor(numericMax)) : initialValue;
    const content = `<div class="dx3rd-item-chat" style="padding:4px 2px;">`
      + `<label style="display:block;margin-bottom:6px;">${safeLabel}</label>`
      + `<input type="number" name="runtimeValue" value="${boundedInitialValue}" min="0"${maxAttribute} step="1" autofocus style="width:100%;box-sizing:border-box;"></div>`;
    return DialogV2.wait({
      window: { title: title || game.i18n.localize('DX3rd.RuntimeInput') },
      content,
      buttons: [
        {
          action: 'confirm',
          icon: '<i class="fas fa-check"></i>',
          label: game.i18n.localize('DX3rd.Confirm'),
          default: true,
          callback: (event, button) => {
            const raw = button.form?.querySelector('input[name="runtimeValue"]')?.value;
            let n = Math.max(0, Math.floor(Number(raw)));
            if (!Number.isFinite(n)) n = 0;
            if (hasMax) n = Math.min(n, Math.floor(numericMax));
            return n;
          }
        },
        {
          action: 'cancel',
          icon: '<i class="fas fa-times"></i>',
          label: game.i18n.localize('DX3rd.Cancel'),
          callback: () => null
        }
      ],
      rejectClose: false
    });
  };
})();
