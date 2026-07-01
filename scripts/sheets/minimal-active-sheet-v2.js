/** Minimum-compatibility AppV2 sheet for low-use psionic and spell items. */
(function() {
  const Base = window.DX3rdActiveItemSheetV2;
  const itemSheetData = window.DX3rdItemSheetData;
  if (!Base || !itemSheetData) return;

  class DX3rdMinimalActiveSheetV2 extends Base {
    static DEFAULT_OPTIONS = {classes: ['minimal-active-sheet-v2']};
    static PARTS = {
      main: {template: 'systems/dx3rd-emanim/templates/item/minimal-active-sheet-v2.html', root: true}
    };
    static TABS = {primary: {
      tabs: [{id: 'description'}, {id: 'attributes'}, {id: 'target'}],
      initial: 'description'
    }};

    async _prepareContext(options) {
      const context = await super._prepareContext(options);
      const {system} = context;
      context.isPsionic = this.item.type === 'psionic';
      context.isSpell = this.item.type === 'spell';
      context.actor = this.item.actor || null;

      if (context.isPsionic) {
        system.skillOptions = window.DX3rdSkillManager.getSkillSelectOptions(
          'psionic',
          this.item.actor?.system?.attributes?.skills || {},
          this.item.actor?.type
        );
        system.level = itemSheetData.preparePsionicLevelData(this.item, system.level || this.item.system?.level || {});
        system.hp ??= {value: ''};
        system.hp.value ??= '';
      } else {
        system.spelltype ??= '-';
        system.exp ??= 0;
        system.invoke ??= {value: '-'};
        system.evocation ??= {value: '-'};
        system.encroach ??= {value: '0'};
        system.temporarySpell ??= false;
      }
      return context;
    }

    _prepareSubmitData(event, form, formData, updateData) {
      const data = super._prepareSubmitData(event, form, formData, updateData);
      if (this.item.type === 'psionic') {
        const level = itemSheetData.preparePsionicLevelData(this.item, data.system?.level || this.item.system.level || {});
        foundry.utils.setProperty(data, 'system.level.init', level.init);
        foundry.utils.setProperty(data, 'system.level.max', level.max);
        if (data.system?.level) delete data.system.level.value;
        if (event?.target?.name === 'system.level.init') {
          foundry.utils.setProperty(data, 'system.level.value', level.value);
        }
        for (const [key, value] of Object.entries(itemSheetData.getRollChangeUpdate(data.system?.roll))) {
          foundry.utils.setProperty(data, key, value);
        }
        if (event?.target?.matches?.('.difficulty-check')) {
          const update = itemSheetData.getRollDifficultyToggleUpdate(this.item, event.target.checked);
          for (const [key, value] of Object.entries(update)) {
            foundry.utils.setProperty(data, key, value);
          }
        }
      } else if (event?.target?.matches?.('[data-casting-roll-check]')) {
        const checked = event.target.checked;
        foundry.utils.setProperty(data, 'system.roll', checked ? 'CastingRoll' : '-');
        if (!checked) {
          foundry.utils.setProperty(data, 'system.invoke.value', '-');
          foundry.utils.setProperty(data, 'system.evocation.value', '-');
        }
      }
      return data;
    }
  }

  const ItemsClass = foundry.documents?.collections?.Items || Items;
  ItemsClass.registerSheet('dx3rd-emanim', DX3rdMinimalActiveSheetV2, {
    label: 'DX3rd.SheetV2',
    types: ['psionic', 'spell'],
    makeDefault: false
  });
  window.DX3rdMinimalActiveSheetV2 = DX3rdMinimalActiveSheetV2;
})();
