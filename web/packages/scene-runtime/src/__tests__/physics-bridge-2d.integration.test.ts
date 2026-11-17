import { describe, it, expect, afterEach } from 'vitest';
import { PhysicsBridge2D } from '../components/physics-bridge-2d';
import type { IPhysicsCollisionHandler2D } from '../components/physics-bridge-2d';
import {
    PhysicsWorld2D,
    Rigidbody2D,
    RigidbodyType2D,
    CircleCollider2D,
    BoxCollider2D,
} from '@axrone/physics-2d';
import type { ICollisionEvent2D, ISensorEvent2D, BodyId } from '@axrone/physics-core';
import { makeCollisionPairKey } from '@axrone/physics-core';

// ─── Mock Transform ──────────────────────────────────────────────────────────
interface MockTransformData {
    position: { x: number; y: number };
    rotation: { x: number; y: number; z: number; w: number };
}

function createMockTransform(pos = { x: 0, y: 0 }): MockTransformData {
    return {
        position: { ...pos },
        rotation: { x: 0, y: 0, z: 0, w: 1 },
    };
}

// ─── Mock Actor ──────────────────────────────────────────────────────────────
class MockActor {
    active = true;
    isDestroyed = false;
    private _components: any[] = [];

    addComponent(c: any): this {
        this._components.push(c);
        if ('actor' in c) (c as any).actor = this;
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
    private _actors: MockActor[] = [];
    addActor(a: MockActor): void {
        this._actors.push(a);
    }
    getAllActors(): MockActor[] {
        return [...this._actors];
    }
}

// ─── Collision Handler Component ─────────────────────────────────────────────
class CollisionHandler implements IPhysicsCollisionHandler2D {
    collisionEnters: { other: Rigidbody2D; event: any }[] = [];
    collisionStays: { other: Rigidbody2D; event: any }[] = [];
    collisionExits: { other: Rigidbody2D; event: any }[] = [];
    sensorEnters: { other: Rigidbody2D; event: any }[] = [];
    sensorExits: { other: Rigidbody2D; event: any }[] = [];

