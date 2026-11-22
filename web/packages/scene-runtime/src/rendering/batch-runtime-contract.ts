import type { IGLStateCache } from '@axrone/render-webgl2';
import type { SceneMaterialTextureBinder } from '../material-texture-binder';
import type { SceneMaterialTextureUniformSetter } from '../material-texture-binder';
import type { SceneResourceRuntime } from '../scene-resource-runtime';
import type { SceneUniformWriter } from '../uniform-writer';
import type { SceneBillboardBatchRuntime } from './billboard-batch-runtime';
import type { SceneLineBatchRuntime } from './line-batch-runtime';
import type { SceneParticleBatchRuntime } from './particle-batch-runtime';
import type { SceneRenderStateApplier } from './render-state-applier';
import type { SceneSpriteBatchRuntime } from './sprite-batch-runtime';

/**
 * Dependencies every optional render batch family needs.
 *
 * The render runtime owns these helpers and passes them to the injected
 * factory, so a composition module can construct only the families its scene
 * profile can actually produce. `scene-render-runtime.ts` keeps no static
 * value import of the batch classes: a lean entry that omits a family never
 * ships its component/runtime chunk.
 */
export interface SceneBatchRuntimeFactoryContext {
    readonly gl: WebGL2RenderingContext;
    readonly resources: SceneResourceRuntime;
    readonly renderStateApplier: SceneRenderStateApplier;
    readonly uniformWriter: SceneUniformWriter;
    readonly materialTextureBinder: SceneMaterialTextureBinder;
    readonly textureUniformSetter: SceneMaterialTextureUniformSetter;
    readonly stateCache?: IGLStateCache;
}

/**
 * Optional render families. A family that is absent is skipped by the render
 * pipeline even when the scene registry could produce it; root scene entries
 * inject the full set, lean entries inject only the families they expose.
 */
export interface SceneBatchRuntimeSet {
    readonly sprite?: SceneSpriteBatchRuntime | null;
    readonly particle?: SceneParticleBatchRuntime | null;
    readonly line?: SceneLineBatchRuntime | null;
    readonly billboard?: SceneBillboardBatchRuntime | null;
}

export type SceneBatchRuntimeFactory = (
    context: SceneBatchRuntimeFactoryContext
) => SceneBatchRuntimeSet;
