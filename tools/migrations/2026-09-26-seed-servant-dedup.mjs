// effects 팩의 `붉은 강의 종복`(`8vjw56tO9ymXX9My`, 종자 전용 이펙트 폴더)은
// `적하의 종복`(`n2Eylhc3GCDUcShf`, 브람 스토커 폴더)과 동일한 이펙트의 번역명 차이
// 사본이다 — 룰 북 브람 스토커 목록은 「붉은 강의 종복」, 이펙트 아카이브 p.28 종자 전용
// 목록은 「적하의 종복」으로 싣는다(종자 능력치 +[LV], 취득 시 기본 침식률 +3, 상시/LV5/
// 침식치 - 동일). 생존 사본인 `적하의 종복`은 동일한 getTarget+manualTargetOtherOnly
// 종자 대상 메커니즘과 오버라이드 등재를 이미 갖추고 있다.
export const description = "effects 팩 붉은 강의 종복(=적하의 종복 별명 사본) 1건을 제거한다";
export const packs = ["effects"];

const DELETE = new Map(Object.entries({
  "8vjw56tO9ymXX9My": "붉은 강의 종복",
}));

export function migrate(doc, ctx) {
  const deleteName = DELETE.get(doc._id);
  if (!deleteName) return;
  if (doc.name !== deleteName) {
    ctx.fail(`삭제 대상 이름이 예상과 다르다: ${JSON.stringify(doc.name)} (예상 ${JSON.stringify(deleteName)})`);
    return;
  }
  ctx.delete();
}
