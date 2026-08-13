#!/usr/bin/env node
// 전용 D10 보정 필드 마이그레이션을 직전 백업과 현재 시스템 팩 사이에서 독립 검증한다.
// LevelDB는 여는 것만으로 파일이 회전할 수 있으므로 양쪽 모두 임시 복사본만 연다.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const argv = process.argv.slice(2);
const value = (name) => {
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] : null;
};
const backupArg = value("--backup");
const verbose = argv.includes("--verbose");
if (!backupArg) {
  console.error("usage: node tools/audit-dice-only-modifier-migration.mjs --backup dist/pack-backups/<timestamp>");
  process.exit(2);
}

const backupRoot = path.resolve(ROOT, backupArg);
if (!fs.existsSync(backupRoot)) {
  console.error(`DX3rd | 백업을 찾을 수 없다: ${backupRoot}`);
  process.exit(2);
}

const foundryRoot = process.env.FOUNDRY_APP_PATH || "C:/Program Files/Foundry Virtual Tabletop/resources/app";
const classicLevelPath = path.join(foundryRoot, "node_modules", "classic-level", "index.js");
if (!fs.existsSync(classicLevelPath)) {
  console.error(`DX3rd | Foundry ClassicLevel을 찾을 수 없다: ${classicLevelPath}`);
  process.exit(3);
}
const { ClassicLevel } = await import(pathToFileURL(classicLevelPath).href);
const peggyPath = path.join(foundryRoot, "node_modules", "peggy", "lib", "peg.js");
const grammarPath = path.join(foundryRoot, "client", "dice", "grammar.pegjs");
const peggy = await import(pathToFileURL(peggyPath).href);
const rollGrammar = peggy.default.generate(fs.readFileSync(grammarPath, "utf8"));
class SyntaxOnlyRollParser {
  constructor() {
    return new Proxy(this, {
      get: (target, property) => property in target ? target[property] : (...args) => ({ property, args })
    });
  }
}

const DEDICATED = {
  damage_roll: { target: "attack", alwaysCount: true },
  guard_roll: { target: "guard", alwaysCount: false },
  reduce_roll: { target: "reduce", alwaysCount: false },
  dxroll: { target: "add", alwaysCount: false }
};
const STANDARD_DICE = /(?:^|[^a-z0-9_])\d*\s*d\s*\d+(?=$|[^a-z0-9_])/i;
const DX_DICE = /(?:^|[^a-z0-9_])\d*\s*d\s*x\s*\d+(?=$|[^a-z0-9_])/i;
const MAPS = ["system.attributes", "system.effect.attributes"];

function getPath(object, dotted) {
  return dotted.split(".").reduce((current, key) => current?.[key], object);
}

function expectedValue(sourceKey, value) {
  const raw = String(value ?? "").trim();
  if (!raw || raw === "-") return raw;
  if (Number(raw) === 0) return "0";
  if (!DEDICATED[sourceKey].alwaysCount && STANDARD_DICE.test(raw)) return raw;
  return `(${raw})d10`;
}

function expectedLabel(sourceKey, label) {
  return sourceKey === "damage_roll" && (label === "melee" || label === "ranged") ? label : "-";
}

async function readCopiedDb(source) {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "dx3rd-dice-audit-"));
  try {
    for (const entry of fs.readdirSync(source)) {
      if (entry === "LOCK") continue;
      fs.cpSync(path.join(source, entry), path.join(temp, entry), { recursive: true });
    }
    const db = new ClassicLevel(temp, { valueEncoding: "json" });
    const documents = new Map();
    for await (const [key, document] of db.iterator()) documents.set(key, document);
    await db.close();
    return documents;
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
}

function describe(pack, key, doc, mapPath, rowId) {
  return `${pack}/${doc?.name ?? "(이름 없음)"} [${key}] ${mapPath}.${rowId}`;
}

