import assert from 'node:assert/strict';
import test from 'node:test';
import {entries, migrate, fearRows, fearCondition} from '../migrations/2026-09-14-effect-description-compatible-fields.mjs';
import {migrate as restore} from '../migrations/2026-08-15-restore-generic-dice.mjs';

function fixture(entry) {
  const doc = {_id: entry.id, name: entry.name, type: 'effect', system: {
    description: 'Preserve rules and flavor', encroach: {value: '4'}, used: {state: 1, max: 3},
    attributes: {}, active: {disable: 'roll', runTiming: 'instant'},
    effect: {disable: 'major', runTiming: 'afterDamage', attributes: {}}, getTarget: true,
  }, flags: {unrelated: {keep: true}}};
  if (entry.channel) {
    const map = entry.channel === 'self' ? doc.system.attributes : doc.system.effect.attributes;
    map.originalId = {key: entry.before, label: entry.before, value: entry.value};
  } else if (entry.expiry) {
    doc.system.effect.attributes.originalId = {key: 'critical', label: 'critical', value: '+1'};
  } else {
    doc.system.effect.runTiming = 'instant';
    doc.system.effect.attributes.originalId = {key: 'attack', label: '-', value: '+[level]*3'};
  }
  return doc;
}
function apply(entry, doc = fixture(entry)) {
  const failures = [];
  migrate(doc, {pack: 'effects', fail: message => failures.push(message)});
  assert.deepEqual(failures, []);
  return doc;
}
test('major-only bonuses and body dice retain value and row identity without changing costs or triggers', () => {
  for (const entry of entries.filter(entry => entry.channel)) {
    const doc = fixture(entry);
    const before = structuredClone(doc);
    apply(entry, doc);
    const map = entry.channel === 'self' ? doc.system.attributes : doc.system.effect.attributes;
    assert.deepEqual(map.originalId, {key: entry.after, label: entry.label || entry.after, value: entry.value});
    if (entry.channel === 'self') doc.system.attributes = before.system.attributes;
    else doc.system.effect.attributes = before.system.effect.attributes;
    assert.deepEqual(doc, before);
  }
});
test('next-check riders expire on any check while keeping the existing damage gate', () => {
  for (const entry of entries.filter(entry => entry.expiry)) {
    const doc = apply(entry);
    assert.equal(doc.system.effect.disable, 'roll');
    assert.equal(doc.system.effect.runTiming, 'afterDamage');
  }
});
test('fear support keeps attack and adds major critical, minimum, self berserk and other-only targeting', () => {
  const entry = entries.find(entry => entry.missing);
  const doc = apply(entry);
  assert.deepEqual(doc.system.effect.attributes.originalId, {key: 'attack', label: '-', value: '+[level]*3'});
  assert.deepEqual(Object.values(doc.system.effect.attributes).slice(1), Object.values(fearRows));
  assert.deepEqual(doc.flags['dx3rd-emanim'].itemExtend.condition, fearCondition);
  assert.equal(doc.flags['dx3rd-emanim'].manualTargetOtherOnly, true);
  assert.deepEqual(doc.flags.unrelated, {keep: true});
});
test('every correction is idempotent and rejects conflicting authoring without partial edits', () => {
  for (const entry of entries) {
    const doc = apply(entry);
    const once = structuredClone(doc);
    apply(entry, doc);
    assert.deepEqual(doc, once, entry.name);
    const bad = fixture(entry);
    if (entry.channel) (entry.channel === 'self' ? bad.system.attributes : bad.system.effect.attributes).originalId.value = '+99';
    else if (entry.expiry) bad.system.effect.disable = 'session';
    else bad.flags['dx3rd-emanim'] = {itemExtend: {condition: {type: 'fly', activate: true}}};
    const before = structuredClone(bad), failures = [];
    migrate(bad, {pack: 'effects', fail: message => failures.push(message)});
    assert.equal(failures.length, 1);
    assert.deepEqual(bad, before);
  }
});
test('historical generic restoration does not undo the current body-only descriptions', () => {
  for (const entry of entries.filter(entry => entry.after === 'stat_dice')) {
    const doc = apply(entry), before = structuredClone(doc), failures = [];
    restore(doc, {pack: 'effects', fail: message => failures.push(message)});
    assert.deepEqual(failures, []);
    assert.deepEqual(doc, before);
  }
});
