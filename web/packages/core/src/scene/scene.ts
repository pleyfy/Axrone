import { Mat4, Vec3, Vec4 } from '@axrone/numeric';
import { createBox, createPlane, createSphere } from '../geometry/primitives';
import { createGameLoop, type GameLoop, type GameLoopSystem } from '../game-loop';
import { Transform } from '../component-system/components/transform';
import { Actor, type ActorConfig } from '../component-system/core/actor';
import { World } from '../component-system/core/world';
import { SystemManager, SystemPhase } from '../component-system/systems/system-manager';
import type { ComponentConstructor, ComponentRegistry } from '../component-system/types/core';
import type { System, SystemQuery } from '../component-system/types/system';
import {
    FilterMode,
    WrapMode,
} from '../renderer/webgl2/texture/interfaces';
import { WebGLTextureManager } from '../renderer/webgl2/texture/manager';
import { Animator } from './components/animator';
import { Camera, type CameraConfig } from './components/camera';
import { MeshRenderer, type MeshRendererConfig } from './components/mesh-renderer';
import { OrbitCameraController } from './components/orbit-camera-controller';
import { SceneActorLifecycleRunner } from './actor-lifecycle-runner';
import { SceneActorRuntime } from './scene-actor-runtime';
import { SceneAssetRuntime } from './scene-asset-runtime';
import { SceneComponentCatalog } from './component-catalog';
import { createSceneLoopSystems } from './loop-bridge';
import { SceneRenderRuntime } from './scene-render-runtime';
import { SceneSnapshotLoader } from './scene-snapshot-loader';
import { resolveSceneSurface } from './scene-surface-resolver';
import { SceneLifecycleError, SceneMaterialError } from './errors';
import { resolveSceneRegistryFromProfile } from './profile';
import type {
    SceneLoopState,
    SceneMaterialDefinition,
    SceneMaterialHandle,
    SceneMaterialTextureBindingHandle,
    SceneMeshDefinition,
    SceneMeshHandle,
    SceneMeshSemantic,
    SceneMeshTopology,
    SceneOptions,
    ScenePrefabDefinition,
    ScenePrefabInstantiateOptions,
    SceneRegistry,
    SceneRenderPassDefinition,
    SceneRenderPassHandle,
    SceneSamplerDefinition,
    SceneSamplerHandle,
    SceneShaderDefinition,
    SceneShaderHandle,
    SceneSnapshot,
    SceneSnapshotLoadOptions,
    SceneTextureBindingDefinition,
    SceneTextureDefinition,
    SceneTextureHandle,
    SceneTextureResourceHandle,
    SceneUniformValue,
} from './types';

type RuntimeRegistry<R extends ComponentRegistry> = SceneRegistry<R>;

const DEFAULT_CLEAR_COLOR = new Vec4(0.08, 0.09, 0.11, 1);
const DEFAULT_AMBIENT_LIGHT = new Vec3(0.08, 0.08, 0.1);
const DEFAULT_WIDTH = 1280;
const DEFAULT_HEIGHT = 720;
const DEFAULT_RENDER_PASS_ID = 'main';

const createId = (prefix: string): string =>
    `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;

const toVec4 = (
    value?: Vec4 | readonly [number, number, number, number] | null,
    fallback: Vec4 = DEFAULT_CLEAR_COLOR
): Vec4 => {
    if (value instanceof Vec4) {
        return new Vec4(value.x, value.y, value.z, value.w);
    }

    if (Array.isArray(value) && value.length === 4) {
        return new Vec4(value[0], value[1], value[2], value[3]);
    }

    return new Vec4(fallback.x, fallback.y, fallback.z, fallback.w);
};

const toVec3 = (
    value?: Vec3 | readonly [number, number, number] | null,
    fallback: Vec3 = DEFAULT_AMBIENT_LIGHT
): Vec3 => {
    if (value instanceof Vec3) {
        return new Vec3(value.x, value.y, value.z);
    }

    if (Array.isArray(value) && value.length === 3) {
        return new Vec3(value[0], value[1], value[2]);
    }

    return new Vec3(fallback.x, fallback.y, fallback.z);
};

export const createUnlitColorShaderDefinition = (
    id: string = 'Scene/UnlitColor'
): SceneShaderDefinition => ({
    id,
    vertexSource: `#version 300 es
