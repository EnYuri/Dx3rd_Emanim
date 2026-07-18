// [INACTIVE / ARCHIVED] 시각적 자기 사정거리 하이라이트 (self-range visual highlight)
// ------------------------------------------------------------------------------------
// 아이템을 채팅에 출력할 때 사용자 자신의 토큰 주위에 사정거리만큼 헥스/사각 셀을
// 그려주던 기능이다. 실사용 월드가 사실상 전부 그리드리스로 운영되어 화면에 표시될 일이
// 없었고("이 하이라이트 관련 기능은 쓰지 않으므로"), 2026-07-18 시스템에서 분리·비활성화했다.
//
// 이 파일은 system.json에 등록되어 있지 않으며 로드되지 않는다. 순수 보존용 아카이브다.
// 부활시키려면:
//   1) 이 파일과 universal-range-hooks.js를 scripts/handlers/로 되돌리고 system.json에 등록,
//   2) main.js에 rangeHighlight 설정 등록 + updateCombat/deleteCombat/ESC 훅 복원,
//   3) actor-chat.js의 setRangeHighlightForItem 호출부,
//   4) combat.js/universal-handler.js의 clearRangeHighlightQueue 호출부,
//   5) socket-contracts.js / socket-document-handlers.js / main.js의 setRangeHighlight·
//      clearRangeHighlight 소켓 계약·수신부를 되살린다.
// 그리드 지오메트리(getAdjacentGrids/getGridsInRange/getTokenAtGrid/checkWallCollision/
// drawHexHighlight 계열)는 여전히 살아있는 공유 인프라이므로 scripts/handlers/
// universal-grid-geometry.js에 남겨두었다. 이 아카이브는 그 위에 얹히는 시각 레이어만 담는다.
(function() {

  if (!window.DX3rdUniversalHandler) {
    console.error('DX3rd | universal-range-highlight-visual.js는 universal-handler.js보다 먼저 로드될 수 없습니다.');
    return;
  }

  Object.assign(window.DX3rdUniversalHandler, {
    /**
     * 범위 하이라이트 큐 관리
     */
    rangeHighlightQueue: {
      current: null, // { actorId, tokenId, itemId, range, timestamp }
      timeout: null
    },

    /**
     * 아이템 채팅 출력 시 범위 하이라이트 설정
     * @param {Actor} actor - 액터
     * @param {Item} item - 아이템
     */
    async setRangeHighlightForItem(actor, item) {
      try {
        // 범위 하이라이트 설정 확인
        const rangeHighlightEnabled = game.settings.get('dx3rd-emanim', 'rangeHighlight');
        if (!rangeHighlightEnabled) {
          return;
        }

        // 전투 중 확인 (컴뱃이 있고 라운드가 1 이상일 때만 활성화)
        const combat = game.combat;
        if (!combat || !combat.round || combat.round < 1) {
          return;
        }

        // 아이템의 사정거리 확인
        let range = item.system?.range;

        // vehicle 아이템의 경우 항상 1로 처리
        if (item.type === 'vehicle') {
          range = 1;
          console.log('DX3rd | Vehicle item - setting range to 1');
        }

        // 사정거리가 없거나 빈 값이면 처리하지 않음
        if (!range || range === '') {
          console.log('DX3rd | No range found for item:', item.name);
          return;
        }

        // 대상이 자기 자신인 경우 하이라이트 처리하지 않음
        const selfText = game.i18n.localize('DX3rd.Self');
        const target = item.system?.target;
        if (target === selfText) {
          return;
        }

        // 액터의 토큰 찾기
        const tokens = actor.getActiveTokens();
        if (tokens.length === 0) {
          console.log('DX3rd | No active tokens found for actor:', actor.name);
          return;
        }

        const token = tokens[0]; // 첫 번째 토큰 사용

        // DX3rd.Engage는 토큰 크기의 절반(올림)으로 처리
        const engageText = game.i18n.localize('DX3rd.Engage');
        let rangeValue;
        if (range === engageText) {
          const tokenSize = token.document.width || 1;
          rangeValue = Math.ceil(tokenSize / 2);
          console.log('DX3rd | Engage range calculated from token size:', tokenSize, '→', rangeValue);
        } else {
          rangeValue = Number(range) || 0;
        }

        if (rangeValue <= 0) {
          console.log('DX3rd | Invalid range value:', range, 'for item:', item.name);
          return;
        }

        // 사용자 색상 가져오기 (설정이 켜져 있을 때만)
        const useUserColor = game.settings.get('dx3rd-emanim', 'rangeHighlightColor') === true;
        let userColorValue = null;

        if (useUserColor && game.user?.color) {
          // Foundry Color 객체, 문자열, 숫자 모두 처리
          if (typeof game.user.color === 'object' && game.user.color !== null) {
            userColorValue = Number(game.user.color);
          } else if (typeof game.user.color === 'string') {
            const hexColor = game.user.color.replace('#', '');
            userColorValue = parseInt(hexColor, 16);
          } else if (typeof game.user.color === 'number') {
            userColorValue = game.user.color;
          }
        }

        const queueData = {
          actorId: actor.id,
          tokenId: token.id,
          itemId: item.id,
          range: rangeValue,
          userColor: userColorValue, // 사용자 색상 추가
          userId: game.user.id, // 하이라이트를 생성한 사용자 ID
          timestamp: Date.now()
        };

        // 모든 사용자가 직접 처리 (각자의 클라이언트에서 하이라이트 표시)
        await this.processRangeHighlightQueue(queueData);

        // 다른 사용자들에게도 소켓으로 전송하여 모두에게 하이라이트 표시
        window.DX3rdSocketRouter.emit({
          type: 'setRangeHighlight',
          data: queueData
        });

      } catch (e) {
        console.error('DX3rd | Failed to set range highlight for item:', e);
      }
    },

    /**
     * 범위 하이라이트 큐 처리
     * @param {Object} queueData - 큐 데이터
     */
    async processRangeHighlightQueue(queueData) {
      try {
        // 기존 하이라이트 제거
        this.clearRangeHighlight();

        // 기존 타임아웃 제거
        if (this.rangeHighlightQueue.timeout) {
          clearTimeout(this.rangeHighlightQueue.timeout);
        }

        // 새 큐 설정
        this.rangeHighlightQueue.current = queueData;

        // 토큰 찾기
        const token = canvas.tokens?.placeables?.find(t => t.id === queueData.tokenId);
        if (!token) {
          return;
        }


        // 토큰 로컬 하이라이트 레이어 초기화
        this.initializeTokenRangeLayer(token);

        // 범위 하이라이트 표시 (토큰 로컬 방식)
        if (queueData.range === 1) {
          // 인접 (거리 1)
          const adjacentGrids = this.getAdjacentGrids(token);
          for (const grid of adjacentGrids) {
            this.drawTokenLocalHighlight(token, grid.x, grid.y, canvas.grid.size, queueData.userColor);
          }
        } else {
          // 숫자 사정거리
          const rangeGrids = this.getGridsInRange(token, queueData.range);
          for (const grid of rangeGrids) {
            this.drawTokenLocalHighlight(token, grid.x, grid.y, canvas.grid.size, queueData.userColor);
          }
        }

        // 자동 제거 없음 - 공격/사용 버튼으로만 제거

      } catch (e) {
        console.error('DX3rd | Failed to process range highlight queue:', e);
      }
    },

    /**
     * 범위 하이라이트 큐 제거
     * @param {boolean} force - 권한 체크를 무시하고 강제로 클리어 (기본값: false)
     * @param {boolean} skipSocket - 소켓 전송을 건너뛸지 여부 (기본값: false, 소켓 이벤트로 호출된 경우 true)
     */
    clearRangeHighlightQueue(force = false, skipSocket = false) {
      try {
        // 권한 체크: 하이라이트를 생성한 사용자 또는 GM만 클리어 가능
        if (!force && this.rangeHighlightQueue.current) {
          const highlightUserId = this.rangeHighlightQueue.current.userId;
          const currentUserId = game.user.id;
          const isCreator = highlightUserId && highlightUserId === currentUserId;
          const isGM = game.user.isGM;

          if (!isCreator && !isGM) {
            // 생성자가 아니고 GM도 아니면 클리어 불가
            return;
          }
        }

        // 토큰 로컬 하이라이트 제거
        if (this.rangeHighlightQueue.current) {
          const token = canvas.tokens?.placeables?.find(t => t.id === this.rangeHighlightQueue.current.tokenId);
          if (token) {
            this.clearTokenRangeHighlight(token);
          }
        }

        // 기존 canvas 하이라이트도 제거 (fallback)
        this.clearRangeHighlight();

        // 큐 초기화
        this.rangeHighlightQueue.current = null;

        // 타임아웃 제거
        if (this.rangeHighlightQueue.timeout) {
          clearTimeout(this.rangeHighlightQueue.timeout);
          this.rangeHighlightQueue.timeout = null;
        }

        // 소켓 이벤트로 호출된 경우가 아니면 다른 사용자들에게도 소켓으로 전송
        if (!skipSocket) {
          window.DX3rdSocketRouter.emit({
            type: 'clearRangeHighlight'
          });
        }

      } catch (e) {
        console.error('DX3rd | Failed to clear range highlight queue:', e);
      }
    },

    /**
     * 토큰에 범위 하이라이트 레이어 생성/초기화
     * @param {Token} token - 대상 토큰
     */
    initializeTokenRangeLayer(token) {
      try {
        // 기존 레이어가 있으면 제거
        if (token._dx3rdRangeLayer) {
          token.removeChild(token._dx3rdRangeLayer);
          token._dx3rdRangeLayer.destroy();
        }

        // 새 레이어 생성
        const layer = new PIXI.Container();
        layer.name = 'dx3rd-range-highlight';

        // 토큰 이미지 아래에 표시되도록 매우 낮은 zIndex 설정
        layer.zIndex = -10;

        // 토큰에 레이어 추가 (맨 앞에 추가하여 zIndex가 적용되도록)
        token.addChildAt(layer, 0);
        token._dx3rdRangeLayer = layer;

        return layer;

      } catch (e) {
        console.error('DX3rd | Failed to initialize token range layer:', e);
        return null;
      }
    },

    /**
     * 토큰 로컬 좌표에 하이라이트 그리기
     * @param {Token} token - 대상 토큰
     * @param {number} worldX - 월드 X 좌표
     * @param {number} worldY - 월드 Y 좌표
     * @param {number} size - 그리드 크기
     */
    drawTokenLocalHighlight(token, worldX, worldY, size, userColor = null) {
      try {
        // 토큰 레이어 초기화
        if (!token._dx3rdRangeLayer) {
          this.initializeTokenRangeLayer(token);
        }

        const layer = token._dx3rdRangeLayer;
        if (!layer) {
          console.warn('DX3rd | Failed to get token range layer');
          return null;
        }

        // 월드 좌표를 토큰 좌상단 기준 상대 좌표로 변환 (grid 정렬 정확도 향상)
        const originX = token.x; // 토큰 좌상단 X (월드 좌표)
        const originY = token.y; // 토큰 좌상단 Y (월드 좌표)
        const relativeX = worldX - originX;
        const relativeY = worldY - originY;

        // 하이라이트 그래픽 생성
        const graphics = new PIXI.Graphics();
        graphics.name = 'range-highlight';

        const gridType = canvas.grid.type;

        // 색상 결정: userColor가 전달되면 사용, 아니면 기본 녹색
        let colorValue = 0x00FF00; // 기본 녹색

        if (userColor !== null) {
            // 큐 데이터에서 전달된 사용자 색상 사용
            colorValue = userColor;
        }

        graphics.beginFill(colorValue, 0.2); // 투명도는 0.2로 고정

        if (gridType === CONST.GRID_TYPES.SQUARE || gridType === CONST.GRID_TYPES.GRIDLESS) {
          // 정사각형 그리드: 사각형 (90% 크기)
          const highlightSize = size * 0.90;
          const halfSize = highlightSize / 2;
          graphics.drawRect(relativeX - halfSize, relativeY - halfSize, highlightSize, highlightSize);
        } else if (gridType === CONST.GRID_TYPES.HEXODDR ||
                   gridType === CONST.GRID_TYPES.HEXEVENR ||
                   gridType === CONST.GRID_TYPES.HEXODDQ ||
                   gridType === CONST.GRID_TYPES.HEXEVENQ) {
          // 육각형 그리드: 실제 육각형 모양으로 하이라이트
          this.drawTokenLocalHexHighlight(graphics, relativeX, relativeY, size);
        }

        graphics.endFill();

        // 토큰 레이어에 추가
        layer.addChild(graphics);

        return graphics;

      } catch (e) {
        console.error('DX3rd | Failed to draw token local highlight:', e);
        return null;
      }
    },

    /**
     * 토큰 로컬 좌표에 육각형 하이라이트 그리기
     * @param {PIXI.Graphics} graphics - PIXI Graphics 객체
     * @param {number} centerX - 로컬 중심 X 좌표
     * @param {number} centerY - 로컬 중심 Y 좌표
     * @param {number} size - 그리드 크기
     */
    drawTokenLocalHexHighlight(graphics, centerX, centerY, size) {
      try {
        const radius = (size / 2) * 0.90; // 90% 크기
        const gridType = canvas.grid.type;

        // 그리드 타입에 따라 다른 Hex 모양 사용
        if (gridType === CONST.GRID_TYPES.HEXODDR || gridType === CONST.GRID_TYPES.HEXEVENR) {
          // Hex Row: 30도 회전된 육각형
          const points = [];
          for (let i = 0; i < 6; i++) {
            const angle = (Math.PI / 3) * i + Math.PI / 6; // 60도씩 + 30도 회전
            const pointX = centerX + radius * Math.cos(angle);
            const pointY = centerY + radius * Math.sin(angle);
            points.push(pointX, pointY);
          }
          graphics.drawPolygon(points);
        } else if (gridType === CONST.GRID_TYPES.HEXODDQ || gridType === CONST.GRID_TYPES.HEXEVENQ) {
          // Hex Column: 기존 정육각형
          const points = [];
          for (let i = 0; i < 6; i++) {
            const angle = (Math.PI / 3) * i; // 60도씩 (회전 없음)
            const pointX = centerX + radius * Math.cos(angle);
            const pointY = centerY + radius * Math.sin(angle);
            points.push(pointX, pointY);
          }
          graphics.drawPolygon(points);
        }


      } catch (e) {
        console.error('DX3rd | Failed to draw token local hex highlight', e);
        // Fallback: 원형으로 대체 (90% 크기)
        const radius = (size / 2) * 0.90;
        graphics.drawCircle(centerX, centerY, radius);
      }
    },

    /**
     * 토큰의 범위 하이라이트 제거
     * @param {Token} token - 대상 토큰
     */
    clearTokenRangeHighlight(token) {
      try {
        if (token._dx3rdRangeLayer) {
          // 레이어의 모든 하이라이트 제거
          token._dx3rdRangeLayer.removeChildren().forEach(child => {
            if (child.destroy) child.destroy();
          });
        }
      } catch (e) {
        console.error('DX3rd | Failed to clear token range highlight:', e);
      }
    },

    /**
     * 사정거리 하이라이트 제거 (canvas grid fallback)
     */
    clearRangeHighlight: function() {
      if (window.DX3rdRangeHighlight && window.DX3rdRangeHighlight.length > 0) {
        for (const graphics of window.DX3rdRangeHighlight) {
          try {
            canvas.interface.grid.removeChild(graphics);
            graphics.destroy();
          } catch (e) {
            console.warn('DX3rd | Failed to remove highlight', e);
          }
        }
        window.DX3rdRangeHighlight = [];
      }
    },
  });

})();
