import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Mat4, Vec3 } from '@axrone/numeric';
import { Actor, Transform, World } from '@axrone/ecs-runtime';
import {
    createMockGL,
    installWebGL2Constants,
} from '../../../../tests/shared/test-harness';
import { BillboardRenderer } from '../components/billboard-renderer';
import { SceneBillboardBatchRuntime } from '../rendering/billboard-batch-runtime';
import { SceneRenderFrameState } from '../rendering/render-frame-state';
import type { SceneCameraFrameState } from '../camera-frame-state';
import { createSceneRegistry } from '../scene-registry';

installWebGL2Constants();

type MockGL = ReturnType<typeof createMockGL> & {
    drawElements: ReturnType<typeof vi.fn>;
    bufferData: ReturnType<typeof vi.fn>;
};

const createCameraFrame = (): SceneCameraFrameState =>
    ({
        viewProjectionMatrix: new Mat4(),
        position: new Vec3(0, 0, 5),
    }) as unknown as SceneCameraFrameState;

describe('SceneBillboardBatchRuntime batching', () => {
    let gl: MockGL;
    let world: World;

    beforeEach(() => {
        const canvas = document.createElement('canvas');
        gl = createMockGL(canvas) as unknown as MockGL;
        // The shared mock lacks a few entry points the batch runtime uses.
        const extra: Record<string, unknown> = {
            blendEquation: vi.fn(),
            getExtension: vi.fn(() => null),
        };
        for (const [key, value] of Object.entries(extra)) {
            if ((gl as unknown as Record<string, unknown>)[key] === undefined) {
                (gl as unknown as Record<string, unknown>)[key] = value;
            }
        }
        world = new World(createSceneRegistry());
    });

    const addBillboard = (options: { x?: number; depthWrite?: boolean } = {}): Actor => {
        const actor = new Actor(world);
        actor.getComponent(Transform)!.position = new Vec3(options.x ?? 0, 0, 0);
        actor.addComponent(BillboardRenderer, {
            width: 1,
            height: 1,
            ...(options.depthWrite !== undefined ? { depthWrite: options.depthWrite } : {}),
        });
        return actor;
    };

    const createRuntime = (): SceneBillboardBatchRuntime =>
        new SceneBillboardBatchRuntime({
            gl: gl as unknown as WebGL2RenderingContext,
            uniformWriter: { write: vi.fn() },
            renderStateApplier: { reset: vi.fn() },
        });

    const renderAll = (runtime: SceneBillboardBatchRuntime, actors: readonly Actor[]) => {
        const frameState = new SceneRenderFrameState().begin(1);
        const stats = runtime.render({
            actors,
            cameraFrame: createCameraFrame(),
            frameState,
        });
        return { stats, frameState };
    };

    it('collapses billboards with identical state into a single draw', () => {
        const runtime = createRuntime();
        const actors = [addBillboard({ x: -1 }), addBillboard(), addBillboard({ x: 1 })];

        const { stats, frameState } = renderAll(runtime, actors);

        expect(stats.drawnBillboardCount).toBe(3);
        expect(stats.totalVertexCount).toBe(12);
        expect(stats.totalIndexCount).toBe(18);
        expect(gl.drawElements).toHaveBeenCalledTimes(1);
        // One vertex upload + one index upload for the whole run
        expect(gl.bufferData).toHaveBeenCalledTimes(2);
        expect(frameState.drawCalls).toBe(1);
        expect(frameState.trianglesSubmitted).toBe(6);
    });

    it('splits runs when per-subject state differs, preserving order', () => {
        const runtime = createRuntime();
        const actors = [
            addBillboard({ depthWrite: true }),
            addBillboard({ depthWrite: false }),
            addBillboard({ depthWrite: true }),
        ];

        const { stats } = renderAll(runtime, actors);

        expect(stats.drawnBillboardCount).toBe(3);
        expect(stats.totalVertexCount).toBe(12);
        expect(gl.drawElements).toHaveBeenCalledTimes(3);
    });

    it('skips degenerate billboards without issuing draws', () => {
        const runtime = createRuntime();
        const actor = new Actor(world);
        actor.addComponent(BillboardRenderer, { width: 0, height: 1 });

        const { stats } = renderAll(runtime, [actor]);

        expect(stats.drawnBillboardCount).toBe(0);
        expect(gl.drawElements).not.toHaveBeenCalled();
    });
});
