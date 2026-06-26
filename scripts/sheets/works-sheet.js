// Works 아이템 시트
(function() {
class DX3rdWorksSheet extends window.DX3rdItemSheet {
  /** @override */
  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      template: "systems/dx3rd-emanim/templates/item/works-sheet.html",
      width: 520,
      height: 480
    });
  }

  /** @override */
  async getData(options) {
    let data = await super.getData(options);

    // Description 원문을 아이템에서 보강
    if (data.system.description === undefined) {
      data.system.description = this.item.system?.description || "";
    }
    
    // Description 에디터를 위한 데이터 추가 (helpers.js 사용)
    data = await window.DX3rdDescriptionManager.enrichSheetData(data, this.item);

    // actorSkills를 액터의 시스템에서 가져와서 정렬
    const actor = this.item.actor;
    if (actor) {
      const skills = actor.system.attributes.skills || {};
      
      // 기본 스킬 정의
      const defaultSkills = ['melee', 'evade', 'ranged', 'perception', 'rc', 'will', 'cthulhu', 'negotiation', 'procure'];
      
      // 능력치별로 스킬 분류 및 정렬
      const sortedSkills = {};
      const abilityOrder = ['body', 'sense', 'mind', 'social'];
      
      for (const ability of abilityOrder) {
        // 해당 능력치의 기본 스킬들
        const defaultForAbility = defaultSkills.filter(skillKey => {
          const skill = skills[skillKey];
          return skill && skill.base === ability;
        });
        
        // 해당 능력치의 커스텀 스킬들
        const customForAbility = Object.keys(skills).filter(skillKey => {
          const skill = skills[skillKey];
          return skill && skill.base === ability && !defaultSkills.includes(skillKey);
        }).sort(); // 커스텀 스킬은 알파벳순
        
        // 기본 스킬 먼저, 그 다음 커스텀 스킬
        for (const skillKey of [...defaultForAbility, ...customForAbility]) {
          sortedSkills[skillKey] = skills[skillKey];
        }
      }
      
      data.system.actorSkills = sortedSkills;
    } else {
      data.system.actorSkills = {};
    }

    // 현재 아이템의 skills가 없으면 빈 객체로 초기화하되, 실제 아이템 값을 우선 사용
    const itemSkills = this.item.system?.skills || {};
    data.system.skills = itemSkills;

    // 선택된 임시 스킬 키 유지
    if (data.system.skillTmp === undefined) {
      data.system.skillTmp = this.item.system?.skillTmp ?? "-";
    }

    // 아이템의 실제 attributes를 우선 사용하고, 없을 때만 기본값 보충
    const currentAttrs = this.item.system?.attributes || {};
    data.system.attributes = data.system.attributes || {};

    // body
    data.system.attributes.body = currentAttrs.body || data.system.attributes.body || {};
    if (data.system.attributes.body.value == null) data.system.attributes.body.value = 0;
    // sense
    data.system.attributes.sense = currentAttrs.sense || data.system.attributes.sense || {};
    if (data.system.attributes.sense.value == null) data.system.attributes.sense.value = 0;
    // mind
    data.system.attributes.mind = currentAttrs.mind || data.system.attributes.mind || {};
    if (data.system.attributes.mind.value == null) data.system.attributes.mind.value = 0;
    // social
    data.system.attributes.social = currentAttrs.social || data.system.attributes.social || {};
    if (data.system.attributes.social.value == null) data.system.attributes.social.value = 0;

    return data;
  }

  /** @override */
  activateListeners(html) {
    super.activateListeners(html);

    // 스킬 생성 버튼
    html.find('.skill-create').click(this._onCreateSkill.bind(this));
    
    // 부모 클래스의 스킬 삭제 리스너 제거 후 재등록
    html.find('.attribute-control[data-action="delete"]').off('click').on('click', this._onDeleteSkill.bind(this));
    
    // 스킬 적용 체크박스
    html.find('.attribute-control[type="checkbox"]').change(this._onToggleSkill.bind(this));

    // 기능치 드롭다운 선택 변경 시 즉시 저장하여 선택 상태 유지
    html.on('change', 'select[name="system.skillTmp"]', async (event) => {
      const selected = event.currentTarget.value;
      try {
        await this.item.update({ 'system.skillTmp': selected });
      } catch (e) {
        console.error('DX3rd | WorksSheet skillTmp update failed', e);
      }
    });

    // 능력치 입력 변경 리스너 (body/sense/mind/social)
    html.on('change', 'input[name="system.attributes.body.value"]', this._onAttrChange.bind(this));
    html.on('change', 'input[name="system.attributes.sense.value"]', this._onAttrChange.bind(this));
    html.on('change', 'input[name="system.attributes.mind.value"]', this._onAttrChange.bind(this));
    html.on('change', 'input[name="system.attributes.social.value"]', this._onAttrChange.bind(this));
  }

  async _onAttrChange(event) {
    event.preventDefault();
    const input = event.currentTarget;
    const path = input.name; // e.g., system.attributes.body.value
    const value = Number(input.value) || 0;

    try {
      await this.item.update({ [path]: value });
    } catch (err) {
      console.error("DX3rd | WorksSheet attribute update failed", err);
    }
  }
  
  async _onCreateSkill(event) {
    event.preventDefault();
    const skillKey = $(event.currentTarget).closest('.add-skills').find('#actor-skill').val();
    if (!skillKey) return;

    const actor = this.item.actor;
    const actorSkills = actor?.system?.attributes?.skills || {};
    const actorSkill = actorSkills[skillKey];
    if (!actorSkill) return;

    const skills = this.item.system.skills || {};
    if (skills[skillKey]) {
      ui.notifications.error(game.i18n.localize("DX3rd.ErrorSkillExists"));
      return;
    }

    const newSkill = {
      key: skillKey,
      name: actorSkill.name,
      base: actorSkill.base,
      dice: actorSkill.dice,
      add: actorSkill.add,
      bonus: 0,
      apply: true
    };

    try {
      await this.item.update({ [`system.skills.${skillKey}`]: newSkill });
      // 추가 직후 즉시 표시되도록 재렌더
      this.render(false);
    } catch (e) {
      console.error('DX3rd | WorksSheet _onCreateSkill update failed', e);
    }
  }

  async _onDeleteSkill(event) {
    event.preventDefault();
    const skillKey = $(event.currentTarget).closest('.attribute').data('attribute');
    if (!skillKey) return;

    const confirmed = await Dialog.confirm({
      title: game.i18n.localize("DX3rd.DeleteSkill"),
      content: game.i18n.format("DX3rd.ConfirmDeleteSkill", { name: this.item.system.skills[skillKey].name })
    });

    if (confirmed) {
      await this.item.update({
        [`system.skills.-=${skillKey}`]: null
      });
    }
  }

  async _onToggleSkill(event) {
    event.preventDefault();
    const skillKey = $(event.currentTarget).closest('.attribute').data('attribute');
    if (!skillKey) return;

    const apply = $(event.currentTarget).prop('checked');
    await this.item.update({
      [`system.skills.${skillKey}.apply`]: apply
    });
  }
}

// Works 시트 등록 (v13 호환)
const ItemsClass = foundry.documents?.collections?.Items || Items;
ItemsClass.registerSheet('dx3rd-emanim', DX3rdWorksSheet, {
  types: ['works'],
  makeDefault: true
});

// 전역 노출
window.DX3rdWorksSheet = DX3rdWorksSheet;
})();
