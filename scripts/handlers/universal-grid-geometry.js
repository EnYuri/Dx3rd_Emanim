// Universal handler - grid geometry & wall/hex helpers (split from universal-handler.js)
// Mixes the grid distance / adjacency / wall-collision calculations and the hex cell render helpers into window.DX3rdUniversalHandler.
// This bundle is not the visual range highlight but the geometry infrastructure shared by the combat engage / adjacency
// penalty calculation (universal-handler.js) and the spell disaster-area targeting (spell-handler.js).
// It must be loaded after handlers/universal-handler.js in system.json.
(function() {

  if (!window.DX3rdUniversalHandler) {
    console.error('DX3rd | universal-grid-geometry.js는 universal-handler.js보다 먼저 로드될 수 없습니다.');
    return;
  }

  Object.assign(window.DX3rdUniversalHandler, {
    /**
     * Get the adjacent grid coordinates
     * @param {Token} token - the reference token
     * @returns {Array} the array of adjacent grid coordinates
     */
    getAdjacentGrids: function(token) {
      const grids = [];

      try {
        const doc = token.document;

        // ===== 1) Compute the occupied cells (i,j) (relative / absolute normalized automatically) =====
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


        // ===== 2) Candidates: only the one-cell border of the occupancy box =====
        const minI = Math.min(...occupied.map(c => c.i));
        const maxI = Math.max(...occupied.map(c => c.i));
        const minJ = Math.min(...occupied.map(c => c.j));
        const maxJ = Math.max(...occupied.map(c => c.j));

        const candidates = [];
        for (let i = minI - 1; i <= maxI + 1; i++) {
          for (let j = minJ - 1; j <= maxJ + 1; j++) {
            // The occupied cells are included too, so the token's own position is highlighted as well
            candidates.push({ i, j });
          }
        }

        // ===== 3) Distance calculation (v13: measurePath with gridSpaces = the number of cells) =====
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
          if (dmin <= 1) adjacent.push(c); // includes distance 0 (the token's own position) and 1 (adjacent)
        }

        // Deduplicate and sort
        const result = [...new Map(adjacent.map(c => [key(c.i, c.j), c])).values()]
          .sort((a, b) => a.j - b.j || a.i - b.i);


        // ===== 4) Convert the adjacent cells to pixel coordinates (with a wall collision check) =====
        const tokenCenter = token.center;

        for (const { i, j } of result) {
          const centerPoint = centerOf({ i, j });

          // Wall collision check: from the token's center to the grid's center
          const hasWall = this.checkWallCollision(tokenCenter, centerPoint);

          if (!hasWall) {
            grids.push({ x: centerPoint.x, y: centerPoint.y });
          }
        }


      } catch (e) {
        console.error('DX3rd | Failed to get adjacent grids using macro method', e);
        // Fallback: the plain eight-direction handling
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
        window.DX3rdDebug.log(`DX3rd | Fallback - Generated ${grids.length} adjacent cells`);
      }

      return grids;
    },

    /**
     * Check whether a token sits on a particular grid coordinate
     * @param {Object} gridPos - the grid coordinate { i, j } or { x, y }
     * @param {Token} excludeToken - a token to exclude (optional)
     * @returns {Token|null} the token at that position, or null
     */
    getTokenAtGrid: function(gridPos, excludeToken = null) {
      try {
        // Convert the grid coordinate to pixel coordinates
        let pixelPos;
        if (gridPos.i !== undefined && gridPos.j !== undefined) {
          // Grid coordinates (i, j)
          pixelPos = canvas.grid.getCenterPoint({ i: gridPos.i, j: gridPos.j });
        } else if (gridPos.x !== undefined && gridPos.y !== undefined) {
          // Pixel coordinates (x, y)
          pixelPos = { x: gridPos.x, y: gridPos.y };
        } else {
          console.warn('DX3rd | Invalid grid position:', gridPos);
          return null;
        }

        // Check every token at that position
        const tokens = canvas.tokens.placeables.filter(t => {
          if (excludeToken && t.id === excludeToken.id) return false;

          // Check the token's occupied area
          const tokenBounds = t.bounds;
          const tokenCenter = t.center;

          // Convert to grid coordinates and compute the distance
          const tokenGrid = canvas.grid.getOffset({ x: tokenCenter.x, y: tokenCenter.y });
          const targetGrid = canvas.grid.getOffset({ x: pixelPos.x, y: pixelPos.y });

          // A distance of 0.5 or less counts as the same grid cell
          const dx = tokenGrid.i - targetGrid.i;
          const dy = tokenGrid.j - targetGrid.j;
          const distance = Math.sqrt(dx * dx + dy * dy);

          return distance <= 0.5;
        });

        // Return the first token
        return tokens.length > 0 ? tokens[0] : null;

      } catch (e) {
        console.error('DX3rd | Failed to get token at grid:', e);
        return null;
      }
    },

    /**
     * Get the grid coordinates within range
     * @param {Token} token - the reference token
     * @param {number} range - the range (in meters)
     * @returns {Array} the array of grid coordinates within range
     */
    getGridsInRange: function(token, range) {
      const grids = [];

      try {
        const doc = token.document;

        // ===== 1) Compute the occupied cells (i,j) (relative / absolute normalized automatically) =====
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


        // ===== 2) Candidates: out to the N-cell border of the occupancy box =====
        const minI = Math.min(...occupied.map(c => c.i));
        const maxI = Math.max(...occupied.map(c => c.i));
        const minJ = Math.min(...occupied.map(c => c.j));
        const maxJ = Math.max(...occupied.map(c => c.j));

        const candidates = [];
        for (let i = minI - range; i <= maxI + range; i++) {
          for (let j = minJ - range; j <= maxJ + range; j++) {
            // The occupied cells are included too, so the token's own position is highlighted as well
            candidates.push({ i, j });
          }
        }

        // ===== 3) Distance calculation (v13: measurePath with gridSpaces = the number of cells) =====
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
          if (dmin >= 0 && dmin <= range) within.push({ ...c, dist: dmin }); // includes distance 0 (the token's own position)
        }

        // Deduplicate and sort
        const result = [...new Map(within.map(c => [key(c.i, c.j), c])).values()]
          .sort((a, b) => a.j - b.j || a.i - b.i);


        // ===== 4) Convert the cells within range to pixel coordinates (with a wall collision check) =====
        const tokenCenter = token.center;

        for (const { i, j } of result) {
          const centerPoint = centerOf({ i, j });

          // Wall collision check: from the token's center to the grid's center
          const hasWall = this.checkWallCollision(tokenCenter, centerPoint);

          if (!hasWall) {
            grids.push({ x: centerPoint.x, y: centerPoint.y });
          }
        }


      } catch (e) {
        console.error('DX3rd | Failed to get grids in range using macro method', e);
        // Fallback: the plain pixel distance calculation
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
     * Draw a hexagonal highlight (for the spell disaster-area targeting)
     * @param {PIXI.Graphics} graphics - the PIXI Graphics object
     * @param {number} x - the grid X coordinate
     * @param {number} y - the grid Y coordinate
     * @param {number} size - the grid size
     */
    drawHexHighlight: function(graphics, x, y, size) {
      try {
        // x and y are already the grid's center point, so they are used as-is
        const centerX = x;
        const centerY = y;

        // Use a different hex shape depending on the grid type
        const gridType = canvas.grid.type;

        if (gridType === CONST.GRID_TYPES.HEXODDR || gridType === CONST.GRID_TYPES.HEXEVENR) {
          // Hex Row: a hexagon elongated left-to-right (flat sides top and bottom)
          this.drawHexRowHighlight(graphics, centerX, centerY, size);
        } else if (gridType === CONST.GRID_TYPES.HEXODDQ || gridType === CONST.GRID_TYPES.HEXEVENQ) {
          // Hex Column: a hexagon elongated top-to-bottom (pointed sides top and bottom)
          this.drawHexColumnHighlight(graphics, centerX, centerY, size);
        } else {
          // The default hex shape (as before)
          this.drawDefaultHexHighlight(graphics, centerX, centerY, size);
        }

      } catch (e) {
        console.error('DX3rd | Failed to draw hex highlight', e);
        // Fallback: substitute a circle
        const centerX = x;
        const centerY = y;
        const radius = (size / 2) - 2;
        graphics.drawCircle(centerX, centerY, radius);
      }
    },

    /**
     * Draw a Hex Row highlight (a hexagon rotated 30 degrees)
     * @param {PIXI.Graphics} graphics - the PIXI Graphics object
     * @param {number} centerX - the center X coordinate
     * @param {number} centerY - the center Y coordinate
     * @param {number} size - the grid size
     */
    drawHexRowHighlight: function(graphics, centerX, centerY, size) {
      // Hex Row: a regular hexagon rotated 30 degrees (so the flat sides are top and bottom)
      const radius = (size / 2) - 1;

      // Compute the hexagon's vertices (rotated 30 degrees: Math.PI/6)
      const points = [];
      for (let i = 0; i < 6; i++) {
        const angle = (Math.PI / 3) * i + Math.PI / 6; // 60 degrees each, plus a 30-degree rotation
        const pointX = centerX + radius * Math.cos(angle);
        const pointY = centerY + radius * Math.sin(angle);
        points.push(pointX, pointY);
      }

      graphics.drawPolygon(points);
    },

    /**
     * Draw a Hex Column highlight (the existing regular hexagon, unchanged)
     * @param {PIXI.Graphics} graphics - the PIXI Graphics object
     * @param {number} centerX - the center X coordinate
     * @param {number} centerY - the center Y coordinate
     * @param {number} size - the grid size
     */
    drawHexColumnHighlight: function(graphics, centerX, centerY, size) {
      // Hex Column: the existing regular hexagon shape, unchanged (pointed sides top and bottom)
      const radius = (size / 2) - 1;

      // Compute the hexagon's vertices (as before)
      const points = [];
      for (let i = 0; i < 6; i++) {
        const angle = (Math.PI / 3) * i; // 60 degrees each (no rotation)
        const pointX = centerX + radius * Math.cos(angle);
        const pointY = centerY + radius * Math.sin(angle);
        points.push(pointX, pointY);
      }

      graphics.drawPolygon(points);
    },

    /**
     * Draw the default hex highlight (a regular hexagon)
     * @param {PIXI.Graphics} graphics - the PIXI Graphics object
     * @param {number} centerX - the center X coordinate
     * @param {number} centerY - the center Y coordinate
     * @param {number} size - the grid size
     */
    drawDefaultHexHighlight: function(graphics, centerX, centerY, size) {
      // The default regular hexagon (the existing code)
      const radius = (size / 2) - 1;

      const points = [];
      for (let i = 0; i < 6; i++) {
        const angle = (Math.PI / 3) * i; // 60 degrees each
        const pointX = centerX + radius * Math.cos(angle);
        const pointY = centerY + radius * Math.sin(angle);
        points.push(pointX, pointY);
      }

      graphics.drawPolygon(points);
    },

    /**
     * Check whether a wall collision lies between two points
     * @param {Point} origin - the starting point {x, y}
     * @param {Point} target - the target point {x, y}
     * @returns {boolean} whether a wall collision occurs
     */
    checkWallCollision: function(origin, target) {
      try {
        // With no canvas or walls, treat it as no collision
        if (!canvas || !canvas.walls) return false;

        // Check only walls that block movement (the MOVEMENT type)
        // The Ray object is no longer used, so it was removed (v13 compatibility)
        const collision = CONFIG.Canvas.polygonBackends.move.testCollision(origin, target, {
          type: 'move',
          mode: 'any'
        });

        return collision;
      } catch (e) {
        console.warn('DX3rd | Wall collision check failed:', e);
        return false; // treat an error as no collision
      }
    },
  });

})();
