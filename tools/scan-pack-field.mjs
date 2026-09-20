// Scan a pack: list items whose used.disable is set (not 'notCheck') — the exhaustion gate shapes.
import { mkdtempSync, copyFileSync, readdirSync, rmSync, realpathSync } from "node:fs";
import { join } from "node:path";

const app = process.env.FOUNDRY_APP_PATH || "C:/Program Files/Foundry Virtual Tabletop/resources/app";
const { ClassicLevel } = await import("file:///" + join(app, "node_modules", "classic-level", "index.js").replace(/\\/g, "/"));

const dir = process.argv[2];
const tmp = mkdtempSync(join(realpathSync(process.env.TEMP), "dx3rd-scan-"));
try {
  for (const f of readdirSync(dir)) if (f !== "LOCK") copyFileSync(join(dir, f), join(tmp, f));
  const db = new ClassicLevel(tmp, { valueEncoding: "json" });
  for await (const [key, doc] of db.iterator()) {
    const s = doc?.system;
    if (!s || !s.used) continue;
    const dis = s.used?.disable ?? "?";
    if (dis !== "notCheck") {
      console.log(doc.type, "|", doc.name, "| used:", JSON.stringify(s.used), "| qty:", s.quantity,
        "| roll:", s.roll, "| diff:", s.difficulty, "| timing:", s.timing);
    }
  }
  await db.close();
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
