// Spell 아이템 시트
(function () {
  class DX3rdSpellSheet extends window.DX3rdItemSheet {
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
        template: "systems/dx3rd-emanim/templates/item/spell-sheet.html",
        width: 520,
        height: 480
      });
    }

    /** @override */
    async getData(options) {
      let data = await super.getData(options);

      // 액터 스킬 데이터 추가
      const actor = this.actor;
      data.system.actorSkills = actor?.system?.attributes?.skills || {};
      // 통합 스킬 선택 옵션 생성
      if (window.DX3rdSkillManager && window.DX3rdSkillManager.getSkillSelectOptions) {
        data.system.skillOptions = window.DX3rdSkillManager.getSkillSelectOptions('spell', data.system.actorSkills);
      } else {
        console.error('DX3rd | SkillManager not found');
        data.system.skillOptions = [];
      }

      // 모든 system 필드가 undefined인 경우 현재 아이템의 값을 사용
      const systemFields = [
        'spelltype', 'exp', 'invoke', 'evocation', 'encroach', 'description',
        'roll', 'macro', 'active', 'effect', 'attributes', 'skills', 'getTarget', 'scene', 'temporarySpell'
      ];

      systemFields.forEach(field => {
        if (data.system[field] === undefined) {
          // 문자열 필드와 객체 필드를 구분하여 처리
          const stringFields = ['spelltype', 'exp', 'invoke', 'evocation', 'encroach', 'description', 'roll', 'macro'];
          const booleanFields = ['getTarget', 'scene', 'temporarySpell'];
          const defaultValue = stringFields.includes(field) ?
            (field === 'exp' ? 0 : field === 'invoke' || field === 'evocation' ? '-' : '') :
            booleanFields.includes(field) ? false : {};

          data.system[field] = this.item.system[field] || defaultValue;
        }
      });


    // 활성화 체크박스 초기화
    if (typeof data.system.active?.state === 'undefined') data.system.active.state = false;
    if (!data.system.active?.disable) data.system.active.disable = "-";
    if (!data.system.active?.runTiming) data.system.active.runTiming = this.item.system?.active?.runTiming || "instant";

    // effect 객체 초기화 (기존 데이터 보존)
    if (!data.system.effect) data.system.effect = {};
    if (!data.system.effect.disable) data.system.effect.disable = this.item.system?.effect?.disable || "notCheck";
    if (!data.system.effect.runTiming) data.system.effect.runTiming = this.item.system?.effect?.runTiming || "instant";

      // Biography 리치 텍스트 처리 (helpers.js 사용)
      data = await window.DX3rdDescriptionManager.enrichSheetData(data, this.item);

      // attributes와 effect.attributes의 기존 값 보존
      if (this.item.system.attributes) {
        data.system.attributes = { ...this.item.system.attributes };
      }

      if (this.item.system.effect?.attributes) {
        data.system.effect.attributes = { ...this.item.system.effect.attributes };
      }

      return data;
    }

    /** @override */
    activateListeners(html) {
      super.activateListeners(html);

    // Target Tab 통합 리스너는 부모 클래스(item-sheet.js)에서 자동 설정됨

    // Active 체크박스 변경 핸들러
    html.on('change', 'input[name="system.active.state"]', this._onActiveChange.bind(this));

    // Active disable 변경 핸들러
    html.on('change', 'select[name="system.active.disable"]', this._onActiveDisableChange.bind(this));

    // Casting Roll 체크박스 변경 핸들러
    html.on('change', 'input[name="system.castingRollCheck"]', this._onCastingRollCheckChange.bind(this));


      // 즉시 업데이트를 위한 일반 이벤트 리스너 (속성 추가 중에는 비활성화, attribute-key 제외)
      html.on('change', 'input[name^="system."], select[name^="system."]:not([name$=".key"]), textarea[name^="system."]', async (event) => {
        // 속성 추가 중에는 즉시 업데이트 비활성화
        if (this._isAddingAttribute) return;

        const name = event.currentTarget.name;

        // 별도 핸들러로 처리되는 필드들은 제외
        const excludedFields = [
          'system.active.state',
          'system.active.disable',
          'system.castingRollCheck',
          'system.getTarget',
          'system.scene',
          'system.effect.disable',
          'system.effect.runTiming'
        ];
        if (excludedFields.includes(name)) return;

        const value = event.currentTarget.type === 'checkbox' ? event.currentTarget.checked : event.currentTarget.value;

        const updates = foundry.utils.expandObject({
          [name]: event.currentTarget.type === 'number' ? parseInt(value) || 0 :
            event.currentTarget.type === 'checkbox' ? value :
              value
        });

        try {
          await this.item.update(updates);
        } catch (e) {
          console.error('DX3rd | SpellSheet immediate update failed:', e);
        }
      });

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
          console.error('DX3rd | SpellSheet active.runTiming update failed', e);
        }
      });
    }

  // Active 체크박스 변경 핸들러
  async _onActiveChange(event) {
    event.preventDefault();
    const state = $(event.currentTarget).is(':checked');

    try {
      await this.item.update({ 'system.active.state': state });
    } catch (e) {
      console.error('DX3rd | SpellSheet active update failed', e);
    }
  }

  // Casting Roll 체크박스 변경 핸들러
  async _onCastingRollCheckChange(event) {
    event.preventDefault();
    const isChecked = $(event.currentTarget).is(':checked');
    const newRollValue = isChecked ? 'CastingRoll' : '-';

    try {
      const updates = { 'system.roll': newRollValue };
      
      // 체크 해제 시 invoke와 evocation 값을 '-'로 초기화
      if (!isChecked) {
        updates['system.invoke.value'] = '-';
        updates['system.evocation.value'] = '-';
      }
      
      await this.item.update(updates);
    } catch (e) {
      console.error('DX3rd | SpellSheet casting roll update failed', e);
    }
  }

  // _onActiveDisableChange는 부모 클래스(item-sheet.js)에서 상속됨
}

  // Spell 시트 등록 (v13 호환)
  const ItemsClass = foundry.documents?.collections?.Items || Items;
  ItemsClass.registerSheet('dx3rd-emanim', DX3rdSpellSheet, {
    types: ['spell'],
    makeDefault: true
  });

  // 전역 노출
  window.DX3rdSpellSheet = DX3rdSpellSheet;
})();