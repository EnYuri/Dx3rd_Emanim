/** Spell item AppV2 sheet. */
(function() {
  const Base = window.DX3rdActiveItemSheetV2;
  const compat = window.DX3rdApplicationCompat;
  const itemSheetData = window.DX3rdItemSheetData;
  if (!Base || !compat || !itemSheetData) return;

  class DX3rdSpellSheetV2 extends Base {
    static DEFAULT_OPTIONS = {classes: ['spell-sheet-v2']};

    static PARTS = {
      main: {template: 'systems/dx3rd-emanim/templates/item/spell-sheet-v2.html', root: true}
    };

    static TABS = {primary: {
      tabs: [{id: 'description'}, {id: 'attributes'}, {id: 'target'}],
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

    async _onRender(context, options) {
      await super._onRender(context, options);
      this._spellCleanups?.forEach(cleanup => cleanup());
      this._spellCleanups = [];
      const listen = (...args) => this._spellCleanups.push(compat.on(this.element, ...args));

      listen('change', '.casting-roll-check', event => this._onCastingRollCheck(event.target.checked));
      listen('change', '[data-target-field="system.getTarget"]', event => {
        this.item.update({'system.getTarget': event.target.checked});
      });
    }

    async _onCastingRollCheck(checked) {
      const updates = {'system.roll': checked ? 'CastingRoll' : '-'};
      if (!checked) {
        updates['system.invoke.value'] = '-';
        updates['system.evocation.value'] = '-';
      }
      await this.item.update(updates);
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
