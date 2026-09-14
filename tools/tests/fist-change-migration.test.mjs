import assert from "node:assert/strict";
import test from "node:test";

import {
  ADDITIONS,
  REPLACEMENTS,
  additiveFistCard,
  migrate
} from "../migrations/2026-09-10-fist-change-modes.mjs";

function context() {
  return {
    logs: [],
    failures: [],
    log(message) { this.logs.push(message); },
    fail(message) { this.failures.push(message); }
  };
}

test("all reviewed fist changes have an explicit and disjoint classification", () => {
  assert.equal(REPLACEMENTS.size, 10);
  assert.equal(ADDITIONS.size, 2);
  for (const id of ADDITIONS.keys()) assert.equal(REPLACEMENTS.has(id), false);
});

test("replacement migration records false without changing its weapon profile", () => {
  const doc = {
    _id: "sh1IbrROTcNL8EOS",
    name: "파괴의 손톱",
    flags: {"dx3rd-emanim": {itemExtend: {weapon: {
      activate: true,
      fist: true,
      attack: "[level]+8"
    }}}}
  };
  const ctx = context();
  migrate(doc, ctx);
  assert.equal(doc.flags["dx3rd-emanim"].itemExtend.weapon.fistAdditive, false);
  assert.equal(doc.flags["dx3rd-emanim"].itemExtend.weapon.attack, "[level]+8");
  assert.deepEqual(ctx.failures, []);
});

test("additive prerequisite migration authors a non-stackable attack-only fist card", () => {
  const doc = {_id: "Sex41FK6Tlp729IK", name: "역전의 수아", flags: {}};
  const ctx = context();
  migrate(doc, ctx);
  assert.deepEqual(doc.flags["dx3rd-emanim"].itemExtend.weapon, additiveFistCard("역전의 수아"));
  assert.deepEqual(ctx.failures, []);

  const once = JSON.stringify(doc);
  migrate(doc, ctx);
  assert.equal(JSON.stringify(doc), once);
});

test("migration refuses an unexpected existing weapon card", () => {
  const doc = {
    _id: "AIAbvxGV2qEqt64A",
    name: "찢고 꿰뚫는 자",
    flags: {"dx3rd-emanim": {itemExtend: {weapon: {activate: true, fist: false}}}}
  };
  const ctx = context();
  migrate(doc, ctx);
  assert.equal(ctx.failures.length, 1);
  assert.equal(doc.flags["dx3rd-emanim"].itemExtend.weapon.fist, false);
});
