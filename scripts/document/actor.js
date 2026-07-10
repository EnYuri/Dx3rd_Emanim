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

            // enemy 타입: "침식률(없음)" 선택 및 침식률 상승 규칙을 위해 encroachment 최소 구조 보장.
            // (character 처럼 dice/level/exp 계산은 하지 않고 type/value 만 유지한다.)
            if (isEnemy) {
                defaultAttributes.encroachment = { value: 0, max: 100, min: 0, type: '-' };
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
                // 성능: 13회의 items.filter 반복 대신 단일 순회로 타입별 버킷에 분류 (순서/의미 동일)
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

            // enemy 타입은 간소화된 계산만 수행
            if (isEnemy) {
                this._prepareEnemyAttributes();
                return;
            }

            // 활성 아이템 및 Applied 효과 목록 미리 준비.
            // 이펙트류(effect/spell/psionic/combo)는 자체계산에서 제외한다 — 이들은 토글 시
            // appliedKey AE(DX3rdAppliedToggle)로 반영되어 collect()→appliedByKey 경로로 합산되므로
            // 여기서 다시 세면 이중가산된다. 장비/기록/아이템/기타만 아이템 자체계산에 남긴다.
            const activeItems = this._expandActiveItems(this.items.filter(item =>
                item.system?.active?.state === true &&
                ['weapon', 'protect', 'vehicle', 'connection', 'etc', 'once', 'rois'].includes(item.type)
            ));
            // 소스 이행: applied 버프는 네이티브 ActiveEffect(flag)에서 재구성. (전환 브리지로 레거시 필드도 병합)
            const appliedEffects = window.DX3rdAppliedEffects?.collect
                ? window.DX3rdAppliedEffects.collect(this)
                : (attrs.applied || {});
            // 성능: Applied 효과를 1회만 색인 (기존엔 파생치마다 전체 재순회)
            const appliedByKey = this._indexAppliedEffects(appliedEffects);
            // ④ 활성 아이템 + applied 기여를 단일 경로로 소비하는 리더(지연 평가 보존)
            const R = this._makeContribReader(activeItems, appliedByKey);

            // 성능: 여러 파생치 계산에서 반복 호출되던 동일 아이템 필터를 1회만 수행해 재사용
            // (기존에는 능력치/스킬/경험치/장비 계산마다 this.items.filter를 매번 다시 돌렸음)
            const worksItems = this.items.filter(item => item.type === 'works');
            const syndromeItems = this.items.filter(item => item.type === 'syndrome');
            const equippedProtects = this.items.filter(i => i.type === 'protect' && i.system?.equipment === true);
            const equippedVehicles = this.items.filter(i => i.type === 'vehicle' && i.system?.equipment === true);

            // === 1차 패스: 능력치 total 계산 (stat_bonus만) ===
            for (const key of ["body", "sense", "mind", "social"]) {
                const stat = attrs[key];
                
                // 신드롬 보너스 계산
                let syndromeBonus = 0;
                const syndromeList = attrs.syndrome || [];
                
                // 액터가 가진 신드롬 아이템 개수에 따른 배율 결정
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
                for (const worksItem of worksItems) {
                    if (worksItem.system?.attributes?.[key]?.value) {
                        worksBonus += window.DX3rdFormulaEvaluator.evaluate(worksItem.system.attributes[key].value, worksItem, this);
                    }
                }

                // 활성 아이템 + applied 의 stat_bonus(능력치 라벨 일치) 단일 경로 합
                stat.bonus = R.byLabel('stat_bonus', key);

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
                for (const worksItem of worksItems) {
                    if (worksItem.system?.skills?.[key]?.apply && worksItem.system.skills[key].add) {
                        worksBonus += window.DX3rdFormulaEvaluator.evaluate(worksItem.system.skills[key].add, worksItem, this);
                    }
                }

                // 활성 아이템 + applied 의 stat_bonus(스킬 라벨 일치) 단일 경로 합
                skill.bonus = R.byLabel('stat_bonus', key);
                // works 값도 저장 (다이얼로그에서 표시용)
                skill.works = worksBonus;
                
                // 스킬 total 계산 (point + extra + bonus + works)
                skill.total = (skill.point || 0) + (skill.extra || 0) + skill.bonus + worksBonus;
                // 최소값 보정: total은 최소 0
                if (skill.total < 0) skill.total = 0;
            }

            // === HP, Init, Saving 등 파생 값 계산 (total 사용) ===

            // HP 계산 (body.total * 2 + mind.total + 20 + 아이템/적용 효과 보너스)
            const hpBonus = R.sum('hp');

            attrs.hp.max = (attrs.body?.total || 0) * 2 + (attrs.mind?.total || 0) + 20 + hpBonus;
            if (attrs.hp.value > attrs.hp.max) attrs.hp.value = attrs.hp.max;
            if (attrs.hp.value < 0) attrs.hp.value = 0;

            // === Attack 계산 === (라벨 버킷: melee/ranged/fist, 무라벨/'-' → 전체 공격 '_')
            // fist = 맨손 한정 공격력(축퇴기관 등) — 데미지 산출 시 무기가 맨손일 때만 가산
            const atk = R.bucket('attack', ['melee', 'ranged', 'fist']);

            if (!attrs.attack) attrs.attack = { value: 0, melee: 0, ranged: 0, fist: 0 };
            attrs.attack.value = atk._;
            attrs.attack.melee = atk.melee;
            attrs.attack.ranged = atk.ranged;
            attrs.attack.fist = atk.fist;

            // === Damage Roll 계산 === (라벨 버킷: melee/ranged, 무라벨/'-' → 전체 '_')
            const dmgr = R.bucket('damage_roll', ['melee', 'ranged']);

            if (!attrs.damage_roll) attrs.damage_roll = { value: 0, melee: 0, ranged: 0 };
            attrs.damage_roll.value = dmgr._;
            attrs.damage_roll.melee = dmgr.melee;
            attrs.damage_roll.ranged = dmgr.ranged;

            // === Armor 계산 ===
            let armorBonus = 0;
            
            // 장착된 프로텍트의 armor 값 추가 (equippedProtects는 상단에서 1회 계산)
            for (const protect of equippedProtects) {
                if (protect.system?.armor) {
                    const armorValue = window.DX3rdFormulaEvaluator.evaluate(protect.system.armor, protect, this);
                    armorBonus += armorValue;
                }
            }
            
            // 장착된 비클의 armor 값 추가 (equippedVehicles는 상단에서 1회 계산)
            for (const vehicle of equippedVehicles) {
                if (vehicle.system?.armor) {
                    const armorValue = window.DX3rdFormulaEvaluator.evaluate(vehicle.system.armor, vehicle, this);
                    armorBonus += armorValue;
                }
            }
            
            // 활성 아이템 + applied 의 armor 보너스
            armorBonus += R.sum('armor');

            attrs.armor.value = armorBonus;
            // 최소값 보정: armor는 최소 0
            if (attrs.armor.value < 0) attrs.armor.value = 0;
            if (attrs.armor.value < attrs.armor.min) attrs.armor.value = attrs.armor.min;

            // === Guard 계산 ===
            let guardBonus = 0;
            let guardRoll = 0;   // 가드 시 굴리는 D10 개수(가드치에 +[N]D10 — 방어 다이얼로그에서 굴려 가산)

            // 활성 아이템 + applied 의 guard / guard_roll 보너스
            guardBonus += R.sum('guard');
            guardRoll += R.sum('guard_roll');

            attrs.guard.value = guardBonus;
            // 최소값 보정: guard는 최소 0
            if (attrs.guard.value < 0) attrs.guard.value = 0;
            if (attrs.guard.value < attrs.guard.min) attrs.guard.value = attrs.guard.min;
            attrs.guard.roll = Math.max(0, guardRoll);   // 방어 다이얼로그가 읽어 Nd10 굴림

            // === DxRoll 계산(달성치에 +[N]D10) — 판정 시 Nd10 굴려 달성치(add)에 가산 ===
            const dxRoll = R.sum('dxroll');
            if (!attrs.dxroll) attrs.dxroll = { value: 0 };
            attrs.dxroll.value = Math.max(0, dxRoll);   // 판정 핸들러(executeStatRoll/executeAttackRoll)가 읽어 Nd10 굴림

            // === Penetrate 계산 ===
            const penetrateBonus = R.sum('penetrate');

            attrs.penetrate.value = penetrateBonus;
            // 최소값 보정: penetrate는 최소 0
            if (attrs.penetrate.value < 0) attrs.penetrate.value = 0;
            if (attrs.penetrate.value < attrs.penetrate.min) attrs.penetrate.value = attrs.penetrate.min;

            // === Reduce 계산 ===
            const reduceBonus = R.sum('reduce');
            const reduceRoll = R.sum('reduce_roll');   // 피격 시 굴리는 D10 개수(HP데미지 [N]D10점 경감 — 방어 다이얼로그에서 굴려 경감치에 가산)

            attrs.reduce.value = reduceBonus;
            // 최소값 보정: reduce는 최소 0
            if (attrs.reduce.value < 0) attrs.reduce.value = 0;
            if (attrs.reduce.value < attrs.reduce.min) attrs.reduce.value = attrs.reduce.min;
            attrs.reduce.roll = Math.max(0, reduceRoll);   // 방어 다이얼로그가 읽어 Nd10 굴림

            // 이니셔티브 계산 (sense.total * 2 + mind.total + 아이템/적용 효과 보너스)
            let initBonus = 0;
            
            // 장착된 프로텍트의 init 값 추가
            const equippedProtectsForInit = equippedProtects;
            for (const protect of equippedProtectsForInit) {
                if (protect.system?.init) {
                    const initValue = window.DX3rdFormulaEvaluator.evaluate(protect.system.init, protect, this);
                    initBonus += initValue;
                }
            }
            
            // 장착된 비클의 init 값 추가
            const equippedVehiclesForInit = equippedVehicles;
            for (const vehicle of equippedVehiclesForInit) {
                if (vehicle.system?.init) {
                    const initValue = window.DX3rdFormulaEvaluator.evaluate(vehicle.system.init, vehicle, this);
                    initBonus += initValue;
                }
            }
            
            // 활성 아이템 + applied 의 init 보너스
            initBonus += R.sum('init');

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
                
                // 활성 아이템 + applied 의 battleMove 보너스
                moveBattleBonus += R.sum('battleMove');

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
                
                // 활성 아이템 + applied 의 fullMove 보너스
                moveFullBonus += R.sum('fullMove');
                
                // fullMove 보너스를 move.full에 추가 (비클이 있으면 비클 기준, 없으면 move.battle*2 기준)
                attrs.move.full += moveFullBonus;
                
                // 경직 상태이상 체크 (-9999 패널티)
                if (system.conditions?.rigor?.active) {
                    attrs.move.full -= 9999;
                }
                
                // 이동력(전력) 최소값 0 보장
                if (attrs.move.full < 0) attrs.move.full = 0;
                
                // SpellCalamity 1번 효과: 이동력 절반
                // move_half는 primitive 이름 또는 객체 key 형태 모두 색인의 'move_half' 버킷에 들어간다
                const hasMoveHalf = (appliedByKey['move_half'] || []).length > 0;
                
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
                
                // 활성 아이템 + applied 의 battleMove 보너스
                moveBattleBonus += R.sum('battleMove');
                
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
                
                // 활성 아이템 + applied 의 fullMove 보너스
                moveFullBonus += R.sum('fullMove');
                
                // fullMove 보너스를 move.full에 추가 (비클이 있으면 비클 기준, 없으면 move.battle*2 기준)
                attrs.move.full += moveFullBonus;
                
                // 경직 상태이상 체크 (-9999 패널티)
                if (system.conditions?.rigor?.active) {
                    attrs.move.full -= 9999;
                }
                
                // 이동력(전력) 최소값 0 보장
                if (attrs.move.full < 0) attrs.move.full = 0;
                
                // SpellCalamity 1번 효과: 이동력 절반 (간이 거리 계산식)
                const hasMoveHalfSimplified = (appliedByKey['move_half'] || []).length > 0;
                
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
            
            // 활성 아이템 + applied 의 saving_max 보너스
            savingBonus += R.sum('saving_max');
            
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
            
            // 활성 아이템 + applied 의 stock_point 보너스
            stockBonus += R.sum('stock_point');
            
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
            
            // 활성 아이템 + applied 의 critical_min(더 작은 값으로) 단일 경로
            criticalMin = R.min('critical_min', criticalMin);

            // 크리티컬 하한치 설정 (최소값 2로 제한)
            if (!attrs.critical) attrs.critical = {};
            attrs.critical.min = Math.max(2, criticalMin);

            // === 2차 패스: 능력치 dice, add, critical 계산 (이제 모든 total이 준비됨) ===
            for (const key of ["body", "sense", "mind", "social"]) {
                const stat = attrs[key];
                
                // dice 계산: total + 침식률 + dice(일반) + stat_dice[능력치]
                // 활성 아이템 + applied: dice(무라벨) + stat_dice(능력치 라벨 일치)
                const abilityDiceBonus = R.sum('dice');
                const abilityStatDiceBonus = R.byLabel('stat_dice', key);

                stat.dice = stat.total + (attrs.encroachment?.dice || 0) + abilityDiceBonus + abilityStatDiceBonus;
                // 최소값 보정: dice는 최소 1
                if (stat.dice < 1) stat.dice = 1;
                
                // add 계산: add(일반) + stat_add[능력치]
                // 활성 아이템 + applied: add(무라벨) + stat_add(능력치 라벨 일치)
                const abilityAddBonus = R.sum('add');
                const abilityStatAddBonus = R.byLabel('stat_add', key);

                stat.add = abilityAddBonus + abilityStatAddBonus;
                
                // critical 계산: max(critical.min, defaultCritical + critical(일반))
                // 활성 아이템 + applied 의 critical 보정(색인 경유로 통일 — object/primitive 형 모두 포함)
                const abilityCriticalMod = R.sum('critical');

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
                const equippedProtectsForDodge = equippedProtects;
                for (const protect of equippedProtectsForDodge) {
                    if (protect.system?.dodge) {
                        const dodgeValue = window.DX3rdFormulaEvaluator.evaluate(protect.system.dodge, protect, this);
                        dodgeAddBonus += dodgeValue;
                    }
                }
                
                // 활성 아이템 + applied 의 major/reaction/dodge 9키 단일패스 병합
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
                // 활성 아이템 + applied 의 stat_dice(직접 or 스킬그룹 매칭) 단일 경로
                const skillStatDiceBonus = R.bySkill('stat_dice', key);

                skill.dice = baseDice + skillStatDiceBonus;
                // 최소값 보정: dice는 최소 1
                if (skill.dice < 1) skill.dice = 1;
                
                // add 계산: add(일반) + stat_add[능력치] + stat_add[스킬]
                // 활성 아이템 + applied: add(무라벨) + stat_add(능력치=skill.base) + stat_add(직접/그룹 매칭)
                const skillAddBonus = R.sum('add');
                const skillAbilityAddBonus = R.byLabel('stat_add', skill.base);
                const skillStatAddBonus = R.bySkill('stat_add', key);

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
                const equippedProtectsForSkill = equippedProtects;
                for (const protect of equippedProtectsForSkill) {
                    if (protect.system?.dodge) {
                        const dodgeValue = window.DX3rdFormulaEvaluator.evaluate(protect.system.dodge, protect, this);
                        dodgeAddBonus += dodgeValue;
                    }
                }
                
                // 활성 아이템 + applied 의 major/reaction/dodge 9키 단일패스 병합
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

        /**
         * 활성 아이템 목록에 "활성 콤보가 등록한 자식 이펙트"를 펼쳐 넣는다.
         * 콤보를 활성화하면 그 콤보에 묶인 이펙트들을 (독립적으로 활성화한 것과 동일하게)
         * 액터의 능력치/스킬/굴림 파생치에 지속 버프로 적용하기 위함.
         * 이미 목록에 있는(독립 활성) 이펙트는 중복 제외한다.
         * 콤보 굴림 계산 쪽에서는 DX3rdComboData.getPersistentEffectIds 로 이 이펙트들을
         * 제외해 이중 계산을 막는다.
         */
        _expandActiveItems(activeItems) {
            const byId = new Map(activeItems.map(i => [i.id, i]));
            const getEffectIds = window.DX3rdComboData?.getEffectIds;
            for (const combo of activeItems) {
                if (combo.type !== 'combo') continue;
                const ids = getEffectIds ? getEffectIds(combo)
                    : (Array.isArray(combo.system?.effectIds) ? combo.system.effectIds : []);
                for (const eid of ids) {
                    if (!eid || eid === '-' || byId.has(eid)) continue;
                    const eff = this.items.get(eid);
                    if (eff && eff.type === 'effect') byId.set(eid, eff);
                }
            }
            return [...byId.values()];
        }

        /**
         * 성능: Applied 효과(attrs.applied)를 1회만 순회해 key별 색인을 만든다.
         * 기존에는 각 파생치 계산마다 Object.entries(appliedEffects) 전체를 다시 훑었다(수십 회).
         *
         * 반환: { [key]: [{ label, val }] }
         *  - key/label/val 정규화는 소비부(균일 루프)의 기존 파생과 정확히 동일하게 맞춘다.
         *    · val = (객체형이고 'value' 보유) ? attrValue.value
         *          : (boolean) ? 0
         *          : evaluate(attrValue)   // primitive(숫자) → 그대로
         *  - primitive 형태({ dice: -2 })는 label=null (실데이터상 label 필요 key는 primitive로 저장되지 않음).
         *  - 주의: attrName 기반으로 매칭하는 critical, boolean/Number 처리가 다른
         *    major/reaction/dodge, 조기 탐지하는 move_half 루프는 이 색인을 쓰지 않는다.
         */
        _indexAppliedEffects(appliedEffects) {
            const byKey = {};
            for (const eff of Object.values(appliedEffects || {})) {
                if (!eff || !eff.attributes) continue;
                for (const [attrName, attrValue] of Object.entries(eff.attributes)) {
                    const isObj = (typeof attrValue === 'object' && attrValue !== null);
                    const key = isObj ? attrValue.key : attrName;
                    const label = isObj ? attrValue.label : null;
                    const val = (isObj && 'value' in attrValue) ? attrValue.value
                              : (typeof attrValue === 'boolean') ? 0
                              : window.DX3rdFormulaEvaluator.evaluate(attrValue);
                    (byKey[key] = byKey[key] || []).push({ label, val });
                }
            }
            return byKey;
        }

        /**
         * ④ 소비 경로 단일화: 활성 아이템(라이브 평가) + applied(정규화 숫자) 기여를
         *   하나의 인터페이스로 병합해 반환하는 리더. prepareData/캐스팅/에너미 3경로가 공유한다.
         *  - 활성 아이템 수식은 "소비 시점"에 지연 평가한다(스탯 확정 후 값 참조 보존 = 기존 타이밍 유지).
         *  - applied 값은 _indexAppliedEffects 가 정규화한 숫자({label,val})를 그대로 합산.
         *  - 평가기 인자 순서는 문서 시그니처 evaluate(formula, item, actor) 로 통일
         *    (구 hp/init 루프의 스왑 인자 quirk 교정). NaN 은 0 으로 흡수.
         */
        _makeContribReader(activeItems, appliedByKey) {
            const actor = this;
            const ev = (v, item) => Number(window.DX3rdFormulaEvaluator.evaluate(v, item, actor)) || 0;
            const eachActiveAttr = (fn) => {
                for (const item of activeItems) {
                    const map = item.system?.attributes;
                    if (!map) continue;
                    for (const a of Object.values(map)) { if (a) fn(a, item); }
                }
            };
            return {
                // 라벨 무관 단순 합
                sum(key) {
                    let s = 0;
                    eachActiveAttr((a, item) => { if (a.key === key && a.value) s += ev(a.value, item); });
                    for (const { val } of (appliedByKey[key] || [])) s += Number(val) || 0;
                    return s;
                },
                // 정확 라벨 일치 합 (stat_bonus 능력치·스킬, 능력치 stat_dice/stat_add)
                byLabel(key, want) {
                    let s = 0;
                    eachActiveAttr((a, item) => { if (a.key === key && a.label === want && a.value) s += ev(a.value, item); });
                    for (const { label, val } of (appliedByKey[key] || [])) if (label === want) s += Number(val) || 0;
                    return s;
                },
                // 스킬 매칭(직접 라벨 or 스킬 그룹) 합 (스킬 stat_dice/stat_add)
                bySkill(key, skillKey) {
                    const match = (label) => label === skillKey || window.DX3rdSkillGroupMatcher?.isSkillInGroup(skillKey, label);
                    let s = 0;
                    eachActiveAttr((a, item) => { if (a.key === key && a.value && match(a.label)) s += ev(a.value, item); });
                    for (const { label, val } of (appliedByKey[key] || [])) if (match(label)) s += Number(val) || 0;
                    return s;
                },
                // 최소치 (critical_min): seed 부터 더 작은 값으로
                min(key, seed) {
                    let m = seed;
                    eachActiveAttr((a, item) => { if (a.key === key && a.value) { const v = ev(a.value, item); if (v < m) m = v; } });
                    for (const { val } of (appliedByKey[key] || [])) { const v = Number(val) || 0; if (v < m) m = v; }
                    return m;
                },
                // 라벨 버킷 (attack: melee/ranged/fist, damage_roll: melee/ranged). 그 외/'-'/무라벨 → '_'
                bucket(key, labels) {
                    const out = { _: 0 };
                    for (const l of labels) out[l] = 0;
                    const add = (label, v) => { if (labels.includes(label)) out[label] += v; else out._ += v; };
                    eachActiveAttr((a, item) => { if (a.key === key && a.value) add(a.label || '-', ev(a.value, item)); });
                    for (const { label, val } of (appliedByKey[key] || [])) add(label || '-', Number(val) || 0);
                    return out;
                },
                // 다중키 단일패스: major/reaction/dodge 의 dice/critical/add 9키 합
                mrd() {
                    const KS = ['major_dice', 'major_critical', 'major_add', 'reaction_dice', 'reaction_critical', 'reaction_add', 'dodge_dice', 'dodge_critical', 'dodge_add'];
                    const out = {};
                    for (const k of KS) out[k] = 0;
                    eachActiveAttr((a, item) => { if (a.value && Object.prototype.hasOwnProperty.call(out, a.key)) out[a.key] += ev(a.value, item); });
                    for (const k of KS) for (const { val } of (appliedByKey[k] || [])) out[k] += Number(val) || 0;
                    return out;
                },
            };
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
            // 이펙트류는 자체계산 제외(appliedByKey 로 합산) — cast_dice/cast_add 이중가산 방지.
            const activeItems = this._expandActiveItems((this.items || []).filter(i =>
                i.system?.active?.state &&
                !['effect', 'spell', 'psionic', 'combo'].includes(i.type)));
            const appliedEffects = window.DX3rdAppliedEffects?.collect
                ? window.DX3rdAppliedEffects.collect(this)
                : (this.system.attributes?.applied || {});

            // base dice from ability/skill totals
            const mindTotal = attrs.mind?.total || 0;
            const willTotal = attrs.skills?.will?.total || 0;
            let castDice = Math.round((mindTotal + willTotal) / 2);
            let castAdd = 0;

            // ④ 활성 아이템 + applied 의 cast_dice/cast_add 단일 경로 병합(색인 경유로 object/primitive 형 모두 포함)
            const R = this._makeContribReader(activeItems, this._indexAppliedEffects(appliedEffects));
            castDice += R.sum('cast_dice');
            castAdd += R.sum('cast_add');

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

            // 이펙트류(combo/effect)는 자체계산 제외 — 토글 시 appliedKey AE(DX3rdAppliedToggle)로
            // 반영되어 appliedByKey 로 합산된다. enemy 도 동일 경로(sync 대상). 이중가산 방지.
            const activeItems = this._expandActiveItems(this.items.filter(item =>
                item.system?.active?.state === true &&
                !['combo', 'effect', 'spell', 'psionic'].includes(item.type)
            ));
            const appliedEffects = window.DX3rdAppliedEffects?.collect
                ? window.DX3rdAppliedEffects.collect(this)
                : (attrs.applied || {});
            // 성능: Applied 효과를 1회만 색인 (character 경로와 동일)
            const appliedByKey = this._indexAppliedEffects(appliedEffects);
            // ④ 활성 아이템 + applied 기여를 단일 경로로 소비하는 리더(지연 평가 보존)
            const R = this._makeContribReader(activeItems, appliedByKey);

            // === 크리티컬 하한치 계산 (능력치 critical 계산보다 먼저 실행) ===
            const criticalMin = R.min('critical_min', attrs.critical?.min || defaultCritical);
            if (!attrs.critical) attrs.critical = {};
            attrs.critical.min = Math.max(2, criticalMin);

            // === 능력치 total 계산 (bonus, dice, add 포함) ===
            for (const key of ["body", "sense", "mind", "social"]) {
                const stat = attrs[key];
                
                // 활성 아이템 + applied 의 stat_bonus(능력치 라벨 일치) 단일 경로 합
                stat.bonus = R.byLabel('stat_bonus', key);
                stat.total = (stat.point || 0) + (stat.extra || 0) + stat.bonus;
                if (stat.total < 0) stat.total = 0;

                // 활성 아이템 + applied: dice(무라벨) + stat_dice(능력치 라벨 일치)
                const diceBonus = R.sum('dice');
                const statDiceBonus = R.byLabel('stat_dice', key);

                stat.dice = stat.total + diceBonus + statDiceBonus;
                if (stat.dice < 1) stat.dice = 1;
                
                // 활성 아이템 + applied: add(무라벨) + stat_add(능력치 라벨 일치)
                const addBonus = R.sum('add');
                const statAddBonus = R.byLabel('stat_add', key);

                stat.add = addBonus + statAddBonus;
                
                // 크리티컬 보정 (enemy 전용 simple critical)
                const abilityCriticalMod = R.sum('critical');
                const calculatedCritical = defaultCritical + abilityCriticalMod;
                stat.critical = Math.max(attrs.critical?.min || defaultCritical, calculatedCritical);
                
                // 메이저/리액션/닷지 다이스·수정치·크리티컬 보정 (에너미 판정용) — 9키 단일패스 병합
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
            }
            // 활성 아이템 + applied 의 hp / hp_max 보너스
            const hpBonus = R.sum('hp') + R.sum('hp_max');
            
            // hp.base가 없으면 기존 max 값을 base로 설정 (마이그레이션)
            if (attrs.hp.base === undefined || attrs.hp.base === null) {
                attrs.hp.base = attrs.hp.max || 0;
            }
            
            attrs.hp.max = (attrs.hp.base || 0) + hpBonus;
            if (attrs.hp.max < 0) attrs.hp.max = 0;
            if (attrs.hp.value > attrs.hp.max) attrs.hp.value = attrs.hp.max;
            if (attrs.hp.value < 0) attrs.hp.value = 0;

            // === 행동치 계산 (base + 보정치) ===
            // 활성 아이템 + applied 의 init / initiative 보너스
            const initBonus = R.sum('init') + R.sum('initiative');
            
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
            // 활성 아이템 + applied 의 move 보너스 (battle: move/move_battle/battleMove, full: move_full/fullMove)
            const moveBattleBonus = R.sum('move') + R.sum('move_battle') + R.sum('battleMove');
            const moveFullBonus = R.sum('move_full') + R.sum('fullMove');
            
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

            // === Attack, Damage Roll 계산 === (라벨 버킷)
            const atk = R.bucket('attack', ['melee', 'ranged', 'fist']);   // fist = 맨손 한정(축퇴기관 등)
            const dmgr = R.bucket('damage_roll', ['melee', 'ranged']);

            if (!attrs.attack) attrs.attack = { value: 0, melee: 0, ranged: 0, fist: 0 };
            attrs.attack.value = atk._;
            attrs.attack.melee = atk.melee;
            attrs.attack.ranged = atk.ranged;
            attrs.attack.fist = atk.fist;

            if (!attrs.damage_roll) attrs.damage_roll = { value: 0, melee: 0, ranged: 0 };
            attrs.damage_roll.value = dmgr._;
            attrs.damage_roll.melee = dmgr.melee;
            attrs.damage_roll.ranged = dmgr.ranged;

            // === Armor, Guard, Penetrate, Reduce 계산 === (활성 아이템 + applied 단일 경로)
            const armorBonus = R.sum('armor');
            const guardBonus = R.sum('guard');
            const guardRoll = R.sum('guard_roll');     // 가드 시 굴리는 D10 개수(가드치에 +[N]D10)
            const dxRoll = R.sum('dxroll');            // 판정 시 굴리는 D10 개수(달성치에 +[N]D10)
            const penetrateBonus = R.sum('penetrate');
            const reduceBonus = R.sum('reduce');
            const reduceRoll = R.sum('reduce_roll');   // 피격 시 굴리는 D10 개수(HP데미지 [N]D10점 경감)

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
            // 닷지 달성치 보정치 (dodge_add 또는 dodge_achievement) — 활성 아이템 + applied 단일 경로
            const dodgeAchievementBonus = R.sum('dodge_add') + R.sum('dodge_achievement');

            // 닷지 다이스 보정치 (dodge_dice * 2)
            const dodgeDiceBonus = R.sum('dodge_dice') * 2;
            
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

        /**
         * "침식률(없음)" 가드.
         * 침식률 타입(system.attributes.encroachment.type)이 'none'인 액터는 침식률이 오르지 않는다.
         * 이펙트 사용·의지/공포 판정·리저렉트 부작용·주문 등 모든 침식률 상승 경로가
         * 최종적으로 actor.update({'system.attributes.encroachment.value': ...}) 를 거치므로
         * 여기서 한 번에 차단한다. 감소(백트랙·수동 조정)와 동일값은 허용한다.
         * 규칙상 'none'은 계산 목적상 코어(-)와 동일하게 취급하되 상승만 막는다.
         */
        async _preUpdate(changed, options, user) {
            try {
                // 이 업데이트로 바뀌는 타입이 있으면 그것을, 없으면 현재 타입을 기준으로 판정한다.
                const nextType = changed?.system?.attributes?.encroachment?.type
                    ?? this.system?.attributes?.encroachment?.type;
                if (nextType === 'none') {
                    const encChange = changed?.system?.attributes?.encroachment;
                    if (encChange && encChange.value !== undefined && encChange.value !== null) {
                        const before = Number(this.system?.attributes?.encroachment?.value ?? 0);
                        const after = Number(encChange.value);
                        // 상승만 차단: 변경셋에서 value 키를 제거해 기존값을 유지한다.
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
    }

    // Foundry에 커스텀 Actor 등록
    CONFIG.Actor.documentClass = DX3rdActor;
    CONFIG.Actor.typeLabels = {
        character: "DX3rd.Character",
        enemy: "DX3rd.Enemy"
    };
})();
