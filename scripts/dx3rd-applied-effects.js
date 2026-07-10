// DX3rd Applied Effects 어댑터
// ---------------------------------------------------------------------------
// 적용 효과(applied 버프)의 저장소를 네이티브 ActiveEffect 문서로 이행하기 위한 파사드.
// 모든 applied 쓰기/읽기/제거가 이 한 곳을 통과한다.
//
// 설계 원칙(방식 A):
//  - source of truth = 액터에 임베드된 ActiveEffect 문서 1개(= applied 버프 1개).
//  - DX3rd 계산의 무손실 원본은 flags["dx3rd-emanim"].applied 에 payload 그대로 보존.
//    → prepareData(actor.js)는 collect()가 재구성한 레거시 { [key]: payload } 맵을
//       기존 _indexAppliedEffects 로 그대로 소비한다(계산 로직 불변, 단일 경로).
//  - changes[] 는 전부 mode: CUSTOM 으로 생성한다. applyActiveEffect 훅 핸들러를
//    등록하지 않으면 코어는 CUSTOM change 에 대해 액터 데이터를 전혀 수정하지 않는다
//    → 이중 적용(코어 자동적용 + flag 계산) 위험을 원천 차단.
//    동시에 changes 배열(v14: system.changes)은 문서에 남아 외부 자동화 모듈이 읽을 수 있다(가시성 전용).
//  - 토큰 오버레이: showIcon=ALWAYS 로 두어 코어(Token#_drawEffects)가 img 를 항상 토큰에 렌더.
// ---------------------------------------------------------------------------
(function () {

  const SCOPE = 'dx3rd-emanim';
  const SYNTH_STATUS = 'dx3rd-applied'; // appliedKey 별 고유 합성 status(actor.statuses 노출, 아이콘 병합 방지)

  // v14 change 규격: 숫자 mode 는 폐기(CONST.ACTIVE_EFFECT_MODES 접근 시 deprecation 경고),
  // 문자열 type 로 대체된다(EffectChangeData#type, 검증: /^[a-z0-9]+$/ 또는 custom.{n}).
  // 'custom' 은 코어에 applyActiveEffect 핸들러가 없으면 액터 데이터를 건드리지 않아
  // 이중 적용(코어 자동적용 + flag 계산) 위험이 없다. 계산은 flag 단일 경로, changes 는 가시성 전용.
  const CHANGE_TYPE_CUSTOM = 'custom';

  // 판정 전용이 아닌, 문서 경로가 존재하는 key → 외부 모듈 가독성을 위한 change.key 매핑.
  // (mode 는 CUSTOM 이라 실제로 쓰이지는 않으며, change.key 표기를 사람이/모듈이 읽기 좋게 할 뿐)
  const READABLE_PATH = {
    hp: 'system.attributes.hp.max',
    hp_max: 'system.attributes.hp.max',
    armor: 'system.attributes.armor.value',
    guard: 'system.attributes.guard.value',
    init: 'system.attributes.init.value',
    initiative: 'system.attributes.init.value',
    move: 'system.attributes.move.battle',
    move_battle: 'system.attributes.move.battle',
    battleMove: 'system.attributes.move.battle',
    move_full: 'system.attributes.move.full',
    fullMove: 'system.attributes.move.full',
    saving_max: 'system.attributes.saving.max',
    stock_point: 'system.attributes.stock.value',
    attack: 'system.attributes.attack.value',
    damage_roll: 'system.attributes.damage_roll.value'
  };

  const ACTIVE_EFFECT_CLS = () =>
    foundry.documents?.ActiveEffect ?? globalThis.ActiveEffect;

  /** attributes( 객체형 {key,label,value} 또는 원시형 {dice:-5} 혼용 )로부터 changes[] 생성. */
  function buildChanges(attributes = {}) {
    const changes = [];
    for (const [attrName, attrValue] of Object.entries(attributes || {})) {
      const isObj = (typeof attrValue === 'object' && attrValue !== null);
      const key = isObj ? attrValue.key : attrName;
      const label = isObj ? attrValue.label : null;
      const val = (isObj && 'value' in attrValue) ? attrValue.value : attrValue;
      if (key === undefined || key === null || key === '-') continue;

      // 사람이 읽기 좋은 change.key (문서 경로가 있으면 그것, 없으면 dx3rd 네임스페이스)
      const readable = READABLE_PATH[key]
        || (label ? `flags.${SCOPE}.applied.${key}.${label}` : `flags.${SCOPE}.applied.${key}`);

      changes.push({
        key: readable,
        type: CHANGE_TYPE_CUSTOM, // 코어 미적용(핸들러 미등록), 가시성 전용
        value: String(val ?? ''),
        priority: 20
      });
    }
    return changes;
  }

  /** payload 정규화(누락 필드 방어). */
  function normalizePayload(payload = {}) {
    return {
      itemId: payload.itemId ?? null,
      name: payload.name || game.i18n.localize('DX3rd.Applied'),
      img: payload.img || 'icons/svg/aura.svg',
      source: payload.source || '',
      timestamp: payload.timestamp ?? Date.now(),
      disable: payload.disable || '-',
      description: payload.description || '',
      // 오버레이 표시는 토큰/스크린을 구별한다(효과 탭 편집에서 per-effect 토글).
      //  - showOnToken: 토큰 위 아이콘. 기본 OFF(showIcon 으로 반영).
      //  - showOnScreen: 게임 스크린 우상단 HUD. 기본 ON.
      showOnToken: payload.showOnToken ?? false,
      showOnScreen: payload.showOnScreen ?? true,
      attributes: payload.attributes || {}
    };
  }

  /** ActiveEffect 생성 데이터 조립. */
  function buildAEData(actor, appliedKey, payload) {
    const p = normalizePayload(payload);
    return {
      name: p.name,
      img: p.img,
      description: p.description,
      disabled: false,
      // v14 토큰 아이콘 렌더 판정은 isTemporary 가 아니라 effect.showIcon 이다
      // (Token#_drawEffects → appliedEffects.filter: showIcon===ALWAYS 이거나
      //  showIcon===CONDITIONAL && isTemporary). applied 버프는 지속시간 기반이 아니므로
      //  CONDITIONAL 이면 안 그려진다. → 오버레이 표시는 per-effect 선택(기본 OFF):
      //  showOnToken 이면 ALWAYS(토큰에 아이콘), 아니면 NEVER(효과 탭에는 여전히 표시).
      //  img 는 effect.img 에서 오므로 CONFIG.statusEffects 등록 불필요.(검증: v14.364 실측)
      showIcon: p.showOnToken
        ? (CONST.ACTIVE_EFFECT_SHOW_ICON?.ALWAYS ?? 2)
        : (CONST.ACTIVE_EFFECT_SHOW_ICON?.NEVER ?? 0),
      // appliedKey 별 고유 합성 status → 아이콘 병합 방지 + actor.statuses 노출(가시성 전용).
      statuses: [`${SYNTH_STATUS}-${appliedKey}`],
      origin: p.itemId ? `${actor.uuid}.Item.${p.itemId}` : actor.uuid,
      // v14: change 배열은 top-level 이 아니라 system.changes 에 위치(base AE 데이터모델).
      // effect.changes getter 는 system.changes 를 반환하므로 외부 모듈 가독성 유지.
      system: { changes: buildChanges(p.attributes) },
      flags: {
        [SCOPE]: {
          appliedKey,     // upsert 매칭 및 collect 재구성 키
          applied: p       // 계산 무손실 원본
        }
      }
    };
  }

  /** 지정 key 의 applied ActiveEffect 문서를 찾는다. */
  function getEffect(actor, appliedKey) {
    if (!actor) return null;
    return actor.effects.find(e => e.getFlag?.(SCOPE, 'appliedKey') === appliedKey) || null;
  }

  /** applied 버프를 생성/갱신(upsert). */
  async function set(actor, appliedKey, payload) {
    if (!actor || !appliedKey) return null;
    const data = buildAEData(actor, appliedKey, payload);
    const existing = getEffect(actor, appliedKey);
    try {
      if (existing) {
        // flags 는 문서 업데이트 시 딥 머지된다. 편집으로 제거된 attribute 키(예: a0)가
        // 잔존해 이중 적용되지 않도록, 새 payload 에 없는 기존 키는 명시적으로 삭제한다.
        const prevAttrs = existing.getFlag(SCOPE, 'applied')?.attributes || {};
        const nextAttrs = data.flags[SCOPE].applied.attributes || {};
        const attrDeletions = {};
        for (const k of Object.keys(prevAttrs)) {
          if (!(k in nextAttrs)) attrDeletions[`flags.${SCOPE}.applied.attributes.-=${k}`] = null;
        }
        await existing.update({
          name: data.name,
          img: data.img,
          description: data.description,
          disabled: false,
          showIcon: data.showIcon,
          statuses: data.statuses,
          'system.changes': data.system.changes,
          [`flags.${SCOPE}.applied`]: data.flags[SCOPE].applied,
          ...attrDeletions
        });
        return existing;
      }
      const [created] = await actor.createEmbeddedDocuments('ActiveEffect', [data]);
      return created;
    } catch (e) {
      console.error('DX3rd | DX3rdAppliedEffects.set 실패:', appliedKey, e);
      return null;
    }
  }

  /** 지정 key 의 applied 버프 제거. */
  async function remove(actor, appliedKey) {
    const eff = getEffect(actor, appliedKey);
    if (!eff) return false;
    try {
      await eff.delete();
      return true;
    } catch (e) {
      console.error('DX3rd | DX3rdAppliedEffects.remove 실패:', appliedKey, e);
      return false;
    }
  }

  /** 여러 key 를 한 번에 제거(배치). */
  async function removeMany(actor, appliedKeys = []) {
    if (!actor || !appliedKeys.length) return 0;
    const ids = [];
    for (const k of appliedKeys) {
      const eff = getEffect(actor, k);
      if (eff) ids.push(eff.id);
    }
    if (!ids.length) return 0;
    try {
      await actor.deleteEmbeddedDocuments('ActiveEffect', ids);
      return ids.length;
    } catch (e) {
      console.error('DX3rd | DX3rdAppliedEffects.removeMany 실패:', e);
      return 0;
    }
  }

  /** 특정 아이템에서 유래한 applied 버프 전부 제거. */
  async function removeByItem(actor, itemId) {
    if (!actor || !itemId) return 0;
    const ids = actor.effects
      .filter(e => e.getFlag?.(SCOPE, 'applied')?.itemId === itemId)
      .map(e => e.id);
    if (!ids.length) return 0;
    try {
      await actor.deleteEmbeddedDocuments('ActiveEffect', ids);
      return ids.length;
    } catch (e) {
      console.error('DX3rd | DX3rdAppliedEffects.removeByItem 실패:', itemId, e);
      return 0;
    }
  }

  /**
   * 액터의 applied ActiveEffect 들을 레거시 { [appliedKey]: payload } 맵으로 재구성.
   * prepareData / 시트 / disable-hooks 가 기존과 동일한 형태로 소비한다.
   * 전환 브리지: 아직 AE 로 이행되지 않은 레거시 system.attributes.applied 가 있으면 병합(AE 우선).
   */
  function collect(actor) {
    const out = {};
    if (!actor) return out;
    for (const e of actor.effects) {
      const key = e.getFlag?.(SCOPE, 'appliedKey');
      if (!key) continue;
      const payload = e.getFlag?.(SCOPE, 'applied');
      if (payload) out[key] = payload;
    }
    const legacy = actor.system?.attributes?.applied;
    if (legacy && typeof legacy === 'object') {
      for (const [k, v] of Object.entries(legacy)) {
        if (!(k in out) && v && typeof v === 'object') out[k] = v;
      }
    }
    return out;
  }

  window.DX3rdAppliedEffects = {
    SCOPE,
    SYNTH_STATUS,
    buildChanges,
    buildAEData,
    getEffect,
    set,
    remove,
    removeMany,
    removeByItem,
    collect
  };

  console.log('DX3rd | AppliedEffects adapter loaded');
})();
