/** Shared AppV2 behavior for active items with attributes and target extensions. */
(function() {
  const ItemSheetV2 = window.DX3rdItemSheetV2;
  const compat = window.DX3rdApplicationCompat;
  const manager = window.DX3rdAttributeManager;
  const itemSheetData = window.DX3rdItemSheetData;
  const effectAdapter = window.DX3rdItemEffectAdapter;
  if (!ItemSheetV2 || !compat || !manager || !itemSheetData || !effectAdapter) return;

  class DX3rdActiveItemSheetV2 extends ItemSheetV2 {
    static DEFAULT_OPTIONS = {
      form: {
        closeOnSubmit: false,
        submitOnChange: true
      },
      actions: {
        createAttribute: DX3rdActiveItemSheetV2._onCreateAttribute,
        deleteAttribute: DX3rdActiveItemSheetV2._onDeleteAttribute,
        macroAdd: DX3rdActiveItemSheetV2._onMacroAdd,
        macroDelete: DX3rdActiveItemSheetV2._onMacroDelete,
        editEffect: DX3rdActiveItemSheetV2._onEditEffect,
        addEffectCard: DX3rdActiveItemSheetV2._onAddEffectCard,
        deleteEffectCard: DX3rdActiveItemSheetV2._onDeleteEffectCard
      }
    };

    async _prepareContext(options) {
      const context = await super._prepareContext(options);
      const system = context.system;
      system.exp ??= 0;
      system.macro ??= '';
      system.saving ??= {value: 0, difficulty: ''};
      system.saving.value ??= 0;
      system.saving.difficulty ??= '';
      system.active ??= {state: false, disable: '-', runTiming: 'instant'};
      system.active.state ??= false;
      system.active.disable ??= '-';
      system.active.runTiming ??= 'instant';
      system.effect ??= {disable: 'notCheck', runTiming: 'instant', attributes: {}};
      system.effect.disable ??= 'notCheck';
      system.effect.runTiming ??= 'instant';
      system.effect.attributes ??= {};
      system.attributes ??= {};
      system.getTarget ??= false;
      system.scene ??= false;

      // 임베드 매크로(system.macros[]) + 타이밍 옵션 + 월드 매크로 목록(이름참조 드롭다운용)
      system.macros = itemSheetData.getEmbeddedMacros(this.item);
      context.macroTimings = ['instant', 'afterSuccess', 'afterDamage', 'afterMain', 'onInvoke'];
      context.worldMacros = itemSheetData.getWorldMacroOptions();
      context.effectView = effectAdapter.prepareSheetContext(this.item);
      if (['main', 'sub'].includes(this._modifierConfigScope)) {
        context.effectView.modifierOverview.initialScope = this._modifierConfigScope;
      }
      return context;
    }

    /**
     * 이전 시트 은 확장 도구를 헤더 버튼(_getHeaderButtons)으로 직접 노출하지만, AppV2 는
     * _getHeaderControls 를 ⋮ 드롭다운으로만 렌더한다. 이전 시트 과 동일하게 헤더에 바로
     * 노출하기 위해 드롭다운에서는 제거하고 _injectItemExtendButton 으로 직접 주입한다.
     */
    _getHeaderControls() {
      return super._getHeaderControls()
        .filter(control => control.action !== 'itemExtend');
    }

    _injectItemExtendButton() {
      const header = this.element?.querySelector('.window-header');
      if (!header) return;

      // 재렌더 시 중복 주입 방지
      header.querySelectorAll('.dx3rd-header-btn.item-extend').forEach(el => el.remove());

      const label = game.i18n.localize('DX3rd.ItemExtend');
      const anchor = header.querySelector('[data-action="toggleControls"]')
        || header.querySelector('[data-action="close"]');

      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'header-control dx3rd-header-btn item-extend';
      button.dataset.tooltip = label;
      button.innerHTML = `<i class="fa-solid fa-screwdriver-wrench"></i><span>${label}</span>`;
      button.addEventListener('click', event => this._openItemExtend(event));
      if (anchor) header.insertBefore(button, anchor);
      else header.appendChild(button);
    }

    _openItemExtend(event, initialEditor = null, effectId = null) {
      event?.preventDefault();
      new window.DX3rdItemExtendDialog({
        title: game.i18n.localize(initialEditor ? 'DX3rd.EffectEditor' : 'DX3rd.ItemExtend'),
        actorId: this.item.actor?.id || null,
        itemId: this.item.id,
        initialEditor,
        effectId,
        buttons: {close: {icon: '<i class="fas fa-times"></i>', label: game.i18n.localize('DX3rd.Close')}},
        default: 'close'
      }).render(true);
    }

    async _onRender(context, options) {
      await super._onRender(context, options);
      await manager.initializeAttributeLabels(this.element, this.item);
      if (!['effect', 'weapon', 'protect', 'vehicle', 'etc', 'once'].includes(this.item.type)) {
        this._injectItemExtendButton();
      }

      // 임베드 매크로 행 리스너
      this._macroCleanups?.forEach(cleanup => cleanup());
      this._macroCleanups = [];
      const listen = (...args) => this._macroCleanups.push(compat.on(this.element, ...args));
      listen('input', '.attribute-value', (event, target) => this._validateFormulaInput(target));
      listen('change', '.macro-timing', event => this._updateMacro(event, 'timing'));
      listen('change', '.macro-disabled', event => this._updateMacro(event, 'disabled'));
      listen('change', '.macro-command', event => this._updateMacro(event, 'command'));
      listen('change', '.macro-kind', event => this._updateMacro(event, 'kind'));
      listen('change', '.macro-name', event => this._updateMacro(event, 'macroName'));
      listen('change', '.effect-action-binding', event => this._updateEffectAction(event));
      listen('change', '.effect-enabled-toggle', event => this._toggleEffectDefinition(event));
      listen('change', '.modifier-scope-select', event => this._moveModifier(event));
      listen('change', '.modifier-config-scope', event => this._switchModifierConfig(event));

      // 레거시 단일 매크로 필드(system.macro) → 임베드 행(kind:'macro') 1회 이관
      itemSheetData.migrateLegacyMacroField(this.item);
      this._refreshFormulaValidation();
    }

    async _updateEffectAction(event) {
      const id = event.target.dataset.effectId;
      if (!id) return;
      if (id === 'modifiers.self') this._modifierConfigScope = 'main';
      if (id === 'modifiers.target') this._modifierConfigScope = 'sub';
      await effectAdapter.updateAction(this.item, id, event.target.value);
      this.render(false);
    }

    async _toggleEffectDefinition(event) {
      const id = event.target.dataset.effectId;
      if (!id) return;
      await effectAdapter.toggleEffect(this.item, id, event.target.checked);
      this.render(false);
    }

    async _moveModifier(event) {
      const row = compat.closest(event.target, '.attribute', this.element);
      const attributeKey = row?.dataset.attribute;
      const source = row?.dataset.pos;
      const target = event.target.value;
      if (!attributeKey || !source || source === target) return;
      this._modifierConfigScope = target;
      event.target.disabled = true;
      const moved = await effectAdapter.moveModifier(this.item, attributeKey, source, target);
      if (!moved) event.target.value = source;
      this.render(false);
    }

    _switchModifierConfig(event) {
      const scope = event.target.value;
      this._modifierConfigScope = scope;
      compat.queryAll(this.element, '.dx3rd-modifier-config-pane').forEach(pane => {
        pane.hidden = pane.dataset.scope !== scope;
      });
    }

    _validateFormulaInput(input) {
      const row = compat.closest(input, '.attribute', this.element);
      const label = compat.query(row, '.attribute-label')?.value;
      const key = compat.query(row, '.attribute-key')?.value;
      let result = window.DX3rdFormulaEvaluator.validateDeterministicFormula(input.value, key);
      if (result.valid && label && input.name.startsWith('system.attributes.')) {
        result = window.DX3rdFormulaEvaluator.validateCircularReference(input.value, label, this.item.actor, key);
      }
      window.DX3rdFormulaEvaluator.setInputValidationState(input, result);
      return result;
    }

    _refreshFormulaValidation() {
      compat.queryAll(this.element, '.attribute-value').forEach(input => this._validateFormulaInput(input));
    }

    async _updateMacro(event, property) {
      const index = Number(event.target.dataset.index);
      const value = property === 'disabled' ? event.target.checked : event.target.value;
      await itemSheetData.updateEmbeddedMacro(this.item, index, property, value);
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

    static async _onEditEffect(event, target) {
      event.preventDefault();
      const editor = target.dataset.editor;
      if (editor === 'macro') {
        const selector = '#dx3rd-macro-workspace';
        this.element?.querySelector(selector)?.scrollIntoView({behavior: 'smooth', block: 'start'});
        return;
      }
      this._openItemExtend(event, editor, target.dataset.effectId || null);
    }

    static async _onAddEffectCard(event, target) {
      event.preventDefault();
      const family = target.dataset.family;
      const select = this.element?.querySelector(`.effect-kind-select[data-family="${family}"]`);
      const kind = select?.value;
      if (!kind) return;
      if (family === 'persistent' && kind === 'modifiers') {
        await manager.createAttribute(this.item, 'main');
        this.render(false);
        this._openItemExtend(event, 'modifiers', 'modifiers');
      } else {
        const id = await effectAdapter.addEffect(this.item, family, kind);
        this.render(false);
        if (id) this._openItemExtend(event, kind, id);
      }
    }

    static async _onDeleteEffectCard(event, target) {
      event.preventDefault();
      const id = target.dataset.effectId;
      if (!id) return;
      await effectAdapter.deleteEffect(this.item, id);
      this.render(false);
    }

    _prepareSubmitData(event, form, formData, updateData) {
      const changed = event?.target;
      if (changed?.name?.endsWith('.value') && (changed.name.startsWith('system.attributes.') || changed.name.startsWith('system.effect.attributes.'))) {
        this._validateFormulaInput(changed);
      }
      const data = super._prepareSubmitData(event, form, formData, updateData);
      if (data.system.used?.disable === 'notCheck') {
        data.system.used.state = 0;
        data.system.used.max = 0;
      }
      // disable 를 notCheck 로 "바꾸는 순간"에만 active.state 를 끈다(V1 _onActiveDisableChange 와 동일).
      // 매 서브밋마다 끄면 notCheck(자동해제 없는 상시) 아이템은 시트에서 활성화 자체를 켤 수 없고,
      // 다른 값만 바꿔도 토글이 즉시 꺼진다. 변경 대상이 active.disable 일 때로 한정한다.
      if (changed?.name === 'system.active.disable' && data.system.active?.disable === 'notCheck') {
        data.system.active.state = false;
      }
      return data;
    }

    static async _onCreateAttribute(event, target) {
      event.preventDefault();
      await manager.createAttribute(this.item, target.dataset.pos || 'main');
      this.render(false);
    }

    static async _onDeleteAttribute(event, target) {
      event.preventDefault();
      const row = compat.closest(target, '.attribute', this.element);
      const list = compat.closest(target, '.attributes-list', this.element);
      if (!row?.dataset.attribute) return;
      await manager.deleteAttribute(this.item, row.dataset.attribute, list?.dataset.pos || 'main');
      this.render(false);
    }
  }
  window.DX3rdActiveItemSheetV2 = DX3rdActiveItemSheetV2;
})();
