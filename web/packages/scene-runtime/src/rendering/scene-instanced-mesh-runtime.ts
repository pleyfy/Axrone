import { Vec2 } from '@axrone/numeric';
import type { MeshRenderer } from '../components/mesh-renderer';
import { resolveSceneMaterialPass } from '../material-registry';
import type { SceneMaterialResource } from '../material-registry';
import type {
    SceneMaterialPassDefinition,
    SceneShaderDefinition,
    SceneUniformValue,
} from '../types';
import type { SceneMeshResource } from '../mesh-registry';
import type { SceneRenderFrameState } from './render-frame-state';
import type { SceneRenderItem } from './render-item-collector';
import type { SceneRenderPassResource } from './render-pass-registry';
import type { SceneRenderStateApplier } from './render-state-applier';
import type { SceneResourceRuntime } from '../scene-resource-runtime';
import { SCENE_ATTRIBUTE_LOCATIONS } from '../scene-vertex-layout';
import type {
    SceneMaterialTextureBinder,
    SceneMaterialTextureUniformSetter,
} from '../material-texture-binder';
import type { SceneUniformWriteTarget } from '../uniform-writer';
import type { SceneLightingUniformBinder } from '../lighting-uniform-binder';
import type { SceneFogUniformBinder } from '../fog-uniform-binder';
import type { SceneLightingState } from '../lighting-collector';
import type { SceneCameraFrameState } from '../camera-frame-state';
import type { SceneFogState } from '../fog-state';
import {
    SCENE_INSTANCE_COLOR_LOCATION,
    SCENE_INSTANCE_MATRIX_LOCATION,
} from './scene-instanced-mesh-shader';
import {
    compileSceneInstancedShader,
    type SceneInstancedShaderResource,
} from './scene-instanced-mesh-program';

const MATRIX_FLOATS_PER_INSTANCE = 16;
const MATRIX_BYTES_PER_INSTANCE = MATRIX_FLOATS_PER_INSTANCE * 4;
const COLOR_FLOATS_PER_INSTANCE = 4;
const COLOR_BYTES_PER_INSTANCE = COLOR_FLOATS_PER_INSTANCE * 4;
const INSTANCE_COLOR_UNIFORM = 'u_Color';
const INSTANCE_COLOR_TUPLE = [1, 1, 1, 1] as const;
const EMPTY_FLOATS = new Float32Array(0);

export interface SceneInstancedMeshRuntimeOptions {
    readonly gl: WebGL2RenderingContext;
    readonly resources: SceneResourceRuntime;
    readonly renderStateApplier: Pick<
        SceneRenderStateApplier,
        'apply' | 'resolvePrimitiveMode' | 'resolveBlendEnabled'
    >;
    readonly uniformWriter: SceneUniformWriteTarget;
    readonly lightingUniformBinder: Pick<SceneLightingUniformBinder, 'apply'>;
    readonly fogUniformBinder: Pick<SceneFogUniformBinder, 'apply'>;
    readonly materialTextureBinder: Pick<SceneMaterialTextureBinder, 'bind' | 'unbind'>;
    readonly textureUniformSetter: SceneMaterialTextureUniformSetter;
    /**
     * Notifies the individual draw path that group textures were bound or
     * released outside its own binding cache.
     */
    readonly invalidateTextureBindings?: () => void;
    /** Injectable for tests; defaults to compiling a derived GLSL program. */
    readonly compileProgram?: (
        gl: WebGL2RenderingContext,
        definition: SceneShaderDefinition
    ) => SceneInstancedShaderResource | null;
}

export interface SceneInstancedPlanParams {
    readonly renderPass: SceneRenderPassResource;
    readonly renderItems: readonly SceneRenderItem[];
    readonly cameraFrame: SceneCameraFrameState;
    readonly lighting: SceneLightingState;
    readonly lightingValues?: Parameters<SceneLightingUniformBinder['apply']>[3];
    readonly fog: SceneFogState;
    readonly frame: number;
    readonly elapsedSeconds: number;
    readonly deltaSeconds: number;
    readonly viewportWidth: number;
    readonly viewportHeight: number;
    readonly frameState: SceneRenderFrameState;
    /**
     * True when the scene's render-item list cache reported a hit: the item
     * set, transforms, materials and camera are unchanged, so the derived
     * instance plan can be replayed without a rebuild or a GPU upload.
     */
    readonly stable: boolean;
    readonly materialRevision: number;
    readonly meshRevision: number;
    readonly shaderRevision: number;
}

