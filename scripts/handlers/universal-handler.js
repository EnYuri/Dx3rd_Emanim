// Universal handler - shared routines for item use/activation
(function() {

  window.DX3rdUniversalHandler = {
    /**
     * Sum the bonuses of the weapons registered on the weapon tab (only those with attacks left).
     * Shared by effect/psionic — the same 52 lines were duplicated in both, so a change to the
     * weapon-exhaustion rule risked being applied to only one copy. Hoisted here.
     *
     * ComboHandler.calculateRegisteredWeaponBonus is a DIFFERENT function. It layers the
     * multiWeapon rule on top — do not merge it into this one.
     */
    calculateRegisteredWeaponBonus(actor, item) {
      const weaponBonus = { attack: 0, add: 0, attackFormula: '', addFormula: '', weaponName: '', weaponIds: [] };

      // Weapons registered on the weapon tab
      const registeredWeapons = item.system?.weapon || [];

      // Sum each registered weapon's bonus (only those with attacks left)
      for (const weaponId of registeredWeapons) {
        if (weaponId && weaponId !== '-') {
          // Resolve the weapon document straight off the actor
          const weaponItem = window.DX3rdResolveWeapon(actor, weaponId);
          // Vehicles are legitimate weapon-slot entries too — the slot dropdown (helpers.js) and the
          // attack-weapon picker (weapon-for-attack-dialog) both list them, but only this spot filtered
          // them out. A combo registering only vehicles then got an empty weaponIds, hasAvailableWeapons
          // went false, and the whole weapon path was skipped (attack power reached neither the roll
          // nor the damage button). Vehicles carry attack only — no add, no attack-used, as in the picker.
          if (weaponItem && (weaponItem.type === 'weapon' || weaponItem.type === 'vehicle')) {
            const isVehicle = weaponItem.type === 'vehicle';

            if (!isVehicle) {
              // Attack-count check (weapon only; vehicles have no attack-used)
              const attackUsedDisable = weaponItem.system['attack-used']?.disable || 'notCheck';
              const attackUsedState = weaponItem.system['attack-used']?.state || 0;
              const attackUsedMax = weaponItem.system['attack-used']?.max || 0;
              const isAttackExhausted = attackUsedDisable !== 'notCheck' && (attackUsedMax <= 0 || attackUsedState >= attackUsedMax);

              // Weapons out of attacks are dropped — but whether exhaustion blocks is a world setting.
              if (isAttackExhausted && window.DX3rdItemExhausted?.allowExhaustedUse?.() === false) {
                continue;
              }
            }

            // Fixed bonuses are summed now; dice formulas are kept until attack/damage is resolved.
            const formula = window.DX3rdFormulaEvaluator;
            const addFormulaTerm = (target, raw) => {
              const prepared = formula.prepareRollFormula(String(raw ?? '0'), weaponItem, actor);
              if (formula.hasDice(prepared)) weaponBonus[target] = [weaponBonus[target], prepared].filter(Boolean).join(' + ');
              else weaponBonus[target === 'attackFormula' ? 'attack' : 'add'] += Number(formula.evaluate(raw, weaponItem, actor)) || 0;
            };
            addFormulaTerm('attackFormula', weaponItem.system?.attack);
            if (!isVehicle) addFormulaTerm('addFormula', weaponItem.system?.add);

            // Append the weapon name
            if (!weaponBonus.weaponName) {
              weaponBonus.weaponName = weaponItem.name;
            } else {
              weaponBonus.weaponName += `, ${weaponItem.name}`;
            }

            // Append the weapon id
            weaponBonus.weaponIds.push(weaponId);
          }
          // Anything that is not a weapon/vehicle, or cannot be resolved, is skipped.
        }
      }

      return weaponBonus;
    },

    /**
     * Resolve the roll profile for this invocation.
     *
     * A major/reaction item stores one roll type, but a defense-dialog invocation already knows
     * that the same item is being used as the defender's dodge. Use that contextual profile only
     * when the authored timing actually permits a reaction; ordinary sheet/chat uses keep the
     * stored roll type, and no-roll items stay no-roll.
     */
    resolveInvocationRollType(item, options = {}) {
      const stored = item?.system?.roll ?? '-';
      const requested = options?.rollType;
      if (stored === '-' || !['reaction', 'dodge'].includes(requested)) return stored;

      const timing = item?.system?.timing || '-';
      return ['reaction', 'dodge', 'major-reaction'].includes(timing) ? requested : stored;
    },

    /**
     * Does an ordinary attack with this equipment leave its cost and use count alone?
     *
     * For equipment, attacking and *using* are two different things: the gear's "on use" content fires when the
     * player declares it, and an attack that never fires it must not be charged for it. The declaration UI's
     * `isDeclarable` used to be the whole test, but it only recognises **modifier rows** — equipment whose use
     * bucket holds an extension or a macro card instead (heal on use, a macro on use) fell through, so a plain
     * attack spent a use of something the attack never ran (`processItemExtensions` filters on action, so the
     * card itself stayed unfired). Any live card bound to 'use' therefore counts.
     *
     * **Equipment only.** For an effect or a combo, attacking IS the use — extending this to them would make an
     * attack effect that also authors a use card cost nothing at all.
     */
    attackDefersUsage(item) {
      if (!['weapon', 'protect', 'vehicle'].includes(item?.type)) return false;
      if (window.DX3rdDeclaredEquipment?.isDeclarable?.(item)) return true;
      return !!window.DX3rdItemEffectAdapter?.hasActionEffects?.(item, 'use');
    },

    /**
     * Does this item's authored difficulty mean "there is nothing to roll against"?
     *
     * The 난이도 dropdown carries the target value, and two of its options say the use simply
     * happens: 자동성공 (it succeeds with no roll) and '-'/blank (no target value authored).
     * The other options — 대결 / a number / 효과참조 / free text — all name something the roll
     * is measured against, so they keep the roll.
     *
     * This is a *skip* test only: it can turn a roll off, never on. An item whose roll toggle is
     * '-' stays no-roll no matter what the difficulty says (there are 348 compendium effects
     * authored 대결 with roll '-' — combo members whose contest belongs to the combo, not to a
     * standalone use of the member).
     *
     * The classification comes from DX3rdRangeTarget so the sheet dropdown and this gate cannot
     * drift apart; the fallback covers the load order in which that script is not yet present.
     */
    skipsRollByDifficulty(item) {
      const raw = String(item?.system?.difficulty ?? '').trim();
      const option = window.DX3rdRangeTarget?.classifyDifficulty?.(raw)?.option
        ?? (raw === '' ? '-' : raw);
      return option === '-' || option === '자동성공';
    },

    /** Is the item's 대상 field the canonical self value? (parsed by DX3rdRangeTarget, so synonyms count) */
    itemTargetsSelf(item) {
      const raw = item?.system?.target;
      if (raw === undefined || raw === null || String(raw).trim() === '') return false;
      const info = window.DX3rdRangeTarget?.targetInfo?.(raw);
      return info ? !!info.self : String(raw).trim() === '자신';
    },

    /**
     * Target the caster's own token for this user, as if they had pressed T on it.
     * Returns the resulting target list (empty when the actor has no token on the canvas —
     * the caller then falls back to the ordinary "pick a target" warning rather than pretending).
     */
    autoTargetSelf(actor) {
      const token = actor?.getActiveTokens?.(true, false)?.[0] || actor?.getActiveTokens?.()?.[0];
      if (!token) {
        window.DX3rdDebug.log('DX3rd | autoTargetSelf - no token on canvas for', actor?.name);
        return [];
      }
      token.setTarget(true, {user: game.user, releaseOthers: true});
      window.DX3rdDebug.log('DX3rd | autoTargetSelf - self-targeted', token.name);
      return Array.from(game.user.targets || []);
    },

    /**
     * Resolve the roll stat and its display label from the item's system.skill.
     * Handles attributes (body/sense/mind/social), syndrome, and normal/custom skills.
     * Shared by effect/psionic — psionic held two stale inline copies that were missing
     * custom-skill renames and the unowned-skill fallback, so they were merged here.
     * @returns {{stat: object|null, label: string}}
     */
    resolveStatAndLabel(actor, item) {
      const skillKey = item.system?.skill;
      const attributes = ['body', 'sense', 'mind', 'social'];

      if (attributes.includes(skillKey)) {
        return {
          stat: actor.system.attributes[skillKey],
          label: game.i18n.localize(`DX3rd.${skillKey.charAt(0).toUpperCase() + skillKey.slice(1)}`)
        };
      }

      if (skillKey === 'syndrome') {
        const stat = actor.system.attributes.syndrome;
        let label = stat?.name || game.i18n.localize('DX3rd.Syndrome');
        if (label && label.startsWith('DX3rd.')) label = game.i18n.localize(label);
        return { stat, label };
      }

      // Normal / custom skill
      const stat = actor.system.attributes.skills?.[skillKey];
      if (stat) return { stat, label: window.DX3rdSkillManager.getSkillDisplayName(skillKey, stat) };

      // Fallback: a (category) skill the actor does not own rolls against its linked attribute.
      // (Unlearned skill = attribute roll, per the DX3 rules. Category skills are not auto-seeded
      //  onto new characters, so a homebrew item — or one dragged in from another actor — that
      //  references such a skill must not abort the roll.)
      const base = this._resolveSkillBase(skillKey);
      if (base && actor.system.attributes[base]) {
        const customSkills = game.settings.get("dx3rd-emanim", "customSkills") || {};
        const cs = customSkills[skillKey];
        const label = cs
          ? (typeof cs === 'object' ? cs.name : cs)
          : (skillKey.startsWith('DX3rd.') ? game.i18n.localize(skillKey) : skillKey);
        return { stat: actor.system.attributes[base], label };
      }

      return { stat: null, label: '' };
    },

    /**
     * The roll profile for an item that names no 기능 but whose 난이도 still demands a roll
     * ("기능 -, 난이도 대결"): an empty pool the player fills in from the dialog.
     * Not a fallback for a *misspelled* skill — that stays an error, because there the authored
     * intent exists and silently rolling zero dice would hide it.
     */
    blankRollStat() {
      return {
        dice: 0,
        critical: game.settings.get('dx3rd-emanim', 'defaultCritical') || 10,
        add: 0
      };
    },

    /**
     * Guess the linked attribute for a skill key the actor does not have.
     * Prefers the customSkills setting's base, then falls back to the category key prefix.
     */
    _resolveSkillBase(skillKey) {
      if (!skillKey) return null;
      const customSkills = game.settings.get("dx3rd-emanim", "customSkills") || {};
      const cs = customSkills[skillKey];
      if (cs && typeof cs === 'object' && cs.base) return cs.base;
      if (skillKey.startsWith('info_')) return 'social';
      if (skillKey.startsWith('know_')) return 'mind';
      if (skillKey.startsWith('drive_')) return 'body';
      if (skillKey.startsWith('ars_')) return 'sense';
      return null;
    },

    /**
     * Report an exhausted usage count. The caller decides whether the item IS exhausted;
     * this only decides whether that **blocks** (world setting allowExhaustedUse).
     *
     * At the default (allow) it warns instead of blocking — the automation is still being
     * tuned, and halting a session because one usage-count field is wrong is the worse failure.
     * The notification and chat record still go out so the GM sees "that should not have been
     * usable", and the sheet's exhausted marker (isItemExhausted) stays regardless of the setting.
     *
     * Kept in one place so combo-member and own-item exhaustion share wording and path.
     * @param {Actor} actor
     * @param {Item} item
     * @param {string} detail  pre-composed reason, e.g. "usage count exhausted (2/2)"
     * @returns {Promise<boolean>} whether the caller may proceed
     */
    async reportUsageExhausted(actor, item, detail) {
      const itemName = (String(item?.name || '').match(/^(.+)\|\|(.+)$/) || [null, item?.name])[1];
      const allowed = window.DX3rdItemExhausted?.allowExhaustedUse?.() !== false;
      const speaker = ChatMessage.getSpeaker({ actor });

      if (allowed) {
        ui.notifications.warn(`${itemName}: ${detail} — ${game.i18n.localize('DX3rd.ExhaustedUseAllowed')}`);
        await ChatMessage.create({
          speaker,
          content: `<div class="dx3rd-item-chat"><div class="dx3rd-warning"><strong>${itemName}</strong><br>${detail} — ${game.i18n.localize('DX3rd.ExhaustedUseAllowed')}</div></div>`
        });
        window.DX3rdDebug.log('DX3rd | Usage exhausted but allowed by setting:', itemName, detail);
        return true;
      }

      ui.notifications.warn(`${itemName}: ${detail}`);
      await ChatMessage.create({
        speaker,
        content: `<div class="dx3rd-item-chat"><div class="dx3rd-error"><strong>${itemName} ${game.i18n.localize('DX3rd.Use')} ${game.i18n.localize('DX3rd.Unable')}</strong><br>${detail}</div></div>`,
        style: CONST.CHAT_MESSAGE_STYLES.OTHER
      });
      window.DX3rdDebug.log('DX3rd | Item usage blocked - usage count exhausted:', itemName, detail);
      return false;
    },

    /**
     * Report a usage-condition violation. The caller **detects** the violation; this only
     * decides whether it **blocks** (world setting, default is not to block).
     *
     * Same shape and wording scheme as reportUsageExhausted. If each gate reported differently,
     * some would block silently and others only warn, and the user could not tell what stopped
     * them — which is exactly what happened with the exhaustion gate (chat-ui's weapon activation
     * skipped without even a warning).
     *
     * @param {Actor} actor
     * @param {Item} item
     * @param {string} gate   a key in DX3rdUsageGates.SETTINGS
     * @param {string} detail pre-composed reason ("encroachment limit: only at 60% or above …")
     * @returns {Promise<boolean>} whether the caller may proceed
     */
    async reportUsageGate(actor, item, gate, detail) {
      const itemName = (String(item?.name || '').match(/^(.+)\|\|(.+)$/) || [null, item?.name])[1];
      const allowed = window.DX3rdUsageGates?.allows?.(gate) !== false;
      const speaker = ChatMessage.getSpeaker({ actor });

      if (allowed) {
        ui.notifications.warn(`${itemName}: ${detail} — ${game.i18n.localize('DX3rd.GateUseAllowed')}`);
        await ChatMessage.create({
          speaker,
          content: `<div class="dx3rd-item-chat"><div class="dx3rd-warning"><strong>${itemName}</strong><br>${detail} — ${game.i18n.localize('DX3rd.GateUseAllowed')}</div></div>`
        });
        window.DX3rdDebug.log('DX3rd | Usage condition violated but allowed by setting:', gate, itemName, detail);
        return true;
      }

      ui.notifications.warn(`${itemName}: ${detail}`);
      await ChatMessage.create({
        speaker,
        content: `<div class="dx3rd-item-chat"><div class="dx3rd-error"><strong>${itemName} ${game.i18n.localize('DX3rd.Use')} ${game.i18n.localize('DX3rd.Unable')}</strong><br>${detail}</div></div>`,
        style: CONST.CHAT_MESSAGE_STYLES.OTHER
      });
      window.DX3rdDebug.log('DX3rd | Item usage blocked by condition gate:', gate, itemName, detail);
      return false;
    },

    /**
     * Process item usage cost (encroachment/HP) and send unified chat message.
     * @param {Actor} actor
     * @param {Item} item
     * @returns {boolean} true if usage is allowed, false if blocked
     */
    async processItemUsageCost(actor, item, options = {}) {
      const { skipMessage = false } = options;
      const requestedAction = window.DX3rdItemEffectAdapter?.invocationAction(item, options)
        || options.action || null;
      const effectMatches = (kind, data, timing = data?.timing || 'instant') => !window.DX3rdItemEffectAdapter
        || window.DX3rdItemEffectAdapter.extensionActionMatches(item, kind, data, requestedAction, timing);
      const comboMemberEntries = item.type === 'combo'
        ? (window.DX3rdComboHandler?.comboMemberEntries?.(actor, item) || [])
        : [];
      try {
        // Explicit usage limits from compendium automation. Items without the flag are unaffected.
        const automationExtend = item.getFlag?.('dx3rd-emanim', 'itemExtend') || {};
        // Unified compendium overrides keep automation constraints inside the existing extend data.
        // The older separately-injected flag is still read, for compatibility with existing worlds.
        const automation = automationExtend.automation || item.getFlag?.('dx3rd-emanim', 'automation') || {};
        const maxEncroachmentExclusive = Number(automation.maxEncroachmentExclusive);
        if (Number.isFinite(maxEncroachmentExclusive) && maxEncroachmentExclusive > 0) {
          const encroachment = Number(actor.system?.attributes?.encroachment?.value) || 0;
          if (encroachment >= maxEncroachmentExclusive) {
            // Being blocked by encroachment is the same kind of limit as system.limit, so the same
            // setting governs it. Leaving this one out would mean "I disabled the limit and it still blocks".
            const detail = game.i18n.format('DX3rd.AutomationMaxEncroachment', { limit: maxEncroachmentExclusive });
            if (!await this.reportUsageGate(actor, item, 'encroachLimit', detail)) return false;
          }
        }

        // 0. [Pressure] check (blocks items with auto timing)
        //    Exemption (item authoring + world name list) lives solely in DX3rdUsageGates.conditionExempt;
        //    whether it blocks is a world setting — items authored as exempt pass regardless.
        const pressureActive = actor.system?.conditions?.pressure?.active || false;
        if (pressureActive && (item.system?.timing || '-') === 'auto') {
          if (!window.DX3rdUsageGates?.conditionExempt?.(item, 'pressure')) {
            const detail = `${game.i18n.localize('DX3rd.Pressure')}: ${game.i18n.localize('DX3rd.PressureAutoBlocked')}`;
            if (!await this.reportUsageGate(actor, item, 'pressure', detail)) return false;
          }
        }

        // 0.1. [Berserk] type check (blocks items with reaction/dodge timing)
        const berserkActive = actor.system?.conditions?.berserk?.active || false;
        const berserkType = actor.system?.conditions?.berserk?.type || '';
        const berserkTypesToBlock = ['normal', 'slaughter', 'battlelust', 'delusion', 'fear', 'hatred'];

        if (berserkActive && berserkTypesToBlock.includes(berserkType)) {
          const rollTiming = this.resolveInvocationRollType(item, options);
          if (rollTiming === 'reaction' || rollTiming === 'dodge') {
            if (!window.DX3rdUsageGates?.conditionExempt?.(item, 'berserk')) {
              const detail = `${game.i18n.localize('DX3rd.Berserk')}: ${game.i18n.localize('DX3rd.BerserkReactionBlocked')}`;
              if (!await this.reportUsageGate(actor, item, 'berserk', detail)) return false;
            }
          }
        }

        // 1. A combo checks the usage counts of its member items.
        // The member list comes from comboMemberItems alone — if this check, combo-handler's count
        // increment, and member execution picked members by different rules, you would get the
        // asymmetry of "the check is skipped but the count still rises" (see isComboMemberItem).
        if (item.type === 'combo') {
          for (const effect of this.comboMemberItems(actor, item)) {
            const effectExtend = effect.getFlag?.('dx3rd-emanim', 'itemExtend') || {};
            const effectAutomation = effectExtend.automation || effect.getFlag?.('dx3rd-emanim', 'automation') || {};
            if (effectAutomation.noCombo) {
              ui.notifications.warn(game.i18n.format('DX3rd.AutomationNoCombo', { name: effect.name }));
              return false;
            }
            const effectUsedDisable = effect.system.used?.disable || 'notCheck';
            if (effectUsedDisable === 'notCheck') continue;

            const effectUsedState = effect.system.used?.state || 0;
            const effectUsedMax = effect.system.used?.max || 0;
            const effectUsedLevel = effect.system.used?.level || false;

            // Compute displayMax (add the level when used.level is checked).
            // The level term is effect-only — DX3rdEffectLevel.value returns 0 for non-effects.
            let effectDisplayMax = Number(effectUsedMax) || 0;
            if (effectUsedLevel && effect.type === 'effect') {
              const finalLevel = window.DX3rdEffectLevel
                ? window.DX3rdEffectLevel.value(effect, actor)
                : Number(effect.system?.level?.init) || 0;
              effectDisplayMax += finalLevel;
            }

            if (effectDisplayMax <= 0 || effectUsedState >= effectDisplayMax) {
              const detail = `${game.i18n.localize('DX3rd.ExhaustedIncludedEffect')}: ${effect.name} (${effectUsedState}/${effectDisplayMax})`;
              if (!await this.reportUsageExhausted(actor, item, detail)) return false;
            }
          }
        }
        
        // 2. Plain item usage-count limit
        const usedDisable = item.system?.used?.disable || 'notCheck';
        if (usedDisable !== 'notCheck') {
          const usedState = item.system?.used?.state || 0;
          const usedMax = item.system?.used?.max || 0;
          const usedLevel = item.system?.used?.level || false;
          
          // Compute displayMax (add the level when used.level is checked)
          let displayMax = Number(usedMax) || 0;
          // For a consumable the quantity on hand IS this scenario's usable count.
          // This also judges old world documents whose max was never synced after a quantity change.
          if (item.type === 'once') {
            displayMax = Number(item.system?.quantity) || 1;
          } else if (usedLevel && item.type === 'effect') {
            const finalLevel = window.DX3rdEffectLevel
              ? window.DX3rdEffectLevel.value(item, actor)
              : Number(item.system?.level?.init) || 0;
            displayMax += finalLevel;
          } else if (usedLevel && item.type === 'psionic') {
            // Psionics add init only, with no encroachment adjustment
            const baseLevel = Number(item.system?.level?.init) || 0;
            displayMax += baseLevel;
          }
          
          // Exhausted when displayMax is 0, or usedState has reached it
          if (displayMax <= 0 || usedState >= displayMax) {
            const detail = `${game.i18n.localize('DX3rd.ExhaustedUsageCount')} (${usedState}/${displayMax})`;
            if (!await this.reportUsageExhausted(actor, item, detail)) return false;
          }
        }
        
        // 2. Resurrect check — unusable while HP > 0, and unusable at encroachment >= 100
        const itemExtend = item.getFlag('dx3rd-emanim', 'itemExtend') || {};
        const itemExtensionEntries = window.DX3rdItemEffectAdapter?.extensionEntries?.(itemExtend) || [];
        const hasResurrect = itemExtensionEntries.some(entry => entry.type === 'heal' && entry.data?.resurrect
          && effectMatches('heal', entry.data));
        if (hasResurrect) {
          const currentHP = Number(actor.system?.attributes?.hp?.value ?? 0);
          const currentEncroachment = Number(actor.system?.attributes?.encroachment?.value ?? 0);

          // Unusable while HP > 0
          if (currentHP > 0) {
            const detail = `${game.i18n.localize('DX3rd.ResurrectRequiresZeroHP')} (${game.i18n.localize('DX3rd.Current')} HP: ${currentHP})`;
            if (!await this.reportUsageGate(actor, item, 'resurrect', detail)) return false;
          }

          // Unusable at encroachment >= 100
          if (currentEncroachment >= 100) {
            const detail = `${game.i18n.localize('DX3rd.ResurrectRequiresEncroachUnder100')} (${game.i18n.localize('DX3rd.Current')} ${game.i18n.localize('DX3rd.Encroachment')}: ${currentEncroachment}%)`;
            if (!await this.reportUsageGate(actor, item, 'resurrect', detail)) return false;
          }
        }
        
        // 3. system.limit — the encroachment threshold
        //
        // Resurrect items are exempt from the "limit" field's encroachment floor (their own
        // condition was judged in 2 above). There used to be a second encroachment-100 check
        // inside here, unreachable because 2 returns first — and now that the gate setting exists
        // it would have ignored that setting and blocked anyway. Removed. Do not reinstate.
        const itemLimit = String(item.system?.limit ?? '').trim();
        if (!hasResurrect && itemLimit !== '') {
          // Compare on the extracted number (usable at that value or above)
          const numberMatch = itemLimit.match(/(\d+)/);
          if (numberMatch) {
            const limitValue = Number(numberMatch[1]);
            const currentEncroachment = Number(actor.system?.attributes?.encroachment?.value ?? 0);

            if (currentEncroachment < limitValue) {
              const detail = game.i18n.format('DX3rd.EncroachLimitBlocked', {
                limit: limitValue,
                current: currentEncroachment
              });
              if (!await this.reportUsageGate(actor, item, 'encroachLimit', detail)) return false;
            }
          }
        }
        
        // 0.5. Variable runtime input (prompt for a number on use → supplies the [소비HP]/[입력] tokens)
        //   When itemExtend.damage.runtimePrompt is on, ask the user for a number and park it on
        //   actor._dx3rdRuntimeInput (FormulaEvaluator reads it into damage/weapon/protect values).
        //   With runtimeConsumeHP the input costs that much HP (it joins hpCostList below and reuses its deduction/chat path).
        //   A combo with no config of its own uses the first member effect's config (a single prompt).
        actor._dx3rdRuntimeInput = 0;
        let runtimeConsumeAmount = 0;
        {
          let runtimeCfg = itemExtensionEntries
            .filter(entry => entry.type === 'damage')
            .map(entry => entry.data)
            .find(data => data?.runtimePrompt && effectMatches('damage', data)) || null;
          let runtimeSourceItem = runtimeCfg ? item : null;
          if (!runtimeCfg && item.type === 'combo') {
            for (const {item: memberItem} of comboMemberEntries) {
              const ex = memberItem?.getFlag?.('dx3rd-emanim', 'itemExtend') || {};
              runtimeCfg = (window.DX3rdItemEffectAdapter?.extensionEntries?.(ex) || [])
                .filter(entry => entry.type === 'damage')
                .map(entry => entry.data)
                .find(data => data?.runtimePrompt
                  && (!window.DX3rdItemEffectAdapter
                    || window.DX3rdComboHandler.memberExtensionActionMatches(memberItem, 'damage', data))) || null;
              if (runtimeCfg) {
                runtimeSourceItem = memberItem;
                break;
              }
            }
          }
          if (runtimeCfg) {
            const label = runtimeCfg.runtimeLabel
              || (runtimeCfg.runtimeConsumeHP
                ? game.i18n.localize('DX3rd.RuntimeConsumeHP')
                : game.i18n.localize('DX3rd.RuntimeInput'));
            const rawMax = String(runtimeCfg.runtimeMax ?? '').trim();
            let maxValue = null;
            if (rawMax && rawMax !== '-') {
              const evaluatedMax = Number(this.evaluateFormulaForExtension(rawMax, runtimeSourceItem || item, actor));
              if (Number.isFinite(evaluatedMax) && evaluatedMax >= 0) maxValue = Math.floor(evaluatedMax);
            }
            const entered = await window.DX3rdUniversalNumberPromptV2({
              title: item.name,
              label,
              defaultValue: Number(runtimeCfg.runtimeDefault) || 0,
              maxValue
            });
            // 0 is a valid value, so a falsy check will not do; cancel arrives as a non-number.
            if (!Number.isFinite(entered)) {
              window.DX3rdDebug.log('DX3rd | Item use canceled at runtime input prompt');
              return false; // canceled → abort the use (no cost deducted)
            }
            actor._dx3rdRuntimeInput = entered;
            if (runtimeCfg.runtimeConsumeHP) runtimeConsumeAmount = entered;
          }
        }

        let costMessages = [];

        // Cost deduction (HP + encroachment) is written in a single actor.update.
        // Each update costs a server round-trip, a full prepareData, and every updateActor hook,
        // and there is no reason to pay that twice per item use. Same pattern as reviveSelf below.
        // No ordering dependency: HP cost formulas are all evaluated in 1-E before any write, and
        // encroachment reads only the raw item.system.encroach.value, independent of the HP write.
        const costUpdate = {};

        // 1. HP cost (item + extends combined)
        let totalHpCost = 0;
        let hpCostRolls = [];
        
        // 1-A. The item's own HP cost
        const itemHpCostRaw = String(item.system?.hp?.value ?? '0').trim();
        
        // 1-B. Extend HP costs (itemExtend was declared above)
        // 1-C. HP cost list
        const hpCostList = [
          { raw: itemHpCostRaw, source: 'item' }
        ];
        for (const entry of itemExtensionEntries.filter(entry => entry.type === 'damage')) {
          const data = entry.data || {};
          if (data.hpCostActivate && data.hpCost && effectMatches('damage', data)) {
            hpCostList.push({raw: String(data.hpCost).trim(), source: `extend:${entry.id}`});
          }
        }

        // 1-C-2. If the runtime input is the HP-consuming kind, fold its value into the cost list
        if (runtimeConsumeAmount > 0) {
          hpCostList.push({ raw: String(runtimeConsumeAmount), source: 'runtime' });
        }

        // 1-D. Member costs share the extension collector's legacy use/attack inclusion.
        if (item.type === 'combo') {
          for (const {item: memberItem} of comboMemberEntries) {

            // A combo never runs its member effects through handleItemUse individually, so the
            // effect's own system.hp cost has to be summed explicitly here.
            const memberHpCost = String(memberItem.system?.hp?.value ?? '0').trim();
            if (memberHpCost !== '0' && memberHpCost !== '' && memberHpCost !== '-') {
              hpCostList.push({ raw: memberHpCost, source: `member:${memberItem.name}:system.hp` });
            }
            
            const memberExtend = memberItem.getFlag('dx3rd-emanim', 'itemExtend') || {};
            for (const entry of (window.DX3rdItemEffectAdapter?.extensionEntries?.(memberExtend) || []).filter(entry => entry.type === 'damage')) {
              const data = entry.data || {};
              const matches = !window.DX3rdItemEffectAdapter
                || window.DX3rdComboHandler.memberExtensionActionMatches(memberItem, 'damage', data);
              const raw = data.hpCostActivate && data.hpCost && matches ? String(data.hpCost).trim() : '0';
              if (raw !== '0' && raw !== '') hpCostList.push({raw, source: `member:${memberItem.name}:${entry.id}`});
            }
          }
        }
        
        // Keep the non-zero entries only
        const filteredHpCostList = hpCostList.filter(c => c.raw !== '0' && c.raw !== '');
        
        
        // 1-E. Resolve each HP cost
        for (const { raw, source } of filteredHpCostList) {
          const dicePattern = /(\d+)\s*d(\d*)/i;
          const isDiceFormula = dicePattern.test(raw) || /[dD]/.test(raw);
          
          let hpCost = 0;
          let displayFormula = '';
          let roll = null;
          
          if (isDiceFormula) {
            // Dice formula
            let normalizedFormula = raw.replace(/(\d+)\s*[dD]\s*(?!\d)/g, '$1d10');
            normalizedFormula = normalizedFormula.replace(/D/g, 'd');
            
            
            roll = await new Roll(normalizedFormula).roll();
            hpCost = roll.total;
            displayFormula = normalizedFormula;
            hpCostRolls.push({ roll, formula: displayFormula, source });
          } else {
            hpCost = Number(raw) || 0;
          }
          
          totalHpCost += hpCost;
        }
        
        // 1-F. Apply the HP cost
        // Insufficient HP does not block the use. By the rules the cost is paid regardless of
        // whether it can be afforded, and dropping to 0 or below (defeated) is a normal outcome.
        if (totalHpCost > 0) {
          const currentHP = Number(actor.system?.attributes?.hp?.value ?? 0);

          // Apply the HP loss (the actual write happens below, batched with encroachment)
          const afterHP = currentHP - totalHpCost;
          costUpdate['system.attributes.hp.value'] = afterHP;
          
          // Add the HP cost to the chat message
          if (hpCostRolls.length > 0) {
            // With a dice formula
            for (const { roll, formula } of hpCostRolls) {
              costMessages.push(`HP -${roll.total} (${formula})`);
              const diceHTML = await roll.render();
              costMessages.push(`<div class="dx3rd-mt-4">${diceHTML}</div>`);
            }
          } else {
            // Fixed value only
            costMessages.push(`HP -${totalHpCost}`);
          }
          
        }
        
        // 2. Encroachment (all item types)
        const encAddRaw = String(item.system?.encroach?.value ?? '0').trim();
        const hasEncroachmentCost = encAddRaw !== '0' && encAddRaw !== '' && encAddRaw !== '-';
        // Encroachment type "none": this actor's encroachment never rises (same as the _preUpdate guard).
        // The main path skips the roll, the addition, and the message, and just notes the non-rise.
        const noEncroach = actor.system?.attributes?.encroachment?.type === 'none';

        if (noEncroach && hasEncroachmentCost) {
          costMessages.push(`${game.i18n.localize('DX3rd.Encroachment')} +0 (${game.i18n.localize('DX3rd.NoEncroachNote')})`);
        } else if (hasEncroachmentCost) {
          const dicePattern = /(\d+)\s*d(\d*)/i;
          const isDiceFormula = dicePattern.test(encAddRaw) || /[dD]/.test(encAddRaw);
          
          let encAdd = 0;
          let displayFormula = '';
          let roll = null;
          
          if (isDiceFormula) {
            // Dice formula
            let normalizedFormula = encAddRaw.replace(/(\d+)\s*[dD]\s*(?!\d)/g, '$1d10');
            normalizedFormula = normalizedFormula.replace(/D/g, 'd');
            
            
            roll = await new Roll(normalizedFormula).roll();
            encAdd = roll.total;
            displayFormula = normalizedFormula;
          } else {
            encAdd = Number(encAddRaw) || 0;
          }
          
          const before = Number(actor.system?.attributes?.encroachment?.value ?? 0);
          const after = before + encAdd;

          costUpdate['system.attributes.encroachment.value'] = after;

          if (isDiceFormula && displayFormula) {
            costMessages.push(`${game.i18n.localize('DX3rd.Encroachment')} +${encAdd} (${displayFormula})`);
            if (roll) {
              const diceHTML = await roll.render();
              costMessages.push(`<div class="dx3rd-mt-4">${diceHTML}</div>`);
            }
          } else {
            costMessages.push(`${game.i18n.localize('DX3rd.Encroachment')} +${encAdd}`);
          }
        }
        
        // 2-B. Write the collected costs in one go.
        // The no-encroachment guard (_preUpdate) and the HP-zero detector (condtions.js) both find
        // their own key in this merged payload, so behavior matches writing them separately.
        if (Object.keys(costUpdate).length) await actor.update(costUpdate);

        // 3. Build the unified chat message
        // Lois items of type '-' or 'S' emit no usage message
        const isRoisWithNoMessage = item.type === 'rois' && 
                                    (item.system?.type === '-' || item.system?.type === 'S');
        
        // Strip the || ruby pattern from the item name
        let itemName = item.name;
        const rubyPattern = /^(.+)\|\|(.+)$/;
        const match = itemName.match(rubyPattern);
        if (match) {
          itemName = match[1]; // main name only
        }
        
        let msg = '';
        
        if (costMessages.length === 0) {
          // No cost
          msg = `<div><strong>${itemName} ${game.i18n.localize('DX3rd.Use')}</strong></div>`;
        } else {
          // With costs, show each one separately
          // Dice-roll HTML belongs to the same message, not a separate one
          let currentCostMsg = '';
          for (const costMsg of costMessages) {
            if (costMsg.startsWith('<div class="dx3rd-mt-4">')) {
              // Dice-roll HTML: append to the message being built
              currentCostMsg += costMsg;
            } else {
              // A new cost line: finish the previous message and start a fresh one
              if (currentCostMsg) {
                msg += `<div><strong>${itemName} ${game.i18n.localize('DX3rd.Use')}</strong>: ${currentCostMsg}</div>`;
              }
              currentCostMsg = costMsg;
            }
          }
          // Flush the last message
          if (currentCostMsg) {
            msg += `<div><strong>${itemName} ${game.i18n.localize('DX3rd.Use')}</strong>: ${currentCostMsg}</div>`;
          }
        }

        // The usage card carries the item's description as a small sub-line. This used to cover
        // only effects and the fist, so items whose description IS the effect — weapons, books,
        // connections, once — showed just "used ○○". A usage message that appears or not depending
        // on the type is exactly that inconsistency, so the type gate is gone.
        // The test is not the type but "does the description hold readable text". Plenty of
        // documents store only an empty <p></p> or &nbsp;, so measuring length yields an empty box.
        const usageDescription = String(item.system?.description || '').trim();
        const hasDescriptionText = /\S/.test(
          usageDescription.replace(/<[^>]*>/g, ' ').replace(/&nbsp;|&#160;/gi, ' ')
        );
        if (hasDescriptionText) {
          let enrichedDescription = usageDescription;
          try {
            enrichedDescription = await window.DX3rdDescriptionManager?.createEnrichedBiography?.(
              item, usageDescription
            ) || usageDescription;
          } catch (error) {
            console.warn('DX3rd | Usage description enrichment failed:', item.name, error);
          }
          msg += `<div class="item-description dx3rd-usage-description"><div class="description-content">${enrichedDescription}</div></div>`;
        }
        
        // For a combo, list the member effect names by default
        if (item.type === 'combo') {
          const comboEffectNames = this.comboMemberItems(actor, item)
            .map(eff => eff.name.split('||')[0].trim());
          if (comboEffectNames.length > 0) {
            msg += `<div class="dx3rd-mt-4">· ${game.i18n.localize('DX3rd.ComboEffects')}: ${comboEffectNames.join(', ')}</div>`;
          }
        }

        // With getTarget set and targets picked, append the target list
        if (item.system?.getTarget) {
          const targets = Array.from(game.user.targets);
          if (targets.length > 0) {
            const targetNames = targets.map(t => t.actor?.name || t.name).filter(n => n).join(', ');
            if (targetNames) {
              msg += `<div class="dx3rd-mt-4">· ${game.i18n.localize('DX3rd.Target')}: ${targetNames}</div>`;
            }
          }
        }
        
        // No message when skipMessage is set, or for Lois types '-' / 'S'
        if (!skipMessage && !isRoisWithNoMessage) {
          ChatMessage.create({ 
            content: `<div class="dx3rd-item-chat">${msg}</div>`, 
            speaker: {
              actor: actor.id,
              alias: actor.name
            }
          });
        }
        return true; // item use allowed
      } catch (e) {
        console.error('DX3rd | UniversalHandler.processItemUsageCost failed', e);
        return false; // abort the use on error
      }
    },

    /**
     * Ensure an item's activation channel becomes active when allowed by its lifecycle.
     * A use/attack channel is represented by a frozen AE and must never be converted into
     * active.state merely because a spell reached its invoke step.
     * Optionally re-render the owning actor sheet.
     * @param {Item} item
     * @param {Actor} [actor]
     */
    async ensureActivated(item, actor) {
      try {
        const activeDisable = item?.system?.active?.disable ?? '-';
        // Instant-resolve consumables (disable='-') leave no lingering toggle (see activateItem).
        const skipToggle = item?.type === 'once' && activeDisable === '-';
        // The runTiming gate was missing only here, so a spell whose self-modifiers are authored
        // afterSuccess/afterDamage got switched on at cast time. Each timing has its own activation
        // point (chat-ui's fire button, processCombo*, handleSuccessButton).
        const runTiming = item?.system?.active?.runTiming ?? 'instant';
        const adapter = window.DX3rdItemEffectAdapter;
        if (runTiming !== 'instant' || activeDisable === 'notCheck' || skipToggle
          || !adapter?.usesActivationSelfChannel?.(item) || item.system?.active?.state) return false;
        await this.applySelfModifiers(actor, item, {forceToggle: true, action: 'activation'});
        if (actor?.sheet?.rendered) actor.sheet.render(true);
        return true;
      } catch (e) {
        console.error('DX3rd | UniversalHandler.ensureActivated failed', e);
        return false;
      }
    },

    /**
     * Execute macros from item.system.macro field in sequence.
     * Macros should be formatted as [매크로1][매크로2]...
     * @param {Item} item
     * @param {string} timing - execution timing ('instant', 'afterSuccess', 'afterHits', 'afterDamage')
     */
    macroExecutionPlan(item, timing = 'instant', action = null) {
      const macroField = item.system?.macro;
      const macroMatches = (macroField && typeof macroField === 'string')
        ? (macroField.match(/\[([^\]]+)\]/g) || []) : [];
      const adapter = window.DX3rdItemEffectAdapter;
      const legacyEntries = macroMatches.map(match => {
        const macroName = match.slice(1, -1);
        return { macroName, macro: game.macros?.getName(macroName) || null };
      });
      // Legacy system.macro rows have no authored action. They historically followed only the
      // world macro's runTiming flag, including when an always-on item fired through the separate
      // activation route. Applying the embedded-row action inference here turns that legacy
      // `use` fallback into a silent mismatch with action='activation'.
      const legacyHits = legacyEntries.filter(({ macro }) => macro
        && (macro.getFlag('dx3rd-emanim', 'runTiming') || 'instant') === timing);

      // Embedded macros: system.macros = [{ timing, kind, command, macroName, disabled? }, ...]
      //  - kind:'code' (default): run command inline (self-contained in the compendium, no name lookup)
      //  - kind:'macro': run a world macro by macroName (the folded-in legacy system.macro field)
      const embedded = Array.isArray(item.system?.macros) ? item.system.macros : [];
      const embeddedHits = embedded.filter(m => {
        if (!m || m.disabled) return false;
        const macroTiming = adapter?.inferAction?.(item, 'macro', m) === 'activation'
          ? 'instant'
          : (m.timing || 'instant');
        if (macroTiming !== timing) return false;
        if (adapter && !adapter.macroActionMatches(item, m, action, timing)) return false;
        return (m.kind === 'macro') ? !!m.macroName : !!m.command;
      });
      return {
        legacyHits,
        embeddedHits,
        missingLegacyNames: legacyEntries.filter(({ macro }) => !macro).map(({ macroName }) => macroName)
      };
    },

    hasExecutableMacros(item, timing = 'instant', action = null) {
      const plan = this.macroExecutionPlan(item, timing, action);
      return plan.legacyHits.length > 0 || plan.embeddedHits.length > 0;
    },

    async executeMacros(item, timing = 'instant', action = null) {
      try {
        const { legacyHits, embeddedHits, missingLegacyNames } = this.macroExecutionPlan(item, timing, action);
        for (const macroName of missingLegacyNames) {
          console.warn(`DX3rd | UniversalHandler macro not found: ${macroName}`);
        }
        if (legacyHits.length === 0 && embeddedHits.length === 0) return;

        // Select the owning actor's token
        const ownerActor = item.actor;
        let previousToken = null;
        let ownerToken = null;

        if (ownerActor) {
          // Remember the currently selected token so it can be restored
          previousToken = canvas.tokens?.controlled?.[0] || null;

          // Find the actor's token
          ownerToken = canvas.tokens?.placeables.find(t => t.actor?.id === ownerActor.id) || null;
          if (ownerToken) {
            ownerToken.control({ releaseOthers: true });
          }
        }

        // (1) World macros referenced by name (legacy behavior)
        for (const { macroName, macro } of legacyHits) {
          try {
            await macro.execute();
          } catch (e) {
            console.error(`DX3rd | UniversalHandler macro execution failed: ${macroName}`, e);
          }
        }

        // (2) Embedded macros (the code lives on the item, so a compendium drag keeps working)
        // Context: actor (owner), item (this item), token (owner's token), scope (timing, …)
        for (const em of embeddedHits) {
          try {
            if (em.kind === 'macro') {
              // By name: run the world macro. This embedded row owns the timing (the world macro's runTiming flag is ignored).
              const wm = game.macros?.getName(em.macroName);
              if (wm) await wm.execute({ actor: ownerActor, token: ownerToken });
              else console.warn(`DX3rd | UniversalHandler embedded world-macro not found: ${em.macroName}`);
            } else {
              const AsyncFunction = foundry.utils?.AsyncFunction || Object.getPrototypeOf(async function () {}).constructor;
              const fn = new AsyncFunction('actor', 'item', 'token', 'scope', em.command);
              await fn.call(item, ownerActor, item, ownerToken, { timing });
            }
          } catch (e) {
            console.error(`DX3rd | UniversalHandler embedded macro failed (${item.name} @${timing})`, e);
          }
        }

        // Restore the previously selected token
        if (previousToken && canvas.tokens) {
          previousToken.control({ releaseOthers: true });
        }
      } catch (e) {
        console.error('DX3rd | UniversalHandler.executeMacros failed', e);
      }
    },

    /**
     * Bad-status removal helper. Callable as a one-liner from an embedded macro.
     * @param {Actor} actor - target actor
     * @param {object} opts
     * @param {number} [opts.count=Infinity] - max number to remove (the "up to N" wording)
     * @param {string[]} [opts.exclude=['berserk']] - statuses to keep (the "other than [Berserk]" wording; pass [] to include it)
     * @param {boolean} [opts.prompt=true] - show a picker when more statuses are held than count
     * @returns {Promise<number>} how many were actually removed
     */
    async removeBadStatuses(actor, { count = Infinity, exclude = ['berserk'], prompt = true } = {}) {
      try {
        if (!actor) return 0;
        const BAD = ['poisoned', 'hatred', 'fear', 'berserk', 'rigor', 'pressure', 'dazed'];
        const excl = new Set(exclude || []);
        const pool = BAD.filter(s => !excl.has(s) && actor.effects.find(e => e.statuses?.has(s)));
        if (pool.length === 0) return 0;
        let chosen = pool;
        if (pool.length > count) {
          chosen = prompt ? await this._promptBadStatusChoice(pool, count) : pool.slice(0, count);
          if (!chosen || chosen.length === 0) return 0; // canceled
        }
        for (const s of chosen) await actor.toggleStatusEffect(s, { active: false });
        return chosen.length;
      } catch (e) {
        console.error('DX3rd | removeBadStatuses failed', e);
        return 0;
      }
    },

    /** Dialog letting the player pick which bad statuses to remove (up to count). */
    async _promptBadStatusChoice(pool, count) {
      const DialogV2 = foundry.applications?.api?.DialogV2;
      if (!DialogV2?.wait) {
        ui.notifications.error(game.i18n.localize('DX3rd.DialogV2Unavailable'));
        return [];
      }

      const labelKey = { poisoned: 'Poisoned', hatred: 'Hatred', fear: 'Fear', berserk: 'Berserk', rigor: 'Rigor', pressure: 'Pressure', dazed: 'Dazed' };
      const rows = pool.map(s => `<label style="display:block;"><input type="checkbox" name="${s}"> ${game.i18n.localize('DX3rd.' + labelKey[s])}</label>`).join('');
      const content = `<p>${game.i18n.localize('DX3rd.Remove') || '소거'} (최대 ${count})</p>${rows}`;
      return await DialogV2.wait({
        window: { title: game.i18n.localize('DX3rd.Status') || '배드 스테이터스 소거' },
        content,
        rejectClose: false,
        buttons: [
          {
            action: 'ok',
            label: 'OK',
            default: true,
            callback: (event, button) => {
              const form = button.form;
              const picked = pool.filter(s => form?.querySelector(`input[name="${s}"]`)?.checked);
              return picked.slice(0, count);
            }
          },
          {
            action: 'cancel',
            label: 'Cancel',
            callback: () => []
          }
        ],
        close: () => []
      });
    },

    /**
     * Remove bad statuses from the current targets (game.user.targets). One-liner for embedded macros.
     * Removes directly when the user owns the target actor, otherwise delegates to the GM over the socket.
     * (Changing the other side's token needs GM rights — same pattern as conditionRequest.)
     * @param {object} opts same as removeBadStatuses (count/exclude). prompt is handled by the owning side.
     * @returns {Promise<number>} how many were removed directly (socket-delegated ones excluded)
     */
    async removeBadStatusesOnTargets({ count = Infinity, exclude = ['berserk'] } = {}) {
      try {
        const targets = Array.from(game.user?.targets ?? []);
        if (targets.length === 0) {
          ui.notifications?.warn(game.i18n.localize('DX3rd.NoTarget') || '대상을 지정하세요.');
          return 0;
        }
        let removed = 0;
        const serialCount = Number.isFinite(count) ? count : null; // Infinity is not serializable → null
        const sourceActor = game.user?.character
          || canvas.tokens?.controlled?.find(token => token.actor?.isOwner)?.actor
          || null;
        for (const t of targets) {
          const actor = t.actor;
          if (!actor) continue;
          if (actor.isOwner) {
            removed += await this.removeBadStatuses(actor, { count, exclude });
          } else {
            if (!sourceActor) {
              ui.notifications?.warn(game.i18n.localize('DX3rd.NoCharacter') || '담당 캐릭터를 지정하세요.');
              continue;
            }
            window.DX3rdSocketRouter.emit({
              type: 'removeConditionRequest',
              data: {
                userId: game.user.id,
                sourceActorId: sourceActor.id,
                targetUuid: actor.uuid,
                count: serialCount,
                exclude
              },
            });
          }
        }
        return removed;
      } catch (e) {
        console.error('DX3rd | removeBadStatusesOnTargets failed', e);
        return 0;
      }
    },

    /**
     * Self-revive helper: clear [defeated] and heal HP up to hpTo (+ optional encroachment rise). For embedded macros.
     * "Heal HP up to N" raises HP to N only when it is currently below N (capped at max).
     * @param {Actor} actor
     * @param {object} opts
     * @param {number} [opts.hpTo=1] - target HP ("up to [LV×10]" etc.; evaluate in the macro and pass a number)
     * @param {number} [opts.encroach=0] - side-effect encroachment rise
     * @returns {Promise<boolean>}
     */
    async reviveSelf(actor, { hpTo = 1, encroach = 0 } = {}) {
      try {
        if (!actor) return false;
        const defeated = actor.effects.find(e => e.statuses?.has('dead'));
        if (defeated) await actor.toggleStatusEffect('dead', { active: false });
        const hp = actor.system.attributes?.hp ?? { value: 0, max: 0 };
        const target = Math.min(Number(hpTo) || 1, hp.max);
        const update = {};
        if (hp.value < target) update['system.attributes.hp.value'] = target;
        if (encroach) {
          const enc = actor.system.attributes?.encroachment?.value ?? 0;
          update['system.attributes.encroachment.value'] = enc + Number(encroach);
        }
        if (Object.keys(update).length) await actor.update(update);
        return true;
      } catch (e) {
        console.error('DX3rd | reviveSelf failed', e);
        return false;
      }
    },

    /**
     * D-Lois activation helper (at Titus time): encroachment rise + an applied roll buff. For embedded macros.
     * @param {Actor} actor
     * @param {object} opts
     * @param {number|string} [opts.encroach] - encroachment rise (a number, or a dice formula like "1d10"; dice are rolled to chat)
     * @param {object} [opts.applied] - applied buff {key, name, disable, img, attributes}. attributes match effect applied (critical/major_critical/add/dice/critical_min/stat_bonus_*, …).
     * @returns {Promise<void>}
     */
    async roisActivate(actor, { encroach = null, applied = null } = {}) {
      try {
        if (!actor) return;
        // 1) Encroachment rise (number or dice formula)
        if (encroach !== null && encroach !== undefined && `${encroach}`.trim() !== '' && `${encroach}`.trim() !== '-') {
          const raw = `${encroach}`.trim();
          let amt = 0;
          if (/^\d+$/.test(raw)) amt = parseInt(raw, 10);
          else {
            const roll = await new Roll(raw).roll();
            await roll.toMessage({ speaker: ChatMessage.getSpeaker({ actor }), flavor: (game.i18n.localize('DX3rd.Encroachment') || '침식률') + ' +' });
            amt = roll.total;
          }
          if (amt) {
            const cur = actor.system.attributes?.encroachment?.value ?? 0;
            await actor.update({ 'system.attributes.encroachment.value': cur + amt });
          }
        }
        // 2) Applied roll-modifier buff
        if (applied && applied.attributes && Object.keys(applied.attributes).length) {
          const key = `rois_${applied.key || Date.now()}`;
          await window.DX3rdAppliedEffects.set(actor, key, {
            name: applied.name || 'D로이스', source: actor.name,
            disable: applied.disable || 'roll', img: applied.img || 'icons/svg/aura.svg',
            attributes: applied.attributes,
          });
        }
      } catch (e) {
        console.error('DX3rd | roisActivate failed', e);
      }
    },

    /** GM side: handle a bad-status removal request delegated over the socket by an unprivileged player. */
    async handleRemoveConditionRequest(data) {
      if (!game.user.isGM) return;
      try {
        const actor = await fromUuid(data.targetUuid);
        const targetActor = actor?.actor ?? actor; // .actor when it is a TokenDocument
        if (!targetActor) {
          console.warn('DX3rd | handleRemoveConditionRequest: target not found', data.targetUuid);
          return;
        }
        const count = (data.count === null || data.count === undefined) ? Infinity : data.count;
        await this.removeBadStatuses(targetActor, { count, exclude: data.exclude ?? ['berserk'] });
      } catch (e) {
        console.error('DX3rd | handleRemoveConditionRequest failed', e);
      }
    },

    /**
     * Execute macros from a macro field string.
     * @param {string} macroField
     * @param {string} timing - execution timing ('instant', 'afterSuccess', 'afterHits', 'afterDamage')
     */
    async executeMacrosByField(macroField, timing = 'instant') {
      try {
        if (!macroField || typeof macroField !== 'string') return;

        const macroMatches = macroField.match(/\[([^\]]+)\]/g);
        if (!macroMatches || macroMatches.length === 0) return;

        for (const match of macroMatches) {
          const macroName = match.slice(1, -1);
          const macro = game.macros?.getName(macroName);
          if (macro) {
            // Read the macro's execution timing from its flags
            const macroTiming = macro.getFlag('dx3rd-emanim', 'runTiming') || 'instant';
            
            // Run only when the timing matches
            if (macroTiming === timing) {
              try {
                await macro.execute();
              } catch (e) {
                console.error(`DX3rd | UniversalHandler macro execution failed: ${macroName}`, e);
              }
            } else {
            }
          } else {
            console.warn(`DX3rd | UniversalHandler macro not found: ${macroName}`);
          }
        }
      } catch (e) {
        console.error('DX3rd | UniversalHandler.executeMacrosByField failed', e);
      }
    },

    /**
     * Handle a combo's merged afterSuccess payload
     * @param {Object} comboData - { actorId, comboItemId, activations, macros, applies, extensions }
     */
    resolveComboFollowupItem(actor, comboData, itemId) {
      const embedded = actor?.items?.get?.(itemId);
      if (embedded) return embedded;
      if (itemId !== comboData?.comboItemId || !comboData?.comboItemSnapshot) return null;
      return window.DX3rdHydrateInstantCombo?.(comboData.comboItemSnapshot, actor) || null;
    },

    /** Resolve a serialized token-id snapshot. null means an older card with no frozen targets. */
    resolveComboFollowupTargets(targetTokenIds) {
      if (!Array.isArray(targetTokenIds)) return null;
      const seen = new Set();
      const actors = [];
      for (const tokenId of targetTokenIds) {
        if (!tokenId || seen.has(tokenId)) continue;
        seen.add(tokenId);
        const token = canvas.tokens?.get?.(tokenId)
          || canvas.tokens?.placeables?.find?.(candidate => candidate.id === tokenId);
        if (token?.actor) actors.push(token.actor);
      }
      return actors;
    },

    async processComboAfterSuccess(comboData, options = {}) {
      
      const { actorId, comboItemId, activations = [], macros = [], applies = [], extensions = [], afterMainExtensions = [] } = comboData;
      const actor = game.actors.get(actorId);
      const damageBonus = { attack: 0, attackFormula: '', penetrate: 0 };
      if (!actor) return damageBonus;
      const mergeDamageBonus = bonus => {
        damageBonus.attack += Number(bonus?.attack) || 0;
        damageBonus.attackFormula = this.joinFormulaTerms(damageBonus.attackFormula, bonus?.attackFormula);
        damageBonus.penetrate += Number(bonus?.penetrate) || 0;
      };
      
      // 1. Self modifiers. New combo data stores the action, so only the member's "use"
      // bucket fires. Older chat cards without an action fall back to the legacy activation.
      for (const { itemId, itemName, action = null } of activations) {
        const item = this.resolveComboFollowupItem(actor, comboData, itemId);
        if (!item) continue;
        if (action) {
          if (this.processAfterSuccessSelfModifiers) {
            mergeDamageBonus(await this.processAfterSuccessSelfModifiers(actor, item, {
              action,
              attackItem: options.attackItem || null,
              expiredTimings: options.expiredTimings || [],
              ...(item._dx3rdInstantSnapshot === true ? { forceFrozen: true } : {})
            }));
          } else {
            await this.applySelfModifiers(actor, item, { action, timing: 'afterSuccess' });
          }
        } else if (item.system?.active?.runTiming === 'afterSuccess' && !item.system?.active?.state) {
          await item.update({ 'system.active.state': true });
        }
      }
      
      // 2. Macros
      const executedMacroRuns = new Set();
      for (const { itemId, itemName, macroName, timing, action = null } of macros) {
        const macroRunKey = JSON.stringify([itemId, timing || 'afterSuccess', action]);
        if (executedMacroRuns.has(macroRunKey)) continue;
        executedMacroRuns.add(macroRunKey);
        const item = this.resolveComboFollowupItem(actor, comboData, itemId);
        if (item) {
          await this.executeMacros(item, timing || 'afterSuccess', action);
        }
      }
      
      // 3. Applied effects
      for (const { itemId, itemName, action = null, selectedTargetIds = null, frozenAttributes = null } of applies) {
        const item = this.resolveComboFollowupItem(actor, comboData, itemId);
        if (item) {
          const forcedTargets = this.resolveComboFollowupTargets(selectedTargetIds);
          await this.applyToTargets(actor, item, 'afterSuccess', forcedTargets, action,
            { frozenAttributes });
        }
      }
      
      // 4. Merged extensions
      for (const bucket of extensions) {
        if (bucket.type === 'heal' && !bucket.custom) {
          const healData = {
            formulaDice: bucket.merged?.dice || 0,
            formulaAdd: bucket.merged?.add || 0,
            target: bucket.target,
            selectedTargetIds: bucket.selectedTargetIds || [],
            resurrect: bucket.resurrect || false,
            rivival: bucket.rivival || false,
            triggerItemName: actor.items.get(comboItemId)?.name || '콤보'
          };
          await this.executeHealExtensionNow(actor, healData, null);
        } else if (bucket.type === 'damage') {
          const damageData = this.damageDataFromExtensionBucket(bucket, {
            triggerItemName: actor.items.get(comboItemId)?.name || '콤보'
          });
          await this.executeDamageExtensionNow(actor, damageData, null);
        } else if (bucket.type === 'condition' && !bucket.custom) {
          const conditionTypes = bucket.merged?.conditions || [];
          await this.executeConditionExtensionsNowBulk(actor, {
            conditionTypes,
            target: bucket.target,
            selectedTargetIds: bucket.selectedTargetIds || [],
            triggerItemName: actor.items.get(comboItemId)?.name || '콤보',
            poisonedRank: bucket.poisonedRank || null,
            itemId: bucket.sourceItemId || null,
            duration: bucket.duration || null,
            sourceActorId: bucket.sourceActorId || actor.id
          });
        } else if (bucket.type === 'statusClear') {
          for (const source of bucket.sources || []) {
            const sourceItem = this.resolveComboFollowupItem(actor, comboData, source.itemId);
            await this.executeStatusClearExtension(actor, {
              ...(source.raw?.extensionData || {}),
              target: bucket.target,
              selectedTargetIds: bucket.selectedTargetIds || [],
              triggerItemName: actor.items.get(comboItemId)?.name || '콤보'
            }, sourceItem || null);
          }
        } else if (bucket.type === 'weapon' || bucket.type === 'protect' || bucket.type === 'vehicle') {
          // Item creation never runs at afterSuccess (instant only)
        }
      }
      
      // 5. Queue the afterMain extensions (when runTiming is afterSuccess)
      for (const bucket of afterMainExtensions) {
        if (bucket.type === 'heal') {
          const healData = {
            formulaDice: bucket.merged?.dice || 0,
            formulaAdd: bucket.merged?.add || 0,
            target: bucket.target,
            selectedTargetIds: bucket.selectedTargetIds || [],
            resurrect: bucket.resurrect || false,
            rivival: bucket.rivival || false,
            triggerItemName: actor.items.get(comboItemId)?.name || '콤보'
          };
          await this.addToAfterMainQueue(actor, healData, null, 'heal');
        } else if (bucket.type === 'damage') {
          const damageData = this.damageDataFromExtensionBucket(bucket, {
            triggerItemName: actor.items.get(comboItemId)?.name || '콤보'
          });
          await this.addToAfterMainQueue(actor, damageData, null, 'damage');
        } else if (bucket.type === 'condition') {
          const conditionData = {
            conditionTypes: bucket.merged?.conditions || [],
            target: bucket.target,
            selectedTargetIds: bucket.selectedTargetIds || [],
            triggerItemName: actor.items.get(comboItemId)?.name || '콤보',
            poisonedRank: bucket.poisonedRank || null,
            itemId: bucket.sourceItemId || null,
            duration: bucket.duration || null,
            sourceActorId: bucket.sourceActorId || actor.id
          };
          await this.addToAfterMainQueue(actor, conditionData, null, 'condition');
        } else if (bucket.type === 'statusClear') {
          for (const source of bucket.sources || []) {
            const sourceItem = this.resolveComboFollowupItem(actor, comboData, source.itemId);
            await this.addToAfterMainQueue(actor, {
              ...(source.raw?.extensionData || {}),
              target: bucket.target,
              selectedTargetIds: bucket.selectedTargetIds || [],
              triggerItemName: actor.items.get(comboItemId)?.name || '콤보'
            }, sourceItem || null, 'statusClear');
          }
        }
      }
      await window.DX3rdInstantComboRetention?.complete?.(actor, comboItemId, 'afterSuccess');
      return damageBonus;
    },

    /**
     * Handle a combo's merged afterDamage payload
     * @param {Object} comboData - { actorId, comboItemId, activations, macros, applies, extensions }
     * @param {Array} damagedActors - actors that took HP damage (optional)
     * @param {string[]} frozenDamagedTokenIds - token ids captured by the damage request (optional)
     */
    async processComboAfterDamage(comboData, damagedActors = null, frozenDamagedTokenIds = null) {
      
      const { actorId, comboItemId, activations = [], macros = [], applies = [], extensions = [], afterMainExtensions = [] } = comboData;
      const actor = game.actors.get(actorId);
      if (!actor) return;
      const damagedTokenIds = Array.isArray(frozenDamagedTokenIds)
        ? [...new Set(frozenDamagedTokenIds.filter(Boolean))]
        : (damagedActors || []).map(damagedActor => {
          const token = canvas.tokens.placeables.find(t => t.actor?.id === damagedActor.id);
          return token?.id;
        }).filter(Boolean);
      const afterDamageTarget = bucket => window.DX3rdRuntimeUtils.resolveAfterDamageTarget(
        bucket?.target,
        damagedTokenIds,
        bucket?.selectedTargetIds || []
      );
      
      // 1. Self modifiers. A member only fires the serialized "use" action.
      for (const { itemId, itemName, action = null } of activations) {
        const item = this.resolveComboFollowupItem(actor, comboData, itemId);
        if (!item) continue;
        if (action) {
          await this.applySelfModifiers(actor, item, {
            action,
            timing: 'afterDamage',
            ...(item._dx3rdInstantSnapshot === true ? { forceFrozen: true } : {})
          });
        } else {
          // Compatibility with older chat cards that carry no action
          const activeDisable = item.system?.active?.disable ?? '-';
          if (item.system?.active?.runTiming === 'afterDamage' && !item.system?.active?.state && activeDisable !== 'notCheck') {
            await item.update({ 'system.active.state': true });
          }
        }
      }
      
      // 2. Macros
      const executedMacroRuns = new Set();
      for (const { itemId, itemName, macroName, timing, action = null } of macros) {
        const macroRunKey = JSON.stringify([itemId, timing || 'afterDamage', action]);
        if (executedMacroRuns.has(macroRunKey)) continue;
        executedMacroRuns.add(macroRunKey);
        const item = this.resolveComboFollowupItem(actor, comboData, itemId);
        if (item) {
          try {
            await this.executeMacros(item, timing || 'afterDamage', action);
          } catch (e) {
            console.warn(`DX3rd | Combo afterDamage - Macro execution failed: ${itemName}`, e);
          }
        }
      }
      
      // 3. Applied effects
      for (const { itemId, itemName, action = 'attack', frozenAttributes = null } of applies) {
        const item = this.resolveComboFollowupItem(actor, comboData, itemId);
        if (item) {
          // Pass damagedActors through as forcedTargets. frozenAttributes was evaluated at
          // use time on the item-use client, so runtime input / pre-use encroachment survive.
          await this.applyToTargets(actor, item, 'afterDamage', damagedActors, action,
            { frozenAttributes });
        }
      }
      
      // 4. Merged extensions
      for (const bucket of extensions) {
        if (bucket.type === 'heal' && !bucket.custom) {
          const targetData = afterDamageTarget(bucket);
          const healData = {
            formulaDice: bucket.merged?.dice || 0,
            formulaAdd: bucket.merged?.add || 0,
            ...targetData,
            resurrect: bucket.resurrect || false,
            rivival: bucket.rivival || false,
            triggerItemName: actor.items.get(comboItemId)?.name || '콤보'
          };
          await this.executeHealExtensionNow(actor, healData, null);
        } else if (bucket.type === 'damage') {
          const targetData = afterDamageTarget(bucket);
          const damageData = this.damageDataFromExtensionBucket(bucket, {
            ...targetData,
            triggerItemName: actor.items.get(comboItemId)?.name || '콤보'
          });
          await this.executeDamageExtensionNow(actor, damageData, null);
        } else if (bucket.type === 'condition' && !bucket.custom) {
          const targetData = afterDamageTarget(bucket);
          const conditionTypes = bucket.merged?.conditions || [];
          await this.executeConditionExtensionsNowBulk(actor, {
            conditionTypes,
            ...targetData,
            triggerItemName: actor.items.get(comboItemId)?.name || '콤보',
            poisonedRank: bucket.poisonedRank || null,
            itemId: bucket.sourceItemId || null,
            duration: bucket.duration || null,
            sourceActorId: bucket.sourceActorId || actor.id
          });
        } else if (bucket.type === 'statusClear') {
          for (const source of bucket.sources || []) {
            const sourceItem = this.resolveComboFollowupItem(actor, comboData, source.itemId);
            const originalTarget = bucket.target || source.raw?.extensionData?.target || 'self';
            const targetData = window.DX3rdRuntimeUtils.resolveAfterDamageTarget(
              originalTarget, damagedTokenIds, bucket.selectedTargetIds || []);
            await this.executeStatusClearExtension(actor, {
              ...(source.raw?.extensionData || {}),
              ...targetData,
              triggerItemName: actor.items.get(comboItemId)?.name || '콤보'
            }, sourceItem || null);
          }
        } else if (bucket.type === 'weapon' || bucket.type === 'protect' || bucket.type === 'vehicle') {
          // Item creation never runs at afterDamage (instant only)
          window.DX3rdDebug.log(`DX3rd | Combo afterDamage - Skipping item creation (${bucket.type})`);
        }
      }
      
      // 5. Queue the afterMain extensions (when runTiming is afterDamage)
      window.DX3rdDebug.log('DX3rd | processComboAfterDamage - Registering afterMain extensions:', afterMainExtensions.length);
      for (const bucket of afterMainExtensions) {
        window.DX3rdDebug.log('DX3rd | processComboAfterDamage - Registering afterMain:', bucket.type, 'merged:', bucket.merged);
        if (bucket.type === 'heal') {
          const targetData = afterDamageTarget(bucket);
          const healData = {
            formulaDice: bucket.merged?.dice || 0,
            formulaAdd: bucket.merged?.add || 0,
            ...targetData,
            resurrect: bucket.resurrect || false,
            rivival: bucket.rivival || false,
            triggerItemName: actor.items.get(comboItemId)?.name || '콤보'
          };
          await this.addToAfterMainQueue(actor, healData, null, 'heal');
        } else if (bucket.type === 'damage') {
          const targetData = afterDamageTarget(bucket);
          const damageData = this.damageDataFromExtensionBucket(bucket, {
            ...targetData,
            triggerItemName: actor.items.get(comboItemId)?.name || '콤보'
          });
          await this.addToAfterMainQueue(actor, damageData, null, 'damage');
        } else if (bucket.type === 'condition') {
          const targetData = afterDamageTarget(bucket);
          const conditionData = {
            conditionTypes: bucket.merged?.conditions || [],
            ...targetData,
            triggerItemName: actor.items.get(comboItemId)?.name || '콤보',
            poisonedRank: bucket.poisonedRank || null,
            itemId: bucket.sourceItemId || null,
            duration: bucket.duration || null,
            sourceActorId: bucket.sourceActorId || actor.id
          };
          await this.addToAfterMainQueue(actor, conditionData, null, 'condition');
        } else if (bucket.type === 'statusClear') {
          for (const source of bucket.sources || []) {
            const sourceItem = this.resolveComboFollowupItem(actor, comboData, source.itemId);
            const originalTarget = bucket.target || source.raw?.extensionData?.target || 'self';
            const targetData = window.DX3rdRuntimeUtils.resolveAfterDamageTarget(
              originalTarget, damagedTokenIds, bucket.selectedTargetIds || []);
            await this.addToAfterMainQueue(actor, {
              ...(source.raw?.extensionData || {}),
              ...targetData,
              triggerItemName: actor.items.get(comboItemId)?.name || '콤보'
            }, sourceItem || null, 'statusClear');
          }
        }
      }
      await window.DX3rdInstantComboRetention?.complete?.(actor, comboItemId, 'afterDamage');
      
    },

    /**
     * Handle a click on the success button
     * @param {string} actorId - actor id
     * @param {string} itemId - item id
     * @param {string} previousTokenId - id of the previously selected token
     */
    async handleSuccessButton(actorId, itemId, previousTokenId = null, weaponAttack = 0, options = {}) {
      try {
        if (!actorId) return;
        
        const actor = game.actors.get(actorId);
        if (!actor) return;
        
        // Permission check
        if (!actor.isOwner && !game.user.isGM) {
          console.warn('DX3rd | User lacks permission to use this actor\'s actions');
          return;
        }
        
        // Auto-select the actor's token, if any
        let restoredToken = null;
        if (actor && canvas.tokens) {
          // Remember the currently selected token
          const currentToken = canvas.tokens.controlled?.[0] || null;
          
          // Find the actor's token
          const actorToken = canvas.tokens.placeables.find(t => t.actor?.id === actor.id);
          if (actorToken) {
            actorToken.control({ releaseOthers: true });
            restoredToken = currentToken; // restored afterwards
          }
        }
        
        // With an item, run the success timing
        if (itemId) {
          const item = actor.items.get(itemId);
          if (item) {
            const successAction = window.DX3rdItemEffectAdapter?.eventAction(item, 'afterSuccess')
              || (item.system?.attackRoll && item.system.attackRoll !== '-' ? 'attack' : 'use');
            const actionMatches = (kind, data) => !window.DX3rdItemEffectAdapter
              || window.DX3rdItemEffectAdapter.extensionActionMatches(item, kind, data, successAction, 'afterSuccess');
            // 0. Run 'afterSuccess' macros
            await this.executeMacros(item, 'afterSuccess', successAction);
            
            // 1. Apply the matching self bucket. A roll/major lifetime already ended before this
            // button existed, so it must not be left on the actor for the next check.
            if (this.processAfterSuccessSelfModifiers) {
              await this.processAfterSuccessSelfModifiers(actor, item, {
                action: successAction,
                expiredTimings: options.expiredTimings || []
              });
            } else {
              const activeDisable = item.system?.active?.disable ?? '-';
              if (actionMatches('selfModifiers', item.system?.active || {})
                && item.system.active?.runTiming === 'afterSuccess'
                && !item.system.active?.state && activeDisable !== 'notCheck') {
                await item.update({ 'system.active.state': true });
              }
            }
            
            // 2. Apply target effects for 'afterSuccess' (effect.runTiming === 'afterSuccess')
            // A snapshot armed at use time carries the bucket frozen while the runtime context was
            // still alive; older cards without one fall back to evaluating now.
            const frozenApplyAttrs = await this.takePendingAfterSuccessApply(actor, item, successAction);
            await this.applyToTargets(actor, item, 'afterSuccess', null, successAction,
              { frozenAttributes: frozenApplyAttrs });
            
            // 3. Route afterSuccess heal/damage/condition extensions through the GM
            const itemExtend = item.getFlag('dx3rd-emanim', 'itemExtend') || {};
            const selectedTargetIds = Array.from(game.user.targets).map(t => t.id);
            
            // heal afterSuccess
            if (itemExtend.heal?.activate && itemExtend.heal?.timing === 'afterSuccess' && actionMatches('heal', itemExtend.heal)) {
              
              const healDataWithTargets = {
                ...itemExtend.heal,
                selectedTargetIds,
                triggerItemName: item.name,
                triggerItemId: item.id
              };
              
              // The GM handles it directly (no socket emit)
              if (game.user.isGM) {
                await this.handleHealRequest({
                  actorId: actor.id,
                  healData: healDataWithTargets,
                  itemId: item.id
                });
              } else {
                // A player only emits over the socket
                window.DX3rdSocketRouter.emit({
                  type: 'healRequest',
                  requestData: {
                    actorId: actor.id,
                    healData: healDataWithTargets,
                    itemId: item.id
                  }
                });
              }
            }
            
            // damage afterSuccess
            if (itemExtend.damage?.activate && itemExtend.damage?.timing === 'afterSuccess' && actionMatches('damage', itemExtend.damage)) {
              
              let damageDataWithTargets = {
                ...itemExtend.damage,
                selectedTargetIds,
                triggerItemName: item.name,
                triggerItemId: item.id
              };
              
              // The GM handles it directly (no socket emit)
              if (game.user.isGM) {
                await this.handleDamageRequest({
                  actorId: actor.id,
                  damageData: damageDataWithTargets,
                  itemId: item.id
                });
              } else {
                // Player: the conditional-formula prompt is local; only the confirmed value goes to the GM
                if (damageDataWithTargets.conditionalFormula) {
                  const customFormula = await this.promptConditionalDamageFormula();
                  if (!customFormula) {
                    ui.notifications.warn('조건부 공식 입력이 취소되어 HP 데미지 익스텐션을 건너뜁니다.');
                  } else {
                    damageDataWithTargets = {
                      ...damageDataWithTargets,
                      formulaDice: customFormula.dice,
                      formulaAdd: customFormula.add,
                      conditionalFormula: false
                    };
                    window.DX3rdSocketRouter.emit({
                      type: 'damageRequest',
                      requestData: {
                        actorId: actor.id,
                        damageData: damageDataWithTargets,
                        itemId: item.id
                      }
                    });
                  }
                } else {
                  window.DX3rdSocketRouter.emit({
                    type: 'damageRequest',
                    requestData: {
                      actorId: actor.id,
                      damageData: damageDataWithTargets,
                      itemId: item.id
                    }
                  });
                }
              }
            }
            
            // condition afterSuccess (conditions array, or the older single-entry shape)
            const condEntries = this._getConditionEntries(itemExtend.condition || {});
            const afterSuccessConds = condEntries.filter(c => c.timing === 'afterSuccess' && actionMatches('condition', c));
            for (const c of afterSuccessConds) {
              const conditionDataWithTargets = {
                ...c,
                selectedTargetIds,
                triggerItemName: item.name,
                triggerItemId: item.id
              };
              
              await this.executeConditionExtensionNow(actor, conditionDataWithTargets, item);
            }

            // status clear, afterSuccess
            if (itemExtend.statusClear?.activate && itemExtend.statusClear?.timing === 'afterSuccess' && actionMatches('statusClear', itemExtend.statusClear)) {
              await this.executeStatusClearExtension(actor, {
                ...itemExtend.statusClear,
                selectedTargetIds,
                triggerItemName: item.name,
                triggerItemId: item.id
              }, item);
            }

            const cardEntries = (window.DX3rdItemEffectAdapter?.extensionEntries?.(itemExtend) || [])
              .filter(entry => !entry.legacy && entry.data?.activate && entry.data?.timing === 'afterSuccess'
                && actionMatches(entry.type, entry.data));
            for (const entry of cardEntries) {
              await this.executeItemExtension(actor, entry.type, {
                ...entry.data, selectedTargetIds, triggerItemName: item.name, triggerItemId: item.id
              }, item);
            }
            
            // When runTiming is afterSuccess, queue the afterMain extensions
            if (item.system.active?.runTiming === 'afterSuccess') {
              await this.registerAfterMainExtensions(actor, item, itemExtend, successAction);
            }
          }
        }
        
        // Restore the previous token (when previousTokenId was given)
        if (previousTokenId && canvas.tokens) {
          const tokenToRestore = canvas.tokens.placeables.find(t => t.id === previousTokenId);
          if (tokenToRestore) {
            tokenToRestore.control({ releaseOthers: true });
          }
        } else if (restoredToken && canvas.tokens) {
          // Without previousTokenId, fall back to the token stashed above
          restoredToken.control({ releaseOthers: true });
        }
        
      } catch (e) {
        console.error('DX3rd | handleSuccessButton failed', e);
      }
    },

    async activateItem(actor, item) {
      if (!actor || !item) return false;

      const activeDisable = item.system?.active?.disable ?? '-';
      // Instant-resolve consumables (disable='-') leave no lingering toggle — they spend the used
      // counter without setting active.state (with no expiry timing it would never turn off, and it contributes nothing).
      // Timed consumables (disable=<timing>) are switched on as usual and expire at that timing.
      const skipToggle = item.type === 'once' && activeDisable === '-';
      if (item.system?.active?.runTiming === 'instant' && !item.system?.active?.state && activeDisable !== 'notCheck' && !skipToggle) {
        await item.update({'system.active.state': true});
        window.DX3rdDebug.log('DX3rd | UniversalHandler.activateItem - Item activated:', item.name);
      }
      return true;
    },

    /**
     * Verify the per-type roll configuration before any cost or usage count is spent.
     * A late failure inside a type handler cannot refund what was already paid, so anything
     * statically checkable about the skill/roll data is rejected ahead of the shared pipeline.
     */
    validateItemUsePreflight(actor, item, itemType, action) {
      const requiresResolvedSkill = (
        (itemType === 'weapon' || itemType === 'vehicle') && action === 'attack'
      ) || (
        (itemType === 'effect' || itemType === 'psionic')
        && ((item.system?.roll ?? '-') !== '-'
          || (item.system?.attackRoll && item.system.attackRoll !== '-'))
      ) || (
        itemType === 'connection' && item.system?.skill && item.system.skill !== '-'
      );

      if (requiresResolvedSkill) {
        const skillKey = item.system?.skill;
        const resolved = skillKey && skillKey !== '-' ? this.resolveStatAndLabel(actor, item) : null;
        if (!resolved?.stat) {
          ui.notifications.warn(game.i18n.localize('DX3rd.SkillNotFound'));
          return false;
        }
      }

      if (itemType === 'book' && !actor.system?.attributes?.skills?.cthulhu) {
        ui.notifications.warn(game.i18n.localize('DX3rd.SkillNotFound'));
        return false;
      }

      if (itemType === 'combo' && window.DX3rdComboHandler?.validateUse) {
        return window.DX3rdComboHandler.validateUse(actor, item) !== false;
      }
      return true;
    },

    /**
     * A non-attack item may prepare an on-hit target modifier for the next attack
     * (for example, special ammunition used during the minor process). The item-use client owns
     * the transient formula inputs, so freeze the target bucket now and persist only that snapshot.
     */
    async armPendingAttackRider(actor, item, action = 'use') {
      const adapter = window.DX3rdItemEffectAdapter;
      if (!actor || !item) return false;
      const isAttackItem = adapter?.isAttackItem?.(item) === true;
      // 'use' arms a non-attack preparation item's rider for the next attack. 'attack' carries the
      // attack item's own afterDamage target bucket through the same frozen carrier — its formulas
      // must be captured now, while _dx3rdRuntimeInput / _dx3rdUsageEncLevel are still alive, because
      // the damage roll and the after-damage report run detached after this function's finally.
      // A combo's own bucket is excluded: collectAfterDamageData freezes it into the apply entries.
      // The fromAttackItem marker keeps processDamagedAttackRiders from re-applying the
      // 'afterDamage' snapshot — the activation path applies it to damaged targets only, as
      // shouldApplyToTargets always did. Its 'afterHit' sibling still runs on the on-hit path.
      const selfAttack = action === 'attack' && isAttackItem && item.type !== 'combo';
      if (!selfAttack && (action !== 'use' || isAttackItem)) return false;

      const bucketFires = adapter
        ? adapter.targetFiresAt(item, 'attack', 'afterDamage')
        : item.system?.effect?.runTiming === 'afterDamage';
      const targetAttributes = bucketFires
        ? (adapter
          ? adapter.targetBucketAttributes(item, 'attack', 'afterDamage')
          : (item.system?.effect?.attributes || {}))
        : {};
      // The on-hit sibling bucket. 'afterHit' fires on attackHit alone — a hit reduced to
      // 0 HP damage still applies it, while a miss never does.
      const hitBucketFires = adapter
        ? adapter.targetFiresAt(item, 'attack', 'afterHit')
        : item.system?.effect?.runTiming === 'afterHit';
      const hitAttributes = hitBucketFires
        ? (adapter
          ? adapter.targetBucketAttributes(item, 'attack', 'afterHit')
          : (item.system?.effect?.attributes || {}))
        : {};

      // A preparation item may carry afterDamage extensions without any target bucket
      // (poison applied to the damaged token, etc.). They ride the same carrier and are
      // executed by the damage-report queue against damaged targets. The attack item's own
      // extensions are read live in handleDamageApply, so a selfAttack rider carries none.
      // Combos merge member extensions through collectAfterDamageData instead.
      const extensions = (!selfAttack && item.type !== 'combo')
        ? this.riderAfterDamageExtensions(item)
        : [];
      if (!this.hasUsableAttribute(targetAttributes) && !this.hasUsableAttribute(hitAttributes)
          && extensions.length === 0) return false;

      const rider = {
        itemId: item.id,
        itemName: item.name,
        targetAttributes: this.freezeTransferredItemAttributes(actor, item, targetAttributes),
        hitAttributes: this.freezeTransferredItemAttributes(actor, item, hitAttributes),
        preEvaluated: true,
        armedAt: Date.now(),
        ...(extensions.length > 0 ? { extensions } : {}),
        ...(selfAttack ? { fromAttackItem: true } : {})
      };
      const pending = foundry.utils.deepClone(actor.getFlag?.('dx3rd-emanim', 'pendingAttackRiders') || []);
      const riders = Array.isArray(pending) ? pending.filter(entry => entry?.itemId !== item.id) : [];
      riders.push(rider);
      await actor.setFlag('dx3rd-emanim', 'pendingAttackRiders', riders);
      window.DX3rdDebug.log('DX3rd | Armed after-damage rider for the next attack:', item.name);
      return true;
    },

    /**
     * The itemExtend extensions a preparation item carries onto the next attack's damage report.
     * Mirrors the combo member rule (memberExtensionActionMatches): every action rides except
     * 'activation'. Item-creation extensions are excluded, as in the combo afterDamage collection.
     */
    riderAfterDamageExtensions(item) {
      const adapter = window.DX3rdItemEffectAdapter;
      const itemExtend = item?.getFlag?.('dx3rd-emanim', 'itemExtend');
      if (!itemExtend) return [];
      const entries = adapter?.extensionEntries?.(itemExtend)
        || Object.entries(itemExtend).map(([type, data]) => ({type, data}));
      const out = [];
      for (const entry of entries) {
        const data = entry.data || {};
        if (!data.activate) continue;
        if ((data.timing || 'instant') !== 'afterDamage') continue;
        if (['weapon', 'protect', 'vehicle'].includes(entry.type)) continue;
        if (adapter && adapter.inferAction(item, entry.type, data) === 'activation') continue;
        out.push({type: entry.type, data: foundry.utils.deepClone(data)});
      }
      return out;
    },

    /**
     * Freeze a non-combo item's own afterSuccess target bucket for the success button.
     * handleSuccessButton runs detached at click time — after handleItemUse has restored
     * _dx3rdRuntimeInput / _dx3rdUsageEncLevel — so the snapshot must be taken now, like
     * armPendingAttackRider does for the afterDamage bucket. Combos freeze theirs into
     * collectAfterSuccessData's apply entries instead.
     */
    async armPendingAfterSuccessApply(actor, item) {
      const adapter = window.DX3rdItemEffectAdapter;
      if (!actor || !item || item.type === 'combo') return false;
      const successAction = adapter?.eventAction?.(item, 'afterSuccess')
        || (item.system?.attackRoll && item.system.attackRoll !== '-' ? 'attack' : 'use');
      if (adapter && !adapter.targetFiresAt(item, successAction, 'afterSuccess')) return false;
      if (!adapter && item.system?.effect?.runTiming !== 'afterSuccess') return false;

      const targetAttributes = adapter
        ? adapter.targetBucketAttributes(item, successAction, 'afterSuccess')
        : (item.system?.effect?.attributes || {});
      if (!this.hasUsableAttribute(targetAttributes)) return false;

      const entry = {
        itemId: item.id,
        itemName: item.name,
        action: successAction,
        targetAttributes: this.freezeTransferredItemAttributes(actor, item, targetAttributes),
        armedAt: Date.now()
      };
      const pending = foundry.utils.deepClone(actor.getFlag?.('dx3rd-emanim', 'pendingAfterSuccessApply') || []);
      const entries = Array.isArray(pending) ? pending.filter(e => e?.itemId !== item.id) : [];
      entries.push(entry);
      await actor.setFlag('dx3rd-emanim', 'pendingAfterSuccessApply', entries);
      window.DX3rdDebug.log('DX3rd | Armed after-success apply snapshot:', item.name);
      return true;
    },

    /**
     * Consume the afterSuccess apply snapshot armed at use time (see armPendingAfterSuccessApply).
     * Returns the frozen target attributes, or null when this use carried none — callers then
     * fall back to evaluating the bucket now, as they always did. When the caller's resolved
     * action differs from the armed bucket's, the snapshot stays for a path that matches —
     * feeding the wrong bucket to targetActionMatches would silently drop the apply.
     */
    async takePendingAfterSuccessApply(actor, item, action = null) {
      if (!actor || !item) return null;
      const pending = actor.getFlag?.('dx3rd-emanim', 'pendingAfterSuccessApply');
      const entry = Array.isArray(pending) ? pending.find(e => e?.itemId === item.id) : null;
      if (!entry) return null;
      if (action && entry.action && entry.action !== action) return null;
      const rest = pending.filter(e => e?.itemId !== item.id);
      if (rest.length) await actor.setFlag('dx3rd-emanim', 'pendingAfterSuccessApply', rest);
      else await actor.unsetFlag('dx3rd-emanim', 'pendingAfterSuccessApply');
      return entry.targetAttributes || null;
    },

    /** Move every prepared rider onto one concrete attack card, then clear the actor-side pending state. */
    async bindPendingAttackRiders(actor, attackMessage) {
      if (!actor || !attackMessage) return [];
      const pending = foundry.utils.deepClone(actor.getFlag?.('dx3rd-emanim', 'pendingAttackRiders') || []);
      if (!Array.isArray(pending) || pending.length === 0) {
        return attackMessage.getFlag?.('dx3rd-emanim', 'attackAfterDamageRiders') || [];
      }

      const existing = foundry.utils.deepClone(
        attackMessage.getFlag?.('dx3rd-emanim', 'attackAfterDamageRiders') || []);
      const byItem = new Map((Array.isArray(existing) ? existing : [])
        .filter(entry => entry?.itemId)
        .map(entry => [entry.itemId, entry]));
      for (const rider of pending) {
        if (rider?.itemId) byItem.set(rider.itemId, rider);
      }
      const bound = [...byItem.values()];
      await attackMessage.setFlag('dx3rd-emanim', 'attackAfterDamageRiders', bound);
      await actor.unsetFlag('dx3rd-emanim', 'pendingAttackRiders');
      window.DX3rdDebug.log('DX3rd | Bound pending after-damage riders to attack card:', bound.length);
      return bound;
    },

    /** Apply attack-card rider on-hit buckets to the token-correlated actors that the attack hit. */
    async processPendingAttackRiders(attacker, riders, hitActorIds = [], hitTokenIds = []) {
      if (!attacker || !Array.isArray(riders) || riders.length === 0) return;
      const hitActors = (hitTokenIds || [])
        .map(tokenId => canvas.tokens.get(tokenId)?.actor)
        .filter(Boolean);
      for (const actorId of hitActorIds || []) {
        const targetActor = game.actors.get(actorId);
        if (targetActor && !hitActors.some(candidate => candidate.id === targetActor.id)) {
          hitActors.push(targetActor);
        }
      }

      for (const rider of riders) {
        // Only the 'afterHit' bucket resolves here — an attack hit is the whole trigger, so even a
        // hit reduced to 0 HP damage applies it. The attack item's own bucket (fromAttackItem)
        // runs here too: no other path fires 'afterHit' for it. The 'afterDamage' bucket is a
        // different contract — see processDamagedAttackRiders / the shouldApplyToTargets path.
        if (!this.hasUsableAttribute(rider?.hitAttributes)) continue;
        const sourceItem = attacker.items.get(rider?.itemId);
        if (!sourceItem) {
          console.warn('DX3rd | Pending attack rider item not found:', rider?.itemId);
          continue;
        }
        for (const targetActor of hitActors) {
          await this.dispatchItemAttributes(
            attacker,
            sourceItem,
            targetActor,
            rider.hitAttributes || {},
            {preEvaluated: rider.preEvaluated === true}
          );
        }
      }
    },

    /**
     * Apply preparation riders' 'afterDamage' buckets to the actors that actually lost HP.
     * The attack item's own bucket (fromAttackItem) is excluded — the activation path applies it
     * through shouldApplyToTargets with the same frozen snapshot.
     */
    async processDamagedAttackRiders(attacker, riders, damagedActors = []) {
      if (!attacker || !Array.isArray(riders) || riders.length === 0) return;
      const targets = (Array.isArray(damagedActors) ? damagedActors : []).filter(Boolean);
      if (targets.length === 0) return;
      for (const rider of riders) {
        if (rider?.fromAttackItem === true) continue;
        // Extension-only riders carry no modifier bucket — their payload runs through the
        // damage-report extension queue instead, and an empty apply would write an empty AE.
        if (!this.hasUsableAttribute(rider?.targetAttributes)) continue;
        const sourceItem = attacker.items.get(rider?.itemId);
        if (!sourceItem) {
          console.warn('DX3rd | Pending attack rider item not found:', rider?.itemId);
          continue;
        }
        for (const targetActor of targets) {
          await this.dispatchItemAttributes(
            attacker,
            sourceItem,
            targetActor,
            rider.targetAttributes || {},
            {preEvaluated: rider.preEvaluated === true}
          );
        }
      }
    },

    /**
     * Combo 'afterHit' target buckets — resolve against the actors the attack hit, including hits
     * that dealt 0 HP damage. Runs independently of processComboAfterDamage so a fully guarded
     * hit still fires the hit follow-up while the damage-triggered sections stay silent.
     */
    async processComboAfterHit(comboData, hitActorIds = [], hitTokenIds = []) {
      if (!comboData) return;
      const actor = game.actors.get(comboData.actorId);
      if (!actor) return;
      const hitActors = (hitTokenIds || [])
        .map(tokenId => canvas.tokens.get(tokenId)?.actor)
        .filter(Boolean);
      for (const actorId of hitActorIds || []) {
        const targetActor = game.actors.get(actorId);
        if (targetActor && !hitActors.some(candidate => candidate.id === targetActor.id)) {
          hitActors.push(targetActor);
        }
      }
      for (const { itemId, itemName, action = 'attack', frozenAttributes = null } of (comboData.hitApplies || [])) {
        const item = this.resolveComboFollowupItem(actor, comboData, itemId);
        if (!item) continue;
        // Pass hitActors through as forcedTargets — an authoritative frozen set, like
        // damagedActors on the afterDamage path.
        await this.applyToTargets(actor, item, 'afterHit', hitActors, action,
          { frozenAttributes });
      }
    },

    /**
     * Handle an item use (including the getTarget check)
     * @param {string} actorId - actor id
     * @param {string} itemId - item id
     * @param {string} itemType - item type
     * @param {string} roisAction - Lois action (optional)
     * @param {boolean} getTarget - the getTarget setting (optional)
     */
    async handleItemUse(actorId, itemId, itemType, roisAction, getTarget, options = {}) {
      if (!actorId || !itemId) {
        return false;
      }
      
      const actor = game.actors.get(actorId);
      if (!actor) {
        return false;
      }
      
      const item = actor.items.get(itemId);
      if (!item) {
        return false;
      }
      // Connections and books used to choose plain-roll vs combo inside their type handler,
      // by which point cost and usage count were already spent. The choice is hoisted ahead of
      // the shared cost gate so cancelling — or merely opening the builder — costs nothing.
      const connectionHasRoll = itemType === 'connection'
        && item.system?.skill && item.system.skill !== '-';
      if ((connectionHasRoll || itemType === 'book') && options.comboMode === undefined) {
        if (typeof window.DX3rdChooseRollMode !== 'function') {
          ui.notifications.error(game.i18n.localize('DX3rd.DialogV2Unavailable'));
          return false;
        }
        const useCombo = await window.DX3rdChooseRollMode(options.menuAnchor);
        if (useCombo === null) return false;
        if (useCombo) {
          let created;
          if (itemType === 'book') {
            const difficultyValue = Number(item.system?.decipher) || 0;
            created = await this.openComboBuilder(actor, 'skill', 'cthulhu', item, {
              isBookDecipher: true,
              originalItem: item,
              predefinedDifficulty: difficultyValue > 0 ? {type: 'number', value: difficultyValue} : null
            });
          } else {
            const skillKey = item.system?.skill;
            if (!skillKey || skillKey === '-') {
              ui.notifications.warn(game.i18n.localize('DX3rd.SkillNotFound'));
              return false;
            }
            created = await this.openComboBuilder(actor, 'skill', skillKey, item);
          }
          return !!created;
        }
        options = {...options, comboMode: 'normal'};
      }
      // Weapons/vehicles pick their roll mode before the cost/usage chat card is emitted.
      // Choosing combo is not an individual equipment use — it only opens an ad-hoc combo.
      if (itemType === 'weapon' || itemType === 'vehicle') {
        if (options.comboMode === 'combo') {
          const skillKey = item.system?.skill;
          if (!skillKey || skillKey === '-') {
            ui.notifications.warn(`${item.name} ${game.i18n.localize('DX3rd.Unable')}`);
            return false;
          }
          await this.openComboBuilder(actor, 'skill', skillKey, item);
          return true;
        }
        if (options.comboMode === 'normal') {
          // Already chosen from the sheet menu.
        } else {
        if (typeof window.DX3rdChooseItemMode !== 'function') {
          ui.notifications.error(game.i18n.localize('DX3rd.DialogV2Unavailable'));
          return false;
        }
        const mode = await window.DX3rdChooseItemMode(options.menuAnchor, item);
        if (mode === null) return false;
        if (mode === 'combo') {
          const skillKey = item.system?.skill;
          if (!skillKey || skillKey === '-') {
            ui.notifications.warn(`${item.name} ${game.i18n.localize('DX3rd.Unable')}`);
            return false;
          }
          await this.openComboBuilder(actor, 'skill', skillKey, item);
          return true;
        }
        if (mode === 'apply') {
          return this.applyChosenItemEffect(actor, item, options);
        }
        options = {...options, comboMode: 'normal', action: mode === 'use' ? 'use' : 'attack'};
        }
      }
      const action = window.DX3rdItemEffectAdapter?.invocationAction(item, options)
        || ((itemType === 'weapon' || itemType === 'vehicle') ? 'attack' : 'use');
      
      // When a target is required: abort if none is picked (the highlight stays)
      // Member extension cards are not copied onto the combo itself. Asking the adapter about the
      // combo alone returned false, so even system.getTarget=true was lost to the nullish fallback,
      // and the target effects vanished after cost and counts were spent. Check both the normal
      // member slots and the weapon slots under their role action — an activation-only card must not make the combo demand a target.
      const comboMemberRequiresTarget = item.type === 'combo'
        && (window.DX3rdComboHandler?.comboMemberEntries?.(actor, item) || []).some(({item: memberItem}) => {
          const memberAction = window.DX3rdComboHandler.comboMemberAction(memberItem, action);
          return !!window.DX3rdItemEffectAdapter?.requiresTarget?.(memberItem, memberAction);
        });
      // Some compendium effects are meant to be applied by hand to another actor, not automatically.
      // This flag makes target selection mandatory even when the caller passes getTarget=false,
      // and aborts before any cost is spent if the caster targets themselves.
      const manualTargetOtherOnly = item.getFlag?.('dx3rd-emanim', 'manualTargetOtherOnly') === true;
      // system.getTarget alone does NOT force a pick: the checkbox only routes the target channel to the
      // selected token (targetForTargetModifiers / applyToTargets), so when no live card would consume a
      // pick — a stray getTarget:'on' on a self buff, a combo-only modifier, an empty target bucket —
      // demanding one made the item report "select a target" and die with nothing to apply it to.
      // The adapter's requiresTarget is the content-aware test (target-modifier buckets and
      // targetToken/damagedTargets extensions bound to this action), and it already reads the flag
      // itself when it classifies the target channel.
      const requiresTarget = manualTargetOtherOnly || (getTarget !== undefined
        ? getTarget
        : (!!window.DX3rdItemEffectAdapter?.requiresTarget?.(item, action)
          || comboMemberRequiresTarget));
      
      window.DX3rdDebug.log('DX3rd | handleItemUse target check:', {
        itemName: item.name,
        getTargetParam: getTarget,
        itemGetTarget: item.system?.getTarget,
        action,
        requiresTarget: requiresTarget,
        targetsCount: game.user.targets?.size || 0
      });
      
      if (requiresTarget) {
        let targets = Array.from(game.user.targets || []);
        // "대상: 자신" already names the target — the caster. Making the player press T on their own
        // token to satisfy the gate is busywork that silently blocks the use when they forget, so the
        // self-target is toggled for them, exactly as if they had pressed it (every downstream step
        // reads game.user.targets, so nothing else has to know). manualTargetOtherOnly items are the
        // opposite case — self is not a legal target there — and are left alone.
        if (targets.length === 0 && !manualTargetOtherOnly && this.itemTargetsSelf(item)) {
          targets = this.autoTargetSelf(actor);
        }
        if (targets.length === 0) {
          window.DX3rdDebug.log('DX3rd | Item use blocked - no targets selected (highlight preserved)');
          ui.notifications.warn(game.i18n.localize('DX3rd.SelectTarget'));
          return false; // abort, keeping the highlight
        }
        if (manualTargetOtherOnly && targets.some(target => target.actor?.id === actor.id)) {
          window.DX3rdDebug.log('DX3rd | Item use blocked - self is not a valid manual target:', item.name);
          ui.notifications.warn(game.i18n.localize('DX3rd.TargetOtherOnly'));
          return false;
        }
        window.DX3rdDebug.log('DX3rd | Target check passed -', targets.length, 'targets selected');
      }

      if (!this.validateItemUsePreflight(actor, item, itemType, action)) {
        window.DX3rdDebug.log('DX3rd | handleItemUse - Type preflight rejected:', item.name);
        return false;
      }

      // Unified handling for a use-button click
      await new Promise(resolve => setTimeout(resolve, 50)); // 50ms delay
      
      // 0. SpellCalamity effect #5 (spells unusable)
      if (itemType === 'spell') {
        const appliedEffects = window.DX3rdAppliedEffects?.collect
          ? window.DX3rdAppliedEffects.collect(actor)
          : (actor.system?.attributes?.applied || {});
        for (const [appliedKey, appliedEffect] of Object.entries(appliedEffects)) {
          if (appliedEffect && appliedEffect.attributes) {
            let hasSpellDisabled = false;
            let count = 0;
            
            for (const [attrName, attrValue] of Object.entries(appliedEffect.attributes)) {
              // spell_disabled is detected by attrName, or by the object's key — nothing else.
              //   (the old `attrValue === true` clause mistook any boolean-true attribute — move_half
              //    and friends — for it and wrongly blocked spells, so it was removed)
              if (attrName === 'spell_disabled' ||
                  (typeof attrValue === 'object' && attrValue?.key === 'spell_disabled')) {
                hasSpellDisabled = true;
                // Look up the count value
                const countValue = appliedEffect.attributes?.spell_disabled_count;
                if (countValue !== undefined) {
                  count = typeof countValue === 'object' ? (countValue.value || 0) : Number(countValue || 0);
                }
                break;
              }
            }
            
            if (hasSpellDisabled) {
              // Show the count when present, otherwise the default message
              if (count > 0) {
                ui.notifications.warn(game.i18n.format('DX3rd.SpellDisabled', { count: count }));
              } else {
                ui.notifications.warn(game.i18n.localize('DX3rd.SpellCatastropheText3'));
              }
              return false; // spell unusable
            }
          }
        }
      }
      
      // 1. Pay the encroachment/HP cost and emit the item-use message
      // Finding E (rules 3271-3273 / 3660-3664): even when an effect's own encroachment cost
      // crosses a threshold (100/160), this use's [level] stays frozen at the pre-cost level.
      // (An effect already firing does not gain a level from its own encroachment rise.)
      // getItemLevel (helpers.js) reads this scratch flag first. The prior value is kept for re-entry.
      const _prevFrozenEncLevel = actor._dx3rdUsageEncLevel;
      actor._dx3rdUsageEncLevel = Number(actor.system?.attributes?.encroachment?.level) || 0;
      // Snapshot the runtime input too, and restore it on exit so a leftover cannot leak into the next effect.
      const _prevRuntimeInput = actor._dx3rdRuntimeInput;
      try {
      // Declaration equipment ("if you declare …") is not spent merely by attacking with it.
      // Uses, cost, and the usage card are paid exactly once, when the roll dialog's declaration
      // toggle commits (action:'use') — an attack is just an attack, and choosing whether to spend
      // it right before the accuracy roll is the whole point of this class of equipment. Charging
      // here too would burn a once-per-scenario use on an ordinary shot, and the bonus would not
      // even apply, the action being different. The test is the same function the declaration UI
      // uses (isDeclarable), so "listed there" and "free here" cannot diverge.
      const declarationOnly = action === 'attack' && this.attackDefersUsage(item);

      if (!declarationOnly) {
        const usageAllowed = await this.processItemUsageCost(actor, item, {
          action,
          rollType: options.rollType
        });
        if (!usageAllowed) {
          window.DX3rdDebug.log('DX3rd | handleItemUse - Usage blocked by cost');
          return false;
        }

        // 1.5. Increment the usage count (unless notCheck)
        const usedDisable = item.system?.used?.disable || 'notCheck';
        if (usedDisable !== 'notCheck') {
          const currentUsedState = item.system?.used?.state || 0;
          await item.update({ 'system.used.state': currentUsedState + 1 });
          window.DX3rdDebug.log('DX3rd | handleItemUse - Used count increased:', currentUsedState, '→', currentUsedState + 1);
        }
      } else {
        window.DX3rdDebug.log('DX3rd | handleItemUse - Declaration-only equipment: attack costs nothing', item.name);
      }

      // 2. Instant activation (only when disable is not 'notCheck')
      // Instant-resolve consumables (disable='-') leave no lingering toggle (see activateItem).
      const activeDisable = item.system?.active?.disable ?? '-';
      const skipToggle = item.type === 'once' && activeDisable === '-';
      const adapter = window.DX3rdItemEffectAdapter;
      // Items whose self-modifier channel resolves to the 'activation' action (always-on effects,
      // applyMode='toggle', or a card authored with action 'activation') did not match the use
      // action ('use'/'attack'). Direct use may explicitly include activation through useMeansActivation,
      // unlike membership in a combo, which never activates the member's separate toggle channel.
      const activationLifecycle = adapter?.bucketLifecycle(item, 'self', 'activation');
      const useMeansActivate = !!adapter?.useMeansActivation?.(item)
        && activationLifecycle.disable !== 'notCheck'
        && (activationLifecycle.runTiming === '-' || activationLifecycle.runTiming === 'instant');
      const selfActionMatches = !adapter
        || adapter.extensionActionMatches(item, 'selfModifiers', item.system?.active || {}, action, 'instant')
        || useMeansActivate
        // A row whose own trigger action differs from the channel default would be blocked by the channel gate alone.
        || adapter.selfFiresAt(item, action, 'instant');
      // "Is there anything left to apply" differs per channel — the adapter's selfModifiersPending decides.
      // (activation channel: !active.state / frozen channel: fresh on every use / notCheck: never)
      const selfPending = adapter ? adapter.selfModifiersPending(item)
        : (!item.system.active?.state && activeDisable !== 'notCheck');
      const selfFiresNow = adapter
        ? (adapter.selfFiresAt(item, action, 'instant') || useMeansActivate)
        : item.system.active?.runTiming === 'instant';
      if (selfActionMatches && selfFiresNow && selfPending && !skipToggle) {
        // Modifiers authored on the 'activation' channel are toggled on, not frozen. The sheet display
        // and the combo persistence checks (combo-data getPersistentEffectIds/calculateItemAttackBonus)
        // read active.state, so freezing an AE only would leave "applied, yet still inactive".
        const toggled = await this.applySelfModifiers(actor, item, { forceToggle: useMeansActivate, action, timing: 'instant' });
        window.DX3rdDebug.log(`DX3rd | handleItemUse - Self modifiers applied (${toggled ? 'toggle' : 'onUse frozen'}):`, item.name);
      }
      
      // 2.7. Resource-proportional cost (native field) — spend n of HP etc. for an n×mult roll/stat buff
      await this.processResourceCost(actor, item);

      // 3. Run the instant-timing macros / applied effects / extensions
      await this.executeMacros(item, 'instant', action);
      await this.applyToTargets(actor, item, 'instant', null, action);
      // A combo merges its extensions with its members in ComboHandler, so skip here (any roll type)
      if (item.type !== 'combo') {
        await this.processItemExtensions(actor, item, 'instant', action);
      } else {
        window.DX3rdDebug.log('DX3rd | handleItemUse - Skipping combo instant extensions here (will be merged and executed in ComboHandler)');
      }
      
      // 4. When runTiming is instant, queue the afterMain extensions
      // Combos are skipped: ComboHandler merges and registers them instead
      if (item.system.active?.runTiming === 'instant') {
        if (item.type !== 'combo') {
          const itemExtend = item.getFlag('dx3rd-emanim', 'itemExtend');
          if (itemExtend) {
            window.DX3rdDebug.log('DX3rd | handleItemUse - Registering afterMain extensions for non-combo item:', item.name);
            await this.registerAfterMainExtensions(actor, item, itemExtend, action);
          }
        } else {
          window.DX3rdDebug.log('DX3rd | handleItemUse - Skipping afterMain registration for combo (will be handled by ComboHandler)');
        }
      }

      // Dispatch to the per-type handler
      const handlerMap = {
        'weapon': window.DX3rdWeaponHandler,
        'protect': window.DX3rdProtectHandler,
        'vehicle': window.DX3rdVehicleHandler,
        'effect': window.DX3rdEffectHandler,
        'psionic': window.DX3rdPsionicHandler,
        'spell': window.DX3rdSpellHandler,
        'combo': window.DX3rdComboHandler,
        'book': window.DX3rdBookHandler,
        'connection': window.DX3rdConnectionHandler,
        'etc': window.DX3rdEtcHandler,
        'once': window.DX3rdOnceHandler,
        'rois': window.DX3rdRoisHandler
      };
      
      const handler = handlerMap[itemType];
      // For an attack-capable item, a separate 'use' action fires only its attached effects.
      // Calling the type handler here would re-enter the attack roll and collapse that separation.
      const effectOnlyUse = action === 'use' && window.DX3rdItemEffectAdapter?.isAttackItem(item);
      if (handler && !effectOnlyUse) {
        // Surface exceptions from the handler, so they cannot become "nothing happened, no error".
        try {
          // Lois items branch on roisAction
          let handlerResult;
          if (itemType === 'rois' && roisAction) {
            if (roisAction === 'titus') {
              handlerResult = await handler.handleTitus(actorId, itemId);
            } else if (roisAction === 'sublimation') {
              handlerResult = await handler.handleSublimation(actorId, itemId);
            } else if (roisAction === 'activate') {
              // Activatable Lois (D-Lois etc.): macros, self effects, cost, and usage count already ran
              // in the shared pipeline above. RoisHandler.handle is Titus/sublimation only, so calling
              // it here would double-run the macros and set a meaningless titus flag → do not call it.
            } else {
              handlerResult = await handler.handle(actorId, itemId, getTarget, options);
            }
          } else {
            handlerResult = await handler.handle(actorId, itemId, getTarget, options);
          }
          // Keep the legacy "undefined means success" contract, but propagate an explicit false all
          // the way up, so the chat completion marker and ad-hoc combo cleanup cannot mistake a real
          // failure for success.
          if (handlerResult === false) return false;
        } catch (e) {
          console.error(`DX3rd | handleItemUse - ${itemType} handler threw:`, e);
          ui.notifications.error(`${item.name}: ${game.i18n.localize('DX3rd.Use')} ${game.i18n.localize('DX3rd.Unable')} (${e?.message || e})`);
          return false;
        }
      } else if (!effectOnlyUse) {
        console.warn(`DX3rd | handleItemUse - No handler registered for itemType: ${itemType}`);
      }

      // A standalone preparation item can carry its after-damage target bucket into the next
      // concrete attack. Arm it only after the type handler has completed successfully.
      await this.armPendingAttackRider(actor, item, action);
      // The item's own afterSuccess target bucket freezes the same way, for the success button.
      await this.armPendingAfterSuccessApply(actor, item);

      // Completed successfully
      return true;
      } finally {
        // End of use: release the frozen level (restoring the prior value on re-entry)
        if (_prevFrozenEncLevel === undefined) delete actor._dx3rdUsageEncLevel;
        else actor._dx3rdUsageEncLevel = _prevFrozenEncLevel;
        // Restore the runtime input so nothing lingers
        if (_prevRuntimeInput === undefined) delete actor._dx3rdRuntimeInput;
        else actor._dx3rdRuntimeInput = _prevRuntimeInput;
      }
    }
  };

})();

