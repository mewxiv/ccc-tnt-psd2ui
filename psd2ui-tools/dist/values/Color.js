"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Color = void 0;
class Color {
    constructor(r, g, b, a) {
        this.r = this.toByte(r);
        this.g = this.toByte(g);
        this.b = this.toByte(b);
        this.a = this.toByte(a);
    }
    set(color) {
        this.r = this.toByte(color.r);
        this.g = this.toByte(color.g);
        this.b = this.toByte(color.b);
        this.a = this.toByte(color.a);
    }
    toByte(value) {
        const numeric = Number(value);
        return Math.max(0, Math.min(255, Math.round(Number.isFinite(numeric) ? numeric : 0)));
    }
    toHEX(fmt = '#rrggbb') {
        const prefix = '0';
        // #rrggbb
        const hex = [
            (this.r < 16 ? prefix : '') + (this.r).toString(16),
            (this.g < 16 ? prefix : '') + (this.g).toString(16),
            (this.b < 16 ? prefix : '') + (this.b).toString(16),
        ];
        const i = -1;
        if (fmt === '#rgb') {
            hex[0] = hex[0][0];
            hex[1] = hex[1][0];
            hex[2] = hex[2][0];
        }
        else if (fmt === '#rrggbbaa') {
            hex.push((this.a < 16 ? prefix : '') + (this.a).toString(16));
        }
        return hex.join('');
    }
}
exports.Color = Color;
