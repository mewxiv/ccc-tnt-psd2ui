"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerPsdCompatibilityHandlers = void 0;
/*
 * Photoshop 2025+ can store the current layer effects in an `lfxs` block.
 * ag-psd 15.x ignores that block and falls back to stale `lfx2` data.
 */
const additionalInfo = require('ag-psd/dist/additionalInfo');
const descriptor = require('ag-psd/dist/descriptor');
const psdReader = require('ag-psd/dist/psdReader');
function registerPsdCompatibilityHandlers() {
    if (additionalInfo.infoHandlersMap.lfxs)
        return;
    additionalInfo.infoHandlersMap.lfxs = {
        read(reader, target, left, _psd, options) {
            const version = psdReader.readUint32(reader);
            if (version !== 0) {
                throw new Error(`Invalid lfxs version: ${version}`);
            }
            const value = descriptor.readVersionAndDescriptor(reader);
            target.effects = descriptor.parseEffects(value, !!options.logMissingFeatures);
            psdReader.skipBytes(reader, left());
        },
    };
}
exports.registerPsdCompatibilityHandlers = registerPsdCompatibilityHandlers;
registerPsdCompatibilityHandlers();
