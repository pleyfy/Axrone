import { describe, expect, it, vi } from 'vitest';
import { resolveSceneSurface } from '@axrone/scene-3d';
import { SceneCanvasError } from '@axrone/scene-3d';

describe('resolveSceneSurface', () => {
    it('creates and appends a canvas when the caller provides a canvas factory', () => {
        const canvas = document.createElement('canvas');
        const gl = {} as WebGL2RenderingContext;
        Object.defineProperty(canvas, 'getContext', {
            value: vi.fn(() => gl),
            configurable: true,
        });

        const surface = resolveSceneSurface({
            createCanvas: () => canvas,
            appendToDom: false,
        });

        expect(surface.canvas).toBe(canvas);
        expect(surface.gl).toBe(gl);
        expect(surface.autoCreated).toBe(true);
    });

    it('throws when no WebGL2 context can be created', () => {
        const canvas = document.createElement('canvas');
        Object.defineProperty(canvas, 'getContext', {
            value: vi.fn(() => null),
            configurable: true,
        });

        expect(() =>
            resolveSceneSurface({
                canvas,
            })
        ).toThrowError(SceneCanvasError);
    });
});