// The AfterMain queue (addToAfterMainQueue / registerAfterMainExtensions /
// processAfterMainQueue / clearAfterMainQueue) lives in handlers/universal-after-main.js.

/**
 * Resource-proportional cost (the native system.resourceCost field).
 *   - Spend n of HP (the default) within the cap → grant an applied buff of value = n × mult on
 *     attrKey (add / attack / guard / armor …). The buff's lifetime (disable) comes from the field
 *     (default main = for that main process). Self only, so no GM rights are needed.
 * The cap is whatever the formula yields — it is deliberately NOT clamped to current HP (see below).
 * @param {Actor} actor
 * @param {Item} item
 */
window.DX3rdUniversalHandler.processResourceCost = async function(actor, item) {
  try {
    const rc = item?.system?.resourceCost;
    if (!rc || !rc.enabled) return;
    if (!actor) return;

    const resource = rc.resource || 'hp';
    // input mode: spends no resource; it only prompts for a number on use and applies it as the bonus
    //   (a stand-in for dynamic references — [침식률÷10], [최대HP-현재HP], [소비한 HP] and the like are typed by the player).
    const isInput = (resource === 'input');

    // Evaluate the cap formula ([level]*3, 20, … → a number). Non-numeric becomes 0.
    let cap = Number(this.evaluateFormulaForExtension(String(rc.cap ?? ''), item, actor));
    if (!Number.isFinite(cap)) cap = 0;
    cap = Math.max(0, Math.floor(cap));

    // The cap is exactly what the formula yields; it is not clamped to current HP —
    // the ability to pay does not gate the use, and dropping to 0 or below is acceptable.
    const usableMax = (resource === 'hp') ? cap
                    : isInput ? (cap > 0 ? cap : 99)
                    : cap;

    if (usableMax <= 0) {
      ui.notifications?.warn(`${item.name}: ${game.i18n.localize('DX3rd.ResourceCostNone')}`);
      return;
    }

    // Prompt for n (0..usableMax). input mode starts at 0, to force a deliberate entry.
    const n = await this.promptResourceAmount(item, resource, usableMax, isInput ? 0 : usableMax);
    if (!Number.isFinite(n) || n <= 0) return; // canceled, or zero

    // Deduct the resource (hp only; input and the rest deduct nothing)
    if (resource === 'hp') {
      // Read HP at deduction time — it may have changed while the prompt was open.
      const curHp = Number(actor.system?.attributes?.hp?.value ?? 0);
      await actor.update({ 'system.attributes.hp.value': curHp - n });
    }

    // Grant the applied buff
    const value = n * (Number(rc.mult) || 1);
    const uid = foundry.utils.randomID();
    const key = `rescost_${item.id}`;
    await window.DX3rdAppliedEffects.set(actor, key, {
      itemId: item.id,
      name: item.name,
      source: actor.name,
      disable: rc.disable || 'main',
      img: item.img || 'icons/svg/aura.svg',
      attributes: { [uid]: { key: rc.attrKey || 'add', label: rc.label || '-', value: value } }
    });

    // Chat notice (neutral wording, so it does not trip the other message matchers)
    const attrLabel = game.i18n.localize(`DX3rd.ResourceCostAttr.${rc.attrKey || 'add'}`);
    const lhs = isInput ? game.i18n.localize('DX3rd.ResourceCostInput') : `${resource.toUpperCase()} -${n}`;
    ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ actor }),
      content: `<div class="dx3rd-resource-cost"><b>${item.name}</b><br>${lhs} → ${attrLabel} +${value}</div>`
    });
  } catch (e) {
    console.error('DX3rd | processResourceCost failed', e);
  }
};

