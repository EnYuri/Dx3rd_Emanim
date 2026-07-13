(function() {
  const Base = window.DX3rdActiveItemSheetV2;
  if (!Base) return;
  class DX3rdEtcSheetV2 extends Base {
    static DEFAULT_OPTIONS = {classes: ['etc-sheet-v2']};
    static PARTS = {main: {template: 'systems/dx3rd-emanim/templates/item/active-item-sheet-v2.html', root: true}};
    static TABS = {primary: {tabs: [{id: 'description'}, {id: 'attributes'}, {id: 'target'}], initial: 'description'}};
    async _prepareContext(options) {
      const context = await super._prepareContext(options);
      context.system.type ||= 'etc';
      context.displayType = 'DX3rd.Etc';
      context.isOnce = false;
      return context;
    }
  }
  const ItemsClass = foundry.documents?.collections?.Items || Items;
  ItemsClass.registerSheet('dx3rd-emanim', DX3rdEtcSheetV2, {label: 'DX3rd.SheetV2', types: ['etc'], makeDefault: true});
  window.DX3rdEtcSheetV2 = DX3rdEtcSheetV2;
})();
