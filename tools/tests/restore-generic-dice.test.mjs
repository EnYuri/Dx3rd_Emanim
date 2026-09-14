import assert from "node:assert/strict";
import test from "node:test";

import {
  migrate,
  restoreEntries,
} from "../migrations/2026-08-15-restore-generic-dice.mjs";

const rowMap = rows => Object.fromEntries(rows.map((value, index) => [`row-${index}`, structuredClone(value)]));

function apply(entry, attributes = entry.before) {
  const document = {
    _id: entry.id,
    name: entry.name,
    type: entry.type,
    system: {attributes: rowMap(attributes)},
  };
  const failures = [];
  migrate(document, {pack: entry.pack, fail: message => failures.push(message)});
  assert.deepEqual(failures, [], entry.name);
  return document;
}

test("historical restoration returns generic dice unless the body classification was later reinstated", () => {
  assert.equal(restoreEntries.length, 7);
  assert.equal(restoreEntries.filter(entry => entry.pack === "effects").length, 5);
  assert.equal(restoreEntries.filter(entry => entry.pack === "weapons").length, 1);
  assert.equal(restoreEntries.filter(entry => entry.pack === "armors").length, 1);

  for (const entry of restoreEntries) {
    const rows = Object.values(apply(entry).system.attributes);
    const laterBody = entry.later?.[0]?.label === "body";
    assert.deepEqual(rows, laterBody ? entry.later : entry.after, entry.name);
    assert.deepEqual(rows.map(value => [value.key, value.label]), [laterBody ? ["stat_dice", "body"] : ["dice", "dice"]], entry.name);
  }
});

test("the generic dice restoration is idempotent", () => {
  for (const entry of restoreEntries) {
    const document = apply(entry, entry.after);
    const once = structuredClone(document);
    const failures = [];
    migrate(document, {pack: entry.pack, fail: message => failures.push(message)});
    assert.deepEqual(failures, [], entry.name);
    assert.deepEqual(document, once, entry.name);
  }
});

test("the restoration preserves a later major_dice classification", () => {
  for (const entry of restoreEntries.filter(value => value.later)) {
    const document = apply(entry, entry.later);
    assert.deepEqual(Object.values(document.system.attributes), entry.later, entry.name);
  }
});
