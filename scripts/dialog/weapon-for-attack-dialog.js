/**
 * Weapon For Attack Dialog
 * 공격용 무기 선택 다이얼로그 (장비 상태 변경 없이 공격력/수정치만 적용)
 */
(function() {
    const api = foundry.applications?.api;
    if (!api?.ApplicationV2 || !api?.HandlebarsApplicationMixin) {
        console.warn('DX3rd | Weapon For Attack AppV2 dialog is unavailable in this Foundry version.');
        return;
    }

    const BaseApplication = api.HandlebarsApplicationMixin(api.ApplicationV2);

    class DX3rdWeaponForAttackDialog extends BaseApplication {
        static DEFAULT_OPTIONS = {
            classes: ['dx3rd-emanim', 'dialog', 'weapon-for-attack-dialog'],
            window: {
                title: 'DX3rd.WeaponSelection',
                resizable: true
            },
            position: {
                width: 800,
                height: 400
            }
        };

        static PARTS = {
            main: {
                template: 'systems/dx3rd-emanim/templates/dialog/weapon-for-attack-dialog.html',
                root: true
            }
        };

        constructor(dialogData = {}, options = {}) {
            const mergedOptions = foundry.utils.mergeObject({
                window: {title: dialogData.title || game.i18n.localize('DX3rd.WeaponSelection')}
            }, options, {inplace: false});
            super(mergedOptions);

            this.actor = dialogData.actor;
            this.weapons = dialogData.weapons || [];
            this.callback = dialogData.callback || (() => {});
            this.attackRoll = dialogData.attackRoll;
        }

        async _prepareContext(options) {
            const context = await super._prepareContext(options);
            const preparedWeapons = this.weapons.map(weapon => this.prepareWeaponData(weapon));
            const sortedWeapons = preparedWeapons.sort((a, b) => {
                if (!a.attackExhausted && b.attackExhausted) return -1;
                if (a.attackExhausted && !b.attackExhausted) return 1;
                if (a.equipped && !b.equipped) return -1;
                if (!a.equipped && b.equipped) return 1;
                if (!a.isVehicle && b.isVehicle) return -1;
                if (a.isVehicle && !b.isVehicle) return 1;
                return a.sort - b.sort;
            });

            context.title = game.i18n.localize('DX3rd.WeaponSelection');
            context.items = sortedWeapons;
            context.attackRoll = this.attackRoll;
            context.confirmLabel = game.i18n.localize('DX3rd.Confirm');
            context.cancelLabel = game.i18n.localize('DX3rd.Cancel');
            return context;
        }

        async _onRender(context, options) {
            await super._onRender(context, options);
            const root = this.element;
            if (!root) return;

            root.addEventListener('click', event => {
                const row = event.target.closest('.weapon-row');
                if (!row || !root.contains(row)) return;
                if (event.target.classList.contains('weapon-checkbox')) return;
                const checkbox = row.querySelector('.weapon-checkbox');
                if (!checkbox || checkbox.disabled) return;
                checkbox.checked = !checkbox.checked;
            });

            root.querySelector('.weapon-confirm')?.addEventListener('click', event => {
                event.preventDefault();
                this.confirmSelection();
            });

            root.querySelector('.weapon-cancel')?.addEventListener('click', event => {
                event.preventDefault();
                this.close();
            });
        }

        prepareWeaponData(weapon) {
            if (weapon.type === 'vehicle') {
                return {
                    id: weapon.id,
                    name: this.cleanItemName(weapon.name),
                    type: game.i18n.localize('DX3rd.Melee'),
                    skill: this.getSkillDisplay(weapon.system.skill),
                    range: game.i18n.localize('DX3rd.Engage'),
                    add: '0',
                    attack: weapon.system.attack || '0',
                    guard: '0',
                    equipped: weapon.system.equipment || false,
                    isVehicle: true,
                    sort: weapon.sort || 0,
                    attackExhausted: false,
                    attackUsedState: 0,
                    attackUsedMax: 0
                };
            }

            const attackUsedDisable = weapon.system['attack-used']?.disable || 'notCheck';
            const attackUsedState = weapon.system['attack-used']?.state || 0;
            const attackUsedMax = weapon.system['attack-used']?.max || 0;
            const isAttackExhausted = attackUsedDisable !== 'notCheck' && (attackUsedMax <= 0 || attackUsedState >= attackUsedMax);

            return {
                id: weapon.id,
                name: this.cleanItemName(weapon.name),
                type: this.getSkillDisplay(weapon.system.type),
                skill: this.getSkillDisplay(weapon.system.skill),
                range: weapon.system.range || '-',
                add: weapon.system.add || '0',
                attack: weapon.system.attack || '0',
                guard: weapon.system.guard || '0',
                equipped: weapon.system.equipment || false,
                isVehicle: false,
                sort: weapon.sort || 0,
                attackExhausted: isAttackExhausted,
                attackUsedState: attackUsedState,
                attackUsedMax: attackUsedMax
            };
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

        async confirmSelection() {
            const selectedWeaponIds = Array.from(this.element?.querySelectorAll('.weapon-checkbox:checked') || [])
                .map(input => input.dataset.weaponId)
                .filter(Boolean);

            if (selectedWeaponIds.length === 0) {
                ui.notifications.warn('무기를 선택해주세요.');
                return;
            }

            let totalAttack = 0;
            let totalAdd = 0;
            let attackFormula = '';
            let addFormula = '';
            const weaponNames = [];

            for (const weaponId of selectedWeaponIds) {
                const weapon = this.weapons.find(w => w.id === weaponId);
                if (!weapon) continue;
                const formula = window.DX3rdFormulaEvaluator;
                const addFormulaTerm = (raw, formulaKey, totalKey) => {
                    const prepared = formula.prepareRollFormula(String(raw ?? '0'), weapon, this.actor);
                    if (formula.hasDice(prepared)) {
                        if (formulaKey === 'attackFormula') attackFormula = [attackFormula, prepared].filter(Boolean).join(' + ');
                        else addFormula = [addFormula, prepared].filter(Boolean).join(' + ');
                    } else if (totalKey === 'attack') totalAttack += Number(formula.evaluate(raw, weapon, this.actor)) || 0;
                    else totalAdd += Number(formula.evaluate(raw, weapon, this.actor)) || 0;
                };
                addFormulaTerm(weapon.system.attack, 'attackFormula', 'attack');
                addFormulaTerm(weapon.system.add, 'addFormula', 'add');
                weaponNames.push(this.cleanItemName(weapon.name));
            }

            await this.callback({
                attack: totalAttack,
                add: totalAdd,
                attackFormula,
                addFormula,
                weaponName: weaponNames.join(', '),
                weaponIds: selectedWeaponIds
            });
            this.close();
        }
    }

    window.DX3rdWeaponForAttackDialog = DX3rdWeaponForAttackDialog;
})();
