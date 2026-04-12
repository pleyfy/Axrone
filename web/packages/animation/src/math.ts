import { clamp as numericClamp, Mat4, Quat, Vec3 } from '@axrone/numeric';
import { ObjectPool } from '@axrone/utility';

export const ANIMATION_EPSILON = 1e-6;

const createObjectPool = <T extends {}>(
    name: string,
    factory: () => T,
    resetHandler: (value: T) => void
): ObjectPool<T> =>
    new ObjectPool<T>({
        initialCapacity: 16,
        maxCapacity: 512,
        minFree: 8,
        expansionStrategy: 'multiplicative',
        expansionFactor: 1.5,
        allocationStrategy: 'least-recently-used',
        evictionPolicy: 'lru',
        resetOnRecycle: true,
        preallocate: false,
        autoExpand: true,
        enableMetrics: false,
        name,
        factory,
        resetHandler,
    });

const setMat4Identity = (value: Mat4): void => {
    const data = value.data as unknown as number[];
    data[0] = 1;
    data[1] = 0;
    data[2] = 0;
    data[3] = 0;
    data[4] = 0;
    data[5] = 1;
    data[6] = 0;
    data[7] = 0;
    data[8] = 0;
    data[9] = 0;
    data[10] = 1;
    data[11] = 0;
    data[12] = 0;
    data[13] = 0;
    data[14] = 0;
    data[15] = 1;
};

const vec3Pool = createObjectPool('AnimationVec3Pool', () => new Vec3(), (value) => {
    value.x = 0;
    value.y = 0;
    value.z = 0;
});

const quatPool = createObjectPool('AnimationQuatPool', () => new Quat(), (value) => {
    value.x = 0;
    value.y = 0;
    value.z = 0;
    value.w = 1;
});

const mat4Pool = createObjectPool('AnimationMat4Pool', () => new Mat4(), (value) => {
    setMat4Identity(value);
});

const loadVec3 = (source: ArrayLike<number>, offset: number, out: Vec3): Vec3 => {
    out.x = Number(source[offset] ?? 0);
    out.y = Number(source[offset + 1] ?? 0);
    out.z = Number(source[offset + 2] ?? 0);
    return out;
};

const writeVec3 = (target: Float32Array, offset: number, value: Readonly<Vec3>): void => {
    target[offset] = value.x;
    target[offset + 1] = value.y;
    target[offset + 2] = value.z;
};

const loadQuat = (source: ArrayLike<number>, offset: number, out: Quat): Quat => {
    out.x = Number(source[offset] ?? 0);
    out.y = Number(source[offset + 1] ?? 0);
    out.z = Number(source[offset + 2] ?? 0);
    out.w = Number(source[offset + 3] ?? 1);
    return out;
};

const writeQuat = (target: Float32Array, offset: number, value: Readonly<Quat>): void => {
    target[offset] = value.x;
    target[offset + 1] = value.y;
    target[offset + 2] = value.z;
    target[offset + 3] = value.w;
};

const loadMat4 = (source: ArrayLike<number>, offset: number, out: Mat4): Mat4 => {
    const data = out.data as unknown as number[];
    for (let index = 0; index < 16; index += 1) {
        data[index] = Number(source[offset + index] ?? (index % 5 === 0 ? 1 : 0));
    }
    return out;
};

const writeMat4 = (target: Float32Array, offset: number, value: Mat4): void => {
    const data = value.data;
    for (let index = 0; index < 16; index += 1) {
        target[offset + index] = Number(data[index] ?? (index % 5 === 0 ? 1 : 0));
    }
};

export const clamp = (value: number, min: number, max: number): number =>
    numericClamp(value, min, max);

export const toFloat32Array = (value: readonly number[] | Float32Array): Float32Array =>
    value instanceof Float32Array ? new Float32Array(value) : new Float32Array(value);

export const vec3Set = (
    target: Float32Array,
    offset: number,
    x: number,
    y: number,
    z: number
): void => {
    target[offset] = x;
    target[offset + 1] = y;
    target[offset + 2] = z;
};

export const vec3Copy = (
    target: Float32Array,
    targetOffset: number,
    source: ArrayLike<number>,
    sourceOffset: number
): void => {
    target[targetOffset] = Number(source[sourceOffset] ?? 0);
    target[targetOffset + 1] = Number(source[sourceOffset + 1] ?? 0);
    target[targetOffset + 2] = Number(source[sourceOffset + 2] ?? 0);
};

