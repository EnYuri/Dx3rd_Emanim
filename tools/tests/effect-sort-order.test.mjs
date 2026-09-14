import assert from "node:assert/strict";
import test from "node:test";

import {
  SORT_STRIDE,
  effectLimitCategory,
  migrate,
  syndromeFolderIds,
} from "../migrations/2026-09-10-syndrome-effect-limit-order.mjs";

test("syndrome effect limits follow the requested group order", () => {
  const limits = ["-", "리미트", "퓨어 브리드", "80%", "100%", "120%", "기아/120%"];
  assert.deepEqual(limits.map(effectLimitCategory), [0, 1, 2, 3, 4, 5, 6]);
  assert.equal(effectLimitCategory("기아, 120%"), 6);
  assert.equal(effectLimitCategory("D로이스"), 6);
});

test("syndrome effect sorting preserves unrestricted values and is idempotent", () => {
  const folder = [...syndromeFolderIds][0];
  const unrestricted = {type: "effect", folder, name: "일반", sort: 12_300_000, system: {limit: "-"}};
  migrate(unrestricted, {pack: "effects", fail: assert.fail});
  assert.equal(unrestricted.sort, 12_300_000);

  const limit = {type: "effect", folder, name: "리미트", sort: 12_400_000, system: {limit: "리미트"}};
  migrate(limit, {pack: "effects", fail: assert.fail});
  assert.equal(limit.sort, SORT_STRIDE + 12_400_000);
  migrate(limit, {pack: "effects", fail: assert.fail});
  assert.equal(limit.sort, SORT_STRIDE + 12_400_000);
});

test("the first sorting pass ignores non-syndrome folders", () => {
  const doc = {type: "effect", folder: "outsideScope0001", name: "별도", sort: 100_000, system: {limit: "120%"}};
  migrate(doc, {pack: "effects", fail: assert.fail});
  assert.equal(doc.sort, 100_000);
});
