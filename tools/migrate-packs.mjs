#!/usr/bin/env node
// 커밋된 LevelDB 팩을 **직접** 고치는 마이그레이션 하네스.
//
// 왜 이것이 필요한가: `packs/` 가 컴펜디움 내용의 원본이 된 뒤(2026-07-31 전제 반전),
// 전 아이템 스키마 변경 같은 일괄 수정에 남은 길은 두 가지뿐이다.
//   ① `release.ps1 -UpdatePacks` — CSV 파이프라인으로 전량 재빌드. 표현 통로가 없는 것
//      (Foundry 에서 만든 문서, works/syndromes 손질, 빌더가 덮는 필드)은 그 자리에서 사라진다.
//   ② 팩을 열어 필요한 필드만 바꾼다 — 그 밖의 모든 저장값은 손대지 않는다.
// 스키마 변경에 ①을 쓰는 것은 「못 하나 박으려고 집을 다시 짓는」 격이고, 실제로 그 경로가
// 데이터를 두 번 파괴했다. 이 스크립트가 ②다.
//
// 사용:
//   node tools/migrate-packs.mjs --script tools/migrations/<이름>.mjs            # dry-run
//   node tools/migrate-packs.mjs --script <…> --pack weapons,items               # 대상 한정
//   node tools/migrate-packs.mjs --script <…> --apply --confirm-live-pack        # 기록
//   node tools/migrate-packs.mjs --restore dist/pack-backups/<타임스탬프>         # 되돌리기
//
// --apply 없이는 무엇이 바뀔지만 출력하고 LevelDB 는 열어 보기만 한다.
//
// ── 마이그레이션 모듈 계약 ──────────────────────────────────────────────────────
//   export const description = "무엇을 왜 바꾸는가";   // 필수. 리포트에 남는다.
//   export const packs = ["weapons", "items"];         // 선택. 기본값 = system.json 선언 전체
//   export const includeFolders = false;               // 선택. 기본값 = 폴더 문서는 건너뜀
//   export const idempotent = true;                    // 선택. 기록 후 재실행해 0건인지 검증
//   export function migrate(doc, ctx) { … }            // migrate/create 중 하나 이상 필수
//   export function create(ctx) {                      // 선택. 팩마다 한 번 호출
//     ctx.item({ _id: "16자리FoundryID", name: "…", type: "etc", system: { … } });
//     ctx.folder({ _id: "16자리FoundryID", name: "…", type: "Item", … });
//   }
//
// `migrate` 는 **복제본**을 받는다. 그 자리에서 고치거나 새 문서를 return 하면 된다.
// 변경 여부는 하네스가 원본과 JSON 비교해 스스로 판정하므로 「무엇을 바꿨는지」를 보고할
// 의무가 없다 — 그 보고를 손으로 쓰다 실제 변경과 어긋나는 것이 기존 일회용 스크립트들의
// 상시 위험이었다. 바꿀 것이 없으면 아무것도 하지 않고 돌아오면 된다.
// ctx = { pack, key, original, isFolder, log(msg), fail(msg) }
//
// ── 회수(recover-pack-edits)와의 관계 ───────────────────────────────────────────
// 이 스크립트가 쓴 값은 `live ≠ prev` 가 되므로, 다음 재빌드 직전의 회수가 그것을
// **손튜닝으로 보고 오버라이드에 못박는다.** 그건 오작동이 아니라 바라던 바다 — 재빌드가
// 마이그레이션 결과를 되돌리지 않는다. 다만 `applyOverride` 통로가 없는 필드를 바꿨다면
// 회수되지 않으니, 그런 마이그레이션은 _source 생성기도 함께 고쳐야 영구적이다.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// ── 인자 ────────────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const flag = (name) => argv.includes(name);
const value = (name) => {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : null;
};

const KNOWN = ["--script", "--pack", "--apply", "--confirm-live-pack", "--restore", "--verbose", "--allow-dirty"];
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (!a.startsWith("--")) continue;
  if (!KNOWN.includes(a)) fatal(`알 수 없는 인자: ${a}`, 2);
}

