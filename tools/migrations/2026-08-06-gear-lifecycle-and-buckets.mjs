// 장비(무기·방어구)의 **상시 보정 수명**과 **장갑 무시 버킷**, 그리고 누락된 사용 제한을 고친다.
//
// ## A. 상시 보정이 씬/메이저 종료에 꺼진다 (17건)
//
// 원문이 「장비하고 있는 동안 …」인 보정이 활성화 버킷(`applyMode: 'toggle'`)에 들어 있는데
// `active.disable` 이 `scene`(대부분) 또는 `major` 다. 그러면:
//   * `scripts/disable-hooks.js:56` — 소멸 훅이 `active.disable === timing` 이면 `active.state` 를
//     내린다. **장착 여부를 보지 않는다.**
//   * `scripts/item-effect-adapter.js:1369` — 다시 켜는 경로는 `updateItem` 훅의 `system.equipment`
//     **변화 시점 하나뿐**이다. 주기적 재동기화가 없다.
// ⇒ 입은 채로 씬이 끝나면 보정이 죽고 **벗었다 다시 입기 전까지 돌아오지 않는다.**
// 2026-08-05 에 이펙트 쪽에서 고친 것과 같은 결함이 장비에 남아 있던 것이다. `-` 로 되돌린다.
//
// **조건이 붙은 것은 손대지 않았다.** 「대상: 단독일 경우」(결투자의 검), 「이펙트를 조합했을
// 경우」(조디악 웨폰·히어로 슈터·배틀 가디언·UGN 전투복 II), 「《카운터》로 명중시킬 경우」
// (라이트닝 카운트), 「은밀 상태에서」(스니킹 슈트), 「이 라운드에 이동했을 경우」(미라쥬 코트)
// 등은 조건 판정을 수동 on/off 가 대신하므로 씬 수명이 오히려 그 운용에 맞는다
// (2026-08-05 상시 이펙트 마이그레이션이 조건부 9건을 남긴 것과 같은 기준).
//
// **키가 원문보다 넓은 것도 뺐다.** 사운드 아머(「리액션의 달성치 +5」인데 `add`), 레니게이드
// 서포터(「이펙트를 사용하는 판정」인데 `add`), 기타(「〈예술:음악〉」인데 `add`), 암드 슈트·
// 어댑트 아머·폴른 개틀링(「백병/사격 한정」인데 `attack`), 암드 스카프. 이들은 지금도 모든
// 판정에 붙는 과다적용이라, 수명만 영구로 바꾸면 그 과다적용이 더 오래 간다. 키를 먼저 좁혀야
// 하므로 이번 범위 밖이다.
//
// 파워 어시스트 아머는 원문이 「한 번 장비하면 그 씬 종료와 동시에 해제」라 `scene` 이 맞다.
//
// ## B. 「장갑치를 무시한다」가 활성화 버킷에 있다 (5건)
//
// 원문은 전부 「**이 무기를 사용한** 공격은 …」이다. 활성화 버킷이면 그 무기를 들고 **다른**
// 무기로 공격해도 장갑 무시가 붙는다(`inferAction` ①의 성질). 공격 시 동결 버킷이 정답이고,
// 같은 팩의 `레이저 라이플`·`FHG-666` 이 이미 그 형태(`action: 'attack'` + `applyMode: 'onUse'`)로
// 저작돼 있으므로 그것에 맞춘다. 조건이 붙은 `라이트닝 카운트`(《카운터》 한정)는 제외했다.
//
// ## C. 사용 제한 문언이 저작되지 않았다 (2건)
//
// 원문에 회수 제한이 있는데 `used.disable` 이 `notCheck` 라 무제한으로 쓸 수 있었다.
//
// 변경 잎은 `system.active.disable` · `system.active.action` · `system.active.applyMode` ·
// `system.used.max` · `system.used.disable` 다섯뿐이다. 이름·수치·규칙문·보정 행은 건드리지 않는다.
// 대상은 **`_id` 로 못박는다** — 같은 이름의 다른 문서를 잘못 잡지 않기 위해서다.

export const description = "장비 상시 보정 수명 17건 · 장갑 무시 공격 버킷 5건 · 누락 사용 제한 2건 교정";

export const packs = ["weapons", "armors"];

/** A. 조건 없는 상시 보정 → 활성화 버킷의 수명을 영구로. (오른쪽은 참고용 이름) */
const ALWAYS = {
  "54jjo8H1GEtlXWGV": "강화 비즈니스 슈트",
  "gcXNrFCtZTAHyJDe": "다기능 헬멧",
  "PrP7n6A9ZxSPGgtl": "라이더 슈트",
  "AMY2PjW3JKaD4XME": "부스트 아머",
  "t22nuqqEEjjjMyF4": "세계제복",
  "0PJfRIey286K2RXB": "슈터즈 재킷",
  "15nd4nfGyFCMSTRN": "스테이지 의상",
  "XCHGBmsjRyC3HAAS": "승부복",
  "bfDMSXtKzjt9Nxnx": "안티 레니게이드 슈트",
  "HwaB3MUtka6BdW6s": "어보이드 망토",
  "rTWpHJCTBDEGd7Dt": "얼티메이드복",
  "pNBjr9JLiGH2zqoB": "연구복",
  "u4N7YLoHhwWaKBMG": "트랙 슈트",
  "HmacZU1QTQYXu2Dw": "UGN 전투복",
  "KrVuPtpOKS92oIUk": "센서 실드",
  "rbRknmtH3uA54wnk": "패리 실드",
  // 「장비 시 행동치 -5」는 무조건 상시다. 같은 문서의 「선언 시 공격력 +[육체]」는
  // 아직 미구현이며 이번 범위가 아니다(별도 저작 대상).
  "fNYuXVECktIf5ohV": "토츠카 검",
};

/** B. 「이 무기를 사용한 공격은 장갑치를 무시」 → 공격 시 동결 버킷(레이저 라이플과 동형). */
const ATTACK_BUCKET = {
  "QcOhngy4jViIipDs": "시저 리퍼",
  "mnTG6mMR4ZrjWU1L": "수어사이드 삐에로",
  "cbFUZLgCFLuRzvJy": "소형부유포",
  "MapSYwNvBWuePrQz": "전차포",
  "uYpPcWsHEVxnIFM1": "디스트로이어",
};

/** C. 원문에 있는데 빠져 있던 사용 제한. */
const USED = {
  // 「이 무기는 한 시나리오에 3번 사용 가능하다.」
  "BtV9Fg3uau4ThyXn": { name: "레이저 라이플", max: 3, disable: "session" },
  // 「이 효과는 시나리오당 한 번 사용 가능하다.」([중압] 소거 자체는 statusClear 로 이미 구현됨)
  "lmGshePqPrxaCAP5": { name: "각오의 사라시", max: 1, disable: "session" },
};

export function migrate(doc, ctx) {
  if (ALWAYS[doc._id]) {
    if (doc.system?.active && doc.system.active.disable !== "-") doc.system.active.disable = "-";
    return;
  }
  if (ATTACK_BUCKET[doc._id]) {
    const active = doc.system?.active;
    if (!active) return;
    active.action = "attack";
    active.applyMode = "onUse";
    // 동결 버킷의 수명은 그 공격이 속한 메이저까지다(레이저 라이플과 같은 값).
    active.disable = "major";
    return;
  }
  const used = USED[doc._id];
  if (used) {
    if (!doc.system?.used) return;
    doc.system.used.max = used.max;
    doc.system.used.disable = used.disable;
  }
}
