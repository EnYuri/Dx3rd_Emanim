// 룰텍스트의 수치 효과가 전혀 기계화되지 않았던 장비/아이템 6건에 보정 행을 심는다.
//  - 학원통의 친구   : 〈정보:아카데미아〉 판정 다이스 +2      → stat_dice info_academia 2
//  - 후두노리 특무증서: 〈지식:〉 판정 다이스 +1               → stat_dice know 1
//  - 리에종 크레스트  : 【사회】 판정 다이스 +2                → stat_dice social 2
//  - 대형 해머      : 장비 중 전력이동 -10m                  → fullMove -10 (applyMode toggle = 장착 상태)
//  - 빌드 스파인     : 최대 HP +10                           → hp +10
//  - FH 칼날 바이크  : 전투이동거리 +10                       → battleMove +10 (비클 선례: 테크니컬/리니어 비클)
// 빌드 스파인의 「경직 즉시 해제」는 선택형이라 범위 밖 — HP 부분만 자동화한다.
// 행 id 는 _source/build-items.mjs 의 genId 와 같은 시드(`attr|<이름>|<i>|<key>`)로 만들어
// 재빌드(_source/item-mech-overrides.json 에 같은 내용을 적어 둠)와 바이트 단위로 일치한다.
import crypto from "node:crypto";

export const description = "미기계화 장비/아이템 6건에 자기 보정 행 추가 (스킬 다이스·이동·HP)";
export const packs = ["items", "weapons", "vehicles"];
export const idempotent = true;

const ID_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
function genId(seed) {
  const h = crypto.createHash("sha256").update(String(seed)).digest();
  let s = "";
  for (let i = 0; i < 16; i++) s += ID_CHARS[h[i] % ID_CHARS.length];
  return s;
}

export const entries = [
  {
    id: "WLfizIRg7vx7YDcD", pack: "items", name: "학원통의 친구",
    attrs: [{key: "stat_dice", label: "info_academia", value: "2"}],
    active: {disable: "scene"},
  },
  {
    id: "KCKCfyQG6lNgiYeR", pack: "items", name: "후두노리 기숙사 특무증서",
    attrs: [{key: "stat_dice", label: "know", value: "1"}],
    active: {disable: "scene"},
  },
  {
    id: "s1gcxxLlaJeqGS4N", pack: "items", name: "리에종 크레스트",
    attrs: [{key: "stat_dice", label: "social", value: "2"}],
  },
  {
    id: "l6dzMichqql3GooA", pack: "weapons", name: "대형 해머",
    attrs: [{key: "fullMove", label: "fullMove", value: "-10"}],
    active: {applyMode: "toggle", action: ""},
  },
  {
    id: "KKKZNXU19UGwamPp", pack: "items", name: "빌드 스파인",
    attrs: [{key: "hp", label: "hp", value: "+10"}],
  },
  {
    id: "deAUIjzMpJKNQaZe", pack: "vehicles", name: "FH 칼날 바이크",
    attrs: [{key: "battleMove", label: "battleMove", value: "+10"}],
  },
];
const byId = new Map(entries.map(entry => [entry.id, entry]));

export function migrate(doc, ctx) {
  const entry = byId.get(doc._id);
  if (!entry) return;
  if (ctx.pack !== entry.pack || doc.name !== entry.name) {
    ctx.fail(`${doc._id}: expected ${entry.pack}/${entry.name}`); return;
  }
  doc.system.attributes ||= {};
  entry.attrs.forEach((a, i) => {
    const rowId = genId(`attr|${entry.name}|${i}|${a.key}`);
    const existing = Object.values(doc.system.attributes)
      .some(r => r && r.key === a.key && r.label === a.label && String(r.value) === String(a.value));
    if (!existing) doc.system.attributes[rowId] = {...a};
  });
  if (entry.active) {
    doc.system.active ||= {state: false, disable: "-", runTiming: "instant"};
    Object.assign(doc.system.active, entry.active);
  }
}
