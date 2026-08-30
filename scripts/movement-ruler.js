// Movement Ruler - colors the path while a token moves
(function() {

    const MODULE_ID = "dx3rd-emanim";
    
    // The setting IDs
    const SETTING_IDS = {
        battle: 'battleMoveColor',
        full: 'fullMoveColor',
        over: 'overMoveColor',
        enabled: 'movementRulerEnabled'
    };

    // The default colors (hex)
    const DEFAULT_COLORS = {
        battle: '#00ff00',  // battle movement - green
        full: '#ffff00',    // full movement - yellow
        over: '#ff0000'     // cannot move - red
    };

    /**
     * Decide which movement range the current waypoint falls into
     * @param {TokenRuler} ruler - the Ruler object
     * @param {Object} waypoint - the path point
     * @param {number} epsilon - the floating-point tolerance
     * @returns {string} 'battle' | 'full' | 'over'
     */
    function getNowInRange(ruler, waypoint, epsilon = 1e-6) {
        const actor = ruler?.token?.actor;

        // With no actor, it is over
        if (!actor) return 'over';

        // Get the DX3rd movement value
        const battle = actor.system?.attributes?.move?.battle ?? 0;
        const full = actor.system?.attributes?.move?.full ?? 0;

        // With no movement value, it is over
        if (battle <= 0 && full <= 0) return 'over';
        
        // The movement cost so far
        const cost = waypoint.measurement?.cost ?? 0;
        
        // The three-step range test
        if (cost <= battle + epsilon) return 'battle';  // within battle movement
        if (cost <= full + epsilon) return 'full';      // within full movement
        return 'over';                                   // cannot move
    }

    /**
     * Check whether the movement range is within battle movement
     * @param {TokenRuler} ruler - the Ruler object
     * @param {Object} waypoint - the path point
     * @param {number} epsilon - the floating-point tolerance
     * @returns {boolean}
     */
    function isWithinBattleMove(ruler, waypoint, epsilon = 1e-6) {
        const actor = ruler?.token?.actor;
        const battle = actor?.system?.attributes?.move?.battle ?? 0;
        if (!Number.isFinite(battle) || battle <= 0) return true;
        const cost = waypoint.measurement?.cost ?? 0;
        return cost <= battle + epsilon;
    }

    // Register the settings
    function registerSettings() {
        // Enable / disable the feature
        game.settings.register(MODULE_ID, SETTING_IDS.enabled, {
            name: "이동 경로 색상 표시",
            hint: "토큰 이동 시 전투 이동/전력 이동 범위를 색상으로 표시합니다.",
            scope: "world",
            config: true,
            type: Boolean,
            default: true
        });

        // Show the Ruler to other users too
        game.settings.register(MODULE_ID, 'showRulerToAll', {
            name: "모든 사용자에게 이동 경로 표시",
            hint: "플레이어가 토큰을 이동할 때 GM과 다른 플레이어에게도 경로를 표시합니다.",
            scope: "world",
            config: true,
            type: Boolean,
            default: true
        });

        // The battle movement color
        game.settings.register(MODULE_ID, SETTING_IDS.battle, {
            name: "전투 이동 색상",
            hint: "move.battle 범위 내 경로 색상",
            scope: "world",
            config: true,
            type: String,
            default: DEFAULT_COLORS.battle
        });

        // The full movement color
        game.settings.register(MODULE_ID, SETTING_IDS.full, {
            name: "전력 이동 색상",
            hint: "move.battle 초과 ~ move.full 범위 경로 색상",
            scope: "world",
            config: true,
            type: String,
            default: DEFAULT_COLORS.full
        });

        // The cannot-move color
        game.settings.register(MODULE_ID, SETTING_IDS.over, {
            name: "이동 불능 색상",
            hint: "move.full 초과 경로 색상",
            scope: "world",
            config: true,
            type: String,
            default: DEFAULT_COLORS.over
        });
    }

    // Wrap the Ruler methods directly
    function patchRuler() {
        const TokenRuler = foundry.canvas.placeables.tokens.TokenRuler;
        if (!TokenRuler) {
            console.warn("DX3rd | MovementRuler - TokenRuler not found.");
            return;
        }
            
        // Patch _getSegmentStyle (keeping the original and wrapping it)
        if (!TokenRuler.prototype._getSegmentStyle._dx3rdOriginal) {
            // Keep the original method in a variable
            const originalGetSegmentStyle = TokenRuler.prototype._getSegmentStyle;
            if (typeof originalGetSegmentStyle !== 'function') {
                console.warn("DX3rd | MovementRuler - _getSegmentStyle is not a function.");
                return;
            }
            
            // Keep the original method
            TokenRuler.prototype._getSegmentStyle._dx3rdOriginal = originalGetSegmentStyle;
            
            // Replace it with the new method
            TokenRuler.prototype._getSegmentStyle = function(waypoint) {
                // Call the original method (through the stored variable)
                const style = originalGetSegmentStyle.call(this, waypoint);
                    
                    // With the feature disabled, the default behaviour
                    if (!game.settings.get(MODULE_ID, SETTING_IDS.enabled)) {
                        return style;
                    }
                    
                    // Check the current range
                    const rangeType = getNowInRange(this, waypoint);
                    const colorId = SETTING_IDS[rangeType];
                    
                    // Get the color from the settings
                    const colorString = game.settings.get(MODULE_ID, colorId);
                    const hex = foundry.utils.Color.fromString(colorString);
                    
                    style.color = hex;
                    style.alpha = 0.2;
                    
                    return style;
            };
        }

        // Patch _getGridHighlightStyle (keeping the original and wrapping it)
        if (!TokenRuler.prototype._getGridHighlightStyle._dx3rdOriginal) {
            // Keep the original method in a variable
            const originalGetGridHighlightStyle = TokenRuler.prototype._getGridHighlightStyle;
            if (typeof originalGetGridHighlightStyle !== 'function') {
                console.warn("DX3rd | MovementRuler - _getGridHighlightStyle is not a function.");
                return;
            }
            
            // Keep the original method
            TokenRuler.prototype._getGridHighlightStyle._dx3rdOriginal = originalGetGridHighlightStyle;
            
            // Replace it with the new method
            TokenRuler.prototype._getGridHighlightStyle = function(waypoint, ...rest) {
                // Call the original method (through the stored variable)
                const style = originalGetGridHighlightStyle.call(this, waypoint, ...rest);
                    
                    // With the feature disabled, the default behaviour
                    if (!game.settings.get(MODULE_ID, SETTING_IDS.enabled)) {
                        return style;
                    }
                    
                    // Check the current range
                    const rangeType = getNowInRange(this, waypoint);
                    const colorId = SETTING_IDS[rangeType];
                    
                    // Get the color from the settings
                    const colorString = game.settings.get(MODULE_ID, colorId);
                    const hex = foundry.utils.Color.fromString(colorString);
                    
                    style.color = hex;
                    style.alpha = 0.2;
                    
                    return style;
            };
        }
    }

    // Register the settings on the Init hook
    Hooks.once('init', () => {
        registerSettings();
    });

    // Patch the Ruler on the Ready hook
    Hooks.once('ready', () => {
        patchRuler();
        
        // Make the Ruler visible to every user
        if (game.settings.get(MODULE_ID, 'showRulerToAll')) {
            // The TokenRuler's broadcast setting
            if (foundry.canvas?.placeables?.tokens?.TokenRuler) {
                const originalBroadcast = foundry.canvas.placeables.tokens.TokenRuler.prototype._broadcast;
                foundry.canvas.placeables.tokens.TokenRuler.prototype._broadcast = function(action, data) {
                    // Always broadcast
                    return originalBroadcast?.call(this, action, data);
                };
            }

        }
    });

    // Expose globally
    window.DX3rdMovementRuler = {
        getNowInRange,
        isWithinBattleMove
    };

})();

