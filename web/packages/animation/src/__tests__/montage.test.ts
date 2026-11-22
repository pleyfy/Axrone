import { describe, expect, it } from 'vitest';
import { AnimationController } from '../controller';

const makeController = () =>
    new AnimationController({
        rig: {
            bones: [{ name: 'root' }, { name: 'bone', parent: 'root' }],
        },
        clips: [
            { id: 'idle', tracks: [] },
            {
                id: 'slide',
                duration: 1,
                tracks: [
                    {
                        target: 'bone',
                        path: 'translation',
                        times: [0, 1],
                        values: [0, 0, 0, 10, 0, 0],
                    },
                ],
            },
            {
                id: 'cued',
                duration: 1,
                tracks: [
                    {
                        target: 'bone',
                        path: 'translation',
                        times: [0, 1],
                        values: [0, 0, 0, 10, 0, 0],
                    },
                ],
                events: [{ time: 0.1, name: 'hit', payload: { cue: 'montage' } }],
            },
        ],
        layers: [
            {
                id: 'base',
                stateMachine: {
                    entryState: 'idle',
                    states: [{ id: 'idle', motion: { kind: 'clip', clipId: 'idle' } }],
                },
            },
        ],
    });

const boneX = (controller: AnimationController): number =>
    controller.currentFrame.pose.translations[1 * 3]!;

describe('AnimationMontage', () => {
    it('fades in, blends over the base layer and completes', () => {
        const controller = makeController();
        const montage = controller.playMontage('slide', {
            fadeInSeconds: 0.5,
            fadeOutSeconds: 0.5,
        });

        expect(controller.profile.activeLayers).toHaveLength(2);

        controller.update(0.25);
        expect(montage.weight).toBeCloseTo(0.5, 4);
        expect(boneX(controller)).toBeCloseTo(1.25, 4);

        controller.update(0.5);
        expect(montage.weight).toBeCloseTo(0.5, 4);
        expect(boneX(controller)).toBeCloseTo(3.75, 4);

        controller.update(0.3);
        expect(montage.status).toBe('completed');
        expect(controller.montages).toHaveLength(0);
        expect(controller.profile.activeLayers).toHaveLength(1);
        expect(boneX(controller)).toBeCloseTo(0, 4);
    });

    it('releases the layer on the next update after stop', () => {
        const controller = makeController();
        const montage = controller.playMontage('slide');

        controller.update(0.1);
        expect(controller.profile.activeLayers).toHaveLength(2);

        montage.stop();
        expect(montage.status).toBe('stopped');
        expect(controller.profile.activeLayers).toHaveLength(2);

        controller.update(0.1);
        expect(controller.profile.activeLayers).toHaveLength(1);
        expect(controller.montages).toHaveLength(0);
    });

    it('routes clip events through the controller sink', () => {
        const controller = makeController();
        controller.playMontage('cued', { fadeInSeconds: 0 });

        controller.update(0.2);

        expect(
            controller.events.some(
                (event) => event.name === 'hit' && event.payload?.cue === 'montage'
            )
        ).toBe(true);
    });

    it('replaces the previous montage by default', () => {
        const controller = makeController();
        const first = controller.playMontage('slide', { fadeInSeconds: 0 });
        controller.update(0.1);

        const second = controller.playMontage('slide', { fadeInSeconds: 0 });
        expect(first.status).toBe('stopped');
        expect(second.status).toBe('playing');
        expect(controller.montages).toHaveLength(2);

        controller.update(0.1);
        expect(controller.montages).toHaveLength(1);
        expect(controller.profile.activeLayers).toHaveLength(2);
    });

    it('keeps both montages when replaceExisting is off', () => {
        const controller = makeController();
        controller.playMontage('slide', { fadeInSeconds: 0, replaceExisting: false });
        controller.playMontage('slide', { fadeInSeconds: 0, replaceExisting: false });

        expect(controller.montages).toHaveLength(2);
        expect(controller.profile.activeLayers).toHaveLength(3);
    });

    it('plays faster with a higher speed', () => {
        const controller = makeController();
        const montage = controller.playMontage('slide', { fadeInSeconds: 0, speed: 2 });

        controller.update(0.25);

        expect(montage.normalizedTime).toBeCloseTo(0.5, 3);
        expect(boneX(controller)).toBeCloseTo(5, 3);
    });

    it('loops until stopped', () => {
        const controller = makeController();
        const montage = controller.playMontage('slide', { fadeInSeconds: 0, loop: true });

        controller.update(1.25);

        expect(montage.status).toBe('playing');
        expect(montage.normalizedTime).toBeCloseTo(0.25, 3);
        expect(controller.montages).toHaveLength(1);
    });

    it('rejects an unknown clip', () => {
        const controller = makeController();

        expect(() => controller.playMontage('missing')).toThrow(/Unknown animation clip 'missing'/);
    });
});
