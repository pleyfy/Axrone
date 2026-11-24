import { describe, expect, it } from 'vitest';
import {
    ScenePrefabWorkflow,
    applyScenePrefabOverrides,
    createScenePrefabScopedNodeId,
    PrefabNodeBinding,
    type SceneEntitySnapshot,
    type SceneComponentSnapshot,
    type ScenePrefabDefinition,
    type ScenePrefabNestedInstance,
    type ScenePrefabOverrideOperation,
} from '../index';
import { scopeScenePrefabEntities } from '../scene-prefab-operations';

// ─── Helpers ───────────────────────────────────────────────────────────────

function makeComponent(
    type: string,
    data: Record<string, unknown> = {},
    id?: string,
): SceneComponentSnapshot {
    return {
        ...(id ? { id } : {}),
        type,
        data,
    };
}

function makeEntity(
    nodeId: string,
    name?: string,
    parentNodeId?: string | null,
    components?: SceneComponentSnapshot[],
): SceneEntitySnapshot {
    return {
        nodeId,
        parentNodeId: parentNodeId ?? null,
        name: name ?? nodeId,
        layer: 0,
        tag: 'default',
        active: true,
        persistent: false,
        pooled: false,
        components: components ?? [],
    };
}

function makeDefinition(
    id: string,
    entities?: SceneEntitySnapshot[],
    overrides?: ScenePrefabOverrideOperation[],
    nested?: ScenePrefabNestedInstance[],
    base?: ScenePrefabDefinition['base'],
): ScenePrefabDefinition {
    return {
        id,
        kind: 'prefab',
        entities: entities ?? [makeEntity('root', 'Root')],
        ...(overrides ? { overrides } : {}),
        ...(nested ? { nested } : {}),
        ...(base ? { base } : {}),
    };
}

/**
 * Simulates instantiating a prefab by resolving it and then scoping its entities
 * with a unique instanceId, mirroring what the runtime instantiation pipeline does.
 */
function simulateInstantiation(
    workflow: ScenePrefabWorkflow,
    prefabId: string,
    instanceId: string,
    namePrefix?: string,
): readonly SceneEntitySnapshot[] {
    const result = workflow.resolvePrefab({ kind: 'registry', prefabId });
    const nested: ScenePrefabNestedInstance = {
        instanceId,
        reference: { kind: 'registry', prefabId },
        ...(namePrefix ? { namePrefix } : {}),
    };
    return scopeScenePrefabEntities(result.definition.entities, nested, prefabId);
}

// ---------------------------------------------------------------------------
// T-02: Prefab Instantiation Integration Tests
// ---------------------------------------------------------------------------

