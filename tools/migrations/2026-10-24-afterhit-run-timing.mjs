// 「공격이 명중하면」이라고 적힌 대상 보정이 runTiming 'afterDamage' 로 저장돼 있어 HP 감소가
// 있는 명중에만 발동하던 16건을, 새 런타임 타이밍 'afterHit'(attackHit 기준 — 데미지 0인 명중도
// 발동, 미스는 불발)로 옮긴다. 「1점이라도 HP데미지」 계열(재앙의 진홍·침투·그래플·흡수·
// 폴른 라이플·AR 샷건·카운실러스 엣지 등)은 그대로 'afterDamage' 에 둔다 — 그것들은 지금도
// 옳게 저장돼 있다.
// items 팩의 탄환 3건은 준비형 라이더 경로라 종전에는 우연히 명중 기준으로 동작했으나, 이번
// 분리로 afterDamage 버킷이 damaged 경로로 옮겨지므로 함께 이전하지 않으면 회귀한다.
// 런타임: armPendingAttackRider 가 hitAttributes 로 동결 → processPendingAttackRiders 가
// hit 대상에 적용, 콤보는 collectAfterDamageData 의 hitApplies → processComboAfterHit.
export const description = "문언이 「명중」인 대상 보정 16건의 effect.runTiming 을 afterDamage → afterHit 로 교정";
export const packs = ["effects", "items"];
export const idempotent = true;

export const entries = [
  {id: "4S85ayMQLbQ8Ir6a", pack: "effects", name: "모래의 쐐기"},
  {id: "EhvudWpk380WZHkY", pack: "effects", name: "마왕의 패기"},
  {id: "L6bdiakePZDcEIHb", pack: "effects", name: "중력의 수갑"},
  {id: "Ut2WUtXS2gl2O9qg", pack: "effects", name: "부식의 손끝"},
  {id: "VLivREksGyAkPZ3a", pack: "effects", name: "영박의 마탄"},
  {id: "ZwZi9Bqr3fFn2HsC", pack: "effects", name: "마신의 심장"},
  {id: "c0628luEZUNiq1fC", pack: "effects", name: "아로새기는 목소리"},
  {id: "j3vvqQQ9eio8PjyY", pack: "effects", name: "선혈의 사슬"},
  {id: "ly9C3DkmUN7OEHFG", pack: "effects", name: "봉인의 주술"},
  {id: "q0TC1mlYNvkdyoa5", pack: "effects", name: "죄인의 형틀"},
  {id: "utVE2Zqs4nM33y7r", pack: "effects", name: "애시드 볼"},
  {id: "zUWbvh5HLY8dixeK", pack: "effects", name: "페트리파이"},
  {id: "zXUCIV96q41moM8Z", pack: "effects", name: "피의 쐐기"},
  {id: "Q0JxjT9KJW7hZMZ4", pack: "items", name: "항 레니게이드 탄"},
  {id: "UCKnFAryUROhOJUW", pack: "items", name: "베넘 블러드"},
  {id: "mHKaQ3EBZLrZDorx", pack: "items", name: "안티 레니게이드 탄"},
];
const byId = new Map(entries.map(entry => [entry.id, entry]));

export function migrate(doc, ctx) {
  const entry = byId.get(doc._id);
  if (!entry) return;
  if (ctx.pack !== entry.pack || doc.name !== entry.name) {
    ctx.fail(`${doc._id}: expected ${entry.pack}/${entry.name}`); return;
  }
  const effect = doc.system?.effect;
  if (!effect || !["afterDamage", "afterHit"].includes(effect.runTiming)) {
    ctx.fail(`${entry.name}: unexpected runTiming ${JSON.stringify(effect?.runTiming)}`); return;
  }
  effect.runTiming = "afterHit";
}
