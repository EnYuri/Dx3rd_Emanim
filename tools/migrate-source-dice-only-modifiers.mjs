#!/usr/bin/env node
// 비공개 재빌드 오버라이드에 남은 전용 D10 보정 키를 일반 필드 수식으로 옮긴다.
// packs/가 배포 원본이지만, 향후 명시적 재빌드가 옛 키를 되살리지 않게 생성 원본도 맞춘다.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { convertedValue } from "./migrations/2026-08-11-dice-only-modifiers-to-formulas.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const write = process.argv.includes("--write");
if (write && !process.argv.includes("--confirm-source-overrides")) {
  console.error("DX3rd | --write에는 --confirm-source-overrides가 필요하다.");
  process.exit(2);
}

const FILES = [
  { path: "_source/item-mech-overrides.json", indent: 1 },
  { path: "_source/effect-mech-overrides.json", indent: 2 }
];
const CONVERSIONS = {
  damage_roll: "attack",
  guard_roll: "guard",
  reduce_roll: "reduce",
  dxroll: "add"
};
const DX_DICE = /(?:^|[^a-z0-9_])\d*\s*d\s*x\s*\d+(?=$|[^a-z0-9_])/i;

function convertedLabel(sourceKey, label) {
  return sourceKey === "damage_roll" && (label === "melee" || label === "ranged") ? label : "-";
}

function migrate(node, location, changes, failures) {
  if (!node || typeof node !== "object") return;
  if (!Array.isArray(node) && typeof node.key === "string" && Object.hasOwn(node, "value")) {
    if (DX_DICE.test(String(node.value ?? ""))) {
      failures.push(`${location}.value = ${JSON.stringify(node.value)}`);
      return;
    }
    const sourceKey = node.key;
    const targetKey = CONVERSIONS[sourceKey];
    if (targetKey) {
      const before = structuredClone(node);
      node.key = targetKey;
      node.label = convertedLabel(sourceKey, node.label);
      node.value = convertedValue(sourceKey, node.value);
      changes.push(`${location}: ${JSON.stringify(before)} -> ${JSON.stringify(node)}`);
    } else {
      const legacyLabelTarget = CONVERSIONS[node.label];
      if (legacyLabelTarget === sourceKey) {
        const before = structuredClone(node);
        node.label = "-";
        changes.push(`${location}: ${JSON.stringify(before)} -> ${JSON.stringify(node)}`);
      }
    }
  }
  for (const [key, value] of Object.entries(node)) {
    if (value && typeof value === "object") migrate(value, `${location}.${key}`, changes, failures);
  }
}

let total = 0;
for (const config of FILES) {
  const filename = path.join(ROOT, config.path);
  const source = fs.readFileSync(filename, "utf8");
  const data = JSON.parse(source);
  const changes = [];
  const failures = [];
  migrate(data, config.path, changes, failures);
  if (failures.length) {
    console.error(`DX3rd | ${config.path}: DX 수식 ${failures.length}건은 변환할 수 없다.`);
    for (const failure of failures) console.error(`  ${failure}`);
    process.exitCode = 1;
    continue;
  }
  total += changes.length;
  console.log(`DX3rd | ${config.path}: ${changes.length}행 ${write ? "변환" : "변환 예정"}`);
  for (const change of changes) console.log(`  ${change}`);
  if (write && changes.length) fs.writeFileSync(filename, `${JSON.stringify(data, null, config.indent)}\n`, "utf8");
}

if (process.exitCode) process.exit(process.exitCode);
console.log(`DX3rd | 합계 ${total}행 ${write ? "변환 완료" : "변환 예정"}`);
