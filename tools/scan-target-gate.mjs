// Classify every getTarget:true usable item: does anything actually consume a selected target?
// Consumers: system.effect.attributes rows, itemExtend entries with target 'targetToken'/'damagedTargets',
// embedded macros (they can read game.user.targets but the adapter marks them 'self').
import { mkdtempSync, copyFileSync, readdirSync, rmSync, realpathSync, existsSync } from "node:fs";
import { join } from "node:path";

const app = process.env.FOUNDRY_APP_PATH || "C:/Program Files/Foundry Virtual Tabletop/resources/app";
const { ClassicLevel } = await import("file:///" + join(app, "node_modules", "classic-level", "index.js").replace(/\\/g, "/"));

const USABLE = ['weapon', 'protect', 'vehicle', 'effect', 'psionic', 'spell', 'book', 'connection', 'etc', 'once'];

function scanDir(dir, label, keyFilter, stats, samples) {
  if (!existsSync(dir)) return;
  const tmp = mkdtempSync(join(realpathSync(process.env.TEMP), "dx3rd-scan-"));
  try {
    for (const f of readdirSync(dir)) if (f !== "LOCK") copyFileSync(join(dir, f), join(tmp, f));
    return (async () => {
      const db = new ClassicLevel(tmp, { valueEncoding: "json" });
      for await (const [key, doc] of db.iterator()) {
        if (!keyFilter(String(key))) continue;
        const item = doc, s = item?.system || {};
        if (!USABLE.includes(item.type)) continue;
        if (!s.getTarget) continue;
        const tgtAttrs = Object.values(s.effect?.attributes || {})
          .filter(a => a?.key && a.key !== '-' && String(a.value ?? '').trim() !== '').length;
        const ex = item?.flags?.["dx3rd-emanim"]?.itemExtend || {};
        const tgtExt = [];
        const walk = (o, path) => {
          if (!o || typeof o !== 'object') return;
          for (const [k, v] of Object.entries(o)) {
            if (v && typeof v === 'object' && !Array.isArray(v)) {
              if (['targetToken', 'damagedTargets'].includes(v.target) && (v.activate || v.activate === undefined)) tgtExt.push(`${path}.${k}`);
              else walk(v, `${path}.${k}`);
            }
          }
        };
        walk(ex, 'ext');
        const macros = (Array.isArray(s.macros) ? s.macros : []).filter(m => m && (m.command || m.macroName));
        const macroUsesTargets = macros.some(m => /targets|targetToken/i.test(String(m.command || '')));
        const bucketAttrs = Object.values(s.effect?.buckets || {}).reduce((n, b) =>
          n + Object.values(b?.attributes || {}).filter(a => a?.key && a.key !== '-' && String(a.value ?? '').trim() !== '').length, 0);
        const hasConsumer = tgtAttrs > 0 || tgtExt.length > 0 || bucketAttrs > 0;
        const cls = hasConsumer ? 'content' : (macroUsesTargets ? 'macro-target' : (macros.length ? 'macro-other' : 'dead'));
        stats[`${label}:${cls}`] = (stats[`${label}:${cls}`] || 0) + 1;
        if (cls !== 'content' && samples.length < 60) {
          samples.push(`${label} | ${item.type} | ${item.name} | target:${s.target || '(empty)'} | tgt:${tgtAttrs}+${bucketAttrs} ext:${tgtExt.length} macros:${macros.length}${macroUsesTargets ? '*' : ''} | timing:${s.timing} | used:${s.used?.state}/${s.used?.max}/${s.used?.disable}`);
        }
      }
      await db.close();
    })().finally(() => rmSync(tmp, { recursive: true, force: true }));
  } catch (e) { rmSync(tmp, { recursive: true, force: true }); throw e; }
}

const stats = {}, samples = [];
const packsDir = "E:/FoundryVTT/Data/systems/dx3rd-emanim/packs";
if (existsSync(packsDir)) {
  for (const pack of readdirSync(packsDir)) {
    const dir = join(packsDir, pack);
    try { await scanDir(dir, `pack:${pack}`, k => k.includes('!items!'), stats, samples); } catch {}
  }
}
for (const w of ["mimmicross", "trials"]) {
  const dir = `E:/FoundryVTT/Data/worlds/${w}/data/actors`;
  try { await scanDir(dir, `world:${w}`, k => k.includes('!actors.items!'), stats, samples); } catch (e) { console.log(`${w}: ${e.message}`); }
}
console.log("-- stats --");
for (const [k, v] of Object.entries(stats).sort()) console.log(`${k}: ${v}`);
console.log("-- non-content samples --");
console.log(samples.join("\n"));
