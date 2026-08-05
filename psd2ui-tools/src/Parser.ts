import { imageCacheMgr } from "./assets-manager/ImageCacheMgr";
import { imageMgr } from "./assets-manager/ImageMgr";
import { LayerType } from "./psd/LayerType";
import { PsdDocument } from "./psd/PsdDocument";
import { PsdGroup } from "./psd/PsdGroup";
import { PsdImage } from "./psd/PsdImage";
import { PsdAttr, PsdLayer } from "./psd/PsdLayer";
import { PsdText } from "./psd/PsdText";
import { PsdLayerSource } from "./_declare";

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
    parseLayer(source: any, parent?: PsdGroup, rootDoc?: PsdDocument) {
        let layer: PsdLayer = null;
        let layerType = this.parseLayerType(source);
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

                for (let i = 0; i < source.children.length; i++) {
                    const childSource = source.children[i];
                    let child = this.parseLayer(childSource, group, rootDoc || group as PsdDocument);
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
        if (!effects) return false;
        const gradientOverlay = this.enabledEffect(effects.gradientOverlay);
        const stroke = this.enabledEffect(effects.stroke);
        return !!(gradientOverlay || (stroke && stroke.fillType === 'gradient'));
    }

    private enabledEffect(value: any) {
        if (Array.isArray(value)) return value.find((entry: any) => entry && entry.enabled);
        return value?.enabled ? value : null;
    }

    private applyHeuristics(root: PsdDocument) {
        this.applyMirrorCopyHeuristics(root);
        this.applyCompositeArtifactHeuristics(root);
        this.pruneIgnoredNodes(root);
        this.recomputeGroupRects(root);
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
