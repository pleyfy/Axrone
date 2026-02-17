import { Comparer, CompareResult, EqualityComparer, Equatable, ICloneable } from '@axrone/utility';
import { EPSILON, HALF_PI, PI_2 } from './common';
import { IVec2Like } from './vec2';
import { clamp01 } from './clamp';

declare const __matrix2Brand: unique symbol;
declare const __mutableBrand: unique symbol;
declare const __vec2Brand: unique symbol;

type Matrix2Data = number[] & { readonly [__matrix2Brand]: true };
type MutableMatrix2Data = number[] & {
    readonly [__matrix2Brand]: true;
    readonly [__mutableBrand]: true;
};

export interface IMat2Like<TData extends ArrayLike<number> = ArrayLike<number>> {
    readonly data: TData;
}

interface IMutableMat2<TData extends number[] = number[]> extends IMat2Like<TData> {
    data: TData;
}

type InferMatrixData<T> = T extends { data: infer U } ? U : never;

type IsMatrix2Compatible<T> = T extends { data: ArrayLike<number> } ? true : false;

type IsMutableMatrix2<T> = T extends { data: number[] } ? true : false;

type MatrixOperationReturnType<
    TOut extends IMat2Like | undefined,
    TDefault extends IMat2Like,
    TSecond extends IMat2Like = TDefault,
> = TOut extends IMutableMat2<infer U> ? TOut : TOut extends undefined ? Mat2 : never;

const asMutableMatrix2Data = <T extends number[]>(data: T): T & MutableMatrix2Data => {
    return data as T & MutableMatrix2Data;
};

const ensureMatrix2Data = <T extends ArrayLike<number>>(data: T): T & Matrix2Data => {
    return data as T & Matrix2Data;
};

export class Mat2 implements IMat2Like<Matrix2Data>, ICloneable<Mat2>, Equatable {
    public readonly data: Matrix2Data;

    constructor(values?: ArrayLike<number>) {
        if (values) {
            if (values.length < 4) {
                throw new RangeError('Matrix values array must have at least 4 elements');
            }

            this.data = [values[0], values[1], values[2], values[3]] as Matrix2Data;
        } else {
            // Identity matrix
            this.data = [1, 0, 0, 1] as Matrix2Data;
        }
    }

    static readonly IDENTITY: Readonly<Mat2> = Object.freeze(new Mat2());
    static readonly ZERO: Readonly<Mat2> = Object.freeze(new Mat2([0, 0, 0, 0]));

    static from<T extends IMat2Like>(m: Readonly<T>): Mat2 {
        return new Mat2(m.data);
    }

    static fromArray(arr: ArrayLike<number>, offset: number = 0): Mat2 {
        if (process.env.NODE_ENV === 'development') {
            if (offset < 0) {
                throw new RangeError('Offset cannot be negative');
            }
            if (arr.length < offset + 4) {
                throw new RangeError(
                    `Array must have at least ${offset + 4} elements when using offset ${offset}`
                );
            }
        }

        const values = Array.isArray(arr)
            ? arr.slice(offset, offset + 4)
            : Array.from(arr).slice(offset, offset + 4);

        return new Mat2(values);
    }

    static create(m00: number = 1, m01: number = 0, m10: number = 0, m11: number = 1): Mat2 {
        return new Mat2([m00, m01, m10, m11]);
    }

    static createFromElements(m00: number, m01: number, m10: number, m11: number): Mat2 {
        return new Mat2([m00, m01, m10, m11]);
    }

    clone(): Mat2 {
        return new Mat2(this.data);
    }

    equals(other: unknown): boolean {
        if (!(other instanceof Mat2)) return false;

        const a = this.data;
        const b = other.data;

        return (
            Math.abs(a[0] - b[0]) < EPSILON &&
            Math.abs(a[1] - b[1]) < EPSILON &&
            Math.abs(a[2] - b[2]) < EPSILON &&
            Math.abs(a[3] - b[3]) < EPSILON
        );
    }

    getHashCode(): number {
        let h1 = 2166136261;
        for (let i = 0; i < 4; i++) {
            h1 = Math.imul(h1 ^ Math.floor(this.data[i] * 1000), 16777619);
        }
        return h1 >>> 0;
    }

    static multiply<
        TMatA extends IMat2Like,
        TMatB extends IMat2Like,
        TOut extends IMat2Like | undefined = undefined,
    >(
        a: Readonly<TMatA>,
        b: Readonly<TMatB>,
        out?: TOut
    ): MatrixOperationReturnType<TOut, TMatA, TMatB> {
        const a00 = a.data[0],
            a01 = a.data[1];
        const a10 = a.data[2],
            a11 = a.data[3];

        const b00 = b.data[0],
            b01 = b.data[1];
        const b10 = b.data[2],
            b11 = b.data[3];

        if (out) {
            const outData = asMutableMatrix2Data((out as IMutableMat2).data);

            outData[0] = a00 * b00 + a01 * b10;
            outData[1] = a00 * b01 + a01 * b11;
            outData[2] = a10 * b00 + a11 * b10;
            outData[3] = a10 * b01 + a11 * b11;

            return out as MatrixOperationReturnType<TOut, TMatA, TMatB>;
        } else {
            return new Mat2([
                a00 * b00 + a01 * b10,
                a00 * b01 + a01 * b11,
                a10 * b00 + a11 * b10,
                a10 * b01 + a11 * b11,
            ]) as MatrixOperationReturnType<TOut, TMatA, TMatB>;
        }
    }

