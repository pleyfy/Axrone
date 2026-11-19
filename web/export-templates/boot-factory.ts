import {
    Component,
    getComponentMetadata,
    type ComponentConstructor,
} from '@axrone/ecs-runtime';
import { Camera } from '@axrone/scene-runtime/scene-facade';
import {
    SCENE_2D_RUNTIME_PROFILE_ID,
    SCENE_MIXED_RUNTIME_PROFILE_ID,
    get2DSceneRuntimeProfile,
    getMixedSceneRuntimeProfile,
    type SceneRuntimeProfile,
} from '@axrone/scene-runtime';
import { PrefabNodeBinding } from '@axrone/scene-prefab';
import type { SceneSnapshot } from '@axrone/scene-runtime';
import {
    decodeAxroneGameData,
    type AxroneGameData,
    type AxroneGameDataComponentState,
    type AxroneGameDataScriptEntry,
} from './game-data';

export type AxroneBootOptions = {
    readonly container?: HTMLElement | string | null;
    readonly dataUrl?: string;
    readonly data?: unknown;
    readonly scriptTypes?: readonly ComponentConstructor[];
    readonly onProgress?: (stage: string) => void;
};

export type BootSceneFacade = {
    readonly canvas: HTMLCanvasElement;
    readonly world: {
        getAllActors(): readonly {
            getComponent<T extends ComponentConstructor>(type: T): InstanceType<T> | null;
            getAllComponents(): readonly Component[];
        }[];
    };
    registerComponent(componentType: ComponentConstructor): unknown;
    loadScene(snapshot: SceneSnapshot, options?: { clearExisting?: boolean }): Promise<unknown>;
    resize(width: number, height: number, pixelRatio?: number): void;
    dispose(): void;
};

export type AxroneRuntimeHandle = {
    readonly scene: BootSceneFacade;
    readonly data: AxroneGameData;
    dispose(): void;
};

export type AxroneBootDependencies = {
    readonly createScene: (options: Record<string, unknown>) => BootSceneFacade;
    readonly engineComponentTypes: readonly ComponentConstructor[];
    readonly resolveSceneProfile?: (
        snapshot: unknown,
        engineProfileId?: string
    ) => SceneRuntimeProfile | undefined;
};

const DEFAULT_DATA_URL = './game.data.json';

const resolveContainer = (container: HTMLElement | string | null | undefined): HTMLElement => {
    if (container instanceof HTMLElement) {
        return container;
    }

    if (typeof container === 'string') {
        const resolved = document.querySelector(container);
        if (resolved instanceof HTMLElement) {
            return resolved;
        }

        throw new Error(`Axrone runtime cannot resolve container '${container}'.`);
    }

    return document.body;
};

const resolveModuleUrl = (dataUrl: string, modulePath: string): string =>
    new URL(modulePath, new URL(dataUrl, document.baseURI)).href;

const isScriptComponentType = (value: unknown): value is ComponentConstructor =>
    typeof value === 'function' &&
    (value as { prototype?: unknown }).prototype instanceof Component &&
    Boolean(getComponentMetadata(value as ComponentConstructor));

const resolveScriptComponentType = (
    moduleExports: Record<string, unknown>,
    entry: AxroneGameDataScriptEntry
): ComponentConstructor => {
    const candidates = Object.values(moduleExports).filter(isScriptComponentType);

    const directMatch = entry.className ? moduleExports[entry.className] : undefined;
    if (isScriptComponentType(directMatch)) {
        return directMatch;
    }

    const metadataMatch = candidates.find(
        (candidate) => getComponentMetadata(candidate)?.scriptName === entry.scriptName
    );
    if (metadataMatch) {
        return metadataMatch;
    }

    const classNameMatch = entry.className
        ? candidates.find((candidate) => candidate.name === entry.className)
        : undefined;
    if (classNameMatch) {
        return classNameMatch;
    }

    if (candidates.length === 1) {
        return candidates[0];
    }

    throw new Error(
        `Axrone runtime cannot resolve script component '${entry.className || entry.scriptName}' in '${entry.modulePath}'.`
    );
};

