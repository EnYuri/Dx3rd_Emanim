// The Effect item handler
(function() {
window.DX3rdEffectHandler = {
    /**
     * Resolve the roll's stat and label from the effect's system.skill.
     * The actual logic lives in UniversalHandler, shared with psionic.
     * @returns {{stat: object|null, label: string}}
     */
    resolveStatAndLabel(actor, item) {
        return window.DX3rdUniversalHandler.resolveStatAndLabel(actor, item);
    },

    /**
     * The stat and label this roll actually uses.
     *  - 기능 authored and resolvable → that stat.
     *  - 기능 '-' → an empty pool ("기능 -, 난이도 대결"): the dialog opens with 0 dice for the player to fill in.
     *  - 기능 authored but unresolvable → a warning and no roll. The authored intent exists there, so rolling an
     *    empty pool would hide a data error instead of reporting it.
     * @returns {{stat: object|null, label: string}} stat null = the caller stops.
     */
    resolveRollStat(actor, item) {
        const skillKey = item.system?.skill;
        if (!skillKey || skillKey === '-') {
            return { stat: window.DX3rdUniversalHandler.blankRollStat(), label: '-' };
        }
        const resolved = this.resolveStatAndLabel(actor, item);
        if (!resolved.stat) {
            ui.notifications.warn(game.i18n.localize('DX3rd.SkillDataNotFound'));
            return { stat: null, label: '' };
        }
        return resolved;
    },

    async handle(actorId, itemId, getTarget, options = {}) {
        const actor = game.actors.get(actorId);
        if (!actor) { 
            ui.notifications.warn(game.i18n.localize('DX3rd.ActorNotFound'));
            return; 
        }
        
        // Look on the actor's items first, then in game.items
        const item = actor.items.get(itemId) || game.items.get(itemId);
        if (!item) { 
            ui.notifications.warn(game.i18n.localize('DX3rd.ItemNotFound'));
            return; 
        }

        // Branch on the effect's roll type: '-' is the default logic, anything else is a roll
        const rollType = window.DX3rdUniversalHandler.resolveInvocationRollType(item, options);
        // A self-attacking effect with attackRoll (melee/ranged) set is routed to an attack roll even when roll is '-'.
        // (A safety net for cases where the automatic mechanization left roll as '-'; it also covers future attack effects.)
        const hasAttackRoll = item.system?.attackRoll && item.system.attackRoll !== '-';

        // The 난이도 field decides whether there is anything to roll. 자동성공 and '-'/blank both say the use
        // simply happens, so the roll is skipped and it goes through as a plain use — cost, activation,
        // self/target modifiers, macros and extensions all ran in handleItemUse before this handler was
        // reached, so nothing is lost with it.
        //
        // 기능 does NOT decide. "기능 -, 난이도 대결" is a real authored shape (a contest the effect names
        // without naming a stat), and it rolls with an empty pool the player fills in from the dialog
        // (blankRollStat). Only a difficulty that names nothing turns the roll off.
        //
        // An attack effect is the one exception in the other direction: attackRoll is what produces the
        // accuracy roll and the damage step behind it, so a use that carries one keeps rolling regardless
        // of its difficulty (14 measured world attack effects have a blank difficulty, and dropping their
        // roll would leave them with no way to deal damage at all).
        const skipsRoll = !hasAttackRoll && window.DX3rdUniversalHandler.skipsRollByDifficulty(item);

        if (skipsRoll) {
            window.DX3rdDebug?.log(`DX3rd | ${item.name}: 판정 없이 효과만 적용`, {
                skill: item.system?.skill, difficulty: item.system?.difficulty, roll: rollType
            });
            await this.handleBasicEffect(actor, item);
            return;
        }

        if (rollType === '-' && !hasAttackRoll) {
            // The default handling: raise the encroachment and print the combined message (instant is already handled in universal-handler)
            await this.handleBasicEffect(actor, item);
        } else {
            // Roll handling: major/reaction/dodge. For an attack effect whose roll is '-', the roll kind is inferred from the timing.
            let effectiveRoll = rollType;
            if (rollType === '-') {
                const timing = item.system?.timing;
                effectiveRoll = (timing === 'reaction' || timing === 'dodge') ? timing : 'major';
            }
            await this.handleEffectRoll(actor, item, effectiveRoll, getTarget, options);
        }
    },
    
    /**
     * The default effect handling (system.roll === '-')
     * The encroachment / activation / extensions are already handled in handleItemUse
     */
    async handleBasicEffect(actor, item) {
        // Nothing special — everything is handled in UniversalHandler
    },
    
    /**
     * The roll effect handling (system.roll !== '-')
     * The encroachment / activation are already handled in handleItemUse
     */
    async handleEffectRoll(actor, item, rollType, getTarget, options = {}) {
        const handler = window.DX3rdUniversalHandler;
        const adapter = window.DX3rdItemEffectAdapter;
        if (!handler) {
            console.error("DX3rd | UniversalHandler not found");
            return;
        }
        // A direct attack effect supplies its own modifiers / attack power as the attack payload, with no weapon.
        //
        // It is read on the same criterion as a combo (includeComboModifiers). This call alone used to lack the flag,
        // so it was caught by the `!isAttackItem(item)` gate, giving the asymmetry where a roll effect with no
        // attackRoll had its system.add **counted in a combo but silently ignored in standalone use**.
        // (Measured in the packs: all 41 documents with roll≠'-' carry an attackRoll, so no document changes behaviour.
        //  The effect sheet's modifier / attack power fields are always shown regardless of attackRoll, so authoring is possible.)
        // Attack power riding along on a roll with no damage roll is hidden by the roll window's guidance line, which
        // is gated on isAttackRoll — a display problem is not avoided by blocking the data.
        const ownAttackBonus = adapter?.effectAttackBonus?.(item, actor, {includeComboModifiers: true}) || null;
        
        // With weapon selection enabled, show the weapon selection dialog
        if (item.system?.weaponSelect && item.system?.attackRoll && item.system.attackRoll !== '-') {
            await this.showWeaponSelectionForAttack(actor, item, rollType, options, ownAttackBonus);
            return;
        }
        
        // With weapon selection disabled but the roll being an attack, apply the registered weapon bonuses
        if (!item.system?.weaponSelect && item.system?.attackRoll && item.system.attackRoll !== '-') {
            const registeredWeaponBonus = this.calculateRegisteredWeaponBonus(actor, item);
            
            // Apply the bonus when at least one registered weapon is still usable
            const hasAvailableWeapons = registeredWeaponBonus.weaponIds.length > 0;
            
            if (hasAvailableWeapons) {
                // The effect's own values and the registered weapons are summed exactly once each.
                const weaponBonus = adapter?.mergeAttackBonuses?.(ownAttackBonus, registeredWeaponBonus)
                    || registeredWeaponBonus;
                await this.handleEffectRollWithWeapon(actor, item, rollType, weaponBonus, options);
                return;
            }
            // With weaponSelect false, no weapon selection dialog opens and it proceeds as an ordinary roll
        }

        if (ownAttackBonus) {
            await this.handleEffectRollWithWeapon(actor, item, rollType, ownAttackBonus, options);
            return;
        }
        
        // Get the skill or attribute data (attributes / syndromes / custom skills all handled the same way)
        const { stat, label } = this.resolveRollStat(actor, item);
        if (!stat) return;

        // Show the roll dialog (for certain types only)
        handler.showStatRollDialog(
            actor,
            stat,
            label,
            rollType,
            item,
            null,
            null,
            null,
            null,
            options.predefinedDifficulty || null,
            false,
            false,
            options.afterRollCallback || null
        );
    },
    
    /**
     * Show the weapon selection dialog for an attack
     */
    async showWeaponSelectionForAttack(actor, item, rollType, options = {}, ownAttackBonus = null) {
        const attackRollType = item.system.attackRoll;
        
        // Get all of the actor's weapons plus vehicles (the type filtering was removed)
        const allWeapons = actor.items.filter(w => w.type === 'weapon' || w.type === 'vehicle');
        // Expose the single "no weapon" row at the top, so the roll can proceed even with no weapons at all.
        const virtualWeapons = window.DX3rdVirtualWeapons?.list?.(attackRollType) || [];
        const weapons = [...virtualWeapons, ...allWeapons];

        // Show the weapon selection dialog
        new window.DX3rdWeaponForAttackDialog({
            actor: actor,
            weapons: weapons,
            attackRoll: attackRollType,
            title: game.i18n.localize('DX3rd.WeaponSelection'),
            callback: async (weaponBonus) => {
                // The selected weapon and the effect's own values are applied together.
                const combined = window.DX3rdItemEffectAdapter?.mergeAttackBonuses?.(ownAttackBonus, weaponBonus)
                    || weaponBonus || ownAttackBonus;
                await this.handleEffectRollWithWeapon(actor, item, rollType, combined, options);
            }
        }).render(true);
    },
    
    /**
     * Compute the bonuses of the weapons registered on the weapon tab (only those with attacks left).
     * The actual logic lives in UniversalHandler, shared with psionic.
     */
    calculateRegisteredWeaponBonus(actor, item) {
        return window.DX3rdUniversalHandler.calculateRegisteredWeaponBonus(actor, item);
    },

    /**
     * Roll handling with the weapon bonuses applied
     */
    async handleEffectRollWithWeapon(actor, item, rollType, weaponBonus, options = {}) {
        const handler = window.DX3rdUniversalHandler;

        // Get the skill or attribute data (attributes / syndromes / custom skills all handled the same way)
        const { stat, label } = this.resolveRollStat(actor, item);
        if (!stat) return;

        // Show the roll dialog with the weapon bonuses applied
        handler.showStatRollDialog(
            actor,
            stat,
            label,
            rollType,
            item,
            null,
            weaponBonus,
            null,
            null,
            options.predefinedDifficulty || null,
            false,
            false,
            options.afterRollCallback || null
        );
    }
};
})();
