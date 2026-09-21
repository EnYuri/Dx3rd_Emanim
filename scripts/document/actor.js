/**
 * The Double Cross 3rd Actor class.
 */
(function() {
    // v13/v14 compatibility: fall back when the Actor global is absent
    const _ActorBase = foundry.documents?.Actor ?? globalThis.Actor;
    const sumItemEncroachInit = items => {
        let total = 0;
        for (const item of Array.from(items || [])) {
            if (item?.type === 'record') continue;
            total += Number(item?.system?.encroach?.init) || 0;
        }
        return total;
    };
    const SAVING_ITEM_TYPES = new Set(['weapon', 'protect', 'vehicle', 'book', 'connection', 'etc', 'once']);
    const sumItemSavingCost = items => {
        let total = 0;
        for (const item of Array.from(items || [])) {
            if (!SAVING_ITEM_TYPES.has(item?.type)) continue;
            // Existing documents have no acquisition field. To preserve the old arithmetic without a
            // migration, a missing value counts as permanent; only purchase and other (obtained
            // without paying for it) are excluded from the stock cost.
            const acquisition = item?.system?.saving?.acquisition;
            if (acquisition === 'purchase' || acquisition === 'other') continue;
            total += Number(item?.system?.saving?.value) || 0;
        }
        return total;
    };
    // Overspending stays negative rather than hidden at 0 — how far short you are is the information.
    const calculateSavingRemain = (maximum, items) =>
        (Number(maximum) || 0) - sumItemSavingCost(items);
    const deriveStock = (baseValue, modifierValue = 0, minimumValue = 0) => {
        const base = Number(baseValue) || 0;
        const modifier = Number(modifierValue) || 0;
        // min survives only for legacy data. Clamping here would bury the overspend as a hidden
        // negative inside modifier, which would then swallow the next increase whole.
        const min = Number(minimumValue) || 0;
        return {
            base,
            modifier,
            value: base + modifier,
            // max is an alias kept for old macros and modules. base is canonical for the new UI and arithmetic.
            max: base,
            min
        };
    };

    class DX3rdActor extends _ActorBase {
        prepareData() {
            super.prepareData();

            // Guarantee the basic system / attributes shape
            if (!this.system) this.system = {};
            if (!this.system.attributes) this.system.attributes = {};
            
            // Enemy type?
            const isEnemy = this.type === 'enemy';
            
            // The default attribute shape
            const defaultAttributes = {
                body: { point: 0, bonus: 0, extra: 0, total: 0, dice: 0, add: 0 },
                sense: { point: 0, bonus: 0, extra: 0, total: 0, dice: 0, add: 0 },
                mind: { point: 0, bonus: 0, extra: 0, total: 0, dice: 0, add: 0 },
                social: { point: 0, bonus: 0, extra: 0, total: 0, dice: 0, add: 0 },
                hp: { value: 0, max: 0 },
                init: { value: 0 },
                move: { battle: 0, full: 0 },
                attack: { value: 0, melee: 0, ranged: 0 },
                armor: { value: 0, min: 0 },
                guard: { value: 0, min: 0 },
                penetrate: { value: 0, min: 0 },
                reduce: { value: 0, min: 0, roll: 0 },
                critical: { min: 10 },
                applied: {}
            };
            
            // Character-only attributes
            if (!isEnemy) {
                defaultAttributes.encroachment = { value: 0, max: 100, min: 0, type: game.settings.get('dx3rd-emanim', 'defaultEncroachmentType') || '-', dice: 0, level: 0, init: { input: 0, value: 0 } };
                defaultAttributes.stock = { value: 0, base: 0, modifier: 0, min: 0, max: 0 };
                defaultAttributes.exp = { init: 0, append: 0, total: 0, now: 0, discount: 0 };
                defaultAttributes.saving = { value: 0, max: 0, min: 0};
                defaultAttributes.cast = { dice: 0, add: 0, eibon: 0 };
                defaultAttributes.skills = {
                    melee: {
                        name: "DX3rd.melee",
                        point: 0,
                        bonus: 0,
                        extra: 0,
                        total: 0,
                        dice: 0,
                        add: 0,
                        base: "body",
                        delete: false
                    },
                    evade: {
                        name: "DX3rd.evade",
                        point: 0,
                        bonus: 0,
                        extra: 0,
                        total: 0,
                        dice: 0,
                        add: 0,
                        base: "body",
                        delete: false
                    },
                    ranged: {
                        name: "DX3rd.ranged",
                        point: 0,
                        bonus: 0,
                        extra: 0,
                        total: 0,
                        dice: 0,
                        add: 0,
                        base: "sense",
                        delete: false
                    },
                    perception: {
                        name: "DX3rd.perception",
                        point: 0,
                        bonus: 0,
                        extra: 0,
                        total: 0,
                        dice: 0,
                        add: 0,
                        base: "sense",
                        delete: false
                    },
                    rc: {
                        name: "DX3rd.rc",
                        point: 0,
                        bonus: 0,
                        extra: 0,
                        total: 0,
                        dice: 0,
                        add: 0,
                        base: "mind",
                        delete: false
                    },
                    will: {
                        name: "DX3rd.will",
                        point: 0,
                        bonus: 0,
                        extra: 0,
                        total: 0,
                        dice: 0,
                        add: 0,
                        base: "mind",
                        delete: false
                    },
                    negotiation: {
                        name: "DX3rd.negotiation",
                        point: 0,
                        bonus: 0,
                        extra: 0,
                        total: 0,
                        dice: 0,
                        add: 0,
                        base: "social",
                        delete: false
                    },
                    procure: {
                        name: "DX3rd.procure",
                        point: 0,
                        bonus: 0,
                        extra: 0,
                        total: 0,
                        dice: 0,
                        add: 0,
                        base: "social",
                        delete: false
                    }
                };
            }

            // Enemies keep a minimal encroachment shape, for the "none" option and the rise rules.
            // (Unlike characters, no dice/level/exp arithmetic — only type and value are kept.)
            if (isEnemy) {
                defaultAttributes.encroachment = { value: 0, max: 100, min: 0, type: '-' };
            }

            // Fill in whichever attributes are missing
            for (const [key, value] of Object.entries(defaultAttributes)) {
                // applied is never reset to a default — the stored data is preserved
                if (key === 'applied') {
                    // Only when applied is entirely absent is it seeded with an empty object
                    if (this.system.attributes[key] === undefined || this.system.attributes[key] === null) {
                        this.system.attributes[key] = {};
                    } else {
                    }
                    continue;
                }
                
                if (!this.system.attributes[key]) {
                    this.system.attributes[key] = foundry.utils.deepClone(value);
                } else if (key === 'skills' && !isEnemy) {
                    // Skills: keep the existing ones and add only the missing defaults (characters only)
                    const defaultSkills = value;
                    const currentSkills = this.system.attributes.skills;
                    for (const [skillKey, skillValue] of Object.entries(defaultSkills)) {
                        if (!currentSkills[skillKey]) {
                            // Only non-deletable default skills are re-added automatically;
                            // a deletable one (delete: true) may have been removed on purpose
                            if (skillValue.delete === false) {
                            currentSkills[skillKey] = foundry.utils.deepClone(skillValue);
                            }
                        } else {
                            // For an existing skill, refresh its delete flag from the default
                            if (currentSkills[skillKey].delete !== undefined && skillValue.delete !== undefined) {
                                currentSkills[skillKey].delete = skillValue.delete;
                            }
                        }
                    }
                }
            }

            // Character-only work
            if (!isEnemy) {
                // Normalize the syndrome array (the list of checked syndrome ids)
                if (!Array.isArray(this.system.attributes.syndrome)) {
                    const val = this.system.attributes.syndrome;
                    if (val == null) {
                        this.system.attributes.syndrome = [];
                    } else if (typeof val === 'string') {
                        this.system.attributes.syndrome = [val];
                    } else if (typeof val === 'object') {
                        // Legacy shape { <id>: true/false, … } → keep only the true keys
                        const entries = Object.entries(val);
                        this.system.attributes.syndrome = entries
                            .filter(([, v]) => !!v)
                            .map(([k]) => k);
                    } else {
                        this.system.attributes.syndrome = [];
                    }
                }

                this._prepareActorEnc();  // encroachment first
            }
            
            this._prepareActorAttributes();  // then the attributes

            let items = this.items;
            if (!Array.isArray(items)) {
                try {
                    items = Array.from(items);
                } catch (e) {
                    console.warn('Failed to convert items to array:', e);
                    items = [];
                }
            }
            
            // Enemies hold combos and effects only
            if (isEnemy) {
                this.comboList = items.filter(i => i.type === "combo" && !window.DX3rdIsInstantCombo?.(i));
                this.effectList = items.filter(i => i.type === "effect");
                // The rest stay empty
                this.workList = [];
                this.syndromeList = [];
                this.psionicsList = [];
                this.spellList = [];
                this.weaponList = [];
                this.protectList = [];
                this.connectionList = [];
                this.itemList = [];
                this.vehicleList = [];
                this.loisList = [];
                this.recordList = [];
            } else {
                // Characters allow every item type.
                // Performance: one pass into per-type buckets instead of 13 items.filter calls (same order, same meaning)
                this.workList = [];
                this.syndromeList = [];
                this.comboList = [];
                this.effectList = [];
                this.psionicsList = [];
                this.spellList = [];
                this.weaponList = [];
                this.protectList = [];
                this.connectionList = [];
                this.itemList = [];
                this.vehicleList = [];
                this.loisList = [];
                this.recordList = [];
                for (const it of items) {
                    if (window.DX3rdIsInstantCombo?.(it)) continue;
                    switch (it.type) {
                        case "works": this.workList.push(it); break;
                        case "syndrome": this.syndromeList.push(it); break;
                        case "combo": this.comboList.push(it); break;
                        case "effect": this.effectList.push(it); break;
                        case "psionic": this.psionicsList.push(it); break;
                        case "spell": this.spellList.push(it); break;
                        case "weapon": this.weaponList.push(it); break;
                        case "protect": this.protectList.push(it); break;
                        case "connection": this.connectionList.push(it); break;
                        case "book": case "etc": case "once": this.itemList.push(it); break;
                        case "vehicle": this.vehicleList.push(it); break;
                        case "lois": this.loisList.push(it); break;
                        case "record": this.recordList.push(it); break;
                    }
                }
            }
        }

        _prepareActorAttributes() {
            const system = this.system;
            const attrs = system.attributes;
            const isEnemy = this.type === 'enemy';

            // Enemies get the simplified arithmetic only
            if (isEnemy) {
                this._prepareEnemyAttributes();
                return;
            }

            // Classify once, so prepareData does not re-filter the same item type over and over.
            // Each bucket keeps the original collection order, so the arithmetic is unchanged.
            const actorItems = Array.from(this.items || []);
            const itemsByType = new Map();
            for (const item of actorItems) {
                const bucket = itemsByType.get(item.type);
                if (bucket) bucket.push(item);
                else itemsByType.set(item.type, [item]);
            }
            const itemsOfType = type => itemsByType.get(type) || [];

            // Prepare the active items and the applied effects up front.
            // Effect-like types (effect/spell/psionic/combo) are left out of this self-computation —
            // toggling them writes an appliedKey AE (DX3rdAppliedToggle) summed via collect() → appliedByKey,
            // so counting them again here would double. Only equipment, records, items and misc stay here.
            const activeItems = actorItems.filter(item =>
                item.system?.active?.state === true &&
                ['weapon', 'protect', 'vehicle', 'connection', 'etc', 'once', 'rois'].includes(item.type)
            );
            // Applied buffs are rebuilt from native ActiveEffects (flags); the legacy field is merged in as a transition bridge.
            const appliedEffects = window.DX3rdAppliedEffects?.collect
                ? window.DX3rdAppliedEffects.collect(this)
                : (attrs.applied || {});
            // Performance: index the applied effects once (this used to be re-walked for every derived value)
            const appliedByKey = this._indexAppliedEffects(appliedEffects);
            // A single reader over both the active-item and the applied contributions (lazily evaluated)
            const R = this._makeContribReader(activeItems, appliedByKey);

            // Performance: the identical item filters that several derived values repeated are done once
            // (previously attributes, skills, exp and equipment each re-ran this.items.filter)
            const worksItems = itemsOfType('works');
            const syndromeItems = itemsOfType('syndrome');
            const effectItems = itemsOfType('effect');
            const recordItems = itemsOfType('record');
            const psionicItems = itemsOfType('psionic');
            const roisItems = itemsOfType('rois');
            const spellItems = itemsOfType('spell');
            const onceItems = itemsOfType('once');
            const equippedWeapons = itemsOfType('weapon').filter(i => i.system?.equipment === true);
            const equippedProtects = itemsOfType('protect').filter(i => i.system?.equipment === true);
            const equippedVehicles = itemsOfType('vehicle').filter(i => i.system?.equipment === true);

            // === Pass 1: attribute totals (stat_bonus only) ===
            for (const key of ["body", "sense", "mind", "social"]) {
                const stat = attrs[key];
                
                // Syndrome bonus
                let syndromeBonus = 0;
                const syndromeList = attrs.syndrome || [];
                
                // The multiplier depends on how many syndrome items the actor holds
                const totalSyndromeCount = syndromeItems.length;
                
                let multiplier = 1;
                if (totalSyndromeCount === 1) {
                    // Pure breed: ×2
                    multiplier = 2;
                } else if (totalSyndromeCount >= 2) {
                    // Cross / tri breed: ×1
                    multiplier = 1;
                }
                
                for (const syndromeId of syndromeList) {
                    const syndromeItem = this.items.get(syndromeId);
                    if (syndromeItem && syndromeItem.system?.attributes?.[key]?.value) {
                        const baseValue = Number(syndromeItem.system.attributes[key].value) || 0;
                        syndromeBonus += baseValue * multiplier;
                    }
                }

                // Works bonus
                let worksBonus = 0;
                for (const worksItem of worksItems) {
                    if (worksItem.system?.attributes?.[key]?.value) {
                        worksBonus += window.DX3rdFormulaEvaluator.evaluate(worksItem.system.attributes[key].value, worksItem, this);
                    }
                }

                // stat_bonus from active items and applied effects, matched by attribute label
                stat.bonus = R.byLabel('stat_bonus', key);

                // total = point + extra + bonus + syndrome + works
                stat.total = (stat.point || 0) + (stat.extra || 0) + stat.bonus + syndromeBonus + worksBonus;
                // Floor: total is never below 0
                if (stat.total < 0) stat.total = 0;
            }

            // === Pass 1: skill totals (stat_bonus only) ===
            const skills = attrs.skills || {};

            for (const [key, skill] of Object.entries(skills)) {
                // Works bonus
                let worksBonus = 0;
                for (const worksItem of worksItems) {
                    if (worksItem.system?.skills?.[key]?.apply && worksItem.system.skills[key].add) {
                        worksBonus += window.DX3rdFormulaEvaluator.evaluate(worksItem.system.skills[key].add, worksItem, this);
                    }
                }

                // stat_bonus from active items and applied effects, matched by skill label
                skill.bonus = R.byLabel('stat_bonus', key);
                // Keep the works value too, for display in dialogs
                skill.works = worksBonus;
                
                // total = point + extra + bonus + works
                skill.total = (skill.point || 0) + (skill.extra || 0) + skill.bonus + worksBonus;
                // Floor: total is never below 0
                if (skill.total < 0) skill.total = 0;
            }

            // === Derived values (HP, init, saving, …), computed from the totals ===

            // HP = body.total × 2 + mind.total + 20 + item/applied bonuses
            const hpBonus = R.sum('hp');

            attrs.hp.max = (attrs.body?.total || 0) * 2 + (attrs.mind?.total || 0) + 20 + hpBonus;
            if (attrs.hp.value > attrs.hp.max) attrs.hp.value = attrs.hp.max;
            if (attrs.hp.value < 0) attrs.hp.value = 0;

            // === Attack === (label buckets: melee/ranged/fist; no label or '-' → the catch-all '_')
            // fist = fist-only attack power (Degeneration Organ etc.) — added at damage time only when the weapon is the fist
            const atk = R.bucket('attack', ['melee', 'ranged', 'fist']);
            const atkDiceFormula = R.actionDiceFormula('attack', ['melee', 'ranged', 'fist']);

            if (!attrs.attack) attrs.attack = { value: 0, melee: 0, ranged: 0, fist: 0 };
            attrs.attack.value = atk._;
            attrs.attack.melee = atk.melee;
            attrs.attack.ranged = atk.ranged;
            attrs.attack.fist = atk.fist;
            attrs.attack.rollFormula = atkDiceFormula;

            // === Armor ===
            let armorBonus = 0;
            // A dice formula written into an equipment's own field (protect/vehicle system.armor) is
            // not on an attribute channel, so the reader (R) never sees it. It is gathered separately
            // and joined into valueFormula — otherwise evaluate() returns 0 and the input silently vanishes.
            const equipmentArmorFormulas = [];
            const addEquipmentArmor = (equipment) => {
                if (!equipment?.system?.armor) return;
                const F = window.DX3rdFormulaEvaluator;
                const prepared = F.prepareRollFormula(equipment.system.armor, equipment, this);
                if (F.hasDice(prepared)) equipmentArmorFormulas.push(`(${prepared})`);
                else armorBonus += F.evaluate(equipment.system.armor, equipment, this);
            };

            // Armor from the equipped protects/vehicles (both lists were computed once above)
            for (const protect of equippedProtects) addEquipmentArmor(protect);
            for (const vehicle of equippedVehicles) addEquipmentArmor(vehicle);

            // Armor bonus from active items and applied effects
            armorBonus += R.sum('armor');

            attrs.armor.value = armorBonus;
            // Floor: armor is never below 0
            if (attrs.armor.value < 0) attrs.armor.value = 0;
            if (attrs.armor.value < attrs.armor.min) attrs.armor.value = attrs.armor.min;
            // A dice formula written straight into the value field ([level]d10 etc.) is preserved, not rolled here.
            // The defense dialog rolls it once when the hit is confirmed, on top of the fixed value.
            attrs.armor.valueFormula = [R.actionDiceFormula('armor')._, ...equipmentArmorFormulas]
                .filter(Boolean).join(' + ');

            // === Guard === (label buckets: melee/ranged/fist; no label or '-' → the catch-all '_')
            // Same axis as attack power — "+N to the guard of the fist" (the prosthetic arm etc.) must
            // apply **only when guarding with that weapon**, so it stays bucketed until the guarding
            // weapon is chosen. Only the unconditional `_` (catch-all) descends into base.
            const grd = R.bucket('guard', ['melee', 'ranged', 'fist']);
            const grdDiceFormula = R.actionDiceFormula('guard', ['melee', 'ranged', 'fist']);
            let equipmentGuardBonus = 0;
            const equipmentGuardFormulas = [];

            // The actor sheet's displayed value includes the equipped weapons' own guard values. The
            // defense dialog starts from base below and re-adds only the chosen weapon, so nothing doubles.
            for (const weapon of equippedWeapons) {
                const F = window.DX3rdFormulaEvaluator;
                const raw = weapon.system?.guard;
                if (raw) {
                    const prepared = F.prepareRollFormula(raw, weapon, this);
                    if (F.hasDice(prepared)) equipmentGuardFormulas.push(`(${prepared})`);
                    else equipmentGuardBonus += Number(F.evaluate(raw, weapon, this)) || 0;
                }
                // That weapon's bucket bonuses also ride on the **display value only**. Putting them in
                // base would apply them with no weapon chosen; omitting them here would make the sheet
                // read lower than reality. The rule matches the defense dialog (once per weapon) — if
                // the two diverge, the sheet and the dialog disagree.
                // The fist takes both fist and melee (they add) — the same rule as on the attack side.
                const buckets = window.DX3rdUniversalHandler?.resolveGuardBuckets?.(weapon) || [];
                for (const bucket of buckets) {
                    equipmentGuardBonus += grd[bucket] || 0;
                    if (grdDiceFormula[bucket]) equipmentGuardFormulas.push(`(${grdDiceFormula[bucket]})`);
                }
            }

            attrs.guard.base = Math.max(grd._, attrs.guard.min || 0, 0);
            attrs.guard.melee = grd.melee;
            attrs.guard.ranged = grd.ranged;
            attrs.guard.fist = grd.fist;
            attrs.guard.rollFormula = grdDiceFormula;
            attrs.guard.equipment = equipmentGuardBonus;
            attrs.guard.equipmentFormula = equipmentGuardFormulas.join(' + ');
            attrs.guard.value = Math.max(attrs.guard.base + equipmentGuardBonus, attrs.guard.min || 0, 0);
            attrs.guard.valueFormula = grdDiceFormula._;   // dice written into the guard field (rolled when defense is confirmed)

            attrs.actionRollFormula = { dice: R.actionDiceFormula('dice')._, add: R.actionDiceFormula('add')._, critical: R.actionDiceFormula('critical')._, major: { dice: R.actionDiceFormula('major_dice')._, add: R.actionDiceFormula('major_add')._, critical: R.actionDiceFormula('major_critical')._ }, reaction: { dice: R.actionDiceFormula('reaction_dice')._, add: R.actionDiceFormula('reaction_add')._, critical: R.actionDiceFormula('reaction_critical')._ }, dodge: { dice: R.actionDiceFormula('dodge_dice')._, add: R.actionDiceFormula('dodge_add')._, critical: R.actionDiceFormula('dodge_critical')._ } };

            // === Penetrate ===
            const penetrateBonus = R.sum('penetrate');

            attrs.penetrate.value = penetrateBonus;
            // Floor: penetrate is never below 0
            if (attrs.penetrate.value < 0) attrs.penetrate.value = 0;
            if (attrs.penetrate.value < attrs.penetrate.min) attrs.penetrate.value = attrs.penetrate.min;
            // The penetrate dice are rolled at accuracy time (resolveAttackBonusesRolled), frozen to a
            // number, and carried as that number into the damage and defense dialogs. Never re-rolled there.
            attrs.penetrate.rollFormula = R.actionDiceFormula('penetrate')._;

            // === Reduce ===
            const reduceBonus = R.sum('reduce');

            attrs.reduce.value = reduceBonus;
            // Floor: reduce is never below 0
            if (attrs.reduce.value < 0) attrs.reduce.value = 0;
            if (attrs.reduce.value < attrs.reduce.min) attrs.reduce.value = attrs.reduce.min;
            attrs.reduce.valueFormula = R.actionDiceFormula('reduce')._;   // dice written into the reduction field (rolled when defense is confirmed)

            // Initiative = sense.total × 2 + mind.total + item/applied bonuses
            let initBonus = 0;
            
            // init from the equipped protects
            const equippedProtectsForInit = equippedProtects;
            for (const protect of equippedProtectsForInit) {
                if (protect.system?.init) {
                    const initValue = window.DX3rdFormulaEvaluator.evaluate(protect.system.init, protect, this);
                    initBonus += initValue;
                }
            }
            
            // init from the equipped vehicles
            const equippedVehiclesForInit = equippedVehicles;
            for (const vehicle of equippedVehiclesForInit) {
                if (vehicle.system?.init) {
                    const initValue = window.DX3rdFormulaEvaluator.evaluate(vehicle.system.init, vehicle, this);
                    initBonus += initValue;
                }
            }
            
            // init bonus from active items and applied effects
            initBonus += R.sum('init');

            attrs.init.value = (attrs.sense?.total || 0) * 2 + (attrs.mind?.total || 0) + initBonus;
            
            // Madness 5: apply its init penalty (before the berserk penalties)
            const madnessTypePrefix = game.i18n.localize('DX3rd.MadnessType');
            const madness5Name = madnessTypePrefix + ': ' + game.i18n.localize('DX3rd.Madness5');
            const hasMadness5 = effectItems.some(item => item.name === madness5Name);
            
            if (hasMadness5) {
                const initBeforeMadness5 = attrs.init.value;
                attrs.init.value -= 5;
                
                // When the pre-penalty value was 1..5, floor the result at 1 (already 0 or less is fine)
                if (initBeforeMadness5 >= 1 && initBeforeMadness5 <= 5) {
                    attrs.init.value = Math.max(1, attrs.init.value);
                }
            }
            
            // Berserk condition
            if (system.conditions?.berserk?.active) {
                // Berserk "release" (-9999)
                if (system.conditions.berserk.type === 'release') {
                    attrs.init.value -= 9999;
                }
                // Berserk "delusion" (-10)
                else if (system.conditions.berserk.type === 'delusion') {
                    attrs.init.value -= 10;
                }
            }
            
            // Initiative floors at 0
            if (attrs.init.value < 0) attrs.init.value = 0;

            // Movement
            // The simplified-distance setting
            const simplifiedDistance = game.settings.get('dx3rd-emanim', 'simplifiedDistance');
            
            if (!simplifiedDistance) {
                // Equipped vehicles (used for move.battle)
                const equippedVehicle = equippedVehicles[0];
                
                // Base formula: the greater of init.value + 5 and the vehicle's move / 5
                let baseBattleMove = attrs.init.value + 5;
                
                if (equippedVehicle && equippedVehicle.system?.move !== undefined) {
                    // Evaluate the vehicle's move value
                    const vehicleMove = window.DX3rdFormulaEvaluator.evaluate(
                        equippedVehicle.system.move,
                        this,
                        equippedVehicle
                    );
                    const vehicleBattleMove = Math.floor(vehicleMove / 5);
                    // Take the greater of vehicle move/5 and initiative+5
                    baseBattleMove = Math.max(baseBattleMove, vehicleBattleMove);
                }
                
                // battleMove bonus
                let moveBattleBonus = 0;
                
                // battleMove bonus from active items and applied effects
                moveBattleBonus += R.sum('battleMove');

                attrs.move.battle = baseBattleMove + moveBattleBonus;
                
                // Rigor condition (-9999)
                if (system.conditions?.rigor?.active) {
                    attrs.move.battle -= 9999;
                }
                
                // Battle movement floors at 0
                if (attrs.move.battle < 0) attrs.move.battle = 0;
                
                // Full movement: move.battle × 2, or the vehicle's move
                if (equippedVehicle && equippedVehicle.system?.move !== undefined) {
                    // With a vehicle, use its move value
                    const vehicleMove = window.DX3rdFormulaEvaluator.evaluate(
                        equippedVehicle.system.move,
                        equippedVehicle,
                        this
                    );
                    attrs.move.full = vehicleMove;
                } else {
                    // Without one, move.battle × 2
            attrs.move.full = attrs.move.battle * 2;
                }
                
                // fullMove bonus on top
                let moveFullBonus = 0;
                
                // fullMove bonus from active items and applied effects
                moveFullBonus += R.sum('fullMove');
                
                // Add it to move.full (based on the vehicle when present, otherwise move.battle × 2)
                attrs.move.full += moveFullBonus;
                
                // Rigor condition (-9999)
                if (system.conditions?.rigor?.active) {
                    attrs.move.full -= 9999;
                }
                
                // Full movement floors at 0
                if (attrs.move.full < 0) attrs.move.full = 0;
                
                // SpellCalamity effect 1: movement halved.
                // move_half lands in the index's 'move_half' bucket whether it is a primitive name or an object key
                const hasMoveHalf = (appliedByKey['move_half'] || []).length > 0;
                
                if (hasMoveHalf) {
                    if (equippedVehicle && equippedVehicle.system?.move !== undefined) {
                        // With a vehicle: halve both move.battle and move.full, then compare that /5 against move.battle
                        attrs.move.battle = Math.floor(attrs.move.battle / 2);
                        attrs.move.full = Math.floor(attrs.move.full / 2);
                        const vehicleBattleFromFull = Math.floor(attrs.move.full / 5);
                        attrs.move.battle = Math.max(attrs.move.battle, vehicleBattleFromFull);
                    } else {
                        // Without one: halve move.battle only (move.full follows automatically)
                        attrs.move.battle = Math.floor(attrs.move.battle / 2);
                        attrs.move.full = attrs.move.battle * 2;
                    }
                }
            } else {
                // Simplified distance formula
                // Equipped vehicles
                const equippedVehicle = equippedVehicles[0];
                
                // Base formula: the greater of floor(init.value / 2) + 2 and the vehicle's move / 5
                let baseBattleMove = Math.floor(attrs.init.value / 2) + 2;
                
                if (equippedVehicle && equippedVehicle.system?.move !== undefined) {
                    // Evaluate the vehicle's move value
                    const vehicleMove = window.DX3rdFormulaEvaluator.evaluate(
                        equippedVehicle.system.move,
                        this,
                        equippedVehicle
                    );
                    const vehicleBattleMove = Math.floor(vehicleMove / 5);
                    // Take the greater of vehicle move/5 and (initiative/2)+2
                    baseBattleMove = Math.max(baseBattleMove, vehicleBattleMove);
                }
                
                // battleMove bonus
                let moveBattleBonus = 0;
                
                // battleMove bonus from active items and applied effects
                moveBattleBonus += R.sum('battleMove');
                
                attrs.move.battle = baseBattleMove + moveBattleBonus;
                
                // Rigor condition (-9999)
                if (system.conditions?.rigor?.active) {
                    attrs.move.battle -= 9999;
                }
                
                // Battle movement floors at 0
                if (attrs.move.battle < 0) attrs.move.battle = 0;
                
                // Full movement: move.battle × 2, or the vehicle's move
                if (equippedVehicle && equippedVehicle.system?.move !== undefined) {
                    // With a vehicle, use its move value
                    const vehicleMove = window.DX3rdFormulaEvaluator.evaluate(
                        equippedVehicle.system.move,
                        equippedVehicle,
                        this
                    );
                    attrs.move.full = vehicleMove;
                } else {
                    // Without one, move.battle × 2
            attrs.move.full = attrs.move.battle * 2;
                }
                
                // fullMove bonus on top
                let moveFullBonus = 0;
                
                // fullMove bonus from active items and applied effects
                moveFullBonus += R.sum('fullMove');
                
                // Add it to move.full (based on the vehicle when present, otherwise move.battle × 2)
                attrs.move.full += moveFullBonus;
                
                // Rigor condition (-9999)
                if (system.conditions?.rigor?.active) {
                    attrs.move.full -= 9999;
                }
                
                // Full movement floors at 0
                if (attrs.move.full < 0) attrs.move.full = 0;
                
                // SpellCalamity effect 1: movement halved (simplified distance)
                const hasMoveHalfSimplified = (appliedByKey['move_half'] || []).length > 0;
                
                if (hasMoveHalfSimplified) {
                    if (equippedVehicle && equippedVehicle.system?.move !== undefined) {
                        // With a vehicle: halve both move.battle and move.full, then compare that /5 against move.battle
                        attrs.move.battle = Math.floor(attrs.move.battle / 2);
                        attrs.move.full = Math.floor(attrs.move.full / 2);
                        const vehicleBattleFromFull = Math.floor(attrs.move.full / 5);
                        attrs.move.battle = Math.max(attrs.move.battle, vehicleBattleFromFull);
                    } else {
                        // Without one: halve move.battle only (move.full follows automatically)
                        attrs.move.battle = Math.floor(attrs.move.battle / 2);
                        attrs.move.full = attrs.move.battle * 2;
                    }
                }
            }

            // Saving = social.total × 2 + procure.total × 2 + item/applied bonuses
            const socialTotal = Number(attrs.social?.total || 0);
            const procureTotal = Number(attrs.skills?.procure?.total || 0);
            let savingBonus = 0;
            
            // saving_max bonus from active items and applied effects
            savingBonus += R.sum('saving_max');
            
            // The theoretical saving maximum (before deducting the items' permanent-stock costs)
            attrs.saving.max = socialTotal * 2 + procureTotal * 2 + savingBonus;
            
            // The remaining saving is derived from the current maximum and the held items every time,
            // never stored. Treating the structural 0 as a past value and Math.min-ing it would leave
            // an actor that once hit 0 permanently stuck there, so item changes and stat changes both recompute.
            attrs.saving.remain = calculateSavingRemain(attrs.saving.max, actorItems);

            // Stock = saving.remain + item/applied bonuses
            let stockBonus = 0;
            
            // stock_point bonus from active items and applied effects
            stockBonus += R.sum('stock_point');
            
            // Base stock = the saving left after permanent purchases, plus effect bonuses.
            // Current stock = base + the cumulative modifier the user recorded with a reason.
            // In legacy data value=0 cannot be told apart from an unset initial value, and an old bug
            // pinned most of them at 0, so a document without a modifier migrates to "no adjustment" (0).
            // An overspend on saving (a negative remain) stays in the saving field and is not carried
            // into stock — the two are separate budgets, so one deficit must not be charged twice.
            Object.assign(attrs.stock, deriveStock(
                Math.max(Number(attrs.saving.remain) || 0, 0) + stockBonus,
                attrs.stock.modifier,
                attrs.stock.min
            ));

            // Encroachment / experience defaults
            attrs.encroachment.max = 100;
            attrs.encroachment.min = attrs.encroachment.min ?? 0;
            if (attrs.encroachment.value < attrs.encroachment.min) attrs.encroachment.value = attrs.encroachment.min;
            
            // Initial encroachment
            // system.encroach.init is not an effect-only slot. Emblems, uniques and other ordinary
            // items use the same field, and every type is summed regardless.
            // Records are excluded here, since they add through their own system.encroachment path.
            let encroachInitSum = sumItemEncroachInit(actorItems);
            
            // Encroachment from record items
            for (const record of recordItems) {
                const recordEncroach = Number(record.system?.encroachment) || 0;
                encroachInitSum += recordEncroach;
            }
            
            const encroachInput = Number(attrs.encroachment.init?.input) || 0;
            attrs.encroachment.init.value = encroachInput + encroachInitSum;

            // Experience from record items
            let recordExpSum = 0;
            for (const record of recordItems) {
                const recordExp = Number(record.system?.exp) || 0;
                recordExpSum += recordExp;
            }

            attrs.exp.init = Number(attrs.exp.init) || 0;
            attrs.exp.append = recordExpSum;
            attrs.exp.total = attrs.exp.init + attrs.exp.append;
            
            // Experience spent (exp.now)
            let expReduction = 0;
            
            // Experience spent on attributes
            for (const key of ["body", "sense", "mind", "social"]) {
                const stat = attrs[key];
                const point = stat.point || 0;
                
                // Syndrome bonus
                let syndromeBonus = 0;
                const syndromeList = attrs.syndrome || [];
                const totalSyndromeCount = syndromeItems.length;
                let multiplier = 1;
                if (totalSyndromeCount === 1) {
                    multiplier = 2;
                } else if (totalSyndromeCount >= 2) {
                    multiplier = 1;
                }
                for (const syndromeId of syndromeList) {
                    const syndromeItem = this.items.get(syndromeId);
                    if (syndromeItem && syndromeItem.system?.attributes?.[key]?.value) {
                        const baseValue = Number(syndromeItem.system.attributes[key].value) || 0;
                        syndromeBonus += baseValue * multiplier;
                    }
                }
                
                // Works bonus
                let worksBonus = 0;
                for (const worksItem of worksItems) {
                    if (worksItem.system?.attributes?.[key]?.value) {
                        worksBonus += window.DX3rdFormulaEvaluator.evaluate(worksItem.system.attributes[key].value, worksItem, this);
                    }
                }
                
                const bonus = syndromeBonus + worksBonus;
                
                // The full score (syndrome + works + points)
                const totalPoint = point + bonus;
                
                let abilityExpReduction = 0;
                
                // 0..11: 10 points each
                if (totalPoint > 11) {
                    abilityExpReduction += (11 - 0) * 10;
                } else {
                    abilityExpReduction += (totalPoint - 0) * 10;
                }
                
                // 12..21: 20 points each
                if (totalPoint > 21) {
                    abilityExpReduction += (21 - 11) * 20;
                } else if (totalPoint > 11) {
                    abilityExpReduction += (totalPoint - 11) * 20;
                }
                
                // 22 and up: 30 points each
                if (totalPoint > 21) {
                    abilityExpReduction += (totalPoint - 21) * 30;
                }
                
                // Deduct the syndrome + works bonus
                if (bonus > 0) {
                    abilityExpReduction -= bonus * 10;
                }
                
                expReduction += abilityExpReduction;
            }
            
            // Experience spent on skills
            for (const [key, skill] of Object.entries(skills)) {
                const point = skill.point || 0;
                const worksBonus = skill.works || 0;
                const totalPoint = point + worksBonus;
                const isDeletable = skill.delete || false;
                
                let skillExpReduction = 0;
                
                if (isDeletable) {
                    // delete=true: 0~6 (1), 7~11 (3), 12~21 (5), 22+ (10)
                    // 0..6: 1 point each
                    if (totalPoint > 6) {
                        skillExpReduction += (6 - 0) * 1;
                    } else {
                        skillExpReduction += (totalPoint - 0) * 1;
                    }
                    
                    // 7..11: 3 points each
                    if (totalPoint > 11) {
                        skillExpReduction += (11 - 6) * 3;
                    } else if (totalPoint > 6) {
                        skillExpReduction += (totalPoint - 6) * 3;
                    }
                    
                    // 12..21: 5 points each
                    if (totalPoint > 21) {
                        skillExpReduction += (21 - 11) * 5;
                    } else if (totalPoint > 11) {
                        skillExpReduction += (totalPoint - 11) * 5;
                    }
                    
                    // 22 and up: 10 points each
                    if (totalPoint > 21) {
                        skillExpReduction += (totalPoint - 21) * 10;
                    }
                } else {
                    // delete=false: 0~6 (2), 7~11 (3), 12~21 (5), 22+ (10)
                    // 0..6: 2 points each
                    if (totalPoint > 6) {
                        skillExpReduction += (6 - 0) * 2;
                    } else {
                        skillExpReduction += (totalPoint - 0) * 2;
                    }
                    
                    // 7..11: 3 points each
                    if (totalPoint > 11) {
                        skillExpReduction += (11 - 6) * 3;
                    } else if (totalPoint > 6) {
                        skillExpReduction += (totalPoint - 6) * 3;
                    }
                    
                    // 12..21: 5 points each
                    if (totalPoint > 21) {
                        skillExpReduction += (21 - 11) * 5;
                    } else if (totalPoint > 11) {
                        skillExpReduction += (totalPoint - 11) * 5;
                    }
                    
                    // 22 and up: 10 points each
                    if (totalPoint > 21) {
                        skillExpReduction += (totalPoint - 21) * 10;
                    }
                }
                
                // Deduct the works bonus (×2 when delete=false, ×1 when delete=true)
                if (worksBonus > 0) {
                    const bonusMultiplier = isDeletable ? 1 : 2;
                    skillExpReduction -= worksBonus * bonusMultiplier;
                }
                
                expReduction += skillExpReduction;
            }
            
            // Experience spent on effect items
            for (const effect of effectItems) {
                const expOwn = effect.system?.exp?.own || false;
                const expUpgrade = effect.system?.exp?.upgrade || false;
                const effectType = effect.system?.type || 'normal';
                const levelInit = effect.system?.level?.init || 1;
                
                if (effectType === 'easy') {
                    // easy type
                    if (expOwn) {
                        expReduction += 2;
                    }
                    if (expUpgrade && levelInit >= 2) {
                        // -2 at level 2, -4 at level 3 (per level, not cumulative)
                        expReduction += (levelInit - 1) * 2;
                    }
                } else if (effectType === 'normal') {
                    // normal type
                    if (expOwn) {
                        expReduction += 15;
                    }
                    if (expUpgrade && levelInit >= 2) {
                        // -5 at level 2, -10 at level 3 (per level, not cumulative)
                        expReduction += (levelInit - 1) * 5;
                    }
                }
            }
            
            // Experience spent on psionic items
            for (const psionic of psionicItems) {
                const expOwn = psionic.system?.exp?.own || false;
                const expUpgrade = psionic.system?.exp?.upgrade || false;
                const levelInit = psionic.system?.level?.init || 1;
                
                if (expOwn) {
                    expReduction += 15;
                }
                if (expUpgrade && levelInit >= 2) {
                    // -5 at level 2, -10 at level 3 (per level, not cumulative)
                    expReduction += (levelInit - 1) * 5;
                }
            }
            
            // Experience spent on Lois items (type M costs 15)
            for (const rois of roisItems) {
                const roisType = rois.system?.type || '-';
                if (roisType === 'M') {
                    expReduction += 15;
                }
            }
            
            // Experience spent on spell items
            for (const spell of spellItems) {
                const temporarySpell = spell.system?.temporarySpell || false;
                if (!temporarySpell) {
                    const spellExp = Number(spell.system?.exp) || 0;
                    expReduction += spellExp;
                }
            }
            
            // Experience spent on weapon / protect / vehicle / book / connection / etc items
            const expItemTypes = ['weapon', 'protect', 'vehicle', 'book', 'connection', 'etc'];
            for (const itemType of expItemTypes) {
                for (const item of itemsOfType(itemType)) {
                    const itemExp = Number(item.system?.exp) || 0;
                    expReduction += itemExp;
                }
            }
            
            // Experience spent on consumable (once) items
            for (const once of onceItems) {
                const quantity = Number(once.system?.quantity) || 1;
                const onceExp = Number(once.system?.exp) || 0;
                expReduction += quantity * onceExp;
            }
            
            attrs.exp.now = attrs.exp.total - expReduction;
            
            // Apply the experience discount
            const discount = Number(attrs.exp?.discount) || 0;
            attrs.exp.now += discount;
            // Ceiling: exp.now can never exceed exp.total
            if (attrs.exp.now > attrs.exp.total) attrs.exp.now = attrs.exp.total;

            // === Critical floor ===
            const defaultCritical = game.settings.get("dx3rd-emanim", "defaultCritical") || 10; // the default
            // The floor is the declared value only when something declares one; otherwise it is the
            // rules' base floor of 2. Starting from defaultCritical (10) instead meant an undeclared
            // "critical -1" was eaten by Math.max(10, 9) and vanished entirely.
            // (Sublimation 3 pairing critical:-1 with critical_min:2 was a workaround for exactly that.)
            const declaredCriticalMin = R.min('critical_min', Infinity);
            const criticalMin = Number.isFinite(declaredCriticalMin) ? declaredCriticalMin : 2;

            // Set the critical floor (never below 2)
            if (!attrs.critical) attrs.critical = {};
            attrs.critical.min = Math.max(2, criticalMin);

            // === Pass 2: attribute dice, add and critical (every total is ready now) ===
            for (const key of ["body", "sense", "mind", "social"]) {
                const stat = attrs[key];
                
                // dice = total + encroachment + dice (generic) + stat_dice[attribute]
                // From active items and applied effects: dice (unlabeled) + stat_dice matching this attribute
                const abilityDiceBonus = R.sum('dice');
                const abilityStatDiceBonus = R.byLabel('stat_dice', key);

                stat.dice = stat.total + (attrs.encroachment?.dice || 0) + abilityDiceBonus + abilityStatDiceBonus;
                // Floor: dice is never below 1
                if (stat.dice < 1) stat.dice = 1;
                
                // add = add (generic) + stat_add[attribute]
                // From active items and applied effects: add (unlabeled) + stat_add matching this attribute
                const abilityAddBonus = R.sum('add');
                const abilityStatAddBonus = R.byLabel('stat_add', key);

                stat.add = abilityAddBonus + abilityStatAddBonus;
                
                // critical = max(critical.min, defaultCritical + critical (generic))
                // The critical modifier goes through the index, so object and primitive forms both count
                const abilityCriticalMod = R.sum('critical');

                const calculatedCritical = defaultCritical + abilityCriticalMod;
                stat.critical = Math.max(attrs.critical?.min || defaultCritical, calculatedCritical);
                
                // Per-roll-type dice, critical and add for major / reaction / dodge
                // major_dice, major_critical, major_add
                let majorDiceBonus = 0;
                let majorCriticalMod = 0;
                let majorAddBonus = 0;
                
                // reaction_dice, reaction_critical, reaction_add
                let reactionDiceBonus = 0;
                let reactionCriticalMod = 0;
                let reactionAddBonus = 0;
                
                // dodge_dice, dodge_critical, dodge_add
                let dodgeDiceBonus = 0;
                let dodgeCriticalMod = 0;
                let dodgeAddBonus = 0;
                
                // dodge from the equipped protects (applied to dodge_add)
                const equippedProtectsForDodge = equippedProtects;
                for (const protect of equippedProtectsForDodge) {
                    if (protect.system?.dodge) {
                        const dodgeValue = window.DX3rdFormulaEvaluator.evaluate(protect.system.dodge, protect, this);
                        dodgeAddBonus += dodgeValue;
                    }
                }
                
                // The nine major/reaction/dodge keys, merged in a single pass over items + applied
                const M = R.mrd();
                majorDiceBonus += M.major_dice;
                majorCriticalMod += M.major_critical;
                majorAddBonus += M.major_add;
                reactionDiceBonus += M.reaction_dice;
                reactionCriticalMod += M.reaction_critical;
                reactionAddBonus += M.reaction_add;
                dodgeDiceBonus += M.dodge_dice;
                dodgeCriticalMod += M.dodge_critical;
                dodgeAddBonus += M.dodge_add;

                // Store the final per-roll-type values
                stat.major = {
                    dice: stat.dice + majorDiceBonus,
                    critical: Math.max(attrs.critical?.min || defaultCritical, stat.critical + majorCriticalMod),
                    add: stat.add + majorAddBonus
                };

                stat.reaction = {
                    dice: stat.dice + reactionDiceBonus,
                    critical: Math.max(attrs.critical?.min || defaultCritical, stat.critical + reactionCriticalMod),
                    add: stat.add + reactionAddBonus
                };

                stat.dodge = {
                    dice: stat.dice + reactionDiceBonus + dodgeDiceBonus,
                    critical: Math.max(attrs.critical?.min || defaultCritical, stat.critical + reactionCriticalMod + dodgeCriticalMod),
                    add: stat.add + reactionAddBonus + dodgeAddBonus
                };
                // stat_bonus feeds the attribute total (the dice pool); stat_dice and stat_add feed
                // dice and the addition respectively. Dice formulas are not rolled here — the check does that.
                stat.rollFormula = {
                    dice: [
                        R.actionDiceFormulaWhere('stat_bonus', label => label === key),
                        R.actionDiceFormulaWhere('stat_dice', label => label === key)
                    ].filter(Boolean).join(' + '),
                    add: R.actionDiceFormulaWhere('stat_add', label => label === key)
                };
            }

            // === Pass 2: skill dice, add and critical, and their classification ===
            system.skills = { body: {}, sense: {}, mind: {}, social: {} };

            for (const [key, skill] of Object.entries(skills)) {
                // dice = the base attribute's dice + stat_dice[skill]
                const baseAbility = attrs[skill.base];
                let baseDice = baseAbility ? baseAbility.dice || 0 : 0;
                // stat_dice from active items and applied effects (direct or skill-group match)
                const skillStatDiceBonus = R.bySkill('stat_dice', key);

                skill.dice = baseDice + skillStatDiceBonus;
                // Floor: dice is never below 1
                if (skill.dice < 1) skill.dice = 1;
                
                // add = add (generic) + stat_add[attribute] + stat_add[skill]
                // From items and applied: add (unlabeled) + stat_add for skill.base + stat_add (direct/group match)
                const skillAddBonus = R.sum('add');
                const skillAbilityAddBonus = R.byLabel('stat_add', skill.base);
                const skillStatAddBonus = R.bySkill('stat_add', key);

                skill.add = skill.total + skillAddBonus + skillAbilityAddBonus + skillStatAddBonus;
                
                // critical: taken from the base attribute
                skill.critical = baseAbility ? baseAbility.critical || defaultCritical : defaultCritical;
                
                // Per-roll-type dice, critical and add for major / reaction / dodge
                let majorDiceBonus = 0;
                let majorCriticalMod = 0;
                let majorAddBonus = 0;
                
                let reactionDiceBonus = 0;
                let reactionCriticalMod = 0;
                let reactionAddBonus = 0;
                
                let dodgeDiceBonus = 0;
                let dodgeCriticalMod = 0;
                let dodgeAddBonus = 0;
                
                // dodge from the equipped protects (applied to dodge_add)
                const equippedProtectsForSkill = equippedProtects;
                for (const protect of equippedProtectsForSkill) {
                    if (protect.system?.dodge) {
                        const dodgeValue = window.DX3rdFormulaEvaluator.evaluate(protect.system.dodge, protect, this);
                        dodgeAddBonus += dodgeValue;
                    }
                }
                
                // The nine major/reaction/dodge keys, merged in a single pass over items + applied
                const M = R.mrd();
                majorDiceBonus += M.major_dice;
                majorCriticalMod += M.major_critical;
                majorAddBonus += M.major_add;
                reactionDiceBonus += M.reaction_dice;
                reactionCriticalMod += M.reaction_critical;
                reactionAddBonus += M.reaction_add;
                dodgeDiceBonus += M.dodge_dice;
                dodgeCriticalMod += M.dodge_critical;
                dodgeAddBonus += M.dodge_add;

                // Store the final per-roll-type values
                skill.major = {
                    dice: skill.dice + majorDiceBonus,
                    critical: Math.max(attrs.critical?.min || defaultCritical, skill.critical + majorCriticalMod),
                    add: skill.add + majorAddBonus
                };

                skill.reaction = {
                    dice: skill.dice + reactionDiceBonus,
                    critical: Math.max(attrs.critical?.min || defaultCritical, skill.critical + reactionCriticalMod),
                    add: skill.add + reactionAddBonus
                };

                skill.dodge = {
                    dice: skill.dice + reactionDiceBonus + dodgeDiceBonus,
                    critical: Math.max(attrs.critical?.min || defaultCritical, skill.critical + reactionCriticalMod + dodgeCriticalMod),
                    add: skill.add + reactionAddBonus + dodgeAddBonus
                };

                // A skill check also inherits the base attribute's dice formulas. stat_bonus adds into
                // the skill total, so it is treated as an addition; stat_dice feeds the dice pool.
                const skillMatches = label => label === key || window.DX3rdSkillGroupMatcher?.isSkillInGroup(key, label);
                skill.rollFormula = {
                    dice: [
                        baseAbility?.rollFormula?.dice,
                        R.actionDiceFormulaWhere('stat_dice', skillMatches)
                    ].filter(Boolean).join(' + '),
                    add: [
                        baseAbility?.rollFormula?.add,
                        R.actionDiceFormulaWhere('stat_bonus', skillMatches),
                        R.actionDiceFormulaWhere('stat_add', skillMatches)
                    ].filter(Boolean).join(' + ')
                };

                // Classify only when base is valid
                if (skill.base && system.skills[skill.base]) {
                    system.skills[skill.base][key] = skill;
                }
            }

            // Defaults for the remaining top-level fields
            system.sublimation = system.sublimation || { dice: 0, critical: 0, cast_dice: 0, cast_add: 0 };
            system.details = system.details || {};
            system.conditions = system.conditions || {};

            // Final casting-related derivations (after every skill is computed).
            // Performance: reuse the index built above, instead of a second collect() + index pass.
            this._prepareCastingStats(appliedByKey);
        }

        /**
         * Performance: walk the applied effects (attrs.applied) once and index them by key.
         * Every derived value used to re-walk Object.entries(appliedEffects) in full — dozens of times.
         *
         * Returns { [key]: [{ label, val }] }.
         *  - The key/label/val normalization matches exactly what the (uniform) consumers derived before:
         *    · val = (an object with 'value') ? attrValue.value
         *          : (boolean) ? 0
         *          : evaluate(attrValue)   // a primitive number passes through
         *  - The primitive form ({ dice: -2 }) has label=null (in real data, keys that need a label are never stored primitively).
         *  - Note: this index is NOT used by critical (matched on attrName), by major/reaction/dodge
         *    (different boolean/Number handling), or by the early-detection move_half loop.
         */
        _indexAppliedEffects(appliedEffects) {
            const byKey = {};
            // The action/defense-time roll keys come from the single definition in DX3rdFormulaEvaluator.ROLL_TIME_KEYS.
            const isRollTimeKey = (key) => window.DX3rdFormulaEvaluator.isRollTimeKey(key);
            for (const eff of Object.values(appliedEffects || {})) {
                if (!eff || !eff.attributes) continue;
                if (eff._disabled) continue; // a disabled applied effect is excluded from the arithmetic

                for (const [attrName, attrValue] of Object.entries(eff.attributes)) {
                    const isObj = (typeof attrValue === 'object' && attrValue !== null);
                    // A row carrying `condition` contributes only while it holds on this actor
                    // ("while [Berserk]", "while carrying a bad status" — see DX3rdRuntimeUtils).
                    if (isObj && attrValue.condition
                        && !window.DX3rdRuntimeUtils?.modifierConditionHolds?.(this, attrValue.condition)) continue;
                    const key = isObj ? attrValue.key : attrName;
                    const label = isObj ? attrValue.label : null;
                    const raw = (isObj && 'value' in attrValue) ? attrValue.value : attrValue;
                    const val = (typeof raw === 'boolean') ? 0
                              : (isRollTimeKey(key) && window.DX3rdFormulaEvaluator.hasDice(String(raw ?? '')))
                                ? raw
                                : window.DX3rdFormulaEvaluator.evaluate(raw);
                    (byKey[key] = byKey[key] || []).push({ label, val });
                }
            }
            return byKey;
        }

        /**
         * A single consumption path: a reader merging the active-item contributions (evaluated live)
         * with the applied ones (already normalized to numbers). prepareData, casting and the enemy
         * path all share it.
         *  - Active-item formulas are evaluated lazily, at consumption time, so they still see the
         *    finalized stats — the original timing is preserved.
         *  - Evaluator arguments follow the documented signature evaluate(formula, item, actor), fixing
         *    the swapped-argument quirk of the old hp/init loops. NaN is absorbed to 0.
         */
        _makeContribReader(activeItems, appliedByKey) {
            const actor = this;
            const ev = (v, item) => Number(window.DX3rdFormulaEvaluator.evaluate(v, item, actor)) || 0;
            // Performance: index the active items' attributes by key once ({ [key]: [{a,item}] }).
            //   Previously every reader call (sum/byLabel/… dozens of them) rescanned all activeItems × attrs.
            //   Evaluating a.value is still deferred to consumption time, so timing and results are unchanged.
            const activeByKey = {};
            const effectAdapter = window.DX3rdItemEffectAdapter;
            for (const item of activeItems) {
                const map = item.system?.attributes;
                if (!map) continue;
                for (const a of Object.values(map)) {
                    if (!a || a.key == null) continue; // an attribute with no key matches no reader key (unchanged behavior)
                    // A row whose own trigger action is authored as "on use" or "on attack" does not apply
                    // while the state is on — it is attached as a frozen AE at that moment instead, and
                    // arrives through appliedByKey. Counting it here too would apply the same bonus twice.
                    if (effectAdapter && !effectAdapter.appliesWhileActive(item, a)) continue;
                    // A row carrying `condition` contributes only while it holds on this actor.
                    if (a.condition && !window.DX3rdRuntimeUtils?.modifierConditionHolds?.(actor, a.condition)) continue;
                    (activeByKey[a.key] = activeByKey[a.key] || []).push({ a, item });
                }
            }
            const eachOfKey = (key, fn) => {
                const list = activeByKey[key];
                if (!list) return;
                for (const { a, item } of list) fn(a, item);
            };
            return {
                // Plain sum, ignoring labels
                sum(key) {
                    let s = 0;
                    eachOfKey(key, (a, item) => { if (a.value) s += ev(a.value, item); });
                    for (const { val } of (appliedByKey[key] || [])) s += Number(val) || 0;
                    return s;
                },
                // Preserve, per label, the dice formulas that can only be settled at action time.
                // Fixed numbers stay in sum/bucket; only the dice formulas go on to the real roll.
                actionDiceFormula(key, labels = []) {
                    const F = window.DX3rdFormulaEvaluator;
                    const out = { _: [] };
                    for (const label of labels) out[label] = [];
                    const push = (label, v, item) => {
                        if (v === null || v === undefined || v === '' || v === '-') return;
                        const resolved = F.prepareRollFormula(String(v), item, actor);
                        if (!F.hasDice(resolved)) return;
                        const bucket = labels.includes(label) ? label : '_';
                        out[bucket].push(`(${resolved})`);
                    };
                    eachOfKey(key, (a, item) => push(a.label || '-', a.value, item));
                    for (const { label, val } of (appliedByKey[key] || [])) push(label || '-', val, null);
                    return Object.fromEntries(Object.entries(out).map(([label, terms]) => [label, terms.join(' + ')]));
                },
                // stat_* can be absorbed to 0 during numeric derivation, so the action-time dice
                // formulas are preserved separately, filtered by the label condition.
                actionDiceFormulaWhere(key, matches) {
                    const F = window.DX3rdFormulaEvaluator;
                    const terms = [];
                    const push = (label, v, item) => {
                        if (!matches(label) || v === null || v === undefined || v === '' || v === '-') return;
                        const resolved = F.prepareRollFormula(String(v), item, actor);
                        if (F.hasDice(resolved)) terms.push(`(${resolved})`);
                    };
                    eachOfKey(key, (a, item) => push(a.label || '-', a.value, item));
                    for (const { label, val } of (appliedByKey[key] || [])) push(label || '-', val, null);
                    return terms.join(' + ');
                },
                // Sum on an exact label match (stat_bonus for attributes and skills, stat_dice/stat_add for attributes)
                byLabel(key, want) {
                    let s = 0;
                    eachOfKey(key, (a, item) => { if (a.label === want && a.value) s += ev(a.value, item); });
                    for (const { label, val } of (appliedByKey[key] || [])) if (label === want) s += Number(val) || 0;
                    return s;
                },
                // Sum on a skill match — a direct label or a skill group (skill stat_dice/stat_add)
                bySkill(key, skillKey) {
                    const match = (label) => label === skillKey || window.DX3rdSkillGroupMatcher?.isSkillInGroup(skillKey, label);
                    let s = 0;
                    eachOfKey(key, (a, item) => { if (a.value && match(a.label)) s += ev(a.value, item); });
                    for (const { label, val } of (appliedByKey[key] || [])) if (match(label)) s += Number(val) || 0;
                    return s;
                },
                // Minimum (critical_min): the smallest value, starting from seed
                min(key, seed) {
                    let m = seed;
                    eachOfKey(key, (a, item) => { if (a.value) { const v = ev(a.value, item); if (v < m) m = v; } });
                    for (const { val } of (appliedByKey[key] || [])) { const v = Number(val) || 0; if (v < m) m = v; }
                    return m;
                },
                // Label buckets (attack: melee/ranged/fist). Anything else, '-', or unlabeled → '_'
                bucket(key, labels) {
                    const out = { _: 0 };
                    for (const l of labels) out[l] = 0;
                    const add = (label, v) => { if (labels.includes(label)) out[label] += v; else out._ += v; };
                    eachOfKey(key, (a, item) => { if (a.value) add(a.label || '-', ev(a.value, item)); });
                    for (const { label, val } of (appliedByKey[key] || [])) add(label || '-', Number(val) || 0);
                    return out;
                },
                // Multi-key single pass: the nine major/reaction/dodge dice/critical/add sums
                mrd() {
                    const KS = ['major_dice', 'major_critical', 'major_add', 'reaction_dice', 'reaction_critical', 'reaction_add', 'dodge_dice', 'dodge_critical', 'dodge_add'];
                    const out = {};
                    for (const k of KS) {
                        out[k] = 0;
                        eachOfKey(k, (a, item) => { if (a.value) out[k] += ev(a.value, item); });
                        for (const { val } of (appliedByKey[k] || [])) out[k] += Number(val) || 0;
                    }
                    return out;
                },
            };
        }

        _prepareActorEnc() {
            let enc = this.system.attributes.encroachment;
            let encType = enc.type || "-";  // "-" when no type is set
            enc.dice = 0;
            enc.level = 0;

            let encList = {
                "-": {
                    dice: [60, 80, 100, 130, 160, 200, 240, 300],
                    level: [100, 160],
                },
                ea: {
                    dice: [60, 80, 100, 130, 190, 260, 300],
                    level: [100, 160, 220],
                },
                origin: {
                    dice: [],
                    level: [80, 100, 150],
                },
            };

            // Fall back to "-" when encType is not a known key
            if (!encList[encType]) {
                encType = "-";
            }

            // dice steps
            for (let threshold of encList[encType].dice) {
                if (enc.value < threshold) break;
                enc.dice += 1;
            }

            // level steps
            for (let threshold of encList[encType].level) {
                if (enc.value < threshold) break;
                enc.level += 1;
            }
        }

        /**
         * Casting-related derived values
         * - cast.dice = round((mind.total + skills.will.total) / 2) + sum(cast_dice from active/applied)
         * - cast.add = sum(cast_add from active/applied)
         * - cast.eibon = round(skills.cthulhu.total / 4)
         */
        _prepareCastingStats(appliedByKey = null) {
            const attrs = this.system.attributes;
            // Effect-like types are excluded from the self-computation (they sum via appliedByKey), which is what prevents cast_dice/cast_add double counting.
            const activeItems = (this.items || []).filter(i =>
                i.system?.active?.state &&
                !['effect', 'spell', 'psionic', 'combo'].includes(i.type));
            // Performance: reuse the index the caller (_prepareActorAttributes) already built; only collect when absent.
            if (!appliedByKey) {
                const appliedEffects = window.DX3rdAppliedEffects?.collect
                    ? window.DX3rdAppliedEffects.collect(this)
                    : (this.system.attributes?.applied || {});
                appliedByKey = this._indexAppliedEffects(appliedEffects);
            }

            // base dice from ability/skill totals
            const mindTotal = attrs.mind?.total || 0;
            const willTotal = attrs.skills?.will?.total || 0;
            let castDice = Math.round((mindTotal + willTotal) / 2);
            let castAdd = 0;

            // cast_dice / cast_add from active items and applied effects, merged through the index (object and primitive forms alike)
            const R = this._makeContribReader(activeItems, appliedByKey);
            castDice += R.sum('cast_dice');
            castAdd += R.sum('cast_add');

            // eibon = round(cthulhu / 4)
            const cthulhuTotal = attrs.skills?.cthulhu?.total || 0;
            const eibon = Math.round(cthulhuTotal / 4);

            attrs.cast = attrs.cast || { dice: 0, add: 0, eibon: 0 };
            attrs.cast.dice = castDice;
            // Floor: cast.dice is never below 1
            if (attrs.cast.dice < 1) attrs.cast.dice = 1;
            attrs.cast.add = castAdd;
            attrs.cast.rollFormula = {
                dice: R.actionDiceFormula('cast_dice')._,
                add: R.actionDiceFormula('cast_add')._
            };
            attrs.cast.eibon = eibon;
            // Floor: cast.eibon is never below 0
            if (attrs.cast.eibon < 0) attrs.cast.eibon = 0;
        }

        /**
         * The simplified attribute derivation for enemies.
         * Only HP, initiative, movement and the combat-related attributes are computed.
         */
        _prepareEnemyAttributes() {
            const system = this.system;
            const attrs = system.attributes;
            const defaultCritical = game.settings.get("dx3rd-emanim", "defaultCritical") || 10;

            // Effect-like types (combo/effect) are excluded from the self-computation — toggling them
            // writes an appliedKey AE (DX3rdAppliedToggle) summed via appliedByKey. Enemies share that path (they are sync targets), preventing double counting.
            const activeItems = this.items.filter(item =>
                item.system?.active?.state === true &&
                !['combo', 'effect', 'spell', 'psionic'].includes(item.type)
            );
            const appliedEffects = window.DX3rdAppliedEffects?.collect
                ? window.DX3rdAppliedEffects.collect(this)
                : (attrs.applied || {});
            // Performance: index the applied effects once (same as the character path)
            const appliedByKey = this._indexAppliedEffects(appliedEffects);
            // A single reader over both the active-item and the applied contributions (lazily evaluated)
            const R = this._makeContribReader(activeItems, appliedByKey);

            // === Critical floor (computed before the attribute criticals) ===
            // Same as the character path: with no declared floor, the rules' base floor of 2 applies.
            // Seeding from the previous value (attrs.critical.min) would let a derived value feed itself,
            // so a floor that once dropped could never come back up — it is derived only from declarations.
            const declaredCriticalMin = R.min('critical_min', Infinity);
            const criticalMin = Number.isFinite(declaredCriticalMin) ? declaredCriticalMin : 2;
            if (!attrs.critical) attrs.critical = {};
            attrs.critical.min = Math.max(2, criticalMin);

            // === Attribute totals (including bonus, dice and add) ===
            for (const key of ["body", "sense", "mind", "social"]) {
                const stat = attrs[key];
                
                // stat_bonus from active items and applied effects, matched by attribute label
                stat.bonus = R.byLabel('stat_bonus', key);
                stat.total = (stat.point || 0) + (stat.extra || 0) + stat.bonus;
                if (stat.total < 0) stat.total = 0;

                // From active items and applied effects: dice (unlabeled) + stat_dice matching this attribute
                const diceBonus = R.sum('dice');
                const statDiceBonus = R.byLabel('stat_dice', key);

                stat.dice = stat.total + diceBonus + statDiceBonus;
                if (stat.dice < 1) stat.dice = 1;
                
                // From active items and applied effects: add (unlabeled) + stat_add matching this attribute
                const addBonus = R.sum('add');
                const statAddBonus = R.byLabel('stat_add', key);

                stat.add = addBonus + statAddBonus;
                
                // Critical modifier (the enemy's simple critical)
                const abilityCriticalMod = R.sum('critical');
                const calculatedCritical = defaultCritical + abilityCriticalMod;
                stat.critical = Math.max(attrs.critical?.min || defaultCritical, calculatedCritical);
                
                // Major/reaction/dodge dice, additions and criticals for enemy checks — the nine keys in one pass
                const M = R.mrd();
                const majorDiceBonus = M.major_dice;
                const majorAddBonus = M.major_add;
                const majorCriticalMod = M.major_critical;
                const reactionDiceBonus = M.reaction_dice;
                const reactionAddBonus = M.reaction_add;
                const reactionCriticalMod = M.reaction_critical;
                const dodgeDiceBonus = M.dodge_dice;
                const dodgeAddBonus = M.dodge_add;
                const dodgeCriticalMod = M.dodge_critical;
                stat.major = {
                    dice: stat.dice + majorDiceBonus,
                    add: stat.add + majorAddBonus,
                    critical: Math.max(attrs.critical?.min || defaultCritical, stat.critical + majorCriticalMod)
                };
                stat.reaction = {
                    dice: stat.dice + reactionDiceBonus,
                    add: stat.add + reactionAddBonus,
                    critical: Math.max(attrs.critical?.min || defaultCritical, stat.critical + reactionCriticalMod)
                };
                stat.dodge = {
                    dice: stat.dice + reactionDiceBonus + dodgeDiceBonus,
                    add: stat.add + reactionAddBonus + dodgeAddBonus,
                    critical: Math.max(attrs.critical?.min || defaultCritical, stat.critical + reactionCriticalMod + dodgeCriticalMod)
                };
                stat.rollFormula = {
                    dice: [
                        R.actionDiceFormulaWhere('stat_bonus', label => label === key),
                        R.actionDiceFormulaWhere('stat_dice', label => label === key)
                    ].filter(Boolean).join(' + '),
                    add: R.actionDiceFormulaWhere('stat_add', label => label === key)
                };
            }
            // hp / hp_max bonus from active items and applied effects
            const hpBonus = R.sum('hp') + R.sum('hp_max');
            
            // Migration: with no hp.base, adopt the existing max as the base
            if (attrs.hp.base === undefined || attrs.hp.base === null) {
                attrs.hp.base = attrs.hp.max || 0;
            }
            
            attrs.hp.max = (attrs.hp.base || 0) + hpBonus;
            if (attrs.hp.max < 0) attrs.hp.max = 0;
            if (attrs.hp.value > attrs.hp.max) attrs.hp.value = attrs.hp.max;
            if (attrs.hp.value < 0) attrs.hp.value = 0;

            // === Initiative (base + modifiers) ===
            // init / initiative bonus from active items and applied effects
            const initBonus = R.sum('init') + R.sum('initiative');
            
            // Migration: with no init.base, adopt the previously computed value as the base
            if (attrs.init.base === undefined || attrs.init.base === null) {
                const calculatedInit = (attrs.sense?.total || 0) * 2 + (attrs.mind?.total || 0);
                attrs.init.base = calculatedInit;
            }
            
            attrs.init.value = (attrs.init.base || 0) + initBonus;
            
            // Berserk condition
            if (system.conditions?.berserk?.active) {
                if (system.conditions.berserk.type === 'release') {
                    attrs.init.value -= 9999;
                } else if (system.conditions.berserk.type === 'delusion') {
                    attrs.init.value -= 10;
                }
            }
            
            if (attrs.init.value < 0) attrs.init.value = 0;

            // === Movement (base + modifiers) ===
            // move bonuses from active items and applied effects (battle: move/move_battle/battleMove, full: move_full/fullMove)
            const moveBattleBonus = R.sum('move') + R.sum('move_battle') + R.sum('battleMove');
            const moveFullBonus = R.sum('move_full') + R.sum('fullMove');
            
            // Migration: with no move.base, adopt the previously computed value as the base
            if (attrs.move.base === undefined || attrs.move.base === null) {
                const simplifiedDistance = game.settings.get('dx3rd-emanim', 'simplifiedDistance');
                let calculatedBattleMove;
                if (!simplifiedDistance) {
                    calculatedBattleMove = attrs.init.value + 5;
                } else {
                    calculatedBattleMove = Math.floor(attrs.init.value / 2) + 2;
                }
                attrs.move.base = calculatedBattleMove;
            }
            
            attrs.move.battle = (attrs.move.base || 0) + moveBattleBonus;
            
            // Rigor condition
            if (system.conditions?.rigor?.active) {
                attrs.move.battle -= 9999;
            }
            
            if (attrs.move.battle < 0) attrs.move.battle = 0;
            
            // Full movement: twice the battle-movement total, plus modifiers
            attrs.move.full = attrs.move.battle * 2 + moveFullBonus;
            if (attrs.move.full < 0) attrs.move.full = 0;

            // === Attack === (label buckets)
            const atk = R.bucket('attack', ['melee', 'ranged', 'fist']);   // fist = fist-only (Degeneration Organ etc.)
            const atkDiceFormula = R.actionDiceFormula('attack', ['melee', 'ranged', 'fist']);

            if (!attrs.attack) attrs.attack = { value: 0, melee: 0, ranged: 0, fist: 0 };
            attrs.attack.value = atk._;
            attrs.attack.melee = atk.melee;
            attrs.attack.ranged = atk.ranged;
            attrs.attack.fist = atk.fist;
            attrs.attack.rollFormula = atkDiceFormula;

            // === Armor, Guard, Penetrate, Reduce === (one path over active items + applied)
            const armorBonus = R.sum('armor');
            // Guard uses the same label buckets as attack (a fist-only guard value, say). The defense
            // dialog adds the bucket share once the weapon is known, so only the catch-all `_` lands here.
            const grd = R.bucket('guard', ['melee', 'ranged', 'fist']);
            const grdDiceFormula = R.actionDiceFormula('guard', ['melee', 'ranged', 'fist']);
            const guardBonus = grd._;
            const penetrateBonus = R.sum('penetrate');
            const reduceBonus = R.sum('reduce');

            // Migration: with no armor.base, adopt the existing value as the base
            if (attrs.armor.base === undefined || attrs.armor.base === null) {
                attrs.armor.base = attrs.armor.value || 0;
            }
            attrs.armor.value = Math.max(0, (attrs.armor.base || 0) + armorBonus);
            // A dice formula written into the value field is preserved, not rolled → the defense dialog rolls it once on confirmation.
            attrs.armor.valueFormula = R.actionDiceFormula('armor')._;
            attrs.guard.value = Math.max(0, guardBonus);
            attrs.guard.base = attrs.guard.value;
            attrs.guard.melee = grd.melee;
            attrs.guard.ranged = grd.ranged;
            attrs.guard.fist = grd.fist;
            attrs.guard.rollFormula = grdDiceFormula;
            attrs.guard.valueFormula = grdDiceFormula._;
            attrs.actionRollFormula = { dice: R.actionDiceFormula('dice')._, add: R.actionDiceFormula('add')._, critical: R.actionDiceFormula('critical')._, major: { dice: R.actionDiceFormula('major_dice')._, add: R.actionDiceFormula('major_add')._, critical: R.actionDiceFormula('major_critical')._ }, reaction: { dice: R.actionDiceFormula('reaction_dice')._, add: R.actionDiceFormula('reaction_add')._, critical: R.actionDiceFormula('reaction_critical')._ }, dodge: { dice: R.actionDiceFormula('dodge_dice')._, add: R.actionDiceFormula('dodge_add')._, critical: R.actionDiceFormula('dodge_critical')._ } };
            attrs.penetrate.value = Math.max(0, penetrateBonus);
            attrs.penetrate.rollFormula = R.actionDiceFormula('penetrate')._;   // rolled at accuracy time
            attrs.reduce.value = Math.max(0, reduceBonus);
            attrs.reduce.valueFormula = R.actionDiceFormula('reduce')._;

            // === Evasion (base + modifiers) ===
            // Dodge achievement modifier (dodge_add or dodge_achievement) — one path over active items + applied
            const dodgeAchievementBonus = R.sum('dodge_add') + R.sum('dodge_achievement');

            // Dodge dice modifier (dodge_dice × 2)
            const dodgeDiceBonus = R.sum('dodge_dice') * 2;
            
            // Initialize evasion when absent
            if (!attrs.evasion) {
                attrs.evasion = {};
            }
            
            // Migration: with no evasion.base, adopt the existing value as the base
            if (attrs.evasion.base === undefined || attrs.evasion.base === null) {
                attrs.evasion.base = attrs.evasion.value || 0;
            }
            
            // Default evasion.disabled to false
            if (attrs.evasion.disabled === undefined) {
                attrs.evasion.disabled = false;
            }
            
            // Compute only while it is not disabled
            if (!attrs.evasion.disabled) {
                attrs.evasion.value = (attrs.evasion.base || 0) + dodgeAchievementBonus + dodgeDiceBonus;
                if (attrs.evasion.value < 0) attrs.evasion.value = 0;
            }

            // Remaining structural defaults
            system.conditions = system.conditions || {};
        }

        /**
         * The "no encroachment" guard.
         * An actor whose encroachment type (system.attributes.encroachment.type) is 'none' never rises.
         * Every path that raises encroachment — effect use, will/fear checks, resurrect side effects,
         * spells — ultimately goes through actor.update({'system.attributes.encroachment.value': …}),
         * so it is blocked here in one place. Decreases (backtrack, manual edits) and no-ops pass.
         * By the rules 'none' is treated like core (-) for arithmetic; only the rise is blocked.
         */
        async _preUpdate(changed, options, user) {
            try {
                // Judge against the type this update sets, or the current one when it sets none.
                const nextType = changed?.system?.attributes?.encroachment?.type
                    ?? this.system?.attributes?.encroachment?.type;
                if (nextType === 'none') {
                    const encChange = changed?.system?.attributes?.encroachment;
                    if (encChange && encChange.value !== undefined && encChange.value !== null) {
                        const before = Number(this.system?.attributes?.encroachment?.value ?? 0);
                        const after = Number(encChange.value);
                        // Block the rise only: drop the value key from the changeset so the old value stays.
                        if (Number.isFinite(after) && after > before) {
                            delete encChange.value;
                        }
                    }
                }
            } catch (e) {
                console.error('DX3rd | 침식률(없음) 가드 실패:', e);
            }
            return super._preUpdate(changed, options, user);
        }

        // Fix up _stats.coreVersion so JSON exported from a world on a different core version still imports.
        importFromJSON(json) {
            return super.importFromJSON(window.DX3rdImportCompat?.sanitizeImportJSON(json) ?? json);
        }
    }

    // Register the custom Actor class with Foundry
    CONFIG.Actor.documentClass = DX3rdActor;
    CONFIG.Actor.typeLabels = {
        character: "DX3rd.Character",
        enemy: "DX3rd.Enemy"
    };
    window.DX3rdItemEncroachInit = { sum: sumItemEncroachInit };
    window.DX3rdSaving = { itemCost: sumItemSavingCost, remain: calculateSavingRemain };
    window.DX3rdStock = { derive: deriveStock };
})();
