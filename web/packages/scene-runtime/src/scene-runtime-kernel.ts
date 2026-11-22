import { createGameLoop, type GameLoop, type GameLoopSystem } from '@axrone/game-loop';
import { getOrCreateGLContext } from '@axrone/render-webgl2';
import { World } from '@axrone/ecs-runtime';
import { SystemManager, SystemPhase } from '@axrone/ecs-runtime';
import type { ComponentRegistry } from '@axrone/ecs-runtime';
import { SceneActorLifecycleRunner } from './actor-lifecycle-runner';
import { SceneComponentCatalog } from './component-catalog';
import { createSceneLoopSystems } from './loop-bridge';
import type { SceneBatchRuntimeFactory } from './rendering/batch-runtime-contract';
import type { SceneTilemapRenderRuntimeLike } from './rendering/tilemap-render-runtime';
import { SceneRenderRuntime } from './rendering/scene-render-runtime';
import { resolveSceneSurface } from './scene-surface-resolver';
import type { SceneLoopState, SceneOptions, SceneRegistry } from './types';
import { SceneActorRuntime } from './scene-actor-runtime';
import { SceneAssetRuntime } from './scene-asset-runtime';
import { SceneLifecycleRuntime } from './scene-lifecycle-runtime';
import { getCoreSceneRuntimeProfile } from './scene-core-profile';
import {
    resolveSceneRegistryFromProfileWithFallback,
    type SceneRuntimeProfile,
} from './scene-profile-contract';
import {
    resolveSceneRenderCapabilities,
    type SceneRenderCapabilities,
} from './scene-render-capabilities';
import {
    SceneRuntimeProfiler,
    type SceneRuntimeProfilerOptions,
    type SceneRuntimeProfilerPhaseId,
} from './runtime-profiler';
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
import type { PhysicsBridge3DOptions } from './components/physics-bridge-3d';
import type { PhysicsBridge2DOptions } from './components/physics-bridge-2d';

type RuntimeRegistry<R extends ComponentRegistry> = SceneRegistry<R>;

/**
 * Physics bridge profiler surface the kernel forwards to `SceneRuntimeProfiler`.
 * Structural so the kernel never imports a physics engine package.
 */
export interface SceneRuntimePhysicsProfilerStats {
    readonly stepTime: number;
    readonly collisionTime: number;
    readonly solveTime: number;
}

export interface SceneRuntimePhysicsWorldView {
    getProfiler?(): SceneRuntimePhysicsProfilerStats | null;
}

/**
 * Minimal game-loop-system surface the kernel drives for a physics bridge.
 * Root scenes inject concrete `PhysicsBridge3D` / `PhysicsBridge2D` instances;
 * lean scenes inject nothing and therefore keep the physics engine out of the
 * module graph entirely.
 */
export interface SceneRuntimePhysicsBridge {
    readonly id: string;
    readonly physicsWorld?: SceneRuntimePhysicsWorldView;
    beforeUpdate?(context: unknown): void;
    fixedUpdate?(context: unknown): void;
    dispose?(): void;
}

export interface SceneRuntimePhysicsBridgeSelection {
    readonly bridge3D: SceneRuntimePhysicsBridge | null;
    readonly bridge2D: SceneRuntimePhysicsBridge | null;
}

export interface SceneRuntimePhysicsBridgeInput {
    readonly world: World<any>;
    /** Id of the profile resolved for the scene, if the caller supplied one. */
    readonly profileId: string | undefined;
    readonly enableProfiler: boolean;
    readonly physicsBridgeOptions?: PhysicsBridge3DOptions;
    readonly physicsBridge2DOptions?: PhysicsBridge2DOptions;
}

/**
 * Optional runtime composition injected by the scene facade.
 *
 * Both fields are additive: omitting a composition leaves the kernel with the
 * lightweight core registry and no physics bridges, which is what lean scene
 * entries rely on. Full scene entries inject `getDefaultSceneRuntimeComposition`.
 */
export interface SceneRuntimeComposition<
    R extends ComponentRegistry = Record<string, never>,
> {
    /** Registry profile used when `SceneOptions.profile` is omitted. */
    readonly defaultProfile?: SceneRuntimeProfile<R>;
    /**
     * Optional render batch composition (sprite/particle/line/billboard).
     *
     * The kernel forwards it to `SceneRenderRuntime` without importing any
     * batch runtime itself. Root scene entries inject the full set; lean
     * entries inject only the families their registry exposes (or none), so
     * batch component chains stay out of their module graphs.
     */
    readonly createRenderBatchRuntimes?: SceneBatchRuntimeFactory;
    /**
     * Optional tilemap draw sources, forwarded to `SceneRenderRuntime`.
     * Supplying this is the opt-in switch; the kernel never imports the
     * tilemap package itself.
     */
    readonly createTilemapRuntimes?: () => readonly SceneTilemapRenderRuntimeLike[];
    /**
     * Builds the physics bridges the resolved profile needs. The kernel calls
     * this once after the ECS world exists and never imports a physics package.
     */
    readonly createPhysicsBridges?: (
        input: SceneRuntimePhysicsBridgeInput
    ) => SceneRuntimePhysicsBridgeSelection;
}

