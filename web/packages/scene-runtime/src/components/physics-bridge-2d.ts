import type { GameLoopSystem, BeforeUpdateContext } from '@axrone/game-loop';
import type { World, Actor } from '@axrone/ecs-runtime';
import type { SceneLoopState } from '../types';
import {
    PhysicsWorld2D,
    Rigidbody2D,
    Collider2D,
    _setPhysicsWorld2DBridgeProvider,
} from '@axrone/physics-2d';
import type {
    IContactListener2D,
    ICollisionEvent2D,
    ISensorEvent2D,
    IPhysicsWorldConfig,
} from '@axrone/physics-core';
import type { BodyId } from '@axrone/physics-core';
import { makeCollisionPairKey } from '@axrone/physics-core';
import type { IPhysicsCollisionHandler } from './physics-bridge-3d';

type AnyWorld = World<any>;
type AnyActor = Actor<AnyWorld>;

/**
 * Type alias for 2D physics collision handler used by user @script components.
 */
export type IPhysicsCollisionHandler2D = IPhysicsCollisionHandler<
    Rigidbody2D,
    ICollisionEvent2D,
    ISensorEvent2D
>;

interface ContactPair2D {
    readonly bodyIdA: BodyId;
    readonly bodyIdB: BodyId;
}

function makePairKey2D(a: BodyId, b: BodyId): number {
    return makeCollisionPairKey(Number(a), Number(b));
}

const MILLISECONDS_PER_SECOND = 1000;

class LoopMillisecondsPhysicsWorld2D extends PhysicsWorld2D {
    override step(
        deltaTimeMs: number,
        velocityIterations?: number,
        positionIterations?: number
    ): void {
        super.step(
            deltaTimeMs / MILLISECONDS_PER_SECOND,
            velocityIterations,
            positionIterations
        );
    }
}

export interface PhysicsBridge2DOptions {
    readonly worldConfig?: IPhysicsWorldConfig;
    readonly velocityIterations?: number;
    readonly positionIterations?: number;
}

/**
 * Bridge between the 2D physics engine and the scene-runtime game loop.
 *
 * Unlike the 3D bridge, this bridge does NOT create bodies/shapes or sync
 * transforms — Rigidbody2D/Collider2D are self-managing (they create their
 * own bodies in start() and sync in fixedUpdate()). The bridge's role is:
 *   1. Own the PhysicsWorld2D instance and expose it to components
 *   2. Set the contact listener so collision/sensor events reach user scripts
 *   3. Track body→component→actor mappings for event dispatch
 *   4. Track active contact/trigger pairs for begin/stay/exit semantics
 */
export class PhysicsBridge2D implements GameLoopSystem<SceneLoopState>, IContactListener2D {
    readonly id = 'scene.physics-bridge-2d';

    private readonly _ecsWorld: World<any>;
    private readonly _physicsWorld: PhysicsWorld2D;
    private readonly _velocityIterations: number;
    private readonly _positionIterations: number;

    private readonly _registeredBodies = new WeakSet<Rigidbody2D>();
    private readonly _registeredColliders = new WeakSet<Collider2D>();
    private readonly _bodyIdToComponent = new Map<BodyId, Rigidbody2D>();
    private readonly _componentToActor = new Map<Rigidbody2D, AnyActor>();
    private readonly _activeContactPairs = new Set<number>();
    private readonly _activeTriggerPairs = new Set<number>();

    private _disposed = false;

    constructor(ecsWorld: World<any>, options: PhysicsBridge2DOptions = {}) {
        this._ecsWorld = ecsWorld;

        const gravity = options.worldConfig?.gravity;
        const config: IPhysicsWorldConfig = {
            ...options.worldConfig,
            gravity: gravity
                ? { x: Number((gravity as any).x ?? 0), y: Number((gravity as any).y ?? -9.81) }
                : { x: 0, y: -9.81 },
        };

        this._physicsWorld = new LoopMillisecondsPhysicsWorld2D(config);
        this._velocityIterations = options.velocityIterations ?? 8;
        this._positionIterations = options.positionIterations ?? 3;
        this._physicsWorld.setContactListener(this);

        // Register this bridge as the world provider so PhysicsWorld2DComponent
        // reuses our world instead of creating a second instance.
        _setPhysicsWorld2DBridgeProvider(() => this._disposed ? null : this._physicsWorld);
        // Also register directly on Rigidbody2D for cases where the component
        // singleton is not available (tests, non-ECS harnesses).
        Rigidbody2D._setBridgeWorldProvider(() => this._disposed ? null : this._physicsWorld);
    }

