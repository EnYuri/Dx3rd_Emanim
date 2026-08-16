// DX3rd debug logger. Verbose traces reach the console only while debugLogging is enabled.
// Item-use paths log whole extension arrays and bucket objects, so callers can guard expensive
// argument construction with enabled() and avoid serialization work during normal play.
(function() {
  const SCOPE = 'dx3rd-emanim';
  let cached = null;

  function enabled() {
    if (cached !== null) return cached;
    try {
      // game.settings.get throws before settings registration; treat that phase as disabled.
      cached = Boolean(game?.settings?.get(SCOPE, 'debugLogging'));
    } catch {
      return false;
    }
    return cached;
  }

  function log(...args) {
    if (!enabled()) return;
    console.log(...args);
  }

  function invalidate() {
    cached = null;
  }

  window.DX3rdDebug = { log, enabled, invalidate };
})();
