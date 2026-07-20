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
        'system.active.state',        // 토글 버프 on/off
        'system.used.state',          // 사용 횟수 소진 카운트
        'system.attack-used.state',   // 무기 공격 횟수 소진 카운트(무기 외 타입엔 없어 자동 무시)
        'system.equipment'            // 장착 여부(무기/방어구/비클)
    ];

    // 이펙트/사이오닉의 습득 레벨은 플레이어가 성장시킨 인스턴스 데이터다.
    // max/upgrade 등 규칙 메타데이터는 보존하지 않아 컴펜디움 최신값을 받게 한다.
    // 소모품/기타 아이템의 수량은 플레이어가 구입·소비한 인스턴스 값이므로 보존한다.
    const TYPE_PRESERVE = {
        effect: ['system.level.init'],
        psionic: ['system.level.init'],
        once: ['system.quantity'],
        etc: ['system.quantity']
    };

    // D/E 로이스는 공식 데이터 갱신 대상이지만, 일반 로이스는 플레이어 관계
    // 데이터이므로 이름이 우연히 컴펜디움 항목과 같아도 덮어쓰지 않는다.
    function isSyncEligible(item) {
        if (item.type !== 'rois') return true;
        return ['D', 'E'].includes(item.system?.type);
    }

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
    const packLabel = (doc) => {
        const pack = typeof doc.pack === 'string' ? game.packs.get(doc.pack) : doc.pack;
        return pack?.metadata?.label || pack?.collection || doc.pack || '?';
    };

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
            const preservePaths = [...PRESERVE, ...(TYPE_PRESERVE[item.type] || [])];
            for (const p of preservePaths) {
                const v = getPath(oldObj, p);
                if (v !== undefined) setPath(data, p, v);
            }

            // value는 저장 원본이 아니라 현재 습득 레벨 + 침식률 보정의 파생값이다.
            // 보존한 init과 컴펜디움에서 갱신한 upgrade를 기준으로 다시 맞춘다.
            if (item.type === 'effect' || item.type === 'psionic') {
                const init = Number(getPath(data, 'system.level.init')) || 0;
                const upgrade = item.type === 'effect' && Boolean(getPath(data, 'system.level.upgrade'));
                const encroachmentLevel = upgrade
                    ? Number(item.actor?.system?.attributes?.encroachment?.level) || 0
                    : 0;
                setPath(data, 'system.level.value', init + encroachmentLevel);
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

    // 실제 교체가 필요한지 검사와 동일한 기준으로 판정한다. 보존 대상만 다른
    // 아이템은 교체해도 결과가 같으므로, 삭제·재생성 자체를 생략하는 편이 안전하다.
    function needsReplacement(item, src) {
        const current = comparable(item.toObject());
        const replacement = comparable(prepareReplacement(item, src));
        return differingFields(current, replacement).length > 0;
    }

    // 확인 창을 띄운 뒤의 외부 변경을 감지하기 위한 월드 아이템 지문이다.
    // 동기화 대상 필드만 포함해, 정렬·소유권 같은 문서 위치 메타데이터 변화에는
    // 불필요하게 중단되지 않는다.
    const itemFingerprint = (item) => stableStringify(comparable(item.toObject()));

    // 컴펜디움 인덱스: `${type}|${name}` → 컴펜디움 문서
    async function buildIndex() {
        const index = new Map();
        const duplicates = [];
        const missingPacks = [];
        for (const packName of PACKS) {
            const pack = game.packs.get(`${SCOPE}.${packName}`);
            if (!pack) {
                missingPacks.push(packName);
                continue;
            }
            const docs = await pack.getDocuments();
            for (const doc of docs) {
                const key = `${doc.type}|${doc.name}`;
                if (index.has(key)) {
                    duplicates.push({
                        key,
                        previous: index.get(key),
                        replacement: doc
                    });
                }
                index.set(key, doc);
            }
        }
        return { index, dupes: duplicates.length, duplicates, missingPacks };
    }

    // 드라이 스캔: 실제 갱신 대상 계획 수집. 동일/보존 상태만 다른 항목은 제외한다.
    // [{actor, matches:[{item: Item, fingerprint: string}, ...]}, ...]
    function scan(index) {
        const plan = [];
        for (const actor of game.actors) {
            const matches = [];
            for (const item of actor.items) {
                if (!isSyncEligible(item)) continue;
                const src = index.get(`${item.type}|${item.name}`);
                if (src && needsReplacement(item, src)) {
                    matches.push({ item, fingerprint: itemFingerprint(item) });
                }
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
            rows: [],
            unmatchedRows: []
        };

        for (const actor of game.actors) {
            const changes = [];
            const unmatched = [];
            for (const item of actor.items) {
                if (!isSyncEligible(item)) continue;
                const src = index.get(`${item.type}|${item.name}`);
                if (!src) {
                    result.unmatched++;
                    unmatched.push({ name: item.name, type: item.type });
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
            if (unmatched.length) result.unmatchedRows.push({ actor, unmatched });
        }
        return result;
    }

    // 기동 중 자동으로 쓰지 않는 복구 항목의 읽기 전용 점검 결과.
    function runtimeAudit() {
        const empty = { actors: 0, items: 0, effects: 0, rows: [] };
        return {
            applied: window.DX3rdAppliedToggle?.auditAll?.() || { scanned: 0, actors: 0, createOrUpdate: 0, remove: 0, rows: [] },
            instantCombo: window.DX3rdInstantComboCleanup?.audit?.() || empty,
            conditionOverlay: window.DX3rdConditionOverlayRepair?.audit?.() || empty
        };
    }

    function runtimeHasWork(result) {
        return result.applied.actors || result.instantCombo.items || result.conditionOverlay.effects;
    }

    function runtimeAuditContent(result) {
        const appliedRows = result.applied.rows.map(row =>
            `<li><b>${esc(row.actor.name)}</b> — ${format('DX3rd.AppliedToggleRepairRow', row)}</li>`).join('');
        const comboRows = result.instantCombo.rows.map(row =>
            `<li><b>${esc(row.actor.name)}</b> — ${format('DX3rd.InstantComboCleanupRow', { items: row.items.length })}</li>`).join('');
        const conditionRows = result.conditionOverlay.rows.map(row =>
            `<li><b>${esc(row.actor.name)}</b> — ${format('DX3rd.ConditionOverlayRepairRow', { effects: row.missing.length })}</li>`).join('');
        return `<h3>${localize('DX3rd.RuntimeSyncTitle')}</h3>` +
            `<p>${format('DX3rd.RuntimeSyncSummary', {
                appliedActors: result.applied.actors,
                appliedEffects: result.applied.createOrUpdate + result.applied.remove,
                instantCombos: result.instantCombo.items,
                conditionEffects: result.conditionOverlay.effects
            })}</p>` +
            (appliedRows ? `<details><summary>${localize('DX3rd.AppliedToggleRepairLabel')}</summary><ul>${appliedRows}</ul></details>` : '') +
            (comboRows ? `<details><summary>${localize('DX3rd.InstantComboCleanupLabel')}</summary><ul>${comboRows}</ul></details>` : '') +
            (conditionRows ? `<details><summary>${localize('DX3rd.ConditionOverlayRepairLabel')}</summary><ul>${conditionRows}</ul></details>` : '');
    }

    async function repairRuntime() {
        const applied = await window.DX3rdAppliedToggle?.syncAll?.() || { scanned: 0, changed: 0 };
        const instantCombo = await window.DX3rdInstantComboCleanup?.repair?.() || { actors: 0, items: 0 };
        const conditionOverlay = await window.DX3rdConditionOverlayRepair?.repair?.() || { actors: 0, effects: 0 };
        return { applied, instantCombo, conditionOverlay };
    }

    // 실제 적용: 액터별로 삭제 후 재생성(keepId).
    async function apply(index, plan) {
        let actorsChanged = 0, itemsChanged = 0, failed = 0, recovered = 0, recoveryFailed = 0, stale = 0;
        for (const { actor, matches } of plan) {
            const createData = [];
            const deleteIds = [];
            const originalData = [];
            for (const planned of matches) {
                // 계획 이후 변경된 문서는 삭제·재생성하지 않는다. 다음 검사에서 새
                // 상태를 기준으로 다시 판단할 수 있으므로, 보수적으로 건너뛴다.
                const item = actor.items.get(planned.item.id);
                if (!item || itemFingerprint(item) !== planned.fingerprint) {
                    stale++;
                    console.warn(`DX3rd | 컴펜디움 동기화 건너뜀(검사 후 변경): ${actor.name} / ${planned.item.name}`);
                    continue;
                }
                if (!isSyncEligible(item)) continue;
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
        return { actorsChanged, itemsChanged, failed, recovered, recoveryFailed, stale };
    }

    async function openAudit() {
        if (!game.user.isGM) {
            ui.notifications.warn(localize('DX3rd.CompendiumSyncGMOnly'));
            return;
        }
        ui.notifications.info(localize('DX3rd.CompendiumSyncScanning'));
        const { index, dupes, duplicates, missingPacks } = await buildIndex();
        const result = audit(index);
        const runtime = runtimeAudit();
        const rows = result.rows.map(row => {
            const changes = row.changes.map(change =>
                `${esc(change.name)} <small>(${change.fields.map(field => esc(localize(`DX3rd.CompendiumAuditField${field[0].toUpperCase()}${field.slice(1)}`))).join(', ')})</small>`).join(', ');
            return `<li><b>${esc(row.actor.name)}</b> — ${changes}</li>`;
        }).join('');
        const unmatchedRows = result.unmatchedRows.map(row =>
            `<li><b>${esc(row.actor.name)}</b> — ${row.unmatched.map(item =>
                `${esc(item.name)} <small>(${esc(item.type)})</small>`).join(', ')}</li>`
        ).join('');
        const duplicateRows = duplicates.map(({ key, previous, replacement }) =>
            `<li><code>${esc(key)}</code> — ${esc(packLabel(previous))} → ${esc(packLabel(replacement))}</li>`
        ).join('');
        const content =
            `<p>${format('DX3rd.CompendiumAuditSummary', result)}</p>` +
            `<p style="opacity:.75;font-size:.9em">${localize('DX3rd.CompendiumAuditReadOnly')}</p>` +
            (missingPacks.length ? `<p style="color:orange">${format('DX3rd.CompendiumAuditMissingPacks', { packs: missingPacks.map(esc).join(', ') })}</p>` : '') +
            (dupes ? `<details><summary style="color:orange">${format('DX3rd.CompendiumAuditDuplicates', { dupes })}</summary><ul style="max-height:160px;overflow:auto;margin:.5em 0">${duplicateRows}</ul></details>` : '') +
            (rows ? `<details open><summary>${localize('DX3rd.CompendiumAuditChanges')}</summary><ul style="max-height:220px;overflow:auto;margin:.5em 0">${rows}</ul></details>` : '') +
            (unmatchedRows ? `<details><summary>${format('DX3rd.CompendiumAuditUnmatched', { unmatched: result.unmatched })}</summary><ul style="max-height:180px;overflow:auto;margin:.5em 0">${unmatchedRows}</ul></details>` : '') +
            runtimeAuditContent(runtime);
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
    async function openItemSync() {
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
            `<li><b>${esc(p.actor.name)}</b> — ${p.matches.length}개: ${p.matches.map(({ item }) => esc(item.name)).join(', ')}</li>`
        ).join('');
        const content =
            `<p>${plan.length}개 액터의 <b>${totalItems}</b>개 아이템을 컴펜디움 데이터로 덮어씁니다.</p>` +
            `<p style="opacity:.75;font-size:.9em">${localize('DX3rd.CompendiumSyncPreserveHint')}</p>` +
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
        if (res.failed || res.stale) {
            const notices = [];
            if (res.failed) notices.push(res.recoveryFailed ? localize('DX3rd.CompendiumSyncRecoveryFailed') : localize('DX3rd.CompendiumSyncRecovered'));
            if (res.stale) notices.push(format('DX3rd.CompendiumSyncStale', { stale: res.stale }));
            ui.notifications.warn(`${msg} ${notices.join(' ')}`);
        }
        else ui.notifications.info(msg);
        console.log('DX3rd | 컴펜디움 동기화 결과', res);
    }

    // 동기화 버튼의 단일 실행 경로: 모든 자동 복구 후보를 검사한 뒤 GM 확인 후에만 적용.
    async function open() {
        if (!game.user.isGM) {
            ui.notifications.warn(localize('DX3rd.CompendiumSyncGMOnly'));
            return;
        }
        ui.notifications.info(localize('DX3rd.CompendiumSyncScanning'));
        const { index, dupes } = await buildIndex();
        const plan = scan(index);
        const runtime = runtimeAudit();
        const totalItems = plan.reduce((n, p) => n + p.matches.length, 0);
        if (!totalItems && !runtimeHasWork(runtime)) {
            ui.notifications.info(localize('DX3rd.FullSyncNone'));
            return;
        }
        const itemRows = plan.map(p =>
            `<li><b>${esc(p.actor.name)}</b> — ${p.matches.length}개: ${p.matches.map(({ item }) => esc(item.name)).join(', ')}</li>`).join('');
        const content =
            `<p>${format('DX3rd.FullSyncSummary', { actors: plan.length, items: totalItems })}</p>` +
            `<p style="opacity:.75;font-size:.9em">${localize('DX3rd.FullSyncHint')}</p>` +
            (dupes ? `<p style="color:orange">⚠ 컴펜디움에 동일 (타입|이름) 중복 ${dupes}건 — 마지막 항목 기준으로 적용됩니다.</p>` : '') +
            (itemRows ? `<details open><summary>${localize('DX3rd.CompendiumSyncLabel')}</summary><ul style="max-height:200px;overflow:auto;margin:.5em 0">${itemRows}</ul></details>` : '') +
            runtimeAuditContent(runtime);
        const confirmed = await foundry.applications.api.DialogV2.confirm({
            window: { title: localize('DX3rd.CompendiumSyncHubTitle') }, content, modal: true
        });
        if (!confirmed) return;
        const compendium = totalItems ? await apply(index, plan) : { actorsChanged: 0, itemsChanged: 0, failed: 0 };
        const repaired = await repairRuntime();
        ui.notifications.info(format('DX3rd.FullSyncComplete', {
            actors: compendium.actorsChanged,
            items: compendium.itemsChanged,
            aeActors: repaired.applied.changed,
            instantCombos: repaired.instantCombo.items,
            conditionEffects: repaired.conditionOverlay.effects
        }));
    }

    // 토글형 이펙트의 Applied ActiveEffect는 기동 중 전수 생성하지 않는다.
    // 이 메뉴에서만 검사 → 확인 → 필요한 항목만 보정한다.
    async function openAppliedToggleRepair() {
        if (!game.user.isGM) {
            ui.notifications.warn(localize('DX3rd.CompendiumSyncGMOnly'));
            return;
        }
        const toggle = window.DX3rdAppliedToggle;
        if (!toggle?.auditAll || !toggle?.syncAll) {
            ui.notifications.error(localize('DX3rd.AppliedToggleRepairUnavailable'));
            return;
        }
        const audit = toggle.auditAll();
        if (!audit.actors) {
            ui.notifications.info(localize('DX3rd.AppliedToggleRepairNone'));
            return audit;
        }
        const rows = audit.rows.map(row =>
            `<li><b>${esc(row.actor.name)}</b> — ${format('DX3rd.AppliedToggleRepairRow', row)}</li>`
        ).join('');
        const confirmed = await foundry.applications.api.DialogV2.confirm({
            window: { title: localize('DX3rd.AppliedToggleRepairTitle') },
            content:
                `<p>${format('DX3rd.AppliedToggleRepairSummary', audit)}</p>` +
                `<p style="opacity:.75;font-size:.9em">${localize('DX3rd.AppliedToggleRepairHint')}</p>` +
                `<ul style="max-height:240px;overflow:auto;margin:.5em 0">${rows}</ul>`,
            modal: true
        });
        if (!confirmed) return audit;
        const result = await toggle.syncAll();
        ui.notifications.info(format('DX3rd.AppliedToggleRepairComplete', result));
        return result;
    }

    // 이전 선택식 UI 호환용 진입점. 설정 메뉴는 아래에서 open() 일괄 동기화를 사용한다.
    async function openHub() {
        if (!game.user.isGM) {
            ui.notifications.warn(localize('DX3rd.CompendiumSyncGMOnly'));
            return;
        }
        const action = await foundry.applications.api.DialogV2.wait({
            window: { title: localize('DX3rd.CompendiumSyncHubTitle') },
            position: { width: 520, height: 'auto' },
            classes: ['dx3rd-emanim', 'dialog', 'compendium-sync-hub'],
            content: `<p>${localize('DX3rd.CompendiumSyncHubHint')}</p>`,
            buttons: [
                { action: 'items', icon: 'fas fa-cloud-download-alt', label: localize('DX3rd.CompendiumSyncLabel'), callback: () => 'items' },
                { action: 'applied', icon: 'fas fa-wand-magic-sparkles', label: localize('DX3rd.AppliedToggleRepairLabel'), callback: () => 'applied' },
                { action: 'cancel', icon: 'fas fa-times', label: localize('DX3rd.Cancel'), callback: () => 'cancel' }
            ]
        });
        if (action === 'items') return open();
        if (action === 'applied') return openAppliedToggleRepair();
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

    window.DX3rdCompendiumSync = { open, openItemSync, openAudit, openHub, openAppliedToggleRepair, buildIndex, scan, audit, apply, runtimeAudit };
})();
