/**
 * Double Cross 3rd Actor Sheet
 */
(function () {
    // v13 호환: foundry.appv1 네임스페이스 사용
    const ActorSheetClass = foundry.appv1?.sheets?.ActorSheet || ActorSheet;

    class DX3rdActorSheet extends ActorSheetClass {
        /** @override */
        static get defaultOptions() {
            const parentOptions = super.defaultOptions || {};
            return foundry.utils.mergeObject(parentOptions, {
                classes: ['dx3rd-emanim', 'sheet', 'actor'],
                template: 'systems/dx3rd-emanim/templates/actor/actor-sheet.html',
                width: 800,
                height: 600,
                tabs: [{ navSelector: '.sheet-tabs', contentSelector: '.sheet-body', initial: 'description' }]
            });
        }

        /**
         * OWNER 권한이 있는지 확인하는 헬퍼 메서드
         * @returns {boolean} OWNER 권한이 있으면 true
         */
        _hasOwnerPermission() {
            return window.DX3rdActorSheetData.hasOwnerPermission(this.actor);
        }

        /**
         * simple 시트를 사용해야 하는지 확인하는 헬퍼 메서드
         * @returns {boolean} simple 시트를 사용해야 하면 true
         */
        _shouldUseSimpleSheet() {
            return window.DX3rdActorSheetData.shouldUseSimpleSheet(this.actor);
        }

        /** @override */
        get template() {
            return window.DX3rdActorSheetData.getTemplate(this.actor);
        }

        /** @override */
        _getHeaderButtons() {
            // simple 시트인 경우 닫기 버튼만 표시
            if (this._shouldUseSimpleSheet()) {
                // 닫기 버튼만 반환
                return [{
                    label: game.i18n.localize("Close"),
                    class: "close",
                    icon: "fas fa-times",
                    onclick: () => this.close()
                }];
            }

            let buttons = super._getHeaderButtons();

            // ActorType 버튼 추가 (GM에게만 표시)
            if (game.user.isGM) {
                buttons.unshift({
                    label: game.i18n.localize("DX3rd.ActorType"),
                    class: "actor-type",
                    icon: "fa-solid fa-user-tag",
                    onclick: (ev) => this._onActorTypeClick(ev)
                });
            }

            return buttons;
        }

        /** @inheritdoc */
        async getData(options) {
            let data = await super.getData(options);
            return window.DX3rdActorSheetData.prepareSheetData(this.actor, data, {
                simple: this._shouldUseSimpleSheet()
            });
        }

        /** @override */
        _getSkillDisplay(skillKey) {
            return window.DX3rdActorSheetData.getSkillDisplay(this.actor, skillKey);
        }

        activateListeners(html) {
            super.activateListeners(html);

            html.find('.backtrack-roll').click(this._onBacktrackRoll.bind(this));
            // .skill-roll/.ability-roll 클릭은 아래 _onSkillNameClick/_onAbilityNameClick에서 처리됨

            // 전역 토글 리스너는 main.js에서 등록됨

            // 스킬 관리 리스너
            html.find('.skill-create').click(this._onCreateSkill.bind(this));
            html.find('.skill-edit').click(this._onEditSkill.bind(this));
            html.find('.skill-delete').click(this._onDeleteSkill.bind(this));

            html.find('.diamond').click(this._onAbilityDiamondClick.bind(this));
            
            // 에너미 HP max 클릭 리스너
            html.find('.hp-max-clickable').click(this._onEnemyHPMaxClick.bind(this));
            
            // 에너미 행동치 클릭 리스너
            html.find('.init-clickable').click(this._onEnemyInitClick.bind(this));
            
            // 에너미 이동(전투) 클릭 리스너
            html.find('.move-battle-clickable').click(this._onEnemyMoveClick.bind(this));
            
            // 에너미 회피치 클릭 리스너
            html.find('.evasion-clickable').click(this._onEnemyEvasionClick.bind(this));
            
            // 에너미 장갑치 클릭 리스너
            html.find('.armor-clickable').click(this._onEnemyArmorClick.bind(this));

            // 아이템 에딧/삭제 리스너
            html.find('.item-edit').click(this._onItemEdit.bind(this));
            html.find('.item-delete').click(this._onItemDelete.bind(this));
            html.find('.item-create').click(this._onItemCreate.bind(this));

            // echo-item 클릭 시 채팅 출력 리스너
            html.find('.echo-item').click(this._onItemNameClick.bind(this));
            
            // item-label 클릭 시 설명 토글 리스너
            html.find('.item-label').click(this._onItemLabelClick.bind(this));

            // 사용횟수 수정 리스너 (disabled되지 않는 첫 번째 입력필드만)
            html.find('.used-input:not([disabled])').on('change', this._onUsedStateChange.bind(this));

            // 활성화 체크박스 리스너
            html.find('.active-check').on('change', this._onActiveChange.bind(this));

            // 장비 체크박스 리스너
            html.find('.active-equipment').on('change', this._onEquipmentChange.bind(this));

            // Applied 효과 제거 리스너
            html.find('.remove-applied').click(this._onRemoveApplied.bind(this));

            // Applied 효과 보기 리스너
            html.find('.show-applied').click(this._onShowApplied.bind(this));

            // 신드롬 체크박스 토글 - mousedown과 click 둘 다 처리하여 완전한 차단
            html.on('mousedown', 'input.item-checkbox[name^="system.attributes.syndrome."]', this._onToggleSyndrome.bind(this));
            html.on('click', 'input.item-checkbox[name^="system.attributes.syndrome."]', this._onSyndromeClick.bind(this));

            // 드래그 앤 드롭 이벤트 처리
            html.on('dragstart', '.item', this._onDragStart.bind(this));
            html.on('dragover', this._onDragOver.bind(this));
            html.on('drop', this._onDrop.bind(this));

            // 능력치 이름 클릭 시 dice 정보 출력
            html.find('.ability-roll').click(this._onAbilityNameClick.bind(this));

            // 스킬 이름 클릭 시 dice 정보 출력
            html.find('.skill-roll').click(this._onSkillNameClick.bind(this));

            // 능력치/스킬 호버 시 dice-info 업데이트
            html.find('.ability-roll').hover(
                this._onAbilityHover.bind(this),
                this._onAbilityHoverOut.bind(this)
            );

            html.find('.skill-roll').hover(
                this._onSkillHover.bind(this),
                this._onSkillHoverOut.bind(this)
            );

            // 로이스 Titus 버튼 클릭
            html.find('.btn-titus').click(this._onTitusClick.bind(this));

            // 로이스 Sublimation 버튼 클릭
            html.find('.btn-sublimation').click(this._onSublimationClick.bind(this));

            // 재산점 클릭
            html.find('.stock-title').click(this._onStockClick.bind(this));
        }

        async _onCreateSkill(event) {
            event.preventDefault();
            
            // OWNER 권한 체크
            if (!this._hasOwnerPermission()) {
                ui.notifications.warn(game.i18n.localize("DX3rd.NoPermission"));
                return;
            }
            
            // 클릭 버블링으로 능력치 이름(.ability-roll) 클릭 핸들러가 함께 실행되지 않도록 차단
            event.stopPropagation();
            const abilityId = $(event.currentTarget).data('ability-id');
            if (!abilityId) return;

            const baseAbility = this.actor.system.attributes[abilityId];
            const dice = baseAbility ? baseAbility.dice || 0 : 0;

            // Works 보너스 계산 (임시로 0으로 설정, 실제 계산은 다이얼로그에서)
            const worksBonus = 0;

            // 아이템 보너스 계산 (임시로 0으로 설정, 실제 계산은 다이얼로그에서)
            const itemBonus = 0;

            // Applied 보너스 계산 (임시로 0으로 설정, 실제 계산은 다이얼로그에서)
            const appliedBonus = 0;

            const title = game.i18n.localize("DX3rd.CreateSkill");
            new DX3rdSkillCreateDialog({
                title,
                skill: {
                    key: "",
                    name: "",
                    point: 0,
                    bonus: itemBonus + appliedBonus,
                    extra: 0,
                    works: worksBonus,
                    base: abilityId,
                    dice: dice,
                    total: worksBonus + itemBonus + appliedBonus
                },
                actorId: this.actor.id,
                buttons: {
                    create: {
                        label: game.i18n.localize("DX3rd.Create"),
                        callback: () => { }  // 실제 콜백은 다이얼로그 클래스에서 처리
                    },
                    cancel: {
                        label: game.i18n.localize("DX3rd.Cancel")
                    }
                },
                default: "create"
            }).render(true);
        }

        async _onEditSkill(event) {
            event.preventDefault();
            
            // OWNER 권한 체크
            if (!this._hasOwnerPermission()) {
                ui.notifications.warn(game.i18n.localize("DX3rd.NoPermission"));
                return;
            }
            
            const skillId = $(event.currentTarget).closest('.skill').data('skill-id');
            if (!skillId) return;

            const skill = this.actor.system.attributes.skills[skillId];
            if (!skill) return;

            // 현재 스킬의 모든 데이터를 가져옴
            const baseAbility = this.actor.system.attributes[skill.base];
            const dice = baseAbility ? baseAbility.dice || 0 : 0;

            const title = game.i18n.localize("DX3rd.EditSkill");
            new DX3rdSkillEditDialog({
                title,
                width: 900,
                skill: {
                    key: skillId,
                    name: skill.name || "",
                    point: skill.point || 0,
                    bonus: skill.bonus || 0,
                    extra: skill.extra || 0,
                    works: skill.works || 0,
                    base: skill.base,
                    dice: dice,
                    total: skill.total || 0,
                    delete: skill.delete
                },
                actorId: this.actor.id,
                buttons: {
                    cancel: {
                        label: game.i18n.localize("DX3rd.Close"),
                        callback: () => dialog.close()
                    }
                },
                default: "cancel"
            }).render(true);
        }

        async _onDeleteSkill(event) {
            event.preventDefault();
            
            // OWNER 권한 체크
            if (!this._hasOwnerPermission()) {
                ui.notifications.warn(game.i18n.localize("DX3rd.NoPermission"));
                return;
            }
            
            const skillId = $(event.currentTarget).closest('.skill').data('skill-id');
            if (!skillId) return;

            const skill = this.actor.system.attributes.skills[skillId];
            if (!skill) return;

            // 기본 스킬은 삭제 불가
            if (!skill.delete) {
                ui.notifications.error(game.i18n.localize("DX3rd.ErrorCannotDeleteDefaultSkill"));
                return;
            }

            // 삭제 확인
            const confirmed = await Dialog.confirm({
                title: game.i18n.localize("DX3rd.DeleteSkill"),
                content: game.i18n.format("DX3rd.ConfirmDeleteSkill", { name: skill.name })
            });

            if (confirmed) {
                // cthulhu 스킬 삭제 시 플래그 설정
                if (skillId === 'cthulhu') {
                    await this.actor.setFlag('dx3rd-emanim', 'cthulhuDeleted', true);
                }

                await this.actor.update({
                    [`system.attributes.skills.-=${skillId}`]: null
                });
            }
        }

        async _onAbilityDiamondClick(event) {
            event.preventDefault();
            // 캐릭터 시트는 .diamond에 data-ability, 에너미 시트는 부모에 data-ability-id
            const el = event.currentTarget;
            const ability = el.dataset.ability || el.closest("[data-ability-id]")?.dataset.abilityId;
            return window.DX3rdActorEditDialogs.openAbility(this.actor, ability);
        }

        async _onEnemyHPMaxClick(event) {
            event.preventDefault();
            return window.DX3rdEnemyStatDialogs.open(this.actor, "hp");
        }

        async _onEnemyInitClick(event) {
            event.preventDefault();
            return window.DX3rdEnemyStatDialogs.open(this.actor, "init");
        }

        async _onEnemyMoveClick(event) {
            event.preventDefault();
            return window.DX3rdEnemyStatDialogs.open(this.actor, "move");
        }

        async _onEnemyEvasionClick(event) {
            event.preventDefault();
            return window.DX3rdEnemyStatDialogs.open(this.actor, "evasion");
        }

        async _onEnemyArmorClick(event) {
            event.preventDefault();
            return window.DX3rdEnemyStatDialogs.open(this.actor, "armor");
        }

        async _onItemEdit(event) {
            event.preventDefault();
            
            // OWNER 권한 체크
            if (!this._hasOwnerPermission()) {
                ui.notifications.warn(game.i18n.localize("DX3rd.NoPermission"));
                return;
            }
            
            const li = $(event.currentTarget).closest('.item');
            const itemId = li.data('item-id');
            if (!itemId) return;
            const item = this.actor.items.get(itemId);
            if (item) item.sheet.render(true);
        }

        async _onItemDelete(event) {
            event.preventDefault();
            
            // OWNER 권한 체크
            if (!this._hasOwnerPermission()) {
                ui.notifications.warn(game.i18n.localize("DX3rd.NoPermission"));
                return;
            }
            
            const li = $(event.currentTarget).closest('.item');
            const itemId = li.data('item-id');
            if (!itemId) return;
            const item = this.actor.items.get(itemId);
            if (!item) return;
            const confirmed = await Dialog.confirm({
                title: game.i18n.localize("DX3rd.DeleteItem"),
                content: game.i18n.format("DX3rd.ConfirmDeleteItem", { name: item.name })
            });
            if (confirmed) {
                await this.actor.deleteEmbeddedDocuments("Item", [itemId]);
            }
        }

        async _onItemNameClick(event) {
            event.preventDefault();
            event.stopPropagation();
            const li = $(event.currentTarget).closest('.item');
            const itemId = li.data('item-id');
            if (!itemId) return;

            // 권한 체크
            if (!this.actor.isOwner && !game.user.isGM) {
                ui.notifications.warn('이 액터에 대한 권한이 없습니다.');
                return;
            }

            const item = this.actor.items.get(itemId);
            if (!item) return;

            // 아이템 소진 여부 체크 (통합 함수 사용)
            if (window.DX3rdItemExhausted?.isItemExhausted(item)) {
                ui.notifications.warn(`${item.name}의 사용 횟수가 모두 소진되었습니다.`);
                return;
            }

            // 아이템 정보를 채팅으로 출력
            await this._sendItemToChat(item);
        }

        async _onItemLabelClick(event) {
            event.preventDefault();
            event.stopPropagation();
            
            // echo-item 클릭이면 채팅 출력으로 처리하지 않음
            if ($(event.target).closest('.echo-item').length > 0) {
                return;
            }
            
            const li = $(event.currentTarget).closest('.item');
            const itemId = li.data('item-id');
            if (!itemId) return;
            
            const itemDescription = li.find('.item-description');
            const toggleIcon = li.find('.item-details-toggle i');
            
            if (!itemDescription.length) return;
            
            // 토글 애니메이션
            if (itemDescription.is(':visible')) {
                itemDescription.slideUp(250, () => {
                    toggleIcon.removeClass('fa-chevron-up').addClass('fa-chevron-down');
                });
            } else {
                itemDescription.slideDown(250, () => {
                    toggleIcon.removeClass('fa-chevron-down').addClass('fa-chevron-up');
                });
            }
        }

        async _sendItemToChat(item) {
            try {
                // 액터 데이터 최신화 (침식률 변경 등 반영)
                await this.actor.prepareData();

                // 최신화된 아이템 데이터 가져오기
                const currentItem = this.actor.items.get(item.id);
                if (!currentItem) {
                    console.error('DX3rd | Item not found in actor:', item.id);
                    return;
                }

                // 아이템 타입별 정보 수집 (최신 데이터 사용)
                const itemData = {
                    id: currentItem.id,
                    name: currentItem.name,
                    type: currentItem.type,
                    description: currentItem.system.description || "",
                    img: currentItem.img
                };

                // 아이템 타입별 추가 정보 수집 (최신 데이터 사용)
                switch (currentItem.type) {
                    case 'effect':
                        // 침식률에 따른 레벨 계산
                        const baseLevel = Number(currentItem.system.level?.init || 0);
                        const upgrade = currentItem.system.level?.upgrade || false;
                        let calculatedLevel = baseLevel;

                        if (upgrade && this.actor.system?.attributes?.encroachment?.level) {
                            const encLevel = Number(this.actor.system.attributes.encroachment.level) || 0;
                            calculatedLevel += encLevel;
                        }

                        itemData.level = calculatedLevel;
                        itemData.maxLevel = Number(currentItem.system.level?.max) || itemData.level || 0;
                        itemData.timing = currentItem.system.timing || '-';
                        itemData.skill = currentItem.system.skill || '-';
                        itemData.target = currentItem.system.target || '-';
                        itemData.range = currentItem.system.range || '-';
                        itemData.encroach = currentItem.system.encroach?.value || 0;
                        itemData.limit = currentItem.system.limit || '-';
                        itemData.used = currentItem.system.used || { disable: 'notCheck', state: 0, max: 0 };
                        break;
                    case 'spell':
                        itemData.spellType = currentItem.system.spelltype || '-';
                        itemData.invoke = currentItem.system.invoke?.value || '-';
                        itemData.evocation = currentItem.system.evocation?.value || '-';
                        itemData.encroach = currentItem.system.encroach?.value || 0;
                        itemData.attributes = currentItem.system.effect?.attributes || {};
                        itemData.used = currentItem.system.used || { disable: 'notCheck', state: 0, max: 0 };
                        break;
                    case 'psionic':
                        // 사이오닉은 침식률 보정 없이 init만 사용
                        const psionicBaseLevel = Number(currentItem.system.level?.init || 0);
                        itemData.level = psionicBaseLevel;
                        itemData.maxLevel = Number(currentItem.system.level?.max) || itemData.level || 0;
                        itemData.timing = currentItem.system.timing || '-';
                        itemData.skill = currentItem.system.skill || '-';
                        itemData.target = currentItem.system.target || '-';
                        itemData.range = currentItem.system.range || '-';
                        itemData.hp = currentItem.system.hp?.value || 0;
                        itemData.limit = currentItem.system.limit || '-';
                        itemData.used = currentItem.system.used || { disable: 'notCheck', state: 0, max: 0 };
                        break;
                    case 'weapon':
                        itemData.weaponType = currentItem.system.type || '-';
                        itemData.skill = currentItem.system.skill || '-';
                        itemData.range = currentItem.system.range || '-';
                        itemData.add = window.DX3rdFormulaEvaluator.evaluate(currentItem.system.add, currentItem, this.actor);
                        itemData.attack = window.DX3rdFormulaEvaluator.evaluate(currentItem.system.attack, currentItem, this.actor);
                        itemData.guard = window.DX3rdFormulaEvaluator.evaluate(currentItem.system.guard, currentItem, this.actor);
                        itemData.used = currentItem.system.used || { disable: 'notCheck', state: 0, max: 0 };
                        itemData['attack-used'] = currentItem.system['attack-used'] || { disable: 'notCheck', state: 0, max: 0 };
                        break;
                    case 'protect':
                        itemData.dodge = window.DX3rdFormulaEvaluator.evaluate(currentItem.system.dodge, currentItem, this.actor);
                        itemData.init = window.DX3rdFormulaEvaluator.evaluate(currentItem.system.init, currentItem, this.actor);
                        itemData.armor = window.DX3rdFormulaEvaluator.evaluate(currentItem.system.armor, currentItem, this.actor);
                        itemData.used = currentItem.system.used || { disable: 'notCheck', state: 0, max: 0 };
                        break;
                    case 'vehicle':
                        itemData.vehicleType = currentItem.system.type || '-';
                        itemData.skill = currentItem.system.skill || '-';
                        itemData.attack = window.DX3rdFormulaEvaluator.evaluate(currentItem.system.attack, currentItem, this.actor);
                        itemData.init = window.DX3rdFormulaEvaluator.evaluate(currentItem.system.init, currentItem, this.actor);
                        itemData.armor = window.DX3rdFormulaEvaluator.evaluate(currentItem.system.armor, currentItem, this.actor);
                        itemData.move = window.DX3rdFormulaEvaluator.evaluate(currentItem.system.move, currentItem, this.actor);
                        itemData.used = currentItem.system.used || { disable: 'notCheck', state: 0, max: 0 };
                        break;
                    case 'connection':
                        itemData.skill = currentItem.system.skill || '-';
                        itemData.add = currentItem.system.add || 0;
                        itemData.used = currentItem.system.used || { disable: 'notCheck', state: 0, max: 0 };
                        break;
                    case 'etc':
                        itemData.etcType = currentItem.system.type || '-';
                        itemData.add = currentItem.system.add || 0;
                        itemData.used = currentItem.system.used || { disable: 'notCheck', state: 0, max: 0 };
                        break;
                    case 'once':
                        itemData.quantity = currentItem.system.quantity || 1;
                        itemData.add = currentItem.system.add || 0;
                        itemData.used = currentItem.system.used || { disable: 'notCheck', state: 0, max: 0 };
                        break;
                    case 'combo':
                        itemData.skill = currentItem.system.skill || '-';
                        itemData.base = currentItem.system.base || '-';
                        itemData.roll = currentItem.system.roll || '-';
                        itemData.difficulty = currentItem.system.difficulty || '';
                        itemData.timing = currentItem.system.timing || '-';
                        itemData.range = currentItem.system.range || '';
                        itemData.target = currentItem.system.target || '';
                        itemData.limit = currentItem.system.limit || '-';
                        itemData.used = currentItem.system.used || { disable: 'notCheck', state: 0, max: 0 };
                        itemData.attackRoll = currentItem.system.attackRoll || '-';
                        
                        // 콤보 시트의 getData()에서 계산된 값들 가져오기
                        if (currentItem.sheet) {
                            try {
                                const sheetData = await currentItem.sheet.getData();
                                itemData.dice = sheetData.system?.dice?.value || 0;
                                itemData.critical = sheetData.system?.critical?.value || 10;
                                itemData.add = sheetData.system?.add?.value || 0;
                                itemData.attack = sheetData.system?.attack?.value || 0;
                                itemData.encroach = sheetData.system?.encroach?.value || 0;
                                itemData.attackLabel = sheetData.attackLabel || game.i18n.localize('DX3rd.Attack');
                            } catch (e) {
                                itemData.dice = 0;
                                itemData.critical = 10;
                                itemData.add = 0;
                                itemData.attack = 0;
                                itemData.encroach = 0;
                                itemData.attackLabel = game.i18n.localize('DX3rd.Attack');
                            }
                        } else {
                            itemData.dice = 0;
                            itemData.critical = 10;
                            itemData.add = 0;
                            itemData.attack = 0;
                            itemData.encroach = 0;
                            // attackRoll에 따라 라벨 설정
                            if (itemData.attackRoll === 'melee') {
                                itemData.attackLabel = game.i18n.localize('DX3rd.MeleeAttack');
                            } else if (itemData.attackRoll === 'ranged') {
                                itemData.attackLabel = game.i18n.localize('DX3rd.RangedAttack');
                            } else {
                                itemData.attackLabel = game.i18n.localize('DX3rd.Attack');
                            }
                        }

                        // 콤보에 포함된 이펙트와 무기 정보 수집
                        itemData.effects = [];
                        itemData.weapons = [];


                        // 콤보 아이템은 system.effect와 system.weapon을 사용 (복수형이 아님)
                        if (currentItem.system.effect && Array.isArray(currentItem.system.effect)) {
                            for (const effectId of currentItem.system.effect) {
                                if (effectId && effectId !== '-') {
                                    const effect = this.actor.items.get(effectId);
                                    if (effect && effect.type === 'effect') {
                                        itemData.effects.push({
                                            id: effect.id,
                                            name: effect.name,
                                            level: effect.system.level?.value || 0,
                                            timing: effect.system.timing || '-',
                                            skill: effect.system.skill || '-',
                                            target: effect.system.target || '-',
                                            range: effect.system.range || '-',
                                            encroach: effect.system.encroach?.value || 0,
                                            limit: effect.system.limit || '-'
                                        });
                                    }
                                }
                            }
                        }

                        if (currentItem.system.weapon && Array.isArray(currentItem.system.weapon)) {
                            for (const weaponId of currentItem.system.weapon) {
                                if (weaponId && weaponId !== '-') {
                                    const weaponOrVehicle = this.actor.items.get(weaponId);
                                    if (weaponOrVehicle && (weaponOrVehicle.type === 'weapon' || weaponOrVehicle.type === 'vehicle')) {
                                        // 비클인 경우 특별 처리
                                        if (weaponOrVehicle.type === 'vehicle') {
                                            itemData.weapons.push({
                                                id: weaponOrVehicle.id,
                                                name: weaponOrVehicle.name,
                                                type: game.i18n.localize('DX3rd.Melee'), // 종별: 백병
                                                skill: weaponOrVehicle.system.skill || '-',
                                                range: game.i18n.localize('DX3rd.Engage'), // 사정거리: 교전
                                                add: 0, // 수정치: 0
                                                attack: weaponOrVehicle.system.attack || 0,
                                                guard: 0
                                            });
                                        } else {
                                            // 일반 무기
                                            itemData.weapons.push({
                                                id: weaponOrVehicle.id,
                                                name: weaponOrVehicle.name,
                                                type: weaponOrVehicle.system.type || '-',
                                                skill: weaponOrVehicle.system.skill || '-',
                                                range: weaponOrVehicle.system.range || '-',
                                                add: weaponOrVehicle.system.add || 0,
                                                attack: weaponOrVehicle.system.attack || 0,
                                                guard: weaponOrVehicle.system.guard || 0
                                            });
                                        }
                                    }
                                }
                            }
                        }
                        break;
                    case 'book':
                        itemData.decipher = currentItem.system.decipher || 0;
                        itemData.exp = currentItem.system.exp || 0;

                        // 마도서에 포함된 술식 정보 수집
                        itemData.spells = [];

                        if (currentItem.system.spells && Array.isArray(currentItem.system.spells)) {
                            for (const spellId of currentItem.system.spells) {
                                if (spellId && spellId !== '-') {
                                    // 공용 아이템에서 조회
                                    const spell = game.items.get(spellId);

                                    if (spell && spell.type === 'spell') {
                                        // 액터가 같은 이름의 술식을 가지고 있는지 확인
                                        const actorSpell = this.actor.items.find(item =>
                                            item.type === 'spell' && item.name === spell.name
                                        );
                                        const isOwned = !!actorSpell;

                                        itemData.spells.push({
                                            id: spell.id,
                                            name: spell.name,
                                            spellType: spell.system.spelltype || '-',
                                            invoke: spell.system.invoke?.value || '-',
                                            evocation: spell.system.evocation?.value || '-',
                                            encroach: spell.system.encroach?.value || 0,
                                            isOwned: isOwned
                                        });
                                    }
                                }
                            }
                        }
                        break;
                    case 'record':
                        itemData.exp = currentItem.system.exp || 0;
                        break;
                    case 'rois':
                        itemData.roisType = currentItem.system.type || '-';
                        itemData.positive = currentItem.system.positive || {};
                        itemData.negative = currentItem.system.negative || {};
                        itemData.titus = currentItem.system.titus || false;
                        itemData.sublimation = currentItem.system.sublimation || false;
                        break;
                }

                // 채팅 메시지 생성
                const chatData = {
                    style: CONST.CHAT_MESSAGE_STYLES.OTHER,
                    content: await this._createItemChatContent(itemData),
                    speaker: {
                        actor: this.actor.id,
                        alias: this.actor.name
                    }
                };

                // 채팅 메시지 전송
                const message = await ChatMessage.create(chatData);

                // 호출 시 타이밍의 매크로 실행
                if (window.DX3rdUniversalHandler && window.DX3rdUniversalHandler.executeMacros) {
                    await window.DX3rdUniversalHandler.executeMacros(currentItem, 'onInvoke');
                }

                // 콤보 아이템의 경우 포함된 이펙트의 onInvoke 매크로도 실행
                if (currentItem.type === 'combo') {
                    const rawEffects = (currentItem.system?.effectIds ?? currentItem.system?.effect?.data ?? currentItem.system?.effect) ?? [];
                    let effectIds = [];
                    if (Array.isArray(rawEffects)) {
                        effectIds = rawEffects.filter(e => e && e !== '-');
                    } else if (rawEffects && typeof rawEffects === 'object') {
                        effectIds = Object.values(rawEffects)
                            .map(v => (typeof v === 'string' ? v : (v?.id || null)))
                            .filter(e => e && e !== '-');
                    } else if (typeof rawEffects === 'string') {
                        if (rawEffects && rawEffects !== '-') effectIds = [rawEffects];
                    }
                    
                    for (const effectId of effectIds) {
                        if (!effectId || effectId === '-') continue;
                        const effectItem = this.actor.items.get(effectId);
                        if (!effectItem) {
                            console.warn('DX3rd | Combo chat - Effect item not found:', effectId);
                            continue;
                        }
                        
                        if (window.DX3rdUniversalHandler && window.DX3rdUniversalHandler.executeMacros) {
                            await window.DX3rdUniversalHandler.executeMacros(effectItem, 'onInvoke');
                        }
                    }
                }

                // 범위 하이라이트 설정 (combo, effect, psionic, weapon, vehicle)
                if (currentItem.type === 'combo' || currentItem.type === 'effect' ||
                    currentItem.type === 'psionic' || currentItem.type === 'weapon' ||
                    currentItem.type === 'vehicle') {

                    // 무기의 경우 공격 횟수 체크
                    let shouldShowHighlight = true;
                    if (currentItem.type === 'weapon') {
                        const attackUsedDisable = currentItem.system['attack-used']?.disable || 'notCheck';
                        if (attackUsedDisable !== 'notCheck') {
                            const attackUsedState = currentItem.system['attack-used']?.state || 0;
                            const attackUsedMax = currentItem.system['attack-used']?.max || 0;
                            const isAttackExhausted = attackUsedMax <= 0 || attackUsedState >= attackUsedMax;

                            if (isAttackExhausted) {
                                shouldShowHighlight = false;
                            }
                        }
                    }

                    if (shouldShowHighlight) {
                        if (window.DX3rdUniversalHandler && window.DX3rdUniversalHandler.setRangeHighlightForItem) {
                            await window.DX3rdUniversalHandler.setRangeHighlightForItem(this.actor, currentItem);
                        } else {
                            console.warn('DX3rd | UniversalHandler not loaded yet, skipping range highlight');
                        }
                    }
                }

                // 새로 생성된 메시지에 토글 기능 초기화
                setTimeout(() => {
                    const newMessage = $(`#chat-log .message[data-message-id="${message.id}"]`);
                    if (newMessage.length > 0) {
                        const collapsibleElements = newMessage.find('.collapsible-content');
                        collapsibleElements.each((i, element) => {
                            const $el = $(element);
                            $el.removeAttr('style').addClass('collapsed');
                        });
                    }
                }, 500);

                // 토글 기능을 위한 이벤트 리스너 추가
                setTimeout(() => {
                    this._addChatToggleListeners(message.id);
                }, 500);

                // 기존 채팅 메시지 초기화는 main.js에서 처리됨

            } catch (error) {
                console.error('DX3rd | Error sending item to chat:', error);
                ui.notifications.error('아이템 정보를 채팅으로 전송하는 중 오류가 발생했습니다.');
            }
        }

        // 아이템 이름에서 || 패턴을 루비 문자로 변환하는 헬퍼 함수
        _formatItemNameWithRuby(itemName) {
            if (!itemName || typeof itemName !== 'string') {
                return itemName;
            }

            // || 패턴이 있는지 확인
            const rubyPattern = /^(.+)\|\|(.+)$/;
            const match = itemName.match(rubyPattern);

            if (match) {
                const [, mainName, rubyText] = match;
                return `<ruby class="dx3rd-ruby"><rb>${mainName}</rb><rt>${rubyText}</rt></ruby>`;
            }

            return itemName;
        }

        async _createItemChatContent(itemData) {
            let content = `<div class="dx3rd-item-chat">`;
            content += `<div class="item-header">`;
            content += `<img src="${itemData.img}" width="32" height="32" style="vertical-align: middle; margin-right: 8px;">`;

            // 아이템 이름에서 || 패턴 처리
            const formattedItemName = this._formatItemNameWithRuby(itemData.name);

            const itemNameStyle = `cursor: pointer;`;

            // 로이스 타입 표시
            if (itemData.type === 'rois') {
                let roisTypeDisplay = '';
                if (itemData.roisType && itemData.roisType !== '-') {
                    switch (itemData.roisType) {
                        case 'D':
                            roisTypeDisplay = game.i18n.localize('DX3rd.Descripted');
                            break;
                        case 'S':
                            roisTypeDisplay = game.i18n.localize('DX3rd.Superier');
                            break;
                        case 'M':
                            roisTypeDisplay = game.i18n.localize('DX3rd.Memory');
                            break;
                        case 'E':
                            roisTypeDisplay = game.i18n.localize('DX3rd.Exhaust');
                            break;
                        default:
                            roisTypeDisplay = itemData.roisType;
                    }
                    content += `<strong class="item-name-toggle" style="${itemNameStyle}">[${roisTypeDisplay}]${formattedItemName}</strong>`;
                } else {
                    // 타입이 "-"이거나 없으면 "로이스"로 표시
                    const roisLabel = game.i18n.localize('DX3rd.Rois');
                    content += `<strong class="item-name-toggle" style="${itemNameStyle}">[${roisLabel}]${formattedItemName}</strong>`;
                }
            } else {
                content += `<strong class="item-name-toggle" style="${itemNameStyle}">${formattedItemName}</strong>`;
            }
            content += `</div>`;

            // 아이템 타입별 상세 정보
            switch (itemData.type) {
                case 'effect':
                    content += `<div class="item-details effect-details collapsible-content collapsed">`;
                    content += `<div class="detail-row">`;
                    content += `<span class="detail-key">레벨:</span> <span class="detail-value">${itemData.level}</span>`;
                    content += `</div>`;
                    content += `<div class="detail-row">`;
                    const effectTimingDisplay = itemData.timing === '-' ? '-' : game.i18n.localize(`DX3rd.${itemData.timing.charAt(0).toUpperCase() + itemData.timing.slice(1)}`);
                    content += `<span class="detail-key">타이밍:</span> <span class="detail-value">${effectTimingDisplay}</span>`;
                    content += `</div>`;
                    content += `<div class="detail-row">`;
                    const effectSkillDisplay = this._getSkillDisplay(itemData.skill);
                    content += `<span class="detail-key">기능:</span> <span class="detail-value">${effectSkillDisplay}</span>`;
                    content += `</div>`;
                    content += `<div class="detail-row">`;
                    content += `<span class="detail-key">난이도:</span> <span class="detail-value">자동성공</span>`;
                    content += `</div>`;
                    content += `<div class="detail-row two-columns">`;
                    content += `<div class="detail-cell"><span class="detail-key">대상:</span> <span class="detail-value">${itemData.target}</span></div>`;
                    content += `<div class="detail-cell"><span class="detail-key">사정거리:</span> <span class="detail-value">${itemData.range}</span></div>`;
                    content += `</div>`;
                    content += `<div class="detail-row two-columns">`;
                    content += `<div class="detail-cell"><span class="detail-key">침식치:</span> <span class="detail-value">${itemData.encroach}</span></div>`;
                    content += `<div class="detail-cell"><span class="detail-key">제한:</span> <span class="detail-value">${itemData.limit}</span></div>`;
                    content += `</div>`;
                    content += `</div>`;
                    break;
                case 'psionic':
                    content += `<div class="item-details effect-details collapsible-content collapsed">`;
                    content += `<div class="detail-row">`;
                    content += `<span class="detail-key">레벨:</span> <span class="detail-value">${itemData.level}</span>`;
                    content += `</div>`;
                    content += `<div class="detail-row">`;
                    const psionicTimingDisplay = itemData.timing === '-' ? '-' : game.i18n.localize(`DX3rd.${itemData.timing.charAt(0).toUpperCase() + itemData.timing.slice(1)}`);
                    content += `<span class="detail-key">타이밍:</span> <span class="detail-value">${psionicTimingDisplay}</span>`;
                    content += `</div>`;
                    content += `<div class="detail-row">`;
                    const psionicSkillDisplay = this._getSkillDisplay(itemData.skill);
                    content += `<span class="detail-key">기능:</span> <span class="detail-value">${psionicSkillDisplay}</span>`;
                    content += `</div>`;
                    content += `<div class="detail-row">`;
                    content += `<span class="detail-key">난이도:</span> <span class="detail-value">자동성공</span>`;
                    content += `</div>`;
                    content += `<div class="detail-row two-columns">`;
                    content += `<div class="detail-cell"><span class="detail-key">대상:</span> <span class="detail-value">${itemData.target}</span></div>`;
                    content += `<div class="detail-cell"><span class="detail-key">사정거리:</span> <span class="detail-value">${itemData.range}</span></div>`;
                    content += `</div>`;
                    content += `<div class="detail-row two-columns">`;
                    content += `<div class="detail-cell"><span class="detail-key">HP:</span> <span class="detail-value">${itemData.hp}</span></div>`;
                    content += `<div class="detail-cell"><span class="detail-key">제한:</span> <span class="detail-value">${itemData.limit}</span></div>`;
                    content += `</div>`;
                    content += `</div>`;
                    break;
                case 'spell':
                    // 발동치 표시 로직
                    let invokeDisplay = '';
                    if (itemData.invoke === '-' && itemData.evocation === '-') {
                        invokeDisplay = '자동성공';
                    } else if (itemData.invoke !== '-' && itemData.evocation === '-') {
                        invokeDisplay = itemData.invoke;
                    } else if (itemData.invoke !== '-' && itemData.evocation !== '-') {
                        invokeDisplay = `${itemData.invoke}/${itemData.evocation}`;
                    } else if (itemData.invoke === '-' && itemData.evocation !== '-') {
                        invokeDisplay = itemData.evocation;
                    }

                    content += `<div class="item-details effect-details collapsible-content collapsed">`;
                    content += `<div class="detail-row">`;
                    const spellTypeDisplay = itemData.spellType === '-' ? '-' : game.i18n.localize(`DX3rd.${itemData.spellType}`);
                    content += `<span class="detail-key">종별:</span> <span class="detail-value">${spellTypeDisplay}</span>`;
                    content += `</div>`;
                    content += `<div class="detail-row">`;
                    content += `<span class="detail-key">발동치:</span> <span class="detail-value">${invokeDisplay}</span>`;
                    content += `</div>`;
                    content += `<div class="detail-row">`;
                    content += `<span class="detail-key">침식치:</span> <span class="detail-value">${itemData.encroach}</span>`;
                    content += `</div>`;
                    content += `</div>`;
                    break;
                case 'weapon':
                    content += `<div class="item-details effect-details collapsible-content collapsed">`;
                    content += `<div class="detail-row two-columns">`;
                    const weaponTypeDisplay = itemData.weaponType === '-' ? '-' : game.i18n.localize(`DX3rd.${itemData.weaponType.charAt(0).toUpperCase() + itemData.weaponType.slice(1)}`);
                    const weaponSkillDisplay = this._getSkillDisplay(itemData.skill);
                    content += `<div class="detail-cell"><span class="detail-key">종별:</span> <span class="detail-value">${weaponTypeDisplay}</span></div>`;
                    content += `<div class="detail-cell"><span class="detail-key">기능:</span> <span class="detail-value">${weaponSkillDisplay}</span></div>`;
                    content += `</div>`;
                    content += `<div class="detail-row two-columns">`;
                    content += `<div class="detail-cell"><span class="detail-key">수정치:</span> <span class="detail-value">${itemData.add}</span></div>`;
                    content += `<div class="detail-cell"><span class="detail-key">공격력:</span> <span class="detail-value">${itemData.attack}</span></div>`;
                    content += `</div>`;
                    content += `<div class="detail-row two-columns">`;
                    content += `<div class="detail-cell"><span class="detail-key">가드:</span> <span class="detail-value">${itemData.guard}</span></div>`;
                    content += `<div class="detail-cell"><span class="detail-key">사정거리:</span> <span class="detail-value">${itemData.range}</span></div>`;
                    content += `</div>`;
                    content += `</div>`;
                    break;
                case 'protect':
                    content += `<div class="item-details effect-details collapsible-content collapsed">`;
                    content += `<div class="detail-row two-columns">`;
                    content += `<div class="detail-cell"><span class="detail-key">종별:</span> <span class="detail-value">${game.i18n.localize("DX3rd.Protect")}</span></div>`;
                    content += `<div class="detail-cell"><span class="detail-key">장갑:</span> <span class="detail-value">${itemData.armor}</span></div>`;
                    content += `</div>`;
                    content += `<div class="detail-row two-columns">`;
                    content += `<div class="detail-cell"><span class="detail-key">닷지:</span> <span class="detail-value">${itemData.dodge}</span></div>`;
                    content += `<div class="detail-cell"><span class="detail-key">행동치:</span> <span class="detail-value">${itemData.init}</span></div>`;
                    content += `</div>`;
                    content += `</div>`;
                    break;
                case 'vehicle':
                    content += `<div class="item-details effect-details collapsible-content collapsed">`;
                    content += `<div class="detail-row two-columns">`;
                    const vehicleSkillDisplay = this._getSkillDisplay(itemData.skill);
                    content += `<div class="detail-cell"><span class="detail-key">종별:</span> <span class="detail-value">${game.i18n.localize("DX3rd.Vehicle")}</span></div>`;
                    content += `<div class="detail-cell"><span class="detail-key">기능:</span> <span class="detail-value">${vehicleSkillDisplay}</span></div>`;
                    content += `</div>`;
                    content += `<div class="detail-row two-columns">`;
                    content += `<div class="detail-cell"><span class="detail-key">공격력:</span> <span class="detail-value">${itemData.attack}</span></div>`;
                    content += `<div class="detail-cell"><span class="detail-key">행동치:</span> <span class="detail-value">${itemData.init}</span></div>`;
                    content += `</div>`;
                    content += `<div class="detail-row two-columns">`;
                    content += `<div class="detail-cell"><span class="detail-key">장갑:</span> <span class="detail-value">${itemData.armor}</span></div>`;
                    content += `<div class="detail-cell"><span class="detail-key">이동:</span> <span class="detail-value">${itemData.move}</span></div>`;
                    content += `</div>`;
                    content += `</div>`;
                    break;
                case 'connection':
                    content += `<div class="item-details effect-details collapsible-content collapsed">`;
                    content += `<div class="detail-row two-columns">`;
                    content += `<div class="detail-cell"><span class="detail-key">종별:</span> <span class="detail-value">${game.i18n.localize("DX3rd.Connection")}</span></div>`;
                    const connectionSkillDisplay = this._getSkillDisplay(itemData.skill);
                    content += `<div class="detail-cell"><span class="detail-key">기능:</span> <span class="detail-value">${connectionSkillDisplay}</span></div>`;
                    content += `</div>`;
                    content += `</div>`;
                    break;
                case 'etc':
                    content += `<div class="item-details effect-details collapsible-content collapsed">`;
                    content += `<div class="detail-row">`;
                    const etcTypeDisplay = itemData.etcType === '-' ? '-' : game.i18n.localize(`DX3rd.${itemData.etcType.charAt(0).toUpperCase() + itemData.etcType.slice(1)}`);
                    content += `<span class="detail-key">종별:</span> <span class="detail-value">${etcTypeDisplay}</span>`;
                    content += `</div>`;
                    content += `</div>`;
                    break;
                case 'once':
                    content += `<div class="item-details effect-details collapsible-content collapsed">`;
                    content += `<div class="detail-row">`;
                    content += `<span class="detail-key">종별:</span> <span class="detail-value">${game.i18n.localize("DX3rd.Once")}</span>`;
                    content += `</div>`;
                    content += `</div>`;
                    break;
                case 'book':
                    content += `<div class="item-details effect-details collapsible-content collapsed">`;
                    content += `<div class="detail-row">`;
                    content += `<span class="detail-key">종별:</span> <span class="detail-value">${game.i18n.localize("DX3rd.Book")}</span>`;
                    content += `</div>`;
                    content += `<div class="detail-row">`;
                    content += `<span class="detail-key">해독 난이도:</span> <span class="detail-value">${itemData.decipher || 0}</span>`;
                    content += `</div>`;
                    content += `</div>`;
                    break;
                case 'combo':
                    content += `<div class="item-details effect-details collapsible-content collapsed">`;
                    content += `<div class="detail-row">`;
                    const comboTimingDisplay = itemData.timing === '-' ? '-' : game.i18n.localize(`DX3rd.${itemData.timing.charAt(0).toUpperCase() + itemData.timing.slice(1)}`);
                    content += `<span class="detail-key">타이밍:</span> <span class="detail-value">${comboTimingDisplay}</span>`;
                    content += `</div>`;
                    content += `<div class="detail-row two-columns">`;
                    const comboSkillDisplay = this._getSkillDisplay(itemData.skill);
                    content += `<div class="detail-cell"><span class="detail-key">기능:</span> <span class="detail-value">${comboSkillDisplay}</span></div>`;
                    content += `<div class="detail-cell"><span class="detail-key">난이도:</span> <span class="detail-value">${itemData.difficulty || '-'}</span></div>`;
                    content += `</div>`;
                    content += `<div class="detail-row two-columns">`;
                    content += `<div class="detail-cell"><span class="detail-key">대상:</span> <span class="detail-value">${itemData.target || '-'}</span></div>`;
                    content += `<div class="detail-cell"><span class="detail-key">사정거리:</span> <span class="detail-value">${itemData.range || '-'}</span></div>`;
                    content += `</div>`;
                    content += `<div class="detail-row two-columns">`;
                    content += `<div class="detail-cell"><span class="detail-key">다이스:</span> <span class="detail-value">${itemData.dice || 0}</span></div>`;
                    content += `<div class="detail-cell"><span class="detail-key">크리티컬:</span> <span class="detail-value">${itemData.critical || 10}</span></div>`;
                    content += `</div>`;
                    content += `<div class="detail-row two-columns">`;
                    content += `<div class="detail-cell"><span class="detail-key">수정치:</span> <span class="detail-value">${itemData.add || 0}</span></div>`;
                    const comboAttackLabel = itemData.attackLabel || game.i18n.localize('DX3rd.Attack');
                    content += `<div class="detail-cell"><span class="detail-key">${comboAttackLabel}:</span> <span class="detail-value">${itemData.attack || 0}</span></div>`;
                    content += `</div>`;
                    content += `<div class="detail-row two-columns">`;
                    content += `<div class="detail-cell"><span class="detail-key">침식치:</span> <span class="detail-value">${itemData.encroach || 0}</span></div>`;
                    content += `<div class="detail-cell"><span class="detail-key">제한:</span> <span class="detail-value">${itemData.limit || '-'}</span></div>`;
                    content += `</div>`;
                    content += `</div>`;

                    break;
                case 'record':
                    content += `<div class="item-details effect-details">`;
                    content += `<div class="detail-row">`;
                    content += `<span class="detail-key">경험점:</span> <span class="detail-value">${itemData.exp}</span>`;
                    content += `</div>`;
                    content += `</div>`;
                    break;
                case 'rois':
                    // 로이스 타입별 조건부 표시
                    if (itemData.roisType !== 'D') {
                        // 긍정/부정 감정 표시 (D 타입이 아닌 경우, 항상 표시)
                        content += `<div class="item-details rois-details">`;
                        content += `<div class="detail-row">`;

                        // 긍정 감정
                        if (itemData.positive?.state) {
                            content += `<span class="detail-key" style="color:#73aae6; font-weight: bold;">긍정:</span> <span class="detail-value" style="color: rgb(115, 170, 230); font-weight: bold;">${itemData.positive.feeling || ''}</span>`;
                        } else {
                            content += `<span class="detail-key">${game.i18n.localize("DX3rd.Positive")}:</span> <span class="detail-value">${itemData.positive?.feeling || '-'}</span>`;
                        }
                        content += `</div>`;

                        // 부정 감정
                        content += `<div class="detail-row">`;
                        if (itemData.negative?.state) {
                            content += `<span class="detail-key" style="color:#f16060; font-weight: bold;">부정:</span> <span class="detail-value" style="color: rgb(241, 96, 96); font-weight: bold;">${itemData.negative.feeling || ''}</span>`;
                        } else {
                            content += `<span class="detail-key">${game.i18n.localize("DX3rd.Negative")}:</span> <span class="detail-value">${itemData.negative?.feeling || '-'}</span>`;
                        }
                        content += `</div>`;
                        content += `</div>`;
                    }
                    break;
            }

            // 설명이 있으면 추가
            if (itemData.description && itemData.description.trim()) {
                content += `<div class="item-description collapsible-content collapsed">`;
                content += `<div class="description-content">${itemData.description}</div>`;
                content += `</div>`;
            }

            // 마도서에 포함된 술식 버튼 추가 (설명 아래, 토글 가능)
            if (itemData.type === 'book' && itemData.spells && itemData.spells.length > 0) {
                content += `<div class="item-actions collapsible-content collapsed" style="display: none;">`;
                content += `<button class="use-item-btn book-toggle-btn" data-book-section="spells">술식 목록</button>`;
                content += `</div>`;
            }

            // 콤보 아이템의 경우 이펙트/무기 버튼 추가 (토글 가능)
            if (itemData.type === 'combo') {
                if ((itemData.effects && itemData.effects.length > 0) || (itemData.weapons && itemData.weapons.length > 0)) {
                    content += `<div class="item-actions collapsible-content collapsed" style="display: none;">`;
                    if (itemData.effects && itemData.effects.length > 0) {
                        content += `<button class="use-item-btn combo-toggle-btn" data-combo-section="effects">이펙트</button>`;
                    }
                    if (itemData.weapons && itemData.weapons.length > 0) {
                        content += `<button class="use-item-btn combo-toggle-btn" data-combo-section="weapons">무기</button>`;
                    }
                    content += `</div>`;
                }
            }

            // 아이템 사용 버튼 추가
            if (itemData.type === 'effect' || itemData.type === 'psionic' || itemData.type === 'spell' || itemData.type === 'weapon' || itemData.type === 'protect' || itemData.type === 'vehicle' || itemData.type === 'connection' || itemData.type === 'etc' || itemData.type === 'once' || itemData.type === 'combo' || itemData.type === 'book') {
                content += `<div class="item-actions">`;

                // 무기와 비클은 공격 롤 버튼 추가
                if (itemData.type === 'weapon' || itemData.type === 'vehicle') {
                    let showAttackButton = true;

                    // 무기의 경우 attack-used 횟수 체크
                    if (itemData.type === 'weapon') {
                        const attackUsedDisable = itemData['attack-used']?.disable || 'notCheck';
                        const attackUsedState = itemData['attack-used']?.state || 0;
                        const attackUsedMax = itemData['attack-used']?.max || 0;

                        // notCheck가 아니고, state >= max이면 버튼 숨김 (max === 0도 0회 사용 가능)
                        if (attackUsedDisable !== 'notCheck' && attackUsedState >= attackUsedMax) {
                            showAttackButton = false;
                        }
                    }

                    if (showAttackButton) {
                        content += `<button class="attack-roll-btn" data-item-id="${itemData.id}">${game.i18n.localize('DX3rd.AttackRoll')}</button>`;
                    }
                }

                // 모든 아이템에 사용 버튼 추가 (단, used 횟수 체크)
                let showUseButton = true;

                // used가 있는 아이템 타입만 체크 (무기는 별도 처리)
                const itemsWithUsed = ['combo', 'effect', 'spell', 'psionic', 'weapon', 'protect', 'vehicle', 'connection', 'etc', 'once'];
                if (itemsWithUsed.includes(itemData.type) && itemData.type !== 'weapon') {
                    const usedDisable = itemData.used?.disable || 'notCheck';
                    const usedState = itemData.used?.state || 0;
                    const usedMax = itemData.used?.max || 0;
                    const usedLevel = itemData.used?.level || false;

                    // displayMax 계산 (used.level이 체크되어 있으면 레벨 추가)
                    let displayMax = Number(usedMax) || 0;
                    if (usedLevel && itemData.type === 'effect') {
                        // 이펙트 아이템의 경우 침식률에 따른 레벨 수정이 적용된 수치 사용
                        const baseLevel = Number(itemData.level) || 0;
                        // upgrade 여부는 itemData에서 직접 가져올 수 없으므로 currentItem에서 확인
                        const currentItem = this.actor.items.get(itemData.id);
                        const upgrade = currentItem?.system?.level?.upgrade || false;
                        let finalLevel = baseLevel;
                        
                        if (upgrade && this.actor.system?.attributes?.encroachment?.level) {
                            const encLevel = Number(this.actor.system.attributes.encroachment.level) || 0;
                            finalLevel += encLevel;
                        }
                        
                        displayMax += finalLevel;
                    } else if (usedLevel && itemData.type === 'psionic') {
                        // 사이오닉은 침식률 보정 없이 init만 더함
                        const baseLevel = Number(itemData.level) || 0;
                        displayMax += baseLevel;
                    }

                    // notCheck가 아니고, state >= displayMax이면 버튼 숨김 (displayMax === 0도 0회 사용 가능)
                    if (usedDisable !== 'notCheck' && usedState >= displayMax) {
                        showUseButton = false;
                    }
                }

                // 무기는 used만 체크 (attack-used는 공격 버튼에서 체크)
                if (itemData.type === 'weapon') {
                    const usedDisable = itemData.used?.disable || 'notCheck';
                    const usedState = itemData.used?.state || 0;
                    const usedMax = itemData.used?.max || 0;

                    // notCheck가 아니고, state >= max이면 버튼 숨김 (max === 0도 0회 사용 가능)
                    if (usedDisable !== 'notCheck' && usedState >= usedMax) {
                        showUseButton = false;
                    }
                }

                if (showUseButton) {
                    let useText;
                    if (itemData.type === 'book') {
                        // 북은 "마도서 해독"으로 표기 (Book + Decipher 로컬라이즈 조합)
                        useText = `${game.i18n.localize('DX3rd.Book')} ${game.i18n.localize('DX3rd.Decipher')}`;
                    } else {
                        useText = game.i18n.localize(`DX3rd.${itemData.type.charAt(0).toUpperCase() + itemData.type.slice(1)}`) + " " + game.i18n.localize("DX3rd.Use");
                    }
                    content += `<button class="use-item-btn" data-item-id="${itemData.id}" data-get-target="${itemData.getTarget || false}">${useText}</button>`;
                }

                content += `</div>`;
            } else if (itemData.type === 'rois') {
                // 로이스 버튼 (D, M, E 타입 제외, 승화 이미 사용된 경우 제외)
                if (itemData.roisType !== 'D' && itemData.roisType !== 'M' && itemData.roisType !== 'E' && !itemData.sublimation) {
                    let buttonText = '';
                    let roisAction = '';
                    if (!itemData.titus) {
                        buttonText = game.i18n.localize("DX3rd.Titus");
                        roisAction = 'titus';
                    } else {
                        buttonText = game.i18n.localize("DX3rd.Sublimation");
                        roisAction = 'sublimation';
                    }

                    content += `<div class="item-actions">`;
                    content += `<button class="use-item-btn" data-item-id="${itemData.id}" data-rois-action="${roisAction}">${buttonText}</button>`;
                    content += `</div>`;
                }
            }

            content += `</div>`;
            return content;
        }

        _addChatToggleListeners(messageId) {
            // DOM이 완전히 렌더링될 때까지 대기
            setTimeout(() => {
                // Foundry VTT의 채팅 메시지 구조에 맞게 수정
                const messageElement = $(`#chat-log .message[data-message-id="${messageId}"] .message-content`);
                if (!messageElement.length) {
                    return;
                }

                const toggleElement = messageElement.find('.item-name-toggle');
                if (!toggleElement.length) {
                    return;
                }

                // 이벤트 위임을 사용하여 더 안정적으로 처리
                toggleElement.on('click.dx3rd-toggle', (event) => {
                    event.preventDefault();
                    event.stopPropagation();

                    const collapsibleElements = messageElement.find('.collapsible-content');

                    // 애니메이션 중복 방지
                    if (collapsibleElements.is(':animated')) {
                        return;
                    }

                    if (collapsibleElements.hasClass('collapsed')) {
                        collapsibleElements.removeClass('collapsed').slideDown(250, 'swing');
                    } else {
                        collapsibleElements.slideUp(250, 'swing', () => {
                            collapsibleElements.addClass('collapsed');
                        });
                    }
                });
            }, 1000); // 대기 시간을 더 늘림
        }

        _addGlobalChatToggleListeners() {
            // 전역 이벤트 위임으로 채팅 로그의 모든 토글 요소 처리
            $(document).off('click.dx3rd-global-toggle').on('click.dx3rd-global-toggle', '.item-name-toggle', (event) => {
                event.preventDefault();
                event.stopPropagation();

                // Foundry VTT 채팅 메시지 구조 확인
                const messageElement = $(event.currentTarget).closest('.message');

                // 다양한 선택자 시도
                let collapsibleElements = messageElement.find('.collapsible-content');
                if (collapsibleElements.length === 0) {
                    // message-content 내부에서 찾기
                    const messageContent = messageElement.find('.message-content');
                    collapsibleElements = messageContent.find('.collapsible-content');
                }
                if (collapsibleElements.length === 0) {
                    // 직접 message 내부에서 찾기
                    collapsibleElements = messageElement.find('.collapsible-content');
                }

                if (collapsibleElements.length === 0) {
                    return;
                }

                // 애니메이션 중복 방지
                if (collapsibleElements.is(':animated')) {
                    return;
                }

                if (collapsibleElements.hasClass('collapsed')) {
                    collapsibleElements.removeClass('collapsed').slideDown(250, 'swing');
                } else {
                    collapsibleElements.slideUp(250, 'swing', () => {
                        collapsibleElements.addClass('collapsed');
                    });
                }
            });
        }

        _initializeExistingChatMessages() {
            // 기존 채팅 메시지에서 토글 요소들을 찾아서 초기화
            const existingMessages = $('#chat-log .message');

            existingMessages.each((index, messageElement) => {
                const $message = $(messageElement);
                const collapsibleElements = $message.find('.collapsible-content');

                if (collapsibleElements.length > 0) {
                    // 인라인 스타일 제거하고 CSS 클래스로 초기화
                    collapsibleElements.each((i, element) => {
                        const $el = $(element);
                        $el.removeAttr('style').addClass('collapsed');
                    });
                }
            });
        }

        async _onUsedStateChange(event) {
            event.preventDefault();

            const input = $(event.currentTarget);
            const li = input.closest('.item');
            const itemId = li.data('item-id');

            if (!itemId) {
                return;
            }

            const item = this.actor.items.get(itemId);
            if (!item) {
                return;
            }

            const newState = parseInt(input.val()) || 0;

            // disabled 상태가 아닌 경우에만 업데이트
            if (!input.prop('disabled')) {
                try {
                    await item.update({
                        'system.used.state': newState
                    });
                } catch (err) {
                    console.error("DX3rd | ActorSheet _onUsedStateChange - update failed", err);
                    ui.notifications.error(`사용횟수 업데이트 실패: ${err.message}`);
                }
            }
        }

        async _onActiveChange(event) {
            event.preventDefault();

            const checkbox = $(event.currentTarget);
            const li = checkbox.closest('.item');
            const itemId = li.data('item-id');

            if (!itemId) {
                return;
            }

            const item = this.actor.items.get(itemId);
            if (!item) {
                return;
            }

            const newState = checkbox.prop('checked');

            try {
                await item.update({
                    'system.active.state': newState
                });
            } catch (err) {
                console.error("DX3rd | ActorSheet _onActiveChange - update failed", err);
                ui.notifications.error(`활성화 상태 업데이트 실패: ${err.message}`);
            }
        }

        async _onEquipmentChange(event) {
            event.preventDefault();

            const checkbox = $(event.currentTarget);
            const li = checkbox.closest('.item');
            const itemId = li.data('item-id');

            if (!itemId) {
                return;
            }

            const item = this.actor.items.get(itemId);
            if (!item) {
                return;
            }

            const newState = checkbox.prop('checked');

            try {
                // 비클 아이템의 경우 하나만 장착 가능
                if (item.type === 'vehicle' && newState === true) {
                    // 현재 장착된 다른 비클들을 모두 해제
                    const otherVehicles = this.actor.items.filter(i =>
                        i.type === 'vehicle' &&
                        i.id !== itemId &&
                        i.system?.equipment === true
                    );

                    for (const otherVehicle of otherVehicles) {
                        await otherVehicle.update({
                            'system.equipment': false
                        });
                    }
                }

                await item.update({
                    'system.equipment': newState
                });
            } catch (err) {
                console.error("DX3rd | ActorSheet _onEquipmentChange - update failed", err);
                ui.notifications.error(`장비 상태 업데이트 실패: ${err.message}`);
            }
        }

        async _onItemCreate(event) {
            event.preventDefault();
            
            // OWNER 권한 체크
            if (!this._hasOwnerPermission()) {
                ui.notifications.warn(game.i18n.localize("DX3rd.NoPermission"));
                return;
            }
            
            const button = $(event.currentTarget);
            const type = button.data('type') || "item";
            const effectType = button.data('effectType');
            const roisType = button.data('roisType');

            // StageCRC 비활성화 시 스펠/사이오닉/마도서 아이템 생성 차단
            if (!game.settings.get("dx3rd-emanim", "stageCRC") && (type === "spell" || type === "psionic" || type === "book")) {
                ui.notifications.warn("CRC 스테이지 비활성화 시 스펠, 사이오닉, 마도서 아이템을 생성할 수 없습니다.");
                return;
            }

            // 워크스 아이템 제한 (1개)
            if (type === "works") {
                const existingWorks = this.actor.items.filter(item => item.type === 'works');
                if (existingWorks.length >= 1) {
                    ui.notifications.info("Each character can only have one Works item.");
                    return;
                }
            }

            // 신드롬 아이템 제한 (3개)
            if (type === "syndrome") {
                const existingSyndromes = this.actor.items.filter(item => item.type === 'syndrome');
                if (existingSyndromes.length >= 3) {
                    ui.notifications.info("Each character can only have up to three Syndrome items.");
                    return;
                }
            }

            let typeLabel = game.i18n.localize(`DX3rd.${type.charAt(0).toUpperCase() + type.slice(1)}`);
            let itemData = {
                name: `New ${typeLabel !== `DX3rd.${type.charAt(0).toUpperCase() + type.slice(1)}` ? typeLabel : type}`,
                type: type,
                system: {}
            };
            if (effectType) itemData.system.type = effectType;
            if (roisType) itemData.system.type = roisType;
            // effect 아이템 생성 시 레벨 기본값 추가
            if (type === 'effect') {
                itemData.system.level = { init: 1, max: 1 };
            }

            await this.actor.createEmbeddedDocuments("Item", [itemData]);
        }

        async _onToggleSyndrome(event) {
            const input = event.currentTarget;
            // name 예: system.attributes.syndrome.<itemId>
            const parts = String(input.name).split('.');
            const itemId = parts[parts.length - 1];
            if (!itemId) return;

            // mousedown에서는 현재 상태의 반대값이 될 예정
            const willBeChecked = !input.checked;
            const current = Array.isArray(this.actor.system.attributes?.syndrome)
                ? [...this.actor.system.attributes.syndrome]
                : [];

            // 신드롬 아이템 개수 확인
            const syndromeItems = this.actor.items.filter(item => item.type === 'syndrome');
            const totalSyndromeCount = syndromeItems.length;

            const idx = current.indexOf(itemId);

            // 체크하려는 경우 (현재 체크되지 않은 상태에서 체크하려는 경우)
            if (willBeChecked && idx === -1) {
                // 트라이브리드이고 이미 2개가 체크된 경우 제한
                if (totalSyndromeCount === 3 && current.length >= 2) {
                    ui.notifications.info("You cannot check Optional Syndrome.");

                    // 기본 이벤트 동작 완전 차단
                    event.preventDefault();
                    event.stopPropagation();
                    event.stopImmediatePropagation();

                    // 체크박스 상태를 강제로 되돌림
                    input.checked = false;
                    input.setAttribute('checked', false);
                    input.removeAttribute('checked');

                    // 체크박스를 일시적으로 비활성화
                    input.disabled = true;
                    setTimeout(() => {
                        input.disabled = false;
                    }, 100);

                    // 이벤트 전파 완전 차단
                    return false;
                }
                current.push(itemId);
            }

            // 체크 해제하는 경우 (현재 체크된 상태에서 해제하려는 경우)
            if (!willBeChecked && idx !== -1) {
                current.splice(idx, 1);
            }

            // 업데이트가 필요한 경우에만 실행
            const needsUpdate = (willBeChecked && idx === -1) || (!willBeChecked && idx !== -1);

            if (needsUpdate) {
                try {
                    await this.actor.update({ 'system.attributes.syndrome': current });
                    this.render(false);
                } catch (e) {
                    console.error('DX3rd | ActorSheet syndrome toggle failed', e);
                }
            }
        }

        async _onSyndromeClick(event) {
            const input = event.currentTarget;
            const parts = String(input.name).split('.');
            const itemId = parts[parts.length - 1];
            if (!itemId) return;

            const current = Array.isArray(this.actor.system.attributes?.syndrome)
                ? [...this.actor.system.attributes.syndrome]
                : [];

            // 신드롬 아이템 개수 확인
            const syndromeItems = this.actor.items.filter(item => item.type === 'syndrome');
            const totalSyndromeCount = syndromeItems.length;

            const idx = current.indexOf(itemId);
            const checked = input.checked;

            // 3번째 체크 시도 차단
            if (checked && idx === -1 && totalSyndromeCount === 3 && current.length >= 2) {
                event.preventDefault();
                event.stopPropagation();
                event.stopImmediatePropagation();

                input.checked = false;
                input.setAttribute('checked', false);
                input.removeAttribute('checked');

                ui.notifications.info("You cannot check Optional Syndrome.");
                return false;
            }

            // 정상적인 체크/해제 처리
            if (checked && idx === -1) {
                current.push(itemId);
            } else if (!checked && idx !== -1) {
                current.splice(idx, 1);
            }

            try {
                await this.actor.update({ 'system.attributes.syndrome': current });
                this.render(false);
            } catch (e) {
                console.error('DX3rd | ActorSheet syndrome click failed', e);
            }
        }

        async _onDragOver(event) {
            event.preventDefault();
        }

        _onDragStart(event) {
            const li = event.currentTarget;
            const itemId = li.dataset.itemId;

            if (!itemId) return;

            const item = this.actor.items.get(itemId);
            if (!item) return;

            // 드래그 데이터 설정
            const dragData = {
                type: 'Item',
                uuid: item.uuid,
                actorId: this.actor.id,
                itemId: itemId,
                itemType: item.type,
                sortValue: item.sort || 0
            };

            // jQuery 이벤트는 originalEvent를 통해 네이티브 이벤트에 접근
            const dataTransfer = event.originalEvent ? event.originalEvent.dataTransfer : event.dataTransfer;
            dataTransfer.setData('text/plain', JSON.stringify(dragData));
        }

        async _onDrop(event) {
            event.preventDefault();
            event.stopPropagation();

            // jQuery 이벤트는 originalEvent를 통해 네이티브 이벤트에 접근
            const dataTransfer = event.originalEvent ? event.originalEvent.dataTransfer : event.dataTransfer;

            try {
                // 드롭된 데이터 파싱
                const dataText = dataTransfer.getData('text/plain');
                if (!dataText) {
                    return;
                }

                const data = JSON.parse(dataText);

                // 아이템 드롭인지 확인
                if (data.type === 'Item') {
                    // 같은 액터의 아이템을 드래그하여 순서 변경하는 경우
                    if (data.actorId === this.actor.id) {
                        const target = event.target.closest('.item');

                        if (target) {
                            const targetItemId = target.dataset.itemId;
                            const sourceItemId = data.itemId;

                            // 자기 자신에게 드롭한 경우 무시
                            if (targetItemId === sourceItemId) return;

                            const sourceItem = this.actor.items.get(sourceItemId);
                            const targetItem = this.actor.items.get(targetItemId);

                            // 같은 타입의 아이템인지 확인
                            if (sourceItem && targetItem && sourceItem.type === targetItem.type) {
                                // 타겟 아이템의 sort 값을 사용하여 소스 아이템 업데이트
                                const siblings = this.actor.items.filter(i => i.type === sourceItem.type && i.id !== sourceItem.id);
                                const sortUpdates = SortingHelpers.performIntegerSort(sourceItem, {
                                    target: targetItem,
                                    siblings: siblings
                                });

                                const updateData = sortUpdates.map(u => {
                                    return { _id: u.target.id, sort: u.update.sort };
                                });

                                await this.actor.updateEmbeddedDocuments("Item", updateData);
                                return;
                            }
                        }

                        // 순서 변경이 아닌 경우, 기본 드롭 처리 (외부 아이템 추가)
                        return;
                    }

                    // 외부에서 새 아이템을 드롭하는 경우
                    const item = await fromUuid(data.uuid);

                    if (!item) {
                        return;
                    }

                    if (item && (item.type === 'spell' || item.type === 'psionic' || item.type === 'book')) {
                        // StageCRC 비활성화 시 스펠/사이오닉/마도서 아이템 드롭 차단
                        if (!game.settings.get("dx3rd-emanim", "stageCRC")) {
                            ui.notifications.warn("CRC 스테이지 비활성화 시 스펠, 사이오닉, 마도서 아이템을 추가할 수 없습니다.");
                            return;
                        }
                    }

                    // 워크스 아이템 제한 (1개)
                    if (item.type === 'works') {
                        const existingWorks = this.actor.items.filter(actorItem => actorItem.type === 'works');
                        if (existingWorks.length >= 1) {
                            ui.notifications.info("Each character can only have one Works item.");
                            return;
                        }
                    }

                    // 신드롬 아이템 제한 (3개)
                    if (item.type === 'syndrome') {
                        const existingSyndromes = this.actor.items.filter(actorItem => actorItem.type === 'syndrome');
                        if (existingSyndromes.length >= 3) {
                            ui.notifications.info("Each character can only have up to three Syndrome items.");
                            return;
                        }
                    }

                    // 정상적인 아이템 추가 처리
                    await this.actor.createEmbeddedDocuments("Item", [item.toObject()]);
                    return; // 명시적 return으로 부모 클래스 호출 방지
                }
            } catch (error) {
                console.error('DX3rd | Item drop failed:', error);
            }
        }


        _prepareCharacterItems(actorData, items) {
            return window.DX3rdActorSheetData.prepareCharacterItems(this.actor, actorData, items);
        }

        generateAppliedEffectDescription(appliedEffect, appliedKey) {
            return window.DX3rdActorSheetData.generateAppliedEffectDescription(appliedEffect, appliedKey);
        }

        async _onRemoveApplied(event) {
            event.preventDefault();
            const button = $(event.currentTarget);
            const itemElement = button.closest('.item');
            const itemId = itemElement.data('item-id');

            if (!itemId) {
                return;
            }

            // applied 효과 제거 확인
            const confirmed = await Dialog.confirm({
                title: 'Applied 효과 제거',
                content: '이 효과를 제거하시겠습니까?',
                yes: () => true,
                no: () => false,
                defaultYes: false
            });

            if (!confirmed) return;

            try {
                // applied에서 해당 효과 제거
                const applied = this.actor.system.attributes.applied || {};
                const updates = {};

                // 해당 키 찾기 - itemId가 applied_${index} 형태이므로 인덱스로 찾기
                if (itemId.startsWith('applied_')) {
                    const index = parseInt(itemId.replace('applied_', ''));
                    const appliedKeys = Object.keys(applied);
                    const appliedValues = Object.values(applied);

                    if (index >= 0 && index < appliedKeys.length) {
                        const targetKey = appliedKeys[index];
                        const appliedEffect = appliedValues[index];

                        // applied 효과 제거만 수행 (actor.js에서 자동으로 계산 반영)

                        // applied에서 효과 제거
                        updates[`system.attributes.applied.-=${targetKey}`] = null;
                    }
                }

                if (Object.keys(updates).length > 0) {
                    await this.actor.update(updates);
                    ui.notifications.info('Applied 효과가 제거되었습니다.');
                } else {
                    ui.notifications.warn('제거할 효과를 찾을 수 없습니다.');
                }

            } catch (error) {
                console.error('DX3rd | Error removing applied effect:', error);
                ui.notifications.error('효과 제거 중 오류가 발생했습니다.');
            }
        }

        async _onShowApplied(event) {
            event.preventDefault();
            const button = $(event.currentTarget);
            const itemElement = button.closest('.item');
            const itemId = itemElement.data('item-id');

            if (!itemId) {
                return;
            }

            // applied 효과 데이터 찾기
            const applied = this.actor.system.attributes.applied || {};
            const appliedValues = Object.values(applied);

            if (itemId.startsWith('applied_')) {
                const index = parseInt(itemId.replace('applied_', ''));
                if (index >= 0 && index < appliedValues.length) {
                    const appliedEffect = appliedValues[index];

                    // 데이터 검증 및 기본값 설정
                    const effectName = appliedEffect.name || '알 수 없는 효과';
                    const effectSource = appliedEffect.source || '알 수 없는 시전자';
                    const effectTimestamp = appliedEffect.timestamp || Date.now();
                    const effectDisable = appliedEffect.disable || '-';

                    // 다이얼로그 생성
                    let tableContent = '';

                    // 새로운 구조 (key, label, value가 직접 있는 경우) 처리
                    if (appliedEffect.key && appliedEffect.label && appliedEffect.value !== undefined) {
                        const localizedKey = window.DX3rdAttributeLocalizer?.localize(appliedEffect.key) || appliedEffect.key;
                        const localizedLabel = window.DX3rdAttributeLocalizer?.localize(appliedEffect.label) || appliedEffect.label;

                        tableContent = `
                            <table class="applied-effect-table">
                                <thead>
                                    <tr>
                                        <th>Key</th>
                                        <th>Label</th>
                                        <th>값</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    <tr>
                                        <td>${localizedKey}</td>
                                        <td>${localizedLabel}</td>
                                        <td>${appliedEffect.value >= 0 ? '+' : ''}${appliedEffect.value}</td>
                                    </tr>
                                </tbody>
                            </table>
                        `;
                    }
                    // 기존 구조 (attributes 객체가 있는 경우) 처리
                    else if (appliedEffect.attributes && Object.keys(appliedEffect.attributes).length > 0) {
                        tableContent = `
                            <table class="applied-effect-table">
                                <thead>
                                    <tr>
                                        <th>Key</th>
                                        <th>Label</th>
                                        <th>값</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    ${Object.entries(appliedEffect.attributes).map(([attrName, attrValue]) => {
                            const key = (typeof attrValue === 'object' && attrValue) ? (attrValue.key ?? (attrName.split(':')[0] || attrName)) : (attrName.split(':')[0] || attrName);
                            const labelRaw = (typeof attrValue === 'object' && attrValue) ? (attrValue.label ?? (attrName.split(':')[1] || attrName)) : (attrName.split(':')[1] || attrName);
                            const value = (typeof attrValue === 'object' && attrValue && 'value' in attrValue) ? attrValue.value : attrValue;

                            const localizedKey = window.DX3rdAttributeLocalizer?.localize(key) || key;
                            const localizedLabel = window.DX3rdAttributeLocalizer?.localize(labelRaw) || labelRaw;

                            return `<tr>
                                            <td>${localizedKey}</td>
                                            <td>${localizedLabel}</td>
                                            <td>${value >= 0 ? '+' : ''}${value}</td>
                                        </tr>`;
                        }).join('')}
                                </tbody>
                            </table>
                        `;
                    }

                    const content = `
                        <div class="applied-effect-dialog">
                            ${tableContent || '<p>적용된 어트리뷰트가 없습니다.</p>'}
                        </div>
                    `;

                    new Dialog({
                        title: `${effectName} - 상세 정보`,
                        content: content,
                        buttons: {
                            close: {
                                icon: '<i class="fas fa-times"></i>',
                                label: '닫기',
                                callback: () => { }
                            }
                        },
                        default: 'close'
                    }).render(true);
                }
            }
        }

        async _onAbilityNameClick(event) {
            event.preventDefault();
            event.stopPropagation();
            const abilityId = $(event.currentTarget).closest('[data-ability-id]').data('ability-id');
            if (!abilityId) return;

            // 권한 체크
            if (!this.actor.isOwner && !game.user.isGM) {
                ui.notifications.warn('이 액터에 대한 권한이 없습니다.');
                return;
            }

            // UniversalHandler로 위임
            if (window.DX3rdUniversalHandler) {
                window.DX3rdUniversalHandler.showStatRollConfirmDialog(
                    this.actor,
                    'ability',
                    abilityId,
                    this._openComboBuilder.bind(this)
                );
            }
        }

        async _onSkillNameClick(event) {
            event.preventDefault();
            event.stopPropagation();
            const skillId = $(event.currentTarget).closest('[data-skill-id]').data('skill-id');
            if (!skillId) return;

            // 권한 체크
            if (!this.actor.isOwner && !game.user.isGM) {
                ui.notifications.warn('이 액터에 대한 권한이 없습니다.');
                return;
            }

            // UniversalHandler로 위임
            if (window.DX3rdUniversalHandler) {
                window.DX3rdUniversalHandler.showStatRollConfirmDialog(
                    this.actor,
                    'skill',
                    skillId,
                    this._openComboBuilder.bind(this)
                );
            }
        }

        async _openComboBuilder(targetType, targetId) {
            // 액터 보유 이펙트 목록 수집 (정렬 포함)
            const effects = this.actor.items.filter(i => i.type === 'effect');
            const effectList = effects.sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0)).map(i => i.toObject());

            // targetType이 'ability'인 경우 key는 targetId, base는 없음
            // targetType이 'skill'인 경우 key는 targetId, base는 skill의 base 속성
            let targetKey = targetId;
            let targetBase = null;

            if (targetType === 'skill') {
                const skill = this.actor.system?.attributes?.skills?.[targetId];
                if (skill) {
                    targetBase = skill.base;
                }
            }

            // 스킬 정렬: 능력치별 (기본 스킬 우선, 커스텀 스킬 후순위)
            const sortedSkills = this._getSortedSkillOptions();

            // UniversalHandler의 openComboBuilder로 위임
            if (window.DX3rdUniversalHandler) {
                await window.DX3rdUniversalHandler.openComboBuilder(this.actor, targetType, targetKey);
            }
        }

        _getSortedSkillOptions() {
            const skills = this.actor.system?.attributes?.skills || {};
            const sortedOptions = [];

            // 능력치별 기본 스킬 순서
            const skillOrder = {
                body: ['melee', 'evade'],
                sense: ['ranged', 'perception'],
                mind: ['rc', 'will', 'cthulhu'],
                social: ['negotiation', 'procure']
            };

            const attributes = ['body', 'sense', 'mind', 'social'];

            for (const attr of attributes) {
                // 능력치 자체 추가
                sortedOptions.push({
                    value: attr,
                    label: game.i18n.localize(`DX3rd.${attr.charAt(0).toUpperCase() + attr.slice(1)}`),
                    isAbility: true
                });

                // 해당 능력치의 기본 스킬들
                const defaultSkills = skillOrder[attr] || [];
                for (const skillKey of defaultSkills) {
                    const skill = skills[skillKey];
                    if (skill && skill.base === attr) {
                        let skillName = skill.name;
                        if (skillName && skillName.startsWith('DX3rd.')) {
                            skillName = game.i18n.localize(skillName);
                        }
                        sortedOptions.push({
                            value: skillKey,
                            label: skillName,
                            isAbility: false
                        });
                    }
                }

                // 해당 능력치의 커스텀 스킬들
                for (const [skillKey, skill] of Object.entries(skills)) {
                    if (skill.base === attr && !defaultSkills.includes(skillKey)) {
                        let skillName = skill.name;
                        if (skillName && skillName.startsWith('DX3rd.')) {
                            skillName = game.i18n.localize(skillName);
                        }
                        sortedOptions.push({
                            value: skillKey,
                            label: skillName,
                            isAbility: false
                        });
                    }
                }
            }

            return sortedOptions;
        }

        _onAbilityHover(event) {
            const abilityId = $(event.currentTarget).closest('[data-ability-id]').data('ability-id');
            if (!abilityId) return;

            const ability = this.actor.system.attributes[abilityId];
            if (!ability) return;

            this._updateDiceInfo(ability);
        }

        _onAbilityHoverOut(event) {
            // 원래 값으로 되돌리기 (현재 선택된 판정 타입 기준)
            this._resetDiceInfo();
        }

        _onSkillHover(event) {
            const skillId = $(event.currentTarget).closest('[data-skill-id]').data('skill-id');
            if (!skillId) return;

            const skill = this.actor.system.attributes.skills[skillId];
            if (!skill) return;

            this._updateDiceInfo(skill);
        }

        _onSkillHoverOut(event) {
            // 원래 값으로 되돌리기
            this._resetDiceInfo();
        }

        _updateDiceInfo(stat) {
            const diceView = this.actor.system.attributes.dice?.view || 'major';
            const rollType = diceView; // 'major', 'reaction', 'dodge'

            const $diceInput = this.element.find('#dice');
            const $criticalInput = this.element.find('#critical');
            const $addInput = this.element.find('#add');

            if (stat[rollType]) {
                $diceInput.val(stat[rollType].dice || 0);
                $criticalInput.val(stat[rollType].critical || (game.settings.get("dx3rd-emanim", "defaultCritical") || 10));
                $addInput.val(stat[rollType].add || 0);
            } else {
                // 판정 타입별 데이터가 없으면 기본값 사용
                $diceInput.val(stat.dice || 0);
                $criticalInput.val(stat.critical || (game.settings.get("dx3rd-emanim", "defaultCritical") || 10));
                $addInput.val(stat.add || 0);
            }
        }

        _resetDiceInfo() {
            // dice-info를 기본 값으로 복원 (0, defaultCritical, 0)
            const $diceInput = this.element.find('#dice');
            const $criticalInput = this.element.find('#critical');
            const $addInput = this.element.find('#add');

            $diceInput.val(0);
            $criticalInput.val(game.settings.get("dx3rd-emanim", "defaultCritical") || 10);
            $addInput.val(0);
        }

        async _onTitusClick(event) {
            event.preventDefault();
            const button = $(event.currentTarget);
            const li = button.closest('.item');
            const itemId = li.data('item-id');

            if (!itemId) {
                return;
            }

            const item = this.actor.items.get(itemId);
            if (!item) {
                return;
            }

            // Titus 핸들러 호출
            if (window.DX3rdRoisHandler) {
                await window.DX3rdRoisHandler.handleTitus(this.actor.id, itemId);
            } else {
                ui.notifications.error('로이스 핸들러를 찾을 수 없습니다.');
            }
        }

        async _onSublimationClick(event) {
            event.preventDefault();
            const button = $(event.currentTarget);
            const li = button.closest('.item');
            const itemId = li.data('item-id');

            if (!itemId) {
                return;
            }

            const item = this.actor.items.get(itemId);
            if (!item) {
                return;
            }

            // 이미 승화가 사용된 경우 초기화 확인 다이얼로그 표시
            if (item.system.sublimation) {
                const confirmed = await Dialog.confirm({
                    title: "Initialize this item",
                    content: "<p>Do you want to reset Titus and Sublimation for this item?</p>",
                    yes: () => true,
                    no: () => false,
                    defaultYes: false
                });

                if (confirmed) {
                    // Titus와 Sublimation 초기화
                    await item.update({
                        "system.titus": false,
                        "system.sublimation": false
                    });
                    ui.notifications.info("로이스가 초기화되었습니다.");
                }
                return;
            }

            // 승화가 아직 사용되지 않은 경우 Sublimation 핸들러 호출
            if (window.DX3rdRoisHandler) {
                await window.DX3rdRoisHandler.handleSublimation(this.actor.id, itemId);
            } else {
                ui.notifications.error('로이스 핸들러를 찾을 수 없습니다.');
            }
        }

        /**
         * Stock 클릭 핸들러
         * @private
         */
        async _onStockClick(event) {
            event.preventDefault();
            return window.DX3rdActorEditDialogs.openStock(this.actor);
        }

        /**
         * ActorType 버튼 클릭 핸들러
         * @private
         */
        async _onActorTypeClick(event) {
            event.preventDefault();
            return window.DX3rdActorEditDialogs.openActorType(this.actor);
        }

        /**
         * 백트랙 핸들러
         */
        async _onBacktrackRoll(event) {
            event.preventDefault();
            if (!window.DX3rdBacktrackWorkflow) {
                ui.notifications.error('DX3rdBacktrackWorkflow를 찾을 수 없습니다.');
                return;
            }
            await window.DX3rdBacktrackWorkflow.start(this.actor);
        }

    }

    // 액터 시트 등록 (v13 호환)
    const ActorsClass = foundry.documents?.collections?.Actors || Actors;
    ActorsClass.registerSheet('dx3rd-emanim', DX3rdActorSheet, {
        types: ['character', 'enemy'],
        makeDefault: true
    });
})();
