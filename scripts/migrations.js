// DX3rd 데이터 마이그레이션
// 시스템 스키마가 바뀌었을 때 기존 월드 문서를 1회 정리한다.
// systemMigrationVersion(world 설정)으로 중복 실행을 막는다.

(function() {
    // 현재까지 정의된 마이그레이션 단계 수. 새 마이그레이션을 추가할 때마다 +1.
    const CURRENT_MIGRATION = 3;

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
            // v3: 아무도 읽지 않던 conditions.lostHP / conditions.healing 제거
            if (version < 3) await migrateConditionsV3();

            await game.settings.set('dx3rd-emanim', 'systemMigrationVersion', CURRENT_MIGRATION);
            console.log('DX3rd | 데이터 마이그레이션 완료');
            ui.notifications.info('DX3rd | 데이터 마이그레이션이 완료되었습니다.');
        } catch (e) {
            console.error('DX3rd | 데이터 마이그레이션 실패:', e);
            ui.notifications.error('DX3rd | 데이터 마이그레이션 중 오류가 발생했습니다. 콘솔을 확인하세요.');
        }
    });

    /**
     * v1: template.json의 잘못된 `system:{...}` 중첩을 평탄화한 뒤,
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
     * v3: conditions.lostHP / conditions.healing 제거.
     * 시트에 입력칸만 있고 읽는 코드가 전무했던 죽은 필드다.
     * HP 증감은 아이템 확장(heal/damage)이 universal-healing 경로로 직접 처리하므로
     * 이 값들은 어떤 계산에도 쓰이지 않았다.
     * 같은 conditions 아래여도 action_end/action_delay/extra-turn은 전투 상태 머신이
     * 실제로 읽으므로 건드리지 않는다.
     */
    async function migrateConditionsV3() {
        const deadKeys = ['lostHP', 'healing'];
        const ForcedDeletion = foundry.data?.operators?.ForcedDeletion;
        let cleaned = 0;

        for (const actor of game.actors) {
            if (actor.type !== 'character' && actor.type !== 'enemy') continue;

            // _source를 봐야 한다. actor.system은 template.json 병합 결과라
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

        console.log(`DX3rd | conditions 정리: ${cleaned}개 액터의 죽은 lostHP/healing 제거`);
    }
})();
