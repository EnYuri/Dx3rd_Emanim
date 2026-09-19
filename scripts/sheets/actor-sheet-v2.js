/**
 * Double Cross 3rd Actor Sheet AppV2.
 */
(function() {
  const api = foundry.applications?.api;
  const ActorSheetV2 = foundry.applications?.sheets?.ActorSheetV2;
  const actorData = window.DX3rdActorSheetData;
  const compat = window.DX3rdApplicationCompat;
  if (!api?.HandlebarsApplicationMixin || !ActorSheetV2 || !actorData || !compat) {
    console.warn('DX3rd | AppV2 actor sheet is unavailable in this Foundry version.');
    return;
  }

  class DX3rdActorSheetV2 extends api.HandlebarsApplicationMixin(ActorSheetV2) {
    static DEFAULT_OPTIONS = {
      classes: ['dx3rd-emanim', 'sheet', 'actor', 'actor-sheet-v2'],
      position: {
        width: 850,
        height: 650
      },
      window: {
        resizable: true
      },
      form: {
        closeOnSubmit: false,
        submitOnChange: true
      },
      actions: {
        attackRoll: DX3rdActorSheetV2._onAttackRoll,
        backtrack: DX3rdActorSheetV2._onBacktrack,
        enterScene: DX3rdActorSheetV2._onEnterScene,
        editEnemyStat: DX3rdActorSheetV2._onEditEnemyStat,
        editAbility: DX3rdActorSheetV2._onEditAbility,
        useStock: DX3rdActorSheetV2._onUseStock,
        editActorType: DX3rdActorSheetV2._onEditActorType,
        createItem: DX3rdActorSheetV2._onCreateItem,
        deleteItem: DX3rdActorSheetV2._onDeleteItem,
        editItem: DX3rdActorSheetV2._onEditItem,
        createSkill: DX3rdActorSheetV2._onCreateSkill,
        editSkill: DX3rdActorSheetV2._onEditSkill,
        removeApplied: DX3rdActorSheetV2._onRemoveApplied,
        removeGrant: DX3rdActorSheetV2._onRemoveGrant,
        editApplied: DX3rdActorSheetV2._onEditApplied,
        rollAbility: DX3rdActorSheetV2._onRollAbility,
        rollSkill: DX3rdActorSheetV2._onRollSkill,
        showApplied: DX3rdActorSheetV2._onShowApplied,
        itemToChat: DX3rdActorSheetV2._onItemToChat,
        toggleDesc: DX3rdActorSheetV2._onToggleDescription,
        titus: DX3rdActorSheetV2._onTitus,
        sublimation: DX3rdActorSheetV2._onSublimation,
        useItem: DX3rdActorSheetV2._onUseItem,
        useRois: DX3rdActorSheetV2._onUseRois,
        applyEffect: DX3rdActorSheetV2._onApplyEffect
      }
    };

    static PARTS = {
      main: {
        template: 'systems/dx3rd-emanim/templates/actor/actor-sheet-v2.html',
        root: true
      }
    };

    static TABS = {
      primary: {
        tabs: [
          {id: 'description'},
          {id: 'combo'},
          {id: 'effect'},
          {id: 'special'},
          {id: 'equipment'},
          {id: 'rois'},
          {id: 'record'},
          {id: 'applied'}
        ],
        initial: 'description'
      }
    };

    /**
     * A key whose value is undefined makes the DataModel validation fail with `may not be undefined`, cancelling the
     * whole submit. In a partial update undefined means "unchanged", so those keys are removed.
     * (The same guard as the item sheet's DX3rdItemSheetV2._processFormData.)
     */
    _processFormData(event, form, formData) {
      const data = super._processFormData(event, form, formData);
      const dropped = compat.pruneUndefinedValues?.(data) ?? [];
      if (dropped.length) {
        console.warn(`DX3rd | 값이 없는 폼 필드를 서브밋에서 제외했습니다: ${dropped.join(', ')}`, {
          sheet: this.constructor.name,
          actor: this.document?.uuid
        });
      }
      return data;
    }

    async _prepareContext(options) {
      const context = await super._prepareContext(options);
      const actor = this.document;
      const simple = actorData.shouldUseSimpleSheet(actor);
      const prepared = await actorData.prepareSheetData(actor, context, {simple});
      prepared.isEnemy = actor.type === 'enemy';
      prepared.isSimple = simple;
      prepared.canEdit = actorData.hasOwnerPermission(actor);
      prepared.actorDocument = actor;
      // The header's appearance button wording: with the CRC stage on it covers the fear roll too (the same rule as the scene control tool).
      prepared.enterSceneLabel = game.settings.get('dx3rd-emanim', 'stageCRC')
        ? 'DX3rd.EnterUrgePanic'
        : 'DX3rd.EnterUrge';
      return prepared;
    }

    /**
     * The AppV2 header controls (the ⋮ menu). The previous sheet exposed the actor type / token settings as inline
     * buttons in the header, so here the same entries are removed from the dropdown and injected directly into the
     * header by _injectHeaderButtons (avoiding duplicates).
     * The action names are compared exactly. Filtering by /token/i would also drop showTokenArtwork (view token
     * artwork), which is not replaced by an inline button.
     */
    _getHeaderControls() {
      const replacedByInlineButtons = ['configurePrototypeToken', 'configureToken'];
      return super._getHeaderControls()
        .filter(control => !replacedByInlineButtons.includes(control.action));
    }

    /**
     * Inject the previous sheet's _getHeaderButtons inline buttons (actor type / prototype token) directly into the
     * AppV2 window header. AppV2 renders _getHeaderControls only as the ⋮ dropdown, so "exposed in the header"
     * requires DOM injection.
     */
    _injectHeaderButtons() {
      const header = this.element?.querySelector('.window-header');
      if (!header) return;

      // Prevent duplicate injection on re-render
      header.querySelectorAll('.dx3rd-header-btn').forEach(el => el.remove());

      // A simple sheet (enemy and some others) does not expose actor type editing (as on the previous sheet).
      if (actorData.shouldUseSimpleSheet(this.document)) return;

      const anchor = header.querySelector('[data-action="toggleControls"]')
        || header.querySelector('[data-action="close"]');

      const makeButton = (icon, label, handler) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'header-control dx3rd-header-btn';
        button.dataset.tooltip = label;
        button.innerHTML = `<i class="${icon}"></i><span>${label}</span>`;
        button.addEventListener('click', handler);
        if (anchor) header.insertBefore(button, anchor);
        else header.appendChild(button);
      };

      if (game.user.isGM) {
        makeButton('fa-solid fa-user-tag', game.i18n.localize('DX3rd.ActorType'),
          event => DX3rdActorSheetV2._onEditActorType.call(this, event, event.currentTarget));
      }

      // The same branch as core's _getHeaderControls: with no edit permission the token settings are not exposed,
      // and an unlinked token's sheet opens that token's own settings rather than the prototype's.
      if (!this.isEditable) return;
      if (this.document.isToken) {
        makeButton('fa-solid fa-user-circle', game.i18n.localize('DX3rd.Token'),
          event => this._onConfigureToken(event));
      } else {
        makeButton('fa-solid fa-user-circle', game.i18n.localize('DX3rd.PrototypeToken'),
          event => this._onConfigurePrototypeToken(event));
      }
    }

    /**
     * The final ordering of the header buttons. Several sources inject buttons into the AppV2 header:
     *   - our sheet: actor type / token (.dx3rd-header-btn)
     *   - female_edition: status (.fedr-sheet-btn), add to stage (.fet-stage-btn) — inserted before close
     *   - core: sheet UUID (an inline control), the dropdown (⋮, toggleControls), close
     * They are rearranged into the desired left→right order:
     *   [status · add to stage] → [actor type · token] → [sheet UUID] → [dropdown ⋮] → [close]
     * appendChild moves an existing node, so re-appending them in the desired order sorts them.
     */
    _reorderHeaderButtons() {
      const header = this.element?.querySelector('.window-header');
      if (!header) return;

      const children = Array.from(header.children);
      const icon = children.find(c => c.classList.contains('window-icon'));
      const title = children.find(c => c.classList.contains('window-title'));
      const toggle = header.querySelector('[data-action="toggleControls"]');
      const close = header.querySelector('[data-action="close"]');

      const isHeadFixed = c => c === icon || c === title;
      const isFront = c => c.classList.contains('fedr-sheet-btn') || c.classList.contains('fet-stage-btn');
      const isOurs = c => c.classList.contains('dx3rd-header-btn');
      const isTail = c => c === toggle || c === close;

      const frontMods = children.filter(isFront);
      const ours = children.filter(isOurs);
      const misc = children.filter(c => !isHeadFixed(c) && !isFront(c) && !isOurs(c) && !isTail(c));

      const desired = [...frontMods, ...ours, ...misc];
      if (toggle) desired.push(toggle);
      if (close) desired.push(close);

      // Do not touch the DOM when it is already ordered (preventing MutationObserver recursion).
      const current = children.filter(c => !isHeadFixed(c));
      const same = current.length === desired.length && current.every((c, i) => c === desired[i]);
      if (same) return;

      desired.forEach(el => header.appendChild(el));
    }

    /**
     * female_edition and others inject buttons into the header after our _onRender (the renderActorSheetV2 hook), and
     * may re-inject on a state change without a full re-render. childList changes are observed and reordered each time.
     * _reorderHeaderButtons is a no-op when already ordered, so the observation loop terminates naturally.
     */
    _observeHeaderButtons() {
      this._headerObserver?.disconnect();
      const header = this.element?.querySelector('.window-header');
      if (!header) return;
      this._headerObserver = new MutationObserver(() => this._reorderHeaderButtons());
      this._headerObserver.observe(header, {childList: true});
    }

    _onConfigurePrototypeToken(event) {
      event?.preventDefault();
      // Going through CONFIG keeps the settings of a module that replaced the prototype token sheet.
      const PrototypeTokenConfig = CONFIG.Token?.prototypeSheetClass
        || foundry.applications?.sheets?.PrototypeTokenConfig;
      if (!PrototypeTokenConfig) {
        ui.notifications.warn(game.i18n.localize('DX3rd.PrototypeTokenConfigUnavailable'));
        return;
      }
      try {
        new PrototypeTokenConfig({prototype: this.document.prototypeToken}).render({force: true});
      } catch (error) {
        console.error('DX3rd | ActorSheetV2 prototype token config failed:', error);
      }
    }

    _onConfigureToken(event) {
      event?.preventDefault();
      try {
        this.document.token?.sheet?.render({force: true});
      } catch (error) {
        console.error('DX3rd | ActorSheetV2 token config failed:', error);
      }
    }

    async _onRender(context, options) {
      await super._onRender(context, options);
      const root = this.element;
      if (!root) return;

      // The previous sheet's styles.css is scoped to .sheet-wrapper, so the container (window-content) is given the
      // sheet-wrapper class to apply the very same appearance rules.
      root.querySelector('.window-content')?.classList.add('sheet-wrapper');

      // Expose the actor type / prototype token as inline header buttons (the same behaviour as the previous sheet).
      this._injectHeaderButtons();

      // Order the header buttons and keep watching for later module injections (female_edition and the like).
      this._reorderHeaderButtons();
      this._observeHeaderButtons();

      this._eventListeners?.abort();
      this._eventListeners = new AbortController();
      const listenerOptions = {signal: this._eventListeners.signal};

      root.querySelectorAll('[data-item-id][draggable="true"]').forEach(element => {
        element.addEventListener('dragstart', event => this._onDragStart(event), listenerOptions);
        element.addEventListener('contextmenu', event => this._onItemContextMenu(event), listenerOptions);
      });

      // Applied tab entries: right click → the edit UI (the same as the pencil button). They have no data-item-id,
      // so they do not hit the item context menu path above and are bound separately.
      root.querySelectorAll('[data-applied-id]').forEach(element => {
        element.addEventListener('contextmenu', event => this._onAppliedContextMenu(event), listenerOptions);
      });

      // Change events are bound through the same class hooks as the previous sheet's markup.
      root.querySelectorAll('.used-input:not([disabled])').forEach(input => {
        input.addEventListener('change', event => this._onUsedStateChange(event), listenerOptions);
      });
      root.querySelectorAll('.active-check').forEach(input => {
        input.addEventListener('change', event => this._onActiveChange(event), listenerOptions);
      });
      root.querySelectorAll('.applied-active-check').forEach(input => {
        input.addEventListener('change', event => this._onAppliedActiveChange(event), listenerOptions);
      });
      root.querySelectorAll('.active-equipment').forEach(input => {
        input.addEventListener('change', event => this._onEquipmentChange(event), listenerOptions);
      });
      root.querySelectorAll('.syndrome-check').forEach(input => {
        input.addEventListener('change', event => this._onSyndromeChange(event), listenerOptions);
      });

      // A skill column with more than four skills folds from the fifth on, to reduce the header height
      // (a new actor has every skill registered, making the social column excessively long).
      this._applySkillCollapse(root);
    }

    /**
     * Fold the entries beyond the fourth in each attribute's (body/sense/mind/social) skill column and inject a
     * "show more (N)" / "collapse" toggle button. The expanded state is kept on the sheet instance, so a column the
     * user expanded stays expanded across re-renders (collapsed by default).
     */
    _applySkillCollapse(root) {
      const THRESHOLD = 4;
      this._expandedAbilities = this._expandedAbilities || new Set();

      root.querySelectorAll('.main-grid .ability').forEach(ability => {
        const abilityId = ability.dataset.abilityId || '';
        const box = ability.querySelector('.skill-box');
        if (!box) return;

        // Safe on re-render / re-application: remove the existing toggle button, then recompute
        box.querySelector('.skill-collapse-toggle')?.remove();
        const skills = Array.from(box.querySelectorAll(':scope > .skill'));
        if (skills.length <= THRESHOLD) {
          skills.forEach(el => el.classList.remove('skill-hidden'));
          return;
        }

        const expanded = this._expandedAbilities.has(abilityId);
        skills.forEach((el, i) => {
          el.classList.toggle('skill-hidden', !expanded && i >= THRESHOLD);
        });

        const hiddenCount = skills.length - THRESHOLD;
        const toggle = document.createElement('button');
        toggle.type = 'button';
        toggle.className = 'skill-collapse-toggle';
        toggle.textContent = expanded
          ? game.i18n.localize('DX3rd.SkillCollapse')
          : `${game.i18n.localize('DX3rd.SkillExpand')} (${hiddenCount})`;
        toggle.addEventListener('click', ev => {
          ev.preventDefault();
          if (this._expandedAbilities.has(abilityId)) this._expandedAbilities.delete(abilityId);
          else this._expandedAbilities.add(abilityId);
          this._applySkillCollapse(root);
        }, { signal: this._eventListeners.signal });
        box.appendChild(toggle);
      });
    }

    async _onClose(options) {
      this._eventListeners?.abort();
      this._eventListeners = null;
      this._headerObserver?.disconnect();
      this._headerObserver = null;
      await super._onClose(options);
    }

    _canEdit() {
      if (actorData.hasOwnerPermission(this.document)) return true;
      ui.notifications.warn(game.i18n.localize('DX3rd.NoPermission'));
      return false;
    }

    _getItemFromTarget(target) {
      const itemId = target.closest('[data-item-id]')?.dataset.itemId;
      return itemId ? this.document.items.get(itemId) : null;
    }

    _getAppliedFromTarget(target) {
      const appliedId = target.closest('[data-applied-id]')?.dataset.appliedId
        || target.closest('[data-item-id]')?.dataset.itemId;
      if (!appliedId) return null;

      const applied = window.DX3rdAppliedEffects?.collect
        ? window.DX3rdAppliedEffects.collect(this.document)
        : (this.document.system?.attributes?.applied || {});

      // A direct key match
      if (applied[appliedId]) return { key: appliedId, effect: applied[appliedId] };

      // Support the legacy applied_N index form — the suffix must be entirely numeric, otherwise an
      // itemId-based key that merely starts with a digit (e.g. 'applied_5xYz…') would resolve to an unrelated index.
      const indexMatch = appliedId.match(/^applied_(\d+)$/);
      if (indexMatch) {
        const key = Object.keys(applied)[Number(indexMatch[1])];
        if (key) return { key, effect: applied[key] };
      }
      return null;
    }

    static _onRollAbility(event, target) {
      event.preventDefault();
      const abilityId = target.closest('[data-ability-id]')?.dataset.abilityId;
      if (!abilityId) return;
      this._showStatRoll('ability', abilityId, target || event.currentTarget);
    }

    static _onRollSkill(event, target) {
      event.preventDefault();
      const skillId = target.closest('[data-skill-id]')?.dataset.skillId;
      if (!skillId) return;
      this._showStatRoll('skill', skillId, target || event.currentTarget);
    }

    _showStatRoll(targetType, targetId, anchor = null) {
      if (!this._canEdit()) return;
      actorData.showStatRoll(this.document, targetType, targetId, anchor);
    }

    // External callers (combat-ui, action-ui) use sheet._openComboBuilder as a callback, so it is kept.
    _openComboBuilder(targetType, targetId) {
      return actorData.openComboBuilder(this.document, targetType, targetId);
    }

    static _onCreateSkill(event, target) {
      event.preventDefault();
      if (!this._canEdit()) return;

      const abilityId = target.dataset.abilityId;
      if (!abilityId) return;

      // Dialog creation is delegated to the shared helper (the same path as the previous actor sheet)
      actorData.openCreateSkillDialog(this.document, abilityId);
    }

    static _onEditSkill(event, target) {
      event.preventDefault();
      if (!this._canEdit()) return;

      const skillId = target.closest('[data-skill-id]')?.dataset.skillId;
      if (!skillId) return;

      // Dialog creation is delegated to the shared helper (the same path as the previous actor sheet)
      actorData.openEditSkillDialog(this.document, skillId);
    }

    static async _onCreateItem(event, target) {
      event.preventDefault();
      if (!this._canEdit()) return;

      const type = target.dataset.type || 'item';
      const effectType = target.dataset.effectType;
      const roisType = target.dataset.roisType;

      await actorData.createOwnedItem(this.document, {type, effectType, roisType});
    }

    static _onEditItem(event, target) {
      event.preventDefault();
      if (!this._canEdit()) return;
      const item = this._getItemFromTarget(target);
      if (item) item.sheet.render(true);
    }

    // Right click = the open-sheet / send-to-chat menu. Unlike a left click (execution) it is read-only, so it does
    // not require edit permission. Sending to chat applies its own gate on the menu side.
    _onItemContextMenu(event) {
      // A right click over an input element (the default paste menu and so on) is not intercepted
      if (event.target.closest('input, textarea, select, [contenteditable="true"]')) return;
      event.preventDefault();
      const item = this._getItemFromTarget(event.currentTarget);
      if (!item) return;
      window.DX3rdItemContextMenu?.open(event, { actor: this.document, item, sheet: this });
    }

    // Right-clicking an Applied entry opens the effect edit UI, the same as the edit button.
    _onAppliedContextMenu(event) {
      if (event.target.closest('input, textarea, select, [contenteditable="true"]')) return;
      event.preventDefault();
      if (!this._canEdit()) return;
      const applied = this._getAppliedFromTarget(event.currentTarget);
      if (!applied) return;
      if (window.DX3rdActorAppliedDialogs?.edit) {
        window.DX3rdActorAppliedDialogs.edit(this.document, applied.key);
        return;
      }
      ui.notifications.error('DX3rdActorAppliedDialogs를 찾을 수 없습니다.');
    }

    static async _onUseItem(event, target) {
      event.preventDefault();
      await this._useItemFromTarget(target);
    }

    // A left-click use of an activated Lois (a D-Lois and the like). It goes through the shared use pipeline
    // (cost, self effects, macros, use count) just like an effect or a usable item, but with roisAction='activate'
    // to block re-entering the Titus / sublimation handler (preventing double macro execution).
    static async _onUseRois(event, target) {
      event.preventDefault();
      await this._useItemFromTarget(target, 'activate');
    }

    static async _onItemToChat(event, target) {
      event.preventDefault();
      const item = this._getItemFromTarget(target);
      if (!item) return;

      // An active item chooses how it is used before the card is shown.
      // With no exception for immediate execution on left click, the menu is always where attack / use / combo /
      // apply-effect is chosen from among what is meaningful for that item.
      const actionableTypes = ['weapon', 'protect', 'vehicle', 'effect', 'psionic', 'spell', 'book', 'connection', 'etc', 'once'];
      if (actionableTypes.includes(item.type)) {
        if (typeof window.DX3rdChooseItemMode !== 'function') {
          ui.notifications.error(game.i18n.localize('DX3rd.DialogV2Unavailable'));
          return;
        }
        const mode = await window.DX3rdChooseItemMode(target || event.currentTarget, item, {
          allowCombo: item.type !== 'protect'
        });
        if (mode === null) return;
        if (mode === 'apply') {
          if (!(game.user.targets?.size > 0)) {
            ui.notifications.warn(game.i18n.localize('DX3rd.SelectTarget'));
            return;
          }
          await actorData.applyItemEffect(this.document, item, {
            menuAnchor: target || event.currentTarget
          });
          return;
        }
        if (mode === 'combo' && !['weapon', 'vehicle'].includes(item.type)) {
          const skill = item.type === 'book'
            ? 'cthulhu'
            : (item.system?.comboSkill && item.system.comboSkill !== '-' ? item.system.comboSkill : item.system?.skill);
          const targetId = skill && skill !== '-' ? skill : '-';
          const builderOptions = {preselectEffectIds: [item.id]};
          if (item.type === 'book') {
            const difficultyValue = Number(item.system?.decipher) || 0;
            Object.assign(builderOptions, {
              isBookDecipher: true,
              originalItem: item,
              predefinedDifficulty: difficultyValue > 0 ? {type: 'number', value: difficultyValue} : null
            });
          }
          await window.DX3rdUniversalHandler?.openComboBuilder?.(this.document, 'skill', targetId, null, builderOptions);
          return;
        }
        await this._useItemFromTarget(target, undefined, {
          menuAnchor: target || event.currentTarget,
          comboMode: mode === 'use' ? 'normal' : mode,
          action: mode === 'use' ? 'use' : undefined
        });
        return;
      }

      // The chat output gate (permission + exhaustion) is delegated to the shared helper (the same path as the previous _onItemNameClick)
      const gate = actorData.checkItemChatGate(this.document, item);
      if (!gate.ok) {
        (ui.notifications[gate.level] || ui.notifications.warn).call(ui.notifications, gate.message);
        return;
      }

      await this._sendItemToChat(item);
    }

    // Inline expand / collapse of the item description (the same behaviour as the previous _onItemLabelClick)
    static _onToggleDescription(event, target) {
      event.preventDefault();
      const li = target.closest('.item');
      if (!li) return;

      const desc = li.querySelector('.item-description');
      if (!desc) return;

      const icon = target.querySelector('i') || li.querySelector('.item-details-toggle i');
      const isVisible = getComputedStyle(desc).display !== 'none';
      desc.style.display = isVisible ? 'none' : 'block';
      icon?.classList.toggle('fa-chevron-down', isVisible);
      icon?.classList.toggle('fa-chevron-up', !isVisible);
    }

    // External code (dx3rd-combat-ui / dx3rd-action-ui / dx3rd-macro) calls sheet._sendItemToChat(item), so the
    // AppV2 sheet keeps the same delegator (delegating to the shared module).
    async _sendItemToChat(item) {
      return window.DX3rdActorChat.sendItemToChat(this.document, item);
    }

    static async _onTitus(event, target) {
      event.preventDefault();
      if (!this._canEdit()) return;
      const item = this._getItemFromTarget(target);
      if (!item) return;
      // Turning a Lois into a Titus is delegated to the shared helper (the same path as the previous actor sheet).
      // handleTitus is called directly, consistent with the chat 'use' button — avoiding the double macro / extra cost of going through handleItemUse.
      await actorData.useTitus(this.document, item);
    }

    static async _onSublimation(event, target) {
      event.preventDefault();
      if (!this._canEdit()) return;
      const item = this._getItemFromTarget(target);
      if (!item) return;
      if (window.DX3rdActorRoisDialogs) {
        await window.DX3rdActorRoisDialogs.useSublimation(this.document, item);
        return;
      }
      ui.notifications.error('DX3rdActorRoisDialogs를 찾을 수 없습니다.');
    }

    static async _onBacktrack(event, target) {
      event.preventDefault();
      if (!this._canEdit()) return;
      if (!window.DX3rdBacktrackWorkflow) {
        ui.notifications.error('DX3rdBacktrackWorkflow를 찾을 수 없습니다.');
        return;
      }
      await window.DX3rdBacktrackWorkflow.start(this.document);
    }

    /** The header's appearance / impulse buttons. They open the same dialogs as the scene control tools, for this actor. */
    static async _onEnterScene(event, target) {
      event.preventDefault();
      if (typeof dx3rdOpenEnterSceneDialog !== 'function') {
        ui.notifications.error('dx3rdOpenEnterSceneDialog를 찾을 수 없습니다.');
        return;
      }
      dx3rdOpenEnterSceneDialog(this.document);
    }

    static async _onEditEnemyStat(event, target) {
      event.preventDefault();
      if (!this._canEdit()) return;
      if (!window.DX3rdEnemyStatDialogs) {
        ui.notifications.error('DX3rdEnemyStatDialogs를 찾을 수 없습니다.');
        return;
      }
      const stat = target?.dataset?.stat;
      await window.DX3rdEnemyStatDialogs.open(this.document, stat);
    }

    static async _onEditAbility(event, target) {
      event.preventDefault();
      if (!this._canEdit()) return;
      if (!window.DX3rdActorEditDialogs) {
        ui.notifications.error('DX3rdActorEditDialogs를 찾을 수 없습니다.');
        return;
      }
      const ability = target?.dataset?.ability
        || target?.closest('[data-ability-id]')?.dataset?.abilityId;
      await window.DX3rdActorEditDialogs.openAbility(this.document, ability);
    }

    static async _onUseStock(event, target) {
      event.preventDefault();
      if (!window.DX3rdActorEditDialogs) {
        ui.notifications.error('DX3rdActorEditDialogs를 찾을 수 없습니다.');
        return;
      }
      await window.DX3rdActorEditDialogs.openStock(this.document);
    }

    static async _onEditActorType(event, target) {
      event.preventDefault();
      if (!this._canEdit()) return;
      if (!window.DX3rdActorEditDialogs) {
        ui.notifications.error('DX3rdActorEditDialogs를 찾을 수 없습니다.');
        return;
      }
      await window.DX3rdActorEditDialogs.openActorType(this.document);
    }

    static async _onAttackRoll(event, target) {
      event.preventDefault();
      if (!this._canEdit()) return;
      const item = this._getItemFromTarget(target);
      if (!item) return;
      // The attack roll dispatch is delegated to the shared helper (a single path, in preparation for V2 becoming the default)
      await actorData.attackRoll(this.document, item);
    }

    // The firing point for applying the effects of an item with no attack flow.
    // When both target effects and self effects exist, the shared branch chooses which to apply.
    static async _onApplyEffect(event, target) {
      event.preventDefault();
      if (!this._canEdit()) return;
      const item = this._getItemFromTarget(target);
      if (!item) return;
      await actorData.applyItemEffect(this.document, item, {menuAnchor: target});
    }

    async _useItemFromTarget(target, roisAction = undefined, options = {}) {
      if (!this._canEdit()) return false;
      const item = this._getItemFromTarget(target);
      if (!item) return false;
      // The item use dispatch is delegated to the shared helper (a single path, in preparation for V2 becoming the default)
      return actorData.useItem(this.document, item, roisAction, undefined, options);
    }

    static async _onDeleteItem(event, target) {
      event.preventDefault();
      if (!this._canEdit()) return;

      const item = this._getItemFromTarget(target);
      if (!item) return;

      if (window.DX3rdActorDeleteDialogs) {
        await window.DX3rdActorDeleteDialogs.deleteItem(this.document, item);
        return;
      }
      ui.notifications.error('DX3rdActorDeleteDialogs를 찾을 수 없습니다.');
    }

    async _onUsedStateChange(event) {
      if (!this._canEdit()) return;
      const item = this._getItemFromTarget(event.currentTarget);
      if (!item) return;
      await window.DX3rdActorSheetData.updateOwnedItemUsedState(this.document, item.id, event.currentTarget.value, event.currentTarget.dataset.counter);
    }

    async _onActiveChange(event) {
      // If submitOnChange handled the same change event as a form submit, the sheet would re-render with the previous
      // document state before the asynchronous AE sync finished, leaving a state where the user has to press again.
      // This checkbox is saved solely by the shared toggle service.
      event.stopImmediatePropagation();
      event.stopPropagation();
      if (!this._canEdit()) return;
      // A DOM Event.currentTarget becomes null after an await. An input element that will be used later is captured
      // separately during the event handling.
      const input = event.currentTarget;
      const item = this._getItemFromTarget(input);
      if (!item) return;
      if (this._activeTogglePending?.has(item.id)) return;

      const checked = input.checked;
      input.disabled = true;
      this._activeTogglePending ??= new Set();
      this._activeTogglePending.add(item.id);
      try {
        await window.DX3rdActorSheetData.updateOwnedItemActiveState(this.document, item.id, checked);
        // A toggle AE is created / removed asynchronously after the item update. Foundry's default document update
        // finishes before that point, so the open actor sheet is redrawn explicitly to refresh derived values such
        // as HP immediately.
        await compat.requestRender(this);
      } finally {
        this._activeTogglePending.delete(item.id);
        // Even when an error occurred before the re-render, recover so the current DOM can be manipulated again.
        if (input.isConnected) input.disabled = false;
      }
    }

    // The active / inactive toggle in the Applied list: checked = active.
    // Route through setActive so the single source stays intact: a toggle-derived AE (appliedKey='toggle:<itemId>')
    // flips the source item's system.active.state, while every other applied row flips its own AE.disabled.
    // Only the trash-can deletion, in the remove path below, also disables the source effect.
    async _onAppliedActiveChange(event) {
      event.stopImmediatePropagation();
      event.stopPropagation();
      if (!this._canEdit()) return;
      const input = event.currentTarget;
      const applied = this._getAppliedFromTarget(input);
      if (!applied) return;
      if (window.DX3rdAppliedEffects?.setActive) {
        input.disabled = true;
        try {
          await window.DX3rdAppliedEffects.setActive(this.document, applied.key, input.checked);
          await compat.requestRender(this);
        } finally {
          if (input.isConnected) input.disabled = false;
        }
        return;
      }
      ui.notifications.error('DX3rdAppliedEffects를 찾을 수 없습니다.');
    }

    async _onEquipmentChange(event) {
      // This input is handled on its own so submitOnChange's form save does not race the equipment-only update.
      event.stopImmediatePropagation();
      event.stopPropagation();
      if (!this._canEdit()) return;
      const input = event.currentTarget;
      const item = this._getItemFromTarget(input);
      if (!item) return;
      if (this._equipmentTogglePending?.has(item.id)) return;

      input.disabled = true;
      this._equipmentTogglePending ??= new Set();
      this._equipmentTogglePending.add(item.id);
      try {
        await window.DX3rdActorSheetData.updateOwnedItemEquipmentState(this.document, item.id, input.checked);
        await compat.requestRender(this);
      } finally {
        this._equipmentTogglePending.delete(item.id);
        if (input.isConnected) input.disabled = false;
      }
    }

    async _onSyndromeChange(event) {
      if (!this._canEdit()) return;

      const item = this._getItemFromTarget(event.currentTarget);
      if (!item || item.type !== 'syndrome') return;

      const result = window.DX3rdActorSheetData.getSyndromeSelectionUpdate(this.document, item.id, event.currentTarget.checked);
      if (!result.ok && result.reason === 'optionalLimit') {
        event.currentTarget.checked = false;
        ui.notifications.warn('선택 가능한 신드롬 수를 초과했습니다.');
        return;
      }

      if (result.changed) {
        await window.DX3rdActorSheetData.updateActorSyndromeSelection(this.document, item.id, event.currentTarget.checked);
      }
    }

    static async _onShowApplied(event, target) {
      event.preventDefault();
      const applied = this._getAppliedFromTarget(target);
      if (!applied) return;

      if (window.DX3rdActorAppliedDialogs) {
        await window.DX3rdActorAppliedDialogs.open(this.document, applied.key);
        return;
      }
      ui.notifications.error('DX3rdActorAppliedDialogs를 찾을 수 없습니다.');
    }

    static async _onEditApplied(event, target) {
      event.preventDefault();
      if (!this._canEdit()) return;

      const applied = this._getAppliedFromTarget(target);
      if (!applied) return;

      if (window.DX3rdActorAppliedDialogs?.edit) {
        await window.DX3rdActorAppliedDialogs.edit(this.document, applied.key);
        return;
      }
      ui.notifications.error('DX3rdActorAppliedDialogs를 찾을 수 없습니다.');
    }

    static async _onRemoveApplied(event, target) {
      event.preventDefault();
      if (!this._canEdit()) return;

      const applied = this._getAppliedFromTarget(target);
      if (!applied) return;

      if (window.DX3rdActorAppliedDialogs) {
        const removed = await window.DX3rdActorAppliedDialogs.remove(this.document, applied.key);
        if (removed) await compat.requestRender(this);
        return;
      }
      ui.notifications.error('DX3rdActorAppliedDialogs를 찾을 수 없습니다.');
    }

    /**
     * Remove an equipment-change marker from the applied tab.
     * Deleting the AE is the whole operation — the delete hook takes the created items back and re-aligns the
     * fist. Restoring anything here would be a second restore path.
     */
    static async _onRemoveGrant(event, target) {
      event.preventDefault();
      if (!this._canEdit()) return;

      const effectId = target.closest('[data-grant-id]')?.dataset.grantId;
      if (!effectId) return;

      if (!window.DX3rdActorAppliedDialogs?.removeGrant) {
        ui.notifications.error('DX3rdActorAppliedDialogs를 찾을 수 없습니다.');
        return;
      }
      const removed = await window.DX3rdActorAppliedDialogs.removeGrant(this.document, effectId);
      if (removed) await compat.requestRender(this);
    }

    _onDragStart(event) {
      const item = this._getItemFromTarget(event.currentTarget);
      if (!item) return;

      // Assembling the drag data is delegated to the shared helper (the same path as the previous actor sheet)
      const dragData = window.DX3rdActorSheetData.buildItemDragData(this.document, item);
      if (!dragData) return;
      event.dataTransfer?.setData('text/plain', JSON.stringify(dragData));
    }

    /**
     * Only an item drop is handled by the system rules (per-type count limits / stageCRC).
     * Intercepting the whole of _onDrop would also kill the dropActorSheetData hook and the ActiveEffect / folder
     * drops, so only this entry point — which core calls after resolving the document — is overridden.
     */
    async _onDropItem(event, item) {
      if (!this._canEdit()) return null;

      try {
        // Dragging an item of the same actor is a reorder, not a creation.
        if (this.document.uuid === item.parent?.uuid) {
          const sorted = await actorData.sortOwnedItem(this.document, {itemId: item.id}, event.target);
          return sorted ? item : null;
        }
        return await actorData.createDroppedItem(this.document, item);
      } catch (error) {
        console.error('DX3rd | ActorSheetV2 item drop failed:', error);
        return null;
      }
    }
  }

  const ActorsClass = foundry.documents?.collections?.Actors || Actors;
  ActorsClass.registerSheet('dx3rd-emanim', DX3rdActorSheetV2, {
    label: 'DX3rd.SheetV2',
    types: ['character', 'enemy'],
    makeDefault: true
  });

  window.DX3rdActorSheetV2 = DX3rdActorSheetV2;
})();