function walkModifierRows(node, prefix = "system", seen = new Set()) {
  const rows = [];
  if (!node || typeof node !== "object" || seen.has(node)) return rows;
  seen.add(node);
  if (!Array.isArray(node) && typeof node.key === "string" && Object.hasOwn(node, "value")) {
    rows.push({ path: prefix, row: node });
  }
  for (const [key, value] of Object.entries(node)) {
    if (value && typeof value === "object") rows.push(...walkModifierRows(value, `${prefix}.${key}`, seen));
  }
  return rows;
}

function walkLegacyStrings(node, prefix = "", seen = new Set()) {
  const findings = [];
  if (typeof node === "string") {
    for (const key of Object.keys(DEDICATED)) {
      if (node.includes(key)) findings.push({ path: prefix, key, value: node });
    }
    return findings;
  }
  if (!node || typeof node !== "object" || seen.has(node)) return findings;
  seen.add(node);
  for (const [key, value] of Object.entries(node)) {
    findings.push(...walkLegacyStrings(value, prefix ? `${prefix}.${key}` : key, seen));
  }
  return findings;
}

const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, "system.json"), "utf8"));
const allPacks = manifest.packs.map((pack) => pack.name);
const backedPacks = fs.readdirSync(backupRoot)
  .filter((name) => fs.statSync(path.join(backupRoot, name)).isDirectory())
  .sort();

const errors = [];
const warnings = [];
const counts = Object.fromEntries(Object.keys(DEDICATED).map((key) => [key, 0]));
const packCounts = new Map();
const values = Object.fromEntries(Object.keys(DEDICATED).map((key) => [key, new Map()]));
const labels = Object.fromEntries(Object.keys(DEDICATED).map((key) => [key, new Map()]));
const transitions = [];
let comparedDocuments = 0;
let convertedRows = 0;
let normalizedLegacyLabels = 0;
let syntaxChecks = 0;