const scriptArg = value("--script");
const packArg = value("--pack");
const restoreArg = value("--restore");
const apply = flag("--apply");
const verbose = flag("--verbose");
const allowDirty = flag("--allow-dirty");

function fatal(message, code = 1) {
  console.error(`DX3rd | ${message}`);
  process.exit(code);
}

if (!scriptArg && !restoreArg) {
  console.error("usage: migrate-packs.mjs --script <모듈> [--pack a,b] [--apply --confirm-live-pack] [--verbose]");
  console.error("       migrate-packs.mjs --restore <dist/pack-backups/…>");
  process.exit(2);
}
// 실수로 라이브 팩에 쓰는 것을 막는 이중 확인. 기존 일회용 스크립트들과 같은 규약이다.
if (apply && !flag("--confirm-live-pack")) {
  fatal("--apply 는 --confirm-live-pack 을 함께 요구한다(커밋된 팩에 직접 쓴다).", 2);
}

const DECLARED = JSON.parse(fs.readFileSync(path.join(ROOT, "system.json"), "utf8")).packs.map((p) => p.name);

// ── LevelDB ─────────────────────────────────────────────────────────────────────
// 복원 경로도 잠금 확인에 이것을 쓰므로 되돌리기 블록보다 위에 있어야 한다.
const app = process.env.FOUNDRY_APP_PATH || "C:/Program Files/Foundry Virtual Tabletop/resources/app";
const classicLevelPath = path.join(app, "node_modules", "classic-level", "index.js");
if (!fs.existsSync(classicLevelPath)) {
  // 회수 도구와 같은 종료 코드 3 = 「팩을 읽을 수단이 없다」.
  fatal(`Foundry 의 ClassicLevel 을 찾지 못했다: ${classicLevelPath} (FOUNDRY_APP_PATH 설정)`, 3);
}
const { ClassicLevel } = await import(pathToFileURL(classicLevelPath).href);

// Foundry 가 팩을 잡고 있으면 LOCK 때문에 open 이 실패한다. 그 오류를 그대로 흘리면
// 「IO error: … LOCK」 같은 메시지만 남아 원인을 못 짚으므로 여기서 번역한다. dry-run 도
// 마찬가지다 — 열지 못하면 어차피 아무것도 못 본다.
async function openPack(dir) {
  const db = new ClassicLevel(dir, { valueEncoding: "json" });
  try {
    await db.open();
  } catch (err) {
    if (/LOCK|lock/i.test(String(err?.message))) {
      throw new Error(`팩이 잠겨 있다(Foundry 실행 중?): ${path.relative(ROOT, dir)}`);
    }
    throw err;
  }
  return db;
}

// 프로세스 목록을 보는 대신 실제로 잠금을 시험한다 — 플랫폼 독립이고, 「Foundry 는 껐는데
// 다른 도구가 잡고 있다」는 경우까지 같이 잡는다.
async function assertUnlocked(names) {
  for (const name of names) {
    const dir = path.join(ROOT, "packs", name);
    if (!fs.existsSync(dir)) continue;
    const db = await openPack(dir);
    await db.close();
  }
}

// ── 되돌리기 ────────────────────────────────────────────────────────────────────
// 백업이 있어도 「어떻게 되돌리지」가 남으면 아무도 --apply 를 못 누른다. 그래서 복원을
// 문서가 아니라 코드로 둔다. LevelDB 디렉터리는 통째로 갈아끼워야 하므로(파일 하나만
// 되돌리면 MANIFEST 와 어긋나 팩이 깨진다) 디렉터리 단위로 교체한다.
if (restoreArg) {
  const from = path.resolve(ROOT, restoreArg);
  if (!fs.existsSync(from)) fatal(`백업이 없다: ${from}`, 2);
  const names = fs.readdirSync(from).filter((n) => fs.statSync(path.join(from, n)).isDirectory());
  if (!names.length) fatal(`백업에 팩 디렉터리가 없다: ${from}`, 2);
  if (!apply) {
    console.log(`DX3rd | (dry-run) 복원 대상 ${names.length}개 팩: ${names.join(", ")}`);
    console.log("DX3rd | 실제로 되돌리려면 --apply --confirm-live-pack 을 붙일 것.");
    process.exit(0);
  }
  await assertUnlocked(names);
  for (const name of names) {
    const target = path.join(ROOT, "packs", name);
    if (fs.existsSync(target)) fs.rmSync(target, { recursive: true, force: true });
    fs.cpSync(path.join(from, name), target, { recursive: true });
    console.log(`DX3rd | 복원: packs/${name}`);
  }
  console.log("DX3rd | 복원 완료. 'git status -- packs' 로 확인할 것.");
  process.exit(0);
}

