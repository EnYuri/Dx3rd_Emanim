// Double Cross 3rd Combat System

/**
 * The main-process actor banner animation
 * @param {string} imgSrc - the actor's image source
 * @param {string} actorName - the actor's name
 */
function showTurnActor(imgSrc = null, actorName = null) {
  // Read the combatant details (falling back to the current combatant when no parameters are given)
  if (!imgSrc) imgSrc = game.combat?.combatant?.actor?.img ?? "";
  if (!actorName) actorName = game.combat?.combatant?.actor?.name ?? game.combat?.combatant?.name ?? "";

  // Remove any previous banner
  document.getElementById("diamond-frame")?.remove();
  document.getElementById("diamond-label-left")?.remove();
  document.getElementById("diamond-label-right")?.remove();

  // Define the styles (only once)
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

  // Label factory
  function createLabel(id, className, text) {
    const label = document.createElement("div");
    label.id = id;
    label.className = className;
    label.innerText = text;
    document.body.appendChild(label);
    return label;
  }

  // The frame
  const frame = document.createElement("div");
  frame.id = "diamond-frame";

  const image = document.createElement("img");
  image.src = imgSrc;
  frame.appendChild(image);
  document.body.appendChild(frame);

  // The labels
  const leftLabel = createLabel("diamond-label-left", "diamond-label", game.i18n.localize("DX3rd.MainProcess"));
  const rightLabel = createLabel("diamond-label-right", "diamond-label", actorName);

  // Animation timings
  const SHOW_DURATION = 1200; // how long it stays (ms)
  const FADE_DURATION = 400;  // the fade-out animation (ms)

  // Fade it out again
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
  // Pin scene/token/actor to null explicitly, so a controlled token cannot
  // contaminate the speaker.
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
 * Announce a process transition in chat.
 * Uses the same formatting (dx3rd-combat-msg) as the round/combat start and end messages.
 * Process transitions only happen on the GM client, so only the GM emits here — otherwise
 * another client observing the same transition would duplicate the message.
 * @param {string} labelKey - an i18n key such as 'DX3rd.SetupProcess'
 * @param {object} [speaker] - defaults to the GM speaker
 */
async function announceCombatProcess(labelKey, speaker = null) {
  if (!game.user.isGM) return;
  await ChatMessage.create({
    content: `<h3 class="dx3rd-combat-msg">${game.i18n.localize(labelKey)}</h3>`,
    speaker: speaker ?? getGMSpeaker(),
  });
}

/**
 * Run every macro whose name starts with a given prefix
 * @param {string} prefix - the macro name prefix
 */
async function executeMacrosByPrefix(prefix) {
  // The GM alone runs macros
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

// Compute one combatant's initiative value. Nothing is rolled — the actor's initiative stat IS the value.
// Kept in one place so rollInitiative and the partial refresh (refreshCombatantInitiative) share the rule.
function computeInitiativeValue(combatant) {
  // Setup and cleanup are synthetic combatants used for progress display. They neither roll nor own initiative.
  if (!combatant || combatant.getFlag('dx3rd-emanim', 'isProcessCombatant')) return null;
  const actor = combatant.actor;
  if (!actor) return 0;
  const actionValue = Number(actor.system?.attributes?.init?.value ?? 0);
  // Rules: a delaying actor acts last in the round regardless of their initiative stat, and when
  // several are delaying, the slower (lower) one goes first.
  // Setting the initiative to -(stat) achieves both: (1) being negative sorts it after normal
  // actors, and (2) a lower stat lands closer to 0, so it sorts earlier among the delayers.
  const isActionDelay = actor.system?.conditions?.action_delay?.active ?? false;
  return isActionDelay ? -actionValue : actionValue;
}

// Re-snapshot the initiative of a single combatant.
// onlyIfLower: apply only when the value drops. An initiative-stat *increase* mid-round is held
// until that actor's own main process ends — otherwise you could buff yourself right before your
// turn and cut ahead of everyone. A decrease pushes your own turn later, which is legitimate, so
// it applies immediately.
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
  // v13/v14 compatibility: fall back when the Combat / Combatant globals are absent
  const _CombatBase = foundry.documents?.Combat ?? globalThis.Combat;
  const _CombatantBase = foundry.documents?.Combatant ?? globalThis.Combatant;
  const toFiniteInitiative = (value) => {
    // Process combatants take no part in the initiative order.
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
      
      // Use the actor's current initiative stat
      const initValue = actor.system?.attributes?.init?.value ?? 0;
      
      // Returned as a string so no dice are rolled — the value passes straight through
      return String(initValue);
    }

    /**
     * Override rollInitiative to use actor's init.value without rolling dice
     * @param {string|string[]} ids
     * @param {object} options
     */
    async rollInitiative(ids, options = {}) {
      // Normalize to an array
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
      
      // Write the updates
      await this.updateEmbeddedDocuments("Combatant", updates);
      
      return this;
    }

    /**
     * Override _sortCombatants to implement custom tie-breaking rules
     *
     * The single source of truth for turn ordering. combat.turns is this result, and choosing the
     * next actor (getPendingMainCombatants → startMainProcessFromInitiative) follows that same
     * order. Do not reimplement the ordering anywhere else.
     *
     * @param {Combatant} a
     * @param {Combatant} b
     * @returns {number}
     */
    _sortCombatants(a, b) {
      // 1st: initiative (descending)
      const ia = toFiniteInitiative(a.initiative);
      const ib = toFiniteInitiative(b.initiative);
      if (ia !== ib) return ib - ia;
      
      // On a tie, fall through to the tie-breaking rules
      const actorA = a.actor;
      const actorB = b.actor;
      
      // No actor: a setup/cleanup process combatant
      if (!actorA || !actorB) {
        return 0;
      }
      
      // 2nd: actor type priority (PlayerCharacter > Enemy > Ally > Troop > NPC)
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
      
      // 3rd: whoever does NOT have an EXTRA TURN goes first
      const aExtraTurn = actorA.system?.conditions?.['extra-turn']?.active ?? false;
      const bExtraTurn = actorB.system?.conditions?.['extra-turn']?.active ?? false;
      if (aExtraTurn !== bExtraTurn) return aExtraTurn ? 1 : -1;
      
      // 4th: sense.total (descending)
      const aSense = actorA.system?.attributes?.sense?.total ?? 0;
      const bSense = actorB.system?.attributes?.sense?.total ?? 0;
      if (aSense !== bSense) return bSense - aSense;
      
      // 5th: mind.total (descending)
      const aMind = actorA.system?.attributes?.mind?.total ?? 0;
      const bMind = actorB.system?.attributes?.mind?.total ?? 0;
      if (aMind !== bMind) return bMind - aMind;
      
      // 6th: name (locale order)
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

  // Expose globally
  window.DX3rdCombat = DX3rdCombat;
  window.DX3rdCombatant = DX3rdCombatant;
})();

// Wire the Next Turn button into the turn-process state machine
Hooks.once('ready', () => {
  // Wrap Combat.prototype.nextTurn directly
  if (!Combat.prototype.nextTurn._dx3rdOriginal) {
    // Keep the original method in a local
    const originalNextTurn = Combat.prototype.nextTurn;
    if (typeof originalNextTurn !== 'function') {
      console.warn('DX3rd | Combat - nextTurn is not a function');
    return;
  }

    // Stash the original method
    Combat.prototype.nextTurn._dx3rdOriginal = originalNextTurn;
    
    Combat.prototype.nextTurn = async function(...args) {
      // Wrapper around the original (using the local)
      const wrapped = async () => {
        return await originalNextTurn.apply(this, args);
      };

      // Foundry's next-turn button funnels into the system's single combat state-machine entry point.
      // The action-end / action-delay rules below run only for an explicit choice from the progress bar.
      if (!this._dx3rdForcedTurnChoice) {
        return window.DX3rdCombatFlow?.advance?.(this, 'forward');
      }

      // From here on _dx3rdForcedTurnChoice is necessarily truthy — that is the only way past the guard
      // above. Code that re-branched on "no choice" used to live here; it was unreachable and is gone.

      // The choice is one-shot. It is consumed first, before any guard below can return early —
      // the delete used to sit below those guards, so hitting one left the flag set and the next
      // ordinary advance silently turned into an action-end or action-delay.
      const choice = this._dx3rdForcedTurnChoice;
      delete this._dx3rdForcedTurnChoice;

      // The current combatant
      const currentCombatant = this.combatant;

      // Setup and cleanup live in Combat flags alone. No synthetic combatant is created for them.
      const currentProcess = this.getFlag('dx3rd-emanim', 'currentProcess');
      if (currentProcess?.type !== 'main') return;

      // Only an ordinary combatant with an actor goes through the end/delay rules.
      if (!currentCombatant || !currentCombatant.actor) {
        return wrapped();
      }

      // With an EXTRA TURN attached, choosing action-end still clears action_end, so the actor takes
      // another turn this round. Like a delay, that has to be undone in the completed set.
      let extraTurnGranted = false;

      // Branch on the choice
      if (choice === 'end') {
        // Action end — set the actor's action_end condition
        const actor = currentCombatant.actor;
        if (actor) {
          const updates = {
            'system.conditions.action_end.active': true
          };
          let _extraTurnApplied = null;

          // extra-turn handling
          const extraTurnActive = actor.system?.conditions?.['extra-turn']?.active ?? false;
          const extraTurnValue = actor.system?.conditions?.['extra-turn']?.value ?? 0;
          
          if (extraTurnActive && extraTurnValue > 0) {
            // Spend one from extra-turn.value
            updates['system.conditions.extra-turn.value'] = extraTurnValue - 1;
            
            // Create the EXTRA TURN applied effect, reusing the existing structure
            const initValue = actor.system?.attributes?.init?.value ?? 0;
            let initPenalty = -Math.floor(initValue / 2);
            
            const appliedKey = `EXTRA_TURN_${actor.id}`;

            // Is an EXTRA TURN penalty already attached? (read via the native AE flag)
            const existingApplied = window.DX3rdAppliedEffects?.getEffect(actor, appliedKey)?.getFlag('dx3rd-emanim', 'applied');
            if (existingApplied && existingApplied.attributes?.init !== undefined) {
              // Already penalized once: pin it to -9999
              initPenalty = -9999;
            }

            // With the EXTRA TURN penalty attached, action-end is cleared again
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
        
        // Request the main disable hook
        if (game.user.isGM) {
          // The GM runs it directly
          if (typeof DX3rdDisableHooks !== 'undefined') {
            console.log('DX3rd | Executing main disable hook for all actors');
            await DX3rdDisableHooks.executeDisableHook('main', null);
          }
        } else {
          // A player delegates to the GM over the socket
          window.DX3rdSocketRouter.emit({
            type: 'executeDisableHook',
            timing: 'main',
            combatId: this.id,
            actorId: currentCombatant.actor?.id
          });
        }
      } else if (choice === 'delay') {
        // Action delay
        const actor = currentCombatant.actor;
        if (actor) {
          // Count how many combatants in this combat already have action_delay active
          const combat = this;
          let delayCount = 0;
          
          for (const combatant of combat.combatants) {
            if (combatant.actor && combatant.actor.system.conditions?.action_delay?.active) {
              delayCount++;
            }
          }
          
          // Activate action_delay and set its value (the existing delay count + 1)
          await actor.update({
            'system.conditions.action_delay.active': true,
            'system.conditions.action_delay.value': delayCount + 1
          });
        }

        await ChatMessage.create({
          content: game.i18n.localize("DX3rd.ActionDelay"),
          speaker: ChatMessage.getSpeaker({ actor })
        });
        
        // Request the main disable hook
        if (game.user.isGM) {
          // The GM runs it directly
          if (typeof DX3rdDisableHooks !== 'undefined') {
            await DX3rdDisableHooks.executeDisableHook('main', null);
          }
        } else {
          // A player delegates to the GM over the socket
          window.DX3rdSocketRouter.emit({
            type: 'executeDisableHook',
            timing: 'main',
            combatId: this.id,
            actorId: currentCombatant.actor?.id
          });
        }
      }
      
      // After an end or a delay, the same state machine still drives the next step.
      // A player may update their own actor's state but has no permission to move the Combat
      // document, so they ask the GM to advance the current main process.
      // The completed set is rewound only for a delay. The GM is the one writing the flag, so on
      // the player path that fact rides along over the socket.
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
      
      // nextTurn runs from the main-process start button, so it is not called here
      return;
      // End of the custom logic
    };
  }
  
  // Handling for the Previous Turn button
  if (!Combat.prototype.previousTurn._dx3rdOriginal) {
    // Keep the original method in a local
    const originalPreviousTurn = Combat.prototype.previousTurn;
    if (typeof originalPreviousTurn !== 'function') {
      console.warn('DX3rd | Combat - previousTurn is not a function');
      return;
    }
    
    // Stash the original method
    Combat.prototype.previousTurn._dx3rdOriginal = originalPreviousTurn;
    
    Combat.prototype.previousTurn = async function(...args) {
      // Rewinding also funnels into the single state-machine entry point. The original previousTurn
      // is never used — it moves only the combatant pointer, knowing nothing of the process stages.
      return window.DX3rdCombatFlow?.advance?.(this, 'backward');
    };
  }

  // The round buttons are the same story. The core originals move only round and turn, so in this
  // system the process flag would be left holding the previous round's state and the tracker would
  // disagree with the actual progress (starting a new round while still displaying cleanup).
  for (const [method, flow] of [['nextRound', 'nextRound'], ['previousRound', 'previousRound']]) {
    const original = Combat.prototype[method];
    if (typeof original !== 'function') {
      console.warn(`DX3rd | Combat - ${method} is not a function`);
      continue;
    }
    if (original._dx3rdOriginal) continue;
    Combat.prototype[method] = async function(...args) {
      return window.DX3rdCombatFlow?.[flow]?.(this);
    };
    Combat.prototype[method]._dx3rdOriginal = original;
  }
});

// === Round-progress test ==================================================
// Deciding whether a round has ended by array position in combat.turns (does turns[currentIndex + 1]
// exist?) skips every remaining combatant the moment an action delay reorders the initiative.
// So instead of position, the test is "the set of combatants that finished a main process this round".
//   - added when a main starts (startMainProcessFromInitiative)
//   - removed on an action delay or an EXTRA TURN = rewound to "has not acted yet"
//     (advanceCombatState's deferCurrent)
//   - cleared at setup (the start of the round)
// Termination is guaranteed: a delay may be chosen once per round (action_delay only clears on the
// round reset), and each EXTRA TURN decrements extra-turn.value. Each actor's removals are finite,
// so the round must end.
const MAIN_DONE_FLAG = 'mainDoneCombatantIds';

function getMainDone(combat) {
  return new Set(combat?.getFlag('dx3rd-emanim', MAIN_DONE_FLAG) || []);
}

async function setMainDone(combat, ids) {
  if (!combat || !game.user.isGM) return;
  await combat.setFlag('dx3rd-emanim', MAIN_DONE_FLAG, Array.from(ids));
}

// Can this combatant still act this round?
function isMainEligible(combatant) {
  if (!combatant || combatant.getFlag('dx3rd-emanim', 'isProcessCombatant')) return false;
  const actor = combatant.actor;
  // A combatant without an actor is left in, for manual progression (unchanged behavior).
  if (!actor) return true;
  if (actor.system?.conditions?.action_end?.active) return false;
  return (actor.system?.attributes?.hp?.value ?? 0) > 0;
}

// The combatants that have not yet had a main process, in the current initiative order.
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

// Clean up, once, any setup/cleanup pseudo-combatants left over from an older version.
Hooks.once('ready', async () => {
  if (game.user.isGM && game.combat) await clearProcessInitiatives(game.combat);
});

// Move the round counter, in the same shape as core Combat#nextRound / #previousRound. This used to
// just overwrite round and turn, which skipped the two things core does at a round boundary:
//   - advancing worldTime: in-game time never moved between rounds (calendar and time-based modules).
//   - the combatRound hook: core's extension point for hooking a round boundary, so modules that
//     used it were never called in this system alone.
// The time delta is left to core's getTimeDelta (which honors CONFIG.time.roundTime/turnTime).
// Rewinding produces a negative delta, so time rolls back by the same amount.
async function updateCombatRound(combat, targetRound) {
  const updateData = {round: targetRound, turn: 0};
  const delta = combat.getTimeDelta?.(combat.round, combat.turn, targetRound, 0) ?? 0;
  const updateOptions = {direction: targetRound >= (combat.round || 0) ? 1 : -1, worldTime: {delta}};
  Hooks.callAll('combatRound', combat, updateData, updateOptions);
  await combat.update(updateData, updateOptions);
}

async function advanceToSetupProcess(combat) {
  if (!combat || !game.user.isGM) return;
  const process = combat.getFlag('dx3rd-emanim', 'currentProcess');
  // A new round always starts from the first combatant in Foundry's order.
  // Bumping the round while keeping the previous actor cursor scrambles the setup/initiative targets.
  if (process?.needsRoundAdvance) {
    await updateCombatRound(combat, (combat.round || 0) + 1);
    // Round-lifetime effects (disable: 'round') expire in cleanup (handleCombatUpdate).
    // They must expire before the initiative re-roll, or the EXTRA TURN penalty lingers in the tracker.
    // (The 'round' branch of handleCombatUpdate was unreachable, and this once lived there.)
  } else if (combat.turn !== 0) {
    await combat.update({turn: 0});
  }
  await runCombatProcess(combat, 'setup');
}

// === Round-level jumps ====================================================
// Where the "next round / previous round" buttons at the bottom of the combat tracker land. The two
// directions are not symmetric — going forward means "finish this round", while going back means
// "pretend this round never happened".

// Next round: discard the remaining combatants' turns, run the cleanup process properly, then move
// on to the next round's setup. Skipping cleanup would start the next round without any of the
// round-end work (restoring once-per-round uses, expiring disable:'round', healing and poison,
// clearing action end/delay, re-rolling initiative).
async function jumpToNextRound(combat) {
  if (!combat || !game.user.isGM) return;
  const process = combat.getFlag('dx3rd-emanim', 'currentProcess');
  if (process?.type !== 'cleanup') {
    await runCombatProcess(combat, 'cleanup', {needsRoundAdvance: true});
    // Cleanup's healing and poison work runs behind a setTimeout(500), to order the chat correctly.
    // Normally that finishes while a human is reaching for the next button, but here we move straight
    // on to setup — so we wait. Without the wait the round message precedes the healing.
    await new Promise(resolve => setTimeout(resolve, 600));
  }
  await advanceToSetupProcess(combat);
}

// Previous round: undo this round and return to the previous round's setup.
// **No cleanup is run.** What cleanup does (healing and poison HP changes, expiring disable:'round',
// decrementing EXTRA TURN) is irreversible, so mixing it into a rewind would erode state in one
// direction every time you moved between rounds. The point of rewinding is to take the round back.
async function jumpToPreviousRound(combat) {
  if (!combat || !game.user.isGM) return;
  // Round 0 means "combat has not started", so we never go below 1.
  // Pressed during round 1, this simply reopens that round's setup.
  const target = Math.max((combat.round || 1) - 1, 1);
  if (target !== combat.round) await updateCombatRound(combat, target);
  else if (combat.turn !== 0) await combat.update({turn: 0});
  // The setup process clears the completed set and re-rolls everyone's initiative, which is the
  // same thing as discarding the remaining combatants' turns.
  await runCombatProcess(combat, 'setup');
}

// Start a main process from the initiative process.
// Triggered by the initiative signal on the combat progress bar, with no confirmation dialog.
async function startMainProcessFromInitiative(combat) {
  if (!combat || !game.user.isGM) return;

  // The order comes from the snapshot fixed at setup. Nobody is re-rolled here — an initiative-stat
  // change made mid-round has to wait for the next setup.
  // (Only a change that pushes your own turn later is applied individually, at the end of your main.)

  // The candidates and their order follow combat.turns verbatim. turns is sorted by
  // DX3rdCombat._sortCombatants (initiative → actor type → EXTRA TURN → sense → mind → name), so
  // reimplementing the tie-breaking here would let the two silently drift apart.
  const candidates = getPendingMainCombatants(combat);
  const alreadyDone = getMainDone(combat);

  const pendingCombatantId = combat.getFlag('dx3rd-emanim', 'currentProcess')?.pendingCombatantId;
  const nextCombatant = candidates.find(candidate => candidate.id === pendingCombatantId)
    ?? candidates[0] ?? null;
  if (nextCombatant !== null) {
    const turnIndex = combat.turns.findIndex(t => t.id === nextCombatant.id);
    await combat.update({ turn: turnIndex });
    await combat.setFlag('dx3rd-emanim', 'currentProcess', {
      type: 'main', actorId: nextCombatant.actor?.id ?? null, combatantId: nextCombatant.id
    });
    // Record that this combatant has had their main process this round — the basis of the round-end test.
    alreadyDone.add(nextCombatant.id);
    await setMainDone(combat, alreadyDone);
    // Reset the previous action display at the start of every main process.
    await combat.unsetFlag('dx3rd-emanim', 'actionTrackerUsage');

    // The main-process message (spoken by that actor, so it is clear whose main it is)
    await announceCombatProcess('DX3rd.MainProcess', nextCombatant.actor
      ? ChatMessage.getSpeaker({ actor: nextCombatant.actor, token: null })
      : { alias: nextCombatant.name });

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

// Run the initiative process
async function executeInitiativeProcess(combat, pendingCombatantId = null) {
  await clearProcessInitiatives(combat);
  // === Drain the AfterMain queue (just before initiative) ===
  if (window.DX3rdUniversalHandler && window.DX3rdUniversalHandler.processAfterMainQueue) {
    await window.DX3rdUniversalHandler.processAfterMainQueue();
  }

  // Recompute everyone at each initiative process, so the order reflects changes at once.
  // An initiative-stat *increase* is held until that actor's main ends (onlyIfLower).
  // The held amount is applied unconditionally at advanceCombatState's end-of-main point.
  for (const combatant of combat.combatants) {
    await refreshCombatantInitiative(combat, combatant.id, {onlyIfLower: true});
  }
  await new Promise(resolve => setTimeout(resolve, 100));
  if (pendingCombatantId) {
    // A rewind, or Foundry's native next-turn, pinned the target. That combatant now has to take
    // a main again, so they come out of the completed set (or they would be filtered from the candidates).
    const done = getMainDone(combat);
    if (done.delete(pendingCombatantId)) await setMainDone(combat, done);
  } else {
    // The first combatant in the reordered list that has not yet had a main.
    pendingCombatantId = getPendingMainCombatants(combat)[0]?.id ?? null;
  }
  
  // Set the initiative-process flag
  const pendingCombatant = pendingCombatantId ? combat.combatants.get(pendingCombatantId) : null;
  // Move the combat tracker's cursor to the combatant about to act. Without this the tracker shows
  // the previous actor as current for the whole initiative stage (out of step until the main starts).
  // It has to move after the reordering, so a delay-driven change of order is reflected too.
  if (pendingCombatant) await moveCombatCursor(combat, pendingCombatant);
  await combat.setFlag('dx3rd-emanim', 'currentProcess', {
    type: 'initiative',
    actorId: pendingCombatant?.actor?.id ?? null,
    combatantId: null,
    pendingCombatantId
  });

  // The initiative-process message
  await announceCombatProcess('DX3rd.InitiativeProcess');

  // Initiative-process macros
  await executeMacrosByPrefix('init-process-macro-');
  
  // The initiative stage itself stops here. Starting the main is an explicit choice on the combat progress bar.
  document.getElementById("dx3rd-initiative-dialog")?.remove();
}

async function moveCombatCursor(combat, combatant) {
  const turn = combat.turns.findIndex(entry => entry.id === combatant?.id);
  if (turn >= 0 && combat.turn !== turn) await combat.update({turn});
}

async function enterPreviousMainProcess(combat, combatant) {
  if (!combatant?.actor) return;
  await moveCombatCursor(combat, combatant);
  // Rewinding: rebuild the completed set as "every main up to this combatant is finished".
  // Without this, advancing after a rewind would find no combatants left and end the round.
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

  // From here on: advancing forward from a main process.
  // This is where your own turn ends. The initiative-stat increase held back during the initiative
  // process is applied here unconditionally — having already acted, you cannot cut ahead this round.
  if (process.combatantId) {
    await refreshCombatantInitiative(combat, process.combatantId);
  }

  if (deferCurrent && process.combatantId) {
    // An actor who chose to delay is rewound to "has not acted this round".
    // The reordering in executeInitiativeProcess then pushes them to the end of the round.
    const done = getMainDone(combat);
    if (done.delete(process.combatantId)) await setMainDone(combat, done);
  }

  if (process.combatantId && !turns.some(combatant => combatant.id === process.combatantId)) {
    // The current main combatant is gone (deleted, or the flag drifted). This case used to be
    // indistinguishable from "the last combatant", so the round silently ended. It now keeps going
    // based on the remaining combatants, while making the inconsistent state visible.
    console.warn(`DX3rd | 메인 프로세스 전투원(${process.combatantId})을 전투에서 찾을 수 없습니다.`);
  }

  // The round-end test is not array position but "are there combatants who have not had a main yet".
  if (getPendingMainCombatants(combat).length > 0) {
    await executeInitiativeProcess(combat);
    return;
  }
  await runCombatProcess(combat, 'cleanup', {needsRoundAdvance: true});
}

window.DX3rdCombatFlow = window.DX3rdCombatFlow || {};
window.DX3rdCombatFlow.advance = advanceCombatState;
window.DX3rdCombatFlow.nextRound = jumpToNextRound;
window.DX3rdCombatFlow.previousRound = jumpToPreviousRound;
window.DX3rdCombatFlow.enterInitiative = executeInitiativeProcess;
window.DX3rdCombatFlow.startMainProcessFromInitiative = startMainProcessFromInitiative;


// Set the initiative automatically when a combatant is created
Hooks.on('createCombatant', async (combatant, options, userId) => {
  // GM only (avoids permission problems)
  if (!game.user.isGM) return;
  
  // Is this a process combatant?
  const isProcessCombatant = combatant.getFlag('dx3rd-emanim', 'isProcessCombatant');
  if (isProcessCombatant) {
    // Setup and cleanup are pseudo entries for displaying the turn; they hold no initiative.
    return;
  }

  const actor = combatant.actor;
  if (!actor) return;

  // The actor's initiative stat
  const initValue = Number(actor.system?.attributes?.init?.value ?? 0);

  // With combat already under way (round >= 1), set action_end
  const combat = combatant.combat;
  if (combat && combat.round >= 1 && combat.started) {
    // Set action_end to true
    await actor.update({
      'system.conditions.action_end.active': true
    });
  }
  
  // Set the initiative
  await combatant.update({ initiative: initValue });
});

// Emit a chat message when the combat start button is pressed
Hooks.on('combatStart', async (combat, updateData) => {
  // Only the GM sends the message
  if (!game.user.isGM) return;
  
  // Reset the process flag at the start of combat
  await combat.unsetFlag('dx3rd-emanim', 'currentProcess');
  await clearProcessInitiatives(combat);
  
  const combatStartMsg = game.i18n.localize('DX3rd.CombatStart');
  await ChatMessage.create({
    content: `<h3 class="dx3rd-combat-start-msg">${combatStartMsg}</h3>`,
    speaker: getGMSpeaker(),
  });
  
  // Combat-start macros
  await executeMacrosByPrefix('combat-start-macro-');
  await runCombatProcess(combat, 'setup');
});

// Undo action end/delay and restore the EXTRA TURN allowance at the round boundary.
//
// Collect the active scene's token actors ∪ this combat's combatants. The combat scene is not
// necessarily the active scene, and several tokens/combatants can point at the same actor.
function collectCombatActors(combat = null, {combatantsOnly = false} = {}) {
  const targets = new Map();
  const collect = (actor) => {
    if (!actor) return;
    if (actor.type !== 'character' && actor.type !== 'enemy') return;
    if (!targets.has(actor.uuid)) targets.set(actor.uuid, actor);
  };

  if (!combatantsOnly) {
    for (const tokenDoc of (game.scenes.active?.tokens ?? [])) collect(tokenDoc.actor);
  }
  for (const combatant of (combat?.combatants ?? [])) collect(combatant.actor);
  return [...targets.values()];
}

// Sweeping the whole active scene is deliberate: it also clears leftover state on actors that were
// never added to the combat. Combatants are unioned in so an off-screen combat is reset as well.
async function resetRoundActorStates(combat = null) {
  const targets = collectCombatActors(combat);

  for (const actor of targets) {
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

// Emit the setup/cleanup process messages on a turn change, and reset state on a round change
async function handleCombatUpdate(combat, changes, options, userId) {
  // GM only
  if (!game.user.isGM) return;

  // Process transitions are owned solely by advanceCombatState / runCombatProcess.
  // An ordinary Combat document update triggers no state transition beyond a UI refresh.
  if (!combat._dx3rdRequestedProcess) return;

  // Everything below runs only when _dx3rdRequestedProcess is set. There used to be a 'round'
  // branch and a !requestedProcess branch here, but the guard above made both unreachable.
  // Expiring round-lifetime effects moved to advanceToSetupProcess.

  // Only on a turn change
  if (!('turn' in changes)) return;

  const requestedProcess = combat._dx3rdRequestedProcess;
  
  const processType = requestedProcess.type;
  
  // The setup process
  if (processType === 'setup') {
    const roundText = game.i18n.localize('DX3rd.Round');
    const currentRound = combat.round || 1;
    await resetRoundActorStates(combat);
    // A new round: nobody has had a main process yet.
    await combat.unsetFlag('dx3rd-emanim', MAIN_DONE_FLAG);
    // The round's baseline order. Everyone is re-rolled unconditionally here, with nothing held —
    // any initiative-stat increase deferred during the previous round is released at this point.
    // Changes made during setup are folded into the order immediately by the hook below.
    await combat.rollInitiative(combat.combatants.map(entry => entry.id));

    // Set the setup-process flag
    await combat.setFlag('dx3rd-emanim', 'currentProcess', {
      type: 'setup',
      actorId: null,
      combatantId: null
    });
    
    // The round message
    await ChatMessage.create({
      content: `<h3 class="dx3rd-combat-msg">${roundText} ${currentRound}</h3>`,
      speaker: getGMSpeaker(),
    });

    // The setup-process message
    await announceCombatProcess('DX3rd.SetupProcess');

    // Setup-process macros
    await executeMacrosByPrefix('setup-process-macro-');
  }
  
  // The cleanup process
  if (processType === 'cleanup') {
    // Set the cleanup-process flag
    await combat.setFlag('dx3rd-emanim', 'currentProcess', {
      type: 'cleanup',
      actorId: null,
      combatantId: null,
      needsRoundAdvance: requestedProcess.needsRoundAdvance
    });

    // The cleanup-process message
    await announceCombatProcess('DX3rd.CleanupProcess');

    // Cleanup-process macros
    await executeMacrosByPrefix('cleanup-process-macro-');

    // === Round-end cleanup ===================================================
    // Everything that distorts initiative is released here, returning it to the plain initiative stat.
    //   - an action delay: rollInitiative has flipped it to -(initiative stat)
    //   - an EXTRA TURN: the init penalty of an applied effect with disable 'round'
    // Left in place, the combat tracker would show the flipped order from cleanup all the way to the
    // next setup (previously it was only corrected by the full re-roll at the next initiative process).
    // Round-lifetime effects also expire here rather than at setup — cleanup IS the end of the round,
    // and expiring here is what gets them reflected in the re-roll that follows.
    if (typeof DX3rdDisableHooks !== 'undefined') {
      await DX3rdDisableHooks.executeDisableHook('round', null);
    }
    await resetRoundActorStates(combat);
    await combat.rollInitiative(combat.combatants.map(entry => entry.id));

    // Decrement the SpellCalamity effect-5 counter
    if (game.user.isGM) {
      for (const combatant of combat.combatants) {
        const actor = combatant.actor;
        if (!actor) continue;
        
        const appliedEffects = window.DX3rdAppliedEffects?.collect
          ? window.DX3rdAppliedEffects.collect(actor)
          : (actor.system?.attributes?.applied || {});

        for (const [appliedKey, appliedEffect] of Object.entries(appliedEffects)) {
          if (appliedEffect && appliedEffect.attributes && !appliedEffect._disabled) {
            // Is there a spell_disabled effect?
            let hasSpellDisabled = false;
            let currentCount = 0;
            
            for (const [attrName, attrValue] of Object.entries(appliedEffect.attributes)) {
              // spell_disabled is detected by attrName, or by the object's key — nothing else.
              //   (The `attrValue === true` clause mistook any boolean-true attribute, so it was removed — as in universal-handler.)
              if (attrName === 'spell_disabled' ||
                  (typeof attrValue === 'object' && attrValue?.key === 'spell_disabled')) {
                hasSpellDisabled = true;
                // Look up the count value
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
                // Once the count reaches 0, drop the applied effect
                await window.DX3rdAppliedEffects.remove(actor, appliedKey);
              } else {
                // Otherwise just decrement: clone the payload and store it again
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
    
    // Clear the dazed condition
    if (game.user.isGM) {
      // Initialize the condition map
      if (!window.DX3rdConditionTriggerMap) {
        window.DX3rdConditionTriggerMap = new Map();
      }
      
      // Collect the actors carrying dazed
      const dazedActors = [];
      for (const combatant of combat.combatants) {
        const actor = combatant.actor;
        if (!actor) continue;
        
        // Does it carry dazed?
        const dazedEffect = actor.effects.find(e => e.statuses.has('dazed'));
        if (dazedEffect) {
          dazedActors.push(actor);
        }
      }
      
      // Parts of the merged dazed message
      const dazedMessageParts = [];
      
      // Clear dazed on each actor
      for (const actor of dazedActors) {
        // Set the message-control flag
        const mapKey = `${actor.id}:dazed`;
        window.DX3rdConditionTriggerMap.set(mapKey, {
          triggerItemName: game.i18n.localize('DX3rd.CleanupProcess'),
          suppressMessage: true,
          bulkRemove: true
        });
        
        await actor.toggleStatusEffect('dazed', { active: false });
        
        // Append this message part
        dazedMessageParts.push(`<div>· ${actor.name}</div>`);
        
        // Tidy the map
        window.DX3rdConditionTriggerMap.delete(mapKey);
      }
      
      // Emit the merged dazed-cleared message
      if (dazedMessageParts.length > 0) {
        const dazedHeader = game.i18n.localize('DX3rd.DazedClear');
        const dazedContent = `<div class="dx3rd-item-chat"><div class="item-header"><strong>${dazedHeader}</strong></div>${dazedMessageParts.join('')}</div>`;
        
        await ChatMessage.create({
          content: dazedContent,
          speaker: getGMSpeaker(),
        });
      }
    }
    
    // Healing and poison (behind a 500ms delay)
    setTimeout(async () => {
      // GM only
      if (!game.user.isGM) {
        return;
      }
      
      // === Healing (first) ===
      const healingActors = [];
      for (const combatant of combat.combatants) {
        const actor = combatant.actor;
        if (!actor) continue;
        
        const healingActive = actor.system?.conditions?.healing?.active ?? false;
        // The sheet input is text, so this may be stored as a string — coerce to a number
        const healingValue = Number(actor.system?.conditions?.healing?.value ?? 0);
        const currentHP = actor.system?.attributes?.hp?.value ?? 0;
        const maxHP = actor.system?.attributes?.hp?.max ?? 0;
        
        // Only when HP is neither 0 nor max, healing is active, and the value is at least 1
        if (healingActive && healingValue > 0 && currentHP > 0 && currentHP < maxHP) {
          healingActors.push({ actor, value: healingValue, currentHP });
        }
      }
      
      // Parts of the merged healing message
      const healingMessageParts = [];
      
      // Heal each actor
      for (const { actor, value, currentHP } of healingActors) {
        const maxHP = actor.system?.attributes?.hp?.max ?? 0;
        const newHP = Math.min(maxHP, currentHP + value);
        const actualHealing = newHP - currentHP;
        
        // Write the HP
        await actor.update({ 'system.attributes.hp.value': newHP });
        
        // Append this message part
        healingMessageParts.push(`<div>· ${actor.name} (HP +${actualHealing})</div>`);
      }
      
      // Emit the merged healing message
      if (healingMessageParts.length > 0) {
        const healingHeader = game.i18n.localize('DX3rd.HealingCheck');
        const healingContent = `<div class="dx3rd-item-chat"><div class="item-header"><strong>${healingHeader}</strong></div>${healingMessageParts.join('')}</div>`;
        
        await ChatMessage.create({
          content: healingContent,
          speaker: getGMSpeaker(),
        });
      }
      
      // === Poison damage (after the healing) ===
      const poisonedActors = [];
      for (const combatant of combat.combatants) {
        const actor = combatant.actor;
        if (!actor) continue;
        
        const poisonedActive = actor.system?.conditions?.poisoned?.active ?? false;
        const poisonedRank = actor.system?.conditions?.poisoned?.value ?? 0;
        const currentHP = actor.system?.attributes?.hp?.value ?? 0;
        
        // Only when HP is not 0, poison is active, and the value is at least 1 (0 is skipped)
        if (poisonedActive && poisonedRank > 0 && currentHP > 0) {
          poisonedActors.push({ actor, rank: poisonedRank });
        }
      }
      
      if (poisonedActors.length === 0) {
        return;
      }
      
      // The poison-reduction setting
      const reducePoisonEnabled = game.settings.get('dx3rd-emanim', 'reducePoison');
      
      // Parts of the merged poison message
      const poisonMessageParts = [];
      
      // Apply poison damage to each actor
      for (const { actor, rank } of poisonedActors) {
        const poisonDamage = rank * 3;
        const currentHP = actor.system?.attributes?.hp?.value ?? 0;
        
        // Apply the poison reduction
        let actualDamage = poisonDamage;
        if (reducePoisonEnabled) {
          const reduce = actor.system?.attributes?.reduce?.value ?? 0;
          actualDamage = Math.max(0, poisonDamage - reduce);
        }
        
        const newHP = Math.max(0, currentHP - actualDamage);
        
        // Write the HP
        await actor.update({ 'system.attributes.hp.value': newHP });
        
        // Append this message part
        poisonMessageParts.push(`<div>· ${actor.name} (HP -${actualDamage})</div>`);
      }
      
      // Emit the merged poison message
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

// Emit a chat message when combat ends
Hooks.on('deleteCombat', async (combat, options, userId) => {
  // Every client observes deleteCombat. Elect one GM so cleanup, chat, and macros run exactly once.
  const socketRouter = window.DX3rdSocketRouter;
  if (!game.user.isGM || (socketRouter?.isResponsibleGM && !socketRouter.isResponsibleGM())) return;
  
  // Clear the AfterMain queue
  if (window.DX3rdUniversalHandler && window.DX3rdUniversalHandler.clearAfterMainQueue) {
    await window.DX3rdUniversalHandler.clearAfterMainQueue();
  }
  
  // The combat-end chat message
  const combatEndMsg = game.i18n.localize('DX3rd.CombatEnd');
  await ChatMessage.create({
    content: `<h3 class="dx3rd-combat-end-msg">${combatEndMsg}</h3>`,
    speaker: getGMSpeaker(),
  });
  
  // Combat-end macros
  await executeMacrosByPrefix('combat-end-macro-');
  
  // Preserve the old active-scene sweep, but also include combatants when the combat scene differs.
  const cleanupActors = collectCombatActors(combat);
  for (const actor of cleanupActors) {
    // Fist reset and temporary-item deletion are for characters only
    if (actor.type === 'character') {
      // An equipment change's lifetime is held by its marker (an AE) — deleting the marker makes the
      // delete hook restore the fist and remove the created weapon. Rewriting that restore logic here
      // would make two copies, which would inevitably diverge. The restoreFistItems call that follows
      // is for older data left behind with no marker.
      // This spot used to find every weapon named "fist" and overwrite it with the -5/0 literals, which
      // reset both hand-tuned fists and permanently changed ones (Cyber Arm) at the end of every combat.
      await window.DX3rdUniversalHandler.clearItemGrants(actor);
      await window.DX3rdUniversalHandler.restoreFistItems(actor);
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

    // Reset the action state (characters and enemies alike)
    const updates = {
      'system.conditions.action_end.active': false,
      'system.conditions.action_delay.active': false,
      'system.conditions.action_delay.value': 0
    };

    // Restore the extra-turn value to its max
    const extraTurnMax = actor.system?.conditions?.['extra-turn']?.max ?? 0;
    if (extraTurnMax > 0) {
      updates['system.conditions.extra-turn.value'] = extraTurnMax;
    }

    await actor.update(updates);
  }
  
  // Run the disable hooks at combat end (roll, major, reaction, main, round, scene)
  if (typeof DX3rdDisableHooks !== 'undefined') {
    const timings = ['roll', 'major', 'reaction', 'guard', 'main', 'round', 'scene'];
    for (const timing of timings) {
      await DX3rdDisableHooks.executeDisableHook(timing, null);
    }
  } else {
    console.warn('DX3rd | DisableHooks not found, skipping cleanup');
  }
  
  // Clear every combatant's conditions at combat end (messages suppressed)
  const conditionsToRemove = ['rigor', 'pressure', 'dazed', 'poisoned', 'hatred', 'fear', 'berserk', 'boarding', 'fly', 'stealth'];
  
  // Initialize the condition map
  if (!window.DX3rdConditionTriggerMap) {
    window.DX3rdConditionTriggerMap = new Map();
  }
  
  for (const actor of collectCombatActors(combat, {combatantsOnly: true})) {
    for (const condition of conditionsToRemove) {
      if (actor.effects.find(e => e.statuses.has(condition))) {
        // Set the message-control flag
        const mapKey = `${actor.id}:${condition}`;
        window.DX3rdConditionTriggerMap.set(mapKey, {
          triggerItemName: game.i18n.localize('DX3rd.CombatEnd'),
          suppressMessage: true,
          bulkRemove: true
        });
        
        await actor.toggleStatusEffect(condition, { active: false });
        
        // Tidy the map
        window.DX3rdConditionTriggerMap.delete(mapKey);
      }
    }
  }
});

// An updateActor hook that recomputed EVERYONE's initiative *immediately* on an action_end /
// action_delay change used to live here. Do not reinstate it.
// (The design then was that executeInitiativeProcess re-rolled every combatant just before each
//  actor's main. Now the order is fixed at setup and never re-rolled mid-round.)
//
// Back then advanceCombatState picked the next actor by array position in the current sort snapshot:
//     if (currentIndex < turns.length - 1) next = turns[currentIndex + 1]
//     else                                 cleanup
// A delaying actor is flipped to -(initiative stat) by rollInitiative and pushed to the back, so if a
// recomputation cut in right after choosing to delay, currentIndex landed on the last slot, every
// remaining actor was skipped, and the round ended. Hooks.on does not await async callbacks, so it
// surfaced as a race.
// Today the round-end test is the completed set (MAIN_DONE_FLAG) rather than a position, so it is
// immune to reordering. Even so, do not reinstate a hook that reorders everyone mid-round.
// (As of its removal that hook read `changes` only as a nested object, while every writer of
//  action_end/action_delay used dot notation — so it never actually fired. If you need to handle
//  both shapes, use DX3rdRuntimeUtils.updateTouchesPath.)
//
// The hook below is a different thing. Only during the setup process, and only for the one actor that
// changed, it re-snapshots the initiative. Setup is a still point where no actor is acting, so it does
// not race the state machine — and fixing the order IS setup's job. Mid-round this hook does nothing;
// the recomputation there belongs to executeInitiativeProcess (holding increases back) and to the
// end-of-main point (releasing them).
// During setup an increase must apply at once: initiative-changing effects are normally used in setup, and reordering on the spot is exactly what they are for.
function syncInitiativeDuringSetup(actor) {
  if (!actor?.id || !game.user.isGM) return;
  const combat = game.combat;
  if (combat?.getFlag('dx3rd-emanim', 'currentProcess')?.type !== 'setup') return;
  const combatant = combat.combatants.find(entry => entry.actor?.id === actor.id);
  if (!combatant) return;
  // If the value is unchanged, refreshCombatantInitiative does nothing of its own accord.
  refreshCombatantInitiative(combat, combatant.id).catch(error => {
    console.error('DX3rd | 셋업 중 이니셔티브 갱신 실패', error);
  });
}

// The initiative stat is derived, so it changes not only on an actor update but also through ActiveEffects (applied) and equipment changes.
Hooks.on('updateActor', actor => syncInitiativeDuringSetup(actor));
for (const hook of ['createActiveEffect', 'updateActiveEffect', 'deleteActiveEffect',
                    'createItem', 'updateItem', 'deleteItem']) {
  Hooks.on(hook, document => syncInitiativeDuringSetup(document?.parent));
}

// ========== The AfterDamage queue ========== //
