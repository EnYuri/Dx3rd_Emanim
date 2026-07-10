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
// appliedKey 네임스페이스: `toggle:<itemId>`. 콤보 구성 이펙트와 독립 활성 이펙트가 같은
// 아이템이면 같은 key → 자동 dedup(한 이펙트 = 한 AE, 이중가산 0). 콤보 자신의 attributes 는
// 별도 key(toggle:<comboId>).
// ---------------------------------------------------------------------------
(function () {

  const SCOPE = 'dx3rd-emanim';
  const KEY_PREFIX = 'toggle:';
  // 이펙트류(→AE). 나머지(장비/기록/아이템/기타)는 actor.js 자체계산에 남는다.
  const TOGGLE_TYPES = ['effect', 'spell', 'psionic', 'combo'];

  // 재진입 방지는 액터 단위. 전역 플래그로 두면 백필/동시 동기화 때 첫 액터가 잡은 사이
  // 나머지 액터의 sync 가 전부 스킵된다(서로 다른 액터는 간섭하면 안 됨).
  const syncing = new Set();

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
      let value;
      if (typeof a.value === 'boolean') value = a.value;           // 존재 플래그형(move_half 등)
      else value = Number(EV?.evaluate(a.value, item, actor)) || 0; // 수식/숫자 → 동결 숫자
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

  /** 액터의 현재 토글 상태로부터 원하는 { appliedKey: payload } 집합을 만든다(콤보 확장·dedup 포함). */
  function desiredPayloads(actor) {
    const desired = new Map();
    const add = (item) => {
      const key = `${KEY_PREFIX}${item.id}`;
      if (desired.has(key)) return; // dedup: 독립 활성 이펙트 = 콤보 구성 이펙트(같은 아이템)
      desired.set(key, buildPayload(item, actor));
    };
    const toggled = (actor.items || []).filter(i =>
      i.system?.active?.state === true && TOGGLE_TYPES.includes(i.type));
    const getEffectIds = window.DX3rdComboData?.getEffectIds;
    for (const item of toggled) {
      add(item); // 아이템 자신의 attributes(콤보 자신 포함)
      if (item.type === 'combo') {
        const ids = getEffectIds ? getEffectIds(item)
          : (Array.isArray(item.system?.effectIds) ? item.system.effectIds : []);
        for (const eid of ids) {
          if (!eid || eid === '-') continue;
          const eff = actor.items.get(eid);
          if (eff && eff.type === 'effect') add(eff);
        }
      }
    }
    return desired;
  }

  /** 기존 AE 의 payload 와 새 payload 가 실질적으로 다른가(수식 추종 감지). */
  function payloadChanged(eff, payload) {
    const prev = eff.getFlag?.(SCOPE, 'applied') || {};
    if (prev.name !== payload.name || prev.img !== payload.img) return true;
    if ((prev.disable || '-') !== (payload.disable || '-')) return true;
    return JSON.stringify(prev.attributes || {}) !== JSON.stringify(payload.attributes || {});
  }

  /** 액터의 토글 AE 집합을 현재 토글 상태에 맞춰 upsert/remove. */
  async function sync(actor) {
    if (!actor || syncing.has(actor.id)) return;
    if (actor.type !== 'character' && actor.type !== 'enemy') return;
    if (!isResponsible(actor)) return;
    if (!window.DX3rdAppliedEffects?.set) return;

    const desired = desiredPayloads(actor);
    const existing = (actor.effects || []).filter(e =>
      String(e.getFlag?.(SCOPE, 'appliedKey') || '').startsWith(KEY_PREFIX));
    const existingByKey = new Map(existing.map(e => [e.getFlag(SCOPE, 'appliedKey'), e]));

    const toDelete = existing
      .filter(e => !desired.has(e.getFlag(SCOPE, 'appliedKey')))
      .map(e => e.id);
    const toSet = [];
    for (const [key, payload] of desired) {
      const eff = existingByKey.get(key);
      if (!eff || payloadChanged(eff, payload)) toSet.push([key, payload]);
    }

    if (!toDelete.length && !toSet.length) return; // no-op → 훅 캐스케이드 방지

    syncing.add(actor.id);
    try {
      if (toDelete.length) {
        await actor.deleteEmbeddedDocuments('ActiveEffect', toDelete, { render: false });
      }
      for (const [key, payload] of toSet) {
        await window.DX3rdAppliedEffects.set(actor, key, payload);
      }
    } catch (e) {
      console.error('DX3rd | applied-toggle sync 실패:', actor?.name, e);
    } finally {
      syncing.delete(actor.id);
    }
  }

  Hooks.on('updateActor', (actor) => { if (!syncing.has(actor.id)) sync(actor); });
  Hooks.on('updateItem', (item) => { const a = item.parent; if (a?.documentName === 'Actor' && !syncing.has(a.id)) sync(a); });
  Hooks.on('createItem', (item) => { const a = item.parent; if (a?.documentName === 'Actor' && !syncing.has(a.id)) sync(a); });
  Hooks.on('deleteItem', (item) => { const a = item.parent; if (a?.documentName === 'Actor' && !syncing.has(a.id)) sync(a); });
  Hooks.once('ready', () => { for (const a of game.actors) sync(a); });

  window.DX3rdAppliedToggle = { SCOPE, KEY_PREFIX, TOGGLE_TYPES, sync, desiredPayloads, isResponsible };

  console.log('DX3rd | AppliedToggle sync loaded');
})();
