/**
 * Connection item AppV2 pilot sheet.
 * The 이전 시트 connection sheet remains the default until parity testing is complete.
 */
(function() {
  const ItemSheetV2 = window.DX3rdItemSheetV2;
  const compat = window.DX3rdApplicationCompat;
  const attributes = window.DX3rdAttributeManager;
  if (!ItemSheetV2 || !compat || !attributes) {
    console.warn('DX3rd | AppV2 connection sheet is unavailable in this Foundry version.');
    return;
  }

  class DX3rdConnectionSheetV2 extends ItemSheetV2 {
    static DEFAULT_OPTIONS = {
      classes: ['connection-sheet-v2'],
      actions: {
        createAttribute: DX3rdConnectionSheetV2._onCreateAttribute,
        deleteAttribute: DX3rdConnectionSheetV2._onDeleteAttribute
      }
    };

    static PARTS = {
      main: {
        template: 'systems/dx3rd-emanim/templates/item/connection-sheet-v2.html',
        root: true
      }
    };

    static TABS = {
      primary: {
        tabs: [{id: 'description'}, {id: 'attributes'}],
        initial: 'description'
      }
    };

    async _prepareContext(options) {
      const context = await super._prepareContext(options);
      const system = context.system;
      const actorSkills = this.item.actor?.system?.attributes?.skills || {};

      system.description ??= '';
      system.skill ??= '-';
      system.exp ??= 0;
      system.macro ??= '';
      system.saving ??= {};
      system.saving.difficulty ??= '';
      system.saving.value ??= 0;
      system.active ??= {};
      system.active.state ??= false;
      system.active.disable ??= '-';
      system.active.runTiming ??= 'instant';
      system.attributes ??= {};
      system.actorSkills = actorSkills;
      system.skillOptions = window.DX3rdSkillManager.getSkillSelectOptions('connection', actorSkills);

      return context;
    }

    async _onRender(context, options) {
      await super._onRender(context, options);
      await attributes.initializeAttributeLabels(this.element, this.item);
      compat.on(this.element, 'input', '.attribute-value', (event, target) => this._validateFormulaInput(target));
      this._refreshFormulaValidation();
    }

    _validateFormulaInput(input) {
      const row = compat.closest(input, '.attribute', this.element);
      const label = compat.query(row, '.attribute-label')?.value;
      const key = compat.query(row, '.attribute-key')?.value;
      let result = window.DX3rdFormulaEvaluator.validateDeterministicFormula(input.value, key);
      if (result.valid && label && input.name.startsWith('system.attributes.')) {
        result = window.DX3rdFormulaEvaluator.validateCircularReference(input.value, label, this.item.actor, key);
      }
      window.DX3rdFormulaEvaluator.setInputValidationState(input, result);
      return result;
    }

    _refreshFormulaValidation() {
      compat.queryAll(this.element, '.attribute-value').forEach(input => this._validateFormulaInput(input));
    }

    _prepareSubmitData(event, form, formData, updateData) {
      const changed = event?.target;
      if (changed?.name?.endsWith('.value') && (changed.name.startsWith('system.attributes.') || changed.name.startsWith('system.effect.attributes.'))) {
        this._validateFormulaInput(changed);
      }

      const submitData = super._prepareSubmitData(event, form, formData, updateData);
      if (submitData.system.used?.disable === 'notCheck') {
        submitData.system.used.state = 0;
        submitData.system.used.max = 0;
      }
      // disable 를 notCheck 로 "바꾸는 순간"에만 active.state 를 끈다(V1 _onActiveDisableChange 와 동일).
      // 매 서브밋마다 끄면 notCheck 아이템은 시트에서 활성화를 켤 수 없다.
      if (changed?.name === 'system.active.disable' && submitData.system.active?.disable === 'notCheck') {
        submitData.system.active.state = false;
      }
      return submitData;
    }

    static async _onCreateAttribute(event, target) {
      event.preventDefault();
      const position = target.dataset.pos || 'main';
      await attributes.createAttribute(this.item, position);
      this.render(false);
    }

    static async _onDeleteAttribute(event, target) {
      event.preventDefault();
      const row = compat.closest(target, '.attribute', this.element);
      const list = compat.closest(target, '.attributes-list', this.element);
      const attributeKey = row?.dataset.attribute;
      if (!attributeKey) return;
      await attributes.deleteAttribute(this.item, attributeKey, list?.dataset.pos || 'main');
      this.render(false);
    }
  }

  const ItemsClass = foundry.documents?.collections?.Items || Items;
  ItemsClass.registerSheet('dx3rd-emanim', DX3rdConnectionSheetV2, {
    label: 'DX3rd.SheetV2',
    types: ['connection'],
    makeDefault: true
  });

  window.DX3rdConnectionSheetV2 = DX3rdConnectionSheetV2;
})();
