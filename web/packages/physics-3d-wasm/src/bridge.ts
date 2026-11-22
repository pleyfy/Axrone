import type { World, Actor } from '@axrone/ecs-runtime';
import {
    Rigidbody3D,
    Collider3D,
    Joint3D,
    CharacterController,
} from './components';
import { WasmPhysicsWorld3DCompat } from './compat';
import { PHYSICS_ITERATION_POLICY } from './policy';
import type {
    CompatWorldConfig,
    CompatCollisionEvent,
    CompatSensorEvent,
    CompatContactListener,
} from './compat';

// ---------------------------------------------------------------------------
// Local type definitions
//
// These mirror the structural shapes from @axrone/game-loop and
// scene-runtime so the wasm package avoids a scene-runtime dependency.
// TypeScript's structural typing ensures compatibility when the bridge
// is consumed through the real GameLoopSystem interface.
// ---------------------------------------------------------------------------

/**
 * Minimal scene state shape required by the physics bridge.
 * Structurally compatible with `SceneLoopState` from scene-runtime.
 */
export interface SceneLoopState {
    readonly sceneId: string;
}

/**
 * Minimal game-loop system interface.
 * Structurally compatible with `GameLoopSystem<TState>` from @axrone/game-loop.
 */
export interface GameLoopSystem<TState> {
    readonly id: string;
    readonly priority?: number;
    readonly enabled?: boolean;
    beforeUpdate?(context: BeforeUpdateContext<TState>): void;
    fixedUpdate?(context: FixedUpdateContext<TState>): void;
    dispose?(): void;
}

/** Minimal before-update context (structural subset of @axrone/game-loop). */
export interface BeforeUpdateContext<TState> {
    readonly phase: 'before-update';
    readonly state: TState;
    readonly frame: number;
    readonly fixedDelta: number;
    readonly delta: number;
    readonly elapsed: number;
    readonly now: number;
    readonly accumulator: number;
    readonly timeScale: number;
}

/** Minimal fixed-update context (structural subset of @axrone/game-loop). */
export interface FixedUpdateContext<TState> extends BeforeUpdateContext<TState> {
    readonly step: number;
    readonly maxSteps: number;
}

// ---------------------------------------------------------------------------
// Collision handler interface
// ---------------------------------------------------------------------------

/**
 * Interface for user script components that want to receive physics collision
 * events. Implement these methods on any Component subclass to receive
 * callbacks.
 *
 * Uses the compat adapter's event types since the WASM bridge drives a
 * WasmPhysicsWorld3DCompat world.
 */
export interface IPhysicsCollisionHandler {
    onCollisionEnter?(other: Rigidbody3D, event: CompatCollisionEvent): void;
    onCollisionStay?(other: Rigidbody3D, event: CompatCollisionEvent): void;
    onCollisionExit?(other: Rigidbody3D, event: CompatCollisionEvent): void;
    onSensorEnter?(other: Rigidbody3D, event: CompatSensorEvent): void;
    onSensorStay?(other: Rigidbody3D, event: CompatSensorEvent): void;
    onSensorExit?(other: Rigidbody3D, event: CompatSensorEvent): void;
}

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

