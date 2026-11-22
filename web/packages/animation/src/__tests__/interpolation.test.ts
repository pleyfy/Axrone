import { describe, expect, it } from 'vitest';
import { AnimationController } from '../controller';

const makeController = () =>
    new AnimationController({
        rig: { bones: [{ name: 'root' }] },
        clips: [
            {
                id: 'walk',
                tracks: [
                    {
                        target: 'root',
                        path: 'translation',
                        times: [0, 1],
                        values: [0, 0, 0, 1, 0, 0],
                    },
                ],
            },
        ],
        layers: [
            {
                id: 'base',
                stateMachine: {
                    entryState: 'walk',
                    states: [{ id: 'walk', motion: { kind: 'clip', clipId: 'walk' } }],
                },
            },
        ],
    });

describe('render-phase pose interpolation', () => {
    it('blends the previous and current step', () => {
        const controller = makeController();
        controller.update(0.25);
        controller.update(0.25);

        const half = controller.sampleInterpolatedPose(0.5);
        expect(half.pose.translations[0]).toBeCloseTo(0.375, 5);

        const previous = controller.sampleInterpolatedPose(0);
        expect(previous.pose.translations[0]).toBeCloseTo(0.25, 5);

        const current = controller.sampleInterpolatedPose(1);
        expect(current.pose.translations[0]).toBeCloseTo(0.5, 5);
    });

    it('reuses the interpolated frame buffer', () => {
        const controller = makeController();
        controller.update(0.25);

        const first = controller.sampleInterpolatedPose(0.5);
        const second = controller.sampleInterpolatedPose(0.5);

        expect(second).toBe(first);
    });
});
