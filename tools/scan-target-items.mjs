// Scan packs: no-roll items (roll '-' or difficulty auto-success/blank) that still require a target
// (getTarget true). These abort standalone use with "대상을 선택" when nothing is targeted —
// while a self item like 리저렉트 (getTarget false) never does.
import { mkdtempSync, copyFileSync, readdirSync, rmSync, realpathSync } from "node:fs";
import { join } from "node:path";

const app = process.env.FOUNDRY_APP_PATH || "C:/Program Files/Foundry Virtual Tabletop/resources/app";
const { ClassicLevel } = await import("file:///" + join(app, "node_modules", "classic-level", "index.js").replace(/\\/g, "/"));

const dirs = process.argv[2] ? [process.argv[2]] : ["packs/effects", "packs/items", "packs/once", "packs/spell"];
const rows = [];
for (const dir of dirs) {
  const tmp = mkdtempSync(join(realpathSync(process.env.TEMP), "dx3rd-scan-"));
  try {
    for (const f of readdirSync(dir)) if (f !== "LOCK") copyFileSync(join(dir, f), join(tmp, f));
    const db = new ClassicLevel(tmp, { valueEncoding: "json" });
    for await (const [key, doc] of db.iterator()) {
      const s = doc?.system;
      if (!s || doc.type === "combo") continue;
      const noRoll = (s.roll ?? "-") === "-";
      const autoOrBlank = ["자동성공", "-", ""].includes(String(s.difficulty ?? "").trim());
      if (!noRoll && !autoOrBlank) continue;
      if (s.getTarget === true) {
        rows.push(`${dir} | ${doc.type} | ${doc.name} | target:${s.target} | getTarget:${s.getTarget} | roll:${s.roll} | diff:${s.difficulty}`);
      }
    }
    await db.close();
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}
console.log(`no-roll + getTarget=true: ${rows.length}`);
for (const r of rows.slice(0, 40)) console.log(r);
