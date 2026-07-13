// Skills Settings Dialog
(function() {
    const api = foundry.applications?.api;
    if (!api?.ApplicationV2 || !api?.HandlebarsApplicationMixin || !api?.DialogV2) {
        console.warn('DX3rd | Skills Settings AppV2 dialog is unavailable in this Foundry version.');
        return;
    }

    const BaseApplication = api.HandlebarsApplicationMixin(api.ApplicationV2);
    const DialogV2 = api.DialogV2;

    const DEFAULT_SKILLS = {
        melee: { name: 'DX3rd.melee', base: 'body', delete: false },
        evade: { name: 'DX3rd.evade', base: 'body', delete: false },
        ranged: { name: 'DX3rd.ranged', base: 'sense', delete: false },
        perception: { name: 'DX3rd.perception', base: 'sense', delete: false },
        rc: { name: 'DX3rd.rc', base: 'mind', delete: false },
        will: { name: 'DX3rd.will', base: 'mind', delete: false },
        negotiation: { name: 'DX3rd.negotiation', base: 'social', delete: false },
        procure: { name: 'DX3rd.procure', base: 'social', delete: false }
    };

    const DEFAULT_SKILL_BASES = {
        melee: 'body',
        evade: 'body',
        ranged: 'sense',
        perception: 'sense',
        rc: 'mind',
        will: 'mind',
        negotiation: 'social',
        procure: 'social',
        cthulhu: 'mind'
    };

    const ATTRIBUTE_GROUPS = [
        { key: 'body', nameKey: 'DX3rd.Body' },
        { key: 'sense', nameKey: 'DX3rd.Sense' },
        { key: 'mind', nameKey: 'DX3rd.Mind' },
        { key: 'social', nameKey: 'DX3rd.Social' }
    ];

    class DX3rdSkillsSettingsDialog extends BaseApplication {
        static DEFAULT_OPTIONS = {
            id: 'skills-settings-dialog',
            classes: ['dx3rd-emanim', 'dialog', 'skills-settings-dialog'],
            window: {
                title: 'DX3rd.SkillsSettings',
                resizable: true
            },
            position: {
                width: 720,
                height: 620
            }
        };

        static PARTS = {
            main: {
                template: 'systems/dx3rd-emanim/templates/dialog/skills-settings-dialog.html',
                root: true
            }
        };

        constructor(options = {}) {
            const mergedOptions = foundry.utils.mergeObject({
                window: { title: game.i18n.localize('DX3rd.SkillsSettings') }
            }, options, { inplace: false });
            super(mergedOptions);
        }

        async _prepareContext(options) {
            const context = await super._prepareContext(options);
            const stageCRCEnabled = game.settings.get('dx3rd-emanim', 'stageCRC');
            const defaultSkills = this._getDefaultSkills(stageCRCEnabled);
            const customSkills = game.settings.get('dx3rd-emanim', 'customSkills') || {};

            context.skillsByAttribute = ATTRIBUTE_GROUPS.map(group => {
                const groupSkills = Object.entries(defaultSkills)
                    .filter(([, skill]) => skill.base === group.key)
                    .map(([key, skill]) => ({
                        key,
                        name: skill.name,
                        localizedName: this._getSkillDisplayName(key, skill, customSkills),
                        base: skill.base,
                        delete: skill.delete,
                        isDefault: true
                    }));

                for (const [key, data] of Object.entries(customSkills)) {
                    if (defaultSkills[key] || key === 'cthulhu') continue;
                    const skillName = typeof data === 'object' ? data.name : data;
                    const skillBase = typeof data === 'object' ? data.base : 'body';
                    if (skillBase !== group.key) continue;

                    groupSkills.push({
                        key,
                        name: skillName,
                        localizedName: skillName,
                        base: skillBase,
                        delete: true,
                        isDefault: false
                    });
                }

                return {
                    attributeKey: group.key,
                    attributeName: game.i18n.localize(group.nameKey),
                    skills: groupSkills
                };
            });
            context.stageCRCEnabled = stageCRCEnabled;
            return context;
        }

        async _onRender(context, options) {
            await super._onRender(context, options);
            const root = this._root;
            if (!root) return;

            this._eventController?.abort();
            this._eventController = new AbortController();
            const listenerOptions = { signal: this._eventController.signal };

            root.addEventListener('submit', event => event.preventDefault(), listenerOptions);

            this._on(root, '.save-skills', 'click', (event) => {
                event.preventDefault();
                this._onSaveSkills();
            }, listenerOptions);
            this._on(root, '.add-skill', 'click', (event, target) => {
                event.preventDefault();
                this._onAddSkill(target);
            }, listenerOptions);
            this._on(root, '.delete-skill', 'click', (event, target) => {
                event.preventDefault();
                this._onDeleteSkill(target);
            }, listenerOptions);
            this._on(root, '.clickable-skill-key', 'click', (event, target) => {
                event.preventDefault();
                this._onAddSkillToActors(target);
            }, listenerOptions);
        }

        async close(options = {}) {
            this._eventController?.abort();
            this._eventController = null;
            return super.close(options);
        }

        get _root() {
            return this.element instanceof HTMLElement ? this.element : this.element?.[0] || null;
        }

        _on(root, selector, eventName, handler, options = {}) {
            root.addEventListener(eventName, event => {
                const target = event.target?.closest?.(selector);
                if (!target || !root.contains(target)) return;
                handler.call(this, event, target);
            }, options);
        }

        _getDefaultSkills(stageCRCEnabled = game.settings.get('dx3rd-emanim', 'stageCRC')) {
            const defaultSkills = foundry.utils.deepClone(DEFAULT_SKILLS);
            if (stageCRCEnabled) {
                defaultSkills.cthulhu = { name: 'DX3rd.cthulhu', base: 'mind', delete: true };
            }
            return defaultSkills;
        }

        _getSkillDisplayName(key, skill, customSkills) {
            if (!customSkills[key]) return game.i18n.localize(skill.name);
            return typeof customSkills[key] === 'object'
                ? customSkills[key].name
                : customSkills[key];
        }

        _cloneCustomSkills() {
            return foundry.utils.deepClone(game.settings.get('dx3rd-emanim', 'customSkills') || {});
        }

        async _onSaveSkills() {
            const root = this._root;
            if (!root) return;

            const customSkills = this._cloneCustomSkills();

            const nameInputs = root.querySelectorAll('input[name^="skill-name-"]');
            for (const input of nameInputs) {
                const key = input.name;
                const trimmedValue = String(input.value).trim();
                if (!trimmedValue) continue;

                const skillKey = key.replace('skill-name-', '');
                const originalName = this.getOriginalSkillName(skillKey);

                if (originalName && trimmedValue !== originalName) {
                    customSkills[skillKey] = {
                        name: trimmedValue,
                        base: DEFAULT_SKILL_BASES[skillKey] || 'mind'
                    };
                } else if (originalName && trimmedValue === originalName) {
                    delete customSkills[skillKey];
                } else if (typeof customSkills[skillKey] === 'object' && customSkills[skillKey].name) {
                    customSkills[skillKey].name = trimmedValue;
                } else if (!originalName) {
                    customSkills[skillKey] = trimmedValue;
                }
            }

            await game.settings.set('dx3rd-emanim', 'customSkills', customSkills);
            // 이름 표시는 customSkills 설정을 직접 참조한다. 여기서 모든 액터를
            // 갱신하면 단순한 설정 저장이 대량 문서 수정으로 바뀌므로 하지 않는다.
            ui.notifications.info(game.i18n.localize('DX3rd.SkillsSettingsSaved'));
            this.render({ force: true });
        }

        async _onAddSkill(button) {
            const attribute = button.dataset.attribute;
            const row = button.closest('.add-skill-row');
            const keyInput = row?.querySelector('.new-skill-key');
            const nameInput = row?.querySelector('.new-skill-name');
            const skillKey = keyInput?.value?.trim();
            const skillName = nameInput?.value?.trim();

            if (!skillName) {
                ui.notifications.warn('스킬 이름을 입력해주세요.');
                return;
            }

            if (!skillKey) {
                ui.notifications.warn('스킬 키를 입력해주세요.');
                return;
            }

            const customSkills = this._cloneCustomSkills();
            const defaultSkills = this._getDefaultSkills(true);
            if (defaultSkills[skillKey] || customSkills[skillKey]) {
                ui.notifications.warn(`스킬 키 "${skillKey}"는 이미 존재합니다.`);
                return;
            }

            customSkills[skillKey] = {
                name: skillName,
                base: attribute
            };
            await game.settings.set('dx3rd-emanim', 'customSkills', customSkills);

            ui.notifications.info(`새 스킬 "${skillName}" (${skillKey})이 추가되었습니다.`);
            this.render({ force: true });
        }

        async _onDeleteSkill(button) {
            if (button.classList.contains('disabled')) return;

            const skillKey = button.dataset.skillKey;
            if (!skillKey) return;

            const confirmed = await DialogV2.confirm({
                window: { title: '스킬 삭제' },
                content: `<p>정말로 이 스킬을 삭제하시겠습니까?</p><p><strong>${skillKey}</strong></p>`
            });
            if (!confirmed) return;

            const customSkills = this._cloneCustomSkills();
            delete customSkills[skillKey];
            await game.settings.set('dx3rd-emanim', 'customSkills', customSkills);

            ui.notifications.info(`스킬 "${skillKey}"이 삭제되었습니다.`);
            this.render({ force: true });
        }

        getOriginalSkillName(skillKey) {
            const defaultSkills = {
                melee: game.i18n.localize('DX3rd.melee'),
                evade: game.i18n.localize('DX3rd.evade'),
                ranged: game.i18n.localize('DX3rd.ranged'),
                perception: game.i18n.localize('DX3rd.perception'),
                rc: game.i18n.localize('DX3rd.rc'),
                will: game.i18n.localize('DX3rd.will'),
                negotiation: game.i18n.localize('DX3rd.negotiation'),
                procure: game.i18n.localize('DX3rd.procure'),
                cthulhu: game.i18n.localize('DX3rd.cthulhu')
            };

            return defaultSkills[skillKey] || null;
        }

        async _onAddSkillToActors(input) {
            const skillKey = input.dataset.skillKey;
            const skillBase = input.dataset.skillBase;

            if (!skillKey || !skillBase) {
                ui.notifications.warn('스킬 정보를 찾을 수 없습니다.');
                return;
            }

            const customSkills = game.settings.get('dx3rd-emanim', 'customSkills') || {};
            const skillData = customSkills[skillKey];
            if (!skillData) {
                ui.notifications.warn(`스킬 "${skillKey}"를 찾을 수 없습니다.`);
                return;
            }

            const skillName = typeof skillData === 'object' ? skillData.name : skillData;
            const confirmed = await DialogV2.confirm({
                window: { title: '스킬 추가 확인' },
                content: `<p>스킬 "<strong>${skillName}</strong>" (${skillKey})을(를) 해당 스킬이 없는 모든 캐릭터 액터에게 추가하시겠습니까?</p>`,
                defaultYes: false
            });
            if (!confirmed) return;

            const actors = game.actors.filter(actor => actor.type === 'character');
            let addedCount = 0;
            let skippedCount = 0;

            for (const actor of actors) {
                if (actor.system.attributes.skills[skillKey]) {
                    skippedCount++;
                    continue;
                }

                try {
                    await actor.update({
                        [`system.attributes.skills.${skillKey}`]: {
                            name: skillName,
                            point: 0,
                            bonus: 0,
                            extra: 0,
                            total: 0,
                            dice: 0,
                            add: 0,
                            base: skillBase,
                            delete: true
                        }
                    });
                    addedCount++;
                } catch (error) {
                    console.error(`DX3rd | Failed to add skill to actor ${actor.name}:`, error);
                }
            }

            ui.notifications.info(`스킬 "${skillName}"을(를) ${addedCount}명의 액터에게 추가했습니다. (건너뜀: ${skippedCount})`);
        }
    }

    // 전역 노출
    window.DX3rdSkillsSettingsDialog = DX3rdSkillsSettingsDialog;
})();
