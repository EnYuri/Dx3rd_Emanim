// Connection 아이템 시트
(function() {
class DX3rdConnectionSheet extends window.DX3rdItemSheet {
  /** @override */
  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      template: "systems/dx3rd-emanim/templates/item/connection-sheet.html",
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
    if (!data.system.skill) data.system.skill = this.item.system?.skill || "-";
    if (!data.system.exp) data.system.exp = this.item.system?.exp || 0;
    if (data.system.macro === undefined) data.system.macro = this.item.system?.macro || "";

    // saving 객체 초기화 (기존 데이터 보존)
    if (!data.system.saving) data.system.saving = {};
    data.system.saving.difficulty = this.item.system?.saving?.difficulty || "";
    data.system.saving.value = this.item.system?.saving?.value || 0;

    // used 객체 초기화 (기존 데이터 보존)
    if (!data.system.used) data.system.used = {};
    if (this.item.system?.used) {
      data.system.used.state = this.item.system.used.state ?? 0;
      data.system.used.max = this.item.system.used.max ?? 0;
      data.system.used.level = this.item.system.used.level ?? false;
      data.system.used.disable = this.item.system.used.disable ?? 'notCheck';
    } else {
      data.system.used.state = 0;
      data.system.used.max = 0;
      data.system.used.level = false;
      data.system.used.disable = 'notCheck';
    }

    // active 객체 초기화 (기존 데이터 보존)
    if (!data.system.active) data.system.active = {};
    if (!data.system.active.state) data.system.active.state = this.item.system?.active?.state || false;
    if (!data.system.active.disable) data.system.active.disable = this.item.system?.active?.disable || "-";
    if (!data.system.active.runTiming) data.system.active.runTiming = this.item.system?.active?.runTiming || "instant";

    // attributes 초기화 (기존 데이터 보존)
    if (!data.system.attributes) data.system.attributes = {};
    if (this.item.system?.attributes) {
      data.system.attributes = { ...this.item.system.attributes };
    }

    // 액터 스킬 데이터 추가
    if (this.actor) {
      data.system.actorSkills = this.actor.system?.attributes?.skills || {};
      // 통합 스킬 선택 옵션 생성 (커넥션용 - 신드롬 제외)
      data.system.skillOptions = window.DX3rdSkillManager.getSkillSelectOptions('connection', data.system.actorSkills);
    } else {
      data.system.actorSkills = {};
      data.system.skillOptions = [];
    }

    // Description 에디터를 위한 데이터 추가 (helpers.js 사용)
    if (window.DX3rdDescriptionManager) {
      data = await window.DX3rdDescriptionManager.enrichSheetData(data, this.item);
    }

    return data;
  }

  /** @override */
  activateListeners(html) {
    super.activateListeners(html);

    // 속성 추가 플래그 초기화
    this._isAddingAttribute = false;

    // 속성 관리 이벤트 리스너 설정 (helpers.js 사용)
    window.DX3rdAttributeManager.setupAttributeListeners(html, this);
    window.DX3rdAttributeManager.initializeAttributeLabels(html, this.item);

    // active.runTiming 변경 시 즉시 저장
    html.on('change', 'select[name="system.active.runTiming"]', async (event) => {
      const value = event.currentTarget.value;
      try {
        await this.item.update({ 'system.active.runTiming': value });
      } catch (e) {
        console.error('DX3rd | ConnectionSheet active.runTiming update failed', e);
      }
    });

    // used.disable 변경 시 처리
    html.on('change', 'select[name="system.used.disable"]', this._onUsedDisableChange.bind(this));

    // active.disable 변경 시 처리
    html.on('change', 'select[name="system.active.disable"]', this._onActiveDisableChange.bind(this));

    // 일반적인 system 필드 변경 시 즉시 저장 (속성 키 필드 및 disable 필드 제외)
    html.on('change', 'input[name^="system."]:not([name$=".key"]):not([name="system.used.disable"]):not([name="system.active.disable"]), select[name^="system."]:not([name$=".key"]):not([name="system.used.disable"]):not([name="system.active.disable"]), textarea[name^="system."]', (event) => {
      if (this._isAddingAttribute) return; // 속성 추가 중에는 저장하지 않음
      
      const element = event.currentTarget;
      const name = element.name;
      let value = element.value;

      // 체크박스 처리
      if (element.type === 'checkbox') {
        value = element.checked;
      }

      // 숫자 필드 처리
      if (element.dataset.dtype === 'Number') {
        value = parseInt(value) || 0;
      }
      
      this.item.update({ [name]: value });
    });
  }


  /** @override */
  _getSubmitData(updateData) {
    let formData = super._getSubmitData(updateData);
    
    return formData;
  }

  /** @override */
  async _updateObject(event, formData) {
    // formData를 바로 사용 (expandObject는 다른 속성을 덮어쓸 수 있음)
    const result = await this.item.update(formData);
    
    return result;
  }

  /**
   * 속성 추가 (Attributes 탭)
   */
  async _onCreateAttribute(event) {
    event.preventDefault();
    const position = $(event.currentTarget).data('pos');
    
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
    const attributeKey = $(event.currentTarget).data('attribute');
    const position = $(event.currentTarget).closest('.attributes-list').data('pos');
    
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
  types: ['connection'],
  makeDefault: true
});

// 전역 노출
window.DX3rdConnectionSheet = DX3rdConnectionSheet;
})();
