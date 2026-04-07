import { IVec2Like, IVec3Like, Vec2, Vec3, Mat4, IMat4Like, EPSILON } from '@axrone/numeric';
import { ICloneable, Equatable } from '@axrone/utility';

export type Brand<K, T> = K & { readonly __brand: T };
export type Radians = Brand<number, 'Radians'>;
export type Degrees = Brand<number, 'Degrees'>;

export interface IAABB<T extends IVec2Like | IVec3Like> extends ICloneable<IAABB<T>>, Equatable {
    readonly min: Readonly<T>;
    readonly max: Readonly<T>;
    readonly center: Readonly<T>;
    readonly extents: Readonly<T>;
    readonly size: Readonly<T>;
    readonly volume: number;
    readonly surfaceArea: number;
    readonly isEmpty: boolean;
    readonly dimensions: number;

    containsPoint(point: Readonly<T>): boolean;
    containsAABB(other: Readonly<IAABB<T>>): boolean;
    intersectsAABB(other: Readonly<IAABB<T>>): boolean;

    getIntersection(other: Readonly<IAABB<T>>, out?: IAABB<T>): IAABB<T> | null;
    getUnion(other: Readonly<IAABB<T>>, out?: IAABB<T>): IAABB<T>;
    expand(amount: number | Readonly<T>, out?: IAABB<T>): IAABB<T>;
    transform(matrix: Readonly<IMat4Like>, out?: IAABB<T>): IAABB<T>;

    closestPoint(point: Readonly<T>, out: T): void;
    distanceToPoint(point: Readonly<T>): number;
    squaredDistanceToPoint(point: Readonly<T>): number;
    copy(other: Readonly<IAABB<T>>): void;
    clear(): void;
    toString(): string;
}

export class AABB2D implements IAABB<IVec2Like> {
    protected readonly _min: Vec2;
    protected readonly _max: Vec2;
    protected readonly _center: Vec2;
    protected readonly _extents: Vec2;
    protected readonly _size: Vec2;

    constructor(min?: Readonly<IVec2Like>, max?: Readonly<IVec2Like>) {
        this._min = min ? Vec2.from(min) : Vec2.ZERO.clone();
        this._max = max ? Vec2.from(max) : Vec2.ZERO.clone();
        this._center = Vec2.ZERO.clone();
        this._extents = Vec2.ZERO.clone();
        this._size = Vec2.ZERO.clone();
        this.updateDerivedData();
    }

    static readonly EMPTY: Readonly<AABB2D> = Object.freeze(
        (() => {
            const aabb = new AABB2D();
            aabb.clear();
            return aabb;
        })()
    );

    static from(other: Readonly<IAABB<IVec2Like>>): AABB2D {
        return new AABB2D(other.min, other.max);
    }

    static fromCenterAndExtents(center: Readonly<IVec2Like>, extents: Readonly<IVec2Like>): AABB2D {
        const min = Vec2.subtract(center, extents);
        const max = Vec2.add(center, extents);
        return new AABB2D(min, max);
    }

    static fromPoints(points: readonly IVec2Like[]): AABB2D {
        if (points.length === 0) {
            throw new AABBError('Cannot create AABB from empty points array');
        }

        const first = points[0];
        const result = new AABB2D(first, first);

        for (let i = 1; i < points.length; i++) {
            const point = points[i];
            result._min.x = Math.min(result._min.x, point.x);
            result._min.y = Math.min(result._min.y, point.y);
            result._max.x = Math.max(result._max.x, point.x);
            result._max.y = Math.max(result._max.y, point.y);
        }

        result.updateDerivedData();
        return result;
    }

    get min(): Readonly<IVec2Like> {
        return this._min;
    }
    get max(): Readonly<IVec2Like> {
        return this._max;
    }
    get center(): Readonly<IVec2Like> {
        return this._center;
    }
    get extents(): Readonly<IVec2Like> {
        return this._extents;
    }
    get size(): Readonly<IVec2Like> {
        return this._size;
    }

    get volume(): number {
        return this.isEmpty ? 0 : this._size.x * this._size.y;
    }

    get surfaceArea(): number {
        return this.isEmpty ? 0 : 2 * (this._size.x + this._size.y);
    }

    get isEmpty(): boolean {
        return this._min.x > this._max.x || this._min.y > this._max.y;
    }

    get dimensions(): number {
        return 2;
    }

