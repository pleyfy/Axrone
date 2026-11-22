import { describe, expect, it } from 'vitest';
import { AnimationController } from '../controller';

const rig = { bones: [{ name: 'root' }] };
const clip = {
    id: 'walk',
    tracks: [
        {
            target: 'root',
            path: 'translation' as const,
            times: [0, 1],
            values: [0, 0, 0, 1, 0, 0],
        },
    ],
};

const makeController = () =>
    new AnimationController({
        rig,
        clips: [clip],
        layers: [
            {
                id: 'base',
                stateMachine: {
                    entryState: 'walk',
                    states: [{ id: 'walk', motion: { kind: 'clip', clipId: 'walk' } }],
                },
            },
            {
                id: 'upper',
                syncSourceLayerId: 'base',
                stateMachine: {
                    entryState: 'walk',
                    states: [{ id: 'walk', motion: { kind: 'clip', clipId: 'walk' } }],
                },
            },
        ],
    });

describe('layer state sync', () => {
    it('copies the source state and normalized time before advancing', () => {
        const controller = makeController();
        controller.update(0.37);

        const base = controller.profile.activeLayers.find((layer) => layer.layerId === 'base')!;
        const upper = controller.profile.activeLayers.find((layer) => layer.layerId === 'upper')!;
        expect(upper.stateId).toBe(base.stateId);
        expect(upper.normalizedTime).toBeCloseTo(base.normalizedTime, 6);
    });

    it('rejects an unknown sync source at construction', () => {
        expect(
            () =>
                new AnimationController({
                    rig,
                    clips: [clip],
                    layers: [
                        {
                            id: 'base',
                            stateMachine: {
                                entryState: 'walk',
                                states: [{ id: 'walk', motion: { kind: 'clip', clipId: 'walk' } }],
                            },
                        },
                        {
                            id: 'upper',
                            syncSourceLayerId: 'missing',
                            stateMachine: {
                                entryState: 'walk',
                                states: [{ id: 'walk', motion: { kind: 'clip', clipId: 'walk' } }],
                            },
                        },
                    ],
                })
        ).toThrow();
    });
});