/**
 * Run an encroachment-adjustment extend immediately (cross/dynamic reference — a number typed on use).
 *   The value is not computed; a dialog asks for the reduction X (0..max) at use time.
 *   - own encroachment += X × selfMult (applied directly; no special rights needed)
 *   - target (targetToken) encroachment -= X (targets are GM-owned → delegated over the socket)
 * @param {Actor} actor
 * @param {Object} encData - { target, max, selfMult, timing, activate }
 * @param {Item} item
 */
window.DX3rdUniversalHandler.executeEncroachExtensionNow = async function(actor, encData, item = null) {
  if (!actor || !actor.id) { ui.notifications.error('액터 정보가 유효하지 않습니다.'); return; }
  const { max = '', selfMult = 1, target = 'targetToken', selectedTargetIds, targetsFrozen = false } = encData || {};

  // Fixed self cost. The afterMain queue reuses this same executor, so an "after the main process"
  // encroachment rise is not pulled forward into an immediate cost.
  const fixedRaw = String(encData?.value ?? encData?.formula ?? encData?.amount ?? '').trim();
  if (encData?.fixed === true && target === 'self' && fixedRaw && fixedRaw !== '-') {
    if (actor.system?.attributes?.encroachment?.type === 'none') return;
    const normalized = fixedRaw.replace(/(\d+)\s*[dD]\s*(?!\d)/g, '$1d10').replace(/D/g, 'd');
    const isDice = /\d+d\d+/i.test(normalized);
    const roll = isDice ? await new Roll(normalized).roll() : null;
    const amount = roll ? Number(roll.total) || 0 : Number(normalized) || 0;
    const current = Number(actor.system?.attributes?.encroachment?.value ?? 0);
    await actor.update({'system.attributes.encroachment.value': current + amount});
    const diceHTML = roll ? `<div class="dx3rd-mt-4">${await roll.render()}</div>` : '';
    await ChatMessage.create({
      speaker: ChatMessage.getSpeaker({actor}),
      content: `<div class="dx3rd-encroach"><b>${item?.name || ''}</b><br>${game.i18n.localize('DX3rd.Encroachment')} +${amount}${isDice ? ` (${normalized})` : ''}${diceHTML}</div>`
    });
    return;
  }

  // Evaluate the input cap (the max formula)
  const itemLevel = (item ? window.DX3rdFormulaEvaluator.getItemLevel(item) : 0) || 1;
  const itemForFormula = { type: item?.type || 'effect', system: { level: { value: itemLevel } } };
  let cap = Number(window.DX3rdFormulaEvaluator.evaluate(String(max || '0'), itemForFormula, actor));
  if (!Number.isFinite(cap) || cap < 0) cap = 0;
  cap = Math.floor(cap);

  // Prompt for the reduction X (0..cap)
  const x = await this.promptEncroachAmount(item, cap);
  if (!Number.isFinite(x) || x <= 0) return; // canceled, or zero

  // 1) Raise own encroachment (directly on this actor)
  const selfDelta = x * (Number(selfMult) || 1);
  const curSelf = Number(actor.system?.attributes?.encroachment?.value ?? 0);
  await actor.update({ 'system.attributes.encroachment.value': curSelf + selfDelta });

  // 2) Collect the targets (targetToken)
  const targets = [];
  if (target === 'targetToken') {
    if (targetsFrozen || (selectedTargetIds && selectedTargetIds.length > 0)) {
      (selectedTargetIds || []).forEach(tokenId => {
        const token = canvas.tokens.get(tokenId);
        if (token?.actor && !targets.find(targetActor => targetActor.id === token.actor.id)) targets.push(token.actor);
      });
    } else {
      Array.from(game.user.targets).forEach(t => { if (t.actor && !targets.find(a => a.id === t.actor.id)) targets.push(t.actor); });
    }
  }

  const enc = game.i18n.localize('DX3rd.Encroachment') || '침식률';
  if (targets.length === 0) {
    // No target picked — announce the self rise only
    ChatMessage.create({ speaker: ChatMessage.getSpeaker({ actor }), content: `<div class="dx3rd-encroach"><b>${item?.name || ''}</b><br>${actor.name}: ${enc} +${selfDelta}</div>` });
    return;
  }

  const requestData = {
    userId: game.user.id,
    actorId: actor.id,
    actorName: actor.name,
    itemName: item?.name || '',
    targets: targets.map(t => ({ id: t.id, name: t.name })),
    targetDelta: -x,        // the target's encroachment drops
    selfDelta: selfDelta,   // for the chat notice (the self rise is already applied)
  };

  if (game.user.isGM) {
    await window.DX3rdUniversalHandler.handleEncroachRequest(requestData);
  } else {
    window.DX3rdSocketRouter.emit({ type: 'encroachRequest', requestData });
    ui.notifications.info('GM에게 침식률 조정 요청을 보냈습니다.');
  }
};

