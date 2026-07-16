import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const EFFECTS_DIR = path.join(ROOT, "_source", "effects");

// 플레이버 텍스트상 현재 조합의 수치가 아니라 별도의 지속/후속 효과다.
const KEEP_ATTACK_ATTRIBUTE = new Set([
  "수정의 검",
  "주홍색의 큰 도끼",
  "프리즈 스파이크"
]);

// 메이저 이외 타이밍이지만, 플레이버 텍스트상 이펙트와 조합한 바로 그 판정의 수정치다.
const COMBINED_ADD_OUTSIDE_MAJOR = new Set([
  "발도",
  "엑스 마키나",
  "혼돈의 주인"
]);

// 기존 자동화에서 빠진 직접 공격. 선택 무기 수처럼 현재 수식 평가기로 표현할 수 없는
// 공격력은 여기서 억지로 근사하지 않는다.
const ATTACK_VALUE_OVERRIDES = new Map([
  ["강마의 번개", "+[level]*4"],
  ["대지의 이빨", "+[level]+2"],
  ["마수의 충격", "+5"],
  ["무기적인 사지", "+[level]+4"],
  ["사신의 바늘", "+[level]*2"],
  // 기존 자동화 값보다 플레이버 텍스트를 우선한다.
  ["대재단", "+[level]*3"],
  ["블래스트 포커스", "+[level]*4"],
  ["돌팔매", "+4"],
  ["리코셰 레이저", "-5"],
  ["붕괴의 나선", "+[level]*5"],
  ["신수격", "([level]+2)d10"],
  ["연옥마신", "+[level]*3"],
  ["자이언트 그로우스", "+2d10"],
  ["전신의 축복", "([level]+4)d10"],
  ["칠흑의 파도", "+[level]"],
  ["카마이타치", "-5"],
  ["화염 주머니", "+[level]*3"],
  ["칠흑의 주먹", "+[level]"],
  ["파쇄의 턱", "+[level]*2+2"]
]);

const ADD_VALUE_OVERRIDES = new Map([
  ["애로건스 팽", "-[level]"],
  ["템테이션", "+[level]*2"]
]);

const ATTACK_DICE_ATTRIBUTE_REPLACEMENTS = new Set([
  "신수격",
  "자이언트 그로우스",
  "전신의 축복"
]);

function shouldMove(item, attribute) {
  if (attribute.key === "attack") {
    return item.system.timing === "major" && !KEEP_ATTACK_ATTRIBUTE.has(item.name);
  }
  if (attribute.key === "add") {
    if (item.system.timing === "major") return item.name !== "천사의 계단";
    return COMBINED_ADD_OUTSIDE_MAJOR.has(item.name);
  }
  return false;
}

export function migrateEffectAttackFields(item) {
  const attributes = item.system?.attributes ?? {};
  const moved = [];

  for (const [id, attribute] of Object.entries(attributes)) {
    if (!shouldMove(item, attribute)) continue;
    const field = attribute.key;
    if (item.system[field] !== undefined && String(item.system[field]) !== "0") {
      throw new Error(`${item.name}: system.${field} already contains ${item.system[field]}`);
    }
    item.system[field] = attribute.value;
    delete attributes[id];
    moved.push(`${field}=${attribute.value}`);
  }

  const attackOverride = ATTACK_VALUE_OVERRIDES.get(item.name);
  if (attackOverride && item.system.attack !== attackOverride) {
    item.system.attack = attackOverride;
    moved.push(`attack=${attackOverride} (플레이버 보완)`);
  }

  const addOverride = ADD_VALUE_OVERRIDES.get(item.name);
  if (addOverride && item.system.add !== addOverride) {
    item.system.add = addOverride;
    moved.push(`add=${addOverride} (플레이버 보완)`);
  }
  // 템테이션의 조합 달성치가 과거에는 지속 stat_add로 생성되었다.
  if (item.name === "템테이션") {
    for (const [id, attribute] of Object.entries(attributes)) {
      if (attribute.key === "stat_add" && attribute.label === "negotiation") {
        delete attributes[id];
        moved.push("stat_add:negotiation 제거");
      }
    }
  }
  if (ATTACK_DICE_ATTRIBUTE_REPLACEMENTS.has(item.name)) {
    for (const [id, attribute] of Object.entries(attributes)) {
      if (attribute.key === "damage_roll") {
        delete attributes[id];
        moved.push("damage_roll 제거");
      }
    }
  }

  return moved;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const write = process.argv.includes("--write");
  const changes = [];
  for (const filename of fs.readdirSync(EFFECTS_DIR).filter(name => name.endsWith(".json")).sort()) {
    const filepath = path.join(EFFECTS_DIR, filename);
    const item = JSON.parse(fs.readFileSync(filepath, "utf8"));
    const moved = migrateEffectAttackFields(item);
    if (!moved.length) continue;
    changes.push(`${item.name}: ${moved.join(", ")}`);
    if (write) fs.writeFileSync(filepath, `${JSON.stringify(item, null, 2)}\n`, "utf8");
  }

  console.log(`${write ? "migrated" : "would migrate"} ${changes.length} effects`);
  for (const change of changes) console.log(`- ${change}`);
}
