// 드롭다운의 임시 선택값(`weaponTmp`/`effectTmp`)을 스키마 기본값 `-` 로 되돌린다.
//
// 이 두 필드는 「무기 추가」·「이펙트 추가」 버튼이 읽어 가는 **드롭다운의 현재 선택**일
// 뿐이고, 실제 등록분은 `system.weapon` / `system.effectIds` 배열이다. 그런데 시트의
// 그 드롭다운에 저장 기본값 `-` 에 해당하는 `<option>` 이 없어서, 값이 `-` 이면 브라우저가
// 첫 항목(가상 무기 `virtual-melee`)을 보여 주고 AppV2 의 submitOnChange 가 그 표시값을
// 문서에 굳혔다 — 시트를 열어 아무 칸이나 건드리는 것만으로.
//
// 그 결과 컴펜디움 문서와 액터 사본이 이 필드 하나 때문에 영구히 어긋나, 데이터 갱신이
// 매번 같은 아이템을 「갱신 필요」로 잡았다. 빠진 `<option value="-">` 는 네 템플릿에
// 넣어 재발을 막았고(combo/psionic/effect-workspace 의 weaponTmp, combo 의 effectTmp),
// 이 마이그레이션은 이미 굳어 버린 값을 정리한다.
//
// 실측(2026-08-14): 팩에서 걸린 13건은 전부 `weapon: []` · `attackRoll: "-"` 로, 등록
// 무기도 공격 이펙트도 아니었다 — 저작이 아니라 표시값이 새어 들어온 것이 분명하다.

export const description =
  "드롭다운 임시 선택값 weaponTmp/effectTmp 를 스키마 기본값 '-' 로 정리";

/** 임시 선택값 필드. 값에 의미가 없고 스키마 기본은 모두 '-' 다. */
const SCRATCH_FIELDS = ["weaponTmp", "effectTmp"];

export function migrate(doc, ctx) {
  const system = doc.system;
  if (!system || typeof system !== "object") return;

  for (const field of SCRATCH_FIELDS) {
    if (!(field in system)) continue;
    const current = system[field];
    if (typeof current !== "string" || current === "-") continue;

    // 안전 확인: 임시값이 실제 등록 목록에 있든 없든 이 필드 자체는 표시 상태일 뿐이다.
    // 다만 「등록분이 있는데 임시값만 지운다」가 아님을 리포트로 남겨 둔다.
    const registered = field === "weaponTmp" ? system.weapon : system.effectIds;
    if (Array.isArray(registered) && registered.length) {
      ctx.log(`${doc.name}: ${field} 를 정리하지만 등록 목록 ${registered.length}건은 유지한다`);
    }
    // 읽는 조건(`!== '-'`)을 결과가 무너뜨리므로 두 번 돌려도 0건이다.
    system[field] = "-";
  }
}
