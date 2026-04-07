import { Comparer, CompareResult, EqualityComparer, Equatable, ICloneable } from '@axrone/utility';
import { EPSILON, HALF_PI, PI_2 } from './common';
import { IVec3Like } from './vec3';
import { IVec4Like } from './vec4';
import { IQuatLike } from './quat';
import { clamp01 } from './clamp';

declare const __matrix4Brand: unique symbol;
declare const __mutableBrand: unique symbol;
declare const __vec3Brand: unique symbol;
declare const __vec4Brand: unique symbol;

type Matrix4Data = number[] & { readonly [__matrix4Brand]: true };
type MutableMatrix4Data = number[] & {
    readonly [__matrix4Brand]: true;
    readonly [__mutableBrand]: true;
};

export interface IMat4Like<TData extends ArrayLike<number> = ArrayLike<number>> {
    readonly data: TData;
}

interface IMutableMat4<TData extends number[] = number[]> extends IMat4Like<TData> {
    data: TData;
}

type InferMatrixData<T> = T extends { data: infer U } ? U : never;

type IsMatrix4Compatible<T> = T extends { data: ArrayLike<number> } ? true : false;

type IsMutableMatrix4<T> = T extends { data: number[] } ? true : false;

type MatrixOperationReturnType<
    TOut extends IMat4Like | undefined,
    TDefault extends IMat4Like,
    TSecond extends IMat4Like = TDefault,
> = TOut extends IMutableMat4<infer U> ? TOut : TOut extends undefined ? Mat4 : never;

const asMutableMatrix4Data = <T extends number[]>(data: T): T & MutableMatrix4Data => {
    return data as T & MutableMatrix4Data;
};

const ensureMatrix4Data = <T extends ArrayLike<number>>(data: T): T & Matrix4Data => {
    return data as T & Matrix4Data;
};

export class Mat4 implements IMat4Like<Matrix4Data>, ICloneable<Mat4>, Equatable {
    public readonly data: Matrix4Data;

