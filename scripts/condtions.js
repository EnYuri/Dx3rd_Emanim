/**
 * DX3rd status condition management
 * Removes Foundry VTT's default status effects and installs the DX3rd-specific ones.
 */

/**
 * The condition application handler
 */
// A flag that suppresses the message when the dialog is cancelled
let _cancellingCondition = false;

/** Return the actor alone as the speaker. The implementation lives in DX3rdRuntimeUtils. */
function getActorOnlySpeaker(actor) {
  return window.DX3rdRuntimeUtils.getActorOnlySpeaker(actor);
}

/**
 * The shared helper for a condition input dialog (confirm / cancel).
 * Replaces the legacy sheet `Dialog` with the AppV2 `DialogV2` while keeping the behavior identical
 * (read the form on confirm, delete the effect on cancel, run no callback when closed with X).
 * @param {object} opts
 * @param {string} opts.title            the window title
 * @param {string} opts.content          the dialog HTML
 * @param {(root: HTMLElement) => Promise<void>|void} opts.onConfirm  the confirm callback; its argument is the dialog root element.
 * @param {() => Promise<void>|void} opts.onCancel                    the cancel (not-confirm) callback.
 */
function _showConditionDialog({ title, content, onConfirm, onCancel }) {
  const DialogV2 = foundry.applications?.api?.DialogV2;
  if (!DialogV2) {
    ui.notifications.error(game.i18n.localize('DX3rd.DialogV2Unavailable'));
    return;
  }
  new DialogV2({
    window: { title },
    content,
    buttons: [
      {
        action: 'confirm',
        icon: 'fas fa-check',
        label: game.i18n.localize("DX3rd.Confirm"),
        default: true,
        callback: async (event, button, dialog) => { if (onConfirm) await onConfirm(dialog.element); }
      },
      {
        action: 'cancel',
        icon: 'fas fa-times',
        label: game.i18n.localize("DX3rd.Cancel"),
        callback: async () => { if (onCancel) await onCancel(); }
      }
    ]
  }).render(true);
}

/**
 * Add the Death Mark overlay to a token
 */
async function addDeathMarkToToken(token) {
  if (!token || !canvas.ready) return;
  
  // Do not add one when a death mark is already present
  if (token.dx3rdDeathMark) return;
  
  try {
    const iconPath = game.settings.get('dx3rd-emanim', 'deathMarkIcon') || 'icons/svg/skull.svg';
    
    // Create the PIXI Container
    const container = new PIXI.Container();
    container.name = 'dx3rd-death-mark';
    
    // The center position
    const centerX = token.w / 2;
    const centerY = token.h / 2;
    
    // The icon size
    const iconSize = Math.min(token.w, token.h);
    
    // Create the sprite
    // v13/v14 compatibility: fall back for foundry.canvas.loadTexture
    const _loadTexture = foundry.canvas?.loadTexture ?? globalThis.loadTexture;
    const texture = await _loadTexture(iconPath);
    const sprite = new PIXI.Sprite(texture);
    
    // Size and position the sprite
    sprite.width = iconSize;
    sprite.height = iconSize;
    sprite.anchor.set(0.5);
    sprite.x = centerX;
    sprite.y = centerY;
    
    // Add it to the container
    container.addChild(sprite);
    
    // Add it to the token
    token.addChild(container);
    token.dx3rdDeathMark = container;
  } catch (error) {
    console.error('DX3rd | Failed to add death mark:', error);
  }
}

/**
 * Remove the Death Mark overlay from a token
 */
function removeDeathMarkFromToken(token) {
  if (!token || !token.dx3rdDeathMark) return;
  
  try {
    const markContainer = token.dx3rdDeathMark;
    token.removeChild(markContainer);
    markContainer.destroy({ children: true });
    token.dx3rdDeathMark = null;
  } catch (error) {
    console.error('DX3rd | Failed to remove death mark:', error);
  }
}

/**
 * Apply the same "mechanical side effects on creation" as the palette path, on the suppress (visual sync) path too.
 * Only the state-dependent side effects are reflected — no chat message, no dialog.
 * - dead: add the death mark to the token and sync to the other clients (identical to handleConditionToggle's dead branch)
 * - dazed: the dice -2 applied effect (identical to handleConditionToggle's dazed branch)
 * (berserk's destructive / chained effects, the poisoned rank dialog and the like are NOT run on the visual sync path —
 *  those apply on the palette / item path only.)
 */
async function applyConditionCreateSideEffects(actor, conditionId) {
  if (!actor) return;
  if (conditionId === "dead") {
    if (canvas.scene) {
      const tokens = canvas.scene.tokens.filter(t => t.actorId === actor.id);
      for (const tokenDoc of tokens) {
        const tokenObj = tokenDoc.object;
        if (tokenObj) {
          await addDeathMarkToToken(tokenObj);
          tokenObj.refresh();
          window.DX3rdSocketRouter.emit({
            type: 'addDeathMark',
            data: { tokenId: tokenDoc.id, sceneId: canvas.scene.id }
          });
        }
      }
    }
  } else if (conditionId === "dazed") {
    await window.DX3rdAppliedEffects.set(actor, 'dazed', {
      name: game.i18n.localize('DX3rd.Dazed'),
      attributes: { dice: -2 },
      disable: '-'
    });
  }
}

