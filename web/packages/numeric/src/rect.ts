import { Comparer, CompareResult, EqualityComparer, Equatable, ICloneable } from '@axrone/utility';
import { Fnv1a32, HashValue, IHashable, IHasher } from '@axrone/hash';
import { EPSILON } from './common';
import { clamp01 } from './clamp';

/**
 * Canonical rectangle-like interface with position (x, y) and size (width, height).
 *
 * This is the single source of truth for rectangular bounds across the engine.
 * Both `@axrone/ui` (as `RectLike`) and `@axrone/render-2d` (as `Render2DRectLike`)
 * re-export this interface under their own public names to preserve API
 * compatibility while eliminating structural duplication.
 */
export interface IRectLike {
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
}

export class Rect implements IRectLike, ICloneable<Rect>, Equatable, IHashable {
    private static _hasher = new Fnv1a32();

    constructor(
        public x: number = 0,
        public y: number = 0,
        public width: number = 0,
        public height: number = 0
    ) {}

    static readonly ZERO: Readonly<Rect> = Object.freeze(new Rect(0, 0, 0, 0));
    static readonly UNIT: Readonly<Rect> = Object.freeze(new Rect(0, 0, 1, 1));

    static from<T extends IRectLike>(v: Readonly<T>): Rect {
        return new Rect(v.x, v.y, v.width, v.height);
    }

    static fromArray(arr: ArrayLike<number>, offset?: number): Rect;
    static fromArray<V extends IRectLike>(arr: ArrayLike<number>, offset: number, out: V): V;
    static fromArray<V extends IRectLike>(arr: ArrayLike<number>, offset: number = 0, out?: V): Rect | V {
        if (offset < 0) {
            throw new RangeError('Offset cannot be negative');
        }

        if (arr.length < offset + 4) {
            throw new RangeError(
                `Array must have at least ${offset + 4} elements when using offset ${offset}`
            );
        }

        const x = Number(arr[offset]);
        const y = Number(arr[offset + 1]);
        const width = Number(arr[offset + 2]);
        const height = Number(arr[offset + 3]);

        if (out) {
            (out as Rect).x = x;
            (out as Rect).y = y;
            (out as Rect).width = width;
            (out as Rect).height = height;
            return out;
        }

        return new Rect(x, y, width, height);
    }

    static create(x: number = 0, y: number = 0, width: number = 0, height: number = 0): Rect {
        return new Rect(x, y, width, height);
    }

    static copy<T extends IRectLike, V extends IRectLike>(source: Readonly<T>, out?: V): V {
        if (out) {
            (out as Rect).x = source.x;
            (out as Rect).y = source.y;
            (out as Rect).width = source.width;
            (out as Rect).height = source.height;
            return out;
        }
        return { x: source.x, y: source.y, width: source.width, height: source.height } as V;
    }

    get right(): number {
        return this.x + this.width;
    }

    get bottom(): number {
        return this.y + this.height;
    }

    get centerX(): number {
        return this.x + this.width * 0.5;
    }

    get centerY(): number {
        return this.y + this.height * 0.5;
    }

    get isEmpty(): boolean {
        return this.width <= 0 || this.height <= 0;
    }

    get area(): number {
        return this.width * this.height;
    }

    set(x: number, y: number, width: number, height: number): Rect {
        this.x = x;
        this.y = y;
        this.width = width;
        this.height = height;
        return this;
    }

    copyFrom<T extends IRectLike>(source: Readonly<T>): Rect {
        this.x = source.x;
        this.y = source.y;
        this.width = source.width;
        this.height = source.height;
        return this;
    }

    clone(): Rect {
        return new Rect(this.x, this.y, this.width, this.height);
    }

    equals(other: unknown): boolean {
        if (!(other instanceof Rect)) return false;

        return (
            Math.abs(this.x - other.x) < EPSILON &&
            Math.abs(this.y - other.y) < EPSILON &&
            Math.abs(this.width - other.width) < EPSILON &&
            Math.abs(this.height - other.height) < EPSILON
        );
    }

    getHashCode(): number {
        return Rect._hasher
            .reset()
            .updateF32(this.x)
            .updateF32(this.y)
            .updateF32(this.width)
            .updateF32(this.height)
            .digest();
    }

    hashInto<H extends HashValue = any>(hasher: IHasher<H>): void {
        hasher.updateF32(this.x).updateF32(this.y).updateF32(this.width).updateF32(this.height);
    }

    toArray(): [number, number, number, number] {
        return [this.x, this.y, this.width, this.height];
    }

    static equals<T extends IRectLike, U extends IRectLike>(a: Readonly<T>, b: Readonly<U>): boolean {
        if (a === b) return true;
        if (!a || !b) return false;

        return (
            Math.abs(a.x - b.x) < EPSILON &&
            Math.abs(a.y - b.y) < EPSILON &&
            Math.abs(a.width - b.width) < EPSILON &&
            Math.abs(a.height - b.height) < EPSILON
        );
    }

