#!/usr/bin/env node
// Foundry 안에서 팩을 손으로 고친 내용을 `_source/*-mech-overrides.json` 으로 회수한다.
//
// 왜 필요한가: `tools/release.ps1 -UpdatePacks` 는 선언된 팩 디렉터리를 CSV 파이프라인의
// 재빌드 결과로 **통째로 교체**한다. 회수되지 않은 손튜닝은 그 순간 사라진다
// (2026-07-31 실제 사고: 아이콘 38건 + 기계화 1건).
//
// **커밋은 더 이상 재빌드하지 않는다** — `packs/` 가 컴펜디움 내용의 원본이고, Foundry 에서
// 고친 것은 그대로 커밋된다. 그래서 이 스크립트는 커밋 훅이 아니라 `release.ps1` 이
// 생성기보다 먼저 부른다. 즉 평소에는 돌 일이 없고, 대량 재구성을 할 때만 관여한다.
// 손으로 확인하고 싶을 때만 아래처럼 직접 실행한다.
//
// 사용:
//   node tools/recover-pack-edits.mjs --all [--write]
//   node tools/recover-pack-edits.mjs --name weapons [--pack <LevelDB 경로>] [--write]
//   node tools/recover-pack-edits.mjs --audit    # 빌드에 반영되지 않는 오버라이드 점검
//   node tools/recover-pack-edits.mjs --stamp    # 기준선 스탬프 기록(release.ps1 이 부른다)
//   node tools/recover-pack-edits.mjs --all --write   # release.ps1 이 재빌드 직전에 부른다
//
// --write 없이는 무엇이 회수될지만 출력한다(dry-run).
//
// ── 기준선(baseline)이 이 도구의 핵심이다 ────────────────────────────────────────
// 세 가지 값을 구분해야 오작동하지 않는다:
//   prev  = 지난 빌드가 팩에 넣은 값  (= `_source/<빌드산출>` 에 지금 남아 있는 JSON)
//   live  = 지금 팩에 들어 있는 값    (= Foundry 가 고친 뒤의 상태)
//   next  = 지금 _source 로 다시 빌드하면 나올 값
// **손튜닝은 `live ≠ prev` 로만 판정한다.** `next` 를 기준으로 삼으면, CSV 나 생성기를 고쳐
// 놓고 아직 재빌드하지 않은 상태에서 그 _source 변경을 「팩 손튜닝」으로 오인해 **옛 값을
// 오버라이드로 못박아** 의도한 변경을 영구히 되돌려 버린다. 그래서 이 도구는 **생성기를
// 절대 먼저 돌리지 않는다** — 디스크에 남아 있는 지난 빌드 산출물이 곧 기준선이다.
//
// 매칭은 이름이 아니라 `_id` 로 한다(이름 자체가 손튜닝 대상이므로).
// 회수 대상 필드는 `applyOverride` 가 되살릴 수 있는 것 전부다 — 그것이 완전성의 기준이다.

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

// 팩 이름 → { 빌드 산출 디렉터리, 오버라이드 파일, 그 파일 안에서의 위치 }
// works/syndromes 는 build-core-character-data 가 packs/ 에 직접 쓰고 오버라이드 통로가
// 없어서 회수할 자리가 없다 — 목록에 넣지 않는다(넣으면 매번 헛돈다).
const PACKS = {
  weapons:  { built: "pack-weapons",  file: "item-mech-overrides.json",   bucket: "weapons" },
  armors:   { built: "pack-armors",   file: "item-mech-overrides.json",   bucket: "armors" },
  vehicles: { built: "pack-vehicles", file: "item-mech-overrides.json",   bucket: "vehicles" },
  items:    { built: "pack-items",    file: "item-mech-overrides.json",   bucket: "items" },
  dlois:    { built: "pack-dlois",    file: "item-mech-overrides.json",   bucket: "dlois" },
  effects:  { built: "effects",       file: "effect-mech-overrides.json", bucket: null },
};

