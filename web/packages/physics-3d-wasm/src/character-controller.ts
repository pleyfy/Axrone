import type { WasmPhysicsWorld3D } from "./world";
import type { RaycastHit, Vec3Tuple } from "./types";

export const CollisionFlags = Object.freeze({
    None: 0,
    Sides: 1,
    Above: 2,
    Below: 4
} as const);

export type CollisionFlagsValue = number;

export interface WasmCharacterControllerOptions {
    readonly world: WasmPhysicsWorld3D;
    readonly body: number;
    readonly radius?: number;
    readonly height?: number;
    readonly skinWidth?: number;
    readonly slopeLimitAngle?: number;
    readonly stepHeight?: number;
    readonly minMoveDistance?: number;
    readonly jumpSpeed?: number;
    readonly gravityScale?: number;
}

const DEFAULT_RADIUS = 0.5;
const DEFAULT_HEIGHT = 2;
const DEFAULT_SLOPE_LIMIT_ANGLE = 45;
const DEFAULT_STEP_HEIGHT = 0.3;
const DEFAULT_SKIN_WIDTH = 0.08;
const DEFAULT_MIN_MOVE_DISTANCE = 0.001;
const DEFAULT_JUMP_SPEED = 5;
const DEFAULT_DELTA_TIME = 1 / 60;
const GRAVITY_ACCELERATION = -9.81;
const GROUND_PROBE_MARGIN = 0.05;
const SKIN_WIDTH_FLOOR = 0.001;
const BAND_FLOOR = 0.001;
const PROBE_TOLERANCE = 0.02;
const PROBE_RAY_LENGTH = 1.5;
const IDENTITY_ROTATION_EPSILON = 0.001;

function assertFiniteNumber(value: number, label: string): void {
    if (!Number.isFinite(value)) {
        throw new Error(`${label} must be finite`);
    }
}

function assertPositiveNumber(value: number, label: string): void {
    assertFiniteNumber(value, label);
    if (value <= 0) {
        throw new Error(`${label} must be positive`);
    }
}

function assertNonNegativeNumber(value: number, label: string): void {
    assertFiniteNumber(value, label);
    if (value < 0) {
        throw new Error(`${label} must be non-negative`);
    }
}

export class WasmCharacterController {
    private world: WasmPhysicsWorld3D | null;
    private readonly body: number;
    private radiusValue: number;
    private heightValue: number;
    private skinWidthValue: number;
    private slopeLimitAngleValue: number;
    private stepHeightValue: number;
    private minMoveDistanceValue: number;
    private jumpSpeedValue: number;
    private gravityScaleValue: number;
    private deltaTimeValue: number;
    private useGravityValue = true;
    private detectCollisionsValue = true;
    private controllerEnabled = true;
    private disposed = false;

    private readonly velocityState: [number, number, number] = [0, 0, 0];
    private readonly pendingMovement: [number, number, number] = [0, 0, 0];
    private verticalVelocity = 0;
    private grounded = false;
    private flags: number = CollisionFlags.None;