    static intersect<T extends IRectLike, U extends IRectLike>(
        a: Readonly<T>,
        b: Readonly<U>
    ): Rect | null;
    static intersect<T extends IRectLike, U extends IRectLike, V extends IRectLike>(
        a: Readonly<T>,
        b: Readonly<U>,
        out: V
    ): V | null;
    static intersect<T extends IRectLike, U extends IRectLike, V extends IRectLike>(
        a: Readonly<T>,
        b: Readonly<U>,
        out?: V
    ): Rect | V | null {
        const x = Math.max(a.x, b.x);
        const y = Math.max(a.y, b.y);
        const right = Math.min(a.x + a.width, b.x + b.width);
        const bottom = Math.min(a.y + a.height, b.y + b.height);

        if (right <= x || bottom <= y) {
            return null;
        }

        const width = right - x;
        const height = bottom - y;

        if (out) {
            (out as Rect).x = x;
            (out as Rect).y = y;
            (out as Rect).width = width;
            (out as Rect).height = height;
            return out;
        }

        return new Rect(x, y, width, height);
    }

    static union<T extends IRectLike, U extends IRectLike>(
        a: Readonly<T>,
        b: Readonly<U>
    ): Rect;
    static union<T extends IRectLike, U extends IRectLike, V extends IRectLike>(
        a: Readonly<T>,
        b: Readonly<U>,
        out: V
    ): V;
    static union<T extends IRectLike, U extends IRectLike, V extends IRectLike>(
        a: Readonly<T>,
        b: Readonly<U>,
        out?: V
    ): Rect | V {
        const x = Math.min(a.x, b.x);
        const y = Math.min(a.y, b.y);
        const right = Math.max(a.x + a.width, b.x + b.width);
        const bottom = Math.max(a.y + a.height, b.y + b.height);

        const width = right - x;
        const height = bottom - y;

        if (out) {
            (out as Rect).x = x;
            (out as Rect).y = y;
            (out as Rect).width = width;
            (out as Rect).height = height;
            return out;
        }

        return new Rect(x, y, width, height);
    }

    static containsPoint<T extends IRectLike>(rect: Readonly<T>, px: number, py: number): boolean {
        return px >= rect.x && px < rect.x + rect.width && py >= rect.y && py < rect.y + rect.height;
    }

    static containsRect<T extends IRectLike, U extends IRectLike>(
        outer: Readonly<T>,
        inner: Readonly<U>
    ): boolean {
        return (
            inner.x >= outer.x &&
            inner.y >= outer.y &&
            inner.x + inner.width <= outer.x + outer.width &&
            inner.y + inner.height <= outer.y + outer.height
        );
    }

    static scale<T extends IRectLike>(rect: Readonly<T>, sx: number, sy: number): Rect;
    static scale<T extends IRectLike, V extends IRectLike>(
        rect: Readonly<T>,
        sx: number,
        sy: number,
        out: V
    ): V;
    static scale<T extends IRectLike, V extends IRectLike>(
        rect: Readonly<T>,
        sx: number,
        sy: number,
        out?: V
    ): Rect | V {
        if (out) {
            (out as Rect).x = rect.x * sx;
            (out as Rect).y = rect.y * sy;
            (out as Rect).width = rect.width * sx;
            (out as Rect).height = rect.height * sy;
            return out;
        }

        return new Rect(rect.x * sx, rect.y * sy, rect.width * sx, rect.height * sy);
    }

    static clamp<T extends IRectLike>(rect: Readonly<T>, minX: number, minY: number, maxX: number, maxY: number): Rect;
    static clamp<T extends IRectLike, V extends IRectLike>(
        rect: Readonly<T>,
        minX: number,
        minY: number,
        maxX: number,
        maxY: number,
        out: V
    ): V;
    static clamp<T extends IRectLike, V extends IRectLike>(
        rect: Readonly<T>,
        minX: number,
        minY: number,
        maxX: number,
        maxY: number,
        out?: V
    ): Rect | V {
        const x = Math.max(minX, Math.min(rect.x, maxX));
        const y = Math.max(minY, Math.min(rect.y, maxY));
        const right = Math.min(maxX, Math.max(rect.x + rect.width, minX));
        const bottom = Math.min(maxY, Math.max(rect.y + rect.height, minY));

        const width = Math.max(0, right - x);
        const height = Math.max(0, bottom - y);

        if (out) {
            (out as Rect).x = x;
            (out as Rect).y = y;
            (out as Rect).width = width;
            (out as Rect).height = height;
            return out;
        }

        return new Rect(x, y, width, height);
    }