function arg(flag, fallback = null) {
  const i = process.argv.indexOf(flag);
  return i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith("--") ? process.argv[i + 1] : fallback;
}
const stampMode = process.argv.includes("--stamp");
// --audit: 팩을 보지 않고 **오버라이드 ↔ 빌드 산출물**만 대조해, 적어 두었으나 빌드에
// 반영되지 않는 「무력한 오버라이드」를 찾는다. 빌더가 applyOverride 뒤에 같은 필드를 다시
// 덮어쓰는 규칙(once 의 used, FIXED_ENCROACH …)이 있어서 실제로 생긴다.
//   ※ 이것을 「재빌드 후 팩과 빌드 산출물 비교」로 만들면 안 된다 — 재빌드 직후 팩은 그
//     산출물을 그대로 넣은 것이라 정의상 항상 일치해서 아무것도 잡지 못한다.
const audit = process.argv.includes("--audit");
const write = process.argv.includes("--write") && !audit;
const quiet = process.argv.includes("--quiet");
const all = process.argv.includes("--all");
const only = arg("--name");
const packOverride = arg("--pack");

if (!all && !only && !stampMode && !audit) {
  console.error("usage: recover-pack-edits.mjs (--all | --name <" + Object.keys(PACKS).join("|") + "> | --stamp | --audit) [--pack <dir>] [--write] [--quiet]");
  process.exit(2);
}
if (only && !PACKS[only]) {
  console.error(`unknown pack: ${only} (${Object.keys(PACKS).join(", ")})`);
  process.exit(2);
}

// ── 기준선 유효성(스탬프) ───────────────────────────────────────────────────────
// 기준선은 「지난 빌드가 팩에 넣은 값」이어야만 의미가 있다. 그런데 누구든 `node
// _source/build-items.mjs` 를 손으로 한 번 돌리면 그 순간 `_source/pack-*` 는 「지금
// _source 로 빌드하면 나올 값」으로 바뀌고, 그러면 이 도구는 아직 팩에 반영되지 않은
// _source 변경을 전부 「손튜닝」으로 오인해 **옛 값을 오버라이드로 못박는다** — 조용히,
// 그리고 되돌리기 어렵게. 그래서 release.ps1 이 팩을 교체한 직후 `--stamp` 로 그때의
// 산출물 해시를 남기고, 회수 전에 그것과 일치하는지 확인한다. 어긋나면 손튜닝과 _source
// 변경을 구별할 방법이 없으므로 회수하지 않고 멈춘다(추측해서 못박는 것보다 안전하다).
const STAMP_PATH = path.join(ROOT, "_source", ".pack-baseline-stamp.json");

function hashBuilt(dir) {
  if (!fs.existsSync(dir)) return null;
  const h = crypto.createHash("sha256");
  for (const f of fs.readdirSync(dir).sort()) {
    if (!f.endsWith(".json")) continue;
    h.update(f).update("\0").update(fs.readFileSync(path.join(dir, f))).update("\0");
  }
  return h.digest("hex");
}

if (stampMode) {
  const stamp = {};
  for (const [name, spec] of Object.entries(PACKS)) {
    const hash = hashBuilt(path.join(ROOT, "_source", spec.built));
    if (hash) stamp[name] = hash;
  }
  fs.writeFileSync(STAMP_PATH, JSON.stringify(stamp, null, 2) + "\n", "utf8");
  console.log(`DX3rd | 기준선 스탬프 기록: ${Object.keys(stamp).length}개 팩`);
  process.exit(0);
}

const stamp = fs.existsSync(STAMP_PATH) ? JSON.parse(fs.readFileSync(STAMP_PATH, "utf8")) : null;

// ── LevelDB 읽기 ────────────────────────────────────────────────────────────────
// Foundry 가 실행 중이면 팩이 잠긴다. 잠금은 LOCK 파일 하나이므로 임시 복사본을 읽는다
// (원본은 건드리지 않는다). 훅에서 도는 경우엔 이미 Foundry 가 닫혀 있지만, 손으로 돌릴
// 때를 위해 유지한다.
const app = process.env.FOUNDRY_APP_PATH || "C:/Program Files/Foundry Virtual Tabletop/resources/app";
const classicLevelPath = path.join(app, "node_modules", "classic-level", "index.js");
if (!fs.existsSync(classicLevelPath)) {
  // 종료 코드 3 = 「팩을 읽을 수단이 없다」. 훅은 이것만 경고로 넘긴다 — Foundry 가 없는
  // 머신에서는 애초에 손튜닝이 생길 수 없으므로 커밋까지 막을 이유가 없다. 그 밖의 실패
  // (읽기 오류·기록 실패)는 그대로 커밋을 중단시켜야 한다. 조용히 넘기면 데이터가 사라진다.
  console.error(`DX3rd | Foundry 의 ClassicLevel 을 찾지 못했다: ${classicLevelPath} (FOUNDRY_APP_PATH 설정)`);
  process.exit(3);
}
const { ClassicLevel } = await import("file:///" + classicLevelPath.replace(/\\/g, "/"));

