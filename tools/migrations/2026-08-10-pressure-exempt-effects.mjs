// 원문에 「[중압] 상태에서도 사용할 수 있다」가 명시된 이펙트에 예외 저작을 켠다.
//
// 런타임의 [중압] 게이트는 `timing === 'auto'` 인 아이템을 막는다. 그 예외는 지금까지
// 월드 설정의 이름 목록(`DX3rd.PressureExceptionItems`)으로만 적을 수 있어서, 테이블마다
// 손으로 옮겨 적어야 했고 이름이 바뀌면 조용히 끊겼다. 이제 아이템 자신이 들고 있는다
// (`system.conditionExempt.pressure` → `DX3rdUsageGates.conditionExempt`).
//
// 근거는 팩 설명문 전수 검색이다. effects 팩에서 「중압」을 언급한 24건 중, 대상에게
// **부여**하는 7건(옭아매는 공간·세포침식·제물로 바치는 뱀·인탱글·봉인하는 손·
// 꿈틀대는 탄환·밸런스 브레이크)을 제외한 17건이 「…에서도/에도 사용할 수 있다」 문형이다.
//
// [폭주] 쪽은 켜지 않는다. 런타임의 [폭주] 게이트는 `roll` 이 `reaction`/`dodge` 인 것을
// 막는데, 팩 전체에서 「폭주」를 언급한 93건 중 리액션·닷지를 예외로 허용하는 문장은
// 하나도 없고 그 93건에 `roll: reaction|dodge` 인 문서도 없다. 예외로 저작할 대상이 없다.
//
// effect 이외의 타입은 손대지 않는다 — `conditionExempt` 는 문서 스키마에서 effect 에만
// 선언돼 있고, timing 이 없는 장비·소지품은 [중압] 게이트에 애초에 걸리지 않는다.

export const description =
  "원문에 [중압] 예외가 명시된 이펙트 17건에 system.conditionExempt.pressure 를 켠다";

export const packs = ["effects"];

// `_id` 로 짚는다. 이름은 손튜닝 대상이라 기준으로 삼을 수 없고, 같은 이름의 다른 출전
// 문서가 있을 수 있다(예: 신드롬별로 펼쳐진 공통 이펙트).
const PRESSURE_EXEMPT = new Set([
  "0MoZpkItAF6uQ6wv", // 짐승의 긍지 (키마이라, auto)
  "4HziOCC2dxQWy9Ob", // 리셋 (고대종, auto)
  "AtEGhAno1nSIHGA6", // 리저렉트 (일반 이펙트, always)
  "BYUTn7hfWizRrdXm", // 이형의 수호 (엑자일, auto)
  "Hb07Odw2MQGLyrGd", // 불사의 짐승 (키마이라, auto)
  "JPzvWEMr7rAw3brN", // 불사생명 (에너미 이펙트/레니게이드 비잉, auto)
  "K7SJwDNODNSWAUr7", // 리프레시 (일반 이펙트, auto)
  "LUSoMTQCG9KM4RaP", // 무한의 혈육 (브람 스토커, auto)
  "OwH27FuaXr3jA6PJ", // 불타는 혼 (샐러맨더, auto)
  "WLLlcpU9rbuubqmV", // 아쿠아 비테 (솔라리스, auto)
  "YSqwQQxCDuxlhGGP", // 자동체내식재세동기 (블랙 독, auto)
  "gEEiZolRMNbnpDEN", // 상태복원 (에너미 이펙트, auto)
  "jn8otaDAGubXbssi", // 마수의 증표 (키마이라, auto)
  "pB5Rwj7jJwOK2JKU", // 이상투영 (엑자일, auto)
  "q9wG3WMW6NE700Pi", // 명부의 관 (브람 스토커, auto)
  "szxuMCZyDQJGJ87G", // 헌신의 탄막 (종자 전용 이펙트, auto)
  "tMVeUbx1Mvc9Q3fa"  // 셋 백 (발로르, auto)
]);

export function migrate(doc, ctx) {
  if (!PRESSURE_EXEMPT.has(doc._id)) return;
  if (doc.type !== "effect") {
    ctx.fail(`effect 가 아닌 문서가 목록에 있다: ${doc.name} (${doc.type})`);
    return;
  }

  // 스키마가 선언한 모양 그대로 만든다. berserk 를 함께 적는 것은 예외가 있어서가 아니라
  // (없다) 저장 문서와 선언의 모양을 맞춰 두기 위해서다.
  doc.system.conditionExempt ??= {};
  if (doc.system.conditionExempt.pressure !== true) doc.system.conditionExempt.pressure = true;
  if (doc.system.conditionExempt.berserk !== false && doc.system.conditionExempt.berserk !== true) {
    doc.system.conditionExempt.berserk = false;
  }
}
