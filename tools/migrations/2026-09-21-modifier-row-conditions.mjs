// 「[폭주]를 받고 있는 동안」「배드 스테이터스를 받고 있는 동안」처럼 상태 조건이 있는
// 상시 보정 6건의 자기 보정 행에 condition 을 심는다. 지금까지는 조건 없이 저장돼 토글을
// 켜는 순간 조건과 무관하게 항상 적용됐다(문언과 다름).
// 런타임: DX3rdRuntimeUtils.modifierConditionHolds 가 행의 condition 을 수치 합산 시점에
// 받는 액터의 system.conditions 와 대조한다 — 'badStatus' 는 어느 BS든 하나라도 활성이면 참.
// 재빌드 기준은 _source/effect-mech-overrides.json 의 같은 행에 적어 둔 condition 이다.
export const description = "상태 조건이 있는 상시 보정 6건의 보정 행에 condition(berserk/badStatus) 부여";
export const packs = ["effects"];
export const idempotent = true;

export const entries = [
  {id: "0FnKxCTyVmoUGOpo", pack: "effects", name: "렉클리스 포스", attrId: "p5cu7Y0RumAaijo8", condition: "berserk"},
  {id: "O7FsDptCQ7xwKlj3", pack: "effects", name: "야만적인 본능", attrId: "9jWBACBZuz7voeMq", condition: "berserk"},
  {id: "CXOHZ4oqsuiHgd5C", pack: "effects", name: "와일드 파이어", attrId: "Tp0q5Xb34HN8ydls", condition: "berserk"},
  {id: "SdiHLBTAYB4RkxZQ", pack: "effects", name: "거절영역", attrId: "uhEWmgCXwpz1Ks1U", condition: "berserk"},
  {id: "tDWSMmIUBPrixAQ1", pack: "effects", name: "절대영도", attrId: "LGHFTY8Fa2qAyujq", condition: "berserk"},
  {id: "IENd9YCLXm3wHs69", pack: "effects", name: "홍련의 증오", attrId: "bUyiaBFKL1Khgplp", condition: "badStatus"},
];
const byId = new Map(entries.map(entry => [entry.id, entry]));

export function migrate(doc, ctx) {
  const entry = byId.get(doc._id);
  if (!entry) return;
  if (ctx.pack !== entry.pack || doc.name !== entry.name) {
    ctx.fail(`${doc._id}: expected ${entry.pack}/${entry.name}`); return;
  }
  const row = doc.system?.attributes?.[entry.attrId];
  if (!row || typeof row !== "object") {
    ctx.fail(`${entry.name}: attribute row ${entry.attrId} missing`); return;
  }
  row.condition = entry.condition;
}
