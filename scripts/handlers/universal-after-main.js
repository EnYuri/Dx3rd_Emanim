// Universal handler AfterMain queue lifecycle.
(function() {
  const handler = window.DX3rdUniversalHandler;
  if (!handler) {
    console.error('DX3rd | Universal handler is unavailable for AfterMain queue hooks.');
    return;
  }

  handler.addToAfterMainQueue = function(actor, extensionData, item, type = 'heal') {
    if (game.user.isGM) {
      const queue = this._afterMainQueue;
      queue.push({
        type,
        actor,
        actorId: actor?.id || null,
        data: extensionData,
        item,
        itemId: item?.id || null
      });
      this._afterMainQueue = queue;
      console.log(`DX3rd | GM added to AfterMain queue: ${type} for ${actor?.name || 'unknown'}, Queue length: ${this._afterMainQueue.length}`);
      return;
    }

    console.log(`DX3rd | Player requesting GM to add to AfterMain queue: ${type} for ${actor?.name || 'unknown'}`);
    game.socket.emit('system.dx3rd-emanim', {
      type: 'addToAfterMainQueue',
      data: {
        actorId: actor?.id || null,
        extensionData,
        extensionType: type,
        itemId: item?.id || null
      }
    });
  };

  handler.registerAfterMainExtensions = function(actor, item, itemExtend) {
    if (!itemExtend) return;
    const selectedTargetIds = Array.from(game.user.targets).map(target => target.id);
    const queue = (type, data) => {
      const extensionData = {
        ...data,
        selectedTargetIds,
        triggerItemName: item?.name || null,
        triggerItemId: item?.id || null
      };
      if (game.user.isGM) {
        this.addToAfterMainQueue(actor, extensionData, item, type);
      } else {
        game.socket.emit('system.dx3rd-emanim', {
          type: 'addToAfterMainQueue',
          data: { extensionType: type, actorId: actor.id, extensionData, itemId: item?.id || null }
        });
      }
    };

    if (itemExtend.heal?.activate && itemExtend.heal?.timing === 'afterMain') {
      queue('heal', itemExtend.heal);
      console.log(`DX3rd | Registered afterMain heal extension for ${actor.name}`);
    }
    if (itemExtend.damage?.activate && itemExtend.damage?.timing === 'afterMain') {
      queue('damage', itemExtend.damage);
      console.log(`DX3rd | Registered afterMain damage extension for ${actor.name}`);
    }

    const afterMainConditions = this._getConditionEntries(itemExtend.condition || {})
      .filter(condition => condition.timing === 'afterMain');
    for (const condition of afterMainConditions) queue('condition', condition);
    if (afterMainConditions.length > 0) {
      console.log(`DX3rd | Registered afterMain condition extension for ${actor.name} (${afterMainConditions.length} entries)`);
    }
  };

  handler.processAfterMainQueue = async function() {
    const queue = this._afterMainQueue;
    if (queue.length === 0) {
      console.log('DX3rd | AfterMain queue is empty');
      return;
    }
    console.log(`DX3rd | Processing AfterMain queue: ${queue.length} items`);

    for (const queueItem of queue) {
      const { type, actor, actorId, data, item, itemId } = queueItem;
      let validActor = actor;
      if (!validActor || !validActor.id || validActor.id !== actorId) {
        if (!actorId) {
          console.warn('DX3rd | No actorId in queue item, skipping');
          continue;
        }
        validActor = game.actors.get(actorId);
        if (!validActor) {
          console.warn(`DX3rd | Actor not found for queue item: ${actorId}`);
          continue;
        }
      }
      let validItem = item;
      if (itemId && (!validItem || !validItem.id || validItem.id !== itemId)) {
        validItem = validActor.items.get(itemId) || null;
      }

      if (type === 'heal') {
        console.log(`DX3rd | Processing heal from queue: ${validActor.name}`);
        await this.executeHealExtensionNow(validActor, data, validItem);
      } else if (type === 'damage') {
        console.log(`DX3rd | Processing damage from queue: ${validActor.name}`);
        await this.executeDamageExtensionNow(validActor, data, validItem);
      } else if (type === 'condition') {
        console.log(`DX3rd | Processing condition from queue: ${validActor.name}`);
        if (data.conditionTypes && Array.isArray(data.conditionTypes)) {
          await this.executeConditionExtensionsNowBulk(validActor, data);
        } else {
          await this.executeConditionExtensionNow(validActor, data, validItem);
        }
      } else {
        console.warn(`DX3rd | Unknown queue item type: ${type}`);
      }
    }

    await game.settings.set('dx3rd-emanim', 'afterMainQueue', []);
    console.log('DX3rd | AfterMain queue cleared');
  };

  handler.clearAfterMainQueue = async function() {
    await game.settings.set('dx3rd-emanim', 'afterMainQueue', []);
    console.log('DX3rd | AfterMain queue manually cleared');
  };
})();
