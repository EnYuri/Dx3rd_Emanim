// Correct encroach.init (acquisition-time base encroachment) and
// encroach.value (per-use 침식치 cost) against the printed rulebooks.
//
// Sources: PDF stat blocks extracted from _source/Rule/** (tmp/stat-blocks.jsonl)
// verified column-by-column, plus each effect's body text "기본 침식률에 +N".
// See the audit report in the session notes / tmp/encroach-audit.md.

export const description =
  "encroach corrections: init from body-text 기본 침식률 (5 items), value from book 침식치 (12 items)";
export const packs = ["effects"];
export const idempotent = true;

// name (clean, no || suffix) -> patch applied to system.encroach
const FIXES = new Map([
  // ── init: body text "취득 시 기본 침식률에 +N" was never transcribed ──
  ["데스스토커", { init: 5 }],
  ["로큰롤 비트", { init: 4 }],
  ["붕괴의 고동", { init: 4 }],
  ["야만적인 본능", { init: 3 }],
  ["왕자의 피", { init: 3 }],

  // ── value: stat-block 침식치, verified against the printed books ──
  ["겟 다운", { value: "2" }],            // 이펙트 아카이브 p.21 — 리액션 침식치 2
  ["공포의 가호", { value: "5" }],         // 레니게이드 어지 p.29 — 메이저 침식치 5
  ["그래비티 에어리어", { value: "-" }],    // 룰 북 p.210 — 셋업 침식치 -
  ["덧없는 검사", { value: "2" }],         // 룰 북 p.54 / 아카이브 p.33 — 메이저 침식치 2
  ["리프레시", { value: "5" }],            // 룰 북 p.116 / 아카이브 p.103 — 오토 침식치 5
  ["모래의 기사단", { value: "2d10" }],    // 레니게이드 워 p.8 — 셋업 침식치 2D10
  ["베이식 리서치", { value: "2" }],       // 룰 북 p.74 / 아카이브 p.55 — 메이저 침식치 2
  ["블러드 인게이지", { value: "4" }],     // 레니게이드 어지 p.31 — 메이저 침식치 4
  ["이터널 블레이즈", { value: "4" }],     // 링케이지 마인드 p.56 / 상급 룰 p.30 — 셋업 침식치 4
  ["자유자재의 척력", { value: "-" }],     // 인피니티 코드 p.43 — 이니셔티브 침식치 -
  ["진상고백", { value: "-" }],            // 레니게이드 워 p.9 — 메이저 침식치 -
  ["크레이지 드라이브", { value: "4" }],   // 레니게이드 워 p.3 — 메이저 침식치 4
]);

const clean = (name) => String(name ?? "").replace(/\|\|.*$/, "").trim();

export function migrate(doc, ctx) {
  if (doc.type !== "effect") return;
  const fix = FIXES.get(clean(doc.name));
  if (!fix) return;
  const enc = doc.system?.encroach;
  if (!enc || typeof enc !== "object") {
    ctx.fail("system.encroach missing");
    return;
  }
  if (fix.init !== undefined && enc.init !== fix.init) enc.init = fix.init;
  if (fix.value !== undefined && enc.value !== fix.value) enc.value = fix.value;
}