    static transpose<T extends IMat2Like, V extends IMat2Like | undefined = undefined>(
        m: Readonly<T>,
        out?: V
    ): MatrixOperationReturnType<V, T> {
        if (out) {
            const outData = asMutableMatrix2Data((out as IMutableMat2).data);

            outData[0] = m.data[0];
            outData[1] = m.data[2];
            outData[2] = m.data[1];
            outData[3] = m.data[3];

            return out as MatrixOperationReturnType<V, T>;
        } else {
            return new Mat2([
                m.data[0],
                m.data[2],
                m.data[1],
                m.data[3],
            ]) as MatrixOperationReturnType<V, T>;
        }
    }

    static determinant<T extends IMat2Like>(m: Readonly<T>): number {
        const a = m.data;
        return a[0] * a[3] - a[1] * a[2];
    }

    static invert<T extends IMat2Like, V extends IMat2Like | undefined = undefined>(
        m: Readonly<T>,
        out?: V
    ): MatrixOperationReturnType<V, T> {
        const a = m.data;

        const a00 = a[0],
            a01 = a[1];
        const a10 = a[2],
            a11 = a[3];

        let det = a00 * a11 - a01 * a10;

        if (Math.abs(det) < EPSILON) {
            throw new Error('Matrix is not invertible (determinant is zero or near-zero)');
        }

        det = 1.0 / det;

        if (out) {
            const outData = asMutableMatrix2Data((out as IMutableMat2).data);

            outData[0] = a11 * det;
            outData[1] = -a01 * det;
            outData[2] = -a10 * det;
            outData[3] = a00 * det;

            return out as MatrixOperationReturnType<V, T>;
        } else {
            return new Mat2([
                a11 * det,
                -a01 * det,
                -a10 * det,
                a00 * det,
            ]) as MatrixOperationReturnType<V, T>;
        }
    }

    static translate<T extends IVec2Like, V extends IMat2Like | undefined = undefined>(
        v: Readonly<T>,
        out?: V
    ): MatrixOperationReturnType<V, Mat2> {
        if (out) {
            const outData = asMutableMatrix2Data((out as IMutableMat2).data);

            outData[0] = 1;
            outData[1] = v.x;
            outData[2] = 0;
            outData[3] = 1;

            return out as MatrixOperationReturnType<V, Mat2>;
        } else {
            return new Mat2([1, v.x, 0, 1]) as MatrixOperationReturnType<V, Mat2>;
        }
    }

    static scale<T extends IVec2Like, V extends IMat2Like | undefined = undefined>(
        v: Readonly<T>,
        out?: V
    ): MatrixOperationReturnType<V, Mat2> {
        if (out) {
            const outData = asMutableMatrix2Data((out as IMutableMat2).data);

            outData[0] = v.x;
            outData[1] = 0;
            outData[2] = 0;
            outData[3] = v.y;

            return out as MatrixOperationReturnType<V, Mat2>;
        } else {
            return new Mat2([v.x, 0, 0, v.y]) as MatrixOperationReturnType<V, Mat2>;
        }
    }

    static scaleUniform<V extends IMat2Like | undefined = undefined>(
        scale: number,
        out?: V
    ): MatrixOperationReturnType<V, Mat2> {
        if (out) {
            const outData = asMutableMatrix2Data((out as IMutableMat2).data);

            outData[0] = scale;
            outData[1] = 0;
            outData[2] = 0;
            outData[3] = scale;

            return out as MatrixOperationReturnType<V, Mat2>;
        } else {
            return new Mat2([scale, 0, 0, scale]) as MatrixOperationReturnType<V, Mat2>;
        }
    }

    static rotate<V extends IMat2Like | undefined = undefined>(
        angle: number,
        out?: V
    ): MatrixOperationReturnType<V, Mat2> {
        const c = Math.cos(angle);
        const s = Math.sin(angle);

        if (out) {
            const outData = asMutableMatrix2Data((out as IMutableMat2).data);

            outData[0] = c;
            outData[1] = -s;
            outData[2] = s;
            outData[3] = c;

            return out as MatrixOperationReturnType<V, Mat2>;
        } else {
            return new Mat2([c, -s, s, c]) as MatrixOperationReturnType<V, Mat2>;
        }
    }

    static shear<V extends IMat2Like | undefined = undefined>(
        shearX: number,
        shearY: number,
        out?: V
    ): MatrixOperationReturnType<V, Mat2> {
        if (out) {
            const outData = asMutableMatrix2Data((out as IMutableMat2).data);

            outData[0] = 1;
            outData[1] = shearX;
            outData[2] = shearY;
            outData[3] = 1;

            return out as MatrixOperationReturnType<V, Mat2>;
        } else {
            return new Mat2([1, shearX, shearY, 1]) as MatrixOperationReturnType<V, Mat2>;
        }
    }

