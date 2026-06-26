/**
 * Syndrome item AppV2 pilot sheet.
 * The AppV1 syndrome sheet remains the default until parity testing is complete.
 */
(function() {
    const ItemSheetV2 = window.DX3rdItemSheetV2;
    if (!ItemSheetV2) {
        console.warn('DX3rd | AppV2 syndrome sheet is unavailable in this Foundry version.');
        return;
    }

    class DX3rdSyndromeSheetV2 extends ItemSheetV2 {
        static DEFAULT_OPTIONS = {
            classes: ['syndrome-sheet-v2']
        };

        static PARTS = {
            main: {
                template: 'systems/dx3rd-emanim/templates/item/syndrome-sheet-v2.html',
                root: true
            }
        };

        async _prepareContext(options) {
            const context = await super._prepareContext(options);
            const attributes = context.system.attributes ??= {};
            for (const key of ['body', 'sense', 'mind', 'social']) {
                attributes[key] ??= {};
                attributes[key].value ??= 0;
            }
            context.system.description ??= '';
            return context;
        }
    }

    const ItemsClass = foundry.documents?.collections?.Items || Items;
    ItemsClass.registerSheet('dx3rd-emanim', DX3rdSyndromeSheetV2, {
        label: 'DX3rd.AppV2PilotSheet',
        types: ['syndrome'],
        makeDefault: false
    });

    window.DX3rdSyndromeSheetV2 = DX3rdSyndromeSheetV2;
})();
