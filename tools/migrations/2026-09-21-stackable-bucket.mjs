// 「중복된다」 문언의 지속 보정 버킷에 stack 표지를 심는다.
//
// 지금까지 같은 아이템·채널·버킷의 재적용은 같은 appliedKey를 덮어써서
// 명중·사용을 반복해도 1회분만 남았다. 런타임이 bucketLifecycle.stack 을 읽어
// 인스턴스 키(applied_…_<randomID>)로 새 적용 이펙트를 쌓게 되었으므로, 문언상
// 중복이 보장되는 세 건에 표지를 켠다.
//
// - 중력의 수갑(effects): 「공격을 명중시킬 때마다 중복된다」— 대상 채널 afterHit 버킷.
// - 격정의 격종(effects): 「여러 번 사용했을 경우, 효과는 중복된다」— 자기 채널 onUse 동결.
//   critical_min 은 합산이 아니라 R.min 이라 N스택이어도 하한 6 유지.
// - 문 도그(items): 「이 효과는 사용할 때마다 중복된다」— 자기 채널 onUse 동결.
export const description = "중복 문언 3건(중력의 수갑·격정의 격종·문 도그)의 버킷에 stack을 켠다";
export const packs = ["effects", "items"];

const STACK = new Map(Object.entries({
  "L6bdiakePZDcEIHb": { name: "중력의 수갑", path: "effect" },
  "nOZs25GNU3hyPgZi": { name: "격정의 격종", path: "active" },
  "rRpby9JEG712pSbM": { name: "문 도그", path: "active" },
}));

export function migrate(doc, ctx) {
  const spec = STACK.get(doc._id);
  if (!spec) return;
  if (doc.name !== spec.name) {
    ctx.fail(`대상 이름이 예상과 다르다: ${JSON.stringify(doc.name)} (예상 ${JSON.stringify(spec.name)})`);
    return;
  }
  const channel = doc.system?.[spec.path];
  if (!channel || typeof channel !== "object") {
    ctx.fail(`system.${spec.path} 가 없다`);
    return;
  }
  if (channel.stack !== true) channel.stack = true;
}
