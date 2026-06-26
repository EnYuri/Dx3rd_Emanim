/**
 * 마술 폭주 주사위 제거 다이얼로그 (DOM 기반)
 */
class SpellDiceRemoveDialog {
    constructor(allDice, maxRemove, callback, options = {}) {
        this.allDice = allDice;
        this.maxRemove = maxRemove;
        this.callback = callback;
        this.selectedDice = [];
        this.onlyOverflow = !!options.onlyOverflow; // true면 10만 선택 가능
        this.disabledIndices = Array.isArray(options.disabledIndices) ? options.disabledIndices : [];
        this.baseTotal = typeof options.baseTotal === 'number' ? options.baseTotal : null;
        this.cancelled = false;
        this.dialogWindow = null;
    }

    /**
     * 다이얼로그 표시
     */
    render() {
        // 기존 다이얼로그 제거
        const existing = document.querySelector('.spell-dice-remove-dialog');
        if (existing) {
            existing.remove();
        }

        // 타이틀 결정
        const title = game.i18n.localize(this.onlyOverflow ? "DX3rd.Angel" : "DX3rd.Eibon");

        // DOM 윈도우 생성
        this.dialogWindow = document.createElement('div');
        this.dialogWindow.className = 'spell-dice-remove-dialog';
        
        // 주사위 그리드 HTML 생성
        const diceGridHTML = this.allDice.map((value, index) => {
            const isOverflow = value === 10;
            const isDisabled = this.disabledIndices.includes(index);
            const disabledClass = isDisabled ? 'disabled' : '';
            const overflowClass = isOverflow ? 'overflow-dice' : '';
            return `
                <div class="spell-dice-item ${overflowClass} ${disabledClass}" 
                     data-dice-index="${index}" 
                     data-dice-value="${value}">
                    <span class="spell-dice-face">${value}</span>
                </div>
            `;
        }).join('');

        this.dialogWindow.innerHTML = `
            <div class="spell-dice-remove-header" style="cursor: move;">
                <h3>${title}</h3>
            </div>
            <div class="spell-dice-remove-content">
                <div class="spell-dice-selection">
                    ${diceGridHTML}
                </div>
                <div class="spell-dice-selection-summary">
                    <p>${game.i18n.localize("DX3rd.SpellDiceTotal")}: <span id="spellCurrentTotal">0</span></p>
                    <p>${game.i18n.localize("DX3rd.SpellDiceSelected")}: <span id="spellSelectedCount">0</span>개 / ${this.maxRemove}개</p>
                    <p>${game.i18n.localize("DX3rd.SpellDicePreviewTotal")}: <span id="spellPreviewTotal">0</span></p>
                </div>
                <div class="spell-dice-remove-buttons">
                    <button class="spell-dice-confirm-button" disabled>
                        ${game.i18n.localize("DX3rd.Confirm")}
                    </button>
                </div>
            </div>
        `;

        document.body.appendChild(this.dialogWindow);

        // 이벤트 설정
        this.setupEvents();

        // 드래그 설정
        this.setupDragging();

        // 초기 상태 업데이트
        this.updateSelectionDisplay();
        this.updateTotals();

        // 애니메이션
        setTimeout(() => {
            this.dialogWindow.classList.add('spell-dice-remove-dialog-open');
        }, 10);
    }

    /**
     * 이벤트 설정
     */
    setupEvents() {
        const $window = $(this.dialogWindow);

        // 주사위 클릭 이벤트
        $window.find('.spell-dice-item').on('click', (event) => {
            const diceElement = event.currentTarget;
            this.toggleDiceSelection(diceElement);
        });

        // 확인 버튼 클릭
        $window.find('.spell-dice-confirm-button').on('click', (event) => {
            event.preventDefault();
            this.confirmSelection();
        });

        // ESC 키 차단
        $(document).on('keydown.spellDiceDialog', (event) => {
            if (event.key === 'Escape' && this.dialogWindow) {
                event.preventDefault();
                event.stopPropagation();
                return false;
            }
        });
    }

