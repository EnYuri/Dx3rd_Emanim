/**
 * Double Cross 3rd — the item browser.
 *
 * The equipment-tab companion to `DX3rdEffectBrowser`: it indexes every compendium (and world) item of the
 * equipment types (weapon / protect / vehicle / book / connection / etc / once) once, then filters by
 * name/description text plus 종류·분류·기능. The per-type stat columns mirror the summary line the equipment
 * tab prints under each item's name.
 *
 * Entry points: the actor sheet's equipment tab (each section's magnifier opens the browser pre-filtered to
 * that type), the sheet header dropdown, and the `@ItemBrowser` journal link (the enricher lives in
 * `main.js`).
 */
(function() {
  const api = foundry.applications?.api;
  if (!api?.ApplicationV2 || !api?.HandlebarsApplicationMixin) {
    console.warn('DX3rd | Item browser is unavailable in this Foundry version.');
    return;
  }

  const Base = api.HandlebarsApplicationMixin(api.ApplicationV2);

  // The equipment-tab item types. Character data types (works/syndrome/rois/…) are not items.
  const TYPES = ['weapon', 'protect', 'vehicle', 'book', 'connection', 'etc', 'once'];

  // Index fields the result table and the text search need. Anything not listed here is absent from the index
  // records, so adding a column means adding its path here too.
  const INDEX_FIELDS = [
    'system.type',
    'system.skill',
    'system.add',
    'system.attack',
    'system.guard',
    'system.range',
    'system.dodge',
    'system.init',
    'system.armor',
    'system.move',
    'system.quantity',
    'system.decipher',
    'system.exp',
    'system.saving',
    'system.description'
  ];

  // The fields summarized per type, in the same order the equipment tab prints them. A type not listed shows
  // no stat column content at all.
  const STAT_FIELDS = {
    weapon: ['attack', 'add', 'guard', 'range'],
    protect: ['armor', 'dodge', 'init'],
    vehicle: ['attack', 'armor', 'init', 'move'],
    book: ['decipher'],
    etc: ['quantity'],
    once: ['quantity']
  };
  const STAT_LABELS = {
    attack: 'DX3rd.Attack', add: 'DX3rd.Add', guard: 'DX3rd.Guard', range: 'DX3rd.Range',
    armor: 'DX3rd.Armor', dodge: 'DX3rd.Dodge', init: 'DX3rd.Init', move: 'DX3rd.Move',
    decipher: 'DX3rd.Decipher', quantity: 'DX3rd.Quantity'
  };

  const RESULT_LIMIT = 300;

  const RESULTS_TEMPLATE = 'systems/dx3rd-emanim/templates/dialog/item-browser-results.html';

  const localize = (key) => game.i18n.localize(key);
  const format = (key, data) => game.i18n.format(key, data);

  /** @type {Promise<object>|null} Shared by every browser instance; dropped by `DX3rdItemBrowser.clearCache`. */
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
   * The category label a folder path maps to. It follows the effect browser's page naming so the two read the
   * same way: a top-level folder is its own name, a child folder is `부모(자식)`.
   * @param {string[]} path
   * @returns {string}
   */
  function categoryLabel(path) {
    if (!path.length) return localize('DX3rd.Uncategorized');
    if (path.length === 1) return path[0];
    return `${path[0]}(${path.slice(1).join(' / ')})`;
  }

  /** Loose fields hold formulas too (`육체+40`), so a cell only collapses to '-' on empty input. */
  function cell(value) {
    return (value === undefined || value === null || value === '') ? '-' : value;
  }

  /** The equipment tab's per-type stat summary, e.g. `공격력 2 · 수정치 +1 · 가드 3 · 사정거리 10m`. */
  function statsText(type, s) {
    const fields = STAT_FIELDS[type] ?? [];
    if (!fields.length) return '-';
    return fields.map(f => `${localize(STAT_LABELS[f])} ${cell(s[f])}`).join(' · ');
  }

  /**
   * The item's type name, the same way the sheet's `itemType` helper renders it. Weapons append their
   * melee/ranged subtype; the other types' `system.type` just repeats the type name, so it is ignored.
   */
  function typeLabel(type, s) {
    let label = localize(`DX3rd.${type.charAt(0).toUpperCase()}${type.slice(1)}`);
    const sub = s?.type;
    if (type === 'weapon' && sub && sub !== '-') {
      label += `(${localize(`DX3rd.${sub.charAt(0).toUpperCase()}${sub.slice(1)}`)})`;
    }
    return label;
  }

  /** Build one result entry from a compendium index record or a world item. */
  function makeEntry({uuid, name, img, type, system, path, source, sort}) {
    const s = system ?? {};
    const description = s.description ?? '';
    return {
      uuid,
      name: name ?? '',
      img: img || 'icons/svg/item-bag.svg',
      type,
      category: categoryLabel(path),
      source,
      sort: Number(sort) || 0,
      // The index/system subset the stat columns and the skill filter read at render time.
      _s: s,
      description,
      searchText: `${typeLabel(type, s)} ${name ?? ''} ${plainText(description)}`.toLowerCase()
    };
  }

  /** Index every compendium and world item of the equipment types. */
  async function collect() {
    const entries = [];

    for (const pack of game.packs) {
      if (pack.documentName !== 'Item') continue;
      let index;
      try {
        index = await pack.getIndex({fields: INDEX_FIELDS});
      } catch (error) {
        console.warn(`DX3rd | Item browser could not index pack ${pack.collection}:`, error);
        continue;
      }
      for (const record of index) {
        if (!TYPES.includes(record.type)) continue;
        entries.push(makeEntry({
          uuid: record.uuid ?? pack.getUuid(record._id),
          name: record.name,
          img: record.img,
          type: record.type,
          system: record.system,
          path: packFolderPath(pack, record.folder),
          source: pack.metadata?.label || pack.collection,
          sort: record.sort
        }));
      }
    }

    for (const item of game.items ?? []) {
      if (!TYPES.includes(item.type)) continue;
      entries.push(makeEntry({
        uuid: item.uuid,
        name: item.name,
        img: item.img,
        type: item.type,
        system: item.system,
        path: worldFolderPath(item),
        source: localize('DX3rd.WorldItems'),
        sort: item.sort
      }));
    }

    const collator = new Intl.Collator('ko');
    entries.sort((a, b) =>
      (TYPES.indexOf(a.type) - TYPES.indexOf(b.type))
      || collator.compare(a.category, b.category)
      || (a.sort - b.sort)
      || collator.compare(a.name, b.name));

    const categories = [...new Set(entries.map(e => e.category))].sort(collator.compare);
    const skills = [...new Set(entries.map(e => e._s?.skill).filter(v => v && v !== '-'))]
      .sort((a, b) => collator.compare(skillLabel(a), skillLabel(b)));

    return {entries, categories, skills};
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

  class DX3rdItemBrowser extends Base {
    static DEFAULT_OPTIONS = {
      id: 'dx3rd-item-browser',
      classes: ['dx3rd-emanim', 'dialog', 'dx3rd-effect-browser', 'dx3rd-item-browser'],
      window: {
        title: 'DX3rd.ItemBrowser',
        resizable: true
      },
      position: {
        width: 880,
        height: 720
      },
      actions: {
        resetFilters: DX3rdItemBrowser._onResetFilters
      }
    };

    static PARTS = {
      main: {
        template: 'systems/dx3rd-emanim/templates/dialog/item-browser.html',
        root: true
      }
    };

    /**
     * @param {object} [options]
     * @param {Actor} [options.actor]   When given, each row offers an "add to actor" button.
     * @param {string} [options.type]   When given, the browser opens pre-filtered to this item type.
     */
    constructor(options = {}) {
      super(options);
      this.actor = options.actor ?? null;
      this.filters = {query: '', type: TYPES.includes(options.type) ? options.type : '', category: '', skill: ''};
      this._cache = null;
      this._expanded = new Set();
    }

    get title() {
      const base = localize('DX3rd.ItemBrowser');
      return this.actor ? `${base} — ${this.actor.name}` : base;
    }

    async _prepareContext(options) {
      const context = await super._prepareContext(options);
      try {
        this._cache = await loadCache();
      } catch (error) {
        console.error('DX3rd | Item browser failed to index items:', error);
        ui.notifications.error(localize('DX3rd.ItemBrowserLoadFailed'));
        this._cache = {entries: [], categories: [], skills: []};
      }
      const cache = this._cache;
      context.hasActor = !!this.actor;
      context.filters = this.filters;
      context.types = TYPES.map(value => ({value, label: typeLabel(value), selected: this.filters.type === value}));
      context.categories = cache.categories.map(value => ({value, label: value, selected: this.filters.category === value}));
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
      const {query, type, category, skill} = this.filters;
      const needles = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
      const matches = [];
      for (const entry of this._cache?.entries ?? []) {
        if (type && entry.type !== type) continue;
        if (category && entry.category !== category) continue;
        if (skill && entry._s?.skill !== skill) continue;
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
          typeLabel: typeLabel(entry.type, entry._s),
          skillLabel: skillLabel(entry._s?.skill),
          stats: statsText(entry.type, entry._s ?? {}),
          saving: `${cell(entry._s?.saving?.difficulty)} / ${cell(entry._s?.saving?.value)}`,
          exp: cell(entry._s?.exp),
          expanded: this._expanded.has(entry.uuid)
        })),
        truncated: matches.length > shown.length,
        limit: RESULT_LIMIT,
        empty: !matches.length
      });

      const count = root.querySelector('.effect-browser-count');
      if (count) count.textContent = format('DX3rd.ItemBrowserCount', {shown: shown.length, total: matches.length});
    }

    async _onResultClick(event) {
      const row = event.target.closest('[data-uuid]');
      if (!row) return;
      const uuid = row.dataset.uuid;

      if (event.target.closest('.item-open-sheet')) {
        event.preventDefault();
        const doc = await fromUuid(uuid);
        doc?.sheet?.render(true);
        return;
      }

      if (event.target.closest('.item-add-to-actor')) {
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
        ui.notifications.error(localize('DX3rd.ItemBrowserLoadFailed'));
        return;
      }
      const created = await window.DX3rdActorSheetData.createDroppedItem(this.actor, item);
      if (created) {
        ui.notifications.info(format('DX3rd.ItemBrowserAdded', {name: item.name, actor: this.actor.name}));
      }
    }

    static _onResetFilters(event) {
      event.preventDefault();
      this.filters = {query: '', type: '', category: '', skill: ''};
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
     * @param {string} [options.type]  When given, the filter selects this item type.
     * @returns {DX3rdItemBrowser}
     */
    static open(options = {}) {
      const existing = foundry.applications.instances?.get('dx3rd-item-browser');
      if (existing instanceof DX3rdItemBrowser) {
        if (options.actor) existing.actor = options.actor;
        if (options.type) existing.filters.type = TYPES.includes(options.type) ? options.type : '';
        existing.render({force: true});
        existing.bringToFront?.();
        return existing;
      }
      const app = new DX3rdItemBrowser(options);
      app.render(true);
      return app;
    }
  }

  // The index is built once and reused. Compendium editing inside Foundry is the supported authoring path, so a
  // change to any non-embedded equipment item drops it — embedded (actor-owned) items are not indexed and are ignored.
  const invalidate = (doc) => {
    if (doc?.documentName !== 'Item' || !TYPES.includes(doc.type) || doc.parent) return;
    DX3rdItemBrowser.clearCache();
  };
  for (const hook of ['createItem', 'updateItem', 'deleteItem']) Hooks.on(hook, invalidate);
  for (const hook of ['createFolder', 'updateFolder', 'deleteFolder']) {
    Hooks.on(hook, folder => {
      if (folder?.type === 'Item') DX3rdItemBrowser.clearCache();
    });
  }

  window.DX3rdItemBrowser = DX3rdItemBrowser;
})();
