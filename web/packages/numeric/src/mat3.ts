import { Comparer, CompareResult, EqualityComparer, Equatable, ICloneable } from '@axrone/utility';
import { EPSILON, HALF_PI, PI_2 } from './common';
import { IVec2Like } from './vec2';
import { IVec3Like } from './vec3';
import { clamp01 } from './clamp';

declare const __matrix3Brand: unique symbol;
declare const __mutableBrand: unique symbol;
declare const __vec2Brand: unique symbol;
declare const __vec3Brand: unique symbol;

type Matrix3Data = number[] & { readonly [__matrix3Brand]: true };
type MutableMatrix3Data = number[] & {
    readonly [__matrix3Brand]: true;
    readonly [__mutableBrand]: true;
};

export interface IMat3Like<TData extends ArrayLike<number> = ArrayLike<number>> {
    readonly data: TData;
}

interface IMutableMat3<TData extends number[] = number[]> extends IMat3Like<TData> {
    data: TData;
}

type InferMatrixData<T> = T extends { data: infer U } ? U : never;

type IsMatrix3Compatible<T> = T extends { data: ArrayLike<number> } ? true : false;

type IsMutableMatrix3<T> = T extends { data: number[] } ? true : false;

type MatrixOperationReturnType<
    TOut extends IMat3Like | undefined,
    TDefault extends IMat3Like,
    TSecond extends IMat3Like = TDefault,
> = TOut extends IMutableMat3<infer U> ? TOut : TOut extends undefined ? Mat3 : never;

const asMutableMatrix3Data = <T extends number[]>(data: T): T & MutableMatrix3Data => {
    return data as T & MutableMatrix3Data;
};

const ensureMatrix3Data = <T extends ArrayLike<number>>(data: T): T & Matrix3Data => {
    return data as T & Matrix3Data;
};

export class Mat3 implements IMat3Like<Matrix3Data>, ICloneable<Mat3>, Equatable {
    public readonly data: Matrix3Data;

    constructor(values?: ArrayLike<number>) {
        if (values) {
            if (values.length < 9) {
                throw new RangeError('Matrix values array must have at least 9 elements');
            }

            this.data = [
                values[0],
                values[1],
                values[2],
                values[3],
                values[4],
                values[5],
                values[6],
                values[7],
                values[8],
            ] as Matrix3Data;
        } else {
            // Identity matrix
            this.data = [1, 0, 0, 0, 1, 0, 0, 0, 1] as Matrix3Data;
        }
    }

    static readonly IDENTITY: Readonly<Mat3> = Object.freeze(new Mat3());
    static readonly ZERO: Readonly<Mat3> = Object.freeze(new Mat3([0, 0, 0, 0, 0, 0, 0, 0, 0]));

    static from<T extends IMat3Like>(m: Readonly<T>): Mat3 {
        return new Mat3(m.data);
    }

    static fromArray(arr: ArrayLike<number>, offset: number = 0): Mat3 {
        if (process.env.NODE_ENV === 'development') {
            if (offset < 0) {
                throw new RangeError('Offset cannot be negative');
            }
            if (arr.length < offset + 9) {
                throw new RangeError(
                    `Array must have at least ${offset + 9} elements when using offset ${offset}`
                );
            }
        }

        const values = Array.isArray(arr)
            ? arr.slice(offset, offset + 9)
            : Array.from(arr).slice(offset, offset + 9);

        return new Mat3(values);
    }

    static create(
        m00: number = 1,
        m01: number = 0,
        m02: number = 0,
        m10: number = 0,
        m11: number = 1,
        m12: number = 0,
        m20: number = 0,
        m21: number = 0,
        m22: number = 1
    ): Mat3 {
        return new Mat3([m00, m01, m02, m10, m11, m12, m20, m21, m22]);
    }

    static createFromElements(
        m00: number,
        m01: number,
        m02: number,
        m10: number,
        m11: number,
        m12: number,
        m20: number,
        m21: number,
        m22: number
    ): Mat3 {
        return new Mat3([m00, m01, m02, m10, m11, m12, m20, m21, m22]);
    }

    clone(): Mat3 {
        return new Mat3(this.data);
    }

