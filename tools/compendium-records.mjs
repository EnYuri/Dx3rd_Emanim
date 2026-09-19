/**
 * Convert unpacked compendium JSON documents into Foundry's LevelDB records.
 *
 * JournalEntry pages are embedded documents. In an unpacked JSON document they
 * are full objects, but LevelDB stores only their ids on the parent and writes
 * each page under a separate `!journal.pages!<journal>.<page>` key.
 */

export function compendiumRecords(document) {
  const key = document?._key;
  if (typeof key !== "string" || !key) {
    throw new Error(`Compendium document '${document?.name ?? document?._id ?? "unknown"}' has no _key`);
  }

  if (!key.startsWith("!journal!") || !Array.isArray(document.pages)) {
    return [{ type: "put", key, value: document }];
  }

  const journalId = key.slice("!journal!".length);
  if (!journalId || document._id !== journalId) {
    throw new Error(`Journal '${document.name ?? document._id ?? "unknown"}' has inconsistent _id and _key`);
  }

  const pageIds = [];
  const pageRecords = [];
  const seen = new Set();
  for (const page of document.pages) {
    if (typeof page === "string") {
      if (!page || seen.has(page)) throw new Error(`Journal '${document.name}' has an invalid or duplicate page id`);
      seen.add(page);
      pageIds.push(page);
      continue;
    }

    const pageId = page?._id;
    if (typeof pageId !== "string" || !pageId || seen.has(pageId)) {
      throw new Error(`Journal '${document.name}' has a page without a unique _id`);
    }
    seen.add(pageId);
    pageIds.push(pageId);
    const { _key: ignoredPageKey, ...pageValue } = page;
    pageRecords.push({
      type: "put",
      key: `!journal.pages!${journalId}.${pageId}`,
      value: pageValue
    });
  }

  const { _key: ignoredJournalKey, ...journalValue } = document;
  journalValue.pages = pageIds;
  return [{ type: "put", key, value: journalValue }, ...pageRecords];
}

export function journalPageKeyPrefix(journalId) {
  return `!journal.pages!${journalId}.`;
}
