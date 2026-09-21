#!/usr/bin/env node
/**
 * Seeds `system.rollIntervention` on compendium items whose names match the
 * intervention preset table, so authored item data becomes the source of
 * truth and the name table remains only a compatibility fallback for items
 * copied into worlds before this migration.
 * It never rebuilds packs. Foundry must be closed before --apply.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import vm from "node:vm";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const apply = args.includes("--apply");
if (args.some(arg => !["--apply", "--confirm-live-pack"].includes(arg))) throw new Error("Unknown argument.");
if (apply && !args.includes("--confirm-live-pack")) throw new Error("Refusing live-pack write without --confirm-live-pack.");

const app = process.env.FOUNDRY_APP_PATH || "C:/Program Files/Foundry Virtual Tabletop/resources/app";
const level = join(app, "node_modules", "classic-level", "index.js");
if (!existsSync(level)) throw new Error(`Foundry ClassicLevel is missing: ${level}`);
const { ClassicLevel } = await import(pathToFileURL(level).href);

// The real preset table and schema defaults live in the browser scripts; load
// them in a sandbox so the migration can never drift from the runtime data.
const source = path => readFileSync(resolve(root, path), "utf8");
const sandbox = vm.createContext({
  console,
  Hooks: { once() {}, on() {}, callAll() {} },
  foundry: {
    utils: { randomID: () => "roll-migration" },
    dice: { terms: {} },
    applications: { api: {} }
  },
  CONFIG: {},
  game: { settings: { get: () => 10 }, i18n: { localize: v => v, format: v => v }, user: { isGM: true }, messages: [] },
  canvas: { tokens: { placeables: [] } },
  ui: { notifications: { warn() {}, error() {} } },
  Roll: class {}
});
sandbox.window = sandbox;
vm.runInContext(source("scripts/data/document-schema.js"), sandbox);
vm.runInContext(source("scripts/dice/roll-interventions.js"), sandbox);
vm.runInContext(source("scripts/dice/roll-intervention-effects.js"), sandbox);

const itemConfig = sandbox.window.DX3rdRollInterventionEffects.itemConfig;
const itemTypes = new Set(sandbox.window.DX3rdDocumentSchema.Item.types);
const defaults = JSON.parse(JSON.stringify(sandbox.window.DX3rdDocumentSchema.Item.templates.base.rollIntervention));

const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);
const changes = [];
const writes = [];

for (const pack of readdirSync(join(root, "packs"), { withFileTypes: true })) {
  if (!pack.isDirectory()) continue;
  const db = new ClassicLevel(join(root, "packs", pack.name), { valueEncoding: "json" });
  await db.open();
  try {
    for await (const [key, document] of db.iterator()) {
      if (!itemTypes.has(document?.type) || typeof document.system !== "object" || !document.system) continue;
      if (document.system.rollIntervention?.enabled) continue;
      const config = itemConfig({ name: document.name, type: document.type, system: document.system });
      if (!config) continue;
      const authored = { ...defaults, ...JSON.parse(JSON.stringify(config)), enabled: true };
      if (same(document.system.rollIntervention, authored)) continue;
      changes.push({ pack: pack.name, id: document._id, type: document.type, name: document.name, after: authored });
      document.system.rollIntervention = authored;
      writes.push({ pack: pack.name, key, document });
    }
  } finally {
    await db.close();
  }
}

const reportPath = join(root, "tmp", `live-compendium-roll-interventions-${apply ? "applied" : "dry-run"}-report.json`);
mkdirSync(dirname(reportPath), { recursive: true });
writeFileSync(reportPath, JSON.stringify({ generatedAt: new Date().toISOString(), mode: apply ? "apply" : "dry-run", scope: "items matching the roll-intervention name preset table; no compendium rebuild", changeCount: changes.length, changes }, null, 2) + "\n", "utf8");

if (apply) {
  for (const { pack, key, document } of writes) {
    const db = new ClassicLevel(join(root, "packs", pack), { valueEncoding: "json" });
    await db.open();
    try {
      await db.put(key, document);
    } finally {
      await db.close();
    }
  }
}
console.log(`DX3rd | ${apply ? "applied" : "dry-run"}: ${changes.length} roll-intervention changes`);
for (const change of changes) console.log(`DX3rd |   ${change.pack}/${change.id} ${change.name} (${change.type})`);
console.log(`DX3rd | report: ${relative(root, reportPath)}`);
