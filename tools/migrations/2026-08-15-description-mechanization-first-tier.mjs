import crypto from "node:crypto";

export const description = "설명문에만 남은 상시 보정, 기존 이펙트의 부수효과, 단순 사용형 아이템 31건을 현재 자동화 채널로 구현";
export const packs = ["effects", "items"];
export const idempotent = true;

const ACTIVE = (disable, state = false, action = state ? "activation" : "use") => ({
  state,
  disable,
  runTiming: "instant",
  action,
  applyMode: action === "activation" ? "toggle" : "onUse",
});
const attr = (key, label, value) => ({key, label, value: String(value)});
const passive = (...attributes) => ({attributes, active: ACTIVE("-", true)});
const toggle = (...attributes) => ({attributes, active: ACTIVE("-", false, "activation")});
const use = (disable, ...attributes) => ({attributes, active: ACTIVE(disable)});
const target = (disable, ...attributes) => ({
  targetAttributes: attributes,
  effect: {disable, runTiming: "instant", action: "use"},
  getTarget: true,
});
const condition = (timing, targetName, type, options = {}) => ({
  timing,
  target: targetName,
  type,
  poisonedRank: options.poisonedRank ?? null,
  ...(options.disable ? {disable: options.disable} : {}),
  activate: true,
});

/**
 * coverage:
 * - full: 현재 런타임이 수치, 대상, 비용, 횟수와 수명을 직접 표현한다.
 * - assisted: 수치는 정확하지만 원문의 문맥 조건이나 후속 수동 조작은 사용자가 확인한다.
 */