// ── 마이그레이션 모듈 ───────────────────────────────────────────────────────────
const scriptPath = path.resolve(ROOT, scriptArg);
if (!fs.existsSync(scriptPath)) fatal(`마이그레이션 모듈이 없다: ${scriptPath}`, 2);
const mod = await import(pathToFileURL(scriptPath).href);
if (typeof mod.migrate !== "function" && typeof mod.create !== "function") {
  fatal(`${scriptArg} 에 migrate(doc, ctx) 또는 create(ctx) 가 없다.`, 2);
}
if (!mod.description) fatal(`${scriptArg} 에 description 이 없다 — 리포트에 무엇을 왜 했는지 남아야 한다.`, 2);

const includeFolders = mod.includeFolders === true;
const idempotent = mod.idempotent !== false;

let targets = mod.packs ?? DECLARED;
if (packArg) {
  const asked = packArg.split(",").map((s) => s.trim()).filter(Boolean);
  // 모듈이 대상 팩을 좁혀 놓았으면 그 범위 밖은 --pack 으로도 열지 않는다. 모듈이 자기
  // 스키마 가정과 무관한 팩까지 훑는 것은 사고이지 유연성이 아니다.
  const outside = asked.filter((n) => !targets.includes(n));
  if (outside.length) fatal(`이 마이그레이션의 대상이 아닌 팩: ${outside.join(", ")} (대상: ${targets.join(", ")})`, 2);
  targets = asked;
}
const unknownPacks = targets.filter((n) => !DECLARED.includes(n));
if (unknownPacks.length) fatal(`system.json 에 선언되지 않은 팩: ${unknownPacks.join(", ")}`, 2);

// 커밋된 상태에서 마이그레이션하면 `git checkout -- packs/<이름>` 이 백업과 별개의 두 번째
// 되돌리기 통로가 되고, 커밋 diff 에 마이그레이션 결과**만** 남아 검토할 수 있다. 팩이 이미
// 더러우면 Foundry 에서 만지던 것과 뒤섞여 둘 다 잃는다. 그래서 막되, 판단은 남겨 둔다.
if (apply && !allowDirty) {
  const { execFileSync } = await import("node:child_process");
  const dirty = targets.filter((name) => {
    try {
      return execFileSync("git", ["status", "--porcelain", "--", `packs/${name}`], { cwd: ROOT, encoding: "utf8" }).trim() !== "";
    } catch {
      return false; // git 이 없거나 저장소가 아니면 이 안전장치는 포기한다(백업은 남는다).
    }
  });
  if (dirty.length) {
    console.error(`DX3rd | 커밋되지 않은 팩 변경이 있다: ${dirty.join(", ")}`);
    console.error("DX3rd |   먼저 'git add packs && git commit' 으로 Foundry 편집분을 확정할 것.");
    console.error("DX3rd |   그래야 마이그레이션 결과만 담긴 diff 를 검토할 수 있고, git 이 두 번째 복구 통로가 된다.");
    console.error("DX3rd |   그대로 진행하려면 --allow-dirty.");
    process.exit(1);
  }
}

// 8개 중 5번째가 잠겨 있어서 4개만 바뀐 상태로 멈추는 것이 최악이다. 쓰기 전에 전부 연다.
if (apply) await assertUnlocked(targets);

