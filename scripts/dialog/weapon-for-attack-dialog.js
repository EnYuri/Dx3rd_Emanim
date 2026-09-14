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
                if (a.isVirtual && !b.isVirtual) return -1;
                if (!a.isVirtual && b.isVirtual) return 1;
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

            // Listeners are attached on every render, so the previous batch must go first.
            // Binding the row handler twice toggles the checkbox twice per click, which reads
            // as "the row cannot be selected at all" and leaves confirm with an empty selection.
            this._listeners?.abort();
            this._listeners = new AbortController();
            const signal = this._listeners.signal;

            root.addEventListener('click', event => {
                const row = event.target.closest('.weapon-row');
                if (!row || !root.contains(row)) return;
                const checkbox = row.querySelector('.weapon-checkbox');
                if (!checkbox || checkbox.disabled) return;
                // The checkbox toggles itself; clicking anywhere else on the row stands in for it.
                if (event.target !== checkbox) checkbox.checked = !checkbox.checked;
                this.syncRowSelection(row, checkbox);
            }, {signal});

            root.querySelector('.weapon-confirm')?.addEventListener('click', event => {
                event.preventDefault();
                this.confirmSelection();
            }, {signal});

            root.querySelector('.weapon-cancel')?.addEventListener('click', event => {
                event.preventDefault();
                this.close();
            }, {signal});

            for (const checkbox of root.querySelectorAll('.weapon-checkbox')) {
                this.syncRowSelection(checkbox.closest('.weapon-row'), checkbox);
            }
        }

        /** Make the checked state visible on the row, so an unselected confirm is never a surprise. */
        syncRowSelection(row, checkbox) {
            if (row) row.classList.toggle('weapon-selected', !!checkbox?.checked);
        }

        async close(options = {}) {
            this._listeners?.abort();
            this._listeners = null;
            return super.close(options);
        }

        prepareWeaponData(weapon) {
            // 「무기 없음」 한 장. 이름은 `-` 고 수치 칸은 전부 빈칸이라, 표에서 아무것도
            // 고르지 않은 것처럼 보인다. 공격 종류만 이 판정의 attackRoll 을 따른다.
            if (weapon.isVirtualWeapon) {
                return {
                    id: weapon.id,
                    name: weapon.name,
                    type: this.getSkillDisplay(weapon.system.type),
                    skill: '',
                    range: '',
                    add: '',
                    attack: '',
                    guard: '',
                    equipped: false,
                    isVehicle: false,
                    isVirtual: true,
                    sort: weapon.sort || 0,
                    attackExhausted: false,
                    attackDisabled: false,
                    attackUsedState: 0,
                    attackUsedMax: 0
                };
            }
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
                    attackDisabled: false,
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
                isVirtual: !!weapon.isVirtualWeapon,
                sort: weapon.sort || 0,
                // 소진 표시(빨간 n/m)는 설정과 무관하게 그대로 두고, 체크박스를 잠글지만 가른다.
                attackExhausted: isAttackExhausted,
                attackDisabled: isAttackExhausted
                    && window.DX3rdItemExhausted?.allowExhaustedUse?.() === false,
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

        /**
         * Build the attack bonus from the checked rows. `null` = no weapon at all.
         *
         * An empty selection is not an error: the list already carries a `-` row meaning
         * "no weapon", so confirming without a check means the same thing. Refusing it left
         * the only way forward through the combo sheet's weapon slot — a dead end when the
         * check was authored as "select at use time".
         */
        collectSelection() {
            const selectedWeaponIds = Array.from(this.element?.querySelectorAll('.weapon-checkbox:checked') || [])
                .map(input => input.dataset.weaponId)
                .filter(Boolean);

            // 「무기 없음」 한 장은 운반값에 남기지 않는다 — 이름도 id 도 수치도 싣지 않아야
            // 판정 카드에 「무기: -」 줄이 생기지 않고, 정말 안 고른 것과 결과가 같아진다.
            // 그것만 골랐으면 무기 보너스 자체가 없는 것이므로 null 을 돌려준다.
            const isVirtual = (id) => window.DX3rdVirtualWeapons?.isVirtual?.(id);
            const realWeaponIds = selectedWeaponIds.filter(id => !isVirtual(id));
            if (realWeaponIds.length === 0) return null;

            let totalAttack = 0;
            let totalAdd = 0;
            let attackFormula = '';
            let addFormula = '';
            const weaponNames = [];

            for (const weaponId of realWeaponIds) {
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

            return {
                attack: totalAttack,
                add: totalAdd,
                attackFormula,
                addFormula,
                weaponName: weaponNames.join(', '),
                weaponIds: realWeaponIds
            };
        }

        async confirmSelection() {
            // The confirm listener is re-attached on every render; a second click while the
            // callback is still running would open two roll dialogs for one use.
            if (this._submitting) return;
            this._submitting = true;

            let bonus = null;
            try {
                bonus = this.collectSelection();
            } catch (error) {
                this._submitting = false;
                console.error('DX3rd | WeaponForAttackDialog - Failed to read the weapon selection', error);
                ui.notifications.error(game.i18n.localize('DX3rd.WeaponSelectionFailed'));
                return;
            }

            // Close before handing off. The callback opens the roll dialog, and if it throws,
            // leaving this window up with no message reads as "the process just stopped".
            await this.close();
            try {
                await this.callback(bonus);
            } catch (error) {
                console.error('DX3rd | WeaponForAttackDialog - The roll could not be started', error);
                ui.notifications.error(game.i18n.localize('DX3rd.WeaponSelectionFailed'));
            }
        }
    }

    window.DX3rdWeaponForAttackDialog = DX3rdWeaponForAttackDialog;
})();