for (const pack of backedPacks) {
  const before = await readCopiedDb(path.join(backupRoot, pack));
  const after = await readCopiedDb(path.join(ROOT, "packs", pack));
  const localCounts = Object.fromEntries(Object.keys(DEDICATED).map((key) => [key, 0]));

  for (const [key, original] of before) {
    const current = after.get(key);
    if (!current) {
      errors.push(`${pack}: 백업 문서가 현재 팩에서 사라졌다: ${key} (${original?.name ?? "이름 없음"})`);
      continue;
    }
    comparedDocuments++;
    const expected = structuredClone(original);

    for (const found of walkModifierRows(original.system)) {
      if (DEDICATED[found.row.key] && !MAPS.some((mapPath) => found.path.startsWith(`${mapPath}.`))) {
        errors.push(`${pack}/${original?.name ?? "(이름 없음)"} [${key}] ${found.path}: 변환 대상 전용 키가 감사·마이그레이션 대표 경로 밖에 있다 (${found.row.key})`);
      }
      if (DX_DICE.test(String(found.row.value ?? "")) && !MAPS.some((mapPath) => found.path.startsWith(`${mapPath}.`))) {
        warnings.push(`${pack}/${original?.name ?? "(이름 없음)"} [${key}] ${found.path}: 대표 경로 밖 보정값에 DX 수식 ${JSON.stringify(found.row.value)}`);
      }
    }

    for (const mapPath of MAPS) {
      const originalMap = getPath(original, mapPath);
      const expectedMap = getPath(expected, mapPath);
      if (!originalMap || typeof originalMap !== "object" || Array.isArray(originalMap)) continue;
      for (const [rowId, originalRow] of Object.entries(originalMap)) {
        if (!originalRow || typeof originalRow !== "object" || Array.isArray(originalRow)) continue;
        const sourceKey = originalRow.key;
        if (DX_DICE.test(String(originalRow.value ?? ""))) {
          warnings.push(`${describe(pack, key, original, mapPath, rowId)}: 원본 보정값에 DX 수식 ${JSON.stringify(originalRow.value)}`);
        }
        if (!DEDICATED[sourceKey]) {
          if (DEDICATED[originalRow.label]?.target === sourceKey) {
            expectedMap[rowId].label = "-";
            normalizedLegacyLabels++;
            transitions.push({
              pack, name: original.name, type: original.type, key, mapPath, rowId,
              before: structuredClone(originalRow), after: structuredClone(expectedMap[rowId])
            });
          }
          continue;
        }

        convertedRows++;
        counts[sourceKey]++;
        localCounts[sourceKey]++;
        const raw = JSON.stringify(originalRow.value);
        values[sourceKey].set(raw, (values[sourceKey].get(raw) ?? 0) + 1);
        const label = JSON.stringify(originalRow.label);
        labels[sourceKey].set(label, (labels[sourceKey].get(label) ?? 0) + 1);

        expectedMap[rowId].key = DEDICATED[sourceKey].target;
        expectedMap[rowId].value = expectedValue(sourceKey, originalRow.value);
        expectedMap[rowId].label = expectedLabel(sourceKey, originalRow.label);
        transitions.push({
          pack, name: original.name, type: original.type, key, mapPath, rowId,
          before: structuredClone(originalRow), after: structuredClone(expectedMap[rowId])
        });

        // 레벨 참조가 실제 값으로 치환된 뒤에도 Foundry v14 Roll 문법에 맞는지 검사한다.
        // 0·1·3·10은 0다이스 경계, 통상 레벨, 고레벨 산술식을 함께 덮는다.
        for (const level of [0, 1, 3, 10]) {
          const formula = String(expectedMap[rowId].value).replace(/\[(?:level|lv|레벨)\]/gi, String(level));
          try {
            rollGrammar.parse(formula, { parser: SyntaxOnlyRollParser });
            syntaxChecks++;
          } catch (error) {
            errors.push(`${describe(pack, key, original, mapPath, rowId)}: 레벨 ${level}에서 Roll 문법 오류 ${JSON.stringify(formula)} (${error.message})`);
          }
        }
      }
    }

    if (JSON.stringify(expected) !== JSON.stringify(current)) {
      for (const mapPath of MAPS) {
        const originalMap = getPath(original, mapPath) ?? {};
        const expectedMap = getPath(expected, mapPath) ?? {};
        const currentMap = getPath(current, mapPath) ?? {};
        for (const rowId of new Set([...Object.keys(originalMap), ...Object.keys(expectedMap), ...Object.keys(currentMap)])) {
          if (JSON.stringify(expectedMap[rowId]) !== JSON.stringify(currentMap[rowId])) {
            errors.push(`${describe(pack, key, original, mapPath, rowId)}: 기대 ${JSON.stringify(expectedMap[rowId])}, 현재 ${JSON.stringify(currentMap[rowId])}`);
          }
        }
      }
      const shallowExpected = structuredClone(expected);
      const shallowCurrent = structuredClone(current);
      for (const mapPath of MAPS) {
        const [root, group, leaf] = mapPath.split(".");
        if (leaf) {
          if (shallowExpected[root]?.[group]) delete shallowExpected[root][group][leaf];
          if (shallowCurrent[root]?.[group]) delete shallowCurrent[root][group][leaf];
        } else {
          if (shallowExpected[root]) delete shallowExpected[root][group];
          if (shallowCurrent[root]) delete shallowCurrent[root][group];
        }
      }
      if (JSON.stringify(shallowExpected) !== JSON.stringify(shallowCurrent)) {
        errors.push(`${pack}/${original?.name ?? "(이름 없음)"} [${key}]: 보정 맵 밖의 예상하지 못한 문서 변경`);
      }
    }
  }
  for (const [key, current] of after) {
    if (!before.has(key)) errors.push(`${pack}: 백업에 없던 문서가 현재 팩에 생겼다: ${key} (${current?.name ?? "이름 없음"})`);
  }
  packCounts.set(pack, localCounts);
}

