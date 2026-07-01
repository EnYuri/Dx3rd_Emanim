// Record 아이템 시트
(function() {
const compat = window.DX3rdApplicationCompat;
const itemSheetData = window.DX3rdItemSheetData;

class DX3rdRecordSheet extends window.DX3rdItemSheet {
  /** @override */
  async getData(options) {
    let data = await super.getData(options);

    // 기본 시스템 데이터 초기화 (기존 데이터 보존)
    if (!data.system.exp) data.system.exp = this.item.system?.exp || 0;
    if (!data.system.encroachment) data.system.encroachment = this.item.system?.encroachment || 0;

    // Description 에디터를 위한 데이터 추가 (helpers.js 사용)
    data = await itemSheetData.enrichSheetData(this.item, data);

    return data;
  }

  /** @override */
  activateListeners(html) {
    // 부모 클래스의 기본 activateListeners 호출
    itemSheetData.activateBaseItemListeners(this, html);
    const root = compat.unwrapRoot(html);

    // 일반적인 system 필드 변경 시 즉시 저장
    compat.on(root, 'change', 'input[name^="system."], select[name^="system."], textarea[name^="system."]', async (event) => {
      const element = event.target;
      const name = element.name;
      let value = element.value;

      // 숫자 필드 처리
      if (element.dataset.dtype === 'Number') {
        value = Number(value) || 0;
      }
      
      try {
        await itemSheetData.updateAfterDefault(this.item, { [name]: value });
      } catch (error) {
        console.error("DX3rd | RecordSheet field update failed", error);
      }
    });
  }
}

// Record 시트 등록 (v13 호환)
const ItemsClass = foundry.documents?.collections?.Items || Items;
ItemsClass.registerSheet('dx3rd-emanim', DX3rdRecordSheet, {
  label: 'DX3rd.SheetV1',
  types: ['record'],
  makeDefault: true
});

// 전역 노출
window.DX3rdRecordSheet = DX3rdRecordSheet;
})();
