// Classify every automated fist-data change as either replacement or addition.
//
// Ten effects say that the fist data is changed *to* a complete weapon profile. They are replacements.
// Two prerequisite effects instead increase the attack value inside a fist profile authored by another effect;
// those are additive and are meant to be used in the same combo as their prerequisite.
//
// Names and ids are both checked so an unrelated duplicate name cannot be rewritten silently.

export const description = "맨손 변경 이펙트의 교체/가산 모드를 명시하고 조합 전용 가산 2건을 구조화";
export const packs = ["effects"];

export const REPLACEMENTS = new Map([
  ["5xWxGBELbZ5vVtBg", "독사"],
  ["Dqak27DejhOeH994", "멸망의 손톱"],
  ["5a6qdPvM7zixz6Bu", "무형의 손톱"],
  ["1rzxGx6jMbiFVujh", "백열"],
  ["ricys4eErdb3A3N7", "뼈의 검"],
  ["3Rd7Pt5WuUg9niM4", "사이버 암"],
  ["IfaXrZGCvhJysSoD", "샤이닝 암"],
  ["zyWNVo8ORsen3shI", "에어로 드라이브"],
  ["CaFm6Q2AGS3x7Jh7", "일각귀"],
  ["sh1IbrROTcNL8EOS", "파괴의 손톱"]
]);

export const ADDITIONS = new Map([
  ["Sex41FK6Tlp729IK", "역전의 수아"],
  ["AIAbvxGV2qEqt64A", "찢고 꿰뚫는 자"]
]);

export function additiveFistCard(name) {
  return {
    activate: true,
    fist: true,
    fistAdditive: true,
    fistStackable: false,
    name,
    type: "melee",
    skill: "melee",
    amount: "1",
    add: "0",
    attack: "+[level]*3",
    guard: "0",
    range: "지근"
  };
}

export function migrate(doc, ctx) {
  const replacementName = REPLACEMENTS.get(doc._id);
  if (replacementName) {
    if (doc.name !== replacementName) {
      ctx.fail(`교체 대상 id의 이름이 다르다: 기대 '${replacementName}', 실제 '${doc.name}'`);
      return;
    }
    const weapon = doc.flags?.["dx3rd-emanim"]?.itemExtend?.weapon;
    if (!weapon || weapon.fist !== true) {
      ctx.fail("기대한 맨손 교체 무기 카드가 없다");
      return;
    }
    if (weapon.fistAdditive !== false) {
      weapon.fistAdditive = false;
      ctx.log("맨손 교체 모드 명시(fistAdditive = false)");
    }
    return;
  }

  const additiveName = ADDITIONS.get(doc._id);
  if (!additiveName) return;
  if (doc.name !== additiveName) {
    ctx.fail(`가산 대상 id의 이름이 다르다: 기대 '${additiveName}', 실제 '${doc.name}'`);
    return;
  }

  const namespace = doc.flags ||= {};
  const systemFlags = namespace["dx3rd-emanim"] ||= {};
  const itemExtend = systemFlags.itemExtend ||= {};
  const current = itemExtend.weapon;
  if (current && JSON.stringify(current) !== JSON.stringify(additiveFistCard(additiveName))) {
    ctx.fail("이미 다른 무기 생성 카드가 있어 덮어쓰지 않는다");
    return;
  }
  if (!current) {
    itemExtend.weapon = additiveFistCard(additiveName);
    ctx.log("조합 전용 맨손 공격력 가산 카드 추가");
  }
}
