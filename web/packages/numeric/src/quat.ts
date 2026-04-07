import { Comparer, CompareResult, EqualityComparer, Equatable, ICloneable } from '@axrone/utility';
import { EPSILON } from './common';
import { clamp01 } from './clamp';
import { IVec3Like } from './vec3';

export interface IQuatLike {
    x: number;
    y: number;
    z: number;
    w: number;
}

export class Quat implements IQuatLike, ICloneable<Quat>, Equatable {
    constructor(
        public x: number = 0,
        public y: number = 0,
        public z: number = 0,
        public w: number = 1
    ) {}

    static readonly ZERO: Readonly<Quat> = Object.freeze(new Quat(0, 0, 0, 0));
    static readonly IDENTITY: Readonly<Quat> = Object.freeze(new Quat(0, 0, 0, 1));
    static readonly UNIT_X: Readonly<Quat> = Object.freeze(new Quat(1, 0, 0, 0));
    static readonly UNIT_Y: Readonly<Quat> = Object.freeze(new Quat(0, 1, 0, 0));
    static readonly UNIT_Z: Readonly<Quat> = Object.freeze(new Quat(0, 0, 1, 0));
    static readonly UNIT_W: Readonly<Quat> = Object.freeze(new Quat(0, 0, 0, 1));

    static from<T extends IQuatLike>(q: Readonly<T>): Quat {
        return new Quat(q.x, q.y, q.z, q.w);
    }

    static fromArray(arr: ArrayLike<number>, offset: number = 0): Quat {
        if (offset < 0) {
            throw new RangeError('Offset cannot be negative');
        }

        if (arr.length < offset + 4) {
            throw new RangeError(
                `Array must have at least ${offset + 4} elements when using offset ${offset}`
            );
        }

        return new Quat(
            Number(arr[offset]),
            Number(arr[offset + 1]),
            Number(arr[offset + 2]),
            Number(arr[offset + 3])
        );
    }

    static create(x: number = 0, y: number = 0, z: number = 0, w: number = 1): Quat {
        return new Quat(x, y, z, w);
    }

    clone(): Quat {
        return new Quat(this.x, this.y, this.z, this.w);
    }

