#!/usr/bin/env node
/**
 * Whitelist-only migration for seven audited self-healing item entries.
 * It never rebuilds a compendium and writes only the listed fields.
 * Foundry must be closed before --apply.
 */
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const packPath = join(root, "packs", "items");
const args = process.argv.slice(2);
const apply = args.includes("--apply");
if (args.some(arg => !["--apply", "--confirm-live-pack"].includes(arg))) throw new Error("Unknown argument.");
if (apply && !args.includes("--confirm-live-pack")) throw new Error("Refusing live-pack write without --confirm-live-pack.");

const app = process.env.FOUNDRY_APP_PATH || "C:/Program Files/Foundry Virtual Tabletop/resources/app";
const classicLevelPath = join(app, "node_modules", "classic-level", "index.js");
if (!existsSync(classicLevelPath)) throw new Error(`Foundry ClassicLevel is missing: ${classicLevelPath}`);
const { ClassicLevel } = await import(pathToFileURL(classicLevelPath).href);

const heal = formulaAdd => ({
  formulaDice: "0", formulaAdd, timing: "instant", target: "self", encroachFixed: "",
  resurrect: false, rivival: false, activate: true
});
const unrestricted = { state: 0, max: 0, level: false, disable: "notCheck" };
const once = { state: false, max: 1, level: false, disable: "notCheck" };
const SPEC = [
  ["293t8otjdfmmbkXq", "예비심장", "once", "0", once],
  ["DuapoiiTSDItAk0z", "응급치료 키트", "once", "2d10", once],
  ["GwvLhZUHD6rVGUEL", "고성능치료 팩", "etc", "3d10", unrestricted],
  ["Q47uh2sripUCOTKL", "R면", "once", "1d10", once],
  ["sRqNsFlmpe6zpnHV", "간이수술키트", "once", "4d10", once],
  ["ycaFClD9BdnbLBIm", "파나케이아의 열매", "once", "5d10", once],
  ["ymDYqTFs2AnF4F3q", "의료 트렁크", "etc", "2d10", unrestricted, { state: 0, max: 1, level: false, disable: "scene" }],
  ["zGIA9bvJsYoAs3hM", "악식의 기호품", "etc", "2d10", unrestricted, { state: 0, max: 3, level: false, disable: "session" }]
].map(([id, name, type, formulaAdd, expectedUsed, used]) => ({ id, name, type, extension: { heal: heal(formulaAdd) }, expectedUsed, used }));

SPEC[0].extension.heal.healTo = "1";
SPEC[0].extension.heal.encroachFixed = "2d10";
SPEC[0].extension.heal.rivival = true;

const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);
const db = new ClassicLevel(packPath, { valueEncoding: "json" });
await db.open();
try {
  const byId = new Map();
  for await (const [key, document] of db.iterator()) byId.set(document._id, { key, document });
  const changes = [];
  for (const spec of SPEC) {
    const entry = byId.get(spec.id);
    const document = entry?.document;
    if (!document || document.name !== spec.name || document.type !== spec.type) throw new Error(`Audited item identity no longer matches: ${spec.id}`);
    const currentExtension = document.flags?.["dx3rd-emanim"]?.itemExtend;
    const currentUsed = document.system?.used;
    const extensionDone = same(currentExtension, spec.extension);
    const usedDone = !spec.used || same(currentUsed, spec.used);
    if ((!extensionDone && currentExtension !== undefined) || (!usedDone && !same(currentUsed, spec.expectedUsed))) {
      throw new Error(`Audited pre-migration data no longer matches: ${spec.name}`);
    }
    if (!extensionDone) changes.push({ key: entry.key, document, id: spec.id, name: spec.name, field: "flags.dx3rd-emanim.itemExtend", before: currentExtension ?? null, after: spec.extension });
    if (!usedDone) changes.push({ key: entry.key, document, id: spec.id, name: spec.name, field: "system.used", before: currentUsed, after: spec.used });
  }

  const report = {
    generatedAt: new Date().toISOString(), mode: apply ? "apply" : "dry-run", pack: relative(root, packPath),
    scope: "seven audited self-healing items only; no compendium rebuild", changeCount: changes.length,
    changes: changes.map(({ key, document, ...change }) => change)
  };
  const reportPath = join(root, "tmp", `live-compendium-item-heal-${apply ? "applied" : "dry-run"}-report.json`);
  mkdirSync(dirname(reportPath), { recursive: true });
  writeFileSync(reportPath, JSON.stringify(report, null, 2) + "\n", "utf8");

  if (apply && changes.length) {
    const modified = new Map();
    for (const change of changes) {
      const document = modified.get(change.key) || change.document;
      if (change.field === "flags.dx3rd-emanim.itemExtend") {
        document.flags ??= {};
        document.flags["dx3rd-emanim"] ??= {};
        document.flags["dx3rd-emanim"].itemExtend = change.after;
      } else document.system.used = change.after;
      modified.set(change.key, document);
    }
    await db.batch([...modified].map(([key, value]) => ({ type: "put", key, value })));
  }
  console.log(`DX3rd | ${apply ? "applied" : "dry-run"}: ${changes.length} audited item-heal changes`);
  console.log(`DX3rd | report: ${relative(root, reportPath)}`);
} finally {
  await db.close();
}
