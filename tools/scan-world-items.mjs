// Dump getTarget:true no-roll usable items in a world, with target/scene/effect detail.
import { mkdtempSync, copyFileSync, readdirSync, rmSync, realpathSync } from "node:fs";
import { join } from "node:path";

const app = process.env.FOUNDRY_APP_PATH || "C:/Program Files/Foundry Virtual Tabletop/resources/app";
const { ClassicLevel } = await import("file:///" + join(app, "node_modules", "classic-level", "index.js").replace(/\\/g, "/"));

const dir = process.argv[2] || "E:/FoundryVTT/Data/worlds/mimmicross/data/actors";
const tmp = mkdtempSync(join(realpathSync(process.env.TEMP), "dx3rd-scan-"));
const USABLE = ['weapon', 'protect', 'vehicle', 'effect', 'psionic', 'spell', 'book', 'connection', 'etc', 'once'];

const actors = {};
try {
  for (const f of readdirSync(dir)) if (f !== "LOCK") copyFileSync(join(dir, f), join(tmp, f));
  const db = new ClassicLevel(tmp, { valueEncoding: "json" });
  for await (const [key, doc] of db.iterator()) {
    const k = String(key);
    const m = k.match(/!actors!([^!]+)/);
    if (m) { actors[m[1]] = doc; continue; }
    const e = k.match(/!actors\.items!([^.]+)\.(.+)/);
    if (!e) continue;
    const item = doc, s = item?.system || {};
    if (!USABLE.includes(item.type)) continue;
    const noRoll = (s.roll ?? "-") === "-";
    if (!s.getTarget || !noRoll) continue;
    const tgtAttrs = Object.keys(s.effect?.attributes || {}).length;
    const ex = item?.flags?.["dx3rd-emanim"]?.itemExtend;
    console.log(`${item.type} | ${item.name} | actor:${actors[e[1]]?.name} | target:${s.target} | scene:${!!s.scene} | tgtAttrs:${tgtAttrs} | ext:${ex ? Object.keys(ex).join(",") : "-"} | used:${s.used?.state}/${s.used?.max} ${s.used?.disable} | timing:${s.timing}`);
  }
  await db.close();
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