/**
 * Dialog for the encroachment reduction amount (shown on the calling client only).
 * @returns {Promise<number|false|null>} the entered value (0..cap); cancel/close return a non-number.
 *   0 is a valid value, so callers must test with Number.isFinite.
 */
window.DX3rdUniversalHandler.promptEncroachAmount = async function(item, cap) {
  const enc = game.i18n.localize('DX3rd.Encroachment') || '침식률';
  const DialogV2 = foundry.applications?.api?.DialogV2;
  if (!DialogV2?.wait) {
    ui.notifications.error(game.i18n.localize('DX3rd.DialogV2Unavailable'));
    return null;
  }

  const content = `
    <div style="padding:10px;">
      <p style="margin-bottom:8px;"><b>${item?.name || ''}</b> — ${enc} ${game.i18n.localize('DX3rd.Reduce') || '감소'} (0~${cap})</p>
      <input type="number" id="enc-amount" value="${cap}" min="0" max="${cap}" step="1" style="width:100%; padding:5px;">
    </div>`;
  return await DialogV2.wait({
    window: { title: enc },
    content,
    rejectClose: false,
    buttons: [
      {
        action: 'confirm',
        icon: '<i class="fas fa-check"></i>',
        label: game.i18n.localize('DX3rd.Confirm') || '확인',
        default: true,
        callback: (event, button) => {
          const root = button.form || button.element?.closest('.application') || button.element?.ownerDocument;
          let v = parseInt(root?.querySelector('#enc-amount')?.value);
          if (!Number.isFinite(v)) v = 0;
          return Math.max(0, Math.min(cap, v));
        }
      },
      {
        action: 'cancel',
        icon: '<i class="fas fa-times"></i>',
        label: game.i18n.localize('DX3rd.Cancel') || '취소',
        callback: () => false
      }
    ]
  });
};

