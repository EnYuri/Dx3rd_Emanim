/**
 * DX3rd 상태이상 관리
 * 기존 Foundry VTT의 기본 상태이상을 제거하고 DX3rd 전용 상태이상을 설정합니다.
 */

/**
 * 상태이상 적용 핸들러
 */
// 취소 시 메시지 출력 방지를 위한 플래그
let _cancellingCondition = false;

/** 액터만 스피커로 반환 (token 미지정 → GM 포함 모든 클라이언트에서 액터 초상화 사용, lichsoma-speaker-selecter 호환) */
function getActorOnlySpeaker(actor) {
  const s = ChatMessage.getSpeaker({ actor });
  return { ...s, token: null, scene: null };
}

/**
 * 상태이상 입력 다이얼로그(확인/취소) 공용 헬퍼.
 * 레거시 이전 시트 `Dialog`를 AppV2 `DialogV2`로 대체하되 동작(확인 시 폼 읽기, 취소 시 이펙트 제거,
 * X 닫기 시 콜백 미실행)은 원본과 동일하게 유지한다.
 * @param {object} opts
 * @param {string} opts.title            창 제목
 * @param {string} opts.content          다이얼로그 HTML
 * @param {(root: HTMLElement) => Promise<void>|void} opts.onConfirm  확인 콜백. 인자는 다이얼로그 루트 엘리먼트.
 * @param {() => Promise<void>|void} opts.onCancel                    취소(확인 아님) 콜백.
 */
function _showConditionDialog({ title, content, onConfirm, onCancel }) {
  const DialogV2 = foundry.applications?.api?.DialogV2;
  if (!DialogV2) {
    ui.notifications.error(game.i18n.localize('DX3rd.DialogV2Unavailable'));
    return;
  }
  new DialogV2({
    window: { title },
    content,
    buttons: [
      {
        action: 'confirm',
        icon: 'fas fa-check',
        label: game.i18n.localize("DX3rd.Confirm"),
        default: true,
        callback: async (event, button, dialog) => { if (onConfirm) await onConfirm(dialog.element); }
      },
      {
        action: 'cancel',
        icon: 'fas fa-times',
        label: game.i18n.localize("DX3rd.Cancel"),
        callback: async () => { if (onCancel) await onCancel(); }
      }
    ]
  }).render(true);
}

/**
 * 토큰에 Death Mark 오버레이 추가
 */
async function addDeathMarkToToken(token) {
  if (!token || !canvas.ready) return;
  
  // 이미 death mark가 있으면 추가하지 않음
  if (token.dx3rdDeathMark) return;
  
  try {
    const iconPath = game.settings.get('dx3rd-emanim', 'deathMarkIcon') || 'icons/svg/skull.svg';
    
    // PIXI Container 생성
    const container = new PIXI.Container();
    container.name = 'dx3rd-death-mark';
    
    // 중앙 위치 계산
    const centerX = token.w / 2;
    const centerY = token.h / 2;
    
    // 아이콘 크기
    const iconSize = Math.min(token.w, token.h);
    
    // 스프라이트 생성
    // v13/v14 호환: foundry.canvas.loadTexture 폴백 처리
    const _loadTexture = foundry.canvas?.loadTexture ?? globalThis.loadTexture;
    const texture = await _loadTexture(iconPath);
    const sprite = new PIXI.Sprite(texture);
    
    // 스프라이트 크기 및 위치 조정
    sprite.width = iconSize;
    sprite.height = iconSize;
    sprite.anchor.set(0.5);
    sprite.x = centerX;
    sprite.y = centerY;
    
    // 컨테이너에 추가
    container.addChild(sprite);
    
    // 토큰에 추가
    token.addChild(container);
    token.dx3rdDeathMark = container;
  } catch (error) {
    console.error('DX3rd | Failed to add death mark:', error);
  }
}

/**
 * 토큰에서 Death Mark 오버레이 제거
 */
function removeDeathMarkFromToken(token) {
  if (!token || !token.dx3rdDeathMark) return;
  
  try {
    const markContainer = token.dx3rdDeathMark;
    token.removeChild(markContainer);
    markContainer.destroy({ children: true });
    token.dx3rdDeathMark = null;
  } catch (error) {
    console.error('DX3rd | Failed to remove death mark:', error);
  }
}

/**
 * suppress(시각 동기화) 경로에서도 팔레트 경로와 동일한 "생성 시 기계적 부수효과"를 적용한다.
 * 채팅 메시지/다이얼로그 없이, 상태에 종속된 부수효과만 반영한다.
 * - dead: 토큰에 death mark 추가 + 타 클라이언트 동기화(handleConditionToggle의 dead 분기와 동일)
 * - dazed: dice -2 applied 효과(handleConditionToggle의 dazed 분기와 동일)
 * (berserk의 파괴적/연쇄 효과나 poisoned 랭크 다이얼로그 등은 시각 동기화 경로에서 실행하지 않는다 —
 *  이는 팔레트/아이템 경로에서만 적용된다.)
 */
async function applyConditionCreateSideEffects(actor, conditionId) {
  if (!actor) return;
  if (conditionId === "dead") {
    if (canvas.scene) {
      const tokens = canvas.scene.tokens.filter(t => t.actorId === actor.id);
      for (const tokenDoc of tokens) {
        const tokenObj = tokenDoc.object;
        if (tokenObj) {
          await addDeathMarkToToken(tokenObj);
          tokenObj.refresh();
          game.socket.emit('system.dx3rd-emanim', {
            type: 'addDeathMark',
            data: { tokenId: tokenDoc.id, sceneId: canvas.scene.id }
          });
        }
      }
    }
  } else if (conditionId === "dazed") {
    await window.DX3rdAppliedEffects.set(actor, 'dazed', {
      name: game.i18n.localize('DX3rd.Dazed'),
      attributes: { dice: -2 },
      disable: '-'
    });
  }
}

