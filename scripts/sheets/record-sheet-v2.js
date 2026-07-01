/**
 * Record item AppV2 pilot sheet.
 * The AppV1 record sheet remains the default until parity testing is complete.
 */
(function() {
  const ItemSheetV2 = window.DX3rdItemSheetV2;
  if (!ItemSheetV2) {
    console.warn('DX3rd | AppV2 record sheet is unavailable in this Foundry version.');
    return;
  }

  class DX3rdRecordSheetV2 extends ItemSheetV2 {
    static DEFAULT_OPTIONS = {
      classes: ['record-sheet-v2']
    };

    static PARTS = {
      main: {
        template: 'systems/dx3rd-emanim/templates/item/record-sheet-v2.html',
        root: true
      }
    };

    async _prepareContext(options) {
      const context = await super._prepareContext(options);
      context.system.description ??= '';
      context.system.exp ??= 0;
      context.system.encroachment ??= 0;
      return context;
    }
  }

  const ItemsClass = foundry.documents?.collections?.Items || Items;
  ItemsClass.registerSheet('dx3rd-emanim', DX3rdRecordSheetV2, {
    label: 'DX3rd.SheetV2',
    types: ['record'],
    makeDefault: false
  });

  window.DX3rdRecordSheetV2 = DX3rdRecordSheetV2;
})();
