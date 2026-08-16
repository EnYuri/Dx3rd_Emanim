/**
 * Shared DOM and rendering helpers for AppV2 applications.
 */
(function() {
    // One document change can trigger updateItem/updateActor hooks and an explicit UI refresh.
    // AppV2 renders are expensive, so coalesce requests per application within a microtask.
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

    /**
     * Recursively remove undefined values from submitted data and return their paths.
     *
     * In a partial update, undefined means "leave this field unchanged." DataModel validation,
     * however, rejects a present key whose value is undefined and cancels the entire submission.
     * This can happen briefly when a form control cannot provide a value.
     * @param {object} data
     * @param {string} [prefix]
     * @returns {string[]} removed property paths
     */
    function pruneUndefinedValues(data, prefix = '') {
        const dropped = [];
        if (!data || typeof data !== 'object' || Array.isArray(data)) return dropped;
        for (const [key, value] of Object.entries(data)) {
            const path = prefix ? `${prefix}.${key}` : key;
            if (value === undefined) {
                delete data[key];
                dropped.push(path);
            } else if (value && typeof value === 'object' && !Array.isArray(value)) {
                dropped.push(...pruneUndefinedValues(value, path));
            }
        }
        return dropped;
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
        pruneUndefinedValues,
        getCapabilities
    });
})();
