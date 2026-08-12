import { PsdGroup } from "./PsdGroup";
import { PsdLayer } from "./PsdLayer";
import { utils } from "../utils/Utils";
import canvas from 'canvas';
import { Border, Texture9Utils } from "../utils/Texture9Utils";
import { Size } from "../values/Size";
import { fileUtils } from "../utils/FileUtils";
import { Vec3 } from "../values/Vec3";

export class PsdImage extends PsdLayer {
    declare parent: PsdGroup;

    declare textureUuid: string;

    declare md5: string;
    declare imgBuffer: Buffer;

    declare textureSize: Size;

    declare imgName: string;


    declare s9: Border;

    autoBindTarget?: PsdImage;
    autoFlipXBinding: boolean = false;
    autoFlipYBinding: boolean = false;
    autoIgnoreImageByHeuristic: boolean = false;
    autoIgnoreNodeByHeuristic: boolean = false;

    private static readonly SMART_OBJECT_TRANSFORM_TOLERANCE = 0.01;

    constructor(source: any, parent: PsdLayer, rootDoc: PsdLayer) {
        super(source, parent, rootDoc);
        this.textureUuid = utils.uuid();

        // img name
        this.imgName = this.attr.comps.img?.name || this.name

        this.trimPlacedLayerTransparentPadding();
        this.applyLayerStyle();

        // .9
        if (this.attr.comps['.9']) {
            let s9 = this.attr.comps['.9'];
            this.s9 = Texture9Utils.safeBorder(this.source.canvas, s9 as any);
            let newCanvas = Texture9Utils.split(this.source.canvas, s9 as any);
            this.source.canvas = newCanvas;
        }
        let canvas: canvas.Canvas = this.source.canvas;

        this.imgBuffer = canvas.toBuffer('image/png');
        this.md5 = fileUtils.getMD5(this.imgBuffer);

        this.textureSize = new Size(canvas.width, canvas.height);
        this.scale = new Vec3((this.isFlipX() ? -1 : 1) * this.scale.x, (this.isFlipY() ? -1 : 1) * this.scale.y, 1);
    }

    /** Bake Photoshop effects which Cocos 2.4 sprites and labels cannot represent. */
    private applyLayerStyle() {
        const sourceCanvas: canvas.Canvas = this.source.canvas;
        const effects = (this.source.vectorMask || this.source.text) && this.source.effects;
        if (!sourceCanvas || !effects) return;

        const solidFill = this.enabledEffect(effects.solidFill);
        const gradientOverlay = this.enabledEffect(effects.gradientOverlay);
        const outerGlow = this.enabledEffect(effects.outerGlow);
        const innerGlow = this.enabledEffect(effects.innerGlow);
        const dropShadow = this.enabledEffect(effects.dropShadow);
        const stroke = this.enabledEffect(effects.stroke);
        if (this.source.vectorMask && !solidFill && !gradientOverlay) return;
        if (!solidFill && !gradientOverlay && !outerGlow && !innerGlow && !dropShadow && !stroke) return;

        const width = sourceCanvas.width;
        const height = sourceCanvas.height;
        const styled = canvas.createCanvas(width, height);
        const styledContext = styled.getContext('2d');

        const shadow = outerGlow || dropShadow;
        if (shadow) {
            styledContext.save();
            styledContext.shadowColor = this.cssColor(shadow.color, shadow.opacity);
            styledContext.shadowBlur = Number(shadow.size?.value) || 0;
            if (dropShadow && !outerGlow) {
                const distance = Number(dropShadow.distance?.value) || 0;
                const shadowAngle = Number(dropShadow.angle);
                const angle = (Number.isFinite(shadowAngle) ? shadowAngle : 90) * Math.PI / 180;
                styledContext.shadowOffsetX = Math.cos(angle) * distance;
                styledContext.shadowOffsetY = Math.sin(angle) * distance;
            }
            styledContext.drawImage(sourceCanvas, 0, 0);
            styledContext.restore();
        }

        if (stroke) {
            const radius = Math.max(1, Math.round(Number(stroke.size?.value) || 1));
            const strokeMask = this.dilate(sourceCanvas, radius);
            const maskContext = strokeMask.getContext('2d');
            maskContext.globalCompositeOperation = 'destination-out';
            maskContext.drawImage(sourceCanvas, 0, 0);
            this.paintMask(styledContext, strokeMask, stroke.gradient || null, stroke.color, stroke.opacity, stroke.gradient?.angle);
        }

        if (!gradientOverlay?.gradient && !solidFill?.color) {
            styledContext.drawImage(sourceCanvas, 0, 0);
        }

        if (gradientOverlay?.gradient) {
            this.paintMask(styledContext, sourceCanvas, gradientOverlay.gradient, null, gradientOverlay.opacity, gradientOverlay.angle);
        } else if (solidFill?.color) {
            this.paintMask(styledContext, sourceCanvas, null, solidFill.color, solidFill.opacity);
        }

        if (innerGlow) {
            const radius = Math.max(1, Math.round(Number(innerGlow.size?.value) || 1));
            const choke = Math.max(0, Number(innerGlow.choke?.value) || 0);
            const glowMask = this.innerGlowMask(sourceCanvas, radius, choke);
            this.paintMask(styledContext, glowMask, null, innerGlow.color, innerGlow.opacity, 90, innerGlow.blendMode);
        }

        this.source.canvas = styled;
    }

