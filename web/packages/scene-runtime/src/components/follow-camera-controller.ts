import { Quat, Vec3 } from '@axrone/numeric';
import { Transform } from '@axrone/ecs-runtime';
import { Component } from '@axrone/ecs-runtime';
import { script } from '@axrone/ecs-runtime';

export interface FollowCameraControllerConfig {
    readonly target?: Vec3 | readonly [number, number, number];
    readonly targetOffset?: Vec3 | readonly [number, number, number];
    readonly up?: Vec3 | readonly [number, number, number];
    readonly distance?: number;
    readonly minDistance?: number;
    readonly maxDistance?: number;
    readonly azimuth?: number;
    readonly elevation?: number;
    readonly positionDamping?: number;
    readonly targetDamping?: number;
}

const FOLLOW_MIN_DISTANCE = 1e-4;
const FOLLOW_PARALLEL_DOT_THRESHOLD = 0.999;
const FOLLOW_ELEVATION_LIMIT = Math.PI * 0.49;
const DEFAULT_TARGET_OFFSET = new Vec3(0, 1.5, 0);

const toVec3 = (
    value?: Vec3 | readonly [number, number, number],
    fallback: Vec3 = Vec3.ZERO
): Vec3 => {
    if (value instanceof Vec3) {
        return new Vec3(value.x, value.y, value.z);
    }

    if (Array.isArray(value) && value.length === 3) {
        return new Vec3(value[0], value[1], value[2]);
    }

    return fallback.clone();
};

const normalizeUpVector = (value: Vec3): Vec3 => {
    if (value.lengthSquared() <= FOLLOW_MIN_DISTANCE * FOLLOW_MIN_DISTANCE) {
        return Vec3.UP.clone();
    }

    return value.normalize();
};

const clampElevation = (value: number): number =>
    Math.min(FOLLOW_ELEVATION_LIMIT, Math.max(-FOLLOW_ELEVATION_LIMIT, value));

const computeSmoothingFactor = (damping: number, deltaSeconds: number): number => {
    if (damping <= 0 || deltaSeconds <= 0) {
        return 1;
    }

    return 1 - Math.exp(-damping * deltaSeconds);
};

const copyVec3 = (source: Readonly<Vec3>, target: Vec3): Vec3 => {
    target.x = source.x;
    target.y = source.y;
    target.z = source.z;
    return target;
};

@script({
    scriptName: 'FollowCameraController',
    priority: 790,
    executeInEditMode: true,
    singleton: false,
})
export class FollowCameraController extends Component {
    private _target = Vec3.ZERO.clone();
    private _targetTransform: Transform | null = null;
    private _targetOffset = DEFAULT_TARGET_OFFSET.clone();
    private _up: Vec3;
    private _distance: number;
    private _minDistance: number;
    private _maxDistance: number;
    private _azimuth: number;
    private _elevation: number;
    private _positionDamping: number;
    private _targetDamping: number;
    private readonly _smoothedTarget = new Vec3();
    private readonly _desiredTarget = new Vec3();
    private readonly _desiredPosition = new Vec3();
    private readonly _tempForward = new Vec3();
    private readonly _tempUp = new Vec3();
    private readonly _tempBackward = new Vec3();
    private readonly _tempRotation = new Quat();
    private _initialized = false;

    constructor(config: FollowCameraControllerConfig = {}) {
        super();
        this._target = toVec3(config.target);
        this._targetOffset = toVec3(config.targetOffset, DEFAULT_TARGET_OFFSET);
        this._up = normalizeUpVector(toVec3(config.up, Vec3.UP));
        this._minDistance = Math.max(FOLLOW_MIN_DISTANCE, config.minDistance ?? 1.5);
        this._maxDistance = Math.max(this._minDistance, config.maxDistance ?? 24);
        this._distance = Math.min(
            this._maxDistance,
            Math.max(this._minDistance, config.distance ?? 7)
        );
        this._azimuth = config.azimuth ?? 0;
        this._elevation = clampElevation(config.elevation ?? 0.45);
        this._positionDamping = Math.max(0, config.positionDamping ?? 10);
        this._targetDamping = Math.max(0, config.targetDamping ?? 14);
        copyVec3(this._target, this._smoothedTarget);
    }

    get target(): Vec3 {
        return this._target;
    }

    set target(value: Vec3 | readonly [number, number, number]) {
        this._target = toVec3(value);
    }

    get targetOffset(): Vec3 {
        return this._targetOffset;
    }

    set targetOffset(value: Vec3 | readonly [number, number, number]) {
        this._targetOffset = toVec3(value, DEFAULT_TARGET_OFFSET);
    }

    get distance(): number {
        return this._distance;
    }

    set distance(value: number) {
        this._distance = Math.min(this._maxDistance, Math.max(this._minDistance, value));
    }

    get azimuth(): number {
        return this._azimuth;
    }

    set azimuth(value: number) {
        this._azimuth = value;
    }

    get elevation(): number {
        return this._elevation;
    }

    set elevation(value: number) {
        this._elevation = clampElevation(value);
    }

    get positionDamping(): number {
        return this._positionDamping;
    }

    set positionDamping(value: number) {
        this._positionDamping = Math.max(0, value);
    }

    get targetDamping(): number {
        return this._targetDamping;
    }

    set targetDamping(value: number) {
        this._targetDamping = Math.max(0, value);
    }

    setTarget(target: Transform | null | undefined, snap: boolean = true): this {
        this._targetTransform = target ?? null;
        if (snap) {
            this.snap();
        }
        return this;
    }

    orbit(deltaAzimuth: number, deltaElevation: number): this {
        this.azimuth = this._azimuth + deltaAzimuth;
        this.elevation = this._elevation + deltaElevation;
        return this;
    }

