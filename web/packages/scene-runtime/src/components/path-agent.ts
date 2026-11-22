import { Vec3 } from '@axrone/numeric';
import { Transform } from '@axrone/ecs-runtime';
import { Component } from '@axrone/ecs-runtime';
import { script } from '@axrone/ecs-runtime';
import type { Mutable } from '@axrone/utility';

export type PathAgentPathStatus = 'idle' | 'computing' | 'following' | 'arrived' | 'failed';
export type PathAgentObstacleAvoidanceQuality = 'none' | 'low' | 'medium' | 'high';

export interface PathAgentConfig {
    readonly radius?: number;
    readonly height?: number;
    readonly speed?: number;
    readonly angularSpeed?: number;
    readonly acceleration?: number;
    readonly stoppingDistance?: number;
    readonly autoBraking?: boolean;
    readonly autoRepath?: boolean;
    readonly baseOffset?: number;
    readonly areaMask?: number;
    readonly obstacleAvoidanceQuality?: PathAgentObstacleAvoidanceQuality;
    readonly avoidancePriority?: number;
}

export interface PathAgentPath {
    readonly corners: readonly Vec3[];
    readonly status: 'complete' | 'partial' | 'invalid';
}

/**
 * PathAgent component steers an agent toward a destination along a corner
 * list. Destinations resolve to a direct path that the agent follows with
 * acceleration, auto-braking, and stopping-distance handling. There is no
 * navigation-mesh backend: obstacle avoidance and area-mask fields are
 * accepted for API compatibility and currently have no behavioral effect.
 *
 * @example
 * ```ts
 * const agent = new PathAgent({
 *     speed: 3.5,
 *     angularSpeed: 120,
 *     stoppingDistance: 0.5,
 * });
 * actor.addComponent(PathAgent, agent);
 *
 * // Set destination
 * agent.setDestination(new Vec3(10, 0, 5));
 * ```
 */
@script({
    scriptName: 'PathAgent',
    priority: 300,
    executeInEditMode: false,
    singleton: false,
})
export class PathAgent extends Component {
    private _radius: number;
    private _height: number;
    private _speed: number;
    private _angularSpeed: number;
    private _acceleration: number;
    private _stoppingDistance: number;
    private _autoBraking: boolean;
    private _autoRepath: boolean;
    private _baseOffset: number;
    private _areaMask: number;
    private _obstacleAvoidanceQuality: PathAgentObstacleAvoidanceQuality;
    private _avoidancePriority: number;

    private _destination: Vec3 | null = null;
    private _path: PathAgentPath | null = null;
    private _pathStatus: PathAgentPathStatus = 'idle';
    private _currentCornerIndex: number = 0;
    private _velocity: Vec3 = Vec3.ZERO.clone();
    private _remainingDistance: number = 0;
    private _isStopped: boolean = false;
    private _warpPending: boolean = false;
    private _warpTarget: Vec3 | null = null;

    // Pre-allocated temp vectors to avoid per-frame garbage in update()
    private readonly _tempToCorner = new Vec3();
    private readonly _tempVelocity = new Vec3();

    constructor(config: PathAgentConfig = {}) {
        super();
        this._radius = 0.5;
        this._height = 2;
        this._speed = 3.5;
        this._angularSpeed = 120;
        this._acceleration = 8;
        this._stoppingDistance = 0.1;
        this._autoBraking = true;
        this._autoRepath = true;
        this._baseOffset = 0;
        this._areaMask = 0xffffffff;
        this._obstacleAvoidanceQuality = 'high';
        this._avoidancePriority = 50;
        this._applyConfig(config);
    }

    get radius(): number {
        return this._radius;
    }

    set radius(value: number) {
        this._radius = Math.max(0.01, value);
    }

    get height(): number {
        return this._height;
    }

    set height(value: number) {
        this._height = Math.max(0.01, value);
    }

    get speed(): number {
        return this._speed;
    }

    set speed(value: number) {
        this._speed = Math.max(0, value);
    }

    get angularSpeed(): number {
        return this._angularSpeed;
    }

    set angularSpeed(value: number) {
        this._angularSpeed = Math.max(0, value);
    }

