#!/usr/bin/env node
// Read every compendium from a temporary copy and report every authored equipment-creation extension.
// Opening a live LevelDB even read-only rotates its log, so this tool never opens packs/* directly.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fistRelated = process.argv.includes("--fist-related");
const app = process.env.FOUNDRY_APP_PATH || "C:/Program Files/Foundry Virtual Tabletop/resources/app";
const classicLevelPath = path.join(app, "node_modules", "classic-level", "index.js");
if (!fs.existsSync(classicLevelPath)) throw new Error(`ClassicLevel not found: ${classicLevelPath}`);
const { ClassicLevel } = await import(pathToFileURL(classicLevelPath).href);

function plainText(html = "") {
  return String(html)
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/\s+\n/g, "\n")
    .trim();
}

const CREATION_TYPES = new Set(["weapon", "protect", "vehicle"]);

function creationEntries(doc) {
  const extend = doc.flags?.["dx3rd-emanim"]?.itemExtend || {};
  const out = [];
  for (const type of CREATION_TYPES) {
    if (Object.prototype.hasOwnProperty.call(extend, type)) {
      out.push({ type, slot: `legacy.${type}`, data: extend[type] || {} });
    }
  }
  for (const card of Array.isArray(extend.cards) ? extend.cards : []) {
    if (CREATION_TYPES.has(card?.type)) {
      out.push({ type: card.type, slot: `card.${card.id}`, data: card.data || {} });
    }
  }
  return out;
}

async function readPack(name) {
  const source = path.join(ROOT, "packs", name);
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), `dx3rd-${name}-audit-`));
  try {
    for (const file of fs.readdirSync(source)) {
      if (file === "LOCK") continue;
      fs.copyFileSync(path.join(source, file), path.join(temp, file));
    }
    const db = new ClassicLevel(temp, { valueEncoding: "json" });
    const rows = [];
    try {
      for await (const [key, doc] of db.iterator()) {
        if (key.startsWith("!folders!")) continue;
        const description = plainText(doc.system?.description);
        if (fistRelated) {
          if (!description.includes("맨손")) continue;
          rows.push({
            pack: name,
            id: doc._id,
            name: doc.name,
            type: doc.type,
            automation: {
              roll: doc.system?.roll,
              attackRoll: doc.system?.attackRoll,
              timing: doc.system?.timing,
              level: doc.system?.level,
              used: doc.system?.used,
              active: doc.system?.active,
              attributes: doc.system?.attributes,
              effect: doc.system?.effect,
              itemExtend: doc.flags?.["dx3rd-emanim"]?.itemExtend
            },
            description
          });
          continue;
        }
        for (const entry of creationEntries(doc)) {
          rows.push({
            pack: name,
            id: doc._id,
            name: doc.name,
            type: doc.type,
            creationType: entry.type,
            slot: entry.slot,
            weapon: entry.data,
            automation: {
              roll: doc.system?.roll,
              attackRoll: doc.system?.attackRoll,
              add: doc.system?.add,
              attack: doc.system?.attack,
              active: doc.system?.active,
              attributes: doc.system?.attributes,
              effect: doc.system?.effect,
              multiWeapon: doc.system?.multiWeapon,
              used: doc.system?.used,
              resourceCost: doc.system?.resourceCost,
              itemExtend: doc.flags?.["dx3rd-emanim"]?.itemExtend
            },
            description
          });
        }
      }
    } finally {
      await db.close();
    }
    return rows;
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
}

const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, "system.json"), "utf8"));
const packNames = (manifest.packs || []).map(pack => pack.name).filter(name => fs.existsSync(path.join(ROOT, "packs", name)));
const rows = (await Promise.all(packNames.map(readPack))).flat()
  .sort((a, b) => a.pack.localeCompare(b.pack) || a.name.localeCompare(b.name) || String(a.slot || '').localeCompare(String(b.slot || '')));

if (process.argv.includes("--json")) {
  console.log(JSON.stringify(rows, null, 2));
} else if (fistRelated) {
  console.log(`DX3rd | descriptions mentioning fist: ${rows.length}`);
  for (const row of rows) {
    console.log(`${row.pack}\t${row.id}\t${row.name}`);
    console.log(`  attributes ${JSON.stringify(row.automation.attributes || [])}`);
    console.log(`  extensions ${JSON.stringify(row.automation.itemExtend || {})}`);
    console.log(`  ${row.description.replace(/\n/g, " / ")}`);
  }
} else {
  const counts = Object.fromEntries([...CREATION_TYPES].map(type => [type, rows.filter(row => row.creationType === type).length]));
  console.log(`DX3rd | equipment creation extensions: ${rows.length} (${Object.entries(counts).map(([type, count]) => `${type} ${count}`).join(", ")})`);
  for (const row of rows) {
    const mode = row.creationType === "weapon" && row.weapon.fist
      ? (row.weapon.fistAdditive ? "fist:additive" : "fist:replace")
      : `created ${row.creationType}`;
    console.log(`${row.pack}\t${row.id}\t${row.name}\t${row.slot}\t${mode}`);
    console.log(`  ${JSON.stringify(row.weapon)}`);
    console.log(`  ${row.description.replace(/\n/g, " / ")}`);
  }
}