async function readPack(dir) {
  const tmp = fs.mkdtempSync(path.join(fs.realpathSync(process.env.TEMP || "/tmp"), "dx3rd-pack-"));
  try {
    for (const f of fs.readdirSync(dir)) {
      if (f === "LOCK") continue;
      fs.copyFileSync(path.join(dir, f), path.join(tmp, f));
    }
    const db = new ClassicLevel(tmp, { valueEncoding: "json" });
    const docs = new Map(), folders = new Map();
    for await (const [key, value] of db.iterator()) {
      if (key.startsWith("!folders!")) folders.set(value._id, value);
      else docs.set(value._id, value);
    }
    await db.close();
    return { docs, folders };
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

function readBuilt(dir) {
  const docs = new Map(), folders = new Map();
  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith(".json")) continue;
    const d = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"));
    if (f.startsWith("_folder_")) folders.set(d._id, d);
    else docs.set(d._id, d);
  }
  return { docs, folders };
}

// 폴더 id → 이름 경로 배열. 폴더 id 는 빌드마다 재생성되므로 비교는 반드시 이름 경로로 한다.
function folderPath(folders, id) {
  const out = [];
  let cur = id, guard = 0;
  while (cur && guard++ < 20) {
    const f = folders.get(cur);
    if (!f) break;
    out.unshift(f.name);
    cur = f.folder ?? f.parent ?? null;
  }
  return out;
}

// ── 비교 정규화 ─────────────────────────────────────────────────────────────────
// Foundry 는 팩을 읽을 때 스키마를 강제해 숫자를 문자로(또는 그 반대로) 바꾸고, 빌더가
// 생략한 필드를 기본값으로 채운다(`action: ""`, `applyMode: "toggle"`, `macros: []` …).
// 그 잡음을 손튜닝으로 오인하면 매 커밋 오버라이드가 부풀어 오른다.
const DEFAULTS = new Map([["action", ""], ["applyMode", "toggle"], ["state", false], ["macros", []]]);

function same(a, b, key) {
  if (a === b) return true;
  // 빌더가 안 실은 필드를 Foundry 가 기본값으로(또는 null 로) 채운 경우 = 무변경.
  // null 을 undefined 와 같이 다루지 않으면 `null` vs `""` 같은 쌍이 매번 손튜닝으로 잡힌다.
  if (a === undefined || b === undefined || a === null || b === null) {
    const present = a === undefined || a === null ? b : a;
    if (present === undefined || present === null || present === "") return true;
    if (DEFAULTS.has(key) && JSON.stringify(DEFAULTS.get(key)) === JSON.stringify(present)) return true;
    if (Array.isArray(present) && present.length === 0) return true;
    if (present && typeof present === "object" && Object.keys(present).length === 0) return true;
    return false;
  }
  if (typeof a !== "object" && typeof b !== "object") return String(a) === String(b);
  if (typeof a !== typeof b) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ka = Object.keys(a ?? {}), kb = Object.keys(b ?? {});
  for (const k of new Set([...ka, ...kb])) if (!same(a?.[k], b?.[k], k)) return false;
  return true;
}

// 보정 행 맵은 id 가 서로 다르다(Foundry 가 만든 랜덤 id vs 빌드의 결정적 genId).
// 그래서 id 를 버리고 행 내용의 정렬된 목록으로 비교하고, 회수도 배열 형태로 한다.
function attrRows(map) {
  return Object.values(map ?? {})
    .map((r) => ({ key: r.key, label: r.label ?? r.key, value: String(r.value ?? ""), ...(r.action ? { action: r.action } : {}) }))
    .sort((x, y) => JSON.stringify(x).localeCompare(JSON.stringify(y)));
}
const sameAttrs = (a, b) => JSON.stringify(attrRows(a)) === JSON.stringify(attrRows(b));

// ── 회수 규칙 ───────────────────────────────────────────────────────────────────
// 각 항목: live 와 prev 를 비교해 다르면 live 를 오버라이드 값으로 만든다.
// `applyOverride` 가 되살릴 수 있는 것만 있다 — 못 되살리는 값을 적으면 조용히 무시된다.
const SIMPLE_SYSTEM = ["description", "attack", "guard", "add", "range", "dodge", "armor", "attackRoll", "skill", "roll", "getTarget"];

