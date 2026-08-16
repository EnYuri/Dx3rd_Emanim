import assert from "node:assert/strict";
import test from "node:test";

import {
  correctionEntries,
  migrate,
} from "../migrations/2026-08-15-description-automation-corrections.mjs";

function setPath(object, path, value) {
  const keys = path.split(".");
  let target = object;
  for (const key of keys.slice(0, -1)) target = target[key] ??= {};
  target[keys.at(-1)] = structuredClone(value);
}

function rowMap(rows = []) {
  return Object.fromEntries(rows.map((value, index) => [`old-${index}`, structuredClone(value)]));
}

function baseDocument(entry) {
  const document = {
    _id: entry.id,
    name: entry.name,
    type: entry.type,
    system: {
      attributes: rowMap(entry.self?.before),
      active: {state: false, disable: "-", runTiming: "instant", action: "", applyMode: "onUse"},
      effect: {disable: "notCheck", runTiming: "instant", action: "", attributes: rowMap(entry.target?.before)},
      getTarget: false,
    },
    flags: {},
  };
  for (const change of entry.fields || []) setPath(document, change.path, change.before);
  return document;
}

function apply(entry, document = baseDocument(entry)) {
  const failures = [];
  migrate(document, {pack: entry.pack, fail: message => failures.push(message)});
  assert.deepEqual(failures, [], entry.name);
  return document;
}

const rows = document => Object.values(document.system.attributes || {});
const targetRows = document => Object.values(document.system.effect?.attributes || {});

test("the confirmed automation-correction tier has 30 deterministic documents", () => {
  assert.equal(correctionEntries.length, 30);
  assert.equal(correctionEntries.filter(entry => entry.pack === "effects").length, 12);
  assert.equal(correctionEntries.filter(entry => entry.pack === "items").length, 3);
  assert.equal(correctionEntries.filter(entry => entry.pack === "weapons").length, 7);
  assert.equal(correctionEntries.filter(entry => entry.pack === "armors").length, 8);
  assert.equal(correctionEntries.filter(entry => entry.coverage === "full").length, 24);
  assert.equal(correctionEntries.filter(entry => entry.coverage === "assisted").length, 6);
  assert.equal(new Set(correctionEntries.map(entry => entry.id)).size, 30);
});

test("generic ability and skill modifiers are narrowed to their authored scope", () => {
  const byName = new Map(correctionEntries.map(entry => [entry.name, entry]));
  assert.deepEqual(rows(apply(byName.get("완전수화"))).map(value => [value.key, value.label]), [["stat_dice", "body"]]);
  assert.deepEqual(rows(apply(byName.get("오리진 (플랜트)"))).map(value => [value.key, value.label]), [["stat_add", "sense"]]);
  assert.deepEqual(rows(apply(byName.get("거장의 기억"))).map(value => value.label), ["drive", "ars", "know", "info"]);
  assert.deepEqual(rows(apply(byName.get("기타"))).map(value => [value.key, value.label]), [["stat_add", "ars_music"]]);
});

test("misdirected dodge effects move from the selected target back to the user", () => {
  const entry = correctionEntries.find(value => value.name === "진공 되돌리기");
  const document = apply(entry);
  assert.deepEqual(rows(document).map(value => value.key), ["dodge_add"]);
  assert.deepEqual(targetRows(document), []);
  assert.equal(document.system.getTarget, false);
  assert.equal(document.system.active.disable, "reaction");
  assert.equal(document.system.effect.disable, "notCheck");
});

test("mixed and conditional equipment use current action buckets without widening the passive", () => {
  const byName = new Map(correctionEntries.map(entry => [entry.name, entry]));
  const raging = apply(byName.get("레이징 블레이드"));
  assert.deepEqual(rows(raging).map(value => [value.key, value.action]), [["attack", "use"], ["init", "activation"]]);
  assert.equal(raging.system.active.disable, "-");
  assert.deepEqual(raging.system.active.buckets, {use: {disable: "major"}});

  const supporter = apply(byName.get("레니게이드 서포터"));
  assert.equal(supporter.system.active.action, "use");
  assert.equal(supporter.system.active.applyMode, "onUse");
  assert.equal(supporter.system.active.disable, "roll");
});

test("the optical camouflage keeps its perception bonus and authors the missing stealth state", () => {
  const entry = correctionEntries.find(value => value.name === "완전열광학미채복");
  const document = apply(entry);
  assert.deepEqual(rows(document).map(value => [value.key, value.label]), [["stat_dice", "perception"]]);
  assert.equal(document.flags["dx3rd-emanim"].itemExtend.condition.conditions[0].type, "stealth");
  assert.equal(document.flags["dx3rd-emanim"].itemExtend.condition.conditions[0].disable, "scene");
});

test("confirmed PDF combat values are corrected", () => {
  const byName = new Map(correctionEntries.map(entry => [entry.name, entry]));
  assert.equal(apply(byName.get("킨 나이프 츠바이")).system.guard, 1);
  assert.equal(apply(byName.get("사일런트 시커")).system.add, -2);
});

test("the correction migration is idempotent for every authored document", () => {
  for (const entry of correctionEntries) {
    const document = apply(entry);
    const once = structuredClone(document);
    apply(entry, document);
    assert.deepEqual(document, once, entry.name);
  }
});
