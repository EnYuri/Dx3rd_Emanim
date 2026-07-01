/** Shared AppV2 behavior for active items with attributes and target extensions. */
(function() {
  const ItemSheetV2 = window.DX3rdItemSheetV2;
  const compat = window.DX3rdApplicationCompat;
  const manager = window.DX3rdAttributeManager;
  if (!ItemSheetV2 || !compat || !manager) return;

  class DX3rdActiveItemSheetV2 extends ItemSheetV2 {
    static DEFAULT_OPTIONS = {actions: {
      createAttribute: DX3rdActiveItemSheetV2._onCreateAttribute,
      deleteAttribute: DX3rdActiveItemSheetV2._onDeleteAttribute
    }};

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
      return context;
    }

    /**
     * AppV1 은 확장 도구를 헤더 버튼(_getHeaderButtons)으로 직접 노출하지만, AppV2 는
     * _getHeaderControls 를 ⋮ 드롭다운으로만 렌더한다. AppV1 과 동일하게 헤더에 바로
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

    _openItemExtend(event) {
      event?.preventDefault();
      new window.DX3rdItemExtendDialog({
        title: game.i18n.localize('DX3rd.ItemExtend'),
        actorId: this.item.actor?.id || null,
        itemId: this.item.id,
        buttons: {close: {icon: '<i class="fas fa-times"></i>', label: game.i18n.localize('DX3rd.Close')}},
        default: 'close'
      }).render(true);
    }

    async _onRender(context, options) {
      await super._onRender(context, options);
      await manager.initializeAttributeLabels(this.element, this.item);
      this._injectItemExtendButton();
    }

    _prepareSubmitData(event, form, formData, updateData) {
      const changed = event?.target;
      let clearValue = false;
      if (changed?.name?.startsWith('system.attributes.') && changed.name.endsWith('.value')) {
        const row = compat.closest(changed, '.attribute', this.element);
        const label = compat.query(row, '.attribute-label')?.value;
        const key = compat.query(row, '.attribute-key')?.value;
        if (label) {
          const result = window.DX3rdFormulaEvaluator.validateCircularReference(changed.value, label, this.item.actor, key);
          if (!result.valid) {
            changed.value = '';
            clearValue = true;
            ui.notifications.warn(result.message);
          }
        }
      }
      const data = super._prepareSubmitData(event, form, formData, updateData);
      if (clearValue) foundry.utils.setProperty(data, changed.name, '');
      if (data.system.used?.disable === 'notCheck') {
        data.system.used.state = 0;
        data.system.used.max = 0;
      }
      if (data.system.active?.disable === 'notCheck') data.system.active.state = false;
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