    equals(other: unknown): boolean {
        if (!(other instanceof Mat3)) return false;

        const a = this.data;
        const b = other.data;

        return (
            Math.abs(a[0] - b[0]) < EPSILON &&
            Math.abs(a[1] - b[1]) < EPSILON &&
            Math.abs(a[2] - b[2]) < EPSILON &&
            Math.abs(a[3] - b[3]) < EPSILON &&
            Math.abs(a[4] - b[4]) < EPSILON &&
            Math.abs(a[5] - b[5]) < EPSILON &&
            Math.abs(a[6] - b[6]) < EPSILON &&
            Math.abs(a[7] - b[7]) < EPSILON &&
            Math.abs(a[8] - b[8]) < EPSILON
        );
    }

    getHashCode(): number {
        let h1 = 2166136261;
        for (let i = 0; i < 9; i++) {
            h1 = Math.imul(h1 ^ Math.floor(this.data[i] * 1000), 16777619);
        }
        return h1 >>> 0;
    }

    static multiply<
        TMatA extends IMat3Like,
        TMatB extends IMat3Like,
        TOut extends IMat3Like | undefined = undefined,
    >(
        a: Readonly<TMatA>,
        b: Readonly<TMatB>,
        out?: TOut
    ): MatrixOperationReturnType<TOut, TMatA, TMatB> {
        const a00 = a.data[0],
            a01 = a.data[1],
            a02 = a.data[2];
        const a10 = a.data[3],
            a11 = a.data[4],
            a12 = a.data[5];
        const a20 = a.data[6],
            a21 = a.data[7],
            a22 = a.data[8];

        const b00 = b.data[0],
            b01 = b.data[1],
            b02 = b.data[2];
        const b10 = b.data[3],
            b11 = b.data[4],
            b12 = b.data[5];
        const b20 = b.data[6],
            b21 = b.data[7],
            b22 = b.data[8];

        if (out) {
            const outData = asMutableMatrix3Data((out as IMutableMat3).data);

            outData[0] = a00 * b00 + a01 * b10 + a02 * b20;
            outData[1] = a00 * b01 + a01 * b11 + a02 * b21;
            outData[2] = a00 * b02 + a01 * b12 + a02 * b22;

            outData[3] = a10 * b00 + a11 * b10 + a12 * b20;
            outData[4] = a10 * b01 + a11 * b11 + a12 * b21;
            outData[5] = a10 * b02 + a11 * b12 + a12 * b22;

            outData[6] = a20 * b00 + a21 * b10 + a22 * b20;
            outData[7] = a20 * b01 + a21 * b11 + a22 * b21;
            outData[8] = a20 * b02 + a21 * b12 + a22 * b22;

            return out as MatrixOperationReturnType<TOut, TMatA, TMatB>;
        } else {
            return new Mat3([
                a00 * b00 + a01 * b10 + a02 * b20,
                a00 * b01 + a01 * b11 + a02 * b21,
                a00 * b02 + a01 * b12 + a02 * b22,

                a10 * b00 + a11 * b10 + a12 * b20,
                a10 * b01 + a11 * b11 + a12 * b21,
                a10 * b02 + a11 * b12 + a12 * b22,

                a20 * b00 + a21 * b10 + a22 * b20,
                a20 * b01 + a21 * b11 + a22 * b21,
                a20 * b02 + a21 * b12 + a22 * b22,
            ]) as MatrixOperationReturnType<TOut, TMatA, TMatB>;
        }
    }

    static transpose<T extends IMat3Like, V extends IMat3Like | undefined = undefined>(
        m: Readonly<T>,
        out?: V
    ): MatrixOperationReturnType<V, T> {
        if (out) {
            const outData = asMutableMatrix3Data((out as IMutableMat3).data);

            outData[0] = m.data[0];
            outData[1] = m.data[3];
            outData[2] = m.data[6];
            outData[3] = m.data[1];
            outData[4] = m.data[4];
            outData[5] = m.data[7];
            outData[6] = m.data[2];
            outData[7] = m.data[5];
            outData[8] = m.data[8];

            return out as MatrixOperationReturnType<V, T>;
        } else {
            return new Mat3([
                m.data[0],
                m.data[3],
                m.data[6],
                m.data[1],
                m.data[4],
                m.data[7],
                m.data[2],
                m.data[5],
                m.data[8],
            ]) as MatrixOperationReturnType<V, T>;
        }
    }

