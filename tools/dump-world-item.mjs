import { mkdtempSync, copyFileSync, readdirSync, rmSync, realpathSync } from "node:fs";
import { join } from "node:path";
const app = process.env.FOUNDRY_APP_PATH || "C:/Program Files/Foundry Virtual Tabletop/resources/app";
const { ClassicLevel } = await import("file:///" + join(app, "node_modules", "classic-level", "index.js").replace(/\\/g, "/"));
const dir = process.argv[3] || "E:/FoundryVTT/Data/worlds/mimmicross/data/actors";
const names = process.argv[2].split(",");
const tmp = mkdtempSync(join(realpathSync(process.env.TEMP), "dx3rd-scan-"));
try {
  for (const f of readdirSync(dir)) if (f !== "LOCK") copyFileSync(join(dir, f), join(tmp, f));
  const db = new ClassicLevel(tmp, { valueEncoding: "json" });
  for await (const [key, doc] of db.iterator()) {
    if (!String(key).includes("!actors.items!")) continue;
    if (!names.some(n => doc?.name?.includes(n))) continue;
    console.log("=== " + doc.name + " (" + doc.type + ") ===");
    console.log(JSON.stringify({system: doc.system, flags: doc.flags?.["dx3rd-emanim"]}, null, 1).slice(0, 4000));
  }
  await db.close();
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
