// Combo 아이템 시트
(function() {
const compat = window.DX3rdApplicationCompat;
const itemSheetData = window.DX3rdItemSheetData;
const comboData = window.DX3rdComboData;

class DX3rdComboSheet extends window.DX3rdItemSheet {
  /** @override */
  async getData(options) {
    const data = await super.getData(options);
    return window.DX3rdComboData.prepareSheetData(data, this.item, this.actor);
  }


  /** @override */
  activateListeners(html) {
    super.activateListeners(html);
    const root = compat.unwrapRoot(html);

    // Target Tab 통합 리스너는 부모 클래스(item-sheet.js)에서 자동 설정됨
    
    // 무기 선택 체크박스 변경 시 무기 목록 비우기
    compat.on(root, 'change', 'input[name="system.weaponSelect"]', async (event) => {
      const isChecked = event.target.checked;
      const updates = { 'system.weaponSelect': isChecked };
      if (isChecked) {
        // 체크되면 무기 목록 비우기
        updates['system.weapon'] = [];
      }
      await itemSheetData.updateAfterDefault(this.item, updates);
      this.render(false);
    });
    
    // 난이도 체크박스 변경 시
    compat.on(root, 'change', '.difficulty-check', async (event) => {
      const isChecked = event.target.checked;
      const attackRollSelect = compat.query(root, '.attackroll-select');
      await itemSheetData.updateAfterDefault(this.item, comboData.getDifficultyToggleUpdate(this.item, isChecked));
      if (attackRollSelect) attackRollSelect.disabled = isChecked ? false : true;
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
        await this.item.update({ 
          'system.attackRoll': '-'
        });
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
      
      if (!comboData.isDifficultyValueValid(this.item, value)) {
        ui.notifications.warn(comboData.getDifficultyValidationMessage(this.item));
        event.target.value = '';
        await this.item.update({ 'system.difficulty': '' });
      }
    });

    // 제한 필드 입력 검증
    compat.on(root, 'input', 'input[name="system.limit"]', this._onLimitInput.bind(this));
    
    // 이펙트 탭 이벤트 리스너
    compat.on(root, 'click', '.add-effect', this._onAddEffect.bind(this));
    // 이펙트 탭의 수정 버튼 클릭 시 이펙트 아이템 시트 열기
    compat.on(root, 'click', '.tab[data-tab="effect"] .item-control.item-edit', this._onEditEffect.bind(this));
    compat.on(root, 'click', '.tab[data-tab="effect"] .item-control.item-delete', this._onDeleteEffect.bind(this));
    
    // 무기 탭 통합 리스너 (WeaponTabManager 사용)
    window.DX3rdWeaponTabManager.setupWeaponTabListeners(html, this);

    // 사정거리/대상 드롭다운 배선(선택+파라미터 → 캐노니컬 값 저장)
    window.DX3rdRangeTarget?.setupFieldListeners(root, this.item, { update: (it, upd) => it.update(upd) });
    
    // 어트리뷰트 관리 이벤트 리스너 설정
    this._isAddingAttribute = false;
    window.DX3rdAttributeManager.setupAttributeListeners(html, this);
    window.DX3rdAttributeManager.initializeAttributeLabels(html, this.item);

    // active.runTiming 변경 시 즉시 저장
    compat.on(root, 'change', 'select[name="system.active.runTiming"]', async (event) => {
      const value = event.target.value;
      try {
        await this.item.update({ 'system.active.runTiming': value });
      } catch (e) {
        console.error('DX3rd | ComboSheet active.runTiming update failed', e);
      }
    });

    // input 필드 즉시 업데이트
    compat.on(root, 'change', 'input[name^="system."]', async (event) => {
      if (this._isAddingAttribute) return;
      
      const input = event.target;
      const name = input.name;
      
      // 전용 핸들러가 있는 필드는 제외
      const excludedFields = [
        'system.getTarget',
        'system.scene',
        'system.weaponSelect',
        'system.roll-check',
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
        console.error("DX3rd | ComboSheet input update failed", error);
      }
    });
    
    // select 필드 즉시 업데이트 (attribute-key 제외)
    compat.on(root, 'change', 'select[name^="system."]:not([name$=".key"])', async (event) => {
      if (this._isAddingAttribute) return;
      
      const name = event.target.name;
      
      // Target Tab과 전용 핸들러가 있는 필드는 제외
      const excludedFields = [
        'system.getTarget',
        'system.scene',
        'system.effect.disable',
        'system.effect.runTiming',
        'system.active.disable',
        'system.active.runTiming'
      ];
      if (excludedFields.includes(name)) return;
      
      const value = event.target.value;
      
      // 기능 선택 시 능력치 자동 설정
      if (name === 'system.skill' && value && value !== '-') {
        await this._updateBaseAttribute(value);
      }
      
      // 즉시 저장
      try {
        const updates = foundry.utils.expandObject({
          [name]: value
        });
        await this.item.update(updates);
      } catch (error) {
        console.error("DX3rd | ComboSheet select update failed", error);
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
        console.error("DX3rd | ComboSheet textarea update failed", error);
      }
    });
  }

  /**
   * 무기 추가 직후: 빈 값이면 무기 기준으로 공격 콤보 자동 구성(기능/공격판정/공격력).
   */
  async _onWeaponAdded(weaponId) {
    await comboData.applyWeaponAutoAttack(this.item, this.actor, weaponId);
  }

  /**
   * 기능 선택 시 능력치 자동 설정
   */
  async _updateBaseAttribute(skillValue) {
    try {
      await comboData.updateBaseAttributeForSkill(this.item, this.actor, skillValue);
    } catch (err) {
      console.error('DX3rd | ComboSheet _updateBaseAttribute - update failed', err);
    }
  }


  /**
   * 이펙트 수정 버튼 클릭 시 이펙트 아이템 시트 열기
   */
  async _onEditEffect(event, target) {
    event.preventDefault();
    
    const itemRow = compat.closest(target || event.target, '.item');
    const effectId = itemRow?.dataset.itemId;
    comboData.openRegisteredEffectSheet(this.actor, effectId);
  }

  /**
   * 이펙트 추가
   */
  async _onAddEffect(event) {
    event.preventDefault();
    const addSkills = compat.closest(event.target, '.add-skills');
    const effectId = compat.query(addSkills, '#actor-effect')?.value;

    try {
      const updated = await comboData.addRegisteredEffect(this.item, this.actor, effectId);
      if (!updated) return;

      ui.notifications.info("이펙트가 추가되었습니다.");
      
      // 시트 다시 렌더링
      this.render(false);
      
    } catch (error) {
      console.error('DX3rd | ComboSheet _onAddEffect - update failed', error);
      ui.notifications.error("이펙트 추가에 실패했습니다.");
    }
  }

  /**
   * 이펙트 삭제
   */
  async _onDeleteEffect(event, target) {
    event.preventDefault();
    const itemRow = compat.closest(target || event.target, '.item');
    const effectId = itemRow?.dataset.itemId;

    try {
      const updated = await comboData.removeRegisteredEffect(this.item, this.actor, effectId);
      if (!updated) return;

      ui.notifications.info("이펙트가 삭제되었습니다.");
      
      // 시트 다시 렌더링
      this.render(false);
      
    } catch (error) {
      console.error('DX3rd | ComboSheet _onDeleteEffect - update failed', error);
      ui.notifications.error("이펙트 삭제에 실패했습니다.");
    }
  }

  /**
   * 제한 필드 입력 검증
   */
  _onLimitInput(event) {
    const input = event.currentTarget;
    const value = input.value;
    
    // 허용된 패턴: "-", 숫자, 또는 숫자%
    if (!comboData.isLimitValueValid(value)) {
      // 잘못된 입력인 경우 이전 값으로 복원
      const previousValue = this.item.system.limit || '-';
      input.value = previousValue;
      
      // 사용자에게 알림
      ui.notifications.warn("제한은 '-', 숫자, 또는 숫자%만 입력 가능합니다.");
    }
  }

  /** @override */
  async _updateObject(event, formData) {
    const submitValues = comboData.prepareSubmittedCombatValues(this.item, this.actor, {
      effectIds: formData['system.effectIds'],
      weapons: formData['system.weapon'],
      attackRoll: formData['system.attackRoll']
    });
    formData['system.effectIds'] = submitValues.effectIds;
    formData['system.encroach.value'] = submitValues.encroachValue;
    formData['system.weapon'] = submitValues.weapons;
    formData['system.attack.value'] = submitValues.attackValue;
    
    return itemSheetData.submitSanitizedFormData(this.item, formData, {
      exclude: [
        'system.getTarget',
        'system.scene',
        'system.effect.disable',
        'system.effect.runTiming',
        'system.roll-check'
      ]
    });
  }
}

// Combo 시트 등록 (v13 호환)
const ItemsClass = foundry.documents?.collections?.Items || Items;
ItemsClass.registerSheet('dx3rd-emanim', DX3rdComboSheet, {
  label: 'DX3rd.SheetV1',
  types: ['combo'],
  makeDefault: true
});

// 전역 노출
window.DX3rdComboSheet = DX3rdComboSheet;
})();
