/**
 * Rois item AppV2 pilot sheet.
 * The AppV1 rois sheet remains the default until parity testing is complete.
 */
(function() {
  const ItemSheetV2 = window.DX3rdItemSheetV2;
  if (!ItemSheetV2) {
    console.warn('DX3rd | AppV2 rois sheet is unavailable in this Foundry version.');
    return;
  }

  class DX3rdRoisSheetV2 extends ItemSheetV2 {
    static DEFAULT_OPTIONS = {
      classes: ['rois-sheet-v2']
    };

    static PARTS = {
      main: {
        template: 'systems/dx3rd-emanim/templates/item/rois-sheet-v2.html',
        root: true
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

      return context;
    }

    _prepareSubmitData(event, form, formData, updateData) {
      const submitData = super._prepareSubmitData(event, form, formData, updateData);
      const changed = event?.target;
      const changedName = changed?.name;

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

      return submitData;
    }
  }

  const ItemsClass = foundry.documents?.collections?.Items || Items;
  ItemsClass.registerSheet('dx3rd-emanim', DX3rdRoisSheetV2, {
    label: 'DX3rd.AppV2PilotSheet',
    types: ['rois'],
    makeDefault: false
  });

  window.DX3rdRoisSheetV2 = DX3rdRoisSheetV2;
})();
