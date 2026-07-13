// 컴펜디움 동기화
// ---------------------------------------------------------------------------
// 월드 액터가 소유한 임베디드 아이템 중, 시스템 컴펜디움에 (타입|이름)이 동일한
// 항목이 있으면 그 컴펜디움 데이터로 덮어쓴다. 기계화(system.attributes/effect/
// flags.itemExtend/macros)와 임베디드 ActiveEffect까지 함께 최신화하는 것이 목적.
//
// 방식: 임베디드 아이템을 삭제 후 컴펜디움 문서로 재생성(_id 보존 → 참조 유지).
//   전체 교체이므로 죽은 필드가 남지 않고 임베디드 AE도 그대로 따라온다.
//   단, 사용자가 조작한 인스턴스 상태(PRESERVE)는 교체 후 복원한다.
// GM 전용 수동 실행(설정 메뉴 버튼). 마이그레이션 버전과 무관하게 언제든 재실행 가능.
// ---------------------------------------------------------------------------

(function() {
    const SCOPE = 'dx3rd-emanim';
    // Item 타입 컴펜디움 팩(system.json packs 순서와 동일)
    const PACKS = ['effects', 'weapons', 'armors', 'vehicles', 'items', 'dlois', 'works', 'syndromes'];

    // 인스턴스별 상태(사용자/런타임이 조작한 값). 교체 후 되살린다.
    const PRESERVE = [
        'system.active.state',   // 토글 버프 on/off
        'system.used.state',     // 사용 횟수 소진 카운트
        'system.equipment',      // 장착 여부(무기/방어구/비클)
        'system.level.value'     // 취득 레벨
    ];

    const getPath = (obj, path) =>
        path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);

    function setPath(obj, path, val) {
        const keys = path.split('.');
        let o = obj;
        for (let i = 0; i < keys.length - 1; i++) {
            if (o[keys[i]] == null || typeof o[keys[i]] !== 'object') o[keys[i]] = {};
            o = o[keys[i]];
        }
        o[keys[keys.length - 1]] = val;
    }

    const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) =>
        ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const localize = (key) => game.i18n.localize(key);
    const format = (key, data) => game.i18n.format(key, data);
    const cloneData = (data) => foundry.utils?.deepClone
        ? foundry.utils.deepClone(data)
        : JSON.parse(JSON.stringify(data));

    // 동기화로 생성할 데이터. 검사와 실제 적용이 동일한 데이터를 기준으로 판단하게
    // 하여, 검사 결과와 적용 결과가 어긋나지 않게 한다.
    function prepareReplacement(item, src, preserveState = true) {
        // toObject() 구현체가 반환한 객체를 절대 직접 수정하지 않는다. 검사에서는
        // 같은 원본을 여러 번 비교하므로 특히 중요하다.
        const data = cloneData(src.toObject());
        data._id = item.id;              // 임베디드 id 보존(콤보/신드롬 참조 유지)
        data.sort = item.sort;           // 시트 정렬 위치 보존
        delete data.ownership;           // 임베디드는 액터 소유권을 따르므로 컴펜디움 소유권 제거
        delete data.folder;              // 임베디드는 폴더 무의미

        if (preserveState) {
            const oldObj = item.toObject();
            for (const p of PRESERVE) {
                const v = getPath(oldObj, p);
                if (v !== undefined) setPath(data, p, v);
            }
        }
        return data;
    }

    // 동기화 의미가 있는 필드만 비교한다. _id/sort/ownership/folder 같은 문서 위치
    // 메타데이터는 제외해 검사 결과가 실제 갱신 필요성과 일치하도록 한다.
    function comparable(data) {
        return {
            name: data.name,
            type: data.type,
            img: data.img,
            system: data.system || {},
            flags: data.flags || {},
            effects: data.effects || []
        };
    }

    function stableStringify(value) {
        if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
        if (value && typeof value === 'object') {
            return `{${Object.keys(value).sort().map(key =>
                `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
        }
        return JSON.stringify(value);
    }

    function differingFields(before, after) {
        return Object.keys(after).filter(key =>
            stableStringify(before[key]) !== stableStringify(after[key]));
    }

    // 컴펜디움 인덱스: `${type}|${name}` → 컴펜디움 문서
    async function buildIndex() {
        const index = new Map();
        let dupes = 0;
        for (const packName of PACKS) {
            const pack = game.packs.get(`${SCOPE}.${packName}`);
            if (!pack) continue;
            const docs = await pack.getDocuments();
            for (const doc of docs) {
                const key = `${doc.type}|${doc.name}`;
                if (index.has(key)) dupes++;   // 나중 항목이 이김
                index.set(key, doc);
            }
        }
        return { index, dupes };
    }

    // 드라이 스캔: 갱신 대상 계획 수집. [{actor, matches:[Item,...]}, ...]
    function scan(index) {
        const plan = [];
        for (const actor of game.actors) {
            const matches = [];
            for (const item of actor.items) {
                if (index.has(`${item.type}|${item.name}`)) matches.push(item);
            }
            if (matches.length) plan.push({ actor, matches });
        }
        return plan;
    }

    // 읽기 전용 감사. 실제 동기화에 쓰일 최종 데이터와 현재 아이템을 비교한다.
    function audit(index) {
        const plan = scan(index);
        const result = {
            plan,
            matched: 0,
            changed: 0,
            unchanged: 0,
            preserveOnly: 0,
            unmatched: 0,
            rows: []
        };

        for (const actor of game.actors) {
            const changes = [];
            for (const item of actor.items) {
                const src = index.get(`${item.type}|${item.name}`);
                if (!src) {
                    result.unmatched++;
                    continue;
                }
                result.matched++;
                const current = comparable(item.toObject());
                const replacement = comparable(prepareReplacement(item, src));
                const rawReplacement = comparable(prepareReplacement(item, src, false));
                const fields = differingFields(current, replacement);
                if (fields.length) {
                    result.changed++;
                    changes.push({ name: item.name, fields });
                } else if (differingFields(current, rawReplacement).length) {
                    result.preserveOnly++;
                } else {
                    result.unchanged++;
                }
            }
            if (changes.length) result.rows.push({ actor, changes });
        }
        return result;
    }

    // 실제 적용: 액터별로 삭제 후 재생성(keepId).
    async function apply(index, plan) {
        let actorsChanged = 0, itemsChanged = 0, failed = 0, recovered = 0, recoveryFailed = 0;
        for (const { actor, matches } of plan) {
            const createData = [];
            const deleteIds = [];
            const originalData = [];
            for (const item of matches) {
                const src = index.get(`${item.type}|${item.name}`);
                if (!src) continue;
                const oldObj = item.toObject();
                const data = prepareReplacement(item, src);
                deleteIds.push(item.id);
                createData.push(data);
                originalData.push(oldObj);
            }
            if (!createData.length) continue;
            let deleted = false;
            try {
                await actor.deleteEmbeddedDocuments('Item', deleteIds, { render: false });
                deleted = true;
                const created = await actor.createEmbeddedDocuments('Item', createData, { keepId: true, render: false });
                if (created.length !== createData.length) throw new Error('동기화 아이템 생성 수가 일치하지 않습니다.');
                actorsChanged++;
                itemsChanged += createData.length;
            } catch (e) {
                console.error(`DX3rd | 컴펜디움 동기화 실패: ${actor.name} (${actor.id})`, e);
                failed++;
                if (!deleted) continue;
                try {
                    // 부분 생성도 원래 ID를 점유할 수 있으므로, 같은 ID의 잔여 문서를
                    // 지운 뒤 삭제 전 스냅샷으로 복원한다.
                    const partialIds = actor.items.filter(item => deleteIds.includes(item.id)).map(item => item.id);
                    if (partialIds.length) await actor.deleteEmbeddedDocuments('Item', partialIds, { render: false });
                    const restored = await actor.createEmbeddedDocuments('Item', originalData, { keepId: true, render: false });
                    if (restored.length !== originalData.length) throw new Error('원본 아이템 복원 수가 일치하지 않습니다.');
                    recovered++;
                    console.warn(`DX3rd | 컴펜디움 동기화 원본 복원 완료: ${actor.name} (${actor.id})`);
                } catch (recoveryError) {
                    recoveryFailed++;
                    console.error(`DX3rd | 컴펜디움 동기화 원본 복원 실패: ${actor.name} (${actor.id})`, recoveryError);
                }
            }
        }
        return { actorsChanged, itemsChanged, failed, recovered, recoveryFailed };
    }

    async function openAudit() {
        if (!game.user.isGM) {
            ui.notifications.warn(localize('DX3rd.CompendiumSyncGMOnly'));
            return;
        }
        ui.notifications.info(localize('DX3rd.CompendiumSyncScanning'));
        const { index, dupes } = await buildIndex();
        const result = audit(index);
        const rows = result.rows.map(row => {
            const changes = row.changes.map(change =>
                `${esc(change.name)} <small>(${change.fields.map(field => esc(localize(`DX3rd.CompendiumAuditField${field[0].toUpperCase()}${field.slice(1)}`))).join(', ')})</small>`).join(', ');
            return `<li><b>${esc(row.actor.name)}</b> — ${changes}</li>`;
        }).join('');
        const content =
            `<p>${format('DX3rd.CompendiumAuditSummary', result)}</p>` +
            `<p style="opacity:.75;font-size:.9em">${localize('DX3rd.CompendiumAuditReadOnly')}</p>` +
            (dupes ? `<p style="color:orange">${format('DX3rd.CompendiumAuditDuplicates', { dupes })}</p>` : '') +
            (rows ? `<ul style="max-height:300px;overflow:auto;margin:.5em 0">${rows}</ul>` : '');
        await foundry.applications.api.DialogV2.wait({
            window: { title: localize('DX3rd.CompendiumAuditTitle') },
            position: { width: 700, height: 'auto' },
            classes: ['dx3rd-emanim', 'dialog', 'compendium-audit-dialog'],
            content,
            buttons: [{ action: 'close', label: localize('DX3rd.Close') }]
        });
        console.log('DX3rd | 컴펜디움 동기화 감사 결과', result);
        return result;
    }

    // 스캔 → 확인 다이얼로그 → 적용 → 결과 보고
    async function open() {
        if (!game.user.isGM) {
            ui.notifications.warn('DX3rd | GM만 실행할 수 있습니다.');
            return;
        }
        ui.notifications.info(game.i18n.localize('DX3rd.CompendiumSyncScanning'));

        const { index, dupes } = await buildIndex();
        const plan = scan(index);
        const totalItems = plan.reduce((n, p) => n + p.matches.length, 0);
        if (!totalItems) {
            ui.notifications.info(game.i18n.localize('DX3rd.CompendiumSyncNone'));
            return;
        }

        const rows = plan.map(p =>
            `<li><b>${esc(p.actor.name)}</b> — ${p.matches.length}개: ${p.matches.map(i => esc(i.name)).join(', ')}</li>`
        ).join('');
        const content =
            `<p>${plan.length}개 액터의 <b>${totalItems}</b>개 아이템을 컴펜디움 데이터로 덮어씁니다.</p>` +
            `<p style="opacity:.75;font-size:.9em">장착·사용·활성·레벨 상태는 보존되고, 그 외 데이터(효과·수치·기계화·ActiveEffect)는 컴펜디움 값으로 교체됩니다.</p>` +
            (dupes ? `<p style="color:orange">⚠ 컴펜디움에 동일 (타입|이름) 중복 ${dupes}건 — 마지막 항목 기준으로 적용됩니다.</p>` : '') +
            `<ul style="max-height:240px;overflow:auto;margin:.5em 0">${rows}</ul>`;

        const confirmed = await foundry.applications.api.DialogV2.confirm({
            window: { title: game.i18n.localize('DX3rd.CompendiumSyncTitle') },
            content,
            modal: true
        });
        if (!confirmed) return;

        const res = await apply(index, plan);
        const msg = format('DX3rd.CompendiumSyncComplete', res);
        if (res.failed) ui.notifications.warn(msg + (res.recoveryFailed ? ` ${localize('DX3rd.CompendiumSyncRecoveryFailed')}` : ` ${localize('DX3rd.CompendiumSyncRecovered')}`));
        else ui.notifications.info(msg);
        console.log('DX3rd | 컴펜디움 동기화 결과', res);
    }

    // 설정 메뉴 버튼 등록. type 클래스는 render 시 확인 플로우만 띄우고 창은 열지 않는다.
    Hooks.once('init', function() {
        class CompendiumSyncMenu extends foundry.applications.api.ApplicationV2 {
            static DEFAULT_OPTIONS = { id: 'dx3rd-compendium-sync-menu' };
            async render() {
                await open();
                return this;
            }
        }
        class CompendiumAuditMenu extends foundry.applications.api.ApplicationV2 {
            static DEFAULT_OPTIONS = { id: 'dx3rd-compendium-audit-menu' };
            async render() {
                await openAudit();
                return this;
            }
        }
        game.settings.registerMenu(SCOPE, 'compendiumSyncMenu', {
            name: 'DX3rd.CompendiumSyncName',
            label: 'DX3rd.CompendiumSyncLabel',
            hint: 'DX3rd.CompendiumSyncHint',
            icon: 'fas fa-cloud-download-alt',
            type: CompendiumSyncMenu,
            restricted: true
        });
        game.settings.registerMenu(SCOPE, 'compendiumAuditMenu', {
            name: 'DX3rd.CompendiumAuditName',
            label: 'DX3rd.CompendiumAuditLabel',
            hint: 'DX3rd.CompendiumAuditHint',
            icon: 'fas fa-magnifying-glass-chart',
            type: CompendiumAuditMenu,
            restricted: true
        });
    });

    window.DX3rdCompendiumSync = { open, openAudit, buildIndex, scan, audit, apply };
})();
