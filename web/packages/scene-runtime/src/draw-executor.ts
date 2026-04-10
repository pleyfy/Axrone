import type { SceneCameraFrameState } from './camera-frame-state';
import type { SceneLightingState } from './lighting-collector';
import type { SceneMaterialResource } from './material-registry';
import type { SceneMeshResource } from './mesh-registry';
import type { SceneMorphMeshRuntime } from './morph-mesh-runtime';
import type { SceneRenderFrameState } from './render-frame-state';
import type { SceneRenderItem } from './render-item-collector';
import type { SceneRenderPassResource } from './render-pass-registry';
import type { SceneRenderStateApplier } from './render-state-applier';
import type { SceneShaderResource } from './shader-registry';
import type { SceneFrameUniformBinder } from './frame-uniform-binder';
import type { SceneLightingUniformBinder } from './lighting-uniform-binder';
import type {
    SceneMaterialTextureBinder,
    SceneMaterialTextureUniformSetter,
} from './material-texture-binder';
import type { SceneSkinningUniformBinder } from './skinning-uniform-binder';
import type { SceneUniformWriteTarget } from './uniform-writer';
import type { SceneUniformValue } from './types';

export interface SceneDrawExecutorContext {
    readonly renderPass: SceneRenderPassResource;
    readonly cameraFrame: SceneCameraFrameState;
    readonly lighting: SceneLightingState;
    readonly elapsedSeconds: number;
    readonly deltaSeconds: number;
    readonly frame: number;
    readonly viewportWidth: number;
    readonly viewportHeight: number;
}

interface SceneDrawExecutorResources {
    readonly materials: {
        get(id: string): SceneMaterialResource | undefined;
        getTextureSlots(materialId: string): readonly {
            readonly uniformName: string;
            readonly binding: {
                readonly textureId: string;
                readonly samplerId: string | null;
            };
            readonly resolvedUnit: number;
        }[];
    };
    readonly meshes: {
        get(id: string): SceneMeshResource | undefined;
        getDefinition(id: string): import('./types').SceneMeshDefinition | undefined;
    };
    readonly shaders: {
        get(id: string): SceneShaderResource | undefined;
    };
    readonly textures: {
        get(textureId: string): import('./texture-registry').SceneTextureResource | undefined;
    };
    resolveSampler(id: string | null): import('@axrone/render-webgl2').ITextureSampler;
}

interface SceneDrawExecutorDependencies {
    readonly gl: WebGL2RenderingContext;
    readonly resources: SceneDrawExecutorResources;
    readonly morphMeshRuntime: Pick<SceneMorphMeshRuntime, 'resolve'>;
    readonly renderStateApplier: Pick<SceneRenderStateApplier, 'apply'>;
    readonly frameUniformBinder: Pick<SceneFrameUniformBinder, 'apply'>;
    readonly lightingUniformBinder: Pick<SceneLightingUniformBinder, 'apply'>;
    readonly skinningUniformBinder: Pick<SceneSkinningUniformBinder, 'apply'>;
    readonly materialTextureBinder: Pick<SceneMaterialTextureBinder, 'bind' | 'unbind'>;
    readonly uniformWriter: SceneUniformWriteTarget;
    readonly textureUniformSetter: SceneMaterialTextureUniformSetter;
    readonly applyMissingVertexAttributeDefaults: (mesh: SceneMeshResource) => void;
}

export class SceneDrawExecutor {
    constructor(private readonly _dependencies: SceneDrawExecutorDependencies) {}

    execute(
        item: SceneRenderItem,
        context: SceneDrawExecutorContext,
        frameState: SceneRenderFrameState
    ): void {
        if (item.renderer.meshId === null || item.renderer.materialId === null) {
            return;
        }

        const mesh = this._dependencies.morphMeshRuntime.resolve(
            item.renderer,
            this._dependencies.resources.meshes
        );
        const material = this._dependencies.resources.materials.get(item.renderer.materialId);

        if (!mesh || !material) {
            return;
        }

        frameState.markActiveRenderer(item.renderer.id);

        const shader = this._dependencies.resources.shaders.get(material.shaderId);
        if (!shader) {
            return;
        }

        this._dependencies.renderStateApplier.apply(shader, context.renderPass);
        this._dependencies.gl.useProgram(shader.program);
        this._dependencies.gl.bindVertexArray(mesh.vertexArray);
        this._dependencies.applyMissingVertexAttributeDefaults(mesh);

        this._dependencies.frameUniformBinder.apply(shader, {
            modelMatrix: item.transform.worldMatrix,
            viewMatrix: context.cameraFrame.viewMatrix,
            projectionMatrix: context.cameraFrame.projectionMatrix,
            viewProjectionMatrix: context.cameraFrame.viewProjectionMatrix,
            cameraPosition: context.cameraFrame.position,
            elapsedSeconds: context.elapsedSeconds,
            deltaSeconds: context.deltaSeconds,
            frame: context.frame,
            viewportWidth: context.viewportWidth,
            viewportHeight: context.viewportHeight,
        });
        this._dependencies.lightingUniformBinder.apply(shader, item.renderer, context.lighting);
        this._dependencies.skinningUniformBinder.apply(shader, item.renderer);

        this._dependencies.materialTextureBinder.bind(
            shader,
            material,
            this._dependencies.resources,
            this._dependencies.textureUniformSetter
        );

        for (const [name, value] of material.uniforms) {
            this._dependencies.uniformWriter.write(shader, name, value);
        }

        for (const [name, value] of item.renderer.getUniformEntries()) {
            this._dependencies.uniformWriter.write(
                shader,
                name,
                value as SceneUniformValue | null | undefined
            );
        }

        if (mesh.indexBuffer && mesh.indexType !== null && mesh.indexCount > 0) {
            this._dependencies.gl.drawElements(mesh.mode, mesh.indexCount, mesh.indexType, 0);
        } else {
            this._dependencies.gl.drawArrays(mesh.mode, 0, mesh.vertexCount);
        }

        frameState.recordDraw(mesh);
        this._dependencies.materialTextureBinder.unbind();
    }
}
