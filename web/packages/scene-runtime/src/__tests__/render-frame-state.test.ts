import { describe, expect, it } from 'vitest';
import { SceneRenderFrameState } from '../rendering/render-frame-state';

describe('SceneRenderFrameState active renderer tracking', () => {
    it('tracks active renderers by default and resets each frame', () => {
        const state = new SceneRenderFrameState().begin(1);
        state.markActiveRenderer('a');
        expect(state.tracksActiveRenderers).toBe(true);
        expect([...state.activeRendererIds]).toEqual(['a']);

        state.begin(2);
        expect(state.activeRendererIds.size).toBe(0);
        expect(state.tracksActiveRenderers).toBe(true);
    });

    it('can skip active renderer tracking for scenes without morph caches', () => {
        const state = new SceneRenderFrameState().begin(1);
        state.markActiveRenderer('a');
        state.setTrackActiveRenderers(false);
        expect(state.tracksActiveRenderers).toBe(false);
        expect(state.activeRendererIds.size).toBe(0);

        state.markActiveRenderer('b');
        expect(state.activeRendererIds.size).toBe(0);
    });
});
