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
    const EXCLUSION_SETTING = 'compendiumSyncExclusions';
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

    // 컴펜디움에서 아이템의 타입이 재분류되면 `type|name` 정확 매칭이 끊겨, 그 사본은
    // 몇 번을 동기화해도 낡은 채로 남는다(예: 응급치료 키트가 etc → once로 이동).
    // once/etc는 둘 다 소모품·기타 아이템으로 스키마가 호환되므로 상호 별칭을 허용한다.
    // 이 목록을 넓히지 말 것: weapon/effect처럼 이름만 같고 실체가 다른 조합(이펙트가
    // 생성한 무기, 플레이어가 만든 콤보)까지 매칭되면 멀쩡한 인스턴스를 덮어쓴다.
    const TYPE_ALIASES = {
        once: ['etc'],
        etc: ['once']
    };

    // D/E 로이스는 공식 데이터 갱신 대상이지만, 일반 로이스는 플레이어 관계
    // 데이터이므로 이름이 우연히 컴펜디움 항목과 같아도 덮어쓰지 않는다.
    // 맨손은 액터별 커스터마이즈가 잦은 기본 무기이므로 컴펜디움 원본으로 되돌리지 않는다.
    function isSyncEligible(item) {
        if (item.type === 'weapon' && item.name === '맨손') return false;
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
        // preCreateItem은 일반 가방 아이콘으로 저장된 once를 액터에 생성할 때 알약
        // 아이콘으로 정규화한다. 비교 쪽이 컴펜디움의 가방 아이콘을 그대로 기대하면
        // 성공적으로 갱신한 직후에도 이미지 차이로 영원히 다시 잡힌다.
        if (data.type === 'once' && (!data.img || data.img === 'icons/svg/item-bag.svg')) {
            data.img = 'icons/svg/pill.svg';
        }
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
                const effectLevelBonus = item.type === 'effect'
                    ? window.DX3rdEffectLevel?.bonus(item.actor) || 0
                    : 0;
                setPath(data, 'system.level.value', init + encroachmentLevel + effectLevelBonus);
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
    // nameTypes는 이름 하나가 몇 종류의 타입으로 존재하는지를 담는다. 별칭 매칭이
    // 동명이물을 집어오지 않도록 판정하는 데 쓴다.
    async function buildIndex() {
        const index = new Map();
        const nameTypes = new Map();
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
                if (!nameTypes.has(doc.name)) nameTypes.set(doc.name, new Set());
                nameTypes.get(doc.name).add(doc.type);
            }
        }
        return { index, nameTypes, dupes: duplicates.length, duplicates, missingPacks };
    }

    // 임베디드 아이템에 대응하는 컴펜디움 문서를 찾는다. 정확 매칭이 우선이고,
    // 실패했을 때만 TYPE_ALIASES로 재분류를 따라간다. 별칭은 다음을 모두 만족할 때만
    // 적용해, 이름이 겹치는 별개 문서를 덮어쓰지 않는다.
    //   - 컴펜디움에서 그 이름이 단 하나의 타입으로만 존재할 것(동명이물 배제)
    //   - 같은 액터가 별칭 타입의 사본을 이미 갖고 있지 않을 것(중복 교체 배제)
    function resolveSource(index, nameTypes, actor, item) {
        const exact = index.get(`${item.type}|${item.name}`);
        if (exact) return exact;
        const types = nameTypes.get(item.name);
        if (!types || types.size !== 1) return null;
        for (const alias of TYPE_ALIASES[item.type] || []) {
            const src = index.get(`${alias}|${item.name}`);
            if (!src) continue;
            const hasExactSibling = actor.items.some(other =>
                other.id !== item.id && other.name === item.name && other.type === alias);
            if (hasExactSibling) return null;
            return src;
        }
        return null;
    }

    // 드라이 스캔: 실제 갱신 대상 계획 수집. 동일/보존 상태만 다른 항목은 제외한다.
    // [{actor, matches:[{item: Item, fingerprint: string}, ...]}, ...]
    function scan(index, nameTypes) {
        const plan = [];
        for (const actor of game.actors) {
            const matches = [];
            for (const item of actor.items) {
                if (!isSyncEligible(item)) continue;
                const src = resolveSource(index, nameTypes, actor, item);
                if (src && needsReplacement(item, src)) {
                    matches.push({ item, fingerprint: itemFingerprint(item) });
                }
            }
            if (matches.length) plan.push({ actor, matches });
        }
        return plan;
    }

    // 데이터 갱신에서 제외할 액터 임베디드 아이템은 월드 설정에 보관한다.
    // 아이템 자체에 플래그를 쓰면 그 플래그 변경이 확인창 이후의 지문 검사를 깨뜨리고,
    // 컴펜디움 교체 시 플래그 보존이라는 별도 예외도 생기므로 외부 설정이 더 안전하다.
    const exclusionKey = (actorId, itemId) => `${actorId}:${itemId}`;

    function getExclusions() {
        const value = game.settings.get(SCOPE, EXCLUSION_SETTING);
        return value && typeof value === 'object' && !Array.isArray(value) ? cloneData(value) : {};
    }

    function filterPlan(plan, exclusions = {}) {
        return plan.map(({ actor, matches }) => ({
            actor,
            matches: matches.filter(({ item }) => !exclusions[exclusionKey(actor.id, item.id)])
        })).filter(({ matches }) => matches.length);
    }

    function renderSelectablePlan(plan, exclusions) {
        return plan.map(({ actor, matches }) => {
            const items = matches.map(({ item }) => {
                const key = exclusionKey(actor.id, item.id);
                const checked = exclusions[key] ? ' checked' : '';
                return `<li style="display:flex;gap:.75em;align-items:center">` +
                    `<span style="flex:1">${esc(item.name)}</span>` +
                    `<label style="white-space:nowrap"><input type="checkbox" ` +
                    `data-compendium-sync-exclusion value="${esc(key)}"${checked}> ` +
                    `${localize('DX3rd.CompendiumSyncExcludeLabel')}</label></li>`;
            }).join('');
            return `<li><b>${esc(actor.name)}</b><ul style="margin:.25em 0 .6em">${items}</ul></li>`;
        }).join('');
    }

    async function saveExclusionSelection(plan, root) {
        const selected = new Set(Array.from(
            root.querySelectorAll('input[data-compendium-sync-exclusion]:checked'),
            input => input.value
        ));
        const exclusions = getExclusions();
        for (const { actor, matches } of plan) {
            for (const { item } of matches) {
                const key = exclusionKey(actor.id, item.id);
                if (selected.has(key)) exclusions[key] = true;
                else delete exclusions[key];
            }
        }
        await game.settings.set(SCOPE, EXCLUSION_SETTING, exclusions);
        return filterPlan(plan, exclusions);
    }

    async function confirmSyncSelection({ title, plan, contentBefore = '', contentAfter = '' }) {
        const exclusions = getExclusions();
        const rows = renderSelectablePlan(plan, exclusions);
        return foundry.applications.api.DialogV2.wait({
            window: { title },
            position: { width: 700, height: 'auto' },
            classes: ['dx3rd-emanim', 'dialog', 'compendium-sync-dialog'],
            content:
                contentBefore +
                (rows
                    ? `<p style="opacity:.75;font-size:.9em">${localize('DX3rd.CompendiumSyncExcludeHint')}</p>` +
                      `<ul style="max-height:300px;overflow:auto;margin:.5em 0">${rows}</ul>`
                    : '') +
                contentAfter,
            modal: true,
            rejectClose: false,
            buttons: [
                {
                    action: 'confirm',
                    icon: 'fas fa-cloud-download-alt',
                    label: localize('DX3rd.CompendiumSyncRun'),
                    default: true,
                    callback: async (event, button, dialog) =>
                        saveExclusionSelection(plan, dialog.element)
                },
                {
                    action: 'cancel',
                    icon: 'fas fa-times',
                    label: localize('DX3rd.Cancel'),
                    callback: () => null
                }
            ]
        });
    }

    // 읽기 전용 감사. 실제 동기화에 쓰일 최종 데이터와 현재 아이템을 비교한다.
    function audit(index, nameTypes) {
        const plan = scan(index, nameTypes);
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
                const src = resolveSource(index, nameTypes, actor, item);
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
    async function apply(index, nameTypes, plan) {
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
                const src = resolveSource(index, nameTypes, actor, item);
                if (!src) continue;
                if (src.type !== item.type) {
                    console.warn(`DX3rd | 컴펜디움 동기화 타입 재분류: ${actor.name} / ${item.name} (${item.type} → ${src.type})`);
                }
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
        const { index, nameTypes, dupes, duplicates, missingPacks } = await buildIndex();
        const result = audit(index, nameTypes);
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

        const { index, nameTypes, dupes } = await buildIndex();
        const plan = scan(index, nameTypes);
        const totalItems = plan.reduce((n, p) => n + p.matches.length, 0);
        if (!totalItems) {
            ui.notifications.info(game.i18n.localize('DX3rd.CompendiumSyncNone'));
            return;
        }

        const contentBefore =
            `<p>${plan.length}개 액터의 <b>${totalItems}</b>개 아이템을 컴펜디움 데이터로 덮어씁니다.</p>` +
            `<p style="opacity:.75;font-size:.9em">${localize('DX3rd.CompendiumSyncPreserveHint')}</p>` +
            (dupes ? `<p style="color:orange">⚠ 컴펜디움에 동일 (타입|이름) 중복 ${dupes}건 — 마지막 항목 기준으로 적용됩니다.</p>` : '');
        const selectedPlan = await confirmSyncSelection({
            title: game.i18n.localize('DX3rd.CompendiumSyncTitle'),
            plan,
            contentBefore
        });
        if (!selectedPlan) return;
        const selectedItems = selectedPlan.reduce((n, p) => n + p.matches.length, 0);
        if (!selectedItems) {
            ui.notifications.info(localize('DX3rd.CompendiumSyncExcludedAll'));
            return;
        }

        const res = await apply(index, nameTypes, selectedPlan);
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
        const { index, nameTypes, dupes } = await buildIndex();
        const plan = scan(index, nameTypes);
        const runtime = runtimeAudit();
        const totalItems = plan.reduce((n, p) => n + p.matches.length, 0);
        if (!totalItems && !runtimeHasWork(runtime)) {
            ui.notifications.info(localize('DX3rd.FullSyncNone'));
            return;
        }
        const contentBefore =
            `<p>${format('DX3rd.FullSyncSummary', { actors: plan.length, items: totalItems })}</p>` +
            `<p style="opacity:.75;font-size:.9em">${localize('DX3rd.FullSyncHint')}</p>` +
            (dupes ? `<p style="color:orange">⚠ 컴펜디움에 동일 (타입|이름) 중복 ${dupes}건 — 마지막 항목 기준으로 적용됩니다.</p>` : '');
        const selectedPlan = await confirmSyncSelection({
            title: localize('DX3rd.CompendiumSyncHubTitle'),
            plan,
            contentBefore,
            contentAfter: runtimeAuditContent(runtime)
        });
        if (!selectedPlan) return;
        const selectedItems = selectedPlan.reduce((n, p) => n + p.matches.length, 0);
        if (!selectedItems && !runtimeHasWork(runtime)) {
            ui.notifications.info(localize('DX3rd.CompendiumSyncExcludedAll'));
            return;
        }
        const compendium = selectedItems ? await apply(index, nameTypes, selectedPlan) : { actorsChanged: 0, itemsChanged: 0, failed: 0 };
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
        game.settings.register(SCOPE, EXCLUSION_SETTING, {
            scope: 'world',
            config: false,
            type: Object,
            default: {}
        });
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

    window.DX3rdCompendiumSync = {
        open, openItemSync, openAudit, openHub, openAppliedToggleRepair,
        buildIndex, resolveSource, scan, audit, apply, runtimeAudit,
        isSyncEligible, prepareReplacement, needsReplacement, exclusionKey, filterPlan
    };
})();
