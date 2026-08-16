import assert from "node:assert/strict";
import test from "node:test";

import {
  mechanizationEntries,
  migrate,
} from "../migrations/2026-08-15-description-mechanization-first-tier.mjs";

function baseDocument(entry) {
  return {
    _id: entry.id,
    name: entry.name,
    type: entry.type,
    system: {
      attributes: {},
      active: {state: false, disable: "-", runTiming: "instant", action: "", applyMode: "onUse"},
      effect: {disable: "notCheck", runTiming: "instant", action: "", attributes: {}},
      encroach: {init: 0, value: ""},
      getTarget: false,
    },
    flags: {},
  };
}

function apply(entry, document = baseDocument(entry)) {
  const failures = [];
  migrate(document, {pack: entry.pack, fail: message => failures.push(message)});
  assert.deepEqual(failures, [], entry.name);
  return document;
}

test("the first description-mechanization tier has 31 deterministic documents", () => {
  assert.equal(mechanizationEntries.length, 31);
  assert.equal(mechanizationEntries.filter(entry => entry.pack === "items").length, 25);
  assert.equal(mechanizationEntries.filter(entry => entry.pack === "effects").length, 6);
  assert.equal(mechanizationEntries.filter(entry => entry.coverage === "full").length, 21);
  assert.equal(mechanizationEntries.filter(entry => entry.coverage === "assisted").length, 10);
  assert.equal(new Set(mechanizationEntries.map(entry => entry.id)).size, 31);
});

test("passive item rows use current formula keys and activation semantics", () => {
  const byName = new Map(mechanizationEntries.map(entry => [entry.name, entry]));
  const skin = apply(byName.get("레지네이트 스킨"));
  assert.equal(Object.values(skin.system.attributes)[0].key, "armor");
  assert.equal(skin.system.active.state, true);
  assert.equal(skin.system.active.action, "activation");

  const patron = apply(byName.get("패트런"));
  assert.equal(Object.values(patron.system.attributes)[0].key, "stock_point");
  assert.equal(patron.system.encroach.init, 2);

  const medal = apply(byName.get("럭키 메달 : 골드"));
  assert.equal(Object.values(medal.system.attributes)[0].key, "stat_add");
  assert.equal(medal.system.active.state, false);
  assert.equal(medal.system.active.action, "activation");
});

test("existing effect extensions are preserved while missing riders are added", () => {
  const entry = mechanizationEntries.find(row => row.name === "강철의 육체");
  const document = baseDocument(entry);
  document.flags["dx3rd-emanim"] = {itemExtend: {heal: {formulaAdd: "[level]d10 + ([body])"}}};
  apply(entry, document);
  assert.equal(document.flags["dx3rd-emanim"].itemExtend.heal.formulaAdd, "[level]d10 + ([body])");
  assert.deepEqual(document.flags["dx3rd-emanim"].itemExtend.statusClear.exclude, ["berserk"]);
});

test("use items author self, target, condition and revival channels without old dice-only keys", () => {
  const byName = new Map(mechanizationEntries.map(entry => [entry.name, entry]));
  const anger = apply(byName.get("원념의 주석"));
  assert.deepEqual(Object.values(anger.system.attributes).map(row => [row.key, row.value]), [["attack", "2d10"]]);
  assert.equal(anger.flags["dx3rd-emanim"].itemExtend.condition.conditions[0].type, "berserk");
  assert.equal(anger.system.encroach.value, "3");

  const supporter = apply(byName.get("A랭크:서포터"));
  assert.equal(Object.values(supporter.system.effect.attributes)[0].key, "dice");
  assert.equal(supporter.system.getTarget, true);
  assert.equal(supporter.flags["dx3rd-emanim"].manualTargetOtherOnly, true);

  const neverDie = apply(byName.get("네버 다이"));
  assert.equal(neverDie.flags["dx3rd-emanim"].itemExtend.heal.formulaAdd, "4d10");
  assert.equal(neverDie.flags["dx3rd-emanim"].itemExtend.heal.rivival, true);
});

test("the migration is idempotent for every authored document", () => {
  for (const entry of mechanizationEntries) {
    const document = apply(entry);
    const once = structuredClone(document);
    apply(entry, document);
    assert.deepEqual(document, once, entry.name);
  }
});
