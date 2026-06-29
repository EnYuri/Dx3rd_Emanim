// Once 아이템 시트
(function() {
const compat = window.DX3rdApplicationCompat;
const itemSheetData = window.DX3rdItemSheetData;

class DX3rdOnceSheet extends window.DX3rdItemSheet {
  /** @override */
  async getData(options) {
    let data = await super.getData(options);
    const item = this.item;

    // system.type을 "once"로 설정 (실제 타입 값)
    if (!data.system.type) {
      data.system.type = "once";
    }
    
    // 표시용 displayType 설정
    data.displayType = "DX3rd.Once";

    // 기본 시스템 데이터 초기화 (기존 데이터 보존)
    if (!data.system.exp) data.system.exp = this.item.system?.exp || 0;
    if (!data.system.quantity) data.system.quantity = this.item.system?.quantity || 1;
    if (data.system.macro === undefined) data.system.macro = this.item.system?.macro || "";

    // saving 객체 초기화 (기존 데이터 보존)
    itemSheetData.prepareSavingData(item, data);

    // used 객체 초기화 (기존 데이터 보존)
    itemSheetData.prepareUsedData(item, data, {maxFallback: data.system.quantity});

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
        console.error('DX3rd | OnceSheet active.runTiming update failed', e);
      }
    });

    // quantity 변경 시 used.max 업데이트
    compat.on(root, 'change', 'input[name="system.quantity"]', this._onQuantityChange.bind(this));

    itemSheetData.activateStateDisableListeners(this, root);
    itemSheetData.activateSystemFieldListeners(this, root, {
      logPrefix: 'OnceSheet',
      inputExclude: [
        'system.getTarget',
        'system.scene',
        'system.quantity'
      ]
    });
  }

  /** @override */
  async _updateObject(event, formData) {
    return itemSheetData.submitSanitizedFormData(this.item, formData, {
      remove: ['system.used.max']
    });
  }

  // _onActiveDisableChange는 부모 클래스(item-sheet.js)에서 상속됨
  
  // once는 quantity와 used.max 연동이 필요하므로 _onUsedDisableChange 재정의
  async _onUsedDisableChange(event) {
    const disable = event.target?.value ?? event.currentTarget.value;
    
    try {
      if (disable === "notCheck") {
        await itemSheetData.updateAfterDefault(this.item, {
          "system.used.disable": disable,
          "system.used.state": 0,
          "system.used.max": 0
        });
      } else {
        // notCheck가 아닌 경우 used.max를 quantity로 복원
        const quantity = Number(this.item.system.quantity) || 1;
        await itemSheetData.updateAfterDefault(this.item, {
          "system.used.disable": disable,
          "system.used.max": quantity
        });
      }
    } catch (error) {
      console.error("DX3rd | OnceSheet _onUsedDisableChange failed", error);
    }
  }

  async _onQuantityChange(event) {
    const quantity = parseInt(event.target.value) || 1;

    // quantity 변경 시 used.max도 함께 업데이트 (notCheck가 아닌 경우에만)
    const updates = {
      "system.quantity": quantity
    };
    if (this.item.system.used?.disable !== "notCheck") {
      updates["system.used.max"] = quantity;
    }

    try {
      await itemSheetData.updateAfterDefault(this.item, updates);
    } catch (error) {
      console.error("DX3rd | OnceSheet _onQuantityChange failed", error);
    }
  }
}

// Once 시트 등록 (v13 호환)
const ItemsClass = foundry.documents?.collections?.Items || Items;
ItemsClass.registerSheet('dx3rd-emanim', DX3rdOnceSheet, {
  types: ['once'],
  makeDefault: true
});

// 전역 노출
window.DX3rdOnceSheet = DX3rdOnceSheet;
})();