async function handleConditionToggle(token, conditionId, isActive, triggerItemName, poisonedRank = null, specialTarget = null, suppressMessage = false) {
  const actor = token.actor;
  if (!actor) return;
  
  // 증오 처리
  if (conditionId === "hatred") {
    if (isActive) {
      // specialTarget이 있으면 다이얼로그 건너뛰고 바로 적용
      if (specialTarget) {
        await actor.update({
          "system.conditions.hatred.active": true,
          "system.conditions.hatred.target": specialTarget
        });
        
        // 채팅 메시지 출력
        let messageContent = `${game.i18n.localize("DX3rd.Hatred")}(${specialTarget}) ${game.i18n.localize("DX3rd.Apply")}`;
        if (triggerItemName) {
          const clean = String(triggerItemName).split('||')[0];
          messageContent = `${game.i18n.localize("DX3rd.Hatred")}(${specialTarget}) ${game.i18n.localize("DX3rd.Apply")} (${clean})`;
        }
        
        ChatMessage.create({
          content: `<div class="dx3rd-item-chat">${messageContent}</div>`,
          speaker: getActorOnlySpeaker(actor)
        });
        return;
      }
      
      // 현재 장면의 다른 토큰들 가져오기
      const currentScene = game.scenes.active;
      if (!currentScene) {
        ui.notifications.warn(game.i18n.localize('DX3rd.NoActiveScene'));
        const effect = actor.effects.find(e => e.statuses.has("hatred"));
        if (effect) await effect.delete();
        return;
      }
      
      // 자신을 제외한 공개된 토큰들 가져오기
      const otherTokens = currentScene.tokens
        .filter(t => t.actor && t.actor.id !== actor.id && !t.hidden)
        .map(t => ({ id: t.id, name: t.name }))
        .sort((a, b) => a.name.localeCompare(b.name, 'ko'));
      
      if (otherTokens.length === 0) {
        ui.notifications.warn(game.i18n.localize("DX3rd.NoHatredTarget"));
        const effect = actor.effects.find(e => e.statuses.has("hatred"));
        if (effect) await effect.delete();
        return;
      }
      
      // 드롭다운 옵션 생성
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
        .condition-rank-dialog {
          padding: 5px;
        }
        .condition-rank-dialog .form-group {
          display: flex;
          flex-direction: column;
          gap: 8px;
          margin-top: 0px;
          margin-bottom: 5px;
        }
        .condition-rank-dialog label {
          font-weight: bold;
          font-size: 14px;
        }
        .condition-rank-dialog select {
          padding: 4px;
          font-size: 14px;
          border: 1px solid #ccc;
          border-radius: 4px;
          background: white;
          color: black;
        }
        </style>
      `;
      
      _showConditionDialog({
        title: game.i18n.localize("DX3rd.Hatred"),
        content: template,
        onConfirm: async (root) => {
          const targetName = root.querySelector("#condition-target").value;
          await actor.update({
            "system.conditions.hatred.active": true,
            "system.conditions.hatred.target": targetName
          });

          // 채팅 메시지 출력
          const messageContent = `${game.i18n.localize("DX3rd.Hatred")}(${targetName}) ${game.i18n.localize("DX3rd.Apply")}`;

          ChatMessage.create({
            content: `<div class="dx3rd-item-chat">${messageContent}</div>`,
            speaker: getActorOnlySpeaker(actor)
          });
        },
        onCancel: async () => {
          _cancellingCondition = true;
          const effect = actor.effects.find(e => e.statuses.has("hatred"));
          if (effect) await effect.delete();
          _cancellingCondition = false;
        }
      });
    } else {
      // 해제: conditions 필드 원복은 항상 수행한다.
      // (시트 체크박스로 켠 뒤 다이얼로그를 취소한 경우 active 가 true 로 남아 오버레이와
      //  어긋나므로, _cancellingCondition 여부와 무관하게 false 로 되돌린다. active 가 이미
      //  false 면 no-op diff 라 팔레트 취소 경로에는 영향이 없다.)
      await actor.update({
        "system.conditions.hatred.active": false,
        "system.conditions.hatred.target": ""
      });

      // 채팅 메시지는 취소가 아니고 suppress 도 아닐 때만 출력
      if (!_cancellingCondition && !suppressMessage) {
        const messageContent = `${game.i18n.localize("DX3rd.Hatred")} ${game.i18n.localize("DX3rd.Clear")}`;

        ChatMessage.create({
          content: `<div class="dx3rd-item-chat">${messageContent}</div>`,
          speaker: getActorOnlySpeaker(actor)
        });
      }
    }
  }
  
  // 폭주 처리
  if (conditionId === "berserk") {
    if (isActive) {
      // 폭주 타입 옵션
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
      
      // specialTarget이 있으면 다이얼로그 건너뛰고 바로 적용
      if (specialTarget) {
        const selectedType = berserkTypes.find(t => t.value === specialTarget) || berserkTypes[0];
        
        const updates = {
          "system.conditions.berserk.active": true,
          "system.conditions.berserk.type": selectedType.value
        };
        
        // 기아(hunger) 타입이면 dice -5 패널티 적용
        if (selectedType.value === 'hunger') {
          await window.DX3rdAppliedEffects.set(actor, 'berserk_hunger', {
            name: game.i18n.localize('DX3rd.Mutation') + ': ' + game.i18n.localize('DX3rd.UrgeHunger'),
            attributes: {
              dice: -5
            },
            disable: '-'
          });
        }

        // 가학(tourture) 타입이면 attack -20 패널티 적용
        if (selectedType.value === 'tourture') {
          await window.DX3rdAppliedEffects.set(actor, 'berserk_tourture', {
            name: game.i18n.localize('DX3rd.Mutation') + ': ' + game.i18n.localize('DX3rd.UrgeTourture'),
            attributes: {
              attack: -20
            },
            disable: '-'
          });
        }
        
        // 자해(selfmutilation) 타입이면 HP -5 데미지 (경감 무시, 최대 HP까지만)
        if (selectedType.value === 'selfmutilation') {
          const currentHP = actor.system.attributes.hp.value || 0;
          const maxHP = actor.system.attributes.hp.max || 0;
          const damage = Math.min(5, currentHP);
          const newHP = Math.max(0, currentHP - damage);
          
          await actor.update({ "system.attributes.hp.value": newHP });
          
          // HP 데미지 메시지 출력
          let damageMessage = `${game.i18n.localize("DX3rd.Berserk")}(${selectedType.label}) ${game.i18n.localize("DX3rd.Apply")}: HP -${damage}`;
          if (triggerItemName) {
            const clean = String(triggerItemName).split('||')[0];
            damageMessage = `${game.i18n.localize("DX3rd.Berserk")}(${selectedType.label}) ${game.i18n.localize("DX3rd.Apply")}: HP -${damage} (${clean})`;
          }
          
          ChatMessage.create({
            content: `<div class="dx3rd-item-chat">${damageMessage}</div>`,
            speaker: getActorOnlySpeaker(actor)
          });
          
          // 폭주 상태이상만 제거 (메시지 없음)
          const effectsToRemove = actor.effects.filter(e => {
            const statuses = Array.from(e.statuses || []);
            return statuses.some(s => ['berserk'].includes(s));
          });
          
          // suppressMessage를 true로 설정하여 해제 메시지 방지
          window.DX3rdConditionTriggerMap = window.DX3rdConditionTriggerMap || new Map();
          for (const eff of effectsToRemove) {
            const key = `${actor.id}:berserk`;
            window.DX3rdConditionTriggerMap.set(key, { suppressMessage: true });
            await eff.delete();
          }

          // 폭주 이펙트 삭제 → deleteActiveEffect 훅이 berserk.active:false로 정리한다.
          // 여기서 updates(active:true)를 쓰면 훅의 active:false와 레이스가 나
          // orphan 플래그(아이콘 없이 active:true)가 남을 수 있으므로 재설정 없이 종료.
          return;
        }

        await actor.update(updates);
        
        // 채팅 메시지 출력
        let messageContent = `${game.i18n.localize("DX3rd.Berserk")}(${selectedType.label}) ${game.i18n.localize("DX3rd.Apply")}`;
        if (triggerItemName) {
          const clean = String(triggerItemName).split('||')[0];
          messageContent = `${game.i18n.localize("DX3rd.Berserk")}(${selectedType.label}) ${game.i18n.localize("DX3rd.Apply")} (${clean})`;
        }
        
        ChatMessage.create({
          content: `<div class="dx3rd-item-chat">${messageContent}</div>`,
          speaker: getActorOnlySpeaker(actor)
        });
        
        // 폭주 fear 타입이면 rigor도 함께 적용 (폭주 메시지 이후)
        if (selectedType.value === 'fear') {
          await actor.toggleStatusEffect("rigor", { active: true });
        }
        
        // 폭주 hatred 타입이면 일반 hatred도 함께 적용 (폭주 메시지 이후)
        if (selectedType.value === 'hatred') {
          await actor.toggleStatusEffect("hatred", { active: true });
        }
        
        return;
      }
      
      // 드롭다운 옵션 생성
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
        .condition-rank-dialog {
          padding: 5px;
        }
        .condition-rank-dialog .form-group {
          display: flex;
          flex-direction: column;
          gap: 8px;
          margin-top: 0px;
          margin-bottom: 5px;
        }
        .condition-rank-dialog label {
          font-weight: bold;
          font-size: 14px;
        }
        .condition-rank-dialog select {
          padding: 4px;
          font-size: 14px;
          border: 1px solid #ccc;
          border-radius: 4px;
          background: white;
          color: black;
        }
        </style>
      `;
      
      _showConditionDialog({
        title: game.i18n.localize("DX3rd.Berserk"),
        content: template,
        onConfirm: async (root) => {
              const berserkType = root.querySelector("#condition-type").value;
              const selectedType = berserkTypes.find(t => t.value === berserkType);
              
              const updates = {
                "system.conditions.berserk.active": true,
                "system.conditions.berserk.type": berserkType
              };
              
              // 기아(hunger) 타입이면 dice -5 패널티 적용
              if (berserkType === 'hunger') {
                await window.DX3rdAppliedEffects.set(actor, 'berserk_hunger', {
                  name: game.i18n.localize('DX3rd.Mutation') + ': ' + game.i18n.localize('DX3rd.UrgeHunger'),
                  attributes: {
                    dice: -5
                  },
                  disable: '-'
                });
              }

              // 가학(tourture) 타입이면 attack -20 패널티 적용
              if (berserkType === 'tourture') {
                await window.DX3rdAppliedEffects.set(actor, 'berserk_tourture', {
                  name: game.i18n.localize('DX3rd.Mutation') + ': ' + game.i18n.localize('DX3rd.UrgeTourture'),
                  attributes: {
                    attack: -20
                  },
                  disable: '-'
                });
              }
              
              // 자해(selfmutilation) 타입이면 HP -5 데미지 (경감 무시, 최대 HP까지만)
              if (berserkType === 'selfmutilation') {
                const currentHP = actor.system.attributes.hp.value || 0;
                const maxHP = actor.system.attributes.hp.max || 0;
                const damage = Math.min(5, currentHP);
                const newHP = Math.max(0, currentHP - damage);
                
                await actor.update({ "system.attributes.hp.value": newHP });
                
                // HP 데미지 메시지 출력
                let damageMessage = `${game.i18n.localize("DX3rd.Berserk")}(${selectedType.label}) ${game.i18n.localize("DX3rd.Apply")}: HP -${damage}`;
                if (triggerItemName) {
                  const clean = String(triggerItemName).split('||')[0];
                  damageMessage = `${game.i18n.localize("DX3rd.Berserk")}(${selectedType.label}) ${game.i18n.localize("DX3rd.Apply")}: HP -${damage} (${clean})`;
                }
                
                ChatMessage.create({
                  content: `<div class="dx3rd-item-chat">${damageMessage}</div>`,
                  speaker: getActorOnlySpeaker(actor)
                });
                
                // 폭주 상태이상만 제거 (메시지 없음)
                const effectsToRemove = actor.effects.filter(e => {
                  const statuses = Array.from(e.statuses || []);
                  return statuses.some(s => ['berserk'].includes(s));
                });
                
                // suppressMessage를 true로 설정하여 해제 메시지 방지
                window.DX3rdConditionTriggerMap = window.DX3rdConditionTriggerMap || new Map();
                for (const eff of effectsToRemove) {
                  const key = `${actor.id}:berserk`;
                  window.DX3rdConditionTriggerMap.set(key, { suppressMessage: true });
                  await eff.delete();
                }

                // 폭주 이펙트 삭제 → deleteActiveEffect 훅이 berserk.active:false로 정리한다.
                // 여기서 updates(active:true)를 쓰면 훅의 active:false와 레이스가 나
                // orphan 플래그(아이콘 없이 active:true)가 남을 수 있으므로 재설정 없이 종료.
                return;
              }

              await actor.update(updates);
              
              // 채팅 메시지 출력 (트리거 아이템 이름 반영)
              let messageContent = `${game.i18n.localize("DX3rd.Berserk")}(${selectedType.label}) ${game.i18n.localize("DX3rd.Apply")}`;
              if (triggerItemName) {
                const clean = String(triggerItemName).split('||')[0];
                messageContent = `${game.i18n.localize("DX3rd.Berserk")}(${selectedType.label}) ${game.i18n.localize("DX3rd.Apply")} (${clean})`;
              }
              
              ChatMessage.create({
                content: `<div class="dx3rd-item-chat">${messageContent}</div>`,
                speaker: getActorOnlySpeaker(actor)
              });
              
              // 폭주 fear 타입이면 rigor도 함께 적용 (폭주 메시지 이후)
              if (berserkType === 'fear') {
                await actor.toggleStatusEffect("rigor", { active: true });
              }
              
              // 폭주 hatred 타입이면 일반 hatred도 함께 적용 (폭주 메시지 이후)
              if (berserkType === 'hatred') {
                await actor.toggleStatusEffect("hatred", { active: true });
              }
        },
        onCancel: async () => {
          _cancellingCondition = true;
          const effect = actor.effects.find(e => e.statuses.has("berserk"));
          if (effect) await effect.delete();
          _cancellingCondition = false;
        }
      });
    } else {
      // 해제: 상태이상 필드 원복 + applied 효과 제거는 항상 수행한다.
      // (시트 체크박스로 켠 뒤 유형 다이얼로그를 취소한 경우 active 가 true 로 남는 것을 방지.
      //  active 가 이미 false 면 no-op diff.)
      await actor.update({
        "system.conditions.berserk.active": false,
        "system.conditions.berserk.type": "-"
      });
      await window.DX3rdAppliedEffects.removeMany(actor, ['berserk_hunger', 'berserk_tourture']);

      // 채팅 메시지는 취소가 아니고 suppress 도 아닐 때만 출력
      if (!_cancellingCondition && !suppressMessage) {
        const messageContent = `${game.i18n.localize("DX3rd.Berserk")} ${game.i18n.localize("DX3rd.Clear")}`;

        ChatMessage.create({
          content: `<div class="dx3rd-item-chat">${messageContent}</div>`,
          speaker: getActorOnlySpeaker(actor)
        });
      }
    }
  }
  
  // 공포 처리
  if (conditionId === "fear") {
    if (isActive) {
      // specialTarget이 있으면 다이얼로그 건너뛰고 바로 적용
      if (specialTarget) {
        await actor.update({
          "system.conditions.fear.active": true,
          "system.conditions.fear.target": specialTarget
        });
        
        // 채팅 메시지 출력
        let messageContent = `${game.i18n.localize("DX3rd.Fear")}(${specialTarget}) ${game.i18n.localize("DX3rd.Apply")}`;
        if (triggerItemName) {
          const clean = String(triggerItemName).split('||')[0];
          messageContent = `${game.i18n.localize("DX3rd.Fear")}(${specialTarget}) ${game.i18n.localize("DX3rd.Apply")} (${clean})`;
        }
        
        ChatMessage.create({
          content: `<div class="dx3rd-item-chat">${messageContent}</div>`,
          speaker: getActorOnlySpeaker(actor)
        });
        return;
      }
      
      // 현재 장면의 다른 토큰들 가져오기
      const currentScene = game.scenes.active;
      if (!currentScene) {
        ui.notifications.warn(game.i18n.localize('DX3rd.NoActiveScene'));
        const effect = actor.effects.find(e => e.statuses.has("fear"));
        if (effect) await effect.delete();
        return;
      }
      
      // 자신을 제외한 공개된 토큰들 가져오기
      const otherTokens = currentScene.tokens
        .filter(t => t.actor && t.actor.id !== actor.id && !t.hidden)
        .map(t => ({ id: t.id, name: t.name }))
        .sort((a, b) => a.name.localeCompare(b.name, 'ko'));
      
      if (otherTokens.length === 0) {
        ui.notifications.warn(game.i18n.localize('DX3rd.NoOtherToken'));
        const effect = actor.effects.find(e => e.statuses.has("fear"));
        if (effect) await effect.delete();
        return;
      }
      
      // 드롭다운 옵션 생성
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
        .condition-rank-dialog {
          padding: 5px;
        }
        .condition-rank-dialog .form-group {
          display: flex;
          flex-direction: column;
          gap: 8px;
          margin-top: 0px;
          margin-bottom: 5px;
        }
        .condition-rank-dialog label {
          font-weight: bold;
          font-size: 14px;
        }
        .condition-rank-dialog select {
          padding: 4px;
          font-size: 14px;
          border: 1px solid #ccc;
          border-radius: 4px;
          background: white;
          color: black;
        }
        </style>
      `;
      
      _showConditionDialog({
        title: game.i18n.localize("DX3rd.Fear"),
        content: template,
        onConfirm: async (root) => {
          const targetName = root.querySelector("#condition-target").value;
          await actor.update({
            "system.conditions.fear.active": true,
            "system.conditions.fear.target": targetName
          });

          // 채팅 메시지 출력
          let messageContent = `${game.i18n.localize("DX3rd.Fear")}(${targetName}) ${game.i18n.localize("DX3rd.Apply")}`;
          if (triggerItemName) {
            const clean = String(triggerItemName).split('||')[0];
            messageContent = `${game.i18n.localize("DX3rd.Fear")}(${targetName}) ${game.i18n.localize("DX3rd.Apply")} (${clean})`;
          }

          ChatMessage.create({
            content: `<div class="dx3rd-item-chat">${messageContent}</div>`,
            speaker: getActorOnlySpeaker(actor)
          });
        },
        onCancel: async () => {
          _cancellingCondition = true;
          const effect = actor.effects.find(e => e.statuses.has("fear"));
          if (effect) await effect.delete();
          _cancellingCondition = false;
        }
      });
    } else {
      // 해제: conditions 필드 원복은 항상 수행(시트 체크박스 켠 뒤 다이얼로그 취소 대비).
      // active 가 이미 false 면 no-op diff.
      await actor.update({
        "system.conditions.fear.active": false,
        "system.conditions.fear.target": ""
      });

      // 채팅 메시지는 취소가 아니고 suppress 도 아닐 때만 출력
      if (!_cancellingCondition && !suppressMessage) {
        const messageContent = `${game.i18n.localize("DX3rd.Fear")} ${game.i18n.localize("DX3rd.Clear")}`;

        ChatMessage.create({
          content: `<div class="dx3rd-item-chat">${messageContent}</div>`,
          speaker: getActorOnlySpeaker(actor)
        });
      }
    }
  }
  
  // 경직 처리
  if (conditionId === "rigor") {
    if (isActive) {
      await actor.update({
        "system.conditions.rigor.active": true
      });
      
      // 채팅 메시지 출력
      let messageContent = `${game.i18n.localize("DX3rd.Rigor")} ${game.i18n.localize("DX3rd.Apply")}`;
      if (triggerItemName) {
        const clean = String(triggerItemName).split('||')[0];
        messageContent = `${game.i18n.localize("DX3rd.Rigor")} ${game.i18n.localize("DX3rd.Apply")} (${clean})`;
      }
      
              ChatMessage.create({
                content: `<div class="dx3rd-item-chat">${messageContent}</div>`,
                speaker: getActorOnlySpeaker(actor)
              });
    } else {
      if (!_cancellingCondition) {
        await actor.update({
          "system.conditions.rigor.active": false
        });
        
        // 채팅 메시지 출력 (suppressMessage가 false일 때만)
        if (!suppressMessage) {
          const messageContent = `${game.i18n.localize("DX3rd.Rigor")} ${game.i18n.localize("DX3rd.Clear")}`;
          
          ChatMessage.create({
            content: `<div class="dx3rd-item-chat">${messageContent}</div>`,
            speaker: getActorOnlySpeaker(actor)
          });
        }
      }
    }
  }
  
  // 중압 처리
  if (conditionId === "pressure") {
    if (isActive) {
      await actor.update({
        "system.conditions.pressure.active": true
      });
      
      // 채팅 메시지 출력
      let messageContent = `${game.i18n.localize("DX3rd.Pressure")} ${game.i18n.localize("DX3rd.Apply")}`;
      if (triggerItemName) {
        const clean = String(triggerItemName).split('||')[0];
        messageContent = `${game.i18n.localize("DX3rd.Pressure")} ${game.i18n.localize("DX3rd.Apply")} (${clean})`;
      }
      
              ChatMessage.create({
                content: `<div class="dx3rd-item-chat">${messageContent}</div>`,
                speaker: getActorOnlySpeaker(actor)
              });
    } else {
      if (!_cancellingCondition) {
        await actor.update({
          "system.conditions.pressure.active": false
        });
        
        // 채팅 메시지 출력 (suppressMessage가 false일 때만)
        if (!suppressMessage) {
          const messageContent = `${game.i18n.localize("DX3rd.Pressure")} ${game.i18n.localize("DX3rd.Clear")}`;
          
          ChatMessage.create({
            content: `<div class="dx3rd-item-chat">${messageContent}</div>`,
            speaker: getActorOnlySpeaker(actor)
          });
        }
      }
    }
  }
  
  // 방심 처리
  if (conditionId === "dazed") {
    if (isActive) {
      // applied 효과 추가 (dice -2) - 네이티브 ActiveEffect
      await actor.update({ "system.conditions.dazed.active": true });
      await window.DX3rdAppliedEffects.set(actor, 'dazed', {
        name: game.i18n.localize('DX3rd.Dazed'),
        attributes: {
          dice: -2
        },
        disable: '-'
      });
      
      // 채팅 메시지 출력
      let messageContent = `${game.i18n.localize("DX3rd.Dazed")} ${game.i18n.localize("DX3rd.Apply")}`;
      if (triggerItemName) {
        const clean = String(triggerItemName).split('||')[0];
        messageContent = `${game.i18n.localize("DX3rd.Dazed")} ${game.i18n.localize("DX3rd.Apply")} (${clean})`;
      }
      
              ChatMessage.create({
                content: `<div class="dx3rd-item-chat">${messageContent}</div>`,
                speaker: getActorOnlySpeaker(actor)
              });
    } else {
      if (!_cancellingCondition) {
        // 상태이상과 applied 효과 모두 제거
        await actor.update({ "system.conditions.dazed.active": false });
        await window.DX3rdAppliedEffects.remove(actor, 'dazed');
        
        // 채팅 메시지 출력 (suppressMessage가 false일 때만)
        if (!suppressMessage) {
          const messageContent = `${game.i18n.localize("DX3rd.Dazed")} ${game.i18n.localize("DX3rd.Clear")}`;
          
          ChatMessage.create({
            content: `<div class="dx3rd-item-chat">${messageContent}</div>`,
            speaker: getActorOnlySpeaker(actor)
          });
        }
      }
    }
  }
  
  // 탑승 처리
  if (conditionId === "boarding") {
    if (isActive) {
      await actor.update({
        "system.conditions.boarding.active": true
      });
      
      // 채팅 메시지 출력
      let messageContent = `${game.i18n.localize("DX3rd.Boarding")} ${game.i18n.localize("DX3rd.Apply")}`;
      if (triggerItemName) {
        const clean = String(triggerItemName).split('||')[0];
        messageContent = `${game.i18n.localize("DX3rd.Boarding")} ${game.i18n.localize("DX3rd.Apply")} (${clean})`;
      }
      
              ChatMessage.create({
                content: `<div class="dx3rd-item-chat">${messageContent}</div>`,
                speaker: getActorOnlySpeaker(actor)
              });
    } else {
      if (!_cancellingCondition) {
        await actor.update({
          "system.conditions.boarding.active": false
        });
        
        // 채팅 메시지 출력 (suppressMessage가 false일 때만)
        if (!suppressMessage) {
          const messageContent = `${game.i18n.localize("DX3rd.Boarding")} ${game.i18n.localize("DX3rd.Clear")}`;
          
          ChatMessage.create({
            content: `<div class="dx3rd-item-chat">${messageContent}</div>`,
            speaker: getActorOnlySpeaker(actor)
          });
        }
      }
    }
  }
  
  // 은밀 처리
  if (conditionId === "stealth") {
    if (isActive) {
      await actor.update({
        "system.conditions.stealth.active": true
      });
      
      // 채팅 메시지 출력
      let messageContent = `${game.i18n.localize("DX3rd.Stealth")} ${game.i18n.localize("DX3rd.Apply")}`;
      if (triggerItemName) {
        const clean = String(triggerItemName).split('||')[0];
        messageContent = `${game.i18n.localize("DX3rd.Stealth")} ${game.i18n.localize("DX3rd.Apply")} (${clean})`;
      }
      
              ChatMessage.create({
                content: `<div class="dx3rd-item-chat">${messageContent}</div>`,
                speaker: getActorOnlySpeaker(actor)
              });
    } else {
      if (!_cancellingCondition) {
        await actor.update({
          "system.conditions.stealth.active": false
        });
        
        // 채팅 메시지 출력 (suppressMessage가 false일 때만)
        if (!suppressMessage) {
          const messageContent = `${game.i18n.localize("DX3rd.Stealth")} ${game.i18n.localize("DX3rd.Clear")}`;
          
          ChatMessage.create({
            content: `<div class="dx3rd-item-chat">${messageContent}</div>`,
            speaker: getActorOnlySpeaker(actor)
          });
        }
      }
    }
  }
  
  // 비행 처리
  if (conditionId === "fly") {
    if (isActive) {
      await actor.update({
        "system.conditions.fly.active": true
      });
      
      // 채팅 메시지 출력
      let messageContent = `${game.i18n.localize("DX3rd.Fly")} ${game.i18n.localize("DX3rd.Apply")}`;
      if (triggerItemName) {
        const clean = String(triggerItemName).split('||')[0];
        messageContent = `${game.i18n.localize("DX3rd.Fly")} ${game.i18n.localize("DX3rd.Apply")} (${clean})`;
      }
      
              ChatMessage.create({
                content: `<div class="dx3rd-item-chat">${messageContent}</div>`,
                speaker: getActorOnlySpeaker(actor)
              });
    } else {
      if (!_cancellingCondition) {
        await actor.update({
          "system.conditions.fly.active": false
        });
        
        // 채팅 메시지 출력 (suppressMessage가 false일 때만)
        if (!suppressMessage) {
          const messageContent = `${game.i18n.localize("DX3rd.Fly")} ${game.i18n.localize("DX3rd.Clear")}`;
          
          ChatMessage.create({
            content: `<div class="dx3rd-item-chat">${messageContent}</div>`,
            speaker: getActorOnlySpeaker(actor)
          });
        }
      }
    }
  }
  
  // 전투불능 처리
  if (conditionId === "dead") {
    if (isActive) {
      await actor.update({
        "system.conditions.defeated.active": true
      });
      
      // 현재 장면의 해당 액터의 모든 토큰에 death mark 추가
      if (canvas.scene) {
        const tokens = canvas.scene.tokens.filter(t => t.actorId === actor.id);
        for (const tokenDoc of tokens) {
          const tokenObj = tokenDoc.object;
          if (tokenObj) {
            await addDeathMarkToToken(tokenObj);
            tokenObj.refresh();
            
            // 다른 클라이언트에도 death mark 추가
            game.socket.emit('system.dx3rd-emanim', {
              type: 'addDeathMark',
              data: {
                tokenId: tokenDoc.id,
                sceneId: canvas.scene.id
              }
            });
          }
        }
      }
      
      // 채팅 메시지 출력
      let messageContent = `${game.i18n.localize("DX3rd.Defeated")} ${game.i18n.localize("DX3rd.Apply")}`;
      if (triggerItemName) {
        const clean = String(triggerItemName).split('||')[0];
        messageContent = `${game.i18n.localize("DX3rd.Defeated")} ${game.i18n.localize("DX3rd.Apply")} (${clean})`;
      }
      
              ChatMessage.create({
                content: `<div class="dx3rd-item-chat">${messageContent}</div>`,
                speaker: getActorOnlySpeaker(actor)
              });
    } else {
      if (!_cancellingCondition) {
        await actor.update({
          "system.conditions.defeated.active": false
        });
        
        // 현재 장면의 해당 액터의 모든 토큰에서 death mark 제거
        if (canvas.scene) {
          const tokens = canvas.scene.tokens.filter(t => t.actorId === actor.id);
          for (const tokenDoc of tokens) {
            const tokenObj = tokenDoc.object;
            if (tokenObj) {
              removeDeathMarkFromToken(tokenObj);
              tokenObj.refresh();
              
              // 다른 클라이언트에도 death mark 제거
              game.socket.emit('system.dx3rd-emanim', {
                type: 'removeDeathMark',
                data: {
                  tokenId: tokenDoc.id,
                  sceneId: canvas.scene.id
                }
              });
            }
          }
        }
        
        // 채팅 메시지 출력 (suppressMessage가 false일 때만)
        if (!suppressMessage) {
          const messageContent = `${game.i18n.localize("DX3rd.Defeated")} ${game.i18n.localize("DX3rd.Clear")}`;
          
          ChatMessage.create({
            content: `<div class="dx3rd-item-chat">${messageContent}</div>`,
            speaker: getActorOnlySpeaker(actor)
          });
        }
      }
    }
  }
  
  // 사독 처리
  if (conditionId === "poisoned") {
    if (isActive) {
      // 전역 대기 큐에서 트리거와 랭크 후보 회수
      let triggerFromMap = null;
      let rankFromMap = null;
      if (window.DX3rdConditionTriggerMap) {
        const key = `${actor.id}:${conditionId}`;
        triggerFromMap = window.DX3rdConditionTriggerMap.get(key) || null;
        // poisonedRank 별도 맵이 없으니 trigger 맵을 재사용해 전달 불가 → 아래에서 triggerItemName 인자로 받은 값을 사용
      }
      // handleConditionToggle 인자의 triggerItemName 우선 사용
      const triggerName = triggerItemName || triggerFromMap || null;
      // 익스텐드에서 랭크를 전달했다면 다이얼로그 없이 적용
      // 매개변수로 직접 전달된 poisonedRank를 우선 사용 (이미 사독이 있을 때)
      const passedRank = poisonedRank || game?.dx3rd?.pendingPoisonedRank || null;
      if (passedRank) {
        // 기존 랭크와 비교하여 높은 쪽을 유지
        const currentRank = Number(actor.system?.conditions?.poisoned?.value || 0);
        let newRank = 0;
        try {
          const clean = String(passedRank).trim();
          // UniversalHandler에서 숫자로 전달하는 것이 원칙이지만, 혹시 문자열 포뮬러가 도착하면 여기서도 한 번 더 평가 시도
          if (typeof window.DX3rdFormulaEvaluator?.evaluate === 'function' && /\[/.test(clean)) {
            const dummyItem = { type: 'effect', system: { level: { value: 1 } } };
            const evaluated = window.DX3rdFormulaEvaluator.evaluate(clean, dummyItem, actor);
            newRank = Number(evaluated) || 0;
          } else {
            newRank = Number(clean) || 0;
          }
        } catch (e) {
          console.warn('DX3rd | Failed to evaluate poisonedRank at hook, fallback to number:', e);
          newRank = Number(passedRank) || 0;
        }
        if (newRank > currentRank) {
          await actor.update({
            "system.conditions.poisoned.active": true,
            "system.conditions.poisoned.value": newRank
          });
          let msg = `${game.i18n.localize("DX3rd.Poisoned")}(Rank.${newRank}) ${game.i18n.localize("DX3rd.Apply")}`;
          if (triggerName) {
            const cleanTrig = String(triggerName).split('||')[0];
            msg = `${game.i18n.localize("DX3rd.Poisoned")}(Rank.${newRank}) ${game.i18n.localize("DX3rd.Apply")} (${cleanTrig})`;
          }
          ChatMessage.create({ content: `<div class="dx3rd-item-chat">${msg}</div>`, speaker: getActorOnlySpeaker(actor) });
        }
        // 1회성 전달값 초기화
        if (game.dx3rd) game.dx3rd.pendingPoisonedRank = null;
        return;
      }
      // 다이얼로그 표시 (전달값이 없는 경우)
      const template = `
        <div class="condition-rank-dialog">
          <div class="form-group">
            <label>${game.i18n.localize("DX3rd.PoisonedInputText")}</label>
            <input type="number" id="condition-rank" min="1" value="1" style="width: 100%; text-align: center;">
          </div>
        </div>
        <style>
        .condition-rank-dialog {
          padding: 5px;
        }
        .condition-rank-dialog .form-group {
          display: flex;
          flex-direction: column;
          gap: 8px;
          margin-top: 0px;
          margin-bottom: 5px;
        }
        .condition-rank-dialog label {
          font-weight: bold;
          font-size: 14px;
        }
        .condition-rank-dialog input {
          padding: 4px;
          font-size: 14px;
          border: 1px solid #ccc;
          border-radius: 4px;
        }
        </style>
      `;
      
      _showConditionDialog({
        title: game.i18n.localize("DX3rd.Poisoned"),
        content: template,
        onConfirm: async (root) => {
          const rank = parseInt(root.querySelector("#condition-rank").value) || 1;
          await actor.update({
            "system.conditions.poisoned.active": true,
            "system.conditions.poisoned.value": rank
          });

          // 채팅 메시지 출력 (트리거 아이템 이름 반영)
          let messageContent = `${game.i18n.localize("DX3rd.Poisoned")}(Rank.${rank}) ${game.i18n.localize("DX3rd.Apply")}`;
          if (triggerName) {
            const clean = String(triggerName).split('||')[0];
            messageContent = `${game.i18n.localize("DX3rd.Poisoned")}(Rank.${rank}) ${game.i18n.localize("DX3rd.Apply")} (${clean})`;
          }

          ChatMessage.create({
            content: `<div class="dx3rd-item-chat">${messageContent}</div>`,
            speaker: getActorOnlySpeaker(actor)
          });
        },
        onCancel: async () => {
          // 상태이상 이펙트 제거
          _cancellingCondition = true;
          const effect = actor.effects.find(e => e.statuses.has("poisoned"));
          if (effect) await effect.delete();
          _cancellingCondition = false;
        }
      });
    } else {
      // 해제: conditions 필드 원복은 항상 수행(시트 체크박스 켠 뒤 랭크 다이얼로그 취소 대비).
      // active 가 이미 false 면 no-op diff.
      await actor.update({
        "system.conditions.poisoned.active": false,
        "system.conditions.poisoned.value": 0
      });

      // 채팅 메시지는 취소가 아니고 suppress 도 아닐 때만 출력
      if (!_cancellingCondition && !suppressMessage) {
        const messageContent = `${game.i18n.localize("DX3rd.Poisoned")} ${game.i18n.localize("DX3rd.Clear")}`;

        ChatMessage.create({
          content: `<div class="dx3rd-item-chat">${messageContent}</div>`,
          speaker: getActorOnlySpeaker(actor)
        });
      }
    }
  }
}

Hooks.once('ready', async function() {
  // 기존 상태이상 제거
  CONFIG.statusEffects = [];
  
  // DX3rd 상태이상 정의
  CONFIG.statusEffects = [
    // 사독 (Poisoned)
    {
      id: "poisoned",
      name: "DX3rd.Poisoned",
      img: "icons/svg/blood.svg"
    },
    
    // 증오 (Hatred)
    {
      id: "hatred", 
      name: "DX3rd.Hatred",
      img: "icons/svg/fire.svg"
    },
    
    // 공포 (Fear)
    {
      id: "fear",
      name: "DX3rd.Fear", 
      img: "icons/svg/terror.svg"
    },
    
    // 폭주 (Berserk)
    {
      id: "berserk",
      name: "DX3rd.Berserk",
      img: "icons/svg/pawprint.svg"
    },
    
    // 경직 (Rigor)
    {
      id: "rigor",
      name: "DX3rd.Rigor",
      img: "icons/svg/net.svg"
    },
    
    // 중압 (Pressure)
    {
      id: "pressure",
      name: "DX3rd.Pressure",
      img: "icons/svg/paralysis.svg"
    },
    
    // 방심 (Dazed)
    {
      id: "dazed",
      name: "DX3rd.Dazed", 
      img: "icons/svg/stoned.svg"
    },
    
    // 탑승 (Boarding)
    {
      id: "boarding",
      name: "DX3rd.Boarding",
      img: "icons/svg/target.svg"
    },
    
    // 은밀 (Stealth)
    {
      id: "stealth",
      name: "DX3rd.Stealth",
      img: "icons/svg/blind.svg"
    },
    
    // 비행 (Fly)
    {
      id: "fly",
      name: "DX3rd.Fly",
      img: "icons/svg/wing.svg"
    },

    // 전투불능(Defeated)
    {
      id: "dead",
      name: "DX3rd.Defeated",
      img: "icons/svg/skull.svg"
    }
  ];
  
  // 상태이상 토글 이벤트 후킹
  Hooks.on('createActiveEffect', async (effect, options, userId) => {
    if (game.user.id !== userId) return;

    const actor = effect.parent;
    if (!actor) return;

    // applied 버프(네이티브 AE)는 컨디션 동기화 대상이 아니다 — 합성 status 로 인한 오탐 방지
    if (effect.getFlag?.('dx3rd-emanim', 'appliedKey')) return;

    // statuses를 배열로 변환하여 첫 번째 요소 가져오기
    const conditionId = Array.from(effect.statuses || [])[0];
    
    if (conditionId) {
      // 익스텐드에 의해 적용된 경우, 별도 기본 메시지 중복 출력 방지(UniversalHandler 쪽에서 출력함)
      // 안전 전달: 전역 대기 큐에서 트리거 아이템 이름 회수
      let triggerItemName = null;
      let poisonedRankFromMap = null;
      let specialTargetFromMap = null;
      if (window.DX3rdConditionTriggerMap) {
        const key = `${actor.id}:${conditionId}`;
        const payload = window.DX3rdConditionTriggerMap.get(key);
        if (payload) {
          triggerItemName = payload.trigger || null;
          poisonedRankFromMap = payload.poisonedRank || null;
          specialTargetFromMap = payload.specialTarget || null;
          const suppressMessage = payload.suppressMessage || false;
          
          // suppressMessage가 true면 메시지·다이얼로그는 건너뛰되,
          // 팔레트 경로와 동일한 기계적 부수효과(death mark / dazed applied 등)는 적용한다.
          // (시트 체크박스 → updateActor 동기화 경로가 팔레트 경로와 같은 결과를 내도록 병합)
          // 단, 맵에서 데이터는 삭제하여 해제 시 메시지 억제가 적용되지 않도록 함
          if (suppressMessage) {
            window.DX3rdConditionTriggerMap.delete(key);
            await applyConditionCreateSideEffects(actor, conditionId);
            return;
          }
          
          window.DX3rdConditionTriggerMap.delete(key);
        }
      }
      if (triggerItemName || poisonedRankFromMap || specialTargetFromMap) {
        let token = actor.token;
        if (!token && canvas.scene) {
          const tokenDoc = canvas.scene.tokens.find(t => t.actorId === actor.id);
          if (tokenDoc) token = tokenDoc.object || { actor };
        }
        // 사독 랭크/특수 타겟 전달(있으면) - 직접 매개변수로 전달
        await handleConditionToggle(token || { actor }, conditionId, true, triggerItemName, poisonedRankFromMap, specialTargetFromMap);
        return;
      }
      // 해당 액터의 토큰 찾기 (현재 장면에서)
      let token = actor.token;
      if (!token && canvas.scene) {
        const tokenDoc = canvas.scene.tokens.find(t => t.actorId === actor.id);
        if (tokenDoc) {
          token = tokenDoc.object || { actor };
        }
      }
      await handleConditionToggle(token || { actor }, conditionId, true);
    }
  });
  
  Hooks.on('deleteActiveEffect', async (effect, options, userId) => {
    if (game.user.id !== userId) return;

    const actor = effect.parent;
    if (!actor) return;

    // applied 버프(네이티브 AE)는 컨디션 동기화 대상이 아니다 — 합성 status 로 인한 오탐 방지
    if (effect.getFlag?.('dx3rd-emanim', 'appliedKey')) return;

    const conditionId = Array.from(effect.statuses || [])[0];
    
    if (conditionId) {
      // suppressMessage 플래그 확인
      let suppressMessage = false;
      if (window.DX3rdConditionTriggerMap) {
        const key = `${actor.id}:${conditionId}`;
        const payload = window.DX3rdConditionTriggerMap.get(key);
        if (payload && payload.suppressMessage) {
          suppressMessage = true;
          window.DX3rdConditionTriggerMap.delete(key);
        }
      }
      
      // 해당 액터의 토큰 찾기 (현재 장면에서)
      let token = actor.token;
      if (!token && canvas.scene) {
        const tokenDoc = canvas.scene.tokens.find(t => t.actorId === actor.id);
        if (tokenDoc) {
          token = tokenDoc.object || { actor };
        }
      }
      
      // suppressMessage가 true면 메시지만 억제하고 applied 제거는 수행
      if (suppressMessage) {
        await handleConditionToggle(token || { actor }, conditionId, false, null, null, null, true);
      } else {
        await handleConditionToggle(token || { actor }, conditionId, false);
      }
    }
  });

  /**
   * system.conditions.<id>.active 값과 토큰 오버레이(상태이상 ActiveEffect)를 동기화한다.
   * 시트 체크박스 / 아이템 사용 등으로 conditions 데이터만 바뀌는 경로에서도
   * 토큰 위에 상태이상 아이콘(오버레이)이 나타나도록 하기 위한 브리지.
   *
   * - conditions.<id>.active === true 인데 대응 ActiveEffect가 없으면 생성
   * - conditions.<id>.active === false 인데 대응 ActiveEffect가 있으면 삭제
   *
   * 생성/삭제 시 DX3rdConditionTriggerMap 의 suppressMessage 플래그를 세워
   * createActiveEffect/deleteActiveEffect 훅의 다이얼로그·중복 채팅을 억제한다(순수 시각 동기화).
   * effect 존재 여부로 idempotent 하게 동작하므로 팔레트 토글 경로와 충돌하지 않는다.
   *
   * defeated 는 status "dead" 오버레이/죽음표식으로 동기화한다. 생성 시 death mark 는
   * applyConditionCreateSideEffects(suppress 분기)에서, 삭제 시 handleConditionToggle 의
   * dead 분기(suppress)에서 처리되므로 시트 체크박스↔토큰 오버레이가 일치한다.
   */
  const CONDITION_TO_STATUS = {
    poisoned: "poisoned",
    hatred: "hatred",
    fear: "fear",
    berserk: "berserk",
    rigor: "rigor",
    pressure: "pressure",
    dazed: "dazed",
    boarding: "boarding",
    stealth: "stealth",
    fly: "fly",
    defeated: "dead"
  };

  Hooks.on('updateActor', async (actor, updateData, options, userId) => {
    // 변경을 일으킨 클라이언트에서만 오버레이를 동기화(다중 접속 시 중복 생성 방지)
    if (game.user.id !== userId) return;

    let flat;
    try {
      flat = foundry.utils.flattenObject(updateData);
    } catch (e) {
      return;
    }

    for (const [cond, status] of Object.entries(CONDITION_TO_STATUS)) {
      const key = `system.conditions.${cond}.active`;
      if (!(key in flat)) continue;

      const nowActive = !!flat[key];
      const hasEffect = actor.effects.some(e => e.statuses.has(status));

      // 시트 체크박스로 상태이상을 켜고 끄면 팔레트/아이템 경로와 "완전히 동일하게" 발동시킨다.
      // (다이얼로그 · 부수효과 · 채팅 메시지 포함) — 오버레이(ActiveEffect)를 생성/삭제하면
      // 정규 createActiveEffect/deleteActiveEffect 훅이 handleConditionToggle 을 호출한다.
      //
      // 중복 발동은 hasEffect 가드가 막는다:
      //   - 팔레트/아이템 경로: handleConditionToggle 이 먼저 오버레이를 만들고 conditions.active 를
      //     세팅 → 이 훅이 그 업데이트로 다시 돌 때는 이미 hasEffect=true 라 재토글하지 않는다.
      //   - 시트 경로: 이 훅이 최초로 오버레이를 만들고, handleConditionToggle 이 세팅하는
      //     conditions.active(=true) 는 no-op diff 라 재진입하지 않는다.
      if (nowActive && !hasEffect) {
        try {
          await actor.toggleStatusEffect(status, { active: true });
        } catch (e) {
          console.warn(`DX3rd | Failed to sync overlay ON for ${cond}:`, e);
        }
      } else if (!nowActive && hasEffect) {
        try {
          const eff = actor.effects.find(e => e.statuses.has(status));
          if (eff) await eff.delete();
        } catch (e) {
          console.warn(`DX3rd | Failed to sync overlay OFF for ${cond}:`, e);
        }
      }
    }

    // 폭주 유형에 종속된 "지속 패널티"를 시트 드롭다운 값에 맞춰 재조정한다.
    // active 토글과 유형 변경(순서 무관)을 모두 커버하도록 .active/.type 변경 시 실행.
    // 상태 종속 지속 효과(기아 dice-5, 가학 attack-20)만 다룬다 —
    // 자해 HP-5, 공포→경직, 증오→증오, 흡혈 등 "적용 시점 1회성 이벤트"는
    // 드롭다운 조작만으로 반복 발동되면 안 되므로 여기서 다루지 않는다(팔레트/아이템 발동 전용).
    if ('system.conditions.berserk.active' in flat || 'system.conditions.berserk.type' in flat) {
      const bActive = !!actor.system?.conditions?.berserk?.active;
      const bType = actor.system?.conditions?.berserk?.type || '-';

      const wantHunger = bActive && bType === 'hunger';
      const wantTourture = bActive && bType === 'tourture';
      const hasHunger = actor.effects.some(e => e.getFlag?.('dx3rd-emanim', 'appliedKey') === 'berserk_hunger');
      const hasTourture = actor.effects.some(e => e.getFlag?.('dx3rd-emanim', 'appliedKey') === 'berserk_tourture');

      try {
        if (wantHunger && !hasHunger) {
          await window.DX3rdAppliedEffects.set(actor, 'berserk_hunger', {
            name: game.i18n.localize('DX3rd.Mutation') + ': ' + game.i18n.localize('DX3rd.UrgeHunger'),
            attributes: { dice: -5 },
            disable: '-'
          });
        } else if (!wantHunger && hasHunger) {
          await window.DX3rdAppliedEffects.remove(actor, 'berserk_hunger');
        }

        if (wantTourture && !hasTourture) {
          await window.DX3rdAppliedEffects.set(actor, 'berserk_tourture', {
            name: game.i18n.localize('DX3rd.Mutation') + ': ' + game.i18n.localize('DX3rd.UrgeTourture'),
            attributes: { attack: -20 },
            disable: '-'
          });
        } else if (!wantTourture && hasTourture) {
          await window.DX3rdAppliedEffects.remove(actor, 'berserk_tourture');
        }
      } catch (e) {
        console.warn('DX3rd | Failed to reconcile berserk penalties:', e);
      }
    }
  });

  // HP 이전 값을 저장하기 위한 Map
  const _previousHpValues = new Map();
  // preUpdateActor가 누락되는 경우를 대비한 마지막 HP 캐시
  const _lastKnownHpValues = new Map();
  
  // HP 변경 전에 이전 값을 저장
  Hooks.on('preUpdateActor', (actor, updateData, options, userId) => {
    // updateData는 nested 형태 또는 dot-notation 형태로 올 수 있음
    const incomingHp =
      updateData.system?.attributes?.hp?.value ??
      updateData["system.attributes.hp.value"];
    
    if (incomingHp !== undefined) {
      const currentHp = Number(actor.system?.attributes?.hp?.value ?? 0);
      _previousHpValues.set(actor.id, currentHp);
      _lastKnownHpValues.set(actor.id, currentHp);
    }
  });
  
  // HP 변경 감지하여 전투불능(dead) 상태 자동 토글
  Hooks.on('updateActor', async (actor, updateData, options, userId) => {
    // HP 0 감지에 따른 상태이상 토글은 GM만 수행 (플레이어+GM 동시 접속 시 중복 메시지 방지)
    if (!game.user.isGM) return;

    // HP 값이 변경되었는지 확인
    const incomingHp =
      updateData.system?.attributes?.hp?.value ??
      updateData["system.attributes.hp.value"];
    
    if (incomingHp !== undefined) {
      const cachedOldHp =
        _previousHpValues.get(actor.id) ??
        _lastKnownHpValues.get(actor.id);
      const oldHp = Number(cachedOldHp);
      const newHp = Number(incomingHp);
      
      // 이전 값 제거
      _previousHpValues.delete(actor.id);
      _lastKnownHpValues.set(actor.id, newHp);
      
      // HP가 0이 되었을 때
      if (oldHp > 0 && newHp === 0) {
        // dead 상태 이상이 이미 있는지 확인
        const hasDeadEffect = actor.effects.find(e => e.statuses.has("dead"));
        if (!hasDeadEffect) {
          await actor.toggleStatusEffect("dead", { active: true });
        }
        
        // 폭주 bloodsucking 타입이면 폭주 해제
        const berserkActive = actor.system?.conditions?.berserk?.active || false;
        const berserkType = actor.system?.conditions?.berserk?.type || '';
        if (berserkActive && berserkType === 'bloodsucking') {
          const berserkEffect = actor.effects.find(e => e.statuses.has("berserk"));
          if (berserkEffect) {
            // 메시지 제어 플래그 설정
            const mapKey = `${actor.id}:berserk`;
            if (!window.DX3rdConditionTriggerMap) {
              window.DX3rdConditionTriggerMap = new Map();
            }
            window.DX3rdConditionTriggerMap.set(mapKey, {
              triggerItemName: 'HP 0',
              suppressMessage: false
            });
            
            await actor.toggleStatusEffect("berserk", { active: false });
            
            // 맵 정리
            window.DX3rdConditionTriggerMap.delete(mapKey);
          }
        }
      }
      // HP가 0에서 0 초과로 변했을 때
      else if (oldHp === 0 && newHp > 0) {
        // dead 상태 이상이 있는지 확인
        const deadEffect = actor.effects.find(e => e.statuses.has("dead"));
        if (deadEffect) {
          await deadEffect.delete();
          
          // death mark를 직접 제거 (deleteActiveEffect 훅이 늦게 작동할 경우 대비)
          setTimeout(() => {
            if (canvas.scene) {
              const tokens = canvas.scene.tokens.filter(t => t.actorId === actor.id);
              for (const tokenDoc of tokens) {
                const tokenObj = tokenDoc.object;
                if (tokenObj && tokenObj.dx3rdDeathMark) {
                  removeDeathMarkFromToken(tokenObj);
                  tokenObj.refresh();
                  
                  // 다른 클라이언트에도 death mark 제거
                  game.socket.emit('system.dx3rd-emanim', {
                    type: 'removeDeathMark',
                    data: {
                      tokenId: tokenDoc.id,
                      sceneId: canvas.scene.id
                    }
                  });
                }
              }
            }
          }, 200);
        }
      }
    }
  });
  
  // 전역으로 함수 노출 (소켓 통신에서 사용)
  window.addDeathMarkToToken = addDeathMarkToToken;
  window.removeDeathMarkFromToken = removeDeathMarkFromToken;
  window.handleConditionToggle = handleConditionToggle;
  
});


// 캔버스 준비 시 모든 dead 토큰에 death mark 표시 (초기 로드용)
Hooks.on('canvasReady', async () => {
  if (!canvas.scene) return;
  
  let deadTokenCount = 0;
  
  for (const tokenDoc of canvas.scene.tokens) {
    const token = tokenDoc.object;
    if (!token || !token.actor) continue;
    
    const hasDeadEffect = token.actor.effects.find(e => e.statuses.has("dead"));
    if (hasDeadEffect && !token.dx3rdDeathMark) {
      await addDeathMarkToToken(token);
      deadTokenCount++;
    }
  }
});

// 상태이상 오버레이 복구는 기동 중 자동 생성하지 않고 동기화 메뉴에서만 명시 실행한다.
// 현재 씬에서 system.conditions 는 active 이지만 대응 ActiveEffect 가 없는 경우만 대상이다.
const DX3RD_CONDITION_TO_STATUS = {
  poisoned: "poisoned", hatred: "hatred", fear: "fear", berserk: "berserk",
  rigor: "rigor", pressure: "pressure", dazed: "dazed", boarding: "boarding",
  stealth: "stealth", fly: "fly", defeated: "dead"
};

window.DX3rdConditionOverlayRepair = {
  audit(scene = canvas?.scene) {
    const rows = [];
    if (!scene) return { actors: 0, effects: 0, rows };
    const seenActors = new Set();
    for (const tokenDoc of scene.tokens) {
      const actor = tokenDoc.actor;
      if (!actor || seenActors.has(actor.id)) continue;
      seenActors.add(actor.id);
      const missing = [];
      const conditions = actor.system?.conditions || {};
      for (const [cond, status] of Object.entries(DX3RD_CONDITION_TO_STATUS)) {
        if (conditions[cond]?.active && !actor.effects.some(e => e.statuses.has(status))) missing.push({ cond, status });
      }
      if (missing.length) rows.push({ actor, missing });
    }
    return { actors: rows.length, effects: rows.reduce((count, row) => count + row.missing.length, 0), rows };
  },
  async repair() {
    if (!game.user.isGM) return { actors: 0, effects: 0 };
    const audit = this.audit();
    let restored = 0;
    for (const { actor, missing } of audit.rows) {
      for (const { status } of missing) {
        window.DX3rdConditionTriggerMap = window.DX3rdConditionTriggerMap || new Map();
        window.DX3rdConditionTriggerMap.set(`${actor.id}:${status}`, { suppressMessage: true });
        try {
          await actor.toggleStatusEffect(status, { active: true });
          restored++;
        } catch (e) {
          console.warn(`DX3rd | Failed to restore condition overlay for ${status}:`, e);
          window.DX3rdConditionTriggerMap.delete(`${actor.id}:${status}`);
        }
      }
    }
    console.log(`DX3rd | Explicit condition overlay repair: ${restored} restored.`);
    return { actors: audit.actors, effects: restored };
  }
};
