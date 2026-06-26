// Book 아이템 시트
(function() {

class DX3rdBookSheet extends window.DX3rdItemSheet {
  /** @override */
  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      template: "systems/dx3rd-emanim/templates/item/book-sheet.html",
      width: 520,
      height: 480
    });
  }

  /** @override */
  async getData(options) {
    let data = await super.getData(options);

    // system.type을 "book"으로 설정 (실제 타입 값)
    if (!data.system.type) {
      data.system.type = "book";
    }
    
    // 표시용 displayType 설정
    data.displayType = "DX3rd.Book";

    // Description 원문을 아이템에서 보강
    if (data.system.description === undefined) {
      data.system.description = this.item.system?.description || "";
    }

    // 기본 시스템 데이터 초기화 (기존 데이터 보존)
    if (!data.system.decipher) data.system.decipher = this.item.system?.decipher || 0;
    if (!data.system.exp) data.system.exp = this.item.system?.exp || 0;
    if (!data.system.equipment) data.system.equipment = this.item.system?.equipment || false;

    // saving 객체 초기화 (기존 데이터 보존)
    if (!data.system.saving) data.system.saving = {};
    data.system.saving.difficulty = this.item.system?.saving?.difficulty || "";
    data.system.saving.value = this.item.system?.saving?.value || 0;


    // macro 초기화 (기존 데이터 보존)
    if (!data.system.macro) data.system.macro = this.item.system?.macro || "";

    // spell ID 목록 초기화 (기존 데이터 보존)
    if (!data.system.spells) data.system.spells = this.item.system?.spells || [];

    // spell 아이템들 초기화 (월드 아이템 + 액터 아이템에서 spell ID 목록으로 참조)
    data.spellItems = [];
    if (data.system.spells.length > 0) {
      
      // 1. 월드 아이템에서 직접 검색
      for (const spellId of data.system.spells) {
        if (game.items) {
          const spell = game.items.get(spellId);
          if (spell && spell.type === 'spell') {
            data.spellItems.push(spell);
          }
        }
      }
      
      // 2. 액터 아이템에서 검색 (아직 찾지 못한 ID들)
      const foundIds = data.spellItems.map(s => s.id);
      const remainingIds = data.system.spells.filter(id => !foundIds.includes(id));
      
      if (remainingIds.length > 0) {
        
        const allActors = game.actors || [];
        for (const actor of allActors) {
          const foundSpells = actor.items.filter(item => 
            item.type === 'spell' && remainingIds.includes(item.id)
          );
          data.spellItems.push(...foundSpells);
          
        }
      }
    }

    // Description 에디터를 위한 데이터 추가 (helpers.js 사용)
    if (window.DX3rdDescriptionManager) {
      data = await window.DX3rdDescriptionManager.enrichSheetData(data, this.item);
    }

    return data;
  }

  /** @override */
  activateListeners(html) {
    super.activateListeners(html);

    // used.disable 변경 시 처리
    html.on('change', 'select[name="system.used.disable"]', this._onUsedDisableChange.bind(this));

    // 술식 이름 클릭 시 해설 토글
    html.on('click', '.spell-toggle', this._onToggleSpellDescription.bind(this));

    // 일반적인 system 필드 변경 시 즉시 저장
    html.on('change', 'input[name^="system."], select[name^="system."], textarea[name^="system."]', (event) => {
      const element = event.currentTarget;
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
    html.on('click', '.spell-create', this._onCreateSpell.bind(this));
    html.on('click', '.item-control.item-delete', this._onDeleteSpell.bind(this));

    // Foundry VTT 드래그 앤 드롭 지원
    html.on('dragover', '.items-list[data-drop-zone="spells"]', this._onDragOver.bind(this));
    html.on('dragleave', '.items-list[data-drop-zone="spells"]', this._onDragLeave.bind(this));
    
    // 드롭 존을 드래그 가능하게 설정
    html.find('.items-list[data-drop-zone="spells"]').each((i, el) => {
      el.setAttribute('data-drop-zone', 'spells');
      el.setAttribute('data-drop-type', 'Item');
    });
    
    // Foundry VTT 드래그 앤 드롭 활성화
    html.find('.items-list[data-drop-zone="spells"]').each((i, el) => {
      $(el).on('dragover', this._onDragOver.bind(this));
      $(el).on('dragleave', this._onDragLeave.bind(this));
      $(el).on('drop', this._onDrop.bind(this));
    });
  }

  /** @override */
  async _updateObject(event, formData) {
    // formData를 expandObject로 변환하여 중첩된 객체 구조로 저장
    const updateData = foundry.utils.expandObject(formData);
    const result = await this.item.update(updateData);
    
    return result;
  }

  // _onUsedDisableChange는 부모 클래스(item-sheet.js)에서 상속됨



  async _onDeleteSpell(event) {
    event.preventDefault();
    const spellId = $(event.currentTarget).data('spell-id');
    
    try {
      // spell ID를 목록에서 제거
      const currentSpells = this.item.system.spells || [];
      const updatedSpells = currentSpells.filter(id => id !== spellId);
      
      await this.item.update({
        "system.spells": updatedSpells
      });
      
      this.render(false);
      ui.notifications.info("스펠이 제거되었습니다.");
    } catch (error) {
      console.error("DX3rd | BookSheet _onDeleteSpell failed", error);
    }
  }

  async _onCreateSpell(event) {
    event.preventDefault();
    
    // 스펠 ID 입력 다이얼로그
    const content = `
      <div class="form-group" style="margin-top: 0.5em; margin-bottom: 0.5em;">
        <label style="white-space: nowrap; margin-right: 5px; display: inline-block;">${game.i18n.localize("DX3rd.SpellID")}</label>
        <input type="text" id="spell-id-input">
      </div>
    `;
    
    const dialog = new Dialog({
      title: game.i18n.localize("DX3rd.AddSpell"),
      content: content,
      buttons: {
        add: {
          icon: '<i class="fas fa-plus"></i>',
          label: game.i18n.localize("DX3rd.Confirm"),
          callback: async (html) => {
            let spellId = html.find('#spell-id-input').val().trim();
            if (!spellId) {
              ui.notifications.warn(game.i18n.localize("DX3rd.EnterSpellID"));
              return;
            }
            
            // Item. 접두사 제거 (Item.OoLGplXALbrjWJmu -> OoLGplXALbrjWJmu)
            if (spellId.startsWith('Item.')) {
              spellId = spellId.substring(5);
            }
            
            // 스펠 ID 유효성 검증 (월드 아이템 + 액터 아이템)
            let foundSpell = null;
            
            // 1. 월드 아이템에서 직접 검색
            if (game.items) {
              foundSpell = game.items.get(spellId);
            }
            
            // 2. 액터 아이템에서 검색 (월드에서 찾지 못한 경우)
            if (!foundSpell) {
              const allActors = game.actors || [];
              for (const actor of allActors) {
                const spell = actor.items.get(spellId);
                if (spell && spell.type === 'spell') {
                  foundSpell = spell;
                  break;
                }
              }
            }
            
            if (!foundSpell) {
              ui.notifications.warn(game.i18n.localize("DX3rd.SpellNotFound"));
              return;
            }
            
            // 현재 마도서의 스펠 목록에 추가
            const currentSpells = this.item.system.spells || [];
            if (!currentSpells.includes(spellId)) {
              const updatedSpells = [...currentSpells, spellId];
              
              await this.item.update({
                "system.spells": updatedSpells
              });
              
              this.render(false);
              ui.notifications.info(`스펠 "${foundSpell.name}"이 추가되었습니다.`);
            } else {
              ui.notifications.warn(game.i18n.localize("DX3rd.SpellAlreadyAdded"));
            }
          }
        },
        cancel: {
          icon: '<i class="fas fa-times"></i>',
          label: game.i18n.localize("DX3rd.Cancel")
        }
      },
      default: "add"
    });
    
    // 다이얼로그 렌더링
    dialog.render(true);
  }

  /**
   * 스펠 삭제
   */
  async _onDeleteSpell(event) {
    event.preventDefault();
    const li = $(event.currentTarget).closest('.item');
    const spellId = li.data('item-id');

    if (!spellId) {
      ui.notifications.warn("삭제할 스펠을 찾을 수 없습니다.");
      return;
    }

    try {
      // 현재 스펠 배열에서 제거
      const currentSpells = this.item.system.spells || [];
      const newSpells = currentSpells.filter(id => id !== spellId);
      
      await this.item.update({
        'system.spells': newSpells
      });

      ui.notifications.info("스펠이 삭제되었습니다.");
      
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
  _onToggleSpellDescription(event) {
    event.preventDefault();
    event.stopPropagation();
    
    const $toggle = $(event.currentTarget);
    const $li = $toggle.closest('.item');
    const $description = $li.find('.spell-description');
    const $icon = $toggle.find('.spell-toggle-icon i');
    
    if ($description.is(':visible')) {
      // 닫기
      $description.slideUp(200);
      $icon.removeClass('fa-chevron-up').addClass('fa-chevron-down');
    } else {
      // 열기
      $description.slideDown(200);
      $icon.removeClass('fa-chevron-down').addClass('fa-chevron-up');
    }
  }

  /**
   * 드래그 오버 처리
   */
  _onDragOver(event) {
    event.preventDefault();
    
    // dataTransfer가 있는 경우에만 dropEffect 설정
    if (event.originalEvent && event.originalEvent.dataTransfer) {
      event.originalEvent.dataTransfer.dropEffect = "copy";
    }
    
    // 드롭 존에 시각적 피드백 추가
    const dropZone = event.currentTarget;
    dropZone.classList.add('drag-over');
  }

  /**
   * 드래그 리브 처리
   */
  _onDragLeave(event) {
    const dropZone = event.currentTarget;
    dropZone.classList.remove('drag-over');
  }

  /**
   * Foundry VTT 드롭 처리 오버라이드
   */
  async _onDrop(event) {
    // 드롭 존 시각적 피드백 제거
    const dropZone = event.currentTarget;
    if (dropZone) {
      dropZone.classList.remove('drag-over');
    }

    try {
      // Foundry VTT 드래그 데이터 가져오기
      let data;
      if (event.originalEvent && event.originalEvent.dataTransfer) {
        const dragData = event.originalEvent.dataTransfer.getData("text/plain");
        data = JSON.parse(dragData);
      } else {
        return;
      }
      
      // 스펠 아이템인지 확인
      if (data.type !== "Item" || !data.uuid) {
        return;
      }

      // UUID에서 아이템 가져오기
      const item = await fromUuid(data.uuid);
      if (!item) {
        ui.notifications.warn("아이템을 찾을 수 없습니다.");
        return;
      }

      // 스펠 타입인지 확인
      if (item.type !== 'spell') {
        ui.notifications.warn("스펠 아이템만 추가할 수 있습니다.");
        return;
      }

      // 현재 스펠 목록에 이미 있는지 확인
      const currentSpells = this.item.system.spells || [];
      if (currentSpells.includes(item.id)) {
        ui.notifications.info("이미 추가된 스펠입니다.");
        return;
      }

      // 스펠 ID 추가
      const newSpells = [...currentSpells, item.id];
      await this.item.update({
        'system.spells': newSpells
      });

      ui.notifications.info(`"${item.name}" 스펠이 추가되었습니다.`);
      this.render(false);

    } catch (error) {
      console.error('DX3rd | BookSheet _onDrop - error', error);
      ui.notifications.error("스펠 추가에 실패했습니다.");
    }
  }

}

// Book 시트 등록 (v13 호환)
const ItemsClass = foundry.documents?.collections?.Items || Items;
ItemsClass.registerSheet('dx3rd-emanim', DX3rdBookSheet, {
  types: ['book'],
  makeDefault: true
});

// 전역 노출
window.DX3rdBookSheet = DX3rdBookSheet;
})();
