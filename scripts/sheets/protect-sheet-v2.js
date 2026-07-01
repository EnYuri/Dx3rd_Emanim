(function() {
  const Base = window.DX3rdActiveItemSheetV2;
  if (!Base) return;

  class DX3rdProtectSheetV2 extends Base {
    static DEFAULT_OPTIONS = {classes: ['protect-sheet-v2']};
    static PARTS = {main: {template: 'systems/dx3rd-emanim/templates/item/active-item-sheet-v2.html', root: true}};
    static TABS = {primary: {tabs: [{id: 'description'}, {id: 'attributes'}, {id: 'target'}], initial: 'description'}};

    async _prepareContext(options) {
      const context = await super._prepareContext(options);
      context.system.dodge ??= 0;
      context.system.init ??= 0;
      context.system.armor ??= 0;
      context.system.equipment = context.system.equipment === true || context.system.equipment === 'on';
      context.isProtect = true;
      context.isEquipment = true;
      context.fixedActiveTiming = true;
      context.isOnce = false;
      return context;
    }
  }

  const ItemsClass = foundry.documents?.collections?.Items || Items;
  ItemsClass.registerSheet('dx3rd-emanim', DX3rdProtectSheetV2, {
    label: 'DX3rd.SheetV2',
    types: ['protect'],
    makeDefault: false
  });
  window.DX3rdProtectSheetV2 = DX3rdProtectSheetV2;
})();
