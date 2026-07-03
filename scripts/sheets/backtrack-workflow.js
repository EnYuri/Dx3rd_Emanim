/**
 * Double Cross 3rd 백트래킹(Backtrack) 워크플로우 공유 모듈.
 *
 * AppV1 액터 시트와 AppV2 파일럿 시트가 동일한 백트래킹 흐름을 공유하도록
 * `scripts/sheets/actor-sheet.js`에서 추출한 것이다. 내부 다이얼로그는 레거시
 * AppV1 다이얼로그 대신 `DialogV2`를 사용하지만 게임 규칙(침식률 감소량, 채팅 메시지,
 * 경험점 산정, 레코드 생성, 초기화)은 원본과 동일하게 유지한다.
 *
 * 공개 API: `window.DX3rdBacktrackWorkflow.start(actor)`
 */
(function() {
  const DialogV2 = foundry.applications?.api?.DialogV2;

  const BACKTRACK_DIALOG_STYLE = `
    <style>
    .backtrack-dialog .form-group {
        display: flex;
        flex-direction: column;
        margin-top: 0px;
        margin-bottom: 8px;
    }
    .backtrack-dialog label {
        font-weight: bold;
        font-size: 14px;
    }
    .backtrack-dialog p {
        margin: 5px 0;
        font-size: 13px;
    }
    .backtrack-dialog input {
        padding: 4px;
        font-size: 14px;
        border: 1px solid #ccc;
        border-radius: 4px;
    }
    </style>
  `;

  function sendChat(actor, content, rolls) {
    const data = {
      content,
      speaker: ChatMessage.getSpeaker({ actor })
    };
    if (rolls) data.rolls = rolls;
    return ChatMessage.create(data);
  }

  /**
   * 숫자 입력 다이얼로그. 확정 시 정수, 취소 시 null 반환.
   */
  async function promptNumber({ title, content, inputName, min = 0, max, label }) {
    if (!DialogV2) {
      ui.notifications.error(game.i18n.localize('DX3rd.DialogV2Unavailable'));
      return null;
    }
    const maxAttr = max !== undefined ? ` max="${max}"` : '';
    const body = `
      <div class="backtrack-dialog">
        <div class="form-group">
          ${content}
          <input type="number" name="${inputName}" min="${min}"${maxAttr} placeholder="0" style="width: 100%; text-align: center;">
        </div>
      </div>
      ${BACKTRACK_DIALOG_STYLE}
    `;
    return DialogV2.wait({
      window: { title },
      content: body,
      rejectClose: false,
      buttons: [{
        action: 'execute',
        label,
        default: true,
        callback: (event, button) => {
          const field = button.form?.elements?.[inputName];
          return Number.parseInt(field?.value, 10) || 0;
        }
      }]
    });
  }

  /**
   * 선택 버튼 다이얼로그. 클릭한 버튼의 action 문자열, 취소 시 null 반환.
   */
  async function promptChoice({ title, content, buttons }) {
    if (!DialogV2) {
      ui.notifications.error(game.i18n.localize('DX3rd.DialogV2Unavailable'));
      return null;
    }
    const body = `
      <div class="backtrack-dialog">
        <div class="form-group">${content}</div>
      </div>
      ${BACKTRACK_DIALOG_STYLE}
    `;
    return DialogV2.wait({
      window: { title },
      content: body,
      rejectClose: false,
      buttons: buttons.map(btn => ({
        action: btn.action,
        label: btn.label,
        callback: () => btn.action
      }))
    });
  }

  const Backtrack = {
    /**
     * 백트래킹 시작 진입점.
     */
    async start(actor) {
      if (!actor) return;
      if (!actor.isOwner && !game.user.isGM) {
        ui.notifications.warn('이 액터에 대한 권한이 없습니다.');
        return;
      }

      const currentEncroachment = Number(actor.system?.attributes?.encroachment?.value ?? 0);

      const memoryRoisItems = actor.items.filter(item =>
        item.type === 'rois' && item.system?.type === 'M'
      );
      const memoryCount = memoryRoisItems.length;

      await this._sendStartMessage(actor, currentEncroachment);

      if (memoryCount === 0) {
        await this._eroisUsage(actor, currentEncroachment, 0, 0, currentEncroachment);
      } else {
        await this._memoryUsage(actor, currentEncroachment, memoryCount);
      }
    },

    async _sendStartMessage(actor, currentEncroachment) {
      const messageContent = `<div class="dx3rd-item-chat">${game.i18n.localize("DX3rd.BackTrackStart")}<br>${game.i18n.localize("DX3rd.Current")} ${game.i18n.localize("DX3rd.Encroachment")}: ${currentEncroachment}%</div>`;
      await sendChat(actor, messageContent);
    },

    async _memoryUsage(actor, currentEncroachment, memoryCount) {
      const content = `
        <label>${game.i18n.localize("DX3rd.Current")} ${game.i18n.localize("DX3rd.Encroachment")}: ${currentEncroachment}%</label>
        <p>${game.i18n.localize("DX3rd.Memory")} ${game.i18n.localize("DX3rd.Quantity")}: ${memoryCount}</p>
      `;
      const memoryUsed = await promptNumber({
        title: game.i18n.localize("DX3rd.Memory") + " " + game.i18n.localize("DX3rd.Use"),
        content,
        inputName: 'memoryCount',
        min: 0,
        max: memoryCount,
        label: game.i18n.localize("DX3rd.Memory") + " " + game.i18n.localize("DX3rd.Use")
      });
      if (memoryUsed === null) return;

      if (memoryUsed < 0 || memoryUsed > memoryCount) {
        ui.notifications.warn("올바른 메모리 로이스 개수를 입력하세요.");
        return;
      }

      await this._processMemoryUsage(actor, currentEncroachment, memoryUsed, memoryCount);
    },

    async _processMemoryUsage(actor, originalEncroachment, memoryUsed, memoryCount) {
      const reduction = memoryUsed * 10;
      const afterMemoryEncroachment = Math.max(0, originalEncroachment - reduction);
      const memoryReduction = originalEncroachment - afterMemoryEncroachment;

      await actor.update({
        "system.attributes.encroachment.value": afterMemoryEncroachment
      });

      if (memoryUsed > 0) {
        const messageContent = `<div class="dx3rd-item-chat">${game.i18n.format("DX3rd.UseMemoryCount", { count: memoryUsed })}<br>${originalEncroachment}% → ${afterMemoryEncroachment}% (${originalEncroachment - afterMemoryEncroachment > 0 ? '-' : '+'}${originalEncroachment - afterMemoryEncroachment}%)</div>`;
        await sendChat(actor, messageContent);
      }

      await this._eroisUsage(actor, originalEncroachment, memoryUsed, memoryReduction, afterMemoryEncroachment);
    },

    async _eroisUsage(actor, originalEncroachment, memoryUsed, memoryReduction, afterMemoryEncroachment) {
      const content = `
        <label>${game.i18n.localize("DX3rd.Current")} ${game.i18n.localize("DX3rd.Encroachment")}: ${afterMemoryEncroachment}%</label>
        <p>${game.i18n.localize("DX3rd.Exhaust")} ${game.i18n.localize("DX3rd.Quantity")} 입력:</p>
      `;
      const eroisUsed = await promptNumber({
        title: game.i18n.localize("DX3rd.Exhaust") + " " + game.i18n.localize("DX3rd.Use"),
        content,
        inputName: 'eroisCount',
        min: 0,
        label: game.i18n.localize("DX3rd.Exhaust") + " " + game.i18n.localize("DX3rd.Use")
      });
      if (eroisUsed === null) return;

      if (eroisUsed < 0) {
        ui.notifications.warn("올바른 E 로이스 개수를 입력하세요.");
        return;
      }

      await this._processEroisUsage(actor, originalEncroachment, memoryUsed, memoryReduction, afterMemoryEncroachment, eroisUsed);
    },

    async _processEroisUsage(actor, originalEncroachment, memoryUsed, memoryReduction, afterMemoryEncroachment, eroisUsed) {
      const roll = new Roll(`${eroisUsed}d10`);
      await roll.roll();
      const totalReduction = roll.total;

      const afterExhaustEncroachment = Math.max(0, afterMemoryEncroachment - totalReduction);
      const eroisReduction = afterMemoryEncroachment - afterExhaustEncroachment;

      await actor.update({
        "system.attributes.encroachment.value": afterExhaustEncroachment
      });

      if (eroisUsed > 0) {
        const reductionAmount = afterMemoryEncroachment - afterExhaustEncroachment;
        const finalMessage = `<div class="dx3rd-item-chat">${game.i18n.format("DX3rd.UseEroisCount", { count: eroisUsed })}<br>${afterMemoryEncroachment}% → ${afterExhaustEncroachment}% (${reductionAmount > 0 ? '-' : '+'}${Math.abs(reductionAmount)}%)</div>`;
        await sendChat(actor, finalMessage, [roll]);
      }

      await this._roisUsage(actor, originalEncroachment, memoryUsed, memoryReduction, afterMemoryEncroachment, eroisUsed, eroisReduction, afterExhaustEncroachment);
    },

    async _roisUsage(actor, originalEncroachment, memoryUsed, memoryReduction, afterMemoryEncroachment, eroisUsed, eroisReduction, afterExhaustEncroachment) {
      const availableRoisItems = actor.items.filter(item =>
        item.type === 'rois' &&
        item.system?.type !== 'M' &&
        item.system?.type !== 'D' &&
        !item.system?.titus
      );
      const roisCount = availableRoisItems.length;

      const content = `
        <label>${game.i18n.localize("DX3rd.Current")} ${game.i18n.localize("DX3rd.Encroachment")}: ${afterExhaustEncroachment}%</label>
        <p>${game.i18n.format("DX3rd.UsebleRoisCount", { count: roisCount })}</p>
      `;
      const choice = await promptChoice({
        title: game.i18n.localize("DX3rd.Rois") + " " + game.i18n.localize("DX3rd.Use"),
        content,
        buttons: [
          { action: 'x1', label: '×1' },
          { action: 'x2', label: '×2' }
        ]
      });
      if (choice === null) return;

      const multiplier = choice === 'x2' ? 2 : 1;
      await this._processRoisUsage(actor, originalEncroachment, memoryUsed, memoryReduction, afterMemoryEncroachment, eroisUsed, eroisReduction, afterExhaustEncroachment, roisCount, multiplier);
    },

    async _processRoisUsage(actor, originalEncroachment, memoryUsed, memoryReduction, afterMemoryEncroachment, eroisUsed, eroisReduction, afterExhaustEncroachment, roisCount, multiplier) {
      const diceCount = roisCount * multiplier;
      const roll = new Roll(`${diceCount}d10`);
      await roll.roll();
      const totalReduction = roll.total;

      const finalEncroachment = Math.max(0, afterExhaustEncroachment - totalReduction);

      await actor.update({
        "system.attributes.encroachment.value": finalEncroachment
      });

      const reductionAmount = afterExhaustEncroachment - finalEncroachment;
      const messageContent = `<div class="dx3rd-item-chat">${game.i18n.format("DX3rd.UseRoisVoluntary", { count: roisCount, multiplier })}<br>${afterExhaustEncroachment}% → ${finalEncroachment}% (${reductionAmount > 0 ? '-' : '+'}${Math.abs(reductionAmount)}%)</div>`;
      await sendChat(actor, messageContent, [roll]);

      if (finalEncroachment <= 100) {
        await this._finishBacktrack(actor, finalEncroachment, multiplier, false);
      } else {
        await this._expExtra(actor, finalEncroachment, multiplier);
      }
    },

    async _expExtra(actor, afterRoisEncroachment, usedMultiplier) {
      const availableRoisItems = actor.items.filter(item =>
        item.type === 'rois' &&
        item.system?.type !== 'M' &&
        item.system?.type !== 'D' &&
        !item.system?.titus
      );
      const roisCount = availableRoisItems.length;

      const content = `
        <label>${game.i18n.localize("DX3rd.Current")} ${game.i18n.localize("DX3rd.Encroachment")}: ${afterRoisEncroachment}%</label>
        <p>${game.i18n.format("DX3rd.UsebleRoisCount", { count: roisCount })}</p>
        <p>${game.i18n.localize("DX3rd.EXPExtra")}</p>
      `;
      const choice = await promptChoice({
        title: game.i18n.localize("DX3rd.EXPExtra"),
        content,
        buttons: [
          { action: 'use', label: game.i18n.localize("DX3rd.Use") },
          { action: 'skip', label: game.i18n.localize("DX3rd.Skip") }
        ]
      });
      if (choice === null || choice === 'skip') {
        await this._finishBacktrack(actor, afterRoisEncroachment, usedMultiplier, false);
        return;
      }

      await this._processEXPExtra(actor, afterRoisEncroachment, roisCount, usedMultiplier);
    },

    async _processEXPExtra(actor, afterRoisEncroachment, roisCount, usedMultiplier) {
      const roll = new Roll(`${roisCount}d10`);
      await roll.roll();
      const totalReduction = roll.total;

      const finalEncroachment = Math.max(0, afterRoisEncroachment - totalReduction);

      await actor.update({
        "system.attributes.encroachment.value": finalEncroachment
      });

      const reductionAmount = afterRoisEncroachment - finalEncroachment;
      const messageContent = `<div class="dx3rd-item-chat">${game.i18n.localize("DX3rd.EXPExtra")}<br>${afterRoisEncroachment}% → ${finalEncroachment}% (${reductionAmount > 0 ? '-' : '+'}${Math.abs(reductionAmount)}%)</div>`;
      await sendChat(actor, messageContent, [roll]);

      await this._finishBacktrack(actor, finalEncroachment, usedMultiplier, true);
    },

    async _finishBacktrack(actor, finalEncroachment, usedMultiplier = null, usedExtra = false) {
      const isSuccess = finalEncroachment <= 100;

      let messageContent;
      let expGain = 0;

      if (isSuccess) {
        let successMsg = `<span class="dx3rd-backtrack-success">${game.i18n.localize("DX3rd.BackTrack")} ${game.i18n.localize("DX3rd.Success")}</span>`;

        if (usedExtra) {
          expGain = 0;
        } else if (usedMultiplier === 2) {
          expGain = 3;
        } else {
          if (finalEncroachment === 100) {
            expGain = 3;
          } else if (finalEncroachment >= 71 && finalEncroachment <= 99) {
            expGain = 5;
          } else if (finalEncroachment >= 51 && finalEncroachment <= 70) {
            expGain = 4;
          } else if (finalEncroachment >= 31 && finalEncroachment <= 50) {
            expGain = 3;
          } else if (finalEncroachment >= 0 && finalEncroachment <= 30) {
            expGain = 2;
          }
        }

        successMsg += `<br>백트랙 경험점: ${expGain}점`;
        messageContent = `<div class="dx3rd-item-chat">${successMsg}</div>`;

        ui.notifications.info("백트랙 성공! 침식률이 100% 이하로 감소했습니다.");
      } else {
        messageContent = `<div class="dx3rd-item-chat"><span class="dx3rd-backtrack-failure">${game.i18n.localize("DX3rd.BackTrack")} ${game.i18n.localize("DX3rd.Failure")}</span></div>`;

        ui.notifications.warn("백트랙 실패. 침식률이 여전히 100%를 초과합니다.");
      }

      await sendChat(actor, messageContent);

      await this._createBacktrackRecord(actor, finalEncroachment, usedMultiplier, usedExtra, isSuccess, expGain);
    },

    async _createBacktrackRecord(actor, finalEncroachment, usedMultiplier, usedExtra, isSuccess, expGain) {
      const now = new Date();
      const year = now.getFullYear();
      const month = String(now.getMonth() + 1).padStart(2, '0');
      const day = String(now.getDate()).padStart(2, '0');
      const recordName = `Record(${year}.${month}.${day})`;

      let recordContent = `최종 침식률: ${finalEncroachment}%`;

      if (usedExtra) {
        recordContent += ` (${game.i18n.localize("DX3rd.EXPExtra")})`;
      } else if (usedMultiplier === 2) {
        recordContent += ` (×2)`;
      } else {
        recordContent += ` (×1)`;
      }

      recordContent += `/${game.i18n.localize(isSuccess ? "DX3rd.Success" : "DX3rd.Failure")}`;

      if (isSuccess) {
        recordContent += `<hr>백트랙 경험점: ${expGain}점`;
      }

      const recordData = {
        name: recordName,
        type: "record",
        system: {
          description: recordContent
        }
      };

      await actor.createEmbeddedDocuments("Item", [recordData]);

      await this._initializeBacktrack(actor);
    },

    async _initializeBacktrack(actor) {
      if (window.DX3rdDisableHooks) {
        const timings = ['roll', 'major', 'reaction', 'guard', 'main', 'round', 'scene', 'session'];
        for (const timing of timings) {
          await window.DX3rdDisableHooks.executeDisableHook(timing, actor);
        }
      }

      const updates = {};
      if (actor.system?.attributes?.stock?.max !== undefined) {
        updates['system.attributes.stock.value'] = actor.system.attributes.stock.max;
      }
      if (actor.system?.attributes?.hp?.max !== undefined) {
        updates['system.attributes.hp.value'] = actor.system.attributes.hp.max;
      }

      const currentEncroachment = actor.system?.attributes?.encroachment?.value ?? 0;
      const initEncroachment = actor.system?.attributes?.encroachment?.init?.value;
      if (currentEncroachment <= 100 && initEncroachment !== undefined) {
        updates['system.attributes.encroachment.value'] = initEncroachment;
      }

      if (Object.keys(updates).length > 0) {
        await actor.update(updates);
      }

      const madnessTypePrefix = game.i18n.localize('DX3rd.MadnessType');
      const madness14Name = madnessTypePrefix + ': ' + game.i18n.localize('DX3rd.Madness14');
      const madness14Item = actor.items.find(item =>
        item.type === 'effect' &&
        item.name === madness14Name
      );
      if (madness14Item) {
        const hpRoll = new Roll("1d10");
        await hpRoll.evaluate();
        const newPenalty = hpRoll.total;
        await madness14Item.update({ 'system.attributes.hp': { key: 'hp', value: -newPenalty } });
        const refreshed = game.actors.get(actor.id);
        if (refreshed) {
          refreshed.prepareData();
          const hpMax = refreshed.system?.attributes?.hp?.max ?? 0;
          await refreshed.update({ 'system.attributes.hp.value': hpMax });
        }
      }

      const madness1Name = madnessTypePrefix + ': ' + game.i18n.localize('DX3rd.Madness1');
      const hasMadness1 = actor.items.some(item =>
        item.type === 'effect' &&
        item.name === madness1Name
      );
      if (hasMadness1) {
        const encroachRoll = new Roll("2d10");
        await encroachRoll.evaluate();
        const encroachIncrease = encroachRoll.total;
        const currentEnc = actor.system?.attributes?.encroachment?.value ?? 0;
        const newEncroachment = Math.min(100, currentEnc + encroachIncrease);
        await actor.update({ 'system.attributes.encroachment.value': newEncroachment });

        const rollHtml = await encroachRoll.render();
        const messageContent = `
          <div class="dx3rd-item-chat">
              <div>${game.i18n.localize('DX3rd.Madness1')}: ${game.i18n.localize('DX3rd.Encroachment')} +${encroachIncrease} (${currentEnc}% → ${newEncroachment}%)</div>
              <div class="dice-roll">${rollHtml}</div>
          </div>
        `;
        await sendChat(actor, messageContent, [encroachRoll]);
      }
    }
  };

  window.DX3rdBacktrackWorkflow = Backtrack;
})();
