import { describe, expect, it } from 'vitest';
import { Actor, World } from '@axrone/ecs-runtime';
import { LODGroup } from '../components/lod-group';
import { createSceneRegistry } from '../scene-registry';

const LEVELS = [
    { screenRelativeTransitionHeight: 0.6, renderers: ['high'] },
    { screenRelativeTransitionHeight: 0.3, renderers: ['medium'] },
    { screenRelativeTransitionHeight: 0.1, renderers: ['low'] },
];

function createGroup() {
    const world = new World(createSceneRegistry());
    const actor = new Actor(world);
    const group = actor.addComponent(LODGroup, { lodLevels: LEVELS });
    return { group };
}

describe('LODGroup forced selection', () => {
    it('evaluateLOD keeps the forced level instead of auto-selecting', () => {
        const { group } = createGroup();
        group.forceLOD(2);

        expect(group.evaluateLOD(0.9)).toBe(2);
        expect(group.evaluateLOD(0.9)).toBe(2);
        expect(group.currentLODIndex).toBe(2);
        expect(group.getActiveRenderers()).toEqual(['low']);
    });

    it('forceLOD(-1) returns to automatic selection', () => {
        const { group } = createGroup();
        group.forceLOD(2);
        expect(group.evaluateLOD(0.9)).toBe(2);

        group.forceLOD(-1);
        expect(group.evaluateLOD(0.9)).toBe(0);
    });

    it('ignores out-of-range forced indices', () => {
        const { group } = createGroup();
        group.forceLOD(7);

        expect(group.forcedLODIndex).toBeNull();
        expect(group.evaluateLOD(0.9)).toBe(0);
    });

    it('drops a dangling override when levels shrink', () => {
        const { group } = createGroup();
        group.forceLOD(2);
        group.removeLODLevel(0);
        group.removeLODLevel(0);

        expect(group.forcedLODIndex).toBeNull();
        expect(group.evaluateLOD(0.9)).toBe(0);
    });
});