    constructor(options: WasmCharacterControllerOptions) {
        if (options.world === undefined || options.world === null) {
            throw new Error("world is required");
        }
        assertFiniteNumber(options.body, "body");
        if (!Number.isInteger(options.body) || options.body < 0) {
            throw new Error("body must be a non-negative integer");
        }
        if (!options.world.hasBody(options.body)) {
            throw new Error(`body ${options.body} is not active in the world`);
        }

        const radius = options.radius ?? DEFAULT_RADIUS;
        assertPositiveNumber(radius, "radius");

        const height = options.height ?? DEFAULT_HEIGHT;
        assertPositiveNumber(height, "height");

        const skinWidth = options.skinWidth ?? DEFAULT_SKIN_WIDTH;
        assertNonNegativeNumber(skinWidth, "skinWidth");

        const slopeLimitAngle = options.slopeLimitAngle ?? DEFAULT_SLOPE_LIMIT_ANGLE;
        assertFiniteNumber(slopeLimitAngle, "slopeLimitAngle");

        const stepHeight = options.stepHeight ?? DEFAULT_STEP_HEIGHT;
        assertNonNegativeNumber(stepHeight, "stepHeight");

        const minMoveDistance = options.minMoveDistance ?? DEFAULT_MIN_MOVE_DISTANCE;
        assertNonNegativeNumber(minMoveDistance, "minMoveDistance");

        const jumpSpeed = options.jumpSpeed ?? DEFAULT_JUMP_SPEED;
        assertFiniteNumber(jumpSpeed, "jumpSpeed");

        const gravityScale = options.gravityScale ?? 1;
        assertFiniteNumber(gravityScale, "gravityScale");

        this.world = options.world;
        this.body = options.body;
        this.radiusValue = Math.max(0.01, radius);
        this.heightValue = Math.max(this.radiusValue * 2, height);
        this.skinWidthValue = Math.max(SKIN_WIDTH_FLOOR, skinWidth);
        this.slopeLimitAngleValue = Math.max(0, Math.min(90, slopeLimitAngle));
        this.stepHeightValue = stepHeight;
        this.minMoveDistanceValue = minMoveDistance;
        this.jumpSpeedValue = jumpSpeed;
        this.gravityScaleValue = gravityScale;
        this.deltaTimeValue = DEFAULT_DELTA_TIME;
        this.validateCapsule();
    }

    get radius(): number {
        return this.radiusValue;
    }

    set radius(value: number) {
        assertPositiveNumber(value, "radius");
        this.radiusValue = Math.max(0.01, value);
        if (this.heightValue < this.radiusValue * 2) {
            this.heightValue = this.radiusValue * 2;
        }
    }

    get height(): number {
        return this.heightValue;
    }

    set height(value: number) {
        assertPositiveNumber(value, "height");
        this.heightValue = Math.max(this.radiusValue * 2, value);
    }

    get skinWidth(): number {
        return this.skinWidthValue;
    }

    set skinWidth(value: number) {
        assertNonNegativeNumber(value, "skinWidth");
        this.skinWidthValue = Math.max(SKIN_WIDTH_FLOOR, value);
    }

    get slopeLimitAngle(): number {
        return this.slopeLimitAngleValue;
    }

    set slopeLimitAngle(value: number) {
        assertFiniteNumber(value, "slopeLimitAngle");
        this.slopeLimitAngleValue = Math.max(0, Math.min(90, value));
    }

    get stepHeight(): number {
        return this.stepHeightValue;
    }

    set stepHeight(value: number) {
        assertNonNegativeNumber(value, "stepHeight");
        this.stepHeightValue = value;
    }

    get minMoveDistance(): number {
        return this.minMoveDistanceValue;
    }

    set minMoveDistance(value: number) {
        assertNonNegativeNumber(value, "minMoveDistance");
        this.minMoveDistanceValue = value;
    }

    get jumpSpeed(): number {
        return this.jumpSpeedValue;
    }

    set jumpSpeed(value: number) {
        assertFiniteNumber(value, "jumpSpeed");
        this.jumpSpeedValue = value;
    }

    get gravityScale(): number {
        return this.gravityScaleValue;
    }

    set gravityScale(value: number) {
        assertFiniteNumber(value, "gravityScale");
        this.gravityScaleValue = value;
    }

    get deltaTime(): number {
        return this.deltaTimeValue;
    }

    set deltaTime(value: number) {
        assertPositiveNumber(value, "deltaTime");
        this.deltaTimeValue = value;
    }

    get useGravity(): boolean {
        return this.useGravityValue;
    }

    set useGravity(value: boolean) {
        this.useGravityValue = value;
    }

    get detectCollisions(): boolean {
        return this.detectCollisionsValue;
    }

    set detectCollisions(value: boolean) {
        this.detectCollisionsValue = value;
    }

    get enabled(): boolean {
        return this.controllerEnabled;
    }

    get velocity(): Vec3Tuple {
        return [this.velocityState[0], this.velocityState[1], this.velocityState[2]];
    }

