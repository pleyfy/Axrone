import { Vec2 } from '@axrone/numeric';
import { Component, script } from '@axrone/ecs-runtime';
import type { Render2DSizeLike, Render2DVec2Like } from '@axrone/render-2d';

export type SpriteMaskVec2Input = Vec2 | Render2DVec2Like | readonly [number, number];
export type SpriteMaskSizeInput = Vec2 | Render2DSizeLike | readonly [number, number];

export interface SpriteMaskConfig {
    readonly size?: SpriteMaskSizeInput;
    readonly anchor?: SpriteMaskVec2Input;
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

@script({
    scriptName: 'SpriteMask',
    priority: 105,
    executeInEditMode: true,
    singleton: false,
})
export class SpriteMask extends Component {
    private readonly _size: Vec2;
    private readonly _anchor: Vec2;

    constructor(config: SpriteMaskConfig = {}) {
        super();
        this._size = toVec2(config.size, 1, 1);
        this._anchor = toVec2(config.anchor, 0.5, 0.5);
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

    override serialize(): Record<string, unknown> {
        return {
            size: [this._size.x, this._size.y],
            anchor: [this._anchor.x, this._anchor.y],
        };
    }

    override deserialize(data: Record<string, any>): void {
        if (Array.isArray(data.size) && data.size.length >= 2) {
            this.setSize(Number(data.size[0]), Number(data.size[1]));
        }

        if (Array.isArray(data.anchor) && data.anchor.length >= 2) {
            this.setAnchor(Number(data.anchor[0]), Number(data.anchor[1]));
        }
    }
}