/**
 * Document-import compatibility layer.
 *
 * Document.fromImport rejects JSON whose _stats.coreVersion is newer than the running Foundry
 * version. That alone can prevent actor or item exchange between v13 and v14 installations of
 * this system, or even between different v14 builds.
 *
 * Clamp incoming _stats.coreVersion values to the current core version before import. Because
 * both ends use this system's schema, normal DataModel cleaning still handles the document data.
 */
(function() {
    /**
     * Clamp newer _stats.coreVersion values throughout a source tree.
     * @param {object} source parsed document source
     * @returns {boolean} whether any version was clamped
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
            // Recurse into embedded documents such as items, effects, and tokens.
            for (const value of Object.values(node)) {
                if (value && typeof value === "object") walk(value);
            }
        };

        walk(source);
        return changed;
    }

    /**
     * Sanitize a JSON string before importFromJSON receives it.
     * @param {string} json
     * @returns {string} sanitized JSON, or the original string on failure
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
