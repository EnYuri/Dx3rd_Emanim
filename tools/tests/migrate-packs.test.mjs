// tools/migrate-packs.mjs 의 동작 검증.
//
//   node --test tools/tests/migrate-packs.test.mjs
//
// 라이브 `packs/` 를 건드리지 않는다. 임시 디렉터리에 저장소 구조(system.json + packs/ +
// tools/migrate-packs.mjs)를 그대로 만들어 놓고 거기서 하네스를 돌린다 — 하네스가 ROOT 를
// **자기 파일 위치**에서 유도하므로 이 복사만으로 완전히 격리된다.

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const app = process.env.FOUNDRY_APP_PATH || "C:/Program Files/Foundry Virtual Tabletop/resources/app";
const classicLevelPath = path.join(app, "node_modules", "classic-level", "index.js");
const hasReader = fs.existsSync(classicLevelPath);

const DOCS = [
  { _id: "aaaaaaaaaaaaaaaa", name: "테스트 검", type: "weapon", system: { range: "3", attack: 5 } },
  { _id: "bbbbbbbbbbbbbbbb", name: "테스트 총", type: "weapon", system: { range: "12", attack: 7 } },
  { _id: "cccccccccccccccc", name: "이미 숫자", type: "weapon", system: { range: 4, attack: 1 } },
];

async function makeFixture() {
  const { ClassicLevel } = await import(pathToFileURL(classicLevelPath).href);
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "dx3rd-migrate-test-"));
  fs.mkdirSync(path.join(root, "tools"), { recursive: true });
  fs.copyFileSync(path.join(REPO, "tools", "migrate-packs.mjs"), path.join(root, "tools", "migrate-packs.mjs"));
  fs.writeFileSync(
    path.join(root, "system.json"),
    JSON.stringify({ packs: [{ name: "weapons", type: "Item", path: "packs/weapons" }] }),
    "utf8"
  );
  const packDir = path.join(root, "packs", "weapons");
  fs.mkdirSync(packDir, { recursive: true });
  const db = new ClassicLevel(packDir, { valueEncoding: "json" });
  await db.open();
  await db.batch([
    ...DOCS.map((d) => ({ type: "put", key: `!items!${d._id}`, value: d })),
    { type: "put", key: "!folders!dddddddddddddddd", value: { _id: "dddddddddddddddd", name: "사격" } },
  ]);
  await db.close();
  return { root, packDir };
}

async function readPack(packDir) {
  const { ClassicLevel } = await import(pathToFileURL(classicLevelPath).href);
  const db = new ClassicLevel(packDir, { valueEncoding: "json" });
  await db.open();
  const out = new Map();
  for await (const [key, value] of db.iterator()) out.set(key, value);
  await db.close();
  return out;
}

function writeMigration(root, name, body) {
  const dir = path.join(root, "tools", "migrations");
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, name);
  fs.writeFileSync(file, body, "utf8");
  return path.relative(root, file).replace(/\\/g, "/");
}

