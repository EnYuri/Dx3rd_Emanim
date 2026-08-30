// 방어 무시(장갑/가드/리액션)와 그 무효화를 컴펜디움에 저작한다.
//
// 대상은 **이름을 명시**한다. 「설명에 '장갑치를 무시'가 있으면」 같은 술어로 잡으면 정반대인
// 문서까지 걸린다 — 실제로 술어 초안이 75건을 잡았고 그중 28건이 오탐이었다:
//   《죽음의 점》《사점격》 = "장갑치를 무시하는 이펙트와 **조합했을 경우에만** 효과" (자신은 무시하지 않음)
//   《변환자재의 칼날》 = "맨손을 사용한 **가드를 할 수 없게 된다**" (자신에게 거는 제약)
//   《그래비티 앱소버》 = "가드를 실행할 수 없는 공격이 명중한 직후... **데미지를 3D10점 경감**" (경감이지 무시가 아님)
//   《마그넷 체인》《비호하는 짐승》《에너지 실드》 = 무시를 **인용**할 뿐, 실제로는 무효화 쪽
//   《수왕의 헌신》《스피드 스타》《호밍 히트》《복수의 칼날》 등 = "**당신은** 리액션을 할 수 없다" (자기 제약)
//
// 여기 담은 것은 「그 공격에 조합되어 무조건 걸리는」 것뿐이다. 선언형·지속형은 제외했다
// (아래 EXCLUDED 참조) — 런타임의 동결은 공격 아이템·콤보 구성원·등록 무기만 훑으므로,
// 별도로 선언하는 아이템에 플래그를 켜면 아무 데도 안 걸리거나 반대로 무조건 걸린다.

export const description = "방어 무시(장갑/가드/리액션)와 무효화 플래그를 팩에 저작";
export const packs = ["effects", "weapons", "items"];

/**
 * 제외한 것과 그 근거. 코드가 읽지는 않지만, 다음에 같은 감사를 할 사람이 여기서 멈추도록 남긴다.
 *
 * 선언형·지속형(런타임이 공격에 결속하지 못한다):
 *   《자전의 칼날》"대상이 다음에 실행할 공격", 《파괴의 과동》"그 씬 동안", 《프리즘 브레이크》"사용한 라운드에서",
 *   《환상의 수왕》"그 라운드", 《요격하는 마안》"다음에 받을 공격", 《장갑관통》"데미지 롤 직전에 사용",
 *   《제로 그라비톤》《세계의 적》"대상이 닷지나 가드를 선언할 시 사용", 《인피티니 이클립스》"사용하기 직전에 사용",
 *   《브레이커》"공격 직전에 사용", 《총알》"마이너 액션으로 사용", 《No.59 잊을 수 없는 사람》"데미지 롤 직전에 선언",
 *   무기 《히트 윕》《로켓 런처》《소형부유포》《라이트닝 카운트》《개시어스 블레이드》(선언·마이너·조건부).
 *
 * 표현할 어휘가 없는 것:
 *   《시저 리퍼》"장갑치가 가장 높은 방어구 **하나**의 장갑치를 무시"(부분),
 *   《폭식하는 뱀》"**이펙트의 효과를 통해서 획득한** 장갑치를 무시"(출처 한정),
 *   《무적의 육체》"GM이 따로 설정한 약점을 공격하면"(GM 재량),
 *   《플래시 스팅어》"장갑치를 [LVx8]만큼 무시"(수치 관통 = 기존 penetrate 가 맞다).
 */
const EXCLUDED = null;
void EXCLUDED;