export interface SceneInstancedGroupView {
    readonly key: string;
    readonly meshId: string;
    readonly materialId: string;
    readonly receiveLighting: boolean;
    readonly hasColor: boolean;
    readonly instanceCount: number;
    readonly matrixData: Float32Array;
    readonly colorData: Float32Array;
    readonly items: readonly SceneRenderItem[];
}

export interface SceneInstancedPassPlan {
    readonly groups: readonly SceneInstancedGroupView[];
    readonly individualItems: readonly SceneRenderItem[];
    readonly instanceCount: number;
    readonly groupCount: number;
    /** Number of instance streams uploaded this build (0 on a reused plan). */
    readonly uploadCount: number;
    readonly reused: boolean;
}

type MutableGroup = {
    key: string;
    meshId: string;
    materialId: string;
    mesh: SceneMeshResource;
    material: SceneMaterialResource;
    materialPass: SceneMaterialPassDefinition | null;
    shader: SceneInstancedShaderResource;
    receiveLighting: boolean;
    hasColor: boolean;
    items: SceneRenderItem[];
    transformRevisions: Uint32Array;
    rendererRevisions: Uint32Array;
    matrixData: Float32Array;
    colorData: Float32Array;
    instanceCount: number;
    previousCount: number;
    matDirty: boolean;
    colorDirty: boolean;
    /** Material revision changed: every retained color must be rewritten. */
    colorStale: boolean;
    vao: WebGLVertexArrayObject | null;
    matrixBuffer: WebGLBuffer;
    colorBuffer: WebGLBuffer | null;
    matrixCapacityBytes: number;
    colorCapacityBytes: number;
    used: boolean;
    lightingProbe: { readonly receiveLighting: boolean };
};

interface Eligibility {
    readonly key: string;
    readonly mesh: SceneMeshResource;
    readonly material: SceneMaterialResource;
    readonly materialPass: SceneMaterialPassDefinition | null;
    readonly shader: SceneInstancedShaderResource;
    readonly hasColor: boolean;
    /** Effective `u_Color` (renderer override, else material default). */
    readonly color: readonly [number, number, number, number] | null;
    readonly receiveLighting: boolean;
}

interface EligibilityEntry {
    readonly rendererRevision: number;
    readonly renderPass: SceneRenderPassResource;
    readonly eligibility: Eligibility | null;
}

const EMPTY_GROUP_VIEWS: readonly SceneInstancedGroupView[] = Object.freeze([]);

/**
 * Copies one world matrix into the instance stream in the engine's native
 * row-major `Mat4.data` order. The derived vertex shader transposes the
 * attribute per vertex (`#define u_Model transpose(ax_InstanceModel)`), which
 * keeps this copy a single bulk typed-array write instead of a 16-element
 * permutation per instance per frame.
 */
const writeInstanceMatrix = (
    source: readonly number[],
    target: Float32Array,
    offset: number
): void => {
    target.set(source, offset);
};

const toColorTuple = (
    value: SceneUniformValue | null | undefined
): readonly [number, number, number, number] | null => {
    if (value === null || value === undefined) {
        return null;
    }

    if (Array.isArray(value)) {
        if (value.length < 3) {
            return null;
        }
        return [
            value[0] ?? 1,
            value[1] ?? 1,
            value[2] ?? 1,
            value.length > 3 ? (value[3] ?? 1) : 1,
        ];
    }

    if (value instanceof Float32Array) {
        if (value.length < 3) {
            return null;
        }
        return [
            value[0] ?? 1,
            value[1] ?? 1,
            value[2] ?? 1,
            value.length > 3 ? (value[3] ?? 1) : 1,
        ];
    }

    if (typeof value === 'object' && 'x' in value && 'y' in value && 'z' in value) {
        const vector = value as { x: number; y: number; z: number; w?: number };
        return [vector.x, vector.y, vector.z, vector.w ?? 1];
    }

    return null;
};

/**
 * Derives an instanced draw plan for homogeneous opaque `MeshRenderer` passes.
 *
 * This is a render cache, not a second scene: every instance still points at
 * the actor's own `Transform`/`MeshRenderer`, culling and ordering are the ones
 * produced by the existing scene pipeline, and the moment a renderer stops
 * being eligible (morph, skin, transparency, per-object uniforms, unsupported
 * shader shape) it is routed back through the individual draw path.
 *
 * Static scenes upload an instance stream once and replay it; transform-only
 * frames rewrite the matrix stream without rebuilding render items, material
 * snapshots or programs.
 */
