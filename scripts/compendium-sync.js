// Compendium sync
// ---------------------------------------------------------------------------
// When an embedded item owned by a world actor has a (type|name) match in a system compendium, it is updated
// from that compendium data. The point is to bring the mechanization (system.attributes/effect/
// flags.itemExtend/macros) and the embedded ActiveEffects up to date along with it.
//
// Method: delete the embedded item and recreate it from the merge result (_id preserved → references survive).
//   Being a full replacement, no dead field is left behind and the embedded AEs come along.
//
// **The 3-way merge** — the core invariant of this file.
//   Deciding what to update from "current value ≠ compendium value" alone silently reverts values edited on the
//   actor. Everything outside the PRESERVE whitelist was lost, so one sync wiped out all hand tuning.
//   The pack side already has the answer to the same problem —
//   `tools/recover-pack-edits.mjs` takes *what the last build put into the pack* as its baseline and decides hand
//   tuning from `live ≠ prev` alone. The world sync uses the same structure:
//
//     baseline (base) = the **compendium** value at the last sync. Stored on the item flag as a per-leaf-path
//                       hash (`flags.dx3rd-emanim.syncBaseline`).
//     mine            = the value the actor holds now
//     theirs          = the compendium value now
//
//     theirs = base            → the compendium did not change. A differing mine is **a user edit, so it is kept**
//     mine = base ≠ theirs     → only the compendium changed → **take the update**
//     mine ≠ base ≠ theirs     → **conflict**. Keeping mine by default; the compendium can be chosen per item
//
//   The baseline is a per-leaf-path hash rather than a full copy of the data because of size. All the decision needs
//   is "is it the same as base", and the values themselves can be shown from mine/theirs.
//   An item with no baseline (created before this feature) is fully replaced as before, but shown in the confirmation
//   dialog as "no baseline" so the user decides knowingly. An item whose current value already equals the compendium
//   can adopt a baseline with no loss of information, so only the flag is written, with no delete and recreate
//   (`baselineAdoptions`).
//
//   Instance state (PRESERVE) and derived values (TYPE_DERIVED) are excluded from the merge —
//   the former is always mine by rule, and the latter is recomputed from the preserved and the compendium values.
//
// GM-only manual execution (a button in the settings menu). Re-runnable at any time, independent of the migration version.
// ---------------------------------------------------------------------------

