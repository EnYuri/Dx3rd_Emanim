/**
 * 문서 가져오기 호환 계층
 *
 * Foundry의 Document.fromImport는 JSON의 _stats.coreVersion이 실행 중인 코어보다
 * 높으면 "Documents from a core version newer than the running version cannot be
 * imported" 예외를 던진다. 같은 시스템끼리 v13 <-> v14(또는 빌드 번호가 다른 v14끼리)
 * 액터/아이템을 주고받을 때 이 검사만으로 가져오기가 통째로 막힌다.
 *
 * 여기서는 importFromJSON에 들어오는 원본 JSON의 _stats.coreVersion을 현재 코어
 * 버전으로 낮춰(clamp) 검사를 통과시킨다. 스키마 자체는 시스템이 동일하므로
 * DataModel 정제 단계에서 정상 처리된다.
 */
(function() {
    /**
     * source 트리를 훑어 현재 코어보다 높은 _stats.coreVersion을 현재 값으로 낮춘다.
     * @param {object} source 파싱된 문서 소스
     * @returns {boolean} 하나라도 낮췄으면 true
     */
    function clampCoreVersion(source) {
        const current = game.release?.version ?? game.version;
        if (!current) return false;
        const isNewer = foundry.utils.isNewerVersion;
        let changed = false;

        const walk = (node) => {
            if (!node || typeof node !== "object") return;
            if (Array.isArray(node)) {
                for (const entry of node) walk(entry);
                return;
            }
            const stats = node._stats;
            if (stats && typeof stats === "object" && typeof stats.coreVersion === "string") {
                if (isNewer(stats.coreVersion, current)) {
                    console.log(`DX3rd | 가져오기 코어 버전 보정: ${stats.coreVersion} -> ${current}`);
                    stats.coreVersion = current;
                    changed = true;
                }
            }
            // 내장 문서(items, effects, tokens 등)도 함께 훑는다.
            for (const value of Object.values(node)) {
                if (value && typeof value === "object") walk(value);
            }
        };

        walk(source);
        return changed;
    }

    /**
     * importFromJSON 호출 전에 JSON 문자열을 보정한다.
     * @param {string} json
     * @returns {string} 보정된 JSON (실패 시 원본)
     */
    function sanitizeImportJSON(json) {
        try {
            const source = JSON.parse(json);
            if (!clampCoreVersion(source)) return json;
            return JSON.stringify(source);
        } catch (e) {
            console.error("DX3rd | 가져오기 JSON 보정 실패:", e);
            return json;
        }
    }

    window.DX3rdImportCompat = { clampCoreVersion, sanitizeImportJSON };
})();