export class SceneInstancedMeshRuntime {
    private readonly _gl: WebGL2RenderingContext;
    private readonly _options: SceneInstancedMeshRuntimeOptions;
    private readonly _groups = new Map<string, MutableGroup>();
    private readonly _activeGroups: MutableGroup[] = [];
    private readonly _individualItems: SceneRenderItem[] = [];
    private readonly _programs = new Map<string, SceneInstancedShaderResource | null>();
    private readonly _definitions = new Map<
        string,
        { readonly revision: number; readonly definition: SceneShaderDefinition }
    >();
    private readonly _resolution = new Vec2();
    private _eligibility = new WeakMap<MeshRenderer, EligibilityEntry>();
    private _eligibilityMaterialRevision = -1;
    private _eligibilityMeshRevision = -1;
    private _eligibilityShaderRevision = -1;
    private _shaderRevision = -1;
    private _meshRevision = -1;
    private _plan: SceneInstancedPassPlan | null = null;
    private _planPass: SceneRenderPassResource | null = null;
    private _planFog: SceneFogState | null = null;
    private _planItems: readonly SceneRenderItem[] | null = null;
    private _planItemCount = -1;
    private readonly _retainedItems: (SceneRenderItem | null)[] = [];
    private readonly _retainedEligibilities: (Eligibility | null)[] = [];
    private readonly _retainedGroups: (MutableGroup | null)[] = [];
    private readonly _retainedRendererRevisions: number[] = [];
    private _assignmentGeneration = -1;
    private _generation = 0;

    constructor(options: SceneInstancedMeshRuntimeOptions) {
        this._gl = options.gl;
        this._options = options;
    }

    get groupCount(): number {
        return this._activeGroups.length;
    }

    /**
     * Builds (or replays) the instance plan for one render pass. The returned
     * `individualItems` list holds every renderer that must keep the existing
     * per-object draw path.
     */
    build(params: SceneInstancedPlanParams): SceneInstancedPassPlan {
        this._invalidateCachesForRevisions(
            params.materialRevision,
            params.meshRevision,
            params.shaderRevision
        );

        const reusable =
            params.stable &&
            this._plan !== null &&
            this._planPass === params.renderPass &&
            this._planFog === params.fog &&
            this._planItems === params.renderItems &&
            this._planItemCount === params.renderItems.length;

        if (reusable) {
            // A fresh view so `reused` reports this frame truthfully; the
            // retaining plan object stays frozen and allocation-free.
            return {
                groups: this._plan!.groups,
                individualItems: this._plan!.individualItems,
                instanceCount: this._plan!.instanceCount,
                groupCount: this._plan!.groupCount,
                uploadCount: 0,
                reused: true,
            };
        }

        for (const group of this._groups.values()) {
            group.used = false;
            // Keep the retained stream/order for the unchanged-instance check,
            // but restart the per-build instance cursor.
            group.previousCount = group.instanceCount;
            group.instanceCount = 0;
        }
        this._individualItems.length = 0;

        const items = params.renderItems;
        // Dynamic scenes re-collect every frame, but the collected item objects
        // and their order stay identical for transform-only motion. A slot can
        // reuse its retained eligibility/group assignment only while the item
        // object *and* the renderer revision match, so renderer state changes
        // (color, visibility, material id, lighting flag) still re-resolve.
        const generationMatches =
            this._assignmentGeneration === this._generation &&
            this._retainedItems.length === items.length;
        if (!generationMatches) {
            this._retainedItems.length = items.length;
            this._retainedEligibilities.length = items.length;
            this._retainedGroups.length = items.length;
            this._retainedRendererRevisions.length = items.length;
        }
        let assignmentsChanged = !generationMatches;

        for (let index = 0; index < items.length; index += 1) {
            const item = items[index]!;
            const rendererRevision = item.renderer.revision;
            const reusableSlot =
                generationMatches &&
                this._retainedItems[index] === item &&
                this._retainedRendererRevisions[index] === rendererRevision;

            let eligibility: Eligibility | null;
            let group: MutableGroup | undefined;

            if (reusableSlot) {
                eligibility = this._retainedEligibilities[index]!;
                group = this._retainedGroups[index] ?? undefined;
            } else {
                eligibility = this._resolveEligibility(item.renderer, params.renderPass);
                group = eligibility ? this._groups.get(eligibility.key) : undefined;
                if (!group && eligibility) {
                    group = this._createGroup(eligibility);
                    this._groups.set(eligibility.key, group);
                }
                this._retainedItems[index] = item;
                this._retainedEligibilities[index] = eligibility;
                this._retainedGroups[index] = group ?? null;
                this._retainedRendererRevisions[index] = rendererRevision;
                assignmentsChanged = true;
            }

            if (!eligibility || !group) {
                this._individualItems.push(item);
                continue;
            }

            if (
                group.mesh !== eligibility.mesh ||
                group.shader !== eligibility.shader ||
                group.hasColor !== eligibility.hasColor
            ) {
                // A re-registered mesh/shader (or a shader that gained/lost the
                // color stream) invalidates the cached program wiring.
                this._destroyGroup(group);
                group = this._createGroup(eligibility);
                this._groups.set(eligibility.key, group);
                this._retainedGroups[index] = group;
            } else {
                group.material = eligibility.material;
                group.materialPass = eligibility.materialPass;
            }

            group.used = true;
            this._appendInstance(group, item, eligibility);
        }

        if (assignmentsChanged) {
            this._assignmentGeneration = this._generation;
        }

        const activeGroups = this._activeGroups;
        activeGroups.length = 0;
        let instanceCount = 0;
        let uploadCount = 0;

        for (const group of this._groups.values()) {
            if (!group.used) {
                group.instanceCount = 0;
                group.previousCount = 0;
                group.items.length = 0;
                continue;
            }

            group.items.length = group.instanceCount;
            if (group.instanceCount !== group.previousCount) {
                group.matDirty = true;
                if (group.hasColor) {
                    group.colorDirty = true;
                }
            }
            group.previousCount = group.instanceCount;

            if (group.colorStale) {
                // Every retained instance was rewritten this build.
                group.colorDirty = true;
                group.colorStale = false;
            }

            if (group.matDirty || group.colorDirty) {
                uploadCount += 1;
            }
            instanceCount += group.instanceCount;
            activeGroups.push(group);
        }

        const plan: SceneInstancedPassPlan = Object.freeze({
            groups: activeGroups as readonly SceneInstancedGroupView[],
            individualItems: this._individualItems,
            instanceCount,
            groupCount: activeGroups.length,
            uploadCount,
            reused: false,
        });

        this._plan = plan;
        this._planPass = params.renderPass;
        this._planFog = params.fog;
        this._planItems = params.renderItems;
        this._planItemCount = params.renderItems.length;
        return plan;
    }

