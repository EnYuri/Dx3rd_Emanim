/**
 * Double Cross 3rd AppV2 Item Sheet base.
 * AppV1 sheets remain registered while individual item types are migrated.
 */
(function() {
    const api = foundry.applications?.api;
    const ItemSheetV2 = foundry.applications?.sheets?.ItemSheetV2;
    const itemSheetData = window.DX3rdItemSheetData;
    if (!api?.HandlebarsApplicationMixin || !ItemSheetV2 || !itemSheetData) {
        console.warn('DX3rd | AppV2 item sheets are unavailable in this Foundry version.');
        return;
    }

    class DX3rdItemSheetV2 extends api.HandlebarsApplicationMixin(ItemSheetV2) {
        static DEFAULT_OPTIONS = {
            classes: ['dx3rd-emanim', 'sheet', 'item'],
            position: {
                width: 520,
                height: 480
            },
            window: {
                resizable: true
            },
            form: {
                closeOnSubmit: false,
                submitOnChange: true
            }
        };

        async _prepareContext(options) {
            const context = await super._prepareContext(options);
            return itemSheetData.prepareAppV2Context(this.item, context);
        }

        async _onDrop(event) {
            return itemSheetData.handleMacroDrop(this.item, event, {
                fallback: () => super._onDrop(event),
                fallbackOnInvalidData: true
            });
        }
    }

    window.DX3rdItemSheetV2 = DX3rdItemSheetV2;
})();
