// Works 아이템 시트
(function() {
const compat = window.DX3rdApplicationCompat;
const itemSheetData = window.DX3rdItemSheetData;

class DX3rdWorksSheet extends window.DX3rdItemSheet {
  /** @override */
  async getData(options) {
    let data = await super.getData(options);

    // Description 에디터를 위한 데이터 추가 (helpers.js 사용)
    data = await itemSheetData.enrichSheetData(this.item, data);

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
    itemSheetData.prepareAbilityAttributeValues(this.item, data);

    return data;
  }

  /** @override */
  activateListeners(html) {
    super.activateListeners(html);
    const root = compat.unwrapRoot(html);

    // 기능치 드롭다운 선택 변경 시 즉시 저장하여 선택 상태 유지
    compat.on(root, 'change', 'select[name="system.skillTmp"]', async (event) => {
      const selected = event.target.value;
      try {
        await this.item.update({ 'system.skillTmp': selected });
      } catch (e) {
        console.error('DX3rd | WorksSheet skillTmp update failed', e);
      }
    });

    // 능력치 입력 변경 리스너 (body/sense/mind/social)
    compat.on(root, 'change', 'input[name="system.attributes.body.value"]', this._onAttrChange.bind(this));
    compat.on(root, 'change', 'input[name="system.attributes.sense.value"]', this._onAttrChange.bind(this));
    compat.on(root, 'change', 'input[name="system.attributes.mind.value"]', this._onAttrChange.bind(this));
    compat.on(root, 'change', 'input[name="system.attributes.social.value"]', this._onAttrChange.bind(this));
  }

  async _onAttrChange(event) {
    event.preventDefault();
    const input = event.target;
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
    const addSkills = compat.closest(event.target, '.add-skills');
    const skillKey = compat.query(addSkills, '#actor-skill')?.value;
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
    const skillKey = compat.closest(event.target, '.attribute')?.dataset.attribute;
    if (!skillKey) return;

    await window.DX3rdItemSheetDialogs.deleteSkillEntry(this.item, skillKey);
  }

  async _onToggleSkill(event) {
    event.preventDefault();
    const skillKey = compat.closest(event.target, '.attribute')?.dataset.attribute;
    if (!skillKey) return;

    const apply = event.target.checked;
    await this.item.update({
      [`system.skills.${skillKey}.apply`]: apply
    });
  }
}

// Works 시트 등록 (v13 호환)
const ItemsClass = foundry.documents?.collections?.Items || Items;
ItemsClass.registerSheet('dx3rd-emanim', DX3rdWorksSheet, {
  label: 'DX3rd.SheetV1',
  types: ['works'],
  makeDefault: true
});

// 전역 노출
window.DX3rdWorksSheet = DX3rdWorksSheet;
})();
