/* global foundry, window, document */

/**
 * DX3rd-Overlay-Dialog
 *
 * A lightweight DOM overlay used in place of DialogV2 for simple choice UIs.
 * No dragging, no resizing, fixed width (320px by default).
 *
 * Ported from the upstream dx3rd-fvtt system (scripts/apps/dx3rd-overlay-dialog.js).
 * Differences from upstream: escaping delegates to DX3rdRuntimeUtils instead of
 * carrying its own copy, and a throwing button callback is reported rather than
 * swallowed silently.
 */
(function () {
  const SYSTEM_ID = 'dx3rd-emanim';

  /**
   * Sentinel a button callback returns to keep the dialog open instead of resolving.
   * @type {symbol}
   */
  const NO_CLOSE = Symbol('DX3rdOverlayDialog.NO_CLOSE');

  /**
   * Dismiss callbacks of the overlays currently on screen, keyed by DOM id.
   * @type {Map<string, Function>}
   */
  const active = new Map();

  function removeExisting(id) {
    if (!id) return;
    const dismiss = active.get(id);
    if (typeof dismiss === 'function') {
      // Resolve the overlay being displaced rather than orphaning it. Dropping only its DOM
      // node would leave whatever awaited its promise hanging forever, which for a caller
      // such as the condition prompt means the whole apply path stalls.
      dismiss();
      return;
    }
    document.getElementById(id)?.remove();
  }

  function esc(value) {
    const util = window.DX3rdRuntimeUtils?.escapeHTML;
    if (typeof util === 'function') return util(value);
    return foundry.utils.escapeHTML(String(value ?? ''));
  }

  /**
   * Open the overlay and resolve once a button resolves it or it is dismissed.
   *
   * @param {object} [options]
   * @param {string} [options.id]                     DOM id; an existing overlay with this id is replaced.
   * @param {string} [options.title]                  Header text (inserted as text, not HTML).
   * @param {string} [options.content]                Body HTML; omit for a button-only overlay.
   * @param {number} [options.width=320]              Panel width in pixels (minimum 200).
   * @param {boolean} [options.closeOnEsc=false]      Dismiss on Escape, resolving null.
   * @param {Array<object>} [options.buttons]         `{label, callback|value}` rows, or `{divider: true}`.
   * @param {string} [options.buttonsInBodySelector]  Move the button row into this element inside the body.
   * @param {Function} [options.onRender]             Called with `{root, panel, body, foot}`; may return a cleanup fn.
   * @returns {Promise<any>} The button's value, or null when dismissed.
   */
  async function wait(options = {}) {
    const id = String(options.id ?? 'dx3rd-overlay-dialog').trim() || 'dx3rd-overlay-dialog';
    const title = String(options.title ?? '').trim();
    const content = String(options.content ?? '');
    const width = Math.max(200, Math.trunc(Number(options.width ?? 320) || 320));
    const closeOnEsc = options.closeOnEsc === true;
    const buttons = Array.isArray(options.buttons) ? options.buttons : [];
    const buttonsInBodySelector = String(options.buttonsInBodySelector ?? '').trim();
    const onRender = typeof options.onRender === 'function' ? options.onRender : null;

    removeExisting(id);

    return await new Promise((resolve) => {
      const root = document.createElement('div');
      root.id = id;
      root.className = 'dx3rd-overlay-dialog';
      root.setAttribute('data-system', SYSTEM_ID);

      const panel = document.createElement('div');
      panel.className = 'dx3rd-overlay-dialog__panel';
      panel.style.width = `${width}px`;

      const head = document.createElement('div');
      head.className = 'dx3rd-overlay-dialog__head';

      const headTitle = document.createElement('div');
      headTitle.className = 'dx3rd-overlay-dialog__title';
      headTitle.textContent = title;

      const headClose = document.createElement('button');
      headClose.type = 'button';
      headClose.className = 'dx3rd-overlay-dialog__close';
      headClose.setAttribute('aria-label', 'Close');
      headClose.innerHTML = '<i class="fas fa-xmark" aria-hidden="true"></i>';

      head.appendChild(headTitle);
      head.appendChild(headClose);

      const hasBody = Boolean(content.trim());
      const body = hasBody ? document.createElement('div') : null;
      if (body) {
        body.className = 'dx3rd-overlay-dialog__body';
        body.innerHTML = content;
      }

      const foot = document.createElement('div');
      foot.className = 'dx3rd-overlay-dialog__buttons';

      /** @type {Function[]} */
      const cleanupFns = [];

      const cleanup = (result) => {
        if (active.get(id) === dismiss) active.delete(id);
        document.removeEventListener('keydown', onKeyDown, true);
        for (const fn of cleanupFns) {
          try {
            fn();
          } catch (err) {
            console.warn('DX3rd | Overlay dialog cleanup handler failed', err);
          }
        }
        root.remove();
        resolve(result);
      };

      const dismiss = () => cleanup(null);

      const onKeyDown = (ev) => {
        if (!closeOnEsc) return;
        if (ev.key === 'Escape') {
          ev.preventDefault();
          cleanup(null);
        }
      };

      for (const b of buttons) {
        if (b?.divider === true || b?.kind === 'divider') {
          const hr = document.createElement('div');
          hr.className = 'dx3rd-overlay-dialog__divider';
          foot.appendChild(hr);
          continue;
        }
        const label = String(b?.label ?? '').trim();
        if (!label) continue;
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'dx3rd-overlay-dialog__button';
        btn.textContent = label;
        btn.addEventListener('click', async () => {
          try {
            const v = typeof b?.callback === 'function' ? await b.callback() : b?.value;
            if (v === NO_CLOSE) return;
            // Callers treat null as "dismissed"; a callback returning nothing folds into that.
            cleanup(v === undefined ? null : v);
          } catch (err) {
            console.error('DX3rd | Overlay dialog button callback failed', err);
            cleanup(null);
          }
        });
        foot.appendChild(btn);
      }

      headClose.addEventListener('click', () => cleanup(null));

      panel.appendChild(head);
      if (body) panel.appendChild(body);
      if (body && buttonsInBodySelector) {
        const slot = body.querySelector(buttonsInBodySelector);
        if (slot) {
          foot.classList.add('dx3rd-overlay-dialog__buttons--in-body');
          slot.appendChild(foot);
        } else {
          panel.appendChild(foot);
        }
      } else {
        panel.appendChild(foot);
      }
      root.appendChild(panel);

      document.body.appendChild(root);
      active.set(id, dismiss);
      document.addEventListener('keydown', onKeyDown, true);

      if (onRender) {
        try {
          const maybeCleanup = onRender({ root, panel, body, foot });
          if (typeof maybeCleanup === 'function') cleanupFns.push(maybeCleanup);
        } catch (err) {
          console.error('DX3rd | Overlay dialog onRender failed', err);
        }
      }
    });
  }

  window.DX3rdOverlayDialog = { wait, esc, NO_CLOSE };
})();
