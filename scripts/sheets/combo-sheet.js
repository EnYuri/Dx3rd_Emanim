// Combo 아이템 시트
(function() {
class DX3rdComboSheet extends window.DX3rdItemSheet {
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
      template: "systems/dx3rd-emanim/templates/item/combo-sheet.html",
      width: 520,
      height: 480
    });
  }

  /** @override */
  async getData(options) {
    const data = await super.getData(options);
    return window.DX3rdComboData.prepareSheetData(data, this.item, this.actor);
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
    
    // 난이도 체크박스 변경 시
    html.on('change', '.difficulty-check', async (event) => {
      const isChecked = event.currentTarget.checked;
      const $attackRollSelect = html.find('.attackroll-select');
      
      if (isChecked) {
        await this.item.update({ 
          'system.roll': 'major',
          'system.difficulty': ''
        });
        $attackRollSelect.prop('disabled', false);
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
          'system.difficulty': newDifficulty,
          'system.attackRoll': '-'
        });
        $attackRollSelect.prop('disabled', true);
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

    // 제한 필드 입력 검증
    html.find('input[name="system.limit"]').on('input', this._onLimitInput.bind(this));
    
    // 이펙트 탭 이벤트 리스너
    html.find('.add-effect').on('click', this._onAddEffect.bind(this));
    // 이펙트 탭의 수정 버튼 클릭 시 이펙트 아이템 시트 열기
    html.find('.tab[data-tab="effect"] .item-control.item-edit').on('click', this._onEditEffect.bind(this));
    html.find('.item-control.item-delete').on('click', this._onDeleteEffect.bind(this));
    
    // 무기 탭 통합 리스너 (WeaponTabManager 사용)
    window.DX3rdWeaponTabManager.setupWeaponTabListeners(html, this);
    
    // 어트리뷰트 관리 이벤트 리스너 설정
    this._isAddingAttribute = false;
    window.DX3rdAttributeManager.setupAttributeListeners(html, this);
    window.DX3rdAttributeManager.initializeAttributeLabels(html, this.item);

    // active.runTiming 변경 시 즉시 저장
    html.on('change', 'select[name="system.active.runTiming"]', async (event) => {
      const value = event.currentTarget.value;
      try {
        await this.item.update({ 'system.active.runTiming': value });
      } catch (e) {
        console.error('DX3rd | ComboSheet active.runTiming update failed', e);
      }
    });

    // input 필드 즉시 업데이트
    html.on('change', 'input[name^="system."]', async (event) => {
      if (this._isAddingAttribute) return;
      
      const name = event.currentTarget.name;
      
      // 전용 핸들러가 있는 필드는 제외
      const excludedFields = [
        'system.getTarget',
        'system.scene',
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
        console.error("DX3rd | ComboSheet input update failed", error);
      }
    });
    
    // select 필드 즉시 업데이트 (attribute-key 제외)
    html.on('change', 'select[name^="system."]:not([name$=".key"])', async (event) => {
      if (this._isAddingAttribute) return;
      
      const name = event.currentTarget.name;
      
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
      
      const value = event.currentTarget.value;
      
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
        console.error("DX3rd | ComboSheet textarea update failed", error);
      }
    });
  }

  /**
   * 기능 선택 시 능력치 자동 설정
   */
  async _updateBaseAttribute(skillValue) {
    if (skillValue === '-' || !skillValue) {
      return;
    }

    // 기본 속성인 경우 (육체, 감각, 정신, 사회)
    if (['body', 'sense', 'mind', 'social'].includes(skillValue)) {
      try {
        await this.item.update({
          'system.base': skillValue
        });
        return;
      } catch (err) {
        console.error('DX3rd | ComboSheet _updateBaseAttribute - update failed', err);
        return;
      }
    }

    // 액터 스킬에서 능력치 찾기
    let baseAttribute = null;
    if (this.actor) {
      const actorSkill = this.actor.system?.attributes?.skills?.[skillValue];
      if (actorSkill?.base) {
        baseAttribute = actorSkill.base;
      }
    }

    if (baseAttribute) {
      try {
        await this.item.update({
          'system.base': baseAttribute
        });
      } catch (err) {
        console.error('DX3rd | ComboSheet _updateBaseAttribute - update failed', err);
      }
    }
  }


  /**
   * 이펙트 수정 버튼 클릭 시 이펙트 아이템 시트 열기
   */
  async _onEditEffect(event) {
    event.preventDefault();
    
    const li = $(event.currentTarget).closest('.item');
    const effectId = li.data('item-id');
    
    if (!effectId) {
      ui.notifications.warn("편집할 이펙트를 찾을 수 없습니다.");
      return;
    }
    
    // 액터에서 이펙트 아이템 찾기
    const effectItem = this.actor?.items.get(effectId);
    if (effectItem && effectItem.type === 'effect') {
      effectItem.sheet.render(true);
    } else {
      ui.notifications.warn("이펙트 아이템을 찾을 수 없습니다.");
    }
  }

  /**
   * 이펙트 추가
   */
  async _onAddEffect(event) {
    event.preventDefault();
    const effectId = $(event.currentTarget).closest('.add-skills').find('#actor-effect').val();
    
    if (!effectId || effectId === '-') {
      ui.notifications.warn("추가할 이펙트를 선택해주세요.");
      return;
    }

    try {
      // 현재 이펙트 배열 가져오기
      const currentEffects = this.item.system.effectIds || this.item.system.effect || [];
      
      // 이미 추가된 이펙트인지 확인
      if (currentEffects.includes(effectId)) {
        ui.notifications.warn("이미 추가된 이펙트입니다.");
        return;
      }

      // 이펙트 추가
      const newEffects = [...currentEffects, effectId];
      
      // 총 침식률 계산 (다이스 공식 파싱)
      let totalDice = 0;
      let totalAdd = 0;
      
      for (const effId of newEffects) {
        if (effId && effId !== '-') {
          const effect = this.actor?.items.get(effId);
          if (effect && effect.type === 'effect') {
            const encValue = String(effect.system.encroach?.value || '0').trim();
            
            // 다이스 공식 파싱: "2d10+5" → dice: 2, add: 5
            const diceMatch = encValue.match(/(\d+)d10/i);
            const addMatch = encValue.match(/([+-]\d+)$/);
            
            if (diceMatch) {
              totalDice += parseInt(diceMatch[1]) || 0;
            }
            
            if (addMatch) {
              totalAdd += parseInt(addMatch[1]) || 0;
            } else if (!diceMatch && !isNaN(parseInt(encValue))) {
              // 순수 숫자만 있는 경우
              totalAdd += parseInt(encValue) || 0;
            }
          }
        }
      }
      
      // 최종 침식률 공식 생성
      let totalEncroachment = '';
      if (totalDice > 0 && totalAdd > 0) {
        totalEncroachment = `${totalDice}d10+${totalAdd}`;
      } else if (totalDice > 0) {
        totalEncroachment = `${totalDice}d10`;
      } else {
        totalEncroachment = String(totalAdd);
      }
      
      await this.item.update({
        'system.effectIds': newEffects,
        'system.encroach.value': totalEncroachment
      });

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
  async _onDeleteEffect(event) {
    event.preventDefault();
    const li = $(event.currentTarget).closest('.item');
    const effectId = li.data('item-id');

    if (!effectId) {
      ui.notifications.warn("삭제할 이펙트를 찾을 수 없습니다.");
      return;
    }

    try {
      // 현재 이펙트 배열에서 제거
      const currentEffects = this.item.system.effectIds || this.item.system.effect || [];
      const newEffects = currentEffects.filter(id => id !== effectId);
      
      // 총 침식률 계산 (다이스 공식 파싱)
      let totalDice = 0;
      let totalAdd = 0;
      
      for (const effId of newEffects) {
        if (effId && effId !== '-') {
          const effect = this.actor?.items.get(effId);
          if (effect && effect.type === 'effect') {
            const encValue = String(effect.system.encroach?.value || '0').trim();
            
            // 다이스 공식 파싱
            const diceMatch = encValue.match(/(\d+)d10/i);
            const addMatch = encValue.match(/([+-]\d+)$/);
            
            if (diceMatch) {
              totalDice += parseInt(diceMatch[1]) || 0;
            }
            
            if (addMatch) {
              totalAdd += parseInt(addMatch[1]) || 0;
            } else if (!diceMatch && !isNaN(parseInt(encValue))) {
              totalAdd += parseInt(encValue) || 0;
            }
          }
        }
      }
      
      // 최종 침식률 공식 생성
      let totalEncroachment = '';
      if (totalDice > 0 && totalAdd > 0) {
        totalEncroachment = `${totalDice}d10+${totalAdd}`;
      } else if (totalDice > 0) {
        totalEncroachment = `${totalDice}d10`;
      } else {
        totalEncroachment = String(totalAdd);
      }
      
      await this.item.update({
        'system.effectIds': newEffects,
        'system.encroach.value': totalEncroachment
      });

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
    const validPattern = /^(-|\d+|\d+%)$/;
    
    if (value && !validPattern.test(value)) {
      // 잘못된 입력인 경우 이전 값으로 복원
      const previousValue = this.item.system.limit || '-';
      input.value = previousValue;
      
      // 사용자에게 알림
      ui.notifications.warn("제한은 '-', 숫자, 또는 숫자%만 입력 가능합니다.");
    }
  }

  /** @override */
  _getSubmitData(updateData) {
    let formData = super._getSubmitData(updateData);
    
    // system.attributes와 system.effect.attributes 하위 속성들이 formData에 포함되어 있는지 확인
    return formData;
  }

  /** @override */
  async _updateObject(event, formData) {
    // Target Tab의 즉시 저장 필드들은 formData에서 제외 (부모 클래스 리스너에서 처리)
    delete formData['system.getTarget'];
    delete formData['system.scene'];
    delete formData['system.effect.disable'];
    delete formData['system.effect.runTiming'];
    
    // 포함된 이펙트들의 침식률 자동 합산 (다이스 공식 파싱)
    const effectIds = formData['system.effectIds'] || this.item.system.effectIds || this.item.system.effect || [];
    let totalDice = 0;
    let totalAdd = 0;
    
    if (Array.isArray(effectIds)) {
      for (const effectId of effectIds) {
        if (effectId && effectId !== '-') {
          const effect = this.actor?.items.get(effectId);
          if (effect && effect.type === 'effect') {
            const encValue = String(effect.system.encroach?.value || '0').trim();
            
            // 다이스 공식 파싱
            const diceMatch = encValue.match(/(\d+)d10/i);
            const addMatch = encValue.match(/([+-]\d+)$/);
            
            if (diceMatch) {
              totalDice += parseInt(diceMatch[1]) || 0;
            }
            
            if (addMatch) {
              totalAdd += parseInt(addMatch[1]) || 0;
            } else if (!diceMatch && !isNaN(parseInt(encValue))) {
              totalAdd += parseInt(encValue) || 0;
            }
          }
        }
      }
    }
    
    // 최종 침식률 공식 생성
    let totalEncroachment = '';
    if (totalDice > 0 && totalAdd > 0) {
      totalEncroachment = `${totalDice}d10+${totalAdd}`;
    } else if (totalDice > 0) {
      totalEncroachment = `${totalDice}d10`;
    } else {
      totalEncroachment = String(totalAdd);
    }
    
    // 콤보의 침식률에 자동 설정 (템플릿에서 encroach 사용)
    formData['system.encroach.value'] = totalEncroachment;
    
    // 공격력 계산 (system.attackRoll이 '-'가 아닐 경우)
    const attackRoll = formData['system.attackRoll'] || this.item.system.attackRoll;
    if (attackRoll && attackRoll !== '-') {
      let totalAttack = 0;
      
      // 1. 액터의 기본 공격력 (공격 타입에 따라 구분)
      if (this.actor) {
        let actorAttack = this.actor.system.attributes.attack?.value || 0;
        // 공격 타입에 따라 melee 또는 ranged 보너스 추가
        if (attackRoll === 'melee' && this.actor.system.attributes.attack?.melee) {
          actorAttack += this.actor.system.attributes.attack.melee;
        } else if (attackRoll === 'ranged' && this.actor.system.attributes.attack?.ranged) {
          actorAttack += this.actor.system.attributes.attack.ranged;
        }
        totalAttack += actorAttack;
      }
      
      // 2. 등록된 무기들의 공격력 합계
      const registeredWeapons = formData['system.weapon'] || this.item.system.weapon || [];
      let weaponAttackSum = 0;
      
      for (const weaponId of registeredWeapons) {
        if (weaponId && weaponId !== '-') {
          const weaponItem = this.actor?.items.get(weaponId);
          if (weaponItem) {
            const weaponAttack = Number(weaponItem.system?.attack) || 0;
            weaponAttackSum += weaponAttack;
          }
        }
      }
      
      totalAttack += weaponAttackSum;
      
      // 최종 공격력 설정
      formData['system.attack.value'] = totalAttack;
    } else {
      // system.attackRoll이 '-'이거나 설정되지 않은 경우
      formData['system.attack.value'] = '-';
    }
    
    // formData를 바로 사용 (expandObject는 다른 속성을 덮어쓸 수 있음)
    const result = await this.item.update(formData);
    
    return result;
  }
}

// Combo 시트 등록 (v13 호환)
const ItemsClass = foundry.documents?.collections?.Items || Items;
ItemsClass.registerSheet('dx3rd-emanim', DX3rdComboSheet, {
  types: ['combo'],
  makeDefault: true
});

// 전역 노출
window.DX3rdComboSheet = DX3rdComboSheet;
})();
