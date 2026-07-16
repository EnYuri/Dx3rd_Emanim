/** Effect item AppV2 pilot sheet. */
(function() {
  const Base = window.DX3rdActiveItemSheetV2;
  const compat = window.DX3rdApplicationCompat;
  const weaponManager = window.DX3rdWeaponTabManager;
  const itemSheetData = window.DX3rdItemSheetData;
  if (!Base || !compat || !weaponManager || !itemSheetData) return;

  class DX3rdEffectSheetV2 extends Base {
    static DEFAULT_OPTIONS = {
      ...Base.DEFAULT_OPTIONS,
      classes: ['effect-sheet-v2'],
      actions: {
        ...Base.DEFAULT_OPTIONS.actions,
        macroAdd: DX3rdEffectSheetV2._onMacroAdd,
        macroDelete: DX3rdEffectSheetV2._onMacroDelete
      }
    };

    static PARTS = {
      main: {template: 'systems/dx3rd-emanim/templates/item/effect-workspace-sheet-v2.html', root: true}
    };

    static TABS = {primary: {
      tabs: [{id: 'description'}, {id: 'immediate'}, {id: 'persistent'}, {id: 'weapon'}],
      initial: 'description'
    }};

    async _prepareContext(options) {
      const context = await super._prepareContext(options);
      const {system} = context;
      const actor = this.item.actor;

      context.actor = actor ? {id: actor.id, type: actor.type, system: actor.system} : null;
      context.isEffect = true;
      system.actorSkills = actor?.system?.attributes?.skills || {};
      system.skillOptions = window.DX3rdSkillManager.getSkillSelectOptions('effect', system.actorSkills, actor?.type);

      system.level = itemSheetData.prepareEffectLevelData(this.item, actor, this.item.system.level || {});

      system.used ??= {};
      system.used.state ??= 0;
      system.used.max ??= 0;
      system.used.level ??= false;
      system.used.disable ??= 'notCheck';
      system.exp ??= {own: false, upgrade: false};
      system.exp.own ??= false;
      system.exp.upgrade ??= false;
      system.macros = itemSheetData.getEmbeddedMacros(this.item);
      context.macroTimings = ['instant', 'afterSuccess', 'afterDamage', 'afterMain', 'onInvoke'];
      context.worldMacros = itemSheetData.getWorldMacroOptions();

      weaponManager.prepareWeaponTabData(context, this.item);

      // 사정거리/대상/난이도 드롭다운 컨텍스트(캐노니컬 정규화 후 초기 선택/파라미터)
      if (window.DX3rdRangeTarget) {
        context.rangeField = window.DX3rdRangeTarget.fieldContext('range', system.range);
        context.targetField = window.DX3rdRangeTarget.fieldContext('target', system.target);
        context.difficultyField = window.DX3rdRangeTarget.difficultyFieldContext(system.difficulty);
      }
      return context;
    }

    async _onRender(context, options) {
      await super._onRender(context, options);
      this._listenerCleanups?.forEach(cleanup => cleanup());
      this._listenerCleanups = weaponManager.setupWeaponTabListeners(this.element, this) || [];
      const listen = (...args) => this._listenerCleanups.push(compat.on(this.element, ...args));
      listen('change', 'input[name="system.weaponSelect"]', event => this._toggleWeaponSelection(event));
      listen('change', '.difficulty-check', event => this._toggleDifficulty(event.target.checked));
      listen('change', 'select[name="system.roll"]', event => this._normalizeRoll(event.target.value));
      listen('blur', '.difficulty-input', event => this._validateDifficulty(event));
      listen('change', '[data-target-field="system.getTarget"]', event => {
        this.item.update({'system.getTarget': event.target.checked});
      });
      listen('change', '.macro-timing', event => this._updateMacro(event, 'timing'));
      listen('change', '.macro-disabled', event => this._updateMacro(event, 'disabled'));
      listen('change', '.macro-command', event => this._updateMacro(event, 'command'));
      listen('change', '.macro-kind', event => this._updateMacro(event, 'kind'));
      listen('change', '.macro-name', event => this._updateMacro(event, 'macroName'));
      const activeStateInput = this.element.querySelector('input.effect-active-check');
      if (activeStateInput) {
        const activeStateChange = async event => {
          // submitOnChange의 item.update와 AE 동기화가 엇갈리지 않게 한 경로로 처리한다.
          event.preventDefault();
          event.stopImmediatePropagation();
          event.stopPropagation();
          if (this._activeTogglePending) return;
          const checked = activeStateInput.checked;
          activeStateInput.disabled = true;
          this._activeTogglePending = true;
          const actor = this.item.actor;
          try {
            if (actor && window.DX3rdActorSheetData?.updateOwnedItemActiveState) {
              await window.DX3rdActorSheetData.updateOwnedItemActiveState(actor, this.item.id, checked);
              // 액터 시트는 AE 생성/제거 뒤의 파생 수치를 기본 updateItem 렌더보다 늦게
              // 받는다. 즉시 다시 그려 새로고침 없이 표시를 맞춘다.
              await compat.requestRender(actor.sheet);
            } else {
              await this.item.update({'system.active.state': checked});
            }
            await compat.requestRender(this);
          } finally {
            this._activeTogglePending = false;
            if (activeStateInput.isConnected) activeStateInput.disabled = false;
          }
        };
        activeStateInput.addEventListener('change', activeStateChange);
        this._listenerCleanups.push(() => activeStateInput.removeEventListener('change', activeStateChange));
      }
      // 레거시 단일 매크로 필드(system.macro) → 임베드 행(kind:'macro') 1회 이관
      itemSheetData.migrateLegacyMacroField(this.item);

      // 사정거리/대상/난이도 드롭다운 배선(선택+파라미터 → 캐노니컬 값 저장)
      window.DX3rdRangeTarget?.setupFieldListeners(this.element, this.item, {
        update: (it, upd) => it.update(upd)
      });
    }

    async _toggleWeaponSelection(event) {
      if (event.target.checked) await this.item.update({'system.weapon': []});
      this.render(false);
    }

    async _toggleDifficulty(checked) {
      await this.item.update(itemSheetData.getRollDifficultyToggleUpdate(this.item, checked));
      this.render(false);
    }

    async _normalizeRoll(value) {
      const update = itemSheetData.getRollChangeUpdate(value);
      if (Object.keys(update).length) await this.item.update(update);
    }

    async _validateDifficulty(event) {
      const value = event.target.value.trim();
      if (!value) return;
      if (itemSheetData.isRollDifficultyValueValid(this.item, value)) return;
      event.target.value = '';
      await this.item.update({'system.difficulty': ''});
      ui.notifications.warn(itemSheetData.getRollDifficultyValidationMessage(this.item));
    }

    async _updateMacro(event, property) {
      const index = Number(event.target.dataset.index);
      const value = property === 'disabled' ? event.target.checked : event.target.value;
      await itemSheetData.updateEmbeddedMacro(this.item, index, property, value);
    }

    _prepareSubmitData(event, form, formData, updateData) {
      const data = super._prepareSubmitData(event, form, formData, updateData);
      const level = itemSheetData.prepareEffectLevelData(this.item, this.item.actor, data.system?.level || this.item.system.level || {});
      foundry.utils.setProperty(data, 'system.level', level);

      const submittedWeapons = Array.isArray(data.system?.weapon)
        ? data.system.weapon
        : (this.item.system.weapon || []);
      foundry.utils.setProperty(data, 'system.weapon', itemSheetData.normalizeIdList(submittedWeapons));
      if (Array.isArray(data.system?.getTarget)) {
        foundry.utils.setProperty(data, 'system.getTarget', data.system.getTarget.some(Boolean));
      }
      for (const [key, value] of Object.entries(itemSheetData.getRollChangeUpdate(data.system?.roll))) {
        foundry.utils.setProperty(data, key, value);
      }
      return data;
    }

    static async _onMacroAdd(event) {
      event.preventDefault();
      await itemSheetData.addEmbeddedMacro(this.item);
      this.render(false);
    }

    static async _onMacroDelete(event, target) {
      event.preventDefault();
      const index = Number(target.dataset.index);
      const updated = await itemSheetData.removeEmbeddedMacro(this.item, index);
      if (!updated) return;
      this.render(false);
    }
  }

  const ItemsClass = foundry.documents?.collections?.Items || Items;
  ItemsClass.registerSheet('dx3rd-emanim', DX3rdEffectSheetV2, {
    label: 'DX3rd.SheetV2',
    types: ['effect'],
    makeDefault: true
  });
  window.DX3rdEffectSheetV2 = DX3rdEffectSheetV2;
})();
