/** Combo item AppV2 pilot sheet. */
(function() {
  const Base = window.DX3rdActiveItemSheetV2;
  const compat = window.DX3rdApplicationCompat;
  const comboData = window.DX3rdComboData;
  if (!Base || !compat || !comboData) return;

  class DX3rdComboSheetV2 extends Base {
    static DEFAULT_OPTIONS = {
      ...Base.DEFAULT_OPTIONS,
      classes: ['combo-sheet-v2'],
      actions: {
        ...Base.DEFAULT_OPTIONS.actions,
        runInstantCombo: DX3rdComboSheetV2._onRunInstantCombo,
        saveInstantCombo: DX3rdComboSheetV2._onSaveInstantCombo,
        cancelInstantCombo: DX3rdComboSheetV2._onCancelInstantCombo
      }
    };
    static PARTS = {main: {template: 'systems/dx3rd-emanim/templates/item/combo-sheet-v2.html', root: true}};
    static TABS = {primary: {
      tabs: [{id: 'description'}, {id: 'action'}, {id: 'immediate'}, {id: 'persistent'}],
      initial: 'description'
    }};

    async _prepareContext(options) {
      const context = await super._prepareContext(options);
      await comboData.prepareSheetData(context, this.item, this.item.actor);
      context.enrichedDescription ??= context.enrichedBiography || context.system.description || '';
      context.isInstantCombo = window.DX3rdIsInstantCombo?.(this.item) === true;
      context.instantComboHasAttack = context.system.attackRoll && context.system.attackRoll !== '-';
      return context;
    }

    async _onRender(context, options) {
      await super._onRender(context, options);
      this._listenerCleanups?.forEach(cleanup => cleanup());
      this._listenerCleanups = window.DX3rdWeaponTabManager.setupWeaponTabListeners(this.element, this) || [];
      const listen = (...args) => this._listenerCleanups.push(compat.on(this.element, ...args));

      // 이펙트/무기 리스트가 action 탭으로 합쳐졌으므로, 이펙트 편집/삭제는
      // 무기 항목(.weapon-item)을 제외한 콤보 항목에만 배선한다(무기 삭제는 WeaponTabManager 담당).
      listen('click', '.add-effect', event => this._addEffect(event));
      listen('click', '.combo-item:not(.weapon-item) .item-edit', (event, target) => this._editEffect(event, target));
      listen('click', '.combo-item:not(.weapon-item) .item-delete', (event, target) => this._deleteEffect(event, target));
      listen('change', 'input[name="system.weaponSelect"]', event => this._toggleWeaponSelection(event));
      listen('change', 'select[name="system.skill"]', event => this._updateBaseAttribute(event.target.value));
      listen('change', 'select[name="system.roll"]', event => this._normalizeRoll(event.target.value));
      listen('change', '.difficulty-check', event => this._toggleDifficulty(event.target.checked));
      listen('blur', '.difficulty-input', event => this._validateDifficulty(event));
      listen('input', 'input[name="system.limit"]', event => this._validateLimit(event));

      // 사정거리/대상/난이도 드롭다운 배선(선택+파라미터 → 캐노니컬 값 저장)
      window.DX3rdRangeTarget?.setupFieldListeners(this.element, this.item, {
        update: (it, upd) => it.update(upd)
      });
    }

    async _submitPendingChanges() {
      if (typeof this.submit === 'function') await this.submit({preventClose: true});
    }

    async _runInstantCombo(event) {
      event.preventDefault();
      const actor = this.item.actor;
      if (!actor) return;
      await this._submitPendingChanges();
      const handler = window.DX3rdUniversalHandler;
      if (!handler?.handleItemUse) {
        ui.notifications.error(game.i18n.localize('DX3rd.HandlerNotFound'));
        return;
      }
      await handler.handleItemUse(actor.id, this.item.id, 'combo', null, undefined);
      await this.close();
    }

    async _saveInstantCombo(event) {
      event.preventDefault();
      await this._submitPendingChanges();
      const temporaryLabel = game.i18n.localize('DX3rd.TemporaryItem');
      const defaultName = game.i18n.localize('DX3rd.Combo');
      const name = this.item.name.replace(temporaryLabel, '').trim() || defaultName;
      await this.item.update({name});
      await this.item.unsetFlag('dx3rd-emanim', 'instantCombo');
      ui.notifications.info(game.i18n.format('DX3rd.ComboSaved', {name}));
      this.render(false);
    }

    async _cancelInstantCombo(event) {
      event.preventDefault();
      await this.close();
    }

    static async _onRunInstantCombo(event) { await this._runInstantCombo(event); }
    static async _onSaveInstantCombo(event) { await this._saveInstantCombo(event); }
    static async _onCancelInstantCombo(event) { await this._cancelInstantCombo(event); }

    async close(options = {}) {
      const discard = window.DX3rdIsInstantCombo?.(this.item) === true;
      const result = await super.close(options);
      // AppV2의 내부 _onClose 호출 순서와 무관하게, 창 닫기 자체를 삭제 보장 지점으로 삼는다.
      if (discard && this.item.actor?.items?.has(this.item.id)) await this.item.delete();
      return result;
    }

    async _onClose(options) {
      this._listenerCleanups?.forEach(cleanup => cleanup());
      this._listenerCleanups = [];
      await super._onClose(options);
    }

    _effectIds() {
      return comboData.getEffectIds(this.item);
    }

    async _addEffect(event) {
      event.preventDefault();
      const id = compat.query(this.element, '#actor-effect')?.value;
      const updated = await comboData.addRegisteredEffect(this.item, this.item.actor, id);
      if (!updated) return;
      this.render(false);
    }

    _editEffect(event, target) {
      event.preventDefault();
      const id = compat.closest(target, '.item', this.element)?.dataset.itemId;
      comboData.openRegisteredEffectSheet(this.item.actor, id);
    }

    async _deleteEffect(event, target) {
      event.preventDefault();
      const id = compat.closest(target, '.item', this.element)?.dataset.itemId;
      const updated = await comboData.removeRegisteredEffect(this.item, this.item.actor, id);
      if (!updated) return;
      this.render(false);
    }

    // 무기 추가 직후: 조합 우선순위로 공격 콤보 재구성(기능/공격판정/공격력).
    async _onWeaponAdded(weaponId) {
      await comboData.applyWeaponAutoAttack(this.item, this.item.actor, weaponId);
    }

    // 무기 삭제 직후: 남은 이펙트/무기로 판정 기능/공격판정 재계산(우선순위 재적용).
    async _onWeaponRemoved(weaponId) {
      await comboData.applyWeaponRemoved(this.item, this.item.actor);
    }

    async _toggleWeaponSelection(event) {
      if (event.target.checked) await this.item.update({'system.weapon': []});
      this.render(false);
    }

    async _updateBaseAttribute(skill) {
      await comboData.updateBaseAttributeForSkill(this.item, this.item.actor, skill);
    }

    async _normalizeRoll(value) {
      if (value === '-' || value === 'dodge') await this.item.update({'system.attackRoll': '-'});
    }

    async _toggleDifficulty(checked) {
      await this.item.update(comboData.getDifficultyToggleUpdate(this.item, checked));
      this.render(false);
    }

    async _validateDifficulty(event) {
      const value = event.target.value.trim();
      if (!value) return;
      if (comboData.isDifficultyValueValid(this.item, value)) return;
      event.target.value = '';
      await this.item.update({'system.difficulty': ''});
      ui.notifications.warn(comboData.getDifficultyValidationMessage(this.item));
    }

    _validateLimit(event) {
      if (comboData.isLimitValueValid(event.target.value)) return;
      event.target.value = this.item.system.limit || '-';
      ui.notifications.warn("제한은 '-', 숫자, 또는 숫자%만 입력 가능합니다.");
    }

    _prepareSubmitData(event, form, formData, updateData) {
      const data = super._prepareSubmitData(event, form, formData, updateData);
      const system = data.system || {};
      if (Array.isArray(system.getTarget)) system.getTarget = system.getTarget.some(Boolean);
      const submitValues = comboData.prepareSubmittedCombatValues(this.item, this.item.actor, {
        effectIds: Array.isArray(system.effectIds) ? system.effectIds : this._effectIds(),
        weapons: system.weapon,
        attackRoll: system.attackRoll
      });
      foundry.utils.setProperty(data, 'system.effectIds', submitValues.effectIds);
      foundry.utils.setProperty(data, 'system.encroach.value', submitValues.encroachValue);
      foundry.utils.setProperty(data, 'system.weapon', submitValues.weapons);
      foundry.utils.setProperty(data, 'system.attack.value', submitValues.attackValue);
      return data;
    }
  }

  const ItemsClass = foundry.documents?.collections?.Items || Items;
  ItemsClass.registerSheet('dx3rd-emanim', DX3rdComboSheetV2, {
    label: 'DX3rd.SheetV2',
    types: ['combo'],
    makeDefault: true
  });
  window.DX3rdComboSheetV2 = DX3rdComboSheetV2;
})();