export const vec3Add = (
    target: Float32Array,
    targetOffset: number,
    left: ArrayLike<number>,
    leftOffset: number,
    right: ArrayLike<number>,
    rightOffset: number
): void => {
    const leftVector = vec3Pool.acquire();
    const rightVector = vec3Pool.acquire();
    const resultVector = vec3Pool.acquire();
    try {
        Vec3.add(loadVec3(left, leftOffset, leftVector), loadVec3(right, rightOffset, rightVector), resultVector);
        writeVec3(target, targetOffset, resultVector);
    } finally {
        vec3Pool.release(resultVector);
        vec3Pool.release(rightVector);
        vec3Pool.release(leftVector);
    }
};

export const vec3Subtract = (
    target: Float32Array,
    targetOffset: number,
    left: ArrayLike<number>,
    leftOffset: number,
    right: ArrayLike<number>,
    rightOffset: number
): void => {
    const leftVector = vec3Pool.acquire();
    const rightVector = vec3Pool.acquire();
    const resultVector = vec3Pool.acquire();
    try {
        Vec3.subtract(
            loadVec3(left, leftOffset, leftVector),
            loadVec3(right, rightOffset, rightVector),
            resultVector
        );
        writeVec3(target, targetOffset, resultVector);
    } finally {
        vec3Pool.release(resultVector);
        vec3Pool.release(rightVector);
        vec3Pool.release(leftVector);
    }
};

export const vec3Multiply = (
    target: Float32Array,
    targetOffset: number,
    left: ArrayLike<number>,
    leftOffset: number,
    right: ArrayLike<number>,
    rightOffset: number
): void => {
    const leftVector = vec3Pool.acquire();
    const rightVector = vec3Pool.acquire();
    const resultVector = vec3Pool.acquire();
    try {
        Vec3.multiply(
            loadVec3(left, leftOffset, leftVector),
            loadVec3(right, rightOffset, rightVector),
            resultVector
        );
        writeVec3(target, targetOffset, resultVector);
    } finally {
        vec3Pool.release(resultVector);
        vec3Pool.release(rightVector);
        vec3Pool.release(leftVector);
    }
};

export const vec3Scale = (
    target: Float32Array,
    targetOffset: number,
    source: ArrayLike<number>,
    sourceOffset: number,
    scalar: number
): void => {
    const sourceVector = vec3Pool.acquire();
    const resultVector = vec3Pool.acquire();
    try {
        Vec3.multiplyScalar(loadVec3(source, sourceOffset, sourceVector), scalar, resultVector);
        writeVec3(target, targetOffset, resultVector);
    } finally {
        vec3Pool.release(resultVector);
        vec3Pool.release(sourceVector);
    }
};

export const vec3Lerp = (
    target: Float32Array,
    targetOffset: number,
    left: ArrayLike<number>,
    leftOffset: number,
    right: ArrayLike<number>,
    rightOffset: number,
    alpha: number
): void => {
    const leftVector = vec3Pool.acquire();
    const rightVector = vec3Pool.acquire();
    const resultVector = vec3Pool.acquire();
    try {
        Vec3.lerp(
            loadVec3(left, leftOffset, leftVector),
            loadVec3(right, rightOffset, rightVector),
            alpha,
            resultVector
        );
        writeVec3(target, targetOffset, resultVector);
    } finally {
        vec3Pool.release(resultVector);
        vec3Pool.release(rightVector);
        vec3Pool.release(leftVector);
    }
};

export const vec3Dot = (
    left: ArrayLike<number>,
    leftOffset: number,
    right: ArrayLike<number>,
    rightOffset: number
): number => {
    const leftVector = vec3Pool.acquire();
    const rightVector = vec3Pool.acquire();
    try {
        return Vec3.dot(loadVec3(left, leftOffset, leftVector), loadVec3(right, rightOffset, rightVector));
    } finally {
        vec3Pool.release(rightVector);
        vec3Pool.release(leftVector);
    }
};

export const vec3Cross = (
    target: Float32Array,
    targetOffset: number,
    left: ArrayLike<number>,
    leftOffset: number,
    right: ArrayLike<number>,
    rightOffset: number
): void => {
    const leftVector = vec3Pool.acquire();
    const rightVector = vec3Pool.acquire();
    const resultVector = vec3Pool.acquire();
    try {
        Vec3.cross(
            loadVec3(left, leftOffset, leftVector),
            loadVec3(right, rightOffset, rightVector),
            resultVector
        );
        writeVec3(target, targetOffset, resultVector);
    } finally {
        vec3Pool.release(resultVector);
        vec3Pool.release(rightVector);
        vec3Pool.release(leftVector);
    }
};

