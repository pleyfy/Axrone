import { describe, expect, it } from 'vitest';
import { Vec3 } from '@axrone/numeric';
import { Actor, Transform, World } from '@axrone/ecs-runtime';
import { TrailRenderer } from '../components/trail-renderer';
import { createSceneRegistry } from '../scene-registry';

function createTrail(config: Record<string, unknown> = {}) {
    const world = new World(createSceneRegistry());
    const actor = new Actor(world);
    const transform = actor.getComponent(Transform)!;
    const trail = actor.addComponent(TrailRenderer, {
        lifetime: 1,
        minVertexDistance: 0.1,
        ...config,
    });
    return { world, actor, transform, trail };
}

describe('TrailRenderer emitting/autodestruct', () => {
    it('records points while emitting', () => {
        const { trail, transform } = createTrail();
        transform.position = new Vec3(0, 0, 0);
        trail.update(0.016);
        transform.position = new Vec3(1, 0, 0);
        trail.update(0.016);

        expect(trail.emitting).toBe(true);
        expect(trail.pointCount).toBeGreaterThan(0);
    });

    it('stops recording when emitting is false', () => {
        const { trail, transform } = createTrail();
        transform.position = new Vec3(0, 0, 0);
        trail.update(0.016);
        transform.position = new Vec3(1, 0, 0);
        trail.update(0.016);

        trail.emitting = false;
        const recorded = trail.pointCount;
        transform.position = new Vec3(5, 0, 0);
        trail.update(0.016);

        expect(trail.pointCount).toBeLessThanOrEqual(recorded);
    });

    it('destroys the actor once a non-emitting autodestruct trail drains', () => {
        const { actor, trail, transform } = createTrail({ autodestruct: true });
        transform.position = new Vec3(0, 0, 0);
        trail.update(0.016);
        transform.position = new Vec3(1, 0, 0);
        trail.update(0.016);
        expect(trail.pointCount).toBeGreaterThan(0);

        trail.emitting = false;
        for (let i = 0; i < 200 && !actor.isDestroyed; i++) {
            trail.update(0.016);
        }

        expect(actor.isDestroyed).toBe(true);
    });

    it('keeps emitting trails alive when autodestruct is off', () => {
        const { actor, trail, transform } = createTrail({ autodestruct: false });
        transform.position = new Vec3(0, 0, 0);
        trail.update(0.016);

        for (let i = 0; i < 200; i++) {
            transform.position = new Vec3(i * 0.2, 0, 0);
            trail.update(0.016);
        }

        expect(actor.isDestroyed).toBe(false);
    });

    it('round-trips emitting through serialize/deserialize', () => {
        const { trail } = createTrail();
        trail.emitting = false;

        const data = trail.serialize();
        expect(data.emitting).toBe(false);

        const fresh = createTrail().trail;
        expect(fresh.emitting).toBe(true);
        fresh.deserialize(data);
        expect(fresh.emitting).toBe(false);
    });
});
