import assert from "node:assert/strict";
import test from "node:test";

import {
  generalEffectFolderId,
  migrate,
  servantEffectFolderId,
  servantLimitCategory,
} from "../migrations/2026-09-10-remaining-effect-limit-order.mjs";

test("servant effects use their folder-specific limit order", () => {
  const limits = [
    "-",
    "종자 전용,리미트",
    "종자 전용,80%",
    "종자 전용,100%",
    "종자 전용,120%",
    "종자 전용",
  ];
  assert.deepEqual(limits.map(servantLimitCategory), [0, 1, 2, 3, 4, 5]);
});

test("remaining-folder sorting is stable, idempotent, and scoped", () => {
  const ctx = {pack: "effects", fail: assert.fail};
  const general = {type: "effect", folder: generalEffectFolderId, name: "일반", sort: 100_000, system: {limit: "100%"}};
  migrate(general, ctx);
  assert.equal(general.sort, 800_100_000);
  migrate(general, ctx);
  assert.equal(general.sort, 800_100_000);

  const servant = {type: "effect", folder: servantEffectFolderId, name: "종자", sort: 200_000, system: {limit: "종자 전용"}};
  migrate(servant, ctx);
  assert.equal(servant.sort, 1_000_200_000);

  const outside = {type: "effect", folder: "outsideScope0001", name: "제외", sort: 300_000, system: {limit: "100%"}};
  migrate(outside, ctx);
  assert.equal(outside.sort, 300_000);
});
