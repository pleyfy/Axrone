import { Vec4 } from '@axrone/numeric';
import type { GameLoop } from '../game-loop';
import { Actor, type ActorConfig } from '../component-system/core/actor';
import { World } from '../component-system/core/world';
import { SystemManager, SystemPhase } from '../component-system/systems/system-manager';
import type { ComponentConstructor, ComponentRegistry } from '../component-system/types/core';
import type { System, SystemQuery } from '../component-system/types/system';
import type { CameraConfig } from './components/camera';
import type { MeshRendererConfig } from './components/mesh-renderer';
import { SceneMaterialError } from './errors';
import { Scene3DActorRuntime } from './scene-3d-actor-runtime';
import {
    DEFAULT_SCENE_HEIGHT,
    DEFAULT_SCENE_WIDTH,
} from './scene-runtime-defaults';
import { SceneRuntimeKernel } from './scene-runtime-kernel';
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

    private readonly _kernel: SceneRuntimeKernel<R>;
    private readonly _actors3d: Scene3DActorRuntime<R>;

    constructor(options: SceneOptions<R> = {}) {
        this.id = createId('scene');
        this._kernel = new SceneRuntimeKernel({
            sceneId: this.id,
            options,
        });
        this._actors3d = new Scene3DActorRuntime({
            actors: this._kernel.actors,
        });
        this.canvas = this._kernel.canvas;
        this.gl = this._kernel.gl;
        this.world = this._kernel.world;
        this.systems = this._kernel.systems;
        this.loop = this._kernel.loop;

        if (options.autoStart !== false) {
            this.start();
        }
    }

    get status() {
        return this._kernel.lifecycle.status;
    }

    get isDisposed(): boolean {
        return this._kernel.lifecycle.isDisposed;
    }

    get renderStats() {
        return this._kernel.renderRuntime.stats;
    }

    registerComponent<T extends ComponentConstructor>(componentType: T): this {
        this._assertNotDisposed();
        this._kernel.actors.registerComponent(componentType);
        return this;
    }

    isComponentRegistered(componentTypeOrName: string | ComponentConstructor): boolean {
        this._assertNotDisposed();
        return this._kernel.actors.isComponentRegistered(componentTypeOrName);
    }

    getRegisteredComponentNames(): readonly string[] {
        this._assertNotDisposed();
        return this._kernel.actors.getRegisteredComponentNames();
    }

    createActor(config: ActorConfig = {}): Actor<World<RuntimeRegistry<R>>> {
        this._assertNotDisposed();
        return this._kernel.actors.createActor(config);
    }

    createCameraActor(
        actorConfig: ActorConfig = {},
        cameraConfig: CameraConfig = {}
    ): Actor<World<RuntimeRegistry<R>>> {
        this._assertNotDisposed();
        return this._actors3d.createCameraActor(actorConfig, cameraConfig);
    }

    createRenderableActor(
        actorConfig: ActorConfig = {},
        rendererConfig: MeshRendererConfig = {}
    ): Actor<World<RuntimeRegistry<R>>> {
        this._assertNotDisposed();
        return this._actors3d.createRenderableActor(actorConfig, rendererConfig);
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
        return this._kernel.assets.registerShader(definition);
    }

    getShader(id: string): SceneShaderHandle | null {
        return this._kernel.assets.getShader(id);
    }

    createMaterial(definition: SceneMaterialDefinition): SceneMaterialHandle {
        this._assertNotDisposed();
        try {
            return this._kernel.assets.createMaterial(definition);
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
        if (!this._kernel.assets.setMaterialUniform(materialId, name, value)) {
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
        if (!this._kernel.assets.setMaterialTexture(materialId, name, binding)) {
            throw new SceneMaterialError(`Material '${materialId}' is not registered`);
        }

        return this;
    }

    getMaterial(materialId: string): SceneMaterialHandle | null {
        return this._kernel.assets.getMaterial(materialId);
    }

    registerMesh(definition: SceneMeshDefinition): SceneMeshHandle {
        this._assertNotDisposed();
        return this._kernel.assets.registerMesh(definition);
    }

    getMesh(id: string): SceneMeshHandle | null {
        return this._kernel.assets.getMesh(id);
    }

    registerSampler(definition: SceneSamplerDefinition): SceneSamplerHandle {
        this._assertNotDisposed();
        return this._kernel.assets.registerSampler(definition);
    }

    getSampler(id: string): SceneSamplerHandle | null {
        return this._kernel.assets.getSampler(id);
    }

    async registerTexture(definition: SceneTextureDefinition): Promise<SceneTextureHandle> {
        this._assertNotDisposed();
        return await this._kernel.assets.registerTexture(definition);
    }

    getTexture(id: string): SceneTextureHandle | null {
        return this._kernel.assets.getTexture(id);
    }

    getTextureResource(id: string): SceneTextureResourceHandle | null {
        return this._kernel.assets.getTextureResource(id);
    }

    getMaterialTextureBindings(materialId: string): readonly SceneMaterialTextureBindingHandle[] {
        return this._kernel.assets.getMaterialTextureBindings(materialId);
    }

    getMaterialTextureBinding(
        materialId: string,
        uniformName?: string
    ): SceneMaterialTextureBindingHandle | null {
        return this._kernel.assets.getMaterialTextureBinding(materialId, uniformName);
    }

    registerRenderPass(definition: SceneRenderPassDefinition): SceneRenderPassHandle {
        this._assertNotDisposed();
        return this._kernel.assets.registerRenderPass(definition);
    }

    getRenderPass(id: string): SceneRenderPassHandle | null {
        return this._kernel.assets.getRenderPass(id);
    }

    getRenderPasses(): readonly SceneRenderPassHandle[] {
        return this._kernel.assets.getRenderPasses();
    }

    createBoxMesh(
        id: string,
        width: number = 1,
        height: number = 1,
        depth: number = 1
    ): SceneMeshHandle {
        this._assertNotDisposed();
        return this._kernel.assets.createBoxMesh(id, width, height, depth);
    }

    createPlaneMesh(id: string, width: number = 1, height: number = 1): SceneMeshHandle {
        this._assertNotDisposed();
        return this._kernel.assets.createPlaneMesh(id, width, height);
    }

    createSphereMesh(id: string, radius: number = 1, segments: number = 24): SceneMeshHandle {
        this._assertNotDisposed();
        return this._kernel.assets.createSphereMesh(id, radius, segments);
    }

    createPrefab(
        id: string,
        actors: readonly Actor[] = this.world.getAllActors()
    ): ScenePrefabDefinition {
        this._assertNotDisposed();
        return this._kernel.snapshots.createPrefab(id, actors);
    }

    instantiatePrefab(
        prefab: ScenePrefabDefinition,
        options: ScenePrefabInstantiateOptions = {}
    ): readonly Actor[] {
        this._assertNotDisposed();
        return this._kernel.snapshots.instantiatePrefab(prefab, options);
    }

    serializeScene(): SceneSnapshot {
        this._assertNotDisposed();
        return this._kernel.snapshots.serializeScene();
    }

    async loadScene(
        snapshot: SceneSnapshot,
        options: SceneSnapshotLoadOptions = {}
    ): Promise<readonly Actor[]> {
        this._assertNotDisposed();
        return await this._kernel.snapshots.loadScene(snapshot, options);
    }

    start(now?: number): this {
        this._kernel.lifecycle.start(now);
        return this;
    }

    pause(): this {
        this._kernel.lifecycle.pause();
        return this;
    }

    resume(now?: number): this {
        this._kernel.lifecycle.resume(now);
        return this;
    }

    stop(): this {
        this._kernel.lifecycle.stop();
        return this;
    }

    renderNow(): this {
        this._kernel.lifecycle.renderNow();
        return this;
    }

    resize(
        width: number = this.canvas.clientWidth || DEFAULT_SCENE_WIDTH,
        height: number = this.canvas.clientHeight || DEFAULT_SCENE_HEIGHT,
        pixelRatio?: number
    ): this {
        this._kernel.lifecycle.resize(width, height, pixelRatio);
        return this;
    }

    dispose(): void {
        this._kernel.lifecycle.dispose();
    }

    private _assertNotDisposed(): void {
        this._kernel.assertNotDisposed();
    }
}

export const createScene = <R extends ComponentRegistry = Record<string, never>>(
    options: SceneOptions<R> = {}
): Scene<R> => new Scene(options);
