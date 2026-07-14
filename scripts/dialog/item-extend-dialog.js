/**
 * Item Extend Dialog
 * 아이템 확장 도구 다이얼로그
 */
(function() {
    const api = foundry.applications?.api;
    if (!api?.ApplicationV2 || !api?.HandlebarsApplicationMixin) {
        console.warn('DX3rd | Item Extend AppV2 dialog is unavailable in this Foundry version.');
        return;
    }

    const BaseApplication = api.HandlebarsApplicationMixin(api.ApplicationV2);

    class DX3rdItemExtendDialog extends BaseApplication {
        static DEFAULT_OPTIONS = {
            // 'sheet'+'item' 을 부여해 아이템 V2 시트의 모노 다크 테마(appv2-sheets.css)를
            // 그대로 재사용한다. 다이얼로그 전용 스타일 중복을 피한다.
            classes: ['dx3rd-emanim', 'sheet', 'item', 'dialog', 'item-extend-dialog'],
            tag: 'form',
            window: {
                title: 'DX3rd.ItemExtend',
                resizable: true
            },
            position: {
                width: 650,
                height: 550
            }
        };

        static PARTS = {
            main: {
                template: 'systems/dx3rd-emanim/templates/dialog/item-extend-dialog.html'
            }
        };

        constructor(dialogData = {}, options = {}) {
            const mergedOptions = foundry.utils.mergeObject({
                window: {title: dialogData.title || game.i18n.localize('DX3rd.ItemExtend')}
            }, options, {inplace: false});
            super(mergedOptions);

            this.actorId = dialogData.actorId;
            this.itemId = dialogData.itemId;
            this.currentTopTab = 'affectCharacter';
            this.currentSubTab = 'heal';
            this.tempFormData = {};
            this.savedItemExtend = {};
        }

        async _prepareContext(options) {
            const data = await super._prepareContext(options);

            let item = null;
            let actor = null;
            let skills = {};

            if (this.actorId && this.itemId) {
                actor = game.actors.get(this.actorId);
                if (actor) {
                    item = actor.items.get(this.itemId);
                    skills = actor.system.attributes.skills || {};
                }
            } else if (this.itemId) {
                item = game.items.get(this.itemId);
                skills = {
                    melee: {name: 'DX3rd.melee'},
                    evade: {name: 'DX3rd.evade'},
                    ranged: {name: 'DX3rd.ranged'},
                    perception: {name: 'DX3rd.perception'},
                    rc: {name: 'DX3rd.rc'},
                    will: {name: 'DX3rd.will'},
                    negotiation: {name: 'DX3rd.negotiation'},
                    procure: {name: 'DX3rd.procure'}
                };
            }

            if (item) {
                data.actor = actor;
                data.item = item;
                data.itemType = item.type;
                this.savedItemExtend = item.getFlag('dx3rd-emanim', 'itemExtend') || {};
                data.actorSkills = skills;
                data.weaponSkillOptions = window.DX3rdSkillManager.getSkillSelectOptions('weapon', skills);
                data.vehicleSkillOptions = window.DX3rdSkillManager.getSkillSelectOptions('vehicle', skills);
                if (item.type === 'effect') {
                    data.effectSkillOptions = window.DX3rdSkillManager.getSkillSelectOptions('effect', skills);
                }
            }

            return data;
        }

        async _onRender(context, options) {
            await super._onRender(context, options);
            const root = this._root;
            if (!root) return;

            root.addEventListener('submit', event => event.preventDefault());
            this._on(root, '.top-tab', 'click', (event, target) => {
                event.preventDefault();
                this.switchTopTab(target.dataset.tab);
            });
            this._on(root, '.sub-tab', 'click', (event, target) => {
                event.preventDefault();
                this.switchSubTab(target.dataset.tab);
            });
            this._on(root, 'input[name="weaponFist"]', 'change', (event, target) => {
                const weaponContent = this._query('#weapon-content');
                this.toggleWeaponFields(
                    target.checked,
                    this._query('input[name="weaponName"]', weaponContent),
                    this._query('input[name="weaponAmount"]', weaponContent)
                );
            });
            this._on(root, 'input[name="healResurrect"]', 'change', (event, target) => {
                this.toggleHealResurrectFields(target.checked, this._healResurrectFields(this._query('#heal-content')));
            });
            this._on(root, 'input[name="damageConditionalFormula"]', 'change', (event, target) => {
                const damageContent = this._query('#damage-content');
                this.toggleDamageConditionalFields(
                    target.checked,
                    this._query('input[name="damageFormulaDice"]', damageContent),
                    this._query('input[name="damageFormulaAdd"]', damageContent)
                );
            });
            this._on(root, 'select[name^="cond"][name$="Type"]', 'change', (event, target) => {
                const match = target.name.match(/^cond([123])Type$/);
                if (!match) return;
                this.setupConditionPoisonedToggle(`condition${match[1]}`);
            });

            // 자동 저장: 다른 시트들과 동일하게 확인 버튼 없이 필드 변경 즉시 반영한다.
            // 토글 핸들러(무기 맨손/힐 부활/데미지 조건식/상태이상 종류)들이 값을 프로그램으로
            // 채운 뒤 실행되도록 이 리스너를 가장 마지막에 등록한다(같은 change 이벤트에서 뒤에 실행).
            root.addEventListener('change', event => {
                if (event.target.matches('input, select, textarea')) this._saveCurrentTab();
            });

            this.initializeTabs();
            this.setupWeaponFistToggle();
            this.setupHealResurrectToggle();
            this.setupDamageConditionalFormulaToggle();
        }

        get _root() {
            return this.element instanceof HTMLElement ? this.element : this.element?.[0] || null;
        }

        _query(selector, root = this._root) {
            return root?.querySelector?.(selector) || null;
        }

        _queryAll(selector, root = this._root) {
            return Array.from(root?.querySelectorAll?.(selector) || []);
        }

        _on(root, selector, eventName, handler) {
            root.addEventListener(eventName, event => {
                const target = event.target?.closest?.(selector);
                if (!target || !root.contains(target)) return;
                handler.call(this, event, target);
            });
        }

        _value(selector, root = this._root) {
            return this._query(selector, root)?.value ?? '';
        }

        _checked(selector, root = this._root) {
            return Boolean(this._query(selector, root)?.checked);
        }

        _setDisabled(element, disabled) {
            if (!element) return;
            element.disabled = disabled;
            element.classList.toggle('disabled', disabled);
        }

        initializeTabs() {
            this.switchTopTab('affectCharacter');
            this.switchSubTab('heal');
            this.applySavedToForm('heal');
        }

        switchTopTab(topTab) {
            if (!topTab) return;
            this._queryAll('.top-tab').forEach(tab => tab.classList.toggle('active', tab.dataset.tab === topTab));
            this._queryAll('.sub-tabs').forEach(tabGroup => tabGroup.classList.remove('active'));
            this._query(`#${topTab}-sub-tabs`)?.classList.add('active');

            const firstSubTab = this._query(`#${topTab}-sub-tabs .sub-tab`);
            if (firstSubTab) this.switchSubTab(firstSubTab.dataset.tab);
            this.currentTopTab = topTab;
        }

        switchSubTab(subTab) {
            if (!subTab) return;
            this._storeCurrentSubTab();

            this._queryAll('.sub-tab').forEach(tab => tab.classList.toggle('active', tab.dataset.tab === subTab));
            this._queryAll('.content-section').forEach(section => section.classList.remove('active'));
            this._query(`#${subTab}-content`)?.classList.add('active');

            this.currentSubTab = subTab;
            if (this.tempFormData[subTab]) this.applyDataToForm(subTab, this.tempFormData[subTab]);
            else this.applySavedToForm(subTab);

            if (subTab === 'weapon') this.setupWeaponFistToggle();
            if (subTab === 'heal') this.setupHealResurrectToggle();
            if (subTab === 'damage') this.setupDamageConditionalFormulaToggle();
            if (['heal', 'damage', 'condition1', 'condition2', 'condition3'].includes(subTab)) {
                this.setupTimingLockForRestrictedItems(subTab);
            }
            if (['condition1', 'condition2', 'condition3'].includes(subTab)) {
                this.setupConditionPoisonedToggle(subTab);
            }
        }

        _storeCurrentSubTab() {
            if (!this.currentSubTab) return;
            if (['condition1', 'condition2', 'condition3'].includes(this.currentSubTab)) {
                const idx = this.currentSubTab === 'condition1' ? 1 : (this.currentSubTab === 'condition2' ? 2 : 3);
                const section = this._query(`#${this.currentSubTab}-content`);
                if (!section) return;
                const type = this._value(`select[name="cond${idx}Type"]`, section);
                this.tempFormData[this.currentSubTab] = {
                    timing: this._value(`select[name="cond${idx}Timing"]`, section),
                    target: this._value(`select[name="cond${idx}Target"]`, section),
                    type: type || '',
                    poisonedRank: type === 'poisoned' ? this._value(`input[name="cond${idx}PoisonedRank"]`, section) : null,
                    activate: this._checked(`input[name="cond${idx}Activate"]`, section)
                };
                return;
            }

            const currentFormData = this.getFormData();
            this.tempFormData[this.currentSubTab] = currentFormData[this.currentSubTab];
        }

        setupWeaponFistToggle() {
            const weaponContent = this._query('#weapon-content');
            if (!weaponContent) return;

            const fistCheckbox = this._query('input[name="weaponFist"]', weaponContent);
            const nameField = this._query('input[name="weaponName"]', weaponContent);
            const amountField = this._query('input[name="weaponAmount"]', weaponContent);

            this.toggleWeaponFields(Boolean(fistCheckbox?.checked), nameField, amountField);
        }

        toggleWeaponFields(isFistMode, nameField, amountField) {
            this._setDisabled(nameField, false);
            this._setDisabled(amountField, isFistMode);
        }

        setupHealResurrectToggle() {
            const healContent = this._query('#heal-content');
            if (!healContent) return;

            const resurrectCheckbox = this._query('input[name="healResurrect"]', healContent);
            const fields = this._healResurrectFields(healContent);
            this.toggleHealResurrectFields(Boolean(resurrectCheckbox?.checked), fields);
        }

        _healResurrectFields(root) {
            return {
                dice: this._query('input[name="healFormulaDice"]', root),
                add: this._query('input[name="healFormulaAdd"]', root),
                timing: this._query('select[name="healTiming"]', root),
                target: this._query('select[name="healTarget"]', root),
                rivival: this._query('input[name="healRivival"]', root),
                activate: this._query('input[name="healActivate"]', root)
            };
        }

        toggleHealResurrectFields(isResurrectMode, fields) {
            if (isResurrectMode) {
                fields.dice.value = `[${game.i18n.localize('DX3rd.Level')}]`;
                fields.add.value = '0';
                fields.timing.value = 'instant';
                fields.target.value = 'self';
                fields.rivival.checked = true;
                fields.activate.checked = true;
            }

            this._setDisabled(fields.dice, isResurrectMode);
            this._setDisabled(fields.add, isResurrectMode);
            this._setDisabled(fields.timing, isResurrectMode);
            this._setDisabled(fields.target, isResurrectMode);
            this._setDisabled(fields.rivival, isResurrectMode);
            this._setDisabled(fields.activate, isResurrectMode);
        }

        setupDamageConditionalFormulaToggle() {
            const damageContent = this._query('#damage-content');
            if (!damageContent) return;

            const conditionalCheckbox = this._query('input[name="damageConditionalFormula"]', damageContent);
            const diceField = this._query('input[name="damageFormulaDice"]', damageContent);
            const addField = this._query('input[name="damageFormulaAdd"]', damageContent);

            this.toggleDamageConditionalFields(Boolean(conditionalCheckbox?.checked), diceField, addField);
        }

        toggleDamageConditionalFields(isConditionalMode, diceField, addField) {
            if (isConditionalMode) {
                diceField.value = '';
                addField.value = '';
            }
            this._setDisabled(diceField, isConditionalMode);
            this._setDisabled(addField, isConditionalMode);
        }

        setupConditionPoisonedToggle(subTab) {
            const idx = subTab === 'condition1' ? 1 : (subTab === 'condition2' ? 2 : 3);
            const section = this._query(`#${subTab}-content`);
            if (!section) return;

            const typeSelect = this._query(`select[name="cond${idx}Type"]`, section);
            const rankInput = this._query(`input[name="cond${idx}PoisonedRank"]`, section);
            const applyToggle = () => {
                const isPoisoned = typeSelect?.value === 'poisoned';
                if (!isPoisoned && rankInput) rankInput.value = '';
                this._setDisabled(rankInput, !isPoisoned);
            };
            applyToggle();
        }

        setupTimingLockForRestrictedItems(subTab) {
            try {
                const actor = game.actors.get(this.actorId);
                const item = actor?.items?.get(this.itemId) || game.items.get(this.itemId);
                if (!item || !['protect', 'once', 'etc'].includes(item.type)) return;

                const section = this._query(`#${subTab}-content`);
                if (!section) return;

                if (['condition1', 'condition2', 'condition3'].includes(subTab)) {
                    const idx = subTab === 'condition1' ? 1 : (subTab === 'condition2' ? 2 : 3);
                    const timingSelect = this._query(`select[name="cond${idx}Timing"]`, section);
                    if (timingSelect) {
                        timingSelect.value = 'instant';
                        this._setDisabled(timingSelect, true);
                    }
                    return;
                }

                const timingSelect = this._query(`select[name="${subTab}Timing"]`, section);
                if (timingSelect) {
                    timingSelect.value = 'instant';
                    this._setDisabled(timingSelect, true);
                }
            } catch (e) {
                console.warn('DX3rd | setupTimingLockForRestrictedItems failed', e);
            }
        }

        applySavedToForm(subTab) {
            try {
                const saved = ['condition1', 'condition2', 'condition3'].includes(subTab)
                    ? this.savedItemExtend?.condition || null
                    : this.savedItemExtend?.[subTab] || null;
                if (saved) this.applyDataToForm(subTab, saved);
            } catch (e) {
                console.warn('DX3rd | applySavedToForm failed', e);
            }
        }

        applyDataToForm(subTab, data) {
            try {
                if (!data) return;

                const prefixMap = {
                    heal: 'heal',
                    damage: 'damage',
                    weapon: 'weapon',
                    protect: 'protect',
                    vehicle: 'vehicle',
                    condition1: 'cond1',
                    condition2: 'cond2',
                    condition3: 'cond3'
                };
                const prefix = prefixMap[subTab] || '';
                const section = this._query(`#${subTab}-content`);
                const cap = s => s.charAt(0).toUpperCase() + s.slice(1);

                if (['condition1', 'condition2', 'condition3'].includes(subTab) && section) {
                    const idx = subTab === 'condition1' ? 0 : (subTab === 'condition2' ? 1 : 2);
                    let c = {};
                    if (Array.isArray(data.conditions) && data.conditions[idx]) c = data.conditions[idx];
                    else if (data.conditionTypes?.length && data.conditionTypes[idx]) {
                        const t = data.conditionTypes[idx];
                        c = {timing: data.timing || 'instant', target: data.target || 'self', type: t, poisonedRank: t === 'poisoned' ? (data.poisonedRank ?? '') : null, activate: data.activate ?? false};
                    } else if (data.type && idx === 0) {
                        c = {timing: data.timing || 'instant', target: data.target || 'self', type: data.type || '', poisonedRank: data.type === 'poisoned' ? (data.poisonedRank ?? '') : null, activate: data.activate ?? false};
                    } else if (data.timing !== undefined || data.type !== undefined) {
                        c = {timing: data.timing || 'instant', target: data.target || 'self', type: data.type || '', poisonedRank: data.poisonedRank ?? null, activate: !!data.activate};
                    }

                    const n = idx + 1;
                    this._query(`select[name="cond${n}Timing"]`, section).value = c.timing || 'instant';
                    this._query(`select[name="cond${n}Target"]`, section).value = c.target || 'self';
                    this._query(`select[name="cond${n}Type"]`, section).value = c.type || '';
                    this._query(`input[name="cond${n}PoisonedRank"]`, section).value = c.poisonedRank ?? '';
                    this._query(`input[name="cond${n}Activate"]`, section).checked = !!c.activate;
                }

                for (const [key, value] of Object.entries(data)) {
                    if (['condition1', 'condition2', 'condition3'].includes(subTab) && ['conditions', 'conditionTypes', 'type'].includes(key)) continue;
                    const candidates = [];
                    if (prefix) candidates.push(`${prefix}${cap(key)}`);
                    candidates.push(key);
                    for (const name of candidates) {
                        const input = this._query(`[name="${name}"]`, section);
                        if (!input) continue;
                        if (input.type === 'checkbox') input.checked = !!value;
                        else input.value = value ?? '';
                        break;
                    }
                }

                this.updateToggleStatesAfterDataLoad(subTab, data);
            } catch (e) {
                console.warn('DX3rd | applyDataToForm failed', e);
            }
        }

        updateToggleStatesAfterDataLoad(subTab, data) {
            try {
                if (!data) return;

                if (subTab === 'heal' && data.resurrect !== undefined) {
                    const healContent = this._query('#heal-content');
                    const resurrectCheckbox = this._query('input[name="healResurrect"]', healContent);
                    this.toggleHealResurrectFields(Boolean(resurrectCheckbox?.checked), this._healResurrectFields(healContent));
                }

                if (subTab === 'damage' && data.conditionalFormula !== undefined) {
                    const damageContent = this._query('#damage-content');
                    this.toggleDamageConditionalFields(
                        this._checked('input[name="damageConditionalFormula"]', damageContent),
                        this._query('input[name="damageFormulaDice"]', damageContent),
                        this._query('input[name="damageFormulaAdd"]', damageContent)
                    );
                }

                if (subTab === 'weapon' && data.fist !== undefined) {
                    const weaponContent = this._query('#weapon-content');
                    this.toggleWeaponFields(
                        this._checked('input[name="weaponFist"]', weaponContent),
                        this._query('input[name="weaponName"]', weaponContent),
                        this._query('input[name="weaponAmount"]', weaponContent)
                    );
                }

                if (['condition1', 'condition2', 'condition3'].includes(subTab)) {
                    const idx = subTab === 'condition1' ? 1 : (subTab === 'condition2' ? 2 : 3);
                    const conditionContent = this._query(`#${subTab}-content`);
                    const typeSelect = this._query(`select[name="cond${idx}Type"]`, conditionContent);
                    const rankInput = this._query(`input[name="cond${idx}PoisonedRank"]`, conditionContent);
                    this._setDisabled(rankInput, typeSelect?.value !== 'poisoned');
                }
            } catch (e) {
                console.warn('DX3rd | updateToggleStatesAfterDataLoad failed', e);
            }
        }

        getFormData() {
            const formData = {};
            const root = this._root;

            if (this._query('#heal-content', root)) {
                formData.heal = {
                    formulaDice: this._value('input[name="healFormulaDice"]', root),
                    formulaAdd: this._value('input[name="healFormulaAdd"]', root),
                    timing: this._value('select[name="healTiming"]', root),
                    target: this._value('select[name="healTarget"]', root),
                    resurrect: this._checked('input[name="healResurrect"]', root),
                    rivival: this._checked('input[name="healRivival"]', root),
                    healTo: this._value('input[name="healTo"]', root),
                    encroachFixed: this._value('input[name="encroachFixed"]', root),
                    activate: this._checked('input[name="healActivate"]', root)
                };
            }

            if (this._query('#damage-content', root)) {
                formData.damage = {
                    formulaDice: this._value('input[name="damageFormulaDice"]', root),
                    formulaAdd: this._value('input[name="damageFormulaAdd"]', root),
                    timing: this._value('select[name="damageTiming"]', root),
                    target: this._value('select[name="damageTarget"]', root),
                    ignoreReduce: this._checked('input[name="ignoreReduce"]', root),
                    conditionalFormula: this._checked('input[name="damageConditionalFormula"]', root),
                    activate: this._checked('input[name="damageActivate"]', root),
                    hpCost: this._value('input[name="hpCost"]', root),
                    hpCostActivate: this._checked('input[name="hpCostActivate"]', root),
                    // 변동형 런타임 입력: 사용 시 수치를 입력받아 [소비HP]/[입력] 토큰으로 공급
                    runtimePrompt: this._checked('input[name="runtimePrompt"]', root),
                    runtimeLabel: this._value('input[name="runtimeLabel"]', root),
                    runtimeDefault: this._value('input[name="runtimeDefault"]', root),
                    runtimeConsumeHP: this._checked('input[name="runtimeConsumeHP"]', root)
                };
            }

            if (this._query('#weapon-content', root)) {
                formData.weapon = {
                    name: this._value('input[name="weaponName"]', root),
                    type: this._value('select[name="weaponType"]', root),
                    skill: this._value('select[name="weaponSkill"]', root),
                    add: this._value('input[name="weaponAdd"]', root),
                    attack: this._value('input[name="weaponAttack"]', root),
                    guard: this._value('input[name="weaponGuard"]', root),
                    range: this._value('input[name="weaponRange"]', root),
                    amount: this._value('input[name="weaponAmount"]', root),
                    fist: this._checked('input[name="weaponFist"]', root),
                    activate: this._checked('input[name="weaponActivate"]', root)
                };
            }

            if (this._query('#protect-content', root)) {
                formData.protect = {
                    name: this._value('input[name="protectName"]', root),
                    dodge: this._value('input[name="protectDodge"]', root),
                    init: this._value('input[name="protectInit"]', root),
                    armor: this._value('input[name="protectArmor"]', root),
                    activate: this._checked('input[name="protectActivate"]', root)
                };
            }

            if (this._query('#vehicle-content', root)) {
                formData.vehicle = {
                    name: this._value('input[name="vehicleName"]', root),
                    skill: this._value('select[name="vehicleSkill"]', root),
                    attack: this._value('input[name="vehicleAttack"]', root),
                    init: this._value('input[name="vehicleInit"]', root),
                    armor: this._value('input[name="vehicleArmor"]', root),
                    move: this._value('input[name="vehicleMove"]', root),
                    activate: this._checked('input[name="vehicleActivate"]', root)
                };
            }

            if (this._query('#condition1-content', root)) {
                const conditions = [];
                for (let i = 1; i <= 3; i++) {
                    const type = this._value(`select[name="cond${i}Type"]`, root);
                    conditions.push({
                        timing: this._value(`select[name="cond${i}Timing"]`, root),
                        target: this._value(`select[name="cond${i}Target"]`, root),
                        type: type || '',
                        poisonedRank: type === 'poisoned' ? this._value(`input[name="cond${i}PoisonedRank"]`, root) : null,
                        activate: this._checked(`input[name="cond${i}Activate"]`, root)
                    });
                }
                formData.condition = {conditions};
                formData.condition1 = conditions[0];
                formData.condition2 = conditions[1];
                formData.condition3 = conditions[2];
            }

            return formData;
        }

        /**
         * 현재 활성 서브탭의 데이터만 저장 플래그에 병합한다. 확인 버튼을 없애고 필드 변경
         * 즉시(자동) 저장하는 방식이라, 아직 방문하지 않은(=기본값인) 다른 탭의 저장값을
         * 덮어쓰지 않도록 전체 폼이 아닌 현재 탭만 반영한다.
         */
        async _saveCurrentTab() {
            try {
                const item = this.actorId
                    ? game.actors.get(this.actorId)?.items?.get(this.itemId)
                    : game.items.get(this.itemId);
                if (!item) return;

                const sub = this.currentSubTab;
                if (!sub) return;
                this._storeCurrentSubTab();

                // 이펙트의 기타 탭은 확장 플래그가 아니라 기존 system 필드를 그대로 편집한다.
                // 데이터 경로를 보존하므로 컴펜디움/월드 아이템 마이그레이션이 필요 없다.
                if (sub === 'effectSettings') {
                    if (item.type !== 'effect') return;
                    await item.update({
                        'system.comboSkill': this._value('select[name="effectSettingsComboSkill"]'),
                        'system.comboBase': this._value('select[name="effectSettingsComboBase"]'),
                        'system.active.applyMode': this._value('select[name="effectSettingsApplyMode"]'),
                        'system.resourceCost.enabled': this._checked('input[name="effectSettingsResourceEnabled"]'),
                        'system.resourceCost.cap': this._value('input[name="effectSettingsResourceCap"]'),
                        'system.resourceCost.mult': Number(this._value('input[name="effectSettingsResourceMult"]')) || 1,
                        'system.resourceCost.attrKey': this._value('select[name="effectSettingsResourceAttrKey"]'),
                        'system.resourceCost.label': this._value('select[name="effectSettingsResourceLabel"]'),
                        'system.resourceCost.disable': this._value('select[name="effectSettingsResourceDisable"]')
                    });
                    // 열려 있는 원본 시트가 숨긴 필드의 현재값을 계속 들고 있지 않도록 즉시 갱신한다.
                    item.sheet?.render(false);
                    return;
                }

                const existing = foundry.utils.deepClone(item.getFlag('dx3rd-emanim', 'itemExtend') || {});

                if (['condition1', 'condition2', 'condition3'].includes(sub)) {
                    const n = sub === 'condition1' ? 1 : (sub === 'condition2' ? 2 : 3);
                    const section = this._query(`#${sub}-content`);
                    const type = this._value(`select[name="cond${n}Type"]`, section);
                    const cData = {
                        timing: this._value(`select[name="cond${n}Timing"]`, section),
                        target: this._value(`select[name="cond${n}Target"]`, section),
                        type: type || '',
                        poisonedRank: type === 'poisoned' ? this._value(`input[name="cond${n}PoisonedRank"]`, section) : null,
                        activate: this._checked(`input[name="cond${n}Activate"]`, section)
                    };
                    const conditions = Array.isArray(existing.condition?.conditions)
                        ? foundry.utils.deepClone(existing.condition.conditions)
                        : [];
                    while (conditions.length < 3) conditions.push({timing: 'instant', target: 'self', type: '', poisonedRank: null, activate: false});
                    conditions[n - 1] = cData;
                    existing.condition = {conditions};
                } else {
                    const form = this.getFormData();
                    if (form[sub] && Object.keys(form[sub]).length) existing[sub] = form[sub];
                }

                await item.setFlag('dx3rd-emanim', 'itemExtend', existing);
                this.savedItemExtend = existing;
            } catch (err) {
                console.error('DX3rd | ItemExtend auto-save error', err);
            }
        }
    }

    window.DX3rdItemExtendDialog = DX3rdItemExtendDialog;
})();
