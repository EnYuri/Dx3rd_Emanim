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
  });
})();
