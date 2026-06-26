// Psionic 아이템 시트
(function() {
class DX3rdPsionicSheet extends window.DX3rdItemSheet {
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
  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      template: "systems/dx3rd-emanim/templates/item/psionic-sheet.html",
      width: 520,
      height: 480
    });
  }

  /** @override */
  async getData(options) {
    let data = await super.getData(options);
    const actor = this.item.actor;

    // 액터 정보 추가 (에너미 체크용)
    if (actor) {
      data.actor = {
        id: actor.id,
        type: actor.type
      };
    } else {
      data.actor = null;
    }

    // Description 보강 및 리치 텍스트 생성 (helpers.js 사용)
    if (data.system.description === undefined) {
      data.system.description = this.item.system?.description || "";
    }
    data = await window.DX3rdDescriptionManager.enrichSheetData(data, this.item);

    // actorSkills 주입
    data.system.actorSkills = actor?.system?.attributes?.skills || {};
    // 통합 스킬 선택 옵션 생성 (사이오닉용 - 신드롬 제외)
    // 에너미인 경우 능력치만 표시
    data.system.skillOptions = window.DX3rdSkillManager.getSkillSelectOptions('psionic', data.system.actorSkills, actor?.type);

    // 공통 시스템 필드 하이드레이션 (아이템의 실제 값을 우선 사용)
    // 주의: attackRoll, weaponTmp, weapon, weaponSelect는 WeaponTabManager에서 처리하므로 제외
    const systemFields = [
      'skill', 'difficulty', 'limit', 'timing', 'range', 'target', 'type',
      'roll', 'macro', 'active', 'used', 'encroach',
      'effect', 'attributes', 'exp', 'description'
    ];
    const stringFields = ['skill', 'difficulty', 'limit', 'timing', 'range', 'target', 'type', 'roll', 'macro', 'description'];
    systemFields.forEach((field) => {
      if (data.system[field] === undefined) {
        const defaultValue = stringFields.includes(field) ? '' : {};
        data.system[field] = this.item.system?.[field] ?? defaultValue;
      }
    });


    // level: 침식률 보정 없이 value = init 고정
    if (!data.system.level) data.system.level = {};
    data.system.level.init = this.item.system?.level?.init ?? 1;
    data.system.level.max = this.item.system?.level?.max ?? 1;
    data.system.level.value = Number(data.system.level.init) || 0;

    // hp 비용 (문자열일 수 있음)
    if (!data.system.hp) data.system.hp = {};
    data.system.hp.value = this.item.system?.hp?.value ?? "";

    // 무기 탭 데이터 준비 (WeaponTabManager 사용)
    data = window.DX3rdWeaponTabManager.prepareWeaponTabData(data, this.item);

    // used 복사
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
    if (data.system.active.state === undefined) data.system.active.state = this.item.system?.active?.state || false;
    if (data.system.active.disable === undefined) data.system.active.disable = this.item.system?.active?.disable || "-";
    if (data.system.active.runTiming === undefined) data.system.active.runTiming = this.item.system?.active?.runTiming || "-";

    // effect 객체 초기화 (기존 데이터 보존)
    if (!data.system.effect) data.system.effect = {};
    if (!data.system.effect.disable) data.system.effect.disable = this.item.system?.effect?.disable || "notCheck";
    if (!data.system.effect.runTiming) data.system.effect.runTiming = this.item.system?.effect?.runTiming || "-";

    // attributes와 effect.attributes의 기존 값 보존
    if (this.item.system.attributes) {
      data.system.attributes = { ...this.item.system.attributes };
    }
    
    if (this.item.system.effect?.attributes) {
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

    return data;
  }

  /** @override */
  activateListeners(html) {
    super.activateListeners(html);

    // Target Tab 통합 리스너는 부모 클래스(item-sheet.js)에서 자동 설정됨

    // 무기 선택 체크박스 변경 시 무기 목록 비우기
    html.on('change', 'input[name="system.weaponSelect"]', async (event) => {
      const isChecked = event.currentTarget.checked;
      if (isChecked) {
        // 체크되면 무기 목록 비우기
        await this.item.update({ 'system.weapon': [] });
      }
      this.render(false);
    });

    // 무기 탭 통합 리스너 (WeaponTabManager 사용)
    window.DX3rdWeaponTabManager.setupWeaponTabListeners(html, this);
    
    // 난이도 체크박스 변경 시
    html.on('change', '.difficulty-check', async (event) => {
      const isChecked = event.currentTarget.checked;
      const $difficultyInput = html.find('.difficulty-input');
      
      if (isChecked) {
        await this.item.update({ 
          'system.roll': 'major',
          'system.difficulty': ''
        });
      } else {
        // 체크 해제: roll을 "-"로 설정, difficulty는 자동성공 또는 "-" 입력 가능
        const currentDifficulty = this.item.system.difficulty || '';
        const freepassText = game.i18n.localize('DX3rd.Freepass');
        // 현재 난이도가 자동성공이나 "-"가 아니면 기본값으로 설정
        const newDifficulty = (currentDifficulty === freepassText || currentDifficulty === '-') 
          ? currentDifficulty 
          : freepassText;
        
        await this.item.update({ 
          'system.roll': '-',
          'system.difficulty': newDifficulty
        });
      }
      this.render(false);
    });
    
    // system.roll 변경 시 난이도 체크박스 상태 및 attackRoll 상태 반영
    html.on('change', 'select[name="system.roll"]', async (event) => {
      const value = event.currentTarget.value;
      const $difficultyCheck = html.find('.difficulty-check');
      const $attackRollSelect = html.find('.attackroll-select');
      
      if (value === '-' || value === 'dodge') {
        // roll이 "-" 또는 "dodge"이면 체크 해제, attackRoll 비활성화 및 "-"로 리셋
        $difficultyCheck.prop('checked', false);
        $attackRollSelect.prop('disabled', true);
        await this.item.update({ 
          'system.attackRoll': '-'
        });
      } else {
        // roll이 설정되면 체크, attackRoll 활성화
        $difficultyCheck.prop('checked', true);
        $attackRollSelect.prop('disabled', false);
      }
    });
    
    // 난이도 입력 검증
    html.on('blur', '.difficulty-input', async (event) => {
      const value = event.currentTarget.value.trim();
      if (!value) return;
      
      const competitionText = game.i18n.localize('DX3rd.Competition');
      const referenceText = game.i18n.localize('DX3rd.Reference');
      const freepassText = game.i18n.localize('DX3rd.Freepass');
      const rollValue = this.item.system.roll || '-';
      
      // roll이 "-"이면 자동성공과 "-"만 허용
      if (rollValue === '-') {
        const isValidForNoRoll = value === freepassText || value === '-';
        if (!isValidForNoRoll) {
          ui.notifications.warn(`판정이 비활성화된 경우 난이도는 "${freepassText}" 또는 "-"만 입력할 수 있습니다.`);
          event.currentTarget.value = '';
          await this.item.update({ 'system.difficulty': '' });
        }
      } else {
        // roll이 설정된 경우 숫자, 대결, 효과참조만 허용 (자동성공과 -는 제외)
        const numValue = parseInt(value);
        const isValidNumber = !isNaN(numValue) && numValue >= 1 && Number.isInteger(parseFloat(value));
        const isValidText = value === competitionText || value === referenceText;
        
        if (!isValidNumber && !isValidText) {
          ui.notifications.warn(`판정이 활성화된 경우 난이도는 1 이상의 정수, "${competitionText}", 또는 "${referenceText}"만 입력할 수 있습니다.`);
          event.currentTarget.value = '';
          await this.item.update({ 'system.difficulty': '' });
        }
      }
    });

    html.on('change', 'input[name^="system."]', async (event) => {
      if (this._isAddingAttribute) return;
      
      const name = event.currentTarget.name;
      
      // Target Tab은 부모 클래스에서 처리
      const excludedFields = [
        'system.getTarget',
        'system.scene',
        'system.effect.disable',
        'system.effect.runTiming',
        'system.difficulty'  // 난이도는 blur 이벤트에서 처리
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
        console.error("DX3rd | PsionicSheet attribute update failed", error);
      }
    });
    
    html.on('change', 'select[name^="system."]:not([name$=".key"])', async (event) => {
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
        console.error("DX3rd | PsionicSheet attribute update failed", error);
      }
    });
    
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
        console.error("DX3rd | PsionicSheet attribute update failed", error);
      }
    });


    // HP 비용 즉시 반영
    html.on('change', 'input[name="system.hp.value"]', async (event) => {
      const value = event.currentTarget.value ?? "";
      try {
        await this.item.update({ 'system.hp.value': value });
      } catch (e) {
        console.error('DX3rd | PsionicSheet hp update failed', e);
      }
    });

    // 사용횟수 관련 리스너
    html.on('change', 'input[name="system.used.state"]', async (event) => {
      const v = Number(event.currentTarget.value) || 0;
      try {
        await this.item.update({ 'system.used.state': v });
      } catch (e) { console.error('DX3rd | PsionicSheet used.state update failed', e); }
    });
    html.on('change', 'input[name="system.used.max"]', async (event) => {
      const v = Number(event.currentTarget.value) || 0;
      try {
        await this.item.update({ 'system.used.max': v });
      } catch (e) { console.error('DX3rd | PsionicSheet used.max update failed', e); }
    });
    html.on('change', 'input[name="system.used.level"]', async (event) => {
      const checked = $(event.currentTarget).prop('checked');
      try {
        await this.item.update({ 'system.used.level': checked });
      } catch (e) { console.error('DX3rd | PsionicSheet used.level update failed', e); }
    });
    html.on('change', 'select[name="system.used.disable"]', this._onUsedDisableChange.bind(this));

    // 어트리뷰트 관리 유틸리티 사용
    window.DX3rdAttributeManager.setupAttributeListeners(html, this);

    // 어트리뷰트 라벨 초기화
    window.DX3rdAttributeManager.initializeAttributeLabels(html, this.item);

    // active.runTiming 변경 시 즉시 저장
    html.on('change', 'select[name="system.active.runTiming"]', async (event) => {
      const value = event.currentTarget.value;
      try {
        await this.item.update({ 'system.active.runTiming': value });
      } catch (e) {
        console.error('DX3rd | PsionicSheet active.runTiming update failed', e);
      }
    });

    // 레벨 입력 즉시 반영 (침식 보정 없음)
    html.on('change', 'input[name="system.level.init"]', async (event) => {
      const init = Number(event.currentTarget.value) || 0;
      try {
        await this.item.update({ 'system.level.init': init, 'system.level.value': init });
      } catch (e) {
        console.error('DX3rd | PsionicSheet level.init update failed', e);
      }
    });

    html.on('change', 'input[name="system.level.max"]', async (event) => {
      const max = Number(event.currentTarget.value) || 0;
      try {
        await this.item.update({ 'system.level.max': max });
      } catch (e) {
        console.error('DX3rd | PsionicSheet level.max update failed', e);
      }
    });

  }


  // _onUsedDisableChange는 부모 클래스(item-sheet.js)에서 상속됨

  /** @override */
  _getSubmitData(updateData) {
    const formData = super._getSubmitData(updateData);
    return formData;
  }

  /** @override */
  async _updateObject(event, formData) {
    // Target Tab의 즉시 저장 필드들은 formData에서 제외 (부모 클래스 리스너에서 처리)
    delete formData['system.getTarget'];
    delete formData['system.scene'];
    delete formData['system.effect.disable'];
    delete formData['system.effect.runTiming'];
    
    const result = await this.item.update(formData);
    return result;
  }
}

// Psionic 시트 등록 (v13 호환)
const ItemsClass = foundry.documents?.collections?.Items || Items;
ItemsClass.registerSheet('dx3rd-emanim', DX3rdPsionicSheet, {
  types: ['psionic'],
  makeDefault: true
});

// 전역 노출
window.DX3rdPsionicSheet = DX3rdPsionicSheet;
})();
