
import { config } from "../config";
import { Color } from "../values/Color";
import { Vec2 } from "../values/Vec2";
import { PsdGroup } from "./PsdGroup";
import { PsdLayer } from "./PsdLayer";

export class PsdText extends PsdLayer {
    declare parent: PsdGroup;
    declare text: string;
    declare fontSize: number;
    declare lineHeight: number;
    declare font: string;
    declare fontFamily: string;
    declare horizontalAlign: number;
    declare outline: { width: number, color: Color }; // 描边
    declare offsetY: number;


    parseSource(): boolean {
        super.parseSource();
        let textSource = this.source.text;
        let style = textSource.style;
        if (style) {
            let fillColor = style.fillColor;
            if (fillColor) {
                this.color = new Color(fillColor.r, fillColor.g, fillColor.b, fillColor.a * 255);
            }
        }
        this.text = textSource.text;
        this.fontFamily = style?.font?.name || '';

        // 可能会对文本图层进行缩放，这里计算缩放之后的时机字体大小
        const scaleX = Number(textSource.transform?.[0]) || 1;
        const scaleY = Math.abs(Number(textSource.transform?.[3]) || scaleX);
        if (Math.abs(1 - scaleX) > 0.001) {
            this.fontSize = Math.round(style.fontSize * scaleX * 100) / 100;
        } else {
            this.fontSize = style.fontSize;
        }

        const sourceLeading = Number(style?.leading);
        this.lineHeight = this.text.includes("\n") && Number.isFinite(sourceLeading) && sourceLeading > 0
            ? Math.round(sourceLeading * scaleY * 100) / 100
            : this.fontSize + config.textLineHeightOffset;
        this.horizontalAlign = this.parseHorizontalAlign(textSource.paragraphStyle?.justification);


        this.offsetY = config.textOffsetY[this.fontSize] || config.textOffsetY["default"] || 0;

        this.parseSolidFill();
        this.parseStroke();
        return true;
    }

    private parseHorizontalAlign(justification: string) {
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
        let layer: PsdLayer = this;
        while (layer) {
            const effects = layer.source?.effects;
            const stroke = effects?.disabled === true
                ? null
                : effects?.stroke?.find((entry: any) => entry?.enabled);
            // Cocos LabelOutline is the closest equivalent to a Photoshop
            // outside color stroke, including one applied to a containing group.
            if (stroke?.position === "outside" && stroke?.fillType !== "gradient" && stroke?.color) {
                const opacity = Number.isFinite(stroke.opacity) ? stroke.opacity : 1;
                this.outline = {
                    width: stroke.size?.value || 0,
                    color: new Color(stroke.color.r, stroke.color.g, stroke.color.b, opacity * 255)
                };
                return;
            }
            layer = layer.parent;
        }
    }
    /** 解析 颜色叠加 */
    parseSolidFill() {
        if (this.source.effects?.disabled !== true && this.source.effects?.solidFill) {
            let solidFills = this.source.effects?.solidFill;
            for (let i = 0; i < solidFills.length; i++) {
                const solidFill = solidFills[i];
                if (solidFill.enabled) {
                    let color = solidFill.color;
                    this.color = new Color(color.r, color.g, color.b, solidFill.opacity * 255);
                }
            }
        }
    }
}
