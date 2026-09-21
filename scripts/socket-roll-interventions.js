(function () {
  const router = window.DX3rdSocketRouter;
  router.registerType('requestRollInterventionUse', data =>
    window.DX3rdRollInterventionEffects.handleRemoteUseRequest(data), {consume: true});
  router.registerType('respondRollInterventionUse', data =>
    window.DX3rdRollInterventionEffects.handleRemoteUseResponse(data), {consume: true});
})();
