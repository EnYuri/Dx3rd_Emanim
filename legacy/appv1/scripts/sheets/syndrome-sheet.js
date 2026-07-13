// Archived AppV1 Syndrome item sheet
(function() {
const compat = window.DX3rdApplicationCompat;
const itemSheetData = window.DX3rdItemSheetData;

class DX3rdSyndromeSheet extends window.DX3rdItemSheet {
  /** @override */
  async getData(options) {
    let data = await super.getData(options);

    // Description 원문 보강 및 리치 텍스트 생성
    data = await itemSheetData.enrichSheetData(this.item, data);

    // attributes 기본값 보강 (body/sense/mind/social)
    itemSheetData.prepareAbilityAttributeValues(this.item, data);

    return data;
  }

  /** @override */
  activateListeners(html) {
    super.activateListeners(html);
    const root = compat.unwrapRoot(html);

    // 능력치 입력 변경 리스너 (body/sense/mind/social)
    compat.on(root, 'change', 'input[name="system.attributes.body.value"], input[name="system.attributes.sense.value"], input[name="system.attributes.mind.value"], input[name="system.attributes.social.value"]', this._onAttrChange.bind(this));
  }

  async _onAttrChange(event) {
    event.preventDefault();
    const input = event.target;
    const path = input.name; // e.g., system.attributes.body.value
    const value = Number(input.value) || 0;

    try {
      await itemSheetData.updateAfterDefault(this.item, { [path]: value });
    } catch (err) {
      console.error("DX3rd | SyndromeSheet attribute update failed", err);
    }
  }
}

// Syndrome 시트 등록 (v13/v14 호환)
const ItemsClass = foundry.documents?.collections?.Items || Items;
ItemsClass.registerSheet('dx3rd-emanim', DX3rdSyndromeSheet, {
  label: 'DX3rd.SheetV1',
  types: ['syndrome'],
  makeDefault: true
});

// 전역 노출
window.DX3rdSyndromeSheet = DX3rdSyndromeSheet;
})();
