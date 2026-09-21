#!/usr/bin/env node
/**
 * Read-only audit: every compendium document's stored automation is compared against
 * the vocabulary the current runtime actually reads.
 *
 * Sources of truth (scripts/, verified by hand):
 *  - Modifier keys: scripts/document/actor.js (R.sum/byLabel/bySkill/bucket/min/
 *    actionDiceFormula readers), scripts/dx3rd-applied-effects.js (presence flags).
 *  - Roll-time vs deterministic keys: DX3rdFormulaEvaluator.ROLL_TIME_KEYS
 *    (scripts/helpers.js). Dice in a non-roll-time key evaluates to 0.
 *  - Removed keys: damage_roll / guard_roll / reduce_roll / dxroll
 *    (tools/migrations/2026-08-11-dice-only-modifiers-to-formulas.mjs).
 *  - Actions: DX3rdItemEffectAdapter.ACTIONS = activation | use | attack.
 *  - Label vocab: attack/guard -> melee|ranged|fist|-; stat_* -> ability keys,
 *    skill keys, or the groups drive/ars/know/info (DX3rdSkillGroupMatcher).
 *  - Extensions: DIRECT_TYPES = heal|damage|statusClear|weapon|protect|vehicle,
 *    EXECUTION_TYPES += encroach, condition is a separate family
 *    (scripts/item-effect-adapter.js, universal-extensions.js).
 *  - Macros: system.macro = legacy world-macro names "[Name]";
 *    system.macros[] = embedded entries {timing, kind, command, macroName}
 *    (scripts/handlers/universal-handler.js).
 *
 * Output: stdout summary + tools/out/automation-runtime-audit.json
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const packs = ["effects", "weapons", "armors", "vehicles", "items", "dlois", "works", "syndromes"];
const foundryApp = process.env.FOUNDRY_APP_PATH || "C:/Program Files/Foundry Virtual Tabletop/resources/app";
const classicLevelPath = join(foundryApp, "node_modules", "classic-level", "index.js");
if (!existsSync(classicLevelPath)) throw new Error(`Foundry ClassicLevel is missing: ${classicLevelPath}`);
const { ClassicLevel } = await import(pathToFileURL(classicLevelPath).href);

/* ---------------- runtime vocabulary ---------------- */

const ROLL_TIME_KEYS = new Set([
  "attack", "guard", "armor", "reduce", "penetrate",
  "dice", "add", "critical",
  "major_dice", "major_add", "major_critical",
  "reaction_dice", "reaction_add", "reaction_critical",
  "dodge_dice", "dodge_add", "dodge_critical",
  "stat_bonus", "stat_dice", "stat_add",
  "cast_dice", "cast_add",
]);
// Deterministic keys a character actor still reads (dice here evaluate to 0).
const CHAR_DETERMINISTIC = new Set([
  "critical_min", "init", "hp", "battleMove", "fullMove", "saving_max", "stock_point", "effect_level",
]);
// Keys read only by _prepareEnemyAttributes — dead on a character.
const ENEMY_ONLY_KEYS = new Set(["hp_max", "initiative", "move", "move_battle", "move_full", "dodge_achievement"]);
// Presence flags read by name out of applied-effect payloads (dx3rd-applied-effects / combat).
const PRESENCE_KEYS = new Set(["move_half", "spell_disabled", "spell_disabled_count"]);
// Dedicated dice-modifier keys removed by the 2026-08-11 migration.
const REMOVED_KEYS = new Set(["damage_roll", "guard_roll", "reduce_roll", "dxroll"]);

const LIVE_KEYS = new Set([...ROLL_TIME_KEYS, ...CHAR_DETERMINISTIC, ...PRESENCE_KEYS]);

const VALID_ACTIONS = new Set(["", "activation", "use", "attack", "-", null, undefined]);
const ATTACK_GUARD_LABELS = new Set(["", "-", "melee", "ranged", "fist"]);
const SKILL_KEYS = new Set([
  "melee", "evade", "ranged", "perception", "rc", "will", "cthulhu", "negotiation", "procure",
]);
const STAT_LABELS = new Set(["body", "sense", "mind", "social", "drive", "ars", "know", "info", ...SKILL_KEYS]);
// Custom category skills follow the groupPrefix_romanization convention (main.js DEFAULT_CATEGORY_SKILLS).
const CATEGORY_SKILL_LABEL = /^(?:info|know|drive|ars)_/;
// itemExtend.automation is the usage-gate config namespace (maxEncroachmentExclusive / noCombo),
// read by processItemUsageCost — not an executable extension, but live data.
const EXT_CONFIG_KEYS = new Set(["automation"]);
const STAT_KEYS = new Set(["stat_bonus", "stat_dice", "stat_add"]);
const BUCKET_LABEL_KEYS = new Set(["attack", "guard"]);

