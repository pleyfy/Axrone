import { Quat, Vec3 } from '@axrone/numeric';
import { Transform } from '../../../core/src/component-system/components/transform';
import { Component } from '../../../core/src/component-system/core/component';
import { script } from '../../../core/src/component-system/decorators/script';

export interface OrbitCameraControllerConfig {
    readonly target?: Vec3 | readonly [number, number, number];
    readonly up?: Vec3 | readonly [number, number, number];
    readonly distance?: number;
    readonly minDistance?: number;
    readonly maxDistance?: number;
    readonly azimuth?: number;
    readonly elevation?: number;
    readonly autoRotateSpeed?: number;
}

const ORBIT_MIN_DISTANCE = 1e-4;
const ORBIT_PARALLEL_DOT_THRESHOLD = 0.999;
const ORBIT_ELEVATION_LIMIT = Math.PI * 0.49;

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
    if (value.lengthSquared() <= ORBIT_MIN_DISTANCE * ORBIT_MIN_DISTANCE) {
        return Vec3.UP.clone();
    }

    return value.normalize();
};

const clampElevation = (value: number): number =>
    Math.min(ORBIT_ELEVATION_LIMIT, Math.max(-ORBIT_ELEVATION_LIMIT, value));

@script({
    scriptName: 'OrbitCameraController',
    priority: 800,
    executeInEditMode: true,
    singleton: false,
})
export class OrbitCameraController extends Component {
    private _target: Vec3;
    private _up: Vec3;
    private _distance: number;
    private _minDistance: number;
    private _maxDistance: number;
    private _azimuth: number;
    private _elevation: number;
    private _autoRotateSpeed: number;

    constructor(config: OrbitCameraControllerConfig = {}) {
        super();
        this._target = toVec3(config.target);
        this._up = normalizeUpVector(toVec3(config.up, Vec3.UP));
        this._minDistance = Math.max(ORBIT_MIN_DISTANCE, config.minDistance ?? 1);
        this._maxDistance = Math.max(this._minDistance, config.maxDistance ?? 64);
        this._distance = Math.min(this._maxDistance, Math.max(this._minDistance, config.distance ?? 6));
        this._azimuth = config.azimuth ?? 0;
        this._elevation = clampElevation(config.elevation ?? 0.35);
        this._autoRotateSpeed = config.autoRotateSpeed ?? 0;
    }

    get target(): Vec3 {
        return this._target;
    }

    set target(value: Vec3 | readonly [number, number, number]) {
        this._target = toVec3(value);
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

    orbit(deltaAzimuth: number, deltaElevation: number): this {
        this.azimuth = this._azimuth + deltaAzimuth;
        this.elevation = this._elevation + deltaElevation;
        return this;
    }

    zoom(deltaDistance: number): this {
        this.distance = this._distance + deltaDistance;
        return this;
    }

    update(deltaTime: number): void {
        if (this._autoRotateSpeed !== 0) {
            this._azimuth += this._autoRotateSpeed * (deltaTime / 1000);
        }

        const transform = this.transform as Transform | undefined;
        if (!transform) {
            return;
        }

        const cosElevation = Math.cos(this._elevation);
        const position = new Vec3(
            this._target.x + Math.sin(this._azimuth) * cosElevation * this._distance,
            this._target.y + Math.sin(this._elevation) * this._distance,
            this._target.z + Math.cos(this._azimuth) * cosElevation * this._distance
        );

        const forward = Vec3.subtract(this._target, position, new Vec3());
        if (Vec3.lengthSquared(forward) <= ORBIT_MIN_DISTANCE * ORBIT_MIN_DISTANCE) {
            transform.position = position;
            return;
        }

        const normalizedForward = Vec3.normalize(forward, new Vec3());
        const up = Math.abs(Vec3.dot(normalizedForward, this._up)) >= ORBIT_PARALLEL_DOT_THRESHOLD
            ? Math.abs(normalizedForward.y) < ORBIT_PARALLEL_DOT_THRESHOLD
                ? Vec3.UP
                : Vec3.FORWARD
            : this._up;
        const backward = new Vec3(
            -normalizedForward.x,
            -normalizedForward.y,
            -normalizedForward.z
        );

        transform.position = position;
        transform.rotation = Quat.lookRotation(backward, up, new Quat());
    }

    override serialize(): Record<string, unknown> {
        return {
            target: [this._target.x, this._target.y, this._target.z],
            up: [this._up.x, this._up.y, this._up.z],
            distance: this._distance,
            minDistance: this._minDistance,
            maxDistance: this._maxDistance,
            azimuth: this._azimuth,
            elevation: this._elevation,
            autoRotateSpeed: this._autoRotateSpeed,
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

        if (Array.isArray(data.up) && data.up.length === 3) {
            this._up = normalizeUpVector(
                new Vec3(Number(data.up[0]), Number(data.up[1]), Number(data.up[2]))
            );
        }

        if (typeof data.minDistance === 'number') {
            this._minDistance = Math.max(ORBIT_MIN_DISTANCE, data.minDistance);
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
        if (typeof data.autoRotateSpeed === 'number') {
            this._autoRotateSpeed = data.autoRotateSpeed;
        }
    }
}