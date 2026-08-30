// DX3rd Applied → ActiveEffect migration (a standalone migration module)
// ---------------------------------------------------------------------------
// The one-off migration moving applied buffs out of our own data (system.attributes.applied) and into native
// ActiveEffects. It is different in character from the core schema cleanup (migrations.js), so it is managed
// independently through its own version counter (appliedAEMigrationVersion).
//
//  - The actor migration runs automatically once on a GM's load (idempotent: set() upserts by appliedKey).
//  - The backfill that plants display / transplant AE definitions on items and compendia risks writing to the packs,
//    so it does not run automatically and is offered as a manual game.dx3rd.backfillItemEffects(...) call.
// ---------------------------------------------------------------------------
(function () {

  const SETTING = 'appliedAEMigrationVersion';
  const CURRENT = 4; // the number of migration steps this module defines

  Hooks.once('init', function () {
    game.settings.register('dx3rd-emanim', SETTING, {
      scope: 'world',
      config: false,
      type: Number,
      default: 0
    });
  });

  Hooks.once('ready', async function () {
    // Expose the API for the console / macros (registered for GM and player alike; each function checks its own permission)
    game.dx3rd = game.dx3rd || {};
    game.dx3rd.backfillItemEffects = backfillItemEffects;

    // The public macro API — a world macro calling this instead of
    // actor.update({"system.attributes.applied.KEY": {...}}) stores it as a native ActiveEffect, so it shows on the
    // token icon and the effects tab.
    // (A macro writing the old way still computes correctly thanks to the collect() bridge; switch to this API for the AE visuals.)
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
      // (The old v2 backfillShowIconOnAppliedAE was removed: it raised showIcon to ALWAYS, but the move to the
      //  dnd5e style settled on OFF (NEVER) by default and v3 overrides it. A fresh v0 migration already builds
      //  NEVER in buildAEData and v3 is a no-op → v2 was pure churn, so it was deleted.)
      if (version < 3) await cleanupMirrorsAndDefaultOverlayOff();
      if (version < 4) await restoreTokenPreferenceAfterCoreMigration();
      await game.settings.set('dx3rd-emanim', SETTING, CURRENT);
      console.log('DX3rd | applied→AE 이행 완료');
      ui.notifications.info('DX3rd | 적용 효과 이행이 완료되었습니다.');
    } catch (e) {
      console.error('DX3rd | applied→AE 이행 실패:', e);
      ui.notifications.error('DX3rd | 적용 효과 이행 중 오류가 발생했습니다. 콘솔을 확인하세요.');
    }
  });

  /**
   * Convert each actor's system.attributes.applied.<key> into a native ActiveEffect, then remove the legacy field.
   * From then on the calculation is rebuilt by collect() from the AE flags.
   * Documents (actors) are processed one at a time.
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

      // 1) applied → a native ActiveEffect
      for (const [key, payload] of Object.entries(applied)) {
        if (!payload || typeof payload !== 'object') continue;
        try {
          await adapter.set(actor, key, payload);
          migrated++;
        } catch (e) {
          console.error(`DX3rd | applied→AE 변환 실패: ${actor.name} / ${key}`, e);
        }
      }

      // 2) Remove the legacy field (prepareData's default reinitializes it as an empty {})
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
   * v3: reflecting the change of intent (the dnd5e style).
   *  (a) Remove every retired toggle mirror AE (the activeMirror flag) — a pure stat toggle is computed by the item
   *      itself, so it needs no AE shadow (the mirror module was deleted).
   *  (b) Apply the "token overlay OFF by default" policy retroactively: existing appliedKey AEs have showIcon put
   *      back to NEVER (v2 had set it to ALWAYS). From then on it is turned on only by the effects tab's per-effect "show on token" toggle.
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
   * v4: handling the Foundry v14.353+ core migration.
   * Core may change an existing applied AE with synthetic statuses to showIcon ALWAYS, so this restores showIcon
   * alone, according to the stored showOnToken choice, touching no other data.
   * A real status-effect AE has no appliedKey flag and is therefore unaffected.
   */
  async function restoreTokenPreferenceAfterCoreMigration() {
    const SHOW_ICON = CONST.ACTIVE_EFFECT_SHOW_ICON || {};
    const NEVER = SHOW_ICON.NEVER ?? 0;
    const ALWAYS = SHOW_ICON.ALWAYS ?? 2;
    let actorsUpdated = 0, effectsUpdated = 0;

    for (const actor of game.actors) {
      const updates = [];
      for (const eff of actor.effects) {
        if (!eff.getFlag?.('dx3rd-emanim', 'appliedKey')) continue;

        const payload = eff.getFlag('dx3rd-emanim', 'applied') || {};
        const expectedShowIcon = payload.showOnToken === true ? ALWAYS : NEVER;
        if (eff.showIcon === expectedShowIcon) continue;

        updates.push({
          _id: eff.id,
          showIcon: expectedShowIcon
        });
      }

      if (!updates.length) continue;
      try {
        await actor.updateEmbeddedDocuments('ActiveEffect', updates, { render: false });
        actorsUpdated++;
        effectsUpdated += updates.length;
      } catch (e) {
        console.error(`DX3rd | v4 applied 토큰 표시 복구 실패: ${actor.name}`, e);
      }
    }

    console.log(`DX3rd | v4: applied AE 토큰 표시 복구 — 액터 ${actorsUpdated}개 / 효과 ${effectsUpdated}개`);
  }

  /**
   * The manual backfill: plant display / transplant ActiveEffect definitions on effect-like Items themselves, from
   * their system.effect.attributes (so an AE is visible even when only the item is opened).
   *  - transfer:false, so it does not transfer to the actor automatically on equip / ownership (= duplicating the runtime creation).
   *  - Writing to compendium packs is risky, so it is excluded by default. It happens only when includeCompendium=true is stated.
   * Run from the console: game.dx3rd.backfillItemEffects({ includeCompendium: true })
   */
  async function backfillItemEffects({ includeCompendium = false } = {}) {
    if (!game.user.isGM) { ui.notifications?.warn('GM 만 실행할 수 있습니다.'); return; }
    const adapter = window.DX3rdAppliedEffects;
    if (!adapter?.buildChanges) { ui.notifications?.error('DX3rdAppliedEffects 미로드'); return; }
    const FLAG = adapter.SCOPE || 'dx3rd-emanim';

    // Only the effect-like types (the ones that author effect attributes) are targeted
    const EFFECT_TYPES = new Set(['effect', 'combo', 'spell', 'psionic', 'rois', 'protect', 'once', 'connection', 'etc']);

    const buildItemAE = (item) => {
      const attrs = item.system?.effect?.attributes;
      if (!attrs || typeof attrs !== 'object' || !Object.keys(attrs).length) return null;
      const changes = adapter.buildChanges(attrs);
      if (!changes.length) return null;
      return {
        name: item.name,
        img: item.img || 'icons/svg/aura.svg',
        system: { changes }, // v14: the change array lives at system.changes
        transfer: false, // no automatic transfer (the runtime creation handles that)
        disabled: false,
        flags: { [FLAG]: { itemDefinition: true, disable: item.system?.effect?.disable || '-' } }
      };
    };

    // Skipped when a definition AE already exists (idempotent)
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

    // World items
    for (const item of game.items) await processItem(item);
    // Items embedded on actors
    for (const actor of game.actors) for (const item of actor.items) await processItem(item);

    // Compendia (optional): system-owned Item packs only, unlocked → restored
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