const EXT_EXECUTION_TYPES = new Set(["heal", "damage", "statusClear", "weapon", "protect", "vehicle", "encroach"]);
const EXT_CARD_TYPES = new Set(["heal", "damage", "statusClear", "weapon", "protect", "vehicle", "condition"]);
const EXT_TARGETS = new Set(["self", "targetToken", "targetAll", "damagedTargets", "scene", "-", "", null, undefined]);
const CONDITION_IDS = new Set([
  "berserk", "hatred", "fear", "rigor", "pressure", "dazed", "boarding", "stealth", "fly", "poisoned", "dead",
]);
const MACRO_TIMINGS = new Set(["instant", "afterSuccess", "afterDamage", "afterMain", "onInvoke"]);

/* formula tokens supported by DX3rdFormulaEvaluator.replaceReferences */
const lang = JSON.parse(readFileSync(join(root, "lang", "ko.json"), "utf8"));
const LOCALIZED_SKILL_NAMES = new Set(
  ["melee", "evade", "ranged", "perception", "rc", "will", "cthulhu", "negotiation", "procure"]
    .map(k => lang[`DX3rd.${k}`]).filter(Boolean)
);
const LOCALIZED_ABILITIES = new Set(["육체", "감각", "정신", "사회"].map(k => lang[`DX3rd.${["Body","Sense","Mind","Social"][["육체","감각","정신","사회"].indexOf(k)]}`] || k));
const SIMPLE_TOKENS = new Set([
  "lv", "level", "레벨", "소비HP", "소비hp", "입력", "입력값", "input",
  "body", "sense", "mind", "social",
  ...LOCALIZED_ABILITIES, ...SKILL_KEYS, ...LOCALIZED_SKILL_NAMES,
]);
const DICE_RE = /(?:^|[^a-z0-9_])\d*\s*d\s*\d+(?=$|[^a-z0-9_])/i;
const DX_DICE_RE = /\d*\s*d\s*x|\d+\s*d\s*[a-z]/i;

/* ---------------- checks ---------------- */

function checkFormulaTokens(raw) {
  // Return list of unsupported [token] occurrences.
  const out = [];
  const s = String(raw ?? "");
  for (const m of s.matchAll(/\[([^\[\]]*)\]/g)) {
    const inner = m[1].trim();
    if (/^(?:count|개수)\s*:/i.test(inner)) continue;
    if (/[-+*/()]/.test(inner)) {
      // compound expression: each bare token inside must be known
      for (const t of inner.split(/[-+*/()]/).map(t => t.trim()).filter(Boolean)) {
        if (/^\d+$/.test(t)) continue;
        if (!SIMPLE_TOKENS.has(t) && !SIMPLE_TOKENS.has(t.toLowerCase())) out.push(`[${inner}]~${t}`);
      }
      continue;
    }
    if (!SIMPLE_TOKENS.has(inner) && !SIMPLE_TOKENS.has(inner.toLowerCase())) out.push(`[${inner}]`);
  }
  return out;
}

