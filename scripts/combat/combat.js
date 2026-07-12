// Double Cross 3rd Combat System

/**
 * 메인 프로세스 액터 표시 애니메이션
 * @param {string} imgSrc - 액터 이미지 소스
 * @param {string} actorName - 액터 이름
 */
function showTurnActor(imgSrc = null, actorName = null) {
  // 컴배턴트 정보 가져오기 (파라미터가 없으면 현재 combatant에서 가져옴)
  if (!imgSrc) imgSrc = game.combat?.combatant?.actor?.img ?? "";
  if (!actorName) actorName = game.combat?.combatant?.actor?.name ?? game.combat?.combatant?.name ?? "";

  // 기존 제거
  document.getElementById("diamond-frame")?.remove();
  document.getElementById("diamond-label-left")?.remove();
  document.getElementById("diamond-label-right")?.remove();

  // 스타일 정의 (중복 삽입 방지)
  if (!document.getElementById("diamond-style")) {
    const style = document.createElement("style");
    style.id = "diamond-style";
    style.innerHTML = `
      @keyframes diamondEnter {
        0% {
          transform: translate(-50%, -50%) rotate(0deg) scale(0.1);
          opacity: 0;
          clip-path: polygon(50% 50%, 50% 50%, 50% 50%, 50% 50%);
        }
        100% {
          transform: translate(-50%, -50%) rotate(360deg) scale(1);
          opacity: 1;
          clip-path: polygon(50% 0%, 100% 50%, 50% 100%, 0% 50%);
        }
      }
      @keyframes diamondExit {
        0% {
          transform: translate(-50%, -50%) rotate(360deg) scale(1);
          opacity: 1;
          clip-path: polygon(50% 0%, 100% 50%, 50% 100%, 0% 50%);
        }
        100% {
          transform: translate(-50%, -50%) rotate(0deg) scale(0.7);
          opacity: 0;
          clip-path: polygon(50% 0%, 100% 50%, 50% 100%, 0% 50%);
        }
      }
      #diamond-frame {
        position: fixed;
        top: 50%;
        left: 50%;
        width: 220px;
        height: 220px;
        transform: translate(-50%, -50%) scale(0.1) rotate(0deg);
        z-index: 9999;
        border: 10px solid black;
        overflow: hidden;
        animation: diamondEnter 0.3s ease-out forwards;
        background: radial-gradient(circle, rgba(128,128,128,1) 0%, rgba(128,128,128, 0.5) 100%);
        clip-path: polygon(50% 0%, 100% 50%, 50% 100%, 0% 50%);
      }
      #diamond-frame img {
        width: 100%;
        height: 100%;
        object-fit: contain;
        transform: rotate(0deg);
        margin: 0;
        border: none;
        display: block;
        position: relative;
        z-index: 1;
      }
      .diamond-label {
        position: fixed;
        font-weight: bold;
        font-size: 1.92em;
        color: white;
        text-shadow:
          0 0 2px rgba(0, 0, 0, 0.5),
          0 0 4px rgba(0,0,0,0.5),
          1px 1px 0 rgba(0,0,0,0.5),
          -1px -1px 0 rgba(0,0,0,0.5),
          1px -1px 0 rgba(0,0,0,0.5),
          -1px 1px 0 rgba(0,0,0,0.5);
        font-family: sans-serif;
        pointer-events: none;
        opacity: 0;
        z-index: 10000;
        white-space: nowrap;
      }
      @keyframes labelLeftEnter {
        0% {
          top: 50%;
          left: 50%;
          transform: translate(-50%, -50%);
          opacity: 0;
        }
        100% {
          top: calc(50% - 77px);
          left: calc(50% - 110px);
          transform: translate(0%, -100%);
          opacity: 1;
        }
      }
      @keyframes labelLeftExit {
        0% {
          top: calc(50% - 77px);
          left: calc(50% - 110px);
          transform: translate(0%, -100%);
          opacity: 1;
        }
        100% {
          top: 50%;
          left: 50%;
          transform: translate(-50%, -50%);
          opacity: 0;
        }
      }
      @keyframes labelRightEnter {
        0% {
          top: 50%;
          left: 50%;
          transform: translate(-50%, -50%);
          opacity: 0;
        }
        100% {
          top: calc(50% + 77px);
          left: calc(50% + 110px);
          transform: translate(-100%, 0%);
          opacity: 1;
        }
      }
      @keyframes labelRightExit {
        0% {
          top: calc(50% + 77px);
          left: calc(50% + 110px);
          transform: translate(-100%, 0%);
          opacity: 1;
        }
        100% {
          top: 50%;
          left: 50%;
          transform: translate(-50%, -50%);
          opacity: 0;
        }
      }
      #diamond-label-left {
        animation: labelLeftEnter 0.4s ease-out forwards;
        text-align: left;
        left: calc(50% - 110px);
        transform: translate(0%, -100%);
      }
      #diamond-label-right {
        animation: labelRightEnter 0.4s ease-out forwards;
        text-align: right;
        left: calc(50% + 110px);
        transform: translate(-100%, 0%);
      }
      #diamond-label-left.fade-out {
        animation: labelLeftExit 0.4s ease-in forwards;
      }
      #diamond-label-right.fade-out {
        animation: labelRightExit 0.4s ease-in forwards;
      }
      #diamond-frame.fade-out {
        animation: diamondExit 0.4s ease-in forwards !important;
      }
    `;
    document.head.appendChild(style);
  }

  // 라벨 생성 함수
  function createLabel(id, className, text) {
    const label = document.createElement("div");
    label.id = id;
    label.className = className;
    label.innerText = text;
    document.body.appendChild(label);
    return label;
  }

  // 프레임
  const frame = document.createElement("div");
  frame.id = "diamond-frame";

  const image = document.createElement("img");
  image.src = imgSrc;
  frame.appendChild(image);
  document.body.appendChild(frame);

  // 라벨 생성
  const leftLabel = createLabel("diamond-label-left", "diamond-label", game.i18n.localize("DX3rd.MainProcess"));
  const rightLabel = createLabel("diamond-label-right", "diamond-label", actorName);

  // 애니메이션 타이밍 상수
  const SHOW_DURATION = 1200; // 머무는 시간(ms)
  const FADE_DURATION = 400;  // 사라지는 애니메이션(ms)

  // 사라짐 처리
  setTimeout(() => {
    frame.classList.add("fade-out");
    leftLabel.classList.add("fade-out");
    rightLabel.classList.add("fade-out");
    setTimeout(() => {
      frame.remove();
      leftLabel.remove();
      rightLabel.remove();
    }, FADE_DURATION);
  }, SHOW_DURATION);
}

function getGMSpeaker() {
  const gmUser = game.users.find(u => u.isGM && u.active) || game.users.find(u => u.isGM);
  if (!gmUser) return { alias: "GM", actor: null, token: null };
  // 선택된 토큰(컨트롤된 토큰)에 의해 스피커가 오염되지 않도록
  // scene/token/actor를 명시적으로 null로 고정한다.
  const base = ChatMessage.getSpeaker({ user: gmUser });
  return {
    ...base,
    scene: null,
    actor: null,
    token: null,
    alias: gmUser.name ?? gmUser.data?.name ?? "GM",
  };
}

/**
 * 특정 접두사로 시작하는 모든 매크로 실행
 * @param {string} prefix - 매크로 이름 접두사
 */
