// Reproduce: a preparation item whose payload is only an afterDamage itemExtend
// extension must arm a pending attack rider on use. Uses the real pack data of 맹독 물방울.
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import vm from "node:vm";

const app = process.env.FOUNDRY_APP_PATH || "C:/Program Files/Foundry Virtual Tabletop/resources/app";
const { ClassicLevel } = await import("file:///" + path.join(app, "node_modules", "classic-level", "index.js").replace(/\\/g, "/"));

const dir = "packs/effects";
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "dx3-"));
let packItem = null;
try {
  for (const f of fs.readdirSync(dir)) if (f !== "LOCK") fs.copyFileSync(path.join(dir, f), path.join(tmp, f));
  const db = new ClassicLevel(tmp, { valueEncoding: "json" });
  for await (const [, doc] of db.iterator()) if (doc.name === "맹독 물방울") packItem = doc;
  await db.close();
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
if (!packItem) { console.error("pack item not found"); process.exit(1); }

const src = f => fs.readFileSync(f, "utf8");
const flags = new Map();
const itemStub = { ...packItem, getFlag: (_s, k) => packItem.flags?.["dx3rd-emanim"]?.[k] };
const actor = {
  id: "a1",
  items: new Map([[packItem._id, itemStub]]),
  getFlag: (_s, k) => flags.get(k),
  setFlag: async (_s, k, v) => flags.set(k, JSON.parse(JSON.stringify(v))),
  unsetFlag: async (_s, k) => flags.delete(k)
};

const context = vm.createContext({
  console, structuredClone, JSON, Object, Array, Math, Number, String, Boolean, Set, Map,
  game: {
    actors: new Map([[actor.id, actor]]),
    user: { isGM: true, targets: new Set() },
    i18n: { localize: k => k, format: k => k },
    settings: { get: () => false },
    macros: { getName: () => null },
    scenes: { active: null }
  },
  ui: { notifications: { warn: () => {}, error: () => {}, info: () => {} } },
  canvas: { tokens: { get: () => null, placeables: [], controlled: [] } },
  Hooks: { once: () => {}, on: () => {}, callAll: () => {} },
  DX3rdDebug: { log: () => {}, warn: () => {}, error: () => {} },
  CONFIG: { statusEffects: [] },
  foundry: { utils: {
    deepClone: v => JSON.parse(JSON.stringify(v)),
    getProperty: () => undefined,
    randomID: () => Math.random().toString(16).slice(2, 18)
  }},
  ChatMessage: { getSpeaker: () => ({}) }
});
context.window = context;
context.globalThis = context;
vm.runInContext(src("scripts/item-effect-adapter.js"), context);
vm.runInContext(src("scripts/handlers/universal-handler.js"), context);
vm.runInContext(src("scripts/handlers/universal-apply.js"), context);

const h = context.window.DX3rdUniversalHandler;
const armed = await h.armPendingAttackRider(actor, itemStub, "use");
console.log("armed:", armed);
console.log(JSON.stringify(flags.get("pendingAttackRiders"), null, 2));
