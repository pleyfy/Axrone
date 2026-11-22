import type { Asset2DBorderLike, SpriteAtlasFrame } from '@axrone/asset-2d';
import { Component, script } from '@axrone/ecs-runtime';
import { Color, Rect, Vec2 } from '@axrone/numeric';
import type { IColorLike, IVec2Like } from '@axrone/numeric';
import type { Render2DRectLike, Render2DSizeLike } from '@axrone/render-2d';
import {
    BORDER_MUTATION_KEYS,
    COLOR_MUTATION_KEYS,
    RECT_MUTATION_KEYS,
    VEC2_MUTATION_KEYS,
    trackLiveMutations,
} from './live-value-tracking';

export type SpriteRendererVec2Input = Vec2 | Readonly<IVec2Like> | readonly [number, number];
export type SpriteRendererSizeInput = Vec2 | Render2DSizeLike | readonly [number, number];
export type SpriteRendererRectInput = Render2DRectLike | readonly [number, number, number, number];
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

const isTuple4 = (value: unknown): value is readonly [number, number, number, number] =>
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
        return value.clone();
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
        return Rect.fromArray(value);
    }

    return Rect.from(value);
};

const bordersEqual = (
    left: SpriteRendererBorderState | null,
    right: SpriteRendererBorderState | null
): boolean =>
    left === right ||
    (left !== null &&
        right !== null &&
        left.left === right.left &&
        left.right === right.right &&
        left.top === right.top &&
        left.bottom === right.bottom);

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
    // Sprites are the highest-cardinality component in 2D scenes. The base
    // Component tracks every instance in a global WeakRef set with an O(n)
    // sweep every 100 registrations, which made 50k-sprite construction
    // quadratic. Transform/Hierarchy already opt out; sprite renderers carry
    // no debug-tooling contract, so they opt out too.
    trackInstances: false,
})
export class SpriteRenderer extends Component {
    private _textureId: string | null;
    private _materialId: string | null;
    private _visible: boolean;
    private _renderOrder: number;
    private _sortingLayer: number;
    private _passId: string;
    // Raw backing objects stay proxy-free for render hot paths. The public
    // getters return mutation-tracked views over the same objects.
    private readonly _rawSize: Vec2;
    private readonly _rawSourceSize: Vec2;
    private readonly _rawAnchor: Vec2;
    private readonly _rawColor: Color;
    private readonly _rawUvRect: SpriteRendererRectState;
    private _rawSliceBorder: SpriteRendererBorderState | null;
    /**
     * Mutation-tracked public views. They are created on first access because
     * each one is a Proxy plus a closure, and a 50k-sprite scene would
     * otherwise allocate 300k proxies that the render path never reads (it
     * uses the raw accessors below).
     */
    private _sizeView: Vec2 | null = null;
    private _sourceSizeView: Vec2 | null = null;
    private _anchorView: Vec2 | null = null;
    private _colorView: Color | null = null;
    private _uvRectView: SpriteRendererRectState | null = null;
    private _sliceBorderView: SpriteRendererBorderState | null = null;
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
        this._rawSize = toVec2(config.size, 1, 1);
        this._rawSourceSize = toVec2(
            config.sourceSize ?? config.size,
            this._rawSize.x,
            this._rawSize.y
        );
        this._rawAnchor = toVec2(config.anchor, 0.5, 0.5);
        this._rawColor = toColor(config.color);
        this._rawUvRect = toRect(config.uvRect);
        this._rawSliceBorder = toBorder(config.sliceBorder);

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
        if (this._textureId === value) {
            return;
        }
        this._textureId = value;
        this.touch();
    }

    get materialId(): string | null {
        return this._materialId;
    }

    set materialId(value: string | null) {
        if (this._materialId === value) {
            return;
        }
        this._materialId = value;
        this.touch();
    }

    get visible(): boolean {
        return this._visible;
    }

    set visible(value: boolean) {
        if (this._visible === value) {
            return;
        }
        this._visible = value;
        this.touch();
    }

    get renderOrder(): number {
        return this._renderOrder;
    }

    set renderOrder(value: number) {
        if (this._renderOrder === value) {
            return;
        }
        this._renderOrder = value;
        this.touch();
    }

    get sortingLayer(): number {
        return this._sortingLayer;
    }

    set sortingLayer(value: number) {
        if (this._sortingLayer === value) {
            return;
        }
        this._sortingLayer = value;
        this.touch();
    }

    get passId(): string {
        return this._passId;
    }

    set passId(value: string) {
        if (this._passId === value) {
            return;
        }
        this._passId = value;
        this.touch();
    }

    /** Live internal state — read-only view. Mutating it bypasses setter normalization; assign via the setter. */
    get size(): Vec2 {
        return (this._sizeView ??= trackLiveMutations(this._rawSize, VEC2_MUTATION_KEYS, () =>
            this.touch()
        ));
    }

    set size(value: SpriteRendererSizeInput) {
        const next = toVec2(value, this._rawSize.x, this._rawSize.y);
        if (this._rawSize.x === next.x && this._rawSize.y === next.y) {
            return;
        }
        this._rawSize.x = next.x;
        this._rawSize.y = next.y;
        this.touch();
    }

    /** Live internal state — read-only view. Mutating it bypasses setter normalization; assign via the setter. */
    get sourceSize(): Vec2 {
        return (this._sourceSizeView ??= trackLiveMutations(
            this._rawSourceSize,
            VEC2_MUTATION_KEYS,
            () => this.touch()
        ));
    }

    set sourceSize(value: SpriteRendererSizeInput) {
        const next = toVec2(value, this._rawSourceSize.x, this._rawSourceSize.y);
        if (this._rawSourceSize.x === next.x && this._rawSourceSize.y === next.y) {
            return;
        }
        this._rawSourceSize.x = next.x;
        this._rawSourceSize.y = next.y;
        this.touch();
    }

    /** Live internal state — read-only view. Mutating it bypasses setter normalization; assign via the setter. */
    get anchor(): Vec2 {
        return (this._anchorView ??= trackLiveMutations(this._rawAnchor, VEC2_MUTATION_KEYS, () =>
            this.touch()
        ));
    }

    set anchor(value: SpriteRendererVec2Input) {
        const next = toVec2(value, this._rawAnchor.x, this._rawAnchor.y);
        if (this._rawAnchor.x === next.x && this._rawAnchor.y === next.y) {
            return;
        }
        this._rawAnchor.x = next.x;
        this._rawAnchor.y = next.y;
        this.touch();
    }

    /** Live internal state — read-only view. Mutating it bypasses setter normalization; assign via the setter. */
    get color(): Color {
        return (this._colorView ??= trackLiveMutations(this._rawColor, COLOR_MUTATION_KEYS, () =>
            this.touch()
        ));
    }

    set color(value: SpriteRendererColorInput) {
        const next = toColor(value, this._rawColor);
        if (
            this._rawColor.r === next.r &&
            this._rawColor.g === next.g &&
            this._rawColor.b === next.b &&
            this._rawColor.a === next.a
        ) {
            return;
        }
        this._rawColor.r = next.r;
        this._rawColor.g = next.g;
        this._rawColor.b = next.b;
        this._rawColor.a = next.a;
        this.touch();
    }

    /** Live internal state — read-only view. Mutating it bypasses setter normalization; assign via the setter. */
    get uvRect(): SpriteRendererRectState {
        return (this._uvRectView ??= trackLiveMutations(
            this._rawUvRect,
            RECT_MUTATION_KEYS,
            () => this.touch()
        ));
    }

    set uvRect(value: SpriteRendererRectInput) {
        const next = toRect(value, this._rawUvRect);
        if (
            this._rawUvRect.x === next.x &&
            this._rawUvRect.y === next.y &&
            this._rawUvRect.width === next.width &&
            this._rawUvRect.height === next.height
        ) {
            return;
        }
        this._rawUvRect.x = next.x;
        this._rawUvRect.y = next.y;
        this._rawUvRect.width = next.width;
        this._rawUvRect.height = next.height;
        this.touch();
    }

    /** Live internal state — read-only view. Mutating it bypasses setter normalization; assign via the setter. */
    get sliceBorder(): SpriteRendererBorderState | null {
        const raw = this._rawSliceBorder;
        if (raw === null) {
            return null;
        }

        return (this._sliceBorderView ??= trackLiveMutations(raw, BORDER_MUTATION_KEYS, () =>
            this.touch()
        ));
    }

    set sliceBorder(value: SpriteRendererBorderInput) {
        const next = toBorder(value);
        if (bordersEqual(this._rawSliceBorder, next)) {
            return;
        }
        this._rawSliceBorder = next;
        // The view wraps a specific backing object; replace it lazily.
        this._sliceBorderView = null;
        this.touch();
    }

    get flipX(): boolean {
        return this._flipX;
    }

    set flipX(value: boolean) {
        if (this._flipX === value) {
            return;
        }
        this._flipX = value;
        this.touch();
    }

    get flipY(): boolean {
        return this._flipY;
    }

    set flipY(value: boolean) {
        if (this._flipY === value) {
            return;
        }
        this._flipY = value;
        this.touch();
    }

    get hasRenderableSource(): boolean {
        return Boolean(this._materialId || this._textureId);
    }

    get isNineSlice(): boolean {
        return this._rawSliceBorder !== null;
    }

    /** @internal Proxy-free backing values for render hot paths. */
    getRenderSize(): Vec2 {
        return this._rawSize;
    }

    /** @internal Proxy-free backing values for render hot paths. */
    getRenderSourceSize(): Vec2 {
        return this._rawSourceSize;
    }

    /** @internal Proxy-free backing values for render hot paths. */
    getRenderAnchor(): Vec2 {
        return this._rawAnchor;
    }

    /** @internal Proxy-free backing values for render hot paths. */
    getRenderColor(): Color {
        return this._rawColor;
    }

    /** @internal Proxy-free backing values for render hot paths. */
    getRenderUvRect(): SpriteRendererRectState {
        return this._rawUvRect;
    }

    /** @internal Proxy-free backing values for render hot paths. */
    getRenderSliceBorder(): SpriteRendererBorderState | null {
        return this._rawSliceBorder;
    }

    setSize(width: number, height: number): this {
        if (this._rawSize.x === width && this._rawSize.y === height) {
            return this;
        }
        this._rawSize.x = width;
        this._rawSize.y = height;
        this.touch();
        return this;
    }

    setSourceSize(width: number, height: number): this {
        if (this._rawSourceSize.x === width && this._rawSourceSize.y === height) {
            return this;
        }
        this._rawSourceSize.x = width;
        this._rawSourceSize.y = height;
        this.touch();
        return this;
    }

    setAnchor(x: number, y: number): this {
        if (this._rawAnchor.x === x && this._rawAnchor.y === y) {
            return this;
        }
        this._rawAnchor.x = x;
        this._rawAnchor.y = y;
        this.touch();
        return this;
    }

    setColor(value: SpriteRendererColorInput): this {
        const next = toColor(value, this._rawColor);
        if (
            this._rawColor.r === next.r &&
            this._rawColor.g === next.g &&
            this._rawColor.b === next.b &&
            this._rawColor.a === next.a
        ) {
            return this;
        }
        this._rawColor.r = next.r;
        this._rawColor.g = next.g;
        this._rawColor.b = next.b;
        this._rawColor.a = next.a;
        this.touch();
        return this;
    }

    setUVRect(x: number, y: number, width: number, height: number): this {
        if (
            this._rawUvRect.x === x &&
            this._rawUvRect.y === y &&
            this._rawUvRect.width === width &&
            this._rawUvRect.height === height
        ) {
            return this;
        }
        this._rawUvRect.x = x;
        this._rawUvRect.y = y;
        this._rawUvRect.width = width;
        this._rawUvRect.height = height;
        this.touch();
        return this;
    }

    setSliceBorder(left: number, right: number, top: number, bottom: number): this {
        const next: SpriteRendererBorderState = { left, right, top, bottom };
        if (bordersEqual(this._rawSliceBorder, next)) {
            return this;
        }
        this._rawSliceBorder = next;
        this._sliceBorderView = null;
        this.touch();
        return this;
    }

    clearSliceBorder(): this {
        if (this._rawSliceBorder === null) {
            return this;
        }
        this._rawSliceBorder = null;
        this._sliceBorderView = null;
        this.touch();
        return this;
    }

    applyFrame(frame: SpriteAtlasFrame, options: SpriteRendererFrameApplyOptions = {}): this {
        // An animation loop commonly re-applies the current frame on every
        // render frame while the clip advances at a much lower rate. The
        // individual setters are no-ops when values are unchanged, but calling
        // all of them still costs five comparisons per sprite per frame. Skip
        // the whole apply when this frame would write nothing.
        const preserveSize = options.preserveSize === true;
        const preserveSourceSize = options.preserveSourceSize === true;
        const preserveAnchor = options.preserveAnchor === true;
        const preserveSliceBorder = options.preserveSliceBorder === true;
        const sameSize =
            preserveSize ||
            (this._rawSize.x === frame.sourceSize.width &&
                this._rawSize.y === frame.sourceSize.height);
        const sameSourceSize =
            preserveSourceSize ||
            (this._rawSourceSize.x === frame.sourceSize.width &&
                this._rawSourceSize.y === frame.sourceSize.height);
        const sameAnchor =
            preserveAnchor ||
            (this._rawAnchor.x === frame.pivot.x && this._rawAnchor.y === frame.pivot.y);
        const sameSliceBorder =
            preserveSliceBorder ||
            (frame.sliceBorder === null
                ? this._rawSliceBorder === null
                : bordersEqual(this._rawSliceBorder, toBorder(frame.sliceBorder)));
        if (
            this._textureId === frame.textureId &&
            this._rawUvRect.x === frame.uvRect.x &&
            this._rawUvRect.y === frame.uvRect.y &&
            this._rawUvRect.width === frame.uvRect.width &&
            this._rawUvRect.height === frame.uvRect.height &&
            sameSize &&
            sameSourceSize &&
            sameAnchor &&
            sameSliceBorder
        ) {
            return this;
        }

        if (this._textureId !== frame.textureId) {
            this._textureId = frame.textureId;
            this.touch();
        }

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
            this.sliceBorder = toBorder(frame.sliceBorder);
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
            size: [this._rawSize.x, this._rawSize.y],
            sourceSize: [this._rawSourceSize.x, this._rawSourceSize.y],
            anchor: [this._rawAnchor.x, this._rawAnchor.y],
            color: [this._rawColor.r, this._rawColor.g, this._rawColor.b, this._rawColor.a],
            uvRect: [
                this._rawUvRect.x,
                this._rawUvRect.y,
                this._rawUvRect.width,
                this._rawUvRect.height,
            ],
            sliceBorder: this._rawSliceBorder
                ? [
                      this._rawSliceBorder.left,
                      this._rawSliceBorder.right,
                      this._rawSliceBorder.top,
                      this._rawSliceBorder.bottom,
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

        // Direct field writes above bypass the setters; one touch covers them all.
        this.touch();
    }
}
