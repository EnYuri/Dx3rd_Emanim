/**
 * Double Cross 3rd Actor 클래스 (공식 깃허브 스타일 참고)
 */
(function() {
    // v13/v14 호환: Actor 글로벌이 없을 경우 폴백
    const _ActorBase = foundry.documents?.Actor ?? globalThis.Actor;

    class DX3rdActor extends _ActorBase {
        prepareData() {
            super.prepareData();

            // system과 attributes의 기본 구조 보장
            if (!this.system) this.system = {};
            if (!this.system.attributes) this.system.attributes = {};
            
            // enemy 타입 여부 확인
            const isEnemy = this.type === 'enemy';
            
            // 기본 능력치 구조 보장
            const defaultAttributes = {
                body: { point: 0, bonus: 0, extra: 0, total: 0, dice: 0, add: 0 },
                sense: { point: 0, bonus: 0, extra: 0, total: 0, dice: 0, add: 0 },
                mind: { point: 0, bonus: 0, extra: 0, total: 0, dice: 0, add: 0 },
                social: { point: 0, bonus: 0, extra: 0, total: 0, dice: 0, add: 0 },
                hp: { value: 0, max: 0 },
                init: { value: 0 },
                move: { battle: 0, full: 0 },
                attack: { value: 0, melee: 0, ranged: 0 },
                damage_roll: { value: 0, melee: 0, ranged: 0 },
                dxroll: { value: 0 },
                armor: { value: 0, min: 0 },
                guard: { value: 0, min: 0 },
                penetrate: { value: 0, min: 0 },
                reduce: { value: 0, min: 0, roll: 0 },
                critical: { min: 10 },
                applied: {}
            };
            
            // character 타입 전용 속성 추가
            if (!isEnemy) {
                defaultAttributes.encroachment = { value: 0, max: 100, min: 0, type: game.settings.get('dx3rd-emanim', 'defaultEncroachmentType') || '-', dice: 0, level: 0, init: { input: 0, value: 0 } };
                defaultAttributes.stock = { value: 0, min: 0, max: 0 };
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

            // 기본값으로 누락된 속성 채우기
            for (const [key, value] of Object.entries(defaultAttributes)) {
                // applied는 기본값으로 초기화하지 않음 (저장된 데이터 보존)
                if (key === 'applied') {
                    // applied가 완전히 없을 때만 빈 객체로 초기화
                    if (this.system.attributes[key] === undefined || this.system.attributes[key] === null) {
                        this.system.attributes[key] = {};
                    } else {
                    }
                    continue;
                }
                
                if (!this.system.attributes[key]) {
                    this.system.attributes[key] = foundry.utils.deepClone(value);
                } else if (key === 'skills' && !isEnemy) {
                    // 스킬의 경우 기존 스킬은 유지하면서 누락된 기본 스킬만 추가 (character만)
                    const defaultSkills = value;
                    const currentSkills = this.system.attributes.skills;
                    for (const [skillKey, skillValue] of Object.entries(defaultSkills)) {
                        if (!currentSkills[skillKey]) {
                            // 삭제 불가능한 기본 스킬만 자동 추가
                            // 삭제 가능한 스킬(delete: true)은 사용자가 삭제했을 수 있으므로 재생성하지 않음
                            if (skillValue.delete === false) {
                            currentSkills[skillKey] = foundry.utils.deepClone(skillValue);
                            }
                        } else {
                            // 기존 스킬이 있으면 delete 속성은 기본값으로 업데이트
                            if (currentSkills[skillKey].delete !== undefined && skillValue.delete !== undefined) {
                                currentSkills[skillKey].delete = skillValue.delete;
                            }
                        }
                    }
                }
            }

            // character 타입 전용 처리
            if (!isEnemy) {
                // syndrome 배열 보정 (체크된 신드롬 ID 목록)
                if (!Array.isArray(this.system.attributes.syndrome)) {
                    const val = this.system.attributes.syndrome;
                    if (val == null) {
                        this.system.attributes.syndrome = [];
                    } else if (typeof val === 'string') {
                        this.system.attributes.syndrome = [val];
                    } else if (typeof val === 'object') {
                        // 구형 형태: { <id>: true/false, ... } → true인 key만 배열로 변환
                        const entries = Object.entries(val);
                        this.system.attributes.syndrome = entries
                            .filter(([, v]) => !!v)
                            .map(([k]) => k);
                    } else {
                        this.system.attributes.syndrome = [];
                    }
                }

                this._prepareActorEnc();  // 침식도 보정 먼저 실행
            }
            
            this._prepareActorAttributes();  // 능력치 계산

            let items = this.items;
            if (!Array.isArray(items)) {
                try {
                    items = Array.from(items);
                } catch (e) {
                    console.warn('Failed to convert items to array:', e);
                    items = [];
                }
            }
            
            // enemy 타입은 combo와 effect만 가짐
            if (isEnemy) {
                this.comboList = items.filter(i => i.type === "combo");
                this.effectList = items.filter(i => i.type === "effect");
                // 나머지는 빈 배열
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
                // character 타입은 모든 아이템 타입 허용
                this.workList = items.filter(i => i.type === "works");
                this.syndromeList = items.filter(i => i.type === "syndrome");
                this.comboList = items.filter(i => i.type === "combo");
                this.effectList = items.filter(i => i.type === "effect");
                this.psionicsList = items.filter(i => i.type === "psionic");
                this.spellList = items.filter(i => i.type === "spell");
                this.weaponList = items.filter(i => i.type === "weapon");
                this.protectList = items.filter(i => i.type === "protect");
                this.connectionList = items.filter(i => i.type === "connection");
                this.itemList = items.filter(i => ["book", "etc", "once"].includes(i.type));
                this.vehicleList = items.filter(i => i.type === "vehicle");
                this.loisList = items.filter(i => i.type === "lois");
                this.recordList = items.filter(i => i.type === "record");
            }
        }

        _prepareActorAttributes() {
            const system = this.system;
            const attrs = system.attributes;
            const isEnemy = this.type === 'enemy';

            // enemy 타입은 간소화된 계산만 수행
            if (isEnemy) {
                this._prepareEnemyAttributes();
                return;
            }

            // 활성 아이템 및 Applied 효과 목록 미리 준비
            const activeItems = this.items.filter(item =>
                item.system?.active?.state === true &&
                ['combo', 'effect', 'spell', 'psionic', 'weapon', 'protect', 'vehicle', 'connection', 'etc', 'once', 'rois'].includes(item.type)
            );
            const appliedEffects = attrs.applied || {};

            // === 1차 패스: 능력치 total 계산 (stat_bonus만) ===
            for (const key of ["body", "sense", "mind", "social"]) {
                const stat = attrs[key];
                
                // 신드롬 보너스 계산
                let syndromeBonus = 0;
                const syndromeList = attrs.syndrome || [];
                
                // 액터가 가진 신드롬 아이템 개수에 따른 배율 결정
                const syndromeItems = this.items.filter(item => item.type === 'syndrome');
                const totalSyndromeCount = syndromeItems.length;
                
                let multiplier = 1;
                if (totalSyndromeCount === 1) {
                    // 퓨어브리드: 2배
                    multiplier = 2;
                } else if (totalSyndromeCount >= 2) {
                    // 크로스브리드/트라이브리드: 1배
                    multiplier = 1;
                }
                
                for (const syndromeId of syndromeList) {
                    const syndromeItem = this.items.get(syndromeId);
                    if (syndromeItem && syndromeItem.system?.attributes?.[key]?.value) {
                        const baseValue = Number(syndromeItem.system.attributes[key].value) || 0;
                        syndromeBonus += baseValue * multiplier;
                    }
                }

                // 워크스 보너스 계산
                let worksBonus = 0;
                const worksItems = this.items.filter(item => item.type === 'works');
                for (const worksItem of worksItems) {
                    if (worksItem.system?.attributes?.[key]?.value) {
                        worksBonus += window.DX3rdFormulaEvaluator.evaluate(worksItem.system.attributes[key].value, worksItem, this);
                    }
                }

                // 활성화된 아이템들의 stat_bonus 계산
                let itemBonus = 0;
                
                for (const item of activeItems) {
                    if (item.system?.attributes) {
                        for (const [attrKey, attrData] of Object.entries(item.system.attributes)) {
                            // stat_bonus 어트리뷰트이고 라벨이 현재 능력치와 일치하는 경우
                            if (attrData.key === 'stat_bonus' && attrData.label === key && attrData.value) {
                                const bonusValue = window.DX3rdFormulaEvaluator.evaluate(attrData.value, item, this);
                                itemBonus += bonusValue;
                            }
                        }
                    }
                }

                // Applied 효과의 stat_bonus 계산
                let appliedBonus = 0;
                
                for (const [appliedKey, appliedEffect] of Object.entries(appliedEffects)) {
                    if (appliedEffect && appliedEffect.attributes) {
                        for (const [attrName, attrValue] of Object.entries(appliedEffect.attributes)) {
                            // 저장 키는 key 또는 key:label 형태일 수 있으므로 실제 비교는 객체의 key/label 사용
                            const aKey = (typeof attrValue === 'object' && attrValue) ? attrValue.key : (attrName.split(':')[0] || attrName);
                            const aLabel = (typeof attrValue === 'object' && attrValue) ? attrValue.label : (attrName.split(':')[1] || attrName);
                            const aVal = (typeof attrValue === 'object' && attrValue && 'value' in attrValue) ? attrValue.value : 
                                        (typeof attrValue === 'boolean') ? 0 : window.DX3rdFormulaEvaluator.evaluate(attrValue);
                            if (aKey === 'stat_bonus' && aLabel === key) {
                                appliedBonus += Number(aVal) || 0;
                            }
                        }
                    }
                }

                // bonus 값 저장 (itemBonus + appliedBonus의 합계, 자동 계산)
                stat.bonus = itemBonus + appliedBonus;
                
                // total 계산 (기본값 + extra + bonus + 신드롬 + 워크스)
                stat.total = (stat.point || 0) + (stat.extra || 0) + stat.bonus + syndromeBonus + worksBonus;
                // 최소값 보정: total은 최소 0
                if (stat.total < 0) stat.total = 0;
            }

            // === 1차 패스: 스킬 total 계산 (stat_bonus만) ===
            const skills = attrs.skills || {};

            for (const [key, skill] of Object.entries(skills)) {
                // Works 보너스 계산
                let worksBonus = 0;
                const worksItems = this.items.filter(item => item.type === 'works');
                for (const worksItem of worksItems) {
                    if (worksItem.system?.skills?.[key]?.apply && worksItem.system.skills[key].add) {
                        worksBonus += window.DX3rdFormulaEvaluator.evaluate(worksItem.system.skills[key].add, worksItem, this);
                    }
                }

                // 활성화된 아이템들의 stat_bonus 계산 (스킬용)
                let itemBonus = 0;
                
                for (const item of activeItems) {
                    if (item.system?.attributes) {
                        for (const [attrKey, attrData] of Object.entries(item.system.attributes)) {
                            // stat_bonus 어트리뷰트이고 라벨이 현재 스킬과 일치하는 경우
                            if (attrData.key === 'stat_bonus' && attrData.label === key && attrData.value) {
                                const bonusValue = window.DX3rdFormulaEvaluator.evaluate(attrData.value, item, this);
                                itemBonus += bonusValue;
                            }
                        }
                    }
                }

                // Applied 효과의 stat_bonus 계산 (스킬용)
                let appliedBonus = 0;
                
                for (const [appliedKey, appliedEffect] of Object.entries(appliedEffects)) {
                    if (appliedEffect && appliedEffect.attributes) {
                        for (const [attrName, attrValue] of Object.entries(appliedEffect.attributes)) {
                            const aKey = (typeof attrValue === 'object') ? attrValue.key : (attrName.split(':')[0] || attrName);
                            const aLabel = (typeof attrValue === 'object') ? attrValue.label : (attrName.split(':')[1] || attrName);
                            const aVal = (typeof attrValue === 'object' && 'value' in attrValue) ? attrValue.value : 
                                        (typeof attrValue === 'boolean') ? 0 : window.DX3rdFormulaEvaluator.evaluate(attrValue);
                            if (aKey === 'stat_bonus' && aLabel === key) {
                                appliedBonus += Number(aVal) || 0;
                            }
                        }
                    }
                }

                // bonus 값 저장 (itemBonus + appliedBonus의 합계, 자동 계산)
                skill.bonus = itemBonus + appliedBonus;
                // works 값도 저장 (다이얼로그에서 표시용)
                skill.works = worksBonus;
                
                // 스킬 total 계산 (point + extra + bonus + works)
                skill.total = (skill.point || 0) + (skill.extra || 0) + skill.bonus + worksBonus;
                // 최소값 보정: total은 최소 0
                if (skill.total < 0) skill.total = 0;
            }

            // === HP, Init, Saving 등 파생 값 계산 (total 사용) ===

            // HP 계산 (body.total * 2 + mind.total + 20 + 아이템/적용 효과 보너스)
            let hpBonus = 0;
            
            // 활성화된 아이템의 hp 보너스 추가
            for (const item of activeItems) {
                if (item.system?.attributes) {
                    for (const [attrKey, attrData] of Object.entries(item.system.attributes)) {
                        if (attrData.key === 'hp') {
                            const bonusValue = window.DX3rdFormulaEvaluator.evaluate(
                                attrData.value,
                                this,
                                item
                            );
                            hpBonus += bonusValue;
                        }
                    }
                }
            }
            
            // 적용된 효과의 hp 보너스 추가
            if (appliedEffects) {
                for (const [appliedKey, appliedEffect] of Object.entries(appliedEffects)) {
                    if (appliedEffect && appliedEffect.attributes) {
                        for (const [attrName, attrValue] of Object.entries(appliedEffect.attributes)) {
                            const aKey = (typeof attrValue === 'object') ? attrValue.key : attrName;
                            const aVal = (typeof attrValue === 'object' && 'value' in attrValue) ? attrValue.value : 
                                        (typeof attrValue === 'boolean') ? 0 : window.DX3rdFormulaEvaluator.evaluate(attrValue);
                            if (aKey === 'hp') {
                                hpBonus += Number(aVal) || 0;
                            }
                        }
                    }
                }
            }
            
            attrs.hp.max = (attrs.body?.total || 0) * 2 + (attrs.mind?.total || 0) + 20 + hpBonus;
            if (attrs.hp.value > attrs.hp.max) attrs.hp.value = attrs.hp.max;
            if (attrs.hp.value < 0) attrs.hp.value = 0;

            // === Attack 계산 ===
            let attackBonus = 0;
            let attackBonusMelee = 0;
            let attackBonusRanged = 0;
            let attackBonusFist = 0; // 맨손 한정 공격력(축퇴기관 등) — 데미지 산출 시 무기가 맨손일 때만 가산

            // 활성화된 아이템의 attack 보너스
            for (const item of activeItems) {
                if (item.system?.attributes) {
                    for (const [attrKey, attrData] of Object.entries(item.system.attributes)) {
                        if (attrData.key === 'attack' && attrData.value) {
                            const bonusValue = window.DX3rdFormulaEvaluator.evaluate(attrData.value, item, this);
                            const attackLabel = attrData.label || '-';

                            // label에 따라 분류
                            if (attackLabel === 'melee') {
                                attackBonusMelee += bonusValue;
                            } else if (attackLabel === 'ranged') {
                                attackBonusRanged += bonusValue;
                            } else if (attackLabel === 'fist') {
                                attackBonusFist += bonusValue;
                            } else {
                                // label이 없거나 '-'인 경우 모든 공격에 적용
                                attackBonus += bonusValue;
                            }
                        }
                    }
                }
            }

            // 적용된 효과의 attack 보너스
            for (const [appliedKey, appliedEffect] of Object.entries(appliedEffects)) {
                if (appliedEffect && appliedEffect.attributes) {
                    for (const [attrName, attrValue] of Object.entries(appliedEffect.attributes)) {
                        const aKey = (typeof attrValue === 'object') ? attrValue.key : attrName;
                        const aLabel = (typeof attrValue === 'object') ? attrValue.label : null;
                        const aVal = (typeof attrValue === 'object' && 'value' in attrValue) ? attrValue.value :
                                    (typeof attrValue === 'boolean') ? 0 : window.DX3rdFormulaEvaluator.evaluate(attrValue);

                        if (aKey === 'attack') {
                            // label에 따라 분류
                            if (aLabel === 'melee') {
                                attackBonusMelee += Number(aVal) || 0;
                            } else if (aLabel === 'ranged') {
                                attackBonusRanged += Number(aVal) || 0;
                            } else if (aLabel === 'fist') {
                                attackBonusFist += Number(aVal) || 0;
                            } else {
                                // label이 없거나 '-'인 경우 모든 공격에 적용
                                attackBonus += Number(aVal) || 0;
                            }
                        }
                    }
                }
            }

            if (!attrs.attack) attrs.attack = { value: 0, melee: 0, ranged: 0, fist: 0 };
            attrs.attack.value = attackBonus;
            attrs.attack.melee = attackBonusMelee;
            attrs.attack.ranged = attackBonusRanged;
            attrs.attack.fist = attackBonusFist;

            // === Damage Roll 계산 ===
            let damageRollBonus = 0;
            let damageRollBonusMelee = 0;
            let damageRollBonusRanged = 0;
            
            // 활성화된 아이템의 damage_roll 보너스
            for (const item of activeItems) {
                if (item.system?.attributes) {
                    for (const [attrKey, attrData] of Object.entries(item.system.attributes)) {
                        if (attrData.key === 'damage_roll' && attrData.value) {
                            const bonusValue = window.DX3rdFormulaEvaluator.evaluate(attrData.value, item, this);
                            const damageRollLabel = attrData.label || '-';
                            
                            // label에 따라 분류
                            if (damageRollLabel === 'melee') {
                                damageRollBonusMelee += bonusValue;
                            } else if (damageRollLabel === 'ranged') {
                                damageRollBonusRanged += bonusValue;
                            } else {
                                // label이 없거나 '-'인 경우 모든 공격에 적용
                                damageRollBonus += bonusValue;
                            }
                        }
                    }
                }
            }
            
            // 적용된 효과의 damage_roll 보너스
            for (const [appliedKey, appliedEffect] of Object.entries(appliedEffects)) {
                if (appliedEffect && appliedEffect.attributes) {
                    for (const [attrName, attrValue] of Object.entries(appliedEffect.attributes)) {
                        const aKey = (typeof attrValue === 'object') ? attrValue.key : attrName;
                        const aLabel = (typeof attrValue === 'object') ? attrValue.label : null;
                        const aVal = (typeof attrValue === 'object' && 'value' in attrValue) ? attrValue.value : 
                                    (typeof attrValue === 'boolean') ? 0 : window.DX3rdFormulaEvaluator.evaluate(attrValue);
                        
                        if (aKey === 'damage_roll') {
                            // label에 따라 분류
                            if (aLabel === 'melee') {
                                damageRollBonusMelee += Number(aVal) || 0;
                            } else if (aLabel === 'ranged') {
                                damageRollBonusRanged += Number(aVal) || 0;
                            } else {
                                // label이 없거나 '-'인 경우 모든 공격에 적용
                                damageRollBonus += Number(aVal) || 0;
                            }
                        }
                    }
                }
            }
            
            if (!attrs.damage_roll) attrs.damage_roll = { value: 0, melee: 0, ranged: 0 };
            attrs.damage_roll.value = damageRollBonus;
            attrs.damage_roll.melee = damageRollBonusMelee;
            attrs.damage_roll.ranged = damageRollBonusRanged;

            // === Armor 계산 ===
            let armorBonus = 0;
            
            // 장착된 프로텍트의 armor 값 추가
            const equippedProtects = this.items.filter(i => i.type === 'protect' && i.system?.equipment === true);
            for (const protect of equippedProtects) {
                if (protect.system?.armor) {
                    const armorValue = window.DX3rdFormulaEvaluator.evaluate(protect.system.armor, protect, this);
                    armorBonus += armorValue;
                }
            }
            
            // 장착된 비클의 armor 값 추가
            const equippedVehicles = this.items.filter(i => i.type === 'vehicle' && i.system?.equipment === true);
            for (const vehicle of equippedVehicles) {
                if (vehicle.system?.armor) {
                    const armorValue = window.DX3rdFormulaEvaluator.evaluate(vehicle.system.armor, vehicle, this);
                    armorBonus += armorValue;
                }
            }
            
            // 활성화된 아이템의 armor 어트리뷰트 보너스
            for (const item of activeItems) {
                if (item.system?.attributes) {
                    for (const [attrKey, attrData] of Object.entries(item.system.attributes)) {
                        if (attrData.key === 'armor' && attrData.value) {
                            const bonusValue = window.DX3rdFormulaEvaluator.evaluate(attrData.value, item, this);
                            armorBonus += bonusValue;
                        }
                    }
                }
            }
            
            // 적용된 효과의 armor 보너스
            for (const [appliedKey, appliedEffect] of Object.entries(appliedEffects)) {
                if (appliedEffect && appliedEffect.attributes) {
                    for (const [attrName, attrValue] of Object.entries(appliedEffect.attributes)) {
                        const aKey = (typeof attrValue === 'object') ? attrValue.key : attrName;
                        const aVal = (typeof attrValue === 'object' && 'value' in attrValue) ? attrValue.value : 
                                    (typeof attrValue === 'boolean') ? 0 : window.DX3rdFormulaEvaluator.evaluate(attrValue);
                        if (aKey === 'armor') armorBonus += Number(aVal) || 0;
                    }
                }
            }
            
            attrs.armor.value = armorBonus;
            // 최소값 보정: armor는 최소 0
            if (attrs.armor.value < 0) attrs.armor.value = 0;
            if (attrs.armor.value < attrs.armor.min) attrs.armor.value = attrs.armor.min;

            // === Guard 계산 ===
            let guardBonus = 0;
            let guardRoll = 0;   // 가드 시 굴리는 D10 개수(가드치에 +[N]D10 — 방어 다이얼로그에서 굴려 가산)

            // 활성화된 아이템의 guard 보너스
            for (const item of activeItems) {
                if (item.system?.attributes) {
                    for (const [attrKey, attrData] of Object.entries(item.system.attributes)) {
                        if (attrData.key === 'guard' && attrData.value) {
                            const bonusValue = window.DX3rdFormulaEvaluator.evaluate(attrData.value, item, this);
                            guardBonus += bonusValue;
                        }
                        if (attrData.key === 'guard_roll' && attrData.value) {
                            guardRoll += Number(window.DX3rdFormulaEvaluator.evaluate(attrData.value, item, this)) || 0;
                        }
                    }
                }
            }

            // 적용된 효과의 guard 보너스
            for (const [appliedKey, appliedEffect] of Object.entries(appliedEffects)) {
                if (appliedEffect && appliedEffect.attributes) {
                    for (const [attrName, attrValue] of Object.entries(appliedEffect.attributes)) {
                        const aKey2 = (typeof attrValue === 'object') ? attrValue.key : attrName;
                        const aVal2 = (typeof attrValue === 'object' && 'value' in attrValue) ? attrValue.value : window.DX3rdFormulaEvaluator.evaluate(attrValue);
                        if (aKey2 === 'guard') guardBonus += Number(aVal2) || 0;
                        if (aKey2 === 'guard_roll') guardRoll += Number(aVal2) || 0;
                    }
                }
            }

            attrs.guard.value = guardBonus;
            // 최소값 보정: guard는 최소 0
            if (attrs.guard.value < 0) attrs.guard.value = 0;
            if (attrs.guard.value < attrs.guard.min) attrs.guard.value = attrs.guard.min;
            attrs.guard.roll = Math.max(0, guardRoll);   // 방어 다이얼로그가 읽어 Nd10 굴림

            // === DxRoll 계산(달성치에 +[N]D10) — 판정 시 Nd10 굴려 달성치(add)에 가산 ===
            let dxRoll = 0;
            for (const item of activeItems) {
                if (item.system?.attributes) {
                    for (const [attrKey, attrData] of Object.entries(item.system.attributes)) {
                        if (attrData.key === 'dxroll' && attrData.value) {
                            dxRoll += Number(window.DX3rdFormulaEvaluator.evaluate(attrData.value, item, this)) || 0;
                        }
                    }
                }
            }
            for (const [appliedKey, appliedEffect] of Object.entries(appliedEffects)) {
                if (appliedEffect && appliedEffect.attributes) {
                    for (const [attrName, attrValue] of Object.entries(appliedEffect.attributes)) {
                        const aKeyDx = (typeof attrValue === 'object') ? attrValue.key : attrName;
                        const aValDx = (typeof attrValue === 'object' && 'value' in attrValue) ? attrValue.value : window.DX3rdFormulaEvaluator.evaluate(attrValue);
                        if (aKeyDx === 'dxroll') dxRoll += Number(aValDx) || 0;
                    }
                }
            }
            if (!attrs.dxroll) attrs.dxroll = { value: 0 };
            attrs.dxroll.value = Math.max(0, dxRoll);   // 판정 핸들러(executeStatRoll/executeAttackRoll)가 읽어 Nd10 굴림

            // === Penetrate 계산 ===
            let penetrateBonus = 0;

            // 활성화된 아이템의 penetrate 보너스
            for (const item of activeItems) {
                if (item.system?.attributes) {
                    for (const [attrKey, attrData] of Object.entries(item.system.attributes)) {
                        if (attrData.key === 'penetrate' && attrData.value) {
                            const bonusValue = window.DX3rdFormulaEvaluator.evaluate(attrData.value, item, this);
                            penetrateBonus += bonusValue;
                        }
                    }
                }
            }
            
            // 적용된 효과의 penetrate 보너스
            for (const [appliedKey, appliedEffect] of Object.entries(appliedEffects)) {
                if (appliedEffect && appliedEffect.attributes) {
                    for (const [attrName, attrValue] of Object.entries(appliedEffect.attributes)) {
                        const aKey3 = (typeof attrValue === 'object') ? attrValue.key : attrName;
                        const aVal3 = (typeof attrValue === 'object' && 'value' in attrValue) ? attrValue.value : window.DX3rdFormulaEvaluator.evaluate(attrValue);
                        if (aKey3 === 'penetrate') penetrateBonus += Number(aVal3) || 0;
                    }
                }
            }
            
            attrs.penetrate.value = penetrateBonus;
            // 최소값 보정: penetrate는 최소 0
            if (attrs.penetrate.value < 0) attrs.penetrate.value = 0;
            if (attrs.penetrate.value < attrs.penetrate.min) attrs.penetrate.value = attrs.penetrate.min;

            // === Reduce 계산 ===
            let reduceBonus = 0;
            let reduceRoll = 0;   // 피격 시 굴리는 D10 개수(HP데미지 [N]D10점 경감 — 방어 다이얼로그에서 굴려 경감치에 가산)

            // 활성화된 아이템의 reduce 보너스
            for (const item of activeItems) {
                if (item.system?.attributes) {
                    for (const [attrKey, attrData] of Object.entries(item.system.attributes)) {
                        if (attrData.key === 'reduce' && attrData.value) {
                            const bonusValue = window.DX3rdFormulaEvaluator.evaluate(attrData.value, item, this);
                            reduceBonus += bonusValue;
                        }
                        if (attrData.key === 'reduce_roll' && attrData.value) {
                            reduceRoll += Number(window.DX3rdFormulaEvaluator.evaluate(attrData.value, item, this)) || 0;
                        }
                    }
                }
            }

            // 적용된 효과의 reduce 보너스
            for (const [appliedKey, appliedEffect] of Object.entries(appliedEffects)) {
                if (appliedEffect && appliedEffect.attributes) {
                    for (const [attrName, attrValue] of Object.entries(appliedEffect.attributes)) {
                        const aKey4 = (typeof attrValue === 'object') ? attrValue.key : attrName;
                        const aVal4 = (typeof attrValue === 'object' && 'value' in attrValue) ? attrValue.value : window.DX3rdFormulaEvaluator.evaluate(attrValue);
                        if (aKey4 === 'reduce') reduceBonus += Number(aVal4) || 0;
                        if (aKey4 === 'reduce_roll') reduceRoll += Number(aVal4) || 0;
                    }
                }
            }

            attrs.reduce.value = reduceBonus;
            // 최소값 보정: reduce는 최소 0
            if (attrs.reduce.value < 0) attrs.reduce.value = 0;
            if (attrs.reduce.value < attrs.reduce.min) attrs.reduce.value = attrs.reduce.min;
            attrs.reduce.roll = Math.max(0, reduceRoll);   // 방어 다이얼로그가 읽어 Nd10 굴림

            // 이니셔티브 계산 (sense.total * 2 + mind.total + 아이템/적용 효과 보너스)
            let initBonus = 0;
            
            // 장착된 프로텍트의 init 값 추가
            const equippedProtectsForInit = this.items.filter(i => i.type === 'protect' && i.system?.equipment === true);
            for (const protect of equippedProtectsForInit) {
                if (protect.system?.init) {
                    const initValue = window.DX3rdFormulaEvaluator.evaluate(protect.system.init, protect, this);
                    initBonus += initValue;
                }
            }
            
            // 장착된 비클의 init 값 추가
            const equippedVehiclesForInit = this.items.filter(i => i.type === 'vehicle' && i.system?.equipment === true);
            for (const vehicle of equippedVehiclesForInit) {
                if (vehicle.system?.init) {
                    const initValue = window.DX3rdFormulaEvaluator.evaluate(vehicle.system.init, vehicle, this);
                    initBonus += initValue;
                }
            }
            
            // 활성화된 아이템의 init 보너스 추가
            for (const item of activeItems) {
                if (item.system?.attributes) {
                    for (const [attrKey, attrData] of Object.entries(item.system.attributes)) {
                        if (attrData.key === 'init') {
                            const bonusValue = window.DX3rdFormulaEvaluator.evaluate(
                                attrData.value,
                                this,
                                item
                            );
                            initBonus += bonusValue;
                        }
                    }
                }
            }
            
            // 적용된 효과의 init 보너스 추가
            if (appliedEffects) {
                for (const [appliedKey, appliedEffect] of Object.entries(appliedEffects)) {
                    if (appliedEffect && appliedEffect.attributes) {
                        for (const [attrName, attrValue] of Object.entries(appliedEffect.attributes)) {
                            const aKey5 = (typeof attrValue === 'object') ? attrValue.key : attrName;
                            const aVal5 = (typeof attrValue === 'object' && 'value' in attrValue) ? attrValue.value : window.DX3rdFormulaEvaluator.evaluate(attrValue);
                            if (aKey5 === 'init') initBonus += Number(aVal5) || 0;
                        }
                    }
                }
            }
            
            attrs.init.value = (attrs.sense?.total || 0) * 2 + (attrs.mind?.total || 0) + initBonus;
            
            // Madness5 아이템 체크 및 init 패널티 적용 (폭주 패널티 전에 적용)
            const madnessTypePrefix = game.i18n.localize('DX3rd.MadnessType');
            const madness5Name = madnessTypePrefix + ': ' + game.i18n.localize('DX3rd.Madness5');
            const hasMadness5 = this.items.some(item => 
                item.type === 'effect' && 
                item.name === madness5Name
            );
            
            if (hasMadness5) {
                const initBeforeMadness5 = attrs.init.value;
                attrs.init.value -= 5;
                
                // 적용 전 값이 1 이상이고 5 이하일 경우 최소값 1 보장 (이미 0 이하라면 상관없음)
                if (initBeforeMadness5 >= 1 && initBeforeMadness5 <= 5) {
                    attrs.init.value = Math.max(1, attrs.init.value);
                }
            }
            
            // 폭주 상태이상 체크
            if (system.conditions?.berserk?.active) {
                // 폭주 해방 (-9999 패널티)
                if (system.conditions.berserk.type === 'release') {
                    attrs.init.value -= 9999;
                }
                // 폭주 망상 (-10 패널티)
                else if (system.conditions.berserk.type === 'delusion') {
                    attrs.init.value -= 10;
                }
            }
            
            // 이니셔티브 최소값 0 보장
            if (attrs.init.value < 0) attrs.init.value = 0;

            // 이동력 계산
            // 간이 거리 계산 설정 확인
            const simplifiedDistance = game.settings.get('dx3rd-emanim', 'simplifiedDistance');
            
            if (!simplifiedDistance) {
                // 장착된 비클 확인 (move.battle 계산에 사용)
                const equippedVehicle = this.items.find(item => 
                    item.type === 'vehicle' && 
                    item.system?.equipment === true
                );
                
                // 기본 계산식: init.value + 5 또는 비클 move / 5 중 큰 값
                let baseBattleMove = attrs.init.value + 5;
                
                if (equippedVehicle && equippedVehicle.system?.move !== undefined) {
                    // 비클의 move 값을 평가
                    const vehicleMove = window.DX3rdFormulaEvaluator.evaluate(
                        equippedVehicle.system.move,
                        this,
                        equippedVehicle
                    );
                    const vehicleBattleMove = Math.floor(vehicleMove / 5);
                    // 비클 move/5와 행동치+5 중 큰 값 선택
                    baseBattleMove = Math.max(baseBattleMove, vehicleBattleMove);
                }
                
                // battleMove 보너스 계산
                let moveBattleBonus = 0;
                
                // 활성화된 아이템의 battleMove 보너스 추가
                for (const item of activeItems) {
                    if (item.system?.attributes) {
                        for (const [attrKey, attrData] of Object.entries(item.system.attributes)) {
                            if (attrData.key === 'battleMove') {
                                const bonusValue = window.DX3rdFormulaEvaluator.evaluate(
                                    attrData.value,
                                    item,
                                    this
                                );
                                moveBattleBonus += bonusValue;
                            }
                        }
                    }
                }
                
                // 적용된 효과의 battleMove 보너스 추가
                if (appliedEffects) {
                    for (const [appliedKey, appliedEffect] of Object.entries(appliedEffects)) {
                        if (appliedEffect && appliedEffect.attributes) {
                            for (const [attrName, attrValue] of Object.entries(appliedEffect.attributes)) {
                                const aKey6 = (typeof attrValue === 'object') ? attrValue.key : attrName;
                                const aVal6 = (typeof attrValue === 'object' && 'value' in attrValue) ? attrValue.value : window.DX3rdFormulaEvaluator.evaluate(attrValue);
                                if (aKey6 === 'battleMove') moveBattleBonus += Number(aVal6) || 0;
                            }
                        }
                    }
                }
                
                attrs.move.battle = baseBattleMove + moveBattleBonus;
                
                // 경직 상태이상 체크 (-9999 패널티)
                if (system.conditions?.rigor?.active) {
                    attrs.move.battle -= 9999;
                }
                
                // 이동력(전투) 최소값 0 보장
                if (attrs.move.battle < 0) attrs.move.battle = 0;
                
                // 이동력(전력) 기본 계산: move.battle * 2 또는 비클 move
                if (equippedVehicle && equippedVehicle.system?.move !== undefined) {
                    // 비클이 있으면 비클의 move 값 사용
                    const vehicleMove = window.DX3rdFormulaEvaluator.evaluate(
                        equippedVehicle.system.move,
                        equippedVehicle,
                        this
                    );
                    attrs.move.full = vehicleMove;
                } else {
                    // 비클이 없으면 move.battle * 2
            attrs.move.full = attrs.move.battle * 2;
                }
                
                // 이동력(전력) fullMove 보너스 추가
                let moveFullBonus = 0;
                
                // 활성화된 아이템의 fullMove 보너스 추가
                for (const item of activeItems) {
                    if (item.system?.attributes) {
                        for (const [attrKey, attrData] of Object.entries(item.system.attributes)) {
                            if (attrData.key === 'fullMove') {
                                const bonusValue = window.DX3rdFormulaEvaluator.evaluate(
                                    attrData.value,
                                    item,
                                    this
                                );
                                moveFullBonus += bonusValue;
                            }
                        }
                    }
                }
                
                // 적용된 효과의 fullMove 보너스 추가
                if (appliedEffects) {
                    for (const [appliedKey, appliedEffect] of Object.entries(appliedEffects)) {
                        if (appliedEffect && appliedEffect.attributes) {
                            for (const [attrName, attrValue] of Object.entries(appliedEffect.attributes)) {
                                const aKey7 = (typeof attrValue === 'object') ? attrValue.key : attrName;
                                const aVal7 = (typeof attrValue === 'object' && 'value' in attrValue) ? attrValue.value : window.DX3rdFormulaEvaluator.evaluate(attrValue);
                                if (aKey7 === 'fullMove') moveFullBonus += Number(aVal7) || 0;
                            }
                        }
                    }
                }
                
                // fullMove 보너스를 move.full에 추가 (비클이 있으면 비클 기준, 없으면 move.battle*2 기준)
                attrs.move.full += moveFullBonus;
                
                // 경직 상태이상 체크 (-9999 패널티)
                if (system.conditions?.rigor?.active) {
                    attrs.move.full -= 9999;
                }
                
                // 이동력(전력) 최소값 0 보장
                if (attrs.move.full < 0) attrs.move.full = 0;
                
                // SpellCalamity 1번 효과: 이동력 절반
                let hasMoveHalf = false;
                if (appliedEffects) {
                    for (const [appliedKey, appliedEffect] of Object.entries(appliedEffects)) {
                        if (appliedEffect && appliedEffect.attributes) {
                            for (const [attrName, attrValue] of Object.entries(appliedEffect.attributes)) {
                                // move_half는 boolean 값이거나 객체일 수 있음
                                if (attrName === 'move_half' ||
                                    (typeof attrValue === 'object' && attrValue?.key === 'move_half')) {
                                    hasMoveHalf = true;
                                    break;
                                }
                            }
                            if (hasMoveHalf) break;
                        }
                    }
                }
                
                if (hasMoveHalf) {
                    if (equippedVehicle && equippedVehicle.system?.move !== undefined) {
                        // 비클이 있는 경우: move.battle과 move.full 모두 절반으로 하고, 그 값의 /5가 move.battle과 비교
                        attrs.move.battle = Math.floor(attrs.move.battle / 2);
                        attrs.move.full = Math.floor(attrs.move.full / 2);
                        const vehicleBattleFromFull = Math.floor(attrs.move.full / 5);
                        attrs.move.battle = Math.max(attrs.move.battle, vehicleBattleFromFull);
                    } else {
                        // 비클이 없는 경우: move.battle만 절반으로 계산 (move.full은 자동으로 절반이 됨)
                        attrs.move.battle = Math.floor(attrs.move.battle / 2);
                        attrs.move.full = attrs.move.battle * 2;
                    }
                }
            } else {
                // 간이 거리 계산식
                // 장착된 비클 확인
                const equippedVehicle = this.items.find(item => 
                    item.type === 'vehicle' && 
                    item.system?.equipment === true
                );
                
                // 기본 계산식: Math.floor(init.value / 2) + 2 또는 비클 move / 5 중 큰 값
                let baseBattleMove = Math.floor(attrs.init.value / 2) + 2;
                
                if (equippedVehicle && equippedVehicle.system?.move !== undefined) {
                    // 비클의 move 값을 평가
                    const vehicleMove = window.DX3rdFormulaEvaluator.evaluate(
                        equippedVehicle.system.move,
                        this,
                        equippedVehicle
                    );
                    const vehicleBattleMove = Math.floor(vehicleMove / 5);
                    // 비클 move/5와 (행동치/2)+2 중 큰 값 선택
                    baseBattleMove = Math.max(baseBattleMove, vehicleBattleMove);
                }
                
                // battleMove 보너스 계산
                let moveBattleBonus = 0;
                
                // 활성화된 아이템의 battleMove 보너스 추가
                for (const item of activeItems) {
                    if (item.system?.attributes) {
                        for (const [attrKey, attrData] of Object.entries(item.system.attributes)) {
                            if (attrData.key === 'battleMove') {
                                const bonusValue = window.DX3rdFormulaEvaluator.evaluate(
                                    attrData.value,
                                    item,
                                    this
                                );
                                moveBattleBonus += bonusValue;
                            }
                        }
                    }
                }
                
                // 적용된 효과의 battleMove 보너스 추가
                if (appliedEffects) {
                    for (const [appliedKey, appliedEffect] of Object.entries(appliedEffects)) {
                        if (appliedEffect && appliedEffect.attributes) {
                            for (const [attrName, attrValue] of Object.entries(appliedEffect.attributes)) {
                            const aKey8 = (typeof attrValue === 'object') ? attrValue.key : attrName;
                            const aVal8 = (typeof attrValue === 'object' && 'value' in attrValue) ? attrValue.value : window.DX3rdFormulaEvaluator.evaluate(attrValue);
                            if (aKey8 === 'battleMove') moveBattleBonus += Number(aVal8) || 0;
                            }
                        }
                    }
                }
                
                attrs.move.battle = baseBattleMove + moveBattleBonus;
                
                // 경직 상태이상 체크 (-9999 패널티)
                if (system.conditions?.rigor?.active) {
                    attrs.move.battle -= 9999;
                }
                
                // 이동력(전투) 최소값 0 보장
                if (attrs.move.battle < 0) attrs.move.battle = 0;
                
                // 이동력(전력) 기본 계산: move.battle * 2 또는 비클 move
                if (equippedVehicle && equippedVehicle.system?.move !== undefined) {
                    // 비클이 있으면 비클의 move 값 사용
                    const vehicleMove = window.DX3rdFormulaEvaluator.evaluate(
                        equippedVehicle.system.move,
                        equippedVehicle,
                        this
                    );
                    attrs.move.full = vehicleMove;
                } else {
                    // 비클이 없으면 move.battle * 2
            attrs.move.full = attrs.move.battle * 2;
                }
                
                // 이동력(전력) fullMove 보너스 추가
                let moveFullBonus = 0;
                
                // 활성화된 아이템의 fullMove 보너스 추가
                for (const item of activeItems) {
                    if (item.system?.attributes) {
                        for (const [attrKey, attrData] of Object.entries(item.system.attributes)) {
                            if (attrData.key === 'fullMove') {
                                const bonusValue = window.DX3rdFormulaEvaluator.evaluate(
                                    attrData.value,
                                    item,
                                    this
                                );
                                moveFullBonus += bonusValue;
                            }
                        }
                    }
                }
                
                // 적용된 효과의 fullMove 보너스 추가
                if (appliedEffects) {
                    for (const [appliedKey, appliedEffect] of Object.entries(appliedEffects)) {
                        if (appliedEffect && appliedEffect.attributes) {
                            for (const [attrName, attrValue] of Object.entries(appliedEffect.attributes)) {
                                const aKey9 = (typeof attrValue === 'object') ? attrValue.key : attrName;
                                const aVal9 = (typeof attrValue === 'object' && 'value' in attrValue) ? attrValue.value : window.DX3rdFormulaEvaluator.evaluate(attrValue);
                                if (aKey9 === 'fullMove') moveFullBonus += Number(aVal9) || 0;
                            }
                        }
                    }
                }
                
                // fullMove 보너스를 move.full에 추가 (비클이 있으면 비클 기준, 없으면 move.battle*2 기준)
                attrs.move.full += moveFullBonus;
                
                // 경직 상태이상 체크 (-9999 패널티)
                if (system.conditions?.rigor?.active) {
                    attrs.move.full -= 9999;
                }
                
                // 이동력(전력) 최소값 0 보장
                if (attrs.move.full < 0) attrs.move.full = 0;
                
                // SpellCalamity 1번 효과: 이동력 절반 (간이 거리 계산식)
                let hasMoveHalfSimplified = false;
                if (appliedEffects) {
                    for (const [appliedKey, appliedEffect] of Object.entries(appliedEffects)) {
                        if (appliedEffect && appliedEffect.attributes) {
                            for (const [attrName, attrValue] of Object.entries(appliedEffect.attributes)) {
                                // move_half는 boolean 값이거나 객체일 수 있음
                                if (attrName === 'move_half' ||
                                    (typeof attrValue === 'object' && attrValue?.key === 'move_half')) {
                                    hasMoveHalfSimplified = true;
                                    break;
                                }
                            }
                            if (hasMoveHalfSimplified) break;
                        }
                    }
                }
                
                if (hasMoveHalfSimplified) {
                    if (equippedVehicle && equippedVehicle.system?.move !== undefined) {
                        // 비클이 있는 경우: move.battle과 move.full 모두 절반으로 하고, 그 값의 /5가 move.battle과 비교
                        attrs.move.battle = Math.floor(attrs.move.battle / 2);
                        attrs.move.full = Math.floor(attrs.move.full / 2);
                        const vehicleBattleFromFull = Math.floor(attrs.move.full / 5);
                        attrs.move.battle = Math.max(attrs.move.battle, vehicleBattleFromFull);
                    } else {
                        // 비클이 없는 경우: move.battle만 절반으로 계산 (move.full은 자동으로 절반이 됨)
                        attrs.move.battle = Math.floor(attrs.move.battle / 2);
                        attrs.move.full = attrs.move.battle * 2;
                    }
                }
            }

            // 세이빙 계산 (social.total * 2 + procure.total * 2 + 아이템/적용 효과 보너스)
            const socialTotal = Number(attrs.social?.total || 0);
            const procureTotal = Number(attrs.skills?.procure?.total || 0);
            let savingBonus = 0;
            
            // 활성화된 아이템의 saving_max 보너스 추가
            for (const item of activeItems) {
                if (item.system?.attributes) {
                    for (const [attrKey, attrData] of Object.entries(item.system.attributes)) {
                        if (attrData.key === 'saving_max') {
                            const bonusValue = window.DX3rdFormulaEvaluator.evaluate(
                                attrData.value,
                                item,
                                this
                            );
                            savingBonus += bonusValue;
                        }
                    }
                }
            }
            
            // 적용된 효과의 saving_max 보너스 추가
            if (appliedEffects) {
                for (const [appliedKey, appliedEffect] of Object.entries(appliedEffects)) {
                    if (appliedEffect && appliedEffect.attributes) {
                        for (const [attrName, attrValue] of Object.entries(appliedEffect.attributes)) {
                            const aKey10 = (typeof attrValue === 'object') ? attrValue.key : attrName;
                            const aVal10 = (typeof attrValue === 'object' && 'value' in attrValue) ? attrValue.value : window.DX3rdFormulaEvaluator.evaluate(attrValue);
                            if (aKey10 === 'saving_max') savingBonus += Number(aVal10) || 0;
                        }
                    }
                }
            }
            
            // 이론상 상비점 최대치 (아이템 상비화 비용 차감 전)
            attrs.saving.max = socialTotal * 2 + procureTotal * 2 + savingBonus;
            
            // 아이템의 saving.value 합계 (상비화 비용)
            let savingItemCost = 0;
            const savingItems = this.items.filter(item => 
                ['weapon', 'protect', 'vehicle', 'book', 'connection', 'etc', 'once'].includes(item.type)
            );
            
            for (const item of savingItems) {
                if (item.system?.saving?.value) {
                    savingItemCost += Number(item.system.saving.value) || 0;
                }
            }
            
            // remain 기준으로 상비화 비용 차감
            const savingRemainBase = Math.max(attrs.saving.max - savingItemCost, 0);
            // 아직 값이 없으면 그대로 세팅, 이미 값이 있으면 새 기준보다 크지 않게만 보정
            if (attrs.saving.remain == null) {
                attrs.saving.remain = savingRemainBase;
            } else {
                attrs.saving.remain = Math.min(attrs.saving.remain, savingRemainBase);
            }

            // 스톡 계산 (saving.remain + 아이템/적용 효과 보너스)
            let stockBonus = 0;
            
            // 활성화된 아이템의 stock_point 보너스 추가
            for (const item of activeItems) {
                if (item.system?.attributes) {
                    for (const [attrKey, attrData] of Object.entries(item.system.attributes)) {
                        if (attrData.key === 'stock_point') {
                            const bonusValue = window.DX3rdFormulaEvaluator.evaluate(
                                attrData.value,
                                item,
                                this
                            );
                            stockBonus += bonusValue;
                        }
                    }
                }
            }
            
            // 적용된 효과의 stock_point 보너스 추가
            if (appliedEffects) {
                for (const [appliedKey, appliedEffect] of Object.entries(appliedEffects)) {
                    if (appliedEffect && appliedEffect.attributes) {
                        for (const [attrName, attrValue] of Object.entries(appliedEffect.attributes)) {
                            const aKey11 = (typeof attrValue === 'object') ? attrValue.key : attrName;
                            const aVal11 = (typeof attrValue === 'object' && 'value' in attrValue) ? attrValue.value : window.DX3rdFormulaEvaluator.evaluate(attrValue);
                            if (aKey11 === 'stock_point') stockBonus += Number(aVal11) || 0;
                        }
                    }
                }
            }
            
            attrs.stock.max = attrs.saving.remain + stockBonus;
            // 최소값 보정: stock.max는 최소 0
            if (attrs.stock.max < 0) attrs.stock.max = 0;
            
            attrs.stock.value = attrs.stock.value ?? 0;
            attrs.stock.min = attrs.stock.min ?? 0;
            if (attrs.stock.value < attrs.stock.min) attrs.stock.value = attrs.stock.min;
            // value는 max를 초과할 수 있음 (일시적 초과 허용)

            // 침식도/경험치 기본값 보정
            attrs.encroachment.max = 100;
            attrs.encroachment.min = attrs.encroachment.min ?? 0;
            if (attrs.encroachment.value < attrs.encroachment.min) attrs.encroachment.value = attrs.encroachment.min;
            
            // 침식률 초기값 계산 (input + 이펙트 아이템들의 encroach.init 합산 + 레코드 아이템들의 encroachment 합산)
            let encroachInitSum = 0;
            for (const effect of this.items.filter(i => i.type === 'effect')) {
                const encroachInit = Number(effect.system?.encroach?.init) || 0;
                encroachInitSum += encroachInit;
            }
            
            // 레코드 아이템의 encroachment 합산
            for (const record of this.items.filter(i => i.type === 'record')) {
                const recordEncroach = Number(record.system?.encroachment) || 0;
                encroachInitSum += recordEncroach;
            }
            
            const encroachInput = Number(attrs.encroachment.init?.input) || 0;
            attrs.encroachment.init.value = encroachInput + encroachInitSum;

            // 레코드 아이템의 경험치 합산
            let recordExpSum = 0;
            const recordItems = this.items.filter(i => i.type === 'record');
            for (const record of recordItems) {
                const recordExp = Number(record.system?.exp) || 0;
                recordExpSum += recordExp;
            }

            attrs.exp.init = Number(attrs.exp.init) || 0;
            attrs.exp.append = recordExpSum;
            attrs.exp.total = attrs.exp.init + attrs.exp.append;
            
            // 경험치 차감 계산 (exp.now)
            let expReduction = 0;
            
            // 능력치 경험치 차감 계산
            for (const key of ["body", "sense", "mind", "social"]) {
                const stat = attrs[key];
                const point = stat.point || 0;
                
                // 신드롬 보너스 계산
                let syndromeBonus = 0;
                const syndromeList = attrs.syndrome || [];
                const syndromeItems = this.items.filter(item => item.type === 'syndrome');
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
                
                // 워크스 보너스 계산
                let worksBonus = 0;
                const worksItems = this.items.filter(item => item.type === 'works');
                for (const worksItem of worksItems) {
                    if (worksItem.system?.attributes?.[key]?.value) {
                        worksBonus += window.DX3rdFormulaEvaluator.evaluate(worksItem.system.attributes[key].value, worksItem, this);
                    }
                }
                
                const bonus = syndromeBonus + worksBonus;
                
                // 전체 점수 (신드롬 + 워크스 + 포인트)
                const totalPoint = point + bonus;
                
                let abilityExpReduction = 0;
                
                // 0~11: 1당 10점
                if (totalPoint > 11) {
                    abilityExpReduction += (11 - 0) * 10;
                } else {
                    abilityExpReduction += (totalPoint - 0) * 10;
                }
                
                // 12~21: 1당 20점
                if (totalPoint > 21) {
                    abilityExpReduction += (21 - 11) * 20;
                } else if (totalPoint > 11) {
                    abilityExpReduction += (totalPoint - 11) * 20;
                }
                
                // 22 이상: 1당 30점
                if (totalPoint > 21) {
                    abilityExpReduction += (totalPoint - 21) * 30;
                }
                
                // 신드롬+워크스 보너스 차감
                if (bonus > 0) {
                    abilityExpReduction -= bonus * 10;
                }
                
                expReduction += abilityExpReduction;
            }
            
            // 스킬 경험치 차감 계산
            for (const [key, skill] of Object.entries(skills)) {
                const point = skill.point || 0;
                const worksBonus = skill.works || 0;
                const totalPoint = point + worksBonus;
                const isDeletable = skill.delete || false;
                
                let skillExpReduction = 0;
                
                if (isDeletable) {
                    // delete=true: 0~6(1), 7~11(3), 12~21(5), 22+(10)
                    // 0~6: 1당 1점
                    if (totalPoint > 6) {
                        skillExpReduction += (6 - 0) * 1;
                    } else {
                        skillExpReduction += (totalPoint - 0) * 1;
                    }
                    
                    // 7~11: 1당 3점
                    if (totalPoint > 11) {
                        skillExpReduction += (11 - 6) * 3;
                    } else if (totalPoint > 6) {
                        skillExpReduction += (totalPoint - 6) * 3;
                    }
                    
                    // 12~21: 1당 5점
                    if (totalPoint > 21) {
                        skillExpReduction += (21 - 11) * 5;
                    } else if (totalPoint > 11) {
                        skillExpReduction += (totalPoint - 11) * 5;
                    }
                    
                    // 22 이상: 1당 10점
                    if (totalPoint > 21) {
                        skillExpReduction += (totalPoint - 21) * 10;
                    }
                } else {
                    // delete=false: 0~6(2), 7~11(3), 12~21(5), 22+(10)
                    // 0~6: 1당 2점
                    if (totalPoint > 6) {
                        skillExpReduction += (6 - 0) * 2;
                    } else {
                        skillExpReduction += (totalPoint - 0) * 2;
                    }
                    
                    // 7~11: 1당 3점
                    if (totalPoint > 11) {
                        skillExpReduction += (11 - 6) * 3;
                    } else if (totalPoint > 6) {
                        skillExpReduction += (totalPoint - 6) * 3;
                    }
                    
                    // 12~21: 1당 5점
                    if (totalPoint > 21) {
                        skillExpReduction += (21 - 11) * 5;
                    } else if (totalPoint > 11) {
                        skillExpReduction += (totalPoint - 11) * 5;
                    }
                    
                    // 22 이상: 1당 10점
                    if (totalPoint > 21) {
                        skillExpReduction += (totalPoint - 21) * 10;
                    }
                }
                
                // 워크스 보너스 차감 (delete=false는 2배, delete=true는 1배)
                if (worksBonus > 0) {
                    const bonusMultiplier = isDeletable ? 1 : 2;
                    skillExpReduction -= worksBonus * bonusMultiplier;
                }
                
                expReduction += skillExpReduction;
            }
            
            // Effect 아이템들의 경험치 차감 계산
            const effectItems = this.items.filter(i => i.type === 'effect');
            for (const effect of effectItems) {
                const expOwn = effect.system?.exp?.own || false;
                const expUpgrade = effect.system?.exp?.upgrade || false;
                const effectType = effect.system?.type || 'normal';
                const levelInit = effect.system?.level?.init || 1;
                
                if (effectType === 'easy') {
                    // easy 타입
                    if (expOwn) {
                        expReduction += 2;
                    }
                    if (expUpgrade && levelInit >= 2) {
                        // level 2일 때 -2, level 3일 때 -4 (누적이 아닌 레벨당 -2)
                        expReduction += (levelInit - 1) * 2;
                    }
                } else if (effectType === 'normal') {
                    // normal 타입
                    if (expOwn) {
                        expReduction += 15;
                    }
                    if (expUpgrade && levelInit >= 2) {
                        // level 2일 때 -5, level 3일 때 -10 (누적이 아닌 레벨당 -5)
                        expReduction += (levelInit - 1) * 5;
                    }
                }
            }
            
            // Psionic 아이템들의 경험치 차감 계산
            const psionicItems = this.items.filter(i => i.type === 'psionic');
            for (const psionic of psionicItems) {
                const expOwn = psionic.system?.exp?.own || false;
                const expUpgrade = psionic.system?.exp?.upgrade || false;
                const levelInit = psionic.system?.level?.init || 1;
                
                if (expOwn) {
                    expReduction += 15;
                }
                if (expUpgrade && levelInit >= 2) {
                    // level 2일 때 -5, level 3일 때 -10 (누적이 아닌 레벨당 -5)
                    expReduction += (levelInit - 1) * 5;
                }
            }
            
            // Rois 아이템들의 경험치 차감 계산 (type이 M인 경우 15점 차감)
            const roisItems = this.items.filter(i => i.type === 'rois');
            for (const rois of roisItems) {
                const roisType = rois.system?.type || '-';
                if (roisType === 'M') {
                    expReduction += 15;
                }
            }
            
            // Spell 아이템들의 경험치 차감 계산
            const spellItems = this.items.filter(i => i.type === 'spell');
            for (const spell of spellItems) {
                const temporarySpell = spell.system?.temporarySpell || false;
                if (!temporarySpell) {
                    const spellExp = Number(spell.system?.exp) || 0;
                    expReduction += spellExp;
                }
            }
            
            // Weapon, Protect, Vehicle, Book, Connection, Etc 아이템들의 경험치 차감 계산
            const expItemTypes = ['weapon', 'protect', 'vehicle', 'book', 'connection', 'etc'];
            for (const itemType of expItemTypes) {
                const items = this.items.filter(i => i.type === itemType);
                for (const item of items) {
                    const itemExp = Number(item.system?.exp) || 0;
                    expReduction += itemExp;
                }
            }
            
            // Once 아이템들의 경험치 차감 계산
            const onceItems = this.items.filter(i => i.type === 'once');
            for (const once of onceItems) {
                const quantity = Number(once.system?.quantity) || 1;
                const onceExp = Number(once.system?.exp) || 0;
                expReduction += quantity * onceExp;
            }
            
            attrs.exp.now = attrs.exp.total - expReduction;
            
            // 경험치 할인 적용
            const discount = Number(attrs.exp?.discount) || 0;
            attrs.exp.now += discount;
            // 최대값 보정: exp.now는 exp.total을 넘지 못함
            if (attrs.exp.now > attrs.exp.total) attrs.exp.now = attrs.exp.total;

            // === 크리티컬 하한치 계산 ===
            const defaultCritical = game.settings.get("dx3rd-emanim", "defaultCritical") || 10; // 기본값
            let criticalMin = defaultCritical;
            
            for (const item of activeItems) {
                if (item.system?.attributes) {
                    for (const [attrKey, attrData] of Object.entries(item.system.attributes)) {
                        if (attrData.key === 'critical_min' && attrData.value) {
                            const value = window.DX3rdFormulaEvaluator.evaluate(attrData.value, item, this);
                            if (value < criticalMin) {
                                criticalMin = value;
                            }
                        }
                    }
                }
            }
            
            // Applied 효과의 critical_min 확인
            for (const [appliedKey, appliedEffect] of Object.entries(appliedEffects)) {
                if (appliedEffect && appliedEffect.attributes) {
                    for (const [attrName, attrValue] of Object.entries(appliedEffect.attributes)) {
                        const aKey12 = (typeof attrValue === 'object') ? attrValue.key : attrName;
                        const aVal12 = (typeof attrValue === 'object' && 'value' in attrValue) ? attrValue.value : window.DX3rdFormulaEvaluator.evaluate(attrValue);
                        if (aKey12 === 'critical_min') {
                            const value = Number(aVal12) || 0;
                            if (value < criticalMin) criticalMin = value;
                        }
                    }
                }
            }
            
            // 크리티컬 하한치 설정 (최소값 2로 제한)
            if (!attrs.critical) attrs.critical = {};
            attrs.critical.min = Math.max(2, criticalMin);

            // === 2차 패스: 능력치 dice, add, critical 계산 (이제 모든 total이 준비됨) ===
            for (const key of ["body", "sense", "mind", "social"]) {
                const stat = attrs[key];
                
                // dice 계산: total + 침식률 + dice(일반) + stat_dice[능력치]
                let abilityDiceBonus = 0;
                let abilityStatDiceBonus = 0;
                
                for (const item of activeItems) {
                    if (item.system?.attributes) {
                        for (const [attrKey, attrData] of Object.entries(item.system.attributes)) {
                            if (attrData.key === 'dice' && attrData.value) {
                                abilityDiceBonus += window.DX3rdFormulaEvaluator.evaluate(attrData.value, item, this);
                            }
                            if (attrData.key === 'stat_dice' && attrData.label === key && attrData.value) {
                                abilityStatDiceBonus += window.DX3rdFormulaEvaluator.evaluate(attrData.value, item, this);
                            }
                        }
                    }
                }
                
                for (const [appliedKey, appliedEffect] of Object.entries(appliedEffects)) {
                    if (appliedEffect && appliedEffect.attributes) {
                        for (const [attrName, attrValue] of Object.entries(appliedEffect.attributes)) {
                            const aKey13 = (typeof attrValue === 'object') ? attrValue.key : (attrName.split(':')[0] || attrName);
                            const aLabel13 = (typeof attrValue === 'object') ? attrValue.label : (attrName.split(':')[1] || attrName);
                            const aVal13 = (typeof attrValue === 'object' && 'value' in attrValue) ? attrValue.value : window.DX3rdFormulaEvaluator.evaluate(attrValue);
                            if (aKey13 === 'dice') abilityDiceBonus += Number(aVal13) || 0;
                            if (aKey13 === 'stat_dice' && aLabel13 === key) abilityStatDiceBonus += Number(aVal13) || 0;
                        }
                    }
                }
                
                stat.dice = stat.total + (attrs.encroachment?.dice || 0) + abilityDiceBonus + abilityStatDiceBonus;
                // 최소값 보정: dice는 최소 1
                if (stat.dice < 1) stat.dice = 1;
                
                // add 계산: add(일반) + stat_add[능력치]
                let abilityAddBonus = 0;
                let abilityStatAddBonus = 0;
                
                for (const item of activeItems) {
                    if (item.system?.attributes) {
                        for (const [attrKey, attrData] of Object.entries(item.system.attributes)) {
                            if (attrData.key === 'add' && attrData.value) {
                                abilityAddBonus += window.DX3rdFormulaEvaluator.evaluate(attrData.value, item, this);
                            }
                            if (attrData.key === 'stat_add' && attrData.label === key && attrData.value) {
                                abilityStatAddBonus += window.DX3rdFormulaEvaluator.evaluate(attrData.value, item, this);
                            }
                        }
                    }
                }
                
                for (const [appliedKey, appliedEffect] of Object.entries(appliedEffects)) {
                    if (appliedEffect && appliedEffect.attributes) {
                        for (const [attrName, attrValue] of Object.entries(appliedEffect.attributes)) {
                            const aKey14 = (typeof attrValue === 'object') ? attrValue.key : (attrName.split(':')[0] || attrName);
                            const aLabel14 = (typeof attrValue === 'object') ? attrValue.label : (attrName.split(':')[1] || attrName);
                            const aVal14 = (typeof attrValue === 'object' && 'value' in attrValue) ? attrValue.value : window.DX3rdFormulaEvaluator.evaluate(attrValue);
                            if (aKey14 === 'add') abilityAddBonus += Number(aVal14) || 0;
                            if (aKey14 === 'stat_add' && aLabel14 === key) abilityStatAddBonus += Number(aVal14) || 0;
                        }
                    }
                }
                
                stat.add = abilityAddBonus + abilityStatAddBonus;
                
                // critical 계산: max(critical.min, defaultCritical + critical(일반))
                let abilityCriticalMod = 0;
                
                for (const item of activeItems) {
                    if (item.system?.attributes) {
                        for (const [attrKey, attrData] of Object.entries(item.system.attributes)) {
                            if (attrData.key === 'critical' && attrData.value) {
                                abilityCriticalMod += window.DX3rdFormulaEvaluator.evaluate(attrData.value, item, this);
                            }
                        }
                    }
                }
                
                for (const [appliedKey, appliedEffect] of Object.entries(appliedEffects)) {
                    if (appliedEffect && appliedEffect.attributes) {
                        for (const [attrName, attrValue] of Object.entries(appliedEffect.attributes)) {
                            if (attrName === 'critical') {
                                abilityCriticalMod += window.DX3rdFormulaEvaluator.evaluate(attrValue);
                            }
                        }
                    }
                }
                
                const calculatedCritical = defaultCritical + abilityCriticalMod;
                stat.critical = Math.max(attrs.critical?.min || defaultCritical, calculatedCritical);
                
                // major, reaction, dodge 판정별 dice, critical, add 계산
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
                
                // 장착된 프로텍트의 dodge 값 추가 (dodge_add에 적용)
                const equippedProtectsForDodge = this.items.filter(i => i.type === 'protect' && i.system?.equipment === true);
                for (const protect of equippedProtectsForDodge) {
                    if (protect.system?.dodge) {
                        const dodgeValue = window.DX3rdFormulaEvaluator.evaluate(protect.system.dodge, protect, this);
                        dodgeAddBonus += dodgeValue;
                    }
                }
                
                for (const item of activeItems) {
                    if (item.system?.attributes) {
                        for (const [attrKey, attrData] of Object.entries(item.system.attributes)) {
                            const evalValue = window.DX3rdFormulaEvaluator.evaluate(attrData.value, item, this);
                            
                            if (attrData.key === 'major_dice' && attrData.value) majorDiceBonus += evalValue;
                            if (attrData.key === 'major_critical' && attrData.value) majorCriticalMod += evalValue;
                            if (attrData.key === 'major_add' && attrData.value) majorAddBonus += evalValue;
                            
                            if (attrData.key === 'reaction_dice' && attrData.value) reactionDiceBonus += evalValue;
                            if (attrData.key === 'reaction_critical' && attrData.value) reactionCriticalMod += evalValue;
                            if (attrData.key === 'reaction_add' && attrData.value) reactionAddBonus += evalValue;
                            
                            if (attrData.key === 'dodge_dice' && attrData.value) dodgeDiceBonus += evalValue;
                            if (attrData.key === 'dodge_critical' && attrData.value) dodgeCriticalMod += evalValue;
                            if (attrData.key === 'dodge_add' && attrData.value) dodgeAddBonus += evalValue;
                        }
                    }
                }
                
                for (const [appliedKey, appliedEffect] of Object.entries(appliedEffects)) {
                    if (appliedEffect && appliedEffect.attributes) {
                        for (const [attrName, attrValue] of Object.entries(appliedEffect.attributes)) {
                            const aKey15 = (typeof attrValue === 'object') ? attrValue.key : attrName;
                            const evalValue = (typeof attrValue === 'object' && 'value' in attrValue) ? (Number(attrValue.value) || 0) : window.DX3rdFormulaEvaluator.evaluate(attrValue);
                            if (aKey15 === 'major_dice') majorDiceBonus += evalValue;
                            if (aKey15 === 'major_critical') majorCriticalMod += evalValue;
                            if (aKey15 === 'major_add') majorAddBonus += evalValue;
                            if (aKey15 === 'reaction_dice') reactionDiceBonus += evalValue;
                            if (aKey15 === 'reaction_critical') reactionCriticalMod += evalValue;
                            if (aKey15 === 'reaction_add') reactionAddBonus += evalValue;
                            if (aKey15 === 'dodge_dice') dodgeDiceBonus += evalValue;
                            if (aKey15 === 'dodge_critical') dodgeCriticalMod += evalValue;
                            if (aKey15 === 'dodge_add') dodgeAddBonus += evalValue;
                        }
                    }
                }
                
                // 판정 타입별 최종 값 저장
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
            }

            // === 2차 패스: 스킬 dice, add, critical 계산 및 분류 ===
            system.skills = { body: {}, sense: {}, mind: {}, social: {} };

            for (const [key, skill] of Object.entries(skills)) {
                // dice 계산: 기본능력치.dice + stat_dice[스킬]
                const baseAbility = attrs[skill.base];
                let baseDice = baseAbility ? baseAbility.dice || 0 : 0;
                let skillStatDiceBonus = 0;
                
                for (const item of activeItems) {
                    if (item.system?.attributes) {
                        for (const [attrKey, attrData] of Object.entries(item.system.attributes)) {
                            // 직접 스킬 매칭 또는 그룹 매칭
                            if (attrData.key === 'stat_dice' && attrData.value) {
                                const matchesDirect = attrData.label === key;
                                const matchesGroup = window.DX3rdSkillGroupMatcher?.isSkillInGroup(key, attrData.label);
                                if (matchesDirect || matchesGroup) {
                                    skillStatDiceBonus += window.DX3rdFormulaEvaluator.evaluate(attrData.value, item, this);
                                }
                            }
                        }
                    }
                }
                
                for (const [appliedKey, appliedEffect] of Object.entries(appliedEffects)) {
                    if (appliedEffect && appliedEffect.attributes) {
                        for (const [attrName, attrValue] of Object.entries(appliedEffect.attributes)) {
                            const aKeySD = (typeof attrValue === 'object') ? attrValue.key : (attrName.split(':')[0] || attrName);
                            const aLabelSD = (typeof attrValue === 'object') ? attrValue.label : (attrName.split(':')[1] || attrName);
                            const aValSD = (typeof attrValue === 'object' && 'value' in attrValue) ? attrValue.value : 
                                          (typeof attrValue === 'boolean') ? 0 : window.DX3rdFormulaEvaluator.evaluate(attrValue);
                            // 직접 스킬 매칭 또는 그룹 매칭
                            const matchesDirect = aKeySD === 'stat_dice' && aLabelSD === key;
                            const matchesGroup = aKeySD === 'stat_dice' && window.DX3rdSkillGroupMatcher?.isSkillInGroup(key, aLabelSD);
                            if (matchesDirect || matchesGroup) {
                                skillStatDiceBonus += Number(aValSD) || 0;
                            }
                        }
                    }
                }
                
                skill.dice = baseDice + skillStatDiceBonus;
                // 최소값 보정: dice는 최소 1
                if (skill.dice < 1) skill.dice = 1;
                
                // add 계산: add(일반) + stat_add[능력치] + stat_add[스킬]
                let skillAddBonus = 0;
                let skillAbilityAddBonus = 0;
                let skillStatAddBonus = 0;
                
                for (const item of activeItems) {
                    if (item.system?.attributes) {
                        for (const [attrKey, attrData] of Object.entries(item.system.attributes)) {
                            if (attrData.key === 'add' && attrData.value) {
                                skillAddBonus += window.DX3rdFormulaEvaluator.evaluate(attrData.value, item, this);
                            }
                            if (attrData.key === 'stat_add' && attrData.label === skill.base && attrData.value) {
                                skillAbilityAddBonus += window.DX3rdFormulaEvaluator.evaluate(attrData.value, item, this);
                            }
                            // 직접 스킬 매칭 또는 그룹 매칭
                            if (attrData.key === 'stat_add' && attrData.value) {
                                const matchesDirect = attrData.label === key;
                                const matchesGroup = window.DX3rdSkillGroupMatcher?.isSkillInGroup(key, attrData.label);
                                if (matchesDirect || matchesGroup) {
                                    skillStatAddBonus += window.DX3rdFormulaEvaluator.evaluate(attrData.value, item, this);
                                }
                            }
                        }
                    }
                }
                
                for (const [appliedKey, appliedEffect] of Object.entries(appliedEffects)) {
                    if (appliedEffect && appliedEffect.attributes) {
                        for (const [attrName, attrValue] of Object.entries(appliedEffect.attributes)) {
                            const aKeySA = (typeof attrValue === 'object') ? attrValue.key : (attrName.split(':')[0] || attrName);
                            const aLabelSA = (typeof attrValue === 'object') ? attrValue.label : (attrName.split(':')[1] || attrName);
                            const aValSA = (typeof attrValue === 'object' && 'value' in attrValue) ? attrValue.value : 
                                          (typeof attrValue === 'boolean') ? 0 : window.DX3rdFormulaEvaluator.evaluate(attrValue);
                            if (aKeySA === 'add') skillAddBonus += Number(aValSA) || 0;
                            if (aKeySA === 'stat_add' && aLabelSA === skill.base) skillAbilityAddBonus += Number(aValSA) || 0;
                            // 직접 스킬 매칭 또는 그룹 매칭
                            const matchesDirect = aKeySA === 'stat_add' && aLabelSA === key;
                            const matchesGroup = aKeySA === 'stat_add' && window.DX3rdSkillGroupMatcher?.isSkillInGroup(key, aLabelSA);
                            if (matchesDirect || matchesGroup) {
                                skillStatAddBonus += Number(aValSA) || 0;
                            }
                        }
                    }
                }
                
                skill.add = skill.total + skillAddBonus + skillAbilityAddBonus + skillStatAddBonus;
                
                // critical 계산: 기본능력치의 critical 값 사용
                skill.critical = baseAbility ? baseAbility.critical || defaultCritical : defaultCritical;
                
                // major, reaction, dodge 판정별 dice, critical, add 계산
                let majorDiceBonus = 0;
                let majorCriticalMod = 0;
                let majorAddBonus = 0;
                
                let reactionDiceBonus = 0;
                let reactionCriticalMod = 0;
                let reactionAddBonus = 0;
                
                let dodgeDiceBonus = 0;
                let dodgeCriticalMod = 0;
                let dodgeAddBonus = 0;
                
                // 장착된 프로텍트의 dodge 값 추가 (dodge_add에 적용)
                const equippedProtectsForSkill = this.items.filter(i => i.type === 'protect' && i.system?.equipment === true);
                for (const protect of equippedProtectsForSkill) {
                    if (protect.system?.dodge) {
                        const dodgeValue = window.DX3rdFormulaEvaluator.evaluate(protect.system.dodge, protect, this);
                        dodgeAddBonus += dodgeValue;
                    }
                }
                
                for (const item of activeItems) {
                    if (item.system?.attributes) {
                        for (const [attrKey, attrData] of Object.entries(item.system.attributes)) {
                            const evalValue = window.DX3rdFormulaEvaluator.evaluate(attrData.value, item, this);
                            
                            if (attrData.key === 'major_dice' && attrData.value) majorDiceBonus += evalValue;
                            if (attrData.key === 'major_critical' && attrData.value) majorCriticalMod += evalValue;
                            if (attrData.key === 'major_add' && attrData.value) majorAddBonus += evalValue;
                            
                            if (attrData.key === 'reaction_dice' && attrData.value) reactionDiceBonus += evalValue;
                            if (attrData.key === 'reaction_critical' && attrData.value) reactionCriticalMod += evalValue;
                            if (attrData.key === 'reaction_add' && attrData.value) reactionAddBonus += evalValue;
                            
                            if (attrData.key === 'dodge_dice' && attrData.value) dodgeDiceBonus += evalValue;
                            if (attrData.key === 'dodge_critical' && attrData.value) dodgeCriticalMod += evalValue;
                            if (attrData.key === 'dodge_add' && attrData.value) dodgeAddBonus += evalValue;
                        }
                    }
                }
                
                for (const [appliedKey, appliedEffect] of Object.entries(appliedEffects)) {
                    if (appliedEffect && appliedEffect.attributes) {
                        for (const [attrName, attrValue] of Object.entries(appliedEffect.attributes)) {
                            const aKey17 = (typeof attrValue === 'object') ? attrValue.key : attrName;
                            const evalValue2 = (typeof attrValue === 'object' && 'value' in attrValue) ? (Number(attrValue.value) || 0) : window.DX3rdFormulaEvaluator.evaluate(attrValue);
                            if (aKey17 === 'major_dice') majorDiceBonus += evalValue2;
                            if (aKey17 === 'major_critical') majorCriticalMod += evalValue2;
                            if (aKey17 === 'major_add') majorAddBonus += evalValue2;
                            if (aKey17 === 'reaction_dice') reactionDiceBonus += evalValue2;
                            if (aKey17 === 'reaction_critical') reactionCriticalMod += evalValue2;
                            if (aKey17 === 'reaction_add') reactionAddBonus += evalValue2;
                            if (aKey17 === 'dodge_dice') dodgeDiceBonus += evalValue2;
                            if (aKey17 === 'dodge_critical') dodgeCriticalMod += evalValue2;
                            if (aKey17 === 'dodge_add') dodgeAddBonus += evalValue2;
                        }
                    }
                }
                
                // 판정 타입별 최종 값 저장
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

                // base가 올바른 경우만 분류
                if (skill.base && system.skills[skill.base]) {
                    system.skills[skill.base][key] = skill;
                }
            }

            // 기타 주요 속성 기본값 보정
            system.sublimation = system.sublimation || { dice: 0, critical: 0, cast_dice: 0, cast_add: 0 };
            system.details = system.details || {};
            system.conditions = system.conditions || {};

            // 캐스팅 관련 파생치 최종 계산 (모든 스킬 계산 완료 후)
            this._prepareCastingStats();
        }

        _prepareActorEnc() {
            let enc = this.system.attributes.encroachment;
            let encType = enc.type || "-";  // type이 없으면 "-" 사용
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

            // encType이 유효하지 않은 경우 "-" 사용
            if (!encList[encType]) {
                encType = "-";
            }

            // dice 보정
            for (let threshold of encList[encType].dice) {
                if (enc.value < threshold) break;
                enc.dice += 1;
            }

            // level 보정
            for (let threshold of encList[encType].level) {
                if (enc.value < threshold) break;
                enc.level += 1;
            }
        }

        /**
         * 캐스팅 관련 파생치 계산
         * - cast.dice = round((mind.total + skills.will.total) / 2) + sum(cast_dice from active/applied)
         * - cast.add = sum(cast_add from active/applied)
         * - cast.eibon = round(skills.cthulhu.total / 4)
         */
        _prepareCastingStats() {
            const attrs = this.system.attributes;
            const activeItems = (this.items || []).filter(i => i.system?.active?.state);
            const appliedEffects = this.system.attributes?.applied || {};

            // base dice from ability/skill totals
            const mindTotal = attrs.mind?.total || 0;
            const willTotal = attrs.skills?.will?.total || 0;
            let castDice = Math.round((mindTotal + willTotal) / 2);
            let castAdd = 0;

            // add contributions from active item attributes
            for (const item of activeItems) {
                const attrsMap = item.system?.attributes || {};
                for (const [k, a] of Object.entries(attrsMap)) {
                    if (!a?.key || !a?.value) continue;
                    if (a.key === 'cast_dice') castDice += window.DX3rdFormulaEvaluator.evaluate(a.value, item, this);
                    if (a.key === 'cast_add') castAdd += window.DX3rdFormulaEvaluator.evaluate(a.value, item, this);
                }
            }

            // applied effects
            for (const eff of Object.values(appliedEffects)) {
                const map = eff?.attributes || {};
                for (const [name, val] of Object.entries(map)) {
                    if (name === 'cast_dice') castDice += window.DX3rdFormulaEvaluator.evaluate(val);
                    if (name === 'cast_add') castAdd += window.DX3rdFormulaEvaluator.evaluate(val);
                }
            }

            // eibon = round(cthulhu / 4)
            const cthulhuTotal = attrs.skills?.cthulhu?.total || 0;
            const eibon = Math.round(cthulhuTotal / 4);

            attrs.cast = attrs.cast || { dice: 0, add: 0, eibon: 0 };
            attrs.cast.dice = castDice;
            // 최소값 보정: cast.dice는 최소 1
            if (attrs.cast.dice < 1) attrs.cast.dice = 1;
            attrs.cast.add = castAdd;
            attrs.cast.eibon = eibon;
            // 최소값 보정: cast.eibon은 최소 0
            if (attrs.cast.eibon < 0) attrs.cast.eibon = 0;
        }

        /**
         * Enemy 타입 전용 간소화된 능력치 계산
         * HP, 행동치, 이동력, 전투 관련 속성만 계산
         */
        _prepareEnemyAttributes() {
            const system = this.system;
            const attrs = system.attributes;
            const defaultCritical = game.settings.get("dx3rd-emanim", "defaultCritical") || 10;

            // 활성 아이템 (combo, effect만)
            const activeItems = this.items.filter(item => 
                item.system?.active?.state === true && 
                ['combo', 'effect'].includes(item.type)
            );
            const appliedEffects = attrs.applied || {};

            // === 크리티컬 하한치 계산 (능력치 critical 계산보다 먼저 실행) ===
            let criticalMin = attrs.critical?.min || defaultCritical;
            for (const item of activeItems) {
                if (item.system?.attributes) {
                    for (const [attrKey, attrData] of Object.entries(item.system.attributes)) {
                        if (attrData.key === 'critical_min' && attrData.value) {
                            const value = window.DX3rdFormulaEvaluator.evaluate(attrData.value, item, this);
                            if (value < criticalMin) criticalMin = value;
                        }
                    }
                }
            }
            for (const [appliedKey, appliedEffect] of Object.entries(appliedEffects)) {
                if (appliedEffect && appliedEffect.attributes) {
                    for (const [attrName, attrValue] of Object.entries(appliedEffect.attributes)) {
                        const aKey = (typeof attrValue === 'object') ? attrValue.key : attrName;
                        const aVal = (typeof attrValue === 'object' && 'value' in attrValue) ? attrValue.value : window.DX3rdFormulaEvaluator.evaluate(attrValue);
                        if (aKey === 'critical_min') {
                            const value = Number(aVal) || 0;
                            if (value < criticalMin) criticalMin = value;
                        }
                    }
                }
            }
            if (!attrs.critical) attrs.critical = {};
            attrs.critical.min = Math.max(2, criticalMin);

            // === 능력치 total 계산 (bonus, dice, add 포함) ===
            for (const key of ["body", "sense", "mind", "social"]) {
                const stat = attrs[key];
                
                // 활성화된 아이템들의 stat_bonus 계산
                let itemBonus = 0;
                for (const item of activeItems) {
                    if (item.system?.attributes) {
                        for (const [attrKey, attrData] of Object.entries(item.system.attributes)) {
                            if (attrData.key === 'stat_bonus' && attrData.label === key && attrData.value) {
                                itemBonus += window.DX3rdFormulaEvaluator.evaluate(attrData.value, item, this);
                            }
                        }
                    }
                }

                // Applied 효과의 stat_bonus 계산
                let appliedBonus = 0;
                for (const [appliedKey, appliedEffect] of Object.entries(appliedEffects)) {
                    if (appliedEffect && appliedEffect.attributes) {
                        for (const [attrName, attrValue] of Object.entries(appliedEffect.attributes)) {
                            const aKey = (typeof attrValue === 'object' && attrValue) ? attrValue.key : (attrName.split(':')[0] || attrName);
                            const aLabel = (typeof attrValue === 'object' && attrValue) ? attrValue.label : (attrName.split(':')[1] || attrName);
                            const aVal = (typeof attrValue === 'object' && attrValue && 'value' in attrValue) ? attrValue.value : 
                                        (typeof attrValue === 'boolean') ? 0 : window.DX3rdFormulaEvaluator.evaluate(attrValue);
                            if (aKey === 'stat_bonus' && aLabel === key) {
                                appliedBonus += Number(aVal) || 0;
                            }
                        }
                    }
                }

                stat.bonus = itemBonus + appliedBonus;
                stat.total = (stat.point || 0) + (stat.extra || 0) + stat.bonus;
                if (stat.total < 0) stat.total = 0;

                // dice 계산: total + dice(일반) + stat_dice[능력치]
                let diceBonus = 0;
                let statDiceBonus = 0;
                
                for (const item of activeItems) {
                    if (item.system?.attributes) {
                        for (const [attrKey, attrData] of Object.entries(item.system.attributes)) {
                            if (attrData.key === 'dice' && attrData.value) {
                                diceBonus += window.DX3rdFormulaEvaluator.evaluate(attrData.value, item, this);
                            }
                            if (attrData.key === 'stat_dice' && attrData.label === key && attrData.value) {
                                statDiceBonus += window.DX3rdFormulaEvaluator.evaluate(attrData.value, item, this);
                            }
                        }
                    }
                }
                
                for (const [appliedKey, appliedEffect] of Object.entries(appliedEffects)) {
                    if (appliedEffect && appliedEffect.attributes) {
                        for (const [attrName, attrValue] of Object.entries(appliedEffect.attributes)) {
                            const aKey = (typeof attrValue === 'object') ? attrValue.key : (attrName.split(':')[0] || attrName);
                            const aLabel = (typeof attrValue === 'object') ? attrValue.label : (attrName.split(':')[1] || attrName);
                            const aVal = (typeof attrValue === 'object' && 'value' in attrValue) ? attrValue.value : window.DX3rdFormulaEvaluator.evaluate(attrValue);
                            if (aKey === 'dice') diceBonus += Number(aVal) || 0;
                            if (aKey === 'stat_dice' && aLabel === key) statDiceBonus += Number(aVal) || 0;
                        }
                    }
                }
                
                stat.dice = stat.total + diceBonus + statDiceBonus;
                if (stat.dice < 1) stat.dice = 1;
                
                // add 계산
                let addBonus = 0;
                let statAddBonus = 0;
                
                for (const item of activeItems) {
                    if (item.system?.attributes) {
                        for (const [attrKey, attrData] of Object.entries(item.system.attributes)) {
                            if (attrData.key === 'add' && attrData.value) {
                                addBonus += window.DX3rdFormulaEvaluator.evaluate(attrData.value, item, this);
                            }
                            if (attrData.key === 'stat_add' && attrData.label === key && attrData.value) {
                                statAddBonus += window.DX3rdFormulaEvaluator.evaluate(attrData.value, item, this);
                            }
                        }
                    }
                }
                
                for (const [appliedKey, appliedEffect] of Object.entries(appliedEffects)) {
                    if (appliedEffect && appliedEffect.attributes) {
                        for (const [attrName, attrValue] of Object.entries(appliedEffect.attributes)) {
                            const aKey = (typeof attrValue === 'object') ? attrValue.key : (attrName.split(':')[0] || attrName);
                            const aLabel = (typeof attrValue === 'object') ? attrValue.label : (attrName.split(':')[1] || attrName);
                            const aVal = (typeof attrValue === 'object' && 'value' in attrValue) ? attrValue.value : window.DX3rdFormulaEvaluator.evaluate(attrValue);
                            if (aKey === 'add') addBonus += Number(aVal) || 0;
                            if (aKey === 'stat_add' && aLabel === key) statAddBonus += Number(aVal) || 0;
                        }
                    }
                }
                
                stat.add = addBonus + statAddBonus;
                
                // 크리티컬 보정 (enemy 전용 simple critical)
                let abilityCriticalMod = 0;
                for (const item of activeItems) {
                    if (item.system?.attributes) {
                        for (const [attrKey, attrData] of Object.entries(item.system.attributes)) {
                            if (attrData.key === 'critical' && attrData.value) {
                                abilityCriticalMod += window.DX3rdFormulaEvaluator.evaluate(attrData.value, item, this);
                            }
                        }
                    }
                }
                for (const [appliedKey, appliedEffect] of Object.entries(appliedEffects)) {
                    if (appliedEffect && appliedEffect.attributes) {
                        for (const [attrName, attrValue] of Object.entries(appliedEffect.attributes)) {
                            const aKey = (typeof attrValue === 'object') ? attrValue.key : (attrName.split(':')[0] || attrName);
                            const aVal = (typeof attrValue === 'object' && 'value' in attrValue) ? attrValue.value : window.DX3rdFormulaEvaluator.evaluate(attrValue);
                            if (aKey === 'critical') {
                                abilityCriticalMod += Number(aVal) || 0;
                            }
                        }
                    }
                }
                const calculatedCritical = defaultCritical + abilityCriticalMod;
                stat.critical = Math.max(attrs.critical?.min || defaultCritical, calculatedCritical);
                
                // 메이저/리액션/닷지 다이스·수정치·크리티컬 보정 (에너미 판정용)
                let majorDiceBonus = 0;
                let majorAddBonus = 0;
                let majorCriticalMod = 0;
                let reactionDiceBonus = 0;
                let reactionAddBonus = 0;
                let reactionCriticalMod = 0;
                let dodgeDiceBonus = 0;
                let dodgeAddBonus = 0;
                let dodgeCriticalMod = 0;
                for (const item of activeItems) {
                    if (item.system?.attributes) {
                        for (const [attrKey, attrData] of Object.entries(item.system.attributes)) {
                            if (attrData.key === 'major_dice' && attrData.value) {
                                majorDiceBonus += window.DX3rdFormulaEvaluator.evaluate(attrData.value, item, this);
                            }
                            if (attrData.key === 'major_add' && attrData.value) {
                                majorAddBonus += window.DX3rdFormulaEvaluator.evaluate(attrData.value, item, this);
                            }
                            if (attrData.key === 'major_critical' && attrData.value) {
                                majorCriticalMod += window.DX3rdFormulaEvaluator.evaluate(attrData.value, item, this);
                            }
                            if (attrData.key === 'reaction_dice' && attrData.value) {
                                reactionDiceBonus += window.DX3rdFormulaEvaluator.evaluate(attrData.value, item, this);
                            }
                            if (attrData.key === 'reaction_add' && attrData.value) {
                                reactionAddBonus += window.DX3rdFormulaEvaluator.evaluate(attrData.value, item, this);
                            }
                            if (attrData.key === 'reaction_critical' && attrData.value) {
                                reactionCriticalMod += window.DX3rdFormulaEvaluator.evaluate(attrData.value, item, this);
                            }
                            if (attrData.key === 'dodge_dice' && attrData.value) {
                                dodgeDiceBonus += window.DX3rdFormulaEvaluator.evaluate(attrData.value, item, this);
                            }
                            if (attrData.key === 'dodge_add' && attrData.value) {
                                dodgeAddBonus += window.DX3rdFormulaEvaluator.evaluate(attrData.value, item, this);
                            }
                            if (attrData.key === 'dodge_critical' && attrData.value) {
                                dodgeCriticalMod += window.DX3rdFormulaEvaluator.evaluate(attrData.value, item, this);
                            }
                        }
                    }
                }
                for (const [appliedKey, appliedEffect] of Object.entries(appliedEffects)) {
                    if (appliedEffect && appliedEffect.attributes) {
                        for (const [attrName, attrValue] of Object.entries(appliedEffect.attributes)) {
                            const aKey = (typeof attrValue === 'object') ? attrValue.key : (attrName.split(':')[0] || attrName);
                            const aVal = (typeof attrValue === 'object' && 'value' in attrValue) ? attrValue.value : window.DX3rdFormulaEvaluator.evaluate(attrValue);
                            if (aKey === 'major_dice') {
                                majorDiceBonus += Number(aVal) || 0;
                            }
                            if (aKey === 'major_add') {
                                majorAddBonus += Number(aVal) || 0;
                            }
                            if (aKey === 'major_critical') {
                                majorCriticalMod += Number(aVal) || 0;
                            }
                            if (aKey === 'reaction_dice') {
                                reactionDiceBonus += Number(aVal) || 0;
                            }
                            if (aKey === 'reaction_add') {
                                reactionAddBonus += Number(aVal) || 0;
                            }
                            if (aKey === 'reaction_critical') {
                                reactionCriticalMod += Number(aVal) || 0;
                            }
                            if (aKey === 'dodge_dice') {
                                dodgeDiceBonus += Number(aVal) || 0;
                            }
                            if (aKey === 'dodge_add') {
                                dodgeAddBonus += Number(aVal) || 0;
                            }
                            if (aKey === 'dodge_critical') {
                                dodgeCriticalMod += Number(aVal) || 0;
                            }
                        }
                    }
                }
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
            }
            // 활성화된 아이템의 hp 보너스 계산
            let hpBonus = 0;
            for (const item of activeItems) {
                if (item.system?.attributes) {
                    for (const [attrKey, attrData] of Object.entries(item.system.attributes)) {
                        if (attrData.key === 'hp' || attrData.key === 'hp_max') {
                            const bonusValue = window.DX3rdFormulaEvaluator.evaluate(
                                attrData.value,
                                item,
                                this
                            );
                            hpBonus += bonusValue;
                        }
                    }
                }
            }
            
            // Applied 효과의 hp 보너스 계산
            for (const [appliedKey, appliedEffect] of Object.entries(appliedEffects)) {
                if (appliedEffect && appliedEffect.attributes) {
                    for (const [attrName, attrValue] of Object.entries(appliedEffect.attributes)) {
                        const aKey = (typeof attrValue === 'object') ? attrValue.key : attrName;
                        const aVal = (typeof attrValue === 'object' && 'value' in attrValue) ? attrValue.value : 
                                    (typeof attrValue === 'boolean') ? 0 : window.DX3rdFormulaEvaluator.evaluate(attrValue);
                        if (aKey === 'hp' || aKey === 'hp_max') {
                            hpBonus += Number(aVal) || 0;
                        }
                    }
                }
            }
            
            // hp.base가 없으면 기존 max 값을 base로 설정 (마이그레이션)
            if (attrs.hp.base === undefined || attrs.hp.base === null) {
                attrs.hp.base = attrs.hp.max || 0;
            }
            
            attrs.hp.max = (attrs.hp.base || 0) + hpBonus;
            if (attrs.hp.max < 0) attrs.hp.max = 0;
            if (attrs.hp.value > attrs.hp.max) attrs.hp.value = attrs.hp.max;
            if (attrs.hp.value < 0) attrs.hp.value = 0;

            // === 행동치 계산 (base + 보정치) ===
            // 활성화된 아이템의 init 보너스 계산
            let initBonus = 0;
            for (const item of activeItems) {
                if (item.system?.attributes) {
                    for (const [attrKey, attrData] of Object.entries(item.system.attributes)) {
                        if (attrData.key === 'init' || attrData.key === 'initiative') {
                            initBonus += window.DX3rdFormulaEvaluator.evaluate(
                                attrData.value,
                                item,
                                this
                            );
                        }
                    }
                }
            }
            
            // Applied 효과의 init 보너스 계산
            for (const [appliedKey, appliedEffect] of Object.entries(appliedEffects)) {
                if (appliedEffect && appliedEffect.attributes) {
                    for (const [attrName, attrValue] of Object.entries(appliedEffect.attributes)) {
                        const aKey = (typeof attrValue === 'object') ? attrValue.key : attrName;
                        const aVal = (typeof attrValue === 'object' && 'value' in attrValue) ? attrValue.value : 
                                    (typeof attrValue === 'boolean') ? 0 : window.DX3rdFormulaEvaluator.evaluate(attrValue);
                        if (aKey === 'init' || aKey === 'initiative') {
                            initBonus += Number(aVal) || 0;
                        }
                    }
                }
            }
            
            // init.base가 없으면 기존 계산값을 base로 설정 (마이그레이션)
            if (attrs.init.base === undefined || attrs.init.base === null) {
                const calculatedInit = (attrs.sense?.total || 0) * 2 + (attrs.mind?.total || 0);
                attrs.init.base = calculatedInit;
            }
            
            attrs.init.value = (attrs.init.base || 0) + initBonus;
            
            // 폭주 상태이상 체크
            if (system.conditions?.berserk?.active) {
                if (system.conditions.berserk.type === 'release') {
                    attrs.init.value -= 9999;
                } else if (system.conditions.berserk.type === 'delusion') {
                    attrs.init.value -= 10;
                }
            }
            
            if (attrs.init.value < 0) attrs.init.value = 0;

            // === 이동력 계산 (base + 보정치) ===
            // 활성화된 아이템의 move 보너스 계산
            let moveBattleBonus = 0;
            let moveFullBonus = 0;
            for (const item of activeItems) {
                if (item.system?.attributes) {
                    for (const [attrKey, attrData] of Object.entries(item.system.attributes)) {
                        if (attrData.key === 'move' || attrData.key === 'move_battle' || attrData.key === 'battleMove') {
                            moveBattleBonus += window.DX3rdFormulaEvaluator.evaluate(
                                attrData.value,
                                item,
                                this
                            );
                        }
                        if (attrData.key === 'move_full' || attrData.key === 'fullMove') {
                            moveFullBonus += window.DX3rdFormulaEvaluator.evaluate(
                                attrData.value,
                                item,
                                this
                            );
                        }
                    }
                }
            }
            
            // Applied 효과의 move 보너스 계산
            for (const [appliedKey, appliedEffect] of Object.entries(appliedEffects)) {
                if (appliedEffect && appliedEffect.attributes) {
                    for (const [attrName, attrValue] of Object.entries(appliedEffect.attributes)) {
                        const aKey = (typeof attrValue === 'object') ? attrValue.key : attrName;
                        const aVal = (typeof attrValue === 'object' && 'value' in attrValue) ? attrValue.value : 
                                    (typeof attrValue === 'boolean') ? 0 : window.DX3rdFormulaEvaluator.evaluate(attrValue);
                        if (aKey === 'move' || aKey === 'move_battle' || aKey === 'battleMove') {
                            moveBattleBonus += Number(aVal) || 0;
                        }
                        if (aKey === 'move_full' || aKey === 'fullMove') {
                            moveFullBonus += Number(aVal) || 0;
                        }
                    }
                }
            }
            
            // move.base가 없으면 기존 계산값을 base로 설정 (마이그레이션)
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
            
            // 경직 상태이상 체크
            if (system.conditions?.rigor?.active) {
                attrs.move.battle -= 9999;
            }
            
            if (attrs.move.battle < 0) attrs.move.battle = 0;
            
            // 전력이동: 전투이동 total의 2배 + 보정치
            attrs.move.full = attrs.move.battle * 2 + moveFullBonus;
            if (attrs.move.full < 0) attrs.move.full = 0;

            // === Attack, Damage Roll 계산 ===
            let attackBonus = 0;
            let attackBonusMelee = 0;
            let attackBonusRanged = 0;
            let attackBonusFist = 0; // 맨손 한정 공격력(축퇴기관 등)
            let damageRollBonus = 0;
            let damageRollBonusMelee = 0;
            let damageRollBonusRanged = 0;

            for (const item of activeItems) {
                if (item.system?.attributes) {
                    for (const [attrKey, attrData] of Object.entries(item.system.attributes)) {
                        if (attrData.key === 'attack' && attrData.value) {
                            const bonusValue = window.DX3rdFormulaEvaluator.evaluate(attrData.value, item, this);
                            const attackLabel = attrData.label || '-';

                            // label에 따라 분류
                            if (attackLabel === 'melee') {
                                attackBonusMelee += bonusValue;
                            } else if (attackLabel === 'ranged') {
                                attackBonusRanged += bonusValue;
                            } else if (attackLabel === 'fist') {
                                attackBonusFist += bonusValue;
                            } else {
                                // label이 없거나 '-'인 경우 모든 공격에 적용
                                attackBonus += bonusValue;
                            }
                        }
                        if (attrData.key === 'damage_roll' && attrData.value) {
                            const bonusValue = window.DX3rdFormulaEvaluator.evaluate(attrData.value, item, this);
                            const damageRollLabel = attrData.label || '-';
                            
                            // label에 따라 분류
                            if (damageRollLabel === 'melee') {
                                damageRollBonusMelee += bonusValue;
                            } else if (damageRollLabel === 'ranged') {
                                damageRollBonusRanged += bonusValue;
                            } else {
                                // label이 없거나 '-'인 경우 모든 공격에 적용
                                damageRollBonus += bonusValue;
                            }
                        }
                    }
                }
            }
            
            for (const [appliedKey, appliedEffect] of Object.entries(appliedEffects)) {
                if (appliedEffect && appliedEffect.attributes) {
                    for (const [attrName, attrValue] of Object.entries(appliedEffect.attributes)) {
                        const aKey = (typeof attrValue === 'object') ? attrValue.key : attrName;
                        const aLabel = (typeof attrValue === 'object') ? attrValue.label : null;
                        const aVal = (typeof attrValue === 'object' && 'value' in attrValue) ? attrValue.value : 
                                    (typeof attrValue === 'boolean') ? 0 : window.DX3rdFormulaEvaluator.evaluate(attrValue);
                        
                        if (aKey === 'attack') {
                            // label에 따라 분류
                            if (aLabel === 'melee') {
                                attackBonusMelee += Number(aVal) || 0;
                            } else if (aLabel === 'ranged') {
                                attackBonusRanged += Number(aVal) || 0;
                            } else if (aLabel === 'fist') {
                                attackBonusFist += Number(aVal) || 0;
                            } else {
                                // label이 없거나 '-'인 경우 모든 공격에 적용
                                attackBonus += Number(aVal) || 0;
                            }
                        }
                        if (aKey === 'damage_roll') {
                            // label에 따라 분류
                            if (aLabel === 'melee') {
                                damageRollBonusMelee += Number(aVal) || 0;
                            } else if (aLabel === 'ranged') {
                                damageRollBonusRanged += Number(aVal) || 0;
                            } else {
                                // label이 없거나 '-'인 경우 모든 공격에 적용
                                damageRollBonus += Number(aVal) || 0;
                            }
                        }
                    }
                }
            }
            
            if (!attrs.attack) attrs.attack = { value: 0, melee: 0, ranged: 0, fist: 0 };
            attrs.attack.value = attackBonus;
            attrs.attack.melee = attackBonusMelee;
            attrs.attack.ranged = attackBonusRanged;
            attrs.attack.fist = attackBonusFist;

            if (!attrs.damage_roll) attrs.damage_roll = { value: 0, melee: 0, ranged: 0 };
            attrs.damage_roll.value = damageRollBonus;
            attrs.damage_roll.melee = damageRollBonusMelee;
            attrs.damage_roll.ranged = damageRollBonusRanged;

            // === Armor, Guard, Penetrate, Reduce 계산 ===
            let armorBonus = 0;
            let guardBonus = 0;
            let guardRoll = 0;   // 가드 시 굴리는 D10 개수(가드치에 +[N]D10)
            let dxRoll = 0;      // 판정 시 굴리는 D10 개수(달성치에 +[N]D10)
            let penetrateBonus = 0;
            let reduceBonus = 0;
            let reduceRoll = 0;  // 피격 시 굴리는 D10 개수(HP데미지 [N]D10점 경감)
            
            for (const item of activeItems) {
                if (item.system?.attributes) {
                    for (const [attrKey, attrData] of Object.entries(item.system.attributes)) {
                        if (attrData.key === 'armor' && attrData.value) {
                            armorBonus += window.DX3rdFormulaEvaluator.evaluate(attrData.value, item, this);
                        }
                        if (attrData.key === 'guard' && attrData.value) {
                            guardBonus += window.DX3rdFormulaEvaluator.evaluate(attrData.value, item, this);
                        }
                        if (attrData.key === 'guard_roll' && attrData.value) {
                            guardRoll += Number(window.DX3rdFormulaEvaluator.evaluate(attrData.value, item, this)) || 0;
                        }
                        if (attrData.key === 'dxroll' && attrData.value) {
                            dxRoll += Number(window.DX3rdFormulaEvaluator.evaluate(attrData.value, item, this)) || 0;
                        }
                        if (attrData.key === 'penetrate' && attrData.value) {
                            penetrateBonus += window.DX3rdFormulaEvaluator.evaluate(attrData.value, item, this);
                        }
                        if (attrData.key === 'reduce' && attrData.value) {
                            reduceBonus += window.DX3rdFormulaEvaluator.evaluate(attrData.value, item, this);
                        }
                        if (attrData.key === 'reduce_roll' && attrData.value) {
                            reduceRoll += Number(window.DX3rdFormulaEvaluator.evaluate(attrData.value, item, this)) || 0;
                        }
                    }
                }
            }

            for (const [appliedKey, appliedEffect] of Object.entries(appliedEffects)) {
                if (appliedEffect && appliedEffect.attributes) {
                    for (const [attrName, attrValue] of Object.entries(appliedEffect.attributes)) {
                        const aKey = (typeof attrValue === 'object') ? attrValue.key : attrName;
                        const aVal = (typeof attrValue === 'object' && 'value' in attrValue) ? attrValue.value :
                                    (typeof attrValue === 'boolean') ? 0 : window.DX3rdFormulaEvaluator.evaluate(attrValue);
                        if (aKey === 'armor') armorBonus += Number(aVal) || 0;
                        if (aKey === 'guard') guardBonus += Number(aVal) || 0;
                        if (aKey === 'guard_roll') guardRoll += Number(aVal) || 0;
                        if (aKey === 'dxroll') dxRoll += Number(aVal) || 0;
                        if (aKey === 'penetrate') penetrateBonus += Number(aVal) || 0;
                        if (aKey === 'reduce') reduceBonus += Number(aVal) || 0;
                        if (aKey === 'reduce_roll') reduceRoll += Number(aVal) || 0;
                    }
                }
            }

            // armor.base가 없으면 기존 value를 base로 설정 (마이그레이션)
            if (attrs.armor.base === undefined || attrs.armor.base === null) {
                attrs.armor.base = attrs.armor.value || 0;
            }
            attrs.armor.value = Math.max(0, (attrs.armor.base || 0) + armorBonus);
            attrs.guard.value = Math.max(0, guardBonus);
            attrs.guard.roll = Math.max(0, guardRoll);   // 방어 다이얼로그가 읽어 Nd10 굴림
            if (!attrs.dxroll) attrs.dxroll = { value: 0 };
            attrs.dxroll.value = Math.max(0, dxRoll);    // 판정 핸들러가 읽어 Nd10 굴림
            attrs.penetrate.value = Math.max(0, penetrateBonus);
            attrs.reduce.value = Math.max(0, reduceBonus);
            attrs.reduce.roll = Math.max(0, reduceRoll);   // 방어 다이얼로그가 읽어 Nd10 굴림

            // === 회피치 계산 (base + 보정치) ===
            // 닷지 달성치 보정치 계산 (dodge_add 또는 dodge_achievement)
            let dodgeAchievementBonus = 0;
            for (const item of activeItems) {
                if (item.system?.attributes) {
                    for (const [attrKey, attrData] of Object.entries(item.system.attributes)) {
                        if (attrData.key === 'dodge_add' || attrData.key === 'dodge_achievement') {
                            dodgeAchievementBonus += window.DX3rdFormulaEvaluator.evaluate(
                                attrData.value,
                                item,
                                this
                            );
                        }
                    }
                }
            }
            
            // Applied 효과의 닷지 달성치 보정치 계산
            for (const [appliedKey, appliedEffect] of Object.entries(appliedEffects)) {
                if (appliedEffect && appliedEffect.attributes) {
                    for (const [attrName, attrValue] of Object.entries(appliedEffect.attributes)) {
                        const aKey = (typeof attrValue === 'object') ? attrValue.key : attrName;
                        const aVal = (typeof attrValue === 'object' && 'value' in attrValue) ? attrValue.value : 
                                    (typeof attrValue === 'boolean') ? 0 : window.DX3rdFormulaEvaluator.evaluate(attrValue);
                        if (aKey === 'dodge_add' || aKey === 'dodge_achievement') {
                            dodgeAchievementBonus += Number(aVal) || 0;
                        }
                    }
                }
            }
            
            // 닷지 다이스 보정치 계산 (dodge_dice * 2)
            let dodgeDiceBonus = 0;
            for (const item of activeItems) {
                if (item.system?.attributes) {
                    for (const [attrKey, attrData] of Object.entries(item.system.attributes)) {
                        if (attrData.key === 'dodge_dice' && attrData.value) {
                            const diceValue = window.DX3rdFormulaEvaluator.evaluate(
                                attrData.value,
                                item,
                                this
                            );
                            dodgeDiceBonus += diceValue * 2;
                        }
                    }
                }
            }
            
            // Applied 효과의 닷지 다이스 보정치 계산
            for (const [appliedKey, appliedEffect] of Object.entries(appliedEffects)) {
                if (appliedEffect && appliedEffect.attributes) {
                    for (const [attrName, attrValue] of Object.entries(appliedEffect.attributes)) {
                        const aKey = (typeof attrValue === 'object') ? attrValue.key : attrName;
                        const aVal = (typeof attrValue === 'object' && 'value' in attrValue) ? attrValue.value : 
                                    (typeof attrValue === 'boolean') ? 0 : window.DX3rdFormulaEvaluator.evaluate(attrValue);
                        if (aKey === 'dodge_dice') {
                            dodgeDiceBonus += (Number(aVal) || 0) * 2;
                        }
                    }
                }
            }
            
            // evasion이 없으면 초기화
            if (!attrs.evasion) {
                attrs.evasion = {};
            }
            
            // evasion.base가 없으면 기존 value를 base로 설정 (마이그레이션)
            if (attrs.evasion.base === undefined || attrs.evasion.base === null) {
                attrs.evasion.base = attrs.evasion.value || 0;
            }
            
            // evasion.disabled가 없으면 false로 초기화
            if (attrs.evasion.disabled === undefined) {
                attrs.evasion.disabled = false;
            }
            
            // 비활성화되어 있지 않을 때만 계산
            if (!attrs.evasion.disabled) {
                attrs.evasion.value = (attrs.evasion.base || 0) + dodgeAchievementBonus + dodgeDiceBonus;
                if (attrs.evasion.value < 0) attrs.evasion.value = 0;
            }

            // 기타 필수 구조 보정
            system.conditions = system.conditions || {};
        }
    }

    // Foundry에 커스텀 Actor 등록
    CONFIG.Actor.documentClass = DX3rdActor;
    CONFIG.Actor.typeLabels = {
        character: "DX3rd.Character",
        enemy: "DX3rd.Enemy"
    };
})();
