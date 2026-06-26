/**
 * Double Cross 3rd Skill Edit Dialog
 */
(function() {
    const api = foundry.applications?.api;
    if (!api?.ApplicationV2 || !api?.HandlebarsApplicationMixin) {
        console.warn('DX3rd | Skill Edit AppV2 dialog is unavailable in this Foundry version.');
        return;
    }

    const BaseApplication = api.HandlebarsApplicationMixin(api.ApplicationV2);

    class DX3rdSkillEditDialog extends BaseApplication {
        static DEFAULT_OPTIONS = {
            classes: ['dx3rd-emanim', 'dialog', 'skill-dialog'],
            window: {
                title: 'DX3rd.EditSkill',
                resizable: true
            },
            position: {
                width: 600,
                height: 'auto'
            }
        };

        static PARTS = {
            main: {
                template: 'systems/dx3rd-emanim/templates/dialog/skill-edit-dialog.html',
                root: true
            }
        };

        constructor(options = {}) {
            const {skill, actorId, ...dialogOptions} = options;
            super({
                window: {title: dialogOptions.title || game.i18n.localize('DX3rd.EditSkill')},
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
            context.title = this.options.window?.title || game.i18n.localize('DX3rd.EditSkill');
            context.skill = this.skillData || {};
            return context;
        }

        async _onRender(context, options) {
            await super._onRender(context, options);
            const root = this.element;
            if (!root) return;

            root.addEventListener('submit', event => event.preventDefault());

            const actorId = this.actorId;
            const skillId = this.skillData?.key;
            if (!actorId || !skillId) {
                console.warn('[SkillEditDialog] actorId 또는 skillId가 없습니다.');
                return;
            }

            root.querySelector('.skill-edit-save')?.addEventListener('click', event => {
                event.preventDefault();
                this.saveSkill();
            });

            root.querySelector('.skill-edit-cancel')?.addEventListener('click', event => {
                event.preventDefault();
                this.close();
            });

            root.querySelector('.skill-delete:not(.disabled)')?.addEventListener('click', event => {
                event.preventDefault();
                this.deleteSkill();
            });

            const updateTotalAndActor = () => this.updateTotalAndActor();
            root.querySelector('#skill-point')?.addEventListener('input', updateTotalAndActor);
            root.querySelector('#skill-extra')?.addEventListener('input', updateTotalAndActor);
            root.querySelector('#skill-works')?.addEventListener('input', updateTotalAndActor);
            root.querySelector('#skill-base')?.addEventListener('change', updateTotalAndActor);

            root.querySelectorAll('.auto-sign').forEach(input => {
                input.addEventListener('input', () => this._normalizeSignedInput(input));
                this._setInputSignedValue(input, Number(input.value) || 0);
            });
        }

        async saveSkill() {
            const actor = game.actors.get(this.actorId);
            if (!actor) {
                console.error('[SkillEditDialog] 저장 시 actor를 찾을 수 없습니다:', this.actorId);
                return;
            }

            const skillId = this.skillData?.key;
            const point = this._numberValue('#skill-point');
            const extra = this._numberValue('#skill-extra');
            const works = this._numberValue('#skill-works');
            const base = this._value('#skill-base');
            const bonus = this._numberValue('#skill-bonus');
            const total = point + bonus + extra + works;

            try {
                await actor.update({
                    [`system.attributes.skills.${skillId}.name`]: this._value('#skill-name'),
                    [`system.attributes.skills.${skillId}.point`]: point,
                    [`system.attributes.skills.${skillId}.extra`]: extra,
                    [`system.attributes.skills.${skillId}.bonus`]: bonus,
                    [`system.attributes.skills.${skillId}.base`]: base,
                    [`system.attributes.skills.${skillId}.total`]: total
                });
                this.close();
            } catch (err) {
                console.error('[SkillEditDialog] update 실패:', err);
            }
        }

        async deleteSkill() {
            const actor = game.actors.get(this.actorId);
            const skillId = this.skillData?.key;
            if (!actor) {
                console.error('[SkillEditDialog] 삭제 시 actor를 찾을 수 없습니다:', this.actorId);
                return;
            }
            if (!skillId) {
                console.error('[SkillEditDialog] 삭제 시 skillId가 없습니다.');
                return;
            }

            try {
                if (skillId === 'cthulhu') {
                    await actor.setFlag('dx3rd-emanim', 'cthulhuDeleted', true);
                }
                const ForcedDeletion = foundry.data?.operators?.ForcedDeletion;
                if (ForcedDeletion) {
                    await actor.update({
                        'system.attributes.skills': {[skillId]: new ForcedDeletion()}
                    });
                } else {
                    await actor.update({[`system.attributes.skills.-=${skillId}`]: null});
                }
                this.close();
            } catch (err) {
                console.error('[SkillEditDialog] 스킬 삭제 실패:', err);
            }
        }

        async updateTotalAndActor() {
            const actor = game.actors.get(this.actorId);
            if (!actor) return;

            const skillId = this.skillData?.key;
            const point = this._numberValue('#skill-point');
            const extra = this._numberValue('#skill-extra');
            const works = this._numberValue('#skill-works');
            const bonus = this._numberValue('#skill-bonus');
            const base = this._value('#skill-base');
            const name = this._value('#skill-name');
            const total = point + extra + bonus + works;

            this._setSignedValue('#skill-total', total);

            const newBaseAbility = actor.system.attributes[base];
            const newDice = newBaseAbility ? newBaseAbility.dice || 0 : 0;
            const diceInput = this.element?.querySelector('#skill-dice');
            if (diceInput) diceInput.value = `+${newDice}D`;

            await actor.update({
                [`system.attributes.skills.${skillId}.name`]: name,
                [`system.attributes.skills.${skillId}.point`]: point,
                [`system.attributes.skills.${skillId}.extra`]: extra,
                [`system.attributes.skills.${skillId}.base`]: base,
                [`system.attributes.skills.${skillId}.total`]: total,
                [`system.attributes.skills.${skillId}.dice`]: newDice,
                [`system.attributes.skills.${skillId}.add`]: 0
            });
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

    window.DX3rdSkillEditDialog = DX3rdSkillEditDialog;
})();