const loadScriptComponentTypes = async (
    dataUrl: string,
    scripts: readonly AxroneGameDataScriptEntry[]
): Promise<readonly ComponentConstructor[]> => {
    const componentTypes: ComponentConstructor[] = [];
    const moduleCache = new Map<string, Record<string, unknown>>();

    for (const entry of scripts) {
        const moduleUrl = resolveModuleUrl(dataUrl, entry.modulePath);
        let moduleExports = moduleCache.get(moduleUrl);
        if (!moduleExports) {
            moduleExports = (await import(/* @vite-ignore */ moduleUrl)) as Record<string, unknown>;
            moduleCache.set(moduleUrl, moduleExports);
        }

        componentTypes.push(resolveScriptComponentType(moduleExports, entry));
    }

    return componentTypes;
};

const resolveComponentTypeName = (component: Component): string =>
    getComponentMetadata(component.constructor as ComponentConstructor)?.scriptName ??
    component.constructor.name;

const applyComponentStates = (
    scene: BootSceneFacade,
    statesByNodeId: ReadonlyMap<string, readonly AxroneGameDataComponentState[]>
): void => {
    for (const actor of scene.world.getAllActors()) {
        const nodeId = actor.getComponent(PrefabNodeBinding)?.nodeId;
        if (!nodeId) {
            continue;
        }

        const componentStates = statesByNodeId.get(nodeId);
        if (!componentStates || componentStates.length === 0) {
            continue;
        }

        const occurrences = new Map<string, number>();
        for (const component of actor.getAllComponents()) {
            const type = resolveComponentTypeName(component);
            const occurrenceIndex = occurrences.get(type) ?? 0;
            occurrences.set(type, occurrenceIndex + 1);

            const matchedState = componentStates.find(
                (candidate) =>
                    candidate.type === type && candidate.occurrenceIndex === occurrenceIndex
            );
            if (matchedState) {
                component.enabled = matchedState.enabled;
            }
        }
    }
};

const applyCameraSelection = (scene: BootSceneFacade, cameraEntityId: string | null): void => {
    let matched = false;
    let fallbackCamera: Camera | null = null;

    for (const actor of scene.world.getAllActors()) {
        const camera = actor.getComponent(Camera);
        if (!camera) {
            continue;
        }

        fallbackCamera ??= camera;
        const isMatch = Boolean(
            cameraEntityId && actor.getComponent(PrefabNodeBinding)?.nodeId === cameraEntityId
        );
        camera.primary = isMatch;
        matched ||= isMatch;
    }

    if (!matched && fallbackCamera) {
        fallbackCamera.primary = true;
    }
};

// Component type names that imply 2D physics/rendering, kept in lockstep with
// PREVIEW_2D_COMPONENT_TYPES in the Editor. The scene kernel arms PhysicsBridge2D
// purely from the active profile id, so to boot an exported 2D/mixed scene under
// the generic `Scene` facade (web-full) we must pick the profile from the scene
// content before constructing it.
const SCENE_2D_COMPONENT_TYPE_NAMES: ReadonlySet<string> = new Set([
    'PhysicsWorld2DComponent',
    'Rigidbody2D',
    'BoxCollider2D',
    'CircleCollider2D',
    'CapsuleCollider2D',
    'PolygonCollider2D',
    'DistanceJoint2D',
    'FixedJoint2D',
    'HingeJoint2D',
    'SliderJoint2D',
    'SpringJoint2D',
    'WheelJoint2D',
    'MotorJoint2D',
    'MouseJoint2D',
    'GearJoint2D',
    'RopeJoint2D',
    'SpriteRenderer',
    'SpriteAnimator',
    'SpriteMask',
]);

const SCENE_3D_COMPONENT_TYPE_NAMES: ReadonlySet<string> = new Set([
    'Rigidbody3D',
    'BoxCollider3D',
    'SphereCollider3D',
    'CapsuleCollider3D',
    'MeshCollider3D',
    'HingeJoint3D',
    'FixedJoint3D',
    'MeshRenderer',
    'SkinnedMeshRenderer',
    'Terrain',
    'DirectionalLight',
    'PointLight',
    'SpotLight',
    'ParticleSystem',
]);

const collectSnapshotComponentTypes = (
    node: unknown,
    accumulator: Set<string>
): void => {
    if (Array.isArray(node)) {
        for (const entry of node) {
            collectSnapshotComponentTypes(entry, accumulator);
        }
        return;
    }

    if (!node || typeof node !== 'object') {
        return;
    }

    const record = node as Record<string, unknown>;
    const components = record.components;
    if (Array.isArray(components)) {
        for (const component of components) {
            if (component && typeof component === 'object') {
                const type = (component as Record<string, unknown>).type;
                if (typeof type === 'string') {
                    accumulator.add(type);
                }
            }
        }
    }

    for (const value of Object.values(record)) {
        collectSnapshotComponentTypes(value, accumulator);
    }
};

