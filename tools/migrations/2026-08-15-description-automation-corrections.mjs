import crypto from "node:crypto";

export const description = "설명문과 자동화가 어긋난 능력치·기능·판정 종류·대상 채널·장비 버킷·전투 수치 30건 교정";
export const packs = ["effects", "items", "weapons", "armors"];
export const idempotent = true;

const row = (key, label, value, action = undefined) => ({
  key,
  label,
  value: String(value),
  ...(action ? {action} : {}),
});

const field = (path, before, after) => ({path, before, after});

export const correctionEntries = [
  // Ability/skill/roll-kind modifiers that were authored as generic dice/add bonuses.
  {pack: "effects", id: "LflB5mpaoHvWrPXA", name: "완전수화", type: "effect", coverage: "full",
    self: {before: [row("dice", "dice", "+[level]+2")], after: [row("stat_dice", "body", "+[level]+2")]}},
  {pack: "effects", id: "MyiKOFsBWzHs8Qpf", name: "오리진 (플랜트)", type: "effect", coverage: "full",
    self: {before: [row("add", "add", "+[level]*2")], after: [row("stat_add", "sense", "+[level]*2")]}},
  {pack: "effects", id: "To2NwCM212WY5vO1", name: "오리진 (사이버)", type: "effect", coverage: "full",
    self: {before: [row("add", "add", "+[level]*2")], after: [row("stat_add", "social", "+[level]*2")]}},
  {pack: "effects", id: "Yv4ZyvWGK3Fu2Yry", name: "오리진 (레전드)", type: "effect", coverage: "full",
    self: {before: [row("add", "add", "+[level]*2")], after: [row("stat_add", "mind", "+[level]*2")]}},
  {pack: "effects", id: "OxH5eAPyDIpmILVm", name: "사이코메트리", type: "effect", coverage: "full",
    self: {before: [row("dice", "dice", "+[level]+2")], after: [row("stat_dice", "info", "+[level]+2")]}},
  {pack: "effects", id: "TFCsgptH8A51nxuC", name: "엿듣는 벽", type: "effect", coverage: "full",
    self: {before: [row("dice", "dice", "+[level]+1")], after: [row("stat_dice", "info", "+[level]+1")]}},
  {pack: "effects", id: "wd802LsPOEe3zo77", name: "거장의 기억", type: "effect", coverage: "full",
    self: {before: [row("dice", "dice", "+[level]")], after: [
      row("stat_dice", "drive", "+[level]"), row("stat_dice", "ars", "+[level]"),
      row("stat_dice", "know", "+[level]"), row("stat_dice", "info", "+[level]"),
    ]}},
  {pack: "effects", id: "ztVoNcNikaCI4UJe", name: "짐승의 혼", type: "effect", coverage: "full",
    self: {before: [row("dice", "dice", "+5")], after: [row("stat_dice", "body", "+5")]},
    fields: [field("system.active.disable", "major", "roll")]},
  {pack: "effects", id: "9eGMy1WAqMFJpNCD", name: "블랙 아웃", type: "effect", coverage: "full",
    self: {before: [row("add", "add", "+5")], after: [row("dodge_add", "-", "+5")]},
    fields: [field("system.active.disable", "major", "reaction")]},

  // These two dodge bonuses were written into the target channel and therefore buffed a selected token.
  {pack: "effects", id: "iARudr98dKNkrpil", name: "진공 되돌리기", type: "effect", coverage: "full",
    self: {before: [], after: [row("dodge_add", "-", "+[level]*3")]},
    target: {before: [row("add", "add", "+[level]*3")], after: []},
    fields: [
      field("system.active.disable", "-", "reaction"),
      field("system.effect.disable", "major", "notCheck"),
      field("system.getTarget", true, false),
    ]},
  {pack: "effects", id: "rtAba1qUPHO4V10g", name: "진 하늘 뒤집기", type: "effect", coverage: "full",
    self: {before: [], after: [row("dodge_add", "-", "+[level]*3")]},
    target: {before: [row("add", "add", "+[level]*3")], after: []},
    fields: [
      field("system.active.disable", "-", "reaction"),
      field("system.effect.disable", "major", "notCheck"),
      field("system.getTarget", true, false),
    ]},
  {pack: "effects", id: "q0TC1mlYNvkdyoa5", name: "죄인의 형틀", type: "effect", coverage: "full",
    target: {before: [row("add", "add", "-[level]*2")], after: [row("dodge_add", "-", "-[level]*2")]}},

  {pack: "items", id: "1570c9e595a2e4a6", name: "에어로솔 아트", type: "etc", coverage: "full",
    self: {before: [row("add", "add", "+3")], after: [row("stat_add", "ars_art", "+3")]}},
  {pack: "items", id: "BXNHVT9po73bxBqf", name: "이스케이프", type: "etc", coverage: "full",
    self: {before: [row("add", "add", "+10")], after: [row("dodge_add", "-", "+10")]},
    fields: [field("system.active.disable", "major", "reaction")]},
  {pack: "items", id: "v2zwwT1OqiIYfB4s", name: "출력강화장치", type: "etc", coverage: "full",
    self: {before: [row("add", "add", "+5")], after: [row("reaction_add", "-", "+5")]},
    fields: [field("system.active.disable", "major", "reaction")]},

  // Equipment: exact permanent, split activation/use buckets, or a manual declaration for a condition.
  {pack: "weapons", id: "332ZhoAnSYMTEHlR", name: "기타", type: "weapon", coverage: "full",
    self: {before: [row("add", "add", "+1")], after: [row("stat_add", "ars_music", "+1")]},
    fields: [field("system.active.disable", "scene", "-")]},
  {pack: "weapons", id: "AVEiPuBs9KjSN81Q", name: "폴른 개틀링", type: "weapon", coverage: "assisted",
    note: "대상: 단독이 아닌 사격공격에만 선언", self: {
      before: [row("attack", "ranged", "+4")], after: [row("attack", "ranged", "+4")],
    }, fields: [
      field("system.active.disable", "scene", "major"),
      field("system.active.action", "", "use"),
      field("system.active.applyMode", "toggle", "onUse"),
    ]},
  {pack: "weapons", id: "VsNC0BgNUZYssCUB", name: "레이징 블레이드", type: "weapon", coverage: "full",
    self: {before: [row("attack", "-", "2d10"), row("init", "init", "-4")], after: [
      row("attack", "-", "2d10", "use"), row("init", "init", "-4", "activation"),
    ]}, fields: [
      field("system.active.disable", "major", "-"),
      field("system.active.buckets", undefined, {use: {disable: "major"}}),
    ]},
  {pack: "weapons", id: "f5jDBE2tXOZLEDkJ", name: "스네이크 블레이드", type: "weapon", coverage: "assisted",
    note: "채찍 형태일 때 공격 판정에 선언; 사정거리 변경은 수동", self: {
      before: [row("dice", "dice", "-(1)")], after: [row("stat_dice", "melee", "-1")],
    }, fields: [
      field("system.active.action", "", "use"),
      field("system.active.applyMode", "toggle", "onUse"),
    ]},
  {pack: "weapons", id: "fNYuXVECktIf5ohV", name: "토츠카 검", type: "weapon", coverage: "full",
    self: {before: [row("init", "init", "-5")], after: [
      row("init", "init", "-5", "activation"), row("attack", "melee", "+[body]", "use"),
    ]}, fields: [field("system.active.buckets", undefined, {use: {disable: "major"}})]},
  {pack: "weapons", id: "5VuJzz2wZIvVO9HB", name: "킨 나이프 츠바이", type: "weapon", coverage: "full",
    fields: [field("system.guard", 0, 1)]},
  {pack: "weapons", id: "zGp927D4Bf2KAHMv", name: "사일런트 시커", type: "weapon", coverage: "full",
    fields: [field("system.add", -1, -2)]},

  {pack: "armors", id: "HsTFTG6oDMaoclpC", name: "어댑트 아머", type: "protect", coverage: "full",
    self: {before: [row("attack", "melee", "+3")], after: [row("attack", "melee", "+3")]},
    fields: [field("system.active.disable", "scene", "-")]},
  {pack: "armors", id: "VPZY0klzkneezA5j", name: "암드 슈트", type: "protect", coverage: "full",
    self: {before: [row("attack", "melee", "+3")], after: [row("attack", "melee", "+3")]},
    fields: [field("system.active.disable", "scene", "-")]},
  {pack: "armors", id: "bxPz68DsbcU3wUji", name: "암드 스카프", type: "protect", coverage: "assisted",
    note: "이펙트 작성 무기 또는 변경한 맨손 공격에만 선언", self: {
      before: [row("attack", "-", "+4")], after: [row("attack", "-", "+4")],
    }, fields: [
      field("system.active.disable", "scene", "major"),
      field("system.active.action", "", "use"),
      field("system.active.applyMode", "toggle", "onUse"),
    ]},
  {pack: "armors", id: "c57FO1wrAvbhzFQA", name: "레니게이드 서포터", type: "protect", coverage: "assisted",
    note: "이펙트를 사용하는 판정에만 선언", self: {
      before: [row("add", "add", "+2")], after: [row("add", "-", "+2")],
    }, fields: [
      field("system.active.disable", "scene", "roll"),
      field("system.active.action", "", "use"),
      field("system.active.applyMode", "toggle", "onUse"),
    ]},
  {pack: "armors", id: "dFF1X5SHZHNVztxs", name: "미라쥬 코트", type: "protect", coverage: "assisted",
    note: "그 라운드에 이동한 뒤 닷지할 때 선언", self: {
      before: [row("add", "add", "+5")], after: [row("dodge_add", "-", "+5")],
    }, fields: [
      field("system.active.disable", "scene", "reaction"),
      field("system.active.action", "", "use"),
      field("system.active.applyMode", "toggle", "onUse"),
    ]},
  {pack: "armors", id: "iDW6bsRv5rvHhHib", name: "완전열광학미채복", type: "protect", coverage: "assisted",
    note: "마이너 액션 사용으로 은밀 부여; +4는 은밀 탐지에 대한 지각 대결에만 사용", self: {
      before: [row("dice", "dice", "+4")], after: [row("stat_dice", "perception", "+4")],
    }, fields: [
      field("system.active.action", "", "use"),
      field("system.active.applyMode", "toggle", "onUse"),
    ], condition: {conditions: [
      {timing: "instant", target: "self", type: "stealth", poisonedRank: null, disable: "scene", activate: true},
    ]}},
  {pack: "armors", id: "kmXrjVQpHXlTEt8s", name: "파워 어시스트 아머", type: "protect", coverage: "full",
    self: {before: [row("attack", "melee", "+5")], after: [
      row("attack", "melee", "+5"), row("stat_dice", "body", "+2"),
    ]}},
  {pack: "armors", id: "uAO5g3JhFQXGbt2m", name: "사운드 아머", type: "protect", coverage: "full",
    self: {before: [row("add", "add", "+5")], after: [row("reaction_add", "-", "+5")]},
    fields: [field("system.active.disable", "scene", "-")]},
];

