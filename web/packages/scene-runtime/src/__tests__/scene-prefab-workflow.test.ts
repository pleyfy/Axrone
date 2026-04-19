import { Hierarchy, Transform, World } from '@axrone/ecs-runtime';
import { describe, expect, it } from 'vitest';
import { SceneComponentCatalog } from '../component-catalog';
import { PrefabNodeBinding } from '../components/prefab-node-binding';
import {
    createScenePrefabScopedNodeId,
    createScenePrefabWorkflow,
    diffScenePrefabDefinitions,
    mergeScenePrefabDefinitions,
} from '../prefab';
import { createSceneRegistry } from '../scene-registry';
import { SceneActorRuntime } from '../scene-actor-runtime';
import { encodeSceneValue } from '../serialization';
import type { ScenePrefabDefinition } from '../types';

const createPrefabHarness = () => {
    const registry = createSceneRegistry();
    const world = new World(registry);
    const actors = new SceneActorRuntime({
        world,
        componentCatalog: new SceneComponentCatalog(registry),
    });

    return {
        actors,
        world,
    };
};

const createPrefabComponent = (type: string, data: unknown, id?: string) => ({
    ...(id ? { id } : {}),
    type,
    data: encodeSceneValue(data),
});

const createTransformComponent = (
    position: readonly [number, number, number],
    id?: string,
) =>
    createPrefabComponent(
        'Transform',
        {
            position,
            rotation: [0, 0, 0, 1],
            scale: [1, 1, 1],
        },
        id,
    );

const createActorSnapshot = (
    nodeId: string,
    name: string,
    components: readonly ReturnType<typeof createPrefabComponent>[],
    parentNodeId: string | null = null,
) => ({
    nodeId,
    parentNodeId,
    name,
    layer: 0,
    tag: 'default',
    active: true,
    persistent: false,
    pooled: false,
    components,
});

const getActorPosition = (actor: { getComponent(type: typeof Transform): Transform | null } | undefined) => {
    const transform = actor?.getComponent(Transform);
    return transform ? [transform.position.x, transform.position.y, transform.position.z] : null;
};