/**
 * Picks the scene runtime profile that arms the right physics bridges.
 *
 * 2D-only content -> 2D profile (bridge2D only)
 * 2D + 3D content -> mixed profile (both bridges)
 * 3D-only / none  -> undefined, so the facade keeps its default 3D profile.
 *
 * The game-data `engine.profileId` carries the export *template* id (e.g.
 * '@axrone/runtime-profile-full'), never the per-scene profile id, so it is only
 * consulted as a fallback hint when the snapshot yields no signal.
 */
export const resolveSceneProfile = (
    snapshot: unknown,
    engineProfileId?: string
): SceneRuntimeProfile | undefined => {
    const types = new Set<string>();
    collectSnapshotComponentTypes(snapshot, types);

    let has2D = false;
    let has3D = false;
    for (const type of types) {
        if (SCENE_2D_COMPONENT_TYPE_NAMES.has(type)) {
            has2D = true;
        } else if (SCENE_3D_COMPONENT_TYPE_NAMES.has(type)) {
            has3D = true;
        }
    }

    if (has2D && has3D) {
        return getMixedSceneRuntimeProfile();
    }
    if (has2D) {
        return get2DSceneRuntimeProfile();
    }

    // No 2D/3D discriminator in the snapshot: fall back to explicit ids when the
    // document carries a scene profile id rather than a template id.
    if (engineProfileId === SCENE_MIXED_RUNTIME_PROFILE_ID) {
        return getMixedSceneRuntimeProfile();
    }
    if (engineProfileId === SCENE_2D_RUNTIME_PROFILE_ID) {
        return get2DSceneRuntimeProfile();
    }

    return undefined;
};

const fetchGameData = async (dataUrl: string): Promise<AxroneGameData> => {
    const response = await fetch(dataUrl, { cache: 'no-cache' });
    if (!response.ok) {
        throw new Error(
            `Axrone runtime cannot load game data from '${dataUrl}' (${response.status}).`
        );
    }

    return decodeAxroneGameData(await response.json());
};

