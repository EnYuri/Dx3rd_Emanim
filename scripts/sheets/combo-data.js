/** Shared template-context preparation for AppV1 and AppV2 combo sheets. */
(function() {
  async function prepareSheetData(data, item, actor) {
    
    // 액터 정보 추가 (에너미 체크용)
    if (actor) {
      data.actor = {
        id: actor.id,
        type: actor.type
      };
    } else {
      data.actor = null;
    }

    // Description 원문을 아이템에서 보강
    if (data.system.description === undefined) {
      data.system.description = item.system?.description || "";
    }

    // 콤보 시트 필드 초기화 (기존 데이터 보존)

    // 기본 필드들 초기화
    data.system.skill = item.system?.skill || "-";
    data.system.base = item.system?.base || "-";
    data.system.roll = item.system?.roll || "-";
    data.system.difficulty = item.system?.difficulty || "";
    data.system.timing = item.system?.timing || "-";
    data.system.range = item.system?.range || "";
    data.system.target = item.system?.target || "";
    data.system.getTarget = item.system?.getTarget || false;
    data.system.limit = item.system?.limit || "-";

    // active 객체 초기화 (기존 데이터 보존)
    if (!data.system.active) data.system.active = {};
    if (data.system.active.state === undefined) data.system.active.state = item.system?.active?.state || false;
    if (data.system.active.disable === undefined) data.system.active.disable = item.system?.active?.disable || "notCheck";
    if (data.system.active.runTiming === undefined) data.system.active.runTiming = item.system?.active?.runTiming || "instant";

    // effect 객체 초기화 (기존 데이터 보존)
    if (!data.system.effect) data.system.effect = {};
    if (data.system.effect.disable === undefined) data.system.effect.disable = item.system?.effect?.disable || "notCheck";
    if (data.system.effect.runTiming === undefined) data.system.effect.runTiming = item.system?.effect?.runTiming || "instant";

    // macro 초기화
    data.system.macro = item.system?.macro || "";

    // 이펙트 관련 데이터 초기화
    data.system.effectTmp = item.system?.effectTmp || "-";
    // effectIds: 콤보에 포함된 이펙트 아이디 배열 (system.effect와 설정 객체 충돌 방지)
    data.system.effectIds = item.system?.effectIds || item.system?.effect || [];
    data.system.effectItems = {};
    
    // attackAchievement 초기화
    data.system.attackAchievement = item.system?.attackAchievement || "-";
    
    // system.roll과 system.attackRoll 확인
    const hasRoll = data.system.roll && data.system.roll !== '-';
    const hasAttackRoll = data.system.attackRoll && data.system.attackRoll !== '-';
    
    // roll이 "-"이면 다이스/크리티컬/수정치를 "-"로 표시
    if (!hasRoll) {
      data.system.dice = { value: '-' };
      data.system.critical = { value: '-', min: '-' };
      data.system.add = { value: '-' };
    } else {
      data.system.dice = item.system?.dice || { value: 0 };
      data.system.critical = item.system?.critical || { value: 0, min: 2 };
      data.system.add = item.system?.add || { value: 0 };
    }
    
    // attackRoll이 "-"이면 공격력을 "-"로 표시
    if (!hasAttackRoll) {
      data.system.attack = { value: '-' };
    } else {
      data.system.attack = item.system?.attack || { value: 0 };
    }
    
    data.system.encroach = item.system?.encroach || { value: 0 };

    // 액터 이펙트 아이템 목록 생성 (sort 값으로 정렬)
    data.actorEffect = {};
    if (actor) {
      const effectItems = actor.items.filter(item => item.type === 'effect')
        .sort((a, b) => (a.sort || 0) - (b.sort || 0));
      effectItems.forEach(item => {
        data.actorEffect[item.id] = item.name;
      });
    }

    // 이펙트 아이템 데이터 로드 및 침식률 자동 계산
    let totalDice = 0;
    let totalAdd = 0;
    
    if (Array.isArray(data.system.effectIds)) {
      data.system.effectIds.forEach(effectId => {
        if (effectId && effectId !== '-') {
          // 액터의 이펙트 아이템에서 찾기
          const effectItem = actor?.items.get(effectId);
          if (effectItem) {
            data.system.effectItems[effectId] = effectItem;
            // 침식률 합산 (필드명: encroach, not encroachment)
            const encValue = String(effectItem.system.encroach?.value || '0').trim();
            
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
      });
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
    
    // 계산된 총 침식률을 data.system.encroach에 반영
    data.system.encroach = { value: totalEncroachment };

    // roll이 설정되어 있으면 다이스/크리티컬/수정치 자동 계산
    if (hasRoll) {
      const skillKey = data.system.skill;
      const baseKey = data.system.base || '-';
      
      if (actor && skillKey && skillKey !== '-') {
        // 스킬이 능력치인 경우 vs 일반 스킬인 경우
        const attributes = ['body', 'sense', 'mind', 'social'];
        let skillData = null;
        let baseData = null;
        
        if (attributes.includes(skillKey)) {
          // 능력치를 직접 사용하는 경우
          skillData = actor.system.attributes[skillKey];
          baseData = skillData;  // base = 능력치 자체
        } else {
          // 일반 스킬인 경우
          skillData = actor.system.attributes.skills?.[skillKey];
          
          // base 확인: system.base가 설정되어 있으면 그것 사용, 없으면 스킬의 기본 base
          const effectiveBase = (baseKey && baseKey !== '-') ? baseKey : skillData?.base;
          
          if (effectiveBase && attributes.includes(effectiveBase)) {
            baseData = actor.system.attributes[effectiveBase];
          }
        }
        
        if (skillData && baseData) {
          const rollType = data.system.roll;
          
          // 스킬이 능력치인 경우와 일반 스킬인 경우 분기
          let dice = 0;
          let add = 0;
          let critical = 10;
          let criticalMin = actor.system.attributes.critical?.min || 2;
          
          if (attributes.includes(skillKey)) {
            // 능력치를 직접 사용하는 경우 (body, sense, mind, social)
            // base의 roll 타입별 데이터 사용
            if (rollType === 'major' && baseData.major) {
              dice = baseData.major.dice || 0;
              add = baseData.major.add || 0;
              critical = baseData.major.critical || 10;
            } else if (rollType === 'reaction' && baseData.reaction) {
              dice = baseData.reaction.dice || 0;
              add = baseData.reaction.add || 0;
              critical = baseData.reaction.critical || 10;
            } else if (rollType === 'dodge' && baseData.dodge) {
              dice = baseData.dodge.dice || 0;
              add = baseData.dodge.add || 0;
              critical = baseData.dodge.critical || 10;
            }
          } else {
            // 일반 스킬인 경우
            // 커스텀 base를 사용하는 경우, base의 roll 데이터 + 스킬 순수 보정
            const originalBase = skillData.base;
            const originalBaseData = actor.system.attributes[originalBase];
            
            // 스킬의 순수 보정 계산
            const skillDiceBonus = (skillData.dice || 0) - (originalBaseData?.dice || 0);
            const skillAddBonus = (skillData.add || 0) - (originalBaseData?.add || 0);
            
            // 커스텀 base의 roll 타입별 데이터
            let baseRollData = null;
            if (rollType === 'major') {
              baseRollData = baseData.major;
            } else if (rollType === 'reaction') {
              baseRollData = baseData.reaction;
            } else if (rollType === 'dodge') {
              baseRollData = baseData.dodge;
            }
            
            if (baseRollData) {
              dice = (baseRollData.dice || 0) + skillDiceBonus;
              add = (baseRollData.add || 0) + skillAddBonus;
              critical = baseRollData.critical || 10;
            }
          }
          
          // 무기 add 보너스 추가 (system.attackRoll이 '-'가 아닐 경우)
          let weaponAddBonus = 0;
          const currentAttackRoll = item.system.attackRoll || data.system.attackRoll;
          if (currentAttackRoll && currentAttackRoll !== '-') {
            const registeredWeapons = item.system.weapon || data.system.weapon || [];
            
            for (const weaponId of registeredWeapons) {
              if (weaponId && weaponId !== '-') {
                const weaponItem = actor?.items.get(weaponId);
                if (weaponItem) {
                  const weaponAdd = Number(weaponItem.system?.add) || 0;
                  weaponAddBonus += weaponAdd;
                }
              }
            }
            
            add += weaponAddBonus;
          }
          
          // 콤보 아이템 자체의 attributes 보너스 추가 (활성화되지 않은 경우만)
          // stat_bonus, skill_bonus는 제외 (능력치/스킬 total 값에 영향을 주므로 dice/add 계산과는 별개)
          if (rollType && rollType !== '-') {
            const comboIsActive = item.system?.active?.state === true;
            let comboCriticalMod = 0;
            
            if (!comboIsActive) {
              // 능력치/스킬명 확인
              // 콤보의 system.base가 설정되어 있으면 그것을 우선 사용
              const isAbility = attributes.includes(skillKey);
              const effectiveBaseKey = (baseKey && baseKey !== '-') ? baseKey : (isAbility ? skillKey : skillData?.base);
              
              // 콤보 아이템 자체의 attributes 계산
              if (item.system?.attributes) {
                for (const [attrKey, attrData] of Object.entries(item.system.attributes)) {
                  if (!attrData || !attrData.key || !attrData.value) continue;
                  
                  // 판정 타입별 보너스 계산
                  if (rollType === 'major') {
                    if (attrData.key === 'major_dice') {
                      const bonusValue = window.DX3rdFormulaEvaluator?.evaluate(attrData.value, item, actor) || 0;
                      dice += Number(bonusValue) || 0;
                    } else if (attrData.key === 'major_add') {
                      const bonusValue = window.DX3rdFormulaEvaluator?.evaluate(attrData.value, item, actor) || 0;
                      add += Number(bonusValue) || 0;
                    } else if (attrData.key === 'major_critical') {
                      const bonusValue = window.DX3rdFormulaEvaluator?.evaluate(attrData.value, item, actor) || 0;
                      comboCriticalMod += Number(bonusValue) || 0;
                    } else if (attrData.key === 'dice') {
                      const bonusValue = window.DX3rdFormulaEvaluator?.evaluate(attrData.value, item, actor) || 0;
                      dice += Number(bonusValue) || 0;
                    } else if (attrData.key === 'add') {
                      const bonusValue = window.DX3rdFormulaEvaluator?.evaluate(attrData.value, item, actor) || 0;
                      add += Number(bonusValue) || 0;
                    } else if (attrData.key === 'critical') {
                      const bonusValue = window.DX3rdFormulaEvaluator?.evaluate(attrData.value, item, actor) || 0;
                      comboCriticalMod += Number(bonusValue) || 0;
                    } else if (attrData.key === 'critical_min' && attrData.value) {
                      const minValue = window.DX3rdFormulaEvaluator?.evaluate(attrData.value, item, actor) || 10;
                      const numValue = Number(minValue) || 10;
                      if (numValue < criticalMin) {
                        criticalMin = numValue;
                      }
                    }
                  } else if (rollType === 'reaction') {
                    if (attrData.key === 'reaction_dice') {
                      const bonusValue = window.DX3rdFormulaEvaluator?.evaluate(attrData.value, item, actor) || 0;
                      dice += Number(bonusValue) || 0;
                    } else if (attrData.key === 'reaction_add') {
                      const bonusValue = window.DX3rdFormulaEvaluator?.evaluate(attrData.value, item, actor) || 0;
                      add += Number(bonusValue) || 0;
                    } else if (attrData.key === 'reaction_critical') {
                      const bonusValue = window.DX3rdFormulaEvaluator?.evaluate(attrData.value, item, actor) || 0;
                      comboCriticalMod += Number(bonusValue) || 0;
                    } else if (attrData.key === 'dice') {
                      const bonusValue = window.DX3rdFormulaEvaluator?.evaluate(attrData.value, item, actor) || 0;
                      dice += Number(bonusValue) || 0;
                    } else if (attrData.key === 'add') {
                      const bonusValue = window.DX3rdFormulaEvaluator?.evaluate(attrData.value, item, actor) || 0;
                      add += Number(bonusValue) || 0;
                    } else if (attrData.key === 'critical') {
                      const bonusValue = window.DX3rdFormulaEvaluator?.evaluate(attrData.value, item, actor) || 0;
                      comboCriticalMod += Number(bonusValue) || 0;
                    } else if (attrData.key === 'critical_min' && attrData.value) {
                      const minValue = window.DX3rdFormulaEvaluator?.evaluate(attrData.value, item, actor) || 10;
                      const numValue = Number(minValue) || 10;
                      if (numValue < criticalMin) {
                        criticalMin = numValue;
                      }
                    }
                  } else if (rollType === 'dodge') {
                    if (attrData.key === 'reaction_dice' || attrData.key === 'dodge_dice') {
                      const bonusValue = window.DX3rdFormulaEvaluator?.evaluate(attrData.value, item, actor) || 0;
                      dice += Number(bonusValue) || 0;
                    } else if (attrData.key === 'reaction_add' || attrData.key === 'dodge_add') {
                      const bonusValue = window.DX3rdFormulaEvaluator?.evaluate(attrData.value, item, actor) || 0;
                      add += Number(bonusValue) || 0;
                    } else if (attrData.key === 'reaction_critical' || attrData.key === 'dodge_critical') {
                      const bonusValue = window.DX3rdFormulaEvaluator?.evaluate(attrData.value, item, actor) || 0;
                      comboCriticalMod += Number(bonusValue) || 0;
                    } else if (attrData.key === 'dice') {
                      const bonusValue = window.DX3rdFormulaEvaluator?.evaluate(attrData.value, item, actor) || 0;
                      dice += Number(bonusValue) || 0;
                    } else if (attrData.key === 'add') {
                      const bonusValue = window.DX3rdFormulaEvaluator?.evaluate(attrData.value, item, actor) || 0;
                      add += Number(bonusValue) || 0;
                    } else if (attrData.key === 'critical') {
                      const bonusValue = window.DX3rdFormulaEvaluator?.evaluate(attrData.value, item, actor) || 0;
                      comboCriticalMod += Number(bonusValue) || 0;
                    } else if (attrData.key === 'critical_min' && attrData.value) {
                      const minValue = window.DX3rdFormulaEvaluator?.evaluate(attrData.value, item, actor) || 10;
                      const numValue = Number(minValue) || 10;
                      if (numValue < criticalMin) {
                        criticalMin = numValue;
                      }
                    }
                  }
                  
                  // 능력치/스킬 보너스는 모든 판정 타입에 적용
                  if (attrData.key === 'stat_dice' && attrData.label) {
                    if (isAbility && attrData.label === skillKey) {
                      const bonusValue = window.DX3rdFormulaEvaluator?.evaluate(attrData.value, item, actor) || 0;
                      dice += Number(bonusValue) || 0;
                    } else if (!isAbility) {
                      const matchesDirect = attrData.label === skillKey;
                      const matchesGroup = window.DX3rdSkillGroupMatcher?.isSkillInGroup(skillKey, attrData.label);
                      const matchesBase = effectiveBaseKey && attrData.label === effectiveBaseKey;
                      if (matchesDirect || matchesGroup || matchesBase) {
                        const bonusValue = window.DX3rdFormulaEvaluator?.evaluate(attrData.value, item, actor) || 0;
                        dice += Number(bonusValue) || 0;
                      }
                    }
                  } else if (attrData.key === 'stat_add' && attrData.label) {
                    if (isAbility && attrData.label === skillKey) {
                      const bonusValue = window.DX3rdFormulaEvaluator?.evaluate(attrData.value, item, actor) || 0;
                      add += Number(bonusValue) || 0;
                    } else if (!isAbility) {
                      const matchesDirect = attrData.label === skillKey;
                      const matchesGroup = window.DX3rdSkillGroupMatcher?.isSkillInGroup(skillKey, attrData.label);
                      const matchesBase = effectiveBaseKey && attrData.label === effectiveBaseKey;
                      if (matchesDirect || matchesGroup || matchesBase) {
                        const bonusValue = window.DX3rdFormulaEvaluator?.evaluate(attrData.value, item, actor) || 0;
                        add += Number(bonusValue) || 0;
                      }
                    }
                  }
                  // stat_bonus, skill_bonus는 제외
                }
              }
              
              // 콤보 아이템 자체의 effect.attributes 계산
              if (item.system?.effect?.attributes) {
                for (const [attrName, attrValue] of Object.entries(item.system.effect.attributes)) {
                  const aKey = (typeof attrValue === 'object' && attrValue.key) ? attrValue.key : attrName;
                  const aLabel = (typeof attrValue === 'object' && attrValue.label) ? attrValue.label : 
                                (typeof attrName === 'string' && attrName.includes(':')) ? attrName.split(':')[1] : '';
                  if (!aKey) continue;
                  
                  // 판정 타입별 보너스 계산
                  if (rollType === 'major') {
                    if (aKey === 'major_dice') {
                      const evalValue = (typeof attrValue === 'object' && 'value' in attrValue) 
                        ? (Number(attrValue.value) || 0) 
                        : (window.DX3rdFormulaEvaluator?.evaluate(attrValue, item, actor) || 0);
                      dice += Number(evalValue) || 0;
                    } else if (aKey === 'major_add') {
                      const evalValue = (typeof attrValue === 'object' && 'value' in attrValue) 
                        ? (Number(attrValue.value) || 0) 
                        : (window.DX3rdFormulaEvaluator?.evaluate(attrValue, item, actor) || 0);
                      add += Number(evalValue) || 0;
                    } else if (aKey === 'major_critical') {
                      const evalValue = (typeof attrValue === 'object' && 'value' in attrValue) 
                        ? (Number(attrValue.value) || 0) 
                        : (window.DX3rdFormulaEvaluator?.evaluate(attrValue, item, actor) || 0);
                      comboCriticalMod += Number(evalValue) || 0;
                    } else if (aKey === 'dice') {
                      const evalValue = (typeof attrValue === 'object' && 'value' in attrValue) 
                        ? (Number(attrValue.value) || 0) 
                        : (window.DX3rdFormulaEvaluator?.evaluate(attrValue, item, actor) || 0);
                      dice += Number(evalValue) || 0;
                    } else if (aKey === 'add') {
                      const evalValue = (typeof attrValue === 'object' && 'value' in attrValue) 
                        ? (Number(attrValue.value) || 0) 
                        : (window.DX3rdFormulaEvaluator?.evaluate(attrValue, item, actor) || 0);
                      add += Number(evalValue) || 0;
                    } else if (aKey === 'critical') {
                      const evalValue = (typeof attrValue === 'object' && 'value' in attrValue) 
                        ? (Number(attrValue.value) || 0) 
                        : (window.DX3rdFormulaEvaluator?.evaluate(attrValue, item, actor) || 0);
                      comboCriticalMod += Number(evalValue) || 0;
                    } else if (aKey === 'critical_min') {
                      const evalValue = (typeof attrValue === 'object' && 'value' in attrValue) 
                        ? (Number(attrValue.value) || 10) 
                        : (window.DX3rdFormulaEvaluator?.evaluate(attrValue, item, actor) || 10);
                      const numValue = Number(evalValue) || 10;
                      if (numValue < criticalMin) {
                        criticalMin = numValue;
                      }
                    }
                  } else if (rollType === 'reaction') {
                    if (aKey === 'reaction_dice') {
                      const evalValue = (typeof attrValue === 'object' && 'value' in attrValue) 
                        ? (Number(attrValue.value) || 0) 
                        : (window.DX3rdFormulaEvaluator?.evaluate(attrValue, item, actor) || 0);
                      dice += Number(evalValue) || 0;
                    } else if (aKey === 'reaction_add') {
                      const evalValue = (typeof attrValue === 'object' && 'value' in attrValue) 
                        ? (Number(attrValue.value) || 0) 
                        : (window.DX3rdFormulaEvaluator?.evaluate(attrValue, item, actor) || 0);
                      add += Number(evalValue) || 0;
                    } else if (aKey === 'reaction_critical') {
                      const evalValue = (typeof attrValue === 'object' && 'value' in attrValue) 
                        ? (Number(attrValue.value) || 0) 
                        : (window.DX3rdFormulaEvaluator?.evaluate(attrValue, item, actor) || 0);
                      comboCriticalMod += Number(evalValue) || 0;
                    } else if (aKey === 'dice') {
                      const evalValue = (typeof attrValue === 'object' && 'value' in attrValue) 
                        ? (Number(attrValue.value) || 0) 
                        : (window.DX3rdFormulaEvaluator?.evaluate(attrValue, item, actor) || 0);
                      dice += Number(evalValue) || 0;
                    } else if (aKey === 'add') {
                      const evalValue = (typeof attrValue === 'object' && 'value' in attrValue) 
                        ? (Number(attrValue.value) || 0) 
                        : (window.DX3rdFormulaEvaluator?.evaluate(attrValue, item, actor) || 0);
                      add += Number(evalValue) || 0;
                    } else if (aKey === 'critical') {
                      const evalValue = (typeof attrValue === 'object' && 'value' in attrValue) 
                        ? (Number(attrValue.value) || 0) 
                        : (window.DX3rdFormulaEvaluator?.evaluate(attrValue, item, actor) || 0);
                      comboCriticalMod += Number(evalValue) || 0;
                    } else if (aKey === 'critical_min') {
                      const evalValue = (typeof attrValue === 'object' && 'value' in attrValue) 
                        ? (Number(attrValue.value) || 10) 
                        : (window.DX3rdFormulaEvaluator?.evaluate(attrValue, item, actor) || 10);
                      const numValue = Number(evalValue) || 10;
                      if (numValue < criticalMin) {
                        criticalMin = numValue;
                      }
                    }
                  } else if (rollType === 'dodge') {
                    if (aKey === 'reaction_dice' || aKey === 'dodge_dice') {
                      const evalValue = (typeof attrValue === 'object' && 'value' in attrValue) 
                        ? (Number(attrValue.value) || 0) 
                        : (window.DX3rdFormulaEvaluator?.evaluate(attrValue, item, actor) || 0);
                      dice += Number(evalValue) || 0;
                    } else if (aKey === 'reaction_add' || aKey === 'dodge_add') {
                      const evalValue = (typeof attrValue === 'object' && 'value' in attrValue) 
                        ? (Number(attrValue.value) || 0) 
                        : (window.DX3rdFormulaEvaluator?.evaluate(attrValue, item, actor) || 0);
                      add += Number(evalValue) || 0;
                    } else if (aKey === 'reaction_critical' || aKey === 'dodge_critical') {
                      const evalValue = (typeof attrValue === 'object' && 'value' in attrValue) 
                        ? (Number(attrValue.value) || 0) 
                        : (window.DX3rdFormulaEvaluator?.evaluate(attrValue, item, actor) || 0);
                      comboCriticalMod += Number(evalValue) || 0;
                    } else if (aKey === 'dice') {
                      const evalValue = (typeof attrValue === 'object' && 'value' in attrValue) 
                        ? (Number(attrValue.value) || 0) 
                        : (window.DX3rdFormulaEvaluator?.evaluate(attrValue, item, actor) || 0);
                      dice += Number(evalValue) || 0;
                    } else if (aKey === 'add') {
                      const evalValue = (typeof attrValue === 'object' && 'value' in attrValue) 
                        ? (Number(attrValue.value) || 0) 
                        : (window.DX3rdFormulaEvaluator?.evaluate(attrValue, item, actor) || 0);
                      add += Number(evalValue) || 0;
                    } else if (aKey === 'critical') {
                      const evalValue = (typeof attrValue === 'object' && 'value' in attrValue) 
                        ? (Number(attrValue.value) || 0) 
                        : (window.DX3rdFormulaEvaluator?.evaluate(attrValue, item, actor) || 0);
                      comboCriticalMod += Number(evalValue) || 0;
                    } else if (aKey === 'critical_min') {
                      const evalValue = (typeof attrValue === 'object' && 'value' in attrValue) 
                        ? (Number(attrValue.value) || 10) 
                        : (window.DX3rdFormulaEvaluator?.evaluate(attrValue, item, actor) || 10);
                      const numValue = Number(evalValue) || 10;
                      if (numValue < criticalMin) {
                        criticalMin = numValue;
                      }
                    }
                  }
                  
                  // 능력치/스킬 보너스는 모든 판정 타입에 적용
                  if (aKey === 'stat_dice' && aLabel) {
                    if (isAbility && aLabel === skillKey) {
                      const evalValue = (typeof attrValue === 'object' && 'value' in attrValue) 
                        ? (Number(attrValue.value) || 0) 
                        : (window.DX3rdFormulaEvaluator?.evaluate(attrValue, item, actor) || 0);
                      dice += Number(evalValue) || 0;
                    } else if (!isAbility) {
                      const matchesDirect = aLabel === skillKey;
                      const matchesGroup = window.DX3rdSkillGroupMatcher?.isSkillInGroup(skillKey, aLabel);
                      const matchesBase = effectiveBaseKey && aLabel === effectiveBaseKey;
                      if (matchesDirect || matchesGroup || matchesBase) {
                        const evalValue = (typeof attrValue === 'object' && 'value' in attrValue) 
                          ? (Number(attrValue.value) || 0) 
                          : (window.DX3rdFormulaEvaluator?.evaluate(attrValue, item, actor) || 0);
                        dice += Number(evalValue) || 0;
                      }
                    }
                  } else if (aKey === 'stat_add' && aLabel) {
                    if (isAbility && aLabel === skillKey) {
                      const evalValue = (typeof attrValue === 'object' && 'value' in attrValue) 
                        ? (Number(attrValue.value) || 0) 
                        : (window.DX3rdFormulaEvaluator?.evaluate(attrValue, item, actor) || 0);
                      add += Number(evalValue) || 0;
                    } else if (!isAbility) {
                      const matchesDirect = aLabel === skillKey;
                      const matchesGroup = window.DX3rdSkillGroupMatcher?.isSkillInGroup(skillKey, aLabel);
                      const matchesBase = effectiveBaseKey && aLabel === effectiveBaseKey;
                      if (matchesDirect || matchesGroup || matchesBase) {
                        const evalValue = (typeof attrValue === 'object' && 'value' in attrValue) 
                          ? (Number(attrValue.value) || 0) 
                          : (window.DX3rdFormulaEvaluator?.evaluate(attrValue, item, actor) || 0);
                        add += Number(evalValue) || 0;
                      }
                    }
                  }
                  // stat_bonus, skill_bonus는 제외
                }
              }
              
              // 콤보 아이템 자체의 critical 보너스 적용
              critical = critical + comboCriticalMod;
            }
          }
          
          // 이펙트 attributes 보너스 추가 (활성화되지 않은 것만)
          // stat_bonus, skill_bonus는 제외 (능력치/스킬 total 값에 영향을 주므로 dice/add 계산과는 별개)
          if (rollType && rollType !== '-' && Array.isArray(data.system.effectIds)) {
            let effectDiceBonus = 0;
            let effectAddBonus = 0;
            let effectCriticalMod = 0;
            let effectCriticalMin = criticalMin; // 초기값은 현재 criticalMin
            
            // 능력치/스킬명 확인
            // 콤보의 system.base가 설정되어 있으면 그것을 우선 사용
            const isAbility = attributes.includes(skillKey);
            const effectiveBaseKey = (baseKey && baseKey !== '-') ? baseKey : (isAbility ? skillKey : skillData?.base);
            
            for (const effectId of data.system.effectIds) {
              if (effectId && effectId !== '-') {
                const effectItem = actor?.items.get(effectId);
                if (effectItem && effectItem.type === 'effect') {
                  // 활성화된 이펙트는 이미 액터의 prepareData에서 계산되었으므로 제외 (2중 계산 방지)
                  const isActive = effectItem.system?.active?.state === true;
                  if (isActive) continue;
                  
                  // 이펙트의 attributes 확인 (활성화되지 않은 것만 계산)
                  if (effectItem.system?.attributes) {
                    for (const [attrKey, attrData] of Object.entries(effectItem.system.attributes)) {
                      if (!attrData || !attrData.key || !attrData.value) continue;
                      
                      // 판정 타입별 보너스 계산
                      if (rollType === 'major') {
                        // major 판정용
                        if (attrData.key === 'major_dice') {
                          const bonusValue = window.DX3rdFormulaEvaluator?.evaluate(attrData.value, effectItem, actor) || 0;
                          effectDiceBonus += Number(bonusValue) || 0;
                        } else if (attrData.key === 'major_add') {
                          const bonusValue = window.DX3rdFormulaEvaluator?.evaluate(attrData.value, effectItem, actor) || 0;
                          effectAddBonus += Number(bonusValue) || 0;
                        } else if (attrData.key === 'major_critical') {
                          const bonusValue = window.DX3rdFormulaEvaluator?.evaluate(attrData.value, effectItem, actor) || 0;
                          effectCriticalMod += Number(bonusValue) || 0;
                        } else if (attrData.key === 'dice') {
                          // 일반 dice 보너스
                          const bonusValue = window.DX3rdFormulaEvaluator?.evaluate(attrData.value, effectItem, actor) || 0;
                          effectDiceBonus += Number(bonusValue) || 0;
                        } else if (attrData.key === 'add') {
                          // 일반 add 보너스
                          const bonusValue = window.DX3rdFormulaEvaluator?.evaluate(attrData.value, effectItem, actor) || 0;
                          effectAddBonus += Number(bonusValue) || 0;
                        } else if (attrData.key === 'critical') {
                          // 일반 critical 보너스
                          const bonusValue = window.DX3rdFormulaEvaluator?.evaluate(attrData.value, effectItem, actor) || 0;
                          effectCriticalMod += Number(bonusValue) || 0;
                        }
                      } else if (rollType === 'reaction') {
                        // reaction 판정용
                        if (attrData.key === 'reaction_dice') {
                          const bonusValue = window.DX3rdFormulaEvaluator?.evaluate(attrData.value, effectItem, actor) || 0;
                          effectDiceBonus += Number(bonusValue) || 0;
                        } else if (attrData.key === 'reaction_add') {
                          const bonusValue = window.DX3rdFormulaEvaluator?.evaluate(attrData.value, effectItem, actor) || 0;
                          effectAddBonus += Number(bonusValue) || 0;
                        } else if (attrData.key === 'reaction_critical') {
                          const bonusValue = window.DX3rdFormulaEvaluator?.evaluate(attrData.value, effectItem, actor) || 0;
                          effectCriticalMod += Number(bonusValue) || 0;
                        } else if (attrData.key === 'dice') {
                          // 일반 dice 보너스
                          const bonusValue = window.DX3rdFormulaEvaluator?.evaluate(attrData.value, effectItem, actor) || 0;
                          effectDiceBonus += Number(bonusValue) || 0;
                        } else if (attrData.key === 'add') {
                          // 일반 add 보너스
                          const bonusValue = window.DX3rdFormulaEvaluator?.evaluate(attrData.value, effectItem, actor) || 0;
                          effectAddBonus += Number(bonusValue) || 0;
                        } else if (attrData.key === 'critical') {
                          // 일반 critical 보너스
                          const bonusValue = window.DX3rdFormulaEvaluator?.evaluate(attrData.value, effectItem, actor) || 0;
                          effectCriticalMod += Number(bonusValue) || 0;
                        }
                      } else if (rollType === 'dodge') {
                        // dodge 판정용 (reaction 보너스도 함께 적용)
                        if (attrData.key === 'reaction_dice' || attrData.key === 'dodge_dice') {
                          const bonusValue = window.DX3rdFormulaEvaluator?.evaluate(attrData.value, effectItem, actor) || 0;
                          effectDiceBonus += Number(bonusValue) || 0;
                        } else if (attrData.key === 'reaction_add' || attrData.key === 'dodge_add') {
                          const bonusValue = window.DX3rdFormulaEvaluator?.evaluate(attrData.value, effectItem, actor) || 0;
                          effectAddBonus += Number(bonusValue) || 0;
                        } else if (attrData.key === 'reaction_critical' || attrData.key === 'dodge_critical') {
                          const bonusValue = window.DX3rdFormulaEvaluator?.evaluate(attrData.value, effectItem, actor) || 0;
                          effectCriticalMod += Number(bonusValue) || 0;
                        } else if (attrData.key === 'dice') {
                          // 일반 dice 보너스
                          const bonusValue = window.DX3rdFormulaEvaluator?.evaluate(attrData.value, effectItem, actor) || 0;
                          effectDiceBonus += Number(bonusValue) || 0;
                        } else if (attrData.key === 'add') {
                          // 일반 add 보너스
                          const bonusValue = window.DX3rdFormulaEvaluator?.evaluate(attrData.value, effectItem, actor) || 0;
                          effectAddBonus += Number(bonusValue) || 0;
                        } else if (attrData.key === 'critical') {
                          // 일반 critical 보너스
                          const bonusValue = window.DX3rdFormulaEvaluator?.evaluate(attrData.value, effectItem, actor) || 0;
                          effectCriticalMod += Number(bonusValue) || 0;
                        }
                      }
                      
                      // 능력치/스킬 보너스는 모든 판정 타입에 적용
                      if (attrData.key === 'stat_dice' && attrData.label) {
                        // 능력치/스킬 다이스 보너스: 능력치 직접 사용 시 또는 스킬 사용 시 해당하는 것만
                        if (isAbility && attrData.label === skillKey) {
                          const bonusValue = window.DX3rdFormulaEvaluator?.evaluate(attrData.value, effectItem, actor) || 0;
                          effectDiceBonus += Number(bonusValue) || 0;
                        } else if (!isAbility) {
                          // 스킬 사용 시: 스킬명, 스킬 그룹, 또는 base 능력치 매칭
                          const matchesDirect = attrData.label === skillKey;
                          const matchesGroup = window.DX3rdSkillGroupMatcher?.isSkillInGroup(skillKey, attrData.label);
                          const matchesBase = effectiveBaseKey && attrData.label === effectiveBaseKey;
                          if (matchesDirect || matchesGroup || matchesBase) {
                            const bonusValue = window.DX3rdFormulaEvaluator?.evaluate(attrData.value, effectItem, actor) || 0;
                            effectDiceBonus += Number(bonusValue) || 0;
                          }
                        }
                      } else if (attrData.key === 'stat_add' && attrData.label) {
                        // 능력치/스킬 수정치 보너스
                        if (isAbility && attrData.label === skillKey) {
                          const bonusValue = window.DX3rdFormulaEvaluator?.evaluate(attrData.value, effectItem, actor) || 0;
                          effectAddBonus += Number(bonusValue) || 0;
                        } else if (!isAbility) {
                          // 스킬 사용 시: 스킬명, 스킬 그룹, 또는 base 능력치 매칭
                          const matchesDirect = attrData.label === skillKey;
                          const matchesGroup = window.DX3rdSkillGroupMatcher?.isSkillInGroup(skillKey, attrData.label);
                          const matchesBase = effectiveBaseKey && attrData.label === effectiveBaseKey;
                          if (matchesDirect || matchesGroup || matchesBase) {
                            const bonusValue = window.DX3rdFormulaEvaluator?.evaluate(attrData.value, effectItem, actor) || 0;
                            effectAddBonus += Number(bonusValue) || 0;
                          }
                        }
                      } else if (attrData.key === 'critical_min' && attrData.value) {
                        // 크리티컬 하한치: 가장 작은 값을 사용
                        const minValue = window.DX3rdFormulaEvaluator?.evaluate(attrData.value, effectItem, actor) || 10;
                        const numValue = Number(minValue) || 10;
                        if (numValue < effectCriticalMin) {
                          effectCriticalMin = numValue;
                        }
                      }
                      // stat_bonus, skill_bonus는 제외 (능력치/스킬 total 값에 영향을 주므로 dice/add 계산과는 별개)
                    }
                  }
                  
                  // effect.attributes도 확인 (활성화 상태 체크하지 않음)
                  if (effectItem.system?.effect?.attributes) {
                    for (const [attrName, attrValue] of Object.entries(effectItem.system.effect.attributes)) {
                      const aKey = (typeof attrValue === 'object' && attrValue.key) ? attrValue.key : attrName;
                      const aLabel = (typeof attrValue === 'object' && attrValue.label) ? attrValue.label : 
                                    (typeof attrName === 'string' && attrName.includes(':')) ? attrName.split(':')[1] : '';
                      if (!aKey) continue;
                      
                      // 판정 타입별 보너스 계산
                      if (rollType === 'major') {
                        // major 판정용
                        if (aKey === 'major_dice') {
                          const evalValue = (typeof attrValue === 'object' && 'value' in attrValue) 
                            ? (Number(attrValue.value) || 0) 
                            : (window.DX3rdFormulaEvaluator?.evaluate(attrValue, effectItem, actor) || 0);
                          effectDiceBonus += Number(evalValue) || 0;
                        } else if (aKey === 'major_add') {
                          const evalValue = (typeof attrValue === 'object' && 'value' in attrValue) 
                            ? (Number(attrValue.value) || 0) 
                            : (window.DX3rdFormulaEvaluator?.evaluate(attrValue, effectItem, actor) || 0);
                          effectAddBonus += Number(evalValue) || 0;
                        } else if (aKey === 'major_critical') {
                          const evalValue = (typeof attrValue === 'object' && 'value' in attrValue) 
                            ? (Number(attrValue.value) || 0) 
                            : (window.DX3rdFormulaEvaluator?.evaluate(attrValue, effectItem, actor) || 0);
                          effectCriticalMod += Number(evalValue) || 0;
                        } else if (aKey === 'dice') {
                          // 일반 dice 보너스
                          const evalValue = (typeof attrValue === 'object' && 'value' in attrValue) 
                            ? (Number(attrValue.value) || 0) 
                            : (window.DX3rdFormulaEvaluator?.evaluate(attrValue, effectItem, actor) || 0);
                          effectDiceBonus += Number(evalValue) || 0;
                        } else if (aKey === 'add') {
                          // 일반 add 보너스
                          const evalValue = (typeof attrValue === 'object' && 'value' in attrValue) 
                            ? (Number(attrValue.value) || 0) 
                            : (window.DX3rdFormulaEvaluator?.evaluate(attrValue, effectItem, actor) || 0);
                          effectAddBonus += Number(evalValue) || 0;
                        } else if (aKey === 'critical') {
                          // 일반 critical 보너스
                          const evalValue = (typeof attrValue === 'object' && 'value' in attrValue) 
                            ? (Number(attrValue.value) || 0) 
                            : (window.DX3rdFormulaEvaluator?.evaluate(attrValue, effectItem, actor) || 0);
                          effectCriticalMod += Number(evalValue) || 0;
                        }
                      } else if (rollType === 'reaction') {
                        // reaction 판정용
                        if (aKey === 'reaction_dice') {
                          const evalValue = (typeof attrValue === 'object' && 'value' in attrValue) 
                            ? (Number(attrValue.value) || 0) 
                            : (window.DX3rdFormulaEvaluator?.evaluate(attrValue, effectItem, actor) || 0);
                          effectDiceBonus += Number(evalValue) || 0;
                        } else if (aKey === 'reaction_add') {
                          const evalValue = (typeof attrValue === 'object' && 'value' in attrValue) 
                            ? (Number(attrValue.value) || 0) 
                            : (window.DX3rdFormulaEvaluator?.evaluate(attrValue, effectItem, actor) || 0);
                          effectAddBonus += Number(evalValue) || 0;
                        } else if (aKey === 'reaction_critical') {
                          const evalValue = (typeof attrValue === 'object' && 'value' in attrValue) 
                            ? (Number(attrValue.value) || 0) 
                            : (window.DX3rdFormulaEvaluator?.evaluate(attrValue, effectItem, actor) || 0);
                          effectCriticalMod += Number(evalValue) || 0;
                        } else if (aKey === 'dice') {
                          // 일반 dice 보너스
                          const evalValue = (typeof attrValue === 'object' && 'value' in attrValue) 
                            ? (Number(attrValue.value) || 0) 
                            : (window.DX3rdFormulaEvaluator?.evaluate(attrValue, effectItem, actor) || 0);
                          effectDiceBonus += Number(evalValue) || 0;
                        } else if (aKey === 'add') {
                          // 일반 add 보너스
                          const evalValue = (typeof attrValue === 'object' && 'value' in attrValue) 
                            ? (Number(attrValue.value) || 0) 
                            : (window.DX3rdFormulaEvaluator?.evaluate(attrValue, effectItem, actor) || 0);
                          effectAddBonus += Number(evalValue) || 0;
                        } else if (aKey === 'critical') {
                          // 일반 critical 보너스
                          const evalValue = (typeof attrValue === 'object' && 'value' in attrValue) 
                            ? (Number(attrValue.value) || 0) 
                            : (window.DX3rdFormulaEvaluator?.evaluate(attrValue, effectItem, actor) || 0);
                          effectCriticalMod += Number(evalValue) || 0;
                        }
                      } else if (rollType === 'dodge') {
                        // dodge 판정용 (reaction 보너스도 함께 적용)
                        if (aKey === 'reaction_dice' || aKey === 'dodge_dice') {
                          const evalValue = (typeof attrValue === 'object' && 'value' in attrValue) 
                            ? (Number(attrValue.value) || 0) 
                            : (window.DX3rdFormulaEvaluator?.evaluate(attrValue, effectItem, actor) || 0);
                          effectDiceBonus += Number(evalValue) || 0;
                        } else if (aKey === 'reaction_add' || aKey === 'dodge_add') {
                          const evalValue = (typeof attrValue === 'object' && 'value' in attrValue) 
                            ? (Number(attrValue.value) || 0) 
                            : (window.DX3rdFormulaEvaluator?.evaluate(attrValue, effectItem, actor) || 0);
                          effectAddBonus += Number(evalValue) || 0;
                        } else if (aKey === 'reaction_critical' || aKey === 'dodge_critical') {
                          const evalValue = (typeof attrValue === 'object' && 'value' in attrValue) 
                            ? (Number(attrValue.value) || 0) 
                            : (window.DX3rdFormulaEvaluator?.evaluate(attrValue, effectItem, actor) || 0);
                          effectCriticalMod += Number(evalValue) || 0;
                        } else if (aKey === 'dice') {
                          // 일반 dice 보너스
                          const evalValue = (typeof attrValue === 'object' && 'value' in attrValue) 
                            ? (Number(attrValue.value) || 0) 
                            : (window.DX3rdFormulaEvaluator?.evaluate(attrValue, effectItem, actor) || 0);
                          effectDiceBonus += Number(evalValue) || 0;
                        } else if (aKey === 'add') {
                          // 일반 add 보너스
                          const evalValue = (typeof attrValue === 'object' && 'value' in attrValue) 
                            ? (Number(attrValue.value) || 0) 
                            : (window.DX3rdFormulaEvaluator?.evaluate(attrValue, effectItem, actor) || 0);
                          effectAddBonus += Number(evalValue) || 0;
                        } else if (aKey === 'critical') {
                          // 일반 critical 보너스
                          const evalValue = (typeof attrValue === 'object' && 'value' in attrValue) 
                            ? (Number(attrValue.value) || 0) 
                            : (window.DX3rdFormulaEvaluator?.evaluate(attrValue, effectItem, actor) || 0);
                          effectCriticalMod += Number(evalValue) || 0;
                        }
                      }
                      
                      // 능력치/스킬 보너스는 모든 판정 타입에 적용
                      if (aKey === 'stat_dice' && aLabel) {
                        // 능력치/스킬 다이스 보너스
                        if (isAbility && aLabel === skillKey) {
                          const evalValue = (typeof attrValue === 'object' && 'value' in attrValue) 
                            ? (Number(attrValue.value) || 0) 
                            : (window.DX3rdFormulaEvaluator?.evaluate(attrValue, effectItem, actor) || 0);
                          effectDiceBonus += Number(evalValue) || 0;
                        } else if (!isAbility) {
                          // 스킬 사용 시: 스킬명, 스킬 그룹, 또는 base 능력치 매칭
                          const matchesDirect = aLabel === skillKey;
                          const matchesGroup = window.DX3rdSkillGroupMatcher?.isSkillInGroup(skillKey, aLabel);
                          const matchesBase = effectiveBaseKey && aLabel === effectiveBaseKey;
                          if (matchesDirect || matchesGroup || matchesBase) {
                            const evalValue = (typeof attrValue === 'object' && 'value' in attrValue) 
                              ? (Number(attrValue.value) || 0) 
                              : (window.DX3rdFormulaEvaluator?.evaluate(attrValue, effectItem, actor) || 0);
                            effectDiceBonus += Number(evalValue) || 0;
                          }
                        }
                      } else if (aKey === 'stat_add' && aLabel) {
                        // 능력치/스킬 수정치 보너스
                        if (isAbility && aLabel === skillKey) {
                          const evalValue = (typeof attrValue === 'object' && 'value' in attrValue) 
                            ? (Number(attrValue.value) || 0) 
                            : (window.DX3rdFormulaEvaluator?.evaluate(attrValue, effectItem, actor) || 0);
                          effectAddBonus += Number(evalValue) || 0;
                        } else if (!isAbility) {
                          const matchesDirect = aLabel === skillKey;
                          const matchesGroup = window.DX3rdSkillGroupMatcher?.isSkillInGroup(skillKey, aLabel);
                          const matchesBase = effectiveBaseKey && aLabel === effectiveBaseKey;
                          if (matchesDirect || matchesGroup || matchesBase) {
                            const evalValue = (typeof attrValue === 'object' && 'value' in attrValue) 
                              ? (Number(attrValue.value) || 0) 
                              : (window.DX3rdFormulaEvaluator?.evaluate(attrValue, effectItem, actor) || 0);
                            effectAddBonus += Number(evalValue) || 0;
                          }
                        }
                      } else if (aKey === 'critical_min') {
                        // 크리티컬 하한치: 가장 작은 값을 사용
                        const evalValue = (typeof attrValue === 'object' && 'value' in attrValue) 
                          ? (Number(attrValue.value) || 10) 
                          : (window.DX3rdFormulaEvaluator?.evaluate(attrValue, effectItem, actor) || 10);
                        const numValue = Number(evalValue) || 10;
                        if (numValue < effectCriticalMin) {
                          effectCriticalMin = numValue;
                        }
                      }
                      // stat_bonus, skill_bonus는 제외 (능력치/스킬 total 값에 영향을 주므로 dice/add 계산과는 별개)
                    }
                  }
                }
              }
            }
            
            // 크리티컬 하한치 최종 설정 (최소값 2로 제한)
            criticalMin = Math.max(2, effectCriticalMin);
            
            // 이펙트 보너스 적용
            dice += effectDiceBonus;
            add += effectAddBonus;
            critical = Math.max(criticalMin, critical + effectCriticalMod);
          }
          
          // 최종 설정
          data.system.dice = { value: dice };
          data.system.add = { value: add };
          data.system.critical = { value: critical, min: criticalMin };
        }
      }
    }

    // 공격력 계산 (실제 아이템 데이터에서 attackRoll 확인)
    const currentAttackRoll = item.system.attackRoll || data.system.attackRoll;
    if (currentAttackRoll && currentAttackRoll !== '-') {
      let totalAttack = 0;
      
      // 1. 액터의 기본 공격력 (공격 타입에 따라 구분)
      if (actor) {
        let actorAttack = actor.system.attributes.attack?.value || 0;
        // 공격 타입에 따라 melee 또는 ranged 보너스 추가
        if (currentAttackRoll === 'melee' && actor.system.attributes.attack?.melee) {
          actorAttack += actor.system.attributes.attack.melee;
        } else if (currentAttackRoll === 'ranged' && actor.system.attributes.attack?.ranged) {
          actorAttack += actor.system.attributes.attack.ranged;
        }
        totalAttack += actorAttack;
      }
      
      // 2. 등록된 무기들의 공격력 합계 (실제 아이템 데이터에서 weapon 확인)
      const registeredWeapons = item.system.weapon || data.system.weapon || [];
      let weaponAttackSum = 0;
      
      for (const weaponId of registeredWeapons) {
        if (weaponId && weaponId !== '-') {
          const weaponItem = actor?.items.get(weaponId);
          if (weaponItem) {
            const weaponAttack = Number(weaponItem.system?.attack) || 0;
            weaponAttackSum += weaponAttack;
          }
        }
      }
      
      totalAttack += weaponAttackSum;
      
      // 3. 콤보 아이템 자체의 attack 보너스 추가 (활성화되지 않은 경우만)
      const comboIsActive = item.system?.active?.state === true;
      if (!comboIsActive) {
        if (item.system?.attributes) {
          for (const [attrKey, attrData] of Object.entries(item.system.attributes)) {
            if (!attrData || !attrData.key || !attrData.value) continue;
            
            if (attrData.key === 'attack') {
              const attackLabel = attrData.label || '-';
              // label이 없거나 '-'이거나 현재 공격 타입과 일치하는 경우만 적용
              if (attackLabel === '-' || attackLabel === currentAttackRoll) {
                const bonusValue = window.DX3rdFormulaEvaluator?.evaluate(attrData.value, item, actor) || 0;
                totalAttack += Number(bonusValue) || 0;
              }
            }
          }
        }
        
        if (item.system?.effect?.attributes) {
          for (const [attrName, attrValue] of Object.entries(item.system.effect.attributes)) {
            const aKey = (typeof attrValue === 'object' && attrValue.key) ? attrValue.key : attrName;
            if (!aKey || aKey !== 'attack') continue;
            
            const aLabel = (typeof attrValue === 'object' && attrValue.label) ? attrValue.label : null;
            // label이 없거나 '-'이거나 현재 공격 타입과 일치하는 경우만 적용
            if (!aLabel || aLabel === '-' || aLabel === currentAttackRoll) {
              const evalValue = (typeof attrValue === 'object' && 'value' in attrValue) 
                ? (Number(attrValue.value) || 0) 
                : (window.DX3rdFormulaEvaluator?.evaluate(attrValue, item, actor) || 0);
              totalAttack += Number(evalValue) || 0;
            }
          }
        }
      }
      
      // 4. 이펙트 attributes의 attack 보너스 추가 (활성화되지 않은 것만)
      if (Array.isArray(data.system.effectIds)) {
        let effectAttackBonus = 0;
        
        for (const effectId of data.system.effectIds) {
          if (effectId && effectId !== '-') {
            const effectItem = actor?.items.get(effectId);
            if (effectItem && effectItem.type === 'effect') {
              // 활성화된 이펙트는 이미 액터의 prepareData에서 계산되었으므로 제외 (2중 계산 방지)
              const isActive = effectItem.system?.active?.state === true;
              if (isActive) continue;
              
              // 이펙트의 attributes 확인 (활성화되지 않은 것만 계산)
              if (effectItem.system?.attributes) {
                for (const [attrKey, attrData] of Object.entries(effectItem.system.attributes)) {
                  if (!attrData || !attrData.key || !attrData.value) continue;
                  
                  // attack 보너스 계산 (공격 타입 확인)
                  if (attrData.key === 'attack') {
                    const attackLabel = attrData.label || '-';
                    // label이 없거나 '-'이거나 현재 공격 타입과 일치하는 경우만 적용
                    if (attackLabel === '-' || attackLabel === currentAttackRoll) {
                      const bonusValue = window.DX3rdFormulaEvaluator?.evaluate(attrData.value, effectItem, actor) || 0;
                      effectAttackBonus += Number(bonusValue) || 0;
                    }
                  }
                  // stat_bonus, skill_bonus 등은 제외
                }
              }
              
              // effect.attributes도 확인 (활성화 상태 체크하지 않음)
              if (effectItem.system?.effect?.attributes) {
                for (const [attrName, attrValue] of Object.entries(effectItem.system.effect.attributes)) {
                  const aKey = (typeof attrValue === 'object' && attrValue.key) ? attrValue.key : attrName;
                  if (!aKey || aKey !== 'attack') continue;
                  
                  const aLabel = (typeof attrValue === 'object' && attrValue.label) ? attrValue.label : null;
                  // label이 없거나 '-'이거나 현재 공격 타입과 일치하는 경우만 적용
                  if (!aLabel || aLabel === '-' || aLabel === currentAttackRoll) {
                    const evalValue = (typeof attrValue === 'object' && 'value' in attrValue) 
                      ? (Number(attrValue.value) || 0) 
                      : (window.DX3rdFormulaEvaluator?.evaluate(attrValue, effectItem, actor) || 0);
                    effectAttackBonus += Number(evalValue) || 0;
                  }
                }
              }
            }
          }
        }
        
        totalAttack += effectAttackBonus;
      }
      
      // 최종 공격력 설정
      data.system.attack = { value: totalAttack };
      
      // 공격 타입에 따른 라벨 설정
      if (currentAttackRoll === 'melee') {
        data.attackLabel = game.i18n.localize('DX3rd.MeleeAttack');
      } else if (currentAttackRoll === 'ranged') {
        data.attackLabel = game.i18n.localize('DX3rd.RangedAttack');
      } else {
        data.attackLabel = game.i18n.localize('DX3rd.Attack');
      }
    } else {
      // system.attackRoll이 '-'이거나 설정되지 않은 경우
      data.system.attack = { value: '-' };
      data.attackLabel = game.i18n.localize('DX3rd.Attack');
    }

    // 무기 탭 데이터 준비 (WeaponTabManager 사용)
    data = window.DX3rdWeaponTabManager.prepareWeaponTabData(data, item);

    // attributes 초기화 (기존 데이터 보존)
    if (!data.system.attributes) data.system.attributes = {};
    if (item.system?.attributes) {
      data.system.attributes = { ...item.system.attributes };
    }

    // effect.attributes 초기화 (기존 데이터 보존)
    if (!data.system.effect.attributes) data.system.effect.attributes = {};
    if (item.system?.effect?.attributes) {
      data.system.effect.attributes = { ...item.system.effect.attributes };
    }

    // 액터 스킬 데이터 추가
    if (actor) {
      data.system.actorSkills = actor.system?.attributes?.skills || {};
      // 통합 스킬 선택 옵션 생성 (콤보용 - 신드롬 제외)
      // 에너미인 경우 능력치만 표시
      data.system.skillOptions = window.DX3rdSkillManager.getSkillSelectOptions('combo', data.system.actorSkills, actor.type);
    } else {
      data.system.actorSkills = {};
      data.system.skillOptions = [];
    }

    // Description 에디터를 위한 데이터 추가 (helpers.js 사용)
    data = await window.DX3rdDescriptionManager.enrichSheetData(data, item);

    // getTarget 체크박스 초기화
    if (data.system.getTarget === undefined) {
      data.system.getTarget = item.system.getTarget || false;
    }

    // scene 체크박스 초기화
    if (data.system.scene === undefined) {
      data.system.scene = item.system.scene || false;
    }

    // 액터 데이터를 템플릿에 전달
    data.actor = actor;

    return data;
  }

  window.DX3rdComboData = {prepareSheetData};
})();
