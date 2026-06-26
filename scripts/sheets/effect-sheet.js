// effect-sheet.js
// Effect 아이템 시트 - Foundry 기본 폼 처리 사용
(function() {
class DX3rdEffectSheet extends window.DX3rdItemSheet {
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
    const item = this.item;
    const actor = item.actor;

    // 액터 정보 추가 (에너미 체크용)
    if (actor) {
      data.actor = {
        id: actor.id,
        type: actor.type
      };
    } else {
      data.actor = null;
    }

    // actorSkills 주입 (액터가 있을 때)
    data.system.actorSkills = actor?.system?.attributes?.skills || {};
    // 통합 스킬 선택 옵션 생성 (이펙트용 - 신드롬 포함)
    // 에너미인 경우 능력치만 표시
    data.system.skillOptions = window.DX3rdSkillManager.getSkillSelectOptions('effect', data.system.actorSkills, actor?.type);

    // 레벨 데이터를 현재 아이템의 실제 값으로 직접 복사
    if (!data.system.level) {
      data.system.level = {};
    }
    
    // 현재 아이템의 level 데이터를 그대로 복사 (기본값 덮어쓰기 방지)
    if (this.item.system.level) {
      data.system.level.init = this.item.system.level.init ?? 0;
      data.system.level.max = this.item.system.level.max ?? 1;
      data.system.level.value = this.item.system.level.value ?? 0;
      data.system.level.upgrade = this.item.system.level.upgrade ?? false;
      
    } else {
      // 아이템에 level 데이터가 없는 경우에만 기본값 사용
      data.system.level.init = 0;
      data.system.level.max = 1;
      data.system.level.value = 0;
      data.system.level.upgrade = false;
    }

    // 레벨 value 계산 (침식률 보정 적용)
    if (actor && data.system.level.upgrade) {
      const encLevel = Number(actor.system?.attributes?.encroachment?.level) || 0;
      const baseValue = Number(data.system.level.init) || 0;
      data.system.level.value = baseValue + encLevel;
      
    } else {
      // upgrade가 false이거나 actor가 없는 경우 기본값 사용
      data.system.level.value = Number(data.system.level.init) || 0;
      
    }

    // 모든 system 필드가 undefined인 경우 현재 아이템의 값을 사용
    // 주의: attackRoll, weaponTmp, weapon, weaponSelect는 WeaponTabManager에서 처리하므로 제외
    const systemFields = [
      'skill', 'difficulty', 'limit', 'timing', 'range', 'target', 'type',
      'roll', 'macro', 'active', 'used', 'encroach',
      'effect', 'attributes', 'exp', 'description'
    ];
    
    systemFields.forEach(field => {
      if (data.system[field] === undefined) {
        // 문자열 필드와 객체 필드를 구분하여 처리
        const stringFields = ['skill', 'difficulty', 'limit', 'timing', 'range', 'target', 'type', 'roll', 'macro', 'description'];
        const defaultValue = stringFields.includes(field) ? '' : {};
        
        data.system[field] = this.item.system[field] || defaultValue;
      }
    });

    // 무기 탭 데이터 준비 (WeaponTabManager 사용)
    data = window.DX3rdWeaponTabManager.prepareWeaponTabData(data, this.item);

    // attributes와 effect.attributes의 기존 값 보존
    if (this.item.system.attributes) {
      data.system.attributes = { ...this.item.system.attributes };
    }
    
    if (this.item.system.effect?.attributes) {
      data.system.effect.attributes = { ...this.item.system.effect.attributes };
    }

    // level.upgrade는 위에서 이미 처리됨

    // getTarget 체크박스 초기화
    if (data.system.getTarget === undefined) {
      data.system.getTarget = this.item.system.getTarget || false;
    }

    // scene 체크박스 초기화
    if (data.system.scene === undefined) {
      data.system.scene = this.item.system.scene || false;
    }

    // system.used 객체의 하위 속성들을 현재 아이템의 실제 값으로 직접 복사
    if (!data.system.used) {
      data.system.used = {};
    }
    
    // 현재 아이템의 used 데이터를 그대로 복사 (기본값 덮어쓰기 방지)
    if (this.item.system.used) {
      data.system.used.state = this.item.system.used.state ?? 0;
      data.system.used.max = this.item.system.used.max ?? 0;
      data.system.used.level = this.item.system.used.level ?? false;
      data.system.used.disable = this.item.system.used.disable ?? 'notCheck';
      
    } else {
      // 아이템에 used 데이터가 없는 경우에만 기본값 사용
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

    // exp 체크박스들 초기화
    if (!data.system.exp) {
      data.system.exp = {};
    }
    if (data.system.exp.own === undefined) {
      data.system.exp.own = this.item.system.exp?.own || false;
    }
    if (data.system.exp.upgrade === undefined) {
      data.system.exp.upgrade = this.item.system.exp?.upgrade || false;
    }

    // macro 필드 초기화
    if (data.system.macro === undefined) {
      data.system.macro = this.item.system?.macro || "";
    }

    // 임베드 매크로(system.macros[]) + 타이밍 옵션
    data.system.macros = Array.isArray(this.item.system?.macros) ? this.item.system.macros : [];
    data.macroTimings = ["instant", "afterSuccess", "afterDamage", "afterMain", "onInvoke"];

    // Description 에디터를 위한 데이터 추가 (helpers.js 사용)
    data = await window.DX3rdDescriptionManager.enrichSheetData(data, this.item);

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

    // 어트리뷰트 관리 유틸리티 사용
    window.DX3rdAttributeManager.setupAttributeListeners(html, this);

    // 임베드 매크로(system.macros[]) 편집: 추가/삭제/타이밍/명령/비활성 — 폼 직렬화 대신 직접 update
    const getMacros = () => (Array.isArray(this.item.system?.macros) ? foundry.utils.deepClone(this.item.system.macros) : []);
    html.on('click', '[data-action="macro-add"]', async (event) => {
      event.preventDefault();
      const macros = getMacros();
      macros.push({ timing: 'instant', command: '', disabled: false });
      await this.item.update({ 'system.macros': macros });
    });
    html.on('click', '[data-action="macro-delete"]', async (event) => {
      event.preventDefault();
      const i = Number(event.currentTarget.dataset.index);
      const macros = getMacros();
      if (i >= 0 && i < macros.length) { macros.splice(i, 1); await this.item.update({ 'system.macros': macros }); }
    });
    html.on('change', '.macro-timing', async (event) => {
      const i = Number(event.currentTarget.dataset.index);
      const macros = getMacros();
      if (macros[i]) { macros[i].timing = event.currentTarget.value; await this.item.update({ 'system.macros': macros }); }
    });
    html.on('change', '.macro-disabled', async (event) => {
      const i = Number(event.currentTarget.dataset.index);
      const macros = getMacros();
      if (macros[i]) { macros[i].disabled = event.currentTarget.checked; await this.item.update({ 'system.macros': macros }); }
    });
    // 명령은 blur(포커스 아웃)에 저장해 타이핑 중 리렌더 방지
    html.on('change', '.macro-command', async (event) => {
      const i = Number(event.currentTarget.dataset.index);
      const macros = getMacros();
      if (macros[i]) { macros[i].command = event.currentTarget.value; await this.item.update({ 'system.macros': macros }); }
    });

    // active.runTiming 변경 시 즉시 저장
    html.on('change', 'select[name="system.active.runTiming"]', async (event) => {
      const value = event.currentTarget.value;
      try {
        await this.item.update({ 'system.active.runTiming': value });
      } catch (e) {
        console.error('DX3rd | EffectSheet active.runTiming update failed', e);
      }
    });
    
    // 난이도 체크박스 변경 시
    html.on('change', '.difficulty-check', async (event) => {
      const isChecked = event.currentTarget.checked;
      const $difficultyInput = html.find('.difficulty-input');
      
      if (isChecked) {
        // 체크됨: roll을 major로 설정, difficulty 입력 활성화
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
    
    // 난이도 입력 검증 (blur 이벤트)
    html.on('blur', '.difficulty-input', async (event) => {
      const value = event.currentTarget.value.trim();
      
      // 빈 값은 허용
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

    // input 필드 즉시 업데이트
    html.on('change', 'input[name^="system."]', async (event) => {
      if (this._isAddingAttribute) return;
      
      const name = event.currentTarget.name;
      
      // Target Tab과 전용 핸들러가 있는 필드는 제외
      const excludedFields = [
        'system.getTarget',
        'system.scene',
        'system.level.init',
        'system.level.max',
        'system.level.upgrade',
        'system.used.state',
        'system.used.max',
        'system.used.level',
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
        console.error("DX3rd | EffectSheet input update failed", error);
      }
    });
    
    // select 필드 즉시 업데이트 (attribute-key는 helpers.js에서 처리)
    html.on('change', 'select[name^="system."]:not([name$=".key"])', async (event) => {
      if (this._isAddingAttribute) return;
      
      const name = event.currentTarget.name;
      
      // Target Tab과 전용 핸들러가 있는 필드는 제외
      const excludedFields = [
        'system.getTarget',
        'system.scene',
        'system.effect.disable',
        'system.effect.runTiming',
        'system.used.disable'
      ];
      if (excludedFields.includes(name)) return;
      
      const value = event.currentTarget.value;
      
      // 즉시 저장
      try {
        const updates = foundry.utils.expandObject({
          [name]: value
        });
        await this.item.update(updates);
      } catch (error) {
        console.error("DX3rd | EffectSheet select update failed", error);
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
        console.error("DX3rd | EffectSheet textarea update failed", error);
      }
    });
    
    // system.used 하위 속성에 대한 특별한 이벤트 리스너
    html.on('change', 'select[name="system.used.disable"]', this._onUsedDisableChange.bind(this));

    // 어트리뷰트 라벨 초기화
    window.DX3rdAttributeManager.initializeAttributeLabels(html, this.item);

    // 레벨 변경 시 level.value 자동 업데이트
    html.find('input[name="system.level.init"]').on('change', this._onLevelChange.bind(this));
    html.find('input[name="system.level.max"]').on('change', this._onLevelChange.bind(this));
    html.find('input[name="system.level.upgrade"]').on('change', this._onLevelChange.bind(this));

  }

         // _onUsedDisableChange는 부모 클래스(item-sheet.js)에서 상속됨

         async _onLevelChange(event) {
    event.preventDefault();
    
    // 폼 데이터에서 현재 값들 가져오기
    const formData = new FormData(event.target.form);
    const init = Number(formData.get('system.level.init')) || 0;
    const max = Number(formData.get('system.level.max')) || 1;
    const upgrade = formData.get('system.level.upgrade') === 'on';
    
    // level.value 계산 (침식률 보정 적용)
    let value = init;
    if (this.item.actor && upgrade) {
      const encLevel = Number(this.item.actor.system?.attributes?.encroachment?.level) || 0;
      value += encLevel;
    }
    
    // level.value 업데이트
    try {
      await this.item.update({
        'system.level.init': init,
        'system.level.max': max,
        'system.level.upgrade': upgrade,
        'system.level.value': value
      });
    } catch (err) {
      console.error("DX3rd | EffectSheet _onLevelChange update failed", err);
    }
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
    
    const result = await this.item.update(formData);
    
    return result;
  }
}

// 이펙트 시트 등록 (v13 호환)
const ItemsClass = foundry.documents?.collections?.Items || Items;
ItemsClass.registerSheet('dx3rd-emanim', DX3rdEffectSheet, {
  types: ['effect'],
  makeDefault: true
});

// 전역 노출
window.DX3rdEffectSheet = DX3rdEffectSheet;
})();
