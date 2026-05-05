import { Mat4, Vec3, type IMat4Like, type IVec3Like } from '@axrone/numeric';
import type { IDisposable } from '@axrone/utility';
import { CameraSerializationError, CameraValidationError } from './camera-culling-errors';
import {
    buildProjectionMatrix,
    buildViewMatrix,
    cloneProjection,
    copyVector3,
    createCameraId,
    DEFAULT_CAMERA_LOCALE,
    DEFAULT_UP_VECTOR,
    resolveSerializedCamera,
    toMatrix4Tuple,
    toResolvedPose,
} from './camera-culling-internal';
import type {
    BoundingVolume,
    CameraId,
    CameraLocale,
    CameraOptions,
    CameraOptionsOf,
    CameraOrthographicProjection,
    CameraPerspectiveProjection,
    CameraProjection,
    CameraSerialized,
    FrustumClassification,
    Vector3Input,
} from './camera-culling-types';
import { CameraFrustum } from './frustum';

export class Camera3D<TProjection extends CameraProjection = CameraProjection> implements IDisposable {
    private readonly _position = Vec3.ZERO.clone();
    private readonly _target = Vec3.BACK.clone();
    private readonly _up = Vec3.UP.clone();
    private readonly _viewMatrix = new Mat4();
    private readonly _projectionMatrix = new Mat4();
    private readonly _viewProjectionMatrix = new Mat4();
    private readonly _frustum: CameraFrustum;

    private _isDisposed = false;
    private _dirty = true;
    private _id: CameraId;
    private _locale: CameraLocale;
    private _projection: TProjection;

    constructor(options: Readonly<CameraOptions<TProjection>>) {
        this._locale = options.locale ?? DEFAULT_CAMERA_LOCALE;
        this._id = createCameraId(options.id, this._locale);
        this._projection = cloneProjection(options.projection, this._locale);
        this._frustum = new CameraFrustum(undefined, this._locale);
        this.setPose(options.pose);
    }

    static perspective(options: Readonly<CameraOptionsOf<'perspective'>>): Camera3D<CameraPerspectiveProjection> {
        return new Camera3D<CameraPerspectiveProjection>(options);
    }

    static orthographic(
        options: Readonly<CameraOptionsOf<'orthographic'>>
    ): Camera3D<CameraOrthographicProjection> {
        return new Camera3D<CameraOrthographicProjection>(options);
    }

    static fromJSON<TProjection extends CameraProjection>(
        value: unknown,
        locale: CameraLocale = DEFAULT_CAMERA_LOCALE
    ): Camera3D<TProjection> {
        const serialized = resolveSerializedCamera<TProjection>(value, locale);
        try {
            return new Camera3D<TProjection>({
                id: serialized.id,
                locale: serialized.locale,
                projection: serialized.projection,
                pose: serialized.pose,
            });
        } catch (error) {
            throw new CameraSerializationError(locale, { value }, error);
        }
    }

    get isDisposed(): boolean {
        return this._isDisposed;
    }

    get id(): CameraId {
        return this._id;
    }

    get locale(): CameraLocale {
        return this._locale;
    }

    get projection(): Readonly<TProjection> {
        return this._projection;
    }

    get near(): number {
        return this._projection.near;
    }

    get far(): number {
        return this._projection.far;
    }

    get position(): Readonly<IVec3Like> {
        return this._position;
    }

    get target(): Readonly<IVec3Like> {
        return this._target;
    }

    get up(): Readonly<IVec3Like> {
        return this._up;
    }

    get viewMatrix(): Readonly<IMat4Like> {
        this.assertActive();
        this.synchronize();
        return this._viewMatrix;
    }

    get projectionMatrix(): Readonly<IMat4Like> {
        this.assertActive();
        this.synchronize();
        return this._projectionMatrix;
    }

    get viewProjectionMatrix(): Readonly<IMat4Like> {
        this.assertActive();
        this.synchronize();
        return this._viewProjectionMatrix;
    }

