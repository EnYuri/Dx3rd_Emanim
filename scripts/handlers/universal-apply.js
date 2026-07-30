// Universal handler - 대상 효과 적용(applyToTargets) & 방어리액션 후보 클러스터
// universal-handler.js 에서 분리. 반드시 그 파일 뒤에 로드되어 동일 객체에 믹스인된다.
// (applyToTargets / _applyItemAttributes / applySelfFrozenBuff / applySelfModifiers /
//  applyChosenItemEffect / applyEffectData / _applyEffectDataToActor /
//  _cleanDefenseReactionName / _getEffectsCompendiumIndex / _isDefenseReactionCandidate /
//  getDefenseReactionItems / _getDefaultDodgeRollData)
(function() {
  if (!window.DX3rdUniversalHandler) {
    console.error('DX3rd | universal-apply.js loaded before universal-handler.js; apply methods unavailable.');
    return;
  }

  Object.assign(window.DX3rdUniversalHandler, {
    /**
     * 실제로 적용할 값이 하나라도 있는 어트리뷰트 맵인지.
     * 시트는 사용자가 추가한 빈 행(key '-' / 값 공백)을 그대로 저장하므로,
     * "행이 있다"는 것만으로는 걸 게 있다는 뜻이 아니다. 이 구분을 하지 않으면
     * 자기 버프뿐인 이펙트(대상 탭이 비어 있음)를 콤보로 대상에게 써도
     * 보정이 하나도 없는 빈 AE(더미)가 대상에게 씌워진다.
     * @param {Object} attributes - system.effect.attributes 또는 system.attributes
     * @returns {boolean}
     */
    hasUsableAttribute(attributes) {
      return Object.values(attributes || {}).some(attribute =>
        attribute?.key && attribute.key !== '-' && String(attribute.value ?? '').trim() !== ''
      );
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
        const adapter = window.DX3rdItemEffectAdapter;
        if (adapter && !adapter.targetActionMatches(item, action, timing)) return;
        // 지금 발현 액션에서 걸 버킷의 액션. 항목별 「발현 액션」이 채널 기본과 다르게
        // 저작돼 있으면, 여기서 고른 액션의 항목만 대상에게 간다.
        const bucketAction = adapter
          ? (adapter.ACTIONS.has(action) ? action : adapter.eventAction(item, timing))
          : action;

        // getTarget 또는 scene 중 하나라도 체크되어 있는지 확인
        const getTarget = item.system?.getTarget || false;
        const scene = item.system?.scene || false;
        if (!getTarget && !scene) return;

        // 발현·소멸 타이밍은 **그 버킷의 것**을 본다. 채널 필드(system.effect.runTiming) 하나로
        // 게이트를 걸면, 사용 버킷과 공격 버킷이 한 채널에 있을 때 한쪽은 어느 발현점에도
        // 걸리지 못하고 조용히 죽는다(bucketLifecycle 주석 참조).
        const lifecycle = adapter
          ? adapter.bucketLifecycle(item, 'target', bucketAction)
          : {runTiming: item.system?.effect?.runTiming ?? '-', disable: item.system?.effect?.disable || '-'};

        // runTiming이 '-'가 아닌 경우, 타이밍이 일치하는지 확인
        if (lifecycle.runTiming !== '-' && lifecycle.runTiming !== timing) {
          return;
        }

        // 소멸 타이밍이 notCheck인 경우 applied 되지 않아야 함
        if (lifecycle.disable === 'notCheck') {
          return;
        }

        // 대상 탭의 어트리뷰트 중 이 발현 액션의 버킷만. 걸 값이 하나도 없으면 여기서
        // 끝낸다 — 자기 버프만 있는 이펙트(대상 탭 비어 있음)를 콤보로 대상에게 사용해도
        // 빈 AE가 대상에게 붙지 않도록 한다.
        const targetAttributes = adapter
          ? adapter.targetBucketAttributes(item, bucketAction, timing)
          : (item.system.effect?.attributes || {});
        if (!this.hasUsableAttribute(targetAttributes)) {
          window.DX3rdDebug.log('DX3rd | applyToTargets skipped (no usable target attribute):', item.name);
          return;
        }

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
              window.DX3rdDebug.log('DX3rd | GM registered target apply (afterDamage):', {
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
              window.DX3rdDebug.log('DX3rd | Target apply registration sent to GM (afterDamage):', targetActor.name);
            }
          }
        } else {
          // instant, afterSuccess, 또는 forcedTargets가 있는 afterDamage: 즉시 적용
          for (const targetActor of targetActors) {
            await this.dispatchItemAttributes(actor, item, targetActor, targetAttributes);
          }
        }
      } catch (e) {
        console.error('DX3rd | UniversalHandler.applyToTargets failed', e);
      }
    },

    /**
     * 대상 액터에 아이템 어트리뷰트를 적용하되, 쓸 권한이 있는 클라이언트가 실행하게 한다.
     * 남의 액터에 AE 를 직접 만들면 권한 오류로 실패하므로, 쓸 수 없으면 소켓으로 넘긴다.
     * 반대로 내가 소유한 대상(자기 자신 포함)은 로컬에서 처리한다 — GM 이 접속해 있지 않아도
     * 적용되고, 사용 시점의 런타임 입력(actor._dx3rdRuntimeInput: [소비HP] 등)이
     * 이 클라이언트에만 존재하므로 로컬 평가여야 값이 살아 있다.
     * @param {Actor} actor - 사용 액터
     * @param {Item} item - 사용 아이템
     * @param {Actor} targetActor - 적용 대상
     * @param {Object} targetAttributes - 적용할 어트리뷰트(원본 수식 그대로)
     */
    async dispatchItemAttributes(actor, item, targetActor, targetAttributes) {
      if (!targetActor) return;
      if (game.user.isGM || targetActor.isOwner) {
        await this._applyItemAttributes(actor, item, targetActor, targetAttributes);
        return;
      }
      window.DX3rdSocketRouter.emit({
        type: 'applyItemAttributes',
        payload: {
          sourceActorId: actor.id,
          itemId: item.id,
          targetActorId: targetActor.id,
          targetAttributes: targetAttributes
        }
      });
      window.DX3rdDebug.log('DX3rd | Apply attributes request sent via socket for:', targetActor.name);
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

      // 한 아이템의 자기 보정(system.attributes)과 대상 보정(system.effect.attributes)은
      // 소멸 타이밍(active.disable / effect.disable)도 의미도 다른 별개의 채널인데, 키가
      // `applied_<itemId>` 하나뿐이라 **시전자가 자신을 타겟으로 잡으면 서로 덮어썼다** —
      // handleItemUse 는 자기 보정(2단계) → 대상 보정(3단계) 순이므로 자기 버프가 조용히
      // 사라지고 대상 쪽 수명만 남았다. 채널마다 키를 나누고 조회도 채널로 좁힌다.
      const channel = opts.channel === 'self' ? 'self' : 'target';
      // 같은 채널 안에서도 발현 액션이 다른 버킷은 서로 다른 AE 로 남아야 한다 — 키 하나를
      // 공유하면 나중에 걸린 쪽이 앞의 것을 덮어써 지운다. 실제로 그런 아이템이 있다:
      // 무기는 판정 다이얼로그의 선언(action:'use')과 그 무기로 공격(action:'attack')이 둘 다
      // 발현점이므로, 「선언하면 +1 / 공격 시 +2」를 나눠 저작하면 공격이 선언분을 지웠다.
      // 버킷은 넘어온 항목의 실효 발현 액션으로 판별한다(항목의 action 필드가 소켓 페이로드에도
      // 그대로 실려 오므로 별도 인자를 배선할 필요가 없다). 채널 기본 버킷은 지금까지의 키를
      // 그대로 쓴다 — 레거시 AE 와 키가 어긋나면 소멸 훅이 옛것을 못 찾는다.
      const adapter = window.DX3rdItemEffectAdapter;
      const entries = Object.values(targetAttributes || {});
      const effective = new Set(entries.map(attr =>
        adapter ? adapter.attributeAction(item, channel, attr) : null));
      const channelDefault = adapter ? adapter.channelAction(item, channel) : null;
      const single = effective.size === 1 ? [...effective][0] : null;
      const bucketAction = single && single !== channelDefault ? single : null;
      const bucketSuffix = {activation: 'act_', use: 'use_', attack: 'atk_'}[bucketAction] || '';
      let appliedKey = channel === 'self'
        ? `applied_self_${bucketSuffix}${item.id}`
        : `applied_${bucketSuffix}${item.id}`;

      // 기존 AE 확인 (같은 아이템·같은 채널이면 키 유지하고 내용만 교체).
      // 단 'toggle:' 파생 AE 는 DX3rdAppliedToggle 이 소유한다 — 같은 아이템에서 왔다는 이유로
      // 그 키를 집어 덮어쓰면, 동결값이 다음 sync 에 되돌려지거나(payloadChanged) 걸 보정이
      // 없을 때 아래 분기가 남의 토글 AE 를 지운다.
      // 채널 표기가 없는 구버전 AE 는 대상 채널로 본다(그때는 대상 경로만 이 키를 만들었고,
      // 자기 동결 AE 는 새 키로 옮겨 가므로 잘못 집을 일이 없다).
      const existingEff = targetActor.effects.find(e => {
        if (String(e.getFlag?.('dx3rd-emanim', 'appliedKey') || '').startsWith('toggle:')) return false;
        const applied = e.getFlag?.('dx3rd-emanim', 'applied');
        if (applied?.itemId !== item.id) return false;
        if ((applied?.channel === 'self' ? 'self' : 'target') !== channel) return false;
        // 버킷까지 같아야 같은 AE 다(활성화 버킷과 기본 버킷은 공존한다).
        return (applied?.action || null) === bucketAction;
      });
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
        channel,
        action: bucketAction,
        name: item.name,
        img: item.img,
        source: actor.name,
        timestamp: Date.now(),
        // 수명도 버킷의 것이다. 카드마다 소멸 타이밍을 나눠 저작할 수 있으므로 채널 필드를
        // 직접 읽으면 다른 카드의 수명으로 사라진다(disable-hooks 는 이 값을 1순위로 본다).
        disable: opts.disable ?? (adapter
          ? adapter.bucketLifecycle(item, channel, bucketAction || channelDefault).disable
          : (channel === 'self'
            ? (item.system?.active?.disable ?? '-')
            : (item.system.effect?.disable ?? '-'))),
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
        // 키 목록은 DX3rdFormulaEvaluator.ROLL_TIME_KEYS 단일 정의를 쓴다.
        const prepared = window.DX3rdFormulaEvaluator.prepareRollFormula(attrData.value, item, item.actor);
        const evaluated = window.DX3rdFormulaEvaluator.isRollTimeKey(key) && window.DX3rdFormulaEvaluator.hasDice(prepared)
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

      // 소켓으로 받은 페이로드까지 포함해, 실제 보정이 하나도 남지 않았으면 AE를 만들지 않는다.
      // 단 같은 아이템의 AE가 이미 걸려 있었다면 지운다 — 예전에는 빈 AE로 덮어써서
      // 무효화됐으므로, 그냥 return 하면 옛 보정이 남는 것으로 동작이 바뀐다.
      if (Object.keys(appliedEffect.attributes).length === 0) {
        window.DX3rdDebug.log('DX3rd | _applyItemAttributes skipped (nothing to apply):', item.name, '→', targetActor.name);
        if (existingEff) await window.DX3rdAppliedEffects.remove(targetActor, appliedKey);
        return;
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
    async applySelfFrozenBuff(actor, item, action = null) {
      // 항목별 「발현 액션」으로 갈라진 버킷 중, 지금 액션에서 동결할 것만 고른다.
      // 「활성화」로 저작된 항목은 토글 AE(DX3rdAppliedToggle)가 들고 있으므로 제외된다 —
      // 여기서 함께 걸면 같은 보정이 두 번 붙는다.
      const adapter = window.DX3rdItemEffectAdapter;
      const attrs = adapter
        ? adapter.selfFrozenAttributes(item, action)
        : item.system?.attributes;
      if (!attrs || Object.keys(attrs).length === 0) return;
      // 수명(active.disable 또는 그 버킷의 오버라이드)은 _applyItemAttributes 가 버킷에서
      // 직접 해석한다 — 여기서 채널 값을 못 박으면 버킷별 소멸 타이밍이 무시된다.
      await this._applyItemAttributes(actor, item, actor, attrs, {channel: 'self'});
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
     *
     * opts.forceToggle: applyMode 와 무관하게 토글 채널을 쓴다. 자기 보정의 액션이 '활성화'인
     *   아이템(상시 이펙트 등)을 직접 사용해 켜는 경로가 쓴다 — 이런 아이템은 컴펜디움 기본값이
     *   applyMode='onUse' 라서 그대로 두면 동결 AE만 걸리고 active.state 는 꺼진 채 남는다.
     *   시트의 「자신 지속 효과」 표시와 콤보의 지속 판정이 active.state 를 읽으므로,
     *   "활성화" 의미로 발동한 것은 반드시 토글이어야 한다.
     * opts.action: 지금 발현 액션('use' | 'attack'). 항목별 「발현 액션」으로 갈라진 동결
     *   버킷 중 어느 것을 걸지 정한다. 넘기지 않으면 활성화가 아닌 항목 전부를 건다(레거시).
     * @param {Actor} actor - 사용 액터(=대상)
     * @param {Item} item
     * @param {Object} [opts]
     * @param {boolean} [opts.forceToggle=false]
     * @param {string|null} [opts.action=null]
     * @returns {boolean} active.state를 켰으면 true
     */
    async applySelfModifiers(actor, item, { forceToggle = false, action = null } = {}) {
      const active = item.system?.active || {};
      const applyMode = active.applyMode || 'onUse';
      // 토글 타입(effect/spell/psionic/combo)의 자기 보정은 actor.js 자체계산에서 빠지고
      // 토글 AE 로만 합산된다. 그런데 spell/psionic/combo 는 template.json 에 applyMode 필드가
      // 아예 없어 기본값 'onUse'(동결)로 떨어졌다. 그 상태에서 뒤늦게 active.state 가 켜지면
      // (spell-handler.ensureActivated — runTiming 게이트도 없다 / 채팅 발동 버튼) 같은 보정이
      // toggle:<id> AE 로 한 번 더 생겨 그대로 이중 가산된다. 두 AE 는 키가 달라 upsert 로도
      // 합쳐지지 않는다. → applyMode 를 저작할 수 없는 토글 타입은 토글 채널로 고정한다.
      // 대가로 이 타입들은 [소비HP] 같은 런타임 입력을 동결하지 못하지만(재평가 시 0),
      // 그건 원래 afterSuccess/afterDamage 발동점에서도 마찬가지다(applySelfFrozenBuff 주석 (1)).
      const toggleTypes = window.DX3rdAppliedToggle?.TOGGLE_TYPES || ['effect', 'spell', 'psionic', 'combo'];
      const toggleChannelOnly = toggleTypes.includes(item.type) && !('applyMode' in active);
      const adapter = window.DX3rdItemEffectAdapter;
      // 항목별 「발현 액션」 때문에 한 아이템이 활성화 버킷과 동결 버킷을 동시에 가질 수 있다.
      // 두 버킷은 서로 다른 AE(toggle:<id> / applied_self_<id>)에 저장되고 항목이 겹치지
      // 않으므로(selfFrozenAttributes / appliesWhileActive) 이중 가산 없이 함께 걸린다.
      const hasActivationBucket = adapter ? adapter.hasExplicitBucket(item, 'self', 'activation') : false;
      if (!forceToggle && !toggleChannelOnly && applyMode === 'onUse') {
        // active.state 는 '활성화' 채널의 상태다. 동결 채널을 타는 아이템이 그걸 켜고 있으면
        // 잔재다(구버전 장착 훅이 켜 둔 선언형 장비, 시트 체크박스). 그대로 두면 같은 보정이
        // 두 번 센다 — 장비는 actor.js activeItems 자체계산이, 이펙트류는 toggle:<id> AE 가
        // 각각 더하는데 여기서 동결 AE 까지 걸리기 때문이다. 켜져 있으면 내리고 건다.
        // 단 「활성화」로 저작된 항목이 섞여 있으면 그 버킷의 상태가 곧 active.state 다 —
        // 내리면 그쪽이 죽는다.
        if (item.system?.active?.state === true && !hasActivationBucket) {
          await item.update({ 'system.active.state': false });
        }
        await this.applySelfFrozenBuff(actor, item, action);
        return false;
      }
      // 토글 채널이라도 **이 액션에 토글 버킷이 없으면** 상태를 건드리지 않는다. 예: 상시
      // 무기(applyMode='toggle')에 「공격 시」 보정을 저작한 경우 — 여기서 state 를 켜면
      // 장착 중 상시 버킷이 공격만으로 함께 터지고, 장비는 장착이 상태의 원본이라 표시도
      // 어긋난다. 걸 것은 그 액션의 동결 버킷뿐이다.
      // forceToggle 은 호출부가 "이 발동은 활성화를 포함한다"고 이미 판정한 것이므로 예외다
      // (useMeansActivation — 상시 이펙트를 직접 사용해 켜는 경로).
      if (!forceToggle && !(adapter?.selfToggleBucketMatches?.(item, action) ?? true)) {
        await this.applySelfFrozenBuff(actor, item, action);
        return false;
      }
      await item.update({ 'system.active.state': true });
      // 토글 채널이어도 「사용/공격 시」로 저작된 항목은 토글 AE 에 들어가지 않으므로
      // 여기서 동결로 걸어 준다(명시 저작 항목만 → 미지정 항목과 겹치지 않는다).
      if (adapter?.hasFrozenSelfBucket?.(item, action)) {
        await this.applySelfFrozenBuff(actor, item, action);
      }
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

      const targetAttributes = item.system?.effect?.attributes || {};
      const selfAttributes = item.system?.attributes || {};
      const hasTargetEffect = this.hasUsableAttribute(targetAttributes);
      const hasSelfEffect = this.hasUsableAttribute(selfAttributes);
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
          disable: item.system?.active?.disable ?? '-',
          channel: 'self'
        });
        return true;
      }

      // 아이템을 직렬화해 applyEffectData 로 보내지 않는다. 그 경로는 원본 Item 을 잃어
      //  (1) 수식을 item=null 로 평가하므로 [level]/[Lv]/[레벨] 이 치환되지 않아 0 으로 떨어지고,
      //  (2) attack/damage_roll 의 label(fist/melee/ranged)을 key 로 덮어써 한정이 풀리며,
      //  (3) 권한 분기가 없어 남의 액터(적 등)에는 쓰기가 실패한다.
      // 사용 파이프라인(applyToTargets)과 같은 단일 경로로 보낸다.
      for (const target of targets) {
        const targetActor = target.actor;
        if (!targetActor) continue;
        await this.dispatchItemAttributes(actor, item, targetActor, targetAttributes);
      }
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

        // 빈 행만 있는 경우도 "걸 게 없음"으로 본다(빈 AE 방지).
        if (!this.hasUsableAttribute(targetAttributes)) {
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

      // 기존 AE 확인 (같은 아이템 ID면 키 유지하고 덮어쓰기).
      // _applyItemAttributes 와 같은 이유로 'toggle:' 파생 AE 는 제외한다 —
      // 그 키는 DX3rdAppliedToggle 소유라, 집어 덮어쓰면 다음 sync 에 되돌려지거나
      // 걸 보정이 없을 때 아래 분기가 남의 토글 AE 를 지운다.
      const existingEff = itemData.id
        ? targetActor.effects.find(e =>
          !String(e.getFlag?.('dx3rd-emanim', 'appliedKey') || '').startsWith('toggle:')
          && e.getFlag?.('dx3rd-emanim', 'applied')?.itemId === itemData.id)
        : null;
      if (existingEff) {
        appliedKey = existingEff.getFlag('dx3rd-emanim', 'appliedKey') || appliedKey;
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

        // key 는 필수. label 은 원본을 보존한다(_applyItemAttributes 와 같은 규약).
        // 예전에는 stat_* 이외의 label 을 key 로 덮어썼는데, 그러면 attack/damage_roll 의
        // 서브버킷(fist/melee/ranged)이 사라져 소비부(actor.js bucket)가 '_'(무한정) 로
        // 흘려보낸다 → 백병 한정 보정이 사격·맨손까지 올려주는 과적용이 된다.
        const key = attrData.key;
        if (!key || key === '-') continue;
        const rawLabel = (attrData.label && attrData.label !== '-') ? attrData.label : null;

        // 채팅 카드 등의 직렬화 경로도 발동형 롤 수식은 숫자로 동결하지 않는다.
        // 키 목록은 DX3rdFormulaEvaluator.ROLL_TIME_KEYS 단일 정의를 쓴다.
        const prepared = window.DX3rdFormulaEvaluator?.prepareRollFormula
          ? window.DX3rdFormulaEvaluator.prepareRollFormula(attrData.value, null, actor)
          : String(attrData.value ?? '0');
        const evaluated = window.DX3rdFormulaEvaluator?.isRollTimeKey?.(key)
          && window.DX3rdFormulaEvaluator?.hasDice?.(prepared)
          ? prepared
          : (window.DX3rdFormulaEvaluator?.evaluate
            ? window.DX3rdFormulaEvaluator.evaluate(attrData.value, null, actor)
            : Number(attrData.value) || 0);

        // 같은 key 의 서로 다른 label 이 덮어쓰지 않도록 저장 키를 key:label 조합으로 쓴다.
        const storageKey = rawLabel ? `${key}:${rawLabel}` : key;
        appliedEffect.attributes[storageKey] = {
          key,
          label: rawLabel,
          value: evaluated
        };
      }

      // 실제 보정이 하나도 남지 않았으면 AE를 만들지 않는다(빈 더미 AE 방지).
      // 이미 걸려 있던 같은 아이템의 AE는 지운다(빈 AE로 덮어쓰던 기존 무효화 동작 유지).
      if (Object.keys(appliedEffect.attributes).length === 0) {
        window.DX3rdDebug.log('DX3rd | _applyEffectDataToActor skipped (nothing to apply):', itemData.name, '→', targetActor.name);
        if (existingEff) await window.DX3rdAppliedEffects.remove(targetActor, appliedKey);
        return;
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
      // 어트리뷰트는 **자기 채널(system.attributes)만** 본다.
      // system.effect.attributes 는 대상에게 거는 채널이라, 그쪽까지 긁으면
      // 「상대의 닷지 다이스를 깎는」/「상대의 가드치를 깎는」 공격 이펙트(강마의 번개,
      // 가드 크래시, 침투 등 40건)가 전부 방어 리액션 후보로 올라온다.
      // 아군에게 거는 가드 지원 이펙트는 타이밍이 리액션이면 directTiming 으로 잡힌다.
      const selfAttrs = {
        ...(compSystem.attributes || {}),
        ...(system.attributes || {})
      };
      const attrText = Object.values(selfAttrs).map(attr => {
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
      // 소진된 것을 목록에서 지울지는 월드 설정이 정한다. 남길 때는 이름 뒤에 「소진」을
      // 붙여, 고를 수는 있지만 원래는 못 쓰는 것이라는 사실이 드롭다운에서 바로 보이게 한다.
      const allowExhausted = window.DX3rdItemExhausted?.allowExhaustedUse?.() !== false;
      const items = [];
      for (const item of actor.items) {
        const compendiumItem = compendiumIndex.get(this._cleanDefenseReactionName(item.name));
        if (!this._isDefenseReactionCandidate(item, compendiumItem)) continue;
        const exhausted = window.DX3rdItemExhausted?.isItemExhausted(item) || false;
        if (exhausted && !allowExhausted) continue;

        const name = this._cleanDefenseReactionName(item.name);
        items.push({
          id: item.id,
          type: item.type,
          name: exhausted ? `${name} (${game.i18n.localize('DX3rd.Exhausted')})` : name,
          exhausted,
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

    /**
     * getDefenseReactionItems 결과를 드롭다운 optgroup 용으로 타입별로 묶는다.
     * 각 그룹 안의 순서는 원본(타이밍 → 이름)을 그대로 유지한다.
     * @param {Array} items - getDefenseReactionItems 반환값
     * @returns {Array<{type: string, label: string, items: Array}>}
     */
    groupDefenseReactionItems(items) {
      const labels = {
        combo: 'DX3rd.Combo',
        effect: 'DX3rd.Effect',
        psionic: 'DX3rd.Psionic'
      };
      // 표시 순서: 콤보 → 이펙트 → 사이오닉
      return ['combo', 'effect', 'psionic']
        .map(type => ({
          type,
          label: game.i18n.localize(labels[type]),
          items: (items || []).filter(item => item.type === type)
        }))
        .filter(group => group.items.length > 0);
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
  });
})();
