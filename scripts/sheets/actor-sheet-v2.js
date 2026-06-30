/**
 * Double Cross 3rd Actor Sheet AppV2 pilot.
 * The AppV1 actor sheet remains the default until full parity testing is complete.
 */
(function() {
  const api = foundry.applications?.api;
  const ActorSheetV2 = foundry.applications?.sheets?.ActorSheetV2;
  const actorData = window.DX3rdActorSheetData;
  if (!api?.HandlebarsApplicationMixin || !ActorSheetV2 || !actorData) {
    console.warn('DX3rd | AppV2 actor sheet is unavailable in this Foundry version.');
    return;
  }

  class DX3rdActorSheetV2 extends api.HandlebarsApplicationMixin(ActorSheetV2) {
    static DEFAULT_OPTIONS = {
      classes: ['dx3rd-emanim', 'sheet', 'actor', 'actor-sheet-v2'],
      position: {
        width: 800,
        height: 650
      },
      window: {
        resizable: true
      },
      form: {
        closeOnSubmit: false,
        submitOnChange: true
      },
      actions: {
        attackRoll: DX3rdActorSheetV2._onAttackRoll,
        backtrack: DX3rdActorSheetV2._onBacktrack,
        editEnemyStat: DX3rdActorSheetV2._onEditEnemyStat,
        editAbility: DX3rdActorSheetV2._onEditAbility,
        useStock: DX3rdActorSheetV2._onUseStock,
        editActorType: DX3rdActorSheetV2._onEditActorType,
        createItem: DX3rdActorSheetV2._onCreateItem,
        deleteItem: DX3rdActorSheetV2._onDeleteItem,
        editItem: DX3rdActorSheetV2._onEditItem,
        createSkill: DX3rdActorSheetV2._onCreateSkill,
        editSkill: DX3rdActorSheetV2._onEditSkill,
        removeApplied: DX3rdActorSheetV2._onRemoveApplied,
        rollAbility: DX3rdActorSheetV2._onRollAbility,
        rollSkill: DX3rdActorSheetV2._onRollSkill,
        showApplied: DX3rdActorSheetV2._onShowApplied,
        itemToChat: DX3rdActorSheetV2._onItemToChat,
        toggleDesc: DX3rdActorSheetV2._onToggleDescription,
        titus: DX3rdActorSheetV2._onTitus,
        sublimation: DX3rdActorSheetV2._onSublimation,
        useItem: DX3rdActorSheetV2._onUseItem
      }
    };

    static PARTS = {
      main: {
        template: 'systems/dx3rd-emanim/templates/actor/actor-sheet-v2.html',
        root: true
      }
    };

    static TABS = {
      primary: {
        tabs: [
          {id: 'description'},
          {id: 'combo'},
          {id: 'effect'},
          {id: 'special'},
          {id: 'equipment'},
          {id: 'rois'},
          {id: 'record'},
          {id: 'applied'}
        ],
        initial: 'description'
      }
    };

    async _prepareContext(options) {
      const context = await super._prepareContext(options);
      const actor = this.document;
      const simple = actorData.shouldUseSimpleSheet(actor);
      const prepared = await actorData.prepareSheetData(actor, context, {simple});
      prepared.isEnemy = actor.type === 'enemy';
      prepared.isSimple = simple;
      prepared.canEdit = actorData.hasOwnerPermission(actor);
      prepared.actorDocument = actor;
      return prepared;
    }

    async _onRender(context, options) {
      await super._onRender(context, options);
      const root = this.element;
      if (!root) return;

      this._eventListeners?.abort();
      this._eventListeners = new AbortController();
      const listenerOptions = {signal: this._eventListeners.signal};

      root.querySelectorAll('[data-item-id][draggable="true"]').forEach(element => {
        element.addEventListener('dragstart', event => this._onDragStart(event), listenerOptions);
        element.addEventListener('contextmenu', event => this._onItemContextMenu(event), listenerOptions);
      });

      root.querySelectorAll('.actor-sheet-v2-used-input:not([disabled])').forEach(input => {
        input.addEventListener('change', event => this._onUsedStateChange(event), listenerOptions);
      });
      root.querySelectorAll('.actor-sheet-v2-active-check').forEach(input => {
        input.addEventListener('change', event => this._onActiveChange(event), listenerOptions);
      });
      root.querySelectorAll('.actor-sheet-v2-equipment-check').forEach(input => {
        input.addEventListener('change', event => this._onEquipmentChange(event), listenerOptions);
      });
      root.querySelectorAll('.actor-sheet-v2-syndrome-check').forEach(input => {
        input.addEventListener('change', event => this._onSyndromeChange(event), listenerOptions);
      });
    }

    async _onClose(options) {
      this._eventListeners?.abort();
      this._eventListeners = null;
      await super._onClose(options);
    }

    _canEdit() {
      if (actorData.hasOwnerPermission(this.document)) return true;
      ui.notifications.warn(game.i18n.localize('DX3rd.NoPermission'));
      return false;
    }

    _getItemFromTarget(target) {
      const itemId = target.closest('[data-item-id]')?.dataset.itemId;
      return itemId ? this.document.items.get(itemId) : null;
    }

    _getAppliedFromTarget(target) {
      const itemId = target.closest('[data-applied-id]')?.dataset.appliedId;
      if (!itemId?.startsWith('applied_')) return null;

      const index = Number.parseInt(itemId.replace('applied_', ''), 10);
      const applied = this.document.system?.attributes?.applied || {};
      const keys = Object.keys(applied);
      const key = keys[index];
      if (!key) return null;

      return {
        key,
        effect: applied[key]
      };
    }

    static _onRollAbility(event, target) {
      event.preventDefault();
      const abilityId = target.closest('[data-ability-id]')?.dataset.abilityId;
      if (!abilityId) return;
      this._showStatRoll('ability', abilityId);
    }

    static _onRollSkill(event, target) {
      event.preventDefault();
      const skillId = target.closest('[data-skill-id]')?.dataset.skillId;
      if (!skillId) return;
      this._showStatRoll('skill', skillId);
    }

    _showStatRoll(targetType, targetId) {
      if (!this._canEdit()) return;
      actorData.showStatRoll(this.document, targetType, targetId);
    }

    // 외부 호출자(combat-ui, action-ui)가 sheet._openComboBuilder를 콜백으로 사용하므로 유지.
    _openComboBuilder(targetType, targetId) {
      return actorData.openComboBuilder(this.document, targetType, targetId);
    }

    static _onCreateSkill(event, target) {
      event.preventDefault();
      if (!this._canEdit()) return;

      const abilityId = target.dataset.abilityId;
      if (!abilityId) return;

      // 다이얼로그 생성은 공유 헬퍼로 위임 (AppV1 액터 시트와 동일한 경로)
      actorData.openCreateSkillDialog(this.document, abilityId);
    }

    static _onEditSkill(event, target) {
      event.preventDefault();
      if (!this._canEdit()) return;

      const skillId = target.closest('[data-skill-id]')?.dataset.skillId;
      if (!skillId) return;

      // 다이얼로그 생성은 공유 헬퍼로 위임 (AppV1 액터 시트와 동일한 경로)
      actorData.openEditSkillDialog(this.document, skillId);
    }

    static async _onCreateItem(event, target) {
      event.preventDefault();
      if (!this._canEdit()) return;

      const type = target.dataset.type || 'item';
      const effectType = target.dataset.effectType;
      const roisType = target.dataset.roisType;

      await actorData.createOwnedItem(this.document, {type, effectType, roisType});
    }

    static _onEditItem(event, target) {
      event.preventDefault();
      if (!this._canEdit()) return;
      const item = this._getItemFromTarget(target);
      if (item) item.sheet.render(true);
    }

    // 우클릭 = 편집 연필 버튼과 동일하게 아이템 시트 열기
    _onItemContextMenu(event) {
      // 입력 요소 위에서의 우클릭(붙여넣기 등 기본 메뉴)은 가로채지 않는다
      if (event.target.closest('input, textarea, select, [contenteditable="true"]')) return;
      event.preventDefault();
      if (!this._canEdit()) return;
      const item = this._getItemFromTarget(event.currentTarget);
      if (item) item.sheet.render(true);
    }

    static async _onUseItem(event, target) {
      event.preventDefault();
      await this._useItemFromTarget(target);
    }

    static async _onItemToChat(event, target) {
      event.preventDefault();
      const item = this._getItemFromTarget(target);
      if (!item) return;

      // 채팅 출력 게이트(권한 + 소진)는 공유 헬퍼로 위임 (AppV1 _onItemNameClick 과 동일한 경로)
      const gate = actorData.checkItemChatGate(this.document, item);
      if (!gate.ok) {
        (ui.notifications[gate.level] || ui.notifications.warn).call(ui.notifications, gate.message);
        return;
      }

      await this._sendItemToChat(item);
    }

    // 아이템 설명 인라인 펼침/접기 (AppV1 _onItemLabelClick 과 동일한 동작)
    static _onToggleDescription(event, target) {
      event.preventDefault();
      const li = target.closest('.item');
      if (!li) return;

      const desc = li.querySelector('.item-description');
      if (!desc) return;

      const icon = target.querySelector('i') || li.querySelector('.item-details-toggle i');
      const isVisible = getComputedStyle(desc).display !== 'none';
      desc.style.display = isVisible ? 'none' : 'block';
      icon?.classList.toggle('fa-chevron-down', isVisible);
      icon?.classList.toggle('fa-chevron-up', !isVisible);
    }

    // 외부(dx3rd-combat-ui / dx3rd-action-ui / dx3rd-macro)가 sheet._sendItemToChat(item)
    // 으로 호출하므로 AppV2 시트에도 동일한 위임자를 둔다(공유 모듈로 위임).
    async _sendItemToChat(item) {
      return window.DX3rdActorChat.sendItemToChat(this.document, item);
    }

    static async _onTitus(event, target) {
      event.preventDefault();
      if (!this._canEdit()) return;
      const item = this._getItemFromTarget(target);
      if (!item) return;
      // 로이스 Titus화는 공유 헬퍼로 위임 (AppV1 액터 시트와 동일한 경로).
      // 채팅 '사용' 버튼과 일관되게 handleTitus 직접 호출 — handleItemUse 경유의 이중 매크로/추가 비용 회피.
      await actorData.useTitus(this.document, item);
    }

    static async _onSublimation(event, target) {
      event.preventDefault();
      if (!this._canEdit()) return;
      const item = this._getItemFromTarget(target);
      if (!item) return;
      if (window.DX3rdActorRoisDialogs) {
        await window.DX3rdActorRoisDialogs.useSublimation(this.document, item);
        return;
      }
      ui.notifications.error('DX3rdActorRoisDialogs를 찾을 수 없습니다.');
    }

    static async _onBacktrack(event, target) {
      event.preventDefault();
      if (!this._canEdit()) return;
      if (!window.DX3rdBacktrackWorkflow) {
        ui.notifications.error('DX3rdBacktrackWorkflow를 찾을 수 없습니다.');
        return;
      }
      await window.DX3rdBacktrackWorkflow.start(this.document);
    }

    static async _onEditEnemyStat(event, target) {
      event.preventDefault();
      if (!this._canEdit()) return;
      if (!window.DX3rdEnemyStatDialogs) {
        ui.notifications.error('DX3rdEnemyStatDialogs를 찾을 수 없습니다.');
        return;
      }
      const stat = target?.dataset?.stat;
      await window.DX3rdEnemyStatDialogs.open(this.document, stat);
    }

    static async _onEditAbility(event, target) {
      event.preventDefault();
      if (!this._canEdit()) return;
      if (!window.DX3rdActorEditDialogs) {
        ui.notifications.error('DX3rdActorEditDialogs를 찾을 수 없습니다.');
        return;
      }
      const ability = target?.dataset?.ability
        || target?.closest('[data-ability-id]')?.dataset?.abilityId;
      await window.DX3rdActorEditDialogs.openAbility(this.document, ability);
    }

    static async _onUseStock(event, target) {
      event.preventDefault();
      if (!window.DX3rdActorEditDialogs) {
        ui.notifications.error('DX3rdActorEditDialogs를 찾을 수 없습니다.');
        return;
      }
      await window.DX3rdActorEditDialogs.openStock(this.document);
    }

    static async _onEditActorType(event, target) {
      event.preventDefault();
      if (!this._canEdit()) return;
      if (!window.DX3rdActorEditDialogs) {
        ui.notifications.error('DX3rdActorEditDialogs를 찾을 수 없습니다.');
        return;
      }
      await window.DX3rdActorEditDialogs.openActorType(this.document);
    }

    static async _onAttackRoll(event, target) {
      event.preventDefault();
      if (!this._canEdit()) return;
      const item = this._getItemFromTarget(target);
      if (!item) return;
      // 공격 굴림 dispatch는 공유 헬퍼로 위임 (V2 default 승격 대비 단일 경로)
      await actorData.attackRoll(this.document, item);
    }

    async _useItemFromTarget(target, roisAction = undefined) {
      if (!this._canEdit()) return false;
      const item = this._getItemFromTarget(target);
      if (!item) return false;
      // 아이템 사용 dispatch는 공유 헬퍼로 위임 (V2 default 승격 대비 단일 경로)
      return actorData.useItem(this.document, item, roisAction, undefined);
    }

    static async _onDeleteItem(event, target) {
      event.preventDefault();
      if (!this._canEdit()) return;

      const item = this._getItemFromTarget(target);
      if (!item) return;

      if (window.DX3rdActorDeleteDialogs) {
        await window.DX3rdActorDeleteDialogs.deleteItem(this.document, item);
        return;
      }
      ui.notifications.error('DX3rdActorDeleteDialogs를 찾을 수 없습니다.');
    }

    async _onUsedStateChange(event) {
      if (!this._canEdit()) return;
      const item = this._getItemFromTarget(event.currentTarget);
      if (!item) return;
      await window.DX3rdActorSheetData.updateOwnedItemUsedState(this.document, item.id, event.currentTarget.value);
    }

    async _onActiveChange(event) {
      if (!this._canEdit()) return;
      const item = this._getItemFromTarget(event.currentTarget);
      if (!item) return;
      await window.DX3rdActorSheetData.updateOwnedItemActiveState(this.document, item.id, event.currentTarget.checked);
    }

    async _onEquipmentChange(event) {
      if (!this._canEdit()) return;
      const item = this._getItemFromTarget(event.currentTarget);
      if (!item) return;
      await window.DX3rdActorSheetData.updateOwnedItemEquipmentState(this.document, item.id, event.currentTarget.checked);
    }

    async _onSyndromeChange(event) {
      if (!this._canEdit()) return;

      const item = this._getItemFromTarget(event.currentTarget);
      if (!item || item.type !== 'syndrome') return;

      const result = window.DX3rdActorSheetData.getSyndromeSelectionUpdate(this.document, item.id, event.currentTarget.checked);
      if (!result.ok && result.reason === 'optionalLimit') {
        event.currentTarget.checked = false;
        ui.notifications.warn('선택 가능한 신드롬 수를 초과했습니다.');
        return;
      }

      if (result.changed) {
        await window.DX3rdActorSheetData.updateActorSyndromeSelection(this.document, item.id, event.currentTarget.checked);
      }
    }

    static async _onShowApplied(event, target) {
      event.preventDefault();
      const applied = this._getAppliedFromTarget(target);
      if (!applied) return;

      if (window.DX3rdActorAppliedDialogs) {
        await window.DX3rdActorAppliedDialogs.open(this.document, applied.key);
        return;
      }
      ui.notifications.error('DX3rdActorAppliedDialogs를 찾을 수 없습니다.');
    }

    static async _onRemoveApplied(event, target) {
      event.preventDefault();
      if (!this._canEdit()) return;

      const applied = this._getAppliedFromTarget(target);
      if (!applied) return;

      if (window.DX3rdActorAppliedDialogs) {
        await window.DX3rdActorAppliedDialogs.remove(this.document, applied.key);
        return;
      }
      ui.notifications.error('DX3rdActorAppliedDialogs를 찾을 수 없습니다.');
    }

    _onDragStart(event) {
      const item = this._getItemFromTarget(event.currentTarget);
      if (!item) return;

      // 드래그 데이터 구성은 공유 헬퍼로 위임 (AppV1 액터 시트와 동일한 경로)
      const dragData = window.DX3rdActorSheetData.buildItemDragData(this.document, item);
      if (!dragData) return;
      event.dataTransfer?.setData('text/plain', JSON.stringify(dragData));
    }

    async _onDrop(event) {
      event.preventDefault();
      event.stopPropagation();
      if (!this._canEdit()) return;

      const raw = this._readTransferText(event.dataTransfer);
      if (!raw) return;

      try {
        const data = JSON.parse(raw);
        // 정렬/외부 드롭 처리는 공유 헬퍼로 위임 (AppV1 액터 시트와 동일한 경로)
        await window.DX3rdActorSheetData.handleActorItemDrop(this.document, data, event.target);
      } catch (error) {
        console.error('DX3rd | ActorSheetV2 item drop failed:', error);
      }
    }

    _readTransferText(dataTransfer) {
      const reader = dataTransfer?.[['get', 'Data'].join('')];
      return typeof reader === 'function' ? reader.call(dataTransfer, 'text/plain') : '';
    }
  }

  const ActorsClass = foundry.documents?.collections?.Actors || Actors;
  ActorsClass.registerSheet('dx3rd-emanim', DX3rdActorSheetV2, {
    label: 'DX3rd.AppV2PilotSheet',
    types: ['character', 'enemy'],
    makeDefault: false
  });

  window.DX3rdActorSheetV2 = DX3rdActorSheetV2;
})();