    get frustum(): Readonly<CameraFrustum> {
        this.assertActive();
        this.synchronize();
        return this._frustum;
    }

    isPerspective(): this is Camera3D<CameraPerspectiveProjection> {
        return this._projection.kind === 'perspective';
    }

    isOrthographic(): this is Camera3D<CameraOrthographicProjection> {
        return this._projection.kind === 'orthographic';
    }

    setProjection(projection: Readonly<TProjection>): this {
        this.assertActive();
        this._projection = cloneProjection(projection, this._locale);
        this._dirty = true;
        return this;
    }

    setLocale(locale: CameraLocale): this {
        this.assertActive();
        this._locale = locale;
        this._dirty = true;
        return this;
    }

    setPose(pose: Readonly<{ position: Vector3Input; target: Vector3Input; up?: Vector3Input }>): this {
        this.assertActive();
        copyVector3(pose.position, this._position);
        copyVector3(pose.target, this._target);
        copyVector3(pose.up ?? DEFAULT_UP_VECTOR, this._up);
        this._dirty = true;
        return this;
    }

    lookAt(position: Vector3Input, target: Vector3Input, up: Vector3Input = DEFAULT_UP_VECTOR): this {
        return this.setPose({ position, target, up });
    }

    classify(bounds: Readonly<BoundingVolume>): FrustumClassification {
        this.assertActive();
        this.synchronize();
        return this._frustum.classify(bounds);
    }

    intersects(bounds: Readonly<BoundingVolume>): boolean {
        return this.classify(bounds) !== 'outside';
    }

    clone(): Camera3D<TProjection> {
        this.assertActive();
        return new Camera3D<TProjection>({
            id: this._id,
            locale: this._locale,
            projection: this._projection,
            pose: {
                position: this._position,
                target: this._target,
                up: this._up,
            },
        });
    }

    cloneWithProjection<TNextProjection extends CameraProjection>(
        projection: Readonly<TNextProjection>
    ): Camera3D<TNextProjection> {
        this.assertActive();
        return new Camera3D<TNextProjection>({
            id: this._id,
            locale: this._locale,
            projection,
            pose: {
                position: this._position,
                target: this._target,
                up: this._up,
            },
        });
    }

    toJSON(): CameraSerialized<TProjection> {
        this.assertActive();
        this.synchronize();
        return Object.freeze({
            id: this._id,
            locale: this._locale,
            projection: this._projection,
            pose: toResolvedPose(this._position, this._target, this._up),
            viewMatrix: toMatrix4Tuple(this._viewMatrix),
            projectionMatrix: toMatrix4Tuple(this._projectionMatrix),
            viewProjectionMatrix: toMatrix4Tuple(this._viewProjectionMatrix),
        });
    }

    dispose(): void {
        if (this._isDisposed) {
            return;
        }

        this._frustum.dispose();
        this._position.x = 0;
        this._position.y = 0;
        this._position.z = 0;
        this._target.x = 0;
        this._target.y = 0;
        this._target.z = 0;
        this._up.x = 0;
        this._up.y = 0;
        this._up.z = 0;
        this._isDisposed = true;
    }

    private synchronize(): void {
        if (!this._dirty) {
            return;
        }

        try {
            buildViewMatrix(this._position, this._target, this._up, this._viewMatrix, this._locale);
            buildProjectionMatrix(this._projection, this._projectionMatrix, this._locale);
            Mat4.multiply(this._projectionMatrix, this._viewMatrix, this._viewProjectionMatrix);
            this._frustum.setFromMatrix(this._viewProjectionMatrix);
            this._dirty = false;
        } catch (error) {
            if (error instanceof CameraValidationError) {
                throw error;
            }
            throw new CameraValidationError('INVALID_POSE', this._locale, {}, error);
        }
    }

    private assertActive(): void {
        if (this._isDisposed) {
            throw new CameraValidationError('CAMERA_DISPOSED', this._locale);
        }
    }
}