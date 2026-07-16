/**
 * Double Cross 3rd actor-owned delete confirmation helpers.
 *
 * Actor sheet implementations share these helpers while inline confirmation
 * blocks are moved out of the sheet classes.
 */
(function() {
  const DialogV2 = foundry.applications?.api?.DialogV2;

  function localize(key) {
    return game.i18n.localize(key);
  }

  async function confirmDelete({title, content}) {
    if (!DialogV2?.confirm) {
      ui.notifications.error(localize('DX3rd.DialogV2Unavailable'));
      return false;
    }

    return DialogV2.confirm({
      window: {title},
      content: `<p>${content}</p>`,
      yes: {
        icon: '<i class="fas fa-trash"></i>',
        label: localize('DX3rd.Delete')
      },
      no: {
        icon: '<i class="fas fa-times"></i>',
        label: localize('DX3rd.Cancel')
      },
      defaultYes: false
    });
  }

  async function deleteItem(actor, itemIdOrItem) {
    if (!actor?.isOwner && !game.user?.isGM) {
      ui.notifications.warn(localize('DX3rd.NoPermission'));
      return false;
    }

    const item = typeof itemIdOrItem === 'string'
      ? actor.items.get(itemIdOrItem)
      : itemIdOrItem;
    if (!item) return false;

    const confirmed = await confirmDelete({
      title: localize('DX3rd.DeleteItem'),
      content: game.i18n.format('DX3rd.ConfirmDeleteItem', {name: item.name})
    });
    if (!confirmed) return false;

    await actor.deleteEmbeddedDocuments('Item', [item.id]);
    // deleteItem 훅은 다른 클라이언트/훅 순서에 따라 원본 문서의 parent를 잃을 수 있다.
    // 효과 탭의 휴지통은 원본 이펙트 삭제 후에도 출처 AE가 남지 않도록 여기서 직접 정리한다.
    await window.DX3rdAppliedEffects?.removeByItem?.(actor, item.id);
    return true;
  }

  async function deleteSkill(actor, skillId) {
    if (!actor?.isOwner && !game.user?.isGM) {
      ui.notifications.warn(localize('DX3rd.NoPermission'));
      return false;
    }

    const skill = actor?.system?.attributes?.skills?.[skillId];
    if (!skill) return false;

    if (!skill.delete) {
      ui.notifications.error(localize('DX3rd.ErrorCannotDeleteDefaultSkill'));
      return false;
    }

    const confirmed = await confirmDelete({
      title: localize('DX3rd.DeleteSkill'),
      content: game.i18n.format('DX3rd.ConfirmDeleteSkill', {name: skill.name || skillId})
    });
    if (!confirmed) return false;

    if (skillId === 'cthulhu') {
      await actor.setFlag('dx3rd-emanim', 'cthulhuDeleted', true);
    }

    await actor.update({
      [`system.attributes.skills.-=${skillId}`]: null
    });
    return true;
  }

  function resolveItem(actor, itemIdOrItem) {
    return typeof itemIdOrItem === 'string'
      ? actor?.items?.get(itemIdOrItem)
      : itemIdOrItem;
  }

  function canEditActor(actor) {
    if (actor?.isOwner || game.user?.isGM) return true;
    ui.notifications.warn(localize('DX3rd.NoPermission'));
    return false;
  }

  async function confirmResetRois(item) {
    if (!DialogV2?.confirm) {
      ui.notifications.error(localize('DX3rd.DialogV2Unavailable'));
      return false;
    }

    return DialogV2.confirm({
      window: {title: localize('DX3rd.ResetRois')},
      content: `<p>${game.i18n.format('DX3rd.ConfirmResetRois', {name: item.name})}</p>`,
      yes: {
        icon: '<i class="fas fa-undo"></i>',
        label: localize('DX3rd.Reset')
      },
      no: {
        icon: '<i class="fas fa-times"></i>',
        label: localize('DX3rd.Cancel')
      },
      defaultYes: false
    });
  }

  async function resetSublimation(item) {
    const confirmed = await confirmResetRois(item);
    if (!confirmed) return false;

    await item.update({
      'system.titus': false,
      'system.sublimation': false
    });
    ui.notifications.info(localize('DX3rd.RoisReset'));
    return true;
  }

  async function useSublimation(actor, itemIdOrItem) {
    if (!canEditActor(actor)) return false;

    const item = resolveItem(actor, itemIdOrItem);
    if (!item) return false;

    if (item.system?.sublimation) {
      return resetSublimation(item);
    }

    if (!window.DX3rdRoisHandler?.handleSublimation) {
      ui.notifications.error(localize('DX3rd.RoisHandlerMissing'));
      return false;
    }

    await window.DX3rdRoisHandler.handleSublimation(actor.id, item.id);
    return true;
  }

  window.DX3rdActorDeleteDialogs = {
    confirmDelete,
    deleteItem,
    deleteSkill
  };

  window.DX3rdActorRoisDialogs = {
    confirmReset: confirmResetRois,
    resetSublimation,
    useSublimation
  };
})();
