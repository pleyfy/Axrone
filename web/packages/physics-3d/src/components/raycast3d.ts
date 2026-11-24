import { Vec3, Quat, type IVec3Like } from '@axrone/numeric';
import { script } from '@axrone/ecs-runtime/decorators';
import { Component, Transform } from '@axrone/ecs-runtime';
import type { PhysicsWorld3D } from '../core/physics-world-3d';

export interface RaycastHit3D {
    readonly hit: boolean;
    readonly point: Vec3;
    readonly normal: Vec3;
    readonly distance: number;
    readonly colliderId: number;
    readonly entityUid: string | null;
}

export interface RayCast3DConfig {
    readonly direction?: IVec3Like;
    readonly maxDistance?: number;
    readonly layerMask?: number;
    readonly queryTriggerInteraction?: 'use-global' | 'ignore' | 'collide';
    readonly debugDraw?: boolean;
    readonly debugColor?: readonly [number, number, number];
    readonly debugHitColor?: readonly [number, number, number];
}

const DEFAULT_DIRECTION: IVec3Like = Object.freeze({ x: 0, y: -1, z: 0 });
const DEFAULT_DEBUG_COLOR: readonly [number, number, number] = [1, 1, 0];
const DEFAULT_DEBUG_HIT_COLOR: readonly [number, number, number] = [1, 0, 0];

/**
 * RayCast3D component casts a ray from the object's position in a specified direction
 * and reports collision information. Useful for detection, line-of-sight checks,
 * and interaction systems.
 *
 * @example
 * ```ts
 * const raycast = new RayCast3D({
 *     direction: { x: 0, y: -1, z: 0 },
 *     maxDistance: 10,
 * });
 * entity.addComponent(RayCast3D, raycast);
 *
 * // In update loop
 * if (raycast.cast()) {
 *     console.log('Hit at:', raycast.hitPoint);
 * }
 * ```
 */
@script({ scriptName: 'RayCast3D', description: 'Physics raycasting component' })
export class RayCast3D extends Component {
    private _direction: Vec3;
    private _maxDistance: number;
    private _layerMask: number;
    private _queryTriggerInteraction: 'use-global' | 'ignore' | 'collide';
    private _debugDraw: boolean;
    private _debugColor: Vec3;
    private _debugHitColor: Vec3;

    private _lastHit: RaycastHit3D | null = null;
    private _hitEntities: string[] = [];
    private _world: PhysicsWorld3D | null = null;

    constructor(config: RayCast3DConfig = {}) {
        super();
        this._direction = new Vec3(0, -1, 0);
        this._maxDistance = 100;
        this._layerMask = 0xffffffff;
        this._queryTriggerInteraction = 'use-global';
        this._debugDraw = false;
        this._debugColor = Vec3.fromArray(DEFAULT_DEBUG_COLOR as unknown as number[]);
        this._debugHitColor = Vec3.fromArray(DEFAULT_DEBUG_HIT_COLOR as unknown as number[]);
        this._applyConfig(config);
    }

    get direction(): Vec3 {
        return this._direction;
    }

    set direction(value: IVec3Like) {
        this._direction = Vec3.from(value);
        Vec3.normalize(this._direction, this._direction);
    }

    get maxDistance(): number {
        return this._maxDistance;
    }

    set maxDistance(value: number) {
        this._maxDistance = Math.max(0.001, value);
    }

    get layerMask(): number {
        return this._layerMask;
    }

    set layerMask(value: number) {
        this._layerMask = value >>> 0;
    }

    get queryTriggerInteraction(): 'use-global' | 'ignore' | 'collide' {
        return this._queryTriggerInteraction;
    }

    set queryTriggerInteraction(value: 'use-global' | 'ignore' | 'collide') {
        this._queryTriggerInteraction = value;
    }

    get debugDraw(): boolean {
        return this._debugDraw;
    }

    set debugDraw(value: boolean) {
        this._debugDraw = value;
    }

    get debugColor(): Vec3 {
        return this._debugColor;
    }

    set debugColor(value: readonly [number, number, number]) {
        this._debugColor = Vec3.fromArray(value as unknown as number[]);
    }

    get debugHitColor(): Vec3 {
        return this._debugHitColor;
    }

    set debugHitColor(value: readonly [number, number, number]) {
        this._debugHitColor = Vec3.fromArray(value as unknown as number[]);
    }

    get lastHit(): RaycastHit3D | null {
        return this._lastHit;
    }

    get hasHit(): boolean {
        return this._lastHit?.hit ?? false;
    }

    get hitPoint(): Vec3 | null {
        return this._lastHit?.hit ? this._lastHit.point : null;
    }

    get hitNormal(): Vec3 | null {
        return this._lastHit?.hit ? this._lastHit.normal : null;
    }

    get hitDistance(): number {
        return this._lastHit?.distance ?? 0;
    }

    get hitEntityUid(): string | null {
        return this._lastHit?.entityUid ?? null;
    }

    /**
     * Gets the world-space origin of the ray.
     */
    getRayOrigin(): Vec3 {
        const transform = this.transform as Transform | undefined;
        if (!transform) {
            return Vec3.ZERO.clone();
        }

        return transform.worldPosition.clone();
    }