    static transformVec2<
        T extends IVec2Like,
        U extends IMat2Like,
        V extends IVec2Like | undefined = undefined,
    >(v: Readonly<T>, m: Readonly<U>, out?: V): V extends undefined ? T : V {
        const x = v.x,
            y = v.y;

        if (out) {
            out.x = m.data[0] * x + m.data[1] * y;
            out.y = m.data[2] * x + m.data[3] * y;
            return out as V extends undefined ? T : V;
        } else {
            return {
                x: m.data[0] * x + m.data[1] * y,
                y: m.data[2] * x + m.data[3] * y,
            } as V extends undefined ? T : V;
        }
    }

    static lerp<
        T extends IMat2Like,
        U extends IMat2Like,
        V extends IMat2Like | undefined = undefined,
    >(a: Readonly<T>, b: Readonly<U>, t: number, out?: V): MatrixOperationReturnType<V, T> {
        const t1 = clamp01(t);

        if (out) {
            const outData = asMutableMatrix2Data((out as IMutableMat2).data);
            for (let i = 0; i < 4; i++) {
                outData[i] = a.data[i] + (b.data[i] - a.data[i]) * t1;
            }
            return out as MatrixOperationReturnType<V, T>;
        } else {
            const result = new Array(4);
            for (let i = 0; i < 4; i++) {
                result[i] = a.data[i] + (b.data[i] - a.data[i]) * t1;
            }
            return new Mat2(result) as MatrixOperationReturnType<V, T>;
        }
    }

    static lerpUnClamped<
        T extends IMat2Like,
        U extends IMat2Like,
        V extends IMat2Like | undefined = undefined,
    >(a: Readonly<T>, b: Readonly<U>, t: number, out?: V): MatrixOperationReturnType<V, T> {
        if (out) {
            const outData = asMutableMatrix2Data((out as IMutableMat2).data);
            for (let i = 0; i < 4; i++) {
                outData[i] = a.data[i] + (b.data[i] - a.data[i]) * t;
            }
            return out as MatrixOperationReturnType<V, T>;
        } else {
            const result = new Array(4);
            for (let i = 0; i < 4; i++) {
                result[i] = a.data[i] + (b.data[i] - a.data[i]) * t;
            }
            return new Mat2(result) as MatrixOperationReturnType<V, T>;
        }
    }

    // Instance methods
    multiply<T extends IMat2Like>(other: Readonly<T>): Mat2 {
        return Mat2.multiply(this, other, this);
    }

    transpose(): Mat2 {
        return Mat2.transpose(this, this);
    }

    determinant(): number {
        return Mat2.determinant(this);
    }

    invert(): Mat2 {
        return Mat2.invert(this, this);
    }

    transformVec2<T extends IVec2Like>(v: Readonly<T>, out?: T): T {
        return Mat2.transformVec2(v, this, out) as T;
    }

    toArray(): number[] {
        return [...this.data];
    }

    toString(): string {
        const d = this.data;
        return `Mat2(
  [${d[0].toFixed(3)}, ${d[1].toFixed(3)}]
  [${d[2].toFixed(3)}, ${d[3].toFixed(3)}]
)`;
    }
}

export enum Mat2ComparisonMode {
    FROBENIUS_NORM,
    DETERMINANT,
    TRACE,
    CONDITION_NUMBER,
}

export class Mat2Comparer implements Comparer<Mat2> {
    private readonly mode: Mat2ComparisonMode;

    constructor(mode: Mat2ComparisonMode = Mat2ComparisonMode.FROBENIUS_NORM) {
        this.mode = mode;
    }

    compare(a: Readonly<Mat2>, b: Readonly<Mat2>): CompareResult {
        switch (this.mode) {
            case Mat2ComparisonMode.FROBENIUS_NORM: {
                let normA = 0,
                    normB = 0;
                for (let i = 0; i < 4; i++) {
                    normA += a.data[i] * a.data[i];
                    normB += b.data[i] * b.data[i];
                }
                normA = Math.sqrt(normA);
                normB = Math.sqrt(normB);
                if (Math.abs(normA - normB) < EPSILON) return 0;
                return normA < normB ? -1 : 1;
            }

            case Mat2ComparisonMode.DETERMINANT: {
                const detA = Mat2.determinant(a);
                const detB = Mat2.determinant(b);
                if (Math.abs(detA - detB) < EPSILON) return 0;
                return detA < detB ? -1 : 1;
            }

            case Mat2ComparisonMode.TRACE: {
                const traceA = a.data[0] + a.data[3];
                const traceB = b.data[0] + b.data[3];
                if (Math.abs(traceA - traceB) < EPSILON) return 0;
                return traceA < traceB ? -1 : 1;
            }

            case Mat2ComparisonMode.CONDITION_NUMBER: {
                let maxA = 0,
                    minA = Infinity,
                    maxB = 0,
                    minB = Infinity;

                for (let i = 0; i < 4; i++) {
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
                throw new Error(`Unsupported Mat2 comparison mode: ${this.mode}`);
        }
    }
}
