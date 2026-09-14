// Correct only fields supported by the existing runtime. Hit/HP trigger separation,
// stacking, independent movement and multiple expiry conditions remain out of scope.
export const description = "설명에 맞춰 이펙트의 메이저·육체 보정 범위, 다음 판정 수명, 공포의 가호 누락 효과를 교정";
export const packs = ["effects"];
export const idempotent = true;
export const entries = [
  {id: "BHXnEcIGlR0y83Up", name: "인도하는 꽃", channel: "target", before: "add", after: "major_add", value: "+[level]*2"},
  {id: "yqflMSkktaS4beCw", name: "빛이 비추는 장소", channel: "target", before: "add", after: "major_add", value: "+5"},
  {id: "asNhMGEBr8uPsLF6", name: "피를 태우는 마탄", channel: "target", before: "critical", after: "major_critical", value: "+1"},
  {id: "ztVoNcNikaCI4UJe", name: "짐승의 혼", channel: "self", before: "dice", after: "stat_dice", label: "body", value: "+5"},
  {id: "LflB5mpaoHvWrPXA", name: "완전수화", channel: "self", before: "dice", after: "stat_dice", label: "body", value: "+[level]+2"},
  {id: "j3vvqQQ9eio8PjyY", name: "선혈의 사슬", expiry: true},
  {id: "ly9C3DkmUN7OEHFG", name: "봉인의 주술", expiry: true},
  {id: "C0vecpDXms7ay913", name: "공포의 가호", missing: true},
];
const byId = new Map(entries.map(entry => [entry.id, entry]));
const usable = map => Object.values(map || {}).filter(row => row?.key && row.key !== "-" && String(row.value ?? "").trim());
const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);
export const fearRows = {
  majorCritical: {key: "major_critical", label: "major_critical", value: "-1"},
  criticalMinimum: {key: "critical_min", label: "critical_min", value: "6"},
};
export const fearCondition = {timing: "instant", target: "self", type: "berserk", activate: true};

export function migrate(doc, ctx) {
  const entry = byId.get(doc._id);
  if (!entry) return;
  if (ctx.pack !== "effects" || doc.type !== "effect" || doc.name !== entry.name) {
    ctx.fail(`${doc._id}: expected effects/${entry.name}/effect`); return;
  }
  // Validate the whole plan before touching a draft, including second-run values.
  if (entry.channel) {
    const rows = usable(entry.channel === "self" ? doc.system?.attributes : doc.system?.effect?.attributes);
    const row = rows[0];
    if (rows.length !== 1 || ![entry.before, entry.after].includes(row?.key)
        || String(row?.value) !== entry.value || (row.action && row.action !== "use")) {
      ctx.fail(`${entry.name}: unexpected modifier rows`); return;
    }
    const allowedLabels = [entry.before, entry.label || entry.after];
    if (!allowedLabels.includes(row.label)) {ctx.fail(`${entry.name}: unexpected modifier label`); return;}
    row.key = entry.after;
    row.label = entry.label || entry.after;
    return;
  }
  if (entry.expiry) {
    const rows = usable(doc.system?.effect?.attributes);
    if (rows.length !== 1 || rows[0].key !== "critical" || String(rows[0].value) !== "+1"
        || !["major", "roll"].includes(doc.system.effect.disable)) {
      ctx.fail(`${entry.name}: unexpected next-check modifier or lifecycle`); return;
    }
    doc.system.effect.disable = "roll";
    return;
  }
  if (entry.missing) {
    const effect = doc.system?.effect;
    const rows = usable(effect?.attributes);
    const attack = rows.filter(row => row.key === "attack");
    const flags = doc.flags?.["dx3rd-emanim"];
    const extend = flags?.itemExtend;
    if (attack.length !== 1 || attack[0].label !== "-" || String(attack[0].value) !== "+[level]*3"
        || effect.disable !== "major" || effect.runTiming !== "instant"
        || rows.some(row => row !== attack[0] && !Object.values(fearRows).some(expected => same(row, expected)))
        || (extend && Object.keys(extend).some(key => key !== "condition"))
        || (extend?.condition && !same(extend.condition, fearCondition))) {
      ctx.fail(`${entry.name}: unexpected existing modifiers or extensions`); return;
    }
    for (const [id, row] of Object.entries(fearRows)) {
      const key = `fear${id}`;
      if (effect.attributes[key] && !same(effect.attributes[key], row)) {
        ctx.fail(`${entry.name}: modifier id collision ${key}`); return;
      }
    }
    Object.assign(effect.attributes, Object.fromEntries(Object.entries(fearRows).map(([id, row]) => [`fear${id}`, structuredClone(row)])));
    doc.system.getTarget = true;
    doc.flags ??= {};
    const scope = doc.flags["dx3rd-emanim"] ??= {};
    scope.manualTargetOtherOnly = true;
    scope.itemExtend ??= {};
    scope.itemExtend.condition = structuredClone(fearCondition);
  }
}