    get physicsWorld(): PhysicsWorld2D {
        return this._physicsWorld;
    }

    get isDisposed(): boolean {
        return this._disposed;
    }

    beforeUpdate(_context: BeforeUpdateContext<SceneLoopState>): void {
        if (this._disposed) return;
        this._registerNewComponents();
    }

    /**
     * Public registration trigger. Call this after creating bodies/shapes externally
     * (e.g. in tests or non-ECS harnesses) to ensure the bridge discovers them
     * before the next physics step.
     */
    registerNewComponents(): void {
        if (this._disposed) return;
        this._registerNewComponents();
    }

    fixedUpdate(_context: { fixedDelta: number }): void {
        // In self-manage pattern, Rigidbody2D.fixedUpdate() handles step() and sync.
        // The bridge does NOT step the world — PhysicsWorld2DComponent.fixedUpdate() does.
        // This bridge only handles event routing.
    }

    // ── IContactListener2D ────────────────────────────────────────────────
    // The 2D contact manager now dispatches sensor events natively
    // (onSensorEnter/Stay/Exit) — same as the 3D engine. The bridge
    // simply routes them to user @script handlers.

    onCollisionBegin(event: ICollisionEvent2D): void {
        const bodyIdA = event.bodyIdA;
        const bodyIdB = event.bodyIdB;
        const key = makePairKey2D(bodyIdA, bodyIdB);

        const componentA = this._bodyIdToComponent.get(bodyIdA);
        const componentB = this._bodyIdToComponent.get(bodyIdB);
        if (!componentA || !componentB) return;

        this._activeContactPairs.add(key);
        this._dispatchCollisionEvent(componentA, componentB, event, 'onCollisionBegin');
    }

    onCollisionStay(event: ICollisionEvent2D): void {
        const bodyIdA = event.bodyIdA;
        const bodyIdB = event.bodyIdB;

        const componentA = this._bodyIdToComponent.get(bodyIdA);
        const componentB = this._bodyIdToComponent.get(bodyIdB);
        if (!componentA || !componentB) return;

        this._dispatchCollisionEvent(componentA, componentB, event, 'onCollisionStay');
    }

    onCollisionEnd(event: ICollisionEvent2D): void {
        const bodyIdA = event.bodyIdA;
        const bodyIdB = event.bodyIdB;
        const key = makePairKey2D(bodyIdA, bodyIdB);

        const componentA = this._bodyIdToComponent.get(bodyIdA);
        const componentB = this._bodyIdToComponent.get(bodyIdB);
        if (!componentA || !componentB) return;

        this._activeContactPairs.delete(key);
        this._dispatchCollisionEndEvent(componentA, componentB, event);
    }

    onSensorEnter(event: ISensorEvent2D): void {
        const bodyIdA = event.sensorBodyId;
        const bodyIdB = event.visitorBodyId;
        const key = makePairKey2D(bodyIdA, bodyIdB);
        this._activeTriggerPairs.add(key);

        const componentA = this._bodyIdToComponent.get(bodyIdA);
        const componentB = this._bodyIdToComponent.get(bodyIdB);
        if (componentA && componentB) {
            this._dispatchSensorEvent(componentA, componentB, event, 'onSensorEnter');
        }
    }

    onSensorStay(event: ISensorEvent2D): void {
        const bodyIdA = event.sensorBodyId;
        const bodyIdB = event.visitorBodyId;

        const componentA = this._bodyIdToComponent.get(bodyIdA);
        const componentB = this._bodyIdToComponent.get(bodyIdB);
        if (componentA && componentB) {
            this._dispatchSensorStayEvent(componentA, componentB, event);
        }
    }

    onSensorExit(event: ISensorEvent2D): void {
        const bodyIdA = event.sensorBodyId;
        const bodyIdB = event.visitorBodyId;
        const key = makePairKey2D(bodyIdA, bodyIdB);
        this._activeTriggerPairs.delete(key);

        const componentA = this._bodyIdToComponent.get(bodyIdA);
        const componentB = this._bodyIdToComponent.get(bodyIdB);
        if (componentA && componentB) {
            this._dispatchSensorEvent(componentA, componentB, event, 'onSensorExit');
        }
    }

