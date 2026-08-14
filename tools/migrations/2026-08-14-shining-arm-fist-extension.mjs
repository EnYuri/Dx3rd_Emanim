// 《샤이닝 암》에 빠져 있던 맨손 변경 확장을 넣는다.
//
// 원문(그 씬 동안, 당신의 맨손 데이터를 아래와 같이 변경한다):
//   종별: 백병 / 기능: 〈백병〉
//   명중: 0    / 공격력: +【감각】
//   가드치: 0  / 사정거리: 지근
//
// 같은 문형의 다른 9건과 달리 이 문서에는 확장 도구의 무기 항목이 **통째로 없어**
// 아무 동작도 하지 않았다. 그래서 `2026-08-14-fist-data-change-effects.mjs`(= `fist` 를
// false→true 로 뒤집는 마이그레이션)에도 걸리지 않았다 — 뒤집을 값 자체가 없었다.
//
// 【감각】은 `[sense]` 로 쓴다. 팩에 선례가 있다(『진화하는 장갑』·『소실하는 천사』 등 17건).
// 「그 씬 동안」이므로 영구 변경(`fistPermanent`)은 켜지 않는다.

export const description = "《샤이닝 암》의 맨손 변경 확장 추가";

export const packs = ["effects"];

const TARGET = "샤이닝 암";

export function migrate(doc, ctx) {
  if (doc.type !== "effect" || doc.name !== TARGET) return;

  const flags = (doc.flags ||= {});
  const scope = (flags["dx3rd-emanim"] ||= {});
  const extend = (scope.itemExtend ||= {});

  // 이미 저작돼 있으면 손대지 않는다 — 손으로 넣어 둔 값을 덮어쓰면 안 된다.
  if (extend.weapon) {
    ctx.log("이미 무기 확장이 있어 건너뛴다");
    return;
  }

  extend.weapon = {
    activate: true,
    fist: true,          // 무기를 새로 만드는 것이 아니라 맨손을 고쳐 쓴다
    name: TARGET,
    type: "melee",
    skill: "melee",
    amount: 1,           // 맨손 모드에서는 쓰이지 않지만 다른 9건과 형식을 맞춘다
    add: "0",            // 명중 0
    attack: "[sense]",   // 공격력 +【감각】
    guard: "0",          // 가드치 0
    range: "지근"
  };
  ctx.log("맨손 변경 확장 추가(공격력 [sense], 가드 0, 지근)");
}
