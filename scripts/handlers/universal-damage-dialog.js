// Universal handler - the damage roll & damage calculation dialog cluster
// Split out of universal-handler.js. It MUST load after that file and mixes into the same object.
// (handleDamageRoll / showDamageCalculationDialog / _showAfterDamageDialog /
//  _executeAfterDamageActivation / onAttackRollComplete)
(function() {
  if (!window.DX3rdUniversalHandler) {
    console.error('DX3rd | universal-damage-dialog.js loaded before universal-handler.js; damage methods unavailable.');
    return;
  }
  // A defense choice can legitimately stay open during discussion, so expiry is deliberately
  // generous. It is a leak-safety net; explicit cancel/close cleans up immediately.
  const AFTER_DAMAGE_REQUEST_TTL_MS = 30 * 60 * 1000;

  Object.assign(window.DX3rdUniversalHandler, {
    scheduleAfterDamageRequestExpiry(damageRequestId) {
      if (!damageRequestId) return;
      window.DX3rdAfterDamageExpiryTimers ||= {};
      const previous = window.DX3rdAfterDamageExpiryTimers[damageRequestId];
      if (previous) window.clearTimeout(previous);
      window.DX3rdAfterDamageExpiryTimers[damageRequestId] = window.setTimeout(() => {
        this.discardAfterDamageRequest(damageRequestId, { reason: 'expired' });
      }, AFTER_DAMAGE_REQUEST_TTL_MS);
    },

    releaseAfterDamageRequestExpiry(damageRequestId) {
      if (!damageRequestId) return;
      const extensionPending = Boolean(window.DX3rdAfterDamageExtensionQueue?.[damageRequestId]);
      const activationPending = Boolean(window.DX3rdAfterDamageActivationQueue?.[damageRequestId]);
      if (extensionPending || activationPending) return;
      const timer = window.DX3rdAfterDamageExpiryTimers?.[damageRequestId];
      if (timer) window.clearTimeout(timer);
      if (window.DX3rdAfterDamageExpiryTimers) delete window.DX3rdAfterDamageExpiryTimers[damageRequestId];
    },

    discardAfterDamageRequest(damageRequestId, { targetActorId = null, itemId = null, reason = 'cancelled' } = {}) {
      if (!damageRequestId) return false;
      const hadExtension = Boolean(window.DX3rdAfterDamageExtensionQueue?.[damageRequestId]);
      const hadActivation = Boolean(window.DX3rdAfterDamageActivationQueue?.[damageRequestId]);
      if (hadExtension) delete window.DX3rdAfterDamageExtensionQueue[damageRequestId];
      if (hadActivation) delete window.DX3rdAfterDamageActivationQueue[damageRequestId];
      // Reports buffered while waiting for this registration are no longer wanted either.
      window.DX3rdRuntimeUtils?.discardEarlyDamageReports?.(damageRequestId);
      this.releaseAfterDamageRequestExpiry(damageRequestId);
      if (hadExtension || hadActivation) {
        window.DX3rdDebug.log(`DX3rd | AfterDamage request ${reason}:`, damageRequestId);
      }
      return hadExtension || hadActivation;
    },

    /**
     * Once the chat card is in the DOM, run exactly the same click path as the damage-roll button.
     * Sharing this path keeps afterSuccess, the attack count and the temporary-combo flags from drifting apart from a manual roll.
     */
    async maybeAutoRollDamage(message) {
      if (!message || game.settings.get('dx3rd-emanim', 'autoDamageRoll') !== true) return false;

      for (let attempt = 0; attempt < 20; attempt += 1) {
        const button = document.querySelector(
          `[data-message-id="${message.id}"] .damage-roll-btn`
        );
        if (button) {
          button.click();
          // An auto roll does not merely open the calculation dialog — it confirms it with the default values.
          // The defense / dodge dialogs that follow are the target's choice, so they are left alone.
          for (let dialogAttempt = 0; dialogAttempt < 20; dialogAttempt += 1) {
            const confirm = document.querySelector(
              '.damage-dialog button[data-action="confirm"]'
            );
            if (confirm) {
              confirm.click();
              return true;
            }
            await new Promise(resolve => window.setTimeout(resolve, 50));
          }
          console.warn(`DX3rd | Auto damage calculation dialog was not rendered: ${message.id}`);
          return false;
        }
        await new Promise(resolve => window.setTimeout(resolve, 50));
      }

      console.warn(`DX3rd | Auto damage roll button was not rendered: ${message.id}`);
      return false;
    },

    /**
     * Handle damage roll for weapons
     * @param {Actor} actor - The actor using the weapon
     * @param {Item} item - The weapon item
     * @param {number} rollResult - The result from the attack roll
     * @param {Object} preservedValues - Values preserved before disable hooks (optional)
     * @param {ChatMessage|null} sourceMessage - the original chat message holding the attack-roll result
     */
    async handleDamageRoll(actor, item, rollResult = null, preservedValues = null, comboAfterDamageData = null, sourceMessage = null) {
      const attackAfterDamageRiders = sourceMessage?.getFlag?.(
        'dx3rd-emanim', 'attackAfterDamageRiders') || [];
      let weaponAttack, actorAttack, actorAttackFormula, actorPenetrate;
      
      if (preservedValues) {
        // Use the preserved values (from before the disable hooks ran)
        weaponAttack = preservedValues.weaponAttackFormula ?? preservedValues.weaponAttack ?? 0;
        actorAttack = preservedValues.actorAttack || 0;
        actorAttackFormula = preservedValues.actorAttackFormula || '';
        actorPenetrate = preservedValues.actorPenetrate || 0;
      } else {
        // Use the current values (from after the disable hooks ran)
        weaponAttack = window.DX3rdFormulaEvaluator.prepareRollFormula(item.system.attack, item, actor);
        
        // Derive the attack type and actor bonuses (the same path as at accuracy time).
        // This path rolls damage without an accuracy check, so this is the earliest point at which
        // the penetrate dice formula settles — it is rolled here and frozen to a number.
        const bonuses = await this.resolveAttackBonusesRolled(actor, item);
        actorAttack = bonuses.actorAttack;
        actorAttackFormula = bonuses.actorAttackFormula;
        actorPenetrate = bonuses.actorPenetrate;
      }
      
      // Show the damage calculation dialog (with the roll result and the preserved values)
      this.showDamageCalculationDialog(
        actor, item, weaponAttack, actorAttack, actorAttackFormula,
        actorPenetrate,
        rollResult, comboAfterDamageData, sourceMessage, attackAfterDamageRiders
      );
    },

    /**
     * Show damage calculation dialog
     * @param {Actor} actor - The actor using the weapon
     * @param {Item} item - The weapon item
     * @param {number} weaponAttack - Weapon attack value
     * @param {number} actorAttack - Actor attack value
     * @param {number} actorPenetrate - Actor penetrate value
     * @param {number} rollResult - Attack roll result
     * @param {Object} comboAfterDamageData - Combo afterDamage data (optional)
     * @param {ChatMessage|null} sourceMessage - the attack-roll message the damage result is merged into
     */
    async showDamageCalculationDialog(actor, item, weaponAttack, actorAttack, actorAttackFormula, actorPenetrate, rollResult, comboAfterDamageData = null, sourceMessage = null, attackAfterDamageRiders = []) {

      const attackRollResult = rollResult;
      
      // Check the fear penalty
      let fearPenalty = 0;
      let fearTargetName = '';
      const fearActive = actor.system?.conditions?.fear?.active || false;
      const fearTarget = actor.system?.conditions?.fear?.target || '';
      
      if (fearActive && fearTarget) {
        // Is the feared target among the current targets?
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
          fearPenalty = -10;
        }
      }
      
      // Berserk distaste, dependency and paranoia penalties (displayed as applied at attack time)
      let distastePenalty = 0;
      let distasteTargetName = '';
      let dependencyPenalty = 0;
      let paranoiaPenalty = 0;
      const berserkActive = actor.system?.conditions?.berserk?.active || false;
      const berserkType = actor.system?.conditions?.berserk?.type || '';
      const panic8Applied = window.DX3rdAppliedEffects?.getEffect(actor, 'Panic8') || actor.system?.attributes?.applied?.Panic8;
      const madnessTypePrefixForPenalty = game.i18n.localize('DX3rd.MadnessType');
      const madness2Name = madnessTypePrefixForPenalty + ': ' + game.i18n.localize('DX3rd.Madness2');
      const hasMadness2 = actor.items.some(i => i.type === 'effect' && i.name === madness2Name);
      const actorTokenForPenalty = canvas.tokens?.placeables?.find(t => t.actor?.id === actor.id);
      
      if (actorTokenForPenalty) {
        if (berserkActive && berserkType === 'distaste') {
          const adjacentGrids = this.getAdjacentGrids(actorTokenForPenalty);
          const names = [];
          for (const grid of adjacentGrids) {
            const tokenAtGrid = this.getTokenAtGrid(grid, actorTokenForPenalty);
            if (tokenAtGrid) {
              const name = tokenAtGrid.actor?.name || tokenAtGrid.name;
              if (name && !names.includes(name)) names.push(name);
            }
          }
          if (names.length > 0) {
            distastePenalty = -10;
            distasteTargetName = names.join(', ');
          }
        }
        if (panic8Applied) {
          const roisItems = actor.items.filter(i => i.type === 'rois');
          const roisNames = roisItems.map(i => {
            const n = (i.name || '').replace(/\|\|.+$/, '').trim();
            return n;
          }).filter(Boolean);
          if (roisNames.length > 0) {
            const tokenSize = Math.max(actorTokenForPenalty.document.width, actorTokenForPenalty.document.height);
            const engageRange = Math.ceil(tokenSize / 2);
            const engageGrids = this.getGridsInRange(actorTokenForPenalty, engageRange);
            let hasMatching = false;
            for (const grid of engageGrids) {
              const t = this.getTokenAtGrid(grid, actorTokenForPenalty);
              if (t?.actor && roisNames.includes(t.actor.name || '')) {
                hasMatching = true;
                break;
              }
            }
            if (!hasMatching) dependencyPenalty = -4;
          }
        }
        if (hasMadness2) {
          const roisItems = actor.items.filter(i => i.type === 'rois');
          const roisNames = roisItems.map(i => {
            const n = (i.name || '').replace(/\|\|.+$/, '').trim();
            return n;
          }).filter(Boolean);
          const adjacentGrids = this.getAdjacentGrids(actorTokenForPenalty);
          for (const grid of adjacentGrids) {
            const t = this.getTokenAtGrid(grid, actorTokenForPenalty);
            if (t?.actor) {
              const name = t.actor.name || '';
              if (name && !roisNames.includes(name)) {
                paranoiaPenalty = -2;
                break;
              }
            }
          }
        }
      }
      
      // Madness 6 (megalomania): damage roll +1 when the attack roll came out at 20 or more
      let madness6Bonus = 0;
      const madnessTypePrefix = game.i18n.localize('DX3rd.MadnessType');
      const madness6Name = madnessTypePrefix + ': ' + game.i18n.localize('DX3rd.Madness6');
      const hasMadness6 = actor.items.some(i => i.type === 'effect' && i.name === madness6Name);
      if (hasMadness6 && attackRollResult >= 20) {
        madness6Bonus = 1;
      }
      
      // Madness 7 (trigger happy): damage roll attack +5, only for attacks whose system.skill is ranged
      let madness7Bonus = 0;
      const madness7Name = madnessTypePrefix + ': ' + game.i18n.localize('DX3rd.Madness7');
      const hasMadness7 = actor.items.some(i => i.type === 'effect' && i.name === madness7Name);
      if (hasMadness7 && item?.system?.skill === 'ranged') {
        madness7Bonus = 5;
      }
      
      // The references are already frozen to their values at accuracy time. Only the attack's dice
      // formula is held back to the confirm button, so the dialog shows the formula rather than a result.
      const weaponAttackFormula = String(weaponAttack ?? 0).trim() || '0';
      const joinFormulaTerms = (...terms) => this.joinFormulaTerms(...terms);
      const baseDamageAddFormula = joinFormulaTerms(actorAttack, actorAttackFormula, weaponAttackFormula, fearPenalty);
      const totalDamageAddFormula = joinFormulaTerms(baseDamageAddFormula, madness7Bonus);
      
      // Prepare the template data (megalomania and trigger-happy shown separately)
      const dicePart = `[${attackRollResult} / 10 + 1${madness6Bonus ? ' + 1(' + game.i18n.localize('DX3rd.Madness6') + ')' : ''}]D10`;
      const addPart = `${baseDamageAddFormula}${madness7Bonus ? ' + 5(' + game.i18n.localize('DX3rd.Madness7') + ')' : ''}`;
      // Declaration equipment (a rocket launcher's armor-ignore, say) is declared in the accuracy dialog, not here.
      // The rules say to declare it "immediately before making the accuracy check", so letting the player pick
      // after seeing the hit would create a spot to save uses on a miss — see the 'attack' context in declared-equipment.js.
      const templateData = {
        formula: `${dicePart} + ${addPart}`,
        actorPenetrate: actorPenetrate,
        fearPenalty: fearPenalty,
        fearTargetName: fearTargetName,
        distastePenalty,
        distasteTargetName,
        dependencyPenalty,
        paranoiaPenalty
      };
      
      // Render the HTML template
      const dialogContent = await foundry.applications.handlebars.renderTemplate("systems/dx3rd-emanim/templates/dialog/damage-calc-dialog.html", templateData);

      const DialogV2 = foundry.applications?.api?.DialogV2;
      if (!DialogV2?.wait) {
        ui.notifications.error(game.i18n.localize('DX3rd.DialogV2Unavailable'));
        return;
      }

      // Confirming the calculation dialog IS confirming the application — the roll result is held here
      // and applied automatically once the dialog closes. Applying inside the dialog callback would
      // stack the defense dialog (when the GM owns the target) on top of the still-open calculation dialog.
      let pendingApply = null;

      await DialogV2.wait({
        window: {
          title: game.i18n.localize('DX3rd.CalcDamage')
        },
        content: dialogContent,
        rejectClose: false,
        buttons: [
          {
            action: "confirm",
            label: game.i18n.localize('DX3rd.Confirm'),
            default: true,
            callback: async (event, button) => {
              const form = button.form;
              const penetrate = parseInt(form?.querySelector('#penetrate')?.value) || 0;
              const addResult = parseInt(form?.querySelector('#add-result')?.value) || 0;
              const addDamageRoll = parseInt(form?.querySelector('#add-damage-roll')?.value) || 0;
              // Damage modifiers are Roll formulas, not numeric-only fields. Keep dice terms until
              // the final damage Roll so `1d10`, `-1d10`, and item tokens are evaluated exactly once.
              const addDamageInput = String(form?.querySelector('#add-damage')?.value ?? '').trim() || '0';
              const addDamage = window.DX3rdFormulaEvaluator?.prepareRollFormula
                ? window.DX3rdFormulaEvaluator.prepareRollFormula(addDamageInput, item, actor)
                : addDamageInput;
              
              // Final dice count (fraction dropped, megalomania bonus included)
              const finalDiceCount = Math.floor((attackRollResult + addResult) / 10) + 1 + addDamageRoll + madness6Bonus;
              
              // The item attack's dice formula is settled exactly once, right here.
              const finalDamageAddFormula = joinFormulaTerms(totalDamageAddFormula, addDamage);
              const finalDamageFormula = joinFormulaTerms(`${finalDiceCount}d10`, finalDamageAddFormula);
              
              // Final armor-ignore value = whatever the user typed
              const finalPenetrate = penetrate;
              
              
              try {
                // Roll the damage
                const damageRoll = await (new Roll(finalDamageFormula)).roll();
                
                // Render the roll result as HTML
                const rollHTML = await damageRoll.render();
                // Roll.render() already returns a .dice-roll root. Wrapping it once more throws off
                // the width calculation and tooltip placement in the Midi-QOL-style vertical result column.
                const rollMessage = rollHTML;
                
                // Build the damage-roll caption (armor-ignore is omitted when 0)
                let damageRollInfo = game.i18n.localize('DX3rd.DamageRoll');
                if (finalPenetrate > 0) {
                  damageRollInfo += ` (${game.i18n.localize('DX3rd.Penetrate')}: ${finalPenetrate})`;
                }
                
                // Confirming the calculation IS applying to the targets. Below the result there is no
                // second apply button, only an accuracy-roll button to start the same attack again.
                const damageApplyContent = `
                  <div class="dx3rd-damage-result">
                    <div class="dx3rd-roll-label">${damageRollInfo}</div>
                    ${rollMessage}
                  </div>
                  <div class="dx3rd-card-buttons dx3rd-damage-actions">
                    ${this.renderAttackRollButton(actor, item, {repeatable: true})}
                  </div>
                `;
                
                const messageData = {
                  speaker: {
                    actor: actor.id,
                    alias: actor.name
                  },
                  content: damageApplyContent,
                  rolls: [damageRoll]
                };
                
                // Initialize flags only when there is comboAfterDamage data or a temporary combo
                if (comboAfterDamageData || attackAfterDamageRiders.length > 0 || window.DX3rdIsInstantCombo?.(item)) {
                  messageData.flags = {
                    'dx3rd-emanim': {}
                };
                
                // Store the comboAfterDamage data in the flag when present
                if (comboAfterDamageData) {
                  messageData.flags['dx3rd-emanim'].comboAfterDamage = comboAfterDamageData;
                }
                if (attackAfterDamageRiders.length > 0) {
                  messageData.flags['dx3rd-emanim'].attackAfterDamageRiders = attackAfterDamageRiders;
                }
                
                // Copy the item data too for a temporary combo
                if (window.DX3rdIsInstantCombo?.(item)) {
                  messageData.flags['dx3rd-emanim'].tempComboItem = window.DX3rdSerializeInstantCombo(item);
                  }
                }
                
                const damageMessage = sourceMessage
                  ? await this.mergeDamageRollIntoMessage(sourceMessage, damageApplyContent, damageRoll)
                  : await ChatMessage.create(messageData);

                pendingApply = {
                  message: damageMessage,
                  damage: damageRoll.total,
                  penetrate: finalPenetrate,
                  attackResult: attackRollResult
                };

              } catch (error) {
                console.error('DX3rd | Damage roll failed:', error);
                ui.notifications.error('데미지 롤 중 오류가 발생했습니다.');
              }
            }
          }
        ],
        classes: ["dx3rd-emanim", "damage-dialog"]
      });

      // A damage roll is one action: roll plus apply.
      // The caller (handleDamageRoll) does not await this function — the existing ordering that keeps
      // afterSuccess extensions from waiting on the dialog — so errors are swallowed here to avoid an unhandled rejection.
      if (pendingApply) {
        try {
          const applied = await this.runDamageApply({
            actor, item,
            damage: pendingApply.damage,
            penetrate: pendingApply.penetrate,
            attackResult: pendingApply.attackResult,
            comboAfterDamageData,
            attackAfterDamageRiders
          });
          if (applied) {
            await pendingApply.message?.setFlag('dx3rd-emanim', 'damageApplyCompleted', true);
          }
        } catch (error) {
          console.error('DX3rd | Damage auto-apply failed:', error);
          ui.notifications.error('데미지 적용 중 오류가 발생했습니다.');
        }
      }
    },

    /**
     * Merge the damage result into the damage-button area of the attack-roll card.
     * On a reroll the stored last damage Roll is replaced too, so one card holds only the current result.
     */
    async mergeDamageRollIntoMessage(sourceMessage, damageApplyContent, damageRoll) {
      const root = document.createElement('div');
      root.innerHTML = sourceMessage.content || '';

      const slot = root.querySelector('.damage-roll-message');
      const damageRollButton = slot?.querySelector('.damage-roll-btn')?.outerHTML
        || root.querySelector('.damage-roll-btn')?.outerHTML
        || '';
      const damageRoot = document.createElement('div');
      damageRoot.innerHTML = damageApplyContent;
      let damageActions = damageRoot.querySelector('.dx3rd-damage-actions');
      if (!damageActions) {
        damageActions = document.createElement('div');
        damageActions.className = 'dx3rd-card-buttons dx3rd-damage-actions';
        damageRoot.append(damageActions);
      }
      if (damageRollButton) damageActions.insertAdjacentHTML('beforeend', damageRollButton);
      const mergedContent = damageRoot.innerHTML;

      if (slot) {
        slot.innerHTML = mergedContent;
      } else {
        const card = root.querySelector('.dx3rd-item-chat') || root;
        const result = document.createElement('div');
        result.className = 'damage-roll-message';
        result.innerHTML = mergedContent;
        card.append(result);
      }

      const rolls = Array.from(sourceMessage.rolls || [], roll => roll.toJSON());
      const alreadyMerged = sourceMessage.getFlag('dx3rd-emanim', 'damageRollMerged') === true;
      const serializedDamageRoll = damageRoll.toJSON();
      if (alreadyMerged && rolls.length > 0) {
        rolls[rolls.length - 1] = serializedDamageRoll;
      } else {
        rolls.push(serializedDamageRoll);
      }

      await sourceMessage.update({
        content: root.innerHTML,
        rolls,
        'flags.dx3rd-emanim.damageRollMerged': true
      });
      return sourceMessage;
    },

    /**
     * The damage application path (gates included). Applying right after the calculation dialog is
     * confirmed and the old chat card's 'apply damage' button share this one path.
     * Targets are read from game.user.targets at call time (as the button path does).
     * @returns {Promise<boolean>} true when the application actually proceeded (false when a gate blocked it)
     */
    async runDamageApply({actor, item, damage, penetrate, attackResult = 0, comboAfterDamageData = null, attackAfterDamageRiders = []} = {}) {
      if (!actor) return false;

      // Permission check
      if (!actor.isOwner && !game.user.isGM) {
        console.warn('DX3rd | User lacks permission to use this actor\'s actions');
        return false;
      }

      // Select the actor's token automatically
      const previousToken = canvas.tokens?.controlled?.[0] || null;
      const actorToken = canvas.tokens?.placeables.find(t => t.actor?.id === actor.id);
      if (actorToken) actorToken.control({ releaseOthers: true });

      const restoreToken = () => {
        if (previousToken && canvas.tokens) previousToken.control({ releaseOthers: true });
      };

      // Target check
      const targets = Array.from(game.user.targets);
      if (targets.length === 0) {
        ui.notifications.warn(game.i18n.localize('DX3rd.SelectTarget'));
        restoreToken();
        return false;
      }

      // Hatred status check (hatred.target must be among the targets)
      const hatredActive = actor.system?.conditions?.hatred?.active || false;
      const hatredTarget = actor.system?.conditions?.hatred?.target || '';
      if (hatredActive && hatredTarget) {
        const hasHatredTarget = targets.some(t => (t.actor?.name || t.name) === hatredTarget);
        if (!hasHatredTarget) {
          const hatredMessage = game.i18n.localize('DX3rd.MustAttackHatredTarget').replace('{target}', hatredTarget);
          await ChatMessage.create({
            speaker: window.DX3rdRuntimeUtils.getActorOnlySpeaker(actor),
            content: `<div style="color: #ff6b6b;"><strong>${game.i18n.localize('DX3rd.Hatred')}: ${hatredMessage}</strong></div>`
          });
          restoreToken();
          return false;
        }
      }

      // Automatic hatred recovery moved to accuracy time (onAttackRollComplete).
      // By the rules it recovers regardless of success, so a miss — where the damage button is never pressed — has to be covered too.
      // The hatred target check above stays as a safety net against applying damage to the wrong target.
      await this.handleDamageApply(
        actor, item, damage, penetrate, targets, comboAfterDamageData, attackResult, attackAfterDamageRiders);
      restoreToken();
      return true;
    },

    /**
     * Apply the damage
     * @param {Object} comboAfterDamageData - combo afterDamage data (optional)
     */
    async processAfterDamageExtensionRequest(request) {
      if (!request) return [];
      const reports = Object.entries(request.damageReports || {}).map(([targetKey, value]) => {
        const index = request.targetTokenIds?.indexOf(targetKey) ?? -1;
        return {
          targetTokenId: typeof value === 'object' ? (value.targetTokenId || targetKey) : targetKey,
          actorId: typeof value === 'object'
            ? value.actorId
            : (request.reportActorIds?.[targetKey] || request.targetActorIds?.[index] || targetKey),
          hpChange: Number(typeof value === 'object' ? value.hpChange : value) || 0
        };
      });
      const damagedReports = reports.filter(report => report.hpChange >= 1);
      const damagedActorIds = [...new Set(damagedReports.map(report => report.actorId).filter(Boolean))];
      const damagedTokenIds = [...new Set(damagedReports.map(report => report.targetTokenId).filter(Boolean))];
      const extensions = request.extensions || {};
      const conditions = Array.isArray(extensions.condition)
        ? extensions.condition
        : (extensions.condition ? [extensions.condition] : []);
      const cards = Array.isArray(extensions.cards) ? extensions.cards : [];
      const riderExtensions = Array.isArray(extensions.riderExtensions) ? extensions.riderExtensions : [];
      const allEntries = [extensions.heal, extensions.damage, extensions.statusClear, ...conditions,
        ...cards.map(card => card.data), ...riderExtensions.map(entry => entry.data)].filter(Boolean);
      const includesSelf = allEntries.some(data => {
        const target = data.target || 'self';
        return target === 'self' || target === 'targetAll';
      });
      if (damagedActorIds.length === 0 && !includesSelf) return damagedActorIds;

      const actor = game.actors.get(request.attackerId);
      if (!actor) return damagedActorIds;
      const item = actor.items.get(request.itemId) || null;
      // sourceItem defaults to the request's own item; rider extensions pass their source item so
      // formulas ([level], attribute references) and the afterMain re-queue read that item.
      const withTargets = (data, sourceItem = item, sourceName = null) => ({
        ...data,
        ...window.DX3rdRuntimeUtils.resolveAfterDamageTarget(
          data?.target,
          damagedTokenIds,
          data?.selectedTargetIds || []
        ),
        triggerItemName: sourceName || request.triggerItemName || sourceItem?.name || null,
        triggerItemId: sourceItem?.id || request.itemId
      });
      const execute = async (type, rawData, sourceItem = item, sourceName = null) => {
        if (!rawData) return;
        const authoredTarget = rawData.target || 'self';
        if ((authoredTarget === 'targetToken' || authoredTarget === 'damagedTargets')
            && damagedTokenIds.length === 0) return;
        const data = withTargets(rawData, sourceItem, sourceName);
        if (data.timing === 'afterMain') {
          if (sourceItem?.system?.active?.runTiming === 'afterDamage') {
            await this.addToAfterMainQueue(actor, data, sourceItem, type);
          }
          return;
        }
        if (type === 'heal') await this.executeHealExtensionNow(actor, data, sourceItem);
        else if (type === 'damage') await this.executeDamageExtensionNow(actor, data, sourceItem);
        else if (type === 'statusClear') await this.executeStatusClearExtension(actor, data, sourceItem);
        else if (type === 'condition') await this.executeConditionExtensionNow(actor, data, sourceItem);
        else await this.executeItemExtension(actor, type, data, sourceItem);
      };

      await execute('heal', extensions.heal);
      await execute('damage', extensions.damage);
      await execute('statusClear', extensions.statusClear);
      for (const condition of conditions) await execute('condition', condition);
      for (const card of cards) await execute(card.type, card.data);
      for (const riderExtension of riderExtensions) {
        const riderItem = riderExtension.itemId ? (actor.items.get(riderExtension.itemId) || null) : null;
        await execute(riderExtension.type, riderExtension.data, riderItem, riderExtension.itemName);
      }
      return damagedActorIds;
    },

    handleDamageApply: async function(actor, item, damage, penetrate, targets, comboAfterDamageData = null, attackResult = null, attackAfterDamageRiders = []) {
      if (!actor || !targets || targets.length === 0) {
        return;
      }
      // One correlation id follows this damage application through registration, every defense
      // dialog report, and cleanup. Actor+item is not unique when the same attack is rerun or used
      // again before every target has answered.
      const damageRequestId = window.DX3rdRuntimeUtils.createRequestId('afterDamage');
      const targetActorIds = targets.map(target => target.actor.id);
      const targetTokenIds = targets.map(target => target.id);
      const pendingAttackRiders = Array.isArray(attackAfterDamageRiders)
        ? foundry.utils.deepClone(attackAfterDamageRiders)
        : [];

      // Extensions armed by preparation items used before this attack (a minor-action effect whose
      // payload fires on damage, e.g. a condition on the damaged token). They join this request's extension
      // queue so they resolve against damaged targets; each keeps its source item for [level] context.
      // The attack item's own extensions are read live below, so its fromAttackItem rider carries none.
      const riderExtensions = [];
      for (const rider of pendingAttackRiders) {
        if (rider?.fromAttackItem === true) continue;
        for (const ext of Array.isArray(rider?.extensions) ? rider.extensions : []) {
          if (!ext?.type || !ext?.data) continue;
          riderExtensions.push({
            itemId: rider.itemId,
            itemName: rider.itemName,
            type: ext.type,
            data: ext.data
          });
        }
      }

      // ===== Request registration in the extension queue (to the GM) =====
      // Combos are merged and handled in processComboAfterDamage, so their own extensions are excluded —
      // extensions riding from separately-used items still register.
      if (item && (item.type !== 'combo' || riderExtensions.length > 0)) {
        const itemExtend = item.type === 'combo' ? {} : (item.getFlag('dx3rd-emanim', 'itemExtend') || {});
        const attackMatches = (kind, data) => !window.DX3rdItemEffectAdapter
          || window.DX3rdItemEffectAdapter.extensionActionMatches(item, kind, data, 'attack', 'afterDamage');
        // Check the afterDamage timing
        const condEntries = window.DX3rdUniversalHandler?._getConditionEntries(itemExtend.condition || {}) || [];
        const condEntriesForAttack = condEntries.filter(c => attackMatches('condition', c));
        const cardEntriesForAttack = (window.DX3rdItemEffectAdapter?.extensionEntries?.(itemExtend) || [])
          .filter(entry => !entry.legacy && entry.data?.activate && attackMatches(entry.type, entry.data));
        const queuedCards = cardEntriesForAttack.filter(entry =>
          entry.data?.timing === 'afterDamage' ||
          (item.system.active?.runTiming === 'afterDamage' && entry.data?.timing === 'afterMain'));
        const hasCondAfterDamage = condEntriesForAttack.some(c => c.timing === 'afterDamage');
        const hasCondAfterMain = condEntriesForAttack.some(c => c.timing === 'afterMain');
        const hasAfterDamageExtension =
          riderExtensions.length > 0 ||
          (itemExtend.heal?.activate && itemExtend.heal?.timing === 'afterDamage' && attackMatches('heal', itemExtend.heal)) ||
          (itemExtend.damage?.activate && itemExtend.damage?.timing === 'afterDamage' && attackMatches('damage', itemExtend.damage)) ||
          (itemExtend.statusClear?.activate && itemExtend.statusClear?.timing === 'afterDamage' && attackMatches('statusClear', itemExtend.statusClear)) ||
          hasCondAfterDamage || queuedCards.some(entry => entry.data?.timing === 'afterDamage');
        
        // Also check the case where the item's runTiming is afterDamage and the extension timing is afterMain
        const itemRunTiming = item.system.active?.runTiming;
        const hasAfterMainExtensionForAfterDamage = 
          itemRunTiming === 'afterDamage' && (
            (itemExtend.heal?.activate && itemExtend.heal?.timing === 'afterMain' && attackMatches('heal', itemExtend.heal)) ||
            (itemExtend.damage?.activate && itemExtend.damage?.timing === 'afterMain' && attackMatches('damage', itemExtend.damage)) ||
            (itemExtend.statusClear?.activate && itemExtend.statusClear?.timing === 'afterMain' && attackMatches('statusClear', itemExtend.statusClear)) ||
            hasCondAfterMain || queuedCards.some(entry => entry.data?.timing === 'afterMain')
          );
        
        if (hasAfterDamageExtension || hasAfterMainExtensionForAfterDamage) {
          if (window.DX3rdSocketRouter.isResponsibleGM()) {
            // The responsible GM owns the request queue, even when another GM initiated the attack.
            const queueKey = damageRequestId;
            
            if (!window.DX3rdAfterDamageExtensionQueue) {
              window.DX3rdAfterDamageExtensionQueue = {};
            }
            
            window.DX3rdAfterDamageExtensionQueue[queueKey] = {
              attackerId: actor.id,
              itemId: item.id,
              damageRequestId,
              targetActorIds: targetActorIds,
              targetTokenIds: targetTokenIds,
              damageReports: {},
              hitReports: {},
              reportActorIds: {},
              reportCount: 0,
              extensions: {
                // afterDamage timing, or (the item's runTiming is afterDamage and the extension timing is afterMain)
                heal: itemExtend.heal?.activate && (
                  itemExtend.heal?.timing === 'afterDamage' || 
                  (itemRunTiming === 'afterDamage' && itemExtend.heal?.timing === 'afterMain')
                ) && attackMatches('heal', itemExtend.heal) ? itemExtend.heal : null,
                damage: itemExtend.damage?.activate && (
                  itemExtend.damage?.timing === 'afterDamage' || 
                  (itemRunTiming === 'afterDamage' && itemExtend.damage?.timing === 'afterMain')
                ) && attackMatches('damage', itemExtend.damage) ? itemExtend.damage : null,
                statusClear: itemExtend.statusClear?.activate && (
                  itemExtend.statusClear?.timing === 'afterDamage' ||
                  (itemRunTiming === 'afterDamage' && itemExtend.statusClear?.timing === 'afterMain')
                ) && attackMatches('statusClear', itemExtend.statusClear) ? itemExtend.statusClear : null,
                condition: (() => {
                  const match = condEntriesForAttack.filter(c =>
                    c.timing === 'afterDamage' ||
                    (itemRunTiming === 'afterDamage' && c.timing === 'afterMain')
                  );
                  return match.length > 0 ? match : null;
                })(),
                cards: queuedCards.map(entry => ({type: entry.type, data: entry.data})),
                riderExtensions
              },
              triggerItemName: item.name,
              itemRunTiming: itemRunTiming,  // store the item's runTiming
              createdAt: Date.now()
            };
            this.scheduleAfterDamageRequestExpiry(damageRequestId);
            
            window.DX3rdDebug.log('DX3rd | GM registered afterDamage extension request:', {
              queueKey: queueKey,
              attacker: actor.name,
              targetCount: targetActorIds.length,
              hasHeal: !!window.DX3rdAfterDamageExtensionQueue[queueKey].extensions.heal,
              hasDamage: !!window.DX3rdAfterDamageExtensionQueue[queueKey].extensions.damage,
              hasCondition: !!window.DX3rdAfterDamageExtensionQueue[queueKey].extensions.condition
            });
          } else {
            // A player asks the GM to register the queue entry
            window.DX3rdSocketRouter.emit({
              type: 'registerAfterDamageExtension',
              payload: {
                attackerId: actor.id,
                itemId: item.id,
                damageRequestId,
                targetActorIds: targetActorIds,
                targetTokenIds: targetTokenIds,
                extensions: {
                  // afterDamage timing, or (the item's runTiming is afterDamage and the extension timing is afterMain)
                  heal: itemExtend.heal?.activate && (
                    itemExtend.heal?.timing === 'afterDamage' || 
                    (item.system.active?.runTiming === 'afterDamage' && itemExtend.heal?.timing === 'afterMain')
                  ) && attackMatches('heal', itemExtend.heal) ? itemExtend.heal : null,
                  damage: itemExtend.damage?.activate && (
                    itemExtend.damage?.timing === 'afterDamage' || 
                    (item.system.active?.runTiming === 'afterDamage' && itemExtend.damage?.timing === 'afterMain')
                  ) && attackMatches('damage', itemExtend.damage) ? itemExtend.damage : null,
                  statusClear: itemExtend.statusClear?.activate && (
                    itemExtend.statusClear?.timing === 'afterDamage' ||
                    (item.system.active?.runTiming === 'afterDamage' && itemExtend.statusClear?.timing === 'afterMain')
                  ) && attackMatches('statusClear', itemExtend.statusClear) ? itemExtend.statusClear : null,
                  condition: (() => {
                    const ce = window.DX3rdUniversalHandler?._getConditionEntries(itemExtend.condition || {}) || [];
                    const match = ce.filter(c => attackMatches('condition', c) && (
                      c.timing === 'afterDamage' ||
                      (item.system.active?.runTiming === 'afterDamage' && c.timing === 'afterMain')
                    ));
                    return match.length > 0 ? match : null;
                  })(),
                  cards: queuedCards.map(entry => ({type: entry.type, data: entry.data})),
                  riderExtensions
                },
                triggerItemName: item.name
              }
            });
            
            window.DX3rdDebug.log('DX3rd | Sent afterDamage extension registration to GM');
          }
        }
      }

      // Register the activation / macro request (only when there is an item)
      if (item?.id) {
        const isCombo = item.type === 'combo';
        
        // A combo registers only comboAfterDamageData; a single item follows the original logic
        const activeDisable = item.system?.active?.disable ?? '-';
        const activeActionMatches = !window.DX3rdItemEffectAdapter || window.DX3rdItemEffectAdapter.extensionActionMatches(item, 'selfModifiers', item.system?.active || {}, 'attack', 'afterDamage');
        const targetActionMatches = !window.DX3rdItemEffectAdapter || window.DX3rdItemEffectAdapter.targetActionMatches(item, 'attack', 'afterDamage');
        const shouldActivate = !isCombo && activeActionMatches && (item.system.active?.runTiming === 'afterDamage' && !item.system.active?.state && activeDisable !== 'notCheck');
        // Are there target modifiers to apply after the damage? This reads the "on attack" bucket's own
        // timing rather than the channel field (effect.runTiming) — each card can author its own trigger timing.
        const shouldApplyToTargets = !isCombo && targetActionMatches && (window.DX3rdItemEffectAdapter
          ? window.DX3rdItemEffectAdapter.targetFiresAt(item, 'attack', 'afterDamage')
          : item.system.effect?.runTiming === 'afterDamage');
        const hasAfterDamageEmbeddedMacro = (item.system?.macros || []).some(macro =>
          !macro.disabled && macro.timing === 'afterDamage' &&
          (!window.DX3rdItemEffectAdapter || window.DX3rdItemEffectAdapter.macroActionMatches(item, macro, 'attack', 'afterDamage'))
        );
        const shouldExecuteMacro = !isCombo && (!!item.system?.macro || hasAfterDamageEmbeddedMacro);

        // This is follow-up work for an action that already passed processItemUsageCost. Rechecking
        // the now-incremented counter here suppresses max-1 effects, and a macro must not be a secret
        // bypass around that gate. Register every accepted action uniformly.
        if (isCombo || shouldActivate || shouldApplyToTargets || shouldExecuteMacro || pendingAttackRiders.length > 0) {
            const needsDialog = item.type === 'weapon' || item.type === 'vehicle';
            
            if (window.DX3rdSocketRouter.isResponsibleGM()) {
              // The responsible GM owns the request queue, even when another GM initiated the attack.
              const queueKey = damageRequestId;
              window.DX3rdAfterDamageActivationQueue[queueKey] = {
                attackerId: actor.id,
                itemId: item.id,
                damageRequestId,
                targetActorIds: targetActorIds,
                targetTokenIds: targetTokenIds,
                damageReports: {},
                hitReports: {},
                reportActorIds: {},
                reportCount: 0,
                shouldExecuteMacro: shouldExecuteMacro,
                shouldActivate: shouldActivate,
                shouldApplyToTargets: shouldApplyToTargets,
                needsDialog: needsDialog,
                comboAfterDamageData: comboAfterDamageData, // store the combo data
                pendingAttackRiders,
                createdAt: Date.now()
              };
              this.scheduleAfterDamageRequestExpiry(damageRequestId);
              window.DX3rdDebug.log('DX3rd | GM registered afterDamage request:', {
                queueKey: queueKey,
                attacker: actor.name,
                targetCount: targetActorIds.length,
                hasMacro: shouldExecuteMacro,
                hasComboData: !!comboAfterDamageData
              });
            } else {
              // An ordinary user asks the GM to register it
              window.DX3rdSocketRouter.emit({
                type: 'registerAfterDamageActivation',
                payload: {
                  attackerId: actor.id,
                  itemId: item.id,
                  damageRequestId,
                  targetActorIds: targetActorIds,
                  targetTokenIds: targetTokenIds,
                  shouldExecuteMacro: shouldExecuteMacro,
                  shouldActivate: shouldActivate,
                  shouldApplyToTargets: shouldApplyToTargets,
                  needsDialog: needsDialog,
                  comboAfterDamageData: comboAfterDamageData, // pass the combo data along
                  pendingAttackRiders
                }
              });
              window.DX3rdDebug.log('DX3rd | AfterDamage registration sent to GM:', {
                attacker: actor.name,
                item: item.name,
                targetCount: targetActorIds.length,
                hasMacro: shouldExecuteMacro,
                hasComboData: !!comboAfterDamageData
              });
            }
        }
      }

      // Frozen here, on the attacking client, for the same reason target modifiers are: the
      // defender's client cannot resolve the attacker's combo members or registered weapons.
      const bypassDefense = window.DX3rdItemEffectAdapter.attackBypassDefense(actor, item);

      // Deliver the defense dialog to each target
      let undeliverableCount = 0;
      for (const target of targets) {
        const targetActor = target.actor;
        if (!targetActor) continue;
        
        const payload = {
          targetActorId: targetActor.id,
          targetTokenId: target.id,
          damage: damage,
          penetrate: penetrate,
          attackResult: attackResult,
          attackerName: actor.name,
          attackerId: actor.id,
          itemId: item?.id || null,
          bypassDefense,
          damageRequestId
        };
        
        // Send the defense dialog (the target's owner first)
        if (game.user.isGM) {
          // GM: is there a non-GM owner for this target?
          const nonGMOwners = game.users.filter(user => 
            !user.isGM && 
            user.active &&  // only users who are connected
            targetActor.testUserPermission(user, 'OWNER')
          );
          
          if (nonGMOwners.length > 0) {
            // With a connected non-GM owner, send it over the socket
            window.DX3rdSocketRouter.emitToActorExecutor({
              type: 'showDefenseDialog',
              dialogData: payload  // payload → dialogData, kept uniform
            }, targetActor);
            window.DX3rdDebug.log('DX3rd | Defense dialog sent via socket to non-GM owner for:', targetActor.name);
          } else {
            // With no connected non-GM owner, the GM shows it directly
            await this.showDefenseDialog(payload);
            window.DX3rdDebug.log('DX3rd | GM showing defense dialog directly (no active non-GM owner)');
          }
        } else {
          // An ordinary user always sends it over the socket (the GM fallback handles it)
          const sent = window.DX3rdSocketRouter.emitToActorExecutor({
            type: 'showDefenseDialog',
            dialogData: payload  // payload → dialogData, kept uniform
          }, targetActor);
          if (sent) {
            window.DX3rdDebug.log('DX3rd | Defense dialog sent via socket for:', targetActor.name);
          } else {
            // No client can answer for this target (no active owner and no active GM), so no one
            // can persist its HP change either — say so instead of hanging the whole request.
            undeliverableCount++;
            window.DX3rdDebug.log('DX3rd | No executor for defense dialog:', targetActor.name);
          }
        }
      }

      ui.notifications.info(`데미지 적용 다이얼로그를 ${targets.length - undeliverableCount}명의 대상에게 전송했습니다.`);
      if (undeliverableCount > 0) {
        ui.notifications.warn(`${undeliverableCount}명의 대상은 수신 가능한 사용자가 없어 방어와 대미지 적용이 생략됐습니다.`);
      }
    },

    /**
     * Show the defense dialog
     */
    showDefenseDialog: async function(payload) {
      const { targetActorId, targetTokenId, damage, penetrate, attackResult, attackerName, attackerId, itemId, damageRequestId } = payload;
      // Older cards carry no snapshot; absent means nothing was bypassed.
      const bypassDefense = window.DX3rdItemEffectAdapter.bypassDefense({ system: { bypassDefense: payload.bypassDefense } });
      
      const targetActor = game.actors.get(targetActorId);
      if (!targetActor) {
        console.warn('DX3rd | Target actor not found:', targetActorId);
        return;
      }
      
      // Permission check
      if (!targetActor.isOwner) {
        console.warn('DX3rd | User does not own this actor');
        return;
      }
      
      // Prepare the defense dialog data.
      // A weapon's guard value is the item's own field (system.guard), so it never goes through the attribute channel.
      // The template value used to be parseInt'd directly, truncating "2d10" to 2 and turning "[level]" into 0.
      // It is split here into a fixed part and a dice formula; the dice join the guard roll on confirmation.
      const F = window.DX3rdFormulaEvaluator;
      const weaponList = targetActor.items.filter(item => item.type === 'weapon')
        .map(weapon => {
          const raw = weapon.system.guard;
          const prepared = F.prepareRollFormula(raw, weapon, targetActor);
          const isDice = F.hasDice(prepared);
          // A bucket bonus like "+N to the guard value of a fist" applies only when guarding with that
          // weapon. This is the one place the weapon is settled, so the actor's bucket share joins here.
          const bucket = window.DX3rdUniversalHandler.getWeaponGuardBonus(targetActor, weapon);
          const guardFixed = (isDice ? 0 : (Number(F.evaluate(raw, weapon, targetActor)) || 0))
            + bucket.fixed;
          const guardFormula = [isDice ? prepared : '', bucket.formula].filter(Boolean).join(' + ');
          return {
            id: weapon.id,
            name: weapon.name,
            guardFixed,
            guardFormula,
            guardLabel: [guardFixed || !guardFormula ? String(guardFixed) : '', guardFormula]
              .filter(Boolean).join(' + ')
          };
        })
        // Highest guard first (ties keep their original order). A dice formula has a fixed part of 0, so it sorts last.
        .sort((a, b) => b.guardFixed - a.guardFixed);
      // The actor sheet's guard.value already shows the equipped weapon's guard, but the real defense adds
      // the weapon choice below separately. Starting from base is what keeps an equipped weapon from counting twice.
      const guard = targetActor.system.attributes.guard?.base
        ?? targetActor.system.attributes.guard?.value
        ?? 0;
      const armor = targetActor.system.attributes.armor?.value || 0;
      const reduce = targetActor.system.attributes.reduce?.value || 0;
      // Trigger-time formulas are not rolled when the defense dialog opens: the source is displayed and rolled once on confirmation.
      // A dice formula written into a plain value field is rolled exactly once, when the defense is confirmed.
      const deferredDefenseFormula = (attrKey) => {
        const attr = targetActor.system.attributes[attrKey] || {};
        return attr.valueFormula || '';
      };
      let guardRollFormula = deferredDefenseFormula('guard');
      let armorRollFormula = deferredDefenseFormula('armor');
      let reduceRollFormula = deferredDefenseFormula('reduce');
      const currentHP = targetActor.system.attributes.hp?.value || 0;
      const maxHP = targetActor.system.attributes.hp?.max || 0;

      /**
       * Read the checked weapons' guard values, split into a fixed part and a dice formula.
       * Kept in one place so the live display (root) and the final calculation (form) use the same rule.
       * @param {Element} scope - the element to query from
       * @returns {{fixed: number, formula: string}}
       */
      const readCheckedWeaponGuard = (scope) => {
        let fixed = 0;
        const formulas = [];
        for (const checkbox of (scope?.querySelectorAll('.weapon-checkbox:checked') || [])) {
          fixed += parseInt(checkbox.dataset.guard) || 0;
          if (checkbox.dataset.guardFormula) formulas.push(`(${checkbox.dataset.guardFormula})`);
        }
        return {fixed, formula: formulas.join(' + ')};
      };

      // Whether [berserk] forbids guarding. Kept in one place so disabling the input (when the setting blocks)
      // and the warning (when it allows) use the same test — drifting apart gives "the input is live but no warning appears".
      const BERSERK_GUARD_TYPES = ['normal', 'slaughter', 'battlelust', 'delusion', 'fear', 'hatred'];
      const berserkBlocksGuard = () => {
        const berserk = targetActor.system?.conditions?.berserk;
        return !!(berserk?.active && BERSERK_GUARD_TYPES.includes(berserk?.type || ''));
      };

      /**
       * The single definition of the defense calculation, so the live display and the final calculation use one formula.
       * (Simply subtracting the confirmation-time dice from the displayed value would bypass the covering multiplier,
       *  the guard declaration and the armor-penetration clamp, and diverge from the actual rules.)
       */
      const calcDefenseDamage = ({ guard: guardValue, weaponGuard = 0, guardChecked = true,
                                   armor: armorValue, reduce: reduceValue,
                                   covering = 0, reactionSuccess = false,
                                   armorIgnored = false, guardBlocked = false }) => {
        if (reactionSuccess) return 0;
        const effectiveGuard = (guardChecked && !guardBlocked) ? (guardValue + weaponGuard) : 0;
        // Total armor bypass is all-or-nothing and outranks the numeric penetration; the two are
        // different rules ("장갑치를 무시" vs "장갑치를 [LVx8]만큼 무시") and must not stack into a
        // negative. Otherwise the armor value can never go below zero either.
        const effectiveArmor = armorIgnored ? 0 : Math.max(0, armorValue - penetrate);
        if (covering > 0) {
          // Covering: (damage - guard - armor) × (covering count + 1) - reduction
          const intermediateDamage = Math.max(0, damage - effectiveGuard - effectiveArmor);
          return Math.max(0, (intermediateDamage * (covering + 1)) - reduceValue);
        }
        // The ordinary case: damage - guard - armor - reduction
        return Math.max(0, damage - effectiveGuard - effectiveArmor - reduceValue);
      };

      // The counters the defender actually owns for what this attack bypassed.
      const restoreItems = this.getDefenseRestoreItems(targetActor, bypassDefense);
      // Nothing is declared yet, so the opening figure already reflects the full bypass.
      const openingDefense = window.DX3rdItemEffectAdapter.resolveDefense(bypassDefense, {});

      // The actual damage (initial value) — for the ordinary case
      const realDamage = calcDefenseDamage({
        guard, armor, reduce,
        armorIgnored: openingDefense.armorIgnored,
        guardBlocked: openingDefense.guardBlocked
      });
      const attackResultValue = Number(attackResult) || 0;
      const reactionItems = attackResultValue > 0
        ? await this.getDefenseReactionItems(targetActor)
        : [];
      
      const templateData = {
        src: targetActor.img,
        name: targetActor.name,
        damage: damage,
        realDamage: realDamage,
        life: currentHP,
        recovery: false,
        guard: guard,
        guardRollFormula,
        guardCheck: '',
        weaponList: weaponList,
        armor: armor,
        armorRollFormula,
        penetrate: penetrate,
        reduce: reduce,
        reduceRollFormula,
        attackResult: attackResultValue,
        reactionGroups: this.groupDefenseReactionItems(reactionItems),
        bypassSection: this.defenseBypassSectionHtml(bypassDefense, restoreItems),
        // "Declared when you guard" (guard shield, protect armor, …) — the defender's equipment.
        declareSection: window.DX3rdDeclaredEquipment?.sectionHtml(
          window.DX3rdDeclaredEquipment.collect(targetActor, 'defense')) || ''
      };
      
      const dialogContent = await foundry.applications.handlebars.renderTemplate('systems/dx3rd-emanim/templates/dialog/defense-dialog.html', templateData);
      
      const DialogV2 = foundry.applications?.api?.DialogV2;
      if (!DialogV2) {
        ui.notifications.error(game.i18n.localize('DX3rd.DialogV2Unavailable'));
        return;
      }

      // Equipment toggled on is actually used at "confirm". The wiring happens after render, so this
      // only reserves the slot; the confirm callback commits through this reference.
      let declareControl = null;
      let damageRequestSettled = false;
      const cancelDamageRequest = async () => {
        if (damageRequestSettled) return;
        damageRequestSettled = true;
        if (!damageRequestId || !targetTokenId || !itemId) return;
        if (window.DX3rdSocketRouter.isResponsibleGM()) {
          this.discardAfterDamageRequest(damageRequestId, {
            targetActorId: targetActor.id,
            itemId,
            reason: 'cancelled'
          });
        } else {
          window.DX3rdSocketRouter.emit({
            type: 'cancelAfterDamageRequest',
            payload: {
              damageRequestId,
              targetActorId: targetActor.id,
              targetTokenId,
              itemId
            }
          });
        }
      };

      const dialog = new DialogV2({
        window: {
          title: `${game.i18n.localize('DX3rd.DefenseDamage')} (${attackerName})`
        },
        content: dialogContent,
        position: { width: 500 },
        classes: ['dx3rd-emanim', 'defense-dialog'],
        buttons: [
          {
            action: 'confirm',
            icon: '<i class="fas fa-check"></i>',
            label: game.i18n.localize('DX3rd.Confirm'),
            default: true,
            callback: async (event, button) => {
              const form = button.form;
              // The toggled equipment is actually used here. It must finish before the form values are read
              // so guard/armor/reduce bonuses land on this defense (closing never reaches here, so nothing is spent).
              if (declareControl?.hasPending?.()) {
                const applied = await declareControl.commit();
                if (applied.length) await refreshDefenseValuesFromActor();
              }
              const num = (selector) => parseInt(form?.querySelector(selector)?.value) || 0;
              // Roll each deferred dice formula exactly once, at confirmation time.
              const rollDeferred = async (formula, kind) => {
                if (!formula) return null;
                try {
                  return await (new Roll(formula)).evaluate();
                } catch (error) {
                  console.warn(`DX3rd | Deferred defense roll failed (${kind}): ${formula}`, error);
                  return null;
                }
              };
              // Counters are spent here, alongside the equipment declaration, and only the ones whose
              // cost actually clears are honoured — an exhausted counter that the world setting blocks
              // must not silently give the defense back.
              const restore = { armor: false, guard: false, reaction: false };
              for (const check of (form?.querySelectorAll('.dx3rd-bypass-restore-check:checked') || [])) {
                const restoreItem = targetActor.items.get(check.dataset.itemId);
                if (!restoreItem) continue;
                const paid = await window.DX3rdUniversalHandler.processItemUsageCost(targetActor, restoreItem);
                if (paid === false) continue;
                restore[check.dataset.axis] = true;
              }
              const defense = window.DX3rdItemEffectAdapter.resolveDefense(bypassDefense, restore);

              const guardChecked = form?.querySelector('#guard-check')?.checked || false;
              let reactionSuccess = form?.querySelector('#reaction-success')?.checked || false;
              // The chosen weapon's guard dice formula joins the same guard roll.
              const weaponGuard = readCheckedWeaponGuard(form);
              const guardFormula = [guardRollFormula, weaponGuard.formula].filter(Boolean).join(' + ');

              // The bypass gate, resolved here rather than trusted from the render-time lock — the setting
              // can be flipped, or a counter ticked, while the dialog is open, and the lock is drawn once.
              // When the setting allows (the default) the block is dropped from the math and only reported;
              // the report fires on the axes the defender actually used, so an untouched input stays quiet.
              const enforcedDefense = enforceBypass(defense);
              if (!bypassBlocks()) {
                for (const [blockedKey, used, labelKey] of [
                  ['guardBlocked', guardChecked && !reactionSuccess, 'DX3rd.BypassDefenseGuard'],
                  ['reactionBlocked', reactionSuccess, 'DX3rd.BypassDefenseReaction']
                ]) {
                  if (!defense[blockedKey] || !used) continue;
                  await window.DX3rdUniversalHandler?.reportUsageGate?.(
                    targetActor, { name: game.i18n.localize(labelKey) }, 'defenseBypass',
                    game.i18n.localize('DX3rd.BypassGateDetail'));
                }
              } else if (enforcedDefense.reactionBlocked) {
                // Blocking is enforced by the dead input, which was drawn once — close the same hole here.
                reactionSuccess = false;
              }
              // Rolls whose result would go unused are not made at all — rolling leaves a line like
              // "guard roll +9" in chat, making a value that was never subtracted look like it was.
              const [guardRoll, armorRoll, reduceRoll] = reactionSuccess ? [null, null, null] : [
                await rollDeferred((guardChecked && !enforcedDefense.guardBlocked) ? guardFormula : '', 'guard'),
                await rollDeferred(armorRollFormula, 'armor'),
                await rollDeferred(reduceRollFormula, 'reduce')
              ];
              // The rolled values are added to their terms and the defense formula is recomputed (guard declaration / armor penetration / covering multiplier included).
              // Report when a guard was applied during [berserk]. With the setting on "allow" this warns and
              // records only, still subtracting; with "block" the guard is dropped here.
              //
              // Why this check is needed even though the input was disabled above: disabling happens once,
              // right after render, so if the target becomes [berserk] while the dialog is open the input is live.
              // Without rechecking at calculation time the setting would be powerless in that one dialog.
              // With a successful dodge the guard is not used in the calculation, so it is not counted.
              let guardAllowed = guardChecked;
              const guardApplied = num('#guard') + (Number(guardRoll?.total) || 0) + weaponGuard.fixed;
              if (!reactionSuccess && guardChecked && guardApplied > 0 && berserkBlocksGuard()) {
                const detail = `${game.i18n.localize('DX3rd.Berserk')}: ${game.i18n.localize('DX3rd.BerserkGuardBlocked')}`;
                guardAllowed = await window.DX3rdUniversalHandler?.reportUsageGate?.(
                  targetActor, { name: game.i18n.localize('DX3rd.Guard') }, 'berserk', detail) !== false;
              }

              const coveringValue = num('#covering');
              const finalDamage = calcDefenseDamage({
                guard: num('#guard') + (Number(guardRoll?.total) || 0),
                weaponGuard: weaponGuard.fixed,
                guardChecked: guardAllowed,
                armor: num('#armor') + (Number(armorRoll?.total) || 0),
                reduce: num('#reduce') + (Number(reduceRoll?.total) || 0),
                covering: coveringValue,
                reactionSuccess,
                armorIgnored: enforcedDefense.armorIgnored,
                guardBlocked: enforcedDefense.guardBlocked
              });
              const newHP = Math.max(0, currentHP - finalDamage);
              const hpChange = currentHP - newHP; // the HP actually lost

              await targetActor.update({
                'system.attributes.hp.value': newHP
              });

              let chatMessage = `HP-${hpChange}`;

              if (coveringValue > 0) {
                chatMessage += ` (${game.i18n.localize('DX3rd.Covering')}: ${coveringValue})`;
              }

              // Emit the chat message (the speaker is the target actor)
              const rollDetail = async (roll, formula, labelKey) => roll
                ? `<div class="dx3rd-roll-detail"><div>${game.i18n.localize(labelKey)}: ${formula} → +${roll.total}</div>${await roll.render()}</div>`
                : '';
              const defenseRollContent = (await rollDetail(guardRoll, guardFormula, 'DX3rd.GuardRoll'))
                + (await rollDetail(armorRoll, armorRollFormula, 'DX3rd.ArmorRoll'))
                + (await rollDetail(reduceRoll, reduceRollFormula, 'DX3rd.ReduceRoll'));
              await ChatMessage.create({
                speaker: ChatMessage.getSpeaker({ actor: targetActor }),
                content: `<div class="dx3rd-item-chat"><div>${chatMessage}</div>${defenseRollContent}</div>`,
                style: CONST.CHAT_MESSAGE_STYLES.OTHER
              });
              
              // Run the guard disable hook only when a guard actually entered the defense. A successful
              // dodge never guarded, and a bypassed guard contributes nothing (its roll is not even made),
              // so neither should expire "until guard" lifetimes — a guard shield's buff must survive a dodge.
              if (!reactionSuccess && guardAllowed && !enforcedDefense.guardBlocked
                  && window.DX3rdDisableHooks) {
                await window.DX3rdDisableHooks.executeDisableHook('guard', targetActor);
              }
              
              // ===== The afterDamage extension queue =====
              if (attackerId && itemId) {
                const extensionQueueKey = damageRequestId;
                const extensionRequest = window.DX3rdAfterDamageExtensionQueue?.[extensionQueueKey];
                
                if (extensionRequest) {
                  const report = window.DX3rdRuntimeUtils.recordAfterDamageReport(extensionRequest, {
                    targetTokenId,
                    targetActorId: targetActor.id,
                    hpChange,
                    attackHit: !reactionSuccess
                  });

                  window.DX3rdDebug.log('DX3rd | Extension damage report recorded:', {
                    target: targetActor.name,
                    hpChange: hpChange,
                    reportCount: report.reportCount,
                    totalTargets: report.targetCount
                  });
                  
                  // Have every target reported?
                  if (report.accepted && report.complete && !extensionRequest.processing) {
                    extensionRequest.processing = true;
                    window.DX3rdDebug.log('DX3rd | All targets reported for extensions, processing...');
                    
                    try {
                      await window.DX3rdUniversalHandler.processAfterDamageExtensionRequest(extensionRequest);
                    } catch (error) {
                      console.error('DX3rd | AfterDamage extension request failed:', error);
                    } finally {
                      // A partially applied extension request is not safe to retry automatically.
                      delete window.DX3rdAfterDamageExtensionQueue[extensionQueueKey];
                      this.releaseAfterDamageRequestExpiry(extensionQueueKey);
                    }
                    window.DX3rdDebug.log('DX3rd | Extension request removed from queue');
                  }
                }
              }
              
              // ===== The original afterDamage path (when there is no queueIndex) =====
              window.DX3rdDebug.log('DX3rd | Checking afterDamage conditions:', {
                hpChange: hpChange,
                attackerId: attackerId,
                itemId: itemId,
                hasAttackerAndItem: !!(attackerId && itemId)
              });
              
              if (attackerId && itemId) {
                window.DX3rdDebug.log('DX3rd | Reporting damage result to GM, hpChange:', hpChange);
                window.DX3rdDebug.log('DX3rd | Current user isGM:', game.user.isGM);
                
                if (window.DX3rdSocketRouter.isResponsibleGM()) {
                  // Only the GM that owns the queue processes reports locally. Other GMs report
                  // through the same socket path as players.

                  // Activation / macro handling (check the activation queue and collect reports)
                  const activationQueueKey = damageRequestId;
                  const activationRequest = window.DX3rdAfterDamageActivationQueue?.[activationQueueKey];
                  if (activationRequest) {
                    const report = window.DX3rdRuntimeUtils.recordAfterDamageReport(activationRequest, {
                      targetTokenId,
                      targetActorId: targetActor.id,
                      hpChange,
                      attackHit: !reactionSuccess
                    });

                    window.DX3rdDebug.log('DX3rd | Activation report recorded:', {
                      target: targetActor.name,
                      hpChange: hpChange,
                      reportCount: report.reportCount,
                      totalTargets: report.targetCount
                    });
                    
                    // Have every target reported?
                    if (report.accepted && report.complete && !activationRequest.processing) {
                      activationRequest.processing = true;
                      window.DX3rdDebug.log('DX3rd | All targets reported, processing activation...');
                      try {
                      // The targets that took HP damage
                      const damagedReports = Object.entries(activationRequest.damageReports)
                        .filter(([, hp]) => hp > 0);
                      const damagedTokenIds = damagedReports.map(([tokenId]) => tokenId);
                      const damagedTargets = [...new Set(damagedReports
                        .map(([tokenId]) => activationRequest.reportActorIds[tokenId])
                        .filter(Boolean))];
                      const hitTokenIds = Object.entries(activationRequest.hitReports || {})
                        .filter(([, hit]) => hit === true)
                        .map(([tokenId]) => tokenId);
                      const hitTargets = [...new Set(hitTokenIds
                        .map(tokenId => activationRequest.reportActorIds[tokenId])
                        .filter(Boolean))];
                      
                      const attacker = game.actors.get(attackerId);
                      if (!attacker) {
                        console.warn('DX3rd | Attacker not found:', attackerId);
                        return;
                      }
                      
                      // Combo afterDamage handling (after the HP damage happened).
                      // A temporary combo is not an Item document embedded in the actor. So looking itemId up
                      // in attacker.items first and returning would make an attack built in the combo builder
                      // lose every member effect's poison / heal / after-damage work.
                      // comboAfterDamageData already carries the member data needed to run, so it is handled
                      // first, independently of the original combo document.
                      // damagedTargets is an array of Actor IDs, so convert to Actor objects.
                      // Built once here — both the combo afterDamage work and the preparation
                      // riders' damage-triggered buckets resolve against the same list.
                      const damagedActors = damagedTokenIds.map(tokenId => canvas.tokens.get(tokenId)?.actor)
                        .filter(Boolean);
                      for (const actorId of damagedTargets) {
                        const damagedActor = game.actors.get(actorId);
                        if (damagedActor && !damagedActors.some(candidate => candidate.id === damagedActor.id)) {
                          damagedActors.push(damagedActor);
                        }
                      }

                      const comboData = activationRequest.comboAfterDamageData;
                      if (comboData && damagedTargets.length > 0) {
                        window.DX3rdDebug.log('DX3rd | Processing combo afterDamage (HP damage occurred)');
                        await window.DX3rdUniversalHandler.processComboAfterDamage(comboData, damagedActors, damagedTokenIds);
                      } else if (comboData) {
                        await window.DX3rdInstantComboRetention?.complete?.(attacker, itemId, 'afterDamage');
                      }

                      if (hitTargets.length > 0) {
                        await window.DX3rdUniversalHandler.processPendingAttackRiders(
                          attacker,
                          activationRequest.pendingAttackRiders,
                          hitTargets,
                          hitTokenIds
                        );
                        // Combo 'afterHit' buckets fire on attackHit — including a hit reduced
                        // to 0 HP damage — independently of the damaged-target work above.
                        if (comboData && (comboData.hitApplies || []).length > 0) {
                          await window.DX3rdUniversalHandler.processComboAfterHit(
                            comboData, hitTargets, hitTokenIds);
                        }
                      }
                      if (damagedTargets.length > 0) {
                        await window.DX3rdUniversalHandler.processDamagedAttackRiders(
                          attacker, activationRequest.pendingAttackRiders, damagedActors);
                      }

                      const attackerItem = attacker.items.get(itemId);
                      const needsAttackerItem = activationRequest.shouldExecuteMacro
                        || activationRequest.shouldActivate
                        || activationRequest.shouldApplyToTargets;
                      if (!attackerItem && needsAttackerItem) {
                        // Follow-up work based on a stored item cannot run without the original document.
                        // Leaving the queue entry would block the next request under the same key, so it is always cleaned up.
                        console.warn('DX3rd | Attacker item not found:', itemId);
                        return;
                      }
                      if (!attackerItem) {
                        // A temporary combo is complete once the comboData handling above has run.
                        // The no-HP-damage notification stays the same as for a stored combo.
                        if (damagedTargets.length === 0) {
                          const attackerOwners = game.users.filter(user =>
                            !user.isGM &&
                            user.active &&
                            attacker.testUserPermission(user, "OWNER")
                          );
                          if (attackerOwners.length === 0) {
                            await window.DX3rdUniversalAlertDialogV2({
                              title: game.i18n.localize('DX3rd.NoDamage'),
                              content: `<p>${game.i18n.localize('DX3rd.NoDamageText')}</p>`
                            });
                          } else {
                            window.DX3rdSocketRouter.emitToActorExecutor({
                              type: 'showNoDamageNotification',
                              payload: { attackerId: attackerId }
                            }, attacker);
                          }
                        }
                        window.DX3rdDebug.log('DX3rd | Temporary combo afterDamage request removed from queue');
                        return;
                      }
                      
                      // 1. Run the macros (if at least one target took HP damage)
                      if (activationRequest.shouldExecuteMacro && damagedTargets.length > 0) {
                        if (attacker.isOwner) {
                          // The GM owns the attacker, so run it directly
                          await window.DX3rdUniversalHandler.executeMacros(attackerItem, 'afterDamage');
                          window.DX3rdDebug.log('DX3rd | AfterDamage macro executed directly by GM');
                        } else {
                          // Tell the attacker's owner to run it
                          window.DX3rdSocketRouter.emitToActorExecutor({
                            type: 'executeAfterDamageMacro',
                            payload: {
                              attackerId: attackerId,
                              itemId: itemId,
                              hpChange: damagedTargets.length  // pass the number of damaged targets
                            }
                          }, attacker);
                          window.DX3rdDebug.log('DX3rd | AfterDamage macro sent via socket');
                        }
                      }
                      
                      // 2. Activation / effect application. The use count was already checked and spent when
                      // the original action was approved, so the current state is not used as a gate in this follow-up step.
                      const currentItem = attacker.items.get(itemId);  // fetch the latest state again
                      const usedDisable = currentItem?.system?.used?.disable || 'notCheck';
                      
                      // Look for connected non-GM users who own the attacker
                      const attackerOwners = game.users.filter(user => 
                        !user.isGM && 
                        user.active && 
                        attacker.testUserPermission(user, "OWNER")
                      );
                      const hasActiveNonGMOwner = attackerOwners.length > 0;
                      
                      if (damagedTargets.length === 0) {
                        // Nobody took damage: the NoDamage notification
                        if (!hasActiveNonGMOwner) {
                          // No connected non-GM owner: the GM shows it directly
                          await window.DX3rdUniversalAlertDialogV2({
                            title: game.i18n.localize('DX3rd.NoDamage'),
                            content: `<p>${game.i18n.localize('DX3rd.NoDamageText')}</p>`
                          });
                          window.DX3rdDebug.log('DX3rd | No damage notification shown directly by GM');
                        } else {
                          // Send it to the attacker's owner over the socket
                          window.DX3rdSocketRouter.emitToActorExecutor({
                            type: 'showNoDamageNotification',
                            payload: { attackerId: attackerId }
                          }, attacker);
                          window.DX3rdDebug.log('DX3rd | No damage notification sent via socket to player');
                        }
                      } else if (activationRequest.shouldActivate || activationRequest.shouldApplyToTargets) {
                        const needsConfirmation = activationRequest.needsDialog && usedDisable !== 'notCheck';
                        // The attack item's own afterDamage bucket rides the request as a snapshot
                        // frozen at use time — prefer it over re-evaluating on the executor, where
                        // _dx3rdRuntimeInput / _dx3rdUsageEncLevel no longer exist.
                        const attackItemRider = (activationRequest.pendingAttackRiders || [])
                          .find(rider => rider?.fromAttackItem === true && rider.itemId === itemId);
                        const frozenTargetAttributes = attackItemRider?.targetAttributes || null;

                        if (needsConfirmation) {
                          // Weapon / vehicle with a use limit: show a dialog
                          if (!hasActiveNonGMOwner) {
                            // No connected non-GM owner: the GM shows it directly
                            await window.DX3rdUniversalHandler._showAfterDamageDialog(attacker, currentItem, damagedTargets, activationRequest.shouldActivate, activationRequest.shouldApplyToTargets, frozenTargetAttributes);
                            window.DX3rdDebug.log('DX3rd | AfterDamage dialog shown directly by GM');
                          } else {
                            // Send it to the attacker's owner over the socket
                            window.DX3rdSocketRouter.emitToActorExecutor({
                              type: 'showAfterDamageDialog',
                              payload: {
                                attackerId: attackerId,
                                itemId: itemId,
                                damagedTargets: damagedTargets,
                                shouldActivate: activationRequest.shouldActivate,
                                shouldApplyToTargets: activationRequest.shouldApplyToTargets,
                                frozenTargetAttributes
                              }
                            }, attacker);
                            window.DX3rdDebug.log('DX3rd | AfterDamage dialog sent via socket to player');
                          }
                        } else {
                          // Everything else (weapon / vehicle notCheck included): activate automatically
                          if (!hasActiveNonGMOwner) {
                            // No connected non-GM owner: the GM runs it directly
                            await window.DX3rdUniversalHandler._executeAfterDamageActivation(attacker, currentItem, damagedTargets, activationRequest.shouldActivate, activationRequest.shouldApplyToTargets, frozenTargetAttributes);
                            window.DX3rdDebug.log('DX3rd | AfterDamage auto-activation executed directly by GM');
                          } else {
                            // Send it to the attacker's owner over the socket
                            window.DX3rdSocketRouter.emitToActorExecutor({
                              type: 'executeAfterDamageActivation',
                              payload: {
                                actorId: attackerId,
                                itemId: itemId,
                                damagedTargets: damagedTargets,
                                shouldActivate: activationRequest.shouldActivate,
                                shouldApplyToTargets: activationRequest.shouldApplyToTargets,
                                frozenTargetAttributes
                              }
                            }, attacker);
                            window.DX3rdDebug.log('DX3rd | AfterDamage auto-activation sent via socket to player');
                          }
                        }
                      }
                      
                      } finally {
                        // A partially applied activation request is not safe to retry automatically.
                        delete window.DX3rdAfterDamageActivationQueue[activationQueueKey];
                        this.releaseAfterDamageRequestExpiry(activationQueueKey);
                        window.DX3rdDebug.log('DX3rd | Activation request removed from queue');
                      }
                    }
                  }
                  // A defense report can land on this queue owner before the attacker's
                  // registration arrives (the two travel on different senders' sockets). Keep it
                  // for the registration drain; a report whose request never registers ages out.
                  if (!window.DX3rdAfterDamageExtensionQueue?.[damageRequestId]
                      || !window.DX3rdAfterDamageActivationQueue?.[damageRequestId]) {
                    window.DX3rdRuntimeUtils?.bufferEarlyDamageReport?.({
                      attackerId, itemId, damageRequestId,
                      targetActorId: targetActor.id, targetTokenId, hpChange,
                      attackHit: !reactionSuccess
                    });
                  }
                } else {
                  // An ordinary user reports the damage result to the GM
                  window.DX3rdSocketRouter.emit({
                    type: 'reportDamageForActivation',
                    payload: {
                      attackerId: attackerId,
                      itemId: itemId,
                      damageRequestId,
                      targetActorId: targetActor.id,
                      targetTokenId,
                      hpChange: hpChange,
                      attackHit: !reactionSuccess
                    }
                  });
                  window.DX3rdDebug.log('DX3rd | Damage result report sent to GM (activation):', {
                    target: targetActor.name,
                    hpChange: hpChange
                  });
                }
              }

              // Only suppress close/cancel cleanup after every local or socket report has completed.
              damageRequestSettled = true;
              ui.notifications.info(`${targetActor.name}: HP ${currentHP} → ${newHP} (-${finalDamage})`);
            }
          },
          {
            action: 'cancel',
            icon: '<i class="fas fa-times"></i>',
            label: game.i18n.localize('DX3rd.Cancel'),
            callback: cancelDamageRequest
          }
        ],
        close: cancelDamageRequest
      });

      await dialog.render(true);
      const root = dialog.element;
      if (!root) return;

      // Guarding is forbidden during [berserk]. That is the same rule as the reaction limit, so it uses
      // the **same gate** (`allowBerserkViolation`) — no table allows reactions but forbids only the guard.
      // With the setting on "do not block" (the default) the inputs stay live, and when a guard actually
      // gets applied only a warning and a chat record are left (the same wording as the roll dialog and handler paths).
      if (berserkBlocksGuard() && window.DX3rdUsageGates?.allows?.('berserk') === false) {
        // Disable the guard input and set it to 0
        const guardInput = root.querySelector('#guard');
        if (guardInput) {
          guardInput.disabled = true;
          guardInput.value = 0;
        }

        // Disable and clear the guard checkbox
        const guardCheckbox = root.querySelector('#guard-check');
        if (guardCheckbox) {
          guardCheckbox.disabled = true;
          guardCheckbox.checked = false;
        }

        // Lock the weapon-guard picker itself (and clear any chosen weapon)
        const weaponSelectEl = root.querySelector('#weapon-guard-select');
        if (weaponSelectEl) { weaponSelectEl.disabled = true; weaponSelectEl.value = ''; }
        const weaponAddEl = root.querySelector('#weapon-guard-add');
        if (weaponAddEl) weaponAddEl.disabled = true;
        const chosenEl = root.querySelector('#weapon-guard-chosen');
        if (chosenEl) chosenEl.replaceChildren();

        // Set the total guard to 0
        const totalGuard = root.querySelector('#total-guard');
        if (totalGuard) totalGuard.textContent = '0';

        window.DX3rdDebug.log(`DX3rd | Defense dialog - Guard/Weapon disabled due to berserk type: ${berserkType}`);
      }

      const getNumberValue = (selector) => parseInt(root.querySelector(selector)?.value) || 0;
      // Re-read the deferred dice formulas from the actor so the variables and the display stay in sync (for effects used mid-defense).
      const refreshDeferredFormulas = () => {
        guardRollFormula = deferredDefenseFormula('guard');
        armorRollFormula = deferredDefenseFormula('armor');
        reduceRollFormula = deferredDefenseFormula('reduce');
        const setPreview = (selector, formula) => {
          const el = root.querySelector(selector);
          if (el) el.textContent = formula ? `+ ${formula}` : '';
        };
        setPreview('#guard-formula-preview', guardRollFormula);
        setPreview('#armor-formula-preview', armorRollFormula);
        setPreview('#reduce-formula-preview', reduceRollFormula);
      };
      const getReactionSuccess = () => root.querySelector('#reaction-success')?.checked || false;
      const updateReactionStatus = (success) => {
        const status = root.querySelector('#reaction-status');
        if (status) {
          status.textContent = success
            ? game.i18n.localize('DX3rd.DefenseDodged')
            : game.i18n.localize('DX3rd.DefenseHit');
        }
      };
      const setReactionResult = (result) => {
        const value = Number(result) || 0;
        const input = root.querySelector('#reaction-result');
        if (input) input.value = value > 0 ? String(value) : '';

        const success = attackResultValue > 0 && value >= attackResultValue;
        const checkbox = root.querySelector('#reaction-success');
        if (checkbox) checkbox.checked = success;

        updateReactionStatus(success);

        updateDamage();
      };
      // An effect used mid-defense (a reaction effect, a temporary combo, declaration equipment) may have changed guard/armor/reduce.
      // Re-read the actor to sync the inputs and the deferred formulas.
      //
      // It adds **the delta only**, never overwriting. The delta is exactly what the effect granted, and an
      // overwrite would silently erase a value the player typed by hand (an arbitrary armor for a covering situation).
      // The watcher hooks below call this on every actor update, so that risk is real.
      let lastKnownDefense = { guard, armor, reduce };
      const refreshDefenseValuesFromActor = async () => {
        const current = {
          // **`base`, not `value`.** This dialog's guard input starts from base (the `const guard` above)
          // and the equipped weapon's share is added separately by the weapon picker below. `value` is
          // base + the equipped weapon's share, so reading it here would fold that whole share into the
          // first delta and count it twice. What is seeded and what is read must be the same quantity.
          guard: targetActor.system.attributes.guard?.base
            ?? targetActor.system.attributes.guard?.value ?? 0,
          armor: targetActor.system.attributes.armor?.value || 0,
          reduce: targetActor.system.attributes.reduce?.value || 0
        };
        for (const key of ['guard', 'armor', 'reduce']) {
          const delta = current[key] - lastKnownDefense[key];
          if (!delta) continue;
          const input = root.querySelector(`#${key}`);
          if (input) input.value = String((parseInt(input.value) || 0) + delta);
        }
        lastKnownDefense = current;
        refreshDeferredFormulas();
        updateDamage();
      };

      // Many people use a reaction effect that raises a defense value (Dragon Scale's armor +[LV×10], say)
      // straight from the character sheet rather than this dialog's dropdown. Refreshing only on the dropdown
      // path would look to them like "I used the effect and the armor did not move" — so while the dialog is
      // open it simply follows the actor. Being delta-based, unrelated updates (an HP change) are harmless.
      const defenseWatchers = [];
      const unwatchDefense = () => {
        for (const [hook, id] of defenseWatchers) Hooks.off(hook, id);
        defenseWatchers.length = 0;
      };
      const watchDefenseSource = doc => {
        // Hooks left over after the dialog closed clean themselves up (so a missed close hook cannot leak).
        if (!dialog.rendered) return unwatchDefense();
        const owner = doc?.documentName === 'Actor' ? doc : doc?.parent;
        if (owner?.id === targetActor.id) refreshDefenseValuesFromActor();
      };
      for (const hook of ['updateActor', 'updateItem',
        'createActiveEffect', 'updateActiveEffect', 'deleteActiveEffect']) {
        defenseWatchers.push([hook, Hooks.on(hook, watchDefenseSource)]);
      }
      defenseWatchers.push(['closeDialogV2',
        Hooks.on('closeDialogV2', app => { if (app === dialog) unwatchDefense(); })]);
      const updateWeaponGuard = () => {
        const {fixed, formula} = readCheckedWeaponGuard(root);
        const totalGuard = root.querySelector('#total-guard');
        if (totalGuard) totalGuard.textContent = formula ? `${fixed} + ${formula}` : String(fixed);
        return fixed;
      };

      /**
       * How the bypass currently stands, from the counter checkboxes alone. Nothing is spent here —
       * the confirm handler re-resolves after paying, and only counters that actually paid count there.
       */
      const previewDefense = () => {
        const restore = { armor: false, guard: false, reaction: false };
        for (const check of root.querySelectorAll('.dx3rd-bypass-restore-check:checked')) {
          restore[check.dataset.axis] = true;
        }
        return window.DX3rdItemEffectAdapter.resolveDefense(bypassDefense, restore);
      };

      /** Does the bypass actually block, or only warn? The world setting decides (default: warn only). */
      const bypassBlocks = () => window.DX3rdUsageGates?.allows?.('defenseBypass') === false;

      /**
       * The resolution as the math should see it. `resolveDefense` stays the pure rules answer —
       * the gate is applied here, at the one boundary where a block turns into a subtraction, so the
       * display and the confirmation cannot disagree about whether a bypass was enforced.
       *
       * Only the two axes the defender **declares** are softened. Armor is not declared — it is just
       * the number already on the sheet — so letting it through would not hand a choice back, it would
       * silently cancel "장갑치를 무시한다" on every hit and leave a chat line each time. Its input still
       * gets the tooltip, so the defender can see why the number is not being subtracted.
       */
      const enforceBypass = (defense) => bypassBlocks()
        ? defense
        : { ...defense, guardBlocked: false, reactionBlocked: false };

      // Live damage recalculation
      const updateDamage = () => {
        // The deferred dice formulas (guard/armor/reduce) are not rolled here — they are rolled once at the
        // confirm button and go through the same calcDefenseDamage. So the display is based on the fixed parts.
        const calculatedDamage = calcDefenseDamage({
          guard: getNumberValue('#guard'),
          weaponGuard: updateWeaponGuard(),
          guardChecked: root.querySelector('#guard-check')?.checked || false,
          armor: getNumberValue('#armor'),
          reduce: getNumberValue('#reduce'),
          covering: getNumberValue('#covering'),
          reactionSuccess: getReactionSuccess(),
          ...enforceBypass(previewDefense())
        });

        const realDamageElement = root.querySelector('#realDamage');
        if (realDamageElement) realDamageElement.textContent = String(calculatedDamage);
        const lifeElement = root.querySelector('#life');
        if (lifeElement) lifeElement.textContent = String(Math.max(0, currentHP - calculatedDamage));
      };

      // What each input looked like before the bypass touched it. Restoring blindly is not enough:
      // the weapon-guard picker is already disabled by the template when the actor owns no weapon, and
      // its "+" button carries a tooltip of its own — clearing either on the way back out would hand
      // the defender a picker with nothing in it, or silently drop an unrelated label.
      const lockBaseline = new Map();
      const baselineOf = (selector, el) => {
        if (!lockBaseline.has(selector)) {
          lockBaseline.set(selector, { disabled: el.disabled === true, title: el.getAttribute('title') });
        }
        return lockBaseline.get(selector);
      };
      // The bypass locks the inputs it removes, and unlocks them again the moment a counter is ticked.
      // Whether that lock is real is the gate's call (`allowDefenseBypassViolation`, default allow):
      // allowed means a **soft** lock — greyed with a tooltip saying the attack cannot be guarded, but
      // still live, and using it leaves the same warning + chat record as any other allowed violation.
      const syncBypassLocks = () => {
        // Armor is enforced whatever the setting says (see enforceBypass), so its lock is never soft.
        const soft = !bypassBlocks();
        const { guardBlocked, reactionBlocked, armorIgnored } = previewDefense();
        for (const [selector, blocked, tip, softenable] of [
          ['#guard', guardBlocked, 'DX3rd.BypassLockGuard', true],
          ['#guard-check', guardBlocked, 'DX3rd.BypassLockGuard', true],
          ['#weapon-guard-select', guardBlocked, 'DX3rd.BypassLockGuard', true],
          ['#weapon-guard-add', guardBlocked, 'DX3rd.BypassLockGuard', true],
          ['#armor', armorIgnored, 'DX3rd.BypassLockArmor', false],
          ['#reaction-item-use', reactionBlocked, 'DX3rd.BypassLockReaction', true],
          ['#reaction-result', reactionBlocked, 'DX3rd.BypassLockReaction', true],
          ['#reaction-success', reactionBlocked, 'DX3rd.BypassLockReaction', true]
        ]) {
          const el = root.querySelector(selector);
          if (!el) continue;
          const base = baselineOf(selector, el);
          const lenient = soft && softenable;
          el.disabled = base.disabled || (blocked && !lenient);
          el.classList.toggle('dx3rd-soft-locked', blocked && lenient);
          if (!blocked) {
            if (base.title === null) el.removeAttribute('title');
            else el.setAttribute('title', base.title);
          } else {
            el.title = [game.i18n.localize(tip), lenient ? game.i18n.localize('DX3rd.BypassLockOverride') : '']
              .filter(Boolean).join('\n');
          }
          // A hard-blocked reaction must not stay ticked from a previous state, or a dead checkbox would
          // still zero the damage. Under the soft lock the tick is the defender's deliberate override.
          if (blocked && !lenient && el.type === 'checkbox') el.checked = false;
        }
      };
      for (const check of root.querySelectorAll('.dx3rd-bypass-restore-check')) {
        check.addEventListener('change', () => { syncBypassLocks(); updateDamage(); });
      }
      syncBypassLocks();

      // Declaration equipment: only toggled here, actually used at "confirm". Once used it attaches a self-modifier AE,
      // so guard/armor/reduce are re-read from the actor exactly as when a reaction effect fires
      // (no separate refresh path is introduced).
      declareControl = window.DX3rdDeclaredEquipment?.bind(root, targetActor) || null;

      // Initial damage calculation (the guard may have been changed by berserk)
      updateDamage();

      // The weapons used to guard are picked from a dropdown and stacked as chips. The hidden checkbox inside
      // a chip follows the existing summation rule, so readCheckedWeaponGuard stays the one place guard is read.
      const weaponSelect = root.querySelector('#weapon-guard-select');
      const chosenWeapons = root.querySelector('#weapon-guard-chosen');
      const addChosenWeapon = () => {
        const option = weaponSelect?.selectedOptions?.[0];
        if (!option?.value || !chosenWeapons) return;
        // Do not count the same weapon twice. The dropdown is cleared even when an already-added weapon is
        // picked again — leaving it looks like the button did nothing, so you cannot tell whether it was added.
        if (chosenWeapons.querySelector(`[data-item-id="${CSS.escape(option.value)}"]`)) {
          weaponSelect.value = '';
          return;
        }

        const chip = document.createElement('span');
        chip.className = 'dx3rd-weapon-guard-chip';
        chip.dataset.itemId = option.value;

        const hidden = document.createElement('input');
        hidden.type = 'checkbox';
        hidden.className = 'weapon-checkbox';
        hidden.checked = true;
        hidden.hidden = true;
        hidden.dataset.guard = option.dataset.guard || '0';
        if (option.dataset.guardFormula) hidden.dataset.guardFormula = option.dataset.guardFormula;
        hidden.dataset.name = option.dataset.name || '';

        const label = document.createElement('span');
        label.className = 'dx3rd-weapon-guard-name';
        label.textContent = option.textContent.trim();

        const remove = document.createElement('button');
        remove.type = 'button';
        remove.className = 'dx3rd-weapon-guard-remove';
        remove.title = game.i18n.localize('DX3rd.RemoveGuardWeapon');
        remove.innerHTML = '<i class="fas fa-times"></i>';

        chip.append(hidden, label, remove);
        chosenWeapons.appendChild(chip);
        weaponSelect.value = '';
        updateDamage();
      };
      root.querySelector('#weapon-guard-add')?.addEventListener('click', event => {
        event.preventDefault();
        addChosenWeapon();
      });
      chosenWeapons?.addEventListener('click', event => {
        const button = event.target.closest('.dx3rd-weapon-guard-remove');
        if (!button) return;
        event.preventDefault();
        button.closest('.dx3rd-weapon-guard-chip')?.remove();
        updateDamage();
      });

      // The reset button
      root.querySelector('#reset')?.addEventListener('click', (event) => {
        event.preventDefault();
        chosenWeapons?.replaceChildren();
        if (weaponSelect) weaponSelect.value = '';
        const totalGuard = root.querySelector('#total-guard');
        if (totalGuard) totalGuard.textContent = '0';
        // Only what was touched in this dialog (typed values, weapon checks) is reverted. Erasing the modifiers
        // of an effect actually used while the dialog was open would lose an effect already paid for with encroachment.
        const guardInput = root.querySelector('#guard');
        if (guardInput) guardInput.value = lastKnownDefense.guard;
        const guardCheckbox = root.querySelector('#guard-check');
        if (guardCheckbox) guardCheckbox.checked = false;
        const armorInput = root.querySelector('#armor');
        if (armorInput) armorInput.value = lastKnownDefense.armor;
        const reduceInput = root.querySelector('#reduce');
        if (reduceInput) reduceInput.value = lastKnownDefense.reduce;
        const coveringInput = root.querySelector('#covering');
        if (coveringInput) coveringInput.value = '0';
        const reactionInput = root.querySelector('#reaction-result');
        if (reactionInput) reactionInput.value = '';
        const reactionCheckbox = root.querySelector('#reaction-success');
        if (reactionCheckbox) reactionCheckbox.checked = false;
        updateReactionStatus(false);
        updateDamage();
      });

      // Recalculate the damage when an input changes
      ['#guard', '#armor', '#reduce', '#covering'].forEach(selector => {
        root.querySelector(selector)?.addEventListener('input', updateDamage);
      });
      root.querySelector('#guard-check')?.addEventListener('change', updateDamage);
      root.querySelector('#reaction-success')?.addEventListener('change', event => {
        updateReactionStatus(event.target.checked);
        updateDamage();
      });
      root.querySelector('#reaction-result')?.addEventListener('input', event => {
        setReactionResult(event.target.value);
      });

      root.querySelector('#basic-dodge-roll')?.addEventListener('click', async (event) => {
        event.preventDefault();
        const { stat, label } = this._getDefaultDodgeRollData(targetActor);
        if (!stat) {
          ui.notifications.warn(game.i18n.localize('DX3rd.AbilityDataNotFound'));
          return;
        }

        await this.showStatRollDialog(
          targetActor,
          stat,
          label,
          'dodge',
          null,
          null,
          null,
          null,
          null,
          attackResultValue > 0 ? { type: 'number', value: attackResultValue } : null,
          false,
          false,
          ({ total }) => setReactionResult(total)
        );
      });

      // Fire a registered reaction effect / combo as-is.
      const useRegisteredReaction = async (itemId) => {
        const item = targetActor.items.get(itemId);
        if (!item) {
          ui.notifications.warn(game.i18n.localize('DX3rd.ItemNotFound'));
          return;
        }

        const success = await this.handleItemUse(
          targetActor.id,
          itemId,
          item.type,
          null,
          // Let the shared gate derive the requirement from both the item and every combo member.
          // Passing the combo's stored false here suppresses a member's target requirement.
          undefined,
          {
            rollType: 'dodge',
            predefinedDifficulty: attackResultValue > 0 ? { type: 'number', value: attackResultValue } : null,
            afterRollCallback: ({ total }) => setReactionResult(total)
          }
        );

        // An effect used mid-defense may have added a dice-formula modifier. Beyond the fixed parts, the
        // deferred formulas rolled at confirmation must be re-read for that effect to actually count.
        // The same holds for effects that come with a check (those that roll a guard too), so this does not
        // branch on roll — branching would drop the modifier on that side. Overlapping with the watcher hooks is harmless (delta 0).
        if (success) await refreshDefenseValuesFromActor();
      };

      // When the registered reaction effects / combos are not enough, a temporary combo is built right here.
      // Its check comes back to the reaction-result field through afterRollCallback, and a guard-type effect
      // with no check is reflected by afterUseCallback re-reading guard/armor/reduce.
      const useInstantReactionCombo = async () => {
        if (!targetActor.isOwner && !game.user.isGM) {
          ui.notifications.warn(game.i18n.localize('DX3rd.NoPermission'));
          return;
        }
        // An actor with no evade skill (an enemy, say) is seeded with an attribute check.
        const dodgeSkill = targetActor.system?.attributes?.skills?.evade ? 'evade' : 'body';
        await this.openComboBuilder(targetActor, 'skill', dodgeSkill, null, {
          rollType: 'dodge',
          getTarget: false,
          predefinedDifficulty: attackResultValue > 0 ? { type: 'number', value: attackResultValue } : null,
          afterRollCallback: ({ total }) => setReactionResult(total),
          afterUseCallback: () => refreshDefenseValuesFromActor()
        });
      };

      const reactionUseButton = root.querySelector('#reaction-item-use');
      reactionUseButton?.addEventListener('click', async (event) => {
        event.preventDefault();
        const select = root.querySelector('#reaction-item-select');
        const selected = select?.value || '';
        if (!selected) {
          ui.notifications.warn(game.i18n.localize('DX3rd.SelectReactionItem'));
          return;
        }

        // Lock the button until the use finishes, so a double click cannot fire it twice.
        reactionUseButton.disabled = true;
        try {
          if (selected === '__instant-combo__') await useInstantReactionCombo();
          else await useRegisteredReaction(selected);
        } finally {
          reactionUseButton.disabled = false;
          if (select) select.value = '';
        }
      });
    },

    /**
     * Show the afterDamage dialog (internal helper)
     */
    async _showAfterDamageDialog(actor, item, damagedTargets, shouldActivate, shouldApplyToTargets, frozenTargetAttributes = null) {
      // Build a custom DOM dialog
      const dialogDiv = document.createElement("div");
      dialogDiv.className = "after-damage-dialog";
      dialogDiv.style.position = "fixed";
      dialogDiv.style.top = "50%";
      dialogDiv.style.left = "50%";
      dialogDiv.style.transform = "translate(-50%, -50%)";
      dialogDiv.style.background = "rgba(0, 0, 0, 0.85)";
      dialogDiv.style.color = "white";
      dialogDiv.style.padding = "20px";
      dialogDiv.style.border = "none";
      dialogDiv.style.borderRadius = "8px";
      dialogDiv.style.zIndex = "9999";
      dialogDiv.style.textAlign = "center";
      dialogDiv.style.fontSize = "16px";
      dialogDiv.style.boxShadow = "0 0 10px black";
      dialogDiv.style.minWidth = "280px";
      dialogDiv.style.cursor = "move";
      
      // The title
      const title = document.createElement("div");
      title.textContent = `${item.name}`;
      title.style.marginBottom = "16px";
      title.style.fontSize = "1em";
      title.style.fontWeight = "bold";
      title.style.cursor = "move";
      dialogDiv.appendChild(title);
      
      // The button container
      const buttonContainer = document.createElement("div");
      buttonContainer.style.display = "flex";
      buttonContainer.style.flexDirection = "column";
      buttonContainer.style.gap = "8px";
      
      // The "use the equipment effect" button
      const useBtn = document.createElement("button");
      const equipText = game.i18n.localize('DX3rd.Equipment');
      const appliedText = game.i18n.localize('DX3rd.Applied');
      const useText = game.i18n.localize('DX3rd.Use');
      useBtn.textContent = `${equipText} ${appliedText} ${useText}`;
      useBtn.style.width = "100%";
      useBtn.style.height = "32px";
      useBtn.style.background = "white";
      useBtn.style.color = "black";
      useBtn.style.borderRadius = "4px";
      useBtn.style.border = "none";
      useBtn.style.fontWeight = "bold";
      useBtn.style.fontSize = "0.9em";
      useBtn.style.cursor = "pointer";
      useBtn.onclick = async () => {
        const updates = {};

        // The originating attack already consumed this item's usage count. This button confirms
        // only the optional follow-up; incrementing here again made one attack spend two uses.
        // 1. Activation (when shouldActivate is true)
        if (shouldActivate) {
          updates['system.active.state'] = true;
          window.DX3rdDebug.log('DX3rd | Item activated on afterDamage:', item.name);
        }
        
        if (Object.keys(updates).length > 0) {
          await item.update(updates);
        }
        
        // 2. Apply the effect only to targets that took HP damage
        if (shouldApplyToTargets) {
          for (const targetId of damagedTargets) {
            const targetActor = game.actors.get(targetId);
            if (targetActor) {
              // After the damage is applied is an attack trigger point — buckets with a different per-row "trigger action" are excluded.
              const targetAttributes = frozenTargetAttributes ?? (window.DX3rdItemEffectAdapter
                ? window.DX3rdItemEffectAdapter.targetBucketAttributes(item, 'attack', 'afterDamage')
                : (item.system.effect?.attributes || {}));

              await this.dispatchItemAttributes(actor, item, targetActor, targetAttributes,
                {preEvaluated: frozenTargetAttributes != null});
              window.DX3rdDebug.log('DX3rd | Effect applied to damaged target (dialog):', targetActor.name);
            }
          }
        }
        
        if (dialogDiv.parentNode) document.body.removeChild(dialogDiv);
      };
      buttonContainer.appendChild(useBtn);
      
      // The "do not use" button
      const notUseBtn = document.createElement("button");
      notUseBtn.textContent = game.i18n.localize('DX3rd.NotUse');
      notUseBtn.style.width = "100%";
      notUseBtn.style.height = "32px";
      notUseBtn.style.background = "#666";
      notUseBtn.style.color = "white";
      notUseBtn.style.borderRadius = "4px";
      notUseBtn.style.border = "none";
      notUseBtn.style.fontWeight = "bold";
      notUseBtn.style.fontSize = "0.9em";
      notUseBtn.style.cursor = "pointer";
      notUseBtn.onclick = async () => {
        // Do nothing
        if (dialogDiv.parentNode) document.body.removeChild(dialogDiv);
      };
      buttonContainer.appendChild(notUseBtn);
      
      dialogDiv.appendChild(buttonContainer);
      
      // Dragging
      let isDragging = false;
      let offsetX, offsetY;
      
      const onMouseDown = (e) => {
        if (e.target.tagName === 'BUTTON') return;
        isDragging = true;
        const rect = dialogDiv.getBoundingClientRect();
        offsetX = e.clientX - rect.left;
        offsetY = e.clientY - rect.top;
        dialogDiv.style.cursor = "grabbing";
        title.style.cursor = "grabbing";
      };
      
      const onMouseMove = (e) => {
        if (!isDragging) return;
        e.preventDefault();
        const newLeft = e.clientX - offsetX;
        const newTop = e.clientY - offsetY;
        dialogDiv.style.left = newLeft + "px";
        dialogDiv.style.top = newTop + "px";
        dialogDiv.style.transform = "none";
      };
      
      const onMouseUp = () => {
        if (isDragging) {
          isDragging = false;
          dialogDiv.style.cursor = "move";
          title.style.cursor = "move";
        }
      };
      
      dialogDiv.addEventListener("mousedown", onMouseDown);
      document.addEventListener("mousemove", onMouseMove);
      document.addEventListener("mouseup", onMouseUp);
      
      const cleanup = () => {
        document.removeEventListener("mousemove", onMouseMove);
        document.removeEventListener("mouseup", onMouseUp);
      };
      
      const observer = new MutationObserver((mutations) => {
        mutations.forEach((mutation) => {
          mutation.removedNodes.forEach((node) => {
            if (node === dialogDiv) {
              cleanup();
              observer.disconnect();
            }
          });
        });
      });
      
      observer.observe(document.body, { childList: true });
      document.body.appendChild(dialogDiv);
    },

    /**
     * Run the afterDamage auto-activation (internal helper)
     */
    async _executeAfterDamageActivation(actor, item, damagedTargets, shouldActivate, shouldApplyToTargets, frozenTargetAttributes = null) {
      const updates = {};
      
      if (shouldActivate) {
        updates['system.active.state'] = true;
        window.DX3rdDebug.log('DX3rd | Item activated on afterDamage (auto):', item.name);
      }
      
      if (Object.keys(updates).length > 0) {
        await item.update(updates);
      }
      
      // Apply the effect only to targets that took HP damage
      if (shouldApplyToTargets) {
        for (const targetId of damagedTargets) {
          const targetActor = game.actors.get(targetId);
          if (targetActor) {
            // After the damage is applied is an attack trigger point — buckets with a different per-row "trigger action" are excluded.
            const targetAttributes = frozenTargetAttributes ?? (window.DX3rdItemEffectAdapter
              ? window.DX3rdItemEffectAdapter.targetBucketAttributes(item, 'attack', 'afterDamage')
              : (item.system.effect?.attributes || {}));

            await this.dispatchItemAttributes(actor, item, targetActor, targetAttributes,
              {preEvaluated: frozenTargetAttributes != null});
            window.DX3rdDebug.log('DX3rd | Effect applied to damaged target (auto):', targetActor.name);
          }
        }
      }
    },

    /**
     * Handle the attack roll (weapon, vehicle, and later psionic, effect, combo, …)
     * @param {Actor} actor - the attacking actor
     * @param {Item} item - the item being used
     * @returns {boolean} - whether it succeeded
     */
       handleAttackRoll: async function(actor, item, options = {}) {
        const autoAttackRoll = game.settings.get('dx3rd-emanim', 'autoAttackRoll') !== false;
        if (!autoAttackRoll && !options.forceRoll) {
          await this.createPendingAttackCard(actor, item);
          return true;
        }
        
        // Select the item's owning actor as a token
      let previousToken = null;
      if (actor && canvas.tokens) {
        // Remember the currently selected token (to restore it)
        previousToken = canvas.tokens.controlled?.[0] || null;
        
        // Find the actor's token
        const actorToken = canvas.tokens.placeables.find(t => t.actor?.id === actor.id);
        if (actorToken) {
          actorToken.control({ releaseOthers: true });
        }
      }
      
      // Check the targets (before clearing the highlight)
      const targets = Array.from(game.user.targets);
      if (targets.length === 0) {
        ui.notifications.warn(game.i18n.localize('DX3rd.SelectTarget'));
        // Restore the previous token
        if (previousToken && canvas.tokens) {
          previousToken.control({ releaseOthers: true });
        }
        return false; // keep the highlight and stop
      }
      
      // Check the item's skill
      const skillKey = item.system.skill;
      if (!skillKey || skillKey === '-') {
        const itemTypeLabel = item.type === 'weapon' ? '무기' : 
                              item.type === 'vehicle' ? '비클' : '아이템';
        ui.notifications.warn(`${itemTypeLabel}의 기능이 설정되지 않았습니다.`);
        return false;
      }
      
      // Fetch the skill data
      let skillData = null;
      let skillName = '';
      
      // A base attribute
      const attributes = ['body', 'sense', 'mind', 'social'];
      if (attributes.includes(skillKey)) {
        skillData = actor.system.attributes[skillKey];
        skillName = game.i18n.localize(`DX3rd.${skillKey.charAt(0).toUpperCase() + skillKey.slice(1)}`);
      } else {
        // A skill
        skillData = actor.system.attributes.skills?.[skillKey];
        if (skillData) {
          skillName = skillData.name;
          if (skillName && skillName.startsWith('DX3rd.')) {
            skillName = game.i18n.localize(skillName);
          }
        }
      }
      
      if (!skillData) {
        const itemTypeLabel = item.type === 'weapon' ? '무기' : 
                              item.type === 'vehicle' ? '비클' : '아이템';
        ui.notifications.warn(`${itemTypeLabel}의 기능을 찾을 수 없습니다.`);
        return false;
      }
      
       // Do not ask the same question again when handleItemUse already chose.
       let useCombo;
       if (options.comboMode === 'combo') useCombo = true;
       else if (options.comboMode === 'normal') useCombo = false;
       else {
         if (typeof window.DX3rdChooseRollMode !== 'function') {
           ui.notifications.error(game.i18n.localize('DX3rd.DialogV2Unavailable'));
           return false;
         }
         useCombo = await window.DX3rdChooseRollMode();
         if (useCombo === null) return true;
       }

      if (useCombo) {
        // Open the combo builder (as a skill type, passing the weapon item to seed attackRoll)
        await this.openComboBuilder(actor, 'skill', skillKey, item);
        // Restore the previous token
        if (previousToken && canvas.tokens) {
          previousToken.control({ releaseOthers: true });
        }
      } else {
        // Fold the weapon's / vehicle's own modifier (system.add = accuracy modifier) into the accuracy check result.
        //   Rules (rulebook-1-2 p121): a weapon's accuracy modifier adds to the attack result of its own type.
        //   The attack value (system.attack) is evaluated separately in the damage stage (executeAttackRoll), so here
        //   it is only for flavor display and is not double-counted (executeAttackRoll takes no weaponBonus).
        let weaponBonus = null;
        const preparedWeaponAdd = window.DX3rdFormulaEvaluator.prepareRollFormula(item.system.add, item, actor);
        const preparedWeaponAttack = window.DX3rdFormulaEvaluator.prepareRollFormula(item.system.attack, item, actor);
        // Dice modifiers are not rolled when the sheet or dialog opens. The moment the check button is
        // pressed, executeAttackRoll / executeStatRoll include the source formula in the same Roll.
        const weaponAddIsDice = window.DX3rdFormulaEvaluator.hasDice(preparedWeaponAdd);
        const selfAdd = weaponAddIsDice ? 0 : (window.DX3rdFormulaEvaluator.evaluate(preparedWeaponAdd) || 0);
        const selfAttack = window.DX3rdFormulaEvaluator.hasDice(preparedWeaponAttack)
          ? preparedWeaponAttack
          : (window.DX3rdFormulaEvaluator.evaluate(preparedWeaponAttack) || 0);
        if (selfAdd !== 0 || selfAttack !== 0 || weaponAddIsDice) {
          weaponBonus = {
            attack: selfAttack,
            add: selfAdd,
            addFormula: weaponAddIsDice ? preparedWeaponAdd : null,
            weaponName: (item.name || '').replace(/\|\|.+$/, '').trim(),
            weaponIds: [item.id]
          };
        }
        // Show the check dialog (major only, passing the weapon item)
        this.showStatRollDialog(
          actor, skillData, skillName, 'major', item, previousToken, weaponBonus,
          null, null, null, false, false, null, false, options.sourceMessage || null
        );
      }
      
      return true;
    },

    /**
     * Shared post-processing after the accuracy check (attack roll) completes.
     * The single point called right after the roll from both the weapon/vehicle path (executeAttackRoll) and
     * the combo/effect path (executeStatRoll's attack branch). Logic that must intervene at accuracy time lives here.
     *
     * 1) Extension hook: `Hooks.callAll('dx3rd.attackRollComplete', {...})` — an extension point where effects and
     *    modules can intervene on accuracy-check completion (there is no separate effect timing in the data, so it is offered as a hook).
     * 2) Automatic hatred recovery (rules p12): making one attack against the hatred target recovers hatred regardless
     *    of success. On a miss or fumble the damage button is never pressed, so it MUST be cleared at accuracy time.
     *
     * @param {Actor} actor - the attacking actor
     * @param {Item} item - the attacking item
     * @param {Token[]} targets - the tokens targeted by the accuracy check
     * @param {number} rollResult - the final result, fumble correction included
     * @param {boolean} isFumble - whether it was a fumble
     * @param {ChatMessage|null} attackMessage - the chat card this attack's follow-up state is bound to
     */
    async onAttackRollComplete(actor, item, targets, rollResult, isFumble, attackMessage = null) {
      try {
        const attackAfterDamageRiders = await this.bindPendingAttackRiders(actor, attackMessage);
        // Extension point: a hook to intervene when the accuracy check completes (for rule / effect extensions)
        Hooks.callAll('dx3rd.attackRollComplete', {
          actor, item, targets, rollResult, isFumble, attackMessage, attackAfterDamageRiders
        });

        // Automatic hatred recovery: clear it when hatred.target is among the targets
        const hatredActive = actor.system?.conditions?.hatred?.active || false;
        const hatredTarget = actor.system?.conditions?.hatred?.target || '';
        if (hatredActive && hatredTarget && Array.isArray(targets) && targets.length > 0) {
          const hasHatredTarget = targets.some(t => (t?.actor?.name || t?.name) === hatredTarget);
          if (hasHatredTarget) {
            await actor.toggleStatusEffect('hatred', { active: false });
            window.DX3rdDebug.log(`DX3rd | Hatred auto-cleared after attack roll against target: ${hatredTarget}`);
          }
        }
      } catch (e) {
        console.warn('DX3rd | onAttackRollComplete failed', e);
      }
    },
  });
})();
