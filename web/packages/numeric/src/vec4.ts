import { Comparer, CompareResult, EqualityComparer, Equatable, ICloneable } from '@axrone/utility';
import { EPSILON, HALF_PI, PI_2 } from './common';
import { clampNegOneOne, clamp01 } from './clamp';
import {
    sampleStandardNormal,
    sampleNormalInRange,
    sampleUniform,
    sampleUniformRange,
} from './box-muller';

export interface IVec4Like {
    x: number;
    y: number;
    z: number;
    w: number;
}

export class Vec4 implements IVec4Like, ICloneable<Vec4>, Equatable {
    constructor(
        public x: number = 0,
        public y: number = 0,
        public z: number = 0,
        public w: number = 0
    ) {}

    static readonly ZERO: Readonly<Vec4> = Object.freeze(new Vec4(0, 0, 0, 0));
    static readonly ONE: Readonly<Vec4> = Object.freeze(new Vec4(1, 1, 1, 1));
    static readonly NEG_ONE: Readonly<Vec4> = Object.freeze(new Vec4(-1, -1, -1, -1));
    static readonly UNIT_X: Readonly<Vec4> = Object.freeze(new Vec4(1, 0, 0, 0));
    static readonly UNIT_Y: Readonly<Vec4> = Object.freeze(new Vec4(0, 1, 0, 0));
    static readonly UNIT_Z: Readonly<Vec4> = Object.freeze(new Vec4(0, 0, 1, 0));
    static readonly UNIT_W: Readonly<Vec4> = Object.freeze(new Vec4(0, 0, 0, 1));

    static from<T extends IVec4Like>(v: Readonly<T>): Vec4 {
        return new Vec4(v.x, v.y, v.z, v.w);
    }

    static fromArray(arr: ArrayLike<number>, offset: number = 0): Vec4 {
        if (offset < 0) {
            throw new RangeError('Offset cannot be negative');
        }

        if (arr.length < offset + 4) {
            throw new RangeError(
                `Array must have at least ${offset + 4} elements when using offset ${offset}`
            );
        }

        return new Vec4(
            Number(arr[offset]),
            Number(arr[offset + 1]),
            Number(arr[offset + 2]),
            Number(arr[offset + 3])
        );
    }

    static create(x: number = 0, y: number = 0, z: number = 0, w: number = 0): Vec4 {
        return new Vec4(x, y, z, w);
    }

    clone(): Vec4 {
        return new Vec4(this.x, this.y, this.z, this.w);
    }

    equals(other: unknown): boolean {
        if (!(other instanceof Vec4)) return false;

        return (
            Math.abs(this.x - other.x) < EPSILON &&
            Math.abs(this.y - other.y) < EPSILON &&
            Math.abs(this.z - other.z) < EPSILON &&
            Math.abs(this.w - other.w) < EPSILON
        );
    }

    getHashCode(): number {
        let h1 = 2166136261;
        h1 = Math.imul(h1 ^ Math.floor(this.x * 1000), 16777619);
        h1 = Math.imul(h1 ^ Math.floor(this.y * 1000), 16777619);
        h1 = Math.imul(h1 ^ Math.floor(this.z * 1000), 16777619);
        h1 = Math.imul(h1 ^ Math.floor(this.w * 1000), 16777619);
        return h1 >>> 0;
    }

