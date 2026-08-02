/** Spell item AppV2 sheet. */
(function() {
  const Base = window.DX3rdActiveItemSheetV2;
  const compat = window.DX3rdApplicationCompat;
  const itemSheetData = window.DX3rdItemSheetData;
  if (!Base || !compat || !itemSheetData) return;

  class DX3rdSpellSheetV2 extends Base {
    static DEFAULT_OPTIONS = {...Base.DEFAULT_OPTIONS, classes: ['spell-sheet-v2']};

    static PARTS = {
      main: {template: 'systems/dx3rd-emanim/templates/item/spell-sheet-v2.html', root: true}
    };

    static TABS = {primary: {
      tabs: [{id: 'description'}, {id: 'action'}, {id: 'immediate'}, {id: 'persistent'}],
      initial: 'description'
    }};

    async _prepareContext(options) {
      const context = await super._prepareContext(options);
      const {system} = context;

      system.spelltype ??= '-';
      system.exp ??= 0;
      system.invoke ??= {value: '-'};
      system.invoke.value ??= '-';
      system.evocation ??= {value: '-'};
      system.evocation.value ??= '-';
      system.encroach ??= {value: ''};
      system.encroach.value ??= '';
      system.roll ??= '-';
      system.temporarySpell ??= false;
      system.active.runTiming ??= 'instant';
      return context;
    }

    // 기동판정 · 대상 지정 체크박스는 name 이 없어 폼에 실리지 않는다. 별도 item.update 로
    // 저장하면 같은 change 이벤트의 submitOnChange 저장과 경합하므로 _prepareSubmitData 에서 처리한다.
    static _castingRollUpdate(checked) {
      const updates = {'system.roll': checked ? 'CastingRoll' : '-'};
      if (!checked) {
        updates['system.invoke.value'] = '-';
        updates['system.evocation.value'] = '-';
      }
      return updates;
    }

    _prepareSubmitData(event, form, formData, updateData) {
      const data = super._prepareSubmitData(event, form, formData, updateData);
      const changed = event?.target;
      if (changed?.matches?.('.casting-roll-check')) {
        for (const [key, value] of Object.entries(DX3rdSpellSheetV2._castingRollUpdate(changed.checked))) {
          foundry.utils.setProperty(data, key, value);
        }
      }
      if (changed?.matches?.('[data-target-field="system.getTarget"]')) {
        foundry.utils.setProperty(data, 'system.getTarget', changed.checked);
      }
      return data;
    }
  }

  const ItemsClass = foundry.documents?.collections?.Items || Items;
  ItemsClass.registerSheet('dx3rd-emanim', DX3rdSpellSheetV2, {
    label: 'DX3rd.SheetV2',
    types: ['spell'],
    makeDefault: true
  });
  window.DX3rdSpellSheetV2 = DX3rdSpellSheetV2;
})();