    private updateDerivedData(): void {
        Vec2.add(this._min, this._max, this._center);
        Vec2.multiplyScalar(this._center, 0.5, this._center);

        Vec2.subtract(this._max, this._min, this._extents);
        Vec2.multiplyScalar(this._extents, 0.5, this._extents);

        Vec2.subtract(this._max, this._min, this._size);
    }

    containsPoint(point: Readonly<IVec2Like>): boolean {
        return (
            point.x >= this._min.x &&
            point.x <= this._max.x &&
            point.y >= this._min.y &&
            point.y <= this._max.y
        );
    }

    containsAABB(other: Readonly<IAABB<IVec2Like>>): boolean {
        return (
            this._min.x <= other.min.x &&
            this._max.x >= other.max.x &&
            this._min.y <= other.min.y &&
            this._max.y >= other.max.y
        );
    }

    intersectsAABB(other: Readonly<IAABB<IVec2Like>>): boolean {
        return (
            this._min.x <= other.max.x &&
            this._max.x >= other.min.x &&
            this._min.y <= other.max.y &&
            this._max.y >= other.min.y
        );
    }

    getIntersection(
        other: Readonly<IAABB<IVec2Like>>,
        out?: IAABB<IVec2Like>
    ): IAABB<IVec2Like> | null {
        if (!this.intersectsAABB(other)) return null;

        const result = out || new AABB2D();
        const resultAABB = result as AABB2D;

        resultAABB._min.x = Math.max(this._min.x, other.min.x);
        resultAABB._min.y = Math.max(this._min.y, other.min.y);
        resultAABB._max.x = Math.min(this._max.x, other.max.x);
        resultAABB._max.y = Math.min(this._max.y, other.max.y);
        resultAABB.updateDerivedData();

        return result;
    }

    getUnion(other: Readonly<IAABB<IVec2Like>>, out?: IAABB<IVec2Like>): IAABB<IVec2Like> {
        const result = out || new AABB2D();
        const resultAABB = result as AABB2D;

        resultAABB._min.x = Math.min(this._min.x, other.min.x);
        resultAABB._min.y = Math.min(this._min.y, other.min.y);
        resultAABB._max.x = Math.max(this._max.x, other.max.x);
        resultAABB._max.y = Math.max(this._max.y, other.max.y);
        resultAABB.updateDerivedData();

        return result;
    }

    expand(amount: number | Readonly<IVec2Like>, out?: IAABB<IVec2Like>): IAABB<IVec2Like> {
        const result = out || this.clone();
        const resultAABB = result as AABB2D;

        if (typeof amount === 'number') {
            resultAABB._min.x = this._min.x - amount;
            resultAABB._min.y = this._min.y - amount;
            resultAABB._max.x = this._max.x + amount;
            resultAABB._max.y = this._max.y + amount;
        } else {
            resultAABB._min.x = this._min.x - amount.x;
            resultAABB._min.y = this._min.y - amount.y;
            resultAABB._max.x = this._max.x + amount.x;
            resultAABB._max.y = this._max.y + amount.y;
        }

        resultAABB.updateDerivedData();
        return result;
    }

    transform(matrix: Readonly<IMat4Like>, out?: IAABB<IVec2Like>): IAABB<IVec2Like> {
        const result = out || new AABB2D();
        const resultAABB = result as AABB2D;

        resultAABB._min.x = Infinity;
        resultAABB._min.y = Infinity;
        resultAABB._max.x = -Infinity;
        resultAABB._max.y = -Infinity;

        const corners = [
            Vec3.create(this._min.x, this._min.y, 0),
            Vec3.create(this._max.x, this._min.y, 0),
            Vec3.create(this._min.x, this._max.y, 0),
            Vec3.create(this._max.x, this._max.y, 0),
        ];

        for (const corner of corners) {
            const transformed = Mat4.transformVec3(corner, matrix);
            resultAABB._min.x = Math.min(resultAABB._min.x, transformed.x);
            resultAABB._min.y = Math.min(resultAABB._min.y, transformed.y);
            resultAABB._max.x = Math.max(resultAABB._max.x, transformed.x);
            resultAABB._max.y = Math.max(resultAABB._max.y, transformed.y);
        }

        resultAABB.updateDerivedData();
        return result;
    }