// ── 변경 판정 ───────────────────────────────────────────────────────────────────
// 잎 경로 단위로 before/after 를 뽑는다. 문서 통째 비교만 하면 「바뀌었다」는 알아도
// 리포트를 읽고 옳은 변경인지 판단할 수 없다.
function diffPaths(before, after, prefix = "", out = []) {
  if (before === after) return out;
  const isObj = (v) => v !== null && typeof v === "object";
  if (!isObj(before) || !isObj(after) || Array.isArray(before) !== Array.isArray(after)) {
    if (JSON.stringify(before) !== JSON.stringify(after)) out.push({ path: prefix, before, after });
    return out;
  }
  if (Array.isArray(before)) {
    if (JSON.stringify(before) !== JSON.stringify(after)) out.push({ path: prefix, before, after });
    return out;
  }
  for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
    diffPaths(before[key], after[key], prefix ? `${prefix}.${key}` : key, out);
  }
  return out;
}

// ── 신규 문서 사전 점검 ─────────────────────────────────────────────────────────
// 생성 요청은 기존 문서를 훑는 migrate() 안이 아니라 팩마다 딱 한 번 받는다. 그래야 빈 팩에도
// 문서를 만들 수 있고, 기존 문서 수에 따라 같은 요청이 N번 쌓이지 않는다. 모든 대상 팩의
// 충돌을 쓰기 **전에** 검사하므로 네 팩 중 셋만 기록된 반쪽짜리 import도 남기지 않는다.
const requestedCreates = new Map();
const failures = [];

function creationKey(kind, doc) {
  return `${kind === "folder" ? "!folders!" : "!items!"}${doc._id}`;
}

function validateCreation(kind, doc, pack) {
  if (!doc || typeof doc !== "object" || Array.isArray(doc)) {
    return `${pack}: ctx.${kind}() 인자는 문서 객체여야 한다.`;
  }
  if (!/^[A-Za-z0-9]{16}$/.test(doc._id ?? "")) {
    return `${pack}/${doc.name ?? "(이름 없음)"}: _id 는 16자리 영숫자여야 한다(${JSON.stringify(doc._id)}).`;
  }
  if (typeof doc.name !== "string" || !doc.name.trim()) {
    return `${pack}/${doc._id}: name 이 없는 신규 문서다.`;
  }
  if (kind === "item" && (typeof doc.type !== "string" || !doc.type || !doc.system || typeof doc.system !== "object")) {
    return `${pack}/${doc.name}: 아이템 생성에는 type 과 system 객체가 필요하다.`;
  }
  if (kind === "folder" && doc.type !== "Item") {
    return `${pack}/${doc.name}: 아이템 팩 폴더의 type 은 "Item" 이어야 한다.`;
  }
  return null;
}

function collectCreationRequests(name, problemSink) {
  const creates = new Map();
  if (typeof mod.create === "function") {
    const add = (kind, value) => {
      const doc = structuredClone(value);
      const problem = validateCreation(kind, doc, name);
      if (problem) {
        problemSink.push(problem);
        return;
      }
      const key = creationKey(kind, doc);
      const previous = creates.get(key);
      if (previous && JSON.stringify(previous.value) !== JSON.stringify(doc)) {
        problemSink.push(`${name}/${doc.name}: 같은 키 ${key} 로 서로 다른 신규 문서를 요청했다.`);
        return;
      }
      creates.set(key, { key, kind, value: doc });
    };
    mod.create({
      pack: name,
      item: (doc) => add("item", doc),
      folder: (doc) => add("folder", doc),
      fail: (m) => problemSink.push(`${name}: ${m}`),
    });
  }
  return creates;
}

for (const name of targets) {
  const creates = collectCreationRequests(name, failures);
  requestedCreates.set(name, creates);
}

for (const name of targets) {
  const dir = path.join(ROOT, "packs", name);
  if (!fs.existsSync(dir)) continue;
  const db = await openPack(dir);
  try {
    for (const request of requestedCreates.get(name).values()) {
      let existing;
      try {
        existing = await db.get(request.key);
      } catch (err) {
        if (err?.code === "LEVEL_NOT_FOUND") continue;
        throw err;
      }
      // classic-level 버전에 따라 없는 키를 예외 대신 undefined 로 돌려주기도 한다.
      if (existing === undefined) continue;
      if (JSON.stringify(existing) !== JSON.stringify(request.value)) {
        failures.push(
          `${name}/${request.value.name}: 신규 키 ${request.key} 가 이미 다른 문서에 쓰이고 있다`
        );
      } else {
        request.alreadyPresent = true;
      }
    }
  } finally {
    await db.close();
  }
}

