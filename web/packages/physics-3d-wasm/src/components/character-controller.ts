import { Vec3, type IVec3Like } from '@axrone/numeric';
import { script } from '@axrone/ecs-runtime/decorators';
import { Component } from '@axrone/ecs-runtime';
import type { WasmPhysicsWorld3DCompat } from '../compat';
import { syncTransformWorldPosition } from './transform-sync';

const enum CollisionFlags {
    None = 0,
    Sides = 1 << 0,
    Above = 1 << 1,
    Below = 1 << 2,
}

interface ICharacterControllerConfig {
    radius?: number;
    height?: number;
    center?: IVec3Like;
    slopeLimit?: number;
    stepOffset?: number;
    skinWidth?: number;
    minMoveDistance?: number;
    enableOverlapRecovery?: boolean;
}

const DEFAULT_RADIUS = 0.5;
const DEFAULT_HEIGHT = 2;
const DEFAULT_SLOPE_LIMIT = 45;
const DEFAULT_STEP_OFFSET = 0.3;
const DEFAULT_SKIN_WIDTH = 0.08;
const DEFAULT_MIN_MOVE_DISTANCE = 0.001;
const GRAVITY_ACCELERATION = -9.81;

/**
 * WASM-backed character controller component.
 *
 * Mirrors the serialized field names and scriptName of the reference
 * `CharacterController` in `physics-3d`.
 *
 * The WASM compat adapter supports body/shape creation and transform
 * reads. Movement logic that require per-shape overlap queries or
 * raycasts not exposed by the compat adapter are simplified to
 * direct position updates.
 */
@script({ scriptName: 'CharacterController' })
export class CharacterController extends Component {
    private _world: WasmPhysicsWorld3DCompat | null = null;
    private _bodyId: number = -1;
    private _shapeId: number = -1;
    private _ccEnabled: boolean = true;

    private _radius: number = DEFAULT_RADIUS;
    private _height: number = DEFAULT_HEIGHT;
    private readonly _center: Vec3 = Vec3.create();
    private _slopeLimit: number = DEFAULT_SLOPE_LIMIT;
    private _stepOffset: number = DEFAULT_STEP_OFFSET;
    private _skinWidth: number = DEFAULT_SKIN_WIDTH;
    private _minMoveDistance: number = DEFAULT_MIN_MOVE_DISTANCE;
    private _enableOverlapRecovery: boolean = true;

    private readonly _velocity: Vec3 = Vec3.create();
    private readonly _groundNormal: Vec3 = new Vec3(0, 1, 0);
    private _isGrounded: boolean = false;
    private _collisionFlags: CollisionFlags = CollisionFlags.None;
    private _useGravity: boolean = true;
    private _detectCollisions: boolean = true;

    private readonly _pendingMovement: Vec3 = Vec3.create();
    private _verticalVelocity: number = 0;

    get radius(): number {
        return this._radius;
    }

    set radius(value: number) {
        this._radius = Math.max(0.01, value);
        this._recreateShape();
    }

    get height(): number {
        return this._height;
    }

    set height(value: number) {
        this._height = Math.max(this._radius * 2, value);
        this._recreateShape();
    }

    get center(): Readonly<Vec3> {
        return this._center;
    }

    set center(value: IVec3Like) {
        this._center.x = value.x;
        this._center.y = value.y;
        this._center.z = value.z;
    }

    get slopeLimit(): number {
        return this._slopeLimit;
    }

    set slopeLimit(value: number) {
        this._slopeLimit = Math.max(0, Math.min(90, value));
    }

    get stepOffset(): number {
        return this._stepOffset;
    }

    set stepOffset(value: number) {
        this._stepOffset = Math.max(0, value);
    }

    get skinWidth(): number {
        return this._skinWidth;
    }

    set skinWidth(value: number) {
        this._skinWidth = Math.max(0.001, value);
    }

    get minMoveDistance(): number {
        return this._minMoveDistance;
    }

    set minMoveDistance(value: number) {
        this._minMoveDistance = Math.max(0, value);
    }

    get enableOverlapRecovery(): boolean {
        return this._enableOverlapRecovery;
    }

    set enableOverlapRecovery(value: boolean) {
        this._enableOverlapRecovery = value;
    }

    get velocity(): Readonly<Vec3> {
        return this._velocity;
    }

    get isGrounded(): boolean {
        return this._isGrounded;
    }

    get collisionFlags(): CollisionFlags {
        return this._collisionFlags;
    }

    get detectCollisions(): boolean {
        return this._detectCollisions;
    }

    set detectCollisions(value: boolean) {
        this._detectCollisions = value;
    }

    get useGravity(): boolean {
        return this._useGravity;
    }

    set useGravity(value: boolean) {
        this._useGravity = value;
    }

    initialize(world: WasmPhysicsWorld3DCompat, config: ICharacterControllerConfig = {}): void {
        this._world = world;
        this._applyConfig(config);
        this._createBody();
    }

