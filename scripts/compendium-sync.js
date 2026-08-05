// 컴펜디움 동기화
// ---------------------------------------------------------------------------
// 월드 액터가 소유한 임베디드 아이템 중, 시스템 컴펜디움에 (타입|이름)이 동일한
// 항목이 있으면 그 컴펜디움 데이터로 갱신한다. 기계화(system.attributes/effect/
// flags.itemExtend/macros)와 임베디드 ActiveEffect까지 함께 최신화하는 것이 목적.
//
// 방식: 임베디드 아이템을 삭제 후 병합 결과로 재생성(_id 보존 → 참조 유지).
//   전체 교체이므로 죽은 필드가 남지 않고 임베디드 AE도 그대로 따라온다.
//
// **3-way 병합** — 이 파일의 핵심 불변식.
//   「현재 값 ≠ 컴펜디움 값」만으로 갱신 대상을 정하면 액터에서 손본 값도 말없이
//   되돌아간다. PRESERVE 화이트리스트 밖은 전부 소실됐고, 그래서 갱신 한 번이
//   손질을 통째로 날렸다. 팩 쪽에는 이미 같은 문제의 답이 있다 —
//   `tools/recover-pack-edits.mjs` 는 *지난 빌드가 팩에 넣은 값*을 기준선으로 두고
//   `live ≠ prev` 로만 손튜닝을 판정한다. 월드 동기화도 같은 구조를 쓴다:
//
//     기준선(base) = 마지막 동기화 시점의 **컴펜디움** 값. 아이템 flag 에 잎 경로별
//                    해시로 저장한다(`flags.dx3rd-emanim.syncBaseline`).
//     내 값(mine)   = 지금 액터가 들고 있는 값
//     최신(theirs)  = 지금 컴펜디움 값
//
//     theirs = base            → 컴펜디움 무변화. mine 이 다르면 **사용자 편집이므로 유지**
//     mine = base ≠ theirs     → 컴펜디움만 변경 → **최신 반영**
//     mine ≠ base ≠ theirs     → **충돌**. 기본은 내 값 유지, 아이템별로 컴펜디움 우선 선택
//
//   기준선을 전체 데이터 사본이 아니라 잎 경로별 해시로 두는 이유는 크기다. 판정에
//   필요한 것은 「base 와 같은가」뿐이고, 값 자체는 mine/theirs 로 표시할 수 있다.
//   기준선이 없는 아이템(이 기능 이전에 만들어진 것)은 예전대로 전체 교체하되
//   확인창에 「기준선 없음」으로 표시해 사용자가 알고 결정하게 한다. 현재 값이
//   컴펜디움과 이미 같은 아이템은 정보 손실 없이 기준선을 채택할 수 있으므로
//   삭제·재생성 없이 flag 만 기록한다(`baselineAdoptions`).
//
//   인스턴스 상태(PRESERVE)와 파생값(TYPE_DERIVED)은 병합 대상에서 제외한다 —
//   전자는 규칙상 항상 내 것이고, 후자는 보존한 값과 컴펜디움 값으로 다시 계산한다.
//
// GM 전용 수동 실행(설정 메뉴 버튼). 마이그레이션 버전과 무관하게 언제든 재실행 가능.
// ---------------------------------------------------------------------------

