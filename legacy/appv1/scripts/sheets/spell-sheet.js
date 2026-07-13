// Archived AppV1 Spell item sheet
(function () {
  const compat = window.DX3rdApplicationCompat;
  const itemSheetData = window.DX3rdItemSheetData;

  class DX3rdSpellSheet extends window.DX3rdItemSheet {
  /** @override */
    async getData(options) {
      let data = await super.getData(options);

      itemSheetData.prepareSkillOptions(this.item, data, 'spell', {warnIfMissing: true});

      // 모든 system 필드가 undefined인 경우 현재 아이템의 값을 사용
      itemSheetData.hydrateSystemFields(this.item, data, [
        'spelltype', 'exp', 'invoke', 'evocation', 'encroach', 'description',
        'roll', 'macro', 'active', 'effect', 'attributes', 'skills', 'getTarget', 'scene', 'temporarySpell'
      ], {
        stringFields: ['spelltype', 'encroach', 'description', 'roll', 'macro'],
        booleanFields: ['getTarget', 'scene', 'temporarySpell'],
        defaults: {
          exp: 0,
          invoke: '-',
          evocation: '-'
        }
      });

      // 활성화 체크박스 초기화
      itemSheetData.prepareActiveData(this.item, data);

      // effect 객체 초기화 (기존 데이터 보존)
      itemSheetData.prepareEffectData(this.item, data);

      // Biography 리치 텍스트 처리 (helpers.js 사용)
      data = await itemSheetData.enrichSheetData(this.item, data);

      // attributes와 effect.attributes의 기존 값 보존
      itemSheetData.preserveAttributeData(this.item, data);

      return data;
    }

    /** @override */
    activateListeners(html) {
      super.activateListeners(html);
      const root = compat.unwrapRoot(html);

    // Target Tab 통합 리스너는 부모 클래스(item-sheet.js)에서 자동 설정됨

    // Active 체크박스 변경 핸들러
    compat.on(root, 'change', 'input[name="system.active.state"]', this._onActiveChange.bind(this));

    // Active disable 변경 핸들러
    compat.on(root, 'change', 'select[name="system.active.disable"]', (event) => {
      this._onActiveDisableChange({ currentTarget: event.target });
    });

    // Casting Roll 체크박스 변경 핸들러
    compat.on(root, 'change', '.casting-roll-check', this._onCastingRollCheckChange.bind(this));

      // 어트리뷰트 관리 유틸리티 사용
      itemSheetData.activateAttributeControls(this, html);
      itemSheetData.activateSystemFieldListeners(this, root, {
        logPrefix: 'SpellSheet',
        inputExclude: [
          'system.active.state',
          'system.castingRollCheck',
          'system.getTarget',
          'system.scene'
        ]
      });

      // active.runTiming 변경 시 즉시 저장
      compat.on(root, 'change', 'select[name="system.active.runTiming"]', async (event) => {
        const value = event.target.value;
        try {
          await this.item.update({ 'system.active.runTiming': value });
        } catch (e) {
          console.error('DX3rd | SpellSheet active.runTiming update failed', e);
        }
      });
    }

  // Active 체크박스 변경 핸들러
  async _onActiveChange(event) {
    event.preventDefault();
    const state = event.target.checked;

    try {
      await itemSheetData.updateAfterDefault(this.item, { 'system.active.state': state });
    } catch (e) {
      console.error('DX3rd | SpellSheet active update failed', e);
    }
  }

  // Casting Roll 체크박스 변경 핸들러
  async _onCastingRollCheckChange(event) {
    event.preventDefault();
    const isChecked = event.target.checked;
    const newRollValue = isChecked ? 'CastingRoll' : '-';

    try {
      const updates = { 'system.roll': newRollValue };
      
      // 체크 해제 시 invoke와 evocation 값을 '-'로 초기화
      if (!isChecked) {
        updates['system.invoke.value'] = '-';
        updates['system.evocation.value'] = '-';
      }
      
      await itemSheetData.updateAfterDefault(this.item, updates);
    } catch (e) {
      console.error('DX3rd | SpellSheet casting roll update failed', e);
    }
  }

  // _onActiveDisableChange는 부모 클래스(item-sheet.js)에서 상속됨
}

  // Spell 시트 등록 (v13 호환)
  const ItemsClass = foundry.documents?.collections?.Items || Items;
  ItemsClass.registerSheet('dx3rd-emanim', DX3rdSpellSheet, {
    label: 'DX3rd.SheetV1',
    types: ['spell'],
    makeDefault: true
  });

  // 전역 노출
  window.DX3rdSpellSheet = DX3rdSpellSheet;
})();
