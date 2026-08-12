"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.parser = exports.Parser = void 0;
const ImageCacheMgr_1 = require("./assets-manager/ImageCacheMgr");
const ImageMgr_1 = require("./assets-manager/ImageMgr");
const LayerType_1 = require("./psd/LayerType");
const PsdDocument_1 = require("./psd/PsdDocument");
const PsdGroup_1 = require("./psd/PsdGroup");
const PsdImage_1 = require("./psd/PsdImage");
const PsdText_1 = require("./psd/PsdText");
class Parser {
    /** 解析图层类型 */
    parseLayerType(source) {
        if ("children" in source) {
            if ("width" in source && "height" in source) {
                // Document
                return LayerType_1.LayerType.Doc;
            }
            else {
                // Group
                return LayerType_1.LayerType.Group;
            }
        }
        else if ("text" in source) {
            //  Text
            return LayerType_1.LayerType.Text;
        }
        // else if ('placedLayer' in layer) {
        //     // 智能对象
        // }
        return LayerType_1.LayerType.Image;
    }
    parseLayer(source, parent, rootDoc) {
        let layer = null;
        let layerType = this.parseLayerType(source);
        switch (layerType) {
            case LayerType_1.LayerType.Doc:
            case LayerType_1.LayerType.Group:
                {
                    let group = null;
                    // Group
                    if (layerType == LayerType_1.LayerType.Group) {
                        group = new PsdGroup_1.PsdGroup(source, parent, rootDoc);
                        if (group.attr.comps.ignorenode || group.attr.comps.ignore) {
                            return null;
                        }
                    }
                    else {
                        // Document
                        group = new PsdDocument_1.PsdDocument(source);
                    }
                    for (let i = 0; i < source.children.length; i++) {
                        const childSource = source.children[i];
                        let child = this.parseLayer(childSource, group, rootDoc || group);
                        if (child) {
                            let shouldIgnoreNode = !!(child.attr.comps.ignorenode || child.attr.comps.ignore);
                            if (child instanceof PsdImage_1.PsdImage) {
                                shouldIgnoreNode = shouldIgnoreNode || child.shouldIgnoreNode();
                            }
                            if (!shouldIgnoreNode) {
                                // 没有进行忽略节点的时候才放入列表
                                group.children.push(child);
                            }
                        }
                        else {
                            console.error(`图层解析错误`);
                        }
                    }
                    layer = group;
                }
                break;
            case LayerType_1.LayerType.Image:
                {
                    // 
                    if (!source.canvas) {
                        console.error(`Parser-> 空图层 ${source === null || source === void 0 ? void 0 : source.name}`);
                        return null;
                    }
                    // Image
                    let image = layer = new PsdImage_1.PsdImage(source, parent, rootDoc);
                    this.registerImage(image);
                }
                break;
            case LayerType_1.LayerType.Text:
                {
                    // Cocos 2.4 labels cannot represent Photoshop gradient fills or strokes.
                    if (this.shouldRasterizeText(source)) {
                        if (!source.canvas) {
                            console.error(`Parser-> 空文本图层 ${source === null || source === void 0 ? void 0 : source.name}`);
                            return null;
                        }
                        const image = new PsdImage_1.PsdImage(source, parent, rootDoc);
                        this.registerImage(image);
                        layer = image;
                        layerType = LayerType_1.LayerType.Image;
                    }
                    else {
                        layer = new PsdText_1.PsdText(source, parent, rootDoc);
                    }
                }
                break;
            default:
                break;
        }
        layer.layerType = layerType;
        layer.parseSource();
        layer.onCtor();
        if (layerType === LayerType_1.LayerType.Doc) {
            this.applyHeuristics(layer);
        }
        return layer;
    }
    registerImage(image) {
        ImageMgr_1.imageMgr.add(image);
        if (!image.isIgnore() && !image.isBind() && !ImageCacheMgr_1.imageCacheMgr.has(image.md5)) {
            ImageCacheMgr_1.imageCacheMgr.set(image.md5, {
                uuid: image.uuid,
                textureUuid: image.textureUuid,
            });
        }
    }
    shouldRasterizeText(source) {
        const effects = source === null || source === void 0 ? void 0 : source.effects;
        if (!effects)
            return false;
        const gradientOverlay = this.enabledEffect(effects.gradientOverlay);
        const stroke = this.enabledEffect(effects.stroke);
        return !!(gradientOverlay || (stroke && stroke.fillType === 'gradient'));
    }
    enabledEffect(value) {
        if (Array.isArray(value))
            return value.find((entry) => entry && entry.enabled);
        return (value === null || value === void 0 ? void 0 : value.enabled) ? value : null;
    }
    applyHeuristics(root) {
        this.applyClippingVisibility(root);
        this.applyMirrorCopyHeuristics(root);
        this.applyCompositeArtifactHeuristics(root);
        this.pruneIgnoredNodes(root);
        this.recomputeGroupRects(root);
    }
    /** A clipped layer is invisible when its Photoshop clipping base is hidden. */
    applyClippingVisibility(group) {
        let clippingBase = null;
        group.children = group.children.filter((child) => {
            var _a;
            if (child instanceof PsdGroup_1.PsdGroup) {
                this.applyClippingVisibility(child);
            }
            if ((_a = child.source) === null || _a === void 0 ? void 0 : _a.clipping) {
                if (!clippingBase || clippingBase.hidden) {
                    console.log(`Parser-> 忽略无可见基层的剪贴层 ${child.name}`);
                    return false;
                }
                return true;
            }
            clippingBase = child;
            return true;
        });
    }
    applyMirrorCopyHeuristics(group) {
        let images = group.children.filter((child) => child instanceof PsdImage_1.PsdImage);
        for (let i = 0; i < images.length; i++) {
            for (let j = i + 1; j < images.length; j++) {
                let source = images[i];
                let candidate = images[j];
                let preferred = this.preferMirrorSource(source, candidate);
                source = preferred.source;
                candidate = preferred.candidate;
                if (candidate.isBind() || source.isBind() || candidate.isIgnore() || source.isIgnore()) {
                    continue;
                }
                if (this.isLikelyMirroredDuplicate(source, candidate, group)) {
                    candidate.setAutoBinding(source, { flipX: true });
                    console.log(`Parser-> 启发式镜像绑定 ${candidate.name} -> ${source.name} (flipX)`);
                }
            }
        }
        for (let i = 0; i < group.children.length; i++) {
            let child = group.children[i];
            if (child instanceof PsdGroup_1.PsdGroup) {
                this.applyMirrorCopyHeuristics(child);
            }
        }
    }
    applyCompositeArtifactHeuristics(group) {
        for (let i = 0; i < group.children.length; i++) {
            let child = group.children[i];
            if (child instanceof PsdGroup_1.PsdGroup) {
                this.applyCompositeArtifactHeuristics(child);
                continue;
            }
            if (!(child instanceof PsdImage_1.PsdImage)) {
                continue;
            }
            if (child.isIgnore() || child.isBind()) {
                continue;
            }
            if (!child.hasComplexCompositeContext()) {
                continue;
            }
            if (!child.coversMostOfParent()) {
                continue;
            }
            if (!child.looksLikeUniformColorFill()) {
                continue;
            }
            child.markIgnoredByHeuristic({ removeNode: true });
            console.log(`Parser-> 启发式忽略高风险合成层 ${child.name}`);
        }
    }
    pruneIgnoredNodes(group) {
        group.children = group.children.filter((child) => {
            if (child instanceof PsdImage_1.PsdImage) {
                return !child.shouldIgnoreNode();
            }
            return !(child.attr.comps.ignorenode || child.attr.comps.ignore);
        });
        for (let i = 0; i < group.children.length; i++) {
            let child = group.children[i];
            if (child instanceof PsdGroup_1.PsdGroup) {
                this.pruneIgnoredNodes(child);
            }
        }
    }
    recomputeGroupRects(group) {
        var _a;
        for (let i = 0; i < group.children.length; i++) {
            let child = group.children[i];
            if (child instanceof PsdGroup_1.PsdGroup) {
                this.recomputeGroupRects(child);
            }
        }
        if (group instanceof PsdDocument_1.PsdDocument) {
            return;
        }
        if (!((_a = group.attr) === null || _a === void 0 ? void 0 : _a.comps.full)) {
            group.resize();
            group.computeBasePosition();
        }
    }
    preferMirrorSource(a, b) {
        let aIsCopy = this.looksLikeCopyName(a.name);
        let bIsCopy = this.looksLikeCopyName(b.name);
        if (aIsCopy && !bIsCopy) {
            return { source: b, candidate: a };
        }
        if (!aIsCopy && bIsCopy) {
            return { source: a, candidate: b };
        }
        return { source: a, candidate: b };
    }
    looksLikeCopyName(name) {
        return /KaoBei/i.test(name);
    }
    isLikelyMirroredDuplicate(source, candidate, group) {
        let widthDelta = Math.abs(source.size.width - candidate.size.width);
        let heightDelta = Math.abs(source.size.height - candidate.size.height);
        if (widthDelta > 1 || heightDelta > 1) {
            return false;
        }
        let sourceCenter = (source.rect.left + source.rect.right) / 2;
        let candidateCenter = (candidate.rect.left + candidate.rect.right) / 2;
        let parentCenterSum = group.rect.left + group.rect.right;
        if (Math.abs((sourceCenter + candidateCenter) - parentCenterSum) > 2) {
            return false;
        }
        if (Math.abs(source.rect.top - candidate.rect.top) > 2 || Math.abs(source.rect.bottom - candidate.rect.bottom) > 2) {
            return false;
        }
        if (!this.looksLikeCopyName(source.name) && !this.looksLikeCopyName(candidate.name)) {
            return false;
        }
        return this.matchesMirroredPixels(source.source.canvas, candidate.source.canvas);
    }
    matchesMirroredPixels(sourceCanvas, candidateCanvas, tolerance = 6) {
        if (!sourceCanvas || !candidateCanvas) {
            return false;
        }
        if (sourceCanvas.width !== candidateCanvas.width || sourceCanvas.height !== candidateCanvas.height) {
            return false;
        }
        let width = sourceCanvas.width;
        let height = sourceCanvas.height;
        let sourceData = sourceCanvas.getContext('2d').getImageData(0, 0, width, height).data;
        let candidateData = candidateCanvas.getContext('2d').getImageData(0, 0, width, height).data;
        for (let y = 0; y < height; y += 2) {
            for (let x = 0; x < width; x += 2) {
                let sourceIdx = (y * width + x) * 4;
                let candidateIdx = (y * width + (width - x - 1)) * 4;
                for (let channel = 0; channel < 4; channel++) {
                    if (Math.abs(sourceData[sourceIdx + channel] - candidateData[candidateIdx + channel]) > tolerance) {
                        return false;
                    }
                }
            }
        }
        return true;
    }
}
exports.Parser = Parser;
exports.parser = new Parser();