    get collisionFlags(): CollisionFlagsValue {
        return this.flags;
    }

    isGrounded(): boolean {
        this.ensureAlive();
        return this.grounded;
    }

    setEnabled(enabled: boolean): void {
        this.ensureAlive();
        this.controllerEnabled = enabled;
    }

    jump(): void {
        this.ensureAlive();
        this.verticalVelocity = this.jumpSpeedValue;
        this.grounded = false;
    }

    simpleMove(speed: Vec3Tuple): boolean {
        this.ensureAlive();
        if (!this.controllerEnabled) {
            return this.grounded;
        }
        this.assertMotion(speed, "speed");
        this.pendingMovement[0] = speed[0];
        this.pendingMovement[1] = speed[1];
        this.pendingMovement[2] = speed[2];
        return this.grounded;
    }

    move(motion: Vec3Tuple): CollisionFlagsValue {
        this.ensureAlive();
        if (!this.controllerEnabled) {
            return CollisionFlags.None;
        }
        this.assertMotion(motion, "motion");

        const dt = this.deltaTimeValue;
        let motionX = motion[0] + this.pendingMovement[0] * dt;
        let motionY = motion[1] + this.pendingMovement[1] * dt;
        let motionZ = motion[2] + this.pendingMovement[2] * dt;
        this.pendingMovement[0] = 0;
        this.pendingMovement[1] = 0;
        this.pendingMovement[2] = 0;

        if (this.useGravityValue) {
            if (!this.grounded) {
                this.verticalVelocity += GRAVITY_ACCELERATION * this.gravityScaleValue * dt;
            }
            motionY += this.verticalVelocity * dt;
            if (this.grounded && this.verticalVelocity < 0) {
                this.verticalVelocity = 0;
            }
        }

        const length = Math.sqrt(motionX * motionX + motionY * motionY + motionZ * motionZ);
        if (length < this.minMoveDistanceValue) {
            return CollisionFlags.None;
        }

        const from = this.currentPosition();
        const result = this.performMove(from, [motionX, motionY, motionZ]);
        this.applyPosition(from, result, dt);
        this.updateGroundState();
        if (this.grounded && this.verticalVelocity < 0) {
            this.verticalVelocity = 0;
        }
        return this.flags;
    }

    update(deltaTime: number): void {
        this.ensureAlive();
        assertPositiveNumber(deltaTime, "deltaTime");
        if (!this.controllerEnabled) {
            return;
        }

        let motionX = this.pendingMovement[0] * deltaTime;
        let motionY = this.pendingMovement[1] * deltaTime;
        let motionZ = this.pendingMovement[2] * deltaTime;
        this.pendingMovement[0] = 0;
        this.pendingMovement[1] = 0;
        this.pendingMovement[2] = 0;

        if (this.useGravityValue) {
            if (!this.grounded) {
                this.verticalVelocity += GRAVITY_ACCELERATION * this.gravityScaleValue * deltaTime;
            }
            motionY += this.verticalVelocity * deltaTime;
            if (this.grounded && this.verticalVelocity < 0) {
                this.verticalVelocity = 0;
            }
        }

        const from = this.currentPosition();
        const result = this.performMove(from, [motionX, motionY, motionZ]);
        if (result[0] !== from[0] || result[1] !== from[1] || result[2] !== from[2]) {
            this.applyPosition(from, result, deltaTime);
        }
        this.updateGroundState();
        if (this.grounded && this.verticalVelocity < 0) {
            this.verticalVelocity = 0;
        }
    }

    dispose(): void {
        if (this.disposed) {
            return;
        }
        this.disposed = true;
        this.world = null;
    }

    [Symbol.dispose](): void {
        this.dispose();
    }

    private assertMotion(motion: Vec3Tuple, label: string): void {
        assertFiniteNumber(motion[0], `${label}[0]`);
        assertFiniteNumber(motion[1], `${label}[1]`);
        assertFiniteNumber(motion[2], `${label}[2]`);
    }

