// DX3rd Combat UI - 전투 중 토큰 주변 버튼 표시
(function () {
    const MODULE_ID = 'dx3rd-emanim';

    // v13/v14 호환: PIXI FederatedEvent (v8) vs InteractionEvent (v7) 추상화
    function getNativeEvent(pixiEvent) {
        return pixiEvent.nativeEvent ?? pixiEvent.data?.originalEvent ?? null;
    }
    function getEventButton(pixiEvent) {
        return pixiEvent.button ?? pixiEvent.data?.button ?? -1;
    }
    function stopNativeEvent(pixiEvent) {
        const native = getNativeEvent(pixiEvent);
        if (native) {
            native.stopPropagation();
            native.preventDefault();
        }
    }

    // UniversalHandler 참조 (전역 객체에서 가져오기)
    const getUniversalHandler = () => globalThis.DX3rdUniversalHandler || window.DX3rdUniversalHandler;

    // 버튼 컨테이너
    let buttonContainer = null;
    let currentToken = null;
    let buttonUpdateInterval = null;
    let buttonsVisible = false; // 버튼 표시 여부
    let lastWheelClickTime = 0; // 마지막 휠 클릭 시간
    let currentSideControlActionType = null; // 현재 사이드 컨트롤에 표시된 액션 타입 (null이면 기본 버튼)

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
     * 토큰 선택 시 처리 (버튼은 바로 생성하지 않음)
     */
    Hooks.on('controlToken', (token, controlled) => {
        if (controlled) {
            // 토큰이 선택되었을 때
            currentToken = token;
            buttonsVisible = false; // 버튼은 숨김 상태로 시작
            
            // 사이드 컨트롤 업데이트
            const sideControlEnabled = game.settings.get('dx3rd-emanim', 'combatSideControlEnabled');
            if (sideControlEnabled) {
                // 하위 버튼 상태 초기화
                currentSideControlActionType = null;
                setTimeout(() => {
                    updateSideControlButtons();
                }, 100);
            }
        } else {
            // 토큰 선택이 해제되었을 때
            if (currentToken?.id === token.id) {
                removeCombatButtons();
                currentToken = null;
                buttonsVisible = false;
                
                // 사이드 컨트롤 버튼 초기화
                const sideControlEnabled = game.settings.get('dx3rd-emanim', 'combatSideControlEnabled');
                if (sideControlEnabled) {
                    // 하위 버튼 상태 초기화
                    currentSideControlActionType = null;
                    updateSideControlButtons();
                }
            }
        }
    });

    /**
     * 전투 버튼 생성
     */
    function createCombatButtons(token) {
        // 기존 버튼 제거
        removeCombatButtons();
        
        // PIXI 컨테이너 생성 (월드 좌표계)
        buttonContainer = new PIXI.Container();
        buttonContainer.name = 'dx3rd-combat-buttons';
        buttonContainer.zIndex = 999; // 다른 요소들 위에 표시
        buttonContainer.interactive = true; // 컨테이너도 인터랙티브하게 설정
        buttonContainer.interactiveChildren = true; // 자식 요소들도 인터랙티브
        // v13/v14 호환: canvas.interface가 없는 경우 canvas.controls로 폴백
        const interfaceLayer = canvas.interface ?? canvas.controls;
        interfaceLayer?.addChild(buttonContainer);
        
        // 버튼 컨테이너의 모든 포인터 이벤트 전파 중지 (토큰 선택 해제 방지)
        buttonContainer.on('pointerdown', (event) => {
            event.stopPropagation();
            stopNativeEvent(event);
        });

        buttonContainer.on('pointerup', (event) => {
            event.stopPropagation();
            stopNativeEvent(event);
        });

        buttonContainer.on('click', (event) => {
            event.stopPropagation();
            stopNativeEvent(event);
        });
        
        // 디버그/재생성 판단용
        buttonContainer.userData = {
            tokenWidth: token.w,
            tokenHeight: token.h
        };
        
        // 8개 버튼 생성 (좌 4개, 우 4개)
        createPixiButtons(token);
        
        // 토큰 위치 추적 시작
        startButtonTracking(token);
        
    }

    /**
     * PIXI 버튼들 생성 (월드 좌표계)
     */
    function createPixiButtons(token) {
        if (!buttonContainer || !token) return;

        // 토큰 중심 좌표 (월드 좌표계)
        const tokenCenter = token.center;
        
        // 토큰 픽셀 크기
        const tokenWidthPx = token.w;
        const tokenHeightPx = token.h;
        const tokenScale = Number(token.document.width) || 1; // 1, 2, 3...

        // ------------------ 버튼 크기 ------------------
        // 그리드 크기 기준으로 버튼 크기 계산
        const gridSize = canvas.grid.size;

        // 토큰 스케일이 2 이상이면 1.5로 제한
        const effectiveScale = Math.min(1.5, tokenScale);

        // 버튼 크기 계산
        const buttonWidth = Math.round(gridSize * 0.9 * effectiveScale);
        const buttonHeight = Math.round(gridSize * 0.3 * effectiveScale);

        // ------------------ 위치 계산 (월드 좌표계) ------------------
        const edgeGapPx = 6;
        const gapPx = 6; // 버튼 간 세로 간격

        // 1x1 기준으로 정규화 (토큰 크기와 무관하게 일정한 거리 유지)
        const normalizedWidth = tokenWidthPx / tokenScale;
        
        // 좌측 버튼 X 위치 (토큰 중심 - 정규화된 폭/5 * 스케일 - 간격 - 버튼 폭)
        const leftX = tokenCenter.x - (normalizedWidth / 2) * tokenScale - edgeGapPx - buttonWidth;
        
        // 우측 버튼 X 위치 (토큰 중심 + 정규화된 폭/5 * 스케일 + 간격)
        const rightX = tokenCenter.x + (normalizedWidth / 2) * tokenScale + edgeGapPx;

        // 버튼 설정 가져오기
        const buttonsConfig = getButtonsConfig(token.actor);

        // 좌측 버튼들 생성
        const leftButtonCount = buttonsConfig.leftButtons.length;
        if (leftButtonCount > 0) {
            // 좌측 버튼 Y 위치 계산 (버튼 개수에 따라 중앙 정렬)
            const leftTotalHeight = buttonHeight * leftButtonCount + gapPx * (leftButtonCount - 1);
            const leftStartY = tokenCenter.y - leftTotalHeight / 2;
            
            for (let i = 0; i < leftButtonCount; i++) {
                const config = buttonsConfig.leftButtons[i];
                const label = game.i18n.localize(config.label);
                const yOffset = leftStartY + i * (buttonHeight + gapPx);
                const button = createPixiButton(i, 'left', buttonWidth, buttonHeight, label);
            // userData에 추가 정보 설정 (기존 isButtonClick 유지)
            button.userData.action = config.action;
            button.userData.statKey = config.statKey;
            button.userData.side = 'left';
            button.userData.index = i;
            button.userData.yOffset = yOffset - tokenCenter.y;  // 토큰 중심 기준 상대 오프셋 저장
            button.x = leftX;
            button.y = yOffset;
            buttonContainer.addChild(button);
            }
        }

        // 우측 버튼들 생성
        const rightButtonCount = buttonsConfig.rightButtons.length;
        if (rightButtonCount > 0) {
            // 우측 버튼 Y 위치 재계산 (버튼 개수에 따라 중앙 정렬)
            const rightTotalHeight = buttonHeight * rightButtonCount + gapPx * (rightButtonCount - 1);
            const rightStartY = tokenCenter.y - rightTotalHeight / 2;
            
            for (let i = 0; i < rightButtonCount; i++) {
                const config = buttonsConfig.rightButtons[i];
                const label = game.i18n.localize(config.label);
                const yOffset = rightStartY + i * (buttonHeight + gapPx);
                const button = createPixiButton(i, 'right', buttonWidth, buttonHeight, label);
                // userData에 추가 정보 설정 (기존 isButtonClick 유지)
                button.userData.action = config.action;
                button.userData.statKey = config.statKey;
                button.userData.side = 'right';
                button.userData.index = i;
                button.userData.yOffset = yOffset - tokenCenter.y;  // 토큰 중심 기준 상대 오프셋 저장
                button.x = rightX;
                button.y = yOffset;
                buttonContainer.addChild(button);
            }
        }
    }

    /**
     * PIXI 버튼 생성
     */
    function createPixiButton(index, side, width, height, customLabel = null) {
        const button = new PIXI.Graphics();
        
        // userData 초기화 (필수)
        button.userData = {};
        
        // 기울기 적용 (-20도)
        button.skew.x = -0.35;
        
        // 원래 크기 저장
        button.userData.originalScale = { x: 1, y: 1 };

        // 버튼 배경 (var(--color-cool-5) = rgb(11, 10, 19) = 0x0B0A13, action UI와 동일)
        button.beginFill(0x0B0A13, 0.75);
        button.lineStyle(1, 0x444444, 0.6);
        button.drawRect(0, 0, width, height);
        button.endFill();

        // 버튼 텍스트 결정
        let buttonText;
        if (customLabel) {
            // 커스텀 라벨이 제공된 경우 (우측 버튼)
            buttonText = customLabel;
        } else if (side === 'left') {
            // 좌측 버튼: L1~L4 능력치 이름
            const statNames = ['Body', 'Sense', 'Mind', 'Social'];
            buttonText = game.i18n.localize(`DX3rd.${statNames[index]}`);
        } else {
            // 기본값
            buttonText = `${side === 'left' ? 'L' : 'R'}${index + 1}`;
        }
        
        // UI 버튼 폰트 설정 가져오기 (설정이 등록되지 않았을 수 있으므로 안전하게 처리)
        let uiButtonFont = '';
        try {
            uiButtonFont = game.settings.get('dx3rd-emanim', 'uiButtonFont') || '';
        } catch (e) {
            // 설정이 아직 등록되지 않았으면 빈 문자열 사용
            uiButtonFont = '';
        }
        
        const textStyle = {
            fontSize: Math.max(12, Math.min(width, height) * 0.3),
            fill: 0xFFFFFF,
            fontWeight: 'bold'
        };
        
        // 폰트가 설정되어 있으면 적용
        if (uiButtonFont) {
            textStyle.fontFamily = uiButtonFont;
        }
        
        const text = new PIXI.Text(buttonText, textStyle);
        text.anchor.set(0.5);
        text.x = width / 2;
        text.y = height / 2;
        button.addChild(text);

        // 인터랙션 설정
        button.interactive = true;
        button.buttonMode = true;
        button.cursor = 'pointer';
        
        // 클릭 플래그 초기화 (userData는 이미 함수 시작 부분에서 초기화됨)
        button.userData.isButtonClick = false;

        // 호버 효과 (action UI와 동일)
        button.on('pointerover', (event) => {
            event.stopPropagation();
            
            // 호버 사운드 재생
            playUISound('hover');
            
            button.clear();
            // 기본 배경
            button.beginFill(0x0B0A13, 1.0);
            button.lineStyle(2, 0xFF0000, 0.25);
            button.drawRect(0, 0, width, height);
            button.endFill();
            // 텍스트 색상 변경 (노란색)
            text.style.fill = 0xFFBB00;
            button.addChild(text);
        });

        button.on('pointerout', (event) => {
            event.stopPropagation();
            button.clear();
            button.beginFill(0x0B0A13, 0.75);
            button.lineStyle(1, 0x444444, 0.6);
            button.drawRect(0, 0, width, height);
            button.endFill();
            // 텍스트 색상 복귀 (흰색)
            text.style.fill = 0xFFFFFF;
            button.addChild(text);
        });

        // 클릭 이벤트 - 각 버튼마다 독립적인 클릭 플래그
        
        button.on('pointerdown', (event) => {
            // 이벤트 전파 완전히 중지 (토큰 선택 해제 방지)
            event.stopPropagation();
            stopNativeEvent(event);
            button.userData.isButtonClick = true;
        });

        button.on('pointerup', (event) => {
            // 이벤트 전파 완전히 중지
            event.stopPropagation();
            stopNativeEvent(event);

            // 버튼 클릭 처리 (pointerdown에서 시작된 경우만)
            if (button.userData.isButtonClick) {
                // 클릭 사운드 재생
                playUISound('click');

                // userData에 저장된 action과 statKey 가져오기
                const action = button.userData?.action || null;
                const statKey = button.userData?.statKey || null;
                handleButtonClick(index, side, action, statKey);
                button.userData.isButtonClick = false;
            }
        });

        // pointerupoutside에서도 처리 (버튼 밖에서 마우스를 놓은 경우)
        button.on('pointerupoutside', (event) => {
            event.stopPropagation();
            stopNativeEvent(event);
            button.userData.isButtonClick = false;
        });

        return button;
    }


    /**
     * 능력치별 기능 매핑
     */
    const STAT_SKILLS_MAP = {
        'body': ['melee', 'evade', 'ride'],
        'sense': ['ranged', 'perception', 'art'],
        'mind': ['rc', 'will', 'knowledge'],
        'social': ['negotiation', 'procure', 'info']
    };

    /**
     * 전투 프로세스 플래그 확인
     */
    function getCombatProcess() {
        if (!game.combat) return null;
        const currentProcess = game.combat.getFlag('dx3rd-emanim', 'currentProcess');
        return currentProcess; // { type: 'setup/initiative/main/cleanup', actorId, combatantId }
    }

    /**
     * 버튼 설정 결정 (전투/비전투 모드에 따라)
     */
    function getButtonsConfig(actor) {
        const process = getCombatProcess();
        
        // 사이드 컨트롤 설정이 켜져있으면 전투 중에도 비전투 모드처럼 동작
        const sideControlEnabled = game.settings.get('dx3rd-emanim', 'combatSideControlEnabled');
        
        if (!process || sideControlEnabled) {
            // 전투 없음 또는 사이드 컨트롤 활성화: R1~R4를 L1~L4로 대체, 기존 L1~L4는 숨김
            return {
                leftButtons: [], // 기존 L1~L4 숨김
                rightButtons: [
                    { label: 'DX3rd.Body', action: 'ability', statKey: 'body' },
                    { label: 'DX3rd.Sense', action: 'ability', statKey: 'sense' },
                    { label: 'DX3rd.Mind', action: 'ability', statKey: 'mind' },
                    { label: 'DX3rd.Social', action: 'ability', statKey: 'social' }
                ]
            };
        }
        
        // 전투 중 (사이드 컨트롤 비활성화): 기존 로직 유지
        let rightButtons = [];
        switch (process.type) {
            case 'setup':
                rightButtons = [
                    { label: 'DX3rd.Setup', action: 'setup' },
                    { label: 'DX3rd.Reaction', action: 'reaction' },
                    { label: 'DX3rd.Auto', action: 'auto' }
                ];
                break;
                
            case 'initiative':
                rightButtons = [
                    { label: 'DX3rd.Initiative', action: 'initiative' },
                    { label: 'DX3rd.Reaction', action: 'reaction' },
                    { label: 'DX3rd.Auto', action: 'auto' }
                ];
                break;
                
            case 'main':
                // 현재 턴을 가진 액터인가?
                const isCurrentActor = process.actorId === actor.id;
                
                if (isCurrentActor) {
                    // 메인 액터: 4개 버튼
                    rightButtons = [
                        { label: 'DX3rd.Minor', action: 'minor' },
                        { label: 'DX3rd.Major', action: 'major' },
                        { label: 'DX3rd.Auto', action: 'auto' },
                        { label: 'DX3rd.Turn', action: 'turn' }
                    ];
                } else {
                    // 대기 중인 액터: 2개 버튼
                    rightButtons = [
                        { label: 'DX3rd.Reaction', action: 'reaction' },
                        { label: 'DX3rd.Auto', action: 'auto' }
                    ];
                }
                break;
                
            case 'cleanup':
                rightButtons = [
                    { label: 'DX3rd.Cleanup', action: 'cleanup' },
                    { label: 'DX3rd.Reaction', action: 'reaction' },
                    { label: 'DX3rd.Auto', action: 'auto' }
                ];
                break;
                
            default:
                rightButtons = [];
        }
        
        return {
            leftButtons: [
                { label: 'DX3rd.Body', action: 'ability', statKey: 'body' },
                { label: 'DX3rd.Sense', action: 'ability', statKey: 'sense' },
                { label: 'DX3rd.Mind', action: 'ability', statKey: 'mind' },
                { label: 'DX3rd.Social', action: 'ability', statKey: 'social' }
            ],
            rightButtons: rightButtons
        };
    }

    /**
     * 현재 선택된 토큰을 확인하고 동기화하는 헬퍼 함수
     */
    function syncCurrentToken() {
        // 현재 선택된 토큰을 다시 확인 (동기화 문제 방지)
        const controlledTokens = canvas.tokens?.controlled || [];
        const activeToken = controlledTokens.length > 0 ? controlledTokens[0] : null;
        
        // currentToken과 실제 선택된 토큰이 다르면 동기화
        if (activeToken && activeToken !== currentToken) {
            currentToken = activeToken;
        }
        
        // 토큰이 없거나 액터가 없으면 null 반환
        if (!currentToken || !currentToken.actor) {
            // currentToken이 null이면 activeToken도 확인
            if (!activeToken || !activeToken.actor) {
                return null;
            }
            // activeToken이 있으면 사용
            currentToken = activeToken;
        }
        
        return currentToken;
    }

    /**
     * 버튼 클릭 처리
     */
    function handleButtonClick(index, side, action = null, statKey = null) {
        if (side === 'left') {
            // 좌측 버튼: 능력치/기능 선택 다이얼로그 (전투 중에만)
            const statNames = ['body', 'sense', 'mind', 'social'];
            const statKey = statNames[index];
            
            // 버튼 닫기
            closeCombatButtons();
            
            // 능력치/기능 선택 DOM 윈도우 표시
            showStatSkillWindow(statKey);
        } else {
            // 우측 버튼: 전투 액션 또는 능력치 판정
            if (!action) {
                console.warn('DX3rd | Right button action not defined');
                return;
            }
            
            // 버튼 닫기
            closeCombatButtons();
            
            if (action === 'ability') {
                // 능력치 판정 (비전투 모드)
                handleAbilityRoll(statKey);
            } else {
                // 전투 액션
            handleCombatAction(action);
            }
        }
    }

    /**
     * 능력치 판정 처리 (비전투 모드)
     */
    function handleAbilityRoll(statKey) {
        const token = syncCurrentToken();
        if (!token || !token.actor) {
            ui.notifications.warn('토큰에 연결된 액터가 없습니다.');
            return;
        }
        
        const actor = token.actor;
        const statLabel = game.i18n.localize(`DX3rd.${statKey.charAt(0).toUpperCase() + statKey.slice(1)}`);
        
        // UniversalHandler를 통한 판정 실행
        const handler = getUniversalHandler();
        if (handler && handler.showStatRollConfirmDialog) {
            const sheet = actor.sheet;
            const comboCallback = (sheet && typeof sheet._openComboBuilder === 'function') 
                ? sheet._openComboBuilder.bind(sheet)
                : null;
            
            handler.showStatRollConfirmDialog(
                actor,
                'ability',
                statKey,
                comboCallback
            );
        } else {
            console.error('DX3rd | UniversalHandler not found!');
        }
    }

    /**
     * 전투 액션 다이얼로그 표시
     */
    function showCombatActionDialog(actionType, actionLabel) {
        const token = syncCurrentToken();
        if (!token || !token.actor) {
            ui.notifications.warn('토큰에 연결된 액터가 없습니다.');
            return;
        }
        
        const actor = token.actor;
        
        // 액션별 버튼 설정 가져오기
        const actionButtons = getActionButtons(actionType, actor);
        
        // DOM 윈도우 생성
        const dialogWindow = document.createElement('div');
        dialogWindow.className = 'dx3rd-timing-action-window';
        dialogWindow.innerHTML = `
            <div class="dx3rd-timing-action-header" style="cursor: move;">
                <h3>${actionLabel}</h3>
                <button class="dx3rd-timing-action-close-btn" title="닫기">×</button>
            </div>
            <div class="dx3rd-timing-action-content">
                <div class="dx3rd-timing-action-buttons">
                    ${actionButtons.map(button => `
                        <button class="dx3rd-timing-action-btn" data-action="${button.action}" data-type="${button.type || ''}" data-timing="${button.timing || ''}">
                            ${button.label}
                        </button>
                    `).join('')}
                </div>
            </div>
        `;
        
        document.body.appendChild(dialogWindow);
        
        // 이벤트 설정
        setupTimingActionWindowEvents(dialogWindow, actionType);
        
        // 드래그 설정
        setupTimingActionWindowDragging(dialogWindow);
        
        // 애니메이션
        setTimeout(() => {
            dialogWindow.classList.add('dx3rd-timing-action-window-open');
        }, 10);
    }
    
    /**
     * 타이밍 액션 윈도우 이벤트 설정
     */
    function setupTimingActionWindowEvents(dialogWindow, actionType) {
        const $window = $(dialogWindow);
        
        // 닫기 버튼
        $window.find('.dx3rd-timing-action-close-btn').on('click', () => {
            playUISound('click');
            closeTimingActionWindow(dialogWindow);
        }).on('mouseenter', () => {
            playUISound('hover');
        });
        
        // 액션 버튼 클릭
        $window.find('.dx3rd-timing-action-btn').on('click', (event) => {
            const $btn = $(event.currentTarget);
            const action = $btn.data('action');
            const type = $btn.data('type');
            const timing = $btn.data('timing');
            
            playUISound('click');
            closeTimingActionWindow(dialogWindow);
            handleActionButtonClick(actionType, action, timing);
        }).on('mouseenter', () => {
            playUISound('hover');
        });
    }
    
    /**
     * 타이밍 액션 윈도우 드래그 설정
     */
    function setupTimingActionWindowDragging(dialogWindow) {
        const header = dialogWindow.querySelector('.dx3rd-timing-action-header');
        let isDragging = false;
        let currentX = 0;
        let currentY = 0;
        let initialX = 0;
        let initialY = 0;
        
        header.addEventListener('mousedown', (e) => {
            if (e.target.closest('.dx3rd-timing-action-close-btn')) return;
            
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
     * 타이밍 액션 윈도우 닫기
     */
    function closeTimingActionWindow(dialogWindow) {
        dialogWindow.classList.remove('dx3rd-timing-action-window-open');
        setTimeout(() => {
            dialogWindow.remove();
        }, 200);
    }
    
    /**
     * 액션별 버튼 설정 가져오기
     */
    function getActionButtons(actionType, actor) {
        const buttons = [];
        
        // 액션 타입별 기본 버튼들
        switch (actionType) {
            case 'setup':
                // 셋업 타이밍 아이템들 확인
                addTimingBasedButtons(buttons, actor, 'setup');
                break;
                
            case 'initiative':
                // 이니셔티브 타이밍 아이템들 확인
                addTimingBasedButtons(buttons, actor, 'initiative');
                break;
                
            case 'minor':
                // 마이너 타이밍 아이템들 확인
                addTimingBasedButtons(buttons, actor, 'minor');
                // 기본 마이너 액션 (이동 버튼 먼저)
                buttons.push(
                    { action: 'battleMove', label: game.i18n.localize('DX3rd.BattleMove') }
                );
                break;
                
            case 'major':
                // 메이저 타이밍 아이템들 확인
                addTimingBasedButtons(buttons, actor, 'major');
                // 기본 메이저 액션 (이동 버튼 먼저)
                buttons.push(
                    { action: 'fullMove', label: game.i18n.localize('DX3rd.FullMove') }
                );
                break;
                
            case 'reaction':
                // 기본 판정 진입점: 닷지(회피) / 리액션(방어) 선택 후 해당 롤 타입으로만 판정
                buttons.push(
                    { action: 'reactionStatRoll', timing: 'dodge', label: game.i18n.localize('DX3rd.RollAsDodge') },
                    { action: 'reactionStatRoll', timing: 'reaction', label: game.i18n.localize('DX3rd.RollAsReaction') }
                );
                // 리액션 타이밍 아이템들 확인
                addTimingBasedButtons(buttons, actor, 'reaction');
                break;
                
            case 'auto':
                // 오토 타이밍 아이템들 확인
                addTimingBasedButtons(buttons, actor, 'auto');
                break;

            case 'cleanup':
                // 클린업 타이밍 아이템들 확인
                addTimingBasedButtons(buttons, actor, 'cleanup');
                break;
        }

        // 모든 액션에 "그 외" 버튼 추가 (항상 마지막)
        buttons.push({
            action: 'etc',
            label: game.i18n.localize('DX3rd.etcAction')
        });
        
        return buttons;
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

    /**
     * 타이밍에 따른 버튼 추가
     */
    function addTimingBasedButtons(buttons, actor, timing) {
        if (!actor || !actor.items) return;
        
        // 콤보 아이템 확인
        let comboItems = actor.items.filter(item => 
            item.type === 'combo' && 
            item.system?.timing === timing
        );
        
        // major-reaction 타이밍 아이템은 major와 reaction 둘 다에서 포함
        if (timing === 'major' || timing === 'reaction') {
            const majorReactionItems = actor.items.filter(item => 
                item.type === 'combo' && 
                item.system?.timing === 'major-reaction'
            );
            comboItems = comboItems.concat(majorReactionItems);
        }
        
        if (comboItems.length > 0) {
            buttons.push({
                action: 'combo',
                label: `${game.i18n.localize('DX3rd.Combo')} ${game.i18n.localize('DX3rd.Use')}`,
                type: 'combo',
                timing: timing
            });
        }
        
        // 이펙트 아이템 확인 (normal 타입만)
        let effectItems = actor.items.filter(item => 
            item.type === 'effect' && 
            item.system?.timing === timing &&
            item.system?.type === 'normal'
        );
        
        // major-reaction 타이밍 아이템은 major와 reaction 둘 다에서 포함
        if (timing === 'major' || timing === 'reaction') {
            const majorReactionItems = actor.items.filter(item => 
                item.type === 'effect' && 
                item.system?.timing === 'major-reaction' &&
                item.system?.type === 'normal'
            );
            effectItems = effectItems.concat(majorReactionItems);
        }
        
        if (effectItems.length > 0) {
            buttons.push({
                action: 'effect',
                label: `${game.i18n.localize('DX3rd.Effect')} ${game.i18n.localize('DX3rd.Use')}`,
                type: 'effect',
                timing: timing
            });
        }
        
        // 사이오닉 아이템 확인
        let psionicItems = actor.items.filter(item => 
            item.type === 'psionic' && 
            item.system?.timing === timing
        );
        
        // major-reaction 타이밍 아이템은 major와 reaction 둘 다에서 포함
        if (timing === 'major' || timing === 'reaction') {
            const majorReactionItems = actor.items.filter(item => 
                item.type === 'psionic' && 
                item.system?.timing === 'major-reaction'
            );
            psionicItems = psionicItems.concat(majorReactionItems);
        }
        
        if (psionicItems.length > 0) {
            buttons.push({
                action: 'psionic',
                label: `${game.i18n.localize('DX3rd.Psionic')} ${game.i18n.localize('DX3rd.Use')}`,
                type: 'psionic',
                timing: timing
            });
        }
        
        // 스펠 아이템 확인 (타이밍별로 다르게 처리)
        if (timing === 'minor') {
            // 마이너: system.roll이 '-'인 스펠
            const minorSpellItems = actor.items.filter(item => 
                item.type === 'spell' && 
                item.system?.roll === '-'
            );
            if (minorSpellItems.length > 0) {
                buttons.push({
                    action: 'spell',
                    label: `${game.i18n.localize('DX3rd.Spell')} ${game.i18n.localize('DX3rd.Use')}`,
                    type: 'spell',
                    timing: 'minor'
                });
            }
        } else if (timing === 'major') {
            // 메이저: system.roll이 'CastingRoll'인 스펠
            const majorSpellItems = actor.items.filter(item => 
                item.type === 'spell' && 
                item.system?.roll === 'CastingRoll'
            );
            if (majorSpellItems.length > 0) {
                buttons.push({
                    action: 'spell',
                    label: `${game.i18n.localize('DX3rd.Spell')} ${game.i18n.localize('DX3rd.Use')}`,
                    type: 'spell',
                    timing: 'major'
                });
            }
        }
        
        // 모든 타이밍에 아이템 사용 버튼 추가
        const allItemItems = actor.items.filter(item => 
            ['weapon', 'protect', 'vehicle', 'book', 'connection', 'etc', 'once'].includes(item.type)
        );
        if (allItemItems.length > 0) {
            buttons.push({
                action: 'item',
                label: `${game.i18n.localize('DX3rd.Item')} ${game.i18n.localize('DX3rd.Use')}`,
                type: 'item',
                timing: timing
            });
        }
        
        // 마이너와 메이저에만 상태이상 해제 버튼 추가 (이동 버튼들 아래)
        if (timing === 'minor' || timing === 'major') {
            const hasClearableConditions = checkClearableConditions(actor, timing);
            if (hasClearableConditions.length > 0) {
                buttons.push({
                    action: 'conditionClear',
                    label: game.i18n.localize('DX3rd.ConditionClear'),
                    type: 'conditionClear',
                    timing: timing
                });
            }
        }
    }
    
    /**
     * 해제 가능한 상태이상 확인
     */
    function checkClearableConditions(actor, timing) {
        if (!actor || !actor.effects) return [];
        
        const clearableConditions = [];
        
        // 공통 해제 가능 상태이상
        const commonConditions = ['rigor', 'pressure'];
        
        // 마이너 전용 상태이상
        const minorBerserkTypes = ['normal', 'release', 'hunger', 'bloodsucking', 'slaughter', 'destruction', 'tourture', 'distaste', 'delusion', 'fear', 'hatred'];
        
        // 메이저 전용 상태이상 (마이너 + battlelust)
        const majorBerserkTypes = [...minorBerserkTypes, 'battlelust'];
        
        const targetBerserkTypes = timing === 'minor' ? minorBerserkTypes : majorBerserkTypes;
        
        // 액터의 현재 상태이상 확인
        for (const effect of actor.effects) {
            const statuses = Array.from(effect.statuses || []);
            for (const status of statuses) {
                // 공통 상태이상 확인
                if (commonConditions.includes(status)) {
                    clearableConditions.push(status);
                }
                // berserk 상태이상 확인
                else if (status === 'berserk') {
                    const berserkType = actor.system?.conditions?.berserk?.type;
                    if (berserkType && targetBerserkTypes.includes(berserkType)) {
                        clearableConditions.push(`berserk-${berserkType}`);
                    }
                }
            }
        }
        
        return clearableConditions;
    }
    
    /**
     * 액션 버튼 클릭 처리
     * @param {string} actionType - 액션 타입 (setup, initiative, minor, major, reaction, auto, cleanup)
     * @param {string} action - 액션 (combo, effect, psionic, spell, item, battleMove, fullMove, etc)
     * @param {string} type - 타이밍 또는 타입 (콤보/이펙트/사이오닉의 경우 timing, 다른 경우는 타입)
     */
    function handleActionButtonClick(actionType, action, type) {
        // 토큰 동기화 (모든 액션 처리 전에 먼저 확인)
        const token = syncCurrentToken();
        if (!token || !token.actor) {
            ui.notifications.warn('토큰에 연결된 액터가 없습니다.');
            return;
        }
        
        if (action === 'etc') {
            // "그 외" 액션 처리
            handleEtcAction(actionType);
        } else if (action === 'effect') {
            // 이펙트 사용 처리
            showEffectSelectionDialog(actionType, type);
        } else if (action === 'combo') {
            // 콤보 사용 처리
            showComboSelectionDialog(actionType, type);
        } else if (action === 'item') {
            // 아이템 사용 처리
            showItemSelectionDialog(actionType, type);
        } else if (action === 'psionic') {
            // 사이오닉 사용 처리
            showPsionicSelectionDialog(actionType, type);
        } else if (action === 'spell') {
            // 스펠 사용 처리
            showSpellSelectionDialog(actionType, type);
        } else if (action === 'battleMove') {
            // 전투 이동 처리
            handleBattleMove(actionType);
        } else if (action === 'fullMove') {
            // 전력 이동 처리
            handleFullMove(actionType);
        } else if (action === 'conditionClear') {
            // 상태이상 해제 처리
            showConditionClearDialog(actionType, type);
        } else if (action === 'reactionStatRoll') {
            // 리액션 기본 판정: type에 롤 모드('dodge'|'reaction')가 실려 옴
            openReactionRollPicker(type);
        } else {
            // 다른 액션들 처리
            // TODO: 각 액션별 처리 구현
            ui.notifications.info(`${actionType} 액션: ${action} 실행`);
        }
    }
    
    /**
     * 이펙트 선택 다이얼로그 표시
     */
    function showEffectSelectionDialog(actionType, timing) {
        const token = syncCurrentToken();
        if (!token || !token.actor) {
            ui.notifications.warn('토큰에 연결된 액터가 없습니다.');
            return;
        }
        
        const actor = token.actor;
        
        // 해당 타이밍의 이펙트 아이템들 가져오기 (normal 타입만)
        let effectItems = actor.items.filter(item => 
            item.type === 'effect' && 
            item.system?.timing === timing &&
            item.system?.type === 'normal'
        );
        
        // major-reaction 타이밍 아이템은 major와 reaction 둘 다에서 포함
        if (timing === 'major' || timing === 'reaction') {
            const majorReactionItems = actor.items.filter(item => 
                item.type === 'effect' && 
                item.system?.timing === 'major-reaction' &&
                item.system?.type === 'normal'
            );
            effectItems = effectItems.concat(majorReactionItems);
        }
        
        effectItems = sortAndFilterItemsByLimit(effectItems, actor);
        
        if (effectItems.length === 0) {
            ui.notifications.warn('사용할 수 있는 이펙트가 없습니다.');
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
                <button class="dx3rd-item-selection-close-btn" title="닫기">×</button>
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
     * 이펙트 아이템 클릭 처리
     */
    async function handleEffectItemClick(actor, itemId) {
        const item = actor?.items.get(itemId);
        
        if (!item) {
            ui.notifications.warn('아이템을 찾을 수 없습니다.');
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
     * 콤보 선택 다이얼로그 표시
     */
    function showComboSelectionDialog(actionType, timing) {
        const token = syncCurrentToken();
        if (!token || !token.actor) {
            ui.notifications.warn('토큰에 연결된 액터가 없습니다.');
            return;
        }
        
        const actor = token.actor;
        
        // 해당 타이밍의 콤보 아이템들 가져오기
        let comboItems = actor.items.filter(item => 
            item.type === 'combo' && 
            item.system?.timing === timing
        );
        
        // major-reaction 타이밍 아이템은 major와 reaction 둘 다에서 포함
        if (timing === 'major' || timing === 'reaction') {
            const majorReactionItems = actor.items.filter(item => 
                item.type === 'combo' && 
                item.system?.timing === 'major-reaction'
            );
            comboItems = comboItems.concat(majorReactionItems);
        }
        
        comboItems = sortAndFilterItemsByLimit(comboItems, actor);
        
        if (comboItems.length === 0) {
            ui.notifications.warn('사용할 수 있는 콤보가 없습니다.');
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
                <button class="dx3rd-item-selection-close-btn" title="닫기">×</button>
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
     * 콤보 아이템 클릭 처리
     */
    async function handleComboItemClick(actor, itemId) {
        const item = actor?.items.get(itemId);
        
        if (!item) {
            ui.notifications.warn('아이템을 찾을 수 없습니다.');
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
     * 아이템 선택 다이얼로그 표시
     */
    function showItemSelectionDialog(actionType, timing) {
        const token = syncCurrentToken();
        if (!token || !token.actor) {
            ui.notifications.warn('토큰에 연결된 액터가 없습니다.');
            return;
        }
        
        const actor = token.actor;
        
        // 모든 아이템 아이템들 가져오기 (종별별로 정렬)
        let itemItems = actor.items.filter(item => 
            ['weapon', 'protect', 'vehicle', 'book', 'connection', 'etc', 'once'].includes(item.type)
        );
        
        // Exhausted 아이템 제외
        itemItems = itemItems.filter(item => !window.DX3rdItemExhausted?.isItemExhausted(item));
        
        // 아이템을 종별별로 정렬
        const itemTypeOrder = ['weapon', 'protect', 'vehicle', 'book', 'connection', 'etc', 'once'];
        const sortedItems = itemItems.sort((a, b) => {
            const aType = a.type || 'etc';
            const bType = b.type || 'etc';
            const aIndex = itemTypeOrder.indexOf(aType);
            const bIndex = itemTypeOrder.indexOf(bType);
            
            // 종별이 같으면 이름순으로 정렬
            if (aIndex === bIndex) {
                return a.name.localeCompare(b.name);
            }
            
            return aIndex - bIndex;
        });
        
        if (sortedItems.length === 0) {
            ui.notifications.warn('사용할 수 있는 아이템이 없습니다.');
            return;
        }
        
        const actionLabel = game.i18n.localize(`DX3rd.${actionType.charAt(0).toUpperCase() + actionType.slice(1)}`);
        const itemLabel = game.i18n.localize('DX3rd.Item');
        
        // DOM 윈도우 생성
        const dialogWindow = document.createElement('div');
        dialogWindow.className = 'dx3rd-item-selection-window';
        dialogWindow.innerHTML = `
            <div class="dx3rd-item-selection-header" style="cursor: move;">
                <h3>${actionLabel}: ${itemLabel} ${game.i18n.localize('DX3rd.Use')}</h3>
                <button class="dx3rd-item-selection-close-btn" title="닫기">×</button>
            </div>
            <div class="dx3rd-item-selection-content">
                <div class="dx3rd-item-selection-buttons">
                    ${sortedItems.map(item => {
                        const name = item.name.split('||')[0].trim();
                        const itemType = item.type || 'etc';
                        const typeLabel = game.i18n.localize(`DX3rd.${itemType.charAt(0).toUpperCase() + itemType.slice(1)}`);
                        return `
                            <button class="dx3rd-item-selection-btn" data-item-id="${item.id}">
                                ${name}(${typeLabel})
                            </button>
                        `;
                    }).join('')}
                </div>
            </div>
        `;
        
        document.body.appendChild(dialogWindow);
        
        // 이벤트 설정
        setupItemSelectionWindowEvents(dialogWindow, actor, 'item', actionType);
        
        // 드래그 설정
        setupItemSelectionWindowDragging(dialogWindow);
        
        // 애니메이션
        setTimeout(() => {
            dialogWindow.classList.add('dx3rd-item-selection-window-open');
        }, 10);
    }
    
    /**
     * 사이오닉 선택 다이얼로그 표시
     */
    function showPsionicSelectionDialog(actionType, timing) {
        const token = syncCurrentToken();
        if (!token || !token.actor) {
            ui.notifications.warn('토큰에 연결된 액터가 없습니다.');
            return;
        }
        
        const actor = token.actor;
        
        // 해당 타이밍의 사이오닉 아이템들 가져오기
        let psionicItems = actor.items.filter(item => 
            item.type === 'psionic' && 
            item.system?.timing === timing
        );
        
        // major-reaction 타이밍 아이템은 major와 reaction 둘 다에서 포함
        if (timing === 'major' || timing === 'reaction') {
            const majorReactionItems = actor.items.filter(item => 
                item.type === 'psionic' && 
                item.system?.timing === 'major-reaction'
            );
            psionicItems = psionicItems.concat(majorReactionItems);
        }
        
        psionicItems = sortAndFilterItemsByLimit(psionicItems, actor);
        
        if (psionicItems.length === 0) {
            ui.notifications.warn('사용할 수 있는 사이오닉이 없습니다.');
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
                <button class="dx3rd-item-selection-close-btn" title="닫기">×</button>
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
     * 스펠 선택 다이얼로그 표시
     */
    function showSpellSelectionDialog(actionType, timing) {
        const token = syncCurrentToken();
        if (!token || !token.actor) {
            ui.notifications.warn('토큰에 연결된 액터가 없습니다.');
            return;
        }
        
        const actor = token.actor;
        
        // 타이밍에 따른 스펠 아이템들 가져오기
        let spellItems = [];
        if (timing === 'minor') {
            // 마이너: system.roll이 '-'인 스펠
            spellItems = actor.items.filter(item => 
                item.type === 'spell' && 
                item.system?.roll === '-'
            );
        } else if (timing === 'major') {
            // 메이저: system.roll이 'CastingRoll'인 스펠
            spellItems = actor.items.filter(item => 
                item.type === 'spell' && 
                item.system?.roll === 'CastingRoll'
            );
        }
        
        // Exhausted 아이템 제외
        spellItems = spellItems.filter(item => !window.DX3rdItemExhausted?.isItemExhausted(item));
        
        if (spellItems.length === 0) {
            ui.notifications.warn('사용할 수 있는 스펠이 없습니다.');
            return;
        }
        
        const actionLabel = game.i18n.localize(`DX3rd.${actionType.charAt(0).toUpperCase() + actionType.slice(1)}`);
        const spellLabel = game.i18n.localize('DX3rd.Spell');
        
        // DOM 윈도우 생성
        const dialogWindow = document.createElement('div');
        dialogWindow.className = 'dx3rd-item-selection-window';
        dialogWindow.innerHTML = `
            <div class="dx3rd-item-selection-header" style="cursor: move;">
                <h3>${actionLabel}: ${spellLabel} ${game.i18n.localize('DX3rd.Use')}</h3>
                <button class="dx3rd-item-selection-close-btn" title="닫기">×</button>
            </div>
            <div class="dx3rd-item-selection-content">
                <div class="dx3rd-item-selection-buttons">
                    ${spellItems.map(item => {
                        const name = item.name.split('||')[0].trim();
                        const cost = item.system?.encroach?.value || '-';
                        const costText = cost === '-' ? '' : ` (${game.i18n.localize('DX3rd.Encroach')}: ${cost})`;
                        
                        // CastingRoll인 경우 invoke/evocation 값 표시
                        let invokeEvocationText = '';
                        if (item.system?.roll === 'CastingRoll') {
                            const invoke = item.system?.invoke?.value || 0;
                            const evocation = item.system?.evocation?.value || 0;
                            invokeEvocationText = ` (${invoke}/${evocation})`;
                        }
                        
                        return `
                            <button class="dx3rd-item-selection-btn" data-item-id="${item.id}">
                                ${name}${invokeEvocationText}${costText}
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
            
            if (itemType === 'effect') {
                await handleEffectItemClick(actor, itemId);
            } else if (itemType === 'combo') {
                await handleComboItemClick(actor, itemId);
            } else if (itemType === 'item') {
                await handleItemItemClick(actor, itemId, actionType);
            } else if (itemType === 'psionic') {
                await handlePsionicItemClick(actor, itemId);
            } else if (itemType === 'spell') {
                await handleSpellItemClick(actor, itemId);
            }
            
            // 아이템 사용 후 사이드 컨트롤을 기본 상태로 되돌림
            const sideControlEnabled = game.settings.get('dx3rd-emanim', 'combatSideControlEnabled');
            if (sideControlEnabled) {
                currentSideControlActionType = null;
                updateSideControlButtons();
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
     * 사이오닉 아이템 클릭 처리
     */
    async function handlePsionicItemClick(actor, itemId) {
        const item = actor?.items.get(itemId);
        
        if (!item) {
            ui.notifications.warn('아이템을 찾을 수 없습니다.');
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
            ui.notifications.warn('아이템을 찾을 수 없습니다.');
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
            ui.notifications.warn('아이템을 찾을 수 없습니다.');
            return;
        }
        
        // 아이템 사용 메시지 출력
        const actionLabel = game.i18n.localize(`DX3rd.${actionType.charAt(0).toUpperCase() + actionType.slice(1)}`);
        const itemLabel = game.i18n.localize('DX3rd.Item');
        
        // 채팅에 메시지 출력
        const chatData = {
            speaker: {
                actor: actor.id,
                alias: actor.name
            },
            content: `
                ${actionLabel}: ${itemLabel} ${game.i18n.localize('DX3rd.Use')}
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
     * "그 외" 액션 처리
     */
    function handleEtcAction(actionType) {
        const token = syncCurrentToken();
        if (!token || !token.actor) {
            ui.notifications.warn('토큰에 연결된 액터가 없습니다.');
            return;
        }
        
        const actionLabel = game.i18n.localize(`DX3rd.${actionType.charAt(0).toUpperCase() + actionType.slice(1)}`);
        const etcActionLabel = game.i18n.localize('DX3rd.etcAction');
        
        // 액션 타입별 타이밍 키 매핑
        const timingKeyMap = {
            'setup': 'DX3rd.Setup',
            'initiative': 'DX3rd.Init', 
            'minor': 'DX3rd.MinorAction',
            'major': 'DX3rd.MajorAction',
            'reaction': 'DX3rd.Reaction',
            'auto': 'DX3rd.Auto',
            'cleanup': 'DX3rd.Cleanup'
        };
        
        const timingKey = timingKeyMap[actionType] || actionLabel;
        const timingLabel = game.i18n.localize(timingKey);
        const description = game.i18n.localize('DX3rd.etcActionDescription').replace('{timing}', timingLabel);
        
        // 채팅에 메시지 출력
        const chatData = {
            speaker: ChatMessage.getSpeaker({ actor: token.actor }),
            content: `
                ${actionLabel}: ${etcActionLabel} <br>
                ${description}
            `,
            style: CONST.CHAT_MESSAGE_STYLES.OTHER
        };
        
        ChatMessage.create(chatData);
    }

    /**
     * 턴 종료 처리
     */
    function handleTurnEnd() {
        const token = syncCurrentToken();
        if (!token || !token.actor) {
            ui.notifications.warn('토큰에 연결된 액터가 없습니다.');
            return;
        }
        
        const actor = token.actor;
        
        const combatant = game.combat.combatants.find(c => c.actor && c.actor.id === actor.id);
        
        if (!combatant) {
            ui.notifications.warn('현재 액터가 전투에 참여하지 않았습니다.');
            return;
        }
        
        // 현재 턴이 이 액터의 턴인지 확인
        if (game.combat.current.combatantId !== combatant.id) {
            ui.notifications.warn('현재 턴이 아닙니다.');
            return;
        }
        
        // NextTurn 실행
        game.combat.nextTurn();
    }

    /**
     * GM 전용: 이니셔티브 실행 (Setup → Initiative)
     */
    function handleGMInitiative() {
        if (!game.user.isGM) {
            ui.notifications.warn('GM만 사용할 수 있습니다.');
            return;
        }
        
        if (!game.combat) {
            ui.notifications.warn('진행 중인 전투가 없습니다.');
            return;
        }
        
        const process = getCombatProcess();
        if (!process || process.type !== 'setup') {
            ui.notifications.warn('Setup 프로세스에서만 실행할 수 있습니다.');
            return;
        }
        
        // Initiative 프로세스로 전환
        game.combat.nextTurn();
    }

    /**
     * GM 전용: 다음 라운드 (Cleanup → Setup)
     */
    function handleGMNextRound() {
        if (!game.user.isGM) {
            ui.notifications.warn('GM만 사용할 수 있습니다.');
            return;
        }
        
        if (!game.combat) {
            ui.notifications.warn('진행 중인 전투가 없습니다.');
            return;
        }
        
        const process = getCombatProcess();
        if (!process || process.type !== 'cleanup') {
            ui.notifications.warn('Cleanup 프로세스에서만 실행할 수 있습니다.');
            return;
        }
        
        // 다음 라운드로
        game.combat.nextRound();
    }

    /**
     * 전투 액션 처리
     */
    function handleCombatAction(action) {
        const token = syncCurrentToken();
        if (!token || !token.actor) {
            ui.notifications.warn('토큰에 연결된 액터가 없습니다.');
            return;
        }
        
        const actor = token.actor;
        const actionLabel = game.i18n.localize(`DX3rd.${action.charAt(0).toUpperCase() + action.slice(1)}`);
        
        switch (action) {
            case 'setup':
                showCombatActionDialog('setup', actionLabel);
                break;
                
            case 'initiative':
                showCombatActionDialog('initiative', actionLabel);
                break;
                
            case 'minor':
                showCombatActionDialog('minor', actionLabel);
                break;
                
            case 'major':
                showCombatActionDialog('major', actionLabel);
                break;
                
            case 'reaction':
                showCombatActionDialog('reaction', actionLabel);
                break;
                
            case 'auto':
                showCombatActionDialog('auto', actionLabel);
                break;
                
            case 'cleanup':
                showCombatActionDialog('cleanup', actionLabel);
                break;
                
            case 'turn':
                handleTurnEnd();
                break;
                
            default:
                console.warn('DX3rd | Unknown combat action:', action);
        }
    }

    /**
     * 토큰 위치 추적 시작 (60fps)
     */
    function startButtonTracking(token) {
        // 기존 애니메이션 프레임 취소
        if (buttonUpdateInterval) {
            cancelAnimationFrame(buttonUpdateInterval);
        }
        
        // 재귀적으로 requestAnimationFrame 호출 (60fps)
        function updateLoop() {
            if (currentToken && buttonContainer && currentToken.id === token.id) {
                updateButtonPosition(token);
                buttonUpdateInterval = requestAnimationFrame(updateLoop);
            } else {
                // 토큰이 없거나 변경되었으면 추적 중지
                buttonUpdateInterval = null;
            }
        }
        
        // 첫 프레임 시작
        buttonUpdateInterval = requestAnimationFrame(updateLoop);
    }
    
    /**
     * 버튼 위치 업데이트 (월드 좌표계)
     */
    function updateButtonPosition(token) {
        if (!buttonContainer || !token) return;
        
        // 토큰 중심 좌표 (월드 좌표계)
        const tokenCenter = token.center;
        
        // 토큰 픽셀 크기
        const tokenWidthPx = token.w;
        const tokenHeightPx = token.h;
        const tokenScale = Number(token.document.width) || 1;
        
        // 그리드 크기
        const gridSize = canvas.grid.size;
        const effectiveScale = Math.min(1.5, tokenScale);
        
        // 버튼 크기
        const buttonWidth = Math.round(gridSize * 0.9 * effectiveScale);
        
        const edgeGapPx = 6;
        
        // 1x1 기준으로 정규화
        const normalizedWidth = tokenWidthPx / tokenScale;
        
        // 좌측/우측 버튼 X 위치
        const leftX = tokenCenter.x - (normalizedWidth / 2) * tokenScale - edgeGapPx - buttonWidth;
        const rightX = tokenCenter.x + (normalizedWidth / 2) * tokenScale + edgeGapPx;
        
        // 각 버튼의 저장된 오프셋을 사용하여 위치 업데이트
        buttonContainer.children.forEach((button) => {
            const yOffset = button.userData?.yOffset || 0;
            const side = button.userData?.side;
            
            // X 위치만 업데이트 (Y는 생성 시 저장된 오프셋 사용)
            button.x = side === 'left' ? leftX : rightX;
            button.y = tokenCenter.y + yOffset;
        });
    }


    /**
     * 전투 버튼 제거
     */
    function removeCombatButtons() {
        if (buttonContainer) {
            buttonContainer.destroy({ children: true });
            buttonContainer = null;
        }
        
        // 위치 추적 중지 (requestAnimationFrame 취소)
        if (buttonUpdateInterval) {
            cancelAnimationFrame(buttonUpdateInterval);
            buttonUpdateInterval = null;
        }
    }

    // 토큰 크기 변경 시 버튼 재생성
    Hooks.on('refreshToken', (token) => {
        if (currentToken?.id === token.id && buttonContainer) {
            // 토큰 크기가 실제로 변경되었을 때만 재생성
            const newWidth = token.w;
            const newHeight = token.h;

            // 기존 크기와 비교 (첫 번째 생성이 아닌 경우에만)
            if (buttonContainer.userData?.tokenWidth !== newWidth ||
                buttonContainer.userData?.tokenHeight !== newHeight) {

                // 기존 버튼들 제거
                buttonContainer.removeChildren();
                // 새 버튼들 생성
                createPixiButtons(token);
                // 크기 정보 업데이트
                buttonContainer.userData = { tokenWidth: newWidth, tokenHeight: newHeight };
            }
        }
    });


    /**
     * 캔버스 이벤트 등록
     */
    function setupCanvasEvents() {
        if (!canvas || !canvas.stage) {
            console.warn('DX3rd | Canvas not ready, retrying...');
            return;
        }

        /**
         * 마우스 휠 클릭으로 버튼 토글
         * v13/v14 호환: 'mousedown'(v13)과 'pointerdown'(v14 PIXI v8) 모두 등록
         */
        const _wheelClickHandler = (event) => {
            if (getEventButton(event) === 1) {
                event.preventDefault?.();
                event.stopPropagation();
                if (currentToken) {
                    const now = Date.now();
                    if (now - lastWheelClickTime < 200) return;
                    lastWheelClickTime = now;
                    toggleCombatButtons();
                }
            }
        };
        canvas.stage.on('mousedown', _wheelClickHandler);
        canvas.stage.on('pointerdown', _wheelClickHandler);

        /**
         * 캔버스 좌클릭 시 버튼 닫기
         * v13/v14 호환: 'click'(v13)과 'pointertap'(v14 PIXI v8) 모두 등록
         */
        const _leftClickHandler = (event) => {
            if (getEventButton(event) !== 0) return;
            if (buttonsVisible && buttonContainer) {
                let clickedButton = false;
                if (event.target) {
                    if (event.target === buttonContainer) clickedButton = true;
                    let current = event.target;
                    while (current && current !== canvas.stage) {
                        if (current === buttonContainer || current.parent === buttonContainer) {
                            clickedButton = true;
                            break;
                        }
                        current = current.parent;
                    }
                }
                if (!clickedButton) closeCombatButtons();
            }
        };
        canvas.stage.on('click', _leftClickHandler);
        canvas.stage.on('pointertap', _leftClickHandler);

        /**
         * 우클릭으로 버튼 닫기
         * v13/v14 호환: 'rightclick'(v13)과 'rightdown'(v14 PIXI v8) 모두 등록
         */
        const _rightClickHandler = () => {
            if (buttonsVisible && buttonContainer) closeCombatButtons();
        };
        canvas.stage.on('rightclick', _rightClickHandler);
        canvas.stage.on('rightdown', _rightClickHandler);
    }


    /**
     * 능력치/기능 선택 DOM 윈도우 표시
     */
    /**
     * 리액션 기본 판정용 능력치 선택 창
     * 닷지/리액션 중 무엇으로 굴릴지는 rollMode('dodge'|'reaction')로 고정되며,
     * 능력치 선택 → showStatSkillWindow(statKey, rollMode)로 이어진다.
     * @param {string} rollMode - 'dodge'(닷지/회피) 또는 'reaction'(리액션/방어)
     */
    function openReactionRollPicker(rollMode) {
        const token = syncCurrentToken();
        if (!token || !token.actor) {
            ui.notifications.warn('토큰에 연결된 액터가 없습니다.');
            return;
        }

        const actor = token.actor;
        const modeLabel = game.i18n.localize(rollMode === 'dodge' ? 'DX3rd.RollAsDodge' : 'DX3rd.RollAsReaction');
        const abilities = ['body', 'sense', 'mind', 'social'];

        // DOM 윈도우 생성 (stat-skill 윈도우 스타일 재사용)
        const window = document.createElement('div');
        window.className = 'dx3rd-stat-skill-window';
        window.innerHTML = `
            <div class="dx3rd-stat-skill-header" style="cursor: move;">
                <h3>${modeLabel}</h3>
                <button class="dx3rd-stat-skill-close-btn" title="닫기">×</button>
            </div>
            <div class="dx3rd-stat-skill-content">
                <div class="dx3rd-stat-skill-buttons">
                    ${abilities.map(statKey => {
                        const label = game.i18n.localize(`DX3rd.${statKey.charAt(0).toUpperCase() + statKey.slice(1)}`);
                        return `<button class="dx3rd-stat-btn" data-stat="${statKey}" data-type="ability">${label}</button>`;
                    }).join('')}
                </div>
            </div>
        `;

        document.body.appendChild(window);

        const $window = $(window);
        $window.find('.dx3rd-stat-skill-close-btn').on('click', () => {
            playUISound('click');
            closeStatSkillWindow(window);
        }).on('mouseenter', () => playUISound('hover'));

        $window.find('.dx3rd-stat-btn').on('click', (event) => {
            const statKey = $(event.currentTarget).data('stat');
            playUISound('click');
            closeStatSkillWindow(window);
            // 선택한 능력치의 스킬 피커로 이동 (롤 모드 고정)
            showStatSkillWindow(statKey, rollMode);
        }).on('mouseenter', () => playUISound('hover'));

        // 드래그 설정 (stat-skill 윈도우와 동일)
        setupStatSkillWindowDragging(window);

        // 애니메이션
        setTimeout(() => {
            window.classList.add('dx3rd-stat-skill-window-open');
        }, 10);
    }

    function showStatSkillWindow(statKey, rollMode = null) {
        const token = syncCurrentToken();
        if (!token || !token.actor) {
            ui.notifications.warn('토큰에 연결된 액터가 없습니다.');
            return;
        }

        const actor = token.actor;
        const statLabel = game.i18n.localize(`DX3rd.${statKey.charAt(0).toUpperCase() + statKey.slice(1)}`);
        const ability = actor.system.attributes[statKey];
        
        if (!ability) {
            ui.notifications.error('능력치 데이터를 찾을 수 없습니다.');
            return;
        }
        
        // 능력치와 해당 기능 목록
        const skills = STAT_SKILLS_MAP[statKey] || [];
        
        // DOM 윈도우 생성
        const window = document.createElement('div');
        window.className = 'dx3rd-stat-skill-window';
        window.innerHTML = `
            <div class="dx3rd-stat-skill-header" style="cursor: move;">
                <h3>${statLabel}</h3>
                <button class="dx3rd-stat-skill-close-btn" title="닫기">×</button>
            </div>
            <div class="dx3rd-stat-skill-content">
                <div class="dx3rd-stat-skill-buttons">
                    ${createAbilityButton(statKey, statLabel, ability)}
                    ${skills.map(skillKey => createSkillButton(actor, skillKey)).join('')}
                </div>
            </div>
        `;
        
        document.body.appendChild(window);
        
        // 이벤트 설정
        setupStatSkillWindowEvents(window, actor, statKey, ability, statLabel, skills, rollMode);

        // 드래그 설정
        setupStatSkillWindowDragging(window);
        
        // 애니메이션
        setTimeout(() => {
            window.classList.add('dx3rd-stat-skill-window-open');
        }, 10);
    }

    /**
     * 능력치 버튼 HTML 생성
     */
    function createAbilityButton(statKey, statLabel, ability) {
        return `
            <button class="dx3rd-stat-btn" data-stat="${statKey}" data-type="ability">
                ${statLabel}
            </button><hr class="dx3rd-stat-divider">
        `;
    }

    /**
     * 기능 버튼 HTML 생성
     */
    function createSkillButton(actor, skillKey) {
        const skill = actor.system?.attributes?.skills?.[skillKey];
        if (!skill) return '';
        
        // 스킬 이름 로컬라이징
        let skillLabel = skill.name;
        if (skillLabel && skillLabel.startsWith('DX3rd.')) {
            skillLabel = game.i18n.localize(skillLabel);
        }
        
        return `
            <button class="dx3rd-skill-btn" data-skill="${skillKey}" data-type="skill">
                ${skillLabel}
            </button>
        `;
    }

    /**
     * DOM 윈도우 이벤트 설정
     */
    function setupStatSkillWindowEvents(window, actor, statKey, ability, statLabel, skills, rollMode = null) {
        const $window = $(window);

        // 닫기 버튼
        $window.find('.dx3rd-stat-skill-close-btn').on('click', () => {
            closeStatSkillWindow(window);
        });

        // 능력치 버튼 클릭
        $window.find('.dx3rd-stat-btn').on('click', async () => {
            closeStatSkillWindow(window);

            // UniversalHandler를 통한 판정 실행
            const handler = getUniversalHandler();
            if (handler && handler.showStatRollConfirmDialog) {
                const sheet = actor.sheet;
                const comboCallback = (sheet && typeof sheet._openComboBuilder === 'function')
                    ? sheet._openComboBuilder.bind(sheet)
                    : null;

                handler.showStatRollConfirmDialog(
                    actor,
                    'ability',
                    statKey,
                    comboCallback,
                    rollMode
                );
            } else {
                console.error('DX3rd | UniversalHandler not found!');
            }
        });
        
        // 기능 버튼 클릭
        $window.find('.dx3rd-skill-btn').on('click', async (event) => {
            const skillKey = $(event.currentTarget).data('skill');
            const skill = actor.system?.attributes?.skills?.[skillKey];
            if (!skill) {
                console.warn('DX3rd | Skill not found:', skillKey);
                return;
            }
            
            closeStatSkillWindow(window);
            
            // UniversalHandler를 통한 판정 실행
            const handler = getUniversalHandler();
            if (handler && handler.showStatRollConfirmDialog) {
                const sheet = actor.sheet;
                const comboCallback = (sheet && typeof sheet._openComboBuilder === 'function') 
                    ? sheet._openComboBuilder.bind(sheet)
                    : null;
                
                handler.showStatRollConfirmDialog(
                    actor,
                    'skill',
                    skillKey,
                    comboCallback,
                    rollMode
                );
            } else {
                console.error('DX3rd | UniversalHandler not found!');
            }
        });
    }

    /**
     * DOM 윈도우 드래그 설정
     */
    function setupStatSkillWindowDragging(window) {
        const header = window.querySelector('.dx3rd-stat-skill-header');
        let isDragging = false;
        let currentX = 0;
        let currentY = 0;
        let initialX = 0;
        let initialY = 0;
        
        header.addEventListener('mousedown', (e) => {
            if (e.target.closest('.dx3rd-stat-skill-close-btn')) return;
            
            isDragging = true;
            const rect = window.getBoundingClientRect();
            initialX = e.clientX - rect.left;
            initialY = e.clientY - rect.top;
            
            window.style.transition = 'none';
        });
        
        document.addEventListener('mousemove', (e) => {
            if (!isDragging) return;
            
            e.preventDefault();
            currentX = e.clientX - initialX;
            currentY = e.clientY - initialY;
            
            window.style.left = `${currentX}px`;
            window.style.top = `${currentY}px`;
            window.style.transform = 'none';
        });
        
        document.addEventListener('mouseup', () => {
            if (isDragging) {
                isDragging = false;
                window.style.transition = '';
            }
        });
    }

    /**
     * DOM 윈도우 닫기
     */
    function closeStatSkillWindow(window) {
        window.classList.remove('dx3rd-stat-skill-window-open');
        setTimeout(() => {
            window.remove();
        }, 200);
    }

    /**
     * 버튼 토글 (열기/닫기)
     */
    function toggleCombatButtons() {
        if (!currentToken) return;

        if (buttonsVisible) {
            closeCombatButtons();
        } else {
            openCombatButtons();
        }
    }

    /**
     * 버튼 열기
     */
    function openCombatButtons() {
        if (!currentToken || buttonsVisible) return;

        createCombatButtons(currentToken);
        buttonsVisible = true;
    }

    /**
     * 버튼 닫기
     */
    function closeCombatButtons() {
        if (!buttonsVisible) return;

        removeCombatButtons();
        buttonsVisible = false;
    }

    /**
     * 버튼 폰트 적용
     */
    function applyButtonFont(fontFamily) {
        if (!buttonContainer || !buttonsVisible) return;
        
        // 모든 버튼의 텍스트 폰트 업데이트
        buttonContainer.children.forEach((button) => {
            if (button.children && button.children.length > 0) {
                const text = button.children[0]; // PIXI.Text
                if (text && text.style) {
                    text.style.fontFamily = fontFamily || 'Arial';
                }
            }
        });
    }

    /**
     * 전투 이동 처리
     */
    function handleBattleMove(actionType) {
        const token = syncCurrentToken();
        if (!token || !token.actor) {
            ui.notifications.warn('토큰에 연결된 액터가 없습니다.');
            return;
        }
        
        const actor = token.actor;
        const actionLabel = game.i18n.localize(`DX3rd.${actionType.charAt(0).toUpperCase() + actionType.slice(1)}`);
        const battleMoveValue = actor.system?.attributes?.move?.battle || 0;
        
        // 간이 거리 계산 설정 확인
        const simplifiedDistance = game.settings.get('dx3rd-emanim', 'simplifiedDistance') || false;
        
        let moveText;
        if (simplifiedDistance) {
            moveText = `${battleMoveValue} Grid`;
        } else {
            moveText = `${battleMoveValue}m`;
        }
        
        const description = game.i18n.localize('DX3rd.battleMoveDescription').replace('{battleMove}', moveText);
        
        // 채팅에 메시지 출력
        const chatData = {
            speaker: ChatMessage.getSpeaker({ actor: actor }),
            content: `
                ${actionLabel}: ${game.i18n.localize('DX3rd.BattleMove')} <br>
                ${description}
            `,
            style: CONST.CHAT_MESSAGE_STYLES.OTHER
        };
        
        ChatMessage.create(chatData);
    }
    
    /**
     * 전력 이동 처리
     */
    function handleFullMove(actionType) {
        const token = syncCurrentToken();
        if (!token || !token.actor) {
            ui.notifications.warn('토큰에 연결된 액터가 없습니다.');
            return;
        }
        
        const actor = token.actor;
        const actionLabel = game.i18n.localize(`DX3rd.${actionType.charAt(0).toUpperCase() + actionType.slice(1)}`);
        const fullMoveValue = actor.system?.attributes?.move?.full || 0;
        
        // 간이 거리 계산 설정 확인
        const simplifiedDistance = game.settings.get('dx3rd-emanim', 'simplifiedDistance') || false;
        
        let moveText;
        if (simplifiedDistance) {
            moveText = `${fullMoveValue} Grid`;
        } else {
            moveText = `${fullMoveValue}m`;
        }
        
        const description = game.i18n.localize('DX3rd.fullMoveDescription').replace('{fullMove}', moveText);
        
        // 채팅에 메시지 출력
        const chatData = {
            speaker: ChatMessage.getSpeaker({ actor: actor }),
            content: `
                ${actionLabel}: ${game.i18n.localize('DX3rd.FullMove')} <br>
                ${description}
            `,
            style: CONST.CHAT_MESSAGE_STYLES.OTHER
        };
        
        ChatMessage.create(chatData);
    }
    
    /**
     * 상태이상 해제 다이얼로그 표시
     */
    function showConditionClearDialog(actionType, timing) {
        const token = syncCurrentToken();
        if (!token || !token.actor) {
            ui.notifications.warn('토큰에 연결된 액터가 없습니다.');
            return;
        }
        
        const actor = token.actor;
        
        // 해제 가능한 상태이상들 가져오기
        const clearableConditions = checkClearableConditions(actor, timing);
        
        if (clearableConditions.length === 0) {
            ui.notifications.warn('해제할 수 있는 상태이상이 없습니다.');
            return;
        }
        
        const actionLabel = game.i18n.localize(`DX3rd.${actionType.charAt(0).toUpperCase() + actionType.slice(1)}`);
        const conditionClearLabel = game.i18n.localize('DX3rd.ConditionClear');
        
        // DOM 윈도우 생성
        const dialogWindow = document.createElement('div');
        dialogWindow.className = 'dx3rd-item-selection-window';
        dialogWindow.innerHTML = `
            <div class="dx3rd-item-selection-header" style="cursor: move;">
                <h3>${actionLabel}: ${conditionClearLabel}</h3>
                <button class="dx3rd-item-selection-close-btn" title="닫기">×</button>
            </div>
            <div class="dx3rd-item-selection-content">
                <div class="dx3rd-item-selection-buttons">
                    ${clearableConditions.map(conditionId => {
                        let conditionName;
                        if (conditionId.startsWith('berserk-')) {
                            const berserkType = conditionId.replace('berserk-', '');
                            if (berserkType === 'normal') {
                                conditionName = game.i18n.localize('DX3rd.Berserk');
                            } else {
                                conditionName = `${game.i18n.localize('DX3rd.Mutation')}: ${game.i18n.localize(`DX3rd.Urge${berserkType.charAt(0).toUpperCase() + berserkType.slice(1)}`)}`;
                            }
                        } else {
                            conditionName = game.i18n.localize(`DX3rd.${conditionId.charAt(0).toUpperCase() + conditionId.slice(1)}`);
                        }
                        return `
                            <button class="dx3rd-item-selection-btn" data-condition-id="${conditionId}">
                                ${conditionName}
                            </button>
                        `;
                    }).join('')}
                </div>
            </div>
        `;
        
        document.body.appendChild(dialogWindow);
        
        // 이벤트 설정
        setupConditionClearWindowEvents(dialogWindow, actor, actionType);
        
        // 드래그 설정
        setupItemSelectionWindowDragging(dialogWindow);
        
        // 애니메이션
        setTimeout(() => {
            dialogWindow.classList.add('dx3rd-item-selection-window-open');
        }, 10);
    }
    
    /**
     * 상태이상 해제 윈도우 이벤트 설정
     */
    function setupConditionClearWindowEvents(dialogWindow, actor, actionType) {
        const $window = $(dialogWindow);
        
        // 닫기 버튼
        $window.find('.dx3rd-item-selection-close-btn').on('click', () => {
            closeItemSelectionWindow(dialogWindow);
        });
        
        // 상태이상 버튼 클릭
        $window.find('.dx3rd-item-selection-btn').on('click', async (event) => {
            const $btn = $(event.currentTarget);
            const conditionId = $btn.data('condition-id');
            
            closeItemSelectionWindow(dialogWindow);
            await handleConditionClear(actor, conditionId, actionType);
        });
    }
    
    /**
     * 상태이상 해제 처리
     */
    async function handleConditionClear(actor, conditionId, actionType) {
        if (!actor) {
            ui.notifications.warn('액터를 찾을 수 없습니다.');
            return;
        }
        
        // 실제 해제할 상태이상 ID 결정
        let actualConditionId = conditionId;
        let displayName = conditionId;
        
        if (conditionId.startsWith('berserk-')) {
            // berserk의 경우 실제로는 'berserk' 상태이상을 해제
            actualConditionId = 'berserk';
            const berserkType = conditionId.replace('berserk-', '');
            if (berserkType === 'normal') {
                displayName = 'DX3rd.Berserk';
            } else {
                displayName = `${game.i18n.localize('DX3rd.Mutation')}: ${game.i18n.localize(`DX3rd.Urge${berserkType.charAt(0).toUpperCase() + berserkType.slice(1)}`)}`;
            }
        } else {
            displayName = `DX3rd.${conditionId.charAt(0).toUpperCase() + conditionId.slice(1)}`;
        }
        
        // 상태이상 해제
        try {
            await actor.toggleStatusEffect(actualConditionId, { active: false });
            
            // 채팅 메시지 출력
            const actionLabel = game.i18n.localize(`DX3rd.${actionType.charAt(0).toUpperCase() + actionType.slice(1)}`);
            const conditionClearLabel = game.i18n.localize('DX3rd.ConditionClear');
            
            const chatData = {
                speaker: ChatMessage.getSpeaker({ actor: actor }),
                content: `
                    ${actionLabel}: ${conditionClearLabel}
                `,
                style: CONST.CHAT_MESSAGE_STYLES.OTHER
            };
            
            ChatMessage.create(chatData);
            
        } catch (error) {
            console.error('DX3rd | Failed to clear condition:', error);
            ui.notifications.error('상태이상 해제에 실패했습니다.');
        }
    }

    // 전역 노출
    window.DX3rdCombatUI = {
        applyButtonFont: applyButtonFont
    };

    // ======================
    // 사이드 컨트롤 관련 함수
    // ======================

    /**
     * 사이드 컨트롤 DOM 생성
     */
    function createCombatSideControl() {
        // 기존 컨테이너가 있으면 재사용
        let container = document.getElementById('dx3rd-combat-side-control');
        
        if (!container) {
            // 컨테이너가 없으면 생성
            container = document.createElement('div');
            container.id = 'dx3rd-combat-side-control';
            container.className = 'dx3rd-combat-side-control';
            
            container.innerHTML = `
                <div class="dx3rd-side-control-content" id="dx3rd-side-control-content">
                    <div class="dx3rd-side-control-buttons" id="dx3rd-side-control-buttons">
                        <!-- 사이드 컨트롤 버튼들이 여기에 추가됩니다 -->
                    </div>
                </div>
            `;
            
            const uiRightColumn = document.getElementById('ui-right-column-1');
            if (uiRightColumn) {
                // 마지막 자식 요소로 추가 (아래쪽에 배치)
                uiRightColumn.appendChild(container);
            }
        }

        // 사이드 컨트롤 위치 업데이트
        updateSideControlPosition();
        
        // 전투 상태에 따라 컨테이너 표시/숨김
        updateSideControlVisibility();
        
        // 사이드 컨트롤 버튼 업데이트
        updateSideControlButtons();
    }

    /**
     * 사이드 컨트롤 표시/숨김 업데이트
     */
    function updateSideControlVisibility() {
        const container = document.getElementById('dx3rd-combat-side-control');
        if (!container) return;

        const sideControlEnabled = game.settings.get('dx3rd-emanim', 'combatSideControlEnabled');
        const hasCombat = !!game.combat;

        if (sideControlEnabled && hasCombat) {
            container.classList.remove('hidden');
        } else {
            container.classList.add('hidden');
        }
    }

    /**
     * 사이드 컨트롤 버튼 업데이트
     */
    function updateSideControlButtons() {
        const buttonsContainer = document.getElementById('dx3rd-side-control-buttons');
        if (!buttonsContainer) return;

        // 기존 버튼이 있으면 페이드아웃 후 제거
        const existingButtons = Array.from(buttonsContainer.querySelectorAll('.dx3rd-side-control-btn'));
        if (existingButtons.length > 0) {
            let animationCompleted = 0;
            const totalButtons = existingButtons.length;
            
            // 각 버튼에 슬라이드아웃 + 페이드아웃 애니메이션 적용 및 완료 감지
            existingButtons.forEach(button => {
                // 기존 애니메이션 클래스 제거
                button.classList.remove('slide-in-fade-in');
                
                // 애니메이션 완료 이벤트 리스너 추가
                const handleAnimationEnd = () => {
                    animationCompleted++;
                    button.removeEventListener('animationend', handleAnimationEnd);
                    
                    // 모든 버튼의 애니메이션이 완료되면 새 버튼 생성
                    if (animationCompleted === totalButtons) {
                        // 전투가 없으면 버튼만 제거
                        if (!game.combat) {
                            buttonsContainer.innerHTML = '';
                            return;
                        }
                        createNewButtons(buttonsContainer);
                    }
                };
                
                button.addEventListener('animationend', handleAnimationEnd);
                
                // 슬라이드아웃 + 페이드아웃 클래스 추가 (애니메이션 시작)
                button.classList.add('slide-out-fade-out');
            });
        } else {
            // 기존 버튼이 없으면 바로 생성
            if (game.combat) {
                createNewButtons(buttonsContainer);
            } else {
                buttonsContainer.innerHTML = '';
            }
        }
    }

    /**
     * 사이드 컨트롤 버튼 클릭 처리
     */
    function handleSideControlButtonClick(action) {
        // GM 전용 버튼 처리
        if (action === 'gmInitiative') {
            handleGMInitiative();
            return;
        }
        
        if (action === 'gmNextRound') {
            handleGMNextRound();
            return;
        }
        
        const token = syncCurrentToken();
        if (!token || !token.actor) {
            ui.notifications.warn('토큰에 연결된 액터가 없습니다.');
            return;
        }

        const actor = token.actor;

        // 컴배턴트인지 확인
        if (!game.combat) {
            return;
        }
        const combatant = game.combat.combatants.find(c => c.actor && c.actor.id === actor.id);
        if (!combatant) {
            return;
        }

        // Turn 액션은 바로 실행
        if (action === 'turn') {
            handleTurnEnd();
            return;
        }

        // 하위 버튼 표시
        showSideControlSubButtons(action, actor);
    }

    /**
     * 사이드 컨트롤에 하위 버튼 표시
     */
    function showSideControlSubButtons(actionType, actor) {
        const buttonsContainer = document.getElementById('dx3rd-side-control-buttons');
        if (!buttonsContainer) return;

        // 현재 상태 저장
        currentSideControlActionType = actionType;

        // 기존 버튼 페이드아웃
        const existingButtons = Array.from(buttonsContainer.querySelectorAll('.dx3rd-side-control-btn'));
        if (existingButtons.length > 0) {
            let animationCompleted = 0;
            const totalButtons = existingButtons.length;

            existingButtons.forEach(button => {
                button.classList.remove('slide-in-fade-in');
                
                const handleAnimationEnd = () => {
                    animationCompleted++;
                    button.removeEventListener('animationend', handleAnimationEnd);
                    
                    if (animationCompleted === totalButtons) {
                        createSubButtons(buttonsContainer, actionType, actor);
                    }
                };
                
                button.addEventListener('animationend', handleAnimationEnd);
                button.classList.add('slide-out-fade-out');
            });
        } else {
            createSubButtons(buttonsContainer, actionType, actor);
        }
    }

    /**
     * 하위 버튼 생성
     */
    function createSubButtons(buttonsContainer, actionType, actor) {
        buttonsContainer.innerHTML = '';

        // UI 버튼 폰트 설정 가져오기
        let uiButtonFont = '';
        try {
            uiButtonFont = game.settings.get('dx3rd-emanim', 'uiButtonFont') || '';
        } catch (e) {
            uiButtonFont = '';
        }

        // 액션별 버튼 설정 가져오기
        const actionButtons = getActionButtons(actionType, actor);

        // 하위 버튼 생성
        actionButtons.forEach((buttonConfig, index) => {
            const button = document.createElement('button');
            button.className = 'dx3rd-side-control-btn slide-in-fade-in';
            button.textContent = buttonConfig.label;
            button.dataset.action = buttonConfig.action;
            button.dataset.type = buttonConfig.type || '';
            button.dataset.timing = buttonConfig.timing || '';
            button.dataset.actionType = actionType;
            
            button.style.animationDelay = `${index * 0.025}s`;
            
            // 폰트 설정 적용
            if (uiButtonFont) {
                button.style.setProperty('font-family', `"${uiButtonFont}"`, 'important');
            }
            
            // 애니메이션 완료 후 클래스 제거 (호버 효과가 작동하도록)
            button.addEventListener('animationend', () => {
                button.classList.remove('slide-in-fade-in');
            }, { once: true });
            
            // 호버 사운드
            button.addEventListener('mouseenter', () => {
                playUISound('hover');
            });
            
            // 버튼 클릭 이벤트
            button.addEventListener('click', () => {
                playUISound('click');
                handleSideControlSubButtonClick(actionType, buttonConfig.action, buttonConfig.type, buttonConfig.timing);
            });
            
            buttonsContainer.appendChild(button);
        });

        // "돌아가기" 버튼 추가
        const backButton = document.createElement('button');
        backButton.className = 'dx3rd-side-control-btn slide-in-fade-in';
        backButton.textContent = game.i18n.localize('DX3rd.Return');
        backButton.dataset.action = 'back';
        
        backButton.style.animationDelay = `${actionButtons.length * 0.025}s`;
        
        // 폰트 설정 적용
        if (uiButtonFont) {
            backButton.style.setProperty('font-family', `"${uiButtonFont}"`, 'important');
        }
        
        // 애니메이션 완료 후 클래스 제거 (호버 효과가 작동하도록)
        backButton.addEventListener('animationend', () => {
            backButton.classList.remove('slide-in-fade-in');
        }, { once: true });
        
        // 호버 사운드
        backButton.addEventListener('mouseenter', () => {
            playUISound('hover');
        });
        
        backButton.addEventListener('click', () => {
            playUISound('click');
            // 기본 버튼으로 돌아가기
            currentSideControlActionType = null;
            updateSideControlButtons();
        });
        
        buttonsContainer.appendChild(backButton);
    }

    /**
     * 사이드 컨트롤 하위 버튼 클릭 처리
     */
    function handleSideControlSubButtonClick(actionType, action, type, timing) {
        // 기존 handleActionButtonClick 함수 활용
        // timing 파라미터를 전달해야 함 (콤보, 이펙트, 사이오닉 등에서 사용)
        // timing이 없으면 actionType을 timing으로 사용 (battleMove, fullMove 등)
        handleActionButtonClick(actionType, action, timing || actionType);
    }

    /**
     * 새 버튼 생성
     */
    function createNewButtons(buttonsContainer) {
        // 버튼 초기화
        buttonsContainer.innerHTML = '';

        // 전투가 없거나 컨테이너가 숨겨져 있으면 버튼 표시 안 함
        if (!game.combat) {
            return;
        }
        
        const container = document.getElementById('dx3rd-combat-side-control');
        if (!container || container.classList.contains('hidden')) {
            return;
        }

        // 현재 선택된 토큰 확인
        const token = syncCurrentToken();
        
        // GM이 아니면 기존 로직 유지 (토큰 필수)
        if (!game.user.isGM) {
            if (!token || !token.actor) {
                return;
            }

            const actor = token.actor;

            // 컴배턴트인지 확인 (전투에 참여한 액터인지)
            const combatant = game.combat.combatants.find(c => c.actor && c.actor.id === actor.id);
            if (!combatant) {
                // 컴배턴트가 아니면 버튼 표시 안 함
                return;
            }

            // 하위 버튼이 표시되어 있으면 하위 버튼 생성
            if (currentSideControlActionType) {
                createSubButtons(buttonsContainer, currentSideControlActionType, actor);
                return;
            }
        } else {
            // GM인 경우: 토큰이 있고 하위 버튼이 표시되어 있으면 하위 버튼 생성
            if (token && token.actor && currentSideControlActionType) {
                const actor = token.actor;
                const combatant = game.combat.combatants.find(c => c.actor && c.actor.id === actor.id);
                if (combatant) {
                    createSubButtons(buttonsContainer, currentSideControlActionType, actor);
                    return;
                }
            }
        }

        // UI 버튼 폰트 설정 가져오기
        let uiButtonFont = '';
        try {
            uiButtonFont = game.settings.get('dx3rd-emanim', 'uiButtonFont') || '';
        } catch (e) {
            uiButtonFont = '';
        }

        // 기본 버튼 생성
        const process = getCombatProcess();
        
        if (!process) {
            return;
        }

        // 프로세스별 버튼 설정 가져오기
        let buttons = [];
        
        // GM인 경우 토큰이 있으면 해당 토큰의 액터 가져오기
        let actor = null;
        if (token && token.actor) {
            const combatant = game.combat.combatants.find(c => c.actor && c.actor.id === token.actor.id);
            if (combatant) {
                actor = token.actor;
            }
        }
        
        switch (process.type) {
            case 'setup':
                if (actor) {
                    // 토큰이 선택되어 있으면 일반 버튼
                    buttons = [
                        { label: 'DX3rd.Setup', action: 'setup' },
                        { label: 'DX3rd.Reaction', action: 'reaction' },
                        { label: 'DX3rd.Auto', action: 'auto' }
                    ];
                }
                // GM 전용: 토큰 선택 여부와 관계없이 이니셔티브 버튼 추가
                if (game.user.isGM) {
                    buttons.push({ label: 'DX3rd.Initiative', action: 'gmInitiative', isGMOnly: true });
                }
                break;
                
            case 'initiative':
                if (actor) {
                    buttons = [
                        { label: 'DX3rd.Initiative', action: 'initiative' },
                        { label: 'DX3rd.Reaction', action: 'reaction' },
                        { label: 'DX3rd.Auto', action: 'auto' }
                    ];
                }
                break;
                
            case 'main':
                if (actor) {
                    // 현재 턴을 가진 액터인가?
                    const isCurrentActor = process.actorId === actor.id;
                    
                    if (isCurrentActor) {
                        // 메인 액터: 5개 버튼
                        buttons = [
                            { label: 'DX3rd.Minor', action: 'minor' },
                            { label: 'DX3rd.Major', action: 'major' },
                            { label: 'DX3rd.Reaction', action: 'reaction' },
                            { label: 'DX3rd.Auto', action: 'auto' },
                            { label: 'DX3rd.Turn', action: 'turn' }
                        ];
                    } else {
                        // 대기 중인 액터: 2개 버튼
                        buttons = [
                            { label: 'DX3rd.Reaction', action: 'reaction' },
                            { label: 'DX3rd.Auto', action: 'auto' }
                        ];
                    }
                }
                break;
                
            case 'cleanup':
                if (actor) {
                    buttons = [
                        { label: 'DX3rd.Cleanup', action: 'cleanup' },
                        { label: 'DX3rd.Reaction', action: 'reaction' },
                        { label: 'DX3rd.Auto', action: 'auto' }
                    ];
                }
                // GM 전용: 토큰 선택 여부와 관계없이 다음 라운드 버튼 추가
                if (game.user.isGM) {
                    buttons.push({ label: 'DX3rd.NextRound', action: 'gmNextRound', isGMOnly: true });
                }
                break;
                
            default:
                buttons = [];
        }

        // 버튼이 없으면 종료
        if (buttons.length === 0) {
            return;
        }

        // 버튼 생성 및 애니메이션 적용
        buttons.forEach((buttonConfig, index) => {
            const button = document.createElement('button');
            button.className = 'dx3rd-side-control-btn slide-in-fade-in';
            button.textContent = game.i18n.localize(buttonConfig.label);
            button.dataset.action = buttonConfig.action;
            
            // GM 전용 버튼 표시
            if (buttonConfig.isGMOnly) {
                button.classList.add('gm-only');
            }
            
            // 각 버튼에 순차적 애니메이션 지연 적용
            button.style.animationDelay = `${index * 0.025}s`;
            
            // 폰트 설정 적용
            if (uiButtonFont) {
                button.style.setProperty('font-family', `"${uiButtonFont}"`, 'important');
            }
            
            // 애니메이션 완료 후 클래스 제거 (호버 효과가 작동하도록)
            button.addEventListener('animationend', () => {
                button.classList.remove('slide-in-fade-in');
            }, { once: true });
            
            // 호버 사운드
            button.addEventListener('mouseenter', () => {
                playUISound('hover');
            });
            
            // 버튼 클릭 이벤트
            button.addEventListener('click', () => {
                playUISound('click');
                handleSideControlButtonClick(buttonConfig.action);
            });
            
            buttonsContainer.appendChild(button);
        });
    }

    /**
     * 사이드 컨트롤 위치 업데이트 (sidebar 넓이 기반)
     */
    function updateSideControlPosition() {
        const sideControl = document.getElementById('dx3rd-combat-side-control');
        if (!sideControl) return;
        
        const sidebar = document.getElementById('sidebar');
        if (!sidebar) {
            // sidebar가 없으면 기본값 사용
            sideControl.style.right = '20px';
            return;
        }
        
        // sidebar가 collapsed 상태인지 확인
        const isCollapsed = sidebar.classList.contains('collapsed');
        const sidebarWidth = sidebar.offsetWidth;
        
        if (isCollapsed) {
            // collapsed 상태: 아이콘만 보이므로 작은 여백
            sideControl.style.right = '20px';
        } else {
            // expanded 상태: sidebar 넓이 + 여백
            const rightPos = sidebarWidth + 30;
            sideControl.style.right = `${rightPos}px`;
        }
    }

    /**
     * Sidebar 변화 감지
     */
    function observeSidebarChanges() {
        const sidebar = document.getElementById('sidebar');
        if (!sidebar) {
            return;
        }
        
        // MutationObserver를 사용하여 sidebar의 class 변화 감지
        const mutationObserver = new MutationObserver((mutations) => {
            mutations.forEach((mutation) => {
                if (mutation.type === 'attributes' && mutation.attributeName === 'class') {
                    // sidebar의 collapsed 상태가 변경되었을 때 즉시 위치 업데이트
                    updateSideControlPosition();
                }
            });
        });
        
        // sidebar의 class 속성 변화 감지 시작
        mutationObserver.observe(sidebar, {
            attributes: true,
            attributeFilter: ['class']
        });
        
        // ResizeObserver를 사용하여 sidebar의 실제 크기 변화 감지
        const resizeObserver = new ResizeObserver((entries) => {
            for (let entry of entries) {
                // sidebar의 크기가 변경되었을 때
                updateSideControlPosition();
            }
        });
        
        // sidebar의 크기 변화 감지 시작
        resizeObserver.observe(sidebar);
        
        // 윈도우 리사이즈 시에도 업데이트
        window.addEventListener('resize', () => {
            updateSideControlPosition();
        });
    }

    // Ready 훅에서 초기화 확인
    Hooks.once('ready', () => {
        setupCanvasEvents(); // 캔버스 이벤트 등록
        
        // 사이드 컨트롤 설정이 활성화되어 있으면 생성
        const sideControlEnabled = game.settings.get('dx3rd-emanim', 'combatSideControlEnabled');
        if (sideControlEnabled) {
            createCombatSideControl();
            observeSidebarChanges();
        }
        
        // 이미 선택된 토큰이 있으면 초기화 (캔버스가 준비된 경우)
        if (canvas.tokens) {
            const controlledTokens = canvas.tokens.controlled || [];
            if (controlledTokens.length > 0) {
                const token = controlledTokens[0];
                currentToken = token;
                buttonsVisible = false;
            }
        }
    });

    // 캔버스가 다시 준비될 때마다 이벤트 재등록 및 버튼 제거
    Hooks.on('canvasReady', () => {
        removeCombatButtons();
        currentToken = null;
        buttonsVisible = false;
        currentSideControlActionType = null;
        setupCanvasEvents();
        
        // 사이드 컨트롤 설정이 활성화되어 있으면 재생성
        const sideControlEnabled = game.settings.get('dx3rd-emanim', 'combatSideControlEnabled');
        if (sideControlEnabled) {
            createCombatSideControl();
            observeSidebarChanges();
        }
        
        // 이미 선택된 토큰이 있으면 초기화
        const controlledTokens = canvas.tokens?.controlled || [];
        if (controlledTokens.length > 0) {
            const token = controlledTokens[0];
            currentToken = token;
            buttonsVisible = false;
        }
    });

    // Combat 플래그 변경 시 버튼 재생성
    Hooks.on('updateCombat', (combat, changed, options, userId) => {
        // currentProcess 플래그가 변경되었을 때
        if (changed.flags?.['dx3rd-emanim']?.currentProcess !== undefined) {
            // 버튼이 열려있고 토큰이 선택되어 있으면 버튼 재생성
            if (currentToken && buttonsVisible && buttonContainer) {
                buttonContainer.removeChildren();
                createPixiButtons(currentToken);
            }
            
            // 사이드 컨트롤 업데이트
            const sideControlEnabled = game.settings.get('dx3rd-emanim', 'combatSideControlEnabled');
            if (sideControlEnabled) {
                // 하위 버튼 상태 초기화 (프로세스 변경 시 기본 버튼으로 돌아감)
                currentSideControlActionType = null;
                updateSideControlVisibility();
                updateSideControlButtons();
            }
        }
    });

    // 전투 생성 시 사이드 컨트롤 표시
    Hooks.on('createCombat', (combat, options, userId) => {
        const sideControlEnabled = game.settings.get('dx3rd-emanim', 'combatSideControlEnabled');
        if (sideControlEnabled) {
            currentSideControlActionType = null;
            updateSideControlVisibility();
            updateSideControlButtons();
        }
    });

    // 전투 삭제 시 사이드 컨트롤 숨김
    Hooks.on('deleteCombat', (combat, options, userId) => {
        const sideControlEnabled = game.settings.get('dx3rd-emanim', 'combatSideControlEnabled');
        if (sideControlEnabled) {
            currentSideControlActionType = null;
            updateSideControlVisibility();
            updateSideControlButtons();
        }
    });
})();

