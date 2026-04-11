import { Vec3, Vec4 } from '@axrone/numeric';
import type { Actor } from '@axrone/ecs-runtime';
import { selectSceneCamera } from './camera-selector';
import { SceneCameraFrameStateCollector } from './camera-frame-state';
import { SceneDrawExecutionContextCache } from './draw-execution-context';
import { SceneDrawExecutor } from './draw-executor';
import { SceneFrameUniformBinder } from './frame-uniform-binder';
import { SceneLightingCollector } from './lighting-collector';
import { SceneLightingUniformBinder } from './lighting-uniform-binder';
import { SceneMaterialTextureBinder } from './material-texture-binder';
import { SceneMorphMeshRuntime } from './morph-mesh-runtime';
import { SceneRenderFrameState } from './render-frame-state';
import { SceneRenderItemCollector } from './render-item-collector';
import { SceneRenderPassPreparer } from './render-pass-preparer';
import { SceneRenderStateApplier } from './render-state-applier';
import type { SceneResourceRuntime } from './scene-resource-runtime';
import { SceneSkinningUniformBinder } from './skinning-uniform-binder';
import type { SceneMeshResource } from './mesh-registry';
import type { SceneMeshDefinition, SceneRenderStats, SceneUniformValue } from './types';
import { SceneUniformWriter } from './uniform-writer';

export interface SceneRenderRuntimeOptions {
    readonly gl: WebGL2RenderingContext;
    readonly resources: SceneResourceRuntime;
    readonly ambientLight: Vec3;
    readonly defaultClearColor: Vec4;
    readonly getActors: () => readonly Actor[];
    readonly createMeshResource: (definition: SceneMeshDefinition) => SceneMeshResource;
    readonly disposeMesh: (mesh: SceneMeshResource) => void;
    readonly applyMissingVertexAttributeDefaults: (mesh: SceneMeshResource) => void;
}

export interface SceneRenderRuntimeParams {
    readonly frame: number;
    readonly elapsedSeconds: number;
    readonly deltaSeconds: number;
    readonly viewportWidth: number;
    readonly viewportHeight: number;
}

export class SceneRenderRuntime {
    private readonly _lightingCollector: SceneLightingCollector;
    private readonly _cameraFrameCollector = new SceneCameraFrameStateCollector();
    private readonly _renderItemCollector = new SceneRenderItemCollector();
    private readonly _renderFrameState = new SceneRenderFrameState();
    private readonly _drawExecutionContextCache = new SceneDrawExecutionContextCache();
    private readonly _materialTextureBinder: SceneMaterialTextureBinder;
    private readonly _renderPassPreparer: SceneRenderPassPreparer;
    private readonly _renderStateApplier: SceneRenderStateApplier;
    private readonly _uniformWriter: SceneUniformWriter;
    private readonly _frameUniformBinder: SceneFrameUniformBinder;
    private readonly _lightingUniformBinder: SceneLightingUniformBinder;
    private readonly _skinningUniformBinder: SceneSkinningUniformBinder;
    private readonly _morphMeshRuntime: SceneMorphMeshRuntime;
    private readonly _drawExecutor: SceneDrawExecutor;
    private readonly _textureUniformSetter = (
        shader: Parameters<SceneUniformWriter['write']>[0],
        name: string,
        value: SceneUniformValue | null | undefined
    ): void => {
        this._uniformWriter.write(shader, name, value);
    };

    constructor(private readonly _options: SceneRenderRuntimeOptions) {
        this._lightingCollector = new SceneLightingCollector(4);
        this._materialTextureBinder = new SceneMaterialTextureBinder(_options.gl);
        this._renderPassPreparer = new SceneRenderPassPreparer(
            _options.gl,
            _options.defaultClearColor
        );
        this._renderStateApplier = new SceneRenderStateApplier(_options.gl);
        this._uniformWriter = new SceneUniformWriter(_options.gl);
        this._frameUniformBinder = new SceneFrameUniformBinder(this._uniformWriter);
        this._lightingUniformBinder = new SceneLightingUniformBinder(this._uniformWriter);
        this._skinningUniformBinder = new SceneSkinningUniformBinder(this._uniformWriter);
        this._morphMeshRuntime = new SceneMorphMeshRuntime({
            gl: _options.gl,
            createMeshResource: _options.createMeshResource,
            disposeMesh: _options.disposeMesh,
        });
        this._drawExecutor = new SceneDrawExecutor({
            gl: _options.gl,
            resources: _options.resources,
            morphMeshRuntime: this._morphMeshRuntime,
            renderStateApplier: this._renderStateApplier,
            frameUniformBinder: this._frameUniformBinder,
            lightingUniformBinder: this._lightingUniformBinder,
            skinningUniformBinder: this._skinningUniformBinder,
            materialTextureBinder: this._materialTextureBinder,
            uniformWriter: this._uniformWriter,
            textureUniformSetter: this._textureUniformSetter,
            applyMissingVertexAttributeDefaults: _options.applyMissingVertexAttributeDefaults,
        });
    }

    get stats(): SceneRenderStats {
        return {
            frame: this._renderFrameState.frame,
            drawCalls: this._renderFrameState.drawCalls,
            trianglesSubmitted: this._renderFrameState.trianglesSubmitted,
        };
    }

    render(params: SceneRenderRuntimeParams): void {
        const renderFrame = this._renderFrameState.begin(params.frame);
        const actors = this._options.getActors();
        const camera = selectSceneCamera(actors);
        const lighting = this._lightingCollector.collect(actors, this._options.ambientLight);
        const renderPasses = this._options.resources.renderPasses.getEnabledResources();

        if (renderPasses.length === 0) {
            return;
        }

        const cameraFrame = this._cameraFrameCollector.collect(
            camera,
            params.viewportWidth,
            params.viewportHeight
        );
        this._options.gl.viewport(0, 0, params.viewportWidth, params.viewportHeight);

        for (const renderPass of renderPasses) {
            this._renderPassPreparer.prepare(renderPass, cameraFrame?.camera);

            if (!cameraFrame) {
                continue;
            }

            const drawContext = this._drawExecutionContextCache.prepare({
                renderPass,
                cameraFrame,
                lighting,
                elapsedSeconds: params.elapsedSeconds,
                deltaSeconds: params.deltaSeconds,
                frame: params.frame,
                viewportWidth: params.viewportWidth,
                viewportHeight: params.viewportHeight,
            });

            const renderItems = this._renderItemCollector.collect(
                actors,
                renderPass.rendererPassId
            );
            for (const item of renderItems) {
                this._drawExecutor.execute(item, drawContext, renderFrame);
            }
        }

        this._options.gl.bindVertexArray(null);
        this._morphMeshRuntime.prune(renderFrame.activeRendererIds);
    }

    releaseBaseMesh(meshId: string): void {
        this._morphMeshRuntime.releaseBaseMesh(meshId);
    }

    clear(): void {
        this._morphMeshRuntime.clear();
    }
}