    static add<T extends IVec4Like, U extends IVec4Like, V extends IVec4Like>(
        a: Readonly<T>,
        b: Readonly<U>,
        out?: V
    ): V {
        if (out) {
            out.x = a.x + b.x;
            out.y = a.y + b.y;
            out.z = a.z + b.z;
            out.w = a.w + b.w;
            return out;
        } else {
            return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z, w: a.w + b.w } as V;
        }
    }

    static addScalar<T extends IVec4Like, V extends IVec4Like>(
        a: Readonly<T>,
        b: number,
        out?: V
    ): V {
        if (out) {
            out.x = a.x + b;
            out.y = a.y + b;
            out.z = a.z + b;
            out.w = a.w + b;
            return out;
        } else {
            return { x: a.x + b, y: a.y + b, z: a.z + b, w: a.w + b } as V;
        }
    }

    static subtract<T extends IVec4Like, U extends IVec4Like, V extends IVec4Like>(
        a: Readonly<T>,
        b: Readonly<U>,
        out?: V
    ): V {
        if (out) {
            out.x = a.x - b.x;
            out.y = a.y - b.y;
            out.z = a.z - b.z;
            out.w = a.w - b.w;
            return out;
        } else {
            return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z, w: a.w - b.w } as V;
        }
    }

    static subtractScalar<T extends IVec4Like, V extends IVec4Like>(
        a: Readonly<T>,
        b: number,
        out?: V
    ): V {
        if (out) {
            out.x = a.x - b;
            out.y = a.y - b;
            out.z = a.z - b;
            out.w = a.w - b;
            return out;
        } else {
            return { x: a.x - b, y: a.y - b, z: a.z - b, w: a.w - b } as V;
        }
    }

    static multiply<T extends IVec4Like, U extends IVec4Like, V extends IVec4Like>(
        a: Readonly<T>,
        b: Readonly<U>,
        out?: V
    ): V {
        if (out) {
            out.x = a.x * b.x;
            out.y = a.y * b.y;
            out.z = a.z * b.z;
            out.w = a.w * b.w;
            return out;
        } else {
            return { x: a.x * b.x, y: a.y * b.y, z: a.z * b.z, w: a.w * b.w } as V;
        }
    }

    static multiplyScalar<T extends IVec4Like, V extends IVec4Like>(
        a: Readonly<T>,
        b: number,
        out?: V
    ): V {
        if (out) {
            out.x = a.x * b;
            out.y = a.y * b;
            out.z = a.z * b;
            out.w = a.w * b;
            return out;
        } else {
            return { x: a.x * b, y: a.y * b, z: a.z * b, w: a.w * b } as V;
        }
    }

    static divide<T extends IVec4Like, U extends IVec4Like, V extends IVec4Like>(
        a: Readonly<T>,
        b: Readonly<U>,
        out?: V
    ): V {
        if (
            Math.abs(b.x) < EPSILON ||
            Math.abs(b.y) < EPSILON ||
            Math.abs(b.z) < EPSILON ||
            Math.abs(b.w) < EPSILON
        ) {
            throw new Error('Division by zero or near-zero value is not allowed');
        }

        if (out) {
            out.x = a.x / b.x;
            out.y = a.y / b.y;
            out.z = a.z / b.z;
            out.w = a.w / b.w;
            return out;
        } else {
            return { x: a.x / b.x, y: a.y / b.y, z: a.z / b.z, w: a.w / b.w } as V;
        }
    }

    static divideScalar<T extends IVec4Like, V extends IVec4Like>(
        a: Readonly<T>,
        b: number,
        out?: V
    ): V {
        if (Math.abs(b) < EPSILON) {
            throw new Error('Division by zero or near-zero value is not allowed');
        }

        if (out) {
            out.x = a.x / b;
            out.y = a.y / b;
            out.z = a.z / b;
            out.w = a.w / b;
            return out;
        } else {
            return { x: a.x / b, y: a.y / b, z: a.z / b, w: a.w / b } as V;
        }
    }

    static negate<T extends IVec4Like, V extends IVec4Like>(a: Readonly<T>, out?: V): V {
        if (out) {
            out.x = a.x === 0 ? 0 : -a.x;
            out.y = a.y === 0 ? 0 : -a.y;
            out.z = a.z === 0 ? 0 : -a.z;
            out.w = a.w === 0 ? 0 : -a.w;
            return out;
        } else {
            return {
                x: a.x === 0 ? 0 : -a.x,
                y: a.y === 0 ? 0 : -a.y,
                z: a.z === 0 ? 0 : -a.z,
                w: a.w === 0 ? 0 : -a.w,
            } as V;
        }
    }

    static inverse<T extends IVec4Like, V extends IVec4Like>(a: Readonly<T>, out?: V): V {
        if (out) {
            out.x = 1 / a.x;
            out.y = 1 / a.y;
            out.z = 1 / a.z;
            out.w = 1 / a.w;
            return out;
        } else {
            return { x: 1 / a.x, y: 1 / a.y, z: 1 / a.z, w: 1 / a.w } as V;
        }
    }

    static inverseSafe<T extends IVec4Like, V extends IVec4Like>(
        v: Readonly<T>,
        out?: V,
        defaultValue = 0
    ): V {
        const vx = v.x;
        const vy = v.y;
        const vz = v.z;
        const vw = v.w;

        if (
            Math.abs(vx) < EPSILON ||
            Math.abs(vy) < EPSILON ||
            Math.abs(vz) < EPSILON ||
            Math.abs(vw) < EPSILON
        ) {
            throw new Error('Inversion of zero or near-zero value');
        }

        if (out) {
            out.x = Math.abs(vx) < EPSILON ? defaultValue : 1 / vx;
            out.y = Math.abs(vy) < EPSILON ? defaultValue : 1 / vy;
            out.z = Math.abs(vz) < EPSILON ? defaultValue : 1 / vz;
            out.w = Math.abs(vw) < EPSILON ? defaultValue : 1 / vw;
            return out;
        } else {
            return {
                x: Math.abs(vx) < EPSILON ? defaultValue : 1 / vx,
                y: Math.abs(vy) < EPSILON ? defaultValue : 1 / vy,
                z: Math.abs(vz) < EPSILON ? defaultValue : 1 / vz,
                w: Math.abs(vw) < EPSILON ? defaultValue : 1 / vw,
            } as V;
        }
    }

    static dot<T extends IVec4Like, U extends IVec4Like>(a: Readonly<T>, b: Readonly<U>): number {
        return a.x * b.x + a.y * b.y + a.z * b.z + a.w * b.w;
    }

    // 4D cross product - returns a bivector represented as 6 components
    // For simplicity, we provide only xyz cross product ignoring w
    static cross3D<T extends IVec4Like, U extends IVec4Like, V extends IVec4Like>(
        a: Readonly<T>,
        b: Readonly<U>,
        out?: V
    ): V {
        const x = a.y * b.z - a.z * b.y;
        const y = a.z * b.x - a.x * b.z;
        const z = a.x * b.y - a.y * b.x;

        if (out) {
            out.x = x;
            out.y = y;
            out.z = z;
            out.w = 0;
            return out;
        } else {
            return { x, y, z, w: 0 } as V;
        }
    }

    static len<T extends IVec4Like>(v: Readonly<T>): number {
        return Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z + v.w * v.w);
    }

    static lengthSquared<T extends IVec4Like>(v: Readonly<T>): number {
        return v.x * v.x + v.y * v.y + v.z * v.z + v.w * v.w;
    }

    static fastLength<T extends IVec4Like>(v: Readonly<T>): number {
        const ax = Math.abs(v.x);
        const ay = Math.abs(v.y);
        const az = Math.abs(v.z);
        const aw = Math.abs(v.w);

        const values = [ax, ay, az, aw].sort((a, b) => b - a);
        return values[0] + 0.4 * values[1] + 0.2 * values[2] + 0.1 * values[3];
    }

    static normalize<T extends IVec4Like, U extends IVec4Like>(v: Readonly<T>, out?: U): U {
        const length = Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z + v.w * v.w);
        if (length < EPSILON) {
            throw new Error('Cannot normalize a zero-length vector');
        }

        if (out) {
            out.x = v.x / length;
            out.y = v.y / length;
            out.z = v.z / length;
            out.w = v.w / length;
            return out;
        } else {
            return {
                x: v.x / length,
                y: v.y / length,
                z: v.z / length,
                w: v.w / length,
            } as U;
        }
    }

    static normalizeQuake<T extends IVec4Like>(v: Readonly<T>, out?: T): T {
        const vx = v.x;
        const vy = v.y;
        const vz = v.z;
        const vw = v.w;
        const lenSq = vx * vx + vy * vy + vz * vz + vw * vw;
        if (lenSq < EPSILON) {
            throw new Error('Cannot normalize a zero-length vector');
        }

        let i = 0;
        const buf = new ArrayBuffer(4);
        const view = new DataView(buf);
        view.setFloat32(0, lenSq);
        i = view.getInt32(0);
        i = 0x5f3759df - (i >> 1);
        view.setInt32(0, i);
        let invLen = view.getFloat32(0);
        invLen = invLen * (1.5 - lenSq * 0.5 * invLen * invLen);

        if (out) {
            out.x = vx * invLen;
            out.y = vy * invLen;
            out.z = vz * invLen;
            out.w = vw * invLen;
            return out;
        } else {
            return {
                x: vx * invLen,
                y: vy * invLen,
                z: vz * invLen,
                w: vw * invLen,
            } as T;
        }
    }

    static distanceSquared<T extends IVec4Like, U extends IVec4Like>(
        a: Readonly<T>,
        b: Readonly<U>
    ): number {
        const dx = a.x - b.x;
        const dy = a.y - b.y;
        const dz = a.z - b.z;
        const dw = a.w - b.w;
        return dx * dx + dy * dy + dz * dz + dw * dw;
    }

    static distance<T extends IVec4Like, U extends IVec4Like>(
        a: Readonly<T>,
        b: Readonly<U>
    ): number {
        const dx = a.x - b.x;
        const dy = a.y - b.y;
        const dz = a.z - b.z;
        const dw = a.w - b.w;
        return Math.sqrt(dx * dx + dy * dy + dz * dz + dw * dw);
    }

    static distanceFast<T extends IVec4Like, U extends IVec4Like>(
        a: Readonly<T>,
        b: Readonly<U>
    ): number {
        const dx = Math.abs(a.x - b.x);
        const dy = Math.abs(a.y - b.y);
        const dz = Math.abs(a.z - b.z);
        const dw = Math.abs(a.w - b.w);

        const values = [dx, dy, dz, dw].sort((a, b) => b - a);
        return values[0] + 0.4 * values[1] + 0.2 * values[2] + 0.1 * values[3];
    }

    static manhattanDistance<T extends IVec4Like, U extends IVec4Like>(
        a: Readonly<T>,
        b: Readonly<U>
    ): number {
        return (
            Math.abs(a.x - b.x) + Math.abs(a.y - b.y) + Math.abs(a.z - b.z) + Math.abs(a.w - b.w)
        );
    }

    static chebyshevDistance<T extends IVec4Like, U extends IVec4Like>(
        a: Readonly<T>,
        b: Readonly<U>
    ): number {
        return Math.max(
            Math.abs(a.x - b.x),
            Math.abs(a.y - b.y),
            Math.abs(a.z - b.z),
            Math.abs(a.w - b.w)
        );
    }

    static angleBetween<T extends IVec4Like, U extends IVec4Like>(
        a: Readonly<T>,
        b: Readonly<U>
    ): number {
        const dotProduct = Vec4.dot(a, b);
        const lengthA = Vec4.len(a);
        const lengthB = Vec4.len(b);

        if (lengthA < EPSILON || lengthB < EPSILON) {
            throw new Error('Cannot calculate angle with zero-length vector');
        }

        const cosTheta = dotProduct / (lengthA * lengthB);
        return Math.acos(clampNegOneOne(cosTheta));
    }

    static angle2Deg<T extends IVec4Like, U extends IVec4Like>(
        a: Readonly<T>,
        b: Readonly<U>
    ): number {
        const angle = Vec4.angleBetween(a, b);
        return (angle * 180) / Math.PI;
    }

    // 4D rotation in XY plane
    static rotateXY<T extends IVec4Like>(v: Readonly<T>, angle: number, out?: T): T {
        const cos = Math.cos(angle);
        const sin = Math.sin(angle);

        if (out) {
            out.x = v.x * cos - v.y * sin;
            out.y = v.x * sin + v.y * cos;
            out.z = v.z;
            out.w = v.w;
            return out;
        } else {
            return {
                x: v.x * cos - v.y * sin,
                y: v.x * sin + v.y * cos,
                z: v.z,
                w: v.w,
            } as T;
        }
    }

    // 4D rotation in XZ plane
    static rotateXZ<T extends IVec4Like>(v: Readonly<T>, angle: number, out?: T): T {
        const cos = Math.cos(angle);
        const sin = Math.sin(angle);

        if (out) {
            out.x = v.x * cos + v.z * sin;
            out.y = v.y;
            out.z = -v.x * sin + v.z * cos;
            out.w = v.w;
            return out;
        } else {
            return {
                x: v.x * cos + v.z * sin,
                y: v.y,
                z: -v.x * sin + v.z * cos,
                w: v.w,
            } as T;
        }
    }

    // 4D rotation in XW plane
    static rotateXW<T extends IVec4Like>(v: Readonly<T>, angle: number, out?: T): T {
        const cos = Math.cos(angle);
        const sin = Math.sin(angle);

        if (out) {
            out.x = v.x * cos - v.w * sin;
            out.y = v.y;
            out.z = v.z;
            out.w = v.x * sin + v.w * cos;
            return out;
        } else {
            return {
                x: v.x * cos - v.w * sin,
                y: v.y,
                z: v.z,
                w: v.x * sin + v.w * cos,
            } as T;
        }
    }

    // 4D rotation in YZ plane
    static rotateYZ<T extends IVec4Like>(v: Readonly<T>, angle: number, out?: T): T {
        const cos = Math.cos(angle);
        const sin = Math.sin(angle);

        if (out) {
            out.x = v.x;
            out.y = v.y * cos - v.z * sin;
            out.z = v.y * sin + v.z * cos;
            out.w = v.w;
            return out;
        } else {
            return {
                x: v.x,
                y: v.y * cos - v.z * sin,
                z: v.y * sin + v.z * cos,
                w: v.w,
            } as T;
        }
    }

    // 4D rotation in YW plane
    static rotateYW<T extends IVec4Like>(v: Readonly<T>, angle: number, out?: T): T {
        const cos = Math.cos(angle);
        const sin = Math.sin(angle);

        if (out) {
            out.x = v.x;
            out.y = v.y * cos - v.w * sin;
            out.z = v.z;
            out.w = v.y * sin + v.w * cos;
            return out;
        } else {
            return {
                x: v.x,
                y: v.y * cos - v.w * sin,
                z: v.z,
                w: v.y * sin + v.w * cos,
            } as T;
        }
    }

    // 4D rotation in ZW plane
    static rotateZW<T extends IVec4Like>(v: Readonly<T>, angle: number, out?: T): T {
        const cos = Math.cos(angle);
        const sin = Math.sin(angle);

        if (out) {
            out.x = v.x;
            out.y = v.y;
            out.z = v.z * cos - v.w * sin;
            out.w = v.z * sin + v.w * cos;
            return out;
        } else {
            return {
                x: v.x,
                y: v.y,
                z: v.z * cos - v.w * sin,
                w: v.z * sin + v.w * cos,
            } as T;
        }
    }

    static lerp<T extends IVec4Like, U extends IVec4Like, V extends IVec4Like>(
        a: Readonly<T>,
        b: Readonly<U>,
        t: number,
        out?: V
    ): V {
        const t1 = clamp01(t);
        if (out) {
            out.x = a.x + (b.x - a.x) * t1;
            out.y = a.y + (b.y - a.y) * t1;
            out.z = a.z + (b.z - a.z) * t1;
            out.w = a.w + (b.w - a.w) * t1;
            return out;
        } else {
            return {
                x: a.x + (b.x - a.x) * t1,
                y: a.y + (b.y - a.y) * t1,
                z: a.z + (b.z - a.z) * t1,
                w: a.w + (b.w - a.w) * t1,
            } as V;
        }
    }

    static lerpUnClamped<T extends IVec4Like, U extends IVec4Like, V extends IVec4Like>(
        a: Readonly<T>,
        b: Readonly<U>,
        t: number,
        out?: V
    ): V {
        if (out) {
            out.x = a.x + (b.x - a.x) * t;
            out.y = a.y + (b.y - a.y) * t;
            out.z = a.z + (b.z - a.z) * t;
            out.w = a.w + (b.w - a.w) * t;
            return out;
        } else {
            return {
                x: a.x + (b.x - a.x) * t,
                y: a.y + (b.y - a.y) * t,
                z: a.z + (b.z - a.z) * t,
                w: a.w + (b.w - a.w) * t,
            } as V;
        }
    }

    static slerp<T extends IVec4Like, U extends IVec4Like, V extends IVec4Like>(
        a: Readonly<T>,
        b: Readonly<U>,
        t: number,
        out?: V
    ): V {
        const t1 = clamp01(t);

        const dotProduct = Vec4.dot(a, b);
        const lenA = Vec4.len(a);
        const lenB = Vec4.len(b);

        if (lenA < EPSILON || lenB < EPSILON) {
            return Vec4.lerp(a, b, t1, out);
        }

        const cosTheta = dotProduct / (lenA * lenB);
        const theta = Math.acos(clampNegOneOne(cosTheta));

        if (Math.abs(theta) < EPSILON) {
            return Vec4.lerp(a, b, t1, out);
        }

        const sinTheta = Math.sin(theta);
        const ratioA = Math.sin((1 - t1) * theta) / sinTheta;
        const ratioB = Math.sin(t1 * theta) / sinTheta;

        if (out) {
            out.x = ratioA * a.x + ratioB * b.x;
            out.y = ratioA * a.y + ratioB * b.y;
            out.z = ratioA * a.z + ratioB * b.z;
            out.w = ratioA * a.w + ratioB * b.w;
            return out;
        } else {
            return {
                x: ratioA * a.x + ratioB * b.x,
                y: ratioA * a.y + ratioB * b.y,
                z: ratioA * a.z + ratioB * b.z,
                w: ratioA * a.w + ratioB * b.w,
            } as V;
        }
    }

    static smoothStep<T extends IVec4Like, U extends IVec4Like, V extends IVec4Like>(
        a: Readonly<T>,
        b: Readonly<U>,
        t: number,
        out?: V
    ): V {
        const t1 = clamp01(t);
        const t2 = t1 * t1 * (3 - 2 * t1);
        if (out) {
            out.x = a.x + (b.x - a.x) * t2;
            out.y = a.y + (b.y - a.y) * t2;
            out.z = a.z + (b.z - a.z) * t2;
            out.w = a.w + (b.w - a.w) * t2;
            return out;
        } else {
            return {
                x: a.x + (b.x - a.x) * t2,
                y: a.y + (b.y - a.y) * t2,
                z: a.z + (b.z - a.z) * t2,
                w: a.w + (b.w - a.w) * t2,
            } as V;
        }
    }

    static smootherStep<T extends IVec4Like, U extends IVec4Like, V extends IVec4Like>(
        a: Readonly<T>,
        b: Readonly<U>,
        t: number,
        out?: V
    ): V {
        const t1 = clamp01(t);
        const t2 = t1 * t1 * t1 * (10 - 15 * t1 + 6 * t1 * t1);
        if (out) {
            out.x = a.x + (b.x - a.x) * t2;
            out.y = a.y + (b.y - a.y) * t2;
            out.z = a.z + (b.z - a.z) * t2;
            out.w = a.w + (b.w - a.w) * t2;
            return out;
        } else {
            return {
                x: a.x + (b.x - a.x) * t2,
                y: a.y + (b.y - a.y) * t2,
                z: a.z + (b.z - a.z) * t2,
                w: a.w + (b.w - a.w) * t2,
            } as V;
        }
    }

    static cubicBezier<
        T extends IVec4Like,
        U extends IVec4Like,
        V extends IVec4Like,
        W extends IVec4Like,
        O extends IVec4Like,
    >(a: Readonly<T>, c1: Readonly<U>, c2: Readonly<V>, b: Readonly<W>, t: number, out?: O): O {
        const t1 = clamp01(t);
        const oneMinusT = 1 - t1;
        const oneMinusT2 = oneMinusT * oneMinusT;
        const t2 = t1 * t1;

        const oneMinusT3 = oneMinusT2 * oneMinusT;
        const t3 = t2 * t1;
        const oneMinusT2_3t = oneMinusT2 * 3 * t1;
        const oneMinusT_3t2 = oneMinusT * 3 * t2;

        if (out) {
            out.x = oneMinusT3 * a.x + oneMinusT2_3t * c1.x + oneMinusT_3t2 * c2.x + t3 * b.x;
            out.y = oneMinusT3 * a.y + oneMinusT2_3t * c1.y + oneMinusT_3t2 * c2.y + t3 * b.y;
            out.z = oneMinusT3 * a.z + oneMinusT2_3t * c1.z + oneMinusT_3t2 * c2.z + t3 * b.z;
            out.w = oneMinusT3 * a.w + oneMinusT2_3t * c1.w + oneMinusT_3t2 * c2.w + t3 * b.w;
            return out;
        } else {
            return {
                x: oneMinusT3 * a.x + oneMinusT2_3t * c1.x + oneMinusT_3t2 * c2.x + t3 * b.x,
                y: oneMinusT3 * a.y + oneMinusT2_3t * c1.y + oneMinusT_3t2 * c2.y + t3 * b.y,
                z: oneMinusT3 * a.z + oneMinusT2_3t * c1.z + oneMinusT_3t2 * c2.z + t3 * b.z,
                w: oneMinusT3 * a.w + oneMinusT2_3t * c1.w + oneMinusT_3t2 * c2.w + t3 * b.w,
            } as O;
        }
    }

    static hermite<
        T extends IVec4Like,
        U extends IVec4Like,
        V extends IVec4Like,
        W extends IVec4Like,
        O extends IVec4Like,
    >(p0: Readonly<T>, m0: Readonly<U>, p1: Readonly<V>, m1: Readonly<W>, t: number, out?: O): O {
        const t1 = clamp01(t);
        const t2 = t1 * t1;
        const t3 = t2 * t1;

        const h00 = 2 * t3 - 3 * t2 + 1;
        const h10 = t3 - 2 * t2 + t1;
        const h01 = -2 * t3 + 3 * t2;
        const h11 = t3 - t2;

        if (out) {
            out.x = h00 * p0.x + h10 * m0.x + h01 * p1.x + h11 * m1.x;
            out.y = h00 * p0.y + h10 * m0.y + h01 * p1.y + h11 * m1.y;
            out.z = h00 * p0.z + h10 * m0.z + h01 * p1.z + h11 * m1.z;
            out.w = h00 * p0.w + h10 * m0.w + h01 * p1.w + h11 * m1.w;
            return out;
        } else {
            return {
                x: h00 * p0.x + h10 * m0.x + h01 * p1.x + h11 * m1.x,
                y: h00 * p0.y + h10 * m0.y + h01 * p1.y + h11 * m1.y,
                z: h00 * p0.z + h10 * m0.z + h01 * p1.z + h11 * m1.z,
                w: h00 * p0.w + h10 * m0.w + h01 * p1.w + h11 * m1.w,
            } as O;
        }
    }

    static catmullRom<
        T extends IVec4Like,
        U extends IVec4Like,
        V extends IVec4Like,
        W extends IVec4Like,
        O extends IVec4Like,
    >(
        p0: Readonly<T>,
        p1: Readonly<U>,
        p2: Readonly<V>,
        p3: Readonly<W>,
        t: number,
        tension: number = 0.5,
        out?: O
    ): O {
        const t1 = clamp01(t);

        if (!out) {
            out = { x: 0, y: 0, z: 0, w: 0 } as O;
        }

        if (t1 === 0) {
            out.x = p1.x;
            out.y = p1.y;
            out.z = p1.z;
            out.w = p1.w;
            return out;
        }

        if (t1 === 1) {
            out.x = p2.x;
            out.y = p2.y;
            out.z = p2.z;
            out.w = p2.w;
            return out;
        }

        const t2 = t1 * t1;
        const t3 = t2 * t1;

        const h00 = 2 * t3 - 3 * t2 + 1;
        const h10 = t3 - 2 * t2 + t1;
        const h01 = -2 * t3 + 3 * t2;
        const h11 = t3 - t2;

        const alpha = (1 - tension) / 2;

        const m0x = alpha * (p2.x - p0.x);
        const m0y = alpha * (p2.y - p0.y);
        const m0z = alpha * (p2.z - p0.z);
        const m0w = alpha * (p2.w - p0.w);
        const m1x = alpha * (p3.x - p1.x);
        const m1y = alpha * (p3.y - p1.y);
        const m1z = alpha * (p3.z - p1.z);
        const m1w = alpha * (p3.w - p1.w);

        out.x = h00 * p1.x + h10 * m0x + h01 * p2.x + h11 * m1x;
        out.y = h00 * p1.y + h10 * m0y + h01 * p2.y + h11 * m1y;
        out.z = h00 * p1.z + h10 * m0z + h01 * p2.z + h11 * m1z;
        out.w = h00 * p1.w + h10 * m0w + h01 * p2.w + h11 * m1w;

        return out;
    }

    static random<T extends IVec4Like>(scale: number = 1, out?: T): T {
        const x = sampleStandardNormal();
        const y = sampleStandardNormal();
        const z = sampleStandardNormal();
        const w = sampleStandardNormal();

        const lengthSq = x * x + y * y + z * z + w * w;
        if (!(lengthSq > 0)) {
            return Vec4.fastRandom(scale, out);
        }

        const invLength = scale / Math.sqrt(lengthSq);

        if (out) {
            out.x = x * invLength;
            out.y = y * invLength;
            out.z = z * invLength;
            out.w = w * invLength;
            return out;
        } else {
            return {
                x: x * invLength,
                y: y * invLength,
                z: z * invLength,
                w: w * invLength,
            } as T;
        }
    }

    static fastRandom<T extends IVec4Like>(scale: number = 1, out?: T): T {
        const u1 = sampleUniform();
        const u2 = sampleUniform();
        const u3 = sampleUniform();

        const phi = 2 * Math.PI * u1;
        const theta = Math.acos(2 * u2 - 1);
        const psi = Math.acos(2 * u3 - 1);

        const sinTheta = Math.sin(theta);
        const sinPsi = Math.sin(psi);

        if (out) {
            out.x = Math.cos(phi) * sinTheta * sinPsi * scale;
            out.y = Math.sin(phi) * sinTheta * sinPsi * scale;
            out.z = Math.cos(theta) * sinPsi * scale;
            out.w = Math.cos(psi) * scale;
            return out;
        } else {
            return {
                x: Math.cos(phi) * sinTheta * sinPsi * scale,
                y: Math.sin(phi) * sinTheta * sinPsi * scale,
                z: Math.cos(theta) * sinPsi * scale,
                w: Math.cos(psi) * scale,
            } as T;
        }
    }

    static randomNormal<T extends IVec4Like>(scale: number = 1, out?: T): T {
        const x = sampleStandardNormal() * scale;
        const y = sampleStandardNormal() * scale;
        const z = sampleStandardNormal() * scale;
        const w = sampleStandardNormal() * scale;

        if (out) {
            out.x = x;
            out.y = y;
            out.z = z;
            out.w = w;
            return out;
        } else {
            return { x, y, z, w } as T;
        }
    }

    static randomBox<T extends IVec4Like>(
        minX: number,
        maxX: number,
        minY: number,
        maxY: number,
        minZ: number,
        maxZ: number,
        minW: number,
        maxW: number,
        out?: T
    ): T {
        if (out) {
            out.x = sampleUniformRange(minX, maxX);
            out.y = sampleUniformRange(minY, maxY);
            out.z = sampleUniformRange(minZ, maxZ);
            out.w = sampleUniformRange(minW, maxW);
            return out;
        } else {
            return {
                x: sampleUniformRange(minX, maxX),
                y: sampleUniformRange(minY, maxY),
                z: sampleUniformRange(minZ, maxZ),
                w: sampleUniformRange(minW, maxW),
            } as T;
        }
    }

    static randomBoxNormal<T extends IVec4Like>(
        minX: number,
        maxX: number,
        minY: number,
        maxY: number,
        minZ: number,
        maxZ: number,
        minW: number,
        maxW: number,
        out?: T
    ): T {
        const centerX = (minX + maxX) * 0.5;
        const centerY = (minY + maxY) * 0.5;
        const centerZ = (minZ + maxZ) * 0.5;
        const centerW = (minW + maxW) * 0.5;
        const rangeX = maxX - minX;
        const rangeY = maxY - minY;
        const rangeZ = maxZ - minZ;
        const rangeW = maxW - minW;

        // Use optimized Box-Muller sampling
        const x = sampleNormalInRange(centerX, rangeX);
        const y = sampleNormalInRange(centerY, rangeY);
        const z = sampleNormalInRange(centerZ, rangeZ);
        const w = sampleNormalInRange(centerW, rangeW);

        if (out) {
            out.x = x;
            out.y = y;
            out.z = z;
            out.w = w;
            return out;
        } else {
            return { x, y, z, w } as T;
        }
    }

    // Instance methods
    add<T extends IVec4Like>(other: Readonly<T>): Vec4 {
        this.x += other.x;
        this.y += other.y;
        this.z += other.z;
        this.w += other.w;
        return this;
    }

    addScalar(num: number): Vec4 {
        this.x += num;
        this.y += num;
        this.z += num;
        this.w += num;
        return this;
    }

    subtract<T extends IVec4Like>(other: Readonly<T>): Vec4 {
        this.x -= other.x;
        this.y -= other.y;
        this.z -= other.z;
        this.w -= other.w;
        return this;
    }

    subtractScalar(num: number): Vec4 {
        this.x -= num;
        this.y -= num;
        this.z -= num;
        this.w -= num;
        return this;
    }

    multiply<T extends IVec4Like>(other: Readonly<T>): Vec4 {
        this.x *= other.x;
        this.y *= other.y;
        this.z *= other.z;
        this.w *= other.w;
        return this;
    }

    multiplyScalar(num: number): Vec4 {
        this.x *= num;
        this.y *= num;
        this.z *= num;
        this.w *= num;
        return this;
    }

    divide<T extends IVec4Like>(other: Readonly<T>): Vec4 {
        if (
            Math.abs(other.x) < EPSILON ||
            Math.abs(other.y) < EPSILON ||
            Math.abs(other.z) < EPSILON ||
            Math.abs(other.w) < EPSILON
        ) {
            throw new Error('Division by zero or near-zero value is not allowed');
        }

        this.x /= other.x;
        this.y /= other.y;
        this.z /= other.z;
        this.w /= other.w;
        return this;
    }

    divideScalar(num: number): Vec4 {
        if (Math.abs(num) < EPSILON) {
            throw new Error('Division by zero or near-zero value is not allowed');
        }

        this.x /= num;
        this.y /= num;
        this.z /= num;
        this.w /= num;
        return this;
    }

    dot<T extends IVec4Like>(other: Readonly<T>): number {
        return this.x * other.x + this.y * other.y + this.z * other.z + this.w * other.w;
    }

    cross3D<T extends IVec4Like>(other: Readonly<T>): Vec4 {
        const x = this.y * other.z - this.z * other.y;
        const y = this.z * other.x - this.x * other.z;
        const z = this.x * other.y - this.y * other.x;

        this.x = x;
        this.y = y;
        this.z = z;
        this.w = 0;
        return this;
    }

    lengthSquared(): number {
        return this.x * this.x + this.y * this.y + this.z * this.z + this.w * this.w;
    }

    length(): number {
        return Math.sqrt(this.lengthSquared());
    }

    fastLength(): number {
        const ax = Math.abs(this.x);
        const ay = Math.abs(this.y);
        const az = Math.abs(this.z);
        const aw = Math.abs(this.w);

        const values = [ax, ay, az, aw].sort((a, b) => b - a);
        return values[0] + 0.4 * values[1] + 0.2 * values[2] + 0.1 * values[3];
    }

    inverse(): Vec4 {
        if (
            Math.abs(this.x) < EPSILON ||
            Math.abs(this.y) < EPSILON ||
            Math.abs(this.z) < EPSILON ||
            Math.abs(this.w) < EPSILON
        ) {
            throw new Error('Inversion of zero or near-zero value');
        }

        this.x = 1 / this.x;
        this.y = 1 / this.y;
        this.z = 1 / this.z;
        this.w = 1 / this.w;
        return this;
    }

    inverseSafe(defaultValue: number = 0): Vec4 {
        const vx = this.x;
        const vy = this.y;
        const vz = this.z;
        const vw = this.w;

        this.x = Math.abs(vx) < EPSILON ? defaultValue : 1 / vx;
        this.y = Math.abs(vy) < EPSILON ? defaultValue : 1 / vy;
        this.z = Math.abs(vz) < EPSILON ? defaultValue : 1 / vz;
        this.w = Math.abs(vw) < EPSILON ? defaultValue : 1 / vw;
        return this;
    }

    normalize(): Vec4 {
        const length = this.length();
        if (length < EPSILON) {
            throw new Error('Cannot normalize a zero-length vector');
        }

        if (!isFinite(length)) {
            throw new Error('Cannot normalize a vector with infinite or NaN length');
        }

        this.x /= length;
        this.y /= length;
        this.z /= length;
        this.w /= length;
        return this;
    }

    normalizeFast(): Vec4 {
        const lenSq = this.x * this.x + this.y * this.y + this.z * this.z + this.w * this.w;
        if (lenSq < EPSILON) {
            throw new Error('Cannot normalize a zero-length vector');
        }

        let i = 0;
        const buf = new ArrayBuffer(4);
        const view = new DataView(buf);
        view.setFloat32(0, lenSq);
        i = view.getInt32(0);
        i = 0x5f3759df - (i >> 1);
        view.setInt32(0, i);
        let invLen = view.getFloat32(0);
        invLen = invLen * (1.5 - lenSq * 0.5 * invLen * invLen);

        this.x *= invLen;
        this.y *= invLen;
        this.z *= invLen;
        this.w *= invLen;
        return this;
    }

    distanceSquared<T extends IVec4Like>(other: Readonly<T>): number {
        const dx = this.x - other.x;
        const dy = this.y - other.y;
        const dz = this.z - other.z;
        const dw = this.w - other.w;
        return dx * dx + dy * dy + dz * dz + dw * dw;
    }

    distance<T extends IVec4Like>(other: Readonly<T>): number {
        const dx = this.x - other.x;
        const dy = this.y - other.y;
        const dz = this.z - other.z;
        const dw = this.w - other.w;
        return Math.sqrt(dx * dx + dy * dy + dz * dz + dw * dw);
    }

    distanceFast<T extends IVec4Like>(other: Readonly<T>): number {
        const dx = Math.abs(this.x - other.x);
        const dy = Math.abs(this.y - other.y);
        const dz = Math.abs(this.z - other.z);
        const dw = Math.abs(this.w - other.w);

        const values = [dx, dy, dz, dw].sort((a, b) => b - a);
        return values[0] + 0.4 * values[1] + 0.2 * values[2] + 0.1 * values[3];
    }

    manhattanDistance<T extends IVec4Like>(other: Readonly<T>): number {
        return (
            Math.abs(this.x - other.x) +
            Math.abs(this.y - other.y) +
            Math.abs(this.z - other.z) +
            Math.abs(this.w - other.w)
        );
    }

    chebyshevDistance<T extends IVec4Like>(other: Readonly<T>): number {
        return Math.max(
            Math.abs(this.x - other.x),
            Math.abs(this.y - other.y),
            Math.abs(this.z - other.z),
            Math.abs(this.w - other.w)
        );
    }

    angleBetween<T extends IVec4Like>(other: Readonly<T>): number {
        const dotProduct = this.dot(other);
        const lengthA = this.length();
        const lengthB = Vec4.len(other);

        if (lengthA < EPSILON || lengthB < EPSILON) {
            throw new Error('Cannot calculate angle with zero-length vector');
        }

        const cosTheta = dotProduct / (lengthA * lengthB);
        return Math.acos(clampNegOneOne(cosTheta));
    }

    angle2Deg<T extends IVec4Like>(other: Readonly<T>): number {
        const angle = this.angleBetween(other);
        return (angle * 180) / Math.PI;
    }

    rotateXY(angle: number): Vec4 {
        const cos = Math.cos(angle);
        const sin = Math.sin(angle);

        const x = this.x * cos - this.y * sin;
        const y = this.x * sin + this.y * cos;

        this.x = x;
        this.y = y;
        return this;
    }

    rotateXZ(angle: number): Vec4 {
        const cos = Math.cos(angle);
        const sin = Math.sin(angle);

        const x = this.x * cos + this.z * sin;
        const z = -this.x * sin + this.z * cos;

        this.x = x;
        this.z = z;
        return this;
    }

    rotateXW(angle: number): Vec4 {
        const cos = Math.cos(angle);
        const sin = Math.sin(angle);

        const x = this.x * cos - this.w * sin;
        const w = this.x * sin + this.w * cos;

        this.x = x;
        this.w = w;
        return this;
    }

    rotateYZ(angle: number): Vec4 {
        const cos = Math.cos(angle);
        const sin = Math.sin(angle);

        const y = this.y * cos - this.z * sin;
        const z = this.y * sin + this.z * cos;

        this.y = y;
        this.z = z;
        return this;
    }

    rotateYW(angle: number): Vec4 {
        const cos = Math.cos(angle);
        const sin = Math.sin(angle);

        const y = this.y * cos - this.w * sin;
        const w = this.y * sin + this.w * cos;

        this.y = y;
        this.w = w;
        return this;
    }

    rotateZW(angle: number): Vec4 {
        const cos = Math.cos(angle);
        const sin = Math.sin(angle);

        const z = this.z * cos - this.w * sin;
        const w = this.z * sin + this.w * cos;

        this.z = z;
        this.w = w;
        return this;
    }

    static project<T extends IVec4Like, U extends IVec4Like>(
        v: Readonly<T>,
        onto: Readonly<U>,
        out?: T
    ): T {
        const dotProduct = Vec4.dot(v, onto);
        const ontoLengthSq = Vec4.lengthSquared(onto);

        if (ontoLengthSq < EPSILON) {
            throw new Error('Cannot project onto zero-length vector');
        }

        const scalar = dotProduct / ontoLengthSq;

        if (out) {
            out.x = onto.x * scalar;
            out.y = onto.y * scalar;
            out.z = onto.z * scalar;
            out.w = onto.w * scalar;
            return out;
        } else {
            return {
                x: onto.x * scalar,
                y: onto.y * scalar,
                z: onto.z * scalar,
                w: onto.w * scalar,
            } as T;
        }
    }

    static reject<T extends IVec4Like, U extends IVec4Like>(
        v: Readonly<T>,
        onto: Readonly<U>,
        out?: T
    ): T {
        const projection = Vec4.project(v, onto);

        if (out) {
            out.x = v.x - projection.x;
            out.y = v.y - projection.y;
            out.z = v.z - projection.z;
            out.w = v.w - projection.w;
            return out;
        } else {
            return {
                x: v.x - projection.x,
                y: v.y - projection.y,
                z: v.z - projection.z,
                w: v.w - projection.w,
            } as T;
        }
    }

    static reflect<T extends IVec4Like, U extends IVec4Like>(
        v: Readonly<T>,
        normal: Readonly<U>,
        out?: T
    ): T {
        const dotProduct = Vec4.dot(v, normal);
        const factor = 2 * dotProduct;

        if (out) {
            out.x = v.x - factor * normal.x;
            out.y = v.y - factor * normal.y;
            out.z = v.z - factor * normal.z;
            out.w = v.w - factor * normal.w;
            return out;
        } else {
            return {
                x: v.x - factor * normal.x,
                y: v.y - factor * normal.y,
                z: v.z - factor * normal.z,
                w: v.w - factor * normal.w,
            } as T;
        }
    }

    project<T extends IVec4Like>(onto: Readonly<T>): Vec4 {
        Vec4.project(this, onto, this);
        return this;
    }

    reject<T extends IVec4Like>(onto: Readonly<T>): Vec4 {
        Vec4.reject(this, onto, this);
        return this;
    }

    reflect<T extends IVec4Like>(normal: Readonly<T>): Vec4 {
        Vec4.reflect(this, normal, this);
        return this;
    }
}

