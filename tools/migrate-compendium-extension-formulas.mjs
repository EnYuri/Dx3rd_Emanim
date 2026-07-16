#!/usr/bin/env node
/**
 * Migrate HP heal/damage extension formulas in private compendium overrides.
 *
 * Older data split a formula between `formulaDice` (a number of d10s) and
 * `formulaAdd` (a numeric expression).  The extension UI now has one Foundry
 * Roll formula field, stored in `formulaAdd`.  This migration folds the former
 * into the latter and removes `formulaDice`.
 *
 * Usage:
 *   node tools/migrate-compendium-extension-formulas.mjs
 *   node tools/migrate-compendium-extension-formulas.mjs --apply
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sourceFiles = [
  join(root, "_source", "effect-mech-overrides.json"),
  join(root, "_source", "item-mech-overrides.json")
];
const apply = process.argv.slice(2).includes("--apply");
const unknownArgs = process.argv.slice(2).filter(arg => arg !== "--apply");
if (unknownArgs.length) throw new Error(`Unknown argument(s): ${unknownArgs.join(", ")}`);

function hasDice(formula) {
  return /(?:\d+\s*)?d\s*\d+/i.test(formula);
}

function legacyDiceTerm(value) {
  const formula = String(value ?? "").trim();
  if (!formula || formula === "0") return "";
  // formulaDice used to mean a d10 count.  Some manually edited values already
  // contain dice notation, which is now valid as-is in the unified field.
  if (hasDice(formula)) return formula;
  // Keep simple numeric/token counts readable; compound counts need grouping
  // before the d10 denominator.
  return /^[\d\s]+$|^\[[^\]]+\]$/.test(formula) ? `${formula}d10` : `(${formula})d10`;
}

function mergeFormula(dice, add) {
  const terms = [];
  const diceTerm = legacyDiceTerm(dice);
  if (diceTerm) terms.push(diceTerm);
  const addFormula = String(add ?? "").trim();
  // Do not alter a formula that was already wholly stored in the canonical
  // field; that keeps this migration mechanical and reviewable.
  if (addFormula && addFormula !== "0") terms.push(diceTerm ? `(${addFormula})` : addFormula);
  return terms.join(" + ") || "0";
}

function visit(value, path, changes, source) {
  if (!value || typeof value !== "object") return;
  if (value.itemExtend && typeof value.itemExtend === "object") {
    for (const type of ["heal", "damage"]) {
      const extension = value.itemExtend[type];
      if (!extension || typeof extension !== "object" || !("formulaDice" in extension)) continue;
      const beforeDice = extension.formulaDice;
      const beforeAdd = extension.formulaAdd;
      const after = mergeFormula(beforeDice, beforeAdd);
      changes.push({
        source: relative(root, source),
        path: [...path, "itemExtend", type].join("."),
        type,
        formulaDice: beforeDice,
        formulaAdd: beforeAdd,
        formula: after,
        extension
      });
    }
  }
  for (const [key, entry] of Object.entries(value)) {
    if (key !== "itemExtend") visit(entry, [...path, key], changes, source);
  }
}

const changes = [];
const documents = sourceFiles.map(source => {
  const document = JSON.parse(readFileSync(source, "utf8"));
  visit(document, [], changes, source);
  return { source, document };
});

const report = {
  generatedAt: new Date().toISOString(),
  mode: apply ? "apply" : "dry-run",
  scope: "HP heal/damage extensions in private compendium override sources only",
  changeCount: changes.length,
  changes: changes.map(({ extension, ...change }) => change)
};
const reportPath = join(root, "tmp", `compendium-extension-formula-migration-${apply ? "applied" : "dry-run"}-report.json`);
mkdirSync(dirname(reportPath), { recursive: true });
writeFileSync(reportPath, JSON.stringify(report, null, 2) + "\n", "utf8");

if (apply) {
  for (const change of changes) {
    change.extension.formulaAdd = change.formula;
    delete change.extension.formulaDice;
  }
  for (const { source, document } of documents) {
    writeFileSync(source, JSON.stringify(document, null, 2) + "\n", "utf8");
  }
}

console.log(`DX3rd | ${apply ? "applied" : "dry-run"}: ${changes.length} HP extension formulas`);
console.log(`DX3rd | report: ${relative(root, reportPath)}`);
if (!apply) console.log("DX3rd | re-run with --apply only after reviewing the report.");
