import { describe, expect, it } from 'vitest';
import {
    createScenePrefabState,
    validateScenePrefabState,
    applyScenePrefabOverrideOperations,
} from '../scene-prefab-operations';
import { ScenePrefabWorkflow, resolveScenePrefab } from '../scene-prefab-workflow';
import { ScenePrefabValidationError, ScenePrefabResolutionError } from '../errors';
import type {
    SceneEntitySnapshot,
    SceneComponentSnapshot,
    ScenePrefabDefinition,
} from '../types';

// ─── Helpers ───────────────────────────────────────────────────────────────

const makeEntity = (
    nodeId: string,
    name = 'Entity',
    parentNodeId: string | null = null,
    components: SceneComponentSnapshot[] = [],
): SceneEntitySnapshot => ({
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

const makeDefinition = (
    id: string,
    entities: SceneEntitySnapshot[] = [makeEntity('root', 'Root')],
): ScenePrefabDefinition => ({
    id,
    kind: 'prefab',
    entities,
});

// ---------------------------------------------------------------------------
// Duplicate nodeId detection in createScenePrefabState
// ---------------------------------------------------------------------------
describe('Prefab ID collision — createScenePrefabState', () => {
    it('throws ScenePrefabValidationError when two entities share the same nodeId', () => {
        const definition = makeDefinition('dup-prefab', [
            makeEntity('shared-id', 'Entity-A'),
            makeEntity('shared-id', 'Entity-B'),
        ]);

        expect(() => createScenePrefabState(definition)).toThrow(ScenePrefabValidationError);
    });

    it('includes the duplicate nodeId in the error message', () => {
        const definition = makeDefinition('dup-prefab', [
            makeEntity('node-42', 'Entity-A'),
            makeEntity('node-42', 'Entity-B'),
        ]);

        expect(() => createScenePrefabState(definition)).toThrowError(/node-42/);
    });

    it('includes the prefab id in the error message', () => {
        const definition = makeDefinition('my-prefab', [
            makeEntity('dup', 'A'),
            makeEntity('dup', 'B'),
        ]);

        expect(() => createScenePrefabState(definition)).toThrowError(/my-prefab/);
    });

    it('succeeds when all nodeIds are unique', () => {
        const definition = makeDefinition('ok-prefab', [
            makeEntity('node-a', 'A'),
            makeEntity('node-b', 'B'),
            makeEntity('node-c', 'C'),
        ]);

        const state = createScenePrefabState(definition);
        expect(state.entityIndex.size).toBe(3);
    });
});

// ---------------------------------------------------------------------------
// Duplicate nodeId detection in validateScenePrefabState
// ---------------------------------------------------------------------------
describe('Prefab ID collision — validateScenePrefabState', () => {
    it('throws ScenePrefabValidationError on duplicate nodeIds', () => {
        const definition = makeDefinition('val-prefab', [
            makeEntity('same-id', 'A'),
            makeEntity('same-id', 'B'),
        ]);

        const state = {
            id: definition.id,
            entities: definition.entities.map((entity) => ({ ...entity, parentNodeId: entity.parentNodeId ?? null, components: [...entity.components] })),
            entityIndex: new Map(),
        };

        expect(() => validateScenePrefabState(state as any)).toThrow(ScenePrefabValidationError);
    });

    it('throws when entity references a missing parent nodeId', () => {
        const definition = makeDefinition('orphan-prefab', [
            makeEntity('child', 'Child', 'missing-parent'),
        ]);

        const state = createScenePrefabState({ id: 'orphan-prefab', entities: [makeEntity('root')] });
        // Manually add an entity with a missing parent to bypass createScenePrefabState's index check
        state.entities.push({
            nodeId: 'child',
            parentNodeId: 'missing-parent',
            name: 'Child',
            layer: 0,
            tag: 'default',
            active: true,
            persistent: false,
            pooled: false,
            components: [],
        });

        expect(() => validateScenePrefabState(state)).toThrow(ScenePrefabValidationError);
        expect(() => {
            try {
                validateScenePrefabState(state);
            } catch (e) {
                throw e;
            }
        }).toThrowError(/missing-parent/);
    });
});

// ---------------------------------------------------------------------------
// Workflow registration: duplicate prefabId behavior
// ---------------------------------------------------------------------------
describe('Prefab ID collision — workflow registration', () => {
    it('second registration with same prefabId silently overwrites the first', () => {
        const wf = new ScenePrefabWorkflow();
        const first = makeDefinition('shared-id', [makeEntity('root', 'First')]);
        const second = makeDefinition('shared-id', [makeEntity('root', 'Second')]);

        wf.register(first);
        expect(wf.getPrefab('shared-id')!.entities[0]!.name).toBe('First');

        wf.register(second);
        expect(wf.getPrefab('shared-id')!.entities[0]!.name).toBe('Second');
    });

    it('registerAll with duplicate ids keeps the last entry', () => {
        const wf = new ScenePrefabWorkflow();
        const defs = [
            makeDefinition('dup', [makeEntity('root', 'A')]),
            makeDefinition('dup', [makeEntity('root', 'B')]),
        ];

        wf.registerAll(defs);
        expect(wf.getPrefab('dup')!.entities[0]!.name).toBe('B');
    });

    it('constructor prefabs with duplicate ids keeps the last entry', () => {
        const wf = new ScenePrefabWorkflow({
            prefabs: [
                makeDefinition('dup', [makeEntity('root', 'First')]),
                makeDefinition('dup', [makeEntity('root', 'Last')]),
            ],
        });

        expect(wf.getPrefab('dup')!.entities[0]!.name).toBe('Last');
    });
});

// ---------------------------------------------------------------------------
// Resolving prefab reference with empty string prefabId
// ---------------------------------------------------------------------------
describe('Prefab ID collision — empty prefabId resolution', () => {
    it('throws ScenePrefabResolutionError when resolving empty-string prefabId', () => {
        const wf = new ScenePrefabWorkflow();
        expect(() => wf.resolvePrefab({ kind: 'registry', prefabId: '' }))
            .toThrow(ScenePrefabResolutionError);
    });

    it('throws ScenePrefabResolutionError via standalone resolveScenePrefab with empty id', () => {
        expect(() => resolveScenePrefab({ kind: 'registry', prefabId: '' }))
            .toThrow(ScenePrefabResolutionError);
    });

    it('empty-string prefabId does not match a registered prefab', () => {
        const wf = new ScenePrefabWorkflow({ prefabs: [makeDefinition('p1')] });
        expect(wf.getPrefab('')).toBeUndefined();
    });
});

// ---------------------------------------------------------------------------
// Nested prefab instances — scoped nodeId collision
// ---------------------------------------------------------------------------
describe('Prefab ID collision — nested instances', () => {
    it('scoped nodeIds prevent collision between two nested instances of the same prefab', () => {
        const child = makeDefinition('child-prefab', [
            makeEntity('inner-root', 'InnerRoot'),
            makeEntity('inner-child', 'InnerChild', 'inner-root'),
        ]);

        const parent: ScenePrefabDefinition = {
            id: 'parent',
            kind: 'prefab',
            entities: [makeEntity('root', 'Root')],
            nested: [
                {
                    instanceId: 'inst-A',
                    reference: { kind: 'registry', prefabId: 'child-prefab' },
                    parentNodeId: 'root',
                },
                {
                    instanceId: 'inst-B',
                    reference: { kind: 'registry', prefabId: 'child-prefab' },
                    parentNodeId: 'root',
                },
            ],
        };

        const wf = new ScenePrefabWorkflow({ prefabs: [child, parent] });
        const result = wf.resolvePrefab({ kind: 'registry', prefabId: 'parent' });

        const nodeIds = result.definition.entities.map((a) => a.nodeId);
        // Each nested instance gets its own scoped nodeId — no collision
        expect(nodeIds).toContain('inst-A::inner-root');
        expect(nodeIds).toContain('inst-B::inner-root');
        expect(nodeIds).toContain('inst-A::inner-child');
        expect(nodeIds).toContain('inst-B::inner-child');

        // All nodeIds should be unique
        const uniqueIds = new Set(nodeIds);
        expect(uniqueIds.size).toBe(nodeIds.length);
    });

    it('nested instance with same instanceId causes nodeId collision', () => {
        const child = makeDefinition('child-prefab', [
            makeEntity('inner-root', 'InnerRoot'),
        ]);

        const parent: ScenePrefabDefinition = {
            id: 'parent',
            kind: 'prefab',
            entities: [makeEntity('root', 'Root')],
            nested: [
                {
                    instanceId: 'same-inst',
                    reference: { kind: 'registry', prefabId: 'child-prefab' },
                    parentNodeId: 'root',
                },
                {
                    instanceId: 'same-inst',
                    reference: { kind: 'registry', prefabId: 'child-prefab' },
                    parentNodeId: 'root',
                },
            ],
        };

        const wf = new ScenePrefabWorkflow({ prefabs: [child, parent] });
        // The second nested instance merges over the first (same scoped nodeId),
        // so it does NOT throw — mergeScenePrefabEntities replaces on collision.
        const result = wf.resolvePrefab({ kind: 'registry', prefabId: 'parent' });
        expect(result.definition.kind).toBe('resolved');

        // Only one instance of the scoped nodeId should exist
        const scopedIds = result.definition.entities
            .map((a) => a.nodeId)
            .filter((id) => id.startsWith('same-inst::'));
        expect(scopedIds.length).toBe(1);
    });
});

// ---------------------------------------------------------------------------
// rebuildEntityIndex duplicate guard via add-entity override
// ---------------------------------------------------------------------------
describe('Prefab ID collision — add-entity override duplicate guard', () => {
    it('throws when add-entity override uses an existing nodeId', () => {
        const definition = makeDefinition('guard-prefab', [
            makeEntity('root', 'Root'),
        ]);

        const state = createScenePrefabState(definition);

        expect(() =>
            applyScenePrefabOverrideOperations(state, [
                {
                    kind: 'add-entity',
                    entity: makeEntity('root', 'Duplicate'),
                },
            ]),
        ).toThrow(ScenePrefabValidationError);
    });

    it('error message mentions the conflicting nodeId for add-entity', () => {
        const definition = makeDefinition('guard-prefab', [
            makeEntity('existing-node', 'Root'),
        ]);

        const state = createScenePrefabState(definition);

        expect(() =>
            applyScenePrefabOverrideOperations(state, [
                {
                    kind: 'add-entity',
                    entity: makeEntity('existing-node', 'Duplicate'),
                },
            ]),
        ).toThrowError(/existing-node/);
    });

    it('succeeds when add-entity uses a unique nodeId', () => {
        const definition = makeDefinition('ok-prefab', [
            makeEntity('root', 'Root'),
        ]);

        const state = createScenePrefabState(definition);

        expect(() =>
            applyScenePrefabOverrideOperations(state, [
                {
                    kind: 'add-entity',
                    entity: makeEntity('new-node', 'NewEntity'),
                },
            ]),
        ).not.toThrow();

        expect(state.entityIndex.size).toBe(2);
        expect(state.entityIndex.has('new-node')).toBe(true);
    });
});
