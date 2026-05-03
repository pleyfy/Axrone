import { Vec2 } from '@axrone/numeric';
import { Component, script } from '@axrone/ecs-runtime';
import type { Render2DSizeLike, Render2DVec2Like } from '@axrone/render-2d';

export type SpriteMaskVec2Input = Vec2 | Render2DVec2Like | readonly [number, number];
export type SpriteMaskSizeInput = Vec2 | Render2DSizeLike | readonly [number, number];
export type SpriteMaskShape = 'rect' | 'circle' | 'rounded-rect';

export interface SpriteMaskConfig {
    readonly size?: SpriteMaskSizeInput;
    readonly anchor?: SpriteMaskVec2Input;
    readonly shape?: SpriteMaskShape;
    readonly cornerRadius?: number | null;
}

const isTuple2 = (value: unknown): value is readonly [number, number] =>
    Array.isArray(value) && value.length >= 2;

const toVec2 = (
    value: SpriteMaskVec2Input | SpriteMaskSizeInput | undefined,
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

const toShape = (value: SpriteMaskShape | undefined): SpriteMaskShape => value ?? 'rect';

@script({
    scriptName: 'SpriteMask',
    priority: 105,
    executeInEditMode: true,
    singleton: false,
})
export class SpriteMask extends Component {
    private readonly _size: Vec2;
    private readonly _anchor: Vec2;
    private _shape: SpriteMaskShape;
    private _cornerRadius: number | null;

    constructor(config: SpriteMaskConfig = {}) {
        super();
        this._size = toVec2(config.size, 1, 1);
        this._anchor = toVec2(config.anchor, 0.5, 0.5);
        this._shape = toShape(config.shape);
        this._cornerRadius = config.cornerRadius ?? null;
    }

    get size(): Vec2 {
        return this._size;
    }

    set size(value: SpriteMaskSizeInput) {
        const next = toVec2(value, this._size.x, this._size.y);
        this._size.x = next.x;
        this._size.y = next.y;
    }

    get anchor(): Vec2 {
        return this._anchor;
    }

    set anchor(value: SpriteMaskVec2Input) {
        const next = toVec2(value, this._anchor.x, this._anchor.y);
        this._anchor.x = next.x;
        this._anchor.y = next.y;
    }

    get shape(): SpriteMaskShape {
        return this._shape;
    }

    set shape(value: SpriteMaskShape) {
        this._shape = value;
    }

    get cornerRadius(): number | null {
        return this._cornerRadius;
    }

    set cornerRadius(value: number | null) {
        this._cornerRadius = value;
    }

    setSize(width: number, height: number): this {
        this._size.x = width;
        this._size.y = height;
        return this;
    }

    setAnchor(x: number, y: number): this {
        this._anchor.x = x;
        this._anchor.y = y;
        return this;
    }

    setShape(shape: SpriteMaskShape): this {
        this._shape = shape;
        return this;
    }

    setCornerRadius(cornerRadius: number | null): this {
        this._cornerRadius = cornerRadius;
        return this;
    }

    override serialize(): Record<string, unknown> {
        return {
            size: [this._size.x, this._size.y],
            anchor: [this._anchor.x, this._anchor.y],
            shape: this._shape,
            cornerRadius: this._cornerRadius,
        };
    }

    override deserialize(data: Record<string, any>): void {
        if (Array.isArray(data.size) && data.size.length >= 2) {
            this.setSize(Number(data.size[0]), Number(data.size[1]));
        }

        if (Array.isArray(data.anchor) && data.anchor.length >= 2) {
            this.setAnchor(Number(data.anchor[0]), Number(data.anchor[1]));
        }

        if (typeof data.shape === 'string') {
            this.shape = data.shape as SpriteMaskShape;
        }

        if (typeof data.cornerRadius === 'number') {
            this.cornerRadius = data.cornerRadius;
        } else if (data.cornerRadius === null) {
            this.cornerRadius = null;
        }
    }
}