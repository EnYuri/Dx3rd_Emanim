(function() {
  const Base = window.DX3rdActiveItemSheetV2;
  if (!Base) return;

  class DX3rdWeaponSheetV2 extends Base {
    static DEFAULT_OPTIONS = {classes: ['weapon-sheet-v2']};
    static PARTS = {main: {template: 'systems/dx3rd-emanim/templates/item/active-item-sheet-v2.html', root: true}};
    static TABS = {primary: {tabs: [{id: 'description'}, {id: 'attributes'}, {id: 'target'}], initial: 'description'}};

    async _prepareContext(options) {
      const context = await super._prepareContext(options);
      const system = context.system;
      system.type ??= '-';
      system.skill ??= '-';
      system.add ??= 0;
      system.attack ??= 0;
      system.guard ??= 0;
      system.range ??= '';
      system.equipment = system.equipment === true || system.equipment === 'on';
      system['attack-used'] ??= {state: 0, max: 0, disable: 'notCheck'};
      system['attack-used'].state ??= 0;
      system['attack-used'].max ??= 0;
      system['attack-used'].disable ??= 'notCheck';
      system.skillOptions = window.DX3rdSkillManager?.getSkillSelectOptions?.(
        'weapon', system.actorSkills
      ) || [];
      context.isWeapon = true;
      context.isEquipment = true;
      context.fixedActiveTiming = true;
      context.isOnce = false;
      return context;
    }

    _prepareSubmitData(event, form, formData, updateData) {
      const data = super._prepareSubmitData(event, form, formData, updateData);
      if (data.system['attack-used']?.disable === 'notCheck') {
        data.system['attack-used'].state = 0;
        data.system['attack-used'].max = 0;
      }
      return data;
    }
  }

  const ItemsClass = foundry.documents?.collections?.Items || Items;
  ItemsClass.registerSheet('dx3rd-emanim', DX3rdWeaponSheetV2, {
    label: 'DX3rd.AppV2PilotSheet',
    types: ['weapon'],
    makeDefault: false
  });
  window.DX3rdWeaponSheetV2 = DX3rdWeaponSheetV2;
})();
