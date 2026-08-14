// 「맨손 데이터를 변경한다」 이펙트를 맨손 변경 경로로 되돌린다.
//
// 이 계열의 원문은 전부 「(그 씬 동안,) 당신의 맨손 데이터를 다음과 같이 변경한다」이다.
// 그런데 확장 도구의 무기 항목이 `fist: false` 로 저작돼 있어, 런타임
// (`universal-extensions.js` 의 `createWeaponItems`)이 맨손을 고치는 대신
// **별개의 임시 무기**를 만들고 맨손은 그대로 남겨 두었다.
//
// 그것이 깨뜨리는 것은 이름이다. `isFistWeaponName` 은 `맨손` / `…[맨손]` 으로 판정하고,
// 그 판정이 맨손 한정 공격력(`attrs.attack.fist`)이 붙을지를 가른다. 별개 무기는 그 이름을
// 갖지 못하므로 「맨손 공격력에 +N」 계열이 변경 후에 붙지 않는다 — 룰이 명시적으로 붙는다고
// 못박은 경우다(『특수장갑의수』: 「《파괴의 손톱》 등으로 인해 맨손의 데이터가 변경된 후에도
// 적용된다」).
//
// 《사이버 암》만 예외로 `fistPermanent` 를 함께 켠다. 이것은 「그 씬 동안」이 아니라
// **취득 시 영구**로 맨손을 대체하므로(weapons 팩의 동명 문서: 「이 아이템은 [사이버 암]
// 이펙트 취득시 입수한다」) 전투가 끝날 때 되돌아가면 안 된다. 런타임은 그 경우 복원
// 스냅샷을 남기지 않는 것으로 「복원하지 않음」을 표현한다.
//
// 수치·타이밍·침식률 등 다른 필드는 건드리지 않는다. 변경 잎은
// `flags.dx3rd-emanim.itemExtend.weapon.fist` 와 (사이버 암만) `.fistPermanent` 뿐이다.

export const description = "「맨손 데이터 변경」 이펙트의 확장 도구 무기 항목을 맨손 변경 경로로 전환";

export const packs = ["effects"];

/**
 * 대상. 전부 원문이 「맨손 데이터를 변경한다」 문형이고, 팩 설명문에도 그 문장이 남아 있다.
 * 이름을 명시하는 이유는 검토 가능성이다 — 「설명에 맨손이 있으면」 같은 술어로 잡으면
 * 《폼 체인지》(「맨손 **이외의** 무기」)처럼 정반대인 문서까지 걸린다.
 */
const FIST_CHANGE_EFFECTS = new Set([
  "파괴의 손톱",
  "백열",
  "무형의 손톱",
  "독사",
  "일각귀",
  "멸망의 손톱",
  "뼈의 검",
  "에어로 드라이브"
]);

/** 취득 시 영구로 맨손을 대체하는 것. 복원 스냅샷을 남기지 않는다. */
const PERMANENT = new Set(["사이버 암"]);

export function migrate(doc, ctx) {
  if (doc.type !== "effect") return;
  const isPermanent = PERMANENT.has(doc.name);
  if (!FIST_CHANGE_EFFECTS.has(doc.name) && !isPermanent) return;

  const weapon = doc.flags?.["dx3rd-emanim"]?.itemExtend?.weapon;
  if (!weapon) {
    // 이 계열은 확장 도구로 무기를 만드는 것이 동작의 전부다. 항목이 없으면 이름만 같은
    // 다른 문서이거나 저작이 사라진 것이므로, 조용히 넘기지 않고 알린다.
    ctx.log("확장 도구 무기 항목이 없어 건너뛴다");
    return;
  }

  if (weapon.fist !== true) {
    weapon.fist = true;
    ctx.log("맨손 변경 경로로 전환(fist = true)");
  }

  if (isPermanent && weapon.fistPermanent !== true) {
    weapon.fistPermanent = true;
    ctx.log("취득 시 영구 변경이므로 복원 스냅샷을 남기지 않는다(fistPermanent = true)");
  }
}
