import { describe, expect, it } from 'vitest';
import { Vec3 } from '@axrone/numeric';
import { Entity, Transform, World } from '@axrone/ecs-runtime';
import { TrailRenderer } from '../components/trail-renderer';
import { createSceneRegistry } from '../scene-registry';

function createTrail(config: Record<string, unknown> = {}) {
    const world = new World(createSceneRegistry());
    const entity = new Entity(world);
    const transform = entity.getComponent(Transform)!;
    const trail = entity.addComponent(TrailRenderer, {
        lifetime: 1,
        minVertexDistance: 0.1,
        ...config,
    });
    return { world, entity, transform, trail };
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

    it('destroys the entity once a non-emitting autodestruct trail drains', () => {
        const { entity, trail, transform } = createTrail({ autodestruct: true });
        transform.position = new Vec3(0, 0, 0);
        trail.update(0.016);
        transform.position = new Vec3(1, 0, 0);
        trail.update(0.016);
        expect(trail.pointCount).toBeGreaterThan(0);

        trail.emitting = false;
        for (let i = 0; i < 200 && !entity.isDestroyed; i++) {
            trail.update(0.016);
        }

        expect(entity.isDestroyed).toBe(true);
    });

    it('keeps emitting trails alive when autodestruct is off', () => {
        const { entity, trail, transform } = createTrail({ autodestruct: false });
        transform.position = new Vec3(0, 0, 0);
        trail.update(0.016);

        for (let i = 0; i < 200; i++) {
            transform.position = new Vec3(i * 0.2, 0, 0);
            trail.update(0.016);
        }

        expect(entity.isDestroyed).toBe(false);
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