export const vec3LengthSquared = (source: ArrayLike<number>, offset: number): number => {
    const sourceVector = vec3Pool.acquire();
    try {
        return Vec3.lengthSquared(loadVec3(source, offset, sourceVector));
    } finally {
        vec3Pool.release(sourceVector);
    }
};

export const vec3Length = (source: ArrayLike<number>, offset: number): number => {
    const sourceVector = vec3Pool.acquire();
    try {
        return Vec3.len(loadVec3(source, offset, sourceVector));
    } finally {
        vec3Pool.release(sourceVector);
    }
};

export const vec3Normalize = (
    target: Float32Array,
    targetOffset: number,
    source: ArrayLike<number>,
    sourceOffset: number,
    fallbackX = 0,
    fallbackY = 0,
    fallbackZ = 0
): void => {
    const sourceVector = vec3Pool.acquire();
    const resultVector = vec3Pool.acquire();
    try {
        loadVec3(source, sourceOffset, sourceVector);
        if (Vec3.len(sourceVector) <= ANIMATION_EPSILON) {
            resultVector.x = fallbackX;
            resultVector.y = fallbackY;
            resultVector.z = fallbackZ;
        } else {
            Vec3.normalize(sourceVector, resultVector);
        }
        writeVec3(target, targetOffset, resultVector);
    } finally {
        vec3Pool.release(resultVector);
        vec3Pool.release(sourceVector);
    }
};

export const quatIdentity = (target: Float32Array, offset: number): void => {
    target[offset] = 0;
    target[offset + 1] = 0;
    target[offset + 2] = 0;
    target[offset + 3] = 1;
};

export const quatCopy = (
    target: Float32Array,
    targetOffset: number,
    source: ArrayLike<number>,
    sourceOffset: number
): void => {
    target[targetOffset] = Number(source[sourceOffset] ?? 0);
    target[targetOffset + 1] = Number(source[sourceOffset + 1] ?? 0);
    target[targetOffset + 2] = Number(source[sourceOffset + 2] ?? 0);
    target[targetOffset + 3] = Number(source[sourceOffset + 3] ?? 1);
};

export const quatNormalize = (
    target: Float32Array,
    targetOffset: number,
    source: ArrayLike<number>,
    sourceOffset: number
): void => {
    const sourceQuaternion = quatPool.acquire();
    const resultQuaternion = quatPool.acquire();
    try {
        loadQuat(source, sourceOffset, sourceQuaternion);
        if (Quat.lengthSquared(sourceQuaternion) <= ANIMATION_EPSILON) {
            resultQuaternion.x = 0;
            resultQuaternion.y = 0;
            resultQuaternion.z = 0;
            resultQuaternion.w = 1;
        } else {
            Quat.normalize(sourceQuaternion, resultQuaternion);
        }
        writeQuat(target, targetOffset, resultQuaternion);
    } finally {
        quatPool.release(resultQuaternion);
        quatPool.release(sourceQuaternion);
    }
};

export const quatDot = (
    left: ArrayLike<number>,
    leftOffset: number,
    right: ArrayLike<number>,
    rightOffset: number
): number => {
    const leftQuaternion = quatPool.acquire();
    const rightQuaternion = quatPool.acquire();
    try {
        return Quat.dot(loadQuat(left, leftOffset, leftQuaternion), loadQuat(right, rightOffset, rightQuaternion));
    } finally {
        quatPool.release(rightQuaternion);
        quatPool.release(leftQuaternion);
    }
};

export const quatMultiply = (
    target: Float32Array,
    targetOffset: number,
    left: ArrayLike<number>,
    leftOffset: number,
    right: ArrayLike<number>,
    rightOffset: number
): void => {
    const leftQuaternion = quatPool.acquire();
    const rightQuaternion = quatPool.acquire();
    const resultQuaternion = quatPool.acquire();
    try {
        Quat.multiply(
            loadQuat(left, leftOffset, leftQuaternion),
            loadQuat(right, rightOffset, rightQuaternion),
            resultQuaternion
        );
        writeQuat(target, targetOffset, resultQuaternion);
    } finally {
        quatPool.release(resultQuaternion);
        quatPool.release(rightQuaternion);
        quatPool.release(leftQuaternion);
    }
};

