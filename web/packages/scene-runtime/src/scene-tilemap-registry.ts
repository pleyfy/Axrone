import type { ComponentRegistry } from '@axrone/ecs-runtime';
import { TilemapAgent } from './components/tilemap-agent';
import { TilemapCollider2D } from './components/tilemap-collider-2d';
import { TilemapRenderer } from './components/tilemap-renderer';
import {
    createSceneBuiltInManifest,
    createSceneRegistryFromBuiltInManifestsWithSource,
    createSceneRegistryWithSource,
    type SceneBuiltInManifest,
    type SceneBuiltInRegistrySource,
    type SceneManifestRegistryBuilderOptions,
    type SceneRegistryBuilderOptions,
} from './scene-built-in-support';
import {
    DEFAULT_SCENE_2D_BUILT_IN_MANIFESTS,
    get2DSceneBuiltInRegistrySource,
} from './scene-2d-registry';
import type { SceneRegistry } from './types';

const SCENE_TILEMAP_BUILT_IN_REGISTRY_SOURCE: SceneBuiltInRegistrySource = Object.freeze({
    ...get2DSceneBuiltInRegistrySource(),
    TilemapRenderer,
    TilemapCollider2D,
    TilemapAgent,
});

export const SCENE_TILEMAP_BUILT_IN_MANIFEST = createSceneBuiltInManifest({
    id: 'scene/tilemap',
    builtIns: ['TilemapRenderer', 'TilemapCollider2D', 'TilemapAgent'] as const,
});

export const TILEMAP_SCENE_BUILT_IN_MANIFESTS = Object.freeze([
    ...DEFAULT_SCENE_2D_BUILT_IN_MANIFESTS,
    SCENE_TILEMAP_BUILT_IN_MANIFEST,
]) as readonly SceneBuiltInManifest[];

export const getTilemapSceneBuiltInRegistrySource = (): SceneBuiltInRegistrySource => ({
    ...SCENE_TILEMAP_BUILT_IN_REGISTRY_SOURCE,
});

/** Opt-in registry: the full 2D set plus tilemap components. */
export const createTilemapSceneRegistry = <
    R extends ComponentRegistry = Record<string, never>,
>(
    options: SceneRegistryBuilderOptions<R> = {}
): SceneRegistry<R> =>
    createSceneRegistryWithSource(SCENE_TILEMAP_BUILT_IN_REGISTRY_SOURCE, {
        registry: options.registry,
        builtIns: options.builtIns ?? SCENE_TILEMAP_BUILT_IN_MANIFEST.builtIns,
    }) as SceneRegistry<R>;

export const createTilemapSceneRegistryFromBuiltInManifests = <
    R extends ComponentRegistry = Record<string, never>,
>(
    options: SceneManifestRegistryBuilderOptions<R> = {}
): SceneRegistry<R> =>
    createSceneRegistryFromBuiltInManifestsWithSource(
        SCENE_TILEMAP_BUILT_IN_REGISTRY_SOURCE,
        {
            registry: options.registry,
            manifests: options.manifests ?? TILEMAP_SCENE_BUILT_IN_MANIFESTS,
        }
    );