    private currentWorld(): WasmPhysicsWorld3D {
        if (this.world === null) {
            throw new Error("character controller has been disposed");
        }
        return this.world;
    }

    private ensureAlive(): void {
        if (this.disposed) {
            throw new Error("character controller has been disposed");
        }
    }

    private currentPosition(): [number, number, number] {
        const snapshot = this.currentWorld().readTransform(this.body);
        return [snapshot.position[0], snapshot.position[1], snapshot.position[2]];
    }

    private applyPosition(from: Vec3Tuple, result: Vec3Tuple, dt: number): void {
        this.currentWorld().setTransform(this.body, [result[0], result[1], result[2]]);
        if (result[0] !== from[0] || result[1] !== from[1] || result[2] !== from[2]) {
            this.velocityState[0] = (result[0] - from[0]) / dt;
            this.velocityState[1] = (result[1] - from[1]) / dt;
            this.velocityState[2] = (result[2] - from[2]) / dt;
        }
    }

    private halfBodyHeight(): number {
        return this.radiusValue + (this.heightValue - this.radiusValue * 2) * 0.5;
    }

    private performMove(from: Vec3Tuple, motion: Vec3Tuple): [number, number, number] {
        let resultX = from[0];
        let resultY = from[1];
        let resultZ = from[2];
        this.flags = CollisionFlags.None;

        const world = this.world;
        if (!this.detectCollisionsValue || world === null) {
            return [from[0] + motion[0], from[1] + motion[1], from[2] + motion[2]];
        }

        if (motion[0] !== 0) {
            const candidate: [number, number, number] = [from[0] + motion[0], from[1], from[2]];
            if (this.hasBlockingOverlap(candidate, true)) {
                this.flags |= CollisionFlags.Sides;
            } else {
                resultX = candidate[0];
            }
        }

        if (motion[2] !== 0) {
            const candidate: [number, number, number] = [resultX, from[1], from[2] + motion[2]];
            if (this.hasBlockingOverlap(candidate, true)) {
                this.flags |= CollisionFlags.Sides;
            } else {
                resultZ = candidate[2];
            }
        }

        const verticalCandidate: [number, number, number] = [resultX, from[1] + motion[1], resultZ];
        if (motion[1] > 0 && this.hasBlockingOverlap(verticalCandidate, false)) {
            this.flags |= CollisionFlags.Above;
        } else {
            resultY = verticalCandidate[1];
        }

        const snapped = this.snapToGround([resultX, resultY, resultZ], motion[1] <= 0);
        if (snapped[1] !== resultY) {
            resultY = snapped[1];
            this.flags |= CollisionFlags.Below;
        }

        return [resultX, resultY, resultZ];
    }

    private controllerBounds(position: Vec3Tuple, horizontalOnly: boolean): { min: Vec3Tuple; max: Vec3Tuple } {
        const halfBodyHeight = this.halfBodyHeight();
        const inner = horizontalOnly
            ? Math.max(BAND_FLOOR, halfBodyHeight - this.skinWidthValue * 2)
            : halfBodyHeight;
        return {
            min: [position[0] - this.radiusValue, position[1] - inner, position[2] - this.radiusValue],
            max: [position[0] + this.radiusValue, position[1] + inner, position[2] + this.radiusValue]
        };
    }

    private hasBlockingOverlap(position: Vec3Tuple, horizontalOnly: boolean): boolean {
        const world = this.world;
        if (world === null) {
            return false;
        }
        const bounds = this.controllerBounds(position, horizontalOnly);
        const ids = world.overlapBoxAll(bounds.min, bounds.max);
        for (const id of ids) {
            if (id !== this.body) {
                return true;
            }
        }
        return false;
    }

    private groundRayLength(): number {
        return this.halfBodyHeight() + this.stepHeightValue + this.skinWidthValue + GROUND_PROBE_MARGIN;
    }

