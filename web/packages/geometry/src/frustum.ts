import { EPSILON, type IMat4Like } from '@axrone/numeric';
import type { IDisposable, ReadonlyTuple4 } from '@axrone/utility';
import { CameraValidationError } from './camera-culling-errors';
import {
    assertBoundingSphere,
    assertBoundingVolume,
    assertMatrix,
    normalizedAabbExtents,
    readX,
    readY,
    readZ,
    DEFAULT_CAMERA_LOCALE,
} from './camera-culling-internal';
import type {
    BoundingAabb,
    BoundingSphere,
    BoundingVolume,
    CameraLocale,
    FrustumClassification,
    PointFrustumClassification,
    Vector3Input,
} from './camera-culling-types';

const FRUSTUM_PLANE_COMPONENTS = 4;
const FRUSTUM_PLANE_COUNT = 6;
const LEFT_PLANE = 0;
const RIGHT_PLANE = 4;
const BOTTOM_PLANE = 8;
const TOP_PLANE = 12;
const NEAR_PLANE = 16;
const FAR_PLANE = 20;

export type FrustumPlaneName = 'left' | 'right' | 'bottom' | 'top' | 'near' | 'far';

const normalizePlane = (planes: Float32Array, offset: number, locale: CameraLocale): void => {
    const x = planes[offset]!;
    const y = planes[offset + 1]!;
    const z = planes[offset + 2]!;
    const length = Math.hypot(x, y, z);
    if (length <= EPSILON) {
        throw new CameraValidationError('INVALID_MATRIX', locale, { offset, planes: Array.from(planes) });
    }

    planes[offset] = x / length;
    planes[offset + 1] = y / length;
    planes[offset + 2] = z / length;
    planes[offset + 3] = planes[offset + 3]! / length;
};

const classifyPlaneSetPoint = (
    planes: Float32Array,
    point: Vector3Input
): PointFrustumClassification => {
    const x = readX(point);
    const y = readY(point);
    const z = readZ(point);

    for (let offset = 0; offset < planes.length; offset += FRUSTUM_PLANE_COMPONENTS) {
        const distance =
            planes[offset]! * x +
            planes[offset + 1]! * y +
            planes[offset + 2]! * z +
            planes[offset + 3]!;
        if (distance < 0) {
            return 'outside';
        }
    }

    return 'inside';
};

const classifyPlaneSetSphere = (
    planes: Float32Array,
    sphere: Readonly<BoundingSphere>
): FrustumClassification => {
    const x = readX(sphere.center);
    const y = readY(sphere.center);
    const z = readZ(sphere.center);
    const radius = sphere.radius;
    let classification: FrustumClassification = 'inside';

    for (let offset = 0; offset < planes.length; offset += FRUSTUM_PLANE_COMPONENTS) {
        const distance =
            planes[offset]! * x +
            planes[offset + 1]! * y +
            planes[offset + 2]! * z +
            planes[offset + 3]!;
        if (distance < -radius) {
            return 'outside';
        }
        if (distance < radius) {
            classification = 'intersects';
        }
    }

    return classification;
};

const classifyPlaneSetAabb = (
    planes: Float32Array,
    aabb: Readonly<BoundingAabb>,
    locale: CameraLocale
): FrustumClassification => {
    const { minX, minY, minZ, maxX, maxY, maxZ } = normalizedAabbExtents(aabb, locale);
    const centerX = (minX + maxX) * 0.5;
    const centerY = (minY + maxY) * 0.5;
    const centerZ = (minZ + maxZ) * 0.5;
    const extentX = (maxX - minX) * 0.5;
    const extentY = (maxY - minY) * 0.5;
    const extentZ = (maxZ - minZ) * 0.5;
    let classification: FrustumClassification = 'inside';

    for (let offset = 0; offset < planes.length; offset += FRUSTUM_PLANE_COMPONENTS) {
        const normalX = planes[offset]!;
        const normalY = planes[offset + 1]!;
        const normalZ = planes[offset + 2]!;
        const distance =
            normalX * centerX + normalY * centerY + normalZ * centerZ + planes[offset + 3]!;
        const radius =
            Math.abs(normalX) * extentX +
            Math.abs(normalY) * extentY +
            Math.abs(normalZ) * extentZ;

        if (distance < -radius) {
            return 'outside';
        }
        if (distance < radius) {
            classification = 'intersects';
        }
    }

    return classification;
};

export const isBoundingSphere = (value: unknown): value is BoundingSphere =>
    typeof value === 'object' && value !== null && (value as { kind?: unknown }).kind === 'sphere';

export const isBoundingAabb = (value: unknown): value is BoundingAabb =>
    typeof value === 'object' && value !== null && (value as { kind?: unknown }).kind === 'aabb';

export const isBoundingVolume = (value: unknown): value is BoundingVolume =>
    isBoundingSphere(value) || isBoundingAabb(value);

export const createBoundingSphere = (
    center: Vector3Input,
    radius: number,
    locale: CameraLocale = DEFAULT_CAMERA_LOCALE
): BoundingSphere => {
    const sphere = Object.freeze({ kind: 'sphere', center, radius }) satisfies BoundingSphere;
    assertBoundingSphere(sphere, locale);
    return sphere;
};

export const createBoundingAabb = (
    min: Vector3Input,
    max: Vector3Input,
    locale: CameraLocale = DEFAULT_CAMERA_LOCALE
): BoundingAabb => {
    const aabb = Object.freeze({ kind: 'aabb', min, max }) satisfies BoundingAabb;
    normalizedAabbExtents(aabb, locale);
    return aabb;
};