    /**
     * 드래그 설정
     */
    setupDragging() {
        const header = this.dialogWindow.querySelector('.spell-dice-remove-header');
        let isDragging = false;
        let currentX = 0;
        let currentY = 0;
        let initialX = 0;
        let initialY = 0;

        header.addEventListener('mousedown', (e) => {
            isDragging = true;
            const rect = this.dialogWindow.getBoundingClientRect();
            initialX = e.clientX - rect.left;
            initialY = e.clientY - rect.top;
            this.dialogWindow.style.transition = 'none';
        });

        document.addEventListener('mousemove', (e) => {
            if (!isDragging) return;
            e.preventDefault();
            currentX = e.clientX - initialX;
            currentY = e.clientY - initialY;
            this.dialogWindow.style.left = `${currentX}px`;
            this.dialogWindow.style.top = `${currentY}px`;
            this.dialogWindow.style.transform = 'none';
        });

        document.addEventListener('mouseup', () => {
            if (isDragging) {
                isDragging = false;
                this.dialogWindow.style.transition = '';
            }
        });
    }

    /**
     * 주사위 선택 토글
     */
    toggleDiceSelection(diceElement) {
        const diceIndex = parseInt(diceElement.dataset.diceIndex);
        const isSelected = diceElement.classList.contains('selected');
        const isDisabled = diceElement.classList.contains('disabled');
        if (isDisabled) return; // 선택 불가
        
        if (this.onlyOverflow && diceElement.dataset.diceValue !== '10') {
            // 10만 선택 가능
            ui.notifications.warn(game.i18n.localize("DX3rd.OnlyOverflowSelectable"));
            return;
        } else if (isSelected) {
            // 선택 해제
            diceElement.classList.remove('selected');
            const index = this.selectedDice.indexOf(diceIndex);
            if (index > -1) {
                this.selectedDice.splice(index, 1);
            }
        } else {
            // 선택 추가
            if (this.selectedDice.length >= this.maxRemove) {
                ui.notifications.warn(game.i18n.format("DX3rd.MaxRemoveExceeded", { max: this.maxRemove }));
                return;
            }
            diceElement.classList.add('selected');
            this.selectedDice.push(diceIndex);
        }

        this.updateSelectionDisplay();
        this.updateTotals();
    }

    /**
     * 선택 상태 표시 업데이트
     */
    updateSelectionDisplay() {
        const selectedCount = this.selectedDice.length;
        const $window = $(this.dialogWindow);
        $window.find('#spellSelectedCount').text(selectedCount);
        
        const confirmButton = $window.find('.spell-dice-confirm-button');
        if (this.onlyOverflow) {
            // a 제거식: 선택하지 않아도 확인 가능, 단 선택 시 최대 1개
            confirmButton.prop('disabled', selectedCount > this.maxRemove);
        } else {
            // n개 제거식: 정확히 지정한 개수만 가능
            confirmButton.prop('disabled', selectedCount !== this.maxRemove);
        }
    }

    /**
     * 합계 업데이트
     */
    updateTotals() {
        const $window = $(this.dialogWindow);
        const total = (this.baseTotal ?? this.allDice.reduce((s, v) => s + v, 0));
        $window.find('#spellCurrentTotal').text(total);
        const removedSum = this.selectedDice.reduce((s, idx) => s + this.allDice[idx], 0);
        $window.find('#spellPreviewTotal').text(total - removedSum);
    }

    /**
     * 선택 확인
     */
    confirmSelection() {
        if (this.onlyOverflow && this.selectedDice.length === 0) {
            // a 제거식에서 선택 없으면 제거하지 않고 종료
            this.cancelled = true;
            this.callback(null);
            this.close();
            return;
        }

        if (!this.onlyOverflow && this.selectedDice.length !== this.maxRemove) {
            ui.notifications.warn(game.i18n.format("DX3rd.SelectExactCount", { count: this.maxRemove }));
            return;
        }

        this.callback(this.selectedDice);
        this.close();
    }

    /**
     * 다이얼로그 닫기
     */
    close() {
        if (this.dialogWindow) {
            this.dialogWindow.classList.remove('spell-dice-remove-dialog-open');
            setTimeout(() => {
                if (this.dialogWindow) {
                    this.dialogWindow.remove();
                    this.dialogWindow = null;
                }
            }, 200);
        }
        $(document).off('keydown.spellDiceDialog');
    }
}

// 전역 객체에 등록
window.SpellDiceRemoveDialog = SpellDiceRemoveDialog;
