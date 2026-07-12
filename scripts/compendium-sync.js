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

    // 실제 적용: 액터별로 삭제 후 재생성(keepId).
    async function apply(index, plan) {
        let actorsChanged = 0, itemsChanged = 0, failed = 0;
        for (const { actor, matches } of plan) {
            const createData = [];
            const deleteIds = [];
            for (const item of matches) {
                const src = index.get(`${item.type}|${item.name}`);
                if (!src) continue;

                const data = src.toObject();     // system/flags/img/effects 포함(컴펜디움 새 _id)
                data._id = item.id;              // 임베디드 id 보존(콤보/신드롬 참조 유지)
                data.sort = item.sort;           // 시트 정렬 위치 보존
                delete data.ownership;           // 임베디드는 액터 소유권을 따르므로 컴펜디움 소유권 제거
                delete data.folder;              // 임베디드는 폴더 무의미

                // 인스턴스 상태 복원
                const oldObj = item.toObject();
                for (const p of PRESERVE) {
                    const v = getPath(oldObj, p);
                    if (v !== undefined) setPath(data, p, v);
                }

                deleteIds.push(item.id);
                createData.push(data);
            }
            if (!createData.length) continue;
            try {
                await actor.deleteEmbeddedDocuments('Item', deleteIds, { render: false });
                await actor.createEmbeddedDocuments('Item', createData, { keepId: true, render: false });
                actorsChanged++;
                itemsChanged += createData.length;
            } catch (e) {
                console.error(`DX3rd | 컴펜디움 동기화 실패: ${actor.name} (${actor.id})`, e);
                failed++;
            }
        }
        return { actorsChanged, itemsChanged, failed };
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
        const msg = `DX3rd | 동기화 완료 — 액터 ${res.actorsChanged} / 아이템 ${res.itemsChanged}` +
            (res.failed ? ` / 실패 ${res.failed}` : '');
        if (res.failed) ui.notifications.warn(msg + ' (콘솔 확인)');
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
        game.settings.registerMenu(SCOPE, 'compendiumSyncMenu', {
            name: 'DX3rd.CompendiumSyncName',
            label: 'DX3rd.CompendiumSyncLabel',
            hint: 'DX3rd.CompendiumSyncHint',
            icon: 'fas fa-cloud-download-alt',
            type: CompendiumSyncMenu,
            restricted: true
        });
    });

    window.DX3rdCompendiumSync = { open, buildIndex, scan, apply };
})();
