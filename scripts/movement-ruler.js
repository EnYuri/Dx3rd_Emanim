// Movement Ruler - 토큰 이동 시 경로 색상 표시
(function() {

    const MODULE_ID = "dx3rd-emanim";
    
    // 설정 ID
    const SETTING_IDS = {
        battle: 'battleMoveColor',
        full: 'fullMoveColor',
        over: 'overMoveColor',
        enabled: 'movementRulerEnabled'
    };

    // 기본 색상 (Hex)
    const DEFAULT_COLORS = {
        battle: '#00ff00',  // 전투 이동 - 초록
        full: '#ffff00',    // 전력 이동 - 노랑
        over: '#ff0000'     // 이동 불능 - 빨강
    };

    /**
     * 현재 waypoint가 어느 이동 범위에 속하는지 판단
     * @param {TokenRuler} ruler - Ruler 객체
     * @param {Object} waypoint - 경로점
     * @param {number} epsilon - 부동소수점 오차 허용치
     * @returns {string} 'battle' | 'full' | 'over'
     */
    function getNowInRange(ruler, waypoint, epsilon = 1e-6) {
        const actor = ruler?.token?.actor;

        // 액터가 없으면 over
        if (!actor) return 'over';

        // DX3rd의 이동력 가져오기
        const battle = actor.system?.attributes?.move?.battle ?? 0;
        const full = actor.system?.attributes?.move?.full ?? 0;

        // 이동력이 없으면 over
        if (battle <= 0 && full <= 0) return 'over';
        
        // 현재까지의 이동 비용
        const cost = waypoint.measurement?.cost ?? 0;
        
        // 3단계 범위 판단
        if (cost <= battle + epsilon) return 'battle';  // 전투 이동 범위
        if (cost <= full + epsilon) return 'full';      // 전력 이동 범위
        return 'over';                                   // 이동 불능
    }

    /**
     * 이동 범위가 전투 이동 범위 내인지 확인
     * @param {TokenRuler} ruler - Ruler 객체
     * @param {Object} waypoint - 경로점
     * @param {number} epsilon - 부동소수점 오차 허용치
     * @returns {boolean}
     */
    function isWithinBattleMove(ruler, waypoint, epsilon = 1e-6) {
        const actor = ruler?.token?.actor;
        const battle = actor?.system?.attributes?.move?.battle ?? 0;
        if (!Number.isFinite(battle) || battle <= 0) return true;
        const cost = waypoint.measurement?.cost ?? 0;
        return cost <= battle + epsilon;
    }

    // 설정 등록
    function registerSettings() {
        // 기능 활성화/비활성화
        game.settings.register(MODULE_ID, SETTING_IDS.enabled, {
            name: "이동 경로 색상 표시",
            hint: "토큰 이동 시 전투 이동/전력 이동 범위를 색상으로 표시합니다.",
            scope: "world",
            config: true,
            type: Boolean,
            default: true
        });

        // Ruler를 다른 사용자에게도 보이기
        game.settings.register(MODULE_ID, 'showRulerToAll', {
            name: "모든 사용자에게 이동 경로 표시",
            hint: "플레이어가 토큰을 이동할 때 GM과 다른 플레이어에게도 경로를 표시합니다.",
            scope: "world",
            config: true,
            type: Boolean,
            default: true
        });

        // 전투 이동 색상
        game.settings.register(MODULE_ID, SETTING_IDS.battle, {
            name: "전투 이동 색상",
            hint: "move.battle 범위 내 경로 색상",
            scope: "world",
            config: true,
            type: String,
            default: DEFAULT_COLORS.battle
        });

        // 전력 이동 색상
        game.settings.register(MODULE_ID, SETTING_IDS.full, {
            name: "전력 이동 색상",
            hint: "move.battle 초과 ~ move.full 범위 경로 색상",
            scope: "world",
            config: true,
            type: String,
            default: DEFAULT_COLORS.full
        });

        // 이동 불능 색상
        game.settings.register(MODULE_ID, SETTING_IDS.over, {
            name: "이동 불능 색상",
            hint: "move.full 초과 경로 색상",
            scope: "world",
            config: true,
            type: String,
            default: DEFAULT_COLORS.over
        });
    }

    // Ruler 메서드 직접 래핑
    function patchRuler() {
        const TokenRuler = foundry.canvas.placeables.tokens.TokenRuler;
        if (!TokenRuler) {
            console.warn("DX3rd | MovementRuler - TokenRuler not found.");
            return;
        }
            
        // _getSegmentStyle 패치 (원본 저장 및 래핑)
        if (!TokenRuler.prototype._getSegmentStyle._dx3rdOriginal) {
            // 원본 메서드를 변수에 저장
            const originalGetSegmentStyle = TokenRuler.prototype._getSegmentStyle;
            if (typeof originalGetSegmentStyle !== 'function') {
                console.warn("DX3rd | MovementRuler - _getSegmentStyle is not a function.");
                return;
            }
            
            // 원본 메서드 저장
            TokenRuler.prototype._getSegmentStyle._dx3rdOriginal = originalGetSegmentStyle;
            
            // 새 메서드로 교체
            TokenRuler.prototype._getSegmentStyle = function(waypoint) {
                // 원본 메서드 호출 (저장된 변수 사용)
                const style = originalGetSegmentStyle.call(this, waypoint);
                    
                    // 기능이 비활성화되어 있으면 기본 동작
                    if (!game.settings.get(MODULE_ID, SETTING_IDS.enabled)) {
                        return style;
                    }
                    
                    // 현재 범위 확인
                    const rangeType = getNowInRange(this, waypoint);
                    const colorId = SETTING_IDS[rangeType];
                    
                    // 설정에서 색상 가져오기
                    const colorString = game.settings.get(MODULE_ID, colorId);
                    const hex = foundry.utils.Color.fromString(colorString);
                    
                    style.color = hex;
                    style.alpha = 0.2;
                    
                    return style;
            };
        }

        // _getGridHighlightStyle 패치 (원본 저장 및 래핑)
        if (!TokenRuler.prototype._getGridHighlightStyle._dx3rdOriginal) {
            // 원본 메서드를 변수에 저장
            const originalGetGridHighlightStyle = TokenRuler.prototype._getGridHighlightStyle;
            if (typeof originalGetGridHighlightStyle !== 'function') {
                console.warn("DX3rd | MovementRuler - _getGridHighlightStyle is not a function.");
                return;
            }
            
            // 원본 메서드 저장
            TokenRuler.prototype._getGridHighlightStyle._dx3rdOriginal = originalGetGridHighlightStyle;
            
            // 새 메서드로 교체
            TokenRuler.prototype._getGridHighlightStyle = function(waypoint, ...rest) {
                // 원본 메서드 호출 (저장된 변수 사용)
                const style = originalGetGridHighlightStyle.call(this, waypoint, ...rest);
                    
                    // 기능이 비활성화되어 있으면 기본 동작
                    if (!game.settings.get(MODULE_ID, SETTING_IDS.enabled)) {
                        return style;
                    }
                    
                    // 현재 범위 확인
                    const rangeType = getNowInRange(this, waypoint);
                    const colorId = SETTING_IDS[rangeType];
                    
                    // 설정에서 색상 가져오기
                    const colorString = game.settings.get(MODULE_ID, colorId);
                    const hex = foundry.utils.Color.fromString(colorString);
                    
                    style.color = hex;
                    style.alpha = 0.2;
                    
                    return style;
            };
        }
    }

    // Init Hook에서 설정 등록
    Hooks.once('init', () => {
        registerSettings();
    });

    // Ready Hook에서 Ruler 패치
    Hooks.once('ready', () => {
        patchRuler();
        
        // Ruler를 모든 사용자에게 보이게 설정
        if (game.settings.get(MODULE_ID, 'showRulerToAll')) {
            // TokenRuler의 broadcast 설정
            if (foundry.canvas?.placeables?.tokens?.TokenRuler) {
                const originalBroadcast = foundry.canvas.placeables.tokens.TokenRuler.prototype._broadcast;
                foundry.canvas.placeables.tokens.TokenRuler.prototype._broadcast = function(action, data) {
                    // 항상 브로드캐스트
                    return originalBroadcast?.call(this, action, data);
                };
            }

        }
    });

    // 전역 노출
    window.DX3rdMovementRuler = {
        getNowInRange,
        isWithinBattleMove
    };

})();