/**
 * Handle an encroachment-adjustment request (GM only) — lower the target tokens' encroachment and announce it.
 */
window.DX3rdUniversalHandler.handleEncroachRequest = async function(requestData) {
  if (!game.user.isGM) return;
  const { targets = [], targetDelta = 0, actorName = '', itemName = '', selfDelta = 0 } = requestData || {};
  const enc = game.i18n.localize('DX3rd.Encroachment') || '침식률';
  const lines = [];
  for (const tref of targets) {
    const token = canvas.tokens.get(tref.id);
    const tActor = token?.actor || game.actors.get(tref.id);
    if (!tActor) continue;
    const cur = Number(tActor.system?.attributes?.encroachment?.value ?? 0);
    const next = Math.max(0, cur + targetDelta);   // never below 0
    await tActor.update({ 'system.attributes.encroachment.value': next });
    lines.push(`${tActor.name}: ${enc} ${targetDelta >= 0 ? '+' : ''}${targetDelta} (→ ${next})`);
  }
  if (lines.length) {
    ChatMessage.create({
      speaker: { alias: actorName },
      content: `<div class="dx3rd-encroach"><b>${itemName}</b><br>${lines.join('<br>')}${selfDelta ? `<br>${actorName}: ${enc} +${selfDelta}` : ''}</div>`
    });
  }
};

