/** Effect item AppV2 pilot sheet. */
(function() {
  const Base = window.DX3rdActiveItemSheetV2;
  const compat = window.DX3rdApplicationCompat;
  const weaponManager = window.DX3rdWeaponTabManager;
  if (!Base || !compat || !weaponManager) return;

  class DX3rdEffectSheetV2 extends Base {
    static DEFAULT_OPTIONS = {
      classes: ['effect-sheet-v2'],
      actions: {
        ...Base.DEFAULT_OPTIONS.actions,
        macroAdd: DX3rdEffectSheetV2._onMacroAdd,
        macroDelete: DX3rdEffectSheetV2._onMacroDelete
      }
    };

    static PARTS = {
      main: {template: 'systems/dx3rd-emanim/templates/item/effect-sheet-v2.html', root: true}
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
      system.actorSkills = actor?.system?.attributes?.skills || {};
      system.skillOptions = window.DX3rdSkillManager.getSkillSelectOptions('effect', system.actorSkills, actor?.type);

      system.level ??= {};
      system.level.init = Number(this.item.system.level?.init ?? 0);
      system.level.max = Number(this.item.system.level?.max ?? 1);
      system.level.upgrade = this.item.system.level?.upgrade ?? false;
      const encroachmentLevel = system.level.upgrade
        ? Number(actor?.system?.attributes?.encroachment?.level) || 0
        : 0;
      system.level.value = system.level.init + encroachmentLevel;

      system.used ??= {};
      system.used.state ??= 0;
      system.used.max ??= 0;
      system.used.level ??= false;
      system.used.disable ??= 'notCheck';
      system.exp ??= {own: false, upgrade: false};
      system.exp.own ??= false;
      system.exp.upgrade ??= false;
      system.macros = Array.isArray(this.item.system.macros) ? foundry.utils.deepClone(this.item.system.macros) : [];
      context.macroTimings = ['instant', 'afterSuccess', 'afterDamage', 'afterMain', 'onInvoke'];

      weaponManager.prepareWeaponTabData(context, this.item);
      return context;
    }

    async _onRender(context, options) {
      await super._onRender(context, options);
      this._listenerCleanups?.forEach(cleanup => cleanup());
      this._listenerCleanups = weaponManager.setupWeaponTabListeners(this.element, this) || [];
      const listen = (...args) => this._listenerCleanups.push(compat.on(this.element, ...args));
      listen('change', 'input[name="system.weaponSelect"]', event => this._toggleWeaponSelection(event));
      listen('change', '.difficulty-check', event => this._toggleDifficulty(event.target.checked));
      listen('change', 'select[name="system.roll"]', event => this._normalizeRoll(event.target.value));
      listen('blur', '.difficulty-input', event => this._validateDifficulty(event));
      listen('change', '[data-target-field="system.getTarget"]', event => {
        this.item.update({'system.getTarget': event.target.checked});
      });
      listen('change', '.macro-timing', event => this._updateMacro(event, 'timing'));
      listen('change', '.macro-disabled', event => this._updateMacro(event, 'disabled'));
      listen('change', '.macro-command', event => this._updateMacro(event, 'command'));
    }

    _macros() {
      return Array.isArray(this.item.system.macros) ? foundry.utils.deepClone(this.item.system.macros) : [];
    }

    async _toggleWeaponSelection(event) {
      if (event.target.checked) await this.item.update({'system.weapon': []});
      this.render(false);
    }

    async _toggleDifficulty(checked) {
      if (checked) {
        await this.item.update({'system.roll': 'major', 'system.difficulty': ''});
      } else {
        const freepass = game.i18n.localize('DX3rd.Freepass');
        const current = this.item.system.difficulty || '';
        await this.item.update({
          'system.roll': '-',
          'system.difficulty': current === freepass || current === '-' ? current : freepass,
          'system.attackRoll': '-'
        });
      }
      this.render(false);
    }

    async _normalizeRoll(value) {
      if (value === '-' || value === 'dodge') await this.item.update({'system.attackRoll': '-'});
    }

    async _validateDifficulty(event) {
      const value = event.target.value.trim();
      if (!value) return;
      const roll = this.item.system.roll || '-';
      const freepass = game.i18n.localize('DX3rd.Freepass');
      const competition = game.i18n.localize('DX3rd.Competition');
      const reference = game.i18n.localize('DX3rd.Reference');
      const number = Number(value);
      const valid = roll === '-'
        ? value === freepass || value === '-'
        : (Number.isInteger(number) && number >= 1) || value === competition || value === reference;
      if (valid) return;
      event.target.value = '';
      await this.item.update({'system.difficulty': ''});
      ui.notifications.warn('현재 판정 설정에 사용할 수 없는 난이도입니다.');
    }

    async _updateMacro(event, property) {
      const index = Number(event.target.dataset.index);
      const macros = this._macros();
      if (!macros[index]) return;
      macros[index][property] = property === 'disabled' ? event.target.checked : event.target.value;
      await this.item.update({'system.macros': macros});
    }

    _prepareSubmitData(event, form, formData, updateData) {
      const data = super._prepareSubmitData(event, form, formData, updateData);
      const level = data.system?.level || this.item.system.level || {};
      const rawLevelInit = Number(level.init ?? 0);
      const rawLevelMax = Number(level.max ?? 1);
      const levelInit = Number.isFinite(rawLevelInit) ? rawLevelInit : 0;
      const levelMax = Number.isFinite(rawLevelMax) ? rawLevelMax : 1;
      const levelUpgrade = Boolean(level.upgrade);
      const encroachmentLevel = levelUpgrade
        ? Number(this.item.actor?.system?.attributes?.encroachment?.level) || 0
        : 0;
      foundry.utils.setProperty(data, 'system.level', {
        ...level,
        init: levelInit,
        max: levelMax,
        upgrade: levelUpgrade,
        value: levelInit + encroachmentLevel
      });

      const submittedWeapons = Array.isArray(data.system?.weapon)
        ? data.system.weapon
        : (this.item.system.weapon || []);
      foundry.utils.setProperty(data, 'system.weapon', submittedWeapons.filter(id => id && id !== '-'));
      if (Array.isArray(data.system?.getTarget)) {
        foundry.utils.setProperty(data, 'system.getTarget', data.system.getTarget.some(Boolean));
      }
      if (data.system?.roll === '-' || data.system?.roll === 'dodge') {
        foundry.utils.setProperty(data, 'system.attackRoll', '-');
      }
      return data;
    }

    static async _onMacroAdd(event) {
      event.preventDefault();
      const macros = this._macros();
      macros.push({timing: 'instant', command: '', disabled: false});
      await this.item.update({'system.macros': macros});
      this.render(false);
    }

    static async _onMacroDelete(event, target) {
      event.preventDefault();
      const index = Number(target.dataset.index);
      const macros = this._macros();
      if (index < 0 || index >= macros.length) return;
      macros.splice(index, 1);
      await this.item.update({'system.macros': macros});
      this.render(false);
    }
  }

  const ItemsClass = foundry.documents?.collections?.Items || Items;
  ItemsClass.registerSheet('dx3rd-emanim', DX3rdEffectSheetV2, {
    label: 'DX3rd.AppV2PilotSheet',
    types: ['effect'],
    makeDefault: false
  });
  window.DX3rdEffectSheetV2 = DX3rdEffectSheetV2;
})();
