/**
 * 더블크로스 3rd의 특수 주사위 시스템 구현
 */

// 전역 객체에 클래스 정의
(function () {
    // Foundry VTT가 준비될 때까지 대기
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

    // DX3rdDiceTerm 클래스 정의
    class DX3rdDiceTerm extends foundry.dice.terms.Die {
        /** @override */
        constructor(termData = {}) {
            // modifiers를 배열로 변환
            if (typeof termData.modifiers === 'string') {
                termData.modifiers = [parseInt(termData.modifiers)];
            } else if (!Array.isArray(termData.modifiers)) {
                termData.modifiers = [game.settings.get("dx3rd-emanim", "defaultCritical") || 10];  // 기본값
            }

            super(termData);
            this.faces = 10;  // 항상 10면체
            this.critical = termData.modifiers[0] ?? (game.settings.get("dx3rd-emanim", "defaultCritical") || 10);
            if (this.critical < 2) this.critical = 2;  // 최소 크리티컬 값은 2

            // 체인 롤 관련 데이터
            this.chainRolls = [];  // 체인별 주사위 굴림 결과
            this.chainMaxes = [];  // 체인별 최대값
        }

        /** @inheritdoc */
        static get name() { return "DX3rdDiceTerm"; }

        /** @inheritdoc */
        static get DENOMINATION() { return "dx"; }

        /** @inheritdoc */
        static get REGEXP() {
            // 'dx' 패턴을 직접 인식
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
            // DX 주사위는 기본 modifiers 처리를 건너뜁니다
            return this;
        }

        /** @override */
        async evaluate({ minimize = false, maximize = false, async = true } = {}) {
            if (this.number > 999) {
                throw new Error("주사위 개수는 999개를 넘을 수 없습니다.");
            }

            // 기본 Die 평가 수행
            await super.evaluate({ minimize, maximize, async });

            // 체인 롤 처리
            this.chainRolls = [];
            this.chainMaxes = [];
            let currentDice = this.number;
            let currentResults = [...this.results];
            let totalValue = 0;  // 최종 달성치를 위한 누적값
            let isFirstChain = true;
            this.fumble = false; // 펌블(최초 굴림 전부 1) 여부 — 핸들러가 자동실패/달성치 0 처리에 사용

            while (currentDice > 0) {
                let thisChain = currentResults.map(r => r.result);
                this.chainRolls.push(thisChain);

                // 크리티컬 표시 및 톱니 처리
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

                // 펌블(1만 나온 경우) 처리: 최초 체인에서만 적용
                let chainValue;
                if (isFirstChain && thisChain.length > 0 && thisChain.every(v => v === 1)) {
                    chainValue = 0;
                    this.fumble = true;
                } else {
                    chainValue = hasCritical ? 10 : Math.max(...thisChain);
                }
                this.chainMaxes.push(chainValue);
                totalValue += chainValue;

                // 다음 체인
                currentDice = crits;
                if (currentDice > 0) {
                    const nextRoll = new foundry.dice.terms.Die({
                        faces: 10,
                        number: currentDice,
                        options: this.options
                    });
                    await nextRoll.evaluate({ minimize, maximize, async });
                    currentResults = nextRoll.results;
                    this.results.push(...currentResults);
                }
                isFirstChain = false;
            }

            // 최종 달성치 저장
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
                    
                    // 스타일을 직접 HTML에 적용
                    if (result === 1) {
                        // 펌블 (빨간색, 취소선 없음)
                        resultDisplay = `<span style="color: #d32f2f; text-shadow: none;">${result}</span>`;
                        classes.push("fumble");
                    } else if (r.exploded) {
                        // 크리티컬 (녹색)
                        resultDisplay = `<span style="color: #2e7d32; text-shadow: none;">${result}</span>`;
                        classes.push("exploded");
                    }
                    
                    rolls.push({
                        result: resultDisplay,
                        classes: classes.join(" ")
                    });
                });
                rolls.push({
                    result: `${this.chainMaxes[idx]}<hr>`,
                    classes: "clear"
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
                        // 결과 데이터가 있는 경우 복원
                        if (node.results) {
                            term.results = node.results.map(r => ({ ...r, active: true }));
                            term._evaluated = true;
                        }
                        return term;
                    }
                }

                // AST 노드에서 직접 데이터 추출
                if (node.number) {
                    // 'dx' 패턴 확인
                    const isDX = node.denomination === 'dx' ||
                        node.faces === 'x' ||
                        (typeof node.faces === 'string' && node.faces.startsWith('x'));

                    if (isDX) {
                        // modifiers 처리
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

                        // 결과 데이터가 있는 경우 복원
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

            // 데이터 객체 처리
            if (typeof node === 'object') {

                // Foundry VTT 13의 AST 노드 형식 처리
                const isDXTerm = node.class === this.name ||
                    node.term === this.name ||
                    node.denomination === this.DENOMINATION ||
                    (node.faces === 'x' && node.number);

                if (isDXTerm) {
                    // formula가 있으면 matchTerm로 파싱해서 modifier 추출
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

                    // 결과 데이터가 있는 경우 복원
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

            // 'dx' 패턴인지 확인
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

    // DS3rdDiceTerm 클래스 정의
    class DS3rdDiceTerm extends foundry.dice.terms.Die {
        /** @override */
        constructor(termData = {}) {
            super(termData);
            this.faces = 10;  // 항상 10면체
            this.overflowCount = 0;  // 폭주 주사위 개수
            this.removeOverflow = 0;  // 제거할 폭주 주사위 개수
            this.autoRemoveOverflow = false;  // 폭주 주사위 자동 제거 여부
            this.removedDiceIndices = [];  // 제거된 주사위 인덱스들
            
            // 체인 롤 관련 데이터
            this.chainRolls = [];  // 체인별 주사위 굴림 결과
            this.chainValues = [];  // 체인별 합계값
        }

        /** @inheritdoc */
        static get name() { return "DS3rdDiceTerm"; }

        /** @inheritdoc */
        static get DENOMINATION() { return "ds"; }

        /** @inheritdoc */
        static get REGEXP() {
            // 'ds' 패턴을 직접 인식 (주사위 제거 구문 포함)
            return /(?<number>\d+)ds(?:\[(?<remove>[da,\d\s]+)\])?(?<mod>[+-]\d+)?/i;
        }

        /** @inheritdoc */
        static get SERIALIZE_ATTRIBUTES() {
            return ["faces", "number", "options", "results", "_totalValue", "overflowCount", "removeOverflow", "autoRemoveOverflow", "actualRemovedCount", "removedDiceIndices", "chainRolls", "chainValues"];
        }

        /** @override */
        get expression() {
            let expr = `${this.number}ds`;
            
            // 제거 옵션 조합 표시
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
            // DS 주사위는 기본 modifiers 처리를 건너뜁니다
            return this;
        }

        /** 제거 옵션 파싱 */
        static parseRemoveOptions(removeValue, term) {
            // 콤마로 구분된 값들을 파싱
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
            
            // term 객체에 설정
            if (term) {
                term.removeOverflow = removeOverflow;
                term.autoRemoveOverflow = autoRemoveOverflow;
            }
            
            return { removeOverflow, autoRemoveOverflow };
        }

        /** @override */
        async evaluate({ minimize = false, maximize = false, async = true } = {}) {
            if (this.number > 999) {
                throw new Error("주사위 개수는 999개를 넘을 수 없습니다.");
            }

            // 기본 Die 평가 수행
            await super.evaluate({ minimize, maximize, async });

            // 폭주 주사위 제거 설정 저장
            this.removeOverflowCount = this.removeOverflow;

            // 폭주 처리
            this.overflowCount = 0;
            this.chainRolls = [];
            this.chainValues = [];
            let currentDice = this.number;
            let currentResults = [...this.results];
            let totalValue = 0;  // 최종 합계를 위한 누적값
            let allOverflowDice = [];  // 모든 폭주 주사위 수집

            // 먼저 모든 폭주를 처리하여 폭주 주사위 수집
            while (currentDice > 0) {
                let thisRoll = currentResults.map(r => r.result);
                
                // 현재 체인의 주사위 결과 저장
                this.chainRolls.push(thisRoll);
                
                // 현재 굴림의 모든 주사위 값 합산
                let rollValue = thisRoll.reduce((sum, value) => sum + value, 0);
                this.chainValues.push(rollValue);
                totalValue += rollValue;

                // 폭주 주사위 개수 계산 (10이 나온 주사위 개수)
                let overflowDice = thisRoll.filter(value => value === 10).length;
                this.overflowCount += overflowDice;

                // 폭주 주사위 수집
                for (let i = 0; i < overflowDice; i++) {
                    allOverflowDice.push(10);
                }

                // 다음 폭주 주사위 굴림
                currentDice = overflowDice;
                if (currentDice > 0) {
                    const nextRoll = new foundry.dice.terms.Die({
                        faces: 10,
                        number: currentDice,
                        options: this.options
                    });
                    await nextRoll.evaluate({ minimize, maximize, async });
                    currentResults = nextRoll.results;
                    this.results.push(...currentResults);
                }
            }

            // 주사위 제거 처리
            let totalRemoveCount = this.removeOverflowCount;

            // 수동 제거 먼저 실행
            if (totalRemoveCount > 0) {
                // 모든 주사위에서 제거
                const allDice = this.results.map(r => r.result);
                const removeCount = Math.min(totalRemoveCount, allDice.length);
                
                // 인터랙티브 다이얼로그 표시 (모든 주사위에서 선택)
                const selectedIndices = await this.showRemoveDialog(allDice, removeCount, { onlyOverflow: false });
                
                if (selectedIndices !== null) {
                    // 선택된 주사위 값만큼 총합에서 차감
                    let removedOverflowCount = 0; // 제거된 폭주 주사위 개수
                    for (let i = 0; i < selectedIndices.length; i++) {
                        const diceValue = allDice[selectedIndices[i]];
                        totalValue -= diceValue;
                        // 제거된 주사위가 폭주 주사위(10)인지 확인
                        if (diceValue === 10) {
                            removedOverflowCount++;
                        }
                    }
                    // 총 폭주 주사위 개수에서 제거된 폭주 주사위 개수 차감
                    this.overflowCount -= removedOverflowCount;
                    
                    // removedDiceIndices에 수동 제거 인덱스 추가
                    this.removedDiceIndices = selectedIndices;
                    this.actualRemovedCount = selectedIndices.length;
                } else {
                    // 취소된 경우 - removedDiceIndices는 초기화하지 않음 (자동 제거가 있을 수 있음)
                    this.actualRemovedCount = 0;
                }
            } else {
                this.actualRemovedCount = 0;
            }

            // 자동 제거 옵션 처리 (수동 제거 후 남은 폭주 주사위가 있을 때만)
            if (this.autoRemoveOverflow && this.overflowCount > 0) {
                // UI 타이밍 보장: 이전 다이얼로그가 닫힌 직후 다음 틱으로 미룬 뒤 띄움
                await new Promise((r)=>setTimeout(r, 30));
                // 확인 없이 즉시 선택창 표시(10만 선택 가능, 1개), 직전 선택 결과 반영
                totalValue = await this.removeOverflowDiceAutomatically(totalValue, {
                    disabledIndices: this.removedDiceIndices || [],
                    baseTotal: totalValue
                });
            }

            // 최종 합계 저장
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

        /** 폭주 주사위 자동 제거 */
        async removeOverflowDiceAutomatically(totalValue, dialogOptions = {}) {
            const allDice = this.results.map(r => r.result);
            const overflowIndices = allDice.map((v, i) => v === 10 ? i : -1).filter(i => i !== -1);
            if (overflowIndices.length === 0) return totalValue;

            // 같은 UI로 선택하도록: 전체 주사위를 보여주되 10만 선택 가능 (최대 1개)
            let chosenOriginalIndex = overflowIndices[0];
            if (typeof window.SpellDiceRemoveDialog !== 'undefined') {
                const selected = await new Promise((resolve) => {
                    const dialog = new window.SpellDiceRemoveDialog(allDice, 1, resolve, { onlyOverflow: true, disabledIndices: dialogOptions.disabledIndices, baseTotal: dialogOptions.baseTotal });
                    dialog.render();
                });
                if (selected && selected.length > 0) {
                    chosenOriginalIndex = selected[0];
                } else {
                    // 선택 취소 시 아무것도 제거하지 않음
                    return totalValue;
                }
            } else {
                // 폴백: 확인 시 첫 번째 10 제거
                const ok = await new Promise((resolve)=>{
                    Dialog.confirm({
                        title: game.i18n.localize("DX3rd.RemoveOverflow"),
                        content: `<p>폭주 주사위(10) ${overflowIndices.length}개 중 1개를 제거하시겠습니까?</p>`,
                        yes: ()=>resolve(true),
                        no: ()=>resolve(false),
                        defaultYes: false
                    });
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

        /** 주사위 제거 다이얼로그 표시 */
        async showRemoveDialog(allDice, maxRemove, options = {}) {
            return new Promise((resolve) => {
                // SpellDiceRemoveDialog 클래스가 로드되어 있는지 확인
                if (typeof window.SpellDiceRemoveDialog === 'undefined') {
                    // 클래스가 없으면 간단한 확인 다이얼로그 사용
                    const confirmMessage = game.i18n.format("DX3rd.RemoveOverflowConfirm", { count: maxRemove });
                    Dialog.confirm({
                        title: game.i18n.localize("DX3rd.RemoveOverflow"),
                        content: `<p>${confirmMessage}</p><p>주사위: ${allDice.join(', ')}</p>`,
                        yes: () => resolve(Array.from({length: maxRemove}, (_, i) => i)),
                        no: () => resolve(null),
                        defaultYes: false
                    });
                    return;
                }

                // 인터랙티브 다이얼로그 표시
                const dialog = new window.SpellDiceRemoveDialog(allDice, maxRemove, resolve, options);
                dialog.render();
            });
        }

        /** @override */
        getTooltipData() {
            const rolls = [];
            let resultIdx = 0;
            
            // 제거된 주사위 인덱스 추적 (다이얼로그에서 선택된 주사위)
            const removedIndices = this.removedDiceIndices || [];
            
            // 체인별로 주사위 결과 표시
            this.chainRolls.forEach((chain, idx) => {
                chain.forEach((result, i) => {
                    const r = this.results[resultIdx++];
                    const isRemoved = removedIndices.includes(resultIdx - 1);
                    const isOverflow = result === 10;
                    
                    let classes = ["dice"];
                    let resultDisplay = result;
                    
                    // 스타일을 직접 HTML에 적용
                    if (isRemoved) {
                        // 제거된 주사위 (빨간색, 취소선) - 폭주 여부와 관계없이
                        resultDisplay = `<span style="color: #d32f2f; text-decoration: line-through; opacity: 0.7; text-shadow: none;">${result}</span>`;
                        classes.push("exploded");
                    } else if (isOverflow) {
                        // 제거되지 않은 폭주 주사위 (녹색)
                        resultDisplay = `<span style="color: #2e7d32; text-shadow: none;">${result}</span>`;
                        classes.push("fumble");
                    }
                    
                    rolls.push({
                        result: resultDisplay,
                        classes: classes.join(" ")
                    });
                });
                // 체인 구분선과 체인별 합계 표시
                rolls.push({
                    result: `${this.chainValues[idx]}<hr>`,
                    classes: "clear"
                });
            });

            // 최종 합계 정보 추가
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
                        
                        // removeOverflow 및 autoRemoveOverflow 설정 추가
                        const removeValue = match.groups.remove;
                        if (removeValue) {
                            this.parseRemoveOptions(removeValue, term);
                        } else {
                            term.removeOverflow = 0;
                            term.autoRemoveOverflow = false;
                        }
                        
                        // 결과 데이터가 있는 경우 복원
                        if (node.results) {
                            term.results = node.results.map(r => ({ ...r, active: true }));
                            term._evaluated = true;
                        }
                        return term;
                    }
                }

                // AST 노드에서 직접 데이터 추출
                if (node.number) {
                    // 'ds' 패턴 확인
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

                        // removeOverflow 및 autoRemoveOverflow 설정 추가
                        const removeValue = match.groups.remove;
                        if (removeValue) {
                            this.parseRemoveOptions(removeValue, term);
                        } else {
                            term.removeOverflow = 0;
                            term.autoRemoveOverflow = false;
                        }

                        // 결과 데이터가 있는 경우 복원
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

            // 데이터 객체 처리
            if (typeof node === 'object') {
                // Foundry VTT 13의 AST 노드 형식 처리
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
                            
                            // removeOverflow 및 autoRemoveOverflow 설정
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

                    // removeOverflow 및 autoRemoveOverflow 설정
                    term.removeOverflow = removeOverflow;
                    term.autoRemoveOverflow = autoRemoveOverflow;

                    // 결과 데이터가 있는 경우 복원
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

            // 'ds' 패턴인지 확인
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
            
            // removeOverflow 및 autoRemoveOverflow 설정 추가
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

    // Foundry VTT가 준비되면 클래스 등록
    waitForFoundry(() => {
        // 전역 객체에 클래스 등록
        foundry.dice.terms.DX3rdDiceTerm = DX3rdDiceTerm;
        foundry.dice.terms.DS3rdDiceTerm = DS3rdDiceTerm;

        // CONFIG.Dice.terms 설정
        if (!CONFIG.Dice) CONFIG.Dice = {};
        if (!CONFIG.Dice.terms) CONFIG.Dice.terms = {};

        // DX 주사위 시스템 등록
        const dxRegistration = {
            name: DX3rdDiceTerm.name,
            class: DX3rdDiceTerm,
            denomination: "dx",
            regexp: DX3rdDiceTerm.REGEXP,
            fromParseNode: DX3rdDiceTerm.fromParseNode.bind(DX3rdDiceTerm)
        };

        // DS 주사위 시스템 등록
        const dsRegistration = {
            name: DS3rdDiceTerm.name,
            class: DS3rdDiceTerm,
            denomination: "ds",
            regexp: DS3rdDiceTerm.REGEXP,
            fromParseNode: DS3rdDiceTerm.fromParseNode.bind(DS3rdDiceTerm)
        };

        // CONFIG.Dice.terms에 등록
        CONFIG.Dice.terms["dx"] = dxRegistration;
        CONFIG.Dice.terms["ds"] = dsRegistration;

        // DiceTerm.REGISTERED_TERMS에 등록
        if (foundry.dice.terms.DiceTerm.REGISTERED_TERMS) {
            foundry.dice.terms.DiceTerm.REGISTERED_TERMS["dx"] = dxRegistration;
            foundry.dice.terms.DiceTerm.REGISTERED_TERMS["ds"] = dsRegistration;
        }

        // RollTerm 클래스에 등록
        if (foundry.dice.RollTerm) {
            // RollTerm.CLASSES에 등록
            foundry.dice.RollTerm.CLASSES[DX3rdDiceTerm.name] = DX3rdDiceTerm;
            foundry.dice.RollTerm.CLASSES[DS3rdDiceTerm.name] = DS3rdDiceTerm;

            // RollTerm.fromData 메서드 오버라이드
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

            // RollTerm._fromData 메서드 오버라이드
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

        // Roll 클래스에 등록
        if (foundry.dice.Roll) {
            // Roll.fromData 메서드 오버라이드
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

        // 등록 확인
        if (foundry.dice.terms.DX3rdDiceTerm === DX3rdDiceTerm &&
            foundry.dice.terms.DS3rdDiceTerm === DS3rdDiceTerm &&
            CONFIG.Dice.terms["dx"]?.class === DX3rdDiceTerm &&
            CONFIG.Dice.terms["ds"]?.class === DS3rdDiceTerm) {
        }
    });

    // DiceTerm 클래스 확장
    if (foundry.dice.terms.DiceTerm) {
        const originalFromParseNode = foundry.dice.terms.DiceTerm.fromParseNode;
        foundry.dice.terms.DiceTerm.fromParseNode = function (node) {

            // 'dx' 패턴 확인
            if (node && typeof node === 'object') {
                if (node.denomination === 'dx' ||
                    (node.formula && node.formula.includes('dx'))) {
                    return DX3rdDiceTerm.fromParseNode(node);
                }
            }

            // 'ds' 패턴 확인
            if (node && typeof node === 'object') {
                if (node.denomination === 'ds' ||
                    (node.formula && node.formula.includes('ds'))) {
                    return DS3rdDiceTerm.fromParseNode(node);
                }
            }

            // 기본 처리
            return originalFromParseNode.call(this, node);
        };
    }
})();