layout(location = 0) in vec3 a_Position;
layout(location = 2) in vec2 a_UV0;
uniform mat4 u_Model;
uniform mat4 u_View;
uniform mat4 u_Projection;
out vec2 v_UV0;
void main() {
    v_UV0 = a_UV0;
    gl_Position = u_Projection * u_View * u_Model * vec4(a_Position, 1.0);
}`,
    fragmentSource: `#version 300 es
precision highp float;
uniform vec4 u_Color;
in vec2 v_UV0;
out vec4 o_Color;
void main() {
    o_Color = u_Color;
}`,
    uniforms: ['u_Model', 'u_View', 'u_Projection', 'u_Color'],
    depthTest: true,
    cull: true,
    blend: false,
});

export class Scene<R extends ComponentRegistry = Record<string, never>> {
    readonly id: string;
    readonly canvas: HTMLCanvasElement;
    readonly gl: WebGL2RenderingContext;
    readonly world: World<RuntimeRegistry<R>>;
    readonly systems: SystemManager<RuntimeRegistry<R>>;
    readonly loop: GameLoop<SceneLoopState>;

    private readonly _registry: RuntimeRegistry<R>;
    private readonly _actors: SceneActorRuntime<R>;
    private readonly _assets: SceneAssetRuntime;
    private readonly _actorLifecycleRunner: SceneActorLifecycleRunner;
    private readonly _renderRuntime: SceneRenderRuntime;
    private readonly _snapshotLoader: SceneSnapshotLoader;
    private readonly _autoCreatedCanvas: boolean;
    private readonly _defaultClearColor: Vec4;
    private readonly _ambientLight: Vec3;
    private _pixelRatio: number;
    private _disposed = false;

    constructor(options: SceneOptions<R> = {}) {
        this.id = createId('scene');
        const surface = resolveSceneSurface(options);
        this.canvas = surface.canvas;
        this.gl = surface.gl;
        this._autoCreatedCanvas = surface.autoCreated;
        this._pixelRatio = options.pixelRatio ?? globalThis.devicePixelRatio ?? 1;
        this._defaultClearColor = toVec4(options.clearColor);
        const ambientLight = toVec3(options.ambientLight);
        this._ambientLight = ambientLight;
        this._assets = new SceneAssetRuntime({
            gl: this.gl,
            defaultPassId: DEFAULT_RENDER_PASS_ID,
            defaultClearColor: this._defaultClearColor,
            releaseBaseMesh: (meshId) => {
                this._renderRuntime.releaseBaseMesh(meshId);
            },
            clearRenderRuntime: () => {
                this._renderRuntime.clear();
            },
        });
        this._renderRuntime = new SceneRenderRuntime({
            gl: this.gl,
            resources: this._assets.resources,
            ambientLight,
            defaultClearColor: this._defaultClearColor,
            getActors: () => this.world.getAllActors(),
            createMeshResource: (definition) => this._assets.createMeshResource(definition),
            disposeMesh: (mesh) => this._assets.disposeMesh(mesh),
            applyMissingVertexAttributeDefaults: (mesh) =>
                this._assets.applyMissingVertexAttributeDefaults(mesh),
        });

        this._registry = resolveSceneRegistryFromProfile(options.profile, {
            registry: options.registry ?? ({} as R),
        }) as RuntimeRegistry<R>;
        const componentCatalog = new SceneComponentCatalog(this._registry);

        this.world = new World(this._registry, options.worldConfig);
        this.systems = new SystemManager(this.world);
        this._actors = new SceneActorRuntime({
            world: this.world,
            componentCatalog,
        });
        this._actorLifecycleRunner = new SceneActorLifecycleRunner({
            getActors: () => this.world.getAllActors(),
        });
        this._snapshotLoader = new SceneSnapshotLoader({
            defaultRenderPassId: DEFAULT_RENDER_PASS_ID,
            defaultClearColor: this._defaultClearColor,
            clearExisting: () => {
                this._actors.destroyAllActors();
                this._assets.clear();
            },
            clearRenderPasses: () => {
                this._assets.clearRenderPasses();
            },
            registerShader: (shader) => {
                this.registerShader(shader);
            },
            registerMesh: (mesh) => {
                this.registerMesh(mesh);
            },
            registerSampler: (sampler) => {
                this.registerSampler(sampler);
            },
            registerTexture: async (texture) => {
                await this.registerTexture(texture);
            },
            registerRenderPass: (renderPass) => {
                this.registerRenderPass(renderPass);
            },
            createMaterial: (material) => {
                this.createMaterial(material);
            },
            instantiatePrefab: (prefab, options) => this._actors.instantiatePrefab(prefab, options),
        });
        this.resize(options.width, options.height, this._pixelRatio);

        const initialRenderPasses = options.renderPasses?.length
            ? options.renderPasses
            : [
                  {
                      id: DEFAULT_RENDER_PASS_ID,
                      order: 0,
                      rendererPassId: DEFAULT_RENDER_PASS_ID,
                      clearFlags: ['color', 'depth'],
                      clearColor: this._defaultClearColor,
                  } satisfies SceneRenderPassDefinition,
              ];

        for (const renderPass of initialRenderPasses) {
            this.registerRenderPass(renderPass);
        }

        const loopSystems: readonly GameLoopSystem<SceneLoopState>[] = createSceneLoopSystems({
            executePhase: (phase, delta) => {
                this.systems.executePhase(phase, delta);
            },
            fixedUpdateActors: (delta) => {
                this._actorLifecycleRunner.fixedUpdate(delta);
            },
            updateActors: (delta) => {
                this._actorLifecycleRunner.update(delta);
            },
            lateUpdateActors: (delta) => {
                this._actorLifecycleRunner.lateUpdate(delta);
            },
            render: (delta) => {
                this._render(delta);
            },
        });

        this.loop = createGameLoop({
            state: { sceneId: this.id },
            scheduler: options.scheduler,
            fixedDelta: options.fixedDelta,
            maxDelta: options.maxDelta,
            maxSubSteps: options.maxSubSteps,
            autoStart: false,
            systems: loopSystems,
            errorPolicy: 'throw',
        });

        if (options.autoStart !== false) {
            this.start();
        }
    }

    get status() {
        return this.loop.status;
    }

    get isDisposed(): boolean {
        return this._disposed;
    }

    get renderStats() {
        return this._renderRuntime.stats;
    }

    registerComponent<T extends ComponentConstructor>(componentType: T): this {
        this._assertNotDisposed();
        this._actors.registerComponent(componentType);
        return this;
    }

    isComponentRegistered(componentTypeOrName: string | ComponentConstructor): boolean {
        this._assertNotDisposed();
        return this._actors.isComponentRegistered(componentTypeOrName);
    }

    getRegisteredComponentNames(): readonly string[] {
        this._assertNotDisposed();
        return this._actors.getRegisteredComponentNames();
    }

    createActor(config: ActorConfig = {}): Actor<World<RuntimeRegistry<R>>> {
        this._assertNotDisposed();
        return this._actors.createActor(config);
    }

    createCameraActor(
        actorConfig: ActorConfig = {},
        cameraConfig: CameraConfig = {}
    ): Actor<World<RuntimeRegistry<R>>> {
        this._assertNotDisposed();
        return this._actors.createCameraActor(actorConfig, cameraConfig);
    }

    createRenderableActor(
        actorConfig: ActorConfig = {},
        rendererConfig: MeshRendererConfig = {}
    ): Actor<World<RuntimeRegistry<R>>> {
        this._assertNotDisposed();
        return this._actors.createRenderableActor(actorConfig, rendererConfig);
    }

    addSystem<Q extends SystemQuery<RuntimeRegistry<R>>>(
        system: System<RuntimeRegistry<R>, Q>,
        phase: SystemPhase = SystemPhase.Update
    ): this {
        this._assertNotDisposed();
        this.systems.addSystem(system, phase);
        return this;
    }

    removeSystem(systemId: string): boolean {
        this._assertNotDisposed();
        return this.systems.removeSystem(systemId as any);
    }

    registerShader(definition: SceneShaderDefinition): SceneShaderHandle {
        this._assertNotDisposed();
        return this._assets.registerShader(definition);
    }

    getShader(id: string): SceneShaderHandle | null {
        return this._assets.getShader(id);
    }

    createMaterial(definition: SceneMaterialDefinition): SceneMaterialHandle {
        this._assertNotDisposed();
        try {
            return this._assets.createMaterial(definition);
        } catch (error) {
            if (error instanceof SceneMaterialError) {
                throw error;
            }
            throw new SceneMaterialError(
                `Failed to create material '${definition.id}'`,
                error instanceof Error ? error : undefined
            );
        }
    }

    setMaterialUniform(materialId: string, name: string, value: SceneUniformValue): this {
        this._assertNotDisposed();
        if (!this._assets.setMaterialUniform(materialId, name, value)) {
            throw new SceneMaterialError(`Material '${materialId}' is not registered`);
        }

        return this;
    }

    setMaterialTexture(
        materialId: string,
        name: string,
        binding: SceneTextureBindingDefinition
    ): this {
        this._assertNotDisposed();
        if (!this._assets.setMaterialTexture(materialId, name, binding)) {
            throw new SceneMaterialError(`Material '${materialId}' is not registered`);
        }

        return this;
    }

    getMaterial(materialId: string): SceneMaterialHandle | null {
        return this._assets.getMaterial(materialId);
    }

    registerMesh(definition: SceneMeshDefinition): SceneMeshHandle {
        this._assertNotDisposed();
        return this._assets.registerMesh(definition);
    }

    getMesh(id: string): SceneMeshHandle | null {
        return this._assets.getMesh(id);
    }

    registerSampler(definition: SceneSamplerDefinition): SceneSamplerHandle {
        this._assertNotDisposed();
        return this._assets.registerSampler(definition);
    }

    getSampler(id: string): SceneSamplerHandle | null {
        return this._assets.getSampler(id);
    }

    async registerTexture(definition: SceneTextureDefinition): Promise<SceneTextureHandle> {
        this._assertNotDisposed();
        return await this._assets.registerTexture(definition);
    }

    getTexture(id: string): SceneTextureHandle | null {
        return this._assets.getTexture(id);
    }

    getTextureResource(id: string): SceneTextureResourceHandle | null {
        return this._assets.getTextureResource(id);
    }

    getMaterialTextureBindings(materialId: string): readonly SceneMaterialTextureBindingHandle[] {
        return this._assets.getMaterialTextureBindings(materialId);
    }

    getMaterialTextureBinding(
        materialId: string,
        uniformName?: string
    ): SceneMaterialTextureBindingHandle | null {
        const bindings = this.getMaterialTextureBindings(materialId);
        if (bindings.length === 0) {
            return null;
        }
        if (!uniformName) {
            return bindings[0] ?? null;
        }
        return bindings.find((binding) => binding.uniformName === uniformName) ?? null;
    }

    registerRenderPass(definition: SceneRenderPassDefinition): SceneRenderPassHandle {
        this._assertNotDisposed();
        return this._assets.registerRenderPass(definition);
    }

    getRenderPass(id: string): SceneRenderPassHandle | null {
        return this._assets.getRenderPass(id);
    }

    getRenderPasses(): readonly SceneRenderPassHandle[] {
        return this._assets.getRenderPasses();
    }

    createBoxMesh(
        id: string,
        width: number = 1,
        height: number = 1,
        depth: number = 1
    ): SceneMeshHandle {
        this._assertNotDisposed();
        return this._assets.createBoxMesh(id, width, height, depth);
    }

    createPlaneMesh(id: string, width: number = 1, height: number = 1): SceneMeshHandle {
        this._assertNotDisposed();
        return this._assets.createPlaneMesh(id, width, height);
    }

    createSphereMesh(id: string, radius: number = 1, segments: number = 24): SceneMeshHandle {
        this._assertNotDisposed();
        return this._assets.createSphereMesh(id, radius, segments);
    }

    createPrefab(
        id: string,
        actors: readonly Actor[] = this.world.getAllActors()
    ): ScenePrefabDefinition {
        this._assertNotDisposed();
        return this._actors.createPrefab(id, actors);
    }

    instantiatePrefab(
        prefab: ScenePrefabDefinition,
        options: ScenePrefabInstantiateOptions = {}
    ): readonly Actor[] {
        this._assertNotDisposed();
        return this._actors.instantiatePrefab(prefab, options);
    }

    serializeScene(): SceneSnapshot {
        this._assertNotDisposed();

        return {
            version: 1,
            prefab: this.createPrefab(`${this.id}:prefab`),
            ...this._assets.serializeDefinitions(),
        };
    }

    async loadScene(
        snapshot: SceneSnapshot,
        options: SceneSnapshotLoadOptions = {}
    ): Promise<readonly Actor[]> {
        this._assertNotDisposed();
        return await this._snapshotLoader.load(snapshot, options);
    }

    start(now?: number): this {
        this._assertNotDisposed();
        this.loop.start(now);
        return this;
    }

    pause(): this {
        this._assertNotDisposed();
        this.loop.pause();
        return this;
    }

    resume(now?: number): this {
        this._assertNotDisposed();
        this.loop.resume(now);
        return this;
    }

    stop(): this {
        this._assertNotDisposed();
        this.loop.stop();
        return this;
    }

    renderNow(): this {
        this._assertNotDisposed();
        this._render(0);
        return this;
    }

    resize(
        width: number = this.canvas.clientWidth || DEFAULT_WIDTH,
        height: number = this.canvas.clientHeight || DEFAULT_HEIGHT,
        pixelRatio: number = this._pixelRatio
    ): this {
        this._assertNotDisposed();
        this._pixelRatio = pixelRatio > 0 ? pixelRatio : 1;

        const targetWidth = Math.max(1, Math.floor(width * this._pixelRatio));
        const targetHeight = Math.max(1, Math.floor(height * this._pixelRatio));
        this.canvas.width = targetWidth;
        this.canvas.height = targetHeight;
        this.canvas.style.width = `${width}px`;
        this.canvas.style.height = `${height}px`;
        this.gl.viewport(0, 0, targetWidth, targetHeight);

        return this;
    }

    dispose(): void {
        if (this._disposed) {
            return;
        }

        try {
            this.loop.dispose();
        } catch (error) {
            throw new SceneLifecycleError('Failed to dispose scene loop', error);
        } finally {
            this._assets.dispose();

            if (!this.world.isDisposed) {
                this.world.clear();
            }

            if (
                this._autoCreatedCanvas &&
                this.canvas.parentNode &&
                typeof this.canvas.parentNode.removeChild === 'function'
            ) {
                this.canvas.parentNode.removeChild(this.canvas);
            }

            this._disposed = true;
        }
    }

    private _render(deltaTime: number): void {
        this._renderRuntime.render({
            frame: this.loop.frame,
            elapsedSeconds: this.loop.elapsed / 1000,
            deltaSeconds: deltaTime / 1000,
            viewportWidth: this.canvas.width,
            viewportHeight: this.canvas.height,
        });
    }

    private _assertNotDisposed(): void {
        if (!this._disposed) {
            return;
        }

        throw new SceneLifecycleError('Scene has already been disposed');
    }
}

export const createScene = <R extends ComponentRegistry = Record<string, never>>(
    options: SceneOptions<R> = {}
): Scene<R> => new Scene(options);