    move(motion: IVec3Like): CollisionFlags {
        if (!this._world || this._bodyId === -1 || !this._ccEnabled) return CollisionFlags.None;
        const len = Math.sqrt(motion.x * motion.x + motion.y * motion.y + motion.z * motion.z);
        if (len < this._minMoveDistance) return CollisionFlags.None;

        const snap = this._world.getTransform(this._bodyId);
        const newX = snap.position[0] + motion.x;
        const newY = snap.position[1] + motion.y;
        const newZ = snap.position[2] + motion.z;

        // WASM compat does not expose per-shape overlap queries for the
        // character controller; apply motion directly.
        this._collisionFlags = CollisionFlags.None;
        this._isGrounded = false;

        if (this.transform) {
            syncTransformWorldPosition(this.transform, { x: newX, y: newY, z: newZ });
        }

        return this._collisionFlags;
    }

    simpleMove(speed: IVec3Like): boolean {
        if (!this._world || this._bodyId === -1 || !this._ccEnabled) return false;
        this._pendingMovement.x = speed.x;
        this._pendingMovement.y = speed.y;
        this._pendingMovement.z = speed.z;
        return this._isGrounded;
    }

    override fixedUpdate(deltaTime: number): void {
        if (!this._world || this._bodyId === -1 || !this._ccEnabled) return;
        const snap = this._world.getTransform(this._bodyId);
        const posX = snap.position[0];
        const posY = snap.position[1];
        const posZ = snap.position[2];

        let motionX = this._pendingMovement.x * deltaTime;
        let motionY = this._pendingMovement.y * deltaTime;
        let motionZ = this._pendingMovement.z * deltaTime;
        this._pendingMovement.x = 0;
        this._pendingMovement.y = 0;
        this._pendingMovement.z = 0;

        if (this._useGravity && !this._isGrounded) {
            this._verticalVelocity += GRAVITY_ACCELERATION * deltaTime;
            motionY += this._verticalVelocity * deltaTime;
        } else if (this._isGrounded) {
            this._verticalVelocity = 0;
        }

        const newX = posX + motionX;
        const newY = posY + motionY;
        const newZ = posZ + motionZ;

        if (newX !== posX || newY !== posY || newZ !== posZ) {
            if (this.transform) {
                syncTransformWorldPosition(this.transform, { x: newX, y: newY, z: newZ });
            }
            if (deltaTime > 0) {
                this._velocity.x = (newX - posX) / deltaTime;
                this._velocity.y = (newY - posY) / deltaTime;
                this._velocity.z = (newZ - posZ) / deltaTime;
            }
        }

        if (this._isGrounded && this._verticalVelocity < 0) {
            this._verticalVelocity = 0;
        }
    }

    override onDestroy(): void {
        if (this._world) {
            if (this._shapeId !== -1) {
                this._world.destroyShape(this._shapeId);
                this._shapeId = -1;
            }
            if (this._bodyId !== -1) {
                this._world.destroyBody(this._bodyId);
                this._bodyId = -1;
            }
        }
        this._world = null;
    }

    private _applyConfig(config: ICharacterControllerConfig): void {
        if (config.radius !== undefined) this._radius = Math.max(0.01, config.radius);
        if (config.height !== undefined) this._height = Math.max(this._radius * 2, config.height);
        if (config.center) {
            this._center.x = config.center.x;
            this._center.y = config.center.y;
            this._center.z = config.center.z;
        }
        if (config.slopeLimit !== undefined) this._slopeLimit = Math.max(0, Math.min(90, config.slopeLimit));
        if (config.stepOffset !== undefined) this._stepOffset = Math.max(0, config.stepOffset);
        if (config.skinWidth !== undefined) this._skinWidth = Math.max(0.001, config.skinWidth);
        if (config.minMoveDistance !== undefined) this._minMoveDistance = Math.max(0, config.minMoveDistance);
        if (config.enableOverlapRecovery !== undefined) this._enableOverlapRecovery = config.enableOverlapRecovery;
    }

    private _createBody(): void {
        if (!this._world) return;
        const worldPos = this.transform?.worldPosition ?? Vec3.ZERO;
        this._bodyId = this._world.createBody({
            type: 1, // kinematic
            position: { x: worldPos.x, y: worldPos.y, z: worldPos.z },
            allowSleep: false,
        });
        this._createOrReplaceShape();
    }

    private _createOrReplaceShape(): void {
        if (!this._world || this._bodyId === -1) return;
        const halfHeight = (this._height - this._radius * 2) * 0.5;
        this._shapeId = this._world.createCapsuleShape(this._bodyId, {
            center: { x: this._center.x, y: this._center.y, z: this._center.z },
            radius: this._radius,
            height: this._height,
        });
    }

    private _recreateShape(): void {
        if (this._shapeId !== -1 && this._world) {
            this._world.destroyShape(this._shapeId);
            this._shapeId = -1;
        }
        if (this._bodyId !== -1) this._createOrReplaceShape();
    }
}

export { CollisionFlags };
export type { ICharacterControllerConfig };