function collect(live, prev, liveFolders, prevFolders) {
  const out = {};
  const hits = [];
  const put = (k, v, label) => { out[k] = v; hits.push(label ?? k); };

  if (!same(live.img, prev.img, "img")) put("img", live.img, `img ${prev.img} -> ${live.img}`);
  if (!same(live.name, prev.name, "name")) put("name", live.name, `name ${JSON.stringify(prev.name)} -> ${JSON.stringify(live.name)}`);

  for (const k of SIMPLE_SYSTEM) {
    if (!same(live.system?.[k], prev.system?.[k], k)) {
      put(k, live.system[k], `${k} ${JSON.stringify(prev.system?.[k])} -> ${JSON.stringify(live.system[k])}`);
    }
  }

  // 보정 행(자기 채널)
  if (!sameAttrs(live.system?.attributes, prev.system?.attributes)) put("attributes", attrRows(live.system?.attributes), "attributes");

  // 대상 채널은 수명/타이밍/행/버킷이 한 덩어리 — applyOverride 가 통째로 갈아끼우므로 통째로 싣는다.
  const le = live.system?.effect, pe = prev.system?.effect;
  if (!same(le?.disable, pe?.disable, "disable") || !same(le?.runTiming, pe?.runTiming, "runTiming")
      || !sameAttrs(le?.attributes, pe?.attributes) || !same(le?.buckets, pe?.buckets, "buckets")) {
    const eff = { disable: le?.disable, runTiming: le?.runTiming, attributes: attrRows(le?.attributes) };
    if (le?.buckets && Object.keys(le.buckets).length) eff.buckets = le.buckets;
    put("effect", eff, "effect(대상 채널)");
  }

  // 자기 채널의 발현/수명. state 는 항상 false 로 빌드된다(상시 이펙트는 런타임이 켠다).
  const la = live.system?.active, pa = prev.system?.active;
  if (!same(la?.disable, pa?.disable, "disable") || !same(la?.runTiming, pa?.runTiming, "runTiming")
      || !same(la?.applyMode, pa?.applyMode, "applyMode") || !same(la?.action, pa?.action, "action")
      || !same(la?.buckets, pa?.buckets, "buckets")) {
    const act = { state: false, disable: la?.disable, runTiming: la?.runTiming };
    if (la?.applyMode !== undefined) act.applyMode = la.applyMode;
    if (la?.action !== undefined) act.action = la.action;
    if (la?.buckets && Object.keys(la.buckets).length) act.buckets = la.buckets;
    put("active", act, "active(자기 채널)");
  }

  for (const k of ["encroach", "hp", "resourceCost", "used"]) {
    if (!same(live.system?.[k], prev.system?.[k], k)) put(k, live.system[k], k);
  }
  if (!same(live.system?.macros, prev.system?.macros, "macros")) put("macros", live.system.macros ?? [], "macros");

  const li = live.flags?.["dx3rd-emanim"]?.itemExtend, pi = prev.flags?.["dx3rd-emanim"]?.itemExtend;
  if (!same(li, pi, "itemExtend")) put("itemExtend", li, "itemExtend(확장 도구)");

  const lf = folderPath(liveFolders, live.folder), pf = folderPath(prevFolders, prev.folder);
  if (lf.join(" / ") !== pf.join(" / ")) put("folder", lf, `folder ${pf.join(" / ") || "(루트)"} -> ${lf.join(" / ") || "(루트)"}`);

  return { out, hits };
}

