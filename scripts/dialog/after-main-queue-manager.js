// GM-facing AfterMain failure and retry console.
(function() {
  const api = foundry.applications?.api;
  const compat = window.DX3rdApplicationCompat;
  if (!api?.ApplicationV2 || !api?.HandlebarsApplicationMixin || !compat) {
    console.warn('DX3rd | AfterMain queue manager requires ApplicationV2.');
    return;
  }
  const BaseApplication = api.HandlebarsApplicationMixin(api.ApplicationV2);

  class DX3rdAfterMainQueueManager extends BaseApplication {
    static DEFAULT_OPTIONS = {
      id: 'dx3rd-after-main-queue-manager',
      classes: ['dx3rd-emanim', 'dialog', 'after-main-queue-manager'],
      window: {
        title: 'DX3rd.AfterMainManagerTitle',
        resizable: true
      },
      position: {
        width: 720,
        height: 560
      }
    };

    static PARTS = {
      main: {
        template: 'systems/dx3rd-emanim/templates/dialog/after-main-queue-manager.html',
        root: true
      }
    };

    async _prepareContext(options) {
      const context = await super._prepareContext(options);
      const handler = window.DX3rdUniversalHandler;
      const queue = handler?.getAfterMainQueue?.() || [];
      const entries = [];
      for (const entry of queue) {
        const actor = entry.actorUuid ? await fromUuid(entry.actorUuid).catch(() => null) : game.actors.get(entry.actorId);
        const item = entry.itemUuid ? await fromUuid(entry.itemUuid).catch(() => null) : actor?.items?.get(entry.itemId);
        entries.push({
          ...entry,
          actorName: actor?.name || entry.actorId || game.i18n.localize('DX3rd.AfterMainMissingDocument'),
          actorUuid: actor?.uuid || entry.actorUuid || null,
          itemName: item?.name || entry.data?.triggerItemName || entry.itemId || '-',
          itemUuid: item?.uuid || entry.itemUuid || null,
          typeLabel: game.i18n.localize(`DX3rd.AfterMainType.${entry.type}`),
          statusLabel: game.i18n.localize(entry.blocked ? 'DX3rd.AfterMainBlocked' : 'DX3rd.AfterMainPending'),
          createdLabel: entry.createdAt ? new Date(entry.createdAt).toLocaleString('ko-KR') : '-',
          failedLabel: entry.failedAt ? new Date(entry.failedAt).toLocaleString('ko-KR') : null,
          targetLabel: entry.data?.target || '-',
          canRetry: Boolean(entry.blocked)
        });
      }
      context.entries = entries;
      context.total = entries.length;
      context.blocked = entries.filter(entry => entry.blocked).length;
      context.pending = entries.length - context.blocked;
      context.hasEntries = entries.length > 0;
      context.isResponsibleGM = Boolean(handler && window.DX3rdSocketRouter?.isResponsibleGM?.());
      return context;
    }

    async _onRender(context, options) {
      await super._onRender(context, options);
      const root = this.element;
      if (!root) return;
      this._actionCleanup?.();
      this._actionCleanup = compat.on(root, 'click', '[data-action]', (event, button) => {
        const action = button.dataset.action;
        if (action === 'refresh') return this.render({force: true});
        if (action === 'clear') return this._clearQueue(event);
        if (action === 'retry') return this._retryEntry(event, button);
        if (action === 'remove') return this._removeEntry(event, button);
        if (action === 'open-document') return this._openDocument(event, button);
      });
    }

    async _retryEntry(event, button) {
      event.preventDefault();
      const queueId = button?.dataset.queueId;
      if (!queueId) return;
      const confirmed = await api.DialogV2.confirm({
        window: {title: game.i18n.localize('DX3rd.AfterMainRetryTitle')},
        content: `<p>${game.i18n.localize('DX3rd.AfterMainRetryWarning')}</p>`,
        yes: {label: game.i18n.localize('DX3rd.Confirm')},
        no: {label: game.i18n.localize('DX3rd.Cancel')},
        modal: true
      });
      if (!confirmed) return;
      const result = await window.DX3rdUniversalHandler.processAfterMainQueueEntry(queueId);
      if (result.processed) ui.notifications.info(game.i18n.localize('DX3rd.AfterMainRetryComplete'));
      else ui.notifications.error(result.error || game.i18n.localize('DX3rd.AfterMainRetryFailed'));
      await this.render({force: true});
    }

    async _removeEntry(event, button) {
      event.preventDefault();
      const queueId = button?.dataset.queueId;
      if (!queueId) return;
      const confirmed = await api.DialogV2.confirm({
        window: {title: game.i18n.localize('DX3rd.AfterMainRemoveTitle')},
        content: `<p>${game.i18n.localize('DX3rd.AfterMainRemoveWarning')}</p>`,
        yes: {label: game.i18n.localize('DX3rd.Confirm')},
        no: {label: game.i18n.localize('DX3rd.Cancel')},
        modal: true
      });
      if (!confirmed) return;
      await window.DX3rdUniversalHandler.removeAfterMainQueueEntry(queueId);
      await this.render({force: true});
    }

    async _clearQueue(event) {
      event.preventDefault();
      const confirmed = await api.DialogV2.confirm({
        window: {title: game.i18n.localize('DX3rd.AfterMainClearTitle')},
        content: `<p>${game.i18n.localize('DX3rd.AfterMainClearWarning')}</p>`,
        yes: {label: game.i18n.localize('DX3rd.Confirm')},
        no: {label: game.i18n.localize('DX3rd.Cancel')},
        modal: true
      });
      if (!confirmed) return;
      await window.DX3rdUniversalHandler.clearAfterMainQueue();
      await this.render({force: true});
    }

    async _openDocument(event, button) {
      event.preventDefault();
      const uuid = button?.dataset.uuid;
      if (!uuid) return;
      const document = await fromUuid(uuid).catch(() => null);
      if (!document?.sheet) {
        ui.notifications.warn(game.i18n.localize('DX3rd.AfterMainMissingDocument'));
        return;
      }
      document.sheet.render(true);
    }
  }

  Hooks.once('init', () => {
    game.settings.registerMenu('dx3rd-emanim', 'afterMainQueueManager', {
      name: 'DX3rd.AfterMainManagerName',
      label: 'DX3rd.AfterMainManagerLabel',
      hint: 'DX3rd.AfterMainManagerHint',
      icon: 'fas fa-wave-square',
      type: DX3rdAfterMainQueueManager,
      restricted: true
    });
  });

  window.DX3rdAfterMainQueueManager = DX3rdAfterMainQueueManager;
})();
