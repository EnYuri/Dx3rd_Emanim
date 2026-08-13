// 전용 D10 개수 보정 키를 일반 수정치의 Foundry Roll 수식으로 옮긴다.
//
// 일반 수정치가 이미 다이스식을 보존해 실제 행동 시 한 번 굴리므로, 아래 전용 키는
// 같은 개념을 두 방식으로 저작하게 만들 뿐이다.
//   damage_roll: N → attack: (N)d10
//   guard_roll:  N → guard:  (N)d10
//   reduce_roll: N → reduce: (N)d10
//   dxroll:      N → add:    (N)d10
//
// damage_roll 은 값이 "추가 데미지 다이스의 개수"다. 값 자체가 1d10 같은 식이어도
// 먼저 그 결과만큼 데미지 다이스를 늘리므로, attack 으로 옮길 때는 `(1d10)d10`처럼
// 동적 다이스 개수로 감싸야 확률분포가 보존된다. 나머지 세 키는 값에 이미 다이스 항이
// 있으면 그 결과를 그대로 가산하고, 결정적 개수일 때만 Nd10 으로 바꾼다.

export const description =
  "전용 D10 보정 damage_roll/guard_roll/reduce_roll/dxroll을 일반 attack/guard/reduce/add 다이스식으로 변환";

// 이 변환은 값을 통째로 감싸므로 원본이 수정치 표기(`+3`)면 `(+3)d10` 이 나온다. 동작은
// 옳지만(괄호 안 선행 `+` 는 Foundry 가 버린다) 읽기 어려워 2026-08-13 에 표기를 정리했다.
// 그 정리를 여기서 함께 태워, 이 마이그레이션을 다시 돌려도 옛 표기가 되살아나지 않게 한다.
import { normalizeDiceCount } from "./2026-08-13-normalize-dice-count-parens.mjs";

const STANDARD_DICE = /(?:^|[^a-z0-9_])\d*\s*d\s*\d+(?=$|[^a-z0-9_])/i;
const DX_DICE = /(?:^|[^a-z0-9_])\d*\s*d\s*x\s*\d+(?=$|[^a-z0-9_])/i;

const CONVERSIONS = {
  damage_roll: { key: "attack", alwaysCount: true },
  guard_roll: { key: "guard", alwaysCount: false },
  reduce_roll: { key: "reduce", alwaysCount: false },
  dxroll: { key: "add", alwaysCount: false }
};
const LEGACY_LABEL_TARGETS = Object.fromEntries(
  Object.entries(CONVERSIONS).map(([source, conversion]) => [source, conversion.key])
);

export function convertedValue(sourceKey, value) {
  const conversion = CONVERSIONS[sourceKey];
  if (!conversion) return value;

  const raw = String(value ?? "").trim();
  if (!raw || raw === "-") return raw;
  if (Number(raw) === 0) return "0";
  if (!conversion.alwaysCount && STANDARD_DICE.test(raw)) return raw;
  return normalizeDiceCount(`(${raw})d10`);
}

function normalizedLabel(sourceKey, label) {
  if (sourceKey !== "damage_roll") return "-";
  return label === "melee" || label === "ranged" ? label : "-";
}

function migrateAttributes(attributes, path, ctx) {
  if (!attributes || typeof attributes !== "object" || Array.isArray(attributes)) return;

  for (const [rowId, row] of Object.entries(attributes)) {
    if (!row || typeof row !== "object" || Array.isArray(row)) continue;
    const value = String(row.value ?? "");
    if (DX_DICE.test(value)) {
      ctx.fail(`${path}.${rowId}.value 에 DX 다이스 수식이 있다: ${JSON.stringify(value)}`);
      continue;
    }

    const sourceKey = row.key;
    const conversion = CONVERSIONS[sourceKey];
    if (!conversion) {
      // 키는 이미 일반 필드인데 라벨만 옛 전용 키인 잔여 데이터도 정리한다.
      if (LEGACY_LABEL_TARGETS[row.label] === sourceKey) row.label = "-";
      continue;
    }

    row.key = conversion.key;
    row.label = normalizedLabel(sourceKey, row.label);
    row.value = convertedValue(sourceKey, row.value);
  }
}

export function migrate(doc, ctx) {
  // 일반/전용 여부와 무관하게 보정 행에 DX 다이스식을 저작한 사례가 있으면 위에서 함께
  // 보고한다. 발견한 문서는 변환하지 않아 데이터가 조용히 0으로 바뀌는 일을 막는다.
  migrateAttributes(doc.system?.attributes, "system.attributes", ctx);
  migrateAttributes(doc.system?.effect?.attributes, "system.effect.attributes", ctx);
}
