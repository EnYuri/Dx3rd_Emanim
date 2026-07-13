#!/usr/bin/env node
/**
 * Read-only inventory for dice formulas in private compendium JSON sources.
 *
 * It deliberately never reads or writes LevelDB packs and never mutates source
 * documents.  The resulting TSV is the review input for a later, explicit
 * migration; rebuilding generators must happen only after that review.
 *
 * Usage:
 *   node tools/audit-compendium-dice-formulas.mjs
 *   node tools/audit-compendium-dice-formulas.mjs --output tmp/dice-formulas.tsv
 */
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sourceRoot = join(root, "_source");
const sourceDirectories = [
  "effects", "pack-weapons", "pack-armors", "pack-vehicles",
  "pack-items", "pack-dlois", "pack-works", "pack-syndromes"
];
const dicePattern = /(?:^|[^a-z0-9_])(?:\d+\s*)?d\s*\d+(?=$|[^a-z0-9_])/ig;

function parseArgs(argv) {
  let output = join(root, "tmp", "compendium-dice-formulas.tsv");
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--output") output = resolve(root, argv[++i] ?? "");
    else if (argv[i] === "--help" || argv[i] === "-h") {
      console.log("Usage: node tools/audit-compendium-dice-formulas.mjs [--output <tsv-path>]");
      process.exit(0);
    } else throw new Error(`Unknown argument: ${argv[i]}`);
  }
  return output;
}

function tsv(value) {
  return String(value ?? "").replace(/[\t\r\n]/g, " ");
}

function classification(value) {
  const matches = [...value.matchAll(dicePattern)].map(match => match[0].trim());
  // Foundry accepts both `d10` and `1d10`; do not invent a leading 1.
  // This migration only normalizes the representation, never the math.
  const normalized = value.replace(/(?:\d+\s*)?d\s*\d+/ig, match => match.replace(/\s/g, "").toLowerCase());
  return {
    matches: matches.join(", "),
    status: normalized === value ? "canonical" : "review-normalize",
    normalized
  };
}

function formulaScope(path) {
  const field = path.join(".");
  if (field === "system.encroach.value") return "executable";
  if (/^system\.(attack|guard|armor|dodge|init|move|add)$/.test(field)) return "executable";
  if (/^system\.(attributes|effect\.attributes)\.[^.]+\.value$/.test(field)) return "executable";
  if (/^flags\.dx3rd-emanim\.itemExtend\.[^.]+\.(formulaDice|formulaAdd|encroachFixed|hpCost)$/.test(field)) return "executable";
  if (/^system\.macros\.\d+\.command$/.test(field)) return "macro-review";
  return "text-only";
}

function walk(value, path, rows, context) {
  if (typeof value === "string") {
    dicePattern.lastIndex = 0;
    if (!dicePattern.test(value)) return;
    dicePattern.lastIndex = 0;
    const result = classification(value);
    rows.push({ ...context, field: path.join("."), scope: formulaScope(path), value, ...result });
    return;
  }
  if (Array.isArray(value)) value.forEach((entry, index) => walk(entry, [...path, index], rows, context));
  else if (value && typeof value === "object") {
    for (const [key, entry] of Object.entries(value)) walk(entry, [...path, key], rows, context);
  }
}

const output = parseArgs(process.argv.slice(2));
const rows = [];
let documentCount = 0;
for (const directory of sourceDirectories) {
  const fullDirectory = join(sourceRoot, directory);
  for (const entry of readdirSync(fullDirectory, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
    const file = join(fullDirectory, entry.name);
    const document = JSON.parse(readFileSync(file, "utf8"));
    documentCount++;
    walk(document, [], rows, {
      source: relative(root, file),
      name: document.name ?? "",
      type: document.type ?? ""
    });
  }
}

rows.sort((a, b) => a.source.localeCompare(b.source) || a.field.localeCompare(b.field));
mkdirSync(dirname(output), { recursive: true });
writeFileSync(output, [
  "source\tname\ttype\tfield\tscope\tformula\tdice_terms\tstatus\tnormalized_formula",
  ...rows.map(row => [row.source, row.name, row.type, row.field, row.scope, row.value, row.matches, row.status, row.normalized].map(tsv).join("\t"))
].join("\n") + "\n", "utf8");

const summary = Object.groupBy(rows, row => `${row.scope}/${row.status}`);
console.log(`DX3rd | audited ${documentCount} source documents`);
console.log(`DX3rd | dice formula fields: ${rows.length}`);
for (const [status, entries] of Object.entries(summary)) console.log(`DX3rd | ${status}: ${entries.length}`);
console.log(`DX3rd | report: ${relative(root, output)}`);
