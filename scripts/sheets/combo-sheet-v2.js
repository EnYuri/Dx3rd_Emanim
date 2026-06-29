/** Combo item AppV2 pilot sheet. */
(function() {
  const Base = window.DX3rdActiveItemSheetV2;
  const compat = window.DX3rdApplicationCompat;
  const comboData = window.DX3rdComboData;
  if (!Base || !compat || !comboData) return;

  class DX3rdComboSheetV2 extends Base {
    static DEFAULT_OPTIONS = {classes: ['combo-sheet-v2']};
    static PARTS = {main: {template: 'systems/dx3rd-emanim/templates/item/combo-sheet-v2.html', root: true}};
    static TABS = {primary: {
      tabs: [{id: 'description'}, {id: 'effect'}, {id: 'weapon'}, {id: 'attributes'}, {id: 'target'}],
      initial: 'description'
    }};

    async _prepareContext(options) {
      const context = await super._prepareContext(options);
      await comboData.prepareSheetData(context, this.item, this.item.actor);
      context.enrichedDescription ??= context.enrichedBiography || context.system.description || '';
      return context;
    }

    async _onRender(context, options) {
      await super._onRender(context, options);
      this._listenerCleanups?.forEach(cleanup => cleanup());
      this._listenerCleanups = window.DX3rdWeaponTabManager.setupWeaponTabListeners(this.element, this) || [];
      const listen = (...args) => this._listenerCleanups.push(compat.on(this.element, ...args));

      listen('click', '.tab[data-tab="effect"] .add-effect', event => this._addEffect(event));
      listen('click', '.tab[data-tab="effect"] .item-edit', (event, target) => this._editEffect(event, target));
      listen('click', '.tab[data-tab="effect"] .item-delete', (event, target) => this._deleteEffect(event, target));
      listen('change', 'input[name="system.weaponSelect"]', event => this._toggleWeaponSelection(event));
      listen('change', 'select[name="system.skill"]', event => this._updateBaseAttribute(event.target.value));
      listen('change', 'select[name="system.roll"]', event => this._normalizeRoll(event.target.value));
      listen('change', '[data-target-field="system.getTarget"]', event => {
        this.item.update({'system.getTarget': event.target.checked});
      });
      listen('change', '.difficulty-check', event => this._toggleDifficulty(event.target.checked));
      listen('blur', '.difficulty-input', event => this._validateDifficulty(event));
      listen('input', 'input[name="system.limit"]', event => this._validateLimit(event));
    }

    _effectIds() {
      return comboData.getEffectIds(this.item);
    }

    async _addEffect(event) {
      event.preventDefault();
      const id = compat.query(this.element, '#actor-effect')?.value;
      const updated = await comboData.addRegisteredEffect(this.item, this.item.actor, id);
      if (!updated) return;
      this.render(false);
    }

    _editEffect(event, target) {
      event.preventDefault();
      const id = compat.closest(target, '.item', this.element)?.dataset.itemId;
      comboData.openRegisteredEffectSheet(this.item.actor, id);
    }

    async _deleteEffect(event, target) {
      event.preventDefault();
      const id = compat.closest(target, '.item', this.element)?.dataset.itemId;
      const updated = await comboData.removeRegisteredEffect(this.item, this.item.actor, id);
      if (!updated) return;
      this.render(false);
    }

    async _toggleWeaponSelection(event) {
      if (event.target.checked) await this.item.update({'system.weapon': []});
      this.render(false);
    }

    async _updateBaseAttribute(skill) {
      await comboData.updateBaseAttributeForSkill(this.item, this.item.actor, skill);
    }

    async _normalizeRoll(value) {
      if (value === '-' || value === 'dodge') await this.item.update({'system.attackRoll': '-'});
    }

    async _toggleDifficulty(checked) {
      await this.item.update(comboData.getDifficultyToggleUpdate(this.item, checked));
      this.render(false);
    }

    async _validateDifficulty(event) {
      const value = event.target.value.trim();
      if (!value) return;
      if (comboData.isDifficultyValueValid(this.item, value)) return;
      event.target.value = '';
      await this.item.update({'system.difficulty': ''});
      ui.notifications.warn(comboData.getDifficultyValidationMessage(this.item));
    }

    _validateLimit(event) {
      if (comboData.isLimitValueValid(event.target.value)) return;
      event.target.value = this.item.system.limit || '-';
      ui.notifications.warn("제한은 '-', 숫자, 또는 숫자%만 입력 가능합니다.");
    }

    _prepareSubmitData(event, form, formData, updateData) {
      const data = super._prepareSubmitData(event, form, formData, updateData);
      const system = data.system || {};
      if (Array.isArray(system.getTarget)) system.getTarget = system.getTarget.some(Boolean);
      const submitValues = comboData.prepareSubmittedCombatValues(this.item, this.item.actor, {
        effectIds: Array.isArray(system.effectIds) ? system.effectIds : this._effectIds(),
        weapons: system.weapon,
        attackRoll: system.attackRoll
      });
      foundry.utils.setProperty(data, 'system.effectIds', submitValues.effectIds);
      foundry.utils.setProperty(data, 'system.encroach.value', submitValues.encroachValue);
      foundry.utils.setProperty(data, 'system.weapon', submitValues.weapons);
      foundry.utils.setProperty(data, 'system.attack.value', submitValues.attackValue);
      return data;
    }
  }

  const ItemsClass = foundry.documents?.collections?.Items || Items;
  ItemsClass.registerSheet('dx3rd-emanim', DX3rdComboSheetV2, {
    label: 'DX3rd.AppV2PilotSheet',
    types: ['combo'],
    makeDefault: false
  });
  window.DX3rdComboSheetV2 = DX3rdComboSheetV2;
})();