// ── --audit: 무력한 오버라이드 찾기 ─────────────────────────────────────────────
// 오버라이드에 적어 두었지만 빌드 산출물에 그 값이 없으면, 그 저작은 아무 효과가 없다.
// 「Foundry 에서 고쳐 → 회수됐는데 → 다음 세션에 원래대로」의 원인이 대개 이것이다.
if (audit) {
  let dead = 0;
  for (const [name, spec] of Object.entries(PACKS)) {
    const builtDir = path.join(ROOT, "_source", spec.built);
    if (!fs.existsSync(builtDir)) continue;
    const built = new Map();
    for (const f of fs.readdirSync(builtDir)) {
      if (!f.endsWith(".json") || f.startsWith("_folder_")) continue;
      const d = JSON.parse(fs.readFileSync(path.join(builtDir, f), "utf8"));
      built.set(d.name, d);
    }
    const fp = path.join(ROOT, "_source", spec.file);
    if (!fs.existsSync(fp)) continue;
    const data = JSON.parse(fs.readFileSync(fp, "utf8"));
    const bucket = spec.bucket ? (data[spec.bucket] ?? {}) : data;
    const lines = [];
    for (const [key, ov] of Object.entries(bucket)) {
      // ov.name 이 있으면 빌드 산출물의 이름은 그쪽으로 바뀌어 있다.
      const doc = built.get(ov.name ?? key) ?? built.get(key);
      if (!doc) { lines.push(`  ${key}: 빌드 산출물에 없음(이름 변경/삭제?)`); dead++; continue; }
      const bad = [];
      if (ov.img !== undefined && doc.img !== ov.img) bad.push("img");
      if (ov.name !== undefined && doc.name !== ov.name) bad.push("name");
      for (const k of ["description", ...SIMPLE_SYSTEM.filter((x) => x !== "description")]) {
        if (ov[k] !== undefined && !same(doc.system?.[k], ov[k], k)) bad.push(k);
      }
      for (const k of ["encroach", "hp", "resourceCost", "used"]) {
        if (ov[k] !== undefined && !same(doc.system?.[k], ov[k], k)) bad.push(k);
      }
      if (ov.attributes !== undefined) {
        const norm = (r) => ({ key: r.key, label: r.label ?? r.key, value: String(r.value ?? ""), ...(r.action ? { action: r.action } : {}) });
        // build-effects 의 migrateEffectAttackFields 는 attack/add 보정 행을 일부러
        // `system.attack`/`system.add` 로 옮긴다. 그건 반영 실패가 아니라 이동이므로
        // 해당 필드가 그 값을 이미 들고 있으면 기대 목록에서 뺀다(빼지 않으면 오탐).
        const expected = ov.attributes.map(norm).filter((r) => {
          if (r.key !== "attack" && r.key !== "add") return true;
          return String(doc.system?.[r.key] ?? "") !== r.value;
        });
        const sort = (rows) => rows.sort((x, y) => JSON.stringify(x).localeCompare(JSON.stringify(y)));
        if (JSON.stringify(sort(attrRows(doc.system?.attributes))) !== JSON.stringify(sort(expected))) bad.push("attributes");
      }
      if (bad.length) { lines.push(`  ${key}: ${bad.join(", ")}`); dead++; }
    }
    if (lines.length) {
      console.log(`DX3rd | ${name}: 빌드에 반영되지 않는 오버라이드 ${lines.length}건`);
      for (const l of lines.slice(0, 20)) console.log(l);
      if (lines.length > 20) console.log(`  … 외 ${lines.length - 20}건`);
    }
  }
  console.log(dead ? `DX3rd | 무력한 오버라이드 총 ${dead}건 — 빌더가 applyOverride 뒤에 그 필드를 덮어쓴다.`
                   : "DX3rd | 모든 오버라이드가 빌드에 반영된다.");
  process.exit(0);
}

// ── 실행 ────────────────────────────────────────────────────────────────────────
const files = new Map();   // 오버라이드 파일 경로 → 파싱된 객체 (여러 팩이 한 파일을 공유)
const touched = new Set(); // 실제로 회수가 들어간 파일만. 나머지는 손대지 않는다 —
                           // 무변경 파일을 다시 써 넣으면 들여쓰기만 바뀐 diff 가 매 커밋 생긴다.
function loadFile(name) {
  const fp = path.join(ROOT, "_source", name);
  if (!files.has(fp)) files.set(fp, fs.existsSync(fp) ? JSON.parse(fs.readFileSync(fp, "utf8")) : {});
  return { fp, data: files.get(fp) };
}

const names = only ? [only] : Object.keys(PACKS);
let totalChanged = 0, baselineStale = false;

