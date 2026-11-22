import type {
    SceneBatchRuntimeFactory,
    SceneBatchRuntimeSet,
} from './rendering/batch-runtime-contract';
import { SceneBillboardBatchRuntime } from './rendering/billboard-batch-runtime';
import { SceneLineBatchRuntime } from './rendering/line-batch-runtime';
import { SceneParticleBatchRuntime } from './rendering/particle-batch-runtime';
import { SceneSpriteBatchRuntime } from './rendering/sprite-batch-runtime';

/**
 * Full render batch composition used by the root `Scene` / `Scene2D` entries.
 *
 * This module is deliberately separate from the render runtime so lean scene
 * entries can omit it: importing this entry is what retains sprite, particle,
 * line and billboard batch runtimes (and their component families).
 */
export const createFullSceneBatchRuntimes: SceneBatchRuntimeFactory = (
    context
): SceneBatchRuntimeSet => ({
    sprite: new SceneSpriteBatchRuntime({
        gl: context.gl,
        resources: context.resources,
        renderStateApplier: context.renderStateApplier,
        uniformWriter: context.uniformWriter,
        materialTextureBinder: context.materialTextureBinder,
        textureUniformSetter: context.textureUniformSetter,
        stateCache: context.stateCache,
    }),
    particle: new SceneParticleBatchRuntime({
        gl: context.gl,
        uniformWriter: context.uniformWriter,
        renderStateApplier: context.renderStateApplier,
        stateCache: context.stateCache,
    }),
    line: new SceneLineBatchRuntime({
        gl: context.gl,
        uniformWriter: context.uniformWriter,
        renderStateApplier: context.renderStateApplier,
        stateCache: context.stateCache,
    }),
    billboard: new SceneBillboardBatchRuntime({
        gl: context.gl,
        uniformWriter: context.uniformWriter,
        renderStateApplier: context.renderStateApplier,
        stateCache: context.stateCache,
    }),
});

export type {
    SceneBatchRuntimeFactory,
    SceneBatchRuntimeFactoryContext,
    SceneBatchRuntimeSet,
} from './rendering/batch-runtime-contract';
