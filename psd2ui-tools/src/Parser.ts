import { imageCacheMgr } from "./assets-manager/ImageCacheMgr";
import { imageMgr } from "./assets-manager/ImageMgr";
import { LayerType } from "./psd/LayerType";
import { PsdDocument } from "./psd/PsdDocument";
import { PsdGroup } from "./psd/PsdGroup";
import { PsdImage } from "./psd/PsdImage";
import { PsdAttr, PsdLayer } from "./psd/PsdLayer";
import { PsdText } from "./psd/PsdText";
import { PsdLayerSource } from "./_declare";
import canvas from "canvas";

interface ClippingBaseSnapshot {
    source: any;
    alpha: Uint8ClampedArray;
    width: number;
    height: number;
}

export class Parser {

    /** 解析图层类型 */
    parseLayerType(source: PsdLayerSource) {
        if ("children" in source) {
            if ("width" in source && "height" in source) {
                // Document
                return LayerType.Doc;
            } else {
                // Group
                return LayerType.Group;
            }
        } else if ("text" in source) {
            //  Text
            return LayerType.Text;
        }
        // else if ('placedLayer' in layer) {
        //     // 智能对象
        // }
        return LayerType.Image;
    }
    parseLayer(source: any, parent?: PsdGroup, rootDoc?: PsdDocument, sourcePath?: string) {
        let layer: PsdLayer = null;
        let layerType = this.parseLayerType(source);
        const currentPath = sourcePath || source?.name || "document";
        switch (layerType) {
            case LayerType.Doc:
            case LayerType.Group: {

                let group: PsdGroup = null
                // Group
                if (layerType == LayerType.Group) {
                    group = new PsdGroup(source, parent, rootDoc);
                    if (group.attr.comps.ignorenode || group.attr.comps.ignore) {
                        return null;
                    }
                } else {
                    // Document
                    group = new PsdDocument(source);
                }

                let clippingBase: ClippingBaseSnapshot = null;
                for (let i = 0; i < source.children.length; i++) {
                    const childSource = source.children[i];
                    const childPath = `${currentPath}/${childSource?.name || i}`;
                    if (childSource?.clipping) {
                        if (!clippingBase?.source?.hidden) {
                            this.bakeClippingAlpha(childSource, clippingBase, childPath);
                        }
                    } else {
                        clippingBase = this.captureClippingBase(childSource);
                    }

                    let child = this.parseLayer(childSource, group, rootDoc || group as PsdDocument, childPath);
                    if (child) {
                        let shouldIgnoreNode = !!(child.attr.comps.ignorenode || child.attr.comps.ignore);
                        if (child instanceof PsdImage) {
                            shouldIgnoreNode = shouldIgnoreNode || child.shouldIgnoreNode();
                        }
                        if (!shouldIgnoreNode) {
                            // 没有进行忽略节点的时候才放入列表
                            group.children.push(child);
                        }
                    } else {
                        console.error(`图层解析错误`);
                    }
                }
                layer = group;
            }
                break;

            case LayerType.Image: {
                // 
                if (!source.canvas) {
                    console.error(`Parser-> 空图层 ${source?.name}`);
                    return null;
                }
                // Image
                let image = layer = new PsdImage(source, parent, rootDoc);
                this.registerImage(image);
            }
                break;

            case LayerType.Text: {
                // Cocos 2.4 labels cannot represent Photoshop gradient fills or strokes.
                if (this.shouldRasterizeText(source)) {
                    if (!source.canvas) {
                        console.error(`Parser-> 空文本图层 ${source?.name}`);
                        return null;
                    }
                    const image = new PsdImage(source, parent, rootDoc);
                    this.registerImage(image);
                    layer = image;
                    layerType = LayerType.Image;
                } else {
                    layer = new PsdText(source, parent, rootDoc);
                }
            }
                break;

            default:
                break;
        }
        layer.layerType = layerType;
        layer.parseSource();
        layer.onCtor();
        if (layerType === LayerType.Doc) {
            this.applyHeuristics(layer as PsdDocument);
        }
        return layer;
    }

