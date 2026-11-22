import { describe, expect, it } from 'vitest';
import { Vec3 } from '@axrone/numeric';
import { Actor, Transform, World } from '@axrone/ecs-runtime';
import { PathAgent } from '../components/path-agent';
import { createSceneRegistry } from '../scene-registry';

function createAgent(config: Record<string, unknown> = {}) {
    const world = new World(createSceneRegistry());
    const actor = new Actor(world);
    const transform = actor.getComponent(Transform)!;
    transform.position = new Vec3(0, 0, 0);
    const agent = actor.addComponent(PathAgent, {
        speed: 5,
        angularSpeed: 120,
        stoppingDistance: 0.5,
        ...config,
    });
    return { world, actor, transform, agent };
}

describe('PathAgent movement', () => {
    it('advances the transform toward the destination on update()', () => {
        const { agent, transform } = createAgent();
        agent.setDestination(new Vec3(10, 0, 0));

        const startX = transform.worldPosition.x;
        agent.update(0.016);

        expect(transform.worldPosition.x).toBeGreaterThan(startX);
        expect(Vec3.len(agent.velocity)).toBeGreaterThan(0);
    });

    it('arrives at the destination without overshooting', () => {
        const { agent, transform } = createAgent();
        agent.setDestination(new Vec3(10, 0, 0));

        for (let i = 0; i < 2000 && agent.pathStatus !== 'arrived'; i++) {
            agent.update(0.016);
        }

        expect(agent.pathStatus).toBe('arrived');
        expect(agent.hasReachedDestination()).toBe(true);
        expect(transform.worldPosition.x).toBeLessThanOrEqual(10);
        expect(10 - transform.worldPosition.x).toBeLessThanOrEqual(0.5);
    });

    it('warp() relocates the transform on the next update()', () => {
        const { agent, transform } = createAgent();

        expect(agent.warp(new Vec3(3, 0, 4))).toBe(true);
        agent.update(0.016);

        expect(transform.worldPosition.x).toBeCloseTo(3, 5);
        expect(transform.worldPosition.y).toBeCloseTo(0, 5);
        expect(transform.worldPosition.z).toBeCloseTo(4, 5);
    });

    it('stop() halts movement and resume() continues it', () => {
        const { agent, transform } = createAgent();
        agent.setDestination(new Vec3(10, 0, 0));
        agent.update(0.016);

        agent.stop();
        const heldX = transform.worldPosition.x;
        agent.update(0.016);
        expect(transform.worldPosition.x).toBe(heldX);

        agent.resume();
        agent.update(0.016);
        expect(transform.worldPosition.x).toBeGreaterThan(heldX);
    });
});
