// Universal handler range-highlight lifecycle hooks.
(function() {
  Hooks.on('refreshToken', token => {
    try {
      const handler = window.DX3rdUniversalHandler;
      if (!handler) return;

      const queue = handler.rangeHighlightQueue;
      if (queue.current && queue.current.tokenId === token.id) {
        handler.clearTokenRangeHighlight(token);
        const { range, userColor } = queue.current;
        const grids = range === 1 || range === game.i18n.localize('DX3rd.Engage')
          ? handler.getAdjacentGrids(token)
          : handler.getGridsInRange(token, range);
        for (const grid of grids) {
          handler.drawTokenLocalHighlight(token, grid.x, grid.y, canvas.grid.size, userColor);
        }
      }

      if (token._dx3rdRangeLayer && !token.children.includes(token._dx3rdRangeLayer)) {
        token.addChild(token._dx3rdRangeLayer);
        console.log(`DX3rd | Reattached range layer to token: ${token.name}`);
      }
    } catch (error) {
      console.error('DX3rd | Failed to reattach range layer on token refresh:', error);
    }
  });
})();
