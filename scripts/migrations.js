// DX3rd 데이터 마이그레이션
// 시스템 스키마가 바뀌었을 때 기존 월드 문서를 1회 정리한다.
// systemMigrationVersion(world 설정)으로 중복 실행을 막는다.

(function() {
    // 현재까지 정의된 마이그레이션 단계 수. 새 마이그레이션을 추가할 때마다 +1.
    const CURRENT_MIGRATION = 4;

    Hooks.once('init', function() {
        game.settings.register('dx3rd-emanim', 'systemMigrationVersion', {
            scope: 'world',
            config: false,
            type: Number,
            default: 0
        });
    });

    Hooks.once('ready', async function() {
        // GM만 데이터 마이그레이션을 수행 (동시 실행/권한 문제 방지)
        if (!game.user.isGM) return;

        let version = game.settings.get('dx3rd-emanim', 'systemMigrationVersion');
        if (version >= CURRENT_MIGRATION) return;

        console.log(`DX3rd | 데이터 마이그레이션 시작 (v${version} → v${CURRENT_MIGRATION})`);
        ui.notifications.info('DX3rd | 데이터 마이그레이션을 진행합니다...');

        try {
            // v1: 액터 스키마 평탄화에 따른 죽은 필드 제거
            if (version < 1) await migrateActorSchemaV1();
            // v2: 아이템 base 템플릿의 죽은 system.name 제거
            if (version < 2) await migrateItemSchemaV2();
            // v3: 아무도 읽지 않던 conditions.lostHP 제거
            if (version < 3) await migrateConditionsV3();
            // v4: 자원 바 추적 후보 결함으로 지워진 토큰 바 복구
            if (version < 4) await migrateTokenBarsV4();

            await game.settings.set('dx3rd-emanim', 'systemMigrationVersion', CURRENT_MIGRATION);
            console.log('DX3rd | 데이터 마이그레이션 완료');
            ui.notifications.info('DX3rd | 데이터 마이그레이션이 완료되었습니다.');
        } catch (e) {
            console.error('DX3rd | 데이터 마이그레이션 실패:', e);
            ui.notifications.error('DX3rd | 데이터 마이그레이션 중 오류가 발생했습니다. 콘솔을 확인하세요.');
        }
    });

    /**
     * v1: 옛 template.json의 잘못된 `system:{...}` 중첩을 평탄화한 뒤,
     * 기존 액터에 남아있는 죽은 필드를 제거한다.
     * - actor.system.system  : 코드가 읽지 않는 기본값 사본(사문)
     * - actor.system.{name,type,img,items,effects} : 코어 문서 필드의 가짜 중복
     * 실데이터(actor.system.attributes/details/conditions/codeName)는 건드리지 않는다.
     */
    async function migrateActorSchemaV1() {
        const deadKeys = ['system', 'name', 'type', 'img', 'items', 'effects'];
        // v14+는 ForcedDeletion 연산자를 제공하고 레거시 "-=" 문법에 deprecation 경고를 낸다.
        // v13에는 이 연산자가 없으므로 런타임 감지해 각 버전에 맞는 삭제 방식을 쓴다.
        const ForcedDeletion = foundry.data?.operators?.ForcedDeletion;
        let cleaned = 0;

        for (const actor of game.actors) {
            // 이 시스템 소유 타입만 대상 (모듈 제공 액터 타입은 제외)
            if (actor.type !== 'character' && actor.type !== 'enemy') continue;

            const sys = actor.system;
            if (!sys) continue;

            const present = deadKeys.filter(key => Object.prototype.hasOwnProperty.call(sys, key));
            if (present.length === 0) continue;

            try {
                if (ForcedDeletion) {
                    // v14+: ForcedDeletion 연산자 (경고 없음)
                    const systemUpdate = {};
                    for (const key of present) systemUpdate[key] = new ForcedDeletion();
                    await actor.update({ system: systemUpdate }, { render: false });
                } else {
                    // v13: 레거시 "-=" 삭제 문법
                    const update = {};
                    for (const key of present) update[`system.-=${key}`] = null;
                    await actor.update(update, { diff: false, render: false });
                }
                cleaned++;
            } catch (e) {
                console.error(`DX3rd | 액터 마이그레이션 실패: ${actor.name} (${actor.id})`, e);
            }
        }

        console.log(`DX3rd | 액터 스키마 평탄화: ${cleaned}개 액터의 죽은 필드 제거`);
    }

    /**
     * v2: Item base 템플릿에 있던 죽은 `system.name`(코어 item.name의 가짜 중복) 제거.
     * 모든 아이템 타입이 base를 상속하므로 월드/임베드 아이템 전부가 대상.
     * 읽는 코드·템플릿이 전무한 순수 bloat이며 실데이터는 건드리지 않는다.
     */
    async function migrateItemSchemaV2() {
        const ForcedDeletion = foundry.data?.operators?.ForcedDeletion;

        // 아이템 하나에 대한 업데이트 항목(_id 포함) 생성. 대상 없으면 null.
        const buildUpdate = (item) => {
            const src = item._source?.system;
            if (!src || !Object.prototype.hasOwnProperty.call(src, 'name')) return null;
            if (ForcedDeletion) return { _id: item.id, system: { name: new ForcedDeletion() } };
            return { _id: item.id, 'system.-=name': null };
        };
        const opts = ForcedDeletion ? { render: false } : { diff: false, render: false };
        let cleaned = 0;

        // 월드 레벨 아이템
        const worldUpdates = [];
        for (const item of game.items) { const u = buildUpdate(item); if (u) worldUpdates.push(u); }
        if (worldUpdates.length > 0) {
            try {
                await Item.updateDocuments(worldUpdates, opts);
                cleaned += worldUpdates.length;
            } catch (e) { console.error('DX3rd | 월드 아이템 마이그레이션 실패', e); }
        }

        // 액터 임베드 아이템 (액터별 배치 업데이트)
        for (const actor of game.actors) {
            const updates = [];
            for (const item of actor.items) { const u = buildUpdate(item); if (u) updates.push(u); }
            if (updates.length > 0) {
                try {
                    await actor.updateEmbeddedDocuments('Item', updates, opts);
                    cleaned += updates.length;
                } catch (e) {
                    console.error(`DX3rd | 임베드 아이템 마이그레이션 실패: ${actor.name} (${actor.id})`, e);
                }
            }
        }

        console.log(`DX3rd | 아이템 스키마 정리: ${cleaned}개 아이템의 죽은 system.name 제거`);
    }

    /**
     * v3: conditions.lostHP 제거.
     * 시트에 입력칸만 있고 읽는 코드가 전무했던 죽은 필드다.
     * HP 감소는 아이템 확장(damage)이 직접 처리하므로 이 값은 어떤 계산에도 쓰이지 않았다.
     * 같은 conditions 아래여도 action_end/action_delay/extra-turn은 전투 상태 머신이
     * 실제로 읽으므로 건드리지 않는다.
     *
     * conditions.healing 도 한때 여기 있었으나 **오진이었다.** 클린업 프로세스의 회복
     * 처리(combat.js)가 그때도 이 값을 읽고 있었고, 지우는 바람에 그 처리가 조용히
     * 0건이 됐다. 되살린 지금은 대상에서 뺀다 — 아직 v3 를 돌지 않은 월드의 회복
     * 설정까지 날아가기 때문이다. 다시 넣지 말 것.
     */
    async function migrateConditionsV3() {
        const deadKeys = ['lostHP'];
        const ForcedDeletion = foundry.data?.operators?.ForcedDeletion;
        let cleaned = 0;

        for (const actor of game.actors) {
            if (actor.type !== 'character' && actor.type !== 'enemy') continue;

            // _source를 봐야 한다. actor.system은 스키마 정리 결과라
            // 스키마에서 뺀 지금은 실제 저장 여부를 알 수 없다.
            const conditions = actor._source?.system?.conditions;
            if (!conditions) continue;

            const present = deadKeys.filter(key => Object.prototype.hasOwnProperty.call(conditions, key));
            if (present.length === 0) continue;

            try {
                if (ForcedDeletion) {
                    const conditionsUpdate = {};
                    for (const key of present) conditionsUpdate[key] = new ForcedDeletion();
                    await actor.update({ system: { conditions: conditionsUpdate } }, { render: false });
                } else {
                    const update = {};
                    for (const key of present) update[`system.conditions.-=${key}`] = null;
                    await actor.update(update, { diff: false, render: false });
                }
                cleaned++;
            } catch (e) {
                console.error(`DX3rd | conditions 마이그레이션 실패: ${actor.name} (${actor.id})`, e);
            }
        }

        console.log(`DX3rd | conditions 정리: ${cleaned}개 액터의 죽은 lostHP 제거`);
    }

    /**
     * v4: 자원 바 추적 후보 결함으로 지워진 토큰 바 복구.
     *
     * DataModel 이행 뒤 코어의 추적 후보 추론이 `conditions.extra-turn` 하나만 남겼고, 그 사이
     * 토큰 설정창을 한 번이라도 저장하면 bar1/bar2 의 attribute 가 빈 값(blank None 이 첫
     * 옵션이라 저장값이 선택지에 없으면 거기로 넘어간다)이나 `conditions.extra-turn` 으로
     * 덮어씌워졌다. 이 시스템의 기본은 bar1 = attributes.hp, bar2 = 캐릭터는
     * attributes.encroachment·enemy는 비어 있음이므로 그 상태로 되돌린다. 그 외의 속성이
     * 들어 있는 바는 사용자가 고른 것이니 건드리지 않는다.
     * 프로토타입 토큰과 배치된 토큰 양쪽을 본다.
     */
    async function migrateTokenBarsV4() {
        const barUpdates = (source, type) => {
            const updates = {};
            const b1 = source?.bar1?.attribute;
            const b2 = source?.bar2?.attribute;
            // bar1은 이 시스템이 생성 시 항상 hp로 심는다 — 빈 값/extra-turn은 결함의 흔적이다.
            if (!b1 || b1 === 'conditions.extra-turn') updates['bar1.attribute'] = 'attributes.hp';
            // bar2 기본: 캐릭터는 생성 훅이 encroachment를 심고, enemy는 비어 있다.
            if (type === 'character') {
                if (!b2 || b2 === 'conditions.extra-turn') updates['bar2.attribute'] = 'attributes.encroachment';
            } else if (b2 === 'conditions.extra-turn') {
                updates['bar2.attribute'] = '';
            }
            return updates;
        };

        let fixedActors = 0;
        for (const actor of game.actors) {
            if (actor.type !== 'character' && actor.type !== 'enemy') continue;
            const fix = barUpdates(actor.prototypeToken, actor.type);
            if (Object.keys(fix).length === 0) continue;
            const update = {};
            for (const [k, v] of Object.entries(fix)) update[`prototypeToken.${k}`] = v;
            try {
                await actor.update(update, { render: false });
                fixedActors++;
            } catch (e) {
                console.error(`DX3rd | 프로토타입 토큰 바 복구 실패: ${actor.name} (${actor.id})`, e);
            }
        }

        let fixedTokens = 0;
        for (const scene of game.scenes) {
            const updates = [];
            for (const token of scene.tokens) {
                const type = token.actor?.type;
                if (type !== 'character' && type !== 'enemy') continue;
                const fix = barUpdates(token, type);
                if (Object.keys(fix).length === 0) continue;
                updates.push({ _id: token.id, ...fix });
            }
            if (updates.length > 0) {
                try {
                    await scene.updateEmbeddedDocuments('Token', updates, { render: false });
                    fixedTokens += updates.length;
                } catch (e) {
                    console.error(`DX3rd | 배치 토큰 바 복구 실패: ${scene.name} (${scene.id})`, e);
                }
            }
        }

        console.log(`DX3rd | 토큰 자원 바 복구: 프로토타입 ${fixedActors}건 / 배치 토큰 ${fixedTokens}건`);
        if (fixedActors + fixedTokens > 0) {
            ui.notifications.info(`DX3rd | 토큰 자원 바를 복구했습니다 (액터 ${fixedActors}, 토큰 ${fixedTokens}).`);
        }
    }
})();
