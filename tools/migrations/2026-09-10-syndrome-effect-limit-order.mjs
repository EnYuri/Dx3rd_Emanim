export const description = "13개 신드롬 폴더의 이펙트를 제한 없음 → 리미트 → 퓨어 브리드 → 80% → 100% → 120% → 충동·기타 제한 순으로 안정 정렬";
export const packs = ["effects"];
export const idempotent = true;

// Only the ordinary syndrome folders are in scope for this first pass. Special,
// enemy, easy-effect, Renegade Being, and D-Lois folders are deliberately left
// untouched.
export const syndromeFolderIds = new Set([
  "DoHEC0pTuT5S8jtE", // 노이만
  "mqhiMCCqdafilBFG", // 모르페우스
  "LLW1Tl3r3Xy41erb", // 발로르
  "TQz8ugQbEYZ8RHOU", // 브람 스토커
  "AprciMjnARZzdBpS", // 블랙 독
  "VNjae2DK5RbhFy3f", // 샐러맨더
  "3PF1fUezfSFyDE77", // 솔라리스
  "Qki5rRjqWkhHC2yy", // 엑자일
  "txHnAtkWGywUuirt", // 엔젤 헤일로
  "gCascc8mwoi1SsjY", // 오르쿠스
  "torKd2eZBYpXYFnT", // 우로보로스
  "F6kwd2lruC5yOhAI", // 키마이라
  "o33hXBAmubl1j3AG", // 하누만
]);

export const SORT_STRIDE = 200_000_000;

export function effectLimitCategory(limit) {
  const value = String(limit ?? "").trim();
  if (!value || value === "-") return 0;
  if (value === "리미트") return 1;
  if (value === "퓨어 브리드") return 2;
  if (value === "80%") return 3;
  if (value === "100%") return 4;
  if (value === "120%") return 5;
  return 6;
}

export function migrate(doc, ctx) {
  if (ctx.pack !== "effects" || doc.type !== "effect" || !syndromeFolderIds.has(doc.folder)) return;

  const category = effectLimitCategory(doc.system?.limit);
  if (category === 0) return; // Preserve unrestricted effects byte-for-byte, including sort.

  const current = Number(doc.sort);
  if (!Number.isSafeInteger(current) || current < 0) {
    ctx.fail(`${doc.name}: 안전하게 정렬할 수 없는 sort 값 (${JSON.stringify(doc.sort)})`);
    return;
  }

  const lower = category * SORT_STRIDE;
  if (current >= lower && current < lower + SORT_STRIDE) return;
  if (current >= SORT_STRIDE) {
    ctx.fail(`${doc.name}: 기존 sort 값이 예약 정렬 구간과 충돌한다 (${current})`);
    return;
  }

  doc.sort = lower + current;
}
