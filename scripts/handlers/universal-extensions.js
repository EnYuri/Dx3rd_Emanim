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

    /**
     * 콤보의 구성 슬롯(system.effectIds)에 실린 것을 구성 멤버로 볼 것인가.
     *
     * 저작 경로는 콤보 시트의 추가 드롭다운 하나뿐이고 거기에는 effect 만 실리므로
     * (`combo-data.prepareActorEffects`, `combo-sheet-v2._addEffect`) 실데이터는 전부 effect 다.
     * 그래도 술어를 두는 이유는 **판정 기준이 세 군데로 갈려 있었기 때문**이다 — 사용 횟수
     * 「검사」는 `type === 'effect'`, 「증가」는 무기/비클만 제외, 「실행」은 아무 필터도 없었다.
     * 매크로·마이그레이션·모듈이 다른 타입을 밀어 넣으면 **검사는 건너뛰는데 횟수는 올라가고
     * 실행까지 되는** 비대칭이 난다.
     *
     * `=== 'effect'` 로 좁히지 않은 것은 의도다. 좁히면 옛 월드에 다른 타입이 들어 있을 때
     * 지금 돌던 실행이 조용히 사라진다. 넓게 잡으면 최악이라야 검사가 하나 더 붙는 쪽이고,
     * 그 검사는 기본 설정에서 차단이 아니라 경고다(`reportUsageExhausted`).
     * 무기/비클만 제외하는 것은 무기 슬롯(`system.weapon`)이 공격 수치·attack-used 라는
     * 자기 경로를 따로 갖기 때문이다 — 양쪽에 걸리면 이중 처리가 된다.
     */
    isComboMemberItem(item) {
      return Boolean(item) && !['weapon', 'vehicle'].includes(item.type);
    },

    /** 콤보의 구성 멤버 아이템. ID 정규화·존재 확인·타입 판정을 한곳에서 끝낸다. */
    comboMemberItems(actor, comboItem) {
      return this.normalizeEffectIds(comboItem)
        .map(id => actor?.items?.get(id))
        .filter(memberItem => this.isComboMemberItem(memberItem));
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

    damageDataFromExtensionBucket(bucket, {
      target = null,
      selectedTargetIds = null,
      triggerItemName = null
    } = {}) {
      if (!bucket || bucket.type !== 'damage') return null;
      const sources = bucket.sources || [];
      const firstSource = sources[0]?.raw || {};
      // A custom bucket is deliberately not formula-merged. It represents one runtime formula
      // prompt for the whole same-timing/same-target bucket.
      const conditionalFormula = Boolean(bucket.custom);
      return {
        formulaDice: bucket.custom ? (firstSource.dice ?? 0) : (bucket.merged?.dice ?? 0),
        formulaAdd: bucket.custom ? (firstSource.add ?? 0) : (bucket.merged?.add ?? 0),
        target: target ?? bucket.target,
        selectedTargetIds: selectedTargetIds ?? bucket.selectedTargetIds ?? [],
        ignoreReduce: bucket.custom
          ? sources.some(source => Boolean(source.raw?.options?.ignoreReduce))
          : Boolean(bucket.ignoreReduce),
        conditionalFormula,
        sourceItemId: sources.length === 1 ? (sources[0].itemId || null) : null,
        triggerItemName
      };
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
      const itemName = `${data.name}${game.i18n.localize('DX3rd.TemporaryItem')}`;
      const createdItems = [];
      
      // 아이템의 레벨 가져오기 (없으면 1) - 침식률 보정을 동적으로 반영
      const itemLevel = (item ? window.DX3rdFormulaEvaluator.getItemLevel(item) : 0) || 1;
      const itemForFormula = { type: item?.type || 'effect', system: { level: { value: itemLevel } } };
      const amount = Math.max(1, Math.floor(this.evaluateFormulaForExtension(data.amount || '1', itemForFormula, actor)) || 1);
      
      
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

      // 생성물의 수명도 표식이 쥔다. 무기 표식은 서로 독립이므로 몇 개든 쌓일 수 있고,
      // 하나를 지우면 그 표식이 만든 무기만 사라진다.
      if (createdItems.length) {
        await this.createGrantEffect(actor, item, {
          kind: 'weapon',
          sourceItemId: item?.id ?? null,
          createdItemIds: createdItems.map(i => i.id),
          order: Date.now()
        });
      }

      return createdItems;
    },

    /**
     * 맨손 데이터를 변경하는 이펙트가 덮어쓰는 필드. 스냅샷·복원이 같은 목록을 써야
     * 「변경은 됐는데 복원이 안 되는 필드」가 생기지 않는다.
     */
    FIST_MUTABLE_FIELDS: ['type', 'skill', 'add', 'attack', 'guard', 'range'],

    /**
     * 액터가 처음 받는 맨손의 기본 데이터. `main.js` 의 맨손 생성과 **여기 한 곳**만 쓴다 —
     * 예전에는 이 값이 생성 1곳 + 리셋 3곳에 리터럴로 흩어져 있었고, 그래서 맨손을 손본
     * 액터도 전투가 끝날 때마다 이 값으로 돌아갔다(복원이 아니라 덮어쓰기였다).
     */
    defaultFistSystem() {
      return {
        type: 'melee',
        skill: 'melee',
        add: '+0',
        attack: '-5',
        guard: '0',
        range: game.i18n.localize('DX3rd.Engage')
      };
    },

    /** 맨손 아이템(이름이 `맨손` 또는 `…[맨손]`)을 찾는다. */
    findFistItem(actor) {
      const fistName = game.i18n.localize('DX3rd.Fist');
      return actor?.items?.find(it =>
        it.type === 'weapon' &&
        (it.name === fistName || it.name.endsWith(`[${fistName}]`))
      ) || null;
    },

    /**
     * 맨손을 변경하기 **직전**의 모습을 아이템 플래그에 적어 둔다. 복원은 이 값으로만 하며,
     * 플래그가 없는 맨손은 아무도 변경한 적이 없다는 뜻이라 복원이 손대지 않는다
     * (= 손으로 조정한 맨손과 영구 변경이 살아남는다).
     *
     * **이미 스냅샷이 있으면 덮어쓰지 않는다.** 《파괴의 손톱》 뒤에 《백열》을 쓰면 두 번째
     * 호출이 보는 「현재 값」은 첫 번째의 결과물이라, 덮어쓰면 원본이 영영 사라진다.
     */
    async snapshotFistItem(fistItem) {
      if (!fistItem || fistItem.getFlag('dx3rd-emanim', 'fistOriginal')) return;
      const sys = fistItem.system || {};
      const original = { name: fistItem.name };
      for (const key of this.FIST_MUTABLE_FIELDS) original[key] = sys[key];
      await fistItem.setFlag('dx3rd-emanim', 'fistOriginal', original);
    },

    // ── 장비 변경의 수명은 ActiveEffect 가 쥔다 ──────────────────────────────
    //
    // 맨손 변경과 무기 생성은 「전투가 끝나면」이라는 고정 트리거가 아니라 **표식(AE)이
    // 살아 있는 동안** 유지된다. AE 를 지우면 그 변경이 되돌아가고 생성물이 사라진다.
    // 그래서 GM 은 씬·시나리오 어디서든 효과 탭에서 지우는 것으로 즉시 되돌릴 수 있다.
    //
    // **비활성화(disabled)는 되돌리지 않는다.** 코어가 disabled AE 를 `appliedEffects`
    // 에서 빼므로 토큰 오버레이 아이콘만 사라지고, 무기·맨손 데이터는 그대로 남는다.
    // 되돌리는 것은 **삭제**뿐이다 — 그래서 `updateActiveEffect` 훅을 두지 않는다.
    //
    // 맨손 AE 는 **여러 개 쌓일 수 있다**(「이미 있어도 중복 가능」한 이펙트가 있다).
    // 그래서 각 AE 가 자기가 만든 맨손 데이터(`applied`)와 적용 시각(`order`)을 들고,
    // 하나가 사라지면 남은 것 중 **가장 최근의 applied** 로 다시 맞춘다. 전부 사라지면
    // 아이템 플래그 `fistOriginal`(= 스택의 바닥, 최초 원본)로 되돌린다. 중간 것을 지워도
    // 바닥이 흔들리지 않는 이유가 이것이다.

    GRANT_FLAG: 'itemGrant',

    /** 이 AE 가 장비 변경 표식인가. 아니면 null. */
    grantPayload(effect) {
      return effect?.getFlag?.('dx3rd-emanim', this.GRANT_FLAG) ?? null;
    },

    /** 액터의 맨손 변경 AE 를 오래된 순으로. */
    fistGrantEffects(actor, excludeId = null) {
      return (actor?.effects ?? [])
        .filter(e => e.id !== excludeId && this.grantPayload(e)?.kind === 'fist')
        .sort((a, b) => (this.grantPayload(a).order ?? 0) - (this.grantPayload(b).order ?? 0));
    },

    /**
     * 장비 변경 표식 AE 를 만든다. 계산에는 관여하지 않는다 —
     * `system.changes` 를 비워 두므로 코어가 액터 데이터를 건드릴 여지가 없고,
     * 보정은 지금까지처럼 `DX3rdAppliedEffects` 쪽 단일 경로가 담당한다.
     */
    async createGrantEffect(actor, item, payload) {
      const key = `${payload.kind}-${item?.id ?? 'unknown'}-${payload.order}`;
      const data = {
        name: item?.name || game.i18n.localize('DX3rd.Effect'),
        img: item?.img || 'icons/svg/sword.svg',
        description: game.i18n.localize(payload.kind === 'fist'
          ? 'DX3rd.GrantFistDescription' : 'DX3rd.GrantWeaponDescription'),
        disabled: false,
        // 토큰에 아이콘을 띄운다 — 비활성화하면 코어가 이 목록에서 빼므로 아이콘만 사라진다.
        showIcon: CONST.ACTIVE_EFFECT_SHOW_ICON?.ALWAYS ?? 2,
        statuses: [`dx3rd-grant-${key}`],   // 고유 status = 아이콘 병합 방지
        origin: item ? `${actor.uuid}.Item.${item.id}` : actor.uuid,
        system: { changes: [] },
        flags: { 'dx3rd-emanim': { [this.GRANT_FLAG]: payload } }
      };
      try {
        const [created] = await actor.createEmbeddedDocuments('ActiveEffect', [data]);
        return created;
      } catch (e) {
        console.error('DX3rd | 장비 변경 표식 AE 생성 실패:', e);
        return null;
      }
    },

    /**
     * 장비 변경 표식이 사라졌을 때의 정리. `deleteActiveEffect` 훅이 부른다.
     * 생성 무기는 지우고, 맨손은 **남은 표식을 다시 계산해서** 맞춘다.
     */
    async revertItemGrant(actor, effect) {
      const grant = this.grantPayload(effect);
      if (!actor || !grant) return;

      if (grant.kind === 'weapon') {
        const ids = (grant.createdItemIds || []).filter(id => actor.items.get(id));
        if (ids.length) await actor.deleteEmbeddedDocuments('Item', ids);
        return;
      }

      if (grant.kind !== 'fist') return;
      const fistItem = actor.items.get(grant.fistItemId) || this.findFistItem(actor);
      if (!fistItem) return;

      // 이 AE 는 이미 삭제됐다. 남은 것이 있으면 그중 최신 상태가 옳은 현재값이다.
      const remaining = this.fistGrantEffects(actor, effect.id);
      const top = remaining.length ? this.grantPayload(remaining.at(-1)).applied : null;
      if (top) {
        const update = { name: top.name };
        for (const key of this.FIST_MUTABLE_FIELDS) {
          if (top[key] !== undefined) update[`system.${key}`] = top[key];
        }
        await fistItem.update(update);
        return;
      }
      // 전부 사라졌다 → 스택의 바닥(최초 원본)으로.
      await this.restoreFistItems(actor);
    },

    /**
     * 그 액터의 장비 변경 표식을 전부 지운다. 실제 되돌리기는 삭제 훅이 하므로
     * **여기서 복원 로직을 다시 쓰지 말 것** — 두 벌이 되면 반드시 갈린다.
     */
    async clearItemGrants(actor) {
      const ids = (actor?.effects ?? []).filter(e => this.grantPayload(e)).map(e => e.id);
      if (ids.length) await actor.deleteEmbeddedDocuments('ActiveEffect', ids);
      return ids.length;
    },

    /**
     * 맨손 데이터를 변경 전으로 되돌린다. 씬/전투 종료와 씬 컨트롤의 초기화가 공유하는
     * **단 하나의 복원 경로**다. 스냅샷이 없는 아이템은 건너뛴다.
     * @returns {number} 되돌린 아이템 수
     */
    async restoreFistItems(actor) {
      let restored = 0;
      for (const it of actor?.items ?? []) {
        if (it.type !== 'weapon') continue;
        const original = it.getFlag('dx3rd-emanim', 'fistOriginal');
        if (!original) continue;
        const update = { name: original.name || game.i18n.localize('DX3rd.Fist') };
        for (const key of this.FIST_MUTABLE_FIELDS) {
          if (original[key] !== undefined) update[`system.${key}`] = original[key];
        }
        await it.update(update);
        await it.unsetFlag('dx3rd-emanim', 'fistOriginal');
        restored++;
      }
      return restored;
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
      const fistItem = this.findFistItem(actor);

      if (fistItem) {
        // 덮어쓰기 전에 원본을 남긴다. 이것이 없으면 복원할 근거가 사라진다.
        //
        // **영구 변경은 예외다.** 《사이버 암》은 「그 씬 동안」이 아니라 **취득 시 영구**로
        // 맨손을 대체하므로(weapons 팩 문서: 「이 아이템은 [사이버 암] 이펙트 취득시 입수한다」)
        // 되돌릴 대상이 아니다. 스냅샷을 남기지 않으면 `restoreFistItems` 가 이 아이템을
        // 아예 건너뛴다 — 즉 「복원하지 않음」을 표현하는 방법이 「근거를 남기지 않음」이다.
        //
        // 그 뒤에 《파괴의 손톱》 같은 씬 한정 이펙트를 쓰면 그때 스냅샷이 찍히고, 복원의
        // 목적지는 기본 맨손이 아니라 **사이버 암 상태**가 된다. 그것이 원문대로다.
        if (!data.fistPermanent) await this.snapshotFistItem(fistItem);
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
        const applied = {
          name: newName,
          type: data.type || 'melee',
          skill: data.skill || 'melee',
          add: evaluatedAdd,
          attack: evaluatedAttack,
          guard: evaluatedGuard,
          range: evaluatedRange
        };
        await fistItem.update({
          'name': applied.name,
          'system.type': applied.type,
          'system.skill': applied.skill,
          'system.add': applied.add,
          'system.attack': applied.attack,
          'system.guard': applied.guard,
          'system.range': applied.range
        });
        // 영구 변경에는 표식을 붙이지 않는다 — 되돌릴 근거(스냅샷)가 없으므로 지울 수 있는
        // 표식을 두면 「지웠는데 아무 일도 안 일어나는」 거짓말이 된다.
        if (!data.fistPermanent) {
          await this.createGrantEffect(actor, item, {
            kind: 'fist',
            sourceItemId: item?.id ?? null,
            fistItemId: fistItem.id,
            order: Date.now(),
            applied
          });
        }
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
          },
          // 맨손이 없어 새로 만드는 경로다. 복원의 목적지는 「변경 전 값」이 아니라 기본 맨손이므로
          // 스냅샷에 기본치를 넣는다 — 넣지 않으면 이 아이템만 영영 복원 대상에서 빠진다.
          // 영구 변경은 위와 같은 이유로 스냅샷 자체를 두지 않는다.
          flags: data.fistPermanent ? {} : {
            'dx3rd-emanim': {
              fistOriginal: { name: fistName, ...this.defaultFistSystem() }
            }
          }
        };

        const [madeFist] = await actor.createEmbeddedDocuments('Item', [itemData]);
        if (!data.fistPermanent) {
          await this.createGrantEffect(actor, item, {
            kind: 'fist',
            sourceItemId: item?.id ?? null,
            fistItemId: madeFist?.id ?? null,
            order: Date.now(),
            applied: {
              name: newName,
              type: data.type || 'melee',
              skill: data.skill || 'melee',
              add: evaluatedAdd,
              attack: evaluatedAttack,
              guard: evaluatedGuard,
              range: evaluatedRange
            }
          });
        }
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

  // 장비 변경 표식이 사라지면 그 변경을 되돌린다.
  //
  // **삭제에만 반응한다.** `updateActiveEffect` 훅은 일부러 두지 않았다 — 비활성화는
  // 코어가 `appliedEffects` 에서 빼서 토큰 오버레이 아이콘만 끄고, 무기·맨손 데이터는
  // 그대로 두는 것이 이 표식의 규약이다. 여기에 disabled 반응을 더하면 「잠깐 꺼 두기」가
  // 곧 파괴가 되어, 껐다 켜도 생성물이 돌아오지 않는다. **되살리지 말 것.**
  //
  // 한 클라이언트만 쓴다(`game.user.id !== userId`). 전원이 돌면 같은 아이템 삭제를
  // 인원수만큼 시도해 경합한다.
  Hooks.on('deleteActiveEffect', async (effect, options, userId) => {
    if (game.user.id !== userId) return;
    const actor = effect?.parent;
    if (!actor?.items) return;
    const H = window.DX3rdUniversalHandler;
    if (!H?.grantPayload?.(effect)) return;
    try {
      await H.revertItemGrant(actor, effect);
    } catch (e) {
      console.error('DX3rd | 장비 변경 표식 정리 실패:', e);
    }
  });
})();
