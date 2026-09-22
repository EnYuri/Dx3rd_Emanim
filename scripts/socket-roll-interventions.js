(function () {
  const router = window.DX3rdSocketRouter;
  router.registerType('rollInterventionOffer', data =>
    window.DX3rdRollInterventionEffects.handleOffer(data), {consume: true});
  router.registerType('rollInterventionDeclare', data =>
    window.DX3rdRollInterventionEffects.handleDeclaration(data), {consume: true});
})();