async function executeMacrosByPrefix(prefix) {
  // GM만 매크로 실행
  if (!game.user.isGM) {
    return;
  }
  
  const macros = game.macros.filter(m => m.name.startsWith(prefix));
  if (macros.length === 0) {
    return;
  }
  
  for (const macro of macros) {
    try {
      await macro.execute();
    } catch (error) {
      console.error(`DX3rd | Error executing macro ${macro.name}:`, error);
    }
  }
}

(function() {
  // v13/v14 호환: Combat, Combatant 글로벌이 없을 경우 폴백
  const _CombatBase = foundry.documents?.Combat ?? globalThis.Combat;
  const _CombatantBase = foundry.documents?.Combatant ?? globalThis.Combatant;
  const toFiniteInitiative = (value) => {
    const number = Number(value);
    return Number.isFinite(number) ? number : -Infinity;
  };

  /**
   * DX3rd Combat class
   * Extends Foundry's Combat to use actor's init.value as initiative
   */
  class DX3rdCombat extends _CombatBase {
    /**
     * Override _getInitiativeFormula to use actor's init.value directly
     * @param {Combatant} combatant
     * @returns {string}
     */
    _getInitiativeFormula(combatant) {
      const actor = combatant.actor;
      if (!actor) return "0";
      
      // 액터의 현재 행동치 값 사용
      const initValue = actor.system?.attributes?.init?.value ?? 0;
      
      // 주사위를 굴리지 않고 직접 값을 반환하기 위해 문자열로 반환
      return String(initValue);
    }

    /**
     * Override rollInitiative to use actor's init.value without rolling dice
     * @param {string|string[]} ids
     * @param {object} options
     */
    async rollInitiative(ids, options = {}) {
      // 배열로 변환
      ids = typeof ids === "string" ? [ids] : ids;
      
      const updates = [];
      
      for (const id of ids) {
        const combatant = this.combatants.get(id);
        if (!combatant) continue;
        
        // 프로세스 컴배턴트 확인
        const isProcessCombatant = combatant.getFlag('dx3rd-emanim', 'isProcessCombatant');
        const processType = combatant.getFlag('dx3rd-emanim', 'processType');
        
        let initValue;
        
        if (isProcessCombatant) {
          // 프로세스 컴배턴트에 고정 이니셔티브 할당
          if (processType === 'setup') {
            initValue = 9999; // 셋업이 가장 먼저
          } else if (processType === 'cleanup') {
            initValue = -9999; // 클린업이 가장 나중
          } else {
            initValue = 0;
          }
        } else {
          // 일반 액터
          const actor = combatant.actor;
          if (!actor) {
            initValue = 0;
          } else {
            // 행동 대기 상태 확인
            const isActionDelay = actor.system?.conditions?.action_delay?.active ?? false;
            if (isActionDelay) {
              // 룰: 대기자는 【행동치】 무관하게 라운드 최후에 행동하되,
              // 대기자가 여럿이면 행동치가 느린(낮은) 순서대로 실행한다.
              // 이니셔티브를 -(행동치)로 두면 (1) 음수라 정상 액터 뒤로 정렬되고
              // (2) 행동치가 낮을수록 -값이 0에 가까워 더 먼저 정렬된다.
              const actionValue = Number(actor.system?.attributes?.init?.value ?? 0);
              initValue = -actionValue;
            } else {
              initValue = Number(actor.system?.attributes?.init?.value ?? 0);
            }
          }
        }
        
        updates.push({
          _id: id,
          initiative: initValue
        });
      }
      
      if (updates.length === 0) return this;
      
      // 업데이트 수행
      await this.updateEmbeddedDocuments("Combatant", updates);
      
      return this;
    }

    /**
     * Override _sortCombatants to implement custom tie-breaking rules
     * @param {Combatant} a
     * @param {Combatant} b
     * @returns {number}
     */
    _sortCombatants(a, b) {
      // 1순위: 이니셔티브 (높은 순)
      const ia = toFiniteInitiative(a.initiative);
      const ib = toFiniteInitiative(b.initiative);
      if (ia !== ib) return ib - ia;
      
      // 이니셔티브가 같을 경우 동점자 처리 규칙 적용
      const actorA = a.actor;
      const actorB = b.actor;
      
      // 액터가 없는 경우 (셋업/클린업 프로세스 컴배턴트)
      if (!actorA || !actorB) {
        return 0;
      }
      
      // 2순위: 액터 타입 우선순위 (PlayerCharacter > Enemy > Ally > Troop > NPC)
      const actorTypePriority = {
        'PlayerCharacter': 1,
        'Enemy': 2,
        'Ally': 3,
        'Troop': 4,
        'NPC': 5
      };
      const aPriority = actorTypePriority[actorA.system?.actorType] ?? 99;
      const bPriority = actorTypePriority[actorB.system?.actorType] ?? 99;
      if (aPriority !== bPriority) return aPriority - bPriority;
      
      // 3순위: EXTRA TURN 없는 쪽 우선
      const aExtraTurn = actorA.system?.conditions?.['extra-turn']?.active ?? false;
      const bExtraTurn = actorB.system?.conditions?.['extra-turn']?.active ?? false;
      if (aExtraTurn !== bExtraTurn) return aExtraTurn ? 1 : -1;
      
      // 4순위: sense.total (높은 순)
      const aSense = actorA.system?.attributes?.sense?.total ?? 0;
      const bSense = actorB.system?.attributes?.sense?.total ?? 0;
      if (aSense !== bSense) return bSense - aSense;
      
      // 5순위: mind.total (높은 순)
      const aMind = actorA.system?.attributes?.mind?.total ?? 0;
      const bMind = actorB.system?.attributes?.mind?.total ?? 0;
      if (aMind !== bMind) return bMind - aMind;
      
      // 6순위: 이름 (알파벳/가나다/숫자 순)
      return a.name.localeCompare(b.name);
    }
  }

  /**
   * DX3rd Combatant class
   */
  class DX3rdCombatant extends _CombatantBase {
    /**
     * Override _getInitiativeFormula
     */
    _getInitiativeFormula() {
      const actor = this.actor;
      if (!actor) return "0";
      
      const initValue = actor.system?.attributes?.init?.value ?? 0;
      return String(initValue);
    }
  }

  // 전역 노출
  window.DX3rdCombat = DX3rdCombat;
  window.DX3rdCombatant = DX3rdCombatant;
})();