    get acceleration(): number {
        return this._acceleration;
    }

    set acceleration(value: number) {
        this._acceleration = Math.max(0, value);
    }

    get stoppingDistance(): number {
        return this._stoppingDistance;
    }

    set stoppingDistance(value: number) {
        this._stoppingDistance = Math.max(0, value);
    }

    get autoBraking(): boolean {
        return this._autoBraking;
    }

    set autoBraking(value: boolean) {
        this._autoBraking = value;
    }

    get autoRepath(): boolean {
        return this._autoRepath;
    }

    set autoRepath(value: boolean) {
        this._autoRepath = value;
    }

    get baseOffset(): number {
        return this._baseOffset;
    }

    set baseOffset(value: number) {
        this._baseOffset = value;
    }

    get areaMask(): number {
        return this._areaMask;
    }

    set areaMask(value: number) {
        this._areaMask = value >>> 0;
    }

    get obstacleAvoidanceQuality(): PathAgentObstacleAvoidanceQuality {
        return this._obstacleAvoidanceQuality;
    }

    set obstacleAvoidanceQuality(value: PathAgentObstacleAvoidanceQuality) {
        this._obstacleAvoidanceQuality = value;
    }

    get avoidancePriority(): number {
        return this._avoidancePriority;
    }

    set avoidancePriority(value: number) {
        this._avoidancePriority = Math.max(0, Math.min(99, value));
    }

    get destination(): Vec3 | null {
        return this._destination;
    }

    get path(): PathAgentPath | null {
        return this._path;
    }

    get pathStatus(): PathAgentPathStatus {
        return this._pathStatus;
    }

    /** Live steering state — read-only view owned by the movement update. */
    get velocity(): Vec3 {
        return this._velocity;
    }

    get remainingDistance(): number {
        return this._remainingDistance;
    }

    get isStopped(): boolean {
        return this._isStopped;
    }

    set isStopped(value: boolean) {
        this._isStopped = value;
        if (value) {
            this._velocity.x = 0;
            this._velocity.y = 0;
            this._velocity.z = 0;
        }
    }

    get hasPath(): boolean {
        return this._path !== null && this._path.status !== 'invalid';
    }

    get isOnPath(): boolean {
        // In a full implementation, this would check if the agent is on a valid path network
        return true;
    }

    get currentCornerIndex(): number {
        return this._currentCornerIndex;
    }

    /**
     * Sets the destination for the agent to navigate to.
     * @param target The world-space position to navigate to
     * @returns True if path computation started successfully
     */
    setDestination(target: Vec3 | readonly [number, number, number]): boolean {
        const targetVec = target instanceof Vec3 ? target.clone() : Vec3.fromArray(target);
        this._destination = targetVec;
        this._pathStatus = 'computing';
        this._isStopped = false;

        // No navigation-mesh backend: steer directly toward the destination.
        const currentPosition = this.getWorldPosition();
        this._path = {
            corners: [currentPosition, targetVec],
            status: 'complete',
        };
        this._currentCornerIndex = 1;
        this._pathStatus = 'following';
        this._updateRemainingDistance();

        return true;
    }

    /**
     * Warps the agent to a new position without pathfinding.
     * @param position The world-space position to warp to
     * @returns True if the warp was successful
     */
    warp(position: Vec3 | readonly [number, number, number]): boolean {
        const targetVec = position instanceof Vec3 ? position.clone() : Vec3.fromArray(position);
        this._warpTarget = targetVec;
        this._warpPending = true;

        return true;
    }

    /**
     * Resets the current path and stops the agent.
     */
    resetPath(): void {
        this._path = null;
        this._pathStatus = 'idle';
        this._currentCornerIndex = 0;
        this._velocity.x = 0;
        this._velocity.y = 0;
        this._velocity.z = 0;
        this._remainingDistance = 0;
    }

    /**
     * Stops the agent and optionally clears the path.
     */
    stop(clearPath: boolean = false): void {
        this._isStopped = true;
        this._velocity.x = 0;
        this._velocity.y = 0;
        this._velocity.z = 0;

        if (clearPath) {
            this.resetPath();
        }
    }

