import type { LightingUniformValueMap } from '@axrone/lighting';
import { Mat4 } from '@axrone/numeric';
import type { SceneCameraFrameState } from '../camera-frame-state';
import type { SceneFogState } from '../fog-state';
import type { SceneLightingState } from '../lighting-collector';
import { resolveSceneMaterialPass, type SceneMaterialResource } from '../material-registry';
import type { SceneMeshResource } from '../mesh-registry';
import type { SceneMorphMeshRuntime } from '../morph-mesh-runtime';
import type { SceneRenderFrameState } from './render-frame-state';
import type { SceneRenderItem } from './render-item-collector';
import type { SceneRenderPassResource } from './render-pass-registry';
import type { SceneRenderStateApplier } from './render-state-applier';
import type { SceneShaderResource } from '../shader-registry';
import type { SceneFrameUniformBinder } from '../frame-uniform-binder';
import type { SceneLightingUniformBinder } from '../lighting-uniform-binder';
import type { SceneFogUniformBinder } from '../fog-uniform-binder';
import type {
    SceneMaterialTextureBinder,
    SceneMaterialTextureUniformSetter,
} from '../material-texture-binder';
import type { SceneSkinningUniformBinder } from '../skinning-uniform-binder';
import type { SceneUniformWriteTarget } from '../uniform-writer';
import type { SceneUniformValue } from '../types';
import type { SceneShaderVariantResolver } from '../scene-shader-variant-resolver';

export interface SceneDrawExecutorContext {
    readonly renderPass: SceneRenderPassResource;
    readonly cameraFrame: SceneCameraFrameState;
    readonly lighting: SceneLightingState;
    /**
     * Frame-scoped lighting values, precomputed once per frame by the render
     * runtime. Optional so standalone executor uses keep working — when
     * absent the binder derives the map per draw.
     */
    readonly lightingValues?: LightingUniformValueMap;
    readonly fog: SceneFogState;
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
        getDefinition(id: string): import('../types').SceneMeshDefinition | undefined;
    };
    readonly shaders: {
        get(id: string): SceneShaderResource | undefined;
    };
    readonly textures: {
        get(textureId: string): import('../texture-registry').SceneTextureResource | undefined;
    };
    resolveSampler(id: string | null): import('@axrone/render-webgl2').ITextureSampler;
}

interface SceneDrawExecutorDependencies {
    readonly gl: WebGL2RenderingContext;
    readonly resources: SceneDrawExecutorResources;
    readonly morphMeshRuntime: Pick<SceneMorphMeshRuntime, 'resolve'>;
    readonly renderStateApplier: Pick<
        SceneRenderStateApplier,
        'apply' | 'resolvePrimitiveMode' | 'resolvePrimitiveTopology'
    >;
    readonly frameUniformBinder: Pick<SceneFrameUniformBinder, 'apply'>;
    readonly lightingUniformBinder: Pick<SceneLightingUniformBinder, 'apply'>;
    readonly fogUniformBinder: Pick<SceneFogUniformBinder, 'apply'>;
    readonly skinningUniformBinder: Pick<SceneSkinningUniformBinder, 'apply'>;
    readonly materialTextureBinder: Pick<SceneMaterialTextureBinder, 'bind' | 'unbind'>;
    readonly uniformWriter: SceneUniformWriteTarget;
    readonly textureUniformSetter: SceneMaterialTextureUniformSetter;
    readonly applyMissingVertexAttributeDefaults: (mesh: SceneMeshResource) => void;
    readonly variantResolver?: SceneShaderVariantResolver;
}

interface SceneDrawStateCache {
    readonly frame: number;
    readonly renderPass: SceneRenderPassResource;
    readonly mesh: SceneMeshResource;
    readonly material: SceneMaterialResource;
    readonly materialPass: ReturnType<typeof resolveSceneMaterialPass>;
    /** Shader override of the resolved pass; a mutated pass must not reuse its program. */
    readonly materialPassShaderId: string | undefined;
    readonly shader: SceneShaderResource;
    readonly fogEnabled: boolean;
}

/**
 * Per-shader uniform bookkeeping for the current frame.
 *
 * Frame, lighting, fog and "no skinning" uniform values only change once per
 * frame (per renderer lighting flag for `u_ReceiveLighting`). Without this
 * cache every draw re-wrote the same ~40 uniform groups, which dominates
 * submission cost for large scenes that share one material and shader.
 *
 * The declared-uniform flags are static per shader program and let the
 * executor skip binders whose target uniforms the program never samples.
 */
