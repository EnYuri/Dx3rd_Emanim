/**
 * Book item AppV2 pilot sheet.
 * The AppV1 book sheet remains the default until parity testing is complete.
 */
(function() {
  const ItemSheetV2 = window.DX3rdItemSheetV2;
  const compat = window.DX3rdApplicationCompat;
  const DialogV2 = foundry.applications?.api?.DialogV2;
  if (!ItemSheetV2 || !compat || !DialogV2) {
    console.warn('DX3rd | AppV2 book sheet is unavailable in this Foundry version.');
    return;
  }

  class DX3rdBookSheetV2 extends ItemSheetV2 {
    static DEFAULT_OPTIONS = {
      classes: ['book-sheet-v2'],
      actions: {
        createSpell: DX3rdBookSheetV2._onCreateSpell,
        deleteSpell: DX3rdBookSheetV2._onDeleteSpell,
        toggleSpell: DX3rdBookSheetV2._onToggleSpell
      }
    };

    static PARTS = {
      main: {
        template: 'systems/dx3rd-emanim/templates/item/book-sheet-v2.html',
        root: true
      }
    };

    static TABS = {
      primary: {
        tabs: [{id: 'description'}, {id: 'spells'}],
        initial: 'description'
      }
    };

    async _prepareContext(options) {
      const context = await super._prepareContext(options);
      const system = context.system;

      system.description ??= '';
      system.type ??= 'book';
      system.decipher ??= 0;
      system.exp ??= 0;
      system.equipment ??= false;
      system.macro ??= '';
      system.spells ??= [];
      system.saving ??= {};
      system.saving.difficulty ??= '';
      system.saving.value ??= 0;

      context.displayType = 'DX3rd.Book';
      context.spellItems = this._resolveSpellItems(system.spells);
      return context;
    }

    _resolveSpellItems(spellIds) {
      const spells = [];
      const foundIds = new Set();
      for (const spellId of spellIds) {
        const worldSpell = game.items?.get(spellId);
        if (worldSpell?.type === 'spell') {
          spells.push(worldSpell);
          foundIds.add(spellId);
        }
      }

      for (const actor of game.actors || []) {
        for (const spellId of spellIds) {
          if (foundIds.has(spellId)) continue;
          const spell = actor.items?.get(spellId);
          if (spell?.type !== 'spell') continue;
          spells.push(spell);
          foundIds.add(spellId);
        }
      }
      return spells;
    }

    async _findSpell(spellId) {
      const worldItem = game.items?.get(spellId);
      if (worldItem?.type === 'spell') return worldItem;
      for (const actor of game.actors || []) {
        const spell = actor.items?.get(spellId);
        if (spell?.type === 'spell') return spell;
      }
      return null;
    }

    async _addSpell(spell) {
      const currentSpells = this.item.system.spells || [];
      if (currentSpells.includes(spell.id)) {
        ui.notifications.warn(game.i18n.localize('DX3rd.SpellAlreadyAdded'));
        return;
      }
      await this.item.update({'system.spells': [...currentSpells, spell.id]});
      ui.notifications.info(`스펠 "${spell.name}"이 추가되었습니다.`);
      this.render(false);
    }

    async _onDrop(event) {
      const dropZone = compat.closest(event.target, '[data-drop-zone="spells"]', this.element);
      if (!dropZone) return super._onDrop(event);
      dropZone.classList.remove('drag-over');

      let data;
      try {
        data = JSON.parse(event.dataTransfer?.getData?.('text/plain') || '');
      } catch (error) {
        return;
      }
      if (data.type !== 'Item') return super._onDrop(event);
      if (!data.uuid) return;

      const item = await fromUuid(data.uuid);
      if (!item) {
        ui.notifications.warn('아이템을 찾을 수 없습니다.');
        return;
      }
      if (item.type !== 'spell') {
        ui.notifications.warn('스펠 아이템만 추가할 수 있습니다.');
        return;
      }
      await this._addSpell(item);
    }

    async _onRender(context, options) {
      await super._onRender(context, options);
      const dropZone = compat.query(this.element, '[data-drop-zone="spells"]');
      if (!dropZone) return;
      this._spellDragCleanup?.();
      const removeDragOver = compat.on(dropZone, 'dragover', event => {
        event.preventDefault();
        if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
        dropZone.classList.add('drag-over');
      });
      const removeDragLeave = compat.on(dropZone, 'dragleave', () => dropZone.classList.remove('drag-over'));
      this._spellDragCleanup = () => {
        removeDragOver();
        removeDragLeave();
      };
    }

    static async _onCreateSpell(event) {
      event.preventDefault();
      const result = await DialogV2.input({
        window: {title: game.i18n.localize('DX3rd.AddSpell')},
        content: `<div class="form-group"><label>${game.i18n.localize('DX3rd.SpellID')}</label><input type="text" name="spellId"></div>`,
        ok: {label: game.i18n.localize('DX3rd.Confirm')}
      });
      let spellId = result?.spellId?.trim();
      if (!spellId) return;
      if (spellId.startsWith('Item.')) spellId = spellId.slice(5);

      const spell = await this._findSpell(spellId);
      if (!spell) {
        ui.notifications.warn(game.i18n.localize('DX3rd.SpellNotFound'));
        return;
      }
      await this._addSpell(spell);
    }

    static async _onDeleteSpell(event, target) {
      event.preventDefault();
      const spellId = compat.closest(target, '.item', this.element)?.dataset.itemId;
      if (!spellId) return;
      const spells = (this.item.system.spells || []).filter(id => id !== spellId);
      await this.item.update({'system.spells': spells});
      ui.notifications.info('스펠이 삭제되었습니다.');
      this.render(false);
    }

    static _onToggleSpell(event, target) {
      event.preventDefault();
      const row = compat.closest(target, '.item', this.element);
      const description = compat.query(row, '.spell-description');
      const icon = compat.query(target, 'i');
      if (!description) return;
      description.hidden = !description.hidden;
      icon?.classList.toggle('fa-chevron-down', description.hidden);
      icon?.classList.toggle('fa-chevron-up', !description.hidden);
    }
  }

  const ItemsClass = foundry.documents?.collections?.Items || Items;
  ItemsClass.registerSheet('dx3rd-emanim', DX3rdBookSheetV2, {
    label: 'DX3rd.AppV2PilotSheet',
    types: ['book'],
    makeDefault: false
  });

  window.DX3rdBookSheetV2 = DX3rdBookSheetV2;
})();