function auditRow(doc, pack, channel, mapKey, row) {
  const issues = [];
  const key = row?.key;
  const value = row?.value;
  const label = row?.label;
  const action = row?.action;
  const field = `${channel === "self" ? "system.attributes" : "system.effect.attributes"}.${mapKey}`;

  if (key == null || key === "-" || String(value ?? "").trim() === "") {
    if (key != null && key !== "-" && String(value ?? "").trim() === "") {
      issues.push({ code: "empty-value", detail: `key '${key}' with empty value — ignored` });
    }
    return issues;
  }

  if (REMOVED_KEYS.has(key)) {
    issues.push({ code: "removed-legacy-key", detail: `'${key}' was removed by the dice-only migration; no reader` });
  } else if (ENEMY_ONLY_KEYS.has(key)) {
    issues.push({ code: "enemy-only-key", detail: `'${key}' is only read by _prepareEnemyAttributes` });
  } else if (!LIVE_KEYS.has(key)) {
    issues.push({ code: "unknown-key", detail: `'${key}' matches no runtime reader` });
  }

  if (typeof value === "boolean") {
    if (!PRESENCE_KEYS.has(key)) {
      issues.push({ code: "unknown-presence-flag", detail: `boolean flag '${key}' — only ${[...PRESENCE_KEYS].join("/")} are read` });
    }
  } else {
    const v = String(value ?? "");
    if (LIVE_KEYS.has(key) && !ROLL_TIME_KEYS.has(key) && DICE_RE.test(v)) {
      issues.push({ code: "dice-in-deterministic", detail: `'${key}' is not a roll-time key; dice evaluate to 0` });
    }
    if (DX_DICE_RE.test(v) && !DICE_RE.test(v)) {
      issues.push({ code: "unsupported-dice", detail: `'${v}' — NdX/DX notation is not a modifier formula` });
    }
    for (const tok of checkFormulaTokens(v)) {
      issues.push({ code: "unknown-formula-token", detail: `'${tok}' in '${v}' resolves to nothing (→ 0)` });
    }
  }

  if (!VALID_ACTIONS.has(action)) {
    issues.push({ code: "invalid-action", detail: `action '${action}' is not activation|use|attack` });
  }

  if (BUCKET_LABEL_KEYS.has(key)) {
    const l = String(label ?? "-");
    if (!ATTACK_GUARD_LABELS.has(l)) {
      issues.push({ code: "invalid-bucket-label", detail: `'${key}' label '${l}' — only melee/ranged/fist are real buckets (falls into generic)` });
    }
  }
  if (STAT_KEYS.has(key)) {
    const l = String(label ?? "");
    if (l && l !== "-" && !STAT_LABELS.has(l) && !STAT_LABELS.has(l.toLowerCase()) && !CATEGORY_SKILL_LABEL.test(l)) {
      issues.push({ code: "label-never-matches", detail: `'${key}' label '${l}' — needs ability/skill key or drive/ars/know/info` });
    }
  }
  return issues;
}