export enum Vec4ComparisonMode {
    LEXICOGRAPHIC,
    MAGNITUDE,
    MANHATTAN,
}

export class Vec4Comparer implements Comparer<Vec4> {
    private readonly mode: Vec4ComparisonMode;

    constructor(mode: Vec4ComparisonMode = Vec4ComparisonMode.LEXICOGRAPHIC) {
        this.mode = mode;
    }

    compare(a: Readonly<Vec4>, b: Readonly<Vec4>): CompareResult {
        switch (this.mode) {
            case Vec4ComparisonMode.LEXICOGRAPHIC:
                if (Math.abs(a.x - b.x) < EPSILON) {
                    if (Math.abs(a.y - b.y) < EPSILON) {
                        if (Math.abs(a.z - b.z) < EPSILON) {
                            if (Math.abs(a.w - b.w) < EPSILON) return 0;
                            return a.w < b.w ? -1 : 1;
                        }
                        return a.z < b.z ? -1 : 1;
                    }
                    return a.y < b.y ? -1 : 1;
                }
                return a.x < b.x ? -1 : 1;

            case Vec4ComparisonMode.MAGNITUDE: {
                const lenA = a.lengthSquared();
                const lenB = b.lengthSquared();
                if (Math.abs(lenA - lenB) < EPSILON) return 0;
                return lenA < lenB ? -1 : 1;
            }

            case Vec4ComparisonMode.MANHATTAN: {
                const distA = Math.abs(a.x) + Math.abs(a.y) + Math.abs(a.z) + Math.abs(a.w);
                const distB = Math.abs(b.x) + Math.abs(b.y) + Math.abs(b.z) + Math.abs(b.w);
                if (Math.abs(distA - distB) < EPSILON) return 0;
                return distA < distB ? -1 : 1;
            }

            default:
                throw new Error(`Unsupported Vec4 comparison mode: ${this.mode}`);
        }
    }
}

export class Vec4EqualityComparer implements EqualityComparer<Vec4> {
    private readonly epsilon: number;

    constructor(epsilon: number = EPSILON) {
        this.epsilon = epsilon;
    }

    equals(a: Readonly<IVec4Like>, b: Readonly<IVec4Like>): boolean {
        if (a === null || b === null) return false;
        if (a === b) return true;
        if (!a || !b) return false;

        return (
            Math.abs(a.x - b.x) < this.epsilon &&
            Math.abs(a.y - b.y) < this.epsilon &&
            Math.abs(a.z - b.z) < this.epsilon &&
            Math.abs(a.w - b.w) < this.epsilon
        );
    }

    hash(obj: Readonly<Vec4>): number {
        if (!obj) return 0;

        let h1 = 2166136261;
        h1 = Math.imul(h1 ^ Math.floor(obj.x * 1000), 16777619);
        h1 = Math.imul(h1 ^ Math.floor(obj.y * 1000), 16777619);
        h1 = Math.imul(h1 ^ Math.floor(obj.z * 1000), 16777619);
        h1 = Math.imul(h1 ^ Math.floor(obj.w * 1000), 16777619);
        return h1 >>> 0;
    }
}
