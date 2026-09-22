#!/usr/bin/env node
// tools/build-effect-index-journal.mjs
// 라이브 packs/effects 를 읽어 「에너미 이펙트」를 제외한 전체 이펙트를
// 기존 폴더·정렬 순서대로 정리한 JournalEntry 하나를 만든다.
//
// 산출물:
//   _source/pack-journals/이펙트_목록_<id>.json   (릴리즈 재빌드용 원본)
//   packs/journals/                              (라이브 LevelDB 팩)
//
// 사용:
//   node tools/build-effect-index-journal.mjs            # 생성 + 라이브 팩 기록
//   node tools/build-effect-index-journal.mjs --dry-run  # 팩에는 쓰지 않고 요약만
//
// 읽기는 임시 복사본에서 한다 — LevelDB 는 열기만 해도 로그가 회전해 git status 가
// 더러워진다(CLAUDE.md 「팩을 읽는 도구는 임시 복사본에서 읽을 것」). 쓰기는 새 팩
// 디렉터리이므로 잠금 경합이 없지만, Foundry 실행 중이면 마지막에 경고를 남긴다.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath, pathToFileURL } from "node:url";
import { compendiumRecords, journalPageKeyPrefix } from "./compendium-records.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DRY_RUN = process.argv.includes("--dry-run");
const EXCLUDED_TOP_FOLDERS = new Set(["에너미 이펙트"]); // 하위 폴더까지 함께 제외

// ── Foundry ClassicLevel ────────────────────────────────────────────────────────
const app = process.env.FOUNDRY_APP_PATH || "C:/Program Files/Foundry Virtual Tabletop/resources/app";
const classicLevelPath = path.join(app, "node_modules", "classic-level", "index.js");
if (!fs.existsSync(classicLevelPath)) {
  console.error(`DX3rd | Foundry 의 ClassicLevel 을 찾지 못했다: ${classicLevelPath} (FOUNDRY_APP_PATH 설정)`);
  process.exit(3);
}
const { ClassicLevel } = await import(pathToFileURL(classicLevelPath).href);

// ── 결정적 16자리 ID (_source/build-effects.mjs 와 같은 규칙) ────────────────────
const ID_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
function genId(seed) {
  const h = crypto.createHash("sha256").update(String(seed)).digest();
  let s = "";
  for (let i = 0; i < 16; i++) s += ID_CHARS[h[i] % ID_CHARS.length];
  return s;
}