// Next Turn 버튼 클릭 시 행동 종료/대기 선택 다이얼로그
Hooks.once('ready', () => {
  // Combat.prototype.nextTurn 직접 래핑
  if (!Combat.prototype.nextTurn._dx3rdOriginal) {
    // 원본 메서드를 변수에 저장
    const originalNextTurn = Combat.prototype.nextTurn;
    if (typeof originalNextTurn !== 'function') {
      console.warn('DX3rd | Combat - nextTurn is not a function');
    return;
  }

    // 원본 메서드 저장
    Combat.prototype.nextTurn._dx3rdOriginal = originalNextTurn;
    
    Combat.prototype.nextTurn = async function(...args) {
      // 원본 메서드 래퍼 (저장된 변수 사용)
      const wrapped = async () => {
        return await originalNextTurn.apply(this, args);
      };
      
      // 커스텀 로직 시작
      // 현재 컴배턴트 확인
      const currentCombatant = this.combatant;
      
      // 프로세스 컴배턴트 확인
      const isProcessCombatant = currentCombatant?.getFlag('dx3rd-emanim', 'isProcessCombatant');
      if (isProcessCombatant) {
        const processType = currentCombatant?.getFlag('dx3rd-emanim', 'processType');
        
        // 셋업 프로세스인 경우, 행동 가능한 액터가 있는지 확인
        if (processType === 'setup') {
          const combatantsArray = Array.from(this.combatants);
          const hasAvailableActor = combatantsArray.some(combatant => {
            const isCombatProcess = combatant.getFlag('dx3rd-emanim', 'isProcessCombatant');
            if (isCombatProcess) return false;
            
            // action_end 상태 확인 및 HP 체크
            const actor = combatant.actor;
            if (actor) {
              const actionEnd = actor.system?.conditions?.action_end?.active ?? false;
              if (actionEnd) return false;
              
              // HP 0 이하인 액터 제외
              const currentHP = actor.system?.attributes?.hp?.value ?? 0;
              if (currentHP <= 0) return false;
            }
            
            return true;
          });
          
          // 행동 가능한 액터가 없으면 클린업으로 이동
          if (!hasAvailableActor) {
            const cleanupCombatant = this.combatants.find(c => 
              c.getFlag('dx3rd-emanim', 'processType') === 'cleanup'
            );
            if (cleanupCombatant) {
              const cleanupIndex = this.turns.findIndex(t => t.id === cleanupCombatant.id);
              if (cleanupIndex >= 0) {
                await this.update({ turn: cleanupIndex });
                return;
              }
            }
          }
          
          // 행동 가능한 액터가 있으면 이니셔티브 프로세스 실행
          await executeInitiativeProcess(this);
          return;
        }
        
        // 클린업 등 다른 프로세스 컴배턴트는 바로 넘김
        return wrapped();
      }
      
      // 액터가 있는 일반 컴배턴트만 다이얼로그 표시
      if (!currentCombatant || !currentCombatant.actor) {
        return wrapped();
      }
      
      // 행동 대기 상태 확인
      const actor = currentCombatant.actor;
      const isDelayed = actor?.system?.conditions?.action_delay?.active ?? false;
      
      // 행동 종료/대기 선택 다이얼로그 (플레이어도 표시) - DOM 방식
      const choice = await new Promise((resolve) => {
        const onSelect = (selection) => {
          dialog.remove();
          resolve(selection);
        };
        
        const dialog = document.createElement("div");
        dialog.id = "dx3rd-action-dialog";
        dialog.style.position = "fixed";
        dialog.style.top = "50%";
        dialog.style.left = "50%";
        dialog.style.transform = "translate(-50%, -50%)";
        dialog.style.background = "rgba(0, 0, 0, 0.85)";
        dialog.style.color = "white";
        dialog.style.padding = "10px 20px 12px 20px";
        dialog.style.border = "none";
        dialog.style.borderRadius = "8px";
        dialog.style.zIndex = "9999";
        dialog.style.textAlign = "center";
        dialog.style.fontSize = "16px";
        dialog.style.boxShadow = "0 0 10px black";
        dialog.style.minWidth = "260px";
        
        // 행동 대기 상태면 행동 종료 버튼만 표시
        if (isDelayed) {
          dialog.innerHTML = `
            <div style="margin-bottom:12px;font-size:0.9em;">${currentCombatant.name}</div>
            <div 
              style="
                width:100%;
                display: flex; 
                flex-direction: column;
                gap: 8px;
                margin-top:4px;"
            >
              <button 
                id="dx3rd-end-action-button" 
                style="
                  width:100%;
                  height: 28px;
                  background: white;
                  color: black;
                  border-radius: 4px;
                  border: none;
                  opacity: 0.5;
                  font-weight: bold;
                  font-size: 0.75em;
                  margin: 0;
                  display: flex;
                  align-items: center;
                  justify-content: center;
                  padding: 0;
                  cursor: pointer;
                "
              >${game.i18n.localize("DX3rd.ActionEnd")}</button>
              <hr style="margin: 4px 0; border: none; border-top: 1px solid rgba(255,255,255,0.3);">
              <button 
                id="dx3rd-cancel-button" 
                style="
                  width:100%;
                  height: 28px;
                  background: white; 
                  color: rgba(255, 68, 68, 1); 
                  border-radius: 4px; 
                  border: none; 
                  opacity: 0.5; 
                  font-weight: bold;
                  font-size: 0.75em;
                  margin: 0;
                  display: flex;
                  align-items: center;
                  justify-content: center;
                  padding: 0;
                  cursor: pointer;
                "
              >${game.i18n.localize("DX3rd.Cancel")}</button>
            </div>
          `;
        } else {
          // 일반 상태면 행동 종료/대기 버튼 모두 표시
          dialog.innerHTML = `
            <div style="margin-bottom:12px;font-size:0.9em;">${currentCombatant.name}</div>
            <div 
              style="
                width:100%;
                display: flex; 
                flex-direction: column;
                gap: 8px;
                margin-top:4px;"
            >
              <button 
                id="dx3rd-end-action-button" 
                style="
                  width:100%;
                  height: 28px;
                  background: white;
                  color: black;
                  border-radius: 4px;
                  border: none;
                  opacity: 0.5;
                  font-weight: bold;
                  font-size: 0.75em;
                  margin: 0;
                  display: flex;
                  align-items: center;
                  justify-content: center;
                  padding: 0;
                  cursor: pointer;
                "
              >${game.i18n.localize("DX3rd.ActionEnd")}</button>
              <button 
                id="dx3rd-delay-action-button" 
                style="
                  width:100%;
                  height: 28px;
                  background: white; 
                  color: black; 
                  border-radius: 4px; 
                  border: none; 
                  opacity: 0.5; 
                  font-weight: bold;
                  font-size: 0.75em;
                  margin: 0;
                  display: flex;
                  align-items: center;
                  justify-content: center;
                  padding: 0;
                  cursor: pointer;
                "
              >${game.i18n.localize("DX3rd.ActionDelay")}</button>
              <hr style="margin: 4px 0; border: none; border-top: 1px solid rgba(255,255,255,0.3);">
              <button 
                id="dx3rd-cancel-button" 
                style="
                  width:100%;
                  height: 28px;
                  background: white; 
                  color: rgba(255, 68, 68, 1); 
                  border-radius: 4px; 
                  border: none; 
                  opacity: 0.5; 
                  font-weight: bold;
                  font-size: 0.75em;
                  margin: 0;
                  display: flex;
                  align-items: center;
                  justify-content: center;
                  padding: 0;
                  cursor: pointer;
                "
              >${game.i18n.localize("DX3rd.Cancel")}</button>
            </div>
          `;
        }
        
        // 중복 다이얼로그 방지: 이전 턴의 행동 선택 창이 남아있으면 제거
        // (남아있으면 document.getElementById가 옛 창의 버튼을 잡아 새 창이 먹통이 됨)
        document.getElementById("dx3rd-action-dialog")?.remove();
        document.body.appendChild(dialog);

        // 리스너는 방금 만든 dialog 내부에서 직접 찾는다 (중복 id에 영향받지 않도록)
        dialog.querySelector("#dx3rd-end-action-button").addEventListener("click", () => onSelect("end"));
        if (!isDelayed) {
          dialog.querySelector("#dx3rd-delay-action-button").addEventListener("click", () => onSelect("delay"));
        }
        dialog.querySelector("#dx3rd-cancel-button").addEventListener("click", () => onSelect(null));
      });
      
      // 다이얼로그를 닫은 경우 (선택 안 함)
      if (!choice) {
        return;
      }
      
      // 선택에 따라 처리
      if (choice === 'end') {
        // 행동 종료 처리 - 액터의 action_end 상태 활성화
        const actor = currentCombatant.actor;
        if (actor) {
          const updates = {
            'system.conditions.action_end.active': true
          };
          let _extraTurnApplied = null;

          // extra-turn 처리
          const extraTurnActive = actor.system?.conditions?.['extra-turn']?.active ?? false;
          const extraTurnValue = actor.system?.conditions?.['extra-turn']?.value ?? 0;
          
          if (extraTurnActive && extraTurnValue > 0) {
            // extra-turn.value를 1 차감
            updates['system.conditions.extra-turn.value'] = extraTurnValue - 1;
            
            // EXTRA TURN applied 생성 - 기존 구조 사용
            const initValue = actor.system?.attributes?.init?.value ?? 0;
            let initPenalty = -Math.floor(initValue / 2);
            
            const appliedKey = `EXTRA_TURN_${actor.id}`;

            // 이미 EXTRA TURN 패널티가 있는지 확인 (네이티브 AE flag 조회)
            const existingApplied = window.DX3rdAppliedEffects?.getEffect(actor, appliedKey)?.getFlag('dx3rd-emanim', 'applied');
            if (existingApplied && existingApplied.attributes?.init !== undefined) {
              // 이미 EXTRA TURN 패널티가 있으면 -9999로 설정
              initPenalty = -9999;
            }

            // EXTRA TURN 패널티가 부착되면 행동 종료 해제
            updates['system.conditions.action_end.active'] = false;
            _extraTurnApplied = { key: appliedKey, initPenalty };
          }

          await actor.update(updates);
          if (_extraTurnApplied) {
            await window.DX3rdAppliedEffects.set(actor, _extraTurnApplied.key, {
              name: game.i18n.localize('DX3rd.ExtraTurn'),
              attributes: {
                init: _extraTurnApplied.initPenalty
              },
              disable: 'round'
            });
          }
        }
        
        // 채팅 메시지 출력
        await ChatMessage.create({
          content: game.i18n.localize("DX3rd.ActionEnd"),
          speaker: ChatMessage.getSpeaker({ actor: actor })
        });
        
        // main disable hook 실행 요청
        if (game.user.isGM) {
          // GM이면 직접 실행
          if (typeof DX3rdDisableHooks !== 'undefined') {
            console.log('DX3rd | Executing main disable hook for all actors');
            await DX3rdDisableHooks.executeDisableHook('main', null);
          }
        } else {
          // 플레이어면 GM에게 소켓으로 전달
          game.socket.emit('system.dx3rd-emanim', {
            type: 'executeDisableHook',
            timing: 'main'
          });
        }
      } else if (choice === 'delay') {
        // 행동 대기 처리
        const actor = currentCombatant.actor;
        if (actor) {
          // 현재 전투의 모든 컴배턴트 중 action_delay가 활성화된 액터 수 확인
          const combat = this;
          let delayCount = 0;
          
          for (const combatant of combat.combatants) {
            if (combatant.actor && combatant.actor.system.conditions?.action_delay?.active) {
              delayCount++;
            }
          }
          
          // action_delay 활성화 및 value 설정 (기존 대기 수 + 1)
          await actor.update({
            'system.conditions.action_delay.active': true,
            'system.conditions.action_delay.value': delayCount + 1
          });
        }
        
        // 채팅 메시지 출력
        await ChatMessage.create({
          content: game.i18n.localize("DX3rd.ActionDelay"),
          speaker: ChatMessage.getSpeaker({ actor: actor })
        });
        
        // main disable hook 실행 요청
        if (game.user.isGM) {
          // GM이면 직접 실행
          if (typeof DX3rdDisableHooks !== 'undefined') {
            await DX3rdDisableHooks.executeDisableHook('main', null);
          }
        } else {
          // 플레이어면 GM에게 소켓으로 전달
          game.socket.emit('system.dx3rd-emanim', {
            type: 'executeDisableHook',
            timing: 'main'
          });
        }
      }
      
      // 이니셔티브 프로세스 실행 요청
      if (game.user.isGM) {
        // GM이면 직접 실행
        await executeInitiativeProcess(this);
      } else {
        // 플레이어면 GM에게 소켓으로 전달
        game.socket.emit('system.dx3rd-emanim', {
          type: 'executeInitiativeProcess',
          combatId: this.id
        });
      }
      
      // nextTurn은 메인 프로세스 개시 버튼에서 실행하므로 여기서는 실행 안 함
      return;
      // 커스텀 로직 끝
    };
  }
  
  // Previous Turn 버튼 클릭 시 처리
  if (!Combat.prototype.previousTurn._dx3rdOriginal) {
    // 원본 메서드를 변수에 저장
    const originalPreviousTurn = Combat.prototype.previousTurn;
    if (typeof originalPreviousTurn !== 'function') {
      console.warn('DX3rd | Combat - previousTurn is not a function');
      return;
    }
    
    // 원본 메서드 저장
    Combat.prototype.previousTurn._dx3rdOriginal = originalPreviousTurn;
    
    Combat.prototype.previousTurn = async function(...args) {
      // 원본 메서드 래퍼 (저장된 변수 사용)
      const wrapped = async () => {
        return await originalPreviousTurn.apply(this, args);
      };
      
      // 커스텀 로직 시작
      // 현재 컴배턴트 확인
      const currentCombatant = this.combatant;
      
      // 프로세스 컴배턴트 확인
      const isProcessCombatant = currentCombatant?.getFlag('dx3rd-emanim', 'isProcessCombatant');
      const processType = currentCombatant?.getFlag('dx3rd-emanim', 'processType');
      
      // 셋업 프로세스에서는 일반 previousTurn 실행
      if (isProcessCombatant && processType === 'setup') {
        return wrapped();
      }
      
      const result = await wrapped();
      await syncCombatProcessToCurrentTurn(this);
      return result;
      // 커스텀 로직 끝
    };
  }
});

