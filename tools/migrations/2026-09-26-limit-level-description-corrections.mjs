// Field corrections beyond encroach, verified against the printed books:
//   봉인의 주술 — 제한 누락 (이펙트 아카이브 p.29: 제한 80%)
//   자유자재의 척력 — 이동량·최대LV 필기 오류 (인피니티 코드 p.43: [Lv×5]m, LV10)

export const description =
  "봉인의 주술 limit 80%, 자유자재의 척력 [Lv×3]→[Lv×5]m + level.max 5→10";
export const packs = ["effects"];
export const idempotent = true;

const clean = (name) => String(name ?? "").replace(/\|\|.*$/, "").trim();

export function migrate(doc, ctx) {
  if (doc.type !== "effect") return;
  const name = clean(doc.name);
  const s = doc.system;
  if (!s) return;

  if (name === "봉인의 주술") {
    if (s.limit !== "80%") s.limit = "80%";
    return;
  }

  if (name === "자유자재의 척력") {
    if (s.description?.includes("[Lv×3]m")) {
      s.description = s.description.replace("[Lv×3]m", "[Lv×5]m");
    }
    if (s.level && s.level.max !== 10) s.level.max = 10;
    return;
  }
}