    constructor(values?: ArrayLike<number>) {
        if (values) {
            if (values.length < 16) {
                throw new RangeError('Matrix values array must have at least 16 elements');
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
                values[9],
                values[10],
                values[11],
                values[12],
                values[13],
                values[14],
                values[15],
            ] as Matrix4Data;
        } else {
            this.data = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1] as Matrix4Data;
        }
    }

    static readonly IDENTITY: Readonly<Mat4> = Object.freeze(new Mat4());
    static readonly ZERO: Readonly<Mat4> = Object.freeze(
        new Mat4([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0])
    );

    static from<T extends IMat4Like>(m: Readonly<T>): Mat4 {
        return new Mat4(m.data);
    }

    static fromArray(arr: ArrayLike<number>, offset: number = 0): Mat4 {
        if (process.env.NODE_ENV === 'development') {
            if (offset < 0) {
                throw new RangeError('Offset cannot be negative');
            }
            if (arr.length < offset + 16) {
                throw new RangeError(
                    `Array must have at least ${offset + 16} elements when using offset ${offset}`
                );
            }
        }

        const values = Array.isArray(arr)
            ? arr.slice(offset, offset + 16)
            : Array.from(arr).slice(offset, offset + 16);

        return new Mat4(values);
    }

    static create(
        m00: number = 1,
        m01: number = 0,
        m02: number = 0,
        m03: number = 0,
        m10: number = 0,
        m11: number = 1,
        m12: number = 0,
        m13: number = 0,
        m20: number = 0,
        m21: number = 0,
        m22: number = 1,
        m23: number = 0,
        m30: number = 0,
        m31: number = 0,
        m32: number = 0,
        m33: number = 1
    ): Mat4 {
        return new Mat4([
            m00,
            m01,
            m02,
            m03,
            m10,
            m11,
            m12,
            m13,
            m20,
            m21,
            m22,
            m23,
            m30,
            m31,
            m32,
            m33,
        ]);
    }

    static createFromElements(
        m00: number,
        m01: number,
        m02: number,
        m03: number,
        m10: number,
        m11: number,
        m12: number,
        m13: number,
        m20: number,
        m21: number,
        m22: number,
        m23: number,
        m30: number,
        m31: number,
        m32: number,
        m33: number
    ): Mat4 {
        return new Mat4([
            m00,
            m01,
            m02,
            m03,
            m10,
            m11,
            m12,
            m13,
            m20,
            m21,
            m22,
            m23,
            m30,
            m31,
            m32,
            m33,
        ]);
    }

    clone(): Mat4 {
        return new Mat4(this.data);
    }

    equals(other: unknown): boolean {
        if (!(other instanceof Mat4)) return false;

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
            Math.abs(a[8] - b[8]) < EPSILON &&
            Math.abs(a[9] - b[9]) < EPSILON &&
            Math.abs(a[10] - b[10]) < EPSILON &&
            Math.abs(a[11] - b[11]) < EPSILON &&
            Math.abs(a[12] - b[12]) < EPSILON &&
            Math.abs(a[13] - b[13]) < EPSILON &&
            Math.abs(a[14] - b[14]) < EPSILON &&
            Math.abs(a[15] - b[15]) < EPSILON
        );
    }

    getHashCode(): number {
        let h1 = 2166136261;
        for (let i = 0; i < 16; i++) {
            h1 = Math.imul(h1 ^ Math.floor(this.data[i] * 1000), 16777619);
        }
        return h1 >>> 0;
    }

    static multiply<
        TMatA extends IMat4Like,
        TMatB extends IMat4Like,
        TOut extends IMat4Like | undefined = undefined,
    >(
        a: Readonly<TMatA>,
        b: Readonly<TMatB>,
        out?: TOut
    ): MatrixOperationReturnType<TOut, TMatA, TMatB> {
        const a00 = a.data[0],
            a01 = a.data[1],
            a02 = a.data[2],
            a03 = a.data[3];
        const a10 = a.data[4],
            a11 = a.data[5],
            a12 = a.data[6],
            a13 = a.data[7];
        const a20 = a.data[8],
            a21 = a.data[9],
            a22 = a.data[10],
            a23 = a.data[11];
        const a30 = a.data[12],
            a31 = a.data[13],
            a32 = a.data[14],
            a33 = a.data[15];

        const b00 = b.data[0],
            b01 = b.data[1],
            b02 = b.data[2],
            b03 = b.data[3];
        const b10 = b.data[4],
            b11 = b.data[5],
            b12 = b.data[6],
            b13 = b.data[7];
        const b20 = b.data[8],
            b21 = b.data[9],
            b22 = b.data[10],
            b23 = b.data[11];
        const b30 = b.data[12],
            b31 = b.data[13],
            b32 = b.data[14],
            b33 = b.data[15];

        if (out) {
            const outData = asMutableMatrix4Data((out as IMutableMat4).data);

            outData[0] = a00 * b00 + a01 * b10 + a02 * b20 + a03 * b30;
            outData[1] = a00 * b01 + a01 * b11 + a02 * b21 + a03 * b31;
            outData[2] = a00 * b02 + a01 * b12 + a02 * b22 + a03 * b32;
            outData[3] = a00 * b03 + a01 * b13 + a02 * b23 + a03 * b33;

            outData[4] = a10 * b00 + a11 * b10 + a12 * b20 + a13 * b30;
            outData[5] = a10 * b01 + a11 * b11 + a12 * b21 + a13 * b31;
            outData[6] = a10 * b02 + a11 * b12 + a12 * b22 + a13 * b32;
            outData[7] = a10 * b03 + a11 * b13 + a12 * b23 + a13 * b33;

            outData[8] = a20 * b00 + a21 * b10 + a22 * b20 + a23 * b30;
            outData[9] = a20 * b01 + a21 * b11 + a22 * b21 + a23 * b31;
            outData[10] = a20 * b02 + a21 * b12 + a22 * b22 + a23 * b32;
            outData[11] = a20 * b03 + a21 * b13 + a22 * b23 + a23 * b33;

            outData[12] = a30 * b00 + a31 * b10 + a32 * b20 + a33 * b30;
            outData[13] = a30 * b01 + a31 * b11 + a32 * b21 + a33 * b31;
            outData[14] = a30 * b02 + a31 * b12 + a32 * b22 + a33 * b32;
            outData[15] = a30 * b03 + a31 * b13 + a32 * b23 + a33 * b33;

            return out as MatrixOperationReturnType<TOut, TMatA, TMatB>;
        } else {
            return new Mat4([
                a00 * b00 + a01 * b10 + a02 * b20 + a03 * b30,
                a00 * b01 + a01 * b11 + a02 * b21 + a03 * b31,
                a00 * b02 + a01 * b12 + a02 * b22 + a03 * b32,
                a00 * b03 + a01 * b13 + a02 * b23 + a03 * b33,

                a10 * b00 + a11 * b10 + a12 * b20 + a13 * b30,
                a10 * b01 + a11 * b11 + a12 * b21 + a13 * b31,
                a10 * b02 + a11 * b12 + a12 * b22 + a13 * b32,
                a10 * b03 + a11 * b13 + a12 * b23 + a13 * b33,

                a20 * b00 + a21 * b10 + a22 * b20 + a23 * b30,
                a20 * b01 + a21 * b11 + a22 * b21 + a23 * b31,
                a20 * b02 + a21 * b12 + a22 * b22 + a23 * b32,
                a20 * b03 + a21 * b13 + a22 * b23 + a23 * b33,

                a30 * b00 + a31 * b10 + a32 * b20 + a33 * b30,
                a30 * b01 + a31 * b11 + a32 * b21 + a33 * b31,
                a30 * b02 + a31 * b12 + a32 * b22 + a33 * b32,
                a30 * b03 + a31 * b13 + a32 * b23 + a33 * b33,
            ]) as MatrixOperationReturnType<TOut, TMatA, TMatB>;
        }
    }

    static transpose<T extends IMat4Like, V extends IMat4Like | undefined = undefined>(
        m: Readonly<T>,
        out?: V
    ): MatrixOperationReturnType<V, T> {
        if (out) {
            const outData = asMutableMatrix4Data((out as IMutableMat4).data);

            outData[0] = m.data[0];
            outData[1] = m.data[4];
            outData[2] = m.data[8];
            outData[3] = m.data[12];
            outData[4] = m.data[1];
            outData[5] = m.data[5];
            outData[6] = m.data[9];
            outData[7] = m.data[13];
            outData[8] = m.data[2];
            outData[9] = m.data[6];
            outData[10] = m.data[10];
            outData[11] = m.data[14];
            outData[12] = m.data[3];
            outData[13] = m.data[7];
            outData[14] = m.data[11];
            outData[15] = m.data[15];

            return out as MatrixOperationReturnType<V, T>;
        } else {
            return new Mat4([
                m.data[0],
                m.data[4],
                m.data[8],
                m.data[12],
                m.data[1],
                m.data[5],
                m.data[9],
                m.data[13],
                m.data[2],
                m.data[6],
                m.data[10],
                m.data[14],
                m.data[3],
                m.data[7],
                m.data[11],
                m.data[15],
            ]) as MatrixOperationReturnType<V, T>;
        }
    }

    static determinant<T extends IMat4Like>(m: Readonly<T>): number {
        const a = m.data;

        const a00 = a[0] * a[5] - a[1] * a[4];
        const a01 = a[0] * a[6] - a[2] * a[4];
        const a02 = a[0] * a[7] - a[3] * a[4];
        const a03 = a[1] * a[6] - a[2] * a[5];
        const a04 = a[1] * a[7] - a[3] * a[5];
        const a05 = a[2] * a[7] - a[3] * a[6];
        const b00 = a[8] * a[13] - a[9] * a[12];
        const b01 = a[8] * a[14] - a[10] * a[12];
        const b02 = a[8] * a[15] - a[11] * a[12];
        const b03 = a[9] * a[14] - a[10] * a[13];
        const b04 = a[9] * a[15] - a[11] * a[13];
        const b05 = a[10] * a[15] - a[11] * a[14];

        return a00 * b05 - a01 * b04 + a02 * b03 + a03 * b02 - a04 * b01 + a05 * b00;
    }

    static invert<T extends IMat4Like, V extends IMat4Like | undefined = undefined>(
        m: Readonly<T>,
        out?: V
    ): MatrixOperationReturnType<V, T> {
        const a = m.data;

        const a00 = a[0] * a[5] - a[1] * a[4];
        const a01 = a[0] * a[6] - a[2] * a[4];
        const a02 = a[0] * a[7] - a[3] * a[4];
        const a03 = a[1] * a[6] - a[2] * a[5];
        const a04 = a[1] * a[7] - a[3] * a[5];
        const a05 = a[2] * a[7] - a[3] * a[6];
        const b00 = a[8] * a[13] - a[9] * a[12];
        const b01 = a[8] * a[14] - a[10] * a[12];
        const b02 = a[8] * a[15] - a[11] * a[12];
        const b03 = a[9] * a[14] - a[10] * a[13];
        const b04 = a[9] * a[15] - a[11] * a[13];
        const b05 = a[10] * a[15] - a[11] * a[14];

        let det = a00 * b05 - a01 * b04 + a02 * b03 + a03 * b02 - a04 * b01 + a05 * b00;

        if (Math.abs(det) < EPSILON) {
            throw new Error('Matrix is not invertible (determinant is zero or near-zero)');
        }

        det = 1.0 / det;

        if (out) {
            const outData = asMutableMatrix4Data((out as IMutableMat4).data);

            outData[0] = (a[5] * b05 - a[6] * b04 + a[7] * b03) * det;
            outData[1] = (-a[1] * b05 + a[2] * b04 - a[3] * b03) * det;
            outData[2] = (a[13] * a05 - a[14] * a04 + a[15] * a03) * det;
            outData[3] = (-a[9] * a05 + a[10] * a04 - a[11] * a03) * det;
            outData[4] = (-a[4] * b05 + a[6] * b02 - a[7] * b01) * det;
            outData[5] = (a[0] * b05 - a[2] * b02 + a[3] * b01) * det;
            outData[6] = (-a[12] * a05 + a[14] * a02 - a[15] * a01) * det;
            outData[7] = (a[8] * a05 - a[10] * a02 + a[11] * a01) * det;
            outData[8] = (a[4] * b04 - a[5] * b02 + a[7] * b00) * det;
            outData[9] = (-a[0] * b04 + a[1] * b02 - a[3] * b00) * det;
            outData[10] = (a[12] * a04 - a[13] * a02 + a[15] * a00) * det;
            outData[11] = (-a[8] * a04 + a[9] * a02 - a[11] * a00) * det;
            outData[12] = (-a[4] * b03 + a[5] * b01 - a[6] * b00) * det;
            outData[13] = (a[0] * b03 - a[1] * b01 + a[2] * b00) * det;
            outData[14] = (-a[12] * a03 + a[13] * a01 - a[14] * a00) * det;
            outData[15] = (a[8] * a03 - a[9] * a01 + a[10] * a00) * det;

            return out as MatrixOperationReturnType<V, T>;
        } else {
            return new Mat4([
                (a[5] * b05 - a[6] * b04 + a[7] * b03) * det,
                (-a[1] * b05 + a[2] * b04 - a[3] * b03) * det,
                (a[13] * a05 - a[14] * a04 + a[15] * a03) * det,
                (-a[9] * a05 + a[10] * a04 - a[11] * a03) * det,
                (-a[4] * b05 + a[6] * b02 - a[7] * b01) * det,
                (a[0] * b05 - a[2] * b02 + a[3] * b01) * det,
                (-a[12] * a05 + a[14] * a02 - a[15] * a01) * det,
                (a[8] * a05 - a[10] * a02 + a[11] * a01) * det,
                (a[4] * b04 - a[5] * b02 + a[7] * b00) * det,
                (-a[0] * b04 + a[1] * b02 - a[3] * b00) * det,
                (a[12] * a04 - a[13] * a02 + a[15] * a00) * det,
                (-a[8] * a04 + a[9] * a02 - a[11] * a00) * det,
                (-a[4] * b03 + a[5] * b01 - a[6] * b00) * det,
                (a[0] * b03 - a[1] * b01 + a[2] * b00) * det,
                (-a[12] * a03 + a[13] * a01 - a[14] * a00) * det,
                (a[8] * a03 - a[9] * a01 + a[10] * a00) * det,
            ]) as MatrixOperationReturnType<V, T>;
        }
    }

    static translate<T extends IVec3Like, V extends IMat4Like | undefined = undefined>(
        v: Readonly<T>,
        out?: V
    ): MatrixOperationReturnType<V, Mat4> {
        if (out) {
            const outData = asMutableMatrix4Data((out as IMutableMat4).data);

            outData[0] = 1;
            outData[1] = 0;
            outData[2] = 0;
            outData[3] = v.x;
            outData[4] = 0;
            outData[5] = 1;
            outData[6] = 0;
            outData[7] = v.y;
            outData[8] = 0;
            outData[9] = 0;
            outData[10] = 1;
            outData[11] = v.z;
            outData[12] = 0;
            outData[13] = 0;
            outData[14] = 0;
            outData[15] = 1;

            return out as MatrixOperationReturnType<V, Mat4>;
        } else {
            return new Mat4([
                1,
                0,
                0,
                v.x,
                0,
                1,
                0,
                v.y,
                0,
                0,
                1,
                v.z,
                0,
                0,
                0,
                1,
            ]) as MatrixOperationReturnType<V, Mat4>;
        }
    }

    static scale<T extends IVec3Like, V extends IMat4Like | undefined = undefined>(
        v: Readonly<T>,
        out?: V
    ): MatrixOperationReturnType<V, Mat4> {
        if (out) {
            const outData = asMutableMatrix4Data((out as IMutableMat4).data);

            outData[0] = v.x;
            outData[1] = 0;
            outData[2] = 0;
            outData[3] = 0;
            outData[4] = 0;
            outData[5] = v.y;
            outData[6] = 0;
            outData[7] = 0;
            outData[8] = 0;
            outData[9] = 0;
            outData[10] = v.z;
            outData[11] = 0;
            outData[12] = 0;
            outData[13] = 0;
            outData[14] = 0;
            outData[15] = 1;

            return out as MatrixOperationReturnType<V, Mat4>;
        } else {
            return new Mat4([
                v.x,
                0,
                0,
                0,
                0,
                v.y,
                0,
                0,
                0,
                0,
                v.z,
                0,
                0,
                0,
                0,
                1,
            ]) as MatrixOperationReturnType<V, Mat4>;
        }
    }

    static rotateX<V extends IMat4Like | undefined = undefined>(
        angle: number,
        out?: V
    ): MatrixOperationReturnType<V, Mat4> {
        const c = Math.cos(angle);
        const s = Math.sin(angle);

        if (out) {
            const outData = asMutableMatrix4Data((out as IMutableMat4).data);

            outData[0] = 1;
            outData[1] = 0;
            outData[2] = 0;
            outData[3] = 0;
            outData[4] = 0;
            outData[5] = c;
            outData[6] = -s;
            outData[7] = 0;
            outData[8] = 0;
            outData[9] = s;
            outData[10] = c;
            outData[11] = 0;
            outData[12] = 0;
            outData[13] = 0;
            outData[14] = 0;
            outData[15] = 1;

            return out as MatrixOperationReturnType<V, Mat4>;
        } else {
            return new Mat4([
                1,
                0,
                0,
                0,
                0,
                c,
                -s,
                0,
                0,
                s,
                c,
                0,
                0,
                0,
                0,
                1,
            ]) as MatrixOperationReturnType<V, Mat4>;
        }
    }

    static rotateY<V extends IMat4Like | undefined = undefined>(
        angle: number,
        out?: V
    ): MatrixOperationReturnType<V, Mat4> {
        const c = Math.cos(angle);
        const s = Math.sin(angle);

        if (out) {
            const outData = asMutableMatrix4Data((out as IMutableMat4).data);

            outData[0] = c;
            outData[1] = 0;
            outData[2] = s;
            outData[3] = 0;
            outData[4] = 0;
            outData[5] = 1;
            outData[6] = 0;
            outData[7] = 0;
            outData[8] = -s;
            outData[9] = 0;
            outData[10] = c;
            outData[11] = 0;
            outData[12] = 0;
            outData[13] = 0;
            outData[14] = 0;
            outData[15] = 1;

            return out as MatrixOperationReturnType<V, Mat4>;
        } else {
            return new Mat4([
                c,
                0,
                s,
                0,
                0,
                1,
                0,
                0,
                -s,
                0,
                c,
                0,
                0,
                0,
                0,
                1,
            ]) as MatrixOperationReturnType<V, Mat4>;
        }
    }

    static rotateZ<V extends IMat4Like | undefined = undefined>(
        angle: number,
        out?: V
    ): MatrixOperationReturnType<V, Mat4> {
        const c = Math.cos(angle);
        const s = Math.sin(angle);

        if (out) {
            const outData = asMutableMatrix4Data((out as IMutableMat4).data);

            outData[0] = c;
            outData[1] = -s;
            outData[2] = 0;
            outData[3] = 0;
            outData[4] = s;
            outData[5] = c;
            outData[6] = 0;
            outData[7] = 0;
            outData[8] = 0;
            outData[9] = 0;
            outData[10] = 1;
            outData[11] = 0;
            outData[12] = 0;
            outData[13] = 0;
            outData[14] = 0;
            outData[15] = 1;

            return out as MatrixOperationReturnType<V, Mat4>;
        } else {
            return new Mat4([
                c,
                -s,
                0,
                0,
                s,
                c,
                0,
                0,
                0,
                0,
                1,
                0,
                0,
                0,
                0,
                1,
            ]) as MatrixOperationReturnType<V, Mat4>;
        }
    }

    static rotateAxis<T extends IVec3Like, V extends IMat4Like | undefined = undefined>(
        axis: Readonly<T>,
        angle: number,
        out?: V
    ): MatrixOperationReturnType<V, Mat4> {
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
            const outData = asMutableMatrix4Data((out as IMutableMat4).data);

            outData[0] = m00;
            outData[1] = m01;
            outData[2] = m02;
            outData[3] = 0;
            outData[4] = m10;
            outData[5] = m11;
            outData[6] = m12;
            outData[7] = 0;
            outData[8] = m20;
            outData[9] = m21;
            outData[10] = m22;
            outData[11] = 0;
            outData[12] = 0;
            outData[13] = 0;
            outData[14] = 0;
            outData[15] = 1;

            return out as MatrixOperationReturnType<V, Mat4>;
        } else {
            return new Mat4([
                m00,
                m01,
                m02,
                0,
                m10,
                m11,
                m12,
                0,
                m20,
                m21,
                m22,
                0,
                0,
                0,
                0,
                1,
            ]) as MatrixOperationReturnType<V, Mat4>;
        }
    }

    static perspective<V extends IMat4Like | undefined = undefined>(
        fovy: number,
        aspect: number,
        near: number,
        far: number,
        out?: V
    ): MatrixOperationReturnType<V, Mat4> {
        if (Math.abs(near - far) < EPSILON) {
            throw new Error('Near and far planes cannot be equal');
        }

        if (Math.abs(aspect) < EPSILON) {
            throw new Error('Aspect ratio cannot be zero');
        }

        const f = 1.0 / Math.tan(fovy * 0.5);
        const nf = 1.0 / (near - far);

        if (out) {
            const outData = asMutableMatrix4Data((out as IMutableMat4).data);

            outData[0] = f / aspect;
            outData[1] = 0;
            outData[2] = 0;
            outData[3] = 0;
            outData[4] = 0;
            outData[5] = f;
            outData[6] = 0;
            outData[7] = 0;
            outData[8] = 0;
            outData[9] = 0;
            outData[10] = (far + near) * nf;
            outData[11] = 2 * far * near * nf;
            outData[12] = 0;
            outData[13] = 0;
            outData[14] = -1;
            outData[15] = 0;

            return out as MatrixOperationReturnType<V, Mat4>;
        } else {
            return new Mat4([
                f / aspect,
                0,
                0,
                0,
                0,
                f,
                0,
                0,
                0,
                0,
                (far + near) * nf,
                2 * far * near * nf,
                0,
                0,
                -1,
                0,
            ]) as MatrixOperationReturnType<V, Mat4>;
        }
    }

    static orthographic<V extends IMat4Like | undefined = undefined>(
        left: number,
        right: number,
        bottom: number,
        top: number,
        near: number,
        far: number,
        out?: V
    ): MatrixOperationReturnType<V, Mat4> {
        const lr = 1.0 / (left - right);
        const bt = 1.0 / (bottom - top);
        const nf = 1.0 / (near - far);

        if (out) {
            const outData = asMutableMatrix4Data((out as IMutableMat4).data);

            outData[0] = -2 * lr;
            outData[1] = 0;
            outData[2] = 0;
            outData[3] = (left + right) * lr;
            outData[4] = 0;
            outData[5] = -2 * bt;
            outData[6] = 0;
            outData[7] = (top + bottom) * bt;
            outData[8] = 0;
            outData[9] = 0;
            outData[10] = 2 * nf;
            outData[11] = (far + near) * nf;
            outData[12] = 0;
            outData[13] = 0;
            outData[14] = 0;
            outData[15] = 1;

            return out as MatrixOperationReturnType<V, Mat4>;
        } else {
            return new Mat4([
                -2 * lr,
                0,
                0,
                (left + right) * lr,
                0,
                -2 * bt,
                0,
                (top + bottom) * bt,
                0,
                0,
                2 * nf,
                (far + near) * nf,
                0,
                0,
                0,
                1,
            ]) as MatrixOperationReturnType<V, Mat4>;
        }
    }

    static lookAt<
        T extends IVec3Like,
        U extends IVec3Like,
        W extends IVec3Like,
        V extends IMat4Like | undefined = undefined,
    >(
        eye: Readonly<T>,
        center: Readonly<U>,
        up: Readonly<W>,
        out?: V
    ): MatrixOperationReturnType<V, Mat4> {
        const eyeX = eye.x,
            eyeY = eye.y,
            eyeZ = eye.z;
        const centerX = center.x,
            centerY = center.y,
            centerZ = center.z;
        const upX = up.x,
            upY = up.y,
            upZ = up.z;

        if (
            Math.abs(eyeX - centerX) < EPSILON &&
            Math.abs(eyeY - centerY) < EPSILON &&
            Math.abs(eyeZ - centerZ) < EPSILON
        ) {
            if (out) {
                const outData = asMutableMatrix4Data((out as IMutableMat4).data);
                outData[0] = 1;
                outData[1] = 0;
                outData[2] = 0;
                outData[3] = 0;
                outData[4] = 0;
                outData[5] = 1;
                outData[6] = 0;
                outData[7] = 0;
                outData[8] = 0;
                outData[9] = 0;
                outData[10] = 1;
                outData[11] = 0;
                outData[12] = 0;
                outData[13] = 0;
                outData[14] = 0;
                outData[15] = 1;
                return out as MatrixOperationReturnType<V, Mat4>;
            } else {
                return new Mat4() as MatrixOperationReturnType<V, Mat4>;
            }
        }

        let z0 = eyeX - centerX,
            z1 = eyeY - centerY,
            z2 = eyeZ - centerZ;
        let len = 1 / Math.sqrt(z0 * z0 + z1 * z1 + z2 * z2);
        z0 *= len;
        z1 *= len;
        z2 *= len;

        let x0 = upY * z2 - upZ * z1;
        let x1 = upZ * z0 - upX * z2;
        let x2 = upX * z1 - upY * z0;

        len = Math.sqrt(x0 * x0 + x1 * x1 + x2 * x2);
        if (len < EPSILON) {
            x0 = x1 = x2 = 0;
        } else {
            len = 1 / len;
            x0 *= len;
            x1 *= len;
            x2 *= len;
        }

        let y0 = z1 * x2 - z2 * x1;
        let y1 = z2 * x0 - z0 * x2;
        let y2 = z0 * x1 - z1 * x0;

        len = Math.sqrt(y0 * y0 + y1 * y1 + y2 * y2);
        if (len < EPSILON) {
            y0 = y1 = y2 = 0;
        } else {
            len = 1 / len;
            y0 *= len;
            y1 *= len;
            y2 *= len;
        }

        if (out) {
            const outData = asMutableMatrix4Data((out as IMutableMat4).data);

            outData[0] = x0;
            outData[1] = y0;
            outData[2] = z0;
            outData[3] = 0;
            outData[4] = x1;
            outData[5] = y1;
            outData[6] = z1;
            outData[7] = 0;
            outData[8] = x2;
            outData[9] = y2;
            outData[10] = z2;
            outData[11] = 0;
            outData[12] = -(x0 * eyeX + x1 * eyeY + x2 * eyeZ);
            outData[13] = -(y0 * eyeX + y1 * eyeY + y2 * eyeZ);
            outData[14] = -(z0 * eyeX + z1 * eyeY + z2 * eyeZ);
            outData[15] = 1;

            return out as MatrixOperationReturnType<V, Mat4>;
        } else {
            return new Mat4([
                x0,
                y0,
                z0,
                0,
                x1,
                y1,
                z1,
                0,
                x2,
                y2,
                z2,
                0,
                -(x0 * eyeX + x1 * eyeY + x2 * eyeZ),
                -(y0 * eyeX + y1 * eyeY + y2 * eyeZ),
                -(z0 * eyeX + z1 * eyeY + z2 * eyeZ),
                1,
            ]) as MatrixOperationReturnType<V, Mat4>;
        }
    }

    static transformVec3<
        T extends IVec3Like,
        U extends IMat4Like,
        V extends IVec3Like | undefined = undefined,
    >(v: Readonly<T>, m: Readonly<U>, out?: V): V extends undefined ? T : V {
        const x = v.x,
            y = v.y,
            z = v.z;

        if (out) {
            out.x = m.data[0] * x + m.data[1] * y + m.data[2] * z + m.data[3];
            out.y = m.data[4] * x + m.data[5] * y + m.data[6] * z + m.data[7];
            out.z = m.data[8] * x + m.data[9] * y + m.data[10] * z + m.data[11];
            return out as V extends undefined ? T : V;
        } else {
            return {
                x: m.data[0] * x + m.data[1] * y + m.data[2] * z + m.data[3],
                y: m.data[4] * x + m.data[5] * y + m.data[6] * z + m.data[7],
                z: m.data[8] * x + m.data[9] * y + m.data[10] * z + m.data[11],
            } as V extends undefined ? T : V;
        }
    }

    static transformVec4<
        T extends IVec4Like,
        U extends IMat4Like,
        V extends IVec4Like | undefined = undefined,
    >(v: Readonly<T>, m: Readonly<U>, out?: V): V extends undefined ? T : V {
        const x = v.x,
            y = v.y,
            z = v.z,
            w = v.w;

        if (out) {
            out.x = m.data[0] * x + m.data[1] * y + m.data[2] * z + m.data[3] * w;
            out.y = m.data[4] * x + m.data[5] * y + m.data[6] * z + m.data[7] * w;
            out.z = m.data[8] * x + m.data[9] * y + m.data[10] * z + m.data[11] * w;
            out.w = m.data[12] * x + m.data[13] * y + m.data[14] * z + m.data[15] * w;
            return out as V extends undefined ? T : V;
        } else {
            return {
                x: m.data[0] * x + m.data[1] * y + m.data[2] * z + m.data[3] * w,
                y: m.data[4] * x + m.data[5] * y + m.data[6] * z + m.data[7] * w,
                z: m.data[8] * x + m.data[9] * y + m.data[10] * z + m.data[11] * w,
                w: m.data[12] * x + m.data[13] * y + m.data[14] * z + m.data[15] * w,
            } as V extends undefined ? T : V;
        }
    }

    static lerp<
        T extends IMat4Like,
        U extends IMat4Like,
        V extends IMat4Like | undefined = undefined,
    >(a: Readonly<T>, b: Readonly<U>, t: number, out?: V): MatrixOperationReturnType<V, T> {
        const t1 = clamp01(t);

        if (out) {
            const outData = asMutableMatrix4Data((out as IMutableMat4).data);
            for (let i = 0; i < 16; i++) {
                outData[i] = a.data[i] + (b.data[i] - a.data[i]) * t1;
            }
            return out as MatrixOperationReturnType<V, T>;
        } else {
            const result = new Array(16);
            for (let i = 0; i < 16; i++) {
                result[i] = a.data[i] + (b.data[i] - a.data[i]) * t1;
            }
            return new Mat4(result) as MatrixOperationReturnType<V, T>;
        }
    }

    static lerpUnClamped<
        T extends IMat4Like,
        U extends IMat4Like,
        V extends IMat4Like | undefined = undefined,
    >(a: Readonly<T>, b: Readonly<U>, t: number, out?: V): MatrixOperationReturnType<V, T> {
        if (out) {
            const outData = asMutableMatrix4Data((out as IMutableMat4).data);
            for (let i = 0; i < 16; i++) {
                outData[i] = a.data[i] + (b.data[i] - a.data[i]) * t;
            }
            return out as MatrixOperationReturnType<V, T>;
        } else {
            const result = new Array(16);
            for (let i = 0; i < 16; i++) {
                result[i] = a.data[i] + (b.data[i] - a.data[i]) * t;
            }
            return new Mat4(result) as MatrixOperationReturnType<V, T>;
        }
    }

    multiply<T extends IMat4Like>(other: Readonly<T>): Mat4 {
        return Mat4.multiply(this, other, this);
    }

    transpose(): Mat4 {
        return Mat4.transpose(this, this);
    }

    determinant(): number {
        return Mat4.determinant(this);
    }

    invert(): Mat4 {
        return Mat4.invert(this, this);
    }

    transformVec3<T extends IVec3Like>(v: Readonly<T>, out?: T): T {
        return Mat4.transformVec3(v, this, out) as T;
    }

    transformVec4<T extends IVec4Like>(v: Readonly<T>, out?: T): T {
        return Mat4.transformVec4(v, this, out) as T;
    }

    toArray(): number[] {
        return [...this.data];
    }

    toString(): string {
        const d = this.data;
        return `Mat4(
  [${d[0].toFixed(3)}, ${d[1].toFixed(3)}, ${d[2].toFixed(3)}, ${d[3].toFixed(3)}]
  [${d[4].toFixed(3)}, ${d[5].toFixed(3)}, ${d[6].toFixed(3)}, ${d[7].toFixed(3)}]
  [${d[8].toFixed(3)}, ${d[9].toFixed(3)}, ${d[10].toFixed(3)}, ${d[11].toFixed(3)}]
  [${d[12].toFixed(3)}, ${d[13].toFixed(3)}, ${d[14].toFixed(3)}, ${d[15].toFixed(3)}]
)`;
    }

    static fromQuaternion<T extends IQuatLike, V extends IMat4Like | undefined = undefined>(
        quat: Readonly<T>,
        out?: V
    ): MatrixOperationReturnType<V, Mat4> {
        const { x, y, z, w } = quat;

        const length = Math.sqrt(x * x + y * y + z * z + w * w);
        if (length < EPSILON) {
            throw new Error('Cannot create rotation matrix from zero-length quaternion');
        }

        const invLength = 1.0 / length;
        const nx = x * invLength;
        const ny = y * invLength;
        const nz = z * invLength;
        const nw = w * invLength;

        const x2 = nx + nx;
        const y2 = ny + ny;
        const z2 = nz + nz;
        const xx = nx * x2;
        const xy = nx * y2;
        const xz = nx * z2;
        const yy = ny * y2;
        const yz = ny * z2;
        const zz = nz * z2;
        const wx = nw * x2;
        const wy = nw * y2;
        const wz = nw * z2;

        const result = out || new Mat4();
        const data = asMutableMatrix4Data((result as IMutableMat4).data);

        data[0] = 1 - (yy + zz);
        data[1] = xy - wz;
        data[2] = xz + wy;
        data[3] = 0;
        data[4] = xy + wz;
        data[5] = 1 - (xx + zz);
        data[6] = yz - wx;
        data[7] = 0;
        data[8] = xz - wy;
        data[9] = yz + wx;
        data[10] = 1 - (xx + yy);
        data[11] = 0;
        data[12] = 0;
        data[13] = 0;
        data[14] = 0;
        data[15] = 1;

        return result as MatrixOperationReturnType<V, Mat4>;
    }

    static fromTRS<
        T extends IVec3Like,
        R extends IQuatLike,
        S extends IVec3Like,
        V extends IMat4Like | undefined = undefined,
    >(
        translation: Readonly<T>,
        rotation: Readonly<R>,
        scale: Readonly<S>,
        out?: V
    ): MatrixOperationReturnType<V, Mat4> {
        const rotationMatrix = Mat4.fromQuaternion(rotation);

        const translationMatrix = Mat4.translate(translation);

        const scaleMatrix = Mat4.scale(scale);

        const temp = Mat4.multiply(translationMatrix, rotationMatrix);
        const result = Mat4.multiply(temp, scaleMatrix, out);

        return result as MatrixOperationReturnType<V, Mat4>;
    }
}

