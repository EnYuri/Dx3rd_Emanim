/**
 * Double Cross 3rd — the effect browser.
 *
 * The 「이펙트 목록」 guide journal lists every effect as one huge HTML table per 신드롬. Foundry's journal
 * search matches whole pages, so looking for a single effect there means scanning a 65~100 entry page by eye.
 * This application makes the effect itself the unit of search: it indexes every compendium (and world) item of
 * type `effect` once, then filters by name/description text plus 분류·타이밍·기능.
 *
 * Entry points: the actor sheet's effect tab, and the `@EffectBrowser` link the guide journal's table of
 * contents carries (the enricher lives in `main.js`).
 */
(function() {
  const api = foundry.applications?.api;
  if (!api?.ApplicationV2 || !api?.HandlebarsApplicationMixin) {
    console.warn('DX3rd | Effect browser is unavailable in this Foundry version.');
    return;
  }

  const Base = api.HandlebarsApplicationMixin(api.ApplicationV2);

  // Index fields the result table and the text search need. Anything not listed here is absent from the index
  // records, so adding a column means adding its path here too.
  const INDEX_FIELDS = [
    'system.timing',
    'system.skill',
    'system.difficulty',
    'system.target',
    'system.range',
    'system.encroach.value',
    'system.limit',
    'system.level.max',
    'system.level.value',
    'system.description'
  ];

  // The guide journal excludes this top-level folder; the browser keeps it but hides it behind a toggle, because
  // a GM does want to find enemy effects and a player usually does not.
  const ENEMY_FOLDER = '에너미 이펙트';

  // Drawing every one of ~1600 rows costs more than it buys — the list is meant to be narrowed. Anything past
  // this is reported as a count instead of a row.
  const RESULT_LIMIT = 300;

  const RESULTS_TEMPLATE = 'systems/dx3rd-emanim/templates/dialog/effect-browser-results.html';

  const localize = (key) => game.i18n.localize(key);
  const format = (key, data) => game.i18n.format(key, data);

  /** @type {Promise<object>|null} Shared by every browser instance; dropped by `DX3rdEffectBrowser.clearCache`. */
  let cachePromise = null;

  /** Strip markup so a description can be searched as plain text. */
  function plainText(html) {
    if (!html) return '';
    const div = document.createElement('div');
    div.innerHTML = String(html);
    return (div.textContent || '').replace(/\s+/g, ' ').trim();
  }

  /**
   * The folder path of a compendium entry, outermost first.
   * @param {CompendiumCollection} pack
   * @param {string|null} folderId
   * @returns {string[]}
   */
  function packFolderPath(pack, folderId) {
    const names = [];
    let folder = folderId ? pack.folders?.get(folderId) : null;
    let guard = 0;
    while (folder && guard++ < 10) {
      names.unshift(folder.name);
      folder = folder.folder ?? null;
    }
    return names;
  }

  /** The folder path of a world item, outermost first. */
  function worldFolderPath(item) {
    const names = [];
    let folder = item.folder;
    let guard = 0;
    while (folder && guard++ < 10) {
      names.unshift(folder.name);
      folder = folder.folder ?? null;
    }
    return names;
  }

  /**
   * The category label a folder path maps to. It follows the guide journal's page naming so the two read the
   * same way: a top-level folder is its own name, a child folder is `부모(자식)`.
   * @param {string[]} path
   * @returns {string}
   */
  function categoryLabel(path) {
    if (!path.length) return localize('DX3rd.Uncategorized');
    if (path.length === 1) return path[0];
    return `${path[0]}(${path.slice(1).join(' / ')})`;
  }

  /** Build one result entry from a compendium index record or a world item. */
  function makeEntry({uuid, name, img, system, path, source, sort}) {
    const s = system ?? {};
    const description = s.description ?? '';
    return {
      uuid,
      name: name ?? '',
      img: img || 'icons/svg/item-bag.svg',
      category: categoryLabel(path),
      isEnemy: path[0] === ENEMY_FOLDER,
      source,
      sort: Number(sort) || 0,
      timing: s.timing ?? '-',
      skill: s.skill ?? '-',
      difficulty: s.difficulty ?? '-',
      target: s.target ?? '-',
      range: s.range ?? '-',
      encroach: s.encroach?.value ?? '-',
      limit: s.limit ?? '-',
      level: s.level?.max ?? s.level?.value ?? '-',
      description,
      searchText: `${name ?? ''} ${plainText(description)}`.toLowerCase()
    };
  }

  /** Index every compendium and world item of type `effect`. */
  async function collect() {
    const entries = [];

    for (const pack of game.packs) {
      if (pack.documentName !== 'Item') continue;
      let index;
      try {
        index = await pack.getIndex({fields: INDEX_FIELDS});
      } catch (error) {
        console.warn(`DX3rd | Effect browser could not index pack ${pack.collection}:`, error);
        continue;
      }
      for (const record of index) {
        if (record.type !== 'effect') continue;
        entries.push(makeEntry({
          uuid: record.uuid ?? pack.getUuid(record._id),
          name: record.name,
          img: record.img,
          system: record.system,
          path: packFolderPath(pack, record.folder),
          source: pack.metadata?.label || pack.collection,
          sort: record.sort
        }));
      }
    }

    for (const item of game.items ?? []) {
      if (item.type !== 'effect') continue;
      entries.push(makeEntry({
        uuid: item.uuid,
        name: item.name,
        img: item.img,
        system: item.system,
        path: worldFolderPath(item),
        source: localize('DX3rd.WorldItems'),
        sort: item.sort
      }));
    }

    const collator = new Intl.Collator('ko');
    entries.sort((a, b) =>
      collator.compare(a.category, b.category)
      || (a.sort - b.sort)
      || collator.compare(a.name, b.name));

    const categories = [...new Set(entries.map(e => e.category))].sort(collator.compare);
    const timings = [...new Set(entries.map(e => e.timing))].filter(v => v && v !== '-');
    const skills = [...new Set(entries.map(e => e.skill))].filter(v => v && v !== '-');

    return {entries, categories, timings, skills};
  }

  function loadCache() {
    if (!cachePromise) {
      cachePromise = collect().catch(error => {
        cachePromise = null;
        throw error;
      });
    }
    return cachePromise;
  }

  /** Localize a timing key the same way the sheets' `timing` helper does. */
  function timingLabel(value) {
    if (!value || value === '-') return '-';
    return game.i18n.localize(`DX3rd.${value.charAt(0).toUpperCase()}${value.slice(1)}`);
  }

  /**
   * Localize a skill key without an actor. The sheet helper resolves against the actor's own skill list, which
   * the browser has no access to, so this falls back to the system keys plus the custom-skill setting.
   */
  function skillLabel(value) {
    if (!value || value === '-') return '-';
    const custom = game.settings.get('dx3rd-emanim', 'customSkills') || {};
    const entry = custom[value];
    if (entry) return typeof entry === 'object' ? entry.name : entry;
    for (const key of [`DX3rd.${value}`, `DX3rd.${value.charAt(0).toUpperCase()}${value.slice(1)}`]) {
      const localized = game.i18n.localize(key);
      if (localized !== key) return localized;
    }
    return value;
  }

  class DX3rdEffectBrowser extends Base {
    static DEFAULT_OPTIONS = {
      id: 'dx3rd-effect-browser',
      classes: ['dx3rd-emanim', 'dialog', 'dx3rd-effect-browser'],
      window: {
        title: 'DX3rd.EffectBrowser',
        resizable: true
      },
      position: {
        width: 880,
        height: 720
      },
      actions: {
        resetFilters: DX3rdEffectBrowser._onResetFilters
      }
    };

    static PARTS = {
      main: {
        template: 'systems/dx3rd-emanim/templates/dialog/effect-browser.html',
        root: true
      }
    };

    /**
     * @param {object} [options]
     * @param {Actor} [options.actor]  When given, each row offers an "add to actor" button.
     */
    constructor(options = {}) {
      super(options);
      this.actor = options.actor ?? null;
      this.filters = {query: '', category: '', timing: '', skill: '', includeEnemy: false};
      this._cache = null;
      this._expanded = new Set();
    }

    get title() {
      const base = localize('DX3rd.EffectBrowser');
      return this.actor ? `${base} — ${this.actor.name}` : base;
    }

    async _prepareContext(options) {
      const context = await super._prepareContext(options);
      try {
        this._cache = await loadCache();
      } catch (error) {
        console.error('DX3rd | Effect browser failed to index effects:', error);
        ui.notifications.error(localize('DX3rd.EffectBrowserLoadFailed'));
        this._cache = {entries: [], categories: [], timings: [], skills: []};
      }
      const cache = this._cache;
      context.hasActor = !!this.actor;
      context.filters = this.filters;
      context.categories = cache.categories.map(value => ({value, label: value, selected: this.filters.category === value}));
      context.timings = cache.timings.map(value => ({value, label: timingLabel(value), selected: this.filters.timing === value}));
      context.skills = cache.skills.map(value => ({value, label: skillLabel(value), selected: this.filters.skill === value}));
      return context;
    }

    async _onRender(context, options) {
      await super._onRender(context, options);
      const root = this.element instanceof HTMLElement ? this.element : null;
      if (!root) return;

      this._controller?.abort();
      this._controller = new AbortController();
      const signal = this._controller.signal;

      root.addEventListener('submit', event => event.preventDefault(), {signal});

      const search = root.querySelector('.effect-browser-search');
      if (search) {
        // The filter controls are never redrawn (see `_renderResults`), so the input keeps its own value.
        search.value = this.filters.query;
        let timer = null;
        search.addEventListener('input', () => {
          clearTimeout(timer);
          timer = setTimeout(() => {
            this.filters.query = search.value;
            this._renderResults();
          }, 150);
        }, {signal});
      }

      for (const select of root.querySelectorAll('.effect-browser-filter')) {
        select.addEventListener('change', () => {
          this.filters[select.dataset.filter] = select.value;
          this._renderResults();
        }, {signal});
      }

      const enemyToggle = root.querySelector('.effect-browser-enemy');
      enemyToggle?.addEventListener('change', () => {
        this.filters.includeEnemy = enemyToggle.checked;
        this._renderResults();
      }, {signal});

      const results = root.querySelector('.effect-browser-results');
      if (results) {
        results.addEventListener('click', event => this._onResultClick(event), {signal});
        results.addEventListener('dragstart', event => this._onDragStart(event), {signal});
      }

      await this._renderResults();
    }

    async close(options = {}) {
      this._controller?.abort();
      this._controller = null;
      return super.close(options);
    }

    /** Apply the current filters to the cached index. */
    _filtered() {
      const {query, category, timing, skill, includeEnemy} = this.filters;
      const needles = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
      const matches = [];
      for (const entry of this._cache?.entries ?? []) {
        if (!includeEnemy && entry.isEnemy) continue;
        if (category && entry.category !== category) continue;
        if (timing && entry.timing !== timing) continue;
        if (skill && entry.skill !== skill) continue;
        if (needles.length && !needles.every(n => entry.searchText.includes(n))) continue;
        matches.push(entry);
      }
      return matches;
    }

    /**
     * Redraw only the result table. The filter controls are left alone so the search input keeps focus and its
     * caret position while typing.
     */
    async _renderResults() {
      const root = this.element instanceof HTMLElement ? this.element : null;
      const container = root?.querySelector('.effect-browser-results');
      if (!container) return;

      const matches = this._filtered();
      const shown = matches.slice(0, RESULT_LIMIT);
      const renderTemplate = foundry.applications.handlebars.renderTemplate;
      container.innerHTML = await renderTemplate(RESULTS_TEMPLATE, {
        hasActor: !!this.actor,
        entries: shown.map(entry => ({
          ...entry,
          timingLabel: timingLabel(entry.timing),
          skillLabel: skillLabel(entry.skill),
          expanded: this._expanded.has(entry.uuid)
        })),
        truncated: matches.length > shown.length,
        limit: RESULT_LIMIT,
        empty: !matches.length
      });

      const count = root.querySelector('.effect-browser-count');
      if (count) count.textContent = format('DX3rd.EffectBrowserCount', {shown: shown.length, total: matches.length});
    }

    async _onResultClick(event) {
      const row = event.target.closest('[data-uuid]');
      if (!row) return;
      const uuid = row.dataset.uuid;

      if (event.target.closest('.effect-open-sheet')) {
        event.preventDefault();
        const doc = await fromUuid(uuid);
        doc?.sheet?.render(true);
        return;
      }

      if (event.target.closest('.effect-add-to-actor')) {
        event.preventDefault();
        await this._addToActor(uuid);
        return;
      }

      // Anywhere else on the row toggles the description.
      const details = row.querySelector('.effect-browser-description');
      if (!details) return;
      const wasHidden = details.hidden;
      details.hidden = !wasHidden;
      if (wasHidden) this._expanded.add(uuid);
      else this._expanded.delete(uuid);
    }

    _onDragStart(event) {
      const row = event.target.closest('[data-uuid]');
      if (!row) return;
      event.dataTransfer?.setData('text/plain', JSON.stringify({type: 'Item', uuid: row.dataset.uuid}));
    }

    async _addToActor(uuid) {
      if (!this.actor) return;
      if (!window.DX3rdActorSheetData?.hasOwnerPermission?.(this.actor)) {
        ui.notifications.warn(localize('DX3rd.NoPermission'));
        return;
      }
      const item = await fromUuid(uuid);
      if (!item) {
        ui.notifications.error(localize('DX3rd.EffectBrowserLoadFailed'));
        return;
      }
      const created = await window.DX3rdActorSheetData.createDroppedItem(this.actor, item);
      if (created) {
        ui.notifications.info(format('DX3rd.EffectBrowserAdded', {name: item.name, actor: this.actor.name}));
      }
    }

    static _onResetFilters(event) {
      event.preventDefault();
      this.filters = {query: '', category: '', timing: '', skill: '', includeEnemy: false};
      this.render({force: true});
    }

    /** Drop the shared index — the compendium contents changed. */
    static clearCache() {
      cachePromise = null;
    }

    /**
     * Open the browser, reusing the window that is already up.
     * @param {object} [options]
     * @param {Actor} [options.actor]
     * @returns {DX3rdEffectBrowser}
     */
    static open(options = {}) {
      const existing = foundry.applications.instances?.get('dx3rd-effect-browser');
      if (existing instanceof DX3rdEffectBrowser) {
        if (options.actor) existing.actor = options.actor;
        existing.render({force: true});
        existing.bringToFront?.();
        return existing;
      }
      const app = new DX3rdEffectBrowser(options);
      app.render(true);
      return app;
    }
  }

  // The index is built once and reused. Compendium editing inside Foundry is the supported authoring path, so a
  // change to any non-embedded effect drops it — embedded (actor-owned) items are not indexed and are ignored.
  const invalidate = (doc) => {
    if (doc?.documentName !== 'Item' || doc.type !== 'effect' || doc.parent) return;
    DX3rdEffectBrowser.clearCache();
  };
  for (const hook of ['createItem', 'updateItem', 'deleteItem']) Hooks.on(hook, invalidate);
  for (const hook of ['createFolder', 'updateFolder', 'deleteFolder']) {
    Hooks.on(hook, folder => {
      if (folder?.type === 'Item') DX3rdEffectBrowser.clearCache();
    });
  }

  window.DX3rdEffectBrowser = DX3rdEffectBrowser;
})();