async function syncCombatProcessToCurrentTurn(combat) {
  if (!game.user.isGM || !combat) return;

  const currentCombatant = combat.combatant;
  if (!currentCombatant) return;

  const isProcessCombatant = currentCombatant.getFlag('dx3rd-emanim', 'isProcessCombatant');
  if (isProcessCombatant || !currentCombatant.actor) return;

  const currentProcess = combat.getFlag('dx3rd-emanim', 'currentProcess');
  if (
    currentProcess?.type === 'main' &&
    currentProcess?.actorId === currentCombatant.actor.id &&
    currentProcess?.combatantId === currentCombatant.id
  ) {
    return;
  }

  await combat.setFlag('dx3rd-emanim', 'currentProcess', {
    type: 'main',
    actorId: currentCombatant.actor.id,
    combatantId: currentCombatant.id
  });
}

// 이니셔티브 프로세스 실행
async function executeInitiativeProcess(combat) {
  // === AfterMain 큐 처리 (이니셔티브 직전) ===
  if (window.DX3rdUniversalHandler && window.DX3rdUniversalHandler.processAfterMainQueue) {
    await window.DX3rdUniversalHandler.processAfterMainQueue();
  }
  
  // 이니셔티브 프로세스 플래그 설정
  await combat.setFlag('dx3rd-emanim', 'currentProcess', {
    type: 'initiative',
    actorId: null,
    combatantId: null
  });
  
  // 이니셔티브 프로세스 채팅 메시지 출력
  const initiativeProcessMsg = game.i18n.localize('DX3rd.InitiativeProcess');
  await ChatMessage.create({
    content: `<h3 class="dx3rd-combat-msg">${initiativeProcessMsg}</h3>`,
    speaker: getGMSpeaker(),
  });
  
  // 범위 하이라이트 큐 초기화 (모든 유저에게)
  if (window.DX3rdUniversalHandler && window.DX3rdUniversalHandler.clearRangeHighlightQueue) {
    window.DX3rdUniversalHandler.clearRangeHighlightQueue();
    
    // 다른 유저들에게도 소켓으로 전송
    game.socket.emit('system.dx3rd-emanim', {
      type: 'clearRangeHighlight'
    });
  }
  
  // 이니셔티브 프로세스 매크로 실행
  await executeMacrosByPrefix('init-process-macro-');
  
  // GM에게 메인 프로세스 개시 다이얼로그 표시 (DOM 방식)
  if (!game.user.isGM) return;
  
  return new Promise((resolve) => {
    const onStart = async () => {
      dialog.remove();
      
      // 1. 모든 컴배턴트의 이니셔티브 재확인
      await combat.rollInitiative(combat.combatants.map(c => c.id));
      
      // 약간의 딜레이 (이니셔티브 업데이트 대기)
      await new Promise(resolve => setTimeout(resolve, 100));
      
      // 2. 행동 종료하지 않은 액터 중 가장 높은 이니셔티브 찾기
      let candidates = [];
      
      for (let combatant of combat.combatants) {
        // 프로세스 컴배턴트 제외
        const isProcessCombatant = combatant.getFlag('dx3rd-emanim', 'isProcessCombatant');
        if (isProcessCombatant) {
          continue;
        }
        
        // action_end 상태인 액터 제외 및 HP 체크
        const actor = combatant.actor;
        if (actor) {
          const actionEnd = actor.system?.conditions?.action_end?.active ?? false;
          if (actionEnd) {
            continue;
          }
          
          // HP 0 이하인 액터 제외
          const currentHP = actor.system?.attributes?.hp?.value ?? 0;
          if (currentHP <= 0) {
            continue;
          }
        }
        
        // 후보에 추가
        const init = combatant.initiative ?? -Infinity;
        candidates.push({ combatant, init, actor });
      }
      
      // candidates 배열을 동일한 규칙으로 정렬 (_sortCombatants와 동일)
      candidates.sort((a, b) => {
        // 1순위: 이니셔티브 (높은 순)
        if (a.init !== b.init) return b.init - a.init;
        
        // 액터가 없으면 뒤로
        if (!a.actor || !b.actor) return 0;
        
        // 2순위: 액터 타입 우선순위 (PlayerCharacter > Enemy > Ally > Troop > NPC)
        const actorTypePriority = {
          'PlayerCharacter': 1,
          'Enemy': 2,
          'Ally': 3,
          'Troop': 4,
          'NPC': 5
        };
        const aPriority = actorTypePriority[a.actor.system?.actorType] ?? 99;
        const bPriority = actorTypePriority[b.actor.system?.actorType] ?? 99;
        if (aPriority !== bPriority) return aPriority - bPriority;
        
        // 3순위: EXTRA TURN 없는 쪽 우선
        const aExtraTurn = a.actor.system?.conditions?.['extra-turn']?.active ?? false;
        const bExtraTurn = b.actor.system?.conditions?.['extra-turn']?.active ?? false;
        if (aExtraTurn !== bExtraTurn) return aExtraTurn ? 1 : -1;
        
        // 4순위: sense.total (높은 순)
        const aSense = a.actor.system?.attributes?.sense?.total ?? 0;
        const bSense = b.actor.system?.attributes?.sense?.total ?? 0;
        if (aSense !== bSense) return bSense - aSense;
        
        // 5순위: mind.total (높은 순)
        const aMind = a.actor.system?.attributes?.mind?.total ?? 0;
        const bMind = b.actor.system?.attributes?.mind?.total ?? 0;
        if (aMind !== bMind) return bMind - aMind;
        
        // 6순위: 이름 (알파벳/가나다/숫자 순)
        return a.combatant.name.localeCompare(b.combatant.name);
      });
      
      // 정렬된 candidates에서 첫 번째 선택
      const nextCombatant = candidates.length > 0 ? candidates[0].combatant : null;
      
      // 3. 다음 컴배턴트로 턴 설정
      if (nextCombatant !== null) {
        // combat.turns 배열에서 해당 컴배턴트의 인덱스 찾기
        const turnIndex = combat.turns.findIndex(t => t.id === nextCombatant.id);
        await combat.update({ turn: turnIndex });
        
        // 메인 프로세스 플래그 설정
        await combat.setFlag('dx3rd-emanim', 'currentProcess', {
          type: 'main',
          actorId: nextCombatant.actor?.id ?? null,
          combatantId: nextCombatant.id
        });
        
        // 메인 프로세스 시작 메시지 출력 (해당 액터가 말하도록)
        const mainProcessMsg = game.i18n.localize('DX3rd.MainProcess');
        const speaker = nextCombatant.actor 
          ? ChatMessage.getSpeaker({ actor: nextCombatant.actor, token: null })
          : { alias: nextCombatant.name };
        
        await ChatMessage.create({
          content: `<h3 class="dx3rd-combat-msg">${mainProcessMsg}</h3>`,
          speaker: speaker,
        });
        
        // 메인 프로세스 액터 표시 애니메이션 (모든 유저에게)
        // GM에게 직접 표시
        showTurnActor(nextCombatant.actor?.img ?? "", nextCombatant.name);
        
        // 다른 유저들에게 소켓으로 전송
        game.socket.emit('system.dx3rd-emanim', {
          type: 'showTurnActor',
          imgSrc: nextCombatant.actor?.img ?? "",
          actorName: nextCombatant.name
        });
        
        // 메인 프로세스 매크로 실행
        await executeMacrosByPrefix('main-process-macro-');
      } else {
        // 모든 액터가 행동 완료 → 클린업으로 이동
        const cleanupCombatant = combat.combatants.find(c => 
          c.getFlag('dx3rd-emanim', 'processType') === 'cleanup'
        );
        if (cleanupCombatant) {
          const cleanupIndex = combat.turns.findIndex(t => t.id === cleanupCombatant.id);
          if (cleanupIndex >= 0) {
            await combat.update({ turn: cleanupIndex });
          }
        }
      }
      
      resolve();
    };
    
    const dialog = document.createElement("div");
    dialog.id = "dx3rd-initiative-dialog";
    dialog.style.position = "fixed";
    dialog.style.top = "50%";
    dialog.style.left = "50%";
    dialog.style.transform = "translate(-50%, -50%)";
    dialog.style.background = "rgba(0, 0, 0, 0.85)";
    dialog.style.color = "white";
    dialog.style.padding = "20px 30px";
    dialog.style.border = "none";
    dialog.style.borderRadius = "8px";
    dialog.style.zIndex = "9999";
    dialog.style.textAlign = "center";
    dialog.style.fontSize = "16px";
    dialog.style.boxShadow = "0 0 10px black";
    dialog.style.minWidth = "350px";
    dialog.innerHTML = `
      <div style="margin-bottom: 20px; font-size: 1.1em; font-weight: bold;">
        ${game.i18n.localize('DX3rd.InitiativeProcess')}
      </div>
      <button 
        id="dx3rd-main-start-button" 
        style="
          width: 100%;
          height: 36px;
          background: white;
          color: black;
          border-radius: 4px;
          border: none;
          opacity: 0.5;
          font-weight: bold;
          font-size: 0.9em;
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 8px;
        "
      >
        ${game.i18n.localize("DX3rd.Confirm")}
      </button>
    `;
    // 중복 다이얼로그 방지: 이전 개시 창이 남아있으면 제거
    document.getElementById("dx3rd-initiative-dialog")?.remove();
    document.body.appendChild(dialog);

    dialog.querySelector("#dx3rd-main-start-button").addEventListener("click", onStart);
  });
}