export const mechanizationEntries = [
  // 상시 아이템. 럭키 메달은 전투 중 적용되지 않으므로 기본 OFF 토글로 둔다.
  {id: "chz9u3s74Ocg8EGH", pack: "items", name: "레지네이트 스킨", type: "etc", coverage: "full",
    spec: passive(attr("armor", "-", "+5"))},
  {id: "J6A6E87YnDpDzFyK", pack: "items", name: "셀 스태프 : 가드", type: "etc", coverage: "full",
    spec: passive(attr("reduce", "-", "2"))},
  {id: "6vbpnW9ONQEohibz", pack: "items", name: "셀 스텝 : 가드", type: "etc", coverage: "full",
    spec: passive(attr("reduce", "-", "2"))},
  {id: "3vkwco2kMoI4kpmB", pack: "items", name: "리에존 크레스토", type: "etc", coverage: "full",
    spec: passive(attr("stat_dice", "social", "+2"))},
  {id: "vESsLBC6znYyO6Aa", pack: "items", name: "블랙 로렐라이", type: "etc", coverage: "full",
    spec: passive(attr("stat_dice", "ars", "+1"))},
  {id: "eXUY0R0easbbRLLk", pack: "items", name: "럭키 메달 : 골드", type: "etc", coverage: "assisted",
    note: "전투 밖에서만 활성화", spec: toggle(attr("stat_add", "body", "+1"))},
  {id: "QalHvvxZtrth5i8S", pack: "items", name: "럭키 메달 : 실버", type: "etc", coverage: "assisted",
    note: "전투 밖에서만 활성화", spec: toggle(attr("stat_add", "sense", "+1"))},
  {id: "3EkxQZYrTRGYwuo4", pack: "items", name: "럭키 메달 : 브론즈", type: "etc", coverage: "assisted",
    note: "전투 밖에서만 활성화", spec: toggle(attr("stat_add", "mind", "+1"))},
  {id: "j1ljy707vpwFZEux", pack: "items", name: "럭키 메달 : 화이트", type: "etc", coverage: "assisted",
    note: "전투 밖에서만 활성화", spec: toggle(attr("stat_add", "social", "+1"))},
  {id: "DqS3l7xOXVTj9NDR", pack: "items", name: "호외신문", type: "etc", coverage: "full",
    spec: passive(attr("stat_add", "info_academia", "+1"))},
  {id: "Pv9J8CDfvuF3nWTf", pack: "items", name: "레스트 타임", type: "etc", coverage: "full",
    spec: {encroach: {init: -3}}},
  {id: "YNbjU9eLORyjFw76", pack: "items", name: "정신강화수술", type: "etc", coverage: "full",
    spec: passive(attr("init", "-", "+1"), attr("stat_add", "will", "-1"))},
  {id: "e944db7dd046da14", pack: "items", name: "패트런", type: "etc", coverage: "full",
    spec: {...passive(attr("stock_point", "-", "+2")), encroach: {init: 2}}},

  // 이미 주효과가 구현된 이펙트의 빠진 상태 부수효과.
  {id: "19UzCEDwgdlRMTZp", pack: "effects", name: "일렉트로 칼리버", type: "effect", coverage: "assisted",
    note: "대상 확대는 수동", spec: {conditions: [condition("afterSuccess", "targetToken", "rigor")]}},
  {id: "HIHdIgO8jGghZtJN", pack: "effects", name: "언리쉬", type: "effect", coverage: "assisted",
    note: "대상 동의와 단독 사용 제한은 수동", spec: {conditions: [condition("instant", "targetToken", "berserk")]}},
  {id: "TcStQvmSXMR6xGGa", pack: "effects", name: "버서크 셀프", type: "effect", coverage: "full",
    spec: {conditions: [condition("instant", "self", "berserk")]}},
  {id: "AEvO4lNQb5woc3qS", pack: "effects", name: "강철의 육체", type: "effect", coverage: "full",
    spec: {statusClear: {all: true, exclude: ["berserk"], target: "self", timing: "instant", activate: true}}},
  {id: "rnsT6aVpf4BrazCa", pack: "effects", name: "병든 탐구심", type: "effect", coverage: "full",
    spec: {conditions: [condition("afterMain", "self", "berserk")]}},
  {id: "AadD2iJE8K8mB0ws", pack: "effects", name: "매의 날개", type: "effect", coverage: "assisted",
    note: "최초 비행은 자동; 이후 마이너 액션 재활성화는 상태를 수동 토글", spec: {conditions: [condition("instant", "self", "fly", {disable: "scene"})]}},

  // 사용 제한만 있던 단순 사용형 아이템.
  {id: "1CyEGzr3eegY1Jvf", pack: "items", name: "원념의 주석", type: "etc", coverage: "assisted",
    note: "폭주를 조기 해제하면 보정도 수동 해제", spec: {
      ...use("scene", attr("attack", "-", "2d10")),
      conditions: [condition("instant", "self", "berserk")],
      encroach: {value: "3"},
    }},
  {id: "bdGsqKq8TwF0xF93", pack: "items", name: "싸이코 부스트", type: "etc", coverage: "full", spec: {
      ...use("round", attr("stat_dice", "rc", "+5")),
      conditions: [
        condition("instant", "self", "rigor"),
        condition("instant", "self", "poisoned", {poisonedRank: "2"}),
      ],
    }},
  {id: "syjwC4zuWQ3UCOzT", pack: "items", name: "네버 다이", type: "etc", coverage: "full", spec: {
      heal: {formulaAdd: "4d10", timing: "instant", target: "self", encroachFixed: "", resurrect: false, rivival: true, activate: true},
    }},
  {id: "VHxRk0sPKvCzJRd4", pack: "items", name: "A랭크:어택커", type: "etc", coverage: "assisted",
    note: "명중판정 전에 선언해야 데미지 카드에 반영", spec: use("major", attr("attack", "-", "+4"))},
  {id: "r2Nc00WqRqt9PnXo", pack: "items", name: "A랭크:서포터", type: "etc", coverage: "full", spec: {
      ...target("roll", attr("dice", "-", "+2")),
      manualTargetOtherOnly: true,
    }},
  {id: "NCN2D02awQHL6rl6", pack: "items", name: "셀 스태프 : 어썰트", type: "etc", coverage: "full",
    spec: use("major", attr("attack", "-", "+3"))},
  {id: "2v2i4qjtQDBM5HX0", pack: "items", name: "셀 스텝 : 아사르트", type: "etc", coverage: "full",
    spec: use("major", attr("attack", "-", "+3"))},
  {id: "TOzzLGr4M1Uf4PZp", pack: "items", name: "하우스 오브 데몬즈", type: "etc", coverage: "full",
    spec: target("round", attr("init", "-", "+5"))},
  {id: "ItgGUzwLX1VDcPnK", pack: "items", name: "유니크 코트", type: "etc", coverage: "full",
    spec: target("scene", attr("major_dice", "-", "+2"))},
  {id: "JJQ1wBcaEYl2c08k", pack: "items", name: "특수급습부대", type: "etc", coverage: "full",
    spec: use("roll", attr("dice", "-", "+5"))},
  {id: "zKhkazrohG7Woqil", pack: "items", name: "폴른 스트라이프", type: "etc", coverage: "full",
    spec: target("roll", attr("dice", "-", "+3"))},
  {id: "kUzaziNlTiSxzbgM", pack: "items", name: "포어시 사이트", type: "etc", coverage: "assisted",
    note: "사격공격에만 선언", spec: target("reaction",
      attr("reaction_critical", "-", "+1"),
      attr("reaction_dice", "-", "-2")
    )},
];

