import type { Asset2DBorderLike, SpriteAtlasFrame } from '@axrone/asset-2d';
import { Component, script } from '@axrone/ecs-runtime';
import { Color, Vec2 } from '@axrone/numeric';
import type { IColorLike } from '@axrone/numeric';
import type {
    Render2DRectLike,
    Render2DSizeLike,
    Render2DVec2Like,
} from '@axrone/render-2d';

export type SpriteRendererVec2Input =
    | Vec2
    | Render2DVec2Like
    | readonly [number, number];
export type SpriteRendererSizeInput =
    | Vec2
    | Render2DSizeLike
    | readonly [number, number];
export type SpriteRendererRectInput =
    | Render2DRectLike
    | readonly [number, number, number, number];
export type SpriteRendererBorderInput =
    | Asset2DBorderLike
    | readonly [number, number, number, number]
    | null;
export type SpriteRendererColorInput = Color | Readonly<IColorLike>;

export interface SpriteRendererRectState {
    x: number;
    y: number;
    width: number;
    height: number;
}

export interface SpriteRendererBorderState {
    left: number;
    right: number;
    top: number;
    bottom: number;
}

export interface SpriteRendererFrameApplyOptions {
    readonly preserveSize?: boolean;
    readonly preserveAnchor?: boolean;
    readonly preserveSourceSize?: boolean;
    readonly preserveSliceBorder?: boolean;
}

export interface SpriteRendererConfig {
    readonly textureId?: string | null;
    readonly materialId?: string | null;
    readonly visible?: boolean;
    readonly renderOrder?: number;
    readonly sortingLayer?: number;
    readonly passId?: string;
    readonly size?: SpriteRendererSizeInput;
    readonly sourceSize?: SpriteRendererSizeInput;
    readonly anchor?: SpriteRendererVec2Input;
    readonly uvRect?: SpriteRendererRectInput;
    readonly color?: SpriteRendererColorInput;
    readonly sliceBorder?: SpriteRendererBorderInput;
    readonly frame?: SpriteAtlasFrame | null;
    readonly flipX?: boolean;
    readonly flipY?: boolean;
}

const isTuple2 = (value: unknown): value is readonly [number, number] =>
    Array.isArray(value) && value.length >= 2;

const isTuple4 = (
    value: unknown
): value is readonly [number, number, number, number] =>
    Array.isArray(value) && value.length >= 4;

const toVec2 = (
    value: SpriteRendererVec2Input | SpriteRendererSizeInput | undefined,
    fallbackX: number,
    fallbackY: number
): Vec2 => {
    if (!value) {
        return new Vec2(fallbackX, fallbackY);
    }

    if (value instanceof Vec2) {
        return new Vec2(value.x, value.y);
    }

    if (isTuple2(value)) {
        return new Vec2(Number(value[0] ?? fallbackX), Number(value[1] ?? fallbackY));
    }

    if ('width' in value && 'height' in value) {
        return new Vec2(Number(value.width), Number(value.height));
    }

    return new Vec2(Number(value.x), Number(value.y));
};

const toColor = (
    value: SpriteRendererColorInput | readonly number[] | undefined,
    fallback: Color = Color.WHITE
): Color => {
    if (!value) {
        return fallback.clone();
    }

    if (Array.isArray(value)) {
        return Color.fromArray(value);
    }

    return Color.from(value as Readonly<IColorLike>);
};

const toRect = (
    value: SpriteRendererRectInput | undefined,
    fallback: SpriteRendererRectState = { x: 0, y: 0, width: 1, height: 1 }
): SpriteRendererRectState => {
    if (!value) {
        return { ...fallback };
    }

    if (isTuple4(value)) {
        return {
            x: Number(value[0] ?? fallback.x),
            y: Number(value[1] ?? fallback.y),
            width: Number(value[2] ?? fallback.width),
            height: Number(value[3] ?? fallback.height),
        };
    }

    return {
        x: Number(value.x),
        y: Number(value.y),
        width: Number(value.width),
        height: Number(value.height),
    };
};

const toBorder = (
    value: SpriteRendererBorderInput | undefined,
    fallback: SpriteRendererBorderState | null = null
): SpriteRendererBorderState | null => {
    if (value == null) {
        return fallback
            ? {
                  left: fallback.left,
                  right: fallback.right,
                  top: fallback.top,
                  bottom: fallback.bottom,
              }
            : null;
    }

    if (isTuple4(value)) {
        return {
            left: Number(value[0] ?? 0),
            right: Number(value[1] ?? 0),
            top: Number(value[2] ?? 0),
            bottom: Number(value[3] ?? 0),
        };
    }

    return {
        left: Number(value.left),
        right: Number(value.right),
        top: Number(value.top),
        bottom: Number(value.bottom),
    };
};

