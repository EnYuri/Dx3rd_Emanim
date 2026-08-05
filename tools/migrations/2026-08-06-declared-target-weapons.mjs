// 「명중판정 직전에 선언」하는 무기의 **대상 보정**을 선언 버킷으로 옮긴다.
//
// ## 무엇이 잘못돼 있었나
//
// 두 무기는 상대를 깎는 보정만 있고 자기 보정이 없다:
//   * 폴른 피스톨   — 「명중판정 직전에 **선언하면** 그 공격에 대한 리액션의 크리티컬치 +1.
//                     이 효과는 한 시나리오에 세 번 사용할 수 있다.」 (`reaction_critical +1`)
//   * 발리스틱 나이프 — 「명중판정을 실행하기 직전에 **선언할 것**. 그 공격에 대한 닷지에
//                     4개의 다이스 페널티.」 (`dodge_dice -(4)`)
//
// 그런데 `system.effect.action` 이 비어 있어, `inferAction` 의 대상 채널 폴백
// (`isAttackItem(item) ? 'attack' : 'use'`)이 **'attack'** 을 골랐다. 즉 그 무기로 공격하면
// 선언 없이 **매번 자동으로** 붙었고, 폴른 피스톨은 시나리오 3회라는 제한도 지불되지
// 않았다(선언 경로를 거치지 않으므로 `used.state` 가 오르지 않는다). 「쓸지 말지 고르는
// 것」이 이 계열 장비의 전부인데 그 선택 자체가 없었다.
//
// ## 무엇을 바꾸는가
//
// 대상 채널의 기본 발현 액션을 `use` 로 못박는다. 그러면
//   판정 다이얼로그의 선언 토글 → commit() → handleItemUse(action:'use')
//   → universal-handler 의 applyToTargets(actor, item, 'instant', null, 'use')
//   → targetBucketAttributes(item, 'use') 가 이 행을 집어 game.user.targets 에 건다.
// 전달 경로는 이미 전부 있었다 — 빠져 있던 것은 이 값과, 선언 목록에 넣을 자격 판정
// (`scripts/declared-equipment.js` 의 declaredAttributes 가 자기 채널만 봤다)뿐이다.
// 그 자격 판정은 같은 커밋의 런타임 변경이 대상 채널까지 보도록 고쳤다.
//
// 회수도 이 경로에서 비로소 정산된다(handleItemUse 가 `used.disable !== 'notCheck'` 일 때
// `used.state` 를 올린다). 반대로 그 무기로 **그냥 공격**하는 것은 `isDeclarable` 이 참이
// 되면서 `declarationOnly` 분기에 걸려 아무것도 소모하지 않는다 — 원문 그대로다.
//
// ## 손대지 않은 것
//
// 대상 보정을 가진 나머지 장비(소닉 블리츠·드릴·킨 나이프 츠바이·예리한 나이프·암 블레이드·
// 스피어 스틱·리니어 캐논·불가시의 칼날·데어 프라이쉬츠 등)는 원문에 「선언」이 없는
// **무조건 적용**이므로 `attack` 폴백이 맞는다. 「풀 오토 샷 건」은 이미 행 단위로
// `action: 'use'` 가 저작돼 있어 이 마이그레이션 없이 런타임 변경만으로 선언 목록에 오른다.
// 「커맨드 모빌」은 채널 기본이 이미 `use` 다.
//
// 발리스틱 나이프의 「그 메인 프로세스가 종료됨과 동시에 무기가 파괴된다」는 자동화하지
// 않는다(수동 처리). 파괴는 아이템 삭제/장착 해제라 되돌릴 통로가 없고, 이 시스템의
// 확장 도구 어휘에 그 동작이 없다.
//
// 변경 잎은 `system.effect.action` 하나뿐이다. 대상은 `_id` 로 못박는다.

export const description = "선언형 무기 2건의 대상 보정을 선언(use) 버킷으로 이동";

export const packs = ["weapons"];

const DECLARED = {
  "WW8JbVUfUSesxbRd": "폴른 피스톨",
  "UrXCA4yRIHnKNBaS": "발리스틱 나이프",
};

export function migrate(doc, ctx) {
  if (!DECLARED[doc._id]) return;
  const effect = doc.system?.effect;
  if (!effect) return;
  effect.action = "use";
}
