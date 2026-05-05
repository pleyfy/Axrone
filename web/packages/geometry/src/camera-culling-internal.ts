import { EPSILON, Mat4, type IMat4Like, type IVec3Like } from '@axrone/numeric';
import type { ReadonlyTuple3 } from '@axrone/utility';
import { CameraSerializationError, CameraValidationError } from './camera-culling-errors';
import type {
    BoundingAabb,
    BoundingSphere,
    BoundingVolume,
    CameraId,
    CameraLocale,
    CameraProjection,
    CameraSerialized,
    Matrix4Tuple,
    ResolvedCameraPose,
    Vector3Input,
} from './camera-culling-types';

export const DEFAULT_CAMERA_LOCALE: CameraLocale = 'en';
export const DEFAULT_UP_VECTOR: ReadonlyTuple3<number> = [0, 1, 0] as const;
export const DEFAULT_CAMERA_ID = 'camera';

export const readX = (value: Vector3Input): number => (Array.isArray(value) ? value[0] : value.x);
export const readY = (value: Vector3Input): number => (Array.isArray(value) ? value[1] : value.y);
export const readZ = (value: Vector3Input): number => (Array.isArray(value) ? value[2] : value.z);

export const assertFiniteNumber = (
    value: unknown,
    locale: CameraLocale,
    field: string,
    code: 'INVALID_ARGUMENT' | 'INVALID_PROJECTION' | 'INVALID_RADIUS' | 'INVALID_VECTOR'
): asserts value is number => {
    if (typeof value !== 'number' || Number.isFinite(value) === false) {
        throw new CameraValidationError(code, locale, { field, value });
    }
};

export const assertPositiveFiniteNumber = (
    value: unknown,
    locale: CameraLocale,
    field: string,
    code: 'INVALID_ARGUMENT' | 'INVALID_PROJECTION'
): asserts value is number => {
    assertFiniteNumber(value, locale, field, code);
    if (value <= 0) {
        throw new CameraValidationError(code, locale, { field, value });
    }
};

export const assertVector3 = (
    value: unknown,
    locale: CameraLocale,
    field: string
): asserts value is Vector3Input => {
    if (Array.isArray(value)) {
        if (value.length !== 3) {
            throw new CameraValidationError('INVALID_VECTOR', locale, { field, value });
        }
        assertFiniteNumber(value[0], locale, `${field}.x`, 'INVALID_VECTOR');
        assertFiniteNumber(value[1], locale, `${field}.y`, 'INVALID_VECTOR');
        assertFiniteNumber(value[2], locale, `${field}.z`, 'INVALID_VECTOR');
        return;
    }

    if (typeof value !== 'object' || value === null) {
        throw new CameraValidationError('INVALID_VECTOR', locale, { field, value });
    }

    const candidate = value as Partial<IVec3Like>;
    assertFiniteNumber(candidate.x, locale, `${field}.x`, 'INVALID_VECTOR');
    assertFiniteNumber(candidate.y, locale, `${field}.y`, 'INVALID_VECTOR');
    assertFiniteNumber(candidate.z, locale, `${field}.z`, 'INVALID_VECTOR');
};

export const assertMatrix = (
    matrix: unknown,
    locale: CameraLocale,
    field: string
): asserts matrix is Readonly<IMat4Like> => {
    if (typeof matrix !== 'object' || matrix === null || !('data' in matrix)) {
        throw new CameraValidationError('INVALID_MATRIX', locale, { field, matrix });
    }

    const data = (matrix as IMat4Like).data;
    if (data.length < 16) {
        throw new CameraValidationError('INVALID_MATRIX', locale, { field, matrix });
    }

    for (let index = 0; index < 16; index++) {
        assertFiniteNumber(data[index], locale, `${field}[${index}]`, 'INVALID_ARGUMENT');
    }
};

export const createCameraId = (value: string | undefined, locale: CameraLocale): CameraId => {
    const id = value?.trim() || DEFAULT_CAMERA_ID;
    if (id.length === 0) {
        throw new CameraValidationError('INVALID_CAMERA_ID', locale, { value });
    }
    return id as CameraId;
};

