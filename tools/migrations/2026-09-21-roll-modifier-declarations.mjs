// 「대상이 판정을 실행하기 직전/직후에 사용할 것」 계열을 선/후 보정 카드(`system.rollModifier`)로
// 옮긴다.
//
// 지금까지 이 계열은 **지속 보정 채널**로 근사돼 있었다 — 대상 채널에 `dice -[LV]` 행을 놓고
// 수명을 `major` 로 두는 식이다. 그러면 ⑴ 「그 판정」이 아니라 **메이저가 끝날 때까지의 모든
// 판정**이 깎이고, ⑵ 굴리기 전에 미리 대상을 지정해 걸어 두어야 하며, ⑶ 달성치 수정(`add`)은
// 굴림이 이미 끝난 뒤에 선언하는 것인데 그 시점에 걸 자리가 없었다.
//
// 선/후 보정 카드는 굴림 개입 코어를 타므로 굴리는 **그 판정 하나**에만 걸리고, 판정 직전·직후
// 그 자리에서 선언한다. 사용 횟수·침식·비용은 그대로다(개입 사용도 `processItemUsageCost` 를 탄다).
//
// **대상은 이름으로 명시한다.** 「설명에 '직전'이 있으면」 같은 술어로 잡으면 이 채널이 표현하지
// 못하는 부수효과를 가진 문서까지 걸려, 비용을 내지 않고 효과만 나가게 된다.
//
// 대가가 붙은 선언은 그 대가를 **함께** 저작한다 — 개입 사용도 `processItemUsageCost` 와 확장 도구를
// 타므로 고정 HP·침식은 `system.hp.value`/`system.encroach.value` 로, 「메인 프로세스 종료 후」는
// 확장 도구의 `encroach` 카드(`timing: 'afterMain'`)로 낸다.
//
// 런타임이 판정할 수 없는 조건(무기의 **출처**, 판정 시작 시점의 장비)은 수치만 정확히 저작하고
// 조건 충족 여부는 GM·PL 이 확인한다 — 저장소의 기존 「선언 보조」 분류와 같다.

export const description =
  "판정 직전/직후 선언 계열 24건을 선/후 보정 카드로 이행(근사로 쓰던 지속 보정 행은 제거)";

export const packs = ["effects", "items", "armors", "dlois"];

const BASE = {
  enabled: true,
  timing: "before",
  scope: "dice",
  value: "",
  floor: "",
  kinds: ["check"],
  subtypes: [],
  target: "other",
  attackOnly: false,
  skillKey: "",
  perRollMax: 1
};

