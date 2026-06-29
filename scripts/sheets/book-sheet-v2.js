/**
 * Book item AppV2 pilot sheet.
 * The AppV1 book sheet remains the default until parity testing is complete.
 */
(function() {
  const ItemSheetV2 = window.DX3rdItemSheetV2;
  const compat = window.DX3rdApplicationCompat;
  const DialogV2 = foundry.applications?.api?.DialogV2;
  const bookSheetData = window.DX3rdBookSheetData;
  if (!ItemSheetV2 || !compat || !DialogV2 || !bookSheetData) {
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
    label: 'DX3rd.AppV2PilotSheet',
    types: ['book'],
    makeDefault: false
  });

  window.DX3rdBookSheetV2 = DX3rdBookSheetV2;
})();