    static determinant<T extends IMat3Like>(m: Readonly<T>): number {
        const a = m.data;

        return (
            a[0] * (a[4] * a[8] - a[5] * a[7]) -
            a[1] * (a[3] * a[8] - a[5] * a[6]) +
            a[2] * (a[3] * a[7] - a[4] * a[6])
        );
    }

    static invert<T extends IMat3Like, V extends IMat3Like | undefined = undefined>(
        m: Readonly<T>,
        out?: V
    ): MatrixOperationReturnType<V, T> {
        const a = m.data;

        const a00 = a[0],
            a01 = a[1],
            a02 = a[2];
        const a10 = a[3],
            a11 = a[4],
            a12 = a[5];
        const a20 = a[6],
            a21 = a[7],
            a22 = a[8];

        const b01 = a22 * a11 - a12 * a21;
        const b11 = -a22 * a10 + a12 * a20;
        const b21 = a21 * a10 - a11 * a20;

        let det = a00 * b01 + a01 * b11 + a02 * b21;

        if (Math.abs(det) < EPSILON) {
            throw new Error('Matrix is not invertible (determinant is zero or near-zero)');
        }

        det = 1.0 / det;

        if (out) {
            const outData = asMutableMatrix3Data((out as IMutableMat3).data);

            outData[0] = b01 * det;
            outData[1] = (-a22 * a01 + a02 * a21) * det;
            outData[2] = (a12 * a01 - a02 * a11) * det;
            outData[3] = b11 * det;
            outData[4] = (a22 * a00 - a02 * a20) * det;
            outData[5] = (-a12 * a00 + a02 * a10) * det;
            outData[6] = b21 * det;
            outData[7] = (-a21 * a00 + a01 * a20) * det;
            outData[8] = (a11 * a00 - a01 * a10) * det;

            return out as MatrixOperationReturnType<V, T>;
        } else {
            return new Mat3([
                b01 * det,
                (-a22 * a01 + a02 * a21) * det,
                (a12 * a01 - a02 * a11) * det,
                b11 * det,
                (a22 * a00 - a02 * a20) * det,
                (-a12 * a00 + a02 * a10) * det,
                b21 * det,
                (-a21 * a00 + a01 * a20) * det,
                (a11 * a00 - a01 * a10) * det,
            ]) as MatrixOperationReturnType<V, T>;
        }
    }

    static translate2D<T extends IVec2Like, V extends IMat3Like | undefined = undefined>(
        v: Readonly<T>,
        out?: V
    ): MatrixOperationReturnType<V, Mat3> {
        if (out) {
            const outData = asMutableMatrix3Data((out as IMutableMat3).data);

            outData[0] = 1;
            outData[1] = 0;
            outData[2] = v.x;
            outData[3] = 0;
            outData[4] = 1;
            outData[5] = v.y;
            outData[6] = 0;
            outData[7] = 0;
            outData[8] = 1;

            return out as MatrixOperationReturnType<V, Mat3>;
        } else {
            return new Mat3([1, 0, v.x, 0, 1, v.y, 0, 0, 1]) as MatrixOperationReturnType<V, Mat3>;
        }
    }

    static scale2D<T extends IVec2Like, V extends IMat3Like | undefined = undefined>(
        v: Readonly<T>,
        out?: V
    ): MatrixOperationReturnType<V, Mat3> {
        if (out) {
            const outData = asMutableMatrix3Data((out as IMutableMat3).data);

            outData[0] = v.x;
            outData[1] = 0;
            outData[2] = 0;
            outData[3] = 0;
            outData[4] = v.y;
            outData[5] = 0;
            outData[6] = 0;
            outData[7] = 0;
            outData[8] = 1;

            return out as MatrixOperationReturnType<V, Mat3>;
        } else {
            return new Mat3([v.x, 0, 0, 0, v.y, 0, 0, 0, 1]) as MatrixOperationReturnType<V, Mat3>;
        }
    }

