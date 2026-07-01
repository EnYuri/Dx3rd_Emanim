/**
 * AppV2 시트 기본 승격 게이트.
 *
 * 모든 V2 시트는 각 시트 파일에서 `makeDefault: false`(시험 시트)로 등록된다.
 * 이 모듈은 월드 세팅 `appv2SheetsDefault` 하나로 V2 시트를 일괄 기본 시트로
 * 승격(또는 롤백)할 수 있게 한다. 하드코딩 매핑 없이 `CONFIG.*.sheetClasses`를
 * 순회해 `dx3rd-emanim` 스코프의 `*SheetV2` 클래스를 자동 탐지하므로,
 * 새 아이템 타입이 추가돼도 추가 작업 없이 승격 대상에 포함된다.
 *
 * v14 패리티 검증 완료(2026-06-30, v13은 환경 부재로 보류)에 따라 세팅 기본값은
 * true다. 즉 AppV2 시트가 기본이며, 회귀 시 이 세팅을 끄고 새로고침하면 AppV1로
 * 즉시 롤백된다. 각 문서의 개별 시트 선택(flags.core.sheetClass)은 그대로 존중된다.
 * Foundry의 시스템 스크립트/시트 등록 타이밍은 init 전후로 달라질 수 있으므로,
 * 실제 기본 승격은 game.ready 이후 최종 패스로 수행한다.
 */
(function() {
    const SCOPE = 'dx3rd-emanim';
    const SETTING = 'appv2SheetsDefault';
    let promotedThisLoad = false;

    function getCollection(docName) {
        const collections = foundry.documents?.collections;
        if (docName === 'Item') return collections?.Items || globalThis.Items;
        if (docName === 'Actor') return collections?.Actors || globalThis.Actors;
        return null;
    }

    function getPromotionTargets() {
        const targets = [
            ['Item', CONFIG.Item?.sheetClasses],
            ['Actor', CONFIG.Actor?.sheetClasses]
        ];
        const foundTargets = [];
        for (const [docName, cfg] of targets) {
            if (!cfg) continue;
            const Collection = getCollection(docName);
            if (!Collection) continue;
            for (const [type, sheets] of Object.entries(cfg)) {
                const v2 = Object.entries(sheets).find(([id, entry]) =>
                    id.startsWith(`${SCOPE}.`) && /SheetV2$/.test(entry.cls?.name));
                if (!v2) continue;
                const [, entry] = v2;
                foundTargets.push({ Collection, type, entry });
            }
        }
        return foundTargets;
    }

    /** dx3rd-emanim 스코프의 V2 시트를 모두 기본 시트로 재등록한다. */
    function promoteV2Defaults() {
        const targets = getPromotionTargets();
        let count = 0;
        for (const { Collection, type, entry } of targets) {
            Collection.registerSheet(SCOPE, entry.cls, {
                types: [type],
                makeDefault: true,
                label: entry.label
            });
            count++;
        }
        console.log(`DX3rd | AppV2 시트 ${count}종을 기본 시트로 승격했습니다.`);
        return count;
    }

    function isSettingRegistered() {
        return !!globalThis.game?.settings?.settings?.has(`${SCOPE}.${SETTING}`);
    }

    function registerSetting() {
        if (!globalThis.game?.settings || isSettingRegistered()) return;

        game.settings.register(SCOPE, SETTING, {
            name: 'DX3rd.AppV2SheetsDefault',
            hint: 'AppV2 시트를 기본 시트로 사용합니다. 변경 시 새로고침이 필요합니다.',
            scope: 'world',
            config: true,
            type: Boolean,
            default: true,
            requiresReload: true
        });
    }

    function applyPromotionGate() {
        registerSetting();
        if (!globalThis.game?.settings || promotedThisLoad) return;

        if (game.settings.get(SCOPE, SETTING)) {
            if (!game.ready) {
                schedulePromotionRetry();
                return;
            }

            const targets = getPromotionTargets();
            if (!targets.length) {
                schedulePromotionRetry();
                return;
            }

            promotedThisLoad = true;
            promoteV2Defaults();
        }
    }

    let retryScheduled = false;
    function schedulePromotionRetry() {
        if (retryScheduled) return;
        retryScheduled = true;
        let attempts = 0;
        const retry = () => {
            retryScheduled = false;
            if (promotedThisLoad) return;
            attempts++;
            applyPromotionGate();
            if (!promotedThisLoad && attempts < 50) {
                retryScheduled = true;
                setTimeout(retry, 100);
            }
        };
        setTimeout(retry, 100);
    }

    if (globalThis.game?.settings) {
        applyPromotionGate();
    } else {
        Hooks.once('init', applyPromotionGate);
        Hooks.once('ready', applyPromotionGate);

        let attempts = 0;
        const retryUntilSettingsReady = () => {
            if (globalThis.game?.settings) {
                applyPromotionGate();
                return;
            }
            attempts++;
            if (attempts < 50) setTimeout(retryUntilSettingsReady, 100);
        };
        setTimeout(retryUntilSettingsReady, 0);
    }

    // 수동 제어/테스트용 전역 노출
    window.DX3rdAppV2Promotion = {
        promoteV2Defaults,
        isEnabled: () => game.settings.get(SCOPE, SETTING)
    };
})();
