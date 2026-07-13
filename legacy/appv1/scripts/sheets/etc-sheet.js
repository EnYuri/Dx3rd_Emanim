// Archived AppV1 Etc item sheet
(function() {
const compat = window.DX3rdApplicationCompat;
const itemSheetData = window.DX3rdItemSheetData;

class DX3rdEtcSheet extends window.DX3rdItemSheet {
  /** @override */
  async getData(options) {
    let data = await super.getData(options);
    const item = this.item;

    // system.type을 "etc"로 설정 (실제 타입 값)
    if (!data.system.type) {
      data.system.type = "etc";
    }
    
    // 표시용 displayType 설정
    data.displayType = "DX3rd.Etc";

    // 기본 시스템 데이터 초기화 (기존 데이터 보존)
    if (!data.system.exp) data.system.exp = this.item.system?.exp || 0;
    if (!data.system.equipment) data.system.equipment = this.item.system?.equipment || false;
    if (data.system.macro === undefined) data.system.macro = this.item.system?.macro || "";

    // saving 객체 초기화 (기존 데이터 보존)
    itemSheetData.prepareSavingData(item, data);

    // used 객체 초기화 (기존 데이터 보존)
    itemSheetData.prepareUsedData(item, data);

    // active 객체 초기화 (기존 데이터 보존)
    itemSheetData.prepareActiveData(item, data);

    // effect 객체 초기화 (기존 데이터 보존)
    itemSheetData.prepareEffectData(item, data);

    // attributes 초기화 (기존 데이터 보존)
    itemSheetData.preserveAttributeData(item, data);

    // getTarget / scene 체크박스 초기화
    itemSheetData.prepareTargetFlags(item, data);

    // Description 에디터를 위한 데이터 추가 (helpers.js 사용)
    data = await itemSheetData.enrichSheetData(item, data);

    return data;
  }

  /** @override */
  activateListeners(html) {
    super.activateListeners(html);
    const root = compat.unwrapRoot(html);

    // Target Tab 통합 리스너는 부모 클래스(item-sheet.js)에서 자동 설정됨

    // 속성 관리 이벤트 리스너 설정 (helpers.js 사용)
    itemSheetData.activateAttributeControls(this, html);

    // active.runTiming 변경 시 즉시 저장
    compat.on(root, 'change', 'select[name="system.active.runTiming"]', async (event) => {
      const value = event.target.value;
      try {
        await this.item.update({ 'system.active.runTiming': value });
      } catch (e) {
        console.error('DX3rd | EtcSheet active.runTiming update failed', e);
      }
    });

    itemSheetData.activateStateDisableListeners(this, root);
    itemSheetData.activateSystemFieldListeners(this, root, {
      logPrefix: 'EtcSheet'
    });
  }

  /** @override */
  async _updateObject(event, formData) {
    return itemSheetData.submitSanitizedFormData(this.item, formData);
  }

  // _onActiveDisableChange와 _onUsedDisableChange는 부모 클래스(item-sheet.js)에서 상속됨
}

// Etc 시트 등록 (v13 호환)
const ItemsClass = foundry.documents?.collections?.Items || Items;
ItemsClass.registerSheet('dx3rd-emanim', DX3rdEtcSheet, {
  label: 'DX3rd.SheetV1',
  types: ['etc'],
  makeDefault: true
});

// 전역 노출
window.DX3rdEtcSheet = DX3rdEtcSheet;
})();
