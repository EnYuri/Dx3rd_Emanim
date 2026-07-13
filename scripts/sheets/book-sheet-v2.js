/**
 * Book item AppV2 sheet.
 */
(function() {
  const ItemSheetV2 = window.DX3rdItemSheetV2;
  const compat = window.DX3rdApplicationCompat;
  const DialogV2 = foundry.applications?.api?.DialogV2;
  if (!ItemSheetV2 || !compat || !DialogV2) {
    console.warn('DX3rd | AppV2 book sheet is unavailable in this Foundry version.');
    return;
  }

  const bookSheetData = {
    prepareBookSystem(item, system) {
      system.description ??= '';
      system.type ??= 'book';
      system.decipher ??= item.system?.decipher ?? 0;
      system.exp ??= item.system?.exp ?? 0;
      system.equipment ??= item.system?.equipment ?? false;
      system.macro ??= item.system?.macro ?? '';
      system.spells ??= item.system?.spells ?? [];
      system.saving ??= {};
      system.saving.difficulty ??= item.system?.saving?.difficulty ?? '';
      system.saving.value ??= item.system?.saving?.value ?? 0;
      return system;
    },

    resolveSpellItems(spellIds = []) {
      const spells = [];
      const foundIds = new Set();
      for (const spellId of spellIds) {
        const worldSpell = game.items?.get(spellId);
        if (worldSpell?.type !== 'spell') continue;
        spells.push(worldSpell);
        foundIds.add(spellId);
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
    },

    findSpell(spellId) {
      const worldItem = game.items?.get(spellId);
      if (worldItem?.type === 'spell') return worldItem;
      for (const actor of game.actors || []) {
        const spell = actor.items?.get(spellId);
        if (spell?.type === 'spell') return spell;
      }
      return null;
    },

    normalizeSpellId(spellId) {
      const normalized = String(spellId || '').trim();
      return normalized.startsWith('Item.') ? normalized.substring(5) : normalized;
    },

    async addSpell(bookItem, spell) {
      const currentSpells = bookItem.system.spells || [];
      if (currentSpells.includes(spell.id)) {
        ui.notifications.warn(game.i18n.localize('DX3rd.SpellAlreadyAdded'));
        return false;
      }
      await bookItem.update({'system.spells': [...currentSpells, spell.id]});
      ui.notifications.info(`스펠 "${spell.name}"이 추가되었습니다.`);
      return true;
    },

    async addSpellById(bookItem, spellId) {
      const normalizedId = this.normalizeSpellId(spellId);
      if (!normalizedId) {
        ui.notifications.warn(game.i18n.localize('DX3rd.EnterSpellID'));
        return false;
      }
      const spell = this.findSpell(normalizedId);
      if (!spell) {
        ui.notifications.warn(game.i18n.localize('DX3rd.SpellNotFound'));
        return false;
      }
      return this.addSpell(bookItem, spell);
    },

    async removeSpell(bookItem, spellId) {
      await bookItem.update({'system.spells': (bookItem.system.spells || []).filter(id => id !== spellId)});
      ui.notifications.info('스펠이 삭제되었습니다.');
    },

    async resolveDroppedSpell(event) {
      let data;
      try {
        data = JSON.parse(event.dataTransfer?.getData?.('text/plain') || '');
      } catch (error) {
        return {status: 'invalid'};
      }
      if (data.type !== 'Item') return {status: 'unsupported'};
      if (!data.uuid) return {status: 'missingUuid'};
      const item = await fromUuid(data.uuid);
      if (!item) {
        ui.notifications.warn('아이템을 찾을 수 없습니다.');
        return {status: 'notFound'};
      }
      if (item.type !== 'spell') {
        ui.notifications.warn('스펠 아이템만 추가할 수 있습니다.');
        return {status: 'notSpell'};
      }
      return {status: 'ok', spell: item};
    }
  };

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
      const system = bookSheetData.prepareBookSystem(this.item, context.system);

      context.displayType = 'DX3rd.Book';
      context.spellItems = bookSheetData.resolveSpellItems(system.spells);
      return context;
    }

    async _addSpell(spell) {
      const added = await bookSheetData.addSpell(this.item, spell);
      if (added) this.render(false);
    }

    async _onDrop(event) {
      const dropZone = compat.closest(event.target, '[data-drop-zone="spells"]', this.element);
      if (!dropZone) return super._onDrop(event);
      dropZone.classList.remove('drag-over');

      const result = await bookSheetData.resolveDroppedSpell(event);
      if (result.status === 'unsupported') return super._onDrop(event);
      if (result.status !== 'ok') return;
      await this._addSpell(result.spell);
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
      const added = await bookSheetData.addSpellById(this.item, result?.spellId);
      if (added) this.render(false);
    }

    static async _onDeleteSpell(event, target) {
      event.preventDefault();
      const spellId = compat.closest(target, '.item', this.element)?.dataset.itemId;
      if (!spellId) return;
      await bookSheetData.removeSpell(this.item, spellId);
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
    label: 'DX3rd.SheetV2',
    types: ['book'],
    makeDefault: true
  });

  window.DX3rdBookSheetV2 = DX3rdBookSheetV2;
})();