    /**
     * Resumes path following if stopped.
     */
    resume(): void {
        this._isStopped = false;
        if (this._path && this._pathStatus === 'following') {
            // Continue following the path
        }
    }

    /**
     * Gets the next corner/waypoint on the current path.
     */
    getNextCorner(): Vec3 | null {
        if (!this._path || this._currentCornerIndex >= this._path.corners.length) {
            return null;
        }

        return this._path.corners[this._currentCornerIndex] ?? null;
    }

    /**
     * Gets the world-space position of the agent.
     */
    getWorldPosition(): Vec3 {
        const transform = this.transform as Transform | undefined;
        if (!transform) {
            return Vec3.ZERO.clone();
        }

        return transform.worldPosition.clone();
    }

    /**
     * Checks if the agent has reached its destination.
     */
    hasReachedDestination(): boolean {
        if (!this._destination) {
            return true;
        }

        return this._remainingDistance <= this._stoppingDistance;
    }

    /**
     * Calculates the distance to a specific point along the path.
     */
    getDistanceToPoint(point: Vec3): number {
        const currentPosition = this.getWorldPosition();
        return Vec3.distance(currentPosition, point);
    }

    override update(deltaTime: number): void {
        // Handle pending warp before any early returns so warp works regardless of path status
        if (this._warpPending && this._warpTarget) {
            const transform = this.transform as Transform | undefined;
            if (transform) {
                // worldPosition is read-only — move via a world-space delta
                // so parented agents land on the exact target as well.
                Vec3.subtract(this._warpTarget, transform.worldPosition, this._tempToCorner);
                transform.translate(this._tempToCorner, 'world');
            }
            this._warpPending = false;
            this._warpTarget = null;
        }

        if (this._isStopped || this._pathStatus !== 'following' || !this._path) {
            return;
        }

        const nextCorner = this.getNextCorner();
        if (!nextCorner) {
            this._pathStatus = 'arrived';
            this._velocity.x = 0;
            this._velocity.y = 0;
            this._velocity.z = 0;
            return;
        }

        const currentPosition = this.getWorldPosition();
        const toCorner = Vec3.subtract(nextCorner, currentPosition, this._tempToCorner);
        const distanceToCorner = Vec3.len(toCorner);

        if (distanceToCorner <= this._stoppingDistance) {
            this._currentCornerIndex++;

            if (this._currentCornerIndex >= this._path.corners.length) {
                this._pathStatus = 'arrived';
                this._velocity.x = 0;
                this._velocity.y = 0;
                this._velocity.z = 0;
                this._remainingDistance = 0;
                return;
            }
        }

        // Calculate velocity towards next corner
        if (distanceToCorner > 0.001) {
            Vec3.normalize(toCorner, toCorner);

            // Apply acceleration
            const targetSpeed = this._autoBraking && distanceToCorner < this._speed
                ? distanceToCorner
                : this._speed;

            const currentSpeed = Vec3.len(this._velocity);
            const newSpeed = Math.min(
                targetSpeed,
                currentSpeed + this._acceleration * deltaTime
            );

            Vec3.multiplyScalar(toCorner, newSpeed, this._velocity);
        }

        // Integrate position — advance the transform by this frame's
        // velocity, clamped so the agent lands on (never overshoots) the
        // corner. Uses world-space translation so parented agents move
        // correctly without any per-frame allocation.
        const stepLength = Vec3.len(this._velocity) * deltaTime;
        if (stepLength > 1e-9) {
            const transform = this.transform as Transform | undefined;
            if (transform) {
                const clampedScale =
                    distanceToCorner > 0 ? Math.min(stepLength, distanceToCorner) / stepLength : 0;
                Vec3.multiplyScalar(this._velocity, deltaTime * clampedScale, this._tempVelocity);
                transform.translate(this._tempVelocity, 'world');
            }
        }

        this._updateRemainingDistance();
    }