// 컴배턴트 생성 시 자동으로 이니셔티브 설정
Hooks.on('createCombatant', async (combatant, options, userId) => {
  // GM만 실행 (권한 문제 방지)
  if (!game.user.isGM) return;
  
  // 프로세스 컴배턴트 확인
  const isProcessCombatant = combatant.getFlag('dx3rd-emanim', 'isProcessCombatant');
  const processType = combatant.getFlag('dx3rd-emanim', 'processType');
  
  let initValue;
  
  if (isProcessCombatant) {
    // 프로세스 컴배턴트에 고정 이니셔티브 할당
    if (processType === 'setup') {
      initValue = 9999; // 셋업이 가장 먼저
    } else if (processType === 'cleanup') {
      initValue = -9999; // 클린업이 가장 나중
    } else {
      initValue = 0;
    }
  } else {
    // 일반 액터
    const actor = combatant.actor;
    if (!actor) return;
    
    // 액터의 행동치 값 가져오기
    initValue = Number(actor.system?.attributes?.init?.value ?? 0);
    
    // 전투가 이미 진행 중인 경우 (round >= 1) action_end 체크
    const combat = combatant.combat;
    if (combat && combat.round >= 1 && combat.started) {
      // action_end를 true로 설정
      await actor.update({
        'system.conditions.action_end.active': true
      });
    }
  }
  
  // 이니셔티브 설정
  await combatant.update({ initiative: initValue });
});

