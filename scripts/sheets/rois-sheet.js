// Rois 아이템 시트
(function() {
const compat = window.DX3rdApplicationCompat;
const itemSheetData = window.DX3rdItemSheetData;

class DX3rdRoisSheet extends window.DX3rdItemSheet {
  /** @override */
  async getData(options) {
    let data = await super.getData(options);

    // 기본 시스템 데이터 초기화 (기존 데이터 보존)
    if (!data.system.type) data.system.type = this.item.system?.type || "-";
    
    if (!data.system.positive) data.system.positive = {};
    if (!data.system.positive.state) data.system.positive.state = this.item.system?.positive?.state || false;
    if (!data.system.positive.feeling) data.system.positive.feeling = this.item.system?.positive?.feeling || "";

    if (!data.system.negative) data.system.negative = {};
    if (!data.system.negative.state) data.system.negative.state = this.item.system?.negative?.state || false;
    if (!data.system.negative.feeling) data.system.negative.feeling = this.item.system?.negative?.feeling || "";

    if (!data.system.actor) data.system.actor = this.item.system?.actor || null;
    if (!data.system.titus) data.system.titus = this.item.system?.titus || false;
    if (!data.system.sublimation) data.system.sublimation = this.item.system?.sublimation || false;

    // used 객체 초기화 (기존 데이터 보존)
    if (!data.system.used) data.system.used = {};
    if (!data.system.used.state) data.system.used.state = this.item.system?.used?.state || 0;
    if (!data.system.used.max) data.system.used.max = this.item.system?.used?.max || 0;
    if (!data.system.used.level) data.system.used.level = this.item.system?.used?.level || false;
    if (!data.system.used.disable) data.system.used.disable = this.item.system?.used?.disable || "notCheck";

    // Description 에디터를 위한 데이터 추가 (helpers.js 사용)
    data = await itemSheetData.enrichSheetData(this.item, data);

    return data;
  }

  /** @override */
  activateListeners(html) {
    // 부모 클래스의 기본 activateListeners 호출
    itemSheetData.activateBaseItemListeners(this, html);
    const root = compat.unwrapRoot(html);

    // Positive/Negative 체크박스 상호 배타 로직
    compat.on(root, 'change', 'input[name="system.positive.state"]', this._onPositiveChange.bind(this));
    compat.on(root, 'change', 'input[name="system.negative.state"]', this._onNegativeChange.bind(this));
    
    // Titus/Sublimation 체크박스 로직
    compat.on(root, 'change', 'input[name="system.titus"]', this._onTitusChange.bind(this));
    compat.on(root, 'change', 'input[name="system.sublimation"]', this._onSublimationChange.bind(this));

    // system.type 변경 시 Titus/Sublimation 상태 처리
    compat.on(root, 'change', 'select[name="system.type"]', this._onTypeChange.bind(this));

    // 일반적인 system 필드 변경 시 즉시 저장 (체크박스 제외 - 위에서 별도 처리)
    compat.on(root, 'change', 'input[name^="system."]:not([name*=".state"]):not([name="system.titus"]):not([name="system.sublimation"]), select[name^="system."]:not([name="system.type"]), textarea[name^="system."]', async (event) => {
      const element = event.target;
      const name = element.name;
      let value = element.value;

      // 숫자 필드 처리
      if (element.type === 'number' || element.dataset.dtype === 'Number') {
        value = parseInt(value) || 0;
      }
      
      try {
        await itemSheetData.updateAfterDefault(this.item, { [name]: value });
      } catch (error) {
        console.error("DX3rd | RoisSheet field update failed", error);
      }
    });
  }

  async _onPositiveChange(event) {
    const isChecked = event.target.checked;
    
    try {
      if (isChecked) {
        // Positive가 체크되면 Negative 해제
        await itemSheetData.updateAfterDefault(this.item, {
          'system.positive.state': true,
          'system.negative.state': false
        });
      } else {
        // Positive가 해제되면 그대로
        await itemSheetData.updateAfterDefault(this.item, {
          'system.positive.state': false
        });
      }
    } catch (error) {
      console.error("DX3rd | RoisSheet _onPositiveChange failed", error);
    }
  }

  async _onNegativeChange(event) {
    const isChecked = event.target.checked;
    
    try {
      if (isChecked) {
        // Negative가 체크되면 Positive 해제
        await itemSheetData.updateAfterDefault(this.item, {
          'system.negative.state': true,
          'system.positive.state': false
        });
      } else {
        // Negative가 해제되면 그대로
        await itemSheetData.updateAfterDefault(this.item, {
          'system.negative.state': false
        });
      }
    } catch (error) {
      console.error("DX3rd | RoisSheet _onNegativeChange failed", error);
    }
  }

  async _onTitusChange(event) {
    const isChecked = event.target.checked;
    
    try {
      if (!isChecked) {
        // Titus가 해제되면 Sublimation도 해제
        await itemSheetData.updateAfterDefault(this.item, {
          'system.titus': false,
          'system.sublimation': false
        });
      } else {
        // Titus가 체크되면 그대로
        await itemSheetData.updateAfterDefault(this.item, {
          'system.titus': true
        });
      }
    } catch (error) {
      console.error("DX3rd | RoisSheet _onTitusChange failed", error);
    }
  }

  async _onSublimationChange(event) {
    const isChecked = event.target.checked;
    const currentTitus = this.item.system.titus;
    
    if (isChecked && !currentTitus) {
      // Sublimation을 체크하려고 하는데 Titus가 체크되지 않은 경우
      ui.notifications.warn('타이터스를 먼저 체크해야 승화를 체크할 수 있습니다.');
      event.target.checked = false;
      return;
    }
    
    try {
      if (isChecked) {
        // Sublimation이 체크되면 그대로
        await itemSheetData.updateAfterDefault(this.item, {
          'system.sublimation': true
        });
      } else {
        // Sublimation이 해제되면 그대로
        await itemSheetData.updateAfterDefault(this.item, {
          'system.sublimation': false
        });
      }
    } catch (error) {
      console.error("DX3rd | RoisSheet _onSublimationChange failed", error);
    }
  }

  async _onTypeChange(event) {
    const newType = event.target.value;
    
    try {
      // Memory 타입으로 변경되면 Titus와 Sublimation 체크 해제
      if (newType === "M") {
        await itemSheetData.updateAfterDefault(this.item, {
          'system.type': newType,
          'system.titus': false,
          'system.sublimation': false
        });
      } else {
        // 다른 타입으로 변경되면 type만 업데이트
        await itemSheetData.updateAfterDefault(this.item, {
          'system.type': newType
        });
      }
    } catch (error) {
      console.error("DX3rd | RoisSheet _onTypeChange failed", error);
    }
  }
}

// Rois 시트 등록 (v13 호환)
const ItemsClass = foundry.documents?.collections?.Items || Items;
ItemsClass.registerSheet('dx3rd-emanim', DX3rdRoisSheet, {
  label: 'DX3rd.SheetV1',
  types: ['rois'],
  makeDefault: true
});

// 전역 노출
window.DX3rdRoisSheet = DX3rdRoisSheet;
})();