let liveRows = 0;
let remainingDedicated = 0;
let liveDx = 0;
let liveLegacyStrings = 0;
for (const pack of allPacks) {
  const dir = path.join(ROOT, "packs", pack);
  if (!fs.existsSync(dir)) continue;
  const documents = await readCopiedDb(dir);
  for (const [key, doc] of documents) {
    for (const found of walkLegacyStrings(doc)) {
      liveLegacyStrings++;
      errors.push(`${pack}/${doc?.name ?? "(이름 없음)"} [${key}] ${found.path}: 전용 키 문자열 ${found.key}가 남아 있다 (${JSON.stringify(found.value).slice(0, 180)})`);
    }
    for (const found of walkModifierRows(doc.system)) {
      liveRows++;
      if (DEDICATED[found.row.key]) {
        remainingDedicated++;
        errors.push(`${pack}/${doc?.name ?? "(이름 없음)"} [${key}] ${found.path}: 전용 키 ${found.row.key}가 남아 있다`);
      }
      if (DX_DICE.test(String(found.row.value ?? ""))) {
        liveDx++;
        errors.push(`${pack}/${doc?.name ?? "(이름 없음)"} [${key}] ${found.path}: 보정값에 DX 수식 ${JSON.stringify(found.row.value)}`);
      }
    }
  }
}

console.log(`DX3rd | 백업 대조: ${backedPacks.length}개 팩, ${comparedDocuments}개 문서, ${convertedRows}개 변환 행, 옛 라벨 정규화 ${normalizedLegacyLabels}개`);
for (const pack of backedPacks) {
  const summary = Object.entries(packCounts.get(pack)).filter(([, count]) => count).map(([key, count]) => `${key} ${count}`).join(", ");
  console.log(`  ${pack}: ${summary || "변환 행 없음"}`);
}
console.log("DX3rd | 원본 키별 합계: " + Object.entries(counts).map(([key, count]) => `${key} ${count}`).join(", "));
for (const key of Object.keys(DEDICATED)) {
  const valueSummary = [...values[key]].map(([raw, count]) => `${raw}×${count}`).join(", ") || "없음";
  const labelSummary = [...labels[key]].map(([raw, count]) => `${raw}×${count}`).join(", ") || "없음";
  console.log(`  ${key} 값: ${valueSummary}`);
  console.log(`  ${key} 라벨: ${labelSummary}`);
}
console.log(`DX3rd | 현재 전체 팩 보정 행 ${liveRows}개: 남은 전용 키 ${remainingDedicated}개, DX 수식 ${liveDx}개`);
console.log(`DX3rd | 현재 전체 팩의 모든 문자열: 전용 키 원문 ${liveLegacyStrings}개`);
console.log(`DX3rd | Foundry v14 Roll 문법 검사: ${syntaxChecks}/${convertedRows * 4} 통과`);

if (verbose) {
  console.log("DX3rd | 전체 변환 행:");
  for (const row of transitions.sort((a, b) =>
    a.pack.localeCompare(b.pack) || a.name.localeCompare(b.name) || a.rowId.localeCompare(b.rowId))) {
    console.log(`  ${row.pack}\t${row.type}\t${row.name}\t${row.mapPath}.${row.rowId}\t${JSON.stringify(row.before)} -> ${JSON.stringify(row.after)}`);
  }
}

for (const warning of warnings) console.warn(`경고: ${warning}`);
for (const error of errors) console.error(`오류: ${error}`);
if (warnings.length || errors.length) {
  console.error(`DX3rd | 감사 실패: 오류 ${errors.length}건, 경고 ${warnings.length}건`);
  process.exit(1);
}
console.log("DX3rd | 감사 통과: 누락·오기·오표기·예상 밖 변경 없음");
