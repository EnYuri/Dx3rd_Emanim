(function() {
  const Base = window.DX3rdActiveItemSheetV2;
  if (!Base) return;

  class DX3rdVehicleSheetV2 extends Base {
    static DEFAULT_OPTIONS = {classes: ['vehicle-sheet-v2']};
    static PARTS = {main: {template: 'systems/dx3rd-emanim/templates/item/active-item-sheet-v2.html', root: true}};
    static TABS = {primary: {tabs: [{id: 'description'}, {id: 'attributes'}, {id: 'target'}], initial: 'description'}};

    async _prepareContext(options) {
      const context = await super._prepareContext(options);
      const system = context.system;
      system.skill ??= '-';
      system.attack ??= 0;
      system.init ??= 0;
      system.armor ??= 0;
      system.move ??= 0;
      system.equipment = system.equipment === true || system.equipment === 'on';
      system.skillOptions = window.DX3rdSkillManager?.getSkillSelectOptions?.(
        'vehicle', system.actorSkills
      ) || [];
      context.isVehicle = true;
      context.isEquipment = true;
      context.fixedActiveTiming = true;
      context.isOnce = false;
      return context;
    }
  }

  const ItemsClass = foundry.documents?.collections?.Items || Items;
  ItemsClass.registerSheet('dx3rd-emanim', DX3rdVehicleSheetV2, {
    label: 'DX3rd.SheetV2',
    types: ['vehicle'],
    makeDefault: false
  });
  window.DX3rdVehicleSheetV2 = DX3rdVehicleSheetV2;
})();
