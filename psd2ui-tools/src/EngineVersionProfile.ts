import { EditorVersion } from './EditorVersion';

export const SUPPORTED_ENGINE_VERSION_NAMES = ['v249', 'v342', 'v381'] as const;

export function normalizeEngineVersionName(value: unknown): typeof SUPPORTED_ENGINE_VERSION_NAMES[number] | null {
    if (value === undefined || value === null || String(value).trim() === '') return null;
    const normalized = String(value).trim().toLowerCase();
    if ((SUPPORTED_ENGINE_VERSION_NAMES as readonly string[]).includes(normalized)) {
        return normalized as typeof SUPPORTED_ENGINE_VERSION_NAMES[number];
    }
    if (/^2\.4(?:\.(?:9|11|x))?$/.test(normalized)) return 'v249';
    if (/^3\.4(?:\.2|\.x)?$/.test(normalized)) return 'v342';
    if (/^3\.8(?:\.\d+|\.x)?$/.test(normalized)) return 'v381';
    return null;
}

export function resolveEditorVersion(value: unknown): EditorVersion | null {
    const name = normalizeEngineVersionName(value);
    return name ? EditorVersion[name] : null;
}
