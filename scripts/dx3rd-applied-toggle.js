// DX3rd Applied Toggle 동기화
// ---------------------------------------------------------------------------
// dnd5e 방식 정리(Phase 2): "이펙트류"(effect/spell/psionic/combo)를 토글하면 그 지속 기여를
// 네이티브 ActiveEffect(appliedKey AE)로 반영한다. 이렇게 하면
//   (1) 시트 Applied 탭에 표시되고(collect()가 appliedKey AE를 읽음 — 최우선 요구),
//   (2) 계산도 같은 소스(_indexAppliedEffects)를 타 단일 경로가 된다.
// 그 대가로 actor.js 는 이 4개 타입을 자체계산(activeItems)에서 제외한다(이중가산 방지).
//
// 장비(weapon/protect/vehicle)·기록(rois)·아이템(connection)·기타(once/etc)는 여전히
// 아이템 자체계산(activeItems)로 남는다 — 순수 스텟 변화는 AE가 아니다.
//
// 값 동결/추종: AE payload.attributes 에는 "평가된 숫자"를 넣는다(_indexAppliedEffects 가
// object 형 value 를 그대로 소비하므로). [level] 등 수식 추종은 updateActor/updateItem 마다
// 재-set 으로 처리한다(구 미러 로직 승계, 토글 순간 1-렌더 지연 수용 — self-heal).
//
// appliedKey 네임스페이스: `toggle:<itemId>`. 각 아이템의 active.state만 그 아이템의
// 지속 AE를 만든다. 콤보는 자신의 attributes만 toggle:<comboId>로 반영하며, 구성 이펙트의
// 지속 여부는 각 이펙트의 독립 토글이 관리한다.
// ---------------------------------------------------------------------------
(function () {

  const SCOPE = 'dx3rd-emanim';
  const KEY_PREFIX = 'toggle:';
  // 이펙트류(→AE). 나머지(장비/기록/아이템/기타)는 actor.js 자체계산에 남는다.
  const TOGGLE_TYPES = ['effect', 'spell', 'psionic', 'combo'];

  /**
   * 아이템 훅이 applied-toggle 동기화를 유발해야 하는 타입인가.
   * combo는 구성 effect를 참조하므로, 활성 여부와 관계없이 effect 변경은 동기화한다.
   * 그 외 타입은 desiredPayloads()가 읽지 않아 장비 수정·상비화·이름 변경마다
   * 액터 전체의 토글 효과를 재탐색할 필요가 없다.
   */
  function isToggleSourceItem(item) {
    return !!item && TOGGLE_TYPES.includes(item.type);
  }

  // 재진입 방지는 액터 단위. 전역 플래그로 두면 백필/동시 동기화 때 첫 액터가 잡은 사이
  // 나머지 액터의 sync 가 전부 스킵된다(서로 다른 액터는 간섭하면 안 됨).
  // 액터별 진행 중 동기화 Promise. 같은 액터의 후속 호출은 false로 빠지지 않고
  // 현재 작업 완료를 대기한다. 콤보가 이펙트를 켠 직후 바로 공격값을 읽는 경로에서
  // AE 반영 전 수치를 읽지 않도록 보장한다.
  const syncing = new Map();

  /** 이 클라이언트가 해당 액터의 AE 를 쓸 단일 책임자인가(GM 우선, 없으면 최소 id 소유자). */
  function isResponsible(actor) {
    const owners = game.users.filter(u => u.active && actor.testUserPermission?.(u, 'OWNER'));
    if (!owners.length) return game.user.isGM; // 소유 활성 유저 없음 → GM 이 처리
    const gm = owners.find(u => u.isGM);
    const responsible = gm || owners.sort((a, b) => a.id.localeCompare(b.id))[0];
    return responsible?.id === game.user.id;
  }

  /** 아이템 attributes 를 평가된 숫자로 동결한 { storeKey: {key,label,value} } 로 변환. */
  function evaluatedAttrs(item, actor) {
    const out = {};
    const map = item.system?.attributes;
    if (!map) return out;
    const EV = window.DX3rdFormulaEvaluator;
    for (const [storeK, a] of Object.entries(map)) {
      if (!a || a.key === undefined || a.key === null || a.key === '-') continue;
      // 시트는 사용자가 추가한 빈 행(값 공백)을 그대로 저장한다. 값이 비어 있으면 걸 보정이 없다 —
      // 통과시키면 evaluate가 0으로 떨어져 "보정 0짜리" 항목만 남는다(universal-apply의
      // hasUsableAttribute와 같은 기준). 존재 플래그형(boolean)은 값 자체가 의미이므로 예외.
      if (typeof a.value !== 'boolean' && String(a.value ?? '').trim() === '') continue;
      let value;
      if (typeof a.value === 'boolean') value = a.value;           // 존재 플래그형(move_half 등)
      else {
        const prepared = EV?.prepareRollFormula?.(a.value, item, actor) ?? String(a.value ?? '0');
        // 행동 시점에 굴려야 하는 보정은 AE에도 원 수식을 보존한다.
        // 키 목록은 DX3rdFormulaEvaluator.ROLL_TIME_KEYS 단일 정의를 쓴다.
        value = EV?.isRollTimeKey?.(a.key) && EV?.hasDice?.(prepared)
          ? prepared
          : (Number(EV?.evaluate(a.value, item, actor)) || 0);
      }
      out[storeK] = { key: a.key, label: a.label ?? null, value };
    }
    return out;
  }

  /** 아이템 → applied payload(평가값 동결). */
  function buildPayload(item, actor) {
    const desc = item.system?.effect?.description || item.system?.description || '';
    return {
      itemId: item.id,
      name: item.name,
      img: item.img,
      source: item.type,
      // 토글 수명은 active.state 가 관리한다 → AE 자체는 자동 비활성(disable) 대상 아님.
      disable: '-',
      description: desc,
      // 오버레이 기본값: 토큰 OFF / 스크린 ON (효과 탭 편집에서 per-effect 토글).
      showOnToken: false,
      showOnScreen: true,
      attributes: evaluatedAttrs(item, actor)
    };
  }

  /** 액터의 현재 독립 토글 상태로부터 원하는 { appliedKey: payload } 집합을 만든다. */
  function desiredPayloads(actor) {
    const desired = new Map();
    const add = (item) => {
      const key = `${KEY_PREFIX}${item.id}`;
      if (desired.has(key)) return;
      const payload = buildPayload(item, actor);
      // 자기 보정(system.attributes)이 하나도 없는 아이템은 AE를 만들지 않는다.
      // 대상 전용 이펙트(대상 탭 system.effect.attributes 만 채워진 것)도 사용 시
      // active.state 는 켜진다(runTiming/disable 게이트만 보는 활성화 경로들 —
      // handleItemUse·activateItem·채팅 afterSuccess/afterDamage 버튼). 그걸 그대로
      // payload 로 만들면 걸 값이 0개인 더미 AE 가 시전자 본인에게 씌워진다.
      // 토글 상태의 단일 소스는 item.system.active.state 이므로(AE 존재 여부가 아님)
      // 여기서 빼도 활성 표시·콤보 지속 판정은 영향이 없다.
      // 기존에 생긴 더미는 syncPlan 의 toDelete 가 다음 동기화에서 지운다(self-heal).
      if (!Object.keys(payload.attributes).length) return;
      desired.set(key, payload);
    };
    const toggled = (actor.items || []).filter(i =>
      i.system?.active?.state === true && TOGGLE_TYPES.includes(i.type));
    for (const item of toggled) {
      add(item);
    }
    return desired;
  }

  // 수식 평가기(DX3rdFormulaEvaluator)가 payload 평가 시 참조하는 actor.system 하위 경로는
  // 능력치 total(body/sense/mind/social)·스킬 total·encroachment.level 뿐이다. 아래 경로만
  // 바뀌었다면 재평가는 반드시 전량 no-op 이 되므로 sync 를 통째로 스킵한다.
  //   · attributes.hp: 전투 데미지/회복 핫패스 — 어떤 payload 수식도 hp 를 읽지 않는다.
  const PAYLOAD_IRRELEVANT_SYSTEM = ['attributes.hp'];

  /** changed.system 변경이 payload 평가에 영향을 줄 수 있는가(무관 경로만이면 false). */
  function systemChangeAffectsPayload(changed) {
    const sys = changed?.system;
    if (!sys) return false;
    const leaves = Object.keys(foundry.utils.flattenObject(sys));
    if (!leaves.length) return false;
    return leaves.some(k => !PAYLOAD_IRRELEVANT_SYSTEM.some(p => k === p || k.startsWith(p + '.')));
  }

  /** 기존 AE 의 payload 와 새 payload 가 실질적으로 다른가(수식 추종 감지). */
  function payloadChanged(eff, payload) {
    const prev = eff.getFlag?.(SCOPE, 'applied') || {};
    if (prev.name !== payload.name || prev.img !== payload.img) return true;
    if ((prev.disable || '-') !== (payload.disable || '-')) return true;
    return JSON.stringify(prev.attributes || {}) !== JSON.stringify(payload.attributes || {});
  }

  /** 한 액터의 토글 AE 보정 계획. 읽기 전용 검사와 실제 적용이 같은 기준을 쓴다. */
  function syncPlan(actor) {
    const desired = desiredPayloads(actor);
    const existing = (actor.effects || []).filter(e =>
      String(e.getFlag?.(SCOPE, 'appliedKey') || '').startsWith(KEY_PREFIX));
    const existingByKey = new Map(existing.map(e => [e.getFlag(SCOPE, 'appliedKey'), e]));
    const toDelete = existing.filter(e => !desired.has(e.getFlag(SCOPE, 'appliedKey'))).map(e => e.id);
    const toSet = [];
    for (const [key, payload] of desired) {
      const eff = existingByKey.get(key);
      if (!eff || payloadChanged(eff, payload)) toSet.push([key, payload]);
    }
    return { toDelete, toSet };
  }

  /** 계획 1회 실행. AE 쓰기는 한 번에 몰아서 한다(아이템 수만큼의 재파생·재렌더 방지). */
  function runPlan(actor, { toDelete, toSet }) {
    return (async () => {
      try {
        if (toDelete.length) {
          await actor.deleteEmbeddedDocuments('ActiveEffect', toDelete, { render: false });
        }
        if (toSet.length) {
          // 능력치/레벨 변경에 따른 payload 재평가는 AE의 임시 비활성화를 되돌리지 않는다.
          if (window.DX3rdAppliedEffects.setMany) {
            await window.DX3rdAppliedEffects.setMany(actor, toSet, {preserveDisabled: true});
          } else {
            for (const [key, payload] of toSet) {
              await window.DX3rdAppliedEffects.set(actor, key, payload, {preserveDisabled: true});
            }
          }
        }
        return true;
      } catch (e) {
        console.error('DX3rd | applied-toggle sync 실패:', actor?.name, e);
        return false;
      }
    })();
  }

  // 재계획 패스 상한. 정상적으로는 2패스(진행 중 대기 → 최신 재계획)면 수렴한다.
  // 쓰기 중에 도착한 훅은 아래 훅 가드에서 버려지므로, 그 변경을 줍는 것은 이 재계획
  // 패스의 책임이다 — 콤보 멤버를 한 번에 여러 개 켜면 멤버 수만큼 패스가 필요할 수 있다.
  const MAX_SYNC_PASSES = 6;

  /**
   * 액터의 토글 AE 집합을 현재 토글 상태에 맞춰 upsert/remove.
   *
   * 진행 중 동기화가 있으면 "그것만 기다리고 끝내면 안 된다" — 계획(syncPlan)은 시작
   * 시점에 고정되므로 그 뒤에 켜진 이펙트는 반영되지 않는다. 콤보가 멤버 이펙트를
   * 연달아 켜는 경로(combo-handler processInstantExtensions)에서 이 차이가 그대로
   * 버그가 됐다: 첫 멤버의 sync 만 기다린 뒤 공격값을 읽어, 나머지 멤버의 보정이
   * 조용히 빠진다(훅 타이밍에 따라 간헐 재현). → 완료를 기다린 뒤 최신 상태로 재계획한다.
   */
  async function sync(actor) {
    if (!actor) return false;
    if (actor.type !== 'character' && actor.type !== 'enemy') return false;
    if (!isResponsible(actor)) return false;
    if (!window.DX3rdAppliedEffects?.set) return false;

    // 명시 호출이 이 액터를 지금 처리하므로 대기 중인 훅 타이머는 불필요하다.
    // (남겨도 빈 계획으로 no-op 하지만, 판정 직후 불필요한 재계획을 줄인다)
    const pendingTimer = hookSyncTimers.get(actor.id);
    if (pendingTimer) {
      clearTimeout(pendingTimer);
      hookSyncTimers.delete(actor.id);
    }

    let changed = false;
    for (let pass = 0; pass < MAX_SYNC_PASSES; pass++) {
      const inflight = syncing.get(actor.id);
      if (inflight) {
        await inflight.catch(() => false);
        continue; // 최신 상태로 다시 계획
      }
      const plan = syncPlan(actor);
      if (!plan.toDelete.length && !plan.toSet.length) return changed; // no-op → 훅 캐스케이드 방지
      // 진행 표식은 이 함수가 걸고 이 함수가 지운다. runPlan 안에서 지우면 쓰기가 전부
      // 동기 반환된 경우 set() 보다 delete 가 먼저 일어나 표식이 영구히 남는다.
      const task = runPlan(actor, plan);
      syncing.set(actor.id, task);
      try {
        changed = (await task) || changed;
      } finally {
        syncing.delete(actor.id);
      }
    }
    console.warn('DX3rd | applied-toggle sync did not settle within', MAX_SYNC_PASSES, 'passes:', actor?.name);
    return changed;
  }

  /**
   * 명시적 전체 보정. 월드 기동 중 전수 AE 주입은 하지 않는다.
   * 과거 데이터 복구가 필요할 때 GM이 콘솔에서
   * `window.DX3rdAppliedToggle.syncAll()`로만 실행한다.
   */
  async function syncAll() {
    if (!game.user?.isGM) {
      ui.notifications?.warn('DX3rd | GM만 적용 효과 전체 보정을 실행할 수 있습니다.');
      return { scanned: 0, changed: 0 };
    }
    let scanned = 0;
    let changed = 0;
    for (const actor of game.actors) {
      if (actor.type !== 'character' && actor.type !== 'enemy') continue;
      scanned++;
      if (await sync(actor)) changed++;
    }
    window.DX3rdDebug.log(`DX3rd | AppliedToggle explicit sync: ${scanned} actors scanned, ${changed} changed.`);
    return { scanned, changed };
  }

  // ---------------------------------------------------------------------------
  // '상시' 이펙트의 취득 시 자동 활성화
  //
  // 컴펜디움 아이템은 전부 active.state=false 로 빌드된다(_source/build-effects.mjs).
  // 그래서 「상시」 타이밍 이펙트를 임포트하면 지속 보정이 꺼진 채로 들어오고, 시트에서
  // 직접 체크하지 않으면 룰상 항상 켜져 있어야 할 효과가 조용히 빠진다. 더 나쁜 것은
  // 그 이펙트를 콤보에 넣어 쓰면 발동 시점에 켜지면서 그 사용에만 반영되는 것처럼 보여,
  // "간헐적으로 가산이 안 된다"로 관측된다는 점이다.
  //
  // 판정 기준은 시트가 활성 토글을 그리는 기준과 반드시 같아야 한다
  // (actor-sheet-data usesSelfEffectActiveToggle 단일 소스). 어긋나면 토글도 없이
  // 자동으로만 켜지는 아이템이 생긴다.
  // 개입은 생성 시 1회뿐이다 — 사용자가 끈 상태는 그대로 유지된다.
  // ---------------------------------------------------------------------------
  function isAlwaysOnCandidate(item) {
    if (!item || item.system?.active?.state === true) return false;
    // 시트 토글 기준은 자동 활성화 기준보다 넓다: 자기 보정을 '활성화'로 저작한 이펙트는
    // 상시가 아니어도 토글을 그린다(켠 뒤 끌 채널이 필요하므로). 그쪽까지 취득만으로 켜면
    // 아직 사용한 적 없는 이펙트가 발동해 버린다 → 자동 활성화는 상시에만 건다.
    // 여기서 빼는 것은 그 케이스뿐이며, 로이스의 상시 버프(타이밍 필드 없음)는 그대로 둔다.
    const adapter = window.DX3rdItemEffectAdapter;
    const declaredActivation = adapter
      ? adapter.declaresActivationSelfModifiers(item)
      : (item.system?.active?.action === 'activation' || item.system?.active?.applyMode === 'toggle');
    if (declaredActivation && item.system?.timing !== 'always') return false;
    const predicate = window.DX3rdActorSheetData?.usesSelfEffectActiveToggle;
    if (typeof predicate !== 'function') return false;
    try {
      return !!predicate(item);
    } catch (e) {
      console.warn('DX3rd | always-on 판정 실패:', item?.name, e);
      return false;
    }
  }

  /** 액터별 상시 활성화 대기 큐. 같은 틱에 도착한 생성들을 한 번의 배치로 켠다. */
  const alwaysOnPending = new Map();

  function ownedItemById(actor, id) {
    return actor.items?.get?.(id) ?? (actor.items || []).find?.(item => item.id === id) ?? null;
  }

  /**
   * 상시 후보면 배치 큐에 넣고 true. 액터 임포트/컴펜디움 다중 드래그는 createItem 을
   * 아이템 수만큼 발생시키므로, 하나씩 update 하면 그 수만큼 DB 왕복 + 재파생이 돈다.
   */
  function queueAlwaysOn(item) {
    const actor = item?.parent;
    if (!actor || actor.documentName !== 'Actor') return false;
    if (actor.type !== 'character' && actor.type !== 'enemy') return false;
    if (!isAlwaysOnCandidate(item)) return false;
    if (!isResponsible(actor)) return false;

    let entry = alwaysOnPending.get(actor.id);
    if (!entry) {
      entry = { actor, ids: new Set() };
      alwaysOnPending.set(actor.id, entry);
      Promise.resolve().then(() => flushAlwaysOn(actor.id));
    }
    entry.ids.add(item.id);
    return true;
  }

  async function flushAlwaysOn(actorId) {
    const entry = alwaysOnPending.get(actorId);
    if (!entry) return 0;
    alwaysOnPending.delete(actorId);

    // 큐에 들어간 뒤 삭제/수동 활성된 아이템은 여기서 탈락시킨다.
    const updates = [...entry.ids]
      .map(id => ownedItemById(entry.actor, id))
      .filter(item => isAlwaysOnCandidate(item))
      .map(item => ({ _id: item.id, 'system.active.state': true }));
    if (!updates.length) return 0;
    try {
      await entry.actor.updateEmbeddedDocuments('Item', updates);
      window.DX3rdDebug.log('DX3rd | always-on effects auto-activated:', updates.length, '→', entry.actor.name);
      return updates.length;
    } catch (e) {
      console.error('DX3rd | always-on 자동 활성화 실패:', entry.actor?.name, e);
      return 0;
    }
  }

  /**
   * 이미 꺼진 채로 임포트된 상시 이펙트 일괄 보정.
   * 자동 실행하지 않는다 — GM이 콘솔에서
   * `window.DX3rdAppliedToggle.activateAlwaysOn()`(전체) 또는
   * `window.DX3rdAppliedToggle.activateAlwaysOn(actor)`(단일)로 실행한다.
   */
  async function activateAlwaysOn(actor = null) {
    const actors = actor ? [actor] : Array.from(game.actors || []);
    if (!actor && !game.user?.isGM) {
      ui.notifications?.warn('DX3rd | GM만 상시 이펙트 전체 보정을 실행할 수 있습니다.');
      return { scanned: 0, activated: 0 };
    }
    let scanned = 0;
    let activated = 0;
    for (const a of actors) {
      if (a.type !== 'character' && a.type !== 'enemy') continue;
      const targets = (a.items || []).filter(isAlwaysOnCandidate);
      scanned += targets.length;
      if (!targets.length) continue;
      if (!isResponsible(a)) continue;
      try {
        // 아이템 하나씩 켜면 그 수만큼 재파생·훅이 돈다 → 액터 단위 배치 1회.
        await a.updateEmbeddedDocuments('Item', targets.map(i => ({ _id: i.id, 'system.active.state': true })));
        activated += targets.length;
      } catch (e) {
        console.error('DX3rd | 상시 이펙트 일괄 활성화 실패:', a?.name, e);
        continue;
      }
      await sync(a);
    }
    console.log(`DX3rd | AlwaysOn repair: ${activated}/${scanned} effects activated.`);
    return { scanned, activated };
  }

  /** GM 설정 메뉴용 읽기 전용 전체 검사. */
  function auditAll() {
    const result = { scanned: 0, actors: 0, createOrUpdate: 0, remove: 0, rows: [] };
    for (const actor of game.actors) {
      if (actor.type !== 'character' && actor.type !== 'enemy') continue;
      result.scanned++;
      const { toDelete, toSet } = syncPlan(actor);
      if (!toDelete.length && !toSet.length) continue;
      result.actors++;
      result.createOrUpdate += toSet.length;
      result.remove += toDelete.length;
      result.rows.push({ actor, createOrUpdate: toSet.length, remove: toDelete.length });
    }
    return result;
  }

  // ---------------------------------------------------------------------------
  // 훅 유발 동기화는 짧게 합친다(액터당 1개 타이머).
  //
  // 콤보는 멤버 이펙트를 await 로 하나씩 켜므로, 훅이 즉시 sync 하면 아이템마다 AE 를
  // 1건씩 쓰게 된다(실측: 3멤버 = create ActiveEffect ×3 = 라운드트립 3회 + 재파생 3회).
  // 짧게 미루면 그 쓰기들이 콤보의 명시적 `await sync(actor)`(combo-handler) 한 번으로
  // 모여 setMany 배치 1회가 된다. 명시 호출은 지연 없이 즉시 실행되므로 판정 직전의
  // 보장은 그대로다 — 훅 sync 는 원래부터 fire-and-forget 이라 완료를 기다리는 곳이 없다.
  // ---------------------------------------------------------------------------
  const HOOK_SYNC_DELAY_MS = 50;
  const hookSyncTimers = new Map();

  function requestSync(actor) {
    if (!actor) return;
    const prev = hookSyncTimers.get(actor.id);
    if (prev) clearTimeout(prev);
    hookSyncTimers.set(actor.id, setTimeout(() => {
      hookSyncTimers.delete(actor.id);
      sync(actor);
    }, HOOK_SYNC_DELAY_MS));
  }

  Hooks.on('updateActor', (actor, changed) => {
    // payload 는 actor.system 스탯/스킬/레벨만 참조한다(evaluatedAttrs). system 밖 변경
    // (flags/토큰/이름/이미지/소유권)은 payload 에 영향을 줄 수 없으므로 재평가를 스킵한다
    // — 전투 중 토큰 이동·플래그 갱신 등 핫패스에서 desiredPayloads 전량 재계산 비용 제거.
    // 토글 상태(active.state)는 아이템에 있어 updateItem 훅이 처리하므로 여기서 놓치지 않는다.
    if (!foundry.utils.hasProperty(changed, 'system')) return;
    // 무관 경로(예: attributes.hp)만 바뀐 변경은 재평가해도 전량 no-op → 스킵(전투 HP 핫패스 제거).
    if (!systemChangeAffectsPayload(changed)) return;
    requestSync(actor);
  });
  Hooks.on('updateItem', (item) => {
    const a = item.parent;
    if (isToggleSourceItem(item) && a?.documentName === 'Actor') requestSync(a);
  });
  Hooks.on('createItem', (item) => {
    const a = item.parent;
    if (a?.documentName !== 'Actor') return;
    // 상시 이펙트는 취득만으로 켜져 있어야 한다. 켠 뒤의 AE 반영은 updateItem 훅이 잇는다.
    if (queueAlwaysOn(item)) return;
    if (isToggleSourceItem(item)) requestSync(a);
  });
  Hooks.on('deleteItem', (item) => {
    const a = item.parent;
    if (isToggleSourceItem(item) && a?.documentName === 'Actor') requestSync(a);
  });
  // 월드 준비 중 전체 액터를 순회해 AE를 생성·삭제하지 않는다.
  // 이후 아이템/액터 변경 훅은 필요한 해당 액터만 즉시 동기화한다.
  Hooks.once('ready', () => window.DX3rdDebug.log('DX3rd | AppliedToggle startup sweep skipped; explicit repair is available.'));

  window.DX3rdAppliedToggle = { SCOPE, KEY_PREFIX, TOGGLE_TYPES, sync, syncAll, auditAll, desiredPayloads, isResponsible, activateAlwaysOn, isAlwaysOnCandidate };

  window.DX3rdDebug.log('DX3rd | AppliedToggle sync loaded');
})();
