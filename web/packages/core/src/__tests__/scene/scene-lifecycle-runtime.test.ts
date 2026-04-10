import { describe, expect, it, vi } from 'vitest';
import type { GameLoop } from '../../game-loop';
import { SceneLifecycleError } from '@axrone/scene-3d';
import { SceneLifecycleRuntime } from '@axrone/scene-3d';
import { createMockGL } from './test-harness';

const createLoop = (): GameLoop<any> =>
    ({
        status: 'stopped',
        start: vi.fn(),
        pause: vi.fn(),
        resume: vi.fn(),
        stop: vi.fn(),
        dispose: vi.fn(),
    }) as unknown as GameLoop<any>;

describe('SceneLifecycleRuntime', () => {
    it('resizes the canvas through one lifecycle boundary', () => {
        const canvas = document.createElement('canvas');
        const gl = createMockGL(canvas);
        const runtime = new SceneLifecycleRuntime({
            canvas,
            gl,
            loop: createLoop(),
            autoCreatedCanvas: false,
            pixelRatio: 2,
            defaultWidth: 320,
            defaultHeight: 180,
            render: vi.fn(),
            disposeAssets: vi.fn(),
            disposeWorld: vi.fn(),
        });

        runtime.resize(200, 100);

        expect(canvas.width).toBe(400);
        expect(canvas.height).toBe(200);
        expect(canvas.style.width).toBe('200px');
        expect(canvas.style.height).toBe('100px');
        expect(gl.viewport).toHaveBeenCalledWith(0, 0, 400, 200);
    });

    it('disposes loop-owned and DOM-owned resources exactly once', () => {
        const parent = document.createElement('div');
        const canvas = document.createElement('canvas');
        parent.appendChild(canvas);
        const gl = createMockGL(canvas);
        const loop = createLoop();
        const disposeAssets = vi.fn();
        const disposeWorld = vi.fn();
        const runtime = new SceneLifecycleRuntime({
            canvas,
            gl,
            loop,
            autoCreatedCanvas: true,
            pixelRatio: 1,
            defaultWidth: 320,
            defaultHeight: 180,
            render: vi.fn(),
            disposeAssets,
            disposeWorld,
        });

        runtime.dispose();
        runtime.dispose();

        expect(loop.dispose).toHaveBeenCalledTimes(1);
        expect(disposeAssets).toHaveBeenCalledTimes(1);
        expect(disposeWorld).toHaveBeenCalledTimes(1);
        expect(parent.contains(canvas)).toBe(false);
        expect(runtime.isDisposed).toBe(true);
    });

    it('rejects lifecycle calls after disposal', () => {
        const canvas = document.createElement('canvas');
        const gl = createMockGL(canvas);
        const runtime = new SceneLifecycleRuntime({
            canvas,
            gl,
            loop: createLoop(),
            autoCreatedCanvas: false,
            pixelRatio: 1,
            defaultWidth: 320,
            defaultHeight: 180,
            render: vi.fn(),
            disposeAssets: vi.fn(),
            disposeWorld: vi.fn(),
        });

        runtime.dispose();

        expect(() => runtime.start()).toThrow(SceneLifecycleError);
    });
});
