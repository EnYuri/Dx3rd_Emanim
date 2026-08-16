// Handlebars helpers
(function() {
    const fixedOrder = {
        body: ["melee", "evade"],
        sense: ["ranged", "perception"],
        mind: ["rc", "will", "cthulhu"],
        social: ["negotiation", "procure"]
    };

    // Formula evaluator (safe arithmetic)
    window.DX3rdFormulaEvaluator = {
        /**
         * Record a formula input's validation state on the input element itself.
         * A notification disappears quickly and does not say which field was wrong, so the error
         * stays reachable on hover/focus.
         */
        setInputValidationState: function(input, validation) {
            if (!input) return;
            const message = validation?.valid === false ? validation.message : '';
            input.classList.toggle('dx3rd-formula-invalid', Boolean(message));
            if (message) input.setAttribute('aria-invalid', 'true');
            else input.removeAttribute('aria-invalid');
            // setCustomValidity is avoided: it would block the AppV2 form submit outright.
            input.title = message;
            if (message) input.dataset.tooltip = message;
            else delete input.dataset.tooltip;
        },

        getValidationMessage: function(key, data = {}) {
            return game.i18n.format(key, data);
        },
        /**
         * Save-time validation. A dice formula is a legitimate part of Foundry's Roll syntax, so
         * it is neither converted nor rejected here. The actual roll happens only on the action
         * path that calls evaluateRoll().
         *
         * Fields with no roll moment (HP, initiative — derived values permanently shown on the
         * sheet) do have their dice absorbed to 0 by prepareData. That used to happen with no
         * indication at all, reading as "I definitely typed it and nothing happens". Saving is
         * still allowed — the input is never blocked — the fact is merely recorded on the field.
         * @see ROLL_TIME_KEYS
         */
        validateDeterministicFormula: function(formula, attributeKey = null) {
            if (formula === null || formula === undefined || formula === '') return { valid: true };
            if (attributeKey && attributeKey !== '-' && !this.isRollTimeKey(attributeKey)
                && this.hasDice(String(formula))) {
                const fieldName = window.DX3rdAttributeLocalizer?.localize?.(attributeKey) ?? attributeKey;
                return {
                    valid: false,
                    message: this.getValidationMessage('DX3rd.DiceNotRollableField', { field: fieldName })
                };
            }
            return { valid: true };
        },

        /**
         * Attribute keys "rolled at action time" — their dice formulas are kept as text, not frozen to a number.
         * A key not listed here is a deterministic derived value shown permanently on the sheet
         * (hp/init/movement), so prepareData absorbs its dice to 0 — such a value must not wobble on every actor update.
         *
         * actor.js (_indexAppliedEffects), universal-apply.js and dx3rd-applied-toggle.js each used
         * to keep their own copy, and fixing one made the channels diverge (reduce/guard/armor went missing).
         * Edit this one constant and nothing else.
         */
        ROLL_TIME_KEYS: new Set([
            'attack',
            // Rolled at defense time (in the defense dialog)
            'guard', 'armor', 'reduce',
            // Penetration is the attacker's, so it is rolled at accuracy time and reaches the defense dialog as a number
            'penetrate',
            'dice', 'add', 'critical',
            'major_dice', 'major_add', 'major_critical',
            'reaction_dice', 'reaction_add', 'reaction_critical',
            'dodge_dice', 'dodge_add', 'dodge_critical',
            'stat_bonus', 'stat_dice', 'stat_add', 'cast_dice', 'cast_add'
        ]),

        /** Whether a key is rolled at action time. @see ROLL_TIME_KEYS */
        isRollTimeKey: function(key) {
            return this.ROLL_TIME_KEYS.has(key);
        },

        hasDice: function(formula) {
            return typeof formula === 'string' && /(?:^|[^a-z0-9_])\d*\s*d\s*\d+(?=$|[^a-z0-9_])/i.test(formula);
        },

        /** A Foundry Roll formula with references substituted. prepareData never rolls this. */
        prepareRollFormula: function(formula, item = null, actor = null) {
            if (formula === null || formula === undefined || formula === '') return '0';
            let result = String(formula).trim().replace(/×/g, '*').replace(/÷/g, '/');
            if (item || actor) result = this.replaceReferences(result, item, actor);
            return result || '0';
        },

        /**
         * Asynchronous resolver, for action time.
         * Plain arithmetic returns exactly what evaluate() would; a dice formula is rolled through
         * Foundry's core Roll exactly once. Callers must put the returned roll into the chat message
         * and reuse that result within the same action.
         */
        evaluateRoll: async function(formula, item = null, actor = null) {
            const prepared = this.prepareRollFormula(formula, item, actor);
            if (!this.hasDice(prepared)) {
                return { total: this.evaluate(prepared), roll: null, formula: prepared };
            }
            try {
                const roll = await (new Roll(prepared)).evaluate();
                return { total: Number(roll.total) || 0, roll, formula: prepared };
            } catch (error) {
                console.warn(`DX3rd | Dice formula evaluation error: ${prepared}`, error);
                return { total: 0, roll: null, formula: prepared };
            }
        },

        // Circular-reference validation
        validateCircularReference: function(formula, label, actor = null, attributeType = null) {
            if (!formula || !label) return { valid: true };
            
            // stat_add and stat_dice cannot create a cycle, so skip the check
            if (attributeType === 'stat_add' || attributeType === 'stat_dice') {
                return { valid: true };
            }
            
            const formulaStr = String(formula).trim();
            const labelLower = label.toLowerCase();
            
            // Base attributes
            const abilities = {
                'body': game.i18n.localize('DX3rd.Body'),
                'sense': game.i18n.localize('DX3rd.Sense'),
                'mind': game.i18n.localize('DX3rd.Mind'),
                'social': game.i18n.localize('DX3rd.Social')
            };
            
            // The label names an attribute
            for (const [key, localizedName] of Object.entries(abilities)) {
                if (labelLower === key) {
                    // Look for the [body] pattern, or its localized equivalent
                    const keyPattern = new RegExp(`\\[${key}\\]`, 'i');
                    const namePattern = new RegExp(`\\[${this.escapeRegex(localizedName)}\\]`, 'i');
                    
                    if (keyPattern.test(formulaStr) || namePattern.test(formulaStr)) {
                        return { 
                            valid: false, 
                            message: this.getValidationMessage('DX3rd.FormulaCircularReference', {
                                references: `[${key}] ${game.i18n.localize('DX3rd.Or')} [${localizedName}]`
                            })
                        };
                    }
                }
            }
            
            // The label names a skill (the defaults, plus the actor's custom skills)
            const defaultSkills = {
                'melee': game.i18n.localize('DX3rd.melee'),
                'evade': game.i18n.localize('DX3rd.evade'),
                'ranged': game.i18n.localize('DX3rd.ranged'),
                'perception': game.i18n.localize('DX3rd.perception'),
                'rc': game.i18n.localize('DX3rd.rc'),
                'will': game.i18n.localize('DX3rd.will'),
                'cthulhu': game.i18n.localize('DX3rd.cthulhu'),
                'negotiation': game.i18n.localize('DX3rd.negotiation'),
                'procure': game.i18n.localize('DX3rd.procure')
            };
            
            // Default skills
            for (const [key, localizedName] of Object.entries(defaultSkills)) {
                if (labelLower === key) {
                    const keyPattern = new RegExp(`\\[${this.escapeRegex(key)}\\]`, 'i');
                    const namePattern = new RegExp(`\\[${this.escapeRegex(localizedName)}\\]`, 'i');
                    
                    if (keyPattern.test(formulaStr) || namePattern.test(formulaStr)) {
                        return { 
                            valid: false, 
                            message: this.getValidationMessage('DX3rd.FormulaCircularReference', {
                                references: `[${key}] ${game.i18n.localize('DX3rd.Or')} [${localizedName}]`
                            })
                        };
                    }
                }
            }
            
            // With an actor, check the custom skills too
            if (actor && actor.system?.attributes?.skills) {
                const skills = actor.system.attributes.skills;
                const labelSkill = skills[label] || skills[labelLower];
                
                if (labelSkill) {
                    // Block references by key
                    const keyPattern = new RegExp(`\\[${this.escapeRegex(label)}\\]`, 'i');
                    if (keyPattern.test(formulaStr)) {
                        return { 
                            valid: false, 
                            message: this.getValidationMessage('DX3rd.FormulaCircularReference', {references: `[${label}]`})
                        };
                    }
                    
                    // Block references by name
                    if (labelSkill.name) {
                        let skillName = labelSkill.name;
                        if (skillName.startsWith('DX3rd.')) {
                            skillName = game.i18n.localize(skillName);
                        }
                        const namePattern = new RegExp(`\\[${this.escapeRegex(skillName)}\\]`, 'i');
                        if (namePattern.test(formulaStr)) {
                            return { 
                                valid: false, 
                                message: this.getValidationMessage('DX3rd.FormulaCircularReference', {references: `[${skillName}]`})
                            };
                        }
                    }
                }
            }
            
            return { valid: true };
        },
        
        evaluate: function(formula, item = null, actor = null) {
            if (formula === null || formula === undefined || formula === '') {
                return 0;
            }
            
            // Already a number
            if (typeof formula === 'number') {
                return formula;
            }
            
            // Booleans are flags, not expressions — return 0
            if (typeof formula === 'boolean') {
                return 0;
            }
            
            let formulaStr = String(formula).trim();

            // Empty
            if (formulaStr === '' || formulaStr === '-') {
                return 0;
            }

            // Fast path for a plain numeric string: no [token] references, so replaceReferences is skipped.
            // It returns exactly what the simpleNumber branch below would, so behavior is unchanged (most calls end here).
            const fastNum = Number(formulaStr);
            if (!isNaN(fastNum)) {
                return fastNum;
            }

            // Normalize the multiply/divide signs (for compound expressions like [20-(LV×5)])
            formulaStr = formulaStr.replace(/×/g, '*').replace(/÷/g, '/');

            // Substitute references ([Lv], [level], [body], [melee] and their localized forms)
            if (item || actor) {
                formulaStr = this.replaceReferences(formulaStr, item, actor);
            }
            
            // A plain number
            const simpleNumber = Number(formulaStr);
            if (!isNaN(simpleNumber)) {
                return simpleNumber;
            }
            
            // min/max support, for cap expressions such as min(0, -[20-(LV×5)])
            const evalStr = formulaStr.replace(/\bmin\s*\(/gi, 'Math.min(').replace(/\bmax\s*\(/gi, 'Math.max(');

            // Evaluate, allowing safe characters only. Math.min/Math.max are the sole whitelist (the comma is their argument separator).
            const stripped = evalStr.replace(/Math\.(?:min|max)/g, '');
            if (/[^0-9+\-*/(),.\s]/.test(stripped)) {
                // Dice formulas are handled on the action path, by evaluateRoll() / Foundry Roll.
                // This synchronous evaluator also feeds previews and aggregates, so it returns 0
                // without warning again. The actual roll result is unaffected.
                if (this.hasDice(formulaStr)) return 0;
                // Do not warn on the strings "true"/"false"
                if (formulaStr !== 'true' && formulaStr !== 'false') {
                    console.warn(`DX3rd | Invalid characters in formula: ${formulaStr}`);
                }
                return 0;
            }

            try {
                // Evaluate through the Function constructor
                const result = new Function(`return ${evalStr}`)();
                if (isNaN(result) || !isFinite(result)) {
                    console.warn(`DX3rd | Formula evaluation resulted in invalid number: ${formulaStr}`);
                    return 0;
                }
                return Math.floor(result); // truncate to an integer
            } catch (error) {
                console.warn(`DX3rd | Formula evaluation error: ${formulaStr}`, error);
                return 0;
            }
        },
        
        replaceReferences: function(formulaStr, item, actor) {
            // Normalize the multiply/divide signs (compound expressions work on the direct-call path too)
            let result = String(formulaStr).replace(/×/g, '*').replace(/÷/g, '/');

            // 0) [count:name] — substitute how many identically named items the actor holds.
            //    Runs before the operator flattening in step 2, so a name containing '-' becomes an
            //    integer first and only then joins the arithmetic. e.g. [count:<name>]*2 → 6 when 3 are held.
            if (actor) {
                result = result.replace(/\[(?:count|개수)\s*:\s*([^\[\]]+?)\s*\]/gi, (m, name) => {
                    const target = String(name).trim();
                    const n = (actor.items?.filter(it => (it.name || '').trim() === target).length) || 0;
                    return n;
                });
            }

            // 1) Substitute single bracketed tokens ([Lv], [body], [melee] …) — legacy behavior
            // [Lv] / [level] / the localized form → the item level
            if (item) {
                const itemLevel = this.getItemLevel(item);
                result = result.replace(/\[Lv\]/gi, itemLevel);
                result = result.replace(/\[level\]/gi, itemLevel);
                result = result.replace(/\[레벨\]/g, itemLevel);
            }

            // 1.5) Runtime-input tokens ([소비HP] / [입력] / [입력값] / [input])
            //    The player value handleItemUse parked on actor._dx3rdRuntimeInput at use time.
            //    This is the channel for variable amounts — "as much HP as you spent", "spend as much as you like".
            //    Outside a use (sheet previews and the like) there is no value, so it becomes 0.
            if (actor) {
                const runtimeInput = Number(actor._dx3rdRuntimeInput) || 0;
                result = result.replace(/\[소비HP\]/gi, runtimeInput);
                result = result.replace(/\[입력값?\]/g, runtimeInput);
                result = result.replace(/\[input\]/gi, runtimeInput);
            }

            // Substitute actor attribute/skill references (the bracketed form)
            if (actor) {
                result = this.replaceActorReferences(result, actor);
            }

            // 2) Flatten compound bracketed expressions ([20-(LV×5)], [5-LV], …):
            //    a bracket still holding an operator is an expression, so its inner tokens are
            //    substituted once more (bare) and the outer [] becomes (), letting plain arithmetic evaluate it. Only expression brackets are touched.
            result = result.replace(/\[([^\[\]]*[-+*/()][^\[\]]*)\]/g, (m, inner) => {
                return '(' + this.replaceBareTokens(inner, item, actor) + ')';
            });

            // 3) Substitute the bare tokens left over (Lv / attributes / skills).
            //    This makes lv*10, +(lv*n) and body+2 work as well as [Lv]*10.
            //    By now every bracket has become a number or a parenthesized expression, so what
            //    remains is numbers, operators, and unsubstituted bare tokens. replaceBareTokens
            //    only matches on word boundaries, so already-substituted numbers are left alone.
            result = this.replaceBareTokens(result, item, actor);

            return result;
        },

        // Substitute unbracketed tokens (used inside compound expressions).
        // English keys match on word boundaries; localized names are substituted longest-first, to avoid partial matches.
        replaceBareTokens: function(inner, item, actor) {
            let s = inner;
            // Runtime-input tokens, unbracketed — for use inside compound expressions ([소비HP*2] and the like)
            if (actor) {
                const runtimeInput = Number(actor._dx3rdRuntimeInput) || 0;
                s = s.replace(/소비HP/gi, runtimeInput).replace(/입력값?/g, runtimeInput).replace(/\binput\b/gi, runtimeInput);
            }
            if (item) {
                const lvl = this.getItemLevel(item);
                s = s.replace(/\bLv\b/gi, lvl).replace(/\blevel\b/gi, lvl).replace(/레벨/g, lvl);
            }
            if (actor && actor.system?.attributes) {
                const attrs = actor.system.attributes;
                // Attributes (key plus localized name)
                const abilities = { body: 'DX3rd.Body', sense: 'DX3rd.Sense', mind: 'DX3rd.Mind', social: 'DX3rd.Social' };
                for (const [key, locKey] of Object.entries(abilities)) {
                    const a = attrs[key];
                    const v = a ? (a.total !== undefined ? a.total : (a.point || 0) + (a.bonus || 0) + (a.extra || 0)) : 0;
                    s = s.replace(new RegExp(`\\b${key}\\b`, 'gi'), v);
                    const loc = game.i18n.localize(locKey);
                    if (loc && loc !== locKey) s = s.split(loc).join(v);
                }
                // Skills (longest name first, to avoid partial matches)
                const skills = attrs.skills || {};
                const entries = Object.entries(skills).map(([key, sk]) => {
                    let name = sk?.name || '';
                    if (name.startsWith('DX3rd.')) name = game.i18n.localize(name);
                    const v = sk ? (sk.total !== undefined ? sk.total : (sk.point || 0) + (sk.bonus || 0) + (sk.extra || 0)) : 0;
                    return { key, name, v };
                }).sort((a, b) => (b.name?.length || 0) - (a.name?.length || 0));
                for (const e of entries) {
                    s = s.replace(new RegExp(`\\b${this.escapeRegex(e.key)}\\b`, 'gi'), e.v);
                    if (e.name) s = s.split(e.name).join(e.v);
                }
            }
            return s;
        },
        
        getItemLevel: function(item) {
            if (!item) return 0;
            // Only effect/psionic items have a level
            if (item.type === 'effect' || item.type === 'psionic') {
                if (item.type === 'effect' && window.DX3rdEffectLevel) {
                    return window.DX3rdEffectLevel.value(item, item.actor);
                }
                const lvl = item.system?.level || {};
                // An effect actually owned by an actor computes its encroachment level dynamically.
                // level.value is only written when the sheet's level field is edited (_onLevelChange),
                // so as encroachment moves the cached value falls behind and combos apply a wrong level.
                const actor = item.actor;
                if (item.type === 'effect' && lvl.upgrade && actor) {
                    const init = Number(lvl.init) || 0;
                    // Finding E: during an item use, the pre-cost frozen encroachment level wins.
                    // (handleItemUse parks that snapshot on actor._dx3rdUsageEncLevel, so an effect
                    //  already firing cannot gain a level from its own encroachment cost.)
                    //  Without the flag — that is, outside a use — the live encroachment level is read.
                    const frozen = actor._dx3rdUsageEncLevel;
                    const encLevel = (frozen !== undefined && frozen !== null)
                        ? Number(frozen) || 0
                        : Number(actor.system?.attributes?.encroachment?.level) || 0;
                    return init + encLevel;
                }
                // A temporary item with no actor context, or one without upgrade, uses the stored value (falling back to init)
                return Number(lvl.value ?? lvl.init) || 0;
            }
            return 0;
        },
        
        replaceActorReferences: function(formulaStr, actor) {
            let result = formulaStr;
            const attrs = actor.system?.attributes;
            if (!attrs) {
                // This can happen transiently during prepareData, so it warns about nothing
                return result;
            }
            
            // Substitute attribute references (both the key and the localized name)
            // total is used when already computed; otherwise only the base components are summed (no cycle)
            const abilities = {
                'body': { key: 'body', localized: game.i18n.localize('DX3rd.Body') },
                'sense': { key: 'sense', localized: game.i18n.localize('DX3rd.Sense') },
                'mind': { key: 'mind', localized: game.i18n.localize('DX3rd.Mind') },
                'social': { key: 'social', localized: game.i18n.localize('DX3rd.Social') }
            };
            
            for (const [key, info] of Object.entries(abilities)) {
                const abilityData = attrs[key];
                let value = 0;
                if (abilityData) {
                    // Use total when it has already been computed
                    if (abilityData.total !== undefined) {
                        value = abilityData.total;
                    } else {
                        // Otherwise compute it now from point + bonus + extra alone, to avoid a cycle
                        value = (abilityData.point || 0) + (abilityData.bonus || 0) + (abilityData.extra || 0);
                    }
                }
                
                // By key (case-insensitive; the brackets are escaped)
                const keyPattern = `\\[${this.escapeRegex(key)}\\]`;
                const keyRegex = new RegExp(keyPattern, 'gi');
                result = result.replace(keyRegex, value);
                
                // By localized name
                const localizedPattern = `\\[${this.escapeRegex(info.localized)}\\]`;
                const localizedRegex = new RegExp(localizedPattern, 'g');
                result = result.replace(localizedRegex, value);
            }
            
            // Substitute skill references (by key and by name)
            const skills = attrs.skills || {};
            
            for (const [key, skill] of Object.entries(skills)) {
                // Use total (cycles are blocked by the validation function)
                let value = 0;
                if (skill) {
                    // Use total when computed — 0 is still a computed value
                    if (skill.total !== undefined) {
                        value = skill.total;
                    } else {
                        // Not computed yet: sum point + bonus + extra + works now
                        value = (skill.point || 0) + (skill.bonus || 0) + (skill.extra || 0);
                        
                        // Add the works bonus
                        const worksItems = actor.items?.filter(item => item.type === 'works') || [];
                        for (const worksItem of worksItems) {
                            if (worksItem.system?.skills?.[key]?.apply && worksItem.system.skills[key].add) {
                                value += Number(worksItem.system.skills[key].add) || 0;
                            }
                        }
                    }
                }
                
                // By key (case-insensitive; the brackets are escaped)
                const keyPattern = `\\[${this.escapeRegex(key)}\\]`;
                const keyRegex = new RegExp(keyPattern, 'gi');
                result = result.replace(keyRegex, value);
                
                // By name
                if (skill && skill.name) {
                    let skillName = skill.name;
                    // Localize when it starts with DX3rd.
                    if (skillName.startsWith('DX3rd.')) {
                        skillName = game.i18n.localize(skillName);
                    }
                    
                    // By name, exact match only (the brackets are escaped)
                    const namePattern = `\\[${this.escapeRegex(skillName)}\\]`;
                    const nameRegex = new RegExp(namePattern, 'g');
                    result = result.replace(nameRegex, value);
                }
            }
            
            return result;
        },
        
        escapeRegex: function(str) {
            return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        }
    };

    // evalFormula helper — evaluate a formula and return its value
    Handlebars.registerHelper('evalFormula', function(formula, item, actor) {
        if (!formula) return 0;
        return window.DX3rdFormulaEvaluator.evaluate(formula, item, actor);
    });

    // skill helper — resolve a skill's display name (only DX3rd.* keys are localized)
    Handlebars.registerHelper('skill', function(skillName) {
        if (!skillName) return '-';
        
        // A localization key
        if (typeof skillName === 'string' && skillName.startsWith('DX3rd.')) {
            // Extract the skill key, e.g. "DX3rd.rc" -> "rc"
            const skillKey = skillName.replace('DX3rd.', '');
            
            // Look for a custom name in the customSkills setting
            const customSkills = game.settings.get("dx3rd-emanim", "customSkills") || {};
            
            // A custom name wins
            if (customSkills[skillKey]) {
                // Both the object and the string shape are supported
                return typeof customSkills[skillKey] === 'object' 
                    ? customSkills[skillKey].name 
                    : customSkills[skillKey];
            }
            
            // No custom name: fall back to plain localization
        return game.i18n.localize(skillName);
        }
        
        // Already a custom name — return it as-is
        return skillName;
    });

    // Skill sorting helper
    Handlebars.registerHelper('sortSkills', function(skills, abilityId) {
        if (!skills) return [];
        const orderArr = fixedOrder[abilityId] || [];
        // 1. Skills in the fixed order
        const fixed = orderArr
            .map(key => [key, skills[key]])
            .filter(([_, skill]) => skill && skill.base === abilityId);
        // 2. The rest (added skills) — right below the defaults, sorted by LV (total) descending
        const rest = Object.entries(skills)
            .filter(([key, skill]) => skill.base === abilityId && !orderArr.includes(key))
            .sort((a, b) => {
                const lvA = Number(a[1].total) || 0;
                const lvB = Number(b[1].total) || 0;
                if (lvB !== lvA) return lvB - lvA; // higher LV first
                // Same LV: stable sort by the existing order, then by name
                if (a[1].order !== undefined && b[1].order !== undefined) {
                    return a[1].order - b[1].order;
                }
                return (a[1].name || '').localeCompare(b[1].name || '');
            });
        return [...fixed, ...rest];
    });

    // min(a, b)
    Handlebars.registerHelper('min', function(a, b) {
        return Math.min(Number(a), Number(b));
    });
    // max(a, b)
    Handlebars.registerHelper('max', function(a, b) {
        return Math.max(Number(a), Number(b));
    });
    // subtract(a, b)
    Handlebars.registerHelper('subtract', function(a, b) {
        return Number(a) - Number(b);
    });

    // timing helper — localize a timing value
    Handlebars.registerHelper('timing', function(arg) {
        if (!arg || arg === '-') return '-';
        return game.i18n.localize(`DX3rd.${arg.charAt(0).toUpperCase() + arg.slice(1)}`);
    });

    // skillByKey helper — resolve a skill name from the actor's skill key
    Handlebars.registerHelper('skillByKey', function(actor, key) {
        if (!actor || !key || key === '-') return '-';
        const skill = actor.system?.attributes?.skills?.[key];
        if (!skill) {
            // No such skill: try the base attributes
            const attributes = ['body', 'sense', 'mind', 'social'];
            if (attributes.includes(key)) {
                return game.i18n.localize(`DX3rd.${key.charAt(0).toUpperCase() + key.slice(1)}`);
            }
            // Syndrome
            if (key === 'syndrome') {
                return game.i18n.localize('DX3rd.Syndrome');
            }
            return key;
        }
        // Localize when the skill name starts with DX3rd.
        if (skill.name && skill.name.startsWith('DX3rd.')) {
            return game.i18n.localize(skill.name);
        }
        return skill.name || key;
    });

    // system.skill stays the representative skill for the existing roll/combination paths. This
    // helper is for displaying the multiple allowed skills the source text names ("melee/ranged").
    Handlebars.registerHelper('skillChoicesByKey', function(actor, keys) {
        const values = Array.isArray(keys) ? keys : [];
        if (!values.length) return '-';
        return values.map(key => Handlebars.helpers.skillByKey(actor, key)).join(' / ');
    });

    // ========== Attribute management utilities ========== //
    /**
     * Skill-group matcher
     */
    window.DX3rdSkillGroupMatcher = {
        /**
         * Whether a skill belongs to a given group
         * @param {string} skillKey - the skill key
         * @param {string} groupLabel - the group label (drive, ars, know, info)
         * @returns {boolean}
         */
        isSkillInGroup(skillKey, groupLabel) {
            if (!skillKey || !groupLabel) return false;
            
            const skillKeyLower = skillKey.toLowerCase();
            const groupLabelLower = groupLabel.toLowerCase();
            
            switch(groupLabelLower) {
                case 'drive':
                    return skillKeyLower.startsWith('drive');
                    
                case 'ars':
                    return skillKeyLower.startsWith('ars');
                    
                case 'know':
                    // Starts with know, or is the cthulhu skill
                    return skillKeyLower.startsWith('know') || skillKeyLower === 'cthulhu';
                    
                case 'info':
                    return skillKeyLower.startsWith('info');
                    
                default:
                    return false;
            }
        }
    };

    window.DX3rdAttributeManager = {
        /**
         * Create an attribute row
         * @param {Object} item - the item
         * @param {string} position - 'main' (system.attributes) or 'sub' (system.effect.attributes)
         * @returns {Promise} the update result
         */
        async createAttribute(item, position = 'main', action = '') {
            const attributeKey = foundry.utils.randomID();
            const updatePath = position === 'main'
                ? `system.attributes.${attributeKey}`
                : `system.effect.attributes.${attributeKey}`;

            // action: '' means the channel's default bucket (inheriting its trigger action). A value
            // puts the row in that action's explicit bucket — the card currently open in the extend tool decides (see item-effect-adapter).
            const newAttribute = {
                key: '-',
                label: '-',
                value: '',
                action: window.DX3rdItemEffectAdapter?.ACTIONS?.has(action) ? action : ''
            };

            return await item.update({
                [updatePath]: newAttribute
            });
        },

        /**
         * Delete an attribute row
         * @param {Object} item - the item
         * @param {string} attributeKey - the attribute key to remove
         * @param {string} position - 'main' or 'sub'
         * @returns {Promise} the update result
         */
        async deleteAttribute(item, attributeKey, position = 'main') {
            const parentPath = position === 'main'
                ? 'system.attributes'
                : 'system.effect.attributes';
            const ForcedDeletion = foundry.data?.operators?.ForcedDeletion;

            if (ForcedDeletion) {
                return await item.update({
                    [parentPath]: {[attributeKey]: new ForcedDeletion()}
                });
            }

            return await item.update({
                [`${parentPath}.-=${attributeKey}`]: null
            });
        },

        /**
         * Update an attribute's label control (swapping between input and select)
         * @param {HTMLElement|jQuery} row - the attribute row element
         * @param {Object} item - the item
         * @param {string} position - 'main' or 'sub'
         */
        async updateAttributeLabel(row, item, position = 'main') {
            const dom = window.DX3rdApplicationCompat;
            const rowElement = dom.unwrapRoot(row);
            const keySelect = dom.query(rowElement, '.attribute-key');
            const labelElement = dom.query(rowElement, '.attribute-label');
            if (!rowElement || !keySelect || !labelElement) return;

            const statKeys = ['stat_bonus', 'stat_add', 'stat_dice'];
            const selectedKey = keySelect.value;
            const nameAttr = labelElement.getAttribute('name');
            const mainMatch = nameAttr?.match(/system\.attributes\.([^.]+)\.label/);
            const effectMatch = nameAttr?.match(/system\.effect\.attributes\.([^.]+)\.label/);
            const attrKey = position === 'main' ? mainMatch?.[1] : effectMatch?.[1];
            const attributes = position === 'main'
                ? item.system.attributes
                : item.system.effect?.attributes;
            const currentValue = (attrKey && attributes?.[attrKey]?.label) || '-';

            const createSelect = () => {
                const select = document.createElement('select');
                select.className = 'attribute-label';
                select.dataset.dtype = 'String';
                if (nameAttr) select.name = nameAttr;
                return select;
            };

            const addOption = (select, value, label) => {
                const option = document.createElement('option');
                option.value = value;
                option.textContent = label;
                select.append(option);
            };

            const bindLabelUpdate = select => {
                select.addEventListener('change', async event => {
                    event.stopPropagation();
                    if (!attrKey) return;
                    const labelUpdatePath = position === 'main'
                        ? `system.attributes.${attrKey}.label`
                        : `system.effect.attributes.${attrKey}.label`;
                    try {
                        await item.update({[labelUpdatePath]: event.currentTarget.value});
                    } catch (error) {
                        console.error("DX3rd | Attribute update failed", error);
                    }
                });
            };

            if (selectedKey === 'attack' || selectedKey === 'guard') {
                // On attack and guard rows alone this field is not an attribute/skill but a **weapon
                // type**. There is only one column header while rows of different keys share the list,
                // so the header cannot convey that — instead the option text itself says it (`-` shows
                // as "all") and a tooltip is attached. The stored value is still `-`/melee/ranged/fist,
                // and actor.js's `R.bucket('<key>', ['melee','ranged','fist'])` splits the buckets by it.
                // The two keys sharing one list is deliberate: splitting them would force a single
                // sentence like "+N to both the attack and the guard of the fist" into two vocabularies.
                if (labelElement.matches('input')) {
                    const select = createSelect();
                    select.title = game.i18n.localize(selectedKey === 'attack'
                        ? 'DX3rd.AttackTypeHint' : 'DX3rd.GuardTypeHint');
                    addOption(select, '-', game.i18n.localize('DX3rd.AttackTypeAll'));
                    addOption(select, 'melee', game.i18n.localize('DX3rd.Melee'));
                    addOption(select, 'ranged', game.i18n.localize('DX3rd.Ranged'));
                    // Fist-only (Degeneration Organ, the prosthetic arm, …). The runtime side
                    // (`attrs.attack.fist`) always existed, but it was absent from this list so there was no way to author it — hence 0 occurrences in the data.
                    addOption(select, 'fist', game.i18n.localize('DX3rd.Fist'));
                    // When the stored value is none of these four (old data where the builder copied
                    // the key name into the label), pin it to the equivalent `-` (all) rather than let
                    // the browser show the first option — otherwise the field looks blank, and one touch changes its meaning.
                    select.value = ['-', 'melee', 'ranged', 'fist'].includes(currentValue) ? currentValue : '-';
                    bindLabelUpdate(select);
                    labelElement.replaceWith(select);
                }
            } else if (statKeys.includes(selectedKey)) {
                // A stat key: turn the field into a dropdown
                if (labelElement.matches('input')) {
                    const select = createSelect();
                    addOption(select, '-', '-');

                    // Skill group per attribute
                    const skillGroupByAttribute = {
                        'body': 'drive',
                        'sense': 'ars',
                        'mind': 'know',
                        'social': 'info'
                    };

                    // Build the options attribute by attribute
                    const attributes = ['body', 'sense', 'mind', 'social'];
                    const skills = item.actor?.system?.attributes?.skills || {};
                    const hasActor = item.actor && Object.keys(skills).length > 0;
                    
                    const defaultSkillsByAttr = {
                        'body': ['melee', 'evade'],
                        'sense': ['ranged', 'perception'],
                        'mind': ['rc', 'will', 'cthulhu'],
                        'social': ['negotiation', 'procure']
                    };
                    
                    const defaultSkillNames = {
                        'melee': 'DX3rd.melee',
                        'evade': 'DX3rd.evade',
                        'ranged': 'DX3rd.ranged',
                        'perception': 'DX3rd.perception',
                        'rc': 'DX3rd.rc',
                        'will': 'DX3rd.will',
                        'cthulhu': 'DX3rd.cthulhu',
                        'negotiation': 'DX3rd.negotiation',
                        'procure': 'DX3rd.procure'
                    };
                    
                    // The customSkills setting (used when there is no actor)
                    const customSkills = game.settings?.get("dx3rd-emanim", "customSkills") || {};

                    attributes.forEach(attr => {
                        // The attribute option itself
                        const localizedAttrName = game.i18n.localize(`DX3rd.${attr.charAt(0).toUpperCase() + attr.slice(1)}`);
                        addOption(select, attr, localizedAttrName);
                        
                        // That attribute's default skills
                        const defaultSkillList = defaultSkillsByAttr[attr] || [];
                        defaultSkillList.forEach(skillKey => {
                            if (hasActor) {
                                // With an actor, use the actor's own skill data
                                const skillData = skills[skillKey];
                                if (skillData && skillData.base === attr) {
                                    const skillName = skillData.name.startsWith('DX3rd.') 
                                        ? game.i18n.localize(skillData.name) 
                                        : skillData.name;
                                    addOption(select, skillKey, skillName);
                                }
                            } else {
                                // Without one, check the customSkills setting, then the default name
                                let skillName;
                                if (customSkills[skillKey]) {
                                    skillName = typeof customSkills[skillKey] === 'object' 
                                        ? customSkills[skillKey].name 
                                        : customSkills[skillKey];
                                } else {
                                    skillName = game.i18n.localize(defaultSkillNames[skillKey] || skillKey);
                                }
                                addOption(select, skillKey, skillName);
                            }
                        });
                        
                        // stat_add / stat_dice also offer that attribute's skill-group option
                        if ((selectedKey === 'stat_add' || selectedKey === 'stat_dice') && skillGroupByAttribute[attr]) {
                            const groupKey = skillGroupByAttribute[attr];
                            const groupName = game.i18n.localize(`DX3rd.${groupKey}`);
                            addOption(select, groupKey, groupName);
                        }
                        
                        // That attribute's custom skills (only when there is an actor)
                        if (hasActor) {
                            Object.entries(skills).forEach(([skillKey, skillData]) => {
                                if (skillData && skillData.base === attr && !defaultSkillList.includes(skillKey)) {
                                    const skillName = skillData.name.startsWith('DX3rd.') 
                                        ? game.i18n.localize(skillData.name) 
                                        : skillData.name;
                                    addOption(select, skillKey, skillName);
                                }
                            });
                        }
                    });

                    select.value = currentValue;
                    bindLabelUpdate(select);
                    labelElement.replaceWith(select);
                }
            } else {
                // Not a stat key: turn the field into a disabled input
                if (labelElement.matches('select')) {
                    const input = document.createElement('input');
                    input.type = 'text';
                    input.className = 'attribute-label';
                    input.value = '-';
                    input.disabled = true;
                    if (nameAttr) input.name = nameAttr;
                    labelElement.replaceWith(input);
                }
            }
        },

        /**
         * Sort skills by attribute
         * @param {Object} skills - the skills object
         * @returns {Array} the sorted skill entries
         */
        sortSkillsByAttribute(skills) {
            const fixedOrder = {
                body: ["melee", "evade"],
                sense: ["ranged", "perception"],
                mind: ["rc", "will", "cthulhu"],
                social: ["negotiation", "procure"]
            };

            const result = [];
            const attributes = ['body', 'sense', 'mind', 'social'];

            attributes.forEach(attr => {
                // Skills in the fixed order
                const fixedSkills = fixedOrder[attr] || [];
                fixedSkills.forEach(skillKey => {
                    if (skills[skillKey] && skills[skillKey].base === attr) {
                        result.push([skillKey, skills[skillKey]]);
                    }
                });

                // The remaining skills
                Object.entries(skills)
                    .filter(([key, skill]) => 
                        skill.base === attr && 
                        !fixedSkills.includes(key)
                    )
                    .sort((a, b) => {
                        if (a[1].order !== undefined && b[1].order !== undefined) {
                            return a[1].order - b[1].order;
                        }
                        return a[1].name.localeCompare(b[1].name);
                    })
                    .forEach(([key, skill]) => {
                        result.push([key, skill]);
                    });
            });

            return result;
        },

        /**
         * Initialize the attribute labels after the sheet renders
         * @param {HTMLElement|jQuery} html - the rendered element
         * @param {Object} item - the item
         */
        async initializeAttributeLabels(html, item) {
            const dom = window.DX3rdApplicationCompat;
            // Every row carries a data-pos — the self and target buckets share one list.
            const mainUpdates = dom.queryAll(html, '.attribute[data-pos="main"]')
                .map(element => window.DX3rdAttributeManager.updateAttributeLabel(element, item, 'main'));

            const subUpdates = dom.queryAll(html, '.attribute[data-pos="sub"]')
                .map(element => window.DX3rdAttributeManager.updateAttributeLabel(element, item, 'sub'));

            await Promise.all([...mainUpdates, ...subUpdates]);
        }
    };

    // ========== Weapon tab utilities ========== //
    window.DX3rdWeaponTabManager = {
        /**
         * Prepare the weapon tab data (called from getData)
         * @param {Object} data - the sheet data
         * @param {Object} item - the item
         * @returns {Object} data, with the weapon tab fields added
         */
        prepareWeaponTabData(data, item) {
            // Seed the weapon fields only when undefined — an empty string is a valid value
            if (data.system.weaponTmp === undefined) data.system.weaponTmp = item.system?.weaponTmp || "-";
            if (data.system.weapon === undefined) data.system.weapon = item.system?.weapon || [];
            if (data.system.weaponItems === undefined) data.system.weaponItems = {};
            if (data.system.attackRoll === undefined) data.system.attackRoll = item.system?.attackRoll || "-";
            if (data.system.weaponSelect === undefined) data.system.weaponSelect = item.system?.weaponSelect || false;

            // Build the actor's weapon list (weapons + vehicles, ordered by sort)
            data.actorWeapon = {};
            // The virtual weapon ("no weapon") is not listed here — this dropdown already has an
            // equivalent static `-` option, and registering it contributes nothing but noise.
            // That single row is used only by the attack-time weapon picker.
            if (item.actor) {
                // Weapons first (ordered by sort)
                const weaponItems = item.actor.items.filter(i => i.type === 'weapon')
                    .sort((a, b) => (a.sort || 0) - (b.sort || 0));
                weaponItems.forEach(w => {
                    data.actorWeapon[w.id] = w.name;
                });
                
                // Then vehicles (ordered by sort)
                const vehicleItems = item.actor.items.filter(i => i.type === 'vehicle')
                    .sort((a, b) => (a.sort || 0) - (b.sort || 0));
                vehicleItems.forEach(v => {
                    data.actorWeapon[v.id] = v.name;
                });
            }

            // Resolve the selected weapon items
            if (Array.isArray(data.system.weapon)) {
                data.system.weapon.forEach((weaponId) => {
                    if (weaponId && weaponId !== '-') {
                        // Look in the actor's weapons/vehicles, or among the virtual (world) weapons
                        const weaponOrVehicleItem = window.DX3rdResolveWeapon?.(item.actor, weaponId) || item.actor?.items.get(weaponId);
                        if (weaponOrVehicleItem && (weaponOrVehicleItem.type === 'weapon' || weaponOrVehicleItem.type === 'vehicle')) {
                            data.system.weaponItems[weaponId] = weaponOrVehicleItem;
                        }
                    }
                });
            }

            return data;
        },

        /**
         * Wire up the weapon tab listeners
         * @param {HTMLElement|jQuery} html - the sheet root
         * @param {Object} sheet - the sheet instance
         */
        setupWeaponTabListeners(html, sheet) {
            const dom = window.DX3rdApplicationCompat;
            const cleanups = [];
            // "Add weapon" button
            cleanups.push(dom.on(html, 'click', '.add-weapon', async (event, button) => {
                event.preventDefault();
                // The picker's wrapper class differs per sheet (.add-skills / .dx3rd-weapon-picker).
                // When neither matches, search from the sheet root instead.
                const picker = button.closest('.add-skills, .dx3rd-weapon-picker') || button.parentElement;
                const weaponSelect = dom.query(picker, '#actor-weapon') || dom.query(html, '#actor-weapon');
                const weaponId = weaponSelect?.value;
                
                if (!weaponId || weaponId === '-') {
                    ui.notifications.warn("추가할 무기를 선택해주세요.");
                    return;
                }

                try {
                    // The current weapon array
                    const currentWeapons = sheet.item.system.weapon || [];
                    
                    // Already registered?
                    if (currentWeapons.includes(weaponId)) {
                        ui.notifications.warn("이미 추가된 무기입니다.");
                        return;
                    }

                    // Append
                    const newWeapons = [...currentWeapons, weaponId];
                    
                    await sheet.item.update({
                        'system.weapon': newWeapons
                    });

                    // Post-add hook, e.g. the combo sheet's attack-combo automation
                    if (typeof sheet._onWeaponAdded === 'function') {
                        try { await sheet._onWeaponAdded(weaponId); }
                        catch (e) { console.error('DX3rd | WeaponTabManager - _onWeaponAdded failed', e); }
                    }

                    ui.notifications.info("무기가 추가되었습니다.");

                    // Re-render the sheet
                    sheet.render(false);

                } catch (error) {
                    console.error('DX3rd | WeaponTabManager - add weapon failed', error);
                    ui.notifications.error("무기 추가에 실패했습니다.");
                }
            }));

            // "Delete weapon" button
            cleanups.push(dom.on(html, 'click', '.weapon-item .item-control.item-delete', async (event, button) => {
                event.preventDefault();
                const weaponId = button.closest('.item')?.dataset.itemId;

                if (!weaponId) {
                    ui.notifications.warn("삭제할 무기를 찾을 수 없습니다.");
                    return;
                }

                try {
                    // Remove it from the current weapon array
                    const currentWeapons = sheet.item.system.weapon || [];
                    const newWeapons = currentWeapons.filter(id => id !== weaponId);
                    
                    await sheet.item.update({
                        'system.weapon': newWeapons
                    });

                    // Post-delete hook, e.g. recomputing the combo's skill and attack roll
                    if (typeof sheet._onWeaponRemoved === 'function') {
                        try { await sheet._onWeaponRemoved(weaponId); }
                        catch (e) { console.error('DX3rd | WeaponTabManager - _onWeaponRemoved failed', e); }
                    }

                    ui.notifications.info("무기가 삭제되었습니다.");
                    
                    // Re-render the sheet
                    sheet.render(false);
                    
                } catch (error) {
                    console.error('DX3rd | WeaponTabManager - delete weapon failed', error);
                    ui.notifications.error("무기 삭제에 실패했습니다.");
                }
            }));

            // "Edit weapon" — opens the source weapon's sheet from a weapon row on a combo/effect/psionic sheet.
            // (Editing an effect row is wired separately per sheet, via .combo-item:not(.weapon-item).)
            cleanups.push(dom.on(html, 'click', '.weapon-item .item-control.item-edit', (event, button) => {
                event.preventDefault();
                const weaponId = button.closest('.item')?.dataset.itemId;

                if (!weaponId) {
                    ui.notifications.warn("편집할 무기를 찾을 수 없습니다.");
                    return;
                }

                // A virtual (world) weapon is not a real document, so it has no sheet to open.
                if (window.DX3rdVirtualWeapons?.isVirtual?.(weaponId)) {
                    ui.notifications.info("가상 무기는 편집할 수 없습니다.");
                    return;
                }

                const weaponItem = sheet.item.actor?.items.get(weaponId);
                if (!weaponItem) {
                    ui.notifications.warn("무기 아이템을 찾을 수 없습니다.");
                    return;
                }

                weaponItem.sheet.render(true);
            }));
            return cleanups;
        }
    };

    // ========== Description editor helpers ========== //
    window.DX3rdDescriptionManager = {
        /**
         * Build the enrichedBiography for the description editor
         * @param {Object} item - the item
         * @param {string} description - the description text
         * @returns {Promise<string>} enriched HTML
         */
        async createEnrichedBiography(item, description = "") {
            const TextEditorClass = foundry.applications.ux.TextEditor.implementation;
            return await TextEditorClass.enrichHTML(description, {
                secrets: item.isOwner,
                rollData: item.getRollData()
            });
        },

        /**
         * Add enrichedBiography to the sheet data
         * @param {Object} data - the sheet data
         * @param {Object} item - the item
         * @returns {Promise<Object>} the updated sheet data
         */
        async enrichSheetData(data, item) {
            if (!data.enrichedBiography) {
                data.enrichedBiography = await this.createEnrichedBiography(
                    item, 
                    data.system.description || ""
                );
            }
            return data;
        }
    };

    /**
     * Skill selection option manager
     */
    window.DX3rdSkillManager = {
        /**
         * Resolve a skill's display name from its key (handling custom skills and localization).
         * The combo and effect handlers each kept their own copy; they were merged here so that a
         * category or custom skill's label cannot differ from one roll path to another.
         * @param {string} skillKey
         * @param {Object} skillStat - the actor's data for that skill
         * @returns {string}
         */
        getSkillDisplayName(skillKey, skillStat) {
            if (!skillKey) return '';
            let label = skillStat?.name || '';
            if (label && label.startsWith('DX3rd.')) {
                const customSkills = game.settings.get("dx3rd-emanim", "customSkills") || {};
                const customSkill = customSkills[skillKey];
                if (customSkill) {
                    return typeof customSkill === 'object' ? customSkill.name : customSkill;
                }
                return game.i18n.localize(label);
            }
            return label || skillKey;
        },

        /**
         * Build the skill options for an item type
         * @param {string} itemType - 'effect', 'weapon', 'psionic', 'combo'
         * @param {Object} actorSkills - the actor's skill data
         * @param {string} actorType - 'character', 'enemy', etc.
         * @returns {Array} the sorted skill options
         */
        getSkillSelectOptions(itemType, actorSkills, actorType = null) {
            const options = [];

            const localizeIfKey = (text) => {
                if (typeof text !== 'string') return text;
                if (text.startsWith('DX3rd.')) return (game?.i18n?.localize?.(text)) || text;
                return text;
            };

            // The default option
            options.push({ value: '-', label: '-' });

            // Attribute options (in order: Body, Sense, Mind, Social)
            const attributes = [
                { value: 'body', label: localizeIfKey('DX3rd.Body') },
                { value: 'sense', label: localizeIfKey('DX3rd.Sense') },
                { value: 'mind', label: localizeIfKey('DX3rd.Mind') },
                { value: 'social', label: localizeIfKey('DX3rd.Social') }
            ];

            options.push(...attributes);

            // Enemies get the attributes only
            if (actorType === 'enemy') {
                return options;
            }

            // Actor skill options, grouped by attribute.
            // When actorSkills is empty or absent, fall back to the default skills
            const hasSkills = actorSkills && 
                             typeof actorSkills === 'object' && 
                             !Array.isArray(actorSkills) &&
                             Object.keys(actorSkills).length > 0;
            
            if (hasSkills) {
                const sortedSkills = this.sortSkillsByAttribute(actorSkills);
                // Localize the sorted skill labels
                sortedSkills.forEach(o => { o.label = localizeIfKey(o.label); });
                options.push(...sortedSkills);
            } else {
                // Defaults only (there is no actor)
                const defaultSkills = this.getDefaultSkillOptions();
                defaultSkills.forEach(o => { o.label = localizeIfKey(o.label); });
                options.push(...defaultSkills);
            }

            // Effects get the skill groups and syndrome appended at the very end
            if (itemType === 'effect') {
                options.push(
                    { value: 'drive', label: localizeIfKey('DX3rd.drive') },
                    { value: 'ars', label: localizeIfKey('DX3rd.ars') },
                    { value: 'know', label: localizeIfKey('DX3rd.know') },
                    { value: 'info', label: localizeIfKey('DX3rd.info') }
                );
                options.push({ value: 'syndrome', label: localizeIfKey('DX3rd.Syndrome') });
            }

            return options;
        },
        
        /**
         * The default skill options (used when there is no actor)
         * @returns {Array} the default skill options, grouped by attribute
         */
        getDefaultSkillOptions() {
            // Customized skill names from the customSkills setting
            const customSkills = game.settings?.get("dx3rd-emanim", "customSkills") || {};
            
            // Group the default skills by attribute
            const skillGroups = {
                body: ['melee', 'evade'],
                sense: ['ranged', 'perception'],
                mind: ['rc', 'will', 'cthulhu'],
                social: ['negotiation', 'procure']
            };
            
            const options = [];
            const attributeOrder = ['body', 'sense', 'mind', 'social'];
            
            for (const attr of attributeOrder) {
                // The default skills
                for (const skillKey of skillGroups[attr]) {
                    // cthulhu depends on the stageCRC setting
                    if (skillKey === 'cthulhu') {
                        const stageCRCEnabled = game.settings?.get("dx3rd-emanim", "stageCRC");
                        if (!stageCRCEnabled) continue;
                    }
                    
                    let skillName;
                    if (customSkills[skillKey]) {
                        skillName = typeof customSkills[skillKey] === 'object' 
                            ? customSkills[skillKey].name 
                            : customSkills[skillKey];
                    } else {
                        skillName = `DX3rd.${skillKey}`;
                    }
                    options.push({ value: skillKey, label: skillName });
                }
                
                // That attribute's custom skills
                for (const [skillKey, skillData] of Object.entries(customSkills)) {
                    // Non-default skills only
                    const isDefaultSkill = ['melee', 'evade', 'ranged', 'perception', 'rc', 'will', 'cthulhu', 'negotiation', 'procure'].includes(skillKey);
                    if (isDefaultSkill) continue;
                    
                    // Belonging to this attribute only
                    const skillBase = typeof skillData === 'object' ? skillData.base : 'body';
                    if (skillBase === attr) {
                        const skillName = typeof skillData === 'object' ? skillData.name : skillData;
                        options.push({ value: skillKey, label: skillName });
                    }
                }
            }
            
            return options;
        },
        
        /**
         * Sort the actor's skills by attribute (defaults first, added skills after)
         * @param {Object} actorSkills - the actor's skill data
         * @returns {Array} the sorted skill options
         */
        sortSkillsByAttribute(actorSkills) {
            const skillOptions = [];
            const attributeOrder = ['body', 'sense', 'mind', 'social'];
            
            // The system's predefined default skills
            const defaultSkills = {
                body: ['melee', 'evade'],
                sense: ['ranged', 'perception'],
                mind: ['rc', 'will', 'cthulhu'],
                social: ['negotiation', 'procure']
            };
            
            // Sort within each attribute
            attributeOrder.forEach(attr => {
                const defaultSkillList = defaultSkills[attr] || [];
                
                // 1. The default skills first
                defaultSkillList.forEach(skillId => {
                    const skillData = actorSkills[skillId];
                    if (skillData && skillData.base === attr) {
                        skillOptions.push({
                            value: skillId,
                            label: (typeof (skillData.name) === 'string' && skillData.name.startsWith('DX3rd.')) ? (game?.i18n?.localize?.(skillData.name) || skillData.name) : (skillData.name || skillId)
                        });
                    }
                });
                
                // 2. Then the added skills (those not among the defaults)
                Object.entries(actorSkills).forEach(([skillId, skillData]) => {
                    if (skillData && skillData.base === attr && !defaultSkillList.includes(skillId)) {
                        // Resolve the custom skill name
                        let skillLabel;
                        if (typeof (skillData.name) === 'string' && skillData.name.startsWith('DX3rd.')) {
                            skillLabel = game?.i18n?.localize?.(skillData.name) || skillData.name;
                        } else {
                            skillLabel = skillData.name || skillId;
                        }
                        
                        skillOptions.push({
                            value: skillId,
                            label: skillLabel
                        });
                    }
                });
            });
            
            return skillOptions;
        }
    };

    // Turns an attribute name into its localization key
    window.DX3rdAttributeLocalizer = {
        /**
         * Localize an attribute name
         * @param {string} attrName - the attribute name (e.g. "hp", "body", "melee")
         * @returns {string} the localized string
         */
        localize(attrName) {
            if (!attrName || attrName === '-') return attrName;

            // Special cases (key → localization key)
            const specialMappings = {
                'hp': 'DX3rd.HP',
                'init': 'DX3rd.Init',
                'armor': 'DX3rd.Armor',
                'guard': 'DX3rd.Guard',
                'saving_max': 'DX3rd.Saving',
                'stock_point': 'DX3rd.Stock',
                'battleMove': 'DX3rd.BattleMove',
                'fullMove': 'DX3rd.FullMove',
                'penetrate': 'DX3rd.Penetrate',
                'reduce': 'DX3rd.ReduceDamage',
                'attack': 'DX3rd.Attack',
                'dice': 'DX3rd.Dice',
                'add': 'DX3rd.Add',
                'critical': 'DX3rd.Critical',
                'critical_min': 'DX3rd.CriticalMin',
                'major_dice': 'DX3rd.MajorDice',
                'major_add': 'DX3rd.MajorAdd',
                'major_critical': 'DX3rd.MajorCritical',
                'reaction_dice': 'DX3rd.ReactionDice',
                'reaction_add': 'DX3rd.ReactionAdd',
                'reaction_critical': 'DX3rd.ReactionCritical',
                'dodge_dice': 'DX3rd.DodgeDice',
                'dodge_add': 'DX3rd.DodgeAdd',
                'dodge_critical': 'DX3rd.DodgeCritical',
                'stat_bonus': 'DX3rd.StatBonus',
                'stat_add': 'DX3rd.StatAdd',
                'stat_dice': 'DX3rd.StatDice',
                'cast_dice': 'DX3rd.CastingDice',
                'cast_add': 'DX3rd.CastingAdd'
            };

            // Special mapping first
            if (specialMappings[attrName]) {
                return game.i18n.localize(specialMappings[attrName]);
            }

            // Base attributes (body, sense, mind, social)
            const basicAttributes = ['body', 'sense', 'mind', 'social'];
            if (basicAttributes.includes(attrName.toLowerCase())) {
                const key = `DX3rd.${attrName.charAt(0).toUpperCase() + attrName.slice(1)}`;
                return game.i18n.localize(key);
            }

            // Skills (melee, evade, ranged, …) — lowercase as-is
            const key = `DX3rd.${attrName}`;
            const localized = game.i18n.localize(key);
            
            // When localization fails (the key comes back unchanged), return the original name
            return localized !== key ? localized : attrName;
        }
    };

    /**
     * Usage-condition gates — "is this a violation" and "should it block" are different axes.
     *
     * Same shape as the exhaustion gate (DX3rdItemExhausted.allowExhaustedUse). The caller still
     * detects the violation; the world setting read here only decides whether that **blocks**.
     * Every default is "do not block" — the automation is still being tuned, and halting a session
     * because one line of data is wrong is the worse failure. Even when nothing is blocked, the
     * warning and the chat record still go out so the GM sees that something unusable was used.
     *
     * Before the settings are registered (pre-init), or if registration failed, it falls back to not blocking.
     */
    window.DX3rdUsageGates = {
        // Gate key → world setting key. universal-handler's reportUsageGate is the only consumer.
        SETTINGS: {
            resurrect: 'allowResurrectViolation',
            encroachLimit: 'allowEncroachLimitViolation',
            berserk: 'allowBerserkViolation',
            pressure: 'allowPressureViolation'
        },

        /**
         * Should a violation of this gate be let through?
         * @param {string} gate  a key in SETTINGS
         * @returns {boolean} true means warn only and allow the use
         */
        allows: function(gate) {
            const setting = this.SETTINGS[gate];
            if (!setting) return true;
            try {
                return game.settings.get('dx3rd-emanim', setting) !== false;
            } catch (error) {
                return true;
            }
        },

        /**
         * Is this item **authored** as usable even under that condition?
         *
         * A different axis from the gate setting above — the setting decides per table whether to
         * enforce the rule at all, while this decides per item whether the source text exempts it.
         * So an exempt item passes even at a table that has the setting on (i.e. blocking).
         *
         * Two grounds, OR'd together:
         *   (1) the item's own authoring (`system.conditionExempt.<condition>`, in the extend tool).
         *   (2) the world setting's name list (the legacy path). Some worlds still run data from
         *       before items had a field for this, so it stays — but author new ones with (1).
         * @param {Item} item
         * @param {'pressure'|'berserk'} condition
         * @returns {boolean}
         */
        conditionExempt: function(item, condition) {
            if (item?.system?.conditionExempt?.[condition] === true) return true;

            // A combo has no field of its own (the exemption is authored on the effect sheet). If any
            // member is authored exempt, the combo counts as exempt too — otherwise a reaction combo
            // holding an exempt effect would be blocked under [Berserk] while that effect alone is not.
            if (item?.type === 'combo') {
                const actor = item.actor;
                const members = window.DX3rdUniversalHandler?.comboMemberItems?.(actor, item) || [];
                if (members.some(member => member?.system?.conditionExempt?.[condition] === true)) return true;
            }

            const legacySetting = condition === 'pressure'
                ? 'DX3rd.PressureExceptionItems'
                : 'DX3rd.BerserkReactionExceptionItems';
            let names = '';
            try {
                names = game.settings.get('dx3rd-emanim', legacySetting) || '';
            } catch (error) {
                return false;
            }
            if (!names) return false;

            // Ruby (`name||reading`) keeps only the display name — the list is written with display names.
            const itemName = (String(item?.name || '').match(/^(.+)\|\|(.+)$/) || [null, item?.name])[1];
            return names.split(',').map(n => n.trim()).includes(itemName);
        }
    };

    // Item exhaustion utilities
    window.DX3rdItemExhausted = {
        /**
         * Should exhausted items still be usable (world setting allowExhaustedUse)?
         * Separate from the exhaustion **test** (isItemExhausted) — exhaustion is computed and shown
         * regardless; this only decides whether it turns into a block. That is why the sheet's
         * exhausted styling and the declaration list's remaining-uses display persist either way.
         * Before the setting is registered (pre-init), or if registration failed, it falls back to not blocking.
         * @returns {boolean} true means usable even when exhausted (warning only)
         */
        allowExhaustedUse: function() {
            try {
                return game.settings.get('dx3rd-emanim', 'allowExhaustedUse') !== false;
            } catch (error) {
                return true;
            }
        },

        /**
         * Whether an item has exhausted its usage count
         * @param {Object} item - the item to check
         * @returns {boolean} true when exhausted, false when still usable
         */
        isItemExhausted: function(item) {
            if (!item || !item.system) {
                return false;
            }
            
            // A combo counts as exhausted as soon as any of its member effects is
            if (item.type === 'combo') {
                // Member effect ids: normalizeEffectIds is the single place that normalizes them.
                // The local implementation that used to live here did not know a combo's system.effect
                // is a **config object** ({ disable, runTiming, attributes }), so with an empty effectIds
                // it would pick values like 'instant' out of Object.values as if they were item ids.
                // (The schema always fills effectIds with an array, so it was never actually reached.
                //  This is safe even though helpers loads first, since the call happens at runtime.)
                const effectIds = window.DX3rdUniversalHandler?.normalizeEffectIds?.(item)
                    ?? (Array.isArray(item.system?.effectIds) ? item.system.effectIds.filter(e => e && e !== '-') : []);

                if (effectIds.length === 0) {
                    return false; // no member effects → never exhausted
                }
                
                // Resolve the actor
                let actor = item.actor || game.actors.get(item.actorId);
                // The item may be a plain object from a template context, with no actor attached;
                // in that case find the owning actor by item id
                if (!actor) {
                    const itemId = item._id || item.id;
                    if (itemId) {
                        for (const a of game.actors) {
                            const owned = a.items?.get?.(itemId);
                            if (owned) {
                                actor = a;
                                break;
                            }
                        }
                    }
                }
                if (!actor) {
                    return false;
                }
                
                // Is any member effect exhausted?
                for (const effectId of effectIds) {
                    if (effectId && effectId !== '-') {
                        const effect = actor.items.get(effectId);
                        
                        if (effect && effect.type === 'effect') {
                            const usedDisable = effect.system.used?.disable || 'notCheck';
                            const usedState = effect.system.used?.state || 0;
                            const usedMax = effect.system.used?.max || 0;
                            const usedLevel = effect.system.used?.level || false;
                            
                            if (usedDisable !== 'notCheck') {
                                // Compute displayMax (add the level when used.level is checked)
                                let displayMax = Number(usedMax) || 0;
                                if (usedLevel) {
                                    const finalLevel = window.DX3rdEffectLevel
                                        ? window.DX3rdEffectLevel.value(effect, actor)
                                        : Number(effect.system?.level?.init) || 0;
                                    displayMax += finalLevel;
                                }
                                
                                const isEffectExhausted = displayMax <= 0 || usedState >= displayMax;
                                
                                if (isEffectExhausted) {
                                    return true; // one exhausted member exhausts the combo
                                }
                            }
                        }
                    }
                }
                
                return false; // every effect usable → the combo is usable
            }
            
            const usedDisable = item.system.used?.disable || 'notCheck';
            
            // With the used check disabled, nothing is ever exhausted
            if (usedDisable === 'notCheck') return false;
            
            const usedState = item.system.used?.state || 0;
            const usedMax = item.system.used?.max || 0;
            const usedLevel = item.system.used?.level || false;
            
            // Resolve the actor (template data may not carry item.actor)
            let actor = item.actor;
            if (!actor) {
                const itemId = item._id || item.id;
                if (itemId) {
                    for (const a of game.actors) {
                        const owned = a.items?.get?.(itemId);
                        if (owned) {
                            actor = a;
                            break;
                        }
                    }
                }
            }
            
            // Compute displayMax (add the level when used.level is checked)
            let displayMax = Number(usedMax) || 0;
            if (usedLevel && item.type === 'effect') {
                const finalLevel = window.DX3rdEffectLevel
                    ? window.DX3rdEffectLevel.value(item, actor)
                    : Number(item.system?.level?.init) || 0;
                displayMax += finalLevel;
            } else if (usedLevel && item.type === 'psionic') {
                const baseLevel = Number(item.system?.level?.init) || 0;
                displayMax += baseLevel;
            }
            
            const isUsedExhausted = displayMax <= 0 || usedState >= displayMax;
            
            // Weapons also check attack-used
            if (item.type === 'weapon') {
                const attackUsedDisable = item.system['attack-used']?.disable || 'notCheck';
                if (attackUsedDisable === 'notCheck') {
                    // With attack-used disabled, only used matters
                    return isUsedExhausted;
                }
                
                const attackUsedState = item.system['attack-used']?.state || 0;
                const attackUsedMax = item.system['attack-used']?.max || 0;
                const isAttackUsedExhausted = attackUsedMax <= 0 || attackUsedState >= attackUsedMax;
                
                // Fully exhausted only when both used and attack-used are
                return isUsedExhausted && isAttackUsedExhausted;
            }
            
            // Non-weapons check used alone
            return isUsedExhausted;
        }
    };

    // Other existing helpers follow…
})(); 

// A temporary combo may have its document removed right after use, yet the chat card's follow-up
// must keep working. So the chat flags hold only a serializable snapshot, never a Document instance.
(function() {
    const FLAG_SCOPE = 'dx3rd-emanim';
    const FLAG_KEY = 'instantCombo';

    window.DX3rdIsInstantCombo = function(item) {
        if (!item || item.type !== 'combo') return false;
        if (String(item.id || '').startsWith('_temp_combo_')) return true;
        return item.getFlag?.(FLAG_SCOPE, FLAG_KEY) === true
            || item.flags?.[FLAG_SCOPE]?.[FLAG_KEY] === true;
    };

    window.DX3rdSerializeInstantCombo = function(item) {
        if (!item) return null;
        const snapshot = item.toObject ? item.toObject() : foundry.utils.deepClone(item);
        // Foundry's toObject() guarantees _id only, but the existing chat buttons look items up by id.
        snapshot.id ??= item.id || snapshot._id;
        snapshot.flags ??= {};
        snapshot.flags[FLAG_SCOPE] ??= {};
        snapshot.flags[FLAG_SCOPE][FLAG_KEY] = true;
        return snapshot;
    };
})();

// A non-modal picker replacing the "use an ad-hoc combo?" confirmation dialog.
// It anchors below the focused element at the call site, and only centers on screen when there is none.
(function() {
    let activeMenu = null;

    const chooseMode = function(anchor, choices) {
        if (activeMenu) activeMenu.resolve(null);

        return new Promise(resolve => {
            const menu = document.createElement('div');
            menu.className = `dx3rd-roll-mode-menu${choices.length === 3 ? ' is-three-options' : ''}`;
            menu.setAttribute('role', 'menu');
            for (const choice of choices) {
                const button = document.createElement('button');
                button.type = 'button';
                button.setAttribute('role', 'menuitem');
                button.className = 'dx3rd-roll-mode-option';
                button.dataset.mode = String(choice.value);
                const icon = document.createElement('i');
                for (const className of String(choice.icon || '').split(/\s+/).filter(name => /^[\w-]+$/.test(name))) {
                    icon.classList.add(className);
                }
                const label = document.createElement('span');
                label.textContent = String(choice.label || '');
                button.append(icon, label);
                menu.appendChild(button);
            }

            const finish = value => {
                if (!menu.isConnected) return;
                menu.remove();
                document.removeEventListener('pointerdown', onOutside, true);
                document.removeEventListener('keydown', onKeyDown, true);
                if (activeMenu?.menu === menu) activeMenu = null;
                resolve(value);
            };
            const onOutside = event => {
                if (!menu.contains(event.target) && event.target !== anchor) finish(null);
            };
            const onKeyDown = event => {
                if (event.key === 'Escape') finish(null);
            };

            menu.querySelectorAll('[data-mode]').forEach(button => button.addEventListener('click', event => {
                event.preventDefault();
                finish(choices.find(choice => String(choice.value) === button.dataset.mode)?.value ?? null);
            }));
            document.body.appendChild(menu);

            // body/html return a rect the size of the whole document, which is not the call site.
            // (Using it would clamp the menu to the document bottom and pin it to the lower-left corner.)
            // So only a real anchor with area — a clicked element — is used; otherwise center it.
            const isUsableAnchor = anchor instanceof Element
                && anchor !== document.body
                && anchor !== document.documentElement
                && anchor.isConnected;
            const candidateRect = isUsableAnchor ? anchor.getBoundingClientRect() : null;
            const rect = candidateRect?.width > 0 && candidateRect?.height > 0 ? candidateRect : null;
            const preferredLeft = rect ? rect.left : (window.innerWidth / 2 - menu.offsetWidth / 2);
            const preferredTop = rect ? rect.bottom + 6 : (window.innerHeight / 2 - menu.offsetHeight / 2);
            menu.style.left = `${Math.min(Math.max(8, preferredLeft), window.innerWidth - menu.offsetWidth - 8)}px`;
            menu.style.top = `${Math.min(Math.max(8, preferredTop), window.innerHeight - menu.offsetHeight - 8)}px`;

            activeMenu = {menu, resolve: finish};
            setTimeout(() => {
                if (!menu.isConnected) return;
                document.addEventListener('pointerdown', onOutside, true);
                document.addEventListener('keydown', onKeyDown, true);
            }, 0);
            menu.querySelector('[data-mode]')?.focus();
        });
    };

    window.DX3rdChooseRollMode = function(anchor = document.activeElement) {
        return chooseMode(anchor, [
            {value: false, icon: 'fa-solid fa-dice-d20', label: game.i18n.localize('DX3rd.Normal')},
            {value: true, icon: 'fa-solid fa-link', label: game.i18n.localize('DX3rd.Combo')}
        ]);
    };

    window.DX3rdChooseItemMode = function(anchor = document.activeElement, item = null, options = {}) {
        const isAttack = window.DX3rdItemEffectAdapter?.isAttackItem?.(item)
            || ['weapon', 'vehicle'].includes(item?.type);
        const allowCombo = options.allowCombo !== false;
        const entries = [{
            value: isAttack ? 'normal' : 'use',
            icon: isAttack ? 'fa-solid fa-crosshairs' : 'fa-solid fa-bolt',
            label: game.i18n.localize(isAttack ? 'DX3rd.EffectActionAttack' : 'DX3rd.EffectActionUse')
        }];
        // Even for an attack item, a separate entry point appears when effects are bound to 'use'.
        // A weapon's declared self-modifiers ("spend a minor action to declare …" for the bolt-action
        // rifle, "declare when you guard" for the guard shield) fire on the declaration, not the attack.
        // With only attack/combo/apply-effect in the menu, the sole way to declare was "apply effect →
        // self" (which needs self-targeting) — and that neither counts a use nor charges encroachment.
        // handleItemUse already supports this action via effectOnlyUse (effects only, no attack roll).
        if (isAttack && window.DX3rdItemEffectAdapter?.hasActionEffects?.(item, 'use')) {
            entries.push({
                value: 'use',
                icon: 'fa-solid fa-bolt',
                label: game.i18n.localize('DX3rd.EffectActionUse')
            });
        }
        if (allowCombo) {
            entries.push({
                value: 'combo',
                icon: 'fa-solid fa-link',
                label: game.i18n.localize('DX3rd.Combo')
            });
        }
        // For a non-attack item, 'use' IS the effect-application path. Only attack items get a
        // separate entry point for applying their card effects without attacking.
        if (isAttack) {
            entries.push({value: 'apply', icon: 'fa-solid fa-hand-sparkles', label: game.i18n.localize('DX3rd.ApplyEffect')});
        }
        return chooseMode(anchor, entries);
    };

    window.DX3rdChooseEffectApplySource = function(anchor = document.activeElement) {
        return chooseMode(anchor, [
            {value: 'target', icon: 'fa-solid fa-crosshairs', label: game.i18n.localize('DX3rd.TargetEffect')},
            {value: 'self', icon: 'fa-solid fa-user', label: game.i18n.localize('DX3rd.SelfEffect')}
        ]);
    };
})();