export const cloneProjection = <TProjection extends CameraProjection>(
    projection: Readonly<TProjection>,
    locale: CameraLocale
): TProjection => {
    if (projection.kind === 'perspective') {
        assertPositiveFiniteNumber(
            projection.verticalFieldOfView,
            locale,
            'projection.verticalFieldOfView',
            'INVALID_PROJECTION'
        );
        if (projection.verticalFieldOfView >= Math.PI - EPSILON) {
            throw new CameraValidationError('INVALID_PROJECTION', locale, {
                field: 'projection.verticalFieldOfView',
                value: projection.verticalFieldOfView,
            });
        }
        assertPositiveFiniteNumber(
            projection.aspectRatio,
            locale,
            'projection.aspectRatio',
            'INVALID_PROJECTION'
        );
        assertPositiveFiniteNumber(projection.near, locale, 'projection.near', 'INVALID_PROJECTION');
        assertPositiveFiniteNumber(projection.far, locale, 'projection.far', 'INVALID_PROJECTION');
        if (projection.far <= projection.near + EPSILON) {
            throw new CameraValidationError('INVALID_PROJECTION', locale, { projection });
        }
        return Object.freeze({
            kind: 'perspective',
            verticalFieldOfView: projection.verticalFieldOfView,
            aspectRatio: projection.aspectRatio,
            near: projection.near,
            far: projection.far,
        }) as TProjection;
    }

    assertFiniteNumber(projection.left, locale, 'projection.left', 'INVALID_PROJECTION');
    assertFiniteNumber(projection.right, locale, 'projection.right', 'INVALID_PROJECTION');
    assertFiniteNumber(projection.bottom, locale, 'projection.bottom', 'INVALID_PROJECTION');
    assertFiniteNumber(projection.top, locale, 'projection.top', 'INVALID_PROJECTION');
    assertPositiveFiniteNumber(projection.near, locale, 'projection.near', 'INVALID_PROJECTION');
    assertPositiveFiniteNumber(projection.far, locale, 'projection.far', 'INVALID_PROJECTION');
    if (
        Math.abs(projection.left - projection.right) <= EPSILON ||
        Math.abs(projection.bottom - projection.top) <= EPSILON ||
        projection.far <= projection.near + EPSILON
    ) {
        throw new CameraValidationError('INVALID_PROJECTION', locale, { projection });
    }

    return Object.freeze({
        kind: 'orthographic',
        left: projection.left,
        right: projection.right,
        bottom: projection.bottom,
        top: projection.top,
        near: projection.near,
        far: projection.far,
    }) as TProjection;
};

export const buildProjectionMatrix = (
    projection: Readonly<CameraProjection>,
    out: Mat4,
    locale: CameraLocale
): Mat4 => {
    try {
        if (projection.kind === 'perspective') {
            return Mat4.perspective(
                projection.verticalFieldOfView,
                projection.aspectRatio,
                projection.near,
                projection.far,
                out
            );
        }

        return Mat4.orthographic(
            projection.left,
            projection.right,
            projection.bottom,
            projection.top,
            projection.near,
            projection.far,
            out
        );
    } catch (error) {
        throw new CameraValidationError('INVALID_PROJECTION', locale, { projection }, error);
    }
};

export const buildViewMatrix = (
    position: Vector3Input,
    target: Vector3Input,
    up: Vector3Input,
    out: Mat4,
    locale: CameraLocale
): Mat4 => {
    assertVector3(position, locale, 'pose.position');
    assertVector3(target, locale, 'pose.target');
    assertVector3(up, locale, 'pose.up');

    const eyeX = readX(position);
    const eyeY = readY(position);
    const eyeZ = readZ(position);
    const targetX = readX(target);
    const targetY = readY(target);
    const targetZ = readZ(target);
    const upX = readX(up);
    const upY = readY(up);
    const upZ = readZ(up);

    let z0 = eyeX - targetX;
    let z1 = eyeY - targetY;
    let z2 = eyeZ - targetZ;
    let length = Math.hypot(z0, z1, z2);

    if (length <= EPSILON) {
        throw new CameraValidationError('INVALID_POSE', locale, { position, target, up });
    }

    z0 /= length;
    z1 /= length;
    z2 /= length;

    let x0 = upY * z2 - upZ * z1;
    let x1 = upZ * z0 - upX * z2;
    let x2 = upX * z1 - upY * z0;
    length = Math.hypot(x0, x1, x2);

    if (length <= EPSILON) {
        throw new CameraValidationError('INVALID_POSE', locale, { position, target, up });
    }

    x0 /= length;
    x1 /= length;
    x2 /= length;

    const y0 = z1 * x2 - z2 * x1;
    const y1 = z2 * x0 - z0 * x2;
    const y2 = z0 * x1 - z1 * x0;

    const data = out.data as number[];
    data[0] = x0;
    data[1] = x1;
    data[2] = x2;
    data[3] = -(x0 * eyeX + x1 * eyeY + x2 * eyeZ);
    data[4] = y0;
    data[5] = y1;
    data[6] = y2;
    data[7] = -(y0 * eyeX + y1 * eyeY + y2 * eyeZ);
    data[8] = z0;
    data[9] = z1;
    data[10] = z2;
    data[11] = -(z0 * eyeX + z1 * eyeY + z2 * eyeZ);
    data[12] = 0;
    data[13] = 0;
    data[14] = 0;
    data[15] = 1;
    return out;
};