    /**
     * Draws the planned instance groups. Must be called inside the opaque pass
     * after the render backend applied the pass framebuffer, viewport and clear.
     */
    draw(
        plan: SceneInstancedPassPlan,
        params: {
            readonly renderPass: SceneRenderPassResource;
            readonly cameraFrame: SceneCameraFrameState;
            readonly lighting: SceneLightingState;
            readonly lightingValues?: Parameters<SceneLightingUniformBinder['apply']>[3];
            readonly fog: SceneFogState;
            readonly frame: number;
            readonly elapsedSeconds: number;
            readonly deltaSeconds: number;
            readonly viewportWidth: number;
            readonly viewportHeight: number;
            readonly frameState: SceneRenderFrameState;
        }
    ): number {
        const groups = plan.groups as readonly MutableGroup[];
        if (groups.length === 0) {
            return 0;
        }

        const gl = this._gl;
        let drawCalls = 0;
        for (let index = 0; index < groups.length; index += 1) {
            const group = groups[index]!;
            if (group.instanceCount === 0) {
                continue;
            }

            this._uploadGroup(group);
            this._drawGroup(group, params);
            drawCalls += 1;
        }
        gl.bindVertexArray(null);
        return drawCalls;
    }

    clear(): void {
        this._destroyAllGroups();
        this._individualItems.length = 0;
        this._purgePrograms(true);
        this._generation += 1;
    }

    /**
     * Context-loss path: the handles are already invalid, so the GPU objects
     * are forgotten without issuing delete calls.
     */
    invalidateContextResources(): void {
        // Handles are already invalid; forget them without delete calls.
        this._groups.clear();
        this._activeGroups.length = 0;
        this._individualItems.length = 0;
        this._purgePrograms(false);
        this._generation += 1;
    }

    private _resetPlan(): void {
        this._plan = null;
        this._planPass = null;
        this._planFog = null;
        this._planItems = null;
        this._planItemCount = -1;
    }

    private _invalidateCachesForRevisions(
        materialRevision: number,
        meshRevision: number,
        shaderRevision: number
    ): void {
        if (shaderRevision !== this._shaderRevision) {
            this._shaderRevision = shaderRevision;
            this._purgePrograms(true);
            this._destroyAllGroups();
            this._generation += 1;
        }
        if (meshRevision !== this._meshRevision) {
            this._meshRevision = meshRevision;
            this._destroyAllGroups();
            this._generation += 1;
        }
        if (
            materialRevision !== this._eligibilityMaterialRevision ||
            meshRevision !== this._eligibilityMeshRevision ||
            shaderRevision !== this._eligibilityShaderRevision
        ) {
            if (this._eligibilityMaterialRevision !== materialRevision) {
                // Material resources can be mutated in place (uniforms), so the
                // retained per-instance colors may no longer match the base
                // material color even though renderer revisions are unchanged.
                for (const group of this._groups.values()) {
                    if (group.hasColor) {
                        group.colorStale = true;
                    }
                }
            }
            this._eligibilityMaterialRevision = materialRevision;
            this._eligibilityMeshRevision = meshRevision;
            this._eligibilityShaderRevision = shaderRevision;
            this._eligibility = new WeakMap();
            this._generation += 1;
            this._resetPlan();
        }
    }

