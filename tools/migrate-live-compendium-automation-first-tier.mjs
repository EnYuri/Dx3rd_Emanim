#!/usr/bin/env node
/**
 * Whitelist-only migration for seven audited, deterministic automation entries.
 * It never rebuilds packs. Foundry must be closed before --apply.
 */
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
const unrestricted = { state: 0, max: 0, level: false, disable: "notCheck" };
const once = { state: false, max: 1, level: false, disable: "notCheck" };
const heal = (formulaAdd, extra = {}) => ({ formulaDice: "0", formulaAdd, timing: "instant", target: "self", encroachFixed: "", resurrect: false, rivival: false, activate: true, ...extra });

const SPECS = [
  {
    pack: "effects", id: "LUSoMTQCG9KM4RaP", name: "무한의 혈육", type: "effect",
    fields: [
      ["system.used", unrestricted, { state: 0, max: 1, level: false, disable: "session" }],
      ["flags.dx3rd-emanim.itemExtend", null, { heal: heal("[level]d10", { rivival: true }) }]
    ]
  },
  {
    pack: "items", id: "BOXfGYW9ES5WwtMC", name: "자동 복원 기구", type: "etc",
    fields: [
      ["system.used", unrestricted, { state: 0, max: 1, level: false, disable: "session" }],
      ["flags.dx3rd-emanim.itemExtend", null, { heal: heal("5d10", { encroachFixed: "3" }) }]
    ]
  },
  {
    pack: "items", id: "C935nWbUbztJyNFU", name: "화이트 허브", type: "once",
    fields: [
      ["system.getTarget", false, true],
      ["flags.dx3rd-emanim.itemExtend", null, { heal: heal("2d10", { target: "targetToken" }) }]
    ]
  },
  {
    pack: "items", id: "xB8gfLxpdzCNSc1g", name: "퍼플 템터", type: "once",
    fields: [["flags.dx3rd-emanim.itemExtend", null, { heal: heal("10", { encroachFixed: "3" }) }]]
  },
  {
    pack: "items", id: "2Z6D0FlKoEzew3MO", name: "민치 야키소바 빵", type: "once",
    fields: [["flags.dx3rd-emanim.itemExtend", null, { statusClear: { timing: "instant", target: "self", exclude: ["berserk"], activate: true } }]]
  },
  {
    pack: "items", id: "pXQLjbqGUshWSebb", name: "강철의 의지", type: "etc",
    fields: [
      ["system.used", unrestricted, { state: 0, max: 1, level: false, disable: "session" }],
      ["flags.dx3rd-emanim.itemExtend", null, { statusClear: { timing: "instant", target: "self", exclude: ["hatred", "fear", "rigor", "pressure", "dazed", "poisoned"], activate: true } }]
    ]
  },
  {
    pack: "armors", id: "P4FUz1TSbpPZcbb3", name: "개념외장", type: "protect",
    fields: [
      ["system.used", unrestricted, { state: 0, max: 1, level: false, disable: "session" }],
      ["flags.dx3rd-emanim.itemExtend", null, { heal: heal("5d10") }]
    ]
  }
];

const get = (obj, path) => path.split(".").reduce((value, key) => value?.[key], obj);
const set = (obj, path, value) => {
  const keys = path.split("."); let target = obj;
  for (const key of keys.slice(0, -1)) target = target[key] ||= {};
  target[keys.at(-1)] = value;
};

const changes = [];
const writes = [];
for (const spec of SPECS) {
  const packPath = join(root, "packs", spec.pack);
  const db = new ClassicLevel(packPath, { valueEncoding: "json" });
  await db.open();
  try {
    const document = await db.get(`!items!${spec.id}`);
    if (document.name !== spec.name || document.type !== spec.type) throw new Error(`Identity mismatch for ${spec.pack}/${spec.id}`);
    let dirty = false;
    for (const [path, before, after] of spec.fields) {
      const current = get(document, path) ?? null;
      if (same(current, after)) continue;
      if (!same(current, before)) throw new Error(`Unexpected value for ${spec.name} ${path}: ${JSON.stringify(current)}`);
      changes.push({ pack: spec.pack, id: spec.id, name: spec.name, field: path, before: current, after });
      set(document, path, after);
      dirty = true;
    }
    if (dirty) writes.push({ pack: spec.pack, id: spec.id, document });
  } finally {
    await db.close();
  }
}

const reportPath = join(root, "tmp", `live-compendium-automation-first-tier-${apply ? "applied" : "dry-run"}-report.json`);
mkdirSync(dirname(reportPath), { recursive: true });
writeFileSync(reportPath, JSON.stringify({ generatedAt: new Date().toISOString(), mode: apply ? "apply" : "dry-run", scope: "seven audited deterministic automation entries only; no compendium rebuild", changeCount: changes.length, changes }, null, 2) + "\n", "utf8");

if (apply) {
  for (const { pack, id, document } of writes) {
    const db = new ClassicLevel(join(root, "packs", pack), { valueEncoding: "json" });
    await db.open();
    try {
      await db.put(`!items!${id}`, document);
    } finally {
      await db.close();
    }
  }
}
console.log(`DX3rd | ${apply ? "applied" : "dry-run"}: ${changes.length} first-tier automation changes`);
console.log(`DX3rd | report: ${relative(root, reportPath)}`);
