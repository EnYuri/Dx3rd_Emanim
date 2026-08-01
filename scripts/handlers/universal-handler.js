// Universal handler - shared routines for item use/activation
(function() {

  window.DX3rdUniversalHandler = {
    /**
     * 무기 탭에 등록된 무기들의 보너스 계산 (공격 횟수가 남은 무기만).
     * effect/psionic 이 공유한다 — 두 곳에 같은 52줄이 복제돼 있어, 무기 소진 규칙을
     * 고칠 때 한쪽만 고치는 사고를 막으려고 여기로 올렸다.
     *
     * ComboHandler.calculateRegisteredWeaponBonus 는 이것과 다른 함수다. 복수무기(multiWeapon)
     * 규칙이 얹혀 있으므로 여기로 합치지 말 것.
     */
    calculateRegisteredWeaponBonus(actor, item) {
      const weaponBonus = { attack: 0, add: 0, attackFormula: '', addFormula: '', weaponName: '', weaponIds: [] };

      // 무기 탭에 등록된 무기들 가져오기
      const registeredWeapons = item.system?.weapon || [];

      // 각 등록된 무기의 보너스 합산 (공격 횟수가 남은 무기만)
      for (const weaponId of registeredWeapons) {
        if (weaponId && weaponId !== '-') {
          // 액터의 아이템에서 직접 무기 데이터 가져오기
          const weaponItem = window.DX3rdResolveWeapon(actor, weaponId);
          if (weaponItem && weaponItem.type === 'weapon') {
            // 공격 횟수 체크 (weapon만, vehicle은 attack-used 없음)
            const attackUsedDisable = weaponItem.system['attack-used']?.disable || 'notCheck';
            const attackUsedState = weaponItem.system['attack-used']?.state || 0;
            const attackUsedMax = weaponItem.system['attack-used']?.max || 0;
            const isAttackExhausted = attackUsedDisable !== 'notCheck' && (attackUsedMax <= 0 || attackUsedState >= attackUsedMax);

            // 공격 횟수가 소진된 무기는 제외 — 다만 소진을 차단으로 이을지는 월드 설정이 정한다.
            if (isAttackExhausted && window.DX3rdItemExhausted?.allowExhaustedUse?.() === false) {
              continue;
            }

            // 고정 보정은 즉시 합산하고, 다이스식은 공격/데미지 확정 시점까지 보존한다.
            const formula = window.DX3rdFormulaEvaluator;
            const addFormulaTerm = (target, raw) => {
              const prepared = formula.prepareRollFormula(String(raw ?? '0'), weaponItem, actor);
              if (formula.hasDice(prepared)) weaponBonus[target] = [weaponBonus[target], prepared].filter(Boolean).join(' + ');
              else weaponBonus[target === 'attackFormula' ? 'attack' : 'add'] += Number(formula.evaluate(raw, weaponItem, actor)) || 0;
            };
            addFormulaTerm('attackFormula', weaponItem.system?.attack);
            addFormulaTerm('addFormula', weaponItem.system?.add);

            // 무기 이름 추가
            if (!weaponBonus.weaponName) {
              weaponBonus.weaponName = weaponItem.name;
            } else {
              weaponBonus.weaponName += `, ${weaponItem.name}`;
            }

            // 무기 ID 추가
            weaponBonus.weaponIds.push(weaponId);
          }
          // 무기가 아니거나 찾을 수 없는 경우는 건너뛴다.
        }
      }

      return weaponBonus;
    },

    /**
     * 아이템의 system.skill 로부터 판정용 stat 과 표시 라벨을 해석한다.
     * 능력치(body/sense/mind/social), 신드롬(syndrome), 일반/커스텀 스킬을 모두 지원한다.
     * effect/psionic 이 공유한다 — psionic 쪽에 낡은 인라인 복제본 두 개가 있었고,
     * 커스텀 스킬 개명과 미보유 기능치 폴백이 빠져 있어 여기로 합쳤다.
     * @returns {{stat: object|null, label: string}}
     */
    resolveStatAndLabel(actor, item) {
      const skillKey = item.system?.skill;
      const attributes = ['body', 'sense', 'mind', 'social'];

      if (attributes.includes(skillKey)) {
        return {
          stat: actor.system.attributes[skillKey],
          label: game.i18n.localize(`DX3rd.${skillKey.charAt(0).toUpperCase() + skillKey.slice(1)}`)
        };
      }

      if (skillKey === 'syndrome') {
        const stat = actor.system.attributes.syndrome;
        let label = stat?.name || game.i18n.localize('DX3rd.Syndrome');
        if (label && label.startsWith('DX3rd.')) label = game.i18n.localize(label);
        return { stat, label };
      }

      // 일반/커스텀 스킬
      const stat = actor.system.attributes.skills?.[skillKey];
      if (stat) return { stat, label: window.DX3rdSkillManager.getSkillDisplayName(skillKey, stat) };

      // 폴백: 액터가 보유하지 않은 (계통) 기능치를 참조하면 연결 능력치로 판정한다.
      // (미습득 기능 = 능력치 판정, DX3 규칙과 일치. 계통 기능치를 새 캐릭터에 자동 시드하지
      //  않으므로, 홈브루 아이템이나 다른 액터에서 드래그해 온 아이템이 그런 기능치를
      //  참조해도 판정이 중단되지 않게 한다.)
      const base = this._resolveSkillBase(skillKey);
      if (base && actor.system.attributes[base]) {
        const customSkills = game.settings.get("dx3rd-emanim", "customSkills") || {};
        const cs = customSkills[skillKey];
        const label = cs
          ? (typeof cs === 'object' ? cs.name : cs)
          : (skillKey.startsWith('DX3rd.') ? game.i18n.localize(skillKey) : skillKey);
        return { stat: actor.system.attributes[base], label };
      }

      return { stat: null, label: '' };
    },

    /**
     * 액터에 없는 기능치 키의 연결 능력치를 추정한다.
     * customSkills 설정의 base 를 우선 사용하고, 없으면 계통 키 접두사로 추론한다.
     */
    _resolveSkillBase(skillKey) {
      if (!skillKey) return null;
      const customSkills = game.settings.get("dx3rd-emanim", "customSkills") || {};
      const cs = customSkills[skillKey];
      if (cs && typeof cs === 'object' && cs.base) return cs.base;
      if (skillKey.startsWith('info_')) return 'social';
      if (skillKey.startsWith('know_')) return 'mind';
      if (skillKey.startsWith('drive_')) return 'body';
      if (skillKey.startsWith('ars_')) return 'sense';
      return null;
    },

    /**
     * 사용 횟수 소진을 알린다. 소진 판정은 부르는 쪽이 하고, 여기서는 그것을
     * **차단으로 이을지**만 정한다(월드 설정 allowExhaustedUse).
     *
     * 기본값(허용)에서는 막지 않고 경고만 남긴다 — 자동화가 아직 다듬어지는 중이라,
     * 횟수 데이터 하나가 틀렸다는 이유로 그 자리에서 이펙트를 못 쓰게 되면 세션이 멈춘다.
     * 그래도 알림과 채팅 기록은 남겨 GM 이 「원래는 못 쓰는 것을 썼다」를 놓치지 않게 하고,
     * 시트의 소진 표시(isItemExhausted)는 설정과 무관하게 그대로 둔다.
     *
     * 콤보 멤버 소진과 아이템 자신의 소진이 같은 문구·같은 경로를 쓰도록 한 곳에 둔다.
     * @param {Actor} actor
     * @param {Item} item
     * @param {string} detail  "사용 횟수 소진 (2/2)" 처럼 이미 조립된 사유
     * @returns {Promise<boolean>} 계속 진행해도 되는가
     */
    async reportUsageExhausted(actor, item, detail) {
      const itemName = (String(item?.name || '').match(/^(.+)\|\|(.+)$/) || [null, item?.name])[1];
      const allowed = window.DX3rdItemExhausted?.allowExhaustedUse?.() !== false;
      const speaker = ChatMessage.getSpeaker({ actor });

      if (allowed) {
        ui.notifications.warn(`${itemName}: ${detail} — ${game.i18n.localize('DX3rd.ExhaustedUseAllowed')}`);
        await ChatMessage.create({
          speaker,
          content: `<div class="dx3rd-item-chat"><div class="dx3rd-warning"><strong>${itemName}</strong><br>${detail} — ${game.i18n.localize('DX3rd.ExhaustedUseAllowed')}</div></div>`
        });
        window.DX3rdDebug.log('DX3rd | Usage exhausted but allowed by setting:', itemName, detail);
        return true;
      }

      ui.notifications.warn(`${itemName}: ${detail}`);
      await ChatMessage.create({
        speaker,
        content: `<div class="dx3rd-item-chat"><div class="dx3rd-error"><strong>${itemName} ${game.i18n.localize('DX3rd.Use')} ${game.i18n.localize('DX3rd.Unable')}</strong><br>${detail}</div></div>`,
        style: CONST.CHAT_MESSAGE_STYLES.OTHER
      });
      window.DX3rdDebug.log('DX3rd | Item usage blocked - usage count exhausted:', itemName, detail);
      return false;
    },

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
      const comboMemberEntries = item.type === 'combo'
        ? (window.DX3rdComboHandler?.comboMemberEntries?.(actor, item) || [])
        : [];
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
              window.DX3rdDebug.log(`DX3rd | Chat message blocked: ${itemName} has auto timing with pressure condition`);
              
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
              window.DX3rdDebug.log(`DX3rd | Item usage blocked: ${itemName} has ${runTiming} timing with berserk condition`);
              
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
                      const finalLevel = window.DX3rdEffectLevel
                        ? window.DX3rdEffectLevel.value(effect, actor)
                        : Number(effect.system?.level?.init) || 0;
                      effectDisplayMax += finalLevel;
                    }
                    
                    if (effectDisplayMax <= 0 || effectUsedState >= effectDisplayMax) {
                      const detail = `${game.i18n.localize('DX3rd.ExhaustedIncludedEffect')}: ${effect.name} (${effectUsedState}/${effectDisplayMax})`;
                      if (!await this.reportUsageExhausted(actor, item, detail)) return false;
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
          // 일회용은 보유 수량 자체가 이번 시나리오의 사용 가능 횟수다.
          // 시트에서 수량 변경 직후 max 동기화가 누락된 오래된 월드 문서도 올바르게 판정한다.
          if (item.type === 'once') {
            displayMax = Number(item.system?.quantity) || 1;
          } else if (usedLevel && item.type === 'effect') {
            const finalLevel = window.DX3rdEffectLevel
              ? window.DX3rdEffectLevel.value(item, actor)
              : Number(item.system?.level?.init) || 0;
            displayMax += finalLevel;
          } else if (usedLevel && item.type === 'psionic') {
            // 사이오닉은 침식률 보정 없이 init만 더함
            const baseLevel = Number(item.system?.level?.init) || 0;
            displayMax += baseLevel;
          }
          
          // displayMax가 0이거나 usedState가 displayMax 이상이면 소진
          if (displayMax <= 0 || usedState >= displayMax) {
            const detail = `${game.i18n.localize('DX3rd.ExhaustedUsageCount')} (${usedState}/${displayMax})`;
            if (!await this.reportUsageExhausted(actor, item, detail)) return false;
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
            window.DX3rdDebug.log('DX3rd | Resurrect item blocked - HP is not 0:', currentHP);
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
            window.DX3rdDebug.log('DX3rd | Resurrect item blocked - Encroachment is 100 or higher:', currentEncroachment);
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
              window.DX3rdDebug.log('DX3rd | Resurrect item blocked - Encroachment is 100 or higher:', currentEncroachment);
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
                window.DX3rdDebug.log('DX3rd | Item usage blocked - Encroachment below limit:', { currentEncroachment, limitValue });
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
          let runtimeSourceItem = runtimeCfg ? item : null;
          if (!runtimeCfg && item.type === 'combo') {
            for (const {item: memberItem} of comboMemberEntries) {
              const memberAction = window.DX3rdComboHandler.comboMemberAction(memberItem, requestedAction);
              const ex = memberItem?.getFlag?.('dx3rd-emanim', 'itemExtend') || {};
              runtimeCfg = (window.DX3rdItemEffectAdapter?.extensionEntries?.(ex) || [])
                .filter(entry => entry.type === 'damage')
                .map(entry => entry.data)
                .find(data => data?.runtimePrompt
                  && (!window.DX3rdItemEffectAdapter
                    || window.DX3rdItemEffectAdapter.extensionActionMatches(
                      memberItem, 'damage', data, memberAction, data.timing || 'instant'
                    ))) || null;
              if (runtimeCfg) {
                runtimeSourceItem = memberItem;
                break;
              }
            }
          }
          if (runtimeCfg) {
            const label = runtimeCfg.runtimeLabel
              || (runtimeCfg.runtimeConsumeHP
                ? game.i18n.localize('DX3rd.RuntimeConsumeHP')
                : game.i18n.localize('DX3rd.RuntimeInput'));
            const rawMax = String(runtimeCfg.runtimeMax ?? '').trim();
            let maxValue = null;
            if (rawMax && rawMax !== '-') {
              const evaluatedMax = Number(this.evaluateFormulaForExtension(rawMax, runtimeSourceItem || item, actor));
              if (Number.isFinite(evaluatedMax) && evaluatedMax >= 0) maxValue = Math.floor(evaluatedMax);
            }
            const entered = await window.DX3rdUniversalNumberPromptV2({
              title: item.name,
              label,
              defaultValue: Number(runtimeCfg.runtimeDefault) || 0,
              maxValue
            });
            if (entered === null || entered === undefined) {
              window.DX3rdDebug.log('DX3rd | Item use canceled at runtime input prompt');
              return false; // 취소 → 사용 중단(코스트 미차감)
            }
            actor._dx3rdRuntimeInput = entered;
            if (runtimeCfg.runtimeConsumeHP) runtimeConsumeAmount = entered;
          }
        }

        let costMessages = [];

        // 비용 차감(HP·침식률)은 한 번의 actor.update로 모아서 쓴다.
        // update 1회마다 서버 왕복 + prepareData 전량 재계산 + updateActor 훅 전체가 도므로,
        // 아이템을 쓸 때마다 이 비용을 두 번 낼 이유가 없다. reviveSelf(같은 파일)와 동일한 패턴.
        // 순서 의존은 없다: HP 코스트 수식은 아래 1-E에서 어떤 쓰기보다 먼저 전부 평가되고,
        // 침식률은 item.system.encroach.value 원시값만 읽으므로 HP 반영 여부와 무관하다.
        const costUpdate = {};

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

        // 1-D. 콤보인 경우, 전체 구성 아이템의 자체/익스텐션 HP 비용도 역할 액션으로 수집
        if (item.type === 'combo') {
          for (const {item: memberItem} of comboMemberEntries) {
            const memberAction = window.DX3rdComboHandler.comboMemberAction(memberItem, requestedAction);

            // 콤보는 멤버 이펙트를 개별 handleItemUse로 통과시키지 않으므로,
            // 이펙트 자체의 system.hp 비용도 여기서 명시적으로 합산한다.
            const memberHpCost = String(memberItem.system?.hp?.value ?? '0').trim();
            if (memberHpCost !== '0' && memberHpCost !== '' && memberHpCost !== '-') {
              hpCostList.push({ raw: memberHpCost, source: `member:${memberItem.name}:system.hp` });
            }
            
            const memberExtend = memberItem.getFlag('dx3rd-emanim', 'itemExtend') || {};
            for (const entry of (window.DX3rdItemEffectAdapter?.extensionEntries?.(memberExtend) || []).filter(entry => entry.type === 'damage')) {
              const data = entry.data || {};
              const matches = !window.DX3rdItemEffectAdapter
                || window.DX3rdItemEffectAdapter.extensionActionMatches(memberItem, 'damage', data, memberAction, data.timing || 'instant');
              const raw = data.hpCostActivate && data.hpCost && matches ? String(data.hpCost).trim() : '0';
              if (raw !== '0' && raw !== '') hpCostList.push({raw, source: `member:${memberItem.name}:${entry.id}`});
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
        
        // 1-F. HP 코스트 적용
        // HP 부족은 사용을 막지 않는다. 룰상 코스트는 지불 가능 여부와 무관하게 지불하며,
        // 결과로 HP가 0 이하가 되는 것(전투불능)은 정상적인 귀결이다.
        if (totalHpCost > 0) {
          const currentHP = Number(actor.system?.attributes?.hp?.value ?? 0);

          // HP 감소 적용 (실제 쓰기는 침식률까지 모아 아래에서 한 번에)
          const afterHP = currentHP - totalHpCost;
          costUpdate['system.attributes.hp.value'] = afterHP;
          
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
        const hasEncroachmentCost = encAddRaw !== '0' && encAddRaw !== '' && encAddRaw !== '-';
        // "침식률(없음)" 타입: 이 액터는 침식률이 오르지 않는다(_preUpdate 가드와 동일).
        // 주 경로에서는 굴림·가산·메시지를 건너뛰고 미상승만 표기한다.
        const noEncroach = actor.system?.attributes?.encroachment?.type === 'none';

        if (noEncroach && hasEncroachmentCost) {
          costMessages.push(`${game.i18n.localize('DX3rd.Encroachment')} +0 (${game.i18n.localize('DX3rd.NoEncroachNote')})`);
        } else if (hasEncroachmentCost) {
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

          costUpdate['system.attributes.encroachment.value'] = after;

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
        
        // 2-B. 모아둔 비용을 한 번에 반영.
        // 침식률(없음) 가드(_preUpdate)와 HP 0 감지(condtions.js)는 둘 다 이 병합 페이로드에서
        // 각자의 키를 그대로 찾아내므로, 분리해서 쓸 때와 동작이 동일하다.
        if (Object.keys(costUpdate).length) await actor.update(costUpdate);

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

        // 맨손과 이펙트는 비용이 없으면 종전에는 “○○ 사용” 한 줄만 남아 무엇을
        // 발동했는지 알기 어려웠다. 시트의 해설을 같은 채팅 카드에 작은 보조문으로 붙인다.
        const isFist = item.type === 'weapon' && this.isFistWeaponName(item.name);
        const usageDescription = String(item.system?.description || '').trim();
        if ((item.type === 'effect' || isFist) && usageDescription) {
          let enrichedDescription = usageDescription;
          try {
            enrichedDescription = await window.DX3rdDescriptionManager?.createEnrichedBiography?.(
              item, usageDescription
            ) || usageDescription;
          } catch (error) {
            console.warn('DX3rd | Usage description enrichment failed:', item.name, error);
          }
          msg += `<div class="item-description dx3rd-usage-description"><div class="description-content">${enrichedDescription}</div></div>`;
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
        // runTiming 게이트가 여기만 빠져 있었다. 자기 보정을 afterSuccess/afterDamage 로 저작한
        // 마술을 캐스팅 시점에 미리 켜 버리고(각 타이밍의 활성화 지점 — chat-ui 발동 버튼,
        // processCombo*, handleSuccessButton — 이 따로 있다) 저작한 순서가 무너진다.
        const runTiming = item?.system?.active?.runTiming ?? 'instant';
        if (runTiming === 'instant' && activeDisable !== 'notCheck' && !skipToggle) {
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
      
      // 1. 자기 지속 보정 처리. 새 콤보 데이터는 액션을 함께 저장하여 구성 멤버의
      // 「사용」 버킷만 발현한다. action 없는 기존 채팅 카드는 종전 활성화로 호환한다.
      for (const { itemId, itemName, action = null } of activations) {
        const item = actor.items.get(itemId);
        if (!item) continue;
        if (action) {
          await this.applySelfModifiers(actor, item, { action });
        } else if (item.system?.active?.runTiming === 'afterSuccess' && !item.system?.active?.state) {
          await item.update({ 'system.active.state': true });
        }
      }
      
      // 2. 매크로 실행
      for (const { itemId, itemName, macroName, timing, action = null } of macros) {
        const item = actor.items.get(itemId);
        if (item) {
          await this.executeMacros(item, timing, action);
        }
      }
      
      // 3. 어플라이드 적용
      for (const { itemId, itemName, action = null } of applies) {
        const item = actor.items.get(itemId);
        if (item) {
          await this.applyToTargets(actor, item, 'afterSuccess', null, action);
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
      
      // 1. 자기 지속 보정 처리. 구성 멤버는 직렬화된 「사용」 액션만 발현한다.
      for (const { itemId, itemName, action = null } of activations) {
        const item = actor.items.get(itemId);
        if (!item) continue;
        if (action) {
          await this.applySelfModifiers(actor, item, { action });
        } else {
          // action 없는 기존 채팅 카드 호환
          const activeDisable = item.system?.active?.disable ?? '-';
          if (item.system?.active?.runTiming === 'afterDamage' && !item.system?.active?.state && activeDisable !== 'notCheck') {
            await item.update({ 'system.active.state': true });
          }
        }
      }
      
      // 2. 매크로 실행
      for (const { itemId, itemName, macroName, timing, action = null } of macros) {
        const item = actor.items.get(itemId);
        if (item) {
          try {
            await this.executeMacros(item, timing, action);
          } catch (e) {
            console.warn(`DX3rd | Combo afterDamage - Macro execution failed: ${itemName}`, e);
          }
        }
      }
      
      // 3. 어플라이드 처리
      for (const { itemId, itemName, action = 'attack' } of applies) {
        const item = actor.items.get(itemId);
        if (item) {
          // damagedActors를 forcedTargets로 전달
          await this.applyToTargets(actor, item, 'afterDamage', damagedActors, action);
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
          window.DX3rdDebug.log(`DX3rd | Combo afterDamage - Skipping item creation (${bucket.type})`);
        }
      }
      
      // 5. afterMain 익스텐션을 큐에 등록 (runTiming이 afterDamage인 경우)
      window.DX3rdDebug.log('DX3rd | processComboAfterDamage - Registering afterMain extensions:', afterMainExtensions.length);
      for (const bucket of afterMainExtensions) {
        window.DX3rdDebug.log('DX3rd | processComboAfterDamage - Registering afterMain:', bucket.type, 'merged:', bucket.merged);
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
        window.DX3rdDebug.log('DX3rd | UniversalHandler.activateItem - Item activated:', item.name);
      }
      return true;
    },

    /**
     * 비용·사용 횟수를 쓰기 전에 타입별 판정 설정이 유효한지 확인한다.
     * 타입 핸들러에서 뒤늦게 실패하면 이미 지불한 비용을 되돌릴 수 없으므로,
     * 정적으로 확인 가능한 기능/판정 데이터는 공용 파이프라인 앞에서 막는다.
     */
    validateItemUsePreflight(actor, item, itemType, action) {
      const requiresResolvedSkill = (
        (itemType === 'weapon' || itemType === 'vehicle') && action === 'attack'
      ) || (
        (itemType === 'effect' || itemType === 'psionic')
        && ((item.system?.roll ?? '-') !== '-'
          || (item.system?.attackRoll && item.system.attackRoll !== '-'))
      ) || (
        itemType === 'connection' && item.system?.skill && item.system.skill !== '-'
      );

      if (requiresResolvedSkill) {
        const skillKey = item.system?.skill;
        const resolved = skillKey && skillKey !== '-' ? this.resolveStatAndLabel(actor, item) : null;
        if (!resolved?.stat) {
          ui.notifications.warn(game.i18n.localize('DX3rd.SkillNotFound'));
          return false;
        }
      }

      if (itemType === 'book' && !actor.system?.attributes?.skills?.cthulhu) {
        ui.notifications.warn(game.i18n.localize('DX3rd.SkillNotFound'));
        return false;
      }

      if (itemType === 'combo' && window.DX3rdComboHandler?.validateUse) {
        return window.DX3rdComboHandler.validateUse(actor, item) !== false;
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
      // 커넥션/마도서는 구 타입 핸들러 안에서 일반 판정/콤보를 골랐고, 그 시점에는
      // 이미 비용과 사용 횟수가 지불된 뒤였다. 취소하거나 콤보 빌더만 열어도 비용이
      // 사라지지 않도록 선택 자체를 공용 비용 게이트 앞으로 끌어올린다.
      const connectionHasRoll = itemType === 'connection'
        && item.system?.skill && item.system.skill !== '-';
      if ((connectionHasRoll || itemType === 'book') && options.comboMode === undefined) {
        if (typeof window.DX3rdChooseRollMode !== 'function') {
          ui.notifications.error(game.i18n.localize('DX3rd.DialogV2Unavailable'));
          return false;
        }
        const useCombo = await window.DX3rdChooseRollMode(options.menuAnchor);
        if (useCombo === null) return false;
        if (useCombo) {
          let created;
          if (itemType === 'book') {
            const difficultyValue = Number(item.system?.decipher) || 0;
            created = await this.openComboBuilder(actor, 'skill', 'cthulhu', item, {
              isBookDecipher: true,
              originalItem: item,
              predefinedDifficulty: difficultyValue > 0 ? {type: 'number', value: difficultyValue} : null
            });
          } else {
            const skillKey = item.system?.skill;
            if (!skillKey || skillKey === '-') {
              ui.notifications.warn(game.i18n.localize('DX3rd.SkillNotFound'));
              return false;
            }
            created = await this.openComboBuilder(actor, 'skill', skillKey, item);
          }
          return !!created;
        }
        options = {...options, comboMode: 'normal'};
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
      // 콤보 본체에는 멤버의 확장 카드가 복사되지 않는다. 본체만 어댑터에 물으면 false가
      // 나와 system.getTarget=true조차 nullish 폴백에서 무시됐고, 비용·횟수를 쓴 뒤 대상
      // 효과만 사라졌다. 일반 구성 슬롯과 무기 슬롯을 모두 역할별 액션으로 검사한다.
      // 활성화 전용 카드 때문에 콤보가 타겟을 요구해서는 안 된다.
      const comboMemberRequiresTarget = item.type === 'combo'
        && (window.DX3rdComboHandler?.comboMemberEntries?.(actor, item) || []).some(({item: memberItem}) => {
          const memberAction = window.DX3rdComboHandler.comboMemberAction(memberItem, action);
          return !!memberItem.system?.getTarget
            || !!window.DX3rdItemEffectAdapter?.requiresTarget?.(memberItem, memberAction);
        });
      // 자동 적용하지 않고 다른 액터에 수동 반영하는 컴펜디움 이펙트도 있다.
      // 이 플래그는 호출부가 getTarget=false를 넘겨도 대상 선택을 생략할 수 없고,
      // 자기 자신을 대상으로 삼으면 비용을 쓰기 전에 중단한다.
      const manualTargetOtherOnly = item.getFlag?.('dx3rd-emanim', 'manualTargetOtherOnly') === true;
      const requiresTarget = manualTargetOtherOnly || (getTarget !== undefined
        ? getTarget
        : (!!item.system?.getTarget
          || !!window.DX3rdItemEffectAdapter?.requiresTarget?.(item, action)
          || comboMemberRequiresTarget));
      
      window.DX3rdDebug.log('DX3rd | handleItemUse target check:', {
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
          window.DX3rdDebug.log('DX3rd | Item use blocked - no targets selected (highlight preserved)');
          ui.notifications.warn(game.i18n.localize('DX3rd.SelectTarget'));
          return false; // 하이라이트 유지하고 중단
        }
        if (manualTargetOtherOnly && targets.some(target => target.actor?.id === actor.id)) {
          window.DX3rdDebug.log('DX3rd | Item use blocked - self is not a valid manual target:', item.name);
          ui.notifications.warn(game.i18n.localize('DX3rd.TargetOtherOnly'));
          return false;
        }
        window.DX3rdDebug.log('DX3rd | Target check passed -', targets.length, 'targets selected');
      }

      if (!this.validateItemUsePreflight(actor, item, itemType, action)) {
        window.DX3rdDebug.log('DX3rd | handleItemUse - Type preflight rejected:', item.name);
        return false;
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
      // 선언형 장비(「…선언하면」)를 그 무기로 공격하는 것만으로 소모하지 않는다.
      // 회수·코스트·사용 카드는 판정 다이얼로그의 선언 토글이 확정할 때(action:'use')
      // 한 번만 치른다 — 공격은 공격일 뿐이고, 쓸지 말지는 명중판정 직전에 고르는 것이
      // 이 계열 장비의 전부다. 여기서도 걷으면 로켓 런처를 들고 평범하게 쏘기만 해도
      // 시나리오 1회뿐인 회수가 사라지고, 정작 보정은 액션이 달라 붙지도 않는다.
      // 판단 기준을 선언 UI 와 같은 함수(isDeclarable)로 두어 "목록에 뜨는 것 = 여기서
      // 안 걷는 것"이 어긋날 수 없게 한다.
      const declarationOnly = action === 'attack'
        && !!window.DX3rdDeclaredEquipment?.isDeclarable?.(item);

      if (!declarationOnly) {
        const usageAllowed = await this.processItemUsageCost(actor, item, {action});
        if (!usageAllowed) {
          window.DX3rdDebug.log('DX3rd | handleItemUse - Usage blocked by cost');
          return false;
        }

        // 1.5. 사용 횟수 증가 (notCheck가 아닌 경우)
        const usedDisable = item.system?.used?.disable || 'notCheck';
        if (usedDisable !== 'notCheck') {
          const currentUsedState = item.system?.used?.state || 0;
          await item.update({ 'system.used.state': currentUsedState + 1 });
          window.DX3rdDebug.log('DX3rd | handleItemUse - Used count increased:', currentUsedState, '→', currentUsedState + 1);
        }
      } else {
        window.DX3rdDebug.log('DX3rd | handleItemUse - Declaration-only equipment: attack costs nothing', item.name);
      }

      // 2. instant 활성화 처리 (disable이 'notCheck'가 아닌 경우에만)
      // once 즉시해소형(disable='-')은 잔류 토글을 남기지 않는다(activateItem 주석 참조).
      const activeDisable = item.system?.active?.disable ?? '-';
      const skipToggle = item.type === 'once' && activeDisable === '-';
      const adapter = window.DX3rdItemEffectAdapter;
      // 자기 보정 채널의 액션이 '활성화'로 잡히는 아이템(상시 이펙트 / applyMode='toggle' /
      // 효과 카드에서 액션을 「활성화」로 지정)은 사용 액션('use'·'attack')과 액션이 달라
      // 게이트를 통과하지 못했다. 그런데 같은 이펙트를 콤보 멤버로 넣으면 combo-handler 가
      // 액션 게이트 없이 applySelfModifiers 를 부르므로 켜진다 — 단독 사용만 조용히
      // 아무 일도 안 하는 비대칭이었고, 지속 효과가 꺼진 이펙트는 사용해도 계속 꺼진 채였다.
      // → 직접 사용은 활성화를 포함하는 것으로 본다(판정은 어댑터 useMeansActivation 단일 기준).
      const useMeansActivate = !!adapter?.useMeansActivation?.(item);
      const selfActionMatches = !adapter
        || adapter.extensionActionMatches(item, 'selfModifiers', item.system?.active || {}, action, 'instant')
        || useMeansActivate
        // 항목별 「발현 액션」이 채널 기본과 다르게 저작돼 있으면 채널 게이트만으로는 막힌다.
        || adapter.hasExplicitBucket(item, 'self', action);
      // 「아직 걸 게 남았는가」는 채널마다 다르다 — 어댑터 selfModifiersPending 단일 기준.
      // (활성화 채널: !active.state / 동결 채널: 사용할 때마다 새로 / notCheck: 적용 안 함)
      const selfPending = adapter ? adapter.selfModifiersPending(item)
        : (!item.system.active?.state && activeDisable !== 'notCheck');
      if (selfActionMatches && item.system.active?.runTiming === 'instant' && selfPending && !skipToggle) {
        // '활성화' 채널로 저작된 보정은 동결이 아니라 토글로 켠다. 시트 표시·콤보의 지속 판정
        // (combo-data getPersistentEffectIds/calculateItemAttackBonus)이 active.state 를 읽으므로,
        // 여기서 동결 AE만 걸면 "효과는 걸렸는데 여전히 비활성"인 상태가 그대로 남는다.
        const toggled = await this.applySelfModifiers(actor, item, { forceToggle: useMeansActivate, action });
        window.DX3rdDebug.log(`DX3rd | handleItemUse - Self modifiers applied (${toggled ? 'toggle' : 'onUse frozen'}):`, item.name);
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
        window.DX3rdDebug.log('DX3rd | handleItemUse - Skipping combo instant extensions here (will be merged and executed in ComboHandler)');
      }
      
      // 4. runTiming이 instant인 경우, afterMain 익스텐드를 큐에 등록
      // 단, 콤보는 ComboHandler에서 병합하여 등록하므로 여기서는 건너뜀
      if (item.system.active?.runTiming === 'instant') {
        if (item.type !== 'combo') {
          const itemExtend = item.getFlag('dx3rd-emanim', 'itemExtend');
          if (itemExtend) {
            window.DX3rdDebug.log('DX3rd | handleItemUse - Registering afterMain extensions for non-combo item:', item.name);
            await this.registerAfterMainExtensions(actor, item, itemExtend, action);
          }
        } else {
          window.DX3rdDebug.log('DX3rd | handleItemUse - Skipping afterMain registration for combo (will be handled by ComboHandler)');
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
          let handlerResult;
          if (itemType === 'rois' && roisAction) {
            if (roisAction === 'titus') {
              handlerResult = await handler.handleTitus(actorId, itemId);
            } else if (roisAction === 'sublimation') {
              handlerResult = await handler.handleSublimation(actorId, itemId);
            } else if (roisAction === 'activate') {
              // 발동형 로이스(D로이스 등): 매크로/자기효과/코스트/사용횟수는 위 공용 파이프라인에서
              // 이미 실행됐다. RoisHandler.handle 은 티투스/승화 전용이므로 여기서 호출하면
              // 매크로가 이중 실행되고 D로이스에 의미 없는 titus 플래그가 켜진다 → 호출하지 않는다.
            } else {
              handlerResult = await handler.handle(actorId, itemId, getTarget, options);
            }
          } else {
            handlerResult = await handler.handle(actorId, itemId, getTarget, options);
          }
          // 기존 핸들러의 undefined 성공 계약은 유지하되, 명시적 false는 반드시 호출자까지
          // 전파한다. 그래야 채팅 완료 표시와 임시 콤보 정리가 실제 실행 실패를 성공으로
          // 오인하지 않는다.
          if (handlerResult === false) return false;
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

    // 상한은 공식이 정한 cap 그대로다. 현재 HP로 깎지 않는다 —
    // 지불 능력은 사용 가부를 제한하지 않으며, HP가 0 이하가 되어도 무방하다.
    const usableMax = (resource === 'hp') ? cap
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
      // 차감 시점의 HP를 읽는다(입력 다이얼로그가 열려 있는 동안 바뀌었을 수 있다).
      const curHp = Number(actor.system?.attributes?.hp?.value ?? 0);
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

  // 고정 자기 비용. afterMain 큐에서도 같은 실행기를 사용해 "메인 프로세스 종료 후"
  // 침식 상승을 즉시 비용으로 앞당기지 않는다.
  const fixedRaw = String(encData?.value ?? encData?.formula ?? encData?.amount ?? '').trim();
  if (encData?.fixed === true && target === 'self' && fixedRaw && fixedRaw !== '-') {
    if (actor.system?.attributes?.encroachment?.type === 'none') return;
    const normalized = fixedRaw.replace(/(\d+)\s*[dD]\s*(?!\d)/g, '$1d10').replace(/D/g, 'd');
    const isDice = /\d+d\d+/i.test(normalized);
    const roll = isDice ? await new Roll(normalized).roll() : null;
    const amount = roll ? Number(roll.total) || 0 : Number(normalized) || 0;
    const current = Number(actor.system?.attributes?.encroachment?.value ?? 0);
    await actor.update({'system.attributes.encroachment.value': current + amount});
    const diceHTML = roll ? `<div class="dx3rd-mt-4">${await roll.render()}</div>` : '';
    await ChatMessage.create({
      speaker: ChatMessage.getSpeaker({actor}),
      content: `<div class="dx3rd-encroach"><b>${item?.name || ''}</b><br>${game.i18n.localize('DX3rd.Encroachment')} +${amount}${isDice ? ` (${normalized})` : ''}${diceHTML}</div>`
    });
    return;
  }

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

/** 무기 이름이 맨손(Fist)인지 판정한다. `맨손` 또는 `[맨손]`을 포함하면 참. */
window.DX3rdUniversalHandler.isFistWeaponName = function(name) {
  if (!name) return false;
  const fistName = game.i18n.localize('DX3rd.Fist');
  return name === fistName || name.includes(`[${fistName}]`);
};

/** 데미지 산출 시 맨손(Fist) 무기에만 적용되는 공격력 보너스(attrs.attack.fist). 맨손 아님/비무기면 0. */
window.DX3rdUniversalHandler.getFistAttackBonus = function(actor, item) {
  try {
    if (!item || item.type !== 'weapon' || !actor) return 0;
    if (!this.isFistWeaponName(item.name)) return 0;
    return Number(actor.system?.attributes?.attack?.fist) || 0;
  } catch (e) { return 0; }
};

/**
 * 아이템의 공격 타입(melee/ranged)을 판별한다.
 * weapon은 자체 type, vehicle은 항상 melee, 그 외는 attackRoll 필드를 따른다.
 * @returns {'melee'|'ranged'|null}
 */
window.DX3rdUniversalHandler.resolveAttackType = function(item) {
  if (!item) return null;
  if (item.type === 'weapon') return item.system?.type || null;
  if (item.type === 'vehicle') return 'melee';
  if (item.system?.attackRoll && item.system.attackRoll !== '-') return item.system.attackRoll;
  return null;
};

/**
 * 액터의 공격력/데미지 굴림/관통 보너스를 공격 타입에 맞춰 합산한다.
 * 명중 판정 시점(executeAttackRoll)과 데미지 굴림 시점(handleDamageRoll), 콤보 경로가
 * 모두 이 함수를 거쳐야 두 시점의 값이 갈라지지 않는다.
 * @param {object} [options]
 * @param {string} [options.attackType]     공격 타입을 직접 지정(미지정 시 아이템에서 판별).
 * @param {string} [options.fistWeaponName] 맨손 보너스를 아이템이 아닌 이 무기 이름으로 판정한다.
 *                                          이펙트/콤보가 weapon-for-attack으로 무기를 고른 경우 사용.
 * @returns {{attackType: string|null, actorAttack: number, actorAttackFormula: string,
 *            actorDamageRoll: number, actorDamageRollFormula: string,
 *            actorPenetrate: number, actorPenetrateFormula: string}}
 */
window.DX3rdUniversalHandler.resolveAttackBonuses = function(actor, item, options = {}) {
  const attackType = options.attackType ?? this.resolveAttackType(item);
  const attrs = actor?.system?.attributes || {};

  // 공격 타입에 맞는 attack 보너스 계산
  let actorAttack = attrs.attack?.value || 0;
  const attackFormulas = attrs.attack?.rollFormula || {};
  let actorAttackFormula = attackFormulas._ || '';
  if (attackType === 'melee' && attrs.attack?.melee) {
    actorAttack += attrs.attack.melee;
    actorAttackFormula = [actorAttackFormula, attackFormulas.melee].filter(Boolean).join(' + ');
  } else if (attackType === 'ranged' && attrs.attack?.ranged) {
    actorAttack += attrs.attack.ranged;
    actorAttackFormula = [actorAttackFormula, attackFormulas.ranged].filter(Boolean).join(' + ');
  }
  // 맨손 한정 공격력(축퇴기관 등): 무기가 맨손일 때만 가산
  if (options.fistWeaponName !== undefined) {
    // 선택 무기 기준 판정(이펙트/콤보가 weapon-for-attack으로 맨손을 고른 경우)
    if (this.isFistWeaponName(options.fistWeaponName)) {
      actorAttack += Number(attrs.attack?.fist) || 0;
    }
  } else {
    actorAttack += this.getFistAttackBonus(actor, item);
  }

  // 공격 타입에 맞는 damage_roll 보너스 계산
  let actorDamageRoll = attrs.damage_roll?.value || 0;
  const damageRollFormulas = attrs.damage_roll?.rollFormula || {};
  let actorDamageRollFormula = damageRollFormulas._ || '';
  if (attackType === 'melee' && attrs.damage_roll?.melee) {
    actorDamageRoll += attrs.damage_roll.melee;
    actorDamageRollFormula = [actorDamageRollFormula, damageRollFormulas.melee].filter(Boolean).join(' + ');
  } else if (attackType === 'ranged' && attrs.damage_roll?.ranged) {
    actorDamageRoll += attrs.damage_roll.ranged;
    actorDamageRollFormula = [actorDamageRollFormula, damageRollFormulas.ranged].filter(Boolean).join(' + ');
  }

  return {
    attackType,
    actorAttack,
    actorAttackFormula,
    actorDamageRoll,
    actorDamageRollFormula,
    actorPenetrate: attrs.penetrate?.value || 0,
    // 관통 다이스식(굴리지 않은 원문). 숫자로 굳히려면 resolveAttackBonusesRolled 를 쓴다.
    actorPenetrateFormula: attrs.penetrate?.rollFormula || ''
  };
};

/**
 * resolveAttackBonuses + 관통 다이스식을 "지금" 한 번 굴려 숫자로 굳힌 결과.
 * 관통은 공격자 값이지만 소비는 방어 창(장갑과 상쇄)에서 일어난다. 방어 시점에 굴리면
 * 공격자의 다이스를 방어자 클라이언트가 굴리게 되므로, 명중 판정 시점에 굴려
 * actorPenetrate 숫자에 접어 넣고 이후 경로(채팅 버튼·소켓)는 기존대로 숫자만 나른다.
 * @returns {Promise<Object>} resolveAttackBonuses 결과 + penetrateRoll(굴렸다면 Roll)
 */
window.DX3rdUniversalHandler.resolveAttackBonusesRolled = async function(actor, item, options = {}) {
  const bonuses = this.resolveAttackBonuses(actor, item, options);
  if (!bonuses.actorPenetrateFormula) return bonuses;
  try {
    const roll = await (new Roll(bonuses.actorPenetrateFormula)).evaluate();
    bonuses.actorPenetrate += Number(roll.total) || 0;
    bonuses.penetrateRoll = roll;
  } catch (error) {
    console.warn(`DX3rd | penetrate roll failed: ${bonuses.actorPenetrateFormula}`, error);
    ui.notifications.warn(`${game.i18n.localize('DX3rd.DamageRollFormulaInvalid')}: ${bonuses.actorPenetrateFormula}`);
  }
  return bonuses;
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
