import type { SceneCameraFrameState } from './camera-frame-state';
import type { SceneDrawExecutorContext } from './draw-executor';
import type { SceneLightingState } from './lighting-collector';
import type { SceneRenderPassResource } from './render-pass-registry';

type MutableSceneDrawExecutorContext = {
    -readonly [K in keyof SceneDrawExecutorContext]: SceneDrawExecutorContext[K];
};

export class SceneDrawExecutionContextCache {
    private readonly _context: MutableSceneDrawExecutorContext = {
        renderPass: null as unknown as SceneRenderPassResource,
        cameraFrame: null as unknown as SceneCameraFrameState,
        lighting: null as unknown as SceneLightingState,
        elapsedSeconds: 0,
        deltaSeconds: 0,
        frame: 0,
        viewportWidth: 0,
        viewportHeight: 0,
    };

    prepare(context: SceneDrawExecutorContext): SceneDrawExecutorContext {
        this._context.renderPass = context.renderPass;
        this._context.cameraFrame = context.cameraFrame;
        this._context.lighting = context.lighting;
        this._context.elapsedSeconds = context.elapsedSeconds;
        this._context.deltaSeconds = context.deltaSeconds;
        this._context.frame = context.frame;
        this._context.viewportWidth = context.viewportWidth;
        this._context.viewportHeight = context.viewportHeight;
        return this._context;
    }
}
