/**
 * Double Cross 3rd AppV2 Item Sheet base.
 * AppV1 sheets remain registered while individual item types are migrated.
 */
(function() {
    const api = foundry.applications?.api;
    const ItemSheetV2 = foundry.applications?.sheets?.ItemSheetV2;
    if (!api?.HandlebarsApplicationMixin || !ItemSheetV2) {
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
            const system = foundry.utils.deepClone(this.item.system || {});

            system.actorSkills = this.item.actor?.system?.attributes?.skills || {};
            system.skills ??= {};
            system.used ??= {
                state: 0,
                max: 0,
                level: false,
                disable: 'notCheck'
            };
            system.saving ??= {
                value: 0,
                difficulty: '0'
            };
            system.equipment ??= true;

            if (this.item.type === 'effect') {
                system.level ??= {};
                system.level.init ??= 0;
                system.level.max ??= 0;
                system.level.value ??= 0;
            }

            const TextEditorClass = foundry.applications?.ux?.TextEditor?.implementation;
            const enrichedDescription = TextEditorClass
                ? await TextEditorClass.enrichHTML(system.description || '', {
                    async: true,
                    secrets: this.item.isOwner,
                    rollData: this.item.getRollData()
                })
                : system.description || '';

            return Object.assign(context, {
                item: this.item,
                system,
                enrichedDescription,
                dtypes: ['String', 'Number', 'Boolean']
            });
        }

        async _onDrop(event) {
            let data;
            try {
                data = JSON.parse(event.dataTransfer?.getData?.('text/plain') || '');
            } catch (err) {
                return super._onDrop(event);
            }

            if (data.type !== 'Macro') return super._onDrop(event);

            const supportedTypes = ['effect', 'combo', 'spell', 'psionic', 'weapon', 'protect', 'vehicle', 'book', 'once', 'etc'];
            if (!supportedTypes.includes(this.item.type)) {
                ui.notifications.warn(game.i18n.localize('DX3rd.MacroNotSupported'));
                return;
            }

            const macro = await fromUuid(data.uuid);
            if (!macro) return;

            const macroText = `[${macro.name}]`;
            const currentMacro = this.item.system.macro || '';
            if (currentMacro.includes(macroText)) {
                ui.notifications.info(game.i18n.localize('DX3rd.MacroAlreadyAdded'));
                return;
            }

            await this.item.update({
                'system.macro': currentMacro ? `${currentMacro} ${macroText}` : macroText
            });
            ui.notifications.info(game.i18n.format('DX3rd.MacroAdded', {name: macro.name}));
        }
    }

    window.DX3rdItemSheetV2 = DX3rdItemSheetV2;
})();
