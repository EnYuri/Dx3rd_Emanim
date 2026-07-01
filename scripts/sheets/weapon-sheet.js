// Weapon 아이템 시트
(function() {
const compat = window.DX3rdApplicationCompat;
const itemSheetData = window.DX3rdItemSheetData;

class DX3rdWeaponSheet extends window.DX3rdItemSheet {
  /** @override */
  async getData(options) {
    let data = await super.getData(options);
    const item = this.item;

    // 액터 스킬 데이터 추가
    itemSheetData.prepareSkillOptions(item, data, 'weapon', {warnIfMissing: true});

    // 기본 시스템 데이터 초기화 (기존 데이터 보존)
    if (!data.system.type) data.system.type = this.item.system?.type || "-";
    if (!data.system.skill) data.system.skill = this.item.system?.skill || "-";
    if (!data.system.add) data.system.add = this.item.system?.add || 0;
    if (!data.system.attack) data.system.attack = this.item.system?.attack || 0;
    if (!data.system.guard) data.system.guard = this.item.system?.guard || 0;
    if (!data.system.range) data.system.range = this.item.system?.range || "";
    if (!data.system.exp) data.system.exp = this.item.system?.exp || 0;
    if (data.system.macro === undefined) data.system.macro = this.item.system?.macro || "";
    
    // equipment는 "on" 문자열일 수 있으므로 명시적으로 boolean으로 변환
    itemSheetData.prepareEquipmentData(item, data);

    // saving 객체 초기화 (기존 데이터 보존)
    itemSheetData.prepareSavingData(item, data);

    // active 객체 초기화 (기존 데이터 보존)
    itemSheetData.prepareActiveData(item, data);
    
    // used 객체 초기화 (기존 데이터 보존)
    itemSheetData.prepareUsedData(item, data);

    // attack-used 객체 초기화 (기존 데이터 보존)
    if (!data.system['attack-used']) data.system['attack-used'] = {};
    if (this.item.system?.['attack-used']) {
      data.system['attack-used'].state = this.item.system['attack-used'].state ?? 0;
      data.system['attack-used'].max = this.item.system['attack-used'].max ?? 0;
      data.system['attack-used'].disable = this.item.system['attack-used'].disable ?? 'notCheck';
    } else {
      data.system['attack-used'].state = 0;
      data.system['attack-used'].max = 0;
      data.system['attack-used'].disable = 'notCheck';
    }

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
    itemSheetData.activateStateDisableListeners(this, root);
    
    // active.runTiming은 비활성화됨 (웨폰은 항상 instant)

    // attack-used.disable 변경 시 처리
    compat.on(root, 'change', 'select[name="system.attack-used.disable"]', this._onAttackUsedDisableChange.bind(this));

    // equipment는 체크박스 문자열("on")이 남지 않도록 boolean으로 확정 저장
    itemSheetData.activateEquipmentListener(this, root, {logPrefix: 'WeaponSheet'});
    itemSheetData.activateSystemFieldListeners(this, root, {
      logPrefix: 'WeaponSheet',
      inputSelector: 'input[name^="system."]:not([name="system.equipment"])',
      selectExclude: [
        'system.getTarget',
        'system.scene',
        'system.effect.disable',
        'system.effect.runTiming',
        'system.active.disable',
        'system.active.runTiming',
        'system.used.disable',
        'system.attack-used.disable'
      ]
    });
  }

  /** @override */
  async _updateObject(event, formData) {
    return itemSheetData.submitSanitizedFormData(this.item, formData, {
      normalizeEquipment: true
    });
  }

  // _onActiveDisableChange와 _onUsedDisableChange는 부모 클래스(item-sheet.js)에서 상속됨
  
  // attack-used.disable 변경 핸들러 (weapon 전용)
  async _onAttackUsedDisableChange(event) {
    const disable = event.target.value;
    const updates = {
      "system.attack-used.disable": disable
    };

    if (disable === "notCheck") {
      updates["system.attack-used.state"] = 0;
      updates["system.attack-used.max"] = 0;
    }

    try {
      await itemSheetData.updateAfterDefault(this.item, updates);
    } catch (error) {
      console.error("DX3rd | WeaponSheet attack-used.disable update failed", error);
    }
  }
}

// Weapon 시트 등록 (v13 호환)
const ItemsClass = foundry.documents?.collections?.Items || Items;
ItemsClass.registerSheet('dx3rd-emanim', DX3rdWeaponSheet, {
  label: 'DX3rd.SheetV1',
  types: ['weapon'],
  makeDefault: true
});

// 전역 노출
window.DX3rdWeaponSheet = DX3rdWeaponSheet;
})();
