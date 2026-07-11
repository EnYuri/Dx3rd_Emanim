/**
 * Double Cross 3rd Actor Sheet
 */
(function () {
    // v13 호환: foundry.appv1 네임스페이스 사용
    const ActorSheetClass = foundry.appv1?.sheets?.ActorSheet || ActorSheet;
    const compat = window.DX3rdApplicationCompat;

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


        activateListeners(html) {
            super.activateListeners(html);
            const root = compat.unwrapRoot(html);

            compat.on(root, 'click', '.backtrack-roll', this._onBacktrackRoll.bind(this));
            // .skill-roll/.ability-roll 클릭은 아래 _onSkillNameClick/_onAbilityNameClick에서 처리됨

            // 전역 토글 리스너는 main.js에서 등록됨

            // 스킬 관리 리스너
            compat.on(root, 'click', '.skill-create', this._onCreateSkill.bind(this));
            compat.on(root, 'click', '.skill-edit', this._onEditSkill.bind(this));
            compat.on(root, 'click', '.skill-delete', this._onDeleteSkill.bind(this));

            compat.on(root, 'click', '.diamond', this._onAbilityDiamondClick.bind(this));
            
            // 에너미 HP max 클릭 리스너
            compat.on(root, 'click', '.hp-max-clickable', this._onEnemyHPMaxClick.bind(this));
            
            // 에너미 행동치 클릭 리스너
            compat.on(root, 'click', '.init-clickable', this._onEnemyInitClick.bind(this));
            
            // 에너미 이동(전투) 클릭 리스너
            compat.on(root, 'click', '.move-battle-clickable', this._onEnemyMoveClick.bind(this));
            
            // 에너미 회피치 클릭 리스너
            compat.on(root, 'click', '.evasion-clickable', this._onEnemyEvasionClick.bind(this));
            
            // 에너미 장갑치 클릭 리스너
            compat.on(root, 'click', '.armor-clickable', this._onEnemyArmorClick.bind(this));

            // 아이템 우클릭 컨텍스트 메뉴 (시트 열기 + 콤보로 조합)
            compat.on(root, 'contextmenu', '.item[data-item-id]', this._onItemContextMenu.bind(this));

            // 아이템 에딧/삭제 리스너
            compat.on(root, 'click', '.item-edit', this._onItemEdit.bind(this));
            compat.on(root, 'click', '.item-apply', this._onItemApplyEffect.bind(this));
            compat.on(root, 'click', '.item-delete', this._onItemDelete.bind(this));
            compat.on(root, 'click', '.item-create', this._onItemCreate.bind(this));

            // echo-item 클릭 시 채팅 출력 리스너
            compat.on(root, 'click', '.echo-item', this._onItemNameClick.bind(this));
            
            // item-label 클릭 시 설명 토글 리스너
            compat.on(root, 'click', '.item-label', this._onItemLabelClick.bind(this));

            // 사용횟수 수정 리스너 (disabled되지 않는 첫 번째 입력필드만)
            compat.on(root, 'change', '.used-input:not([disabled])', this._onUsedStateChange.bind(this));

            // 활성화 체크박스 리스너
            compat.on(root, 'change', '.active-check', this._onActiveChange.bind(this));

            // 장비 체크박스 리스너
            compat.on(root, 'change', '.active-equipment', this._onEquipmentChange.bind(this));

            // Applied 효과 제거 리스너
            compat.on(root, 'click', '.remove-applied', this._onRemoveApplied.bind(this));

            // Applied 효과 보기 리스너
            compat.on(root, 'click', '.show-applied', this._onShowApplied.bind(this));

            // Applied 효과 편집 리스너
            compat.on(root, 'click', '.edit-applied', this._onEditApplied.bind(this));

            // 신드롬 체크박스 토글 - mousedown과 click 둘 다 처리하여 완전한 차단
            compat.on(root, 'mousedown', 'input.item-checkbox[name^="system.attributes.syndrome."]', this._onToggleSyndrome.bind(this));
            compat.on(root, 'click', 'input.item-checkbox[name^="system.attributes.syndrome."]', this._onSyndromeClick.bind(this));

            // 드래그 앤 드롭 이벤트 처리
            compat.on(root, 'dragstart', '.item', this._onDragStart.bind(this));
            compat.on(root, 'dragover', this._onDragOver.bind(this));
            compat.on(root, 'drop', this._onDrop.bind(this));

            // 능력치 이름 클릭 시 dice 정보 출력
            compat.on(root, 'click', '.ability-roll', this._onAbilityNameClick.bind(this));

            // 스킬 이름 클릭 시 dice 정보 출력
            compat.on(root, 'click', '.skill-roll', this._onSkillNameClick.bind(this));

            // 능력치/스킬 호버 시 dice-info 업데이트
            compat.on(root, 'mouseover', '.ability-roll', this._onAbilityHover.bind(this));
            compat.on(root, 'mouseout', '.ability-roll', this._onAbilityHoverOut.bind(this));
            compat.on(root, 'mouseover', '.skill-roll', this._onSkillHover.bind(this));
            compat.on(root, 'mouseout', '.skill-roll', this._onSkillHoverOut.bind(this));

            // 로이스 Titus 버튼 클릭
            compat.on(root, 'click', '.btn-titus', this._onTitusClick.bind(this));

            // 로이스 Sublimation 버튼 클릭
            compat.on(root, 'click', '.btn-sublimation', this._onSublimationClick.bind(this));

            // 재산점 클릭
            compat.on(root, 'click', '.stock-title', this._onStockClick.bind(this));
        }

        async _onCreateSkill(event, target = event.currentTarget) {
            event.preventDefault();
            
            // OWNER 권한 체크
            if (!this._hasOwnerPermission()) {
                ui.notifications.warn(game.i18n.localize("DX3rd.NoPermission"));
                return;
            }
            
            // 클릭 버블링으로 능력치 이름(.ability-roll) 클릭 핸들러가 함께 실행되지 않도록 차단
            event.stopPropagation();
            const abilityId = target?.dataset?.abilityId;
            if (!abilityId) return;

            // 다이얼로그 생성은 공유 헬퍼로 위임 (AppV2 액터 시트와 동일한 경로)
            window.DX3rdActorSheetData.openCreateSkillDialog(this.actor, abilityId);
        }

        async _onEditSkill(event, target = event.currentTarget) {
            event.preventDefault();
            
            // OWNER 권한 체크
            if (!this._hasOwnerPermission()) {
                ui.notifications.warn(game.i18n.localize("DX3rd.NoPermission"));
                return;
            }
            
            const skillId = target?.closest('.skill')?.dataset?.skillId;
            if (!skillId) return;

            // 다이얼로그 생성은 공유 헬퍼로 위임 (AppV2 액터 시트와 동일한 경로)
            window.DX3rdActorSheetData.openEditSkillDialog(this.actor, skillId);
        }

        async _onDeleteSkill(event, target = event.currentTarget) {
            event.preventDefault();

            const skillId = target?.closest('.skill')?.dataset?.skillId;
            if (!skillId) return;

            if (!window.DX3rdActorDeleteDialogs) {
                ui.notifications.error('DX3rdActorDeleteDialogs를 찾을 수 없습니다.');
                return;
            }

            await window.DX3rdActorDeleteDialogs.deleteSkill(this.actor, skillId);
        }

        async _onAbilityDiamondClick(event, target = event.currentTarget) {
            event.preventDefault();
            // 캐릭터 시트는 .diamond에 data-ability, 에너미 시트는 부모에 data-ability-id
            const el = target;
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

        _onItemContextMenu(event, target = event.currentTarget) {
            // 입력 요소 위 우클릭(붙여넣기 등)은 가로채지 않는다
            if (event.target.closest('input, textarea, select, [contenteditable="true"]')) return;
            event.preventDefault();
            // 효과(Applied) 항목 우클릭 = 편집 UI(연필 버튼과 동일).
            const appliedEl = target?.closest('[data-applied-id]');
            if (appliedEl) {
                const key = appliedEl.dataset.appliedId;
                if (key && window.DX3rdActorAppliedDialogs?.edit) {
                    window.DX3rdActorAppliedDialogs.edit(this.actor, key);
                }
                return;
            }
            const itemId = target?.closest('[data-item-id]')?.dataset?.itemId;
            const item = itemId ? this.actor.items.get(itemId) : null;
            if (!item) return;
            window.DX3rdItemContextMenu?.open(event, { actor: this.actor, item, sheet: this });
        }

        async _onItemEdit(event, target = event.currentTarget) {
            event.preventDefault();

            // OWNER 권한 체크
            if (!this._hasOwnerPermission()) {
                ui.notifications.warn(game.i18n.localize("DX3rd.NoPermission"));
                return;
            }
            
            const itemId = target?.closest('.item')?.dataset?.itemId;
            if (!itemId) return;
            const item = this.actor.items.get(itemId);
            if (item) item.sheet.render(true);
        }

        async _onItemDelete(event, target = event.currentTarget) {
            event.preventDefault();

            const itemId = target?.closest('.item')?.dataset?.itemId;
            if (!itemId) return;

            if (!window.DX3rdActorDeleteDialogs) {
                ui.notifications.error('DX3rdActorDeleteDialogs를 찾을 수 없습니다.');
                return;
            }

            await window.DX3rdActorDeleteDialogs.deleteItem(this.actor, itemId);
        }

        // 대상 지정 특수효과(effect.attributes) 적용 — V2 _onApplyEffect 의 V1 패리티.
        async _onItemApplyEffect(event, target = event.currentTarget) {
            event.preventDefault();
            const itemId = target?.closest('.item')?.dataset?.itemId;
            const item = itemId && this.actor.items.get(itemId);
            if (!item) return;
            await window.DX3rdActorSheetData.applyItemEffect(this.actor, item);
        }

        async _onItemNameClick(event, target = event.currentTarget) {
            event.preventDefault();
            event.stopPropagation();
            const itemId = target?.closest('.item')?.dataset?.itemId;
            if (!itemId) return;

            const item = this.actor.items.get(itemId);
            if (!item) return;

            // 채팅 출력 게이트(권한 + 소진)는 공유 헬퍼로 위임 (AppV2 액터 시트와 동일한 경로)
            const gate = window.DX3rdActorSheetData.checkItemChatGate(this.actor, item);
            if (!gate.ok) {
                (ui.notifications[gate.level] || ui.notifications.warn).call(ui.notifications, gate.message);
                return;
            }

            // 아이템 정보를 채팅으로 출력
            await this._sendItemToChat(item);
        }

        async _onItemLabelClick(event, target = event.currentTarget) {
            event.preventDefault();
            event.stopPropagation();
            
            // echo-item 클릭이면 채팅 출력으로 처리하지 않음
            if (event.target?.closest?.('.echo-item')) {
                return;
            }
            
            const li = target?.closest('.item');
            const itemId = li?.dataset?.itemId;
            if (!itemId) return;
            
            const itemDescription = li.querySelector('.item-description');
            const toggleIcon = li.querySelector('.item-details-toggle i');
            
            if (!itemDescription) return;
            
            const isVisible = getComputedStyle(itemDescription).display !== 'none';
            if (isVisible) {
                itemDescription.style.display = 'none';
                toggleIcon?.classList.remove('fa-chevron-up');
                toggleIcon?.classList.add('fa-chevron-down');
            } else {
                itemDescription.style.display = 'block';
                toggleIcon?.classList.remove('fa-chevron-down');
                toggleIcon?.classList.add('fa-chevron-up');
            }
        }

        async _sendItemToChat(item) {
            // 채팅 출력 서브시스템은 scripts/sheets/actor-chat.js(공유 모듈)로 이전됨.
            // 외부(combat-ui/action-ui/macro)가 sheet._sendItemToChat 으로 호출하므로 위임자만 남긴다.
            return window.DX3rdActorChat.sendItemToChat(this.actor, item);
        }

        async _onUsedStateChange(event, target = event.currentTarget) {
            event.preventDefault();

            const input = target;
            const itemId = input?.closest('.item')?.dataset?.itemId;

            if (!itemId) {
                return;
            }

            // disabled 상태가 아닌 경우에만 업데이트
            if (!input.disabled) {
                try {
                    await window.DX3rdActorSheetData.updateOwnedItemUsedState(this.actor, itemId, input.value);
                } catch (err) {
                    console.error("DX3rd | ActorSheet _onUsedStateChange - update failed", err);
                    ui.notifications.error(`사용횟수 업데이트 실패: ${err.message}`);
                }
            }
        }

        async _onActiveChange(event, target = event.currentTarget) {
            event.preventDefault();

            const checkbox = target;
            const itemId = checkbox?.closest('.item')?.dataset?.itemId;

            if (!itemId) {
                return;
            }

            try {
                await window.DX3rdActorSheetData.updateOwnedItemActiveState(this.actor, itemId, checkbox.checked);
            } catch (err) {
                console.error("DX3rd | ActorSheet _onActiveChange - update failed", err);
                ui.notifications.error(`활성화 상태 업데이트 실패: ${err.message}`);
            }
        }

        async _onEquipmentChange(event, target = event.currentTarget) {
            event.preventDefault();

            const checkbox = target;
            const itemId = checkbox?.closest('.item')?.dataset?.itemId;

            if (!itemId) {
                return;
            }

            try {
                await window.DX3rdActorSheetData.updateOwnedItemEquipmentState(this.actor, itemId, checkbox.checked);
            } catch (err) {
                console.error("DX3rd | ActorSheet _onEquipmentChange - update failed", err);
                ui.notifications.error(`장비 상태 업데이트 실패: ${err.message}`);
            }
        }

        async _onItemCreate(event, target = event.currentTarget) {
            event.preventDefault();
            
            // OWNER 권한 체크
            if (!this._hasOwnerPermission()) {
                ui.notifications.warn(game.i18n.localize("DX3rd.NoPermission"));
                return;
            }
            
            const button = target;
            const type = button?.dataset?.type || "item";
            const effectType = button?.dataset?.effectType;
            const roisType = button?.dataset?.roisType;

            await window.DX3rdActorSheetData.createOwnedItem(this.actor, { type, effectType, roisType });
        }

        async _onToggleSyndrome(event, matched) {
            const input = matched || event.currentTarget;
            // name 예: system.attributes.syndrome.<itemId>
            const parts = String(input.name).split('.');
            const itemId = parts[parts.length - 1];
            if (!itemId) return;

            // mousedown에서는 현재 상태의 반대값이 될 예정
            const willBeChecked = !input.checked;
            const result = window.DX3rdActorSheetData.getSyndromeSelectionUpdate(this.actor, itemId, willBeChecked);

            if (!result.ok && result.reason === "optionalLimit") {
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

            if (result.changed) {
                try {
                    await window.DX3rdActorSheetData.updateActorSyndromeSelection(this.actor, itemId, willBeChecked);
                    this.render(false);
                } catch (e) {
                    console.error('DX3rd | ActorSheet syndrome toggle failed', e);
                }
            }
        }

        async _onSyndromeClick(event, matched) {
            const input = matched || event.currentTarget;
            const parts = String(input.name).split('.');
            const itemId = parts[parts.length - 1];
            if (!itemId) return;

            const checked = input.checked;
            const result = window.DX3rdActorSheetData.getSyndromeSelectionUpdate(this.actor, itemId, checked);

            // 3번째 체크 시도 차단
            if (!result.ok && result.reason === "optionalLimit") {
                event.preventDefault();
                event.stopPropagation();
                event.stopImmediatePropagation();

                input.checked = false;
                input.setAttribute('checked', false);
                input.removeAttribute('checked');

                ui.notifications.info("You cannot check Optional Syndrome.");
                return false;
            }

            if (result.changed) {
                try {
                    await window.DX3rdActorSheetData.updateActorSyndromeSelection(this.actor, itemId, checked);
                    this.render(false);
                } catch (e) {
                    console.error('DX3rd | ActorSheet syndrome click failed', e);
                }
            }
        }

        async _onDragOver(event) {
            event.preventDefault();
        }

        _onDragStart(event, matched) {
            const li = matched || event.currentTarget;
            const item = this.actor.items.get(li?.dataset?.itemId);
            if (!item) return;

            // 드래그 데이터 구성은 공유 헬퍼로 위임 (AppV2 액터 시트와 동일한 경로)
            const dragData = window.DX3rdActorSheetData.buildItemDragData(this.actor, item);
            if (!dragData) return;

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
                const dataText = dataTransfer.getData('text/plain');
                if (!dataText) return;

                const data = JSON.parse(dataText);
                // 정렬/외부 드롭 처리는 공유 헬퍼로 위임 (AppV2 액터 시트와 동일한 경로)
                await window.DX3rdActorSheetData.handleActorItemDrop(this.actor, data, event.target);
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

        async _onRemoveApplied(event, target = event.currentTarget) {
            event.preventDefault();
            const itemId = target?.closest('.item')?.dataset?.itemId;

            if (!itemId) {
                return;
            }

            if (!window.DX3rdActorAppliedDialogs) {
                ui.notifications.error('DX3rdActorAppliedDialogs를 찾을 수 없습니다.');
                return;
            }

            await window.DX3rdActorAppliedDialogs.remove(this.actor, itemId);
        }

        async _onShowApplied(event, target = event.currentTarget) {
            event.preventDefault();
            const itemId = target?.closest('.item')?.dataset?.itemId;

            if (!itemId) {
                return;
            }

            if (!window.DX3rdActorAppliedDialogs) {
                ui.notifications.error('DX3rdActorAppliedDialogs를 찾을 수 없습니다.');
                return;
            }

            await window.DX3rdActorAppliedDialogs.open(this.actor, itemId);
        }

        async _onEditApplied(event, target = event.currentTarget) {
            event.preventDefault();
            const itemId = target?.closest('.item')?.dataset?.itemId;

            if (!itemId) {
                return;
            }

            if (!window.DX3rdActorAppliedDialogs?.edit) {
                ui.notifications.error('DX3rdActorAppliedDialogs를 찾을 수 없습니다.');
                return;
            }

            await window.DX3rdActorAppliedDialogs.edit(this.actor, itemId);
        }

        async _onAbilityNameClick(event, target = event.currentTarget) {
            event.preventDefault();
            event.stopPropagation();
            const abilityId = target?.closest('[data-ability-id]')?.dataset?.abilityId;
            if (!abilityId) return;

            // 권한 체크
            if (!this.actor.isOwner && !game.user.isGM) {
                ui.notifications.warn('이 액터에 대한 권한이 없습니다.');
                return;
            }

            // 공유 헬퍼로 위임 (AppV2 액터 시트와 동일한 경로)
            window.DX3rdActorSheetData.showStatRoll(this.actor, 'ability', abilityId);
        }

        async _onSkillNameClick(event, target = event.currentTarget) {
            event.preventDefault();
            event.stopPropagation();
            const skillId = target?.closest('[data-skill-id]')?.dataset?.skillId;
            if (!skillId) return;

            // 권한 체크
            if (!this.actor.isOwner && !game.user.isGM) {
                ui.notifications.warn('이 액터에 대한 권한이 없습니다.');
                return;
            }

            // 공유 헬퍼로 위임 (AppV2 액터 시트와 동일한 경로)
            window.DX3rdActorSheetData.showStatRoll(this.actor, 'skill', skillId);
        }

        // 외부 호출자(combat-ui, action-ui)가 sheet._openComboBuilder를 콜백으로 사용하므로 유지.
        _openComboBuilder(targetType, targetId) {
            return window.DX3rdActorSheetData.openComboBuilder(this.actor, targetType, targetId);
        }

        _onAbilityHover(event, target = event.currentTarget) {
            const abilityId = target?.closest('[data-ability-id]')?.dataset?.abilityId;
            if (!abilityId) return;

            const ability = this.actor.system.attributes[abilityId];
            if (!ability) return;

            this._updateDiceInfo(ability);
        }

        _onAbilityHoverOut(event, target = event.currentTarget) {
            if (target?.contains?.(event.relatedTarget)) return;
            // 원래 값으로 되돌리기 (현재 선택된 판정 타입 기준)
            this._resetDiceInfo();
        }

        _onSkillHover(event, target = event.currentTarget) {
            const skillId = target?.closest('[data-skill-id]')?.dataset?.skillId;
            if (!skillId) return;

            const skill = this.actor.system.attributes.skills[skillId];
            if (!skill) return;

            this._updateDiceInfo(skill);
        }

        _onSkillHoverOut(event, target = event.currentTarget) {
            if (target?.contains?.(event.relatedTarget)) return;
            // 원래 값으로 되돌리기
            this._resetDiceInfo();
        }

        _updateDiceInfo(stat) {
            const diceView = this.actor.system.attributes.dice?.view || 'major';
            const rollType = diceView; // 'major', 'reaction', 'dodge'

            const root = compat.unwrapRoot(this.element);
            const diceInput = root?.querySelector?.('#dice');
            const criticalInput = root?.querySelector?.('#critical');
            const addInput = root?.querySelector?.('#add');
            if (!diceInput || !criticalInput || !addInput) return;

            if (stat[rollType]) {
                diceInput.value = stat[rollType].dice || 0;
                criticalInput.value = stat[rollType].critical || (game.settings.get("dx3rd-emanim", "defaultCritical") || 10);
                addInput.value = stat[rollType].add || 0;
            } else {
                // 판정 타입별 데이터가 없으면 기본값 사용
                diceInput.value = stat.dice || 0;
                criticalInput.value = stat.critical || (game.settings.get("dx3rd-emanim", "defaultCritical") || 10);
                addInput.value = stat.add || 0;
            }
        }

        _resetDiceInfo() {
            // dice-info를 기본 값으로 복원 (0, defaultCritical, 0)
            const root = compat.unwrapRoot(this.element);
            const diceInput = root?.querySelector?.('#dice');
            const criticalInput = root?.querySelector?.('#critical');
            const addInput = root?.querySelector?.('#add');
            if (!diceInput || !criticalInput || !addInput) return;

            diceInput.value = 0;
            criticalInput.value = game.settings.get("dx3rd-emanim", "defaultCritical") || 10;
            addInput.value = 0;
        }

        async _onTitusClick(event, target = event.currentTarget) {
            event.preventDefault();
            const item = this.actor.items.get(target?.closest('.item')?.dataset?.itemId);
            if (!item) return;

            // 로이스 Titus화는 공유 헬퍼로 위임 (AppV2 액터 시트와 동일한 경로)
            await window.DX3rdActorSheetData.useTitus(this.actor, item);
        }

        async _onSublimationClick(event, target = event.currentTarget) {
            event.preventDefault();
            const itemId = target?.closest('.item')?.dataset?.itemId;

            if (!itemId) {
                return;
            }

            const item = this.actor.items.get(itemId);
            if (!item) {
                return;
            }

            if (window.DX3rdActorRoisDialogs) {
                await window.DX3rdActorRoisDialogs.useSublimation(this.actor, item);
                return;
            }
            ui.notifications.error('DX3rdActorRoisDialogs를 찾을 수 없습니다.');
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
        label: 'DX3rd.SheetV1',
        types: ['character', 'enemy'],
        makeDefault: true
    });
})();
