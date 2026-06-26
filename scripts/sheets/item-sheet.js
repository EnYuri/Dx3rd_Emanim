/**
 * Double Cross 3rd Item Sheet
 */
(function() {
    // v13/v14 호환: foundry.appv1.sheets.ItemSheet 폴백 처리
    const _DX3rdItemSheetBase = foundry.appv1?.sheets?.ItemSheet ?? ItemSheet;

    class DX3rdItemSheet extends _DX3rdItemSheetBase {
        /** @override */
        static get defaultOptions() {
            const parentOptions = super.defaultOptions || {};
            return foundry.utils.mergeObject(parentOptions, {
                classes: ['dx3rd-emanim', 'sheet', 'item'],
                width: 520,
                height: 480,
                tabs: [{navSelector: '.sheet-tabs', contentSelector: '.sheet-body', initial: 'description'}]
            });
        }

        /** @override */
        get template() {
            const type = this.item.type;
            return `systems/dx3rd-emanim/templates/item/${type}-sheet.html`;
        }

        /** @override */
        getData() {
            const data = super.getData();
            data.dtypes = ['String', 'Number', 'Boolean'];
            
            // system 객체가 없으면 초기화
            if (!data.system) {
                data.system = {};
            }
            
            // 액터의 스킬 목록을 가져옴
            if (this.item.actor) {
                data.system.actorSkills = this.item.actor.system.attributes.skills || {};
            } else {
                data.system.actorSkills = {};
            }

            // 아이템 타입별 기본 데이터 구조 보장
            if (!data.system.skills) {
                data.system.skills = {};
            }
            if (!data.system.used) {
                data.system.used = {
                    state: 0,
                    max: 0,
                    level: false,
                    disable: "notCheck"
                };
            }
            if (!data.system.saving) {
                data.system.saving = {
                    value: 0,
                    difficulty: "0"
                };
            }
            if (typeof data.system.equipment === 'undefined') {
                data.system.equipment = true;
            }
            
            // 이펙트 타입일 때 레벨 기본값 보정
            if (this.item.type === 'effect') {
                if (!data.system.level) {
                    data.system.level = {};
                }
                if (data.system.level.init == null) {
                    data.system.level.init = 0;
                }
                if (data.system.level.max == null) {
                    data.system.level.max = 0;
                }
                if (data.system.level.value == null) {
                    data.system.level.value = 0;
                }
            }

            return data;
        }

        /** @override */
        activateListeners(html) {
            super.activateListeners(html);

            // 스킬 생성 버튼
            html.find('.skill-create').click(this._onCreateSkill.bind(this));
            
            // 스킬 삭제 버튼
            html.find('.attribute-control[data-action="delete"]').click(this._onDeleteSkill.bind(this));
            
            // 스킬 적용 체크박스
            html.find('.attribute-control[type="checkbox"]').change(this._onToggleSkill.bind(this));

        // Target Tab 통합 리스너 설정
        const targetTabTypes = ['combo', 'effect', 'spell', 'psionic', 'once', 'protect', 'etc', 'vehicle', 'weapon'];
        if (targetTabTypes.includes(this.item.type)) {
            this._setupTargetTabListeners(html);
        }

        // 드래그 앤 드롭 이벤트 리스너
        html.on('dragover', (event) => {
            event.preventDefault();
            event.stopPropagation();
        });

        html.on('drop', async (event) => {
            await this._onDrop(event.originalEvent || event);
        });

        // 이펙트 타입일 때는 자식 클래스(effect-sheet.js)에서 레벨 리스너 처리
        }

        /** @override */
        _canDragDrop(selector) {
            return true;
        }

        /** @override */
        async _onDrop(event) {
            // 드래그 데이터 가져오기
            let data;
            try {
                data = JSON.parse(event.dataTransfer.getData('text/plain'));
            } catch (err) {
                return;
            }

            // 매크로가 아니면 기본 동작으로 처리
            if (data.type !== 'Macro') {
                return super._onDrop?.(event);
            }

            // 이 아이템 타입이 macro 필드를 가지고 있는지 확인
            const macroSupportedTypes = ['effect', 'combo', 'spell', 'psionic', 'weapon', 'protect', 'vehicle', 'book', 'once', 'etc'];
            if (!macroSupportedTypes.includes(this.item.type)) {
                ui.notifications.warn(game.i18n.localize("DX3rd.MacroNotSupported") || "이 아이템 타입은 매크로를 지원하지 않습니다.");
                return;
            }

            // 매크로 가져오기
            const macro = await fromUuid(data.uuid);
            if (!macro) {
                return;
            }

            // 매크로 이름을 [매크로 이름] 형식으로 추가
            const macroText = `[${macro.name}]`;
            const currentMacro = this.item.system.macro || "";
            
            // 이미 추가된 매크로인지 확인
            if (currentMacro.includes(macroText)) {
                ui.notifications.info(game.i18n.localize("DX3rd.MacroAlreadyAdded") || "이미 추가된 매크로입니다.");
                return;
            }

            // 기존 매크로 리스트에 추가
            const newMacro = currentMacro ? `${currentMacro} ${macroText}` : macroText;
            
            await this.item.update({
                'system.macro': newMacro
            });

            ui.notifications.info(game.i18n.format("DX3rd.MacroAdded", { name: macro.name }) || `매크로 "${macro.name}"이(가) 추가되었습니다.`);
        }

        async _onCreateSkill(event) {
            event.preventDefault();
            const skillKey = $(event.currentTarget).closest('.add-skills').find('#actor-skill').val();
            if (!skillKey) return;

            const actorSkill = this.item.actor.system.attributes.skills[skillKey];
            if (!actorSkill) return;

            const skills = this.item.system.skills || {};
            if (skills[skillKey]) {
                ui.notifications.error(game.i18n.localize("DX3rd.ErrorSkillExists"));
                return;
            }

            const newSkill = {
                key: skillKey,
                name: actorSkill.name,
                base: actorSkill.base,
                dice: actorSkill.dice,
                add: actorSkill.add,
                bonus: 0,
                apply: false
            };

            await this.item.update({
                [`system.skills.${skillKey}`]: newSkill
            });
        }

        async _onDeleteSkill(event) {
            event.preventDefault();
            const skillKey = $(event.currentTarget).closest('.attribute').data('attribute');
            if (!skillKey) return;

            // skills 또는 attributes 중 어느 것을 삭제하는지 확인
            const targetType = this.item.system.skills?.[skillKey] ? 'skills' : 'attributes';
            const targetItem = this.item.system[targetType]?.[skillKey];
            
            if (!targetItem) {
                console.warn(`DX3rd | No ${targetType} found with key:`, skillKey);
                return;
            }

            // attributes는 다이얼로그 없이 바로 삭제, skills는 확인 다이얼로그 표시
            if (targetType === 'attributes') {
                await this.item.update({
                    [`system.${targetType}.-=${skillKey}`]: null
                });
            } else {
            const confirmed = await Dialog.confirm({
                title: game.i18n.localize("DX3rd.DeleteSkill"),
                    content: game.i18n.format("DX3rd.ConfirmDeleteSkill", { name: targetItem.name || skillKey })
            });

            if (confirmed) {
                await this.item.update({
                        [`system.${targetType}.-=${skillKey}`]: null
                });
                }
            }
        }

        async _onToggleSkill(event) {
            event.preventDefault();
            const skillKey = $(event.currentTarget).closest('.attribute').data('attribute');
            if (!skillKey) return;

            const apply = $(event.currentTarget).prop('checked');
            await this.item.update({
                [`system.skills.${skillKey}.apply`]: apply
            });
        }

        async _onLevelChange(event) {
            event.preventDefault();
            
            // 폼 데이터에서 현재 값들 가져오기
            const formData = new FormData(event.target.form);
            const init = Number(formData.get('system.level.init')) || 0;
            const max = Number(formData.get('system.level.max')) || 1;
            const upgrade = formData.get('system.level.upgrade') === 'on';
            
            // level.value 계산
            let value = init;
            if (this.item.actor && upgrade) {
                const encLevel = Number(this.item.actor.system?.attributes?.encroachment?.level) || 0;
                value += encLevel;
            }
            
            // level.value 업데이트
            try {
                await this.item.update({
                    'system.level.value': value
                });
            } catch (err) {
                console.error("DX3rd | _onLevelChange update failed", err);
            }
        }

        /**
         * Target Tab 통합 리스너 설정 (effect-sheet 패턴 기반)
         * Target Tab이 있는 아이템 타입: combo, effect, etc, once, protect, psionic, spell, vehicle, weapon
         */
        _setupTargetTabListeners(html) {
            // Target Tab 컨테이너 찾기
            const targetTab = html.find('div[data-tab="target"]');
            
            if (targetTab.length === 0) {
                return;
            }

            // getTarget 체크박스 변경 핸들러
            targetTab.on('change', 'input[name="system.getTarget"]', async (event) => {
                event.preventDefault();
                const getTarget = $(event.currentTarget).is(':checked');
                
                const updates = {
                    'system.getTarget': getTarget
                };
                
                // getTarget이 체크되면 scene 체크 해제
                if (getTarget) {
                    updates['system.scene'] = false;
                }
                
                try {
                    await this.item.update(updates);
                } catch (e) {
                    console.error('DX3rd | ItemSheet getTarget update failed', e);
                }
            });

            // scene 체크박스 변경 핸들러
            targetTab.on('change', 'input[name="system.scene"]', async (event) => {
                event.preventDefault();
                const scene = $(event.currentTarget).is(':checked');
                
                const updates = {
                    'system.scene': scene
                };
                
                // scene이 체크되면 getTarget 체크 해제
                if (scene) {
                    updates['system.getTarget'] = false;
                }
                
                try {
                    await this.item.update(updates);
                } catch (e) {
                    console.error('DX3rd | ItemSheet scene update failed', e);
                }
            });

            // input 필드 즉시 업데이트 (effect-sheet 패턴)
            targetTab.on('change', 'input[name^="system."]', async (event) => {
                if (this._isAddingAttribute) return;
                
                const name = event.currentTarget.name;
                
                // 전용 핸들러가 있는 필드는 제외
                const excludedFields = [
                    'system.getTarget',
                    'system.scene'
                ];
                if (excludedFields.includes(name)) return;
                
                const value = event.currentTarget.type === 'checkbox' ? event.currentTarget.checked : event.currentTarget.value;
                
                // 즉시 저장
                try {
                    const updates = foundry.utils.expandObject({
                        [name]: event.currentTarget.type === 'number' ? parseInt(value) || 0 : 
                                event.currentTarget.type === 'checkbox' ? value : 
                                value
                    });
                    await this.item.update(updates);
                } catch (error) {
                    console.error("DX3rd | ItemSheet Target Tab input update failed", error);
                }
            });
            
            // select 필드 즉시 업데이트 (attribute-key 제외)
            targetTab.on('change', 'select[name^="system."]:not([name$=".key"])', async (event) => {
                if (this._isAddingAttribute) return;
                
                const name = event.currentTarget.name;
                const value = event.currentTarget.value;
                
                // 즉시 저장
                try {
                    const updates = foundry.utils.expandObject({
                        [name]: value
                    });
                    await this.item.update(updates);
                } catch (error) {
                    console.error("DX3rd | ItemSheet Target Tab select update failed", error);
                }
            });
            
            // textarea 필드 즉시 업데이트
            targetTab.on('change', 'textarea[name^="system."]', async (event) => {
                if (this._isAddingAttribute) return;
                
                const name = event.currentTarget.name;
                const value = event.currentTarget.value;
                
                // 즉시 저장
                try {
                    const updates = foundry.utils.expandObject({
                        [name]: value
                    });
                    await this.item.update(updates);
                } catch (error) {
                    console.error("DX3rd | ItemSheet Target Tab textarea update failed", error);
                }
            });
        }

        /**
         * Active Tab 공통 핸들러들
         */
        _onActiveDisableChange(event) {
            const disable = event.currentTarget.value;
            if (disable === "notCheck") {
                this.item.update({
                    "system.active.state": false
                });
            }
        }

        _onUsedDisableChange(event) {
            const disable = event.currentTarget.value;
            
            // 먼저 disable 값을 저장
            this.item.update({
                "system.used.disable": disable
            });
            
            // notCheck인 경우 추가 처리
            if (disable === "notCheck") {
                this.item.update({
                    "system.used.state": 0,
                    "system.used.max": 0
                });
            }
        }

        /** @override */
        _getSubmitData(updateData) {
            let formData = super._getSubmitData(updateData);
            return formData;
        }

        /** @override */
        async _updateObject(event, formData) {
            // 평탄화된 데이터를 그대로 문서에 반영
            try {
                const result = await this.item.update(formData);
                return result;
            } catch (err) {
                console.error("DX3rd | _updateObject(error)", err);
                throw err;
            }
        }

    }

    // 아이템 시트는 이제 개별 시트들로 분리되어 각자 등록함
    // DX3rdItemSheet는 기본 클래스 역할만 함
    // 전역 노출 (non-ESM 환경에서 다른 스크립트가 접근 가능하도록)
    window.DX3rdItemSheet = DX3rdItemSheet;
})(); 