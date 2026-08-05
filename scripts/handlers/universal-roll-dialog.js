// Universal handler - 롤 & 판정 다이얼로그 클러스터
// universal-handler.js 에서 분리. 반드시 그 파일 뒤에 로드되어 동일 객체에 믹스인된다.
// (executeAttackRoll / _getSortedSkillOptions / openComboBuilder /
//  showStatRollConfirmDialog / showStatRollDialog / executeStatRoll)
(function() {
  if (!window.DX3rdUniversalHandler) {
    console.error('DX3rd | universal-roll-dialog.js loaded before universal-handler.js; roll methods unavailable.');
    return;
  }

  Object.assign(window.DX3rdUniversalHandler, {
    /**
     * Midi-QOL 병합 카드처럼 아이콘/요약 헤더 아래에 판정 결과를 누적하고,
     * 실행 버튼은 결과와 분리된 좁은 액션 행에 두는 DX3rd 공격 카드.
     */
    renderAttackChatCard({actor, item, flavorText = '', rollHtml = '', actionContent = ''}) {
      const escapeHTML = value => window.DX3rdRuntimeUtils?.escapeHTML?.(String(value ?? ''))
        ?? foundry.utils.escapeHTML(String(value ?? ''));
      const itemName = String(item?.name || game.i18n.localize('DX3rd.AttackRoll')).split('||')[0].trim();
      const image = item?.img || actor?.img || 'icons/svg/sword.svg';
      return `
        <article class="dx3rd-item-chat dx3rd-attack-card">
          <header class="dx3rd-attack-card__header">
            <img src="${escapeHTML(image)}" alt="${escapeHTML(itemName)}">
            <div class="dx3rd-attack-card__heading">
              <h3>${escapeHTML(itemName)}</h3>
              <span>${game.i18n.localize('DX3rd.AttackRoll')}</span>
            </div>
          </header>
          <section class="dx3rd-attack-card__body">
            ${flavorText ? `<div class="dx3rd-attack-card__summary">${flavorText}</div>` : ''}
            ${rollHtml ? `<div class="dx3rd-roll-label">${game.i18n.localize('DX3rd.AttackRoll')}</div><div class="dx3rd-attack-card__roll">${rollHtml}</div>` : ''}
          </section>
          <footer class="damage-roll-message dx3rd-attack-card__actions">
            <div class="dx3rd-card-buttons">${actionContent}</div>
          </footer>
        </article>`;
    },

    renderAttackRollButton(actor, item, {repeatable = false} = {}) {
      return `<button class="attack-roll-btn"
                      data-item-id="${item?.id || ''}"
                      data-repeatable="${repeatable ? 'true' : 'false'}">
                ${game.i18n.localize('DX3rd.HitRoll')}
              </button>`;
    },

    async createPendingAttackCard(actor, item) {
      const cleanItemName = String(item?.name || '').split('||')[0].trim();
      const content = this.renderAttackChatCard({
        actor,
        item,
        flavorText: `<p>${cleanItemName}</p>`,
        actionContent: this.renderAttackRollButton(actor, item)
      });
      return ChatMessage.create({
        speaker: ChatMessage.getSpeaker({actor}),
        content,
        flags: {'dx3rd-emanim': {pendingAttackRoll: true}}
      });
    },

    /**
     * 판정 롤에 항으로 실을 다이스식을 검증한다.
     * 굴리지 않고 문자열째 넘기므로, 잘못된 수식은 판정 롤 전체를 깨뜨린다.
     * 굴려서 숫자로 접던 시절엔 try/catch 가 흡수하던 자리라 검증을 여기로 옮겼다.
     * @param {string} formula - 검사할 수식 (빈 값이면 그대로 '')
     * @param {string} kind - 로그용 필드 이름
     * @returns {string} 유효하면 원문, 아니면 '' (해당 항을 버린다)
     */
    validateRollTerm(formula, kind) {
      if (!formula) return '';
      if (Roll.validate(formula)) return formula;
      console.warn(`DX3rd | invalid roll term (${kind}): ${formula}`);
      ui.notifications.warn(`${game.i18n.localize('DX3rd.DamageRollFormulaInvalid')}: ${formula}`);
      return '';
    },

    /**
     * 공격 롤 실행 (무기/비클/이펙트/콤보/사이오닉 등)
     * @param {Actor} actor - 공격하는 액터
     * @param {Item} item - 공격 아이템
     * @param {string} skillName - 스킬 이름
     * @param {Token} previousToken - 이전에 선택된 토큰
     * @param {number} dice - 주사위 개수
     * @param {number} critical - 크리티컬 값
     * @param {number} add - 가산치
     * @param {string} rollType - 'major' | 'reaction' | 'dodge' (판정 타입별 행동 수식 선택용)
     */
    async executeAttackRoll(actor, item, skillName, previousToken, dice, critical, add, weaponBonus = null, statRollFormula = null, rollType = 'major', sourceMessage = null) {
      try {
        // 대상 확인 (다시 가져오기)
        const targets = Array.from(game.user.targets);

        // 참조값은 명중 판정 시점으로 고정하되, 다이스식은 데미지 굴림 확정까지 보류한다.
        // 이렇게 하면 공격 카드가 아직 공개하지 않은 데미지 결과를 품지 않는다.
        const itemAttackFormula = window.DX3rdFormulaEvaluator.prepareRollFormula(item.system.attack, item, actor);

        // 공격 타입/액터 보너스 산출 (데미지 굴림 시점과 동일 경로)
        // 관통 다이스식은 명중 판정인 지금 굴려 숫자로 굳힌다(방어 창은 그 숫자만 받는다).
        const bonuses = await this.resolveAttackBonusesRolled(actor, item);

        const preservedValues = {
          actorAttack: bonuses.actorAttack,
          actorAttackFormula: bonuses.actorAttackFormula,
          actorDamageRoll: bonuses.actorDamageRoll,
          actorDamageRollFormula: bonuses.actorDamageRollFormula,
          actorPenetrate: bonuses.actorPenetrate,
          weaponAttackFormula: itemAttackFormula
        };

      
        // 공포 패널티는 이미 다이얼로그에서 반영되었으므로 여기서는 적용하지 않음
        // 룰(rule-section:39-41): 수정 결과 판정치가 0 이하면 판정은 자동실패(달성치 0).
        // 실제 애니메이션을 위해 최소 1다이스는 굴리되, 결과는 아래에서 0으로 확정한다.
        // 행동 시점 판정 수식: prepareData에서 원문만 보존하고, 여기서 정확히 한 번 굴린다.
        const actionProfile = actor.system.attributes.actionRollFormula || {};
        const typedProfile = actionProfile[rollType] || {};
        const buildActionFormula = (kind) =>
          [actionProfile[kind], typedProfile[kind], statRollFormula?.[kind]].filter(Boolean).join(' + ');
        const rollActionFormula = async (kind) => {
          const formula = buildActionFormula(kind);
          if (!formula) return { total: 0, text: '' };
          try {
            const result = await (new Roll(formula)).evaluate();
            return { total: Number(result.total) || 0, text: `${kind}: ${formula} → ${result.total}` };
          } catch (error) {
            console.warn(`DX3rd | action roll formula failed (${kind}): ${formula}`, error);
            ui.notifications.warn(`${game.i18n.localize('DX3rd.DamageRollFormulaInvalid')}: ${formula}`);
            return { total: 0, text: `${kind}: ${formula} → 0` };
          }
        };
        // 다이스 개수/크리티컬은 판정식을 조립하기 전에 값이 확정돼야 하므로 여기서 굴린다.
        // 수정치(add)는 굴리지 않는다 — 아래 판정 롤의 항으로 그대로 실어야
        // 채팅 카드가 "10dx7 + 10d10"처럼 다이스식 그대로 보인다.
        const [formulaDice, formulaCritical] = await Promise.all([
          rollActionFormula('dice'), rollActionFormula('critical')
        ]);
        const addDiceFormula = this.validateRollTerm(buildActionFormula('add'), 'add');
        const rolledDice = dice + formulaDice.total;
        const rolledCritical = critical + formulaCritical.total;
        // 채팅 카드에는 최종 DX3rd 판정식만 표시한다. 보조 수식의 전개값은
        // 판정 풀에 이미 반영되므로 별도 줄로 중복 표기하지 않는다.
        const autoFailByPool = rolledDice <= 0;
        const finalDice = Math.max(1, rolledDice);

        // 달성치 D10 굴림(달성치에 +[N]D10 모델): 판정 롤에 항으로 실어 카드에서 함께 공개한다.
        const add2 = add;
        const dxRollN = Number(actor.system.attributes.dxroll?.value || 0);
        const dxRollFormula = this.validateRollTerm(
          actor.system.attributes.dxroll?.formula || (dxRollN > 0 ? `${dxRollN}d10` : ''), 'dxroll');
        // 무기 명중 수정치의 다이스는 판정 버튼을 누른 지금 한 번만 같은 Roll에 포함한다.
        // 결과는 사전 다이얼로그가 아니라 명중 롤 카드의 Foundry 항별 결과로 공개된다.
        const weaponAddFormula = weaponBonus?.addFormula;
        const rollFormula = [`${finalDice}dx${Math.max(2, rolledCritical)}`, String(add2),
          addDiceFormula, dxRollFormula, weaponAddFormula].filter(Boolean).join(' + ');
        const roll = await (new Roll(rollFormula)).roll();
        const rollHtml = await roll.render();

        // 룰: 판정 다이스가 전부 1이면 펌블 → 자동실패, 달성치 0.
        // dx 다이스텀이 fumble 플래그를 세우면 기능레벨/수정치(add2)까지 무시하고 0으로 확정한다.
        // 룰(rule-section:39-41): 판정치 0 이하도 동일하게 달성치 0으로 자동실패.
        const isFumble = roll.terms.some(t => t?.fumble === true);
        const rollResult = (autoFailByPool || isFumble) ? 0 : roll.total;

        // 공격 굴림 메시지 출력 (루비 텍스트 제거)
        const cleanItemName = item.name.split('||')[0].trim();
        let flavorText = `${cleanItemName} - ${skillName} (${game.i18n.localize('DX3rd.AttackRoll')})`;
        if (autoFailByPool) {
          flavorText += `\n${game.i18n.localize('DX3rd.PoolZero')} — ${game.i18n.localize('DX3rd.TestFailure')}`;
        } else if (isFumble) {
          flavorText += `\n${game.i18n.localize('DX3rd.Fumble')} — ${game.i18n.localize('DX3rd.TestFailure')}`;
        }

        // 대상 정보 추가
        if (targets.length > 0) {
          const targetDisplayNames = [];

          for (const target of targets) {
            const targetActor = target.actor;
            const targetName = targetActor?.name || target.name;
            if (!targetName) continue;
            
            // 대상이 에너미이고 이베이전이 활성화되어 있는 경우 확인
            if (targetActor && targetActor.type === 'enemy') {
              const evasionDisabled = targetActor.system?.attributes?.evasion?.disabled;
              const evasionValue = targetActor.system?.attributes?.evasion?.value;
              
              if (evasionDisabled === false && evasionValue !== undefined && evasionValue !== null) {
                const evasionNum = Number(evasionValue) || 0;
                const isHit = rollResult > evasionNum;
                const resultText = isHit 
                  ? `${game.i18n.localize('DX3rd.Hit')}: ${game.i18n.localize('DX3rd.Evasion')} ${evasionNum}`
                  : `${game.i18n.localize('DX3rd.Failure')}: ${game.i18n.localize('DX3rd.Evasion')} ${evasionNum}`;
                targetDisplayNames.push(`${targetName}(${resultText})`);
              } else {
                targetDisplayNames.push(targetName);
              }
            } else {
              targetDisplayNames.push(targetName);
            }
          }
          
          if (targetDisplayNames.length > 0) {
            flavorText += `\n· ${game.i18n.localize('DX3rd.Target')}: ${targetDisplayNames.join(', ')}`;
          }
        }
        
        // 데미지 롤 버튼 생성
        let damageRollButtonContent = `<button class="damage-roll-btn"
                    data-actor-id="${actor.id}"
                    data-item-id="${item.id}"
                    data-roll-result="${rollResult}"
                    data-preserved-actor-attack="${preservedValues.actorAttack}"
                    data-preserved-actor-attack-formula="${encodeURIComponent(preservedValues.actorAttackFormula || '')}"
                    data-preserved-actor-damage-roll="${preservedValues.actorDamageRoll}"
                    data-preserved-actor-damage-roll-formula="${encodeURIComponent(preservedValues.actorDamageRollFormula || '')}"
                    data-preserved-actor-penetrate="${preservedValues.actorPenetrate}"`;
        
        // 아이템 타입별 공격력 데이터 속성 추가
        if (item.type === 'weapon') {
          damageRollButtonContent += `\n                    data-preserved-attack-formula="${encodeURIComponent(preservedValues.weaponAttackFormula)}"`;
          damageRollButtonContent += `\n                    data-weapon-ids="${item.id}"`; // 무기 자신의 ID 추가
        } else if (item.type === 'vehicle') {
          damageRollButtonContent += `\n                    data-preserved-attack-formula="${encodeURIComponent(preservedValues.weaponAttackFormula)}"`;
        } else {
          damageRollButtonContent += `\n                    data-preserved-attack-formula="${encodeURIComponent(preservedValues.weaponAttackFormula)}"`;
        }
        
        damageRollButtonContent += `>
                ${game.i18n.localize('DX3rd.DamageRoll')}
            </button>`;
        
        // 공격 메시지, 대상 정보, 롤 결과, 데미지 롤 버튼을 하나의 메시지로 묶기 (콤보와 동일하게 rollHtml 명시 포함)
        const attackMessageContent = this.renderAttackChatCard({
          actor,
          item,
          flavorText: `<p>${flavorText.replace(/\n/g, '<br>')}</p>`,
          rollHtml,
          actionContent: `${this.renderAttackRollButton(actor, item, {repeatable: true})}${damageRollButtonContent}`
        });
        
        let attackMessage;
        if (sourceMessage) {
          await sourceMessage.update({
            content: attackMessageContent,
            rolls: [roll.toJSON()],
            'flags.dx3rd-emanim.pendingAttackRoll': false,
            'flags.dx3rd-emanim.attackRollCompleted': false
          });
          attackMessage = sourceMessage;
        } else {
          attackMessage = await ChatMessage.create({
            speaker: ChatMessage.getSpeaker({ actor: actor }),
            content: attackMessageContent,
            rolls: [roll]
          });
        }

        // 메이저 롤 후 비활성화 훅 실행 (자기 자신에게만)
        if (window.DX3rdDisableHooks) {
          await window.DX3rdDisableHooks.executeDisableHook('roll', actor);
          await window.DX3rdDisableHooks.executeDisableHook('major', actor);
        }

        // 명중판정 완료 공통 후처리 (증오 자동 회복 + 확장 훅)
        await this.onAttackRollComplete(actor, item, targets, rollResult, isFumble);

        await this.maybeAutoRollDamage?.(attackMessage);

        // 이전 토큰 복원
        if (previousToken && canvas.tokens) {
          previousToken.control({ releaseOthers: true });
        }

        return true;
      } catch (e) {
        console.error('DX3rd | Weapon attack roll failed', e);
        ui.notifications.error('공격 굴림 중 오류가 발생했습니다.');
        // 오류 시에도 토큰 복원
        if (previousToken && canvas.tokens) {
          previousToken.control({ releaseOthers: true });
        }
        return false;
      }
    },

    /**
     * 능력치/스킬 판정 다이얼로그 표시 (Yes/No 다이얼로그)
     * @param {Actor} actor - 액터
     * @param {string} targetType - 'ability' 또는 'skill'
     * @param {string} targetId - 능력치/스킬 ID
     * @param {Function} openComboBuilderCallback - 콤보 빌더 콜백
     */
    /**
     * 정렬된 스킬 옵션 가져오기 (actor-sheet.js의 _getSortedSkillOptions와 동일)
     */
    _getSortedSkillOptions(actor) {
      const skills = actor.system?.attributes?.skills || {};
      const sortedOptions = [];
      
      // 능력치별 기본 스킬 순서
      const skillOrder = {
        body: ['melee', 'evade'],
        sense: ['ranged', 'perception'],
        mind: ['rc', 'will', 'cthulhu'],
        social: ['negotiation', 'procure']
      };
      
      const attributes = ['body', 'sense', 'mind', 'social'];
      
      for (const attr of attributes) {
        // 능력치 자체 추가
        sortedOptions.push({
          value: attr,
          label: game.i18n.localize(`DX3rd.${attr.charAt(0).toUpperCase() + attr.slice(1)}`),
          isAbility: true
        });
        
        // 해당 능력치의 기본 스킬들
        const defaultSkills = skillOrder[attr] || [];
        for (const skillKey of defaultSkills) {
          const skill = skills[skillKey];
          if (skill && skill.base === attr) {
            let skillName = skill.name;
            if (skillName && skillName.startsWith('DX3rd.')) {
              skillName = game.i18n.localize(skillName);
            }
            sortedOptions.push({
              value: skillKey,
              label: skillName,
              isAbility: false
            });
          }
        }
        
        // 해당 능력치의 커스텀 스킬들
        for (const [skillKey, skill] of Object.entries(skills)) {
          if (skill.base === attr && !defaultSkills.includes(skillKey)) {
            let skillName = skill.name;
            if (skillName && skillName.startsWith('DX3rd.')) {
              skillName = game.i18n.localize(skillName);
            }
            sortedOptions.push({
              value: skillKey,
              label: skillName,
              isAbility: false
            });
          }
        }
      }
      
      return sortedOptions;
    },
    
    /**
     * 콤보 빌더 열기 (액터 시트 없이도 가능)
     * @param {Actor} actor - 액터
     * @param {string} targetType - 'ability' 또는 'skill'
     * @param {string} targetId - 능력치/스킬 ID
     * @param {Item} weaponItem - 무기 아이템 (선택적, attackRoll 초기값 설정용)
     * @param {Object} options - 추가 옵션 (선택사항)
     *   - {boolean} isBookDecipher: 마도서 해독 콤보 여부
     *   - {Item} originalItem: 원본 아이템 (예: 마도서)
     *   - {Object} predefinedDifficulty: 미리 정의된 난이도 데이터
     *   - {string} rollType: 판정 종류 강제 시드('dodge'/'reaction'). 방어 다이얼로그 등 호출 문맥이
     *     이미 판정 종류를 알고 있을 때 쓴다. 지정하면 공격 판정은 붙이지 않는다.
     *   - {boolean} getTarget: 대상 지정 필요 여부(기본 true). 리액션 콤보는 false.
     *   - {Function} afterRollCallback: 판정 완료 콜백(임시 콤보 문서의 meta로 전달)
     *   - {Function} afterUseCallback: 사용(발동) 직후 콜백(임시 콤보 문서의 meta로 전달)
     */
    // 콤보 빌더: 편집 가능한 임시 콤보 문서를 만들고 그 시트를 연다.
    // 사용/취소 시 문서는 자동 삭제되고, 저장 버튼을 누른 경우에만 영구 콤보로 남는다.
    // 무기에서 시작하면 공격 콤보로 자동 시드(공격판정=무기 type, 기능=무기 공격기능).
    async openComboBuilder(actor, targetType, targetId, weaponItem = null, options = {}) {
      const comboData = window.DX3rdComboData;
      const abilityKeys = ['body', 'sense', 'mind', 'social'];

      // 이펙트/장비에서 콤보를 시작한 경우 미리 선택할 이펙트 ID 목록
      const preselectIds = Array.isArray(options.preselectEffectIds)
        ? options.preselectEffectIds.filter(Boolean)
        : [];

      // 판정 종류를 호출 문맥이 지정한 경우(리액션 창의 임시 콤보 등). 방어 판정에는 공격 판정이
      // 붙을 수 없으므로 무기 시드도 통째로 건너뛴다.
      const forcedRoll = ['major', 'reaction', 'dodge', '-'].includes(options.rollType)
        ? options.rollType : null;
      const isDefenseSeed = forcedRoll === 'reaction' || forcedRoll === 'dodge';

      // 무기/비클 아이템만 무기 슬롯·공격 콤보 시드로 사용(연출용으로 넘어온 비무기 아이템은 무시)
      const seedWeapon = (!isDefenseSeed && weaponItem && (weaponItem.type === 'weapon' || weaponItem.type === 'vehicle'))
        ? weaponItem : null;

      // ---- 시드 값 계산(조합 우선순위: 이펙트 명시기능 > 무기 명시기능 > 무기 type 유추) ----
      // 콤보 생성 후 시트에서의 추가/삭제는 DX3rdComboData.deriveComboAttackFields가 같은 우선순위로 재계산한다.
      let skill = (targetType === 'skill' && targetId && targetId !== '-') ? targetId : '-';
      let base = '-';
      let attackRoll = '-';
      const weaponSetting = [];
      if (seedWeapon) weaponSetting.push(seedWeapon.id);

      const seedEffects = preselectIds.map(id => actor.items.get(id)).filter(Boolean);
      const seedWeaponType = seedWeapon?.system?.type;

      // 공격판정: 이펙트 attackRoll(melee/ranged) > 무기 type. (방어 시드는 공격 판정 없음)
      const effAR = isDefenseSeed
        ? null
        : seedEffects.find(e => e.system?.attackRoll === 'melee' || e.system?.attackRoll === 'ranged');
      if (effAR) attackRoll = effAR.system.attackRoll;
      else if (!isDefenseSeed && (seedWeaponType === 'melee' || seedWeaponType === 'ranged')) attackRoll = seedWeaponType;

      // 기능: 이펙트 지정 기능 > 무기 명시 > 무기 type 유추. (스킬에서 시작한 값은 조합 신호가 있으면 그쪽이 이김)
      //   이펙트 지정 기능 = 조합시 기능 변경(comboSkill) 우선, 없으면 이펙트 기능 항목(skill) 폴백. (룰 근거는 combo-data.js 참조)
      const effComboSkill = seedEffects.find(e => e.system?.comboSkill && e.system.comboSkill !== '-');
      // skill='syndrome'(컨센트레이트/리플렉스 등)은 판정 기능이 아니라 순수 수정치 센티넬이므로 기능 소스에서 제외.
      const effOwnSkill = seedEffects.find(e => e.system?.skill && e.system.skill !== '-' && e.system.skill !== 'syndrome');
      if (effComboSkill) {
        skill = effComboSkill.system.comboSkill;  // base는 아래에서 스킬 기준으로 유추
      } else if (effOwnSkill) {
        skill = effOwnSkill.system.skill;
        if (effOwnSkill.system?.base && effOwnSkill.system.base !== '-') base = effOwnSkill.system.base;
      } else if (seedWeapon?.system?.skill && seedWeapon.system.skill !== '-') {
        skill = seedWeapon.system.skill;
      } else if (seedWeaponType === 'ranged') {
        skill = 'ranged';
      } else if (seedWeaponType === 'melee') {
        skill = 'melee';
      }

      // 기능이 정해졌는데 base가 비어있으면 스킬의 base 능력치로 채움
      if (base === '-' && skill !== '-') {
        base = abilityKeys.includes(skill) ? skill : (actor.system?.attributes?.skills?.[skill]?.base || '-');
      }

      // 조합시 능력치 변경(comboBase): 기능 유지하고 판정 능력치만 교체(룰 근거는 combo-data.js 참조)
      const effComboBase = seedEffects.find(e => abilityKeys.includes(e.system?.comboBase));
      if (effComboBase) base = effComboBase.system.comboBase;

      // 조합 이펙트의 침식치/사거리/대상 합성(가장 제한적인 값).
      const effectIds = [...preselectIds];
      const encroachValue = comboData?.calculateEncroachment?.(actor, effectIds) ?? '0';
      const RT = window.DX3rdRangeTarget;
      const rangeCombo = RT ? RT.combineRange(effectIds.map(id => actor.items.get(id)?.system?.range)) : null;
      const targetCombo = RT ? RT.combineTarget(effectIds.map(id => actor.items.get(id)?.system?.target)) : null;
      const rangeValue = rangeCombo?.resolved ? rangeCombo.value : '-';
      const targetValue = targetCombo?.resolved ? targetCombo.value : '-';

      // 공격판정이 있는데 무기가 고정되지 않았으면 사용 시 무기 선택 다이얼로그를 띄운다.
      const weaponSelect = attackRoll !== '-' && weaponSetting.length === 0;
      // 무기가 고정된 경우 공격력 선계산.
      const attackValue = attackRoll !== '-'
        ? (comboData?.calculateSubmittedAttack?.(actor, attackRoll, weaponSetting) ?? 0)
        : 0;

      const comboItemData = {
        name: `[${game.i18n.localize('DX3rd.Combo')}]`,
        type: 'combo',
        flags: {'dx3rd-emanim': {instantCombo: true}},
        system: {
          skill,
          base,
          // 기능 또는 공격판정이 있으면 명중/판정을 위해 메이저로 시작.
          // 호출 문맥이 판정 종류를 지정했으면(리액션/닷지) 그 값이 이긴다.
          roll: forcedRoll || ((skill !== '-' || attackRoll !== '-') ? 'major' : '-'),
          attackRoll,
          effectIds,
          weapon: weaponSetting,
          weaponSelect,
          getTarget: options.getTarget !== false,
          range: rangeValue,
          target: targetValue,
          encroach: { value: encroachValue },
          attack: { value: attackValue },
          level: { value: 1 }
        }
      };

      try {
        const [created] = await actor.createEmbeddedDocuments('Item', [comboItemData]);
        // 마도서/방어 다이얼로그 등 호출 문맥이 제공한 일회성 판정 문맥은 임시 콤보가 살아 있는
        // 동안 보존한다(문서에 직접 붙는 메모리 전용 필드 — 저장되지 않는다).
        const hasMeta = options.originalItem || options.predefinedDifficulty || options.isBookDecipher
          || options.afterRollCallback || options.afterUseCallback;
        if (created && hasMeta) {
          created.meta = {
            originalItem: options.originalItem || null,
            predefinedDifficulty: options.predefinedDifficulty || null,
            isBookDecipher: !!options.isBookDecipher,
            afterRollCallback: typeof options.afterRollCallback === 'function' ? options.afterRollCallback : null,
            afterUseCallback: typeof options.afterUseCallback === 'function' ? options.afterUseCallback : null
          };
        }
        // 자신 대상 이펙트를 비자신과 섞은 경우 경고(진행은 허용).
        if (targetCombo?.selfConflict) {
          ui.notifications.warn(game.i18n.localize('DX3rd.SelfCombineWarning'));
        }
        // 이름/세부 조정과 즉석 사용을 위해 방금 만든 콤보 시트를 연다.
        created?.sheet?.render(true);
        return created;
      } catch (e) {
        console.error('DX3rd | openComboBuilder - create failed:', e);
        ui.notifications.error(`${game.i18n.localize('DX3rd.Combo')}: ${e?.message || e}`);
        return null;
      }
    },
    
    async showStatRollConfirmDialog(actor, targetType, targetId, openComboBuilderCallback, specificRollType = null, menuAnchor = null) {
      // 권한 체크
      if (!actor.isOwner && !game.user.isGM) {
        ui.notifications.warn('이 액터에 대한 권한이 없습니다.');
        return;
      }

      const stat = targetType === 'ability' 
        ? actor.system.attributes[targetId]
        : actor.system.attributes.skills[targetId];
      
      if (!stat) return;
      
      let label = '';
      if (targetType === 'ability') {
        label = game.i18n.localize(`DX3rd.${targetId.charAt(0).toUpperCase() + targetId.slice(1)}`);
      } else {
        label = stat.name;
        if (label && label.startsWith('DX3rd.')) label = game.i18n.localize(label);
      }
      
      const openCombo = async () => {
        if (openComboBuilderCallback) {
          return openComboBuilderCallback(targetType, targetId);
        }
        // 콜백이 없으면 직접 openComboBuilder 호출
        return this.openComboBuilder(actor, targetType, targetId);
      };
      const rollDirectly = () => this.showStatRollDialog(actor, stat, label, specificRollType);

      if (typeof window.DX3rdChooseRollMode !== 'function') {
        ui.notifications.error(game.i18n.localize('DX3rd.DialogV2Unavailable'));
        return;
      }
      const useCombo = await window.DX3rdChooseRollMode(menuAnchor ?? undefined);

      if (useCombo === true) return openCombo();
      if (useCombo === false) return rollDirectly();
    },

    /**
     * 능력치/스킬 판정 다이얼로그 표시 (Major/Reaction/Dodge 선택)
     * @param {Actor} actor - 액터
     * @param {Object} stat - 능력치/스킬 데이터
     * @param {string} label - 표시할 레이블
     * @param {string} specificRollType - 특정 롤 타입만 표시 (선택사항: 'major'|'reaction'|'dodge')
     * @param {Item} item - 아이템 (선택사항)
     * @param {Token} previousToken - 이전에 선택된 토큰 (무기 공격용, 선택사항)
     * @param {Object} weaponBonus - 무기 보너스 (선택사항)
     * @param {Object} comboAfterSuccessData - 콤보 afterSuccess 데이터 (선택사항)
     * @param {Object} comboAfterDamageData - 콤보 afterDamage 데이터 (선택사항)
     * @param {Object} predefinedDifficulty - 미리 정의된 난이도 (선택사항, Book 등에서 사용)
     */
    async showStatRollDialog(actor, stat, label, specificRollType = null, item = null, previousToken = null, weaponBonus = null, comboAfterSuccessData = null, comboAfterDamageData = null, predefinedDifficulty = null, requireDifficulty = false, isUrgeTest = false, afterRollCallback = null, isPanicTest = false, sourceMessage = null) {
      const defaultCritical = game.settings.get("dx3rd-emanim", "defaultCritical") || 10;
      
      // stat은 얕은 복사 시 major/reaction/dodge가 원본과 공유되어 패널티 누적 발생 → deepClone 사용
      let effectiveStat = foundry.utils.deepClone(stat);
      
      // 공포 판정인 경우 주사위 값을 encroachment.dice만큼 빼기
      // 룰(rule-section:39-41): 수정 결과 판정치가 0 이하면 자동실패. 여기서 하한을 두지 않고
      // 원값(음수 가능)을 그대로 전파해 롤 실행부에서 0 이하 자동실패를 판정한다.
      if (isPanicTest) {
        const encroachmentDice = Number(actor.system?.attributes?.encroachment?.dice) || 0;
        if (effectiveStat.dice !== undefined) {
          effectiveStat.dice = (effectiveStat.dice || 0) - encroachmentDice;
        }
        // major, reaction, dodge 각각에도 적용
        if (effectiveStat.major && effectiveStat.major.dice !== undefined) {
          effectiveStat.major.dice = (effectiveStat.major.dice || 0) - encroachmentDice;
        }
        if (effectiveStat.reaction && effectiveStat.reaction.dice !== undefined) {
          effectiveStat.reaction.dice = (effectiveStat.reaction.dice || 0) - encroachmentDice;
        }
        if (effectiveStat.dodge && effectiveStat.dodge.dice !== undefined) {
          effectiveStat.dodge.dice = (effectiveStat.dodge.dice || 0) - encroachmentDice;
        }
      }
      
      // 공포 효과 의존 패널티 적용 (dice -4, 최소값 1 보장)
      const panic8Applied = window.DX3rdAppliedEffects?.getEffect(actor, 'Panic8') || actor.system?.attributes?.applied?.Panic8;
      if (panic8Applied) {
        // 액터의 토큰 찾기
        const actorToken = canvas.tokens.placeables.find(t => t.actor?.id === actor.id);
        if (actorToken) {
          // 로이스 아이템 이름 목록 가져오기
          const roisItems = actor.items.filter(item => item.type === 'rois');
          const roisNames = roisItems.map(item => {
            // 아이템 이름에서 ||RubyText 제거
            let itemName = item.name;
            const rubyPattern = /^(.+)\|\|(.+)$/;
            const match = itemName.match(rubyPattern);
            if (match) {
              itemName = match[1];
            }
            return itemName.trim();
          }).filter(name => name); // 빈 문자열 제거
          
          if (roisNames.length > 0) {
            // 인게이지 범위 계산 (토큰 크기의 절반 올림)
            const tokenSize = Math.max(actorToken.document.width, actorToken.document.height);
            const engageRange = Math.ceil(tokenSize / 2);
            
            // 인게이지 범위 내 그리드 가져오기
            const engageGrids = this.getGridsInRange(actorToken, engageRange);
            
            // 인게이지 범위 내에 로이스 아이템 이름과 일치하는 토큰 액터가 있는지 확인
            let hasMatchingRoisToken = false;
            for (const grid of engageGrids) {
              const tokenAtGrid = this.getTokenAtGrid(grid, actorToken);
              if (tokenAtGrid && tokenAtGrid.actor) {
                const tokenActorName = tokenAtGrid.actor.name || '';
                // 로이스 아이템 이름과 일치하는지 확인
                if (roisNames.some(roisName => tokenActorName === roisName)) {
                  hasMatchingRoisToken = true;
                  break;
                }
              }
            }
            
            // 일치하는 토큰이 없으면 dice 패널티 -4 적용
            // 룰(rule-section:39-41): 하한을 두지 않고 원값(음수 가능)을 전파 → 롤 실행부에서 0 이하 자동실패 판정
            if (!hasMatchingRoisToken) {
              if (effectiveStat.dice !== undefined) {
                effectiveStat.dice = (effectiveStat.dice || 0) - 4;
              }
              if (effectiveStat.major && effectiveStat.major.dice !== undefined) {
                effectiveStat.major.dice = (effectiveStat.major.dice || 0) - 4;
              }
              if (effectiveStat.reaction && effectiveStat.reaction.dice !== undefined) {
                effectiveStat.reaction.dice = (effectiveStat.reaction.dice || 0) - 4;
              }
              if (effectiveStat.dodge && effectiveStat.dodge.dice !== undefined) {
                effectiveStat.dodge.dice = (effectiveStat.dodge.dice || 0) - 4;
              }
            }
          }
        }
      }
      
      // Madness 2 (편집증): 인접한 그리드에 로이스와 일치하지 않는 다른 토큰이 있으면 메이저 다이스 -2
      const madnessTypePrefix = game.i18n.localize('DX3rd.MadnessType');
      const madness2Name = madnessTypePrefix + ': ' + game.i18n.localize('DX3rd.Madness2');
      const hasMadness2 = actor.items.some(item => 
        item.type === 'effect' && 
        item.name === madness2Name
      );
      
      let paranoiaPenalty = 0;
      if (hasMadness2) {
        const actorToken = canvas.tokens.placeables.find(t => t.actor?.id === actor.id);
        if (actorToken) {
          const roisItems = actor.items.filter(item => item.type === 'rois');
          const roisNames = roisItems.map(item => {
            let itemName = item.name;
            const rubyPattern = /^(.+)\|\|(.+)$/;
            const match = itemName.match(rubyPattern);
            if (match) {
              itemName = match[1];
            }
            return itemName.trim();
          }).filter(name => name);
          
          const adjacentGrids = this.getAdjacentGrids(actorToken);
          let hasNonRoisAdjacent = false;
          for (const grid of adjacentGrids) {
            const tokenAtGrid = this.getTokenAtGrid(grid, actorToken);
            if (tokenAtGrid && tokenAtGrid.actor) {
              const adjacentActorName = tokenAtGrid.actor.name || '';
              if (!adjacentActorName) continue;
              const isRoisMatch = roisNames.some(roisName => adjacentActorName === roisName);
              if (!isRoisMatch) {
                hasNonRoisAdjacent = true;
                break;
              }
            }
          }
          
          if (hasNonRoisAdjacent) {
            paranoiaPenalty = -2;
            if (effectiveStat.major && effectiveStat.major.dice !== undefined) {
              effectiveStat.major.dice = Math.max(1, (effectiveStat.major.dice || 0) - 2);
            }
          }
        }
      }
      
      if (weaponBonus) {
        // 기본 add 값에 무기 보너스 적용
        effectiveStat.add = (stat.add || 0) + (weaponBonus.add || 0);
        
        // major, reaction, dodge 각각에도 무기 보너스 적용
        if (effectiveStat.major) {
          effectiveStat.major.add = (effectiveStat.major.add || 0) + (weaponBonus.add || 0);
        }
        if (effectiveStat.reaction) {
          effectiveStat.reaction.add = (effectiveStat.reaction.add || 0) + (weaponBonus.add || 0);
        }
        if (effectiveStat.dodge) {
          effectiveStat.dodge.add = (effectiveStat.dodge.add || 0) + (weaponBonus.add || 0);
        }
        
        window.DX3rdDebug.log('DX3rd | Applied weapon bonus to stat', {
          originalAdd: stat.add,
          weaponAdd: weaponBonus.add,
          effectiveAdd: effectiveStat.add,
          majorAdd: effectiveStat.major?.add,
          reactionAdd: effectiveStat.reaction?.add,
          dodgeAdd: effectiveStat.dodge?.add,
          weaponName: weaponBonus.weaponName
        });
      }
      const buildBtn = (id, text) => `
        <button class="roll-type-btn" data-roll-type="${id}">${text}</button>`;
      
      // 미리 정의된 난이도가 있으면 사용, 없으면 아이템의 난이도 가져오기
      let itemDifficulty = '';
      if (predefinedDifficulty) {
        // Book 등에서 전달된 미리 정의된 난이도 사용
        if (predefinedDifficulty.type === 'number') {
          itemDifficulty = String(predefinedDifficulty.value);
        } else {
          itemDifficulty = '';
        }
      } else {
        itemDifficulty = item?.system?.difficulty || '';
      }
      
      // 무기/비클 공격인지 확인 (previousToken이 있으면 무기 공격)
      const isWeaponAttack = item && (item.type === 'weapon' || item.type === 'vehicle') && previousToken !== null;
      
      // 공격 명중 판정인지 확인 (무기/비클, 콤보, 이펙트, 사이오닉 포함 - 공포 패널티 적용 대상)
      const isAttackRoll = item && (
        (item.type === 'weapon' || item.type === 'vehicle') ||
        (item.system?.attackRoll && item.system.attackRoll !== '-' &&
         (item.system.attackRoll === 'melee' || item.system.attackRoll === 'ranged'))
      );
      
      // 폭주 타입 체크 (reaction/dodge 버튼 비활성화용)
      const berserkActive = actor.system?.conditions?.berserk?.active || false;
      const berserkType = actor.system?.conditions?.berserk?.type || '';
      const berserkTypesToBlock = ['normal', 'slaughter', 'battlelust', 'delusion', 'fear', 'hatred'];
      const isReactionDodgeBlocked = berserkActive && berserkTypesToBlock.includes(berserkType);
      
      // 예외 아이템 확인
      let isExceptionItem = false;
      if (isReactionDodgeBlocked && item) {
        const exceptionItems = game.settings.get('dx3rd-emanim', 'DX3rd.BerserkReactionExceptionItems') || '';
        const exceptionList = exceptionItems.split(',').map(n => n.trim());
        
        // 아이템 이름에서 ||RubyText 제거
        let itemName = item.name;
        const rubyPatternException = /^(.+)\|\|(.+)$/;
        const matchException = itemName.match(rubyPatternException);
        if (matchException) {
          itemName = matchException[1];
        }
        
        isExceptionItem = exceptionList.includes(itemName);
      }
      
      // 공포 패널티 확인 (공격 명중 판정인 경우: 무기/비클, 콤보, 이펙트, 사이오닉)
      let fearPenalty = 0;
      let fearTargetName = '';
      if (isAttackRoll) {
        const fearActive = actor.system?.conditions?.fear?.active || false;
        const fearTarget = actor.system?.conditions?.fear?.target || '';
        
        if (fearActive && fearTarget) {
          // 현재 타겟 중에 공포 대상이 있는지 확인
          const targets = Array.from(game.user.targets);
          const hasFearTarget = targets.some(t => {
            const targetName = t.actor?.name || t.name;
            if (targetName === fearTarget) {
              fearTargetName = targetName;
              return true;
            }
            return false;
          });
          
          if (hasFearTarget) {
            fearPenalty = -2;
            window.DX3rdDebug.log(`DX3rd | Fear penalty for attack roll: ${fearTarget} is in targets (-2 dice)`);
          }
        }
      }
      
      // 폭주 distaste 패널티 확인 (모든 판정에 적용)
      let distastePenalty = 0;
      let distasteTargetNames = [];
      
      // 폭주 distaste 타입 확인 (이미 위에서 선언된 berserkActive, berserkType 사용)
      const berserkDistaste = berserkActive && berserkType === 'distaste';
      
      if (berserkDistaste) {
        // 액터의 토큰 찾기
        const actorToken = canvas.tokens.placeables.find(t => t.actor?.id === actor.id);
        if (actorToken) {
          // 인접 그리드 가져오기
          const adjacentGrids = this.getAdjacentGrids(actorToken);
          
          // 인접 칸에 다른 토큰이 있는지 확인
          for (const grid of adjacentGrids) {
            const tokenAtGrid = this.getTokenAtGrid(grid, actorToken);
            if (tokenAtGrid) {
              const adjacentTokenName = tokenAtGrid.actor?.name || tokenAtGrid.name;
              
              // 폭주 distaste 타입인 경우 (인접 칸에 아무 토큰이나 있으면 패널티)
              distastePenalty = -10;
              
              // 중복 체크 후 추가
              if (!distasteTargetNames.includes(adjacentTokenName)) {
                distasteTargetNames.push(adjacentTokenName);
              }
              
              window.DX3rdDebug.log(`DX3rd | Berserk distaste penalty: ${adjacentTokenName} is adjacent (-10 add)`);
            }
          }
        }
      }
      
      // 토큰 이름들을 쉼표로 구분된 문자열로 변환
      const distasteTargetName = distasteTargetNames.join(', ');
      
      // 공포 효과 의존 패널티 확인 (모든 판정에 적용, dice -4) - 다이얼로그 표시용
      let dependencyPenalty = 0;
      
      if (panic8Applied) {
        // 액터의 토큰 찾기
        const actorToken = canvas.tokens.placeables.find(t => t.actor?.id === actor.id);
        if (actorToken) {
          // 로이스 아이템 이름 목록 가져오기
          const roisItems = actor.items.filter(item => item.type === 'rois');
          const roisNames = roisItems.map(item => {
            // 아이템 이름에서 ||RubyText 제거
            let itemName = item.name;
            const rubyPattern = /^(.+)\|\|(.+)$/;
            const match = itemName.match(rubyPattern);
            if (match) {
              itemName = match[1];
            }
            return itemName.trim();
          }).filter(name => name); // 빈 문자열 제거
          
          if (roisNames.length > 0) {
            // 인게이지 범위 계산 (토큰 크기의 절반 올림)
            const tokenSize = Math.max(actorToken.document.width, actorToken.document.height);
            const engageRange = Math.ceil(tokenSize / 2);
            
            // 인게이지 범위 내 그리드 가져오기
            const engageGrids = this.getGridsInRange(actorToken, engageRange);
            
            // 인게이지 범위 내에 로이스 아이템 이름과 일치하는 토큰 액터가 있는지 확인
            let hasMatchingRoisToken = false;
            for (const grid of engageGrids) {
              const tokenAtGrid = this.getTokenAtGrid(grid, actorToken);
              if (tokenAtGrid && tokenAtGrid.actor) {
                const tokenActorName = tokenAtGrid.actor.name || '';
                // 로이스 아이템 이름과 일치하는지 확인
                if (roisNames.some(roisName => tokenActorName === roisName)) {
                  hasMatchingRoisToken = true;
                  break;
                }
              }
            }
            
            // 일치하는 토큰이 없으면 dice 패널티 -4 표시
            if (!hasMatchingRoisToken) {
              dependencyPenalty = -4;
              window.DX3rdDebug.log(`DX3rd | Panic 8 (Dependency) penalty: No matching Rois token in engage range (-4 dice)`);
            }
          }
        }
      }
      
      // 난이도 표시: "참조"이면 placeholder로 DX3rd.ReferenceText 사용, 충동 판정이면 DX3rd.UrgeDifficulty 사용
      const referenceText = game.i18n.localize('DX3rd.Reference');
      const referenceDisplayText = game.i18n.localize('DX3rd.ReferenceText');
      const isReference = itemDifficulty === referenceText;
      const difficultyValue = isReference ? '' : itemDifficulty;
      let difficultyPlaceholder;
      if (isUrgeTest || isPanicTest) {
        difficultyPlaceholder = game.i18n.localize('DX3rd.UrgeDifficulty');
      } else if (isReference) {
        difficultyPlaceholder = referenceDisplayText;
      } else {
        difficultyPlaceholder = game.i18n.localize('DX3rd.Competition');
      }
      
      // 버튼 생성: specificRollType이 있으면 해당 버튼만, 없으면 모두
      let buttonHtml = '';
      if (specificRollType) {
        // 특정 타입만 표시
        const typeLabel = game.i18n.localize(`DX3rd.${specificRollType === 'major' ? 'Major' : specificRollType === 'reaction' ? 'Reaction' : 'DodgeRoll'}`);
        buttonHtml = buildBtn(specificRollType, typeLabel);
      } else {
        // 모든 타입 표시
        // reaction/dodge 버튼 비활성화 체크
        const reactionDisabled = isReactionDodgeBlocked && !isExceptionItem;
        const dodgeDisabled = isReactionDodgeBlocked && !isExceptionItem;
        
        const reactionBtn = reactionDisabled 
          ? `<button class="roll-type-btn" data-roll-type="reaction" disabled style="opacity: 0.5; cursor: not-allowed;">${game.i18n.localize('DX3rd.Reaction')}</button>`
          : buildBtn('reaction', game.i18n.localize('DX3rd.Reaction'));
        
        const dodgeBtn = dodgeDisabled 
          ? `<button class="roll-type-btn" data-roll-type="dodge" disabled style="opacity: 0.5; cursor: not-allowed;">${game.i18n.localize('DX3rd.DodgeRoll')}</button>`
          : buildBtn('dodge', game.i18n.localize('DX3rd.DodgeRoll'));
        
        buttonHtml = `
          ${buildBtn('major', game.i18n.localize('DX3rd.Major'))}
          ${reactionBtn}
          ${dodgeBtn}
        `;
      }
      
      const hasWeaponOrPenalty = weaponBonus || fearPenalty !== 0 || distastePenalty !== 0 || dependencyPenalty !== 0 || paranoiaPenalty !== 0;
      const attackSourceLabel = weaponBonus?.sourceLabel || game.i18n.localize('DX3rd.Weapon');

      // 안내 줄은 **이번 판정이 실제로 쓰는 값만** 보인다.
      //  · 공격력은 데미지 굴림에서만 소비된다 — preservedValues 는 executeStatRoll 의
      //    `if (isAttackRoll)` 안에서만 만들어지고, 비공격 판정에는 데미지 버튼 자체가 없다.
      //    그 숫자를 판정치 옆에 두면 이번 굴림에 적용되는 것처럼 읽힌다(조합 수치는 그 이펙트가
      //    공격에 조합됐을 때 발현한다).
      //  · 고정치와 다이스식을 함께 보인다. 예전에는 고정치만 찍어서 공격력이 '2d10' 인 무기가
      //    "공격 +0" 으로 보였다 — 값이 없는 것과 구분되지 않았다.
      const signed = text => (!text || text === '0') ? '+0' : (text.startsWith('-') ? text : `+${text}`);
      const bonusTerms = [];
      if (weaponBonus) {
        if (isAttackRoll) {
          bonusTerms.push(`${game.i18n.localize('DX3rd.Attack')} ${signed(this.joinFormulaTerms(weaponBonus.attack, weaponBonus.attackFormula))}`);
        }
        bonusTerms.push(`${game.i18n.localize('DX3rd.Add')} ${signed(this.joinFormulaTerms(weaponBonus.add, weaponBonus.addFormula))}`);
      }
      
      // 상단 칸은 최종 판정치이며 직접 수정할 수 있다(자동 계산 덮어쓰기).
      // 하단 칸은 자동 계산에 더하는 수정치이고, 그쪽을 만지면 덮어쓰기가 풀린다.
      // 다이스/크리티컬은 판정식 조립에 쓰는 정수라 type=number로 두어 "1d10" 같은 입력을
      // 브라우저 단계에서 막는다(정수로 잘려 조용히 1이 되는 사고 방지).
      // 수정치는 판정 롤의 항으로 그대로 실리므로 다이스식을 받는다.
      const overrideHint = game.i18n.localize('DX3rd.RollFieldOverrideHint');
      const addHint = game.i18n.localize('DX3rd.RollAddOverrideHint');

      // 「명중판정을 실행하기 직전에 선언할 것」류 장비를 이 창에서 토글로 고른다.
      // 시트로 돌아가 이름 클릭 → 「사용」을 누르게 하면 콤보 공격 흐름에서 완전히 벗어난다.
      // 명중판정이면 공격력·장갑무시 계열까지 함께 낸다 — 룰상 그 선언 시점이 바로 여기이고,
      // 여기서 선언해 두면 데미지 산출이 액터에서 읽어 갈 때 이미 반영돼 있다.
      // 실제 사용은 굴림 버튼을 누를 때(commit) 일어난다 — 굴리지 않고 닫으면 아무것도 소모되지 않는다.
      const declarable = window.DX3rdDeclaredEquipment?.collect(actor, isAttackRoll ? 'attack' : 'roll') || [];
      const declareSectionHtml = window.DX3rdDeclaredEquipment?.sectionHtml(declarable) || '';

      const content = `
        <div class="dx3rd-casting-dialog">
          <div class="dx3rd-row dx3rd-3col">
            <div>
              <div class="label">${game.i18n.localize('DX3rd.Dice')}</div>
              <input type="number" class="dx-dice-display" value="${effectiveStat.dice || 0}" title="${overrideHint}">
              <input type="number" class="dx-dice-input" value="0" placeholder="추가">
            </div>
            <div>
              <div class="label">${game.i18n.localize('DX3rd.Critical')}</div>
              <input type="number" class="dx-critical-display" value="${effectiveStat.critical || defaultCritical}" title="${overrideHint}">
              <input type="number" class="dx-critical-input" value="0" placeholder="수정">
            </div>
            <div>
              <div class="label">${game.i18n.localize('DX3rd.Add')}</div>
              <input type="text" class="dx-add-display" value="${effectiveStat.add || 0}" title="${addHint}">
              <input type="number" class="dx-add-input" value="0" placeholder="추가">
            </div>
          </div>
          ${hasWeaponOrPenalty ? '<hr style="margin: 12px 0; border: none; border-top: 1px solid #ccc;">' : ''}
          ${weaponBonus ? `<div class="dx3rd-mb-4 dx3rd-p-6 dx3rd-text-small dx3rd-bold" style="text-align: center;">
            ${attackSourceLabel}: ${weaponBonus.weaponName} (${bonusTerms.join(', ')})
          </div>` : ''}
          ${fearPenalty !== 0 ? `<div class="dx3rd-mb-4 dx3rd-p-6 dx3rd-text-small dx3rd-bold dx3rd-error" style="text-align: center; color: #ff6b6b;">
            ${game.i18n.localize('DX3rd.Fear')}: ${game.i18n.localize('DX3rd.Dice')} ${fearPenalty} (${game.i18n.localize('DX3rd.Target')}: ${fearTargetName})
          </div>` : ''}
          ${distastePenalty !== 0 ? `<div class="dx3rd-mb-4 dx3rd-p-6 dx3rd-text-small dx3rd-bold dx3rd-error" style="text-align: center; color: #ff6b6b;">
            ${game.i18n.localize('DX3rd.Berserk')}(${game.i18n.localize('DX3rd.UrgeDistaste')}): ${game.i18n.localize('DX3rd.Add')} ${distastePenalty} (${game.i18n.localize('DX3rd.Target')}: ${distasteTargetName})
          </div>` : ''}
          ${dependencyPenalty !== 0 ? `<div class="dx3rd-mb-4 dx3rd-p-6 dx3rd-text-small dx3rd-bold dx3rd-error" style="text-align: center; color: #ff6b6b;">
            ${game.i18n.localize('DX3rd.Panic8')}: ${game.i18n.localize('DX3rd.Dice')} ${dependencyPenalty}
          </div>` : ''}
          ${paranoiaPenalty !== 0 ? `<div class="dx3rd-mb-4 dx3rd-p-6 dx3rd-text-small dx3rd-bold dx3rd-error" style="text-align: center; color: #ff6b6b;">
            ${game.i18n.localize('DX3rd.Madness2')}: ${game.i18n.localize('DX3rd.MajorDice')} ${paranoiaPenalty}
          </div>` : ''}
          ${isWeaponAttack ? '' : `
          <hr style="margin: 12px 0; border: none; border-top: 1px solid #ccc;">
          <div class="dx3rd-row" style="margin-bottom: 8px;">
            <div>
              <div class="label" style="text-align: center;">${game.i18n.localize('DX3rd.Difficulty')}</div>
              <input type="text" class="dx-difficulty" value="${difficultyValue}" placeholder="${difficultyPlaceholder}" style="width: 100%; text-align: center;">
            </div>
          </div>
          `}
          ${declareSectionHtml}
          <hr style="margin: 12px 0; border: none; border-top: 1px solid #ccc;">
          <div class="type-row dx3rd-row ${specificRollType ? 'dx3rd-1col' : 'dx3rd-3col'}" style="margin-top:8px;">
            ${buttonHtml}
          </div>
        </div>`;

      // 충동 판정 또는 공포 판정인 경우 제목 변경
      const dialogTitle = isUrgeTest ? game.i18n.localize('DX3rd.UrgeTest') : (isPanicTest ? game.i18n.localize('DX3rd.PanicTest') : label);
      
      const DialogV2 = foundry.applications?.api?.DialogV2;
      if (!DialogV2) {
        ui.notifications.error(game.i18n.localize('DX3rd.DialogV2Unavailable'));
        return;
      }

      const dlg = new DialogV2({
        window: { title: dialogTitle },
        content,
        position: { width: 400 },
        classes: ['dx3rd-emanim', 'dx3rd-rolling-dialog'],
        buttons: [{
          action: 'close',
          label: game.i18n.localize('DX3rd.Close')
        }]
      });
      await dlg.render(true);

      const root = dlg.element;
      if (!root) return;

      const diceDisplay = root.querySelector('.dx-dice-display');
      const diceInput = root.querySelector('.dx-dice-input');
      const critDisplay = root.querySelector('.dx-critical-display');
      const critInput = root.querySelector('.dx-critical-input');
      const addDisplay = root.querySelector('.dx-add-display');
      const addInput = root.querySelector('.dx-add-input');

      // 직접 수정(덮어쓰기) 상태. 표시 칸은 "최종 판정치"이므로 사용자가 손으로 고치면
      // 그 값이 자동 계산(기본값 + 수정치 + 패널티)을 대신한다.
      // 판정 타입이 바뀌면 기준값 자체가 달라지므로 덮어쓰기는 무효로 본다.
      const overrides = { dice: null, critical: null, add: null };
      let overrideRollType = null;
      // 마지막으로 표시에 반영한 판정 타입. 호버 아웃 시 .selected 가 지워져도
      // 수정치 입력이 어느 타입 기준으로 계산되는지 잃지 않게 따로 들고 있는다.
      let currentRollType = specificRollType || null;

      const applyDisplay = (el, value, overridden) => {
        if (!el) return;
        // 사용자가 지금 타이핑 중인 칸은 덮어쓰지 않는다(커서·중간 입력 보존).
        if (document.activeElement !== el) el.value = value;
        el.classList.toggle('dx3rd-overridden', overridden);
      };

      // 현재 선택된 타입의 기본값 업데이트 함수
      const updateDisplayValues = (t) => {
        const data = effectiveStat[t] || { dice: effectiveStat.dice||0, critical: effectiveStat.critical||defaultCritical, add: effectiveStat.add||0 };
        const baseDice = data.dice || 0;
        const baseCrit = data.critical || defaultCritical;
        const baseAdd = data.add || 0; // effectiveStat.add가 이미 무기 보너스가 적용된 값

        if (overrideRollType && overrideRollType !== t) {
          overrides.dice = overrides.critical = overrides.add = null;
          overrideRollType = null;
        }
        currentRollType = t;

        // 사용자 입력값 가져오기
        const diceModifier = parseInt(diceInput?.value) || 0;
        const critModifier = parseInt(critInput?.value) || 0;
        const addModifier = parseInt(addInput?.value) || 0;

        // 기본값 + 입력값 + 공포 패널티 표시 (의존 패널티는 이미 effectiveStat.dice에 적용됨)
        // 룰(rule-section:39-41): 실제 판정치를 그대로 표시(0 이하면 자동실패 예고). 하한 클램프 없음.
        const finalDice = overrides.dice ?? (baseDice + diceModifier + fearPenalty);
        const finalCrit = overrides.critical ?? (baseCrit + critModifier);
        const finalAdd = overrides.add ?? (baseAdd + addModifier + distastePenalty);

        applyDisplay(diceDisplay, finalDice, overrides.dice !== null);
        applyDisplay(critDisplay, finalCrit, overrides.critical !== null);
        applyDisplay(addDisplay, finalAdd, overrides.add !== null);

        return { finalDice, finalCrit, finalAdd };
      };

      // 입력 필드 변경 시 디스플레이 업데이트
      const updateSelectedDisplay = () => {
        const t = root.querySelector('.roll-type-btn.selected')?.dataset.rollType || currentRollType;
        if (t) updateDisplayValues(t);
      };
      // 수정치 칸을 만지면 "자동 계산으로 돌아가겠다"는 뜻이므로 해당 항목의 덮어쓰기를 해제한다.
      const bindModifier = (el, key) => el?.addEventListener('input', () => {
        overrides[key] = null;
        updateSelectedDisplay();
      });
      bindModifier(diceInput, 'dice');
      bindModifier(critInput, 'critical');
      bindModifier(addInput, 'add');

      // 장비를 선언하면 액터에 자기 보정 AE 가 붙지만, effectiveStat 은 창을 열 때의 스냅샷이라
      // 저절로 갱신되지 않는다(침식·공포·폭주 패널티가 140여 줄에 걸쳐 인라인으로 깎여 들어가
      // 통째로 재도출할 수 없다). 그래서 선언 전 판정치와 선언 후 판정치의 **차이만** 얹는다.
      // 원본 stat 을 어디서 읽었는지는 두 가지로 되찾는다.
      //   ① 참조 동일성 — 대부분의 호출부는 actor.system.attributes[...] 를 그대로 넘긴다.
      //      prepareData 가 돌면 객체가 갈리므로, 경로는 반드시 갱신 **전에** 찾아 둬야 한다.
      //   ② resolveComboStat — 커스텀 base 처럼 새 객체를 조립해 넘기는 경우의 폴백.
      const statPath = (() => {
        const attrs = actor?.system?.attributes || {};
        for (const [key, value] of Object.entries(attrs)) {
          if (value === stat) return () => actor.system?.attributes?.[key];
        }
        for (const [key, value] of Object.entries(attrs.skills || {})) {
          if (value === stat) return () => actor.system?.attributes?.skills?.[key];
        }
        return null;
      })();
      const rereadStat = () => {
        const byPath = statPath?.();
        if (byPath) return byPath;
        if (!item) return null;
        try {
          return window.DX3rdComboHandler?.resolveComboStat?.(actor, item)?.stat || null;
        } catch (error) {
          window.DX3rdDebug.log('DX3rd | 선언 후 판정치 재도출 실패:', error);
          return null;
        }
      };
      // 확정 직전의 원본 판정치. 매번 여기서부터의 차이를 재므로 여러 번 확정해도 누적된다.
      const statBeforeDeclare = foundry.utils.deepClone(stat);
      const applyDeclaredDelta = () => {
        const fresh = rereadStat();
        if (!fresh) {
          window.DX3rdDebug.log('DX3rd | 선언 보정을 표시에 반영하지 못했다(판정치 출처 불명) — 굴림 자체는 정상.');
          return;
        }
        const bump = (targetNode, freshNode, baseNode) => {
          if (!targetNode || !freshNode || !baseNode) return;
          for (const key of ['dice', 'add', 'critical']) {
            const delta = (Number(freshNode[key]) || 0) - (Number(baseNode[key]) || 0);
            if (delta) targetNode[key] = (Number(targetNode[key]) || 0) + delta;
          }
        };
        bump(effectiveStat, fresh, statBeforeDeclare);
        for (const rollKey of ['major', 'reaction', 'dodge']) {
          bump(effectiveStat[rollKey], fresh[rollKey], statBeforeDeclare[rollKey]);
        }
        // 차이를 다시 재지 않도록 기준을 옮긴다(두 번째 선언이 첫 번째 몫까지 또 더하는 것 방지).
        foundry.utils.mergeObject(statBeforeDeclare, foundry.utils.deepClone(fresh), {inplace: true});
        updateSelectedDisplay();
      };
      const declareControl = window.DX3rdDeclaredEquipment?.bind(root, actor);

      /**
       * 토글해 둔 장비를 실제로 사용하고, 그 보정을 표시·굴림에 반영한다.
       * 굴림 버튼이 값을 읽기 **전에** 불러야 한다 — 그래야 이번 판정에 보정이 실린다.
       */
      const commitDeclarations = async () => {
        if (!declareControl?.hasPending?.()) return;
        const applied = await declareControl.commit();
        if (applied.length) applyDeclaredDelta();
      };

      // 표시 칸 직접 수정 → 최종 판정치 덮어쓰기 (비우면 자동 계산 복귀)
      // allowFormula: 수정치는 정수가 아니면 다이스식으로 보고 문자열째 보관한다.
      //   (판정 롤의 항으로 실리므로 "3+1d10"처럼 기존 값에 이어 붙일 수 있다.)
      const bindOverride = (el, key, allowFormula = false) => {
        if (!el) return;
        el.addEventListener('input', () => {
          const raw = el.value.trim();
          if (raw === '') {
            overrides[key] = null;
          } else if (/^[+-]?\d+$/.test(raw)) {
            overrides[key] = Number(raw);
            overrideRollType = currentRollType;
          } else if (allowFormula) {
            overrides[key] = raw; // 유효성은 blur/굴림 시점에 확인(타이핑 중엔 경고하지 않는다)
            overrideRollType = currentRollType;
          } else {
            return; // '-'만 찍은 중간 상태 등은 무시
          }
          updateSelectedDisplay();
        });
        // 포커스를 잃으면 표시를 실제 적용값으로 정규화한다. 그러지 않으면 칸에는 '-'가,
        // 판정에는 자동 계산값이 쓰이는 불일치가 눈에 보이지 않는다.
        el.addEventListener('blur', () => {
          if (typeof overrides[key] === 'string' && !Roll.validate(overrides[key])) {
            ui.notifications.warn(`${game.i18n.localize('DX3rd.RollAddFormulaInvalid')}: ${overrides[key]}`);
            overrides[key] = null;
          }
          updateSelectedDisplay();
        });
      };
      bindOverride(diceDisplay, 'dice');
      bindOverride(critDisplay, 'critical');
      bindOverride(addDisplay, 'add', true);

      const btns = Array.from(root.querySelectorAll('.roll-type-btn'));

      // 입력칸에서 Enter를 누르면 DialogV2의 기본 버튼(닫기)이 눌려 판정이 날아간다.
      // 칸을 편집할 수 있게 된 이상 Enter는 "지금 표시 중인 타입으로 굴린다"로 받는다.
      for (const el of [diceDisplay, diceInput, critDisplay, critInput, addDisplay, addInput,
                        root.querySelector('.dx-difficulty')]) {
        el?.addEventListener('keydown', ev => {
          if (ev.key !== 'Enter') return;
          ev.preventDefault();
          const target = btns.find(b => b.dataset.rollType === currentRollType && !b.disabled) || btns.find(b => !b.disabled);
          target?.click();
        });
      }

      // 특정 타입만 있는 경우 자동으로 선택 및 표시
      if (specificRollType && btns.length === 1) {
        btns[0].classList.add('selected');
        updateDisplayValues(specificRollType);
      } else {
        // 다이얼로그가 열릴 때 첫 번째 버튼의 기본값으로 초기화
        const firstBtn = btns[0];
        if (firstBtn) {
          firstBtn.classList.add('selected');
          updateDisplayValues(firstBtn.dataset.rollType);
        }
      }

      const hoverIn = ev => {
        const btn = ev.currentTarget;
        btns.forEach(other => other.classList.remove('selected'));
        btn.classList.add('selected');
        updateDisplayValues(btn.dataset.rollType);
      };
      const hoverOut = () => {
        btns.forEach(btn => btn.classList.remove('selected'));
        // 호버 아웃 시에도 마지막 선택된 타입 유지 (초기화하지 않음)
      };
      btns.forEach(btn => {
        btn.addEventListener('mouseenter', hoverIn);
        btn.addEventListener('mouseleave', hoverOut);
        btn.addEventListener('click', async ev => {
            const t = ev.currentTarget.dataset.rollType;

            // 토글해 둔 선언형 장비를 여기서 실제로 사용한다. 값을 읽기 전에 끝내야
            // 그 보정이 이번 판정에 실린다(닫기만 하면 여기까지 오지 않아 소모도 없다).
            await commitDeclarations();

            // 표시값 = 최종 판정치. 수정치·패널티·직접 수정(덮어쓰기)이 모두 반영된 값이다.
            // 룰(rule-section:39-41): 하한 없이 원 판정치를 전달 → 롤 실행부가 0 이하면 자동실패 처리
            const values = updateDisplayValues(t);
            const finalDice = values.finalDice;
            const finalCrit = Math.max(2, values.finalCrit);
            const finalAdd = values.finalAdd;

            // 수정치에 다이스식을 넣고 blur 없이 바로 굴린 경우(Enter 등). 깨진 식을 그대로
            // 판정 롤에 실으면 롤 전체가 실패하므로, 조용히 다른 값으로 굴리지 않고 여기서 멈춘다.
            if (typeof finalAdd === 'string' && !Roll.validate(finalAdd)) {
              ui.notifications.warn(`${game.i18n.localize('DX3rd.RollAddFormulaInvalid')}: ${finalAdd}`);
              return;
            }

            window.DX3rdDebug.log('DX3rd | Roll button clicked - values:', {
              rollType: t,
              finalDice,
              finalCrit,
              finalAdd,
              overrides,
              fearPenalty
            });
            
            // 공격 판정인지 확인 (무기/비클 타입이거나 attackRoll이 melee/ranged인 경우)
            const isAttackRoll = item && (
              ((item.type === 'weapon' || item.type === 'vehicle') && previousToken !== null) ||
              (item.system?.attackRoll && 
               item.system.attackRoll !== '-' && 
               (item.system.attackRoll === 'melee' || item.system.attackRoll === 'ranged'))
            );
            
            // 무기/비클 공격인 경우 별도 처리 (난이도 없음)
            if (item && (item.type === 'weapon' || item.type === 'vehicle') && previousToken !== null) {
              await this.executeAttackRoll(actor, item, label, previousToken, finalDice, finalCrit, finalAdd, weaponBonus, effectiveStat.rollFormula, t, sourceMessage);
            } else if (isAttackRoll) {
              // attackRoll이 melee/ranged인 경우 공격 판정으로 처리 (난이도 없음)
              // 무기 아이템에서 시작한 임시 콤보인지 확인
              const originalWeaponItem = item._originalWeaponItem || null;
              
              if (originalWeaponItem && previousToken === null) {
                // 원본 무기 아이템이 있고 previousToken이 없으면 원본 무기 아이템으로 executeAttackRoll 호출
                const weaponToken = canvas.tokens?.placeables.find(t => t.actor?.id === actor.id);
                if (weaponToken) {
                  weaponToken.control({ releaseOthers: true });
                  dlg.close();
                  await this.executeAttackRoll(actor, originalWeaponItem, label, weaponToken, finalDice, finalCrit, finalAdd, weaponBonus, effectiveStat.rollFormula, t, sourceMessage);
                  return;
                }
              }
              
              // 공격 판정이지만 executeAttackRoll로 가지 않는 경우 (콤보/이펙트 등)
              // 난이도 없이 executeStatRoll 호출
              const difficultyData = { type: 'none', value: 0 };
              await this.executeStatRoll(actor, finalDice, finalCrit, finalAdd, label, t, difficultyData, item, previousToken, weaponBonus, comboAfterSuccessData, comboAfterDamageData, false, null, false, effectiveStat.rollFormula, sourceMessage);
            } else {
              // 일반 판정: 난이도 처리
              const difficultyInput = root.querySelector('.dx-difficulty')?.value.trim() || '';
              
              // 난이도 필수 입력 체크
              if (requireDifficulty && !difficultyInput) {
                ui.notifications.warn('목표 난이도를 입력해주세요.');
                return;
              }
              
              let difficultyData = { type: 'competition', value: 0 }; // 기본값: 대결
              
              if (difficultyInput) {
                // 숫자인지 확인
                const numValue = parseInt(difficultyInput);
                if (!isNaN(numValue) && numValue > 0) {
                  // 숫자 난이도
                  difficultyData = { type: 'number', value: numValue };
                } else {
                  // 그 외(빈값 포함, "대결" 입력): 대결 판정
                  difficultyData = { type: 'competition', value: 0 };
                }
              }
              
              // 난이도 필수인 경우 숫자 난이도만 허용
              if (requireDifficulty && difficultyData.type !== 'number') {
                ui.notifications.warn('목표 난이도는 숫자로 입력해주세요.');
                return;
              }
              
              await this.executeStatRoll(actor, finalDice, finalCrit, finalAdd, label, t, difficultyData, item, previousToken, weaponBonus, comboAfterSuccessData, comboAfterDamageData, isUrgeTest, afterRollCallback, isPanicTest, effectiveStat.rollFormula, sourceMessage);
            }
            dlg.close();
        });
      });
    },

    /**
     * 능력치/스킬 판정 실행
     * @param {Actor} actor - 액터
     * @param {number} dice - 주사위 개수
     * @param {number} critical - 크리티컬 값
     * @param {number} add - 가산치
     * @param {string} label - 표시할 레이블
     * @param {string} rollType - 'major', 'reaction', 'dodge'
     * @param {Object} difficultyData - 난이도 데이터 { type: 'none'|'number'|'competition', value: number }
     * @param {Item} item - 아이템 (선택사항)
     * @param {Token} previousToken - 이전에 선택된 토큰 (선택사항)
     * @param {Object} comboAfterSuccessData - 콤보의 afterSuccess 데이터 (선택사항)
     */
    async executeStatRoll(actor, dice, critical, add, label, rollType, difficultyData = { type: 'none', value: 0 }, item = null, previousToken = null, weaponBonus = null, comboAfterSuccessData = null, comboAfterDamageData = null, isUrgeTest = false, afterRollCallback = null, isPanicTest = false, statRollFormula = null, sourceMessage = null) {
      const typeLabelMap = {
        major: game.i18n.localize('DX3rd.Major'),
        reaction: game.i18n.localize('DX3rd.Reaction'),
        dodge: game.i18n.localize('DX3rd.DodgeRoll')
      };
      const typeText = typeLabelMap[rollType] || '';
      let flavorText = '';
      const isEquipmentAttack = !!item && ['weapon', 'vehicle'].includes(item.type);
      
      // 충동 판정인 경우
      if (isUrgeTest) {
        flavorText = `${game.i18n.localize('DX3rd.UrgeTest')} - ${label}${typeText ? `(${typeText})` : ''}`;
      } else if (isPanicTest) {
        // 공포 판정인 경우
        flavorText = `${game.i18n.localize('DX3rd.PanicTest')} - ${label}${typeText ? `(${typeText})` : ''}`;
      } else if (item) {
        // 아이템이 있는 경우: 기능(타이밍) 표시 (아이템 사용 메시지는 이미 출력됨).
        // 공격 이펙트(attackRoll 설정)는 어떤 이펙트로 공격했는지 이름도 함께 표시한다.
        const isAtkRoll = isEquipmentAttack || (item.system?.attackRoll && item.system.attackRoll !== '-');
        const namePrefix = isAtkRoll && item.name ? `${item.name} — ` : '';
        flavorText = `${namePrefix}${label}${typeText ? `(${typeText})` : ''}`;
      } else {
        // 일반 능력치/스킬 판정
        flavorText = `${label}${typeText ? `(${typeText})` : ''}`;
      }
      
      // 난이도 타입에 따라 flavor 추가
      if (difficultyData.type === 'number') {
        flavorText += ` / ${game.i18n.localize('DX3rd.Difficulty')}: ${difficultyData.value}`;
      } else if (difficultyData.type === 'competition') {
        flavorText += ` / ${game.i18n.localize('DX3rd.Difficulty')}: ${game.i18n.localize('DX3rd.Competition')}`;
      }
      
      // 무기 보너스 정보 추가 (줄바꿈으로 구분)
      if (weaponBonus) {
        flavorText += `<br>${weaponBonus.sourceLabel || game.i18n.localize('DX3rd.Weapon')}: ${weaponBonus.weaponName}`;
      }
      
      try {
        // 무기 보너스 처리 (null이면 0으로 간주)
        const effectiveWeaponBonus = weaponBonus || { attack: 0, add: 0 };
        
        // 공격 판정인 경우 현재 시점의 값들 보존
        let preservedValues = null;
        // 무기/비클의 직접 공격은 system.attackRoll 필드를 쓰지 않고 system.skill로
        // showStatRollDialog에 들어온다. attackRoll만 검사하면 실제 장비 공격이 일반
        // 메이저 판정 카드로 빠지고 데미지 버튼도 사라진다.
        const authoredAttackRoll = item?.system?.attackRoll;
        const isAttackRoll = !!item && (
          isEquipmentAttack
          || (authoredAttackRoll !== '-' && (authoredAttackRoll === 'melee' || authoredAttackRoll === 'ranged'))
        );
        
        if (isAttackRoll) {
          // 맨손 보너스는 weapon-for-attack으로 고른 무기 이름 기준으로 판정한다.
          // 관통 다이스식은 명중 판정인 지금 굴려 숫자로 굳힌다.
          const bonuses = await this.resolveAttackBonusesRolled(actor, item, {
            attackType: isEquipmentAttack
              ? (item.type === 'weapon' ? item.system?.type : 'vehicle')
              : authoredAttackRoll,
            fistWeaponName: weaponBonus?.weaponName || ''
          });

          preservedValues = {
            actorAttack: bonuses.actorAttack,
            actorAttackFormula: bonuses.actorAttackFormula,
            actorDamageRoll: bonuses.actorDamageRoll,
            actorDamageRollFormula: bonuses.actorDamageRollFormula,
            actorPenetrate: bonuses.actorPenetrate,
            // 무기 공격력 다이스식은 데미지 확정 시점까지 보존한다.
            // 고정치(attack)와 다이스식(attackFormula)은 mergeAttackBonuses 가 **따로** 담는
            // 서로 다른 성분이다. 둘 중 하나만 고르면(옛 `attackFormula || attack`) 「고정
            // 공격력 이펙트 + 다이스 공격력 무기」를 조합했을 때 고정분이 통째로 사라졌다.
            // 수정치(add)는 이미 고정=effectiveStat.add / 다이스=판정 롤의 항으로 둘 다 싣는다.
            weaponAttackFormula: this.joinFormulaTerms(effectiveWeaponBonus.attack, effectiveWeaponBonus.attackFormula)
          };
        }
        
        // 수치 파생 단계에서는 보류한 다이스식을 실제 판정 버튼을 누른 지금 한 번만 굴린다.
        // [육체]/[백병]/[레벨] 참조는 prepareData 단계에서 이미 현재 액터 값으로 치환되어 있다.
        const actionProfile = actor.system.attributes.actionRollFormula || {};
        const typedProfile = actionProfile[rollType] || {};
        const buildActionFormula = (kind) =>
          [actionProfile[kind], typedProfile[kind], statRollFormula?.[kind]].filter(Boolean).join(' + ');
        const rollActionFormula = async (kind) => {
          const formula = buildActionFormula(kind);
          if (!formula) return { total: 0, text: '' };
          try {
            const result = await (new Roll(formula)).evaluate();
            return { total: Number(result.total) || 0, text: `${kind}: ${formula} → ${result.total}` };
          } catch (error) {
            console.warn(`DX3rd | stat roll formula failed (${kind}): ${formula}`, error);
            ui.notifications.warn(`${game.i18n.localize('DX3rd.DamageRollFormulaInvalid')}: ${formula}`);
            return { total: 0, text: `${kind}: ${formula} → 0` };
          }
        };
        // 다이스 개수/크리티컬만 미리 굴린다(판정식 조립에 값이 필요). 수정치(add) 다이스식은
        // 굴리지 않고 아래 판정 롤의 항으로 실어 카드에 "10dx7 + 10d10"으로 노출한다.
        const [formulaDice, formulaCritical] = await Promise.all([
          rollActionFormula('dice'), rollActionFormula('critical')
        ]);
        const addDiceFormula = this.validateRollTerm(buildActionFormula('add'), 'add');
        dice += formulaDice.total;
        critical = Math.max(2, critical + formulaCritical.total);
        // 채팅 카드에는 최종 DX3rd 판정식만 표시한다. 보조 수식의 전개값은
        // 판정 풀에 이미 반영되므로 별도 줄로 중복 표기하지 않는다.

        // 주사위 굴림 (침식률 증가는 이미 EffectHandler에서 처리됨)
        // 룰(rule-section:39-41): 수정 결과 판정치가 0 이하면 판정은 자동실패(달성치 0).
        // 실제 애니메이션을 위해 최소 1다이스는 굴리되, 결과는 아래에서 0으로 확정한다.
        const autoFailByPool = dice <= 0;
        const finalDice = Math.max(1, dice);
        // 달성치 D10 굴림(달성치에 +[N]D10 모델): 판정 롤에 항으로 실어 카드에서 함께 공개한다.
        const add2 = add;
        const dxRollN = Number(actor.system.attributes.dxroll?.value || 0);
        const dxRollFormula = this.validateRollTerm(
          actor.system.attributes.dxroll?.formula || (dxRollN > 0 ? `${dxRollN}d10` : ''), 'dxroll');
        // 콤보/이펙트 공격도 무기에서 넘겨 받은 다이스 명중 수정치를 동일한 판정 롤에 보존한다.
        const weaponAddFormula = weaponBonus?.addFormula;
        const rollFormula = [`${finalDice}dx${critical}`, String(add2),
          addDiceFormula, dxRollFormula, weaponAddFormula].filter(Boolean).join(' + ');
        const roll = await (new Roll(rollFormula)).roll();
        const rollHtml = await roll.render();

        // 룰: 판정 다이스가 전부 1이면 펌블 → 자동실패, 달성치 0.
        // dx 다이스텀이 fumble 플래그를 세우면 기능레벨/수정치(add2)까지 무시하고 0으로 확정한다.
        // 룰(rule-section:39-41): 판정치 0 이하도 동일하게 달성치 0으로 자동실패.
        const isFumble = roll.terms.some(t => t?.fumble === true);
        const rollResult = (autoFailByPool || isFumble) ? 0 : roll.total;
        if (autoFailByPool) {
          flavorText += `<br>${game.i18n.localize('DX3rd.PoolZero')} — ${game.i18n.localize('DX3rd.TestFailure')}`;
        } else if (isFumble) {
          flavorText += `<br>${game.i18n.localize('DX3rd.Fumble')} — ${game.i18n.localize('DX3rd.TestFailure')}`;
        }

        // 공격 판정인 경우 대상이 에너미이면 이베이전 확인 (롤 결과를 알 수 있으므로 여기서 처리)
        if (isAttackRoll) {
          const targets = Array.from(game.user.targets);
          if (targets.length > 0) {
            const targetDisplayNames = [];
            let hasEvasionTarget = false;
            
            for (const target of targets) {
              const targetActor = target.actor;
              const targetName = targetActor?.name || target.name;
              if (!targetName) continue;
              
              // 대상이 에너미이고 이베이전이 활성화되어 있는 경우 확인
              if (targetActor && targetActor.type === 'enemy') {
                const evasionDisabled = targetActor.system?.attributes?.evasion?.disabled;
                const evasionValue = targetActor.system?.attributes?.evasion?.value;
                
                if (evasionDisabled === false && evasionValue !== undefined && evasionValue !== null) {
                  hasEvasionTarget = true;
                  const evasionNum = Number(evasionValue) || 0;
                  const isHit = rollResult > evasionNum;
                  const resultText = isHit 
                    ? `${game.i18n.localize('DX3rd.Hit')}: ${game.i18n.localize('DX3rd.Evasion')} ${evasionNum}`
                    : `${game.i18n.localize('DX3rd.Failure')}: ${game.i18n.localize('DX3rd.Evasion')} ${evasionNum}`;
                  targetDisplayNames.push(`${targetName}(${resultText})`);
                } else {
                  targetDisplayNames.push(targetName);
                }
              } else {
                targetDisplayNames.push(targetName);
              }
            }
            
            if (targetDisplayNames.length > 0) {
              flavorText += `<br>· ${game.i18n.localize('DX3rd.Target')}: ${targetDisplayNames.join(', ')}`;
            }
          }
        }
        
        // 결과 텍스트 및 버튼
        let resultContent = '';
        
        if (isAttackRoll) {
          // 공격 판정: 명중과 데미지 버튼을 함께 유지해 어느 단계에서도 재굴림할 수 있게 한다.
          const weaponIdsStr = weaponBonus?.weaponIds ? weaponBonus.weaponIds.join(',') : '';
          resultContent = `
            ${this.renderAttackRollButton(actor, item, {repeatable: true})}
            <button class="damage-roll-btn"
                    data-actor-id="${actor.id}"
                    data-item-id="${item ? item.id : ''}"
                    data-roll-result="${rollResult}"
                    data-preserved-actor-attack="${preservedValues.actorAttack}"
                    data-preserved-actor-attack-formula="${encodeURIComponent(preservedValues.actorAttackFormula || '')}"
                    data-preserved-actor-damage-roll="${preservedValues.actorDamageRoll}"
                    data-preserved-actor-damage-roll-formula="${encodeURIComponent(preservedValues.actorDamageRollFormula || '')}"
                    data-preserved-actor-penetrate="${preservedValues.actorPenetrate}"
                    data-preserved-attack-formula="${encodeURIComponent(preservedValues.weaponAttackFormula)}"
                    data-weapon-ids="${weaponIdsStr}">
              ${game.i18n.localize('DX3rd.DamageRoll')}
            </button>
          `;
        } else if (difficultyData.type === 'number') {
          // 숫자 난이도: 성공/실패 판정 + 버튼 (펌블이면 rollResult=0이라 자동 실패)
          const isSuccess = rollResult >= difficultyData.value;
          
          if (isSuccess) {
            const itemName = item ? item.name.split('||')[0].replace(/\[DX3rd\.\w+\]/g, '').trim() : '';
            const isBook = item && item.type === 'book';
            const isConnection = item && item.type === 'connection';
            
            // Book 아이템인 경우: 성공 메시지만 표시하고 바로 spell 선택 다이얼로그 호출
            if (isBook) {
              resultContent = `<div class="dx3rd-result-success dx3rd-mt-8">${game.i18n.localize('DX3rd.TestSuccess')}</div>`;
              
              // spell 선택 다이얼로그 자동 호출
              setTimeout(async () => {
                if (window.DX3rdBookHandler && window.DX3rdBookHandler.showSpellSelectionDialog) {
                  await window.DX3rdBookHandler.showSpellSelectionDialog(actor, item);
                }
              }, 100);
            } else if (isConnection) {
              // Connection 아이템인 경우: 성공 메시지만 표시
              resultContent = `<div class="dx3rd-result-success dx3rd-mt-8">${game.i18n.localize('DX3rd.TestSuccess')}</div>`;
            } else {
              // 일반 아이템: 발동 버튼 표시
              const buttonText = item ? `${itemName} ${game.i18n.localize('DX3rd.Invoking')}` : game.i18n.localize('DX3rd.Success');
              resultContent = `
                <div class="item-actions dx3rd-mt-8">
                  <button class="dx3rd-success-btn" 
                          data-actor-id="${actor.id}"
                          data-item-id="${item ? item.id : ''}"
                          data-previous-token-id="${previousToken ? previousToken.id : ''}"
                          data-roll-result="${rollResult}"
                          data-label="${label}"
                          data-roll-type="${rollType}"
                          data-weapon-attack="0"
                          data-is-book="${isBook}">
                    ${buttonText}
                  </button>
                </div>
              `;
            }
          } else {
            resultContent = `<div class="dx3rd-result-failure">${game.i18n.localize('DX3rd.TestFailure')}</div>`;
          }
        } else if (difficultyData.type === 'competition') {
          // 대결 판정: 승리 체크 버튼
          const itemName = item ? item.name.split('||')[0].replace(/\[DX3rd\.\w+\]/g, '').trim() : '';
          const buttonText = item ? `${itemName} ${game.i18n.localize('DX3rd.Invoking')}` : game.i18n.localize('DX3rd.WinCheck');
          resultContent = `
            <div class="item-actions" style="margin-top: 8px;">
              <button class="dx3rd-win-check-btn"
                      data-actor-id="${actor.id}"
                      data-item-id="${item ? item.id : ''}"
                      data-previous-token-id="${previousToken ? previousToken.id : ''}"
                      data-roll-result="${rollResult}"
                      data-label="${label}"
                      data-roll-type="${rollType}"
                      data-weapon-attack="0">
                ${buttonText}
              </button>
            </div>
          `;
        }
        
        // flavor를 content에 직접 포함
        const content = isAttackRoll
          ? this.renderAttackChatCard({
              actor,
              item,
              flavorText: `<div class="flavor-text">${flavorText}</div>`,
              rollHtml,
              actionContent: resultContent
            })
          : `
            <div class="dx3rd-item-chat">
              <div class="flavor-text">${flavorText}</div>
              ${rollHtml}
              ${resultContent}
            </div>
          `;
        
        // 채팅 메시지 생성 (콤보 afterSuccess 데이터 플래그에 저장)
        const messageData = {
          speaker: {
            actor: actor.id,
            alias: actor.name
          },
          content: content
        };
        
        // 콤보 afterSuccess, afterDamage 데이터나 임시 콤보가 있는 경우에만 flags 초기화
        if (comboAfterSuccessData || comboAfterDamageData || window.DX3rdIsInstantCombo?.(item)) {
          messageData.flags = {
            'dx3rd-emanim': {}
        };
        
        // 콤보 afterSuccess와 afterDamage 데이터가 있으면 플래그에 저장
          if (comboAfterSuccessData) {
            messageData.flags['dx3rd-emanim'].comboAfterSuccess = {
              actorId: actor.id,
              comboItemId: item?.id || null,
              ...comboAfterSuccessData
            };
          }
          
          if (comboAfterDamageData) {
            messageData.flags['dx3rd-emanim'].comboAfterDamage = {
              actorId: actor.id,
              comboItemId: item?.id || null,
              ...comboAfterDamageData
            };
          }
          
          // 임시 콤보인 경우 아이템 데이터 저장
          if (window.DX3rdIsInstantCombo?.(item)) {
            messageData.flags['dx3rd-emanim'].tempComboItem = window.DX3rdSerializeInstantCombo(item);
          }
        }
        
        let attackMessage;
        if (sourceMessage && isAttackRoll) {
          const flagUpdates = {};
          const systemFlags = messageData.flags?.['dx3rd-emanim'] || {};
          for (const [key, value] of Object.entries(systemFlags)) {
            flagUpdates[`flags.dx3rd-emanim.${key}`] = value;
          }
          await sourceMessage.update({
            content,
            rolls: [roll.toJSON()],
            'flags.dx3rd-emanim.pendingAttackRoll': false,
            'flags.dx3rd-emanim.attackRollCompleted': false,
            ...flagUpdates
          });
          attackMessage = sourceMessage;
        } else {
          attackMessage = await ChatMessage.create(messageData);
        }
        if (isAttackRoll) await this.maybeAutoRollDamage?.(attackMessage);
        
        // 충동 판정 실패 시 폭주 상태이상 적용 (메시지 출력 후)
        if (isUrgeTest && difficultyData.type === 'number') {
          // 룰: 펌블=자동실패. 펌블이면 기능레벨/수정이 잔존한 roll.total과 무관하게 실패 처리.
          // 룰(rule-section:39-41): 판정치 0 이하도 자동실패 → 충동판정 실패로 [폭주] 부여.
          const isSuccess = !autoFailByPool && !isFumble && roll.total >= difficultyData.value;
          if (!isSuccess) {
            // 폭주 상태이상 적용을 위한 데이터 설정 (specialTarget을 null로 설정하여 다이얼로그 표시)
            if (!window.DX3rdConditionTriggerMap) {
              window.DX3rdConditionTriggerMap = new Map();
            }
            const key = `${actor.id}:berserk`;
            window.DX3rdConditionTriggerMap.set(key, {
              trigger: game.i18n.localize('DX3rd.UrgeTest'),
              specialTarget: null, // null로 설정하여 다이얼로그 표시
              suppressMessage: false
            });
            
            // 토큰 찾기
            let actorToken = actor.token;
            if (!actorToken && canvas.scene) {
              const tokenDoc = canvas.scene.tokens.find(t => t.actorId === actor.id);
              if (tokenDoc) {
                actorToken = tokenDoc.object;
              }
            }
            
            // 폭주 상태이상 적용 (다이얼로그가 표시됨)
            if (actorToken) {
              await actorToken.actor.toggleStatusEffect("berserk", { active: true });
            } else if (actor) {
              // 토큰이 없어도 액터에 직접 적용
              await actor.toggleStatusEffect("berserk", { active: true });
            }
            
            // 맵에서 데이터 제거
            window.DX3rdConditionTriggerMap.delete(key);
          }
        }
        
        // 공포 효과 처리 함수
        const applyPanicEffect = async (panicNumber, { messageKey, rolls = [] } = {}) => {
          if (messageKey) {
            const panicEffectSpeaker = window.DX3rdRuntimeUtils.getActorOnlySpeaker(actor);
            const panicLabel = game.i18n.localize(`DX3rd.Panic${panicNumber}`);
            const panicMessageContent = `
              <div class="dx3rd-item-chat">
                <div>
                  ${game.i18n.localize(messageKey)}: ${panicLabel}
                </div>
              </div>
            `;
            await ChatMessage.create({
              content: panicMessageContent,
              speaker: panicEffectSpeaker
            });
            if (rolls.length > 0) {
              await ChatMessage.create({
                speaker: panicEffectSpeaker,
                rolls
              });
            }
          }
          // 토큰 찾기 (충동 판정 실패와 동일한 방식)
          let actorToken = actor.token;
          if (!actorToken && canvas.scene) {
            const tokenDoc = canvas.scene.tokens.find(t => t.actorId === actor.id);
            if (tokenDoc) {
              actorToken = tokenDoc.object;
            }
          }
          const targetActor = actorToken ? actorToken.actor : actor;
          const panicTrigger = game.i18n.localize('DX3rd.PanicTest');
          
          const applyConditionViaMap = async (conditionId, payload) => {
            if (!window.DX3rdConditionTriggerMap) window.DX3rdConditionTriggerMap = new Map();
            const key = `${actor.id}:${conditionId}`;
            window.DX3rdConditionTriggerMap.set(key, { ...payload, suppressMessage: false });
            if (targetActor) await targetActor.toggleStatusEffect(conditionId, { active: true });
            window.DX3rdConditionTriggerMap.delete(key);
          };
          
          switch (panicNumber) {
            case 1:
              // 패닉 1: 경직 + 중압
              await applyConditionViaMap("rigor", { trigger: panicTrigger, specialTarget: null });
              await applyConditionViaMap("pressure", { trigger: panicTrigger, specialTarget: null });
              break;
            case 3:
              // 패닉 3: 경직
              await applyConditionViaMap("rigor", { trigger: panicTrigger, specialTarget: null });
              break;
            case 4:
              // 패닉 4: 중압
              await applyConditionViaMap("pressure", { trigger: panicTrigger, specialTarget: null });
              break;
            case 2:
              // 패닉 2: 도주 - applied 효과 적용 (dice -2)
              await window.DX3rdAppliedEffects.set(actor, 'Panic2', {
                name: game.i18n.localize('DX3rd.PanicType') + ': ' + game.i18n.localize('DX3rd.Panic2'),
                description: game.i18n.localize('DX3rd.PanicText2'),
                attributes: { dice: -2 },
                disable: 'scene'
              });
              break;
            case 7:
              // 패닉 7: 환각 - applied 효과 적용 (dice -2)
              await window.DX3rdAppliedEffects.set(actor, 'Panic7', {
                name: game.i18n.localize('DX3rd.PanicType') + ': ' + game.i18n.localize('DX3rd.Panic7'),
                description: game.i18n.localize('DX3rd.PanicText7'),
                attributes: { dice: -2 },
                disable: 'scene'
              });
              break;
            case 8:
              // 패닉 8: 의존 - applied 효과만 적용
              await window.DX3rdAppliedEffects.set(actor, 'Panic8', {
                name: game.i18n.localize('DX3rd.PanicType') + ': ' + game.i18n.localize('DX3rd.Panic8'),
                description: game.i18n.localize('DX3rd.PanicText8'),
                attributes: {},
                disable: 'scene'
              });
              break;
            case 5:
              // 패닉 5: 폭주 + 공포
              await applyConditionViaMap("berserk", { trigger: panicTrigger, specialTarget: null });
              await applyConditionViaMap("fear", { trigger: panicTrigger, specialTarget: null });
              break;
            case 6:
              // 패닉 6: 사독(랭크 2)
              await applyConditionViaMap("poisoned", { trigger: panicTrigger, poisonedRank: 2, specialTarget: null });
              break;
            case 9:
              // 패닉 9: 공포
              await applyConditionViaMap("fear", { trigger: panicTrigger, specialTarget: null });
              break;
            case 10:
              // 패닉 10: 폭주
              await applyConditionViaMap("berserk", { trigger: panicTrigger, specialTarget: null });
              break;
          }
        };
        
        // 공포 판정 실패 시 공포 효과 또는 광기 효과 지정/굴림 다이얼로그 표시 (메시지 출력 후)
        if (isPanicTest && difficultyData.type === 'number') {
          // 룰: 펌블=자동실패. 펌블이면 기능레벨/수정이 잔존한 roll.total과 무관하게 실패 처리.
          // 룰(rule-section:39-41): 판정치 0 이하도 자동실패 → 공포판정 실패효과/광기 적용.
          const isSuccess = !autoFailByPool && !isFumble && roll.total >= difficultyData.value;
          if (!isSuccess) {
            // 침식률 확인
            const encroachmentValue = Number(actor.system?.attributes?.encroachment?.value) || 0;
            const isMadness = encroachmentValue >= 80;
            
            if (isMadness) {
              // 침식률 80 이상: 광기 효과 적용
              const madnessChoice = await new Promise((resolve) => {
                const dialog = document.createElement("div");
                dialog.id = "dx3rd-madness-effect-dialog";
                dialog.className = "dx3rd-urge-dialog";
                
                // 키보드 이벤트 핸들러 (Enter/Escape 키 처리)
                const keyHandler = (ev) => {
                  if (ev.key === "Escape") {
                    ev.preventDefault();
                    ev.stopPropagation();
                    document.removeEventListener("keydown", keyHandler);
                    dialog.remove();
                    resolve(null);
                  }
                };
                
                const onSelect = (selection) => {
                  document.removeEventListener("keydown", keyHandler);
                  dialog.remove();
                  resolve(selection);
                };
                
                dialog.innerHTML = `
                  <div class="dx3rd-urge-dialog-title">${game.i18n.localize("DX3rd.PanicTest")} ${game.i18n.localize("DX3rd.Failure")}</div>
                  <div class="dx3rd-urge-dialog-buttons">
                    <button 
                      id="dx3rd-madness-select-button" 
                      class="dx3rd-urge-dialog-button"
                    >${game.i18n.localize("DX3rd.MadnessSelect")}</button>
                    <button 
                      id="dx3rd-madness-roll-button" 
                      class="dx3rd-urge-dialog-button"
                    >${game.i18n.localize("DX3rd.MadnessRoll")}</button>
                    <hr class="dx3rd-urge-dialog-divider">
                    <button 
                      id="dx3rd-madness-cancel-button" 
                      class="dx3rd-urge-dialog-button dx3rd-urge-dialog-cancel"
                    >${game.i18n.localize("DX3rd.Cancel")}</button>
                  </div>
                `;
                
                document.body.appendChild(dialog);
                document.addEventListener("keydown", keyHandler);
                
                dialog.querySelector("#dx3rd-madness-select-button").addEventListener("click", () => onSelect("select"));
                dialog.querySelector("#dx3rd-madness-roll-button").addEventListener("click", () => onSelect("roll"));
                dialog.querySelector("#dx3rd-madness-cancel-button").addEventListener("click", () => onSelect(null));
              });
              
              /** 광기 효과 적용 공통 처리 (지정/굴림 공통) */
              const applyMadnessEffect = async (actor, madnessNumber, { messageKey, rolls = [] }) => {
                const madnessEffectSpeaker = window.DX3rdRuntimeUtils.getActorOnlySpeaker(actor);
                const madnessLabel = game.i18n.localize(`DX3rd.Madness${madnessNumber}`);
                const madnessMessageContent = `
                  <div class="dx3rd-item-chat">
                    <div>
                      ${game.i18n.localize(messageKey)}: ${madnessLabel}
                    </div>
                  </div>
                `;
                await ChatMessage.create({
                  content: madnessMessageContent,
                  speaker: madnessEffectSpeaker
                });
                if (rolls.length > 0) {
                  await ChatMessage.create({
                    speaker: madnessEffectSpeaker,
                    rolls
                  });
                }
                const madnessTypePrefix = game.i18n.localize('DX3rd.MadnessType');
                const existingMadnessItems = actor.items.filter(item =>
                  item.type === 'effect' &&
                  item.name &&
                  item.name.startsWith(madnessTypePrefix)
                );
                if (existingMadnessItems.length > 0) {
                  const existingItemIds = existingMadnessItems.map(item => item.id);
                  await actor.deleteEmbeddedDocuments('Item', existingItemIds);
                }
                let madness14HpLoss = null;
                if (madnessNumber === 14) {
                  const hpRoll = new Roll("1d10");
                  await hpRoll.evaluate();
                  madness14HpLoss = hpRoll.total;
                  const currentHp = actor.system?.attributes?.hp?.value ?? 0;
                  const newHp = Math.max(0, currentHp - madness14HpLoss);
                  await actor.update({ 'system.attributes.hp.value': newHp });
                } else if (madnessNumber === 17) {
                  const currentHp = actor.system?.attributes?.hp?.value ?? 0;
                  const newHp = Math.max(0, currentHp - 5);
                  await actor.update({ 'system.attributes.hp.value': newHp });
                }
                const madnessItemData = {
                  name: game.i18n.localize('DX3rd.MadnessType') + ': ' + game.i18n.localize(`DX3rd.Madness${madnessNumber}`),
                  type: 'effect',
                  system: {
                    description: game.i18n.localize(`DX3rd.MadnessText${madnessNumber}`),
                    type: 'extra',
                    skill: '-',
                    difficulty: '-',
                    limit: '-',
                    timing: '-',
                    target: '-',
                    range: '-',
                    encroach: { init: 0, value: 0 },
                    level: { init: 1, max: 1, upgrade: false },
                    exp: { own: false, upgrade: false },
                    active: { state: true, disable: '-', runTiming: 'instant' },
                    attributes: (() => {
                      const attrs = {};
                      if (madnessNumber === 2) {
                        attrs.stat_dice_evade = { key: 'stat_dice', label: 'evade', value: 2 };
                      }  else if (madnessNumber === 5) {
                        attrs.stat_dice_info = { key: 'stat_dice', label: 'info', value: 1 };
                      } else if (madnessNumber === 6) {
                        attrs.dodge_dice = { key: 'dodge_dice', value: -2 };
                      } else if (madnessNumber === 8) {
                        attrs.stat_dice_negotiation = { key: 'stat_dice', label: 'negotiation', value: -1 };
                        attrs.stat_dice_will = { key: 'stat_dice', label: 'will', value: 1 };
                      } else if (madnessNumber === 9) {
                        attrs.stock_point = { key: 'stock_point', value: -4 };
                        attrs.stat_add_will = { key: 'stat_add', label: 'will', value: 2 };
                      } else if (madnessNumber === 11) {
                        attrs.damage_roll = { key: 'damage_roll', value: 1 };
                      } else if (madnessNumber === 13) {
                        attrs.stat_dice_perception = { key: 'stat_dice', label: 'perception', value: 3 };
                      } else if (madnessNumber === 14) {
                        attrs.hp = { key: 'hp', value: -madness14HpLoss };
                      } else if (madnessNumber === 15) {
                        attrs.stat_bonus_will = { key: 'stat_bonus', label: 'will', value: 1 };
                      } else if (madnessNumber === 17) {
                        attrs.hp = { key: 'hp', value: -5 };
                      }
                      return attrs;
                    })()
                  }
                };
                await actor.createEmbeddedDocuments('Item', [madnessItemData]);
              };
              
              if (madnessChoice === "select") {
                // 광기 효과 지정: 셀렉트 다이얼로그 표시
                const madnessOptions = [];
                for (let i = 1; i <= 17; i++) {
                  madnessOptions.push({
                    value: i,
                    label: game.i18n.localize(`DX3rd.Madness${i}`)
                  });
                }
                
                const selectContent = `
                  <div class="dx3rd-urge-dialog-title" style="margin-bottom: 12px;">${game.i18n.localize("DX3rd.MadnessSelect")}</div>
                  <select id="dx3rd-madness-select" style="width: 100%; margin-bottom: 12px; font-size: 0.9em;">
                    ${madnessOptions.map(opt => `<option value="${opt.value}">${opt.label}</option>`).join('')}
                  </select>
                `;
                
                const selectedMadness = await new Promise((resolve) => {
                  const selectDialog = document.createElement("div");
                  selectDialog.id = "dx3rd-madness-select-dialog";
                  selectDialog.className = "dx3rd-urge-dialog";
                  
                  // 키보드 이벤트 핸들러 (Enter/Escape 키 처리)
                  const keyHandler = (ev) => {
                    if (ev.key === "Enter") {
                      ev.preventDefault();
                      ev.stopPropagation();
                      document.removeEventListener("keydown", keyHandler);
                      const selectedValue = parseInt(selectDialog.querySelector("#dx3rd-madness-select").value);
                      selectDialog.remove();
                      resolve(selectedValue);
                    } else if (ev.key === "Escape") {
                      ev.preventDefault();
                      ev.stopPropagation();
                      document.removeEventListener("keydown", keyHandler);
                      selectDialog.remove();
                      resolve(null);
                    }
                  };
                  
                  const onConfirm = (value) => {
                    document.removeEventListener("keydown", keyHandler);
                    selectDialog.remove();
                    resolve(value);
                  };
                  
                  selectDialog.innerHTML = `
                    ${selectContent}
                    <div class="dx3rd-urge-dialog-buttons">
                      <button 
                        id="dx3rd-madness-confirm-button" 
                        class="dx3rd-urge-dialog-button"
                      >${game.i18n.localize("DX3rd.Confirm")}</button>
                      <hr class="dx3rd-urge-dialog-divider">
                      <button 
                        id="dx3rd-madness-select-cancel-button" 
                        class="dx3rd-urge-dialog-button dx3rd-urge-dialog-cancel"
                      >${game.i18n.localize("DX3rd.Cancel")}</button>
                    </div>
                  `;
                  
                  document.body.appendChild(selectDialog);
                  document.addEventListener("keydown", keyHandler);
                  
                  selectDialog.querySelector("#dx3rd-madness-confirm-button").addEventListener("click", () => {
                    const selectedValue = parseInt(selectDialog.querySelector("#dx3rd-madness-select").value);
                    onConfirm(selectedValue);
                  });
                  selectDialog.querySelector("#dx3rd-madness-select-cancel-button").addEventListener("click", () => onConfirm(null));
                });
                
                if (selectedMadness !== null) {
                  await applyMadnessEffect(actor, selectedMadness, { messageKey: "DX3rd.MadnessSelect" });
                }
              } else if (madnessChoice === "roll") {
                const madnessRoll = new Roll("1d100");
                await madnessRoll.evaluate();
                const rollResult = madnessRoll.total;
                let madnessNumber = 1;
                if (rollResult >= 96) madnessNumber = 17;
                else if (rollResult >= 91) madnessNumber = 16;
                else if (rollResult >= 86) madnessNumber = 15;
                else if (rollResult >= 81) madnessNumber = 14;
                else if (rollResult >= 76) madnessNumber = 13;
                else if (rollResult >= 71) madnessNumber = 12;
                else if (rollResult >= 66) madnessNumber = 11;
                else if (rollResult >= 61) madnessNumber = 10;
                else if (rollResult >= 56) madnessNumber = 9;
                else if (rollResult >= 51) madnessNumber = 8;
                else if (rollResult >= 44) madnessNumber = 7;
                else if (rollResult >= 38) madnessNumber = 6;
                else if (rollResult >= 31) madnessNumber = 5;
                else if (rollResult >= 23) madnessNumber = 4;
                else if (rollResult >= 15) madnessNumber = 3;
                else if (rollResult >= 8) madnessNumber = 2;
                await applyMadnessEffect(actor, madnessNumber, {
                  messageKey: "DX3rd.MadnessRoll",
                  rolls: [madnessRoll]
                });
              }
            } else {
              // 침식률 80 미만: 기존 패닉 효과 적용
              // 공포 효과 선택 다이얼로그 표시
              const panicChoice = await new Promise((resolve) => {
              const dialog = document.createElement("div");
              dialog.id = "dx3rd-panic-effect-dialog";
              dialog.className = "dx3rd-urge-dialog";
              
              // 키보드 이벤트 핸들러 (Enter/Escape 키 처리)
              const keyHandler = (ev) => {
                if (ev.key === "Escape") {
                  ev.preventDefault();
                  ev.stopPropagation();
                  document.removeEventListener("keydown", keyHandler);
                  dialog.remove();
                  resolve(null);
                }
              };
              
              const onSelect = (selection) => {
                document.removeEventListener("keydown", keyHandler);
                dialog.remove();
                resolve(selection);
              };
              
              dialog.innerHTML = `
                <div class="dx3rd-urge-dialog-title">${game.i18n.localize("DX3rd.PanicTest")} ${game.i18n.localize("DX3rd.Failure")}</div>
                <div class="dx3rd-urge-dialog-buttons">
                  <button 
                    id="dx3rd-panic-select-button" 
                    class="dx3rd-urge-dialog-button"
                  >${game.i18n.localize("DX3rd.PanicSelect")}</button>
                  <button 
                    id="dx3rd-panic-roll-button" 
                    class="dx3rd-urge-dialog-button"
                  >${game.i18n.localize("DX3rd.PanicRoll")}</button>
                  <hr class="dx3rd-urge-dialog-divider">
                  <button 
                    id="dx3rd-panic-cancel-button" 
                    class="dx3rd-urge-dialog-button dx3rd-urge-dialog-cancel"
                  >${game.i18n.localize("DX3rd.Cancel")}</button>
                </div>
              `;
              
              document.body.appendChild(dialog);
              document.addEventListener("keydown", keyHandler);
              
              dialog.querySelector("#dx3rd-panic-select-button").addEventListener("click", () => onSelect("select"));
              dialog.querySelector("#dx3rd-panic-roll-button").addEventListener("click", () => onSelect("roll"));
              dialog.querySelector("#dx3rd-panic-cancel-button").addEventListener("click", () => onSelect(null));
            });
            
            if (panicChoice === "select") {
              // 공포 효과 지정: 셀렉트 다이얼로그 표시
              const panicOptions = [];
              for (let i = 1; i <= 10; i++) {
                panicOptions.push({
                  value: i,
                  label: game.i18n.localize(`DX3rd.Panic${i}`)
                });
              }
              
              const selectContent = `
                <div class="dx3rd-urge-dialog-title" style="margin-bottom: 12px;">${game.i18n.localize("DX3rd.PanicSelect")}</div>
                <select id="dx3rd-panic-select" style="width: 100%; margin-bottom: 12px; font-size: 0.9em;">
                  ${panicOptions.map(opt => `<option value="${opt.value}">${opt.label}</option>`).join('')}
                </select>
              `;
              
              const selectedPanic = await new Promise((resolve) => {
                const selectDialog = document.createElement("div");
                selectDialog.id = "dx3rd-panic-select-dialog";
                selectDialog.className = "dx3rd-urge-dialog";
                
                // 키보드 이벤트 핸들러 (Enter/Escape 키 처리)
                const keyHandler = (ev) => {
                  if (ev.key === "Enter") {
                    ev.preventDefault();
                    ev.stopPropagation();
                    document.removeEventListener("keydown", keyHandler);
                    const selectedValue = parseInt(selectDialog.querySelector("#dx3rd-panic-select").value);
                    selectDialog.remove();
                    resolve(selectedValue);
                  } else if (ev.key === "Escape") {
                    ev.preventDefault();
                    ev.stopPropagation();
                    document.removeEventListener("keydown", keyHandler);
                    selectDialog.remove();
                    resolve(null);
                  }
                };
                
                const onConfirm = (value) => {
                  document.removeEventListener("keydown", keyHandler);
                  selectDialog.remove();
                  resolve(value);
                };
                
                selectDialog.innerHTML = `
                  ${selectContent}
                  <div class="dx3rd-urge-dialog-buttons">
                    <button 
                      id="dx3rd-panic-confirm-button" 
                      class="dx3rd-urge-dialog-button"
                    >${game.i18n.localize("DX3rd.Confirm")}</button>
                    <hr class="dx3rd-urge-dialog-divider">
                    <button 
                      id="dx3rd-panic-select-cancel-button" 
                      class="dx3rd-urge-dialog-button dx3rd-urge-dialog-cancel"
                    >${game.i18n.localize("DX3rd.Cancel")}</button>
                  </div>
                `;
                
                document.body.appendChild(selectDialog);
                document.addEventListener("keydown", keyHandler);
                
                selectDialog.querySelector("#dx3rd-panic-confirm-button").addEventListener("click", () => {
                  const selectedValue = parseInt(selectDialog.querySelector("#dx3rd-panic-select").value);
                  onConfirm(selectedValue);
                });
                selectDialog.querySelector("#dx3rd-panic-select-cancel-button").addEventListener("click", () => onConfirm(null));
              });
              
              if (selectedPanic !== null) {
                await applyPanicEffect(selectedPanic, { messageKey: "DX3rd.PanicSelect" });
              }
            } else if (panicChoice === "roll") {
              const panicRoll = new Roll("1d10");
              await panicRoll.evaluate();
              const rollResult = panicRoll.total;
              await applyPanicEffect(rollResult, {
                messageKey: "DX3rd.PanicRoll",
                rolls: [panicRoll]
              });
            }
            }
          }
        }
        
        // 충동 판정 완료 후 콜백 실행
        if (afterRollCallback && typeof afterRollCallback === 'function') {
          await afterRollCallback({
            actor,
            item,
            roll,
            // 펌블이면 기능레벨/수정치가 잔존한 roll.total 대신 0으로 확정한 값을 넘긴다.
            // (방어/리액션 닷지 성공 판정이 펌블을 자동실패로 처리하도록 함)
            total: rollResult,
            fumble: isFumble,
            rollType,
            difficultyData,
            label
          });
        }
        
        // 롤 타입에 따른 비활성화 훅 실행 (무기 보너스와 무관)
        if (rollType === 'major') {
          // 메이저 롤: roll과 major 비활성화 훅 실행
          if (window.DX3rdDisableHooks) {
            await window.DX3rdDisableHooks.executeDisableHook('roll', actor);
            await window.DX3rdDisableHooks.executeDisableHook('major', actor);
          }
        } else if (rollType === 'reaction' || rollType === 'dodge') {
          // 리액션/닷지 롤: roll과 reaction 비활성화 훅 실행
          if (window.DX3rdDisableHooks) {
            await window.DX3rdDisableHooks.executeDisableHook('roll', actor);
            await window.DX3rdDisableHooks.executeDisableHook('reaction', actor);
          }
        }

        // 명중판정 완료 공통 후처리 (콤보/이펙트 공격 분기): 증오 자동 회복 + 확장 훅
        if (isAttackRoll) {
          await this.onAttackRollComplete(actor, item, Array.from(game.user.targets), rollResult, isFumble);
        }
      } catch (e) {
        window.DX3rdDebug.log('DX3rd | Roll failed', e);
        // 에러 시 메시지 미생성: 정상 메시지가 이미 나간 뒤 예외면 GM으로 중복 메시지가 나가는 것 방지
      }
    },
  });
})();