    /**
     * Gets the world-space direction of the ray.
     * If the direction is set to use local space, it will be transformed by the object's rotation.
     */
    getWorldDirection(): Vec3 {
        const transform = this.transform as Transform | undefined;
        if (!transform) {
            return this._direction.clone();
        }

        const worldDir = Quat.rotateVector(transform.worldRotation, this._direction, new Vec3());
        return Vec3.normalize(worldDir, worldDir);
    }

    /**
     * Gets the end point of the ray in world space.
     */
    getRayEndPoint(): Vec3 {
        const origin = this.getRayOrigin();
        const direction = this.getWorldDirection();

        return new Vec3(
            origin.x + direction.x * this._maxDistance,
            origin.y + direction.y * this._maxDistance,
            origin.z + direction.z * this._maxDistance
        );
    }

    /**
     * Sets the physics world reference for raycasting queries.
     * Called by the physics bridge during initialization.
     */
    setPhysicsWorld(world: PhysicsWorld3D): void {
        this._world = world;
    }

    /**
     * Performs the raycast and returns whether something was hit.
     * Queries the physics world for the closest ray intersection.
     */
    cast(): boolean {
        if (!this._world) {
            return this._lastHit?.hit ?? false;
        }

        const origin = this.getRayOrigin();
        const direction = this.getWorldDirection();

        const hit = this._world.rayCastClosest(
            { x: origin.x, y: origin.y, z: origin.z },
            { x: direction.x, y: direction.y, z: direction.z },
            this._maxDistance / Math.max(0.001, Vec3.len(direction))
        );

        if (hit && hit.hit) {
            this._lastHit = {
                hit: true,
                point: new Vec3(hit.point.x, hit.point.y, hit.point.z),
                normal: new Vec3(hit.normal.x, hit.normal.y, hit.normal.z),
                distance: hit.fraction * this._maxDistance,
                colliderId: hit.shapeId,
                entityUid: String(hit.bodyId),
            };
            return true;
        }

        this._lastHit = null;
        return false;
    }

    /**
     * Sets the hit result from an external physics query.
     */
    setHitResult(hit: RaycastHit3D | null): void {
        this._lastHit = hit;
    }

    /**
     * Clears the last hit result.
     */
    clearHit(): void {
        this._lastHit = null;
    }

    override onDestroy(): void {
        this._world = null;
    }

    /**
     * Checks if a layer is included in the layer mask.
     */
    includesLayer(layer: number): boolean {
        return (this._layerMask & (1 << layer)) !== 0;
    }

    /**
     * Adds a layer to the layer mask.
     */
    addLayer(layer: number): void {
        this._layerMask |= 1 << layer;
    }

    /**
     * Removes a layer from the layer mask.
     */
    removeLayer(layer: number): void {
        this._layerMask &= ~(1 << layer);
    }

    override serialize(): Record<string, unknown> {
        return {
            direction: [this._direction.x, this._direction.y, this._direction.z],
            maxDistance: this._maxDistance,
            layerMask: this._layerMask,
            queryTriggerInteraction: this._queryTriggerInteraction,
            debugDraw: this._debugDraw,
            debugColor: [this._debugColor.x, this._debugColor.y, this._debugColor.z],
            debugHitColor: [this._debugHitColor.x, this._debugHitColor.y, this._debugHitColor.z],
        };
    }

    override deserialize(data: Record<string, any>): void {
        const patch: RayCast3DConfig = {};

        if (Array.isArray(data.direction) && data.direction.length === 3) {
            (patch as any).direction = { x: data.direction[0], y: data.direction[1], z: data.direction[2] };
        }
        if (typeof data.maxDistance === 'number') {
            (patch as any).maxDistance = data.maxDistance;
        }
        if (typeof data.layerMask === 'number') {
            (patch as any).layerMask = data.layerMask;
        }
        if (typeof data.queryTriggerInteraction === 'string') {
            (patch as any).queryTriggerInteraction = data.queryTriggerInteraction;
        }
        if (typeof data.debugDraw === 'boolean') {
            (patch as any).debugDraw = data.debugDraw;
        }
        if (Array.isArray(data.debugColor) && data.debugColor.length === 3) {
            (patch as any).debugColor = data.debugColor;
        }
        if (Array.isArray(data.debugHitColor) && data.debugHitColor.length === 3) {
            (patch as any).debugHitColor = data.debugHitColor;
        }

        this._applyConfig(patch);
    }

    private _applyConfig(config: RayCast3DConfig): void {
        if (config.direction) {
            this._direction = new Vec3(config.direction.x, config.direction.y, config.direction.z);
            Vec3.normalize(this._direction, this._direction);
        }
        if (typeof config.maxDistance === 'number') {
            this._maxDistance = Math.max(0.001, config.maxDistance);
        }
        if (typeof config.layerMask === 'number') {
            this._layerMask = config.layerMask >>> 0;
        }
        if (config.queryTriggerInteraction) {
            this._queryTriggerInteraction = config.queryTriggerInteraction;
        }
        if (typeof config.debugDraw === 'boolean') {
            this._debugDraw = config.debugDraw;
        }
        if (config.debugColor) {
            this._debugColor = Vec3.fromArray(config.debugColor as unknown as number[]);
        }
        if (config.debugHitColor) {
            this._debugHitColor = Vec3.fromArray(config.debugHitColor as unknown as number[]);
        }
    }
}
