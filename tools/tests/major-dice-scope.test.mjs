import assert from "node:assert/strict";
import test from "node:test";

import {
  majorDiceEntries,
  migrate,
} from "../migrations/2026-08-15-major-dice-scope.mjs";

function apply(entry, rows = entry.before) {
  const document = {
    _id: entry.id,
    name: entry.name,
    type: entry.type,
    system: {
      timing: entry.timing,
      attributes: Object.fromEntries(rows.map((value, index) => [`row-${index}`, structuredClone(value)])),
    },
  };
  const failures = [];
  migrate(document, {pack: "effects", fail: message => failures.push(message)});
  assert.deepEqual(failures, [], entry.name);
  return document;
}

test("only the three major-timing effects use major_dice", () => {
  assert.deepEqual(majorDiceEntries.map(entry => entry.name), ["사이코메트리", "엿듣는 벽", "거장의 기억"]);
  for (const entry of majorDiceEntries) {
    assert.equal(entry.timing, "major");
    assert.deepEqual(Object.values(apply(entry).system.attributes), entry.after, entry.name);
  }
});

test("the major dice scope migration is idempotent", () => {
  for (const entry of majorDiceEntries) {
    const document = apply(entry, entry.after);
    const once = structuredClone(document);
    const failures = [];
    migrate(document, {pack: "effects", fail: message => failures.push(message)});
    assert.deepEqual(failures, [], entry.name);
    assert.deepEqual(document, once, entry.name);
  }
});