(function() {
    const SCOPE = 'dx3rd-emanim';
    const EXCLUSION_SETTING = 'compendiumSyncExclusions';
    const PACK_PREFERENCE_SETTING = 'compendiumSyncPackPreference';
    // 기준선 flag. 버전을 올리면 옛 기준선은 무시되고 전체 교체로 되돌아간다.
    const BASELINE_FLAG = 'syncBaseline';
    const BASELINE_VERSION = 1;
    // Item 타입 컴펜디움 팩(system.json packs 순서와 동일)
    const PACKS = ['effects', 'weapons', 'armors', 'vehicles', 'items', 'dlois', 'works', 'syndromes'];

    // 인스턴스별 상태(사용자/런타임이 조작한 값). 교체 후 되살린다.
    const PRESERVE = [
        'system.active.state',        // 토글 버프 on/off
        'system.used.state',          // 사용 횟수 소진 카운트
        'system.attack-used.state',   // 무기 공격 횟수 소진 카운트(무기 외 타입엔 없어 자동 무시)
        'system.equipment',           // 장착 여부(무기/방어구/비클)
        'system.saving.acquisition'   // 액터 소유본의 획득 방식(상비/구매)
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

    // 파생값. prepareReplacement 가 보존한 init 과 컴펜디움 upgrade 로 다시 계산하므로
    // 병합이 옛 값을 되살리면 안 된다.
    const TYPE_DERIVED = {
        effect: ['system.level.value'],
        psionic: ['system.level.value']
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

    function deletePath(obj, path) {
        const keys = path.split('.');
        let o = obj;
        for (let i = 0; i < keys.length - 1; i++) {
            if (o == null || typeof o !== 'object') return;
            o = o[keys[i]];
        }
        if (o && typeof o === 'object') delete o[keys[keys.length - 1]];
    }

    const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) =>
        ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const localize = (key) => game.i18n.localize(key);
    const format = (key, data) => game.i18n.format(key, data);
    const cloneData = (data) => foundry.utils?.deepClone
        ? foundry.utils.deepClone(data)
        : JSON.parse(JSON.stringify(data));
    const packId = (doc) => (typeof doc.pack === 'string' ? doc.pack : doc.pack?.collection) || '';
    const packLabel = (doc) => {
        const pack = typeof doc.pack === 'string' ? game.packs?.get(doc.pack) : doc.pack;
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

    // 기준선 flag 자체는 비교 대상이 아니다. 포함하면 기준선을 기록하는 것만으로
    // 「갱신 필요」가 되어 매번 삭제·재생성이 돌고, 지문 검사도 무의미해진다.
    function comparableForMerge(data) {
        const value = comparable(data);
        const flags = cloneData(value.flags || {});
        const scoped = flags[SCOPE];
        if (scoped && typeof scoped === 'object') {
            delete scoped[BASELINE_FLAG];
            if (!Object.keys(scoped).length) delete flags[SCOPE];
        }
        value.flags = flags;
        return value;
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

    // ── 기준선 ──────────────────────────────────────────────────────────────

    // 잎 경로별 해시. 32비트 두 갈래를 이어 붙여 충돌 확률을 실질적으로 없앤다.
    // 충돌해도 결과는 「그 잎만 예전처럼 판정」이라 데이터가 깨지지는 않는다.
    function hashValue(value) {
        const str = stableStringify(value);
        let h1 = 0x811c9dc5;
        let h2 = 0xdeadbeef;
        for (let i = 0; i < str.length; i++) {
            const c = str.charCodeAt(i);
            h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
            h2 = Math.imul(h2 + c, 0x85ebca6b) >>> 0;
            h2 = ((h2 ^ (h2 >>> 13)) >>> 0);
        }
        return `${h1.toString(36)}.${h2.toString(36)}`;
    }

    // 잎 = 원시값 · 배열 · 빈 객체. 배열을 통째로 잎으로 보는 것은 의도적이다 —
    // 보정 행이나 AE 배열은 인덱스가 밀리면 잎 단위 비교가 잡음으로 뒤덮인다.
    function collectLeaves(value, prefix, out) {
        if (value && typeof value === 'object' && !Array.isArray(value)) {
            const keys = Object.keys(value);
            if (keys.length) {
                for (const key of keys) collectLeaves(value[key], prefix ? `${prefix}.${key}` : key, out);
                return out;
            }
        }
        out.set(prefix, value);
        return out;
    }

    const leafMap = (data) => collectLeaves(comparableForMerge(data), '', new Map());

    function encodeBaseline(leaves) {
        const lines = [];
        for (const [path, value] of leaves) lines.push(`${path}\t${hashValue(value)}`);
        // 경로에 점이 들어 있으므로 객체 키로 두면 Foundry 의 expandObject 에 걸린다.
        // 한 줄에 하나씩 담은 문자열이면 그 위험이 없고 크기도 작다.
        return { version: BASELINE_VERSION, leaves: lines.join('\n') };
    }

    function decodeBaseline(data) {
        const stored = data?.flags?.[SCOPE]?.[BASELINE_FLAG];
        if (!stored || stored.version !== BASELINE_VERSION || typeof stored.leaves !== 'string') return null;
        const map = new Map();
        for (const line of stored.leaves.split('\n')) {
            const tab = line.indexOf('\t');
            if (tab < 0) continue;
            map.set(line.slice(0, tab), line.slice(tab + 1));
        }
        return map;
    }

    // 병합에서 손대지 않을 경로(인스턴스 상태 + 파생값).
    function reservedPaths(item) {
        return [...PRESERVE, ...(TYPE_PRESERVE[item.type] || []), ...(TYPE_DERIVED[item.type] || [])];
    }
    const isReserved = (paths, path) =>
        paths.some(p => path === p || path.startsWith(`${p}.`));

    /**
     * 3-way 병합 결과를 만든다.
     * @returns {{data:object, baseline:object, hasBaseline:boolean, kept:string[], conflicts:string[]}}
     *   data      실제로 기록할 아이템 데이터(기준선 flag 포함)
     *   kept      컴펜디움이 바뀌지 않아 사용자 값을 지킨 경로
     *   conflicts 양쪽 다 바뀐 경로
     */
    function mergeReplacement(item, src, { preferCompendium = false } = {}) {
        const currentRaw = item.toObject();
        const baseline = decodeBaseline(currentRaw);
        const data = prepareReplacement(item, src);
        // 기준선은 병합 결과가 아니라 **컴펜디움 값**이어야 한다. 그래야 다음 갱신에서
        // 「사용자가 그 뒤에 손댔는가」를 판정할 수 있다.
        const theirs = leafMap(prepareReplacement(item, src, false));
        const result = {
            data,
            baseline: encodeBaseline(theirs),
            hasBaseline: Boolean(baseline),
            kept: [],
            conflicts: []
        };

        if (baseline) {
            const mine = leafMap(currentRaw);
            const reserved = reservedPaths(item);
            const paths = new Set([...mine.keys(), ...theirs.keys()]);
            for (const path of paths) {
                if (isReserved(reserved, path)) continue;
                const base = baseline.get(path);
                const mineHash = mine.has(path) ? hashValue(mine.get(path)) : undefined;
                const theirsHash = theirs.has(path) ? hashValue(theirs.get(path)) : undefined;
                if (mineHash === theirsHash) continue;          // 결과가 같다
                const applyMine = () => {
                    if (mine.has(path)) setPath(data, path, cloneData(mine.get(path)));
                    else deletePath(data, path);
                };
                if (theirsHash === base) {                      // 컴펜디움 무변화 → 사용자 편집 보존
                    applyMine();
                    result.kept.push(path);
                    continue;
                }
                if (mineHash === base) continue;                // 컴펜디움만 변경 → 최신 반영
                result.conflicts.push(path);
                if (!preferCompendium) applyMine();
            }
            result.kept.sort();
            result.conflicts.sort();
        }

        setPath(data, `flags.${SCOPE}.${BASELINE_FLAG}`, result.baseline);
        return result;
    }

    // 잎 경로 단위 변경 목록. 확인창·감사창이 그대로 그린다 —
    // 「시스템 데이터」 한 줄로는 제외할지 판단할 근거가 되지 못한다.
    function leafChanges(item, mergedData) {
        const before = leafMap(item.toObject());
        const after = leafMap(mergedData);
        const rows = [];
        for (const path of new Set([...before.keys(), ...after.keys()])) {
            const a = before.get(path);
            const b = after.get(path);
            if (stableStringify(a) === stableStringify(b)) continue;
            rows.push({ path, before: a, after: b });
        }
        rows.sort((x, y) => (x.path < y.path ? -1 : x.path > y.path ? 1 : 0));
        return rows;
    }

    function leafLabel(value) {
        if (value === undefined) return localize('DX3rd.CompendiumSyncLeafAbsent');
        const text = typeof value === 'string' ? value : stableStringify(value);
        const flat = text.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
        if (!flat) return localize('DX3rd.CompendiumSyncLeafEmpty');
        return flat.length > 70 ? `${flat.slice(0, 70)}…` : flat;
    }

    // 실제 교체가 필요한지 검사와 동일한 기준으로 판정한다. 보존 대상만 다른
    // 아이템은 교체해도 결과가 같으므로, 삭제·재생성 자체를 생략하는 편이 안전하다.
    function needsReplacement(item, src) {
        const current = comparableForMerge(item.toObject());
        const merged = comparableForMerge(mergeReplacement(item, src).data);
        return differingFields(current, merged).length > 0;
    }

    // 확인 창을 띄운 뒤의 외부 변경을 감지하기 위한 월드 아이템 지문이다.
    // 동기화 대상 필드만 포함해, 정렬·소유권 같은 문서 위치 메타데이터 변화에는
    // 불필요하게 중단되지 않는다.
    const itemFingerprint = (item) => stableStringify(comparableForMerge(item.toObject()));

    // ── 컴펜디움 인덱스 ────────────────────────────────────────────────────

    function getPackPreference() {
        const value = game.settings.get(SCOPE, PACK_PREFERENCE_SETTING);
        return value && typeof value === 'object' && !Array.isArray(value) ? cloneData(value) : {};
    }

    // 컴펜디움 인덱스: `${type}|${name}` → 컴펜디움 문서
    // nameTypes는 이름 하나가 몇 종류의 타입으로 존재하는지를 담는다. 별칭 매칭이
    // 동명이물을 집어오지 않도록 판정하는 데 쓴다.
    // 중복 키는 기본적으로 마지막(PACKS 순서상 뒤쪽) 문서가 이기지만, 사용자가 팩을
    // 지정했으면 그것이 우선한다.
    async function buildIndex() {
        const index = new Map();
        const nameTypes = new Map();
        const candidates = new Map();
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
                if (!candidates.has(key)) candidates.set(key, []);
                candidates.get(key).push(doc);
                if (!nameTypes.has(doc.name)) nameTypes.set(doc.name, new Set());
                nameTypes.get(doc.name).add(doc.type);
            }
        }
        const preference = getPackPreference();
        const duplicates = [];
        for (const [key, docs] of candidates) {
            const preferred = preference[key] ? docs.find(doc => packId(doc) === preference[key]) : null;
            const chosen = preferred || docs[docs.length - 1];
            index.set(key, chosen);
            if (docs.length > 1) duplicates.push({ key, docs, chosen, pinned: Boolean(preferred) });
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
    // [{actor, matches:[{item, fingerprint, changes, conflicts, kept, hasBaseline}, ...]}, ...]
    function scan(index, nameTypes) {
        const plan = [];
        for (const actor of game.actors) {
            const matches = [];
            for (const item of actor.items) {
                if (!isSyncEligible(item)) continue;
                const src = resolveSource(index, nameTypes, actor, item);
                if (!src) continue;
                const merge = mergeReplacement(item, src);
                const changes = leafChanges(item, merge.data);
                if (!changes.length) continue;
                matches.push({
                    item,
                    fingerprint: itemFingerprint(item),
                    changes,
                    conflicts: merge.conflicts,
                    kept: merge.kept,
                    hasBaseline: merge.hasBaseline,
                    preferCompendium: false
                });
            }
            if (matches.length) plan.push({ actor, matches });
        }
        return plan;
    }

    // 기준선이 없고 현재 값이 이미 컴펜디움과 같은 아이템. 삭제·재생성 없이 flag 만
    // 기록하면 되므로 정보 손실 위험이 없고, 이후의 갱신이 사용자 편집을 알아본다.
    function baselineAdoptions(index, nameTypes) {
        const rows = [];
        for (const actor of game.actors) {
            const updates = [];
            for (const item of actor.items) {
                if (!isSyncEligible(item)) continue;
                const src = resolveSource(index, nameTypes, actor, item);
                if (!src) continue;
                if (decodeBaseline(item.toObject())) continue;
                const merge = mergeReplacement(item, src);
                if (leafChanges(item, merge.data).length) continue;   // 갱신 대상은 apply 가 기록한다
                updates.push({ _id: item.id, [`flags.${SCOPE}.${BASELINE_FLAG}`]: merge.baseline });
            }
            if (updates.length) rows.push({ actor, updates });
        }
        return rows;
    }

    async function applyBaselines(rows) {
        let actors = 0;
        let items = 0;
        for (const { actor, updates } of rows) {
            try {
                await actor.updateEmbeddedDocuments('Item', updates, { render: false });
                actors++;
                items += updates.length;
            } catch (e) {
                console.error(`DX3rd | 기준선 기록 실패: ${actor.name} (${actor.id})`, e);
            }
        }
        return { actors, items };
    }

    // ── 제외 목록 ──────────────────────────────────────────────────────────

    // 데이터 갱신에서 제외할 액터 임베디드 아이템은 월드 설정에 보관한다.
    // 아이템 자체에 플래그를 쓰면 그 플래그 변경이 확인창 이후의 지문 검사를 깨뜨리고,
    // 컴펜디움 교체 시 플래그 보존이라는 별도 예외도 생기므로 외부 설정이 더 안전하다.
    const exclusionKey = (actorId, itemId) => `${actorId}:${itemId}`;

    function getExclusions() {
        const value = game.settings.get(SCOPE, EXCLUSION_SETTING);
        return value && typeof value === 'object' && !Array.isArray(value) ? cloneData(value) : {};
    }

    // 삭제된 액터·아이템의 키는 영원히 남아 설정을 부풀린다. 실행할 때마다 청소한다.
    function pruneExclusions(exclusions) {
        const kept = {};
        let removed = 0;
        for (const [key, value] of Object.entries(exclusions)) {
            const sep = key.indexOf(':');
            const actor = sep < 0 ? null : game.actors.get(key.slice(0, sep));
            if (actor && actor.items.get(key.slice(sep + 1))) kept[key] = value;
            else removed++;
        }
        return { exclusions: kept, removed };
    }

    async function pruneExclusionSetting() {
        const { exclusions, removed } = pruneExclusions(getExclusions());
        if (removed) {
            await game.settings.set(SCOPE, EXCLUSION_SETTING, exclusions);
            console.log(`DX3rd | 컴펜디움 동기화 제외 목록 정리: ${removed}건`);
        }
        return removed;
    }

    function filterPlan(plan, exclusions = {}) {
        return plan.map(({ actor, matches }) => ({
            actor,
            matches: matches.filter(({ item }) => !exclusions[exclusionKey(actor.id, item.id)])
        })).filter(({ matches }) => matches.length);
    }

    // ── 확인 다이얼로그 ────────────────────────────────────────────────────

    function renderLeafRows(changes) {
        return changes.map(change =>
            `<li><code>${esc(change.path)}</code><br>` +
            `<span style="opacity:.7">${esc(leafLabel(change.before))}</span>` +
            ` <b>→</b> ${esc(leafLabel(change.after))}</li>`
        ).join('');
    }

    function renderSelectablePlan(plan, exclusions) {
        return plan.map(({ actor, matches }) => {
            const items = matches.map(({ item, changes, conflicts, kept, hasBaseline }) => {
                const key = exclusionKey(actor.id, item.id);
                const checked = exclusions[key] ? ' checked' : '';
                const badges = [];
                if (!hasBaseline) {
                    badges.push(`<span style="font-size:.85em;padding:0 .4em;border:1px solid currentColor;border-radius:3px;opacity:.7">` +
                        `${localize('DX3rd.CompendiumSyncNoBaseline')}</span>`);
                }
                if (kept.length) {
                    badges.push(`<span style="font-size:.85em;padding:0 .4em;border:1px solid currentColor;border-radius:3px;opacity:.7">` +
                        `${format('DX3rd.CompendiumSyncKeptBadge', { kept: kept.length })}</span>`);
                }
                if (conflicts.length) {
                    badges.push(`<span style="font-size:.85em;padding:0 .4em;border:1px solid orange;border-radius:3px;color:orange">` +
                        `${format('DX3rd.CompendiumSyncConflictBadge', { conflicts: conflicts.length })}</span>`);
                }
                const conflictToggle = conflicts.length
                    ? `<label style="white-space:nowrap;font-size:.9em;opacity:.85">` +
                      `<input type="checkbox" data-compendium-sync-conflict value="${esc(key)}"> ` +
                      `${localize('DX3rd.CompendiumSyncPreferCompendium')}</label>`
                    : '';
                const conflictList = conflicts.length
                    ? `<p style="margin:.2em 0;color:orange;font-size:.85em">` +
                      `${esc(conflicts.join(', '))}</p>`
                    : '';
                return `<li data-sync-item data-sync-actor="${esc(actor.id)}" ` +
                    `data-sync-name="${esc(`${actor.name} ${item.name}`.toLowerCase())}" ` +
                    `style="margin:.15em 0">` +
                    `<div style="display:flex;gap:.5em;align-items:center;flex-wrap:wrap">` +
                    `<span style="flex:1;min-width:8em">${esc(item.name)} ` +
                    `<small style="opacity:.7">${format('DX3rd.CompendiumSyncChangeCount', { changes: changes.length })}</small></span>` +
                    badges.join(' ') + conflictToggle +
                    `<label style="white-space:nowrap"><input type="checkbox" ` +
                    `data-compendium-sync-exclusion value="${esc(key)}"${checked}> ` +
                    `${localize('DX3rd.CompendiumSyncExcludeLabel')}</label></div>` +
                    conflictList +
                    `<details><summary style="cursor:pointer;font-size:.85em;opacity:.75">` +
                    `${localize('DX3rd.CompendiumSyncShowDiff')}</summary>` +
                    `<ul style="margin:.25em 0 .5em;font-size:.85em;line-height:1.5">${renderLeafRows(changes)}</ul>` +
                    `</details></li>`;
            }).join('');
            return `<li data-sync-actor-row="${esc(actor.id)}" style="margin-bottom:.5em">` +
                `<div style="display:flex;gap:.5em;align-items:center">` +
                `<b style="flex:1">${esc(actor.name)}</b>` +
                `<label style="white-space:nowrap;font-size:.9em;opacity:.85">` +
                `<input type="checkbox" data-compendium-sync-actor="${esc(actor.id)}"> ` +
                `${localize('DX3rd.CompendiumSyncExcludeActor')}</label></div>` +
                `<ul style="margin:.25em 0 .6em">${items}</ul></li>`;
        }).join('');
    }

    function renderDuplicateChooser(duplicates) {
        if (!duplicates.length) return '';
        const rows = duplicates.map(({ key, docs, chosen }) => {
            const options = docs.map(doc =>
                `<option value="${esc(packId(doc))}"${doc === chosen ? ' selected' : ''}>${esc(packLabel(doc))}</option>`
            ).join('');
            return `<li style="display:flex;gap:.5em;align-items:center;margin:.15em 0">` +
                `<code style="flex:1">${esc(key)}</code>` +
                `<select data-compendium-sync-pack data-key="${esc(key)}">${options}</select></li>`;
        }).join('');
        return `<details><summary style="color:orange">` +
            `${format('DX3rd.CompendiumAuditDuplicates', { dupes: duplicates.length })}</summary>` +
            `<p style="opacity:.75;font-size:.9em">${localize('DX3rd.CompendiumSyncDuplicateHint')}</p>` +
            `<ul style="max-height:160px;overflow:auto;margin:.5em 0">${rows}</ul></details>`;
    }

    const SELECTION_TOOLBAR =
        `<div style="display:flex;gap:.5em;align-items:center;margin:.4em 0">` +
        `<input type="search" data-compendium-sync-filter style="flex:1" ` +
        `placeholder="DX3rd.CompendiumSyncFilterPlaceholder">` +
        `<button type="button" data-compendium-sync-all="exclude">DX3rd.CompendiumSyncExcludeAll</button>` +
        `<button type="button" data-compendium-sync-all="include">DX3rd.CompendiumSyncIncludeAll</button>` +
        `</div>`;

    // 선택 UI 배선. 액터가 수십 개면 체크박스만으로는 다룰 수 없다.
    function wireSelection(root) {
        if (!root) return;
        const itemRows = Array.from(root.querySelectorAll('[data-sync-item]'));
        const actorRows = Array.from(root.querySelectorAll('[data-sync-actor-row]'));
        const boxesOf = (row) => Array.from(row.querySelectorAll('input[data-compendium-sync-exclusion]'));

        const filter = root.querySelector('input[data-compendium-sync-filter]');
        if (filter) {
            filter.addEventListener('input', () => {
                const query = filter.value.trim().toLowerCase();
                for (const row of itemRows) {
                    const match = !query || (row.dataset.syncName || '').includes(query);
                    row.style.display = match ? '' : 'none';
                }
                for (const row of actorRows) {
                    const visible = Array.from(row.querySelectorAll('[data-sync-item]'))
                        .some(item => item.style.display !== 'none');
                    row.style.display = visible ? '' : 'none';
                }
            });
        }

        for (const button of root.querySelectorAll('button[data-compendium-sync-all]')) {
            button.addEventListener('click', (event) => {
                event.preventDefault();
                const exclude = button.dataset.compendiumSyncAll === 'exclude';
                // 검색으로 걸러진 것만 대상으로 한다 — 보이지 않는 항목을 말없이
                // 바꾸면 「전체」의 의미가 사용자가 보는 화면과 어긋난다.
                for (const row of itemRows) {
                    if (row.style.display === 'none') continue;
                    for (const box of boxesOf(row)) box.checked = exclude;
                }
            });
        }

        for (const toggle of root.querySelectorAll('input[data-compendium-sync-actor]')) {
            toggle.addEventListener('change', () => {
                const row = toggle.closest('[data-sync-actor-row]');
                if (!row) return;
                for (const item of row.querySelectorAll('[data-sync-item]')) {
                    if (item.style.display === 'none') continue;
                    for (const box of boxesOf(item)) box.checked = toggle.checked;
                }
            });
        }
    }

    async function saveExclusionSelection(plan, root, duplicates) {
        // 팩 선택이 바뀌면 계획 자체가 달라진다. 여기서 적용하지 않고 다시 검사한다.
        let rescan = false;
        if (duplicates?.length) {
            const preference = getPackPreference();
            for (const select of root.querySelectorAll('select[data-compendium-sync-pack]')) {
                const key = select.dataset.key;
                const entry = duplicates.find(dupe => dupe.key === key);
                if (!entry) continue;
                const value = select.value;
                if (packId(entry.chosen) === value) {
                    if (preference[key] !== undefined && preference[key] !== value) {
                        delete preference[key];
                        rescan = true;
                    }
                    continue;
                }
                preference[key] = value;
                rescan = true;
            }
            if (rescan) await game.settings.set(SCOPE, PACK_PREFERENCE_SETTING, preference);
        }

        const selected = new Set(Array.from(
            root.querySelectorAll('input[data-compendium-sync-exclusion]:checked'),
            input => input.value
        ));
        const preferCompendium = new Set(Array.from(
            root.querySelectorAll('input[data-compendium-sync-conflict]:checked'),
            input => input.value
        ));
        const exclusions = getExclusions();
        for (const { actor, matches } of plan) {
            for (const match of matches) {
                const key = exclusionKey(actor.id, match.item.id);
                if (selected.has(key)) exclusions[key] = true;
                else delete exclusions[key];
                match.preferCompendium = preferCompendium.has(key);
            }
        }
        await game.settings.set(SCOPE, EXCLUSION_SETTING, exclusions);
        return { plan: filterPlan(plan, exclusions), rescan };
    }

    async function confirmSyncSelection({ title, plan, duplicates = [], contentBefore = '', contentAfter = '' }) {
        const exclusions = getExclusions();
        const rows = renderSelectablePlan(plan, exclusions);
        const toolbar = SELECTION_TOOLBAR
            .replace('DX3rd.CompendiumSyncFilterPlaceholder', esc(localize('DX3rd.CompendiumSyncFilterPlaceholder')))
            .replace('DX3rd.CompendiumSyncExcludeAll', localize('DX3rd.CompendiumSyncExcludeAll'))
            .replace('DX3rd.CompendiumSyncIncludeAll', localize('DX3rd.CompendiumSyncIncludeAll'));
        return foundry.applications.api.DialogV2.wait({
            window: { title },
            position: { width: 760, height: 'auto' },
            classes: ['dx3rd-emanim', 'dialog', 'compendium-sync-dialog'],
            content:
                contentBefore +
                renderDuplicateChooser(duplicates) +
                (rows
                    ? `<p style="opacity:.75;font-size:.9em">${localize('DX3rd.CompendiumSyncExcludeHint')}</p>` +
                      toolbar +
                      `<ul style="max-height:340px;overflow:auto;margin:.5em 0">${rows}</ul>`
                    : '') +
                contentAfter,
            modal: true,
            rejectClose: false,
            render: (_event, dialog) => wireSelection(dialog.element),
            buttons: [
                {
                    action: 'confirm',
                    icon: 'fas fa-cloud-download-alt',
                    label: localize('DX3rd.CompendiumSyncRun'),
                    default: true,
                    callback: async (event, button, dialog) =>
                        saveExclusionSelection(plan, dialog.element, duplicates)
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

    // ── 감사 ───────────────────────────────────────────────────────────────

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
            conflicts: 0,
            kept: 0,
            noBaseline: 0,
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
                const merge = mergeReplacement(item, src);
                if (!merge.hasBaseline) result.noBaseline++;
                result.conflicts += merge.conflicts.length;
                result.kept += merge.kept.length;
                const leaves = leafChanges(item, merge.data);
                const rawReplacement = comparableForMerge(prepareReplacement(item, src, false));
                if (leaves.length) {
                    result.changed++;
                    changes.push({
                        name: item.name,
                        leaves,
                        conflicts: merge.conflicts,
                        kept: merge.kept,
                        hasBaseline: merge.hasBaseline
                    });
                } else if (differingFields(comparableForMerge(item.toObject()), rawReplacement).length) {
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

    // ── 적용 ───────────────────────────────────────────────────────────────

    // 실제 적용: 액터별로 삭제 후 재생성(keepId).
    async function apply(index, nameTypes, plan) {
        let actorsChanged = 0, itemsChanged = 0, failed = 0, recovered = 0, recoveryFailed = 0, stale = 0;
        let kept = 0, conflicts = 0;
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
                // 충돌 처리는 확인창의 선택을 그대로 따른다. 계획 시점의 데이터를
                // 재사용하지 않고 다시 병합하는 이유가 이것이다.
                const merge = mergeReplacement(item, src, { preferCompendium: planned.preferCompendium });
                kept += merge.kept.length;
                conflicts += merge.conflicts.length;
                deleteIds.push(item.id);
                createData.push(merge.data);
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
        return { actorsChanged, itemsChanged, failed, recovered, recoveryFailed, stale, kept, conflicts };
    }

    // ── 진입점 ─────────────────────────────────────────────────────────────

    async function openAudit() {
        if (!game.user.isGM) {
            ui.notifications.warn(localize('DX3rd.CompendiumSyncGMOnly'));
            return;
        }
        ui.notifications.info(localize('DX3rd.CompendiumSyncScanning'));
        await pruneExclusionSetting();
        const { index, nameTypes, duplicates, missingPacks } = await buildIndex();
        const result = audit(index, nameTypes);
        const runtime = runtimeAudit();
        const rows = result.rows.map(row => {
            const changes = row.changes.map(change => {
                const badges = [
                    change.hasBaseline ? '' : ` <small style="opacity:.7">[${localize('DX3rd.CompendiumSyncNoBaseline')}]</small>`,
                    change.kept.length ? ` <small style="opacity:.7">[${format('DX3rd.CompendiumSyncKeptBadge', { kept: change.kept.length })}]</small>` : '',
                    change.conflicts.length ? ` <small style="color:orange">[${format('DX3rd.CompendiumSyncConflictBadge', { conflicts: change.conflicts.length })}]</small>` : ''
                ].join('');
                return `<li><b>${esc(change.name)}</b>${badges}` +
                    `<ul style="font-size:.85em;line-height:1.5;margin:.15em 0 .4em">${renderLeafRows(change.leaves)}</ul></li>`;
            }).join('');
            return `<li><b>${esc(row.actor.name)}</b><ul style="margin:.25em 0 .6em">${changes}</ul></li>`;
        }).join('');
        const unmatchedRows = result.unmatchedRows.map(row =>
            `<li><b>${esc(row.actor.name)}</b> — ${row.unmatched.map(item =>
                `${esc(item.name)} <small>(${esc(item.type)})</small>`).join(', ')}</li>`
        ).join('');
        const duplicateRows = duplicates.map(({ key, docs, chosen }) =>
            `<li><code>${esc(key)}</code> — ${docs.map(doc =>
                doc === chosen ? `<b>${esc(packLabel(doc))}</b>` : esc(packLabel(doc))).join(', ')}</li>`
        ).join('');
        const content =
            `<p>${format('DX3rd.CompendiumAuditSummary', result)}</p>` +
            `<p>${format('DX3rd.CompendiumAuditMergeSummary', result)}</p>` +
            `<p style="opacity:.75;font-size:.9em">${localize('DX3rd.CompendiumAuditReadOnly')}</p>` +
            (missingPacks.length ? `<p style="color:orange">${format('DX3rd.CompendiumAuditMissingPacks', { packs: missingPacks.map(esc).join(', ') })}</p>` : '') +
            (duplicates.length ? `<details><summary style="color:orange">${format('DX3rd.CompendiumAuditDuplicates', { dupes: duplicates.length })}</summary><ul style="max-height:160px;overflow:auto;margin:.5em 0">${duplicateRows}</ul></details>` : '') +
            (rows ? `<details open><summary>${localize('DX3rd.CompendiumAuditChanges')}</summary><ul style="max-height:320px;overflow:auto;margin:.5em 0">${rows}</ul></details>` : '') +
            (unmatchedRows ? `<details><summary>${format('DX3rd.CompendiumAuditUnmatched', { unmatched: result.unmatched })}</summary><ul style="max-height:180px;overflow:auto;margin:.5em 0">${unmatchedRows}</ul></details>` : '') +
            runtimeAuditContent(runtime);
        await foundry.applications.api.DialogV2.wait({
            window: { title: localize('DX3rd.CompendiumAuditTitle') },
            position: { width: 760, height: 'auto' },
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
            ui.notifications.warn(localize('DX3rd.CompendiumSyncGMOnly'));
            return;
        }
        ui.notifications.info(localize('DX3rd.CompendiumSyncScanning'));
        await pruneExclusionSetting();

        const { index, nameTypes, duplicates } = await buildIndex();
        const plan = scan(index, nameTypes);
        const totalItems = plan.reduce((n, p) => n + p.matches.length, 0);
        if (!totalItems) {
            ui.notifications.info(localize('DX3rd.CompendiumSyncNone'));
            return;
        }

        const contentBefore =
            `<p>${format('DX3rd.FullSyncSummary', { actors: plan.length, items: totalItems })}</p>` +
            `<p style="opacity:.75;font-size:.9em">${localize('DX3rd.CompendiumSyncPreserveHint')}</p>`;
        const selection = await confirmSyncSelection({
            title: localize('DX3rd.CompendiumSyncTitle'),
            plan,
            duplicates,
            contentBefore
        });
        if (!selection) return;
        if (selection.rescan) {
            ui.notifications.info(localize('DX3rd.CompendiumSyncRescan'));
            return openItemSync();
        }
        const selectedPlan = selection.plan;
        const selectedItems = selectedPlan.reduce((n, p) => n + p.matches.length, 0);
        if (!selectedItems) {
            ui.notifications.info(localize('DX3rd.CompendiumSyncExcludedAll'));
            return;
        }

        const res = await apply(index, nameTypes, selectedPlan);
        await applyBaselines(baselineAdoptions(index, nameTypes));
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
        await pruneExclusionSetting();
        const { index, nameTypes, duplicates } = await buildIndex();
        const plan = scan(index, nameTypes);
        const adoptions = baselineAdoptions(index, nameTypes);
        const adoptionItems = adoptions.reduce((n, row) => n + row.updates.length, 0);
        const runtime = runtimeAudit();
        const totalItems = plan.reduce((n, p) => n + p.matches.length, 0);
        if (!totalItems && !adoptionItems && !runtimeHasWork(runtime)) {
            ui.notifications.info(localize('DX3rd.FullSyncNone'));
            return;
        }
        const conflicts = plan.reduce((n, p) =>
            n + p.matches.reduce((m, match) => m + match.conflicts.length, 0), 0);
        const contentBefore =
            `<p>${format('DX3rd.FullSyncSummary', { actors: plan.length, items: totalItems })}</p>` +
            (conflicts ? `<p style="color:orange">${format('DX3rd.CompendiumSyncConflictSummary', { conflicts })}</p>` : '') +
            (adoptionItems ? `<p style="opacity:.75;font-size:.9em">${format('DX3rd.CompendiumSyncBaselineAdoption', { items: adoptionItems })}</p>` : '') +
            `<p style="opacity:.75;font-size:.9em">${localize('DX3rd.FullSyncHint')}</p>`;
        const selection = await confirmSyncSelection({
            title: localize('DX3rd.CompendiumSyncHubTitle'),
            plan,
            duplicates,
            contentBefore,
            contentAfter: runtimeAuditContent(runtime)
        });
        if (!selection) return;
        if (selection.rescan) {
            ui.notifications.info(localize('DX3rd.CompendiumSyncRescan'));
            return open();
        }
        const selectedPlan = selection.plan;
        const selectedItems = selectedPlan.reduce((n, p) => n + p.matches.length, 0);
        if (!selectedItems && !adoptionItems && !runtimeHasWork(runtime)) {
            ui.notifications.info(localize('DX3rd.CompendiumSyncExcludedAll'));
            return;
        }
        const compendium = selectedItems
            ? await apply(index, nameTypes, selectedPlan)
            : { actorsChanged: 0, itemsChanged: 0, failed: 0, kept: 0, conflicts: 0 };
        // 갱신하지 않은(=이미 컴펜디움과 같은) 아이템의 기준선도 이때 채운다.
        // 계획 이후 상태가 바뀌었을 수 있으므로 다시 수집한다.
        const baselines = await applyBaselines(baselineAdoptions(index, nameTypes));
        const repaired = await repairRuntime();
        ui.notifications.info(format('DX3rd.FullSyncComplete', {
            actors: compendium.actorsChanged,
            items: compendium.itemsChanged,
            kept: compendium.kept,
            baselines: baselines.items,
            aeActors: repaired.applied.changed,
            instantCombos: repaired.instantCombo.items,
            conditionEffects: repaired.conditionOverlay.effects
        }));
        console.log('DX3rd | 컴펜디움 동기화 결과', { compendium, baselines, repaired });
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
        game.settings.register(SCOPE, PACK_PREFERENCE_SETTING, {
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
        isSyncEligible, prepareReplacement, needsReplacement, exclusionKey, filterPlan,
        // 3-way 병합·기준선(테스트와 콘솔 점검용)
        mergeReplacement, leafChanges, encodeBaseline, decodeBaseline, hashValue,
        leafMap, baselineAdoptions, applyBaselines, pruneExclusions
    };
})();
