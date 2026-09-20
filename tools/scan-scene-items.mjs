// Scan packs: for no-roll usable items, cross-tabulate getTarget/scene flags and target kind.
// scene=true means "apply to every token" — no pick needed. getTarget=true + scene=false means a pick is required.
import { mkdtempSync, copyFileSync, readdirSync, rmSync, realpathSync } from "node:fs";
import { join } from "node:path";

const app = process.env.FOUNDRY_APP_PATH || "C:/Program Files/Foundry Virtual Tabletop/resources/app";
const { ClassicLevel } = await import("file:///" + join(app, "node_modules", "classic-level", "index.js").replace(/\\/g, "/"));

const dirs = process.argv[2] ? [process.argv[2]] : ["packs/effects", "packs/items", "packs/once", "packs/spell"];
const buckets = {};
const sceneItems = [];
for (const dir of dirs) {
  const tmp = mkdtempSync(join(realpathSync(process.env.TEMP), "dx3rd-scan-"));
  try {
    for (const f of readdirSync(dir)) if (f !== "LOCK") copyFileSync(join(dir, f), join(tmp, f));
    const db = new ClassicLevel(tmp, { valueEncoding: "json" });
    for await (const [key, doc] of db.iterator()) {
      const s = doc?.system;
      if (!s || doc.type === "combo") continue;
      const k = `getTarget:${!!s.getTarget} scene:${!!s.scene}`;
      buckets[k] = (buckets[k] || 0) + 1;
      if (s.scene && s.getTarget) sceneItems.push(`${doc.type} | ${doc.name} | target:${s.target} | roll:${s.roll} | diff:${s.difficulty}`);
    }
    await db.close();
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}
console.log(JSON.stringify(buckets, null, 2));
console.log(`\ngetTarget+scene both on: ${sceneItems.length}`);
for (const r of sceneItems.slice(0, 20)) console.log(r);
