// Vehicle 아이템 시트
(function() {
class DX3rdVehicleSheet extends window.DX3rdItemSheet {
  /** @override */
  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      template: "systems/dx3rd-emanim/templates/item/vehicle-sheet.html",
      width: 520,
      height: 480
    });
  }

  /** @override */
  _getHeaderButtons() {
    let buttons = super._getHeaderButtons();
    
    // 확장 도구 버튼 추가
    buttons.unshift({
      label: game.i18n.localize("DX3rd.ItemExtend"),
      class: "item-extend",
      icon: "fa-solid fa-screwdriver-wrench",
      onclick: (ev) => this._onItemExtendClick(ev)
    });
    
    return buttons;
  }
  
  async _onItemExtendClick(event) {
    event.preventDefault();
    
    const actor = this.item.actor;
    
    // 확장 도구 다이얼로그 열기 (액터가 있으면 actorId 전달, 없으면 null)
    new DX3rdItemExtendDialog({
      title: game.i18n.localize("DX3rd.ItemExtend"),
      actorId: actor ? actor.id : null,
      itemId: this.item.id,
      buttons: {
        close: {
          icon: '<i class="fas fa-times"></i>',
          label: game.i18n.localize("DX3rd.Close")
        }
      },
      default: "close"
    }).render(true);
  }

  /** @override */
  async getData(options) {
    let data = await super.getData(options);

    // Description 원문을 아이템에서 보강
    if (data.system.description === undefined) {
      data.system.description = this.item.system?.description || "";
    }

    // 액터 스킬 데이터 추가
    const actor = this.actor;
    data.system.actorSkills = actor?.system?.attributes?.skills || {};
    // 통합 스킬 선택 옵션 생성
    if (window.DX3rdSkillManager && window.DX3rdSkillManager.getSkillSelectOptions) {
      data.system.skillOptions = window.DX3rdSkillManager.getSkillSelectOptions('vehicle', data.system.actorSkills);
    } else {
      console.error('DX3rd | SkillManager not found');
      data.system.skillOptions = [];
    }

    // 기본 시스템 데이터 초기화 (기존 데이터 보존)
    if (!data.system.skill) data.system.skill = this.item.system?.skill || "-";
    if (!data.system.attack) data.system.attack = this.item.system?.attack || 0;
    if (!data.system.init) data.system.init = this.item.system?.init || 0;
    if (!data.system.armor) data.system.armor = this.item.system?.armor || 0;
    if (!data.system.move) data.system.move = this.item.system?.move || 0;
    if (!data.system.exp) data.system.exp = this.item.system?.exp || 0;
    if (data.system.macro === undefined) data.system.macro = this.item.system?.macro || "";
    
    // equipment는 "on" 문자열일 수 있으므로 명시적으로 boolean으로 변환
    const rawEquipment = this.item.system?.equipment;
    if (rawEquipment === 'on' || rawEquipment === true) {
      data.system.equipment = true;
    } else {
      data.system.equipment = false;
    }

    // saving 객체 초기화 (기존 데이터 보존)
    if (!data.system.saving) data.system.saving = {};
    data.system.saving.difficulty = this.item.system?.saving?.difficulty || "";
    data.system.saving.value = this.item.system?.saving?.value || 0;

    // active 객체 초기화 (기존 데이터 보존)
    if (!data.system.active) data.system.active = {};
    if (!data.system.active.state) data.system.active.state = this.item.system?.active?.state || false;
    if (!data.system.active.disable) data.system.active.disable = this.item.system?.active?.disable || "-";
    if (!data.system.active.runTiming) data.system.active.runTiming = this.item.system?.active?.runTiming || "-";
    
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

    // getTarget 초기화 (기존 데이터 보존)
    if (!data.system.getTarget) data.system.getTarget = this.item.system?.getTarget || false;

    // effect 객체 초기화 (기존 데이터 보존)
    if (!data.system.effect) data.system.effect = {};
    if (!data.system.effect.disable) data.system.effect.disable = this.item.system?.effect?.disable || "notCheck";
    if (!data.system.effect.runTiming) data.system.effect.runTiming = this.item.system?.effect?.runTiming || "-";

    // attributes 초기화 (기존 데이터 보존)
    if (!data.system.attributes) data.system.attributes = {};
    if (this.item.system?.attributes) {
      data.system.attributes = { ...this.item.system.attributes };
    }

    // effect.attributes 초기화 (기존 데이터 보존)
    if (!data.system.effect.attributes) data.system.effect.attributes = {};
    if (this.item.system?.effect?.attributes) {
      data.system.effect.attributes = { ...this.item.system.effect.attributes };
    }

    // getTarget 체크박스 초기화
    if (data.system.getTarget === undefined) {
      data.system.getTarget = this.item.system.getTarget || false;
    }

    // scene 체크박스 초기화
    if (data.system.scene === undefined) {
      data.system.scene = this.item.system.scene || false;
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

    // Target Tab 통합 리스너는 부모 클래스(item-sheet.js)에서 자동 설정됨

    // 속성 관리 이벤트 리스너 설정 (helpers.js 사용)
    window.DX3rdAttributeManager.setupAttributeListeners(html, this);
    window.DX3rdAttributeManager.initializeAttributeLabels(html, this.item);

    // active.disable 변경 시 처리
    html.on('change', 'select[name="system.active.disable"]', this._onActiveDisableChange.bind(this));
    
    // active.runTiming은 비활성화됨 (비클은 항상 instant)

    // used.disable 변경 시 처리
    html.on('change', 'select[name="system.used.disable"]', this._onUsedDisableChange.bind(this));

    // input 필드 즉시 업데이트 (equipment는 _updateObject에서 처리)
    html.on('change', 'input[name^="system."]:not([name="system.equipment"])', async (event) => {
      if (this._isAddingAttribute) return;
      
      const name = event.currentTarget.name;
      
      // 전용 핸들러가 있는 필드는 제외
      const excludedFields = [
        'system.getTarget',
        'system.scene'
      ];
      if (excludedFields.includes(name)) return;
      
      const value = event.currentTarget.type === 'checkbox' ? event.currentTarget.checked : event.currentTarget.value;
      
      // 즉시 저장
      try {
        const updates = foundry.utils.expandObject({
          [name]: event.currentTarget.type === 'number' ? parseInt(value) || 0 : 
                  event.currentTarget.type === 'checkbox' ? value : 
                  value
        });
        await this.item.update(updates);
      } catch (error) {
        console.error("DX3rd | VehicleSheet input update failed", error);
      }
    });
    
    // select 필드 즉시 업데이트 (전용 핸들러가 있는 필드 제외)
    html.on('change', 'select[name^="system."]:not([name$=".key"]):not([name="system.getTarget"]):not([name="system.scene"]):not([name="system.effect.disable"]):not([name="system.effect.runTiming"]):not([name="system.active.disable"]):not([name="system.active.runTiming"]):not([name="system.used.disable"])', async (event) => {
      if (this._isAddingAttribute) return;
      
      const name = event.currentTarget.name;
      const value = event.currentTarget.value;
      
      // 즉시 저장
      try {
        const updates = foundry.utils.expandObject({
          [name]: value
        });
        await this.item.update(updates);
      } catch (error) {
        console.error("DX3rd | VehicleSheet select update failed", error);
      }
    });
    
    // textarea 필드 즉시 업데이트
    html.on('change', 'textarea[name^="system."]', async (event) => {
      if (this._isAddingAttribute) return;
      
      const name = event.currentTarget.name;
      const value = event.currentTarget.value;
      
      // 즉시 저장
      try {
        const updates = foundry.utils.expandObject({
          [name]: value
        });
        await this.item.update(updates);
      } catch (error) {
        console.error("DX3rd | VehicleSheet textarea update failed", error);
      }
    });
  }

  /** @override */
  _getSubmitData(updateData) {
    let formData = super._getSubmitData(updateData);
    return formData;
  }

  /** @override */
  async _updateObject(event, formData) {
    // Target Tab의 즉시 저장 필드들은 formData에서 제외 (부모 클래스 리스너에서 처리)
    delete formData['system.getTarget'];
    delete formData['system.scene'];
    delete formData['system.effect.disable'];
    delete formData['system.effect.runTiming'];
    
    // 체크박스 값 정규화 (on/off 문자열을 boolean으로 변환)
    if (formData['system.equipment'] !== undefined) {
      formData['system.equipment'] = formData['system.equipment'] === 'on' || formData['system.equipment'] === true;
    } else {
      formData['system.equipment'] = false;
    }
    
    // formData를 바로 사용 (expandObject는 다른 속성을 덮어쓸 수 있음)
    const result = await this.item.update(formData);
    
    return result;
  }

  // _onActiveDisableChange와 _onUsedDisableChange는 부모 클래스(item-sheet.js)에서 상속됨
}

// Vehicle 시트 등록 (v13 호환)
const ItemsClass = foundry.documents?.collections?.Items || Items;
ItemsClass.registerSheet('dx3rd-emanim', DX3rdVehicleSheet, {
  types: ['vehicle'],
  makeDefault: true
});

// 전역 노출
window.DX3rdVehicleSheet = DX3rdVehicleSheet;
})();
