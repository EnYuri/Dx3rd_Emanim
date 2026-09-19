import assert from "node:assert/strict";
import test from "node:test";

import { compendiumRecords, journalPageKeyPrefix } from "../compendium-records.mjs";

test("JournalEntry pages become separate Foundry LevelDB records", () => {
  const journal = {
    _id: "journal000000001",
    _key: "!journal!journal000000001",
    name: "Guide",
    pages: [
      { _id: "page000000000001", name: "First", type: "text", text: { content: "one" } },
      { _id: "page000000000002", name: "Second", type: "text", text: { content: "two" } }
    ]
  };

  const records = compendiumRecords(journal);

  assert.equal(records.length, 3);
  assert.deepEqual(records[0], {
    type: "put",
    key: "!journal!journal000000001",
    value: {
      _id: "journal000000001",
      name: "Guide",
      pages: ["page000000000001", "page000000000002"]
    }
  });
  assert.equal(records[1].key, "!journal.pages!journal000000001.page000000000001");
  assert.equal(records[1].value.text.content, "one");
  assert.equal(records[2].key, "!journal.pages!journal000000001.page000000000002");
  assert.equal(records[2].value.text.content, "two");
  assert.equal("_key" in records[1].value, false);
  assert.deepEqual(journal.pages.map(page => page._id), ["page000000000001", "page000000000002"]);
});

test("ordinary compendium documents retain their existing record shape", () => {
  const item = { _id: "item000000000001", _key: "!items!item000000000001", name: "Item" };
  assert.deepEqual(compendiumRecords(item), [{ type: "put", key: item._key, value: item }]);
});

test("journal page key prefix matches the embedded collection", () => {
  assert.equal(journalPageKeyPrefix("journal000000001"), "!journal.pages!journal000000001.");
});
