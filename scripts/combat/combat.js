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

// 컴배턴트 하나의 이니셔티브 값을 산출한다. 굴림은 없다 — 액터의 【행동치】가 그대로 값이다.
// rollInitiative 와 부분 갱신(refreshCombatantInitiative)이 같은 규칙을 쓰도록 한 곳에 둔다.
function computeInitiativeValue(combatant) {
  // 셋업/클린업은 진행 표시를 위한 가상 컴배턴트다. 주도권을 굴리거나 소유하지 않는다.
  if (!combatant || combatant.getFlag('dx3rd-emanim', 'isProcessCombatant')) return null;
  const actor = combatant.actor;
  if (!actor) return 0;
  const actionValue = Number(actor.system?.attributes?.init?.value ?? 0);
  // 룰: 대기자는 【행동치】 무관하게 라운드 최후에 행동하되,
  // 대기자가 여럿이면 행동치가 느린(낮은) 순서대로 실행한다.
  // 이니셔티브를 -(행동치)로 두면 (1) 음수라 정상 액터 뒤로 정렬되고
  // (2) 행동치가 낮을수록 -값이 0에 가까워 더 먼저 정렬된다.
  const isActionDelay = actor.system?.conditions?.action_delay?.active ?? false;
  return isActionDelay ? -actionValue : actionValue;
}

// 컴배턴트 한 명의 이니셔티브만 다시 스냅샷한다.
// onlyIfLower: 값이 낮아질 때만 반영한다. 라운드 도중 【행동치】가 오르는 변경은
// 그 액터의 메인 종료 시점까지 보류하기 위한 것이다 — 그러지 않으면 자기 차례 직전에
// 행동치를 올려 남들보다 앞질러 행동할 수 있다. 내려가는 변경은 자기 순서를 뒤로
// 미루는 것이라 즉시 통해도 무방하다.
async function refreshCombatantInitiative(combat, combatantId, {onlyIfLower = false} = {}) {
  if (!combat || !combatantId || !game.user.isGM) return;
  const combatant = combat.combatants.get(combatantId);
  const next = computeInitiativeValue(combatant);
  if (next === null) return;
  const current = Number(combatant.initiative);
  if (Number.isFinite(current)) {
    if (current === next) return;
    if (onlyIfLower && next > current) return;
  }
  await combat.updateEmbeddedDocuments('Combatant', [{_id: combatantId, initiative: next}]);
}

