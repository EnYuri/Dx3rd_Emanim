(function() {
  const Base = window.DX3rdActiveItemSheetV2;
  if (!Base) return;
  class DX3rdOnceSheetV2 extends Base {
    static DEFAULT_OPTIONS = {...Base.DEFAULT_OPTIONS, classes: ['once-sheet-v2']};
    static PARTS = {main: {template: 'systems/dx3rd-emanim/templates/item/active-item-sheet-v2.html', root: true}};
    static TABS = {primary: {tabs: [{id: 'description'}, {id: 'immediate'}, {id: 'persistent'}], initial: 'description'}};
    async _prepareContext(options) {
      const context = await super._prepareContext(options);
      context.system.type ||= 'once';
      context.system.quantity ??= 1;
      context.displayType = 'DX3rd.Once';
      context.isOnce = true;
      return context;
    }
    _prepareSubmitData(event, form, formData, updateData) {
      const data = super._prepareSubmitData(event, form, formData, updateData);
      if (data.system.used?.disable !== 'notCheck'
          && ['system.quantity', 'system.used.disable'].includes(event?.target?.name)) {
        data.system.used.max = Number(data.system.quantity) || 1;
      }
      return data;
    }
  }
  const ItemsClass = foundry.documents?.collections?.Items || Items;
  ItemsClass.registerSheet('dx3rd-emanim', DX3rdOnceSheetV2, {label: 'DX3rd.SheetV2', types: ['once'], makeDefault: true});
  window.DX3rdOnceSheetV2 = DX3rdOnceSheetV2;
})();