// `clears`: 카드가 대체하는 근사 행이 있던 채널. 그대로 두면 같은 효과가 두 번 걸린다.
const TARGETS = new Map([
  // ── 판정 직전 · 다이스 페널티 ────────────────────────────────────────────────
  ["재밍", {timing: "before", scope: "dice", value: "-[level]", clears: "target"}],
  ["플래시 게이즈", {timing: "before", scope: "dice", value: "-[level]*2", clears: "target"}],
  ["눈이 먼 양", {timing: "before", scope: "dice", value: "-([level]+1)", clears: "target"}],
  // ── 판정 직후 · 달성치 (남의 판정) ───────────────────────────────────────────
  ["그래비티 바인드", {timing: "after", scope: "achievement", value: "-[level]*3"}],
  ["트랩 볼트", {timing: "after", scope: "achievement", value: "-[level]*3", clears: "target"}],
  ["검은 빛", {timing: "after", scope: "achievement", value: "-5", clears: "target"}],
  ["승리의 여신", {timing: "after", scope: "achievement", value: "+[level]*3", clears: "target"}],
  ["각오의 고무", {timing: "after", scope: "achievement", value: "+[level]*3", clears: "target"}],
  // 「어떤 캐릭터가 판정한 직후」 — 자신도 포함한다.
  ["해명의 석판", {timing: "after", scope: "achievement", value: "-15", target: "any"}],
  // ── 판정 직후 · 달성치 (자기 판정) ───────────────────────────────────────────
  ["이레귤러 조커", {timing: "after", scope: "achievement", value: "+10", target: "self", clears: "self"}],
  ["천재", {timing: "after", scope: "achievement", value: "+[mind]", target: "self", clears: "self"}],
  ["위기회피", {timing: "after", scope: "achievement", value: "+5", target: "self", clears: "self"}],
  // 「공격의 명중판정 혹은 닷지 판정을 실행한 직후」 — attackOnly 가 공격·리액션·닷지를 덮는다.
  ["멀티 어택",
    {timing: "after", scope: "achievement", value: "+10", target: "self", attackOnly: true, clears: "self"}],
  // 「1회 판정에 몇 회나 사용할 수 있고, 효과는 중첩된다」 — 굴림당 상한을 풀어 둔다.
  ["하늘을 찢는 손톱",
    {timing: "after", scope: "achievement", value: "+10", target: "self", attackOnly: true,
      perRollMax: 9, clears: "self"}],

  // ── 대가가 붙은 선언 ─────────────────────────────────────────────────────────
  // 「판정을 실행하기 직전에 사용할 것. 그 판정의 달성치에 +5. 단, 사용할 때마다 HP 가 5점 감소」
  // — HP 비용은 이미 `system.hp.value: "5"` 로 저작돼 있고 개입 사용도 그것을 낸다.
  // 「한 번의 판정에 중복하여 사용할 수 있다」라 굴림당 상한을 푼다.
  ["귀인의 예장",
    {timing: "before", scope: "achievement", value: "+5", target: "self", perRollMax: 9, clears: "self"}],
  // 「크리티컬치에 -2(하한치 2)」 + 「메인프로세스가 종료된 후 침식률 1D10 상승」.
  ["No.01 현자의 돌",
    {timing: "before", scope: "critical", value: "-2", floor: "2", target: "self",
      afterMainEncroach: "1d10"}],
  // 「크리티컬 수치에 -1(하한치 5)」 + 「판정의 종료시 6점의 침식치 상승」 — 선언 그 자리의
  // 비용이므로 afterMain 이 아니라 사용 비용으로 낸다. 취득 시 고르는 기능은 캐릭터마다 달라
  // 컴펜디움에 못 박을 수 없다(기능 조건은 수동 확인).
  ["No.G01 선별자",
    {timing: "before", scope: "critical", value: "-1", floor: "5", target: "self",
      encroach: "6", clears: "self"}],

  // ── 다이스값 선언 ────────────────────────────────────────────────────────────
  ["창조주의 힘", {timing: "after", scope: "achievement", value: "+4d10", clears: "target"}],
  // 「〈정보:〉판정을 실행한 직후... 달성치에 +2D」 — 정보 계통 전체라 기능 하나로 좁힐 수 없다.
  ["UGN의 지원 정보",
    {timing: "after", scope: "achievement", value: "+2d10", target: "self", clears: "self"}],

  // ── 하한이 붙은 선언 ─────────────────────────────────────────────────────────
  // 「대상이 공격판정을 실행한 직후... -[LV×5](최저 1)」.
  ["스몰 월드",
    {timing: "after", scope: "achievement", value: "-[level]*5", floor: "1", attackOnly: true,
      clears: "target"}],

  // ── 조건은 수동 확인, 수치만 저작 ────────────────────────────────────────────
  // 「선결이펙트: 《미러 코트》」는 **취득 전제**라 런타임 조건이 아니다(빌드가 이미 보장).
  // 「한 번의 판정에 여러 번 사용할 수 있으며, 그 경우 효과가 중복된다」.
  ["블랙 아웃",
    {timing: "after", scope: "achievement", value: "+5", target: "self", subtypes: ["dodge"],
      perRollMax: 9, clears: "self"}],
  // 「《헌드레드 건즈》로 작성한 무기를 사용하지 않았다면 효과를 받을 수 없다」 — 무기의 출처는
  // 런타임이 묻지 않는다(맨손 절의 《암드 스카프》와 같은 부류). 수동 확인.
  ["마탄의 악마",
    {timing: "after", scope: "achievement", value: "+10", target: "self", skillKey: "ranged",
      clears: "self"}],
  // 「「기능 : 사격」의 무기를 장비하고 있고」 — 판정 시작 시점의 장비는 후보 판정이 보지 않는다. 수동 확인.
  ["리버설 샷", {timing: "after", scope: "achievement", value: "+10", clears: "target"}]
]);

