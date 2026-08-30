/**
 * The Double Cross 3rd special dice system
 */

// Define the classes on the global object
(function () {
    // Wait until Foundry VTT is ready
    function waitForFoundry(callback, maxAttempts = 10, interval = 500) {
        let attempts = 0;

        function checkFoundry() {
            attempts++;

            if (typeof foundry !== 'undefined' && foundry.dice && foundry.dice.terms) {
                callback();
            } else if (attempts < maxAttempts) {
                setTimeout(checkFoundry, interval);
            } else {
            }
        }

        checkFoundry();
    }

    // The DX3rdDiceTerm class
    class DX3rdDiceTerm extends foundry.dice.terms.Die {
        /** @override */
        constructor(termData = {}) {
            // Convert modifiers to an array
            if (typeof termData.modifiers === 'string') {
                termData.modifiers = [parseInt(termData.modifiers)];
            } else if (!Array.isArray(termData.modifiers)) {
                termData.modifiers = [game.settings.get("dx3rd-emanim", "defaultCritical") || 10];  // the default
            }

            super(termData);
            this.faces = 10;  // always ten-sided
            this.critical = termData.modifiers[0] ?? (game.settings.get("dx3rd-emanim", "defaultCritical") || 10);
            if (this.critical < 2) this.critical = 2;  // the minimum critical value is 2

            // The chain-roll data
            this.chainRolls = [];  // the dice rolled in each chain
            this.chainMaxes = [];  // the maximum of each chain
        }

        /** @inheritdoc */
        static get name() { return "DX3rdDiceTerm"; }

        /** @inheritdoc */
        static get DENOMINATION() { return "dx"; }

        /** @inheritdoc */
        static get REGEXP() {
            // Recognize the 'dx' pattern directly
            return /(?<number>\d+)dx(?<crit>\d+)?(?<mod>[+-]\d+)?/i;
        }

        /** @inheritdoc */
        static get SERIALIZE_ATTRIBUTES() {
            return ["critical", "chainRolls", "chainMaxes", "faces", "number", "options", "results", "_totalValue"];
        }

        /** @override */
        get expression() {
            let expr = `${this.number}dx${this.critical}`;
            if (this.options?.modifier) {
                expr += (this.options.modifier > 0 ? "+" : "") + this.options.modifier;
            }
            return expr;
        }

        /** @override */
        _evaluateModifiers() {
            // A DX die skips the default modifier handling
            return this;
        }

        /** @override */
        async evaluate({ minimize = false, maximize = false } = {}) {
            if (this.number > 999) {
                throw new Error("주사위 개수는 999개를 넘을 수 없습니다.");
            }

            // Perform the base Die evaluation
            await super.evaluate({ minimize, maximize });

            // Handle the chain rolls
            this.chainRolls = [];
            this.chainMaxes = [];
            let currentDice = this.number;
            let currentResults = [...this.results];
            let totalValue = 0;  // the running value for the final result
            let isFirstChain = true;
            this.fumble = false; // whether it fumbled (every die of the first roll a 1) — the handler uses it for auto-failure / a result of 0

            while (currentDice > 0) {
                let thisChain = currentResults.map(r => r.result);
                this.chainRolls.push(thisChain);

                // Mark criticals and handle the sawtooth
                let hasCritical = false;
                let crits = 0;
                let idx = 0;
                currentResults.forEach(r => {
                    if (thisChain[idx++] >= this.critical) {
                        r.exploded = true;
                        hasCritical = true;
                        crits++;
                    } else {
                        r.exploded = false;
                    }
                });

                // Fumble (only 1s came up): applies on the first chain only
                let chainValue;
                if (isFirstChain && thisChain.length > 0 && thisChain.every(v => v === 1)) {
                    chainValue = 0;
                    this.fumble = true;
                } else {
                    chainValue = hasCritical ? 10 : Math.max(...thisChain);
                }
                this.chainMaxes.push(chainValue);
                totalValue += chainValue;

                // The next chain
                currentDice = crits;
                if (currentDice > 0) {
                    const nextRoll = new foundry.dice.terms.Die({
                        faces: 10,
                        number: currentDice,
                        options: this.options
                    });
                    await nextRoll.evaluate({ minimize, maximize });
                    currentResults = nextRoll.results;
                    this.results.push(...currentResults);
                }
                isFirstChain = false;
            }

            // Store the final result
            this._totalValue = totalValue;
            this._evaluated = true;
            return this;
        }

        /** @inheritdoc */
        get total() {
            if (!this._evaluated) return undefined;
            let total = this._totalValue;
            if (this.options?.modifier) {
                total += this.options.modifier;
            }
            return total;
        }

        /** @override */
        getTooltipData() {
            const rolls = [];
            let resultIdx = 0;
            this.chainRolls.forEach((chain, idx) => {
                chain.forEach((result, i) => {
                    const r = this.results[resultIdx++];
                    const classes = ["dice"];
                    let resultDisplay = result;
                    
                    // Apply the styles to the HTML directly
                    if (result === 1) {
                        // Fumble (red, no strikethrough)
                        resultDisplay = `<span style="color: #d32f2f; text-shadow: none;">${result}</span>`;
                        classes.push("fumble");
                    } else if (r.exploded) {
                        // Critical (green)
                        resultDisplay = `<span style="color: #2e7d32; text-shadow: none;">${result}</span>`;
                        classes.push("exploded");
                    }
                    
                    rolls.push({
                        result: resultDisplay,
                        classes: classes.join(" ")
                    });
                });
                // A chain's result sits to the right of that chain's dice, on the same line (floated right).
                // A zero-height separator line then pushes the next chain down and draws the rule —
                // drawing it with an <hr> would double up with the border-bottom and widen the spacing too.
                rolls.push({
                    result: `${this.chainMaxes[idx]}`,
                    classes: "dx3rd-chain-total"
                });
                rolls.push({
                    result: "",
                    classes: "dx3rd-chain-break"
                });
            });
            rolls.push({
                result: `주사위 합계: ${this.total}`,
                classes: "clear"
            });
            return {
                formula: this.expression,
                total: this.total,
                faces: this.faces,
                flavor: this.flavor,
                rolls: rolls
            };
        }

        /** @override */
        static fromParseNode(node) {
            if (typeof node === 'string') {
                const match = this.matchTerm(node);
                if (match) {
                    return this.fromMatch(match);
                }
                return undefined;
            }

            if (node.type === 'dice' || node.type === 'term') {

                if (node.formula) {
                    const match = this.matchTerm(node.formula);
                    if (match) {
                        const diceCount = parseInt(match.groups.number);
                        const criticalValue = match.groups.crit ? parseInt(match.groups.crit) : (game.settings.get("dx3rd-emanim", "defaultCritical") || 10);
                        const modifier = match.groups.mod ? parseInt(match.groups.mod) : 0;
                        const term = new this({
                            number: diceCount,
                            faces: 10,
                            modifiers: [criticalValue],
                            options: {
                                modifier: modifier,
                                flavor: node.flavor
                            }
                        });
                        // Restore the result data when present
                        if (node.results) {
                            term.results = node.results.map(r => ({ ...r, active: true }));
                            term._evaluated = true;
                        }
                        return term;
                    }
                }

                // Extract the data straight from the AST node
                if (node.number) {
                    // Check the 'dx' pattern
                    const isDX = node.denomination === 'dx' ||
                        node.faces === 'x' ||
                        (typeof node.faces === 'string' && node.faces.startsWith('x'));

                    if (isDX) {
                        // Handle the modifiers
                        let diceCount = node.number ?? 1;
                        let criticalValue = game.settings.get("dx3rd-emanim", "defaultCritical") || 10;
                        if (node.modifiers) {
                            if (typeof node.modifiers === 'string') {
                                criticalValue = parseInt(node.modifiers);
                            } else if (Array.isArray(node.modifiers)) {
                                criticalValue = parseInt(node.modifiers[0]);
                            }
                        }
                        const modifier = node.modifier ?? 0;

                        const term = new this({
                            number: diceCount,
                            faces: 10,
                            modifiers: [criticalValue],
                            options: {
                                modifier: modifier,
                                flavor: node.flavor
                            }
                        });

                        // Restore the result data when present
                        if (node.results) {
                            term.results = node.results.map(r => ({
                                ...r,
                                active: true
                            }));
                            term._evaluated = true;
                        }

                        return term;
                    }
                }
            }

            // Handle a data object
            if (typeof node === 'object') {

                // Handle Foundry VTT 13's AST node format
                const isDXTerm = node.class === this.name ||
                    node.term === this.name ||
                    node.denomination === this.DENOMINATION ||
                    (node.faces === 'x' && node.number);

                if (isDXTerm) {
                    // With a formula present, parse it with matchTerm to extract the modifier
                    let diceCount = node.number ?? 1;
                    let criticalValue = game.settings.get("dx3rd-emanim", "defaultCritical") || 10;
                    let modifier = 0;
                    if (node.formula) {
                        const match = this.matchTerm(node.formula);
                        if (match) {
                            diceCount = parseInt(match.groups.number);
                            criticalValue = match.groups.crit ? parseInt(match.groups.crit) : (game.settings.get("dx3rd-emanim", "defaultCritical") || 10);
                            modifier = match.groups.mod ? parseInt(match.groups.mod) : 0;
                        }
                    } else {
                        if (node.modifiers) {
                            if (typeof node.modifiers === 'string') {
                                criticalValue = parseInt(node.modifiers);
                            } else if (Array.isArray(node.modifiers)) {
                                criticalValue = parseInt(node.modifiers[0]);
                            }
                        }
                        modifier = node.modifier ?? 0;
                    }

                    const term = new this({
                        number: diceCount,
                        faces: 10,
                        modifiers: [criticalValue],
                        options: {
                            modifier: modifier,
                            flavor: node.flavor
                        }
                    });

                    // Restore the result data when present
                    if (node.results) {
                        term.results = node.results.map(r => ({
                            ...r,
                            active: true
                        }));
                        term._evaluated = true;
                    }

                    return term;
                }
            }

            return undefined;
        }

        /** @override */
        static matchTerm(formula) {
            const match = formula.match(this.REGEXP);

            if (!match) return null;

            // Is this the 'dx' pattern?
            if (!match[0].includes('dx')) {
                return null;
            }

            return match;
        }

        /** @override */
        static fromMatch(match) {
            if (!match?.groups) return undefined;
            const modifiers = [];
            if (match.groups.crit) {
                modifiers.push(parseInt(match.groups.crit));
            }
            const term = new this({
                number: parseInt(match.groups.number),
                faces: 10,
                modifiers: modifiers,
                options: {
                    modifier: match.groups.mod ? parseInt(match.groups.mod) : 0
                }
            });
            return term;
        }

        /** @override */
        static fromData(data) {
            const term = new this({
                number: data.number,
                faces: 10,
                modifiers: [data.critical ?? (game.settings.get("dx3rd-emanim", "defaultCritical") || 10)],
                options: data.options
            });
            if (data.results) {
                term.results = data.results.map(r => ({ ...r, active: true }));
            }
            term.chainRolls = data.chainRolls ?? [];
            term.chainMaxes = data.chainMaxes ?? [];
            term._totalValue = data._totalValue ?? 0;
            term._evaluated = true;
            return term;
        }

        /** @override */
        toJSON() {
            const data = super.toJSON();
            data.class = this.constructor.name;
            data.critical = this.critical;
            data.chainRolls = this.chainRolls;
            data.chainMaxes = this.chainMaxes;
            data._totalValue = this._totalValue;
            data.results = this.results.map(r => ({
                ...r,
                active: true
            }));
            return data;
        }
    }

    // The DS3rdDiceTerm class
    class DS3rdDiceTerm extends foundry.dice.terms.Die {
        /** @override */
        constructor(termData = {}) {
            super(termData);
            this.faces = 10;  // always ten-sided
            this.overflowCount = 0;  // the number of overflow dice
            this.removeOverflow = 0;  // how many overflow dice to remove
            this.autoRemoveOverflow = false;  // whether overflow dice are removed automatically
            this.removedDiceIndices = [];  // the indices of the removed dice
            
            // The chain-roll data
            this.chainRolls = [];  // the dice rolled in each chain
            this.chainValues = [];  // the sum of each chain
        }

        /** @inheritdoc */
        static get name() { return "DS3rdDiceTerm"; }

        /** @inheritdoc */
        static get DENOMINATION() { return "ds"; }

        /** @inheritdoc */
        static get REGEXP() {
            // Recognize the 'ds' pattern directly (the dice-removal syntax included)
            return /(?<number>\d+)ds(?:\[(?<remove>[da,\d\s]+)\])?(?<mod>[+-]\d+)?/i;
        }

        /** @inheritdoc */
        static get SERIALIZE_ATTRIBUTES() {
            return ["faces", "number", "options", "results", "_totalValue", "overflowCount", "removeOverflow", "autoRemoveOverflow", "actualRemovedCount", "removedDiceIndices", "chainRolls", "chainValues"];
        }

        /** @override */
        get expression() {
            let expr = `${this.number}ds`;
            
            // Show the removal option combination
            const removeOptions = [];
            if (this.removeOverflow > 0) {
                removeOptions.push(this.removeOverflow.toString());
            }
            if (this.autoRemoveOverflow) {
                removeOptions.push('a');
            }
            
            if (removeOptions.length > 0) {
                expr += `[${removeOptions.join(', ')}]`;
            }
            
            if (this.options?.modifier) {
                expr += (this.options.modifier > 0 ? "+" : "") + this.options.modifier;
            }
            return expr;
        }

        /** @override */
        _evaluateModifiers() {
            // A DS die skips the default modifier handling
            return this;
        }

        /** Parse the removal options */
        static parseRemoveOptions(removeValue, term) {
            // Parse the comma-separated values
            const options = removeValue.split(',').map(opt => opt.trim());
            
            let removeOverflow = 0;
            let autoRemoveOverflow = false;
            
            for (const option of options) {
                if (option === 'a') {
                    autoRemoveOverflow = true;
                } else if (option && !isNaN(parseInt(option))) {
                    removeOverflow += parseInt(option);
                }
            }
            
            // Set them on the term object
            if (term) {
                term.removeOverflow = removeOverflow;
                term.autoRemoveOverflow = autoRemoveOverflow;
            }
            
            return { removeOverflow, autoRemoveOverflow };
        }

        /** @override */
        async evaluate({ minimize = false, maximize = false } = {}) {
            if (this.number > 999) {
                throw new Error("주사위 개수는 999개를 넘을 수 없습니다.");
            }

            // Perform the base Die evaluation
            await super.evaluate({ minimize, maximize });

            // Store the overflow-dice removal settings
            this.removeOverflowCount = this.removeOverflow;

            // Handle the overflow
            this.overflowCount = 0;
            this.chainRolls = [];
            this.chainValues = [];
            let currentDice = this.number;
            let currentResults = [...this.results];
            let totalValue = 0;  // the running value for the final sum
            let allOverflowDice = [];  // every overflow die collected

            // Handle every overflow first, collecting the overflow dice
            while (currentDice > 0) {
                let thisRoll = currentResults.map(r => r.result);
                
                // Store this chain's dice results
                this.chainRolls.push(thisRoll);
                
                // Sum every die value of this roll
                let rollValue = thisRoll.reduce((sum, value) => sum + value, 0);
                this.chainValues.push(rollValue);
                totalValue += rollValue;

                // Count the overflow dice (how many came up 10)
                let overflowDice = thisRoll.filter(value => value === 10).length;
                this.overflowCount += overflowDice;

                // Collect the overflow dice
                for (let i = 0; i < overflowDice; i++) {
                    allOverflowDice.push(10);
                }

                // Roll the next overflow dice
                currentDice = overflowDice;
                if (currentDice > 0) {
                    const nextRoll = new foundry.dice.terms.Die({
                        faces: 10,
                        number: currentDice,
                        options: this.options
                    });
                    await nextRoll.evaluate({ minimize, maximize });
                    currentResults = nextRoll.results;
                    this.results.push(...currentResults);
                }
            }

            // Handle the dice removal
            let totalRemoveCount = this.removeOverflowCount;

            // Manual removal runs first
            if (totalRemoveCount > 0) {
                // Remove from every die
                const allDice = this.results.map(r => r.result);
                const removeCount = Math.min(totalRemoveCount, allDice.length);
                
                // Show the interactive dialog (choosing from every die)
                const selectedIndices = await this.showRemoveDialog(allDice, removeCount, { onlyOverflow: false });
                
                if (selectedIndices !== null) {
                    // Subtract the chosen dice's values from the total
                    let removedOverflowCount = 0; // how many overflow dice were removed
                    for (let i = 0; i < selectedIndices.length; i++) {
                        const diceValue = allDice[selectedIndices[i]];
                        totalValue -= diceValue;
                        // Was the removed die an overflow die (a 10)?
                        if (diceValue === 10) {
                            removedOverflowCount++;
                        }
                    }
                    // Subtract the removed overflow dice from the total overflow count
                    this.overflowCount -= removedOverflowCount;
                    
                    // Add the manual removal indices to removedDiceIndices
                    this.removedDiceIndices = selectedIndices;
                    this.actualRemovedCount = selectedIndices.length;
                } else {
                    // Cancelled — removedDiceIndices is NOT reset (an automatic removal may still follow)
                    this.actualRemovedCount = 0;
                }
            } else {
                this.actualRemovedCount = 0;
            }

            // Handle the automatic removal option (only when overflow dice remain after the manual removal)
            if (this.autoRemoveOverflow && this.overflowCount > 0) {
                // Guarantee the UI timing: deferred to the next tick, right after the previous dialog closes, then shown
                await new Promise((r)=>setTimeout(r, 30));
                // Show the picker at once with no confirmation (only a 10 is selectable, one of them), reflecting the previous choice
                totalValue = await this.removeOverflowDiceAutomatically(totalValue, {
                    disabledIndices: this.removedDiceIndices || [],
                    baseTotal: totalValue
                });
            }

            // Store the final sum
            this._totalValue = totalValue;
            this._evaluated = true;
            return this;
        }

        /** @inheritdoc */
        get total() {
            if (!this._evaluated) return undefined;
            let total = this._totalValue;
            if (this.options?.modifier) {
                total += this.options.modifier;
            }
            return total;
        }

        /** Remove the overflow dice automatically */
        async removeOverflowDiceAutomatically(totalValue, dialogOptions = {}) {
            const allDice = this.results.map(r => r.result);
            const overflowIndices = allDice.map((v, i) => v === 10 ? i : -1).filter(i => i !== -1);
            if (overflowIndices.length === 0) return totalValue;

            // Use the same UI: show every die but allow only a 10 to be chosen (at most one)
            let chosenOriginalIndex = overflowIndices[0];
            if (typeof window.SpellDiceRemoveDialog !== 'undefined') {
                const selected = await new Promise((resolve) => {
                    const dialog = new window.SpellDiceRemoveDialog(allDice, 1, resolve, { onlyOverflow: true, disabledIndices: dialogOptions.disabledIndices, baseTotal: dialogOptions.baseTotal });
                    dialog.render();
                });
                if (selected && selected.length > 0) {
                    chosenOriginalIndex = selected[0];
                } else {
                    // Nothing is removed when the choice is cancelled
                    return totalValue;
                }
            } else {
                // Fallback: on confirmation, remove the first 10
                const ok = await foundry.applications.api.DialogV2.confirm({
                    window: { title: game.i18n.localize("DX3rd.RemoveOverflow") },
                    content: `<p>폭주 주사위(10) ${overflowIndices.length}개 중 1개를 제거하시겠습니까?</p>`,
                    no: { default: true },
                    rejectClose: false
                });
                if (!ok) return totalValue;
            }

            const removedValue = allDice[chosenOriginalIndex];
            totalValue -= removedValue;

            if (!this.removedDiceIndices) this.removedDiceIndices = [];
            this.removedDiceIndices.push(chosenOriginalIndex);
            this.actualRemovedCount = this.removedDiceIndices.length;
            this.overflowCount = Math.max(0, this.overflowCount - 1);

            return totalValue;
        }

        /** Show the dice-removal dialog */
        async showRemoveDialog(allDice, maxRemove, options = {}) {
            return new Promise((resolve) => {
                // Is the SpellDiceRemoveDialog class loaded?
                if (typeof window.SpellDiceRemoveDialog === 'undefined') {
                    // With no such class, use a simple confirmation dialog
                    const confirmMessage = game.i18n.format("DX3rd.RemoveOverflowConfirm", { count: maxRemove });
                    foundry.applications.api.DialogV2.confirm({
                        window: { title: game.i18n.localize("DX3rd.RemoveOverflow") },
                        content: `<p>${confirmMessage}</p><p>주사위: ${allDice.join(', ')}</p>`,
                        no: { default: true },
                        rejectClose: false
                    }).then(ok => resolve(ok ? Array.from({length: maxRemove}, (_, i) => i) : null));
                    return;
                }

                // Show the interactive dialog
                const dialog = new window.SpellDiceRemoveDialog(allDice, maxRemove, resolve, options);
                dialog.render();
            });
        }

        /** @override */
        getTooltipData() {
            const rolls = [];
            let resultIdx = 0;
            
            // Track the removed dice indices (the dice chosen in the dialog)
            const removedIndices = this.removedDiceIndices || [];
            
            // Show the dice results per chain
            this.chainRolls.forEach((chain, idx) => {
                chain.forEach((result, i) => {
                    const r = this.results[resultIdx++];
                    const isRemoved = removedIndices.includes(resultIdx - 1);
                    const isOverflow = result === 10;
                    
                    let classes = ["dice"];
                    let resultDisplay = result;
                    
                    // Apply the styles to the HTML directly
                    if (isRemoved) {
                        // A removed die (red, struck through) — regardless of whether it overflowed
                        resultDisplay = `<span style="color: #d32f2f; text-decoration: line-through; opacity: 0.7; text-shadow: none;">${result}</span>`;
                        classes.push("exploded");
                    } else if (isOverflow) {
                        // An overflow die that was not removed (green)
                        resultDisplay = `<span style="color: #2e7d32; text-shadow: none;">${result}</span>`;
                        classes.push("fumble");
                    }
                    
                    rolls.push({
                        result: resultDisplay,
                        classes: classes.join(" ")
                    });
                });
                // The chain separator and the chain's sum (to the right on the same line + a zero-height separator line)
                rolls.push({
                    result: `${this.chainValues[idx]}`,
                    classes: "dx3rd-chain-total"
                });
                rolls.push({
                    result: "",
                    classes: "dx3rd-chain-break"
                });
            });

            // Add the final sum information
            let resultText = `${game.i18n.localize("DX3rd.DiceSum")}: ${this.total}`;
            if (this.overflowCount > 0) {
                resultText += ` (${game.i18n.localize("DX3rd.Overflow")}: ${this.overflowCount}개)`;
            }
            rolls.push({
                result: resultText,
                classes: "clear"
            });

            return {
                formula: this.expression,
                total: this.total,
                faces: this.faces,
                flavor: this.flavor,
                rolls: rolls
            };
        }

        /** @override */
        static fromParseNode(node) {
            if (typeof node === 'string') {
                const match = this.matchTerm(node);
                if (match) {
                    return this.fromMatch(match);
                }
                return undefined;
            }

            if (node.type === 'dice' || node.type === 'term') {
                if (node.formula) {
                    const match = this.matchTerm(node.formula);
                    if (match) {
                        const diceCount = parseInt(match.groups.number);
                        const modifier = match.groups.mod ? parseInt(match.groups.mod) : 0;
                        const term = new this({
                            number: diceCount,
                            faces: 10,
                            options: {
                                modifier: modifier,
                                flavor: node.flavor
                            }
                        });
                        
                        // Add the removeOverflow and autoRemoveOverflow settings
                        const removeValue = match.groups.remove;
                        if (removeValue) {
                            this.parseRemoveOptions(removeValue, term);
                        } else {
                            term.removeOverflow = 0;
                            term.autoRemoveOverflow = false;
                        }
                        
                        // Restore the result data when present
                        if (node.results) {
                            term.results = node.results.map(r => ({ ...r, active: true }));
                            term._evaluated = true;
                        }
                        return term;
                    }
                }

                // Extract the data straight from the AST node
                if (node.number) {
                    // Check the 'ds' pattern
                    const isDS = node.denomination === 'ds' ||
                        node.faces === 's' ||
                        (typeof node.faces === 'string' && node.faces.startsWith('s'));

                    if (isDS) {
                        let diceCount = node.number ?? 1;
                        const modifier = node.modifier ?? 0;

                        const term = new this({
                            number: diceCount,
                            faces: 10,
                            options: {
                                modifier: modifier,
                                flavor: node.flavor
                            }
                        });

                        // Add the removeOverflow and autoRemoveOverflow settings
                        const removeValue = match.groups.remove;
                        if (removeValue) {
                            this.parseRemoveOptions(removeValue, term);
                        } else {
                            term.removeOverflow = 0;
                            term.autoRemoveOverflow = false;
                        }

                        // Restore the result data when present
                        if (node.results) {
                            term.results = node.results.map(r => ({
                                ...r,
                                active: true
                            }));
                            term._evaluated = true;
                        }

                        return term;
                    }
                }
            }

            // Handle a data object
            if (typeof node === 'object') {
                // Handle Foundry VTT 13's AST node format
                const isDSTerm = node.class === this.name ||
                    node.term === this.name ||
                    node.denomination === this.DENOMINATION ||
                    (node.faces === 's' && node.number);

                if (isDSTerm) {
                    let diceCount = node.number ?? 1;
                    let modifier = 0;
                    let removeOverflow = 0;
                    let autoRemoveOverflow = false;
                    
                    if (node.formula) {
                        const match = this.matchTerm(node.formula);
                        if (match) {
                            diceCount = parseInt(match.groups.number);
                            modifier = match.groups.mod ? parseInt(match.groups.mod) : 0;
                            
                            // The removeOverflow and autoRemoveOverflow settings
                            const removeValue = match.groups.remove;
                            if (removeValue) {
                                const parsed = this.parseRemoveOptions(removeValue);
                                removeOverflow = parsed.removeOverflow;
                                autoRemoveOverflow = parsed.autoRemoveOverflow;
                            } else {
                                removeOverflow = 0;
                                autoRemoveOverflow = false;
                            }
                        }
                    } else {
                        modifier = node.modifier ?? 0;
                    }

                    const term = new this({
                        number: diceCount,
                        faces: 10,
                        options: {
                            modifier: modifier,
                            flavor: node.flavor
                        }
                    });

                    // The removeOverflow and autoRemoveOverflow settings
                    term.removeOverflow = removeOverflow;
                    term.autoRemoveOverflow = autoRemoveOverflow;

                    // Restore the result data when present
                    if (node.results) {
                        term.results = node.results.map(r => ({
                            ...r,
                            active: true
                        }));
                        term._evaluated = true;
                    }

                    return term;
                }
            }

            return undefined;
        }

        /** @override */
        static matchTerm(formula) {
            const match = formula.match(this.REGEXP);
            if (!match) return null;

            // Is this the 'ds' pattern?
            if (!match[0].includes('ds')) {
                return null;
            }

            return match;
        }

        /** @override */
        static fromMatch(match) {
            if (!match?.groups) return undefined;
            
            const term = new this({
                number: parseInt(match.groups.number),
                faces: 10,
                options: {
                    modifier: match.groups.mod ? parseInt(match.groups.mod) : 0
                }
            });
            
            // Add the removeOverflow and autoRemoveOverflow settings
            const removeValue = match.groups.remove;
            if (removeValue) {
                this.parseRemoveOptions(removeValue, term);
            } else {
                term.removeOverflow = 0;
                term.autoRemoveOverflow = false;
            }
            
            return term;
        }

        /** @override */
        static fromData(data) {
            const term = new this({
                number: data.number,
                faces: 10,
                options: data.options
            });
            if (data.results) {
                term.results = data.results.map(r => ({ ...r, active: true }));
            }
            term.overflowCount = data.overflowCount ?? 0;
            term.removeOverflow = data.removeOverflow ?? 0;
            term.autoRemoveOverflow = data.autoRemoveOverflow ?? false;
            term.actualRemovedCount = data.actualRemovedCount ?? 0;
            term.removedDiceIndices = data.removedDiceIndices ?? [];
            term.chainRolls = data.chainRolls ?? [];
            term.chainValues = data.chainValues ?? [];
            term._totalValue = data._totalValue ?? 0;
            term._evaluated = true;
            return term;
        }

        /** @override */
        toJSON() {
            const data = super.toJSON();
            data.class = this.constructor.name;
            data.overflowCount = this.overflowCount;
            data.removeOverflow = this.removeOverflow;
            data.autoRemoveOverflow = this.autoRemoveOverflow;
            data.actualRemovedCount = this.actualRemovedCount;
            data.removedDiceIndices = this.removedDiceIndices;
            data.chainRolls = this.chainRolls;
            data.chainValues = this.chainValues;
            data._totalValue = this._totalValue;
            data.results = this.results.map(r => ({
                ...r,
                active: true
            }));
            return data;
        }
    }

    // Register the classes once Foundry VTT is ready
    waitForFoundry(() => {
        // Register the classes on the global object
        foundry.dice.terms.DX3rdDiceTerm = DX3rdDiceTerm;
        foundry.dice.terms.DS3rdDiceTerm = DS3rdDiceTerm;

        // Set up CONFIG.Dice.terms
        if (!CONFIG.Dice) CONFIG.Dice = {};
        if (!CONFIG.Dice.terms) CONFIG.Dice.terms = {};

        // Register the DX dice system
        const dxRegistration = {
            name: DX3rdDiceTerm.name,
            class: DX3rdDiceTerm,
            denomination: "dx",
            regexp: DX3rdDiceTerm.REGEXP,
            fromParseNode: DX3rdDiceTerm.fromParseNode.bind(DX3rdDiceTerm)
        };

        // Register the DS dice system
        const dsRegistration = {
            name: DS3rdDiceTerm.name,
            class: DS3rdDiceTerm,
            denomination: "ds",
            regexp: DS3rdDiceTerm.REGEXP,
            fromParseNode: DS3rdDiceTerm.fromParseNode.bind(DS3rdDiceTerm)
        };

        // Register in CONFIG.Dice.terms
        CONFIG.Dice.terms["dx"] = dxRegistration;
        CONFIG.Dice.terms["ds"] = dsRegistration;

        // Register in DiceTerm.REGISTERED_TERMS
        if (foundry.dice.terms.DiceTerm.REGISTERED_TERMS) {
            foundry.dice.terms.DiceTerm.REGISTERED_TERMS["dx"] = dxRegistration;
            foundry.dice.terms.DiceTerm.REGISTERED_TERMS["ds"] = dsRegistration;
        }

        // Register on the RollTerm class
        if (foundry.dice.RollTerm) {
            // Register in RollTerm.CLASSES
            foundry.dice.RollTerm.CLASSES[DX3rdDiceTerm.name] = DX3rdDiceTerm;
            foundry.dice.RollTerm.CLASSES[DS3rdDiceTerm.name] = DS3rdDiceTerm;

            // Override the RollTerm.fromData method
            const originalFromData = foundry.dice.RollTerm.fromData;
            foundry.dice.RollTerm.fromData = function (data) {
                if (data.class === DX3rdDiceTerm.name) {
                    return DX3rdDiceTerm.fromData(data);
                }
                if (data.class === DS3rdDiceTerm.name) {
                    return DS3rdDiceTerm.fromData(data);
                }
                return originalFromData.call(this, data);
            };

            // Override the RollTerm._fromData method
            const originalFromDataInternal = foundry.dice.RollTerm._fromData;
            foundry.dice.RollTerm._fromData = function (data) {
                if (data.class === DX3rdDiceTerm.name) {
                    return DX3rdDiceTerm.fromData(data);
                }
                if (data.class === DS3rdDiceTerm.name) {
                    return DS3rdDiceTerm.fromData(data);
                }
                return originalFromDataInternal.call(this, data);
            };
        }

        // Register on the Roll class
        if (foundry.dice.Roll) {
            // Override the Roll.fromData method
            const originalRollFromData = foundry.dice.Roll.fromData;
            foundry.dice.Roll.fromData = function (data) {
                if (data.terms) {
                    data.terms = data.terms.map(term => {
                        if (term.class === DX3rdDiceTerm.name) {
                            return DX3rdDiceTerm.fromData(term);
                        }
                        if (term.class === DS3rdDiceTerm.name) {
                            return DS3rdDiceTerm.fromData(term);
                        }
                        return term;
                    });
                }
                return originalRollFromData.call(this, data);
            };
        }

        // Confirm the registration
        if (foundry.dice.terms.DX3rdDiceTerm === DX3rdDiceTerm &&
            foundry.dice.terms.DS3rdDiceTerm === DS3rdDiceTerm &&
            CONFIG.Dice.terms["dx"]?.class === DX3rdDiceTerm &&
            CONFIG.Dice.terms["ds"]?.class === DS3rdDiceTerm) {
        }
    });

    // Extend the DiceTerm class
    if (foundry.dice.terms.DiceTerm) {
        const originalFromParseNode = foundry.dice.terms.DiceTerm.fromParseNode;
        foundry.dice.terms.DiceTerm.fromParseNode = function (node) {

            // Check the 'dx' pattern
            if (node && typeof node === 'object') {
                if (node.denomination === 'dx' ||
                    (node.formula && node.formula.includes('dx'))) {
                    return DX3rdDiceTerm.fromParseNode(node);
                }
            }

            // Check the 'ds' pattern
            if (node && typeof node === 'object') {
                if (node.denomination === 'ds' ||
                    (node.formula && node.formula.includes('ds'))) {
                    return DS3rdDiceTerm.fromParseNode(node);
                }
            }

            // The default handling
            return originalFromParseNode.call(this, node);
        };
    }
})();