for (const name of names) {
  const spec = PACKS[name];
  const packDir = packOverride && only ? packOverride : path.join(ROOT, "packs", name);
  const builtDir = path.join(ROOT, "_source", spec.built);

  if (!fs.existsSync(packDir)) { if (!quiet) console.log(`DX3rd | ${name}: 팩 없음 — 건너뜀`); continue; }
  // 기준선이 없으면 live 를 전부 손튜닝으로 오해한다. 회수하는 것보다 건너뛰는 편이 안전하다.
  if (!fs.existsSync(builtDir)) { console.warn(`DX3rd | ${name}: 기준선(${spec.built}) 없음 — 건너뜀(먼저 한 번 빌드할 것)`); continue; }
  // 스탬프가 없으면(도입 전 저장소) 경고만 하고 진행한다 — 다음 빌드가 스탬프를 남긴다.
  if (stamp && stamp[name] && stamp[name] !== hashBuilt(builtDir)) {
    console.error(`DX3rd | ${name}: 기준선이 팩과 어긋난다 — 마지막 팩 교체 이후 _source 생성기가 다시 돌았다.`);
    console.error(`DX3rd |   이 상태에서는 손튜닝과 _source 변경을 구별할 수 없어 회수하지 않는다.`);
    console.error(`DX3rd |   해결: 팩에 살릴 손튜닝이 없으면 그대로 'release.ps1 -UpdatePacks' 로 재빌드해 기준선을 맞출 것.`);
    console.error(`DX3rd |         살릴 손튜닝이 있으면 팩을 백업해 두고 --pack <백업> 으로 따로 회수할 것.`);
    baselineStale = true;
    continue;
  }

  const livePack = await readPack(packDir);
  const prevPack = readBuilt(builtDir);

  const { fp, data } = loadFile(spec.file);
  const bucket = spec.bucket ? (data[spec.bucket] ??= {}) : data;

  // 팩에만 있는 문서 = Foundry 에서 **새로 만든** 아이템. 오버라이드는 빌드된 문서를
  // 꾸미는 통로일 뿐 문서를 만들어 내지 못하므로 이건 회수할 수 없다 — 재빌드가 지운다.
  // 조용히 넘기면 아이템이 통째로 사라지므로 반드시 알린다(원본은 CSV 에 추가해야 한다).
  const added = [...livePack.docs.values()].filter((d) => !prevPack.docs.has(d._id));
  if (added.length) {
    console.warn(`DX3rd | ${name}: 팩에만 있는 문서 ${added.length}건 — 회수 불가, 재빌드가 지운다: ${added.slice(0, 5).map((d) => d.name).join(", ")}${added.length > 5 ? " …" : ""}`);
    console.warn(`DX3rd |   새 아이템은 오버라이드가 아니라 _source 원본(CSV)에 추가해야 한다.`);
  }

  let changed = 0, unmatched = 0;
  const report = [];
  for (const [id, prev] of prevPack.docs) {
    const live = livePack.docs.get(id);
    if (!live) { unmatched++; continue; }
    const { out, hits } = collect(live, prev, livePack.folders, prevPack.folders);
    if (!hits.length) continue;
    changed++;
    report.push(`  ${prev.name}: ${hits.join("; ")}`);
    // 오버라이드 키는 CSV 원본 이름(= 빌드본의 이름)이다. live.name 은 ov.name 으로 들어간다.
    bucket[prev.name] = { ...(bucket[prev.name] ?? {}), ...out };
  }

  totalChanged += changed;
  if (changed) touched.add(fp);
  if (changed || !quiet) {
    console.log(`DX3rd | ${name}: 기준 ${prevPack.docs.size}건 / 팩 ${livePack.docs.size}건 / 회수 ${changed}건`
      + (unmatched ? ` / 팩에 없는 기준 문서 ${unmatched}건` : ""));
    for (const line of report) console.log(line);
  }
}

// 종료 코드 4 = 기준선 불일치. 훅은 이걸 받으면 커밋을 중단해야 한다 — 그대로 재빌드하면
// 팩에 남아 있던 손튜닝이 회수되지 못한 채 사라진다.
if (baselineStale) process.exit(4);

if (!totalChanged) {
  if (!quiet) console.log("DX3rd | 회수할 손튜닝 없음");
  process.exit(0);
}
if (!write) {
  console.log(`\nDX3rd | (dry-run) 총 ${totalChanged}건. --write 를 붙이면 _source 오버라이드에 기록한다.`);
  process.exit(0);
}
for (const fp of touched) {
  fs.writeFileSync(fp, JSON.stringify(files.get(fp), null, 2) + "\n", "utf8");
  console.log(`DX3rd | wrote ${path.relative(ROOT, fp)}`);
}
console.log(`DX3rd | 손튜닝 ${totalChanged}건 회수 완료 — 이어지는 재빌드가 이 값을 다시 넣는다.`);
