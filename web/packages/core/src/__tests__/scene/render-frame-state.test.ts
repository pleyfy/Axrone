import { describe, expect, it } from 'vitest';
import { SceneRenderFrameState } from '../../scene/render-frame-state';

describe('SceneRenderFrameState', () => {
    it('reuses active renderer tracking and resets counters between frames', () => {
        const state = new SceneRenderFrameState();

        const first = state.begin(12);
        first.markActiveRenderer('renderer-a');
        first.recordDraw({
            topology: 'triangles',
            indexCount: 6,
            vertexCount: 4,
        } as any);
        first.recordDraw({
            topology: 'lines',
            indexCount: 0,
            vertexCount: 10,
        } as any);

        const activeIds = first.activeRendererIds;

        expect(first.frame).toBe(12);
        expect(first.drawCalls).toBe(2);
        expect(first.trianglesSubmitted).toBe(2);
        expect([...activeIds]).toEqual(['renderer-a']);

        const second = state.begin(13);

        expect(second).toBe(first);
        expect(second.activeRendererIds).toBe(activeIds);
        expect(second.frame).toBe(13);
        expect(second.drawCalls).toBe(0);
        expect(second.trianglesSubmitted).toBe(0);
        expect([...second.activeRendererIds]).toEqual([]);
    });
});
