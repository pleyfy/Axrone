import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createGameLoop } from '@axrone/game-loop';
import { ManualScheduler } from '../../../../tests/shared/test-harness';
import { PhysicsBridge3D } from '../components/physics-bridge-3d';
import type { IPhysicsCollisionHandler } from '../components/physics-bridge-3d';
import type { SceneLoopState } from '../types';
import {
    Rigidbody3D,
    Collider3D,
    SphereCollider3D,
    BoxCollider3D,
} from '@axrone/physics-3d';
import type { ICollisionEvent3D, ISensorEvent3D } from '@axrone/physics-core';

// ─── Mock Transform ──────────────────────────────────────────────────────────
// Minimal transform that satisfies syncTransformWorldPose requirements:
// position/rotation setters, worldPosition/worldRotation/worldScale getters, parent=null.
interface MockTransformData {
    position: { x: number; y: number; z: number };
    rotation: { x: number; y: number; z: number; w: number };
    worldPosition: { x: number; y: number; z: number };
    worldRotation: { x: number; y: number; z: number; w: number };
    worldScale: { x: number; y: number; z: number };
    parent: null;
}

function createMockTransform(
    pos = { x: 0, y: 0, z: 0 },
    rot = { x: 0, y: 0, z: 0, w: 1 }
): MockTransformData {
    const t: MockTransformData = {
        position: { ...pos },
        rotation: { ...rot },
        worldPosition: { ...pos },
        worldRotation: { ...rot },
        worldScale: { x: 1, y: 1, z: 1 },
        parent: null,
    };
    // Keep worldPosition/worldRotation in sync with position/rotation (no parent).
    return new Proxy(t, {
        set(target, prop, value) {
            (target as any)[prop] = value;
            if (prop === 'position') target.worldPosition = { ...value };
            if (prop === 'rotation') target.worldRotation = { ...value };
            return true;
        },
    });
}

// ─── Mock Entity ──────────────────────────────────────────────────────────────
// Satisfies the bridge's usage: active, isDestroyed, getComponent(Ctor), getAllComponents().
class MockEntity {
    active = true;
    isDestroyed = false;
    private _components: any[] = [];

    addComponent(c: any): this {
        this._components.push(c);
        // Wire the component's entity reference so Component.transform lookup can work
        // (though we override transform directly for reliability).
        if ('entity' in c) (c as any).entity = this;
        return this;
    }

    getComponent<T>(Ctor: new (...args: any[]) => T): T | undefined {
        return this._components.find((c) => c instanceof Ctor) as T | undefined;
    }

    getAllComponents(): any[] {
        return [...this._components];
    }
}

// ─── Mock ECS World ──────────────────────────────────────────────────────────
class MockEcsWorld {
    private _entities: MockEntity[] = [];
    addEntity(a: MockEntity): void {
        this._entities.push(a);
    }
    getAllEntities(): MockEntity[] {
        return [...this._entities];
    }
}

// ─── Collision Handler Component ─────────────────────────────────────────────
// Not a full ECS Component — just a plain class implementing IPhysicsCollisionHandler.
// The bridge iterates entity.getAllComponents() and checks for handler methods via typeof.
class CollisionHandler implements IPhysicsCollisionHandler {
    collisionEnters: { other: Rigidbody3D; event: any }[] = [];
    collisionStays: { other: Rigidbody3D; event: any }[] = [];
    collisionExits: { other: Rigidbody3D; event: any }[] = [];
    sensorEnters: { other: Rigidbody3D; event: any }[] = [];
    sensorExits: { other: Rigidbody3D; event: any }[] = [];

