// 다이스 개수 자리의 잉여 괄호와 선행 `+` 를 걷어낸다.
//
//   (+3)d10      → 3d10
//   (+[level])d10 → [level]d10
//   (+[level]+1)d10 → ([level]+1)d10       ← 괄호는 남는다(없으면 뜻이 달라진다)
//   (+([level]+1))d10 → ([level]+1)d10
//   ([level]*2)d10 → 그대로
//
// 2026-08-11 의 `dice-only-modifiers-to-formulas` 가 구 `damage_roll` 값을 통째로
// `(...)d10` 으로 감쌌는데, 그 값들이 수정치 표기(`+3`, `+[level]`)였던 탓에 부호까지
// 딸려 들어갔다. **동작은 이미 옳다** — Foundry 의 Roll 문법에서 괄호 안 선행 `+` 는
// `leading` 으로 흡수되고 `-` 일 때만 부호를 뒤집는다(client/dice/grammar.pegjs 의
// `Expression = _ leading:(_ @Additive)* …`, parser.mjs 의 `if (leading === "-")`).
// 그래서 이 마이그레이션은 **값을 바꾸지 않고 표기만 정리한다.**
//
// 괄호를 벗기는 것은 안쪽이 단일 항일 때뿐이다. `[level]+1` 처럼 연산이 있으면
// `[level]+1d10` = level + (1d10) 이 되어 뜻이 완전히 달라진다.
//
// 이어서 값 **전체**의 선행 `+` 도 다이스식에 한해 뗀다(`+2d10` → `2d10`). 비다이스
// 수정치의 `+5` 는 손대지 않는다 — 자세한 근거는 `normalizeDiceFormula` 주석 참조.

export const description =
  "다이스 수식 표기 통일 — 개수 괄호의 잉여 선행 `+`·불필요한 괄호 제거, 다이스식의 선행 `+` 제거(값 변화 없음)";

/** 괄호 안이 그 자체로 완결된 단일 항이라 괄호 없이 써도 같은가. */
const SINGLE_TERM = /^(?:\d+(?:\.\d+)?|\[[^[\]]+\])$/;

/** `(` 로 시작하는 문자열에서 짝이 맞는 `)` 의 인덱스. 없으면 -1. */
function matchParen(text, open) {
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    if (text[i] === "(") depth++;
    else if (text[i] === ")" && --depth === 0) return i;
  }
  return -1;
}

/** 잉여 선행 `+` 와 전체를 한 번 더 감싼 괄호를 제거한 안쪽 수식. */
function simplifyInner(inner) {
  let result = inner.trim();
  // 선행 `+` 는 Foundry 가 버린다. `-` 는 의미가 있으므로 절대 건드리지 않는다.
  while (result.startsWith("+")) result = result.slice(1).trim();
  // `(([level]+1))` 처럼 전체가 한 겹 더 감싸여 있으면 벗긴다.
  while (result.startsWith("(") && matchParen(result, 0) === result.length - 1) {
    result = result.slice(1, -1).trim();
  }
  return result;
}

/**
 * 다이스 개수 자리의 괄호식을 정리한 값. 개수가 괄호가 아닌 항이면 그대로 돌려준다.
 * @param {string} value
 * @returns {string}
 */
export function normalizeDiceCount(value) {
  const raw = String(value ?? "");
  let result = "";
  let i = 0;
  while (i < raw.length) {
    if (raw[i] !== "(") { result += raw[i++]; continue; }
    const close = matchParen(raw, i);
    // 괄호가 닫히지 않았거나 뒤에 `d<면수>` 가 없으면 개수 자리가 아니다 — 손대지 않는다.
    if (close < 0 || !/^[dD]\d/.test(raw.slice(close + 1))) { result += raw[i++]; continue; }
    const inner = simplifyInner(raw.slice(i + 1, close));
    result += SINGLE_TERM.test(inner) ? inner : `(${inner})`;
    i = close + 1;
  }
  return result;
}

const HAS_DICE = /(?:^|[^a-z0-9_])\d*\s*d\s*\d+(?=$|[^a-z0-9_])/i;

/**
 * 다이스식 값의 표기를 팩 관행에 맞춘다 = 개수 괄호 정리 + 선행 `+` 제거.
 *
 * **선행 `+` 는 다이스식에서만 뗀다.** 일반 수정치의 `+5`·`+[level]*2` 는 이 컴펜디움의
 * 확립된 표기이고(보정 행 1107건 중 선행 `+` 616 · 무부호 361), 무부호로 쓰는 키는
 * 따로 있다(`critical_min` 58건 · `penetrate` 38건 · `reduce` 43건 전부 무부호 = 가산이
 * 아니라 값의 성질을 따르는 자리). 그 축을 다이스 표기 통일에 휩쓸어 넣으면 의미가 섞인다.
 * 다이스식 쪽은 반대로 100건 중 98건이 이미 무부호라, 남은 2건이 예외다.
 * @param {string} value
 * @returns {string}
 */
export function normalizeDiceFormula(value) {
  const normalized = normalizeDiceCount(value);
  if (!HAS_DICE.test(normalized)) return normalized;
  let result = normalized;
  while (/^\s*\+/.test(result)) result = result.replace(/^\s*\+\s*/, "");
  return result;
}

function migrateAttributes(attributes) {
  if (!attributes || typeof attributes !== "object" || Array.isArray(attributes)) return;
  for (const row of Object.values(attributes)) {
    if (!row || typeof row !== "object" || Array.isArray(row)) continue;
    if (typeof row.value !== "string") continue;
    const next = normalizeDiceFormula(row.value);
    // 읽는 조건과 쓰는 값이 같은 식이므로 두 번 돌려도 0건이다.
    if (next !== row.value) row.value = next;
  }
}

export function migrate(doc) {
  migrateAttributes(doc.system?.attributes);
  migrateAttributes(doc.system?.effect?.attributes);
  // 최상위 공격력/달성치 필드도 같은 수식 문법을 쓴다.
  for (const key of ["attack", "add"]) {
    const value = doc.system?.[key];
    if (typeof value !== "string") continue;
    const next = normalizeDiceFormula(value);
    if (next !== value) doc.system[key] = next;
  }
}
