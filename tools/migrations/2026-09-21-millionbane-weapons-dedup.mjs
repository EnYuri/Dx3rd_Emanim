// weapons 팩에 같은 내용으로 두 벌 들어간 `밀리온베인` 중 _source 에 없는 고아 사본을 제거한다.
//
// - `Y8ETJAwpF1fyZQkY`(`_source/pack-weapons/밀리온베인_Y8ETJAwpF1fyZQkY.json`)를 남긴다.
// - `Pl5R998otIGnVmhm`은 _source 미보유 고아로, 내용은 정본과 동일하다.
// - `packs/items` 의 etc 스텁(`jspwWSTAi3Kr2YEl`, 「무기 - 밀리온베인 취득, 무기 데이터 시트
//   참조」)은 디바우러·강화의체와 같은 취득 지시서 관례이므로 유지한다.
export const description = "weapons 팩 밀리온베인 고아 중복 1건을 제거한다";
export const packs = ["weapons"];

const DELETE = new Map(Object.entries({
  "Pl5R998otIGnVmhm": "밀리온베인",
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
