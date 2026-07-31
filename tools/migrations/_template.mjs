// 팩 마이그레이션 모듈 견본. 복사해서 `tools/migrations/<날짜>-<무엇>.mjs` 로 쓴다.
//
//   node tools/migrate-packs.mjs --script tools/migrations/<파일>.mjs            # dry-run
//   node tools/migrate-packs.mjs --script tools/migrations/<파일>.mjs --verbose  # 전건 출력
//   node tools/migrate-packs.mjs --script tools/migrations/<파일>.mjs --apply --confirm-live-pack
//
// 이 견본 자체는 아무것도 바꾸지 않는다(그대로 돌리면 0건).
//
// ── 쓰는 요령 ───────────────────────────────────────────────────────────────────
// * **바꾼 것을 보고할 필요가 없다.** 하네스가 원본과 복제본을 비교해 잎 경로 단위로
//   before/after 를 뽑는다. 손으로 적는 변경 목록은 실제 동작과 어긋나기 마련이다.
// * **읽고 쓰는 조건을 같은 식으로 적지 말 것.** `if (x !== 새값) x = 새값` 처럼 결과가
//   조건을 무너뜨리는 형태로 써야 두 번 돌려도 안전하다. 하네스가 기록 직후 재실행해
//   0건인지 확인하고(멱등성 검증), 아니면 백업 경로와 함께 실패로 알린다. 성질상 멱등할
//   수 없는 마이그레이션이라면 `export const idempotent = false` 로 그 검증을 끈다.
// * **모르는 필드는 건드리지 말 것.** 이 통로의 값은 재빌드가 아니라 「그 필드만 교체」다.
//   그것이 works/syndromes·Foundry 신규 문서를 지키는 이유이므로, 필요 최소만 만진다.
// * `packs` 를 좁혀 두면 `--pack` 으로도 그 밖의 팩을 열 수 없다. 스키마 가정이 특정
//   아이템 타입에만 성립한다면 반드시 좁힐 것.

/** 리포트에 남는다. 무엇을 왜 바꾸는지 한 줄. */
export const description = "견본 — 아무것도 바꾸지 않는다";

/**
 * 선택. 생략하면 system.json 에 선언된 팩 전체를 대상으로 한다 — 목록을 여기에 베껴 두면
 * 팩이 늘었을 때 조용히 낡으므로, 좁힐 이유가 있을 때만 적는다.
 *   export const packs = ["weapons", "armors"];
 */

/** 선택(기본 false). 폴더 문서(`!folders!…`)까지 migrate 에 넘길지. */
export const includeFolders = false;

/** 선택(기본 true). 기록 후 재실행해 0건인지 검증할지. */
export const idempotent = true;

/**
 * 선택. 신규 문서를 넣을 때 팩마다 한 번 호출된다. 이름 중복은 허용되므로 결정적 `_id`에
 * 출전·종별을 포함하고, 같은 모듈을 재실행하면 정확히 같은 문서를 요청해야 한다.
 *
 * @param {{pack: string, item: (doc: object) => void, folder: (doc: object) => void,
 *          fail: (m: string) => void}} ctx
 */
// export function create(ctx) {
//   if (ctx.pack !== "items") return;
//   ctx.item({
//     _id: "aaaaaaaaaaaaaaaa",
//     name: "신규 아이템",
//     type: "etc",
//     system: {},
//   });
// }

/**
 * @param {object} doc  저장 문서의 **복제본**. 그 자리에서 고치거나 새 문서를 return.
 * @param {{pack: string, key: string, original: object, isFolder: boolean,
 *          log: (m: string) => void, fail: (m: string) => void,
 *          delete: () => void}} ctx
 *   ctx.fail 은 「고칠 수 없는 상태를 발견했다」는 보고다 — 그 건은 기록하되 종료 코드가 1이 된다.
 *   ctx.delete 는 현재 문서를 팩에서 제거한다. 하네스의 팩 백업·리포트·멱등성 검증을 그대로 거친다.
 */
export function migrate(doc, ctx) {
  // 예) 무기의 사거리 표기를 문자에서 숫자로.
  //
  //   if (doc.type !== "weapon") return;
  //   const range = doc.system?.range;
  //   if (typeof range !== "string" || !/^\d+$/.test(range)) return;
  //   doc.system.range = Number(range);
  //
  // 예) 존재하지 않을 수 있는 중첩 경로에 값을 넣기.
  //
  //   doc.system.active ??= {};
  //   if (doc.system.active.applyMode === undefined) doc.system.active.applyMode = "toggle";
  //
  // 예) 손댈 수 없는 이상 상태를 보고만 하기.
  //
  //   if (doc.system?.attack === undefined) ctx.fail("attack 필드가 없다");
  //
  // 예) 명시적으로 확인한 중복 문서를 제거하기.
  //
  //   if (doc._id === "aaaaaaaaaaaaaaaa") ctx.delete();

  void doc;
  void ctx;
}
