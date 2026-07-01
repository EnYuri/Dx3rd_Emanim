// Connection 아이템 시트
(function() {
const compat = window.DX3rdApplicationCompat;
const itemSheetData = window.DX3rdItemSheetData;

class DX3rdConnectionSheet extends window.DX3rdItemSheet {
  /** @override */
  async getData(options) {
    let data = await super.getData(options);

    // 기본 시스템 데이터 초기화 (기존 데이터 보존)
    if (!data.system.skill) data.system.skill = this.item.system?.skill || "-";
    if (!data.system.exp) data.system.exp = this.item.system?.exp || 0;
    if (data.system.macro === undefined) data.system.macro = this.item.system?.macro || "";

    // saving 객체 초기화 (기존 데이터 보존)
    itemSheetData.prepareSavingData(this.item, data);

    // used 객체 초기화 (기존 데이터 보존)
    itemSheetData.prepareUsedData(this.item, data);

    // active 객체 초기화 (기존 데이터 보존)
    itemSheetData.prepareActiveData(this.item, data);

    // attributes 초기화 (기존 데이터 보존)
    itemSheetData.preserveAttributeData(this.item, data, {effect: false});

    // 액터 스킬 데이터 추가
    itemSheetData.prepareSkillOptions(this.item, data, 'connection', {warnIfMissing: true});

    // Description 에디터를 위한 데이터 추가 (helpers.js 사용)
    data = await itemSheetData.enrichSheetData(this.item, data);

    return data;
  }

  /** @override */
  activateListeners(html) {
    super.activateListeners(html);
    const root = compat.unwrapRoot(html);

    // 속성 관리 이벤트 리스너 설정 (helpers.js 사용)
    itemSheetData.activateAttributeControls(this, html);

    // active.runTiming 변경 시 즉시 저장
    compat.on(root, 'change', 'select[name="system.active.runTiming"]', async (event) => {
      const value = event.target.value;
      try {
        await this.item.update({ 'system.active.runTiming': value });
      } catch (e) {
        console.error('DX3rd | ConnectionSheet active.runTiming update failed', e);
      }
    });

    itemSheetData.activateStateDisableListeners(this, root);
    itemSheetData.activateSystemFieldListeners(this, root, {
      logPrefix: 'ConnectionSheet'
    });
  }

  /**
   * 속성 추가 (Attributes 탭)
   */
  async _onCreateAttribute(event) {
    event.preventDefault();
    const button = compat.closest(event.target, '[data-action="create"]');
    const position = button?.dataset.pos || 'main';
    
    this._isAddingAttribute = true;
    try {
      await window.DX3rdAttributeManager.createAttribute(this.item, position);
      this.render(false);
    } finally {
      this._isAddingAttribute = false;
    }
  }

  /**
   * 속성 삭제 (Attributes 탭)
   */
  async _onDeleteAttribute(event) {
    event.preventDefault();
    const target = event.target;
    const attributeKey = target.dataset.attribute || compat.closest(target, '.attribute')?.dataset.attribute;
    const position = compat.closest(target, '.attributes-list')?.dataset.pos || 'main';
    
    try {
      await window.DX3rdAttributeManager.deleteAttribute(this.item, attributeKey, position);
      this.render(false);
    } catch (error) {
      console.error("DX3rd | ConnectionSheet _onDeleteAttribute failed", error);
    }
  }

  // _onActiveDisableChange와 _onUsedDisableChange는 부모 클래스(item-sheet.js)에서 상속됨
}

// Connection 시트 등록 (v13 호환)
const ItemsClass = foundry.documents?.collections?.Items || Items;
ItemsClass.registerSheet('dx3rd-emanim', DX3rdConnectionSheet, {
  label: 'DX3rd.SheetV1',
  types: ['connection'],
  makeDefault: true
});

// 전역 노출
window.DX3rdConnectionSheet = DX3rdConnectionSheet;
})();