    closestPoint(point: Readonly<IVec2Like>, out: IVec2Like): void {
        if ('x' in out && 'y' in out) {
            out.x = Math.max(this._min.x, Math.min(this._max.x, point.x));
            out.y = Math.max(this._min.y, Math.min(this._max.y, point.y));
        }
    }

    distanceToPoint(point: Readonly<IVec2Like>): number {
        return Math.sqrt(this.squaredDistanceToPoint(point));
    }

    squaredDistanceToPoint(point: Readonly<IVec2Like>): number {
        let sqDist = 0;

        if (point.x < this._min.x) sqDist += (this._min.x - point.x) ** 2;
        else if (point.x > this._max.x) sqDist += (point.x - this._max.x) ** 2;

        if (point.y < this._min.y) sqDist += (this._min.y - point.y) ** 2;
        else if (point.y > this._max.y) sqDist += (point.y - this._max.y) ** 2;

        return sqDist;
    }

    clone(): IAABB<IVec2Like> {
        const result = new AABB2D();
        result._min.x = this._min.x;
        result._min.y = this._min.y;
        result._max.x = this._max.x;
        result._max.y = this._max.y;
        result.updateDerivedData();
        return result;
    }

    equals(other: unknown): boolean {
        if (!(other instanceof AABB2D)) return false;
        return (
            Math.abs(this._min.x - other._min.x) <= EPSILON &&
            Math.abs(this._min.y - other._min.y) <= EPSILON &&
            Math.abs(this._max.x - other._max.x) <= EPSILON &&
            Math.abs(this._max.y - other._max.y) <= EPSILON
        );
    }

    getHashCode(): number {
        let h1 = 2166136261;
        h1 = Math.imul(h1 ^ Math.floor(this._min.x * 1000), 16777619);
        h1 = Math.imul(h1 ^ Math.floor(this._min.y * 1000), 16777619);
        h1 = Math.imul(h1 ^ Math.floor(this._max.x * 1000), 16777619);
        h1 = Math.imul(h1 ^ Math.floor(this._max.y * 1000), 16777619);
        return h1 >>> 0;
    }

    copy(other: Readonly<IAABB<IVec2Like>>): void {
        this._min.x = other.min.x;
        this._min.y = other.min.y;
        this._max.x = other.max.x;
        this._max.y = other.max.y;
        this.updateDerivedData();
    }

    clear(): void {
        this._min.x = this._min.y = Infinity;
        this._max.x = this._max.y = -Infinity;
        this.updateDerivedData();
    }

    toString(): string {
        return `AABB2D(min: [${this._min.x.toFixed(3)}, ${this._min.y.toFixed(3)}], max: [${this._max.x.toFixed(3)}, ${this._max.y.toFixed(3)}])`;
    }
}

export class AABB3D implements IAABB<IVec3Like> {
    protected readonly _min: Vec3;
    protected readonly _max: Vec3;
    protected readonly _center: Vec3;
    protected readonly _extents: Vec3;
    protected readonly _size: Vec3;

    constructor(min?: Readonly<IVec3Like>, max?: Readonly<IVec3Like>) {
        this._min = min ? Vec3.from(min) : Vec3.ZERO.clone();
        this._max = max ? Vec3.from(max) : Vec3.ZERO.clone();
        this._center = Vec3.ZERO.clone();
        this._extents = Vec3.ZERO.clone();
        this._size = Vec3.ZERO.clone();
        this.updateDerivedData();
    }

    static readonly EMPTY: Readonly<AABB3D> = Object.freeze(
        (() => {
            const aabb = new AABB3D();
            aabb.clear();
            return aabb;
        })()
    );

    static from(other: Readonly<IAABB<IVec3Like>>): AABB3D {
        return new AABB3D(other.min, other.max);
    }

    static fromCenterAndExtents(center: Readonly<IVec3Like>, extents: Readonly<IVec3Like>): AABB3D {
        const min = Vec3.subtract(center, extents);
        const max = Vec3.add(center, extents);
        return new AABB3D(min, max);
    }

    static fromPoints(points: readonly IVec3Like[]): AABB3D {
        if (points.length === 0) {
            throw new AABBError('Cannot create AABB from empty points array');
        }

        const first = points[0];
        const result = new AABB3D(first, first);

        for (let i = 1; i < points.length; i++) {
            const point = points[i];
            result._min.x = Math.min(result._min.x, point.x);
            result._min.y = Math.min(result._min.y, point.y);
            result._min.z = Math.min(result._min.z, point.z);
            result._max.x = Math.max(result._max.x, point.x);
            result._max.y = Math.max(result._max.y, point.y);
            result._max.z = Math.max(result._max.z, point.z);
        }

        result.updateDerivedData();
        return result;
    }

