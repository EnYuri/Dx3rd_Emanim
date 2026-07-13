#!/usr/bin/env node
/**
 * Narrow, reversible source migration for executable compendium dice formulas.
 *
 * Scope is intentionally limited to executable effect formula fields. It never
 * touches descriptions, macros, Foundry LevelDB packs, or world documents.
 * Run without --apply first; --apply writes only the listed JSON files.
 *
 * Usage:
 *   node tools/migrate-compendium-dice-formulas.mjs
 *   node tools/migrate-compendium-dice-formulas.mjs --apply
 */
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const effectsDirectory = join(root, "_source", "effects");
const apply = process.argv.slice(2).includes("--apply");
const reportPath = join(root, "tmp", `compendium-dice-migration-${apply ? "applied" : "dry-run"}-report.json`);
const unknownArgs = process.argv.slice(2).filter(arg => arg !== "--apply");
if (unknownArgs.length) throw new Error(`Unknown argument(s): ${unknownArgs.join(", ")}`);

function normalizeDiceFormula(value) {
  return String(value).replace(/(\d+\s*)?d\s*(\d+)/ig, (_match, count, sides) => {
    const normalizedCount = count ? count.replace(/\s/g, "") : "";
    return `${normalizedCount}d${sides}`;
  });
}

const changes = [];
for (const entry of readdirSync(effectsDirectory, { withFileTypes: true })) {
  if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
  const file = join(effectsDirectory, entry.name);
  const source = readFileSync(file, "utf8");
  const document = JSON.parse(source);
  const fields = [{
    field: "system.encroach.value",
    get: () => document.system?.encroach?.value,
    set: value => { document.system.encroach.value = value; }
  }];
  for (const [extensionType, extension] of Object.entries(document.flags?.["dx3rd-emanim"]?.itemExtend || {})) {
    for (const key of ["formulaDice", "formulaAdd", "encroachFixed", "hpCost"]) {
      fields.push({
        field: `flags.dx3rd-emanim.itemExtend.${extensionType}.${key}`,
        get: () => extension?.[key],
        set: value => { extension[key] = value; }
      });
    }
  }
  for (const candidate of fields) {
    const before = candidate.get();
    if (typeof before !== "string") continue;
    const after = normalizeDiceFormula(before);
    if (before === after) continue;
    // The normalizer is only permitted to change actual dice notation.
    if (!/(?:\d+\s*)?d\s*\d+/i.test(before)) throw new Error(`Unexpected non-dice change: ${file}`);
    changes.push({
      source: relative(root, file), name: document.name, id: document._id,
      field: candidate.field, before, after, document, set: candidate.set
    });
  }
}

const report = {
  generatedAt: new Date().toISOString(),
  mode: apply ? "apply" : "dry-run",
  scope: "effect system.encroach.value and flags.dx3rd-emanim.itemExtend formula fields only",
  changeCount: changes.length,
  changes: changes.map(({ document, set, ...change }) => change)
};
mkdirSync(dirname(reportPath), { recursive: true });
writeFileSync(reportPath, JSON.stringify(report, null, 2) + "\n", "utf8");

if (apply) {
  for (const change of changes) {
    change.set(change.after);
    // Existing source files are formatted JSON; preserving their 2-space layout
    // keeps this mechanical migration reviewable in Git.
    writeFileSync(join(root, change.source), JSON.stringify(change.document, null, 2) + "\n", "utf8");
  }
}

console.log(`DX3rd | ${apply ? "applied" : "dry-run"}: ${changes.length} executable dice formulas`);
console.log(`DX3rd | report: ${relative(root, reportPath)}`);
if (!apply) console.log("DX3rd | re-run with --apply only after reviewing the report.");
