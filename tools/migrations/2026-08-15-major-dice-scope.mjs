import crypto from "node:crypto";

export const description = "범용 dice 복구분 중 타이밍이 메이저로 고정된 이펙트 3건을 major_dice로 구분";
export const packs = ["effects"];
export const idempotent = true;

const row = (key, label, value) => ({key, label, value: String(value)});

export const majorDiceEntries = [
  {id: "OxH5eAPyDIpmILVm", name: "사이코메트리", type: "effect", timing: "major",
    before: [row("dice", "dice", "+[level]+2")], after: [row("major_dice", "major_dice", "+[level]+2")]},
  {id: "TFCsgptH8A51nxuC", name: "엿듣는 벽", type: "effect", timing: "major",
    before: [row("dice", "dice", "+[level]+1")], after: [row("major_dice", "major_dice", "+[level]+1")]},
  {id: "wd802LsPOEe3zo77", name: "거장의 기억", type: "effect", timing: "major",
    before: [row("dice", "dice", "+[level]")], after: [row("major_dice", "major_dice", "+[level]")]},
];

const BY_ID = new Map(majorDiceEntries.map(entry => [entry.id, entry]));
if (BY_ID.size !== majorDiceEntries.length) throw new Error("메이저 다이스 대상 ID가 중복됐다");

function normalizedRows(attributes) {
  return Object.values(attributes || {})
    .filter(value => value?.key && value.key !== "-" && String(value.value ?? "").trim() !== "")
    .map(value => row(value.key, value.label ?? "-", value.value))
    .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
}

function same(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

function normalizedSpec(rows) {
  return normalizedRows(Object.fromEntries(rows.map((value, index) => [index, value])));
}

export function migrate(doc, ctx) {
  const entry = BY_ID.get(doc._id);
  if (!entry) return;
  if (ctx.pack !== "effects" || doc.name !== entry.name || doc.type !== entry.type || doc.system?.timing !== entry.timing) {
    ctx.fail(`${doc._id}: 예상 effects/${entry.name}/${entry.type}/${entry.timing}, 실제 ${ctx.pack}/${doc.name}/${doc.type}/${doc.system?.timing}`);
    return;
  }

  const actual = normalizedRows(doc.system?.attributes);
  if (!same(actual, normalizedSpec(entry.before)) && !same(actual, normalizedSpec(entry.after))) {
    ctx.fail(`${doc.name}: 자기 보정 행이 메이저 구분 기준과 다르다 (${JSON.stringify(actual)})`);
    return;
  }

  const currentId = Object.keys(doc.system.attributes || {})[0] || crypto.createHash("sha256")
    .update(`major-dice-scope\0${entry.id}`)
    .digest("hex").slice(0, 16);
  doc.system.attributes = {[currentId]: structuredClone(entry.after[0])};
}
