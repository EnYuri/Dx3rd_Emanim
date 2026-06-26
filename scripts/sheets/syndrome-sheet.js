// Syndrome 아이템 시트
(function() {
class DX3rdSyndromeSheet extends window.DX3rdItemSheet {
  /** @override */
  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      template: "systems/dx3rd-emanim/templates/item/syndrome-sheet.html",
      width: 520,
      height: 480
    });
  }

  /** @override */
  async getData(options) {
    let data = await super.getData(options);

    // Description 원문 보강 및 리치 텍스트 생성
    if (data.system.description === undefined) {
      data.system.description = this.item.system?.description || "";
    }
    data = await window.DX3rdDescriptionManager.enrichSheetData(data, this.item);

    // attributes 기본값 보강 (body/sense/mind/social)
    const currentAttrs = this.item.system?.attributes || {};
    data.system.attributes = data.system.attributes || {};

    data.system.attributes.body = currentAttrs.body || data.system.attributes.body || {};
    if (data.system.attributes.body.value == null) data.system.attributes.body.value = 0;

    data.system.attributes.sense = currentAttrs.sense || data.system.attributes.sense || {};
    if (data.system.attributes.sense.value == null) data.system.attributes.sense.value = 0;

    data.system.attributes.mind = currentAttrs.mind || data.system.attributes.mind || {};
    if (data.system.attributes.mind.value == null) data.system.attributes.mind.value = 0;

    data.system.attributes.social = currentAttrs.social || data.system.attributes.social || {};
    if (data.system.attributes.social.value == null) data.system.attributes.social.value = 0;

    return data;
  }

  /** @override */
  activateListeners(html) {
    super.activateListeners(html);

    // 능력치 입력 변경 리스너 (body/sense/mind/social)
    html.on('change', 'input[name="system.attributes.body.value"]', this._onAttrChange.bind(this));
    html.on('change', 'input[name="system.attributes.sense.value"]', this._onAttrChange.bind(this));
    html.on('change', 'input[name="system.attributes.mind.value"]', this._onAttrChange.bind(this));
    html.on('change', 'input[name="system.attributes.social.value"]', this._onAttrChange.bind(this));
  }

  async _onAttrChange(event) {
    event.preventDefault();
    const input = event.currentTarget;
    const path = input.name; // e.g., system.attributes.body.value
    const value = Number(input.value) || 0;

    try {
      await this.item.update({ [path]: value });
    } catch (err) {
      console.error("DX3rd | SyndromeSheet attribute update failed", err);
    }
  }
}

// Syndrome 시트 등록 (v13/v14 호환)
const ItemsClass = foundry.documents?.collections?.Items || Items;
ItemsClass.registerSheet('dx3rd-emanim', DX3rdSyndromeSheet, {
  types: ['syndrome'],
  makeDefault: true
});

// 전역 노출
window.DX3rdSyndromeSheet = DX3rdSyndromeSheet;
})();
