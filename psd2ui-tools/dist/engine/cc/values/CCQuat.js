"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CCQuat = void 0;
class CCQuat {
    constructor(x = 0, y = 0, z = 0, w = 1) {
        this.__type__ = "cc.Quat";
        this.x = x;
        this.y = y;
        this.z = z;
        this.w = w;
    }
}
exports.CCQuat = CCQuat;