    override serialize(): Record<string, unknown> {
        return {
            radius: this._radius,
            height: this._height,
            speed: this._speed,
            angularSpeed: this._angularSpeed,
            acceleration: this._acceleration,
            stoppingDistance: this._stoppingDistance,
            autoBraking: this._autoBraking,
            autoRepath: this._autoRepath,
            baseOffset: this._baseOffset,
            areaMask: this._areaMask,
            obstacleAvoidanceQuality: this._obstacleAvoidanceQuality,
            avoidancePriority: this._avoidancePriority,
        };
    }

    override deserialize(data: Record<string, any>): void {
        type MutableConfig = Mutable<PathAgentConfig>;
        const patch: MutableConfig = {};

        if (typeof data.radius === 'number') {
            patch.radius = data.radius;
        }
        if (typeof data.height === 'number') {
            patch.height = data.height;
        }
        if (typeof data.speed === 'number') {
            patch.speed = data.speed;
        }
        if (typeof data.angularSpeed === 'number') {
            patch.angularSpeed = data.angularSpeed;
        }
        if (typeof data.acceleration === 'number') {
            patch.acceleration = data.acceleration;
        }
        if (typeof data.stoppingDistance === 'number') {
            patch.stoppingDistance = data.stoppingDistance;
        }
        if (typeof data.autoBraking === 'boolean') {
            patch.autoBraking = data.autoBraking;
        }
        if (typeof data.autoRepath === 'boolean') {
            patch.autoRepath = data.autoRepath;
        }
        if (typeof data.baseOffset === 'number') {
            patch.baseOffset = data.baseOffset;
        }
        if (typeof data.areaMask === 'number') {
            patch.areaMask = data.areaMask;
        }
        if (typeof data.obstacleAvoidanceQuality === 'string') {
            patch.obstacleAvoidanceQuality = data.obstacleAvoidanceQuality;
        }
        if (typeof data.avoidancePriority === 'number') {
            patch.avoidancePriority = data.avoidancePriority;
        }

        this._applyConfig(patch);
    }

    private _updateRemainingDistance(): void {
        if (!this._path || !this._destination) {
            this._remainingDistance = 0;
            return;
        }

        const currentPosition = this.getWorldPosition();
        let distance = 0;

        // Distance to next corner
        const nextCorner = this.getNextCorner();
        if (nextCorner) {
            distance += Vec3.distance(currentPosition, nextCorner);
        }

        // Distance along remaining path
        for (let i = this._currentCornerIndex; i < this._path.corners.length - 1; i++) {
            const corner = this._path.corners[i];
            const nextCornerInPath = this._path.corners[i + 1];
            if (corner && nextCornerInPath) {
                distance += Vec3.distance(corner, nextCornerInPath);
            }
        }

        this._remainingDistance = distance;
    }

    private _applyConfig(config: PathAgentConfig): void {
        if (typeof config.radius === 'number') {
            this._radius = Math.max(0.01, config.radius);
        }
        if (typeof config.height === 'number') {
            this._height = Math.max(0.01, config.height);
        }
        if (typeof config.speed === 'number') {
            this._speed = Math.max(0, config.speed);
        }
        if (typeof config.angularSpeed === 'number') {
            this._angularSpeed = Math.max(0, config.angularSpeed);
        }
        if (typeof config.acceleration === 'number') {
            this._acceleration = Math.max(0, config.acceleration);
        }
        if (typeof config.stoppingDistance === 'number') {
            this._stoppingDistance = Math.max(0, config.stoppingDistance);
        }
        if (typeof config.autoBraking === 'boolean') {
            this._autoBraking = config.autoBraking;
        }
        if (typeof config.autoRepath === 'boolean') {
            this._autoRepath = config.autoRepath;
        }
        if (typeof config.baseOffset === 'number') {
            this._baseOffset = config.baseOffset;
        }
        if (typeof config.areaMask === 'number') {
            this._areaMask = config.areaMask >>> 0;
        }
        if (config.obstacleAvoidanceQuality) {
            this._obstacleAvoidanceQuality = config.obstacleAvoidanceQuality;
        }
        if (typeof config.avoidancePriority === 'number') {
            this._avoidancePriority = Math.max(0, Math.min(99, config.avoidancePriority));
        }
    }
}