interface SceneShaderUniformState {
    frame: number;
    cameraFrame: SceneCameraFrameState | null;
    lightingValues: LightingUniformValueMap | undefined;
    fog: SceneDrawExecutorContext['fog'] | null;
    /**
     * Last lighting variant written to the current program this frame:
     * 0 = none, 1 = `receiveLighting: true`, 2 = `receiveLighting: false`.
     * Only the most recent write is tracked because GL uniforms hold one
     * value per program; alternating renderers must rewrite on every switch.
     */
    lightingWrittenFlag: number;
    frameUniformsWritten: boolean;
    fogWritten: boolean;
    declaresMvp: boolean;
    declaresSkinning: boolean;
}

const createShaderUniformState = (shader: SceneShaderResource): SceneShaderUniformState => ({
    frame: -1,
    cameraFrame: null,
    lightingValues: undefined,
    fog: null,
    lightingWrittenFlag: 0,
    frameUniformsWritten: false,
    fogWritten: false,
    declaresMvp: shader.uniformLocations.has('u_MVP'),
    declaresSkinning:
        shader.uniformLocations.has('u_Skinning') ||
        shader.uniformLocations.has('u_SkinJointCount') ||
        shader.uniformLocations.has('u_JointMatrices'),
});

export class SceneDrawExecutor {
    private _lastDrawState: SceneDrawStateCache | null = null;
    private readonly _shaderUniformStates = new WeakMap<
        SceneShaderResource,
        SceneShaderUniformState
    >();
    private readonly _mvpScratch = new Mat4();
    /**
     * Texture binding state for the current draw pass.
     *
     * Consecutive draws that share a material binding the same texture/sampler
     * to the same unit are common (one shared material across thousands of
     * entities). Re-binding and re-writing the sampler uniform for each of them
     * costs a handful of GL calls per draw, so the executor keeps the binding
     * alive and skips the whole bind path while the signature is unchanged.
     * The binding is released at the end of each draw pass
     * ({@link flushTextureBindings}) so later render families start clean.
     */
    private _textureMaterial: SceneMaterialResource | null = null;
    private _textureBindingsSize = -1;
    private _textureSlotCount = -1;
    private readonly _textureSlotUniforms: string[] = [];
    private readonly _textureSlotTextureIds: string[] = [];
    private readonly _textureSlotSamplerIds: (string | null)[] = [];
    private readonly _textureSlotUnits: number[] = [];
    private readonly _boundTextureUnits: number[] = [];

    constructor(private readonly _dependencies: SceneDrawExecutorDependencies) {}

    /**
     * Clears the consecutive-draw binding cache at a pass boundary. Any
     * texture left bound by the previous pass is released here.
     */
    resetState(): void {
        this._lastDrawState = null;
        this._releaseTextureBindings();
    }

    /**
     * Releases textures kept bound by the texture state cache. Called at the
     * end of a draw pass so sprite/particle/line passes and the next frame
     * start from a clean unit state.
     */
    flushTextureBindings(): void {
        this._releaseTextureBindings();
    }

    /**
     * Marks the cached texture signature stale when another renderer bound or
     * unbound texture units behind this executor's back (the instanced mesh
     * path binds its own group textures).
     */
    invalidateTextureBindings(): void {
        this._invalidateTextureSignature();
    }

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

        const cached = this._lastDrawState;
        const materialPass = resolveSceneMaterialPass(material, context.renderPass.materialPassId);
        if (context.renderPass.materialPassId != null && !materialPass) {
            return;
        }
        const materialPassShaderId = materialPass?.shaderId;
        const reuseBindings =
            cached !== null &&
            cached.frame === context.frame &&
            cached.renderPass === context.renderPass &&
            cached.mesh === mesh &&
            cached.material === material &&
            cached.materialPass === materialPass &&
            cached.materialPassShaderId === materialPassShaderId &&
            cached.fogEnabled === context.fog.enabled;

        let shader: SceneShaderResource;
        if (!reuseBindings) {
            const resolvedShader = this._resolveShader(material, context.fog, materialPassShaderId);
            if (!resolvedShader) {
                return;
            }
            shader = resolvedShader;

            this._dependencies.renderStateApplier.apply(shader, context.renderPass, materialPass);
            this._dependencies.gl.useProgram(shader.program);
            this._dependencies.gl.bindVertexArray(mesh.vertexArray);
            this._dependencies.applyMissingVertexAttributeDefaults(mesh);
            this._lastDrawState = {
                frame: context.frame,
                renderPass: context.renderPass,
                mesh,
                material,
                materialPass,
                materialPassShaderId,
                shader,
                fogEnabled: context.fog.enabled,
            };
        } else {
            shader = cached!.shader;
        }