export const copyVector3 = (source: Vector3Input, target: IVec3Like): void => {
    target.x = readX(source);
    target.y = readY(source);
    target.z = readZ(source);
};

export const toVector3Tuple = (value: Vector3Input): ReadonlyTuple3<number> =>
    [readX(value), readY(value), readZ(value)] as const;

export const toMatrix4Tuple = (matrix: Readonly<IMat4Like>): Matrix4Tuple => {
    const data = matrix.data;
    return [
        data[0]!,
        data[1]!,
        data[2]!,
        data[3]!,
        data[4]!,
        data[5]!,
        data[6]!,
        data[7]!,
        data[8]!,
        data[9]!,
        data[10]!,
        data[11]!,
        data[12]!,
        data[13]!,
        data[14]!,
        data[15]!,
    ] as const;
};

export const assertBoundingSphere = (
    sphere: Readonly<BoundingSphere>,
    locale: CameraLocale
): void => {
    assertVector3(sphere.center, locale, 'bounds.center');
    assertFiniteNumber(sphere.radius, locale, 'bounds.radius', 'INVALID_RADIUS');
    if (sphere.radius < 0) {
        throw new CameraValidationError('INVALID_RADIUS', locale, { sphere });
    }
};

export const normalizedAabbExtents = (
    aabb: Readonly<BoundingAabb>,
    locale: CameraLocale
): {
    readonly minX: number;
    readonly minY: number;
    readonly minZ: number;
    readonly maxX: number;
    readonly maxY: number;
    readonly maxZ: number;
} => {
    assertVector3(aabb.min, locale, 'bounds.min');
    assertVector3(aabb.max, locale, 'bounds.max');

    const minX = Math.min(readX(aabb.min), readX(aabb.max));
    const minY = Math.min(readY(aabb.min), readY(aabb.max));
    const minZ = Math.min(readZ(aabb.min), readZ(aabb.max));
    const maxX = Math.max(readX(aabb.min), readX(aabb.max));
    const maxY = Math.max(readY(aabb.min), readY(aabb.max));
    const maxZ = Math.max(readZ(aabb.min), readZ(aabb.max));

    return { minX, minY, minZ, maxX, maxY, maxZ };
};

export const assertBoundingVolume = (
    bounds: Readonly<BoundingVolume>,
    locale: CameraLocale
): void => {
    if (bounds.kind === 'sphere') {
        assertBoundingSphere(bounds, locale);
        return;
    }

    normalizedAabbExtents(bounds, locale);
};

export const resolveSerializedCamera = <TProjection extends CameraProjection>(
    value: unknown,
    locale: CameraLocale
): CameraSerialized<TProjection> => {
    if (typeof value !== 'object' || value === null) {
        throw new CameraSerializationError(locale, { value });
    }

    const camera = value as Partial<CameraSerialized<TProjection>>;
    if (typeof camera.id !== 'string' || camera.projection === undefined || camera.pose === undefined) {
        throw new CameraSerializationError(locale, { value });
    }

    return camera as CameraSerialized<TProjection>;
};

export const toResolvedPose = (
    position: Vector3Input,
    target: Vector3Input,
    up: Vector3Input
): ResolvedCameraPose =>
    Object.freeze({
        position: toVector3Tuple(position),
        target: toVector3Tuple(target),
        up: toVector3Tuple(up),
    });