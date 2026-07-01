// Protect 아이템 시트
(function() {
const compat = window.DX3rdApplicationCompat;
const itemSheetData = window.DX3rdItemSheetData;

class DX3rdProtectSheet extends window.DX3rdItemSheet {
  /** @override */
  async getData(options) {
    let data = await super.getData(options);
    const item = this.item;

    // 기본 시스템 데이터 초기화 (기존 데이터 보존)
    if (!data.system.dodge) data.system.dodge = this.item.system?.dodge || 0;
    if (!data.system.init) data.system.init = this.item.system?.init || 0;
    if (!data.system.armor) data.system.armor = this.item.system?.armor || 0;
    if (!data.system.exp) data.system.exp = this.item.system?.exp || 0;
    if (data.system.macro === undefined) data.system.macro = this.item.system?.macro || "";
    
    // equipment는 "on" 문자열일 수 있으므로 명시적으로 boolean으로 변환
    itemSheetData.prepareEquipmentData(item, data);

    // saving 객체 초기화 (기존 데이터 보존)
    itemSheetData.prepareSavingData(item, data);

    // active 객체 초기화 (기존 데이터 보존)
    itemSheetData.prepareActiveData(item, data, {runTimingFallback: '-'});
    
    // used 객체 초기화 (기존 데이터 보존)
    itemSheetData.prepareUsedData(item, data);

    // effect 객체 초기화 (기존 데이터 보존)
    itemSheetData.prepareEffectData(item, data, {runTimingFallback: '-'});

    // attributes 초기화 (기존 데이터 보존)
    itemSheetData.preserveAttributeData(item, data);

    // 액터 스킬 데이터 추가 (방어구는 스킬 선택이 없으므로 기본값만 설정)
    if (this.actor) {
      data.system.actorSkills = this.actor.system?.attributes?.skills || {};
    } else {
      data.system.actorSkills = {};
    }

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
    itemSheetData.activateStateDisableListeners(this, root);
    
    // active.runTiming은 비활성화됨 (프로텍트는 항상 instant)

    // equipment는 체크박스 문자열("on")이 남지 않도록 boolean으로 확정 저장
    itemSheetData.activateEquipmentListener(this, root, {logPrefix: 'ProtectSheet'});
    itemSheetData.activateSystemFieldListeners(this, root, {
      logPrefix: 'ProtectSheet',
      inputSelector: 'input[name^="system."]:not([name="system.equipment"])'
    });
  }

  /** @override */
  async _updateObject(event, formData) {
    return itemSheetData.submitSanitizedFormData(this.item, formData, {
      normalizeEquipment: true
    });
  }

  // _onActiveDisableChange와 _onUsedDisableChange는 부모 클래스(item-sheet.js)에서 상속됨
}

// Protect 시트 등록 (v13 호환)
const ItemsClass = foundry.documents?.collections?.Items || Items;
ItemsClass.registerSheet('dx3rd-emanim', DX3rdProtectSheet, {
  label: 'DX3rd.SheetV1',
  types: ['protect'],
  makeDefault: true
});

// 전역 노출
window.DX3rdProtectSheet = DX3rdProtectSheet;
})();