    static normalize<T extends IRectLike>(rect: Readonly<T>): Rect;
    static normalize<T extends IRectLike, V extends IRectLike>(rect: Readonly<T>, out: V): V;
    static normalize<T extends IRectLike, V extends IRectLike>(rect: Readonly<T>, out?: V): Rect | V {
        if (out) {
            (out as Rect).x = clamp01(rect.x);
            (out as Rect).y = clamp01(rect.y);
            (out as Rect).width = clamp01(rect.width);
            (out as Rect).height = clamp01(rect.height);
            return out;
        }

        return new Rect(clamp01(rect.x), clamp01(rect.y), clamp01(rect.width), clamp01(rect.height));
    }

    static lerp<T extends IRectLike, U extends IRectLike>(
        a: Readonly<T>,
        b: Readonly<U>,
        t: number
    ): Rect;
    static lerp<T extends IRectLike, U extends IRectLike, V extends IRectLike>(
        a: Readonly<T>,
        b: Readonly<U>,
        t: number,
        out: V
    ): V;
    static lerp<T extends IRectLike, U extends IRectLike, V extends IRectLike>(
        a: Readonly<T>,
        b: Readonly<U>,
        t: number,
        out?: V
    ): Rect | V {
        const x = a.x + (b.x - a.x) * t;
        const y = a.y + (b.y - a.y) * t;
        const width = a.width + (b.width - a.width) * t;
        const height = a.height + (b.height - a.height) * t;

        if (out) {
            (out as Rect).x = x;
            (out as Rect).y = y;
            (out as Rect).width = width;
            (out as Rect).height = height;
            return out;
        }

        return new Rect(x, y, width, height);
    }

    intersect<T extends IRectLike>(other: Readonly<T>): Rect | null {
        return Rect.intersect(this, other);
    }

    union<T extends IRectLike>(other: Readonly<T>): Rect {
        return Rect.union(this, other);
    }

    containsPoint(px: number, py: number): boolean {
        return Rect.containsPoint(this, px, py);
    }

    containsRect<T extends IRectLike>(other: Readonly<T>): boolean {
        return Rect.containsRect(this, other);
    }

    scale(sx: number, sy: number): Rect {
        this.x *= sx;
        this.y *= sy;
        this.width *= sx;
        this.height *= sy;
        return this;
    }

    normalize(): Rect {
        this.x = clamp01(this.x);
        this.y = clamp01(this.y);
        this.width = clamp01(this.width);
        this.height = clamp01(this.height);
        return this;
    }

    lerp<T extends IRectLike, U extends IRectLike>(target: Readonly<U>, t: number): Rect;
    lerp(target: Readonly<IRectLike>, t: number): Rect {
        this.x += (target.x - this.x) * t;
        this.y += (target.y - this.y) * t;
        this.width += (target.width - this.width) * t;
        this.height += (target.height - this.height) * t;
        return this;
    }
}

export enum RectComparisonMode {
    LEXICOGRAPHIC,
    AREA,
}

export class RectComparer implements Comparer<Rect> {
    private readonly mode: RectComparisonMode;

    constructor(mode: RectComparisonMode = RectComparisonMode.LEXICOGRAPHIC) {
        this.mode = mode;
    }

    compare(a: Readonly<Rect>, b: Readonly<Rect>): CompareResult {
        switch (this.mode) {
            case RectComparisonMode.LEXICOGRAPHIC:
                if (Math.abs(a.x - b.x) < EPSILON) {
                    if (Math.abs(a.y - b.y) < EPSILON) {
                        if (Math.abs(a.width - b.width) < EPSILON) {
                            if (Math.abs(a.height - b.height) < EPSILON) return 0;
                            return a.height < b.height ? -1 : 1;
                        }
                        return a.width < b.width ? -1 : 1;
                    }
                    return a.y < b.y ? -1 : 1;
                }
                return a.x < b.x ? -1 : 1;

            case RectComparisonMode.AREA: {
                const areaA = a.area;
                const areaB = b.area;
                if (Math.abs(areaA - areaB) < EPSILON) return 0;
                return areaA < areaB ? -1 : 1;
            }

            default:
                throw new Error(`Unsupported Rect comparison mode: ${this.mode}`);
        }
    }
}

export class RectEqualityComparer implements EqualityComparer<Rect> {
    private readonly epsilon: number;

    constructor(epsilon: number = EPSILON) {
        this.epsilon = epsilon;
    }

    equals(a: Readonly<Rect>, b: Readonly<Rect>): boolean {
        if (a === b) return true;
        if (!a || !b) return false;

        return (
            Math.abs(a.x - b.x) < this.epsilon &&
            Math.abs(a.y - b.y) < this.epsilon &&
            Math.abs(a.width - b.width) < this.epsilon &&
            Math.abs(a.height - b.height) < this.epsilon
        );
    }

    hash(obj: Readonly<Rect>): number {
        if (!obj) return 0;
        return new Fnv1a32()
            .updateF32(obj.x)
            .updateF32(obj.y)
            .updateF32(obj.width)
            .updateF32(obj.height)
            .digest();
    }
}
