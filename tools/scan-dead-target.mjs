// Scan packs: items with getTarget=true — do they carry target-dependent content
// (effect.attributes rows OR itemExtend heal/damage/condition entries)?
import { mkdtempSync, copyFileSync, readdirSync, rmSync, realpathSync } from "node:fs";
import { join } from "node:path";

const app = process.env.FOUNDRY_APP_PATH || "C:/Program Files/Foundry Virtual Tabletop/resources/app";
const { ClassicLevel } = await import("file:///" + join(app, "node_modules", "classic-level", "index.js").replace(/\\/g, "/"));

const usable = attrs => Object.values(attrs || {}).some(e =>
  e && e.key && e.key !== "-" && String(e.value ?? "").trim() !== "");

const dirs = process.argv[2] ? [process.argv[2]] : ["packs/effects", "packs/items", "packs/once", "packs/spell"];
const trulyDead = [];
for (const dir of dirs) {
  const tmp = mkdtempSync(join(realpathSync(process.env.TEMP), "dx3rd-scan-"));
  try {
    for (const f of readdirSync(dir)) if (f !== "LOCK") copyFileSync(join(dir, f), join(tmp, f));
    const db = new ClassicLevel(tmp, { valueEncoding: "json" });
    for await (const [key, doc] of db.iterator()) {
      const s = doc?.system;
      if (!s || s.getTarget !== true) continue;
      const hasAttrs = usable(s.effect?.attributes);
      const ex = doc?.flags?.["dx3rd-emanim"]?.itemExtend || {};
      // Legacy slots are keyed by type (ext.heal = {…}); new cards live in ext.cards[].
      const SLOT_TYPES = ["heal", "damage", "encroach", "statusClear", "condition", "itemCreate", "macro"];
      const legacyTypes = SLOT_TYPES.filter(t => {
        const d = ex[t];
        return d && typeof d === "object" && (d.activate === true || usable({ x: d }) || Object.keys(d).length > 0);
      });
      const cardTypes = (Array.isArray(ex.cards) ? ex.cards : []).map(c => c?.type).filter(Boolean);
      const entries = [...legacyTypes, ...cardTypes];
      const exTypes = entries.join(",");
      if (!hasAttrs && entries.length === 0) {
        trulyDead.push(`${dir} | ${doc.type} | ${doc.name} | target:${s.target} | roll:${s.roll} | diff:${s.difficulty}`);
      } else if (!hasAttrs) {
        console.log(`EXT   ${doc.name} | target:${s.target} | ext:[${exTypes}]`);
      }
    }
    await db.close();
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}
console.log(`\ngetTarget:true with NO target content at all: ${trulyDead.length}`);
for (const r of trulyDead.slice(0, 40)) console.log("DEAD  " + r);