const BY_ID = new Map(correctionEntries.map(entry => [entry.id, entry]));
if (BY_ID.size !== correctionEntries.length) throw new Error("오구현 교정 대상 ID가 중복됐다");

function normalizedRows(attributes) {
  return Object.values(attributes || {})
    .filter(value => value && value.key && value.key !== "-" && String(value.value ?? "").trim() !== "")
    .map(value => row(value.key, value.label ?? "-", value.value, value.action))
    .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
}

function same(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

function rowMap(itemId, channel, rows, current = {}) {
  const reusableIds = Object.entries(current || {})
    .filter(([, value]) => value && value.key && value.key !== "-" && String(value.value ?? "").trim() !== "")
    .map(([id]) => id);
  return Object.fromEntries(rows.map((value, index) => {
    const id = reusableIds[index] || crypto.createHash("sha256")
      .update(`description-automation-correction\0${itemId}\0${channel}\0${index}\0${value.key}\0${value.label}\0${value.action || ""}`)
      .digest("hex").slice(0, 16);
    return [id, structuredClone(value)];
  }));
}

function rewriteRows(doc, ctx, channel, change) {
  if (!change) return true;
  const current = channel === "self" ? doc.system?.attributes : doc.system?.effect?.attributes;
  const actual = normalizedRows(current);
  const before = normalizedRows(Object.fromEntries(change.before.map((value, index) => [index, value])));
  const after = normalizedRows(Object.fromEntries(change.after.map((value, index) => [index, value])));
  if (!same(actual, before) && !same(actual, after)) {
    ctx.fail(`${doc.name}: ${channel} 보정 행이 감사 기준과 다르다 (${JSON.stringify(actual)})`);
    return false;
  }
  const desired = rowMap(doc._id, channel, change.after, current);
  if (channel === "self") doc.system.attributes = desired;
  else {
    doc.system.effect ??= {};
    doc.system.effect.attributes = desired;
  }
  return true;
}

function getPath(object, path) {
  return path.split(".").reduce((value, key) => value?.[key], object);
}

function setPath(object, path, value) {
  const keys = path.split(".");
  let target = object;
  for (const key of keys.slice(0, -1)) target = target[key] ??= {};
  target[keys.at(-1)] = structuredClone(value);
}

function checkedFields(doc, ctx, fields = []) {
  for (const change of fields) {
    const current = getPath(doc, change.path);
    if (!same(current, change.before) && !same(current, change.after)) {
      ctx.fail(`${doc.name}: ${change.path} 예상 ${JSON.stringify(change.before)} 또는 ${JSON.stringify(change.after)}, 실제 ${JSON.stringify(current)}`);
      return false;
    }
  }
  for (const change of fields) setPath(doc, change.path, change.after);
  return true;
}

function setCondition(doc, ctx, value) {
  doc.flags ??= {};
  doc.flags["dx3rd-emanim"] ??= {};
  doc.flags["dx3rd-emanim"].itemExtend ??= {};
  const scope = doc.flags["dx3rd-emanim"].itemExtend;
  const current = scope.condition;
  if (current !== undefined && !same(current, value)) {
    ctx.fail(`${doc.name}: 기존 condition 확장이 감사 기준과 다르다`);
    return false;
  }
  scope.condition = structuredClone(value);
  return true;
}

export function migrate(doc, ctx) {
  const entry = BY_ID.get(doc._id);
  if (!entry) return;
  if (ctx.pack !== entry.pack || doc.name !== entry.name || doc.type !== entry.type) {
    ctx.fail(`${doc._id}: 예상 ${entry.pack}/${entry.name}/${entry.type}, 실제 ${ctx.pack}/${doc.name}/${doc.type}`);
    return;
  }
  if (!rewriteRows(doc, ctx, "self", entry.self)) return;
  if (!rewriteRows(doc, ctx, "target", entry.target)) return;
  if (!checkedFields(doc, ctx, entry.fields)) return;
  if (entry.condition && !setCondition(doc, ctx, entry.condition)) return;
}