@script({
    scriptName: 'SpriteRenderer',
    priority: 100,
    executeInEditMode: true,
    singleton: false,
})
export class SpriteRenderer extends Component {
    private _textureId: string | null;
    private _materialId: string | null;
    private _visible: boolean;
    private _renderOrder: number;
    private _sortingLayer: number;
    private _passId: string;
    private readonly _size: Vec2;
    private readonly _sourceSize: Vec2;
    private readonly _anchor: Vec2;
    private readonly _color: Color;
    private readonly _uvRect: SpriteRendererRectState;
    private _sliceBorder: SpriteRendererBorderState | null;
    private _flipX: boolean;
    private _flipY: boolean;

    constructor(config: SpriteRendererConfig = {}) {
        super();
        this._textureId = config.textureId ?? null;
        this._materialId = config.materialId ?? null;
        this._visible = config.visible ?? true;
        this._renderOrder = config.renderOrder ?? 0;
        this._sortingLayer = config.sortingLayer ?? 0;
        this._passId = config.passId ?? 'main';
        this._size = toVec2(config.size, 1, 1);
        this._sourceSize = toVec2(config.sourceSize ?? config.size, this._size.x, this._size.y);
        this._anchor = toVec2(config.anchor, 0.5, 0.5);
        this._color = toColor(config.color);
        this._uvRect = toRect(config.uvRect);
        this._sliceBorder = toBorder(config.sliceBorder);
        this._flipX = config.flipX ?? false;
        this._flipY = config.flipY ?? false;

        if (config.frame) {
            this.applyFrame(config.frame, {
                preserveSize: config.size !== undefined,
                preserveAnchor: config.anchor !== undefined,
                preserveSourceSize: config.sourceSize !== undefined,
                preserveSliceBorder: config.sliceBorder !== undefined,
            });
        }
    }

    get textureId(): string | null {
        return this._textureId;
    }

    set textureId(value: string | null) {
        this._textureId = value;
    }

    get materialId(): string | null {
        return this._materialId;
    }

    set materialId(value: string | null) {
        this._materialId = value;
    }

    get visible(): boolean {
        return this._visible;
    }

    set visible(value: boolean) {
        this._visible = value;
    }

    get renderOrder(): number {
        return this._renderOrder;
    }

    set renderOrder(value: number) {
        this._renderOrder = value;
    }

    get sortingLayer(): number {
        return this._sortingLayer;
    }

    set sortingLayer(value: number) {
        this._sortingLayer = value;
    }

    get passId(): string {
        return this._passId;
    }

    set passId(value: string) {
        this._passId = value;
    }

    get size(): Vec2 {
        return this._size;
    }

    set size(value: SpriteRendererSizeInput) {
        const next = toVec2(value, this._size.x, this._size.y);
        this._size.x = next.x;
        this._size.y = next.y;
    }

    get sourceSize(): Vec2 {
        return this._sourceSize;
    }

    set sourceSize(value: SpriteRendererSizeInput) {
        const next = toVec2(value, this._sourceSize.x, this._sourceSize.y);
        this._sourceSize.x = next.x;
        this._sourceSize.y = next.y;
    }

    get anchor(): Vec2 {
        return this._anchor;
    }

    set anchor(value: SpriteRendererVec2Input) {
        const next = toVec2(value, this._anchor.x, this._anchor.y);
        this._anchor.x = next.x;
        this._anchor.y = next.y;
    }

    get color(): Color {
        return this._color;
    }

    set color(value: SpriteRendererColorInput) {
        const next = toColor(value, this._color);
        this._color.r = next.r;
        this._color.g = next.g;
        this._color.b = next.b;
        this._color.a = next.a;
    }

    get uvRect(): SpriteRendererRectState {
        return this._uvRect;
    }

    set uvRect(value: SpriteRendererRectInput) {
        const next = toRect(value, this._uvRect);
        this._uvRect.x = next.x;
        this._uvRect.y = next.y;
        this._uvRect.width = next.width;
        this._uvRect.height = next.height;
    }

    get sliceBorder(): SpriteRendererBorderState | null {
        return this._sliceBorder;
    }

    set sliceBorder(value: SpriteRendererBorderInput) {
        this._sliceBorder = toBorder(value);
    }

    get flipX(): boolean {
        return this._flipX;
    }

    set flipX(value: boolean) {
        this._flipX = value;
    }

    get flipY(): boolean {
        return this._flipY;
    }

    set flipY(value: boolean) {
        this._flipY = value;
    }

    get hasRenderableSource(): boolean {
        return Boolean(this._materialId || this._textureId);
    }

    get isNineSlice(): boolean {
        return this._sliceBorder !== null;
    }

    setSize(width: number, height: number): this {
        this._size.x = width;
        this._size.y = height;
        return this;
    }

    setSourceSize(width: number, height: number): this {
        this._sourceSize.x = width;
        this._sourceSize.y = height;
        return this;
    }