// 하네스는 종료 코드로 성패를 알린다. 실패도 검증 대상이므로 코드와 출력을 함께 돌려준다.
function run(root, args) {
  try {
    const stdout = execFileSync(process.execPath, [path.join(root, "tools", "migrate-packs.mjs"), ...args], {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { code: 0, stdout, stderr: "" };
  } catch (err) {
    return { code: err.status ?? 1, stdout: err.stdout ?? "", stderr: err.stderr ?? "" };
  }
}

const RANGE_TO_NUMBER = `
export const description = "무기 사거리를 문자에서 숫자로";
export const packs = ["weapons"];
export function migrate(doc) {
  const range = doc.system?.range;
  if (typeof range !== "string" || !/^\\d+$/.test(range)) return;
  doc.system.range = Number(range);
}
`;

test("migrate-packs", { skip: hasReader ? false : "ClassicLevel 없음(FOUNDRY_APP_PATH)" }, async (t) => {
  await t.test("dry-run 은 LevelDB 를 수정하지 않고 변경 예정만 보고한다", async () => {
    const { root, packDir } = await makeFixture();
    const script = writeMigration(root, "range.mjs", RANGE_TO_NUMBER);
    const before = await readPack(packDir);

    const r = run(root, ["--script", script]);
    assert.equal(r.code, 0, r.stderr);
    // 문자열 두 건만. 이미 숫자인 것과 폴더 문서는 제외.
    assert.match(r.stdout, /weapons: 3건 검사 \/ 2건 변경/);
    assert.match(r.stdout, /테스트 검: system\.range "3" -> 3/);
    assert.match(r.stdout, /LevelDB 는 수정되지 않았다/);

    const after = await readPack(packDir);
    assert.deepEqual([...after.entries()], [...before.entries()]);
  });

  await t.test("apply 는 값을 바꾸고, 다른 필드와 다른 문서는 그대로 둔다", async () => {
    const { root, packDir } = await makeFixture();
    const script = writeMigration(root, "range.mjs", RANGE_TO_NUMBER);

    const r = run(root, ["--script", script, "--apply", "--confirm-live-pack"]);
    assert.equal(r.code, 0, r.stderr);

    const after = await readPack(packDir);
    assert.equal(after.get("!items!aaaaaaaaaaaaaaaa").system.range, 3);
    assert.equal(after.get("!items!bbbbbbbbbbbbbbbb").system.range, 12);
    // 손대지 않은 필드/문서는 저장값 그대로 — 재빌드가 아니라 필드 교체라는 것이 이 통로의 전부다.
    assert.equal(after.get("!items!aaaaaaaaaaaaaaaa").system.attack, 5);
    assert.equal(after.get("!items!cccccccccccccccc").system.range, 4);
    assert.deepEqual(after.get("!folders!dddddddddddddddd"), { _id: "dddddddddddddddd", name: "사격" });
    assert.equal(after.size, 4);
  });

  await t.test("ctx.delete 는 지정 문서만 백업 가능한 삭제로 제거한다", async () => {
    const { root, packDir } = await makeFixture();
    const script = writeMigration(root, "delete-duplicate.mjs", `
export const description = "확인된 중복 문서 제거";
export const packs = ["weapons"];
export function migrate(doc, ctx) {
  if (doc._id === "bbbbbbbbbbbbbbbb") ctx.delete();
}
`);

    const dry = run(root, ["--script", script]);
    assert.equal(dry.code, 0, dry.stderr);
    assert.match(dry.stdout, /테스트 총: \$document/);
    assert.ok((await readPack(packDir)).has("!items!bbbbbbbbbbbbbbbb"), "dry-run 은 삭제하지 않는다");

    const done = run(root, ["--script", script, "--apply", "--confirm-live-pack"]);
    assert.equal(done.code, 0, done.stderr);
    const after = await readPack(packDir);
    assert.ok(!after.has("!items!bbbbbbbbbbbbbbbb"));
    assert.ok(after.has("!items!aaaaaaaaaaaaaaaa"));
    assert.ok(after.has("!items!cccccccccccccccc"));
    assert.equal(after.size, 3);
    assert.match(done.stdout, /1건 기록/);
  });

  await t.test("create(ctx)는 신규 아이템을 dry-run·백업·멱등성 경로로 생성한다", async () => {
    const { root, packDir } = await makeFixture();
    const script = writeMigration(root, "create.mjs", `
export const description = "신규 아이템 생성";
export const packs = ["weapons"];
export function create(ctx) {
  ctx.item({
    _id: "eeeeeeeeeeeeeeee",
    name: "신규 무기",
    type: "weapon",
    system: { attack: 9 }
  });
}
`);

    const dry = run(root, ["--script", script]);
    assert.equal(dry.code, 0, dry.stderr);
    assert.match(dry.stdout, /weapons: 3건 검사 \/ 1건 변경/);
    assert.match(dry.stdout, /신규 무기: \$document/);
    assert.ok(!(await readPack(packDir)).has("!items!eeeeeeeeeeeeeeee"));

    const done = run(root, ["--script", script, "--apply", "--confirm-live-pack"]);
    assert.equal(done.code, 0, done.stderr);
    assert.equal((await readPack(packDir)).get("!items!eeeeeeeeeeeeeeee").system.attack, 9);

    const again = run(root, ["--script", script]);
    assert.equal(again.code, 0, again.stderr);
    assert.match(again.stdout, /0건 변경/);
  });

  await t.test("create(ctx)는 16자리 ID와 완전한 아이템 문서를 요구한다", async () => {
    const { root, packDir } = await makeFixture();
    const script = writeMigration(root, "invalid-create.mjs", `
export const description = "잘못된 신규 아이템";
export const packs = ["weapons"];
export function create(ctx) {
  ctx.item({ _id: "short", name: "불완전", type: "weapon" });
}
`);
    const r = run(root, ["--script", script, "--apply", "--confirm-live-pack"]);
    assert.equal(r.code, 1);
    assert.match(r.stderr, /_id 는 16자리 영숫자/);
    assert.equal((await readPack(packDir)).size, 4);
    assert.ok(!fs.existsSync(path.join(root, "dist", "pack-backups")));
  });

  await t.test("create(ctx)는 기존 키의 다른 문서를 쓰기 전에 거부한다", async () => {
    const { root, packDir } = await makeFixture();
    const script = writeMigration(root, "colliding-create.mjs", `
export const description = "충돌하는 신규 아이템";
export const packs = ["weapons"];
export function create(ctx) {
  ctx.item({
    _id: "aaaaaaaaaaaaaaaa",
    name: "기존 ID를 가로채는 무기",
    type: "weapon",
    system: { attack: 999 }
  });
}
`);
    const r = run(root, ["--script", script, "--apply", "--confirm-live-pack"]);
    assert.equal(r.code, 1);
    assert.match(r.stderr, /이미 다른 문서에 쓰이고 있다/);
    assert.equal((await readPack(packDir)).get("!items!aaaaaaaaaaaaaaaa").name, "테스트 검");
    assert.ok(!fs.existsSync(path.join(root, "dist", "pack-backups")));
  });

  await t.test("기록할 때마다 다른 문서를 만드는 create(ctx)를 멱등성 검증이 잡는다", async () => {
    const { root } = await makeFixture();
    const script = writeMigration(root, "unstable-create.mjs", `
export const description = "호출마다 다른 신규 아이템";
export const packs = ["weapons"];
let call = 0;
export function create(ctx) {
  call++;
  ctx.item({
    _id: call === 1 ? "eeeeeeeeeeeeeeee" : "ffffffffffffffff",
    name: "불안정 생성",
    type: "weapon",
    system: { attack: 1 }
  });
}
`);
    const r = run(root, ["--script", script, "--apply", "--confirm-live-pack"]);
    assert.equal(r.code, 1);
    assert.match(r.stderr, /멱등성 검증 실패/);
    assert.match(r.stderr, /--restore dist\/pack-backups\//);
  });

  await t.test("백업이 남고 --restore 가 그것을 되돌린다", async () => {
    const { root, packDir } = await makeFixture();
    const script = writeMigration(root, "range.mjs", RANGE_TO_NUMBER);
    run(root, ["--script", script, "--apply", "--confirm-live-pack"]);

    const stamps = fs.readdirSync(path.join(root, "dist", "pack-backups"));
    assert.equal(stamps.length, 1);
    const backup = `dist/pack-backups/${stamps[0]}`;
    // LOCK 은 런타임 산물이라 백업에 들어가면 안 된다.
    assert.ok(!fs.existsSync(path.join(root, backup, "weapons", "LOCK")));

    const dry = run(root, ["--restore", backup]);
    assert.equal(dry.code, 0, dry.stderr);
    assert.match(dry.stdout, /\(dry-run\) 복원 대상 1개 팩/);
    assert.equal((await readPack(packDir)).get("!items!aaaaaaaaaaaaaaaa").system.range, 3, "dry-run 복원이 팩을 바꿔선 안 된다");

    const done = run(root, ["--restore", backup, "--apply", "--confirm-live-pack"]);
    assert.equal(done.code, 0, done.stderr);
    assert.equal((await readPack(packDir)).get("!items!aaaaaaaaaaaaaaaa").system.range, "3");
  });

  await t.test("멱등하지 않은 마이그레이션을 기록 직후 잡아낸다", async () => {
    const { root } = await makeFixture();
    // 조건이 자기 결과에 또 걸린다 — 돌릴 때마다 접두사가 하나씩 늘어난다.
    const script = writeMigration(root, "prefix.mjs", `
export const description = "이름에 접두사 붙이기(일부러 멱등하지 않음)";
export const packs = ["weapons"];
export function migrate(doc) { doc.name = "★" + doc.name; }
`);
    const r = run(root, ["--script", script, "--apply", "--confirm-live-pack"]);
    assert.equal(r.code, 1);
    assert.match(r.stderr, /멱등성 검증 실패/);
    // 백업 경로를 함께 알려야 되돌릴 수 있다.
    assert.match(r.stderr, /--restore dist\/pack-backups\//);
  });

  await t.test("_id 변경은 거부한다", async () => {
    const { root, packDir } = await makeFixture();
    const script = writeMigration(root, "reid.mjs", `
export const description = "_id 를 바꾼다(금지)";
export const packs = ["weapons"];
export function migrate(doc) { doc._id = "zzzzzzzzzzzzzzzz"; }
`);
    const r = run(root, ["--script", script, "--apply", "--confirm-live-pack"]);
    assert.notEqual(r.code, 0);
    assert.match(r.stderr, /_id 를 바꿨다/);
    assert.ok((await readPack(packDir)).has("!items!aaaaaaaaaaaaaaaa"));
  });

  await t.test("--apply 는 --confirm-live-pack 없이는 거부한다", async () => {
    const { root, packDir } = await makeFixture();
    const script = writeMigration(root, "range.mjs", RANGE_TO_NUMBER);
    const r = run(root, ["--script", script, "--apply"]);
    assert.equal(r.code, 2);
    assert.match(r.stderr, /--confirm-live-pack/);
    assert.equal((await readPack(packDir)).get("!items!aaaaaaaaaaaaaaaa").system.range, "3");
  });

  await t.test("모듈이 좁혀 둔 범위 밖의 팩은 --pack 으로도 열리지 않는다", async () => {
    const { root } = await makeFixture();
    const script = writeMigration(root, "narrow.mjs", `
export const description = "effects 전용";
export const packs = ["effects"];
export function migrate() {}
`);
    const r = run(root, ["--script", script, "--pack", "weapons"]);
    assert.equal(r.code, 2);
    assert.match(r.stderr, /이 마이그레이션의 대상이 아닌 팩: weapons/);
  });

  await t.test("커밋되지 않은 팩 변경이 있으면 --apply 를 거부한다(--allow-dirty 로 해제)", async () => {
    const { root, packDir } = await makeFixture();
    const script = writeMigration(root, "range.mjs", RANGE_TO_NUMBER);
    const git = (...args) => execFileSync("git", args, { cwd: root, stdio: "ignore" });
    git("init", "-q");
    git("config", "user.email", "t@example.com");
    git("config", "user.name", "t");
    git("add", "system.json");
    git("commit", "-qm", "init");
    // packs/ 가 커밋되지 않은 상태 = 마이그레이션 결과와 뒤섞이는 상태.

    const blocked = run(root, ["--script", script, "--apply", "--confirm-live-pack"]);
    assert.equal(blocked.code, 1);
    assert.match(blocked.stderr, /커밋되지 않은 팩 변경이 있다: weapons/);
    assert.equal((await readPack(packDir)).get("!items!aaaaaaaaaaaaaaaa").system.range, "3", "막혔으면 쓰지 않아야 한다");
    assert.ok(!fs.existsSync(path.join(root, "dist", "pack-backups")), "막혔으면 백업도 만들지 않는다");

    const forced = run(root, ["--script", script, "--apply", "--confirm-live-pack", "--allow-dirty"]);
    assert.equal(forced.code, 0, forced.stderr);
    assert.equal((await readPack(packDir)).get("!items!aaaaaaaaaaaaaaaa").system.range, 3);
  });

  await t.test("description 없는 모듈은 거부한다", async () => {
    const { root } = await makeFixture();
    const script = writeMigration(root, "nodesc.mjs", `export function migrate() {}`);
    const r = run(root, ["--script", script]);
    assert.equal(r.code, 2);
    assert.match(r.stderr, /description 이 없다/);
  });

  await t.test("견본 모듈은 아무것도 바꾸지 않는다", async () => {
    const { root, packDir } = await makeFixture();
    const dir = path.join(root, "tools", "migrations");
    fs.mkdirSync(dir, { recursive: true });
    fs.copyFileSync(path.join(REPO, "tools", "migrations", "_template.mjs"), path.join(dir, "_template.mjs"));
    const before = await readPack(packDir);
    const r = run(root, ["--script", "tools/migrations/_template.mjs", "--apply", "--confirm-live-pack"]);
    assert.equal(r.code, 0, r.stderr);
    assert.match(r.stdout, /바꿀 것이 없었다/);
    assert.deepEqual([...(await readPack(packDir)).entries()], [...before.entries()]);
  });
});