const EMPTY_PHYSICS_BRIDGES: SceneRuntimePhysicsBridgeSelection = Object.freeze({
    bridge3D: null,
    bridge2D: null,
});

const resolveProfilerPhase = (
    phase: SystemPhase
): SceneRuntimeProfilerPhaseId | null => {
    switch (phase) {
        case SystemPhase.PreUpdate:
            return 'preUpdate';
        case SystemPhase.Update:
            return 'update';
        case SystemPhase.PostUpdate:
            return 'postUpdate';
        case SystemPhase.Render:
            return 'render';
        default:
            return null;
    }
};

export interface SceneRuntimeKernelOptions<
    R extends ComponentRegistry = Record<string, never>,
> {
    readonly sceneId: string;
    readonly options?: SceneOptions<R>;
    readonly physicsBridge?: PhysicsBridge3DOptions;
    readonly physicsBridge2D?: PhysicsBridge2DOptions;
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
    readonly physicsBridge3D: SceneRuntimePhysicsBridge | null;
    readonly physicsBridge2D: SceneRuntimePhysicsBridge | null;
    readonly profiler: SceneRuntimeProfiler;
    /**
     * Render families the resolved registry can produce. Computed once here so
     * the render runtime can skip collectors that are provably empty (a 2D
     * registry has no mesh renderers, lights, particles, lines or billboards).
     */
    readonly renderCapabilities: SceneRenderCapabilities;

    private readonly _executePhaseCallback: (phase: SystemPhase, delta: number) => void;
    private readonly _fixedUpdateActorsCallback: (delta: number) => void;
    private readonly _updateActorsCallback: (delta: number) => void;
    private readonly _lateUpdateActorsCallback: (delta: number) => void;
    private readonly _renderCallback: (delta: number) => void;

    private _currentDelta = 0;
    private _currentSystemPhase: SystemPhase | null = null;
    private readonly _executePhaseInner: () => void;
    private readonly _fixedUpdateInner: () => void;
    private readonly _updateInner: () => void;
    private readonly _lateUpdateInner: () => void;
    private readonly _renderInner: () => void;

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
        const registry = resolveSceneRegistryFromProfileWithFallback(
            sceneOptions.profile,
            sceneOptions.composition?.defaultProfile ?? getCoreSceneRuntimeProfile<R>(),
            {
                registry: sceneOptions.registry ?? ({} as R),
            }
        ) as RuntimeRegistry<R>;
        const componentCatalog = new SceneComponentCatalog(registry);
        this.renderCapabilities = resolveSceneRenderCapabilities(registry);

        const ctx = getOrCreateGLContext(this.gl, this.canvas);

        let renderRuntime!: SceneRenderRuntime;
        this.assets = new SceneAssetRuntime({
            gl: ctx,
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
            planning: sceneOptions.renderPlanning,
            pipeline: sceneOptions.renderPipeline,
            capabilities: this.renderCapabilities,
            stateCache: ctx.state,
            instancing: sceneOptions.instancing,
            batchRuntimes: sceneOptions.composition?.createRenderBatchRuntimes,
            tilemapRuntimes: sceneOptions.composition?.createTilemapRuntimes,
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

        const profilerRequested =
            sceneOptions.profiler === true ||
            (typeof sceneOptions.profiler === 'object' && sceneOptions.profiler !== null);

        // Physics bridges are supplied by the injected composition. Full scene
        // entries install today's profile-selected 3D/2D bridges; lean entries
        // inject nothing, so no physics package reaches their module graph.
        const physicsBridges =
            sceneOptions.composition?.createPhysicsBridges?.({
                world: this.world,
                profileId: sceneOptions.profile?.id,
                enableProfiler: profilerRequested,
                physicsBridgeOptions: options.physicsBridge,
                physicsBridge2DOptions: options.physicsBridge2D,
            }) ?? EMPTY_PHYSICS_BRIDGES;

        this.physicsBridge3D = physicsBridges.bridge3D;
        this.physicsBridge2D = physicsBridges.bridge2D;

        const profilerOptions: SceneRuntimeProfilerOptions =
            typeof sceneOptions.profiler === 'object' && sceneOptions.profiler !== null
                ? sceneOptions.profiler
                : {};
        this.profiler = new SceneRuntimeProfiler({
            ...profilerOptions,
            enabled: profilerOptions.enabled ?? sceneOptions.profiler === true,
        });

        this._executePhaseInner = () => this.systems.executePhase(this._currentSystemPhase!, this._currentDelta);
        this._fixedUpdateInner = () => this.actorLifecycleRunner.fixedUpdate(this._currentDelta);
        this._updateInner = () => this.actorLifecycleRunner.update(this._currentDelta);
        this._lateUpdateInner = () => this.actorLifecycleRunner.lateUpdate(this._currentDelta);
        this._renderInner = () => this.render(this._currentDelta);

        this._executePhaseCallback = (phase, delta) => {
            const profilerPhase = resolveProfilerPhase(phase);
            if (profilerPhase === null) {
                this.systems.executePhase(phase, delta);
                return;
            }
            this._currentDelta = delta;
            this._currentSystemPhase = phase;
            this.profiler.capturePhaseSample(profilerPhase);
            this.profiler.timePhase(profilerPhase, this._executePhaseInner);
        };

        this._fixedUpdateActorsCallback = (delta) => {
            this._currentDelta = delta;
            this.profiler.capturePhaseSample('fixedUpdate');
            this.profiler.timePhase('fixedUpdate', this._fixedUpdateInner);
        };

        this._updateActorsCallback = (delta) => {
            this._currentDelta = delta;
            this.profiler.capturePhaseSample('update');
            this.profiler.timePhase('update', this._updateInner);
        };

        this._lateUpdateActorsCallback = (delta) => {
            this._currentDelta = delta;
            this.profiler.capturePhaseSample('update');
            this.profiler.timePhase('update', this._lateUpdateInner);
        };

        this._renderCallback = (delta) => {
            this._currentDelta = delta;
            this.profiler.capturePhaseSample('render');
            this.profiler.timePhase('render', this._renderInner);
            const stats = this.renderRuntime.stats;
            this.profiler.attachRenderStats({
                drawCalls: stats.drawCalls,
                trianglesSubmitted: stats.trianglesSubmitted,
            });
        };

        const baseLoopSystems = createSceneLoopSystems({
            executePhase: this._executePhaseCallback,
            fixedUpdateActors: this._fixedUpdateActorsCallback,
            updateActors: this._updateActorsCallback,
            lateUpdateActors: this._lateUpdateActorsCallback,
            render: this._renderCallback,
        });

        const loopSystems: readonly GameLoopSystem<SceneLoopState>[] = [
            {
                id: 'scene.profiler',
                priority: 1000,
                beforeUpdate: (ctx) => {
                    this.profiler.beginFrame(ctx.frame, ctx.now, ctx.delta);
                },
                afterFrame: (ctx) => {
                    // Attach physics profiler stats from whichever bridge is active
                    const activeBridge3D = this.physicsBridge3D;
                    if (activeBridge3D) {
                        const physicsProfiler = activeBridge3D.physicsWorld?.getProfiler?.();
                        if (physicsProfiler) {
                            this.profiler.attachPhysicsStats({
                                stepMs: physicsProfiler.stepTime,
                                collisionMs: physicsProfiler.collisionTime,
                                solveMs: physicsProfiler.solveTime,
                            });
                        }
                    }
                    const activeBridge2D = this.physicsBridge2D;
                    if (activeBridge2D) {
                        const physicsProfiler = activeBridge2D.physicsWorld?.getProfiler?.();
                        if (physicsProfiler) {
                            this.profiler.attachPhysicsStats({
                                stepMs: physicsProfiler.stepTime,
                                collisionMs: physicsProfiler.collisionTime,
                                solveMs: physicsProfiler.solveTime,
                            });
                        }
                    }
                    this.profiler.endFrame(ctx.now, ctx.fixedSteps);
                },
            },
            ...baseLoopSystems,
            // 3D physics bridge (injected by the full composition)
            ...(this.physicsBridge3D
                ? [
                      {
                          id: this.physicsBridge3D.id,
                          beforeUpdate: (ctx: any) =>
                              this.physicsBridge3D?.beforeUpdate?.(ctx),
                          fixedUpdate: (ctx: any) =>
                              this.physicsBridge3D?.fixedUpdate?.(ctx),
                          dispose: () => this.physicsBridge3D?.dispose?.(),
                      },
                  ]
                : []),
            // 2D physics bridge (injected by the full composition)
            ...(this.physicsBridge2D
                ? [
                      {
                          id: this.physicsBridge2D.id,
                          beforeUpdate: (ctx: any) =>
                              this.physicsBridge2D?.beforeUpdate?.(ctx),
                          fixedUpdate: (ctx: any) =>
                              this.physicsBridge2D?.fixedUpdate?.(ctx),
                          dispose: () => this.physicsBridge2D?.dispose?.(),
                      },
                  ]
                : []),
        ];

        this.loop = createGameLoop({
            state: { sceneId: options.sceneId },
            scheduler: sceneOptions.scheduler,
            fixedDelta: sceneOptions.fixedDelta,
            maxDelta: sceneOptions.maxDelta,
            maxSubSteps: sceneOptions.maxSubSteps,
            autoStart: false,
            // Pause while the document is hidden so backgrounded tabs and
            // Android activities stop burning CPU/GPU and the physics clock
            // does not jump on resume. game-loop owns the visibility listener.
            pauseWhenHidden: true,
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
                this.profiler.dispose();
                if (!this.world.isDisposed) {
                    this.world.clear();
                }
            },
            onContextRestored: () => {
                // Context-owned GPU caches reference invalidated handles;
                // drop them so the next frame rebuilds resources lazily.
                this.renderRuntime.invalidateContextResources();
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
            alpha: this.loop.interpolationAlpha,
        });
    }

    assertNotDisposed(): void {
        this.lifecycle.assertNotDisposed();
    }
}