    setAnchor(x: number, y: number): this {
        this._anchor.x = x;
        this._anchor.y = y;
        return this;
    }

    setColor(value: SpriteRendererColorInput): this {
        const next = toColor(value, this._color);
        this._color.r = next.r;
        this._color.g = next.g;
        this._color.b = next.b;
        this._color.a = next.a;
        return this;
    }

    setUVRect(x: number, y: number, width: number, height: number): this {
        this._uvRect.x = x;
        this._uvRect.y = y;
        this._uvRect.width = width;
        this._uvRect.height = height;
        return this;
    }

    setSliceBorder(left: number, right: number, top: number, bottom: number): this {
        this._sliceBorder = { left, right, top, bottom };
        return this;
    }

    clearSliceBorder(): this {
        this._sliceBorder = null;
        return this;
    }

    applyFrame(
        frame: SpriteAtlasFrame,
        options: SpriteRendererFrameApplyOptions = {}
    ): this {
        this._textureId = frame.textureId;
        this.setUVRect(frame.uvRect.x, frame.uvRect.y, frame.uvRect.width, frame.uvRect.height);

        if (!options.preserveSize) {
            this.setSize(frame.sourceSize.width, frame.sourceSize.height);
        }

        if (!options.preserveSourceSize) {
            this.setSourceSize(frame.sourceSize.width, frame.sourceSize.height);
        }

        if (!options.preserveAnchor) {
            this.setAnchor(frame.pivot.x, frame.pivot.y);
        }

        if (!options.preserveSliceBorder) {
            this._sliceBorder = toBorder(frame.sliceBorder);
        }

        return this;
    }

    override serialize(): Record<string, unknown> {
        return {
            textureId: this._textureId,
            materialId: this._materialId,
            visible: this._visible,
            renderOrder: this._renderOrder,
            sortingLayer: this._sortingLayer,
            passId: this._passId,
            size: [this._size.x, this._size.y],
            sourceSize: [this._sourceSize.x, this._sourceSize.y],
            anchor: [this._anchor.x, this._anchor.y],
            color: [this._color.r, this._color.g, this._color.b, this._color.a],
            uvRect: [
                this._uvRect.x,
                this._uvRect.y,
                this._uvRect.width,
                this._uvRect.height,
            ],
            sliceBorder: this._sliceBorder
                ? [
                      this._sliceBorder.left,
                      this._sliceBorder.right,
                      this._sliceBorder.top,
                      this._sliceBorder.bottom,
                  ]
                : null,
            flipX: this._flipX,
            flipY: this._flipY,
        };
    }

    override deserialize(data: Record<string, any>): void {
        if (typeof data.textureId === 'string' || data.textureId === null) {
            this._textureId = data.textureId;
        }
        if (typeof data.materialId === 'string' || data.materialId === null) {
            this._materialId = data.materialId;
        }
        if (typeof data.visible === 'boolean') {
            this._visible = data.visible;
        }
        if (typeof data.renderOrder === 'number') {
            this._renderOrder = data.renderOrder;
        }
        if (typeof data.sortingLayer === 'number') {
            this._sortingLayer = data.sortingLayer;
        }
        if (typeof data.passId === 'string') {
            this._passId = data.passId;
        }
        if (Array.isArray(data.size) && data.size.length >= 2) {
            this.setSize(Number(data.size[0]), Number(data.size[1]));
        }
        if (Array.isArray(data.sourceSize) && data.sourceSize.length >= 2) {
            this.setSourceSize(Number(data.sourceSize[0]), Number(data.sourceSize[1]));
        }
        if (Array.isArray(data.anchor) && data.anchor.length >= 2) {
            this.setAnchor(Number(data.anchor[0]), Number(data.anchor[1]));
        }
        if (data.color) {
            this.setColor(data.color);
        }
        if (Array.isArray(data.uvRect) && data.uvRect.length >= 4) {
            this.setUVRect(
                Number(data.uvRect[0]),
                Number(data.uvRect[1]),
                Number(data.uvRect[2]),
                Number(data.uvRect[3])
            );
        }
        if (data.sliceBorder === null) {
            this.clearSliceBorder();
        } else if (Array.isArray(data.sliceBorder) && data.sliceBorder.length >= 4) {
            this.setSliceBorder(
                Number(data.sliceBorder[0]),
                Number(data.sliceBorder[1]),
                Number(data.sliceBorder[2]),
                Number(data.sliceBorder[3])
            );
        } else if (data.sliceBorder && typeof data.sliceBorder === 'object') {
            this.sliceBorder = data.sliceBorder as Asset2DBorderLike;
        }
        if (typeof data.flipX === 'boolean') {
            this._flipX = data.flipX;
        }
        if (typeof data.flipY === 'boolean') {
            this._flipY = data.flipY;
        }
    }
}