export const quatInvert = (
    target: Float32Array,
    targetOffset: number,
    source: ArrayLike<number>,
    sourceOffset: number
): void => {
    const sourceQuaternion = quatPool.acquire();
    const resultQuaternion = quatPool.acquire();
    try {
        loadQuat(source, sourceOffset, sourceQuaternion);
        if (Quat.lengthSquared(sourceQuaternion) <= ANIMATION_EPSILON) {
            resultQuaternion.x = 0;
            resultQuaternion.y = 0;
            resultQuaternion.z = 0;
            resultQuaternion.w = 1;
        } else {
            Quat.inverse(sourceQuaternion, resultQuaternion);
        }
        writeQuat(target, targetOffset, resultQuaternion);
    } finally {
        quatPool.release(resultQuaternion);
        quatPool.release(sourceQuaternion);
    }
};

export const quatSlerp = (
    target: Float32Array,
    targetOffset: number,
    left: ArrayLike<number>,
    leftOffset: number,
    right: ArrayLike<number>,
    rightOffset: number,
    alpha: number
): void => {
    const leftQuaternion = quatPool.acquire();
    const rightQuaternion = quatPool.acquire();
    const resultQuaternion = quatPool.acquire();
    try {
        Quat.slerp(
            loadQuat(left, leftOffset, leftQuaternion),
            loadQuat(right, rightOffset, rightQuaternion),
            alpha,
            resultQuaternion
        );
        if (Quat.lengthSquared(resultQuaternion) <= ANIMATION_EPSILON) {
            resultQuaternion.x = 0;
            resultQuaternion.y = 0;
            resultQuaternion.z = 0;
            resultQuaternion.w = 1;
        } else {
            Quat.normalize(resultQuaternion, resultQuaternion);
        }
        writeQuat(target, targetOffset, resultQuaternion);
    } finally {
        quatPool.release(resultQuaternion);
        quatPool.release(rightQuaternion);
        quatPool.release(leftQuaternion);
    }
};

export const quatApplyToVec3 = (
    target: Float32Array,
    targetOffset: number,
    quaternion: ArrayLike<number>,
    quaternionOffset: number,
    vector: ArrayLike<number>,
    vectorOffset: number
): void => {
    const quaternionValue = quatPool.acquire();
    const vectorValue = vec3Pool.acquire();
    const resultVector = vec3Pool.acquire();
    try {
        Quat.rotateVector(
            loadQuat(quaternion, quaternionOffset, quaternionValue),
            loadVec3(vector, vectorOffset, vectorValue),
            resultVector
        );
        writeVec3(target, targetOffset, resultVector);
    } finally {
        vec3Pool.release(resultVector);
        vec3Pool.release(vectorValue);
        quatPool.release(quaternionValue);
    }
};

export const quatFromTo = (
    target: Float32Array,
    targetOffset: number,
    from: ArrayLike<number>,
    fromOffset: number,
    to: ArrayLike<number>,
    toOffset: number,
    scratch: Float32Array
): void => {
    const fromVector = vec3Pool.acquire();
    const toVector = vec3Pool.acquire();
    const axisVector = vec3Pool.acquire();
    const resultQuaternion = quatPool.acquire();
    try {
        loadVec3(from, fromOffset, fromVector);
        loadVec3(to, toOffset, toVector);
        if (Vec3.len(fromVector) <= ANIMATION_EPSILON || Vec3.len(toVector) <= ANIMATION_EPSILON) {
            quatIdentity(target, targetOffset);
            return;
        }

        Vec3.normalize(fromVector, fromVector);
        Vec3.normalize(toVector, toVector);
        const dot = numericClamp(Vec3.dot(fromVector, toVector), -1, 1);
        if (dot >= 1 - ANIMATION_EPSILON) {
            quatIdentity(target, targetOffset);
            return;
        }

        if (dot <= -1 + ANIMATION_EPSILON) {
            if (Math.abs(fromVector.x) > Math.abs(fromVector.z)) {
                axisVector.x = -fromVector.y;
                axisVector.y = fromVector.x;
                axisVector.z = 0;
            } else {
                axisVector.x = 0;
                axisVector.y = -fromVector.z;
                axisVector.z = fromVector.y;
            }
        } else {
            Vec3.cross(fromVector, toVector, axisVector);
        }

        if (Vec3.len(axisVector) <= ANIMATION_EPSILON) {
            axisVector.x = 1;
            axisVector.y = 0;
            axisVector.z = 0;
        } else {
            Vec3.normalize(axisVector, axisVector);
        }

        Quat.fromAxisAngle(axisVector, dot <= -1 + ANIMATION_EPSILON ? Math.PI : Math.acos(dot), resultQuaternion);
        Quat.normalize(resultQuaternion, resultQuaternion);
        writeQuat(target, targetOffset, resultQuaternion);

        if (scratch.length >= 9) {
            scratch[0] = fromVector.x;
            scratch[1] = fromVector.y;
            scratch[2] = fromVector.z;
            scratch[3] = toVector.x;
            scratch[4] = toVector.y;
            scratch[5] = toVector.z;
            scratch[6] = axisVector.x;
            scratch[7] = axisVector.y;
            scratch[8] = axisVector.z;
        }
    } finally {
        quatPool.release(resultQuaternion);
        vec3Pool.release(axisVector);
        vec3Pool.release(toVector);
        vec3Pool.release(fromVector);
    }
};

