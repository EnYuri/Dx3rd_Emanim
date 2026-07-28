// Universal handler - 데미지 롤 & 데미지 계산 다이얼로그 클러스터
// universal-handler.js 에서 분리. 반드시 그 파일 뒤에 로드되어 동일 객체에 믹스인된다.
// (handleDamageRoll / showDamageCalculationDialog / _showAfterDamageDialog /
//  _executeAfterDamageActivation / onAttackRollComplete)
(function() {
  if (!window.DX3rdUniversalHandler) {
    console.error('DX3rd | universal-damage-dialog.js loaded before universal-handler.js; damage methods unavailable.');
    return;
  }

  Object.assign(window.DX3rdUniversalHandler, {
    /**
     * Handle damage roll for weapons
     * @param {Actor} actor - The actor using the weapon
     * @param {Item} item - The weapon item
     * @param {number} rollResult - The result from the attack roll
     * @param {Object} preservedValues - Values preserved before disable hooks (optional)
     */
    async handleDamageRoll(actor, item, rollResult = null, preservedValues = null, comboAfterDamageData = null) {
      
      let weaponAttack, actorAttack, actorAttackFormula, actorDamageRoll, actorDamageRollFormula, actorPenetrate;
      
      if (preservedValues) {
        // 보존된 값들 사용 (비활성화 훅 실행 전의 값)
        weaponAttack = preservedValues.weaponAttackFormula ?? preservedValues.weaponAttack ?? 0;
        actorAttack = preservedValues.actorAttack || 0;
        actorAttackFormula = preservedValues.actorAttackFormula || '';
        actorDamageRoll = preservedValues.actorDamageRoll || 0;
        actorDamageRollFormula = preservedValues.actorDamageRollFormula || '';
        actorPenetrate = preservedValues.actorPenetrate || 0;
      } else {
        // 현재 값들 사용 (비활성화 훅 실행 후의 값)
        weaponAttack = window.DX3rdFormulaEvaluator.prepareRollFormula(item.system.attack, item, actor);
        
        // 공격 타입/액터 보너스 산출 (명중 판정 시점과 동일 경로)
        // 명중 판정을 거치지 않고 바로 데미지를 굴리는 경로다. 관통 다이스식은
        // 여기가 가장 이른 확정 시점이므로 여기서 굴려 숫자로 굳힌다.
        const bonuses = await this.resolveAttackBonusesRolled(actor, item);
        actorAttack = bonuses.actorAttack;
        actorAttackFormula = bonuses.actorAttackFormula;
        actorDamageRoll = bonuses.actorDamageRoll;
        actorDamageRollFormula = bonuses.actorDamageRollFormula;
        actorPenetrate = bonuses.actorPenetrate;
      }
      
      // 데미지 산출 다이얼로그 표시 (롤 결과와 보존된 값들 포함)
      this.showDamageCalculationDialog(actor, item, weaponAttack, actorAttack, actorAttackFormula, actorDamageRoll, actorDamageRollFormula, actorPenetrate, rollResult, comboAfterDamageData);
    },

    /**
     * Show damage calculation dialog
     * @param {Actor} actor - The actor using the weapon
     * @param {Item} item - The weapon item
     * @param {number} weaponAttack - Weapon attack value
     * @param {number} actorAttack - Actor attack value
     * @param {number} actorDamageRoll - Actor damage roll value
     * @param {number} actorPenetrate - Actor penetrate value
     * @param {number} rollResult - Attack roll result
     * @param {Object} comboAfterDamageData - Combo afterDamage data (optional)
     */
    async showDamageCalculationDialog(actor, item, weaponAttack, actorAttack, actorAttackFormula, actorDamageRoll, actorDamageRollFormula, actorPenetrate, rollResult, comboAfterDamageData = null) {

      const attackRollResult = rollResult;
      
      // 공포 패널티 확인
      let fearPenalty = 0;
      let fearTargetName = '';
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
          fearPenalty = -10;
        }
      }
      
      // 폭주 혐오, 의존, 편집증 패널티 (공격 시 적용된 패널티 표시용)
      let distastePenalty = 0;
      let distasteTargetName = '';
      let dependencyPenalty = 0;
      let paranoiaPenalty = 0;
      const berserkActive = actor.system?.conditions?.berserk?.active || false;
      const berserkType = actor.system?.conditions?.berserk?.type || '';
      const panic8Applied = window.DX3rdAppliedEffects?.getEffect(actor, 'Panic8') || actor.system?.attributes?.applied?.Panic8;
      const madnessTypePrefixForPenalty = game.i18n.localize('DX3rd.MadnessType');
      const madness2Name = madnessTypePrefixForPenalty + ': ' + game.i18n.localize('DX3rd.Madness2');
      const hasMadness2 = actor.items.some(i => i.type === 'effect' && i.name === madness2Name);
      const actorTokenForPenalty = canvas.tokens?.placeables?.find(t => t.actor?.id === actor.id);
      
      if (actorTokenForPenalty) {
        if (berserkActive && berserkType === 'distaste') {
          const adjacentGrids = this.getAdjacentGrids(actorTokenForPenalty);
          const names = [];
          for (const grid of adjacentGrids) {
            const tokenAtGrid = this.getTokenAtGrid(grid, actorTokenForPenalty);
            if (tokenAtGrid) {
              const name = tokenAtGrid.actor?.name || tokenAtGrid.name;
              if (name && !names.includes(name)) names.push(name);
            }
          }
          if (names.length > 0) {
            distastePenalty = -10;
            distasteTargetName = names.join(', ');
          }
        }
        if (panic8Applied) {
          const roisItems = actor.items.filter(i => i.type === 'rois');
          const roisNames = roisItems.map(i => {
            const n = (i.name || '').replace(/\|\|.+$/, '').trim();
            return n;
          }).filter(Boolean);
          if (roisNames.length > 0) {
            const tokenSize = Math.max(actorTokenForPenalty.document.width, actorTokenForPenalty.document.height);
            const engageRange = Math.ceil(tokenSize / 2);
            const engageGrids = this.getGridsInRange(actorTokenForPenalty, engageRange);
            let hasMatching = false;
            for (const grid of engageGrids) {
              const t = this.getTokenAtGrid(grid, actorTokenForPenalty);
              if (t?.actor && roisNames.includes(t.actor.name || '')) {
                hasMatching = true;
                break;
              }
            }
            if (!hasMatching) dependencyPenalty = -4;
          }
        }
        if (hasMadness2) {
          const roisItems = actor.items.filter(i => i.type === 'rois');
          const roisNames = roisItems.map(i => {
            const n = (i.name || '').replace(/\|\|.+$/, '').trim();
            return n;
          }).filter(Boolean);
          const adjacentGrids = this.getAdjacentGrids(actorTokenForPenalty);
          for (const grid of adjacentGrids) {
            const t = this.getTokenAtGrid(grid, actorTokenForPenalty);
            if (t?.actor) {
              const name = t.actor.name || '';
              if (name && !roisNames.includes(name)) {
                paranoiaPenalty = -2;
                break;
              }
            }
          }
        }
      }
      
      // Madness 6 (과대망상): 공격 판정 결과가 20 이상일 때 데미지 롤 +1
      let madness6Bonus = 0;
      const madnessTypePrefix = game.i18n.localize('DX3rd.MadnessType');
      const madness6Name = madnessTypePrefix + ': ' + game.i18n.localize('DX3rd.Madness6');
      const hasMadness6 = actor.items.some(i => i.type === 'effect' && i.name === madness6Name);
      if (hasMadness6 && attackRollResult >= 20) {
        madness6Bonus = 1;
      }
      
      // Madness 7 (트리거 해피): system.skill이 ranged인 공격(사격 기능)에 한해 데미지 롤 attack +5
      let madness7Bonus = 0;
      const madness7Name = madnessTypePrefix + ': ' + game.i18n.localize('DX3rd.Madness7');
      const hasMadness7 = actor.items.some(i => i.type === 'effect' && i.name === madness7Name);
      if (hasMadness7 && item?.system?.skill === 'ranged') {
        madness7Bonus = 5;
      }
      
      // 참조는 이미 명중 시점의 값으로 고정되어 있다. 공격력의 다이스식만 확정 버튼까지
      // 남겨 두어, 산출 창에는 결과가 아닌 원 수식이 보이도록 한다.
      const weaponAttackFormula = String(weaponAttack ?? 0).trim() || '0';
      const appendFormulaTerm = (formula, value) => {
        const term = String(value ?? '').trim();
        if (!term || term === '0' || term === '+0' || term === '-0') return formula;
        if (!formula) return term;
        return term.startsWith('-')
          ? `${formula} - ${term.slice(1).trim()}`
          : `${formula} + ${term}`;
      };
      const joinFormulaTerms = (...terms) => terms.reduce(appendFormulaTerm, '') || '0';
      const baseDamageAddFormula = joinFormulaTerms(actorAttack, actorAttackFormula, weaponAttackFormula, fearPenalty);
      const diceCount = Math.floor(attackRollResult / 10) + 1 + actorDamageRoll + madness6Bonus;
      const totalDamageAddFormula = joinFormulaTerms(baseDamageAddFormula, madness7Bonus);
      
      // 템플릿 데이터 준비 (과대망상·트리거 해피 각각 구분 표기)
      const dynamicDicePart = actorDamageRollFormula ? ` + (${actorDamageRollFormula})` : '';
      const dicePart = `[${attackRollResult} / 10 + 1 + ${actorDamageRoll}${dynamicDicePart}${madness6Bonus ? ' + 1(' + game.i18n.localize('DX3rd.Madness6') + ')' : ''}]D10`;
      const addPart = `${baseDamageAddFormula}${madness7Bonus ? ' + 5(' + game.i18n.localize('DX3rd.Madness7') + ')' : ''}`;
      // 선언형 장비(로켓 런처의 장갑무시 등)는 여기가 아니라 명중판정 창에서 선언한다.
      // 룰이 「명중판정을 실행하기 직전에 선언할 것」이므로, 맞은 걸 본 뒤 고르게 하면
      // 빗나갔을 때 회수를 아끼는 자리가 생긴다 — declared-equipment.js 의 'attack' 문맥 참조.
      const templateData = {
        formula: `${dicePart} + ${addPart}`,
        actorPenetrate: actorPenetrate,
        fearPenalty: fearPenalty,
        fearTargetName: fearTargetName,
        distastePenalty,
        distasteTargetName,
        dependencyPenalty,
        paranoiaPenalty
      };
      
      // HTML 템플릿 렌더링
      const dialogContent = await foundry.applications.handlebars.renderTemplate("systems/dx3rd-emanim/templates/dialog/damage-calc-dialog.html", templateData);

      const DialogV2 = foundry.applications?.api?.DialogV2;
      if (!DialogV2?.wait) {
        ui.notifications.error(game.i18n.localize('DX3rd.DialogV2Unavailable'));
        return;
      }

      // 산출 창 확정이 곧 적용 확정이다 — 굴림 결과를 여기 담아두고 창이 닫힌 뒤 자동 적용한다.
      // 다이얼로그 콜백 안에서 적용하면 방어 다이얼로그(GM이 대상 소유자인 경우)가
      // 아직 열려 있는 산출 창 위에 겹쳐 뜬다.
      let pendingApply = null;

      await DialogV2.wait({
        window: {
          title: game.i18n.localize('DX3rd.CalcDamage')
        },
        content: dialogContent,
        rejectClose: false,
        buttons: [
          {
            action: "confirm",
            label: game.i18n.localize('DX3rd.Confirm'),
            default: true,
            callback: async (event, button) => {
              const form = button.form;
              const penetrate = parseInt(form?.querySelector('#penetrate')?.value) || 0;
              const addResult = parseInt(form?.querySelector('#add-result')?.value) || 0;
              const addDamageRoll = parseInt(form?.querySelector('#add-damage-roll')?.value) || 0;
              const addDamage = parseInt(form?.querySelector('#add-damage')?.value) || 0;
              
              // 최종 주사위 개수 계산 (소수점 버림, 과대망상 보너스 포함)
              let dynamicDiceCount = 0;
              let dynamicDiceRoll = null;
              if (actorDamageRollFormula) {
                try {
                  dynamicDiceRoll = await (new Roll(actorDamageRollFormula)).evaluate();
                  dynamicDiceCount = Math.max(0, Math.floor(Number(dynamicDiceRoll.total) || 0));
                } catch (error) {
                  console.warn(`DX3rd | damage_roll formula failed: ${actorDamageRollFormula}`, error);
                  ui.notifications.warn(`${game.i18n.localize('DX3rd.DamageRollFormulaInvalid')}: ${actorDamageRollFormula}`);
                  return;
                }
              }
              const finalDiceCount = Math.floor((attackRollResult + addResult) / 10) + 1 + actorDamageRoll + dynamicDiceCount + addDamageRoll + madness6Bonus;
              
              // 아이템 공격력의 다이스식은 바로 여기서 한 번만 확정한다.
              const finalDamageAddFormula = joinFormulaTerms(totalDamageAddFormula, addDamage);
              const finalDamageFormula = joinFormulaTerms(`${finalDiceCount}d10`, finalDamageAddFormula);
              
              // 최종 장갑 무시 값 = 사용자가 입력한 값을 그대로 사용
              const finalPenetrate = penetrate;
              
              
              try {
                // 데미지 롤 실행
                const damageRoll = await (new Roll(finalDamageFormula)).roll();
                
                // 롤 결과를 HTML로 변환
                const rollHTML = await damageRoll.render();
                const dynamicDiceHTML = dynamicDiceRoll ? await dynamicDiceRoll.render() : '';
                const rollMessage = `${dynamicDiceRoll ? `<div class="dx3rd-roll-detail"><div>${game.i18n.localize('DX3rd.DamageRollDiceFormula')}: ${actorDamageRollFormula} → +${dynamicDiceCount}D10</div>${dynamicDiceHTML}</div>` : ''}<div class="dice-roll">${rollHTML}</div>`;
                
                // 데미지 롤 정보 생성 (장갑 무시가 0이면 표시하지 않음)
                let damageRollInfo = game.i18n.localize('DX3rd.DamageRoll');
                if (finalPenetrate > 0) {
                  damageRollInfo += ` (${game.i18n.localize('DX3rd.Penetrate')}: ${finalPenetrate})`;
                }
                
                // 데미지 롤 정보, 롤 결과, 데미지 적용 버튼을 하나의 메시지로 묶기
                const damageApplyContent = `
                  <div class="dx3rd-item-chat">
                    <div class="flavor-text">${damageRollInfo}</div>
                    ${rollMessage}
                    <div class="damage-roll-message">
                      <button class="damage-apply-btn" 
                              data-actor-id="${actor.id}"
                              data-item-id="${item.id}"
                              data-damage="${damageRoll.total}"
                              data-penetrate="${finalPenetrate}"
                              data-attack-result="${attackRollResult}">
                        ${game.i18n.localize('DX3rd.DamageApply')}
                      </button>
                    </div>
                  </div>
                `;
                
                const messageData = {
                  speaker: {
                    actor: actor.id,
                    alias: actor.name
                  },
                  content: damageApplyContent,
                  rolls: [damageRoll]
                };
                
                // comboAfterDamage 데이터나 임시 콤보가 있는 경우에만 flags 초기화
                if (comboAfterDamageData || window.DX3rdIsInstantCombo?.(item)) {
                  messageData.flags = {
                    'dx3rd-emanim': {}
                };
                
                // comboAfterDamage 데이터가 있으면 플래그에 저장
                if (comboAfterDamageData) {
                  messageData.flags['dx3rd-emanim'].comboAfterDamage = comboAfterDamageData;
                }
                
                // 임시 콤보인 경우 아이템 데이터도 복사
                if (window.DX3rdIsInstantCombo?.(item)) {
                  messageData.flags['dx3rd-emanim'].tempComboItem = window.DX3rdSerializeInstantCombo(item);
                  }
                }
                
                const damageMessage = await ChatMessage.create(messageData);

                pendingApply = {
                  message: damageMessage,
                  damage: damageRoll.total,
                  penetrate: finalPenetrate,
                  attackResult: attackRollResult
                };

              } catch (error) {
                console.error('DX3rd | Damage roll failed:', error);
                ui.notifications.error('데미지 롤 중 오류가 발생했습니다.');
              }
            }
          }
        ],
        classes: ["dx3rd-emanim", "damage-dialog"]
      });

      // 데미지 롤 = 굴림 + 적용을 한 번에. 카드의 '데미지 적용' 버튼은 남겨 두어
      // (완료 표시) 대상을 바꿔 다시 적용하는 경로로 계속 쓸 수 있게 한다.
      // 호출부(handleDamageRoll)가 이 함수를 await 하지 않으므로 — afterSuccess 익스텐션이
      // 산출 창을 기다리지 않게 하려는 기존 순서다 — 여기서 예외를 삼켜 unhandled rejection 을 막는다.
      if (pendingApply) {
        try {
          const applied = await this.runDamageApply({
            actor, item,
            damage: pendingApply.damage,
            penetrate: pendingApply.penetrate,
            attackResult: pendingApply.attackResult,
            comboAfterDamageData
          });
          if (applied) {
            await pendingApply.message?.setFlag('dx3rd-emanim', 'damageApplyCompleted', true);
          }
        } catch (error) {
          console.error('DX3rd | Damage auto-apply failed:', error);
          ui.notifications.error('데미지 적용 중 오류가 발생했습니다.');
        }
      }
    },

    /**
     * 데미지 적용 실행부(게이트 포함). 채팅의 '데미지 적용' 버튼과 데미지 산출 창 확정 직후의
     * 자동 적용이 같은 경로를 쓰도록 분리했다 — 게이트(권한/타겟/증오)를 한 곳에만 둔다.
     * 타겟은 호출 시점의 game.user.targets 를 읽는다(버튼 경로와 동일).
     * @returns {Promise<boolean>} 실제로 적용을 진행했으면 true (게이트에서 막히면 false)
     */
    async runDamageApply({actor, item, damage, penetrate, attackResult = 0, comboAfterDamageData = null} = {}) {
      if (!actor) return false;

      // 권한 체크
      if (!actor.isOwner && !game.user.isGM) {
        console.warn('DX3rd | User lacks permission to use this actor\'s actions');
        return false;
      }

      // 액터의 토큰 자동 선택
      const previousToken = canvas.tokens?.controlled?.[0] || null;
      const actorToken = canvas.tokens?.placeables.find(t => t.actor?.id === actor.id);
      if (actorToken) actorToken.control({ releaseOthers: true });

      const restoreToken = () => {
        if (previousToken && canvas.tokens) previousToken.control({ releaseOthers: true });
      };

      // 타겟 체크
      const targets = Array.from(game.user.targets);
      if (targets.length === 0) {
        ui.notifications.warn(game.i18n.localize('DX3rd.SelectTarget'));
        restoreToken();
        return false;
      }

      // Hatred 상태이상 체크 (타겟에 hatred.target이 포함되어야 함)
      const hatredActive = actor.system?.conditions?.hatred?.active || false;
      const hatredTarget = actor.system?.conditions?.hatred?.target || '';
      if (hatredActive && hatredTarget) {
        const hasHatredTarget = targets.some(t => (t.actor?.name || t.name) === hatredTarget);
        if (!hasHatredTarget) {
          const hatredMessage = game.i18n.localize('DX3rd.MustAttackHatredTarget').replace('{target}', hatredTarget);
          await ChatMessage.create({
            speaker: window.DX3rdRuntimeUtils.getActorOnlySpeaker(actor),
            content: `<div style="color: #ff6b6b;"><strong>${game.i18n.localize('DX3rd.Hatred')}: ${hatredMessage}</strong></div>`
          });
          restoreToken();
          return false;
        }
      }

      // 증오 자동 회복은 명중판정 시점(onAttackRollComplete)으로 이관됨.
      // 룰상 성공 여부와 무관하게 회복되므로, 빗나가 데미지 버튼을 누르지 않는 경우도 커버해야 한다.
      // 위 hatred 대상 강제 체크는 잘못된 대상에 데미지 적용을 막는 안전망으로 유지.
      await this.handleDamageApply(actor, item, damage, penetrate, targets, comboAfterDamageData, attackResult);
      restoreToken();
      return true;
    },

    /**
     * 데미지 적용 처리
     * @param {Object} comboAfterDamageData - 콤보 afterDamage 데이터 (선택적)
     */
    handleDamageApply: async function(actor, item, damage, penetrate, targets, comboAfterDamageData = null, attackResult = null) {
      if (!actor || !targets || targets.length === 0) {
        return;
      }
      

      // ===== 익스텐드 큐 등록 요청 (GM에게) =====
      // 콤보는 processComboAfterDamage에서 병합하여 처리하므로 제외
      if (item && item.type !== 'combo') {
        const itemExtend = item.getFlag('dx3rd-emanim', 'itemExtend') || {};
        const attackMatches = (kind, data) => !window.DX3rdItemEffectAdapter
          || window.DX3rdItemEffectAdapter.extensionActionMatches(item, kind, data, 'attack', 'afterDamage');
        // afterDamage 타이밍 체크
        const condEntries = window.DX3rdUniversalHandler?._getConditionEntries(itemExtend.condition || {}) || [];
        const condEntriesForAttack = condEntries.filter(c => attackMatches('condition', c));
        const cardEntriesForAttack = (window.DX3rdItemEffectAdapter?.extensionEntries?.(itemExtend) || [])
          .filter(entry => !entry.legacy && entry.data?.activate && attackMatches(entry.type, entry.data));
        const queuedCards = cardEntriesForAttack.filter(entry =>
          entry.data?.timing === 'afterDamage' ||
          (item.system.active?.runTiming === 'afterDamage' && entry.data?.timing === 'afterMain'));
        const hasCondAfterDamage = condEntriesForAttack.some(c => c.timing === 'afterDamage');
        const hasCondAfterMain = condEntriesForAttack.some(c => c.timing === 'afterMain');
        const hasAfterDamageExtension = 
          (itemExtend.heal?.activate && itemExtend.heal?.timing === 'afterDamage' && attackMatches('heal', itemExtend.heal)) ||
          (itemExtend.damage?.activate && itemExtend.damage?.timing === 'afterDamage' && attackMatches('damage', itemExtend.damage)) ||
          (itemExtend.statusClear?.activate && itemExtend.statusClear?.timing === 'afterDamage' && attackMatches('statusClear', itemExtend.statusClear)) ||
          hasCondAfterDamage || queuedCards.some(entry => entry.data?.timing === 'afterDamage');
        
        // 아이템의 runTiming이 afterDamage이고 익스텐드 타이밍이 afterMain인 경우도 체크
        const itemRunTiming = item.system.active?.runTiming;
        const hasAfterMainExtensionForAfterDamage = 
          itemRunTiming === 'afterDamage' && (
            (itemExtend.heal?.activate && itemExtend.heal?.timing === 'afterMain' && attackMatches('heal', itemExtend.heal)) ||
            (itemExtend.damage?.activate && itemExtend.damage?.timing === 'afterMain' && attackMatches('damage', itemExtend.damage)) ||
            (itemExtend.statusClear?.activate && itemExtend.statusClear?.timing === 'afterMain' && attackMatches('statusClear', itemExtend.statusClear)) ||
            hasCondAfterMain || queuedCards.some(entry => entry.data?.timing === 'afterMain')
          );
        
        if (hasAfterDamageExtension || hasAfterMainExtensionForAfterDamage) {
          const targetIds = targets.map(t => t.id);
          const targetActorIds = targets.map(t => t.actor.id);
          
          if (game.user.isGM) {
            // GM: 직접 큐에 등록
            const queueKey = `${actor.id}_${item.id}`;
            
            if (!window.DX3rdAfterDamageExtensionQueue) {
              window.DX3rdAfterDamageExtensionQueue = {};
            }
            
            window.DX3rdAfterDamageExtensionQueue[queueKey] = {
              attackerId: actor.id,
              itemId: item.id,
              targetActorIds: targetActorIds,
              damageReports: {},
              reportCount: 0,
              extensions: {
                // afterDamage 타이밍 또는 (아이템 runTiming이 afterDamage이고 익스텐드 타이밍이 afterMain인 경우)
                heal: itemExtend.heal?.activate && (
                  itemExtend.heal?.timing === 'afterDamage' || 
                  (itemRunTiming === 'afterDamage' && itemExtend.heal?.timing === 'afterMain')
                ) && attackMatches('heal', itemExtend.heal) ? itemExtend.heal : null,
                damage: itemExtend.damage?.activate && (
                  itemExtend.damage?.timing === 'afterDamage' || 
                  (itemRunTiming === 'afterDamage' && itemExtend.damage?.timing === 'afterMain')
                ) && attackMatches('damage', itemExtend.damage) ? itemExtend.damage : null,
                statusClear: itemExtend.statusClear?.activate && (
                  itemExtend.statusClear?.timing === 'afterDamage' ||
                  (itemRunTiming === 'afterDamage' && itemExtend.statusClear?.timing === 'afterMain')
                ) && attackMatches('statusClear', itemExtend.statusClear) ? itemExtend.statusClear : null,
                condition: (() => {
                  const match = condEntriesForAttack.filter(c =>
                    c.timing === 'afterDamage' ||
                    (itemRunTiming === 'afterDamage' && c.timing === 'afterMain')
                  );
                  return match.length > 0 ? match : null;
                })(),
                cards: queuedCards.map(entry => ({type: entry.type, data: entry.data}))
              },
              triggerItemName: item.name,
              itemRunTiming: itemRunTiming  // 아이템의 runTiming 저장
            };
            
            window.DX3rdDebug.log('DX3rd | GM registered afterDamage extension request:', {
              queueKey: queueKey,
              attacker: actor.name,
              targetCount: targetActorIds.length,
              hasHeal: !!window.DX3rdAfterDamageExtensionQueue[queueKey].extensions.heal,
              hasDamage: !!window.DX3rdAfterDamageExtensionQueue[queueKey].extensions.damage,
              hasCondition: !!window.DX3rdAfterDamageExtensionQueue[queueKey].extensions.condition
            });
          } else {
            // 플레이어: GM에게 큐 등록 요청
            window.DX3rdSocketRouter.emit({
              type: 'registerAfterDamageExtension',
              payload: {
                attackerId: actor.id,
                itemId: item.id,
                targetActorIds: targetActorIds,
                extensions: {
                  // afterDamage 타이밍 또는 (아이템 runTiming이 afterDamage이고 익스텐드 타이밍이 afterMain인 경우)
                  heal: itemExtend.heal?.activate && (
                    itemExtend.heal?.timing === 'afterDamage' || 
                    (item.system.active?.runTiming === 'afterDamage' && itemExtend.heal?.timing === 'afterMain')
                  ) && attackMatches('heal', itemExtend.heal) ? itemExtend.heal : null,
                  damage: itemExtend.damage?.activate && (
                    itemExtend.damage?.timing === 'afterDamage' || 
                    (item.system.active?.runTiming === 'afterDamage' && itemExtend.damage?.timing === 'afterMain')
                  ) && attackMatches('damage', itemExtend.damage) ? itemExtend.damage : null,
                  statusClear: itemExtend.statusClear?.activate && (
                    itemExtend.statusClear?.timing === 'afterDamage' ||
                    (item.system.active?.runTiming === 'afterDamage' && itemExtend.statusClear?.timing === 'afterMain')
                  ) && attackMatches('statusClear', itemExtend.statusClear) ? itemExtend.statusClear : null,
                  condition: (() => {
                    const ce = window.DX3rdUniversalHandler?._getConditionEntries(itemExtend.condition || {}) || [];
                    const match = ce.filter(c => attackMatches('condition', c) && (
                      c.timing === 'afterDamage' ||
                      (item.system.active?.runTiming === 'afterDamage' && c.timing === 'afterMain')
                    ));
                    return match.length > 0 ? match : null;
                  })(),
                  cards: queuedCards.map(entry => ({type: entry.type, data: entry.data}))
                },
                triggerItemName: item.name
              }
            });
            
            window.DX3rdDebug.log('DX3rd | Sent afterDamage extension registration to GM');
          }
        }
      }

      // 활성화/매크로 요청 등록 (아이템이 있을 때만)
      if (item?.id) {
        const isCombo = item.type === 'combo';
        
        // 콤보는 comboAfterDamageData만 등록, 단일 아이템은 기존 로직
        const activeDisable = item.system?.active?.disable ?? '-';
        const activeActionMatches = !window.DX3rdItemEffectAdapter || window.DX3rdItemEffectAdapter.extensionActionMatches(item, 'selfModifiers', item.system?.active || {}, 'attack', 'afterDamage');
        const targetActionMatches = !window.DX3rdItemEffectAdapter || window.DX3rdItemEffectAdapter.targetActionMatches(item, 'attack', 'afterDamage');
        const shouldActivate = !isCombo && activeActionMatches && (item.system.active?.runTiming === 'afterDamage' && !item.system.active?.state && activeDisable !== 'notCheck');
        const shouldApplyToTargets = !isCombo && targetActionMatches && (item.system.effect?.runTiming === 'afterDamage');
        const hasAfterDamageEmbeddedMacro = (item.system?.macros || []).some(macro =>
          !macro.disabled && macro.timing === 'afterDamage' &&
          (!window.DX3rdItemEffectAdapter || window.DX3rdItemEffectAdapter.macroActionMatches(item, macro, 'attack', 'afterDamage'))
        );
        const shouldExecuteMacro = !isCombo && (!!item.system?.macro || hasAfterDamageEmbeddedMacro);

        // 콤보이거나, 활성화/대상 적용/매크로 중 하나라도 필요한 경우 등록
        if (isCombo || shouldActivate || shouldApplyToTargets || shouldExecuteMacro) {
          const usedDisable = item.system?.used?.disable || 'notCheck';
          const usedState = item.system?.used?.state || 0;
          const usedMax = item.system?.used?.max || 0;
          
          // 활성화/효과는 횟수 체크, 매크로는 항상 등록
          const shouldRegister = shouldExecuteMacro || (usedDisable === 'notCheck' || usedState < usedMax);
          
          if (shouldRegister) {
            const targetActorIds = targets.map(t => t.actor.id);
            const needsDialog = item.type === 'weapon' || item.type === 'vehicle';
            
            if (game.user.isGM) {
              // GM은 직접 큐에 등록
              const queueKey = `${actor.id}_${item.id}`;
              window.DX3rdAfterDamageActivationQueue[queueKey] = {
                attackerId: actor.id,
                itemId: item.id,
                targetActorIds: targetActorIds,
                damageReports: {},
                reportCount: 0,
                shouldExecuteMacro: shouldExecuteMacro,
                shouldActivate: shouldActivate,
                shouldApplyToTargets: shouldApplyToTargets,
                needsDialog: needsDialog,
                comboAfterDamageData: comboAfterDamageData, // 콤보 데이터 저장
                timestamp: Date.now()
              };
              window.DX3rdDebug.log('DX3rd | GM registered afterDamage request:', {
                queueKey: queueKey,
                attacker: actor.name,
                targetCount: targetActorIds.length,
                hasMacro: shouldExecuteMacro,
                hasComboData: !!comboAfterDamageData
              });
            } else {
              // 일반 유저는 GM에게 등록 요청
              window.DX3rdSocketRouter.emit({
                type: 'registerAfterDamageActivation',
                payload: {
                  attackerId: actor.id,
                  itemId: item.id,
                  targetActorIds: targetActorIds,
                  shouldExecuteMacro: shouldExecuteMacro,
                  shouldActivate: shouldActivate,
                  shouldApplyToTargets: shouldApplyToTargets,
                  needsDialog: needsDialog,
                  comboAfterDamageData: comboAfterDamageData // 콤보 데이터 전달
                }
              });
              window.DX3rdDebug.log('DX3rd | AfterDamage registration sent to GM:', {
                attacker: actor.name,
                item: item.name,
                targetCount: targetActorIds.length,
                hasMacro: shouldExecuteMacro,
                hasComboData: !!comboAfterDamageData
              });
            }
          }
        }
      }

      // 각 타겟에 대해 방어 다이얼로그 전달
      for (const target of targets) {
        const targetActor = target.actor;
        if (!targetActor) continue;
        
        const payload = {
          targetActorId: targetActor.id,
          damage: damage,
          penetrate: penetrate,
          attackResult: attackResult,
          attackerName: actor.name,
          attackerId: actor.id,
          itemId: item?.id || null
        };
        
        // 방어 다이얼로그 전송 (타겟 소유자 우선)
        if (game.user.isGM) {
          // GM: 타겟에 일반 소유자가 있는지 확인
          const nonGMOwners = game.users.filter(user => 
            !user.isGM && 
            user.active &&  // 접속 중인 유저만
            targetActor.testUserPermission(user, 'OWNER')
          );
          
          if (nonGMOwners.length > 0) {
            // 접속 중인 일반 소유자가 있으면 소켓 전송
            window.DX3rdSocketRouter.emit({
              type: 'showDefenseDialog',
              dialogData: payload  // payload → dialogData로 통일
            });
            window.DX3rdDebug.log('DX3rd | Defense dialog sent via socket to non-GM owner for:', targetActor.name);
          } else {
            // 접속 중인 일반 소유자가 없으면 GM이 직접 표시
            await this.showDefenseDialog(payload);
            window.DX3rdDebug.log('DX3rd | GM showing defense dialog directly (no active non-GM owner)');
          }
        } else {
          // 일반 유저: 항상 소켓 전송 (GM 백업 로직이 처리)
          window.DX3rdSocketRouter.emit({
            type: 'showDefenseDialog',
            dialogData: payload  // payload → dialogData로 통일
          });
          window.DX3rdDebug.log('DX3rd | Defense dialog sent via socket for:', targetActor.name);
        }
      }
      
      ui.notifications.info(`데미지 적용 다이얼로그를 ${targets.length}명의 대상에게 전송했습니다.`);
    },

    /**
     * 방어 다이얼로그 표시
     */
    showDefenseDialog: async function(payload) {
      const { targetActorId, damage, penetrate, attackResult, attackerName, attackerId, itemId } = payload;
      
      const targetActor = game.actors.get(targetActorId);
      if (!targetActor) {
        console.warn('DX3rd | Target actor not found:', targetActorId);
        return;
      }
      
      // 권한 체크
      if (!targetActor.isOwner) {
        console.warn('DX3rd | User does not own this actor');
        return;
      }
      
      // 방어 다이얼로그 데이터 준비
      // 무기 가드치는 아이템 고유 필드(system.guard)라 어트리뷰트 채널을 안 탄다.
      // 예전에는 템플릿 값을 그대로 parseInt 해서 "2d10"이면 2로 잘리고 "[레벨]"은 0이 됐다.
      // 여기서 고정치와 다이스식으로 갈라 두고, 다이스는 확인 시 가드 굴림에 합류시킨다.
      const F = window.DX3rdFormulaEvaluator;
      const weaponList = targetActor.items.filter(item => item.type === 'weapon')
        .map(weapon => {
          const raw = weapon.system.guard;
          const prepared = F.prepareRollFormula(raw, weapon, targetActor);
          const isDice = F.hasDice(prepared);
          const guardFixed = isDice ? 0 : (Number(F.evaluate(raw, weapon, targetActor)) || 0);
          return {
            id: weapon.id,
            name: weapon.name,
            guardFixed,
            guardFormula: isDice ? prepared : '',
            guardLabel: isDice ? prepared : String(guardFixed)
          };
        })
        // 가드치 높은 순(같으면 원래 순서 유지). 다이스식은 고정치가 0이라 뒤로 간다.
        .sort((a, b) => b.guardFixed - a.guardFixed);
      const guard = targetActor.system.attributes.guard?.value || 0;
      const armor = targetActor.system.attributes.armor?.value || 0;
      const reduce = targetActor.system.attributes.reduce?.value || 0;
      // 발동형 수식은 방어 창을 열 때 굴리지 않는다. 원문만 표시하고 확정 시 한 번 굴린다.
      // 굴림 필드(guard_roll/reduce_roll)와 값 필드에 직접 쓴 다이스식(valueFormula)은
      // 굴리는 시점이 같으므로 하나의 수식으로 합쳐 표시·굴림 채널을 단일화한다.
      const deferredDefenseFormula = (attrKey) => {
        const attr = targetActor.system.attributes[attrKey] || {};
        const countN = Number(attr.roll || 0);
        const fromRollField = attr.rollFormula || (countN > 0 ? `${countN}d10` : '');
        return [fromRollField, attr.valueFormula].filter(Boolean).join(' + ');
      };
      let guardRollFormula = deferredDefenseFormula('guard');
      let armorRollFormula = deferredDefenseFormula('armor');
      let reduceRollFormula = deferredDefenseFormula('reduce');
      const currentHP = targetActor.system.attributes.hp?.value || 0;
      const maxHP = targetActor.system.attributes.hp?.max || 0;

      /**
       * 체크된 무기들의 가드치를 고정분/다이스식으로 갈라 읽는다.
       * 실시간 표시(root)와 확정 계산(form)이 같은 규칙을 쓰게 한 곳에 둔다.
       * @param {Element} scope - 조회 기준 요소
       * @returns {{fixed: number, formula: string}}
       */
      const readCheckedWeaponGuard = (scope) => {
        let fixed = 0;
        const formulas = [];
        for (const checkbox of (scope?.querySelectorAll('.weapon-checkbox:checked') || [])) {
          fixed += parseInt(checkbox.dataset.guard) || 0;
          if (checkbox.dataset.guardFormula) formulas.push(`(${checkbox.dataset.guardFormula})`);
        }
        return {fixed, formula: formulas.join(' + ')};
      };

      /**
       * 방어 계산 단일 정의. 실시간 표시와 확정 계산이 같은 식을 쓰도록 한 곳에 둔다.
       * (확정 시 굴리는 다이스를 표시값에서 단순히 빼면 커버링 배수·가드 선언·장갑 관통
       *  클램프를 통과하지 못해 실제 룰과 어긋난다.)
       */
      const calcDefenseDamage = ({ guard: guardValue, weaponGuard = 0, guardChecked = true,
                                   armor: armorValue, reduce: reduceValue,
                                   covering = 0, reactionSuccess = false }) => {
        if (reactionSuccess) return 0;
        const effectiveGuard = guardChecked ? (guardValue + weaponGuard) : 0;
        // 장갑무시 적용: 장갑치는 음수가 될 수 없음
        const effectiveArmor = Math.max(0, armorValue - penetrate);
        if (covering > 0) {
          // 커버링: (데미지 - 가드 - 장갑) × (커버링수 + 1) - 경감
          const intermediateDamage = Math.max(0, damage - effectiveGuard - effectiveArmor);
          return Math.max(0, (intermediateDamage * (covering + 1)) - reduceValue);
        }
        // 일반 상황: 데미지 - 가드 - 장갑 - 경감
        return Math.max(0, damage - effectiveGuard - effectiveArmor - reduceValue);
      };

      // 실제 데미지 계산 (초기값) - 일반 상황 기준
      const realDamage = calcDefenseDamage({ guard, armor, reduce });
      const attackResultValue = Number(attackResult) || 0;
      const reactionItems = attackResultValue > 0
        ? await this.getDefenseReactionItems(targetActor)
        : [];
      
      const templateData = {
        src: targetActor.img,
        name: targetActor.name,
        damage: damage,
        realDamage: realDamage,
        life: currentHP,
        recovery: false,
        guard: guard,
        guardRollFormula,
        guardCheck: '',
        weaponList: weaponList,
        armor: armor,
        armorRollFormula,
        penetrate: penetrate,
        reduce: reduce,
        reduceRollFormula,
        attackResult: attackResultValue,
        reactionGroups: this.groupDefenseReactionItems(reactionItems),
        // 「가드를 실행할 때 선언한다」(가드 실드·프로텍트 아머 등) — 방어자의 장비다.
        declareSection: window.DX3rdDeclaredEquipment?.sectionHtml(
          window.DX3rdDeclaredEquipment.collect(targetActor, 'defense')) || ''
      };
      
      const dialogContent = await foundry.applications.handlebars.renderTemplate('systems/dx3rd-emanim/templates/dialog/defense-dialog.html', templateData);
      
      const DialogV2 = foundry.applications?.api?.DialogV2;
      if (!DialogV2) {
        ui.notifications.error(game.i18n.localize('DX3rd.DialogV2Unavailable'));
        return;
      }

      const dialog = new DialogV2({
        window: {
          title: `${game.i18n.localize('DX3rd.DefenseDamage')} (${attackerName})`
        },
        content: dialogContent,
        position: { width: 500 },
        classes: ['dx3rd-emanim', 'defense-dialog'],
        buttons: [
          {
            action: 'confirm',
            icon: '<i class="fas fa-check"></i>',
            label: game.i18n.localize('DX3rd.Confirm'),
            default: true,
            callback: async (event, button) => {
              const form = button.form;
              const num = (selector) => parseInt(form?.querySelector(selector)?.value) || 0;
              // 확정 시점에 보류된 다이스식을 각각 한 번씩 굴린다.
              const rollDeferred = async (formula, kind) => {
                if (!formula) return null;
                try {
                  return await (new Roll(formula)).evaluate();
                } catch (error) {
                  console.warn(`DX3rd | Deferred defense roll failed (${kind}): ${formula}`, error);
                  return null;
                }
              };
              const guardChecked = form?.querySelector('#guard-check')?.checked || false;
              const reactionSuccess = form?.querySelector('#reaction-success')?.checked || false;
              // 선택한 무기의 가드 다이스식도 같은 가드 굴림에 합류시킨다.
              const weaponGuard = readCheckedWeaponGuard(form);
              const guardFormula = [guardRollFormula, weaponGuard.formula].filter(Boolean).join(' + ');
              // 결과에 쓰이지 않을 굴림은 아예 하지 않는다 — 굴리면 채팅에 "가드 굴림 +9" 같은
              // 줄이 남아 실제로 깎이지 않은 값이 깎인 것처럼 보인다.
              const [guardRoll, armorRoll, reduceRoll] = reactionSuccess ? [null, null, null] : [
                await rollDeferred(guardChecked ? guardFormula : '', 'guard'),
                await rollDeferred(armorRollFormula, 'armor'),
                await rollDeferred(reduceRollFormula, 'reduce')
              ];
              // 굴린 값은 각 항에 얹어 방어식을 다시 계산한다(가드 선언/장갑 관통/커버링 배수 반영).
              const coveringValue = num('#covering');
              const finalDamage = calcDefenseDamage({
                guard: num('#guard') + (Number(guardRoll?.total) || 0),
                weaponGuard: weaponGuard.fixed,
                guardChecked,
                armor: num('#armor') + (Number(armorRoll?.total) || 0),
                reduce: num('#reduce') + (Number(reduceRoll?.total) || 0),
                covering: coveringValue,
                reactionSuccess
              });
              const newHP = Math.max(0, currentHP - finalDamage);
              const hpChange = currentHP - newHP; // 실제 HP 변동량

              await targetActor.update({
                'system.attributes.hp.value': newHP
              });

              let chatMessage = `HP-${hpChange}`;

              if (coveringValue > 0) {
                chatMessage += ` (${game.i18n.localize('DX3rd.Covering')}: ${coveringValue})`;
              }

              // 채팅 메시지 출력 (스피커는 대상 액터)
              const rollDetail = async (roll, formula, labelKey) => roll
                ? `<div class="dx3rd-roll-detail"><div>${game.i18n.localize(labelKey)}: ${formula} → +${roll.total}</div>${await roll.render()}</div>`
                : '';
              const defenseRollContent = (await rollDetail(guardRoll, guardFormula, 'DX3rd.GuardRoll'))
                + (await rollDetail(armorRoll, armorRollFormula, 'DX3rd.ArmorRoll'))
                + (await rollDetail(reduceRoll, reduceRollFormula, 'DX3rd.ReduceRoll'));
              await ChatMessage.create({
                speaker: ChatMessage.getSpeaker({ actor: targetActor }),
                content: `<div class="dx3rd-item-chat"><div>${chatMessage}</div>${defenseRollContent}</div>`,
                style: CONST.CHAT_MESSAGE_STYLES.OTHER
              });
              
              // guard 비활성화 후크 실행
              if (window.DX3rdDisableHooks) {
                await window.DX3rdDisableHooks.executeDisableHook('guard', targetActor);
              }
              
              // ===== afterDamage 익스텐드 큐 시스템 =====
              if (attackerId && itemId) {
                const extensionQueueKey = `${attackerId}_${itemId}`;
                const extensionRequest = window.DX3rdAfterDamageExtensionQueue?.[extensionQueueKey];
                
                if (extensionRequest) {
                  // 보고 기록
                  extensionRequest.damageReports[targetActor.id] = hpChange;
                  extensionRequest.reportCount++;
                  
                  window.DX3rdDebug.log('DX3rd | Extension damage report recorded:', {
                    target: targetActor.name,
                    hpChange: hpChange,
                    reportCount: extensionRequest.reportCount,
                    totalTargets: extensionRequest.targetActorIds.length
                  });
                  
                  // 모든 타겟이 보고했는지 확인
                  if (extensionRequest.reportCount === extensionRequest.targetActorIds.length) {
                    window.DX3rdDebug.log('DX3rd | All targets reported for extensions, processing...');
                    
                    // HP 데미지를 받은 타겟 목록
                    const damagedTargets = Object.entries(extensionRequest.damageReports)
                      .filter(([id, hp]) => hp >= 1)
                      .map(([id, hp]) => id);
                    
                    // targetAll/self 포함 여부 확인
                    const healTarget = extensionRequest.extensions.heal?.target;
                    const damageTarget = extensionRequest.extensions.damage?.target;
                    const statusClearTarget = extensionRequest.extensions.statusClear?.target;
                    const condList = Array.isArray(extensionRequest.extensions.condition)
                      ? extensionRequest.extensions.condition
                      : (extensionRequest.extensions.condition ? [extensionRequest.extensions.condition] : []);
                    const conditionTarget = condList[0]?.target;
                    const cardList = Array.isArray(extensionRequest.extensions.cards) ? extensionRequest.extensions.cards : [];
                    const includesSelf = healTarget === 'self' || healTarget === 'targetAll' ||
                                        damageTarget === 'self' || damageTarget === 'targetAll' ||
                                        statusClearTarget === 'self' || statusClearTarget === 'targetAll' ||
                                        conditionTarget === 'self' || conditionTarget === 'targetAll' ||
                                        cardList.some(card => card.data?.target === 'self' || card.data?.target === 'targetAll');
                    
                    // 데미지를 받은 타겟이 있거나, self를 포함하는 경우 처리
                    if (damagedTargets.length > 0 || includesSelf) {
                      const attacker = game.actors.get(attackerId);
                      const triggerItem = attacker?.items.get(itemId);
                      
                      // heal 익스텐션 처리
                      if (extensionRequest.extensions.heal) {
                        const healTiming = extensionRequest.extensions.heal.timing;
                        window.DX3rdDebug.log(`DX3rd | Processing heal extension for damaged targets (timing: ${healTiming})`);
                        
                        // healDataWithTargets 먼저 생성
                        const originalTarget = extensionRequest.extensions.heal.target;
                        const healDataWithTargets = {
                          ...extensionRequest.extensions.heal,
                          // afterDamage에서는 HP 데미지를 받은 타겟만 적용하도록 target을 조정
                          // self는 유지, targetToken/targetAll은 HP 데미지 받은 타겟만 적용
                          target: originalTarget === 'self' ? 'self' : (damagedTargets.length > 0 ? 'targetToken' : originalTarget),
                          selectedTargetIds: damagedTargets.map(actorId => {
                            const token = canvas.tokens.placeables.find(t => t.actor?.id === actorId);
                            return token?.id;
                          }).filter(id => id),
                          triggerItemName: extensionRequest.triggerItemName,
                          triggerItemId: itemId
                        };
                        
                        // afterMain 타이밍인 경우: 아이템의 runTiming이 afterDamage이면 큐에 등록, 아니면 건너뛰기
                        if (healTiming === 'afterMain') {
                          const itemRunTiming = triggerItem?.system.active?.runTiming;
                          if (itemRunTiming === 'afterDamage') {
                            // 아이템 runTiming이 afterDamage이고 익스텐드 타이밍이 afterMain이면 큐에 등록
                            await window.DX3rdUniversalHandler.addToAfterMainQueue(attacker, healDataWithTargets, triggerItem, 'heal');
                            window.DX3rdDebug.log('DX3rd | Heal extension (afterMain) registered to afterMain queue from afterDamage');
                          } else {
                            window.DX3rdDebug.log('DX3rd | Skipping afterMain heal extension in afterDamage (item runTiming is not afterDamage)');
                          }
                        } else {
                          if (window.DX3rdUniversalHandler) {
                            // afterDamage 타이밍만 즉시 실행
                            await window.DX3rdUniversalHandler.executeHealExtensionNow(attacker, healDataWithTargets, triggerItem);
                          }
                        }
                      }
                      
                      // damage 익스텐션 처리
                      if (extensionRequest.extensions.damage) {
                        const damageTiming = extensionRequest.extensions.damage.timing;
                        window.DX3rdDebug.log(`DX3rd | Processing damage extension for damaged targets (timing: ${damageTiming})`);
                        
                        // damageDataWithTargets 먼저 생성
                        const originalTarget = extensionRequest.extensions.damage.target;
                        const damageDataWithTargets = {
                          ...extensionRequest.extensions.damage,
                          // afterDamage에서는 HP 데미지를 받은 타겟만 적용하도록 target을 조정
                          // self는 유지, targetToken/targetAll은 HP 데미지 받은 타겟만 적용
                          target: originalTarget === 'self' ? 'self' : (damagedTargets.length > 0 ? 'targetToken' : originalTarget),
                          selectedTargetIds: damagedTargets.map(actorId => {
                            const token = canvas.tokens.placeables.find(t => t.actor?.id === actorId);
                            return token?.id;
                          }).filter(id => id),
                          triggerItemName: extensionRequest.triggerItemName,
                          triggerItemId: itemId
                        };
                        
                        // afterMain 타이밍인 경우: 아이템의 runTiming이 afterDamage이면 큐에 등록, 아니면 건너뛰기
                        if (damageTiming === 'afterMain') {
                          const itemRunTiming = triggerItem?.system.active?.runTiming;
                          if (itemRunTiming === 'afterDamage') {
                            // 아이템 runTiming이 afterDamage이고 익스텐드 타이밍이 afterMain이면 큐에 등록
                            await window.DX3rdUniversalHandler.addToAfterMainQueue(attacker, damageDataWithTargets, triggerItem, 'damage');
                            window.DX3rdDebug.log('DX3rd | Damage extension (afterMain) registered to afterMain queue from afterDamage');
                          } else {
                            window.DX3rdDebug.log('DX3rd | Skipping afterMain damage extension in afterDamage (item runTiming is not afterDamage)');
                          }
                        } else {
                          if (window.DX3rdUniversalHandler) {
                            // afterDamage 타이밍만 즉시 실행
                            await window.DX3rdUniversalHandler.executeDamageExtensionNow(attacker, damageDataWithTargets, triggerItem);
                          }
                        }
                      }

                      // 상태이상 해제 익스텐션 처리
                      if (extensionRequest.extensions.statusClear) {
                        const statusClearTiming = extensionRequest.extensions.statusClear.timing;
                        const originalTarget = extensionRequest.extensions.statusClear.target;
                        const statusClearDataWithTargets = {
                          ...extensionRequest.extensions.statusClear,
                          target: originalTarget === 'self' ? 'self' : (damagedTargets.length > 0 ? 'targetToken' : originalTarget),
                          selectedTargetIds: damagedTargets.map(actorId => {
                            const token = canvas.tokens.placeables.find(t => t.actor?.id === actorId);
                            return token?.id;
                          }).filter(id => id),
                          triggerItemName: extensionRequest.triggerItemName,
                          triggerItemId: itemId
                        };
                        if (statusClearTiming === 'afterMain') {
                          const itemRunTiming = triggerItem?.system.active?.runTiming;
                          if (itemRunTiming === 'afterDamage') {
                            await window.DX3rdUniversalHandler.addToAfterMainQueue(attacker, statusClearDataWithTargets, triggerItem, 'statusClear');
                          }
                        } else {
                          await window.DX3rdUniversalHandler.executeStatusClearExtension(attacker, statusClearDataWithTargets, triggerItem);
                        }
                      }
                      
                      // condition 익스텐션 처리
                      for (const condCfg of condList) {
                        const conditionTiming = condCfg.timing;
                        window.DX3rdDebug.log(`DX3rd | Processing condition extension for damaged targets (timing: ${conditionTiming}, type: ${condCfg.type})`);
                        
                        const originalTarget = condCfg.target;
                        const conditionDataWithTargets = {
                          ...condCfg,
                          // afterDamage에서는 HP 데미지를 받은 타겟만 적용하도록 target을 조정
                          // self는 유지, targetToken/targetAll은 HP 데미지 받은 타겟만 적용
                          target: originalTarget === 'self' ? 'self' : (damagedTargets.length > 0 ? 'targetToken' : originalTarget),
                          selectedTargetIds: damagedTargets.map(actorId => {
                            const token = canvas.tokens.placeables.find(t => t.actor?.id === actorId);
                            return token?.id;
                          }).filter(id => id),
                          triggerItemName: extensionRequest.triggerItemName,
                          triggerItemId: itemId
                        };
                        
                        // afterMain 타이밍인 경우: 아이템의 runTiming이 afterDamage이면 큐에 등록, 아니면 건너뛰기
                        if (conditionTiming === 'afterMain') {
                          const itemRunTiming = triggerItem?.system.active?.runTiming;
                          if (itemRunTiming === 'afterDamage') {
                            // 아이템 runTiming이 afterDamage이고 익스텐드 타이밍이 afterMain이면 큐에 등록
                            await window.DX3rdUniversalHandler.addToAfterMainQueue(attacker, conditionDataWithTargets, triggerItem, 'condition');
                            window.DX3rdDebug.log('DX3rd | Condition extension (afterMain) registered to afterMain queue from afterDamage');
                          } else {
                            window.DX3rdDebug.log('DX3rd | Skipping afterMain condition extension in afterDamage (item runTiming is not afterDamage)');
                          }
                        } else {
                          if (window.DX3rdUniversalHandler) {
                            // afterDamage 타이밍만 즉시 실행
                            await window.DX3rdUniversalHandler.executeConditionExtensionNow(attacker, conditionDataWithTargets, triggerItem);
                          }
                        }
                      }

                      // 신규 무제한 카드도 각각 독립적으로 실행한다. 같은 종류의 카드가
                      // 여러 장이어도 합쳐 덮어쓰지 않고 카드 수만큼 순서대로 처리한다.
                      for (const card of cardList) {
                        const originalTarget = card.data?.target || 'self';
                        const dataWithTargets = {
                          ...(card.data || {}),
                          target: originalTarget === 'self' ? 'self' : (damagedTargets.length > 0 ? 'targetToken' : originalTarget),
                          selectedTargetIds: damagedTargets.map(actorId => canvas.tokens.placeables.find(t => t.actor?.id === actorId)?.id).filter(Boolean),
                          triggerItemName: extensionRequest.triggerItemName,
                          triggerItemId: itemId
                        };
                        if (dataWithTargets.timing === 'afterMain') {
                          await window.DX3rdUniversalHandler.addToAfterMainQueue(attacker, dataWithTargets, triggerItem, card.type);
                        } else {
                          await window.DX3rdUniversalHandler.executeItemExtension(attacker, card.type, dataWithTargets, triggerItem);
                        }
                      }
                    } else {
                      window.DX3rdDebug.log('DX3rd | No damaged targets for extensions, skipping');
                    }
                    
                    // 요청 삭제
                    delete window.DX3rdAfterDamageExtensionQueue[extensionQueueKey];
                    window.DX3rdDebug.log('DX3rd | Extension request removed from queue');
                  }
                }
              }
              
              // ===== 기존 afterDamage 시스템 (queueIndex가 없는 경우) =====
              window.DX3rdDebug.log('DX3rd | Checking afterDamage conditions:', {
                hpChange: hpChange,
                attackerId: attackerId,
                itemId: itemId,
                hasAttackerAndItem: !!(attackerId && itemId)
              });
              
              if (attackerId && itemId) {
                window.DX3rdDebug.log('DX3rd | Reporting damage result to GM, hpChange:', hpChange);
                window.DX3rdDebug.log('DX3rd | Current user isGM:', game.user.isGM);
                
                if (game.user.isGM) {
                  // GM은 직접 큐 확인 및 처리
                  const applyQueueKey = `${targetActor.id}_${itemId}`; // 효과: 타겟 기준
                  
                  // 1. afterDamage 타겟 효과 적용
                  const applyRequest = window.DX3rdTargetApplyQueue?.[applyQueueKey];
                  if (applyRequest) {
                    window.DX3rdDebug.log('DX3rd | Found target apply request in queue:', applyRequest);
                    
                    if (hpChange >= 1) {
                      // HP 감소했으면 효과 적용
                      const sourceActor = game.actors.get(applyRequest.sourceActorId);
                      const item = sourceActor?.items.get(applyRequest.itemId);
                      
                      if (item && targetActor.isOwner) {
                        // GM이 타겟 소유자이므로 직접 적용
                        await window.DX3rdUniversalHandler._applyItemAttributes(sourceActor, item, targetActor, applyRequest.targetAttributes);
                        window.DX3rdDebug.log('DX3rd | Target effect applied directly by GM');
                      } else {
                        // 타겟 소유자에게 적용 지시
                        window.DX3rdSocketRouter.emit({
                          type: 'applyEffectToTarget',
                          payload: {
                            sourceActorId: applyRequest.sourceActorId,
                            itemId: applyRequest.itemId,
                            targetActorId: targetActor.id,
                            targetAttributes: applyRequest.targetAttributes
                          }
                        });
                        window.DX3rdDebug.log('DX3rd | Sent applyEffectToTarget to target owner');
                      }
                    } else {
                      window.DX3rdDebug.log('DX3rd | HP not decreased, skipping effect application');
                    }
                    
                    // 요청 삭제 (HP 감소 여부 무관)
                    delete window.DX3rdTargetApplyQueue[applyQueueKey];
                    window.DX3rdDebug.log('DX3rd | Target apply request removed from queue');
                  } else {
                    window.DX3rdDebug.log('DX3rd | No target apply request found for:', applyQueueKey);
                  }
                  
                  // 2. 활성화/매크로 처리 (활성화 큐 확인 및 보고 수집)
                  const activationQueueKey = `${attackerId}_${itemId}`;
                  const activationRequest = window.DX3rdAfterDamageActivationQueue?.[activationQueueKey];
                  if (activationRequest) {
                    // 보고 기록
                    activationRequest.damageReports[targetActor.id] = hpChange;
                    activationRequest.reportCount++;
                    
                    window.DX3rdDebug.log('DX3rd | Activation report recorded:', {
                      target: targetActor.name,
                      hpChange: hpChange,
                      reportCount: activationRequest.reportCount,
                      totalTargets: activationRequest.targetActorIds.length
                    });
                    
                    // 모든 타겟이 보고했는지 확인
                    if (activationRequest.reportCount === activationRequest.targetActorIds.length) {
                      window.DX3rdDebug.log('DX3rd | All targets reported, processing activation...');
                      
                      // HP 데미지를 받은 타겟 목록
                      const damagedTargets = Object.entries(activationRequest.damageReports)
                        .filter(([id, hp]) => hp > 0)
                        .map(([id, hp]) => id);
                      
                      const attacker = game.actors.get(attackerId);
                      if (!attacker) {
                        console.warn('DX3rd | Attacker not found:', attackerId);
                        return;
                      }
                      
                      const attackerItem = attacker.items.get(itemId);
                      if (!attackerItem) {
                        console.warn('DX3rd | Attacker item not found:', itemId);
                        return;
                      }
                      
                      // 💡 콤보 afterDamage 처리 (HP 데미지 발생 후)
                      const comboData = activationRequest.comboAfterDamageData;
                      if (comboData && damagedTargets.length > 0) {
                        window.DX3rdDebug.log('DX3rd | Processing combo afterDamage (HP damage occurred)');
                        // damagedTargets는 Actor ID 배열이므로 Actor 객체로 변환
                        const damagedActors = damagedTargets.map(id => game.actors.get(id)).filter(a => a);
                        await window.DX3rdUniversalHandler.processComboAfterDamage(comboData, damagedActors);
                      }
                      
                      // 1️⃣ 매크로 실행 (한 명이라도 HP 데미지 받았으면)
                      if (activationRequest.shouldExecuteMacro && damagedTargets.length > 0) {
                        if (attacker.isOwner) {
                          // GM이 공격자 소유자면 직접 실행
                          await window.DX3rdUniversalHandler.executeMacros(attackerItem, 'afterDamage');
                          window.DX3rdDebug.log('DX3rd | AfterDamage macro executed directly by GM');
                        } else {
                          // 공격자 소유자에게 실행 지시
                          window.DX3rdSocketRouter.emit({
                            type: 'executeAfterDamageMacro',
                            payload: {
                              attackerId: attackerId,
                              itemId: itemId,
                              hpChange: damagedTargets.length  // 데미지 받은 타겟 수 전달
                            }
                          });
                          window.DX3rdDebug.log('DX3rd | AfterDamage macro sent via socket');
                        }
                      }
                      
                      // 2️⃣ 활성화/효과 적용 처리
                      // 최신 아이템 상태로 횟수 체크
                      const currentItem = attacker.items.get(itemId);  // 최신 상태 다시 가져오기
                      const usedDisable = currentItem?.system?.used?.disable || 'notCheck';
                      const usedState = currentItem?.system?.used?.state || 0;
                      const usedMax = currentItem?.system?.used?.max || 0;
                      const isUsageExhausted = usedDisable !== 'notCheck' && usedState >= usedMax && usedMax > 0;
                      
                      window.DX3rdDebug.log('DX3rd | Usage check:', {
                        itemName: currentItem.name,
                        usedDisable: usedDisable,
                        usedState: usedState,
                        usedMax: usedMax,
                        isExhausted: isUsageExhausted
                      });
                      
                      // 공격자 소유자 중 접속 중인 non-GM 유저 확인
                      const attackerOwners = game.users.filter(user => 
                        !user.isGM && 
                        user.active && 
                        attacker.testUserPermission(user, "OWNER")
                      );
                      const hasActiveNonGMOwner = attackerOwners.length > 0;
                      
                      if (damagedTargets.length === 0) {
                        // 아무도 데미지 안 받음: NoDamage 알림
                        if (!hasActiveNonGMOwner) {
                          // 접속 중인 non-GM 소유자 없음: GM이 직접 표시
                          await window.DX3rdUniversalAlertDialogV2({
                            title: game.i18n.localize('DX3rd.NoDamage'),
                            content: `<p>${game.i18n.localize('DX3rd.NoDamageText')}</p>`
                          });
                          window.DX3rdDebug.log('DX3rd | No damage notification shown directly by GM');
                        } else {
                          // 공격자 소유자에게 소켓 전송
                          window.DX3rdSocketRouter.emit({
                            type: 'showNoDamageNotification',
                            payload: { attackerId: attackerId }
                          });
                          window.DX3rdDebug.log('DX3rd | No damage notification sent via socket to player');
                        }
                      } else if (isUsageExhausted && (activationRequest.shouldActivate || activationRequest.shouldApplyToTargets)) {
                        // 횟수 소진: 활성화/적용 불가, 아무 작업도 하지 않음
                        window.DX3rdDebug.log('DX3rd | Usage exhausted, skipping activation/effect application');
                      } else {
                        // 최소 한 명 데미지 받음 & 횟수 남음: 처리 지시
                        const needsConfirmation = activationRequest.needsDialog && usedDisable !== 'notCheck';
                        
                        if (needsConfirmation) {
                          // 무기/비클 + 횟수 제한 있음: 다이얼로그
                          if (!hasActiveNonGMOwner) {
                            // 접속 중인 non-GM 소유자 없음: GM이 직접 표시
                            await window.DX3rdUniversalHandler._showAfterDamageDialog(attacker, currentItem, damagedTargets, activationRequest.shouldActivate, activationRequest.shouldApplyToTargets);
                            window.DX3rdDebug.log('DX3rd | AfterDamage dialog shown directly by GM');
                          } else {
                            // 공격자 소유자에게 소켓 전송
                            window.DX3rdSocketRouter.emit({
                              type: 'showAfterDamageDialog',
                              payload: {
                                attackerId: attackerId,
                                itemId: itemId,
                                damagedTargets: damagedTargets,
                                shouldActivate: activationRequest.shouldActivate,
                                shouldApplyToTargets: activationRequest.shouldApplyToTargets
                              }
                            });
                            window.DX3rdDebug.log('DX3rd | AfterDamage dialog sent via socket to player');
                          }
                        } else {
                          // 나머지 (무기/비클 notCheck 포함): 자동 활성화
                          if (!hasActiveNonGMOwner) {
                            // 접속 중인 non-GM 소유자 없음: GM이 직접 실행
                            await window.DX3rdUniversalHandler._executeAfterDamageActivation(attacker, currentItem, damagedTargets, activationRequest.shouldActivate, activationRequest.shouldApplyToTargets);
                            window.DX3rdDebug.log('DX3rd | AfterDamage auto-activation executed directly by GM');
                          } else {
                            // 공격자 소유자에게 소켓 전송
                            window.DX3rdSocketRouter.emit({
                              type: 'executeAfterDamageActivation',
                              payload: {
                                actorId: attackerId,
                                itemId: itemId,
                                damagedTargets: damagedTargets,
                                shouldActivate: activationRequest.shouldActivate,
                                shouldApplyToTargets: activationRequest.shouldApplyToTargets
                              }
                            });
                            window.DX3rdDebug.log('DX3rd | AfterDamage auto-activation sent via socket to player');
                          }
                        }
                      }
                      
                      // 큐에서 제거
                      delete window.DX3rdAfterDamageActivationQueue[activationQueueKey];
                      window.DX3rdDebug.log('DX3rd | Activation request removed from queue');
                    }
                  }
                } else {
                  // 일반 유저는 GM에게 데미지 처리 결과 보고
                  
                  // 1. 타겟 효과 적용 보고 (항상, HP 변동량 포함)
                  window.DX3rdSocketRouter.emit({
                    type: 'reportDamageForApply',
                    payload: {
                      targetActorId: targetActor.id,
                      itemId: itemId,
                      hpChange: hpChange
                    }
                  });
                  window.DX3rdDebug.log('DX3rd | Damage result report sent to GM (effect apply):', {
                    target: targetActor.name,
                    hpChange: hpChange
                  });
                  
                  // 2. 활성화 처리용 보고 (항상, HP 변동량 포함)
                  window.DX3rdSocketRouter.emit({
                    type: 'reportDamageForActivation',
                    payload: {
                      attackerId: attackerId,
                      itemId: itemId,
                      targetActorId: targetActor.id,
                      hpChange: hpChange
                    }
                  });
                  window.DX3rdDebug.log('DX3rd | Damage result report sent to GM (activation):', {
                    target: targetActor.name,
                    hpChange: hpChange
                  });
                }
              }
              
              ui.notifications.info(`${targetActor.name}: HP ${currentHP} → ${newHP} (-${finalDamage})`);
            }
          }
        ]
      });

      await dialog.render(true);
      const root = dialog.element;
      if (!root) return;

      // Berserk 상태이상 체크 (normal, slaughter, battlelust, delusion, fear, hatred)
      const berserkActive = targetActor.system?.conditions?.berserk?.active || false;
      const berserkType = targetActor.system?.conditions?.berserk?.type || '';
      const berserkTypes = ['normal', 'slaughter', 'battlelust', 'delusion', 'fear', 'hatred'];

      if (berserkActive && berserkTypes.includes(berserkType)) {
        // 가드 입력 필드 비활성화 및 0으로 설정
        const guardInput = root.querySelector('#guard');
        if (guardInput) {
          guardInput.disabled = true;
          guardInput.value = 0;
        }

        // 가드 체크박스 비활성화 및 체크 해제
        const guardCheckbox = root.querySelector('#guard-check');
        if (guardCheckbox) {
          guardCheckbox.disabled = true;
          guardCheckbox.checked = false;
        }

        // 모든 무기 체크박스 비활성화 및 체크 해제
        root.querySelectorAll('.weapon-checkbox').forEach(checkbox => {
          checkbox.disabled = true;
          checkbox.checked = false;
        });

        // 총 가드값을 0으로 설정
        const totalGuard = root.querySelector('#total-guard');
        if (totalGuard) totalGuard.textContent = '0';

        window.DX3rdDebug.log(`DX3rd | Defense dialog - Guard/Weapon disabled due to berserk type: ${berserkType}`);
      }

      const getNumberValue = (selector) => parseInt(root.querySelector(selector)?.value) || 0;
      // 보류 다이스식을 액터에서 다시 읽어 변수와 표시를 동기화한다(방어 중 효과 발동 대응).
      const refreshDeferredFormulas = () => {
        guardRollFormula = deferredDefenseFormula('guard');
        armorRollFormula = deferredDefenseFormula('armor');
        reduceRollFormula = deferredDefenseFormula('reduce');
        const setPreview = (selector, formula) => {
          const el = root.querySelector(selector);
          if (el) el.textContent = formula ? `+ ${formula}` : '';
        };
        setPreview('#guard-formula-preview', guardRollFormula);
        setPreview('#armor-formula-preview', armorRollFormula);
        setPreview('#reduce-formula-preview', reduceRollFormula);
      };
      const getReactionSuccess = () => root.querySelector('#reaction-success')?.checked || false;
      const updateReactionStatus = (success) => {
        const status = root.querySelector('#reaction-status');
        if (status) {
          status.textContent = success
            ? game.i18n.localize('DX3rd.DefenseDodged')
            : game.i18n.localize('DX3rd.DefenseHit');
        }
      };
      const setReactionResult = (result) => {
        const value = Number(result) || 0;
        const input = root.querySelector('#reaction-result');
        if (input) input.value = value > 0 ? String(value) : '';

        const success = attackResultValue > 0 && value >= attackResultValue;
        const checkbox = root.querySelector('#reaction-success');
        if (checkbox) checkbox.checked = success;

        updateReactionStatus(success);

        updateDamage();
      };
      // 방어 중 발동한 효과(리액션 이펙트·임시 콤보)가 가드/장갑/경감을 바꿨을 수 있다.
      // 액터에서 다시 읽어 입력칸과 보류 수식을 동기화한다.
      const refreshDefenseValuesFromActor = async () => {
        await targetActor.prepareData();
        const setValue = (selector, value) => {
          const input = root.querySelector(selector);
          if (input) input.value = value;
        };
        setValue('#guard', targetActor.system.attributes.guard?.value || 0);
        setValue('#armor', targetActor.system.attributes.armor?.value || 0);
        setValue('#reduce', targetActor.system.attributes.reduce?.value || 0);
        refreshDeferredFormulas();
        updateDamage();
      };
      const updateWeaponGuard = () => {
        const {fixed, formula} = readCheckedWeaponGuard(root);
        const totalGuard = root.querySelector('#total-guard');
        if (totalGuard) totalGuard.textContent = formula ? `${fixed} + ${formula}` : String(fixed);
        return fixed;
      };

      // 실시간 데미지 계산 업데이트
      const updateDamage = () => {
        // 보류된 다이스식(가드/장갑/경감)은 여기서 굴리지 않는다 — 확인 버튼에서 한 번만 굴려
        // 같은 calcDefenseDamage 로 최종 계산한다. 그래서 표시값은 고정치 기준이다.
        const calculatedDamage = calcDefenseDamage({
          guard: getNumberValue('#guard'),
          weaponGuard: updateWeaponGuard(),
          guardChecked: root.querySelector('#guard-check')?.checked || false,
          armor: getNumberValue('#armor'),
          reduce: getNumberValue('#reduce'),
          covering: getNumberValue('#covering'),
          reactionSuccess: getReactionSuccess()
        });

        const realDamageElement = root.querySelector('#realDamage');
        if (realDamageElement) realDamageElement.textContent = String(calculatedDamage);
        const lifeElement = root.querySelector('#life');
        if (lifeElement) lifeElement.textContent = String(Math.max(0, currentHP - calculatedDamage));
      };

      // 선언형 장비: 누르면 자기 보정 AE 가 붙으므로, 리액션 이펙트를 발동했을 때와 똑같이
      // 액터에서 가드/장갑/경감을 다시 읽어 오면 된다(전용 갱신 경로를 새로 만들지 않는다).
      window.DX3rdDeclaredEquipment?.bind(root, targetActor, refreshDefenseValuesFromActor);

      // 초기 데미지 계산 (berserk로 인해 가드가 변경되었을 수 있음)
      updateDamage();

      // 무기 체크박스 변경 시 총 가드값 업데이트
      root.querySelectorAll('.weapon-checkbox').forEach(checkbox => {
        checkbox.addEventListener('change', updateDamage);
      });

      // 리셋 버튼
      root.querySelector('#reset')?.addEventListener('click', (event) => {
        event.preventDefault();
        root.querySelectorAll('.weapon-checkbox').forEach(checkbox => {
          checkbox.checked = false;
        });
        const totalGuard = root.querySelector('#total-guard');
        if (totalGuard) totalGuard.textContent = '0';
        const guardInput = root.querySelector('#guard');
        if (guardInput) guardInput.value = guard;
        const guardCheckbox = root.querySelector('#guard-check');
        if (guardCheckbox) guardCheckbox.checked = false;
        const armorInput = root.querySelector('#armor');
        if (armorInput) armorInput.value = armor;
        const reduceInput = root.querySelector('#reduce');
        if (reduceInput) reduceInput.value = reduce;
        const coveringInput = root.querySelector('#covering');
        if (coveringInput) coveringInput.value = '0';
        const reactionInput = root.querySelector('#reaction-result');
        if (reactionInput) reactionInput.value = '';
        const reactionCheckbox = root.querySelector('#reaction-success');
        if (reactionCheckbox) reactionCheckbox.checked = false;
        updateReactionStatus(false);
        updateDamage();
      });

      // 입력값 변경 시 데미지 재계산
      ['#guard', '#armor', '#reduce', '#covering'].forEach(selector => {
        root.querySelector(selector)?.addEventListener('input', updateDamage);
      });
      root.querySelector('#guard-check')?.addEventListener('change', updateDamage);
      root.querySelector('#reaction-success')?.addEventListener('change', event => {
        updateReactionStatus(event.target.checked);
        updateDamage();
      });
      root.querySelector('#reaction-result')?.addEventListener('input', event => {
        setReactionResult(event.target.value);
      });

      root.querySelector('#basic-dodge-roll')?.addEventListener('click', async (event) => {
        event.preventDefault();
        const { stat, label } = this._getDefaultDodgeRollData(targetActor);
        if (!stat) {
          ui.notifications.warn(game.i18n.localize('DX3rd.AbilityDataNotFound'));
          return;
        }

        await this.showStatRollDialog(
          targetActor,
          stat,
          label,
          'dodge',
          null,
          null,
          null,
          null,
          null,
          attackResultValue > 0 ? { type: 'number', value: attackResultValue } : null,
          false,
          false,
          ({ total }) => setReactionResult(total)
        );
      });

      // 등록된 리액션 이펙트/콤보를 그대로 발동한다.
      const useRegisteredReaction = async (itemId) => {
        const item = targetActor.items.get(itemId);
        if (!item) {
          ui.notifications.warn(game.i18n.localize('DX3rd.ItemNotFound'));
          return;
        }

        const success = await this.handleItemUse(
          targetActor.id,
          itemId,
          item.type,
          null,
          item.system?.getTarget,
          {
            predefinedDifficulty: attackResultValue > 0 ? { type: 'number', value: attackResultValue } : null,
            afterRollCallback: ({ total }) => setReactionResult(total)
          }
        );

        // 방어 중 발동한 효과가 다이스식 보정을 걸었을 수 있다. 고정치뿐 아니라
        // 확정 시 굴릴 보류 수식도 다시 읽어야 그 효과가 실제로 반영된다.
        if (success && (item.system?.roll || '-') === '-') {
          await refreshDefenseValuesFromActor();
        }
      };

      // 등록된 리액션 이펙트/콤보만으로 부족할 때, 이 자리에서 임시 콤보를 조합해 쓴다.
      // 조합 결과의 판정은 afterRollCallback 으로 리액션 달성치 칸에 그대로 돌아오고,
      // 판정 없는 가드계 이펙트는 afterUseCallback 이 가드/장갑/경감을 다시 읽어 반영한다.
      const useInstantReactionCombo = async () => {
        if (!targetActor.isOwner && !game.user.isGM) {
          ui.notifications.warn(game.i18n.localize('DX3rd.NoPermission'));
          return;
        }
        // 회피 기능이 없는 액터(에너미 등)는 능력치 판정으로 시드한다.
        const dodgeSkill = targetActor.system?.attributes?.skills?.evade ? 'evade' : 'body';
        await this.openComboBuilder(targetActor, 'skill', dodgeSkill, null, {
          rollType: 'dodge',
          getTarget: false,
          predefinedDifficulty: attackResultValue > 0 ? { type: 'number', value: attackResultValue } : null,
          afterRollCallback: ({ total }) => setReactionResult(total),
          afterUseCallback: () => refreshDefenseValuesFromActor()
        });
      };

      const reactionUseButton = root.querySelector('#reaction-item-use');
      reactionUseButton?.addEventListener('click', async (event) => {
        event.preventDefault();
        const select = root.querySelector('#reaction-item-select');
        const selected = select?.value || '';
        if (!selected) {
          ui.notifications.warn(game.i18n.localize('DX3rd.SelectReactionItem'));
          return;
        }

        // 발동이 끝날 때까지 버튼을 잠가 연타로 두 번 발동되는 것을 막는다.
        reactionUseButton.disabled = true;
        try {
          if (selected === '__instant-combo__') await useInstantReactionCombo();
          else await useRegisteredReaction(selected);
        } finally {
          reactionUseButton.disabled = false;
          if (select) select.value = '';
        }
      });
    },

    /**
     * afterDamage 다이얼로그 표시 (내부 헬퍼)
     */
    async _showAfterDamageDialog(actor, item, damagedTargets, shouldActivate, shouldApplyToTargets) {
      // 커스텀 DOM 다이얼로그 생성
      const dialogDiv = document.createElement("div");
      dialogDiv.className = "after-damage-dialog";
      dialogDiv.style.position = "fixed";
      dialogDiv.style.top = "50%";
      dialogDiv.style.left = "50%";
      dialogDiv.style.transform = "translate(-50%, -50%)";
      dialogDiv.style.background = "rgba(0, 0, 0, 0.85)";
      dialogDiv.style.color = "white";
      dialogDiv.style.padding = "20px";
      dialogDiv.style.border = "none";
      dialogDiv.style.borderRadius = "8px";
      dialogDiv.style.zIndex = "9999";
      dialogDiv.style.textAlign = "center";
      dialogDiv.style.fontSize = "16px";
      dialogDiv.style.boxShadow = "0 0 10px black";
      dialogDiv.style.minWidth = "280px";
      dialogDiv.style.cursor = "move";
      
      // 제목
      const title = document.createElement("div");
      title.textContent = `${item.name}`;
      title.style.marginBottom = "16px";
      title.style.fontSize = "1em";
      title.style.fontWeight = "bold";
      title.style.cursor = "move";
      dialogDiv.appendChild(title);
      
      // 버튼 컨테이너
      const buttonContainer = document.createElement("div");
      buttonContainer.style.display = "flex";
      buttonContainer.style.flexDirection = "column";
      buttonContainer.style.gap = "8px";
      
      // "장비 효과 사용" 버튼
      const useBtn = document.createElement("button");
      const equipText = game.i18n.localize('DX3rd.Equipment');
      const appliedText = game.i18n.localize('DX3rd.Applied');
      const useText = game.i18n.localize('DX3rd.Use');
      useBtn.textContent = `${equipText} ${appliedText} ${useText}`;
      useBtn.style.width = "100%";
      useBtn.style.height = "32px";
      useBtn.style.background = "white";
      useBtn.style.color = "black";
      useBtn.style.borderRadius = "4px";
      useBtn.style.border = "none";
      useBtn.style.fontWeight = "bold";
      useBtn.style.fontSize = "0.9em";
      useBtn.style.cursor = "pointer";
      useBtn.onclick = async () => {
        const updates = {};
        
        // 1. system.used.state 증가 (notCheck가 아닌 경우)
        const usedDisable = item.system?.used?.disable || 'notCheck';
        if (usedDisable !== 'notCheck') {
          const currentUsedState = item.system?.used?.state || 0;
          updates['system.used.state'] = currentUsedState + 1;
          window.DX3rdDebug.log('DX3rd | Used count increased on afterDamage:', currentUsedState, '→', currentUsedState + 1);
        }
        
        // 2. 활성화 (shouldActivate가 true인 경우)
        if (shouldActivate) {
          updates['system.active.state'] = true;
          window.DX3rdDebug.log('DX3rd | Item activated on afterDamage:', item.name);
        }
        
        if (Object.keys(updates).length > 0) {
          await item.update(updates);
        }
        
        // 3. HP 데미지 받은 타겟에게만 효과 적용
        if (shouldApplyToTargets) {
          for (const targetId of damagedTargets) {
            const targetActor = game.actors.get(targetId);
            if (targetActor) {
              const targetAttributes = item.system.effect?.attributes || {};
              
              if (game.user.isGM) {
                // GM이면 직접 적용
                await this._applyItemAttributes(actor, item, targetActor, targetAttributes);
              } else {
                // 일반 유저는 소켓 전송
                window.DX3rdSocketRouter.emit({
                  type: 'applyItemAttributes',
                  payload: {
                    sourceActorId: actor.id,
                    itemId: item.id,
                    targetActorId: targetId,
                    targetAttributes: targetAttributes
                  }
                });
              }
              window.DX3rdDebug.log('DX3rd | Effect applied to damaged target (dialog):', targetActor.name);
            }
          }
        }
        
        if (dialogDiv.parentNode) document.body.removeChild(dialogDiv);
      };
      buttonContainer.appendChild(useBtn);
      
      // "사용 안 함" 버튼
      const notUseBtn = document.createElement("button");
      notUseBtn.textContent = game.i18n.localize('DX3rd.NotUse');
      notUseBtn.style.width = "100%";
      notUseBtn.style.height = "32px";
      notUseBtn.style.background = "#666";
      notUseBtn.style.color = "white";
      notUseBtn.style.borderRadius = "4px";
      notUseBtn.style.border = "none";
      notUseBtn.style.fontWeight = "bold";
      notUseBtn.style.fontSize = "0.9em";
      notUseBtn.style.cursor = "pointer";
      notUseBtn.onclick = async () => {
        // 아무것도 안 함
        if (dialogDiv.parentNode) document.body.removeChild(dialogDiv);
      };
      buttonContainer.appendChild(notUseBtn);
      
      dialogDiv.appendChild(buttonContainer);
      
      // 드래그 기능
      let isDragging = false;
      let offsetX, offsetY;
      
      const onMouseDown = (e) => {
        if (e.target.tagName === 'BUTTON') return;
        isDragging = true;
        const rect = dialogDiv.getBoundingClientRect();
        offsetX = e.clientX - rect.left;
        offsetY = e.clientY - rect.top;
        dialogDiv.style.cursor = "grabbing";
        title.style.cursor = "grabbing";
      };
      
      const onMouseMove = (e) => {
        if (!isDragging) return;
        e.preventDefault();
        const newLeft = e.clientX - offsetX;
        const newTop = e.clientY - offsetY;
        dialogDiv.style.left = newLeft + "px";
        dialogDiv.style.top = newTop + "px";
        dialogDiv.style.transform = "none";
      };
      
      const onMouseUp = () => {
        if (isDragging) {
          isDragging = false;
          dialogDiv.style.cursor = "move";
          title.style.cursor = "move";
        }
      };
      
      dialogDiv.addEventListener("mousedown", onMouseDown);
      document.addEventListener("mousemove", onMouseMove);
      document.addEventListener("mouseup", onMouseUp);
      
      const cleanup = () => {
        document.removeEventListener("mousemove", onMouseMove);
        document.removeEventListener("mouseup", onMouseUp);
      };
      
      const observer = new MutationObserver((mutations) => {
        mutations.forEach((mutation) => {
          mutation.removedNodes.forEach((node) => {
            if (node === dialogDiv) {
              cleanup();
              observer.disconnect();
            }
          });
        });
      });
      
      observer.observe(document.body, { childList: true });
      document.body.appendChild(dialogDiv);
    },

    /**
     * afterDamage 자동 활성화 실행 (내부 헬퍼)
     */
    async _executeAfterDamageActivation(actor, item, damagedTargets, shouldActivate, shouldApplyToTargets) {
      const updates = {};
      
      if (shouldActivate) {
        updates['system.active.state'] = true;
        window.DX3rdDebug.log('DX3rd | Item activated on afterDamage (auto):', item.name);
      }
      
      if (Object.keys(updates).length > 0) {
        await item.update(updates);
      }
      
      // HP 데미지 받은 타겟에게만 효과 적용
      if (shouldApplyToTargets) {
        for (const targetId of damagedTargets) {
          const targetActor = game.actors.get(targetId);
          if (targetActor) {
            const targetAttributes = item.system.effect?.attributes || {};
            
            if (game.user.isGM) {
              // GM이면 직접 적용
              await this._applyItemAttributes(actor, item, targetActor, targetAttributes);
            } else {
              // 일반 유저는 소켓 전송
              window.DX3rdSocketRouter.emit({
                type: 'applyItemAttributes',
                payload: {
                  sourceActorId: actor.id,
                  itemId: item.id,
                  targetActorId: targetId,
                  targetAttributes: targetAttributes
                }
              });
            }
            window.DX3rdDebug.log('DX3rd | Effect applied to damaged target (auto):', targetActor.name);
          }
        }
      }
    },

    /**
     * 공격 롤 처리 (weapon, vehicle, 향후 psionic, effect, combo 등)
     * @param {Actor} actor - 공격하는 액터
     * @param {Item} item - 사용하는 아이템
     * @returns {boolean} - 성공 여부
     */
       handleAttackRoll: async function(actor, item, options = {}) {
        
        // 아이템의 소유자 액터를 토큰으로 선택
      let previousToken = null;
      if (actor && canvas.tokens) {
        // 현재 선택된 토큰 저장 (복원용)
        previousToken = canvas.tokens.controlled?.[0] || null;
        
        // 액터의 토큰 찾기
        const actorToken = canvas.tokens.placeables.find(t => t.actor?.id === actor.id);
        if (actorToken) {
          actorToken.control({ releaseOthers: true });
        }
      }
      
      // 대상 확인 (하이라이트 제거 전에 체크)
      const targets = Array.from(game.user.targets);
      if (targets.length === 0) {
        ui.notifications.warn(game.i18n.localize('DX3rd.SelectTarget'));
        // 이전 토큰 복원
        if (previousToken && canvas.tokens) {
          previousToken.control({ releaseOthers: true });
        }
        return false; // 하이라이트 유지하고 중단
      }
      
      // 아이템의 기능(skill) 확인
      const skillKey = item.system.skill;
      if (!skillKey || skillKey === '-') {
        const itemTypeLabel = item.type === 'weapon' ? '무기' : 
                              item.type === 'vehicle' ? '비클' : '아이템';
        ui.notifications.warn(`${itemTypeLabel}의 기능이 설정되지 않았습니다.`);
        return false;
      }
      
      // 스킬 데이터 가져오기
      let skillData = null;
      let skillName = '';
      
      // 기본 능력치인 경우
      const attributes = ['body', 'sense', 'mind', 'social'];
      if (attributes.includes(skillKey)) {
        skillData = actor.system.attributes[skillKey];
        skillName = game.i18n.localize(`DX3rd.${skillKey.charAt(0).toUpperCase() + skillKey.slice(1)}`);
      } else {
        // 스킬인 경우
        skillData = actor.system.attributes.skills?.[skillKey];
        if (skillData) {
          skillName = skillData.name;
          if (skillName && skillName.startsWith('DX3rd.')) {
            skillName = game.i18n.localize(skillName);
          }
        }
      }
      
      if (!skillData) {
        const itemTypeLabel = item.type === 'weapon' ? '무기' : 
                              item.type === 'vehicle' ? '비클' : '아이템';
        ui.notifications.warn(`${itemTypeLabel}의 기능을 찾을 수 없습니다.`);
        return false;
      }
      
       // handleItemUse에서 이미 고른 경우에는 같은 선택을 다시 묻지 않는다.
       let useCombo;
       if (options.comboMode === 'combo') useCombo = true;
       else if (options.comboMode === 'normal') useCombo = false;
       else {
         if (typeof window.DX3rdChooseRollMode !== 'function') {
           ui.notifications.error(game.i18n.localize('DX3rd.DialogV2Unavailable'));
           return false;
         }
         useCombo = await window.DX3rdChooseRollMode();
         if (useCombo === null) return true;
       }

      if (useCombo) {
        // 콤보 빌더 열기 (스킬 타입으로, 무기 아이템 전달하여 attackRoll 초기값 설정)
        await this.openComboBuilder(actor, 'skill', skillKey, item);
        // 이전 토큰 복원
        if (previousToken && canvas.tokens) {
          previousToken.control({ releaseOthers: true });
        }
      } else {
        // 무기/비클 자신의 수정치(system.add=명중 수정)를 명중판정 달성치에 반영.
        //   룰(rulebook-1-2 p121): 무기의 명중 수정은 종별에 맞는 공격 달성치에 가산.
        //   공격력(system.attack)은 데미지 단계(executeAttackRoll)에서 별도 평가되므로 여기서는
        //   플레이버 표시용일 뿐 이중계산되지 않음(executeAttackRoll은 weaponBonus를 받지 않음).
        let weaponBonus = null;
        const preparedWeaponAdd = window.DX3rdFormulaEvaluator.prepareRollFormula(item.system.add, item, actor);
        const preparedWeaponAttack = window.DX3rdFormulaEvaluator.prepareRollFormula(item.system.attack, item, actor);
        // 다이스 수정치는 시트/다이얼로그를 열 때 굴리지 않는다. 판정 버튼을 누르는
        // 순간 executeAttackRoll/executeStatRoll이 원 수식을 같은 Roll에 포함한다.
        const weaponAddIsDice = window.DX3rdFormulaEvaluator.hasDice(preparedWeaponAdd);
        const selfAdd = weaponAddIsDice ? 0 : (window.DX3rdFormulaEvaluator.evaluate(preparedWeaponAdd) || 0);
        const selfAttack = window.DX3rdFormulaEvaluator.hasDice(preparedWeaponAttack)
          ? preparedWeaponAttack
          : (window.DX3rdFormulaEvaluator.evaluate(preparedWeaponAttack) || 0);
        if (selfAdd !== 0 || selfAttack !== 0 || weaponAddIsDice) {
          weaponBonus = {
            attack: selfAttack,
            add: selfAdd,
            addFormula: weaponAddIsDice ? preparedWeaponAdd : null,
            weaponName: (item.name || '').replace(/\|\|.+$/, '').trim(),
            weaponIds: [item.id]
          };
        }
        // 판정 다이얼로그 표시 (메이저만, 무기 아이템 전달)
        this.showStatRollDialog(actor, skillData, skillName, 'major', item, previousToken, weaponBonus);
      }
      
      return true;
    },

    /**
     * 명중판정(공격 롤) 완료 후 공통 후처리.
     * 무기/비클 경로(executeAttackRoll)와 콤보/이펙트 경로(executeStatRoll 공격 분기) 양쪽에서
     * 롤 직후 호출되는 단일 지점. 명중판정 시점에 개입해야 하는 로직을 여기 모은다.
     *
     * 1) 확장 훅: `Hooks.callAll('dx3rd.attackRollComplete', {...})` — 이펙트/모듈이 명중판정
     *    완료에 개입할 수 있는 확장점(별도 이펙트 타이밍은 데이터상 존재하지 않으므로 훅으로 제공).
     * 2) 증오(hatred) 자동 회복(룰 p12): 증오 대상에게 공격을 1회 실행하면 성공 여부와 무관하게
     *    증오가 회복된다. 빗나감/펌블 시에도 데미지 버튼을 누르지 않으므로 반드시 명중판정 시점에서 해제.
     *
     * @param {Actor} actor - 공격한 액터
     * @param {Item} item - 공격 아이템
     * @param {Token[]} targets - 명중판정 대상 토큰 배열
     * @param {number} rollResult - 펌블 보정이 반영된 최종 달성치
     * @param {boolean} isFumble - 펌블 여부
     */
    async onAttackRollComplete(actor, item, targets, rollResult, isFumble) {
      try {
        // 확장점: 명중판정 완료 시점에 개입할 훅 (룰/이펙트 확장 대비)
        Hooks.callAll('dx3rd.attackRollComplete', { actor, item, targets, rollResult, isFumble });

        // 증오 자동 회복: 대상 중 hatred.target이 포함되어 있으면 해제
        const hatredActive = actor.system?.conditions?.hatred?.active || false;
        const hatredTarget = actor.system?.conditions?.hatred?.target || '';
        if (hatredActive && hatredTarget && Array.isArray(targets) && targets.length > 0) {
          const hasHatredTarget = targets.some(t => (t?.actor?.name || t?.name) === hatredTarget);
          if (hasHatredTarget) {
            await actor.toggleStatusEffect('hatred', { active: false });
            window.DX3rdDebug.log(`DX3rd | Hatred auto-cleared after attack roll against target: ${hatredTarget}`);
          }
        }
      } catch (e) {
        console.warn('DX3rd | onAttackRollComplete failed', e);
      }
    },
  });
})();