    private _purgePrograms(deletePrograms: boolean): void {
        if (deletePrograms) {
            for (const program of this._programs.values()) {
                if (program) {
                    this._gl.deleteProgram(program.program);
                }
            }
        }
        this._programs.clear();
        this._definitions.clear();
        this._resetPlan();
    }

    private _resolveEligibility(
        renderer: MeshRenderer,
        renderPass: SceneRenderPassResource
    ): Eligibility | null {
        const cached = this._eligibility.get(renderer);
        if (
            cached &&
            cached.renderPass === renderPass &&
            cached.rendererRevision === renderer.revision
        ) {
            return cached.eligibility;
        }

        const eligibility = this._computeEligibility(renderer, renderPass);
        this._eligibility.set(renderer, {
            rendererRevision: renderer.revision,
            renderPass,
            eligibility,
        });
        return eligibility;
    }

    private _computeEligibility(
        renderer: MeshRenderer,
        renderPass: SceneRenderPassResource
    ): Eligibility | null {
        const meshId = renderer.meshId;
        const materialId = renderer.materialId;
        if (meshId === null || materialId === null) {
            return null;
        }
        if (renderer.hasSkin || renderer.hasMorphWeights) {
            return null;
        }

        const resources = this._options.resources;
        const mesh = resources.meshes.get(meshId);
        if (!mesh) {
            return null;
        }
        const material = resources.materials.get(materialId);
        if (!material) {
            return null;
        }
        if ((material.surface?.alphaMode ?? 'opaque') === 'blend') {
            return null;
        }

        const materialPass = resolveSceneMaterialPass(material, renderPass.materialPassId);
        if (renderPass.materialPassId !== null && !materialPass) {
            return null;
        }
        // The derived program is compiled from the material's shader definition,
        // so a pass-level override would draw the silhouette with the main program.
        if (materialPass?.shaderId != null && materialPass.shaderId !== material.shaderId) {
            return null;
        }

        const shader = this._resolveProgram(material.shaderId);
        if (!shader) {
            return null;
        }

        // Only plain opaque state is safe to reorder into one group draw.
        if (shader.depthTest === false) {
            return null;
        }
        if (this._isBlended(shader, renderPass, materialPass)) {
            return null;
        }
        if (materialPass?.depthStencilState?.depthWrite === false) {
            return null;
        }

        let colorOverride: readonly [number, number, number, number] | null = null;
        let unsupportedUniform = false;
        renderer.forEachUniformEntry((name, value) => {
            if (name !== INSTANCE_COLOR_UNIFORM) {
                unsupportedUniform = true;
                return;
            }
            colorOverride = toColorTuple(value as SceneUniformValue);
        });
        if (unsupportedUniform) {
            return null;
        }

        const color =
            colorOverride ?? toColorTuple(material.uniforms.get(INSTANCE_COLOR_UNIFORM) ?? null);
        if (shader.instanceColor && color === null) {
            // The derived program samples a per-instance color; without a
            // resolvable base color the individual path must keep the draw.
            return null;
        }

        const receiveLighting = renderer.receiveLighting;
        return {
            key: `${meshId}\u0000${materialId}\u0000${receiveLighting ? 1 : 0}`,
            mesh,
            material,
            materialPass,
            shader,
            hasColor: shader.instanceColor,
            color,
            receiveLighting,
        };
    }

    private _isBlended(
        shader: SceneInstancedShaderResource,
        renderPass: SceneRenderPassResource,
        materialPass: SceneMaterialPassDefinition | null
    ): boolean {
        return this._options.renderStateApplier.resolveBlendEnabled(
            shader,
            renderPass,
            materialPass
        );
    }

    private _resolveProgram(shaderId: string): SceneInstancedShaderResource | null {
        const cached = this._programs.get(shaderId);
        if (cached !== undefined) {
            return cached;
        }

        let entry = this._definitions.get(shaderId);
        if (!entry) {
            const definition = this._options.resources.shaders.getDefinition(shaderId);
            if (!definition) {
                this._programs.set(shaderId, null);
                return null;
            }
            entry = { revision: this._shaderRevision, definition };
            this._definitions.set(shaderId, entry);
        }

        const compile = this._options.compileProgram ?? compileSceneInstancedShader;
        const program = compile(this._gl, entry.definition);
        this._programs.set(shaderId, program);
        return program;
    }

