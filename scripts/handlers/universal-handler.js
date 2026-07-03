// Universal handler - shared routines for item use/activation
(function() {
  window.DX3rdUniversalConfirmDialogV2 = async function({ title, content, defaultYes = true, yesLabel, noLabel } = {}) {
    const DialogV2 = foundry.applications?.api?.DialogV2;
    if (!DialogV2?.confirm) {
      ui.notifications.error(game.i18n.localize('DX3rd.DialogV2Unavailable'));
      return false;
    }

    return DialogV2.confirm({
      window: { title },
      content,
      yes: {
        icon: '<i class="fas fa-check"></i>',
        label: yesLabel || game.i18n.localize('DX3rd.Confirm')
      },
      no: {
        icon: '<i class="fas fa-times"></i>',
        label: noLabel || game.i18n.localize('DX3rd.Cancel')
      },
      defaultYes
    });
  };

  window.DX3rdUniversalAlertDialogV2 = async function({ title, content, label } = {}) {
    const DialogV2 = foundry.applications?.api?.DialogV2;
    if (!DialogV2?.wait) {
      ui.notifications.error(game.i18n.localize('DX3rd.DialogV2Unavailable'));
      return;
    }

    return DialogV2.wait({
      window: { title },
      content,
      buttons: [{
        action: 'confirm',
        icon: '<i class="fas fa-check"></i>',
        label: label || game.i18n.localize('DX3rd.Confirm'),
        default: true
      }]
    });
  };

  window.DX3rdUniversalHandler = {
    // AfterMain 큐 (이니셔티브 직전 실행) - 월드 설정에 저장
    get _afterMainQueue() {
      return game.settings.get('dx3rd-emanim', 'afterMainQueue') || [];
    },
    
    set _afterMainQueue(value) {
      game.settings.set('dx3rd-emanim', 'afterMainQueue', value);
    },
    /**
     * Process item usage cost (encroachment/HP) and send unified chat message.
     * @param {Actor} actor
     * @param {Item} item
     * @returns {boolean} true if usage is allowed, false if blocked
     */
    async processItemUsageCost(actor, item, options = {}) {
      const { skipMessage = false } = options;
      try {
        // 0. Pressure 상태이상 체크 (오토 타이밍 아이템의 채팅 메시지 차단)
        const pressureActive = actor.system?.conditions?.pressure?.active || false;
        if (pressureActive) {
          const runTiming = item.system?.timing || '-';
          
          // 오토 타이밍이고 예외 아이템이 아니면 채팅 메시지 생성 안 함
          if (runTiming === 'auto') {
            const exceptionItems = game.settings.get('dx3rd-emanim', 'DX3rd.PressureExceptionItems') || '';
            const exceptionList = exceptionItems.split(',').map(n => n.trim());
            
            // 아이템 이름에서 ||RubyText 제거
            let itemName = item.name;
            const rubyPattern = /^(.+)\|\|(.+)$/;
            const match = itemName.match(rubyPattern);
            if (match) {
              itemName = match[1];
            }
            
            // 예외 아이템 목록에 없으면 채팅 메시지 생성 안 함
            if (!exceptionList.includes(itemName)) {
              console.log(`DX3rd | Chat message blocked: ${itemName} has auto timing with pressure condition`);
              
              // 에러 메시지 출력
              await ChatMessage.create({
                speaker: ChatMessage.getSpeaker({ actor }),
                content: `<div class="dx3rd-item-chat"><div class="dx3rd-error"><strong>${itemName} ${game.i18n.localize('DX3rd.Use')} ${game.i18n.localize('DX3rd.Unable')}: ${game.i18n.localize('DX3rd.Pressure')}</strong></div></div>`
              });
              
              return false; // 아이템 사용 차단
            }
          }
        }
        
        // 0.1. 폭주 타입 체크 (reaction/dodge 타이밍 아이템 사용 차단)
        const berserkActive = actor.system?.conditions?.berserk?.active || false;
        const berserkType = actor.system?.conditions?.berserk?.type || '';
        const berserkTypesToBlock = ['normal', 'slaughter', 'battlelust', 'delusion', 'fear', 'hatred'];
        
        if (berserkActive && berserkTypesToBlock.includes(berserkType)) {
          const runTiming = item.system?.roll || '-';
          
          // reaction 또는 dodge 타이밍이고 예외 아이템이 아니면 사용 불가
          if (runTiming === 'reaction' || runTiming === 'dodge') {
            const exceptionItems = game.settings.get('dx3rd-emanim', 'DX3rd.BerserkReactionExceptionItems') || '';
            const exceptionList = exceptionItems.split(',').map(n => n.trim());
            
            // 아이템 이름에서 ||RubyText 제거
            let itemName = item.name;
            const rubyPattern2 = /^(.+)\|\|(.+)$/;
            const match2 = itemName.match(rubyPattern2);
            if (match2) {
              itemName = match2[1];
            }
            
            // 예외 아이템 목록에 없으면 사용 불가
            if (!exceptionList.includes(itemName)) {
              console.log(`DX3rd | Item usage blocked: ${itemName} has ${runTiming} timing with berserk condition`);
              
              // 에러 메시지 출력
              await ChatMessage.create({
                speaker: ChatMessage.getSpeaker({ actor }),
                content: `<div class="dx3rd-item-chat"><div class="dx3rd-error"><strong>${itemName} ${game.i18n.localize('DX3rd.Use')} ${game.i18n.localize('DX3rd.Unable')}: ${game.i18n.localize('DX3rd.Berserk')}</strong></div></div>`
              });
              
              return false; // 아이템 사용 차단
            }
          }
        }
        
        // 1. 콤보는 포함된 이펙트들의 사용 횟수 체크
        if (item.type === 'combo') {
          const effectIds = this.normalizeEffectIds(item);
          if (effectIds.length > 0) {
            for (const effectId of effectIds) {
              if (effectId && effectId !== '-') {
                const effect = actor.items.get(effectId);
                if (effect && effect.type === 'effect') {
                  const effectUsedDisable = effect.system.used?.disable || 'notCheck';
                  if (effectUsedDisable !== 'notCheck') {
                    const effectUsedState = effect.system.used?.state || 0;
                    const effectUsedMax = effect.system.used?.max || 0;
                    const effectUsedLevel = effect.system.used?.level || false;
                    
                    // displayMax 계산 (used.level이 체크되어 있으면 레벨 추가)
                    let effectDisplayMax = Number(effectUsedMax) || 0;
                    if (effectUsedLevel && effect.type === 'effect') {
                      // 이펙트 아이템의 경우 침식률에 따른 레벨 수정이 적용된 수치 사용
                      const baseLevel = Number(effect.system?.level?.init) || 0;
                      const upgrade = effect.system?.level?.upgrade || false;
                      let finalLevel = baseLevel;
                      
                      if (upgrade && actor.system?.attributes?.encroachment?.level) {
                        const encLevel = Number(actor.system.attributes.encroachment.level) || 0;
                        finalLevel += encLevel;
                      }
                      
                      effectDisplayMax += finalLevel;
                    }
                    
                    if (effectDisplayMax <= 0 || effectUsedState >= effectDisplayMax) {
                      // 아이템 이름에서 || 패턴 제거
                      let itemName = item.name;
                      const rubyPattern = /^(.+)\|\|(.+)$/;
                      const match = itemName.match(rubyPattern);
                      if (match) {
                        itemName = match[1];
                      }
                      
                      const errorMsg = `<div class="dx3rd-item-chat"><div class="dx3rd-error"><strong>${itemName} ${game.i18n.localize('DX3rd.Use')} ${game.i18n.localize('DX3rd.Unable')}</strong><br>포함된 이펙트 사용 횟수 소진: ${effect.name} (${effectUsedState}/${effectDisplayMax})</div></div>`;
                      
                      ChatMessage.create({
                        speaker: ChatMessage.getSpeaker({ actor }),
                        content: errorMsg,
                        style: CONST.CHAT_MESSAGE_STYLES.OTHER
                      });
                      
                      ui.notifications.warn(`${itemName}에 포함된 ${effect.name}의 사용 횟수가 소진되었습니다. (${effectUsedState}/${effectDisplayMax})`);
                      console.log('DX3rd | Combo usage blocked - included effect exhausted:', { effectName: effect.name, effectUsedState, effectUsedMax, effectUsedLevel, effectDisplayMax });
                      return false;
                    }
                  }
                }
              }
            }
          }
        }
        
        // 2. 일반 아이템 사용 횟수 제한 체크
        const usedDisable = item.system?.used?.disable || 'notCheck';
        if (usedDisable !== 'notCheck') {
          const usedState = item.system?.used?.state || 0;
          const usedMax = item.system?.used?.max || 0;
          const usedLevel = item.system?.used?.level || false;
          
          // displayMax 계산 (used.level이 체크되어 있으면 레벨 추가)
          let displayMax = Number(usedMax) || 0;
          if (usedLevel && item.type === 'effect') {
            // 이펙트 아이템의 경우 침식률에 따른 레벨 수정이 적용된 수치 사용
            const baseLevel = Number(item.system?.level?.init) || 0;
            const upgrade = item.system?.level?.upgrade || false;
            let finalLevel = baseLevel;
            
            if (upgrade && actor.system?.attributes?.encroachment?.level) {
              const encLevel = Number(actor.system.attributes.encroachment.level) || 0;
              finalLevel += encLevel;
            }
            
            displayMax += finalLevel;
          } else if (usedLevel && item.type === 'psionic') {
            // 사이오닉은 침식률 보정 없이 init만 더함
            const baseLevel = Number(item.system?.level?.init) || 0;
            displayMax += baseLevel;
          }
          
          // displayMax가 0이거나 usedState가 displayMax 이상이면 사용 불가
          if (displayMax <= 0 || usedState >= displayMax) {
            // 아이템 이름에서 || 패턴 제거
            let itemName = item.name;
            const rubyPattern = /^(.+)\|\|(.+)$/;
            const match = itemName.match(rubyPattern);
            if (match) {
              itemName = match[1]; // 메인 이름만 사용
            }
            
            const errorMsg = `<div class="dx3rd-item-chat"><div class="dx3rd-error"><strong>${itemName} ${game.i18n.localize('DX3rd.Use')} ${game.i18n.localize('DX3rd.Unable')}</strong><br>사용 횟수 소진 (${usedState}/${displayMax})</div></div>`;
            
            ChatMessage.create({
              speaker: ChatMessage.getSpeaker({ actor }),
              content: errorMsg,
              style: CONST.CHAT_MESSAGE_STYLES.OTHER
            });
            
            ui.notifications.warn(`${itemName}의 사용 횟수가 모두 소진되었습니다. (${usedState}/${displayMax})`);
            console.log('DX3rd | Item usage blocked - usage count exhausted:', { usedState, usedMax, usedLevel, displayMax });
            return false;
          }
        }
        
        // 2. 리저렉트 체크 - HP가 0보다 많으면 사용 불가, 침식률이 100 이상이면 사용 불가
        const itemExtend = item.getFlag('dx3rd-emanim', 'itemExtend') || {};
        if (itemExtend.heal?.resurrect) {
          const currentHP = Number(actor.system?.attributes?.hp?.value ?? 0);
          const currentEncroachment = Number(actor.system?.attributes?.encroachment?.value ?? 0);
          
          // 아이템 이름에서 || 패턴 제거
          let itemName = item.name;
          const rubyPattern = /^(.+)\|\|(.+)$/;
          const match = itemName.match(rubyPattern);
          if (match) {
            itemName = match[1]; // 메인 이름만 사용
          }
          
          // HP가 0보다 많으면 사용 불가
          if (currentHP > 0) {
            const errorMsg = `<div class="dx3rd-item-chat"><div class="dx3rd-error"><strong>${itemName} ${game.i18n.localize('DX3rd.Use')} ${game.i18n.localize('DX3rd.Unable')}</strong> (${game.i18n.localize('DX3rd.Current')} HP: ${currentHP})</div></div>`;
            
            ChatMessage.create({
              speaker: ChatMessage.getSpeaker({ actor }),
              content: errorMsg,
              style: CONST.CHAT_MESSAGE_STYLES.OTHER
            });
            console.log('DX3rd | Resurrect item blocked - HP is not 0:', currentHP);
            return false;
          }
          
          // 침식률이 100 이상이면 사용 불가
          if (currentEncroachment >= 100) {
            const errorMsg = `<div class="dx3rd-item-chat"><div class="dx3rd-error"><strong>${itemName} ${game.i18n.localize('DX3rd.Use')} ${game.i18n.localize('DX3rd.Unable')}</strong> (${game.i18n.localize('DX3rd.Current')} ${game.i18n.localize('DX3rd.Encroachment')}: ${currentEncroachment}%)</div></div>`;
            
            ChatMessage.create({
              speaker: ChatMessage.getSpeaker({ actor }),
              content: errorMsg,
              style: CONST.CHAT_MESSAGE_STYLES.OTHER
            });
            console.log('DX3rd | Resurrect item blocked - Encroachment is 100 or higher:', currentEncroachment);
            return false;
          }
        }
        
        // 3. system.limit 체크 - 침식률 제한 조건 확인
        const itemLimit = item.system?.limit;
        if (itemLimit && itemLimit.trim() !== '') {
          const currentEncroachment = Number(actor.system?.attributes?.encroachment?.value ?? 0);
          
          // 리저렉트 체크가 되어 있으면 limit 조건을 무시하고 무조건 침식률 100 미만일 때만 사용 가능
          const itemExtend = item.getFlag('dx3rd-emanim', 'itemExtend') || {};
          if (itemExtend.heal?.resurrect) {
            if (currentEncroachment >= 100) {
              // 아이템 이름에서 || 패턴 제거
              let itemName = item.name;
              const rubyPattern = /^(.+)\|\|(.+)$/;
              const match = itemName.match(rubyPattern);
              if (match) {
                itemName = match[1];
              }
              
              const errorMsg = `<div class="dx3rd-item-chat"><div class="dx3rd-error"><strong>${itemName} ${game.i18n.localize('DX3rd.Use')} ${game.i18n.localize('DX3rd.Unable')}</strong><br>리저렉트 아이템은 침식률 100% 미만에서만 사용 가능 (현재: ${currentEncroachment}%)</div></div>`;
              
              ChatMessage.create({
                speaker: ChatMessage.getSpeaker({ actor }),
                content: errorMsg,
                style: CONST.CHAT_MESSAGE_STYLES.OTHER
              });
              console.log('DX3rd | Resurrect item blocked - Encroachment is 100 or higher:', currentEncroachment);
              return false;
            }
          } else {
            // 일반 limit 체크 - 숫자만 추출하여 비교 (해당 값 이상일 때 사용 가능)
            const limitText = itemLimit.trim();
            const numberMatch = limitText.match(/(\d+)/);
            
            if (numberMatch) {
              const limitValue = Number(numberMatch[1]);
              
              if (currentEncroachment < limitValue) {
                // 아이템 이름에서 || 패턴 제거
                let itemName = item.name;
                const rubyPattern = /^(.+)\|\|(.+)$/;
                const match = itemName.match(rubyPattern);
                if (match) {
                  itemName = match[1];
                }
                
                const errorMsg = `<div class="dx3rd-item-chat"><div class="dx3rd-error"><strong>${itemName} ${game.i18n.localize('DX3rd.Use')} ${game.i18n.localize('DX3rd.Unable')}</strong><br>침식률 제한: ${limitValue}% 이상에서만 사용 가능 (현재: ${currentEncroachment}%)</div></div>`;
                
                ChatMessage.create({
                  speaker: ChatMessage.getSpeaker({ actor }),
                  content: errorMsg,
                  style: CONST.CHAT_MESSAGE_STYLES.OTHER
                });
                console.log('DX3rd | Item usage blocked - Encroachment below limit:', { currentEncroachment, limitValue });
                return false;
              }
            }
          }
        }
        
        // 아이템 사용 시 범위 하이라이트 큐 제거 (무기/비클 제외)
        if (item.type !== 'weapon' && item.type !== 'vehicle') {
          this.clearRangeHighlightQueue();
          
          // 다른 유저들에게도 소켓으로 전송
          game.socket.emit('system.dx3rd-emanim', {
            type: 'clearRangeHighlight'
          });
        }
        
        let costMessages = [];
        
        // 1. HP 비용 처리 (아이템 + 익스텐드 통합)
        let totalHpCost = 0;
        let hpCostRolls = [];
        
        // 1-A. 아이템 자체의 HP 코스트
        const itemHpCostRaw = String(item.system?.hp?.value ?? '0').trim();
        
        // 1-B. 익스텐드 HP 코스트 (itemExtend는 위에서 이미 선언됨)
        const extendHpCostRaw = (itemExtend.damage?.hpCostActivate && itemExtend.damage?.hpCost) 
          ? String(itemExtend.damage.hpCost).trim() 
          : '0';
        
        // 1-C. HP 코스트 목록
        const hpCostList = [
          { raw: itemHpCostRaw, source: 'item' },
          { raw: extendHpCostRaw, source: 'extend' }
        ];
        
        // 1-D. 콤보인 경우, 포함된 이펙트들의 익스텐션 HP 비용도 수집
        if (item.type === 'combo') {
          const effectIds = this.normalizeEffectIds(item);

          for (const effectId of effectIds) {
            const effectItem = actor.items.get(effectId);
            if (!effectItem) continue;
            
            const effectExtend = effectItem.getFlag('dx3rd-emanim', 'itemExtend') || {};
            const effectHpCostRaw = (effectExtend.damage?.hpCostActivate && effectExtend.damage?.hpCost) 
              ? String(effectExtend.damage.hpCost).trim() 
              : '0';
            
            if (effectHpCostRaw !== '0' && effectHpCostRaw !== '') {
              hpCostList.push({ raw: effectHpCostRaw, source: `effect:${effectItem.name}` });
            }
          }
        }
        
        // 필터: 0이 아닌 것만
        const filteredHpCostList = hpCostList.filter(c => c.raw !== '0' && c.raw !== '');
        
        
        // 1-E. 각 HP 코스트 처리
        for (const { raw, source } of filteredHpCostList) {
          const dicePattern = /(\d+)\s*d(\d*)/i;
          const isDiceFormula = dicePattern.test(raw) || /[dD]/.test(raw);
          
          let hpCost = 0;
          let displayFormula = '';
          let roll = null;
          
          if (isDiceFormula) {
            // 주사위 공식 처리
            let normalizedFormula = raw.replace(/(\d+)\s*[dD]\s*(?!\d)/g, '$1d10');
            normalizedFormula = normalizedFormula.replace(/D/g, 'd');
            
            
            roll = await new Roll(normalizedFormula).roll();
            hpCost = roll.total;
            displayFormula = normalizedFormula;
            hpCostRolls.push({ roll, formula: displayFormula, source });
          } else {
            hpCost = Number(raw) || 0;
          }
          
          totalHpCost += hpCost;
        }
        
        // 1-F. HP 부족 체크
        if (totalHpCost > 0) {
          const currentHP = Number(actor.system?.attributes?.hp?.value ?? 0);
          
          if (currentHP <= totalHpCost) {
            // HP 부족으로 사용 불가
            // 아이템 이름에서 || 패턴 제거
            let itemName = item.name;
            const rubyPattern = /^(.+)\|\|(.+)$/;
            const match = itemName.match(rubyPattern);
            if (match) {
              itemName = match[1]; // 메인 이름만 사용
            }
            
            let errorMsg = `<div class="dx3rd-item-chat"><div class="dx3rd-error"><strong>${itemName} 사용 불가</strong><br>HP 부족 (현재: ${currentHP}, 필요: ${totalHpCost})</div></div>`;
            
            // 주사위 결과가 있으면 표시
            for (const { roll, formula, source } of hpCostRolls) {
              errorMsg += `<div class="dx3rd-mt-4">HP 코스트 (${source}): ${roll.total} (${formula})</div>`;
              const diceHTML = await roll.render();
              errorMsg += `<div class="dx3rd-mt-4">${diceHTML}</div>`;
            }
            
            await ChatMessage.create({ 
              content: errorMsg, 
              speaker: ChatMessage.getSpeaker({ actor }) 
            });
            
            console.log('DX3rd | Item usage blocked: insufficient HP');
            return false; // 아이템 사용 중단
          }
          
          // HP 감소 적용
          const afterHP = currentHP - totalHpCost;
          await actor.update({ 'system.attributes.hp.value': afterHP });
          
          // 채팅 메시지에 HP 코스트 추가
          if (hpCostRolls.length > 0) {
            // 주사위 공식이 있는 경우
            for (const { roll, formula } of hpCostRolls) {
              costMessages.push(`HP -${roll.total} (${formula})`);
              const diceHTML = await roll.render();
              costMessages.push(`<div class="dx3rd-mt-4">${diceHTML}</div>`);
            }
          } else {
            // 고정 값만 있는 경우
            costMessages.push(`HP -${totalHpCost}`);
          }
          
        }
        
        // 2. 침식률 처리 (모든 아이템)
        const encAddRaw = String(item.system?.encroach?.value ?? '0').trim();
        
        if (encAddRaw !== '0' && encAddRaw !== '') {
          const dicePattern = /(\d+)\s*d(\d*)/i;
          const isDiceFormula = dicePattern.test(encAddRaw) || /[dD]/.test(encAddRaw);
          
          let encAdd = 0;
          let displayFormula = '';
          let roll = null;
          
          if (isDiceFormula) {
            // 주사위 공식 처리
            let normalizedFormula = encAddRaw.replace(/(\d+)\s*[dD]\s*(?!\d)/g, '$1d10');
            normalizedFormula = normalizedFormula.replace(/D/g, 'd');
            
            
            roll = await new Roll(normalizedFormula).roll();
            encAdd = roll.total;
            displayFormula = normalizedFormula;
          } else {
            encAdd = Number(encAddRaw) || 0;
          }
          
          const before = Number(actor.system?.attributes?.encroachment?.value ?? 0);
          const after = before + encAdd;
          
          await actor.update({ 'system.attributes.encroachment.value': after });
          
          if (isDiceFormula && displayFormula) {
            costMessages.push(`${game.i18n.localize('DX3rd.Encroachment')} +${encAdd} (${displayFormula})`);
            if (roll) {
              const diceHTML = await roll.render();
              costMessages.push(`<div class="dx3rd-mt-4">${diceHTML}</div>`);
            }
          } else {
            costMessages.push(`${game.i18n.localize('DX3rd.Encroachment')} +${encAdd}`);
          }
        }
        
        // 3. 통합 채팅 메시지 생성
        // 로이스 아이템 타입이 '-' 또는 'S'인 경우 사용 메시지를 출력하지 않음
        const isRoisWithNoMessage = item.type === 'rois' && 
                                    (item.system?.type === '-' || item.system?.type === 'S');
        
        // 아이템 이름에서 || 패턴 제거
        let itemName = item.name;
        const rubyPattern = /^(.+)\|\|(.+)$/;
        const match = itemName.match(rubyPattern);
        if (match) {
          itemName = match[1]; // 메인 이름만 사용
        }
        
        let msg = '';
        
        if (costMessages.length === 0) {
          // 비용이 없는 경우
          msg = `<div><strong>${itemName} ${game.i18n.localize('DX3rd.Use')}</strong></div>`;
        } else {
          // 비용이 있는 경우 각각 분리하여 표시
          // 다이스 롤 HTML은 별도 메시지가 아니라 같은 메시지에 포함
          let currentCostMsg = '';
          for (const costMsg of costMessages) {
            if (costMsg.startsWith('<div class="dx3rd-mt-4">')) {
              // 다이스 롤 HTML인 경우 현재 메시지에 추가
              currentCostMsg += costMsg;
            } else {
              // 새로운 비용 메시지인 경우 이전 메시지 완성하고 새로 시작
              if (currentCostMsg) {
                msg += `<div><strong>${itemName} ${game.i18n.localize('DX3rd.Use')}</strong>: ${currentCostMsg}</div>`;
              }
              currentCostMsg = costMsg;
            }
          }
          // 마지막 메시지 처리
          if (currentCostMsg) {
            msg += `<div><strong>${itemName} ${game.i18n.localize('DX3rd.Use')}</strong>: ${currentCostMsg}</div>`;
          }
        }
        
        // 콤보인 경우 구성한 이펙트들의 이름을 기본 표시 (해설)
        if (item.type === 'combo') {
          const comboEffectIds = this.normalizeEffectIds(item);
          const comboEffectNames = comboEffectIds
            .map(id => {
              const eff = actor.items.get(id);
              return eff ? eff.name.split('||')[0].trim() : null;
            })
            .filter(Boolean);
          if (comboEffectNames.length > 0) {
            msg += `<div class="dx3rd-mt-4">· ${game.i18n.localize('DX3rd.ComboEffects')}: ${comboEffectNames.join(', ')}</div>`;
          }
        }

        // getTarget이 있고 타겟이 있으면 타겟 목록 추가
        if (item.system?.getTarget) {
          const targets = Array.from(game.user.targets);
          if (targets.length > 0) {
            const targetNames = targets.map(t => t.actor?.name || t.name).filter(n => n).join(', ');
            if (targetNames) {
              msg += `<div class="dx3rd-mt-4">· ${game.i18n.localize('DX3rd.Target')}: ${targetNames}</div>`;
            }
          }
        }
        
        // skipMessage 옵션이 true이거나 로이스 타입이 '-' 또는 'S'인 경우 메시지 생성하지 않음
        if (!skipMessage && !isRoisWithNoMessage) {
          ChatMessage.create({ 
            content: `<div class="dx3rd-item-chat">${msg}</div>`, 
            speaker: {
              actor: actor.id,
              alias: actor.name
            }
          });
        }
        return true; // 아이템 사용 허용
      } catch (e) {
        console.error('DX3rd | UniversalHandler.processItemUsageCost failed', e);
        return false; // 에러 시 사용 중단
      }
    },

    /**
     * Group DX3rd item extensions by type/timing/target/parentRunTiming with custom separation.
     * This only groups data and does not execute anything.
     * Key format: `${type}|${timing}|${target}|${parentRunTiming}|${customFlag}`
     * - type: 'heal' | 'damage' | 'condition'
     * - timing: 'instant' | 'afterSuccess' | 'afterDamage' | 'afterMain'
     * - target: 'self' | 'targetToken' | 'targetAll'
     * - parentRunTiming: 부모 아이템의 runTiming (afterMain 등록 타이밍 결정)
     * - customFlag: '1' if any entry in bucket requires custom/conditional formula input, otherwise '0'
     * Each bucket contains: { type, timing, target, parentRunTiming, custom, sources: [{itemId, itemName, actorId, raw: {dice, add, options}}] }
     */
    /**
     * 콤보(또는 이펙트 참조를 가진 아이템)의 포함 이펙트 ID 목록을 정규화한다.
     * 저장 형식 우선순위: system.effectIds(신규) → system.effect.data(레거시) → system.effect(아주 오래된 배열 형식).
     * 주의: combo 스키마에서 system.effect는 { disable, runTiming, attributes } 설정 객체이므로
     * ID 목록으로 오인하지 않도록 명시적으로 걸러낸다.
     * @returns {string[]} '-'와 빈 값이 제거된 이펙트 ID 배열
     */
    normalizeEffectIds(item) {
      const sys = item?.system || {};
      let raw = sys.effectIds;
      if (raw === undefined || raw === null) raw = sys.effect?.data;
      if (raw === undefined || raw === null) raw = sys.effect;

      if (Array.isArray(raw)) {
        return raw.filter(e => e && e !== '-');
      }
      if (raw && typeof raw === 'object') {
        // system.effect 설정 객체({disable/runTiming/attributes})는 ID 목록이 아님
        if ('disable' in raw || 'runTiming' in raw || 'attributes' in raw) return [];
        return Object.values(raw)
          .map(v => (typeof v === 'string' ? v : (v?.id || null)))
          .filter(e => e && e !== '-');
      }
      if (typeof raw === 'string') {
        return (raw && raw !== '-') ? [raw] : [];
      }
      return [];
    },

    groupExtensionsByKey(extensions) {
      const buckets = new Map();
      for (const ext of extensions) {
        if (!ext || !ext.type) continue;
        const type = ext.type; // 'heal' | 'damage' | 'condition'
        const timing = ext.timing || 'instant';
        const target = ext.target || 'self';
        const parentRunTiming = ext.parentRunTiming || 'instant';
        const isCustom = !!(ext.custom || ext.conditionalFormula);

        const key = `${type}|${timing}|${target}|${parentRunTiming}|${isCustom ? '1' : '0'}`;
        if (!buckets.has(key)) {
          buckets.set(key, {
            type,
            timing,
            target,
            parentRunTiming,
            custom: isCustom,
            sources: []
          });
        }
        const bucket = buckets.get(key);
        bucket.custom = bucket.custom || isCustom;
        
        // 아이템 생성 타입은 extensionData를 직접 보존
        if (type === 'weapon' || type === 'protect' || type === 'vehicle') {
          bucket.sources.push({
            itemId: ext.itemId,
            itemName: ext.itemName,
            actorId: ext.actorId,
            raw: {
              extensionData: ext.extensionData || {}
            }
          });
        } else {
          // heal/damage/condition 타입
          bucket.sources.push({
            itemId: ext.itemId,
            itemName: ext.itemName,
            actorId: ext.actorId,
            raw: {
              dice: ext.formulaDice ?? ext.dice ?? 0,
              add: ext.formulaAdd ?? ext.add ?? 0,
              options: {
                ignoreReduce: !!ext.ignoreReduce,
                resurrect: !!ext.resurrect,
                rivival: !!ext.rivival,
                conditionType: ext.conditionType,
                conditionTypes: ext.conditionTypes || (ext.conditionType ? [ext.conditionType] : (ext.type ? [ext.type] : [])),
                poisonedRank: ext.poisonedRank || null,
                conditionalFormula: !!ext.conditionalFormula
              }
            }
          });
        }
      }
      return Array.from(buckets.values());
    },

    mergeGroupedExtensionBuckets(actor, buckets) {
      const results = [];
      for (const bucket of buckets) {
        const { type, timing, target, custom, parentRunTiming } = bucket;
        if (custom) {
          // Keep sources; caller will open a single custom dialog for this bucket
          results.push({ ...bucket, merged: null });
          continue;
        }

        if (type === 'heal' || type === 'damage') {
          let totalDice = 0;
          let totalAdd = 0;
          let hasRivival = false;
          let hasResurrect = false;
          let hasIgnoreReduce = false;
          
          for (const src of bucket.sources) {
            const { dice, add } = src.raw;
            const options = src.raw?.options || {};
            
            // rivival, resurrect, ignoreReduce는 OR 병합 (하나라도 true면 true)
            if (options.rivival) hasRivival = true;
            if (options.resurrect) hasResurrect = true;
            if (options.ignoreReduce) hasIgnoreReduce = true;
            
            // Build item context for proper [레벨] evaluation per source item
            const item = game.actors.get(src.actorId)?.items.get(src.itemId);
            const itemLevel = (item ? window.DX3rdFormulaEvaluator.getItemLevel(item) : 0) || 1;
            const itemForFormula = {
              type: item?.type || 'effect',
              system: { level: { value: itemLevel } }
            };
            // Evaluate dice/add formulas if they are strings
            let evaluatedDice = 0;
            let evaluatedAdd = 0;
            if (dice) {
              const diceStr = String(dice).trim();
              if (diceStr && diceStr !== '0') {
                evaluatedDice = window.DX3rdFormulaEvaluator.evaluate(diceStr, itemForFormula, actor);
              }
            }
            if (add || add === 0) {
              const addStr = String(add).trim();
              if (addStr && addStr !== '0') {
                evaluatedAdd = window.DX3rdFormulaEvaluator.evaluate(addStr, itemForFormula, actor);
              }
            }
            totalDice += Math.max(0, parseInt(evaluatedDice) || 0);
            totalAdd += parseInt(evaluatedAdd) || 0;
          }
          results.push({
            type, timing, target, custom: false,
            parentRunTiming,
            merged: { dice: totalDice, add: totalAdd },
            rivival: hasRivival,
            resurrect: hasResurrect,
            ignoreReduce: hasIgnoreReduce,
            sources: bucket.sources
          });
        } else if (type === 'condition') {
          const conditionSet = new Set();
          let maxPoisonedRank = 0;
          for (const src of bucket.sources) {
            const opts = src.raw?.options || {};
            const cts = opts.conditionTypes;
            if (Array.isArray(cts) && cts.length > 0) {
              cts.forEach(ct => {
                if (ct) {
                  conditionSet.add(ct);
                  // 사독 랭크 수집 및 평가 (가장 높은 랭크 선택)
                  if (ct === 'poisoned' && opts.poisonedRank) {
                    const rankFormula = opts.poisonedRank;
                    const item = game.actors.get(src.actorId)?.items.get(src.itemId);
                    const itemLevel = (item ? window.DX3rdFormulaEvaluator.getItemLevel(item) : 0) || 1;
                    const itemForFormula = {
                      type: item?.type || 'effect',
                      system: { level: { value: itemLevel } }
                    };
                    let evaluatedRank = 0;
                    if (typeof rankFormula === 'string' && /\[/.test(rankFormula)) {
                      evaluatedRank = window.DX3rdFormulaEvaluator.evaluate(rankFormula, itemForFormula, actor);
                    } else {
                      evaluatedRank = Number(rankFormula) || 0;
                    }
                    maxPoisonedRank = Math.max(maxPoisonedRank, evaluatedRank);
                  }
                }
              });
            } else {
              const ct = opts.conditionType;
              if (ct) {
                conditionSet.add(ct);
                // 사독 랭크 수집 및 평가 (가장 높은 랭크 선택)
                if (ct === 'poisoned' && opts.poisonedRank) {
                  const rankFormula = opts.poisonedRank;
                  const item = game.actors.get(src.actorId)?.items.get(src.itemId);
                  const itemLevel = (item ? window.DX3rdFormulaEvaluator.getItemLevel(item) : 0) || 1;
                  const itemForFormula = {
                    type: item?.type || 'effect',
                    system: { level: { value: itemLevel } }
                  };
                  let evaluatedRank = 0;
                  if (typeof rankFormula === 'string' && /\[/.test(rankFormula)) {
                    evaluatedRank = window.DX3rdFormulaEvaluator.evaluate(rankFormula, itemForFormula, actor);
                  } else {
                    evaluatedRank = Number(rankFormula) || 0;
                  }
                  maxPoisonedRank = Math.max(maxPoisonedRank, evaluatedRank);
                }
              }
            }
          }
          results.push({
            type, timing, target, custom: false,
            parentRunTiming,
            merged: { conditions: Array.from(conditionSet) },
            poisonedRank: maxPoisonedRank > 0 ? maxPoisonedRank : null,
            sources: bucket.sources
          });
        } else if (type === 'weapon' || type === 'protect' || type === 'vehicle') {
          // 아이템 생성 타입: 병합하지 않고 소스 그대로 반환 (각각 생성해야 함)
          results.push({
            type, timing, target, custom: false,
            parentRunTiming,
            merged: null, // 아이템 생성은 병합하지 않음
            sources: bucket.sources
          });
        } else {
          // Unknown type: pass-through
          results.push({ ...bucket, merged: null });
        }
      }
      return results;
    },

    /**
     * Process item extension effects when item is used
     * @param {Actor} actor
     * @param {Item} item
     * @param {string} timing - 'instant' | 'success' | 'damage' | null (null이면 모든 타이밍)
     */
    async processItemExtensions(actor, item, timing = null) {
      try {
        // 아이템의 익스텐션 설정 가져오기
        const itemExtend = item.getFlag('dx3rd-emanim', 'itemExtend');
        if (!itemExtend) {
          return; // 익스텐션 설정이 없으면 무시
        }

        // 연동된 아이템(부모 아이템)의 실행 타이밍 확인
        // effect, psionic, spell 등의 경우 active.runTiming 또는 roll에 따라 결정
        let parentItemTiming = 'instant'; // 기본값
        
        if (item.system?.active?.runTiming) {
          // active.runTiming이 있는 경우 (effect, psionic 등)
          parentItemTiming = item.system.active.runTiming;
        } else if (item.type === 'spell') {
          // spell의 경우: roll이 '-'면 instant, 'CastingRoll'이면 afterSuccess 매핑
          const rollType = item.system?.roll ?? '-';
          if (rollType === 'CastingRoll') {
            parentItemTiming = 'afterSuccess'; // 스펠은 afterSuccess → success로 매핑
          }
        }
        
        // afterSuccess는 success로 매핑 (스펠 발동 = 성공 시)
        if (parentItemTiming === 'afterSuccess') {
          parentItemTiming = 'success';
        }


        // 각 익스텐션 타입별 처리
        for (const [extensionType, extensionData] of Object.entries(itemExtend)) {
          console.log(`DX3rd | Extension ${extensionType}:`, {
            activate: extensionData?.activate,
            parentTiming: parentItemTiming,
            requestedTiming: timing,
            extensionTiming: extensionData?.timing
          });
          
          // condition: conditions 배열 또는 기존 단일 형식
          if (extensionType === 'condition' && extensionData) {
            const condEntries = this._getConditionEntries(extensionData);
            for (const c of condEntries) {
              if (c.activate && c.type && c.timing === timing) {
                console.log(`DX3rd | Executing condition extension - timing match: ${c.timing}, type: ${c.type}`);
                await this.executeItemExtension(actor, 'condition', c, item);
              }
            }
            continue;
          }
          
          if (extensionData && extensionData.activate) {
            // heal, damage, statusClear, encroach 익스텐션은 자체 타이밍을 따름 (부모 타이밍 무관)
            if (extensionType === 'heal' || extensionType === 'damage' || extensionType === 'statusClear' || extensionType === 'encroach') {
              const extensionTiming = extensionData.timing || 'instant';
              
              // extensionTiming과 요청된 timing이 일치하는지 확인
              if (extensionTiming === timing) {
                console.log(`DX3rd | Executing ${extensionType} extension - timing match: ${extensionTiming}`);
                await this.executeItemExtension(actor, extensionType, extensionData, item);
              } else {
                console.log(`DX3rd | Skipping ${extensionType} extension - timing mismatch: extensionTiming=${extensionTiming}, requestedTiming=${timing}`);
              }
            } else {
              // 일반 익스텐션 (weapon, protect, vehicle 등) - 부모 타이밍을 따름
              if (parentItemTiming === timing) {
                await this.executeItemExtension(actor, extensionType, extensionData, item);
              } else {
              }
            }
          } else {
          }
        }
      } catch (e) {
        console.error('DX3rd | UniversalHandler.processItemExtensions failed', e);
      }
    },

    /**
     * Execute specific item extension
     * @param {Actor} actor
     * @param {string} extensionType
     * @param {Object} extensionData
     * @param {Item} item - Source item (optional)
     */
    async executeItemExtension(actor, extensionType, extensionData, item = null) {
      try {

        let createdItems = [];
        if (extensionType === 'weapon') {
          createdItems = await this.createWeaponItems(actor, extensionData, item);
        } else if (extensionType === 'protect') {
          createdItems = await this.createProtectItem(actor, extensionData, item);
        } else if (extensionType === 'vehicle') {
          createdItems = await this.createVehicleItem(actor, extensionData, item);
        } else if (extensionType === 'heal') {
          await this.executeHealExtension(actor, extensionData, item);
          return; // heal은 아이템 생성이 아니므로 여기서 종료
        } else if (extensionType === 'damage') {
          await this.executeDamageExtension(actor, extensionData, item);
          return; // damage는 아이템 생성이 아니므로 여기서 종료
        } else if (extensionType === 'condition') {
          await this.executeConditionExtension(actor, extensionData, item);
          return; // condition은 아이템 생성이 아니므로 여기서 종료
        } else if (extensionType === 'statusClear') {
          await this.executeStatusClearExtension(actor, extensionData, item);
          return; // 상태이상 소거도 아이템 생성이 아님
        } else if (extensionType === 'encroach') {
          await this.executeEncroachExtensionNow(actor, extensionData, item);
          return; // 침식률 조정도 아이템 생성이 아님
        }
        
        // 생성된 아이템이 있으면 장비 선택 다이얼로그 표시
        if (createdItems.length > 0) {
          await this.showEquipmentSelectionDialog(actor, createdItems, extensionType);
        }
      } catch (e) {
        console.error('DX3rd | executeItemExtension failed for type:', extensionType, e);
      }
    },

    /**
     * Create weapon items from extension data
     * @param {Actor} actor
     * @param {Object} data
     * @param {Item} item - Source item (optional)
     * @returns {Array} Created items
     */
    async createWeaponItems(actor, data, item = null) {
      // 맨손 체크 처리
      if (data.fist) {
        await this.updateFistItem(actor, data, item);
        // 맨손 수정은 장비 다이얼로그 불필요 - 빈 배열 반환
        return [];
      }

      // 일반 웨폰 생성
      const amount = parseInt(data.amount) || 1;
      const itemName = `${data.name}${game.i18n.localize('DX3rd.TemporaryItem')}`;
      const createdItems = [];
      
      // 아이템의 레벨 가져오기 (없으면 1) - 침식률 보정을 동적으로 반영
      const itemLevel = (item ? window.DX3rdFormulaEvaluator.getItemLevel(item) : 0) || 1;
      const itemForFormula = { type: item?.type || 'effect', system: { level: { value: itemLevel } } };
      
      
      const evaluatedAdd = this.evaluateFormulaForExtension(data.add, itemForFormula, actor);
      const evaluatedAttack = this.evaluateFormulaForExtension(data.attack, itemForFormula, actor);
      const evaluatedGuard = this.evaluateFormulaForExtension(data.guard, itemForFormula, actor);
      const evaluatedRange = this.evaluateFormulaForExtension(data.range, itemForFormula, actor, true);

      for (let i = 0; i < amount; i++) {
        const itemData = {
          name: itemName,
          type: 'weapon',
          img: item?.img || undefined, // 원본 아이템의 이미지 사용
          system: {
            type: data.type || 'melee',
            skill: data.skill || 'melee',
            add: evaluatedAdd,
            attack: evaluatedAttack,
            guard: evaluatedGuard,
            range: evaluatedRange,
            equipment: false,
            active: {
              state: false,
              disable: 'notCheck',
              runTiming: 'instant'
            },
            used: {
              state: 0,
              max: 0,
              disable: 'notCheck'
            },
            'attack-used': {
              state: 0,
              max: 0,
              disable: 'notCheck'
            }
          }
        };

        const createdItem = await actor.createEmbeddedDocuments('Item', [itemData]);
        createdItems.push(createdItem[0]);
      }

      return createdItems;
    },

    /**
     * Update fist item from extension data
     * @param {Actor} actor
     * @param {Object} data
     * @param {Item} item - Source item (optional)
     */
    async updateFistItem(actor, data, item = null) {
      const fistName = game.i18n.localize('DX3rd.Fist');
      
      // 기존 맨손 아이템 찾기 (이름이 맨손이거나 [맨손]으로 끝나는 아이템)
      const fistItem = actor.items.find(item => 
        item.type === 'weapon' && 
        (item.name === fistName || item.name.endsWith(`[${fistName}]`))
      );

      if (fistItem) {
        // 아이템의 레벨 가져오기 (없으면 1)
        const itemLevel = (item ? window.DX3rdFormulaEvaluator.getItemLevel(item) : 0) || 1;
        const itemForFormula = { type: item?.type || 'effect', system: { level: { value: itemLevel } } };
        
        
        // 새 이름 생성: "입력된이름[맨손]"
        const newName = data.name ? `${data.name}[${fistName}]` : fistName;
        
        // 공식 평가
        const evaluatedAdd = this.evaluateFormulaForExtension(data.add, itemForFormula, actor);
        const evaluatedAttack = this.evaluateFormulaForExtension(data.attack, itemForFormula, actor);
        const evaluatedGuard = this.evaluateFormulaForExtension(data.guard, itemForFormula, actor);
        const evaluatedRange = this.evaluateFormulaForExtension(data.range, itemForFormula, actor, true);
        
        // 기존 맨손 아이템 업데이트
        await fistItem.update({
          'name': newName,
          'system.type': data.type || 'melee',
          'system.skill': data.skill || 'melee',
          'system.add': evaluatedAdd,
          'system.attack': evaluatedAttack,
          'system.guard': evaluatedGuard,
          'system.range': evaluatedRange
        });
      } else {
        // 맨손 아이템이 없으면 새로 생성
        // 아이템의 레벨 가져오기 (없으면 1)
        const itemLevel = (item ? window.DX3rdFormulaEvaluator.getItemLevel(item) : 0) || 1;
        const itemForFormula = { type: item?.type || 'effect', system: { level: { value: itemLevel } } };
        
        const newName = data.name ? `${data.name}[${fistName}]` : fistName;
        
        
        // 공식 평가
        const evaluatedAdd = this.evaluateFormulaForExtension(data.add, itemForFormula, actor);
        const evaluatedAttack = this.evaluateFormulaForExtension(data.attack, itemForFormula, actor);
        const evaluatedGuard = this.evaluateFormulaForExtension(data.guard, itemForFormula, actor);
        const evaluatedRange = this.evaluateFormulaForExtension(data.range, itemForFormula, actor, true);
        
        const itemData = {
          name: newName,
          type: 'weapon',
          img: item?.img || undefined, // 원본 아이템의 이미지 사용
          system: {
            type: data.type || 'melee',
            skill: data.skill || 'melee',
            add: evaluatedAdd,
            attack: evaluatedAttack,
            guard: evaluatedGuard,
            range: evaluatedRange,
            equipment: false,
            active: {
              state: false,
              disable: 'notCheck',
              runTiming: 'instant'
            },
            used: {
              state: 0,
              max: 0,
              disable: 'notCheck'
            },
            'attack-used': {
              state: 0,
              max: 0,
              disable: 'notCheck'
            }
          }
        };

        await actor.createEmbeddedDocuments('Item', [itemData]);
      }
    },

    /**
     * Create protect item from extension data
     * @param {Actor} actor
     * @param {Object} data
     * @param {Item} item - Source item (optional)
     * @returns {Array} Created items
     */
    async createProtectItem(actor, data, item = null) {
      const itemName = `${data.name}${game.i18n.localize('DX3rd.TemporaryItem')}`;
      
      // 아이템의 레벨 가져오기 (없으면 1) - 침식률 보정을 동적으로 반영
      const itemLevel = (item ? window.DX3rdFormulaEvaluator.getItemLevel(item) : 0) || 1;
      const itemForFormula = { type: item?.type || 'effect', system: { level: { value: itemLevel } } };
      
      
      const evaluatedDodge = this.evaluateFormulaForExtension(data.dodge, itemForFormula, actor);
      const evaluatedInit = this.evaluateFormulaForExtension(data.init, itemForFormula, actor);
      const evaluatedArmor = this.evaluateFormulaForExtension(data.armor, itemForFormula, actor);

      const itemData = {
        name: itemName,
        type: 'protect',
        img: item?.img || undefined, // 원본 아이템의 이미지 사용
        system: {
          dodge: evaluatedDodge,
          init: evaluatedInit,
          armor: evaluatedArmor,
          equipment: false,
          active: {
            state: false,
            disable: 'notCheck',
            runTiming: 'instant'
          },
          used: {
            state: 0,
            max: 0,
            disable: 'notCheck'
          }
        }
      };

      const createdItem = await actor.createEmbeddedDocuments('Item', [itemData]);
      return [createdItem[0]];
    },

    /**
     * Create vehicle item from extension data
     * @param {Actor} actor
     * @param {Object} data
     * @param {Item} item - Source item (optional)
     * @returns {Array} Created items
     */
    async createVehicleItem(actor, data, item = null) {
      const itemName = `${data.name}${game.i18n.localize('DX3rd.TemporaryItem')}`;
      
      // 아이템의 레벨 가져오기 (없으면 1) - 침식률 보정을 동적으로 반영
      const itemLevel = (item ? window.DX3rdFormulaEvaluator.getItemLevel(item) : 0) || 1;
      const itemForFormula = { type: item?.type || 'effect', system: { level: { value: itemLevel } } };
      
      
      const evaluatedAttack = this.evaluateFormulaForExtension(data.attack, itemForFormula, actor);
      const evaluatedInit = this.evaluateFormulaForExtension(data.init, itemForFormula, actor);
      const evaluatedArmor = this.evaluateFormulaForExtension(data.armor, itemForFormula, actor);
      const evaluatedMove = this.evaluateFormulaForExtension(data.move, itemForFormula, actor);

      const itemData = {
        name: itemName,
        type: 'vehicle',
        img: item?.img || undefined, // 원본 아이템의 이미지 사용
        system: {
          skill: data.skill || 'melee',
          attack: evaluatedAttack,
          init: evaluatedInit,
          armor: evaluatedArmor,
          move: evaluatedMove,
          equipment: false,
          active: {
            state: false,
            disable: 'notCheck',
            runTiming: 'instant'
          },
          used: {
            state: 0,
            max: 0,
            disable: 'notCheck'
          }
        }
      };

      const createdItem = await actor.createEmbeddedDocuments('Item', [itemData]);
      return [createdItem[0]];
    },

    /**
     * Evaluate formula for item extension
     * @param {string} formula - Formula to evaluate
     * @param {Object} dummyItem - Dummy item with level=1
     * @param {Actor} actor - Actor for context
     * @returns {string} Evaluated value as string
     */
    evaluateFormulaForExtension(formula, dummyItem, actor, isRangeField = false) {
      try {
        // 빈 값 처리
        if (!formula || formula === '' || formula === '-') {
          return '0';
        }
        
        // Range 필드의 경우 문자열(예: "접촉", "무제한") 그대로 반환
        if (isRangeField && isNaN(Number(formula))) {
          return formula;
        }
        
        // 이미 숫자인 경우 문자열로 변환해서 반환
        if (typeof formula === 'number') {
          return String(formula);
        }
        
        // FormulaEvaluator를 사용하여 공식 평가
        const evaluated = window.DX3rdFormulaEvaluator.evaluate(formula, dummyItem, actor);
        
        // 결과를 문자열로 변환 (부호 유지)
        const result = evaluated >= 0 ? `+${evaluated}` : String(evaluated);
        
        return result;
      } catch (e) {
        console.error('DX3rd | evaluateFormulaForExtension failed', e);
        return '0';
      }
    },

    /**
     * Show equipment selection dialog after creating items
     * @param {Actor} actor
     * @param {Array} createdItems - Array of created item data
     * @param {string} itemType - 'weapon', 'protect', or 'vehicle'
     */
    async showEquipmentSelectionDialog(actor, createdItems, itemType) {
      try {
        // 해당 타입의 모든 아이템 가져오기
        const allItems = actor.items.filter(item => item.type === itemType);
        
        // 정렬: 현재 장비 → 새 아이템 → 기존 아이템
        const sortedItems = this.sortItemsForEquipmentDialog(allItems, createdItems);
        
        // 다이얼로그 데이터 준비
        const dialogData = {
          actor: actor,
          items: sortedItems || [],
          createdItemIds: createdItems.map(item => item.id) || [],
          itemType: itemType || 'weapon',
          title: this.getEquipmentDialogTitle(itemType) || 'Equipment Selection'
        };


        // 다이얼로그 표시 및 완료 대기
        const dialog = new DX3rdEquipmentSelectionDialog(dialogData);
        dialog.render(true);
        
        // 다이얼로그가 닫힐 때까지 대기
        const result = await dialog.promise;
        console.log('DX3rd | Equipment selection dialog completed:', result);
        return result;
      } catch (e) {
        console.error('DX3rd | showEquipmentSelectionDialog failed', e);
        return { confirmed: false };
      }
    },

    /**
     * Sort items for equipment dialog display
     * @param {Array} allItems
     * @param {Array} createdItems
     * @returns {Array} Sorted items
     */
    sortItemsForEquipmentDialog(allItems, createdItems) {
      const createdIds = createdItems.map(item => item.id);
      
      return allItems.sort((a, b) => {
        const aIsEquipped = a.system.equipment;
        const bIsEquipped = b.system.equipment;
        const aIsCreated = createdIds.includes(a.id);
        const bIsCreated = createdIds.includes(b.id);
        
        // 1. 현재 장비 중인 아이템
        if (aIsEquipped && !bIsEquipped) return -1;
        if (!aIsEquipped && bIsEquipped) return 1;
        
        // 2. 새로 생성한 아이템
        if (aIsCreated && !bIsCreated) return -1;
        if (!aIsCreated && bIsCreated) return 1;
        
        // 3. 나머지는 기존 정렬 (이름순)
        return a.name.localeCompare(b.name);
      });
    },

    /**
     * Get equipment dialog title based on item type
     * @param {string} itemType
     * @returns {string} Localized title
     */
    getEquipmentDialogTitle(itemType) {
      const titles = {
        'weapon': 'DX3rd.Weapon',
        'protect': 'DX3rd.Protect', 
        'vehicle': 'DX3rd.Vehicle'
      };
      return game.i18n.localize(titles[itemType] || 'DX3rd.Item');
    },

    /**
     * @deprecated Use processItemUsageCost instead
     */
    async addEncroachment(actor, item) {
      await this.processItemUsageCost(actor, item);
    },

    /**
     * Ensure an item becomes active when allowed by its disable setting.
     * Rule: if system.active.disable !== 'notCheck' then set system.active.state = true
     * Optionally re-render the owning actor sheet.
     * @param {Item} item
     * @param {Actor} [actor]
     */
    async ensureActivated(item, actor) {
      try {
        const activeDisable = item?.system?.active?.disable ?? '-';
        if (activeDisable !== 'notCheck') {
          await item.update({ 'system.active.state': true });
          if (actor?.sheet?.rendered) actor.sheet.render(true);
        }
      } catch (e) {
        console.error('DX3rd | UniversalHandler.ensureActivated failed', e);
      }
    },

    /**
     * Execute macros from item.system.macro field in sequence.
     * Macros should be formatted as [매크로1][매크로2]...
     * @param {Item} item
     * @param {string} timing - 실행 타이밍 ('instant', 'afterSuccess', 'afterHits', 'afterDamage')
     */
    async executeMacros(item, timing = 'instant') {
      try {
        const macroField = item.system?.macro;
        const macroMatches = (macroField && typeof macroField === 'string') ? (macroField.match(/\[([^\]]+)\]/g) || []) : [];
        // 임베드 매크로: system.macros = [{ timing, command, disabled? }, ...] (컴펜디움 자체완결, 이름참조 불필요)
        const embedded = Array.isArray(item.system?.macros) ? item.system.macros : [];
        const embeddedHits = embedded.filter(m => m && m.command && !m.disabled && (m.timing || 'instant') === timing);
        if (macroMatches.length === 0 && embeddedHits.length === 0) return;

        // 아이템의 소유자 액터를 토큰으로 선택
        const ownerActor = item.actor;
        let previousToken = null;
        let ownerToken = null;

        if (ownerActor) {
          // 현재 선택된 토큰 저장 (복원용)
          previousToken = canvas.tokens?.controlled?.[0] || null;

          // 액터의 토큰 찾기
          ownerToken = canvas.tokens?.placeables.find(t => t.actor?.id === ownerActor.id) || null;
          if (ownerToken) {
            ownerToken.control({ releaseOthers: true });
          }
        }

        // (1) 이름참조 월드 매크로 (기존 동작)
        for (const match of macroMatches) {
          const macroName = match.slice(1, -1); // [매크로명] -> 매크로명
          const macro = game.macros?.getName(macroName);
          if (macro) {
            // 매크로의 실행 타이밍 확인 (flags에서 가져오기)
            const macroTiming = macro.getFlag('dx3rd-emanim', 'runTiming') || 'instant';

            // 타이밍이 일치하는 경우에만 실행
            if (macroTiming === timing) {
              try {
                await macro.execute();
              } catch (e) {
                console.error(`DX3rd | UniversalHandler macro execution failed: ${macroName}`, e);
              }
            } else {
            }
          } else {
            console.warn(`DX3rd | UniversalHandler macro not found: ${macroName}`);
          }
        }

        // (2) 임베드 매크로 (아이템에 코드가 박혀 있어 컴펜디움 드래그 시 그대로 작동)
        // 컨텍스트: actor(소유자), item(이 아이템), token(소유자 토큰), scope(타이밍 등)
        for (const em of embeddedHits) {
          try {
            const AsyncFunction = foundry.utils?.AsyncFunction || Object.getPrototypeOf(async function () {}).constructor;
            const fn = new AsyncFunction('actor', 'item', 'token', 'scope', em.command);
            await fn.call(item, ownerActor, item, ownerToken, { timing });
          } catch (e) {
            console.error(`DX3rd | UniversalHandler embedded macro failed (${item.name} @${timing})`, e);
          }
        }

        // 이전에 선택된 토큰으로 복원
        if (previousToken && canvas.tokens) {
          previousToken.control({ releaseOthers: true });
        }
      } catch (e) {
        console.error('DX3rd | UniversalHandler.executeMacros failed', e);
      }
    },

    /**
     * 배드 스테이터스(상태이상) 소거 헬퍼. 임베드 매크로에서 한 줄로 호출.
     * @param {Actor} actor - 대상 액터
     * @param {object} opts
     * @param {number} [opts.count=Infinity] - 최대 소거 개수("N개까지" 표현)
     * @param {string[]} [opts.exclude=['berserk']] - 소거 제외 상태("[폭주] 이외" 표현; 폭주 포함 소거면 [] 전달)
     * @param {boolean} [opts.prompt=true] - 보유 상태가 count보다 많으면 선택 다이얼로그 표시
     * @returns {Promise<number>} 실제 소거한 개수
     */
    async removeBadStatuses(actor, { count = Infinity, exclude = ['berserk'], prompt = true } = {}) {
      try {
        if (!actor) return 0;
        const BAD = ['poisoned', 'hatred', 'fear', 'berserk', 'rigor', 'pressure', 'dazed'];
        const excl = new Set(exclude || []);
        const pool = BAD.filter(s => !excl.has(s) && actor.effects.find(e => e.statuses?.has(s)));
        if (pool.length === 0) return 0;
        let chosen = pool;
        if (pool.length > count) {
          chosen = prompt ? await this._promptBadStatusChoice(pool, count) : pool.slice(0, count);
          if (!chosen || chosen.length === 0) return 0; // 취소
        }
        for (const s of chosen) await actor.toggleStatusEffect(s, { active: false });
        return chosen.length;
      } catch (e) {
        console.error('DX3rd | removeBadStatuses failed', e);
        return 0;
      }
    },

    /** 소거할 배드 스테이터스를 플레이어가 고르는 다이얼로그(최대 count개). */
    async _promptBadStatusChoice(pool, count) {
      const DialogV2 = foundry.applications?.api?.DialogV2;
      if (!DialogV2?.wait) {
        ui.notifications.error(game.i18n.localize('DX3rd.DialogV2Unavailable'));
        return [];
      }

      const labelKey = { poisoned: 'Poisoned', hatred: 'Hatred', fear: 'Fear', berserk: 'Berserk', rigor: 'Rigor', pressure: 'Pressure', dazed: 'Dazed' };
      const rows = pool.map(s => `<label style="display:block;"><input type="checkbox" name="${s}"> ${game.i18n.localize('DX3rd.' + labelKey[s])}</label>`).join('');
      const content = `<p>${game.i18n.localize('DX3rd.Remove') || '소거'} (최대 ${count})</p>${rows}`;
      return await DialogV2.wait({
        window: { title: game.i18n.localize('DX3rd.Status') || '배드 스테이터스 소거' },
        content,
        rejectClose: false,
        buttons: [
          {
            action: 'ok',
            label: 'OK',
            default: true,
            callback: (event, button) => {
              const form = button.form;
              const picked = pool.filter(s => form?.querySelector(`input[name="${s}"]`)?.checked);
              return picked.slice(0, count);
            }
          },
          {
            action: 'cancel',
            label: 'Cancel',
            callback: () => []
          }
        ],
        close: () => []
      });
    },

    /**
     * 현재 지정된 타겟(game.user.targets)들의 배드 스테이터스를 소거. 임베드 매크로에서 한 줄로 호출.
     * 타겟 액터를 직접 수정할 권한이 있으면 즉시 소거하고, 없으면 GM에게 socket으로 위임한다.
     * (대상측 토큰 변경은 GM 권한이 필요 — conditionRequest와 동일한 패턴)
     * @param {object} opts removeBadStatuses와 동일(count/exclude). prompt는 권한 보유측에서 처리.
     * @returns {Promise<number>} 직접 소거한 개수(socket 위임분은 미포함)
     */
    async removeBadStatusesOnTargets({ count = Infinity, exclude = ['berserk'] } = {}) {
      try {
        const targets = Array.from(game.user?.targets ?? []);
        if (targets.length === 0) {
          ui.notifications?.warn(game.i18n.localize('DX3rd.NoTarget') || '대상을 지정하세요.');
          return 0;
        }
        let removed = 0;
        const serialCount = Number.isFinite(count) ? count : null; // Infinity는 직렬화 불가 → null
        for (const t of targets) {
          const actor = t.actor;
          if (!actor) continue;
          if (actor.isOwner) {
            removed += await this.removeBadStatuses(actor, { count, exclude });
          } else {
            game.socket.emit('system.dx3rd-emanim', {
              type: 'removeConditionRequest',
              data: { userId: game.user.id, targetUuid: actor.uuid, count: serialCount, exclude },
            });
          }
        }
        return removed;
      } catch (e) {
        console.error('DX3rd | removeBadStatusesOnTargets failed', e);
        return 0;
      }
    },

    /**
     * 자기 부활 헬퍼: [전투불능](defeated) 소거 + HP를 hpTo점까지 회복(+선택적 침식 상승). 임베드 매크로용.
     * "HP를 N점까지 회복"은 현재 HP가 N보다 낮을 때만 N으로 올린다(상한은 max).
     * @param {Actor} actor
     * @param {object} opts
     * @param {number} [opts.hpTo=1] - 회복 목표 HP("[LV×10]점까지" 등; 매크로에서 평가해 숫자로 전달)
     * @param {number} [opts.encroach=0] - 부작용 침식률 상승치
     * @returns {Promise<boolean>}
     */
    async reviveSelf(actor, { hpTo = 1, encroach = 0 } = {}) {
      try {
        if (!actor) return false;
        const defeated = actor.effects.find(e => e.statuses?.has('defeated'));
        if (defeated) await actor.toggleStatusEffect('defeated', { active: false });
        const hp = actor.system.attributes?.hp ?? { value: 0, max: 0 };
        const target = Math.min(Number(hpTo) || 1, hp.max);
        const update = {};
        if (hp.value < target) update['system.attributes.hp.value'] = target;
        if (encroach) {
          const enc = actor.system.attributes?.encroachment?.value ?? 0;
          update['system.attributes.encroachment.value'] = enc + Number(encroach);
        }
        if (Object.keys(update).length) await actor.update(update);
        return true;
      } catch (e) {
        console.error('DX3rd | reviveSelf failed', e);
        return false;
      }
    },

    /**
     * D로이스 발동 헬퍼(티투스화 시점): 침식률 상승 + 판정보정 applied 버프. 임베드 매크로용.
     * @param {Actor} actor
     * @param {object} opts
     * @param {number|string} [opts.encroach] - 침식률 상승치(숫자 또는 "1d10" 등 다이스식; 다이스면 굴려서 채팅)
     * @param {object} [opts.applied] - applied 버프 {key, name, disable, img, attributes}. attributes는 이펙트 applied와 동일(critical/major_critical/add/dice/critical_min/stat_bonus_* 등).
     * @returns {Promise<void>}
     */
    async roisActivate(actor, { encroach = null, applied = null } = {}) {
      try {
        if (!actor) return;
        // 1) 침식률 상승(숫자 또는 다이스식)
        if (encroach !== null && encroach !== undefined && `${encroach}`.trim() !== '' && `${encroach}`.trim() !== '-') {
          const raw = `${encroach}`.trim();
          let amt = 0;
          if (/^\d+$/.test(raw)) amt = parseInt(raw, 10);
          else {
            const roll = await new Roll(raw).roll();
            await roll.toMessage({ speaker: ChatMessage.getSpeaker({ actor }), flavor: (game.i18n.localize('DX3rd.Encroachment') || '침식률') + ' +' });
            amt = roll.total;
          }
          if (amt) {
            const cur = actor.system.attributes?.encroachment?.value ?? 0;
            await actor.update({ 'system.attributes.encroachment.value': cur + amt });
          }
        }
        // 2) 판정보정 applied 버프
        if (applied && applied.attributes && Object.keys(applied.attributes).length) {
          const key = `rois_${applied.key || Date.now()}`;
          await actor.update({ [`system.attributes.applied.${key}`]: {
            name: applied.name || 'D로이스', source: actor.name,
            disable: applied.disable || 'roll', img: applied.img || 'icons/svg/aura.svg',
            attributes: applied.attributes,
          }});
        }
      } catch (e) {
        console.error('DX3rd | roisActivate failed', e);
      }
    },

    /** GM측: 대상 액터의 배드 스테이터스 소거 요청 처리(권한 없는 플레이어가 socket으로 위임). */
    async handleRemoveConditionRequest(data) {
      if (!game.user.isGM) return;
      try {
        const actor = await fromUuid(data.targetUuid);
        const targetActor = actor?.actor ?? actor; // TokenDocument면 .actor
        if (!targetActor) {
          console.warn('DX3rd | handleRemoveConditionRequest: target not found', data.targetUuid);
          return;
        }
        const count = (data.count === null || data.count === undefined) ? Infinity : data.count;
        await this.removeBadStatuses(targetActor, { count, exclude: data.exclude ?? ['berserk'] });
      } catch (e) {
        console.error('DX3rd | handleRemoveConditionRequest failed', e);
      }
    },

    /**
     * Execute macros from a macro field string.
     * @param {string} macroField
     * @param {string} timing - 실행 타이밍 ('instant', 'afterSuccess', 'afterHits', 'afterDamage')
     */
    async executeMacrosByField(macroField, timing = 'instant') {
      try {
        if (!macroField || typeof macroField !== 'string') return;

        const macroMatches = macroField.match(/\[([^\]]+)\]/g);
        if (!macroMatches || macroMatches.length === 0) return;

        for (const match of macroMatches) {
          const macroName = match.slice(1, -1);
          const macro = game.macros?.getName(macroName);
          if (macro) {
            // 매크로의 실행 타이밍 확인 (flags에서 가져오기)
            const macroTiming = macro.getFlag('dx3rd-emanim', 'runTiming') || 'instant';
            
            // 타이밍이 일치하는 경우에만 실행
            if (macroTiming === timing) {
              try {
                await macro.execute();
              } catch (e) {
                console.error(`DX3rd | UniversalHandler macro execution failed: ${macroName}`, e);
              }
            } else {
            }
          } else {
            console.warn(`DX3rd | UniversalHandler macro not found: ${macroName}`);
          }
        }
      } catch (e) {
        console.error('DX3rd | UniversalHandler.executeMacrosByField failed', e);
      }
    },

    /**
     * Apply item effects to targeted actors if conditions are met.
     * Conditions: system.getTarget is true AND system.effect.disable !== 'notCheck'
     * @param {Actor} actor - The actor using the item
     * @param {Item} item - The item being used
     * @param {string} timing - 실행 타이밍 ('instant', 'afterSuccess', 'afterDamage')
     * @param {Array} forcedTargets - 강제 타겟 배열 (선택적, Actor 객체 배열)
     */
    async applyToTargets(actor, item, timing = 'instant', forcedTargets = null) {
      try {
        
        // getTarget 또는 scene 중 하나라도 체크되어 있는지 확인
        const getTarget = item.system?.getTarget || false;
        const scene = item.system?.scene || false;
        if (!getTarget && !scene) return;

        // effect.runTiming 확인 (기본값은 '-')
        const effectRunTiming = item.system?.effect?.runTiming ?? '-';
        
        // runTiming이 '-'가 아닌 경우, 타이밍이 일치하는지 확인
        if (effectRunTiming !== '-' && effectRunTiming !== timing) {
          return;
        }

        // effect.disable이 notCheck인 경우 applied 되지 않아야 함
        const effectDisable = item.system?.effect?.disable || '-';
        if (effectDisable === 'notCheck') {
          return;
        }

        // 대상 탭의 어트리뷰트 가져오기 (비어있어도 계속 진행)
        const targetAttributes = item.system.effect?.attributes || {};

        let targetActors = [];
        
        // forcedTargets가 있으면 우선 사용
        if (forcedTargets && Array.isArray(forcedTargets) && forcedTargets.length > 0) {
          targetActors = forcedTargets;
        }
        // scene이 체크되어 있으면 현재 씬의 모든 토큰 액터에 적용
        else if (scene) {
          const currentScene = game.scenes.active;
          if (currentScene) {
            // canvas.tokens가 있으면 렌더링된 토큰에서 가져오기 (현재 보이는 씬)
            if (canvas && canvas.tokens) {
              targetActors = canvas.tokens.placeables.map(t => t.actor).filter(a => a);
            } else {
              // canvas가 없으면 씬 데이터에서 가져오기
              targetActors = Array.from(currentScene.tokens).map(t => t.actor).filter(a => a);
            }
          }
        } else if (getTarget) {
          // getTarget이 체크되어 있으면 현재 타겟 사용
          const targets = Array.from(game.user.targets);
          if (targets.length === 0) {
            ui.notifications.warn('타겟을 지정해주세요.');
            return;
          }
          
          targetActors = targets.map(t => t.actor).filter(a => a);
          if (targetActors.length === 0) {
            ui.notifications.warn('유효한 타겟을 찾을 수 없습니다.');
            return;
          }
        }

        // 타이밍에 따른 처리 분기
        if (timing === 'afterDamage' && !forcedTargets) {
          // afterDamage: 등록 후 대기 (데미지 받은 타겟에게만 적용)
          // 단, forcedTargets가 있으면 즉시 적용 (이미 데미지 받은 타겟)
          for (const targetActor of targetActors) {
            if (game.user.isGM) {
              // GM은 직접 큐에 등록
              const queueKey = `${targetActor.id}_${item.id}`;
              window.DX3rdTargetApplyQueue[queueKey] = {
                sourceActorId: actor.id,
                itemId: item.id,
                targetActorId: targetActor.id,
                targetAttributes: targetAttributes,
                timestamp: Date.now()
              };
              console.log('DX3rd | GM registered target apply (afterDamage):', {
                queueKey: queueKey,
                target: targetActor.name
              });
            } else {
              // 일반 유저는 GM에게 등록 요청
              game.socket.emit('system.dx3rd-emanim', {
                type: 'registerTargetApply',
                payload: {
                  sourceActorId: actor.id,
                  itemId: item.id,
                  targetActorId: targetActor.id,
                  targetAttributes: targetAttributes
                }
              });
              console.log('DX3rd | Target apply registration sent to GM (afterDamage):', targetActor.name);
            }
          }
        } else {
          // instant, afterSuccess, 또는 forcedTargets가 있는 afterDamage: 즉시 적용
          for (const targetActor of targetActors) {
            if (game.user.isGM) {
              // GM은 직접 적용
              await this._applyItemAttributes(actor, item, targetActor, targetAttributes);
            } else {
              // 일반 유저는 소켓으로 전송
              const payload = {
                sourceActorId: actor.id,
                itemId: item.id,
                targetActorId: targetActor.id,
                targetAttributes: targetAttributes
              };
              
              game.socket.emit('system.dx3rd-emanim', {
                type: 'applyItemAttributes',
                payload: payload
              });
              console.log('DX3rd | Apply attributes request sent via socket for:', targetActor.name);
            }
          }
        }
      } catch (e) {
        console.error('DX3rd | UniversalHandler.applyToTargets failed', e);
      }
    },

    /**
     * Internal: Apply item attributes to a single target actor.
     * @param {Actor} actor - The actor using the item
     * @param {Item} item - The item being used
     * @param {Actor} targetActor - The target actor
     * @param {Object} targetAttributes - The attributes to apply
     */
    async _applyItemAttributes(actor, item, targetActor, targetAttributes) {
      if (!targetActor) {
        ui.notifications.error('대상을 찾을 수 없습니다.');
        return;
      }

      const updates = {};
      let appliedKey = `applied_${item.id}`;

      // applied 객체 초기화 (없으면 생성)
      if (!targetActor.system.attributes.applied) {
        updates['system.attributes.applied'] = {};
      }

      // 기존 효과 확인 (키는 유지하고 내용만 교체)
      const existingApplied = targetActor.system.attributes.applied || {};
      const existingKey = Object.keys(existingApplied).find(key => {
        const effect = existingApplied[key];
        return effect && effect.itemId === item.id;
      });

      if (existingKey) {
        appliedKey = existingKey;
      }

      // 출처 아이템의 디스크립션 추출 (펼침 영역에서 표시용)
      const itemDesc = item.system?.description;
      const itemDescription = (typeof itemDesc === 'object' && itemDesc != null && 'value' in itemDesc)
        ? (itemDesc.value || '')
        : (typeof itemDesc === 'string' ? itemDesc : '');

      // 적용된 효과 정보 생성
      const appliedEffect = {
        itemId: item.id,
        name: item.name,
        img: item.img,
        source: actor.name,
        timestamp: Date.now(),
        disable: item.system.effect?.disable || '-',
        description: itemDescription,
        attributes: {}
      };

      // 효과 적용
      for (const [attrKey, attrData] of Object.entries(targetAttributes)) {
        if (!attrData || !attrData.value) continue;

        // stat_* 류는 표시용 이름으로 label을 사용, 나머지는 key를 사용
        const needsLabel = ['stat_bonus', 'stat_dice', 'stat_add'].includes(attrData.key);
        const attributeName = needsLabel ? attrData.label : attrData.key;
        if (!attributeName || attributeName === '-') continue;

        // 시전자 정보로 평가된 값 저장하되, applied에서는 key/label/value 모두 보존
        const evaluated = window.DX3rdFormulaEvaluator.evaluate(attrData.value, item, item.actor);
        // 동일 라벨의 stat_*들이 덮어쓰지 않도록 저장 키를 key:label 조합으로 사용
        const storageKey = needsLabel ? `${attrData.key}:${attributeName}` : attrData.key;
        appliedEffect.attributes[storageKey] = {
          key: attrData.key,
          label: attributeName,
          value: evaluated
        };
      }

      // 효과 추가
      updates[`system.attributes.applied.${appliedKey}`] = foundry.utils.deepClone(appliedEffect);

      if (Object.keys(updates).length > 0) {
        try {
          await targetActor.update(updates);
          ui.notifications.info(`${targetActor.name}에게 ${item.name}의 효과가 적용되었습니다.`);

          // 액터 시트가 열려있다면 재렌더링
          const actorSheet = Object.values(ui.windows).find(app => app.actor?.id === targetActor.id);
          if (actorSheet) {
            actorSheet.render(false);
          }
        } catch (error) {
          console.error('DX3rd | UniversalHandler._applyItemAttributes error:', error);
          ui.notifications.error('어트리뷰트 적용 중 오류가 발생했습니다.');
        }
      }
    },

    /**
     * Apply effect data from itemData to targeted actors
     * @param {Actor} actor - The actor using the item
     * @param {Object} itemData - Item data with effect information
     */
    async applyEffectData(actor, itemData) {
      try {
        
        // 효과 데이터 확인
        const targetAttributes = itemData.effect?.attributes || {};
        
        if (!targetAttributes || Object.keys(targetAttributes).length === 0) {
          return;
        }

        // 현재 타겟 사용
        const targets = Array.from(game.user.targets);
        
        if (targets.length === 0) {
          ui.notifications.warn('타겟을 지정해주세요.');
          return;
        }
        
        const targetActors = targets.map(t => t.actor).filter(a => a);
        
        if (targetActors.length === 0) {
          ui.notifications.warn('유효한 타겟을 찾을 수 없습니다.');
          return;
        }

        // 타겟된 모든 액터에 효과 적용
        for (const targetActor of targetActors) {
          await this._applyEffectDataToActor(actor, itemData, targetActor, targetAttributes);
        }
      } catch (e) {
        console.error('DX3rd | UniversalHandler.applyEffectData failed', e);
      }
    },

    /**
     * Apply effect data to a single target actor
     * @param {Actor} actor - The actor using the item
     * @param {Object} itemData - Item data
     * @param {Actor} targetActor - The target actor
     * @param {Object} targetAttributes - The attributes to apply
     */
    async _applyEffectDataToActor(actor, itemData, targetActor, targetAttributes) {
      if (!targetActor) {
        ui.notifications.error('대상을 찾을 수 없습니다.');
        return;
      }

      const updates = {};
      let appliedKey = `applied_${itemData.id || itemData.name}_${Date.now()}`;

      // applied 객체 초기화
      if (!targetActor.system.attributes.applied) {
        updates['system.attributes.applied'] = {};
      }

      // 기존 효과 확인 (같은 아이템 ID면 덮어쓰기)
      const existingApplied = targetActor.system.attributes.applied || {};
      if (itemData.id) {
        const existingKey = Object.keys(existingApplied).find(key => {
          const effect = existingApplied[key];
          return effect && effect.itemId === itemData.id;
        });
        
        if (existingKey) {
          appliedKey = existingKey;
        }
      }

      // 출처 아이템의 디스크립션 추출 (itemData: 채팅/카드 등에서 온 경우)
      const dataDesc = itemData.system?.description ?? itemData.description;
      const dataDescription = (typeof dataDesc === 'object' && dataDesc != null && 'value' in dataDesc)
        ? (dataDesc.value || '')
        : (typeof dataDesc === 'string' ? dataDesc : '');

      // 적용된 효과 정보 생성
      const appliedEffect = {
        itemId: itemData.id || null,
        name: itemData.name,
        img: itemData.img,
        source: actor.name,
        timestamp: Date.now(),
        disable: itemData.effect?.disable || '-',
        description: dataDescription,
        attributes: {}
      };

      // 효과 적용
      for (const [attrKey, attrData] of Object.entries(targetAttributes)) {
        if (!attrData || !attrData.value) continue;

        // stat_* 류는 표시용 이름으로 label을 사용, 나머지는 key를 사용
        const needsLabel = ['stat_bonus', 'stat_dice', 'stat_add'].includes(attrData.key);
        const attributeName = needsLabel ? attrData.label : attrData.key;
        if (!attributeName || attributeName === '-') continue;

        // 값 평가 (formula evaluator 사용)
        const evaluated = window.DX3rdFormulaEvaluator?.evaluate 
          ? window.DX3rdFormulaEvaluator.evaluate(attrData.value, null, actor)
          : Number(attrData.value) || 0;
        
        const storageKey = needsLabel ? `${attrData.key}:${attributeName}` : attrData.key;
        appliedEffect.attributes[storageKey] = {
          key: attrData.key,
          label: attributeName,
          value: evaluated
        };
      }

      // 효과 추가
      updates[`system.attributes.applied.${appliedKey}`] = foundry.utils.deepClone(appliedEffect);

      if (Object.keys(updates).length > 0) {
        try {
          await targetActor.update(updates);
          ui.notifications.info(`${targetActor.name}에게 ${itemData.name}의 효과가 적용되었습니다.`);

          // 액터 시트가 열려있다면 재렌더링
          const actorSheet = Object.values(ui.windows).find(app => app.actor?.id === targetActor.id);
          if (actorSheet) {
            actorSheet.render(false);
          }
        } catch (error) {
          console.error('DX3rd | UniversalHandler._applyEffectDataToActor error:', error);
          ui.notifications.error('어트리뷰트 적용 중 오류가 발생했습니다.');
        }
      }
    },

    _cleanDefenseReactionName(name = '') {
      return String(name)
        .replace(/\|\|.+$/, '')
        .replace(/\[DX3rd\.\w+\]/g, '')
        .trim();
    },

    async _getEffectsCompendiumIndex() {
      if (this._effectsCompendiumIndex) return this._effectsCompendiumIndex;

      const pack = game.packs?.get?.('dx3rd-emanim.effects')
        || Array.from(game.packs || []).find(p =>
          p.metadata?.system === 'dx3rd-emanim' && p.metadata?.name === 'effects'
        );

      const index = new Map();
      if (!pack?.getDocuments) {
        this._effectsCompendiumIndex = index;
        return index;
      }

      try {
        const docs = await pack.getDocuments();
        for (const doc of docs) {
          const key = this._cleanDefenseReactionName(doc.name);
          if (key && !index.has(key)) index.set(key, doc);
        }
      } catch (e) {
        console.warn('DX3rd | Failed to load effects compendium for defense reactions', e);
      }

      this._effectsCompendiumIndex = index;
      return index;
    },

    _isDefenseReactionCandidate(item, compendiumItem = null) {
      if (!item || !['effect', 'combo', 'psionic'].includes(item.type)) return false;

      const system = item.system || {};
      const compSystem = compendiumItem?.system || {};
      const timing = system.timing || compSystem.timing || '-';
      const roll = system.roll || compSystem.roll || '-';
      const difficulty = system.difficulty || compSystem.difficulty || '';
      const description = `${system.description || ''} ${compSystem.description || ''}`;
      const attrs = {
        ...(compSystem.effect?.attributes || {}),
        ...(system.effect?.attributes || {}),
        ...(compSystem.attributes || {}),
        ...(system.attributes || {})
      };
      const attrText = Object.values(attrs).map(attr => {
        if (!attr) return '';
        if (typeof attr === 'string') return attr;
        return `${attr.key || ''} ${attr.label || ''} ${attr.value || ''}`;
      }).join(' ');
      const haystack = `${timing} ${roll} ${difficulty} ${description} ${attrText}`.toLowerCase();

      const directTiming = ['reaction', 'dodge', 'major-reaction'].includes(timing);
      const autoDefense = timing === 'auto' && /(닷지|회피|리액션|가드|방어|피해|데미지|dodge|reaction|guard|armor|reduce)/i.test(haystack);
      const defensiveAttr = /(dodge|reaction|guard|armor|reduce)/i.test(attrText);

      return directTiming || autoDefense || defensiveAttr;
    },

    async getDefenseReactionItems(actor) {
      if (!actor?.items) return [];

      const compendiumIndex = await this._getEffectsCompendiumIndex();
      const items = [];
      for (const item of actor.items) {
        const compendiumItem = compendiumIndex.get(this._cleanDefenseReactionName(item.name));
        if (!this._isDefenseReactionCandidate(item, compendiumItem)) continue;
        if (window.DX3rdItemExhausted?.isItemExhausted(item)) continue;

        items.push({
          id: item.id,
          type: item.type,
          name: this._cleanDefenseReactionName(item.name),
          timing: item.system?.timing || compendiumItem?.system?.timing || '-'
        });
      }

      return items.sort((a, b) => {
        const order = {dodge: 0, reaction: 1, 'major-reaction': 2, auto: 3};
        const ao = order[a.timing] ?? 9;
        const bo = order[b.timing] ?? 9;
        return ao === bo ? a.name.localeCompare(b.name) : ao - bo;
      });
    },

    _getDefaultDodgeRollData(actor) {
      const evade = actor.system?.attributes?.skills?.evade;
      if (evade) {
        const name = evade.name?.startsWith?.('DX3rd.')
          ? game.i18n.localize(evade.name)
          : (evade.name || game.i18n.localize('DX3rd.evade'));
        return { stat: evade, label: name };
      }

      return {
        stat: actor.system?.attributes?.body,
        label: game.i18n.localize('DX3rd.Body')
      };
    },

    /**
     * Handle damage roll for weapons
     * @param {Actor} actor - The actor using the weapon
     * @param {Item} item - The weapon item
     * @param {number} rollResult - The result from the attack roll
     * @param {Object} preservedValues - Values preserved before disable hooks (optional)
     */
    async handleDamageRoll(actor, item, rollResult = null, preservedValues = null, comboAfterDamageData = null) {
      
      let weaponAttack, actorAttack, actorDamageRoll, actorPenetrate;
      
      if (preservedValues) {
        // 보존된 값들 사용 (비활성화 훅 실행 전의 값)
        weaponAttack = preservedValues.weaponAttack || 0;
        actorAttack = preservedValues.actorAttack || 0;
        actorDamageRoll = preservedValues.actorDamageRoll || 0;
        actorPenetrate = preservedValues.actorPenetrate || 0;
      } else {
        // 현재 값들 사용 (비활성화 훅 실행 후의 값)
        weaponAttack = window.DX3rdFormulaEvaluator.evaluate(item.system.attack, item, actor);
        
        // 공격 타입 확인
        let attackType = null;
        if (item.type === 'weapon') {
          attackType = item.system.type || null; // 'melee' or 'ranged'
        } else if (item.type === 'vehicle') {
          attackType = 'melee'; // 비클은 항상 melee
        } else if (item.system?.attackRoll && item.system.attackRoll !== '-') {
          attackType = item.system.attackRoll; // 'melee' or 'ranged'
        }
        
        // 공격 타입에 맞는 attack 보너스 계산
        actorAttack = actor.system.attributes.attack?.value || 0;
        if (attackType === 'melee' && actor.system.attributes.attack?.melee) {
          actorAttack += actor.system.attributes.attack.melee;
        } else if (attackType === 'ranged' && actor.system.attributes.attack?.ranged) {
          actorAttack += actor.system.attributes.attack.ranged;
        }
        // 맨손 한정 공격력(축퇴기관 등): 무기가 맨손일 때만 가산
        actorAttack += this.getFistAttackBonus(actor, item);

        // 공격 타입에 맞는 damage_roll 보너스 계산
        actorDamageRoll = actor.system.attributes.damage_roll?.value || 0;
        if (attackType === 'melee' && actor.system.attributes.damage_roll?.melee) {
          actorDamageRoll += actor.system.attributes.damage_roll.melee;
        } else if (attackType === 'ranged' && actor.system.attributes.damage_roll?.ranged) {
          actorDamageRoll += actor.system.attributes.damage_roll.ranged;
        }
        
        actorPenetrate = actor.system.attributes.penetrate?.value || 0;
      }
      
      // 데미지 산출 다이얼로그 표시 (롤 결과와 보존된 값들 포함)
      this.showDamageCalculationDialog(actor, item, weaponAttack, actorAttack, actorDamageRoll, actorPenetrate, rollResult, comboAfterDamageData);
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
    async showDamageCalculationDialog(actor, item, weaponAttack, actorAttack, actorDamageRoll, actorPenetrate, rollResult, comboAfterDamageData = null) {

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
      const panic8Applied = actor.system?.attributes?.applied?.Panic8;
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
      
      // 데미지 공식: [공격 메이저 롤의 결과/10(소수점 버림)+1+액터의 damage_roll 값]D10 +액터의 attack 값 + 무기의 attack 값
      const baseDamageAdd = actorAttack + weaponAttack + fearPenalty;
      const diceCount = Math.floor(attackRollResult / 10) + 1 + actorDamageRoll + madness6Bonus;
      const totalDamageAdd = baseDamageAdd + madness7Bonus;  // 공포 패널티, 트리거 해피 적용
      
      // 템플릿 데이터 준비 (과대망상·트리거 해피 각각 구분 표기)
      const dicePart = `[${attackRollResult} / 10 + 1 + ${actorDamageRoll}${madness6Bonus ? ' + 1(' + game.i18n.localize('DX3rd.Madness6') + ')' : ''}]D10`;
      const addPart = `${baseDamageAdd}${madness7Bonus ? ' + 5(' + game.i18n.localize('DX3rd.Madness7') + ')' : ''}`;
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
              const finalDiceCount = Math.floor((attackRollResult + addResult) / 10) + 1 + actorDamageRoll + addDamageRoll + madness6Bonus;
              
              // 최종 데미지 가산치 계산
              const finalDamageAdd = totalDamageAdd + addDamage;
              
              // 최종 장갑 무시 값 = 사용자가 입력한 값을 그대로 사용
              const finalPenetrate = penetrate;
              
              
              try {
                // 데미지 롤 실행
                const damageRoll = await (new Roll(`${finalDiceCount}d10 + ${finalDamageAdd}`)).roll();
                
                // 롤 결과를 HTML로 변환
                const rollHTML = await damageRoll.render();
                const rollMessage = `<div class="dice-roll">${rollHTML}</div>`;
                
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
                if (comboAfterDamageData || (item && item.id && item.id.startsWith('_temp_combo_'))) {
                  messageData.flags = {
                    'dx3rd-emanim': {}
                };
                
                // comboAfterDamage 데이터가 있으면 플래그에 저장
                if (comboAfterDamageData) {
                  messageData.flags['dx3rd-emanim'].comboAfterDamage = comboAfterDamageData;
                }
                
                // 임시 콤보인 경우 아이템 데이터도 복사
                if (item && item.id && item.id.startsWith('_temp_combo_')) {
                  messageData.flags['dx3rd-emanim'].tempComboItem = item;
                  }
                }
                
                await ChatMessage.create(messageData);
                
              } catch (error) {
                console.error('DX3rd | Damage roll failed:', error);
                ui.notifications.error('데미지 롤 중 오류가 발생했습니다.');
              }
            }
          }
        ],
        classes: ["dx3rd-emanim", "damage-dialog"]
      });
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
        // afterDamage 타이밍 체크
        const condEntries = window.DX3rdUniversalHandler?._getConditionEntries(itemExtend.condition || {}) || [];
        const hasCondAfterDamage = condEntries.some(c => c.timing === 'afterDamage');
        const hasCondAfterMain = condEntries.some(c => c.timing === 'afterMain');
        const hasAfterDamageExtension = 
          (itemExtend.heal?.activate && itemExtend.heal?.timing === 'afterDamage') ||
          (itemExtend.damage?.activate && itemExtend.damage?.timing === 'afterDamage') ||
          hasCondAfterDamage;
        
        // 아이템의 runTiming이 afterDamage이고 익스텐드 타이밍이 afterMain인 경우도 체크
        const itemRunTiming = item.system.active?.runTiming;
        const hasAfterMainExtensionForAfterDamage = 
          itemRunTiming === 'afterDamage' && (
            (itemExtend.heal?.activate && itemExtend.heal?.timing === 'afterMain') ||
            (itemExtend.damage?.activate && itemExtend.damage?.timing === 'afterMain') ||
            hasCondAfterMain
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
                ) ? itemExtend.heal : null,
                damage: itemExtend.damage?.activate && (
                  itemExtend.damage?.timing === 'afterDamage' || 
                  (itemRunTiming === 'afterDamage' && itemExtend.damage?.timing === 'afterMain')
                ) ? itemExtend.damage : null,
                condition: (() => {
                  const match = condEntries.filter(c =>
                    c.timing === 'afterDamage' ||
                    (itemRunTiming === 'afterDamage' && c.timing === 'afterMain')
                  );
                  return match.length > 0 ? match : null;
                })()
              },
              triggerItemName: item.name,
              itemRunTiming: itemRunTiming  // 아이템의 runTiming 저장
            };
            
            console.log('DX3rd | GM registered afterDamage extension request:', {
              queueKey: queueKey,
              attacker: actor.name,
              targetCount: targetActorIds.length,
              hasHeal: !!window.DX3rdAfterDamageExtensionQueue[queueKey].extensions.heal,
              hasDamage: !!window.DX3rdAfterDamageExtensionQueue[queueKey].extensions.damage,
              hasCondition: !!window.DX3rdAfterDamageExtensionQueue[queueKey].extensions.condition
            });
          } else {
            // 플레이어: GM에게 큐 등록 요청
            game.socket.emit('system.dx3rd-emanim', {
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
                  ) ? itemExtend.heal : null,
                  damage: itemExtend.damage?.activate && (
                    itemExtend.damage?.timing === 'afterDamage' || 
                    (item.system.active?.runTiming === 'afterDamage' && itemExtend.damage?.timing === 'afterMain')
                  ) ? itemExtend.damage : null,
                  condition: (() => {
                    const ce = window.DX3rdUniversalHandler?._getConditionEntries(itemExtend.condition || {}) || [];
                    const match = ce.filter(c =>
                      c.timing === 'afterDamage' ||
                      (item.system.active?.runTiming === 'afterDamage' && c.timing === 'afterMain')
                    );
                    return match.length > 0 ? match : null;
                  })()
                },
                triggerItemName: item.name
              }
            });
            
            console.log('DX3rd | Sent afterDamage extension registration to GM');
          }
        }
      }

      // 활성화/매크로 요청 등록 (아이템이 있을 때만)
      if (item?.id) {
        const isCombo = item.type === 'combo';
        
        // 콤보는 comboAfterDamageData만 등록, 단일 아이템은 기존 로직
        const activeDisable = item.system?.active?.disable ?? '-';
        const shouldActivate = !isCombo && (item.system.active?.runTiming === 'afterDamage' && !item.system.active?.state && activeDisable !== 'notCheck');
        const shouldApplyToTargets = !isCombo && (item.system.effect?.runTiming === 'afterDamage');
        const shouldExecuteMacro = !isCombo && (item.system?.macro ? true : false);

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
              console.log('DX3rd | GM registered afterDamage request:', {
                queueKey: queueKey,
                attacker: actor.name,
                targetCount: targetActorIds.length,
                hasMacro: shouldExecuteMacro,
                hasComboData: !!comboAfterDamageData
              });
            } else {
              // 일반 유저는 GM에게 등록 요청
              game.socket.emit('system.dx3rd-emanim', {
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
              console.log('DX3rd | AfterDamage registration sent to GM:', {
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
            game.socket.emit('system.dx3rd-emanim', {
              type: 'showDefenseDialog',
              dialogData: payload  // payload → dialogData로 통일
            });
            console.log('DX3rd | Defense dialog sent via socket to non-GM owner for:', targetActor.name);
          } else {
            // 접속 중인 일반 소유자가 없으면 GM이 직접 표시
            await this.showDefenseDialog(payload);
            console.log('DX3rd | GM showing defense dialog directly (no active non-GM owner)');
          }
        } else {
          // 일반 유저: 항상 소켓 전송 (GM 백업 로직이 처리)
          game.socket.emit('system.dx3rd-emanim', {
            type: 'showDefenseDialog',
            dialogData: payload  // payload → dialogData로 통일
          });
          console.log('DX3rd | Defense dialog sent via socket for:', targetActor.name);
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
      const weaponList = targetActor.items.filter(item => item.type === 'weapon')
        .sort((a, b) => {
          const guardA = a.system.guard || 0;
          const guardB = b.system.guard || 0;
          if (guardA !== guardB) {
            return guardB - guardA; // 가드치 높은 순
          }
          return 0; // 가드치가 같으면 원래 순서 유지
        });
      let guard = targetActor.system.attributes.guard?.value || 0;
      // 가드 D10 굴림(가드치에 +[N]D10 모델): 방어 시 Nd10을 굴려 가드치에 가산하고 채팅으로 공개.
      //   prepareData가 active 토글된 guard_roll 합계를 attrs.guard.roll에 적재 → 여기서 1회 굴림.
      const guardRollN = Number(targetActor.system.attributes.guard?.roll || 0);
      if (guardRollN > 0) {
        try {
          const gr = await (new Roll(`${guardRollN}d10`)).evaluate();
          guard += Number(gr.total) || 0;
          await gr.toMessage({
            speaker: ChatMessage.getSpeaker({ actor: targetActor }),
            flavor: `${game.i18n.localize('DX3rd.GuardRoll')} (${guardRollN}D10) → +${gr.total}`
          });
        } catch (e) { console.warn('DX3rd | guard roll failed', e); }
      }
      const armor = targetActor.system.attributes.armor?.value || 0;
      let reduce = targetActor.system.attributes.reduce?.value || 0;
      // 데미지 경감 D10 굴림(발동형 reduce_roll 모델): 피격 시 Nd10을 굴려 경감치에 가산하고 채팅으로 공개.
      //   prepareData가 active 토글된 reduce_roll 합계를 attrs.reduce.roll에 적재 → 여기서 1회 굴림(guard.roll 미러).
      const reduceRollN = Number(targetActor.system.attributes.reduce?.roll || 0);
      if (reduceRollN > 0) {
        try {
          const rr = await (new Roll(`${reduceRollN}d10`)).evaluate();
          reduce += Number(rr.total) || 0;
          await rr.toMessage({
            speaker: ChatMessage.getSpeaker({ actor: targetActor }),
            flavor: `${game.i18n.localize('DX3rd.ReduceRoll')} (${reduceRollN}D10) → +${rr.total}`
          });
        } catch (e) { console.warn('DX3rd | reduce roll failed', e); }
      }
      const currentHP = targetActor.system.attributes.hp?.value || 0;
      const maxHP = targetActor.system.attributes.hp?.max || 0;
      
      // 실제 데미지 계산 (초기값) - 일반 상황 기준
      const effectiveArmor = Math.max(0, armor - penetrate);
      const realDamage = Math.max(0, damage - guard - effectiveArmor - reduce);
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
        guardCheck: '',
        weaponList: weaponList,
        armor: armor,
        penetrate: penetrate,
        reduce: reduce,
        attackResult: attackResultValue,
        reactionItems: reactionItems
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
              const finalDamage = parseInt(form?.querySelector('#realDamage')?.textContent) || 0;
              const newHP = Math.max(0, currentHP - finalDamage);
              const hpChange = currentHP - newHP; // 실제 HP 변동량
              
              await targetActor.update({
                'system.attributes.hp.value': newHP
              });
              
              // 커버링 정보 확인
              const coveringValue = parseInt(form?.querySelector('#covering')?.value) || 0;
              let chatMessage = `HP-${hpChange}`;
              
              if (coveringValue > 0) {
                chatMessage += ` (${game.i18n.localize('DX3rd.Covering')}: ${coveringValue})`;
              }
              
              // 채팅 메시지 출력 (스피커는 대상 액터)
              await ChatMessage.create({
                speaker: ChatMessage.getSpeaker({ actor: targetActor }),
                content: `<div class="dx3rd-item-chat"><div>${chatMessage}</div></div>`,
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
                  
                  console.log('DX3rd | Extension damage report recorded:', {
                    target: targetActor.name,
                    hpChange: hpChange,
                    reportCount: extensionRequest.reportCount,
                    totalTargets: extensionRequest.targetActorIds.length
                  });
                  
                  // 모든 타겟이 보고했는지 확인
                  if (extensionRequest.reportCount === extensionRequest.targetActorIds.length) {
                    console.log('DX3rd | All targets reported for extensions, processing...');
                    
                    // HP 데미지를 받은 타겟 목록
                    const damagedTargets = Object.entries(extensionRequest.damageReports)
                      .filter(([id, hp]) => hp >= 1)
                      .map(([id, hp]) => id);
                    
                    // targetAll/self 포함 여부 확인
                    const healTarget = extensionRequest.extensions.heal?.target;
                    const damageTarget = extensionRequest.extensions.damage?.target;
                    const condList = Array.isArray(extensionRequest.extensions.condition)
                      ? extensionRequest.extensions.condition
                      : (extensionRequest.extensions.condition ? [extensionRequest.extensions.condition] : []);
                    const conditionTarget = condList[0]?.target;
                    const includesSelf = healTarget === 'self' || healTarget === 'targetAll' ||
                                        damageTarget === 'self' || damageTarget === 'targetAll' ||
                                        conditionTarget === 'self' || conditionTarget === 'targetAll';
                    
                    // 데미지를 받은 타겟이 있거나, self를 포함하는 경우 처리
                    if (damagedTargets.length > 0 || includesSelf) {
                      const attacker = game.actors.get(attackerId);
                      const triggerItem = attacker?.items.get(itemId);
                      
                      // heal 익스텐션 처리
                      if (extensionRequest.extensions.heal) {
                        const healTiming = extensionRequest.extensions.heal.timing;
                        console.log(`DX3rd | Processing heal extension for damaged targets (timing: ${healTiming})`);
                        
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
                            if (game.user.isGM) {
                              window.DX3rdUniversalHandler.addToAfterMainQueue(attacker, healDataWithTargets, triggerItem, 'heal');
                            } else {
                              game.socket.emit('system.dx3rd-emanim', {
                                type: 'addToAfterMainQueue',
                                data: {
                                  extensionType: 'heal',
                                  actorId: attacker.id,
                                  extensionData: healDataWithTargets,
                                  itemId: triggerItem?.id || null
                                }
                              });
                            }
                            console.log('DX3rd | Heal extension (afterMain) registered to afterMain queue from afterDamage');
                          } else {
                            console.log('DX3rd | Skipping afterMain heal extension in afterDamage (item runTiming is not afterDamage)');
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
                        console.log(`DX3rd | Processing damage extension for damaged targets (timing: ${damageTiming})`);
                        
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
                            if (game.user.isGM) {
                              window.DX3rdUniversalHandler.addToAfterMainQueue(attacker, damageDataWithTargets, triggerItem, 'damage');
                            } else {
                              game.socket.emit('system.dx3rd-emanim', {
                                type: 'addToAfterMainQueue',
                                data: {
                                  extensionType: 'damage',
                                  actorId: attacker.id,
                                  extensionData: damageDataWithTargets,
                                  itemId: triggerItem?.id || null
                                }
                              });
                            }
                            console.log('DX3rd | Damage extension (afterMain) registered to afterMain queue from afterDamage');
                          } else {
                            console.log('DX3rd | Skipping afterMain damage extension in afterDamage (item runTiming is not afterDamage)');
                          }
                        } else {
                          if (window.DX3rdUniversalHandler) {
                            // afterDamage 타이밍만 즉시 실행
                            await window.DX3rdUniversalHandler.executeDamageExtensionNow(attacker, damageDataWithTargets, triggerItem);
                          }
                        }
                      }
                      
                      // condition 익스텐션 처리
                      for (const condCfg of condList) {
                        const conditionTiming = condCfg.timing;
                        console.log(`DX3rd | Processing condition extension for damaged targets (timing: ${conditionTiming}, type: ${condCfg.type})`);
                        
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
                            if (game.user.isGM) {
                              window.DX3rdUniversalHandler.addToAfterMainQueue(attacker, conditionDataWithTargets, triggerItem, 'condition');
                            } else {
                              game.socket.emit('system.dx3rd-emanim', {
                                type: 'addToAfterMainQueue',
                                data: {
                                  extensionType: 'condition',
                                  actorId: attacker.id,
                                  extensionData: conditionDataWithTargets,
                                  itemId: triggerItem?.id || null
                                }
                              });
                            }
                            console.log('DX3rd | Condition extension (afterMain) registered to afterMain queue from afterDamage');
                          } else {
                            console.log('DX3rd | Skipping afterMain condition extension in afterDamage (item runTiming is not afterDamage)');
                          }
                        } else {
                          if (window.DX3rdUniversalHandler) {
                            // afterDamage 타이밍만 즉시 실행
                            await window.DX3rdUniversalHandler.executeConditionExtensionNow(attacker, conditionDataWithTargets, triggerItem);
                          }
                        }
                      }
                    } else {
                      console.log('DX3rd | No damaged targets for extensions, skipping');
                    }
                    
                    // 요청 삭제
                    delete window.DX3rdAfterDamageExtensionQueue[extensionQueueKey];
                    console.log('DX3rd | Extension request removed from queue');
                  }
                }
              }
              
              // ===== 기존 afterDamage 시스템 (queueIndex가 없는 경우) =====
              console.log('DX3rd | Checking afterDamage conditions:', {
                hpChange: hpChange,
                attackerId: attackerId,
                itemId: itemId,
                hasAttackerAndItem: !!(attackerId && itemId)
              });
              
              if (attackerId && itemId) {
                console.log('DX3rd | Reporting damage result to GM, hpChange:', hpChange);
                console.log('DX3rd | Current user isGM:', game.user.isGM);
                
                if (game.user.isGM) {
                  // GM은 직접 큐 확인 및 처리
                  const applyQueueKey = `${targetActor.id}_${itemId}`; // 효과: 타겟 기준
                  
                  // 1. afterDamage 타겟 효과 적용
                  const applyRequest = window.DX3rdTargetApplyQueue?.[applyQueueKey];
                  if (applyRequest) {
                    console.log('DX3rd | Found target apply request in queue:', applyRequest);
                    
                    if (hpChange >= 1) {
                      // HP 감소했으면 효과 적용
                      const sourceActor = game.actors.get(applyRequest.sourceActorId);
                      const item = sourceActor?.items.get(applyRequest.itemId);
                      
                      if (item && targetActor.isOwner) {
                        // GM이 타겟 소유자이므로 직접 적용
                        await window.DX3rdUniversalHandler._applyItemAttributes(sourceActor, item, targetActor, applyRequest.targetAttributes);
                        console.log('DX3rd | Target effect applied directly by GM');
                      } else {
                        // 타겟 소유자에게 적용 지시
                        game.socket.emit('system.dx3rd-emanim', {
                          type: 'applyEffectToTarget',
                          payload: {
                            sourceActorId: applyRequest.sourceActorId,
                            itemId: applyRequest.itemId,
                            targetActorId: targetActor.id,
                            targetAttributes: applyRequest.targetAttributes
                          }
                        });
                        console.log('DX3rd | Sent applyEffectToTarget to target owner');
                      }
                    } else {
                      console.log('DX3rd | HP not decreased, skipping effect application');
                    }
                    
                    // 요청 삭제 (HP 감소 여부 무관)
                    delete window.DX3rdTargetApplyQueue[applyQueueKey];
                    console.log('DX3rd | Target apply request removed from queue');
                  } else {
                    console.log('DX3rd | No target apply request found for:', applyQueueKey);
                  }
                  
                  // 2. 활성화/매크로 처리 (활성화 큐 확인 및 보고 수집)
                  const activationQueueKey = `${attackerId}_${itemId}`;
                  const activationRequest = window.DX3rdAfterDamageActivationQueue?.[activationQueueKey];
                  if (activationRequest) {
                    // 보고 기록
                    activationRequest.damageReports[targetActor.id] = hpChange;
                    activationRequest.reportCount++;
                    
                    console.log('DX3rd | Activation report recorded:', {
                      target: targetActor.name,
                      hpChange: hpChange,
                      reportCount: activationRequest.reportCount,
                      totalTargets: activationRequest.targetActorIds.length
                    });
                    
                    // 모든 타겟이 보고했는지 확인
                    if (activationRequest.reportCount === activationRequest.targetActorIds.length) {
                      console.log('DX3rd | All targets reported, processing activation...');
                      
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
                        console.log('DX3rd | Processing combo afterDamage (HP damage occurred)');
                        // damagedTargets는 Actor ID 배열이므로 Actor 객체로 변환
                        const damagedActors = damagedTargets.map(id => game.actors.get(id)).filter(a => a);
                        await window.DX3rdUniversalHandler.processComboAfterDamage(comboData, damagedActors);
                      }
                      
                      // 1️⃣ 매크로 실행 (한 명이라도 HP 데미지 받았으면)
                      if (activationRequest.shouldExecuteMacro && damagedTargets.length > 0) {
                        if (attacker.isOwner) {
                          // GM이 공격자 소유자면 직접 실행
                          await window.DX3rdUniversalHandler.executeMacros(attackerItem, 'afterDamage');
                          console.log('DX3rd | AfterDamage macro executed directly by GM');
                        } else {
                          // 공격자 소유자에게 실행 지시
                          game.socket.emit('system.dx3rd-emanim', {
                            type: 'executeAfterDamageMacro',
                            payload: {
                              attackerId: attackerId,
                              itemId: itemId,
                              hpChange: damagedTargets.length  // 데미지 받은 타겟 수 전달
                            }
                          });
                          console.log('DX3rd | AfterDamage macro sent via socket');
                        }
                      }
                      
                      // 2️⃣ 활성화/효과 적용 처리
                      // 최신 아이템 상태로 횟수 체크
                      const currentItem = attacker.items.get(itemId);  // 최신 상태 다시 가져오기
                      const usedDisable = currentItem?.system?.used?.disable || 'notCheck';
                      const usedState = currentItem?.system?.used?.state || 0;
                      const usedMax = currentItem?.system?.used?.max || 0;
                      const isUsageExhausted = usedDisable !== 'notCheck' && usedState >= usedMax && usedMax > 0;
                      
                      console.log('DX3rd | Usage check:', {
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
                          console.log('DX3rd | No damage notification shown directly by GM');
                        } else {
                          // 공격자 소유자에게 소켓 전송
                          game.socket.emit('system.dx3rd-emanim', {
                            type: 'showNoDamageNotification',
                            payload: { attackerId: attackerId }
                          });
                          console.log('DX3rd | No damage notification sent via socket to player');
                        }
                      } else if (isUsageExhausted && (activationRequest.shouldActivate || activationRequest.shouldApplyToTargets)) {
                        // 횟수 소진: 활성화/적용 불가, 아무 작업도 하지 않음
                        console.log('DX3rd | Usage exhausted, skipping activation/effect application');
                      } else {
                        // 최소 한 명 데미지 받음 & 횟수 남음: 처리 지시
                        const needsConfirmation = activationRequest.needsDialog && usedDisable !== 'notCheck';
                        
                        if (needsConfirmation) {
                          // 무기/비클 + 횟수 제한 있음: 다이얼로그
                          if (!hasActiveNonGMOwner) {
                            // 접속 중인 non-GM 소유자 없음: GM이 직접 표시
                            await window.DX3rdUniversalHandler._showAfterDamageDialog(attacker, currentItem, damagedTargets, activationRequest.shouldActivate, activationRequest.shouldApplyToTargets);
                            console.log('DX3rd | AfterDamage dialog shown directly by GM');
                          } else {
                            // 공격자 소유자에게 소켓 전송
                            game.socket.emit('system.dx3rd-emanim', {
                              type: 'showAfterDamageDialog',
                              payload: {
                                attackerId: attackerId,
                                itemId: itemId,
                                damagedTargets: damagedTargets,
                                shouldActivate: activationRequest.shouldActivate,
                                shouldApplyToTargets: activationRequest.shouldApplyToTargets
                              }
                            });
                            console.log('DX3rd | AfterDamage dialog sent via socket to player');
                          }
                        } else {
                          // 나머지 (무기/비클 notCheck 포함): 자동 활성화
                          if (!hasActiveNonGMOwner) {
                            // 접속 중인 non-GM 소유자 없음: GM이 직접 실행
                            await window.DX3rdUniversalHandler._executeAfterDamageActivation(attacker, currentItem, damagedTargets, activationRequest.shouldActivate, activationRequest.shouldApplyToTargets);
                            console.log('DX3rd | AfterDamage auto-activation executed directly by GM');
                          } else {
                            // 공격자 소유자에게 소켓 전송
                            game.socket.emit('system.dx3rd-emanim', {
                              type: 'executeAfterDamageActivation',
                              payload: {
                                actorId: attackerId,
                                itemId: itemId,
                                damagedTargets: damagedTargets,
                                shouldActivate: activationRequest.shouldActivate,
                                shouldApplyToTargets: activationRequest.shouldApplyToTargets
                              }
                            });
                            console.log('DX3rd | AfterDamage auto-activation sent via socket to player');
                          }
                        }
                      }
                      
                      // 큐에서 제거
                      delete window.DX3rdAfterDamageActivationQueue[activationQueueKey];
                      console.log('DX3rd | Activation request removed from queue');
                    }
                  }
                } else {
                  // 일반 유저는 GM에게 데미지 처리 결과 보고
                  
                  // 1. 매크로 실행용 보고 (HP 감소 시에만)
                  if (hpChange >= 1) {
                    game.socket.emit('system.dx3rd-emanim', {
                      type: 'reportDamageReceived',
                      payload: {
                        attackerId: attackerId,
                        itemId: itemId,
                        hpChange: hpChange
                      }
                    });
                    console.log('DX3rd | Damage received report sent to GM (macro):', {
                      attacker: attackerId,
                      hpChange: hpChange
                    });
                  }
                  
                  // 2. 타겟 효과 적용 보고 (항상, HP 변동량 포함)
                  game.socket.emit('system.dx3rd-emanim', {
                    type: 'reportDamageForApply',
                    payload: {
                      targetActorId: targetActor.id,
                      itemId: itemId,
                      hpChange: hpChange
                    }
                  });
                  console.log('DX3rd | Damage result report sent to GM (effect apply):', {
                    target: targetActor.name,
                    hpChange: hpChange
                  });
                  
                  // 3. 활성화 처리용 보고 (항상, HP 변동량 포함)
                  game.socket.emit('system.dx3rd-emanim', {
                    type: 'reportDamageForActivation',
                    payload: {
                      attackerId: attackerId,
                      itemId: itemId,
                      targetActorId: targetActor.id,
                      hpChange: hpChange
                    }
                  });
                  console.log('DX3rd | Damage result report sent to GM (activation):', {
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

        console.log(`DX3rd | Defense dialog - Guard/Weapon disabled due to berserk type: ${berserkType}`);
      }

      const getNumberValue = (selector) => parseInt(root.querySelector(selector)?.value) || 0;
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
      const updateWeaponGuard = () => {
        let weaponGuard = 0;
        root.querySelectorAll('.weapon-checkbox:checked').forEach(checkbox => {
          weaponGuard += parseInt(checkbox.dataset.guard) || 0;
        });
        const totalGuard = root.querySelector('#total-guard');
        if (totalGuard) totalGuard.textContent = String(weaponGuard);
        return weaponGuard;
      };

      // 실시간 데미지 계산 업데이트
      const updateDamage = () => {
        const actorGuardValue = getNumberValue('#guard');
        const guardChecked = root.querySelector('#guard-check')?.checked || false;
        const armorValue = getNumberValue('#armor');
        const reduceValue = getNumberValue('#reduce');
        const coveringValue = getNumberValue('#covering');

        // 무기 가드값 합산
        const weaponGuardTotal = updateWeaponGuard();

        // 총 가드값 = 액터 가드 + 무기 가드
        const totalGuardValue = actorGuardValue + weaponGuardTotal;
        const effectiveGuard = guardChecked ? totalGuardValue : 0;

        // 장갑무시 적용: 장갑치는 음수가 될 수 없음
        const effectiveArmor = Math.max(0, armorValue - penetrate);

        let calculatedDamage;

        if (getReactionSuccess()) {
          calculatedDamage = 0;
        } else if (coveringValue > 0) {
          // 커버링: (데미지 - 가드 - 장갑) × (커버링수 + 1) - 경감
          const intermediateDamage = Math.max(0, damage - effectiveGuard - effectiveArmor);
          const multiplier = coveringValue + 1; // 1이면 2배, 2면 3배
          calculatedDamage = Math.max(0, (intermediateDamage * multiplier) - reduceValue);
        } else {
          // 일반 상황: 데미지 - 가드 - 장갑 - 경감
          calculatedDamage = Math.max(0, damage - effectiveGuard - effectiveArmor - reduceValue);
        }

        const realDamageElement = root.querySelector('#realDamage');
        if (realDamageElement) realDamageElement.textContent = String(calculatedDamage);
        const lifeElement = root.querySelector('#life');
        if (lifeElement) lifeElement.textContent = String(Math.max(0, currentHP - calculatedDamage));
      };

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

      root.querySelectorAll('.reaction-item-btn').forEach(button => {
        button.addEventListener('click', async (event) => {
          event.preventDefault();
          const itemId = button.dataset.itemId;
          const itemType = button.dataset.itemType;
          const item = targetActor.items.get(itemId);
          if (!item) {
            ui.notifications.warn(game.i18n.localize('DX3rd.ItemNotFound'));
            return;
          }

          const success = await this.handleItemUse(
            targetActor.id,
            itemId,
            itemType,
            null,
            item.system?.getTarget,
            {
              predefinedDifficulty: attackResultValue > 0 ? { type: 'number', value: attackResultValue } : null,
              afterRollCallback: ({ total }) => setReactionResult(total)
            }
          );

          if (success && (item.system?.roll || '-') === '-') {
            await targetActor.prepareData();
            const guardInput = root.querySelector('#guard');
            if (guardInput) guardInput.value = targetActor.system.attributes.guard?.value || 0;
            const armorInput = root.querySelector('#armor');
            if (armorInput) armorInput.value = targetActor.system.attributes.armor?.value || 0;
            const reduceInput = root.querySelector('#reduce');
            if (reduceInput) reduceInput.value = targetActor.system.attributes.reduce?.value || 0;
            updateDamage();
          }
        });
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
          console.log('DX3rd | Used count increased on afterDamage:', currentUsedState, '→', currentUsedState + 1);
        }
        
        // 2. 활성화 (shouldActivate가 true인 경우)
        if (shouldActivate) {
          updates['system.active.state'] = true;
          console.log('DX3rd | Item activated on afterDamage:', item.name);
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
                game.socket.emit('system.dx3rd-emanim', {
                  type: 'applyItemAttributes',
                  payload: {
                    sourceActorId: actor.id,
                    itemId: item.id,
                    targetActorId: targetId,
                    targetAttributes: targetAttributes
                  }
                });
              }
              console.log('DX3rd | Effect applied to damaged target (dialog):', targetActor.name);
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
        console.log('DX3rd | Item activated on afterDamage (auto):', item.name);
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
              game.socket.emit('system.dx3rd-emanim', {
                type: 'applyItemAttributes',
                payload: {
                  sourceActorId: actor.id,
                  itemId: item.id,
                  targetActorId: targetId,
                  targetAttributes: targetAttributes
                }
              });
            }
            console.log('DX3rd | Effect applied to damaged target (auto):', targetActor.name);
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
      handleAttackRoll: async function(actor, item) {
        
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
      
      // 타겟이 있으면 하이라이트 제거
      this.clearRangeHighlightQueue();
      
      // 다른 유저들에게도 소켓으로 전송
      game.socket.emit('system.dx3rd-emanim', {
        type: 'clearRangeHighlight'
      });
      
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
      
      // 콤보 확인 다이얼로그 먼저 표시
      const title = game.i18n.localize('DX3rd.Combo');
      const DialogV2 = foundry.applications?.api?.DialogV2;
      if (!DialogV2?.confirm) {
        ui.notifications.error(game.i18n.localize('DX3rd.DialogV2Unavailable'));
        return false;
      }

      const useCombo = await DialogV2.confirm({
        title,
        content: '',
        yes: { label: 'Yes' },
        no: { label: 'No' },
        defaultYes: false,
        rejectClose: false
      });
      if (useCombo === null) return true;

      if (useCombo) {
        // 콤보 빌더 열기 (스킬 타입으로, 무기 아이템 전달하여 attackRoll 초기값 설정)
        await this.openComboBuilder(actor, 'skill', skillKey, item);
        // 이전 토큰 복원
        if (previousToken && canvas.tokens) {
          previousToken.control({ releaseOthers: true });
        }
      } else {
        // 판정 다이얼로그 표시 (메이저만, 무기 아이템 전달)
        this.showStatRollDialog(actor, skillData, skillName, 'major', item, previousToken);
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
            console.log(`DX3rd | Hatred auto-cleared after attack roll against target: ${hatredTarget}`);
          }
        }
      } catch (e) {
        console.warn('DX3rd | onAttackRollComplete failed', e);
      }
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
     */
    async executeAttackRoll(actor, item, skillName, previousToken, dice, critical, add) {
      try {
        // 대상 확인 (다시 가져오기)
        const targets = Array.from(game.user.targets);
        
        // 현재 시점의 액터 값들 저장 (비활성화 전)
        const itemAttackValue = window.DX3rdFormulaEvaluator.evaluate(item.system.attack, item, actor);
        
        // 공격 타입 확인
        let attackType = null;
        if (item.type === 'weapon') {
          attackType = item.system.type || null; // 'melee' or 'ranged'
        } else if (item.type === 'vehicle') {
          attackType = 'melee'; // 비클은 항상 melee
        } else if (item.system?.attackRoll && item.system.attackRoll !== '-') {
          attackType = item.system.attackRoll; // 'melee' or 'ranged'
        }
        
        // 공격 타입에 맞는 attack 보너스 계산
        let attackBonus = actor.system.attributes.attack?.value || 0;
        if (attackType === 'melee' && actor.system.attributes.attack?.melee) {
          attackBonus += actor.system.attributes.attack.melee;
        } else if (attackType === 'ranged' && actor.system.attributes.attack?.ranged) {
          attackBonus += actor.system.attributes.attack.ranged;
        }
        // 맨손 한정 공격력(축퇴기관 등): 무기가 맨손일 때만 가산
        attackBonus += this.getFistAttackBonus(actor, item);

        // 공격 타입에 맞는 damage_roll 보너스 계산
        let damageRollBonus = actor.system.attributes.damage_roll?.value || 0;
        if (attackType === 'melee' && actor.system.attributes.damage_roll?.melee) {
          damageRollBonus += actor.system.attributes.damage_roll.melee;
        } else if (attackType === 'ranged' && actor.system.attributes.damage_roll?.ranged) {
          damageRollBonus += actor.system.attributes.damage_roll.ranged;
        }
        
        const preservedValues = {
          actorAttack: attackBonus,
          actorDamageRoll: damageRollBonus,
          actorPenetrate: actor.system.attributes.penetrate?.value || 0
        };
        
        // 아이템 타입별 공격력 키 설정
        if (item.type === 'weapon') {
          preservedValues.weaponAttack = itemAttackValue;
        } else if (item.type === 'vehicle') {
          preservedValues.vehicleAttack = itemAttackValue;
        } else {
          preservedValues.itemAttack = itemAttackValue;
        }
        
      
        // 공포 패널티는 이미 다이얼로그에서 반영되었으므로 여기서는 적용하지 않음
        // 룰(rule-section:39-41): 수정 결과 판정치가 0 이하면 판정은 자동실패(달성치 0).
        // 실제 애니메이션을 위해 최소 1다이스는 굴리되, 결과는 아래에서 0으로 확정한다.
        const autoFailByPool = dice <= 0;
        const finalDice = Math.max(1, dice);

        // 달성치 D10 굴림(달성치에 +[N]D10 모델): 판정 시 Nd10 굴려 달성치(add)에 가산하고 채팅 공개.
        let add2 = add;
        const dxRollN = Number(actor.system.attributes.dxroll?.value || 0);
        if (dxRollN > 0) {
          try {
            const dr = await (new Roll(`${dxRollN}d10`)).evaluate();
            add2 += Number(dr.total) || 0;
            await dr.toMessage({
              speaker: ChatMessage.getSpeaker({ actor }),
              flavor: `${game.i18n.localize('DX3rd.DxRoll')} (${dxRollN}D10) → +${dr.total}`
            });
          } catch (e) { console.warn('DX3rd | dxroll failed', e); }
        }
        const roll = await (new Roll(`${finalDice}dx${critical} + ${add2}`)).roll();
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
                    data-preserved-actor-damage-roll="${preservedValues.actorDamageRoll}"
                    data-preserved-actor-penetrate="${preservedValues.actorPenetrate}"`;
        
        // 아이템 타입별 공격력 데이터 속성 추가
        if (item.type === 'weapon') {
          damageRollButtonContent += `\n                    data-preserved-weapon-attack="${preservedValues.weaponAttack}"`;
          damageRollButtonContent += `\n                    data-weapon-ids="${item.id}"`; // 무기 자신의 ID 추가
        } else if (item.type === 'vehicle') {
          damageRollButtonContent += `\n                    data-preserved-vehicle-attack="${preservedValues.vehicleAttack}"`;
        } else {
          damageRollButtonContent += `\n                    data-preserved-item-attack="${preservedValues.itemAttack}"`;
        }
        
        damageRollButtonContent += `>
                ${game.i18n.localize('DX3rd.DamageRoll')}
            </button>`;
        
        // 공격 메시지, 대상 정보, 롤 결과, 데미지 롤 버튼을 하나의 메시지로 묶기 (콤보와 동일하게 rollHtml 명시 포함)
        const attackMessageContent = `
          <div class="dx3rd-item-chat">
            <div>
              <p>${flavorText.replace(/\n/g, '<br>')}</p>
            </div>
            <div class="dice-roll">${rollHtml}</div>
            <div class="damage-roll-message">
              ${damageRollButtonContent}
            </div>
          </div>
        `;
        
        await ChatMessage.create({
          speaker: ChatMessage.getSpeaker({ actor: actor }),
          content: attackMessageContent,
          rolls: [roll]
        });
        
        // 메이저 롤 후 비활성화 훅 실행 (자기 자신에게만)
        if (window.DX3rdDisableHooks) {
          await window.DX3rdDisableHooks.executeDisableHook('roll', actor);
          await window.DX3rdDisableHooks.executeDisableHook('major', actor);
        }

        // 명중판정 완료 공통 후처리 (증오 자동 회복 + 확장 훅)
        await this.onAttackRollComplete(actor, item, targets, rollResult, isFumble);

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
     * 사정거리 하이라이트 표시
     * @param {Token} token - 공격하는 토큰
     * @param {Item} item - 사용하는 아이템
     */
    highlightRange: async function(token, item) {
      try {
        
        // 이전 하이라이트 제거
        if (window.DX3rdRangeHighlight) {
          this.clearRangeHighlight();
        }

        // 사정거리 확인
        const range = item.system?.range;
        console.log(`DX3rd | Item range: "${range}"`);
        
        if (!range || range === '-') {
          return;
        }

        const gridSize = canvas.grid.size;
        const tokenCenter = token.center;
        
        // 하이라이트할 그리드 좌표 저장
        const highlightedCells = [];
        
        // "지근" (접촉) 처리
        const engageText = game.i18n.localize("DX3rd.Engage");
        console.log(`DX3rd | Comparing range="${range}" with engageText="${engageText}"`);
        
        if (range === engageText) {
          console.log('DX3rd | Range is ENGAGE, getting adjacent grids...');
          // 인접 그리드 가져오기
          const neighbors = this.getAdjacentGrids(token);
          console.log(`DX3rd | Got ${neighbors.length} adjacent grids`);
          
          for (const { x, y } of neighbors) {
            this.drawGridHighlight(x, y, gridSize);
            highlightedCells.push({ x, y });
          }
        } else {
          // 숫자 사정거리 처리 (예: "10", "20", "+5" 등)
          const rangeValue = parseInt(range);
          if (!isNaN(rangeValue) && rangeValue > 0) {
            // 사정거리 내 모든 그리드 가져오기
            const cellsInRange = this.getGridsInRange(token, rangeValue);
            for (const { x, y } of cellsInRange) {
              this.drawGridHighlight(x, y, gridSize);
              highlightedCells.push({ x, y });
            }
          }
        }
        
        
        // 3초 후 자동 제거
        if (highlightedCells.length > 0) {
          setTimeout(() => {
            this.clearRangeHighlight();
          }, 3000);
        }
        
      } catch (e) {
        console.error('DX3rd | highlightRange failed', e);
      }
    },

    /**
     * 범위 하이라이트 큐 관리
     */
    rangeHighlightQueue: {
      current: null, // { actorId, tokenId, itemId, range, timestamp }
      timeout: null
    },

    /**
     * 아이템 채팅 출력 시 범위 하이라이트 설정
     * @param {Actor} actor - 액터
     * @param {Item} item - 아이템
     */
    async setRangeHighlightForItem(actor, item) {
      try {
        // 범위 하이라이트 설정 확인
        const rangeHighlightEnabled = game.settings.get('dx3rd-emanim', 'rangeHighlight');
        if (!rangeHighlightEnabled) {
          return;
        }
        
        // 전투 중 확인 (컴뱃이 있고 라운드가 1 이상일 때만 활성화)
        const combat = game.combat;
        if (!combat || !combat.round || combat.round < 1) {
          return;
        }

        // 아이템의 사정거리 확인
        let range = item.system?.range;
        
        // vehicle 아이템의 경우 항상 1로 처리
        if (item.type === 'vehicle') {
          range = 1;
          console.log('DX3rd | Vehicle item - setting range to 1');
        }
        
        // 사정거리가 없거나 빈 값이면 처리하지 않음
        if (!range || range === '') {
          console.log('DX3rd | No range found for item:', item.name);
          return;
        }

        // 대상이 자기 자신인 경우 하이라이트 처리하지 않음
        const selfText = game.i18n.localize('DX3rd.Self');
        const target = item.system?.target;
        if (target === selfText) {
          return;
        }

        // 액터의 토큰 찾기
        const tokens = actor.getActiveTokens();
        if (tokens.length === 0) {
          console.log('DX3rd | No active tokens found for actor:', actor.name);
          return;
        }

        const token = tokens[0]; // 첫 번째 토큰 사용
        
        // DX3rd.Engage는 토큰 크기의 절반(올림)으로 처리
        const engageText = game.i18n.localize('DX3rd.Engage');
        let rangeValue;
        if (range === engageText) {
          const tokenSize = token.document.width || 1;
          rangeValue = Math.ceil(tokenSize / 2);
          console.log('DX3rd | Engage range calculated from token size:', tokenSize, '→', rangeValue);
        } else {
          rangeValue = Number(range) || 0;
        }
        
        if (rangeValue <= 0) {
          console.log('DX3rd | Invalid range value:', range, 'for item:', item.name);
          return;
        }
        
        // 사용자 색상 가져오기 (설정이 켜져 있을 때만)
        const useUserColor = game.settings.get('dx3rd-emanim', 'rangeHighlightColor') === true;
        let userColorValue = null;
        
        if (useUserColor && game.user?.color) {
          // Foundry Color 객체, 문자열, 숫자 모두 처리
          if (typeof game.user.color === 'object' && game.user.color !== null) {
            userColorValue = Number(game.user.color);
          } else if (typeof game.user.color === 'string') {
            const hexColor = game.user.color.replace('#', '');
            userColorValue = parseInt(hexColor, 16);
          } else if (typeof game.user.color === 'number') {
            userColorValue = game.user.color;
          }
        }
        
        const queueData = {
          actorId: actor.id,
          tokenId: token.id,
          itemId: item.id,
          range: rangeValue,
          userColor: userColorValue, // 사용자 색상 추가
          userId: game.user.id, // 하이라이트를 생성한 사용자 ID
          timestamp: Date.now()
        };

        // 모든 사용자가 직접 처리 (각자의 클라이언트에서 하이라이트 표시)
        await this.processRangeHighlightQueue(queueData);
        
        // 다른 사용자들에게도 소켓으로 전송하여 모두에게 하이라이트 표시
        game.socket.emit('system.dx3rd-emanim', {
          type: 'setRangeHighlight',
          data: queueData
        });

      } catch (e) {
        console.error('DX3rd | Failed to set range highlight for item:', e);
      }
    },

    /**
     * 매크로용: 임의의 범위값으로 하이라이트 표시
     * @param {number|null} range - 범위값 (null이면 사용자 입력 요청)
     * @param {Token|null} token - 토큰 (null이면 선택된 토큰 또는 컨트롤된 토큰 사용)
     * @returns {Promise<boolean>} 성공 여부
     */
    async showRangeHighlight(range = null, token = null) {
      try {
        // 범위 하이라이트 설정 확인
        const rangeHighlightEnabled = game.settings.get('dx3rd-emanim', 'rangeHighlight');
        if (!rangeHighlightEnabled) {
          ui.notifications.warn('범위 하이라이트 기능이 비활성화되어 있습니다.');
          return false;
        }

        // 범위값 입력 요청
        if (range === null || range === undefined) {
          const DialogV2 = foundry.applications?.api?.DialogV2;
          if (!DialogV2?.wait) {
            ui.notifications.error(game.i18n.localize('DX3rd.DialogV2Unavailable'));
            return false;
          }

          const input = await DialogV2.wait({
            window: { title: '범위 하이라이트' },
            content: `
              <form>
                <div class="form-group">
                  <label>범위 (칸 수):</label>
                  <input type="number" name="range" min="1" value="1" required>
                </div>
              </form>
            `,
            rejectClose: false,
            buttons: [
              {
                action: 'confirm',
                icon: '<i class="fas fa-check"></i>',
                label: '확인',
                default: true,
                callback: (event, button) => {
                  const rangeInput = button.form?.querySelector('input[name="range"]')?.value;
                  return parseInt(rangeInput) || null;
                }
              },
              {
                action: 'cancel',
                icon: '<i class="fas fa-times"></i>',
                label: '취소',
                callback: () => null
              }
            ]
          });

          if (input === null || isNaN(input) || input < 1) {
            ui.notifications.warn('유효한 범위값을 입력해주세요.');
            return false;
          }
          range = input;
        }

        // 토큰 찾기
        if (!token) {
          // 선택된 토큰 확인
          const controlled = canvas.tokens?.controlled;
          if (controlled && controlled.length > 0) {
            token = controlled[0];
          } else {
            // 컨트롤된 액터의 토큰 찾기
            const controlledActors = game.user.character ? [game.user.character] : [];
            if (controlledActors.length > 0) {
              const tokens = controlledActors[0].getActiveTokens();
              if (tokens.length > 0) {
                token = tokens[0];
              }
            }
          }
        }

        if (!token) {
          ui.notifications.warn('토큰을 선택하거나 컨트롤하고 있어야 합니다.');
          return false;
        }

        // 액터 확인
        const actor = token.actor;
        if (!actor) {
          ui.notifications.warn('토큰에 연결된 액터가 없습니다.');
          return false;
        }

        // 사용자 색상 가져오기 (설정이 켜져 있을 때만)
        const useUserColor = game.settings.get('dx3rd-emanim', 'rangeHighlightColor') === true;
        let userColorValue = null;
        
        if (useUserColor && game.user?.color) {
          if (typeof game.user.color === 'object' && game.user.color !== null) {
            userColorValue = Number(game.user.color);
          } else if (typeof game.user.color === 'string') {
            const hexColor = game.user.color.replace('#', '');
            userColorValue = parseInt(hexColor, 16);
          } else if (typeof game.user.color === 'number') {
            userColorValue = game.user.color;
          }
        }

        const queueData = {
          actorId: actor.id,
          tokenId: token.id,
          itemId: null, // 매크로 호출이므로 아이템 ID 없음
          range: range,
          userColor: userColorValue,
          userId: game.user.id,
          timestamp: Date.now()
        };

        // 하이라이트 표시
        await this.processRangeHighlightQueue(queueData);
        
        // 다른 사용자들에게도 소켓으로 전송하여 모두에게 하이라이트 표시
        game.socket.emit('system.dx3rd-emanim', {
          type: 'setRangeHighlight',
          data: queueData
        });

        console.log(`범위 ${range}칸 하이라이트를 표시했습니다.`);
        return true;

      } catch (e) {
        console.error('DX3rd | Failed to show range highlight:', e);
        ui.notifications.error('범위 하이라이트 표시에 실패했습니다.');
        return false;
      }
    },

    /**
     * 범위 하이라이트 큐 처리
     * @param {Object} queueData - 큐 데이터
     */
    async processRangeHighlightQueue(queueData) {
      try {
        // 기존 하이라이트 제거
        this.clearRangeHighlight();
        
        // 기존 타임아웃 제거
        if (this.rangeHighlightQueue.timeout) {
          clearTimeout(this.rangeHighlightQueue.timeout);
        }

        // 새 큐 설정
        this.rangeHighlightQueue.current = queueData;
        
        // 토큰 찾기
        const token = canvas.tokens?.placeables?.find(t => t.id === queueData.tokenId);
        if (!token) {
          return;
        }


        // 토큰 로컬 하이라이트 레이어 초기화
        this.initializeTokenRangeLayer(token);

        // 범위 하이라이트 표시 (토큰 로컬 방식)
        if (queueData.range === 1) {
          // 인접 (거리 1)
          const adjacentGrids = this.getAdjacentGrids(token);
          for (const grid of adjacentGrids) {
            this.drawTokenLocalHighlight(token, grid.x, grid.y, canvas.grid.size, queueData.userColor);
          }
        } else {
          // 숫자 사정거리
          const rangeGrids = this.getGridsInRange(token, queueData.range);
          for (const grid of rangeGrids) {
            this.drawTokenLocalHighlight(token, grid.x, grid.y, canvas.grid.size, queueData.userColor);
          }
        }

        // 자동 제거 없음 - 공격/사용 버튼으로만 제거

      } catch (e) {
        console.error('DX3rd | Failed to process range highlight queue:', e);
      }
    },

    /**
     * 범위 하이라이트 큐 제거
     * @param {boolean} force - 권한 체크를 무시하고 강제로 클리어 (기본값: false)
     * @param {boolean} skipSocket - 소켓 전송을 건너뛸지 여부 (기본값: false, 소켓 이벤트로 호출된 경우 true)
     */
    clearRangeHighlightQueue(force = false, skipSocket = false) {
      try {
        // 권한 체크: 하이라이트를 생성한 사용자 또는 GM만 클리어 가능
        if (!force && this.rangeHighlightQueue.current) {
          const highlightUserId = this.rangeHighlightQueue.current.userId;
          const currentUserId = game.user.id;
          const isCreator = highlightUserId && highlightUserId === currentUserId;
          const isGM = game.user.isGM;
          
          if (!isCreator && !isGM) {
            // 생성자가 아니고 GM도 아니면 클리어 불가
            return;
          }
        }
        
        // 토큰 로컬 하이라이트 제거
        if (this.rangeHighlightQueue.current) {
          const token = canvas.tokens?.placeables?.find(t => t.id === this.rangeHighlightQueue.current.tokenId);
          if (token) {
            this.clearTokenRangeHighlight(token);
          }
        }
        
        // 기존 canvas 하이라이트도 제거 (fallback)
        this.clearRangeHighlight();
        
        // 큐 초기화
        this.rangeHighlightQueue.current = null;
        
        // 타임아웃 제거
        if (this.rangeHighlightQueue.timeout) {
          clearTimeout(this.rangeHighlightQueue.timeout);
          this.rangeHighlightQueue.timeout = null;
        }
        
        // 소켓 이벤트로 호출된 경우가 아니면 다른 사용자들에게도 소켓으로 전송
        if (!skipSocket) {
          game.socket.emit('system.dx3rd-emanim', {
            type: 'clearRangeHighlight'
          });
        }
        
      } catch (e) {
        console.error('DX3rd | Failed to clear range highlight queue:', e);
      }
    },

    /**
     * 인접 그리드 좌표 가져오기
     * @param {Token} token - 기준 토큰
     * @returns {Array} 인접 그리드 좌표 배열
     */
    getAdjacentGrids: function(token) {
      const grids = [];
      
      try {
        const doc = token.document;
        
        // ===== 1) 점유 셀(i,j) 계산 (상대/절대 자동 정규화) =====
        const snapped = doc.getSnappedPosition(); // {x,y}
        const baseOff = canvas.grid.getOffset({ x: snapped.x, y: snapped.y }); // {i,j}

        const rawOcc = doc.getOccupiedGridSpaceOffsets({
          x: snapped.x, y: snapped.y, width: doc.width, height: doc.height
        }); // [{i,j}, ...]
        
        if (!rawOcc?.length) {
          console.warn(`DX3rd | No occupied grid spaces found for token`);
          return grids;
        }

        const minI0 = Math.min(...rawOcc.map(c => c.i));
        const maxI0 = Math.max(...rawOcc.map(c => c.i));
        const minJ0 = Math.min(...rawOcc.map(c => c.j));
        const maxJ0 = Math.max(...rawOcc.map(c => c.j));
        const looksRelative =
          minI0 >= -1 && minJ0 >= -1 &&
          maxI0 <= (doc.width  + 1) &&
          maxJ0 <= (doc.height + 1);

        const occupied = (looksRelative
          ? rawOcc.map(({ i, j }) => ({ i: baseOff.i + i, j: baseOff.j + j }))
          : rawOcc.map(({ i, j }) => ({ i, j }))
        ).sort((a, b) => a.j - b.j || a.i - b.i);

        const key = (i, j) => `${i},${j}`;
        const occSet = new Set(occupied.map(c => key(c.i, c.j)));


        // ===== 2) 후보: 점유 박스의 1칸 테두리만 =====
        const minI = Math.min(...occupied.map(c => c.i));
        const maxI = Math.max(...occupied.map(c => c.i));
        const minJ = Math.min(...occupied.map(c => c.j));
        const maxJ = Math.max(...occupied.map(c => c.j));

        const candidates = [];
        for (let i = minI - 1; i <= maxI + 1; i++) {
          for (let j = minJ - 1; j <= maxJ + 1; j++) {
            // 점유칸도 포함하여 본인 위치도 하이라이트에 표시
            candidates.push({ i, j });
          }
        }

        // ===== 3) 거리 계산 (v13: measurePath로 gridSpaces=칸 수) =====
        const centerOf = ({ i, j }) => canvas.grid.getCenterPoint({ i, j });
        function gridDistCenters(a, b) {
          const res = canvas.grid.measurePath([a, b], { gridSpaces: true });
          if (typeof res === "number") return res;
          if (res && typeof res.distance === "number") return res.distance;
          if (Array.isArray(res) && res[0]?.distance != null) return res[0].distance;
          return 0;
        }

        const adjacent = [];
        for (const c of candidates) {
          const cC = centerOf(c);
          let dmin = Infinity;
          for (const o of occupied) {
            const d = gridDistCenters(centerOf(o), cC);
            if (d < dmin) dmin = d;
            if (dmin === 0) break;
          }
          if (dmin <= 1) adjacent.push(c); // 거리 0칸(본인 위치)과 1칸(인접) 포함
        }

        // 중복 제거 + 정렬
        const result = [...new Map(adjacent.map(c => [key(c.i, c.j), c])).values()]
          .sort((a, b) => a.j - b.j || a.i - b.i);


        // ===== 4) 인접 셀들을 픽셀 좌표로 변환 (벽 충돌 체크 포함) =====
        const tokenCenter = token.center;
        
        for (const { i, j } of result) {
          const centerPoint = centerOf({ i, j });
          
          // 벽 충돌 체크: 토큰 중심에서 그리드 중심까지
          const hasWall = this.checkWallCollision(tokenCenter, centerPoint);
          
          if (!hasWall) {
            grids.push({ x: centerPoint.x, y: centerPoint.y });
          }
        }

        
      } catch (e) {
        console.error('DX3rd | Failed to get adjacent grids using macro method', e);
        // Fallback: 기본 8방향 처리
        const tokenCenter = token.center;
        const centerX = tokenCenter.x;
        const centerY = tokenCenter.y;
        const gridSize = canvas.grid.size || 100;
        
        const offsets = [
          { dx: -1, dy: -1 }, { dx: 0, dy: -1 }, { dx: 1, dy: -1 },
          { dx: -1, dy: 0 },                      { dx: 1, dy: 0 },
          { dx: -1, dy: 1 },  { dx: 0, dy: 1 },  { dx: 1, dy: 1 }
        ];
        
        for (const { dx, dy } of offsets) {
          grids.push({
            x: centerX + (dx * gridSize),
            y: centerY + (dy * gridSize)
          });
        }
        console.log(`DX3rd | Fallback - Generated ${grids.length} adjacent cells`);
      }
      
      return grids;
    },

    /**
     * 특정 그리드 좌표에 토큰이 있는지 확인
     * @param {Object} gridPos - 그리드 좌표 { i, j } 또는 { x, y }
     * @param {Token} excludeToken - 제외할 토큰 (선택사항)
     * @returns {Token|null} 해당 위치의 토큰 또는 null
     */
    getTokenAtGrid: function(gridPos, excludeToken = null) {
      try {
        // 그리드 좌표를 픽셀 좌표로 변환
        let pixelPos;
        if (gridPos.i !== undefined && gridPos.j !== undefined) {
          // 그리드 좌표 (i, j)
          pixelPos = canvas.grid.getCenterPoint({ i: gridPos.i, j: gridPos.j });
        } else if (gridPos.x !== undefined && gridPos.y !== undefined) {
          // 픽셀 좌표 (x, y)
          pixelPos = { x: gridPos.x, y: gridPos.y };
        } else {
          console.warn('DX3rd | Invalid grid position:', gridPos);
          return null;
        }
        
        // 해당 위치의 모든 토큰 확인
        const tokens = canvas.tokens.placeables.filter(t => {
          if (excludeToken && t.id === excludeToken.id) return false;
          
          // 토큰의 점유 영역 확인
          const tokenBounds = t.bounds;
          const tokenCenter = t.center;
          
          // 그리드 좌표로 변환하여 거리 계산
          const tokenGrid = canvas.grid.getOffset({ x: tokenCenter.x, y: tokenCenter.y });
          const targetGrid = canvas.grid.getOffset({ x: pixelPos.x, y: pixelPos.y });
          
          // 거리가 0.5 이하면 같은 그리드로 간주
          const dx = tokenGrid.i - targetGrid.i;
          const dy = tokenGrid.j - targetGrid.j;
          const distance = Math.sqrt(dx * dx + dy * dy);
          
          return distance <= 0.5;
        });
        
        // 첫 번째 토큰 반환
        return tokens.length > 0 ? tokens[0] : null;
        
      } catch (e) {
        console.error('DX3rd | Failed to get token at grid:', e);
        return null;
      }
    },

    /**
     * 사정거리 내 그리드 좌표 가져오기
     * @param {Token} token - 기준 토큰
     * @param {number} range - 사정거리 (미터)
     * @returns {Array} 사정거리 내 그리드 좌표 배열
     */
    getGridsInRange: function(token, range) {
      const grids = [];
      
      try {
        const doc = token.document;
        
        // ===== 1) 점유 셀(i,j) 계산 (상대/절대 자동 정규화) =====
        const snapped = doc.getSnappedPosition(); // {x,y}
        const baseOff = canvas.grid.getOffset({ x: snapped.x, y: snapped.y }); // {i,j}

        const rawOcc = doc.getOccupiedGridSpaceOffsets({
          x: snapped.x, y: snapped.y, width: doc.width, height: doc.height
        }); // [{i,j}, ...]
        
        if (!rawOcc?.length) {
          console.warn(`DX3rd | No occupied grid spaces found for token`);
          return grids;
        }

        const minI0 = Math.min(...rawOcc.map(c => c.i));
        const maxI0 = Math.max(...rawOcc.map(c => c.i));
        const minJ0 = Math.min(...rawOcc.map(c => c.j));
        const maxJ0 = Math.max(...rawOcc.map(c => c.j));
        const looksRelative =
          minI0 >= -1 && minJ0 >= -1 &&
          maxI0 <= (doc.width  + 1) &&
          maxJ0 <= (doc.height + 1);

        const occupied = (looksRelative
          ? rawOcc.map(({ i, j }) => ({ i: baseOff.i + i, j: baseOff.j + j }))
          : rawOcc.map(({ i, j }) => ({ i, j }))
        ).sort((a, b) => a.j - b.j || a.i - b.i);

        const key = (i, j) => `${i},${j}`;
        const occSet = new Set(occupied.map(c => key(c.i, c.j)));


        // ===== 2) 후보: 점유 박스의 N칸 테두리까지 =====
        const minI = Math.min(...occupied.map(c => c.i));
        const maxI = Math.max(...occupied.map(c => c.i));
        const minJ = Math.min(...occupied.map(c => c.j));
        const maxJ = Math.max(...occupied.map(c => c.j));

        const candidates = [];
        for (let i = minI - range; i <= maxI + range; i++) {
          for (let j = minJ - range; j <= maxJ + range; j++) {
            // 점유칸도 포함하여 본인 위치도 하이라이트에 표시
            candidates.push({ i, j });
          }
        }

        // ===== 3) 거리 계산 (v13: measurePath로 gridSpaces=칸 수) =====
        const centerOf = ({ i, j }) => canvas.grid.getCenterPoint({ i, j });
        function gridDistCenters(a, b) {
          const res = canvas.grid.measurePath([a, b], { gridSpaces: true });
          if (typeof res === "number") return res;
          if (res && typeof res.distance === "number") return res.distance;
          if (Array.isArray(res) && res[0]?.distance != null) return res[0].distance;
          return 0;
        }

        const within = [];
        for (const c of candidates) {
          const cC = centerOf(c);
          let dmin = Infinity;
          for (const o of occupied) {
            const d = gridDistCenters(centerOf(o), cC);
            if (d < dmin) dmin = d;
            if (dmin === 0) break;
          }
          if (dmin >= 0 && dmin <= range) within.push({ ...c, dist: dmin }); // 거리 0칸(본인 위치) 포함
        }

        // 중복 제거 + 정렬
        const result = [...new Map(within.map(c => [key(c.i, c.j), c])).values()]
          .sort((a, b) => a.j - b.j || a.i - b.i);


        // ===== 4) 사정거리 내 셀들을 픽셀 좌표로 변환 (벽 충돌 체크 포함) =====
        const tokenCenter = token.center;
        
        for (const { i, j } of result) {
          const centerPoint = centerOf({ i, j });
          
          // 벽 충돌 체크: 토큰 중심에서 그리드 중심까지
          const hasWall = this.checkWallCollision(tokenCenter, centerPoint);
          
          if (!hasWall) {
            grids.push({ x: centerPoint.x, y: centerPoint.y });
          }
        }

        
      } catch (e) {
        console.error('DX3rd | Failed to get grids in range using macro method', e);
        // Fallback: 기본 픽셀 거리 계산
        const gridSize = canvas.grid.size;
        const rangeInPixels = range * (gridSize / canvas.dimensions.distance);
        const tokenCenter = token.center;
        const sceneWidth = canvas.dimensions.sceneWidth;
        const sceneHeight = canvas.dimensions.sceneHeight;
        
        const minX = Math.max(0, tokenCenter.x - rangeInPixels);
        const maxX = Math.min(sceneWidth, tokenCenter.x + rangeInPixels);
        const minY = Math.max(0, tokenCenter.y - rangeInPixels);
        const maxY = Math.min(sceneHeight, tokenCenter.y + rangeInPixels);
        
        for (let x = Math.floor(minX / gridSize) * gridSize; x <= maxX; x += gridSize) {
          for (let y = Math.floor(minY / gridSize) * gridSize; y <= maxY; y += gridSize) {
            const cellCenterX = x + gridSize / 2;
            const cellCenterY = y + gridSize / 2;
            
            const distance = Math.sqrt(
              Math.pow(cellCenterX - tokenCenter.x, 2) +
              Math.pow(cellCenterY - tokenCenter.y, 2)
            );
            
            if (distance <= rangeInPixels && distance > gridSize / 2) {
              grids.push({ x, y });
            }
          }
        }
      }
      
      return grids;
    },

    /**
     * 토큰에 범위 하이라이트 레이어 생성/초기화
     * @param {Token} token - 대상 토큰
     */
    initializeTokenRangeLayer(token) {
      try {
        // 기존 레이어가 있으면 제거
        if (token._dx3rdRangeLayer) {
          token.removeChild(token._dx3rdRangeLayer);
          token._dx3rdRangeLayer.destroy();
        }
        
        // 새 레이어 생성
        const layer = new PIXI.Container();
        layer.name = 'dx3rd-range-highlight';
        
        // 토큰 이미지 아래에 표시되도록 매우 낮은 zIndex 설정
        layer.zIndex = -10;
        
        // 토큰에 레이어 추가 (맨 앞에 추가하여 zIndex가 적용되도록)
        token.addChildAt(layer, 0);
        token._dx3rdRangeLayer = layer;
        
        return layer;
        
      } catch (e) {
        console.error('DX3rd | Failed to initialize token range layer:', e);
        return null;
      }
    },

    /**
     * 토큰 로컬 좌표에 하이라이트 그리기
     * @param {Token} token - 대상 토큰
     * @param {number} worldX - 월드 X 좌표
     * @param {number} worldY - 월드 Y 좌표
     * @param {number} size - 그리드 크기
     */
    drawTokenLocalHighlight(token, worldX, worldY, size, userColor = null) {
      try {
        // 토큰 레이어 초기화
        if (!token._dx3rdRangeLayer) {
          this.initializeTokenRangeLayer(token);
        }
        
        const layer = token._dx3rdRangeLayer;
        if (!layer) {
          console.warn('DX3rd | Failed to get token range layer');
          return null;
        }
        
        // 월드 좌표를 토큰 좌상단 기준 상대 좌표로 변환 (grid 정렬 정확도 향상)
        const originX = token.x; // 토큰 좌상단 X (월드 좌표)
        const originY = token.y; // 토큰 좌상단 Y (월드 좌표)
        const relativeX = worldX - originX;
        const relativeY = worldY - originY;
        
        // 하이라이트 그래픽 생성
        const graphics = new PIXI.Graphics();
        graphics.name = 'range-highlight';
        
        const gridType = canvas.grid.type;
        
        // 색상 결정: userColor가 전달되면 사용, 아니면 기본 녹색
        let colorValue = 0x00FF00; // 기본 녹색
        
        if (userColor !== null) {
            // 큐 데이터에서 전달된 사용자 색상 사용
            colorValue = userColor;
        }
        
        graphics.beginFill(colorValue, 0.2); // 투명도는 0.2로 고정
        
        if (gridType === CONST.GRID_TYPES.SQUARE || gridType === CONST.GRID_TYPES.GRIDLESS) {
          // 정사각형 그리드: 사각형 (90% 크기)
          const highlightSize = size * 0.90;
          const halfSize = highlightSize / 2;
          graphics.drawRect(relativeX - halfSize, relativeY - halfSize, highlightSize, highlightSize);
        } else if (gridType === CONST.GRID_TYPES.HEXODDR || 
                   gridType === CONST.GRID_TYPES.HEXEVENR ||
                   gridType === CONST.GRID_TYPES.HEXODDQ ||
                   gridType === CONST.GRID_TYPES.HEXEVENQ) {
          // 육각형 그리드: 실제 육각형 모양으로 하이라이트
          this.drawTokenLocalHexHighlight(graphics, relativeX, relativeY, size);
        }
        
        graphics.endFill();
        
        // 토큰 레이어에 추가
        layer.addChild(graphics);
        
        return graphics;
        
      } catch (e) {
        console.error('DX3rd | Failed to draw token local highlight:', e);
        return null;
      }
    },

    /**
     * 토큰 로컬 좌표에 육각형 하이라이트 그리기
     * @param {PIXI.Graphics} graphics - PIXI Graphics 객체
     * @param {number} centerX - 로컬 중심 X 좌표
     * @param {number} centerY - 로컬 중심 Y 좌표
     * @param {number} size - 그리드 크기
     */
    drawTokenLocalHexHighlight(graphics, centerX, centerY, size) {
      try {
        const radius = (size / 2) * 0.90; // 90% 크기
        const gridType = canvas.grid.type;
        
        // 그리드 타입에 따라 다른 Hex 모양 사용
        if (gridType === CONST.GRID_TYPES.HEXODDR || gridType === CONST.GRID_TYPES.HEXEVENR) {
          // Hex Row: 30도 회전된 육각형
          const points = [];
          for (let i = 0; i < 6; i++) {
            const angle = (Math.PI / 3) * i + Math.PI / 6; // 60도씩 + 30도 회전
            const pointX = centerX + radius * Math.cos(angle);
            const pointY = centerY + radius * Math.sin(angle);
            points.push(pointX, pointY);
          }
          graphics.drawPolygon(points);
        } else if (gridType === CONST.GRID_TYPES.HEXODDQ || gridType === CONST.GRID_TYPES.HEXEVENQ) {
          // Hex Column: 기존 정육각형
          const points = [];
          for (let i = 0; i < 6; i++) {
            const angle = (Math.PI / 3) * i; // 60도씩 (회전 없음)
            const pointX = centerX + radius * Math.cos(angle);
            const pointY = centerY + radius * Math.sin(angle);
            points.push(pointX, pointY);
          }
          graphics.drawPolygon(points);
        }
        
        
      } catch (e) {
        console.error('DX3rd | Failed to draw token local hex highlight', e);
        // Fallback: 원형으로 대체 (90% 크기)
        const radius = (size / 2) * 0.90;
        graphics.drawCircle(centerX, centerY, radius);
      }
    },

    /**
     * 토큰의 범위 하이라이트 제거
     * @param {Token} token - 대상 토큰
     */
    clearTokenRangeHighlight(token) {
      try {
        if (token._dx3rdRangeLayer) {
          // 레이어의 모든 하이라이트 제거
          token._dx3rdRangeLayer.removeChildren().forEach(child => {
            if (child.destroy) child.destroy();
          });
        }
      } catch (e) {
        console.error('DX3rd | Failed to clear token range highlight:', e);
      }
    },

    /**
     * 그리드 하이라이트 그리기
     * @param {number} x - 그리드 X 좌표
     * @param {number} y - 그리드 Y 좌표
     * @param {number} size - 그리드 크기
     */
    drawGridHighlight: function(x, y, size) {
      if (!window.DX3rdRangeHighlight) {
        window.DX3rdRangeHighlight = [];
      }
      
      const graphics = new PIXI.Graphics();
      const gridType = canvas.grid.type;
      
      
      graphics.beginFill(0x00FF00, 0.2);
      
      if (gridType === CONST.GRID_TYPES.SQUARE || gridType === CONST.GRID_TYPES.GRIDLESS) {
        // 정사각형 그리드 또는 그리드리스: 사각형 (중심점 기준, 1px 안쪽)
        const centerX = x; // 이미 중심점
        const centerY = y; // 이미 중심점
        const halfSize = (size / 2) - 1; // 1px 안쪽
        graphics.drawRect(centerX - halfSize, centerY - halfSize, size - 2, size - 2);
      } else if (gridType === CONST.GRID_TYPES.HEXODDR || 
                 gridType === CONST.GRID_TYPES.HEXEVENR ||
                 gridType === CONST.GRID_TYPES.HEXODDQ ||
                 gridType === CONST.GRID_TYPES.HEXEVENQ) {
        // 육각형 그리드: 실제 육각형 모양으로 하이라이트
        this.drawHexHighlight(graphics, x, y, size);
      }
      
      graphics.endFill();
      
      // Canvas의 그리드 레이어에 추가
      canvas.interface.grid.addChild(graphics);
      window.DX3rdRangeHighlight.push(graphics);
      
    },

    /**
     * 육각형 하이라이트 그리기
     * @param {PIXI.Graphics} graphics - PIXI Graphics 객체
     * @param {number} x - 그리드 X 좌표
     * @param {number} y - 그리드 Y 좌표
     * @param {number} size - 그리드 크기
     */
    drawHexHighlight: function(graphics, x, y, size) {
      try {
        // x, y가 이미 그리드의 중심점이므로 그대로 사용
        const centerX = x;
        const centerY = y;
        
        // 그리드 타입에 따라 다른 Hex 모양 사용
        const gridType = canvas.grid.type;
        
        if (gridType === CONST.GRID_TYPES.HEXODDR || gridType === CONST.GRID_TYPES.HEXEVENR) {
          // Hex Row: 좌우로 긴 육각형 (평평한 면이 위아래)
          this.drawHexRowHighlight(graphics, centerX, centerY, size);
        } else if (gridType === CONST.GRID_TYPES.HEXODDQ || gridType === CONST.GRID_TYPES.HEXEVENQ) {
          // Hex Column: 위아래로 긴 육각형 (뾰족한 면이 위아래)
          this.drawHexColumnHighlight(graphics, centerX, centerY, size);
        } else {
          // 기본 Hex 모양 (기존과 동일)
          this.drawDefaultHexHighlight(graphics, centerX, centerY, size);
        }
        
      } catch (e) {
        console.error('DX3rd | Failed to draw hex highlight', e);
        // Fallback: 원형으로 대체
        const centerX = x;
        const centerY = y;
        const radius = (size / 2) - 2;
        graphics.drawCircle(centerX, centerY, radius);
      }
    },

    /**
     * Hex Row 하이라이트 그리기 (30도 회전된 육각형)
     * @param {PIXI.Graphics} graphics - PIXI Graphics 객체
     * @param {number} centerX - 중심 X 좌표
     * @param {number} centerY - 중심 Y 좌표
     * @param {number} size - 그리드 크기
     */
    drawHexRowHighlight: function(graphics, centerX, centerY, size) {
      // Hex Row: 정육각형을 30도 회전 (평평한 면이 위아래가 되도록)
      const radius = (size / 2) - 1;
      
      // 육각형 꼭짓점 계산 (30도 회전: Math.PI/6)
      const points = [];
      for (let i = 0; i < 6; i++) {
        const angle = (Math.PI / 3) * i + Math.PI / 6; // 60도씩 + 30도 회전
        const pointX = centerX + radius * Math.cos(angle);
        const pointY = centerY + radius * Math.sin(angle);
        points.push(pointX, pointY);
      }
      
      graphics.drawPolygon(points);
    },

    /**
     * Hex Column 하이라이트 그리기 (기존 정육각형 그대로)
     * @param {PIXI.Graphics} graphics - PIXI Graphics 객체
     * @param {number} centerX - 중심 X 좌표
     * @param {number} centerY - 중심 Y 좌표
     * @param {number} size - 그리드 크기
     */
    drawHexColumnHighlight: function(graphics, centerX, centerY, size) {
      // Hex Column: 기존 정육각형 모양 그대로 (뾰족한 면이 위아래)
      const radius = (size / 2) - 1;
      
      // 육각형 꼭짓점 계산 (기존과 동일)
      const points = [];
      for (let i = 0; i < 6; i++) {
        const angle = (Math.PI / 3) * i; // 60도씩 (회전 없음)
        const pointX = centerX + radius * Math.cos(angle);
        const pointY = centerY + radius * Math.sin(angle);
        points.push(pointX, pointY);
      }
      
      graphics.drawPolygon(points);
    },

    /**
     * 기본 Hex 하이라이트 그리기 (정육각형)
     * @param {PIXI.Graphics} graphics - PIXI Graphics 객체
     * @param {number} centerX - 중심 X 좌표
     * @param {number} centerY - 중심 Y 좌표
     * @param {number} size - 그리드 크기
     */
    drawDefaultHexHighlight: function(graphics, centerX, centerY, size) {
      // 기본 정육각형 (기존 코드)
      const radius = (size / 2) - 1;
      
      const points = [];
      for (let i = 0; i < 6; i++) {
        const angle = (Math.PI / 3) * i; // 60도씩
        const pointX = centerX + radius * Math.cos(angle);
        const pointY = centerY + radius * Math.sin(angle);
        points.push(pointX, pointY);
      }
      
      graphics.drawPolygon(points);
    },

    /**
     * 사정거리 하이라이트 제거
     */
    clearRangeHighlight: function() {
      if (window.DX3rdRangeHighlight && window.DX3rdRangeHighlight.length > 0) {
        for (const graphics of window.DX3rdRangeHighlight) {
          try {
            canvas.interface.grid.removeChild(graphics);
            graphics.destroy();
          } catch (e) {
            console.warn('DX3rd | Failed to remove highlight', e);
          }
        }
        window.DX3rdRangeHighlight = [];
      }
    },
    
    /**
     * 두 지점 사이에 벽 충돌이 있는지 확인
     * @param {Point} origin - 시작 지점 {x, y}
     * @param {Point} target - 목표 지점 {x, y}
     * @returns {boolean} 벽 충돌 여부
     */
    checkWallCollision: function(origin, target) {
      try {
        // 캔버스나 벽이 없으면 충돌 없음으로 처리
        if (!canvas || !canvas.walls) return false;
        
        // 이동을 막는 벽만 체크 (MOVEMENT 타입)
        // Ray 객체는 사용하지 않으므로 제거 (v13 호환성)
        const collision = CONFIG.Canvas.polygonBackends.move.testCollision(origin, target, {
          type: 'move',
          mode: 'any'
        });
        
        return collision;
      } catch (e) {
        console.warn('DX3rd | Wall collision check failed:', e);
        return false; // 에러 시 충돌 없음으로 처리
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
     */
    async openComboBuilder(actor, targetType, targetId, weaponItem = null, options = {}) {
      // 액터 보유 이펙트 목록 수집 (정렬 포함)
      const effects = actor.items.filter(i => i.type === 'effect');
      const effectList = effects.sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0)).map(i => i.toObject());

      // targetType이 'ability'인 경우 key는 targetId, base는 없음
      // targetType이 'skill'인 경우 key는 targetId, base는 사용자가 선택
      let targetKey = targetId;
      let targetBase = '-'; // 자동 설정하지 않고 항상 "-"로 시작
      
      // 무기의 type을 attackRoll 초기값으로 사용
      let initialAttackRoll = '-';
      if (weaponItem && weaponItem.system?.type) {
        const weaponType = weaponItem.system.type;
        if (weaponType === 'melee' || weaponType === 'ranged') {
          initialAttackRoll = weaponType;
        }
      }

      // 스킬 정렬
      const sortedSkills = this._getSortedSkillOptions(actor);

      const content = await renderTemplate('systems/dx3rd-emanim/templates/dialog/combo-dialog.html', {
        title: game.i18n.localize('DX3rd.Combo'),
        actor: actor,
        actorSkills: actor.system?.attributes?.skills || {},
        sortedSkills: sortedSkills,
        effectList,
        targetType: targetType,
        targetKey: targetKey,
        targetBase: targetBase,
        initialAttackRoll: initialAttackRoll
      });

      const DialogV2 = foundry.applications?.api?.DialogV2;
      if (!DialogV2) {
        ui.notifications.error(game.i18n.localize('DX3rd.DialogV2Unavailable'));
        return;
      }

      // 다이얼로그에서 선택된 값들을 콤보 구성으로 정규화한다. Apply(즉석 사용)와 Save(콤보 저장)가 공유한다.
      const collectComboConfig = (root) => {
        // 선택된 이펙트 ID 수집 (선택하지 않아도 진행 가능)
        const selectedEffectIds = Array.from(root?.querySelectorAll('.active-effect:checked') || [])
          .map(el => el.dataset.id)
          .filter(Boolean);

        // 다이얼로그 값 수집
        const skill = root?.querySelector('#skill')?.value || '-';
        const base = root?.querySelector('#base')?.value || '-';
        const roll = root?.querySelector('#roll')?.value || 'major';
        const attackRoll = root?.querySelector('#attackRoll')?.value || '-';

        // 무기 아이템이 전달된 경우 (무기 공격에서 콤보 사용 시)
        let weaponSetting = ['-', '-', '-'];
        let shouldShowWeaponSelect = attackRoll !== '-';
        if (weaponItem && attackRoll !== '-') {
          // 무기가 선택되어 있으면 해당 무기를 첫 번째 슬롯에 등록
          weaponSetting = [weaponItem.id, '-', '-'];
          // 무기 아이템에서 시작한 경우에는 무기 선택 다이얼로그를 띄우지 않음
          shouldShowWeaponSelect = false;
        }

        // 선택된 이펙트들 중에서 weaponSelect: false이고 무기가 등록된 이펙트가 있는지 확인
        if (attackRoll !== '-' && !weaponItem && selectedEffectIds.length > 0) {
          for (const effectId of selectedEffectIds) {
            const effectItem = actor.items.get(effectId);
            if (effectItem && !effectItem.system?.weaponSelect && effectItem.system?.weapon && effectItem.system.weapon.length > 0) {
              // 이펙트의 무기 설정 상속
              const effectWeapons = effectItem.system.weapon.filter(w => w && w !== '-');
              if (effectWeapons.length > 0) {
                // 첫 번째 이펙트의 무기만 상속 (최대 3개)
                weaponSetting = [effectWeapons[0] || '-', effectWeapons[1] || '-', effectWeapons[2] || '-'];
                shouldShowWeaponSelect = false;
                console.log('DX3rd | Combo Builder - Inherited weaponSelect: false from effect:', effectItem.name, 'weapons:', weaponSetting);
                break;
              }
            }
          }
        }

        // 룰 807-809(이펙트의 조합·침식치 합계): 조합한 이펙트들의 침식치를 모두 더한 값.
        const encroachValue = window.DX3rdComboData?.calculateEncroachment?.(actor, selectedEffectIds) ?? '0';

        console.log('DX3rd | Combo Builder - Config:', { skill, base, roll, attackRoll, selectedEffectIds, weaponSetting, shouldShowWeaponSelect, encroachValue });
        return { selectedEffectIds, skill, base, roll, attackRoll, weaponSetting, shouldShowWeaponSelect, encroachValue };
      };

      const dialog = new DialogV2({
        window: { title: game.i18n.localize('DX3rd.Combo') },
        content,
        position: { width: 700 },
        classes: [ 'dx3rd-emanim', 'combo-dialog' ],
        buttons: [
          {
            action: 'apply',
            icon: '<i class="fas fa-dice-d20"></i>',
            label: game.i18n.localize('DX3rd.Apply'),
            default: true,
            callback: async (event, button) => {
              const root = button.form || button.element?.closest('.application') || button.element?.ownerDocument;
              const cfg = collectComboConfig(root);

              // 임시 콤보 아이템 데이터 생성
              const tempComboItem = {
                id: '_temp_combo_' + Date.now(),
                name: `${game.i18n.localize('DX3rd.Combo')} ${game.i18n.localize('DX3rd.TemporaryItem')}`,
                type: 'combo',
                system: {
                  skill: cfg.skill,
                  base: cfg.base,
                  roll: cfg.roll,
                  attackRoll: cfg.attackRoll,
                  effect: {
                    data: cfg.selectedEffectIds
                  },
                  // 기본값들 추가
                  weapon: cfg.weaponSetting, // 무기 ID 배열 [id, '-', '-'] 또는 ['-', '-', '-']
                  weaponSelect: cfg.shouldShowWeaponSelect, // 무기 아이템에서 시작한 경우 false, 일반 경우 attackRoll이 '-'가 아니면 true
                  getTarget: true,
                  // 룰 807-809 침식치 합계. 임시 콤보에 이 필드가 없어 침식치 미부과되던 문제(감사 Finding H) 보정.
                  encroach: {
                    value: cfg.encroachValue
                  },
                  level: { value: 1 }
                },
                // 북 해독 콤보 등에서 사용할 메타 데이터
                meta: {
                  isBookDecipher: !!options.isBookDecipher,
                  originalItem: options.originalItem || null,
                  predefinedDifficulty: options.predefinedDifficulty || null
                },
                // 임시 아이템이므로 필요한 메서드들 추가
                getFlag: () => null,
                setFlag: () => {},
                unsetFlag: () => {},
                // 무기 아이템에서 시작한 경우 원본 무기 아이템 정보 저장
                _originalWeaponItem: weaponItem || null
              };

              // ComboHandler 호출
              if (window.DX3rdComboHandler) {
                await window.DX3rdComboHandler.handle(actor.id, tempComboItem);
              } else {
                ui.notifications.error('ComboHandler를 찾을 수 없습니다.');
              }
            }
          },
          {
            action: 'save',
            icon: '<i class="fas fa-save"></i>',
            label: game.i18n.localize('DX3rd.SaveAsCombo'),
            // 즉석 조합을 반복 사용 가능한 저장 콤보 아이템으로 등록한다(임시 콤보 휘발성 해소).
            callback: async (event, button) => {
              const root = button.form || button.element?.closest('.application') || button.element?.ownerDocument;
              const cfg = collectComboConfig(root);

              if (cfg.selectedEffectIds.length === 0) {
                ui.notifications.warn(game.i18n.localize('DX3rd.ComboSaveNoEffect'));
                return;
              }

              // 저장 콤보는 effectIds(배열) 형식으로 저장한다. combo-sheet/normalizeEffectIds가 이 형식을 우선 읽는다.
              const comboData = {
                name: game.i18n.localize('DX3rd.Combo'),
                type: 'combo',
                system: {
                  skill: cfg.skill,
                  base: cfg.base,
                  roll: cfg.roll,
                  attackRoll: cfg.attackRoll,
                  effectIds: cfg.selectedEffectIds,
                  weapon: cfg.weaponSetting,
                  weaponSelect: cfg.shouldShowWeaponSelect,
                  getTarget: true,
                  encroach: { value: cfg.encroachValue },
                  level: { value: 1 }
                }
              };

              try {
                const [created] = await actor.createEmbeddedDocuments('Item', [comboData]);
                ui.notifications.info(game.i18n.format('DX3rd.ComboSaved', { name: created?.name ?? '' }));
                // 이름/세부 조정을 위해 방금 만든 콤보 시트를 연다.
                created?.sheet?.render(true);
              } catch (e) {
                console.error('DX3rd | Combo Builder - Save failed:', e);
                ui.notifications.error(`${game.i18n.localize('DX3rd.SaveAsCombo')}: ${e?.message || e}`);
              }
            }
          }
        ]
      });

      const rendered = dialog.render(true);
      // 렌더 후 코스트(침식치) 실시간 미리보기 배선. 이펙트 체크 변경 시 합산 침식치를 갱신 표시한다.
      Promise.resolve(rendered).then(() => {
        const root = dialog.element;
        if (!root) return;
        const encSpan = root.querySelector('#combo-cost-preview .preview-enc');
        if (!encSpan) return;
        const updatePreview = () => {
          const ids = Array.from(root.querySelectorAll('.active-effect:checked'))
            .map(el => el.dataset.id)
            .filter(Boolean);
          encSpan.textContent = window.DX3rdComboData?.calculateEncroachment?.(actor, ids) ?? '0';
        };
        root.querySelectorAll('.active-effect').forEach(cb => cb.addEventListener('change', updatePreview));
        updatePreview();
      });
    },
    
    showStatRollConfirmDialog(actor, targetType, targetId, openComboBuilderCallback, specificRollType = null) {
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
      
      const title = game.i18n.localize('DX3rd.Combo');
      const openCombo = async () => {
        if (openComboBuilderCallback) {
          return openComboBuilderCallback(targetType, targetId);
        }
        // 콜백이 없으면 직접 openComboBuilder 호출
        return this.openComboBuilder(actor, targetType, targetId);
      };
      const rollDirectly = () => this.showStatRollDialog(actor, stat, label, specificRollType);

      const DialogV2 = foundry.applications?.api?.DialogV2;
      if (!DialogV2?.confirm) {
        ui.notifications.error(game.i18n.localize('DX3rd.DialogV2Unavailable'));
        return;
      }

      DialogV2.confirm({
        window: { title },
        content: `<p>${title}?</p>`,
        yes: {
          label: 'Yes',
          callback: async () => {
            await openCombo();
            return true;
          }
        },
        no: {
          label: 'No',
          callback: () => {
            rollDirectly();
            return false;
          }
        },
        defaultYes: false,
        rejectClose: false
      });
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
    async showStatRollDialog(actor, stat, label, specificRollType = null, item = null, previousToken = null, weaponBonus = null, comboAfterSuccessData = null, comboAfterDamageData = null, predefinedDifficulty = null, requireDifficulty = false, isUrgeTest = false, afterRollCallback = null, isPanicTest = false) {
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
      const panic8Applied = actor.system?.attributes?.applied?.Panic8;
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
        
        console.log('DX3rd | Applied weapon bonus to stat', {
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
            console.log(`DX3rd | Fear penalty for attack roll: ${fearTarget} is in targets (-2 dice)`);
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
              
              console.log(`DX3rd | Berserk distaste penalty: ${adjacentTokenName} is adjacent (-10 add)`);
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
              console.log(`DX3rd | Panic 8 (Dependency) penalty: No matching Rois token in engage range (-4 dice)`);
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
      const attackSign = weaponBonus && weaponBonus.attack >= 0 ? '+' : '';
      const addSign = weaponBonus && weaponBonus.add >= 0 ? '+' : '';
      
      const content = `
        <div class="dx3rd-casting-dialog">
          <div class="dx3rd-row dx3rd-3col">
            <div>
              <div class="label">${game.i18n.localize('DX3rd.Dice')}</div>
              <input type="text" class="dx-dice-display" value="${effectiveStat.dice || 0}" disabled>
              <input type="number" class="dx-dice-input" value="0" placeholder="추가">
            </div>
            <div>
              <div class="label">${game.i18n.localize('DX3rd.Critical')}</div>
              <input type="text" class="dx-critical-display" value="${effectiveStat.critical || defaultCritical}" disabled>
              <input type="number" class="dx-critical-input" value="0" placeholder="수정">
            </div>
            <div>
              <div class="label">${game.i18n.localize('DX3rd.Add')}</div>
              <input type="text" class="dx-add-display" value="${effectiveStat.add || 0}" disabled>
              <input type="number" class="dx-add-input" value="0" placeholder="추가">
            </div>
          </div>
          ${hasWeaponOrPenalty ? '<hr style="margin: 12px 0; border: none; border-top: 1px solid #ccc;">' : ''}
          ${weaponBonus ? `<div class="dx3rd-mb-4 dx3rd-p-6 dx3rd-text-small dx3rd-bold" style="text-align: center;">
            무기: ${weaponBonus.weaponName} (공격력 ${attackSign}${weaponBonus.attack}, 수정치 ${addSign}${weaponBonus.add})
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
        classes: ['dx3rd-emanim','dx3rd-rolling-dialog'],
        buttons: [{
          action: 'noop',
          label: '',
          callback: () => {}
        }]
      });
      await dlg.render(true);

      const root = dlg.element;
      if (!root) return;
      const noopButton = root.querySelector('button[data-action="noop"]');
      const noopFooter = noopButton?.closest('footer');
      if (noopButton) noopButton.hidden = true;
      if (noopFooter) noopFooter.hidden = true;

      const diceDisplay = root.querySelector('.dx-dice-display');
      const diceInput = root.querySelector('.dx-dice-input');
      const critDisplay = root.querySelector('.dx-critical-display');
      const critInput = root.querySelector('.dx-critical-input');
      const addDisplay = root.querySelector('.dx-add-display');
      const addInput = root.querySelector('.dx-add-input');

      // 현재 선택된 타입의 기본값 업데이트 함수
      const updateDisplayValues = (t) => {
        const data = effectiveStat[t] || { dice: effectiveStat.dice||0, critical: effectiveStat.critical||defaultCritical, add: effectiveStat.add||0 };
        const baseDice = data.dice || 0;
        const baseCrit = data.critical || defaultCritical;
        const baseAdd = data.add || 0; // effectiveStat.add가 이미 무기 보너스가 적용된 값

        // 사용자 입력값 가져오기
        const diceModifier = parseInt(diceInput?.value) || 0;
        const critModifier = parseInt(critInput?.value) || 0;
        const addModifier = parseInt(addInput?.value) || 0;

        // 기본값 + 입력값 + 공포 패널티 표시 (의존 패널티는 이미 effectiveStat.dice에 적용됨)
        // 룰(rule-section:39-41): 실제 판정치를 그대로 표시(0 이하면 자동실패 예고). 하한 클램프 없음.
        const displayDice = baseDice + diceModifier + fearPenalty;
        if (diceDisplay) diceDisplay.value = displayDice;
        if (critDisplay) critDisplay.value = baseCrit + critModifier;
        if (addDisplay) addDisplay.value = baseAdd + addModifier + distastePenalty;

        return { baseDice: baseDice + fearPenalty, baseCrit, baseAdd: baseAdd + distastePenalty };
      };

      // 입력 필드 변경 시 디스플레이 업데이트
      const updateSelectedDisplay = () => {
        const selectedBtn = root.querySelector('.roll-type-btn.selected');
        if (selectedBtn) {
          updateDisplayValues(selectedBtn.dataset.rollType);
        }
      };
      diceInput?.addEventListener('input', updateSelectedDisplay);
      critInput?.addEventListener('input', updateSelectedDisplay);
      addInput?.addEventListener('input', updateSelectedDisplay);

      const btns = Array.from(root.querySelectorAll('.roll-type-btn'));

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
            
            // updateDisplayValues를 호출하여 현재 표시값 가져오기 (공포 패널티 포함)
            const { baseDice, baseCrit, baseAdd } = updateDisplayValues(t);
            
            // 사용자 입력 추가
            const diceModifier = parseInt(diceInput?.value) || 0;
            const critModifier = parseInt(critInput?.value) || 0;
            const addModifier = parseInt(addInput?.value) || 0;
            
            // 최종 계산 (baseDice에 이미 공포 패널티가 포함됨)
            // 룰(rule-section:39-41): 하한 없이 원 판정치를 전달 → 롤 실행부가 0 이하면 자동실패 처리
            const finalDice = baseDice + diceModifier;
            const finalCrit = Math.max(2, baseCrit + critModifier);
            const finalAdd = baseAdd + addModifier;
            
            console.log('DX3rd | Roll button clicked - values:', {
              rollType: t,
              baseDice,
              diceModifier,
              finalDice,
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
              await this.executeAttackRoll(actor, item, label, previousToken, finalDice, finalCrit, finalAdd);
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
                  await this.executeAttackRoll(actor, originalWeaponItem, label, weaponToken, finalDice, finalCrit, finalAdd);
                  return;
                }
              }
              
              // 공격 판정이지만 executeAttackRoll로 가지 않는 경우 (콤보/이펙트 등)
              // 난이도 없이 executeStatRoll 호출
              const difficultyData = { type: 'none', value: 0 };
              await this.executeStatRoll(actor, finalDice, finalCrit, finalAdd, label, t, difficultyData, item, previousToken, weaponBonus, comboAfterSuccessData, comboAfterDamageData);
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
              
              await this.executeStatRoll(actor, finalDice, finalCrit, finalAdd, label, t, difficultyData, item, previousToken, weaponBonus, comboAfterSuccessData, comboAfterDamageData, isUrgeTest, afterRollCallback, isPanicTest);
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
    async executeStatRoll(actor, dice, critical, add, label, rollType, difficultyData = { type: 'none', value: 0 }, item = null, previousToken = null, weaponBonus = null, comboAfterSuccessData = null, comboAfterDamageData = null, isUrgeTest = false, afterRollCallback = null, isPanicTest = false) {
      const typeLabelMap = {
        major: game.i18n.localize('DX3rd.Major'),
        reaction: game.i18n.localize('DX3rd.Reaction'),
        dodge: game.i18n.localize('DX3rd.DodgeRoll')
      };
      const typeText = typeLabelMap[rollType] || '';
      let flavorText = '';
      
      // 충동 판정인 경우
      if (isUrgeTest) {
        flavorText = `${game.i18n.localize('DX3rd.UrgeTest')} - ${label}${typeText ? `(${typeText})` : ''}`;
      } else if (isPanicTest) {
        // 공포 판정인 경우
        flavorText = `${game.i18n.localize('DX3rd.PanicTest')} - ${label}${typeText ? `(${typeText})` : ''}`;
      } else if (item) {
        // 아이템이 있는 경우: 기능(타이밍)만 표시 (아이템 사용 메시지는 이미 출력됨)
        flavorText = `${label}${typeText ? `(${typeText})` : ''}`;
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
        flavorText += `<br>무기: ${weaponBonus.weaponName}`;
      }
      
      try {
        // 무기 보너스 처리 (null이면 0으로 간주)
        const effectiveWeaponBonus = weaponBonus || { attack: 0, add: 0 };
        
        // 공격 판정인 경우 현재 시점의 값들 보존
        let preservedValues = null;
        const isAttackRoll = item && item.system?.attackRoll && 
                             item.system.attackRoll !== '-' && 
                             (item.system.attackRoll === 'melee' || item.system.attackRoll === 'ranged');
        
        if (isAttackRoll) {
          // 공격 타입 확인
          const attackRollType = item.system.attackRoll;
          
          // 공격 타입에 맞는 attack 보너스 계산
          let attackBonus = actor.system.attributes.attack?.value || 0;
          if (attackRollType === 'melee' && actor.system.attributes.attack?.melee) {
            attackBonus += actor.system.attributes.attack.melee;
          } else if (attackRollType === 'ranged' && actor.system.attributes.attack?.ranged) {
            attackBonus += actor.system.attributes.attack.ranged;
          }
          // 맨손 한정 공격력(축퇴기관 등): weapon-for-attack로 맨손을 선택한 경우만 가산
          const fistNameForAtk = game.i18n.localize('DX3rd.Fist');
          const wName = weaponBonus?.weaponName || '';
          if (wName === fistNameForAtk || wName.includes(`[${fistNameForAtk}]`)) {
            attackBonus += Number(actor.system.attributes.attack?.fist) || 0;
          }

          // 공격 타입에 맞는 damage_roll 보너스 계산
          let damageRollBonus = actor.system.attributes.damage_roll?.value || 0;
          if (attackRollType === 'melee' && actor.system.attributes.damage_roll?.melee) {
            damageRollBonus += actor.system.attributes.damage_roll.melee;
          } else if (attackRollType === 'ranged' && actor.system.attributes.damage_roll?.ranged) {
            damageRollBonus += actor.system.attributes.damage_roll.ranged;
          }
          
          preservedValues = {
            actorAttack: attackBonus,
            actorDamageRoll: damageRollBonus,
            actorPenetrate: actor.system.attributes.penetrate?.value || 0,
            weaponAttack: effectiveWeaponBonus.attack || 0 // 무기 보너스 (null이면 0)
          };
        }
        
        // 주사위 굴림 (침식률 증가는 이미 EffectHandler에서 처리됨)
        // 룰(rule-section:39-41): 수정 결과 판정치가 0 이하면 판정은 자동실패(달성치 0).
        // 실제 애니메이션을 위해 최소 1다이스는 굴리되, 결과는 아래에서 0으로 확정한다.
        const autoFailByPool = dice <= 0;
        const finalDice = Math.max(1, dice);
        // 달성치 D10 굴림(달성치에 +[N]D10 모델): 판정 시 Nd10 굴려 달성치(add)에 가산하고 채팅 공개.
        let add2 = add;
        const dxRollN = Number(actor.system.attributes.dxroll?.value || 0);
        if (dxRollN > 0) {
          try {
            const dr = await (new Roll(`${dxRollN}d10`)).evaluate();
            add2 += Number(dr.total) || 0;
            await dr.toMessage({
              speaker: ChatMessage.getSpeaker({ actor }),
              flavor: `${game.i18n.localize('DX3rd.DxRoll')} (${dxRollN}D10) → +${dr.total}`
            });
          } catch (e) { console.warn('DX3rd | dxroll failed', e); }
        }
        const roll = await (new Roll(`${finalDice}dx${critical} + ${add2}`)).roll();
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
          // 공격 판정: 항상 데미지 롤 버튼 표시
          const weaponIdsStr = weaponBonus?.weaponIds ? weaponBonus.weaponIds.join(',') : '';
          resultContent = `
            <div class="item-actions" style="margin-top: 8px;">
              <button class="damage-roll-btn"
                      data-actor-id="${actor.id}"
                      data-item-id="${item ? item.id : ''}"
                      data-roll-result="${rollResult}"
                      data-preserved-actor-attack="${preservedValues.actorAttack}"
                      data-preserved-actor-damage-roll="${preservedValues.actorDamageRoll}"
                      data-preserved-actor-penetrate="${preservedValues.actorPenetrate}"
                      data-preserved-weapon-attack="${preservedValues.weaponAttack}"
                      data-weapon-ids="${weaponIdsStr}">
                ${game.i18n.localize('DX3rd.DamageRoll')}
              </button>
            </div>
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
        const content = `
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
        if (comboAfterSuccessData || comboAfterDamageData || (item && item.id && item.id.startsWith('_temp_combo_'))) {
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
          if (item && item.id && item.id.startsWith('_temp_combo_')) {
            messageData.flags['dx3rd-emanim'].tempComboItem = item;
          }
        }
        
        await ChatMessage.create(messageData);
        
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
            // 액터만 스피커로 지정 (token 미지정 → GM 포함 모든 클라이언트에서 액터 초상화 사용)
            const panicEffectSpeaker = (() => {
              const s = ChatMessage.getSpeaker({ actor });
              return { ...s, token: null, scene: null };
            })();
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
              await actor.update({
                [`system.attributes.applied.Panic2`]: {
                  name: game.i18n.localize('DX3rd.PanicType') + ': ' + game.i18n.localize('DX3rd.Panic2'),
                  description: game.i18n.localize('DX3rd.PanicText2'),
                  attributes: { dice: -2 },
                  disable: 'scene'
                }
              });
              break;
            case 7:
              // 패닉 7: 환각 - applied 효과 적용 (dice -2)
              await actor.update({
                [`system.attributes.applied.Panic7`]: {
                  name: game.i18n.localize('DX3rd.PanicType') + ': ' + game.i18n.localize('DX3rd.Panic7'),
                  description: game.i18n.localize('DX3rd.PanicText7'),
                  attributes: { dice: -2 },
                  disable: 'scene'
                }
              });
              break;
            case 8:
              // 패닉 8: 의존 - applied 효과만 적용
              await actor.update({
                [`system.attributes.applied.Panic8`]: {
                  name: game.i18n.localize('DX3rd.PanicType') + ': ' + game.i18n.localize('DX3rd.Panic8'),
                  description: game.i18n.localize('DX3rd.PanicText8'),
                  attributes: {},
                  disable: 'scene'
                }
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
                
                document.getElementById("dx3rd-madness-select-button").addEventListener("click", () => onSelect("select"));
                document.getElementById("dx3rd-madness-roll-button").addEventListener("click", () => onSelect("roll"));
                document.getElementById("dx3rd-madness-cancel-button").addEventListener("click", () => onSelect(null));
              });
              
              /** 광기 효과 적용 공통 처리 (지정/굴림 공통) */
              const applyMadnessEffect = async (actor, madnessNumber, { messageKey, rolls = [] }) => {
                // 액터만 스피커로 지정 (token 미지정 → GM 포함 모든 클라이언트에서 액터 초상화 사용)
                const madnessEffectSpeaker = (() => {
                  const s = ChatMessage.getSpeaker({ actor });
                  return { ...s, token: null, scene: null };
                })();
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
                      const selectedValue = parseInt(document.getElementById("dx3rd-madness-select").value);
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
                  
                  document.getElementById("dx3rd-madness-confirm-button").addEventListener("click", () => {
                    const selectedValue = parseInt(document.getElementById("dx3rd-madness-select").value);
                    onConfirm(selectedValue);
                  });
                  document.getElementById("dx3rd-madness-select-cancel-button").addEventListener("click", () => onConfirm(null));
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
              
              document.getElementById("dx3rd-panic-select-button").addEventListener("click", () => onSelect("select"));
              document.getElementById("dx3rd-panic-roll-button").addEventListener("click", () => onSelect("roll"));
              document.getElementById("dx3rd-panic-cancel-button").addEventListener("click", () => onSelect(null));
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
                    const selectedValue = parseInt(document.getElementById("dx3rd-panic-select").value);
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
                
                document.getElementById("dx3rd-panic-confirm-button").addEventListener("click", () => {
                  const selectedValue = parseInt(document.getElementById("dx3rd-panic-select").value);
                  onConfirm(selectedValue);
                });
                document.getElementById("dx3rd-panic-select-cancel-button").addEventListener("click", () => onConfirm(null));
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
        console.log('DX3rd | Roll failed', e);
        // 에러 시 메시지 미생성: 정상 메시지가 이미 나간 뒤 예외면 GM으로 중복 메시지가 나가는 것 방지
      }
    },

    /**
     * 콤보의 병합된 afterSuccess 처리
     * @param {Object} comboData - { actorId, comboItemId, activations, macros, applies, extensions }
     */
    async processComboAfterSuccess(comboData) {
      
      const { actorId, comboItemId, activations = [], macros = [], applies = [], extensions = [], afterMainExtensions = [] } = comboData;
      const actor = game.actors.get(actorId);
      if (!actor) return;
      
      // 1. 활성화 처리
      for (const { itemId, itemName } of activations) {
        const item = actor.items.get(itemId);
        if (item && item.system?.active?.runTiming === 'afterSuccess' && !item.system?.active?.state) {
          await item.update({ 'system.active.state': true });
        }
      }
      
      // 2. 매크로 실행
      for (const { itemId, itemName, macroName, timing } of macros) {
        const item = actor.items.get(itemId);
        if (item) {
          await this.executeMacros(item, timing);
        }
      }
      
      // 3. 어플라이드 적용
      for (const { itemId, itemName } of applies) {
        const item = actor.items.get(itemId);
        if (item) {
          await this.applyToTargets(actor, item, 'afterSuccess');
        }
      }
      
      // 4. 병합된 익스텐션 실행
      for (const bucket of extensions) {
        if (bucket.type === 'heal' && !bucket.custom) {
          const healData = {
            formulaDice: bucket.merged?.dice || 0,
            formulaAdd: bucket.merged?.add || 0,
            target: bucket.target,
            selectedTargetIds: bucket.selectedTargetIds || [],
            resurrect: bucket.resurrect || false,
            rivival: bucket.rivival || false,
            triggerItemName: actor.items.get(comboItemId)?.name || '콤보'
          };
          await this.executeHealExtensionNow(actor, healData, null);
        } else if (bucket.type === 'damage' && !bucket.custom) {
          const damageData = {
            formulaDice: bucket.merged?.dice || 0,
            formulaAdd: bucket.merged?.add || 0,
            target: bucket.target,
            selectedTargetIds: bucket.selectedTargetIds || [],
            ignoreReduce: bucket.ignoreReduce || false,
            triggerItemName: actor.items.get(comboItemId)?.name || '콤보'
          };
          await this.executeDamageExtensionNow(actor, damageData, null);
        } else if (bucket.type === 'condition' && !bucket.custom) {
          const conditionTypes = bucket.merged?.conditions || [];
          await this.executeConditionExtensionsNowBulk(actor, {
            conditionTypes,
            target: bucket.target,
            selectedTargetIds: bucket.selectedTargetIds || [],
            triggerItemName: actor.items.get(comboItemId)?.name || '콤보',
            poisonedRank: bucket.poisonedRank || null
          });
        } else if (bucket.type === 'weapon' || bucket.type === 'protect' || bucket.type === 'vehicle') {
          // 아이템 생성은 afterSuccess에서 하지 않음 (instant만)
        }
      }
      
      // 5. afterMain 익스텐션을 큐에 등록 (runTiming이 afterSuccess인 경우)
      for (const bucket of afterMainExtensions) {
        if (bucket.type === 'heal') {
          const healData = {
            formulaDice: bucket.merged?.dice || 0,
            formulaAdd: bucket.merged?.add || 0,
            target: bucket.target,
            selectedTargetIds: bucket.selectedTargetIds || [],
            resurrect: bucket.resurrect || false,
            rivival: bucket.rivival || false,
            triggerItemName: actor.items.get(comboItemId)?.name || '콤보'
          };
          this.addToAfterMainQueue(actor, healData, null, 'heal');
        } else if (bucket.type === 'damage') {
          const damageData = {
            formulaDice: bucket.merged?.dice || 0,
            formulaAdd: bucket.merged?.add || 0,
            target: bucket.target,
            selectedTargetIds: bucket.selectedTargetIds || [],
            ignoreReduce: bucket.ignoreReduce || false,
            triggerItemName: actor.items.get(comboItemId)?.name || '콤보'
          };
          this.addToAfterMainQueue(actor, damageData, null, 'damage');
        } else if (bucket.type === 'condition') {
          const conditionData = {
            conditionTypes: bucket.merged?.conditions || [],
            target: bucket.target,
            selectedTargetIds: bucket.selectedTargetIds || [],
            triggerItemName: actor.items.get(comboItemId)?.name || '콤보',
            poisonedRank: bucket.poisonedRank || null
          };
          this.addToAfterMainQueue(actor, conditionData, null, 'condition');
        }
      }
      
    },

    /**
     * 콤보의 병합된 afterDamage 처리
     * @param {Object} comboData - { actorId, comboItemId, activations, macros, applies, extensions }
     * @param {Array} damagedActors - HP 데미지를 받은 액터 배열 (선택적)
     */
    async processComboAfterDamage(comboData, damagedActors = null) {
      
      const { actorId, comboItemId, activations = [], macros = [], applies = [], extensions = [], afterMainExtensions = [] } = comboData;
      const actor = game.actors.get(actorId);
      if (!actor) return;
      
      // 1. 활성화 처리 (disable이 'notCheck'가 아닌 경우에만)
      for (const { itemId, itemName } of activations) {
        const item = actor.items.get(itemId);
        if (item) {
          const activeDisable = item.system?.active?.disable ?? '-';
          if (item.system?.active?.runTiming === 'afterDamage' && !item.system?.active?.state && activeDisable !== 'notCheck') {
            await item.update({ 'system.active.state': true });
          }
        }
      }
      
      // 2. 매크로 실행
      for (const { itemId, itemName, macroName, timing } of macros) {
        const item = actor.items.get(itemId);
        if (item) {
          try {
            await this.executeMacros(item, timing);
          } catch (e) {
            console.warn(`DX3rd | Combo afterDamage - Macro execution failed: ${itemName}`, e);
          }
        }
      }
      
      // 3. 어플라이드 처리
      for (const { itemId, itemName } of applies) {
        const item = actor.items.get(itemId);
        if (item && item.system?.effect?.runTiming === 'afterDamage') {
          // damagedActors를 forcedTargets로 전달
          await this.applyToTargets(actor, item, 'afterDamage', damagedActors);
        }
      }
      
      // 4. 병합된 익스텐션 실행
      for (const bucket of extensions) {
        if (bucket.type === 'heal' && !bucket.custom) {
          // damagedActors가 있으면 해당 액터들의 토큰 ID로 변환
          let targetTokenIds = bucket.selectedTargetIds || [];
          if (damagedActors && damagedActors.length > 0) {
            targetTokenIds = damagedActors.map(actor => {
              const token = canvas.tokens.placeables.find(t => t.actor?.id === actor.id);
              return token?.id;
            }).filter(id => id);
          }
          
          const healData = {
            formulaDice: bucket.merged?.dice || 0,
            formulaAdd: bucket.merged?.add || 0,
            // damagedActors가 있으면 targetToken으로, 없으면 원래 target 유지
            target: (damagedActors && damagedActors.length > 0) ? 'targetToken' : bucket.target,
            selectedTargetIds: targetTokenIds,
            resurrect: bucket.resurrect || false,
            rivival: bucket.rivival || false,
            triggerItemName: actor.items.get(comboItemId)?.name || '콤보'
          };
          await this.executeHealExtensionNow(actor, healData, null);
        } else if (bucket.type === 'damage' && !bucket.custom) {
          // damagedActors가 있으면 해당 액터들의 토큰 ID로 변환
          let targetTokenIds = bucket.selectedTargetIds || [];
          if (damagedActors && damagedActors.length > 0) {
            targetTokenIds = damagedActors.map(actor => {
              const token = canvas.tokens.placeables.find(t => t.actor?.id === actor.id);
              return token?.id;
            }).filter(id => id);
          }
          
          const damageData = {
            formulaDice: bucket.merged?.dice || 0,
            formulaAdd: bucket.merged?.add || 0,
            // damagedActors가 있으면 targetToken으로, 없으면 원래 target 유지
            target: (damagedActors && damagedActors.length > 0) ? 'targetToken' : bucket.target,
            selectedTargetIds: targetTokenIds,
            ignoreReduce: bucket.ignoreReduce || false,
            triggerItemName: actor.items.get(comboItemId)?.name || '콤보'
          };
          await this.executeDamageExtensionNow(actor, damageData, null);
        } else if (bucket.type === 'condition' && !bucket.custom) {
          // damagedActors가 있으면 해당 액터들의 토큰 ID로 변환
          let targetTokenIds = bucket.selectedTargetIds || [];
          if (damagedActors && damagedActors.length > 0) {
            targetTokenIds = damagedActors.map(actor => {
              const token = canvas.tokens.placeables.find(t => t.actor?.id === actor.id);
              return token?.id;
            }).filter(id => id);
          }
          
          const conditionTypes = bucket.merged?.conditions || [];
          await this.executeConditionExtensionsNowBulk(actor, {
            conditionTypes,
            // damagedActors가 있으면 targetToken으로, 없으면 원래 target 유지
            target: (damagedActors && damagedActors.length > 0) ? 'targetToken' : bucket.target,
            selectedTargetIds: targetTokenIds,
            triggerItemName: actor.items.get(comboItemId)?.name || '콤보',
            poisonedRank: bucket.poisonedRank || null
          });
        } else if (bucket.type === 'weapon' || bucket.type === 'protect' || bucket.type === 'vehicle') {
          // 아이템 생성은 afterDamage에서 하지 않음 (instant만)
          console.log(`DX3rd | Combo afterDamage - Skipping item creation (${bucket.type})`);
        }
      }
      
      // 5. afterMain 익스텐션을 큐에 등록 (runTiming이 afterDamage인 경우)
      console.log('DX3rd | processComboAfterDamage - Registering afterMain extensions:', afterMainExtensions.length);
      for (const bucket of afterMainExtensions) {
        console.log('DX3rd | processComboAfterDamage - Registering afterMain:', bucket.type, 'merged:', bucket.merged);
        if (bucket.type === 'heal') {
          const healData = {
            formulaDice: bucket.merged?.dice || 0,
            formulaAdd: bucket.merged?.add || 0,
            target: bucket.target,
            selectedTargetIds: bucket.selectedTargetIds || [],
            resurrect: bucket.resurrect || false,
            rivival: bucket.rivival || false,
            triggerItemName: actor.items.get(comboItemId)?.name || '콤보'
          };
          this.addToAfterMainQueue(actor, healData, null, 'heal');
        } else if (bucket.type === 'damage') {
          const damageData = {
            formulaDice: bucket.merged?.dice || 0,
            formulaAdd: bucket.merged?.add || 0,
            target: bucket.target,
            selectedTargetIds: bucket.selectedTargetIds || [],
            ignoreReduce: bucket.ignoreReduce || false,
            triggerItemName: actor.items.get(comboItemId)?.name || '콤보'
          };
          this.addToAfterMainQueue(actor, damageData, null, 'damage');
        } else if (bucket.type === 'condition') {
          const conditionData = {
            conditionTypes: bucket.merged?.conditions || [],
            target: bucket.target,
            selectedTargetIds: bucket.selectedTargetIds || [],
            triggerItemName: actor.items.get(comboItemId)?.name || '콤보',
            poisonedRank: bucket.poisonedRank || null
          };
          this.addToAfterMainQueue(actor, conditionData, null, 'condition');
        }
      }
      
    },

    /**
     * 성공 버튼 클릭 처리
     * @param {string} actorId - 액터 ID
     * @param {string} itemId - 아이템 ID
     * @param {string} previousTokenId - 이전에 선택된 토큰 ID
     */
    async handleSuccessButton(actorId, itemId, previousTokenId = null, weaponAttack = 0) {
      try {
        if (!actorId) return;
        
        const actor = game.actors.get(actorId);
        if (!actor) return;
        
        // 권한 체크
        if (!actor.isOwner && !game.user.isGM) {
          console.warn('DX3rd | User lacks permission to use this actor\'s actions');
          return;
        }
        
        // 토큰 자동 선택 (있는 경우)
        let restoredToken = null;
        if (actor && canvas.tokens) {
          // 현재 선택된 토큰 저장
          const currentToken = canvas.tokens.controlled?.[0] || null;
          
          // 액터의 토큰 찾기
          const actorToken = canvas.tokens.placeables.find(t => t.actor?.id === actor.id);
          if (actorToken) {
            actorToken.control({ releaseOthers: true });
            restoredToken = currentToken; // 나중에 복원할 토큰
          }
        }
        
        // 아이템이 있으면 success 타이밍 처리
        if (itemId) {
          const item = actor.items.get(itemId);
          if (item) {
            // 0. 'afterSuccess' 매크로 실행
            await this.executeMacros(item, 'afterSuccess');
            
            // 1. active.runTiming이 'afterSuccess'인 경우 활성화 (disable이 'notCheck'가 아닌 경우에만)
            const activeDisable = item.system?.active?.disable ?? '-';
            if (item.system.active?.runTiming === 'afterSuccess' && !item.system.active?.state && activeDisable !== 'notCheck') {
              await item.update({ 'system.active.state': true });
            }
            
            // 2. 'afterSuccess' 타겟 효과 적용 (effect.runTiming === 'afterSuccess')
            await this.applyToTargets(actor, item, 'afterSuccess');
            
            // 3. afterSuccess 타이밍 heal/damage/condition 익스텐션을 GM을 통해 처리
            const itemExtend = item.getFlag('dx3rd-emanim', 'itemExtend') || {};
            const selectedTargetIds = Array.from(game.user.targets).map(t => t.id);
            
            // heal afterSuccess
            if (itemExtend.heal?.activate && itemExtend.heal?.timing === 'afterSuccess') {
              
              const healDataWithTargets = {
                ...itemExtend.heal,
                selectedTargetIds,
                triggerItemName: item.name,
                triggerItemId: item.id
              };
              
              // GM이면 직접 처리만 (소켓 전송 안 함)
              if (game.user.isGM) {
                await this.handleHealRequest({
                  actorId: actor.id,
                  healData: healDataWithTargets,
                  itemId: item.id
                });
              } else {
                // 플레이어면 소켓 전송만
                game.socket.emit('system.dx3rd-emanim', {
                  type: 'healRequest',
                  requestData: {
                    actorId: actor.id,
                    healData: healDataWithTargets,
                    itemId: item.id
                  }
                });
              }
            }
            
            // damage afterSuccess
            if (itemExtend.damage?.activate && itemExtend.damage?.timing === 'afterSuccess') {
              
              let damageDataWithTargets = {
                ...itemExtend.damage,
                selectedTargetIds,
                triggerItemName: item.name,
                triggerItemId: item.id
              };
              
              // GM이면 직접 처리만 (소켓 전송 안 함)
              if (game.user.isGM) {
                await this.handleDamageRequest({
                  actorId: actor.id,
                  damageData: damageDataWithTargets,
                  itemId: item.id
                });
              } else {
                // 플레이어: 조건부 공식 입력은 본인 클라이언트에서만 → 확정 후 GM 소켓 처리
                if (damageDataWithTargets.conditionalFormula) {
                  const customFormula = await this.promptConditionalDamageFormula();
                  if (!customFormula) {
                    ui.notifications.warn('조건부 공식 입력이 취소되어 HP 데미지 익스텐션을 건너뜁니다.');
                  } else {
                    damageDataWithTargets = {
                      ...damageDataWithTargets,
                      formulaDice: customFormula.dice,
                      formulaAdd: customFormula.add,
                      conditionalFormula: false
                    };
                    game.socket.emit('system.dx3rd-emanim', {
                      type: 'damageRequest',
                      requestData: {
                        actorId: actor.id,
                        damageData: damageDataWithTargets,
                        itemId: item.id
                      }
                    });
                  }
                } else {
                  game.socket.emit('system.dx3rd-emanim', {
                    type: 'damageRequest',
                    requestData: {
                      actorId: actor.id,
                      damageData: damageDataWithTargets,
                      itemId: item.id
                    }
                  });
                }
              }
            }
            
            // condition afterSuccess (conditions 배열 또는 기존 단일 형식)
            const condEntries = this._getConditionEntries(itemExtend.condition || {});
            const afterSuccessConds = condEntries.filter(c => c.timing === 'afterSuccess');
            for (const c of afterSuccessConds) {
              const conditionDataWithTargets = {
                ...c,
                selectedTargetIds,
                triggerItemName: item.name,
                triggerItemId: item.id
              };
              
              if (game.user.isGM) {
                await this.handleConditionRequest({
                  actorId: actor.id,
                  conditionData: conditionDataWithTargets,
                  itemId: item.id
                });
              } else {
                game.socket.emit('system.dx3rd-emanim', {
                  type: 'conditionRequest',
                  requestData: {
                    actorId: actor.id,
                    conditionData: conditionDataWithTargets,
                    itemId: item.id
                  }
                });
              }
            }
            
            // runTiming이 afterSuccess인 경우, afterMain 익스텐드를 큐에 등록
            if (item.system.active?.runTiming === 'afterSuccess') {
              this.registerAfterMainExtensions(actor, item, itemExtend);
            }
          }
        }
        
        // 이전 토큰 복원 (previousTokenId가 있는 경우)
        if (previousTokenId && canvas.tokens) {
          const tokenToRestore = canvas.tokens.placeables.find(t => t.id === previousTokenId);
          if (tokenToRestore) {
            tokenToRestore.control({ releaseOthers: true });
          }
        } else if (restoredToken && canvas.tokens) {
          // previousTokenId가 없으면 임시 저장한 토큰으로 복원
          restoredToken.control({ releaseOthers: true });
        }
        
      } catch (e) {
        console.error('DX3rd | handleSuccessButton failed', e);
      }
    },

    async activateItem(actor, item) {
      if (!actor || !item) return false;

      const activeDisable = item.system?.active?.disable ?? '-';
      if (item.system?.active?.runTiming === 'instant' && !item.system?.active?.state && activeDisable !== 'notCheck') {
        await item.update({'system.active.state': true});
        console.log('DX3rd | UniversalHandler.activateItem - Item activated:', item.name);
      }
      return true;
    },

    /**
     * 아이템 사용 처리 (getTarget 체크 포함)
     * @param {string} actorId - 액터 ID
     * @param {string} itemId - 아이템 ID
     * @param {string} itemType - 아이템 타입
     * @param {string} roisAction - 로이스 액션 (선택사항)
     * @param {boolean} getTarget - getTarget 설정 (선택사항)
     */
    async handleItemUse(actorId, itemId, itemType, roisAction, getTarget, options = {}) {
      if (!actorId || !itemId) {
        return false;
      }
      
      const actor = game.actors.get(actorId);
      if (!actor) {
        return false;
      }
      
      const item = actor.items.get(itemId);
      if (!item) {
        return false;
      }
      
      // 대상 필요 시: 타겟이 없으면 중단 (하이라이트 유지)
      const requiresTarget = getTarget !== undefined ? getTarget : !!item.system?.getTarget;
      
      console.log('DX3rd | handleItemUse target check:', {
        itemName: item.name,
        getTargetParam: getTarget,
        itemGetTarget: item.system?.getTarget,
        requiresTarget: requiresTarget,
        targetsCount: game.user.targets?.size || 0
      });
      
      if (requiresTarget) {
        const targets = Array.from(game.user.targets || []);
        if (targets.length === 0) {
          console.log('DX3rd | Item use blocked - no targets selected (highlight preserved)');
          ui.notifications.warn(game.i18n.localize('DX3rd.SelectTarget'));
          return false; // 하이라이트 유지하고 중단
        }
        console.log('DX3rd | Target check passed -', targets.length, 'targets selected');
      }

      // 무기/비클 사용 버튼: 하이라이트 제거 확인 다이얼로그
      if (itemType === 'weapon' || itemType === 'vehicle') {
        const rangeHighlightActive = this.rangeHighlightQueue.current !== null;
        
        if (rangeHighlightActive) {
          // 하이라이트가 활성화되어 있으면 제거 확인
          const shouldClearHighlight = await window.DX3rdUniversalConfirmDialogV2({
            title: game.i18n.localize('DX3rd.RangeOffCheck'),
            content: `<p style="text-align: center;">${game.i18n.localize('DX3rd.RangeOffCheckText')}</p>`,
            yesLabel: game.i18n.localize('DX3rd.Confirm'),
            noLabel: game.i18n.localize('DX3rd.Cancel'),
            defaultYes: true
          });
          
          if (shouldClearHighlight) {
            this.clearRangeHighlightQueue();
            console.log('DX3rd | Range highlight cleared by user choice (weapon/vehicle use)');
            
            // 다른 유저들에게도 소켓으로 전송
            game.socket.emit('system.dx3rd-emanim', {
              type: 'clearRangeHighlight'
            });
          } else {
            console.log('DX3rd | Range highlight preserved by user choice (weapon/vehicle use)');
          }
        }
      }

      // 사용 버튼 클릭 시 통합 처리
      await new Promise(resolve => setTimeout(resolve, 50)); // 50ms 딜레이
      
      // 0. SpellCalamity 5번 효과 체크 (마술 사용 불가)
      if (itemType === 'spell') {
        const appliedEffects = actor.system?.attributes?.applied || {};
        for (const [appliedKey, appliedEffect] of Object.entries(appliedEffects)) {
          if (appliedEffect && appliedEffect.attributes) {
            let hasSpellDisabled = false;
            let count = 0;
            
            for (const [attrName, attrValue] of Object.entries(appliedEffect.attributes)) {
              if (attrName === 'spell_disabled' || 
                  (typeof attrValue === 'object' && attrValue?.key === 'spell_disabled') ||
                  attrValue === true) {
                hasSpellDisabled = true;
                // count 값 찾기
                const countValue = appliedEffect.attributes?.spell_disabled_count;
                if (countValue !== undefined) {
                  count = typeof countValue === 'object' ? (countValue.value || 0) : Number(countValue || 0);
                }
                break;
              }
            }
            
            if (hasSpellDisabled) {
              // count가 있으면 count 표시, 없으면 기본 메시지
              if (count > 0) {
                ui.notifications.warn(game.i18n.format('DX3rd.SpellDisabled', { count: count }));
              } else {
                ui.notifications.warn(game.i18n.localize('DX3rd.SpellCatastropheText3'));
              }
              return false; // 마술 사용 불가
            }
          }
        }
      }
      
      // 1. 침식률/HP 비용 처리 및 아이템 사용 메시지 출력
      // Finding E(룰 3271-3273/3660-3664): 이펙트 자신의 침식 코스트가 임계치(100/160)를
      // 넘겨도, 이번 사용의 [level]은 '코스트 반영 전' 침식 레벨로 고정한다.
      // (이미 발동한 이펙트는 자신의 침식 상승분으로 레벨이 오르지 않는다.)
      // getItemLevel(helpers.js)이 이 임시 플래그를 우선 읽는다. 재진입 대비 이전 값 저장.
      const _prevFrozenEncLevel = actor._dx3rdUsageEncLevel;
      actor._dx3rdUsageEncLevel = Number(actor.system?.attributes?.encroachment?.level) || 0;
      try {
      const usageAllowed = await this.processItemUsageCost(actor, item);
      if (!usageAllowed) {
        console.log('DX3rd | handleItemUse - Usage blocked by cost');
        return false;
      }
      
      // 1.5. 사용 횟수 증가 (notCheck가 아닌 경우)
      const usedDisable = item.system?.used?.disable || 'notCheck';
      if (usedDisable !== 'notCheck') {
        const currentUsedState = item.system?.used?.state || 0;
        await item.update({ 'system.used.state': currentUsedState + 1 });
        console.log('DX3rd | handleItemUse - Used count increased:', currentUsedState, '→', currentUsedState + 1);
      }
      
      // 2. instant 활성화 처리 (disable이 'notCheck'가 아닌 경우에만)
      const activeDisable = item.system?.active?.disable ?? '-';
      if (item.system.active?.runTiming === 'instant' && !item.system.active?.state && activeDisable !== 'notCheck') {
        await item.update({ 'system.active.state': true });
        console.log('DX3rd | handleItemUse - Item activated (instant timing)');
      }
      
      // 2.7. 자원소비 비례형(네이티브 필드) 처리 — HP 등을 n 소비하고 n×배수만큼 판정/스탯 버프
      await this.processResourceCost(actor, item);

      // 3. instant 타이밍 매크로/어플라이드/익스텐션 실행
      await this.executeMacros(item, 'instant');
      await this.applyToTargets(actor, item, 'instant');
      // 콤보는 익스텐션을 콤보 핸들러에서 이펙트와 병합 처리하므로 여기서는 건너뜀 (롤 타입 무관)
      if (item.type !== 'combo') {
        await this.processItemExtensions(actor, item, 'instant');
      } else {
        console.log('DX3rd | handleItemUse - Skipping combo instant extensions here (will be merged and executed in ComboHandler)');
      }
      
      // 4. runTiming이 instant인 경우, afterMain 익스텐드를 큐에 등록
      // 단, 콤보는 ComboHandler에서 병합하여 등록하므로 여기서는 건너뜀
      if (item.system.active?.runTiming === 'instant') {
        if (item.type !== 'combo') {
          const itemExtend = item.getFlag('dx3rd-emanim', 'itemExtend');
          if (itemExtend) {
            console.log('DX3rd | handleItemUse - Registering afterMain extensions for non-combo item:', item.name);
            this.registerAfterMainExtensions(actor, item, itemExtend);
          }
        } else {
          console.log('DX3rd | handleItemUse - Skipping afterMain registration for combo (will be handled by ComboHandler)');
        }
      }

      // 아이템 타입별 핸들러 호출
      const handlerMap = {
        'weapon': window.DX3rdWeaponHandler,
        'protect': window.DX3rdProtectHandler,
        'vehicle': window.DX3rdVehicleHandler,
        'effect': window.DX3rdEffectHandler,
        'psionic': window.DX3rdPsionicHandler,
        'spell': window.DX3rdSpellHandler,
        'combo': window.DX3rdComboHandler,
        'book': window.DX3rdBookHandler,
        'connection': window.DX3rdConnectionHandler,
        'etc': window.DX3rdEtcHandler,
        'once': window.DX3rdOnceHandler,
        'rois': window.DX3rdRoisHandler
      };
      
      const handler = handlerMap[itemType];
      if (handler) {
        // 핸들러 내부 예외가 조용히 삼켜져 "오류도 없이 실행 안 됨"이 되지 않도록 표면화한다.
        try {
          // 로이스 아이템의 경우 roisAction에 따라 분기
          if (itemType === 'rois' && roisAction) {
            if (roisAction === 'titus') {
              await handler.handleTitus(actorId, itemId);
            } else if (roisAction === 'sublimation') {
              await handler.handleSublimation(actorId, itemId);
            } else {
              await handler.handle(actorId, itemId, getTarget, options);
            }
          } else {
            await handler.handle(actorId, itemId, getTarget, options);
          }
        } catch (e) {
          console.error(`DX3rd | handleItemUse - ${itemType} handler threw:`, e);
          ui.notifications.error(`${item.name}: ${game.i18n.localize('DX3rd.Use')} ${game.i18n.localize('DX3rd.Unable')} (${e?.message || e})`);
          return false;
        }
      } else {
        console.warn(`DX3rd | handleItemUse - No handler registered for itemType: ${itemType}`);
      }

      // 성공적으로 완료
      return true;
      } finally {
        // 사용 종료: 사용-중 레벨 고정 해제(재진입 시 이전 값 복원)
        if (_prevFrozenEncLevel === undefined) delete actor._dx3rdUsageEncLevel;
        else actor._dx3rdUsageEncLevel = _prevFrozenEncLevel;
      }
    }
  };

})();

// 토큰 리프레시 시 범위 하이라이트 레이어 재부착
Hooks.on('refreshToken', (token) => {
  try {
    const handler = window.DX3rdUniversalHandler;
    if (!handler) return;
    
    // 범위 하이라이트 큐가 이 토큰에 대한 것이면 재계산
    const queue = handler.rangeHighlightQueue;
    if (queue.current && queue.current.tokenId === token.id) {
      
      // 기존 하이라이트 제거
      handler.clearTokenRangeHighlight(token);
      
      // 하이라이트 재생성 (벽 감지 포함)
      const range = queue.current.range;
      const userColor = queue.current.userColor;
      
      if (range === 1 || range === game.i18n.localize('DX3rd.Engage')) {
        const adjacentGrids = handler.getAdjacentGrids(token);
        for (const grid of adjacentGrids) {
          handler.drawTokenLocalHighlight(token, grid.x, grid.y, canvas.grid.size, userColor);
        }
      } else {
        const rangeGrids = handler.getGridsInRange(token, range);
        for (const grid of rangeGrids) {
          handler.drawTokenLocalHighlight(token, grid.x, grid.y, canvas.grid.size, userColor);
        }
      }
    }
    
    // 범위 하이라이트 레이어가 있으면 재부착
    if (token._dx3rdRangeLayer && !token.children.includes(token._dx3rdRangeLayer)) {
      token.addChild(token._dx3rdRangeLayer);
      console.log(`DX3rd | Reattached range layer to token: ${token.name}`);
    }
  } catch (e) {
    console.error('DX3rd | Failed to reattach range layer on token refresh:', e);
  }
});

// ========== AfterMain 큐 시스템 ========== //
/**
 * AfterMain 큐에 익스텐션 추가 (GM에게 소켓으로 전송)
 * @param {Actor} actor
 * @param {Object} extensionData - healData, damageData, conditionData 등
 * @param {Item} item
 * @param {string} type - 'heal', 'damage', 'condition'
 */
window.DX3rdUniversalHandler.addToAfterMainQueue = function(actor, extensionData, item, type = 'heal') {
  if (game.user.isGM) {
    // GM은 직접 큐에 추가 (actorId도 함께 저장)
    const queue = this._afterMainQueue;
    queue.push({ 
      type, 
      actor, 
      actorId: actor?.id || null,  // actorId도 함께 저장
      data: extensionData, 
      item,
      itemId: item?.id || null  // itemId도 함께 저장
    });
    this._afterMainQueue = queue;
    console.log(`DX3rd | GM added to AfterMain queue: ${type} for ${actor?.name || 'unknown'}, Queue length: ${this._afterMainQueue.length}`);
  } else {
    // 플레이어는 GM에게 소켓으로 전송
    console.log(`DX3rd | Player requesting GM to add to AfterMain queue: ${type} for ${actor?.name || 'unknown'}`);
    game.socket.emit('system.dx3rd-emanim', {
      type: 'addToAfterMainQueue',
      data: {
        actorId: actor?.id || null,
        extensionData: extensionData,
        extensionType: type,
        itemId: item?.id || null
      }
    });
  }
};

/**
 * afterMain 타이밍 익스텐드를 큐에 등록하는 헬퍼 함수
 * @param {Actor} actor - 사용자 액터
 * @param {Item} item - 아이템
 * @param {Object} itemExtend - 아이템 익스텐드 데이터
 */
window.DX3rdUniversalHandler.registerAfterMainExtensions = function(actor, item, itemExtend) {
  if (!itemExtend) return;
  
  const selectedTargets = Array.from(game.user.targets).map(t => t.id);
  
  // heal 익스텐드 처리
  if (itemExtend.heal?.activate && itemExtend.heal?.timing === 'afterMain') {
    const healDataWithTargets = {
      ...itemExtend.heal,
      selectedTargetIds: selectedTargets,
      triggerItemName: item?.name || null,
      triggerItemId: item?.id || null
    };
    
    if (game.user.isGM) {
      this.addToAfterMainQueue(actor, healDataWithTargets, item, 'heal');
    } else {
      game.socket.emit('system.dx3rd-emanim', {
        type: 'addToAfterMainQueue',
        data: {
          extensionType: 'heal',
          actorId: actor.id,
          extensionData: healDataWithTargets,
          itemId: item?.id || null
        }
      });
    }
    console.log(`DX3rd | Registered afterMain heal extension for ${actor.name}`);
  }
  
  // damage 익스텐드 처리
  if (itemExtend.damage?.activate && itemExtend.damage?.timing === 'afterMain') {
    const damageDataWithTargets = {
      ...itemExtend.damage,
      selectedTargetIds: selectedTargets,
      triggerItemName: item?.name || null,
      triggerItemId: item?.id || null
    };
    
    if (game.user.isGM) {
      this.addToAfterMainQueue(actor, damageDataWithTargets, item, 'damage');
    } else {
      game.socket.emit('system.dx3rd-emanim', {
        type: 'addToAfterMainQueue',
        data: {
          extensionType: 'damage',
          actorId: actor.id,
          extensionData: damageDataWithTargets,
          itemId: item?.id || null
        }
      });
    }
    console.log(`DX3rd | Registered afterMain damage extension for ${actor.name}`);
  }
  
  // condition 익스텐드 처리 (conditions 배열 또는 기존 단일 형식)
  const condEntries = this._getConditionEntries(itemExtend.condition || {});
  const afterMainConds = condEntries.filter(c => c.timing === 'afterMain');
  for (const c of afterMainConds) {
    const conditionDataWithTargets = {
      ...c,
      selectedTargetIds: selectedTargets,
      triggerItemName: item?.name || null,
      triggerItemId: item?.id || null
    };
    
    if (game.user.isGM) {
      this.addToAfterMainQueue(actor, conditionDataWithTargets, item, 'condition');
    } else {
      game.socket.emit('system.dx3rd-emanim', {
        type: 'addToAfterMainQueue',
        data: {
          extensionType: 'condition',
          actorId: actor.id,
          extensionData: conditionDataWithTargets,
          itemId: item?.id || null
        }
      });
    }
  }
  if (afterMainConds.length > 0) {
    console.log(`DX3rd | Registered afterMain condition extension for ${actor.name} (${afterMainConds.length} entries)`);
  }
};

/**
 * AfterMain 큐 처리 (이니셔티브 직전 실행)
 */
window.DX3rdUniversalHandler.processAfterMainQueue = async function() {
  if (this._afterMainQueue.length === 0) {
    console.log('DX3rd | AfterMain queue is empty');
    return;
  }
  
  console.log(`DX3rd | Processing AfterMain queue: ${this._afterMainQueue.length} items`);
  
  // 큐에 있는 모든 효과 실행
  for (const queueItem of this._afterMainQueue) {
    const { type, actor, actorId, data, item, itemId } = queueItem;
    
    // 액터가 유효하지 않으면 actorId로 다시 가져오기
    let validActor = actor;
    if (!validActor || !validActor.id || validActor.id !== actorId) {
      if (actorId) {
        validActor = game.actors.get(actorId);
        if (!validActor) {
          console.warn(`DX3rd | Actor not found for queue item: ${actorId}`);
          continue;
        }
      } else {
        console.warn(`DX3rd | No actorId in queue item, skipping`);
        continue;
      }
    }
    
    // 아이템이 유효하지 않으면 itemId로 다시 가져오기
    let validItem = item;
    if (itemId && (!validItem || !validItem.id || validItem.id !== itemId)) {
      validItem = validActor?.items.get(itemId) || null;
    }
    
    switch (type) {
      case 'heal':
        console.log(`DX3rd | Processing heal from queue: ${validActor.name}`);
        // skipDialog 옵션 전달하지 않음 - 자동 승인 설정 확인
        await this.executeHealExtensionNow(validActor, data, validItem);
        break;
        
      case 'damage':
        console.log(`DX3rd | Processing damage from queue: ${validActor.name}`);
        // skipDialog 옵션 전달하지 않음 - 자동 승인 설정 확인
        await this.executeDamageExtensionNow(validActor, data, validItem);
        break;
        
      case 'condition':
        console.log(`DX3rd | Processing condition from queue: ${validActor.name}`);
        // data에 conditionTypes 배열이 있으면 병합된 데이터 (콤보)
        if (data.conditionTypes && Array.isArray(data.conditionTypes)) {
          await this.executeConditionExtensionsNowBulk(validActor, data);
        } else {
          // 단일 condition 데이터
          await this.executeConditionExtensionNow(validActor, data, validItem);
        }
        break;
        
      default:
        console.warn(`DX3rd | Unknown queue item type: ${type}`);
    }
  }
  
  // 큐 초기화
  await game.settings.set('dx3rd-emanim', 'afterMainQueue', []);
  console.log('DX3rd | AfterMain queue cleared');
};

/**
 * AfterMain 큐 초기화 (전투 종료 시 등)
 */
window.DX3rdUniversalHandler.clearAfterMainQueue = async function() {
  await game.settings.set('dx3rd-emanim', 'afterMainQueue', []);
  console.log('DX3rd | AfterMain queue manually cleared');
};

// ========== HP 회복 시스템 ========== //
/**
 * HP 회복 익스텐션 실행
 * @param {Actor} actor - 사용자 액터
 * @param {Object} healData - 회복 데이터
 * @param {Item} item - 연동된 아이템 (옵션)
 */
window.DX3rdUniversalHandler.executeHealExtension = async function(actor, healData, item = null) {
  console.log('DX3rd | executeHealExtension called', { actor: actor.name, healData, item: item?.name });
  
  const { timing } = healData;
  
  // afterMain, afterDamage, afterSuccess는 각 버튼/호출 지점에서 직접 큐에 등록하므로 여기서는 처리 안 함
  if (timing === 'afterMain' || timing === 'afterDamage' || timing === 'afterSuccess') {
    console.log(`DX3rd | ${timing} timing - will be handled by caller or button handler`);
    return;
  }
  
  // instant 타이밍이면 즉시 실행
  await this.executeHealExtensionNow(actor, healData, item);
};

/**
 * HP 회복 익스텐션 즉시 실행
 * @param {Actor} actor - 사용자 액터
 * @param {Object} healData - 회복 데이터
 * @param {Item} item - 연동된 아이템 (옵션)
 * @param {Object} options - 옵션 (skipDialog: 확인 다이얼로그 건너뛰기)
 */
window.DX3rdUniversalHandler.executeHealExtensionNow = async function(actor, healData, item = null, options = {}) {
  // actor 유효성 검사
  if (!actor || !actor.id) {
    console.error('DX3rd | executeHealExtensionNow: Invalid actor', actor);
    ui.notifications.error('액터 정보가 유효하지 않습니다.');
    return;
  }
  
  console.log('DX3rd | executeHealExtensionNow called', { actor: actor.name, actorId: actor.id, healData, item: item?.name, options });
  
  const { formulaDice, formulaAdd, target, rivival, resurrect, selectedTargetIds, triggerItemName, healTo, encroachFixed } = healData;
  const { skipDialog = false } = options;
  
  // 대상 수집
  const targets = [];
  
  if (target === 'self' || target === 'targetAll') {
    targets.push(actor);
  }
  
  if (target === 'targetToken' || target === 'targetAll') {
    // selectedTargetIds가 있으면 사용 (큐에서 복원된 경우)
    if (selectedTargetIds && selectedTargetIds.length > 0) {
      console.log('DX3rd | Using saved target IDs from queue:', selectedTargetIds);
      selectedTargetIds.forEach(tokenId => {
        const token = canvas.tokens.get(tokenId);
        if (token && token.actor && !targets.find(a => a.id === token.actor.id)) {
          targets.push(token.actor);
        }
      });
    } else {
      // 현재 선택된 타겟 사용 (즉시 실행인 경우)
      const selectedTargets = Array.from(game.user.targets);
      selectedTargets.forEach(t => {
        if (t.actor && !targets.find(a => a.id === t.actor.id)) {
          targets.push(t.actor);
        }
      });
    }
  }
  
  console.log(`DX3rd | Heal targets collected: ${targets.map(t => t.name).join(', ')} (total: ${targets.length})`);
  
  if (targets.length === 0) {
    ui.notifications.warn('회복 대상이 없습니다.');
    return;
  }
  
  // 아이템의 레벨 가져오기 (없으면 1)
  const itemLevel = (item ? window.DX3rdFormulaEvaluator.getItemLevel(item) : 0) || 1;
  const itemForFormula = {
    type: item?.type || 'effect',
    system: {
      level: {
        value: itemLevel
      }
    }
  };
  
  console.log(`DX3rd | Using item level for formula: ${itemLevel} (item: ${item?.name || 'none'})`);
  
  // 공식 평가 (액터의 능력치/기능치 참조)
  let evaluatedDice = 0;
  let evaluatedAdd = 0;
  
  if (formulaDice) {
    const diceFormula = String(formulaDice).trim();
    if (diceFormula && diceFormula !== '0') {
      evaluatedDice = window.DX3rdFormulaEvaluator.evaluate(diceFormula, itemForFormula, actor);
    }
  }
  
  if (formulaAdd) {
    const addFormula = String(formulaAdd).trim();
    if (addFormula && addFormula !== '0') {
      evaluatedAdd = window.DX3rdFormulaEvaluator.evaluate(addFormula, itemForFormula, actor);
    }
  }
  
  console.log(`DX3rd | Heal formula evaluated - Dice: ${formulaDice} → ${evaluatedDice}, Add: ${formulaAdd} → ${evaluatedAdd}`);

  // 상한회복(부활)형: healTo(목표 HP) 평가 — "max"는 최대치, 공식이면 액터/레벨로 평가
  let evaluatedHealTo = null;
  if (healTo !== undefined && healTo !== null && String(healTo).trim() !== '' && String(healTo).trim() !== '0') {
    const htRaw = String(healTo).trim();
    if (/^max$/i.test(htRaw)) evaluatedHealTo = 'max';
    else evaluatedHealTo = parseInt(window.DX3rdFormulaEvaluator.evaluate(htRaw, itemForFormula, actor)) || 0;
  }
  // 고정 침식 부작용: 다이스식("2d10")은 GM측 롤로 넘기고, 숫자/[공식]은 사용자측에서 평가
  let encFixedOut = '';
  if (encroachFixed !== undefined && encroachFixed !== null && String(encroachFixed).trim() !== '' && String(encroachFixed).trim() !== '-') {
    const ef = String(encroachFixed).trim();
    if (/d/i.test(ef) && !/\[/.test(ef)) {
      encFixedOut = ef;
    } else {
      encFixedOut = String(parseInt(window.DX3rdFormulaEvaluator.evaluate(ef, itemForFormula, actor)) || 0);
    }
  }
  console.log(`DX3rd | Heal threshold/encroach - healTo: ${healTo} → ${evaluatedHealTo}, encroachFixed: ${encroachFixed} → ${encFixedOut}`);

  // GM에게 소켓 요청
  const requestData = {
    userId: game.user.id,
    actorId: actor.id,
    actorName: actor.name,
    targets: targets.map(t => ({ id: t.id, name: t.name })),
    formulaDice: Math.max(0, parseInt(evaluatedDice) || 0),
    formulaAdd: parseInt(evaluatedAdd) || 0,
    healTo: evaluatedHealTo,
    encroachFixed: encFixedOut,
    rivival: rivival || false,
    resurrect: healData.resurrect || false,
    // 트리거 아이템 이름: healData가 없으면 아이템 이름으로 대체
    triggerItemName: (triggerItemName || item?.name || null),
    skipDialog: skipDialog  // 확인 다이얼로그 건너뛰기 플래그
  };
  
  if (game.user.isGM) {
    // GM이면 직접 처리
    await window.DX3rdUniversalHandler.handleHealRequest(requestData);
  } else {
    // 플레이어면 GM에게 요청
    game.socket.emit('system.dx3rd-emanim', {
      type: 'healRequest',
      requestData: requestData
    });
    ui.notifications.info('GM에게 회복 요청을 보냈습니다.');
  }
};

/**
 * HP 회복 요청 처리 (GM 전용)
 */
window.DX3rdUniversalHandler.handleHealRequest = async function(requestData) {
  if (!game.user.isGM) return;
  
  // afterSuccess에서 온 경우: healData가 있음
  if (requestData.healData) {
    const actor = game.actors.get(requestData.actorId);
    const item = requestData.itemId ? actor?.items.get(requestData.itemId) : null;
    
    // executeHealExtensionNow 직접 호출
    await this.executeHealExtensionNow(actor, requestData.healData, item);
    return;
  }
  
  // instant에서 온 경우: 기존 로직
  const { userId, actorId, actorName, targets, formulaDice, formulaAdd, rivival, resurrect, triggerItemName, healTo, encroachFixed } = requestData;
  
  // 공식 텍스트 생성
  let formulaText = '';
  if (formulaDice > 0) {
    formulaText = `${formulaDice}D10+${formulaAdd}`;
  } else {
    formulaText = `${formulaAdd}`;
  }
  
  // GM 확인 다이얼로그
  const targetNames = targets.map(t => t.name).join(', ');
  const confirmContent = `
    <div style="text-align: center;">
      <p><strong>${actorName}</strong>이(가) HP 회복을 실행하려 합니다.</p>
      <p>${game.i18n.localize('DX3rd.Target')}: ${targetNames}</p>
      <p>${game.i18n.localize('DX3rd.Formula')}: ${formulaText}</p>
    </div>
  `;
  
  // 설정 확인: 자동 승인 여부 또는 skipDialog 플래그
  const autoApply = game.settings.get('dx3rd-emanim', 'DX3rd.AutoApplyExtensions');
  const skipDialog = requestData.skipDialog || false;
  
  if (!autoApply && !skipDialog) {
    const confirmed = await window.DX3rdUniversalConfirmDialogV2({
      title: 'HP 회복 확인',
      content: confirmContent,
      yesLabel: game.i18n.localize('DX3rd.Confirm'),
      noLabel: game.i18n.localize('DX3rd.Cancel'),
      defaultYes: true
    });
    
    if (!confirmed) {
      // 거부 시 요청자에게 알림
      if (userId !== game.user.id) {
        game.socket.emit('system.dx3rd-emanim', {
          type: 'healRejected',
          data: { userId: userId }
        });
      }
      return;
    }
  } else {
    if (skipDialog) {
      console.log('DX3rd | Skipping heal confirmation dialog (from queue)');
    } else {
      console.log('DX3rd | Auto-applying heal extension (setting enabled)');
    }
  }
  
  // 회복량 계산 (다이스롤은 한 번만 실행)
  let healAmount = 0;
  let rollMessage = '';
  
  if (formulaDice > 0) {
    const roll = await new Roll(`${formulaDice}d10 + ${formulaAdd}`).roll();
    healAmount = roll.total;
    
    // 롤 결과를 HTML로 변환
    const rollHTML = await roll.render();
    rollMessage = `<div class="dice-roll">${rollHTML}</div>`;
    
    console.log(`DX3rd | HP heal roll: ${formulaDice}d10+${formulaAdd} = ${healAmount}`);
  } else {
    healAmount = formulaAdd;
    console.log(`DX3rd | HP heal (no dice): ${healAmount}`);
  }
  
  // 각 대상에게 회복 적용
  for (const targetData of targets) {
    const targetActor = game.actors.get(targetData.id);
    if (!targetActor) continue;
    
    const currentHP = targetActor.system.attributes.hp?.value || 0;
    const maxHP = targetActor.system.attributes.hp?.max || 0;
    
    // 전투 불능 회복 체크가 없고 HP가 0이면 회복 불가
    if (!rivival && currentHP === 0) {
      await ChatMessage.create({
        speaker: ChatMessage.getSpeaker({ actor: targetActor }),
        content: `전투 불능 상태로 HP 회복 불가`,
        flags: {
          'dx3rd-emanim': {
            messageType: 'heal'
          }
        }
      });
      console.log(`DX3rd | HP heal blocked: ${targetActor.name} is incapacitated`);
      continue;
    }
    
    // HP 회복 적용
    //  - healTo(상한회복/부활)가 지정되면 "현재 HP가 목표보다 낮을 때 목표까지 끌어올림"
    //  - 그 외에는 기존 고정 가산 회복
    let newHP;
    if (healTo !== null && healTo !== undefined && healTo !== '') {
      const targetHP = (String(healTo).toLowerCase() === 'max') ? maxHP : Math.min(parseInt(healTo) || 0, maxHP);
      newHP = Math.max(currentHP, targetHP);
    } else {
      newHP = Math.min(currentHP + healAmount, maxHP);
    }
    const actualHealAmount = newHP - currentHP;  // 실제 회복량 계산
    
    // 폭주 bloodsucking 타입이면 HP 회복 불가 (감소는 가능)
    const berserkActive = targetActor.system?.conditions?.berserk?.active || false;
    const berserkType = targetActor.system?.conditions?.berserk?.type || '';
    const berserkBloodsucking = berserkActive && berserkType === 'bloodsucking';
    
    if (berserkBloodsucking && actualHealAmount > 0) {
      await ChatMessage.create({
        speaker: ChatMessage.getSpeaker({ actor: targetActor }),
        content: `폭주(흡혈) 효과로 HP 회복 불가`,
        flags: {
          'dx3rd-emanim': {
            messageType: 'heal'
          }
        }
      });
      console.log(`DX3rd | HP heal blocked: ${targetActor.name} has berserk bloodsucking`);
      continue;
    }
    
    const updates = { 'system.attributes.hp.value': newHP };

    // 침식률 부작용 누적: resurrect(회복분) + encroachFixed(고정치/다이스). 둘 다 있어도 합산.
    let encDelta = 0;
    if (resurrect) {
      encDelta += actualHealAmount;  // 리저렉트: 실제 회복한 HP만큼 침식률 증가
    }
    if (encroachFixed !== null && encroachFixed !== undefined && String(encroachFixed).trim() !== '' && String(encroachFixed).trim() !== '-') {
      const ef = String(encroachFixed).trim();
      if (/d/i.test(ef)) {
        // 다이스식(2d10 등): GM측에서 롤하고 채팅 표시
        const encRoll = await new Roll(ef).roll();
        await encRoll.toMessage({
          speaker: ChatMessage.getSpeaker({ actor: targetActor }),
          flavor: `${game.i18n.localize('DX3rd.Encroachment') || '침식률'} +`
        });
        encDelta += encRoll.total;
      } else {
        encDelta += parseInt(ef) || 0;
      }
    }
    if (encDelta) {
      const currentEncroachment = targetActor.system.attributes.encroachment?.value || 0;
      updates['system.attributes.encroachment.value'] = currentEncroachment + encDelta;
      console.log(`DX3rd | Encroachment +${encDelta}: ${targetActor.name} (${currentEncroachment} → ${currentEncroachment + encDelta})`);
    }

    await targetActor.update(updates);

    // 부활(rivival): 회복 후 HP>0이면 전투불능(dead) 상태 소거 — 조건 핸들러가 death mark/소켓 동기까지 처리
    let revivedCleared = false;
    if (rivival && newHP > 0) {
      const deadEff = targetActor.effects.find(e => e.statuses?.has('dead'));
      if (deadEff) {
        try {
          await targetActor.toggleStatusEffect('dead', { active: false });
          revivedCleared = true;
        } catch (e) {
          console.error('DX3rd | clear dead status failed', e);
        }
      }
    }

    // 회복 메시지 출력 (해당 액터 스피커로, 시스템 메시지로 처리)
    let healText = `HP ${actualHealAmount} 회복`;

    // triggerItemName이 있으면 표시 (afterMain에서 온 경우)
    if (triggerItemName) {
      // 아이템 이름에서 ||RubyText 제거
      const cleanItemName = triggerItemName.split('||')[0];
      healText = `HP ${actualHealAmount} 회복 (${cleanItemName})`;
    }
    // 부활/침식 표시
    if (revivedCleared) healText += ` (${game.i18n.localize('DX3rd.Defeated') || '전투불능'} ${game.i18n.localize('DX3rd.Clear') || '소거'})`;
    if (encDelta) healText += ` (${game.i18n.localize('DX3rd.Encroachment') || '침식률'} +${encDelta})`;
    
    const content = rollMessage 
      ? `<div class="dx3rd-item-chat"><div>${healText}</div>${rollMessage}</div>`
      : `<div class="dx3rd-item-chat"><div>${healText}</div></div>`;
    
    await ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ actor: targetActor }),
      content: content,
      flags: {
        'dx3rd-emanim': {
          messageType: 'heal'
        }
      }
    });
    
    console.log(`DX3rd | HP healed: ${targetActor.name} +${healAmount} HP (${currentHP} → ${newHP})`);
  }
};

// ========== HP 데미지 시스템 ========== //
/**
 * HP 데미지 익스텐션 실행
 * @param {Actor} actor - 사용자 액터
 * @param {Object} damageData - 데미지 데이터
 * @param {Item} item - 연동된 아이템 (옵션)
 */
window.DX3rdUniversalHandler.executeDamageExtension = async function(actor, damageData, item = null) {
  console.log('DX3rd | executeDamageExtension called', { actor: actor.name, damageData, item: item?.name });
  
  const { timing } = damageData;
  
  // afterMain, afterDamage, afterSuccess는 각 버튼/호출 지점에서 직접 큐에 등록하므로 여기서는 처리 안 함
  if (timing === 'afterMain' || timing === 'afterDamage' || timing === 'afterSuccess') {
    console.log(`DX3rd | ${timing} timing - will be handled by caller or button handler`);
    return;
  }
  
  // instant 타이밍이면 즉시 실행
  await this.executeDamageExtensionNow(actor, damageData, item);
};

/**
 * HP 데미지 조건부 공식 입력 다이얼로그 (호출한 클라이언트에만 표시)
 * @returns {Promise<{dice: string, add: string}|null>}
 */
window.DX3rdUniversalHandler.promptConditionalDamageFormula = async function() {
  return await new Promise(async (resolve) => {
    const dialogContent = `
      <div style="padding: 10px;">
        <div style="margin-bottom: 10px;">
          <label style="display: block; margin-bottom: 5px;">${game.i18n.localize('DX3rd.Dice')} ${game.i18n.localize('DX3rd.Quantity')}:</label>
          <input type="text" id="custom-dice" value="" style="width: 100%; padding: 5px;">
        </div>
        <div style="margin-bottom: 10px;">
          <label style="display: block; margin-bottom: 5px;">${game.i18n.localize('DX3rd.Bonus')}:</label>
          <input type="text" id="custom-add" value="" style="width: 100%; padding: 5px;">
        </div>
      </div>
    `;

    const DialogV2 = foundry.applications?.api?.DialogV2;
    if (!DialogV2) {
      ui.notifications.error(game.i18n.localize('DX3rd.DialogV2Unavailable'));
      resolve(null);
      return;
    }

    const dialog = new DialogV2({
      window: { title: `${game.i18n.localize('DX3rd.Conditional')} ${game.i18n.localize('DX3rd.Formula')}` },
      content: dialogContent,
      buttons: [
        {
          action: 'confirm',
          icon: '<i class="fas fa-check"></i>',
          label: game.i18n.localize('DX3rd.Confirm'),
          default: true,
          callback: (event, button) => {
            const root = button.form || button.element?.closest('.application') || button.element?.ownerDocument;
            const dice = root?.querySelector('#custom-dice')?.value || '';
            const add = root?.querySelector('#custom-add')?.value || '';
            resolve({ dice, add });
          }
        },
        {
          action: 'cancel',
          icon: '<i class="fas fa-times"></i>',
          label: game.i18n.localize('DX3rd.Cancel'),
          callback: () => resolve(null)
        }
      ]
    });
    await dialog.render(true);

    const root = dialog.element;
    const diceInput = root?.querySelector('#custom-dice');
    const addInput = root?.querySelector('#custom-add');
    const confirmButton = root?.querySelector('button[data-action="confirm"]');

    const checkInputs = () => {
      const diceValue = diceInput?.value.trim() || '';
      const addValue = addInput?.value.trim() || '';

      if (confirmButton) {
        confirmButton.disabled = !diceValue && !addValue;
        confirmButton.style.opacity = confirmButton.disabled ? '0.5' : '1';
      }
    };

    checkInputs();
    diceInput?.addEventListener('input', checkInputs);
    addInput?.addEventListener('input', checkInputs);
  });
};

/**
 * 자원소비 비례형(네이티브 필드 system.resourceCost) 처리.
 *   - HP(기본)를 상한 내에서 n 소비 → applied 버프 value = n × mult 를 attrKey(달성치 add/공격력 attack/가드 guard/장갑 armor 등)에 부여.
 *   - 버프 수명(disable)은 필드값(기본 main = 그 메인 프로세스 동안).
 *   - self 한정(대상측 변경 없음 → GM 권한 불필요).
 * "HP가 0 이하로 내려가도록 소비할 수는 없다" 규칙을 상한에 반영(min(cap, 현재HP)).
 * @param {Actor} actor
 * @param {Item} item
 */
window.DX3rdUniversalHandler.processResourceCost = async function(actor, item) {
  try {
    const rc = item?.system?.resourceCost;
    if (!rc || !rc.enabled) return;
    if (!actor) return;

    const resource = rc.resource || 'hp';
    // input 모드: 자원을 소비하지 않고 "사용 시 임의값 입력"만 받아 그 값을 보정으로 적용(동적참조 대체).
    //   동적 토큰([침식률÷10]/[최대HP-현재HP]/[소비한 HP] 등)을 자동계산 대신 플레이어가 직접 입력.
    const isInput = (resource === 'input');

    // 상한 공식 평가([level]*3 / 20 등 → 숫자). 비숫자면 0.
    let cap = Number(this.evaluateFormulaForExtension(String(rc.cap ?? ''), item, actor));
    if (!Number.isFinite(cap)) cap = 0;
    cap = Math.max(0, Math.floor(cap));

    // HP는 0 이하 불가 → 실제 상한 = min(cap, 현재HP). input은 cap 없으면 넉넉한 기본 상한(99).
    const curHp = Number(actor.system?.attributes?.hp?.value ?? 0);
    const usableMax = (resource === 'hp') ? Math.max(0, Math.min(cap, curHp))
                    : isInput ? (cap > 0 ? cap : 99)
                    : cap;

    if (usableMax <= 0) {
      ui.notifications?.warn(`${item.name}: ${game.i18n.localize('DX3rd.ResourceCostNone')}`);
      return;
    }

    // n 입력(0~usableMax). input 모드는 초기값 0(입력 유도).
    const n = await this.promptResourceAmount(item, resource, usableMax, isInput ? 0 : usableMax);
    if (n === null || n <= 0) return; // 취소 또는 0

    // 자원 차감(hp만; input/기타는 차감 없음)
    if (resource === 'hp') {
      await actor.update({ 'system.attributes.hp.value': curHp - n });
    }

    // applied 버프 부여
    const value = n * (Number(rc.mult) || 1);
    const uid = foundry.utils.randomID();
    const key = `rescost_${item.id}`;
    await actor.update({ [`system.attributes.applied.${key}`]: {
      name: item.name,
      source: actor.name,
      disable: rc.disable || 'main',
      img: item.img || 'icons/svg/aura.svg',
      attributes: { [uid]: { key: rc.attrKey || 'add', label: rc.label || '-', value: value } }
    }});

    // 채팅 통지(타 메시지 매처 트리거 방지 위해 중립 문구 사용)
    const attrLabel = game.i18n.localize(`DX3rd.ResourceCostAttr.${rc.attrKey || 'add'}`);
    const lhs = isInput ? game.i18n.localize('DX3rd.ResourceCostInput') : `${resource.toUpperCase()} -${n}`;
    ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ actor }),
      content: `<div class="dx3rd-resource-cost"><b>${item.name}</b><br>${lhs} → ${attrLabel} +${value}</div>`
    });
  } catch (e) {
    console.error('DX3rd | processResourceCost failed', e);
  }
};

/**
 * 침식률 조정 Extend 즉시 실행 (상호참조/동적참조형 — 사용 시 임의값 입력).
 *   값을 자동계산하지 않고(사용자 지시) 사용 시 다이얼로그로 감소량 X(0~max)를 입력받는다.
 *   - 자신 침식 += X × selfMult (자기 액터 직접; 권한 불필요)
 *   - 대상(targetToken) 침식 -= X (대상은 GM 소유 → GM 소켓 위임)
 * @param {Actor} actor
 * @param {Object} encData - { target, max, selfMult, timing, activate }
 * @param {Item} item
 */
window.DX3rdUniversalHandler.executeEncroachExtensionNow = async function(actor, encData, item = null) {
  if (!actor || !actor.id) { ui.notifications.error('액터 정보가 유효하지 않습니다.'); return; }
  const { max = '', selfMult = 1, target = 'targetToken' } = encData || {};

  // 입력 상한(max 공식) 평가
  const itemLevel = (item ? window.DX3rdFormulaEvaluator.getItemLevel(item) : 0) || 1;
  const itemForFormula = { type: item?.type || 'effect', system: { level: { value: itemLevel } } };
  let cap = Number(window.DX3rdFormulaEvaluator.evaluate(String(max || '0'), itemForFormula, actor));
  if (!Number.isFinite(cap) || cap < 0) cap = 0;
  cap = Math.floor(cap);

  // 감소량 X 입력 (0~cap)
  const x = await this.promptEncroachAmount(item, cap);
  if (x === null || x <= 0) return; // 취소 또는 0

  // 1) 자신 침식 상승 (자기 액터 직접)
  const selfDelta = x * (Number(selfMult) || 1);
  const curSelf = Number(actor.system?.attributes?.encroachment?.value ?? 0);
  await actor.update({ 'system.attributes.encroachment.value': curSelf + selfDelta });

  // 2) 대상 수집(targetToken)
  const targets = [];
  if (target === 'targetToken') {
    Array.from(game.user.targets).forEach(t => { if (t.actor && !targets.find(a => a.id === t.actor.id)) targets.push(t.actor); });
  }

  const enc = game.i18n.localize('DX3rd.Encroachment') || '침식률';
  if (targets.length === 0) {
    // 대상 미지정 — 자신 상승만 통지
    ChatMessage.create({ speaker: ChatMessage.getSpeaker({ actor }), content: `<div class="dx3rd-encroach"><b>${item?.name || ''}</b><br>${actor.name}: ${enc} +${selfDelta}</div>` });
    return;
  }

  const requestData = {
    userId: game.user.id,
    actorId: actor.id,
    actorName: actor.name,
    itemName: item?.name || '',
    targets: targets.map(t => ({ id: t.id, name: t.name })),
    targetDelta: -x,        // 대상 침식 감소
    selfDelta: selfDelta,   // 채팅 통지용(자신 상승은 이미 적용됨)
  };

  if (game.user.isGM) {
    await window.DX3rdUniversalHandler.handleEncroachRequest(requestData);
  } else {
    game.socket.emit('system.dx3rd-emanim', { type: 'encroachRequest', requestData });
    ui.notifications.info('GM에게 침식률 조정 요청을 보냈습니다.');
  }
};

/**
 * 침식률 조정 감소량 입력 다이얼로그 (호출한 클라이언트에만 표시).
 * @returns {Promise<number|null>} 입력값(0~cap) 또는 취소 시 null
 */
window.DX3rdUniversalHandler.promptEncroachAmount = async function(item, cap) {
  const enc = game.i18n.localize('DX3rd.Encroachment') || '침식률';
  const DialogV2 = foundry.applications?.api?.DialogV2;
  if (!DialogV2?.wait) {
    ui.notifications.error(game.i18n.localize('DX3rd.DialogV2Unavailable'));
    return null;
  }

  const content = `
    <div style="padding:10px;">
      <p style="margin-bottom:8px;"><b>${item?.name || ''}</b> — ${enc} ${game.i18n.localize('DX3rd.Reduce') || '감소'} (0~${cap})</p>
      <input type="number" id="enc-amount" value="${cap}" min="0" max="${cap}" step="1" style="width:100%; padding:5px;">
    </div>`;
  return await DialogV2.wait({
    window: { title: enc },
    content,
    rejectClose: false,
    buttons: [
      {
        action: 'confirm',
        icon: '<i class="fas fa-check"></i>',
        label: game.i18n.localize('DX3rd.Confirm') || '확인',
        default: true,
        callback: (event, button) => {
          const root = button.form || button.element?.closest('.application') || button.element?.ownerDocument;
          let v = parseInt(root?.querySelector('#enc-amount')?.value);
          if (!Number.isFinite(v)) v = 0;
          return Math.max(0, Math.min(cap, v));
        }
      },
      {
        action: 'cancel',
        icon: '<i class="fas fa-times"></i>',
        label: game.i18n.localize('DX3rd.Cancel') || '취소',
        callback: () => null
      }
    ]
  });
};

/**
 * 침식률 조정 요청 처리 (GM 전용) — 대상 토큰의 침식률 감소 + 통지.
 */
window.DX3rdUniversalHandler.handleEncroachRequest = async function(requestData) {
  if (!game.user.isGM) return;
  const { targets = [], targetDelta = 0, actorName = '', itemName = '', selfDelta = 0 } = requestData || {};
  const enc = game.i18n.localize('DX3rd.Encroachment') || '침식률';
  const lines = [];
  for (const tref of targets) {
    const token = canvas.tokens.get(tref.id);
    const tActor = token?.actor || game.actors.get(tref.id);
    if (!tActor) continue;
    const cur = Number(tActor.system?.attributes?.encroachment?.value ?? 0);
    const next = Math.max(0, cur + targetDelta);   // 0 미만 방지
    await tActor.update({ 'system.attributes.encroachment.value': next });
    lines.push(`${tActor.name}: ${enc} ${targetDelta >= 0 ? '+' : ''}${targetDelta} (→ ${next})`);
  }
  if (lines.length) {
    ChatMessage.create({
      speaker: { alias: actorName },
      content: `<div class="dx3rd-encroach"><b>${itemName}</b><br>${lines.join('<br>')}${selfDelta ? `<br>${actorName}: ${enc} +${selfDelta}` : ''}</div>`
    });
  }
};

/** 데미지 산출 시 맨손(Fist) 무기에만 적용되는 공격력 보너스(attrs.attack.fist). 맨손 아님/비무기면 0. */
window.DX3rdUniversalHandler.getFistAttackBonus = function(actor, item) {
  try {
    if (!item || item.type !== 'weapon' || !actor) return 0;
    const fistName = game.i18n.localize('DX3rd.Fist');
    const isFist = item.name === fistName || item.name.includes(`[${fistName}]`);
    if (!isFist) return 0;
    return Number(actor.system?.attributes?.attack?.fist) || 0;
  } catch (e) { return 0; }
};

/** 자원소비량 n 입력 다이얼로그(0~max). 취소 시 null. */
window.DX3rdUniversalHandler.promptResourceAmount = async function(item, resource, max, initial = max) {
  const DialogV2 = foundry.applications?.api?.DialogV2;
  if (!DialogV2?.wait) {
    ui.notifications.error(game.i18n.localize('DX3rd.DialogV2Unavailable'));
    return null;
  }

  const promptKey = (resource === 'input') ? 'DX3rd.ResourceCostInputPrompt' : 'DX3rd.ResourceCostPrompt';
  const content = `
    <div style="padding:10px;">
      <p style="margin-bottom:8px;">${item.name}: ${game.i18n.localize(promptKey)} <b>(0 ~ ${max})</b></p>
      <input type="number" id="res-amt" value="${initial}" min="0" max="${max}" step="1" style="width:100%; padding:5px;">
    </div>`;
  return await DialogV2.wait({
    window: { title: game.i18n.localize('DX3rd.ResourceCost') },
    content,
    rejectClose: false,
    buttons: [
      {
        action: 'confirm',
        icon: '<i class="fas fa-check"></i>',
        label: game.i18n.localize('DX3rd.Confirm'),
        default: true,
        callback: (event, button) => {
          const root = button.form || button.element?.closest('.application') || button.element?.ownerDocument;
          let v = parseInt(root?.querySelector('#res-amt')?.value, 10);
          if (!Number.isFinite(v)) v = 0;
          return Math.max(0, Math.min(max, v));
        }
      },
      {
        action: 'cancel',
        icon: '<i class="fas fa-times"></i>',
        label: game.i18n.localize('DX3rd.Cancel'),
        callback: () => null
      }
    ]
  });
};

/**
 * HP 데미지 익스텐션 즉시 실행
 * @param {Actor} actor - 사용자 액터
 * @param {Object} damageData - 데미지 데이터
 * @param {Item} item - 연동된 아이템 (옵션)
 * @param {Object} options - 옵션 (skipDialog: 확인 다이얼로그 건너뛰기)
 */
window.DX3rdUniversalHandler.executeDamageExtensionNow = async function(actor, damageData, item = null, options = {}) {
  // actor 유효성 검사
  if (!actor || !actor.id) {
    console.error('DX3rd | executeDamageExtensionNow: Invalid actor', actor);
    ui.notifications.error('액터 정보가 유효하지 않습니다.');
    return;
  }
  
  console.log('DX3rd | executeDamageExtensionNow called', { actor: actor.name, actorId: actor.id, damageData, item: item?.name, options });
  
  let { formulaDice, formulaAdd, target, ignoreReduce, selectedTargetIds, triggerItemName, conditionalFormula } = damageData;
  const { skipDialog = false } = options;
  
  // conditionalFormula가 체크되어 있으면 공식 입력 다이얼로그 표시 (호출한 클라이언트에만)
  if (conditionalFormula) {
    const customFormula = await this.promptConditionalDamageFormula();
    
    if (!customFormula) {
      console.log('DX3rd | Conditional formula input cancelled');
      return; // 취소 시 데미지 적용 중단
    }
    
    // 입력받은 공식으로 덮어쓰기
    formulaDice = customFormula.dice;
    formulaAdd = customFormula.add;
    console.log('DX3rd | Custom damage formula applied:', { formulaDice, formulaAdd });
  }
  
  // 대상 수집
  const targets = [];
  
  if (target === 'self' || target === 'targetAll') {
    targets.push(actor);
  }
  
  if (target === 'targetToken' || target === 'targetAll') {
    if (selectedTargetIds && selectedTargetIds.length > 0) {
      console.log('DX3rd | Using saved target IDs from queue:', selectedTargetIds);
      selectedTargetIds.forEach(tokenId => {
        const token = canvas.tokens.get(tokenId);
        if (token && token.actor && !targets.find(a => a.id === token.actor.id)) {
          targets.push(token.actor);
        }
      });
    } else {
      const selectedTargets = Array.from(game.user.targets);
      selectedTargets.forEach(t => {
        if (t.actor && !targets.find(a => a.id === t.actor.id)) {
          targets.push(t.actor);
        }
      });
    }
  }
  
  console.log(`DX3rd | Damage targets collected: ${targets.map(t => t.name).join(', ')} (total: ${targets.length})`);
  
  if (targets.length === 0) {
    ui.notifications.warn('데미지 대상이 없습니다.');
    return;
  }
  
  // 아이템의 레벨 가져오기 (없으면 1)
  const itemLevel = (item ? window.DX3rdFormulaEvaluator.getItemLevel(item) : 0) || 1;
  const itemForFormula = {
    type: item?.type || 'effect',
    system: {
      level: {
        value: itemLevel
      }
    }
  };
  
  console.log(`DX3rd | Using item level for formula: ${itemLevel} (item: ${item?.name || 'none'})`);
  
  // 공식 평가 (액터의 능력치/기능치 참조)
  let evaluatedDice = 0;
  let evaluatedAdd = 0;
  
  if (formulaDice) {
    const diceFormula = String(formulaDice).trim();
    if (diceFormula && diceFormula !== '0') {
      evaluatedDice = window.DX3rdFormulaEvaluator.evaluate(diceFormula, itemForFormula, actor);
    }
  }
  
  if (formulaAdd) {
    const addFormula = String(formulaAdd).trim();
    if (addFormula && addFormula !== '0') {
      evaluatedAdd = window.DX3rdFormulaEvaluator.evaluate(addFormula, itemForFormula, actor);
    }
  }
  
  console.log(`DX3rd | Damage formula evaluated - Dice: ${formulaDice} → ${evaluatedDice}, Add: ${formulaAdd} → ${evaluatedAdd}`);
  
  // GM에게 소켓 요청
  const requestData = {
    userId: game.user.id,
    actorId: actor.id,
    actorName: actor.name,
    targets: targets.map(t => ({ id: t.id, name: t.name })),
    formulaDice: Math.max(0, parseInt(evaluatedDice) || 0),
    formulaAdd: parseInt(evaluatedAdd) || 0,
    ignoreReduce: ignoreReduce || false,
    triggerItemName: (triggerItemName || item?.name || null),
    skipDialog: skipDialog  // 확인 다이얼로그 건너뛰기 플래그
  };
  
  if (game.user.isGM) {
    // GM이면 직접 처리
    await window.DX3rdUniversalHandler.handleDamageRequest(requestData);
  } else {
    // 플레이어면 GM에게 요청
    game.socket.emit('system.dx3rd-emanim', {
      type: 'damageRequest',
      requestData: requestData  // data → requestData로 수정
    });
    ui.notifications.info('GM에게 데미지 요청을 보냈습니다.');
  }
};

/**
 * HP 데미지 요청 처리 (GM 전용)
 */
window.DX3rdUniversalHandler.handleDamageRequest = async function(requestData) {
  if (!game.user.isGM) return;
  
  console.log('DX3rd | handleDamageRequest called with:', requestData);
  
  // requestData가 undefined인 경우 체크
  if (!requestData) {
    console.error('DX3rd | handleDamageRequest - requestData is undefined!');
    return;
  }
  
  // afterSuccess에서 온 경우: damageData가 있음
  if (requestData.damageData) {
    const actor = game.actors.get(requestData.actorId);
    const item = requestData.itemId ? actor?.items.get(requestData.itemId) : null;
    
    // executeDamageExtensionNow 직접 호출
    await this.executeDamageExtensionNow(actor, requestData.damageData, item);
    return;
  }
  
  // instant에서 온 경우: 기존 로직
  const { userId, actorId, actorName, targets, formulaDice, formulaAdd, ignoreReduce, triggerItemName } = requestData;
  
  // 공식 텍스트 생성
  let formulaText = '';
  if (formulaDice > 0) {
    formulaText = `${formulaDice}D10+${formulaAdd}`;
  } else {
    formulaText = `${formulaAdd}`;
  }
  
  // GM 확인 다이얼로그
  const targetNames = targets.map(t => t.name).join(', ');
  const confirmContent = `
    <div style="text-align: center;">
      <p><strong>${actorName}</strong>이(가) HP 데미지를 실행하려 합니다.</p>
      <p>대상: ${targetNames}</p>
      <p>공식: ${formulaText}</p>
      ${ignoreReduce ? '<p>방어 무시: 예</p>' : ''}
      <p>확인하시겠습니까?</p>
    </div>
  `;
  
  // 설정 확인: 자동 승인 여부 또는 skipDialog 플래그
  const autoApplyDamage = game.settings.get('dx3rd-emanim', 'DX3rd.AutoApplyExtensions');
  const skipDialog = requestData.skipDialog || false;
  
  if (!autoApplyDamage && !skipDialog) {
    const confirmed = await window.DX3rdUniversalConfirmDialogV2({
      title: 'HP 데미지 확인',
      content: confirmContent,
      yesLabel: game.i18n.localize('DX3rd.Confirm'),
      noLabel: game.i18n.localize('DX3rd.Cancel'),
      defaultYes: true
    });
    
    if (!confirmed) {
      // 거부 시 요청자에게 알림
      if (userId !== game.user.id) {
        game.socket.emit('system.dx3rd-emanim', {
          type: 'damageRejected',
          data: { userId: userId }
        });
      }
      return;
    }
  } else {
    if (skipDialog) {
      console.log('DX3rd | Skipping damage confirmation dialog (from queue)');
    } else {
      console.log('DX3rd | Auto-applying damage extension (setting enabled)');
    }
  }
  
  // 데미지 계산 (다이스롤은 한 번만 실행)
  let damageAmount = 0;
  let rollMessage = '';
  
  if (formulaDice > 0) {
    const roll = await new Roll(`${formulaDice}d10 + ${formulaAdd}`).roll();
    damageAmount = roll.total;
    
    // 롤 결과를 HTML로 변환
    const rollHTML = await roll.render();
    rollMessage = `<div class="dice-roll">${rollHTML}</div>`;
    
    console.log(`DX3rd | HP damage roll: ${formulaDice}d10+${formulaAdd} = ${damageAmount}`);
  } else {
    damageAmount = formulaAdd;
    console.log(`DX3rd | HP damage (no dice): ${damageAmount}`);
  }
  
  // 각 대상에게 데미지 적용
  for (const targetData of targets) {
    const targetActor = game.actors.get(targetData.id);
    if (!targetActor) continue;
    
    const currentHP = targetActor.system.attributes.hp?.value || 0;
    const reduce = targetActor.system.attributes.reduce?.value || 0;
    
    // 실제 데미지 = 롤 데미지 - 데미지 경감 (경감 무시가 아닌 경우)
    // armor는 기본적으로 무시, reduce만 고려
    const actualDamage = ignoreReduce 
      ? damageAmount 
      : Math.max(0, damageAmount - reduce);
    
    const newHP = Math.max(0, currentHP - actualDamage);
    const actualHpLoss = currentHP - newHP;  // 실제 HP 감소량
    await targetActor.update({ 'system.attributes.hp.value': newHP });
    
    // 데미지 메시지 출력 (해당 액터 스피커로, 시스템 메시지로 처리)
    let damageText = `HP ${actualHpLoss} 데미지`;
    
    // triggerItemName이 있으면 표시 (afterMain에서 온 경우)
    if (triggerItemName) {
      const cleanItemName = triggerItemName.split('||')[0];
      damageText = `HP ${actualHpLoss} 데미지 (${cleanItemName})`;
    }
    
    const content = rollMessage 
      ? `<div class="dx3rd-item-chat"><div>${damageText}</div>${rollMessage}</div>`
      : `<div class="dx3rd-item-chat"><div>${damageText}</div></div>`;
    
    await ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ actor: targetActor }),
      content: content,
      flags: {
        'dx3rd-emanim': {
          messageType: 'damage'
        }
      }
    });
    
    console.log(`DX3rd | HP damaged: ${targetActor.name} -${actualDamage} HP (${currentHP} → ${newHP})`);
  }
};

// ========== 상태이상 시스템 ========== //
/**
 * itemExtend.condition에서 활성화된 조건 항목 배열 반환 (conditions 배열 또는 기존 단일 형식)
 * @param {Object} condData - itemExtend.condition
 * @returns {Array<{timing, target, type, poisonedRank, activate}>}
 */
window.DX3rdUniversalHandler._getConditionEntries = function(condData) {
  if (!condData) return [];
  if (Array.isArray(condData.conditions)) {
    return condData.conditions.filter(c => c && c.activate && c.type);
  }
  if (condData.activate && (condData.type || (condData.conditionTypes && condData.conditionTypes.length))) {
    const types = condData.conditionTypes || [condData.type];
    return types.filter(t => t).map(t => ({
      timing: condData.timing || 'instant',
      target: condData.target || 'self',
      type: t,
      poisonedRank: t === 'poisoned' ? (condData.poisonedRank ?? null) : null,
      activate: true
    }));
  }
  return [];
};

/**
 * 상태이상 익스텐션 실행
 * @param {Actor} actor - 사용자 액터
 * @param {Object} conditionData - 상태이상 데이터
 * @param {Item} item - 연동된 아이템 (옵션)
 */
window.DX3rdUniversalHandler.executeConditionExtension = async function(actor, conditionData, item = null) {
  console.log('DX3rd | executeConditionExtension called', { actor: actor.name, conditionData, item: item?.name });
  
  const { timing } = conditionData;
  
  // afterMain, afterDamage, afterSuccess는 각 버튼/호출 지점에서 직접 큐에 등록하므로 여기서는 처리 안 함
  if (timing === 'afterMain' || timing === 'afterDamage' || timing === 'afterSuccess') {
    console.log(`DX3rd | ${timing} timing - will be handled by caller or button handler`);
    return;
  }
  
  // instant 타이밍이면 즉시 실행
  await this.executeConditionExtensionNow(actor, conditionData, item);
};

/**
 * 상태이상 익스텐션 즉시 실행
 * @param {Actor} actor - 사용자 액터
 * @param {Object} conditionData - 상태이상 데이터
 * @param {Item} item - 연동된 아이템 (옵션)
 */
window.DX3rdUniversalHandler.executeConditionExtensionNow = async function(actor, conditionData, item = null) {
  console.log('DX3rd | executeConditionExtensionNow called', { actor: actor.name, conditionData, item: item?.name });
  
  const { target, selectedTargetIds, triggerItemName, poisonedRank } = conditionData;
  
  // conditionTypes 배열이 있으면 복수 상태이상 → executeConditionExtensionsNowBulk 호출
  const conditionTypes = conditionData.conditionTypes;
  if (Array.isArray(conditionTypes) && conditionTypes.length > 0) {
    const bulkData = {
      conditionTypes,
      target,
      selectedTargetIds: selectedTargetIds || [],
      triggerItemName: triggerItemName || item?.name || null,
      poisonedRank: poisonedRank || null,
      itemId: item?.id || null
    };
    await this.executeConditionExtensionsNowBulk(actor, bulkData);
    return;
  }
  
  // 단일 상태이상: conditionType 또는 type 필드
  const conditionType = conditionData.conditionType || conditionData.type;
  if (!conditionType) {
    console.error('DX3rd | conditionType is missing from conditionData:', conditionData);
    ui.notifications.error('상태이상 타입이 지정되지 않았습니다.');
    return;
  }
  
  console.log(`DX3rd | Condition type: ${conditionType}`);
  
  // 대상 수집
  const targets = [];
  
  if (target === 'self' || target === 'targetAll') {
    targets.push(actor);
  }
  
  if (target === 'targetToken' || target === 'targetAll') {
    if (selectedTargetIds && selectedTargetIds.length > 0) {
      console.log('DX3rd | Using saved target IDs from queue:', selectedTargetIds);
      selectedTargetIds.forEach(tokenId => {
        const token = canvas.tokens.get(tokenId);
        if (token && token.actor && !targets.find(a => a.id === token.actor.id)) {
          targets.push(token.actor);
        }
      });
    } else {
      const selectedTargets = Array.from(game.user.targets);
      selectedTargets.forEach(t => {
        if (t.actor && !targets.find(a => a.id === t.actor.id)) {
          targets.push(t.actor);
        }
      });
    }
  }
  
  console.log(`DX3rd | Condition targets collected: ${targets.map(t => t.name).join(', ')} (total: ${targets.length})`);
  
  if (targets.length === 0) {
    ui.notifications.warn('상태이상 대상이 없습니다.');
    return;
  }
  
  // GM에게 소켓 요청
  const requestData = {
    userId: game.user.id,
    actorId: actor.id,
    actorName: actor.name,
    targets: targets.map(t => ({ id: t.id, name: t.name })),
    conditionType: conditionType,
    triggerItemName: (triggerItemName || item?.name || null),
    poisonedRank: poisonedRank || null,
    itemId: item?.id || null
  };
  
  if (game.user.isGM) {
    // GM이면 직접 처리
    await window.DX3rdUniversalHandler.handleConditionRequest(requestData);
  } else {
    // 플레이어면 GM에게 요청
    game.socket.emit('system.dx3rd-emanim', {
      type: 'conditionRequest',
      requestData: requestData
    });
    ui.notifications.info('GM에게 상태이상 요청을 보냈습니다.');
  }
};

/**
 * 상태이상 다건 즉시 실행(같은 타이밍/같은 대상 버킷용)
 * @param {Actor} actor
 * @param {Object} bulkData - { conditionTypes: string[], target, selectedTargetIds, triggerItemName, poisonedRank }
 */
window.DX3rdUniversalHandler.executeConditionExtensionsNowBulk = async function(actor, bulkData) {
  const { conditionTypes = [], target, selectedTargetIds, triggerItemName, poisonedRank, itemId } = bulkData || {};
  if (!Array.isArray(conditionTypes) || conditionTypes.length === 0) return;
  // 대상 수집(단 한 번)
  const targets = [];
  if (target === 'self' || target === 'targetAll') targets.push(actor);
  if (target === 'targetToken' || target === 'targetAll') {
    if (selectedTargetIds && selectedTargetIds.length > 0) {
      selectedTargetIds.forEach(tokenId => {
        const token = canvas.tokens.get(tokenId);
        if (token?.actor && !targets.find(a => a.id === token.actor.id)) targets.push(token.actor);
      });
    } else {
      const selected = Array.from(game.user.targets);
      selected.forEach(t => { if (t.actor && !targets.find(a => a.id === t.actor.id)) targets.push(t.actor); });
    }
  }
  if (targets.length === 0) {
    ui.notifications.warn('상태이상 대상이 없습니다.');
    return;
  }
  const requestData = {
    userId: game.user.id,
    actorId: actor.id,
    actorName: actor.name,
    targets: targets.map(t => ({ id: t.id, name: t.name })),
    conditionTypes,
    triggerItemName: triggerItemName || null,
    poisonedRank: poisonedRank || null,
    itemId: itemId || null
  };
  if (game.user.isGM) {
    await this.handleConditionRequestBulk(requestData);
  } else {
    game.socket.emit('system.dx3rd-emanim', { type: 'conditionRequestBulk', data: requestData });
    ui.notifications.info('GM에게 상태이상(복수) 요청을 보냈습니다.');
  }
};

/**
 * 상태이상 다건 요청 처리(GM 전용) - 한 번의 다이얼로그에서 승인
 */
window.DX3rdUniversalHandler.handleConditionRequestBulk = async function(requestData) {
  if (!game.user.isGM) return;
  const { userId, actorId, actorName, targets, conditionTypes = [], triggerItemName } = requestData;
  let { poisonedRank } = requestData;
  if (conditionTypes.length === 0) return;
  
  // 사독 랭크가 포뮬러 문자열인 경우 여기서 숫자로 평가 (병합 시 이미 평가됐을 수도 있음)
  console.log('DX3rd | handleConditionRequestBulk - Initial poisonedRank:', poisonedRank, 'conditionTypes:', conditionTypes);
  try {
    if (conditionTypes.includes('poisoned') && poisonedRank !== undefined && poisonedRank !== null) {
      // 이미 숫자면 그대로 사용, 문자열이면 평가
      if (typeof poisonedRank === 'number') {
        console.log('DX3rd | Poisoned rank already evaluated:', poisonedRank);
      } else if (typeof poisonedRank === 'string' && poisonedRank.trim() !== '') {
        console.log('DX3rd | Poisoned rank detected, checking if formula:', poisonedRank);
        if (typeof window.DX3rdFormulaEvaluator?.evaluate === 'function' && /\[/.test(poisonedRank)) {
          const actor = game.actors.get(actorId);
          const item = requestData.itemId ? actor?.items.get(requestData.itemId) : null;
          const itemLevel = item?.system?.level?.value ?? 1;
          const itemForFormula = item ? item : { type: 'effect', system: { level: { value: itemLevel } } };
          const evaluated = window.DX3rdFormulaEvaluator.evaluate(poisonedRank, itemForFormula, actor);
          const num = Number(evaluated);
          console.log('DX3rd | Evaluated poisonedRank formula:', poisonedRank, '→', evaluated, '→', num);
          if (!Number.isNaN(num) && Number.isFinite(num) && num > 0) poisonedRank = num;
        } else {
          poisonedRank = Number(poisonedRank) || 0;
        }
      }
    }
  } catch (e) {
    console.warn('DX3rd | Failed to evaluate poisonedRank formula in bulk:', e);
  }
  console.log('DX3rd | handleConditionRequestBulk - Final poisonedRank:', poisonedRank);
  
  const targetNames = (targets || []).map(t => t.name).join(', ');
  const conditionNames = conditionTypes.map(ct => game.i18n.localize(`DX3rd.${ct.charAt(0).toUpperCase() + ct.slice(1)}`)).join(', ');
  const confirmContent = `
    <div style="text-align: center;">
      <p><strong>${actorName}</strong>이(가) 상태이상을 부여하려 합니다.</p>
      <p>대상: ${targetNames}</p>
      <p>상태이상: ${conditionNames}</p>
      <p>확인하시겠습니까?</p>
    </div>`;
  // 설정 확인: 자동 승인 여부
  const autoApplyCondition = game.settings.get('dx3rd-emanim', 'DX3rd.AutoApplyExtensions');
  
  if (!autoApplyCondition) {
    const confirmed = await window.DX3rdUniversalConfirmDialogV2({
      title: '상태이상 부여 확인',
      content: confirmContent,
      yesLabel: game.i18n.localize('DX3rd.Confirm'),
      noLabel: game.i18n.localize('DX3rd.Cancel'),
      defaultYes: true
    });
    if (!confirmed) {
      if (userId !== game.user.id) game.socket.emit('system.dx3rd-emanim', { type: 'conditionRejected', data: { userId } });
      return;
    }
  } else {
    console.log('DX3rd | Auto-applying condition extension (setting enabled)');
  }
  
  // 💡 특수 상태이상(증오/공포/폭주)의 경우 미리 입력 받기
  const specialConditions = {};
  for (const ct of conditionTypes) {
    if (ct === 'hatred') {
      // 증오: 현재 씬의 다른 토큰 선택
      const currentScene = game.scenes.active;
      if (!currentScene) {
        ui.notifications.warn("활성화된 장면이 없습니다.");
        return;
      }
      
      // 대상 액터 ID 가져오기 (첫 번째 타겟)
      const targetActorId = (targets && targets[0]) ? targets[0].id : null;
      
      const otherTokens = currentScene.tokens
        .filter(t => t.actor && t.actor.id !== targetActorId && !t.hidden)
        .map(t => ({ id: t.id, name: t.name }))
        .sort((a, b) => a.name.localeCompare(b.name, 'ko'));
      
      if (otherTokens.length === 0) {
        ui.notifications.warn("선택할 수 있는 토큰이 없습니다.");
        return;
      }
      
      const options = otherTokens.map(t => `<option value="${t.name}">${t.name}</option>`).join('');
      const template = `
        <div class="condition-rank-dialog">
          <div class="form-group">
            <label>${game.i18n.localize("DX3rd.HatredInputText")}</label>
            <select id="condition-target" style="width: 100%; text-align: center;">
              ${options}
            </select>
          </div>
        </div>
        <style>
        .condition-rank-dialog { padding: 5px; }
        .condition-rank-dialog .form-group { display: flex; flex-direction: column; gap: 8px; margin-top: 0px; margin-bottom: 5px; }
        .condition-rank-dialog label { font-weight: bold; font-size: 14px; }
        .condition-rank-dialog select { padding: 4px; font-size: 14px; border: 1px solid #ccc; border-radius: 4px; background: white; color: black; }
        </style>
      `;
      
      const DialogV2 = foundry.applications?.api?.DialogV2;
      if (!DialogV2?.wait) {
        ui.notifications.error(game.i18n.localize('DX3rd.DialogV2Unavailable'));
        return;
      }

      const hatredTarget = await DialogV2.wait({
        window: { title: game.i18n.localize("DX3rd.Hatred") },
        content: template,
        rejectClose: false,
        buttons: [
          {
            action: 'confirm',
            icon: '<i class="fas fa-check"></i>',
            label: game.i18n.localize("DX3rd.Confirm"),
            default: true,
            callback: (event, button) => {
              const root = button.form || button.element?.closest('.application') || button.element?.ownerDocument;
              return root?.querySelector("#condition-target")?.value || null;
            }
          },
          {
            action: 'cancel',
            icon: '<i class="fas fa-times"></i>',
            label: game.i18n.localize("DX3rd.Cancel"),
            callback: () => null
          }
        ]
      });
      
      if (hatredTarget) {
        specialConditions[ct] = hatredTarget;
        console.log(`DX3rd | Hatred target set:`, hatredTarget);
      } else {
        console.log(`DX3rd | Hatred cancelled`);
        return;
      }
    } else if (ct === 'fear') {
      // 공포: 현재 씬의 다른 토큰 선택
      const currentScene = game.scenes.active;
      if (!currentScene) {
        ui.notifications.warn("활성화된 장면이 없습니다.");
        return;
      }
      
      // 대상 액터 ID 가져오기 (첫 번째 타겟)
      const targetActorId = (targets && targets[0]) ? targets[0].id : null;
      
      const otherTokens = currentScene.tokens
        .filter(t => t.actor && t.actor.id !== targetActorId && !t.hidden)
        .map(t => ({ id: t.id, name: t.name }))
        .sort((a, b) => a.name.localeCompare(b.name, 'ko'));
      
      if (otherTokens.length === 0) {
        ui.notifications.warn("선택할 수 있는 토큰이 없습니다.");
        return;
      }
      
      const options = otherTokens.map(t => `<option value="${t.name}">${t.name}</option>`).join('');
      const template = `
        <div class="condition-rank-dialog">
          <div class="form-group">
            <label>${game.i18n.localize("DX3rd.FearInputText")}</label>
            <select id="condition-target" style="width: 100%; text-align: center;">
              ${options}
            </select>
          </div>
        </div>
        <style>
        .condition-rank-dialog { padding: 5px; }
        .condition-rank-dialog .form-group { display: flex; flex-direction: column; gap: 8px; margin-top: 0px; margin-bottom: 5px; }
        .condition-rank-dialog label { font-weight: bold; font-size: 14px; }
        .condition-rank-dialog select { padding: 4px; font-size: 14px; border: 1px solid #ccc; border-radius: 4px; background: white; color: black; }
        </style>
      `;
      
      const DialogV2 = foundry.applications?.api?.DialogV2;
      if (!DialogV2?.wait) {
        ui.notifications.error(game.i18n.localize('DX3rd.DialogV2Unavailable'));
        return;
      }

      const fearTarget = await DialogV2.wait({
        window: { title: game.i18n.localize("DX3rd.Fear") },
        content: template,
        rejectClose: false,
        buttons: [
          {
            action: 'confirm',
            icon: '<i class="fas fa-check"></i>',
            label: game.i18n.localize("DX3rd.Confirm"),
            default: true,
            callback: (event, button) => {
              const root = button.form || button.element?.closest('.application') || button.element?.ownerDocument;
              return root?.querySelector("#condition-target")?.value || null;
            }
          },
          {
            action: 'cancel',
            icon: '<i class="fas fa-times"></i>',
            label: game.i18n.localize("DX3rd.Cancel"),
            callback: () => null
          }
        ]
      });
      
      if (fearTarget) {
        specialConditions[ct] = fearTarget;
        console.log(`DX3rd | Fear target set:`, fearTarget);
      } else {
        console.log(`DX3rd | Fear cancelled`);
        return;
      }
    } else if (ct === 'berserk') {
      // 폭주: 타입 선택
      const berserkTypes = [
        { value: "normal", label: game.i18n.localize("DX3rd.Normal") },
        { value: "release", label: game.i18n.localize("DX3rd.UrgeRelease") },
        { value: "hunger", label: game.i18n.localize("DX3rd.UrgeHunger") },
        { value: "bloodsucking", label: game.i18n.localize("DX3rd.UrgeBloodsucking") },
        { value: "slaughter", label: game.i18n.localize("DX3rd.UrgeSlaughter") },
        { value: "destruction", label: game.i18n.localize("DX3rd.UrgeDestruction") },
        { value: "tourture", label: game.i18n.localize("DX3rd.UrgeTourture") },
        { value: "distaste", label: game.i18n.localize("DX3rd.UrgeDistaste") },
        { value: "battlelust", label: game.i18n.localize("DX3rd.UrgeBattlelust") },
        { value: "delusion", label: game.i18n.localize("DX3rd.UrgeDelusion") },
        { value: "selfmutilation", label: game.i18n.localize("DX3rd.UrgeSelfmutilation") },
        { value: "fear", label: game.i18n.localize("DX3rd.UrgeFear") },
        { value: "hatred", label: game.i18n.localize("DX3rd.UrgeHatred") }
      ];
      
      const options = berserkTypes.map(t => `<option value="${t.value}">${t.label}</option>`).join('');
      const template = `
        <div class="condition-rank-dialog">
          <div class="form-group">
            <label>${game.i18n.localize("DX3rd.BerserkInputText")}</label>
            <select id="condition-type" style="width: 100%; text-align: center;">
              ${options}
            </select>
          </div>
        </div>
        <style>
        .condition-rank-dialog { padding: 5px; }
        .condition-rank-dialog .form-group { display: flex; flex-direction: column; gap: 8px; margin-top: 0px; margin-bottom: 5px; }
        .condition-rank-dialog label { font-weight: bold; font-size: 14px; }
        .condition-rank-dialog select { padding: 4px; font-size: 14px; border: 1px solid #ccc; border-radius: 4px; background: white; color: black; }
        </style>
      `;
      
      const DialogV2 = foundry.applications?.api?.DialogV2;
      if (!DialogV2?.wait) {
        ui.notifications.error(game.i18n.localize('DX3rd.DialogV2Unavailable'));
        return;
      }

      const berserkType = await DialogV2.wait({
        window: { title: game.i18n.localize("DX3rd.Berserk") },
        content: template,
        rejectClose: false,
        buttons: [
          {
            action: 'confirm',
            icon: '<i class="fas fa-check"></i>',
            label: game.i18n.localize("DX3rd.Confirm"),
            default: true,
            callback: (event, button) => {
              const root = button.form || button.element?.closest('.application') || button.element?.ownerDocument;
              return root?.querySelector("#condition-type")?.value || null;
            }
          },
          {
            action: 'cancel',
            icon: '<i class="fas fa-times"></i>',
            label: game.i18n.localize("DX3rd.Cancel"),
            callback: () => null
          }
        ]
      });
      
      if (berserkType) {
        specialConditions[ct] = berserkType;
        console.log(`DX3rd | Berserk type set:`, berserkType);
      } else {
        console.log(`DX3rd | Berserk cancelled`);
        return;
      }
    }
  }
  
  // 적용
  for (const targetData of (targets || [])) {
    const targetActor = game.actors.get(targetData.id);
    if (!targetActor) continue;
    for (const ct of conditionTypes) {
      try {
        const already = targetActor.effects.find(e => e.statuses.has(ct));
        // 사독이면 평가된 랭크 전달
        const rankToPass = (ct === 'poisoned' && poisonedRank) ? poisonedRank : null;
        // 특수 상태이상이면 입력받은 값 전달
        const specialTarget = specialConditions[ct] || null;
        console.log(`DX3rd | Applying condition ${ct} to ${targetActor.name}, rankToPass:`, rankToPass, 'specialTarget:', specialTarget);
        if (already) {
          // 이미 활성: 직접 갱신 루틴 호출(기본 핸들러 사용)
          let token = targetActor.token;
          if (!token && canvas.scene) {
            const tokenDoc = canvas.scene.tokens.find(t => t.actorId === targetActor.id);
            if (tokenDoc) token = tokenDoc.object || { actor: targetActor };
          }
          if (typeof window.handleConditionToggle === 'function') {
            await window.handleConditionToggle(token || { actor: targetActor }, ct, true, triggerItemName || null, rankToPass, specialTarget);
          } else if (typeof window.DX3rdHandleConditionToggle === 'function') {
            await window.DX3rdHandleConditionToggle(token || { actor: targetActor }, ct, true, triggerItemName || null, rankToPass, specialTarget);
          } else {
            // 폴백: 맵에 저장 후 토글
            const key = `${targetActor.id}:${ct}`;
            if (!window.DX3rdConditionTriggerMap) window.DX3rdConditionTriggerMap = new Map();
            window.DX3rdConditionTriggerMap.set(key, { trigger: (triggerItemName||null), poisonedRank: rankToPass, specialTarget: specialTarget });
            await targetActor.toggleStatusEffect(ct, { active: true });
          }
        } else {
          // 신규: 맵 저장 후 토글로 생성 → 훅에서 메시지
          const key = `${targetActor.id}:${ct}`;
          if (!window.DX3rdConditionTriggerMap) window.DX3rdConditionTriggerMap = new Map();
          console.log(`DX3rd | Storing in map - key: ${key}, trigger: ${triggerItemName}, poisonedRank: ${rankToPass}, specialTarget: ${specialTarget}`);
          window.DX3rdConditionTriggerMap.set(key, { trigger: (triggerItemName||null), poisonedRank: rankToPass, specialTarget: specialTarget });
          await targetActor.toggleStatusEffect(ct, { active: true });
        }
      } catch (e) { console.error('DX3rd | Failed to apply condition', ct, 'to', targetActor?.name, e); }
    }
    // 채팅은 condtions 훅에서 기본 메시지로 일원화 (여기서는 출력 안 함)
  }
};

// ========== 상태이상 소거(배드 스테이터스) 시스템 ========== //
// 배드 스테이터스 집합(시스템 status id): 폭주/증오/공포/경직/중압/방심/사독
window.DX3rdUniversalHandler.BAD_STATUSES = ['berserk', 'hatred', 'fear', 'rigor', 'pressure', 'dazed', 'poisoned'];

/**
 * 상태이상 소거 익스텐션 실행: 대상의 배드 스테이터스를 일괄 소거(exclude 제외).
 * 대상측 토큰 변경은 GM 권한 필요 → handleStatusClearRequest로 위임(소켓, conditionRequest와 동일 패턴).
 */
window.DX3rdUniversalHandler.executeStatusClearExtension = async function(actor, data, item = null) {
  if (!actor || !data) return;
  const { target = 'self', exclude = [], selectedTargetIds } = data;
  // 대상 수집(한 번)
  const targets = [];
  if (target === 'self' || target === 'targetAll') targets.push(actor);
  if (target === 'targetToken' || target === 'targetAll') {
    if (selectedTargetIds && selectedTargetIds.length > 0) {
      selectedTargetIds.forEach(id => { const tk = canvas.tokens.get(id); if (tk?.actor && !targets.find(a => a.id === tk.actor.id)) targets.push(tk.actor); });
    } else {
      Array.from(game.user.targets).forEach(t => { if (t.actor && !targets.find(a => a.id === t.actor.id)) targets.push(t.actor); });
    }
  }
  if (targets.length === 0) { ui.notifications.warn('상태이상 소거 대상이 없습니다.'); return; }
  const requestData = {
    userId: game.user.id,
    actorName: actor.name,
    targets: targets.map(t => ({ id: t.id, name: t.name })),
    exclude: Array.isArray(exclude) ? exclude : [],
    triggerItemName: item?.name || null
  };
  if (game.user.isGM) {
    await this.handleStatusClearRequest(requestData);
  } else {
    game.socket.emit('system.dx3rd-emanim', { type: 'statusClearRequest', requestData });
    ui.notifications.info('GM에게 상태이상 소거 요청을 보냈습니다.');
  }
};

/**
 * 상태이상 소거 요청 처리(GM 전용): 대상의 배드 스테이터스를 toggle off.
 * 토글 시 condtions.js deleteActiveEffect 훅이 "[X] 해제" 채팅을 일원화 출력하므로 여기선 채팅 안 함.
 */
window.DX3rdUniversalHandler.handleStatusClearRequest = async function(requestData) {
  if (!game.user.isGM) return;
  const { targets = [], exclude = [] } = requestData;
  const excludeSet = new Set(exclude || []);
  const bad = this.BAD_STATUSES.filter(s => !excludeSet.has(s));
  for (const td of targets) {
    const targetActor = game.actors.get(td.id);
    if (!targetActor) continue;
    const cleared = [];
    for (const st of bad) {
      const isActive = (targetActor.statuses && targetActor.statuses.has(st)) || targetActor.system?.conditions?.[st]?.active;
      if (!isActive) continue;
      try {
        await targetActor.toggleStatusEffect(st, { active: false });
        cleared.push(st);
      } catch (e) { console.error('DX3rd | statusClear toggle failed', st, targetActor.name, e); }
    }
    console.log(`DX3rd | statusClear: ${targetActor.name} cleared [${cleared.join(',')}]`);
  }
};

/**
 * 상태이상 요청 처리 (GM 전용)
 */
window.DX3rdUniversalHandler.handleConditionRequest = async function(requestData) {
  if (!game.user.isGM) return;
  
  // afterSuccess에서 온 경우: conditionData가 있음
  if (requestData.conditionData) {
    const actor = game.actors.get(requestData.actorId);
    const item = requestData.itemId ? actor?.items.get(requestData.itemId) : null;
    
    // executeConditionExtensionNow 직접 호출
    await this.executeConditionExtensionNow(actor, requestData.conditionData, item);
    return;
  }
  
  // instant에서 온 경우: 기존 로직
  const { userId, actorId, actorName, targets, conditionType, triggerItemName } = requestData;
  let { poisonedRank } = requestData;

  // 사독 랭크가 포뮬러 문자열인 경우 여기서 숫자로 평가해 다이얼로그 우회가 가능하도록 한다
  try {
    if (conditionType === 'poisoned' && poisonedRank !== undefined && poisonedRank !== null && `${poisonedRank}`.trim() !== '') {
      if (typeof window.DX3rdFormulaEvaluator?.evaluate === 'function' && typeof poisonedRank === 'string' && /\[/.test(poisonedRank)) {
        const actor = game.actors.get(actorId);
        // 아이템 컨텍스트가 있다면 사용 (요청 데이터에 itemId가 있을 수도 있음)
        const item = requestData.itemId ? actor?.items.get(requestData.itemId) : null;
        const itemLevel = item?.system?.level?.value ?? 1;
        const itemForFormula = item ? item : { type: 'effect', system: { level: { value: itemLevel } } };
        const evaluated = window.DX3rdFormulaEvaluator.evaluate(poisonedRank, itemForFormula, actor);
        const num = Number(evaluated);
        if (!Number.isNaN(num) && Number.isFinite(num) && num > 0) poisonedRank = num;
      }
    }
  } catch (e) {
    console.warn('DX3rd | Failed to evaluate poisonedRank formula:', e);
  }
  
  // 상태이상 이름 로컬라이징
  const conditionName = game.i18n.localize(`DX3rd.${conditionType.charAt(0).toUpperCase() + conditionType.slice(1)}`);
  
  // GM 확인 다이얼로그
  const targetNames = targets.map(t => t.name).join(', ');
  const confirmContent = `
    <div style="text-align: center;">
      <p><strong>${actorName}</strong>이(가) 상태이상을 부여하려 합니다.</p>
      <p>대상: ${targetNames}</p>
      <p>상태이상: ${conditionName}</p>
      <p>확인하시겠습니까?</p>
    </div>
  `;
  
  // 설정 확인: 자동 승인 여부
  const autoApplyConditionSingle = game.settings.get('dx3rd-emanim', 'DX3rd.AutoApplyExtensions');
  
  if (!autoApplyConditionSingle) {
    const confirmed = await window.DX3rdUniversalConfirmDialogV2({
      title: '상태이상 부여 확인',
      content: confirmContent,
      yesLabel: game.i18n.localize('DX3rd.Confirm'),
      noLabel: game.i18n.localize('DX3rd.Cancel'),
      defaultYes: true
    });
    
    if (!confirmed) {
      // 거부 시 요청자에게 알림
      if (userId !== game.user.id) {
        game.socket.emit('system.dx3rd-emanim', {
          type: 'conditionRejected',
          data: { userId: userId }
        });
      }
      return;
    }
  } else {
    console.log('DX3rd | Auto-applying condition extension (single, setting enabled)');
  }
  
  // 각 대상에게 상태이상 적용
  console.log(`DX3rd | Applying condition to ${targets.length} targets, conditionType: ${conditionType}`);
  
  for (const targetData of targets) {
    const targetActor = game.actors.get(targetData.id);
    if (!targetActor) {
      console.warn(`DX3rd | Target actor not found: ${targetData.id}`);
      continue;
    }
    
    console.log(`DX3rd | Applying ${conditionType} to ${targetActor.name}`);
    
    // toggleStatusEffect 사용하여 상태이상 적용
    try {
      const already = targetActor.effects.find(e => e.statuses.has(conditionType));
      if (already) {
        let token = targetActor.token;
        if (!token && canvas.scene) {
          const tokenDoc = canvas.scene.tokens.find(t => t.actorId === targetActor.id);
          if (tokenDoc) token = tokenDoc.object || { actor: targetActor };
        }
        if (typeof window.handleConditionToggle === 'function') {
          await window.handleConditionToggle(token || { actor: targetActor }, conditionType, true, triggerItemName || null, (conditionType==='poisoned' ? (poisonedRank||null) : null));
        } else if (typeof window.DX3rdHandleConditionToggle === 'function') {
          await window.DX3rdHandleConditionToggle(token || { actor: targetActor }, conditionType, true, triggerItemName || null, (conditionType==='poisoned' ? (poisonedRank||null) : null));
        } else {
          const key = `${targetActor.id}:${conditionType}`;
          if (!window.DX3rdConditionTriggerMap) window.DX3rdConditionTriggerMap = new Map();
          window.DX3rdConditionTriggerMap.set(key, { trigger: (triggerItemName||null), poisonedRank: (conditionType==='poisoned'? (poisonedRank||null): null) });
          await targetActor.toggleStatusEffect(conditionType, { active: true });
        }
      } else {
        const key = `${targetActor.id}:${conditionType}`;
        if (!window.DX3rdConditionTriggerMap) window.DX3rdConditionTriggerMap = new Map();
        window.DX3rdConditionTriggerMap.set(key, { trigger: (triggerItemName||null), poisonedRank: (conditionType==='poisoned'? (poisonedRank||null): null) });
        await targetActor.toggleStatusEffect(conditionType, { active: true });
      }
      console.log(`DX3rd | toggleStatusEffect completed for ${targetActor.name}`);
      const hasEffect = targetActor.effects.find(e => e.statuses.has(conditionType));
      console.log(`DX3rd | Condition effect exists: ${!!hasEffect}`);
    } catch (error) {
      console.error(`DX3rd | Failed to apply condition to ${targetActor.name}:`, error);
      continue;
    }
    // 채팅은 condtions 훅에서 기본 메시지로 일원화 (여기서는 출력 안 함)
  }
  
  console.log(`DX3rd | All conditions applied successfully`);
};