    private registerImage(image: PsdImage) {
        imageMgr.add(image);
        if (!image.isIgnore() && !image.isBind() && !imageCacheMgr.has(image.md5)) {
            imageCacheMgr.set(image.md5, {
                uuid: image.uuid,
                textureUuid: image.textureUuid,
            });
        }
    }

    private shouldRasterizeText(source: any) {
        const effects = source?.effects;
        if (!effects || effects.disabled === true) return false;
        const gradientOverlay = this.enabledEffect(effects.gradientOverlay);
        const stroke = this.enabledEffect(effects.stroke);
        return !!(gradientOverlay || (stroke && stroke.fillType === 'gradient'));
    }

    private enabledEffect(value: any) {
        if (Array.isArray(value)) return value.find((entry: any) => entry && entry.enabled);
        return value?.enabled ? value : null;
    }

    private captureClippingBase(source: any): ClippingBaseSnapshot {
        if (!source?.canvas || source.children || source.text || source.mask || source.vectorMask) {
            return { source, alpha: null, width: 0, height: 0 };
        }

        try {
            const width = source.canvas.width;
            const height = source.canvas.height;
            const imageData = source.canvas.getContext('2d').getImageData(0, 0, width, height);
            const alpha = new Uint8ClampedArray(width * height);
            for (let i = 0; i < alpha.length; i++) {
                alpha[i] = imageData.data[i * 4 + 3];
            }
            return { source, alpha, width, height };
        } catch (_error) {
            return { source, alpha: null, width: 0, height: 0 };
        }
    }

    private bakeClippingAlpha(source: any, base: ClippingBaseSnapshot, sourcePath: string) {
        const unsupportedReason = this.clippingUnsupportedReason(source, base);
        if (unsupportedReason) {
            console.warn(`Parser-> 剪贴层 ${sourcePath} 无法烘焙: ${unsupportedReason}，保留原图`);
            return;
        }

        try {
            const sourceWidth = source.canvas.width;
            const sourceHeight = source.canvas.height;
            const sourceContext = source.canvas.getContext('2d');
            const sourcePixels = sourceContext.getImageData(0, 0, sourceWidth, sourceHeight);
            let left = sourceWidth;
            let right = -1;
            let top = sourceHeight;
            let bottom = -1;

            for (let y = 0; y < sourceHeight; y++) {
                for (let x = 0; x < sourceWidth; x++) {
                    const sourceIndex = y * sourceWidth + x;
                    const baseX = source.left + x - base.source.left;
                    const baseY = source.top + y - base.source.top;
                    const baseAlpha = baseX >= 0 && baseY >= 0 && baseX < base.width && baseY < base.height
                        ? base.alpha[baseY * base.width + baseX]
                        : 0;
                    const alphaIndex = sourceIndex * 4 + 3;
                    const bakedAlpha = Math.round(sourcePixels.data[alphaIndex] * baseAlpha / 255);
                    sourcePixels.data[alphaIndex] = bakedAlpha;
                    if (bakedAlpha === 0) continue;
                    if (x < left) left = x;
                    if (x > right) right = x;
                    if (y < top) top = y;
                    if (y > bottom) bottom = y;
                }
            }

            if (right < left || bottom < top) {
                source.canvas = canvas.createCanvas(1, 1);
                source.right = source.left + 1;
                source.bottom = source.top + 1;
                return;
            }

            const croppedWidth = right - left + 1;
            const croppedHeight = bottom - top + 1;
            const croppedCanvas = canvas.createCanvas(croppedWidth, croppedHeight);
            const croppedContext = croppedCanvas.getContext('2d');
            const croppedPixels = croppedContext.createImageData(croppedWidth, croppedHeight);
            for (let y = 0; y < croppedHeight; y++) {
                for (let x = 0; x < croppedWidth; x++) {
                    const sourceIndex = ((top + y) * sourceWidth + left + x) * 4;
                    const targetIndex = (y * croppedWidth + x) * 4;
                    croppedPixels.data[targetIndex] = sourcePixels.data[sourceIndex];
                    croppedPixels.data[targetIndex + 1] = sourcePixels.data[sourceIndex + 1];
                    croppedPixels.data[targetIndex + 2] = sourcePixels.data[sourceIndex + 2];
                    croppedPixels.data[targetIndex + 3] = sourcePixels.data[sourceIndex + 3];
                }
            }
            croppedContext.putImageData(croppedPixels, 0, 0);

            source.canvas = croppedCanvas;
            source.left += left;
            source.top += top;
            source.right = source.left + croppedWidth;
            source.bottom = source.top + croppedHeight;
        } catch (error) {
            console.warn(`Parser-> 剪贴层 ${sourcePath} 烘焙失败: ${error?.message || error}，保留原图`);
        }
    }

