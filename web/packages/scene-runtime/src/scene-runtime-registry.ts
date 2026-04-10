import { Hierarchy } from '@axrone/ecs';
import { Transform } from '@axrone/ecs';
import type {
    ComponentConstructor,
    ComponentRegistry,
} from '@axrone/ecs';
import { PrefabNodeBinding } from './components/prefab-node-binding';

export type SceneRuntimeBuiltInComponentName =
    | 'Hierarchy'
    | 'Transform'
    | 'PrefabNodeBinding';

export interface SceneRuntimeBuiltInManifest<
    TBuiltIns extends readonly SceneRuntimeBuiltInComponentName[] = readonly SceneRuntimeBuiltInComponentName[],
> {
    readonly id: string;
    readonly builtIns: TBuiltIns;
}

export interface SceneRuntimeBuiltInRegistry {
    readonly Hierarchy: typeof Hierarchy;
    readonly Transform: typeof Transform;
    readonly PrefabNodeBinding: typeof PrefabNodeBinding;
}

export type SceneRuntimeRegistry<R extends ComponentRegistry = Record<string, never>> = R &
    SceneRuntimeBuiltInRegistry;

const SCENE_RUNTIME_BUILT_IN_REGISTRY: SceneRuntimeBuiltInRegistry = Object.freeze({
    Hierarchy,
    Transform,
    PrefabNodeBinding,
});

export const createSceneRuntimeBuiltInManifest = <
    const TBuiltIns extends readonly SceneRuntimeBuiltInComponentName[],
>(
    manifest: {
        readonly id: string;
        readonly builtIns: TBuiltIns;
    }
): SceneRuntimeBuiltInManifest<TBuiltIns> =>
    Object.freeze({
        id: manifest.id,
        builtIns: Object.freeze([...manifest.builtIns]) as TBuiltIns,
    });

export const SCENE_RUNTIME_CORE_BUILT_IN_MANIFEST = createSceneRuntimeBuiltInManifest({
    id: 'scene-runtime/core',
    builtIns: ['Hierarchy', 'Transform', 'PrefabNodeBinding'] as const,
});

export const DEFAULT_SCENE_RUNTIME_BUILT_IN_MANIFESTS = Object.freeze([
    SCENE_RUNTIME_CORE_BUILT_IN_MANIFEST,
]) as readonly SceneRuntimeBuiltInManifest<readonly SceneRuntimeBuiltInComponentName[]>[];

export const resolveSceneRuntimeBuiltInComponents = (
    manifests: readonly SceneRuntimeBuiltInManifest<readonly SceneRuntimeBuiltInComponentName[]>[] =
        DEFAULT_SCENE_RUNTIME_BUILT_IN_MANIFESTS
): readonly SceneRuntimeBuiltInComponentName[] => {
    const resolved: SceneRuntimeBuiltInComponentName[] = [];
    const included = new Set<SceneRuntimeBuiltInComponentName>();

    for (let manifestIndex = 0; manifestIndex < manifests.length; manifestIndex += 1) {
        const manifest = manifests[manifestIndex]!;
        for (let builtInIndex = 0; builtInIndex < manifest.builtIns.length; builtInIndex += 1) {
            const builtIn = manifest.builtIns[builtInIndex]!;
            if (included.has(builtIn)) {
                continue;
            }

            included.add(builtIn);
            resolved.push(builtIn);
        }
    }

    return Object.freeze(resolved);
};

export const DEFAULT_SCENE_RUNTIME_BUILT_IN_COMPONENTS =
    resolveSceneRuntimeBuiltInComponents();

export const createSceneRuntimeRegistry = <
    R extends ComponentRegistry = Record<string, never>,
>(
    options: {
        readonly registry?: R;
        readonly manifests?: readonly SceneRuntimeBuiltInManifest<
            readonly SceneRuntimeBuiltInComponentName[]
        >[];
    } = {}
): SceneRuntimeRegistry<R> => {
    const registry: Record<string, ComponentConstructor> = {};
    const builtIns = resolveSceneRuntimeBuiltInComponents(
        options.manifests ?? DEFAULT_SCENE_RUNTIME_BUILT_IN_MANIFESTS
    );

    for (let index = 0; index < builtIns.length; index += 1) {
        const builtIn = builtIns[index]!;
        registry[builtIn] = SCENE_RUNTIME_BUILT_IN_REGISTRY[builtIn];
    }

    return {
        ...registry,
        ...(options.registry ?? {}),
    } as SceneRuntimeRegistry<R>;
};