export const composeMatrix = (
    target: Float32Array,
    targetOffset: number,
    translation: ArrayLike<number>,
    translationOffset: number,
    rotation: ArrayLike<number>,
    rotationOffset: number,
    scale: ArrayLike<number>,
    scaleOffset: number
): void => {
    const translationVector = vec3Pool.acquire();
    const scaleVector = vec3Pool.acquire();
    const rotationQuaternion = quatPool.acquire();
    const translationMatrix = mat4Pool.acquire();
    const rotationMatrix = mat4Pool.acquire();
    const scaleMatrix = mat4Pool.acquire();
    const resultMatrix = mat4Pool.acquire();
    try {
        loadVec3(translation, translationOffset, translationVector);
        loadVec3(scale, scaleOffset, scaleVector);
        loadQuat(rotation, rotationOffset, rotationQuaternion);
        if (Quat.lengthSquared(rotationQuaternion) <= ANIMATION_EPSILON) {
            rotationQuaternion.x = 0;
            rotationQuaternion.y = 0;
            rotationQuaternion.z = 0;
            rotationQuaternion.w = 1;
        } else {
            Quat.normalize(rotationQuaternion, rotationQuaternion);
        }

        Mat4.translate(translationVector, translationMatrix);
        Mat4.fromQuaternion(rotationQuaternion, rotationMatrix);
        Mat4.scale(scaleVector, scaleMatrix);
        Mat4.multiply(translationMatrix, rotationMatrix, resultMatrix);
        Mat4.multiply(resultMatrix, scaleMatrix, resultMatrix);
        writeMat4(target, targetOffset, resultMatrix);
    } finally {
        mat4Pool.release(resultMatrix);
        mat4Pool.release(scaleMatrix);
        mat4Pool.release(rotationMatrix);
        mat4Pool.release(translationMatrix);
        quatPool.release(rotationQuaternion);
        vec3Pool.release(scaleVector);
        vec3Pool.release(translationVector);
    }
};

export const mat4Multiply = (
    target: Float32Array,
    targetOffset: number,
    left: ArrayLike<number>,
    leftOffset: number,
    right: ArrayLike<number>,
    rightOffset: number
): void => {
    const leftMatrix = mat4Pool.acquire();
    const rightMatrix = mat4Pool.acquire();
    const resultMatrix = mat4Pool.acquire();
    try {
        Mat4.multiply(loadMat4(left, leftOffset, leftMatrix), loadMat4(right, rightOffset, rightMatrix), resultMatrix);
        writeMat4(target, targetOffset, resultMatrix);
    } finally {
        mat4Pool.release(resultMatrix);
        mat4Pool.release(rightMatrix);
        mat4Pool.release(leftMatrix);
    }
};

export const mat4Invert = (
    target: Float32Array,
    targetOffset: number,
    source: ArrayLike<number>,
    sourceOffset: number
): boolean => {
    const sourceMatrix = mat4Pool.acquire();
    const resultMatrix = mat4Pool.acquire();
    try {
        try {
            Mat4.invert(loadMat4(source, sourceOffset, sourceMatrix), resultMatrix);
        } catch {
            return false;
        }
        writeMat4(target, targetOffset, resultMatrix);
        return true;
    } finally {
        mat4Pool.release(resultMatrix);
        mat4Pool.release(sourceMatrix);
    }
};