export class CameraFrustum implements IDisposable {
    private readonly _planes = new Float32Array(FRUSTUM_PLANE_COUNT * FRUSTUM_PLANE_COMPONENTS);
    private _isDisposed = false;

    constructor(matrix?: Readonly<IMat4Like>, private readonly _locale: CameraLocale = DEFAULT_CAMERA_LOCALE) {
        if (matrix) {
            this.setFromMatrix(matrix);
        }
    }

    get isDisposed(): boolean {
        return this._isDisposed;
    }

    setFromMatrix(matrix: Readonly<IMat4Like>): this {
        this.assertActive();
        assertMatrix(matrix, this._locale, 'matrix');

        const data = matrix.data;
        this._planes[LEFT_PLANE] = data[12]! + data[0]!;
        this._planes[LEFT_PLANE + 1] = data[13]! + data[1]!;
        this._planes[LEFT_PLANE + 2] = data[14]! + data[2]!;
        this._planes[LEFT_PLANE + 3] = data[15]! + data[3]!;

        this._planes[RIGHT_PLANE] = data[12]! - data[0]!;
        this._planes[RIGHT_PLANE + 1] = data[13]! - data[1]!;
        this._planes[RIGHT_PLANE + 2] = data[14]! - data[2]!;
        this._planes[RIGHT_PLANE + 3] = data[15]! - data[3]!;

        this._planes[BOTTOM_PLANE] = data[12]! + data[4]!;
        this._planes[BOTTOM_PLANE + 1] = data[13]! + data[5]!;
        this._planes[BOTTOM_PLANE + 2] = data[14]! + data[6]!;
        this._planes[BOTTOM_PLANE + 3] = data[15]! + data[7]!;

        this._planes[TOP_PLANE] = data[12]! - data[4]!;
        this._planes[TOP_PLANE + 1] = data[13]! - data[5]!;
        this._planes[TOP_PLANE + 2] = data[14]! - data[6]!;
        this._planes[TOP_PLANE + 3] = data[15]! - data[7]!;

        this._planes[NEAR_PLANE] = data[12]! + data[8]!;
        this._planes[NEAR_PLANE + 1] = data[13]! + data[9]!;
        this._planes[NEAR_PLANE + 2] = data[14]! + data[10]!;
        this._planes[NEAR_PLANE + 3] = data[15]! + data[11]!;

        this._planes[FAR_PLANE] = data[12]! - data[8]!;
        this._planes[FAR_PLANE + 1] = data[13]! - data[9]!;
        this._planes[FAR_PLANE + 2] = data[14]! - data[10]!;
        this._planes[FAR_PLANE + 3] = data[15]! - data[11]!;

        for (let offset = 0; offset < this._planes.length; offset += FRUSTUM_PLANE_COMPONENTS) {
            normalizePlane(this._planes, offset, this._locale);
        }

        return this;
    }

    copy(other: Readonly<CameraFrustum>): this {
        this.assertActive();
        this._planes.set(other._planes);
        return this;
    }

    clone(): CameraFrustum {
        this.assertActive();
        const frustum = new CameraFrustum(undefined, this._locale);
        frustum.copy(this);
        return frustum;
    }

    copyPlane(name: FrustumPlaneName): ReadonlyTuple4<number> {
        this.assertActive();
        const offset = this.resolvePlaneOffset(name);
        return [
            this._planes[offset]!,
            this._planes[offset + 1]!,
            this._planes[offset + 2]!,
            this._planes[offset + 3]!,
        ] as const;
    }

    containsPoint(point: Vector3Input): boolean {
        return this.classifyPoint(point) === 'inside';
    }

    classifyPoint(point: Vector3Input): PointFrustumClassification {
        this.assertActive();
        return classifyPlaneSetPoint(this._planes, point);
    }

    classifySphere(sphere: Readonly<BoundingSphere>): FrustumClassification {
        this.assertActive();
        assertBoundingSphere(sphere, this._locale);
        return classifyPlaneSetSphere(this._planes, sphere);
    }

    classifyAabb(aabb: Readonly<BoundingAabb>): FrustumClassification {
        this.assertActive();
        return classifyPlaneSetAabb(this._planes, aabb, this._locale);
    }

    classify(bounds: Readonly<BoundingVolume>): FrustumClassification {
        this.assertActive();
        assertBoundingVolume(bounds, this._locale);
        return bounds.kind === 'sphere'
            ? classifyPlaneSetSphere(this._planes, bounds)
            : classifyPlaneSetAabb(this._planes, bounds, this._locale);
    }

    intersectsSphere(sphere: Readonly<BoundingSphere>): boolean {
        return this.classifySphere(sphere) !== 'outside';
    }

    intersectsAabb(aabb: Readonly<BoundingAabb>): boolean {
        return this.classifyAabb(aabb) !== 'outside';
    }

    intersects(bounds: Readonly<BoundingVolume>): boolean {
        return this.classify(bounds) !== 'outside';
    }

    dispose(): void {
        if (this._isDisposed) {
            return;
        }
        this._planes.fill(0);
        this._isDisposed = true;
    }

    private resolvePlaneOffset(name: FrustumPlaneName): number {
        switch (name) {
            case 'left':
                return LEFT_PLANE;
            case 'right':
                return RIGHT_PLANE;
            case 'bottom':
                return BOTTOM_PLANE;
            case 'top':
                return TOP_PLANE;
            case 'near':
                return NEAR_PLANE;
            case 'far':
                return FAR_PLANE;
        }
    }

    private assertActive(): void {
        if (this._isDisposed) {
            throw new CameraValidationError('FRUSTUM_DISPOSED', this._locale);
        }
    }
}