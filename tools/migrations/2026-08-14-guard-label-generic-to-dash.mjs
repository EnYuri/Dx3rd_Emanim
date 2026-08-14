// 가드치 보정 행의 라벨 「guard」 → 「-」.
//
// `2026-08-14-attack-label-generic-to-dash.mjs` 와 같은 정리다. 그때는 `attack` 만 라벨에
// 뜻이 있었으나, 가드치에도 무기 종류 버킷이 생겼다 — actor.js 의
// `R.bucket('guard', ['melee','ranged','fist'])` 가 이 값으로 「그 무기로 가드할 때만」을
// 가른다(`-`/무라벨 = 전체, 나머지 = 그 종류 한정). 「맨손의 가드치에 +3」(특수장갑의수 등)을
// 표현할 수단이 그전에는 없었다.
//
// 빌더의 공용 행 조립기(`_source/apply-overrides.mjs` 의 `attrRow`)가 라벨 기본값을 키
// 이름으로 두고 있어 명시 저작이 없는 가드 행에 `label: "guard"` 가 굳어 있다.
// `bucket()` 은 목록에 없는 라벨을 전체(`_`)로 넘기므로 **동작은 `-` 와 완전히 같지만**,
// 확장 도구의 종류 드롭다운에는 그 값이 없어 칸이 빈 채로 보인다.
//
// 값의 의미가 바뀌는 행은 하나도 없다. 실제 종류 한정으로 옮길 행(맨손 한정 가드치 등)은
// 이 마이그레이션이 아니라 별도의 저작 마이그레이션이 다룬다 — 여기서 섞으면 「표기 통일」과
// 「의미 변경」이 한 diff 에 들어가 검토할 수 없게 된다.
//
// 빌더도 같은 규칙으로 고쳤으므로 재빌드가 옛 표기를 되살리지 않고, 회수
// (`recover-pack-edits`)가 이 결과를 손튜닝으로 오인해 오버라이드에 못박지도 않는다.

export const description = "가드치 보정 행의 라벨 'guard' 를 '-'(전체)로 통일";

/** 무기 종류 버킷으로 실제 의미가 있는 라벨. 이 값들은 저작이므로 손대지 않는다. */
const MEANINGFUL = new Set(["melee", "ranged", "fist"]);

export function migrate(doc, ctx) {
  // 자기 채널(system.attributes)과 대상 채널(system.effect.attributes) 둘 다 같은 어휘를 쓰고,
  // 대상 채널의 행도 대상 액터의 prepareData 에서 같은 bucket() 을 통과한다.
  for (const map of [doc.system?.attributes, doc.system?.effect?.attributes]) {
    if (!map || typeof map !== "object") continue;
    for (const row of Object.values(map)) {
      if (!row || typeof row !== "object") continue;
      if (row.key !== "guard") continue;
      if (row.label === undefined || row.label === null) continue;
      if (row.label === "-" || MEANINGFUL.has(row.label)) continue;
      // 「guard」 이외의 뜻 모를 라벨이 있으면 조용히 삼키지 않고 보고한다 —
      // bucket() 이 전체로 넘기므로 동작은 같지만, 저작 의도였다면 알아야 한다.
      if (row.label !== "guard") {
        ctx.log(`알 수 없는 가드 종류 라벨 '${row.label}' → '-' 로 통일`);
      }
      row.label = "-";
    }
  }
}
