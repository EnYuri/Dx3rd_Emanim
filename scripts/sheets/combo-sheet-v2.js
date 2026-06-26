/** Combo item AppV2 pilot sheet. */
(function() {
  const Base = window.DX3rdActiveItemSheetV2;
  const compat = window.DX3rdApplicationCompat;
  const comboData = window.DX3rdComboData;
  if (!Base || !compat || !comboData) return;

  class DX3rdComboSheetV2 extends Base {
    static DEFAULT_OPTIONS = {classes: ['combo-sheet-v2']};
    static PARTS = {main: {template: 'systems/dx3rd-emanim/templates/item/combo-sheet-v2.html', root: true}};
    static TABS = {primary: {
      tabs: [{id: 'description'}, {id: 'effect'}, {id: 'weapon'}, {id: 'attributes'}, {id: 'target'}],
      initial: 'description'
    }};

    async _prepareContext(options) {
      const context = await super._prepareContext(options);
      await comboData.prepareSheetData(context, this.item, this.item.actor);
      context.enrichedDescription ??= context.enrichedBiography || context.system.description || '';
      return context;
    }

    async _onRender(context, options) {
      await super._onRender(context, options);
      this._listenerCleanups?.forEach(cleanup => cleanup());
      this._listenerCleanups = window.DX3rdWeaponTabManager.setupWeaponTabListeners(this.element, this) || [];
      const listen = (...args) => this._listenerCleanups.push(compat.on(this.element, ...args));

      listen('click', '.tab[data-tab="effect"] .add-effect', event => this._addEffect(event));
      listen('click', '.tab[data-tab="effect"] .item-edit', (event, target) => this._editEffect(event, target));
      listen('click', '.tab[data-tab="effect"] .item-delete', (event, target) => this._deleteEffect(event, target));
      listen('change', 'input[name="system.weaponSelect"]', event => this._toggleWeaponSelection(event));
      listen('change', 'select[name="system.skill"]', event => this._updateBaseAttribute(event.target.value));
      listen('change', 'select[name="system.roll"]', event => this._normalizeRoll(event.target.value));
      listen('change', '[data-target-field="system.getTarget"]', event => {
        this.item.update({'system.getTarget': event.target.checked});
      });
      listen('change', '.difficulty-check', event => this._toggleDifficulty(event.target.checked));
      listen('blur', '.difficulty-input', event => this._validateDifficulty(event));
      listen('input', 'input[name="system.limit"]', event => this._validateLimit(event));
    }

    _effectIds() {
      const value = this.item.system.effectIds;
      return Array.isArray(value) ? value : [];
    }

    _encroachment(effectIds) {
      let dice = 0;
      let add = 0;
      for (const id of effectIds) {
        const value = String(this.item.actor?.items.get(id)?.system?.encroach?.value || '0').trim();
        const diceMatch = value.match(/(\d+)d10/i);
        const addMatch = value.match(/([+-]\d+)$/);
        if (diceMatch) dice += Number(diceMatch[1]) || 0;
        if (addMatch) add += Number(addMatch[1]) || 0;
        else if (!diceMatch && Number.isFinite(Number.parseInt(value))) add += Number.parseInt(value) || 0;
      }
      if (dice && add > 0) return `${dice}d10+${add}`;
      if (dice) return `${dice}d10`;
      return String(add);
    }

    async _addEffect(event) {
      event.preventDefault();
      const id = compat.query(this.element, '#actor-effect')?.value;
      if (!id || id === '-') return ui.notifications.warn('추가할 이펙트를 선택해주세요.');
      const ids = this._effectIds();
      if (ids.includes(id)) return ui.notifications.warn('이미 추가된 이펙트입니다.');
      const next = [...ids, id];
      await this.item.update({'system.effectIds': next, 'system.encroach.value': this._encroachment(next)});
      this.render(false);
    }

    _editEffect(event, target) {
      event.preventDefault();
      const id = compat.closest(target, '.item', this.element)?.dataset.itemId;
      const effect = this.item.actor?.items.get(id);
      if (effect?.type === 'effect') effect.sheet.render(true);
      else ui.notifications.warn('이펙트 아이템을 찾을 수 없습니다.');
    }

    async _deleteEffect(event, target) {
      event.preventDefault();
      const id = compat.closest(target, '.item', this.element)?.dataset.itemId;
      if (!id) return;
      const next = this._effectIds().filter(effectId => effectId !== id);
      await this.item.update({'system.effectIds': next, 'system.encroach.value': this._encroachment(next)});
      this.render(false);
    }

    async _toggleWeaponSelection(event) {
      if (event.target.checked) await this.item.update({'system.weapon': []});
      this.render(false);
    }

    async _updateBaseAttribute(skill) {
      if (!skill || skill === '-') return;
      const base = ['body', 'sense', 'mind', 'social'].includes(skill)
        ? skill
        : this.item.actor?.system?.attributes?.skills?.[skill]?.base;
      if (base) await this.item.update({'system.base': base});
    }

    async _normalizeRoll(value) {
      if (value === '-' || value === 'dodge') await this.item.update({'system.attackRoll': '-'});
    }

    async _toggleDifficulty(checked) {
      if (checked) {
        await this.item.update({'system.roll': 'major', 'system.difficulty': ''});
      } else {
        const freepass = game.i18n.localize('DX3rd.Freepass');
        const current = this.item.system.difficulty || '';
        await this.item.update({
          'system.roll': '-',
          'system.difficulty': current === freepass || current === '-' ? current : freepass,
          'system.attackRoll': '-'
        });
      }
      this.render(false);
    }

    async _validateDifficulty(event) {
      const value = event.target.value.trim();
      if (!value) return;
      const roll = this.item.system.roll || '-';
      const freepass = game.i18n.localize('DX3rd.Freepass');
      const competition = game.i18n.localize('DX3rd.Competition');
      const reference = game.i18n.localize('DX3rd.Reference');
      const number = Number(value);
      const valid = roll === '-'
        ? value === freepass || value === '-'
        : (Number.isInteger(number) && number >= 1) || value === competition || value === reference;
      if (valid) return;
      event.target.value = '';
      await this.item.update({'system.difficulty': ''});
      ui.notifications.warn('현재 판정 설정에 사용할 수 없는 난이도입니다.');
    }

    _validateLimit(event) {
      if (!event.target.value || /^(-|\d+|\d+%)$/.test(event.target.value)) return;
      event.target.value = this.item.system.limit || '-';
      ui.notifications.warn("제한은 '-', 숫자, 또는 숫자%만 입력 가능합니다.");
    }

    _prepareSubmitData(event, form, formData, updateData) {
      const data = super._prepareSubmitData(event, form, formData, updateData);
      const system = data.system || {};
      if (Array.isArray(system.getTarget)) system.getTarget = system.getTarget.some(Boolean);
      const ids = Array.isArray(system.effectIds) ? system.effectIds.filter(id => id !== '-') : this._effectIds();
      foundry.utils.setProperty(data, 'system.effectIds', ids);
      foundry.utils.setProperty(data, 'system.encroach.value', this._encroachment(ids));
      const submittedWeapons = Array.isArray(system.weapon) ? system.weapon : (this.item.system.weapon || []);
      const weapons = submittedWeapons.filter(id => id && id !== '-');
      foundry.utils.setProperty(data, 'system.weapon', weapons);

      const attackRoll = system.attackRoll ?? this.item.system.attackRoll;
      if (!attackRoll || attackRoll === '-') {
        foundry.utils.setProperty(data, 'system.attack.value', '-');
        return data;
      }
      let attack = Number(this.item.actor?.system?.attributes?.attack?.value) || 0;
      attack += Number(this.item.actor?.system?.attributes?.attack?.[attackRoll]) || 0;
      for (const id of weapons) attack += Number(this.item.actor?.items.get(id)?.system?.attack) || 0;
      foundry.utils.setProperty(data, 'system.attack.value', attack);
      return data;
    }
  }

  const ItemsClass = foundry.documents?.collections?.Items || Items;
  ItemsClass.registerSheet('dx3rd-emanim', DX3rdComboSheetV2, {
    label: 'DX3rd.AppV2PilotSheet',
    types: ['combo'],
    makeDefault: false
  });
  window.DX3rdComboSheetV2 = DX3rdComboSheetV2;
})();
