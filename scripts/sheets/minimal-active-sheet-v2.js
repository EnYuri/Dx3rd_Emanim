/** Minimum-compatibility AppV2 sheet for low-use psionic and spell items. */
(function() {
  const Base = window.DX3rdActiveItemSheetV2;
  if (!Base) return;

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
        system.level ??= {};
        system.level.init ??= 1;
        system.level.max ??= 1;
        system.level.value = Number(system.level.init) || 0;
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
        const level = data.system?.level || this.item.system.level || {};
        const init = Number(level.init ?? 1);
        const max = Number(level.max ?? 1);
        const normalizedInit = Number.isFinite(init) ? init : 1;
        foundry.utils.setProperty(data, 'system.level.init', normalizedInit);
        foundry.utils.setProperty(data, 'system.level.max', Number.isFinite(max) ? max : 1);
        if (data.system?.level) delete data.system.level.value;
        if (event?.target?.name === 'system.level.init') {
          foundry.utils.setProperty(data, 'system.level.value', normalizedInit);
        }
        if (data.system?.roll === '-' || data.system?.roll === 'dodge') {
          foundry.utils.setProperty(data, 'system.attackRoll', '-');
        }
        if (event?.target?.matches?.('.difficulty-check')) {
          const checked = event.target.checked;
          const freepass = game.i18n.localize('DX3rd.Freepass');
          const current = this.item.system.difficulty || '';
          foundry.utils.setProperty(data, 'system.roll', checked ? 'major' : '-');
          foundry.utils.setProperty(data, 'system.difficulty', checked
            ? ''
            : current === freepass || current === '-' ? current : freepass);
          if (!checked) foundry.utils.setProperty(data, 'system.attackRoll', '-');
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
    label: 'DX3rd.AppV2PilotSheet',
    types: ['psionic', 'spell'],
    makeDefault: false
  });
  window.DX3rdMinimalActiveSheetV2 = DX3rdMinimalActiveSheetV2;
})();
