import { Vec4 } from '@axrone/numeric';
import { createGameLoop, type GameLoop, type GameLoopSystem } from '../game-loop';
import { Actor, type ActorConfig } from '../component-system/core/actor';
import { World } from '../component-system/core/world';
import { SystemManager, SystemPhase } from '../component-system/systems/system-manager';
import type { ComponentConstructor, ComponentRegistry } from '../component-system/types/core';
import type { System, SystemQuery } from '../component-system/types/system';
import type { CameraConfig } from './components/camera';
import type { MeshRendererConfig } from './components/mesh-renderer';
import { SceneActorLifecycleRunner } from './actor-lifecycle-runner';
import { SceneActorRuntime } from './scene-actor-runtime';
import { SceneAssetRuntime } from './scene-asset-runtime';
import { SceneComponentCatalog } from './component-catalog';
import { createSceneLoopSystems } from './loop-bridge';
import { SceneLifecycleRuntime } from './scene-lifecycle-runtime';
import { SceneRenderRuntime } from './scene-render-runtime';
import { SceneSnapshotRuntime } from './scene-snapshot-runtime';
import { resolveSceneSurface } from './scene-surface-resolver';
import { SceneMaterialError } from './errors';
import { resolveSceneRegistryFromProfile } from './profile';
import {
    DEFAULT_SCENE_HEIGHT,
    DEFAULT_SCENE_RENDER_PASS_ID,
    DEFAULT_SCENE_WIDTH,
    resolveSceneAmbientLight,
    resolveSceneClearColor,
} from './scene-runtime-defaults';
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

const createId = (prefix: string): string =>
    `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;

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

    private readonly _actors: SceneActorRuntime<R>;
    private readonly _assets: SceneAssetRuntime;
    private readonly _actorLifecycleRunner: SceneActorLifecycleRunner;
    private readonly _renderRuntime: SceneRenderRuntime;
    private readonly _snapshots: SceneSnapshotRuntime;
    private readonly _lifecycle: SceneLifecycleRuntime;

    constructor(options: SceneOptions<R> = {}) {
        this.id = createId('scene');
        const surface = resolveSceneSurface(options);
        this.canvas = surface.canvas;
        this.gl = surface.gl;
        const pixelRatio = options.pixelRatio ?? globalThis.devicePixelRatio ?? 1;
        const defaultClearColor = resolveSceneClearColor(options.clearColor);
        const ambientLight = resolveSceneAmbientLight(options.ambientLight);
        this._assets = new SceneAssetRuntime({
            gl: this.gl,
            defaultPassId: DEFAULT_SCENE_RENDER_PASS_ID,
            defaultClearColor,
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
            defaultClearColor,
            getActors: () => this.world.getAllActors(),
            createMeshResource: (definition) => this._assets.createMeshResource(definition),
            disposeMesh: (mesh) => this._assets.disposeMesh(mesh),
            applyMissingVertexAttributeDefaults: (mesh) =>
                this._assets.applyMissingVertexAttributeDefaults(mesh),
        });

        const registry = resolveSceneRegistryFromProfile(options.profile, {
            registry: options.registry ?? ({} as R),
        }) as RuntimeRegistry<R>;
        const componentCatalog = new SceneComponentCatalog(registry);

        this.world = new World(registry, options.worldConfig);
        this.systems = new SystemManager(this.world);
        this._actors = new SceneActorRuntime({
            world: this.world,
            componentCatalog,
        });
        this._actorLifecycleRunner = new SceneActorLifecycleRunner({
            getActors: () => this.world.getAllActors(),
        });
        this._snapshots = new SceneSnapshotRuntime({
            sceneId: this.id,
            defaultRenderPassId: DEFAULT_SCENE_RENDER_PASS_ID,
            defaultClearColor,
            actors: this._actors,
            assets: this._assets,
        });
        this._snapshots.initializeRenderPasses(options.renderPasses);

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
        this._lifecycle = new SceneLifecycleRuntime({
            canvas: this.canvas,
            gl: this.gl,
            loop: this.loop,
            autoCreatedCanvas: surface.autoCreated,
            pixelRatio,
            defaultWidth: DEFAULT_SCENE_WIDTH,
            defaultHeight: DEFAULT_SCENE_HEIGHT,
            render: (deltaTime) => {
                this._render(deltaTime);
            },
            disposeAssets: () => {
                this._assets.dispose();
            },
            disposeWorld: () => {
                if (!this.world.isDisposed) {
                    this.world.clear();
                }
            },
        });
        this._lifecycle.resize(options.width, options.height, pixelRatio);

        if (options.autoStart !== false) {
            this.start();
        }
    }

    get status() {
        return this._lifecycle.status;
    }

    get isDisposed(): boolean {
        return this._lifecycle.isDisposed;
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
        return this._assets.getMaterialTextureBinding(materialId, uniformName);
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
        return this._snapshots.createPrefab(id, actors);
    }

    instantiatePrefab(
        prefab: ScenePrefabDefinition,
        options: ScenePrefabInstantiateOptions = {}
    ): readonly Actor[] {
        this._assertNotDisposed();
        return this._snapshots.instantiatePrefab(prefab, options);
    }

    serializeScene(): SceneSnapshot {
        this._assertNotDisposed();
        return this._snapshots.serializeScene();
    }

    async loadScene(
        snapshot: SceneSnapshot,
        options: SceneSnapshotLoadOptions = {}
    ): Promise<readonly Actor[]> {
        this._assertNotDisposed();
        return await this._snapshots.loadScene(snapshot, options);
    }

    start(now?: number): this {
        this._lifecycle.start(now);
        return this;
    }

    pause(): this {
        this._lifecycle.pause();
        return this;
    }

    resume(now?: number): this {
        this._lifecycle.resume(now);
        return this;
    }

    stop(): this {
        this._lifecycle.stop();
        return this;
    }

    renderNow(): this {
        this._lifecycle.renderNow();
        return this;
    }

    resize(
        width: number = this.canvas.clientWidth || DEFAULT_SCENE_WIDTH,
        height: number = this.canvas.clientHeight || DEFAULT_SCENE_HEIGHT,
        pixelRatio?: number
    ): this {
        this._lifecycle.resize(width, height, pixelRatio);
        return this;
    }

    dispose(): void {
        this._lifecycle.dispose();
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
        this._lifecycle.assertNotDisposed();
    }
}

export const createScene = <R extends ComponentRegistry = Record<string, never>>(
    options: SceneOptions<R> = {}
): Scene<R> => new Scene(options);
