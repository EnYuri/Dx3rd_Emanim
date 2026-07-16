// Book 아이템 핸들러
(function() {
const DialogV2 = foundry.applications?.api?.DialogV2;

function getRoot(element) {
    return element?.[0] || element;
}

window.DX3rdBookHandler = {
    /**
     * Spell 선택 다이얼로그 표시
     * @param {Actor} actor - 액터
     * @param {Item} book - Book 아이템
     */
    async showSpellSelectionDialog(actor, book) {
        // Book에 등록된 spell 목록 가져오기
        const spellIds = book.system?.spells || [];
        if (!Array.isArray(spellIds) || spellIds.length === 0) {
            ui.notifications.warn('이 마도서에는 술식이 등록되어 있지 않습니다.');
            return;
        }
        
        // Spell 아이템 데이터 수집
        const spells = [];
        const actorSpellNames = actor.items.filter(i => i.type === 'spell').map(i => i.name);
        
        for (const spellId of spellIds) {
            const spell = game.items.get(spellId);
            if (spell && spell.type === 'spell') {
                const spelltype = spell.system?.spelltype || '-';
                const alreadyOwned = actorSpellNames.includes(spell.name);
                
                spells.push({
                    id: spell.id,
                    name: spell.name,
                    type: spelltype !== '-' ? `DX3rd.${spelltype}` : '-',
                    invoke: spell.system?.invoke?.value || '-',
                    encroach: spell.system?.encroach?.value || 0,
                    alreadyOwned: alreadyOwned
                });
            }
        }
        
        if (spells.length === 0) {
            ui.notifications.warn('유효한 술식을 찾을 수 없습니다.');
            return;
        }
        
        if (!DialogV2?.wait) {
            ui.notifications.error(game.i18n.localize('DX3rd.DialogV2Unavailable'));
            return;
        }

        // 다이얼로그 렌더링
        const content = await foundry.applications.handlebars.renderTemplate('systems/dx3rd-emanim/templates/dialog/spell-selection-dialog.html', {
            spells: spells
        });

        const selectedSpellId = await DialogV2.wait({
            window: {
                title: `${game.i18n.localize('DX3rd.Spell')} ${game.i18n.localize('DX3rd.SelectItem')}`
            },
            classes: ['dx3rd-emanim', 'spell-selection-dialog'],
            position: { width: 600 },
            content,
            rejectClose: false,
            buttons: [
                {
                    action: 'confirm',
                    icon: '<i class="fas fa-check"></i>',
                    label: game.i18n.localize('DX3rd.Confirm'),
                    default: true,
                    callback: (event, button) => {
                        const selected = button.form?.querySelector('input[name="selected-spell"]:checked');
                        if (!selected?.value) ui.notifications.warn('술식을 선택해주세요.');
                        return selected?.value || null;
                    }
                },
                {
                    action: 'cancel',
                    icon: '<i class="fas fa-times"></i>',
                    label: game.i18n.localize('DX3rd.Cancel'),
                    callback: () => null
                }
            ],
            render: (event, dialog) => {
                const root = getRoot(dialog.element);
                if (!root) return;

                // 행 클릭 시 라디오 버튼 선택
                root.addEventListener('click', (clickEvent) => {
                    const row = clickEvent.target.closest('.spell-row');
                    if (!row || !root.contains(row)) return;

                    // 이미 보유한 술식은 클릭 무시
                    if (row.classList.contains('already-owned')) return;

                    // 라디오 버튼을 직접 클릭한 경우는 중복 처리 방지
                    if (clickEvent.target.type === 'radio') return;

                    const radio = row.querySelector('input[type="radio"]');
                    if (!radio || radio.disabled) return;
                    radio.checked = true;

                    // 모든 행의 스타일 초기화
                    for (const spellRow of root.querySelectorAll('.spell-row')) {
                        spellRow.classList.remove('selected');
                    }

                    // 선택된 행 강조
                    row.classList.add('selected');
                });
            }
        });

        if (!selectedSpellId) return;

        const selectedSpell = game.items.get(selectedSpellId);
        if (!selectedSpell) {
            ui.notifications.error('선택한 술식을 찾을 수 없습니다.');
            return;
        }

        // 이미 보유한 술식인지 체크
        const alreadyOwned = actor.items.some(i => i.type === 'spell' && i.name === selectedSpell.name);
        if (alreadyOwned) {
            ui.notifications.warn(`${selectedSpell.name} 술식은 이미 보유하고 있습니다.`);
            return;
        }

        // 액터에게 Spell 아이템 추가 (복사)
        const spellData = selectedSpell.toObject();
        await actor.createEmbeddedDocuments('Item', [spellData]);

        // 성공 메시지
        ui.notifications.info(`${selectedSpell.name} 술식을 획득했습니다.`);

        // 채팅 메시지
        await ChatMessage.create({
            content: `${selectedSpell.name} ${game.i18n.localize('DX3rd.Spell')} ${game.i18n.localize('DX3rd.Acquired')}`,
            speaker: ChatMessage.getSpeaker({ actor: actor }),
        });
    },
    
    async handle(actorId, itemId, getTarget, options = {}) {
        const actor = game.actors.get(actorId);
        if (!actor) {
            ui.notifications.warn("Actor not found");
            return;
        }
        
        const item = actor.items.get(itemId);
        if (!item) {
            ui.notifications.warn("Item not found");
            return;
        }
        
        // 북 아이템은 항상 cthulhu 스킬 체크
        const cthulhuSkill = actor.system?.attributes?.skills?.cthulhu;
        if (!cthulhuSkill) {
            ui.notifications.warn("Cthulhu 스킬을 찾을 수 없습니다.");
            return;
        }
        
        // 토큰 자동 선택
        let previousToken = canvas.tokens.controlled[0];
        const actorTokens = canvas.tokens.placeables.filter(t => t.actor?.id === actorId);
        if (actorTokens.length > 0 && (!previousToken || previousToken.actor?.id !== actorId)) {
            previousToken = canvas.tokens.controlled[0];
            actorTokens[0].control({ releaseOthers: true });
        }
        
        let useCombo = false;
        if (options.comboMode !== 'normal') {
            if (typeof window.DX3rdChooseRollMode !== 'function') {
                ui.notifications.error(game.i18n.localize('DX3rd.DialogV2Unavailable'));
                return;
            }
            useCombo = await window.DX3rdChooseRollMode();
        }

        if (useCombo === null) return;

        if (useCombo) {
            // 콤보 빌더 열기 (cthulhu 스킬, book 아이템 전달)
            if (window.DX3rdUniversalHandler && window.DX3rdUniversalHandler.openComboBuilder) {
                // 난이도 데이터 생성 (book의 decipher 값 사용)
                const difficultyValue = item.system?.decipher || 0;
                const predefinedDifficulty = difficultyValue > 0
                    ? { type: 'number', value: difficultyValue }
                    : null;

                await window.DX3rdUniversalHandler.openComboBuilder(
                    actor,
                    'skill',
                    'cthulhu',
                    item,
                    {
                        // 마도서 해독 콤보라는 정보를 넘겨서 이후 판정 다이얼로그에서 난이도/원본 북 정보를 복원
                        isBookDecipher: true,
                        originalItem: item,
                        predefinedDifficulty
                    }
                );
            }
            // 이전 토큰 복원
            if (previousToken && canvas.tokens) {
                previousToken.control({ releaseOthers: true });
            }
        } else {
            // 바로 cthulhu 스킬 체크 (난이도는 book의 system.decipher)
            if (window.DX3rdUniversalHandler && window.DX3rdUniversalHandler.showStatRollDialog) {
                const skillName = cthulhuSkill.name?.startsWith('DX3rd.')
                    ? game.i18n.localize(cthulhuSkill.name)
                    : cthulhuSkill.name;

                // 난이도 데이터 생성 (book의 decipher 값 사용)
                const difficultyValue = item.system?.decipher || 0;
                const predefinedDifficulty = difficultyValue > 0
                    ? { type: 'number', value: difficultyValue }
                    : null;

                window.DX3rdUniversalHandler.showStatRollDialog(
                    actor,
                    cthulhuSkill,
                    skillName,
                    'major',
                    item,
                    previousToken,
                    null, // weaponBonus
                    null, // comboAfterSuccessData
                    null, // comboAfterDamageData
                    predefinedDifficulty // 미리 정의된 난이도 전달 (마지막 매개변수)
                );
            }
        }
    }
};
})();