    onCollisionEnter(other: Rigidbody3D, event: ICollisionEvent3D): void {
        this.collisionEnters.push({ other, event });
    }
    onCollisionStay(other: Rigidbody3D, event: ICollisionEvent3D): void {
        this.collisionStays.push({ other, event });
    }
    onCollisionExit(other: Rigidbody3D, event: ICollisionEvent3D): void {
        this.collisionExits.push({ other, event });
    }
    onSensorEnter(other: Rigidbody3D, event: ISensorEvent3D): void {
        this.sensorEnters.push({ other, event });
    }
    onSensorExit(other: Rigidbody3D, event: ISensorEvent3D): void {
        this.sensorExits.push({ other, event });
    }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────
const ENGINE_FIXED_DELTA_MS = 1000 / 60;
const GRAVITY = -9.81;

/** Wire a mock transform onto a Rigidbody3D so Component.transform returns it. */
function attachTransform(rb: Rigidbody3D, transform: MockTransformData): void {
    Object.defineProperty(rb, 'transform', {
        get: () => transform,
        configurable: true,
    });
}

/** Create a bridge + ecs world + helper to add physics entities. */
function createHarness(gravity = { x: 0, y: GRAVITY, z: 0 }) {
    const ecsWorld = new MockEcsWorld();
    const bridge = new PhysicsBridge3D(ecsWorld as any, {
        worldConfig: { gravity },
    });
    const scheduler = new ManualScheduler();
    let timestamp = 0;
    const loop = createGameLoop<SceneLoopState>({
        state: { sceneId: 'physics-bridge-3d-integration' },
        scheduler: scheduler as never,
        autoStart: false,
        systems: [
            {
                id: bridge.id,
                beforeUpdate: (context) => bridge.beforeUpdate(context),
                fixedUpdate: (context) => bridge.fixedUpdate(context),
                dispose: () => bridge.dispose(),
            },
        ],
    });
    loop.start(0);

    function addEntity(
        transform: MockTransformData,
        opts: {
            mass?: number;
            isStatic?: boolean;
            collider?: 'sphere' | 'box';
            sphereRadius?: number;
            boxSize?: { x: number; y: number; z: number };
            isTrigger?: boolean;
            handler?: CollisionHandler;
        } = {}
    ): { entity: MockEntity; rb: Rigidbody3D; collider?: SphereCollider3D | BoxCollider3D } {
        const entity = new MockEntity();
        const rb = new Rigidbody3D();
        attachTransform(rb, transform);
        entity.addComponent(rb);

        if (opts.collider === 'sphere' || opts.collider === undefined) {
            const col = new SphereCollider3D();
            col.radius = opts.sphereRadius ?? 0.5;
            if (opts.isTrigger) col.isTrigger = true;
            entity.addComponent(col);
            if (opts.handler) entity.addComponent(opts.handler);
            ecsWorld.addEntity(entity);
            return { entity, rb, collider: col };
        } else {
            const col = new BoxCollider3D();
            if (opts.boxSize) col.size = opts.boxSize;
            if (opts.isTrigger) col.isTrigger = true;
            entity.addComponent(col);
            if (opts.handler) entity.addComponent(opts.handler);
            ecsWorld.addEntity(entity);
            return { entity, rb, collider: col };
        }
    }

    function step(n = 1): void {
        for (let i = 0; i < n; i++) {
            timestamp += ENGINE_FIXED_DELTA_MS;
            scheduler.flush(timestamp);
        }
    }

    return { ecsWorld, bridge, loop, addEntity, step };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('PhysicsBridge3D integration', () => {
    // ── 1. Body/shape creation ───────────────────────────────────────────────
    describe('1. body and shape creation via bridge', () => {
        it('creates physics bodies and shapes when new components are discovered', () => {
            const { bridge, loop, addEntity, step } = createHarness();

            const t1 = createMockTransform({ x: 0, y: 5, z: 0 });
            const { rb: rb1 } = addEntity(t1, { mass: 1, collider: 'sphere', sphereRadius: 0.5 });

            const t2 = createMockTransform({ x: 0, y: 0, z: 0 });
            const { rb: rb2 } = addEntity(t2, {
                mass: 1,
                isStatic: true,
                collider: 'box',
                boxSize: { x: 50, y: 1, z: 50 },
            });

            const bm = bridge.physicsWorld.getBodyManager();
            const sm = bridge.physicsWorld.getShapeManager();

            // Before initialization: no bodies
            expect(bm.bodyCount).toBe(0);
            expect(sm.shapeCount).toBe(0);

            // Trigger bridge initialization
            step(1);

            // After initialization: 2 bodies, 2 shapes
            expect(bm.bodyCount).toBe(2);
            expect(sm.shapeCount).toBe(2);

            // Body IDs should be valid (>= 0)
            expect(rb1.bodyId).toBeGreaterThanOrEqual(0);
            expect(rb2.bodyId).toBeGreaterThanOrEqual(0);
            expect(rb1.bodyId).not.toBe(rb2.bodyId);

            loop.dispose();
        });

        it('does not duplicate bodies on subsequent steps', () => {
            const { bridge, loop, addEntity, step } = createHarness();

            const t = createMockTransform({ x: 0, y: 5, z: 0 });
            addEntity(t, { mass: 1, collider: 'sphere' });

            step(1);
            expect(bridge.physicsWorld.getBodyManager().bodyCount).toBe(1);

            step(5);
            // Still 1 body — WeakSet prevents re-initialization
            expect(bridge.physicsWorld.getBodyManager().bodyCount).toBe(1);

            loop.dispose();
        });
    });

    // ── 2. Transform synchronization ─────────────────────────────────────────
    describe('2. transform sync from physics to entity', () => {
        it('syncs gravity-driven position back to entity transform after fixedUpdate', () => {
            const { bridge, loop, addEntity, step } = createHarness();

            const transform = createMockTransform({ x: 0, y: 10, z: 0 });
            const { rb } = addEntity(transform, { mass: 1, collider: 'sphere', sphereRadius: 0.5 });

            // Initialize
            step(1);

            // After first step, gravity already moved body slightly from y=10.
            // Record actual position as baseline.
            const yBefore = transform.worldPosition.y;
            expect(yBefore).toBeLessThan(10); // gravity pulled it down
            expect(yBefore).toBeGreaterThan(9.5); // only one step, tiny displacement

            // Step 30 frames (0.5 second of free fall)
            step(30);

            // Transform should reflect physics position (body fell under gravity)
            const yAfter = transform.worldPosition.y;
            expect(yAfter).toBeLessThan(yBefore);

            // Expected: y ≈ 10 - 0.5 * 9.81 * (30/60)^2 ≈ 10 - 0.5*9.81*0.25 ≈ 8.77
            // Allow tolerance for solver effects
            expect(yAfter).toBeGreaterThan(7.5);
            expect(yAfter).toBeLessThan(9.8);

            // Velocity should be downward
            const vel = rb.velocity;
            expect(vel.y).toBeLessThan(-1);

            loop.dispose();
        });

        it('does NOT sync when body is static', () => {
            const { bridge, loop, addEntity, step } = createHarness();

            const transform = createMockTransform({ x: 0, y: 0, z: 0 });
            const { rb } = addEntity(transform, {
                mass: 1,
                isStatic: true,
                collider: 'box',
                boxSize: { x: 10, y: 1, z: 10 },
            });

            step(1);
            // Set static body type after creation
            rb.bodyType = 0 as any; // Static

            const posBefore = { ...transform.worldPosition };
            step(60);

            // Static body should not move
            expect(transform.worldPosition.x).toBe(posBefore.x);
            expect(transform.worldPosition.y).toBe(posBefore.y);
            expect(transform.worldPosition.z).toBe(posBefore.z);

            loop.dispose();
        });
    });

    // ── 3. Contact event flow ────────────────────────────────────────────────
    describe('3. contact event flow through bridge', () => {
        it('fires onCollisionEnter on user handler when two bodies make contact', () => {
            const { bridge, loop, addEntity, step } = createHarness();

            const handlerA = new CollisionHandler();
            const handlerB = new CollisionHandler();

            // Ground: static box, top surface at y=0.5 (halfExtents.y = 0.5)
            const tGround = createMockTransform({ x: 0, y: 0, z: 0 });
            const { rb: groundRb } = addEntity(tGround, {
                isStatic: true,
                collider: 'box',
                boxSize: { x: 50, y: 1, z: 50 },
                handler: handlerB,
            });

            // Ball: dynamic sphere, starts at y=3 (well above ground)
            const tBall = createMockTransform({ x: 0, y: 3, z: 0 });
            const { rb: ballRb } = addEntity(tBall, {
                mass: 1,
                collider: 'sphere',
                sphereRadius: 0.5,
                handler: handlerA,
            });

            // Initialize + set ground to static
            step(1);
            groundRb.bodyType = 0 as any;

            // Step enough for ball to reach ground
            step(120);

            // NEGATIVE CHECK: ball should have actually reached the ground
            expect(tBall.worldPosition.y).toBeLessThan(3);
            expect(tBall.worldPosition.y).toBeLessThan(1.5); // near ground surface

            // Contact event should have fired on both handlers
            // NOTE: Bridge onCollisionBegin receives manifold from contact runtime,
            // which has bodyIdA/bodyIdB — so Begin/Stay dispatch works.
            expect(handlerA.collisionEnters.length).toBeGreaterThanOrEqual(1);
            expect(handlerB.collisionEnters.length).toBeGreaterThanOrEqual(1);

            // The 'other' rigidbody should be the opposite body
            expect(handlerA.collisionEnters[0].other).toBe(groundRb);
            expect(handlerB.collisionEnters[0].other).toBe(ballRb);

            loop.dispose();
        });

        it('does NOT fire collision events when bodies are too far apart', () => {
            const { bridge, loop, addEntity, step } = createHarness();

            const handlerA = new CollisionHandler();
            const handlerB = new CollisionHandler();

            const tA = createMockTransform({ x: 0, y: 100, z: 0 });
            addEntity(tA, { mass: 1, collider: 'sphere', sphereRadius: 0.5, handler: handlerA });

            const tB = createMockTransform({ x: 0, y: -100, z: 0 });
            addEntity(tB, {
                mass: 1,
                isStatic: true,
                collider: 'sphere',
                sphereRadius: 0.5,
                handler: handlerB,
            });

            step(60);

            // Bodies are 200 units apart — no contact possible in 60 frames of free fall
            expect(handlerA.collisionEnters.length).toBe(0);
            expect(handlerB.collisionEnters.length).toBe(0);

            loop.dispose();
        });
    });

    // ── 4. Sensor/trigger ────────────────────────────────────────────────────
    describe('4. sensor/trigger events and no physical response', () => {
        it('fires sensor events without deflecting the visitor body', () => {
            const { bridge, loop, addEntity, step } = createHarness({ gravity: { x: 0, y: 0, z: 0 } });

            const handlerVisitor = new CollisionHandler();
            const handlerSensor = new CollisionHandler();

            // Visitor: dynamic sphere moving in +x direction
            const tVisitor = createMockTransform({ x: -5, y: 0, z: 0 });
            const { rb: visitorRb } = addEntity(tVisitor, {
                mass: 1,
                collider: 'sphere',
                sphereRadius: 0.5,
                handler: handlerVisitor,
            });

            // Sensor: static trigger sphere at origin
            const tSensor = createMockTransform({ x: 0, y: 0, z: 0 });
            const { rb: sensorRb } = addEntity(tSensor, {
                isStatic: true,
                collider: 'sphere',
                sphereRadius: 2,
                isTrigger: true,
                handler: handlerSensor,
            });

            // Initialize
            step(1);
            sensorRb.bodyType = 0 as any; // Static

            // Set visitor velocity via body manager
            bridge.physicsWorld
                .getBodyManager()
                .setLinearVelocity(visitorRb.bodyId, { x: 10, y: 0, z: 0 });

            // Step until visitor passes through sensor zone
            step(60);

            // Visitor should have passed through (no physical deflection)
            expect(tVisitor.worldPosition.x).toBeGreaterThan(0);

            // Velocity x should remain ~10 (no deflection from trigger)
            const vel = visitorRb.velocity;
            expect(Math.abs(vel.x - 10)).toBeLessThan(2);

            // Sensor events MUST reach user handlers (canonical IContactListener3D contract)
            expect(handlerSensor.sensorEnters.length).toBeGreaterThanOrEqual(1);
            expect(handlerVisitor.sensorEnters.length).toBeGreaterThanOrEqual(1);

            // The 'other' rigidbody should be the opposite body
            expect(handlerSensor.sensorEnters[0].other).toBe(visitorRb);
            expect(handlerVisitor.sensorEnters[0].other).toBe(sensorRb);

            // Event must carry canonical ISensorEvent3D fields
            const sensorEvent = handlerSensor.sensorEnters[0].event as ISensorEvent3D;
            expect(sensorEvent.sensorBodyId).toBeDefined();
            expect(sensorEvent.visitorBodyId).toBeDefined();

            loop.dispose();
        });

        it('negative control: normal collider DOES produce physical response', () => {
            const { bridge, loop, addEntity, step } = createHarness({ gravity: { x: 0, y: 0, z: 0 } });

            // Same setup but WITHOUT trigger — should deflect
            const tVisitor = createMockTransform({ x: -5, y: 0, z: 0 });
            const { rb: visitorRb } = addEntity(tVisitor, {
                mass: 1,
                collider: 'sphere',
                sphereRadius: 0.5,
            });

            const tWall = createMockTransform({ x: 0, y: 0, z: 0 });
            const { rb: wallRb } = addEntity(tWall, {
                isStatic: true,
                collider: 'sphere',
                sphereRadius: 2,
                // NOT a trigger
            });

            step(1);
            wallRb.bodyType = 0 as any;

            bridge.physicsWorld
                .getBodyManager()
                .setLinearVelocity(visitorRb.bodyId, { x: 10, y: 0, z: 0 });

            step(60);

            // With a normal collider, visitor should be deflected (x velocity changes)
            // or stopped. It should NOT pass through at full speed.
            const vel = visitorRb.velocity;
            // Either bounced back or slowed significantly
            expect(vel.x).toBeLessThan(8);

            loop.dispose();
        });

        it('fires onSensorExit when visitor leaves sensor zone', () => {
            const { bridge, loop, addEntity, step } = createHarness({ gravity: { x: 0, y: 0, z: 0 } });

            const handlerVisitor = new CollisionHandler();
            const handlerSensor = new CollisionHandler();

            // Visitor: dynamic sphere moving in +x direction
            const tVisitor = createMockTransform({ x: -5, y: 0, z: 0 });
            const { rb: visitorRb } = addEntity(tVisitor, {
                mass: 1,
                collider: 'sphere',
                sphereRadius: 0.5,
                handler: handlerVisitor,
            });

            // Sensor: static trigger sphere at origin
            const tSensor = createMockTransform({ x: 0, y: 0, z: 0 });
            const { rb: sensorRb } = addEntity(tSensor, {
                isStatic: true,
                collider: 'sphere',
                sphereRadius: 2,
                isTrigger: true,
                handler: handlerSensor,
            });

            step(1);
            sensorRb.bodyType = 0 as any;

            // Move visitor through sensor quickly
            bridge.physicsWorld
                .getBodyManager()
                .setLinearVelocity(visitorRb.bodyId, { x: 50, y: 0, z: 0 });

            // Step until visitor exits sensor zone
            step(60);

            // Sensor exit events MUST reach user handlers
            expect(handlerSensor.sensorExits.length).toBeGreaterThanOrEqual(1);
            expect(handlerVisitor.sensorExits.length).toBeGreaterThanOrEqual(1);

            // Trigger pairs set must be cleaned up (no memory leak)
            const triggerPairs = (bridge as any)._activeTriggerPairs as Set<number>;
            expect(triggerPairs.size).toBe(0);

            loop.dispose();
        });
    });

    // ── 4b. Collision exit and memory leak ──────────────────────────────────
    describe('4b. collision exit events and memory leak prevention', () => {
        it('fires onCollisionExit when bodies separate', () => {
            const { bridge, loop, addEntity, step } = createHarness();

            const handlerA = new CollisionHandler();
            const handlerB = new CollisionHandler();

            // Ground: static box
            const tGround = createMockTransform({ x: 0, y: 0, z: 0 });
            const { rb: groundRb } = addEntity(tGround, {
                isStatic: true,
                collider: 'box',
                boxSize: { x: 50, y: 1, z: 50 },
                handler: handlerB,
            });

            // Ball: dynamic sphere
            const tBall = createMockTransform({ x: 0, y: 3, z: 0 });
            addEntity(tBall, {
                mass: 1,
                collider: 'sphere',
                sphereRadius: 0.5,
                handler: handlerA,
            });

            step(1);
            groundRb.bodyType = 0 as any;

            // Let ball fall and establish contact
            step(120);

            // Collision enter should have fired
            expect(handlerA.collisionEnters.length).toBeGreaterThanOrEqual(1);

            // Launch ball upward to break contact
            bridge.physicsWorld
                .getBodyManager()
                .setLinearVelocity(handlerA.collisionEnters[0].other.bodyId, { x: 0, y: 20, z: 0 });

            step(60);

            // Collision exit MUST fire when contact breaks
            expect(handlerA.collisionExits.length).toBeGreaterThanOrEqual(1);
            expect(handlerB.collisionExits.length).toBeGreaterThanOrEqual(1);

            // Active contact pairs must be cleaned up (no memory leak)
            const activePairs = (bridge as any)._activeContactPairs as Set<number>;
            expect(activePairs.size).toBe(0);

            loop.dispose();
        });

        it('activeContactPairs and activeTriggerPairs are empty after all contacts end', () => {
            const { bridge, loop, addEntity, step } = createHarness({ gravity: { x: 0, y: 0, z: 0 } });

            const handler = new CollisionHandler();

            // Two overlapping spheres
            const tA = createMockTransform({ x: 0, y: 0, z: 0 });
            addEntity(tA, { mass: 1, collider: 'sphere', sphereRadius: 1, handler });

            const tB = createMockTransform({ x: 1, y: 0, z: 0 });
            const { rb: rbB } = addEntity(tB, { mass: 1, collider: 'sphere', sphereRadius: 1 });

            step(1);

            // Contact pairs should be populated
            const activePairs = (bridge as any)._activeContactPairs as Set<number>;
            expect(activePairs.size).toBeGreaterThanOrEqual(1);

            // Separate bodies by moving one far away
            bridge.physicsWorld
                .getBodyManager()
                .setPosition(rbB.bodyId, { x: 100, y: 0, z: 0 });

            step(5);

            // After separation, active contact pairs must be cleared
            expect(activePairs.size).toBe(0);

            loop.dispose();
        });
    });

    // ── 5. Step order validation (P1-8) ──────────────────────────────────────
    describe('5. step order: contact detection before position integration', () => {
        it('overlapping bodies at spawn detect contact on the FIRST step', () => {
            const { bridge, loop, addEntity, step } = createHarness({ gravity: { x: 0, y: 0, z: 0 } });

            const handlerA = new CollisionHandler();
            const handlerB = new CollisionHandler();

            // Two spheres that OVERLAP at spawn (distance < sum of radii)
            const tA = createMockTransform({ x: 0, y: 0, z: 0 });
            addEntity(tA, { mass: 1, collider: 'sphere', sphereRadius: 1, handler: handlerA });

            const tB = createMockTransform({ x: 1, y: 0, z: 0 }); // distance=1, radii=1+1=2 → overlap
            addEntity(tB, { mass: 1, collider: 'sphere', sphereRadius: 1, handler: handlerB });

            // Single step
            step(1);

            // Contact should be detected on the very first step
            // (P1-8: contact detection is BEFORE position integration)
            expect(handlerA.collisionEnters.length).toBeGreaterThanOrEqual(1);
            expect(handlerB.collisionEnters.length).toBeGreaterThanOrEqual(1);

            loop.dispose();
        });

        it('separated bodies do NOT detect contact on the first step', () => {
            const { bridge, loop, addEntity, step } = createHarness({ gravity: { x: 0, y: 0, z: 0 } });

            const handlerA = new CollisionHandler();

            // Two spheres far apart (no overlap, no contact possible in one step)
            const tA = createMockTransform({ x: 0, y: 0, z: 0 });
            addEntity(tA, { mass: 1, collider: 'sphere', sphereRadius: 0.5, handler: handlerA });

            const tB = createMockTransform({ x: 100, y: 0, z: 0 }); // 100 units away
            addEntity(tB, { mass: 1, collider: 'sphere', sphereRadius: 0.5 });

            // Single step — bodies are 100 units apart, max displacement in one step ≈ velocity*dt
            // With zero initial velocity and no gravity, displacement = 0
            step(1);

            // No contact should be detected
            expect(handlerA.collisionEnters.length).toBe(0);

            loop.dispose();
        });

        it('separated bodies falling under gravity detect contact after multiple steps', () => {
            const { bridge, loop, addEntity, step } = createHarness();

            const handlerGround = new CollisionHandler();

            // Ground at y=0 (box halfExtents y=0.5, top at y=0.5)
            const tGround = createMockTransform({ x: 0, y: 0, z: 0 });
            const { rb: groundRb } = addEntity(tGround, {
                isStatic: true,
                collider: 'box',
                boxSize: { x: 50, y: 1, z: 50 },
                handler: handlerGround,
            });

            // Ball at y=3 (gap of 2 units above ground surface)
            const tBall = createMockTransform({ x: 0, y: 3, z: 0 });
            addEntity(tBall, { mass: 1, collider: 'sphere', sphereRadius: 0.5 });

            step(1);
            groundRb.bodyType = 0 as any;

            // After 1 step: ball has fallen ~0.003 units (0.5*g*dt^2) — still far from ground
            expect(tBall.worldPosition.y).toBeGreaterThan(2.9);
            expect(handlerGround.collisionEnters.length).toBe(0);

            // After many steps: ball reaches ground, contact fires
            step(120);
            expect(handlerGround.collisionEnters.length).toBeGreaterThanOrEqual(1);

            loop.dispose();
        });
    });

    // ── 6. Sleeping + transform sync ─────────────────────────────────────────
    describe('6. sleeping body transform sync and wake', () => {
        it('maintains transform sync after body sleeps, and resumes after wake', () => {
            const { bridge, loop, addEntity, step } = createHarness();

            const transform = createMockTransform({ x: 0, y: 2, z: 0 });
            const { rb } = addEntity(transform, { mass: 1, collider: 'sphere', sphereRadius: 0.5 });

            // Ground at y=0
            const tGround = createMockTransform({ x: 0, y: 0, z: 0 });
            const { rb: groundRb } = addEntity(tGround, {
                isStatic: true,
                collider: 'box',
                boxSize: { x: 50, y: 1, z: 50 },
            });

            step(1);
            groundRb.bodyType = 0 as any;

            // Let ball fall and settle (sleep threshold = 0.005, time to sleep = 0.5s)
            // 120 frames = 2 seconds — should be enough to settle and sleep
            step(180);

            // Ball should be near ground surface
            const settledY = transform.worldPosition.y;
            expect(settledY).toBeLessThan(2);
            expect(settledY).toBeGreaterThan(-1);

            // Record position while settled
            const posSettled = { ...transform.worldPosition };

            // Step more — position should remain stable (no drift)
            step(60);
            expect(Math.abs(transform.worldPosition.y - posSettled.y)).toBeLessThan(0.1);

            // Wake the body and set velocity directly via body manager
            // (addForce accumulates but sleeping body may not process it before re-sleep)
            rb.wakeUp();
            bridge.physicsWorld
                .getBodyManager()
                .setLinearVelocity(rb.bodyId, { x: 5, y: 3, z: 0 });

            // Step a few frames — body should move from settled position
            step(10);

            // Body should have moved from settled position
            const dx = transform.worldPosition.x - posSettled.x;
            const dy = transform.worldPosition.y - posSettled.y;
            expect(Math.abs(dx) + Math.abs(dy)).toBeGreaterThan(0.01);

            loop.dispose();
        });
    });

    // ── 7. Numeric pair key migration ────────────────────────────────────────
    describe('7. pair key: canonical ordering and no duplicates', () => {
        it('produces the same key regardless of body ID order', () => {
            // Access the bridge's internal active contact pairs set
            const { bridge, loop, addEntity, step } = createHarness();

            const handlerA = new CollisionHandler();
            const handlerB = new CollisionHandler();

            // Two overlapping spheres to generate contact
            const tA = createMockTransform({ x: 0, y: 0, z: 0 });
            const { rb: rbA } = addEntity(tA, {
                mass: 1,
                collider: 'sphere',
                sphereRadius: 1,
                handler: handlerA,
            });

            const tB = createMockTransform({ x: 1, y: 0, z: 0 });
            const { rb: rbB } = addEntity(tB, {
                mass: 1,
                collider: 'sphere',
                sphereRadius: 1,
                handler: handlerB,
            });

            step(1);

            // Verify contact was detected
            expect(handlerA.collisionEnters.length).toBeGreaterThanOrEqual(1);

            // Access internal _activeContactPairs
            const activePairs = (bridge as any)._activeContactPairs as Set<number>;
            expect(activePairs.size).toBeGreaterThanOrEqual(1);

            // Compute expected pair key from both orderings
            const { makeCollisionPairKey } = require('@axrone/physics-core');
            const keyAB = makeCollisionPairKey(Number(rbA.bodyId), Number(rbB.bodyId));
            const keyBA = makeCollisionPairKey(Number(rbB.bodyId), Number(rbA.bodyId));

            // Canonical: both orderings produce the same key
            expect(keyAB).toBe(keyBA);

            // Only ONE entry for this pair (no duplicates)
            expect(activePairs.has(keyAB)).toBe(true);

            // Count how many keys correspond to the A:B pair
            let pairCount = 0;
            for (const key of activePairs) {
                if (key === keyAB) pairCount++;
            }
            expect(pairCount).toBe(1);

            loop.dispose();
        });

        it('correctly converts BigInt body IDs to Number for pair key computation', () => {
            // BodyId3D may be BigInt at the type level. Verify Number() conversion works.
            const { bridge, loop, addEntity, step } = createHarness();

            const tA = createMockTransform({ x: 0, y: 0, z: 0 });
            const { rb: rbA } = addEntity(tA, { mass: 1, collider: 'sphere', sphereRadius: 1 });

            const tB = createMockTransform({ x: 1, y: 0, z: 0 });
            const { rb: rbB } = addEntity(tB, { mass: 1, collider: 'sphere', sphereRadius: 1 });

            step(1);

            // Body IDs should be valid numbers (not NaN, not Infinity)
            const idA = Number(rbA.bodyId);
            const idB = Number(rbB.bodyId);
            expect(Number.isFinite(idA)).toBe(true);
            expect(Number.isFinite(idB)).toBe(true);
            expect(idA).toBeGreaterThanOrEqual(0);
            expect(idB).toBeGreaterThanOrEqual(0);

            // makeCollisionPairKey should work without throwing
            const { makeCollisionPairKey } = require('@axrone/physics-core');
            expect(() => makeCollisionPairKey(idA, idB)).not.toThrow();

            loop.dispose();
        });
    });
});
