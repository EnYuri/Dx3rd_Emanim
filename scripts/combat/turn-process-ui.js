// DX3rd turn process UI - 전투 흐름을 표시하고 진행하는 좌상단 패널
(function () {
    const MODULE_ID = 'dx3rd-emanim';
    let container = null;

    function getProcess() {
        const combat = game.combat;
        const process = combat?.getFlag(MODULE_ID, 'currentProcess') || null;
        return { combat, process, type: process?.type || null, actor: process?.actorId ? game.actors.get(process.actorId) : null };
    }

    function usageKey(combat = game.combat) {
        const process = combat?.getFlag(MODULE_ID, 'currentProcess');
        return `${combat?.round || 0}:${process?.combatantId || 'none'}`;
    }

    function actionUsage(combat = game.combat) {
        return combat?.getFlag(MODULE_ID, 'actionTrackerUsage')?.[usageKey(combat)] || { major: false, minor: false };
    }

    function canUse(actor) {
        return Boolean(actor && (game.user.isGM || actor.isOwner));
    }

    function ownerColor(actor) {
        const ownerLevel = CONST.DOCUMENT_OWNERSHIP_LEVELS?.OWNER ?? 3;
        const owner = game.users.find(user => !user.isGM && (actor?.ownership?.[user.id] ?? 0) >= ownerLevel)
            || game.users.find(user => (actor?.ownership?.[user.id] ?? 0) >= ownerLevel);
        return owner?.color || '#b7c6d7';
    }

    async function updateUsage({ combatId, actorId, action, used, key }) {
        const combat = game.combats.get(combatId);
        const process = combat?.getFlag(MODULE_ID, 'currentProcess');
        if (!combat || process?.type !== 'main' || process.actorId !== actorId || usageKey(combat) !== key) return;
        const usages = foundry.utils.deepClone(combat.getFlag(MODULE_ID, 'actionTrackerUsage') || {});
        usages[key] = { ...(usages[key] || {}), [action]: Boolean(used) };
        await combat.setFlag(MODULE_ID, 'actionTrackerUsage', usages);
    }

    async function toggleUsage(action) {
        const { combat, process, actor } = getProcess();
        if (!combat || process?.type !== 'main' || !canUse(actor)) return;
        const payload = { combatId: combat.id, actorId: actor.id, action, used: !actionUsage()[action], key: usageKey(combat) };
        if (game.user.isGM) await updateUsage(payload);
        else window.DX3rdSocketRouter.emit({ type: 'actionTrackerConsume', payload });
    }

    async function advance() {
        const { combat, type, actor } = getProcess();
        if (!combat) return;
        if (type === 'initiative') {
            // 이니셔티브는 현재 대기 중인 액터의 소유자도 확정할 수 있다.
            // Combat 문서 갱신은 권한을 가진 GM이 수행한다.
            if (!canUse(actor)) return;
            if (game.user.isGM) {
                await window.DX3rdCombatFlow?.startMainProcessFromInitiative?.(combat);
            } else {
                window.DX3rdSocketRouter.emit({
                    type: 'startMainProcessFromInitiative',
                    combatId: combat.id,
                    actorId: actor.id
                });
            }
        } else {
            if (!game.user.isGM) return;
            await combat.nextTurn();
        }
    }

    async function rewind() {
        const { combat } = getProcess();
        if (!combat || !game.user.isGM) return;
        document.getElementById('dx3rd-initiative-dialog')?.remove();
        await window.DX3rdCombatFlow?.enterInitiative?.(combat, combat.combatant?.id);
    }

    async function chooseTurn(action) {
        const { combat, actor } = getProcess();
        if (!combat || !canUse(actor)) return;
        combat._dx3rdForcedTurnChoice = action;
        await combat.nextTurn();
    }

    function render() {
        if (!container) return;
        const { combat, type, actor } = getProcess();
        if (!combat) {
            container.remove();
            container = null;
            return;
        }
        const usage = actionUsage();
        const steps = [
            ['setup', 'DX3rd.SetupProcess', type === 'setup'],
            ['initiative', 'DX3rd.InitiativeProcess', type === 'initiative'],
            ['major', 'DX3rd.Major', type === 'main', usage.major],
            ['minor', 'DX3rd.Minor', type === 'main', usage.minor],
            ['cleanup', 'DX3rd.CleanupProcess', type === 'cleanup']
        ];
        container.style.setProperty('--dx3rd-tracker-owner', ownerColor(actor));
        container.innerHTML = `
            <div class="dx3rd-turn-process-header"><span>${foundry.utils.escapeHTML(actor?.name || game.i18n.localize('DX3rd.CombatProcess'))}</span><small>${game.i18n.localize(type === 'main' ? 'DX3rd.CurrentTurn' : 'DX3rd.CombatProcessActive')}</small></div>
            <div class="dx3rd-turn-process-steps">${steps.map(([id, label, active, spent]) => {
                const isAction = id === 'major' || id === 'minor';
                const click = active && (isAction || id === 'initiative' ? canUse(actor) : game.user.isGM);
                const mode = isAction ? 'toggle' : (id === 'initiative' && type === 'main' && game.user.isGM ? 'rewind' : 'advance');
                return `<button type="button" class="dx3rd-turn-process-step ${active ? 'is-active' : ''} ${spent ? 'is-spent' : ''}" data-action="${mode}" data-step="${id}" ${click ? '' : 'disabled'}><i></i><span>${game.i18n.localize(label)}</span></button>`;
            }).join('')}</div>
            ${type === 'main' && actor ? `<div class="dx3rd-turn-process-controls"><button data-turn="end" ${canUse(actor) ? '' : 'disabled'}>${game.i18n.localize('DX3rd.ActionEnd')}</button><button data-turn="delay" ${canUse(actor) && !actor.system?.conditions?.action_delay?.active ? '' : 'disabled'}>${game.i18n.localize('DX3rd.ActionDelay')}</button></div>` : ''}`;
        container.querySelectorAll('[data-action]:not(:disabled)').forEach(button => button.addEventListener('click', async () => {
            const action = button.dataset.action;
            if (action === 'toggle') await toggleUsage(button.dataset.step);
            else if (action === 'rewind') await rewind();
            else await advance();
        }));
        container.querySelectorAll('[data-turn]:not(:disabled)').forEach(button => button.addEventListener('click', () => chooseTurn(button.dataset.turn)));
    }

    function ensure() {
        if (!game.combat) return render();
        const host = document.getElementById('interface');
        if (!host) return;
        container ??= document.createElement('section');
        container.id = 'dx3rd-turn-process-ui';
        container.className = 'dx3rd-turn-process-ui';
        if (!container.isConnected) host.appendChild(container);
        render();
    }

    window.DX3rdTurnProcessUI = { ensure, updateUsage };
    Hooks.once('ready', ensure);
    Hooks.on('canvasReady', ensure);
    Hooks.on('createCombat', ensure);
    Hooks.on('updateCombat', combat => { if (combat?.id === game.combat?.id) ensure(); });
    Hooks.on('deleteCombat', render);
    Hooks.once('ready', () => {
        const hooks = window.DX3rdDisableHooks;
        if (!hooks?.executeDisableHook || hooks.executeDisableHook._dx3rdTurnProcessUI) return;
        const original = hooks.executeDisableHook;
        const wrapped = async function (timing, actors, ...args) {
            const result = await original.call(this, timing, actors, ...args);
            if (timing === 'major') {
                for (const actor of (Array.isArray(actors) ? actors : [actors]).filter(Boolean)) {
                    const { combat, process } = getProcess();
                    if (combat && process?.type === 'main' && process.actorId === actor.id) {
                        const payload = { combatId: combat.id, actorId: actor.id, action: 'major', used: true, key: usageKey(combat) };
                        if (game.user.isGM) await updateUsage(payload);
                        else window.DX3rdSocketRouter.emit({ type: 'actionTrackerConsume', payload });
                    }
                }
            }
            return result;
        };
        wrapped._dx3rdTurnProcessUI = true;
        hooks.executeDisableHook = wrapped;
    });
})();