    get min(): Readonly<IVec3Like> {
        return this._min;
    }
    get max(): Readonly<IVec3Like> {
        return this._max;
    }
    get center(): Readonly<IVec3Like> {
        return this._center;
    }
    get extents(): Readonly<IVec3Like> {
        return this._extents;
    }
    get size(): Readonly<IVec3Like> {
        return this._size;
    }

    get volume(): number {
        return this.isEmpty ? 0 : this._size.x * this._size.y * this._size.z;
    }

    get surfaceArea(): number {
        if (this.isEmpty) return 0;
        const { x, y, z } = this._size;
        return 2 * (x * y + y * z + z * x);
    }

    get isEmpty(): boolean {
        return this._min.x > this._max.x || this._min.y > this._max.y || this._min.z > this._max.z;
    }

    get dimensions(): number {
        return 3;
    }

    private updateDerivedData(): void {
        Vec3.add(this._min, this._max, this._center);
        Vec3.multiplyScalar(this._center, 0.5, this._center);

        Vec3.subtract(this._max, this._min, this._extents);
        Vec3.multiplyScalar(this._extents, 0.5, this._extents);

        Vec3.subtract(this._max, this._min, this._size);
    }

    containsPoint(point: Readonly<IVec3Like>): boolean {
        return (
            point.x >= this._min.x &&
            point.x <= this._max.x &&
            point.y >= this._min.y &&
            point.y <= this._max.y &&
            point.z >= this._min.z &&
            point.z <= this._max.z
        );
    }

    containsAABB(other: Readonly<IAABB<IVec3Like>>): boolean {
        return (
            this._min.x <= other.min.x &&
            this._max.x >= other.max.x &&
            this._min.y <= other.min.y &&
            this._max.y >= other.max.y &&
            this._min.z <= other.min.z &&
            this._max.z >= other.max.z
        );
    }

    intersectsAABB(other: Readonly<IAABB<IVec3Like>>): boolean {
        return (
            this._min.x <= other.max.x &&
            this._max.x >= other.min.x &&
            this._min.y <= other.max.y &&
            this._max.y >= other.min.y &&
            this._min.z <= other.max.z &&
            this._max.z >= other.min.z
        );
    }

    getIntersection(
        other: Readonly<IAABB<IVec3Like>>,
        out?: IAABB<IVec3Like>
    ): IAABB<IVec3Like> | null {
        if (!this.intersectsAABB(other)) return null;

        const result = out || new AABB3D();
        const resultAABB = result as AABB3D;

        resultAABB._min.x = Math.max(this._min.x, other.min.x);
        resultAABB._min.y = Math.max(this._min.y, other.min.y);
        resultAABB._min.z = Math.max(this._min.z, other.min.z);
        resultAABB._max.x = Math.min(this._max.x, other.max.x);
        resultAABB._max.y = Math.min(this._max.y, other.max.y);
        resultAABB._max.z = Math.min(this._max.z, other.max.z);
        resultAABB.updateDerivedData();

        return result;
    }

    getUnion(other: Readonly<IAABB<IVec3Like>>, out?: IAABB<IVec3Like>): IAABB<IVec3Like> {
        const result = out || new AABB3D();
        const resultAABB = result as AABB3D;

        resultAABB._min.x = Math.min(this._min.x, other.min.x);
        resultAABB._min.y = Math.min(this._min.y, other.min.y);
        resultAABB._min.z = Math.min(this._min.z, other.min.z);
        resultAABB._max.x = Math.max(this._max.x, other.max.x);
        resultAABB._max.y = Math.max(this._max.y, other.max.y);
        resultAABB._max.z = Math.max(this._max.z, other.max.z);
        resultAABB.updateDerivedData();

        return result;
    }

