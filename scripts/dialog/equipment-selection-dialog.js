/**
 * Equipment Selection Dialog
 * 아이템 생성 후 장비 선택 다이얼로그
 */
(function() {
    const api = foundry.applications?.api;
    if (!api?.ApplicationV2 || !api?.HandlebarsApplicationMixin) {
        console.warn('DX3rd | Equipment Selection AppV2 dialog is unavailable in this Foundry version.');
        return;
    }

    const BaseApplication = api.HandlebarsApplicationMixin(api.ApplicationV2);

    class DX3rdEquipmentSelectionDialog extends BaseApplication {
        static DEFAULT_OPTIONS = {
            classes: ['dx3rd-emanim', 'dialog', 'equipment-selection-dialog'],
            window: {
                title: 'Equipment Selection',
                resizable: true
            },
            position: {
                width: 500,
                height: 400
            }
        };

        static PARTS = {
            main: {
                template: 'systems/dx3rd-emanim/templates/dialog/equipment-selection-dialog.html',
                root: true
            }
        };

        constructor(dialogData = {}, options = {}) {
            const mergedOptions = foundry.utils.mergeObject({
                window: {title: dialogData.title || 'Equipment Selection'}
            }, options, {inplace: false});
            super(mergedOptions);

            this.actor = dialogData.actor;
            this.items = dialogData.items || [];
            this.createdItemIds = dialogData.createdItemIds || [];
            this.itemType = dialogData.itemType || 'weapon';
            this.dialogTitle = dialogData.title || 'Equipment Selection';
            this.isSingleSelect = this.itemType === 'vehicle';

            this._resolvePromise = null;
            this._resolved = false;
            this.promise = new Promise(resolve => {
                this._resolvePromise = resolve;
            });
        }

        async _prepareContext(options) {
            const context = await super._prepareContext(options);
            context.title = this.dialogTitle;
            context.items = this.items.map(item => this.prepareItemData(item));
            context.itemType = this.itemType;
            context.isWeapon = this.itemType === 'weapon';
            context.isProtect = this.itemType === 'protect';
            context.isVehicle = this.itemType === 'vehicle';
            context.isSingleSelect = this.isSingleSelect;
            context.equipmentLabel = game.i18n.localize('DX3rd.Equipment');
            context.confirmLabel = game.i18n.localize('DX3rd.Confirm');
            context.cancelLabel = game.i18n.localize('DX3rd.Cancel');
            return context;
        }

        async _onRender(context, options) {
            await super._onRender(context, options);
            const root = this.element;
            if (!root) return;

            root.querySelectorAll('.equipment-checkbox').forEach(checkbox => {
                checkbox.addEventListener('change', event => this.handleCheckboxChange(event));
            });

            root.querySelector('.equipment-confirm')?.addEventListener('click', event => {
                event.preventDefault();
                this.confirmSelection();
            });

            root.querySelector('.equipment-cancel')?.addEventListener('click', event => {
                event.preventDefault();
                this.close();
            });
        }

        prepareItemData(item) {
            const baseData = {
                id: item.id,
                name: this.cleanItemName(item.name),
                equipped: item.system.equipment || false,
                isCreated: this.createdItemIds.includes(item.id),
                img: item.img || 'icons/svg/item-bag.svg'
            };

            if (this.itemType === 'weapon') {
                return {
                    ...baseData,
                    type: this.getSkillDisplay(item.system.type),
                    skill: this.getSkillDisplay(item.system.skill),
                    range: item.system.range || '-',
                    add: item.system.add || '0',
                    attack: item.system.attack || '0',
                    guard: item.system.guard || '0'
                };
            }

            if (this.itemType === 'protect') {
                return {
                    ...baseData,
                    dodge: item.system.dodge || '0',
                    init: item.system.init || '0',
                    armor: item.system.armor || '0'
                };
            }

            if (this.itemType === 'vehicle') {
                return {
                    ...baseData,
                    skill: this.getSkillDisplay(item.system.skill),
                    attack: item.system.attack || '0',
                    init: item.system.init || '0',
                    armor: item.system.armor || '0',
                    move: item.system.move || '0'
                };
            }

            return baseData;
        }

        cleanItemName(name) {
            if (!name) return '';
            let cleanedName = name.replace(/\[DX3rd\.\w+\]/g, '').trim();
            const tempItemText = game.i18n.localize('DX3rd.TemporaryItem');
            cleanedName = cleanedName.replace(tempItemText, '').trim();
            if (cleanedName.includes('||')) cleanedName = cleanedName.split('||')[0].trim();
            return cleanedName;
        }

        getSkillDisplay(skillKey) {
            if (!skillKey || skillKey === '-') return '-';

            if (typeof skillKey === 'string' && skillKey.startsWith('DX3rd.')) {
                return game.i18n.localize(skillKey);
            }

            const customSkills = game.settings.get('dx3rd-emanim', 'customSkills') || {};
            if (customSkills[skillKey]) {
                return typeof customSkills[skillKey] === 'object'
                    ? customSkills[skillKey].name
                    : customSkills[skillKey];
            }

            const localized = game.i18n.localize(`DX3rd.${skillKey}`);
            return localized !== `DX3rd.${skillKey}` ? localized : skillKey;
        }

        handleCheckboxChange(event) {
            const checkbox = event.currentTarget;
            if (!this.isSingleSelect || !checkbox.checked) return;

            const root = this.element;
            if (!root) return;
            root.querySelectorAll('.equipment-checkbox').forEach(input => {
                if (input !== checkbox) input.checked = false;
            });
        }

        async confirmSelection() {
            const checkedItems = [];
            const uncheckedItems = [];

            for (const checkbox of this.element?.querySelectorAll('.equipment-checkbox') || []) {
                const itemId = checkbox.dataset.itemId;
                if (!itemId) continue;
                if (checkbox.checked) checkedItems.push(itemId);
                else uncheckedItems.push(itemId);
            }

            const updates = [];

            for (const itemId of checkedItems) {
                const item = this.actor?.items?.get(itemId);
                if (item && !item.system.equipment) {
                    updates.push({_id: itemId, 'system.equipment': true});
                }
            }

            for (const itemId of uncheckedItems) {
                const item = this.actor?.items?.get(itemId);
                if (item && item.system.equipment) {
                    updates.push({_id: itemId, 'system.equipment': false});
                }
            }

            if (updates.length > 0) {
                await this.actor.updateEmbeddedDocuments('Item', updates);
            }

            ui.notifications.info(`${this.dialogTitle} 장비 설정이 완료되었습니다.`);
            this._resolveOnce({confirmed: true, checkedItems});
            this.close();
        }

        _resolveOnce(result) {
            if (!this._resolvePromise || this._resolved) return;
            this._resolved = true;
            this._resolvePromise(result);
        }

        async close(options = {}) {
            this._resolveOnce({confirmed: false});
            return super.close(options);
        }
    }

    window.DX3rdEquipmentSelectionDialog = DX3rdEquipmentSelectionDialog;
})();
