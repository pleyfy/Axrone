import { describe, expect, it } from 'vitest';
import { AnimationController } from '../controller';

const makeController = () =>
    new AnimationController({
        rig: { bones: [{ name: 'root' }, { name: 'child', parent: 'root' }] },
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

describe('steady-state allocation contract', () => {
    it('reuses the update result, root motion and profile objects', () => {
        const controller = makeController();

        const first = controller.update(0.016);
        const firstRootMotion = controller.rootMotion;
        const firstProfile = controller.profile;
        const firstLayers = firstProfile.activeLayers;

        const second = controller.update(0.016);

        expect(second).toBe(first);
        expect(controller.rootMotion).toBe(firstRootMotion);
        expect(controller.profile).toBe(firstProfile);
        expect(second.profile.activeLayers).toBe(firstLayers);
    });

    it('keeps the curve store reset allocation free', () => {
        const controller = makeController();
        controller.update(0.016);

        const frame = controller.currentFrame;
        const values = frame.curves.values;

        frame.reset(controller.rig, controller.currentFrame.curves.values);

        expect(frame.curves.values).toBe(values);
    });
});
