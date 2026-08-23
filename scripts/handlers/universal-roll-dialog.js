// Universal handler — the roll & check-dialog cluster.
// Split out of universal-handler.js; it must load after that file and mixes into the same object.
// (executeAttackRoll / _getSortedSkillOptions / openComboBuilder /
//  showStatRollConfirmDialog / showStatRollDialog / executeStatRoll)
(function() {
  if (!window.DX3rdUniversalHandler) {
    console.error('DX3rd | universal-roll-dialog.js loaded before universal-handler.js; roll methods unavailable.');
    return;
  }

  Object.assign(window.DX3rdUniversalHandler, {
    /**
     * A DX3rd attack card: like Midi-QOL's merged card, roll results stack under an icon/summary
     * header, and the action buttons sit in a narrow row kept apart from the results.
     */
    renderAttackChatCard({actor, item, flavorText = '', rollHtml = '', actionContent = ''}) {
      const escapeHTML = value => window.DX3rdRuntimeUtils?.escapeHTML?.(String(value ?? ''))
        ?? foundry.utils.escapeHTML(String(value ?? ''));
      const itemName = String(item?.name || game.i18n.localize('DX3rd.AttackRoll')).split('||')[0].trim();
      const image = item?.img || actor?.img || 'icons/svg/sword.svg';
      return `
        <article class="dx3rd-item-chat dx3rd-attack-card">
          <header class="dx3rd-attack-card__header">
            <img src="${escapeHTML(image)}" alt="${escapeHTML(itemName)}">
            <div class="dx3rd-attack-card__heading">
              <h3>${escapeHTML(itemName)}</h3>
              <span>${game.i18n.localize('DX3rd.AttackRoll')}</span>
            </div>
          </header>
          <section class="dx3rd-attack-card__body">
            ${flavorText ? `<div class="dx3rd-attack-card__summary">${flavorText}</div>` : ''}
            ${rollHtml ? `<div class="dx3rd-roll-label">${game.i18n.localize('DX3rd.AttackRoll')}</div><div class="dx3rd-attack-card__roll">${rollHtml}</div>` : ''}
          </section>
          <footer class="damage-roll-message dx3rd-attack-card__actions">
            <div class="dx3rd-card-buttons">${actionContent}</div>
          </footer>
        </article>`;
    },

    renderAttackRollButton(actor, item, {repeatable = false} = {}) {
      return `<button class="attack-roll-btn"
                      data-item-id="${item?.id || ''}"
                      data-repeatable="${repeatable ? 'true' : 'false'}">
                ${game.i18n.localize('DX3rd.HitRoll')}
              </button>`;
    },

    async createPendingAttackCard(actor, item) {
      const cleanItemName = String(item?.name || '').split('||')[0].trim();
      const content = this.renderAttackChatCard({
        actor,
        item,
        flavorText: `<p>${cleanItemName}</p>`,
        actionContent: this.renderAttackRollButton(actor, item)
      });
      return ChatMessage.create({
        speaker: ChatMessage.getSpeaker({actor}),
        content,
        flags: {'dx3rd-emanim': {pendingAttackRoll: true}}
      });
    },

    /**
     * Validate a dice formula before it is carried into a check roll as a term.
     * It is passed along as a string rather than rolled, so a bad formula breaks the entire roll.
     * Back when it was rolled into a number a try/catch absorbed that, hence this check.
     * @param {string} formula - the formula to check (an empty value stays '')
     * @param {string} kind - field name, for the log line
     * @returns {string} the formula when valid, otherwise '' (the term is dropped)
     */
    validateRollTerm(formula, kind) {
      if (!formula) return '';
      if (Roll.validate(formula)) return formula;
      console.warn(`DX3rd | invalid roll term (${kind}): ${formula}`);
      ui.notifications.warn(`${game.i18n.localize('DX3rd.DamageRollFormulaInvalid')}: ${formula}`);
      return '';
    },

    /**
     * Execute an attack roll (weapon / vehicle / effect / combo / psionic …)
     * @param {Actor} actor - the attacking actor
     * @param {Item} item - the attacking item
     * @param {string} skillName - skill name
     * @param {Token} previousToken - the previously selected token
     * @param {number} dice - dice count
     * @param {number} critical - critical value
     * @param {number} add - flat addition
     * @param {string} rollType - 'major' | 'reaction' | 'dodge' (selects the per-type action formula)
     */
    async executeAttackRoll(actor, item, skillName, previousToken, dice, critical, add, weaponBonus = null, statRollFormula = null, rollType = 'major', sourceMessage = null) {
      try {
        // Re-read the current targets
        const targets = Array.from(game.user.targets);

        // Referenced values freeze at accuracy time, but dice formulas are held back until the
        // damage roll, so the attack card never carries an undisclosed damage result.
        const itemAttackFormula = window.DX3rdFormulaEvaluator.prepareRollFormula(item.system.attack, item, actor);

        // Attack type and actor bonuses (the same path the damage roll takes)
        // The penetrate dice are rolled now, at accuracy time, so the defense dialog only sees a number.
        const bonuses = await this.resolveAttackBonusesRolled(actor, item);

        const preservedValues = {
          actorAttack: bonuses.actorAttack,
          actorAttackFormula: bonuses.actorAttackFormula,
          actorPenetrate: bonuses.actorPenetrate,
          weaponAttackFormula: itemAttackFormula
        };

      
        // The fear penalty was already folded in by the dialog, so it is not applied again here.
        // Rules (rule-section:39-41): a modified pool of 0 or less auto-fails (achievement 0).
        // At least one die is still rolled for the animation; the result is forced to 0 below.
        // Action-time roll formulas: prepareData keeps only the source text, and it is rolled exactly once here.
        const actionProfile = actor.system.attributes.actionRollFormula || {};
        const typedProfile = actionProfile[rollType] || {};
        const buildActionFormula = (kind) =>
          [actionProfile[kind], typedProfile[kind], statRollFormula?.[kind]].filter(Boolean).join(' + ');
        const rollActionFormula = async (kind) => {
          const formula = buildActionFormula(kind);
          if (!formula) return { total: 0, text: '' };
          try {
            const result = await (new Roll(formula)).evaluate();
            return { total: Number(result.total) || 0, text: `${kind}: ${formula} → ${result.total}` };
          } catch (error) {
            console.warn(`DX3rd | action roll formula failed (${kind}): ${formula}`, error);
            ui.notifications.warn(`${game.i18n.localize('DX3rd.DamageRollFormulaInvalid')}: ${formula}`);
            return { total: 0, text: `${kind}: ${formula} → 0` };
          }
        };
        // Dice count and critical must be settled before the check formula is assembled, so they roll here.
        // The addition (add) is NOT rolled — it goes into the check roll below as a term of its own,
        // so the chat card shows the dice formula verbatim, e.g. "10dx7 + 10d10".
        const [formulaDice, formulaCritical] = await Promise.all([
          rollActionFormula('dice'), rollActionFormula('critical')
        ]);
        const addDiceFormula = this.validateRollTerm(buildActionFormula('add'), 'add');
        const rolledDice = dice + formulaDice.total;
        const rolledCritical = critical + formulaCritical.total;
        // The chat card shows only the final DX3rd check formula. The expanded auxiliary formulas
        // are already folded into the pool, so they are not repeated on a line of their own.
        const autoFailByPool = rolledDice <= 0;
        const finalDice = Math.max(1, rolledDice);

        const add2 = add;
        // The weapon's accuracy dice join this same Roll exactly once, now that the button was pressed.
        // The result surfaces in the accuracy card's per-term Foundry breakdown, not in the pre-roll dialog.
        const weaponAddFormula = weaponBonus?.addFormula;
        const rollFormula = [`${finalDice}dx${Math.max(2, rolledCritical)}`, String(add2),
          addDiceFormula, weaponAddFormula].filter(Boolean).join(' + ');
        const roll = await (new Roll(rollFormula)).roll();
        const rollHtml = await roll.render();

        // Rules: every check die showing 1 is a fumble → auto-fail, achievement 0.
        // When the dx dice term raises its fumble flag, skill level and add2 are ignored and the total is 0.
        // Rules (rule-section:39-41): a pool of 0 or less auto-fails the same way, achievement 0.
        const isFumble = roll.terms.some(t => t?.fumble === true);
        const rollResult = (autoFailByPool || isFumble) ? 0 : roll.total;

        // Emit the attack-roll message (ruby text stripped)
        const cleanItemName = item.name.split('||')[0].trim();
        let flavorText = `${cleanItemName} - ${skillName} (${game.i18n.localize('DX3rd.AttackRoll')})`;
        if (autoFailByPool) {
          flavorText += `\n${game.i18n.localize('DX3rd.PoolZero')} — ${game.i18n.localize('DX3rd.TestFailure')}`;
        } else if (isFumble) {
          flavorText += `\n${game.i18n.localize('DX3rd.Fumble')} — ${game.i18n.localize('DX3rd.TestFailure')}`;
        }

        // Append the target information
        if (targets.length > 0) {
          const targetDisplayNames = [];

          for (const target of targets) {
            const targetActor = target.actor;
            const targetName = targetActor?.name || target.name;
            if (!targetName) continue;
            
            // For an enemy target with evasion enabled, resolve the hit right here
            if (targetActor && targetActor.type === 'enemy') {
              const evasionDisabled = targetActor.system?.attributes?.evasion?.disabled;
              const evasionValue = targetActor.system?.attributes?.evasion?.value;
              
              if (evasionDisabled === false && evasionValue !== undefined && evasionValue !== null) {
                const evasionNum = Number(evasionValue) || 0;
                const isHit = rollResult > evasionNum;
                const resultText = isHit 
                  ? `${game.i18n.localize('DX3rd.Hit')}: ${game.i18n.localize('DX3rd.Evasion')} ${evasionNum}`
                  : `${game.i18n.localize('DX3rd.Failure')}: ${game.i18n.localize('DX3rd.Evasion')} ${evasionNum}`;
                targetDisplayNames.push(`${targetName}(${resultText})`);
              } else {
                targetDisplayNames.push(targetName);
              }
            } else {
              targetDisplayNames.push(targetName);
            }
          }
          
          if (targetDisplayNames.length > 0) {
            flavorText += `\n· ${game.i18n.localize('DX3rd.Target')}: ${targetDisplayNames.join(', ')}`;
          }
        }
        
        // Build the damage-roll button
        let damageRollButtonContent = `<button class="damage-roll-btn"
                    data-actor-id="${actor.id}"
                    data-item-id="${item.id}"
                    data-roll-result="${rollResult}"
                    data-preserved-actor-attack="${preservedValues.actorAttack}"
                    data-preserved-actor-attack-formula="${encodeURIComponent(preservedValues.actorAttackFormula || '')}"
                    data-preserved-actor-penetrate="${preservedValues.actorPenetrate}"`;
        
        // Per-type attack-power data attributes
        if (item.type === 'weapon') {
          damageRollButtonContent += `\n                    data-preserved-attack-formula="${encodeURIComponent(preservedValues.weaponAttackFormula)}"`;
          damageRollButtonContent += `\n                    data-weapon-ids="${item.id}"`; // the weapon's own id
        } else if (item.type === 'vehicle') {
          damageRollButtonContent += `\n                    data-preserved-attack-formula="${encodeURIComponent(preservedValues.weaponAttackFormula)}"`;
        } else {
          damageRollButtonContent += `\n                    data-preserved-attack-formula="${encodeURIComponent(preservedValues.weaponAttackFormula)}"`;
        }
        
        damageRollButtonContent += `>
                ${game.i18n.localize('DX3rd.DamageRoll')}
            </button>`;
        
        // Attack text, targets, roll result, and damage button in one message (rollHtml included, as for combos)
        const attackMessageContent = this.renderAttackChatCard({
          actor,
          item,
          flavorText: `<p>${flavorText.replace(/\n/g, '<br>')}</p>`,
          rollHtml,
          actionContent: `${this.renderAttackRollButton(actor, item, {repeatable: true})}${damageRollButtonContent}`
        });
        
        let attackMessage;
        if (sourceMessage) {
          await sourceMessage.update({
            content: attackMessageContent,
            rolls: [roll.toJSON()],
            'flags.dx3rd-emanim.pendingAttackRoll': false,
            'flags.dx3rd-emanim.attackRollCompleted': false
          });
          attackMessage = sourceMessage;
        } else {
          attackMessage = await ChatMessage.create({
            speaker: ChatMessage.getSpeaker({ actor: actor }),
            content: attackMessageContent,
            rolls: [roll]
          });
        }

        // Run the post-major disable hooks (on this actor only)
        if (window.DX3rdDisableHooks) {
          await window.DX3rdDisableHooks.executeDisableHook('roll', actor);
          await window.DX3rdDisableHooks.executeDisableHook('major', actor);
        }

        // Shared post-accuracy work (automatic hatred recovery + extension hooks)
        await this.onAttackRollComplete(actor, item, targets, rollResult, isFumble, attackMessage);

        await this.maybeAutoRollDamage?.(attackMessage);

        // Restore the previous token
        if (previousToken && canvas.tokens) {
          previousToken.control({ releaseOthers: true });
        }

        return true;
      } catch (e) {
        console.error('DX3rd | Weapon attack roll failed', e);
        ui.notifications.error('공격 굴림 중 오류가 발생했습니다.');
        // Restore the token on error too
        if (previousToken && canvas.tokens) {
          previousToken.control({ releaseOthers: true });
        }
        return false;
      }
    },

    /**
     * Get the sorted skill options (identical to _getSortedSkillOptions in actor-sheet.js)
     */
    _getSortedSkillOptions(actor) {
      const skills = actor.system?.attributes?.skills || {};
      const sortedOptions = [];
      
      // Default skill order per attribute
      const skillOrder = {
        body: ['melee', 'evade'],
        sense: ['ranged', 'perception'],
        mind: ['rc', 'will', 'cthulhu'],
        social: ['negotiation', 'procure']
      };
      
      const attributes = ['body', 'sense', 'mind', 'social'];
      
      for (const attr of attributes) {
        // The attribute itself
        sortedOptions.push({
          value: attr,
          label: game.i18n.localize(`DX3rd.${attr.charAt(0).toUpperCase() + attr.slice(1)}`),
          isAbility: true
        });
        
        // That attribute's default skills
        const defaultSkills = skillOrder[attr] || [];
        for (const skillKey of defaultSkills) {
          const skill = skills[skillKey];
          if (skill && skill.base === attr) {
            let skillName = skill.name;
            if (skillName && skillName.startsWith('DX3rd.')) {
              skillName = game.i18n.localize(skillName);
            }
            sortedOptions.push({
              value: skillKey,
              label: skillName,
              isAbility: false
            });
          }
        }
        
        // That attribute's custom skills
        for (const [skillKey, skill] of Object.entries(skills)) {
          if (skill.base === attr && !defaultSkills.includes(skillKey)) {
            let skillName = skill.name;
            if (skillName && skillName.startsWith('DX3rd.')) {
              skillName = game.i18n.localize(skillName);
            }
            sortedOptions.push({
              value: skillKey,
              label: skillName,
              isAbility: false
            });
          }
        }
      }
      
      return sortedOptions;
    },
    
    /**
     * Open the combo builder (works without an actor sheet)
     * @param {Actor} actor - the actor
     * @param {string} targetType - 'ability' or 'skill'
     * @param {string} targetId - attribute/skill id
     * @param {Item} weaponItem - weapon item (optional; seeds the initial attackRoll)
     * @param {Object} options - extra options (optional)
     *   - {boolean} isBookDecipher: whether this is a book-decipher combo
     *   - {Item} originalItem: the originating item (e.g. the book)
     *   - {Object} predefinedDifficulty: a pre-set difficulty
     *   - {string} rollType: force the check type ('dodge'/'reaction'). Used when the caller — a
     *     defense dialog, say — already knows it. When set, no attack roll is attached.
     *   - {boolean} getTarget: whether a target is required (default true). false for reaction combos.
     *   - {Function} afterRollCallback: called once the roll completes (passed via the temp combo's meta)
     *   - {Function} afterUseCallback: called right after use (passed via the temp combo's meta)
     */
    // The combo builder creates an editable temporary combo document and opens its sheet.
    // On use or cancel the document is deleted; only the save button makes it a permanent combo.
    // Starting from a weapon seeds an attack combo (attack roll = weapon type, skill = its attack skill).
    async openComboBuilder(actor, targetType, targetId, weaponItem = null, options = {}) {
      const comboData = window.DX3rdComboData;
      const abilityKeys = ['body', 'sense', 'mind', 'social'];

      // Effect ids to preselect when the combo was started from an effect or a piece of equipment
      const preselectIds = Array.isArray(options.preselectEffectIds)
        ? options.preselectEffectIds.filter(Boolean)
        : [];

      // The caller may pin the check type (a reaction dialog's temp combo, say). A defense check
      // cannot carry an attack roll, so the weapon seeding is skipped entirely.
      const forcedRoll = ['major', 'reaction', 'dodge', '-'].includes(options.rollType)
        ? options.rollType : null;
      const isDefenseSeed = forcedRoll === 'reaction' || forcedRoll === 'dodge';

      // Only weapons/vehicles seed the weapon slot and attack combo (a non-weapon passed for flavor is ignored)
      const seedWeapon = (!isDefenseSeed && weaponItem && (weaponItem.type === 'weapon' || weaponItem.type === 'vehicle'))
        ? weaponItem : null;

      // ---- Seed values (precedence: effect's explicit skill > weapon's explicit skill > weapon type) ----
      // Later additions/removals on the sheet are recomputed with the same precedence by DX3rdComboData.deriveComboAttackFields.
      let skill = (targetType === 'skill' && targetId && targetId !== '-') ? targetId : '-';
      let base = '-';
      let attackRoll = '-';
      const weaponSetting = [];
      if (seedWeapon) weaponSetting.push(seedWeapon.id);

      const seedEffects = preselectIds.map(id => actor.items.get(id)).filter(Boolean);
      const seedWeaponType = seedWeapon?.system?.type;

      // Attack roll: the effect's attackRoll (melee/ranged) beats the weapon type. (No attack roll for defense seeds.)
      const effAR = isDefenseSeed
        ? null
        : seedEffects.find(e => e.system?.attackRoll === 'melee' || e.system?.attackRoll === 'ranged');
      if (effAR) attackRoll = effAR.system.attackRoll;
      else if (!isDefenseSeed && (seedWeaponType === 'melee' || seedWeaponType === 'ranged')) attackRoll = seedWeaponType;

      // Skill: the effect's designated skill > the weapon's explicit skill > inferred from the weapon type.
      //   (A value seeded from a skill loses to any combination signal.) "Designated" prefers comboSkill — the skill swap on combination — falling back to the effect's own skill. (Rule basis: combo-data.js)
      const effComboSkill = seedEffects.find(e => e.system?.comboSkill && e.system.comboSkill !== '-');
      // skill='syndrome' (Concentrate, Reflex, …) is a pure modifier sentinel, not a check skill — excluded as a skill source.
      const effOwnSkill = seedEffects.find(e => e.system?.skill && e.system.skill !== '-' && e.system.skill !== 'syndrome');
      if (effComboSkill) {
        skill = effComboSkill.system.comboSkill;  // base is inferred from the skill below
      } else if (effOwnSkill) {
        skill = effOwnSkill.system.skill;
        if (effOwnSkill.system?.base && effOwnSkill.system.base !== '-') base = effOwnSkill.system.base;
      } else if (seedWeapon?.system?.skill && seedWeapon.system.skill !== '-') {
        skill = seedWeapon.system.skill;
      } else if (seedWeaponType === 'ranged') {
        skill = 'ranged';
      } else if (seedWeaponType === 'melee') {
        skill = 'melee';
      }

      // With a skill settled but no base, take the skill's base attribute
      if (base === '-' && skill !== '-') {
        base = abilityKeys.includes(skill) ? skill : (actor.system?.attributes?.skills?.[skill]?.base || '-');
      }

      // comboBase (attribute swap on combination): keeps the skill, replaces only the check attribute (rule basis: combo-data.js)
      const effComboBase = seedEffects.find(e => abilityKeys.includes(e.system?.comboBase));
      if (effComboBase) base = effComboBase.system.comboBase;

      // Combine the member effects' encroachment / range / target (the most restrictive value wins).
      const effectIds = [...preselectIds];
      const encroachValue = comboData?.calculateEncroachment?.(actor, effectIds) ?? '0';
      const RT = window.DX3rdRangeTarget;
      const rangeCombo = RT ? RT.combineRange(effectIds.map(id => actor.items.get(id)?.system?.range)) : null;
      const targetCombo = RT ? RT.combineTarget(effectIds.map(id => actor.items.get(id)?.system?.target)) : null;
      const rangeValue = rangeCombo?.resolved ? rangeCombo.value : '-';
      const targetValue = targetCombo?.resolved ? targetCombo.value : '-';

      // With an attack roll but no fixed weapon, a weapon picker opens at use time.
      const weaponSelect = attackRoll !== '-' && weaponSetting.length === 0;
      // With a fixed weapon, precompute the attack power.
      const attackValue = attackRoll !== '-'
        ? (comboData?.calculateSubmittedAttack?.(actor, attackRoll, weaponSetting) ?? 0)
        : 0;

      const comboItemData = {
        name: `[${game.i18n.localize('DX3rd.Combo')}]`,
        type: 'combo',
        flags: {'dx3rd-emanim': {instantCombo: true}},
        system: {
          skill,
          base,
          // A skill or an attack roll means it starts as a major action, for the check.
          // A check type pinned by the caller (reaction/dodge) wins over that.
          roll: forcedRoll || ((skill !== '-' || attackRoll !== '-') ? 'major' : '-'),
          attackRoll,
          effectIds,
          weapon: weaponSetting,
          weaponSelect,
          getTarget: options.getTarget !== false,
          range: rangeValue,
          target: targetValue,
          encroach: { value: encroachValue },
          attack: { value: attackValue },
          level: { value: 1 }
        }
      };

      try {
        const [created] = await actor.createEmbeddedDocuments('Item', [comboItemData]);
        // One-shot check context supplied by the caller (a book, a defense dialog) lives as long as
        // the temporary combo — an in-memory field hung on the document, never persisted.
        const hasMeta = options.originalItem || options.predefinedDifficulty || options.isBookDecipher
          || options.afterRollCallback || options.afterUseCallback || isDefenseSeed;
        if (created && hasMeta) {
          created.meta = {
            originalItem: options.originalItem || null,
            predefinedDifficulty: options.predefinedDifficulty || null,
            isBookDecipher: !!options.isBookDecipher,
            // This in-memory marker distinguishes a defense builder from an ordinary temporary
            // combo whose saved getTarget=false must not suppress a member's real target gate.
            defenseContext: isDefenseSeed,
            afterRollCallback: typeof options.afterRollCallback === 'function' ? options.afterRollCallback : null,
            afterUseCallback: typeof options.afterUseCallback === 'function' ? options.afterUseCallback : null
          };
        }
        // Warn when a self-targeting effect is mixed with non-self ones (but let it proceed).
        if (targetCombo?.selfConflict) {
          ui.notifications.warn(game.i18n.localize('DX3rd.SelfCombineWarning'));
        }
        // Open the new combo's sheet for naming, tweaking, and immediate use.
        created?.sheet?.render(true);
        return created;
      } catch (e) {
        console.error('DX3rd | openComboBuilder - create failed:', e);
        ui.notifications.error(`${game.i18n.localize('DX3rd.Combo')}: ${e?.message || e}`);
        return null;
      }
    },
    
    /**
     * Ask whether to roll directly or open the combo builder, then do it.
     * @param {Actor} actor - the actor
     * @param {string} targetType - 'ability' or 'skill'
     * @param {string} targetId - attribute/skill id
     * @param {Function} openComboBuilderCallback - combo-builder callback
     */
    async showStatRollConfirmDialog(actor, targetType, targetId, openComboBuilderCallback, specificRollType = null, menuAnchor = null) {
      // Permission check
      if (!actor.isOwner && !game.user.isGM) {
        ui.notifications.warn('이 액터에 대한 권한이 없습니다.');
        return;
      }

      const stat = targetType === 'ability' 
        ? actor.system.attributes[targetId]
        : actor.system.attributes.skills[targetId];
      
      if (!stat) return;
      
      let label = '';
      if (targetType === 'ability') {
        label = game.i18n.localize(`DX3rd.${targetId.charAt(0).toUpperCase() + targetId.slice(1)}`);
      } else {
        label = stat.name;
        if (label && label.startsWith('DX3rd.')) label = game.i18n.localize(label);
      }
      
      const openCombo = async () => {
        if (openComboBuilderCallback) {
          return openComboBuilderCallback(targetType, targetId);
        }
        // Without a callback, call openComboBuilder directly
        return this.openComboBuilder(actor, targetType, targetId);
      };
      const rollDirectly = () => this.showStatRollDialog(actor, stat, label, specificRollType);

      if (typeof window.DX3rdChooseRollMode !== 'function') {
        ui.notifications.error(game.i18n.localize('DX3rd.DialogV2Unavailable'));
        return;
      }
      const useCombo = await window.DX3rdChooseRollMode(menuAnchor ?? undefined);

      if (useCombo === true) return openCombo();
      if (useCombo === false) return rollDirectly();
    },

    /**
     * Show the attribute/skill check dialog (Major / Reaction / Dodge)
     * @param {Actor} actor - the actor
     * @param {Object} stat - attribute/skill data
     * @param {string} label - the label to display
     * @param {string} specificRollType - show only this roll type (optional: 'major'|'reaction'|'dodge')
     * @param {Item} item - the item (optional)
     * @param {Token} previousToken - the previously selected token (weapon attacks; optional)
     * @param {Object} weaponBonus - weapon bonus (optional)
     * @param {Object} comboAfterSuccessData - combo afterSuccess payload (optional)
     * @param {Object} comboAfterDamageData - combo afterDamage payload (optional)
     * @param {Object} predefinedDifficulty - a pre-set difficulty (optional; used by books etc.)
     */
    async showStatRollDialog(actor, stat, label, specificRollType = null, item = null, previousToken = null, weaponBonus = null, comboAfterSuccessData = null, comboAfterDamageData = null, predefinedDifficulty = null, requireDifficulty = false, isUrgeTest = false, afterRollCallback = null, isPanicTest = false, sourceMessage = null) {
      const defaultCritical = game.settings.get("dx3rd-emanim", "defaultCritical") || 10;
      
      // A shallow copy would share major/reaction/dodge with the original and accumulate penalties → deepClone
      let effectiveStat = foundry.utils.deepClone(stat);
      
      // For a fear check, subtract encroachment.dice from the dice pool
      // Rules (rule-section:39-41): a modified pool of 0 or less auto-fails. No floor is applied here;
      // the raw value (possibly negative) propagates so the roll executor decides the auto-fail.
      if (isPanicTest) {
        const encroachmentDice = Number(actor.system?.attributes?.encroachment?.dice) || 0;
        if (effectiveStat.dice !== undefined) {
          effectiveStat.dice = (effectiveStat.dice || 0) - encroachmentDice;
        }
        // Apply to major, reaction and dodge as well
        if (effectiveStat.major && effectiveStat.major.dice !== undefined) {
          effectiveStat.major.dice = (effectiveStat.major.dice || 0) - encroachmentDice;
        }
        if (effectiveStat.reaction && effectiveStat.reaction.dice !== undefined) {
          effectiveStat.reaction.dice = (effectiveStat.reaction.dice || 0) - encroachmentDice;
        }
        if (effectiveStat.dodge && effectiveStat.dodge.dice !== undefined) {
          effectiveStat.dodge.dice = (effectiveStat.dodge.dice || 0) - encroachmentDice;
        }
      }
      
      // Fear "dependency" penalty (dice -4; no floor — see the rule note below)
      const panic8Applied = window.DX3rdAppliedEffects?.getEffect(actor, 'Panic8') || actor.system?.attributes?.applied?.Panic8;
      if (panic8Applied) {
        // Find the actor's token
        const actorToken = canvas.tokens.placeables.find(t => t.actor?.id === actor.id);
        if (actorToken) {
          // Collect the Lois item names
          const roisItems = actor.items.filter(item => item.type === 'rois');
          const roisNames = roisItems.map(item => {
            // Strip ||RubyText from the item name
            let itemName = item.name;
            const rubyPattern = /^(.+)\|\|(.+)$/;
            const match = itemName.match(rubyPattern);
            if (match) {
              itemName = match[1];
            }
            return itemName.trim();
          }).filter(name => name); // drop empty strings
          
          if (roisNames.length > 0) {
            // Engage range = half the token size, rounded up
            const tokenSize = Math.max(actorToken.document.width, actorToken.document.height);
            const engageRange = Math.ceil(tokenSize / 2);
            
            // Grids within engage range
            const engageGrids = this.getGridsInRange(actorToken, engageRange);
            
            // Is there a token actor in engage range whose name matches a Lois item?
            let hasMatchingRoisToken = false;
            for (const grid of engageGrids) {
              const tokenAtGrid = this.getTokenAtGrid(grid, actorToken);
              if (tokenAtGrid && tokenAtGrid.actor) {
                const tokenActorName = tokenAtGrid.actor.name || '';
                // Match against the Lois item names
                if (roisNames.some(roisName => tokenActorName === roisName)) {
                  hasMatchingRoisToken = true;
                  break;
                }
              }
            }
            
            // No matching token → apply the -4 dice penalty
            // Rules (rule-section:39-41): no floor — the raw value (possibly negative) propagates, and the roll executor auto-fails at 0 or less
            if (!hasMatchingRoisToken) {
              if (effectiveStat.dice !== undefined) {
                effectiveStat.dice = (effectiveStat.dice || 0) - 4;
              }
              if (effectiveStat.major && effectiveStat.major.dice !== undefined) {
                effectiveStat.major.dice = (effectiveStat.major.dice || 0) - 4;
              }
              if (effectiveStat.reaction && effectiveStat.reaction.dice !== undefined) {
                effectiveStat.reaction.dice = (effectiveStat.reaction.dice || 0) - 4;
              }
              if (effectiveStat.dodge && effectiveStat.dodge.dice !== undefined) {
                effectiveStat.dodge.dice = (effectiveStat.dodge.dice || 0) - 4;
              }
            }
          }
        }
      }
      
      // Madness 2 (Paranoia): -2 major dice when an adjacent grid holds a token that is not a Lois
      const madnessTypePrefix = game.i18n.localize('DX3rd.MadnessType');
      const madness2Name = madnessTypePrefix + ': ' + game.i18n.localize('DX3rd.Madness2');
      const hasMadness2 = actor.items.some(item => 
        item.type === 'effect' && 
        item.name === madness2Name
      );
      
      let paranoiaPenalty = 0;
      if (hasMadness2) {
        const actorToken = canvas.tokens.placeables.find(t => t.actor?.id === actor.id);
        if (actorToken) {
          const roisItems = actor.items.filter(item => item.type === 'rois');
          const roisNames = roisItems.map(item => {
            let itemName = item.name;
            const rubyPattern = /^(.+)\|\|(.+)$/;
            const match = itemName.match(rubyPattern);
            if (match) {
              itemName = match[1];
            }
            return itemName.trim();
          }).filter(name => name);
          
          const adjacentGrids = this.getAdjacentGrids(actorToken);
          let hasNonRoisAdjacent = false;
          for (const grid of adjacentGrids) {
            const tokenAtGrid = this.getTokenAtGrid(grid, actorToken);
            if (tokenAtGrid && tokenAtGrid.actor) {
              const adjacentActorName = tokenAtGrid.actor.name || '';
              if (!adjacentActorName) continue;
              const isRoisMatch = roisNames.some(roisName => adjacentActorName === roisName);
              if (!isRoisMatch) {
                hasNonRoisAdjacent = true;
                break;
              }
            }
          }
          
          if (hasNonRoisAdjacent) {
            paranoiaPenalty = -2;
            if (effectiveStat.major && effectiveStat.major.dice !== undefined) {
              effectiveStat.major.dice = Math.max(1, (effectiveStat.major.dice || 0) - 2);
            }
          }
        }
      }
      
      if (weaponBonus) {
        // Apply the weapon bonus to the base add
        effectiveStat.add = (stat.add || 0) + (weaponBonus.add || 0);
        
        // And to major, reaction and dodge
        if (effectiveStat.major) {
          effectiveStat.major.add = (effectiveStat.major.add || 0) + (weaponBonus.add || 0);
        }
        if (effectiveStat.reaction) {
          effectiveStat.reaction.add = (effectiveStat.reaction.add || 0) + (weaponBonus.add || 0);
        }
        if (effectiveStat.dodge) {
          effectiveStat.dodge.add = (effectiveStat.dodge.add || 0) + (weaponBonus.add || 0);
        }
        
        window.DX3rdDebug.log('DX3rd | Applied weapon bonus to stat', {
          originalAdd: stat.add,
          weaponAdd: weaponBonus.add,
          effectiveAdd: effectiveStat.add,
          majorAdd: effectiveStat.major?.add,
          reactionAdd: effectiveStat.reaction?.add,
          dodgeAdd: effectiveStat.dodge?.add,
          weaponName: weaponBonus.weaponName
        });
      }
      const buildBtn = (id, text) => `
        <button class="roll-type-btn" data-roll-type="${id}">${text}</button>`;
      
      // Use the pre-set difficulty when one was given, otherwise the item's own
      let itemDifficulty = '';
      if (predefinedDifficulty) {
        // A pre-set difficulty passed in by a book etc.
        if (predefinedDifficulty.type === 'number') {
          itemDifficulty = String(predefinedDifficulty.value);
        } else {
          itemDifficulty = '';
        }
      } else {
        itemDifficulty = item?.system?.difficulty || '';
      }
      
      // Weapon/vehicle attack? (a previousToken means a weapon attack)
      const isWeaponAttack = item && (item.type === 'weapon' || item.type === 'vehicle') && previousToken !== null;
      
      // Is this an accuracy roll? (weapon/vehicle, combo, effect, psionic — the fear penalty targets these)
      const isAttackRoll = item && (
        (item.type === 'weapon' || item.type === 'vehicle') ||
        (item.system?.attackRoll && item.system.attackRoll !== '-' &&
         (item.system.attackRoll === 'melee' || item.system.attackRoll === 'ranged'))
      );
      
      // Berserk type check (disables the reaction/dodge buttons)
      //
      // This is the **second** site of the [Berserk] gate — the real block lives in
      // universal-handler's processItemUsageCost; here the button is merely disabled. So the gate
      // setting (`allowBerserkViolation`) and the per-item exemption must be honored **here too**.
      // Otherwise the button stays dead even with the setting on, and it reads as "the setting does
      // not work" (the same class of defect as actor-chat not rendering, and chat-ui skipping silently).
      const berserkActive = actor.system?.conditions?.berserk?.active || false;
      const berserkType = actor.system?.conditions?.berserk?.type || '';
      const berserkTypesToBlock = ['normal', 'slaughter', 'battlelust', 'delusion', 'fear', 'hatred'];
      const isReactionDodgeBlocked = berserkActive
        && berserkTypesToBlock.includes(berserkType)
        && window.DX3rdUsageGates?.allows?.('berserk') === false;

      // Exempt item? The decision lives solely in DX3rdUsageGates.conditionExempt, which reads both
      // the item authoring (`system.conditionExempt.berserk`) and the legacy name-list setting.
      const isExceptionItem = isReactionDodgeBlocked && item
        ? window.DX3rdUsageGates?.conditionExempt?.(item, 'berserk') === true
        : false;

      // Fear penalty (accuracy rolls only: weapon/vehicle, combo, effect, psionic)
      let fearPenalty = 0;
      let fearTargetName = '';
      if (isAttackRoll) {
        const fearActive = actor.system?.conditions?.fear?.active || false;
        const fearTarget = actor.system?.conditions?.fear?.target || '';
        
        if (fearActive && fearTarget) {
          // Is the fear target among the current targets?
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
            fearPenalty = -2;
            window.DX3rdDebug.log(`DX3rd | Fear penalty for attack roll: ${fearTarget} is in targets (-2 dice)`);
          }
        }
      }
      
      // Berserk "distaste" penalty (applies to every roll)
      let distastePenalty = 0;
      let distasteTargetNames = [];
      
      // Reuses berserkActive / berserkType, declared above
      const berserkDistaste = berserkActive && berserkType === 'distaste';
      
      if (berserkDistaste) {
        // Find the actor's token
        const actorToken = canvas.tokens.placeables.find(t => t.actor?.id === actor.id);
        if (actorToken) {
          // Adjacent grids
          const adjacentGrids = this.getAdjacentGrids(actorToken);
          
          // Any other token on an adjacent square?
          for (const grid of adjacentGrids) {
            const tokenAtGrid = this.getTokenAtGrid(grid, actorToken);
            if (tokenAtGrid) {
              const adjacentTokenName = tokenAtGrid.actor?.name || tokenAtGrid.name;
              
              // distaste: any adjacent token at all incurs the penalty
              distastePenalty = -10;
              
              // Append, avoiding duplicates
              if (!distasteTargetNames.includes(adjacentTokenName)) {
                distasteTargetNames.push(adjacentTokenName);
              }
              
              window.DX3rdDebug.log(`DX3rd | Berserk distaste penalty: ${adjacentTokenName} is adjacent (-10 add)`);
            }
          }
        }
      }
      
      // Join the token names into a comma-separated string
      const distasteTargetName = distasteTargetNames.join(', ');
      
      // The same dependency penalty (dice -4), recomputed here purely for the dialog display
      let dependencyPenalty = 0;
      
      if (panic8Applied) {
        // Find the actor's token
        const actorToken = canvas.tokens.placeables.find(t => t.actor?.id === actor.id);
        if (actorToken) {
          // Collect the Lois item names
          const roisItems = actor.items.filter(item => item.type === 'rois');
          const roisNames = roisItems.map(item => {
            // Strip ||RubyText from the item name
            let itemName = item.name;
            const rubyPattern = /^(.+)\|\|(.+)$/;
            const match = itemName.match(rubyPattern);
            if (match) {
              itemName = match[1];
            }
            return itemName.trim();
          }).filter(name => name); // drop empty strings
          
          if (roisNames.length > 0) {
            // Engage range = half the token size, rounded up
            const tokenSize = Math.max(actorToken.document.width, actorToken.document.height);
            const engageRange = Math.ceil(tokenSize / 2);
            
            // Grids within engage range
            const engageGrids = this.getGridsInRange(actorToken, engageRange);
            
            // Is there a token actor in engage range whose name matches a Lois item?
            let hasMatchingRoisToken = false;
            for (const grid of engageGrids) {
              const tokenAtGrid = this.getTokenAtGrid(grid, actorToken);
              if (tokenAtGrid && tokenAtGrid.actor) {
                const tokenActorName = tokenAtGrid.actor.name || '';
                // Match against the Lois item names
                if (roisNames.some(roisName => tokenActorName === roisName)) {
                  hasMatchingRoisToken = true;
                  break;
                }
              }
            }
            
            // No matching token → show the -4 dice penalty
            if (!hasMatchingRoisToken) {
              dependencyPenalty = -4;
              window.DX3rdDebug.log(`DX3rd | Panic 8 (Dependency) penalty: No matching Rois token in engage range (-4 dice)`);
            }
          }
        }
      }
      
      // Difficulty display: "reference" uses DX3rd.ReferenceText as the placeholder; urge checks use DX3rd.UrgeDifficulty
      const referenceText = game.i18n.localize('DX3rd.Reference');
      const referenceDisplayText = game.i18n.localize('DX3rd.ReferenceText');
      const isReference = itemDifficulty === referenceText;
      const difficultyValue = isReference ? '' : itemDifficulty;
      let difficultyPlaceholder;
      if (isUrgeTest || isPanicTest) {
        difficultyPlaceholder = game.i18n.localize('DX3rd.UrgeDifficulty');
      } else if (isReference) {
        difficultyPlaceholder = referenceDisplayText;
      } else {
        difficultyPlaceholder = game.i18n.localize('DX3rd.Competition');
      }
      
      // Buttons: only the named one when specificRollType is set, otherwise all of them
      let buttonHtml = '';
      if (specificRollType) {
        // Just the one type
        const typeLabel = game.i18n.localize(`DX3rd.${specificRollType === 'major' ? 'Major' : specificRollType === 'reaction' ? 'Reaction' : 'DodgeRoll'}`);
        buttonHtml = buildBtn(specificRollType, typeLabel);
      } else {
        // All types
        // Should the reaction/dodge buttons be disabled?
        const reactionDisabled = isReactionDodgeBlocked && !isExceptionItem;
        const dodgeDisabled = isReactionDodgeBlocked && !isExceptionItem;
        
        const reactionBtn = reactionDisabled 
          ? `<button class="roll-type-btn" data-roll-type="reaction" disabled style="opacity: 0.5; cursor: not-allowed;">${game.i18n.localize('DX3rd.Reaction')}</button>`
          : buildBtn('reaction', game.i18n.localize('DX3rd.Reaction'));
        
        const dodgeBtn = dodgeDisabled 
          ? `<button class="roll-type-btn" data-roll-type="dodge" disabled style="opacity: 0.5; cursor: not-allowed;">${game.i18n.localize('DX3rd.DodgeRoll')}</button>`
          : buildBtn('dodge', game.i18n.localize('DX3rd.DodgeRoll'));
        
        buttonHtml = `
          ${buildBtn('major', game.i18n.localize('DX3rd.Major'))}
          ${reactionBtn}
          ${dodgeBtn}
        `;
      }
      
      const hasWeaponOrPenalty = weaponBonus || fearPenalty !== 0 || distastePenalty !== 0 || dependencyPenalty !== 0 || paranoiaPenalty !== 0;
      const attackSourceLabel = weaponBonus?.sourceLabel || game.i18n.localize('DX3rd.Weapon');

      // The info line shows **only what this roll actually uses**.
      //  · Attack power is consumed by the damage roll alone — preservedValues is built inside
      //    executeStatRoll's `if (isAttackRoll)`, and a non-attack roll has no damage button at all.
      //    Printing that number beside the pool would read as if it applied to this roll (a combined
      //    value only fires once the effect is combined into an attack).
      //  · Fixed and dice terms are shown together. Printing only the fixed part made a weapon whose
      //    attack is '2d10' read as "attack +0" — indistinguishable from having no value at all.
      const signed = text => (!text || text === '0') ? '+0' : (text.startsWith('-') ? text : `+${text}`);
      const bonusTerms = [];
      if (weaponBonus) {
        if (isAttackRoll) {
          bonusTerms.push(`${game.i18n.localize('DX3rd.Attack')} ${signed(this.joinFormulaTerms(weaponBonus.attack, weaponBonus.attackFormula))}`);
        }
        bonusTerms.push(`${game.i18n.localize('DX3rd.Add')} ${signed(this.joinFormulaTerms(weaponBonus.add, weaponBonus.addFormula))}`);
      }
      
      // The upper field is the final pool and can be edited directly, overriding the computation.
      // The lower field is a modifier added to that computation; touching it clears the override.
      // Dice and critical are integers used to assemble the check formula, so type=number rejects
      // input like "1d10" in the browser (it would otherwise truncate silently to 1).
      // The addition rides into the check roll as a term, so it does accept a dice formula.
      const overrideHint = game.i18n.localize('DX3rd.RollFieldOverrideHint');
      const addHint = game.i18n.localize('DX3rd.RollAddOverrideHint');

      // Equipment of the "declare right before making the accuracy roll" kind is toggled here.
      // Sending the player back to the sheet to click name → "use" would leave the combo attack flow entirely.
      // On an accuracy roll it also offers the attack-power / armor-ignoring kinds — that is exactly
      // when the rules say to declare them, and declaring here means the damage step already sees them.
      // The actual use happens on commit, when the roll button is pressed — closing without rolling spends nothing.
      const declarable = window.DX3rdDeclaredEquipment?.collect(actor, isAttackRoll ? 'attack' : 'roll') || [];
      const declareSectionHtml = window.DX3rdDeclaredEquipment?.sectionHtml(declarable) || '';

      const content = `
        <div class="dx3rd-casting-dialog">
          <div class="dx3rd-row dx3rd-3col">
            <div>
              <div class="label">${game.i18n.localize('DX3rd.Dice')}</div>
              <input type="number" class="dx-dice-display" value="${effectiveStat.dice || 0}" title="${overrideHint}">
              <input type="number" class="dx-dice-input" value="0" placeholder="추가">
            </div>
            <div>
              <div class="label">${game.i18n.localize('DX3rd.Critical')}</div>
              <input type="number" class="dx-critical-display" value="${effectiveStat.critical || defaultCritical}" title="${overrideHint}">
              <input type="number" class="dx-critical-input" value="0" placeholder="수정">
            </div>
            <div>
              <div class="label">${game.i18n.localize('DX3rd.Add')}</div>
              <input type="text" class="dx-add-display" value="${effectiveStat.add || 0}" title="${addHint}">
              <input type="number" class="dx-add-input" value="0" placeholder="추가">
            </div>
          </div>
          ${hasWeaponOrPenalty ? '<hr style="margin: 12px 0; border: none; border-top: 1px solid #ccc;">' : ''}
          ${weaponBonus ? `<div class="dx3rd-mb-4 dx3rd-p-6 dx3rd-text-small dx3rd-bold" style="text-align: center;">
            ${attackSourceLabel}: ${weaponBonus.weaponName} (${bonusTerms.join(', ')})
          </div>` : ''}
          ${fearPenalty !== 0 ? `<div class="dx3rd-mb-4 dx3rd-p-6 dx3rd-text-small dx3rd-bold dx3rd-error" style="text-align: center; color: #ff6b6b;">
            ${game.i18n.localize('DX3rd.Fear')}: ${game.i18n.localize('DX3rd.Dice')} ${fearPenalty} (${game.i18n.localize('DX3rd.Target')}: ${fearTargetName})
          </div>` : ''}
          ${distastePenalty !== 0 ? `<div class="dx3rd-mb-4 dx3rd-p-6 dx3rd-text-small dx3rd-bold dx3rd-error" style="text-align: center; color: #ff6b6b;">
            ${game.i18n.localize('DX3rd.Berserk')}(${game.i18n.localize('DX3rd.UrgeDistaste')}): ${game.i18n.localize('DX3rd.Add')} ${distastePenalty} (${game.i18n.localize('DX3rd.Target')}: ${distasteTargetName})
          </div>` : ''}
          ${dependencyPenalty !== 0 ? `<div class="dx3rd-mb-4 dx3rd-p-6 dx3rd-text-small dx3rd-bold dx3rd-error" style="text-align: center; color: #ff6b6b;">
            ${game.i18n.localize('DX3rd.Panic8')}: ${game.i18n.localize('DX3rd.Dice')} ${dependencyPenalty}
          </div>` : ''}
          ${paranoiaPenalty !== 0 ? `<div class="dx3rd-mb-4 dx3rd-p-6 dx3rd-text-small dx3rd-bold dx3rd-error" style="text-align: center; color: #ff6b6b;">
            ${game.i18n.localize('DX3rd.Madness2')}: ${game.i18n.localize('DX3rd.MajorDice')} ${paranoiaPenalty}
          </div>` : ''}
          ${isWeaponAttack ? '' : `
          <hr style="margin: 12px 0; border: none; border-top: 1px solid #ccc;">
          <div class="dx3rd-row" style="margin-bottom: 8px;">
            <div>
              <div class="label" style="text-align: center;">${game.i18n.localize('DX3rd.Difficulty')}</div>
              <input type="text" class="dx-difficulty" value="${difficultyValue}" placeholder="${difficultyPlaceholder}" style="width: 100%; text-align: center;">
            </div>
          </div>
          `}
          ${declareSectionHtml}
          <hr style="margin: 12px 0; border: none; border-top: 1px solid #ccc;">
          <div class="type-row dx3rd-row ${specificRollType ? 'dx3rd-1col' : 'dx3rd-3col'}" style="margin-top:8px;">
            ${buttonHtml}
          </div>
        </div>`;

      // Urge and panic checks get their own title
      const dialogTitle = isUrgeTest ? game.i18n.localize('DX3rd.UrgeTest') : (isPanicTest ? game.i18n.localize('DX3rd.PanicTest') : label);
      
      const DialogV2 = foundry.applications?.api?.DialogV2;
      if (!DialogV2) {
        ui.notifications.error(game.i18n.localize('DX3rd.DialogV2Unavailable'));
        return;
      }

      const dlg = new DialogV2({
        window: { title: dialogTitle },
        content,
        position: { width: 400 },
        classes: ['dx3rd-emanim', 'dx3rd-rolling-dialog'],
        buttons: [{
          action: 'close',
          label: game.i18n.localize('DX3rd.Close')
        }]
      });
      await dlg.render(true);

      const root = dlg.element;
      if (!root) return;

      const diceDisplay = root.querySelector('.dx-dice-display');
      const diceInput = root.querySelector('.dx-dice-input');
      const critDisplay = root.querySelector('.dx-critical-display');
      const critInput = root.querySelector('.dx-critical-input');
      const addDisplay = root.querySelector('.dx-add-display');
      const addInput = root.querySelector('.dx-add-input');

      // Manual-override state. The display field is the "final pool", so a hand edit replaces the
      // computation (base + modifier + penalties).
      // Switching roll type changes the baseline itself, so the override is discarded.
      const overrides = { dice: null, critical: null, add: null };
      let overrideRollType = null;
      // The roll type last reflected in the display. Kept separately so that when .selected is
      // cleared on hover-out, we still know which type the modifier input is computed against.
      let currentRollType = specificRollType || null;

      const applyDisplay = (el, value, overridden) => {
        if (!el) return;
        // Never overwrite the field being typed in (preserves the caret and partial input).
        if (document.activeElement !== el) el.value = value;
        el.classList.toggle('dx3rd-overridden', overridden);
      };

      // Refresh the displayed values for the selected type
      const updateDisplayValues = (t) => {
        const data = effectiveStat[t] || { dice: effectiveStat.dice||0, critical: effectiveStat.critical||defaultCritical, add: effectiveStat.add||0 };
        const baseDice = data.dice || 0;
        const baseCrit = data.critical || defaultCritical;
        const baseAdd = data.add || 0; // effectiveStat.add already includes the weapon bonus

        if (overrideRollType && overrideRollType !== t) {
          overrides.dice = overrides.critical = overrides.add = null;
          overrideRollType = null;
        }
        currentRollType = t;

        // Read the user's modifier inputs
        const diceModifier = parseInt(diceInput?.value) || 0;
        const critModifier = parseInt(critInput?.value) || 0;
        const addModifier = parseInt(addInput?.value) || 0;

        // base + input + fear penalty (the dependency penalty is already inside effectiveStat.dice)
        // Rules (rule-section:39-41): show the real pool as-is (0 or less foreshadows the auto-fail). No clamping.
        const finalDice = overrides.dice ?? (baseDice + diceModifier + fearPenalty);
        const finalCrit = overrides.critical ?? (baseCrit + critModifier);
        const finalAdd = overrides.add ?? (baseAdd + addModifier + distastePenalty);

        applyDisplay(diceDisplay, finalDice, overrides.dice !== null);
        applyDisplay(critDisplay, finalCrit, overrides.critical !== null);
        applyDisplay(addDisplay, finalAdd, overrides.add !== null);

        return { finalDice, finalCrit, finalAdd };
      };

      // Refresh the display whenever an input changes
      const updateSelectedDisplay = () => {
        const t = root.querySelector('.roll-type-btn.selected')?.dataset.rollType || currentRollType;
        if (t) updateDisplayValues(t);
      };
      // Touching a modifier field means "go back to the computed value", so its override is cleared.
      const bindModifier = (el, key) => el?.addEventListener('input', () => {
        overrides[key] = null;
        updateSelectedDisplay();
      });
      bindModifier(diceInput, 'dice');
      bindModifier(critInput, 'critical');
      bindModifier(addInput, 'add');

      // Declaring equipment attaches a self-modifier AE to the actor, but effectiveStat is a snapshot
      // from when the dialog opened and does not follow along (the encroachment/fear/berserk penalties
      // are subtracted inline across some 140 lines, so it cannot simply be rederived). Hence only the
      // **difference** before and after the declaration is layered on. The original stat's source is
      // recovered two ways: ① reference identity — most callers pass actor.system.attributes[...]
      //   straight through, and prepareData replaces the object, so the path must be found **beforehand**.
      //   ② resolveComboStat — the fallback for callers that assemble a new object (a custom base).
      const statPath = (() => {
        const attrs = actor?.system?.attributes || {};
        for (const [key, value] of Object.entries(attrs)) {
          if (value === stat) return () => actor.system?.attributes?.[key];
        }
        for (const [key, value] of Object.entries(attrs.skills || {})) {
          if (value === stat) return () => actor.system?.attributes?.skills?.[key];
        }
        return null;
      })();
      const rereadStat = () => {
        const byPath = statPath?.();
        if (byPath) return byPath;
        if (!item) return null;
        try {
          return window.DX3rdComboHandler?.resolveComboStat?.(actor, item)?.stat || null;
        } catch (error) {
          window.DX3rdDebug.log('DX3rd | 선언 후 판정치 재도출 실패:', error);
          return null;
        }
      };
      // The pool as of just before committing. Every delta is measured from here, so repeated commits accumulate.
      const statBeforeDeclare = foundry.utils.deepClone(stat);
      const applyDeclaredDelta = () => {
        const fresh = rereadStat();
        if (!fresh) {
          window.DX3rdDebug.log('DX3rd | 선언 보정을 표시에 반영하지 못했다(판정치 출처 불명) — 굴림 자체는 정상.');
          return;
        }
        const bump = (targetNode, freshNode, baseNode) => {
          if (!targetNode || !freshNode || !baseNode) return;
          for (const key of ['dice', 'add', 'critical']) {
            const delta = (Number(freshNode[key]) || 0) - (Number(baseNode[key]) || 0);
            if (delta) targetNode[key] = (Number(targetNode[key]) || 0) + delta;
          }
        };
        bump(effectiveStat, fresh, statBeforeDeclare);
        for (const rollKey of ['major', 'reaction', 'dodge']) {
          bump(effectiveStat[rollKey], fresh[rollKey], statBeforeDeclare[rollKey]);
        }
        // Move the baseline forward, so a second declaration does not re-add the first one's share.
        foundry.utils.mergeObject(statBeforeDeclare, foundry.utils.deepClone(fresh), {inplace: true});
        updateSelectedDisplay();
      };
      const declareControl = window.DX3rdDeclaredEquipment?.bind(root, actor);

      /**
       * Actually use the toggled equipment and fold its bonuses into the display and the roll.
       * Must run **before** the roll button reads the values, or the bonus misses this check.
       */
      const commitDeclarations = async () => {
        if (!declareControl?.hasPending?.()) return;
        const applied = await declareControl.commit();
        if (applied.length) applyDeclaredDelta();
      };

      // Editing a display field overrides the final pool (clearing it returns to the computed value).
      // allowFormula: a non-integer addition is treated as a dice formula and kept as a string
      //   (it rides into the check roll as a term, so "3+1d10" can extend the existing value).
      const bindOverride = (el, key, allowFormula = false) => {
        if (!el) return;
        el.addEventListener('input', () => {
          const raw = el.value.trim();
          if (raw === '') {
            overrides[key] = null;
          } else if (/^[+-]?\d+$/.test(raw)) {
            overrides[key] = Number(raw);
            overrideRollType = currentRollType;
          } else if (allowFormula) {
            overrides[key] = raw; // validated on blur / at roll time (never warn mid-typing)
            overrideRollType = currentRollType;
          } else {
            return; // ignore intermediate states, e.g. a lone '-'
          }
          updateSelectedDisplay();
        });
        // On blur, normalize the display to the value actually in effect. Otherwise the field can
        // show '-' while the roll uses the computed value, and the mismatch stays invisible.
        el.addEventListener('blur', () => {
          if (typeof overrides[key] === 'string' && !Roll.validate(overrides[key])) {
            ui.notifications.warn(`${game.i18n.localize('DX3rd.RollAddFormulaInvalid')}: ${overrides[key]}`);
            overrides[key] = null;
          }
          updateSelectedDisplay();
        });
      };
      bindOverride(diceDisplay, 'dice');
      bindOverride(critDisplay, 'critical');
      bindOverride(addDisplay, 'add', true);

      const btns = Array.from(root.querySelectorAll('.roll-type-btn'));

      // Enter in an input would press DialogV2's default button (close) and throw the roll away.
      // Now that the fields are editable, Enter means "roll with the type currently displayed".
      for (const el of [diceDisplay, diceInput, critDisplay, critInput, addDisplay, addInput,
                        root.querySelector('.dx-difficulty')]) {
        el?.addEventListener('keydown', ev => {
          if (ev.key !== 'Enter') return;
          ev.preventDefault();
          const target = btns.find(b => b.dataset.rollType === currentRollType && !b.disabled) || btns.find(b => !b.disabled);
          target?.click();
        });
      }

      // With only one type available, select and display it automatically
      if (specificRollType && btns.length === 1) {
        btns[0].classList.add('selected');
        updateDisplayValues(specificRollType);
      } else {
        // On open, initialize from the first button's defaults
        const firstBtn = btns[0];
        if (firstBtn) {
          firstBtn.classList.add('selected');
          updateDisplayValues(firstBtn.dataset.rollType);
        }
      }

      const hoverIn = ev => {
        const btn = ev.currentTarget;
        btns.forEach(other => other.classList.remove('selected'));
        btn.classList.add('selected');
        updateDisplayValues(btn.dataset.rollType);
      };
      const hoverOut = () => {
        btns.forEach(btn => btn.classList.remove('selected'));
        // Keep the last selected type on hover-out (do not reset it)
      };
      btns.forEach(btn => {
        btn.addEventListener('mouseenter', hoverIn);
        btn.addEventListener('mouseleave', hoverOut);
        btn.addEventListener('click', async ev => {
            const t = ev.currentTarget.dataset.rollType;

            // The toggled declaration equipment is actually used here. It has to finish before the
            // values are read, or its bonus misses this roll. Just closing never reaches here, so nothing is spent.
            await commitDeclarations();

            // The displayed value IS the final pool: modifiers, penalties and manual overrides are all in it.
            // Rules (rule-section:39-41): pass the raw pool through unclamped — the roll executor auto-fails at 0 or less
            const values = updateDisplayValues(t);
            const finalDice = values.finalDice;
            const finalCrit = Math.max(2, values.finalCrit);
            const finalAdd = values.finalAdd;

            // A dice formula typed into the addition and rolled without blurring (via Enter, say).
            // A broken formula fails the whole roll, so stop here rather than silently rolling something else.
            if (typeof finalAdd === 'string' && !Roll.validate(finalAdd)) {
              ui.notifications.warn(`${game.i18n.localize('DX3rd.RollAddFormulaInvalid')}: ${finalAdd}`);
              return;
            }

            window.DX3rdDebug.log('DX3rd | Roll button clicked - values:', {
              rollType: t,
              finalDice,
              finalCrit,
              finalAdd,
              overrides,
              fearPenalty
            });
            
            // Is this an attack roll? (a weapon/vehicle type, or attackRoll of melee/ranged)
            const isAttackRoll = item && (
              ((item.type === 'weapon' || item.type === 'vehicle') && previousToken !== null) ||
              (item.system?.attackRoll && 
               item.system.attackRoll !== '-' && 
               (item.system.attackRoll === 'melee' || item.system.attackRoll === 'ranged'))
            );
            
            // Weapon/vehicle attacks take their own path (no difficulty)
            if (item && (item.type === 'weapon' || item.type === 'vehicle') && previousToken !== null) {
              await this.executeAttackRoll(actor, item, label, previousToken, finalDice, finalCrit, finalAdd, weaponBonus, effectiveStat.rollFormula, t, sourceMessage);
            } else if (isAttackRoll) {
              // attackRoll of melee/ranged is handled as an attack roll (no difficulty)
              // Is this a temporary combo started from a weapon item?
              const originalWeaponItem = item._originalWeaponItem || null;
              
              if (originalWeaponItem && previousToken === null) {
                // With an original weapon and no previousToken, run executeAttackRoll on that weapon
                const weaponToken = canvas.tokens?.placeables.find(t => t.actor?.id === actor.id);
                if (weaponToken) {
                  weaponToken.control({ releaseOthers: true });
                  dlg.close();
                  await this.executeAttackRoll(actor, originalWeaponItem, label, weaponToken, finalDice, finalCrit, finalAdd, weaponBonus, effectiveStat.rollFormula, t, sourceMessage);
                  return;
                }
              }
              
              // An attack roll that does not go through executeAttackRoll (combos, effects, …):
              // call executeStatRoll with no difficulty
              const difficultyData = { type: 'none', value: 0 };
              await this.executeStatRoll(actor, finalDice, finalCrit, finalAdd, label, t, difficultyData, item, previousToken, weaponBonus, comboAfterSuccessData, comboAfterDamageData, false, null, false, effectiveStat.rollFormula, sourceMessage);
            } else {
              // Ordinary check: resolve the difficulty
              const difficultyInput = root.querySelector('.dx-difficulty')?.value.trim() || '';
              
              // Difficulty is mandatory here
              if (requireDifficulty && !difficultyInput) {
                ui.notifications.warn('목표 난이도를 입력해주세요.');
                return;
              }
              
              let difficultyData = { type: 'competition', value: 0 }; // default: a contest
              
              if (difficultyInput) {
                // Numeric?
                const numValue = parseInt(difficultyInput);
                if (!isNaN(numValue) && numValue > 0) {
                  // Numeric difficulty
                  difficultyData = { type: 'number', value: numValue };
                } else {
                  // Anything else (including empty, or the word for "contest"): a contest
                  difficultyData = { type: 'competition', value: 0 };
                }
              }
              
              // When a difficulty is mandatory, only a number is accepted
              if (requireDifficulty && difficultyData.type !== 'number') {
                ui.notifications.warn('목표 난이도는 숫자로 입력해주세요.');
                return;
              }
              
              await this.executeStatRoll(actor, finalDice, finalCrit, finalAdd, label, t, difficultyData, item, previousToken, weaponBonus, comboAfterSuccessData, comboAfterDamageData, isUrgeTest, afterRollCallback, isPanicTest, effectiveStat.rollFormula, sourceMessage);
            }
            dlg.close();
        });
      });
    },

    /**
     * Execute an attribute/skill check
     * @param {Actor} actor - the actor
     * @param {number} dice - dice count
     * @param {number} critical - critical value
     * @param {number} add - flat addition
     * @param {string} label - the label to display
     * @param {string} rollType - 'major', 'reaction', 'dodge'
     * @param {Object} difficultyData - { type: 'none'|'number'|'competition', value: number }
     * @param {Item} item - the item (optional)
     * @param {Token} previousToken - the previously selected token (optional)
     * @param {Object} comboAfterSuccessData - the combo's afterSuccess payload (optional)
     */
    async executeStatRoll(actor, dice, critical, add, label, rollType, difficultyData = { type: 'none', value: 0 }, item = null, previousToken = null, weaponBonus = null, comboAfterSuccessData = null, comboAfterDamageData = null, isUrgeTest = false, afterRollCallback = null, isPanicTest = false, statRollFormula = null, sourceMessage = null) {
      const typeLabelMap = {
        major: game.i18n.localize('DX3rd.Major'),
        reaction: game.i18n.localize('DX3rd.Reaction'),
        dodge: game.i18n.localize('DX3rd.DodgeRoll')
      };
      const typeText = typeLabelMap[rollType] || '';
      let flavorText = '';
      const isEquipmentAttack = !!item && ['weapon', 'vehicle'].includes(item.type);
      
      // Urge check
      if (isUrgeTest) {
        flavorText = `${game.i18n.localize('DX3rd.UrgeTest')} - ${label}${typeText ? `(${typeText})` : ''}`;
      } else if (isPanicTest) {
        // Panic check
        flavorText = `${game.i18n.localize('DX3rd.PanicTest')} - ${label}${typeText ? `(${typeText})` : ''}`;
      } else if (item) {
        // With an item: show the skill (and timing); the item-use message already went out.
        // Attack effects (those with attackRoll set) also name which effect made the attack.
        const isAtkRoll = isEquipmentAttack || (item.system?.attackRoll && item.system.attackRoll !== '-');
        const namePrefix = isAtkRoll && item.name ? `${item.name} — ` : '';
        flavorText = `${namePrefix}${label}${typeText ? `(${typeText})` : ''}`;
      } else {
        // Plain attribute/skill check
        flavorText = `${label}${typeText ? `(${typeText})` : ''}`;
      }
      
      // Append the difficulty to the flavor line
      if (difficultyData.type === 'number') {
        flavorText += ` / ${game.i18n.localize('DX3rd.Difficulty')}: ${difficultyData.value}`;
      } else if (difficultyData.type === 'competition') {
        flavorText += ` / ${game.i18n.localize('DX3rd.Difficulty')}: ${game.i18n.localize('DX3rd.Competition')}`;
      }
      
      // Append the weapon bonus on its own line
      if (weaponBonus) {
        flavorText += `<br>${weaponBonus.sourceLabel || game.i18n.localize('DX3rd.Weapon')}: ${weaponBonus.weaponName}`;
      }
      
      try {
        // Weapon bonus (null counts as zero)
        const effectiveWeaponBonus = weaponBonus || { attack: 0, add: 0 };
        
        // For an attack roll, freeze the values as of now
        let preservedValues = null;
        // A direct weapon/vehicle attack does not use the system.attackRoll field — it arrives at
        // showStatRollDialog through system.skill. Testing attackRoll alone would route a real
        // equipment attack to a plain major-check card, losing the damage button with it.
        const authoredAttackRoll = item?.system?.attackRoll;
        const isAttackRoll = !!item && (
          isEquipmentAttack
          || (authoredAttackRoll !== '-' && (authoredAttackRoll === 'melee' || authoredAttackRoll === 'ranged'))
        );
        
        if (isAttackRoll) {
          // The fist bonus is decided from the weapon name chosen via weapon-for-attack.
          // The penetrate dice are rolled now, at accuracy time, and frozen into a number.
          const bonuses = await this.resolveAttackBonusesRolled(actor, item, {
            attackType: isEquipmentAttack
              ? (item.type === 'weapon' ? item.system?.type : 'vehicle')
              : authoredAttackRoll,
            fistWeaponName: weaponBonus?.weaponName || ''
          });

          preservedValues = {
            actorAttack: bonuses.actorAttack,
            actorAttackFormula: bonuses.actorAttackFormula,
            actorPenetrate: bonuses.actorPenetrate,
            // The weapon's attack dice formula is preserved until damage is settled.
            // The fixed value (attack) and the dice formula (attackFormula) are **separate**
            // components in mergeAttackBonuses. Taking only one (the old `attackFormula || attack`)
            // dropped the fixed part entirely when a fixed-attack effect met a dice-attack weapon.
            // The addition already carries both: fixed via effectiveStat.add, dice as a check-roll term.
            weaponAttackFormula: this.joinFormulaTerms(effectiveWeaponBonus.attack, effectiveWeaponBonus.attackFormula)
          };
        }
        
        // Dice formulas deferred during derivation are rolled exactly once, now that the button was pressed.
        // References like [body]/[melee]/[level] were substituted with the actor's values back in prepareData.
        const actionProfile = actor.system.attributes.actionRollFormula || {};
        const typedProfile = actionProfile[rollType] || {};
        const buildActionFormula = (kind) =>
          [actionProfile[kind], typedProfile[kind], statRollFormula?.[kind]].filter(Boolean).join(' + ');
        const rollActionFormula = async (kind) => {
          const formula = buildActionFormula(kind);
          if (!formula) return { total: 0, text: '' };
          try {
            const result = await (new Roll(formula)).evaluate();
            return { total: Number(result.total) || 0, text: `${kind}: ${formula} → ${result.total}` };
          } catch (error) {
            console.warn(`DX3rd | stat roll formula failed (${kind}): ${formula}`, error);
            ui.notifications.warn(`${game.i18n.localize('DX3rd.DamageRollFormulaInvalid')}: ${formula}`);
            return { total: 0, text: `${kind}: ${formula} → 0` };
          }
        };
        // Only dice count and critical are pre-rolled (the check formula needs their values). The
        // addition's dice formula is not rolled; it rides below as a term, so the card shows "10dx7 + 10d10".
        const [formulaDice, formulaCritical] = await Promise.all([
          rollActionFormula('dice'), rollActionFormula('critical')
        ]);
        const addDiceFormula = this.validateRollTerm(buildActionFormula('add'), 'add');
        dice += formulaDice.total;
        critical = Math.max(2, critical + formulaCritical.total);
        // The chat card shows only the final DX3rd check formula. The expanded auxiliary formulas
        // are already folded into the pool, so they are not repeated on a line of their own.

        // Roll the dice (the encroachment rise was already handled by EffectHandler)
        // Rules (rule-section:39-41): a modified pool of 0 or less auto-fails (achievement 0).
        // At least one die is still rolled for the animation; the result is forced to 0 below.
        const autoFailByPool = dice <= 0;
        const finalDice = Math.max(1, dice);
        const add2 = add;
        // Combo/effect attacks keep the weapon's accuracy dice inside this same check roll.
        const weaponAddFormula = weaponBonus?.addFormula;
        const rollFormula = [`${finalDice}dx${critical}`, String(add2),
          addDiceFormula, weaponAddFormula].filter(Boolean).join(' + ');
        const roll = await (new Roll(rollFormula)).roll();
        const rollHtml = await roll.render();

        // Rules: every check die showing 1 is a fumble → auto-fail, achievement 0.
        // When the dx dice term raises its fumble flag, skill level and add2 are ignored and the total is 0.
        // Rules (rule-section:39-41): a pool of 0 or less auto-fails the same way, achievement 0.
        const isFumble = roll.terms.some(t => t?.fumble === true);
        const rollResult = (autoFailByPool || isFumble) ? 0 : roll.total;
        if (autoFailByPool) {
          flavorText += `<br>${game.i18n.localize('DX3rd.PoolZero')} — ${game.i18n.localize('DX3rd.TestFailure')}`;
        } else if (isFumble) {
          flavorText += `<br>${game.i18n.localize('DX3rd.Fumble')} — ${game.i18n.localize('DX3rd.TestFailure')}`;
        }

        // On an attack roll, resolve enemy evasion here — the roll result is known by this point
        if (isAttackRoll) {
          const targets = Array.from(game.user.targets);
          if (targets.length > 0) {
            const targetDisplayNames = [];
            let hasEvasionTarget = false;
            
            for (const target of targets) {
              const targetActor = target.actor;
              const targetName = targetActor?.name || target.name;
              if (!targetName) continue;
              
              // For an enemy target with evasion enabled
              if (targetActor && targetActor.type === 'enemy') {
                const evasionDisabled = targetActor.system?.attributes?.evasion?.disabled;
                const evasionValue = targetActor.system?.attributes?.evasion?.value;
                
                if (evasionDisabled === false && evasionValue !== undefined && evasionValue !== null) {
                  hasEvasionTarget = true;
                  const evasionNum = Number(evasionValue) || 0;
                  const isHit = rollResult > evasionNum;
                  const resultText = isHit 
                    ? `${game.i18n.localize('DX3rd.Hit')}: ${game.i18n.localize('DX3rd.Evasion')} ${evasionNum}`
                    : `${game.i18n.localize('DX3rd.Failure')}: ${game.i18n.localize('DX3rd.Evasion')} ${evasionNum}`;
                  targetDisplayNames.push(`${targetName}(${resultText})`);
                } else {
                  targetDisplayNames.push(targetName);
                }
              } else {
                targetDisplayNames.push(targetName);
              }
            }
            
            if (targetDisplayNames.length > 0) {
              flavorText += `<br>· ${game.i18n.localize('DX3rd.Target')}: ${targetDisplayNames.join(', ')}`;
            }
          }
        }
        
        // Result text and buttons
        let resultContent = '';
        
        if (isAttackRoll) {
          // Attack roll: keep both the accuracy and damage buttons, so either step can be re-rolled.
          const weaponIdsStr = weaponBonus?.weaponIds ? weaponBonus.weaponIds.join(',') : '';
          resultContent = `
            ${this.renderAttackRollButton(actor, item, {repeatable: true})}
            <button class="damage-roll-btn"
                    data-actor-id="${actor.id}"
                    data-item-id="${item ? item.id : ''}"
                    data-roll-result="${rollResult}"
                    data-preserved-actor-attack="${preservedValues.actorAttack}"
                    data-preserved-actor-attack-formula="${encodeURIComponent(preservedValues.actorAttackFormula || '')}"
                    data-preserved-actor-penetrate="${preservedValues.actorPenetrate}"
                    data-preserved-attack-formula="${encodeURIComponent(preservedValues.weaponAttackFormula)}"
                    data-weapon-ids="${weaponIdsStr}">
              ${game.i18n.localize('DX3rd.DamageRoll')}
            </button>
          `;
        } else if (difficultyData.type === 'number') {
          // Numeric difficulty: success/failure plus a button (a fumble makes rollResult 0, so it auto-fails)
          const isSuccess = rollResult >= difficultyData.value;
          
          if (isSuccess) {
            const itemName = item ? item.name.split('||')[0].replace(/\[DX3rd\.\w+\]/g, '').trim() : '';
            const isBook = item && item.type === 'book';
            const isConnection = item && item.type === 'connection';
            
            // Book: show the success message and open the spell picker straight away
            if (isBook) {
              resultContent = `<div class="dx3rd-result-success dx3rd-mt-8">${game.i18n.localize('DX3rd.TestSuccess')}</div>`;
              
              // Auto-open the spell picker
              setTimeout(async () => {
                if (window.DX3rdBookHandler && window.DX3rdBookHandler.showSpellSelectionDialog) {
                  await window.DX3rdBookHandler.showSpellSelectionDialog(actor, item);
                }
              }, 100);
            } else if (isConnection) {
              // Connection: just the success message
              resultContent = `<div class="dx3rd-result-success dx3rd-mt-8">${game.i18n.localize('DX3rd.TestSuccess')}</div>`;
            } else {
              // Ordinary item: show the activation button
              const buttonText = item ? `${itemName} ${game.i18n.localize('DX3rd.Invoking')}` : game.i18n.localize('DX3rd.Success');
              resultContent = `
                <div class="item-actions dx3rd-mt-8">
                  <button class="dx3rd-success-btn" 
                          data-actor-id="${actor.id}"
                          data-item-id="${item ? item.id : ''}"
                          data-previous-token-id="${previousToken ? previousToken.id : ''}"
                          data-roll-result="${rollResult}"
                          data-label="${label}"
                          data-roll-type="${rollType}"
                          data-weapon-attack="0"
                          data-is-book="${isBook}">
                    ${buttonText}
                  </button>
                </div>
              `;
            }
          } else {
            resultContent = `<div class="dx3rd-result-failure">${game.i18n.localize('DX3rd.TestFailure')}</div>`;
          }
        } else if (difficultyData.type === 'competition') {
          // Contest: a win-check button
          const itemName = item ? item.name.split('||')[0].replace(/\[DX3rd\.\w+\]/g, '').trim() : '';
          const buttonText = item ? `${itemName} ${game.i18n.localize('DX3rd.Invoking')}` : game.i18n.localize('DX3rd.WinCheck');
          resultContent = `
            <div class="item-actions" style="margin-top: 8px;">
              <button class="dx3rd-win-check-btn"
                      data-actor-id="${actor.id}"
                      data-item-id="${item ? item.id : ''}"
                      data-previous-token-id="${previousToken ? previousToken.id : ''}"
                      data-roll-result="${rollResult}"
                      data-label="${label}"
                      data-roll-type="${rollType}"
                      data-weapon-attack="0">
                ${buttonText}
              </button>
            </div>
          `;
        }
        
        // The flavor line goes straight into the content
        const content = isAttackRoll
          ? this.renderAttackChatCard({
              actor,
              item,
              flavorText: `<div class="flavor-text">${flavorText}</div>`,
              rollHtml,
              actionContent: resultContent
            })
          : `
            <div class="dx3rd-item-chat">
              <div class="flavor-text">${flavorText}</div>
              ${rollHtml}
              ${resultContent}
            </div>
          `;
        
        // Create the chat message (the combo afterSuccess payload rides in the flags)
        const messageData = {
          speaker: {
            actor: actor.id,
            alias: actor.name
          },
          content: content
        };
        
        // Only initialize flags when there is combo afterSuccess/afterDamage data, or a temp combo
        if (comboAfterSuccessData || comboAfterDamageData || window.DX3rdIsInstantCombo?.(item)) {
          messageData.flags = {
            'dx3rd-emanim': {}
        };
        
        // Store the combo afterSuccess / afterDamage payloads in the flags
          if (comboAfterSuccessData) {
            messageData.flags['dx3rd-emanim'].comboAfterSuccess = {
              actorId: actor.id,
              comboItemId: item?.id || null,
              ...comboAfterSuccessData
            };
          }
          
          if (comboAfterDamageData) {
            messageData.flags['dx3rd-emanim'].comboAfterDamage = {
              actorId: actor.id,
              comboItemId: item?.id || null,
              ...comboAfterDamageData
            };
          }
          
          // For a temporary combo, stash the item data
          if (window.DX3rdIsInstantCombo?.(item)) {
            messageData.flags['dx3rd-emanim'].tempComboItem = window.DX3rdSerializeInstantCombo(item);
          }
        }
        
        let attackMessage;
        if (sourceMessage && isAttackRoll) {
          const flagUpdates = {};
          const systemFlags = messageData.flags?.['dx3rd-emanim'] || {};
          for (const [key, value] of Object.entries(systemFlags)) {
            flagUpdates[`flags.dx3rd-emanim.${key}`] = value;
          }
          await sourceMessage.update({
            content,
            rolls: [roll.toJSON()],
            'flags.dx3rd-emanim.pendingAttackRoll': false,
            'flags.dx3rd-emanim.attackRollCompleted': false,
            ...flagUpdates
          });
          attackMessage = sourceMessage;
        } else {
          attackMessage = await ChatMessage.create(messageData);
        }
        // A failed urge check applies [Berserk] (after the message goes out)
        if (isUrgeTest && difficultyData.type === 'number') {
          // Rules: a fumble is an auto-fail, regardless of the roll.total that still carries skill level and modifiers.
          // Rules (rule-section:39-41): a pool of 0 or less auto-fails too → the urge check fails and grants [Berserk].
          const isSuccess = !autoFailByPool && !isFumble && roll.total >= difficultyData.value;
          if (!isSuccess) {
            // Set up the berserk application (specialTarget null makes the dialog appear)
            if (!window.DX3rdConditionTriggerMap) {
              window.DX3rdConditionTriggerMap = new Map();
            }
            const key = `${actor.id}:berserk`;
            window.DX3rdConditionTriggerMap.set(key, {
              trigger: game.i18n.localize('DX3rd.UrgeTest'),
              specialTarget: null, // null makes the dialog appear
              suppressMessage: false
            });
            
            // Find the token
            let actorToken = actor.token;
            if (!actorToken && canvas.scene) {
              const tokenDoc = canvas.scene.tokens.find(t => t.actorId === actor.id);
              if (tokenDoc) {
                actorToken = tokenDoc.object;
              }
            }
            
            // Apply [Berserk] (the dialog is shown)
            if (actorToken) {
              await actorToken.actor.toggleStatusEffect("berserk", { active: true });
            } else if (actor) {
              // No token: apply straight to the actor
              await actor.toggleStatusEffect("berserk", { active: true });
            }
            
            // Clear the map entry
            window.DX3rdConditionTriggerMap.delete(key);
          }
        }
        
        // Panic-effect handler
        const applyPanicEffect = async (panicNumber, { messageKey, rolls = [] } = {}) => {
          if (messageKey) {
            const panicEffectSpeaker = window.DX3rdRuntimeUtils.getActorOnlySpeaker(actor);
            const panicLabel = game.i18n.localize(`DX3rd.Panic${panicNumber}`);
            const panicMessageContent = `
              <div class="dx3rd-item-chat">
                <div>
                  ${game.i18n.localize(messageKey)}: ${panicLabel}
                </div>
              </div>
            `;
            await ChatMessage.create({
              content: panicMessageContent,
              speaker: panicEffectSpeaker
            });
            if (rolls.length > 0) {
              await ChatMessage.create({
                speaker: panicEffectSpeaker,
                rolls
              });
            }
          }
          // Find the token (same way as the failed urge check)
          let actorToken = actor.token;
          if (!actorToken && canvas.scene) {
            const tokenDoc = canvas.scene.tokens.find(t => t.actorId === actor.id);
            if (tokenDoc) {
              actorToken = tokenDoc.object;
            }
          }
          const targetActor = actorToken ? actorToken.actor : actor;
          const panicTrigger = game.i18n.localize('DX3rd.PanicTest');
          
          const applyConditionViaMap = async (conditionId, payload) => {
            if (!window.DX3rdConditionTriggerMap) window.DX3rdConditionTriggerMap = new Map();
            const key = `${actor.id}:${conditionId}`;
            window.DX3rdConditionTriggerMap.set(key, { ...payload, suppressMessage: false });
            if (targetActor) await targetActor.toggleStatusEffect(conditionId, { active: true });
            window.DX3rdConditionTriggerMap.delete(key);
          };
          
          switch (panicNumber) {
            case 1:
              // Panic 1: Rigor + Pressure
              await applyConditionViaMap("rigor", { trigger: panicTrigger, specialTarget: null });
              await applyConditionViaMap("pressure", { trigger: panicTrigger, specialTarget: null });
              break;
            case 3:
              // Panic 3: Rigor
              await applyConditionViaMap("rigor", { trigger: panicTrigger, specialTarget: null });
              break;
            case 4:
              // Panic 4: Pressure
              await applyConditionViaMap("pressure", { trigger: panicTrigger, specialTarget: null });
              break;
            case 2:
              // Panic 2: Flight — an applied effect (dice -2)
              await window.DX3rdAppliedEffects.set(actor, 'Panic2', {
                name: game.i18n.localize('DX3rd.PanicType') + ': ' + game.i18n.localize('DX3rd.Panic2'),
                description: game.i18n.localize('DX3rd.PanicText2'),
                attributes: { dice: -2 },
                disable: 'scene'
              });
              break;
            case 7:
              // Panic 7: Hallucination — an applied effect (dice -2)
              await window.DX3rdAppliedEffects.set(actor, 'Panic7', {
                name: game.i18n.localize('DX3rd.PanicType') + ': ' + game.i18n.localize('DX3rd.Panic7'),
                description: game.i18n.localize('DX3rd.PanicText7'),
                attributes: { dice: -2 },
                disable: 'scene'
              });
              break;
            case 8:
              // Panic 8: Dependency — an applied effect only
              await window.DX3rdAppliedEffects.set(actor, 'Panic8', {
                name: game.i18n.localize('DX3rd.PanicType') + ': ' + game.i18n.localize('DX3rd.Panic8'),
                description: game.i18n.localize('DX3rd.PanicText8'),
                attributes: {},
                disable: 'scene'
              });
              break;
            case 5:
              // Panic 5: Berserk + Fear
              await applyConditionViaMap("berserk", { trigger: panicTrigger, specialTarget: null });
              await applyConditionViaMap("fear", { trigger: panicTrigger, specialTarget: null });
              break;
            case 6:
              // Panic 6: Poisoned (rank 2)
              await applyConditionViaMap("poisoned", { trigger: panicTrigger, poisonedRank: 2, specialTarget: null });
              break;
            case 9:
              // Panic 9: Fear
              await applyConditionViaMap("fear", { trigger: panicTrigger, specialTarget: null });
              break;
            case 10:
              // Panic 10: Berserk
              await applyConditionViaMap("berserk", { trigger: panicTrigger, specialTarget: null });
              break;
          }
        };
        
        // A failed panic check opens the panic/madness pick-or-roll dialog (after the message goes out)
        if (isPanicTest && difficultyData.type === 'number') {
          // Rules: a fumble is an auto-fail, regardless of the roll.total that still carries skill level and modifiers.
          // Rules (rule-section:39-41): a pool of 0 or less auto-fails too → the panic failure effect / madness applies.
          const isSuccess = !autoFailByPool && !isFumble && roll.total >= difficultyData.value;
          if (!isSuccess) {
            // Check the encroachment rate
            const encroachmentValue = Number(actor.system?.attributes?.encroachment?.value) || 0;
            const isMadness = encroachmentValue >= 80;
            
            if (isMadness) {
              // Encroachment 80 or above: apply a madness effect
              const madnessChoice = await new Promise((resolve) => {
                const dialog = document.createElement("div");
                dialog.id = "dx3rd-madness-effect-dialog";
                dialog.className = "dx3rd-urge-dialog";
                
                // Keyboard handling (Enter / Escape)
                const keyHandler = (ev) => {
                  if (ev.key === "Escape") {
                    ev.preventDefault();
                    ev.stopPropagation();
                    document.removeEventListener("keydown", keyHandler);
                    dialog.remove();
                    resolve(null);
                  }
                };
                
                const onSelect = (selection) => {
                  document.removeEventListener("keydown", keyHandler);
                  dialog.remove();
                  resolve(selection);
                };
                
                dialog.innerHTML = `
                  <div class="dx3rd-urge-dialog-title">${game.i18n.localize("DX3rd.PanicTest")} ${game.i18n.localize("DX3rd.Failure")}</div>
                  <div class="dx3rd-urge-dialog-buttons">
                    <button 
                      id="dx3rd-madness-select-button" 
                      class="dx3rd-urge-dialog-button"
                    >${game.i18n.localize("DX3rd.MadnessSelect")}</button>
                    <button 
                      id="dx3rd-madness-roll-button" 
                      class="dx3rd-urge-dialog-button"
                    >${game.i18n.localize("DX3rd.MadnessRoll")}</button>
                    <hr class="dx3rd-urge-dialog-divider">
                    <button 
                      id="dx3rd-madness-cancel-button" 
                      class="dx3rd-urge-dialog-button dx3rd-urge-dialog-cancel"
                    >${game.i18n.localize("DX3rd.Cancel")}</button>
                  </div>
                `;
                
                document.body.appendChild(dialog);
                document.addEventListener("keydown", keyHandler);
                
                dialog.querySelector("#dx3rd-madness-select-button").addEventListener("click", () => onSelect("select"));
                dialog.querySelector("#dx3rd-madness-roll-button").addEventListener("click", () => onSelect("roll"));
                dialog.querySelector("#dx3rd-madness-cancel-button").addEventListener("click", () => onSelect(null));
              });
              
              /** Shared madness application (used by both the pick and the roll paths). */
              const applyMadnessEffect = async (actor, madnessNumber, { messageKey, rolls = [] }) => {
                const madnessEffectSpeaker = window.DX3rdRuntimeUtils.getActorOnlySpeaker(actor);
                const madnessLabel = game.i18n.localize(`DX3rd.Madness${madnessNumber}`);
                const madnessMessageContent = `
                  <div class="dx3rd-item-chat">
                    <div>
                      ${game.i18n.localize(messageKey)}: ${madnessLabel}
                    </div>
                  </div>
                `;
                await ChatMessage.create({
                  content: madnessMessageContent,
                  speaker: madnessEffectSpeaker
                });
                if (rolls.length > 0) {
                  await ChatMessage.create({
                    speaker: madnessEffectSpeaker,
                    rolls
                  });
                }
                const madnessTypePrefix = game.i18n.localize('DX3rd.MadnessType');
                const existingMadnessItems = actor.items.filter(item =>
                  item.type === 'effect' &&
                  item.name &&
                  item.name.startsWith(madnessTypePrefix)
                );
                if (existingMadnessItems.length > 0) {
                  const existingItemIds = existingMadnessItems.map(item => item.id);
                  await actor.deleteEmbeddedDocuments('Item', existingItemIds);
                }
                let madness14HpLoss = null;
                if (madnessNumber === 14) {
                  const hpRoll = new Roll("1d10");
                  await hpRoll.evaluate();
                  madness14HpLoss = hpRoll.total;
                  const currentHp = actor.system?.attributes?.hp?.value ?? 0;
                  const newHp = Math.max(0, currentHp - madness14HpLoss);
                  await actor.update({ 'system.attributes.hp.value': newHp });
                } else if (madnessNumber === 17) {
                  const currentHp = actor.system?.attributes?.hp?.value ?? 0;
                  const newHp = Math.max(0, currentHp - 5);
                  await actor.update({ 'system.attributes.hp.value': newHp });
                }
                const madnessItemData = {
                  name: game.i18n.localize('DX3rd.MadnessType') + ': ' + game.i18n.localize(`DX3rd.Madness${madnessNumber}`),
                  type: 'effect',
                  system: {
                    description: game.i18n.localize(`DX3rd.MadnessText${madnessNumber}`),
                    type: 'extra',
                    skill: '-',
                    difficulty: '-',
                    limit: '-',
                    timing: '-',
                    target: '-',
                    range: '-',
                    encroach: { init: 0, value: 0 },
                    level: { init: 1, max: 1, upgrade: false },
                    exp: { own: false, upgrade: false },
                    active: { state: true, disable: '-', runTiming: 'instant' },
                    attributes: (() => {
                      const attrs = {};
                      if (madnessNumber === 2) {
                        attrs.stat_dice_evade = { key: 'stat_dice', label: 'evade', value: 2 };
                      }  else if (madnessNumber === 5) {
                        attrs.stat_dice_info = { key: 'stat_dice', label: 'info', value: 1 };
                      } else if (madnessNumber === 6) {
                        attrs.dodge_dice = { key: 'dodge_dice', value: -2 };
                      } else if (madnessNumber === 8) {
                        attrs.stat_dice_negotiation = { key: 'stat_dice', label: 'negotiation', value: -1 };
                        attrs.stat_dice_will = { key: 'stat_dice', label: 'will', value: 1 };
                      } else if (madnessNumber === 9) {
                        attrs.stock_point = { key: 'stock_point', value: -4 };
                        attrs.stat_add_will = { key: 'stat_add', label: 'will', value: 2 };
                      } else if (madnessNumber === 11) {
                        attrs.attack = { key: 'attack', value: '1d10' };
                      } else if (madnessNumber === 13) {
                        attrs.stat_dice_perception = { key: 'stat_dice', label: 'perception', value: 3 };
                      } else if (madnessNumber === 14) {
                        attrs.hp = { key: 'hp', value: -madness14HpLoss };
                      } else if (madnessNumber === 15) {
                        attrs.stat_bonus_will = { key: 'stat_bonus', label: 'will', value: 1 };
                      } else if (madnessNumber === 17) {
                        attrs.hp = { key: 'hp', value: -5 };
                      }
                      return attrs;
                    })()
                  }
                };
                await actor.createEmbeddedDocuments('Item', [madnessItemData]);
              };
              
              if (madnessChoice === "select") {
                // Pick a madness effect: show the select dialog
                const madnessOptions = [];
                for (let i = 1; i <= 17; i++) {
                  madnessOptions.push({
                    value: i,
                    label: game.i18n.localize(`DX3rd.Madness${i}`)
                  });
                }
                
                const selectContent = `
                  <div class="dx3rd-urge-dialog-title" style="margin-bottom: 12px;">${game.i18n.localize("DX3rd.MadnessSelect")}</div>
                  <select id="dx3rd-madness-select" style="width: 100%; margin-bottom: 12px; font-size: 0.9em;">
                    ${madnessOptions.map(opt => `<option value="${opt.value}">${opt.label}</option>`).join('')}
                  </select>
                `;
                
                const selectedMadness = await new Promise((resolve) => {
                  const selectDialog = document.createElement("div");
                  selectDialog.id = "dx3rd-madness-select-dialog";
                  selectDialog.className = "dx3rd-urge-dialog";
                  
                  // Keyboard handling (Enter / Escape)
                  const keyHandler = (ev) => {
                    if (ev.key === "Enter") {
                      ev.preventDefault();
                      ev.stopPropagation();
                      document.removeEventListener("keydown", keyHandler);
                      const selectedValue = parseInt(selectDialog.querySelector("#dx3rd-madness-select").value);
                      selectDialog.remove();
                      resolve(selectedValue);
                    } else if (ev.key === "Escape") {
                      ev.preventDefault();
                      ev.stopPropagation();
                      document.removeEventListener("keydown", keyHandler);
                      selectDialog.remove();
                      resolve(null);
                    }
                  };
                  
                  const onConfirm = (value) => {
                    document.removeEventListener("keydown", keyHandler);
                    selectDialog.remove();
                    resolve(value);
                  };
                  
                  selectDialog.innerHTML = `
                    ${selectContent}
                    <div class="dx3rd-urge-dialog-buttons">
                      <button 
                        id="dx3rd-madness-confirm-button" 
                        class="dx3rd-urge-dialog-button"
                      >${game.i18n.localize("DX3rd.Confirm")}</button>
                      <hr class="dx3rd-urge-dialog-divider">
                      <button 
                        id="dx3rd-madness-select-cancel-button" 
                        class="dx3rd-urge-dialog-button dx3rd-urge-dialog-cancel"
                      >${game.i18n.localize("DX3rd.Cancel")}</button>
                    </div>
                  `;
                  
                  document.body.appendChild(selectDialog);
                  document.addEventListener("keydown", keyHandler);
                  
                  selectDialog.querySelector("#dx3rd-madness-confirm-button").addEventListener("click", () => {
                    const selectedValue = parseInt(selectDialog.querySelector("#dx3rd-madness-select").value);
                    onConfirm(selectedValue);
                  });
                  selectDialog.querySelector("#dx3rd-madness-select-cancel-button").addEventListener("click", () => onConfirm(null));
                });
                
                if (selectedMadness !== null) {
                  await applyMadnessEffect(actor, selectedMadness, { messageKey: "DX3rd.MadnessSelect" });
                }
              } else if (madnessChoice === "roll") {
                const madnessRoll = new Roll("1d100");
                await madnessRoll.evaluate();
                const rollResult = madnessRoll.total;
                let madnessNumber = 1;
                if (rollResult >= 96) madnessNumber = 17;
                else if (rollResult >= 91) madnessNumber = 16;
                else if (rollResult >= 86) madnessNumber = 15;
                else if (rollResult >= 81) madnessNumber = 14;
                else if (rollResult >= 76) madnessNumber = 13;
                else if (rollResult >= 71) madnessNumber = 12;
                else if (rollResult >= 66) madnessNumber = 11;
                else if (rollResult >= 61) madnessNumber = 10;
                else if (rollResult >= 56) madnessNumber = 9;
                else if (rollResult >= 51) madnessNumber = 8;
                else if (rollResult >= 44) madnessNumber = 7;
                else if (rollResult >= 38) madnessNumber = 6;
                else if (rollResult >= 31) madnessNumber = 5;
                else if (rollResult >= 23) madnessNumber = 4;
                else if (rollResult >= 15) madnessNumber = 3;
                else if (rollResult >= 8) madnessNumber = 2;
                await applyMadnessEffect(actor, madnessNumber, {
                  messageKey: "DX3rd.MadnessRoll",
                  rolls: [madnessRoll]
                });
              }
            } else {
              // Below encroachment 80: the ordinary panic effects
              // Show the panic-effect choice dialog
              const panicChoice = await new Promise((resolve) => {
              const dialog = document.createElement("div");
              dialog.id = "dx3rd-panic-effect-dialog";
              dialog.className = "dx3rd-urge-dialog";
              
              // Keyboard handling (Enter / Escape)
              const keyHandler = (ev) => {
                if (ev.key === "Escape") {
                  ev.preventDefault();
                  ev.stopPropagation();
                  document.removeEventListener("keydown", keyHandler);
                  dialog.remove();
                  resolve(null);
                }
              };
              
              const onSelect = (selection) => {
                document.removeEventListener("keydown", keyHandler);
                dialog.remove();
                resolve(selection);
              };
              
              dialog.innerHTML = `
                <div class="dx3rd-urge-dialog-title">${game.i18n.localize("DX3rd.PanicTest")} ${game.i18n.localize("DX3rd.Failure")}</div>
                <div class="dx3rd-urge-dialog-buttons">
                  <button 
                    id="dx3rd-panic-select-button" 
                    class="dx3rd-urge-dialog-button"
                  >${game.i18n.localize("DX3rd.PanicSelect")}</button>
                  <button 
                    id="dx3rd-panic-roll-button" 
                    class="dx3rd-urge-dialog-button"
                  >${game.i18n.localize("DX3rd.PanicRoll")}</button>
                  <hr class="dx3rd-urge-dialog-divider">
                  <button 
                    id="dx3rd-panic-cancel-button" 
                    class="dx3rd-urge-dialog-button dx3rd-urge-dialog-cancel"
                  >${game.i18n.localize("DX3rd.Cancel")}</button>
                </div>
              `;
              
              document.body.appendChild(dialog);
              document.addEventListener("keydown", keyHandler);
              
              dialog.querySelector("#dx3rd-panic-select-button").addEventListener("click", () => onSelect("select"));
              dialog.querySelector("#dx3rd-panic-roll-button").addEventListener("click", () => onSelect("roll"));
              dialog.querySelector("#dx3rd-panic-cancel-button").addEventListener("click", () => onSelect(null));
            });
            
            if (panicChoice === "select") {
              // Pick a panic effect: show the select dialog
              const panicOptions = [];
              for (let i = 1; i <= 10; i++) {
                panicOptions.push({
                  value: i,
                  label: game.i18n.localize(`DX3rd.Panic${i}`)
                });
              }
              
              const selectContent = `
                <div class="dx3rd-urge-dialog-title" style="margin-bottom: 12px;">${game.i18n.localize("DX3rd.PanicSelect")}</div>
                <select id="dx3rd-panic-select" style="width: 100%; margin-bottom: 12px; font-size: 0.9em;">
                  ${panicOptions.map(opt => `<option value="${opt.value}">${opt.label}</option>`).join('')}
                </select>
              `;
              
              const selectedPanic = await new Promise((resolve) => {
                const selectDialog = document.createElement("div");
                selectDialog.id = "dx3rd-panic-select-dialog";
                selectDialog.className = "dx3rd-urge-dialog";
                
                // Keyboard handling (Enter / Escape)
                const keyHandler = (ev) => {
                  if (ev.key === "Enter") {
                    ev.preventDefault();
                    ev.stopPropagation();
                    document.removeEventListener("keydown", keyHandler);
                    const selectedValue = parseInt(selectDialog.querySelector("#dx3rd-panic-select").value);
                    selectDialog.remove();
                    resolve(selectedValue);
                  } else if (ev.key === "Escape") {
                    ev.preventDefault();
                    ev.stopPropagation();
                    document.removeEventListener("keydown", keyHandler);
                    selectDialog.remove();
                    resolve(null);
                  }
                };
                
                const onConfirm = (value) => {
                  document.removeEventListener("keydown", keyHandler);
                  selectDialog.remove();
                  resolve(value);
                };
                
                selectDialog.innerHTML = `
                  ${selectContent}
                  <div class="dx3rd-urge-dialog-buttons">
                    <button 
                      id="dx3rd-panic-confirm-button" 
                      class="dx3rd-urge-dialog-button"
                    >${game.i18n.localize("DX3rd.Confirm")}</button>
                    <hr class="dx3rd-urge-dialog-divider">
                    <button 
                      id="dx3rd-panic-select-cancel-button" 
                      class="dx3rd-urge-dialog-button dx3rd-urge-dialog-cancel"
                    >${game.i18n.localize("DX3rd.Cancel")}</button>
                  </div>
                `;
                
                document.body.appendChild(selectDialog);
                document.addEventListener("keydown", keyHandler);
                
                selectDialog.querySelector("#dx3rd-panic-confirm-button").addEventListener("click", () => {
                  const selectedValue = parseInt(selectDialog.querySelector("#dx3rd-panic-select").value);
                  onConfirm(selectedValue);
                });
                selectDialog.querySelector("#dx3rd-panic-select-cancel-button").addEventListener("click", () => onConfirm(null));
              });
              
              if (selectedPanic !== null) {
                await applyPanicEffect(selectedPanic, { messageKey: "DX3rd.PanicSelect" });
              }
            } else if (panicChoice === "roll") {
              const panicRoll = new Roll("1d10");
              await panicRoll.evaluate();
              const rollResult = panicRoll.total;
              await applyPanicEffect(rollResult, {
                messageKey: "DX3rd.PanicRoll",
                rolls: [panicRoll]
              });
            }
            }
          }
        }
        
        // Run the post-roll callback
        if (afterRollCallback && typeof afterRollCallback === 'function') {
          await afterRollCallback({
            actor,
            item,
            roll,
            // On a fumble, hand over the value forced to 0 rather than the roll.total that still
            // carries skill level and modifiers (so a defense/reaction dodge treats it as an auto-fail).
            total: rollResult,
            fumble: isFumble,
            rollType,
            difficultyData,
            label
          });
        }
        
        // Disable hooks for this roll type (independent of any weapon bonus)
        if (rollType === 'major') {
          // Major roll: run the 'roll' and 'major' disable hooks
          if (window.DX3rdDisableHooks) {
            await window.DX3rdDisableHooks.executeDisableHook('roll', actor);
            await window.DX3rdDisableHooks.executeDisableHook('major', actor);
          }
        } else if (rollType === 'reaction' || rollType === 'dodge') {
          // Reaction/dodge roll: run the 'roll' and 'reaction' disable hooks
          if (window.DX3rdDisableHooks) {
            await window.DX3rdDisableHooks.executeDisableHook('roll', actor);
            await window.DX3rdDisableHooks.executeDisableHook('reaction', actor);
          }
        }

        // Shared post-accuracy work on the combo/effect attack path: hatred recovery + extension hooks
        if (isAttackRoll) {
          await this.onAttackRollComplete(
            actor, item, Array.from(game.user.targets), rollResult, isFumble, attackMessage);
          await this.maybeAutoRollDamage?.(attackMessage);
        }
      } catch (e) {
        window.DX3rdDebug.log('DX3rd | Roll failed', e);
        // No message on error: if the normal message already went out, another would duplicate it for the GM
      }
    },
  });
})();
