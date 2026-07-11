/** Psionic item AppV2 sheet. */
(function() {
  const Base = window.DX3rdActiveItemSheetV2;
  const compat = window.DX3rdApplicationCompat;
  const weaponManager = window.DX3rdWeaponTabManager;
  const itemSheetData = window.DX3rdItemSheetData;
  if (!Base || !compat || !weaponManager || !itemSheetData) return;

  class DX3rdPsionicSheetV2 extends Base {
    static DEFAULT_OPTIONS = {classes: ['psionic-sheet-v2']};

    static PARTS = {
      main: {template: 'systems/dx3rd-emanim/templates/item/psionic-sheet-v2.html', root: true}
    };

    static TABS = {primary: {
      tabs: [{id: 'description'}, {id: 'attributes'}, {id: 'target'}, {id: 'weapon'}],
      initial: 'description'
    }};

    async _prepareContext(options) {
      const context = await super._prepareContext(options);
      const {system} = context;
      const actor = this.item.actor;

      context.actor = actor ? {id: actor.id, type: actor.type, system: actor.system} : null;
      system.skillOptions = window.DX3rdSkillManager.getSkillSelectOptions(
        'psionic',
        actor?.system?.attributes?.skills || {},
        actor?.type
      );

      system.level = itemSheetData.preparePsionicLevelData(this.item, system.level || this.item.system?.level || {});
      system.hp ??= {value: ''};
      system.hp.value ??= '';
      system.skill ??= '-';
      system.difficulty ??= '';
      system.limit ??= '';
      system.timing ??= '-';
      system.range ??= '';
      system.target ??= '';
      system.type ??= 'normal';
      system.roll ??= '-';
      system.attackRoll ??= '-';
      system.exp ??= {own: false, upgrade: false};
      system.exp.own ??= false;
      system.exp.upgrade ??= false;
      system.used ??= {state: 0, max: 0, level: false, disable: 'notCheck'};
      system.used.state ??= 0;
      system.used.max ??= 0;
      system.used.level ??= false;
      system.used.disable ??= 'notCheck';
      system.active.runTiming ??= 'instant';

      weaponManager.prepareWeaponTabData(context, this.item);
      return context;
    }

    async _onRender(context, options) {
      await super._onRender(context, options);
      this._psionicCleanups?.forEach(cleanup => cleanup());
      this._psionicCleanups = weaponManager.setupWeaponTabListeners(this.element, this) || [];
      const listen = (...args) => this._psionicCleanups.push(compat.on(this.element, ...args));

      listen('change', 'input[name="system.weaponSelect"]', async event => {
        if (event.target.checked) await this.item.update({'system.weapon': []});
        this.render(false);
      });
      listen('blur', '.difficulty-input', event => this._validateDifficulty(event));
    }

    async _validateDifficulty(event) {
      const value = event.target.value.trim();
      if (!value) return;
      if (itemSheetData.isRollDifficultyValueValid(this.item, value)) return;
      event.target.value = '';
      await this.item.update({'system.difficulty': ''});
      ui.notifications.warn(itemSheetData.getRollDifficultyValidationMessage(this.item));
    }

    _prepareSubmitData(event, form, formData, updateData) {
      const data = super._prepareSubmitData(event, form, formData, updateData);

      // 레벨: value = init 고정(침식 보정 없음)
      const level = itemSheetData.preparePsionicLevelData(this.item, data.system?.level || this.item.system.level || {});
      foundry.utils.setProperty(data, 'system.level.init', level.init);
      foundry.utils.setProperty(data, 'system.level.max', level.max);
      if (data.system?.level) delete data.system.level.value;
      if (event?.target?.name === 'system.level.init') {
        foundry.utils.setProperty(data, 'system.level.value', level.value);
      }

      // roll 변경 → 난이도/attackRoll 연동
      for (const [key, value] of Object.entries(itemSheetData.getRollChangeUpdate(data.system?.roll))) {
        foundry.utils.setProperty(data, key, value);
      }

      // 난이도 체크박스(name 없음) 토글
      if (event?.target?.matches?.('.difficulty-check')) {
        const update = itemSheetData.getRollDifficultyToggleUpdate(this.item, event.target.checked);
        for (const [key, value] of Object.entries(update)) {
          foundry.utils.setProperty(data, key, value);
        }
      }

      // 무기 목록 정규화
      const submittedWeapons = Array.isArray(data.system?.weapon)
        ? data.system.weapon
        : (this.item.system.weapon || []);
      foundry.utils.setProperty(data, 'system.weapon', itemSheetData.normalizeIdList(submittedWeapons));
      return data;
    }
  }

  const ItemsClass = foundry.documents?.collections?.Items || Items;
  ItemsClass.registerSheet('dx3rd-emanim', DX3rdPsionicSheetV2, {
    label: 'DX3rd.SheetV2',
    types: ['psionic'],
    makeDefault: false
  });
  window.DX3rdPsionicSheetV2 = DX3rdPsionicSheetV2;
})();
