// DX3rd 디버그 로거. 상세 추적 로그는 debugLogging 설정이 켜졌을 때만 콘솔에 출력한다.
// 아이템 사용 경로(콤보/데미지/조건)는 확장 배열·버킷 객체를 통째로 찍기 때문에,
// 평시에는 직렬화 비용 자체를 없애기 위해 인자 평가 전에 조기 반환한다.
(function() {
  const SCOPE = 'dx3rd-emanim';
  let cached = null;

  function enabled() {
    if (cached !== null) return cached;
    try {
      // 설정 등록 전(스크립트 로드 시점)에는 game.settings.get 이 던진다 → 비활성으로 취급.
      cached = Boolean(game?.settings?.get(SCOPE, 'debugLogging'));
    } catch (error) {
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