export enum Mat4ComparisonMode {
    FROBENIUS_NORM,
    DETERMINANT,
    TRACE,
    CONDITION_NUMBER,
}

export class Mat4Comparer implements Comparer<Mat4> {
    private readonly mode: Mat4ComparisonMode;

    constructor(mode: Mat4ComparisonMode = Mat4ComparisonMode.FROBENIUS_NORM) {
        this.mode = mode;
    }

    compare(a: Readonly<Mat4>, b: Readonly<Mat4>): CompareResult {
        switch (this.mode) {
            case Mat4ComparisonMode.FROBENIUS_NORM: {
                let normA = 0,
                    normB = 0;
                for (let i = 0; i < 16; i++) {
                    normA += a.data[i] * a.data[i];
                    normB += b.data[i] * b.data[i];
                }
                normA = Math.sqrt(normA);
                normB = Math.sqrt(normB);
                if (Math.abs(normA - normB) < EPSILON) return 0;
                return normA < normB ? -1 : 1;
            }

            case Mat4ComparisonMode.DETERMINANT: {
                const detA = Mat4.determinant(a);
                const detB = Mat4.determinant(b);
                if (Math.abs(detA - detB) < EPSILON) return 0;
                return detA < detB ? -1 : 1;
            }

            case Mat4ComparisonMode.TRACE: {
                const traceA = a.data[0] + a.data[5] + a.data[10] + a.data[15];
                const traceB = b.data[0] + b.data[5] + b.data[10] + b.data[15];
                if (Math.abs(traceA - traceB) < EPSILON) return 0;
                return traceA < traceB ? -1 : 1;
            }

            case Mat4ComparisonMode.CONDITION_NUMBER: {
                let maxA = 0,
                    minA = Infinity,
                    maxB = 0,
                    minB = Infinity;

                for (let i = 0; i < 16; i++) {
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
                throw new Error(`Unsupported Mat4 comparison mode: ${this.mode}`);
        }
    }
}
