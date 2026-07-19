// Typed socket boundary for the DX3rd combat state machine.
(function() {
  const router = window.DX3rdSocketRouter;
  const flow = window.DX3rdCombatFlow;
  if (!router || !flow) {
    console.error('DX3rd | Combat socket dependencies are unavailable.');
    return;
  }

  router.registerType('showTurnActor', data => {
    flow.showTurnActor(data.imgSrc, data.actorName);
  }, { consume: true });

  router.registerType('executeInitiativeProcess', async data => {
    const combat = game.combats.get(data.combatId);
    if (combat) await flow.executeInitiativeProcess(combat);
  }, { consume: true, responsibleGMOnly: true });

  router.registerType('startMainProcessFromInitiative', async data => {
    const combat = game.combats.get(data.combatId);
    const process = combat?.getFlag('dx3rd-emanim', 'currentProcess');
    if (process?.type === 'initiative' && process.actorId === data.actorId) {
      await flow.startMainProcessFromInitiative(combat);
    }
  }, { consume: true, responsibleGMOnly: true });

  router.registerType('executeDisableHook', async data => {
    const combat = game.combats.get(data.combatId);
    const process = combat?.getFlag('dx3rd-emanim', 'currentProcess');
    if (data.timing === 'main' && process?.type === 'main' && process.actorId === data.actorId) {
      await window.DX3rdDisableHooks?.executeDisableHook?.('main', null);
    }
  }, { consume: true, responsibleGMOnly: true });

  router.registerType('advanceCombatProcess', async data => {
    const combat = game.combats.get(data.combatId);
    const process = combat?.getFlag('dx3rd-emanim', 'currentProcess');
    if (process?.type === 'main' && process.actorId === data.actorId) {
      // deferCurrent: 요청자가 행동 대기를 골랐다는 뜻. 라운드 완료 집합에서 되돌린다.
      await flow.advanceCombatState(combat, 'forward', {deferCurrent: Boolean(data.deferCurrent)});
    }
  }, { consume: true, responsibleGMOnly: true });
})();