if (failures.length) {
  console.error("DX3rd | 신규 문서 사전 점검 실패 — 팩을 수정하지 않았다:");
  for (const f of failures.slice(0, 20)) console.error(`  ${f}`);
  process.exit(1);
}

// ── 실행 ────────────────────────────────────────────────────────────────────────
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const backupRoot = path.join(ROOT, "dist", "pack-backups", stamp);
const report = {
  generatedAt: new Date().toISOString(),
  mode: apply ? "apply" : "dry-run",
  script: path.relative(ROOT, scriptPath).replace(/\\/g, "/"),
  description: mod.description,
  backup: null,
  packs: {},
};
let total = 0;

for (const name of targets) {
  const dir = path.join(ROOT, "packs", name);
  if (!fs.existsSync(dir)) {
    console.warn(`DX3rd | ${name}: 팩 없음 — 건너뜀`);
    continue;
  }

  const db = await openPack(dir);
  const changes = [];
  let scanned = 0;
  try {
    for await (const [key, doc] of db.iterator()) {
      const isFolder = key.startsWith("!folders!");
      if (isFolder && !includeFolders) continue;
      scanned++;
      const original = structuredClone(doc);
      const draft = structuredClone(doc);
      let deleteRequested = false;
      const ctx = {
        pack: name,
        key,
        original,
        isFolder,
        log: (m) => console.log(`DX3rd |   ${name}/${doc.name ?? doc._id}: ${m}`),
        fail: (m) => failures.push(`${name}/${doc.name ?? doc._id}: ${m}`),
        delete: () => {
          deleteRequested = true;
        },
      };
      const returned = typeof mod.migrate === "function" ? mod.migrate(draft, ctx) : undefined;
      if (deleteRequested) {
        changes.push({
          key,
          id: original._id,
          name: original.name,
          fields: [{ path: "$document", before: original, after: undefined }],
          deleted: true,
        });
        continue;
      }
      const next = returned === undefined || returned === null ? draft : returned;
      // _id 가 바뀌면 월드의 기존 링크가 끊긴다. 키와 문서의 _id 가 어긋나는 것도 마찬가지로
      // 팩을 조용히 망가뜨리므로 여기서 멈춘다.
      if (next._id !== original._id) {
        fatal(`${name}: 마이그레이션이 _id 를 바꿨다(${original._id} -> ${next._id}). 월드의 링크가 끊긴다.`);
      }
      const fields = diffPaths(original, next);
      if (!fields.length) continue;
      changes.push({ key, id: original._id, name: original.name, fields, value: next });
    }
    for (const request of requestedCreates.get(name).values()) {
      if (request.alreadyPresent) continue;
      const doc = request.value;
      changes.push({
        key: request.key,
        id: doc._id,
        name: doc.name,
        fields: [{ path: "$document", before: undefined, after: doc }],
        created: true,
        value: doc,
      });
    }
  } finally {
    await db.close();
  }

  total += changes.length;
  report.packs[name] = {
    scanned,
    changed: changes.length,
    created: changes.filter((c) => c.created).length,
    deleted: changes.filter((c) => c.deleted).length,
    documents: changes.map(({ value: _v, ...rest }) => rest),
  };
  console.log(`DX3rd | ${name}: ${scanned}건 검사 / ${changes.length}건 변경`);
  const shown = verbose ? changes : changes.slice(0, 10);
  for (const c of shown) {
    for (const f of c.fields) {
      console.log(`  ${c.name}: ${f.path} ${JSON.stringify(f.before)} -> ${JSON.stringify(f.after)}`);
    }
  }
  if (!verbose && changes.length > shown.length) {
    console.log(`  … 외 ${changes.length - shown.length}건 (--verbose 또는 리포트 참조)`);
  }

  if (apply && changes.length) {
    // 쓰기 직전에 백업한다. 팩 단위로 하는 이유: LevelDB 는 CURRENT/MANIFEST/*.ldb 가 한
    // 덩어리라 파일 하나만 되돌리면 깨진다. LOCK 은 런타임 산물이므로 뺀다.
    const saved = path.join(backupRoot, name);
    fs.mkdirSync(saved, { recursive: true });
    for (const f of fs.readdirSync(dir)) {
      if (f === "LOCK") continue;
      fs.copyFileSync(path.join(dir, f), path.join(saved, f));
    }
    report.backup = path.relative(ROOT, backupRoot).replace(/\\/g, "/");

    const writeDb = await openPack(dir);
    try {
      await writeDb.batch(changes.map((c) => (
        c.deleted
          ? { type: "del", key: c.key }
          : { type: "put", key: c.key, value: c.value }
      )));
    } finally {
      await writeDb.close();
    }
    console.log(`DX3rd | ${name}: ${changes.length}건 기록 (백업 ${path.relative(ROOT, saved)})`);

    // 멱등성 검증: 같은 마이그레이션을 다시 돌려 0건이어야 한다. 0건이 아니면 규칙이
    // 자기 결과에 또 걸린다는 뜻이고(예: 「접두사를 붙인다」), 두 번 돌리면 데이터가
    // 망가진다. 되돌릴 백업이 있는 지금 알리는 편이 낫다.
    if (idempotent) {
      const verifyDb = await openPack(dir);
      let residue = 0;
      try {
        for await (const [key, doc] of verifyDb.iterator()) {
          if (key.startsWith("!folders!") && !includeFolders) continue;
          const original = structuredClone(doc);
          const draft = structuredClone(doc);
          let deleteRequested = false;
          const returned = typeof mod.migrate === "function" ? mod.migrate(draft, {
            pack: name,
            key,
            original,
            isFolder: key.startsWith("!folders!"),
            log: () => {},
            fail: () => {},
            delete: () => {
              deleteRequested = true;
            },
          }) : undefined;
          if (deleteRequested) {
            residue++;
            continue;
          }
          const next = returned === undefined || returned === null ? draft : returned;
          if (diffPaths(original, next).length) residue++;
        }
        const verifyProblems = [];
        const verifyCreates = collectCreationRequests(name, verifyProblems);
        residue += verifyProblems.length;
        for (const request of verifyCreates.values()) {
          let existing;
          try {
            existing = await verifyDb.get(request.key);
          } catch (err) {
            if (err?.code !== "LEVEL_NOT_FOUND") throw err;
          }
          if (existing === undefined || JSON.stringify(existing) !== JSON.stringify(request.value)) {
            residue++;
          }
        }
      } finally {
        await verifyDb.close();
      }
      if (residue) {
        console.error(`DX3rd | ${name}: 멱등성 검증 실패 — 기록 후에도 ${residue}건이 또 바뀐다.`);
        console.error(`DX3rd |   되돌리려면: node tools/migrate-packs.mjs --restore ${report.backup} --apply --confirm-live-pack`);
        failures.push(`${name}: 멱등성 검증 실패 (${residue}건)`);
      }
    }
  }
}

const reportPath = path.join(ROOT, "tmp", `pack-migration-${apply ? "applied" : "dry-run"}-${stamp}.json`);
fs.mkdirSync(path.dirname(reportPath), { recursive: true });
fs.writeFileSync(reportPath, JSON.stringify(report, null, 2) + "\n", "utf8");
console.log(`DX3rd | 리포트: ${path.relative(ROOT, reportPath)}`);

if (failures.length) {
  console.error(`DX3rd | 문제 ${failures.length}건:`);
  for (const f of failures.slice(0, 20)) console.error(`  ${f}`);
  process.exit(1);
}

if (!apply) {
  console.log(`DX3rd | (dry-run) 총 ${total}건. LevelDB 는 수정되지 않았다.`);
  console.log("DX3rd | 기록하려면 --apply --confirm-live-pack (Foundry 종료 필요).");
} else if (!total) {
  console.log("DX3rd | 바꿀 것이 없었다.");
} else {
  console.log(`DX3rd | 총 ${total}건 기록. 'git add packs' 로 스테이징하면 커밋에 담긴다.`);
  console.log(`DX3rd | 되돌리기: node tools/migrate-packs.mjs --restore ${report.backup} --apply --confirm-live-pack`);
}