function auditDoc(doc, pack) {
  const findings = [];
  const sys = doc.system || {};
  const push = (code, field, detail) => findings.push({ code, field, detail });

  for (const [k, row] of Object.entries(sys.attributes || {})) {
    for (const i of auditRow(doc, pack, "self", k, row)) push(i.code, `system.attributes.${k}`, `${row?.key}=${JSON.stringify(row?.value)} label=${row?.label} action=${row?.action ?? ""} :: ${i.detail}`);
  }
  for (const [k, row] of Object.entries(sys.effect?.attributes || {})) {
    for (const i of auditRow(doc, pack, "target", k, row)) push(i.code, `system.effect.attributes.${k}`, `${row?.key}=${JSON.stringify(row?.value)} label=${row?.label} action=${row?.action ?? ""} :: ${i.detail}`);
  }

  // target-channel rows but the item never asks for a target
  const targetRows = Object.values(sys.effect?.attributes || {})
    .filter(r => r?.key && r.key !== "-" && String(r?.value ?? "").trim() !== "");
  if (targetRows.length && !sys.getTarget && !sys.scene) {
    push("target-channel-no-getTarget", "system.effect.attributes",
      `${targetRows.length} target modifier row(s) but getTarget/scene are unset — 'instant' applies land on self`);
  }

  // bucket overrides with odd actions
  for (const chan of ["active", "effect"]) {
    for (const [action, bucket] of Object.entries(sys[chan]?.buckets || {})) {
      if (!VALID_ACTIONS.has(action) || action === "" || action === "-") {
        push("invalid-bucket-action", `system.${chan}.buckets.${action}`, `bucket action '${action}' is not a real action`);
      }
      const rt = bucket?.runTiming;
      if (rt && !["-", "instant", "afterSuccess", "afterDamage", "afterMain", "onInvoke"].includes(rt)) {
        push("invalid-runTiming", `system.${chan}.buckets.${action}`, `runTiming '${rt}'`);
      }
    }
  }

  // legacy macro field: "[Name]" world-macro references
  const macroField = String(sys.macro ?? "").trim();
  if (macroField && macroField !== "-") {
    const names = [...macroField.matchAll(/\[([^\]]+)\]/g)].map(m => m[1]);
    push("legacy-macro", "system.macro",
      names.length ? `world macro(s) by name: ${names.join(", ")} — silently skipped if missing`
                   : `unparsable macro field '${macroField.slice(0, 60)}'`);
  }

  // embedded macros
  (Array.isArray(sys.macros) ? sys.macros : []).forEach((m, i) => {
    if (!m || m.disabled) return;
    const timing = m.timing || "instant";
    if (!MACRO_TIMINGS.has(timing)) push("invalid-macro-timing", `system.macros.${i}`, `timing '${timing}'`);
    if (m.kind === "macro") {
      if (!m.macroName) push("macro-no-name", `system.macros.${i}`, "kind 'macro' without macroName — dead");
      else push("world-macro-name", `system.macros.${i}`, `references world macro '${m.macroName}' — skipped if missing`);
    } else if (!String(m.command ?? "").trim()) {
      push("macro-no-command", `system.macros.${i}`, `kind '${m.kind ?? ""}' without command — dead`);
    }
  });

  // extensions
  const ext = doc.flags?.["dx3rd-emanim"]?.itemExtend || {};
  for (const key of Object.keys(ext)) {
    if (!EXT_EXECUTION_TYPES.has(key) && key !== "condition" && key !== "cards" && !EXT_CONFIG_KEYS.has(key)) {
      push("unknown-extension-key", `flags.itemExtend.${key}`, "not in EXECUTION_TYPES — never dispatched");
    }
  }
  const extRows = [];
  for (const type of Object.keys(ext)) {
    if (!EXT_EXECUTION_TYPES.has(type)) continue;
    const arr = Array.isArray(ext[type]) ? ext[type] : [ext[type]];
    arr.forEach((d, i) => extRows.push({ field: `flags.itemExtend.${type}${Array.isArray(ext[type]) ? `.${i}` : ""}`, type, data: d || {} }));
  }
  (Array.isArray(ext.cards) ? ext.cards : []).forEach((card, i) => {
    if (!EXT_CARD_TYPES.has(card?.type)) {
      push("unknown-extension-card", `flags.itemExtend.cards.${i}`, `card type '${card?.type}' is not executable`);
      return;
    }
    extRows.push({ field: `flags.itemExtend.cards.${i}`, type: card.type, data: card.data || {} });
  });
  const cond = ext.condition || {};
  const condRows = Array.isArray(cond.conditions) ? cond.conditions
    : (cond.type || cond.conditionTypes?.length ? [cond] : []);
  condRows.forEach((c, i) => {
    const t = c?.type || c?.conditionTypes?.[0];
    if (t && !CONDITION_IDS.has(t)) push("unknown-condition", `flags.itemExtend.condition.${i}`, `condition '${t}' is not a status id`);
    if (c && !EXT_TARGETS.has(c.target)) push("invalid-ext-target", `flags.itemExtend.condition.${i}`, `target '${c.target}'`);
  });
  for (const { field, type, data } of extRows) {
    if (data.target && !EXT_TARGETS.has(data.target)) push("invalid-ext-target", field, `target '${data.target}'`);
    for (const f of ["formulaDice", "formulaAdd", "hpCost", "healTo", "value", "formula", "amount"]) {
      const v = data[f];
      if (v === undefined || v === null || v === "" || typeof v === "boolean") continue;
      for (const tok of checkFormulaTokens(String(v))) push("unknown-formula-token", `${field}.${f}`, `'${tok}' in '${v}'`);
    }
  }

  return findings;
}

/* ---------------- run ---------------- */

const report = [];
const histogram = {};
for (const pack of packs) {
  const db = new ClassicLevel(join(root, "packs", pack), { valueEncoding: "json" });
  await db.open();
  try {
    for await (const [, doc] of db.iterator()) {
      const findings = auditDoc(doc, pack);
      if (!findings.length) continue;
      for (const f of findings) histogram[f.code] = (histogram[f.code] || 0) + 1;
      report.push({
        pack, id: doc._id, name: doc.name, type: doc.type,
        findings,
        description: String(doc.system?.description || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 300),
      });
    }
  } finally {
    await db.close();
  }
}

const outDir = join(root, "tools", "out");
mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, "automation-runtime-audit.json"), JSON.stringify(report, null, 2));

console.log(`docs with findings: ${report.length}`);
console.log(Object.entries(histogram).sort((a, b) => b[1] - a[1]).map(([k, v]) => `  ${k}: ${v}`).join("\n"));
for (const r of report) {
  console.log(`\n### ${r.pack}/${r.name} (${r.type})`);
  for (const f of r.findings) console.log(`  [${f.code}] ${f.field} — ${f.detail}`);
}
