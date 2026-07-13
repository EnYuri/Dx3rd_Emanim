#!/usr/bin/env node
/** Whitelist-only migration for 심해도시의 꿈 and 스피드 힐. */
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const apply = args.includes("--apply");
if (args.some(arg => !["--apply", "--confirm-live-pack"].includes(arg))) throw new Error("Unknown argument.");
if (apply && !args.includes("--confirm-live-pack")) throw new Error("Refusing live-pack write without --confirm-live-pack.");
const app = process.env.FOUNDRY_APP_PATH || "C:/Program Files/Foundry Virtual Tabletop/resources/app";
const level = join(app, "node_modules", "classic-level", "index.js");
if (!existsSync(level)) throw new Error(`Foundry ClassicLevel is missing: ${level}`);
const { ClassicLevel } = await import(pathToFileURL(level).href);

const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);
const dreamFlags = {
  automation: { maxEncroachmentExclusive: 110 },
  itemExtend: {
    heal: { formulaDice: "0", formulaAdd: "3d10", timing: "instant", target: "self", encroachFixed: "", resurrect: false, rivival: true, activate: true },
    statusClear: { timing: "instant", target: "self", exclude: [], activate: true }
  }
};
const speedFlags = {
  automation: { noCombo: true },
  itemExtend: {
    heal: { formulaDice: "0", formulaAdd: "5d10", timing: "instant", target: "targetToken", excludeSelf: true, encroachFixed: "", resurrect: false, rivival: false, activate: true },
    damage: { activate: false, hpCost: "5", hpCostActivate: true }
  }
};
const specs = [
  {
    pack: "items", id: "0xTHqCm5QYIrae7p", name: "심해도시의 꿈", type: "etc",
    fields: [
      ["flags.dx3rd-emanim", undefined, dreamFlags],
      ["system.used", { state: 0, max: 0, level: false, disable: "notCheck" }, { state: 0, max: 1, level: false, disable: "session" }]
    ]
  },
  {
    pack: "effects", id: "bPOAjXrWA0GsfN8J", name: "스피드 힐", type: "effect",
    fields: [
      ["flags.dx3rd-emanim", undefined, speedFlags],
      ["system.used", { state: 0, max: 0, level: false, disable: "notCheck" }, { state: 0, max: 0, level: true, disable: "session" }],
      ["system.getTarget", false, true]
    ]
  }
];

function get(document, path) {
  return path.split(".").reduce((value, key) => value?.[key], document);
}
function set(document, path, value) {
  const keys = path.split(".");
  const last = keys.pop();
  let parent = document;
  for (const key of keys) parent = parent[key] ??= {};
  parent[last] = value;
}

const changes = [];
const writes = new Map();
for (const spec of specs) {
  const packPath = join(root, "packs", spec.pack);
  const db = new ClassicLevel(packPath, { valueEncoding: "json" });
  await db.open();
  try {
    let entry = null;
    for await (const [key, document] of db.iterator()) if (document._id === spec.id) { entry = { key, document }; break; }
    if (!entry || entry.document.name !== spec.name || entry.document.type !== spec.type) throw new Error(`Audited identity no longer matches: ${spec.id}`);
    for (const [path, before, after] of spec.fields) {
      const current = get(entry.document, path);
      if (same(current, after)) continue;
      if (!same(current, before)) throw new Error(`Audited pre-migration value no longer matches: ${spec.name} ${path}`);
      changes.push({ pack: spec.pack, key: entry.key, document: entry.document, id: spec.id, name: spec.name, field: path, before: current ?? null, after });
    }
  } finally { await db.close(); }
}

const reportPath = join(root, "tmp", `live-compendium-advanced-heal-${apply ? "applied" : "dry-run"}-report.json`);
mkdirSync(dirname(reportPath), { recursive: true });
writeFileSync(reportPath, JSON.stringify({
  generatedAt: new Date().toISOString(), mode: apply ? "apply" : "dry-run", changeCount: changes.length,
  scope: "two audited advanced-healing entries only; no compendium rebuild",
  changes: changes.map(({ key, document, ...change }) => change)
}, null, 2) + "\n", "utf8");

if (apply && changes.length) {
  for (const pack of new Set(changes.map(change => change.pack))) {
    const db = new ClassicLevel(join(root, "packs", pack), { valueEncoding: "json" });
    await db.open();
    try {
      const packChanges = changes.filter(change => change.pack === pack);
      const documents = new Map();
      for (const change of packChanges) {
        const document = documents.get(change.key) || change.document;
        set(document, change.field, change.after);
        documents.set(change.key, document);
      }
      await db.batch([...documents].map(([key, value]) => ({ type: "put", key, value })));
    } finally { await db.close(); }
  }
}
console.log(`DX3rd | ${apply ? "applied" : "dry-run"}: ${changes.length} advanced-heal changes`);
console.log(`DX3rd | report: ${relative(root, reportPath)}`);
