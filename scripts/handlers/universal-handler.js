// Universal handler - shared routines for item use/activation
(function() {

  window.DX3rdUniversalHandler = {
    /**
     * Process item usage cost (encroachment/HP) and send unified chat message.
     * @param {Actor} actor
     * @param {Item} item
     * @returns {boolean} true if usage is allowed, false if blocked
     */
    async processItemUsageCost(actor, item, options = {}) {
      const { skipMessage = false } = options;
      const requestedAction = window.DX3rdItemEffectAdapter?.invocationAction(item, options)
        || options.action || null;
      const effectMatches = (kind, data, timing = data?.timing || 'instant') => !window.DX3rdItemEffectAdapter
        || window.DX3rdItemEffectAdapter.extensionActionMatches(item, kind, data, requestedAction, timing);
      try {
        // 컴펜디움 자동화 항목의 명시적 사용 제한. 플래그가 없는 기존 아이템에는 영향을 주지 않는다.
        const automationExtend = item.getFlag?.('dx3rd-emanim', 'itemExtend') || {};
        // 통합 컴펜디움 오버라이드는 기존 확장 데이터 안에 자동화 제약을 보관한다.
        // 과거에 직접 주입된 별도 플래그도 읽어 기존 월드 데이터와 호환한다.
        const automation = automationExtend.automation || item.getFlag?.('dx3rd-emanim', 'automation') || {};
        const maxEncroachmentExclusive = Number(automation.maxEncroachmentExclusive);
        if (Number.isFinite(maxEncroachmentExclusive) && maxEncroachmentExclusive > 0) {
          const encroachment = Number(actor.system?.attributes?.encroachment?.value) || 0;
          if (encroachment >= maxEncroachmentExclusive) {
            ui.notifications.warn(game.i18n.format('DX3rd.AutomationMaxEncroachment', { limit: maxEncroachmentExclusive }));
            return false;
          }
        }

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
                  const effectExtend = effect.getFlag?.('dx3rd-emanim', 'itemExtend') || {};
                  const effectAutomation = effectExtend.automation || effect.getFlag?.('dx3rd-emanim', 'automation') || {};
                  if (effectAutomation.noCombo) {
                    ui.notifications.warn(game.i18n.format('DX3rd.AutomationNoCombo', { name: effect.name }));
                    return false;
                  }
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
        const itemExtensionEntries = window.DX3rdItemEffectAdapter?.extensionEntries?.(itemExtend) || [];
        const hasResurrect = itemExtensionEntries.some(entry => entry.type === 'heal' && entry.data?.resurrect
          && effectMatches('heal', entry.data));
        if (hasResurrect) {
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
          if (hasResurrect) {
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
        
        // 0.5. 변동형 런타임 입력 (사용 시 수치 입력 → [소비HP]/[입력] 토큰 공급)
        //   itemExtend.damage.runtimePrompt가 켜져 있으면 사용자에게 수치를 물어보고
        //   actor._dx3rdRuntimeInput에 걸어둔다(FormulaEvaluator가 읽어 damage/weapon/protect 값에 반영).
        //   runtimeConsumeHP면 입력값만큼 HP를 소모한다(아래 hpCostList에 합류하여 부족검사·차감·채팅 재사용).
        //   콤보는 자신에게 설정이 없으면 포함 이펙트 중 첫 설정을 사용(단일 입력).
        actor._dx3rdRuntimeInput = 0;
        let runtimeConsumeAmount = 0;
        {
          let runtimeCfg = itemExtensionEntries
            .filter(entry => entry.type === 'damage')
            .map(entry => entry.data)
            .find(data => data?.runtimePrompt && effectMatches('damage', data)) || null;
          if (!runtimeCfg && item.type === 'combo') {
            for (const effectId of this.normalizeEffectIds(item)) {
              const eff = actor.items.get(effectId);
              const ex = eff?.getFlag?.('dx3rd-emanim', 'itemExtend') || {};
              runtimeCfg = (window.DX3rdItemEffectAdapter?.extensionEntries?.(ex) || [])
                .filter(entry => entry.type === 'damage')
                .map(entry => entry.data)
                .find(data => data?.runtimePrompt) || null;
              if (runtimeCfg) break;
            }
          }
          if (runtimeCfg) {
            const label = runtimeCfg.runtimeLabel
              || (runtimeCfg.runtimeConsumeHP
                ? game.i18n.localize('DX3rd.RuntimeConsumeHP')
                : game.i18n.localize('DX3rd.RuntimeInput'));
            const entered = await window.DX3rdUniversalNumberPromptV2({
              title: item.name,
              label,
              defaultValue: Number(runtimeCfg.runtimeDefault) || 0
            });
            if (entered === null || entered === undefined) {
              console.log('DX3rd | Item use canceled at runtime input prompt');
              return false; // 취소 → 사용 중단(코스트 미차감)
            }
            actor._dx3rdRuntimeInput = entered;
            if (runtimeCfg.runtimeConsumeHP) runtimeConsumeAmount = entered;
          }
        }

        let costMessages = [];

        // 1. HP 비용 처리 (아이템 + 익스텐드 통합)
        let totalHpCost = 0;
        let hpCostRolls = [];
        
        // 1-A. 아이템 자체의 HP 코스트
        const itemHpCostRaw = String(item.system?.hp?.value ?? '0').trim();
        
        // 1-B. 익스텐드 HP 코스트 (itemExtend는 위에서 이미 선언됨)
        // 1-C. HP 코스트 목록
        const hpCostList = [
          { raw: itemHpCostRaw, source: 'item' }
        ];
        for (const entry of itemExtensionEntries.filter(entry => entry.type === 'damage')) {
          const data = entry.data || {};
          if (data.hpCostActivate && data.hpCost && effectMatches('damage', data)) {
            hpCostList.push({raw: String(data.hpCost).trim(), source: `extend:${entry.id}`});
          }
        }

        // 1-C-2. 변동형 런타임 입력이 HP 소모형이면 입력값을 코스트에 합류
        if (runtimeConsumeAmount > 0) {
          hpCostList.push({ raw: String(runtimeConsumeAmount), source: 'runtime' });
        }

        // 1-D. 콤보인 경우, 포함된 이펙트들의 익스텐션 HP 비용도 수집
        if (item.type === 'combo') {
          const effectIds = this.normalizeEffectIds(item);

          for (const effectId of effectIds) {
            const effectItem = actor.items.get(effectId);
            if (!effectItem) continue;
            
            const effectExtend = effectItem.getFlag('dx3rd-emanim', 'itemExtend') || {};
            for (const entry of (window.DX3rdItemEffectAdapter?.extensionEntries?.(effectExtend) || []).filter(entry => entry.type === 'damage')) {
              const data = entry.data || {};
              const matches = !window.DX3rdItemEffectAdapter || window.DX3rdItemEffectAdapter.extensionActionMatches(effectItem, 'damage', data, 'attack', data.timing || 'instant');
              const raw = data.hpCostActivate && data.hpCost && matches ? String(data.hpCost).trim() : '0';
              if (raw !== '0' && raw !== '') hpCostList.push({raw, source: `effect:${effectItem.name}:${entry.id}`});
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
        // "침식률(없음)" 타입: 이 액터는 침식률이 오르지 않는다(_preUpdate 가드와 동일).
        // 주 경로에서는 굴림·가산·메시지를 건너뛰고 미상승만 표기한다.
        const noEncroach = actor.system?.attributes?.encroachment?.type === 'none';

        if (noEncroach && encAddRaw !== '0' && encAddRaw !== '') {
          costMessages.push(`${game.i18n.localize('DX3rd.Encroachment')} +0 (${game.i18n.localize('DX3rd.NoEncroachNote')})`);
        } else if (encAddRaw !== '0' && encAddRaw !== '') {
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
        // once 즉시해소형(disable='-')은 잔류 토글을 남기지 않는다(activateItem 주석 참조).
        const skipToggle = item?.type === 'once' && activeDisable === '-';
        if (activeDisable !== 'notCheck' && !skipToggle) {
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
    async executeMacros(item, timing = 'instant', action = null) {
      try {
        const macroField = item.system?.macro;
        const macroMatches = (macroField && typeof macroField === 'string') ? (macroField.match(/\[([^\]]+)\]/g) || []) : [];
        // 임베드 매크로: system.macros = [{ timing, kind, command, macroName, disabled? }, ...]
        //  - kind:'code'(기본): command 를 인라인 실행(컴펜디움 자체완결, 이름참조 불필요)
        //  - kind:'macro': macroName 으로 월드 매크로를 이름참조 실행(구 system.macro 필드 통합분)
        const embedded = Array.isArray(item.system?.macros) ? item.system.macros : [];
        const embeddedHits = embedded.filter(m => {
          if (!m || m.disabled) return false;
          const macroTiming = window.DX3rdItemEffectAdapter?.inferAction?.(item, 'macro', m) === 'activation'
            ? 'instant'
            : (m.timing || 'instant');
          if (macroTiming !== timing) return false;
          if (window.DX3rdItemEffectAdapter && !window.DX3rdItemEffectAdapter.macroActionMatches(item, m, action, timing)) return false;
          return (m.kind === 'macro') ? !!m.macroName : !!m.command;
        });
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
            if (em.kind === 'macro') {
              // 이름참조: 월드 매크로 실행. 타이밍은 이 임베드 행이 관장한다(월드 매크로의 runTiming 플래그는 무시).
              const wm = game.macros?.getName(em.macroName);
              if (wm) await wm.execute({ actor: ownerActor, token: ownerToken });
              else console.warn(`DX3rd | UniversalHandler embedded world-macro not found: ${em.macroName}`);
            } else {
              const AsyncFunction = foundry.utils?.AsyncFunction || Object.getPrototypeOf(async function () {}).constructor;
              const fn = new AsyncFunction('actor', 'item', 'token', 'scope', em.command);
              await fn.call(item, ownerActor, item, ownerToken, { timing });
            }
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
        const sourceActor = game.user?.character
          || canvas.tokens?.controlled?.find(token => token.actor?.isOwner)?.actor
          || null;
        for (const t of targets) {
          const actor = t.actor;
          if (!actor) continue;
          if (actor.isOwner) {
            removed += await this.removeBadStatuses(actor, { count, exclude });
          } else {
            if (!sourceActor) {
              ui.notifications?.warn(game.i18n.localize('DX3rd.NoCharacter') || '담당 캐릭터를 지정하세요.');
              continue;
            }
            window.DX3rdSocketRouter.emit({
              type: 'removeConditionRequest',
              data: {
                userId: game.user.id,
                sourceActorId: sourceActor.id,
                targetUuid: actor.uuid,
                count: serialCount,
                exclude
              },
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
          await window.DX3rdAppliedEffects.set(actor, key, {
            name: applied.name || 'D로이스', source: actor.name,
            disable: applied.disable || 'roll', img: applied.img || 'icons/svg/aura.svg',
            attributes: applied.attributes,
          });
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
            poisonedRank: bucket.poisonedRank || null,
            itemId: bucket.sourceItemId || null,
            duration: bucket.duration || null,
            sourceActorId: bucket.sourceActorId || actor.id
          });
        } else if (bucket.type === 'statusClear') {
          for (const source of bucket.sources || []) {
            const sourceItem = actor.items.get(source.itemId);
            await this.executeStatusClearExtension(actor, {
              ...(source.raw?.extensionData || {}),
              target: bucket.target,
              selectedTargetIds: bucket.selectedTargetIds || [],
              triggerItemName: actor.items.get(comboItemId)?.name || '콤보'
            }, sourceItem || null);
          }
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
          await this.addToAfterMainQueue(actor, healData, null, 'heal');
        } else if (bucket.type === 'damage') {
          const damageData = {
            formulaDice: bucket.merged?.dice || 0,
            formulaAdd: bucket.merged?.add || 0,
            target: bucket.target,
            selectedTargetIds: bucket.selectedTargetIds || [],
            ignoreReduce: bucket.ignoreReduce || false,
            triggerItemName: actor.items.get(comboItemId)?.name || '콤보'
          };
          await this.addToAfterMainQueue(actor, damageData, null, 'damage');
        } else if (bucket.type === 'condition') {
          const conditionData = {
            conditionTypes: bucket.merged?.conditions || [],
            target: bucket.target,
            selectedTargetIds: bucket.selectedTargetIds || [],
            triggerItemName: actor.items.get(comboItemId)?.name || '콤보',
            poisonedRank: bucket.poisonedRank || null,
            itemId: bucket.sourceItemId || null,
            duration: bucket.duration || null,
            sourceActorId: bucket.sourceActorId || actor.id
          };
          await this.addToAfterMainQueue(actor, conditionData, null, 'condition');
        } else if (bucket.type === 'statusClear') {
          for (const source of bucket.sources || []) {
            const sourceItem = actor.items.get(source.itemId);
            await this.addToAfterMainQueue(actor, {
              ...(source.raw?.extensionData || {}),
              target: bucket.target,
              selectedTargetIds: bucket.selectedTargetIds || [],
              triggerItemName: actor.items.get(comboItemId)?.name || '콤보'
            }, sourceItem || null, 'statusClear');
          }
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
      const damagedTokenIds = (damagedActors || []).map(damagedActor => {
        const token = canvas.tokens.placeables.find(t => t.actor?.id === damagedActor.id);
        return token?.id;
      }).filter(Boolean);
      
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
            poisonedRank: bucket.poisonedRank || null,
            itemId: bucket.sourceItemId || null,
            duration: bucket.duration || null,
            sourceActorId: bucket.sourceActorId || actor.id
          });
        } else if (bucket.type === 'statusClear') {
          for (const source of bucket.sources || []) {
            const sourceItem = actor.items.get(source.itemId);
            const originalTarget = bucket.target || source.raw?.extensionData?.target || 'self';
            await this.executeStatusClearExtension(actor, {
              ...(source.raw?.extensionData || {}),
              target: originalTarget === 'self' ? 'self' : (damagedTokenIds.length ? 'targetToken' : originalTarget),
              selectedTargetIds: damagedTokenIds.length ? damagedTokenIds : (bucket.selectedTargetIds || []),
              triggerItemName: actor.items.get(comboItemId)?.name || '콤보'
            }, sourceItem || null);
          }
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
          await this.addToAfterMainQueue(actor, healData, null, 'heal');
        } else if (bucket.type === 'damage') {
          const damageData = {
            formulaDice: bucket.merged?.dice || 0,
            formulaAdd: bucket.merged?.add || 0,
            target: bucket.target,
            selectedTargetIds: bucket.selectedTargetIds || [],
            ignoreReduce: bucket.ignoreReduce || false,
            triggerItemName: actor.items.get(comboItemId)?.name || '콤보'
          };
          await this.addToAfterMainQueue(actor, damageData, null, 'damage');
        } else if (bucket.type === 'condition') {
          const conditionData = {
            conditionTypes: bucket.merged?.conditions || [],
            target: bucket.target,
            selectedTargetIds: bucket.selectedTargetIds || [],
            triggerItemName: actor.items.get(comboItemId)?.name || '콤보',
            poisonedRank: bucket.poisonedRank || null,
            itemId: bucket.sourceItemId || null,
            duration: bucket.duration || null,
            sourceActorId: bucket.sourceActorId || actor.id
          };
          await this.addToAfterMainQueue(actor, conditionData, null, 'condition');
        } else if (bucket.type === 'statusClear') {
          for (const source of bucket.sources || []) {
            const sourceItem = actor.items.get(source.itemId);
            const originalTarget = bucket.target || source.raw?.extensionData?.target || 'self';
            await this.addToAfterMainQueue(actor, {
              ...(source.raw?.extensionData || {}),
              target: originalTarget === 'self' ? 'self' : (damagedTokenIds.length ? 'targetToken' : originalTarget),
              selectedTargetIds: damagedTokenIds.length ? damagedTokenIds : (bucket.selectedTargetIds || []),
              triggerItemName: actor.items.get(comboItemId)?.name || '콤보'
            }, sourceItem || null, 'statusClear');
          }
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
            const successAction = window.DX3rdItemEffectAdapter?.eventAction(item, 'afterSuccess')
              || (item.system?.attackRoll && item.system.attackRoll !== '-' ? 'attack' : 'use');
            const actionMatches = (kind, data) => !window.DX3rdItemEffectAdapter
              || window.DX3rdItemEffectAdapter.extensionActionMatches(item, kind, data, successAction, 'afterSuccess');
            // 0. 'afterSuccess' 매크로 실행
            await this.executeMacros(item, 'afterSuccess', successAction);
            
            // 1. active.runTiming이 'afterSuccess'인 경우 활성화 (disable이 'notCheck'가 아닌 경우에만)
            const activeDisable = item.system?.active?.disable ?? '-';
            if (actionMatches('selfModifiers', item.system?.active || {}) && item.system.active?.runTiming === 'afterSuccess' && !item.system.active?.state && activeDisable !== 'notCheck') {
              await item.update({ 'system.active.state': true });
            }
            
            // 2. 'afterSuccess' 타겟 효과 적용 (effect.runTiming === 'afterSuccess')
            await this.applyToTargets(actor, item, 'afterSuccess', null, successAction);
            
            // 3. afterSuccess 타이밍 heal/damage/condition 익스텐션을 GM을 통해 처리
            const itemExtend = item.getFlag('dx3rd-emanim', 'itemExtend') || {};
            const selectedTargetIds = Array.from(game.user.targets).map(t => t.id);
            
            // heal afterSuccess
            if (itemExtend.heal?.activate && itemExtend.heal?.timing === 'afterSuccess' && actionMatches('heal', itemExtend.heal)) {
              
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
                window.DX3rdSocketRouter.emit({
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
            if (itemExtend.damage?.activate && itemExtend.damage?.timing === 'afterSuccess' && actionMatches('damage', itemExtend.damage)) {
              
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
                    window.DX3rdSocketRouter.emit({
                      type: 'damageRequest',
                      requestData: {
                        actorId: actor.id,
                        damageData: damageDataWithTargets,
                        itemId: item.id
                      }
                    });
                  }
                } else {
                  window.DX3rdSocketRouter.emit({
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
            const afterSuccessConds = condEntries.filter(c => c.timing === 'afterSuccess' && actionMatches('condition', c));
            for (const c of afterSuccessConds) {
              const conditionDataWithTargets = {
                ...c,
                selectedTargetIds,
                triggerItemName: item.name,
                triggerItemId: item.id
              };
              
              await this.executeConditionExtensionNow(actor, conditionDataWithTargets, item);
            }

            // 상태이상 해제 afterSuccess
            if (itemExtend.statusClear?.activate && itemExtend.statusClear?.timing === 'afterSuccess' && actionMatches('statusClear', itemExtend.statusClear)) {
              await this.executeStatusClearExtension(actor, {
                ...itemExtend.statusClear,
                selectedTargetIds,
                triggerItemName: item.name,
                triggerItemId: item.id
              }, item);
            }

            const cardEntries = (window.DX3rdItemEffectAdapter?.extensionEntries?.(itemExtend) || [])
              .filter(entry => !entry.legacy && entry.data?.activate && entry.data?.timing === 'afterSuccess'
                && actionMatches(entry.type, entry.data));
            for (const entry of cardEntries) {
              await this.executeItemExtension(actor, entry.type, {
                ...entry.data, selectedTargetIds, triggerItemName: item.name, triggerItemId: item.id
              }, item);
            }
            
            // runTiming이 afterSuccess인 경우, afterMain 익스텐드를 큐에 등록
            if (item.system.active?.runTiming === 'afterSuccess') {
              await this.registerAfterMainExtensions(actor, item, itemExtend, successAction);
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
      // once 즉시해소형(disable='-')은 잔류 토글을 남기지 않는다 — used 카운터만 소비하고
      // active.state 는 켜지 않는다(지속 타이밍이 없어 영원히 안 꺼지고, 스텟 기여도 0).
      // once 지속형(disable=timed)은 그대로 켜서 disable 타이밍에 정상 해소한다.
      const skipToggle = item.type === 'once' && activeDisable === '-';
      if (item.system?.active?.runTiming === 'instant' && !item.system?.active?.state && activeDisable !== 'notCheck' && !skipToggle) {
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
      // 무기/비클은 비용·사용 채팅카드보다 먼저 판정 방식을 고른다.
      // 콤보를 고르면 개별 장비 사용으로 간주하지 않고, 즉석 콤보만 연다.
      if (itemType === 'weapon' || itemType === 'vehicle') {
        if (options.comboMode === 'combo') {
          const skillKey = item.system?.skill;
          if (!skillKey || skillKey === '-') {
            ui.notifications.warn(`${item.name} ${game.i18n.localize('DX3rd.Unable')}`);
            return false;
          }
          await this.openComboBuilder(actor, 'skill', skillKey, item);
          return true;
        }
        if (options.comboMode === 'normal') {
          // 시트 메뉴에서 이미 선택했다.
        } else {
        if (typeof window.DX3rdChooseItemMode !== 'function') {
          ui.notifications.error(game.i18n.localize('DX3rd.DialogV2Unavailable'));
          return false;
        }
        const mode = await window.DX3rdChooseItemMode(options.menuAnchor, item);
        if (mode === null) return false;
        if (mode === 'combo') {
          const skillKey = item.system?.skill;
          if (!skillKey || skillKey === '-') {
            ui.notifications.warn(`${item.name} ${game.i18n.localize('DX3rd.Unable')}`);
            return false;
          }
          await this.openComboBuilder(actor, 'skill', skillKey, item);
          return true;
        }
        if (mode === 'apply') {
          return this.applyChosenItemEffect(actor, item, options);
        }
        options = {...options, comboMode: 'normal', action: mode === 'use' ? 'use' : 'attack'};
        }
      }
      const action = window.DX3rdItemEffectAdapter?.invocationAction(item, options)
        || ((itemType === 'weapon' || itemType === 'vehicle') ? 'attack' : 'use');
      
      // 대상 필요 시: 타겟이 없으면 중단 (하이라이트 유지)
      const requiresTarget = getTarget !== undefined
        ? getTarget
        : (window.DX3rdItemEffectAdapter?.requiresTarget(item, action) ?? !!item.system?.getTarget);
      
      console.log('DX3rd | handleItemUse target check:', {
        itemName: item.name,
        getTargetParam: getTarget,
        itemGetTarget: item.system?.getTarget,
        action,
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

      // 사용 버튼 클릭 시 통합 처리
      await new Promise(resolve => setTimeout(resolve, 50)); // 50ms 딜레이
      
      // 0. SpellCalamity 5번 효과 체크 (마술 사용 불가)
      if (itemType === 'spell') {
        const appliedEffects = window.DX3rdAppliedEffects?.collect
          ? window.DX3rdAppliedEffects.collect(actor)
          : (actor.system?.attributes?.applied || {});
        for (const [appliedKey, appliedEffect] of Object.entries(appliedEffects)) {
          if (appliedEffect && appliedEffect.attributes) {
            let hasSpellDisabled = false;
            let count = 0;
            
            for (const [attrName, attrValue] of Object.entries(appliedEffect.attributes)) {
              // spell_disabled는 attrName 또는 객체 key로만 판별한다.
              //   (과거의 `attrValue === true`절은 move_half 등 임의 boolean-true 속성까지 오인해
              //    마술을 잘못 차단했으므로 제거)
              if (attrName === 'spell_disabled' ||
                  (typeof attrValue === 'object' && attrValue?.key === 'spell_disabled')) {
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
      // 변동형 런타임 입력 스냅샷(재진입 대비): 사용 종료 시 복원해 잔류값이 다음 이펙트에 새지 않게 한다.
      const _prevRuntimeInput = actor._dx3rdRuntimeInput;
      try {
      const usageAllowed = await this.processItemUsageCost(actor, item, {action});
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
      // once 즉시해소형(disable='-')은 잔류 토글을 남기지 않는다(activateItem 주석 참조).
      const activeDisable = item.system?.active?.disable ?? '-';
      const skipToggle = item.type === 'once' && activeDisable === '-';
      const selfActionMatches = !window.DX3rdItemEffectAdapter
        || window.DX3rdItemEffectAdapter.extensionActionMatches(item, 'selfModifiers', item.system?.active || {}, action, 'instant');
      if (selfActionMatches && item.system.active?.runTiming === 'instant' && !item.system.active?.state && activeDisable !== 'notCheck' && !skipToggle) {
        const toggled = await this.applySelfModifiers(actor, item);
        console.log(`DX3rd | handleItemUse - Self modifiers applied (${toggled ? 'toggle' : 'onUse frozen'}):`, item.name);
      }
      
      // 2.7. 자원소비 비례형(네이티브 필드) 처리 — HP 등을 n 소비하고 n×배수만큼 판정/스탯 버프
      await this.processResourceCost(actor, item);

      // 3. instant 타이밍 매크로/어플라이드/익스텐션 실행
      await this.executeMacros(item, 'instant', action);
      await this.applyToTargets(actor, item, 'instant', null, action);
      // 콤보는 익스텐션을 콤보 핸들러에서 이펙트와 병합 처리하므로 여기서는 건너뜀 (롤 타입 무관)
      if (item.type !== 'combo') {
        await this.processItemExtensions(actor, item, 'instant', action);
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
            await this.registerAfterMainExtensions(actor, item, itemExtend, action);
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
      // 공격 가능한 아이템의 별도 '사용' 액션은 연결된 효과만 발현한다. 여기서 타입
      // 핸들러까지 부르면 무기/공격 이펙트가 다시 공격 굴림으로 진입해 액션 분리가 무너진다.
      const effectOnlyUse = action === 'use' && window.DX3rdItemEffectAdapter?.isAttackItem(item);
      if (handler && !effectOnlyUse) {
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
      } else if (!effectOnlyUse) {
        console.warn(`DX3rd | handleItemUse - No handler registered for itemType: ${itemType}`);
      }

      // 성공적으로 완료
      return true;
      } finally {
        // 사용 종료: 사용-중 레벨 고정 해제(재진입 시 이전 값 복원)
        if (_prevFrozenEncLevel === undefined) delete actor._dx3rdUsageEncLevel;
        else actor._dx3rdUsageEncLevel = _prevFrozenEncLevel;
        // 런타임 입력값 복원(잔류 방지)
        if (_prevRuntimeInput === undefined) delete actor._dx3rdRuntimeInput;
        else actor._dx3rdRuntimeInput = _prevRuntimeInput;
      }
    }
  };

})();

// ========== AfterMain 큐 시스템 ========== //
/**
 * AfterMain 큐에 익스텐션 추가 (GM에게 소켓으로 전송)
 * @param {Actor} actor
 * @param {Object} extensionData - healData, damageData, conditionData 등
 * @param {Item} item
 * @param {string} type - 'heal', 'damage', 'condition'
 */
/**
 * afterMain 타이밍 익스텐드를 큐에 등록하는 헬퍼 함수
 * @param {Actor} actor - 사용자 액터
 * @param {Item} item - 아이템
 * @param {Object} itemExtend - 아이템 익스텐드 데이터
 */
/**
 * AfterMain 큐 처리 (이니셔티브 직전 실행)
 */
/**
 * AfterMain 큐 초기화 (전투 종료 시 등)
 */


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
    await window.DX3rdAppliedEffects.set(actor, key, {
      itemId: item.id,
      name: item.name,
      source: actor.name,
      disable: rc.disable || 'main',
      img: item.img || 'icons/svg/aura.svg',
      attributes: { [uid]: { key: rc.attrKey || 'add', label: rc.label || '-', value: value } }
    });

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
    window.DX3rdSocketRouter.emit({ type: 'encroachRequest', requestData });
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
