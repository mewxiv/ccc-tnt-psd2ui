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

    private static readonly SMART_OBJECT_TRANSFORM_TOLERANCE = 0.01;

    constructor(source: any, parent: PsdLayer, rootDoc: PsdLayer) {
        super(source, parent, rootDoc);
        this.textureUuid = utils.uuid();

        // img name
        this.imgName = this.attr.comps.img?.name || this.name

        this.trimPlacedLayerTransparentPadding();

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

    onCtor() {

    }

    isIgnore() {
        // 
        if (this.attr.comps.ignore || this.attr.comps.ignoreimg) {
            return true;
        }
        return false;
    }

    /** 是否是镜像图片 */
    isBind() {
        return typeof this.attr.comps.flip?.bind !== 'undefined'
            || typeof this.attr.comps.img?.bind !== 'undefined';
    }

    /** 是否是 x 方向镜像图片 */
    isFlipX() {
        return typeof this.attr.comps.flipX?.bind !== 'undefined';
    }

    /** 是否是 y 方向镜像图片 */
    isFlipY() {
        return typeof this.attr.comps.flipY?.bind !== 'undefined';
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