    static scale3D<T extends IVec3Like, V extends IMat3Like | undefined = undefined>(
        v: Readonly<T>,
        out?: V
    ): MatrixOperationReturnType<V, Mat3> {
        if (out) {
            const outData = asMutableMatrix3Data((out as IMutableMat3).data);

            outData[0] = v.x;
            outData[1] = 0;
            outData[2] = 0;
            outData[3] = 0;
            outData[4] = v.y;
            outData[5] = 0;
            outData[6] = 0;
            outData[7] = 0;
            outData[8] = v.z;

            return out as MatrixOperationReturnType<V, Mat3>;
        } else {
            return new Mat3([v.x, 0, 0, 0, v.y, 0, 0, 0, v.z]) as MatrixOperationReturnType<
                V,
                Mat3
            >;
        }
    }

    static rotate2D<V extends IMat3Like | undefined = undefined>(
        angle: number,
        out?: V
    ): MatrixOperationReturnType<V, Mat3> {
        const c = Math.cos(angle);
        const s = Math.sin(angle);

        if (out) {
            const outData = asMutableMatrix3Data((out as IMutableMat3).data);

            outData[0] = c;
            outData[1] = -s;
            outData[2] = 0;
            outData[3] = s;
            outData[4] = c;
            outData[5] = 0;
            outData[6] = 0;
            outData[7] = 0;
            outData[8] = 1;

            return out as MatrixOperationReturnType<V, Mat3>;
        } else {
            return new Mat3([c, -s, 0, s, c, 0, 0, 0, 1]) as MatrixOperationReturnType<V, Mat3>;
        }
    }

    static rotateX<V extends IMat3Like | undefined = undefined>(
        angle: number,
        out?: V
    ): MatrixOperationReturnType<V, Mat3> {
        const c = Math.cos(angle);
        const s = Math.sin(angle);

        if (out) {
            const outData = asMutableMatrix3Data((out as IMutableMat3).data);

            outData[0] = 1;
            outData[1] = 0;
            outData[2] = 0;
            outData[3] = 0;
            outData[4] = c;
            outData[5] = -s;
            outData[6] = 0;
            outData[7] = s;
            outData[8] = c;

            return out as MatrixOperationReturnType<V, Mat3>;
        } else {
            return new Mat3([1, 0, 0, 0, c, -s, 0, s, c]) as MatrixOperationReturnType<V, Mat3>;
        }
    }

    static rotateY<V extends IMat3Like | undefined = undefined>(
        angle: number,
        out?: V
    ): MatrixOperationReturnType<V, Mat3> {
        const c = Math.cos(angle);
        const s = Math.sin(angle);

        if (out) {
            const outData = asMutableMatrix3Data((out as IMutableMat3).data);

            outData[0] = c;
            outData[1] = 0;
            outData[2] = s;
            outData[3] = 0;
            outData[4] = 1;
            outData[5] = 0;
            outData[6] = -s;
            outData[7] = 0;
            outData[8] = c;

            return out as MatrixOperationReturnType<V, Mat3>;
        } else {
            return new Mat3([c, 0, s, 0, 1, 0, -s, 0, c]) as MatrixOperationReturnType<V, Mat3>;
        }
    }

    static rotateZ<V extends IMat3Like | undefined = undefined>(
        angle: number,
        out?: V
    ): MatrixOperationReturnType<V, Mat3> {
        const c = Math.cos(angle);
        const s = Math.sin(angle);

        if (out) {
            const outData = asMutableMatrix3Data((out as IMutableMat3).data);

            outData[0] = c;
            outData[1] = -s;
            outData[2] = 0;
            outData[3] = s;
            outData[4] = c;
            outData[5] = 0;
            outData[6] = 0;
            outData[7] = 0;
            outData[8] = 1;

            return out as MatrixOperationReturnType<V, Mat3>;
        } else {
            return new Mat3([c, -s, 0, s, c, 0, 0, 0, 1]) as MatrixOperationReturnType<V, Mat3>;
        }
    }

