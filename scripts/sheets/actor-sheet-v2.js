/**
 * Double Cross 3rd Actor Sheet AppV2.
 */
(function() {
  const api = foundry.applications?.api;
  const ActorSheetV2 = foundry.applications?.sheets?.ActorSheetV2;
  const actorData = window.DX3rdActorSheetData;
  if (!api?.HandlebarsApplicationMixin || !ActorSheetV2 || !actorData) {
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
        editApplied: DX3rdActorSheetV2._onEditApplied,
        rollAbility: DX3rdActorSheetV2._onRollAbility,
        rollSkill: DX3rdActorSheetV2._onRollSkill,
        showApplied: DX3rdActorSheetV2._onShowApplied,
        itemToChat: DX3rdActorSheetV2._onItemToChat,
        toggleDesc: DX3rdActorSheetV2._onToggleDescription,
        titus: DX3rdActorSheetV2._onTitus,
        sublimation: DX3rdActorSheetV2._onSublimation,
        useItem: DX3rdActorSheetV2._onUseItem,
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

    async _prepareContext(options) {
      const context = await super._prepareContext(options);
      const actor = this.document;
      const simple = actorData.shouldUseSimpleSheet(actor);
      const prepared = await actorData.prepareSheetData(actor, context, {simple});
      prepared.isEnemy = actor.type === 'enemy';
      prepared.isSimple = simple;
      prepared.canEdit = actorData.hasOwnerPermission(actor);
      prepared.actorDocument = actor;
      return prepared;
    }

    /**
     * AppV2 헤더 컨트롤(⋮ 메뉴). 이전 시트 은 액터 타입/프로토타입 토큰을 헤더에 인라인 버튼으로
     * 노출하므로, 여기서는 동일한 항목들을 드롭다운에서 제거하고 _injectHeaderButtons 로
     * 헤더에 직접 주입한다(중복 방지).
     */
    _getHeaderControls() {
      return super._getHeaderControls()
        .filter(control => !/token/i.test(control.action || ''));
    }

    /**
     * 이전 시트 _getHeaderButtons 의 인라인 버튼(액터 타입/프로토타입 토큰)을 AppV2 윈도우 헤더에
     * 직접 주입한다. AppV2 는 _getHeaderControls 를 ⋮ 드롭다운으로만 렌더하므로,
     * "헤더에 노출"하려면 DOM 주입이 필요하다.
     */
    _injectHeaderButtons() {
      const header = this.element?.querySelector('.window-header');
      if (!header) return;

      // 재렌더 시 중복 주입 방지
      header.querySelectorAll('.dx3rd-header-btn').forEach(el => el.remove());

      // simple 시트(enemy 등 일부)는 액터 타입 편집을 노출하지 않는다(이전 시트과 동일).
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
      makeButton('fa-solid fa-user-circle', game.i18n.localize('DX3rd.Token'),
        event => this._onConfigurePrototypeToken(event));
    }

    /**
     * 헤더 버튼 최종 정렬. AppV2 헤더에는 여러 출처가 버튼을 주입한다:
     *   - 우리 시트: 액터 타입/토큰 (.dx3rd-header-btn)
     *   - female_edition: 스테이터스(.fedr-sheet-btn), 무대에 추가(.fet-stage-btn) — close 앞에 삽입
     *   - 코어: 시트UUID(인라인 컨트롤), 드롭다운(⋮, toggleControls), 닫기(close)
     * 원하는 좌→우 순서로 재배열한다:
     *   [스테이터스·무대에추가] → [액터타입·토큰] → [시트UUID] → [드롭다운 ⋮] → [닫기]
     * appendChild 는 기존 노드를 이동시키므로 desired 순서대로 다시 붙이면 정렬된다.
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

      // 이미 정렬되어 있으면 DOM 변경을 하지 않는다(MutationObserver 재귀 방지).
      const current = children.filter(c => !isHeadFixed(c));
      const same = current.length === desired.length && current.every((c, i) => c === desired[i]);
      if (same) return;

      desired.forEach(el => header.appendChild(el));
    }

    /**
     * female_edition 등은 우리 _onRender 이후(renderActorSheetV2 훅) 헤더에 버튼을 주입하고,
     * 상태 변경 시 전체 재렌더 없이 재주입하기도 한다. childList 변화를 관찰해 그때마다 재정렬한다.
     * _reorderHeaderButtons 는 이미 정렬된 경우 no-op 이므로 관찰 루프가 자연히 종료된다.
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
      const PrototypeTokenConfig = foundry.applications?.sheets?.PrototypeTokenConfig;
      if (!PrototypeTokenConfig) {
        ui.notifications.warn(game.i18n.localize('DX3rd.PrototypeTokenConfigUnavailable'));
        return;
      }
      try {
        new PrototypeTokenConfig({prototype: this.document.prototypeToken}).render(true);
      } catch (error) {
        console.error('DX3rd | ActorSheetV2 prototype token config failed:', error);
      }
    }

    async _onRender(context, options) {
      await super._onRender(context, options);
      const root = this.element;
      if (!root) return;

      // 이전 시트 styles.css는 .sheet-wrapper 스코프이므로, 컨테이너(window-content)에
      // sheet-wrapper 클래스를 부여해 동일한 외형 규칙을 그대로 적용한다.
      root.querySelector('.window-content')?.classList.add('sheet-wrapper');

      // 액터 타입/프로토타입 토큰을 헤더에 인라인 버튼으로 노출(이전 시트 동작과 동일).
      this._injectHeaderButtons();

      // 헤더 버튼 정렬 + 이후 모듈 주입(female_edition 등)까지 관찰해 원하는 순서 유지.
      this._reorderHeaderButtons();
      this._observeHeaderButtons();

      this._eventListeners?.abort();
      this._eventListeners = new AbortController();
      const listenerOptions = {signal: this._eventListeners.signal};

      root.querySelectorAll('[data-item-id][draggable="true"]').forEach(element => {
        element.addEventListener('dragstart', event => this._onDragStart(event), listenerOptions);
        element.addEventListener('contextmenu', event => this._onItemContextMenu(event), listenerOptions);
      });

      // 효과(Applied) 탭 항목: 우클릭 → 편집 UI(연필 버튼과 동일). data-item-id 가 없어
      // 위의 아이템 컨텍스트 메뉴 경로에 걸리지 않으므로 별도 바인딩한다.
      root.querySelectorAll('[data-applied-id]').forEach(element => {
        element.addEventListener('contextmenu', event => this._onAppliedContextMenu(event), listenerOptions);
      });

      // 변경 이벤트는 이전 시트 마크업과 동일한 클래스 훅으로 바인딩한다.
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

      // 기능치가 4개를 초과하는 기능치 열은 5번째부터 접어 헤더 높이를 줄인다
      // (새 액터는 모든 기능치가 등록돼 사회 열이 지나치게 길어지므로).
      this._applySkillCollapse(root);
    }

    /**
     * 각 능력치(육체/감각/정신/사회) 기능치 열에서 4개를 초과하는 항목을 접고,
     * "더 보기(N)"/"접기" 토글 버튼을 주입한다. 펼침 상태는 시트 인스턴스에 유지되어
     * 재렌더에도 사용자가 펼쳐둔 열은 그대로 유지된다(기본값은 접힘).
     */
    _applySkillCollapse(root) {
      const THRESHOLD = 4;
      this._expandedAbilities = this._expandedAbilities || new Set();

      root.querySelectorAll('.main-grid .ability').forEach(ability => {
        const abilityId = ability.dataset.abilityId || '';
        const box = ability.querySelector('.skill-box');
        if (!box) return;

        // 재렌더/재적용 안전: 기존 토글 버튼 제거 후 다시 계산
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

      // 직접 키 매칭
      if (applied[appliedId]) return { key: appliedId, effect: applied[appliedId] };

      // 레거시 applied_N 인덱스 형식 지원
      if (appliedId.startsWith('applied_')) {
        const index = Number.parseInt(appliedId.replace('applied_', ''), 10);
        const key = Object.keys(applied)[index];
        if (key) return { key, effect: applied[key] };
      }
      return null;
    }

    static _onRollAbility(event, target) {
      event.preventDefault();
      const abilityId = target.closest('[data-ability-id]')?.dataset.abilityId;
      if (!abilityId) return;
      this._showStatRoll('ability', abilityId);
    }

    static _onRollSkill(event, target) {
      event.preventDefault();
      const skillId = target.closest('[data-skill-id]')?.dataset.skillId;
      if (!skillId) return;
      this._showStatRoll('skill', skillId);
    }

    _showStatRoll(targetType, targetId) {
      if (!this._canEdit()) return;
      actorData.showStatRoll(this.document, targetType, targetId);
    }

    // 외부 호출자(combat-ui, action-ui)가 sheet._openComboBuilder를 콜백으로 사용하므로 유지.
    _openComboBuilder(targetType, targetId) {
      return actorData.openComboBuilder(this.document, targetType, targetId);
    }

    static _onCreateSkill(event, target) {
      event.preventDefault();
      if (!this._canEdit()) return;

      const abilityId = target.dataset.abilityId;
      if (!abilityId) return;

      // 다이얼로그 생성은 공유 헬퍼로 위임 (이전 시트 액터 시트와 동일한 경로)
      actorData.openCreateSkillDialog(this.document, abilityId);
    }

    static _onEditSkill(event, target) {
      event.preventDefault();
      if (!this._canEdit()) return;

      const skillId = target.closest('[data-skill-id]')?.dataset.skillId;
      if (!skillId) return;

      // 다이얼로그 생성은 공유 헬퍼로 위임 (이전 시트 액터 시트와 동일한 경로)
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

    // 우클릭 = 편집 연필 버튼과 동일하게 아이템 시트 열기
    _onItemContextMenu(event) {
      // 입력 요소 위에서의 우클릭(붙여넣기 등 기본 메뉴)은 가로채지 않는다
      if (event.target.closest('input, textarea, select, [contenteditable="true"]')) return;
      event.preventDefault();
      if (!this._canEdit()) return;
      const item = this._getItemFromTarget(event.currentTarget);
      if (!item) return;
      // 우클릭 컨텍스트 메뉴: 시트 열기 + (이펙트/무기) 콤보로 조합
      window.DX3rdItemContextMenu?.open(event, { actor: this.document, item, sheet: this });
    }

    // 효과(Applied) 항목 우클릭 = 편집 버튼과 동일하게 효과 편집 UI 를 연다.
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

    static async _onItemToChat(event, target) {
      event.preventDefault();
      const item = this._getItemFromTarget(target);
      if (!item) return;

      // 자기 보정만 있는 이펙트는 적용 메뉴를 열지 않는다. 목록의 활성 체크박스와
      // 같은 상태를 전환해, 지속 AE의 생성/제거 경로를 하나로 유지한다.
      if (actorData.usesSelfEffectActiveToggle?.(item)) {
        if (!this._canEdit()) return;
        await actorData.updateOwnedItemActiveState(this.document, item.id, !item.system?.active?.state);
        return;
      }

      // 능동 아이템은 카드보다 먼저 사용 방식을 고른다.
      // 효과만 적용은 독립 경로이므로 비용·사용 카드 없이 현재 타겟에게만 적용한다.
      if (['weapon', 'vehicle', 'effect'].includes(item.type)) {
        if (typeof window.DX3rdChooseItemMode !== 'function') {
          ui.notifications.error(game.i18n.localize('DX3rd.DialogV2Unavailable'));
          return;
        }
        const mode = await window.DX3rdChooseItemMode(target || event.currentTarget);
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
        if (mode === 'combo' && item.type === 'effect') {
          const skill = item.system?.skill;
          const targetId = skill && skill !== '-' ? skill : '-';
          await window.DX3rdUniversalHandler?.openComboBuilder?.(this.document, 'skill', targetId, null, {
            preselectEffectIds: [item.id]
          });
          return;
        }
        await this._useItemFromTarget(target, undefined, {
          menuAnchor: target || event.currentTarget,
          comboMode: mode
        });
        return;
      }

      // 채팅 출력 게이트(권한 + 소진)는 공유 헬퍼로 위임 (이전 시트 _onItemNameClick 과 동일한 경로)
      const gate = actorData.checkItemChatGate(this.document, item);
      if (!gate.ok) {
        (ui.notifications[gate.level] || ui.notifications.warn).call(ui.notifications, gate.message);
        return;
      }

      await this._sendItemToChat(item);
    }

    // 아이템 설명 인라인 펼침/접기 (이전 시트 _onItemLabelClick 과 동일한 동작)
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

    // 외부(dx3rd-combat-ui / dx3rd-action-ui / dx3rd-macro)가 sheet._sendItemToChat(item)
    // 으로 호출하므로 AppV2 시트에도 동일한 위임자를 둔다(공유 모듈로 위임).
    async _sendItemToChat(item) {
      return window.DX3rdActorChat.sendItemToChat(this.document, item);
    }

    static async _onTitus(event, target) {
      event.preventDefault();
      if (!this._canEdit()) return;
      const item = this._getItemFromTarget(target);
      if (!item) return;
      // 로이스 Titus화는 공유 헬퍼로 위임 (이전 시트 액터 시트와 동일한 경로).
      // 채팅 '사용' 버튼과 일관되게 handleTitus 직접 호출 — handleItemUse 경유의 이중 매크로/추가 비용 회피.
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
      // 공격 굴림 dispatch는 공유 헬퍼로 위임 (V2 default 승격 대비 단일 경로)
      await actorData.attackRoll(this.document, item);
    }

    // 공격 흐름이 없는 아이템의 효과 적용 발동점.
    // 대상 효과와 자기 효과가 함께 있으면 공용 분기에서 어느 효과를 적용할지 고른다.
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
      // 아이템 사용 dispatch는 공유 헬퍼로 위임 (V2 default 승격 대비 단일 경로)
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
      await window.DX3rdActorSheetData.updateOwnedItemUsedState(this.document, item.id, event.currentTarget.value);
    }

    async _onActiveChange(event) {
      if (!this._canEdit()) return;
      const item = this._getItemFromTarget(event.currentTarget);
      if (!item) return;
      await window.DX3rdActorSheetData.updateOwnedItemActiveState(this.document, item.id, event.currentTarget.checked);
    }

    // 효과(Applied) 목록의 활성/비활성 토글: 체크 = 활성.
    // 이 탭은 적용 중인 효과 자체만 제어한다. 토글형 이펙트의 원본 아이템을 끄면
    // 파생 AE가 제거되어 다시 켤 값이 사라지므로, 여기서는 항상 AE.disabled만 변경한다.
    async _onAppliedActiveChange(event) {
      if (!this._canEdit()) return;
      const applied = this._getAppliedFromTarget(event.currentTarget);
      if (!applied) return;
      if (window.DX3rdAppliedEffects?.setDisabled) {
        await window.DX3rdAppliedEffects.setDisabled(this.document, applied.key, !event.currentTarget.checked);
        return;
      }
      ui.notifications.error('DX3rdAppliedEffects를 찾을 수 없습니다.');
    }

    async _onEquipmentChange(event) {
      if (!this._canEdit()) return;
      const item = this._getItemFromTarget(event.currentTarget);
      if (!item) return;
      await window.DX3rdActorSheetData.updateOwnedItemEquipmentState(this.document, item.id, event.currentTarget.checked);
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
        await window.DX3rdActorAppliedDialogs.remove(this.document, applied.key);
        return;
      }
      ui.notifications.error('DX3rdActorAppliedDialogs를 찾을 수 없습니다.');
    }

    _onDragStart(event) {
      const item = this._getItemFromTarget(event.currentTarget);
      if (!item) return;

      // 드래그 데이터 구성은 공유 헬퍼로 위임 (이전 시트 액터 시트와 동일한 경로)
      const dragData = window.DX3rdActorSheetData.buildItemDragData(this.document, item);
      if (!dragData) return;
      event.dataTransfer?.setData('text/plain', JSON.stringify(dragData));
    }

    async _onDrop(event) {
      event.preventDefault();
      event.stopPropagation();
      if (!this._canEdit()) return;

      const raw = this._readTransferText(event.dataTransfer);
      if (!raw) return;

      try {
        const data = JSON.parse(raw);
        // 정렬/외부 드롭 처리는 공유 헬퍼로 위임 (이전 시트 액터 시트와 동일한 경로)
        await window.DX3rdActorSheetData.handleActorItemDrop(this.document, data, event.target);
      } catch (error) {
        console.error('DX3rd | ActorSheetV2 item drop failed:', error);
      }
    }

    _readTransferText(dataTransfer) {
      const reader = dataTransfer?.[['get', 'Data'].join('')];
      return typeof reader === 'function' ? reader.call(dataTransfer, 'text/plain') : '';
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