/** Whether a weapon name denotes the fist: the localized fist name, or a name containing it in brackets. */
window.DX3rdUniversalHandler.isFistWeaponName = function(name) {
  if (!name) return false;
  const fistName = game.i18n.localize('DX3rd.Fist');
  return name === fistName || name.includes(`[${fistName}]`);
};

/** Damage-time attack bonus that applies to the fist alone (attrs.attack.fist). 0 for anything else. */
window.DX3rdUniversalHandler.getFistAttackBonus = function(actor, item) {
  try {
    if (!item || item.type !== 'weapon' || !actor) return 0;
    if (!this.isFistWeaponName(item.name)) return 0;
    return Number(actor.system?.attributes?.attack?.fist) || 0;
  } catch (e) { return 0; }
};

/**
 * Resolve which weapon buckets a guard bonus applies through — the keys into `attrs.guard.<bucket>`.
 *
 * The difference from the attack buckets (`resolveAttackBonuses`) is **when it is decided**. The
 * attacking weapon is fixed when the roll starts; the guarding weapon is picked in the defense
 * dialog after the hit. So the actor's derived values stay bucketed and are read per weapon here.
 *
 * **The fist takes both `fist` and `melee` — they add, they are not exclusive.** By the rules the
 * fist is "type: melee", so "+N to the guard value of melee weapons" must apply bare-handed too.
 * The attack side already works this way (`resolveAttackBonuses`: the fist's `system.type` is
 * `melee`, so the melee bucket applies, and `getFistAttackBonus` **adds** the fist bucket on top).
 * Picking only one here would give the same vocabulary two different meanings across two keys,
 * making "fist and melee" unauthorable. Narrowest first, so any display taking the first entry does not flatten the fist into melee.
 * @returns {Array<'fist'|'melee'|'ranged'>} empty for a weapon that takes only the catch-all (`_`)
 */
