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
      system.encroach ??= {init: 0, value: ''};
      system.encroach.init ??= 0;
      system.encroach.value ??= '';
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
      context.showUsageSettings = ['weapon', 'protect', 'vehicle', 'etc', 'once'].includes(this.item.type);
      context.effectView = effectAdapter.prepareSheetContext(this.item);
      this._effectAddKinds ??= {};
      context.effectView.immediateAddKind = DX3rdActiveItemSheetV2._addKind(
        this._effectAddKinds.immediate, context.effectView.immediateAddOptions);
      context.effectView.persistentAddKind = DX3rdActiveItemSheetV2._addKind(
        this._effectAddKinds.persistent, context.effectView.persistentAddOptions);
      // 확장 도구를 열 때 펴 둘 페인은 버킷 id 다(카드 = 버킷 = 페인).
      if ((context.effectView.modifierOverview.buckets || [])
        .some(bucket => bucket.id === this._modifierConfigScope)) {
        context.effectView.modifierOverview.initialScope = this._modifierConfigScope;
      }
      return context;
    }

    /**
     * 드롭다운에 남길 선택값. 기억해 둔 종류가 이미 추가되어 비활성이면
     * 첫 번째 추가 가능한 종류로 내린다(비활성 항목이 선택된 채로 남지 않게).
     */
    static _addKind(remembered, options = []) {
      const usable = options.filter(option => !option.disabled);
      if (usable.some(option => option.value === remembered)) return remembered;
      return usable[0]?.value || '';
    }

    /**
     * 확장 도구는 각 효과 카드에서 해당 효과 하나만 잘라 개별로 연다.
     * 아이템의 확장 전체를 한 번에 여는 진입점은 존재하지 않으므로 initialEditor 는 필수다.
     */
    _openItemExtend(event, initialEditor, effectId = null) {
      event?.preventDefault();
      new window.DX3rdItemExtendDialog({
        title: game.i18n.localize('DX3rd.EffectEditor'),
        actorId: this.item.actor?.id || null,
        itemId: this.item.id,
        // uuid 가 정본이다. 미연결 토큰의 아이템·컴펜디움 아이템은 actorId+itemId 로 못 찾는다.
        itemUuid: this.item.uuid,
        initialEditor,
        effectId,
        buttons: {close: {icon: '<i class="fas fa-times"></i>', label: game.i18n.localize('DX3rd.Close')}},
        default: 'close'
      }).render(true);
    }

    async _onRender(context, options) {
      await super._onRender(context, options);
      await manager.initializeAttributeLabels(this.element, this.item);

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
      listen('change', '.effect-channel-binding', event => this._updateEffectChannel(event));
      listen('change', '.effect-enabled-toggle', event => this._toggleEffectDefinition(event));
      listen('change', '.effect-kind-select', event => {
        const family = event.target.dataset.family;
        if (family) this._effectAddKinds[family] = event.target.value;
      });

      // 레거시 단일 매크로 필드(system.macro) → 임베드 행(kind:'macro') 1회 이관
      itemSheetData.migrateLegacyMacroField(this.item);
      this._refreshFormulaValidation();
    }

    /**
     * 보정 카드의 적용 대상(자신/대상)을 바꾼다. 채널은 데이터가 사는 자리 그 자체이므로
     * 카드의 행 전부가 반대 채널로 옮겨 간다 — 카드 id 도 바뀌니 새 id 를 기억해 둔다.
     * 옮긴 자리에 같은 발현 액션의 카드가 이미 있으면 한 장으로 합쳐진다(같은 채널 × 같은
     * 액션 = 한 버킷). 카드가 사라진 것으로 보이므로 그때는 알린다.
     */
    async _updateEffectChannel(event) {
      const id = event.target.dataset.effectId;
      if (!id?.startsWith('modifiers.')) return;
      const moved = await effectAdapter.updateModifierChannel(this.item, id, event.target.value);
      if (moved) {
        this._modifierConfigScope = moved.id;
        if (moved.merged) {
          ui.notifications.info(game.i18n.localize('DX3rd.ModifierBucketMerged'));
        }
      }
      this.render(false);
    }

    async _updateEffectAction(event) {
      const id = event.target.dataset.effectId;
      if (!id) return;
      // 보정 카드 id 는 곧 버킷 id 다. 액션을 바꾸면 id 도 바뀌므로 새 id 를 기억한다.
      if (id.startsWith('modifiers.')) {
        const before = effectAdapter.parseBucketId(this.item, id);
        this._modifierConfigScope = effectAdapter.bucketId(this.item, before.channel, event.target.value);
      }
      await effectAdapter.updateAction(this.item, id, event.target.value);
      this.render(false);
    }

    async _toggleEffectDefinition(event) {
      const id = event.target.dataset.effectId;
      if (!id) return;
      await effectAdapter.toggleEffect(this.item, id, event.target.checked);
      this.render(false);
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
      const effectId = target.dataset.effectId || null;
      // 카드마다 편집 페인이 따로이므로 그 버킷을 펴고 열어야 한다.
      if (effectId?.startsWith('modifiers.')) this._modifierConfigScope = effectId;
      this._openItemExtend(event, editor, effectId);
    }

    static async _onAddEffectCard(event, target) {
      event.preventDefault();
      const family = target.dataset.family;
      const select = this.element?.querySelector(`.effect-kind-select[data-family="${family}"]`);
      const kind = select?.value;
      // 이미 추가된 종류(비활성 항목)는 눌러도 아무것도 만들지 않는다.
      if (!kind || select?.selectedOptions?.[0]?.disabled) return;
      this._effectAddKinds ??= {};
      this._effectAddKinds[family] = kind;
      // 지속 효과 보정은 카드 하나가 버킷 하나다 — 추가하면 아직 안 쓰는 발현 액션으로
      // 새 카드가 생기고, 그 카드의 편집 페인을 펴고 열어 준다.
      const id = await effectAdapter.addEffect(this.item, family, kind);
      if (family === 'persistent' && kind === 'modifiers') {
        this._modifierConfigScope = id || this._modifierConfigScope;
        this.render(false);
        this._openItemExtend(event, 'modifiers', id || 'modifiers.self');
        return;
      }
      this.render(false);
      if (id) this._openItemExtend(event, kind, id);
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
      const changedName = this._getChangedFieldName(event);
      if (changedName?.endsWith('.value') && (changedName.startsWith('system.attributes.') || changedName.startsWith('system.effect.attributes.'))) {
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
      if (changedName === 'system.active.disable' && data.system.active?.disable === 'notCheck') {
        data.system.active.state = false;
      }
      return data;
    }

  }
  window.DX3rdActiveItemSheetV2 = DX3rdActiveItemSheetV2;
})();