(function() {
  // v13/v14 호환: Combat, Combatant 글로벌이 없을 경우 폴백
  const _CombatBase = foundry.documents?.Combat ?? globalThis.Combat;
  const _CombatantBase = foundry.documents?.Combatant ?? globalThis.Combatant;
  const toFiniteInitiative = (value) => {
    // 프로세스 컴배턴트는 이니셔티브 순서에 참여하지 않는다.
    if (value === null || value === undefined || value === "") return -Infinity;
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
        const initValue = computeInitiativeValue(combatant);
        if (initValue === null) continue;
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

// Next Turn 버튼을 턴 프로세스 상태 기계에 연결
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

      // FVTT의 다음 턴 버튼은 시스템 전투 상태 기계의 단일 진입점으로 보낸다.
      // 행동 종료/대기는 진행 표시줄에서 명시적으로 선택한 경우에만 아래 기존 규칙 처리를 사용한다.
      if (!this._dx3rdForcedTurnChoice) {
        return window.DX3rdCombatFlow?.advance?.(this, 'forward');
      }
      
      // 커스텀 로직 시작
      // 현재 컴배턴트 확인
      const currentCombatant = this.combatant;
      
      // 셋업/클린업은 Combat 플래그로만 관리한다. 가상 컴배턴트는 만들지 않는다.
      const currentProcess = this.getFlag('dx3rd-emanim', 'currentProcess');
      if (currentProcess?.type !== 'main') return;
      
      // 액터가 있는 일반 컴배턴트만 다이얼로그 표시
      if (!currentCombatant || !currentCombatant.actor) {
        return wrapped();
      }
      
      // 행동 대기 상태 확인
      const actor = currentCombatant.actor;
      const isDelayed = actor?.system?.conditions?.action_delay?.active ?? false;
      
      // 전투 카운트 바에서 명시적으로 고른 종료/대기는 다이얼로그를 열지 않는다.
      const forcedChoice = this._dx3rdForcedTurnChoice;
      delete this._dx3rdForcedTurnChoice;

      // FVTT 전투 트래커의 다음 턴은 시스템 선택창 없이 원래대로 즉시 넘긴다.
      // 행동 종료/대기는 공용 전투 진행 표시줄에서만 명시적으로 선택한다.
      if (!forcedChoice) {
        // 원본 nextTurn이 실제로 선택한 다음 전투원을 기준으로 이니셔티브를 연다.
        const result = await wrapped();
        const nextCombatant = this.combatant;
        const process = this.getFlag('dx3rd-emanim', 'currentProcess');
        if (nextCombatant?.actor && process?.type !== 'setup' && process?.type !== 'cleanup') {
          await executeInitiativeProcess(this, nextCombatant.id);
        }
        return result;
      }
      const choice = forcedChoice;
      // EXTRA TURN 이 붙으면 행동 종료를 골라도 action_end 가 해제되어 이번 라운드에
      // 한 번 더 행동한다. 대기와 마찬가지로 완료 집합에서 되돌려야 한다.
      let extraTurnGranted = false;

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
            extraTurnGranted = true;
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
        
        // main disable hook 실행 요청
        if (game.user.isGM) {
          // GM이면 직접 실행
          if (typeof DX3rdDisableHooks !== 'undefined') {
            console.log('DX3rd | Executing main disable hook for all actors');
            await DX3rdDisableHooks.executeDisableHook('main', null);
          }
        } else {
          // 플레이어면 GM에게 소켓으로 전달
          window.DX3rdSocketRouter.emit({
            type: 'executeDisableHook',
            timing: 'main',
            combatId: this.id,
            actorId: currentCombatant.actor?.id
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

        await ChatMessage.create({
          content: game.i18n.localize("DX3rd.ActionDelay"),
          speaker: ChatMessage.getSpeaker({ actor })
        });
        
        // main disable hook 실행 요청
        if (game.user.isGM) {
          // GM이면 직접 실행
          if (typeof DX3rdDisableHooks !== 'undefined') {
            await DX3rdDisableHooks.executeDisableHook('main', null);
          }
        } else {
          // 플레이어면 GM에게 소켓으로 전달
          window.DX3rdSocketRouter.emit({
            type: 'executeDisableHook',
            timing: 'main',
            combatId: this.id,
            actorId: currentCombatant.actor?.id
          });
        }
      }
      
      // 종료/대기 뒤에도 같은 상태 기계로 다음 단계로 진행한다.
      // 플레이어는 자신의 액터 상태는 갱신할 수 있어도 Combat 문서를 전환할
      // 권한은 없으므로, GM에게 현재 메인 프로세스의 진행을 요청한다.
      // 대기를 고른 경우에만 완료 집합을 되돌린다. 플래그를 쓰는 건 GM이므로
      // 플레이어 경로에서는 소켓으로 그 사실을 함께 넘긴다.
      const deferCurrent = choice === 'delay' || extraTurnGranted;
      if (game.user.isGM) {
        await advanceCombatState(this, 'forward', {deferCurrent});
      } else {
        window.DX3rdSocketRouter.emit({
          type: 'advanceCombatProcess',
          combatId: this.id,
          actorId: currentCombatant.actor?.id,
          deferCurrent
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
      // 되감기도 상태 기계 단일 진입점으로 보낸다. 원본 previousTurn 은 쓰지 않는다
      // (원본은 프로세스 단계를 모른 채 전투원 포인터만 되돌린다).
      return window.DX3rdCombatFlow?.advance?.(this, 'backward');
    };
  }
});

// === 라운드 진행 판정 =========================================================
// 라운드가 끝났는지를 combat.turns 의 "배열 위치"(turns[currentIndex + 1] 이 있는가)로
// 판정하면, 행동 대기로 이니셔티브가 재정렬되는 순간 남은 전투원을 통째로 건너뛴다.
// 그래서 위치 대신 "이번 라운드에 메인 프로세스를 마친 전투원 집합"을 기준으로 삼는다.
//   - 메인 시작 시 집합에 추가 (startMainProcessFromInitiative)
//   - 행동 대기 / EXTRA TURN 시 집합에서 제거 = 아직 행동하지 않은 것으로 되돌림
//     (advanceCombatState 의 deferCurrent)
//   - 셋업(라운드 시작)에서 비움
// 종료 보장: 대기는 라운드당 1회만 고를 수 있고(action_delay 는 라운드 리셋에서만 풀린다),
// EXTRA TURN 은 고를 때마다 extra-turn.value 를 1 깎는다. 되돌림 횟수가 액터당 유한하므로
// 라운드는 반드시 종료한다.
const MAIN_DONE_FLAG = 'mainDoneCombatantIds';

function getMainDone(combat) {
  return new Set(combat?.getFlag('dx3rd-emanim', MAIN_DONE_FLAG) || []);
}

async function setMainDone(combat, ids) {
  if (!combat || !game.user.isGM) return;
  await combat.setFlag('dx3rd-emanim', MAIN_DONE_FLAG, Array.from(ids));
}

// 이번 라운드에 아직 행동할 수 있는 전투원인가.
function isMainEligible(combatant) {
  if (!combatant || combatant.getFlag('dx3rd-emanim', 'isProcessCombatant')) return false;
  const actor = combatant.actor;
  // 액터가 없는 전투원은 수동 진행용으로 남겨 둔다(기존 동작 유지).
  if (!actor) return true;
  if (actor.system?.conditions?.action_end?.active) return false;
  return (actor.system?.attributes?.hp?.value ?? 0) > 0;
}

// 아직 메인 프로세스를 받지 않은 전투원들. 현재 이니셔티브 정렬 순서를 그대로 따른다.
function getPendingMainCombatants(combat) {
  if (!combat) return [];
  const done = getMainDone(combat);
  return combat.turns.filter(combatant => !done.has(combatant.id) && isMainEligible(combatant));
}

async function clearProcessInitiatives(combat) {
  if (!combat || !game.user.isGM) return;
  const processIds = combat.combatants
    .filter(combatant => combatant.getFlag('dx3rd-emanim', 'isProcessCombatant'))
    .map(combatant => combatant.id);
  if (processIds.length) await combat.deleteEmbeddedDocuments('Combatant', processIds);
}

// 이전 버전에서 만들어진 셋업/클린업 가상 컴배턴트도 한 번만 정리한다.
Hooks.once('ready', async () => {
  if (game.user.isGM && game.combat) await clearProcessInitiatives(game.combat);
});

async function advanceToSetupProcess(combat) {
  if (!combat || !game.user.isGM) return;
  const process = combat.getFlag('dx3rd-emanim', 'currentProcess');
  // 새 라운드는 항상 Foundry 순서의 첫 전투원에서 시작한다.
  // 라운드만 올리고 이전 액터 커서를 유지하면 셋업/이니셔티브 대상이 뒤섞인다.
  if (process?.needsRoundAdvance) {
    await combat.update({round: (combat.round || 0) + 1, turn: 0});
    // 라운드 지속 효과(disable: 'round')의 만료는 클린업(handleCombatUpdate)에서 한다.
    // 이니셔티브 재굴림보다 먼저 만료돼야 EXTRA TURN 패널티가 트래커에 남지 않는다.
    // (handleCombatUpdate 의 'round' 분기는 도달할 수 없어 한때 여기 있었다.)
  } else if (combat.turn !== 0) {
    await combat.update({turn: 0});
  }
  await runCombatProcess(combat, 'setup');
}

// 이니셔티브 프로세스에서 메인 프로세스를 시작한다.
// 확인 다이얼로그를 거치지 않고 전투 진행 표시줄의 이니셔티브 신호를 눌러 실행한다.
async function startMainProcessFromInitiative(combat) {
  if (!combat || !game.user.isGM) return;

  // 순서는 셋업에서 확정된 스냅샷을 쓴다. 여기서 전원을 다시 굴리지 않는다 —
  // 라운드 도중에 바뀐 【행동치】는 다음 셋업까지 미뤄야 하기 때문이다.
  // (자기 순서를 뒤로 미루는 변경만 메인 종료 시점에 개별 반영된다.)

  // 행동 종료하지 않은 액터 중 가장 높은 이니셔티브 찾기
  let candidates = [];

  const alreadyDone = getMainDone(combat);
  for (const combatant of combat.combatants) {
    if (!isMainEligible(combatant)) continue;
    // 이번 라운드에 이미 메인을 마친 전투원은 후보에서 뺀다.
    if (alreadyDone.has(combatant.id)) continue;
    candidates.push({ combatant, init: combatant.initiative ?? -Infinity, actor: combatant.actor });
  }

  candidates.sort((a, b) => {
    if (a.init !== b.init) return b.init - a.init;
    if (!a.actor || !b.actor) return 0;
    const actorTypePriority = {PlayerCharacter: 1, Enemy: 2, Ally: 3, Troop: 4, NPC: 5};
    const aPriority = actorTypePriority[a.actor.system?.actorType] ?? 99;
    const bPriority = actorTypePriority[b.actor.system?.actorType] ?? 99;
    if (aPriority !== bPriority) return aPriority - bPriority;
    const aExtraTurn = a.actor.system?.conditions?.['extra-turn']?.active ?? false;
    const bExtraTurn = b.actor.system?.conditions?.['extra-turn']?.active ?? false;
    if (aExtraTurn !== bExtraTurn) return aExtraTurn ? 1 : -1;
    const aSense = a.actor.system?.attributes?.sense?.total ?? 0;
    const bSense = b.actor.system?.attributes?.sense?.total ?? 0;
    if (aSense !== bSense) return bSense - aSense;
    const aMind = a.actor.system?.attributes?.mind?.total ?? 0;
    const bMind = b.actor.system?.attributes?.mind?.total ?? 0;
    if (aMind !== bMind) return bMind - aMind;
    return a.combatant.name.localeCompare(b.combatant.name);
  });

  const pendingCombatantId = combat.getFlag('dx3rd-emanim', 'currentProcess')?.pendingCombatantId;
  const nextCombatant = candidates.find(candidate => candidate.combatant.id === pendingCombatantId)?.combatant
    || (candidates.length > 0 ? candidates[0].combatant : null);
  if (nextCombatant !== null) {
    const turnIndex = combat.turns.findIndex(t => t.id === nextCombatant.id);
    await combat.update({ turn: turnIndex });
    await combat.setFlag('dx3rd-emanim', 'currentProcess', {
      type: 'main', actorId: nextCombatant.actor?.id ?? null, combatantId: nextCombatant.id
    });
    // 이번 라운드의 메인 프로세스를 받은 것으로 기록한다. 라운드 종료 판정의 기준.
    alreadyDone.add(nextCombatant.id);
    await setMainDone(combat, alreadyDone);
    // 매 메인 프로세스 시작 시 이전 액션 표시를 초기화한다.
    await combat.unsetFlag('dx3rd-emanim', 'actionTrackerUsage');

    showTurnActor(nextCombatant.actor?.img ?? "", nextCombatant.name);
    window.DX3rdSocketRouter.emit({type: 'showTurnActor', imgSrc: nextCombatant.actor?.img ?? "", actorName: nextCombatant.name});
    await executeMacrosByPrefix('main-process-macro-');
  } else {
    await runCombatProcess(combat, 'cleanup', {needsRoundAdvance: true});
  }
}

window.DX3rdCombatFlow = window.DX3rdCombatFlow || {};
window.DX3rdCombatFlow.startMainProcessFromInitiative = startMainProcessFromInitiative;
window.DX3rdCombatFlow.showTurnActor = showTurnActor;
window.DX3rdCombatFlow.executeInitiativeProcess = executeInitiativeProcess;
window.DX3rdCombatFlow.advanceCombatState = advanceCombatState;

// 이니셔티브 프로세스 실행
async function executeInitiativeProcess(combat, pendingCombatantId = null) {
  await clearProcessInitiatives(combat);
  // === AfterMain 큐 처리 (이니셔티브 직전) ===
  if (window.DX3rdUniversalHandler && window.DX3rdUniversalHandler.processAfterMainQueue) {
    await window.DX3rdUniversalHandler.processAfterMainQueue();
  }

  // 매 이니셔티브 프로세스마다 전원을 다시 계산해 순서를 즉시 반영한다.
  // 단 【행동치】가 오르는 변경은 그 액터의 메인 종료까지 보류한다(onlyIfLower).
  // 보류분은 advanceCombatState 의 메인 종료 지점에서 무조건 반영된다.
  for (const combatant of combat.combatants) {
    await refreshCombatantInitiative(combat, combatant.id, {onlyIfLower: true});
  }
  await new Promise(resolve => setTimeout(resolve, 100));
  if (pendingCombatantId) {
    // 되감기·네이티브 다음 턴처럼 대상을 못박아 들어온 경우다. 그 전투원은 이제 다시
    // 메인을 받아야 하므로 완료 집합에서 뺀다(그러지 않으면 후보에서 걸러진다).
    const done = getMainDone(combat);
    if (done.delete(pendingCombatantId)) await setMainDone(combat, done);
  } else {
    // 재정렬된 순서에서 아직 메인을 받지 않은 첫 전투원.
    pendingCombatantId = getPendingMainCombatants(combat)[0]?.id ?? null;
  }
  
  // 이니셔티브 프로세스 플래그 설정
  const pendingCombatant = pendingCombatantId ? combat.combatants.get(pendingCombatantId) : null;
  // 전투 트래커 커서도 이번에 행동할 전투원으로 옮긴다. 옮기지 않으면 이니셔티브
  // 단계 내내 트래커가 직전 액터를 현재 차례로 표시한다(메인 시작 때까지 어긋난다).
  // 재정렬이 끝난 뒤에 옮겨야 대기로 순서가 바뀐 경우도 맞는다.
  if (pendingCombatant) await moveCombatCursor(combat, pendingCombatant);
  await combat.setFlag('dx3rd-emanim', 'currentProcess', {
    type: 'initiative',
    actorId: pendingCombatant?.actor?.id ?? null,
    combatantId: null,
    pendingCombatantId
  });
  
  // 이니셔티브 프로세스 매크로 실행
  await executeMacrosByPrefix('init-process-macro-');
  
  // 이니셔티브 단계 자체는 여기서 멈춘다. 메인 시작은 전투 진행 표시줄에서 명시적으로 선택한다.
  document.getElementById("dx3rd-initiative-dialog")?.remove();
}

async function moveCombatCursor(combat, combatant) {
  const turn = combat.turns.findIndex(entry => entry.id === combatant?.id);
  if (turn >= 0 && combat.turn !== turn) await combat.update({turn});
}

async function enterPreviousMainProcess(combat, combatant) {
  if (!combatant?.actor) return;
  await moveCombatCursor(combat, combatant);
  // 되감기: "이 전투원까지 메인을 마친" 상태로 완료 집합을 다시 만든다.
  // 그러지 않으면 되감은 뒤 앞으로 진행할 때 남은 전투원이 없다고 보고 라운드가 끝난다.
  const index = combat.turns.findIndex(entry => entry.id === combatant.id);
  const rewound = index >= 0 ? combat.turns.slice(0, index + 1) : [combatant];
  await setMainDone(combat, rewound
    .filter(entry => !entry.getFlag('dx3rd-emanim', 'isProcessCombatant'))
    .map(entry => entry.id));
  await combat.setFlag('dx3rd-emanim', 'currentProcess', {
    type: 'main', actorId: combatant.actor.id, combatantId: combatant.id
  });
  await combat.unsetFlag('dx3rd-emanim', 'actionTrackerUsage');
}

async function advanceCombatState(combat, direction = 'forward', {deferCurrent = false} = {}) {
  if (!combat || !game.user.isGM) return;
  const process = combat.getFlag('dx3rd-emanim', 'currentProcess') || {type: 'setup'};
  const turns = combat.turns.filter(combatant => !combatant.getFlag('dx3rd-emanim', 'isProcessCombatant'));

  if (direction === 'backward') {
    if (process.type === 'main') {
      await executeInitiativeProcess(combat, process.combatantId || combat.combatant?.id);
      return;
    }
    if (process.type === 'initiative') {
      const currentIndex = turns.findIndex(combatant => combatant.id === process.pendingCombatantId);
      if (currentIndex > 0) await enterPreviousMainProcess(combat, turns[currentIndex - 1]);
      return;
    }
    if (process.type === 'cleanup' && turns.length) {
      await enterPreviousMainProcess(combat, turns[turns.length - 1]);
    }
    return;
  }

  if (process.type === 'setup') {
    await executeInitiativeProcess(combat);
    return;
  }
  if (process.type === 'initiative') {
    await startMainProcessFromInitiative(combat);
    return;
  }
  if (process.type === 'cleanup') {
    await advanceToSetupProcess(combat);
    return;
  }

  // 여기부터 메인 프로세스에서 앞으로 진행하는 경로.
  // 자기 턴이 끝나는 지점이다. 이니셔티브 프로세스에서 보류해 둔 【행동치】 상승분을
  // 여기서 무조건 반영한다 — 이미 행동을 마쳤으므로 이번 라운드를 앞지를 수 없다.
  if (process.combatantId) {
    await refreshCombatantInitiative(combat, process.combatantId);
  }

  if (deferCurrent && process.combatantId) {
    // 행동 대기를 고른 액터는 이번 라운드에 아직 행동하지 않은 것으로 되돌린다.
    // 이후 executeInitiativeProcess 의 재정렬이 그를 라운드 최후로 보낸다.
    const done = getMainDone(combat);
    if (done.delete(process.combatantId)) await setMainDone(combat, done);
  }

  if (process.combatantId && !turns.some(combatant => combatant.id === process.combatantId)) {
    // 현재 메인 전투원이 사라졌다(삭제됐거나 플래그가 어긋났다). 예전에는 이 경우가
    // "마지막 전투원"과 구분되지 않아 조용히 라운드가 끝났다. 이제는 남은 전투원
    // 기준으로 계속 진행하되, 상태가 어긋났다는 사실은 드러낸다.
    console.warn(`DX3rd | 메인 프로세스 전투원(${process.combatantId})을 전투에서 찾을 수 없습니다.`);
  }

  // 라운드 종료 판정은 배열 위치가 아니라 "아직 메인을 받지 않은 전투원이 남았는가"다.
  if (getPendingMainCombatants(combat).length > 0) {
    await executeInitiativeProcess(combat);
    return;
  }
  await runCombatProcess(combat, 'cleanup', {needsRoundAdvance: true});
}

window.DX3rdCombatFlow = window.DX3rdCombatFlow || {};
window.DX3rdCombatFlow.advance = advanceCombatState;
window.DX3rdCombatFlow.enterInitiative = executeInitiativeProcess;
window.DX3rdCombatFlow.startMainProcessFromInitiative = startMainProcessFromInitiative;


// 컴배턴트 생성 시 자동으로 이니셔티브 설정
Hooks.on('createCombatant', async (combatant, options, userId) => {
  // GM만 실행 (권한 문제 방지)
  if (!game.user.isGM) return;
  
  // 프로세스 컴배턴트 확인
  const isProcessCombatant = combatant.getFlag('dx3rd-emanim', 'isProcessCombatant');
  if (isProcessCombatant) {
    // 셋업/클린업은 턴을 표시하는 가상 항목일 뿐 이니셔티브를 가지지 않는다.
    return;
  }

  const actor = combatant.actor;
  if (!actor) return;

  // 액터의 행동치 값 가져오기
  const initValue = Number(actor.system?.attributes?.init?.value ?? 0);

  // 전투가 이미 진행 중인 경우 (round >= 1) action_end 체크
  const combat = combatant.combat;
  if (combat && combat.round >= 1 && combat.started) {
    // action_end를 true로 설정
    await actor.update({
      'system.conditions.action_end.active': true
    });
  }
  
  // 이니셔티브 설정
  await combatant.update({ initiative: initValue });
});

// 전투 시작 버튼을 눌렀을 때 채팅 메시지 출력
Hooks.on('combatStart', async (combat, updateData) => {
  // GM만 메시지 전송
  if (!game.user.isGM) return;
  
  // 전투 시작 시 프로세스 플래그 초기화
  await combat.unsetFlag('dx3rd-emanim', 'currentProcess');
  await clearProcessInitiatives(combat);
  
  const combatStartMsg = game.i18n.localize('DX3rd.CombatStart');
  await ChatMessage.create({
    content: `<h3 class="dx3rd-combat-start-msg">${combatStartMsg}</h3>`,
    speaker: getGMSpeaker(),
  });
  
  // 전투 시작 매크로 실행
  await executeMacrosByPrefix('combat-start-macro-');
  await runCombatProcess(combat, 'setup');
});

async function resetRoundActorStates() {
  const currentScene = game.scenes.active;
  if (!currentScene) return;
  const tokensWithActors = currentScene.tokens.filter(token => token.actor
    && (token.actor.type === 'character' || token.actor.type === 'enemy'));
  for (const tokenDoc of tokensWithActors) {
    const actor = tokenDoc.actor;
    const updates = {
      'system.conditions.action_end.active': false,
      'system.conditions.action_delay.active': false,
      'system.conditions.action_delay.value': 0
    };
    const extraTurnMax = actor.system?.conditions?.['extra-turn']?.max ?? 0;
    if (extraTurnMax > 0) updates['system.conditions.extra-turn.value'] = extraTurnMax;
    await actor.update(updates);
  }
}

// 턴 변경 시 셋업/클린업 프로세스 메시지 출력 및 라운드 변경 시 상태 초기화
async function handleCombatUpdate(combat, changes, options, userId) {
  // GM만 실행
  if (!game.user.isGM) return;

  // 프로세스 전환은 advanceCombatState/runCombatProcess만 담당한다.
  // 일반 Combat 문서 갱신은 UI 갱신 외의 상태 전환을 유발하지 않는다.
  if (!combat._dx3rdRequestedProcess) return;

  // 아래 코드는 _dx3rdRequestedProcess 가 있는 경우만 실행된다. 예전에는 이 지점에
  // 'round' 분기와 !requestedProcess 분기가 있었지만, 위 가드 때문에 어느 쪽도 도달할
  // 수 없었다. 라운드 지속 효과 만료는 advanceToSetupProcess 로 옮겼다.

  // turn이 변경되었을 때만 실행
  if (!('turn' in changes)) return;

  const requestedProcess = combat._dx3rdRequestedProcess;
  
  const processType = requestedProcess.type;
  
  // 셋업 프로세스인 경우
  if (processType === 'setup') {
    const roundText = game.i18n.localize('DX3rd.Round');
    const currentRound = combat.round || 1;
    await resetRoundActorStates();
    // 새 라운드다. 아무도 아직 메인 프로세스를 받지 않았다.
    await combat.unsetFlag('dx3rd-emanim', MAIN_DONE_FLAG);
    // 새 라운드의 기준 순서. 여기서는 상승분 보류 없이 전원을 무조건 다시 굴린다 —
    // 지난 라운드에 보류된 【행동치】 상승이 있다면 이 시점에 전부 풀린다.
    // 셋업 진행 중에 걸리는 변경도 아래 훅이 즉시 순서에 반영한다.
    await combat.rollInitiative(combat.combatants.map(entry => entry.id));

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
    
    // 셋업 프로세스 매크로 실행
    await executeMacrosByPrefix('setup-process-macro-');
  }
  
  // 클린업 프로세스인 경우
  if (processType === 'cleanup') {
    // 클린업 프로세스 플래그 설정
    await combat.setFlag('dx3rd-emanim', 'currentProcess', {
      type: 'cleanup',
      actorId: null,
      combatantId: null,
      needsRoundAdvance: requestedProcess.needsRoundAdvance
    });
    
    // 클린업 프로세스 매크로 실행
    await executeMacrosByPrefix('cleanup-process-macro-');

    // === 라운드 종료 정리 =====================================================
    // 이니셔티브를 왜곡하는 것들을 여기서 모두 풀고 원래 【행동치】로 되돌린다.
    //   - 행동 대기: rollInitiative 가 -(행동치)로 뒤집어 둔 상태
    //   - EXTRA TURN: disable 'round' 인 applied 의 init 패널티
    // 풀지 않으면 클린업~다음 셋업 내내 전투 트래커가 뒤집힌 순서를 보여 준다
    // (예전에는 다음 이니셔티브 프로세스의 전원 재굴림에서야 교정됐다).
    // 라운드 지속 효과의 만료 지점도 셋업이 아니라 여기다 — 라운드가 끝나는 시점이
    // 클린업이고, 여기서 만료시켜야 이어지는 재굴림에 반영된다.
    if (typeof DX3rdDisableHooks !== 'undefined') {
      await DX3rdDisableHooks.executeDisableHook('round', null);
    }
    await resetRoundActorStates();
    await combat.rollInitiative(combat.combatants.map(entry => entry.id));

    // SpellCalamity 5번 효과 count 감소 처리
    if (game.user.isGM) {
      for (const combatant of combat.combatants) {
        const actor = combatant.actor;
        if (!actor) continue;
        
        const appliedEffects = window.DX3rdAppliedEffects?.collect
          ? window.DX3rdAppliedEffects.collect(actor)
          : (actor.system?.attributes?.applied || {});

        for (const [appliedKey, appliedEffect] of Object.entries(appliedEffects)) {
          if (appliedEffect && appliedEffect.attributes && !appliedEffect._disabled) {
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
}

async function runCombatProcess(combat, type, {needsRoundAdvance = false} = {}) {
  if (!combat || !game.user.isGM) return;
  combat._dx3rdRequestedProcess = {type, needsRoundAdvance};
  try {
    await handleCombatUpdate(combat, {turn: combat.turn}, {}, game.user.id);
  } finally {
    delete combat._dx3rdRequestedProcess;
  }
}

Hooks.on('updateCombat', handleCombatUpdate);

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

// action_end/action_delay 변경 시 전원의 이니셔티브를 "즉시" 재계산하는 updateActor 훅이
// 여기 있었다. 되살리지 말 것.
// (당시 설계는 executeInitiativeProcess 가 매 액터의 메인 직전마다 전 컴배턴트를 다시
//  굴리는 것이었다. 지금은 순서를 셋업에서 확정하고 라운드 도중에는 다시 굴리지 않는다.)
//
// 당시 advanceCombatState 는 "현 정렬 스냅샷의 배열 위치"로 다음 액터를 골랐다:
//     if (currentIndex < turns.length - 1) 다음 = turns[currentIndex + 1]
//     else                                cleanup
// 대기자는 rollInitiative 에서 -(행동치)로 뒤집혀 맨 뒤로 밀리므로, 대기 선택 직후에
// 재계산이 끼어들면 currentIndex 가 곧바로 마지막 칸이 되어 남은 액터를 전부 건너뛰고
// 라운드가 끝났다. Hooks.on 은 async 콜백을 await 하지 않아 경쟁으로 나타났다.
//
// 지금은 라운드 종료 판정이 위치가 아니라 완료 집합(MAIN_DONE_FLAG) 기준이라 재정렬
// 시점에 영향받지 않는다. 그래도 라운드 도중에 전원을 재정렬하는 훅은 되살리지 말 것.
// (제거 시점 기준으로 이 훅은 changes 를 중첩 객체로만 읽고 있었는데 action_end/action_delay
//  기록자는 전부 점 표기여서, 사실상 발화하지 않는 상태였다. 형태 판별이 필요하면
//  DX3rdRuntimeUtils.updateTouchesPath 를 쓸 것.)
//
// 아래 훅은 그것과 다르다. 셋업 프로세스일 때만, 갱신된 그 액터 하나만 다시 스냅샷한다.
// 셋업은 액터가 행동하지 않는 정지 구간이라 상태 기계와 경쟁하지 않고, 순서 확정 자체가
// 셋업의 일이다. 라운드 도중에는 이 훅이 아무것도 하지 않는다 — 그때의 재계산은
// executeInitiativeProcess(상승 보류) 와 메인 종료 지점(보류 해제)이 담당한다.
// 셋업에서는 상승도 즉시 통해야 한다. 행동치 변경 효과는 보통 셋업에 쓰이고,
// 그 자리에서 순서가 바뀌는 것이 이 효과들의 용도이기 때문이다.
function syncInitiativeDuringSetup(actor) {
  if (!actor?.id || !game.user.isGM) return;
  const combat = game.combat;
  if (combat?.getFlag('dx3rd-emanim', 'currentProcess')?.type !== 'setup') return;
  const combatant = combat.combatants.find(entry => entry.actor?.id === actor.id);
  if (!combatant) return;
  // 값이 그대로면 refreshCombatantInitiative 가 알아서 아무것도 하지 않는다.
  refreshCombatantInitiative(combat, combatant.id).catch(error => {
    console.error('DX3rd | 셋업 중 이니셔티브 갱신 실패', error);
  });
}

// 【행동치】는 파생값이라 액터 자체 갱신뿐 아니라 ActiveEffect(applied)·아이템 장착으로도 바뀐다.
Hooks.on('updateActor', actor => syncInitiativeDuringSetup(actor));
for (const hook of ['createActiveEffect', 'updateActiveEffect', 'deleteActiveEffect',
                    'createItem', 'updateItem', 'deleteItem']) {
  Hooks.on(hook, document => syncInitiativeDuringSetup(document?.parent));
}

// ========== AfterDamage 큐 시스템 ========== //
