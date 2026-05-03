import { createGameLoop, type GameLoop, type GameLoopSystem } from '@axrone/game-loop';
import { World } from '@axrone/ecs-runtime';
import { SystemManager } from '@axrone/ecs-runtime';
import type { ComponentRegistry } from '@axrone/ecs-runtime';
import { SceneActorLifecycleRunner } from './actor-lifecycle-runner';
import { SceneComponentCatalog } from './component-catalog';
import { createSceneLoopSystems } from './loop-bridge';
import { SceneRenderRuntime } from './scene-render-runtime';
import { resolveSceneSurface } from './scene-surface-resolver';
import type { SceneLoopState, SceneOptions, SceneRegistry } from './types';
import { SceneActorRuntime } from './scene-actor-runtime';
import { SceneAssetRuntime } from './scene-asset-runtime';
import { SceneLifecycleRuntime } from './scene-lifecycle-runtime';
import { resolveSceneRegistryFromProfile } from './scene-profile';
import {
    DEFAULT_SCENE_HEIGHT,
    DEFAULT_SCENE_RENDER_PASS_ID,
    DEFAULT_SCENE_WIDTH,
    resolveSceneAmbientLight,
    resolveSceneClearColor,
    resolveSceneGroundLight,
    resolveSceneSkyLight,
} from './scene-runtime-defaults';
import { SceneSnapshotRuntime } from './scene-snapshot-runtime';

type RuntimeRegistry<R extends ComponentRegistry> = SceneRegistry<R>;

export interface SceneRuntimeKernelOptions<
    R extends ComponentRegistry = Record<string, never>,
> {
    readonly sceneId: string;
    readonly options?: SceneOptions<R>;
}

export class SceneRuntimeKernel<R extends ComponentRegistry = Record<string, never>> {
    readonly canvas: HTMLCanvasElement;
    readonly gl: WebGL2RenderingContext;
    readonly world: World<RuntimeRegistry<R>>;
    readonly systems: SystemManager<RuntimeRegistry<R>>;
    readonly loop: GameLoop<SceneLoopState>;
    readonly actors: SceneActorRuntime<R>;
    readonly assets: SceneAssetRuntime;
    readonly actorLifecycleRunner: SceneActorLifecycleRunner;
    readonly renderRuntime: SceneRenderRuntime;
    readonly snapshots: SceneSnapshotRuntime;
    readonly lifecycle: SceneLifecycleRuntime;

    constructor(options: SceneRuntimeKernelOptions<R>) {
        const sceneOptions = options.options ?? {};
        const surface = resolveSceneSurface(sceneOptions);
        this.canvas = surface.canvas;
        this.gl = surface.gl;

        const pixelRatio = sceneOptions.pixelRatio ?? globalThis.devicePixelRatio ?? 1;
        const defaultClearColor = resolveSceneClearColor(sceneOptions.clearColor);
        const ambientLight = resolveSceneAmbientLight(sceneOptions.ambientLight);
        const skyLight = resolveSceneSkyLight(sceneOptions.skyLight);
        const groundLight = resolveSceneGroundLight(sceneOptions.groundLight);
        const registry = resolveSceneRegistryFromProfile(sceneOptions.profile, {
            registry: sceneOptions.registry ?? ({} as R),
        }) as RuntimeRegistry<R>;
        const componentCatalog = new SceneComponentCatalog(registry);

        let renderRuntime!: SceneRenderRuntime;
        this.assets = new SceneAssetRuntime({
            gl: this.gl,
            defaultPassId: DEFAULT_SCENE_RENDER_PASS_ID,
            defaultClearColor,
            releaseBaseMesh: (meshId) => {
                renderRuntime.releaseBaseMesh(meshId);
            },
            clearRenderRuntime: () => {
                renderRuntime.clear();
            },
        });

        this.world = new World(registry, sceneOptions.worldConfig);
        this.systems = new SystemManager(this.world);
        this.actors = new SceneActorRuntime({
            world: this.world,
            componentCatalog,
        });
        this.actorLifecycleRunner = new SceneActorLifecycleRunner({
            getActors: () => this.world.getAllActors(),
        });
        renderRuntime = new SceneRenderRuntime({
            gl: this.gl,
            resources: this.assets.resources,
            ambientLight,
            skyLight,
            groundLight,
            defaultClearColor,
            getActors: () => this.world.getAllActors(),
            createMeshResource: (definition) => this.assets.createMeshResource(definition),
            disposeMesh: (mesh) => this.assets.disposeMesh(mesh),
            applyMissingVertexAttributeDefaults: (mesh) =>
                this.assets.applyMissingVertexAttributeDefaults(mesh),
        });
        this.renderRuntime = renderRuntime;
        this.snapshots = new SceneSnapshotRuntime({
            sceneId: options.sceneId,
            defaultRenderPassId: DEFAULT_SCENE_RENDER_PASS_ID,
            defaultClearColor,
            actors: this.actors,
            assets: this.assets,
        });
        this.snapshots.initializeRenderPasses(sceneOptions.renderPasses);

        const loopSystems: readonly GameLoopSystem<SceneLoopState>[] = createSceneLoopSystems({
            executePhase: (phase, delta) => {
                this.systems.executePhase(phase, delta);
            },
            fixedUpdateActors: (delta) => {
                this.actorLifecycleRunner.fixedUpdate(delta);
            },
            updateActors: (delta) => {
                this.actorLifecycleRunner.update(delta);
            },
            lateUpdateActors: (delta) => {
                this.actorLifecycleRunner.lateUpdate(delta);
            },
            render: (delta) => {
                this.render(delta);
            },
        });

        this.loop = createGameLoop({
            state: { sceneId: options.sceneId },
            scheduler: sceneOptions.scheduler,
            fixedDelta: sceneOptions.fixedDelta,
            maxDelta: sceneOptions.maxDelta,
            maxSubSteps: sceneOptions.maxSubSteps,
            autoStart: false,
            systems: loopSystems,
            errorPolicy: 'throw',
        });
        this.lifecycle = new SceneLifecycleRuntime({
            canvas: this.canvas,
            gl: this.gl,
            loop: this.loop,
            autoCreatedCanvas: surface.autoCreated,
            pixelRatio,
            defaultWidth: DEFAULT_SCENE_WIDTH,
            defaultHeight: DEFAULT_SCENE_HEIGHT,
            render: (deltaTime) => {
                this.render(deltaTime);
            },
            disposeAssets: () => {
                this.assets.dispose();
            },
            disposeWorld: () => {
                if (!this.world.isDisposed) {
                    this.world.clear();
                }
            },
        });
        this.lifecycle.resize(sceneOptions.width, sceneOptions.height, pixelRatio);
    }

    render(deltaTime: number): void {
        this.renderRuntime.render({
            frame: this.loop.frame,
            elapsedSeconds: this.loop.elapsed / 1000,
            deltaSeconds: deltaTime / 1000,
            viewportWidth: this.canvas.width,
            viewportHeight: this.canvas.height,
        });
    }

    assertNotDisposed(): void {
        this.lifecycle.assertNotDisposed();
    }
}