(function() {
    const SCOPE = 'dx3rd-emanim';
    const EXCLUSION_SETTING = 'compendiumSyncExclusions';
    const PACK_PREFERENCE_SETTING = 'compendiumSyncPackPreference';
    // The baseline flag. Bumping the version makes an old baseline ignored and falls back to a full replacement.
    const BASELINE_FLAG = 'syncBaseline';
    const BASELINE_VERSION = 1;
    // The Item-type compendium packs (in the same order as system.json packs)
    const PACKS = ['effects', 'weapons', 'armors', 'vehicles', 'items', 'dlois', 'works', 'syndromes'];

    // Per-instance state (values the user or the runtime manipulated). Restored after the replacement.
    const PRESERVE = [
        'system.active.state',        // the toggle buff on/off
        'system.used.state',          // the spent use count
        'system.attack-used.state',   // the spent weapon attack count (absent on non-weapon types, so ignored automatically)
        'system.equipment',           // equipped or not (weapon/protect/vehicle)
        'system.saving.acquisition'   // the actor's copy's acquisition method (stock / purchased)
    ];

    // The acquired level of an effect / psionic is instance data the player grew.
    // Rule metadata such as max / upgrade is not preserved, so the compendium's latest value is taken.
    // The quantity of a consumable / misc item is an instance value the player bought and spent, so it is preserved.
    const TYPE_PRESERVE = {
        effect: ['system.level.init'],
        psionic: ['system.level.init'],
        once: ['system.quantity'],
        etc: ['system.quantity']
    };

    // Derived values. prepareReplacement recomputes them from the preserved init and the compendium's upgrade,
    // so the merge must not revive the old value.
    const TYPE_DERIVED = {
        effect: ['system.level.value'],
        psionic: ['system.level.value']
    };

    // When an item is reclassified in the compendium, the exact `type|name` match breaks and that copy stays stale
    // however many times it is synced (e.g. a first-aid kit moving from etc to once).
    // once and etc are both consumable / misc items with compatible schemas, so they alias each other.
    // Do NOT widen this list: matching a combination that shares only a name while being a different thing —
    // weapon/effect, a weapon created by an effect, a combo the player built — would overwrite a perfectly good instance.
    const TYPE_ALIASES = {
        once: ['etc'],
        etc: ['once']
    };

    // A D/E Lois is an official-data update target, but an ordinary Lois is player relationship data,
    // so it is not overwritten even when its name happens to match a compendium entry.
    // A fist is a default weapon customized per actor often, so it is never reverted to the compendium original.
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

    // The data the sync will create. The check and the actual application judge from identical data,
    // so the check result and the applied result cannot disagree.
    function prepareReplacement(item, src, preserveState = true) {
        // The object a toObject() implementation returned is NEVER modified directly. This matters especially
        // in the check, where the same original is compared several times.
        const data = cloneData(src.toObject());
        // preCreateItem normalizes a once stored with the generic bag icon to the pill icon when it is created on
        // an actor. If the comparison side expected the compendium's bag icon as-is, the image difference would
        // catch it again forever, right after a successful update.
        if (data.type === 'once' && (!data.img || data.img === 'icons/svg/item-bag.svg')) {
            data.img = 'icons/svg/pill.svg';
        }
        data._id = item.id;              // preserve the embedded id (keeping combo / syndrome references)
        data.sort = item.sort;           // preserve the sheet ordering position
        delete data.ownership;           // an embedded item follows the actor's ownership, so the compendium's is dropped
        delete data.folder;              // a folder is meaningless for an embedded item

        if (preserveState) {
            const oldObj = item.toObject();
            const preservePaths = [...PRESERVE, ...(TYPE_PRESERVE[item.type] || [])];
            for (const p of preservePaths) {
                const v = getPath(oldObj, p);
                if (v !== undefined) setPath(data, p, v);
            }

            // value is not the stored original but a derived value: the current acquired level plus the encroachment correction.
            // It is re-aligned from the preserved init and the upgrade taken from the compendium.
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

    // Only the fields sync actually means anything for are compared. Document location metadata such as
    // _id/sort/ownership/folder is excluded so the check result matches the real need for an update.
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

    // The baseline flag itself is not a comparison target. Including it would make writing the baseline alone count as
    // "needs update", so a delete and recreate would run every time and the fingerprint check would be meaningless.
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
        // JSON.stringify returns undefined — not a string — for undefined (and functions and symbols).
        // Emitting that as-is blows up hashValue's str.length — comparable() makes name/type/img keys unconditionally,
        // so a single compendium document with no img produces an undefined leaf.
        // Being an unquoted token, it cannot collide with the real string "undefined" ( → "\"undefined\"" ).
        if (value === undefined) return 'undefined';
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

    // ── The baseline ───────────────────────────────────────────────────────

    // A per-leaf-path hash. Two 32-bit halves are concatenated, making a collision practically impossible.
    // Even on a collision the result is only "that one leaf is judged as before", so no data breaks.
    function hashValue(value) {
        const str = stableStringify(value) ?? 'undefined';   // guard against unserializable values (functions, symbols)
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

    // A leaf = a primitive, an array, or an empty object. Treating an array as one whole leaf is deliberate —
    // with a modifier-row or AE array, one shifted index would bury the per-leaf comparison in noise.
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
        // The paths contain dots, so putting them in as object keys would trip Foundry's expandObject.
        // A string with one per line has no such risk and is smaller too.
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

    // A field the schema gained **after** this baseline was written has no entry in the baseline at all.
    // The DataModel materializes it with its initial value the moment the item loads, so "mine differs from
    // base" is not a user edit there — mine is simply the default nobody has touched. Without this, every new
    // declaration field (system.rollModifier, system.rollIntervention, bypassDefense…) arrives as a conflict
    // and is kept at its default, while the rows the compendium removed in the same migration still go away:
    // the approximation is deleted and the replacement never lands, so the item ends up doing nothing.
    const defaultLeafCache = new Map();
    function schemaDefaultLeaves(type) {
        if (defaultLeafCache.has(type)) return defaultLeafCache.get(type);
        let leaves = new Map();
        const model = globalThis.CONFIG?.Item?.dataModels?.[type];
        try {
            if (model?.cleanData) leaves = collectLeaves({ system: model.cleanData({}) }, '', new Map());
        } catch (err) {
            console.warn(`DX3rd | 스키마 기본값을 읽지 못했다 (${type}):`, err);
        }
        defaultLeafCache.set(type, leaves);
        return leaves;
    }

    // Only for a path the baseline never knew. A path the baseline *does* carry was compared against a real
    // recorded value, and a value that merely happens to equal the default there is still a user edit
    // (they cleared the field the compendium had filled).
    function untouchedNewField(type, path, mine, mineHash) {
        if (!mine.has(path)) return false;
        const defaults = schemaDefaultLeaves(type);
        if (!defaults.has(path)) return false;
        return hashValue(defaults.get(path)) === mineHash;
    }

    // The paths the merge never touches (instance state + derived values).
    function reservedPaths(item) {
        return [...PRESERVE, ...(TYPE_PRESERVE[item.type] || []), ...(TYPE_DERIVED[item.type] || [])];
    }
    const isReserved = (paths, path) =>
        paths.some(p => path === p || path.startsWith(`${p}.`));

    /**
     * Build the 3-way merge result.
     * @returns {{data:object, baseline:object, hasBaseline:boolean, kept:string[], conflicts:string[]}}
     *   data      the item data actually written (the baseline flag included)
     *   kept      the paths where the user's value was kept because the compendium did not change
     *   conflicts the paths where both sides changed
     */
    function mergeReplacement(item, src, { preferCompendium = false } = {}) {
        const currentRaw = item.toObject();
        const baseline = decodeBaseline(currentRaw);
        const data = prepareReplacement(item, src);
        // The baseline must be the **compendium value**, not the merge result. Only then can the next sync decide
        // "did the user touch it afterwards".
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
                if (mineHash === theirsHash) continue;          // the results are the same
                const applyMine = () => {
                    if (mine.has(path)) setPath(data, path, cloneData(mine.get(path)));
                    else deletePath(data, path);
                };
                if (theirsHash === base) {                      // the compendium did not change → keep the user edit
                    applyMine();
                    result.kept.push(path);
                    continue;
                }
                if (mineHash === base) continue;                // only the compendium changed → take the update
                // 기준선이 모르는 경로 + 내 값이 스키마 기본값 = 저작한 적이 없다 → 최신을 받는다.
                if (!baseline.has(path) && untouchedNewField(item.type, path, mine, mineHash)) continue;
                result.conflicts.push(path);
                if (!preferCompendium) applyMine();
            }
            result.kept.sort();
            result.conflicts.sort();
        }

        setPath(data, `flags.${SCOPE}.${BASELINE_FLAG}`, result.baseline);
        return result;
    }

    // The per-leaf-path change list. The confirmation and audit dialogs draw it as-is —
    // a single "system data" line is no basis for deciding whether to exclude something.
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

    // Whether a replacement is really needed is decided by the same test as the check. An item differing only in
    // preserved values gives the same result either way, so skipping the delete and recreate entirely is safer.
    function needsReplacement(item, src) {
        const current = comparableForMerge(item.toObject());
        const merged = comparableForMerge(mergeReplacement(item, src).data);
        return differingFields(current, merged).length > 0;
    }

    // A fingerprint of the world item, used to detect an external change after the confirmation dialog opened.
    // Only the sync target fields are included, so a change in document location metadata such as sort or ownership
    // does not abort it needlessly.
    const itemFingerprint = (item) => stableStringify(comparableForMerge(item.toObject()));

    // ── The compendium index ───────────────────────────────────────────────

    function getPackPreference() {
        const value = game.settings.get(SCOPE, PACK_PREFERENCE_SETTING);
        return value && typeof value === 'object' && !Array.isArray(value) ? cloneData(value) : {};
    }

    // The compendium index: `${type}|${name}` → the compendium document.
    // nameTypes records how many types one name exists as. It is used to keep an alias match
    // from grabbing a different thing with the same name.
    // A duplicate key is normally won by the last document (later in PACKS order), but a pack the user
    // specified takes precedence.
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

    // Find the compendium document matching an embedded item. An exact match comes first, and only on failure
    // is a reclassification followed through TYPE_ALIASES. An alias applies only when all of the following hold,
    // so a separate document that happens to share a name is never overwritten.
    //   - that name exists as exactly one type in the compendium (excluding same-name-different-thing)
    //   - the same actor does not already own a copy of the alias type (excluding a duplicate replacement)
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

    // The dry scan: collect the plan of what would actually be updated. Entries that are identical, or differ only in preserved state, are excluded.
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

    // Items with no baseline whose current value already equals the compendium. Writing just the flag, with no delete
    // and recreate, carries no risk of information loss, and later syncs then recognize the user's edits.
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
                if (leafChanges(item, merge.data).length) continue;   // an update target is recorded by apply
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

    // ── The exclusion list ─────────────────────────────────────────────────

    // The actor-embedded items to exclude from the data update are kept in a world setting.
    // Writing a flag on the item itself would have that flag change break the post-confirmation fingerprint check,
    // and add another exception for preserving the flag across a compendium replacement, so an external setting is safer.
    const exclusionKey = (actorId, itemId) => `${actorId}:${itemId}`;

    function getExclusions() {
        const value = game.settings.get(SCOPE, EXCLUSION_SETTING);
        return value && typeof value === 'object' && !Array.isArray(value) ? cloneData(value) : {};
    }

    // Keys of deleted actors and items would linger forever and bloat the setting. They are cleaned on every run.
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

    // ── The confirmation dialog ────────────────────────────────────────────

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

    // The selection UI wiring. With dozens of actors, checkboxes alone are unmanageable.
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
                // Only what the search left visible is targeted — silently changing an item that is not on screen
                // would make "all" mean something other than what the user sees.
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
        // Changing the pack selection changes the plan itself. It is not applied here; the check is re-run.
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
                    // It must NOT return null — DialogV2 fills a nullish callback result with the button's action
                    // string ("cancel"), so a cancel would leak through as truthy.
                    // (the `?? button?.action` in foundry's client/applications/api/dialog.mjs)
                    callback: () => false
                }
            ]
        });
    }

    // ── The audit ──────────────────────────────────────────────────────────

    // A read-only audit. It compares the current item with the final data the real sync would use.
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

    // The read-only inspection result for the repair entries never applied automatically at startup.
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

    // ── Apply ──────────────────────────────────────────────────────────────

    // The real application: delete and recreate per actor (keepId).
    async function apply(index, nameTypes, plan) {
        let actorsChanged = 0, itemsChanged = 0, failed = 0, recovered = 0, recoveryFailed = 0, stale = 0;
        let kept = 0, conflicts = 0;
        for (const { actor, matches } of plan) {
            const createData = [];
            const deleteIds = [];
            const originalData = [];
            for (const planned of matches) {
                // A document changed since the plan is not deleted and recreated. The next check can judge it afresh
                // from its new state, so it is skipped conservatively.
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
                // Conflict handling follows the confirmation dialog's choice exactly. That is why the merge is redone
                // rather than the plan-time data being reused.
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
                    // A partial creation can occupy the original id too, so a leftover document with the same id is
                    // deleted before restoring from the pre-delete snapshot.
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

    // ── The entry points ───────────────────────────────────────────────────

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

    // Scan → confirmation dialog → apply → report the result
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
        // Cancel and close return no plan. The test must be "is there a plan" rather than "is it falsy",
        // so the action string DialogV2 lets through cannot trip it.
        if (!selection?.plan) return;
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

    // The sync button's single execution path: check every automatic repair candidate, then apply only after the GM confirms.
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
        // Cancel and close return no plan. The test must be "is there a plan" rather than "is it falsy",
        // so the action string DialogV2 lets through cannot trip it.
        if (!selection?.plan) return;
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
        // The baselines of the items not updated (= already equal to the compendium) are filled in at this point too.
        // Their state may have changed since the plan, so they are collected again.
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

    // The Applied ActiveEffects of toggle-type effects are not created wholesale at startup.
    // Only this menu checks → confirms → repairs the entries that need it.
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

    // The entry point kept for the older selection-style UI. The settings menu uses the batch open() sync below.
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

    // Register the settings menu button. The type class only raises the confirmation flow on render; no window opens.
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
        // The 3-way merge and baseline (for the tests and console inspection)
        mergeReplacement, leafChanges, encodeBaseline, decodeBaseline, hashValue,
        leafMap, baselineAdoptions, applyBaselines, pruneExclusions
    };
})();
