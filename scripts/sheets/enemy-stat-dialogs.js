/**
 * Double Cross 3rd 에너미(Troop) 스탯 수정 다이얼로그 공유 모듈.
 *
 * 이전 시트 액터 시트와 AppV2 파일럿 시트가 동일한 에너미 스탯 수정 흐름을 공유하도록
 * `scripts/sheets/actor-sheet.js`에서 추출한 것이다. 내부 다이얼로그는 레거시 이전 시트
 * `Dialog` 대신 `DialogV2`를 사용하지만, 보너스 계산(아이템/Applied 효과 합산)과
 * 액터 업데이트 동작(라이브 편집)은 원본과 동일하게 유지한다.
 *
 * 공개 API: `window.DX3rdEnemyStatDialogs.open(actor, stat)`
 *   stat ∈ "hp" | "init" | "move" | "evasion" | "armor"
 */
(function() {
  const TEMPLATE_BASE = "systems/dx3rd-emanim/templates/dialog";

  function getDialogV2() {
    return foundry.applications?.api?.DialogV2;
  }

  /** 활성화된 combo/effect 아이템 목록. */
  function activeItems(actor) {
    return actor.items.filter(item =>
      item.system?.active?.state === true &&
      ['combo', 'effect'].includes(item.type)
    );
  }

  /** 활성 아이템 속성에서 지정한 key들의 보너스를 합산한다. */
  function sumItemBonus(actor, keys, multiplier = 1) {
    let sum = 0;
    for (const item of activeItems(actor)) {
      const attributes = item.system?.attributes;
      if (!attributes) continue;
      for (const attrData of Object.values(attributes)) {
        if (keys.includes(attrData.key) && attrData.value) {
          sum += window.DX3rdFormulaEvaluator.evaluate(attrData.value, item, actor) * multiplier;
        }
      }
    }
    return sum;
  }

  /** Applied 효과 속성에서 지정한 key들의 보너스를 합산한다. */
  function sumAppliedBonus(actor, keys, multiplier = 1) {
    let sum = 0;
    const applied = window.DX3rdAppliedEffects?.collect
      ? window.DX3rdAppliedEffects.collect(actor)
      : (actor.system.attributes.applied || {});
    for (const effect of Object.values(applied)) {
      if (!effect || !effect.attributes) continue;
      for (const [attrName, attrValue] of Object.entries(effect.attributes)) {
        const key = (typeof attrValue === 'object') ? attrValue.key : attrName;
        const val = (typeof attrValue === 'object' && 'value' in attrValue) ? attrValue.value :
                    (typeof attrValue === 'boolean') ? 0 :
                    window.DX3rdFormulaEvaluator.evaluate(attrValue);
        if (keys.includes(key)) sum += (Number(val) || 0) * multiplier;
      }
    }
    return sum;
  }

  /** 보너스를 양수일 때 +부호로 표기. */
  function signed(value) {
    return value > 0 ? `+${value}` : `${value}`;
  }

  /**
   * 라이브 편집 다이얼로그를 띄운다. 렌더 후 `wire(rootElement)`에서 입력 리스너를
   * 직접 연결한다. 별도 확정 버튼 없이 입력 즉시 액터가 갱신되며 버튼은 닫기 전용이다.
   */
  async function openLiveDialog(actor, { title, template, context, wire }) {
    const DialogV2 = getDialogV2();
    if (!DialogV2) {
      ui.notifications.error(game.i18n.localize('DX3rd.DialogV2Unavailable'));
      return;
    }
    const content = await foundry.applications.handlebars.renderTemplate(`${TEMPLATE_BASE}/${template}`, context);
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
    if (typeof wire === 'function') wire(dlg.element, actor);
    return dlg;
  }

  /** 권한·타입 가드. 통과하면 true. */
  function canEdit(actor) {
    if (!actor || actor.type !== 'enemy') return false;
    if (!window.DX3rdActorSheetData.hasOwnerPermission(actor)) {
      ui.notifications.warn(game.i18n.localize("DX3rd.NoPermission"));
      return false;
    }
    return true;
  }

  async function openHP(actor) {
    const attrs = actor.system.attributes;
    const hp = attrs.hp || {};
    const keys = ['hp', 'hp_max'];
    const itemBonus = sumItemBonus(actor, keys);
    const appliedBonus = sumAppliedBonus(actor, keys);
    const totalBonus = itemBonus + appliedBonus;
    const base = hp.base || 0;

    return openLiveDialog(actor, {
      title: game.i18n.localize("DX3rd.HP") + " 수정",
      template: "hp-dialog.html",
      context: { title: game.i18n.localize("DX3rd.HP") + " 수정", base, bonus: totalBonus, itemBonus, appliedBonus, total: base + totalBonus },
      wire: (root) => {
        const baseEl = root.querySelector("#hp-base");
        const totalEl = root.querySelector("#hp-total");
        baseEl?.addEventListener("input", () => {
          const b = Number(baseEl.value) || 0;
          if (totalEl) totalEl.value = b + totalBonus;
          actor.update({ "system.attributes.hp.base": b });
        });
      }
    });
  }

  async function openInit(actor) {
    const attrs = actor.system.attributes;
    const init = attrs.init || {};
    const keys = ['init', 'initiative'];
    const itemBonus = sumItemBonus(actor, keys);
    const appliedBonus = sumAppliedBonus(actor, keys);
    const totalBonus = itemBonus + appliedBonus;
    const base = init.base || 0;

    return openLiveDialog(actor, {
      title: game.i18n.localize("DX3rd.Init") + " 수정",
      template: "init-dialog.html",
      context: { title: game.i18n.localize("DX3rd.Init") + " 수정", base, bonus: totalBonus, itemBonus, appliedBonus, total: base + totalBonus },
      wire: (root) => {
        const baseEl = root.querySelector("#init-base");
        const totalEl = root.querySelector("#init-total");
        baseEl?.addEventListener("input", () => {
          const b = Number(baseEl.value) || 0;
          if (totalEl) totalEl.value = b + totalBonus;
          actor.update({ "system.attributes.init.base": b });
        });
      }
    });
  }

  async function openMove(actor) {
    const attrs = actor.system.attributes;
    const move = attrs.move || {};
    const battleKeys = ['move', 'move_battle', 'battleMove'];
    const fullKeys = ['move_full', 'fullMove'];
    const totalBattleBonus = sumItemBonus(actor, battleKeys) + sumAppliedBonus(actor, battleKeys);
    const totalFullBonus = sumItemBonus(actor, fullKeys) + sumAppliedBonus(actor, fullKeys);
    const base = move.base || 0;
    const battleTotal = base + totalBattleBonus;
    const fullTotal = battleTotal * 2 + totalFullBonus;
    const title = game.i18n.localize("DX3rd.Move") + " 수정";

    return openLiveDialog(actor, {
      title,
      template: "move-dialog.html",
      context: {
        title, base,
        battleBonus: totalBattleBonus, fullBonus: totalFullBonus,
        battleTotal, fullTotal
      },
      wire: (root) => {
        const baseEl = root.querySelector("#move-base");
        const battleTotalEl = root.querySelector("#move-battle-total");
        const fullTotalEl = root.querySelector("#move-full-total");
        baseEl?.addEventListener("input", () => {
          const b = Number(baseEl.value) || 0;
          const bt = b + totalBattleBonus;
          const ft = bt * 2 + totalFullBonus;
          if (battleTotalEl) battleTotalEl.value = bt;
          if (fullTotalEl) fullTotalEl.value = ft;
          actor.update({ "system.attributes.move.base": b });
        });
      }
    });
  }

  async function openEvasion(actor) {
    const attrs = actor.system.attributes;
    const evasion = attrs.evasion || {};
    const achievementKeys = ['dodge_add', 'dodge_achievement'];
    const totalAchievementBonus = sumItemBonus(actor, achievementKeys) + sumAppliedBonus(actor, achievementKeys);
    // 닷지 다이스 보정치는 ×2로 환산
    const totalDiceBonus = sumItemBonus(actor, ['dodge_dice'], 2) + sumAppliedBonus(actor, ['dodge_dice'], 2);
    const totalBonus = totalAchievementBonus + totalDiceBonus;
    const base = evasion.base || 0;
    const disabled = evasion.disabled || false;
    const title = game.i18n.localize("DX3rd.Evasion") + " 수정";

    return openLiveDialog(actor, {
      title,
      template: "evasion-dialog.html",
      context: {
        title, base, bonus: totalBonus,
        achievementBonus: totalAchievementBonus, diceBonus: totalDiceBonus,
        total: disabled ? '-' : (base + totalBonus),
        disabled
      },
      wire: (root) => {
        const baseEl = root.querySelector("#evasion-base");
        const totalEl = root.querySelector("#evasion-total");
        const disabledEl = root.querySelector("#evasion-disabled");
        const update = () => {
          const isDisabled = !!disabledEl?.checked;
          const b = Number(baseEl?.value) || 0;
          if (totalEl) totalEl.value = isDisabled ? '-' : (b + totalBonus);
          if (baseEl) baseEl.disabled = isDisabled;
          actor.update({
            "system.attributes.evasion.base": b,
            "system.attributes.evasion.disabled": isDisabled
          });
        };
        baseEl?.addEventListener("input", update);
        disabledEl?.addEventListener("change", update);
      }
    });
  }

  async function openArmor(actor) {
    const attrs = actor.system.attributes;
    const armor = attrs.armor || {};
    const keys = ['armor'];
    const itemBonus = sumItemBonus(actor, keys);
    const appliedBonus = sumAppliedBonus(actor, keys);
    const totalBonus = itemBonus + appliedBonus;
    const base = armor.base || 0;
    const title = game.i18n.localize("DX3rd.Armor") + " 수정";

    return openLiveDialog(actor, {
      title,
      template: "armor-dialog.html",
      context: { title, base, bonus: totalBonus, itemBonus, appliedBonus, total: Math.max(0, base + totalBonus) },
      wire: (root) => {
        const baseEl = root.querySelector("#armor-base");
        const totalEl = root.querySelector("#armor-total");
        baseEl?.addEventListener("input", () => {
          const b = Number(baseEl.value) || 0;
          if (totalEl) totalEl.value = Math.max(0, b + totalBonus);
          actor.update({ "system.attributes.armor.base": b });
        });
      }
    });
  }

  const HANDLERS = {
    hp: openHP,
    init: openInit,
    move: openMove,
    evasion: openEvasion,
    armor: openArmor
  };

  /**
   * 에너미 스탯 수정 다이얼로그를 연다.
   * @param {Actor} actor  대상 액터(enemy 타입이어야 함)
   * @param {string} stat  "hp" | "init" | "move" | "evasion" | "armor"
   */
  async function open(actor, stat) {
    if (!canEdit(actor)) return;
    const handler = HANDLERS[stat];
    if (!handler) {
      console.warn(`DX3rd | unknown enemy stat dialog: ${stat}`);
      return;
    }
    return handler(actor);
  }

  window.DX3rdEnemyStatDialogs = { open };
})();
