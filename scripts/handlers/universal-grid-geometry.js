// Universal handler - grid geometry & wall/hex helpers (split from universal-handler.js)
// 그리드 거리/인접/벽충돌 계산과 육각형 셀 렌더 헬퍼를 window.DX3rdUniversalHandler에 믹스인으로 부착한다.
// 이 묶음은 시각적 사정거리 하이라이트가 아니라, 전투 인게이지/인접 페널티 계산(universal-handler.js)과
// 스펠 재해 범위 표적화(spell-handler.js)가 공유하는 지오메트리 인프라다.
// 반드시 system.json에서 handlers/universal-handler.js 뒤에 로드되어야 한다.
(function() {

  if (!window.DX3rdUniversalHandler) {
    console.error('DX3rd | universal-grid-geometry.js는 universal-handler.js보다 먼저 로드될 수 없습니다.');
    return;
  }

  Object.assign(window.DX3rdUniversalHandler, {
    /**
     * 인접 그리드 좌표 가져오기
     * @param {Token} token - 기준 토큰
     * @returns {Array} 인접 그리드 좌표 배열
     */
    getAdjacentGrids: function(token) {
      const grids = [];

      try {
        const doc = token.document;

        // ===== 1) 점유 셀(i,j) 계산 (상대/절대 자동 정규화) =====
        const snapped = doc.getSnappedPosition(); // {x,y}
        const baseOff = canvas.grid.getOffset({ x: snapped.x, y: snapped.y }); // {i,j}

        const rawOcc = doc.getOccupiedGridSpaceOffsets({
          x: snapped.x, y: snapped.y, width: doc.width, height: doc.height
        }); // [{i,j}, ...]

        if (!rawOcc?.length) {
          console.warn(`DX3rd | No occupied grid spaces found for token`);
          return grids;
        }

        const minI0 = Math.min(...rawOcc.map(c => c.i));
        const maxI0 = Math.max(...rawOcc.map(c => c.i));
        const minJ0 = Math.min(...rawOcc.map(c => c.j));
        const maxJ0 = Math.max(...rawOcc.map(c => c.j));
        const looksRelative =
          minI0 >= -1 && minJ0 >= -1 &&
          maxI0 <= (doc.width  + 1) &&
          maxJ0 <= (doc.height + 1);

        const occupied = (looksRelative
          ? rawOcc.map(({ i, j }) => ({ i: baseOff.i + i, j: baseOff.j + j }))
          : rawOcc.map(({ i, j }) => ({ i, j }))
        ).sort((a, b) => a.j - b.j || a.i - b.i);

        const key = (i, j) => `${i},${j}`;
        const occSet = new Set(occupied.map(c => key(c.i, c.j)));


        // ===== 2) 후보: 점유 박스의 1칸 테두리만 =====
        const minI = Math.min(...occupied.map(c => c.i));
        const maxI = Math.max(...occupied.map(c => c.i));
        const minJ = Math.min(...occupied.map(c => c.j));
        const maxJ = Math.max(...occupied.map(c => c.j));

        const candidates = [];
        for (let i = minI - 1; i <= maxI + 1; i++) {
          for (let j = minJ - 1; j <= maxJ + 1; j++) {
            // 점유칸도 포함하여 본인 위치도 하이라이트에 표시
            candidates.push({ i, j });
          }
        }

        // ===== 3) 거리 계산 (v13: measurePath로 gridSpaces=칸 수) =====
        const centerOf = ({ i, j }) => canvas.grid.getCenterPoint({ i, j });
        function gridDistCenters(a, b) {
          const res = canvas.grid.measurePath([a, b], { gridSpaces: true });
          if (typeof res === "number") return res;
          if (res && typeof res.distance === "number") return res.distance;
          if (Array.isArray(res) && res[0]?.distance != null) return res[0].distance;
          return 0;
        }

        const adjacent = [];
        for (const c of candidates) {
          const cC = centerOf(c);
          let dmin = Infinity;
          for (const o of occupied) {
            const d = gridDistCenters(centerOf(o), cC);
            if (d < dmin) dmin = d;
            if (dmin === 0) break;
          }
          if (dmin <= 1) adjacent.push(c); // 거리 0칸(본인 위치)과 1칸(인접) 포함
        }

        // 중복 제거 + 정렬
        const result = [...new Map(adjacent.map(c => [key(c.i, c.j), c])).values()]
          .sort((a, b) => a.j - b.j || a.i - b.i);


        // ===== 4) 인접 셀들을 픽셀 좌표로 변환 (벽 충돌 체크 포함) =====
        const tokenCenter = token.center;

        for (const { i, j } of result) {
          const centerPoint = centerOf({ i, j });

          // 벽 충돌 체크: 토큰 중심에서 그리드 중심까지
          const hasWall = this.checkWallCollision(tokenCenter, centerPoint);

          if (!hasWall) {
            grids.push({ x: centerPoint.x, y: centerPoint.y });
          }
        }


      } catch (e) {
        console.error('DX3rd | Failed to get adjacent grids using macro method', e);
        // Fallback: 기본 8방향 처리
        const tokenCenter = token.center;
        const centerX = tokenCenter.x;
        const centerY = tokenCenter.y;
        const gridSize = canvas.grid.size || 100;

        const offsets = [
          { dx: -1, dy: -1 }, { dx: 0, dy: -1 }, { dx: 1, dy: -1 },
          { dx: -1, dy: 0 },                      { dx: 1, dy: 0 },
          { dx: -1, dy: 1 },  { dx: 0, dy: 1 },  { dx: 1, dy: 1 }
        ];

        for (const { dx, dy } of offsets) {
          grids.push({
            x: centerX + (dx * gridSize),
            y: centerY + (dy * gridSize)
          });
        }
        console.log(`DX3rd | Fallback - Generated ${grids.length} adjacent cells`);
      }

      return grids;
    },

    /**
     * 특정 그리드 좌표에 토큰이 있는지 확인
     * @param {Object} gridPos - 그리드 좌표 { i, j } 또는 { x, y }
     * @param {Token} excludeToken - 제외할 토큰 (선택사항)
     * @returns {Token|null} 해당 위치의 토큰 또는 null
     */
    getTokenAtGrid: function(gridPos, excludeToken = null) {
      try {
        // 그리드 좌표를 픽셀 좌표로 변환
        let pixelPos;
        if (gridPos.i !== undefined && gridPos.j !== undefined) {
          // 그리드 좌표 (i, j)
          pixelPos = canvas.grid.getCenterPoint({ i: gridPos.i, j: gridPos.j });
        } else if (gridPos.x !== undefined && gridPos.y !== undefined) {
          // 픽셀 좌표 (x, y)
          pixelPos = { x: gridPos.x, y: gridPos.y };
        } else {
          console.warn('DX3rd | Invalid grid position:', gridPos);
          return null;
        }

        // 해당 위치의 모든 토큰 확인
        const tokens = canvas.tokens.placeables.filter(t => {
          if (excludeToken && t.id === excludeToken.id) return false;

          // 토큰의 점유 영역 확인
          const tokenBounds = t.bounds;
          const tokenCenter = t.center;

          // 그리드 좌표로 변환하여 거리 계산
          const tokenGrid = canvas.grid.getOffset({ x: tokenCenter.x, y: tokenCenter.y });
          const targetGrid = canvas.grid.getOffset({ x: pixelPos.x, y: pixelPos.y });

          // 거리가 0.5 이하면 같은 그리드로 간주
          const dx = tokenGrid.i - targetGrid.i;
          const dy = tokenGrid.j - targetGrid.j;
          const distance = Math.sqrt(dx * dx + dy * dy);

          return distance <= 0.5;
        });

        // 첫 번째 토큰 반환
        return tokens.length > 0 ? tokens[0] : null;

      } catch (e) {
        console.error('DX3rd | Failed to get token at grid:', e);
        return null;
      }
    },

    /**
     * 사정거리 내 그리드 좌표 가져오기
     * @param {Token} token - 기준 토큰
     * @param {number} range - 사정거리 (미터)
     * @returns {Array} 사정거리 내 그리드 좌표 배열
     */
    getGridsInRange: function(token, range) {
      const grids = [];

      try {
        const doc = token.document;

        // ===== 1) 점유 셀(i,j) 계산 (상대/절대 자동 정규화) =====
        const snapped = doc.getSnappedPosition(); // {x,y}
        const baseOff = canvas.grid.getOffset({ x: snapped.x, y: snapped.y }); // {i,j}

        const rawOcc = doc.getOccupiedGridSpaceOffsets({
          x: snapped.x, y: snapped.y, width: doc.width, height: doc.height
        }); // [{i,j}, ...]

        if (!rawOcc?.length) {
          console.warn(`DX3rd | No occupied grid spaces found for token`);
          return grids;
        }

        const minI0 = Math.min(...rawOcc.map(c => c.i));
        const maxI0 = Math.max(...rawOcc.map(c => c.i));
        const minJ0 = Math.min(...rawOcc.map(c => c.j));
        const maxJ0 = Math.max(...rawOcc.map(c => c.j));
        const looksRelative =
          minI0 >= -1 && minJ0 >= -1 &&
          maxI0 <= (doc.width  + 1) &&
          maxJ0 <= (doc.height + 1);

        const occupied = (looksRelative
          ? rawOcc.map(({ i, j }) => ({ i: baseOff.i + i, j: baseOff.j + j }))
          : rawOcc.map(({ i, j }) => ({ i, j }))
        ).sort((a, b) => a.j - b.j || a.i - b.i);

        const key = (i, j) => `${i},${j}`;
        const occSet = new Set(occupied.map(c => key(c.i, c.j)));


        // ===== 2) 후보: 점유 박스의 N칸 테두리까지 =====
        const minI = Math.min(...occupied.map(c => c.i));
        const maxI = Math.max(...occupied.map(c => c.i));
        const minJ = Math.min(...occupied.map(c => c.j));
        const maxJ = Math.max(...occupied.map(c => c.j));

        const candidates = [];
        for (let i = minI - range; i <= maxI + range; i++) {
          for (let j = minJ - range; j <= maxJ + range; j++) {
            // 점유칸도 포함하여 본인 위치도 하이라이트에 표시
            candidates.push({ i, j });
          }
        }

        // ===== 3) 거리 계산 (v13: measurePath로 gridSpaces=칸 수) =====
        const centerOf = ({ i, j }) => canvas.grid.getCenterPoint({ i, j });
        function gridDistCenters(a, b) {
          const res = canvas.grid.measurePath([a, b], { gridSpaces: true });
          if (typeof res === "number") return res;
          if (res && typeof res.distance === "number") return res.distance;
          if (Array.isArray(res) && res[0]?.distance != null) return res[0].distance;
          return 0;
        }

        const within = [];
        for (const c of candidates) {
          const cC = centerOf(c);
          let dmin = Infinity;
          for (const o of occupied) {
            const d = gridDistCenters(centerOf(o), cC);
            if (d < dmin) dmin = d;
            if (dmin === 0) break;
          }
          if (dmin >= 0 && dmin <= range) within.push({ ...c, dist: dmin }); // 거리 0칸(본인 위치) 포함
        }

        // 중복 제거 + 정렬
        const result = [...new Map(within.map(c => [key(c.i, c.j), c])).values()]
          .sort((a, b) => a.j - b.j || a.i - b.i);


        // ===== 4) 사정거리 내 셀들을 픽셀 좌표로 변환 (벽 충돌 체크 포함) =====
        const tokenCenter = token.center;

        for (const { i, j } of result) {
          const centerPoint = centerOf({ i, j });

          // 벽 충돌 체크: 토큰 중심에서 그리드 중심까지
          const hasWall = this.checkWallCollision(tokenCenter, centerPoint);

          if (!hasWall) {
            grids.push({ x: centerPoint.x, y: centerPoint.y });
          }
        }


      } catch (e) {
        console.error('DX3rd | Failed to get grids in range using macro method', e);
        // Fallback: 기본 픽셀 거리 계산
        const gridSize = canvas.grid.size;
        const rangeInPixels = range * (gridSize / canvas.dimensions.distance);
        const tokenCenter = token.center;
        const sceneWidth = canvas.dimensions.sceneWidth;
        const sceneHeight = canvas.dimensions.sceneHeight;

        const minX = Math.max(0, tokenCenter.x - rangeInPixels);
        const maxX = Math.min(sceneWidth, tokenCenter.x + rangeInPixels);
        const minY = Math.max(0, tokenCenter.y - rangeInPixels);
        const maxY = Math.min(sceneHeight, tokenCenter.y + rangeInPixels);

        for (let x = Math.floor(minX / gridSize) * gridSize; x <= maxX; x += gridSize) {
          for (let y = Math.floor(minY / gridSize) * gridSize; y <= maxY; y += gridSize) {
            const cellCenterX = x + gridSize / 2;
            const cellCenterY = y + gridSize / 2;

            const distance = Math.sqrt(
              Math.pow(cellCenterX - tokenCenter.x, 2) +
              Math.pow(cellCenterY - tokenCenter.y, 2)
            );

            if (distance <= rangeInPixels && distance > gridSize / 2) {
              grids.push({ x, y });
            }
          }
        }
      }

      return grids;
    },

    /**
     * 육각형 하이라이트 그리기 (스펠 재해 범위 표적화용)
     * @param {PIXI.Graphics} graphics - PIXI Graphics 객체
     * @param {number} x - 그리드 X 좌표
     * @param {number} y - 그리드 Y 좌표
     * @param {number} size - 그리드 크기
     */
    drawHexHighlight: function(graphics, x, y, size) {
      try {
        // x, y가 이미 그리드의 중심점이므로 그대로 사용
        const centerX = x;
        const centerY = y;

        // 그리드 타입에 따라 다른 Hex 모양 사용
        const gridType = canvas.grid.type;

        if (gridType === CONST.GRID_TYPES.HEXODDR || gridType === CONST.GRID_TYPES.HEXEVENR) {
          // Hex Row: 좌우로 긴 육각형 (평평한 면이 위아래)
          this.drawHexRowHighlight(graphics, centerX, centerY, size);
        } else if (gridType === CONST.GRID_TYPES.HEXODDQ || gridType === CONST.GRID_TYPES.HEXEVENQ) {
          // Hex Column: 위아래로 긴 육각형 (뾰족한 면이 위아래)
          this.drawHexColumnHighlight(graphics, centerX, centerY, size);
        } else {
          // 기본 Hex 모양 (기존과 동일)
          this.drawDefaultHexHighlight(graphics, centerX, centerY, size);
        }

      } catch (e) {
        console.error('DX3rd | Failed to draw hex highlight', e);
        // Fallback: 원형으로 대체
        const centerX = x;
        const centerY = y;
        const radius = (size / 2) - 2;
        graphics.drawCircle(centerX, centerY, radius);
      }
    },

    /**
     * Hex Row 하이라이트 그리기 (30도 회전된 육각형)
     * @param {PIXI.Graphics} graphics - PIXI Graphics 객체
     * @param {number} centerX - 중심 X 좌표
     * @param {number} centerY - 중심 Y 좌표
     * @param {number} size - 그리드 크기
     */
    drawHexRowHighlight: function(graphics, centerX, centerY, size) {
      // Hex Row: 정육각형을 30도 회전 (평평한 면이 위아래가 되도록)
      const radius = (size / 2) - 1;

      // 육각형 꼭짓점 계산 (30도 회전: Math.PI/6)
      const points = [];
      for (let i = 0; i < 6; i++) {
        const angle = (Math.PI / 3) * i + Math.PI / 6; // 60도씩 + 30도 회전
        const pointX = centerX + radius * Math.cos(angle);
        const pointY = centerY + radius * Math.sin(angle);
        points.push(pointX, pointY);
      }

      graphics.drawPolygon(points);
    },

    /**
     * Hex Column 하이라이트 그리기 (기존 정육각형 그대로)
     * @param {PIXI.Graphics} graphics - PIXI Graphics 객체
     * @param {number} centerX - 중심 X 좌표
     * @param {number} centerY - 중심 Y 좌표
     * @param {number} size - 그리드 크기
     */
    drawHexColumnHighlight: function(graphics, centerX, centerY, size) {
      // Hex Column: 기존 정육각형 모양 그대로 (뾰족한 면이 위아래)
      const radius = (size / 2) - 1;

      // 육각형 꼭짓점 계산 (기존과 동일)
      const points = [];
      for (let i = 0; i < 6; i++) {
        const angle = (Math.PI / 3) * i; // 60도씩 (회전 없음)
        const pointX = centerX + radius * Math.cos(angle);
        const pointY = centerY + radius * Math.sin(angle);
        points.push(pointX, pointY);
      }

      graphics.drawPolygon(points);
    },

    /**
     * 기본 Hex 하이라이트 그리기 (정육각형)
     * @param {PIXI.Graphics} graphics - PIXI Graphics 객체
     * @param {number} centerX - 중심 X 좌표
     * @param {number} centerY - 중심 Y 좌표
     * @param {number} size - 그리드 크기
     */
    drawDefaultHexHighlight: function(graphics, centerX, centerY, size) {
      // 기본 정육각형 (기존 코드)
      const radius = (size / 2) - 1;

      const points = [];
      for (let i = 0; i < 6; i++) {
        const angle = (Math.PI / 3) * i; // 60도씩
        const pointX = centerX + radius * Math.cos(angle);
        const pointY = centerY + radius * Math.sin(angle);
        points.push(pointX, pointY);
      }

      graphics.drawPolygon(points);
    },

    /**
     * 두 지점 사이에 벽 충돌이 있는지 확인
     * @param {Point} origin - 시작 지점 {x, y}
     * @param {Point} target - 목표 지점 {x, y}
     * @returns {boolean} 벽 충돌 여부
     */
    checkWallCollision: function(origin, target) {
      try {
        // 캔버스나 벽이 없으면 충돌 없음으로 처리
        if (!canvas || !canvas.walls) return false;

        // 이동을 막는 벽만 체크 (MOVEMENT 타입)
        // Ray 객체는 사용하지 않으므로 제거 (v13 호환성)
        const collision = CONFIG.Canvas.polygonBackends.move.testCollision(origin, target, {
          type: 'move',
          mode: 'any'
        });

        return collision;
      } catch (e) {
        console.warn('DX3rd | Wall collision check failed:', e);
        return false; // 에러 시 충돌 없음으로 처리
      }
    },
  });

})();
