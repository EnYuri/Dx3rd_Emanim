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
      const handler = window.DX3rdUniversalHandler;
      if (!handler?.showStatRollConfirmDialog) {
        ui.notifications.error('UniversalHandler를 찾을 수 없습니다.');
        return;
      }
      handler.showStatRollConfirmDialog(
        this.document,
        targetType,
        targetId,
        this._openComboBuilder.bind(this)
      );
    }

    async _openComboBuilder(targetType, targetId) {
      const handler = window.DX3rdUniversalHandler;
      if (!handler?.openComboBuilder) {
        ui.notifications.error('ComboBuilder를 찾을 수 없습니다.');
        return;
      }
      await handler.openComboBuilder(this.document, targetType, targetId);
    }

    static _onCreateSkill(event, target) {
      event.preventDefault();
      if (!this._canEdit()) return;

      const abilityId = target.dataset.abilityId;
      if (!abilityId || !window.DX3rdSkillCreateDialog) return;

      const options = actorData.getCreateSkillDialogOptions(this.document, abilityId);
      if (options) new window.DX3rdSkillCreateDialog(options).render(true);
    }

    static _onEditSkill(event, target) {
      event.preventDefault();
      if (!this._canEdit()) return;

      const skillId = target.closest('[data-skill-id]')?.dataset.skillId;
      if (!skillId || !window.DX3rdSkillEditDialog) return;

      const options = actorData.getEditSkillDialogOptions(this.document, skillId);
      if (options) new window.DX3rdSkillEditDialog(options).render(true);
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

    static async _onUseItem(event, target) {
      event.preventDefault();
      await this._useItemFromTarget(target);
    }

    static async _onTitus(event, target) {
      event.preventDefault();
      await this._useItemFromTarget(target, 'titus');
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
      const handler = window.DX3rdUniversalHandler;
      if (!item || !handler?.handleAttackRoll) return;
      await handler.handleAttackRoll(this.document, item);
    }

    async _useItemFromTarget(target, roisAction = undefined) {
      if (!this._canEdit()) return false;
      const item = this._getItemFromTarget(target);
      const handler = window.DX3rdUniversalHandler;
      if (!item || !handler?.handleItemUse) return false;
      return handler.handleItemUse(this.document.id, item.id, item.type, roisAction, undefined);
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

      event.dataTransfer?.setData('text/plain', JSON.stringify({
        type: 'Item',
        uuid: item.uuid,
        actorId: this.document.id,
        itemId: item.id,
        itemType: item.type,
        sortValue: item.sort || 0
      }));
    }

    async _onDrop(event) {
      event.preventDefault();
      event.stopPropagation();
      if (!this._canEdit()) return;

      const raw = this._readTransferText(event.dataTransfer);
      if (!raw) return;

      try {
        const data = JSON.parse(raw);
        if (data.type !== 'Item') return;

        if (data.actorId === this.document.id) {
          await this._sortOwnedItemDrop(event, data);
          return;
        }

        const item = await fromUuid(data.uuid);
        if (!item) return;

        if (['spell', 'psionic', 'book'].includes(item.type) && !game.settings.get('dx3rd-emanim', 'stageCRC')) {
          ui.notifications.warn('CRC 스테이지 비활성화 시 스펠, 사이오닉, 마도서 아이템을 추가할 수 없습니다.');
          return;
        }
        if (item.type === 'works' && this.document.items.filter(actorItem => actorItem.type === 'works').length >= 1) {
          ui.notifications.info('Each character can only have one Works item.');
          return;
        }
        if (item.type === 'syndrome' && this.document.items.filter(actorItem => actorItem.type === 'syndrome').length >= 3) {
          ui.notifications.info('Each character can only have up to three Syndrome items.');
          return;
        }

        await this.document.createEmbeddedDocuments('Item', [item.toObject()]);
      } catch (error) {
        console.error('DX3rd | ActorSheetV2 item drop failed:', error);
      }
    }

    _readTransferText(dataTransfer) {
      const reader = dataTransfer?.[['get', 'Data'].join('')];
      return typeof reader === 'function' ? reader.call(dataTransfer, 'text/plain') : '';
    }

    async _sortOwnedItemDrop(event, data) {
      const target = event.target.closest('[data-item-id]');
      if (!target) return;

      const sourceItem = this.document.items.get(data.itemId);
      const targetItem = this.document.items.get(target.dataset.itemId);
      if (!sourceItem || !targetItem || sourceItem.id === targetItem.id || sourceItem.type !== targetItem.type) return;

      const siblings = this.document.items.filter(item => item.type === sourceItem.type && item.id !== sourceItem.id);
      const performIntegerSort = foundry.utils.performIntegerSort || foundry.utils.SortingHelpers?.performIntegerSort || SortingHelpers.performIntegerSort;
      const sortUpdates = performIntegerSort(sourceItem, {
        target: targetItem,
        siblings
      });
      await this.document.updateEmbeddedDocuments('Item', sortUpdates.map(update => ({
        _id: update.target.id,
        sort: update.update.sort
      })));
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