    private _destroyGroup(group: MutableGroup): void {
        const gl = this._gl;
        if (group.vao) {
            gl.deleteVertexArray(group.vao);
            group.vao = null;
        }
        gl.deleteBuffer(group.matrixBuffer);
        if (group.colorBuffer) {
            gl.deleteBuffer(group.colorBuffer);
            group.colorBuffer = null;
        }
        this._groups.delete(group.key);
        const activeIndex = this._activeGroups.indexOf(group);
        if (activeIndex !== -1) {
            this._activeGroups.splice(activeIndex, 1);
        }
    }

    private _destroyAllGroups(): void {
        const gl = this._gl;
        for (const group of this._groups.values()) {
            if (group.vao) {
                gl.deleteVertexArray(group.vao);
            }
            gl.deleteBuffer(group.matrixBuffer);
            if (group.colorBuffer) {
                gl.deleteBuffer(group.colorBuffer);
            }
        }
        this._groups.clear();
        this._activeGroups.length = 0;
        this._resetPlan();
    }

    private _createGroup(eligibility: Eligibility): MutableGroup {
        const gl = this._gl;
        const matrixBuffer = gl.createBuffer();
        const colorBuffer = eligibility.hasColor ? gl.createBuffer() : null;
        if (!matrixBuffer || (eligibility.hasColor && !colorBuffer)) {
            throw new Error('Failed to allocate instanced mesh buffers');
        }

        const group: MutableGroup = {
            key: eligibility.key,
            meshId: eligibility.mesh.id,
            materialId: eligibility.material.id,
            mesh: eligibility.mesh,
            material: eligibility.material,
            materialPass: eligibility.materialPass,
            shader: eligibility.shader,
            receiveLighting: eligibility.receiveLighting,
            hasColor: eligibility.hasColor,
            items: [],
            transformRevisions: new Uint32Array(0),
            rendererRevisions: new Uint32Array(0),
            matrixData: new Float32Array(0),
            colorData: eligibility.hasColor ? new Float32Array(0) : EMPTY_FLOATS,
            instanceCount: 0,
            previousCount: 0,
            matDirty: true,
            colorDirty: eligibility.hasColor,
            colorStale: false,
            vao: null,
            matrixBuffer,
            colorBuffer,
            matrixCapacityBytes: 0,
            colorCapacityBytes: 0,
            used: false,
            lightingProbe: Object.freeze({ receiveLighting: eligibility.receiveLighting }),
        };
        group.vao = this._createVertexArray(group);
        return group;
    }

    private _createVertexArray(group: MutableGroup): WebGLVertexArrayObject {
        const gl = this._gl;
        const vao = gl.createVertexArray();
        if (!vao) {
            throw new Error('Failed to create instanced mesh vertex array');
        }
        const definition = this._options.resources.meshes.getDefinition(group.mesh.id);

        gl.bindVertexArray(vao);
        gl.bindBuffer(gl.ARRAY_BUFFER, group.mesh.vertexBuffer);
        if (definition) {
            for (let index = 0; index < definition.attributes.length; index += 1) {
                const attribute = definition.attributes[index]!;
                const location = SCENE_ATTRIBUTE_LOCATIONS[attribute.semantic];
                const attributeType = attribute.type ?? gl.FLOAT;
                gl.enableVertexAttribArray(location);
                if (attribute.integer && typeof gl.vertexAttribIPointer === 'function') {
                    gl.vertexAttribIPointer(
                        location,
                        attribute.componentCount,
                        attributeType,
                        attribute.stride,
                        attribute.offset
                    );
                } else {
                    gl.vertexAttribPointer(
                        location,
                        attribute.componentCount,
                        attributeType,
                        attribute.normalized ?? false,
                        attribute.stride,
                        attribute.offset
                    );
                }
            }
        }
        if (group.mesh.indexBuffer) {
            gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, group.mesh.indexBuffer);
        }

        gl.bindBuffer(gl.ARRAY_BUFFER, group.matrixBuffer);
        for (let column = 0; column < 4; column += 1) {
            const location = SCENE_INSTANCE_MATRIX_LOCATION + column;
            gl.enableVertexAttribArray(location);
            gl.vertexAttribPointer(
                location,
                4,
                gl.FLOAT,
                false,
                MATRIX_BYTES_PER_INSTANCE,
                column * 16
            );
            gl.vertexAttribDivisor(location, 1);
        }