    private clippingUnsupportedReason(source: any, base: ClippingBaseSnapshot) {
        if (!base?.source) return "缺少剪贴基层";
        if (!base.alpha) return "剪贴基层不是可读取像素的普通图片层";
        if (!source?.canvas || source.children || source.text) return "剪贴层不是可读取像素的普通图片层";
        if (source.mask || source.vectorMask) return "剪贴层包含独立蒙版";

        const values = [
            source.left, source.top, source.right, source.bottom,
            base.source.left, base.source.top, base.source.right, base.source.bottom,
        ];
        if (values.some((value) => !Number.isFinite(value))) return "图层边界无效";
        if (source.right - source.left !== source.canvas.width
            || source.bottom - source.top !== source.canvas.height
            || base.source.right - base.source.left !== base.width
            || base.source.bottom - base.source.top !== base.height) {
            return "图层边界与画布尺寸不一致";
        }
        if (![source.left, source.top, base.source.left, base.source.top].every(Number.isInteger)) {
            return "图层边界不是整数像素";
        }
        return null;
    }

    private applyHeuristics(root: PsdDocument) {
        this.applyClippingVisibility(root);
        this.applyMirrorCopyHeuristics(root);
        this.applyCompositeArtifactHeuristics(root);
        this.pruneIgnoredNodes(root);
        this.recomputeGroupRects(root);
    }

    /** A clipped layer is invisible when its Photoshop clipping base is hidden. */
    private applyClippingVisibility(group: PsdGroup) {
        let clippingBase: PsdLayer = null;
        group.children = group.children.filter((child) => {
            if (child instanceof PsdGroup) {
                this.applyClippingVisibility(child);
            }

            if (child.source?.clipping) {
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

    private applyMirrorCopyHeuristics(group: PsdGroup) {
        let images = group.children.filter((child) => child instanceof PsdImage) as PsdImage[];
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
            if (child instanceof PsdGroup) {
                this.applyMirrorCopyHeuristics(child);
            }
        }
    }

    private applyCompositeArtifactHeuristics(group: PsdGroup) {
        for (let i = 0; i < group.children.length; i++) {
            let child = group.children[i];
            if (child instanceof PsdGroup) {
                this.applyCompositeArtifactHeuristics(child);
                continue;
            }
            if (!(child instanceof PsdImage)) {
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

    private pruneIgnoredNodes(group: PsdGroup) {
        group.children = group.children.filter((child) => {
            if (child instanceof PsdImage) {
                return !child.shouldIgnoreNode();
            }
            return !(child.attr.comps.ignorenode || child.attr.comps.ignore);
        });

        for (let i = 0; i < group.children.length; i++) {
            let child = group.children[i];
            if (child instanceof PsdGroup) {
                this.pruneIgnoredNodes(child);
            }
        }
    }

    private recomputeGroupRects(group: PsdGroup) {
        for (let i = 0; i < group.children.length; i++) {
            let child = group.children[i];
            if (child instanceof PsdGroup) {
                this.recomputeGroupRects(child);
            }
        }

        if (group instanceof PsdDocument) {
            return;
        }

        if (!group.attr?.comps.full) {
            group.resize();
            group.computeBasePosition();
        }
    }

    private preferMirrorSource(a: PsdImage, b: PsdImage) {
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

    private looksLikeCopyName(name: string) {
        return /KaoBei/i.test(name);
    }

    private isLikelyMirroredDuplicate(source: PsdImage, candidate: PsdImage, group: PsdGroup) {
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

    private matchesMirroredPixels(sourceCanvas: any, candidateCanvas: any, tolerance = 6) {
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

export const parser = new Parser();