// 전투 시작 시 셋업/클린업 프로세스 컴배턴트 추가
Hooks.on('createCombat', async (combat, options, userId) => {
  // GM만 생성
  if (!game.user.isGM) return;
  
  const setupName = game.i18n.localize('DX3rd.SetupProcess');
  const cleanupName = game.i18n.localize('DX3rd.CleanupProcess');
  
  await combat.createEmbeddedDocuments("Combatant", [
    {
      name: setupName,
      initiative: 999,
      img: "icons/svg/clockwork.svg",
      flags: {
        'dx3rd-emanim': {
          isProcessCombatant: true,
          processType: 'setup'
        }
      }
    },
    {
      name: cleanupName,
      initiative: -999,
      img: "icons/svg/clockwork.svg",
      flags: {
        'dx3rd-emanim': {
          isProcessCombatant: true,
          processType: 'cleanup'
        }
      }
    }
  ]);
});

// 전투 시작 버튼을 눌렀을 때 채팅 메시지 출력
Hooks.on('combatStart', async (combat, updateData) => {
  // GM만 메시지 전송
  if (!game.user.isGM) return;
  
  // 전투 시작 시 프로세스 플래그 초기화
  await combat.unsetFlag('dx3rd-emanim', 'currentProcess');
  
  const combatStartMsg = game.i18n.localize('DX3rd.CombatStart');
  await ChatMessage.create({
    content: `<h3 class="dx3rd-combat-start-msg">${combatStartMsg}</h3>`,
    speaker: getGMSpeaker(),
  });
  
  // 전투 시작 매크로 실행
  await executeMacrosByPrefix('combat-start-macro-');
});

