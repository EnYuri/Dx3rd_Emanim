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
      return window.DX3rdRuntimeUtils.groupExtensionsByKey(extensions);
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
          const diceFormulaTerms = [];
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
                if (window.DX3rdFormulaEvaluator.hasDice(diceStr)) {
                  // 각 원본 이펙트의 레벨/능력치 참조를 여기서 해석해 합산 후에도 보존한다.
                  diceFormulaTerms.push(window.DX3rdFormulaEvaluator.prepareRollFormula(diceStr, itemForFormula, actor));
                } else {
                  evaluatedDice = window.DX3rdFormulaEvaluator.evaluate(diceStr, itemForFormula, actor);
                }
              }
            }
            if (add || add === 0) {
              const addStr = String(add).trim();
              if (addStr && addStr !== '0') {
                // 확장 도구는 단일 수식 입력을 사용한다. 가산 필드에 저장된 NdM 식도
                // 원본 아이템 문맥에서 치환한 뒤 한 번만 굴릴 수 있도록 보존한다.
                if (window.DX3rdFormulaEvaluator.hasDice(addStr)) {
                  diceFormulaTerms.push(window.DX3rdFormulaEvaluator.prepareRollFormula(addStr, itemForFormula, actor));
                } else {
                  evaluatedAdd = window.DX3rdFormulaEvaluator.evaluate(addStr, itemForFormula, actor);
                }
              }
            }
            totalDice += Math.max(0, parseInt(evaluatedDice) || 0);
            totalAdd += parseInt(evaluatedAdd) || 0;
          }
          const mergedDice = diceFormulaTerms.length > 0
            ? [totalDice > 0 ? `${totalDice}d10` : '', ...diceFormulaTerms].filter(Boolean).join(' + ')
            : totalDice;
          results.push({
            type, timing, target, custom: false,
            parentRunTiming,
            merged: { dice: mergedDice, add: totalAdd },
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
            sourceItemId: bucket.sourceItemId || null,
            sourceActorId: bucket.sourceActorId || null,
            duration: bucket.duration || null,
            merged: { conditions: Array.from(conditionSet) },
            poisonedRank: maxPoisonedRank > 0 ? maxPoisonedRank : null,
            sources: bucket.sources
          });
        } else if (type === 'weapon' || type === 'protect' || type === 'vehicle' || type === 'statusClear') {
          // 아이템 생성/상태 해제 타입: 병합하지 않고 소스 그대로 반환 (각각 실행해야 함)
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
    async processItemExtensions(actor, item, timing = null, action = null) {
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


        // 기존 종류별 슬롯과 신규 무제한 카드 배열을 동일한 실행 목록으로 처리한다.
        const extensionEntries = window.DX3rdItemEffectAdapter?.extensionEntries?.(itemExtend)
          || Object.entries(itemExtend).map(([type, data]) => ({type, data}));
        for (const entry of extensionEntries) {
          const extensionType = entry.type;
          const extensionData = entry.data;
          console.log(`DX3rd | Extension ${extensionType}:`, {
            activate: extensionData?.activate,
            parentTiming: parentItemTiming,
            requestedTiming: timing,
            extensionTiming: extensionData?.timing
          });
          
          if (extensionType === 'condition' && extensionData) {
            if (window.DX3rdItemEffectAdapter && !window.DX3rdItemEffectAdapter.extensionActionMatches(item, 'condition', extensionData, action, timing)) continue;
            const extensionTiming = window.DX3rdItemEffectAdapter?.inferAction?.(item, 'condition', extensionData) === 'activation'
              ? 'instant'
              : (extensionData.timing || 'instant');
            if (extensionData.activate && extensionData.type && extensionTiming === timing) {
              console.log(`DX3rd | Executing condition extension - timing match: ${extensionTiming}, type: ${extensionData.type}`);
              await this.executeItemExtension(actor, 'condition', {...extensionData, timing: extensionTiming}, item);
            }
            continue;
          }
          
          if (extensionData && extensionData.activate) {
            if (window.DX3rdItemEffectAdapter && !window.DX3rdItemEffectAdapter.extensionActionMatches(item, extensionType, extensionData, action, timing)) continue;
            // heal, damage, statusClear, encroach 익스텐션은 자체 타이밍을 따름 (부모 타이밍 무관)
            if (extensionType === 'heal' || extensionType === 'damage' || extensionType === 'statusClear' || extensionType === 'encroach') {
              const extensionTiming = window.DX3rdItemEffectAdapter?.inferAction?.(item, extensionType, extensionData) === 'activation'
                ? 'instant'
                : (extensionData.timing || 'instant');
              
              // extensionTiming과 요청된 timing이 일치하는지 확인
              if (extensionTiming === timing) {
                console.log(`DX3rd | Executing ${extensionType} extension - timing match: ${extensionTiming}`);
                await this.executeItemExtension(actor, extensionType, {...extensionData, timing: extensionTiming}, item);
              } else {
                console.log(`DX3rd | Skipping ${extensionType} extension - timing mismatch: extensionTiming=${extensionTiming}, requestedTiming=${timing}`);
              }
            } else {
              // 일반 익스텐션 (weapon, protect, vehicle 등) - 부모 타이밍을 따름
              const effectiveParentTiming = window.DX3rdItemEffectAdapter?.inferAction?.(item, extensionType, extensionData) === 'activation'
                ? 'instant'
                : parentItemTiming;
              if (effectiveParentTiming === timing) {
                await this.executeItemExtension(actor, extensionType, {...extensionData, timing: effectiveParentTiming}, item);
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
     * Apply item effects to targeted actors if conditions are met.
     * Conditions: system.getTarget is true AND system.effect.disable !== 'notCheck'
     * @param {Actor} actor - The actor using the item
     * @param {Item} item - The item being used
     * @param {string} timing - 실행 타이밍 ('instant', 'afterSuccess', 'afterDamage')
     * @param {Array} forcedTargets - 강제 타겟 배열 (선택적, Actor 객체 배열)
     */
    async applyToTargets(actor, item, timing = 'instant', forcedTargets = null, action = null) {
      try {
        if (window.DX3rdItemEffectAdapter && !window.DX3rdItemEffectAdapter.targetActionMatches(item, action, timing)) return;
        
        // getTarget 또는 scene 중 하나라도 체크되어 있는지 확인
        const getTarget = item.system?.getTarget || false;
        const scene = item.system?.scene || false;
        if (!getTarget && !scene) return;

        // effect.runTiming 확인 (기본값은 '-')
        const effectRunTiming = window.DX3rdItemEffectAdapter?.inferAction?.(item, 'targetModifiers', item.system?.effect || {}) === 'activation'
          ? 'instant'
          : (item.system?.effect?.runTiming ?? '-');
        
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
              window.DX3rdSocketRouter.emit({
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
              
              window.DX3rdSocketRouter.emit({
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
     * @param {Object} [opts] - 선택 옵션. opts.disable 지정 시 applied 수명을 override
     *   (사용 시 self 동결버프(applyMode='onUse')는 effect.disable이 아니라 active.disable이 수명이므로).
     */
    async _applyItemAttributes(actor, item, targetActor, targetAttributes, opts = {}) {
      if (!targetActor) {
        ui.notifications.error('대상을 찾을 수 없습니다.');
        return;
      }

      let appliedKey = `applied_${item.id}`;

      // 기존 AE 확인 (같은 아이템이면 키 유지하고 내용만 교체)
      const existingEff = targetActor.effects.find(e => e.getFlag?.('dx3rd-emanim', 'applied')?.itemId === item.id);
      if (existingEff) {
        appliedKey = existingEff.getFlag('dx3rd-emanim', 'appliedKey') || appliedKey;
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
        disable: opts.disable ?? item.system.effect?.disable ?? '-',
        description: itemDescription,
        attributes: {}
      };

      // 효과 적용
      for (const [attrKey, attrData] of Object.entries(targetAttributes)) {
        if (!attrData || !attrData.value) continue;

        // key 는 필수. label 은 원본 label 을 보존한다:
        //   - stat_* 류는 표시용 이름(능력치/스킬)이 label 에 온다.
        //   - attack/damage_roll 은 서브버킷(fist/melee/ranged)이 label 에 온다 → 소비부(actor.js bucket)가
        //     label 로 서브버킷하므로, 여기서 label 을 key 로 덮어쓰면 맨손/백병 한정이 유실된다(축퇴기관 등).
        //   - 그 외 키(add/guard/dice/critical/major_* 등)는 소비부가 label 을 무시하므로 label=null 이어도 무해.
        const key = attrData.key;
        if (!key || key === '-') continue;
        const rawLabel = (attrData.label && attrData.label !== '-') ? attrData.label : null;

        // 피해·방어·판정 시점 굴림 필드는 대상 효과(AE)로 옮겨도 원 수식을 보존한다.
        // prepareData에서 수치 0으로 동결하면 안 되며, 각 소비부가 실제 행동 시 Roll로 한 번 굴린다.
        const actionRollKeys = new Set([
          'attack', 'damage_roll', 'guard_roll', 'reduce_roll', 'dxroll',
          'dice', 'add', 'critical',
          'major_dice', 'major_add', 'major_critical',
          'reaction_dice', 'reaction_add', 'reaction_critical',
          'dodge_dice', 'dodge_add', 'dodge_critical',
          'stat_bonus', 'stat_dice', 'stat_add', 'cast_dice', 'cast_add'
        ]);
        const prepared = window.DX3rdFormulaEvaluator.prepareRollFormula(attrData.value, item, item.actor);
        const evaluated = actionRollKeys.has(key) && window.DX3rdFormulaEvaluator.hasDice(prepared)
          ? prepared
          : window.DX3rdFormulaEvaluator.evaluate(attrData.value, item, item.actor);
        // 동일 key 의 서로 다른 label(fist/melee/ranged, 스킬별 stat_*)이 덮어쓰지 않도록 저장 키를 key:label 조합으로 사용
        const storageKey = rawLabel ? `${key}:${rawLabel}` : key;
        appliedEffect.attributes[storageKey] = {
          key,
          label: rawLabel,
          value: evaluated
        };
      }

      // 효과 추가 (네이티브 ActiveEffect 로 저장)
      try {
        await window.DX3rdAppliedEffects.set(targetActor, appliedKey, foundry.utils.deepClone(appliedEffect));
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
    },

    /**
     * 사용 시 self 동결버프(applyMode='onUse') — 사용 시점에 item.system.attributes를 자신에게
     * 1회 동결 적용한다. 토글(active.state) 채널과 달리 재계산되지 않으므로 런타임 입력값
     * ([소비HP] 등, actor._dx3rdRuntimeInput)이 _applyItemAttributes의 동결 평가로 그대로 잡힌다.
     * 수명은 active.disable(major/main/round/scene 등) — disable-hooks가 수명별 제거.
     * active.state는 켜지 않으므로 dx3rd-applied-toggle resync 대상이 아니다.
     * @param {Actor} actor - 사용 액터(=대상)
     * @param {Item} item - 사용 아이템
     */
    async applySelfFrozenBuff(actor, item) {
      const attrs = item.system?.attributes;
      if (!attrs || Object.keys(attrs).length === 0) return;
      await this._applyItemAttributes(actor, item, actor, attrs, { disable: item.system?.active?.disable });
    },

    /**
     * 사용 시점(instant)의 자기 보정 발동 채널을 applyMode로 갈라준다.
     *   - toggle: active.state=true. DX3rdAppliedToggle이 액터/아이템 갱신마다 attributes를 재평가하므로
     *     [level] 같은 추종 수식이 따라간다. 수명은 disable-hooks가 active.disable로 관리.
     *   - onUse : 사용 시점 값을 동결한 applied AE를 1회 적용. 토글 채널은 재평가 때
     *     actor._dx3rdRuntimeInput이 이미 사라져 [소비HP] 등이 0으로 주저앉으므로,
     *     런타임 입력을 쓰는 버프는 이 채널이어야 한다.
     *
     * afterSuccess/afterDamage 발동 지점(handleSuccessButton·processCombo* ·main.js 채팅 버튼)은
     * 이 함수를 쓰지 않고 active.state 토글로 남겨둔다. 이유:
     *   (1) 그 시점엔 handleItemUse가 이미 끝나 _dx3rdRuntimeInput이 지워졌으므로(finally 절)
     *       동결로 바꿔도 [소비HP]는 똑같이 0이다 — 얻는 게 없다.
     *   (2) spell/psionic/combo는 template.json에 applyMode 필드가 아예 없어 'onUse'로 떨어지는데,
     *       이들을 동결 채널로 보내면 active.state로 "지속 적용 중"을 판단하는 곳
     *       (combo-data getPersistentEffectIds/calculateItemAttackBonus, 시트 활성 표시)이 어긋난다.
     * runTiming/active.state/disable 게이트는 호출부가 미리 판정한다.
     * @param {Actor} actor - 사용 액터(=대상)
     * @param {Item} item
     * @returns {boolean} active.state를 켰으면 true
     */
    async applySelfModifiers(actor, item) {
      const applyMode = item.system?.active?.applyMode || 'onUse';
      if (applyMode === 'onUse') {
        await this.applySelfFrozenBuff(actor, item);
        return false;
      }
      await item.update({ 'system.active.state': true });
      return true;
    },

    /**
     * 시트의 "효과 적용" 전용 경로.
     * 대상 탭(system.effect.attributes)과 자기 효과 탭(system.attributes)은 서로 다른
     * 의미이므로, 자신을 타겟으로 잡았고 둘 다 있을 때만 어느 쪽을 적용할지 묻는다.
     */
    async applyChosenItemEffect(actor, item, options = {}) {
      const targets = Array.from(game.user.targets || []);
      if (!targets.length) {
        ui.notifications.warn(game.i18n.localize('DX3rd.SelectTarget'));
        return false;
      }

      const hasUsableAttribute = attributes => Object.values(attributes || {}).some(attribute =>
        attribute?.key && attribute.key !== '-' && String(attribute.value ?? '').trim() !== ''
      );
      const targetAttributes = item.system?.effect?.attributes || {};
      const selfAttributes = item.system?.attributes || {};
      const hasTargetEffect = hasUsableAttribute(targetAttributes);
      const hasSelfEffect = hasUsableAttribute(selfAttributes);
      const includesSelf = targets.some(target => target.actor?.id === actor.id);

      if (!hasTargetEffect && !hasSelfEffect) {
        ui.notifications.warn(game.i18n.localize('DX3rd.NoApplicableEffect'));
        return false;
      }

      let source = null;
      if (includesSelf && hasTargetEffect && hasSelfEffect) {
        if (typeof window.DX3rdChooseEffectApplySource !== 'function') {
          ui.notifications.error(game.i18n.localize('DX3rd.DialogV2Unavailable'));
          return false;
        }
        source = await window.DX3rdChooseEffectApplySource(options.menuAnchor);
        if (source === null) return false;
      } else if (hasTargetEffect) {
        source = 'target';
      } else if (includesSelf && hasSelfEffect) {
        source = 'self';
      } else {
        // 자기 효과는 타겟으로 지정한 시전자에게만 적용한다. 다른 액터에게 전파하지 않는다.
        ui.notifications.warn(game.i18n.localize('DX3rd.NoApplicableEffect'));
        return false;
      }

      if (source === 'self') {
        await this._applyItemAttributes(actor, item, actor, selfAttributes, {
          disable: item.system?.active?.disable ?? '-'
        });
        return true;
      }

      await this.applyEffectData(actor, {
        id: item.id,
        name: item.name,
        img: item.img,
        system: {description: item.system?.description ?? ''},
        effect: {disable: item.system?.effect?.disable || '-', attributes: targetAttributes}
      });
      return true;
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

      let appliedKey = `applied_${itemData.id || itemData.name}_${Date.now()}`;

      // 기존 AE 확인 (같은 아이템 ID면 키 유지하고 덮어쓰기)
      if (itemData.id) {
        const existingEff = targetActor.effects.find(e => e.getFlag?.('dx3rd-emanim', 'applied')?.itemId === itemData.id);
        if (existingEff) {
          appliedKey = existingEff.getFlag('dx3rd-emanim', 'appliedKey') || appliedKey;
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

        // 채팅 카드 등의 직렬화 경로도 발동형 롤 수식은 숫자로 동결하지 않는다.
        const actionRollKeys = new Set([
          'attack', 'damage_roll', 'guard_roll', 'reduce_roll', 'dxroll',
          'dice', 'add', 'critical',
          'major_dice', 'major_add', 'major_critical',
          'reaction_dice', 'reaction_add', 'reaction_critical',
          'dodge_dice', 'dodge_add', 'dodge_critical',
          'stat_bonus', 'stat_dice', 'stat_add', 'cast_dice', 'cast_add'
        ]);
        const prepared = window.DX3rdFormulaEvaluator?.prepareRollFormula
          ? window.DX3rdFormulaEvaluator.prepareRollFormula(attrData.value, null, actor)
          : String(attrData.value ?? '0');
        const evaluated = actionRollKeys.has(attrData.key) && window.DX3rdFormulaEvaluator?.hasDice?.(prepared)
          ? prepared
          : (window.DX3rdFormulaEvaluator?.evaluate
            ? window.DX3rdFormulaEvaluator.evaluate(attrData.value, null, actor)
            : Number(attrData.value) || 0);
        
        const storageKey = needsLabel ? `${attrData.key}:${attributeName}` : attrData.key;
        appliedEffect.attributes[storageKey] = {
          key: attrData.key,
          label: attributeName,
          value: evaluated
        };
      }

      // 효과 추가 (네이티브 ActiveEffect 로 저장)
      try {
        await window.DX3rdAppliedEffects.set(targetActor, appliedKey, foundry.utils.deepClone(appliedEffect));
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
     * 공격 롤 실행 (무기/비클/이펙트/콤보/사이오닉 등)
     * @param {Actor} actor - 공격하는 액터
     * @param {Item} item - 공격 아이템
     * @param {string} skillName - 스킬 이름
     * @param {Token} previousToken - 이전에 선택된 토큰
     * @param {number} dice - 주사위 개수
     * @param {number} critical - 크리티컬 값
     * @param {number} add - 가산치
     */
    async executeAttackRoll(actor, item, skillName, previousToken, dice, critical, add, weaponBonus = null, statRollFormula = null) {
      try {
        // 대상 확인 (다시 가져오기)
        const targets = Array.from(game.user.targets);
        
        // 참조값은 명중 판정 시점으로 고정하되, 다이스식은 데미지 굴림 확정까지 보류한다.
        // 이렇게 하면 공격 카드가 아직 공개하지 않은 데미지 결과를 품지 않는다.
        const itemAttackFormula = window.DX3rdFormulaEvaluator.prepareRollFormula(item.system.attack, item, actor);
        
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
        const attackFormulas = actor.system.attributes.attack?.rollFormula || {};
        let actorAttackFormula = attackFormulas._ || '';
        if (attackType === 'melee' && actor.system.attributes.attack?.melee) {
          attackBonus += actor.system.attributes.attack.melee;
          actorAttackFormula = [actorAttackFormula, attackFormulas.melee].filter(Boolean).join(' + ');
        } else if (attackType === 'ranged' && actor.system.attributes.attack?.ranged) {
          attackBonus += actor.system.attributes.attack.ranged;
          actorAttackFormula = [actorAttackFormula, attackFormulas.ranged].filter(Boolean).join(' + ');
        }
        // 맨손 한정 공격력(축퇴기관 등): 무기가 맨손일 때만 가산
        attackBonus += this.getFistAttackBonus(actor, item);

        // 공격 타입에 맞는 damage_roll 보너스 계산
        let damageRollBonus = actor.system.attributes.damage_roll?.value || 0;
        const damageRollFormulas = actor.system.attributes.damage_roll?.rollFormula || {};
        let damageRollFormula = damageRollFormulas._ || '';
        if (attackType === 'melee' && actor.system.attributes.damage_roll?.melee) {
          damageRollBonus += actor.system.attributes.damage_roll.melee;
          damageRollFormula = [damageRollFormula, damageRollFormulas.melee].filter(Boolean).join(' + ');
        } else if (attackType === 'ranged' && actor.system.attributes.damage_roll?.ranged) {
          damageRollBonus += actor.system.attributes.damage_roll.ranged;
          damageRollFormula = [damageRollFormula, damageRollFormulas.ranged].filter(Boolean).join(' + ');
        }
        
        const preservedValues = {
          actorAttack: attackBonus,
          actorAttackFormula: actorAttackFormula,
          actorDamageRoll: damageRollBonus,
          actorDamageRollFormula: damageRollFormula,
          actorPenetrate: actor.system.attributes.penetrate?.value || 0
        };
        
        // 아이템 타입별 공격력 키 설정
        if (item.type === 'weapon') {
          preservedValues.weaponAttackFormula = itemAttackFormula;
        } else if (item.type === 'vehicle') {
          preservedValues.weaponAttackFormula = itemAttackFormula;
        } else {
          preservedValues.weaponAttackFormula = itemAttackFormula;
        }
        
      
        // 공포 패널티는 이미 다이얼로그에서 반영되었으므로 여기서는 적용하지 않음
        // 룰(rule-section:39-41): 수정 결과 판정치가 0 이하면 판정은 자동실패(달성치 0).
        // 실제 애니메이션을 위해 최소 1다이스는 굴리되, 결과는 아래에서 0으로 확정한다.
        // 행동 시점 판정 수식: prepareData에서 원문만 보존하고, 여기서 정확히 한 번 굴린다.
        const actionProfile = actor.system.attributes.actionRollFormula || {};
        const typedProfile = actionProfile[rollType] || {};
        const rollActionFormula = async (kind) => {
          const formula = [actionProfile[kind], typedProfile[kind], statRollFormula?.[kind]].filter(Boolean).join(' + ');
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
        const [formulaDice, formulaAdd, formulaCritical] = await Promise.all([
          rollActionFormula('dice'), rollActionFormula('add'), rollActionFormula('critical')
        ]);
        const rolledDice = dice + formulaDice.total;
        const rolledCritical = critical + formulaCritical.total;
        const rolledAdd = add + formulaAdd.total;
        // 채팅 카드에는 최종 DX3rd 판정식만 표시한다. 보조 수식의 전개값은
        // 판정 풀에 이미 반영되므로 별도 줄로 중복 표기하지 않는다.
        const autoFailByPool = rolledDice <= 0;
        const finalDice = Math.max(1, rolledDice);

        // 달성치 D10 굴림(달성치에 +[N]D10 모델): 판정 시 Nd10 굴려 달성치(add)에 가산하고 채팅 공개.
        let add2 = rolledAdd;
        const dxRollN = Number(actor.system.attributes.dxroll?.value || 0);
        const dxRollFormula = actor.system.attributes.dxroll?.formula || (dxRollN > 0 ? `${dxRollN}d10` : '');
        if (dxRollFormula) {
          try {
            const dr = await (new Roll(dxRollFormula)).evaluate();
            add2 += Number(dr.total) || 0;
            await dr.toMessage({
              speaker: ChatMessage.getSpeaker({ actor }),
              flavor: `${game.i18n.localize('DX3rd.DxRoll')} (${dxRollFormula}) → +${dr.total}`
            });
          } catch (e) { console.warn('DX3rd | dxroll failed', e); }
        }
        // 무기 명중 수정치의 다이스는 판정 버튼을 누른 지금 한 번만 같은 Roll에 포함한다.
        // 결과는 사전 다이얼로그가 아니라 명중 롤 카드의 Foundry 항별 결과로 공개된다.
        const weaponAddFormula = weaponBonus?.addFormula;
        const rollFormula = weaponAddFormula
          ? `${finalDice}dx${Math.max(2, rolledCritical)} + ${add2} + ${weaponAddFormula}`
          : `${finalDice}dx${Math.max(2, rolledCritical)} + ${add2}`;
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

      // 무기/비클 아이템만 무기 슬롯·공격 콤보 시드로 사용(연출용으로 넘어온 비무기 아이템은 무시)
      const seedWeapon = (weaponItem && (weaponItem.type === 'weapon' || weaponItem.type === 'vehicle'))
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

      // 공격판정: 이펙트 attackRoll(melee/ranged) > 무기 type
      const effAR = seedEffects.find(e => e.system?.attackRoll === 'melee' || e.system?.attackRoll === 'ranged');
      if (effAR) attackRoll = effAR.system.attackRoll;
      else if (seedWeaponType === 'melee' || seedWeaponType === 'ranged') attackRoll = seedWeaponType;

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
        name: `${game.i18n.localize('DX3rd.TemporaryItem')} ${game.i18n.localize('DX3rd.Combo')}`,
        type: 'combo',
        flags: {'dx3rd-emanim': {instantCombo: true}},
        system: {
          skill,
          base,
          // 기능 또는 공격판정이 있으면 명중/판정을 위해 메이저로 시작.
          roll: (skill !== '-' || attackRoll !== '-') ? 'major' : '-',
          attackRoll,
          effectIds,
          weapon: weaponSetting,
          weaponSelect,
          getTarget: true,
          range: rangeValue,
          target: targetValue,
          encroach: { value: encroachValue },
          attack: { value: attackValue },
          level: { value: 1 }
        }
      };

      try {
        const [created] = await actor.createEmbeddedDocuments('Item', [comboItemData]);
        // 마도서 등 호출 아이템이 제공한 일회성 판정 문맥은 임시 콤보가 살아 있는 동안 보존한다.
        if (created && (options.originalItem || options.predefinedDifficulty || options.isBookDecipher)) {
          created.meta = {
            originalItem: options.originalItem || null,
            predefinedDifficulty: options.predefinedDifficulty || null,
            isBookDecipher: !!options.isBookDecipher
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
      const attackSourceLabel = weaponBonus?.sourceLabel || game.i18n.localize('DX3rd.Weapon');
      
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
            ${attackSourceLabel}: ${weaponBonus.weaponName} (${game.i18n.localize('DX3rd.Attack')} ${attackSign}${weaponBonus.attack}, ${game.i18n.localize('DX3rd.Add')} ${addSign}${weaponBonus.add})
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
              await this.executeAttackRoll(actor, item, label, previousToken, finalDice, finalCrit, finalAdd, weaponBonus, effectiveStat.rollFormula);
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
                  await this.executeAttackRoll(actor, originalWeaponItem, label, weaponToken, finalDice, finalCrit, finalAdd, weaponBonus, effectiveStat.rollFormula);
                  return;
                }
              }
              
              // 공격 판정이지만 executeAttackRoll로 가지 않는 경우 (콤보/이펙트 등)
              // 난이도 없이 executeStatRoll 호출
              const difficultyData = { type: 'none', value: 0 };
              await this.executeStatRoll(actor, finalDice, finalCrit, finalAdd, label, t, difficultyData, item, previousToken, weaponBonus, comboAfterSuccessData, comboAfterDamageData, false, null, false, effectiveStat.rollFormula);
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
              
              await this.executeStatRoll(actor, finalDice, finalCrit, finalAdd, label, t, difficultyData, item, previousToken, weaponBonus, comboAfterSuccessData, comboAfterDamageData, isUrgeTest, afterRollCallback, isPanicTest, effectiveStat.rollFormula);
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
    async executeStatRoll(actor, dice, critical, add, label, rollType, difficultyData = { type: 'none', value: 0 }, item = null, previousToken = null, weaponBonus = null, comboAfterSuccessData = null, comboAfterDamageData = null, isUrgeTest = false, afterRollCallback = null, isPanicTest = false, statRollFormula = null) {
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
        // 아이템이 있는 경우: 기능(타이밍) 표시 (아이템 사용 메시지는 이미 출력됨).
        // 공격 이펙트(attackRoll 설정)는 어떤 이펙트로 공격했는지 이름도 함께 표시한다.
        const isAtkRoll = item.system?.attackRoll && item.system.attackRoll !== '-';
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
        const isAttackRoll = item && item.system?.attackRoll && 
                             item.system.attackRoll !== '-' && 
                             (item.system.attackRoll === 'melee' || item.system.attackRoll === 'ranged');
        
        if (isAttackRoll) {
          // 공격 타입 확인
          const attackRollType = item.system.attackRoll;
          
          // 공격 타입에 맞는 attack 보너스 계산
          let attackBonus = actor.system.attributes.attack?.value || 0;
          const attackFormulas = actor.system.attributes.attack?.rollFormula || {};
          let actorAttackFormula = attackFormulas._ || '';
          if (attackRollType === 'melee' && actor.system.attributes.attack?.melee) {
            attackBonus += actor.system.attributes.attack.melee;
            actorAttackFormula = [actorAttackFormula, attackFormulas.melee].filter(Boolean).join(' + ');
          } else if (attackRollType === 'ranged' && actor.system.attributes.attack?.ranged) {
            attackBonus += actor.system.attributes.attack.ranged;
            actorAttackFormula = [actorAttackFormula, attackFormulas.ranged].filter(Boolean).join(' + ');
          }
          // 맨손 한정 공격력(축퇴기관 등): weapon-for-attack로 맨손을 선택한 경우만 가산
          const fistNameForAtk = game.i18n.localize('DX3rd.Fist');
          const wName = weaponBonus?.weaponName || '';
          if (wName === fistNameForAtk || wName.includes(`[${fistNameForAtk}]`)) {
            attackBonus += Number(actor.system.attributes.attack?.fist) || 0;
          }

          // 공격 타입에 맞는 damage_roll 보너스 계산
          let damageRollBonus = actor.system.attributes.damage_roll?.value || 0;
          const damageRollFormulas = actor.system.attributes.damage_roll?.rollFormula || {};
          let damageRollFormula = damageRollFormulas._ || '';
          if (attackRollType === 'melee' && actor.system.attributes.damage_roll?.melee) {
            damageRollBonus += actor.system.attributes.damage_roll.melee;
            damageRollFormula = [damageRollFormula, damageRollFormulas.melee].filter(Boolean).join(' + ');
          } else if (attackRollType === 'ranged' && actor.system.attributes.damage_roll?.ranged) {
            damageRollBonus += actor.system.attributes.damage_roll.ranged;
            damageRollFormula = [damageRollFormula, damageRollFormulas.ranged].filter(Boolean).join(' + ');
          }
          
          preservedValues = {
            actorAttack: attackBonus,
            actorAttackFormula: actorAttackFormula,
            actorDamageRoll: damageRollBonus,
            actorDamageRollFormula: damageRollFormula,
            actorPenetrate: actor.system.attributes.penetrate?.value || 0,
            // 무기 공격력 다이스식은 데미지 확정 시점까지 보존한다.
            weaponAttackFormula: effectiveWeaponBonus.attackFormula || String(effectiveWeaponBonus.attack || 0)
          };
        }
        
        // 수치 파생 단계에서는 보류한 다이스식을 실제 판정 버튼을 누른 지금 한 번만 굴린다.
        // [육체]/[백병]/[레벨] 참조는 prepareData 단계에서 이미 현재 액터 값으로 치환되어 있다.
        const actionProfile = actor.system.attributes.actionRollFormula || {};
        const typedProfile = actionProfile[rollType] || {};
        const rollActionFormula = async (kind) => {
          const formula = [actionProfile[kind], typedProfile[kind], statRollFormula?.[kind]].filter(Boolean).join(' + ');
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
        const [formulaDice, formulaAdd, formulaCritical] = await Promise.all([
          rollActionFormula('dice'), rollActionFormula('add'), rollActionFormula('critical')
        ]);
        dice += formulaDice.total;
        add += formulaAdd.total;
        critical = Math.max(2, critical + formulaCritical.total);
        // 채팅 카드에는 최종 DX3rd 판정식만 표시한다. 보조 수식의 전개값은
        // 판정 풀에 이미 반영되므로 별도 줄로 중복 표기하지 않는다.

        // 주사위 굴림 (침식률 증가는 이미 EffectHandler에서 처리됨)
        // 룰(rule-section:39-41): 수정 결과 판정치가 0 이하면 판정은 자동실패(달성치 0).
        // 실제 애니메이션을 위해 최소 1다이스는 굴리되, 결과는 아래에서 0으로 확정한다.
        const autoFailByPool = dice <= 0;
        const finalDice = Math.max(1, dice);
        // 달성치 D10 굴림(달성치에 +[N]D10 모델): 판정 시 Nd10 굴려 달성치(add)에 가산하고 채팅 공개.
        let add2 = add;
        const dxRollN = Number(actor.system.attributes.dxroll?.value || 0);
        const dxRollFormula = actor.system.attributes.dxroll?.formula || (dxRollN > 0 ? `${dxRollN}d10` : '');
        if (dxRollFormula) {
          try {
            const dr = await (new Roll(dxRollFormula)).evaluate();
            add2 += Number(dr.total) || 0;
            await dr.toMessage({
              speaker: ChatMessage.getSpeaker({ actor }),
              flavor: `${game.i18n.localize('DX3rd.DxRoll')} (${dxRollFormula}) → +${dr.total}`
            });
          } catch (e) { console.warn('DX3rd | dxroll failed', e); }
        }
        // 콤보/이펙트 공격도 무기에서 넘겨 받은 다이스 명중 수정치를 동일한 판정 롤에 보존한다.
        const weaponAddFormula = weaponBonus?.addFormula;
        const rollFormula = weaponAddFormula
          ? `${finalDice}dx${critical} + ${add2} + ${weaponAddFormula}`
          : `${finalDice}dx${critical} + ${add2}`;
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
          // 공격 판정: 항상 데미지 롤 버튼 표시
          const weaponIdsStr = weaponBonus?.weaponIds ? weaponBonus.weaponIds.join(',') : '';
          resultContent = `
            <div class="item-actions" style="margin-top: 8px;">
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
