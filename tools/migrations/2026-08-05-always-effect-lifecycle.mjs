// 상시(timing='always') 이펙트의 자기 채널 수명 교정.
//
// 배경 — `inferAction` 에서 effect 타입의 자기 보정이 '활성화' 버킷이 되는 유일한 경로는
// `timing === 'always'` 폴백이다(컴펜디움 전수: 명시 `active.action`/`applyMode` 저작 0건).
// 그 폴백에 걸리는 40건 중 29건이 `active.disable` 을 `-` 가 아닌 값으로 들고 있었다.
// 활성화 버킷의 수명은 소멸 훅이 `active.state` 를 내리는 시점이므로, 원문에 꺼지는 조건이
// 없는 상시 이펙트가 씬/메이저 종료에 조용히 꺼지고 다음 씬에는 손으로 다시 켜야 했다.
//
// 원문(룰북 설명문) 기준으로 세 갈래로 나눈다:
//   ① 끄는 조건이 없는 상시            → disable: '-'                     (18건)
//   ② 원문이 지속 범위를 못박은 것      → 그 범위에 맞는 수명으로 교정      (백스탭 1건)
//   ③ 다른 이펙트와 조합해 쓰는 것      → 활성화가 아니라 '사용 시' 버킷으로 (스파크 스텔라 1건)
// 조건부 상시 9건(폭주 중·그 라운드 이동 시·《용린》 사용 메인)은 수동 on/off 가 조건 판정을
// 대신하므로 손대지 않는다.
//
// `_id` 로 지목하고 이름까지 대조한다 — 동명 문서(초인적약점II/2 처럼 표기만 다른 중복,
// 『레니게이드 어지』계열의 동명 카드)가 실재하므로 이름만으로 잡으면 엉뚱한 문서를 친다.

export const description =
  "상시 이펙트 20건의 자기 채널 수명 교정(무조건 상시 18건 → '-', 백스탭 → main, 스파크 스텔라 → 사용 시)";

export const packs = ["effects"];

/** 끄는 조건이 원문에 없는 상시 — 자기 보정이 꺼질 이유가 없다. */
const ALWAYS_ON = {
  "0e1Zce3L292dj8Ks": "붕괴의 고동",      // 맨손 공격력 +[Lv×2]
  "5OwdzYova3y02zLl": "반사적응",         // 행동치 +[Lv×2]
  "7o9ktYqDdF0HNkoP": "레니게이드 월",    // 받는 데미지에 「항상」 -[Lv×2]
  "C3CQRfUcrdXty2a6": "웨폰 포커스",      // 지정 무기 명중 +[LV] — 지정은 프리플레이 고정
  "GFP2L5j6cFZMDQ2B": "웨폰 마스터리",    // 지정 무기 공격력 +[LV+2] — 위와 같음
  "IxyL5jaIduM3zroi": "라이트 커스텀",    // 취득 시 선택한 효과가 그대로 상시
  "J9Ciuk3ZxRfQQpYB": "강인한 골격",      // 맨손 공격력·가드치 +[LV+1]
  "JuRZucAdI3PSoGRD": "초인적약점II",     // 모든 데미지 [Lv×2] 경감(약점 피격 시 상실은 수동)
  "Nac8KNRGHNlxQkgZ": "스피드 업",        // 행동치 +[LV]
  "Q8hKRtIoKud8BFSz": "빌런 체이서",      // 〈지각〉〈정보:〉 달성치 +[LV+2]
  "QiJCx5SmCylMrEDM": "컴뱃 마스터리",    // 선택 능력치의 명중·닷지 달성치 +[LV×3]
  "Ta4IH5gmFFq827BC": "무적의 육체",      // 장갑치 +[Lv×5]
  "UDBRgvJE0BBbKCos": "고속이동",         // 전투이동거리 +[Lv×5]m
  "ZGPsTUKQIuA4puCq": "휴먼즈 네이버",    // 충동판정 다이스 +[LV]
  "chujPlXG0RVMdvU5": "초인적약점2",      // 초인적약점II 와 같은 내용의 별도 문서
  "ewzM3JQPbnvn3nKn": "선수필승",         // 행동치 +[LV×3]
  "gqp9g6mlv15KfABZ": "회색 뇌세포",      // 행동치 +【정신】
  "umvd4wcCSKh3simk": "사이버 렉"         // 전투이동거리 +[LV×2]m
};

/** 원문이 지속 범위를 못박은 것 — 그 범위에 맞는 수명으로. */
const SCOPED = {
  // 「《축지》를 사용한 메인 프로세스 동안」. scene 은 원문보다 길다.
  "oeF1xAJp7DjxhMG1": { name: "백스탭", disable: "main" }
};

/**
 * 활성화가 아니라 '사용 시' 버킷이 맞는 것.
 * 《포톤 블리츠》와 조합해 쓰는 이펙트라, 켜 두면 무관한 공격에도 +[LV×2] 가 붙는다.
 * 시트 카드의 액션 변경(`updateAction`)과 같은 두 필드를 쓴다 — action 을 활성화 이외로
 * 두면 applyMode 는 'onUse'(동결 채널)여야 한다. 동결 버프의 수명은 그 판정에 걸리므로
 * 씬이 아니라 메이저로 좁힌다.
 */
const USE_BUCKET = {
  "VmCc65XcF5KKHiA3": { name: "스파크 스텔라", disable: "major" }
};

export function migrate(doc, ctx) {
  if (doc.type !== "effect") return;

  const expected = ALWAYS_ON[doc._id] ?? SCOPED[doc._id]?.name ?? USE_BUCKET[doc._id]?.name;
  if (expected === undefined) return;
  if (doc.name !== expected) {
    ctx.fail(`_id ${doc._id} 의 이름이 「${expected}」가 아니라 「${doc.name}」 — 대상 문서가 아니다`);
    return;
  }
  // 이 교정의 전제는 「활성화 버킷으로 잡히는 상시 이펙트」다. 폴백 조건이 바뀌었거나
  // 데이터가 달라졌다면 손대지 않고 알린다.
  if (doc.system?.timing !== "always") {
    ctx.fail(`「${doc.name}」의 timing 이 always 가 아니다(${doc.system?.timing}) — 전제가 깨졌다`);
    return;
  }

  doc.system.active ??= {};
  const active = doc.system.active;

  if (ALWAYS_ON[doc._id] !== undefined) {
    if (active.disable !== "-") active.disable = "-";
    return;
  }
  if (SCOPED[doc._id]) {
    const { disable } = SCOPED[doc._id];
    if (active.disable !== disable) active.disable = disable;
    return;
  }

  const { disable } = USE_BUCKET[doc._id];
  if (active.action !== "use") active.action = "use";
  if (active.applyMode !== "onUse") active.applyMode = "onUse";
  if (active.disable !== disable) active.disable = disable;
}
