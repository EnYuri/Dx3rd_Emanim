#!/usr/bin/env node
// Foundry 에서 손으로 고친 팩의 **표시 항목**(img / name / description / 폴더)을
// `_source/item-mech-overrides.json` 오버라이드로 회수한다.
//
// 왜 필요한가: `packs/` 는 빌드 산출물이다. `tools/release.ps1 -UpdatePacks` 는
// system.json 에 선언된 팩 디렉터리를 _source 재빌드 결과로 **통째로 교체**하므로,
// _source 에 표현되지 않은 손튜닝은 다음 빌드에서 조용히 사라진다.
// 기계화 필드는 이미 item-mech-overrides.json 이 받아 주지만 아이콘·표시명·폴더는
// 받아 줄 자리가 없었다(빌더가 `icons/svg/sword.svg` 를 하드코딩하고, 폴더는 CSV 섹션
// carry-forward 로 결정한다). 이 도구 + apply-overrides.mjs 의 `ov.img` / `ov.name` /
// `ov.folder` 지원이 그 구멍을 막는다.
//
// 사용:
//   node _source/build-items.mjs                       # 기준(빌드 산출 JSON) 갱신
//   node tools/extract-pack-presentation.mjs \
//        --pack "E:/FoundryVTT/Data/worlds/<world>/packs/<pack>" \
//        --name weapons [--write]
//
// --write 없이는 무엇이 회수될지만 출력한다(dry-run).
// 매칭은 이름이 아니라 `_id` 로 한다 — 이름 자체가 손튜닝 대상이기 때문이다.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

// 오버라이드 팩 이름 → _source 빌드 산출 디렉터리
const BUILT_DIR = {
  weapons: "pack-weapons",
  armors: "pack-armors",
  vehicles: "pack-vehicles",
  items: "pack-items",
  dlois: "pack-dlois",
};

function arg(flag, fallback = null) {
  const i = process.argv.indexOf(flag);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const packDir = arg("--pack");
const packName = arg("--name");
const write = process.argv.includes("--write");
if (!packDir || !packName) {
  console.error("usage: extract-pack-presentation.mjs --pack <levelDB dir> --name <weapons|armors|vehicles|items|dlois> [--write]");
  process.exit(2);
}
if (!BUILT_DIR[packName]) {
  console.error(`unknown pack name: ${packName} (${Object.keys(BUILT_DIR).join(", ")})`);
  process.exit(2);
}

// ---- 손튜닝된 실제 팩 읽기 ----
// Foundry 가 실행 중이면 LevelDB 가 잠겨 있다. 잠금은 LOCK 파일 하나이므로
// 팩을 임시 디렉터리로 복사한 뒤 읽는다(원본은 건드리지 않는 읽기 전용 경로).
const app = process.env.FOUNDRY_APP_PATH || "C:/Program Files/Foundry Virtual Tabletop/resources/app";
const classicLevelPath = path.join(app, "node_modules", "classic-level", "index.js");
if (!fs.existsSync(classicLevelPath)) {
  console.error(`Foundry 의 ClassicLevel 을 찾지 못했다: ${classicLevelPath} (FOUNDRY_APP_PATH 설정)`);
  process.exit(1);
}
const { ClassicLevel } = await import("file:///" + classicLevelPath.replace(/\\/g, "/"));

const tmp = fs.mkdtempSync(path.join(fs.realpathSync(process.env.TEMP || "/tmp"), "dx3rd-pack-"));
for (const f of fs.readdirSync(packDir)) {
  if (f === "LOCK") continue;
  fs.copyFileSync(path.join(packDir, f), path.join(tmp, f));
}
const db = new ClassicLevel(tmp, { valueEncoding: "json" });
const live = new Map();
const liveFolders = new Map();
for await (const [key, value] of db.iterator()) {
  if (key.startsWith("!folders!")) liveFolders.set(value._id, value);
  else live.set(value._id, value);
}
await db.close();
fs.rmSync(tmp, { recursive: true, force: true });

// 폴더 id → 이름 경로 배열. 폴더 id 는 빌드마다 재생성되므로 비교는 반드시 **이름 경로**로 한다.
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

// ---- 빌드 산출물(기준) 읽기 ----
const builtDir = path.join(ROOT, "_source", BUILT_DIR[packName]);
if (!fs.existsSync(builtDir)) {
  console.error(`빌드 산출 디렉터리가 없다: ${builtDir} (먼저 _source 빌더를 실행할 것)`);
  process.exit(1);
}
const built = new Map();
const builtFolders = new Map();
for (const f of fs.readdirSync(builtDir)) {
  if (!f.endsWith(".json")) continue;
  const d = JSON.parse(fs.readFileSync(path.join(builtDir, f), "utf8"));
  if (f.startsWith("_folder_")) builtFolders.set(d._id, d);
  else built.set(d._id, d);
}

// ---- 차이 회수 ----
const ovPath = path.join(ROOT, "_source", "item-mech-overrides.json");
const overrides = fs.existsSync(ovPath) ? JSON.parse(fs.readFileSync(ovPath, "utf8")) : {};
const bucket = (overrides[packName] ??= {});

let changed = 0, unmatched = 0;
const report = [];
for (const [id, b] of built) {
  const l = live.get(id);
  if (!l) { unmatched++; continue; }
  const entry = bucket[b.name] ? { ...bucket[b.name] } : {};
  const hits = [];
  if (l.img !== b.img) { entry.img = l.img; hits.push(`img ${b.img} -> ${l.img}`); }
  if (l.name !== b.name) { entry.name = l.name; hits.push(`name ${JSON.stringify(b.name)} -> ${JSON.stringify(l.name)}`); }
  const ld = l.system?.description ?? "", bd = b.system?.description ?? "";
  if (ld !== bd) { entry.description = ld; hits.push("description"); }
  const lf = folderPath(liveFolders, l.folder), bf = folderPath(builtFolders, b.folder);
  if (lf.join(" / ") !== bf.join(" / ")) {
    entry.folder = lf;
    hits.push(`folder ${bf.join(" / ") || "(루트)"} -> ${lf.join(" / ") || "(루트)"}`);
  }
  if (!hits.length) continue;
  changed++;
  report.push(`  ${b.name}: ${hits.join("; ")}`);
  bucket[b.name] = entry;
}

console.log(`DX3rd | ${packName}: 빌드 ${built.size}건 / 팩 ${live.size}건 / 회수 ${changed}건` + (unmatched ? ` / 팩에 없는 빌드 문서 ${unmatched}건` : ""));
for (const line of report) console.log(line);

if (!changed) process.exit(0);
if (!write) {
  console.log("\n(dry-run) --write 를 붙이면 _source/item-mech-overrides.json 에 기록한다.");
  process.exit(0);
}
fs.writeFileSync(ovPath, JSON.stringify(overrides, null, 2) + "\n", "utf8");
console.log(`\nDX3rd | wrote ${ovPath}`);
