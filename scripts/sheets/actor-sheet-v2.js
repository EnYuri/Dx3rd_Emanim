/**
 * Double Cross 3rd Actor Sheet AppV2 pilot.
 * The AppV1 actor sheet remains the default until full parity testing is complete.
 */
(function() {
  const api = foundry.applications?.api;
  const ActorSheetV2 = foundry.applications?.sheets?.ActorSheetV2;
  const actorData = window.DX3rdActorSheetData;
  const DialogV2 = api?.DialogV2;
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

      const baseAbility = this.document.system.attributes[abilityId];
      const dice = baseAbility ? baseAbility.dice || 0 : 0;
      new window.DX3rdSkillCreateDialog({
        title: game.i18n.localize('DX3rd.CreateSkill'),
        skill: {
          key: '',
          name: '',
          point: 0,
          bonus: 0,
          extra: 0,
          works: 0,
          base: abilityId,
          dice,
          total: 0
        },
        actorId: this.document.id
      }).render(true);
    }

    static _onEditSkill(event, target) {
      event.preventDefault();
      if (!this._canEdit()) return;

      const skillId = target.closest('[data-skill-id]')?.dataset.skillId;
      if (!skillId || !window.DX3rdSkillEditDialog) return;

      const skill = this.document.system.attributes.skills[skillId];
      if (!skill) return;

      const baseAbility = this.document.system.attributes[skill.base];
      const dice = baseAbility ? baseAbility.dice || 0 : 0;
      new window.DX3rdSkillEditDialog({
        title: game.i18n.localize('DX3rd.EditSkill'),
        width: 900,
        skill: {
          key: skillId,
          name: skill.name || '',
          point: skill.point || 0,
          bonus: skill.bonus || 0,
          extra: skill.extra || 0,
          works: skill.works || 0,
          base: skill.base,
          dice,
          total: skill.total || 0,
          delete: skill.delete
        },
        actorId: this.document.id
      }).render(true);
    }

    static async _onCreateItem(event, target) {
      event.preventDefault();
      if (!this._canEdit()) return;

      const type = target.dataset.type || 'item';
      const effectType = target.dataset.effectType;
      const roisType = target.dataset.roisType;

      if (!game.settings.get('dx3rd-emanim', 'stageCRC') && ['spell', 'psionic', 'book'].includes(type)) {
        ui.notifications.warn('CRC 스테이지 비활성화 시 스펠, 사이오닉, 마도서 아이템을 생성할 수 없습니다.');
        return;
      }
      if (type === 'works' && this.document.items.filter(item => item.type === 'works').length >= 1) {
        ui.notifications.info('Each character can only have one Works item.');
        return;
      }
      if (type === 'syndrome' && this.document.items.filter(item => item.type === 'syndrome').length >= 3) {
        ui.notifications.info('Each character can only have up to three Syndrome items.');
        return;
      }

      const key = `DX3rd.${type.charAt(0).toUpperCase()}${type.slice(1)}`;
      const typeLabel = game.i18n.localize(key);
      const itemData = {
        name: `New ${typeLabel !== key ? typeLabel : type}`,
        type,
        system: {}
      };
      if (effectType) itemData.system.type = effectType;
      if (roisType) itemData.system.type = roisType;
      if (type === 'effect') itemData.system.level = {init: 1, max: 1};

      await this.document.createEmbeddedDocuments('Item', [itemData]);
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
      await this._useItemFromTarget(target, 'sublimation');
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

      const confirmed = await DX3rdActorSheetV2._confirm({
        title: game.i18n.localize('DX3rd.DeleteItem'),
        content: game.i18n.format('DX3rd.ConfirmDeleteItem', {name: item.name})
      });
      if (confirmed) await this.document.deleteEmbeddedDocuments('Item', [item.id]);
    }

    static async _confirm(options) {
      if (!DialogV2) {
        ui.notifications.warn(options.content);
        return false;
      }
      return DialogV2.confirm(options);
    }

    async _onUsedStateChange(event) {
      if (!this._canEdit()) return;
      const item = this._getItemFromTarget(event.currentTarget);
      if (!item) return;
      const state = Number.parseInt(event.currentTarget.value, 10) || 0;
      await item.update({'system.used.state': state});
    }

    async _onActiveChange(event) {
      if (!this._canEdit()) return;
      const item = this._getItemFromTarget(event.currentTarget);
      if (!item) return;
      await item.update({'system.active.state': event.currentTarget.checked});
    }

    async _onEquipmentChange(event) {
      if (!this._canEdit()) return;
      const item = this._getItemFromTarget(event.currentTarget);
      if (!item) return;

      const equipped = event.currentTarget.checked;
      if (item.type === 'vehicle' && equipped) {
        const updates = this.document.items
          .filter(other => other.type === 'vehicle' && other.id !== item.id && other.system?.equipment === true)
          .map(other => ({_id: other.id, 'system.equipment': false}));
        if (updates.length) await this.document.updateEmbeddedDocuments('Item', updates);
      }
      await item.update({'system.equipment': equipped});
    }

    async _onSyndromeChange(event) {
      if (!this._canEdit()) return;

      const item = this._getItemFromTarget(event.currentTarget);
      if (!item || item.type !== 'syndrome') return;

      const current = Array.isArray(this.document.system?.attributes?.syndrome)
        ? [...this.document.system.attributes.syndrome]
        : [];
      const selected = new Set(current);

      if (event.currentTarget.checked) selected.add(item.id);
      else selected.delete(item.id);

      const selectedSyndromeIds = [...selected].filter(id => this.document.items.get(id)?.type === 'syndrome');
      const syndromeCount = this.document.items.filter(actorItem => actorItem.type === 'syndrome').length;
      const maxSelected = syndromeCount >= 3 ? 2 : syndromeCount;

      if (selectedSyndromeIds.length > maxSelected) {
        event.currentTarget.checked = false;
        ui.notifications.warn('선택 가능한 신드롬 수를 초과했습니다.');
        return;
      }

      await this.document.update({'system.attributes.syndrome': selectedSyndromeIds});
    }

    static async _onShowApplied(event, target) {
      event.preventDefault();
      const applied = this._getAppliedFromTarget(target);
      if (!applied) return;

      const content = DX3rdActorSheetV2._renderAppliedDetails(applied.effect);
      if (DialogV2?.prompt) {
        await DialogV2.prompt({
          window: {title: applied.effect?.name || game.i18n.localize('DX3rd.Applied')},
          content,
          ok: {label: game.i18n.localize('Close')}
        });
        return;
      }
      ui.notifications.info(applied.effect?.name || game.i18n.localize('DX3rd.Applied'));
    }

    static async _onRemoveApplied(event, target) {
      event.preventDefault();
      if (!this._canEdit()) return;

      const applied = this._getAppliedFromTarget(target);
      if (!applied) return;

      const confirmed = await DX3rdActorSheetV2._confirm({
        title: game.i18n.localize('DX3rd.Applied'),
        content: `<p>${game.i18n.format('DX3rd.ConfirmDeleteItem', {name: applied.effect?.name || applied.key})}</p>`
      });
      if (!confirmed) return;

      const ForcedDeletion = foundry.data?.operators?.ForcedDeletion;
      if (ForcedDeletion) {
        await this.document.update({
          'system.attributes.applied': {[applied.key]: new ForcedDeletion()}
        });
      } else {
        await this.document.update({[`system.attributes.applied.-=${applied.key}`]: null});
      }
    }

    static _renderAppliedDetails(appliedEffect = {}) {
      const escape = value => String(value ?? '')
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#39;');
      const localize = value => window.DX3rdAttributeLocalizer?.localize(value) || value;
      const rows = [];

      if (appliedEffect.key && appliedEffect.label && appliedEffect.value !== undefined) {
        rows.push(`
          <tr>
            <td>${escape(localize(appliedEffect.key))}</td>
            <td>${escape(localize(appliedEffect.label))}</td>
            <td>${escape(appliedEffect.value)}</td>
          </tr>
        `);
      }

      for (const [attrName, attrValue] of Object.entries(appliedEffect.attributes || {})) {
        const attrData = attrValue && typeof attrValue === 'object'
          ? attrValue
          : {key: attrName, label: '-', value: attrValue};
        rows.push(`
          <tr>
            <td>${escape(localize(attrData.key || attrName))}</td>
            <td>${escape(localize(attrData.label || '-'))}</td>
            <td>${escape(attrData.value ?? '')}</td>
          </tr>
        `);
      }

      return `
        <div class="applied-effect-dialog">
          <p><strong>${escape(game.i18n.localize('DX3rd.Source'))}</strong>: ${escape(appliedEffect.source || '-')}</p>
          <p><strong>${escape(game.i18n.localize('DX3rd.DisableTiming'))}</strong>: ${escape(appliedEffect.disable || '-')}</p>
          ${appliedEffect.description ? `<div class="applied-effect-description">${appliedEffect.description}</div>` : ''}
          ${rows.length ? `<table class="applied-effect-table"><thead><tr><th>${escape(game.i18n.localize('DX3rd.Name'))}</th><th>${escape(game.i18n.localize('DX3rd.Stat'))}</th><th>${escape(game.i18n.localize('DX3rd.Value'))}</th></tr></thead><tbody>${rows.join('')}</tbody></table>` : ''}
        </div>
      `;
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