// 굴림 **재정의** 쪽 카드. 《No.65 윤회의 짐승》의 「그 판정의 결과를 실패로 변경한다」는 달성치
// 수정이 아니라 판정 자체를 무너뜨리는 것이라, 첫 웨이브의 눈을 전부 1로 바꿔 펌블 = 자동 실패로
// 만든다(`applyInterventions` 가 `waves[0].every(v => v === 1)` 로 fumble 을 세우고, 판정 경로가
// 그것을 달성치 0으로 읽는다). 「난이도: 자동성공처럼 판정이 이루어지지 않을 경우에는 사용할 수
// 없다」는 저절로 지켜진다 — 굴림이 없으면 개입 후보 자체가 열리지 않는다.
// 사용 시의 타이타스 승화는 이 채널이 표현하지 못하므로 수동이다.
const INTERVENTIONS = new Map([
  ["No.65 윤회의 짐승", {
    phase: "afterRoll", kinds: ["check"], subtypes: [], operation: "setFaces",
    target: "any", selection: "all", waveScope: "first", count: "1", value: "1", perRollMax: 1
  }]
]);

const INTERVENTION_BASE = {
  enabled: true, phase: "afterRoll", kinds: [], subtypes: [], operation: "", target: "self",
  selection: "one", waveScope: "all", count: "1", value: "", perRollMax: 1, skillKey: "",
  attackOnly: false, requiredItem: "", requiresPriorUse: false, chooseDelta: false,
  automatic: false, oncePerDie: false
};

const cleanName = name => String(name || "").replace(/\|\|.*$/, "").trim();

export function migrate(doc, ctx) {
  const name = cleanName(doc.name);
  const intervention = INTERVENTIONS.get(name);
  if (intervention) {
    doc.system ??= {};
    const wanted = {...INTERVENTION_BASE, ...intervention};
    if (JSON.stringify(doc.system.rollIntervention) !== JSON.stringify(wanted)) {
      doc.system.rollIntervention = wanted;
    }
    return;
  }

  const spec = TARGETS.get(name);
  if (!spec) return;
  const {clears, encroach, afterMainEncroach, ...authored} = spec;
  const want = {...BASE, ...authored};

  doc.system ??= {};
  if (encroach !== undefined) {
    doc.system.encroach = {...(doc.system.encroach || {}), value: encroach};
  }
  if (afterMainEncroach !== undefined) {
    doc.flags ??= {};
    doc.flags["dx3rd-emanim"] ??= {};
    const ext = doc.flags["dx3rd-emanim"].itemExtend ??= {};
    const card = {activate: true, timing: "afterMain", target: "self", fixed: true, value: afterMainEncroach};
    if (JSON.stringify(ext.encroach) !== JSON.stringify(card)) ext.encroach = card;
  }
  if (JSON.stringify(doc.system.rollModifier) !== JSON.stringify(want)) {
    doc.system.rollModifier = want;
  }

  if (clears === "target") {
    const rows = doc.system.effect?.attributes;
    if (rows && Object.keys(rows).length) doc.system.effect.attributes = {};
  } else if (clears === "self") {
    const rows = doc.system.attributes;
    if (rows && Object.keys(rows).length) doc.system.attributes = {};
  }
  void ctx;
}
