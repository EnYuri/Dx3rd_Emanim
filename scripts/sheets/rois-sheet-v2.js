/**
 * Rois item AppV2 sheet.
 */
(function() {
  const ItemSheetV2 = window.DX3rdItemSheetV2;
  const compat = window.DX3rdApplicationCompat;
  const attributes = window.DX3rdAttributeManager;
  if (!ItemSheetV2 || !compat || !attributes) {
    console.warn('DX3rd | AppV2 rois sheet is unavailable in this Foundry version.');
    return;
  }

  class DX3rdRoisSheetV2 extends ItemSheetV2 {
    static DEFAULT_OPTIONS = {
      classes: ['rois-sheet-v2'],
      actions: {
        createAttribute: DX3rdRoisSheetV2._onCreateAttribute,
        deleteAttribute: DX3rdRoisSheetV2._onDeleteAttribute
      }
    };

    static PARTS = {
      main: {
        template: 'systems/dx3rd-emanim/templates/item/rois-sheet-v2.html',
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

      system.description ??= '';
      system.type ??= '-';
      system.positive ??= {};
      system.positive.state ??= false;
      system.positive.feeling ??= '';
      system.negative ??= {};
      system.negative.state ??= false;
      system.negative.feeling ??= '';
      system.actor ??= null;
      system.titus ??= false;
      system.sublimation ??= false;

      // 자체 효과(상시/토글 버프) 저작 필드.
      system.attributes ??= {};
      system.active ??= {};
      system.active.state ??= false;
      system.active.disable ??= '-';
      system.active.runTiming ??= 'instant';
      system.used ??= {};
      system.used.state ??= 0;
      system.used.max ??= 0;
      system.used.disable ??= 'notCheck';

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
      const changedName = changed?.name;
      if (changedName?.endsWith('.value') && changedName.startsWith('system.attributes.')) {
        this._validateFormulaInput(changed);
      }

      const submitData = super._prepareSubmitData(event, form, formData, updateData);

      if ((changedName === 'system.positive.state') && changed.checked) {
        submitData.system.negative.state = false;
      }
      if ((changedName === 'system.negative.state') && changed.checked) {
        submitData.system.positive.state = false;
      }
      if (changedName === 'system.titus' && !changed.checked) {
        submitData.system.sublimation = false;
      }
      if (changedName === 'system.sublimation' && changed.checked && !submitData.system.titus) {
        submitData.system.sublimation = false;
        ui.notifications.warn(game.i18n.localize('DX3rd.SublimationRequiresTitus'));
      }
      if (submitData.system.type === 'M') {
        submitData.system.titus = false;
        submitData.system.sublimation = false;
      }

      if (submitData.system.used?.disable === 'notCheck') {
        submitData.system.used.state = 0;
        submitData.system.used.max = 0;
      }
      // disable 를 notCheck 로 "바꾸는 순간"에만 active.state 를 끈다.
      // 매 서브밋마다 끄면 notCheck(상시) 아이템은 시트에서 활성화를 켤 수 없다.
      if (changedName === 'system.active.disable' && submitData.system.active?.disable === 'notCheck') {
        submitData.system.active.state = false;
      }

      return submitData;
    }

    static async _onCreateAttribute(event, target) {
      event.preventDefault();
      await attributes.createAttribute(this.item, target.dataset.pos || 'main');
      this.render(false);
    }

    static async _onDeleteAttribute(event, target) {
      event.preventDefault();
      const row = compat.closest(target, '.attribute', this.element);
      const list = compat.closest(target, '.attributes-list', this.element);
      if (!row?.dataset.attribute) return;
      await attributes.deleteAttribute(this.item, row.dataset.attribute, list?.dataset.pos || 'main');
      this.render(false);
    }
  }

  const ItemsClass = foundry.documents?.collections?.Items || Items;
  ItemsClass.registerSheet('dx3rd-emanim', DX3rdRoisSheetV2, {
    label: 'DX3rd.SheetV2',
    types: ['rois'],
    makeDefault: true
  });

  window.DX3rdRoisSheetV2 = DX3rdRoisSheetV2;
})();