describe('ScenePrefabWorkflow', () => {
    it('resolves nested prefabs, variants, and live overrides during instantiation', () => {
        const weaponPrefab: ScenePrefabDefinition = {
            id: 'prefab/weapon',
            kind: 'prefab',
            actors: [
                createActorSnapshot('weapon-root', 'Weapon', [
                    createTransformComponent([1, 0, 0], 'cmp/weapon-transform'),
                ]),
                createActorSnapshot(
                    'muzzle',
                    'Muzzle',
                    [createTransformComponent([0, 0, 1], 'cmp/muzzle-transform')],
                    'weapon-root',
                ),
            ],
        };

        const characterPrefab: ScenePrefabDefinition = {
            id: 'prefab/character',
            kind: 'prefab',
            actors: [
                createActorSnapshot('character-root', 'Character', [
                    createTransformComponent([0, 0, 0], 'cmp/character-transform'),
                ]),
                createActorSnapshot(
                    'hand-socket',
                    'Hand Socket',
                    [createTransformComponent([0.5, 1, 0], 'cmp/hand-transform')],
                    'character-root',
                ),
            ],
            nested: [
                {
                    instanceId: 'weapon-slot',
                    reference: {
                        kind: 'registry',
                        prefabId: 'prefab/weapon',
                    },
                    parentNodeId: 'hand-socket',
                    overrides: [
                        {
                            kind: 'set-component-property',
                            nodeId: 'weapon-root',
                            selector: {
                                kind: 'id',
                                componentId: 'cmp/weapon-transform',
                                type: 'Transform',
                            },
                            path: ['position'],
                            value: encodeSceneValue([2, 0, 0]),
                        },
                    ],
                },
            ],
        };

        const eliteVariant: ScenePrefabDefinition = {
            id: 'prefab/character-elite',
            kind: 'variant',
            base: {
                kind: 'registry',
                prefabId: 'prefab/character',
            },
            actors: [],
            overrides: [
                {
                    kind: 'set-actor-field',
                    nodeId: 'character-root',
                    field: 'name',
                    value: 'Elite Character',
                },
                {
                    kind: 'set-component-property',
                    nodeId: createScenePrefabScopedNodeId('weapon-slot', 'muzzle'),
                    selector: {
                        kind: 'id',
                        componentId: 'cmp/muzzle-transform',
                        type: 'Transform',
                    },
                    path: ['position'],
                    value: encodeSceneValue([0, 1, 2]),
                },
            ],
        };

        const workflow = createScenePrefabWorkflow({
            prefabs: [weaponPrefab, characterPrefab, eliteVariant],
        });
        const harness = createPrefabHarness();
        const actors = harness.actors.instantiatePrefab(eliteVariant, {
            prefabResolver: workflow,
            liveOverrides: [
                {
                    kind: 'set-actor-field',
                    nodeId: createScenePrefabScopedNodeId('weapon-slot', 'weapon-root'),
                    field: 'name',
                    value: 'Runtime Weapon',
                },
            ],
        });

        const findByNodeId = (nodeId: string) =>
            actors.find((actor) => actor.getComponent(PrefabNodeBinding)?.nodeId === nodeId);

        const characterRoot = findByNodeId('character-root');
        const handSocket = findByNodeId('hand-socket');
        const weaponRoot = findByNodeId(createScenePrefabScopedNodeId('weapon-slot', 'weapon-root'));
        const muzzle = findByNodeId(createScenePrefabScopedNodeId('weapon-slot', 'muzzle'));

        expect(actors).toHaveLength(4);
        expect(characterRoot?.name).toBe('Elite Character');
        expect(weaponRoot?.name).toBe('Runtime Weapon');
        expect(weaponRoot?.getComponent(Hierarchy)?.parentActor).toBe(handSocket);
        expect(muzzle?.getComponent(Hierarchy)?.parentActor).toBe(weaponRoot);
        expect(getActorPosition(weaponRoot)).toEqual([2, 0, 0]);
        expect(getActorPosition(muzzle)).toEqual([0, 1, 2]);
    });

    it('produces granular override operations for actor and component deltas', () => {
        const base: ScenePrefabDefinition = {
            id: 'prefab/base',
            kind: 'prefab',
            actors: [
                createActorSnapshot('hero', 'Hero', [
                    createTransformComponent([0, 0, 0], 'cmp/transform'),
                    createPrefabComponent(
                        'Stats',
                        {
                            damage: 10,
                            flags: {
                                elite: false,
                            },
                        },
                        'cmp/stats',
                    ),
                ]),
            ],
        };

        const target: ScenePrefabDefinition = {
            id: 'prefab/target',
            kind: 'prefab',
            actors: [
                createActorSnapshot('hero', 'Hero Prime', [
                    createTransformComponent([1, 2, 3], 'cmp/transform'),
                    createPrefabComponent(
                        'Stats',
                        {
                            damage: 12,
                            flags: {
                                elite: true,
                            },
                        },
                        'cmp/stats',
                    ),
                ]),
                createActorSnapshot(
                    'pet',
                    'Pet',
                    [createTransformComponent([0, 1, 0], 'cmp/pet-transform')],
                    'hero',
                ),
            ],
        };

        const diff = diffScenePrefabDefinitions(base, target);

        expect(diff.overrides).toEqual(
            expect.arrayContaining([
                {
                    kind: 'set-actor-field',
                    nodeId: 'hero',
                    field: 'name',
                    value: 'Hero Prime',
                },
                {
                    kind: 'set-component-property',
                    nodeId: 'hero',
                    selector: {
                        kind: 'id',
                        componentId: 'cmp/transform',
                        type: 'Transform',
                    },
                    path: ['position'],
                    value: encodeSceneValue([1, 2, 3]),
                },
                {
                    kind: 'set-component-property',
                    nodeId: 'hero',
                    selector: {
                        kind: 'id',
                        componentId: 'cmp/stats',
                        type: 'Stats',
                    },
                    path: ['damage'],
                    value: encodeSceneValue(12),
                },
                {
                    kind: 'set-component-property',
                    nodeId: 'hero',
                    selector: {
                        kind: 'id',
                        componentId: 'cmp/stats',
                        type: 'Stats',
                    },
                    path: ['flags', 'elite'],
                    value: encodeSceneValue(true),
                },
                {
                    kind: 'add-actor',
                    actor: expect.objectContaining({
                        nodeId: 'pet',
                        parentNodeId: 'hero',
                    }),
                },
            ]),
        );
    });

    it('merges conflicting override layers with deterministic policies', () => {
        const base: ScenePrefabDefinition = {
            id: 'prefab/base',
            kind: 'prefab',
            actors: [
                createActorSnapshot('hero', 'Hero', [
                    createPrefabComponent(
                        'Stats',
                        {
                            damage: 10,
                            recoil: {
                                kick: 1,
                            },
                            enabled: true,
                        },
                        'cmp/stats',
                    ),
                ]),
            ],
        };

        const local: ScenePrefabDefinition = {
            id: 'prefab/local',
            kind: 'prefab',
            actors: [
                createActorSnapshot('hero', 'Hero', [
                    createPrefabComponent(
                        'Stats',
                        {
                            damage: 20,
                            recoil: {
                                kick: 2,
                            },
                            enabled: true,
                        },
                        'cmp/stats',
                    ),
                ]),
            ],
        };

        const incoming: ScenePrefabDefinition = {
            id: 'prefab/incoming',
            kind: 'prefab',
            actors: [
                createActorSnapshot('hero', 'Hero', [
                    createPrefabComponent(
                        'Stats',
                        {
                            damage: 25,
                            recoil: {
                                kick: 1,
                            },
                            enabled: false,
                        },
                        'cmp/stats',
                    ),
                ]),
            ],
        };

        const manualMerge = mergeScenePrefabDefinitions(base, local, incoming);
        const preferLocalMerge = mergeScenePrefabDefinitions(base, local, incoming, {
            conflictPolicy: 'prefer-local',
        });

        expect(manualMerge.resolved).toBe(false);
        expect(manualMerge.conflicts).toHaveLength(1);
        expect(manualMerge.definition.actors[0]?.components[0]?.data).toEqual(
            encodeSceneValue({
                damage: 10,
                recoil: {
                    kick: 2,
                },
                enabled: false,
            }),
        );

        expect(preferLocalMerge.resolved).toBe(true);
        expect(preferLocalMerge.conflicts).toHaveLength(0);
        expect(preferLocalMerge.definition.actors[0]?.components[0]?.data).toEqual(
            encodeSceneValue({
                damage: 20,
                recoil: {
                    kick: 2,
                },
                enabled: false,
            }),
        );
    });
});