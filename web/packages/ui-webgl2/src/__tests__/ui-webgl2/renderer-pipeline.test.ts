import { describe, expect, it, vi } from 'vitest';
import { attachUIOverlayToScene, createManagedWebGL2UIOverlayRenderPipelineBackend, createUIOverlayRenderPipelineBackend } from '../../index';
import { createGameLoop } from '@axrone/game-loop';
import { createMetrics, createFrame, createMockWebGL2Context } from './support/ui-webgl2-harness';

describe('renderer pipeline integration', () => {
    it('decorates the pipeline backend and renders UI after the base backend ends the frame', async () => {
        const order: string[] = [];
        const frame = createFrame();
        const ui = vi.fn(() => frame);
        const renderer = {
            render: vi.fn(() => {
                order.push('ui');
            }),
        };
        const backend = createUIOverlayRenderPipelineBackend({
            base: {
                beginFrame: vi.fn(async () => {
                    order.push('begin');
                }),
                executePass: vi.fn(async () => {
                    order.push('pass');
                }),
                endFrame: vi.fn(async () => {
                    order.push('base-end');
                }),
            },
            renderer,
            ui,
        });
        const context = {
            viewport: { width: 320, height: 180 },
        } as Parameters<NonNullable<typeof backend.beginFrame>>[0];

        await backend.beginFrame?.(context);
        await backend.executePass?.({} as never, context);
        await backend.endFrame?.({} as never, context);

        expect(order).toEqual(['begin', 'pass', 'base-end', 'ui']);
        expect(ui).toHaveBeenCalledWith({ width: 320, height: 180 });
        expect(renderer.render).toHaveBeenCalledWith(frame);
    });

    it('lazily creates, reuses, and disposes managed renderers across WebGL context changes', async () => {
        const glA = createMockWebGL2Context();
        const glB = createMockWebGL2Context();
        const frame = createFrame();
        const backend = createManagedWebGL2UIOverlayRenderPipelineBackend({
            ui: () => frame,
            getGL: ({ context }) => (context.frame < 2 ? glA : glB),
        });
        const contextFor = (frameIndex: number) =>
            ({
                frame: frameIndex,
                viewport: { width: 160, height: 120 },
            }) as Parameters<NonNullable<typeof backend.endFrame>>[1];
        const result = {
            frame: 0,
            viewport: { width: 160, height: 120 },
            passes: [],
            resources: [],
            statistics: createMetrics() as never,
            degraded: false,
            warnings: [],
        } as Parameters<NonNullable<typeof backend.endFrame>>[0];

        await backend.endFrame?.(result, contextFor(0));
        await backend.endFrame?.(result, contextFor(1));

        expect(glA.createProgram).toHaveBeenCalledTimes(3);
        expect(glA.deleteProgram).not.toHaveBeenCalled();

        await backend.endFrame?.(result, contextFor(2));

        expect(glB.createProgram).toHaveBeenCalledTimes(3);
        expect(glA.deleteProgram).toHaveBeenCalledTimes(3);

        backend.dispose();

        expect(glB.deleteProgram).toHaveBeenCalledTimes(3);
    });

    it('attaches UI rendering to the scene after-frame hook', () => {
        const gl = createMockWebGL2Context();
        const loop = createGameLoop({
            state: { sceneId: 'scene:test' },
            autoStart: false,
        });
        const frame = createFrame();
        const overlay = attachUIOverlayToScene(
            {
                gl,
                canvas: { width: 320, height: 180 } as HTMLCanvasElement,
                loop,
            },
            {
                systemId: 'ui.overlay.test',
                ui: () => frame,
            }
        );
        const system = loop.getSystem('ui.overlay.test');

        expect(system).toBeDefined();
        system?.afterFrame?.({} as never);

        expect(gl.drawArraysInstanced).toHaveBeenCalledTimes(2);
        expect(overlay.render()).toBe(frame);

        overlay.dispose();

        expect(loop.getSystem('ui.overlay.test')).toBeUndefined();
        expect(gl.deleteProgram).toHaveBeenCalledTimes(3);
    });

});
