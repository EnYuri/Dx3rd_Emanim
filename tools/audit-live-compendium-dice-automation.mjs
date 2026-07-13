#!/usr/bin/env node
/**
 * Read-only triage of compendium descriptions that mention dice formulas.
 * It distinguishes existing executable model data from prose-only candidates.
 */
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const packs = ["effects", "weapons", "armors", "vehicles", "items", "dlois", "works", "syndromes"];
const foundryApp = process.env.FOUNDRY_APP_PATH || "C:/Program Files/Foundry Virtual Tabletop/resources/app";
const classicLevelPath = join(foundryApp, "node_modules", "classic-level", "index.js");
if (!existsSync(classicLevelPath)) throw new Error(`Foundry ClassicLevel is missing: ${classicLevelPath}`);
const { ClassicLevel } = await import(pathToFileURL(classicLevelPath).href);

const dicePattern = /(?:\d+|\[[^\]]+\])\s*[dD]\s*\d+/;

function collectModelData(document) {
  const data = [];
  for (const [id, attribute] of Object.entries(document.system?.attributes || {})) {
    data.push({ field: `system.attributes.${attribute?.key || id}`, value: attribute?.value });
  }
  for (const [id, attribute] of Object.entries(document.system?.effect?.attributes || {})) {
    data.push({ field: `system.effect.attributes.${attribute?.key || id}`, value: attribute?.value });
  }
  for (const [type, extension] of Object.entries(document.flags?.["dx3rd-emanim"]?.itemExtend || {})) {
    for (const key of ["formulaDice", "formulaAdd", "encroachFixed", "hpCost", "healTo"]) {
      data.push({ field: `flags.itemExtend.${type}.${key}`, value: extension?.[key] });
    }
  }
  return data.filter(entry => {
    const value = String(entry.value ?? "").trim();
    return value && value !== "0" && value !== "-";
  });
}

function classifyDescription(text) {
  if (/HP.?데미지|HP를?.{0,15}(감소|잃|소실)|데미지.{0,20}HP/.test(text)) return "hp-damage-or-reduce";
  if (/HP.{0,20}(회복|되찾)|회복.{0,20}HP/.test(text)) return "hp-heal";
  if (/가드치/.test(text)) return "guard";
  if (/공격력/.test(text)) return "attack";
  if (/침식(?:률|치)/.test(text)) return "encroachment";
  if (/(판정|다이스).{0,20}(다이스|D10)|D10.{0,20}(판정|다이스)/.test(text)) return "roll-modifier";
  return "manual-context";
}

const rows = [];
for (const pack of packs) {
  const packPath = join(root, "packs", pack);
  const db = new ClassicLevel(packPath, { valueEncoding: "json" });
  await db.open();
  try {
    for await (const [, document] of db.iterator()) {
      const description = String(document.system?.description || "");
      if (!dicePattern.test(description)) continue;
      rows.push({
        pack,
        id: document._id,
        name: document.name,
        type: document.type,
        category: classifyDescription(description),
        modelData: collectModelData(document),
        description: description.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim()
      });
    }
  } finally {
    await db.close();
  }
}

const summary = Object.fromEntries(Object.entries(Object.groupBy(rows, row => `${row.category}/${row.modelData.length ? "has-model-data" : "no-model-data"}`))
  .sort(([left], [right]) => left.localeCompare(right))
  .map(([category, entries]) => [category, { count: entries.length, ids: entries.map(entry => entry.id) }]));
const report = { documentCandidates: rows.length, summary, candidates: rows };
const output = join(root, "tmp", "live-compendium-dice-automation-audit.json");
mkdirSync(dirname(output), { recursive: true });
writeFileSync(output, JSON.stringify(report, null, 2) + "\n", "utf8");
console.log(`DX3rd | description dice candidates: ${rows.length}`);
for (const [category, value] of Object.entries(summary)) console.log(`DX3rd | ${category}: ${value.count}`);
console.log(`DX3rd | report: ${relative(root, output)}`);