    static rotateAxis<T extends IVec3Like, V extends IMat3Like | undefined = undefined>(
        axis: Readonly<T>,
        angle: number,
        out?: V
    ): MatrixOperationReturnType<V, Mat3> {
        const len = Math.sqrt(axis.x * axis.x + axis.y * axis.y + axis.z * axis.z);

        if (len < EPSILON) {
            throw new Error('Cannot rotate around zero-length axis');
        }

        const x = axis.x / len;
        const y = axis.y / len;
        const z = axis.z / len;

        const c = Math.cos(angle);
        const s = Math.sin(angle);
        const oneMinusC = 1 - c;

        const m00 = x * x * oneMinusC + c;
        const m01 = x * y * oneMinusC - z * s;
        const m02 = x * z * oneMinusC + y * s;

        const m10 = y * x * oneMinusC + z * s;
        const m11 = y * y * oneMinusC + c;
        const m12 = y * z * oneMinusC - x * s;

        const m20 = z * x * oneMinusC - y * s;
        const m21 = z * y * oneMinusC + x * s;
        const m22 = z * z * oneMinusC + c;

        if (out) {
            const outData = asMutableMatrix3Data((out as IMutableMat3).data);

            outData[0] = m00;
            outData[1] = m01;
            outData[2] = m02;
            outData[3] = m10;
            outData[4] = m11;
            outData[5] = m12;
            outData[6] = m20;
            outData[7] = m21;
            outData[8] = m22;

            return out as MatrixOperationReturnType<V, Mat3>;
        } else {
            return new Mat3([
                m00,
                m01,
                m02,
                m10,
                m11,
                m12,
                m20,
                m21,
                m22,
            ]) as MatrixOperationReturnType<V, Mat3>;
        }
    }

    static transformVec2<
        T extends IVec2Like,
        U extends IMat3Like,
        V extends IVec2Like | undefined = undefined,
    >(v: Readonly<T>, m: Readonly<U>, out?: V): V extends undefined ? T : V {
        const x = v.x,
            y = v.y;

        if (out) {
            out.x = m.data[0] * x + m.data[1] * y + m.data[2];
            out.y = m.data[3] * x + m.data[4] * y + m.data[5];
            return out as V extends undefined ? T : V;
        } else {
            return {
                x: m.data[0] * x + m.data[1] * y + m.data[2],
                y: m.data[3] * x + m.data[4] * y + m.data[5],
            } as V extends undefined ? T : V;
        }
    }

    static transformVec3<
        T extends IVec3Like,
        U extends IMat3Like,
        V extends IVec3Like | undefined = undefined,
    >(v: Readonly<T>, m: Readonly<U>, out?: V): V extends undefined ? T : V {
        const x = v.x,
            y = v.y,
            z = v.z;

        if (out) {
            out.x = m.data[0] * x + m.data[1] * y + m.data[2] * z;
            out.y = m.data[3] * x + m.data[4] * y + m.data[5] * z;
            out.z = m.data[6] * x + m.data[7] * y + m.data[8] * z;
            return out as V extends undefined ? T : V;
        } else {
            return {
                x: m.data[0] * x + m.data[1] * y + m.data[2] * z,
                y: m.data[3] * x + m.data[4] * y + m.data[5] * z,
                z: m.data[6] * x + m.data[7] * y + m.data[8] * z,
            } as V extends undefined ? T : V;
        }
    }

    static transformNormal<
        T extends IVec3Like,
        U extends IMat3Like,
        V extends IVec3Like | undefined = undefined,
    >(normal: Readonly<T>, m: Readonly<U>, out?: V): V extends undefined ? T : V {
        const invTranspose = Mat3.transpose(Mat3.invert(m));
        return Mat3.transformVec3(normal, invTranspose, out);
    }

    static lerp<
        T extends IMat3Like,
        U extends IMat3Like,
        V extends IMat3Like | undefined = undefined,
    >(a: Readonly<T>, b: Readonly<U>, t: number, out?: V): MatrixOperationReturnType<V, T> {
        const t1 = clamp01(t);

        if (out) {
            const outData = asMutableMatrix3Data((out as IMutableMat3).data);
            for (let i = 0; i < 9; i++) {
                outData[i] = a.data[i] + (b.data[i] - a.data[i]) * t1;
            }
            return out as MatrixOperationReturnType<V, T>;
        } else {
            const result = new Array(9);
            for (let i = 0; i < 9; i++) {
                result[i] = a.data[i] + (b.data[i] - a.data[i]) * t1;
            }
            return new Mat3(result) as MatrixOperationReturnType<V, T>;
        }
    }

