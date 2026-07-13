/**
 * Works item AppV2 pilot sheet.
 * The 이전 시트 works sheet remains the default until parity testing is complete.
 */
(function() {
  const ItemSheetV2 = window.DX3rdItemSheetV2;
  const compat = window.DX3rdApplicationCompat;
  const DialogV2 = foundry.applications?.api?.DialogV2;
  if (!ItemSheetV2 || !compat || !DialogV2) {
    console.warn('DX3rd | AppV2 works sheet is unavailable in this Foundry version.');
    return;
  }

  class DX3rdWorksSheetV2 extends ItemSheetV2 {
    static DEFAULT_OPTIONS = {
      classes: ['works-sheet-v2'],
      actions: {
        createSkill: DX3rdWorksSheetV2._onCreateSkill,
        deleteSkill: DX3rdWorksSheetV2._onDeleteSkill
      }
    };

    static PARTS = {
      main: {
        template: 'systems/dx3rd-emanim/templates/item/works-sheet-v2.html',
        root: true
      }
    };

    static TABS = {
      primary: {
        tabs: [
          {id: 'description'},
          {id: 'skills'}
        ],
        initial: 'description'
      }
    };

    async _prepareContext(options) {
      const context = await super._prepareContext(options);
      const system = context.system;
      const actorSkills = this.item.actor?.system?.attributes?.skills || {};
      const defaultSkills = ['melee', 'evade', 'ranged', 'perception', 'rc', 'will', 'cthulhu', 'negotiation', 'procure'];
      const abilityOrder = ['body', 'sense', 'mind', 'social'];
      const sortedSkills = {};

      for (const ability of abilityOrder) {
        const defaultForAbility = defaultSkills.filter(key => actorSkills[key]?.base === ability);
        const customForAbility = Object.keys(actorSkills)
          .filter(key => actorSkills[key]?.base === ability && !defaultSkills.includes(key))
          .sort();
        for (const key of [...defaultForAbility, ...customForAbility]) sortedSkills[key] = actorSkills[key];
      }

      system.description ??= '';
      system.actorSkills = sortedSkills;
      system.skills ??= {};
      system.skillTmp ??= '-';
      system.attributes ??= {};
      for (const key of abilityOrder) {
        system.attributes[key] ??= {};
        system.attributes[key].value ??= 0;
      }

      return context;
    }

    static async _onCreateSkill(event, target) {
      event.preventDefault();
      const container = compat.closest(target, '.add-skills', this.element);
      const skillKey = compat.query(container, 'select[name="system.skillTmp"]')?.value;
      if (!skillKey) return;

      const actorSkill = this.item.actor?.system?.attributes?.skills?.[skillKey];
      if (!actorSkill) return;
      if (this.item.system.skills?.[skillKey]) {
        ui.notifications.error(game.i18n.localize('DX3rd.ErrorSkillExists'));
        return;
      }

      await this.item.update({
        [`system.skills.${skillKey}`]: {
          key: skillKey,
          name: actorSkill.name,
          base: actorSkill.base,
          dice: actorSkill.dice,
          add: actorSkill.add,
          bonus: 0,
          apply: true
        }
      });
      this.render(false);
    }

    static async _onDeleteSkill(event, target) {
      event.preventDefault();
      const skillKey = compat.closest(target, '.attribute', this.element)?.dataset.attribute;
      const skill = this.item.system.skills?.[skillKey];
      if (!skillKey || !skill) return;

      await window.DX3rdItemSheetDialogs.deleteSkillEntry(this.item, skillKey);
    }
  }

  const ItemsClass = foundry.documents?.collections?.Items || Items;
  ItemsClass.registerSheet('dx3rd-emanim', DX3rdWorksSheetV2, {
    label: 'DX3rd.SheetV2',
    types: ['works'],
    makeDefault: true
  });

  window.DX3rdWorksSheetV2 = DX3rdWorksSheetV2;
})();