describe('T-02: Prefab Instantiation Integration', () => {
    // ── 1. Load a prefab definition → verify structure is valid ──────────
    describe('prefab definition loading', () => {
        it('loads a valid prefab definition with correct structure', () => {
            const def = makeDefinition('enemy-prefab', [
                makeEntity('body', 'EnemyBody', null, [
                    makeComponent('Transform', { x: 0, y: 0, z: 0 }),
                    makeComponent('MeshRenderer', { mesh: 'enemy.mesh' }),
                ]),
                makeEntity('weapon', 'Weapon', 'body', [
                    makeComponent('Transform', { x: 1, y: 0, z: 0 }),
                ]),
            ]);

            expect(def.id).toBe('enemy-prefab');
            expect(def.kind).toBe('prefab');
            expect(def.entities).toHaveLength(2);
            expect(def.entities[0]!.nodeId).toBe('body');
            expect(def.entities[0]!.components).toHaveLength(2);
            expect(def.entities[1]!.parentNodeId).toBe('body');
        });
    });

    // ── 2. Resolve a prefab from registry → verify lineage ───────────────
    describe('prefab resolution and lineage', () => {
        it('resolves a simple prefab with single-entry lineage', () => {
            const def = makeDefinition('simple-prefab');
            const workflow = new ScenePrefabWorkflow({ prefabs: [def] });

            const result = workflow.resolvePrefab({ kind: 'registry', prefabId: 'simple-prefab' });

            expect(result.definition.kind).toBe('resolved');
            expect(result.definition.lineage).toEqual(['simple-prefab']);
            expect(result.definition.entities).toHaveLength(1);
            expect(result.conflicts).toEqual([]);
        });

        it('resolves a variant chain with multi-entry lineage', () => {
            const base = makeDefinition('base-prefab', [
                makeEntity('root', 'BaseRoot', null, [
                    makeComponent('Transform', { x: 0 }),
                ]),
            ]);
            const variant: ScenePrefabDefinition = {
                id: 'variant-prefab',
                kind: 'variant',
                entities: [makeEntity('root', 'VariantRoot')],
                base: { kind: 'registry', prefabId: 'base-prefab' },
            };

            const workflow = new ScenePrefabWorkflow({ prefabs: [base, variant] });
            const result = workflow.resolvePrefab({ kind: 'registry', prefabId: 'variant-prefab' });

            expect(result.definition.lineage).toEqual(['base-prefab', 'variant-prefab']);
            expect(result.definition.entities[0]!.name).toBe('VariantRoot');
        });
    });

    // ── 3. Instantiate a simple prefab → verify entity count ──────────────
    describe('prefab instantiation — entity count', () => {
        it('creates the correct number of scoped entities from a simple prefab', () => {
            const def = makeDefinition('tree-prefab', [
                makeEntity('trunk', 'Trunk'),
                makeEntity('branch-1', 'Branch1', 'trunk'),
                makeEntity('branch-2', 'Branch2', 'trunk'),
                makeEntity('leaves', 'Leaves', 'trunk'),
            ]);
            const workflow = new ScenePrefabWorkflow({ prefabs: [def] });

            const entities = simulateInstantiation(workflow, 'tree-prefab', 'instance-001');

            expect(entities).toHaveLength(4);
        });

        it('creates correct number of entities from a prefab with nested instances', () => {
            const inner = makeDefinition('inner-prefab', [
                makeEntity('inner-root', 'InnerRoot'),
                makeEntity('inner-child', 'InnerChild', 'inner-root'),
            ]);
            const outer: ScenePrefabDefinition = {
                id: 'outer-prefab',
                kind: 'prefab',
                entities: [makeEntity('outer-root', 'OuterRoot')],
                nested: [
                    {
                        instanceId: 'nested-1',
                        reference: { kind: 'registry', prefabId: 'inner-prefab' },
                        parentNodeId: 'outer-root',
                    },
                ],
            };

            const workflow = new ScenePrefabWorkflow({ prefabs: [inner, outer] });
            const result = workflow.resolvePrefab({ kind: 'registry', prefabId: 'outer-prefab' });

            // outer-root + 2 inner entities (scoped)
            expect(result.definition.entities).toHaveLength(3);
        });
    });

    // ── 4. Verify entity hierarchy preservation ──────────────────────────
    describe('hierarchy preservation', () => {
        it('preserves parent-child relationships after instantiation', () => {
            const def = makeDefinition('hierarchy-prefab', [
                makeEntity('parent', 'Parent'),
                makeEntity('child-a', 'ChildA', 'parent'),
                makeEntity('child-b', 'ChildB', 'parent'),
                makeEntity('grandchild', 'Grandchild', 'child-a'),
            ]);
            const workflow = new ScenePrefabWorkflow({ prefabs: [def] });

            const entities = simulateInstantiation(workflow, 'hierarchy-prefab', 'inst-h');

            const parentEntity = entities.find((a) => a.nodeId === 'inst-h::parent');
            const childA = entities.find((a) => a.nodeId === 'inst-h::child-a');
            const childB = entities.find((a) => a.nodeId === 'inst-h::child-b');
            const grandchild = entities.find((a) => a.nodeId === 'inst-h::grandchild');

            expect(parentEntity!.parentNodeId).toBeNull();
            expect(childA!.parentNodeId).toBe('inst-h::parent');
            expect(childB!.parentNodeId).toBe('inst-h::parent');
            expect(grandchild!.parentNodeId).toBe('inst-h::child-a');
        });

        it('roots nested instance entities under the specified parent', () => {
            const inner = makeDefinition('inner', [
                makeEntity('inner-root', 'InnerRoot'),
            ]);
            const outer: ScenePrefabDefinition = {
                id: 'outer',
                kind: 'prefab',
                entities: [makeEntity('outer-root', 'OuterRoot')],
                nested: [
                    {
                        instanceId: 'n1',
                        reference: { kind: 'registry', prefabId: 'inner' },
                        parentNodeId: 'outer-root',
                    },
                ],
            };

            const workflow = new ScenePrefabWorkflow({ prefabs: [inner, outer] });
            const result = workflow.resolvePrefab({ kind: 'registry', prefabId: 'outer' });

            const nestedRoot = result.definition.entities.find((a) => a.nodeId === 'n1::inner-root');
            expect(nestedRoot).toBeDefined();
            expect(nestedRoot!.parentNodeId).toBe('outer-root');
        });
    });

    // ── 5. Verify component data is cloned ───────────────────────────────
    describe('component data cloning', () => {
        it('clones component data from prefab to resolved instance', () => {
            const def = makeDefinition('comp-prefab', [
                makeEntity('root', 'Root', null, [
                    makeComponent('Transform', { position: { x: 10, y: 20, z: 30 } }),
                    makeComponent('Health', { hp: 100, maxHp: 100 }),
                ]),
            ]);
            const workflow = new ScenePrefabWorkflow({ prefabs: [def] });
            const result = workflow.resolvePrefab({ kind: 'registry', prefabId: 'comp-prefab' });

            const entity = result.definition.entities[0]!;
            expect(entity.components).toHaveLength(2);
            expect(entity.components[0]!.type).toBe('Transform');
            expect(entity.components[0]!.data).toEqual({ position: { x: 10, y: 20, z: 30 } });
            expect(entity.components[1]!.type).toBe('Health');
            expect(entity.components[1]!.data).toEqual({ hp: 100, maxHp: 100 });
        });

        it('resolved component data is independent from the original definition input', () => {
            const originalData = { position: { x: 5, y: 10 } };
            const def = makeDefinition('clone-test', [
                makeEntity('root', 'Root', null, [makeComponent('Transform', originalData)]),
            ]);
            // Disable cache so each resolve produces a fresh clone
            const workflow = new ScenePrefabWorkflow({ prefabs: [def], enableCache: false });

            const result1 = workflow.resolvePrefab({ kind: 'registry', prefabId: 'clone-test' });
            const result2 = workflow.resolvePrefab({ kind: 'registry', prefabId: 'clone-test' });

            // Both should have equal data
            expect(result1.definition.entities[0]!.components[0]!.data).toEqual(
                result2.definition.entities[0]!.components[0]!.data,
            );
            // But not be the same reference (each resolution deep-clones)
            expect(result1.definition.entities[0]!.components[0]!.data).not.toBe(
                result2.definition.entities[0]!.components[0]!.data,
            );
            // And neither should be the original input reference
            expect(result1.definition.entities[0]!.components[0]!.data).not.toBe(originalData);
        });
    });

    // ── 6. Verify ID remapping — unique nodeIds across instances ─────────
    describe('ID remapping and uniqueness', () => {
        it('generates unique scoped nodeIds for each instance', () => {
            const def = makeDefinition('shared-prefab', [
                makeEntity('root', 'Root'),
                makeEntity('child', 'Child', 'root'),
            ]);
            const workflow = new ScenePrefabWorkflow({ prefabs: [def] });

            const instance1 = simulateInstantiation(workflow, 'shared-prefab', 'inst-A');
            const instance2 = simulateInstantiation(workflow, 'shared-prefab', 'inst-B');

            const ids1 = new Set(instance1.map((a) => a.nodeId));
            const ids2 = new Set(instance2.map((a) => a.nodeId));

            // No overlap between instances
            for (const id of ids1) {
                expect(ids2.has(id)).toBe(false);
            }

            // Verify the scoped format
            expect(ids1.has('inst-A::root')).toBe(true);
            expect(ids1.has('inst-A::child')).toBe(true);
            expect(ids2.has('inst-B::root')).toBe(true);
            expect(ids2.has('inst-B::child')).toBe(true);
        });

        it('createScenePrefabScopedNodeId produces correct format', () => {
            expect(createScenePrefabScopedNodeId('inst-1', 'node-a')).toBe('inst-1::node-a');
            expect(createScenePrefabScopedNodeId('abc', 'xyz')).toBe('abc::xyz');
        });

        it('three instances of the same prefab all have distinct IDs', () => {
            const def = makeDefinition('triple', [
                makeEntity('a', 'A'),
                makeEntity('b', 'B', 'a'),
            ]);
            const workflow = new ScenePrefabWorkflow({ prefabs: [def] });

            const i1 = simulateInstantiation(workflow, 'triple', 'x');
            const i2 = simulateInstantiation(workflow, 'triple', 'y');
            const i3 = simulateInstantiation(workflow, 'triple', 'z');

            const allIds = [
                ...i1.map((a) => a.nodeId),
                ...i2.map((a) => a.nodeId),
                ...i3.map((a) => a.nodeId),
            ];
            const uniqueIds = new Set(allIds);

            expect(uniqueIds.size).toBe(allIds.length);
        });
    });

    // ── 7. PrefabNodeBinding maps entities back to source nodes ──────────
    describe('PrefabNodeBinding', () => {
        it('stores nodeId and instanceId for entity-to-prefab mapping', () => {
            const binding = new PrefabNodeBinding({
                nodeId: 'root',
                instanceId: 'inst-42',
            });

            expect(binding.nodeId).toBe('root');
            expect(binding.instanceId).toBe('inst-42');
        });

        it('defaults to null when no config provided', () => {
            const binding = new PrefabNodeBinding();

            expect(binding.nodeId).toBeNull();
            expect(binding.instanceId).toBeNull();
        });

        it('serializes nodeId for persistence', () => {
            const binding = new PrefabNodeBinding({ nodeId: 'body', instanceId: 'inst-1' });
            const serialized = binding.serialize();

            expect(serialized.nodeId).toBe('body');
        });

        it('deserializes nodeId and instanceId from data', () => {
            const binding = new PrefabNodeBinding();
            binding.deserialize({ nodeId: 'weapon', instanceId: 'inst-99' });

            expect(binding.nodeId).toBe('weapon');
            expect(binding.instanceId).toBe('inst-99');
        });

        it('resolved entities carry source metadata linking back to prefab', () => {
            const def = makeDefinition('source-track', [
                makeEntity('root', 'Root'),
            ]);
            const workflow = new ScenePrefabWorkflow({ prefabs: [def] });
            const result = workflow.resolvePrefab({ kind: 'registry', prefabId: 'source-track' });

            const entity = result.definition.entities[0]!;
            expect(entity.source).toBeDefined();
            expect(entity.source!.prefabId).toBe('source-track');
            expect(entity.source!.nodeId).toBe('root');
        });

        it('scoped entities carry instancePath in source metadata', () => {
            const def = makeDefinition('tracked-prefab', [
                makeEntity('root', 'Root'),
            ]);
            const workflow = new ScenePrefabWorkflow({ prefabs: [def] });

            const entities = simulateInstantiation(workflow, 'tracked-prefab', 'inst-77');
            const entity = entities[0]!;

            expect(entity.source).toBeDefined();
            expect(entity.source!.prefabId).toBe('tracked-prefab');
            expect(entity.source!.nodeId).toBe('root');
            expect(entity.source!.instancePath).toContain('inst-77');
        });
    });

    // ── 8. Override application ──────────────────────────────────────────
    describe('override application', () => {
        it('applies set-entity-field override to change name', () => {
            const def = makeDefinition('override-name', [
                makeEntity('root', 'OriginalName'),
            ]);

            const result = applyScenePrefabOverrides(def, [
                { kind: 'set-entity-field', nodeId: 'root', field: 'name', value: 'Renamed' },
            ]);

            expect(result.entities[0]!.name).toBe('Renamed');
        });

        it('applies set-component-property override to change position', () => {
            const def = makeDefinition('override-pos', [
                makeEntity('root', 'Root', null, [
                    makeComponent('Transform', { x: 0, y: 0, z: 0 }, 'Transform'),
                ]),
            ]);

            const result = applyScenePrefabOverrides(def, [
                {
                    kind: 'set-component-property',
                    nodeId: 'root',
                    selector: { kind: 'id', componentId: 'Transform' },
                    path: ['x'],
                    value: 42,
                },
            ]);

            const transformData = result.entities[0]!.components[0]!.data as Record<string, unknown>;
            expect(transformData.x).toBe(42);
            // y and z remain unchanged
            expect(transformData.y).toBe(0);
            expect(transformData.z).toBe(0);
        });

        it('applies add-component override', () => {
            const def = makeDefinition('override-add-comp', [
                makeEntity('root', 'Root'),
            ]);

            const result = applyScenePrefabOverrides(def, [
                {
                    kind: 'add-component',
                    nodeId: 'root',
                    component: makeComponent('Rigidbody', { mass: 5 }),
                },
            ]);

            expect(result.entities[0]!.components).toHaveLength(1);
            expect(result.entities[0]!.components[0]!.type).toBe('Rigidbody');
        });

        it('applies multiple overrides in sequence', () => {
            const def = makeDefinition('multi-override', [
                makeEntity('root', 'Root', null, [
                    makeComponent('Transform', { x: 0 }, 'Transform'),
                ]),
                makeEntity('child', 'Child', 'root'),
            ]);

            const result = applyScenePrefabOverrides(def, [
                { kind: 'set-entity-field', nodeId: 'root', field: 'name', value: 'Parent' },
                { kind: 'set-entity-field', nodeId: 'child', field: 'layer', value: 5 },
                {
                    kind: 'set-component-property',
                    nodeId: 'root',
                    selector: { kind: 'id', componentId: 'Transform' },
                    path: ['x'],
                    value: 100,
                },
            ]);

            expect(result.entities[0]!.name).toBe('Parent');
            expect(result.entities[1]!.layer).toBe(5);
            expect((result.entities[0]!.components[0]!.data as Record<string, unknown>).x).toBe(100);
        });

        it('workflow applyOverrides resolves and applies in one step', () => {
            const def = makeDefinition('wf-override', [
                makeEntity('root', 'Original'),
            ]);
            const workflow = new ScenePrefabWorkflow({ prefabs: [def] });

            const result = workflow.applyOverrides(
                { kind: 'registry', prefabId: 'wf-override' },
                [{ kind: 'set-entity-field', nodeId: 'root', field: 'name', value: 'Modified' }],
            );

            expect(result.kind).toBe('resolved');
            expect(result.entities[0]!.name).toBe('Modified');
        });
    });

    // ── 9. Multiple instances coexist without interference ───────────────
    describe('multiple instance coexistence', () => {
        it('multiple instances of the same prefab coexist without interference', () => {
            const def = makeDefinition('coexist-prefab', [
                makeEntity('root', 'Root', null, [
                    makeComponent('Transform', { x: 0, y: 0 }),
                ]),
                makeEntity('arm', 'Arm', 'root'),
            ]);
            const workflow = new ScenePrefabWorkflow({ prefabs: [def] });

            const inst1 = simulateInstantiation(workflow, 'coexist-prefab', 'enemy-1');
            const inst2 = simulateInstantiation(workflow, 'coexist-prefab', 'enemy-2');
            const inst3 = simulateInstantiation(workflow, 'coexist-prefab', 'enemy-3');

            // All three instances have the expected number of entities
            expect(inst1).toHaveLength(2);
            expect(inst2).toHaveLength(2);
            expect(inst3).toHaveLength(2);

            // All nodeIds across all instances are unique
            const allIds = [
                ...inst1.map((a) => a.nodeId),
                ...inst2.map((a) => a.nodeId),
                ...inst3.map((a) => a.nodeId),
            ];
            expect(new Set(allIds).size).toBe(allIds.length);

            // Parent-child relationships are scoped per instance
            for (const inst of [inst1, inst2, inst3]) {
                const root = inst.find((a) => a.name === 'Root')!;
                const arm = inst.find((a) => a.name === 'Arm')!;
                expect(root.parentNodeId).toBeNull();
                expect(arm.parentNodeId).toBe(root.nodeId);
            }
        });

        it('applying overrides to one resolved instance does not affect another', () => {
            const def = makeDefinition('isolated', [
                makeEntity('root', 'Base', null, [
                    makeComponent('Transform', { x: 0 }, 'Transform'),
                ]),
            ]);
            const workflow = new ScenePrefabWorkflow({ prefabs: [def] });

            const overridden = workflow.applyOverrides(
                { kind: 'registry', prefabId: 'isolated' },
                [
                    {
                        kind: 'set-component-property',
                        nodeId: 'root',
                        selector: { kind: 'id', componentId: 'Transform' },
                        path: ['x'],
                        value: 999,
                    },
                ],
            );

            const fresh = workflow.resolvePrefab({ kind: 'registry', prefabId: 'isolated' });

            // Overridden instance has the new value
            expect((overridden.entities[0]!.components[0]!.data as Record<string, unknown>).x).toBe(999);
            // Fresh resolution still has the original value
            expect((fresh.definition.entities[0]!.components[0]!.data as Record<string, unknown>).x).toBe(0);
        });
    });

    // ── 10. Nested prefab references resolve correctly ───────────────────
    describe('nested prefab resolution', () => {
        it('resolves deeply nested prefab references', () => {
            const leaf = makeDefinition('leaf', [
                makeEntity('leaf-node', 'Leaf'),
            ]);
            const branch: ScenePrefabDefinition = {
                id: 'branch',
                kind: 'prefab',
                entities: [makeEntity('branch-root', 'BranchRoot')],
                nested: [
                    {
                        instanceId: 'leaf-inst',
                        reference: { kind: 'registry', prefabId: 'leaf' },
                        parentNodeId: 'branch-root',
                    },
                ],
            };
            const tree: ScenePrefabDefinition = {
                id: 'tree',
                kind: 'prefab',
                entities: [makeEntity('tree-root', 'TreeRoot')],
                nested: [
                    {
                        instanceId: 'branch-inst',
                        reference: { kind: 'registry', prefabId: 'branch' },
                        parentNodeId: 'tree-root',
                    },
                ],
            };

            const workflow = new ScenePrefabWorkflow({ prefabs: [leaf, branch, tree] });
            const result = workflow.resolvePrefab({ kind: 'registry', prefabId: 'tree' });

            // tree-root + branch-root (scoped) + leaf-node (double-scoped)
            expect(result.definition.entities).toHaveLength(3);

            const treeRoot = result.definition.entities.find((a) => a.nodeId === 'tree-root');
            const branchRoot = result.definition.entities.find((a) => a.nodeId === 'branch-inst::branch-root');
            const leafNode = result.definition.entities.find((a) => a.nodeId === 'branch-inst::leaf-inst::leaf-node');

            expect(treeRoot).toBeDefined();
            expect(branchRoot).toBeDefined();
            expect(leafNode).toBeDefined();

            // Hierarchy chain
            expect(treeRoot!.parentNodeId).toBeNull();
            expect(branchRoot!.parentNodeId).toBe('tree-root');
            expect(leafNode!.parentNodeId).toBe('branch-inst::branch-root');
        });

        it('nested instances with namePrefix apply prefix to entity names', () => {
            const inner = makeDefinition('inner-name', [
                makeEntity('root', 'InnerRoot'),
                makeEntity('child', 'InnerChild', 'root'),
            ]);
            const outer: ScenePrefabDefinition = {
                id: 'outer-name',
                kind: 'prefab',
                entities: [makeEntity('root', 'OuterRoot')],
                nested: [
                    {
                        instanceId: 'n1',
                        reference: { kind: 'registry', prefabId: 'inner-name' },
                        parentNodeId: 'root',
                        namePrefix: '[Nested] ',
                    },
                ],
            };

            const workflow = new ScenePrefabWorkflow({ prefabs: [inner, outer] });
            const result = workflow.resolvePrefab({ kind: 'registry', prefabId: 'outer-name' });

            const nestedRoot = result.definition.entities.find((a) => a.nodeId === 'n1::root');
            const nestedChild = result.definition.entities.find((a) => a.nodeId === 'n1::child');

            expect(nestedRoot!.name).toBe('[Nested] InnerRoot');
            expect(nestedChild!.name).toBe('[Nested] InnerChild');
        });

        it('nested instances with overrides apply them to scoped entities', () => {
            const inner = makeDefinition('inner-ov', [
                makeEntity('root', 'OriginalName', null, [
                    makeComponent('Transform', { x: 0 }, 'Transform'),
                ]),
            ]);
            const outer: ScenePrefabDefinition = {
                id: 'outer-ov',
                kind: 'prefab',
                entities: [makeEntity('root', 'OuterRoot')],
                nested: [
                    {
                        instanceId: 'n1',
                        reference: { kind: 'registry', prefabId: 'inner-ov' },
                        parentNodeId: 'root',
                        overrides: [
                            {
                                kind: 'set-component-property',
                                nodeId: 'root',
                                selector: { kind: 'id', componentId: 'Transform' },
                                path: ['x'],
                                value: 77,
                            },
                        ],
                    },
                ],
            };

            const workflow = new ScenePrefabWorkflow({ prefabs: [inner, outer] });
            const result = workflow.resolvePrefab({ kind: 'registry', prefabId: 'outer-ov' });

            const nestedEntity = result.definition.entities.find((a) => a.nodeId === 'n1::root');
            expect(nestedEntity).toBeDefined();
            expect((nestedEntity!.components[0]!.data as Record<string, unknown>).x).toBe(77);
        });
    });
});
