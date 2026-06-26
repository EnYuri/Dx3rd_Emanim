// Record 아이템 시트
(function() {
class DX3rdRecordSheet extends window.DX3rdItemSheet {
  /** @override */
  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      template: "systems/dx3rd-emanim/templates/item/record-sheet.html",
      width: 520,
      height: 480
    });
  }

  /** @override */
  async getData(options) {
    let data = await super.getData(options);

    // Description 원문을 아이템에서 보강
    if (data.system.description === undefined) {
      data.system.description = this.item.system?.description || "";
    }

    // 기본 시스템 데이터 초기화 (기존 데이터 보존)
    if (!data.system.exp) data.system.exp = this.item.system?.exp || 0;
    if (!data.system.encroachment) data.system.encroachment = this.item.system?.encroachment || 0;

    // Description 에디터를 위한 데이터 추가 (helpers.js 사용)
    data = await window.DX3rdDescriptionManager.enrichSheetData(data, this.item);

    return data;
  }

  /** @override */
  activateListeners(html) {
    // 부모 클래스의 기본 activateListeners 호출
    (foundry.appv1?.sheets?.ItemSheet ?? ItemSheet).prototype.activateListeners.call(this, html);

    // 일반적인 system 필드 변경 시 즉시 저장
    html.on('change', 'input[name^="system."], select[name^="system."], textarea[name^="system."]', async (event) => {
      const element = event.currentTarget;
      const name = element.name;
      let value = element.value;

      // 숫자 필드 처리
      if (element.dataset.dtype === 'Number') {
        value = parseInt(value) || 0;
      }
      
      try {
        await this.item.update({ [name]: value });
      } catch (error) {
        console.error("DX3rd | RecordSheet field update failed", error);
      }
    });
  }
}

// Record 시트 등록 (v13 호환)
const ItemsClass = foundry.documents?.collections?.Items || Items;
ItemsClass.registerSheet('dx3rd-emanim', DX3rdRecordSheet, {
  types: ['record'],
  makeDefault: true
});

// 전역 노출
window.DX3rdRecordSheet = DX3rdRecordSheet;
})();
