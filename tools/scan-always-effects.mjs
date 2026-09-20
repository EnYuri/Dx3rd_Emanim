// Scan pack effects: always-timing items with self attributes — signature census of
// roll | active.disable | active.applyMode | active.action
import { mkdtempSync, copyFileSync, readdirSync, rmSync, realpathSync } from "node:fs";
import { join } from "node:path";

const app = process.env.FOUNDRY_APP_PATH || "C:/Program Files/Foundry Virtual Tabletop/resources/app";
const { ClassicLevel } = await import("file:///" + join(app, "node_modules", "classic-level", "index.js").replace(/\\/g, "/"));

const dir = "packs/effects";
const tmp = mkdtempSync(join(realpathSync(process.env.TEMP), "dx3rd-scan-"));
try {
  for (const f of readdirSync(dir)) if (f !== "LOCK") copyFileSync(join(dir, f), join(tmp, f));
  const db = new ClassicLevel(tmp, { valueEncoding: "json" });
  const counts = {};
  const samples = {};
  for await (const [key, doc] of db.iterator()) {
    if (doc?.type !== "effect") continue;
    const s = doc.system || {};
    const hasSelfAttrs = Object.values(s.attributes || {}).some(
      a => a && a.key && a.key !== "-" && String(a.value ?? "").trim() !== "");
    if (!hasSelfAttrs) continue;
    if (s.timing !== "always") continue;
    const sig = ["roll:" + (s.roll ?? "?"), "disable:" + (s.active?.disable ?? "?"),
      "applyMode:" + (s.active?.applyMode ?? "?"), "action:" + (s.active?.action ?? "?")].join(" | ");
    counts[sig] = (counts[sig] || 0) + 1;
    (samples[sig] ??= []).push(doc.name);
  }
  await db.close();
  for (const [sig, n] of Object.entries(counts).sort((a, b) => b[1] - a[1])) {
    console.log(sig, "=>", n, "  e.g.", samples[sig].slice(0, 5).join(", "));
  }
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
