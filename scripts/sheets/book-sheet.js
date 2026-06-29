// Book 아이템 시트
(function() {
const compat = window.DX3rdApplicationCompat;
const itemSheetData = window.DX3rdItemSheetData;
const DialogV2 = foundry.applications?.api?.DialogV2;

function prepareBookSystem(item, system) {
  system.description ??= '';
  system.type ??= 'book';
  system.decipher ??= item.system?.decipher ?? 0;
  system.exp ??= item.system?.exp ?? 0;
  system.equipment ??= item.system?.equipment ?? false;
  system.macro ??= item.system?.macro ?? '';
  system.spells ??= item.system?.spells ?? [];
  system.saving ??= {};
  system.saving.difficulty ??= item.system?.saving?.difficulty ?? '';
  system.saving.value ??= item.system?.saving?.value ?? 0;
  return system;
}

function resolveSpellItems(spellIds = []) {
  const spells = [];
  const foundIds = new Set();

  for (const spellId of spellIds) {
    const worldSpell = game.items?.get(spellId);
    if (worldSpell?.type !== 'spell') continue;
    spells.push(worldSpell);
    foundIds.add(spellId);
  }

  for (const actor of game.actors || []) {
    for (const spellId of spellIds) {
      if (foundIds.has(spellId)) continue;
      const spell = actor.items?.get(spellId);
      if (spell?.type !== 'spell') continue;
      spells.push(spell);
      foundIds.add(spellId);
    }
  }

  return spells;
}

function findSpell(spellId) {
  const worldItem = game.items?.get(spellId);
  if (worldItem?.type === 'spell') return worldItem;

  for (const actor of game.actors || []) {
    const spell = actor.items?.get(spellId);
    if (spell?.type === 'spell') return spell;
  }
  return null;
}

function normalizeSpellId(spellId) {
  let normalized = String(spellId || '').trim();
  if (normalized.startsWith('Item.')) normalized = normalized.substring(5);
  return normalized;
}

async function addSpell(bookItem, spell) {
  const currentSpells = bookItem.system.spells || [];
  if (currentSpells.includes(spell.id)) {
    ui.notifications.warn(game.i18n.localize("DX3rd.SpellAlreadyAdded"));
    return false;
  }

  await bookItem.update({
    "system.spells": [...currentSpells, spell.id]
  });

  ui.notifications.info(`스펠 "${spell.name}"이 추가되었습니다.`);
  return true;
}

async function addSpellById(bookItem, spellId) {
  const normalizedId = normalizeSpellId(spellId);
  if (!normalizedId) {
    ui.notifications.warn(game.i18n.localize("DX3rd.EnterSpellID"));
    return false;
  }

  const spell = findSpell(normalizedId);
  if (!spell) {
    ui.notifications.warn(game.i18n.localize("DX3rd.SpellNotFound"));
    return false;
  }

  return addSpell(bookItem, spell);
}

async function removeSpell(bookItem, spellId) {
  await bookItem.update({
    'system.spells': (bookItem.system.spells || []).filter(id => id !== spellId)
  });

  ui.notifications.info("스펠이 삭제되었습니다.");
}

async function resolveDroppedSpell(event) {
  let data;
  try {
    data = JSON.parse(event.dataTransfer?.getData?.('text/plain') || '');
  } catch (error) {
    return {status: 'invalid'};
  }

  if (data.type !== 'Item') return {status: 'unsupported'};
  if (!data.uuid) return {status: 'missingUuid'};

  const item = await fromUuid(data.uuid);
  if (!item) {
    ui.notifications.warn("아이템을 찾을 수 없습니다.");
    return {status: 'notFound'};
  }

  if (item.type !== 'spell') {
    ui.notifications.warn("스펠 아이템만 추가할 수 있습니다.");
    return {status: 'notSpell'};
  }

  return {status: 'ok', spell: item};
}

const bookSheetData = Object.freeze({
  prepareBookSystem,
  resolveSpellItems,
  findSpell,
  normalizeSpellId,
  addSpell,
  addSpellById,
  removeSpell,
  resolveDroppedSpell
});

class DX3rdBookSheet extends window.DX3rdItemSheet {
  /** @override */
  async getData(options) {
    let data = await super.getData(options);

    data.system = bookSheetData.prepareBookSystem(this.item, data.system);

    // 표시용 displayType 설정
    data.displayType = "DX3rd.Book";

    // spell 아이템들 초기화 (월드 아이템 + 액터 아이템에서 spell ID 목록으로 참조)
    data.spellItems = bookSheetData.resolveSpellItems(data.system.spells);

    // Description 에디터를 위한 데이터 추가 (helpers.js 사용)
    data = await itemSheetData.enrichSheetData(this.item, data);

    return data;
  }

  /** @override */
  activateListeners(html) {
    super.activateListeners(html);
    const root = compat.unwrapRoot(html);

    // used.disable 변경 시 처리
    compat.on(root, 'change', 'select[name="system.used.disable"]', this._onUsedDisableChange.bind(this));

    // 술식 이름 클릭 시 해설 토글
    compat.on(root, 'click', '.spell-toggle', this._onToggleSpellDescription.bind(this));

    // 일반적인 system 필드 변경 시 즉시 저장
    compat.on(root, 'change', 'input[name^="system."], select[name^="system."], textarea[name^="system."]', (event) => {
      const element = event.target;
      const name = element.name;
      let value = element.value;

      // 체크박스 처리
      if (element.type === 'checkbox') {
        value = element.checked;
      }

      // 숫자 필드 처리
      if (element.dataset.dtype === 'Number') {
        value = parseInt(value) || 0;
      }
      
      this.item.update({ [name]: value });
    });

    // 스펠 리스트 관리
    compat.on(root, 'click', '.spell-create', this._onCreateSpell.bind(this));
    compat.on(root, 'click', '.item-control.item-delete', this._onDeleteSpell.bind(this));

    // Foundry VTT 드래그 앤 드롭 지원
    compat.on(root, 'dragover', '.items-list[data-drop-zone="spells"]', this._onDragOver.bind(this));
    compat.on(root, 'dragleave', '.items-list[data-drop-zone="spells"]', this._onDragLeave.bind(this));
    
    // 드롭 존을 드래그 가능하게 설정
    for (const el of compat.queryAll(root, '.items-list[data-drop-zone="spells"]')) {
      el.setAttribute('data-drop-zone', 'spells');
      el.setAttribute('data-drop-type', 'Item');
    }
  }

  // _onUsedDisableChange는 부모 클래스(item-sheet.js)에서 상속됨



  async _onCreateSpell(event) {
    event.preventDefault();

    if (!DialogV2?.input) {
      ui.notifications.error('DialogV2를 사용할 수 없습니다.');
      return;
    }

    const result = await DialogV2.input({
      window: {title: game.i18n.localize("DX3rd.AddSpell")},
      content: `
        <div class="form-group" style="margin-top: 0.5em; margin-bottom: 0.5em;">
          <label style="white-space: nowrap; margin-right: 5px; display: inline-block;">${game.i18n.localize("DX3rd.SpellID")}</label>
          <input type="text" name="spellId">
        </div>
      `,
      ok: {
        icon: '<i class="fas fa-plus"></i>',
        label: game.i18n.localize("DX3rd.Confirm")
      }
    });

    const added = await bookSheetData.addSpellById(this.item, result?.spellId);
    if (added) this.render(false);
  }

  /**
   * 스펠 삭제
   */
  async _onDeleteSpell(event, matched) {
    event.preventDefault();
    const li = compat.closest(matched || event.target, '.item', this.element?.[0] || this.element);
    const spellId = li?.dataset.itemId;

    if (!spellId) {
      ui.notifications.warn("삭제할 스펠을 찾을 수 없습니다.");
      return;
    }

    try {
      await bookSheetData.removeSpell(this.item, spellId);
      
      // 시트 다시 렌더링
      this.render(false);
      
    } catch (error) {
      console.error('DX3rd | BookSheet _onDeleteSpell - update failed', error);
      ui.notifications.error("스펠 삭제에 실패했습니다.");
    }
  }

  /**
   * 술식 이름 클릭 시 해설 토글
   */
  _onToggleSpellDescription(event, matched) {
    event.preventDefault();
    event.stopPropagation();
    
    const root = this.element?.[0] || this.element;
    const toggle = matched || event.target;
    const li = compat.closest(toggle, '.item', root);
    const description = compat.query(li, '.spell-description');
    const icon = compat.query(toggle, '.spell-toggle-icon i');
    if (!description) return;

    const isHidden = description.hidden || getComputedStyle(description).display === 'none';
    description.hidden = !isHidden;
    description.style.display = isHidden ? '' : 'none';
    icon?.classList.toggle('fa-chevron-down', !isHidden);
    icon?.classList.toggle('fa-chevron-up', isHidden);
  }

  /**
   * 드래그 오버 처리
   */
  _onDragOver(event, matched) {
    event.preventDefault();
    
    // dataTransfer가 있는 경우에만 dropEffect 설정
    if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
    
    // 드롭 존에 시각적 피드백 추가
    const root = this.element?.[0] || this.element;
    const dropZone = matched || compat.closest(event.target, '.items-list[data-drop-zone="spells"]', root);
    dropZone?.classList.add('drag-over');
  }

  /**
   * 드래그 리브 처리
   */
  _onDragLeave(event, matched) {
    const root = this.element?.[0] || this.element;
    const dropZone = matched || compat.closest(event.target, '.items-list[data-drop-zone="spells"]', root);
    dropZone?.classList.remove('drag-over');
  }

  /**
   * Foundry VTT 드롭 처리 오버라이드
   */
  async _onDrop(event) {
    const root = this.element?.[0] || this.element;
    const dropZone = compat.closest(event.target, '.items-list[data-drop-zone="spells"]', root);
    if (!dropZone) return super._onDrop?.(event);

    // 드롭 존 시각적 피드백 제거
    dropZone.classList.remove('drag-over');

    try {
      const result = await bookSheetData.resolveDroppedSpell(event);
      if (result.status !== 'ok') return;
      await this._addSpell(result.spell);

    } catch (error) {
      console.error('DX3rd | BookSheet _onDrop - error', error);
      ui.notifications.error("스펠 추가에 실패했습니다.");
    }
  }

  async _addSpell(spell) {
    const added = await bookSheetData.addSpell(this.item, spell);
    if (added) this.render(false);
    return added;
  }

}

// Book 시트 등록 (v13 호환)
const ItemsClass = foundry.documents?.collections?.Items || Items;
ItemsClass.registerSheet('dx3rd-emanim', DX3rdBookSheet, {
  types: ['book'],
  makeDefault: true
});

// 전역 노출
window.DX3rdBookSheetData = bookSheetData;
window.DX3rdBookSheet = DX3rdBookSheet;
})();
