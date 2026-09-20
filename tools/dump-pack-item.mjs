#!/usr/bin/env node
// Dump pack documents whose name matches a substring. Read-only (copies to temp).
//   node tools/dump-pack-item.mjs <packDir> <nameSubstring>
import { existsSync, mkdtempSync, copyFileSync, readdirSync, rmSync, realpathSync } from "node:fs";
import { join, resolve } from "node:path";
import process from "node:process";

const [dir, needle] = process.argv.slice(2);
if (!dir || !needle) { console.error("usage: dump-pack-item.mjs <packDir> <nameSubstring>"); process.exit(2); }

const app = process.env.FOUNDRY_APP_PATH || "C:/Program Files/Foundry Virtual Tabletop/resources/app";
const { ClassicLevel } = await import("file:///" + join(app, "node_modules", "classic-level", "index.js").replace(/\\/g, "/"));

const tmp = mkdtempSync(join(realpathSync(process.env.TEMP || "/tmp"), "dx3rd-dump-"));
try {
  for (const f of readdirSync(dir)) if (f !== "LOCK") copyFileSync(join(dir, f), join(tmp, f));
  const db = new ClassicLevel(tmp, { valueEncoding: "json" });
  for await (const [key, doc] of db.iterator()) {
    if (typeof doc?.name === "string" && doc.name.includes(needle)) {
      console.log("=== ", key, " ===");
      console.log(JSON.stringify(doc, null, 2));
    }
  }
  await db.close();
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
