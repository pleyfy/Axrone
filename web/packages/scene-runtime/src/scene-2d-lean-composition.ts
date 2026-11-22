import type { SceneBatchRuntimeFactory } from './rendering/batch-runtime-contract';
import { SceneSpriteBatchRuntime } from './rendering/sprite-batch-runtime';

/**
 * Render batch composition for the lean 2D scene.
 *
 * A lean 2D registry exposes `Camera` + `SpriteRenderer` only, so the scene can
 * never produce particles, lines or billboards. Injecting the sprite family
 * alone keeps the particle/line/billboard runtimes (and the `particle-system`
 * component chain) out of the lean 2D module graph while preserving the
 * sprite drawing path.
 */
export const createLean2DSceneBatchRuntimes: SceneBatchRuntimeFactory = (
    context
) => ({
    sprite: new SceneSpriteBatchRuntime({
        gl: context.gl,
        resources: context.resources,
        renderStateApplier: context.renderStateApplier,
        uniformWriter: context.uniformWriter,
        materialTextureBinder: context.materialTextureBinder,
        textureUniformSetter: context.textureUniformSetter,
        stateCache: context.stateCache,
    }),
});