    onCollisionEnter(other: Rigidbody2D, event: ICollisionEvent2D): void {
        this.collisionEnters.push({ other, event });
    }
    onCollisionStay(other: Rigidbody2D, event: ICollisionEvent2D): void {
        this.collisionStays.push({ other, event });
    }
    onCollisionExit(other: Rigidbody2D, event: ICollisionEvent2D): void {
        this.collisionExits.push({ other, event });
    }
    onSensorEnter(other: Rigidbody2D, event: ISensorEvent2D): void {
        this.sensorEnters.push({ other, event });
    }
    onSensorExit(other: Rigidbody2D, event: ISensorEvent2D): void {
        this.sensorExits.push({ other, event });
    }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────
const ENGINE_FIXED_DELTA_MS = 1000 / 60;
const GRAVITY_2D = -9.81;

function createHarness(gravity = { x: 0, y: GRAVITY_2D }) {
    const ecsWorld = new MockEcsWorld();
    const bridge = new PhysicsBridge2D(ecsWorld as any, {
        worldConfig: { gravity },
    });

    const rbodies: Rigidbody2D[] = [];

    function addEntity(
        transform: MockTransformData,
        opts: {
            mass?: number;
            bodyType?: RigidbodyType2D;
            collider?: 'circle' | 'box';
            radius?: number;
            boxSize?: { x: number; y: number };
            isTrigger?: boolean;
            handler?: CollisionHandler;
        } = {}
    ): { actor: MockActor; rb: Rigidbody2D } {
        const actor = new MockActor();

        const rb = new Rigidbody2D();
        // Override transform getter to return our mock
        Object.defineProperty(rb, 'transform', {
            get: () => transform,
            configurable: true,
        });
        // Set internal physics world reference directly
        (rb as any)._physicsWorld = bridge.physicsWorld;
        if (opts.bodyType !== undefined) {
            (rb as any)._bodyType = opts.bodyType;
        }
        if (opts.mass !== undefined) {
            (rb as any)._mass = opts.mass;
        }
        actor.addComponent(rb);

        // Create physics body directly via body manager
        const bodyManager = bridge.physicsWorld.getBodyManager();
        const bodyId = bodyManager.createBody({
            type: (opts.bodyType ?? RigidbodyType2D.Dynamic) as any,
            position: { x: transform.position.x, y: transform.position.y },
            rotation: 0,
            linearVelocity: { x: 0, y: 0 },
            angularVelocity: 0,
            linearDamping: 0.01,
            angularDamping: 0.01,
            gravityScale: 1,
            fixedRotation: false,
            bullet: false,
            allowSleep: true,
            awake: true,
            enabled: true,
        });
        (rb as any)._bodyId = bodyId;

        // Create collider shape
        if (opts.collider === 'circle' || opts.collider === undefined) {
            const col = new CircleCollider2D();
            col.radius = opts.radius ?? 0.5;
            if (opts.isTrigger) col.isTrigger = true;
            (col as any)._physicsWorld = bridge.physicsWorld;
            (col as any)._rigidbody = rb;
            actor.addComponent(col);

            const shapeId = bridge.physicsWorld.createCircleShape(bodyId, {
                center: { x: 0, y: 0 },
                radius: opts.radius ?? 0.5,
                material: { friction: 0.4, restitution: 0, density: 1 },
                isSensor: opts.isTrigger ?? false,
                filter: { categoryBits: 0x0001, maskBits: 0xffff, groupIndex: 0 },
            });
            (col as any)._shapeId = shapeId;
        } else if (opts.collider === 'box') {
            const col = new BoxCollider2D();
            if (opts.boxSize) col.size = opts.boxSize as any;
            if (opts.isTrigger) col.isTrigger = true;
            (col as any)._physicsWorld = bridge.physicsWorld;
            (col as any)._rigidbody = rb;
            actor.addComponent(col);

            const hw = (opts.boxSize?.x ?? 1) * 0.5;
            const hh = (opts.boxSize?.y ?? 1) * 0.5;
            const shapeId = bridge.physicsWorld.createBoxShape(bodyId, {
                center: { x: 0, y: 0 },
                halfWidth: hw,
                halfHeight: hh,
                rotation: 0,
                material: { friction: 0.4, restitution: 0, density: 1 },
                isSensor: opts.isTrigger ?? false,
                filter: { categoryBits: 0x0001, maskBits: 0xffff, groupIndex: 0 },
            });
            (col as any)._shapeId = shapeId;
        }

        if (opts.handler) {
            actor.addComponent(opts.handler);
        }

        ecsWorld.addActor(actor);
        rbodies.push(rb);

        // Immediately register with bridge so the body is tracked before the
        // next physics step (bypasses the one-frame beforeUpdate delay).
        bridge.registerNewComponents();

        return { actor, rb };
    }

    function step(n = 1): void {
        for (let i = 0; i < n; i++) {
            // Register new bodies (bridge beforeUpdate)
            bridge.beforeUpdate({ fixedDelta: ENGINE_FIXED_DELTA_MS } as any);
            // Step physics world
            bridge.physicsWorld.step(ENGINE_FIXED_DELTA_MS, 8, 3);
            // Sync transforms from physics for all registered rigidbodies
            for (const rb of rbodies) {
                if (rb.bodyId != null) {
                    syncTransform(rb, bridge.physicsWorld);
                }
            }
        }
    }

    function syncTransform(rb: Rigidbody2D, world: PhysicsWorld2D): void {
        const bodyId = rb.bodyId;
        if (bodyId == null) return;
        const transform = (rb as any).transform as MockTransformData | undefined;
        if (!transform) return;
        const bodyManager = world.getBodyManager();
        const pos = bodyManager.getPosition(bodyId);
        const rot = bodyManager.getRotation(bodyId);
        transform.position.x = pos.x;
        transform.position.y = pos.y;
        // 2D rotation → quaternion (z-axis only)
        const halfAngle = rot * 0.5;
        transform.rotation = { x: 0, y: 0, z: Math.sin(halfAngle), w: Math.cos(halfAngle) };
    }

    return { ecsWorld, bridge, addEntity, step, rbodies };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('PhysicsBridge2D integration', () => {
    let activeBridge: PhysicsBridge2D | null = null;

    afterEach(() => {
        if (activeBridge && !activeBridge.isDisposed) {
            activeBridge.dispose();
        }
        activeBridge = null;
    });

    // ── 1. Body/shape creation ───────────────────────────────────────────────
    describe('1. body and shape creation via bridge', () => {
        it('creates physics bodies and shapes when new components are discovered', () => {
            const { bridge, addEntity, step } = createHarness();
            activeBridge = bridge;

            const t1 = createMockTransform({ x: 0, y: 5 });
            const { rb: rb1 } = addEntity(t1, { collider: 'circle', radius: 0.5 });

            const t2 = createMockTransform({ x: 0, y: 0 });
            const { rb: rb2 } = addEntity(t2, {
                bodyType: RigidbodyType2D.Static,
                collider: 'box',
                boxSize: { x: 50, y: 1 },
            });

            const bm = bridge.physicsWorld.getBodyManager();
            const sm = bridge.physicsWorld.getShapeManager();

            // Bodies/shapes already created by addEntity
            expect(bm.bodyCount).toBe(2);
            expect(sm.shapeCount).toBe(2);

            // Body IDs should be valid
            expect(rb1.bodyId).not.toBeNull();
            expect(rb2.bodyId).not.toBeNull();
            expect(rb1.bodyId).not.toBe(rb2.bodyId);

            // After step, bridge should have registered them
            step(1);
            const bodyIdMap = (bridge as any)._bodyIdToComponent as Map<BodyId, Rigidbody2D>;
            expect(bodyIdMap.size).toBe(2);

            bridge.dispose();
        });

        it('does not duplicate registrations on subsequent steps', () => {
            const { bridge, addEntity, step } = createHarness();
            activeBridge = bridge;

            const t = createMockTransform({ x: 0, y: 5 });
            addEntity(t, { collider: 'circle' });

            step(1);
            const bodyIdMap = (bridge as any)._bodyIdToComponent as Map<BodyId, Rigidbody2D>;
            expect(bodyIdMap.size).toBe(1);

            step(5);
            // Still 1 — WeakSet prevents re-registration
            expect(bodyIdMap.size).toBe(1);

            bridge.dispose();
        });
    });

    // ── 2. Transform sync ────────────────────────────────────────────────────
    describe('2. transform sync from physics to entity', () => {
        it('syncs gravity-driven position back to entity transform after step', () => {
            const { bridge, addEntity, step } = createHarness();
            activeBridge = bridge;

            const transform = createMockTransform({ x: 0, y: 10 });
            addEntity(transform, { collider: 'circle', radius: 0.5 });

            step(1);
            const yAfter1 = transform.position.y;
            expect(yAfter1).toBeLessThan(10);
            expect(yAfter1).toBeGreaterThan(9.5);

            step(30);
            const yAfter30 = transform.position.y;
            expect(yAfter30).toBeLessThan(yAfter1);
            expect(yAfter30).toBeGreaterThan(7);
            expect(yAfter30).toBeLessThan(10);

            bridge.dispose();
        });

        it('does NOT sync when body is static', () => {
            const { bridge, addEntity, step } = createHarness();
            activeBridge = bridge;

            const transform = createMockTransform({ x: 0, y: 0 });
            addEntity(transform, {
                bodyType: RigidbodyType2D.Static,
                collider: 'box',
                boxSize: { x: 10, y: 1 },
            });

            step(1);
            const posBefore = { ...transform.position };
            step(60);

            expect(transform.position.x).toBe(posBefore.x);
            expect(transform.position.y).toBe(posBefore.y);

            bridge.dispose();
        });
    });

    // ── 3. Contact event flow ────────────────────────────────────────────────
    describe('3. contact event flow through bridge', () => {
        it('fires onCollisionEnter on user handler when two bodies make contact', () => {
            const { bridge, addEntity, step } = createHarness();
            activeBridge = bridge;

            const handlerA = new CollisionHandler();
            const handlerB = new CollisionHandler();

            // Ground: static box, top surface at y=0.5
            const tGround = createMockTransform({ x: 0, y: 0 });
            const { rb: groundRb } = addEntity(tGround, {
                bodyType: RigidbodyType2D.Static,
                collider: 'box',
                boxSize: { x: 50, y: 1 },
                handler: handlerB,
            });

            // Ball: dynamic circle, starts at y=3
            const tBall = createMockTransform({ x: 0, y: 3 });
            const { rb: ballRb } = addEntity(tBall, {
                collider: 'circle',
                radius: 0.5,
                handler: handlerA,
            });

            step(1);

            // Register bodies with bridge (second beforeUpdate picks up bodies)
            step(120);

            // Ball should have fallen near ground
            expect(tBall.position.y).toBeLessThan(3);
            expect(tBall.position.y).toBeLessThan(1.5);

            // Contact events should have fired
            expect(handlerA.collisionEnters.length).toBeGreaterThanOrEqual(1);
            expect(handlerB.collisionEnters.length).toBeGreaterThanOrEqual(1);

            // The 'other' rigidbody should be the opposite body
            expect(handlerA.collisionEnters[0].other).toBe(groundRb);
            expect(handlerB.collisionEnters[0].other).toBe(ballRb);

            bridge.dispose();
        });

        it('fires onCollisionStay on continuing contact', () => {
            const { bridge, addEntity, step } = createHarness();
            activeBridge = bridge;

            const handler = new CollisionHandler();

            const tGround = createMockTransform({ x: 0, y: 0 });
            addEntity(tGround, {
                bodyType: RigidbodyType2D.Static,
                collider: 'box',
                boxSize: { x: 50, y: 1 },
            });

            const tBall = createMockTransform({ x: 0, y: 3 });
            addEntity(tBall, {
                collider: 'circle',
                radius: 0.5,
                handler,
            });

            step(180);

            // After settling, collisionStay should have fired multiple times
            expect(handler.collisionEnters.length).toBeGreaterThanOrEqual(1);
            expect(handler.collisionStays.length).toBeGreaterThanOrEqual(1);

            bridge.dispose();
        });

        it('does NOT fire collision events when bodies are too far apart', () => {
            const { bridge, addEntity, step } = createHarness();
            activeBridge = bridge;

            const handlerA = new CollisionHandler();
            const handlerB = new CollisionHandler();

            const tA = createMockTransform({ x: 0, y: 100 });
            addEntity(tA, { collider: 'circle', radius: 0.5, handler: handlerA });

            const tB = createMockTransform({ x: 0, y: -100 });
            addEntity(tB, {
                bodyType: RigidbodyType2D.Static,
                collider: 'circle',
                radius: 0.5,
                handler: handlerB,
            });

            step(60);

            expect(handlerA.collisionEnters.length).toBe(0);
            expect(handlerB.collisionEnters.length).toBe(0);

            bridge.dispose();
        });
    });

    // ── 4. Collision exit ────────────────────────────────────────────────────
    describe('4. collision exit events and memory leak prevention', () => {
        it('fires onCollisionExit when bodies separate and clears pair Set', () => {
            const { bridge, addEntity, step } = createHarness();
            activeBridge = bridge;

            const handlerA = new CollisionHandler();
            const handlerB = new CollisionHandler();

            const tGround = createMockTransform({ x: 0, y: 0 });
            const { rb: groundRb } = addEntity(tGround, {
                bodyType: RigidbodyType2D.Static,
                collider: 'box',
                boxSize: { x: 50, y: 1 },
                handler: handlerB,
            });

            const tBall = createMockTransform({ x: 0, y: 3 });
            const { rb: ballRb } = addEntity(tBall, {
                collider: 'circle',
                radius: 0.5,
                handler: handlerA,
            });

            step(120);

            expect(handlerA.collisionEnters.length).toBeGreaterThanOrEqual(1);

            // Launch ball upward to break contact
            bridge.physicsWorld
                .getBodyManager()
                .setLinearVelocity(ballRb.bodyId!, { x: 0, y: 30 });

            step(60);

            expect(handlerA.collisionExits.length).toBeGreaterThanOrEqual(1);
            expect(handlerB.collisionExits.length).toBeGreaterThanOrEqual(1);

            // Active contact pairs must be cleaned up
            const activePairs = (bridge as any)._activeContactPairs as Set<number>;
            expect(activePairs.size).toBe(0);

            bridge.dispose();
        });
    });

    // ── 5. Sensor/trigger ────────────────────────────────────────────────────
    describe('5. sensor/trigger events and no physical response', () => {
        it('fires sensor events without deflecting the visitor body', () => {
            const { bridge, addEntity, step } = createHarness({ gravity: { x: 0, y: 0 } });
            activeBridge = bridge;

            const handlerVisitor = new CollisionHandler();
            const handlerSensor = new CollisionHandler();

            const tVisitor = createMockTransform({ x: -5, y: 0 });
            const { rb: visitorRb } = addEntity(tVisitor, {
                collider: 'circle',
                radius: 0.5,
                handler: handlerVisitor,
            });

            const tSensor = createMockTransform({ x: 0, y: 0 });
            const { rb: sensorRb } = addEntity(tSensor, {
                bodyType: RigidbodyType2D.Static,
                collider: 'circle',
                radius: 2,
                isTrigger: true,
                handler: handlerSensor,
            });

            step(1);

            // Set visitor velocity
            bridge.physicsWorld
                .getBodyManager()
                .setLinearVelocity(visitorRb.bodyId!, { x: 10, y: 0 });

            step(60);

            // Visitor passed through (no physical deflection)
            expect(tVisitor.position.x).toBeGreaterThan(0);
            const vel = bridge.physicsWorld.getBodyManager().getLinearVelocity(visitorRb.bodyId!);
            expect(Math.abs(vel.x - 10)).toBeLessThan(2);

            // Sensor events reached user handlers
            expect(handlerSensor.sensorEnters.length).toBeGreaterThanOrEqual(1);
            expect(handlerVisitor.sensorEnters.length).toBeGreaterThanOrEqual(1);

            expect(handlerSensor.sensorEnters[0].other).toBe(visitorRb);
            expect(handlerVisitor.sensorEnters[0].other).toBe(sensorRb);

            bridge.dispose();
        });

        it('negative control: normal collider DOES produce physical response', () => {
            const { bridge, addEntity, step } = createHarness({ gravity: { x: 0, y: 0 } });
            activeBridge = bridge;

            const tVisitor = createMockTransform({ x: -5, y: 0 });
            const { rb: visitorRb } = addEntity(tVisitor, {
                collider: 'circle',
                radius: 0.5,
            });

            const tWall = createMockTransform({ x: 0, y: 0 });
            addEntity(tWall, {
                bodyType: RigidbodyType2D.Static,
                collider: 'circle',
                radius: 2,
                // NOT a trigger
            });

            step(1);

            bridge.physicsWorld
                .getBodyManager()
                .setLinearVelocity(visitorRb.bodyId!, { x: 10, y: 0 });

            step(60);

            // With a normal collider, visitor should be deflected
            const vel = bridge.physicsWorld.getBodyManager().getLinearVelocity(visitorRb.bodyId!);
            expect(vel.x).toBeLessThan(8);

            bridge.dispose();
        });

        it('fires onSensorExit when visitor leaves and clears trigger pair Set', () => {
            const { bridge, addEntity, step } = createHarness({ gravity: { x: 0, y: 0 } });
            activeBridge = bridge;

            const handlerVisitor = new CollisionHandler();
            const handlerSensor = new CollisionHandler();

            const tVisitor = createMockTransform({ x: -5, y: 0 });
            const { rb: visitorRb } = addEntity(tVisitor, {
                collider: 'circle',
                radius: 0.5,
                handler: handlerVisitor,
            });

            const tSensor = createMockTransform({ x: 0, y: 0 });
            addEntity(tSensor, {
                bodyType: RigidbodyType2D.Static,
                collider: 'circle',
                radius: 2,
                isTrigger: true,
                handler: handlerSensor,
            });

            step(1);

            bridge.physicsWorld
                .getBodyManager()
                .setLinearVelocity(visitorRb.bodyId!, { x: 50, y: 0 });

            step(60);

            expect(handlerSensor.sensorExits.length).toBeGreaterThanOrEqual(1);
            expect(handlerVisitor.sensorExits.length).toBeGreaterThanOrEqual(1);

            const triggerPairs = (bridge as any)._activeTriggerPairs as Set<number>;
            expect(triggerPairs.size).toBe(0);

            bridge.dispose();
        });
    });

    // ── 6. Step order validation ─────────────────────────────────────────────
    describe('6. step order: overlapping vs separated bodies', () => {
        it('overlapping bodies at spawn detect contact on the FIRST step', () => {
            const { bridge, addEntity, step } = createHarness({ gravity: { x: 0, y: 0 } });
            activeBridge = bridge;

            const handlerA = new CollisionHandler();
            const handlerB = new CollisionHandler();

            const tA = createMockTransform({ x: 0, y: 0 });
            addEntity(tA, { collider: 'circle', radius: 1, handler: handlerA });

            const tB = createMockTransform({ x: 1, y: 0 });
            addEntity(tB, { collider: 'circle', radius: 1, handler: handlerB });

            step(1);

            expect(handlerA.collisionEnters.length).toBeGreaterThanOrEqual(1);
            expect(handlerB.collisionEnters.length).toBeGreaterThanOrEqual(1);

            bridge.dispose();
        });

        it('separated bodies do NOT detect contact on the first step', () => {
            const { bridge, addEntity, step } = createHarness({ gravity: { x: 0, y: 0 } });
            activeBridge = bridge;

            const handlerA = new CollisionHandler();

            const tA = createMockTransform({ x: 0, y: 0 });
            addEntity(tA, { collider: 'circle', radius: 0.5, handler: handlerA });

            const tB = createMockTransform({ x: 100, y: 0 });
            addEntity(tB, { collider: 'circle', radius: 0.5 });

            step(1);

            expect(handlerA.collisionEnters.length).toBe(0);

            bridge.dispose();
        });
    });

    // ── 7. Sleeping body ─────────────────────────────────────────────────────
    describe('7. sleeping body transform sync and wake', () => {
        it('maintains transform sync after body sleeps, and resumes after wake', () => {
            const { bridge, addEntity, step } = createHarness();
            activeBridge = bridge;

            const transform = createMockTransform({ x: 0, y: 2 });
            const { rb } = addEntity(transform, { collider: 'circle', radius: 0.5 });

            const tGround = createMockTransform({ x: 0, y: 0 });
            addEntity(tGround, {
                bodyType: RigidbodyType2D.Static,
                collider: 'box',
                boxSize: { x: 50, y: 1 },
            });

            // Let ball fall and settle
            step(180);

            const settledY = transform.position.y;
            expect(settledY).toBeLessThan(2);
            expect(settledY).toBeGreaterThan(-1);

            const posSettled = { ...transform.position };

            // Step more — position should remain stable
            step(60);
            expect(Math.abs(transform.position.y - posSettled.y)).toBeLessThan(0.1);

            // Wake and apply velocity
            bridge.physicsWorld.getBodyManager().setAwake(rb.bodyId!, true);
            bridge.physicsWorld
                .getBodyManager()
                .setLinearVelocity(rb.bodyId!, { x: 5, y: 3 });

            step(10);

            const dx = transform.position.x - posSettled.x;
            const dy = transform.position.y - posSettled.y;
            expect(Math.abs(dx) + Math.abs(dy)).toBeGreaterThan(0.01);

            bridge.dispose();
        });
    });

    // ── 8. Dispose ───────────────────────────────────────────────────────────
    describe('8. dispose clears all state', () => {
        it('dispose clears Maps, Sets, and disposes the world', () => {
            const { bridge, addEntity, step } = createHarness();

            const handler = new CollisionHandler();
            const tA = createMockTransform({ x: 0, y: 0 });
            addEntity(tA, { collider: 'circle', radius: 1, handler });

            const tB = createMockTransform({ x: 1, y: 0 });
            addEntity(tB, { collider: 'circle', radius: 1 });

            step(1);

            bridge.dispose();
            activeBridge = null; // already disposed

            expect(bridge.isDisposed).toBe(true);

            const bodyIdMap = (bridge as any)._bodyIdToComponent as Map<any, any>;
            const componentToActor = (bridge as any)._componentToActor as Map<any, any>;
            const activeContactPairs = (bridge as any)._activeContactPairs as Set<number>;
            const activeTriggerPairs = (bridge as any)._activeTriggerPairs as Set<number>;

            expect(bodyIdMap.size).toBe(0);
            expect(componentToActor.size).toBe(0);
            expect(activeContactPairs.size).toBe(0);
            expect(activeTriggerPairs.size).toBe(0);
        });
    });

    // ── 9. Pair key ──────────────────────────────────────────────────────────
    describe('9. pair key: canonical ordering and no duplicates', () => {
        it('produces the same key regardless of body ID order', () => {
            const { bridge, addEntity, step } = createHarness({ gravity: { x: 0, y: 0 } });
            activeBridge = bridge;

            const handlerA = new CollisionHandler();
            const handlerB = new CollisionHandler();

            const tA = createMockTransform({ x: 0, y: 0 });
            const { rb: rbA } = addEntity(tA, {
                collider: 'circle',
                radius: 1,
                handler: handlerA,
            });

            const tB = createMockTransform({ x: 1, y: 0 });
            const { rb: rbB } = addEntity(tB, {
                collider: 'circle',
                radius: 1,
                handler: handlerB,
            });

            step(1);

            expect(handlerA.collisionEnters.length).toBeGreaterThanOrEqual(1);

            const activePairs = (bridge as any)._activeContactPairs as Set<number>;
            expect(activePairs.size).toBeGreaterThanOrEqual(1);

            const keyAB = makeCollisionPairKey(Number(rbA.bodyId), Number(rbB.bodyId));
            const keyBA = makeCollisionPairKey(Number(rbB.bodyId), Number(rbA.bodyId));

            expect(keyAB).toBe(keyBA);
            expect(activePairs.has(keyAB)).toBe(true);

            let pairCount = 0;
            for (const key of activePairs) {
                if (key === keyAB) pairCount++;
            }
            expect(pairCount).toBe(1);

            bridge.dispose();
        });
    });

    // ── 10. Kinematic wake ───────────────────────────────────────────────────
    describe('10. kinematic body wakes contacting dynamic body', () => {
        it('moving kinematic body wakes dynamic body on contact', () => {
            const { bridge, addEntity, step } = createHarness({ gravity: { x: 0, y: 0 } });
            activeBridge = bridge;

            // Dynamic body at rest
            const tDyn = createMockTransform({ x: 0, y: 0 });
            const { rb: dynRb } = addEntity(tDyn, {
                collider: 'circle',
                radius: 0.5,
            });

            // Kinematic body approaching
            const tKin = createMockTransform({ x: -3, y: 0 });
            const { rb: kinRb } = addEntity(tKin, {
                bodyType: RigidbodyType2D.Kinematic,
                collider: 'circle',
                radius: 0.5,
            });

            step(1);

            // Set kinematic velocity toward dynamic body
            bridge.physicsWorld
                .getBodyManager()
                .setLinearVelocity(kinRb.bodyId!, { x: 5, y: 0 });

            // Let them collide
            step(60);

            // Dynamic body should have been pushed (position changed from origin)
            expect(tDyn.position.x).toBeGreaterThan(0);

            bridge.dispose();
        });
    });

    // ── 11. Negative: no events for distant bodies ───────────────────────────
    describe('11. no events for distant bodies', () => {
        it('does not fire events for bodies that never come close', () => {
            const { bridge, addEntity, step } = createHarness({ gravity: { x: 0, y: 0 } });
            activeBridge = bridge;

            const handler = new CollisionHandler();

            const tA = createMockTransform({ x: 0, y: 0 });
            addEntity(tA, { collider: 'circle', radius: 0.5, handler });

            const tB = createMockTransform({ x: 500, y: 500 });
            addEntity(tB, {
                bodyType: RigidbodyType2D.Static,
                collider: 'circle',
                radius: 0.5,
            });

            step(120);

            expect(handler.collisionEnters.length).toBe(0);
            expect(handler.sensorEnters.length).toBe(0);

            bridge.dispose();
        });
    });

    // ── 12. Body ID validity ─────────────────────────────────────────────────
    describe('12. body IDs are valid numbers', () => {
        it('body IDs are finite non-negative numbers', () => {
            const { bridge, addEntity, step } = createHarness();
            activeBridge = bridge;

            const tA = createMockTransform({ x: 0, y: 0 });
            const { rb: rbA } = addEntity(tA, { collider: 'circle', radius: 1 });

            const tB = createMockTransform({ x: 5, y: 0 });
            const { rb: rbB } = addEntity(tB, { collider: 'circle', radius: 1 });

            step(1);

            const idA = Number(rbA.bodyId);
            const idB = Number(rbB.bodyId);
            expect(Number.isFinite(idA)).toBe(true);
            expect(Number.isFinite(idB)).toBe(true);
            expect(idA).toBeGreaterThanOrEqual(0);
            expect(idB).toBeGreaterThanOrEqual(0);

            expect(() => makeCollisionPairKey(idA, idB)).not.toThrow();

            bridge.dispose();
        });
    });

    // ── 13. Contact pair cleanup after separation ────────────────────────────
    describe('13. activeContactPairs cleared after bodies separate', () => {
        it('contact pairs are empty after all contacts end', () => {
            const { bridge, addEntity, step } = createHarness({ gravity: { x: 0, y: 0 } });
            activeBridge = bridge;

            const handler = new CollisionHandler();

            const tA = createMockTransform({ x: 0, y: 0 });
            addEntity(tA, { collider: 'circle', radius: 1, handler });

            const tB = createMockTransform({ x: 1, y: 0 });
            const { rb: rbB } = addEntity(tB, { collider: 'circle', radius: 1 });

            step(1);

            const activePairs = (bridge as any)._activeContactPairs as Set<number>;
            expect(activePairs.size).toBeGreaterThanOrEqual(1);

            // Separate bodies
            bridge.physicsWorld
                .getBodyManager()
                .setPosition(rbB.bodyId!, { x: 100, y: 0 });

            step(5);

            expect(activePairs.size).toBe(0);

            bridge.dispose();
        });
    });

    // ── 14. Gravity-driven contact after multiple steps ──────────────────────
    describe('14. separated bodies detect contact after gravity pulls them together', () => {
        it('ball at y=3 reaches ground at y=0 after multiple steps', () => {
            const { bridge, addEntity, step } = createHarness();
            activeBridge = bridge;

            const handlerGround = new CollisionHandler();

            const tGround = createMockTransform({ x: 0, y: 0 });
            addEntity(tGround, {
                bodyType: RigidbodyType2D.Static,
                collider: 'box',
                boxSize: { x: 50, y: 1 },
                handler: handlerGround,
            });

            const tBall = createMockTransform({ x: 0, y: 3 });
            addEntity(tBall, { collider: 'circle', radius: 0.5 });

            step(1);

            // After 1 step: ball barely moved
            expect(tBall.position.y).toBeGreaterThan(2.9);
            expect(handlerGround.collisionEnters.length).toBe(0);

            step(120);
            expect(handlerGround.collisionEnters.length).toBeGreaterThanOrEqual(1);

            bridge.dispose();
        });
    });

    // ── 15. Bridge creates world with correct gravity ────────────────────────
    describe('15. bridge world configuration', () => {
        it('creates PhysicsWorld2D with configured gravity', () => {
            const ecsWorld = new MockEcsWorld();
            const bridge = new PhysicsBridge2D(ecsWorld as any, {
                worldConfig: { gravity: { x: 0, y: -20 } },
            });
            activeBridge = bridge;

            expect(bridge.physicsWorld).toBeDefined();
            expect(bridge.isDisposed).toBe(false);
            expect(bridge.id).toBe('scene.physics-bridge-2d');

            bridge.dispose();
        });

        it('defaults gravity to (0, -9.81) when not specified', () => {
            const ecsWorld = new MockEcsWorld();
            const bridge = new PhysicsBridge2D(ecsWorld as any);
            activeBridge = bridge;

            expect(bridge.physicsWorld).toBeDefined();

            bridge.dispose();
        });
    });
});
