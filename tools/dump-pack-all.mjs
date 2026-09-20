#!/usr/bin/env node
// Dump every pack document's key/name/type/effectIds. Read-only (copies to temp).
//   node tools/dump-pack-all.mjs <packDir>
import { mkdtempSync, copyFileSync, readdirSync, rmSync, realpathSync } from "node:fs";
import { join } from "node:path";
import process from "node:process";

const [dir] = process.argv.slice(2);
if (!dir) { console.error("usage: dump-pack-all.mjs <packDir>"); process.exit(2); }

const app = process.env.FOUNDRY_APP_PATH || "C:/Program Files/Foundry Virtual Tabletop/resources/app";
const { ClassicLevel } = await import("file:///" + join(app, "node_modules", "classic-level", "index.js").replace(/\\/g, "/"));

const tmp = mkdtempSync(join(realpathSync(process.env.TEMP || "/tmp"), "dx3rd-dump-"));
try {
  for (const f of readdirSync(dir)) if (f !== "LOCK") copyFileSync(join(dir, f), join(tmp, f));
  const db = new ClassicLevel(tmp, { valueEncoding: "json" });
  for await (const [key, doc] of db.iterator()) {
    if (doc?.name === undefined) continue;
    console.log(JSON.stringify({
      key, name: doc.name, type: doc.type,
      effectIds: doc.system?.effectIds, roll: doc.system?.roll,
      difficulty: doc.system?.difficulty, skill: doc.system?.skill
    }));
  }
  await db.close();
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