    expand(amount: number | Readonly<IVec3Like>, out?: IAABB<IVec3Like>): IAABB<IVec3Like> {
        const result = out || this.clone();
        const resultAABB = result as AABB3D;

        if (typeof amount === 'number') {
            resultAABB._min.x = this._min.x - amount;
            resultAABB._min.y = this._min.y - amount;
            resultAABB._min.z = this._min.z - amount;
            resultAABB._max.x = this._max.x + amount;
            resultAABB._max.y = this._max.y + amount;
            resultAABB._max.z = this._max.z + amount;
        } else {
            resultAABB._min.x = this._min.x - amount.x;
            resultAABB._min.y = this._min.y - amount.y;
            resultAABB._min.z = this._min.z - amount.z;
            resultAABB._max.x = this._max.x + amount.x;
            resultAABB._max.y = this._max.y + amount.y;
            resultAABB._max.z = this._max.z + amount.z;
        }

        resultAABB.updateDerivedData();
        return result;
    }

    transform(matrix: Readonly<IMat4Like>, out?: IAABB<IVec3Like>): IAABB<IVec3Like> {
        const result = out || new AABB3D();
        const resultAABB = result as AABB3D;

        resultAABB._min.x = Infinity;
        resultAABB._min.y = Infinity;
        resultAABB._min.z = Infinity;
        resultAABB._max.x = -Infinity;
        resultAABB._max.y = -Infinity;
        resultAABB._max.z = -Infinity;

        const corners = [
            Vec3.create(this._min.x, this._min.y, this._min.z),
            Vec3.create(this._max.x, this._min.y, this._min.z),
            Vec3.create(this._min.x, this._max.y, this._min.z),
            Vec3.create(this._max.x, this._max.y, this._min.z),
            Vec3.create(this._min.x, this._min.y, this._max.z),
            Vec3.create(this._max.x, this._min.y, this._max.z),
            Vec3.create(this._min.x, this._max.y, this._max.z),
            Vec3.create(this._max.x, this._max.y, this._max.z),
        ];

        for (const corner of corners) {
            const transformed = Mat4.transformVec3(corner, matrix);
            resultAABB._min.x = Math.min(resultAABB._min.x, transformed.x);
            resultAABB._min.y = Math.min(resultAABB._min.y, transformed.y);
            resultAABB._min.z = Math.min(resultAABB._min.z, transformed.z);
            resultAABB._max.x = Math.max(resultAABB._max.x, transformed.x);
            resultAABB._max.y = Math.max(resultAABB._max.y, transformed.y);
            resultAABB._max.z = Math.max(resultAABB._max.z, transformed.z);
        }

        resultAABB.updateDerivedData();
        return result;
    }

    closestPoint(point: Readonly<IVec3Like>, out: IVec3Like): void {
        if ('x' in out && 'y' in out && 'z' in out) {
            out.x = Math.max(this._min.x, Math.min(this._max.x, point.x));
            out.y = Math.max(this._min.y, Math.min(this._max.y, point.y));
            out.z = Math.max(this._min.z, Math.min(this._max.z, point.z));
        }
    }

    distanceToPoint(point: Readonly<IVec3Like>): number {
        return Math.sqrt(this.squaredDistanceToPoint(point));
    }

    squaredDistanceToPoint(point: Readonly<IVec3Like>): number {
        let sqDist = 0;

        if (point.x < this._min.x) sqDist += (this._min.x - point.x) ** 2;
        else if (point.x > this._max.x) sqDist += (point.x - this._max.x) ** 2;

        if (point.y < this._min.y) sqDist += (this._min.y - point.y) ** 2;
        else if (point.y > this._max.y) sqDist += (point.y - this._max.y) ** 2;

        if (point.z < this._min.z) sqDist += (this._min.z - point.z) ** 2;
        else if (point.z > this._max.z) sqDist += (point.z - this._max.z) ** 2;

        return sqDist;
    }

    clone(): IAABB<IVec3Like> {
        const result = new AABB3D();
        result._min.x = this._min.x;
        result._min.y = this._min.y;
        result._min.z = this._min.z;
        result._max.x = this._max.x;
        result._max.y = this._max.y;
        result._max.z = this._max.z;
        result.updateDerivedData();
        return result;
    }

    equals(other: unknown): boolean {
        if (!(other instanceof AABB3D)) return false;
        return (
            Math.abs(this._min.x - other._min.x) <= EPSILON &&
            Math.abs(this._min.y - other._min.y) <= EPSILON &&
            Math.abs(this._min.z - other._min.z) <= EPSILON &&
            Math.abs(this._max.x - other._max.x) <= EPSILON &&
            Math.abs(this._max.y - other._max.y) <= EPSILON &&
            Math.abs(this._max.z - other._max.z) <= EPSILON
        );
    }

