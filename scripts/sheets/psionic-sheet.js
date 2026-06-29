// Psionic 아이템 시트
(function() {
const compat = window.DX3rdApplicationCompat;
const itemSheetData = window.DX3rdItemSheetData;

class DX3rdPsionicSheet extends window.DX3rdItemSheet {
  /** @override */
  async getData(options) {
    let data = await super.getData(options);
    const actor = this.item.actor;

    // 액터 정보 추가 (에너미 체크용)
    itemSheetData.prepareActorSummary(this.item, data);

    // Description 보강 및 리치 텍스트 생성 (helpers.js 사용)
    data = await itemSheetData.enrichSheetData(this.item, data);

    // 통합 스킬 선택 옵션 생성 (사이오닉용 - 신드롬 제외, 에너미인 경우 능력치만 표시)
    itemSheetData.prepareSkillOptions(this.item, data, 'psionic', {includeActorType: true});

    // 공통 시스템 필드 하이드레이션 (아이템의 실제 값을 우선 사용)
    // 주의: attackRoll, weaponTmp, weapon, weaponSelect는 WeaponTabManager에서 처리하므로 제외
    itemSheetData.hydrateSystemFields(this.item, data, [
      'skill', 'difficulty', 'limit', 'timing', 'range', 'target', 'type',
      'roll', 'macro', 'active', 'used', 'encroach',
      'effect', 'attributes', 'exp', 'description'
    ], {
      stringFields: ['skill', 'difficulty', 'limit', 'timing', 'range', 'target', 'type', 'roll', 'macro', 'description']
    });


    // level: 침식률 보정 없이 value = init 고정
    data.system.level = itemSheetData.preparePsionicLevelData(this.item, this.item.system?.level || {});

    // hp 비용 (문자열일 수 있음)
    if (!data.system.hp) data.system.hp = {};
    data.system.hp.value = this.item.system?.hp?.value ?? "";

    // 무기 탭 데이터 준비 (WeaponTabManager 사용)
    data = window.DX3rdWeaponTabManager.prepareWeaponTabData(data, this.item);

    // used 복사
    itemSheetData.prepareUsedData(this.item, data);

    // active 객체 초기화 (기존 데이터 보존)
    itemSheetData.prepareActiveData(this.item, data, {
      runTimingFallback: '-',
      undefinedOnly: true
    });

    // effect 객체 초기화 (기존 데이터 보존)
    itemSheetData.prepareEffectData(this.item, data, {runTimingFallback: '-'});

    // attributes와 effect.attributes의 기존 값 보존
    itemSheetData.preserveAttributeData(this.item, data);

    // getTarget / scene 체크박스 초기화
    itemSheetData.prepareTargetFlags(this.item, data);

    return data;
  }

  /** @override */
  activateListeners(html) {
    super.activateListeners(html);
    const root = compat.unwrapRoot(html);

    // Target Tab 통합 리스너는 부모 클래스(item-sheet.js)에서 자동 설정됨

    // 무기 선택 체크박스 변경 시 무기 목록 비우기
    compat.on(root, 'change', 'input[name="system.weaponSelect"]', async (event) => {
      if (event.target.checked) await this.item.update({ 'system.weapon': [] });
      this.render(false);
    });

    // 무기 탭 통합 리스너 (WeaponTabManager 사용)
    window.DX3rdWeaponTabManager.setupWeaponTabListeners(html, this);
    
    // 난이도 체크박스 변경 시
    compat.on(root, 'change', '.difficulty-check', async (event) => {
      await this.item.update(itemSheetData.getRollDifficultyToggleUpdate(this.item, event.target.checked));
      this.render(false);
    });
    
    // system.roll 변경 시 난이도 체크박스 상태 및 attackRoll 상태 반영
    compat.on(root, 'change', 'select[name="system.roll"]', async (event) => {
      const value = event.target.value;
      const difficultyCheck = compat.query(root, '.difficulty-check');
      const attackRollSelect = compat.query(root, '.attackroll-select');
      
      if (value === '-' || value === 'dodge') {
        // roll이 "-" 또는 "dodge"이면 체크 해제, attackRoll 비활성화 및 "-"로 리셋
        if (difficultyCheck) difficultyCheck.checked = false;
        if (attackRollSelect) attackRollSelect.disabled = true;
        await this.item.update(itemSheetData.getRollChangeUpdate(value));
      } else {
        // roll이 설정되면 체크, attackRoll 활성화
        if (difficultyCheck) difficultyCheck.checked = true;
        if (attackRollSelect) attackRollSelect.disabled = false;
      }
    });
    
    // 난이도 입력 검증
    compat.on(root, 'blur', '.difficulty-input', async (event) => {
      const value = event.target.value.trim();
      if (!value) return;
      
      if (itemSheetData.isRollDifficultyValueValid(this.item, value)) return;
      ui.notifications.warn(itemSheetData.getRollDifficultyValidationMessage(this.item));
      event.target.value = '';
      await this.item.update({ 'system.difficulty': '' });
    });

    compat.on(root, 'change', 'input[name^="system."]', async (event) => {
      if (this._isAddingAttribute) return;
      
      const input = event.target;
      const name = input.name;
      
      // Target Tab은 부모 클래스에서 처리
      const excludedFields = [
        'system.getTarget',
        'system.scene',
        'system.effect.disable',
        'system.effect.runTiming',
        'system.difficulty'  // 난이도는 blur 이벤트에서 처리
      ];
      if (excludedFields.includes(name)) return;
      
      const value = input.type === 'checkbox' ? input.checked : input.value;
      
      // 즉시 저장
      try {
        const updates = foundry.utils.expandObject({
          [name]: input.type === 'number' ? parseInt(value) || 0 :
                  input.type === 'checkbox' ? value :
                  value
        });
        await this.item.update(updates);
      } catch (error) {
        console.error("DX3rd | PsionicSheet attribute update failed", error);
      }
    });
    
    compat.on(root, 'change', 'select[name^="system."]:not([name$=".key"])', async (event) => {
      if (this._isAddingAttribute) return;
      
      const name = event.target.name;
      const value = event.target.value;
      
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
    
    compat.on(root, 'change', 'textarea[name^="system."]', async (event) => {
      if (this._isAddingAttribute) return;
      
      const name = event.target.name;
      const value = event.target.value;
      
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
    compat.on(root, 'change', 'input[name="system.hp.value"]', async (event) => {
      const value = event.target.value ?? "";
      try {
        await this.item.update({ 'system.hp.value': value });
      } catch (e) {
        console.error('DX3rd | PsionicSheet hp update failed', e);
      }
    });

    // 사용횟수 관련 리스너
    compat.on(root, 'change', 'input[name="system.used.state"]', async (event) => {
      const v = Number(event.target.value) || 0;
      try {
        await itemSheetData.updateAfterDefault(this.item, { 'system.used.state': v });
      } catch (e) { console.error('DX3rd | PsionicSheet used.state update failed', e); }
    });
    compat.on(root, 'change', 'input[name="system.used.max"]', async (event) => {
      const v = Number(event.target.value) || 0;
      try {
        await itemSheetData.updateAfterDefault(this.item, { 'system.used.max': v });
      } catch (e) { console.error('DX3rd | PsionicSheet used.max update failed', e); }
    });
    compat.on(root, 'change', 'input[name="system.used.level"]', async (event) => {
      const checked = event.target.checked;
      try {
        await itemSheetData.updateAfterDefault(this.item, { 'system.used.level': checked });
      } catch (e) { console.error('DX3rd | PsionicSheet used.level update failed', e); }
    });
    compat.on(root, 'change', 'select[name="system.used.disable"]', this._onUsedDisableChange.bind(this));

    // 어트리뷰트 관리 유틸리티 사용
    window.DX3rdAttributeManager.setupAttributeListeners(html, this);

    // 어트리뷰트 라벨 초기화
    window.DX3rdAttributeManager.initializeAttributeLabels(html, this.item);

    // active.runTiming 변경 시 즉시 저장
    compat.on(root, 'change', 'select[name="system.active.runTiming"]', async (event) => {
      const value = event.target.value;
      try {
        await this.item.update({ 'system.active.runTiming': value });
      } catch (e) {
        console.error('DX3rd | PsionicSheet active.runTiming update failed', e);
      }
    });

    // 레벨 입력 즉시 반영 (침식 보정 없음)
    compat.on(root, 'change', 'input[name="system.level.init"]', async (event) => {
      const level = itemSheetData.preparePsionicLevelData(this.item, {
        ...this.item.system?.level,
        init: event.target.value
      });
      try {
        await this.item.update({ 'system.level.init': level.init, 'system.level.value': level.value });
      } catch (e) {
        console.error('DX3rd | PsionicSheet level.init update failed', e);
      }
    });

    compat.on(root, 'change', 'input[name="system.level.max"]', async (event) => {
      const level = itemSheetData.preparePsionicLevelData(this.item, {
        ...this.item.system?.level,
        max: event.target.value
      });
      try {
        await this.item.update({ 'system.level.max': level.max });
      } catch (e) {
        console.error('DX3rd | PsionicSheet level.max update failed', e);
      }
    });

  }


  // _onUsedDisableChange는 부모 클래스(item-sheet.js)에서 상속됨

  /** @override */
  async _updateObject(event, formData) {
    return itemSheetData.submitSanitizedFormData(this.item, formData);
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
