// DX3rd Action UI - 전투 유무와 상관없이 토큰 선택 시 액션 버튼 표시
(function () {

    const MODULE_ID = 'dx3rd-emanim';

    // v13/v14 호환: PIXI FederatedEvent (v8) vs InteractionEvent (v7) 추상화
    function getEventButton(pixiEvent) {
        return pixiEvent.button ?? pixiEvent.data?.button ?? -1;
    }
    
    // 액션 UI 컨테이너
    let actionUIContainer = null;
    let subActionUIContainer = null;
    let currentToken = null;
    let actionUIUpdateInterval = null;
    let actionUIVisible = false;
    let lastWheelClickTime = 0; // 마지막 휠 클릭 시간
    let wheelClickHandler = null; // 마우스 휠 클릭 핸들러 (중복 등록 방지용)
    
    // 장면별 액션 UI 활성화 상태 저장
    const sceneActionUIStates = {};
    
    /**
     * 현재 장면의 액션 UI 활성화 상태 가져오기
     */
    function getSceneActionUIState() {
        const sceneId = canvas.scene?.id;
        if (!sceneId) return false;
        
        if (!sceneActionUIStates[sceneId]) {
            sceneActionUIStates[sceneId] = false; // 기본값: 비활성화
        }
        
        return sceneActionUIStates[sceneId];
    }
    
    /**
     * 현재 장면의 액션 UI 활성화 상태 저장
     */
    function setSceneActionUIState(enabled) {
        const sceneId = canvas.scene?.id;
        if (!sceneId) return;
        
        sceneActionUIStates[sceneId] = enabled;
    }

    /**
     * scene-navigation 숨기기
     */
    function hideSceneNavigation() {
        const sceneNavigation = document.getElementById('scene-navigation');
        if (sceneNavigation) {
            sceneNavigation.style.display = 'none';
        }
    }
    
    /**
     * scene-navigation 복원
     */
    function restoreSceneNavigation() {
        const sceneNavigation = document.getElementById('scene-navigation');
        if (sceneNavigation) {
            sceneNavigation.style.display = '';
        }
    }

    /**
     * 토큰 선택 시 처리
     */
    Hooks.on('controlToken', (token, controlled) => {
        
        if (controlled) {
            // 토큰이 선택되었을 때
            // 다른 토큰이 선택되면 이전 액션 UI 제거
            if (currentToken && currentToken.id !== token.id) {
                removeActionUI();
                actionUIVisible = false;
            }
            
            currentToken = token;
            actionUIVisible = false; // 액션 UI는 숨김 상태로 시작
            
            // 액션 UI 활성화 상태 확인 후 표시
            const isEnabled = getSceneActionUIState();
            if (isEnabled) {
                // scene-navigation 숨기기
                hideSceneNavigation();
                
                setTimeout(() => {
                    // 토큰이 여전히 선택되어 있는지 확인
                    if (currentToken && currentToken.id === token.id) {
                        openActionUI();
                    }
                }, 100);
            }
        } else {
            // 토큰 선택이 해제되었을 때
            if (currentToken?.id === token.id) {
                removeActionUI();
                currentToken = null;
                actionUIVisible = false;
                // scene-navigation 복원
                restoreSceneNavigation();
            }
        }
    });

    /**
     * 액터의 능력치와 스킬 데이터 가져오기
     */
    function getActorSkills(actor) {
        if (!actor || !actor.system) return { abilities: {}, skills: {} };
        
        const abilities = {
            body: actor.system.attributes.body,
            sense: actor.system.attributes.sense,
            mind: actor.system.attributes.mind,
            social: actor.system.attributes.social
        };
        
        const skills = actor.system.attributes.skills || {};
        
        // 커스텀 스킬 이름 설정 가져오기
        const customSkills = game.settings.get('dx3rd-emanim', 'customSkills') || {};
        
        return { abilities, skills, customSkills };
    }

    /**
     * 스킬 표시 이름 가져오기
     */
    function getSkillDisplayName(skillKey, actor) {
        if (!skillKey || skillKey === '-') return '-';
        
        // 액터의 스킬에서 찾기
        if (actor) {
            const skill = actor.system?.attributes?.skills?.[skillKey];
            if (skill) {
                // 스킬 이름이 DX3rd.로 시작하면 커스텀 이름 또는 로컬라이징
                if (skill.name && skill.name.startsWith('DX3rd.')) {
                    // customSkills 설정 확인
                    const customSkills = game.settings.get("dx3rd-emanim", "customSkills") || {};
                    const customSkill = customSkills[skillKey];
                    
                    if (customSkill) {
                        // 커스텀 이름이 있으면 우선 사용
                        return typeof customSkill === 'object' ? customSkill.name : customSkill;
                    } else {
                        // 커스텀 이름이 없으면 기본 로컬라이징
                        return game.i18n.localize(skill.name);
                    }
                }
                return skill.name || skillKey;
            }
        }
        
        // 스킬이 없으면 기본 속성 체크
        const attributes = ['body', 'sense', 'mind', 'social'];
        if (attributes.includes(skillKey)) {
            return game.i18n.localize(`DX3rd.${skillKey.charAt(0).toUpperCase() + skillKey.slice(1)}`);
        }
        
        // DX3rd. 접두사가 있는 스킬 키인 경우 로컬라이징 시도
        if (skillKey.startsWith('DX3rd.')) {
            return game.i18n.localize(skillKey);
        }
        
        return skillKey;
    }

    /**
     * 스킬 패널 HTML 생성
     */
    function generateSkillPanelHTML(abilities, skills, customSkills, fontStyle, actor) {
        // 액터 시트와 동일한 고정 순서
        const fixedOrder = {
            body: ["melee", "evade"],
            sense: ["ranged", "perception"],
            mind: ["rc", "will", "cthulhu"],
            social: ["negotiation", "procure"]
        };
        
        // 액터에 실제로 존재하는 스킬들
        const actorSkills = actor?.system?.attributes?.skills || {};
        
        // 각 능력치별로 커스텀 스킬 찾기 (고정 순서에 없는 스킬들)
        const customSkillsByAbility = {};
        ['body', 'sense', 'mind', 'social'].forEach(ability => {
            const fixedSkills = fixedOrder[ability] || [];
            customSkillsByAbility[ability] = Object.keys(actorSkills).filter(key => {
                const skill = actorSkills[key];
                return skill && 
                       skill.base === ability && 
                       !fixedSkills.includes(key) &&
                       !['body', 'sense', 'mind', 'social'].includes(key);
            });
        });
        
        
        let html = '<div class="dx3rd-sub-action-ui-skill-panel" style="display: none;">';
        
        // 첫 번째 행: 기본 능력치
        html += '<div class="dx3rd-sub-action-ui-skill-row">';
        ['body', 'sense', 'mind', 'social'].forEach(skillKey => {
            const displayName = getSkillDisplayName(skillKey, actor);
            html += `<button class="dx3rd-sub-action-ui-skill-btn" data-skill="${skillKey}" style="${fontStyle}">${displayName}</button>`;
        });
        html += '</div>';
        
        // 각 능력치별로 스킬들을 수집
        const skillsByAbility = {};
        ['body', 'sense', 'mind', 'social'].forEach(ability => {
            const fixedSkills = fixedOrder[ability] || [];
            const customSkills = customSkillsByAbility[ability] || [];
            
            // 고정 스킬들 추가
            const availableFixedSkills = fixedSkills.filter(skillKey => 
                actorSkills[skillKey] && actorSkills[skillKey].base === ability
            );
            
            // 커스텀 스킬들 추가
            skillsByAbility[ability] = [...availableFixedSkills, ...customSkills];
        });
        
        
        // 최대 행 수 계산 (가장 많은 스킬을 가진 능력치 기준)
        const maxRows = Math.max(...Object.values(skillsByAbility).map(skills => skills.length));
        
        // 각 행별로 버튼 생성 (정확히 4개씩)
        for (let rowIndex = 0; rowIndex < maxRows; rowIndex++) {
            html += '<div class="dx3rd-sub-action-ui-skill-row">';
            
            ['body', 'sense', 'mind', 'social'].forEach(ability => {
                const skills = skillsByAbility[ability];
                const skill = skills[rowIndex];
                
                if (skill) {
                    const displayName = getSkillDisplayName(skill, actor);
                    html += `<button class="dx3rd-sub-action-ui-skill-btn" data-skill="${skill}" style="${fontStyle}">${displayName}</button>`;
                } else {
                    // 빈 공간을 위한 투명한 버튼 (레이아웃 유지)
                    html += `<div class="dx3rd-sub-action-ui-skill-btn" style="visibility: hidden; ${fontStyle}"></div>`;
                }
            });
            
            html += '</div>';
        }
        
        html += '</div>';
        return html;
    }

    /**
     * 액션 UI 생성
     */
    function createActionUI(token) {
        
        // 기존 액션 UI 제거
        removeActionUI();
        
        // interface 영역 찾기
        const interfaceElement = document.getElementById('interface');
        
        if (!interfaceElement) {
            console.warn('DX3rd | interface not found');
            return;
        }
        
        // UI 버튼 폰트 설정 가져오기 (설정이 등록되지 않았을 수 있으므로 안전하게 처리)
        let uiButtonFont = '';
        try {
            uiButtonFont = game.settings.get('dx3rd-emanim', 'uiButtonFont') || '';
        } catch (e) {
            // 설정이 아직 등록되지 않았으면 빈 문자열 사용
            uiButtonFont = '';
        }
        const fontStyle = uiButtonFont ? `font-family: "${uiButtonFont}" !important;` : '';
        
        // 액터 타입 확인
        const actorType = token.actor?.system?.actorType || 'NPC';
        const isPlayerCharacter = actorType === 'PlayerCharacter';
        
        // 아이템 존재 여부 확인
        const actor = token.actor;
        const hasCombo = actor.items.some(item => item.type === 'combo');
        const hasEffect = actor.items.some(item => item.type === 'effect');
        const hasPsionic = actor.items.some(item => item.type === 'psionic');
        const hasSpell = actor.items.some(item => item.type === 'spell');
        
        const itemTypes = ['weapon', 'protect', 'vehicle', 'book', 'connection', 'etc', 'once'];
        const hasItem = itemTypes.some(type => actor.items.some(item => item.type === type));
        
        const hasRois = actor.items.some(item => 
            item.type === 'rois' && item.system?.type !== 'M'
        );
        
        // 백트랙 버튼 HTML (PlayerCharacter일 때만 표시)
        const backtrackButtonHTML = isPlayerCharacter ? `
            <button class="dx3rd-action-ui-btn" data-action="backtrack" style="${fontStyle}">
                ${game.i18n.localize('DX3rd.BackTrack')}
            </button>
        ` : '';
        
        // 조건부 버튼 HTML
        const comboButtonHTML = hasCombo ? `
            <button class="dx3rd-action-ui-btn" data-action="combo" style="${fontStyle}">
                ${game.i18n.localize('DX3rd.Combo')}
            </button>
        ` : '';
        
        const effectButtonHTML = hasEffect ? `
            <button class="dx3rd-action-ui-btn" data-action="effect" style="${fontStyle}">
                ${game.i18n.localize('DX3rd.Effect')}
            </button>
        ` : '';
        
        const psionicButtonHTML = hasPsionic ? `
            <button class="dx3rd-action-ui-btn" data-action="psionic" style="${fontStyle}">
                ${game.i18n.localize('DX3rd.Psionic')}
            </button>
        ` : '';
        
        const spellButtonHTML = hasSpell ? `
            <button class="dx3rd-action-ui-btn" data-action="spell" style="${fontStyle}">
                ${game.i18n.localize('DX3rd.Spell')}
            </button>
        ` : '';
        
        const itemButtonHTML = hasItem ? `
            <button class="dx3rd-action-ui-btn" data-action="item" style="${fontStyle}">
                ${game.i18n.localize('DX3rd.Item')}
            </button>
        ` : '';
        
        const roisButtonHTML = hasRois ? `
            <button class="dx3rd-action-ui-btn" data-action="rois" style="${fontStyle}">
                ${game.i18n.localize('DX3rd.Rois')}
            </button>
        ` : '';
        
        // 메인 액션 UI 컨테이너 생성
        actionUIContainer = document.createElement('div');
        actionUIContainer.className = 'dx3rd-action-ui';
        actionUIContainer.innerHTML = `
            <div class="dx3rd-action-ui-header">
                <h3 class="dx3rd-action-ui-title" style="${fontStyle}">${token.actor?.name || 'Unknown Actor'}</h3>
            </div>
            <div class="dx3rd-action-ui-buttons">
                <button class="dx3rd-action-ui-btn" data-action="test" style="${fontStyle}">
                    ${game.i18n.localize('DX3rd.Test')}
                </button>
                ${comboButtonHTML}
                ${effectButtonHTML}
                ${psionicButtonHTML}
                ${spellButtonHTML}
                ${itemButtonHTML}
                <button class="dx3rd-action-ui-btn" data-action="condition" style="${fontStyle}">
                    ${game.i18n.localize('DX3rd.Condition')}
                </button>
                ${roisButtonHTML}
                ${backtrackButtonHTML}
            </div>
        `;
        
        // 액터 데이터 가져오기
        const actorData = getActorSkills(token.actor);
        const { abilities, skills, customSkills } = actorData;
        
        // 서브 액션 UI 컨테이너 생성 (빈 상태로 시작)
        subActionUIContainer = document.createElement('div');
        subActionUIContainer.className = 'dx3rd-sub-action-ui';
        subActionUIContainer.innerHTML = ''; // 빈 상태로 시작
        
        // interface 영역에 추가
        interfaceElement.appendChild(actionUIContainer);
        interfaceElement.appendChild(subActionUIContainer);
        
        // 이벤트 설정
        setupActionUIEvents(actionUIContainer);
        
        // 폰트 직접 적용 (인라인 스타일이 작동하지 않을 경우를 대비)
        if (uiButtonFont) {
            // 메인 버튼들에 폰트 적용
            const buttons = actionUIContainer.querySelectorAll('.dx3rd-action-ui-btn');
            buttons.forEach(button => {
                button.style.setProperty('font-family', `"${uiButtonFont}"`, 'important');
            });
            
            // 서브 액션 스킬 버튼들에 폰트 적용
            const subSkillButtons = subActionUIContainer.querySelectorAll('.dx3rd-sub-action-ui-skill-btn');
            subSkillButtons.forEach(button => {
                button.style.setProperty('font-family', `"${uiButtonFont}"`, 'important');
            });
            
            // 제목에도 폰트 적용
            const title = actionUIContainer.querySelector('.dx3rd-action-ui-title');
            if (title) {
                title.style.setProperty('font-family', `"${uiButtonFont}"`, 'important');
            }
        }
        
        // 애니메이션
        setTimeout(() => {
            actionUIContainer.classList.add('dx3rd-action-ui-open');
            subActionUIContainer.classList.add('dx3rd-action-ui-open');
        }, 10);
        
        actionUIVisible = true;
    }


    /**
     * UI 사운드 재생
     */
    function playUISound(soundType) {
        try {
            let soundPath = '';
            if (soundType === 'hover') {
                soundPath = game.settings.get('dx3rd-emanim', 'uiButtonHoverSound') || '';
            } else if (soundType === 'click') {
                soundPath = game.settings.get('dx3rd-emanim', 'uiButtonClickSound') || '';
            }
            
            if (soundPath) {
                const volume = game.settings.get('dx3rd-emanim', 'uiButtonSoundVolume') || 1.0;
                AudioHelper.play({ src: soundPath, volume: volume, loop: false }, false);
            }
        } catch (e) {
            // 설정이 없거나 오류가 발생하면 조용히 무시
        }
    }

    /**
     * 액션 UI 이벤트 설정
     */
    function setupActionUIEvents(container) {
        const $container = $(container);
        
        // 액션 버튼들
        $container.find('.dx3rd-action-ui-btn').on('click', (event) => {
            const $btn = $(event.currentTarget);
            const action = $btn.data('action');
            
            // 클릭 사운드 재생
            playUISound('click');
            
            handleActionClick(action);
        }).on('mouseenter', () => {
            // 호버 사운드 재생
            playUISound('hover');
        });
        
    }

    /**
     * 서브 액션 UI 이벤트 설정
     */
    function setupSubActionUIEvents(container) {
        const $container = $(container);
        
        // 서브 스킬 버튼들
        $container.find('.dx3rd-sub-action-ui-skill-btn').on('click', (event) => {
            const $btn = $(event.currentTarget);
            const skill = $btn.data('skill');
            
            // 클릭 사운드 재생
            playUISound('click');
            
            handleSkillClick(skill);
        }).on('mouseenter', () => {
            // 호버 사운드 재생
            playUISound('hover');
        });
    }

    /**
     * 액션 클릭 처리
     */
    function handleActionClick(action) {
        // 현재 선택된 토큰을 다시 확인 (동기화 문제 방지)
        const controlledTokens = canvas.tokens?.controlled || [];
        const activeToken = controlledTokens.length > 0 ? controlledTokens[0] : null;
        
        // currentToken과 실제 선택된 토큰이 다르면 동기화
        if (activeToken && activeToken !== currentToken) {
            currentToken = activeToken;
        }
        
        // 토큰이 없거나 액터가 없으면 경고
        if (!currentToken || !currentToken.actor) {
            // currentToken이 null이면 activeToken도 확인
            if (!activeToken || !activeToken.actor) {
                ui.notifications.warn(game.i18n.localize('DX3rd.NoActorForToken'));
                return;
            }
            // activeToken이 있으면 사용
            currentToken = activeToken;
        }
        
        const actor = currentToken.actor;
        
        // 현재 열린 서브 패널 확인
        const currentSubPanel = getCurrentSubPanel();
        
        // 같은 액션을 다시 클릭하면 서브 패널 토글
        if (currentSubPanel === action) {
            hideAllSubPanels();
            return;
        }
        
        // 다른 액션을 클릭하면 기존 서브 패널 숨기고 새 패널 표시
        hideAllSubPanels();
        
        switch (action) {
            case 'test':
                handleTestAction(actor);
                break;
            case 'combo':
                handleComboAction(actor);
                break;
            case 'effect':
                handleEffectAction(actor);
                break;
            case 'psionic':
                handlePsionicAction(actor);
                break;
            case 'spell':
                handleSpellAction(actor);
                break;
            case 'item':
                handleItemAction(actor);
                break;
            case 'condition':
                handleConditionAction(actor);
                break;
            case 'rois':
                handleRoisAction(actor);
                break;
            case 'backtrack':
                handleBacktrackAction(actor);
                break;
            default:
                console.warn('DX3rd | Unknown action:', action);
        }
    }

    /**
     * 현재 열린 서브 패널 확인
     */
    function getCurrentSubPanel() {
        if (!subActionUIContainer) return null;
        
        // 실제로 표시되고 있는 패널만 확인
        const skillPanel = subActionUIContainer.querySelector('.dx3rd-sub-action-ui-skill-panel');
        if (skillPanel && skillPanel.style.display !== 'none') {
            return 'test';
        }
        
        const comboPanel = subActionUIContainer.querySelector('.dx3rd-sub-action-ui-combo-panel');
        if (comboPanel && comboPanel.style.display !== 'none') {
            return 'combo';
        }
        
        const effectPanel = subActionUIContainer.querySelector('.dx3rd-sub-action-ui-effect-panel');
        if (effectPanel && effectPanel.style.display !== 'none') {
            return 'effect';
        }
        
        const psionicPanel = subActionUIContainer.querySelector('.dx3rd-sub-action-ui-psionic-panel');
        if (psionicPanel && psionicPanel.style.display !== 'none') {
            return 'psionic';
        }
        
        const conditionPanel = subActionUIContainer.querySelector('.dx3rd-sub-action-ui-condition-panel');
        if (conditionPanel && conditionPanel.style.display !== 'none') {
            return 'condition';
        }
        
        const itemPanel = subActionUIContainer.querySelector('.dx3rd-sub-action-ui-item-panel');
        if (itemPanel && itemPanel.style.display !== 'none') {
            return 'item';
        }
        
        const spellPanel = subActionUIContainer.querySelector('.dx3rd-sub-action-ui-spell-panel');
        if (spellPanel && spellPanel.style.display !== 'none') {
            return 'spell';
        }
        
        return null;
    }

    /**
     * 모든 서브 패널 숨기기
     */
    function hideAllSubPanels() {
        if (!subActionUIContainer) return;
        
        // 모든 서브 패널 제거
        subActionUIContainer.innerHTML = '';
    }

    /**
     * 테스트 액션 처리
     */
    function handleTestAction(actor) {
        // 서브 액션 UI 스킬 패널 토글
        const skillPanel = subActionUIContainer.querySelector('.dx3rd-sub-action-ui-skill-panel');
        if (skillPanel) {
            const isVisible = skillPanel.style.display !== 'none';
            skillPanel.style.display = isVisible ? 'none' : 'block';
        } else {
            // 스킬 패널이 없으면 새로 생성
            showSkillPanel(actor);
        }
    }

    /**
     * 스킬 패널 표시
     */
    function showSkillPanel(actor) {
        if (!subActionUIContainer || !actionUIContainer) {
            console.error('DX3rd | subActionUIContainer or actionUIContainer is null!');
            return;
        }
        
        // 액터 데이터 가져오기
        const actorData = getActorSkills(actor);
        const { abilities, skills, customSkills } = actorData;
        
        // 스킬 패널 HTML 생성
        const skillPanelHTML = generateSkillPanelHTML(abilities, skills, customSkills, getFontStyle(), actor);
        
        subActionUIContainer.innerHTML = skillPanelHTML;
        
        // 패널 표시 상태 확인 및 설정
        const skillPanel = subActionUIContainer.querySelector('.dx3rd-sub-action-ui-skill-panel');
        if (skillPanel) {
            skillPanel.style.display = 'block';
        } else {
            console.error('DX3rd | Skill panel not found after creation!');
        }
        
        // 동적 위치 계산
        updateSubPanelPosition('test');
        
        // 이벤트 설정
        setupSubActionUIEvents(subActionUIContainer);
    }

    /**
     * 스킬 클릭 처리
     */
    function handleSkillClick(skill) {
        if (!currentToken || !currentToken.actor) {
            ui.notifications.warn(game.i18n.localize('DX3rd.NoActorForToken'));
            return;
        }
        
        const actor = currentToken.actor;
        
        // 서브 액션 UI 스킬 패널 숨기기
        const skillPanel = subActionUIContainer.querySelector('.dx3rd-sub-action-ui-skill-panel');
        if (skillPanel) {
            skillPanel.style.display = 'none';
        }
        
        // 능력치인지 스킬인지 판단
        const abilities = ['body', 'sense', 'mind', 'social'];
        const targetType = abilities.includes(skill) ? 'ability' : 'skill';
        
        // UniversalHandler를 통한 판정 실행
        const handler = getUniversalHandler();
        if (handler && handler.showStatRollConfirmDialog) {
            // 콤보 빌더 콜백 (액터 시트가 있으면 사용, 없으면 직접 호출)
            const sheet = actor.sheet;
            const comboCallback = (sheet && typeof sheet._openComboBuilder === 'function') 
                ? sheet._openComboBuilder.bind(sheet)
                : null;
            
            handler.showStatRollConfirmDialog(
                actor,
                targetType,
                skill,
                comboCallback
            );
        } else {
            console.error('DX3rd | UniversalHandler not found!');
            ui.notifications.error(game.i18n.localize('DX3rd.TestSystemNotFound'));
        }
    }

    /**
     * UniversalHandler 가져오기
     */
    function getUniversalHandler() {
        return window.DX3rdUniversalHandler;
    }

    /**
     * 폰트 스타일 가져오기
     */
    function getFontStyle() {
        let fontName = 'Arial';
        try {
            fontName = game.settings.get('dx3rd-emanim', 'uiButtonFont') || 'Arial';
        } catch (e) {
            // 설정이 아직 등록되지 않았으면 기본값 사용
            fontName = 'Arial';
        }
        return `font-family: ${fontName} !important;`;
    }
    
    /**
     * 서브 패널 위치 동적 계산
     */
    function updateSubPanelPosition(actionType) {
        if (!actionUIContainer || !subActionUIContainer) return;
        
        // 해당 액션 버튼 찾기
        const actionBtn = actionUIContainer.querySelector(`[data-action="${actionType}"]`);
        if (!actionBtn) {
            console.warn(`DX3rd | Action button not found: ${actionType}`);
            return;
        }
        
        // 버튼의 위치 계산
        const btnRect = actionBtn.getBoundingClientRect();
        const actionContainerRect = actionUIContainer.getBoundingClientRect();
        const subContainerRect = subActionUIContainer.getBoundingClientRect();
        
        // 메인 컨테이너 기준 상대 위치
        const relativeTopInActionUI = btnRect.top - actionContainerRect.top;
        
        // 서브 컨테이너 기준 위치 계산 (90px 차이 보정)
        const subUIContainerTop = 90; // CSS의 top: 90px
        const actionUIContainerTop = 26; // CSS의 top: 60px
        const offset = actionUIContainerTop - subUIContainerTop; // -30px
        
        // 서브 패널의 margin-top 설정
        const panel = subActionUIContainer.querySelector(`.dx3rd-sub-action-ui-${actionType}-panel`);
        if (panel) {
            const buttonHeight = actionBtn.offsetHeight;
            const gap = 6; // 버튼 사이 간격
            const marginTop = relativeTopInActionUI + buttonHeight + gap + offset;
            panel.style.marginTop = `${marginTop}px`;
        }
    }

    /**
     * 콤보 액션 처리
     */
    function handleComboAction(actor) {
        // 서브 액션 UI에 타이밍 버튼들 표시
        showComboTimingPanel(actor);
    }

    /**
     * 콤보 타이밍 패널 표시
     */
    function showComboTimingPanel(actor) {
        if (!subActionUIContainer || !actionUIContainer) return;
        
        // 기존 스킬 패널 숨기기
        const skillPanel = subActionUIContainer.querySelector('.dx3rd-sub-action-ui-skill-panel');
        if (skillPanel) {
            skillPanel.style.display = 'none';
        }
        
        // 기존 콤보 패널 제거
        const existingComboPanel = subActionUIContainer.querySelector('.dx3rd-sub-action-ui-combo-panel');
        if (existingComboPanel) {
            existingComboPanel.remove();
        }
        
        // 타이밍 패널 HTML 생성
        const timingPanelHTML = generateComboTimingPanelHTML(actor);
        subActionUIContainer.innerHTML = timingPanelHTML;
        
        // 동적 위치 계산
        updateSubPanelPosition('combo');
        
        // 이벤트 설정
        setupComboTimingEvents();
    }

    /**
     * 콤보 타이밍 패널 HTML 생성
     */
    function generateComboTimingPanelHTML(actor) {
        const fontStyle = getFontStyle();
        
        // 타이밍별 콤보 개수 확인
        const timingCounts = {};
        const timings = ['setup', 'initiative', 'minor', 'major', 'reaction', 'auto', 'cleanup', 'always', 'major-reaction'];
        
        timings.forEach(timing => {
            const comboItems = actor.items.filter(item => 
                item.type === 'combo' && 
                item.system?.timing === timing
            );
            timingCounts[timing] = comboItems.length;
        });
        
        // major-reaction은 메이저와 리액션 둘 다로 간주
        if (timingCounts['major-reaction'] > 0) {
            timingCounts['major'] = (timingCounts['major'] || 0) + timingCounts['major-reaction'];
            timingCounts['reaction'] = (timingCounts['reaction'] || 0) + timingCounts['major-reaction'];
        }
        
        let html = '<div class="dx3rd-sub-action-ui-combo-panel">';
        
        // 모든 타이밍을 왼쪽부터 순서대로 배치
        const allTimings = ['setup', 'initiative', 'minor', 'major', 'reaction', 'auto', 'cleanup', 'always'];
        const availableTimings = allTimings.filter(timing => timingCounts[timing] > 0);
        
        // 첫 번째 행 (처음 4개)
        html += '<div class="dx3rd-sub-action-ui-timing-row">';
        for (let i = 0; i < 4; i++) {
            if (i < availableTimings.length) {
                const timing = availableTimings[i];
                let label;
                if (timing === 'easy') {
                    label = game.i18n.localize('DX3rd.Easy');
                } else {
                    label = game.i18n.localize(`DX3rd.${timing.charAt(0).toUpperCase() + timing.slice(1)}`);
                }
                html += `<button class="dx3rd-sub-action-ui-timing-btn" data-timing="${timing}" style="${fontStyle}">${label}</button>`;
            } else {
                html += '<div class="dx3rd-sub-action-ui-timing-btn" style="visibility: hidden;"></div>';
            }
        }
        html += '</div>';
        
        // 두 번째 행 (나머지 4개)
        html += '<div class="dx3rd-sub-action-ui-timing-row">';
        for (let i = 4; i < 8; i++) {
            if (i < availableTimings.length) {
                const timing = availableTimings[i];
                let label;
                if (timing === 'easy') {
                    label = game.i18n.localize('DX3rd.Easy');
                } else {
                    label = game.i18n.localize(`DX3rd.${timing.charAt(0).toUpperCase() + timing.slice(1)}`);
                }
                html += `<button class="dx3rd-sub-action-ui-timing-btn" data-timing="${timing}" style="${fontStyle}">${label}</button>`;
            } else {
                html += '<div class="dx3rd-sub-action-ui-timing-btn" style="visibility: hidden;"></div>';
            }
        }
        html += '</div>';
        
        html += '</div>';
        return html;
    }

    /**
     * 콤보 타이밍 이벤트 설정
     */
    // 전역 이벤트 리스너가 이미 등록되었는지 확인
    let globalTimingEventListenerAdded = false;
    
    /**
     * 전역 타이밍 이벤트 리스너 설정 (한 번만)
     */
    function setupGlobalTimingEventListener() {
        if (!subActionUIContainer || globalTimingEventListenerAdded) return;
        
        subActionUIContainer.addEventListener('click', (event) => {
            // 콤보 패널 내의 타이밍 버튼 클릭 처리
            const comboPanel = event.target.closest('.dx3rd-sub-action-ui-combo-panel');
            if (comboPanel) {
                const timingBtn = event.target.closest('.dx3rd-sub-action-ui-timing-btn');
                if (timingBtn && !timingBtn.disabled) {
                    const timing = timingBtn.dataset.timing;
                    if (timing) {
                        playUISound('click');
                        handleComboTimingClick(timing);
                        return;
                    }
                }
            }
            
            // 이펙트 패널 내의 타이밍 버튼 클릭 처리
            const effectPanel = event.target.closest('.dx3rd-sub-action-ui-effect-panel');
            if (effectPanel) {
                const timingBtn = event.target.closest('.dx3rd-sub-action-ui-timing-btn');
                if (timingBtn && !timingBtn.disabled) {
                    const timing = timingBtn.dataset.timing;
                    if (timing) {
                        playUISound('click');
                        handleEffectTimingClick(timing);
                        return;
                    }
                }
            }
            
            // 사이오닉 패널 내의 타이밍 버튼 클릭 처리
            const psionicPanel = event.target.closest('.dx3rd-sub-action-ui-psionic-panel');
            if (psionicPanel) {
                const timingBtn = event.target.closest('.dx3rd-sub-action-ui-timing-btn');
                if (timingBtn && !timingBtn.disabled) {
                    const timing = timingBtn.dataset.timing;
                    if (timing) {
                        playUISound('click');
                        handlePsionicTimingClick(timing);
                        return;
                    }
                }
            }
        });
        
        // 타이밍 버튼 호버 사운드
        subActionUIContainer.addEventListener('mouseenter', (event) => {
            const timingBtn = event.target.closest('.dx3rd-sub-action-ui-timing-btn');
            if (timingBtn && !timingBtn.disabled) {
                playUISound('hover');
            }
        }, true);
        
        globalTimingEventListenerAdded = true;
    }
    
    function setupComboTimingEvents() {
        setupGlobalTimingEventListener();
    }

    /**
     * 콤보 타이밍 클릭 처리
     */
    function handleComboTimingClick(timing) {
        if (!currentToken || !currentToken.actor) {
            ui.notifications.warn(game.i18n.localize('DX3rd.NoActorForToken'));
            return;
        }
        
        const actor = currentToken.actor;
        
        // 기존 다이얼로그들 모두 닫기
        const existingDialogs = document.querySelectorAll('.dx3rd-item-selection-window');
        existingDialogs.forEach(dialog => {
            closeItemSelectionWindow(dialog);
        });
        
        // 콤보 패널 숨기기
        const comboPanel = subActionUIContainer.querySelector('.dx3rd-sub-action-ui-combo-panel');
        if (comboPanel) {
            comboPanel.style.display = 'none';
        }
        
        // 콤보 선택 다이얼로그 표시
        showComboSelectionDialog('combo', timing);
    }

    /**
     * 콤보 선택 다이얼로그 표시
     */
    function showComboSelectionDialog(actionType, timing) {
        if (!currentToken || !currentToken.actor) {
            ui.notifications.warn(game.i18n.localize('DX3rd.NoActorForToken'));
            return;
        }
        
        const actor = currentToken.actor;
        
        // 해당 타이밍의 콤보 아이템들 가져오기
        let comboItems = actor.items.filter(item => 
            item.type === 'combo' && 
            item.system?.timing === timing
        );
        
        // major-reaction은 메이저와 리액션 둘 다로 간주
        if (timing === 'major' || timing === 'reaction') {
            const majorReactionItems = actor.items.filter(item => 
                item.type === 'combo' && 
                item.system?.timing === 'major-reaction'
            );
            comboItems = [...comboItems, ...majorReactionItems];
        }
        
        comboItems = sortAndFilterItemsByLimit(comboItems, actor);
        
        if (comboItems.length === 0) {
            ui.notifications.warn(game.i18n.localize('DX3rd.NoAvailableCombo'));
            return;
        }
        
        const actionLabel = game.i18n.localize(`DX3rd.${actionType.charAt(0).toUpperCase() + actionType.slice(1)}`);
        const comboLabel = game.i18n.localize('DX3rd.Combo');
        
        // DOM 윈도우 생성
        const dialogWindow = document.createElement('div');
        dialogWindow.className = 'dx3rd-item-selection-window';
        dialogWindow.innerHTML = `
            <div class="dx3rd-item-selection-header" style="cursor: move;">
                <h3>${actionLabel}: ${comboLabel} ${game.i18n.localize('DX3rd.Use')}</h3>
                <button class="dx3rd-item-selection-close-btn" title="${game.i18n.localize('DX3rd.Close')}">×</button>
            </div>
            <div class="dx3rd-item-selection-content">
                <div class="dx3rd-item-selection-buttons">
                    ${comboItems.map(item => {
                        const name = item.name.split('||')[0].trim();
                        const limit = item.system?.limit || '-';
                        const cost = item.system?.encroach?.value || '-';
                        const costText = cost === '-' ? '' : ` (${game.i18n.localize('DX3rd.Encroach')}: ${cost})`;
                        const limitText = limit === '-' ? '' : ` (${limit.includes('%') ? limit : limit + '%'})`;
                        return `
                            <button class="dx3rd-item-selection-btn" data-item-id="${item.id}">
                                ${name}${costText}${limitText}
                            </button>
                        `;
                    }).join('')}
                </div>
            </div>
        `;
        
        document.body.appendChild(dialogWindow);
        
        // 이벤트 설정
        setupItemSelectionWindowEvents(dialogWindow, actor, 'combo');
        
        // 드래그 설정
        setupItemSelectionWindowDragging(dialogWindow);
        
        // 애니메이션
        setTimeout(() => {
            dialogWindow.classList.add('dx3rd-item-selection-window-open');
        }, 10);
    }

    /**
     * 아이템 선택 윈도우 이벤트 설정
     */
    function setupItemSelectionWindowEvents(dialogWindow, actor, itemType, actionType = null) {
        const $window = $(dialogWindow);
        
        // 닫기 버튼
        $window.find('.dx3rd-item-selection-close-btn').on('click', () => {
            playUISound('click');
            closeItemSelectionWindow(dialogWindow);
        }).on('mouseenter', () => {
            playUISound('hover');
        });
        
        // 아이템 버튼 클릭
        $window.find('.dx3rd-item-selection-btn').on('click', async (event) => {
            const $btn = $(event.currentTarget);
            const itemId = $btn.data('item-id');
            
            playUISound('click');
            closeItemSelectionWindow(dialogWindow);
            
            if (itemType === 'combo') {
                await handleComboItemClick(actor, itemId);
            } else if (itemType === 'effect') {
                await handleEffectItemClick(actor, itemId);
            } else if (itemType === 'psionic') {
                await handlePsionicItemClick(actor, itemId);
            } else if (itemType === 'spell') {
                await handleSpellItemClick(actor, itemId);
            } else if (itemType === 'item') {
                await handleItemItemClick(actor, itemId, dialogWindow.dataset.itemType);
            } else if (itemType === 'rois') {
                await handleRoisItemClick(actor, itemId);
            }
        }).on('mouseenter', () => {
            playUISound('hover');
        });
    }
    
    /**
     * 아이템 선택 윈도우 드래그 설정
     */
    function setupItemSelectionWindowDragging(dialogWindow) {
        const header = dialogWindow.querySelector('.dx3rd-item-selection-header');
        let isDragging = false;
        let currentX = 0;
        let currentY = 0;
        let initialX = 0;
        let initialY = 0;
        
        header.addEventListener('mousedown', (e) => {
            if (e.target.closest('.dx3rd-item-selection-close-btn')) return;
            
            isDragging = true;
            const rect = dialogWindow.getBoundingClientRect();
            initialX = e.clientX - rect.left;
            initialY = e.clientY - rect.top;
            
            dialogWindow.style.transition = 'none';
        });
        
        document.addEventListener('mousemove', (e) => {
            if (!isDragging) return;
            
            e.preventDefault();
            currentX = e.clientX - initialX;
            currentY = e.clientY - initialY;
            
            dialogWindow.style.left = `${currentX}px`;
            dialogWindow.style.top = `${currentY}px`;
            dialogWindow.style.transform = 'none';
        });
        
        document.addEventListener('mouseup', () => {
            if (isDragging) {
                isDragging = false;
                dialogWindow.style.transition = '';
            }
        });
    }
    
    /**
     * 아이템 선택 윈도우 닫기
     */
    function closeItemSelectionWindow(dialogWindow) {
        dialogWindow.classList.remove('dx3rd-item-selection-window-open');
        setTimeout(() => {
            dialogWindow.remove();
        }, 200);
    }
    
    /**
     * 콤보 아이템 클릭 처리
     */
    async function handleComboItemClick(actor, itemId) {
        const item = actor?.items.get(itemId);
        
        if (!item) {
            ui.notifications.warn(game.i18n.localize('DX3rd.ItemNotFound'));
            return;
        }
        
        // 콤보 사용 메시지 출력
        const actionLabel = game.i18n.localize(`DX3rd.${item.system?.timing?.charAt(0).toUpperCase() + item.system?.timing?.slice(1)}`);
        const comboLabel = game.i18n.localize('DX3rd.Combo');
        
        // 채팅에 메시지 출력
        const chatData = {
            speaker: ChatMessage.getSpeaker({ actor: actor }),
            content: `
                ${actionLabel}: ${comboLabel} ${game.i18n.localize('DX3rd.Use')}
            `,
            style: CONST.CHAT_MESSAGE_STYLES.OTHER
        };
        
        ChatMessage.create(chatData);
        
        // 기존 아이템 채팅도 출력
        const sheet = actor.sheet;
        if (sheet && typeof sheet._sendItemToChat === 'function') {
            await sheet._sendItemToChat(item);
        }
    }
    
    /**
     * 이펙트 아이템 클릭 처리
     */
    async function handleEffectItemClick(actor, itemId) {
        const item = actor?.items.get(itemId);
        
        if (!item) {
            ui.notifications.warn(game.i18n.localize('DX3rd.ItemNotFound'));
            return;
        }
        
        // 이펙트 사용 메시지 출력
        const actionLabel = game.i18n.localize(`DX3rd.${item.system?.timing?.charAt(0).toUpperCase() + item.system?.timing?.slice(1)}`);
        const effectLabel = game.i18n.localize('DX3rd.Effect');
        
        // 채팅에 메시지 출력
        const chatData = {
            speaker: ChatMessage.getSpeaker({ actor: actor }),
            content: `
                ${actionLabel}: ${effectLabel} ${game.i18n.localize('DX3rd.Use')}
            `,
            style: CONST.CHAT_MESSAGE_STYLES.OTHER
        };
        
        ChatMessage.create(chatData);
        
        // 기존 아이템 채팅도 출력
        const sheet = actor.sheet;
        if (sheet && typeof sheet._sendItemToChat === 'function') {
            await sheet._sendItemToChat(item);
        }
    }
    
    /**
     * 사이오닉 아이템 클릭 처리
     */
    async function handlePsionicItemClick(actor, itemId) {
        const item = actor?.items.get(itemId);
        
        if (!item) {
            ui.notifications.warn(game.i18n.localize('DX3rd.ItemNotFound'));
            return;
        }
        
        // 사이오닉 사용 메시지 출력
        const actionLabel = game.i18n.localize(`DX3rd.${item.system?.timing?.charAt(0).toUpperCase() + item.system?.timing?.slice(1)}`);
        const psionicLabel = game.i18n.localize('DX3rd.Psionic');
        
        // 채팅에 메시지 출력
        const chatData = {
            speaker: ChatMessage.getSpeaker({ actor: actor }),
            content: `
                ${actionLabel}: ${psionicLabel} ${game.i18n.localize('DX3rd.Use')}
            `,
            style: CONST.CHAT_MESSAGE_STYLES.OTHER
        };
        
        ChatMessage.create(chatData);
        
        // 기존 아이템 채팅도 출력
        const sheet = actor.sheet;
        if (sheet && typeof sheet._sendItemToChat === 'function') {
            await sheet._sendItemToChat(item);
        }
    }
    
    /**
     * 스펠 아이템 클릭 처리
     */
    async function handleSpellItemClick(actor, itemId) {
        const item = actor?.items.get(itemId);
        
        if (!item) {
            ui.notifications.warn(game.i18n.localize('DX3rd.ItemNotFound'));
            return;
        }
        
        // 스펠 사용 메시지 출력
        const actionLabel = game.i18n.localize(`DX3rd.${item.system?.roll === 'CastingRoll' ? 'Major' : 'Minor'}`);
        const spellLabel = game.i18n.localize('DX3rd.Spell');
        
        // 채팅에 메시지 출력
        const chatData = {
            speaker: ChatMessage.getSpeaker({ actor: actor }),
            content: `
                ${actionLabel}: ${spellLabel} ${game.i18n.localize('DX3rd.Use')}
            `,
            style: CONST.CHAT_MESSAGE_STYLES.OTHER
        };
        
        ChatMessage.create(chatData);
        
        // 기존 아이템 채팅도 출력
        const sheet = actor.sheet;
        if (sheet && typeof sheet._sendItemToChat === 'function') {
            await sheet._sendItemToChat(item);
        }
    }
    
    /**
     * 아이템 아이템 클릭 처리
     */
    async function handleItemItemClick(actor, itemId, actionType) {
        const item = actor?.items.get(itemId);
        
        if (!item) {
            ui.notifications.warn(game.i18n.localize('DX3rd.ItemNotFound'));
            return;
        }
        
        // 아이템 사용 메시지 출력
        const itemLabel = game.i18n.localize('DX3rd.Item');
        
        // 채팅에 메시지 출력
        const chatData = {
            speaker: {
                actor: actor.id,
                alias: actor.name
            },
            content: `
                ${itemLabel} ${game.i18n.localize('DX3rd.Use')}
            `,
            style: CONST.CHAT_MESSAGE_STYLES.OTHER
        };
        
        ChatMessage.create(chatData);
        
        // 기존 아이템 채팅도 출력
        const sheet = actor.sheet;
        if (sheet && typeof sheet._sendItemToChat === 'function') {
            await sheet._sendItemToChat(item);
        }
    }

    /**
     * 아이템을 limit 값에 따라 정렬하고 필터링하는 함수
     */
    function sortAndFilterItemsByLimit(items, actor) {
        // 필터링: Exhausted 아이템과 침식률 제한 초과 아이템 제외
        const filteredItems = items.filter(item => {
            // Exhausted 아이템 제외
            const isExhausted = window.DX3rdItemExhausted?.isItemExhausted(item);
            if (isExhausted) {
                return false;
            }
            
            // 침식률 제한 확인
            const limit = item.system?.limit || '-';
            if (limit !== '-') {
                const limitNumber = parseInt(limit.match(/(\d+)/)?.[1] || '0');
                const actorEncroach = actor?.system?.attributes?.encroachment?.value || 0;
                
                // 액터의 침식률이 아이템의 limit보다 낮으면 제외
                if (actorEncroach < limitNumber) {
                    return false;
                }
            }
            
            return true;
        });
        
        // 정렬
        return filteredItems.sort((a, b) => {
            const limitA = a.system?.limit || '-';
            const limitB = b.system?.limit || '-';
            
            // "-"인 것 먼저
            if (limitA === '-' && limitB !== '-') return -1;
            if (limitA !== '-' && limitB === '-') return 1;
            if (limitA === '-' && limitB === '-') return 0;
            
            // 숫자 추출 함수
            const extractNumber = (limit) => {
                const match = limit.match(/(\d+)/);
                return match ? parseInt(match[1]) : 0;
            };
            
            const numA = extractNumber(limitA);
            const numB = extractNumber(limitB);
            
            // 숫자가 작은 순서대로 (오름차순)
            return numA - numB;
        });
    }
    function generateComboSelectionDialogHTML(comboItems, actor) {
        const fontStyle = getFontStyle();
        
        let html = '<div class="dx3rd-combo-selection-dialog">';
        
        comboItems.forEach(item => {
            const name = item.name.split('||')[0].trim();
            const limit = item.system?.limit || '-';
            const cost = item.system?.encroach?.value || '-';
            const costText = cost === '-' ? '' : ` (${game.i18n.localize('DX3rd.Encroach')}: ${cost})`;
            const limitText = limit === '-' ? '' : ` (${limit.includes('%') ? limit : limit + '%'})`;
            
            html += `
                <button class="dx3rd-combo-selection-btn" data-item-id="${item.id}" style="${fontStyle}">
                    ${name}${costText}${limitText}
                </button>
            `;
        });
        
        html += '</div>';
        return html;
    }

    /**
     * 콤보 다이얼로그 이벤트 설정
     */
    function setupComboDialogEvents(dialog, comboItems, actor) {
        dialog.element.find('.dx3rd-combo-selection-btn').on('click', async (event) => {
            const itemId = $(event.currentTarget).data('item-id');
            const item = comboItems.find(i => i.id === itemId);
            
            playUISound('click');
            
            if (item) {
                dialog.close();
                
                // UniversalHandler를 통한 콤보 실행
                const handler = getUniversalHandler();
                if (handler && handler.showComboDialog) {
                    await handler.showComboDialog(actor, item);
                } else {
                    console.error('DX3rd | UniversalHandler not found!');
                    ui.notifications.error(game.i18n.localize('DX3rd.ComboSystemNotFound'));
                }
            }
        }).on('mouseenter', () => {
            playUISound('hover');
        });
    }

    /**
     * 이펙트 액션 처리
     */
    function handleEffectAction(actor) {
        // 서브 액션 UI에 타이밍 버튼들 표시
        showEffectTimingPanel(actor);
    }
    
    /**
     * 이펙트 타이밍 패널 표시
     */
    function showEffectTimingPanel(actor) {
        if (!subActionUIContainer || !actionUIContainer) return;
        
        // 기존 패널들 숨기기
        const skillPanel = subActionUIContainer.querySelector('.dx3rd-sub-action-ui-skill-panel');
        if (skillPanel) {
            skillPanel.style.display = 'none';
        }
        
        const comboPanel = subActionUIContainer.querySelector('.dx3rd-sub-action-ui-combo-panel');
        if (comboPanel) {
            comboPanel.style.display = 'none';
        }
        
        // 기존 이펙트 패널 제거
        const existingEffectPanel = subActionUIContainer.querySelector('.dx3rd-sub-action-ui-effect-panel');
        if (existingEffectPanel) {
            existingEffectPanel.remove();
        }
        
        // 타이밍 패널 HTML 생성
        const timingPanelHTML = generateEffectTimingPanelHTML(actor);
        subActionUIContainer.innerHTML = timingPanelHTML;
        
        // 동적 위치 계산
        updateSubPanelPosition('effect');
        
        // 이벤트 설정
        setupEffectTimingEvents();
    }
    
    /**
     * 이펙트 타이밍 패널 HTML 생성
     */
    function generateEffectTimingPanelHTML(actor) {
        const fontStyle = getFontStyle();
        
        // 타이밍별 이펙트 개수 확인
        const timingCounts = {};
        const timings = ['setup', 'initiative', 'minor', 'major', 'reaction', 'auto', 'cleanup', 'always', 'major-reaction'];
        
        timings.forEach(timing => {
            const effectItems = actor.items.filter(item => 
                item.type === 'effect' && 
                item.system?.timing === timing &&
                item.system?.type === 'normal'
            );
            timingCounts[timing] = effectItems.length;
        });
        
        // major-reaction은 메이저와 리액션 둘 다로 간주
        if (timingCounts['major-reaction'] > 0) {
            timingCounts['major'] = (timingCounts['major'] || 0) + timingCounts['major-reaction'];
            timingCounts['reaction'] = (timingCounts['reaction'] || 0) + timingCounts['major-reaction'];
        }
        
        let html = '<div class="dx3rd-sub-action-ui-effect-panel">';
        
        // 모든 타이밍을 왼쪽부터 순서대로 배치
        const allTimings = ['setup', 'initiative', 'minor', 'major', 'reaction', 'auto', 'cleanup', 'always'];
        const availableTimings = allTimings.filter(timing => timingCounts[timing] > 0);
        
        // Easy 이펙트 버튼 추가 (타이밍과 별개)
        const easyEffectItems = actor.items.filter(item => 
            item.type === 'effect' && 
            item.system?.type === 'easy'
        );
        
        if (easyEffectItems.length > 0) {
            // Easy 버튼을 availableTimings에 추가
            availableTimings.push('easy');
        }
        
        // 첫 번째 행 (처음 4개)
        html += '<div class="dx3rd-sub-action-ui-timing-row">';
        for (let i = 0; i < 4; i++) {
            if (i < availableTimings.length) {
                const timing = availableTimings[i];
                let label;
                if (timing === 'easy') {
                    label = game.i18n.localize('DX3rd.Easy');
                } else {
                    label = game.i18n.localize(`DX3rd.${timing.charAt(0).toUpperCase() + timing.slice(1)}`);
                }
                html += `<button class="dx3rd-sub-action-ui-timing-btn" data-timing="${timing}" style="${fontStyle}">${label}</button>`;
            } else {
                html += '<div class="dx3rd-sub-action-ui-timing-btn" style="visibility: hidden;"></div>';
            }
        }
        html += '</div>';
        
        // 두 번째 행 (나머지 4개)
        html += '<div class="dx3rd-sub-action-ui-timing-row">';
        for (let i = 4; i < 8; i++) {
            if (i < availableTimings.length) {
                const timing = availableTimings[i];
                let label;
                if (timing === 'easy') {
                    label = game.i18n.localize('DX3rd.Easy');
                } else {
                    label = game.i18n.localize(`DX3rd.${timing.charAt(0).toUpperCase() + timing.slice(1)}`);
                }
                html += `<button class="dx3rd-sub-action-ui-timing-btn" data-timing="${timing}" style="${fontStyle}">${label}</button>`;
            } else {
                html += '<div class="dx3rd-sub-action-ui-timing-btn" style="visibility: hidden;"></div>';
            }
        }
        html += '</div>';
        
        html += '</div>';
        return html;
    }
    
    /**
     * 이펙트 타이밍 이벤트 설정
     */
    function setupEffectTimingEvents() {
        setupGlobalTimingEventListener();
    }
    
    /**
     * 이펙트 타이밍 클릭 처리
     */
    function handleEffectTimingClick(timing) {
        if (!currentToken || !currentToken.actor) {
            ui.notifications.warn(game.i18n.localize('DX3rd.NoActorForToken'));
            return;
        }
        
        const actor = currentToken.actor;
        
        // 기존 다이얼로그들 모두 닫기
        const existingDialogs = document.querySelectorAll('.dx3rd-item-selection-window');
        existingDialogs.forEach(dialog => {
            closeItemSelectionWindow(dialog);
        });
        
        // 이펙트 패널 숨기기
        const effectPanel = subActionUIContainer.querySelector('.dx3rd-sub-action-ui-effect-panel');
        if (effectPanel) {
            effectPanel.style.display = 'none';
        }
        
        // 이펙트 선택 다이얼로그 표시
        showEffectSelectionDialog('effect', timing);
    }
    
    /**
     * 이펙트 선택 다이얼로그 표시
     */
    function showEffectSelectionDialog(actionType, timing) {
        if (!currentToken || !currentToken.actor) {
            ui.notifications.warn(game.i18n.localize('DX3rd.NoActorForToken'));
            return;
        }
        
        const actor = currentToken.actor;
        
        // 해당 타이밍의 이펙트 아이템들 가져오기
        let effectItems = [];
        
        if (timing === 'easy') {
            // Easy 이펙트는 타이밍과 별개
            effectItems = actor.items.filter(item => 
                item.type === 'effect' && 
                item.system?.type === 'easy'
            );
        } else {
            // Normal 이펙트는 타이밍별로
            effectItems = actor.items.filter(item => 
                item.type === 'effect' && 
                item.system?.timing === timing &&
                item.system?.type === 'normal'
            );
            
            // major-reaction은 메이저와 리액션 둘 다에서 포함
            if (timing === 'major' || timing === 'reaction') {
                const majorReactionItems = actor.items.filter(item => 
                    item.type === 'effect' && 
                    item.system?.timing === 'major-reaction' &&
                    item.system?.type === 'normal'
                );
                effectItems = [...effectItems, ...majorReactionItems];
            }
        }
        
        effectItems = sortAndFilterItemsByLimit(effectItems, actor);
        
        if (effectItems.length === 0) {
            ui.notifications.warn(game.i18n.localize('DX3rd.NoAvailableEffect'));
            return;
        }
        
        const actionLabel = game.i18n.localize(`DX3rd.${actionType.charAt(0).toUpperCase() + actionType.slice(1)}`);
        const effectLabel = game.i18n.localize('DX3rd.Effect');
        
        // DOM 윈도우 생성
        const dialogWindow = document.createElement('div');
        dialogWindow.className = 'dx3rd-item-selection-window';
        dialogWindow.innerHTML = `
            <div class="dx3rd-item-selection-header" style="cursor: move;">
                <h3>${actionLabel}: ${effectLabel} ${game.i18n.localize('DX3rd.Use')}</h3>
                <button class="dx3rd-item-selection-close-btn" title="${game.i18n.localize('DX3rd.Close')}">×</button>
            </div>
            <div class="dx3rd-item-selection-content">
                <div class="dx3rd-item-selection-buttons">
                    ${effectItems.map(item => {
                        const name = item.name.split('||')[0].trim();
                        const limit = item.system?.limit || '-';
                        const cost = item.system?.encroach?.value || '-';
                        const costText = cost === '-' ? '' : ` (${game.i18n.localize('DX3rd.Encroach')}: ${cost})`;
                        const limitText = limit === '-' ? '' : ` (${limit.includes('%') ? limit : limit + '%'})`;
                        return `
                            <button class="dx3rd-item-selection-btn" data-item-id="${item.id}">
                                ${name}${costText}${limitText}
                            </button>
                        `;
                    }).join('')}
                </div>
            </div>
        `;
        
        document.body.appendChild(dialogWindow);
        
        // 이벤트 설정
        setupItemSelectionWindowEvents(dialogWindow, actor, 'effect');
        
        // 드래그 설정
        setupItemSelectionWindowDragging(dialogWindow);
        
        // 애니메이션
        setTimeout(() => {
            dialogWindow.classList.add('dx3rd-item-selection-window-open');
        }, 10);
    }

    /**
     * 사이오닉 액션 처리
     */
    function handlePsionicAction(actor) {
        // 서브 액션 UI에 타이밍 버튼들 표시
        showPsionicTimingPanel(actor);
    }
    
    /**
     * 사이오닉 타이밍 패널 표시
     */
    function showPsionicTimingPanel(actor) {
        if (!subActionUIContainer || !actionUIContainer) return;
        
        // 기존 패널들 숨기기
        const skillPanel = subActionUIContainer.querySelector('.dx3rd-sub-action-ui-skill-panel');
        if (skillPanel) {
            skillPanel.style.display = 'none';
        }
        
        const comboPanel = subActionUIContainer.querySelector('.dx3rd-sub-action-ui-combo-panel');
        if (comboPanel) {
            comboPanel.style.display = 'none';
        }
        
        const effectPanel = subActionUIContainer.querySelector('.dx3rd-sub-action-ui-effect-panel');
        if (effectPanel) {
            effectPanel.style.display = 'none';
        }
        
        // 기존 사이오닉 패널 제거
        const existingPsionicPanel = subActionUIContainer.querySelector('.dx3rd-sub-action-ui-psionic-panel');
        if (existingPsionicPanel) {
            existingPsionicPanel.remove();
        }
        
        // 타이밍 패널 HTML 생성
        const timingPanelHTML = generatePsionicTimingPanelHTML(actor);
        subActionUIContainer.innerHTML = timingPanelHTML;
        
        // 동적 위치 계산
        updateSubPanelPosition('psionic');
        
        // 이벤트 설정
        setupPsionicTimingEvents();
    }
    
    /**
     * 사이오닉 타이밍 패널 HTML 생성
     */
    function generatePsionicTimingPanelHTML(actor) {
        const fontStyle = getFontStyle();
        
        // 타이밍별 사이오닉 개수 확인
        const timingCounts = {};
        const timings = ['setup', 'initiative', 'minor', 'major', 'reaction', 'auto', 'cleanup', 'always', 'major-reaction'];
        
        timings.forEach(timing => {
            const psionicItems = actor.items.filter(item => 
                item.type === 'psionic' && 
                item.system?.timing === timing
            );
            timingCounts[timing] = psionicItems.length;
        });
        
        // major-reaction은 메이저와 리액션 둘 다로 간주
        if (timingCounts['major-reaction'] > 0) {
            timingCounts['major'] = (timingCounts['major'] || 0) + timingCounts['major-reaction'];
            timingCounts['reaction'] = (timingCounts['reaction'] || 0) + timingCounts['major-reaction'];
        }
        
        let html = '<div class="dx3rd-sub-action-ui-psionic-panel">';
        
        // 모든 타이밍을 왼쪽부터 순서대로 배치
        const allTimings = ['setup', 'initiative', 'minor', 'major', 'reaction', 'auto', 'cleanup', 'always'];
        const availableTimings = allTimings.filter(timing => timingCounts[timing] > 0);
        
        // 첫 번째 행 (처음 4개)
        html += '<div class="dx3rd-sub-action-ui-timing-row">';
        for (let i = 0; i < 4; i++) {
            if (i < availableTimings.length) {
                const timing = availableTimings[i];
                let label;
                if (timing === 'easy') {
                    label = game.i18n.localize('DX3rd.Easy');
                } else {
                    label = game.i18n.localize(`DX3rd.${timing.charAt(0).toUpperCase() + timing.slice(1)}`);
                }
                html += `<button class="dx3rd-sub-action-ui-timing-btn" data-timing="${timing}" style="${fontStyle}">${label}</button>`;
            } else {
                html += '<div class="dx3rd-sub-action-ui-timing-btn" style="visibility: hidden;"></div>';
            }
        }
        html += '</div>';
        
        // 두 번째 행 (나머지 4개)
        html += '<div class="dx3rd-sub-action-ui-timing-row">';
        for (let i = 4; i < 8; i++) {
            if (i < availableTimings.length) {
                const timing = availableTimings[i];
                let label;
                if (timing === 'easy') {
                    label = game.i18n.localize('DX3rd.Easy');
                } else {
                    label = game.i18n.localize(`DX3rd.${timing.charAt(0).toUpperCase() + timing.slice(1)}`);
                }
                html += `<button class="dx3rd-sub-action-ui-timing-btn" data-timing="${timing}" style="${fontStyle}">${label}</button>`;
            } else {
                html += '<div class="dx3rd-sub-action-ui-timing-btn" style="visibility: hidden;"></div>';
            }
        }
        html += '</div>';
        
        html += '</div>';
        return html;
    }
    
    /**
     * 사이오닉 타이밍 이벤트 설정
     */
    function setupPsionicTimingEvents() {
        setupGlobalTimingEventListener();
    }
    
    /**
     * 사이오닉 타이밍 클릭 처리
     */
    function handlePsionicTimingClick(timing) {
        if (!currentToken || !currentToken.actor) {
            ui.notifications.warn(game.i18n.localize('DX3rd.NoActorForToken'));
            return;
        }
        
        const actor = currentToken.actor;
        
        // 기존 다이얼로그들 모두 닫기
        const existingDialogs = document.querySelectorAll('.dx3rd-item-selection-window');
        existingDialogs.forEach(dialog => {
            closeItemSelectionWindow(dialog);
        });
        
        // 사이오닉 패널 숨기기
        const psionicPanel = subActionUIContainer.querySelector('.dx3rd-sub-action-ui-psionic-panel');
        if (psionicPanel) {
            psionicPanel.style.display = 'none';
        }
        
        // 사이오닉 선택 다이얼로그 표시
        showPsionicSelectionDialog('psionic', timing);
    }
    
    /**
     * 사이오닉 선택 다이얼로그 표시
     */
    function showPsionicSelectionDialog(actionType, timing) {
        if (!currentToken || !currentToken.actor) {
            ui.notifications.warn(game.i18n.localize('DX3rd.NoActorForToken'));
            return;
        }
        
        const actor = currentToken.actor;
        
        // 해당 타이밍의 사이오닉 아이템들 가져오기
        let psionicItems = actor.items.filter(item => 
            item.type === 'psionic' && 
            item.system?.timing === timing
        );
        
        // major-reaction은 메이저와 리액션 둘 다에서 포함
        if (timing === 'major' || timing === 'reaction') {
            const majorReactionItems = actor.items.filter(item => 
                item.type === 'psionic' && 
                item.system?.timing === 'major-reaction'
            );
            psionicItems = [...psionicItems, ...majorReactionItems];
        }
        
        psionicItems = sortAndFilterItemsByLimit(psionicItems, actor);
        
        if (psionicItems.length === 0) {
            ui.notifications.warn(game.i18n.localize('DX3rd.NoAvailablePsionic'));
            return;
        }
        
        const actionLabel = game.i18n.localize(`DX3rd.${actionType.charAt(0).toUpperCase() + actionType.slice(1)}`);
        const psionicLabel = game.i18n.localize('DX3rd.Psionic');
        
        // DOM 윈도우 생성
        const dialogWindow = document.createElement('div');
        dialogWindow.className = 'dx3rd-item-selection-window';
        dialogWindow.innerHTML = `
            <div class="dx3rd-item-selection-header" style="cursor: move;">
                <h3>${actionLabel}: ${psionicLabel} ${game.i18n.localize('DX3rd.Use')}</h3>
                <button class="dx3rd-item-selection-close-btn" title="${game.i18n.localize('DX3rd.Close')}">×</button>
            </div>
            <div class="dx3rd-item-selection-content">
                <div class="dx3rd-item-selection-buttons">
                    ${psionicItems.map(item => {
                        const name = item.name.split('||')[0].trim();
                        const limit = item.system?.limit || '-';
                        const cost = item.system?.hp?.value || '-';
                        const costText = cost === '-' ? '' : ` (${game.i18n.localize('DX3rd.HP')}: ${cost})`;
                        const limitText = limit === '-' ? '' : ` (${limit.includes('%') ? limit : limit + '%'})`;
                        return `
                            <button class="dx3rd-item-selection-btn" data-item-id="${item.id}">
                                ${name}${costText}${limitText}
                            </button>
                        `;
                    }).join('')}
                </div>
            </div>
        `;
        
        document.body.appendChild(dialogWindow);
        
        // 이벤트 설정
        setupItemSelectionWindowEvents(dialogWindow, actor, 'psionic');
        
        // 드래그 설정
        setupItemSelectionWindowDragging(dialogWindow);
        
        // 애니메이션
        setTimeout(() => {
            dialogWindow.classList.add('dx3rd-item-selection-window-open');
        }, 10);
    }

    /**
     * 스펠 액션 처리
     */
    function handleSpellAction(actor) {
        // 서브 액션 UI에 스펠 버튼들 표시
        showSpellPanel(actor);
    }
    
    /**
     * 스펠 패널 표시
     */
    function showSpellPanel(actor) {
        if (!subActionUIContainer || !actionUIContainer) return;
        
        // 기존 패널들 숨기기
        hideAllSubPanels();
        
        // 스펠 패널 HTML 생성
        const spellPanelHTML = generateSpellPanelHTML(actor);
        subActionUIContainer.innerHTML = spellPanelHTML;
        
        // 동적 위치 계산
        updateSubPanelPosition('spell');
        
        // 이벤트 설정
        setupSpellEvents();
    }
    
    /**
     * 스펠 패널 HTML 생성
     */
    function generateSpellPanelHTML(actor) {
        const fontStyle = getFontStyle();
        
        // 스펠 타입별 개수 확인
        const spellTypeOrder = [
            { key: 'NormalSpell', types: ['NormalSpell', 'NormalKeep'] },
            { key: 'SignSpell', types: ['SignSpell'] },
            { key: 'Ritual', types: ['Ritual', 'RitualKeep', 'RitualCurse'] },
            { key: 'Summon', types: ['Summon', 'SummonRitual'] },
            { key: 'Evocation', types: ['Evocation', 'EvocationRitual'] }
        ];
        const spellTypeCounts = {};
        
        spellTypeOrder.forEach(({ key, types }) => {
            const items = actor.items.filter(item => 
                item.type === 'spell' && 
                types.includes(item.system?.spelltype)
            );
            spellTypeCounts[key] = items.length;
        });
        
        // 스펠이 있는 타입만 필터링
        const availableTypes = spellTypeOrder.filter(({ key }) => spellTypeCounts[key] > 0);
        
        let html = '<div class="dx3rd-sub-action-ui-spell-panel">';
        
        // 첫 번째 행 (처음 4개)
        html += '<div class="dx3rd-sub-action-ui-spell-row">';
        for (let i = 0; i < 4; i++) {
            if (i < availableTypes.length) {
                const { key } = availableTypes[i];
                const label = game.i18n.localize(`DX3rd.${key}`);
                html += `<button class="dx3rd-sub-action-ui-spell-btn" data-spell-type="${key}" style="${fontStyle}">${label}</button>`;
            } else {
                html += '<div class="dx3rd-sub-action-ui-spell-btn" style="visibility: hidden;"></div>';
            }
        }
        html += '</div>';
        
        // 두 번째 행 (나머지, 5개 중 4개가 넘으면 다음 행으로)
        if (availableTypes.length > 4) {
            html += '<div class="dx3rd-sub-action-ui-spell-row">';
            for (let i = 4; i < 8; i++) {
                if (i < availableTypes.length) {
                    const { key } = availableTypes[i];
                    const label = game.i18n.localize(`DX3rd.${key}`);
                    html += `<button class="dx3rd-sub-action-ui-spell-btn" data-spell-type="${key}" style="${fontStyle}">${label}</button>`;
                } else {
                    html += '<div class="dx3rd-sub-action-ui-spell-btn" style="visibility: hidden;"></div>';
                }
            }
            html += '</div>';
        }
        
        html += '</div>';
        return html;
    }
    
    /**
     * 스펠 이벤트 설정
     */
    function setupSpellEvents() {
        if (!subActionUIContainer) return;
        
        // 이벤트 위임을 사용하여 동적으로 생성된 요소들에 이벤트 바인딩
        subActionUIContainer.addEventListener('click', (event) => {
            // 스펠 패널 내의 버튼 클릭만 처리
            const spellPanel = event.target.closest('.dx3rd-sub-action-ui-spell-panel');
            if (!spellPanel) return;
            
            const spellBtn = event.target.closest('.dx3rd-sub-action-ui-spell-btn');
            if (spellBtn && !spellBtn.disabled) {
                const spellType = spellBtn.dataset.spellType;
                if (spellType) {
                    playUISound('click');
                    handleSpellTypeClick(spellType);
                }
            }
        });
        
        // 스펠 버튼 호버 사운드
        subActionUIContainer.addEventListener('mouseenter', (event) => {
            const spellBtn = event.target.closest('.dx3rd-sub-action-ui-spell-btn');
            if (spellBtn && !spellBtn.disabled) {
                playUISound('hover');
            }
        }, true);
    }
    
    /**
     * 스펠 타입 클릭 처리
     */
    function handleSpellTypeClick(spellType) {
        if (!currentToken || !currentToken.actor) {
            ui.notifications.warn(game.i18n.localize('DX3rd.NoActorForToken'));
            return;
        }
        
        const actor = currentToken.actor;
        
        // 기존 다이얼로그들 모두 닫기
        const existingDialogs = document.querySelectorAll('.dx3rd-item-selection-window');
        existingDialogs.forEach(dialog => {
            closeItemSelectionWindow(dialog);
        });
        
        // 스펠 패널 숨기기
        const spellPanel = subActionUIContainer.querySelector('.dx3rd-sub-action-ui-spell-panel');
        if (spellPanel) {
            spellPanel.style.display = 'none';
        }
        
        // 스펠 선택 다이얼로그 표시
        showSpellSelectionDialog(spellType);
    }
    
    /**
     * 스펠 선택 다이얼로그 표시
     */
    function showSpellSelectionDialog(spellType) {
        if (!currentToken || !currentToken.actor) {
            ui.notifications.warn(game.i18n.localize('DX3rd.NoActorForToken'));
            return;
        }
        
        const actor = currentToken.actor;
        
        // 스펠 타입별 아이템 타입 매핑
        const spellTypeMap = {
            'NormalSpell': ['NormalSpell', 'NormalKeep'],
            'SignSpell': ['SignSpell'],
            'Ritual': ['Ritual', 'RitualKeep', 'RitualCurse'],
            'Summon': ['Summon', 'SummonRitual'],
            'Evocation': ['Evocation', 'EvocationRitual']
        };
        
        const targetTypes = spellTypeMap[spellType] || [];
        
        // 해당 타입의 스펠 아이템들 가져오기
        let spellItems = actor.items.filter(item => 
            item.type === 'spell' && 
            targetTypes.includes(item.system?.spelltype)
        );
        
        // 아이템을 사용자가 설정한 순서대로 정렬
        const typeOrder = {};
        targetTypes.forEach((type, index) => {
            typeOrder[type] = index;
        });
        
        // 먼저 타입 순서로 정렬, 그 다음 이름순으로 정렬
        spellItems = spellItems.sort((a, b) => {
            const orderA = typeOrder[a.system?.spelltype] ?? 999;
            const orderB = typeOrder[b.system?.spelltype] ?? 999;
            if (orderA !== orderB) {
                return orderA - orderB;
            }
            return a.name.localeCompare(b.name);
        });
        
        // 타입별 메타 레이블 매핑
        const metaLabels = {
            'NormalKeep': game.i18n.localize('DX3rd.SpellKeep'),
            'RitualKeep': game.i18n.localize('DX3rd.SpellKeep'),
            'RitualCurse': game.i18n.localize('DX3rd.SpellCurse'),
            'SummonRitual': game.i18n.localize('DX3rd.Ritual'),
            'EvocationRitual': game.i18n.localize('DX3rd.Ritual')
        };
        
        if (spellItems.length === 0) {
            ui.notifications.warn(game.i18n.localize('DX3rd.NoAvailableSpell'));
            return;
        }
        
        const spellLabel = game.i18n.localize(`DX3rd.${spellType}`);
        
        // DOM 윈도우 생성
        const dialogWindow = document.createElement('div');
        dialogWindow.className = 'dx3rd-item-selection-window';
        dialogWindow.innerHTML = `
            <div class="dx3rd-item-selection-header" style="cursor: move;">
                <h3>${spellLabel} ${game.i18n.localize('DX3rd.Use')}</h3>
                <button class="dx3rd-item-selection-close-btn" title="${game.i18n.localize('DX3rd.Close')}">×</button>
            </div>
            <div class="dx3rd-item-selection-content">
                <div class="dx3rd-item-selection-buttons">
                    ${spellItems.map(item => {
                        const name = item.name.split('||')[0].trim();
                        const spelltype = item.system?.spelltype || '-';
                        const invoke = item.system?.invoke?.value || '-';
                        const evocation = item.system?.evocation?.value || '-';
                        const encroach = item.system?.encroach?.value || '-';
                        
                        // 메타 레이블 표시 (특정 타입에만)
                        const metaLabel = metaLabels[spelltype];
                        const metaLabelText = metaLabel ? ` (${metaLabel})` : '';
                        
                        // invoke/evocation 표시
                        let invokeEvocationText = '';
                        if (invoke !== '-' && evocation !== '-') {
                            invokeEvocationText = ` (${invoke}/${evocation})`;
                        } else if (invoke !== '-') {
                            invokeEvocationText = ` (${invoke})`;
                        } else if (evocation !== '-') {
                            invokeEvocationText = ` (${evocation})`;
                        }
                        
                        // encroach 표시
                        const encroachText = encroach !== '-' ? ` (${game.i18n.localize('DX3rd.Encroach')}: ${encroach})` : '';
                        
                        return `
                            <button class="dx3rd-item-selection-btn" data-item-id="${item.id}">
                                ${name}${metaLabelText}${invokeEvocationText}${encroachText}
                            </button>
                        `;
                    }).join('')}
                </div>
            </div>
        `;
        
        document.body.appendChild(dialogWindow);
        
        // 이벤트 설정
        setupItemSelectionWindowEvents(dialogWindow, actor, 'spell');
        
        // 드래그 설정
        setupItemSelectionWindowDragging(dialogWindow);
        
        // 애니메이션
        setTimeout(() => {
            dialogWindow.classList.add('dx3rd-item-selection-window-open');
        }, 10);
    }

    /**
     * 아이템 액션 처리
     */
    function handleItemAction(actor) {
        // 서브 액션 UI에 아이템 버튼들 표시
        showItemPanel(actor);
    }
    
    /**
     * 아이템 패널 표시
     */
    function showItemPanel(actor) {
        if (!subActionUIContainer || !actionUIContainer) return;
        
        // 기존 패널들 숨기기
        hideAllSubPanels();
        
        // 아이템 패널 HTML 생성
        const itemPanelHTML = generateItemPanelHTML(actor);
        subActionUIContainer.innerHTML = itemPanelHTML;
        
        // 동적 위치 계산
        updateSubPanelPosition('item');
        
        // 이벤트 설정
        setupItemEvents();
    }
    
    /**
     * 아이템 패널 HTML 생성
     */
    function generateItemPanelHTML(actor) {
        const fontStyle = getFontStyle();
        
        // 아이템 타입별 개수 확인
        const itemTypeOrder = ['weapon', 'protect', 'vehicle', 'book', 'connection', 'etc', 'once'];
        const itemTypeCounts = {};
        
        itemTypeOrder.forEach(type => {
            const items = actor.items.filter(item => 
                item.type === type &&
                !window.DX3rdItemExhausted?.isItemExhausted(item)
            );
            itemTypeCounts[type] = items.length;
        });
        
        // 아이템이 있는 타입만 필터링
        const availableTypes = itemTypeOrder.filter(type => itemTypeCounts[type] > 0);
        
        let html = '<div class="dx3rd-sub-action-ui-item-panel">';
        
        // 첫 번째 행 (처음 4개)
        html += '<div class="dx3rd-sub-action-ui-item-row">';
        for (let i = 0; i < 4; i++) {
            if (i < availableTypes.length) {
                const type = availableTypes[i];
                const label = game.i18n.localize(`DX3rd.${type.charAt(0).toUpperCase() + type.slice(1)}`);
                html += `<button class="dx3rd-sub-action-ui-item-btn" data-item-type="${type}" style="${fontStyle}">${label}</button>`;
            } else {
                html += '<div class="dx3rd-sub-action-ui-item-btn" style="visibility: hidden;"></div>';
            }
        }
        html += '</div>';
        
        // 두 번째 행 (나머지)
        html += '<div class="dx3rd-sub-action-ui-item-row">';
        for (let i = 4; i < 8; i++) {
            if (i < availableTypes.length) {
                const type = availableTypes[i];
                const label = game.i18n.localize(`DX3rd.${type.charAt(0).toUpperCase() + type.slice(1)}`);
                html += `<button class="dx3rd-sub-action-ui-item-btn" data-item-type="${type}" style="${fontStyle}">${label}</button>`;
            } else {
                html += '<div class="dx3rd-sub-action-ui-item-btn" style="visibility: hidden;"></div>';
            }
        }
        html += '</div>';
        
        html += '</div>';
        return html;
    }
    
    /**
     * 아이템 이벤트 설정
     */
    function setupItemEvents() {
        if (!subActionUIContainer) return;
        
        // 이벤트 위임을 사용하여 동적으로 생성된 요소들에 이벤트 바인딩
        subActionUIContainer.addEventListener('click', (event) => {
            // 아이템 패널 내의 버튼 클릭만 처리
            const itemPanel = event.target.closest('.dx3rd-sub-action-ui-item-panel');
            if (!itemPanel) return;
            
            const itemBtn = event.target.closest('.dx3rd-sub-action-ui-item-btn');
            if (itemBtn && !itemBtn.disabled) {
                const itemType = itemBtn.dataset.itemType;
                if (itemType) {
                    playUISound('click');
                    handleItemTypeClick(itemType);
                }
            }
        });
        
        // 아이템 버튼 호버 사운드
        subActionUIContainer.addEventListener('mouseenter', (event) => {
            const itemBtn = event.target.closest('.dx3rd-sub-action-ui-item-btn');
            if (itemBtn && !itemBtn.disabled) {
                playUISound('hover');
            }
        }, true);
    }
    
    /**
     * 아이템 타입 클릭 처리
     */
    function handleItemTypeClick(itemType) {
        if (!currentToken || !currentToken.actor) {
            ui.notifications.warn(game.i18n.localize('DX3rd.NoActorForToken'));
            return;
        }
        
        const actor = currentToken.actor;
        
        // 기존 다이얼로그들 모두 닫기
        const existingDialogs = document.querySelectorAll('.dx3rd-item-selection-window');
        existingDialogs.forEach(dialog => {
            closeItemSelectionWindow(dialog);
        });
        
        // 아이템 패널 숨기기
        const itemPanel = subActionUIContainer.querySelector('.dx3rd-sub-action-ui-item-panel');
        if (itemPanel) {
            itemPanel.style.display = 'none';
        }
        
        // 아이템 선택 다이얼로그 표시
        showItemSelectionDialog(itemType);
    }
    
    /**
     * 아이템 선택 다이얼로그 표시
     */
    function showItemSelectionDialog(itemType) {
        if (!currentToken || !currentToken.actor) {
            ui.notifications.warn(game.i18n.localize('DX3rd.NoActorForToken'));
            return;
        }
        
        const actor = currentToken.actor;
        
        // 해당 타입의 아이템들 가져오기
        let itemItems = actor.items.filter(item => 
            item.type === itemType &&
            !window.DX3rdItemExhausted?.isItemExhausted(item)
        );
        
        // 아이템을 이름순으로 정렬
        itemItems = itemItems.sort((a, b) => a.name.localeCompare(b.name));
        
        if (itemItems.length === 0) {
            ui.notifications.warn(game.i18n.localize('DX3rd.NoAvailableItem'));
            return;
        }
        
        const typeLabel = game.i18n.localize(`DX3rd.${itemType.charAt(0).toUpperCase() + itemType.slice(1)}`);
        
        // DOM 윈도우 생성
        const dialogWindow = document.createElement('div');
        dialogWindow.className = 'dx3rd-item-selection-window';
        dialogWindow.innerHTML = `
            <div class="dx3rd-item-selection-header" style="cursor: move;">
                <h3>${typeLabel} ${game.i18n.localize('DX3rd.Use')}</h3>
                <button class="dx3rd-item-selection-close-btn" title="${game.i18n.localize('DX3rd.Close')}">×</button>
            </div>
            <div class="dx3rd-item-selection-content">
                <div class="dx3rd-item-selection-buttons">
                    ${itemItems.map(item => {
                        const name = item.name.split('||')[0].trim();
                        return `
                            <button class="dx3rd-item-selection-btn" data-item-id="${item.id}">
                                ${name}
                            </button>
                        `;
                    }).join('')}
                </div>
            </div>
        `;
        
        document.body.appendChild(dialogWindow);
        
        // 다이얼로그에 itemType 저장
        dialogWindow.dataset.itemType = itemType;
        
        // 이벤트 설정
        setupItemSelectionWindowEvents(dialogWindow, actor, 'item', null);
        
        // 드래그 설정
        setupItemSelectionWindowDragging(dialogWindow);
        
        // 애니메이션
        setTimeout(() => {
            dialogWindow.classList.add('dx3rd-item-selection-window-open');
        }, 10);
    }

    /**
     * 상태이상 액션 처리
     */
    function handleConditionAction(actor) {
        // 서브 액션 UI에 상태이상 버튼들 표시
        showConditionPanel(actor);
    }
    
    /**
     * 상태이상 패널 표시
     */
    function showConditionPanel(actor) {
        if (!subActionUIContainer || !actionUIContainer) return;
        
        // 기존 패널들 숨기기
        hideAllSubPanels();
        
        // 타이밍 패널 HTML 생성
        const conditionPanelHTML = generateConditionPanelHTML();
        subActionUIContainer.innerHTML = conditionPanelHTML;
        
        // 동적 위치 계산
        updateSubPanelPosition('condition');
        
        // 이벤트 설정
        setupConditionEvents();
    }
    
    /**
     * 상태이상 패널 HTML 생성
     */
    function generateConditionPanelHTML() {
        const fontStyle = getFontStyle();
        
        // 액터의 현재 상태이상 확인
        const activeConditions = new Set();
        if (currentToken && currentToken.actor && currentToken.actor.effects) {
            for (const effect of currentToken.actor.effects) {
                if (effect.statuses && effect.statuses.size > 0) {
                    for (const status of effect.statuses) {
                        activeConditions.add(status);
                    }
                }
            }
        }
        
        // 상태이상 목록 (5등분)
        const conditions = [
            'poisoned',    // 사독
            'hatred',   // 증오
            'fear',     // 공포
            'berserk',  // 폭주
            'rigor',    // 경직
            'pressure', // 중압
            'dazed',  // 방심
            'boarding', // 탑승
            'stealth',  // 은밀
            'fly'      // 비행
        ];
        
        let html = '<div class="dx3rd-sub-action-ui-condition-panel">';
        
        // 첫 번째 행 (처음 5개)
        html += '<div class="dx3rd-sub-action-ui-condition-row">';
        for (let i = 0; i < 5; i++) {
            const condition = conditions[i];
            const label = game.i18n.localize(`DX3rd.${condition.charAt(0).toUpperCase() + condition.slice(1)}`);
            const isActive = activeConditions.has(condition);
            const activeClass = isActive ? 'dx3rd-condition-active' : '';
            html += `<button class="dx3rd-sub-action-ui-condition-btn ${activeClass}" data-condition="${condition}" style="${fontStyle}">${label}</button>`;
        }
        html += '</div>';
        
        // 두 번째 행 (나머지 5개)
        html += '<div class="dx3rd-sub-action-ui-condition-row">';
        for (let i = 5; i < 10; i++) {
            const condition = conditions[i];
            const label = game.i18n.localize(`DX3rd.${condition.charAt(0).toUpperCase() + condition.slice(1)}`);
            const isActive = activeConditions.has(condition);
            const activeClass = isActive ? 'dx3rd-condition-active' : '';
            html += `<button class="dx3rd-sub-action-ui-condition-btn ${activeClass}" data-condition="${condition}" style="${fontStyle}">${label}</button>`;
        }
        html += '</div>';
        
        html += '</div>';
        return html;
    }
    
    /**
     * 상태이상 이벤트 설정
     */
    function setupConditionEvents() {
        if (!subActionUIContainer) return;
        
        // 이벤트 위임을 사용하여 동적으로 생성된 요소들에 이벤트 바인딩
        subActionUIContainer.addEventListener('click', (event) => {
            // 상태이상 패널 내의 버튼 클릭만 처리
            const conditionPanel = event.target.closest('.dx3rd-sub-action-ui-condition-panel');
            if (!conditionPanel) return;
            
            const conditionBtn = event.target.closest('.dx3rd-sub-action-ui-condition-btn');
            if (conditionBtn && !conditionBtn.disabled) {
                const condition = conditionBtn.dataset.condition;
                if (condition) {
                    playUISound('click');
                    handleConditionClick(condition);
                }
            }
        });
        
        // 상태이상 버튼 호버 사운드
        subActionUIContainer.addEventListener('mouseenter', (event) => {
            const conditionBtn = event.target.closest('.dx3rd-sub-action-ui-condition-btn');
            if (conditionBtn && !conditionBtn.disabled) {
                playUISound('hover');
            }
        }, true);
    }
    
    /**
     * 상태이상 클릭 처리
     */
    async function handleConditionClick(condition) {
        if (!currentToken || !currentToken.actor) {
            ui.notifications.warn(game.i18n.localize('DX3rd.NoActorForToken'));
            return;
        }
        
        const actor = currentToken.actor;
        
        // 현재 상태이상 활성화 여부 확인
        let isActive = false;
        if (actor.effects) {
            for (const effect of actor.effects) {
                if (effect.statuses && effect.statuses.has(condition)) {
                    isActive = true;
                    break;
                }
            }
        }
        
        // 상태이상 토글
        try {
            await actor.toggleStatusEffect(condition, { active: !isActive });
            
            // 버튼의 상태 업데이트
            const conditionBtn = subActionUIContainer.querySelector(`.dx3rd-sub-action-ui-condition-btn[data-condition="${condition}"]`);
            if (conditionBtn) {
                if (!isActive) {
                    conditionBtn.classList.add('dx3rd-condition-active');
                } else {
                    conditionBtn.classList.remove('dx3rd-condition-active');
                }
            }
        } catch (error) {
            console.error('DX3rd | Failed to toggle condition:', error);
            ui.notifications.error(game.i18n.localize('DX3rd.ConditionToggleFailed'));
        }
    }

    /**
     * 로이스 액션 처리
     */
    function handleRoisAction(actor) {
        // 기존 다이얼로그들 모두 닫기
        const existingDialogs = document.querySelectorAll('.dx3rd-item-selection-window');
        existingDialogs.forEach(dialog => {
            closeItemSelectionWindow(dialog);
        });
        
        // 로이스 선택 다이얼로그 표시
        showRoisSelectionDialog();
    }
    
    /**
     * 로이스 선택 다이얼로그 표시
     */
    function showRoisSelectionDialog() {
        if (!currentToken || !currentToken.actor) {
            ui.notifications.warn(game.i18n.localize('DX3rd.NoActorForToken'));
            return;
        }
        
        const actor = currentToken.actor;
        
        // 로이스 아이템들 가져오기 (M 제외)
        let roisItems = actor.items.filter(item => 
            item.type === 'rois' && 
            item.system?.type !== 'M'
        );
        
        // 타이터스 여부 확인
        roisItems = roisItems.map(item => ({
            ...item,
            isTitus: item.system?.titus || false,
            isSublimated: item.system?.sublimation || false
        }));
        
        // 승화된 로이스 제외
        roisItems = roisItems.filter(item => !item.isSublimated);
        
        if (roisItems.length === 0) {
            ui.notifications.warn(game.i18n.localize('DX3rd.NoAvailableRois'));
            return;
        }
        
        // 정렬: E -> D -> S -> -
        const orderMap = {
            'E': 1,
            'D': 2,
            'S': 3,
            '-': 4
        };
        roisItems.sort((a, b) => {
            const typeA = a.system?.type || '-';
            const typeB = b.system?.type || '-';
            const orderA = orderMap[typeA] || 999;
            const orderB = orderMap[typeB] || 999;
            return orderA - orderB;
        });
        
        const roisLabel = game.i18n.localize('DX3rd.Rois');
        
        // DOM 윈도우 생성
        const dialogWindow = document.createElement('div');
        dialogWindow.className = 'dx3rd-item-selection-window';
        dialogWindow.innerHTML = `
            <div class="dx3rd-item-selection-header" style="cursor: move;">
                <h3>${roisLabel} ${game.i18n.localize('DX3rd.Use')}</h3>
                <button class="dx3rd-item-selection-close-btn" title="${game.i18n.localize('DX3rd.Close')}">×</button>
            </div>
            <div class="dx3rd-item-selection-content">
                <div class="dx3rd-item-selection-buttons">
                    ${roisItems.map(item => {
                        const name = item.name.split('||')[0].trim();
                        const type = item.system?.type || '-';
                        const isTitus = item.isTitus;
                        const style = isTitus ? 'style="color: #f44336 !important;"' : '';
                        return `
                            <button class="dx3rd-item-selection-btn" data-item-id="${item.id}" ${style}>
                                ${name} (${type})
                            </button>
                        `;
                    }).join('')}
                </div>
            </div>
        `;
        
        document.body.appendChild(dialogWindow);
        
        // 이벤트 설정
        setupItemSelectionWindowEvents(dialogWindow, actor, 'rois');
        
        // 드래그 설정
        setupItemSelectionWindowDragging(dialogWindow);
        
        // 애니메이션
        setTimeout(() => {
            dialogWindow.classList.add('dx3rd-item-selection-window-open');
        }, 10);
    }
    
    /**
     * 로이스 아이템 클릭 처리
     */
    async function handleRoisItemClick(actor, itemId) {
        const item = actor?.items.get(itemId);
        
        if (!item) {
            ui.notifications.warn(game.i18n.localize('DX3rd.ItemNotFound'));
            return;
        }
        
        // 로이스 타입이 '-' 또는 'S'인 경우 사용 메시지를 출력하지 않음
        const roisType = item.system?.type || '-';
        const shouldShowMessage = roisType !== '-' && roisType !== 'S';
        
        // 로이스 사용 메시지 출력 (타입이 '-', 'S'가 아닌 경우만)
        if (shouldShowMessage) {
            const roisLabel = game.i18n.localize('DX3rd.Rois');
            
            // 채팅에 메시지 출력
            const chatData = {
                speaker: ChatMessage.getSpeaker({ actor: actor }),
                content: `
                    ${roisLabel} ${game.i18n.localize('DX3rd.Use')}
                `,
                style: CONST.CHAT_MESSAGE_STYLES.OTHER
            };
            
            ChatMessage.create(chatData);
        }
        
        // 기존 아이템 채팅도 출력
        const sheet = actor.sheet;
        if (sheet && typeof sheet._sendItemToChat === 'function') {
            await sheet._sendItemToChat(item);
        }
    }

    /**
     * 백트랙 액션 처리
     */
    function handleBacktrackAction(actor) {
        // 액터 시트의 _onBacktrackRoll 메서드 호출
        const sheet = actor.sheet;
        if (sheet && typeof sheet._onBacktrackRoll === 'function') {
            // event 객체를 mock으로 생성
            const mockEvent = {
                preventDefault: () => {},
                stopPropagation: () => {}
            };
            sheet._onBacktrackRoll(mockEvent);
        } else {
            ui.notifications.error(game.i18n.localize('DX3rd.BacktrackNotFound'));
        }
    }

    /**
     * 액션 UI 열기
     */
    function openActionUI() {
        if (!currentToken || actionUIVisible) {
            return;
        }
        
        // Action UI가 토글된 상태일 때 scene-navigation 숨기기
        const isEnabled = getSceneActionUIState();
        if (isEnabled) {
            hideSceneNavigation();
        }
        
        createActionUI(currentToken);
    }

    /**
     * 액션 UI 닫기
     */
    function closeActionUI() {
        if (!actionUIVisible) return;
        
        removeActionUI();
        actionUIVisible = false;
    }

    /**
     * 액션 UI 제거
     */
    function removeActionUI() {
        if (actionUIContainer) {
            actionUIContainer.remove();
            actionUIContainer = null;
        }
        
        if (subActionUIContainer) {
            subActionUIContainer.remove();
            subActionUIContainer = null;
        }
        
        // 위치 추적 중지
        if (actionUIUpdateInterval) {
            cancelAnimationFrame(actionUIUpdateInterval);
            actionUIUpdateInterval = null;
        }
        
        // 전역 이벤트 리스너 플래그 리셋
        globalTimingEventListenerAdded = false;
        
        // 마우스 휠 클릭 이벤트 리스너 제거
        if (wheelClickHandler && canvas?.stage) {
            canvas.stage.off('mousedown', wheelClickHandler);
            wheelClickHandler = null;
        }
    }

    /**
     * 액션 UI 토글
     */
    function toggleActionUI() {
        if (!currentToken) return;

        if (actionUIVisible) {
            closeActionUI();
        } else {
            openActionUI();
        }
    }
    
    /**
     * 액션 UI 활성화/비활성화 토글
     */
    function toggleActionUIEnabled() {
        const currentState = getSceneActionUIState();
        const newState = !currentState;
        
        setSceneActionUIState(newState);
        
        // 버튼 상태 업데이트
        updateActionUIButtonState();
        
        // 비활성화된 경우 현재 표시 중인 UI 제거
        if (!newState && actionUIVisible) {
            removeActionUI();
            actionUIVisible = false;
            // scene-navigation 복원
            restoreSceneNavigation();
        }
        // 활성화된 경우 현재 선택된 토큰이 있으면 UI 표시
        else if (newState && currentToken && !actionUIVisible) {
            setTimeout(() => {
                openActionUI();
            }, 100);
        }
    }
    
    /**
     * 액션 UI 버튼 상태 업데이트
     */
    function updateActionUIButtonState() {
        const state = getSceneActionUIState();
        
        // Scene Controls의 active 상태 업데이트
        if (ui.controls && ui.controls.controls) {
            const tokenControls = ui.controls.controls.tokens || ui.controls.controls.token;
            if (tokenControls && tokenControls.tools) {
                if (typeof tokenControls.tools === 'object' && !Array.isArray(tokenControls.tools)) {
                    const actionUITool = tokenControls.tools['action-ui'];
                    if (actionUITool) {
                        actionUITool.active = state;
                    }
                } else if (Array.isArray(tokenControls.tools)) {
                    const actionUITool = tokenControls.tools.find(t => t.name === 'action-ui');
                    if (actionUITool) {
                        actionUITool.active = state;
                    }
                }
            }
        }
        
        // DOM 버튼 상태 업데이트
        const actionUIBtn = document.querySelector('.scene-control[data-tool="action-ui"]');
        if (actionUIBtn) {
            if (state) {
                actionUIBtn.classList.add('active');
                actionUIBtn.setAttribute('aria-pressed', 'true');
            } else {
                actionUIBtn.classList.remove('active');
                actionUIBtn.setAttribute('aria-pressed', 'false');
            }
        }
    }

    /**
     * 캔버스 이벤트 등록
     */
    function setupCanvasEvents() {
        if (!canvas || !canvas.stage) {
            console.warn('DX3rd | Canvas not ready for Action UI, retrying...');
            return;
        }

        // 기존 이벤트 리스너 제거 (중복 등록 방지)
        if (wheelClickHandler) {
            canvas.stage.off('mousedown', wheelClickHandler);
            canvas.stage.off('pointerdown', wheelClickHandler);
        }

        /**
         * 마우스 휠 클릭으로 액션 UI 토글
         * v13/v14 호환: 'mousedown'(v13)과 'pointerdown'(v14 PIXI v8) 모두 등록
         */
        wheelClickHandler = (event) => {
            if (getEventButton(event) === 1) {
                event.preventDefault?.();
                event.stopPropagation();
                if (currentToken) {
                    const isEnabled = getSceneActionUIState();
                    if (!isEnabled) return;
                    const now = Date.now();
                    if (now - lastWheelClickTime < 200) return;
                    lastWheelClickTime = now;
                    toggleActionUI();
                }
            }
        };

        canvas.stage.on('mousedown', wheelClickHandler);
        canvas.stage.on('pointerdown', wheelClickHandler);
    }

    // 전역 노출
    window.DX3rdActionUI = {
        openActionUI: openActionUI,
        closeActionUI: closeActionUI,
        toggleActionUI: toggleActionUI,
        getSceneActionUIState: getSceneActionUIState,
        toggleActionUIEnabled: toggleActionUIEnabled,
        updateActionUIButtonState: updateActionUIButtonState
    };

    // Ready 훅에서 초기화 확인
    Hooks.once('ready', () => {
        setupCanvasEvents(); // 캔버스 이벤트 등록
    });

    // 캔버스가 다시 준비될 때마다 이벤트 재등록 및 액션 UI 제거
    Hooks.on('canvasReady', () => {
        removeActionUI();
        currentToken = null;
        actionUIVisible = false;
        // scene-navigation 복원
        restoreSceneNavigation();
        setupCanvasEvents();
        
        // 버튼 상태 업데이트
        setTimeout(() => {
            updateActionUIButtonState();
        }, 100);
        
        // 이미 선택된 토큰이 있으면 초기화
        // 약간의 지연을 두어 DOM이 완전히 준비되도록 함
        setTimeout(() => {
            const controlledTokens = canvas.tokens?.controlled || [];
            if (controlledTokens.length > 0) {
                const token = controlledTokens[0];
                if (token && token.actor) {
                    currentToken = token;
                    actionUIVisible = false;
                    
                    // 액션 UI 활성화 상태 확인
                    const isEnabled = getSceneActionUIState();
                    if (isEnabled) {
                        // scene-navigation 숨기기
                        hideSceneNavigation();
                        
                        // interface 요소가 준비되었는지 확인
                        const interfaceElement = document.getElementById('interface');
                        if (interfaceElement) {
                            // 액션 UI 자동 표시
                            openActionUI();
                        } else {
                            // interface가 아직 준비되지 않았으면 조금 더 기다림
                            setTimeout(() => {
                                if (currentToken === token) {
                                    openActionUI();
                                }
                            }, 200);
                        }
                    }
                }
            }
        }, 100);
    });
    
    /**
     * Scene Controls 렌더링 후 버튼 상태 업데이트
     */
    Hooks.on('renderSceneControls', () => {
        setTimeout(() => {
            updateActionUIButtonState();
        }, 50);
    });

})();