    private getGroundHit(position: Vec3Tuple): RaycastHit | null {
        const world = this.world;
        if (world === null) {
            return null;
        }
        const hits = world.raycast(position, [0, -1, 0], this.groundRayLength());
        for (const hit of hits) {
            if (hit.body !== this.body) {
                return hit;
            }
        }
        return null;
    }

    private snapToGround(position: [number, number, number], allowSnap: boolean): [number, number, number] {
        if (!allowSnap) {
            return position;
        }

        const hit = this.getGroundHit(position);
        if (hit === null) {
            return position;
        }

        const cosSlope = Math.cos((this.slopeLimitAngleValue * Math.PI) / 180);
        if (hit.normal[1] < cosSlope) {
            return position;
        }

        const targetY = hit.point[1] + this.halfBodyHeight();
        if (Math.abs(targetY - position[1]) > this.stepHeightValue + this.skinWidthValue + GROUND_PROBE_MARGIN) {
            return position;
        }

        return [position[0], targetY, position[2]];
    }

    private updateGroundState(): void {
        const world = this.world;
        if (world === null) {
            return;
        }

        this.grounded = false;
        this.flags &= ~CollisionFlags.Below;

        const position = this.currentPosition();
        const hit = this.getGroundHit(position);
        if (hit === null) {
            return;
        }

        const cosSlope = Math.cos((this.slopeLimitAngleValue * Math.PI) / 180);
        this.grounded = hit.normal[1] >= cosSlope;
        if (this.grounded) {
            this.flags |= CollisionFlags.Below;
        }
    }

    private validateCapsule(): void {
        const world = this.world;
        if (world === null) {
            return;
        }
        const snapshot = world.readTransform(this.body);
        const rotation = snapshot.rotation;
        if (Math.abs(rotation[0]) > IDENTITY_ROTATION_EPSILON ||
            Math.abs(rotation[1]) > IDENTITY_ROTATION_EPSILON ||
            Math.abs(rotation[2]) > IDENTITY_ROTATION_EPSILON ||
            Math.abs(Math.abs(rotation[3]) - 1) > IDENTITY_ROTATION_EPSILON) {
            throw new Error(`body ${this.body} capsule must be upright with an identity rotation`);
        }

        const center: [number, number, number] = [snapshot.position[0], snapshot.position[1], snapshot.position[2]];
        const halfBodyHeight = this.halfBodyHeight();
        const radius = this.radiusValue;
        const halfSegment = halfBodyHeight - radius;
        const diagonal = Math.SQRT1_2;

        this.probeSurface(center, [0, 1, 0], halfBodyHeight, "+Y");
        this.probeSurface(center, [0, -1, 0], halfBodyHeight, "-Y");
        this.probeSurface(center, [1, 0, 0], radius, "+X");
        this.probeSurface(center, [0, 0, 1], radius, "+Z");
        this.probeSurface(center, [diagonal, 0, diagonal], radius, "horizontal diagonal");

        const domeCenter: [number, number, number] = [center[0], center[1] + halfSegment + radius * 0.5, center[2]];
        this.probeSurface(domeCenter, [1, 0, 0], radius * Math.sqrt(0.75), "cap curvature");
    }

    private probeSurface(
        center: Vec3Tuple,
        unit: Vec3Tuple,
        surfaceOffset: number,
        label: string
    ): void {
        const world = this.world;
        if (world === null) {
            return;
        }
        const standoff = surfaceOffset + 1;
        const origin: Vec3Tuple = [center[0] - unit[0] * standoff, center[1] - unit[1] * standoff, center[2] - unit[2] * standoff];
        const hits = world.raycast(origin, unit, PROBE_RAY_LENGTH);
        for (const hit of hits) {
            if (hit.body !== this.body) {
                continue;
            }
            if (Math.abs(hit.distance - 1) > PROBE_TOLERANCE) {
                throw new Error(`body ${this.body} capsule surface along ${label} is at ${hit.distance}, expected 1`);
            }
            return;
        }
        throw new Error(`body ${this.body} does not expose a capsule surface along ${label}`);
    }
}