    zoom(deltaDistance: number): this {
        this.distance = this._distance + deltaDistance;
        return this;
    }

    snap(): this {
        this._initialized = false;
        return this;
    }

    lateUpdate(deltaTime: number): void {
        const transform = this.transform as Transform | undefined;
        if (!transform) {
            return;
        }

        const desiredTarget = this._resolveDesiredTarget(this._desiredTarget);
        const deltaSeconds = Math.max(0, deltaTime / 1000);

        if (!this._initialized) {
            copyVec3(desiredTarget, this._smoothedTarget);
            this._composeDesiredPosition(this._smoothedTarget, this._desiredPosition);
            this._applyCameraTransform(transform, this._desiredPosition, this._smoothedTarget);
            this._initialized = true;
            return;
        }

        Vec3.lerp(
            this._smoothedTarget,
            desiredTarget,
            computeSmoothingFactor(this._targetDamping, deltaSeconds),
            this._smoothedTarget
        );
        this._composeDesiredPosition(this._smoothedTarget, this._desiredPosition);
        Vec3.lerp(
            transform.position,
            this._desiredPosition,
            computeSmoothingFactor(this._positionDamping, deltaSeconds),
            this._desiredPosition
        );
        this._applyCameraTransform(transform, this._desiredPosition, this._smoothedTarget);
    }

    override serialize(): Record<string, unknown> {
        return {
            target: [this._target.x, this._target.y, this._target.z],
            targetOffset: [
                this._targetOffset.x,
                this._targetOffset.y,
                this._targetOffset.z,
            ],
            up: [this._up.x, this._up.y, this._up.z],
            distance: this._distance,
            minDistance: this._minDistance,
            maxDistance: this._maxDistance,
            azimuth: this._azimuth,
            elevation: this._elevation,
            positionDamping: this._positionDamping,
            targetDamping: this._targetDamping,
        };
    }

    override deserialize(data: Record<string, any>): void {
        if (Array.isArray(data.target) && data.target.length === 3) {
            this._target = new Vec3(
                Number(data.target[0]),
                Number(data.target[1]),
                Number(data.target[2])
            );
        }

        if (Array.isArray(data.targetOffset) && data.targetOffset.length === 3) {
            this._targetOffset = new Vec3(
                Number(data.targetOffset[0]),
                Number(data.targetOffset[1]),
                Number(data.targetOffset[2])
            );
        }

        if (Array.isArray(data.up) && data.up.length === 3) {
            this._up = normalizeUpVector(
                new Vec3(Number(data.up[0]), Number(data.up[1]), Number(data.up[2]))
            );
        }

        if (typeof data.minDistance === 'number') {
            this._minDistance = Math.max(FOLLOW_MIN_DISTANCE, data.minDistance);
        }
        if (typeof data.maxDistance === 'number') {
            this._maxDistance = Math.max(this._minDistance, data.maxDistance);
        }
        if (typeof data.distance === 'number') {
            this.distance = data.distance;
        }
        if (typeof data.azimuth === 'number') {
            this._azimuth = data.azimuth;
        }
        if (typeof data.elevation === 'number') {
            this.elevation = data.elevation;
        }
        if (typeof data.positionDamping === 'number') {
            this._positionDamping = Math.max(0, data.positionDamping);
        }
        if (typeof data.targetDamping === 'number') {
            this._targetDamping = Math.max(0, data.targetDamping);
        }

        this._initialized = false;
    }

    private _resolveDesiredTarget(out: Vec3): Vec3 {
        const source = this._targetTransform?.worldPosition ?? this._target;
        out.x = source.x + this._targetOffset.x;
        out.y = source.y + this._targetOffset.y;
        out.z = source.z + this._targetOffset.z;
        return out;
    }

    private _composeDesiredPosition(target: Vec3, out: Vec3): Vec3 {
        const cosElevation = Math.cos(this._elevation);
        out.x = target.x + Math.sin(this._azimuth) * cosElevation * this._distance;
        out.y = target.y + Math.sin(this._elevation) * this._distance;
        out.z = target.z + Math.cos(this._azimuth) * cosElevation * this._distance;
        return out;
    }

    private _resolveUp(position: Vec3): Vec3 {
        Vec3.subtract(this._smoothedTarget, position, this._tempForward);
        if (this._tempForward.lengthSquared() <= FOLLOW_MIN_DISTANCE * FOLLOW_MIN_DISTANCE) {
            return this._up;
        }

        this._tempForward.normalize();
        if (Math.abs(Vec3.dot(this._tempForward, this._up)) < FOLLOW_PARALLEL_DOT_THRESHOLD) {
            return this._up;
        }

        if (Math.abs(this._tempForward.y) < FOLLOW_PARALLEL_DOT_THRESHOLD) {
            return copyVec3(Vec3.UP, this._tempUp);
        }

        return copyVec3(Vec3.FORWARD, this._tempUp);
    }

    private _applyCameraTransform(transform: Transform, position: Vec3, target: Vec3): void {
        transform.position = position;

        Vec3.subtract(target, position, this._tempForward);
        if (this._tempForward.lengthSquared() <= FOLLOW_MIN_DISTANCE * FOLLOW_MIN_DISTANCE) {
            return;
        }

        this._tempForward.normalize();
        const up = this._resolveUp(position);
        this._tempBackward.x = -this._tempForward.x;
        this._tempBackward.y = -this._tempForward.y;
        this._tempBackward.z = -this._tempForward.z;
        transform.rotation = Quat.lookRotation(this._tempBackward, up, this._tempRotation);
    }
}