// DX3rd Applied → ActiveEffect 이행 (독립 마이그레이션 모듈)
// ---------------------------------------------------------------------------
// applied 버프의 저장소를 자체 데이터(system.attributes.applied)에서 네이티브
// ActiveEffect 로 옮기는 1회성 이행. 코어 스키마 정리(migrations.js)와 성격이 달라
// 별도 버전 카운터(appliedAEMigrationVersion)로 독립 관리한다.
//
//  - 액터 이행은 GM 로드 시 자동 1회 실행(멱등: set()이 appliedKey 로 upsert).
//  - 아이템/컴펜디움에 표시·이식용 AE 정의를 심는 백필은 팩 쓰기 위험이 있어
//    자동 실행하지 않고 game.dx3rd.backfillItemEffects(...) 수동 호출로 제공한다.
// ---------------------------------------------------------------------------
(function () {

  const SETTING = 'appliedAEMigrationVersion';
  const CURRENT = 3; // 이 모듈이 정의한 이행 단계 수

  Hooks.once('init', function () {
    game.settings.register('dx3rd-emanim', SETTING, {
      scope: 'world',
      config: false,
      type: Number,
      default: 0
    });
  });

  Hooks.once('ready', async function () {
    // 콘솔/매크로용 API 노출 (GM/플레이어 무관하게 등록, 실제 실행 권한은 각 함수가 검사)
    game.dx3rd = game.dx3rd || {};
    game.dx3rd.backfillItemEffects = backfillItemEffects;

    // 공개 매크로 API — 월드 매크로가 actor.update({"system.attributes.applied.KEY": {...}})
    // 대신 이 함수를 호출하면 네이티브 ActiveEffect 로 저장되어 토큰 아이콘/효과 탭에 뜬다.
    // (기존 방식으로 직접 쓰는 매크로도 collect() 브리지 덕에 수치는 계속 정상 동작하지만,
    //  AE 시각화를 원하면 매크로를 이 API 로 바꾸면 된다.)
    //   game.dx3rd.applyEffect(actor, "KEY", { name, img, disable, attributes:{ ... } })
    //   game.dx3rd.removeEffect(actor, "KEY")
    game.dx3rd.applyEffect = (actor, key, payload) =>
      window.DX3rdAppliedEffects?.set(actor, key, payload);
    game.dx3rd.removeEffect = (actor, key) =>
      window.DX3rdAppliedEffects?.remove(actor, key);
    game.dx3rd.collectEffects = (actor) =>
      window.DX3rdAppliedEffects?.collect(actor);

    if (!game.user.isGM) return;

    const version = game.settings.get('dx3rd-emanim', SETTING);
    if (version >= CURRENT) return;

    console.log(`DX3rd | applied→AE 이행 시작 (v${version} → v${CURRENT})`);
    ui.notifications.info('DX3rd | 적용 효과를 ActiveEffect 로 이행합니다...');

    try {
      if (version < 1) await migrateActorsAppliedToAE();
      if (version < 2) await backfillShowIconOnAppliedAE();
      if (version < 3) await cleanupMirrorsAndDefaultOverlayOff();
      await game.settings.set('dx3rd-emanim', SETTING, CURRENT);
      console.log('DX3rd | applied→AE 이행 완료');
      ui.notifications.info('DX3rd | 적용 효과 이행이 완료되었습니다.');
    } catch (e) {
      console.error('DX3rd | applied→AE 이행 실패:', e);
      ui.notifications.error('DX3rd | 적용 효과 이행 중 오류가 발생했습니다. 콘솔을 확인하세요.');
    }
  });

  /**
   * 각 액터의 system.attributes.applied.<key> 를 네이티브 ActiveEffect 로 변환한 뒤
   * 레거시 필드를 제거한다. 이후 계산은 collect()가 AE flag 에서 재구성한다.
   * 문서(액터)를 하나씩 개별 처리한다.
   */
  async function migrateActorsAppliedToAE() {
    const adapter = window.DX3rdAppliedEffects;
    if (!adapter?.set) {
      console.warn('DX3rd | applied→AE 이행 건너뜀: DX3rdAppliedEffects 미로드');
      return;
    }
    const ForcedDeletion = foundry.data?.operators?.ForcedDeletion;
    let migrated = 0, actorsCleaned = 0;

    for (const actor of game.actors) {
      if (actor.type !== 'character' && actor.type !== 'enemy') continue;
      const applied = actor.system?.attributes?.applied;
      if (!applied || typeof applied !== 'object' || !Object.keys(applied).length) continue;

      // 1) applied → 네이티브 ActiveEffect
      for (const [key, payload] of Object.entries(applied)) {
        if (!payload || typeof payload !== 'object') continue;
        try {
          await adapter.set(actor, key, payload);
          migrated++;
        } catch (e) {
          console.error(`DX3rd | applied→AE 변환 실패: ${actor.name} / ${key}`, e);
        }
      }

      // 2) 레거시 필드 제거 (prepareData 기본값이 빈 {} 로 재초기화)
      try {
        if (ForcedDeletion) {
          await actor.update({ system: { attributes: { applied: new ForcedDeletion() } } }, { render: false });
        } else {
          await actor.update({ 'system.attributes.-=applied': null }, { diff: false, render: false });
        }
        actorsCleaned++;
      } catch (e) {
        console.error(`DX3rd | 레거시 applied 필드 제거 실패: ${actor.name}`, e);
      }
    }

    console.log(`DX3rd | applied 이행: ${migrated}개 버프를 AE 로 변환, ${actorsCleaned}개 액터 정리`);
  }

  /**
   * v1 이행 시점에 생성된 applied AE 는 showIcon 이 기본값(CONDITIONAL)이라
   * v14 Token#_drawEffects 필터(showIcon===ALWAYS || (CONDITIONAL && isTemporary))에서
   * 제외되어 토큰 아이콘이 그려지지 않는다. 지속시간 기반이 아닌 applied 버프는 ALWAYS 여야
   * 하므로, appliedKey 플래그를 가진 기존 AE 의 showIcon 을 ALWAYS 로 backfill 한다.
   * (신규 생성은 buildAEData 가 이미 ALWAYS 로 지정하므로 이 단계는 구 문서 정리 전용.)
   */
  async function backfillShowIconOnAppliedAE() {
    const ALWAYS = CONST.ACTIVE_EFFECT_SHOW_ICON?.ALWAYS ?? 2;
    let fixed = 0;

    for (const actor of game.actors) {
      const updates = [];
      for (const eff of actor.effects) {
        if (!eff.getFlag?.('dx3rd-emanim', 'appliedKey')) continue;
        if (eff.showIcon === ALWAYS) continue;
        updates.push({ _id: eff.id, showIcon: ALWAYS });
      }
      if (!updates.length) continue;
      try {
        await actor.updateEmbeddedDocuments('ActiveEffect', updates, { render: false });
        fixed += updates.length;
      } catch (e) {
        console.error(`DX3rd | showIcon backfill 실패: ${actor.name}`, e);
      }
    }

    console.log(`DX3rd | applied AE showIcon backfill: ${fixed}개 문서 갱신`);
  }

  /**
   * v3: 의도 전환(dnd5e 방식) 반영.
   *  (a) 폐기된 토글 미러 AE(flag activeMirror) 를 전부 제거 — 순수 스텟 토글은 아이템 자체계산이라
   *      AE 그림자가 필요없다(미러 모듈 삭제됨).
   *  (b) 토큰 오버레이 기본 OFF 정책 소급: 기존 appliedKey AE 의 showIcon 을 NEVER 로 되돌린다
   *      (v2 에서 ALWAYS 로 세웠던 것). 이후에는 효과 탭 편집의 per-effect "토큰 표시" 토글로만 켠다.
   */
  async function cleanupMirrorsAndDefaultOverlayOff() {
    const NEVER = CONST.ACTIVE_EFFECT_SHOW_ICON?.NEVER ?? 0;
    let removedMirrors = 0, overlayOff = 0;

    for (const actor of game.actors) {
      const mirrorIds = [];
      const iconUpdates = [];
      for (const eff of actor.effects) {
        if (eff.getFlag?.('dx3rd-emanim', 'activeMirror')) { mirrorIds.push(eff.id); continue; }
        if (eff.getFlag?.('dx3rd-emanim', 'appliedKey') && eff.showIcon !== NEVER) {
          iconUpdates.push({ _id: eff.id, showIcon: NEVER });
        }
      }
      try {
        if (mirrorIds.length) {
          await actor.deleteEmbeddedDocuments('ActiveEffect', mirrorIds, { render: false });
          removedMirrors += mirrorIds.length;
        }
        if (iconUpdates.length) {
          await actor.updateEmbeddedDocuments('ActiveEffect', iconUpdates, { render: false });
          overlayOff += iconUpdates.length;
        }
      } catch (e) {
        console.error(`DX3rd | v3 미러 정리/오버레이 OFF 실패: ${actor.name}`, e);
      }
    }

    console.log(`DX3rd | v3: 미러 AE ${removedMirrors}개 제거, applied AE ${overlayOff}개 오버레이 OFF`);
  }

  /**
   * 수동 백필: 이펙트류 Item 의 system.effect.attributes 로부터 아이템 자신에게
   * 표시/이식용 ActiveEffect 정의를 심는다(아이템만 열어도 AE 가 보이도록).
   *  - transfer:false 로 두어 착용/소유 시 액터에 자동 전이(=런타임 생성과 중복)되지 않게 한다.
   *  - 컴펜디움 팩 쓰기는 위험이 있어 기본 제외. includeCompendium=true 로 명시할 때만 수행.
   * 콘솔에서 실행: game.dx3rd.backfillItemEffects({ includeCompendium: true })
   */
  async function backfillItemEffects({ includeCompendium = false } = {}) {
    if (!game.user.isGM) { ui.notifications?.warn('GM 만 실행할 수 있습니다.'); return; }
    const adapter = window.DX3rdAppliedEffects;
    if (!adapter?.buildChanges) { ui.notifications?.error('DX3rdAppliedEffects 미로드'); return; }
    const FLAG = adapter.SCOPE || 'dx3rd-emanim';

    // 이펙트류(효과 attributes 를 authoring 하는) 타입만 대상
    const EFFECT_TYPES = new Set(['effect', 'combo', 'spell', 'psionic', 'rois', 'protect', 'once', 'connection', 'etc']);

    const buildItemAE = (item) => {
      const attrs = item.system?.effect?.attributes;
      if (!attrs || typeof attrs !== 'object' || !Object.keys(attrs).length) return null;
      const changes = adapter.buildChanges(attrs);
      if (!changes.length) return null;
      return {
        name: item.name,
        img: item.img || 'icons/svg/aura.svg',
        system: { changes }, // v14: change 배열은 system.changes 에 위치
        transfer: false, // 자동 전이 금지(런타임 생성이 담당)
        disabled: false,
        flags: { [FLAG]: { itemDefinition: true, disable: item.system?.effect?.disable || '-' } }
      };
    };

    // 이미 정의 AE 가 있으면 건너뜀(멱등)
    const hasDef = (item) => item.effects?.some(e => e.getFlag?.(FLAG, 'itemDefinition'));

    let created = 0;
    const processItem = async (item) => {
      if (!EFFECT_TYPES.has(item.type)) return;
      if (hasDef(item)) return;
      const data = buildItemAE(item);
      if (!data) return;
      try {
        await item.createEmbeddedDocuments('ActiveEffect', [data]);
        created++;
      } catch (e) {
        console.error(`DX3rd | 아이템 AE 백필 실패: ${item.name}`, e);
      }
    };

    // 월드 아이템
    for (const item of game.items) await processItem(item);
    // 액터 임베드 아이템
    for (const actor of game.actors) for (const item of actor.items) await processItem(item);

    // 컴펜디움(옵션): 시스템 소유 Item 팩만, 잠금 해제→복원
    if (includeCompendium) {
      for (const pack of game.packs) {
        if (pack.metadata?.type !== 'Item') continue;
        if (pack.metadata?.system && pack.metadata.system !== 'dx3rd-emanim') continue;
        const wasLocked = pack.locked;
        try {
          if (wasLocked) await pack.configure({ locked: false });
          const docs = await pack.getDocuments();
          for (const item of docs) await processItem(item);
        } catch (e) {
          console.error(`DX3rd | 컴펜디움 백필 실패: ${pack.collection}`, e);
        } finally {
          if (wasLocked) { try { await pack.configure({ locked: true }); } catch (_) {} }
        }
      }
    }

    console.log(`DX3rd | 아이템 AE 백필 완료: ${created}개 생성 (컴펜디움 포함: ${includeCompendium})`);
    ui.notifications?.info(`DX3rd | 아이템 AE 백필: ${created}개 생성`);
    return created;
  }

  console.log('DX3rd | AppliedAE migration module loaded');
})();