        if (group.hasColor && group.colorBuffer) {
            gl.bindBuffer(gl.ARRAY_BUFFER, group.colorBuffer);
            gl.enableVertexAttribArray(SCENE_INSTANCE_COLOR_LOCATION);
            gl.vertexAttribPointer(
                SCENE_INSTANCE_COLOR_LOCATION,
                4,
                gl.FLOAT,
                false,
                COLOR_BYTES_PER_INSTANCE,
                0
            );
            gl.vertexAttribDivisor(SCENE_INSTANCE_COLOR_LOCATION, 1);
        }

        gl.bindVertexArray(null);
        return vao;
    }

    private _appendInstance(
        group: MutableGroup,
        item: SceneRenderItem,
        eligibility: Eligibility
    ): void {
        const index = group.instanceCount;

        const transformRevision = item.transform.revision;
        const rendererRevision = item.renderer.revision;
        const unchanged =
            group.items[index] === item &&
            group.transformRevisions[index] === transformRevision &&
            group.rendererRevisions[index] === rendererRevision;
        // Color depends on renderer state and the material base color; a
        // transform-only frame keeps the retained color stream untouched.
        const colorUnchanged =
            !group.colorStale && group.rendererRevisions[index] === rendererRevision;
        let changed = false;
        let colorChanged = false;

        if (!unchanged) {
            const required = index + 1;
            if (group.matrixData.length < required * MATRIX_FLOATS_PER_INSTANCE) {
                const grown = new Float32Array(
                    Math.max(required * MATRIX_FLOATS_PER_INSTANCE, group.matrixData.length * 2)
                );
                grown.set(group.matrixData);
                group.matrixData = grown;
            }

            writeInstanceMatrix(
                item.transform.worldMatrix.data,
                group.matrixData,
                index * MATRIX_FLOATS_PER_INSTANCE
            );
            changed = true;
        }

        // Colors are refreshed independently: a material revision change can
        // move the base color without touching any renderer or transform.
        if (group.hasColor && !colorUnchanged) {
            const required = index + 1;
            if (group.colorData.length < required * COLOR_FLOATS_PER_INSTANCE) {
                const grown = new Float32Array(
                    Math.max(required * COLOR_FLOATS_PER_INSTANCE, group.colorData.length * 2)
                );
                grown.set(group.colorData);
                group.colorData = grown;
            }
            const color = eligibility.color ?? INSTANCE_COLOR_TUPLE;
            const colorOffset = index * COLOR_FLOATS_PER_INSTANCE;
            group.colorData[colorOffset] = color[0];
            group.colorData[colorOffset + 1] = color[1];
            group.colorData[colorOffset + 2] = color[2];
            group.colorData[colorOffset + 3] = color[3];
            colorChanged = true;
        }

        if (index >= group.transformRevisions.length) {
            const size = Math.max(index + 1, group.transformRevisions.length * 2);
            const transformRevisions = new Uint32Array(size);
            transformRevisions.set(group.transformRevisions);
            const rendererRevisions = new Uint32Array(size);
            rendererRevisions.set(group.rendererRevisions);
            group.transformRevisions = transformRevisions;
            group.rendererRevisions = rendererRevisions;
        }
        group.transformRevisions[index] = transformRevision;
        group.rendererRevisions[index] = rendererRevision;
        group.items[index] = item;
        group.instanceCount = index + 1;

        if (changed) {
            group.matDirty = true;
        }
        if (colorChanged) {
            group.colorDirty = true;
        }
    }

    private _uploadGroup(group: MutableGroup): void {
        if (!group.matDirty && !group.colorDirty) {
            return;
        }

        const gl = this._gl;
        if (group.matDirty) {
            const requiredBytes = group.instanceCount * MATRIX_BYTES_PER_INSTANCE;
            gl.bindBuffer(gl.ARRAY_BUFFER, group.matrixBuffer);
            if (requiredBytes > group.matrixCapacityBytes) {
                group.matrixCapacityBytes = Math.max(requiredBytes, group.matrixCapacityBytes * 2);
                gl.bufferData(gl.ARRAY_BUFFER, group.matrixCapacityBytes, gl.DYNAMIC_DRAW);
            }
            gl.bufferSubData(
                gl.ARRAY_BUFFER,
                0,
                group.matrixData,
                0,
                group.instanceCount * MATRIX_FLOATS_PER_INSTANCE
            );
            group.matDirty = false;
        }

        if (group.hasColor && group.colorDirty && group.colorBuffer) {
            const requiredBytes = group.instanceCount * COLOR_BYTES_PER_INSTANCE;
            gl.bindBuffer(gl.ARRAY_BUFFER, group.colorBuffer);
            if (requiredBytes > group.colorCapacityBytes) {
                group.colorCapacityBytes = Math.max(requiredBytes, group.colorCapacityBytes * 2);
                gl.bufferData(gl.ARRAY_BUFFER, group.colorCapacityBytes, gl.DYNAMIC_DRAW);
            }
            gl.bufferSubData(
                gl.ARRAY_BUFFER,
                0,
                group.colorData,
                0,
                group.instanceCount * COLOR_FLOATS_PER_INSTANCE
            );
            group.colorDirty = false;
        }
    }

    private _drawGroup(
        group: MutableGroup,
        params: {
            readonly renderPass: SceneRenderPassResource;
            readonly cameraFrame: SceneCameraFrameState;
            readonly lighting: SceneLightingState;
            readonly lightingValues?: Parameters<SceneLightingUniformBinder['apply']>[3];
            readonly fog: SceneFogState;
            readonly frame: number;
            readonly elapsedSeconds: number;
            readonly deltaSeconds: number;
            readonly viewportWidth: number;
            readonly viewportHeight: number;
            readonly frameState: SceneRenderFrameState;
        }
    ): void {
        const gl = this._gl;
        const writer = this._options.uniformWriter;
        const shader = group.shader;
        const cameraFrame = params.cameraFrame;

        this._options.renderStateApplier.apply(shader, params.renderPass, group.materialPass);
        gl.useProgram(shader.program);
        gl.bindVertexArray(group.vao);

        writer.write(shader, 'u_View', cameraFrame.viewMatrix);
        writer.write(shader, 'u_Projection', cameraFrame.projectionMatrix);
        writer.write(shader, 'u_ViewProjection', cameraFrame.viewProjectionMatrix);
        writer.write(shader, 'u_Time', params.elapsedSeconds);
        writer.write(shader, 'u_DeltaTime', params.deltaSeconds);
        writer.write(shader, 'u_Frame', params.frame);
        this._resolution.x = params.viewportWidth;
        this._resolution.y = params.viewportHeight;
        writer.write(shader, 'u_Resolution', this._resolution);
        writer.write(shader, 'u_CameraPosition', cameraFrame.position);

        if (declaresLighting(shader)) {
            this._options.lightingUniformBinder.apply(
                shader,
                group.lightingProbe,
                params.lighting,
                params.lightingValues
            );
        }
        if (shader.uniformLocations.has('u_FogEnabled')) {
            this._options.fogUniformBinder.apply(shader, params.fog);
        }

        for (const [name, value] of group.material.uniforms) {
            writer.write(shader, name, value);
        }

        const textured = group.material.textureBindings.size > 0;
        if (textured) {
            this._options.invalidateTextureBindings?.();
            this._options.materialTextureBinder.bind(
                shader,
                group.material,
                this._options.resources,
                this._options.textureUniformSetter
            );
        }

        const primitiveMode =
            this._options.renderStateApplier.resolvePrimitiveMode?.(
                group.mesh.mode,
                group.materialPass
            ) ?? group.mesh.mode;

        if (group.mesh.indexBuffer && group.mesh.indexType !== null && group.mesh.indexCount > 0) {
            gl.drawElementsInstanced(
                primitiveMode,
                group.mesh.indexCount,
                group.mesh.indexType,
                0,
                group.instanceCount
            );
        } else {
            gl.drawArraysInstanced(primitiveMode, 0, group.mesh.vertexCount, group.instanceCount);
        }

        const trianglesPerInstance =
            group.mesh.topology === 'triangles'
                ? Math.floor(
                      (group.mesh.indexCount > 0 ? group.mesh.indexCount : group.mesh.vertexCount) /
                          3
                  )
                : 0;
        params.frameState.recordTriangles(trianglesPerInstance * group.instanceCount, 1);

        if (textured) {
            this._options.materialTextureBinder.unbind();
            this._options.invalidateTextureBindings?.();
        }
    }
}

const LIGHTING_UNIFORM_PROBES = [
    'u_ReceiveLighting',
    'u_AmbientLight',
    'u_DirectionalLightCount',
    'u_PointLightCount',
    'u_SpotLightCount',
] as const;

const declaresLighting = (shader: SceneInstancedShaderResource): boolean => {
    for (let index = 0; index < LIGHTING_UNIFORM_PROBES.length; index += 1) {
        if (shader.uniformLocations.has(LIGHTING_UNIFORM_PROBES[index]!)) {
            return true;
        }
    }
    return false;
};
