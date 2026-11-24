import { describe, expect, it } from 'vitest';
import {
    createScenePrefabVariant,
    unpackScenePrefabInstance,
    applyOverridesToBaseDefinition,
} from '../scene-prefab-variant';
import { createScenePrefabWorkflow } from '../scene-prefab-workflow';
import { encodeSceneValue } from '@axrone/scene-runtime/serialization';
import type { ScenePrefabDefinition, ScenePrefabOverrideOperation } from '../types';

const createEntity = (
    nodeId: string,
    name: string,
    parentNodeId: string | null = null,
    components: Array<{ type: string; data: unknown; id?: string }> = [],
) => ({
    nodeId,
    parentNodeId,
    name,
    layer: 0,
    tag: 'default',
    active: true,
    persistent: false,
    pooled: false,
    components: components.map((component) => ({
        ...(component.id ? { id: component.id } : {}),
        type: component.type,
        data: encodeSceneValue(component.data),
    })),
});

const createTransform = (position: readonly [number, number, number], id?: string) => ({
    type: 'Transform',
    id,
    data: { position, rotation: [0, 0, 0, 1], scale: [1, 1, 1] },
});

describe('scene-prefab-variant', () => {
    describe('unpackScenePrefabInstance', () => {
        it('produces a flat prefab definition with kind "prefab"', () => {
            const definition: ScenePrefabDefinition = {
                id: 'prefab/hero',
                kind: 'resolved',
                entities: [
                    createEntity('root', 'Hero', null, [createTransform([0, 0, 0], 'cmp-t')]),
                    createEntity('weapon', 'Weapon', 'root', [createTransform([1, 0, 0])]),
                ],
            };

            const result = unpackScenePrefabInstance(definition);

            expect(result.kind).toBe('prefab');
            expect(result.id).toBe('prefab/hero');
            expect(result.entities).toHaveLength(2);
            expect(result.base).toBeUndefined();
            expect(result.nested).toBeUndefined();
            expect(result.overrides).toBeUndefined();
        });

        it('strips source metadata from all entities', () => {
            const definition: ScenePrefabDefinition = {
                id: 'prefab/hero',
                kind: 'resolved',
                entities: [
                    {
                        ...createEntity('root', 'Hero'),
                        source: { prefabId: 'prefab/hero', nodeId: 'root' },
                    },
                    {
                        ...createEntity('child', 'Child', 'root'),
                        source: {
                            prefabId: 'prefab/weapon',
                            nodeId: 'weapon-root',
                            instancePath: ['slot-1'],
                        },
                    },
                ],
            };

            const result = unpackScenePrefabInstance(definition);

            for (const entity of result.entities) {
                expect(entity.source).toBeUndefined();
            }
        });

        it('applies live overrides before materializing', () => {
            const definition: ScenePrefabDefinition = {
                id: 'prefab/hero',
                kind: 'prefab',
                entities: [
                    createEntity('root', 'Hero', null, [createTransform([0, 0, 0], 'cmp-t')]),
                ],
            };

            const overrides: ScenePrefabOverrideOperation[] = [
                {
                    kind: 'set-entity-field',
                    nodeId: 'root',
                    field: 'name',
                    value: 'Super Hero',
                },
            ];

            const result = unpackScenePrefabInstance(definition, overrides);

            expect(result.entities[0]?.name).toBe('Super Hero');
            expect(result.kind).toBe('prefab');
        });

        it('supports custom unpacked ID', () => {
            const definition: ScenePrefabDefinition = {
                id: 'prefab/hero',
                kind: 'prefab',
                entities: [createEntity('root', 'Hero')],
            };

            const result = unpackScenePrefabInstance(definition, [], 'unpacked/hero');

            expect(result.id).toBe('unpacked/hero');
        });

        it('resolves variant chain then unpacks to flat definition', () => {
            const basePrefab: ScenePrefabDefinition = {
                id: 'prefab/base',
                kind: 'prefab',
                entities: [
                    createEntity('root', 'Base', null, [createTransform([0, 0, 0], 'cmp-t')]),
                ],
            };

            const variant: ScenePrefabDefinition = {
                id: 'prefab/variant',
                kind: 'variant',
                base: { kind: 'registry', prefabId: 'prefab/base' },
                entities: [],
                overrides: [
                    {
                        kind: 'set-entity-field',
                        nodeId: 'root',
                        field: 'name',
                        value: 'Variant Hero',
                    },
                ],
            };

            const workflow = createScenePrefabWorkflow({ prefabs: [basePrefab, variant] });
            const resolved = workflow.resolvePrefab(variant).definition;
            const unpacked = unpackScenePrefabInstance(resolved);

            expect(unpacked.kind).toBe('prefab');
            expect(unpacked.entities[0]?.name).toBe('Variant Hero');
            expect(unpacked.base).toBeUndefined();
            expect(unpacked.entities[0]?.source).toBeUndefined();
        });

        it('preserves metadata when present', () => {
            const definition: ScenePrefabDefinition = {
                id: 'prefab/hero',
                kind: 'prefab',
                entities: [createEntity('root', 'Hero')],
                metadata: { version: '1.0.0' },
            };

            const result = unpackScenePrefabInstance(definition);

            expect(result.metadata).toEqual({ version: '1.0.0' });
        });
    });

    describe('createScenePrefabVariant', () => {
        it('creates a variant definition with base reference', () => {
            const variant = createScenePrefabVariant('prefab/base', 'prefab/elite');

            expect(variant.id).toBe('prefab/elite');
            expect(variant.kind).toBe('variant');
            expect(variant.base).toEqual({ kind: 'registry', prefabId: 'prefab/base' });
            expect(variant.entities).toEqual([]);
            expect(variant.overrides).toEqual([]);
        });

        it('includes provided overrides as cloned operations', () => {
            const overrides: ScenePrefabOverrideOperation[] = [
                {
                    kind: 'set-entity-field',
                    nodeId: 'root',
                    field: 'name',
                    value: 'Elite',
                },
                {
                    kind: 'set-component-property',
                    nodeId: 'root',
                    selector: { kind: 'type', type: 'Stats', occurrence: 0 },
                    path: ['damage'],
                    value: encodeSceneValue(99),
                },
            ];

            const variant = createScenePrefabVariant('prefab/base', 'prefab/elite', overrides);

            expect(variant.overrides).toHaveLength(2);
            expect(variant.overrides?.[0]).toEqual(overrides[0]);
            expect(variant.overrides?.[1]).toEqual(overrides[1]);
            // Verify cloning (not same reference)
            expect(variant.overrides?.[0]).not.toBe(overrides[0]);
        });

        it('includes metadata when provided', () => {
            const variant = createScenePrefabVariant(
                'prefab/base',
                'prefab/elite',
                [],
                { version: '2.0.0' },
            );

            expect(variant.metadata).toEqual({ version: '2.0.0' });
        });

        it('resolves correctly through the workflow engine', () => {
            const basePrefab: ScenePrefabDefinition = {
                id: 'prefab/base',
                kind: 'prefab',
                entities: [
                    createEntity('root', 'Base Hero', null, [
                        createTransform([0, 0, 0], 'cmp-t'),
                        { type: 'Stats', id: 'cmp-s', data: { damage: 10, health: 100 } },
                    ]),
                ],
            };

            const overrides: ScenePrefabOverrideOperation[] = [
                {
                    kind: 'set-entity-field',
                    nodeId: 'root',
                    field: 'name',
                    value: 'Elite Hero',
                },
                {
                    kind: 'set-component-property',
                    nodeId: 'root',
                    selector: { kind: 'id', componentId: 'cmp-s', type: 'Stats' },
                    path: ['damage'],
                    value: encodeSceneValue(50),
                },
            ];

            const variant = createScenePrefabVariant('prefab/base', 'prefab/elite', overrides);
            const workflow = createScenePrefabWorkflow({ prefabs: [basePrefab, variant] });
            const resolved = workflow.resolvePrefab(variant).definition;

            expect(resolved.entities[0]?.name).toBe('Elite Hero');
            const statsData = resolved.entities[0]?.components.find((c) => c.type === 'Stats')?.data;
            expect(statsData).toEqual(
                encodeSceneValue({ damage: 50, health: 100 }),
            );
        });
    });

    describe('applyOverridesToBaseDefinition', () => {
        it('returns a clone when no overrides are provided', () => {
            const base: ScenePrefabDefinition = {
                id: 'prefab/base',
                kind: 'prefab',
                entities: [createEntity('root', 'Hero', null, [createTransform([0, 0, 0])])],
            };

            const result = applyOverridesToBaseDefinition(base, []);

            expect(result.id).toBe('prefab/base');
            expect(result.kind).toBe('prefab');
            expect(result.entities).toHaveLength(1);
            expect(result.entities[0]?.name).toBe('Hero');
            // Verify it's a clone
            expect(result.entities).not.toBe(base.entities);
        });

        it('applies set-entity-field overrides', () => {
            const base: ScenePrefabDefinition = {
                id: 'prefab/base',
                kind: 'prefab',
                entities: [createEntity('root', 'Hero')],
            };

            const overrides: ScenePrefabOverrideOperation[] = [
                { kind: 'set-entity-field', nodeId: 'root', field: 'name', value: 'Super Hero' },
                { kind: 'set-entity-field', nodeId: 'root', field: 'active', value: false },
            ];

            const result = applyOverridesToBaseDefinition(base, overrides);

            expect(result.entities[0]?.name).toBe('Super Hero');
            expect(result.entities[0]?.active).toBe(false);
        });

        it('applies set-component-property overrides', () => {
            const base: ScenePrefabDefinition = {
                id: 'prefab/base',
                kind: 'prefab',
                entities: [
                    createEntity('root', 'Hero', null, [
                        { type: 'Stats', id: 'cmp-s', data: { damage: 10, health: 100 } },
                    ]),
                ],
            };

            const overrides: ScenePrefabOverrideOperation[] = [
                {
                    kind: 'set-component-property',
                    nodeId: 'root',
                    selector: { kind: 'id', componentId: 'cmp-s', type: 'Stats' },
                    path: ['damage'],
                    value: encodeSceneValue(99),
                },
            ];

            const result = applyOverridesToBaseDefinition(base, overrides);
            const statsData = result.entities[0]?.components[0]?.data;

            expect(statsData).toEqual(encodeSceneValue({ damage: 99, health: 100 }));
        });

        it('applies add-entity overrides', () => {
            const base: ScenePrefabDefinition = {
                id: 'prefab/base',
                kind: 'prefab',
                entities: [createEntity('root', 'Hero')],
            };

            const overrides: ScenePrefabOverrideOperation[] = [
                {
                    kind: 'add-entity',
                    entity: createEntity('pet', 'Pet', 'root', [createTransform([0, 1, 0])]),
                },
            ];

            const result = applyOverridesToBaseDefinition(base, overrides);

            expect(result.entities).toHaveLength(2);
            expect(result.entities[1]?.nodeId).toBe('pet');
            expect(result.entities[1]?.parentNodeId).toBe('root');
        });

        it('applies remove-entity overrides', () => {
            const base: ScenePrefabDefinition = {
                id: 'prefab/base',
                kind: 'prefab',
                entities: [
                    createEntity('root', 'Hero'),
                    createEntity('child', 'Child', 'root'),
                ],
            };

            const overrides: ScenePrefabOverrideOperation[] = [
                { kind: 'remove-entity', nodeId: 'child' },
            ];

            const result = applyOverridesToBaseDefinition(base, overrides);

            expect(result.entities).toHaveLength(1);
            expect(result.entities[0]?.nodeId).toBe('root');
        });

        it('applies add-component and remove-component overrides', () => {
            const base: ScenePrefabDefinition = {
                id: 'prefab/base',
                kind: 'prefab',
                entities: [
                    createEntity('root', 'Hero', null, [
                        { type: 'Transform', id: 'cmp-t', data: { position: [0, 0, 0] } },
                        { type: 'OldScript', id: 'cmp-old', data: { enabled: true } },
                    ]),
                ],
            };

            const overrides: ScenePrefabOverrideOperation[] = [
                {
                    kind: 'remove-component',
                    nodeId: 'root',
                    selector: { kind: 'id', componentId: 'cmp-old', type: 'OldScript' },
                },
                {
                    kind: 'add-component',
                    nodeId: 'root',
                    component: {
                        type: 'NewScript',
                        data: encodeSceneValue({ speed: 5 }),
                    },
                },
            ];

            const result = applyOverridesToBaseDefinition(base, overrides);
            const componentTypes = result.entities[0]?.components.map((c) => c.type);

            expect(componentTypes).toEqual(['Transform', 'NewScript']);
        });

        it('produces kind "prefab" regardless of input kind', () => {
            const base: ScenePrefabDefinition = {
                id: 'prefab/resolved',
                kind: 'resolved',
                entities: [createEntity('root', 'Hero')],
            };

            const result = applyOverridesToBaseDefinition(base, []);

            expect(result.kind).toBe('prefab');
        });

        it('preserves metadata', () => {
            const base: ScenePrefabDefinition = {
                id: 'prefab/base',
                kind: 'prefab',
                entities: [createEntity('root', 'Hero')],
                metadata: { version: '3.0.0' },
            };

            const result = applyOverridesToBaseDefinition(base, []);

            expect(result.metadata).toEqual({ version: '3.0.0' });
        });
    });

    describe('round-trip consistency', () => {
        it('unpack(variant) equals unpack(base + overrides)', () => {
            const basePrefab: ScenePrefabDefinition = {
                id: 'prefab/base',
                kind: 'prefab',
                entities: [
                    createEntity('root', 'Hero', null, [
                        createTransform([0, 0, 0], 'cmp-t'),
                        { type: 'Stats', id: 'cmp-s', data: { damage: 10 } },
                    ]),
                    createEntity('weapon', 'Sword', 'root', [createTransform([1, 0, 0])]),
                ],
            };

            const overrides: ScenePrefabOverrideOperation[] = [
                { kind: 'set-entity-field', nodeId: 'root', field: 'name', value: 'Elite' },
                {
                    kind: 'set-component-property',
                    nodeId: 'root',
                    selector: { kind: 'id', componentId: 'cmp-s', type: 'Stats' },
                    path: ['damage'],
                    value: encodeSceneValue(50),
                },
            ];

            // Path A: create variant, resolve, unpack
            const variant = createScenePrefabVariant('prefab/base', 'prefab/elite', overrides);
            const workflow = createScenePrefabWorkflow({ prefabs: [basePrefab, variant] });
            const resolvedVariant = workflow.resolvePrefab(variant).definition;
            const unpackedVariant = unpackScenePrefabInstance(resolvedVariant, [], 'result');

            // Path B: resolve base, apply overrides, unpack
            const resolvedBase = workflow.resolvePrefab(basePrefab).definition;
            const unpackedDirect = unpackScenePrefabInstance(resolvedBase, overrides, 'result');

            expect(unpackedVariant.entities).toEqual(unpackedDirect.entities);
        });

        it('applyOverrides then unpack is idempotent for empty overrides', () => {
            const base: ScenePrefabDefinition = {
                id: 'prefab/base',
                kind: 'prefab',
                entities: [
                    createEntity('root', 'Hero', null, [createTransform([1, 2, 3])]),
                ],
            };

            const applied = applyOverridesToBaseDefinition(base, []);
            const unpacked = unpackScenePrefabInstance(applied);

            expect(unpacked.entities).toEqual(applied.entities);
        });
    });
});
