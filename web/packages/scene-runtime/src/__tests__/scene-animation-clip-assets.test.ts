import { describe, expect, it } from 'vitest';
import {
    SceneAnimationClipAssetLibrary,
    resolveAnimationClipAssets,
} from '../scene-animation-clip-assets';

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

describe('SceneAnimationClipAssetLibrary', () => {
    it('registers and resolves clip assets', () => {
        const library = new SceneAnimationClipAssetLibrary();
        library.register({ id: 'locomotion', clips: [makeClip('walk'), makeClip('run')] });

        expect(library.size).toBe(1);
        expect(library.has('locomotion')).toBe(true);
        expect(library.get('locomotion')).toHaveLength(2);
        expect(library.get('missing')).toBeUndefined();
    });

    it('replaces an asset on re-register and unregisters', () => {
        const library = new SceneAnimationClipAssetLibrary();
        library.register({ id: 'locomotion', clips: [makeClip('walk')] });
        library.register({ id: 'locomotion', clips: [makeClip('run')] });

        expect(library.get('locomotion')?.map((clip) => clip.id)).toEqual(['run']);
        expect(library.unregister('locomotion')).toBe(true);
        expect(library.size).toBe(0);
    });

    it('rejects an empty id', () => {
        const library = new SceneAnimationClipAssetLibrary();

        expect(() => library.register({ id: '', clips: [] })).toThrow(/non-empty id/);
    });
});

describe('resolveAnimationClipAssets', () => {
    it('resolves references in order and skips unknown ids', () => {
        const library = new SceneAnimationClipAssetLibrary();
        library.register({ id: 'locomotion', clips: [makeClip('walk'), makeClip('run')] });
        library.register({ id: 'combat', clips: [makeClip('attack')] });

        const clips = resolveAnimationClipAssets(
            ['missing', 'locomotion', { assetId: 'combat' }],
            library
        );

        expect(clips.map((clip) => clip.id)).toEqual(['walk', 'run', 'attack']);
    });

    it('keeps the first clip when two assets define the same id', () => {
        const library = new SceneAnimationClipAssetLibrary();
        library.register({ id: 'first', clips: [makeClip('walk')] });
        library.register({ id: 'second', clips: [makeClip('walk'), makeClip('run')] });

        const clips = resolveAnimationClipAssets(['first', 'second'], library);

        expect(clips.map((clip) => clip.id)).toEqual(['walk', 'run']);
    });

    it('returns an empty list for no references', () => {
        const library = new SceneAnimationClipAssetLibrary();

        expect(resolveAnimationClipAssets([], library)).toHaveLength(0);
    });
});
