import { Vec3, Quat, type IVec3Like, type IQuatLike } from '@axrone/numeric';
import type { Transform } from '@axrone/ecs-runtime';

const TRANSFORM_SCALE_EPSILON = 1e-8;

const positionScratch = Vec3.create();
const rotationScratch = Quat.create();
const inverseParentRotationScratch = Quat.create();

const copyInverseParentRotation = (worldRotation: Readonly<IQuatLike>): Quat => {
    inverseParentRotationScratch.x = worldRotation.x;
    inverseParentRotationScratch.y = worldRotation.y;
    inverseParentRotationScratch.z = worldRotation.z;
    inverseParentRotationScratch.w = worldRotation.w;
    inverseParentRotationScratch.inverse();
    return inverseParentRotationScratch;
};

export const syncTransformWorldPosition = (
    transform: Transform | undefined,
    value: Readonly<IVec3Like>
): void => {
    if (!transform) {
        return;
    }

    const parent = transform.parent;
    if (!parent) {
        positionScratch.x = value.x;
        positionScratch.y = value.y;
        positionScratch.z = value.z;
        transform.position = positionScratch;
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

    transform.position = positionScratch;
};

export const syncTransformWorldRotation = (
    transform: Transform | undefined,
    value: Readonly<IQuatLike>
): void => {
    if (!transform) {
        return;
    }

    const parent = transform.parent;
    if (!parent) {
        rotationScratch.x = value.x;
        rotationScratch.y = value.y;
        rotationScratch.z = value.z;
        rotationScratch.w = value.w;
        transform.rotation = rotationScratch;
        return;
    }

    Quat.multiply(copyInverseParentRotation(parent.worldRotation), value, rotationScratch);
    transform.rotation = rotationScratch;
};

export const syncTransformWorldPose = (
    transform: Transform | undefined,
    position: Readonly<IVec3Like>,
    rotation: Readonly<IQuatLike>
): void => {
    if (!transform) {
        return;
    }

    const parent = transform.parent;
    if (!parent) {
        positionScratch.x = position.x;
        positionScratch.y = position.y;
        positionScratch.z = position.z;
        rotationScratch.x = rotation.x;
        rotationScratch.y = rotation.y;
        rotationScratch.z = rotation.z;
        rotationScratch.w = rotation.w;
        transform.position = positionScratch;
        transform.rotation = rotationScratch;
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

    transform.position = positionScratch;
    transform.rotation = rotationScratch;
};