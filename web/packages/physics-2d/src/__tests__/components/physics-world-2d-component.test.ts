import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { PhysicsWorld2DComponent } from '../../components/physics-world-2d-component';
import { Vec2 } from '@axrone/numeric';

describe('PhysicsWorld2DComponent', () => {
    let component: PhysicsWorld2DComponent;

    beforeEach(() => {
        component = new PhysicsWorld2DComponent();
    });

    afterEach(() => {
        component.onDestroy();
    });

    describe('default values', () => {
        it('has default gravity (0, -9.81)', () => {
            expect(component.gravity.x).toBe(0);
            expect(component.gravity.y).toBe(-9.81);
        });

        it('has null physicsWorld before onLoad', () => {
            expect(component.physicsWorld).toBeNull();
        });

        it('has null static instance before onLoad', () => {
            expect(PhysicsWorld2DComponent.instance).toBeNull();
        });
    });

    describe('onLoad', () => {
        it('creates physics world on load', () => {
            component.onLoad();
            expect(component.physicsWorld).not.toBeNull();
        });

        it('sets static instance on load', () => {
            component.onLoad();
            expect(PhysicsWorld2DComponent.instance).toBe(component);
        });
    });

    describe('onDestroy', () => {
        it('clears static instance on destroy', () => {
            component.onLoad();
            expect(PhysicsWorld2DComponent.instance).toBe(component);
            component.onDestroy();
            expect(PhysicsWorld2DComponent.instance).toBeNull();
        });

        it('clears physics world on destroy', () => {
            component.onLoad();
            expect(component.physicsWorld).not.toBeNull();
            component.onDestroy();
            expect(component.physicsWorld).toBeNull();
        });
    });

    describe('gravity setter', () => {
        it('updates gravity values', () => {
            component.gravity = new Vec2(0, -20);
            expect(component.gravity.x).toBe(0);
            expect(component.gravity.y).toBe(-20);
        });

        it('propagates gravity to physics world after load', () => {
            component.onLoad();
            component.gravity = new Vec2(5, -15);
            expect(component.gravity.x).toBe(5);
            expect(component.gravity.y).toBe(-15);
        });
    });

    describe('serialize', () => {
        it('serializes default state', () => {
            const data = component.serialize();
            expect(data.gravity).toEqual({ x: 0, y: -9.81 });
            expect(data.velocityIterations).toBe(8);
            expect(data.positionIterations).toBe(3);
        });

        it('serializes modified state', () => {
            component.gravity = new Vec2(1, -5);
            const data = component.serialize();
            expect(data.gravity).toEqual({ x: 1, y: -5 });
        });
    });

    describe('deserialize', () => {
        it('restores gravity from serialized data', () => {
            component.deserialize({
                gravity: { x: 3, y: -12 },
                velocityIterations: 12,
                positionIterations: 6,
            });
            expect(component.gravity.x).toBe(3);
            expect(component.gravity.y).toBe(-12);
        });

        it('uses defaults for missing fields', () => {
            component.deserialize({});
            expect(component.gravity.x).toBe(0);
            expect(component.gravity.y).toBe(-9.81);
        });
    });

    describe('singleton replacement', () => {
        it('replaces static instance when a second component loads', () => {
            component.onLoad();
            expect(PhysicsWorld2DComponent.instance).toBe(component);

            const second = new PhysicsWorld2DComponent();
            second.onLoad();
            expect(PhysicsWorld2DComponent.instance).toBe(second);

            second.onDestroy();
        });

        it('clears static instance only if the destroyed component is the current instance', () => {
            component.onLoad();
            const second = new PhysicsWorld2DComponent();
            second.onLoad();
            expect(PhysicsWorld2DComponent.instance).toBe(second);

            component.onDestroy();
            expect(PhysicsWorld2DComponent.instance).toBe(second);

            second.onDestroy();
        });
    });
});
