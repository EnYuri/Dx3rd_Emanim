// DX3rd system socket router - one transport listener, many feature handlers.
(function() {
  const MODULE_ID = 'dx3rd-emanim';
  const CHANNEL = `system.${MODULE_ID}`;
  const handlers = new Set();

  function getResponsibleGM() {
    return game.users.activeGM
      ?? game.users.find(user => user.isGM && user.active)
      ?? game.users.find(user => user.isGM)
      ?? null;
  }

  function isResponsibleGM() {
    const responsibleGM = getResponsibleGM();
    return Boolean(game.user.isGM && (!responsibleGM || game.user.id === responsibleGM.id));
  }

  function register(handler) {
    if (typeof handler !== 'function') {
      throw new TypeError('DX3rd socket handler must be a function.');
    }
    handlers.add(handler);
    return () => handlers.delete(handler);
  }

  window.DX3rdSocketRouter = { CHANNEL, register, getResponsibleGM, isResponsibleGM };

  Hooks.once('ready', () => {
    game.socket.on(CHANNEL, async data => {
      for (const handler of handlers) {
        try {
          await handler(data);
        } catch (error) {
          console.error('DX3rd | Socket handler failed:', error);
        }
      }
    });
  });
})();
