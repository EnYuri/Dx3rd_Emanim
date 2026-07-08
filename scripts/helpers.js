// v13/v14 호환: 레거시 대화상자 글로벌 보강
(function() {
    const legacyDialogName = 'Dia' + 'log';
    if (!window[legacyDialogName]) {
        window[legacyDialogName] = foundry.appv1?.applications?.[legacyDialogName];
    }
})();

// Handlebars 헬퍼 함수들
(function() {
    const fixedOrder = {
        body: ["melee", "evade"],
        sense: ["ranged", "perception"],
        mind: ["rc", "will", "cthulhu"],
        social: ["negotiation", "procure"]
    };

    // 수식 평가 함수 (안전한 계산)
    window.DX3rdFormulaEvaluator = {
        // 순환 참조 검증 함수
        validateCircularReference: function(formula, label, actor = null, attributeType = null) {
            if (!formula || !label) return { valid: true };
            
            // stat_add와 stat_dice는 순환 참조가 발생하지 않으므로 검증 스킵
            if (attributeType === 'stat_add' || attributeType === 'stat_dice') {
                return { valid: true };
            }
            
            const formulaStr = String(formula).trim();
            const labelLower = label.toLowerCase();
            
            // 기본 능력치 체크
            const abilities = {
                'body': game.i18n.localize('DX3rd.Body'),
                'sense': game.i18n.localize('DX3rd.Sense'),
                'mind': game.i18n.localize('DX3rd.Mind'),
                'social': game.i18n.localize('DX3rd.Social')
            };
            
            // Label이 능력치인 경우
            for (const [key, localizedName] of Object.entries(abilities)) {
                if (labelLower === key) {
                    // [body] 또는 [육체] 패턴 확인
                    const keyPattern = new RegExp(`\\[${key}\\]`, 'i');
                    const namePattern = new RegExp(`\\[${this.escapeRegex(localizedName)}\\]`, 'i');
                    
                    if (keyPattern.test(formulaStr) || namePattern.test(formulaStr)) {
                        return { 
                            valid: false, 
                            message: `순환 참조 방지: [${key}] 또는 [${localizedName}]을(를) 참조할 수 없습니다.`
                        };
                    }
                }
            }
            
            // Label이 스킬인 경우 (기본 스킬 + 액터의 커스텀 스킬)
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
            
            // 기본 스킬 체크
            for (const [key, localizedName] of Object.entries(defaultSkills)) {
                if (labelLower === key) {
                    const keyPattern = new RegExp(`\\[${this.escapeRegex(key)}\\]`, 'i');
                    const namePattern = new RegExp(`\\[${this.escapeRegex(localizedName)}\\]`, 'i');
                    
                    if (keyPattern.test(formulaStr) || namePattern.test(formulaStr)) {
                        return { 
                            valid: false, 
                            message: `순환 참조 방지: [${key}] 또는 [${localizedName}]을(를) 참조할 수 없습니다.`
                        };
                    }
                }
            }
            
            // 액터가 있으면 커스텀 스킬도 체크
            if (actor && actor.system?.attributes?.skills) {
                const skills = actor.system.attributes.skills;
                const labelSkill = skills[label] || skills[labelLower];
                
                if (labelSkill) {
                    // 키로 참조 차단
                    const keyPattern = new RegExp(`\\[${this.escapeRegex(label)}\\]`, 'i');
                    if (keyPattern.test(formulaStr)) {
                        return { 
                            valid: false, 
                            message: `순환 참조 방지: [${label}]을(를) 참조할 수 없습니다.`
                        };
                    }
                    
                    // 이름으로 참조 차단
                    if (labelSkill.name) {
                        let skillName = labelSkill.name;
                        if (skillName.startsWith('DX3rd.')) {
                            skillName = game.i18n.localize(skillName);
                        }
                        const namePattern = new RegExp(`\\[${this.escapeRegex(skillName)}\\]`, 'i');
                        if (namePattern.test(formulaStr)) {
                            return { 
                                valid: false, 
                                message: `순환 참조 방지: [${skillName}]을(를) 참조할 수 없습니다.`
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
            
            // 이미 숫자인 경우
            if (typeof formula === 'number') {
                return formula;
            }
            
            // boolean 값인 경우 (true/false는 평가하지 않음, 플래그로 사용되므로 0 반환)
            if (typeof formula === 'boolean') {
                return 0;
            }
            
            let formulaStr = String(formula).trim();

            // 빈 문자열
            if (formulaStr === '' || formulaStr === '-') {
                return 0;
            }

            // 곱셈/나눗셈 기호 정규화 (다단 연산식 지원: [20-(LV×5)], [침식÷10] 등)
            formulaStr = formulaStr.replace(/×/g, '*').replace(/÷/g, '/');

            // 참조 치환 ([Lv], [level], [레벨], [body], [육체], [melee], [백병] 등)
            if (item || actor) {
                formulaStr = this.replaceReferences(formulaStr, item, actor);
            }
            
            // 단순 숫자인 경우
            const simpleNumber = Number(formulaStr);
            if (!isNaN(simpleNumber)) {
                return simpleNumber;
            }
            
            // min/max 함수 지원 (cap 표현: min(0, -[20-(LV×5)]) / max(0, …) 등)
            const evalStr = formulaStr.replace(/\bmin\s*\(/gi, 'Math.min(').replace(/\bmax\s*\(/gi, 'Math.max(');

            // 수식 평가 (안전한 문자만 허용). Math.min/Math.max만 화이트리스트(쉼표=함수 인자 구분).
            const stripped = evalStr.replace(/Math\.(?:min|max)/g, '');
            if (/[^0-9+\-*/(),.\s]/.test(stripped)) {
                // boolean 값 "true"/"false" 문자열은 경고하지 않음
                if (formulaStr !== 'true' && formulaStr !== 'false') {
                    console.warn(`DX3rd | Invalid characters in formula: ${formulaStr}`);
                }
                return 0;
            }

            try {
                // Function 생성자를 사용한 안전한 평가
                const result = new Function(`return ${evalStr}`)();
                if (isNaN(result) || !isFinite(result)) {
                    console.warn(`DX3rd | Formula evaluation resulted in invalid number: ${formulaStr}`);
                    return 0;
                }
                return Math.floor(result); // 정수로 변환
            } catch (error) {
                console.warn(`DX3rd | Formula evaluation error: ${formulaStr}`, error);
                return 0;
            }
        },
        
        replaceReferences: function(formulaStr, item, actor) {
            // 곱셈/나눗셈 기호 정규화 (직접 호출 경로에서도 다단식 지원)
            let result = String(formulaStr).replace(/×/g, '*').replace(/÷/g, '/');

            // 0) [count:이름] / [개수:이름] — 액터가 소지한 '동일 이름' 아이템 개수로 치환.
            //    연산자 평탄화(2단계)보다 먼저 처리: 이름에 '-' 등이 섞여도 먼저 정수(개수)로 바뀐 뒤
            //    사칙연산에 참여한다. 예: [count:정신강화수술]*2 → 소지 3개면 6.
            if (actor) {
                result = result.replace(/\[(?:count|개수)\s*:\s*([^\[\]]+?)\s*\]/gi, (m, name) => {
                    const target = String(name).trim();
                    const n = (actor.items?.filter(it => (it.name || '').trim() === target).length) || 0;
                    return n;
                });
            }

            // 1) 대괄호로 감싼 단일 토큰 치환 ([Lv], [body], [melee] …) — 기존 동작 보존
            // [Lv], [level], [레벨] 치환 (아이템 레벨)
            if (item) {
                const itemLevel = this.getItemLevel(item);
                result = result.replace(/\[Lv\]/gi, itemLevel);
                result = result.replace(/\[level\]/gi, itemLevel);
                result = result.replace(/\[레벨\]/g, itemLevel);
            }

            // 액터 능력치/스킬 참조 치환 (대괄호 형태)
            if (actor) {
                result = this.replaceActorReferences(result, actor);
            }

            // 2) 다단 연산식 대괄호([20-(LV×5)], [5-LV] 등) 평탄화:
            //    내부에 연산자가 남은 대괄호는 '식'이므로 내부 토큰을 한 번 더(대괄호 없이) 치환하고
            //    외곽 []→() 로 바꿔 일반 사칙연산으로 평가되게 한다. (회귀 방지: 식 대괄호에만 적용)
            result = result.replace(/\[([^\[\]]*[-+*/()][^\[\]]*)\]/g, (m, inner) => {
                return '(' + this.replaceBareTokens(inner, item, actor) + ')';
            });

            // 3) 대괄호 없이 남은 bare 토큰(Lv/능력치/스킬) 치환.
            //    → [Lv]*10 뿐 아니라 lv*10, +(lv*n), body+2 처럼 대괄호를 생략해도 동작하게 한다.
            //    이 시점의 문자열은 위 단계에서 모든 대괄호가 숫자/괄호식으로 치환된 뒤이므로
            //    남은 것은 숫자·연산자·(미치환) bare 토큰뿐이다. replaceBareTokens는 단어 경계로만
            //    치환하므로 이미 치환된 숫자는 건드리지 않는다(회귀 안전).
            result = this.replaceBareTokens(result, item, actor);

            return result;
        },

        // 대괄호 없는 토큰을 치환 (다단 연산식 내부 전용).
        // 영문 키는 단어경계(\b)로, 한글 이름은 길이 내림차순(부분일치 방지)으로 치환한다.
        replaceBareTokens: function(inner, item, actor) {
            let s = inner;
            if (item) {
                const lvl = this.getItemLevel(item);
                s = s.replace(/\bLv\b/gi, lvl).replace(/\blevel\b/gi, lvl).replace(/레벨/g, lvl);
            }
            if (actor && actor.system?.attributes) {
                const attrs = actor.system.attributes;
                // 능력치 (key + 로컬라이즈 이름)
                const abilities = { body: 'DX3rd.Body', sense: 'DX3rd.Sense', mind: 'DX3rd.Mind', social: 'DX3rd.Social' };
                for (const [key, locKey] of Object.entries(abilities)) {
                    const a = attrs[key];
                    const v = a ? (a.total !== undefined ? a.total : (a.point || 0) + (a.bonus || 0) + (a.extra || 0)) : 0;
                    s = s.replace(new RegExp(`\\b${key}\\b`, 'gi'), v);
                    const loc = game.i18n.localize(locKey);
                    if (loc && loc !== locKey) s = s.split(loc).join(v);
                }
                // 스킬 (이름 길이 내림차순으로 부분일치 방지)
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
            // Effect/Psionic 아이템만 레벨 있음
            if (item.type === 'effect' || item.type === 'psionic') {
                const lvl = item.system?.level || {};
                // 실제 소유 아이템(액터 보유)인 이펙트는 침식률 레벨을 동적으로 계산한다.
                // level.value는 이펙트 시트의 레벨 필드를 편집할 때(_onLevelChange)만 저장되므로
                // 침식률이 변동하면 캐시값이 뒤처져 콤보 등에서 레벨이 잘못 적용된다.
                const actor = item.actor;
                if (item.type === 'effect' && lvl.upgrade && actor) {
                    const init = Number(lvl.init) || 0;
                    // Finding E: 아이템 사용 중에는 '코스트 반영 전' 고정 침식 레벨을 우선한다.
                    // (handleItemUse가 actor._dx3rdUsageEncLevel에 스냅샷을 걸어둔다.
                    //  이미 발동한 이펙트가 자신의 침식 코스트로 레벨이 오르는 것을 방지.)
                    //  플래그가 없으면(사용 밖) 실시간 침식 레벨을 그대로 읽는다.
                    const frozen = actor._dx3rdUsageEncLevel;
                    const encLevel = (frozen !== undefined && frozen !== null)
                        ? Number(frozen) || 0
                        : Number(actor.system?.attributes?.encroachment?.level) || 0;
                    return init + encLevel;
                }
                // 액터 컨텍스트가 없는 임시 아이템이거나 upgrade가 아니면 저장된 value(없으면 init) 사용
                return Number(lvl.value ?? lvl.init) || 0;
            }
            return 0;
        },
        
        replaceActorReferences: function(formulaStr, actor) {
            let result = formulaStr;
            const attrs = actor.system?.attributes;
            if (!attrs) {
                // prepareData 실행 중 일시적으로 발생할 수 있으므로 경고 제거
                return result;
            }
            
            // 능력치 참조 치환 (key와 로컬라이징된 이름 모두 지원)
            // 주의: total을 사용하면 순환 참조 가능성이 있으므로 기본값만 참조
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
                    // total이 이미 계산되어 있으면 사용
                    if (abilityData.total !== undefined) {
                        value = abilityData.total;
                    } else {
                        // total이 없으면 즉시 계산 (point + bonus + extra만, 순환 참조 방지)
                        value = (abilityData.point || 0) + (abilityData.bonus || 0) + (abilityData.extra || 0);
                    }
                }
                
                // Key로 참조 (대소문자 무시, 대괄호 이스케이프)
                const keyPattern = `\\[${this.escapeRegex(key)}\\]`;
                const keyRegex = new RegExp(keyPattern, 'gi');
                result = result.replace(keyRegex, value);
                
                // 로컬라이징된 이름으로 참조
                const localizedPattern = `\\[${this.escapeRegex(info.localized)}\\]`;
                const localizedRegex = new RegExp(localizedPattern, 'g');
                result = result.replace(localizedRegex, value);
            }
            
            // 스킬 참조 치환 (key와 name 모두 지원)
            const skills = attrs.skills || {};
            
            for (const [key, skill] of Object.entries(skills)) {
                // total 값 사용 (순환 참조는 검증 함수로 차단됨)
                let value = 0;
                if (skill) {
                    // total이 이미 계산되어 있으면 사용 (0이어도 계산된 값임)
                    if (skill.total !== undefined) {
                        value = skill.total;
                    } else {
                        // 아직 계산 안 됐으면 즉시 계산 (point + bonus + extra + works)
                        value = (skill.point || 0) + (skill.bonus || 0) + (skill.extra || 0);
                        
                        // Works 보너스 추가
                        const worksItems = actor.items?.filter(item => item.type === 'works') || [];
                        for (const worksItem of worksItems) {
                            if (worksItem.system?.skills?.[key]?.apply && worksItem.system.skills[key].add) {
                                value += Number(worksItem.system.skills[key].add) || 0;
                            }
                        }
                    }
                }
                
                // Key로 참조 (대소문자 무시, 대괄호 이스케이프)
                const keyPattern = `\\[${this.escapeRegex(key)}\\]`;
                const keyRegex = new RegExp(keyPattern, 'gi');
                result = result.replace(keyRegex, value);
                
                // Name으로 참조
                if (skill && skill.name) {
                    let skillName = skill.name;
                    // DX3rd.로 시작하면 로컬라이징
                    if (skillName.startsWith('DX3rd.')) {
                        skillName = game.i18n.localize(skillName);
                    }
                    
                    // 이름으로 참조 (정확히 일치하는 경우만, 대괄호 이스케이프)
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

    // evalFormula 헬퍼 - 수식을 평가하여 값 반환
    Handlebars.registerHelper('evalFormula', function(formula, item, actor) {
        if (!formula) return 0;
        return window.DX3rdFormulaEvaluator.evaluate(formula, item, actor);
    });

    // skill 헬퍼 - 스킬 이름을 한글로 변환 (DX3rd.* 키만 로컬라이즈)
    Handlebars.registerHelper('skill', function(skillName) {
        if (!skillName) return '-';
        
        // 로컬라이징 키인 경우
        if (typeof skillName === 'string' && skillName.startsWith('DX3rd.')) {
            // 스킬 키 추출 (예: "DX3rd.rc" -> "rc")
            const skillKey = skillName.replace('DX3rd.', '');
            
            // customSkills 설정에서 커스텀 이름 확인
            const customSkills = game.settings.get("dx3rd-emanim", "customSkills") || {};
            
            // 커스텀 이름이 있으면 우선 사용
            if (customSkills[skillKey]) {
                // 객체 형식 또는 문자열 형식 모두 지원
                return typeof customSkills[skillKey] === 'object' 
                    ? customSkills[skillKey].name 
                    : customSkills[skillKey];
            }
            
            // 커스텀 이름이 없으면 기본 로컬라이징
        return game.i18n.localize(skillName);
        }
        
        // 이미 커스텀 이름인 경우 그대로 반환
        return skillName;
    });

    // 스킬 정렬 헬퍼
    Handlebars.registerHelper('sortSkills', function(skills, abilityId) {
        if (!skills) return [];
        const orderArr = fixedOrder[abilityId] || [];
        // 1. 고정 순서 스킬
        const fixed = orderArr
            .map(key => [key, skills[key]])
            .filter(([_, skill]) => skill && skill.base === abilityId);
        // 2. 나머지(추가된) 스킬
        const rest = Object.entries(skills)
            .filter(([key, skill]) => skill.base === abilityId && !orderArr.includes(key))
            .sort((a, b) => {
                if (a[1].order !== undefined && b[1].order !== undefined) {
                    return a[1].order - b[1].order;
                }
                return a[1].name.localeCompare(b[1].name);
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

    // timing 헬퍼 - 타이밍 값을 한글로 변환
    Handlebars.registerHelper('timing', function(arg) {
        if (!arg || arg === '-') return '-';
        return game.i18n.localize(`DX3rd.${arg.charAt(0).toUpperCase() + arg.slice(1)}`);
    });

    // skillByKey 헬퍼 - 액터의 스킬 키로 스킬 이름 반환
    Handlebars.registerHelper('skillByKey', function(actor, key) {
        if (!actor || !key || key === '-') return '-';
        const skill = actor.system?.attributes?.skills?.[key];
        if (!skill) {
            // 스킬이 없으면 기본 속성 체크
            const attributes = ['body', 'sense', 'mind', 'social'];
            if (attributes.includes(key)) {
                return game.i18n.localize(`DX3rd.${key.charAt(0).toUpperCase() + key.slice(1)}`);
            }
            // 신드롬 체크
            if (key === 'syndrome') {
                return game.i18n.localize('DX3rd.Syndrome');
            }
            return key;
        }
        // 스킬 이름이 DX3rd.로 시작하면 로컬라이징
        if (skill.name && skill.name.startsWith('DX3rd.')) {
            return game.i18n.localize(skill.name);
        }
        return skill.name || key;
    });

    // ========== 어트리뷰트 관리 유틸리티 함수들 ========== //
    /**
     * 스킬 그룹 매칭 헬퍼
     */
    window.DX3rdSkillGroupMatcher = {
        /**
         * 스킬이 특정 그룹에 속하는지 확인
         * @param {string} skillKey - 스킬 키
         * @param {string} groupLabel - 그룹 라벨 (drive, ars, know, info)
         * @returns {boolean} 그룹에 속하는지 여부
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
                    // know로 시작하거나 cthulhu 스킬
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
         * 어트리뷰트 생성
         * @param {Object} item - 아이템 객체
         * @param {string} position - 'main' (system.attributes) 또는 'sub' (system.effect.attributes)
         * @returns {Promise} 업데이트 결과
         */
        async createAttribute(item, position = 'main') {
            const attributeKey = foundry.utils.randomID();
            const updatePath = position === 'main' 
                ? `system.attributes.${attributeKey}` 
                : `system.effect.attributes.${attributeKey}`;
            
            const newAttribute = {
                key: '-',
                label: '-',
                value: ''
            };

            return await item.update({
                [updatePath]: newAttribute
            });
        },

        /**
         * 어트리뷰트 삭제
         * @param {Object} item - 아이템 객체
         * @param {string} attributeKey - 삭제할 어트리뷰트 키
         * @param {string} position - 'main' 또는 'sub'
         * @returns {Promise} 업데이트 결과
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
         * 어트리뷰트 라벨 업데이트 (동적으로 input/select 변경)
         * @param {HTMLElement|jQuery} row - 어트리뷰트 행 요소
         * @param {Object} item - 아이템 객체
         * @param {string} position - 'main' 또는 'sub'
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

            if (selectedKey === 'attack' || selectedKey === 'damage_roll') {
                // attack 또는 damage_roll 키인 경우 드롭다운으로 변경
                if (labelElement.matches('input')) {
                    const select = createSelect();
                    addOption(select, '-', '-');
                    addOption(select, 'melee', game.i18n.localize('DX3rd.Melee'));
                    addOption(select, 'ranged', game.i18n.localize('DX3rd.Ranged'));
                    select.value = currentValue;
                    bindLabelUpdate(select);
                    labelElement.replaceWith(select);
                }
            } else if (statKeys.includes(selectedKey)) {
                // stat 관련 키인 경우 드롭다운으로 변경
                if (labelElement.matches('input')) {
                    const select = createSelect();
                    addOption(select, '-', '-');

                    // 스킬 그룹과 능력치 매핑
                    const skillGroupByAttribute = {
                        'body': 'drive',
                        'sense': 'ars',
                        'mind': 'know',
                        'social': 'info'
                    };

                    // 능력치별로 옵션 구성
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
                    
                    // 커스텀 스킬 설정 가져오기 (액터 없을 때 사용)
                    const customSkills = game.settings?.get("dx3rd-emanim", "customSkills") || {};

                    attributes.forEach(attr => {
                        // 능력치 옵션 추가
                        const localizedAttrName = game.i18n.localize(`DX3rd.${attr.charAt(0).toUpperCase() + attr.slice(1)}`);
                        addOption(select, attr, localizedAttrName);
                        
                        // 해당 능력치의 기본 스킬들 추가
                        const defaultSkillList = defaultSkillsByAttr[attr] || [];
                        defaultSkillList.forEach(skillKey => {
                            if (hasActor) {
                                // 액터가 있으면 액터의 스킬 데이터 사용
                                const skillData = skills[skillKey];
                                if (skillData && skillData.base === attr) {
                                    const skillName = skillData.name.startsWith('DX3rd.') 
                                        ? game.i18n.localize(skillData.name) 
                                        : skillData.name;
                                    addOption(select, skillKey, skillName);
                                }
                            } else {
                                // 액터가 없으면 커스텀 스킬 설정 확인 후 기본 스킬 이름 사용
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
                        
                        // stat_add/stat_dice인 경우 해당 능력치의 스킬 그룹 옵션 추가
                        if ((selectedKey === 'stat_add' || selectedKey === 'stat_dice') && skillGroupByAttribute[attr]) {
                            const groupKey = skillGroupByAttribute[attr];
                            const groupName = game.i18n.localize(`DX3rd.${groupKey}`);
                            addOption(select, groupKey, groupName);
                        }
                        
                        // 해당 능력치의 커스텀 스킬들 추가 (액터가 있을 때만)
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
                // stat 관련 키가 아닌 경우 비활성화된 input으로 변경
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
         * 스킬을 능력치별로 정렬
         * @param {Object} skills - 스킬 객체
         * @returns {Array} 정렬된 스킬 배열
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
                // 고정 순서 스킬
                const fixedSkills = fixedOrder[attr] || [];
                fixedSkills.forEach(skillKey => {
                    if (skills[skillKey] && skills[skillKey].base === attr) {
                        result.push([skillKey, skills[skillKey]]);
                    }
                });

                // 나머지 스킬
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
         * 어트리뷰트 이벤트 리스너 설정
         * @param {HTMLElement|jQuery} html - HTML 요소
         * @param {Object} sheet - 시트 객체
         */
        setupAttributeListeners(html, sheet) {
            const dom = window.DX3rdApplicationCompat;

            // 어트리뷰트 생성 버튼
            dom.on(html, 'click', 'a[data-action="create"][data-type="attributes"]', async (event, button) => {
                event.preventDefault();
                const position = button.dataset.pos || 'main';
                
                try {
                    sheet._isAddingAttribute = true;
                    await window.DX3rdAttributeManager.createAttribute(sheet.item, position);
                    await sheet.render(false);
                } catch (error) {
                    console.error("DX3rd | Attribute creation failed", error);
                } finally {
                    sheet._isAddingAttribute = false;
                }
            });

            // 어트리뷰트 삭제 버튼
            dom.on(html, 'click', '.attributes-list a[data-action="delete"]', async (event, button) => {
                event.preventDefault();
                const row = button.closest('.attribute');
                const attributeKey = row?.dataset.attribute;
                const position = button.closest('.attributes-list')?.dataset.pos || 'main';

                if (attributeKey) {
                    try {
                        await window.DX3rdAttributeManager.deleteAttribute(sheet.item, attributeKey, position);
                        await sheet.render(false);
                    } catch (error) {
                        console.error("DX3rd | Attribute deletion failed", error);
                    }
                }
            });

            // 어트리뷰트 키 변경 시 라벨 업데이트만 (저장하지 않음)
            dom.on(html, 'change', '.attribute-key', async (event, keySelect) => {
                const row = keySelect.closest('.attribute');
                const position = row?.closest('.attributes-list')?.dataset.pos || 'main';
                
                // 드롭다운 생성만 하고 저장하지 않음
                // attribute-key는 드롭다운에서 라벨 선택 시 함께 저장됨
                await window.DX3rdAttributeManager.updateAttributeLabel(row, sheet.item, position);
            });

            // 즉시 저장을 위한 변경 이벤트 리스너 (attribute-key 제외)
            dom.on(html, 'change', 'input[name^="system."], select[name^="system."], textarea[name^="system."]', async (event, element) => {
                if (sheet._isAddingAttribute) return;

                const name = element.getAttribute('name');
                const value = element.value;

                // attribute-key는 드롭다운에서 라벨 선택 시 저장되므로 제외
                if (name && name.startsWith('system.') && !name.endsWith('.key')) {
                    // attribute value 변경 시 순환 참조 검증 (메인 탭만, 서브/Target 탭은 제외)
                    if (name.includes('.value') && name.startsWith('system.attributes.') && !name.startsWith('system.effect.attributes.')) {
                        const row = element.closest('.attribute');
                        const labelName = name.replace('.value', '.label');
                        const keyName = name.replace('.value', '.key');
                        const labelElement = dom.query(row, `[name="${labelName}"]`);
                        const keyElement = dom.query(row, `[name="${keyName}"]`);
                        const labelValue = labelElement?.value;
                        const keyValue = keyElement?.value;
                        
                        if (labelValue) {
                            const validation = window.DX3rdFormulaEvaluator.validateCircularReference(value, labelValue, sheet.item?.actor, keyValue);
                            if (!validation.valid) {
                                ui.notifications.warn(validation.message);
                                // value 초기화
                                element.value = '';
                                event.preventDefault();
                                return;
                            }
                        }
                    }
                    
                    try {
                        const updateData = {};
                        updateData[name] = value;
                        await sheet.item.update(updateData);
                    } catch (error) {
                        console.error("DX3rd | Immediate update failed", error);
                    }
                }
            });
        },

        /**
         * 시트 렌더링 후 어트리뷰트 라벨 초기화
         * @param {HTMLElement|jQuery} html - HTML 요소
         * @param {Object} item - 아이템 객체
         */
        async initializeAttributeLabels(html, item) {
            const dom = window.DX3rdApplicationCompat;
            // 메인 어트리뷰트 라벨 초기화
            const mainUpdates = dom.queryAll(html, '.attributes-list[data-pos="main"] .attribute')
                .map(element => window.DX3rdAttributeManager.updateAttributeLabel(element, item, 'main'));

            // 서브 어트리뷰트 라벨 초기화
            const subUpdates = dom.queryAll(html, '.attributes-list[data-pos="sub"] .attribute')
                .map(element => window.DX3rdAttributeManager.updateAttributeLabel(element, item, 'sub'));

            await Promise.all([...mainUpdates, ...subUpdates]);
        }
    };

    // ========== 무기 탭 관리 유틸리티 함수들 ========== //
    window.DX3rdWeaponTabManager = {
        /**
         * 무기 탭 데이터 준비 (getData에서 호출)
         * @param {Object} data - 시트 데이터
         * @param {Object} item - 아이템 객체
         * @returns {Object} 무기 탭 데이터가 추가된 data
         */
        prepareWeaponTabData(data, item) {
            // 무기 관련 데이터 초기화 (undefined일 때만 설정, 빈 문자열도 유효한 값으로 간주)
            if (data.system.weaponTmp === undefined) data.system.weaponTmp = item.system?.weaponTmp || "-";
            if (data.system.weapon === undefined) data.system.weapon = item.system?.weapon || [];
            if (data.system.weaponItems === undefined) data.system.weaponItems = {};
            if (data.system.attackRoll === undefined) data.system.attackRoll = item.system?.attackRoll || "-";
            if (data.system.weaponSelect === undefined) data.system.weaponSelect = item.system?.weaponSelect || false;

            // 액터 무기 아이템 목록 생성 (무기 + 비클, sort 값으로 정렬)
            data.actorWeapon = {};
            if (item.actor) {
                // 무기 먼저 추가 (sort 값으로 정렬)
                const weaponItems = item.actor.items.filter(i => i.type === 'weapon')
                    .sort((a, b) => (a.sort || 0) - (b.sort || 0));
                weaponItems.forEach(w => {
                    data.actorWeapon[w.id] = w.name;
                });
                
                // 비클 추가 (sort 값으로 정렬)
                const vehicleItems = item.actor.items.filter(i => i.type === 'vehicle')
                    .sort((a, b) => (a.sort || 0) - (b.sort || 0));
                vehicleItems.forEach(v => {
                    data.actorWeapon[v.id] = v.name;
                });
            }

            // 선택된 무기 아이템들 정보 가져오기
            if (Array.isArray(data.system.weapon)) {
                data.system.weapon.forEach((weaponId) => {
                    if (weaponId && weaponId !== '-') {
                        // 액터의 무기 또는 비클 아이템에서 찾기
                        const weaponOrVehicleItem = item.actor?.items.get(weaponId);
                        if (weaponOrVehicleItem && (weaponOrVehicleItem.type === 'weapon' || weaponOrVehicleItem.type === 'vehicle')) {
                            data.system.weaponItems[weaponId] = weaponOrVehicleItem;
                        }
                    }
                });
            }

            return data;
        },

        /**
         * 무기 탭 이벤트 리스너 설정
         * @param {HTMLElement|jQuery} html - 시트 HTML
         * @param {Object} sheet - 시트 인스턴스
         */
        setupWeaponTabListeners(html, sheet) {
            const dom = window.DX3rdApplicationCompat;
            const cleanups = [];
            // 무기 추가 버튼
            cleanups.push(dom.on(html, 'click', '.add-weapon', async (event, button) => {
                event.preventDefault();
                const weaponId = dom.query(button.closest('.add-skills'), '#actor-weapon')?.value;
                
                if (!weaponId || weaponId === '-') {
                    ui.notifications.warn("추가할 무기를 선택해주세요.");
                    return;
                }

                try {
                    // 현재 무기 배열 가져오기
                    const currentWeapons = sheet.item.system.weapon || [];
                    
                    // 이미 추가된 무기인지 확인
                    if (currentWeapons.includes(weaponId)) {
                        ui.notifications.warn("이미 추가된 무기입니다.");
                        return;
                    }

                    // 무기 추가
                    const newWeapons = [...currentWeapons, weaponId];
                    
                    await sheet.item.update({
                        'system.weapon': newWeapons
                    });

                    // 콤보 시트 등에서 무기 추가 직후 후처리(공격 콤보 자동화) 훅
                    if (typeof sheet._onWeaponAdded === 'function') {
                        try { await sheet._onWeaponAdded(weaponId); }
                        catch (e) { console.error('DX3rd | WeaponTabManager - _onWeaponAdded failed', e); }
                    }

                    ui.notifications.info("무기가 추가되었습니다.");

                    // 시트 다시 렌더링
                    sheet.render(false);

                } catch (error) {
                    console.error('DX3rd | WeaponTabManager - add weapon failed', error);
                    ui.notifications.error("무기 추가에 실패했습니다.");
                }
            }));

            // 무기 삭제 버튼
            cleanups.push(dom.on(html, 'click', '.weapon-item .item-control.item-delete', async (event, button) => {
                event.preventDefault();
                const weaponId = button.closest('.item')?.dataset.itemId;

                if (!weaponId) {
                    ui.notifications.warn("삭제할 무기를 찾을 수 없습니다.");
                    return;
                }

                try {
                    // 현재 무기 배열에서 제거
                    const currentWeapons = sheet.item.system.weapon || [];
                    const newWeapons = currentWeapons.filter(id => id !== weaponId);
                    
                    await sheet.item.update({
                        'system.weapon': newWeapons
                    });

                    // 콤보 시트 등에서 무기 삭제 직후 후처리(판정 기능/공격판정 재계산) 훅
                    if (typeof sheet._onWeaponRemoved === 'function') {
                        try { await sheet._onWeaponRemoved(weaponId); }
                        catch (e) { console.error('DX3rd | WeaponTabManager - _onWeaponRemoved failed', e); }
                    }

                    ui.notifications.info("무기가 삭제되었습니다.");
                    
                    // 시트 다시 렌더링
                    sheet.render(false);
                    
                } catch (error) {
                    console.error('DX3rd | WeaponTabManager - delete weapon failed', error);
                    ui.notifications.error("무기 삭제에 실패했습니다.");
                }
            }));
            return cleanups;
        }
    };

    // ========== 디스크립션 에디터 관리 함수 ========== //
    window.DX3rdDescriptionManager = {
        /**
         * 디스크립션 에디터를 위한 enrichedBiography 생성
         * @param {Object} item - 아이템 객체
         * @param {string} description - 설명 텍스트
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
         * 시트 데이터에 enrichedBiography 추가
         * @param {Object} data - 시트 데이터 객체
         * @param {Object} item - 아이템 객체
         * @returns {Promise<Object>} 업데이트된 시트 데이터
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
     * 스킬 선택 옵션 관리자
     */
    window.DX3rdSkillManager = {
        /**
         * 아이템 타입별 스킬 선택 옵션 생성
         * @param {string} itemType - 아이템 타입 ('effect', 'weapon', 'psionic', 'combo')
         * @param {Object} actorSkills - 액터의 스킬 데이터
         * @param {string} actorType - 액터 타입 ('character', 'enemy', etc.)
         * @returns {Array} 정렬된 스킬 옵션 배열
         */
        getSkillSelectOptions(itemType, actorSkills, actorType = null) {
            const options = [];

            const localizeIfKey = (text) => {
                if (typeof text !== 'string') return text;
                if (text.startsWith('DX3rd.')) return (game?.i18n?.localize?.(text)) || text;
                return text;
            };

            // 기본 옵션 추가
            options.push({ value: '-', label: '-' });

            // 능력치 옵션 추가 (순서: Body, Sense, Mind, Social)
            const attributes = [
                { value: 'body', label: localizeIfKey('DX3rd.Body') },
                { value: 'sense', label: localizeIfKey('DX3rd.Sense') },
                { value: 'mind', label: localizeIfKey('DX3rd.Mind') },
                { value: 'social', label: localizeIfKey('DX3rd.Social') }
            ];

            options.push(...attributes);

            // 에너미인 경우 능력치만 반환
            if (actorType === 'enemy') {
                return options;
            }

            // 액터 스킬 옵션 추가 (능력치별 정렬)
            // actorSkills가 비어있거나 스킬이 없으면 기본 스킬 사용
            const hasSkills = actorSkills && 
                             typeof actorSkills === 'object' && 
                             !Array.isArray(actorSkills) &&
                             Object.keys(actorSkills).length > 0;
            
            if (hasSkills) {
                const sortedSkills = this.sortSkillsByAttribute(actorSkills);
                // 정렬된 스킬 라벨 로컬라이즈
                sortedSkills.forEach(o => { o.label = localizeIfKey(o.label); });
                options.push(...sortedSkills);
            } else {
                // 기본 스킬만 추가 (액터가 없을 때)
                const defaultSkills = this.getDefaultSkillOptions();
                defaultSkills.forEach(o => { o.label = localizeIfKey(o.label); });
                options.push(...defaultSkills);
            }

            // 이펙트 아이템의 경우 신드롬을 맨 마지막에 추가
            if (itemType === 'effect') {
                options.push({ value: 'syndrome', label: localizeIfKey('DX3rd.Syndrome') });
            }

            return options;
        },
        
        /**
         * 기본 스킬 옵션 반환 (액터가 없을 때 사용)
         * @returns {Array} 기본 스킬 옵션 배열 (능력치별로 정렬)
         */
        getDefaultSkillOptions() {
            // customSkills 설정에서 커스터마이징된 스킬 이름 가져오기
            const customSkills = game.settings?.get("dx3rd-emanim", "customSkills") || {};
            
            // 기본 스킬을 능력치별로 그룹화
            const skillGroups = {
                body: ['melee', 'evade'],
                sense: ['ranged', 'perception'],
                mind: ['rc', 'will', 'cthulhu'],
                social: ['negotiation', 'procure']
            };
            
            const options = [];
            const attributeOrder = ['body', 'sense', 'mind', 'social'];
            
            for (const attr of attributeOrder) {
                // 기본 스킬 추가
                for (const skillKey of skillGroups[attr]) {
                    // cthulhu는 stageCRC 설정에 따라 추가
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
                
                // 해당 능력치의 커스텀 스킬 추가
                for (const [skillKey, skillData] of Object.entries(customSkills)) {
                    // 기본 스킬이 아닌 경우만
                    const isDefaultSkill = ['melee', 'evade', 'ranged', 'perception', 'rc', 'will', 'cthulhu', 'negotiation', 'procure'].includes(skillKey);
                    if (isDefaultSkill) continue;
                    
                    // 해당 능력치에 속하는 경우만
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
         * 액터 스킬을 능력치별로 정렬 (기본 스킬 우선, 추가 스킬 후순위)
         * @param {Object} actorSkills - 액터의 스킬 데이터
         * @returns {Array} 정렬된 스킬 옵션 배열
         */
        sortSkillsByAttribute(actorSkills) {
            const skillOptions = [];
            const attributeOrder = ['body', 'sense', 'mind', 'social'];
            
            // 기본 스킬 목록 (시스템에 미리 정의된 스킬들)
            const defaultSkills = {
                body: ['melee', 'evade'],
                sense: ['ranged', 'perception'],
                mind: ['rc', 'will', 'cthulhu'],
                social: ['negotiation', 'procure']
            };
            
            // 각 능력치별로 스킬 정렬
            attributeOrder.forEach(attr => {
                const defaultSkillList = defaultSkills[attr] || [];
                
                // 1. 기본 스킬들 먼저 추가
                defaultSkillList.forEach(skillId => {
                    const skillData = actorSkills[skillId];
                    if (skillData && skillData.base === attr) {
                        skillOptions.push({
                            value: skillId,
                            label: (typeof (skillData.name) === 'string' && skillData.name.startsWith('DX3rd.')) ? (game?.i18n?.localize?.(skillData.name) || skillData.name) : (skillData.name || skillId)
                        });
                    }
                });
                
                // 2. 나머지 추가 스킬들 추가 (기본 스킬에 없는 것들)
                Object.entries(actorSkills).forEach(([skillId, skillData]) => {
                    if (skillData && skillData.base === attr && !defaultSkillList.includes(skillId)) {
                        // 커스텀 스킬 이름 처리
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

    // 어트리뷰트 이름을 로컬라이징 키로 변환하는 헬퍼
    window.DX3rdAttributeLocalizer = {
        /**
         * 어트리뷰트 이름을 로컬라이징된 문자열로 변환
         * @param {string} attrName - 어트리뷰트 이름 (예: "hp", "body", "melee")
         * @returns {string} 로컬라이징된 문자열
         */
        localize(attrName) {
            if (!attrName || attrName === '-') return attrName;

            // 특수 케이스 매핑 (key → 로컬라이징 키)
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
                'damage_roll': 'DX3rd.DamageRoll',
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

            // 특수 매핑 확인
            if (specialMappings[attrName]) {
                return game.i18n.localize(specialMappings[attrName]);
            }

            // 기본 능력치 (body, sense, mind, social)
            const basicAttributes = ['body', 'sense', 'mind', 'social'];
            if (basicAttributes.includes(attrName.toLowerCase())) {
                const key = `DX3rd.${attrName.charAt(0).toUpperCase() + attrName.slice(1)}`;
                return game.i18n.localize(key);
            }

            // 스킬 (melee, evade, ranged, etc.) - 소문자 그대로
            const key = `DX3rd.${attrName}`;
            const localized = game.i18n.localize(key);
            
            // 로컬라이징이 실패하면 (key 그대로 반환되면) 원래 이름 반환
            return localized !== key ? localized : attrName;
        }
    };

    // 아이템 소진 여부 확인 유틸리티 함수
    window.DX3rdItemExhausted = {
        /**
         * 아이템의 사용 횟수 소진 여부를 확인
         * @param {Object} item - 체크할 아이템
         * @returns {boolean} 소진 여부 (true: 소진됨, false: 사용 가능)
         */
        isItemExhausted: function(item) {
            if (!item || !item.system) {
                return false;
            }
            
            // 콤보는 포함된 이펙트 중 하나라도 소진되면 소진으로 간주
            if (item.type === 'combo') {
                // 콤보의 이펙트 ID 배열: effectIds 우선, 없으면 effect로 폴백 (호환성)
                const rawEffects = item.system?.effectIds ?? item.system?.effect ?? [];
                let effectIds = [];
                
                if (Array.isArray(rawEffects)) {
                    effectIds = rawEffects.filter(e => e && e !== '-');
                } else if (typeof rawEffects === 'object' && rawEffects !== null) {
                    effectIds = Object.values(rawEffects).filter(e => e && e !== '-');
                } else if (rawEffects && rawEffects !== '-') {
                    effectIds = [rawEffects];
                }
                
                if (effectIds.length === 0) {
                    return false; // 포함된 이펙트가 없으면 소진되지 않음
                }
                
                // 액터 가져오기
                let actor = item.actor || game.actors.get(item.actorId);
                // 템플릿 컨텍스트에서 넘어온 평문 객체일 수 있어 actor가 비어있는 경우가 있음
                // 이때는 아이템 ID를 기준으로 소유 액터를 탐색한다
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
                
                // 포함된 이펙트 중 하나라도 소진되었는지 확인
                for (const effectId of effectIds) {
                    if (effectId && effectId !== '-') {
                        const effect = actor.items.get(effectId);
                        
                        if (effect && effect.type === 'effect') {
                            const usedDisable = effect.system.used?.disable || 'notCheck';
                            const usedState = effect.system.used?.state || 0;
                            const usedMax = effect.system.used?.max || 0;
                            const usedLevel = effect.system.used?.level || false;
                            
                            if (usedDisable !== 'notCheck') {
                                // displayMax 계산 (used.level이 체크되어 있으면 레벨 추가)
                                let displayMax = Number(usedMax) || 0;
                                if (usedLevel) {
                                    const baseLevel = Number(effect.system?.level?.init) || 0;
                                    const upgrade = effect.system?.level?.upgrade || false;
                                    let finalLevel = baseLevel;
                                    
                                    if (upgrade && actor?.system?.attributes?.encroachment?.level) {
                                        const encLevel = Number(actor.system.attributes.encroachment.level) || 0;
                                        finalLevel += encLevel;
                                    }
                                    
                                    displayMax += finalLevel;
                                }
                                
                                const isEffectExhausted = displayMax <= 0 || usedState >= displayMax;
                                
                                if (isEffectExhausted) {
                                    return true; // 하나라도 소진되면 콤보도 소진
                                }
                            }
                        }
                    }
                }
                
                return false; // 모든 이펙트가 사용 가능하면 콤보도 사용 가능
            }
            
            const usedDisable = item.system.used?.disable || 'notCheck';
            
            // used 체크가 비활성화면 소진되지 않음
            if (usedDisable === 'notCheck') return false;
            
            const usedState = item.system.used?.state || 0;
            const usedMax = item.system.used?.max || 0;
            const usedLevel = item.system.used?.level || false;
            
            // 액터 가져오기 (템플릿 데이터의 경우 item.actor가 없을 수 있음)
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
            
            // displayMax 계산 (used.level이 체크되어 있으면 레벨 추가)
            let displayMax = Number(usedMax) || 0;
            if (usedLevel && item.type === 'effect') {
                const baseLevel = Number(item.system?.level?.init) || 0;
                const upgrade = item.system?.level?.upgrade || false;
                let finalLevel = baseLevel;
                
                if (upgrade && actor?.system?.attributes?.encroachment?.level) {
                    const encLevel = Number(actor.system.attributes.encroachment.level) || 0;
                    finalLevel += encLevel;
                }
                
                displayMax += finalLevel;
            } else if (usedLevel && item.type === 'psionic') {
                const baseLevel = Number(item.system?.level?.init) || 0;
                displayMax += baseLevel;
            }
            
            const isUsedExhausted = displayMax <= 0 || usedState >= displayMax;
            
            // 무기는 attack-used도 체크
            if (item.type === 'weapon') {
                const attackUsedDisable = item.system['attack-used']?.disable || 'notCheck';
                if (attackUsedDisable === 'notCheck') {
                    // attack-used가 비활성화면 used만 체크
                    return isUsedExhausted;
                }
                
                const attackUsedState = item.system['attack-used']?.state || 0;
                const attackUsedMax = item.system['attack-used']?.max || 0;
                const isAttackUsedExhausted = attackUsedMax <= 0 || attackUsedState >= attackUsedMax;
                
                // used와 attack-used 둘 다 소진되어야 완전 소진
                return isUsedExhausted && isAttackUsedExhausted;
            }
            
            // 무기가 아닌 경우 used만 체크
            return isUsedExhausted;
        }
    };

    // 기존의 다른 헬퍼 함수들...
})(); 