    getHashCode(): number {
        let h1 = 2166136261;
        h1 = Math.imul(h1 ^ Math.floor(this._min.x * 1000), 16777619);
        h1 = Math.imul(h1 ^ Math.floor(this._min.y * 1000), 16777619);
        h1 = Math.imul(h1 ^ Math.floor(this._min.z * 1000), 16777619);
        h1 = Math.imul(h1 ^ Math.floor(this._max.x * 1000), 16777619);
        h1 = Math.imul(h1 ^ Math.floor(this._max.y * 1000), 16777619);
        h1 = Math.imul(h1 ^ Math.floor(this._max.z * 1000), 16777619);
        return h1 >>> 0;
    }

    copy(other: Readonly<IAABB<IVec3Like>>): void {
        this._min.x = other.min.x;
        this._min.y = other.min.y;
        this._min.z = other.min.z;
        this._max.x = other.max.x;
        this._max.y = other.max.y;
        this._max.z = other.max.z;
        this.updateDerivedData();
    }

    clear(): void {
        this._min.x = this._min.y = this._min.z = Infinity;
        this._max.x = this._max.y = this._max.z = -Infinity;
        this.updateDerivedData();
    }

    toString(): string {
        return `AABB3D(min: [${this._min.x.toFixed(3)}, ${this._min.y.toFixed(3)}, ${this._min.z.toFixed(3)}], max: [${this._max.x.toFixed(3)}, ${this._max.y.toFixed(3)}, ${this._max.z.toFixed(3)}])`;
    }
}

export namespace AABB {
    export function create2D(min?: Readonly<IVec2Like>, max?: Readonly<IVec2Like>): AABB2D {
        return new AABB2D(min, max);
    }

    export function create3D(min?: Readonly<IVec3Like>, max?: Readonly<IVec3Like>): AABB3D {
        return new AABB3D(min, max);
    }

    export function fromCenterAndExtents2D(
        center: Readonly<IVec2Like>,
        extents: Readonly<IVec2Like>
    ): AABB2D {
        return AABB2D.fromCenterAndExtents(center, extents);
    }

    export function fromCenterAndExtents3D(
        center: Readonly<IVec3Like>,
        extents: Readonly<IVec3Like>
    ): AABB3D {
        return AABB3D.fromCenterAndExtents(center, extents);
    }

    export function fromPoints2D(points: readonly IVec2Like[]): AABB2D {
        return AABB2D.fromPoints(points);
    }

    export function fromPoints3D(points: readonly IVec3Like[]): AABB3D {
        return AABB3D.fromPoints(points);
    }

    export function fromPoints<T extends readonly IVec2Like[]>(points: T): AABB2D;
    export function fromPoints<T extends readonly IVec3Like[]>(points: T): AABB3D;
    export function fromPoints<T extends readonly (IVec2Like | IVec3Like)[]>(
        points: T
    ): T extends readonly IVec2Like[] ? AABB2D : AABB3D {
        if (points.length === 0) {
            throw new AABBError('Cannot create AABB from empty points array');
        }

        const first = points[0];
        const isVec3 = 'z' in first;

        return (
            isVec3
                ? AABB3D.fromPoints(points as readonly IVec3Like[])
                : AABB2D.fromPoints(points as readonly IVec2Like[])
        ) as any;
    }

    export function unionAll2D(aabbs: readonly AABB2D[], out?: AABB2D): AABB2D {
        if (aabbs.length === 0) {
            throw new AABBError('Cannot compute union of empty AABB array');
        }

        const result = out || new AABB2D();

        result.copy(aabbs[0]);

        for (let i = 1; i < aabbs.length; i++) {
            result.getUnion(aabbs[i], result);
        }

        return result;
    }

    export function unionAll3D(aabbs: readonly AABB3D[], out?: AABB3D): AABB3D {
        if (aabbs.length === 0) {
            throw new AABBError('Cannot compute union of empty AABB array');
        }

        const result = out || new AABB3D();

        result.copy(aabbs[0]);

        for (let i = 1; i < aabbs.length; i++) {
            result.getUnion(aabbs[i], result);
        }

        return result;
    }
}

export class AABBError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'AABBError';
        Object.setPrototypeOf(this, AABBError.prototype);
    }
}