    private enabledEffect(value: any) {
        if (Array.isArray(value)) return value.find((entry: any) => entry && entry.enabled);
        return value?.enabled ? value : null;
    }

    private dilate(sourceCanvas: canvas.Canvas, radius: number) {
        const mask = canvas.createCanvas(sourceCanvas.width, sourceCanvas.height);
        const context = mask.getContext('2d');
        for (let y = -radius; y <= radius; y++) {
            for (let x = -radius; x <= radius; x++) {
                if (x * x + y * y <= radius * radius) context.drawImage(sourceCanvas, x, y);
            }
        }
        return mask;
    }

    private innerGlowMask(sourceCanvas: canvas.Canvas, radius: number, choke: number) {
        const mask = canvas.createCanvas(sourceCanvas.width, sourceCanvas.height);
        const sourceContext = sourceCanvas.getContext('2d');
        const sourceData = sourceContext.getImageData(0, 0, sourceCanvas.width, sourceCanvas.height);
        const edgeData = mask.getContext('2d').createImageData(sourceCanvas.width, sourceCanvas.height);
        const paddedWidth = sourceCanvas.width + 2;
        const paddedHeight = sourceCanvas.height + 2;
        const maxDistance = radius + choke + 2;
        const distances = new Float32Array(paddedWidth * paddedHeight);
        distances.fill(maxDistance);

        for (let y = 0; y < paddedHeight; y++) {
            for (let x = 0; x < paddedWidth; x++) {
                if (x === 0 || y === 0 || x === paddedWidth - 1 || y === paddedHeight - 1) {
                    distances[y * paddedWidth + x] = 0;
                    continue;
                }
                const sourceIndex = ((y - 1) * sourceCanvas.width + (x - 1)) * 4;
                if (sourceData.data[sourceIndex + 3] === 0) distances[y * paddedWidth + x] = 0;
            }
        }

        const diagonal = Math.SQRT2;
        for (let y = 1; y < paddedHeight - 1; y++) {
            for (let x = 1; x < paddedWidth - 1; x++) {
                const index = y * paddedWidth + x;
                if (distances[index] === 0) continue;
                distances[index] = Math.min(
                    distances[index],
                    distances[index - 1] + 1,
                    distances[index - paddedWidth] + 1,
                    distances[index - paddedWidth - 1] + diagonal,
                    distances[index - paddedWidth + 1] + diagonal
                );
            }
        }
        for (let y = paddedHeight - 2; y >= 1; y--) {
            for (let x = paddedWidth - 2; x >= 1; x--) {
                const index = y * paddedWidth + x;
                if (distances[index] === 0) continue;
                distances[index] = Math.min(
                    distances[index],
                    distances[index + 1] + 1,
                    distances[index + paddedWidth] + 1,
                    distances[index + paddedWidth + 1] + diagonal,
                    distances[index + paddedWidth - 1] + diagonal
                );
            }
        }

        for (let y = 0; y < sourceCanvas.height; y++) {
            for (let x = 0; x < sourceCanvas.width; x++) {
                const sourceIndex = (y * sourceCanvas.width + x) * 4;
                const sourceAlpha = sourceData.data[sourceIndex + 3];
                if (sourceAlpha === 0) continue;
                const distance = distances[(y + 1) * paddedWidth + x + 1];
                const fade = Math.max(0, Math.min(1, 1 - Math.max(0, distance - 1 - choke) / radius));
                edgeData.data[sourceIndex + 3] = Math.round(sourceAlpha * fade);
            }
        }
        mask.getContext('2d').putImageData(edgeData, 0, 0);
        return mask;
    }