        const uniformState = this._prepareUniformState(shader, context);
        this._applyFrameUniforms(shader, item, context, uniformState);

        const lightingFlag = item.renderer.receiveLighting ? 1 : 2;
        if (uniformState.lightingWrittenFlag !== lightingFlag) {
            this._dependencies.lightingUniformBinder.apply(
                shader,
                item.renderer,
                context.lighting,
                context.lightingValues
            );
            uniformState.lightingWrittenFlag = lightingFlag;
        }

        if (!uniformState.fogWritten) {
            this._dependencies.fogUniformBinder.apply(shader, context.fog);
            uniformState.fogWritten = true;
        }

        if (uniformState.declaresSkinning) {
            this._dependencies.skinningUniformBinder.apply(shader, item.renderer);
        }

        const textured = this._materialHasTextures(material);
        if (textured) {
            this._bindMaterialTextures(shader, material);
        } else if (this._boundTextureUnits.length > 0) {
            // Preserve the individual path's unit hygiene: a draw without
            // textures must not sample whatever the previous draw left bound.
            this._releaseTextureBindings();
        }

        for (const [name, value] of material.uniforms) {
            this._dependencies.uniformWriter.write(shader, name, value);
        }

        item.renderer.forEachUniformEntry((name, value) => {
            this._dependencies.uniformWriter.write(
                shader,
                name,
                value as SceneUniformValue | null | undefined
            );
        });

        const primitiveMode =
            this._dependencies.renderStateApplier.resolvePrimitiveMode?.(mesh.mode, materialPass) ??
            mesh.mode;

        if (mesh.indexBuffer && mesh.indexType !== null && mesh.indexCount > 0) {
            this._dependencies.gl.drawElements(primitiveMode, mesh.indexCount, mesh.indexType, 0);
        } else {
            this._dependencies.gl.drawArrays(primitiveMode, 0, mesh.vertexCount);
        }