    dispose(): void {
        if (this._disposed) return;
        this._disposed = true;

        _setPhysicsWorld2DBridgeProvider(null);
        Rigidbody2D._setBridgeWorldProvider(null);
        this._physicsWorld.setContactListener(null);
        this._bodyIdToComponent.clear();
        this._componentToActor.clear();
        this._activeContactPairs.clear();
        this._activeTriggerPairs.clear();
        this._physicsWorld[Symbol.dispose]();
    }

    // ── Internal ──────────────────────────────────────────────────────────

    private _registerNewComponents(): void {
        // Drop entries whose actor died — the strong maps would otherwise
        // retain destroyed bodies until bridge disposal.
        for (const [rigidbody, actor] of this._componentToActor) {
            if (actor.isDestroyed) {
                this._componentToActor.delete(rigidbody);
                if (rigidbody.bodyId != null) {
                    this._bodyIdToComponent.delete(rigidbody.bodyId);
                }
            }
        }

        const actors = this._ecsWorld.getAllActors();

        for (const actor of actors) {
            if (!actor.active || actor.isDestroyed) continue;

            const rigidbody = actor.getComponent(Rigidbody2D);
            if (rigidbody && rigidbody.bodyId != null && !this._registeredBodies.has(rigidbody)) {
                this._registeredBodies.add(rigidbody);
                this._bodyIdToComponent.set(rigidbody.bodyId, rigidbody);
                this._componentToActor.set(rigidbody, actor as unknown as AnyActor);
            }

            // Colliders are tracked for completeness but event dispatch
            // goes through the actor's component list (same as 3D bridge).
            for (const component of actor.getAllComponents()) {
                if (component instanceof Collider2D && !this._registeredColliders.has(component)) {
                    this._registeredColliders.add(component);
                }
            }
        }
    }

    private _dispatchCollisionEvent(
        self: Rigidbody2D,
        other: Rigidbody2D,
        event: ICollisionEvent2D,
        handler: 'onCollisionBegin' | 'onCollisionStay'
    ): void {
        const method = handler === 'onCollisionBegin' ? 'onCollisionEnter' : 'onCollisionStay';
        this._notifyActor(self, method, other, event);
        this._notifyActor(other, method, self, event);
    }

    private _dispatchCollisionEndEvent(
        self: Rigidbody2D,
        other: Rigidbody2D,
        event: ICollisionEvent2D
    ): void {
        this._notifyActor(self, 'onCollisionExit', other, event);
        this._notifyActor(other, 'onCollisionExit', self, event);
    }

    private _dispatchSensorEvent(
        self: Rigidbody2D,
        other: Rigidbody2D,
        event: ISensorEvent2D,
        handler: 'onSensorEnter' | 'onSensorExit'
    ): void {
        this._notifySensorActor(self, handler, other, event);
        this._notifySensorActor(other, handler, self, event);
    }

    private _dispatchSensorStayEvent(
        self: Rigidbody2D,
        other: Rigidbody2D,
        event: ISensorEvent2D
    ): void {
        this._notifySensorActor(self, 'onSensorStay', other, event);
        this._notifySensorActor(other, 'onSensorStay', self, event);
    }

    private _notifyActor(
        rigidbody: Rigidbody2D,
        method: 'onCollisionEnter' | 'onCollisionStay' | 'onCollisionExit',
        other: Rigidbody2D,
        event: ICollisionEvent2D
    ): void {
        const actor = this._componentToActor.get(rigidbody);
        if (!actor) return;

        for (const component of actor.getAllComponents()) {
            const handler = component as unknown as IPhysicsCollisionHandler2D;
            const fn = handler[method];
            if (typeof fn === 'function') {
                fn.call(component, other, event);
            }
        }
    }

    private _notifySensorActor(
        rigidbody: Rigidbody2D,
        method: 'onSensorEnter' | 'onSensorStay' | 'onSensorExit',
        other: Rigidbody2D,
        event: ISensorEvent2D
    ): void {
        const actor = this._componentToActor.get(rigidbody);
        if (!actor) return;

        for (const component of actor.getAllComponents()) {
            const handler = component as unknown as IPhysicsCollisionHandler2D;
            const fn = handler[method];
            if (typeof fn === 'function') {
                fn.call(component, other, event);
            }
        }
    }
}

export function createPhysicsBridge2DSystems(
    ecsWorld: AnyWorld,
    options?: PhysicsBridge2DOptions
): { bridge: PhysicsBridge2D; system: GameLoopSystem<SceneLoopState> } {
    const bridge = new PhysicsBridge2D(ecsWorld, options);
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