window.DX3rdUniversalHandler.resolveGuardBuckets = function(weapon) {
  if (!weapon || weapon.type !== 'weapon') return [];
  const type = weapon.system?.type;
  const buckets = [];
  // Fist is tested first — its type is melee, so the reverse order would never reach the fist bucket.
  if (this.isFistWeaponName(weapon.name)) buckets.push('fist');
  if (type === 'melee' || type === 'ranged') buckets.push(type);
  return buckets;
};

/**
 * Bucket bonuses that apply only when guarding with this weapon. Fixed and dice terms come back
 * separately (the dice are rolled once, when the defense is confirmed).
 * @returns {{fixed: number, formula: string}}
 */
window.DX3rdUniversalHandler.getWeaponGuardBonus = function(actor, weapon) {
  const guard = actor?.system?.attributes?.guard || {};
  let fixed = 0;
  const formulas = [];
  for (const bucket of this.resolveGuardBuckets(weapon)) {
    fixed += Number(guard[bucket]) || 0;
    const formula = guard.rollFormula?.[bucket];
    if (formula) formulas.push(formula);
  }
  return { fixed, formula: formulas.join(' + ') };
};

/**
 * Join numeric and dice terms into one Roll formula string (empty and zero terms are dropped).
 *
 * The attack-bonus carrier (mergeAttackBonuses) keeps the fixed value in `attack` (a number) and
 * the dice formula in `attackFormula` (a string), **separately**. Taking only one of them (the old
 * `attackFormula || attack`) silently dropped the fixed part whenever a fixed-attack effect was
 * combined with a dice-attack weapon. The accuracy roll (executeStatRoll), the enemy achievement
 * path (ComboHandler), and the damage dialog all use this one function — joining terms locally would recreate that gap.
 * @returns {string} the joined formula ('0' when every term is empty)
 */
