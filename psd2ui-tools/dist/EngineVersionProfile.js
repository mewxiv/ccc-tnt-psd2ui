"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolveEditorVersion = exports.normalizeEngineVersionName = exports.SUPPORTED_ENGINE_VERSION_NAMES = void 0;
const EditorVersion_1 = require("./EditorVersion");
exports.SUPPORTED_ENGINE_VERSION_NAMES = ['v249', 'v342', 'v381'];
function normalizeEngineVersionName(value) {
    if (value === undefined || value === null || String(value).trim() === '')
        return null;
    const normalized = String(value).trim().toLowerCase();
    if (exports.SUPPORTED_ENGINE_VERSION_NAMES.includes(normalized)) {
        return normalized;
    }
    if (/^2\.4(?:\.(?:9|11|x))?$/.test(normalized))
        return 'v249';
    if (/^3\.4(?:\.2|\.x)?$/.test(normalized))
        return 'v342';
    if (/^3\.8(?:\.\d+|\.x)?$/.test(normalized))
        return 'v381';
    return null;
}
exports.normalizeEngineVersionName = normalizeEngineVersionName;
function resolveEditorVersion(value) {
    const name = normalizeEngineVersionName(value);
    return name ? EditorVersion_1.EditorVersion[name] : null;
}
exports.resolveEditorVersion = resolveEditorVersion;
