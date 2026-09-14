#!/usr/bin/env node
// Read the effects pack through a temporary copy so merely auditing it does not
// rotate the live LevelDB files.

import {
  copyFileSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  effectLimitCategory,
  syndromeFolderIds,
} from "./migrations/2026-09-10-syndrome-effect-limit-order.mjs";
import {
  servantEffectFolderId,
  servantLimitCategory,
} from "./migrations/2026-09-10-remaining-effect-limit-order.mjs";

const root = resolve(import.meta.dirname, "..");
const packDir = join(root, "packs", "effects");
const app = process.env.FOUNDRY_APP_PATH || "C:/Program Files/Foundry Virtual Tabletop/resources/app";
const readerPath = join(app, "node_modules", "classic-level", "index.js");

if (!existsSync(readerPath)) {
  console.error(`DX3rd | Foundry 의 ClassicLevel 을 찾지 못했다: ${readerPath}`);
  process.exit(3);
}

const { ClassicLevel } = await import(pathToFileURL(readerPath).href);
const tmp = mkdtempSync(join(realpathSync(process.env.TEMP), "dx3rd-effect-sort-"));
const docs = [];
const folders = [];

try {
  for (const file of readdirSync(packDir)) {
    if (file !== "LOCK") copyFileSync(join(packDir, file), join(tmp, file));
  }
  const db = new ClassicLevel(tmp, { valueEncoding: "json" });
  for await (const [key, value] of db.iterator()) {
    if (key.startsWith("!folders!")) folders.push(value);
    else if (key.startsWith("!items!")) docs.push(value);
  }
  await db.close();
} finally {
  rmSync(tmp, { recursive: true, force: true });
}

const childFolderIds = new Set(folders.map(folder => folder.folder).filter(Boolean));
const leaves = folders.filter(folder => !childFolderIds.has(folder._id));
const scopedLeaves = process.argv.includes("--syndromes")
  ? leaves.filter(folder => syndromeFolderIds.has(folder._id))
  : process.argv.includes("--remaining")
    ? leaves.filter(folder => !syndromeFolderIds.has(folder._id))
    : leaves;
const scopedFolderIds = new Set(scopedLeaves.map(folder => folder._id));
const folderById = new Map(folders.map(folder => [folder._id, folder]));
const folderPath = folder => {
  const names = [];
  for (let cursor = folder; cursor; cursor = folderById.get(cursor.folder)) names.unshift(cursor.name);
  return names.join(" / ");
};
const normalize = value => String(value ?? "").trim();
const category = (limit, folderId) => {
  if (folderId === servantEffectFolderId) return servantLimitCategory(limit);
  if (normalize(limit) === "효과참조") return 0;
  return effectLimitCategory(limit);
};

const distinct = new Map();
for (const doc of docs.filter(doc => scopedFolderIds.has(doc.folder))) {
  const limit = normalize(doc.system?.limit);
  distinct.set(limit, (distinct.get(limit) || 0) + 1);
}

let misplaced = 0;
let leafDocs = 0;
for (const folder of scopedLeaves.sort((a, b) => folderPath(a).localeCompare(folderPath(b), "ko"))) {
  const children = docs
    .filter(doc => doc.folder === folder._id)
    .sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0) || a.name.localeCompare(b.name, "ko"));
  leafDocs += children.length;
  let maxCategory = -1;
  const violations = [];
  const folderLimits = new Map();
  for (const doc of children) {
    const limit = normalize(doc.system?.limit) || "(없음)";
    folderLimits.set(limit, (folderLimits.get(limit) || 0) + 1);
    const current = category(doc.system?.limit, folder._id);
    if (current < maxCategory) violations.push(doc);
    maxCategory = Math.max(maxCategory, current);
  }
  if (process.argv.includes("--all-summary")) {
    console.log(`${folderPath(folder)} (${children.length}건): ${[...folderLimits].map(([limit, count]) => `${limit}×${count}`).join(", ") || "(비어 있음)"}`);
  }
  if (violations.length) {
    misplaced += violations.length;
    console.log(`\n${folderPath(folder)} (${children.length}건, 역순 ${violations.length}건)`);
    if (!process.argv.includes("--summary")) {
      for (const doc of children) {
        console.log(`  ${String(doc.sort ?? 0).padStart(8)}  [${normalize(doc.system?.limit) || "(없음)"}]  ${doc.name}  ${doc._id}`);
      }
    }
  }
}

if (process.argv.includes("--folders")) {
  console.log("\nDX3rd | 최하위 폴더 ID");
  for (const folder of scopedLeaves) console.log(`  ${folder._id}  ${folderPath(folder)}`);
}

console.log("\nDX3rd | 제한값 집계");
for (const [limit, count] of [...distinct].sort((a, b) => category(a[0]) - category(b[0]) || a[0].localeCompare(b[0], "ko"))) {
  console.log(`  ${String(count).padStart(4)}  ${limit || "(빈 값)"}`);
}
console.log(`DX3rd | 감사 폴더 ${scopedLeaves.length}개, 소속 이펙트 ${leafDocs}건 (팩 전체 ${docs.length}건), 현재 그룹 역순 ${misplaced}건`);
process.exitCode = misplaced ? 1 : 0;