// ── 라이브 팩 읽기(임시 복사본) ─────────────────────────────────────────────────
async function readPack(name) {
  const dir = path.join(ROOT, "packs", name);
  const tmp = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "dx3rd-pack-"));
  try {
    for (const f of fs.readdirSync(dir)) {
      if (f === "LOCK") continue;
      fs.copyFileSync(path.join(dir, f), path.join(tmp, f));
    }
    const db = new ClassicLevel(tmp, { valueEncoding: "json" });
    await db.open();
    const docs = [], folders = new Map();
    try {
      for await (const [key, value] of db.iterator()) {
        if (key.startsWith("!folders!")) folders.set(value._id, value);
        else docs.push(value);
      }
    } finally {
      await db.close();
    }
    return { docs, folders };
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

// ── 표시 라벨 (lang/ko.json 과 동일 표기) ──────────────────────────────────────
const TIMING_LABEL = {
  major: "메이저", minor: "마이너", setup: "셋업", cleanup: "클린업",
  initiative: "이니셔티브", auto: "오토", reaction: "리액션",
  always: "상시", "major-reaction": "메이저|리액션", "-": "-"
};
const SKILL_LABEL = {
  syndrome: "신드롬", melee: "백병", ranged: "사격", rc: "RC", evade: "회피",
  perception: "지각", will: "의지", negotiation: "교섭", procure: "조달",
  info: "정보", drive: "운전", ars: "예술", know: "지식", knowledge: "지식",
  body: "육체", sense: "감각", mind: "정신", social: "사회", "-": "-"
};

const esc = (v) => String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const dash = (v) => (v === undefined || v === null || v === "" ? "-" : String(v));
const label = (map, v) => map[v] ?? dash(v);

function itemLink(item) {
  return `@UUID[Compendium.dx3rd-emanim.effects.Item.${item._id}]{${item.name}}`;
}

function targetRange(item) {
  const t = dash(item.system?.target), r = dash(item.system?.range);
  if (t === "-" && r === "-") return "-";
  if (t === "-") return r;
  return r === "-" ? t : `${t}(${r})`;
}

// The journal's own search matches whole pages, so every page offers the effect browser — the one place
// a single effect can be found by name or by what its text says. `main.js` enriches the token into a link.
const BROWSER_LINK = '<p>@EffectBrowser{이펙트 검색 열기} — 이펙트 이름이나 효과문으로 바로 찾습니다.</p>';

function effectTable(items) {
  const rows = items.map((it) => {
    const s = it.system ?? {};
    const lv = s.level?.max || "-";
    const enc = dash(s.encroach?.value);
    return "<tr>"
      + `<td>${itemLink(it)}</td>`
      + `<td style="text-align:center">${esc(lv)}</td>`
      + `<td>${esc(label(TIMING_LABEL, s.timing))}</td>`
      + `<td>${esc(label(SKILL_LABEL, s.skill))}</td>`
      + `<td>${esc(dash(s.difficulty))}</td>`
      + `<td>${esc(targetRange(it))}</td>`
      + `<td style="text-align:center">${esc(enc)}</td>`
      + `<td>${esc(dash(s.limit))}</td>`
      + "</tr>"
      + `<tr><th>효과</th><td colspan="7">${s.description ?? ""}</td></tr>`;
  }).join("\n");
  return `${BROWSER_LINK}\n<table>\n<thead><tr>`
    + `<th>이펙트</th><th>LV</th><th>타이밍</th><th>기능</th>`
    + `<th>난이도</th><th>대상(사정)</th><th>침식</th><th>제한</th>`
    + `</tr></thead>\n<tbody>\n${rows}\n</tbody>\n</table>`;
}

// ── 데이터 수집 ─────────────────────────────────────────────────────────────────
const { docs, folders } = await readPack("effects");
const items = docs.filter((d) => d.type === "effect");

const childrenOf = new Map(); // folderId -> child folders
for (const f of folders.values()) {
  if (!f.folder) continue;
  if (!childrenOf.has(f.folder)) childrenOf.set(f.folder, []);
  childrenOf.get(f.folder).push(f);
}
for (const list of childrenOf.values()) list.sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0));

const itemsIn = new Map(); // folderId|null -> items
for (const it of items) {
  const key = it.folder ?? null;
  if (!itemsIn.has(key)) itemsIn.set(key, []);
  itemsIn.get(key).push(it);
}
const collator = new Intl.Collator("ko");
for (const list of itemsIn.values()) list.sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0) || collator.compare(a.name, b.name));

function isExcluded(folderId) {
  let cur = folders.get(folderId);
  while (cur) {
    if (EXCLUDED_TOP_FOLDERS.has(cur.name)) return true;
    cur = cur.folder ? folders.get(cur.folder) : null;
  }
  return false;
}

// 페이지 정의: { title, items } — 최상위 폴더 순(에너미 이펙트 서브트리 제외).
// 자식 폴더가 있으면(이지이펙트) 자식마다 별 페이지.
const topFolders = [...folders.values()]
  .filter((f) => !f.folder && !EXCLUDED_TOP_FOLDERS.has(f.name))
  .sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0));

const pageDefs = [];
for (const folder of topFolders) {
  const own = (itemsIn.get(folder._id) ?? []).filter((it) => !isExcluded(it.folder));
  if (own.length) pageDefs.push({ title: folder.name, items: own });
  for (const child of childrenOf.get(folder._id) ?? []) {
    if (isExcluded(child._id)) continue;
    const childItems = itemsIn.get(child._id) ?? [];
    if (childItems.length) pageDefs.push({ title: `${folder.name}(${child.name})`, items: childItems });
  }
}
const loose = (itemsIn.get(null) ?? []).filter((it) => !isExcluded(it.folder));
if (loose.length) pageDefs.push({ title: "미분류", items: loose });

// ── 저널 문서 조립 ──────────────────────────────────────────────────────────────
const JOURNAL_ID = genId("journal|effect-index");
const JOURNAL_UUID = `Compendium.dx3rd-emanim.journals.JournalEntry.${JOURNAL_ID}`;

