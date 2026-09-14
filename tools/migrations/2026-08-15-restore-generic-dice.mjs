import crypto from "node:crypto";

export const description = "범용 dice를 특정 능력치·기능 stat_dice로 좁힌 7건을 기존 의미로 복구";
export const packs = ["effects", "weapons", "armors"];
export const idempotent = true;

const row = (key, label, value) => ({key, label, value: String(value)});

export const restoreEntries = [
  {pack: "effects", id: "LflB5mpaoHvWrPXA", name: "완전수화", type: "effect",
    before: [row("stat_dice", "body", "+[level]+2")], after: [row("dice", "dice", "+[level]+2")],
    // The 2026-09-14 correction follows the explicit body-only description.
    later: [row("stat_dice", "body", "+[level]+2")]},
  {pack: "effects", id: "OxH5eAPyDIpmILVm", name: "사이코메트리", type: "effect",
    before: [row("stat_dice", "info", "+[level]+2")], after: [row("dice", "dice", "+[level]+2")],
    later: [row("major_dice", "major_dice", "+[level]+2")]},
  {pack: "effects", id: "TFCsgptH8A51nxuC", name: "엿듣는 벽", type: "effect",
    before: [row("stat_dice", "info", "+[level]+1")], after: [row("dice", "dice", "+[level]+1")],
    later: [row("major_dice", "major_dice", "+[level]+1")]},
  {pack: "effects", id: "wd802LsPOEe3zo77", name: "거장의 기억", type: "effect",
    before: [
      row("stat_dice", "drive", "+[level]"), row("stat_dice", "ars", "+[level]"),
      row("stat_dice", "know", "+[level]"), row("stat_dice", "info", "+[level]"),
    ], after: [row("dice", "dice", "+[level]")],
    later: [row("major_dice", "major_dice", "+[level]")]},
  {pack: "effects", id: "ztVoNcNikaCI4UJe", name: "짐승의 혼", type: "effect",
    before: [row("stat_dice", "body", "+5")], after: [row("dice", "dice", "+5")],
    later: [row("stat_dice", "body", "+5")]},
  {pack: "weapons", id: "f5jDBE2tXOZLEDkJ", name: "스네이크 블레이드", type: "weapon",
    before: [row("stat_dice", "melee", "-1")], after: [row("dice", "dice", "-(1)")]},
  {pack: "armors", id: "iDW6bsRv5rvHhHib", name: "완전열광학미채복", type: "protect",
    before: [row("stat_dice", "perception", "+4")], after: [row("dice", "dice", "+4")]},
];

const BY_ID = new Map(restoreEntries.map(entry => [entry.id, entry]));
if (BY_ID.size !== restoreEntries.length) throw new Error("범용 dice 복구 대상 ID가 중복됐다");

function normalizedRows(attributes) {
  return Object.values(attributes || {})
    .filter(value => value?.key && value.key !== "-" && String(value.value ?? "").trim() !== "")
    .map(value => row(value.key, value.label ?? "-", value.value))
    .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
}

function same(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

function rowMap(entry, current) {
  const reusableIds = Object.keys(current || {});
  return Object.fromEntries(entry.after.map((value, index) => {
    const id = reusableIds[index] || crypto.createHash("sha256")
      .update(`restore-generic-dice\0${entry.id}\0${index}`)
      .digest("hex").slice(0, 16);
    return [id, structuredClone(value)];
  }));
}

export function migrate(doc, ctx) {
  const entry = BY_ID.get(doc._id);
  if (!entry) return;
  if (ctx.pack !== entry.pack || doc.name !== entry.name || doc.type !== entry.type) {
    ctx.fail(`${doc._id}: 예상 ${entry.pack}/${entry.name}/${entry.type}, 실제 ${ctx.pack}/${doc.name}/${doc.type}`);
    return;
  }

  const actual = normalizedRows(doc.system?.attributes);
  const before = normalizedRows(Object.fromEntries(entry.before.map((value, index) => [index, value])));
  const after = normalizedRows(Object.fromEntries(entry.after.map((value, index) => [index, value])));
  const later = entry.later && normalizedRows(Object.fromEntries(entry.later.map((value, index) => [index, value])));
  if (later && same(actual, later)) return;
  if (!same(actual, before) && !same(actual, after)) {
    ctx.fail(`${doc.name}: 자기 보정 행이 복구 기준과 다르다 (${JSON.stringify(actual)})`);
    return;
  }
  doc.system.attributes = rowMap(entry, doc.system.attributes);
}