// 턴 변경 시 셋업/클린업 프로세스 메시지 출력 및 라운드 변경 시 상태 초기화
Hooks.on('updateCombat', async (combat, changes, options, userId) => {
  // GM만 실행
  if (!game.user.isGM) return;
  
  // 라운드가 변경되었을 때 현재 캔버스의 토큰 액터들의 행동 상태 초기화 (캐릭터 + 에너미)
  if ('round' in changes) {
    const currentScene = game.scenes.active;
    if (currentScene) {
      const tokensWithActors = currentScene.tokens.filter(t => t.actor && (t.actor.type === 'character' || t.actor.type === 'enemy'));
      
      for (const tokenDoc of tokensWithActors) {
        const actor = tokenDoc.actor;
        if (!actor) continue;
        
        // 행동 종료 및 행동 대기 상태 초기화
        const updates = {
          'system.conditions.action_end.active': false,
          'system.conditions.action_delay.active': false,
          'system.conditions.action_delay.value': 0
        };
        
        // 추가 행동 value를 max 값으로 초기화
        const extraTurnMax = actor.system?.conditions?.['extra-turn']?.max ?? 0;
        if (extraTurnMax > 0) {
          updates['system.conditions.extra-turn.value'] = extraTurnMax;
        }
        
        await actor.update(updates);
      }
    }
    
    // round disable hook 실행
    if (typeof DX3rdDisableHooks !== 'undefined') {
      await DX3rdDisableHooks.executeDisableHook('round', null);
    }
  }
  
  // turn이 변경되었을 때만 실행
  if (!('turn' in changes)) return;
  
  const currentCombatant = combat.combatant;
  if (!currentCombatant) return;
  
  // 프로세스 컴배턴트인지 확인
  const isProcessCombatant = currentCombatant.getFlag('dx3rd-emanim', 'isProcessCombatant');
  if (!isProcessCombatant) return;
  
  const processType = currentCombatant.getFlag('dx3rd-emanim', 'processType');
  
  // 셋업 프로세스인 경우
  if (processType === 'setup') {
    const roundText = game.i18n.localize('DX3rd.Round');
    const setupText = game.i18n.localize('DX3rd.SetupProcess');
    const currentRound = combat.round || 1;
    
    // 셋업 프로세스 플래그 설정
    await combat.setFlag('dx3rd-emanim', 'currentProcess', {
      type: 'setup',
      actorId: null,
      combatantId: null
    });
    
    // 라운드 메시지
    await ChatMessage.create({
      content: `<h3 class="dx3rd-combat-msg">${roundText} ${currentRound}</h3>`,
      speaker: getGMSpeaker(),
    });
    
    // 셋업 프로세스 메시지
    await ChatMessage.create({
      content: `<h3 class="dx3rd-combat-msg">${setupText}</h3>`,
      speaker: getGMSpeaker(),
    });
    
    // 셋업 프로세스 매크로 실행
    await executeMacrosByPrefix('setup-process-macro-');
  }
  
  // 클린업 프로세스인 경우
  if (processType === 'cleanup') {
    const cleanupText = game.i18n.localize('DX3rd.CleanupProcess');
    
    // 클린업 프로세스 플래그 설정
    await combat.setFlag('dx3rd-emanim', 'currentProcess', {
      type: 'cleanup',
      actorId: null,
      combatantId: null
    });
    
    await ChatMessage.create({
      content: `<h3 class="dx3rd-combat-msg">${cleanupText}</h3>`,
      speaker: getGMSpeaker(),
    });
    
    // 클린업 프로세스 매크로 실행
    await executeMacrosByPrefix('cleanup-process-macro-');
    
    // SpellCalamity 5번 효과 count 감소 처리
    if (game.user.isGM) {
      for (const combatant of combat.combatants) {
        const actor = combatant.actor;
        if (!actor) continue;
        
        const appliedEffects = window.DX3rdAppliedEffects?.collect
          ? window.DX3rdAppliedEffects.collect(actor)
          : (actor.system?.attributes?.applied || {});

        for (const [appliedKey, appliedEffect] of Object.entries(appliedEffects)) {
          if (appliedEffect && appliedEffect.attributes) {
            // spell_disabled 효과가 있는지 확인
            let hasSpellDisabled = false;
            let currentCount = 0;
            
            for (const [attrName, attrValue] of Object.entries(appliedEffect.attributes)) {
              // spell_disabled는 attrName 또는 객체 key로만 판별한다.
              //   (`attrValue === true`절은 임의 boolean-true 속성까지 오인하므로 제거 — universal-handler와 동일)
              if (attrName === 'spell_disabled' ||
                  (typeof attrValue === 'object' && attrValue?.key === 'spell_disabled')) {
                hasSpellDisabled = true;
                // count 값 찾기
                const countValue = appliedEffect.attributes?.spell_disabled_count;
                if (countValue !== undefined) {
                  currentCount = typeof countValue === 'object' ? (countValue.value || 0) : Number(countValue || 0);
                }
                break;
              }
            }
            
            if (hasSpellDisabled && currentCount > 0) {
              const newCount = currentCount - 1;

              if (newCount <= 0) {
                // count가 0 이하가 되면 applied 제거
                await window.DX3rdAppliedEffects.remove(actor, appliedKey);
              } else {
                // count만 감소: payload 복제 후 재저장
                const payload = foundry.utils.deepClone(appliedEffect);
                const cv = payload.attributes.spell_disabled_count;
                if (cv && typeof cv === 'object') cv.value = newCount;
                else payload.attributes.spell_disabled_count = newCount;
                await window.DX3rdAppliedEffects.set(actor, appliedKey, payload);
              }
            }
          }
        }
      }
    }
    
    // dazed 상태이상 해제 처리
    if (game.user.isGM) {
      // 조건 맵 초기화
      if (!window.DX3rdConditionTriggerMap) {
        window.DX3rdConditionTriggerMap = new Map();
      }
      
      // dazed 상태이상을 가진 액터들 수집
      const dazedActors = [];
      for (const combatant of combat.combatants) {
        const actor = combatant.actor;
        if (!actor) continue;
        
        // dazed 상태이상이 있는지 확인
        const dazedEffect = actor.effects.find(e => e.statuses.has('dazed'));
        if (dazedEffect) {
          dazedActors.push(actor);
        }
      }
      
      // dazed 메시지 병합을 위한 배열
      const dazedMessageParts = [];
      
      // 각 액터의 dazed 해제 처리
      for (const actor of dazedActors) {
        // 메시지 제어 플래그 설정
        const mapKey = `${actor.id}:dazed`;
        window.DX3rdConditionTriggerMap.set(mapKey, {
          triggerItemName: game.i18n.localize('DX3rd.CleanupProcess'),
          suppressMessage: true,
          bulkRemove: true
        });
        
        await actor.toggleStatusEffect('dazed', { active: false });
        
        // 메시지 부분 추가
        dazedMessageParts.push(`<div>· ${actor.name}</div>`);
        
        // 맵 정리
        window.DX3rdConditionTriggerMap.delete(mapKey);
      }
      
      // 병합된 dazed 해제 메시지 출력
      if (dazedMessageParts.length > 0) {
        const dazedHeader = game.i18n.localize('DX3rd.DazedClear');
        const dazedContent = `<div class="dx3rd-item-chat"><div class="item-header"><strong>${dazedHeader}</strong></div>${dazedMessageParts.join('')}</div>`;
        
        await ChatMessage.create({
          content: dazedContent,
          speaker: getGMSpeaker(),
        });
      }
    }
    
    // 힐링 및 사독 처리 (500ms 딜레이)
    setTimeout(async () => {
      // GM만 처리
      if (!game.user.isGM) {
        return;
      }
      
      // === 힐링 처리 (먼저 처리) ===
      const healingActors = [];
      for (const combatant of combat.combatants) {
        const actor = combatant.actor;
        if (!actor) continue;
        
        const healingActive = actor.system?.conditions?.healing?.active ?? false;
        // 시트 입력이 text라 string으로 저장될 수 있으므로 숫자로 강제 변환
        const healingValue = Number(actor.system?.conditions?.healing?.value ?? 0);
        const currentHP = actor.system?.attributes?.hp?.value ?? 0;
        const maxHP = actor.system?.attributes?.hp?.max ?? 0;
        
        // HP가 0이 아니고, max가 아니고, 힐링이 활성화되어 있고, value가 1 이상인 경우만 처리
        if (healingActive && healingValue > 0 && currentHP > 0 && currentHP < maxHP) {
          healingActors.push({ actor, value: healingValue, currentHP });
        }
      }
      
      // 힐링 메시지 병합을 위한 배열
      const healingMessageParts = [];
      
      // 각 액터의 힐링 처리
      for (const { actor, value, currentHP } of healingActors) {
        const maxHP = actor.system?.attributes?.hp?.max ?? 0;
        const newHP = Math.min(maxHP, currentHP + value);
        const actualHealing = newHP - currentHP;
        
        // HP 업데이트
        await actor.update({ 'system.attributes.hp.value': newHP });
        
        // 메시지 부분 추가
        healingMessageParts.push(`<div>· ${actor.name} (HP +${actualHealing})</div>`);
      }
      
      // 병합된 힐링 메시지 출력
      if (healingMessageParts.length > 0) {
        const healingHeader = game.i18n.localize('DX3rd.HealingCheck');
        const healingContent = `<div class="dx3rd-item-chat"><div class="item-header"><strong>${healingHeader}</strong></div>${healingMessageParts.join('')}</div>`;
        
        await ChatMessage.create({
          content: healingContent,
          speaker: getGMSpeaker(),
        });
      }
      
      // === 사독 데미지 처리 (힐링 처리 후) ===
      const poisonedActors = [];
      for (const combatant of combat.combatants) {
        const actor = combatant.actor;
        if (!actor) continue;
        
        const poisonedActive = actor.system?.conditions?.poisoned?.active ?? false;
        const poisonedRank = actor.system?.conditions?.poisoned?.value ?? 0;
        const currentHP = actor.system?.attributes?.hp?.value ?? 0;
        
        // HP가 0이 아니고, 사독이 활성화되어 있고, value가 1 이상인 경우만 처리 (value가 0이면 생략)
        if (poisonedActive && poisonedRank > 0 && currentHP > 0) {
          poisonedActors.push({ actor, rank: poisonedRank });
        }
      }
      
      if (poisonedActors.length === 0) {
        return;
      }
      
      // 사독 경감 설정 확인
      const reducePoisonEnabled = game.settings.get('dx3rd-emanim', 'reducePoison');
      
      // 사독 메시지 병합을 위한 배열
      const poisonMessageParts = [];
      
      // 각 액터의 사독 데미지 처리
      for (const { actor, rank } of poisonedActors) {
        const poisonDamage = rank * 3;
        const currentHP = actor.system?.attributes?.hp?.value ?? 0;
        
        // 사독 경감 적용
        let actualDamage = poisonDamage;
        if (reducePoisonEnabled) {
          const reduce = actor.system?.attributes?.reduce?.value ?? 0;
          actualDamage = Math.max(0, poisonDamage - reduce);
        }
        
        const newHP = Math.max(0, currentHP - actualDamage);
        
        // HP 업데이트
        await actor.update({ 'system.attributes.hp.value': newHP });
        
        // 메시지 부분 추가
        poisonMessageParts.push(`<div>· ${actor.name} (HP -${actualDamage})</div>`);
      }
      
      // 병합된 사독 메시지 출력
      if (poisonMessageParts.length > 0) {
        const poisonHeader = game.i18n.localize('DX3rd.PoisonedCheck');
        const poisonContent = `<div class="dx3rd-item-chat"><div class="item-header"><strong>${poisonHeader}</strong></div>${poisonMessageParts.join('')}</div>`;
        
        await ChatMessage.create({
          content: poisonContent,
          speaker: getGMSpeaker(),
        });
      }
    }, 500);
  }
});

