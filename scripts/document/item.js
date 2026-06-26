(function(){
  // v13/v14 호환: Item 글로벌이 없을 경우 폴백
  const _ItemBase = foundry.documents?.Item ?? globalThis.Item;

  class DX3rdEffect extends _ItemBase {
  prepareData() {
    super.prepareData();
    // 레벨 기본값 보정
    if (!this.system.level) this.system.level = {};
    if (this.system.level.init == null) this.system.level.init = 0;
    if (this.system.level.max == null) this.system.level.max = 1;
    if (this.system.level.value == null) this.system.level.value = 0;
    // attributes 구조 보정
    if (!this.system.effect) this.system.effect = {};
    if (!this.system.effect.attributes) this.system.effect.attributes = {};
  }

  async _getEffectContent() {
    let content = `
      <table>
        <tr>
          <td colspan="2"><b>${game.i18n.localize("DX3rd.Level")}:&nbsp;&nbsp;</b>
          ${this.system.level.value} / ${this.system.level.max}</td>
        </tr>
        <tr>
          <td colspan="2"><b>${game.i18n.localize("DX3rd.Timing")}:&nbsp;&nbsp;</b>
          ${Handlebars.compile('{{timing arg}}')({ arg: this.system.timing })}</td>
        </tr>
        <tr>
          <td colspan="2"><b>${game.i18n.localize("DX3rd.Skill")}:&nbsp;&nbsp;</b>
          ${Handlebars.compile('{{skillByKey actor key}}')({ actor: this.actor, key: this.system.skill })}</td>
        </tr>
        <tr>
          <td colspan="2"><b>${game.i18n.localize("DX3rd.Difficulty")}:&nbsp;&nbsp;</b>
          ${this.system.difficulty}</td>
        </tr>

        <tr>
          <td><b>${game.i18n.localize("DX3rd.Target")}:&nbsp;&nbsp;</b>${this.system.target}</td>
          <td><b>${game.i18n.localize("DX3rd.Range")}:&nbsp;&nbsp;</b>${this.system.range}</td>
        </tr>
        <tr>
          <td><b>${game.i18n.localize("DX3rd.Encroach")}:&nbsp;&nbsp;</b>${this.system.encroach.value}</td>
          <td><b>${game.i18n.localize("DX3rd.Limit")}:&nbsp;&nbsp;</b>${this.system.limit}</td>
        </tr>
      </table>
      <p>${this.system.description}</p>
      <button class="chat-btn use-effect">${game.i18n.localize("DX3rd.Use")}</button>
    `;

    return content;
  }

  async _getChatData(htmlOptions = {}) {
    const data = await super._getChatData(htmlOptions);
    
    if (this.type === 'effect') {
      data.content = await this._getEffectContent();
    }
    
    return data;
  }
}

// 전역 노출 (non-ESM 환경)
window.DX3rdEffect = DX3rdEffect;
})();
