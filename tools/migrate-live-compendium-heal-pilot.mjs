#!/usr/bin/env node
/**
 * Whitelist-only first automation migration: 틈을 막는 연성.
 * No compendium rebuild; Foundry must be closed before --apply.
 */
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const packPath = join(root, "packs", "effects");
const args = process.argv.slice(2);
const apply = args.includes("--apply");
if (args.some(arg => !["--apply", "--confirm-live-pack"].includes(arg))) throw new Error("Unknown argument.");
if (apply && !args.includes("--confirm-live-pack")) throw new Error("Refusing live-pack write without --confirm-live-pack.");

const app = process.env.FOUNDRY_APP_PATH || "C:/Program Files/Foundry Virtual Tabletop/resources/app";
const classicLevelPath = join(app, "node_modules", "classic-level", "index.js");
if (!existsSync(classicLevelPath)) throw new Error(`Foundry ClassicLevel is missing: ${classicLevelPath}`);
const { ClassicLevel } = await import(pathToFileURL(classicLevelPath).href);

const SPEC = {
  id: "bE9CBg69cOK81uE7",
  name: "틈을 막는 연성",
  expected: {
    timing: "initiative",
    target: "자신",
    extension: undefined,
    used: { state: 0, max: 0, level: false, disable: "notCheck" }
  },
  extension: {
    heal: {
      formulaDice: "0",
      formulaAdd: "([level]+1)d10",
      timing: "instant",
      target: "self",
      encroachFixed: "",
      resurrect: false,
      rivival: false,
      activate: true
    }
  },
  used: { state: 0, max: 1, level: false, disable: "round" }
};

function sameJson(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

const db = new ClassicLevel(packPath, { valueEncoding: "json" });
await db.open();
try {
  let found = null;
  let key = null;
  for await (const [entryKey, document] of db.iterator()) {
    if (document._id === SPEC.id) {
      found = document;
      key = entryKey;
      break;
    }
  }
  if (!found || found.name !== SPEC.name) throw new Error("Pilot item was not found or does not match its audited identity.");
  if (found.system?.timing !== SPEC.expected.timing || found.system?.target !== SPEC.expected.target) {
    throw new Error("Pilot item timing/target no longer matches the audited data.");
  }
  const currentExtension = found.flags?.["dx3rd-emanim"]?.itemExtend;
  const currentUsed = found.system?.used;
  const alreadyApplied = sameJson(currentExtension, SPEC.extension) && sameJson(currentUsed, SPEC.used);
  if (!alreadyApplied && (!sameJson(currentExtension, SPEC.expected.extension) || !sameJson(currentUsed, SPEC.expected.used))) {
    throw new Error("Pilot item no longer matches the audited pre-migration data.");
  }

  const changes = alreadyApplied ? [] : [
    { field: "flags.dx3rd-emanim.itemExtend", before: currentExtension ?? null, after: SPEC.extension },
    { field: "system.used", before: currentUsed, after: SPEC.used }
  ];
  const reportPath = join(root, "tmp", `live-compendium-heal-pilot-${apply ? "applied" : "dry-run"}-report.json`);
  mkdirSync(dirname(reportPath), { recursive: true });
  writeFileSync(reportPath, JSON.stringify({
    generatedAt: new Date().toISOString(), mode: apply ? "apply" : "dry-run",
    pack: relative(root, packPath), item: { id: SPEC.id, name: SPEC.name },
    changeCount: changes.length, changes
  }, null, 2) + "\n", "utf8");

  if (apply && changes.length) {
    found.flags ??= {};
    found.flags["dx3rd-emanim"] ??= {};
    found.flags["dx3rd-emanim"].itemExtend = SPEC.extension;
    found.system.used = SPEC.used;
    await db.put(key, found);
  }
  console.log(`DX3rd | ${apply ? "applied" : "dry-run"}: ${changes.length} pilot changes`);
  console.log(`DX3rd | report: ${relative(root, reportPath)}`);
} finally {
  await db.close();
}
