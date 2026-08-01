/**
 * Double Cross 3rd 액터 시트 편집 다이얼로그 공유 모듈.
 *
 * 이전 시트 액터 시트와 AppV2 파일럿 시트가 동일한 편집 다이얼로그를 공유하도록
 * `scripts/sheets/actor-sheet.js`에서 추출한 것이다. 내부 다이얼로그는 레거시 이전 시트
 * `Dialog` 대신 `DialogV2`를 사용하지만, 보너스 계산·auto-sign 표기·라이브 액터 갱신·
 * 채팅 메시지 등 동작은 원본과 동일하게 유지한다.
 *
 * 공개 API:
 *   window.DX3rdActorEditDialogs.openAbility(actor, ability)
 *   window.DX3rdActorEditDialogs.openStock(actor)
 *   window.DX3rdActorEditDialogs.openActorType(actor)
 */
(function() {
  const TEMPLATE_BASE = "systems/dx3rd-emanim/templates/dialog";

  function getDialogV2() {
    return foundry.applications?.api?.DialogV2;
  }

  function hasPermission(actor) {
    if (!window.DX3rdActorSheetData.hasOwnerPermission(actor)) {
      ui.notifications.warn(game.i18n.localize("DX3rd.NoPermission"));
      return false;
    }
    return true;
  }

  /** auto-sign 입력값 표기 정규화(원본 actor-sheet.js 로직과 동일). */
  function applyAutoSign(input) {
    let value = input.value.replace(/[^0-9+-]/g, '');
    value = value.replace(/(?!^)[+-]/g, '');
    if (value === '+' || value === '-') {
      input.value = value;
      return;
    }
    let numValue = Number(value);
    if (isNaN(numValue)) numValue = 0;
    if (numValue === 0) input.value = '0';
    else if (numValue > 0) input.value = '+' + numValue;
    else input.value = numValue.toString();
  }

  /** 초기 표시값에 부호 적용. */
  function formatInitialSign(input) {
    const value = Number(input.value) || 0;
    if (value > 0) input.value = '+' + value;
    else if (value < 0) input.value = value.toString();
    else input.value = '0';
  }

  function signedString(total) {
    if (total === 0) return '0';
    if (total > 0) return '+' + total;
    return total.toString();
  }

  // ── 능력치 편집(다이아몬드 클릭) ─────────────────────────────────────────

  async function openAbility(actor, ability) {
    if (!hasPermission(actor)) return;
    if (!ability) return;

    const DialogV2 = getDialogV2();
    if (!DialogV2) {
      ui.notifications.error(game.i18n.localize('DX3rd.DialogV2Unavailable'));
      return;
    }

    const attrs = actor.system.attributes[ability];
    const title = game.i18n.localize("DX3rd.EditAbility");
    const abilityLabel = "DX3rd." + ability.charAt(0).toUpperCase() + ability.slice(1);
    const isEnemy = actor.type === 'enemy';

    // 신드롬/웍스 보너스(에너미는 없음)
    let syndromeBonus = 0;
    let worksBonus = 0;
    if (!isEnemy) {
      const syndromeList = actor.system.attributes.syndrome || [];
      const syndromeItems = actor.items.filter(item => item.type === 'syndrome');
      const totalSyndromeCount = syndromeItems.length;
      let multiplier = 1;
      if (totalSyndromeCount === 1) multiplier = 2;
      else if (totalSyndromeCount >= 2) multiplier = 1;
      for (const syndromeId of syndromeList) {
        const syndromeItem = actor.items.get(syndromeId);
        if (syndromeItem && syndromeItem.system?.attributes?.[ability]?.value) {
          const baseValue = Number(syndromeItem.system.attributes[ability].value) || 0;
          syndromeBonus += baseValue * multiplier;
        }
      }
      const worksItems = actor.items.filter(item => item.type === 'works');
      for (const worksItem of worksItems) {
        if (worksItem.system?.attributes?.[ability]?.value) {
          worksBonus += window.DX3rdFormulaEvaluator.evaluate(worksItem.system.attributes[ability].value, worksItem, actor);
        }
      }
    }

    // 활성 아이템 stat_bonus 합산
    let itemBonus = 0;
    const activeItems = actor.items.filter(item =>
      item.system?.active?.state === true &&
      ['combo', 'effect', 'spell', 'psionic', 'weapon', 'protect', 'vehicle', 'connection', 'etc', 'once'].includes(item.type)
    );
    const effectAdapter = window.DX3rdItemEffectAdapter;
    for (const item of activeItems) {
      if (item.system?.attributes) {
        for (const attrData of Object.values(item.system.attributes)) {
          // 「사용/공격 시」로 저작된 항목은 동결 AE 쪽(appliedEffects)에서 센다.
          if (effectAdapter && !effectAdapter.appliesWhileActive(item, attrData)) continue;
          if (attrData.key === 'stat_bonus' && attrData.label === ability && attrData.value) {
            itemBonus += window.DX3rdFormulaEvaluator.evaluate(attrData.value, item, actor);
          }
        }
      }
    }

    // Applied 효과 보너스
    let appliedBonus = 0;
    const appliedEffects = window.DX3rdAppliedEffects?.collect
      ? window.DX3rdAppliedEffects.collect(actor)
      : (actor.system.attributes.applied || {});
    for (const appliedEffect of Object.values(appliedEffects)) {
      if (appliedEffect && appliedEffect.attributes) {
        for (const [attrName, attrValue] of Object.entries(appliedEffect.attributes)) {
          if (attrName.toLowerCase() === ability.toLowerCase()) {
            appliedBonus += Number(attrValue) || 0;
          }
        }
      }
    }

    const total = (attrs.point ?? 0) + (attrs.extra ?? 0) + (attrs.bonus ?? 0) + syndromeBonus + worksBonus + itemBonus + appliedBonus;

    const content = await foundry.applications.handlebars.renderTemplate(`${TEMPLATE_BASE}/ability-dialog.html`, {
      title,
      abilityLabel,
      point: attrs.point,
      extra: attrs.extra,
      bonus: (attrs.bonus ?? 0) + itemBonus + appliedBonus,
      syndrome: syndromeBonus,
      works: worksBonus,
      total,
      showWorksSyndrome: !isEnemy,
      showGrowth: !isEnemy
    });

    const dlg = new DialogV2({
      window: { title },
      content,
      buttons: [{
        action: 'close',
        label: game.i18n.localize("DX3rd.Close"),
        default: true
      }]
    });
    await dlg.render(true);

    const root = dlg.element;
    const pointEl = root.querySelector("#ability-point");
    const extraEl = root.querySelector("#ability-extra");
    const bonusEl = root.querySelector("#ability-bonus");
    const syndromeEl = root.querySelector("#ability-syndrome");
    const worksEl = root.querySelector("#ability-works");
    const totalEl = root.querySelector("#ability-total");

    // 초기 부호 적용
    root.querySelectorAll('.auto-sign').forEach(formatInitialSign);

    const numOf = (el) => Number((el?.value || '0').replace('+', '')) || 0;

    const updateTotalAndActor = () => {
      const e = numOf(extraEl);
      const b = numOf(bonusEl);
      const p = isEnemy ? (Number(actor.system.attributes[ability].point) || 0) : numOf(pointEl);
      const s = isEnemy ? 0 : numOf(syndromeEl);
      const w = isEnemy ? 0 : numOf(worksEl);
      const t = p + e + b + s + w;
      if (totalEl) totalEl.value = signedString(t);
      if (isEnemy) {
        actor.update({ [`system.attributes.${ability}.extra`]: e });
      } else {
        actor.update({
          [`system.attributes.${ability}.point`]: p,
          [`system.attributes.${ability}.extra`]: e
        });
      }
    };

    // 편집 가능한 입력에 auto-sign + 갱신 핸들러 연결(원본 순서 보존: 포맷 후 갱신)
    const editable = [extraEl];
    if (!isEnemy && pointEl) editable.push(pointEl);
    for (const el of editable) {
      if (!el) continue;
      el.addEventListener('input', () => applyAutoSign(el));
      el.addEventListener('input', updateTotalAndActor);
    }

    return dlg;
  }

  // ── 재산점(Stock) 수정 및 기록 ────────────────────────────────────────

  async function openStock(actor) {
    if (!hasPermission(actor)) return;
    const DialogV2 = getDialogV2();
    if (!DialogV2) {
      ui.notifications.error(game.i18n.localize('DX3rd.DialogV2Unavailable'));
      return;
    }

    const stock = actor.system.attributes.stock || {};
    const baseStock = Number(stock.base ?? stock.max) || 0;
    const currentStock = Number(stock.value) || 0;
    const currentModifier = Number(stock.modifier) || 0;
    const history = Array.isArray(actor.getFlag('dx3rd-emanim', 'stockHistory'))
      ? actor.getFlag('dx3rd-emanim', 'stockHistory')
      : [];
    const escapeHTML = value => window.DX3rdRuntimeUtils?.escapeHTML?.(String(value ?? ''))
      ?? foundry.utils.escapeHTML(String(value ?? ''));
    const historyRows = history.slice(-8).reverse().map(entry => {
      const date = entry.createdAt ? new Date(entry.createdAt).toLocaleString('ko-KR') : '-';
      const delta = signedString(Number(entry.delta) || 0);
      return `
        <li>
          <span class="stock-history-main"><strong>${escapeHTML(delta)}</strong> ${escapeHTML(entry.reason || '-')}</span>
          <small>${escapeHTML(date)} · ${escapeHTML(entry.userName || '')} · ${escapeHTML(entry.before)} → ${escapeHTML(entry.after)}</small>
        </li>`;
    }).join('');

    const content = `
      <div class="stock-dialog">
        <div class="stock-summary">
          <span>${game.i18n.localize("DX3rd.BaseStock")} <strong>${baseStock}</strong></span>
          <span>${game.i18n.localize("DX3rd.CurrentStock")} <strong>${currentStock}</strong></span>
          <span>${game.i18n.localize("DX3rd.StockModifier")} <strong>${signedString(currentModifier)}</strong></span>
        </div>
        <div class="form-group">
          <label for="stock-adjustment">${game.i18n.localize("DX3rd.StockAdjustment")}</label>
          <input type="text" id="stock-adjustment" inputmode="numeric" value="0" placeholder="+1 / -1">
          <small>${game.i18n.localize("DX3rd.StockAdjustmentHint")}</small>
        </div>
        <div class="form-group">
          <label for="stock-reason">${game.i18n.localize("DX3rd.StockReason")}</label>
          <input type="text" id="stock-reason" maxlength="120">
        </div>
        <div class="stock-history">
          <h4>${game.i18n.localize("DX3rd.StockHistory")}</h4>
          ${historyRows ? `<ol>${historyRows}</ol>` : `<p>${game.i18n.localize("DX3rd.StockHistoryEmpty")}</p>`}
        </div>
      </div>
      <style>
      .stock-dialog { padding: 5px; display:flex; flex-direction:column; gap:10px; }
      .stock-dialog .stock-summary { display:grid; grid-template-columns:repeat(3,1fr); gap:6px; text-align:center; }
      .stock-dialog .stock-summary span { border:1px solid var(--color-border-light-2); padding:5px; }
      .stock-dialog .form-group { display: flex; flex-direction: column; gap: 5px; margin: 0; }
      .stock-dialog label { font-weight: bold; font-size: 14px; }
      .stock-dialog input { padding: 4px; font-size: 14px; border: 1px solid #ccc; border-radius: 4px; }
      .stock-dialog .stock-history h4 { margin:0 0 4px; }
      .stock-dialog .stock-history ol { margin:0; padding-left:22px; max-height:150px; overflow:auto; }
      .stock-dialog .stock-history li { margin-bottom:5px; }
      .stock-dialog .stock-history-main { display:block; }
      .stock-dialog .stock-history small { opacity:.72; }
      </style>
    `;

    const dlg = new DialogV2({
      window: { title: game.i18n.localize("DX3rd.Stock") },
      content,
      buttons: [
        {
          action: 'confirm',
          icon: 'fas fa-check',
          label: game.i18n.localize("DX3rd.Confirm"),
          default: true,
          callback: async (event, button, dialog) => {
            const adjustmentField = dialog.element.querySelector("#stock-adjustment");
            const reasonField = dialog.element.querySelector("#stock-reason");
            const delta = Number(String(adjustmentField?.value || '').trim());
            const reason = String(reasonField?.value || '').trim();
            if (!Number.isFinite(delta) || !Number.isInteger(delta) || delta === 0) {
              ui.notifications.warn(game.i18n.localize("DX3rd.StockAdjustmentInvalid"));
              return false;
            }
            if (!reason) {
              ui.notifications.warn(game.i18n.localize("DX3rd.StockReasonRequired"));
              return false;
            }
            const nextStock = currentStock + delta;
            if (nextStock < (Number(stock.min) || 0)) {
              ui.notifications.warn(game.i18n.localize("DX3rd.StockBelowMinimum"));
              return false;
            }

            const entry = {
              id: foundry.utils.randomID(),
              createdAt: Date.now(),
              userId: game.user.id,
              userName: game.user.name,
              reason,
              delta,
              before: currentStock,
              after: nextStock
            };
            await actor.update({
              // 표시 중인 current는 최소값 클램프를 거친 값일 수 있다. 기존 modifier에
              // 단순 가산하면 숨은 음수 잔액 때문에 +1을 입력해도 화면이 0에 머문다.
              // 사용자가 확인한 nextStock을 정본으로 삼아 base와의 차이를 다시 저장한다.
              "system.attributes.stock.modifier": nextStock - baseStock,
              "flags.dx3rd-emanim.stockHistory": [...history, entry].slice(-100)
            });
            const messageContent = `<div class="dx3rd-item-chat"><p>${escapeHTML(game.i18n.format("DX3rd.StockAdjusted", {
              reason,
              delta: signedString(delta),
              before: currentStock,
              after: nextStock
            }))}</p></div>`;
            await ChatMessage.create({
              content: messageContent,
              speaker: ChatMessage.getSpeaker({ actor })
            });
            return true;
          }
        },
        {
          action: 'cancel',
          icon: 'fas fa-times',
          label: game.i18n.localize("DX3rd.Cancel")
        }
      ]
    });
    await dlg.render(true);

    const adjustmentInput = dlg.element.querySelector("#stock-adjustment");
    adjustmentInput?.addEventListener('input', () => applyAutoSign(adjustmentInput));
    adjustmentInput?.select();

    return dlg;
  }

  // ── 액터 타입 선택 ────────────────────────────────────────────────────

  async function openActorType(actor) {
    const DialogV2 = getDialogV2();
    if (!DialogV2) {
      ui.notifications.error(game.i18n.localize('DX3rd.DialogV2Unavailable'));
      return;
    }

    let defaultType = "NPC";
    if (actor.type === 'enemy') defaultType = "Troop";
    const currentType = actor.system.actorType || defaultType;

    const content = await foundry.applications.handlebars.renderTemplate(`${TEMPLATE_BASE}/actor-type-dialog.html`, { currentType });

    return DialogV2.wait({
      window: { title: game.i18n.localize("DX3rd.ActorType") },
      content,
      rejectClose: false,
      buttons: [
        {
          action: 'confirm',
          icon: 'fas fa-check',
          label: game.i18n.localize("DX3rd.Confirm"),
          default: true,
          callback: async (event, button, dialog) => {
            const selectedType = dialog.element.querySelector("#actor-type-select")?.value;
            await actor.update({ "system.actorType": selectedType });
            ui.notifications.info(`액터 타입이 ${game.i18n.localize("DX3rd." + selectedType)}(으)로 변경되었습니다.`);
          }
        },
        {
          action: 'cancel',
          icon: 'fas fa-times',
          label: game.i18n.localize("DX3rd.Cancel")
        }
      ]
    });
  }

  window.DX3rdActorEditDialogs = { openAbility, openStock, openActorType };
})();
