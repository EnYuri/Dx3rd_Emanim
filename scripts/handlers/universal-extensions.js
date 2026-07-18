// Universal handler - 아이템 확장(Extend) 처리 & 장비 생성 클러스터
// universal-handler.js 에서 분리. 반드시 그 파일 뒤에 로드되어 동일 객체에 믹스인된다.
// (normalizeEffectIds / groupExtensionsByKey / mergeGroupedExtensionBuckets /
//  processItemExtensions / executeItemExtension / createWeaponItems / updateFistItem /
//  createProtectItem / createVehicleItem / evaluateFormulaForExtension /
//  showEquipmentSelectionDialog / sortItemsForEquipmentDialog / getEquipmentDialogTitle)
(function() {
  if (!window.DX3rdUniversalHandler) {
    console.error('DX3rd | universal-extensions.js loaded before universal-handler.js; extension methods unavailable.');
    return;
  }

  Object.assign(window.DX3rdUniversalHandler, {
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
          window.DX3rdDebug.log(`DX3rd | Extension ${extensionType}:`, {
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
              window.DX3rdDebug.log(`DX3rd | Executing condition extension - timing match: ${extensionTiming}, type: ${extensionData.type}`);
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
                window.DX3rdDebug.log(`DX3rd | Executing ${extensionType} extension - timing match: ${extensionTiming}`);
                await this.executeItemExtension(actor, extensionType, {...extensionData, timing: extensionTiming}, item);
              } else {
                window.DX3rdDebug.log(`DX3rd | Skipping ${extensionType} extension - timing mismatch: extensionTiming=${extensionTiming}, requestedTiming=${timing}`);
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
        window.DX3rdDebug.log('DX3rd | Equipment selection dialog completed:', result);
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
  });
})();