window.DX3rdUniversalHandler.joinFormulaTerms = function(...terms) {
  return terms.reduce((formula, value) => {
    const term = String(value ?? '').trim();
    if (!term || term === '0' || term === '+0' || term === '-0') return formula;
    if (!formula) return term;
    return term.startsWith('-')
      ? `${formula} - ${term.slice(1).trim()}`
      : `${formula} + ${term}`;
  }, '') || '0';
};

/**
 * Resolve an item's attack type (melee/ranged).
 * Weapons use their own type, vehicles are always melee, everything else follows the attackRoll field.
 * @returns {'melee'|'ranged'|null}
 */
window.DX3rdUniversalHandler.resolveAttackType = function(item) {
  if (!item) return null;
  if (item.type === 'weapon') return item.system?.type || null;
  if (item.type === 'vehicle') return 'melee';
  if (item.system?.attackRoll && item.system.attackRoll !== '-') return item.system.attackRoll;
  return null;
};

/**
 * Sum the actor's attack/penetrate bonuses for the given attack type.
 * The accuracy roll (executeAttackRoll), the damage roll (handleDamageRoll), and the combo path
 * must all go through this function, or the two moments will disagree.
 * @param {object} [options]
 * @param {string} [options.attackType]     force the attack type (otherwise resolved from the item).
 * @param {string} [options.fistWeaponName] decide the fist bonus from this weapon name, not the item.
 *                                          Used when an effect/combo picked its weapon via weapon-for-attack.
 * @returns {{attackType: string|null, actorAttack: number, actorAttackFormula: string,
 *            actorPenetrate: number, actorPenetrateFormula: string}}
 */
window.DX3rdUniversalHandler.resolveAttackBonuses = function(actor, item, options = {}) {
  const attackType = options.attackType ?? this.resolveAttackType(item);
  const attrs = actor?.system?.attributes || {};

  // Attack bonus for the matching attack type
  let actorAttack = attrs.attack?.value || 0;
  const attackFormulas = attrs.attack?.rollFormula || {};
  let actorAttackFormula = attackFormulas._ || '';
  if (attackType === 'melee' && attrs.attack?.melee) {
    actorAttack += attrs.attack.melee;
    actorAttackFormula = [actorAttackFormula, attackFormulas.melee].filter(Boolean).join(' + ');
  } else if (attackType === 'ranged' && attrs.attack?.ranged) {
    actorAttack += attrs.attack.ranged;
    actorAttackFormula = [actorAttackFormula, attackFormulas.ranged].filter(Boolean).join(' + ');
  }
  // Fist-only attack power (Degeneration Organ etc.): added only when the weapon is the fist
  if (options.fistWeaponName !== undefined) {
    // Judge by the selected weapon (an effect/combo picked the fist via weapon-for-attack)
    if (this.isFistWeaponName(options.fistWeaponName)) {
      actorAttack += Number(attrs.attack?.fist) || 0;
    }
  } else {
    actorAttack += this.getFistAttackBonus(actor, item);
  }

  return {
    attackType,
    actorAttack,
    actorAttackFormula,
    actorPenetrate: attrs.penetrate?.value || 0,
    // The penetrate dice formula, unrolled. Use resolveAttackBonusesRolled to freeze it to a number.
    actorPenetrateFormula: attrs.penetrate?.rollFormula || ''
  };
};

/**
 * resolveAttackBonuses, with the penetrate dice formula rolled once *now* and frozen to a number.
 * Penetration is the attacker's value but is consumed in the defense dialog (offsetting armor).
 * Rolling it there would make the defender's client roll the attacker's dice, so it is rolled at
 * accuracy time and folded into actorPenetrate; downstream (chat buttons, socket) carries only numbers.
 * @returns {Promise<Object>} the resolveAttackBonuses result plus penetrateRoll (a Roll, if one was made)
 */
window.DX3rdUniversalHandler.resolveAttackBonusesRolled = async function(actor, item, options = {}) {
  const bonuses = this.resolveAttackBonuses(actor, item, options);
  if (!bonuses.actorPenetrateFormula) return bonuses;
  try {
    const roll = await (new Roll(bonuses.actorPenetrateFormula)).evaluate();
    bonuses.actorPenetrate += Number(roll.total) || 0;
    bonuses.penetrateRoll = roll;
  } catch (error) {
    console.warn(`DX3rd | penetrate roll failed: ${bonuses.actorPenetrateFormula}`, error);
    ui.notifications.warn(`${game.i18n.localize('DX3rd.DamageRollFormulaInvalid')}: ${bonuses.actorPenetrateFormula}`);
  }
  return bonuses;
};

/** Dialog for the resource amount n (0..max). Cancel/close return a non-number — test with Number.isFinite. */
window.DX3rdUniversalHandler.promptResourceAmount = async function(item, resource, max, initial = max) {
  const DialogV2 = foundry.applications?.api?.DialogV2;
  if (!DialogV2?.wait) {
    ui.notifications.error(game.i18n.localize('DX3rd.DialogV2Unavailable'));
    return null;
  }

  const promptKey = (resource === 'input') ? 'DX3rd.ResourceCostInputPrompt' : 'DX3rd.ResourceCostPrompt';
  const content = `
    <div style="padding:10px;">
      <p style="margin-bottom:8px;">${item.name}: ${game.i18n.localize(promptKey)} <b>(0 ~ ${max})</b></p>
      <input type="number" id="res-amt" value="${initial}" min="0" max="${max}" step="1" style="width:100%; padding:5px;">
    </div>`;
  return await DialogV2.wait({
    window: { title: game.i18n.localize('DX3rd.ResourceCost') },
    content,
    rejectClose: false,
    buttons: [
      {
        action: 'confirm',
        icon: '<i class="fas fa-check"></i>',
        label: game.i18n.localize('DX3rd.Confirm'),
        default: true,
        callback: (event, button) => {
          const root = button.form || button.element?.closest('.application') || button.element?.ownerDocument;
          let v = parseInt(root?.querySelector('#res-amt')?.value, 10);
          if (!Number.isFinite(v)) v = 0;
          return Math.max(0, Math.min(max, v));
        }
      },
      {
        action: 'cancel',
        icon: '<i class="fas fa-times"></i>',
        label: game.i18n.localize('DX3rd.Cancel'),
        callback: () => false
      }
    ]
  });
};