    static lerpUnClamped<
        T extends IMat3Like,
        U extends IMat3Like,
        V extends IMat3Like | undefined = undefined,
    >(a: Readonly<T>, b: Readonly<U>, t: number, out?: V): MatrixOperationReturnType<V, T> {
        if (out) {
            const outData = asMutableMatrix3Data((out as IMutableMat3).data);
            for (let i = 0; i < 9; i++) {
                outData[i] = a.data[i] + (b.data[i] - a.data[i]) * t;
            }
            return out as MatrixOperationReturnType<V, T>;
        } else {
            const result = new Array(9);
            for (let i = 0; i < 9; i++) {
                result[i] = a.data[i] + (b.data[i] - a.data[i]) * t;
            }
            return new Mat3(result) as MatrixOperationReturnType<V, T>;
        }
    }

    multiply<T extends IMat3Like>(other: Readonly<T>): Mat3 {
        return Mat3.multiply(this, other, this);
    }

    transpose(): Mat3 {
        return Mat3.transpose(this, this);
    }

    determinant(): number {
        return Mat3.determinant(this);
    }

    invert(): Mat3 {
        return Mat3.invert(this, this);
    }

    transformVec2<T extends IVec2Like>(v: Readonly<T>, out?: T): T {
        return Mat3.transformVec2(v, this, out) as T;
    }

    transformVec3<T extends IVec3Like>(v: Readonly<T>, out?: T): T {
        return Mat3.transformVec3(v, this, out) as T;
    }

    transformNormal<T extends IVec3Like>(normal: Readonly<T>, out?: T): T {
        return Mat3.transformNormal(normal, this, out) as T;
    }

    toArray(): number[] {
        return [...this.data];
    }

    toString(): string {
        const d = this.data;
        return `Mat3(
  [${d[0].toFixed(3)}, ${d[1].toFixed(3)}, ${d[2].toFixed(3)}]
  [${d[3].toFixed(3)}, ${d[4].toFixed(3)}, ${d[5].toFixed(3)}]
  [${d[6].toFixed(3)}, ${d[7].toFixed(3)}, ${d[8].toFixed(3)}]
)`;
    }
}

export enum Mat3ComparisonMode {
    FROBENIUS_NORM,
    DETERMINANT,
    TRACE,
    CONDITION_NUMBER,
}

export class Mat3Comparer implements Comparer<Mat3> {
    private readonly mode: Mat3ComparisonMode;

    constructor(mode: Mat3ComparisonMode = Mat3ComparisonMode.FROBENIUS_NORM) {
        this.mode = mode;
    }

    compare(a: Readonly<Mat3>, b: Readonly<Mat3>): CompareResult {
        switch (this.mode) {
            case Mat3ComparisonMode.FROBENIUS_NORM: {
                let normA = 0,
                    normB = 0;
                for (let i = 0; i < 9; i++) {
                    normA += a.data[i] * a.data[i];
                    normB += b.data[i] * b.data[i];
                }
                normA = Math.sqrt(normA);
                normB = Math.sqrt(normB);
                if (Math.abs(normA - normB) < EPSILON) return 0;
                return normA < normB ? -1 : 1;
            }

            case Mat3ComparisonMode.DETERMINANT: {
                const detA = Mat3.determinant(a);
                const detB = Mat3.determinant(b);
                if (Math.abs(detA - detB) < EPSILON) return 0;
                return detA < detB ? -1 : 1;
            }

            case Mat3ComparisonMode.TRACE: {
                const traceA = a.data[0] + a.data[4] + a.data[8];
                const traceB = b.data[0] + b.data[4] + b.data[8];
                if (Math.abs(traceA - traceB) < EPSILON) return 0;
                return traceA < traceB ? -1 : 1;
            }

            case Mat3ComparisonMode.CONDITION_NUMBER: {
                let maxA = 0,
                    minA = Infinity,
                    maxB = 0,
                    minB = Infinity;

                for (let i = 0; i < 9; i++) {
                    const absA = Math.abs(a.data[i]);
                    const absB = Math.abs(b.data[i]);
                    maxA = Math.max(maxA, absA);
                    minA = Math.min(minA, absA);
                    maxB = Math.max(maxB, absB);
                    minB = Math.min(minB, absB);
                }

                const condA = minA > EPSILON ? maxA / minA : Infinity;
                const condB = minB > EPSILON ? maxB / minB : Infinity;

                if (Math.abs(condA - condB) < EPSILON) return 0;
                return condA < condB ? -1 : 1;
            }

            default:
                throw new Error(`Unsupported Mat3 comparison mode: ${this.mode}`);
        }
    }
}