/** pack → name → {bypass?: string[], restore?: string[]} */
const TARGETS = {
  effects: {
    // 장갑치 무시 — 전부 "이 이펙트를 조합한/조합하는 공격" 또는 이펙트 자신이 실행하는 공격.
    "강철의 턱": { bypass: ["armor"] },
    "결합분쇄": { bypass: ["armor"] },
    "굶주린 늑대의 턱": { bypass: ["armor"] },
    "말의 칼날": { bypass: ["armor"] },
    "망자의 조아": { bypass: ["armor"] },
    "목마름의 주인": { bypass: ["armor"] },
    "붕괴의 인과": { bypass: ["armor"] },
    "사이렌의 마녀": { bypass: ["armor"] },
    "실체 없는 일격": { bypass: ["armor"] },
    "아랑의 턱": { bypass: ["armor"] },
    "암흑의 창": { bypass: ["armor"] },
    "울부짖는 손톱": { bypass: ["armor"] },
    "인스턴트 봄": { bypass: ["armor"] },
    "절대적인 공포": { bypass: ["armor"] },
    "진동구": { bypass: ["armor"] },
    "칠흑의 주먹": { bypass: ["armor"] },
    "크리스탈라이즈": { bypass: ["armor"] },
    "페니트레이트": { bypass: ["armor"] },
    "피어싱": { bypass: ["armor"] },
    "핀 포인트 레이저": { bypass: ["armor"] },
    // 가드 불가 — "이 이펙트를 조합한 공격에 대해서는 가드를 실행할 수 없다".
    // 《광속의 검》의 "은밀 상태일 때 사용할 수 있다" 는 사용 조건이지 무시의 조건이 아니다.
    "관통하는 팔": { bypass: ["guard"] },
    "광속의 검": { bypass: ["guard"] },
    "도플갱어": { bypass: ["guard"] },
    "운명의 번개": { bypass: ["guard"] },
    "천쇄의 빛": { bypass: ["guard"] },
    "침투격": { bypass: ["guard"] },
    "킬링 퍼퓸": { bypass: ["guard"] },
    "배리어 크래커": { bypass: ["armor", "guard"] },
    // 리액션 불가 + 커버링해도 가드 불가. 두 축을 모두 켜는 것은 원문이 둘을 따로 말하기
    // 때문이다 — 가드는 판정이 아니라 선언이라 "리액션 불가" 만으로는 막히지 않는다.
    "사신의 손톱": { bypass: ["guard", "reaction"] },
    "짐승의 왕": { bypass: ["guard", "reaction"] },
    "스타라이크 미라쥬": { bypass: ["guard", "reaction"] },
    "종언의 잔향": { bypass: ["guard", "reaction"] },
    "울트라 봄버": { bypass: ["reaction"] },
    // 무효화. 가드 쪽 셋은 "「리액션을 실행할 수 없다」거나 「가드를 실행할 수 없다」…에 대해서도
    // **가드를** 실행할 수 있다" 이고, 《전지의 파편》만 "…**닷지를** 실행할 수 있다" 이다.
    "마그넷 체인": { restore: ["guard"] },
    "비호하는 짐승": { restore: ["guard"] },
    "에너지 실드": { restore: ["guard"] },
    "전지의 파편": { restore: ["reaction"] }
  },
  weapons: {
    // "이 무기를 사용한 …공격은" — 무조건이므로 등록 무기 경로로 그대로 실린다.
    "레이저 라이플": { bypass: ["armor"] },
    "전차포": { bypass: ["armor"] },
    "수어사이드 삐에로": { bypass: ["armor"] },
    "메카니컬 피스트": { bypass: ["guard"] },
    "화염방사기": { bypass: ["guard"] },
    "대전차 미사일": { bypass: ["guard"] },
    "안티 마테리얼 라이플": { bypass: ["guard"] },
    "레일 건": { bypass: ["guard"] },
    "디스트로이어": { bypass: ["armor", "guard"] }
  },
  items: {
    // 《이지스 링》"장갑치가 유효한 상태로 데미지를 산출한다".
    "이지스 링": { restore: ["armor"] }
  }
};

export function migrate(doc, ctx) {
  const spec = TARGETS[ctx.pack]?.[doc.name];
  if (!spec) return;

  // 읽는 조건과 쓰는 값을 같은 식으로 두어(`!== true` → `= true`) 재실행이 0건이 되게 한다.
  for (const [field, axes] of [["bypassDefense", spec.bypass], ["restoreDefense", spec.restore]]) {
    if (!axes) continue;
    doc.system ??= {};
    doc.system[field] ??= {};
    for (const axis of axes) {
      if (doc.system[field][axis] !== true) doc.system[field][axis] = true;
    }
  }
}
