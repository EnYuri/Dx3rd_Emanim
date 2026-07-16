/**
 * Shared compatibility helpers for the 이전 시트 to AppV2 migration.
 */
(function() {
    // 동일한 문서 변경에서 updateItem/updateActor/명시적 UI 갱신이 연달아 발생할 수 있다.
    // AppV2 렌더는 비용이 크므로 같은 마이크로태스크 안의 요청은 앱별 한 번으로 합친다.
    const pendingRenders = new WeakMap();

    function unwrapRoot(root) {
        if (!root) return null;
        if (root.jquery) return root[0] || null;
        if (root.element) return unwrapRoot(root.element);
        if (Array.isArray(root)) return unwrapRoot(root[0]);
        return root;
    }

    function query(root, selector) {
        return unwrapRoot(root)?.querySelector?.(selector) || null;
    }

    function queryAll(root, selector) {
        return Array.from(unwrapRoot(root)?.querySelectorAll?.(selector) || []);
    }

    function closest(target, selector, root = null) {
        const match = target?.closest?.(selector) || null;
        const boundary = unwrapRoot(root);
        return !boundary || (match && boundary.contains(match)) ? match : null;
    }

    function on(root, eventName, selector, handler, options) {
        const element = unwrapRoot(root);
        if (!element?.addEventListener) return () => {};

        let listener = handler;
        let listenerOptions = options;
        if (typeof selector === 'function') {
            listenerOptions = handler;
            listener = selector;
        } else {
            listener = function(event) {
                const target = closest(event.target, selector, element);
                if (target) handler.call(target, event, target);
            };
        }

        element.addEventListener(eventName, listener, listenerOptions);
        return () => element.removeEventListener(eventName, listener, listenerOptions);
    }

    function toJQuery(root) {
        const element = unwrapRoot(root);
        return element && globalThis.jQuery ? globalThis.jQuery(element) : null;
    }

    function requestRender(app) {
        if (!app?.rendered || typeof app.render !== 'function') return Promise.resolve(false);
        const pending = pendingRenders.get(app);
        if (pending) return pending;

        const task = Promise.resolve()
            .then(() => app.render(false))
            .catch(error => console.error('DX3rd | 시트 갱신 실패:', error))
            .finally(() => pendingRenders.delete(app));
        pendingRenders.set(app, task);
        return task;
    }

    function getCapabilities() {
        const applications = globalThis.foundry?.applications;
        return Object.freeze({
            applicationV2: Boolean(applications?.api?.ApplicationV2),
            handlebarsApplicationMixin: Boolean(applications?.api?.HandlebarsApplicationMixin),
            documentSheetV2: Boolean(applications?.api?.DocumentSheetV2),
            actorSheetV2: Boolean(applications?.sheets?.ActorSheetV2),
            itemSheetV2: Boolean(applications?.sheets?.ItemSheetV2),
            dialogV2: Boolean(applications?.api?.DialogV2),
            jquery: Boolean(globalThis.jQuery)
        });
    }

    window.DX3rdApplicationCompat = Object.freeze({
        unwrapRoot,
        query,
        queryAll,
        closest,
        on,
        toJQuery,
        requestRender,
        getCapabilities
    });
})();
