// Archived AppV1 effect sheet
// Effect 아이템 시트 - Foundry 기본 폼 처리 사용
(function() {
const compat = window.DX3rdApplicationCompat;
const itemSheetData = window.DX3rdItemSheetData;

class DX3rdEffectSheet extends window.DX3rdItemSheet {
  /** @override */
  async getData(options) {
    let data = await super.getData(options);
    const item = this.item;
    const actor = item.actor;

    // 액터 정보와 스킬 옵션 추가 (에너미인 경우 능력치만 표시)
    itemSheetData.prepareActorSummary(item, data);
    itemSheetData.prepareSkillOptions(item, data, 'effect', {includeActorType: true});

    data.system.level = itemSheetData.prepareEffectLevelData(item, actor, this.item.system.level || {});

    // 모든 system 필드가 undefined인 경우 현재 아이템의 값을 사용
    // 주의: attackRoll, weaponTmp, weapon, weaponSelect는 WeaponTabManager에서 처리하므로 제외
    itemSheetData.hydrateSystemFields(item, data, [
      'skill', 'comboSkill', 'comboBase', 'difficulty', 'limit', 'timing', 'range', 'target', 'type',
      'roll', 'macro', 'active', 'used', 'encroach',
      'effect', 'attributes', 'exp', 'description'
    ], {
      stringFields: ['skill', 'comboSkill', 'comboBase', 'difficulty', 'limit', 'timing', 'range', 'target', 'type', 'roll', 'macro', 'description'],
      defaults: { comboSkill: '-', comboBase: '-' }
    });

    // 무기 탭 데이터 준비 (WeaponTabManager 사용)
    data = window.DX3rdWeaponTabManager.prepareWeaponTabData(data, this.item);

    // attributes와 effect.attributes의 기존 값 보존
    itemSheetData.preserveAttributeData(item, data);

    // level.upgrade는 위에서 이미 처리됨

    // getTarget / scene 체크박스 초기화
    itemSheetData.prepareTargetFlags(item, data);

    // system.used 객체의 하위 속성들을 현재 아이템의 실제 값으로 직접 복사
    itemSheetData.prepareUsedData(item, data);

    // active 객체 초기화 (기존 데이터 보존)
    itemSheetData.prepareActiveData(item, data, {
      runTimingFallback: '-',
      undefinedOnly: true
    });

    // effect 객체 초기화 (기존 데이터 보존)
    itemSheetData.prepareEffectData(item, data, {runTimingFallback: '-'});

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

    // 임베드 매크로(system.macros[]) + 타이밍 옵션 + 월드 매크로 목록(이름참조 드롭다운용)
    itemSheetData.prepareEmbeddedMacroData(this.item, data);
    data.macroTimings = ["instant", "afterSuccess", "afterDamage", "afterMain", "onInvoke"];
    data.worldMacros = itemSheetData.getWorldMacroOptions();

    // 사정거리/대상/난이도 드롭다운 컨텍스트(캐노니컬 정규화 후 초기 선택/파라미터 산출)
    if (window.DX3rdRangeTarget) {
      data.rangeField = window.DX3rdRangeTarget.fieldContext('range', data.system.range);
      data.targetField = window.DX3rdRangeTarget.fieldContext('target', data.system.target);
      data.difficultyField = window.DX3rdRangeTarget.difficultyFieldContext(data.system.difficulty);
    }

    // Description 에디터를 위한 데이터 추가 (helpers.js 사용)
    data = await itemSheetData.enrichSheetData(this.item, data);

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

    // 사정거리/대상 드롭다운 배선(선택+파라미터 → 캐노니컬 값 저장)
    window.DX3rdRangeTarget?.setupFieldListeners(root, this.item, { update: (it, upd) => it.update(upd) });

    // 어트리뷰트 관리 유틸리티 사용
    window.DX3rdAttributeManager.setupAttributeListeners(html, this);

    compat.on(root, 'click', '[data-action="macro-add"]', async (event) => {
      event.preventDefault();
      await itemSheetData.addEmbeddedMacro(this.item);
    });
    compat.on(root, 'click', '[data-action="macro-delete"]', async (event, target) => {
      event.preventDefault();
      const i = Number(target.dataset.index);
      await itemSheetData.removeEmbeddedMacro(this.item, i);
    });
    compat.on(root, 'change', '.macro-timing', async (event) => {
      const i = Number(event.target.dataset.index);
      await itemSheetData.updateEmbeddedMacro(this.item, i, 'timing', event.target.value);
    });
    compat.on(root, 'change', '.macro-disabled', async (event) => {
      const i = Number(event.target.dataset.index);
      await itemSheetData.updateEmbeddedMacro(this.item, i, 'disabled', event.target.checked);
    });
    // 명령은 blur(포커스 아웃)에 저장해 타이핑 중 리렌더 방지
    compat.on(root, 'change', '.macro-command', async (event) => {
      const i = Number(event.target.dataset.index);
      await itemSheetData.updateEmbeddedMacro(this.item, i, 'command', event.target.value);
    });
    // 종류(인라인 코드 / 월드 매크로) 전환 → 저장 후 리렌더로 입력 UI 교체
    compat.on(root, 'change', '.macro-kind', async (event) => {
      const i = Number(event.target.dataset.index);
      await itemSheetData.updateEmbeddedMacro(this.item, i, 'kind', event.target.value);
    });
    compat.on(root, 'change', '.macro-name', async (event) => {
      const i = Number(event.target.dataset.index);
      await itemSheetData.updateEmbeddedMacro(this.item, i, 'macroName', event.target.value);
    });

    // 레거시 단일 매크로 필드(system.macro) → 임베드 행(kind:'macro') 1회 이관
    itemSheetData.migrateLegacyMacroField(this.item);

    // active.runTiming 변경 시 즉시 저장
    compat.on(root, 'change', 'select[name="system.active.runTiming"]', async (event) => {
      const value = event.target.value;
      try {
        await this.item.update({ 'system.active.runTiming': value });
      } catch (e) {
        console.error('DX3rd | EffectSheet active.runTiming update failed', e);
      }
    });
    
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
    
    // 난이도 입력 검증 (blur 이벤트)
    compat.on(root, 'blur', '.difficulty-input', async (event) => {
      const value = event.target.value.trim();
      
      // 빈 값은 허용
      if (!value) return;
      
      if (itemSheetData.isRollDifficultyValueValid(this.item, value)) return;
      ui.notifications.warn(itemSheetData.getRollDifficultyValidationMessage(this.item));
      event.target.value = '';
      await this.item.update({ 'system.difficulty': '' });
    });

    // input 필드 즉시 업데이트
    compat.on(root, 'change', 'input[name^="system."]', async (event) => {
      if (this._isAddingAttribute) return;
      
      const input = event.target;
      const name = input.name;
      
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
        console.error("DX3rd | EffectSheet input update failed", error);
      }
    });
    
    // select 필드 즉시 업데이트 (attribute-key는 helpers.js에서 처리)
    compat.on(root, 'change', 'select[name^="system."]:not([name$=".key"])', async (event) => {
      if (this._isAddingAttribute) return;
      
      const name = event.target.name;
      
      // Target Tab과 전용 핸들러가 있는 필드는 제외
      const excludedFields = [
        'system.getTarget',
        'system.scene',
        'system.effect.disable',
        'system.effect.runTiming',
        'system.used.disable'
      ];
      if (excludedFields.includes(name)) return;
      
      const value = event.target.value;
      
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
        console.error("DX3rd | EffectSheet textarea update failed", error);
      }
    });
    
    // system.used 하위 속성에 대한 특별한 이벤트 리스너
    compat.on(root, 'change', 'input[name="system.used.state"]', async (event) => {
      const value = Number(event.target.value) || 0;
      try {
        await itemSheetData.updateAfterDefault(this.item, { 'system.used.state': value });
      } catch (e) {
        console.error('DX3rd | EffectSheet used.state update failed', e);
      }
    });
    compat.on(root, 'change', 'input[name="system.used.max"]', async (event) => {
      const value = Number(event.target.value) || 0;
      try {
        await itemSheetData.updateAfterDefault(this.item, { 'system.used.max': value });
      } catch (e) {
        console.error('DX3rd | EffectSheet used.max update failed', e);
      }
    });
    compat.on(root, 'change', 'input[name="system.used.level"]', async (event) => {
      const checked = event.target.checked;
      try {
        await itemSheetData.updateAfterDefault(this.item, { 'system.used.level': checked });
      } catch (e) {
        console.error('DX3rd | EffectSheet used.level update failed', e);
      }
    });
    compat.on(root, 'change', 'select[name="system.used.disable"]', (event) => {
      this._onUsedDisableChange({ currentTarget: event.target });
    });

    // 어트리뷰트 라벨 초기화
    window.DX3rdAttributeManager.initializeAttributeLabels(html, this.item);

    // 레벨 변경 시 level.value 자동 업데이트
    compat.on(root, 'change', 'input[name="system.level.init"]', this._onLevelChange.bind(this));
    compat.on(root, 'change', 'input[name="system.level.max"]', this._onLevelChange.bind(this));
    compat.on(root, 'change', 'input[name="system.level.upgrade"]', this._onLevelChange.bind(this));

  }

         // _onUsedDisableChange는 부모 클래스(item-sheet.js)에서 상속됨

         async _onLevelChange(event) {
    event.preventDefault();
    
    const formData = new FormData(event.target.form);
    const level = itemSheetData.prepareEffectLevelData(this.item, this.item.actor, {
      init: formData.get('system.level.init'),
      max: formData.get('system.level.max'),
      upgrade: formData.get('system.level.upgrade') === 'on'
    });
    try {
      await itemSheetData.updateAfterDefault(this.item, {
        'system.level.init': level.init,
        'system.level.max': level.max,
        'system.level.upgrade': level.upgrade,
        'system.level.value': level.value
      });
    } catch (err) {
      console.error("DX3rd | EffectSheet _onLevelChange update failed", err);
    }
  }

  /** @override */
  async _updateObject(event, formData) {
    return itemSheetData.submitSanitizedFormData(this.item, formData);
  }
}

// 이펙트 시트 등록 (v13 호환)
const ItemsClass = foundry.documents?.collections?.Items || Items;
ItemsClass.registerSheet('dx3rd-emanim', DX3rdEffectSheet, {
  label: 'DX3rd.SheetV1',
  types: ['effect'],
  makeDefault: true
});

// 전역 노출
window.DX3rdEffectSheet = DX3rdEffectSheet;
})();
