#!/usr/bin/env node
/**
 * 문서 스키마 커버리지 감사 — 저장된 데이터 중 선언에 없는 경로를 찾는다.
 *
 * template.json 은 선언에 없는 키도 보존했지만 그 대체인 DataModel 은 **지운다**. 그래서
 * 시트나 코드가 새 필드를 저장하기 시작했는데 `scripts/data/document-schema.js` 에 선언을
 * 빠뜨리면, 저장은 되는 것처럼 보이고 다음 로드에서 사라진다. 이 도구는 라이브 데이터를
 * 훑어 그 상태를 잡아낸다.
 *
 *   node tools/audit-schema-coverage.mjs                 # packs/ 만
 *   node tools/audit-schema-coverage.mjs --worlds        # 이 시스템을 쓰는 월드까지
 *
 * 읽기 전용이다. 팩은 임시 복사본에서 읽으므로 Foundry 실행 중에도 안전하고 워킹 트리를
 * 더럽히지 않는다(LevelDB 는 열기만 해도 로그가 회전한다).
 *
 * 종료 코드: 0 = 미선언 경로 없음, 1 = 발견(또는 읽기 실패), 3 = LevelDB 리더 없음.
 */
import { existsSync, mkdtempSync, copyFileSync, readdirSync, readFileSync, rmSync, realpathSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import process from "node:process";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const withWorlds = process.argv.includes("--worlds");

// 죽은 필드. 스키마가 일부러 선언하지 않고 정리 단계에서 떨구는 것들이다.
const DEAD = [
  /^system(\.|$)/, /^name$/, /^type$/, /^img$/, /^items$/, /^effects$/,
  /^conditions\.(lostHP|healing)(\.|$)/, /^roll-check$/
];

function loadSchema() {
  const sandbox = {};
  new Function("window", "Hooks", readFileSync(join(root, "scripts", "data", "document-schema.js"), "utf8"))(
    sandbox, { once() {} }
  );
  return sandbox.DX3rdDocumentSchema;
}

const schema = loadSchema();

function mergedDefaults(kind, type) {
  const def = schema[kind]?.[type];
  if (!def) return null;
  const out = {};
  for (const name of def.templates || []) Object.assign(out, structuredClone(schema[kind].templates[name] || {}));
  for (const [key, value] of Object.entries(def)) if (key !== "templates") out[key] = structuredClone(value);
  return out;
}

/** 선언된 경로 집합과, 하위가 자유인 접두(빈 객체 = ObjectField, 채널의 buckets) 집합. */
const declaredCache = new Map();
function declaredFor(kind, type) {
  const key = `${kind}.${type}`;
  if (declaredCache.has(key)) return declaredCache.get(key);
  const defaults = mergedDefaults(kind, type);
  if (!defaults) { declaredCache.set(key, null); return null; }
  const paths = new Set(), open = new Set();
  (function walk(node, prefix, depth) {
    for (const [k, v] of Object.entries(node)) {
      const p = prefix ? `${prefix}.${k}` : k;
      paths.add(p);
      // 자기/대상 채널에는 선택 버킷이 붙는다(document-schema.js 의 toField 참조).
      if (kind === "Item" && depth === 0 && (k === "active" || k === "effect")) open.add(`${p}.buckets`);
      if (v && typeof v === "object" && !Array.isArray(v)) {
        if (Object.keys(v).length === 0) open.add(p);
        else walk(v, p, depth + 1);
      }
    }
  })(defaults, "", 0);
  const result = { paths, open };
  declaredCache.set(key, result);
  return result;
}

// ── 정적 검사: 코드/템플릿이 저작하는 system.* 경로 ─────────────────────────────
//
// 아래 라이브 데이터 감사는 **이미 저장된** 것만 본다. 그래서 「기능은 있는데 아직 아무도
// 안 쓴」 경로는 잡지 못한다 — 실제로 `book.spells`(마법서 스펠 등재), `spell.roll`(캐스팅
// 판정), `connection.macro` 셋이 그렇게 빠져 있었다. template.json 은 미선언 키를 보존해
// 줘서 동작했고, DataModel 로 옮기는 순간 조용히 사라질 뻔했다. 그래서 소스에서 저작 경로를
// 직접 긁어 어느 타입에도 선언되지 않은 것을 잡는다.
const STATIC_IGNORE = new Set([
  'changes',        // ActiveEffect 문서의 필드(v14 base AE 데이터모델). Actor/Item 스키마와 무관.
  'conditions.x'    // runtime-utils.js 주석의 예시 표기.
]);

function auditStaticPaths() {
  const declared = [];
  for (const kind of ['Actor', 'Item']) for (const type of schema[kind].types) {
    const d = declaredFor(kind, type);
    if (d) declared.push(d);
  }
  const isDeclared = (p) => declared.some(d =>
    d.paths.has(p) || [...d.open].some(o => p === o || p.startsWith(`${o}.`)));

  const files = [];
  (function walk(dir) {
    if (!existsSync(dir)) return;
    for (const f of readdirSync(dir)) {
      const p = join(dir, f);
      if (statSync(p).isDirectory()) walk(p);
      else if ((f.endsWith('.js') || f.endsWith('.html')) && !p.includes('document-schema')) files.push(p);
    }
  })(join(root, 'scripts'));
  (function walk(dir) {
    if (!existsSync(dir)) return;
    for (const f of readdirSync(dir)) {
      const p = join(dir, f);
      if (statSync(p).isDirectory()) walk(p);
      else if (f.endsWith('.html')) files.push(p);
    }
  })(join(root, 'templates'));

  const hits = new Map();
  for (const file of files) {
    const src = readFileSync(file, 'utf8');
    const paths = new Set();
    for (const m of src.matchAll(/name\s*=\s*"(system\.[^"{}]*)"/g)) paths.add(m[1].slice(7));   // 폼 입력
    for (const m of src.matchAll(/['"`](system\.[A-Za-z0-9_.\-]+)['"`]\s*:/g)) paths.add(m[1].slice(7)); // update()
    for (const p of paths) {
      if (!p || p.endsWith('.') || p.includes('[') || STATIC_IGNORE.has(p) || isDeclared(p)) continue;
      if (!hits.has(p)) hits.set(p, new Set());
      hits.get(p).add(file.slice(root.length + 1).replace(/\\/g, '/'));
    }
  }
  return hits;
}

const staticHits = auditStaticPaths();
console.log(`DX3rd | 정적 검사: 소스가 저작하는 system.* 경로 중 미선언 ${staticHits.size}건`);
for (const [p, files] of staticHits) {
  console.log(`  system.${p}\n      ${[...files].join('\n      ')}`);
}

const findings = new Map();
let checked = 0;

function audit(kind, doc, where) {
  const declared = declaredFor(kind, doc.type);
  if (!declared) return; // 다른 패키지가 제공하는 서브타입
  checked++;
  (function walk(node, prefix, depth) {
    if (depth > 8) return;
    for (const [k, v] of Object.entries(node ?? {})) {
      const p = prefix ? `${prefix}.${k}` : k;
      if (declared.paths.has(p)) {
        if (v && typeof v === "object" && !Array.isArray(v)) walk(v, p, depth + 1);
        continue;
      }
      let covered = false;
      for (const o of declared.open) if (p === o || p.startsWith(`${o}.`)) { covered = true; break; }
      if (covered || DEAD.some(r => r.test(p))) continue;
      const key = `${kind} ${doc.type} | ${p}`;
      const entry = findings.get(key) || { n: 0, where: new Set(), samples: new Set() };
      entry.n++;
      entry.where.add(where);
      if (entry.samples.size < 3) entry.samples.add(JSON.stringify(v)?.slice(0, 60));
      findings.set(key, entry);
      if (v && typeof v === "object" && !Array.isArray(v)) walk(v, p, depth + 1);
    }
  })(doc.system, "", 0);
}

// ── LevelDB ────────────────────────────────────────────────────────────────────
const app = process.env.FOUNDRY_APP_PATH || "C:/Program Files/Foundry Virtual Tabletop/resources/app";
const readerPath = join(app, "node_modules", "classic-level", "index.js");
if (!existsSync(readerPath)) {
  console.error(`DX3rd | Foundry 의 ClassicLevel 을 찾지 못했다: ${readerPath} (FOUNDRY_APP_PATH 설정)`);
  process.exit(staticHits.size ? 1 : 3); // 정적 검사 결과는 리더가 없어도 유효하다

}
const { ClassicLevel } = await import("file:///" + readerPath.replace(/\\/g, "/"));

async function eachDoc(dir, fn) {
  const tmp = mkdtempSync(join(realpathSync(process.env.TEMP || "/tmp"), "dx3rd-audit-"));
  try {
    for (const f of readdirSync(dir)) if (f !== "LOCK") copyFileSync(join(dir, f), join(tmp, f));
    const db = new ClassicLevel(tmp, { valueEncoding: "json" });
    for await (const [key, value] of db.iterator()) fn(key, value);
    await db.close();
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

const manifest = JSON.parse(readFileSync(join(root, "system.json"), "utf8"));
for (const pack of manifest.packs ?? []) {
  const dir = join(root, pack.path);
  if (!existsSync(dir)) continue;
  await eachDoc(dir, (key, doc) => { if (!key.startsWith("!folders!")) audit(pack.type, doc, `pack:${pack.name}`); });
}

if (withWorlds) {
  const worldRoot = resolve(root, "..", "..", "worlds");
  for (const name of existsSync(worldRoot) ? readdirSync(worldRoot) : []) {
    const base = join(worldRoot, name);
    if (!statSync(base).isDirectory()) continue;
    let world;
    try { world = JSON.parse(readFileSync(join(base, "world.json"), "utf8")); } catch { continue; }
    if (world.system !== manifest.id) continue;
    for (const collection of ["actors", "items"]) {
      const dir = join(base, "data", collection);
      if (!existsSync(dir) || !statSync(dir).isDirectory()) continue;
      // 임베드 아이템은 `!actors.items!<액터>.<아이템>` 키로 따로 저장된다.
      await eachDoc(dir, (key, doc) => {
        if (key.startsWith("!folders!")) return;
        if (key.startsWith("!actors.items!") || key.startsWith("!items!")) audit("Item", doc, name);
        else if (key.startsWith("!actors!")) audit("Actor", doc, name);
      });
    }
  }
}

console.log(`DX3rd | 스키마 커버리지 감사: ${checked}개 문서${withWorlds ? " (팩 + 월드)" : " (팩)"}`);
if (!findings.size) {
  console.log("DX3rd | 미선언 저장 경로 없음");
  process.exit(staticHits.size ? 1 : 0);
}
console.log("\n선언에 없는 저장 경로 — scripts/data/document-schema.js 에 추가하지 않으면 다음 로드에서 사라진다:");
for (const [key, entry] of [...findings].sort((a, b) => b[1].n - a[1].n)) {
  console.log(`  ${String(entry.n).padStart(5)}  ${key}  예: ${[...entry.samples].join(" / ")}  [${[...entry.where].join(", ")}]`);
}
process.exit(1);
