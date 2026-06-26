/**
 * Double Cross 3rd Skill Create Dialog
 */
(function() {
    const api = foundry.applications?.api;
    if (!api?.ApplicationV2 || !api?.HandlebarsApplicationMixin) {
        console.warn('DX3rd | Skill Create AppV2 dialog is unavailable in this Foundry version.');
        return;
    }

    const BaseApplication = api.HandlebarsApplicationMixin(api.ApplicationV2);

    class DX3rdSkillCreateDialog extends BaseApplication {
        static DEFAULT_OPTIONS = {
            classes: ['dx3rd-emanim', 'dialog', 'skill-dialog'],
            window: {
                title: 'DX3rd.CreateSkill',
                resizable: true
            },
            position: {
                width: 600,
                height: 'auto'
            }
        };

        static PARTS = {
            main: {
                template: 'systems/dx3rd-emanim/templates/dialog/skill-create-dialog.html',
                root: true
            }
        };

        constructor(options = {}) {
            const {skill, actorId, ...dialogOptions} = options;
            super({
                window: {title: dialogOptions.title || game.i18n.localize('DX3rd.CreateSkill')},
                position: {
                    width: dialogOptions.width || 600,
                    height: dialogOptions.height || 'auto'
                }
            });

            this.skillData = skill || {};
            this.actorId = actorId;
        }

        async _prepareContext(options) {
            const context = await super._prepareContext(options);
            context.title = this.options.window?.title || game.i18n.localize('DX3rd.CreateSkill');
            context.skill = this.skillData;
            return context;
        }

        async _onRender(context, options) {
            await super._onRender(context, options);
            const root = this.element;
            if (!root) return;

            root.addEventListener('submit', event => event.preventDefault());

            const abilityId = this.skillData.base;
            const dice = this.skillData.dice || 0;
            const baseSelect = root.querySelector('#skill-base');
            if (baseSelect) {
                baseSelect.value = abilityId;
                baseSelect.disabled = true;
            }

            const updateTotal = () => {
                const point = this._numberValue('#skill-point');
                const extra = this._numberValue('#skill-extra');
                const works = this._numberValue('#skill-works');
                const bonus = this._numberValue('#skill-bonus');
                this._setSignedValue('#skill-total', point + extra + works + bonus);
                const diceInput = root.querySelector('#skill-dice');
                if (diceInput) diceInput.value = `+${dice}D`;
            };

            root.querySelector('#skill-point')?.addEventListener('input', updateTotal);
            root.querySelector('#skill-extra')?.addEventListener('input', updateTotal);
            root.querySelector('#skill-works')?.addEventListener('input', updateTotal);

            root.querySelectorAll('.auto-sign').forEach(input => {
                input.addEventListener('input', () => this._normalizeSignedInput(input));
                this._setInputSignedValue(input, Number(input.value) || 0);
            });

            root.querySelector('.dialog-button[data-button="create"]')?.addEventListener('click', event => {
                event.preventDefault();
                this.createSkill();
            });

            root.querySelector('.dialog-button[data-button="cancel"]')?.addEventListener('click', event => {
                event.preventDefault();
                this.close();
            });

            updateTotal();
        }

        async createSkill() {
            const actor = game.actors.get(this.actorId);
            if (!actor) {
                console.error('[SkillCreateDialog] 저장 시 actor를 찾을 수 없습니다:', this.actorId);
                return;
            }

            const key = this._value('#skill-key').trim();
            if (!key) {
                console.warn('[SkillCreateDialog] 스킬 키가 비어있음');
                ui.notifications.error(game.i18n.localize('DX3rd.ErrorSkillKeyRequired'));
                return;
            }

            if (actor.system.attributes.skills[key]) {
                console.warn('[SkillCreateDialog] 이미 존재하는 스킬 키:', key);
                ui.notifications.error(game.i18n.localize('DX3rd.ErrorSkillKeyExists'));
                return;
            }

            const abilityId = this.skillData.base;
            const skills = actor.system.attributes.skills;
            const baseSkills = Object.entries(skills)
                .filter(([_, skill]) => skill.base === abilityId)
                .sort((a, b) => {
                    if (a[1].delete === false && b[1].delete === true) return -1;
                    if (a[1].delete === true && b[1].delete === false) return 1;
                    return a[1].name.localeCompare(b[1].name);
                });

            const point = this._numberValue('#skill-point');
            const extra = this._numberValue('#skill-extra');
            const bonus = this._numberValue('#skill-bonus');
            const works = this._numberValue('#skill-works');
            const dice = actor.system.attributes[abilityId]?.dice || 0;
            const newSkillData = {
                name: this._value('#skill-name'),
                point,
                extra,
                bonus,
                total: point + extra + bonus + works,
                base: abilityId,
                delete: true,
                order: baseSkills.length,
                dice,
                add: 0
            };

            try {
                await actor.update({[`system.attributes.skills.${key}`]: newSkillData});
                this.close();
            } catch (err) {
                console.error('[SkillCreateDialog] 스킬 생성 실패:', {
                    error: err,
                    actorId: this.actorId,
                    skillKey: key,
                    skillData: newSkillData
                });
            }
        }

        _value(selector) {
            return this.element?.querySelector(selector)?.value || '';
        }

        _numberValue(selector) {
            return Number(this._value(selector).replace('+', '')) || 0;
        }

        _setSignedValue(selector, value) {
            const input = this.element?.querySelector(selector);
            if (input) this._setInputSignedValue(input, value);
        }

        _setInputSignedValue(input, value) {
            if (value === 0) input.value = '0';
            else if (value > 0) input.value = `+${value}`;
            else input.value = value.toString();
        }

        _normalizeSignedInput(input) {
            let value = input.value.replace(/[^0-9+-]/g, '');
            value = value.replace(/(?!^)[+-]/g, '');
            if (value === '+' || value === '-') {
                input.value = value;
                return;
            }
            this._setInputSignedValue(input, Number(value) || 0);
        }
    }

    window.DX3rdSkillCreateDialog = DX3rdSkillCreateDialog;
})();