    equals(other: unknown): boolean {
        if (!(other instanceof Quat)) return false;
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

    static add<T extends IQuatLike, U extends IQuatLike, V extends IQuatLike>(
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

    static addScalar<T extends IQuatLike, V extends IQuatLike>(
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

    static subtract<T extends IQuatLike, U extends IQuatLike, V extends IQuatLike>(
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

    static subtractScalar<T extends IQuatLike, V extends IQuatLike>(
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

    static multiplyScalar<T extends IQuatLike, V extends IQuatLike>(
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

    static divideScalar<T extends IQuatLike, V extends IQuatLike>(
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

    static negate<T extends IQuatLike, V extends IQuatLike>(a: Readonly<T>, out?: V): V {
        if (out) {
            out.x = -a.x;
            out.y = -a.y;
            out.z = -a.z;
            out.w = -a.w;
            return out;
        } else {
            return { x: -a.x, y: -a.y, z: -a.z, w: -a.w } as V;
        }
    }

    static multiply<T extends IQuatLike, U extends IQuatLike, V extends IQuatLike>(
        a: Readonly<T>,
        b: Readonly<U>,
        out?: V
    ): V {
        const ax = a.x,
            ay = a.y,
            az = a.z,
            aw = a.w;
        const bx = b.x,
            by = b.y,
            bz = b.z,
            bw = b.w;

        if (out) {
            out.x = ax * bw + aw * bx + ay * bz - az * by;
            out.y = ay * bw + aw * by + az * bx - ax * bz;
            out.z = az * bw + aw * bz + ax * by - ay * bx;
            out.w = aw * bw - ax * bx - ay * by - az * bz;
            return out;
        } else {
            return {
                x: ax * bw + aw * bx + ay * bz - az * by,
                y: ay * bw + aw * by + az * bx - ax * bz,
                z: az * bw + aw * bz + ax * by - ay * bx,
                w: aw * bw - ax * bx - ay * by - az * bz,
            } as V;
        }
    }

    static dot<T extends IQuatLike, U extends IQuatLike>(a: Readonly<T>, b: Readonly<U>): number {
        return a.x * b.x + a.y * b.y + a.z * b.z + a.w * b.w;
    }

    static lengthSquared<T extends IQuatLike>(q: Readonly<T>): number {
        return q.x * q.x + q.y * q.y + q.z * q.z + q.w * q.w;
    }

    static len<T extends IQuatLike>(q: Readonly<T>): number {
        return Math.sqrt(q.x * q.x + q.y * q.y + q.z * q.z + q.w * q.w);
    }

    static normalize<T extends IQuatLike, V extends IQuatLike>(q: Readonly<T>, out?: V): V {
        const length = Math.sqrt(q.x * q.x + q.y * q.y + q.z * q.z + q.w * q.w);
        if (length < EPSILON) {
            throw new Error('Cannot normalize a zero-length quaternion');
        }

        if (out) {
            out.x = q.x / length;
            out.y = q.y / length;
            out.z = q.z / length;
            out.w = q.w / length;
            return out;
        } else {
            return { x: q.x / length, y: q.y / length, z: q.z / length, w: q.w / length } as V;
        }
    }

    static conjugate<T extends IQuatLike, V extends IQuatLike>(q: Readonly<T>, out?: V): V {
        if (out) {
            out.x = -q.x;
            out.y = -q.y;
            out.z = -q.z;
            out.w = q.w;
            return out;
        } else {
            return { x: -q.x, y: -q.y, z: -q.z, w: q.w } as V;
        }
    }

    static inverse<T extends IQuatLike, V extends IQuatLike>(q: Readonly<T>, out?: V): V {
        const lenSq = q.x * q.x + q.y * q.y + q.z * q.z + q.w * q.w;
        if (lenSq < EPSILON) {
            throw new Error('Cannot invert a zero-length quaternion');
        }

        const invLenSq = 1.0 / lenSq;
        if (out) {
            out.x = -q.x * invLenSq;
            out.y = -q.y * invLenSq;
            out.z = -q.z * invLenSq;
            out.w = q.w * invLenSq;
            return out;
        } else {
            return {
                x: -q.x * invLenSq,
                y: -q.y * invLenSq,
                z: -q.z * invLenSq,
                w: q.w * invLenSq,
            } as V;
        }
    }

    static fastInverse<T extends IQuatLike, V extends IQuatLike>(q: Readonly<T>, out?: V): V {
        return Quat.conjugate(q, out);
    }

    static fromAxisAngle<T extends IVec3Like, V extends IQuatLike>(
        axis: Readonly<T>,
        angle: number,
        out?: V
    ): V {
        const halfAngle = angle * 0.5;
        const sinHalfAngle = Math.sin(halfAngle);
        const x = axis.x * sinHalfAngle;
        const y = axis.y * sinHalfAngle;
        const z = axis.z * sinHalfAngle;
        const w = Math.cos(halfAngle);

        if (out) {
            out.x = x;
            out.y = y;
            out.z = z;
            out.w = w;
            return out;
        } else {
            return { x, y, z, w } as V;
        }
    }

    static fromEuler<V extends IQuatLike>(x: number, y: number, z: number, out?: V): V {
        const halfX = x * 0.5;
        const halfY = y * 0.5;
        const halfZ = z * 0.5;

        const sinX = Math.sin(halfX);
        const cosX = Math.cos(halfX);
        const sinY = Math.sin(halfY);
        const cosY = Math.cos(halfY);
        const sinZ = Math.sin(halfZ);
        const cosZ = Math.cos(halfZ);

        const w = cosX * cosY * cosZ + sinX * sinY * sinZ;
        const xOut = sinX * cosY * cosZ - cosX * sinY * sinZ;
        const yOut = cosX * sinY * cosZ + sinX * cosY * sinZ;
        const zOut = cosX * cosY * sinZ - sinX * sinY * cosZ;

        if (out) {
            out.x = xOut;
            out.y = yOut;
            out.z = zOut;
            out.w = w;
            return out;
        } else {
            return { x: xOut, y: yOut, z: zOut, w } as V;
        }
    }

    static fromEulerVec<T extends IVec3Like, V extends IQuatLike>(euler: Readonly<T>, out?: V): V {
        return Quat.fromEuler(euler.x, euler.y, euler.z, out);
    }

    static toEuler<T extends IQuatLike, V extends IVec3Like>(q: Readonly<T>, out?: V): V {
        const x = q.x,
            y = q.y,
            z = q.z,
            w = q.w;

        const sinr_cosp = 2 * (w * x + y * z);
        const cosr_cosp = 1 - 2 * (x * x + y * y);
        const roll = Math.atan2(sinr_cosp, cosr_cosp);

        const sinp = 2 * (w * y - z * x);
        const pitch = Math.abs(sinp) >= 1 ? Math.sign(sinp) * (Math.PI / 2) : Math.asin(sinp);

        const siny_cosp = 2 * (w * z + x * y);
        const cosy_cosp = 1 - 2 * (y * y + z * z);
        const yaw = Math.atan2(siny_cosp, cosy_cosp);

        if (out) {
            out.x = roll;
            out.y = pitch;
            out.z = yaw;
            return out;
        } else {
            return { x: roll, y: pitch, z: yaw } as V;
        }
    }

    static fromLookAt<T extends IVec3Like, U extends IVec3Like, V extends IQuatLike>(
        eye: Readonly<T>,
        target: Readonly<U>,
        up: Readonly<IVec3Like>,
        out?: V
    ): V {
        const fx = target.x - eye.x;
        const fy = target.y - eye.y;
        const fz = target.z - eye.z;

        const flen = Math.sqrt(fx * fx + fy * fy + fz * fz);
        if (flen < EPSILON) {
            throw new Error('Eye and target positions are too close');
        }

        const forward = { x: fx / flen, y: fy / flen, z: fz / flen };

        const rx = forward.y * up.z - forward.z * up.y;
        const ry = forward.z * up.x - forward.x * up.z;
        const rz = forward.x * up.y - forward.y * up.x;

        const rlen = Math.sqrt(rx * rx + ry * ry + rz * rz);
        if (rlen < EPSILON) {
            throw new Error('Forward and up vectors are parallel');
        }

        const right = { x: rx / rlen, y: ry / rlen, z: rz / rlen };

        const upx = right.y * forward.z - right.z * forward.y;
        const upy = right.z * forward.x - right.x * forward.z;
        const upz = right.x * forward.y - right.y * forward.x;

        const m00 = right.x,
            m01 = upx,
            m02 = forward.x;
        const m10 = right.y,
            m11 = upy,
            m12 = forward.y;
        const m20 = right.z,
            m21 = upz,
            m22 = forward.z;

        const trace = m00 + m11 + m22;
        let qw, qx, qy, qz;

        if (trace > 0) {
            const s = Math.sqrt(trace + 1.0) * 2; // s = 4 * qw
            qw = 0.25 * s;
            qx = (m21 - m12) / s;
            qy = (m02 - m20) / s;
            qz = (m10 - m01) / s;
        } else if (m00 > m11 && m00 > m22) {
            const s = Math.sqrt(1.0 + m00 - m11 - m22) * 2; // s = 4 * qx
            qw = (m21 - m12) / s;
            qx = 0.25 * s;
            qy = (m01 + m10) / s;
            qz = (m02 + m20) / s;
        } else if (m11 > m22) {
            const s = Math.sqrt(1.0 + m11 - m00 - m22) * 2; // s = 4 * qy
            qw = (m02 - m20) / s;
            qx = (m01 + m10) / s;
            qy = 0.25 * s;
            qz = (m12 + m21) / s;
        } else {
            const s = Math.sqrt(1.0 + m22 - m00 - m11) * 2; // s = 4 * qz
            qw = (m10 - m01) / s;
            qx = (m02 + m20) / s;
            qy = (m12 + m21) / s;
            qz = 0.25 * s;
        }

        const qlen = Math.sqrt(qx * qx + qy * qy + qz * qz + qw * qw);
        if (qlen < EPSILON) {
            qx = 0;
            qy = 0;
            qz = 0;
            qw = 1;
        } else {
            qx /= qlen;
            qy /= qlen;
            qz /= qlen;
            qw /= qlen;
        }

        if (out) {
            out.x = qx;
            out.y = qy;
            out.z = qz;
            out.w = qw;
            return out;
        } else {
            return { x: qx, y: qy, z: qz, w: qw } as V;
        }
    }

    static rotateVector<T extends IQuatLike, U extends IVec3Like, V extends IVec3Like>(
        q: Readonly<T>,
        v: Readonly<U>,
        out?: V
    ): V {
        const qx = q.x,
            qy = q.y,
            qz = q.z,
            qw = q.w;
        const vx = v.x,
            vy = v.y,
            vz = v.z;

        // qvec = q.xyz
        // uv = qvec x v
        const uvx = qy * vz - qz * vy;
        const uvy = qz * vx - qx * vz;
        const uvz = qx * vy - qy * vx;

        // uuv = qvec x uv
        const uuvx = qy * uvz - qz * uvy;
        const uuvy = qz * uvx - qx * uvz;
        const uuvz = qx * uvy - qy * uvx;

        // v + ((uv * q.w) + uuv) * 2
        const w2 = qw * 2;
        const x = vx + (uvx * w2 + uuvx * 2);
        const y = vy + (uvy * w2 + uuvy * 2);
        const z = vz + (uvz * w2 + uuvz * 2);

        if (out) {
            out.x = x;
            out.y = y;
            out.z = z;
            return out;
        } else {
            return { x, y, z } as V;
        }
    }

    static angleBetween<T extends IQuatLike, U extends IQuatLike>(
        a: Readonly<T>,
        b: Readonly<U>
    ): number {
        const dotProduct = Math.abs(Quat.dot(a, b));
        return 2 * Math.acos(clamp01(dotProduct));
    }

    static slerp<T extends IQuatLike, U extends IQuatLike, V extends IQuatLike>(
        a: Readonly<T>,
        b: Readonly<U>,
        t: number,
        out?: V
    ): V {
        const t1 = clamp01(t);
        let dot = a.x * b.x + a.y * b.y + a.z * b.z + a.w * b.w;

        let bx = b.x,
            by = b.y,
            bz = b.z,
            bw = b.w;
        if (dot < 0.0) {
            dot = -dot;
            bx = -bx;
            by = -by;
            bz = -bz;
            bw = -bw;
        }

        let scale0, scale1;
        if (dot > 0.9995) {
            scale0 = 1.0 - t1;
            scale1 = t1;
        } else {
            const theta = Math.acos(dot);
            const sinTheta = Math.sin(theta);
            scale0 = Math.sin((1.0 - t1) * theta) / sinTheta;
            scale1 = Math.sin(t1 * theta) / sinTheta;
        }

        if (out) {
            out.x = scale0 * a.x + scale1 * bx;
            out.y = scale0 * a.y + scale1 * by;
            out.z = scale0 * a.z + scale1 * bz;
            out.w = scale0 * a.w + scale1 * bw;
            return out;
        } else {
            return {
                x: scale0 * a.x + scale1 * bx,
                y: scale0 * a.y + scale1 * by,
                z: scale0 * a.z + scale1 * bz,
                w: scale0 * a.w + scale1 * bw,
            } as V;
        }
    }

    static lerp<T extends IQuatLike, U extends IQuatLike, V extends IQuatLike>(
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

    static squad<
        T extends IQuatLike,
        U extends IQuatLike,
        V extends IQuatLike,
        W extends IQuatLike,
        O extends IQuatLike,
    >(q1: Readonly<T>, q2: Readonly<U>, s1: Readonly<V>, s2: Readonly<W>, t: number, out?: O): O {
        const t1 = clamp01(t);

        const temp1 = {} as IQuatLike;
        Quat.slerp(q1, q2, t1, temp1);

        const temp2 = {} as IQuatLike;
        Quat.slerp(s1, s2, t1, temp2);

        const h = 2 * t1 * (1 - t1);
        return Quat.slerp(temp1, temp2, h, out);
    }

    add<T extends IQuatLike>(b: Readonly<T>): Quat {
        this.x += b.x;
        this.y += b.y;
        this.z += b.z;
        this.w += b.w;
        return this;
    }

    addScalar(b: number): Quat {
        this.x += b;
        this.y += b;
        this.z += b;
        this.w += b;
        return this;
    }

    subtract<T extends IQuatLike>(b: Readonly<T>): Quat {
        this.x -= b.x;
        this.y -= b.y;
        this.z -= b.z;
        this.w -= b.w;
        return this;
    }

    subtractScalar(b: number): Quat {
        this.x -= b;
        this.y -= b;
        this.z -= b;
        this.w -= b;
        return this;
    }

    multiply<T extends IQuatLike>(b: Readonly<T>): Quat {
        const ax = this.x,
            ay = this.y,
            az = this.z,
            aw = this.w;
        const bx = b.x,
            by = b.y,
            bz = b.z,
            bw = b.w;

        this.x = ax * bw + aw * bx + ay * bz - az * by;
        this.y = ay * bw + aw * by + az * bx - ax * bz;
        this.z = az * bw + aw * bz + ax * by - ay * bx;
        this.w = aw * bw - ax * bx - ay * by - az * bz;

        return this;
    }

    multiplyScalar(b: number): Quat {
        this.x *= b;
        this.y *= b;
        this.z *= b;
        this.w *= b;
        return this;
    }

    divideScalar(b: number): Quat {
        if (Math.abs(b) < EPSILON) {
            throw new Error('Division by zero or near-zero value is not allowed');
        }

        this.x /= b;
        this.y /= b;
        this.z /= b;
        this.w /= b;
        return this;
    }

    dot<T extends IQuatLike>(other: Readonly<T>): number {
        return this.x * other.x + this.y * other.y + this.z * other.z + this.w * other.w;
    }

    lengthSquared(): number {
        return this.x * this.x + this.y * this.y + this.z * this.z + this.w * this.w;
    }

    length(): number {
        return Math.sqrt(this.lengthSquared());
    }

    normalize(): Quat {
        const length = this.length();
        if (length < EPSILON) {
            throw new Error('Cannot normalize a zero-length quaternion');
        }

        this.x /= length;
        this.y /= length;
        this.z /= length;
        this.w /= length;
        return this;
    }

    conjugate(): Quat {
        this.x = -this.x;
        this.y = -this.y;
        this.z = -this.z;
        return this;
    }

    inverse(): Quat {
        const lenSq = this.lengthSquared();
        if (lenSq < EPSILON) {
            throw new Error('Cannot invert a zero-length quaternion');
        }

        const invLenSq = 1.0 / lenSq;
        this.x = -this.x * invLenSq;
        this.y = -this.y * invLenSq;
        this.z = -this.z * invLenSq;
        this.w = this.w * invLenSq;
        return this;
    }

    fromEuler<T extends IVec3Like>(euler: Readonly<T>): Quat {
        return Quat.fromEulerVec(euler, this);
    }

    fastInverse(): Quat {
        return this.conjugate();
    }

    angleBetween<T extends IQuatLike>(other: Readonly<T>): number {
        const dotProduct = Math.abs(this.dot(other));
        return 2 * Math.acos(Math.min(1, dotProduct));
    }

    toEuler<V extends IVec3Like>(out?: V): V {
        return Quat.toEuler(this, out);
    }

    rotateVector<T extends IVec3Like, V extends IVec3Like>(v: Readonly<T>, out?: V): V {
        return Quat.rotateVector(this, v, out);
    }

    static lookRotation<
        F extends IVec3Like,
        U extends IVec3Like,
        V extends IQuatLike | undefined = undefined,
    >(forward: Readonly<F>, up: Readonly<U>, out?: V): V extends IQuatLike ? V : Quat {
        const forwardLength = Math.sqrt(
            forward.x * forward.x + forward.y * forward.y + forward.z * forward.z
        );
        if (forwardLength < EPSILON) {
            throw new Error('Forward direction cannot be zero vector');
        }

        const f = {
            x: forward.x / forwardLength,
            y: forward.y / forwardLength,
            z: forward.z / forwardLength,
        };

        const right = {
            x: up.y * f.z - up.z * f.y,
            y: up.z * f.x - up.x * f.z,
            z: up.x * f.y - up.y * f.x,
        };

        const rightLength = Math.sqrt(right.x * right.x + right.y * right.y + right.z * right.z);
        if (rightLength < EPSILON) {
            throw new Error('Forward and up vectors cannot be parallel');
        }

        right.x /= rightLength;
        right.y /= rightLength;
        right.z /= rightLength;

        const newUp = {
            x: f.y * right.z - f.z * right.y,
            y: f.z * right.x - f.x * right.z,
            z: f.x * right.y - f.y * right.x,
        };

        const trace = right.x + newUp.y + f.z;
        const result = out || new Quat();

        if (trace > 0) {
            const s = Math.sqrt(trace + 1.0) * 2; // s = 4 * qw
            result.w = 0.25 * s;
            result.x = (newUp.z - f.y) / s;
            result.y = (f.x - right.z) / s;
            result.z = (right.y - newUp.x) / s;
        } else if (right.x > newUp.y && right.x > f.z) {
            const s = Math.sqrt(1.0 + right.x - newUp.y - f.z) * 2; // s = 4 * qx
            result.w = (newUp.z - f.y) / s;
            result.x = 0.25 * s;
            result.y = (newUp.x + right.y) / s;
            result.z = (f.x + right.z) / s;
        } else if (newUp.y > f.z) {
            const s = Math.sqrt(1.0 + newUp.y - right.x - f.z) * 2; // s = 4 * qy
            result.w = (f.x - right.z) / s;
            result.x = (newUp.x + right.y) / s;
            result.y = 0.25 * s;
            result.z = (f.y + newUp.z) / s;
        } else {
            const s = Math.sqrt(1.0 + f.z - right.x - newUp.y) * 2; // s = 4 * qz
            result.w = (right.y - newUp.x) / s;
            result.x = (f.x + right.z) / s;
            result.y = (f.y + newUp.z) / s;
            result.z = 0.25 * s;
        }

        return result as V extends IQuatLike ? V : Quat;
    }
}

export enum QuatComparisonMode {
    LEXICOGRAPHIC,
    MAGNITUDE,
    ANGLE,
}

export class QuatComparer implements Comparer<Quat> {
    private readonly mode: QuatComparisonMode;

    constructor(mode: QuatComparisonMode = QuatComparisonMode.LEXICOGRAPHIC) {
        this.mode = mode;
    }

    compare(a: Readonly<IQuatLike>, b: Readonly<IQuatLike>): CompareResult {
        switch (this.mode) {
            case QuatComparisonMode.LEXICOGRAPHIC:
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

            case QuatComparisonMode.MAGNITUDE: {
                const lenA = Quat.from(a).lengthSquared();
                const lenB = Quat.from(b).lengthSquared();
                if (Math.abs(lenA - lenB) < EPSILON) return 0;
                return lenA < lenB ? -1 : 1;
            }

            case QuatComparisonMode.ANGLE: {
                const angleA = 2 * Math.acos(Math.abs(a.w));
                const angleB = 2 * Math.acos(Math.abs(b.w));
                if (Math.abs(angleA - angleB) < EPSILON) return 0;
                return angleA < angleB ? -1 : 1;
            }

            default:
                throw new Error(`Unsupported Quat comparison mode: ${this.mode}`);
        }
    }
}

export class QuatEqualityComparer implements EqualityComparer<Quat> {
    private readonly epsilon: number;

    constructor(epsilon: number = EPSILON) {
        this.epsilon = epsilon;
    }

    equals(a: Readonly<IQuatLike>, b: Readonly<IQuatLike>): boolean {
        if (a === b) return true;
        if (!a || !b) return false;

        return (
            Math.abs(a.x - b.x) < this.epsilon &&
            Math.abs(a.y - b.y) < this.epsilon &&
            Math.abs(a.z - b.z) < this.epsilon &&
            Math.abs(a.w - b.w) < this.epsilon
        );
    }

    hash(obj: Readonly<Quat>): number {
        if (!obj) return 0;

        let h1 = 2166136261;
        h1 = Math.imul(h1 ^ Math.floor(obj.x * 1000), 16777619);
        h1 = Math.imul(h1 ^ Math.floor(obj.y * 1000), 16777619);
        h1 = Math.imul(h1 ^ Math.floor(obj.z * 1000), 16777619);
        h1 = Math.imul(h1 ^ Math.floor(obj.w * 1000), 16777619);
        return h1 >>> 0;
    }
}
