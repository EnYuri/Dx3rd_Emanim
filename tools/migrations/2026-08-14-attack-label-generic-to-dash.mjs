// 공격력 보정 행의 라벨 「attack」 → 「-」.
//
// `attack` 행의 label 은 다른 키와 달리 **뜻이 있는 자리**다 — actor.js 의
// `R.bucket('attack', ['melee','ranged','fist'])` 가 이 값으로 공격 종류 버킷을 가른다
// (`-`/무라벨 = 전체, `melee`/`ranged`/`fist` = 그 종류 한정).
//
// 빌더의 공용 행 조립기(`_source/apply-overrides.mjs` 의 `attrRow`)가 라벨 기본값을
// **키 이름**으로 두고 있어, 명시 저작이 없는 공격력 행에 `label: "attack"` 이 굳어 있었다.
// `bucket()` 은 목록에 없는 라벨을 전체(`_`)로 넘기므로 **동작은 `-` 와 완전히 같지만**,
// 확장 도구의 공격 종류 드롭다운에는 그 값이 없어 칸이 빈 채로 보인다. 뜻이 같은 표기를
// 하나로 모아 그 표시 불일치를 없앤다.
//
// 값의 의미가 바뀌는 행은 하나도 없다. `melee`/`ranged`/`fist` 로 명시 저작된 행과
// 이미 `-` 인 행은 건드리지 않는다.
//
// 빌더도 같은 규칙으로 고쳤으므로(`attrRow` 의 fallback) 재빌드가 옛 표기를 되살리지 않고,
// 회수(`recover-pack-edits`)가 이 결과를 손튜닝으로 오인해 오버라이드에 못박지도 않는다.

export const description = "공격력 보정 행의 라벨 'attack' 을 '-'(전체)로 통일";

/** 공격 종류 버킷으로 실제 의미가 있는 라벨. 이 값들은 저작이므로 손대지 않는다. */
const MEANINGFUL = new Set(["melee", "ranged", "fist"]);

export function migrate(doc, ctx) {
  // 자기 채널(system.attributes)과 대상 채널(system.effect.attributes) 둘 다 같은 어휘를 쓰고,
  // 대상 채널의 행도 대상 액터의 prepareData 에서 같은 bucket() 을 통과한다.
  for (const map of [doc.system?.attributes, doc.system?.effect?.attributes]) {
    if (!map || typeof map !== "object") continue;
    for (const row of Object.values(map)) {
      if (!row || typeof row !== "object") continue;
      if (row.key !== "attack") continue;
      if (row.label === undefined || row.label === null) continue;
      if (row.label === "-" || MEANINGFUL.has(row.label)) continue;
      // 「attack」 이외의 뜻 모를 라벨이 있으면 조용히 삼키지 않고 보고한다 —
      // bucket() 이 전체로 넘기므로 동작은 같지만, 저작 의도였다면 알아야 한다.
      if (row.label !== "attack") {
        ctx.log(`알 수 없는 공격 종류 라벨 '${row.label}' → '-' 로 통일`);
      }
      row.label = "-";
    }
  }
}