async function handleConditionToggle(token, conditionId, isActive, triggerItemName, poisonedRank = null, specialTarget = null, suppressMessage = false) {
  const actor = token.actor;
  if (!actor) return;
  
  // Hatred handling
  if (conditionId === "hatred") {
    if (isActive) {
      // With a specialTarget, skip the dialog and apply it right away
      if (specialTarget) {
        await actor.update({
          "system.conditions.hatred.active": true,
          "system.conditions.hatred.target": specialTarget
        });
        
        // Emit the chat message
        let messageContent = `${game.i18n.localize("DX3rd.Hatred")}(${specialTarget}) ${game.i18n.localize("DX3rd.Apply")}`;
        if (triggerItemName) {
          const clean = String(triggerItemName).split('||')[0];
          messageContent = `${game.i18n.localize("DX3rd.Hatred")}(${specialTarget}) ${game.i18n.localize("DX3rd.Apply")} (${clean})`;
        }
        
        ChatMessage.create({
          content: `<div class="dx3rd-item-chat">${messageContent}</div>`,
          speaker: getActorOnlySpeaker(actor)
        });
        return;
      }
      
      // Fetch the other tokens in the current scene
      const currentScene = game.scenes.active;
      if (!currentScene) {
        ui.notifications.warn(game.i18n.localize('DX3rd.NoActiveScene'));
        const effect = actor.effects.find(e => e.statuses.has("hatred"));
        if (effect) await effect.delete();
        return;
      }
      
      // Fetch the visible tokens other than this one
      const otherTokens = currentScene.tokens
        .filter(t => t.actor && t.actor.id !== actor.id && !t.hidden)
        .map(t => ({ id: t.id, name: t.name }))
        .sort((a, b) => a.name.localeCompare(b.name, 'ko'));
      
      if (otherTokens.length === 0) {
        ui.notifications.warn(game.i18n.localize("DX3rd.NoHatredTarget"));
        const effect = actor.effects.find(e => e.statuses.has("hatred"));
        if (effect) await effect.delete();
        return;
      }
      
      // Build the dropdown options.
      // Escape the token names so markup in one cannot break the select structure.
      // The parser decodes it back (.value returns the original), so comparing the selected value still works.
      const options = otherTokens.map(t => {
        const safe = window.DX3rdRuntimeUtils.escapeHTML(t.name);
        return `<option value="${safe}">${safe}</option>`;
      }).join('');
      
      const template = `
        <div class="condition-rank-dialog">
          <div class="form-group">
            <label>${game.i18n.localize("DX3rd.HatredInputText")}</label>
            <select id="condition-target" style="width: 100%; text-align: center;">
              ${options}
            </select>
          </div>
        </div>
        <style>
        .condition-rank-dialog {
          padding: 5px;
        }
        .condition-rank-dialog .form-group {
          display: flex;
          flex-direction: column;
          gap: 8px;
          margin-top: 0px;
          margin-bottom: 5px;
        }
        .condition-rank-dialog label {
          font-weight: bold;
          font-size: 14px;
        }
        .condition-rank-dialog select {
          padding: 4px;
          font-size: 14px;
          border: 1px solid #ccc;
          border-radius: 4px;
          background: white;
          color: black;
        }
        </style>
      `;
      
      _showConditionDialog({
        title: game.i18n.localize("DX3rd.Hatred"),
        content: template,
        onConfirm: async (root) => {
          const targetName = root.querySelector("#condition-target").value;
          await actor.update({
            "system.conditions.hatred.active": true,
            "system.conditions.hatred.target": targetName
          });

          // Emit the chat message.
          // A token name is user input and chat content is rendered as HTML on every connected client,
          // so it is escaped right before insertion (the same convention as safeDamageText in universal-damage.js).
          const safeTargetName = window.DX3rdRuntimeUtils.escapeHTML(targetName);
          const messageContent = `${game.i18n.localize("DX3rd.Hatred")}(${safeTargetName}) ${game.i18n.localize("DX3rd.Apply")}`;

          ChatMessage.create({
            content: `<div class="dx3rd-item-chat">${messageContent}</div>`,
            speaker: getActorOnlySpeaker(actor)
          });
        },
        onCancel: async () => {
          _cancellingCondition = true;
          const effect = actor.effects.find(e => e.statuses.has("hatred"));
          if (effect) await effect.delete();
          _cancellingCondition = false;
        }
      });
    } else {
      // Clearing: the conditions field is always restored.
      // (When it was turned on from the sheet checkbox and the dialog was then cancelled, active would stay true and
      //  disagree with the overlay — so it is reset to false regardless of _cancellingCondition. When active is already
      //  false this is a no-op diff, so the palette cancel path is unaffected.)
      await actor.update({
        "system.conditions.hatred.active": false,
        "system.conditions.hatred.target": ""
      });

      // The chat message is emitted only when this is neither a cancel nor a suppress
      if (!_cancellingCondition && !suppressMessage) {
        const messageContent = `${game.i18n.localize("DX3rd.Hatred")} ${game.i18n.localize("DX3rd.Clear")}`;

        ChatMessage.create({
          content: `<div class="dx3rd-item-chat">${messageContent}</div>`,
          speaker: getActorOnlySpeaker(actor)
        });
      }
    }
  }
  
  // Berserk handling
  if (conditionId === "berserk") {
    if (isActive) {
      // The berserk type options
      const berserkTypes = [
        { value: "normal", label: game.i18n.localize("DX3rd.Normal") },
        { value: "release", label: game.i18n.localize("DX3rd.UrgeRelease") },
        { value: "hunger", label: game.i18n.localize("DX3rd.UrgeHunger") },
        { value: "bloodsucking", label: game.i18n.localize("DX3rd.UrgeBloodsucking") },
        { value: "slaughter", label: game.i18n.localize("DX3rd.UrgeSlaughter") },
        { value: "destruction", label: game.i18n.localize("DX3rd.UrgeDestruction") },
        { value: "tourture", label: game.i18n.localize("DX3rd.UrgeTourture") },
        { value: "distaste", label: game.i18n.localize("DX3rd.UrgeDistaste") },
        { value: "battlelust", label: game.i18n.localize("DX3rd.UrgeBattlelust") },
        { value: "delusion", label: game.i18n.localize("DX3rd.UrgeDelusion") },
        { value: "selfmutilation", label: game.i18n.localize("DX3rd.UrgeSelfmutilation") },
        { value: "fear", label: game.i18n.localize("DX3rd.UrgeFear") },
        { value: "hatred", label: game.i18n.localize("DX3rd.UrgeHatred") }
      ];
      
      // With a specialTarget, skip the dialog and apply it right away
      if (specialTarget) {
        const selectedType = berserkTypes.find(t => t.value === specialTarget) || berserkTypes[0];
        
        const updates = {
          "system.conditions.berserk.active": true,
          "system.conditions.berserk.type": selectedType.value
        };
        
        // The hunger type applies a dice -5 penalty
        if (selectedType.value === 'hunger') {
          await window.DX3rdAppliedEffects.set(actor, 'berserk_hunger', {
            name: game.i18n.localize('DX3rd.Mutation') + ': ' + game.i18n.localize('DX3rd.UrgeHunger'),
            attributes: {
              dice: -5
            },
            disable: '-'
          });
        }

        // The torture type applies an attack -20 penalty
        if (selectedType.value === 'tourture') {
          await window.DX3rdAppliedEffects.set(actor, 'berserk_tourture', {
            name: game.i18n.localize('DX3rd.Mutation') + ': ' + game.i18n.localize('DX3rd.UrgeTourture'),
            attributes: {
              attack: -20
            },
            disable: '-'
          });
        }
        
        // The self-mutilation type deals HP -5 damage (reduction ignored, capped at max HP)
        if (selectedType.value === 'selfmutilation') {
          const currentHP = actor.system.attributes.hp.value || 0;
          const maxHP = actor.system.attributes.hp.max || 0;
          const damage = Math.min(5, currentHP);
          const newHP = Math.max(0, currentHP - damage);
          
          await actor.update({ "system.attributes.hp.value": newHP });
          
          // Emit the HP damage message
          let damageMessage = `${game.i18n.localize("DX3rd.Berserk")}(${selectedType.label}) ${game.i18n.localize("DX3rd.Apply")}: HP -${damage}`;
          if (triggerItemName) {
            const clean = String(triggerItemName).split('||')[0];
            damageMessage = `${game.i18n.localize("DX3rd.Berserk")}(${selectedType.label}) ${game.i18n.localize("DX3rd.Apply")}: HP -${damage} (${clean})`;
          }
          
          ChatMessage.create({
            content: `<div class="dx3rd-item-chat">${damageMessage}</div>`,
            speaker: getActorOnlySpeaker(actor)
          });
          
          // Remove the berserk status alone (no message)
          const effectsToRemove = actor.effects.filter(e => {
            const statuses = Array.from(e.statuses || []);
            return statuses.some(s => ['berserk'].includes(s));
          });
          
          // Set suppressMessage to true so no clear message is emitted
          window.DX3rdConditionTriggerMap = window.DX3rdConditionTriggerMap || new Map();
          for (const eff of effectsToRemove) {
            const key = `${actor.id}:berserk`;
            window.DX3rdConditionTriggerMap.set(key, { suppressMessage: true });
            await eff.delete();
          }

          // Delete the berserk effect → the deleteActiveEffect hook cleans up with berserk.active:false.
          // Writing updates (active:true) here would race the hook's active:false and could leave an
          // orphan flag (active:true with no icon), so we finish without re-setting it.
          return;
        }

        await actor.update(updates);
        
        // Emit the chat message
        let messageContent = `${game.i18n.localize("DX3rd.Berserk")}(${selectedType.label}) ${game.i18n.localize("DX3rd.Apply")}`;
        if (triggerItemName) {
          const clean = String(triggerItemName).split('||')[0];
          messageContent = `${game.i18n.localize("DX3rd.Berserk")}(${selectedType.label}) ${game.i18n.localize("DX3rd.Apply")} (${clean})`;
        }
        
        ChatMessage.create({
          content: `<div class="dx3rd-item-chat">${messageContent}</div>`,
          speaker: getActorOnlySpeaker(actor)
        });
        
        // The berserk fear type applies rigor as well (after the berserk message)
        if (selectedType.value === 'fear') {
          await actor.toggleStatusEffect("rigor", { active: true });
        }
        
        // The berserk hatred type applies ordinary hatred as well (after the berserk message)
        if (selectedType.value === 'hatred') {
          await actor.toggleStatusEffect("hatred", { active: true });
        }
        
        return;
      }
      
      // Build the dropdown options
      const options = berserkTypes.map(t => `<option value="${t.value}">${t.label}</option>`).join('');
      
      const template = `
        <div class="condition-rank-dialog">
          <div class="form-group">
            <label>${game.i18n.localize("DX3rd.BerserkInputText")}</label>
            <select id="condition-type" style="width: 100%; text-align: center;">
              ${options}
            </select>
          </div>
        </div>
        <style>
        .condition-rank-dialog {
          padding: 5px;
        }
        .condition-rank-dialog .form-group {
          display: flex;
          flex-direction: column;
          gap: 8px;
          margin-top: 0px;
          margin-bottom: 5px;
        }
        .condition-rank-dialog label {
          font-weight: bold;
          font-size: 14px;
        }
        .condition-rank-dialog select {
          padding: 4px;
          font-size: 14px;
          border: 1px solid #ccc;
          border-radius: 4px;
          background: white;
          color: black;
        }
        </style>
      `;
      
      _showConditionDialog({
        title: game.i18n.localize("DX3rd.Berserk"),
        content: template,
        onConfirm: async (root) => {
              const berserkType = root.querySelector("#condition-type").value;
              const selectedType = berserkTypes.find(t => t.value === berserkType);
              
              const updates = {
                "system.conditions.berserk.active": true,
                "system.conditions.berserk.type": berserkType
              };
              
              // The hunger type applies a dice -5 penalty
              if (berserkType === 'hunger') {
                await window.DX3rdAppliedEffects.set(actor, 'berserk_hunger', {
                  name: game.i18n.localize('DX3rd.Mutation') + ': ' + game.i18n.localize('DX3rd.UrgeHunger'),
                  attributes: {
                    dice: -5
                  },
                  disable: '-'
                });
              }

              // The torture type applies an attack -20 penalty
              if (berserkType === 'tourture') {
                await window.DX3rdAppliedEffects.set(actor, 'berserk_tourture', {
                  name: game.i18n.localize('DX3rd.Mutation') + ': ' + game.i18n.localize('DX3rd.UrgeTourture'),
                  attributes: {
                    attack: -20
                  },
                  disable: '-'
                });
              }
              
              // The self-mutilation type deals HP -5 damage (reduction ignored, capped at max HP)
              if (berserkType === 'selfmutilation') {
                const currentHP = actor.system.attributes.hp.value || 0;
                const maxHP = actor.system.attributes.hp.max || 0;
                const damage = Math.min(5, currentHP);
                const newHP = Math.max(0, currentHP - damage);
                
                await actor.update({ "system.attributes.hp.value": newHP });
                
                // Emit the HP damage message
                let damageMessage = `${game.i18n.localize("DX3rd.Berserk")}(${selectedType.label}) ${game.i18n.localize("DX3rd.Apply")}: HP -${damage}`;
                if (triggerItemName) {
                  const clean = String(triggerItemName).split('||')[0];
                  damageMessage = `${game.i18n.localize("DX3rd.Berserk")}(${selectedType.label}) ${game.i18n.localize("DX3rd.Apply")}: HP -${damage} (${clean})`;
                }
                
                ChatMessage.create({
                  content: `<div class="dx3rd-item-chat">${damageMessage}</div>`,
                  speaker: getActorOnlySpeaker(actor)
                });
                
                // Remove the berserk status alone (no message)
                const effectsToRemove = actor.effects.filter(e => {
                  const statuses = Array.from(e.statuses || []);
                  return statuses.some(s => ['berserk'].includes(s));
                });
                
                // Set suppressMessage to true so no clear message is emitted
                window.DX3rdConditionTriggerMap = window.DX3rdConditionTriggerMap || new Map();
                for (const eff of effectsToRemove) {
                  const key = `${actor.id}:berserk`;
                  window.DX3rdConditionTriggerMap.set(key, { suppressMessage: true });
                  await eff.delete();
                }

                // Delete the berserk effect → the deleteActiveEffect hook cleans up with berserk.active:false.
                // Writing updates (active:true) here would race the hook's active:false and could leave an
                // orphan flag (active:true with no icon), so we finish without re-setting it.
                return;
              }

              await actor.update(updates);
              
              // Emit the chat message (with the trigger item's name)
              let messageContent = `${game.i18n.localize("DX3rd.Berserk")}(${selectedType.label}) ${game.i18n.localize("DX3rd.Apply")}`;
              if (triggerItemName) {
                const clean = String(triggerItemName).split('||')[0];
                messageContent = `${game.i18n.localize("DX3rd.Berserk")}(${selectedType.label}) ${game.i18n.localize("DX3rd.Apply")} (${clean})`;
              }
              
              ChatMessage.create({
                content: `<div class="dx3rd-item-chat">${messageContent}</div>`,
                speaker: getActorOnlySpeaker(actor)
              });
              
              // The berserk fear type applies rigor as well (after the berserk message)
              if (berserkType === 'fear') {
                await actor.toggleStatusEffect("rigor", { active: true });
              }
              
              // The berserk hatred type applies ordinary hatred as well (after the berserk message)
              if (berserkType === 'hatred') {
                await actor.toggleStatusEffect("hatred", { active: true });
              }
        },
        onCancel: async () => {
          _cancellingCondition = true;
          const effect = actor.effects.find(e => e.statuses.has("berserk"));
          if (effect) await effect.delete();
          _cancellingCondition = false;
        }
      });
    } else {
      // Clearing: restoring the status fields and removing the applied effect are always done.
      // (Prevents active staying true when it was turned on from the sheet checkbox and the type dialog was cancelled.
      //  When active is already false this is a no-op diff.)
      await actor.update({
        "system.conditions.berserk.active": false,
        "system.conditions.berserk.type": "-"
      });
      await window.DX3rdAppliedEffects.removeMany(actor, ['berserk_hunger', 'berserk_tourture']);

      // The chat message is emitted only when this is neither a cancel nor a suppress
      if (!_cancellingCondition && !suppressMessage) {
        const messageContent = `${game.i18n.localize("DX3rd.Berserk")} ${game.i18n.localize("DX3rd.Clear")}`;

        ChatMessage.create({
          content: `<div class="dx3rd-item-chat">${messageContent}</div>`,
          speaker: getActorOnlySpeaker(actor)
        });
      }
    }
  }
  
  // Fear handling
  if (conditionId === "fear") {
    if (isActive) {
      // With a specialTarget, skip the dialog and apply it right away
      if (specialTarget) {
        await actor.update({
          "system.conditions.fear.active": true,
          "system.conditions.fear.target": specialTarget
        });
        
        // Emit the chat message
        let messageContent = `${game.i18n.localize("DX3rd.Fear")}(${specialTarget}) ${game.i18n.localize("DX3rd.Apply")}`;
        if (triggerItemName) {
          const clean = String(triggerItemName).split('||')[0];
          messageContent = `${game.i18n.localize("DX3rd.Fear")}(${specialTarget}) ${game.i18n.localize("DX3rd.Apply")} (${clean})`;
        }
        
        ChatMessage.create({
          content: `<div class="dx3rd-item-chat">${messageContent}</div>`,
          speaker: getActorOnlySpeaker(actor)
        });
        return;
      }
      
      // Fetch the other tokens in the current scene
      const currentScene = game.scenes.active;
      if (!currentScene) {
        ui.notifications.warn(game.i18n.localize('DX3rd.NoActiveScene'));
        const effect = actor.effects.find(e => e.statuses.has("fear"));
        if (effect) await effect.delete();
        return;
      }
      
      // Fetch the visible tokens other than this one
      const otherTokens = currentScene.tokens
        .filter(t => t.actor && t.actor.id !== actor.id && !t.hidden)
        .map(t => ({ id: t.id, name: t.name }))
        .sort((a, b) => a.name.localeCompare(b.name, 'ko'));
      
      if (otherTokens.length === 0) {
        ui.notifications.warn(game.i18n.localize('DX3rd.NoOtherToken'));
        const effect = actor.effects.find(e => e.statuses.has("fear"));
        if (effect) await effect.delete();
        return;
      }
      
      // Build the dropdown options.
      // Escape the token names so markup in one cannot break the select structure.
      // The parser decodes it back (.value returns the original), so comparing the selected value still works.
      const options = otherTokens.map(t => {
        const safe = window.DX3rdRuntimeUtils.escapeHTML(t.name);
        return `<option value="${safe}">${safe}</option>`;
      }).join('');
      
      const template = `
        <div class="condition-rank-dialog">
          <div class="form-group">
            <label>${game.i18n.localize("DX3rd.FearInputText")}</label>
            <select id="condition-target" style="width: 100%; text-align: center;">
              ${options}
            </select>
          </div>
        </div>
        <style>
        .condition-rank-dialog {
          padding: 5px;
        }
        .condition-rank-dialog .form-group {
          display: flex;
          flex-direction: column;
          gap: 8px;
          margin-top: 0px;
          margin-bottom: 5px;
        }
        .condition-rank-dialog label {
          font-weight: bold;
          font-size: 14px;
        }
        .condition-rank-dialog select {
          padding: 4px;
          font-size: 14px;
          border: 1px solid #ccc;
          border-radius: 4px;
          background: white;
          color: black;
        }
        </style>
      `;
      
      _showConditionDialog({
        title: game.i18n.localize("DX3rd.Fear"),
        content: template,
        onConfirm: async (root) => {
          const targetName = root.querySelector("#condition-target").value;
          await actor.update({
            "system.conditions.fear.active": true,
            "system.conditions.fear.target": targetName
          });

          // Emit the chat message.
          // Token names and item names are both user input and chat content is rendered as HTML on every
          // connected client, so they are escaped right before insertion (the same convention as the hatred path).
          const safeTargetName = window.DX3rdRuntimeUtils.escapeHTML(targetName);
          let messageContent = `${game.i18n.localize("DX3rd.Fear")}(${safeTargetName}) ${game.i18n.localize("DX3rd.Apply")}`;
          if (triggerItemName) {
            const clean = window.DX3rdRuntimeUtils.escapeHTML(String(triggerItemName).split('||')[0]);
            messageContent = `${game.i18n.localize("DX3rd.Fear")}(${safeTargetName}) ${game.i18n.localize("DX3rd.Apply")} (${clean})`;
          }

          ChatMessage.create({
            content: `<div class="dx3rd-item-chat">${messageContent}</div>`,
            speaker: getActorOnlySpeaker(actor)
          });
        },
        onCancel: async () => {
          _cancellingCondition = true;
          const effect = actor.effects.find(e => e.statuses.has("fear"));
          if (effect) await effect.delete();
          _cancellingCondition = false;
        }
      });
    } else {
      // Clearing: the conditions field is always restored (in case the sheet checkbox was ticked and the dialog cancelled).
      // When active is already false this is a no-op diff.
      await actor.update({
        "system.conditions.fear.active": false,
        "system.conditions.fear.target": ""
      });

      // The chat message is emitted only when this is neither a cancel nor a suppress
      if (!_cancellingCondition && !suppressMessage) {
        const messageContent = `${game.i18n.localize("DX3rd.Fear")} ${game.i18n.localize("DX3rd.Clear")}`;

        ChatMessage.create({
          content: `<div class="dx3rd-item-chat">${messageContent}</div>`,
          speaker: getActorOnlySpeaker(actor)
        });
      }
    }
  }
  
  // Rigor handling
  if (conditionId === "rigor") {
    if (isActive) {
      await actor.update({
        "system.conditions.rigor.active": true
      });
      
      // Emit the chat message
      let messageContent = `${game.i18n.localize("DX3rd.Rigor")} ${game.i18n.localize("DX3rd.Apply")}`;
      if (triggerItemName) {
        const clean = String(triggerItemName).split('||')[0];
        messageContent = `${game.i18n.localize("DX3rd.Rigor")} ${game.i18n.localize("DX3rd.Apply")} (${clean})`;
      }
      
              ChatMessage.create({
                content: `<div class="dx3rd-item-chat">${messageContent}</div>`,
                speaker: getActorOnlySpeaker(actor)
              });
    } else {
      if (!_cancellingCondition) {
        await actor.update({
          "system.conditions.rigor.active": false
        });
        
        // Emit the chat message (only when suppressMessage is false)
        if (!suppressMessage) {
          const messageContent = `${game.i18n.localize("DX3rd.Rigor")} ${game.i18n.localize("DX3rd.Clear")}`;
          
          ChatMessage.create({
            content: `<div class="dx3rd-item-chat">${messageContent}</div>`,
            speaker: getActorOnlySpeaker(actor)
          });
        }
      }
    }
  }
  
  // Pressure handling
  if (conditionId === "pressure") {
    if (isActive) {
      await actor.update({
        "system.conditions.pressure.active": true
      });
      
      // Emit the chat message
      let messageContent = `${game.i18n.localize("DX3rd.Pressure")} ${game.i18n.localize("DX3rd.Apply")}`;
      if (triggerItemName) {
        const clean = String(triggerItemName).split('||')[0];
        messageContent = `${game.i18n.localize("DX3rd.Pressure")} ${game.i18n.localize("DX3rd.Apply")} (${clean})`;
      }
      
              ChatMessage.create({
                content: `<div class="dx3rd-item-chat">${messageContent}</div>`,
                speaker: getActorOnlySpeaker(actor)
              });
    } else {
      if (!_cancellingCondition) {
        await actor.update({
          "system.conditions.pressure.active": false
        });
        
        // Emit the chat message (only when suppressMessage is false)
        if (!suppressMessage) {
          const messageContent = `${game.i18n.localize("DX3rd.Pressure")} ${game.i18n.localize("DX3rd.Clear")}`;
          
          ChatMessage.create({
            content: `<div class="dx3rd-item-chat">${messageContent}</div>`,
            speaker: getActorOnlySpeaker(actor)
          });
        }
      }
    }
  }
  
  // Dazed handling
  if (conditionId === "dazed") {
    if (isActive) {
      // Add the applied effect (dice -2) as a native ActiveEffect
      await actor.update({ "system.conditions.dazed.active": true });
      await window.DX3rdAppliedEffects.set(actor, 'dazed', {
        name: game.i18n.localize('DX3rd.Dazed'),
        attributes: {
          dice: -2
        },
        disable: '-'
      });
      
      // Emit the chat message
      let messageContent = `${game.i18n.localize("DX3rd.Dazed")} ${game.i18n.localize("DX3rd.Apply")}`;
      if (triggerItemName) {
        const clean = String(triggerItemName).split('||')[0];
        messageContent = `${game.i18n.localize("DX3rd.Dazed")} ${game.i18n.localize("DX3rd.Apply")} (${clean})`;
      }
      
              ChatMessage.create({
                content: `<div class="dx3rd-item-chat">${messageContent}</div>`,
                speaker: getActorOnlySpeaker(actor)
              });
    } else {
      if (!_cancellingCondition) {
        // Remove both the status and the applied effect
        await actor.update({ "system.conditions.dazed.active": false });
        await window.DX3rdAppliedEffects.remove(actor, 'dazed');
        
        // Emit the chat message (only when suppressMessage is false)
        if (!suppressMessage) {
          const messageContent = `${game.i18n.localize("DX3rd.Dazed")} ${game.i18n.localize("DX3rd.Clear")}`;
          
          ChatMessage.create({
            content: `<div class="dx3rd-item-chat">${messageContent}</div>`,
            speaker: getActorOnlySpeaker(actor)
          });
        }
      }
    }
  }
  
  // Boarding handling
  if (conditionId === "boarding") {
    if (isActive) {
      await actor.update({
        "system.conditions.boarding.active": true
      });
      
      // Emit the chat message
      let messageContent = `${game.i18n.localize("DX3rd.Boarding")} ${game.i18n.localize("DX3rd.Apply")}`;
      if (triggerItemName) {
        const clean = String(triggerItemName).split('||')[0];
        messageContent = `${game.i18n.localize("DX3rd.Boarding")} ${game.i18n.localize("DX3rd.Apply")} (${clean})`;
      }
      
              ChatMessage.create({
                content: `<div class="dx3rd-item-chat">${messageContent}</div>`,
                speaker: getActorOnlySpeaker(actor)
              });
    } else {
      if (!_cancellingCondition) {
        await actor.update({
          "system.conditions.boarding.active": false
        });
        
        // Emit the chat message (only when suppressMessage is false)
        if (!suppressMessage) {
          const messageContent = `${game.i18n.localize("DX3rd.Boarding")} ${game.i18n.localize("DX3rd.Clear")}`;
          
          ChatMessage.create({
            content: `<div class="dx3rd-item-chat">${messageContent}</div>`,
            speaker: getActorOnlySpeaker(actor)
          });
        }
      }
    }
  }
  
  // Stealth handling
  if (conditionId === "stealth") {
    if (isActive) {
      await actor.update({
        "system.conditions.stealth.active": true
      });
      
      // Emit the chat message
      let messageContent = `${game.i18n.localize("DX3rd.Stealth")} ${game.i18n.localize("DX3rd.Apply")}`;
      if (triggerItemName) {
        const clean = String(triggerItemName).split('||')[0];
        messageContent = `${game.i18n.localize("DX3rd.Stealth")} ${game.i18n.localize("DX3rd.Apply")} (${clean})`;
      }
      
              ChatMessage.create({
                content: `<div class="dx3rd-item-chat">${messageContent}</div>`,
                speaker: getActorOnlySpeaker(actor)
              });
    } else {
      if (!_cancellingCondition) {
        await actor.update({
          "system.conditions.stealth.active": false
        });
        
        // Emit the chat message (only when suppressMessage is false)
        if (!suppressMessage) {
          const messageContent = `${game.i18n.localize("DX3rd.Stealth")} ${game.i18n.localize("DX3rd.Clear")}`;
          
          ChatMessage.create({
            content: `<div class="dx3rd-item-chat">${messageContent}</div>`,
            speaker: getActorOnlySpeaker(actor)
          });
        }
      }
    }
  }
  
  // Flight handling
  if (conditionId === "fly") {
    if (isActive) {
      await actor.update({
        "system.conditions.fly.active": true
      });
      
      // Emit the chat message
      let messageContent = `${game.i18n.localize("DX3rd.Fly")} ${game.i18n.localize("DX3rd.Apply")}`;
      if (triggerItemName) {
        const clean = String(triggerItemName).split('||')[0];
        messageContent = `${game.i18n.localize("DX3rd.Fly")} ${game.i18n.localize("DX3rd.Apply")} (${clean})`;
      }
      
              ChatMessage.create({
                content: `<div class="dx3rd-item-chat">${messageContent}</div>`,
                speaker: getActorOnlySpeaker(actor)
              });
    } else {
      if (!_cancellingCondition) {
        await actor.update({
          "system.conditions.fly.active": false
        });
        
        // Emit the chat message (only when suppressMessage is false)
        if (!suppressMessage) {
          const messageContent = `${game.i18n.localize("DX3rd.Fly")} ${game.i18n.localize("DX3rd.Clear")}`;
          
          ChatMessage.create({
            content: `<div class="dx3rd-item-chat">${messageContent}</div>`,
            speaker: getActorOnlySpeaker(actor)
          });
        }
      }
    }
  }
  
  // Defeated handling
  if (conditionId === "dead") {
    if (isActive) {
      await actor.update({
        "system.conditions.defeated.active": true
      });
      
      // Add a death mark to every token of this actor in the current scene
      if (canvas.scene) {
        const tokens = canvas.scene.tokens.filter(t => t.actorId === actor.id);
        for (const tokenDoc of tokens) {
          const tokenObj = tokenDoc.object;
          if (tokenObj) {
            await addDeathMarkToToken(tokenObj);
            tokenObj.refresh();
            
            // Add the death mark on the other clients too
            window.DX3rdSocketRouter.emit({
              type: 'addDeathMark',
              data: {
                tokenId: tokenDoc.id,
                sceneId: canvas.scene.id
              }
            });
          }
        }
      }
      
      // Emit the chat message
      let messageContent = `${game.i18n.localize("DX3rd.Defeated")} ${game.i18n.localize("DX3rd.Apply")}`;
      if (triggerItemName) {
        const clean = String(triggerItemName).split('||')[0];
        messageContent = `${game.i18n.localize("DX3rd.Defeated")} ${game.i18n.localize("DX3rd.Apply")} (${clean})`;
      }
      
              ChatMessage.create({
                content: `<div class="dx3rd-item-chat">${messageContent}</div>`,
                speaker: getActorOnlySpeaker(actor)
              });
    } else {
      if (!_cancellingCondition) {
        await actor.update({
          "system.conditions.defeated.active": false
        });
        
        // Remove the death mark from every token of this actor in the current scene
        if (canvas.scene) {
          const tokens = canvas.scene.tokens.filter(t => t.actorId === actor.id);
          for (const tokenDoc of tokens) {
            const tokenObj = tokenDoc.object;
            if (tokenObj) {
              removeDeathMarkFromToken(tokenObj);
              tokenObj.refresh();
              
              // Remove the death mark on the other clients too
              window.DX3rdSocketRouter.emit({
                type: 'removeDeathMark',
                data: {
                  tokenId: tokenDoc.id,
                  sceneId: canvas.scene.id
                }
              });
            }
          }
        }
        
        // Emit the chat message (only when suppressMessage is false)
        if (!suppressMessage) {
          const messageContent = `${game.i18n.localize("DX3rd.Defeated")} ${game.i18n.localize("DX3rd.Clear")}`;
          
          ChatMessage.create({
            content: `<div class="dx3rd-item-chat">${messageContent}</div>`,
            speaker: getActorOnlySpeaker(actor)
          });
        }
      }
    }
  }
  
  // Poison handling
  if (conditionId === "poisoned") {
    if (isActive) {
      // Recover the trigger and the candidate rank from the global pending queue
      let triggerFromMap = null;
      let rankFromMap = null;
      if (window.DX3rdConditionTriggerMap) {
        const key = `${actor.id}:${conditionId}`;
        triggerFromMap = window.DX3rdConditionTriggerMap.get(key) || null;
        // There is no separate poisonedRank map and the trigger map cannot carry it → the triggerItemName argument received below is used instead
      }
      // The triggerItemName argument of handleConditionToggle takes precedence
      const triggerName = triggerItemName || triggerFromMap || null;
      // When the extension passed a rank, apply it without a dialog
      // A poisonedRank passed directly as a parameter wins (when poison is already present)
      const passedRank = poisonedRank || game?.dx3rd?.pendingPoisonedRank || null;
      if (passedRank) {
        // Compare with the existing rank and keep the higher one
        const currentRank = Number(actor.system?.conditions?.poisoned?.value || 0);
        let newRank = 0;
        try {
          const clean = String(passedRank).trim();
          // UniversalHandler is expected to pass a number, but should a string formula arrive, try evaluating it once more here
          if (typeof window.DX3rdFormulaEvaluator?.evaluate === 'function' && /\[/.test(clean)) {
            const dummyItem = { type: 'effect', system: { level: { value: 1 } } };
            const evaluated = window.DX3rdFormulaEvaluator.evaluate(clean, dummyItem, actor);
            newRank = Number(evaluated) || 0;
          } else {
            newRank = Number(clean) || 0;
          }
        } catch (e) {
          console.warn('DX3rd | Failed to evaluate poisonedRank at hook, fallback to number:', e);
          newRank = Number(passedRank) || 0;
        }
        if (newRank > currentRank) {
          await actor.update({
            "system.conditions.poisoned.active": true,
            "system.conditions.poisoned.value": newRank
          });
          let msg = `${game.i18n.localize("DX3rd.Poisoned")}(Rank.${newRank}) ${game.i18n.localize("DX3rd.Apply")}`;
          if (triggerName) {
            const cleanTrig = String(triggerName).split('||')[0];
            msg = `${game.i18n.localize("DX3rd.Poisoned")}(Rank.${newRank}) ${game.i18n.localize("DX3rd.Apply")} (${cleanTrig})`;
          }
          ChatMessage.create({ content: `<div class="dx3rd-item-chat">${msg}</div>`, speaker: getActorOnlySpeaker(actor) });
        }
        // Clear the one-shot handoff value
        if (game.dx3rd) game.dx3rd.pendingPoisonedRank = null;
        return;
      }
      // Show the dialog (when nothing was handed in)
      const template = `
        <div class="condition-rank-dialog">
          <div class="form-group">
            <label>${game.i18n.localize("DX3rd.PoisonedInputText")}</label>
            <input type="number" id="condition-rank" min="1" value="1" style="width: 100%; text-align: center;">
          </div>
        </div>
        <style>
        .condition-rank-dialog {
          padding: 5px;
        }
        .condition-rank-dialog .form-group {
          display: flex;
          flex-direction: column;
          gap: 8px;
          margin-top: 0px;
          margin-bottom: 5px;
        }
        .condition-rank-dialog label {
          font-weight: bold;
          font-size: 14px;
        }
        .condition-rank-dialog input {
          padding: 4px;
          font-size: 14px;
          border: 1px solid #ccc;
          border-radius: 4px;
        }
        </style>
      `;
      
      _showConditionDialog({
        title: game.i18n.localize("DX3rd.Poisoned"),
        content: template,
        onConfirm: async (root) => {
          const rank = parseInt(root.querySelector("#condition-rank").value) || 1;
          await actor.update({
            "system.conditions.poisoned.active": true,
            "system.conditions.poisoned.value": rank
          });

          // Emit the chat message (with the trigger item's name)
          let messageContent = `${game.i18n.localize("DX3rd.Poisoned")}(Rank.${rank}) ${game.i18n.localize("DX3rd.Apply")}`;
          if (triggerName) {
            const clean = String(triggerName).split('||')[0];
            messageContent = `${game.i18n.localize("DX3rd.Poisoned")}(Rank.${rank}) ${game.i18n.localize("DX3rd.Apply")} (${clean})`;
          }

          ChatMessage.create({
            content: `<div class="dx3rd-item-chat">${messageContent}</div>`,
            speaker: getActorOnlySpeaker(actor)
          });
        },
        onCancel: async () => {
          // Remove the status effect
          _cancellingCondition = true;
          const effect = actor.effects.find(e => e.statuses.has("poisoned"));
          if (effect) await effect.delete();
          _cancellingCondition = false;
        }
      });
    } else {
      // Clearing: the conditions field is always restored (in case the sheet checkbox was ticked and the rank dialog cancelled).
      // When active is already false this is a no-op diff.
      await actor.update({
        "system.conditions.poisoned.active": false,
        "system.conditions.poisoned.value": 0
      });

      // The chat message is emitted only when this is neither a cancel nor a suppress
      if (!_cancellingCondition && !suppressMessage) {
        const messageContent = `${game.i18n.localize("DX3rd.Poisoned")} ${game.i18n.localize("DX3rd.Clear")}`;

        ChatMessage.create({
          content: `<div class="dx3rd-item-chat">${messageContent}</div>`,
          speaker: getActorOnlySpeaker(actor)
        });
      }
    }
  }
}

Hooks.once('ready', async function() {
  // Remove the existing status effects
  CONFIG.statusEffects = [];
  
  // The DX3rd status effect definitions
  CONFIG.statusEffects = [
    // Poisoned
    {
      id: "poisoned",
      name: "DX3rd.Poisoned",
      img: "icons/svg/blood.svg"
    },
    
    // Hatred
    {
      id: "hatred", 
      name: "DX3rd.Hatred",
      img: "icons/svg/fire.svg"
    },
    
    // Fear
    {
      id: "fear",
      name: "DX3rd.Fear", 
      img: "icons/svg/terror.svg"
    },
    
    // Berserk
    {
      id: "berserk",
      name: "DX3rd.Berserk",
      img: "icons/svg/pawprint.svg"
    },
    
    // Rigor
    {
      id: "rigor",
      name: "DX3rd.Rigor",
      img: "icons/svg/net.svg"
    },
    
    // Pressure
    {
      id: "pressure",
      name: "DX3rd.Pressure",
      img: "icons/svg/paralysis.svg"
    },
    
    // Dazed
    {
      id: "dazed",
      name: "DX3rd.Dazed", 
      img: "icons/svg/stoned.svg"
    },
    
    // Boarding
    {
      id: "boarding",
      name: "DX3rd.Boarding",
      img: "icons/svg/target.svg"
    },
    
    // Stealth
    {
      id: "stealth",
      name: "DX3rd.Stealth",
      img: "icons/svg/blind.svg"
    },
    
    // Fly
    {
      id: "fly",
      name: "DX3rd.Fly",
      img: "icons/svg/wing.svg"
    },

    // Defeated
    {
      id: "dead",
      name: "DX3rd.Defeated",
      img: "icons/svg/skull.svg"
    }
  ];
  
  // Hook the status toggle events
  Hooks.on('createActiveEffect', async (effect, options, userId) => {
    if (game.user.id !== userId) return;

    const actor = effect.parent;
    if (!actor) return;

    // An applied buff (a native AE) is not a condition-sync target — this prevents false positives from a synthetic status
    if (effect.getFlag?.('dx3rd-emanim', 'appliedKey')) return;

    // Convert statuses to an array and take the first element
    const conditionId = Array.from(effect.statuses || [])[0];
    
    if (conditionId) {
      // When applied by an extension, suppress the duplicate default message (UniversalHandler emits it)
      // Safe handoff: recover the trigger item's name from the global pending queue
      let triggerItemName = null;
      let poisonedRankFromMap = null;
      let specialTargetFromMap = null;
      if (window.DX3rdConditionTriggerMap) {
        const key = `${actor.id}:${conditionId}`;
        const payload = window.DX3rdConditionTriggerMap.get(key);
        if (payload) {
          triggerItemName = payload.trigger || null;
          poisonedRankFromMap = payload.poisonedRank || null;
          specialTargetFromMap = payload.specialTarget || null;
          const suppressMessage = payload.suppressMessage || false;
          
          // With suppressMessage true the message and dialog are skipped, but the mechanical side effects
          // (death mark / dazed applied, …) are applied exactly as on the palette path.
          // (Merged so the sheet checkbox → updateActor sync path produces the same result as the palette path.)
          // The data is still deleted from the map, so message suppression does not carry over to the clear
          if (suppressMessage) {
            window.DX3rdConditionTriggerMap.delete(key);
            await applyConditionCreateSideEffects(actor, conditionId);
            return;
          }
          
          window.DX3rdConditionTriggerMap.delete(key);
        }
      }
      if (triggerItemName || poisonedRankFromMap || specialTargetFromMap) {
        let token = actor.token;
        if (!token && canvas.scene) {
          const tokenDoc = canvas.scene.tokens.find(t => t.actorId === actor.id);
          if (tokenDoc) token = tokenDoc.object || { actor };
        }
        // Hand over the poison rank / special target (when present) as direct parameters
        await handleConditionToggle(token || { actor }, conditionId, true, triggerItemName, poisonedRankFromMap, specialTargetFromMap);
        return;
      }
      // Find this actor's tokens (in the current scene)
      let token = actor.token;
      if (!token && canvas.scene) {
        const tokenDoc = canvas.scene.tokens.find(t => t.actorId === actor.id);
        if (tokenDoc) {
          token = tokenDoc.object || { actor };
        }
      }
      await handleConditionToggle(token || { actor }, conditionId, true);
    }
  });
  
  Hooks.on('deleteActiveEffect', async (effect, options, userId) => {
    if (game.user.id !== userId) return;

    const actor = effect.parent;
    if (!actor) return;

    // An applied buff (a native AE) is not a condition-sync target — this prevents false positives from a synthetic status
    if (effect.getFlag?.('dx3rd-emanim', 'appliedKey')) return;
    // Equipment grant markers are excluded for the same reason (they carry the unique `dx3rd-grant-*` status).
    // Their cleanup is handled by the dedicated hook in universal-extensions.js.
    if (effect.getFlag?.('dx3rd-emanim', 'itemGrant')) return;

    const conditionId = Array.from(effect.statuses || [])[0];
    
    if (conditionId) {
      // Check the suppressMessage flag
      let suppressMessage = false;
      if (window.DX3rdConditionTriggerMap) {
        const key = `${actor.id}:${conditionId}`;
        const payload = window.DX3rdConditionTriggerMap.get(key);
        if (payload && payload.suppressMessage) {
          suppressMessage = true;
          window.DX3rdConditionTriggerMap.delete(key);
        }
      }
      
      // Find this actor's tokens (in the current scene)
      let token = actor.token;
      if (!token && canvas.scene) {
        const tokenDoc = canvas.scene.tokens.find(t => t.actorId === actor.id);
        if (tokenDoc) {
          token = tokenDoc.object || { actor };
        }
      }
      
      // With suppressMessage true only the message is suppressed; the applied removal still happens
      if (suppressMessage) {
        await handleConditionToggle(token || { actor }, conditionId, false, null, null, null, true);
      } else {
        await handleConditionToggle(token || { actor }, conditionId, false);
      }
    }
  });

  /**
   * Sync the system.conditions.<id>.active value with the token overlay (the status ActiveEffect).
   * The bridge that makes the status icon (overlay) appear on the token even on paths that change only
   * the conditions data — the sheet checkbox, item use, and so on.
   *
   * - conditions.<id>.active === true with no matching ActiveEffect → create it
   * - conditions.<id>.active === false with a matching ActiveEffect → delete it
   *
   * On create / delete, DX3rdConditionTriggerMap's suppressMessage flag is raised so the
   * createActiveEffect / deleteActiveEffect hooks skip their dialogs and duplicate chat (pure visual sync).
   * Keying on whether the effect exists makes it idempotent, so it never conflicts with the palette toggle path.
   *
   * defeated syncs through the "dead" status overlay and the death mark. On create the death mark is handled by
   * applyConditionCreateSideEffects (the suppress branch) and on delete by handleConditionToggle's dead branch
   * (suppress), so the sheet checkbox and the token overlay agree.
   */
  const CONDITION_TO_STATUS = {
    poisoned: "poisoned",
    hatred: "hatred",
    fear: "fear",
    berserk: "berserk",
    rigor: "rigor",
    pressure: "pressure",
    dazed: "dazed",
    boarding: "boarding",
    stealth: "stealth",
    fly: "fly",
    defeated: "dead"
  };

  Hooks.on('updateActor', async (actor, updateData, options, userId) => {
    // Only the client that caused the change syncs the overlay (avoiding duplicate creation on multiple connections)
    if (game.user.id !== userId) return;

    // This hook only cares about system.conditions.*.active, but flattenObject walks the whole payload.
    // Filter first so a large update like a sheet save does not do that work for nothing.
    if (!window.DX3rdRuntimeUtils.updateTouchesPath(updateData, 'system.conditions')) return;

    let flat;
    try {
      flat = foundry.utils.flattenObject(updateData);
    } catch (e) {
      return;
    }

    for (const [cond, status] of Object.entries(CONDITION_TO_STATUS)) {
      const key = `system.conditions.${cond}.active`;
      if (!(key in flat)) continue;

      const nowActive = !!flat[key];
      const hasEffect = actor.effects.some(e => e.statuses.has(status));

      // Turning a status on or off from the sheet checkbox fires it "exactly like" the palette / item path
      // (dialog, side effects and chat message included) — creating or deleting the overlay (ActiveEffect)
      // makes the regular createActiveEffect / deleteActiveEffect hook call handleConditionToggle.
      //
      // The hasEffect guard prevents a double fire:
      //   - Palette / item path: handleConditionToggle creates the overlay first and then sets conditions.active
      //     → when this hook runs on that update, hasEffect is already true, so it does not re-toggle.
      //   - Sheet path: this hook creates the overlay first, and the conditions.active (=true) that
      //     handleConditionToggle sets is a no-op diff, so it does not re-enter.
      if (nowActive && !hasEffect) {
        try {
          await actor.toggleStatusEffect(status, { active: true });
        } catch (e) {
          console.warn(`DX3rd | Failed to sync overlay ON for ${cond}:`, e);
        }
      } else if (!nowActive && hasEffect) {
        try {
          const eff = actor.effects.find(e => e.statuses.has(status));
          if (eff) await eff.delete();
        } catch (e) {
          console.warn(`DX3rd | Failed to sync overlay OFF for ${cond}:`, e);
        }
      }
    }

    // Re-tune the "persistent penalties" that depend on the berserk type to match the sheet dropdown value.
    // Runs on a .active / .type change so it covers both the active toggle and a type change, in either order.
    // It handles only state-dependent persistent effects (hunger dice-5, torture attack-20) —
    // one-shot events at application time (self-mutilation HP-5, fear→rigor, hatred→hatred, bloodsucking, …) must not
    // re-fire from a dropdown change alone, so they are not handled here (palette / item trigger only).
    if ('system.conditions.berserk.active' in flat || 'system.conditions.berserk.type' in flat) {
      const bActive = !!actor.system?.conditions?.berserk?.active;
      const bType = actor.system?.conditions?.berserk?.type || '-';

      const wantHunger = bActive && bType === 'hunger';
      const wantTourture = bActive && bType === 'tourture';
      const hasHunger = actor.effects.some(e => e.getFlag?.('dx3rd-emanim', 'appliedKey') === 'berserk_hunger');
      const hasTourture = actor.effects.some(e => e.getFlag?.('dx3rd-emanim', 'appliedKey') === 'berserk_tourture');

      try {
        if (wantHunger && !hasHunger) {
          await window.DX3rdAppliedEffects.set(actor, 'berserk_hunger', {
            name: game.i18n.localize('DX3rd.Mutation') + ': ' + game.i18n.localize('DX3rd.UrgeHunger'),
            attributes: { dice: -5 },
            disable: '-'
          });
        } else if (!wantHunger && hasHunger) {
          await window.DX3rdAppliedEffects.remove(actor, 'berserk_hunger');
        }

        if (wantTourture && !hasTourture) {
          await window.DX3rdAppliedEffects.set(actor, 'berserk_tourture', {
            name: game.i18n.localize('DX3rd.Mutation') + ': ' + game.i18n.localize('DX3rd.UrgeTourture'),
            attributes: { attack: -20 },
            disable: '-'
          });
        } else if (!wantTourture && hasTourture) {
          await window.DX3rdAppliedEffects.remove(actor, 'berserk_tourture');
        }
      } catch (e) {
        console.warn('DX3rd | Failed to reconcile berserk penalties:', e);
      }
    }
  });

  // The initiating client records the pre-update value and alone owns the resulting status change.
  // preUpdateActor is local to that client, while updateActor is observed by every client; keeping
  // both halves on the initiator avoids both a missing GM cache and duplicate status toggles.
  const _previousHpValues = new Map();
  const _lastKnownHpValues = new Map();
  
  // Save the previous value before the HP change
  Hooks.on('preUpdateActor', (actor, updateData, options, userId) => {
    if (userId !== game.user.id) return;
    // updateData may arrive in nested form or in dot notation
    const incomingHp =
      updateData.system?.attributes?.hp?.value ??
      updateData["system.attributes.hp.value"];
    
    if (incomingHp !== undefined) {
      const currentHp = Number(actor.system?.attributes?.hp?.value ?? 0);
      _previousHpValues.set(actor.id, currentHp);
      _lastKnownHpValues.set(actor.id, currentHp);
    }
  });
  
  // Detect an HP change and toggle the defeated (dead) status automatically
  Hooks.on('updateActor', async (actor, updateData, options, userId) => {
    // Only the client which initiated this update has the matching pre-update value. That client
    // necessarily had permission to update the actor, and can therefore toggle its status as well.
    if (userId !== game.user.id) return;

    // Did the HP value change?
    const incomingHp =
      updateData.system?.attributes?.hp?.value ??
      updateData["system.attributes.hp.value"];
    
    if (incomingHp !== undefined) {
      const cachedOldHp =
        _previousHpValues.get(actor.id) ??
        _lastKnownHpValues.get(actor.id);
      const oldHp = Number(cachedOldHp);
      const newHp = Number(incomingHp);
      
      // Drop the previous value
      _previousHpValues.delete(actor.id);
      _lastKnownHpValues.set(actor.id, newHp);
      
      const transition = window.DX3rdRuntimeUtils?.classifyHpTransition?.(oldHp, newHp);

      // HP crossed from positive to zero or below.
      if (transition === 'defeated') {
        // Is the dead status already present?
        const hasDeadEffect = actor.effects.find(e => e.statuses.has("dead"));
        if (!hasDeadEffect) {
          await actor.toggleStatusEffect("dead", { active: true });
        }
        
        // Clear berserk when its type is bloodsucking
        const berserkActive = actor.system?.conditions?.berserk?.active || false;
        const berserkType = actor.system?.conditions?.berserk?.type || '';
        if (berserkActive && berserkType === 'bloodsucking') {
          const berserkEffect = actor.effects.find(e => e.statuses.has("berserk"));
          if (berserkEffect) {
            // Set the message-control flag
            const mapKey = `${actor.id}:berserk`;
            if (!window.DX3rdConditionTriggerMap) {
              window.DX3rdConditionTriggerMap = new Map();
            }
            window.DX3rdConditionTriggerMap.set(mapKey, {
              triggerItemName: 'HP 0',
              suppressMessage: false
            });
            
            await actor.toggleStatusEffect("berserk", { active: false });
            
            // Tidy the map
            window.DX3rdConditionTriggerMap.delete(mapKey);
          }
        }
      }
      // HP crossed from zero or below back to a positive value.
      else if (transition === 'revived') {
        // Is the dead status present?
        const deadEffect = actor.effects.find(e => e.statuses.has("dead"));
        if (deadEffect) {
          await deadEffect.delete();
          
          // Remove the death mark directly (in case the deleteActiveEffect hook runs late)
          setTimeout(() => {
            if (canvas.scene) {
              const tokens = canvas.scene.tokens.filter(t => t.actorId === actor.id);
              for (const tokenDoc of tokens) {
                const tokenObj = tokenDoc.object;
                if (tokenObj && tokenObj.dx3rdDeathMark) {
                  removeDeathMarkFromToken(tokenObj);
                  tokenObj.refresh();
                  
                  // Remove the death mark on the other clients too
                  window.DX3rdSocketRouter.emit({
                    type: 'removeDeathMark',
                    data: {
                      tokenId: tokenDoc.id,
                      sceneId: canvas.scene.id
                    }
                  });
                }
              }
            }
          }, 200);
        }
      }
    }
  });
  
  // Expose the functions globally (used by the socket layer)
  window.addDeathMarkToToken = addDeathMarkToToken;
  window.removeDeathMarkFromToken = removeDeathMarkFromToken;
  window.handleConditionToggle = handleConditionToggle;
  
});


// Show the death mark on every dead token when the canvas is ready (for the initial load)
Hooks.on('canvasReady', async () => {
  if (!canvas.scene) return;
  
  let deadTokenCount = 0;
  
  for (const tokenDoc of canvas.scene.tokens) {
    const token = tokenDoc.object;
    if (!token || !token.actor) continue;
    
    const hasDeadEffect = token.actor.effects.find(e => e.statuses.has("dead"));
    if (hasDeadEffect && !token.dx3rdDeathMark) {
      await addDeathMarkToToken(token);
      deadTokenCount++;
    }
  }
});

// Restoring the status overlays is never done automatically at startup — only explicitly, from the sync menu.
// Only actors in the current scene whose system.conditions is active but has no matching ActiveEffect are targeted.
const DX3RD_CONDITION_TO_STATUS = {
  poisoned: "poisoned", hatred: "hatred", fear: "fear", berserk: "berserk",
  rigor: "rigor", pressure: "pressure", dazed: "dazed", boarding: "boarding",
  stealth: "stealth", fly: "fly", defeated: "dead"
};

window.DX3rdConditionOverlayRepair = {
  audit(scene = canvas?.scene) {
    const rows = [];
    if (!scene) return { actors: 0, effects: 0, rows };
    const seenActors = new Set();
    for (const tokenDoc of scene.tokens) {
      const actor = tokenDoc.actor;
      if (!actor || seenActors.has(actor.id)) continue;
      seenActors.add(actor.id);
      const missing = [];
      const conditions = actor.system?.conditions || {};
      for (const [cond, status] of Object.entries(DX3RD_CONDITION_TO_STATUS)) {
        if (conditions[cond]?.active && !actor.effects.some(e => e.statuses.has(status))) missing.push({ cond, status });
      }
      if (missing.length) rows.push({ actor, missing });
    }
    return { actors: rows.length, effects: rows.reduce((count, row) => count + row.missing.length, 0), rows };
  },
  async repair() {
    if (!game.user.isGM) return { actors: 0, effects: 0 };
    const audit = this.audit();
    let restored = 0;
    for (const { actor, missing } of audit.rows) {
      for (const { status } of missing) {
        window.DX3rdConditionTriggerMap = window.DX3rdConditionTriggerMap || new Map();
        window.DX3rdConditionTriggerMap.set(`${actor.id}:${status}`, { suppressMessage: true });
        try {
          await actor.toggleStatusEffect(status, { active: true });
          restored++;
        } catch (e) {
          console.warn(`DX3rd | Failed to restore condition overlay for ${status}:`, e);
          window.DX3rdConditionTriggerMap.delete(`${actor.id}:${status}`);
        }
      }
    }
    console.log(`DX3rd | Explicit condition overlay repair: ${restored} restored.`);
    return { actors: audit.actors, effects: restored };
  }
};