const pages = [];
let sort = 100000;
// 목차 페이지
const tocItems = pageDefs.map((p, i) => {
  const pid = genId(`journal-page|${i}|${p.title}`);
  return { ...p, _id: pid };
});
const toc = "<h1>이펙트 목록</h1>\n"
  + `<p>「에너미 이펙트」를 제외한 이펙트 컴펜디움 전체 — 총 ${pageDefs.reduce((n, p) => n + p.items.length, 0)}건. 기존 컴펜디움의 폴더·정렬 순서를 따른다.</p>\n`
  + `${BROWSER_LINK}\n`
  + "<ul>\n"
  + tocItems.map((p) => `  <li>@UUID[${JOURNAL_UUID}.JournalEntryPage.${p._id}]{${esc(p.title)}} — ${p.items.length}건</li>`).join("\n")
  + "\n</ul>";
pages.push({
  _id: genId("journal-page|toc"),
  name: "목차",
  type: "text",
  title: { show: true, level: 1 },
  text: { format: 1, content: toc, markdown: "" },
  sort,
  ownership: { default: -1 },
  flags: {}
});
sort += 100000;

for (const p of tocItems) {
  pages.push({
    _id: p._id,
    name: p.title,
    type: "text",
    title: { show: true, level: 1 },
    text: { format: 1, content: effectTable(p.items), markdown: "" },
    sort,
    ownership: { default: -1 },
    flags: {}
  });
  sort += 100000;
}

const journal = {
  _id: JOURNAL_ID,
  _key: `!journal!${JOURNAL_ID}`,
  name: "이펙트 목록",
  pages,
  folder: null,
  sort: 0,
  ownership: { default: 0 },
  flags: {}
};

// ── 출력 ────────────────────────────────────────────────────────────────────────
const total = pageDefs.reduce((n, p) => n + p.items.length, 0);
console.log(`DX3rd | 페이지 ${pages.length}개(목차 1 + 섹션 ${pageDefs.length}), 이펙트 ${total}건`);
for (const p of pageDefs) console.log(`DX3rd |   ${p.title}: ${p.items.length}건`);

const sourceDir = path.join(ROOT, "_source", "pack-journals");
fs.mkdirSync(sourceDir, { recursive: true });
const sourceFile = path.join(sourceDir, `이펙트_목록_${JOURNAL_ID}.json`);
fs.writeFileSync(sourceFile, JSON.stringify(journal, null, 1) + "\n", "utf8");
console.log(`DX3rd | 소스: ${path.relative(ROOT, sourceFile)}`);

if (DRY_RUN) {
  console.log("DX3rd | (dry-run) packs/journals 에는 쓰지 않았다.");
  process.exit(0);
}

const packDir = path.join(ROOT, "packs", "journals");
fs.mkdirSync(packDir, { recursive: true });
const db = new ClassicLevel(packDir, { valueEncoding: "json" });
try {
  await db.open();
} catch (err) {
  if (/LOCK|lock/i.test(String(err?.message))) {
    console.error(`DX3rd | 팩이 잠겨 있다(Foundry 실행 중?): packs/journals`);
    process.exit(1);
  }
  throw err;
}
try {
  const pagePrefix = journalPageKeyPrefix(JOURNAL_ID);
  const stalePageDeletes = [];
  for await (const key of db.keys({ gte: pagePrefix, lt: `${pagePrefix}\uffff` })) {
    stalePageDeletes.push({ type: "del", key });
  }
  await db.batch([...stalePageDeletes, ...compendiumRecords(journal)]);
} finally {
  await db.close();
}
// LOCK/LOG 는 LevelDB 런타임 산출물 — 팩 데이터가 아니므로 정리한다(build-compendia 와 동일).
for (const transient of ["LOCK", "LOG", "LOG.old"]) {
  fs.rmSync(path.join(packDir, transient), { force: true });
}
console.log(`DX3rd | packs/journals 에 저널 「${journal.name}」 기록 완료 (id ${JOURNAL_ID})`);
console.log("DX3rd | system.json 의 packs 에 journals 팩이 선언돼 있어야 월드에 보인다.");