const BY_ID = new Map(mechanizationEntries.map(entry => [entry.id, entry]));
if (BY_ID.size !== mechanizationEntries.length) throw new Error("설명효과 기계화 대상 ID가 중복됐다");

function attrObject(itemId, channel, entries) {
  return Object.fromEntries(entries.map((entry, index) => {
    const id = crypto.createHash("sha256")
      .update(`description-mechanization\0${itemId}\0${channel}\0${index}\0${entry.key}\0${entry.label}`)
      .digest("hex").slice(0, 16);
    return [id, structuredClone(entry)];
  }));
}

function usableAttributes(attributes) {
  return Object.values(attributes || {}).filter(row =>
    row?.key && row.key !== "-" && String(row.value ?? "").trim() !== ""
  );
}

function writeAttributes(doc, ctx, channel, entries) {
  const path = channel === "self" ? "system.attributes" : "system.effect.attributes";
  const current = channel === "self" ? doc.system?.attributes : doc.system?.effect?.attributes;
  const desired = attrObject(doc._id, channel, entries);
  if (usableAttributes(current).length > 0 && JSON.stringify(current) !== JSON.stringify(desired)) {
    ctx.fail(`${doc.name}: ${path}에 예상하지 않은 기존 보정이 있다`);
    return false;
  }
  if (channel === "self") doc.system.attributes = desired;
  else {
    doc.system.effect ??= {};
    doc.system.effect.attributes = desired;
  }
  return true;
}

function setExtension(doc, ctx, key, value) {
  doc.flags ??= {};
  doc.flags["dx3rd-emanim"] ??= {};
  const scope = doc.flags["dx3rd-emanim"];
  scope.itemExtend ??= {};
  const current = scope.itemExtend[key];
  if (current !== undefined && JSON.stringify(current) !== JSON.stringify(value)) {
    ctx.fail(`${doc.name}: itemExtend.${key}에 예상하지 않은 기존 값이 있다`);
    return;
  }
  scope.itemExtend[key] = structuredClone(value);
}

export function migrate(doc, ctx) {
  const entry = BY_ID.get(doc._id);
  if (!entry) return;
  if (ctx.pack !== entry.pack || doc.name !== entry.name || doc.type !== entry.type) {
    ctx.fail(`${doc._id}: 예상 ${entry.pack}/${entry.name}/${entry.type}, 실제 ${ctx.pack}/${doc.name}/${doc.type}`);
    return;
  }

  const spec = entry.spec;
  if (spec.attributes && !writeAttributes(doc, ctx, "self", spec.attributes)) return;
  if (spec.targetAttributes && !writeAttributes(doc, ctx, "target", spec.targetAttributes)) return;
  if (spec.active) doc.system.active = {...doc.system.active, ...structuredClone(spec.active)};
  if (spec.effect) {
    doc.system.effect ??= {};
    Object.assign(doc.system.effect, structuredClone(spec.effect));
  }
  if (spec.getTarget !== undefined) doc.system.getTarget = spec.getTarget;
  if (spec.encroach) {
    doc.system.encroach ??= {};
    Object.assign(doc.system.encroach, structuredClone(spec.encroach));
  }
  if (spec.conditions) setExtension(doc, ctx, "condition", {conditions: spec.conditions});
  if (spec.statusClear) setExtension(doc, ctx, "statusClear", spec.statusClear);
  if (spec.heal) setExtension(doc, ctx, "heal", spec.heal);
  if (spec.manualTargetOtherOnly) {
    doc.flags ??= {};
    doc.flags["dx3rd-emanim"] ??= {};
    doc.flags["dx3rd-emanim"].manualTargetOtherOnly = true;
  }
}