export interface WasmPhysicsBridge3DOptions {
    readonly worldConfig?: CompatWorldConfig;
    readonly velocityIterations?: number;
    readonly positionIterations?: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type AnyWorld = World<any>;
type AnyActor = Actor<AnyWorld>;

/**
 * Compute a deterministic, order-independent pair key from two body IDs.
 * Mirrors `makeCollisionPairKey` from @axrone/physics-core.
 */
function makePairKey(a: number, b: number): number {
    const lo = a < b ? a : b;
    const hi = a < b ? b : a;
    return lo * 0x100000 + hi;
}

const MILLISECONDS_PER_SECOND = 1000;

// ---------------------------------------------------------------------------
// WasmPhysicsBridge3D
// ---------------------------------------------------------------------------

/**
 * WASM-backed physics bridge for 3D scenes.
 *
 * Implements the same lifecycle contract as the reference `PhysicsBridge3D`
 * from scene-runtime, driving a `WasmPhysicsWorld3DCompat` world instead of
 * the TypeScript `PhysicsWorld3D`.
 *
 * EVENT ASYMMETRY (matches reference bridge exactly):
 * - Collisions dispatch begin/stay/end to BOTH actors in the pair
 * - Sensors dispatch enter/exit to BOTH actors in the pair
 * - onSensorStay is NOT dispatched (the reference bridge omits it)
 *
 * Discovery timing: `beforeUpdate` discovers new components (one frame late).
 * Prune on destroy: `fixedUpdate` sync removes destroyed actors from tracking
 * maps.
 */
export class WasmPhysicsBridge3D
    implements GameLoopSystem<SceneLoopState>, CompatContactListener
{
    readonly id = 'scene.physics-bridge-3d-wasm';

    private readonly _ecsWorld: AnyWorld;
    private readonly _physicsWorld: WasmPhysicsWorld3DCompat;
    private readonly _velocityIterations: number;
    private readonly _positionIterations: number;

    private readonly _initializedBodies = new WeakSet<Rigidbody3D>();
    private readonly _initializedColliders = new WeakSet<Collider3D>();
    private readonly _initializedJoints = new WeakSet<Joint3D>();
    private readonly _initializedCharacterControllers = new WeakSet<CharacterController>();
    private readonly _bodyIdToComponent = new Map<number, Rigidbody3D>();
    private readonly _componentToActor = new Map<Rigidbody3D, AnyActor>();
    private readonly _activeContactPairs = new Set<number>();
    private readonly _activeTriggerPairs = new Set<number>();

    private _disposed = false;

    private constructor(
        ecsWorld: AnyWorld,
        physicsWorld: WasmPhysicsWorld3DCompat,
        options: WasmPhysicsBridge3DOptions,
    ) {
        this._ecsWorld = ecsWorld;
        this._physicsWorld = physicsWorld;
        this._velocityIterations = options.velocityIterations ?? PHYSICS_ITERATION_POLICY.velocityIterations;
        this._positionIterations = options.positionIterations ?? PHYSICS_ITERATION_POLICY.positionIterations;
        this._physicsWorld.setContactListener(this);
    }

    /**
     * Asynchronously create a WasmPhysicsBridge3D.
     *
     * World creation is async because the WASM module must be loaded and
     * instantiated before the compat adapter can be constructed.
     */
    static async create(
        ecsWorld: AnyWorld,
        options: WasmPhysicsBridge3DOptions = {},
    ): Promise<WasmPhysicsBridge3D> {
        const world = await WasmPhysicsWorld3DCompat.create(options.worldConfig);
        return new WasmPhysicsBridge3D(ecsWorld, world, options);
    }

    get physicsWorld(): WasmPhysicsWorld3DCompat {
        return this._physicsWorld;
    }

    get isDisposed(): boolean {
        return this._disposed;
    }

    // -----------------------------------------------------------------------
    // GameLoopSystem lifecycle
    // -----------------------------------------------------------------------

    beforeUpdate(_context: BeforeUpdateContext<SceneLoopState>): void {
        if (this._disposed) return;
        this._initializeNewComponents();
    }

    fixedUpdate(context: FixedUpdateContext<SceneLoopState>): void {
        if (this._disposed) return;

        this._physicsWorld.step(
            context.fixedDelta / MILLISECONDS_PER_SECOND,
            this._velocityIterations,
            this._positionIterations,
        );

        this._syncAllTransforms();
    }

    // -----------------------------------------------------------------------
    // CompatContactListener — collision events
    // -----------------------------------------------------------------------

    onCollisionBegin(event: CompatCollisionEvent): void {
        const bodyIdA = event.bodyIdA;
        const bodyIdB = event.bodyIdB;
        const key = makePairKey(bodyIdA, bodyIdB);
        this._activeContactPairs.add(key);

        const componentA = this._bodyIdToComponent.get(bodyIdA);
        const componentB = this._bodyIdToComponent.get(bodyIdB);
        if (componentA && componentB) {
            this._dispatchCollisionEvent(
                componentA,
                componentB,
                event,
                'onCollisionBegin',
            );
        }
    }

    onCollisionStay(event: CompatCollisionEvent): void {
        const bodyIdA = event.bodyIdA;
        const bodyIdB = event.bodyIdB;

        const componentA = this._bodyIdToComponent.get(bodyIdA);
        const componentB = this._bodyIdToComponent.get(bodyIdB);
        if (componentA && componentB) {
            this._dispatchCollisionEvent(
                componentA,
                componentB,
                event,
                'onCollisionStay',
            );
        }
    }

    onCollisionEnd(event: CompatCollisionEvent): void {
        const bodyIdA = event.bodyIdA;
        const bodyIdB = event.bodyIdB;
        const key = makePairKey(bodyIdA, bodyIdB);
        this._activeContactPairs.delete(key);

        const componentA = this._bodyIdToComponent.get(bodyIdA);
        const componentB = this._bodyIdToComponent.get(bodyIdB);
        if (componentA && componentB) {
            this._dispatchCollisionEndEvent(componentA, componentB, event);
        }
    }

    // -----------------------------------------------------------------------
    // CompatContactListener — sensor events
    //
    // EVENT ASYMMETRY: onSensorStay is intentionally NOT implemented.
    // The reference bridge omits it — only Enter/Exit reach actors.
    // -----------------------------------------------------------------------

    onSensorEnter(event: CompatSensorEvent): void {
        const bodyIdA = event.sensorBodyId;
        const bodyIdB = event.visitorBodyId;
        const key = makePairKey(bodyIdA, bodyIdB);
        this._activeTriggerPairs.add(key);

        const componentA = this._bodyIdToComponent.get(bodyIdA);
        const componentB = this._bodyIdToComponent.get(bodyIdB);
        if (componentA && componentB) {
            this._dispatchSensorEvent(
                componentA,
                componentB,
                event,
                'onSensorEnter',
            );
        }
    }

    onSensorExit(event: CompatSensorEvent): void {
        const bodyIdA = event.sensorBodyId;
        const bodyIdB = event.visitorBodyId;
        const key = makePairKey(bodyIdA, bodyIdB);
        this._activeTriggerPairs.delete(key);

        const componentA = this._bodyIdToComponent.get(bodyIdA);
        const componentB = this._bodyIdToComponent.get(bodyIdB);
        if (componentA && componentB) {
            this._dispatchSensorEvent(
                componentA,
                componentB,
                event,
                'onSensorExit',
            );
        }
    }

    // -----------------------------------------------------------------------
    // Disposal
    // -----------------------------------------------------------------------

    dispose(): void {
        if (this._disposed) return;
        this._disposed = true;
        this._physicsWorld.setContactListener(null);
        this._bodyIdToComponent.clear();
        this._componentToActor.clear();
        this._activeContactPairs.clear();
        this._activeTriggerPairs.clear();
        this._physicsWorld[Symbol.dispose]();
    }

    // -----------------------------------------------------------------------
    // Private — component discovery
    // -----------------------------------------------------------------------

    private _initializeNewComponents(): void {
        const actors = this._ecsWorld.getAllActors();

        for (const actor of actors) {
            if (!actor.active || actor.isDestroyed) continue;

            // --- Rigidbody ---
            const rigidbody = actor.getComponent(Rigidbody3D);
            if (rigidbody && !this._initializedBodies.has(rigidbody)) {
                rigidbody.initialize(this._physicsWorld);
                this._initializedBodies.add(rigidbody);
                this._bodyIdToComponent.set(rigidbody.bodyId, rigidbody);
                this._componentToActor.set(
                    rigidbody,
                    actor as unknown as AnyActor,
                );
            }

            // --- Colliders ---
            const colliders = this._getCollidersFromActor(actor);
            for (const collider of colliders) {
                if (this._initializedColliders.has(collider)) continue;
                collider.initialize(
                    this._physicsWorld,
                    rigidbody ?? undefined,
                );
                this._initializedColliders.add(collider);
            }

            // --- Joints ---
            const joints = this._getJointsFromActor(actor);
            for (const joint of joints) {
                if (this._initializedJoints.has(joint)) continue;
                if (!rigidbody) continue;

                const connectedBody = this._resolveConnectedBody(joint);
                joint.initialize(
                    this._physicsWorld,
                    rigidbody,
                    connectedBody ?? undefined,
                );
                this._initializedJoints.add(joint);
            }

            // --- Character Controller ---
            const characterController =
                actor.getComponent(CharacterController);
            if (
                characterController &&
                !this._initializedCharacterControllers.has(characterController)
            ) {
                characterController.initialize(this._physicsWorld);
                this._initializedCharacterControllers.add(
                    characterController,
                );
            }
        }
    }

    private _getCollidersFromActor(
        actor: ReturnType<AnyWorld['getAllActors']>[number],
    ): Collider3D[] {
        const result: Collider3D[] = [];
        for (const component of actor.getAllComponents()) {
            if (component instanceof Collider3D) {
                result.push(component);
            }
        }
        return result;
    }

    private _getJointsFromActor(
        actor: ReturnType<AnyWorld['getAllActors']>[number],
    ): Joint3D[] {
        const result: Joint3D[] = [];
        for (const component of actor.getAllComponents()) {
            if (component instanceof Joint3D) {
                result.push(component);
            }
        }
        return result;
    }

    private _resolveConnectedBody(joint: Joint3D): Rigidbody3D | null {
        const connectedBody = joint.connectedBody;
        if (connectedBody && this._initializedBodies.has(connectedBody)) {
            return connectedBody;
        }
        return null;
    }

    // -----------------------------------------------------------------------
    // Private — transform sync
    // -----------------------------------------------------------------------

    /**
     * Iterate tracked bodies instead of scanning every actor: every
     * initialized rigidbody is registered in _componentToActor, so this
     * is O(bodies) rather than O(actors x components) per fixed step.
     * Entries whose actor died are pruned — the strong maps would
     * otherwise retain destroyed bodies until bridge disposal.
     */
    private _syncAllTransforms(): void {
        for (const [rigidbody, actor] of this._componentToActor) {
            if (actor.isDestroyed) {
                this._componentToActor.delete(rigidbody);
                this._bodyIdToComponent.delete(rigidbody.bodyId);
                continue;
            }
            if (!actor.active) continue;
            if (this._initializedBodies.has(rigidbody)) {
                rigidbody.syncTransformFromWorld();
            }
        }
    }

    // -----------------------------------------------------------------------
    // Private — event dispatch
    // -----------------------------------------------------------------------

    private _dispatchCollisionEvent(
        self: Rigidbody3D,
        other: Rigidbody3D,
        event: CompatCollisionEvent,
        handler: 'onCollisionBegin' | 'onCollisionStay',
    ): void {
        const method =
            handler === 'onCollisionBegin' ? 'onCollisionEnter' : 'onCollisionStay';
        this._notifyActor(self, method, other, event);
        this._notifyActor(other, method, self, event);
    }

    private _dispatchCollisionEndEvent(
        self: Rigidbody3D,
        other: Rigidbody3D,
        event: CompatCollisionEvent,
    ): void {
        this._notifyActor(self, 'onCollisionExit', other, event);
        this._notifyActor(other, 'onCollisionExit', self, event);
    }

    private _dispatchSensorEvent(
        self: Rigidbody3D,
        other: Rigidbody3D,
        event: CompatSensorEvent,
        handler: 'onSensorEnter' | 'onSensorExit',
    ): void {
        this._notifySensorActor(self, handler, other, event);
        this._notifySensorActor(other, handler, self, event);
    }

    private _notifyActor(
        rigidbody: Rigidbody3D,
        method: 'onCollisionEnter' | 'onCollisionStay' | 'onCollisionExit',
        other: Rigidbody3D,
        event: CompatCollisionEvent,
    ): void {
        const actor = this._componentToActor.get(rigidbody);
        if (!actor) return;

        for (const component of actor.getAllComponents()) {
            const handler = component as unknown as IPhysicsCollisionHandler;
            const fn = handler[method];
            if (typeof fn === 'function') {
                fn.call(component, other, event);
            }
        }
    }

    private _notifySensorActor(
        rigidbody: Rigidbody3D,
        method: 'onSensorEnter' | 'onSensorExit',
        other: Rigidbody3D,
        event: CompatSensorEvent,
    ): void {
        const actor = this._componentToActor.get(rigidbody);
        if (!actor) return;

        for (const component of actor.getAllComponents()) {
            const handler = component as unknown as IPhysicsCollisionHandler;
            const fn = handler[method];
            if (typeof fn === 'function') {
                fn.call(component, other, event);
            }
        }
    }
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create a WASM-backed 3D physics bridge and its game-loop system wrapper.
 *
 * This is the WASM equivalent of `createPhysicsBridge3DSystems` from
 * scene-runtime. The factory is async because the WASM module must be
 * loaded and instantiated before the physics world can be created.
 *
 * Returns `{ bridge, system }` where:
 * - `bridge` is the `WasmPhysicsBridge3D` instance (exposes `physicsWorld`)
 * - `system` is a `GameLoopSystem<SceneLoopState>` suitable for registration
 *   with the game loop
 *
 * Usage:
 * ```ts
 * const { bridge, system } = await createWasmPhysicsBridge3DSystems(ecsWorld, {
 *     worldConfig: { gravity: { y: -9.81 } },
 *     velocityIterations: 10,
 *     positionIterations: 4,
 * });
 * ```
 */
export async function createWasmPhysicsBridge3DSystems(
    ecsWorld: AnyWorld,
    options?: WasmPhysicsBridge3DOptions,
): Promise<{ bridge: WasmPhysicsBridge3D; system: GameLoopSystem<SceneLoopState> }> {
    const bridge = await WasmPhysicsBridge3D.create(ecsWorld, options);
    return {
        bridge,
        system: {
            id: bridge.id,
            beforeUpdate: (ctx) => bridge.beforeUpdate(ctx),
            fixedUpdate: (ctx) => bridge.fixedUpdate(ctx),
            dispose: () => bridge.dispose(),
        },
    };
}