// 전투 종료 시 채팅 메시지 출력
Hooks.on('deleteCombat', async (combat, options, userId) => {
  // GM만 메시지 전송
  if (!game.user.isGM) return;
  
  // AfterMain 큐 초기화
  if (window.DX3rdUniversalHandler && window.DX3rdUniversalHandler.clearAfterMainQueue) {
    await window.DX3rdUniversalHandler.clearAfterMainQueue();
  }
  
  // 전투 종료 채팅 메시지 출력
  const combatEndMsg = game.i18n.localize('DX3rd.CombatEnd');
  await ChatMessage.create({
    content: `<h3 class="dx3rd-combat-end-msg">${combatEndMsg}</h3>`,
    speaker: getGMSpeaker(),
  });
  
  // 전투 종료 매크로 실행
  await executeMacrosByPrefix('combat-end-macro-');
  
  // 현재 씬의 토큰 액터만 Fist 아이템 리셋 및 행동 상태 초기화 (캐릭터 + 에너미)
  const fistName = game.i18n.localize("DX3rd.Fist");
  const currentScene = game.scenes.active;
  
  if (currentScene) {
    const tokensWithActors = currentScene.tokens.filter(t => t.actor && (t.actor.type === 'character' || t.actor.type === 'enemy'));
    
    for (const tokenDoc of tokensWithActors) {
      const actor = tokenDoc.actor;
      
      // Fist 아이템 리셋·임시 아이템 삭제는 캐릭터만
      if (actor.type === 'character') {
        const fistItems = actor.items.filter(item => {
          if (item.type !== 'weapon') return false;
          const isFist = item.name === fistName || item.name.includes(`[${fistName}]`);
          return isFist;
        });
        for (const fistItem of fistItems) {
          await fistItem.update({
            'name': fistName,
            'system.add': '+0',
            'system.attack': '-5',
            'system.guard': '0',
            'system.range': game.i18n.localize("DX3rd.Engage")
          });
        }
        const tempItemText = game.i18n.localize('DX3rd.TemporaryItem');
        const tempItems = actor.items.filter(item => {
          if (!['weapon', 'protect', 'vehicle'].includes(item.type)) return false;
          return item.name.endsWith(tempItemText);
        });
        if (tempItems.length > 0) {
          const itemIds = tempItems.map(item => item.id);
          await actor.deleteEmbeddedDocuments('Item', itemIds);
        }
      }
      
      // 행동 상태 초기화 (캐릭터 + 에너미 공통)
      const updates = {
        'system.conditions.action_end.active': false,
        'system.conditions.action_delay.active': false,
        'system.conditions.action_delay.value': 0
      };
      
      // 추가 행동 value를 max 값으로 초기화
      const extraTurnMax = actor.system?.conditions?.['extra-turn']?.max ?? 0;
      if (extraTurnMax > 0) {
        updates['system.conditions.extra-turn.value'] = extraTurnMax;
      }
      
      await actor.update(updates);
    }
  } else {
    console.warn('DX3rd | No active scene found, skipping Fist and action state reset');
  }
  
  // 전투 종료 시 disable hooks 실행 (roll, major, reaction, main, round, scene)
  if (typeof DX3rdDisableHooks !== 'undefined') {
    const timings = ['roll', 'major', 'reaction', 'guard', 'main', 'round', 'scene'];
    for (const timing of timings) {
      await DX3rdDisableHooks.executeDisableHook(timing, null);
    }
  } else {
    console.warn('DX3rd | DisableHooks not found, skipping cleanup');
  }
  
  // 전투 종료 시 모든 컴배턴트의 상태이상 해제 (메시지 억제)
  const conditionsToRemove = ['rigor', 'pressure', 'dazed', 'poisoned', 'hatred', 'fear', 'berserk', 'boarding', 'fly', 'stealth'];
  
  // 조건 맵 초기화
  if (!window.DX3rdConditionTriggerMap) {
    window.DX3rdConditionTriggerMap = new Map();
  }
  
  for (const combatant of combat.combatants) {
    const actor = combatant.actor;
    if (!actor) continue;
    
    for (const condition of conditionsToRemove) {
      if (actor.effects.find(e => e.statuses.has(condition))) {
        // 메시지 제어 플래그 설정
        const mapKey = `${actor.id}:${condition}`;
        window.DX3rdConditionTriggerMap.set(mapKey, {
          triggerItemName: game.i18n.localize('DX3rd.CombatEnd'),
          suppressMessage: true,
          bulkRemove: true
        });
        
        await actor.toggleStatusEffect(condition, { active: false });
        
        // 맵 정리
        window.DX3rdConditionTriggerMap.delete(mapKey);
      }
    }
  }
});

// 소켓 리스너 설정 (이니셔티브 프로세스 요청 수신)
Hooks.once('ready', () => {
  game.socket.on('system.dx3rd-emanim', async (data) => {
    // showTurnActor는 모든 유저가 처리
    if (data.type === 'showTurnActor') {
      showTurnActor(data.imgSrc, data.actorName);
      return;
    }
    
    // GM만 처리하되, 접속한 GM이 여러 명이면 대표 GM 한 명만 처리한다.
    // (모두 처리하면 이니셔티브 진행/disable hook이 GM 수만큼 중복 실행됨)
    // game.users.activeGM은 모든 클라이언트에서 동일하게 판정되는 단일 GM.
    if (!game.user.isGM) return;
    const responsibleGM = game.users.activeGM
      ?? game.users.find(u => u.isGM && u.active)
      ?? game.users.find(u => u.isGM);
    if (responsibleGM && game.user.id !== responsibleGM.id) return;

    if (data.type === 'executeInitiativeProcess') {
      const combat = game.combats.get(data.combatId);
      if (combat) {
        await executeInitiativeProcess(combat);
      }
    }
    
    if (data.type === 'executeDisableHook') {
      if (typeof DX3rdDisableHooks !== 'undefined' && data.timing) {
        await DX3rdDisableHooks.executeDisableHook(data.timing, null);
      }
    }
    
  });
});

// 액터의 action_end/action_delay 상태 변경 감지 (이니셔티브 재계산용)
Hooks.on('updateActor', async (actor, changes, options, userId) => {
  // GM만 실행 (권한 문제 방지)
  if (!game.user.isGM) return;
  
  // action_end나 action_delay 상태가 변경되었는지 확인
  const actionEndChanged = changes.system?.conditions?.action_end?.active !== undefined;
  const actionDelayChanged = changes.system?.conditions?.action_delay?.active !== undefined;
  
  if (!actionEndChanged && !actionDelayChanged) return;
  
  // 현재 진행 중인 전투가 있는지 확인
  const combat = game.combats?.active;
  if (!combat || !combat.started) return;
  
  // 해당 액터의 컴배턴트 찾기
  const combatant = combat.combatants.find(c => c.actor?.id === actor.id);
  if (!combatant) return;
  
  // 이니셔티브 재계산 (상태 변경 시 항상)
  await combat.rollInitiative([combatant.id]);
});

// ========== AfterDamage 큐 시스템 ========== //