export const createAxroneBoot =
    (dependencies: AxroneBootDependencies) =>
    async (options: AxroneBootOptions = {}): Promise<AxroneRuntimeHandle> => {
        const dataUrl = options.dataUrl ?? DEFAULT_DATA_URL;
        const container = resolveContainer(options.container);
        const reportProgress = (stage: string): void => {
            options.onProgress?.(stage);
        };

        reportProgress('loading-data');
        const data = options.data
            ? decodeAxroneGameData(options.data)
            : await fetchGameData(dataUrl);

        reportProgress('creating-scene');
        const sceneProfile = dependencies.resolveSceneProfile
            ? dependencies.resolveSceneProfile(data.snapshot, data.engine.profileId)
            : resolveSceneProfile(data.snapshot, data.engine.profileId);
        const scene = dependencies.createScene({
            width: container.clientWidth || data.presentation.width,
            height: container.clientHeight || data.presentation.height,
            autoStart: true,
            parent: container,
            appendToDom: true,
            createCanvas: () => document.createElement('canvas'),
            clearColor: data.environment.clearColor,
            ambientLight: data.environment.ambientLight,
            skyLight: data.environment.skyLight,
            groundLight: data.environment.groundLight,
            ...(sceneProfile ? { profile: sceneProfile } : {}),
        });

        scene.canvas.style.display = 'block';
        scene.canvas.style.width = '100%';
        scene.canvas.style.height = '100%';

        const resizeScene = (): void => {
            scene.resize(
                container.clientWidth || data.presentation.width,
                container.clientHeight || data.presentation.height,
                window.devicePixelRatio || 1
            );
        };

        const resizeObserver = new ResizeObserver(() => {
            resizeScene();
        });
        resizeObserver.observe(container);
        resizeScene();

        reportProgress('loading-scripts');
        const scriptComponentTypes = options.scriptTypes && options.scriptTypes.length > 0
            ? [...options.scriptTypes]
            : await loadScriptComponentTypes(dataUrl, data.scripts);

        for (const componentType of dependencies.engineComponentTypes) {
            scene.registerComponent(componentType);
        }
        for (const componentType of scriptComponentTypes) {
            scene.registerComponent(componentType);
        }

        reportProgress('loading-scene');
        await scene.loadScene(data.snapshot as SceneSnapshot, { clearExisting: false });

        applyComponentStates(
            scene,
            new Map(data.componentStates.map((entry) => [entry.nodeId, entry.states]))
        );
        applyCameraSelection(scene, data.cameraEntityId);

        // UIHost initialization: resolve the scene-host binding module from the
        // __AXRONE_RUNTIME__ global (set by the generated export template entry)
        // and wire every UIHost component to its .ui.json asset so the UI overlay
        // renders on top of the 3D scene.
        const uiAssetContent = (data.uiAssets ?? {}) as Record<string, unknown>;
        const uiAssetKeys = Object.keys(uiAssetContent);
        console.log(`[Axrone Boot] UI assets: ${uiAssetKeys.length} found`, uiAssetKeys);

        if (uiAssetKeys.length > 0) {
            const axroneRuntime = (globalThis as Record<string, unknown>).__AXRONE_RUNTIME__ as
                | { readonly modules?: Record<string, unknown> }
                | undefined;
            console.log(`[Axrone Boot] __AXRONE_RUNTIME__:`, axroneRuntime ? 'present' : 'MISSING');

            const uiHostModule = axroneRuntime?.modules?.['@axrone/ui-webgl2/scene-host'] as
                | Record<string, unknown>
                | undefined;
            console.log(`[Axrone Boot] ui-webgl2/scene-host module:`, uiHostModule ? 'found' : 'MISSING');

            const bindUIHosts = uiHostModule?.['bindUIHostsToScene'];
            console.log(`[Axrone Boot] bindUIHostsToScene:`, typeof bindUIHosts === 'function' ? 'found' : 'MISSING');

            if (typeof bindUIHosts === 'function') {
                const resolveAssetJson = (assetId: string): string | null => {
                    const asset = uiAssetContent[assetId];
                    return asset ? JSON.stringify(asset) : null;
                };

                const bindingOptions = {
                    scene,
                    resolveAssetJson,
                    input: {
                        target: container,
                        keyboard: true,
                    },
                };

                let bindingSucceeded = false;
                try {
                    const result = (bindUIHosts as (options: Record<string, unknown>) => { handles?: readonly unknown[] })(bindingOptions);
                    console.log(`[Axrone Boot] bindUIHostsToScene result:`, result?.handles?.length ?? 0, 'handle(s)');
                    bindingSucceeded = (result?.handles?.length ?? 0) > 0;
                } catch (error) {
                    console.error(`[Axrone Boot] bindUIHostsToScene threw:`, error);
                }

                // Fallback: if bindUIHostsToScene bound zero hosts (e.g., getAllInstances
                // returned empty due to class identity mismatch in the bundle), walk actors
                // directly and collect UIHost components via getComponent.
                const UIHostClass = uiHostModule?.['UIHost'];
                if (typeof UIHostClass === 'function') {
                    const allInstances = (UIHostClass as { getAllInstances?: () => unknown[] }).getAllInstances?.() ?? [];
                    console.log(`[Axrone Boot] UIHost.getAllInstances(): ${allInstances.length} instance(s)`);

                    if (allInstances.length === 0 || !bindingSucceeded) {
                        const hosts: unknown[] = [];
                        for (const actor of scene.world.getAllActors()) {
                            const uiHost = actor.getComponent(UIHostClass as never);
                            if (uiHost) {
                                hosts.push(uiHost);
                            }
                        }
                        console.log(`[Axrone Boot] Fallback: found ${hosts.length} UIHost(s) via actor walk`);

                        if (hosts.length > 0) {
                            try {
                                (bindUIHosts as (options: Record<string, unknown>) => void)({
                                    ...bindingOptions,
                                    hosts,
                                });
                                console.log(`[Axrone Boot] Fallback binding succeeded`);
                            } catch (fallbackError) {
                                console.error(`[Axrone Boot] Fallback binding also failed:`, fallbackError);
                            }
                        }
                    }
                }
            }
        }

        reportProgress('ready');

        return {
            scene,
            data,
            dispose() {
                resizeObserver.disconnect();
                scene.dispose();
            },
        };
    };