        frameState.recordDraw({
            topology: materialPass?.primitive
                ? (this._dependencies.renderStateApplier.resolvePrimitiveTopology?.(
                      materialPass.primitive
                  ) ?? mesh.topology)
                : mesh.topology,
            indexCount: mesh.indexCount,
            vertexCount: mesh.vertexCount,
        });
        // Textures stay bound: the next draw reuses them when its material
        // signature matches and the pass flushes them at the end.
    }

    /**
     * Binds a material's texture slots unless the exact same signature is
     * already bound. The signature covers the material resource, the live
     * binding map size and every slot's uniform/texture/sampler/unit, so
     * in-place `setTexture` mutation and slot rebuilds still force a rebind.
     */
    private _bindMaterialTextures(
        shader: SceneShaderResource,
        material: SceneMaterialResource
    ): void {
        const slots = this._dependencies.resources.materials.getTextureSlots(material.id);
        const bindingsSize = material.textureBindings.size;

        if (
            this._textureMaterial === material &&
            this._textureBindingsSize === bindingsSize &&
            this._textureSlotCount === slots.length
        ) {
            let same = true;
            for (let index = 0; index < slots.length; index += 1) {
                const slot = slots[index]!;
                if (
                    this._textureSlotUniforms[index] !== slot.uniformName ||
                    this._textureSlotTextureIds[index] !== slot.binding.textureId ||
                    this._textureSlotSamplerIds[index] !== slot.binding.samplerId ||
                    this._textureSlotUnits[index] !== slot.resolvedUnit
                ) {
                    same = false;
                    break;
                }
            }
            if (same) {
                return;
            }
        }

        this._releaseTextureBindings();

        const boundUnits = this._dependencies.materialTextureBinder.bind(
            shader,
            material,
            this._dependencies.resources,
            this._dependencies.textureUniformSetter
        );

        this._textureMaterial = material;
        this._textureBindingsSize = bindingsSize;
        this._textureSlotCount = slots.length;
        this._textureSlotUniforms.length = slots.length;
        this._textureSlotTextureIds.length = slots.length;
        this._textureSlotSamplerIds.length = slots.length;
        this._textureSlotUnits.length = slots.length;
        for (let index = 0; index < slots.length; index += 1) {
            const slot = slots[index]!;
            this._textureSlotUniforms[index] = slot.uniformName;
            this._textureSlotTextureIds[index] = slot.binding.textureId;
            this._textureSlotSamplerIds[index] = slot.binding.samplerId;
            this._textureSlotUnits[index] = slot.resolvedUnit;
        }

        this._boundTextureUnits.length = boundUnits.length;
        for (let index = 0; index < boundUnits.length; index += 1) {
            this._boundTextureUnits[index] = boundUnits[index]!;
        }
    }

    private _releaseTextureBindings(): void {
        if (this._boundTextureUnits.length > 0) {
            this._dependencies.materialTextureBinder.unbind();
            this._boundTextureUnits.length = 0;
        }
        this._invalidateTextureSignature();
    }

    private _invalidateTextureSignature(): void {
        this._textureMaterial = null;
        this._textureBindingsSize = -1;
        this._textureSlotCount = -1;
        this._textureSlotUniforms.length = 0;
        this._textureSlotTextureIds.length = 0;
        this._textureSlotSamplerIds.length = 0;
        this._textureSlotUnits.length = 0;
    }

    private _prepareUniformState(
        shader: SceneShaderResource,
        context: SceneDrawExecutorContext
    ): SceneShaderUniformState {
        let state = this._shaderUniformStates.get(shader);
        if (!state) {
            state = createShaderUniformState(shader);
            this._shaderUniformStates.set(shader, state);
        }

        // Frame-scoped uniforms are only valid while the camera, lighting and
        // fog inputs are unchanged. A new camera frame object (or explicit
        // frame change) resets every group.
        if (
            state.frame !== context.frame ||
            state.cameraFrame !== context.cameraFrame ||
            state.lightingValues !== context.lightingValues ||
            state.fog !== context.fog
        ) {
            state.frame = context.frame;
            state.cameraFrame = context.cameraFrame;
            state.lightingValues = context.lightingValues;
            state.fog = context.fog;
            state.lightingWrittenFlag = 0;
            state.frameUniformsWritten = false;
            state.fogWritten = false;
        }

        return state;
    }

    /**
     * Writes frame uniforms. Only the first draw of a shader in a frame pays
     * for the full update; subsequent draws only refresh the model matrix
     * (and MVP when the program declares it) because every other frame
     * uniform is identical across draws.
     */
    private _applyFrameUniforms(
        shader: SceneShaderResource,
        item: SceneRenderItem,
        context: SceneDrawExecutorContext,
        state: SceneShaderUniformState
    ): void {
        const modelMatrix = item.transform.worldMatrix;

        if (!state.frameUniformsWritten) {
            this._dependencies.frameUniformBinder.apply(shader, {
                modelMatrix,
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
            state.frameUniformsWritten = true;
            return;
        }

        this._dependencies.uniformWriter.write(shader, 'u_Model', modelMatrix);

        if (state.declaresMvp) {
            Mat4.multiply(
                context.cameraFrame.viewProjectionMatrix,
                modelMatrix,
                this._mvpScratch
            );
            this._dependencies.uniformWriter.write(shader, 'u_MVP', this._mvpScratch);
        }
    }

    /**
     * `bind`/`unbind` are only meaningful when the material has texture
     * bindings. Reading the live map size keeps this correct even when a
     * material's textures are mutated in place (setTexture/removeTexture)
     * without replacing the resource object.
     */
    private _materialHasTextures(material: SceneMaterialResource): boolean {
        return material.textureBindings.size > 0;
    }

    private _resolveShader(
        material: SceneMaterialResource,
        fog: SceneFogState,
        materialPassShaderId: string | undefined
    ): SceneShaderResource | undefined {
        const targetShaderId = materialPassShaderId ?? material.shaderId;
        const resolver = this._dependencies.variantResolver;
        if (!resolver || (material.keywords.size === 0 && !fog.enabled)) {
            return this._dependencies.resources.shaders.get(targetShaderId);
        }

        const enabledKeywords: string[] = [];
        for (const [keyword, entry] of material.keywords) {
            if (entry.enabled) {
                enabledKeywords.push(keyword);
            }
        }

        if (fog.enabled && !enabledKeywords.includes('FOG')) {
            enabledKeywords.push('FOG');
        }

        if (enabledKeywords.length === 0) {
            return this._dependencies.resources.shaders.get(targetShaderId);
        }

        return resolver.resolve(targetShaderId, enabledKeywords);
    }
}
