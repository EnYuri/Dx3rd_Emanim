// DX3rd legacy action-choice dialog
//
// `scripts/combat/combat.js`에서 제거한 구형 DOM 다이얼로그 구현 보관본.
// 현재 런타임은 scripts/combat/turn-process-ui.js를 사용하며 이 파일은 로드하지 않는다.

/*
// 행동 종료/대기 선택 다이얼로그 (플레이어도 표시) - DOM 방식
const choice = forcedChoice || await new Promise((resolve) => {
  const onSelect = (selection) => {
    dialog.remove();
    resolve(selection);
  };
  
  const dialog = document.createElement("div");
  dialog.id = "dx3rd-action-dialog";
  dialog.style.position = "fixed";
  dialog.style.top = "50%";
  dialog.style.left = "50%";
  dialog.style.transform = "translate(-50%, -50%)";
  dialog.style.background = "rgba(0, 0, 0, 0.85)";
  dialog.style.color = "white";
  dialog.style.padding = "10px 20px 12px 20px";
  dialog.style.border = "none";
  dialog.style.borderRadius = "8px";
  dialog.style.zIndex = "9999";
  dialog.style.textAlign = "center";
  dialog.style.fontSize = "16px";
  dialog.style.boxShadow = "0 0 10px black";
  dialog.style.minWidth = "260px";
  
  // 행동 대기 상태면 행동 종료 버튼만 표시
  if (isDelayed) {
    dialog.innerHTML = `
      <div style="margin-bottom:12px;font-size:0.9em;">${currentCombatant.name}</div>
      <div style="width:100%; display: flex; flex-direction: column; gap: 8px; margin-top:4px;">
        <button id="dx3rd-end-action-button" style="width:100%; height: 28px; background: white; color: black; border-radius: 4px; border: none; opacity: 0.5; font-weight: bold; font-size: 0.75em; margin: 0; display: flex; align-items: center; justify-content: center; padding: 0; cursor: pointer;">${game.i18n.localize("DX3rd.ActionEnd")}</button>
        <hr style="margin: 4px 0; border: none; border-top: 1px solid rgba(255,255,255,0.3);">
        <button id="dx3rd-cancel-button" style="width:100%; height: 28px; background: white; color: rgba(255, 68, 68, 1); border-radius: 4px; border: none; opacity: 0.5; font-weight: bold; font-size: 0.75em; margin: 0; display: flex; align-items: center; justify-content: center; padding: 0; cursor: pointer;">${game.i18n.localize("DX3rd.Cancel")}</button>
      </div>`;
  } else {
    // 일반 상태면 행동 종료/대기 버튼 모두 표시
    dialog.innerHTML = `
      <div style="margin-bottom:12px;font-size:0.9em;">${currentCombatant.name}</div>
      <div style="width:100%; display: flex; flex-direction: column; gap: 8px; margin-top:4px;">
        <button id="dx3rd-end-action-button" style="width:100%; height: 28px; background: white; color: black; border-radius: 4px; border: none; opacity: 0.5; font-weight: bold; font-size: 0.75em; margin: 0; display: flex; align-items: center; justify-content: center; padding: 0; cursor: pointer;">${game.i18n.localize("DX3rd.ActionEnd")}</button>
        <button id="dx3rd-delay-action-button" style="width:100%; height: 28px; background: white; color: black; border-radius: 4px; border: none; opacity: 0.5; font-weight: bold; font-size: 0.75em; margin: 0; display: flex; align-items: center; justify-content: center; padding: 0; cursor: pointer;">${game.i18n.localize("DX3rd.ActionDelay")}</button>
        <hr style="margin: 4px 0; border: none; border-top: 1px solid rgba(255,255,255,0.3);">
        <button id="dx3rd-cancel-button" style="width:100%; height: 28px; background: white; color: rgba(255, 68, 68, 1); border-radius: 4px; border: none; opacity: 0.5; font-weight: bold; font-size: 0.75em; margin: 0; display: flex; align-items: center; justify-content: center; padding: 0; cursor: pointer;">${game.i18n.localize("DX3rd.Cancel")}</button>
      </div>`;
  }
  
  // 중복 다이얼로그 방지: 이전 턴의 행동 선택 창이 남아있으면 제거
  // (남아있으면 document.getElementById가 옛 창의 버튼을 잡아 새 창이 먹통이 됨)
  document.getElementById("dx3rd-action-dialog")?.remove();
  document.body.appendChild(dialog);

  // 리스너는 방금 만든 dialog 내부에서 직접 찾는다 (중복 id에 영향받지 않도록)
  dialog.querySelector("#dx3rd-end-action-button").addEventListener("click", () => onSelect("end"));
  if (!isDelayed) {
    dialog.querySelector("#dx3rd-delay-action-button").addEventListener("click", () => onSelect("delay"));
  }
  dialog.querySelector("#dx3rd-cancel-button").addEventListener("click", () => onSelect(null));
});
*/
