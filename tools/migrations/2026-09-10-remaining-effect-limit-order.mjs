import {
  SORT_STRIDE,
  effectLimitCategory,
} from "./2026-09-10-syndrome-effect-limit-order.mjs";

export const description = "레니게이드 워·일반 이펙트와 종자 전용 폴더를 각 제한 규칙에 따라 안정 정렬";
export const packs = ["effects"];
export const idempotent = true;

export const renegadeWarFolderId = "KL3bLDUxvd71fGhH";
export const generalEffectFolderId = "02iNlfBtvEIcKj9P";
export const servantEffectFolderId = "pir47ct7eMXP8WkK";
export const ordinaryFolderIds = new Set([renegadeWarFolderId, generalEffectFolderId]);

export function servantLimitCategory(limit) {
  const value = String(limit ?? "").replace(/\s/g, "");
  if (!value || value === "-") return 0;
  if (value === "종자전용,리미트") return 1;
  if (value === "종자전용,80%") return 2;
  if (value === "종자전용,100%") return 3;
  if (value === "종자전용,120%") return 4;
  if (value === "종자전용") return 5;
  return 6;
}

function moveToCategory(doc, category, ctx) {
  if (category === 0) return; // Keep unrestricted effects and their sort values unchanged.

  const current = Number(doc.sort);
  if (!Number.isSafeInteger(current) || current < 0) {
    ctx.fail(`${doc.name}: 안전하게 정렬할 수 없는 sort 값 (${JSON.stringify(doc.sort)})`);
    return;
  }

  const lower = category * SORT_STRIDE;
  if (current >= lower && current < lower + SORT_STRIDE) return;
  if (current >= SORT_STRIDE) {
    ctx.fail(`${doc.name}: 기존 sort 값이 예약 정렬 구간과 충돌한다 (${current})`);
    return;
  }
  doc.sort = lower + current;
}

export function migrate(doc, ctx) {
  if (ctx.pack !== "effects" || doc.type !== "effect") return;
  if (ordinaryFolderIds.has(doc.folder)) {
    moveToCategory(doc, effectLimitCategory(doc.system?.limit), ctx);
  } else if (doc.folder === servantEffectFolderId) {
    moveToCategory(doc, servantLimitCategory(doc.system?.limit), ctx);
  }
}
