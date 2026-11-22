import { afterEach, describe, expect, it } from 'vitest';
import { Animator } from '../components/animator';
import { sceneAnimationClipAssets } from '../scene-animation-clip-assets';

const makeClip = (id: string) => ({
    id,
    duration: 1,
    tracks: [
        {
            targetNodeId: 'node/1',
            path: 'translation' as const,
            times: [0, 1],
            values: [0, 0, 0, 1, 0, 0],
        },
    ],
});

describe('Animator clip asset references', () => {
    afterEach(() => {
        sceneAnimationClipAssets.clear();
    });

    it('resolves referenced clips into the animator definitions', () => {
        sceneAnimationClipAssets.register({
            id: 'test/locomotion',
            clips: [makeClip('walk'), makeClip('run')],
        });

        const animator = new Animator({ clipAssetIds: ['test/locomotion'] });
        animator.clipId = 'run';

        expect(animator.clipId).toBe('run');
    });

    it('serializes the reference, not the keyframes', () => {
        sceneAnimationClipAssets.register({
            id: 'test/locomotion',
            clips: [makeClip('walk'), makeClip('run')],
        });

        const animator = new Animator({ clipAssetIds: ['test/locomotion'] });
        const data = animator.serialize();

        expect(data.clips).toEqual([]);
        expect(data.clipAssetIds).toEqual(['test/locomotion']);
    });

    it('round-trips the reference through deserialize', () => {
        sceneAnimationClipAssets.register({
            id: 'test/locomotion',
            clips: [makeClip('walk')],
        });

        const animator = new Animator();
        animator.deserialize({ clips: [], clipAssetIds: ['test/locomotion'] });
        animator.clipId = 'walk';

        expect(animator.clipId).toBe('walk');
        expect(animator.serialize().clipAssetIds).toEqual(['test/locomotion']);
    });

    it('keeps inline clips alongside referenced ones', () => {
        sceneAnimationClipAssets.register({
            id: 'test/locomotion',
            clips: [makeClip('walk')],
        });

        const animator = new Animator({
            clips: [makeClip('inline')],
            clipAssetIds: ['test/locomotion'],
        });

        animator.clipId = 'walk';
        expect(animator.clipId).toBe('walk');

        animator.clipId = 'inline';
        expect(animator.clipId).toBe('inline');

        const data = animator.serialize();
        expect((data.clips as Array<{ id: string }>).map((clip) => clip.id)).toEqual(['inline']);
        expect(data.clipAssetIds).toEqual(['test/locomotion']);
    });

    it('ignores unknown asset ids', () => {
        const animator = new Animator({ clipAssetIds: ['test/missing'] });

        expect(animator.clipId).toBeNull();
    });
});