    private paintMask(target: canvas.CanvasRenderingContext2D, mask: canvas.Canvas, gradient: any, color: any, opacity = 1, angle = 90, blendMode = 'normal') {
        const fill = canvas.createCanvas(mask.width, mask.height);
        const fillContext = fill.getContext('2d');
        fillContext.drawImage(mask, 0, 0);
        fillContext.globalCompositeOperation = 'source-in';
        if (gradient?.colorStops?.length) {
            const gradientAngle = Number(angle);
            const radians = (Number.isFinite(gradientAngle) ? gradientAngle : 90) * Math.PI / 180;
            const dx = Math.cos(radians) * mask.width;
            const dy = Math.sin(radians) * mask.height;
            const gradientFill = fillContext.createLinearGradient(
                mask.width / 2 - dx / 2, mask.height / 2 - dy / 2,
                mask.width / 2 + dx / 2, mask.height / 2 + dy / 2
            );
            gradient.colorStops.forEach((stop: any) => {
                const stopOpacity = gradient.opacityStops?.find((entry: any) => entry.location === stop.location)?.opacity ?? 1;
                gradientFill.addColorStop(Math.max(0, Math.min(1, Number(stop.location) || 0)), this.cssColor(stop.color, stopOpacity * opacity));
            });
            fillContext.fillStyle = gradientFill;
        } else if (color) {
            const fillOpacity = Number(opacity);
            fillContext.fillStyle = this.cssColor(color, Number.isFinite(fillOpacity) ? fillOpacity : 1);
        } else {
            return;
        }
        fillContext.fillRect(0, 0, mask.width, mask.height);
        target.save();
        target.globalCompositeOperation = this.canvasBlendMode(blendMode) as any;
        target.drawImage(fill, 0, 0);
        target.restore();
    }

    private canvasBlendMode(blendMode: string) {
        switch (String(blendMode || '').toLowerCase().replace(/[_-]+/g, ' ')) {
            case 'screen':
                return 'screen';
            case 'color dodge':
                return 'color-dodge';
            case 'multiply':
                return 'multiply';
            case 'linear dodge':
                return 'lighter';
            default:
                return 'source-over';
        }
    }

    private cssColor(color: any, opacity = 1) {
        const alpha = Math.max(0, Math.min(1, Number(opacity ?? 1)));
        return `rgba(${Math.round(Number(color?.r) || 0)}, ${Math.round(Number(color?.g) || 0)}, ${Math.round(Number(color?.b) || 0)}, ${alpha})`;
    }

    onCtor() {

    }

    isIgnore() {
        // 
        if (this.attr.comps.ignore || this.attr.comps.ignoreimg || this.autoIgnoreImageByHeuristic) {
            return true;
        }
        return false;
    }

