"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.PsdImage = void 0;
const PsdLayer_1 = require("./PsdLayer");
const Utils_1 = require("../utils/Utils");
const canvas_1 = __importDefault(require("canvas"));
const Texture9Utils_1 = require("../utils/Texture9Utils");
const Size_1 = require("../values/Size");
const FileUtils_1 = require("../utils/FileUtils");
const Vec3_1 = require("../values/Vec3");
class PsdImage extends PsdLayer_1.PsdLayer {
    constructor(source, parent, rootDoc) {
        var _a;
        super(source, parent, rootDoc);
        this.autoFlipXBinding = false;
        this.autoFlipYBinding = false;
        this.autoIgnoreImageByHeuristic = false;
        this.autoIgnoreNodeByHeuristic = false;
        this.textureUuid = Utils_1.utils.uuid();
        // img name
        this.imgName = ((_a = this.attr.comps.img) === null || _a === void 0 ? void 0 : _a.name) || this.name;
        this.trimPlacedLayerTransparentPadding();
        this.applyLayerStyle();
        // .9
        if (this.attr.comps['.9']) {
            let s9 = this.attr.comps['.9'];
            this.s9 = Texture9Utils_1.Texture9Utils.safeBorder(this.source.canvas, s9);
            let newCanvas = Texture9Utils_1.Texture9Utils.split(this.source.canvas, s9);
            this.source.canvas = newCanvas;
        }
        let canvas = this.source.canvas;
        this.imgBuffer = canvas.toBuffer('image/png');
        this.md5 = FileUtils_1.fileUtils.getMD5(this.imgBuffer);
        this.textureSize = new Size_1.Size(canvas.width, canvas.height);
        this.scale = new Vec3_1.Vec3((this.isFlipX() ? -1 : 1) * this.scale.x, (this.isFlipY() ? -1 : 1) * this.scale.y, 1);
    }
    /** Bake Photoshop effects which Cocos 2.4 sprites and labels cannot represent. */
    applyLayerStyle() {
        var _a, _b, _c, _d, _e;
        const sourceCanvas = this.source.canvas;
        const effects = (this.source.vectorMask || this.source.text) && this.source.effects;
        if (!sourceCanvas || !effects)
            return;
        const solidFill = this.enabledEffect(effects.solidFill);
        const gradientOverlay = this.enabledEffect(effects.gradientOverlay);
        const outerGlow = this.enabledEffect(effects.outerGlow);
        const innerGlow = this.enabledEffect(effects.innerGlow);
        const dropShadow = this.enabledEffect(effects.dropShadow);
        const stroke = this.enabledEffect(effects.stroke);
        if (this.source.vectorMask && !solidFill && !gradientOverlay)
            return;
        if (!solidFill && !gradientOverlay && !outerGlow && !innerGlow && !dropShadow && !stroke)
            return;
        const width = sourceCanvas.width;
        const height = sourceCanvas.height;
        const styled = canvas_1.default.createCanvas(width, height);
        const styledContext = styled.getContext('2d');
        const shadow = outerGlow || dropShadow;
        if (shadow) {
            styledContext.save();
            styledContext.shadowColor = this.cssColor(shadow.color, shadow.opacity);
            styledContext.shadowBlur = Number((_a = shadow.size) === null || _a === void 0 ? void 0 : _a.value) || 0;
            if (dropShadow && !outerGlow) {
                const distance = Number((_b = dropShadow.distance) === null || _b === void 0 ? void 0 : _b.value) || 0;
                const shadowAngle = Number(dropShadow.angle);
                const angle = (Number.isFinite(shadowAngle) ? shadowAngle : 90) * Math.PI / 180;
                styledContext.shadowOffsetX = Math.cos(angle) * distance;
                styledContext.shadowOffsetY = Math.sin(angle) * distance;
            }
            styledContext.drawImage(sourceCanvas, 0, 0);
            styledContext.restore();
        }
        if (stroke) {
            const radius = Math.max(1, Math.round(Number((_c = stroke.size) === null || _c === void 0 ? void 0 : _c.value) || 1));
            const strokeMask = this.dilate(sourceCanvas, radius);
            const maskContext = strokeMask.getContext('2d');
            maskContext.globalCompositeOperation = 'destination-out';
            maskContext.drawImage(sourceCanvas, 0, 0);
            this.paintMask(styledContext, strokeMask, stroke.gradient || null, stroke.color, stroke.opacity, (_d = stroke.gradient) === null || _d === void 0 ? void 0 : _d.angle);
        }
        if (!(gradientOverlay === null || gradientOverlay === void 0 ? void 0 : gradientOverlay.gradient) && !(solidFill === null || solidFill === void 0 ? void 0 : solidFill.color)) {
            styledContext.drawImage(sourceCanvas, 0, 0);
        }
        if (gradientOverlay === null || gradientOverlay === void 0 ? void 0 : gradientOverlay.gradient) {
            this.paintMask(styledContext, sourceCanvas, gradientOverlay.gradient, null, gradientOverlay.opacity, gradientOverlay.angle);
        }
        else if (solidFill === null || solidFill === void 0 ? void 0 : solidFill.color) {
            this.paintMask(styledContext, sourceCanvas, null, solidFill.color, solidFill.opacity);
        }
        if (innerGlow) {
            const radius = Math.max(1, Math.round(Number((_e = innerGlow.size) === null || _e === void 0 ? void 0 : _e.value) || 1));
            this.paintMask(styledContext, this.innerEdge(sourceCanvas, radius), null, innerGlow.color, innerGlow.opacity);
        }
        this.source.canvas = styled;
    }
    enabledEffect(value) {
        if (Array.isArray(value))
            return value.find((entry) => entry && entry.enabled);
        return (value === null || value === void 0 ? void 0 : value.enabled) ? value : null;
    }
    dilate(sourceCanvas, radius) {
        const mask = canvas_1.default.createCanvas(sourceCanvas.width, sourceCanvas.height);
        const context = mask.getContext('2d');
        for (let y = -radius; y <= radius; y++) {
            for (let x = -radius; x <= radius; x++) {
                if (x * x + y * y <= radius * radius)
                    context.drawImage(sourceCanvas, x, y);
            }
        }
        return mask;
    }
    innerEdge(sourceCanvas, radius) {
        const mask = canvas_1.default.createCanvas(sourceCanvas.width, sourceCanvas.height);
        const sourceContext = sourceCanvas.getContext('2d');
        const sourceData = sourceContext.getImageData(0, 0, sourceCanvas.width, sourceCanvas.height);
        const edgeData = mask.getContext('2d').createImageData(sourceCanvas.width, sourceCanvas.height);
        for (let y = 0; y < sourceCanvas.height; y++) {
            for (let x = 0; x < sourceCanvas.width; x++) {
                const index = (y * sourceCanvas.width + x) * 4;
                if (sourceData.data[index + 3] === 0)
                    continue;
                let edge = false;
                for (let offsetY = -radius; offsetY <= radius && !edge; offsetY++) {
                    for (let offsetX = -radius; offsetX <= radius; offsetX++) {
                        if (offsetX * offsetX + offsetY * offsetY > radius * radius)
                            continue;
                        const sampleX = x + offsetX;
                        const sampleY = y + offsetY;
                        if (sampleX < 0 || sampleY < 0 || sampleX >= sourceCanvas.width || sampleY >= sourceCanvas.height
                            || sourceData.data[(sampleY * sourceCanvas.width + sampleX) * 4 + 3] === 0) {
                            edge = true;
                            break;
                        }
                    }
                }
                if (edge)
                    edgeData.data[index + 3] = sourceData.data[index + 3];
            }
        }
        mask.getContext('2d').putImageData(edgeData, 0, 0);
        return mask;
    }
    paintMask(target, mask, gradient, color, opacity = 1, angle = 90) {
        var _a;
        const fill = canvas_1.default.createCanvas(mask.width, mask.height);
        const fillContext = fill.getContext('2d');
        fillContext.drawImage(mask, 0, 0);
        fillContext.globalCompositeOperation = 'source-in';
        if ((_a = gradient === null || gradient === void 0 ? void 0 : gradient.colorStops) === null || _a === void 0 ? void 0 : _a.length) {
            const gradientAngle = Number(angle);
            const radians = (Number.isFinite(gradientAngle) ? gradientAngle : 90) * Math.PI / 180;
            const dx = Math.cos(radians) * mask.width;
            const dy = Math.sin(radians) * mask.height;
            const gradientFill = fillContext.createLinearGradient(mask.width / 2 - dx / 2, mask.height / 2 - dy / 2, mask.width / 2 + dx / 2, mask.height / 2 + dy / 2);
            gradient.colorStops.forEach((stop) => {
                var _a, _b, _c;
                const stopOpacity = (_c = (_b = (_a = gradient.opacityStops) === null || _a === void 0 ? void 0 : _a.find((entry) => entry.location === stop.location)) === null || _b === void 0 ? void 0 : _b.opacity) !== null && _c !== void 0 ? _c : 1;
                gradientFill.addColorStop(Math.max(0, Math.min(1, Number(stop.location) || 0)), this.cssColor(stop.color, stopOpacity * opacity));
            });
            fillContext.fillStyle = gradientFill;
        }
        else if (color) {
            const fillOpacity = Number(opacity);
            fillContext.fillStyle = this.cssColor(color, Number.isFinite(fillOpacity) ? fillOpacity : 1);
        }
        else {
            return;
        }
        fillContext.fillRect(0, 0, mask.width, mask.height);
        target.drawImage(fill, 0, 0);
    }
    cssColor(color, opacity = 1) {
        const alpha = Math.max(0, Math.min(1, Number(opacity !== null && opacity !== void 0 ? opacity : 1)));
        return `rgba(${Math.round(Number(color === null || color === void 0 ? void 0 : color.r) || 0)}, ${Math.round(Number(color === null || color === void 0 ? void 0 : color.g) || 0)}, ${Math.round(Number(color === null || color === void 0 ? void 0 : color.b) || 0)}, ${alpha})`;
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
        var _a, _b;
        return typeof ((_a = this.attr.comps.flip) === null || _a === void 0 ? void 0 : _a.bind) !== 'undefined'
            || typeof ((_b = this.attr.comps.img) === null || _b === void 0 ? void 0 : _b.bind) !== 'undefined'
            || !!this.autoBindTarget;
    }
    /** 是否是 x 方向镜像图片 */
    isFlipX() {
        var _a;
        return typeof ((_a = this.attr.comps.flipX) === null || _a === void 0 ? void 0 : _a.bind) !== 'undefined' || this.autoFlipXBinding;
    }
    /** 是否是 y 方向镜像图片 */
    isFlipY() {
        var _a;
        return typeof ((_a = this.attr.comps.flipY) === null || _a === void 0 ? void 0 : _a.bind) !== 'undefined' || this.autoFlipYBinding;
    }
    setAutoBinding(target, options = {}) {
        this.autoBindTarget = target;
        this.autoFlipXBinding = !!options.flipX;
        this.autoFlipYBinding = !!options.flipY;
    }
    markIgnoredByHeuristic(options = {}) {
        this.autoIgnoreImageByHeuristic = true;
        this.autoIgnoreNodeByHeuristic = !!options.removeNode;
    }
    hasComplexCompositeContext() {
        var _a, _b, _c, _d;
        return !!(((_a = this.source) === null || _a === void 0 ? void 0 : _a.clipping)
            || ((_b = this.source) === null || _b === void 0 ? void 0 : _b.mask)
            || ((_c = this.source) === null || _c === void 0 ? void 0 : _c.vectorMask)
            || (((_d = this.source) === null || _d === void 0 ? void 0 : _d.blendMode) && this.source.blendMode !== 'normal'));
    }
    looksLikeUniformColorFill(sampleStride = 8, tolerance = 4) {
        let canvasSource = this.source.canvas;
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
        var _a, _b, _c, _d;
        if (!((_b = (_a = this.parent) === null || _a === void 0 ? void 0 : _a.size) === null || _b === void 0 ? void 0 : _b.width) || !((_d = (_c = this.parent) === null || _c === void 0 ? void 0 : _c.size) === null || _d === void 0 ? void 0 : _d.height)) {
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
    trimPlacedLayerTransparentPadding() {
        let canvasSource = this.source.canvas;
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
        let croppedCanvas = canvas_1.default.createCanvas(bbox.right - bbox.left, bbox.bottom - bbox.top);
        let ctx = croppedCanvas.getContext('2d');
        ctx.drawImage(canvasSource, bbox.left, bbox.top, bbox.right - bbox.left, bbox.bottom - bbox.top, 0, 0, bbox.right - bbox.left, bbox.bottom - bbox.top);
        this.source.canvas = croppedCanvas;
        this.rect.left += bbox.left;
        this.rect.top += bbox.top;
        this.rect.right = this.rect.left + croppedCanvas.width;
        this.rect.bottom = this.rect.top + croppedCanvas.height;
    }
    isAxisAlignedPlacedLayerTransform() {
        var _a;
        let transform = (_a = this.source.placedLayer) === null || _a === void 0 ? void 0 : _a.transform;
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
    computeVisibleAlphaBounds(canvasSource) {
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
exports.PsdImage = PsdImage;
PsdImage.SMART_OBJECT_TRANSFORM_TOLERANCE = 0.01;
