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
