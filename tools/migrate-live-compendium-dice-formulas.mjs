#!/usr/bin/env node
/**
 * Whitelist-only migration for the installed effects LevelDB pack.
 *
 * This is deliberately NOT a compendium rebuild. It updates only the values
 * listed in its dry-run report, preserving every other stored document field.
 * Foundry must be closed before using --apply.
 *
 * Usage:
 *   node tools/migrate-live-compendium-dice-formulas.mjs
 *   node tools/migrate-live-compendium-dice-formulas.mjs --apply --confirm-live-pack
 */
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const packPath = join(root, "packs", "effects");
const argv = process.argv.slice(2);
const apply = argv.includes("--apply");
const confirm = argv.includes("--confirm-live-pack");
const unknown = argv.filter(arg => !["--apply", "--confirm-live-pack"].includes(arg));
if (unknown.length) throw new Error(`Unknown argument(s): ${unknown.join(", ")}`);
if (apply && !confirm) throw new Error("Refusing live-pack write without --confirm-live-pack.");
if (!existsSync(packPath)) throw new Error(`Effects pack is missing: ${packPath}`);

const foundryApp = process.env.FOUNDRY_APP_PATH || "C:/Program Files/Foundry Virtual Tabletop/resources/app";
const classicLevelPath = join(foundryApp, "node_modules", "classic-level", "index.js");
if (!existsSync(classicLevelPath)) throw new Error(`Foundry ClassicLevel is missing: ${classicLevelPath}`);
const { ClassicLevel } = await import(pathToFileURL(classicLevelPath).href);

const EXPECTED_NORMALIZATIONS = 42;
const REPAIR_WOUNDS = {
  id: "3RJElz5mMX4XmtpE",
  path: ["flags", "dx3rd-emanim", "itemExtend", "heal", "formulaAdd"],
  before: "([level]+1)D+[body]",
  after: "([level]+1)d10+[body]"
};

function getPath(object, path) {
  return path.reduce((value, key) => value?.[key], object);
}

function setPath(object, path, value) {
  const last = path.at(-1);
  const parent = path.slice(0, -1).reduce((target, key) => target[key], object);
  parent[last] = value;
}

function normalizeDiceFormula(value) {
  return String(value).replace(/(\d+\s*)?d\s*(\d+)/ig, (_match, count, sides) => {
    const normalizedCount = count ? count.replace(/\s/g, "") : "";
    return `${normalizedCount}d${sides}`;
  });
}

function formulaFields(document) {
  const fields = [{ path: ["system", "encroach", "value"] }];
  for (const [type, extension] of Object.entries(document.flags?.["dx3rd-emanim"]?.itemExtend || {})) {
    for (const key of ["formulaDice", "formulaAdd", "encroachFixed", "hpCost"]) {
      fields.push({ path: ["flags", "dx3rd-emanim", "itemExtend", type, key], extension });
    }
  }
  return fields;
}

const db = new ClassicLevel(packPath, { valueEncoding: "json" });
await db.open();
const changes = [];
try {
  for await (const [key, document] of db.iterator()) {
    for (const field of formulaFields(document)) {
      const before = getPath(document, field.path);
      if (typeof before !== "string") continue;
      const after = normalizeDiceFormula(before);
      if (before === after) continue;
      if (!/(?:\d+\s*)?d\s*\d+/i.test(before)) continue;
      changes.push({ key, id: document._id, name: document.name, field: field.path.join("."), before, after, document, path: field.path });
    }
    if (document._id === REPAIR_WOUNDS.id) {
      const before = getPath(document, REPAIR_WOUNDS.path);
      if (before === REPAIR_WOUNDS.before) {
        changes.push({ key, id: document._id, name: document.name, field: REPAIR_WOUNDS.path.join("."), before, after: REPAIR_WOUNDS.after, document, path: REPAIR_WOUNDS.path });
      } else if (before !== REPAIR_WOUNDS.after) {
        throw new Error(`Repair Wounds formula no longer matches the audited value: ${before}`);
      }
    }
  }

  const normalized = changes.filter(change => change.field !== REPAIR_WOUNDS.path.join("."));
  const repairChange = changes.some(change => change.field === REPAIR_WOUNDS.path.join("."));
  const isPristineAuditedState = normalized.length === EXPECTED_NORMALIZATIONS;
  const isRepairOnlyAuditedState = normalized.length === 0 && repairChange;
  const isAlreadyMigratedState = normalized.length === 0 && !repairChange;
  if (!isPristineAuditedState && !isRepairOnlyAuditedState && !isAlreadyMigratedState) {
    throw new Error(
      `Expected ${EXPECTED_NORMALIZATIONS} audited notation changes, the verified Repair Wounds-only state, or an already-migrated pack with 0 changes; found ${normalized.length} notation changes and repair=${repairChange}. Refusing partial or unknown pack state.`
    );
  }
  if (isPristineAuditedState && changes.length !== EXPECTED_NORMALIZATIONS + 1 && changes.length !== EXPECTED_NORMALIZATIONS) {
    throw new Error(`Unexpected total change count in the audited pack state: ${changes.length}`);
  }

  const report = {
    generatedAt: new Date().toISOString(),
    mode: apply ? "apply" : "dry-run",
    pack: relative(root, packPath),
    scope: "whitelisted executable formula fields only; no compendium rebuild",
    changeCount: changes.length,
    changes: changes.map(({ document, path, ...change }) => change)
  };
  const reportPath = join(root, "tmp", `live-compendium-dice-migration-${apply ? "applied" : "dry-run"}-report.json`);
  mkdirSync(dirname(reportPath), { recursive: true });
  writeFileSync(reportPath, JSON.stringify(report, null, 2) + "\n", "utf8");

  if (apply) {
    await db.batch(changes.map(change => {
      setPath(change.document, change.path, change.after);
      return { type: "put", key: change.key, value: change.document };
    }));
  }

  console.log(`DX3rd | ${apply ? "applied" : "dry-run"}: ${changes.length} whitelisted live-pack changes`);
  console.log(`DX3rd | report: ${relative(root, reportPath)}`);
  if (!apply) console.log("DX3rd | no LevelDB data was modified.");
} finally {
  await db.close();
}
