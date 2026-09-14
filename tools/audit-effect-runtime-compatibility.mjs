#!/usr/bin/env node
// Audit stored effect documents against the current adapter and migration modules.
// Only temporary LevelDB copies are opened; migration functions receive disposable drafts.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const app = process.env.FOUNDRY_APP_PATH || 'C:/Program Files/Foundry Virtual Tabletop/resources/app';
const {ClassicLevel} = await import(pathToFileURL(path.join(app, 'node_modules/classic-level/index.js')).href);
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'system.json'), 'utf8'));
const window = {};
const game = {i18n: {localize: key => key, format: key => key}};
const CONFIG = {statusEffects: []};
new Function('window', 'Hooks', 'game', 'CONFIG', fs.readFileSync(path.join(root, 'scripts/item-effect-adapter.js'), 'utf8'))(window, {once() {}, on() {}}, game, CONFIG);
new Function('window', 'Handlebars', 'game', fs.readFileSync(path.join(root, 'scripts/helpers.js'), 'utf8'))(window, {registerHelper() {}}, game);
const adapter = window.DX3rdItemEffectAdapter;
const evaluator = window.DX3rdFormulaEvaluator;
const peggy = (await import(pathToFileURL(path.join(app, 'node_modules/peggy/lib/peg.js')).href)).default;
const grammar = peggy.generate(fs.readFileSync(path.join(app, 'client/dice/grammar.pegjs'), 'utf8'));
class SyntaxOnlyRollParser {
  constructor() {return new Proxy(this, {get: (target, property) => property in target ? target[property] : (...args) => ({property, args})});}
}
const documents = [];
const packCounts = {};
for (const pack of manifest.packs) {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'dx3rd-effect-compat-'));
  let db;
  try {
    for (const file of fs.readdirSync(path.join(root, pack.path))) {
      if (file !== 'LOCK') fs.copyFileSync(path.join(root, pack.path, file), path.join(temp, file));
    }
    db = new ClassicLevel(temp, {valueEncoding: 'json'});
    for await (const [key, doc] of db.iterator()) {
      if (!key.startsWith('!items!') || doc.type !== 'effect') continue;
      documents.push({pack: pack.name, key, doc});
      packCounts[pack.name] = (packCounts[pack.name] || 0) + 1;
    }
  } finally {
    if (db) await db.close();
    fs.rmSync(temp, {recursive: true, force: true});
  }
}
const findings = [];
const inventory = {keys: {}, lifecycles: {}, extensionTypes: {}, diceFormulasChecked: 0, comboTargetBucketsChecked: 0};
const add = (row, code, field, value, detail) => findings.push({pack: row.pack, id: row.doc._id, name: row.doc.name, code, field, value, detail});
const usable = entry => entry?.key && entry.key !== '-' && String(entry.value ?? '').trim() !== '';
const actions = new Set(['activation', 'use', 'attack']);
const disables = new Set(['-', 'notCheck', 'roll', 'major', 'reaction', 'main', 'turn', 'round', 'scene', 'session']);
const timings = new Set(['-', 'instant', 'afterSuccess', 'afterDamage']);
const oldKeys = new Set(['damage_roll', 'guard_roll', 'reduce_roll', 'dxroll']);
const rollKeys = new Set(['attack', 'guard', 'armor', 'reduce', 'penetrate', 'dice', 'add', 'critical', 'major_dice', 'major_add', 'major_critical', 'reaction_dice', 'reaction_add', 'reaction_critical', 'dodge_dice', 'dodge_add', 'dodge_critical', 'stat_bonus', 'stat_dice', 'stat_add', 'cast_dice', 'cast_add']);
for (const row of documents) {
  const {doc} = row;
  const prose = String(doc.system?.description || '').replace(/<[^>]+>/g, ' ');
  const targetRows = Object.values(doc.system?.effect?.attributes || {}).filter(usable);
  if (targetRows.length && doc.system.effect.runTiming === 'afterDamage'
      && /명중|적중/.test(prose) && !/1점이라도/.test(prose)) {
    add(row, 'hit-rule-stored-as-hp-damage-trigger', 'system.effect.runTiming', 'afterDamage', 'Prose requires a hit; direct/combo target application currently filters by positive HP loss');
  }
  if (targetRows.length && /다음에 (?:실행할|실행하는|할) 판정/.test(prose) && doc.system.effect.disable !== 'roll') {
    add(row, 'next-check-lifecycle-review', 'system.effect.disable', doc.system.effect.disable, 'Prose says next check, not next major action');
  }
  if (targetRows.some(entry => entry.key === 'critical') && /다음.{0,20}메이저 액션 판정/.test(prose)) {
    add(row, 'major-only-critical-stored-as-generic', 'system.effect.attributes', targetRows, 'Generic critical also affects reactions; major_critical is available');
  }
  if (targetRows.some(entry => entry.key === 'add') && /다음.{0,20}메이[저져] 액션.{0,8}판정/.test(prose)) {
    add(row, 'major-only-add-stored-as-generic', 'system.effect.attributes', targetRows, 'Generic add also affects reactions; major_add is available');
  }
  if (doc._id === 'C0vecpDXms7ay913' && !targetRows.some(entry => ['critical', 'major_critical'].includes(entry.key))) {
    add(row, 'documented-critical-modifier-missing', 'system.effect.attributes', targetRows, 'Stored prose includes next-major critical -1 (minimum 6), but only attack is authored; self berserk and other-only targeting are also unauthored');
  }
  if (targetRows.length && /명중.{0,20}중복/.test(prose)) {
    add(row, 'target-stacking-review', 'system.effect.attributes', targetRows, 'Same item/channel/action currently refreshes a single AE');
  }
  if (targetRows.some(entry => entry.key === 'battleMove') && /전력이동.{0,15}영향.{0,10}(않|없)/.test(prose)) {
    add(row, 'battle-only-movement-propagation-review', 'system.effect.attributes', targetRows, 'Without a vehicle, full movement is derived from modified battle movement');
  }
  for (const channel of ['self', 'target']) {
    const map = channel === 'self' ? doc.system?.attributes : doc.system?.effect?.attributes;
    for (const [id, entry] of Object.entries(map || {})) {
      if (!usable(entry)) continue;
      const field = `${channel === 'self' ? 'system.attributes' : 'system.effect.attributes'}.${id}`;
      inventory.keys[entry.key] = (inventory.keys[entry.key] || 0) + 1;
      if (oldKeys.has(entry.key)) add(row, 'removed-modifier-key', field, entry, 'Removed dedicated dice key');
      if (entry.action && !actions.has(entry.action)) add(row, 'invalid-row-action', field, entry, 'Adapter ignores this action and inherits the default');
      if (/\d*\s*d\s*\d+/i.test(String(entry.value)) && !rollKeys.has(entry.key)) add(row, 'dice-in-deterministic-field', field, entry, 'No roll moment; runtime absorbs dice to zero');
      if (/\d*\s*d\s*\d+/i.test(String(entry.value))) {
        inventory.diceFormulasChecked++;
        // Substitute symbolic tokens only to inspect grammar, never to judge rule arithmetic.
        const formula = evaluator.prepareRollFormula(String(entry.value).replace(/\[[^\]]+\]/g, '3'));
        try {grammar.parse(formula, {parser: SyntaxOnlyRollParser});}
        catch (error) {add(row, 'invalid-dice-syntax', field, entry, error.message);}
      }
    }
  }
  for (const bucket of adapter.modifierBuckets(doc)) {
    const map = bucket.channel === 'self' ? doc.system.attributes : doc.system.effect.attributes;
    if (!bucket.keys.some(id => usable(map[id]))) continue;
    const {disable, runTiming} = bucket.lifecycle;
    const label = `${bucket.channel}/${bucket.action}/${disable}/${runTiming}`;
    inventory.lifecycles[label] = (inventory.lifecycles[label] || 0) + 1;
    if (!disables.has(disable)) add(row, 'invalid-disable', bucket.id, bucket.lifecycle, 'Unknown lifecycle');
    if (!timings.has(runTiming)) add(row, 'invalid-modifier-timing', bucket.id, bucket.lifecycle, 'No matching persistent-modifier trigger');
    if (disable === 'notCheck') add(row, 'disabled-authored-modifiers', bucket.id, bucket.keys.map(id => map[id]), 'Authored modifiers are disabled');
    if (bucket.channel === 'self' && bucket.action === 'activation' && disable !== '-' && disable !== 'notCheck') add(row, 'finite-activation-review', bucket.id, bucket.lifecycle, 'Check whether prose declares a condition or finite lifetime');
    if (bucket.channel === 'target' && bucket.action === 'attack' && !adapter.isAttackItem(doc)) add(row, 'pending-attack-target-review', bucket.id, bucket.lifecycle, 'Preparation rider must match supported next-attack binding');
    if (bucket.channel === 'target' && bucket.action === 'activation') add(row, 'target-activation-review', bucket.id, bucket.lifecycle, 'Check explicit activation path');
    if (bucket.channel === 'target') {
      const item = {...doc, getFlag: (scope, key) => doc.flags?.[scope]?.[key]};
      const action = adapter.comboMemberAction(item, 'attack');
      inventory.comboTargetBucketsChecked++;
      if (!adapter.targetFiresAt(item, action, runTiming)) add(row, 'unreachable-combo-target-bucket', bucket.id, {action, lifecycle: bucket.lifecycle}, 'Current combo member action does not execute this card');
    }
  }
  for (const field of ['weaponTmp', 'effectTmp']) {
    if (doc.system?.[field] && doc.system[field] !== '-') add(row, 'picker-scratch-residue', `system.${field}`, doc.system[field], 'Display scratch state, not registered membership');
  }
  const extend = doc.flags?.['dx3rd-emanim']?.itemExtend || {};
  for (const entry of adapter.extensionEntries(extend)) {
    inventory.extensionTypes[entry.type] = (inventory.extensionTypes[entry.type] || 0) + 1;
    if (!entry.data.activate) continue;
    if (entry.data.action && !actions.has(entry.data.action)) add(row, 'invalid-extension-action', entry.id, entry.data, 'Invalid authored action');
    if (entry.type === 'weapon' && entry.data.fist && entry.data.fistAdditive === undefined) add(row, 'unclassified-fist-mode', entry.id, entry.data, 'Legacy replacement fallback remains');
  }
  const ids = new Set();
  for (const card of extend.cards || []) {
    if (!card.id || ids.has(card.id) || ![...adapter.DIRECT_TYPES, 'condition'].includes(card.type)) add(row, 'invalid-extension-card', 'flags.dx3rd-emanim.itemExtend.cards', card, 'Missing/duplicate id or unsupported card type');
    ids.add(card.id);
  }
}
function diff(before, after, prefix = '', out = []) {
  if (JSON.stringify(before) === JSON.stringify(after)) return out;
  if (!before || !after || typeof before !== 'object' || typeof after !== 'object' || Array.isArray(before) || Array.isArray(after)) {
    out.push({field: prefix, before, after}); return out;
  }
  for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) diff(before[key], after[key], prefix ? `${prefix}.${key}` : key, out);
  return out;
}
const migrations = [];
for (const file of fs.readdirSync(path.join(root, 'tools/migrations')).filter(file => /^\d.*\.mjs$/.test(file)).sort()) {
  const mod = await import(pathToFileURL(path.join(root, 'tools/migrations', file)).href);
  if (typeof mod.migrate !== 'function') continue;
  const result = {file, description: mod.description, changes: [], failures: [], notes: []};
  for (const row of documents) {
    if (mod.packs && !mod.packs.includes(row.pack)) continue;
    const draft = structuredClone(row.doc);
    let deleted = false;
    const identity = {pack: row.pack, id: row.doc._id, name: row.doc.name};
    const ctx = {pack: row.pack, key: row.key, original: structuredClone(row.doc), isFolder: false,
      fail: message => result.failures.push({...identity, message}),
      log: message => result.notes.push({...identity, message}), delete: () => {deleted = true;}};
    try {
      const returned = await mod.migrate(draft, ctx);
      const fields = deleted ? [{field: '$document', before: row.doc}] : diff(row.doc, returned ?? draft);
      if (fields.length) result.changes.push({...identity, fields});
    } catch (error) {result.failures.push({...identity, message: error.message});}
  }
  migrations.push(result);
}
const report = {generatedAt: new Date().toISOString(), scope: 'All stored effect-type documents in declared packs; current working tree runtime. No pack writes.', documentCount: documents.length, packCounts, inventory, findings, migrations};
fs.mkdirSync(path.join(root, 'tmp'), {recursive: true});
fs.writeFileSync(path.join(root, 'tmp/effect-runtime-compatibility-audit.json'), JSON.stringify(report, null, 2) + '\n');
fs.writeFileSync(path.join(root, 'tmp/effect-runtime-compatibility-snapshot.json'), JSON.stringify(documents, null, 2) + '\n');
console.log(JSON.stringify({documentCount: documents.length, packCounts, inventory, findings: Object.fromEntries([...new Set(findings.map(f => f.code))].map(code => [code, findings.filter(f => f.code === code).length])), migrations: migrations.map(m => ({file: m.file, changes: m.changes.length, failures: m.failures.length}))}, null, 2));
