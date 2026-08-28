"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PsdText = void 0;
const config_1 = require("../config");
const Color_1 = require("../values/Color");
const PsdLayer_1 = require("./PsdLayer");
class PsdText extends PsdLayer_1.PsdLayer {
    parseSource() {
        var _a, _b, _c, _d;
        super.parseSource();
        let textSource = this.source.text;
        let style = textSource.style;
        if (style) {
            let fillColor = style.fillColor;
            if (fillColor) {
                this.color = new Color_1.Color(fillColor.r, fillColor.g, fillColor.b, fillColor.a * 255);
            }
        }
        this.text = textSource.text;
        this.fontFamily = ((_a = style === null || style === void 0 ? void 0 : style.font) === null || _a === void 0 ? void 0 : _a.name) || '';
        // 可能会对文本图层进行缩放，这里计算缩放之后的时机字体大小
        const scaleX = Number((_b = textSource.transform) === null || _b === void 0 ? void 0 : _b[0]) || 1;
        const scaleY = Math.abs(Number((_c = textSource.transform) === null || _c === void 0 ? void 0 : _c[3]) || scaleX);
        if (Math.abs(1 - scaleX) > 0.001) {
            this.fontSize = Math.round(style.fontSize * scaleX * 100) / 100;
        }
        else {
            this.fontSize = style.fontSize;
        }
        const sourceLeading = Number(style === null || style === void 0 ? void 0 : style.leading);
        this.lineHeight = this.text.includes("\n") && Number.isFinite(sourceLeading) && sourceLeading > 0
            ? Math.round(sourceLeading * scaleY * 100) / 100
            : this.fontSize + config_1.config.textLineHeightOffset;
        this.horizontalAlign = this.parseHorizontalAlign((_d = textSource.paragraphStyle) === null || _d === void 0 ? void 0 : _d.justification);
        this.offsetY = config_1.config.textOffsetY[this.fontSize] || config_1.config.textOffsetY["default"] || 0;
        this.parseSolidFill();
        this.parseStroke();
        return true;
    }
    parseHorizontalAlign(justification) {
        switch (String(justification || '').toLowerCase()) {
            case 'right':
                return 2;
            case 'center':
                return 1;
            case 'left':
            default:
                return 0;
        }
    }
    onCtor() {
    }
    /** 描边 */
    parseStroke() {
        var _a, _b, _c;
        let layer = this;
        while (layer) {
            const effects = (_a = layer.source) === null || _a === void 0 ? void 0 : _a.effects;
            const stroke = (effects === null || effects === void 0 ? void 0 : effects.disabled) === true
                ? null
                : (_b = effects === null || effects === void 0 ? void 0 : effects.stroke) === null || _b === void 0 ? void 0 : _b.find((entry) => entry === null || entry === void 0 ? void 0 : entry.enabled);
            // Cocos LabelOutline is the closest equivalent to a Photoshop
            // outside color stroke, including one applied to a containing group.
            if ((stroke === null || stroke === void 0 ? void 0 : stroke.position) === "outside" && (stroke === null || stroke === void 0 ? void 0 : stroke.fillType) !== "gradient" && (stroke === null || stroke === void 0 ? void 0 : stroke.color)) {
                const opacity = Number.isFinite(stroke.opacity) ? stroke.opacity : 1;
                this.outline = {
                    width: ((_c = stroke.size) === null || _c === void 0 ? void 0 : _c.value) || 0,
                    color: new Color_1.Color(stroke.color.r, stroke.color.g, stroke.color.b, opacity * 255)
                };
                return;
            }
            layer = layer.parent;
        }
    }
    /** 解析 颜色叠加 */
    parseSolidFill() {
        var _a, _b, _c;
        if (((_a = this.source.effects) === null || _a === void 0 ? void 0 : _a.disabled) !== true && ((_b = this.source.effects) === null || _b === void 0 ? void 0 : _b.solidFill)) {
            let solidFills = (_c = this.source.effects) === null || _c === void 0 ? void 0 : _c.solidFill;
            for (let i = 0; i < solidFills.length; i++) {
                const solidFill = solidFills[i];
                if (solidFill.enabled) {
                    let color = solidFill.color;
                    this.color = new Color_1.Color(color.r, color.g, color.b, solidFill.opacity * 255);
                }
            }
        }
    }
}
exports.PsdText = PsdText;
