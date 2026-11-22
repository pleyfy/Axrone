import { describe, it, expect, afterEach } from 'vitest';
import { Rigidbody2D, RigidbodyType2D } from '../../components/rigidbody2d';
import { PhysicsWorld2D } from '../../core/physics-world';
import { PhysicsWorld2DComponent } from '../../components/physics-world-2d-component';
import { BodyType } from '@axrone/physics-core';

describe('Rigidbody2D', () => {
    function create() { return new Rigidbody2D(); }

    describe('default values', () => {
        it('has Dynamic body type by default', () => {
            expect(create().bodyType).toBe(RigidbodyType2D.Dynamic);
        });

        it('has mass 1', () => {
            expect(create().mass).toBe(1);
        });

        it('has linearDamping 0.01', () => {
            expect(create().linearDamping).toBe(0.01);
        });

        it('has angularDamping 0.01', () => {
            expect(create().angularDamping).toBe(0.01);
        });

        it('has gravityScale 1', () => {
            expect(create().gravityScale).toBe(1);
        });

        it('has fixedRotation false', () => {
            expect(create().fixedRotation).toBe(false);
        });

        it('has bullet false', () => {
            expect(create().bullet).toBe(false);
        });

        it('has null bodyId before start', () => {
            expect(create().bodyId).toBeNull();
        });
    });

    describe('property setters', () => {
        it('sets bodyType', () => {
            const rb = create();
            rb.bodyType = RigidbodyType2D.Static;
            expect(rb.bodyType).toBe(RigidbodyType2D.Static);
        });

        it('ignores non-positive mass', () => {
            const rb = create();
            rb.mass = 0;
            expect(rb.mass).toBe(1);
            rb.mass = -5;
            expect(rb.mass).toBe(1);
        });

        it('sets valid mass', () => {
            const rb = create();
            rb.mass = 5;
            expect(rb.mass).toBe(5);
        });

        it('clamps negative damping to 0', () => {
            const rb = create();
            rb.linearDamping = -1;
            expect(rb.linearDamping).toBe(0);
        });

        it('sets gravityScale', () => {
            const rb = create();
            rb.gravityScale = 2.5;
            expect(rb.gravityScale).toBe(2.5);
        });

        it('toggles fixedRotation', () => {
            const rb = create();
            rb.fixedRotation = true;
            expect(rb.fixedRotation).toBe(true);
        });

        it('toggles bullet', () => {
            const rb = create();
            rb.bullet = true;
            expect(rb.bullet).toBe(true);
        });
    });

    describe('velocity (without physics world)', () => {
        it('returns zero linearVelocity', () => {
            const rb = create();
            expect(rb.linearVelocity.x).toBe(0);
            expect(rb.linearVelocity.y).toBe(0);
        });

        it('stores linearVelocity locally', () => {
            const rb = create();
            rb.linearVelocity = { x: 3, y: 4 } as any;
            expect(rb.linearVelocity.x).toBe(3);
            expect(rb.linearVelocity.y).toBe(4);
        });

        it('returns zero angularVelocity', () => {
            expect(create().angularVelocity).toBe(0);
        });

        it('stores angularVelocity locally', () => {
            const rb = create();
            rb.angularVelocity = 2.5;
            expect(rb.angularVelocity).toBe(2.5);
        });
    });

    describe('sleep management', () => {
        it('isSleepingAllowed returns true by default', () => {
            expect(create().isSleepingAllowed()).toBe(true);
        });

        it('setSleepingAllowed toggles', () => {
            const rb = create();
            rb.setSleepingAllowed(false);
            expect(rb.isSleepingAllowed()).toBe(false);
        });

        it('isAwake returns false without physics world', () => {
            expect(create().isAwake()).toBe(false);
        });
    });

    describe('position/rotation without physics world', () => {
        it('getPosition returns zero', () => {
            const pos = create().getPosition();
            expect(pos.x).toBe(0);
            expect(pos.y).toBe(0);
        });

        it('getRotation returns 0', () => {
            expect(create().getRotation()).toBe(0);
        });

        it('setPosition is no-op without world (returns silently)', () => {
            const rb = create();
            rb.setPosition({ x: 1, y: 2 } as any);
            // Without world, getPosition still returns zero (no effect)
            expect(rb.getPosition().x).toBe(0);
            expect(rb.getPosition().y).toBe(0);
        });

        it('setRotation is no-op without world (returns silently)', () => {
            const rb = create();
            rb.setRotation(1.5);
            expect(rb.getRotation()).toBe(0);
        });
    });

    describe('force/impulse methods without physics world', () => {
        it('applyForce is no-op without world', () => {
            const rb = create();
            rb.applyForce({ x: 1, y: 0 } as any);
            // Without world, velocity stays zero
            expect(rb.linearVelocity.x).toBe(0);
            expect(rb.linearVelocity.y).toBe(0);
        });

        it('applyForceToCenter is no-op without world', () => {
            const rb = create();
            rb.applyForceToCenter({ x: 1, y: 0 } as any);
            expect(rb.linearVelocity.x).toBe(0);
        });

        it('applyTorque is no-op without world', () => {
            const rb = create();
            rb.applyTorque(5);
            expect(rb.angularVelocity).toBe(0);
        });

        it('applyLinearImpulse is no-op without world', () => {
            const rb = create();
            rb.applyLinearImpulse({ x: 1, y: 0 } as any);
            expect(rb.linearVelocity.x).toBe(0);
        });

        it('applyAngularImpulse is no-op without world', () => {
            const rb = create();
            rb.applyAngularImpulse(1);
            expect(rb.angularVelocity).toBe(0);
        });
    });

    describe('with physics world (manual wiring)', () => {
        let world: PhysicsWorld2D;
        let worldComponent: PhysicsWorld2DComponent;

        afterEach(() => {
            worldComponent.onDestroy();
        });

        function createConnectedRb(): { rb: Rigidbody2D; bodyId: any; world: PhysicsWorld2D } {
            // Set up world component singleton
            worldComponent = new PhysicsWorld2DComponent();
            worldComponent.gravity = { x: 0, y: -10 } as any;
            worldComponent.onLoad();
            world = worldComponent.physicsWorld!;

            // Create body in the world
            const bodyId = world.getBodyManager().createBody({
                type: BodyType.Dynamic,
                position: { x: 0, y: 10 },
                rotation: 0,
            });
            world.getBodyManager().setMassData(bodyId, 1, 0.1, { x: 0, y: 0 });

            // Create component and manually wire internal state
            const rb = new Rigidbody2D();
            (rb as any)._physicsWorld = world;
            (rb as any)._bodyId = bodyId;

            return { rb, bodyId, world };
        }

        it('linearVelocity setter changes body velocity in world', () => {
            const { rb, world } = createConnectedRb();
            rb.linearVelocity = { x: 5, y: 3 } as any;
            const vel = world.getBodyManager().getLinearVelocity((rb as any)._bodyId);
            expect(vel.x).toBeCloseTo(5);
            expect(vel.y).toBeCloseTo(3);
        });

        it('setPosition changes body position in world', () => {
            const { rb, world } = createConnectedRb();
            rb.setPosition({ x: 50, y: 50 } as any);
            const pos = world.getBodyManager().getPosition((rb as any)._bodyId);
            expect(pos.x).toBeCloseTo(50);
            expect(pos.y).toBeCloseTo(50);
        });

        it('getPosition returns body position from world', () => {
            const { rb, world } = createConnectedRb();
            world.getBodyManager().setPosition((rb as any)._bodyId, { x: 25, y: 30 });
            const pos = rb.getPosition();
            expect(pos.x).toBeCloseTo(25);
            expect(pos.y).toBeCloseTo(30);
        });

        it('isAwake returns true for connected dynamic body', () => {
            const { rb } = createConnectedRb();
            expect(rb.isAwake()).toBe(true);
        });
    });

    describe('serialize / deserialize', () => {
        it('serialize returns all properties', () => {
            const rb = create();
            rb.mass = 3;
            rb.gravityScale = 2;
            rb.bullet = true;
            const data = rb.serialize();
            expect(data.mass).toBe(3);
            expect(data.gravityScale).toBe(2);
            expect(data.bullet).toBe(true);
            expect(data.bodyType).toBe(RigidbodyType2D.Dynamic);
        });

        it('deserialize restores properties', () => {
            const rb = create();
            rb.deserialize({
                bodyType: RigidbodyType2D.Kinematic,
                mass: 10,
                linearDamping: 0.5,
                gravityScale: 0,
                fixedRotation: true,
                bullet: true,
                allowSleep: false,
            });
            expect(rb.bodyType).toBe(RigidbodyType2D.Kinematic);
            expect(rb.mass).toBe(10);
            expect(rb.linearDamping).toBe(0.5);
            expect(rb.gravityScale).toBe(0);
            expect(rb.fixedRotation).toBe(true);
            expect(rb.bullet).toBe(true);
        });

        it('deserialize uses defaults for missing fields', () => {
            const rb = create();
            rb.deserialize({});
            expect(rb.bodyType).toBe(RigidbodyType2D.Dynamic);
            expect(rb.mass).toBe(1);
        });
    });
});