    shouldIgnoreNode() {
        return !!(this.attr.comps.ignore || this.attr.comps.ignorenode || this.autoIgnoreNodeByHeuristic);
    }

    /** 是否是镜像图片 */
    isBind() {
        return typeof this.attr.comps.flip?.bind !== 'undefined'
            || typeof this.attr.comps.img?.bind !== 'undefined'
            || !!this.autoBindTarget;
    }

    /** 是否是 x 方向镜像图片 */
    isFlipX() {
        return typeof this.attr.comps.flipX?.bind !== 'undefined' || this.autoFlipXBinding;
    }

    /** 是否是 y 方向镜像图片 */
    isFlipY() {
        return typeof this.attr.comps.flipY?.bind !== 'undefined' || this.autoFlipYBinding;
    }

    setAutoBinding(target: PsdImage, options: { flipX?: boolean, flipY?: boolean } = {}) {
        this.autoBindTarget = target;
        this.autoFlipXBinding = !!options.flipX;
        this.autoFlipYBinding = !!options.flipY;
    }

    markIgnoredByHeuristic(options: { removeNode?: boolean } = {}) {
        this.autoIgnoreImageByHeuristic = true;
        this.autoIgnoreNodeByHeuristic = !!options.removeNode;
    }

    hasComplexCompositeContext() {
        return !!(this.source?.clipping
            || this.source?.mask
            || this.source?.vectorMask
            || (this.source?.blendMode && this.source.blendMode !== 'normal'));
    }

    looksLikeUniformColorFill(sampleStride = 8, tolerance = 4) {
        let canvasSource: canvas.Canvas = this.source.canvas;
        if (!canvasSource) {
            return false;
        }

        let ctx = canvasSource.getContext('2d');
        let imageData = ctx.getImageData(0, 0, canvasSource.width, canvasSource.height);
        let data = imageData.data;
        let baseR = -1;
        let baseG = -1;
        let baseB = -1;
        let coveredPixels = 0;
        let sampledPixels = 0;

        for (let y = 0; y < canvasSource.height; y += sampleStride) {
            for (let x = 0; x < canvasSource.width; x += sampleStride) {
                let idx = (y * canvasSource.width + x) * 4;
                let alpha = data[idx + 3];
                if (alpha === 0) {
                    continue;
                }

                sampledPixels += 1;
                coveredPixels += 1;

                let r = data[idx];
                let g = data[idx + 1];
                let b = data[idx + 2];

                if (baseR === -1) {
                    baseR = r;
                    baseG = g;
                    baseB = b;
                    continue;
                }

                if (Math.abs(r - baseR) > tolerance
                    || Math.abs(g - baseG) > tolerance
                    || Math.abs(b - baseB) > tolerance) {
                    return false;
                }
            }
        }

        if (!sampledPixels) {
            return false;
        }

        let sampledGridWidth = Math.ceil(canvasSource.width / sampleStride);
        let sampledGridHeight = Math.ceil(canvasSource.height / sampleStride);
        let totalSamples = sampledGridWidth * sampledGridHeight;
        return coveredPixels / totalSamples >= 0.95;
    }

    coversMostOfParent(threshold = 0.9) {
        if (!this.parent?.size?.width || !this.parent?.size?.height) {
            return false;
        }
        return this.size.width / this.parent.size.width >= threshold
            && this.size.height / this.parent.size.height >= threshold;
    }

