import { Vec3, Quat, type IVec3Like, type IQuatLike } from '@axrone/numeric';
import type { Transform } from '@axrone/ecs-runtime';

const TRANSFORM_SCALE_EPSILON = 1e-8;

const positionScratch = Vec3.create();
const rotationScratch = Quat.create();
const inverseParentRotationScratch = Quat.create();

const copyInverseParentRotation = (worldRotation: Readonly<IQuatLike>): Quat => {
    Quat.copy(worldRotation, inverseParentRotationScratch);
    inverseParentRotationScratch.inverse();
    return inverseParentRotationScratch;
};

export const syncTransformWorldPosition = (
    transform: Transform | undefined,
    value: Readonly<IVec3Like>
): void => {
    if (!transform) return;

    const parent = transform.parent;
    if (!parent) {
        Vec3.copy(value, positionScratch);
        (transform as any).position = { x: positionScratch.x, y: positionScratch.y, z: positionScratch.z };
        return;
    }

    const inverseParentRotation = copyInverseParentRotation(parent.worldRotation);
    Vec3.subtract(value, parent.worldPosition, positionScratch);
    inverseParentRotation.rotateVector(positionScratch, positionScratch);

    const parentScale = parent.worldScale;
    positionScratch.x =
        Math.abs(parentScale.x) > TRANSFORM_SCALE_EPSILON
            ? positionScratch.x / parentScale.x
            : 0;
    positionScratch.y =
        Math.abs(parentScale.y) > TRANSFORM_SCALE_EPSILON
            ? positionScratch.y / parentScale.y
            : 0;
    positionScratch.z =
        Math.abs(parentScale.z) > TRANSFORM_SCALE_EPSILON
            ? positionScratch.z / parentScale.z
            : 0;

    (transform as any).position = { x: positionScratch.x, y: positionScratch.y, z: positionScratch.z };
};

export const syncTransformWorldRotation = (
    transform: Transform | undefined,
    value: Readonly<IQuatLike>
): void => {
    if (!transform) return;

    const parent = transform.parent;
    if (!parent) {
        Quat.copy(value, rotationScratch);
        (transform as any).rotation = {
            x: rotationScratch.x,
            y: rotationScratch.y,
            z: rotationScratch.z,
            w: rotationScratch.w,
        };
        return;
    }

    Quat.multiply(copyInverseParentRotation(parent.worldRotation), value, rotationScratch);
    (transform as any).rotation = {
        x: rotationScratch.x,
        y: rotationScratch.y,
        z: rotationScratch.z,
        w: rotationScratch.w,
    };
};

export const syncTransformWorldPose = (
    transform: Transform | undefined,
    position: Readonly<IVec3Like>,
    rotation: Readonly<IQuatLike>
): void => {
    if (!transform) return;

    const parent = transform.parent;
    if (!parent) {
        Vec3.copy(position, positionScratch);
        Quat.copy(rotation, rotationScratch);
        (transform as any).position = { x: positionScratch.x, y: positionScratch.y, z: positionScratch.z };
        (transform as any).rotation = {
            x: rotationScratch.x,
            y: rotationScratch.y,
            z: rotationScratch.z,
            w: rotationScratch.w,
        };
        return;
    }

    const inverseParentRotation = copyInverseParentRotation(parent.worldRotation);
    Vec3.subtract(position, parent.worldPosition, positionScratch);
    inverseParentRotation.rotateVector(positionScratch, positionScratch);

    const parentScale = parent.worldScale;
    positionScratch.x =
        Math.abs(parentScale.x) > TRANSFORM_SCALE_EPSILON
            ? positionScratch.x / parentScale.x
            : 0;
    positionScratch.y =
        Math.abs(parentScale.y) > TRANSFORM_SCALE_EPSILON
            ? positionScratch.y / parentScale.y
            : 0;
    positionScratch.z =
        Math.abs(parentScale.z) > TRANSFORM_SCALE_EPSILON
            ? positionScratch.z / parentScale.z
            : 0;

    Quat.multiply(inverseParentRotation, rotation, rotationScratch);

    (transform as any).position = { x: positionScratch.x, y: positionScratch.y, z: positionScratch.z };
    (transform as any).rotation = {
        x: rotationScratch.x,
        y: rotationScratch.y,
        z: rotationScratch.z,
        w: rotationScratch.w,
    };
};
