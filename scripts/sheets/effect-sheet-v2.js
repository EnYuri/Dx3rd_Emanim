/** Effect item AppV2 pilot sheet. */
(function() {
  const Base = window.DX3rdActiveItemSheetV2;
  const compat = window.DX3rdApplicationCompat;
  const weaponManager = window.DX3rdWeaponTabManager;
  const itemSheetData = window.DX3rdItemSheetData;
  if (!Base || !compat || !weaponManager || !itemSheetData) return;

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

      system.level = itemSheetData.prepareEffectLevelData(this.item, actor, this.item.system.level || {});

      system.used ??= {};
      system.used.state ??= 0;
      system.used.max ??= 0;
      system.used.level ??= false;
      system.used.disable ??= 'notCheck';
      system.exp ??= {own: false, upgrade: false};
      system.exp.own ??= false;
      system.exp.upgrade ??= false;
      system.macros = itemSheetData.getEmbeddedMacros(this.item);
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

    async _toggleWeaponSelection(event) {
      if (event.target.checked) await this.item.update({'system.weapon': []});
      this.render(false);
    }

    async _toggleDifficulty(checked) {
      await this.item.update(itemSheetData.getRollDifficultyToggleUpdate(this.item, checked));
      this.render(false);
    }

    async _normalizeRoll(value) {
      const update = itemSheetData.getRollChangeUpdate(value);
      if (Object.keys(update).length) await this.item.update(update);
    }

    async _validateDifficulty(event) {
      const value = event.target.value.trim();
      if (!value) return;
      if (itemSheetData.isRollDifficultyValueValid(this.item, value)) return;
      event.target.value = '';
      await this.item.update({'system.difficulty': ''});
      ui.notifications.warn(itemSheetData.getRollDifficultyValidationMessage(this.item));
    }

    async _updateMacro(event, property) {
      const index = Number(event.target.dataset.index);
      const value = property === 'disabled' ? event.target.checked : event.target.value;
      await itemSheetData.updateEmbeddedMacro(this.item, index, property, value);
    }

    _prepareSubmitData(event, form, formData, updateData) {
      const data = super._prepareSubmitData(event, form, formData, updateData);
      const level = itemSheetData.prepareEffectLevelData(this.item, this.item.actor, data.system?.level || this.item.system.level || {});
      foundry.utils.setProperty(data, 'system.level', level);

      const submittedWeapons = Array.isArray(data.system?.weapon)
        ? data.system.weapon
        : (this.item.system.weapon || []);
      foundry.utils.setProperty(data, 'system.weapon', itemSheetData.normalizeIdList(submittedWeapons));
      if (Array.isArray(data.system?.getTarget)) {
        foundry.utils.setProperty(data, 'system.getTarget', data.system.getTarget.some(Boolean));
      }
      for (const [key, value] of Object.entries(itemSheetData.getRollChangeUpdate(data.system?.roll))) {
        foundry.utils.setProperty(data, key, value);
      }
      return data;
    }

    static async _onMacroAdd(event) {
      event.preventDefault();
      await itemSheetData.addEmbeddedMacro(this.item);
      this.render(false);
    }

    static async _onMacroDelete(event, target) {
      event.preventDefault();
      const index = Number(target.dataset.index);
      const updated = await itemSheetData.removeEmbeddedMacro(this.item, index);
      if (!updated) return;
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