    // 根据锚点计算坐标
    updatePositionWithAR() {
        if (!this.parent) {
            return;
        }

        let parent = this.parent;
        while (parent) {
            this.position.x -= parent.position.x;
            this.position.y -= parent.position.y;
            parent = parent.parent;
        }

        // this.position.x  = this.position.x - this.parent.size.width * this.parent.anchorPoint.x + this.size.width * this.anchorPoint.x;
        // this.position.y  = this.position.y - this.parent.size.height * this.parent.anchorPoint.y + this.size.height * this.anchorPoint.y;
        // 如果是镜像图片，则特殊处理
        let arX = (this.isFlipX() ? (1 - this.anchorPoint.x) : this.anchorPoint.x);
        let arY = (this.isFlipY() ? (1 - this.anchorPoint.y) : this.anchorPoint.y);
        this.position.x = this.position.x - this.rootDoc.size.width * this.rootDoc.anchorPoint.x + this.size.width * arX;
        this.position.y = this.position.y - this.rootDoc.size.height * this.rootDoc.anchorPoint.y + this.size.height * arY;
    }

    private trimPlacedLayerTransparentPadding() {
        let canvasSource: canvas.Canvas = this.source.canvas;
        if (!this.source.placedLayer || !canvasSource) {
            return;
        }

        let rectWidth = this.rect.right - this.rect.left;
        let rectHeight = this.rect.bottom - this.rect.top;
        if (rectWidth !== canvasSource.width || rectHeight !== canvasSource.height) {
            return;
        }

        if (!this.isAxisAlignedPlacedLayerTransform()) {
            console.warn(`PsdImage-> smart object ${this.name} transform is not axis-aligned, skip transparent trim`);
            return;
        }

        let bbox = this.computeVisibleAlphaBounds(canvasSource);
        if (!bbox) {
            console.warn(`PsdImage-> smart object ${this.name} has no visible pixels, keep original canvas`);
            return;
        }

        if (bbox.left <= 0 && bbox.top <= 0 && bbox.right >= canvasSource.width && bbox.bottom >= canvasSource.height) {
            return;
        }

        let croppedCanvas = canvas.createCanvas(bbox.right - bbox.left, bbox.bottom - bbox.top);
        let ctx = croppedCanvas.getContext('2d');
        ctx.drawImage(
            canvasSource,
            bbox.left,
            bbox.top,
            bbox.right - bbox.left,
            bbox.bottom - bbox.top,
            0,
            0,
            bbox.right - bbox.left,
            bbox.bottom - bbox.top
        );

        this.source.canvas = croppedCanvas;
        this.rect.left += bbox.left;
        this.rect.top += bbox.top;
        this.rect.right = this.rect.left + croppedCanvas.width;
        this.rect.bottom = this.rect.top + croppedCanvas.height;
    }

    private isAxisAlignedPlacedLayerTransform() {
        let transform = this.source.placedLayer?.transform;
        if (!Array.isArray(transform) || transform.length < 8) {
            return true;
        }

        let tolerance = PsdImage.SMART_OBJECT_TRANSFORM_TOLERANCE;
        let [x1, y1, x2, y2, x3, y3, x4, y4] = transform;
        return Math.abs(y1 - y2) <= tolerance
            && Math.abs(x2 - x3) <= tolerance
            && Math.abs(y3 - y4) <= tolerance
            && Math.abs(x4 - x1) <= tolerance;
    }

    private computeVisibleAlphaBounds(canvasSource: canvas.Canvas) {
        let ctx = canvasSource.getContext('2d');
        let imageData = ctx.getImageData(0, 0, canvasSource.width, canvasSource.height);
        let data = imageData.data;

        let left = canvasSource.width;
        let right = -1;
        let top = canvasSource.height;
        let bottom = -1;

        for (let y = 0; y < canvasSource.height; y++) {
            for (let x = 0; x < canvasSource.width; x++) {
                let alpha = data[(y * canvasSource.width + x) * 4 + 3];
                if (alpha === 0) {
                    continue;
                }

                if (x < left) {
                    left = x;
                }
                if (x > right) {
                    right = x;
                }
                if (y < top) {
                    top = y;
                }
                if (y > bottom) {
                    bottom = y;
                }
            }
        }

        if (right < left || bottom < top) {
            return null;
        }

        return {
            left,
            top,
            right: right + 1,
            bottom: bottom + 1,
        };
    }
}
