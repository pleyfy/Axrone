/**
 * T-03 — Prefab ID Collision Detection Test
 *
 * Regression guard for the Cube.prefab / Cube-copy.prefab incident where
 * prefab, entity, and component IDs were identical across definitions.
 *
 * This suite documents which collision classes the engine currently detects
 * and which remain gaps that need implementation.
 *
 * Detection status (as of writing):
 *   - Prefab ID collision in registry:       NOT DETECTED (silent overwrite)
 *   - Entity nodeId collision in definition:  DETECTED (rebuildEntityIndex)
 *   - Component ID collision in overrides:    DETECTED (add-component guard)
 *   - Component ID collision in definition:   NOT DETECTED (no validation)
 *   - ID format/prefix validation:            NOT DETECTED (no validation)
 */

import { describe, expect, it, beforeEach } from 'vitest';
import {
    ScenePrefabWorkflow,
    resolveScenePrefab,
    ScenePrefabValidationError,
    type SceneEntitySnapshot,
    type SceneComponentSnapshot,
    type ScenePrefabDefinition,
} from '../index';

// ─── Helpers ───────────────────────────────────────────────────────────────

let _nextId = 0;
const uid = (prefix: string): string => `${prefix}_${++_nextId}`;

const resetIdCounter = (): void => {
    _nextId = 0;
};

const makeComponent = (
    id: string,
    type = 'Transform',
    data: Record<string, unknown> = { x: 0, y: 0, z: 0 },
): SceneComponentSnapshot => ({
    id,
    type,
    data,
});

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
    entities: SceneEntitySnapshot[] = [makeEntity('ent_root', 'Root')],
): ScenePrefabDefinition => ({
    id,
    kind: 'prefab',
    entities,
});

// ---------------------------------------------------------------------------
// Group 1: Duplicate Prefab ID Detection (Registry-level)
// ---------------------------------------------------------------------------
describe('T-03.1 — Duplicate Prefab ID Detection', () => {
    it('register() silently overwrites when two definitions share the same prefab ID', () => {
        // GAP: The engine uses Map.set() which silently replaces the previous
        // entry. There is no warning, error, or diagnostic emitted.
        // TODO(engine): ScenePrefabWorkflow.register() should detect duplicate
        // IDs and either throw ScenePrefabValidationError or emit a diagnostic
        // before overwriting. See scene-prefab-workflow.ts line 56.
        const wf = new ScenePrefabWorkflow();

        const original = makeDefinition('scn_cube', [
            makeEntity('ent_root', 'Cube'),
        ]);
        const duplicate = makeDefinition('scn_cube', [
            makeEntity('ent_root', 'Cube-Copy'),
        ]);

        wf.register(original);
        wf.register(duplicate);

        // The duplicate silently replaced the original — this is the bug.
        const retrieved = wf.getPrefab('scn_cube');
        expect(retrieved).toBeDefined();
        expect(retrieved!.entities[0]!.name).toBe('Cube-Copy');
    });

    it('registerAll() silently overwrites on duplicate prefab IDs within a batch', () => {
        // GAP: Same issue — no duplicate detection in batch registration.
        // TODO(engine): ScenePrefabWorkflow.registerAll() should detect
        // duplicate IDs within the batch and across existing entries.
        const wf = new ScenePrefabWorkflow();

        const defs = [
            makeDefinition('scn_shared_id', [makeEntity('ent_a', 'First')]),
            makeDefinition('scn_shared_id', [makeEntity('ent_b', 'Second')]),
        ];

        wf.registerAll(defs);

        const retrieved = wf.getPrefab('scn_shared_id');
        expect(retrieved).toBeDefined();
        // Last-write-wins — no collision reported.
        expect(retrieved!.entities[0]!.name).toBe('Second');
    });

    it('constructor prefabs option silently overwrites on duplicate IDs', () => {
        // GAP: The constructor calls registerAll() which has the same issue.
        // TODO(engine): Validate uniqueness in the constructor options.
        const wf = new ScenePrefabWorkflow({
            prefabs: [
                makeDefinition('scn_dup', [makeEntity('ent_a', 'A')]),
                makeDefinition('scn_dup', [makeEntity('ent_b', 'B')]),
            ],
        });

        const retrieved = wf.getPrefab('scn_dup');
        expect(retrieved!.entities[0]!.name).toBe('B');
    });

    it.todo('register() should throw ScenePrefabValidationError on duplicate prefab ID');
    // Implementation requirement:
    // In scene-prefab-workflow.ts, ScenePrefabWorkflow.register() should check
    // this._definitions.has(prefab.id) before calling set() and throw
    // ScenePrefabValidationError if the ID already exists.
});

// ---------------------------------------------------------------------------
// Group 2: Duplicate Entity (nodeId) Detection
// ---------------------------------------------------------------------------
describe('T-03.2 — Duplicate Entity (nodeId) Detection', () => {
    it('throws ScenePrefabValidationError when two entities share the same nodeId', () => {
        // DETECTED: rebuildEntityIndex() in scene-prefab-operations.ts
        // iterates entities and throws if entityIndex already has the nodeId.
        const definition = makeDefinition('scn_test', [
            makeEntity('ent_shared', 'Entity-A'),
            makeEntity('ent_shared', 'Entity-B'),
        ]);

        expect(() => resolveScenePrefab(definition)).toThrow(
            ScenePrefabValidationError,
        );
    });

    it('error message includes the duplicate nodeId and prefab ID', () => {
        const definition = makeDefinition('scn_myprefab', [
            makeEntity('ent_collision_node', 'First'),
            makeEntity('ent_collision_node', 'Second'),
        ]);

        expect(() => resolveScenePrefab(definition)).toThrow(
            /duplicate entity nodeId 'ent_collision_node'/,
        );
    });

    it('mergeScenePrefabEntities silently replaces when nested instance nodeId collides with parent entity', () => {
        // GAP: mergeScenePrefabEntities() in scene-prefab-operations.ts uses
        // indexOf() + splice() to replace the existing entity when a nodeId
        // collision occurs during merge, but does NOT throw or warn.
        // The rebuildEntityIndex() call in validateScenePrefabState() then
        // sees only one entry per nodeId (the replacement), so no error.
        // TODO(engine): mergeScenePrefabEntities() should detect when a nested
        // instance's scoped nodeId collides with an existing parent entity
        // and throw ScenePrefabValidationError instead of silently replacing.
        const nested = makeDefinition('scn_nested', [
            makeEntity('ent_child', 'NestedChild'),
        ]);

        const parent: ScenePrefabDefinition = {
            id: 'scn_parent',
            kind: 'prefab',
            entities: [
                makeEntity('ent_root', 'Root'),
                // This entity has the same nodeId that the scoped nested
                // instance would produce: 'inst_1::ent_child'
                makeEntity('inst_1::ent_child', 'CollisionEntity'),
            ],
            nested: [
                {
                    instanceId: 'inst_1',
                    reference: { kind: 'registry', prefabId: 'scn_nested' },
                    parentNodeId: 'ent_root',
                },
            ],
        };

        const wf = new ScenePrefabWorkflow({ prefabs: [nested, parent] });
        const result = wf.resolvePrefab({ kind: 'registry', prefabId: 'scn_parent' });

        // The nested instance's entity silently replaced the parent's entity.
        // No collision was reported — this is the gap.
        const collidingEntity = result.definition.entities.find(
            (a) => a.nodeId === 'inst_1::ent_child',
        );
        expect(collidingEntity).toBeDefined();
        expect(collidingEntity!.name).toBe('NestedChild');
    });

    it('add-entity override throws when nodeId already exists', () => {
        // DETECTED: applyScenePrefabOverrideOperation 'add-entity' branch
        // checks state.entityIndex.has(entity.nodeId) before inserting.
        const definition = makeDefinition('scn_test', [
            makeEntity('ent_existing', 'Existing'),
        ]);

        const wf = new ScenePrefabWorkflow({ prefabs: [definition] });

        expect(() =>
            wf.applyOverrides(
                { kind: 'registry', prefabId: 'scn_test' },
                [
                    {
                        kind: 'add-entity',
                        entity: makeEntity('ent_existing', 'Duplicate'),
                    },
                ],
            ),
        ).toThrow(ScenePrefabValidationError);
    });
});

// ---------------------------------------------------------------------------
// Group 3: Duplicate Component ID Detection
// ---------------------------------------------------------------------------
describe('T-03.3 — Duplicate Component ID Detection', () => {
    it('add-component override throws when component ID already exists on entity', () => {
        // DETECTED: In applyScenePrefabOverrideOperation 'add-component' branch,
        // there is an explicit check: entity.components.some(c => c.id === ...).
        const definition = makeDefinition('scn_test', [
            makeEntity('ent_root', 'Root', null, [
                makeComponent('cmp_transform', 'Transform'),
            ]),
        ]);

        const wf = new ScenePrefabWorkflow({ prefabs: [definition] });

        expect(() =>
            wf.applyOverrides(
                { kind: 'registry', prefabId: 'scn_test' },
                [
                    {
                        kind: 'add-component',
                        nodeId: 'ent_root',
                        component: makeComponent('cmp_transform', 'Transform'),
                    },
                ],
            ),
        ).toThrow(ScenePrefabValidationError);
    });

    it('error message includes the duplicate component ID', () => {
        const definition = makeDefinition('scn_test', [
            makeEntity('ent_root', 'Root', null, [
                makeComponent('cmp_mesh', 'MeshRenderer'),
            ]),
        ]);

        const wf = new ScenePrefabWorkflow({ prefabs: [definition] });

        expect(() =>
            wf.applyOverrides(
                { kind: 'registry', prefabId: 'scn_test' },
                [
                    {
                        kind: 'add-component',
                        nodeId: 'ent_root',
                        component: makeComponent('cmp_mesh', 'MeshRenderer'),
                    },
                ],
            ),
        ).toThrow(/already contains component 'cmp_mesh'/);
    });

    it('rejects duplicate component IDs within initial entity definition', () => {
        const definition = makeDefinition('scn_test', [
            makeEntity('ent_root', 'Root', null, [
                makeComponent('cmp_dup', 'Transform', { x: 1 }),
                makeComponent('cmp_dup', 'Transform', { x: 2 }),
            ]),
        ]);

        expect(() => resolveScenePrefab(definition)).toThrow(ScenePrefabValidationError);
        expect(() => resolveScenePrefab(definition)).toThrow(/duplicate component 'cmp_dup'/);
    });

    it('initial definition should reject entities with duplicate component IDs', () => {
        const definition = makeDefinition('scn_test', [
            makeEntity('ent_root', 'Root', null, [
                makeComponent('cmp_dup', 'Transform', { x: 1 }),
                makeComponent('cmp_dup', 'Transform', { x: 2 }),
            ]),
        ]);

        expect(() => resolveScenePrefab(definition)).toThrow(ScenePrefabValidationError);
    });
});

// ---------------------------------------------------------------------------
// Group 4: Valid Unique IDs Pass Without Errors
// ---------------------------------------------------------------------------
describe('T-03.4 — Valid Unique IDs Pass', () => {
    beforeEach(() => {
        resetIdCounter();
    });

    it('resolves prefab with unique IDs across all levels', () => {
        const definition: ScenePrefabDefinition = {
            id: uid('scn'),
            kind: 'prefab',
            entities: [
                makeEntity(uid('ent'), 'Entity-A', null, [
                    makeComponent(uid('cmp'), 'Transform'),
                    makeComponent(uid('cmp'), 'MeshRenderer'),
                ]),
                makeEntity(uid('ent'), 'Entity-B', null, [
                    makeComponent(uid('cmp'), 'Transform'),
                ]),
            ],
        };

        const result = resolveScenePrefab(definition);
        expect(result.definition.kind).toBe('resolved');
        expect(result.definition.entities).toHaveLength(2);
    });

    it('registry holds multiple prefabs with distinct IDs', () => {
        const wf = new ScenePrefabWorkflow();

        const ids = ['scn_alpha', 'scn_beta', 'scn_gamma'];
        for (const id of ids) {
            wf.register(makeDefinition(id));
        }

        for (const id of ids) {
            expect(wf.getPrefab(id)).toBeDefined();
            expect(wf.getPrefab(id)!.id).toBe(id);
        }
    });

    it('resolves variant chain with unique IDs at each level', () => {
        const base: ScenePrefabDefinition = {
            id: 'scn_base',
            kind: 'prefab',
            entities: [
                makeEntity('ent_base_root', 'BaseRoot', null, [
                    makeComponent('cmp_base_transform', 'Transform', { x: 0 }),
                ]),
            ],
        };

        const variant: ScenePrefabDefinition = {
            id: 'scn_variant',
            kind: 'variant',
            entities: [makeEntity('ent_base_root', 'VariantRoot')],
            base: { kind: 'registry', prefabId: 'scn_base' },
        };

        const wf = new ScenePrefabWorkflow({ prefabs: [base, variant] });
        const result = wf.resolvePrefab({ kind: 'registry', prefabId: 'scn_variant' });

        expect(result.definition.kind).toBe('resolved');
        expect(result.definition.entities[0]!.name).toBe('VariantRoot');
        expect(result.definition.lineage).toEqual(['scn_base', 'scn_variant']);
    });

    it('nested instances produce unique scoped nodeIds', () => {
        const child = makeDefinition('scn_child', [
            makeEntity('ent_child_root', 'ChildRoot'),
        ]);

        const parent: ScenePrefabDefinition = {
            id: 'scn_parent',
            kind: 'prefab',
            entities: [makeEntity('ent_parent_root', 'ParentRoot')],
            nested: [
                {
                    instanceId: 'inst_001',
                    reference: { kind: 'registry', prefabId: 'scn_child' },
                    parentNodeId: 'ent_parent_root',
                },
                {
                    instanceId: 'inst_002',
                    reference: { kind: 'registry', prefabId: 'scn_child' },
                    parentNodeId: 'ent_parent_root',
                },
            ],
        };

        const wf = new ScenePrefabWorkflow({ prefabs: [child, parent] });
        const result = wf.resolvePrefab({ kind: 'registry', prefabId: 'scn_parent' });

        const nodeIds = result.definition.entities.map((a) => a.nodeId);
        const uniqueNodeIds = new Set(nodeIds);
        expect(uniqueNodeIds.size).toBe(nodeIds.length);
    });

    it('components with distinct IDs on the same entity resolve correctly', () => {
        const definition = makeDefinition('scn_test', [
            makeEntity('ent_root', 'Root', null, [
                makeComponent('cmp_001', 'Transform'),
                makeComponent('cmp_002', 'MeshRenderer'),
                makeComponent('cmp_003', 'Rigidbody'),
            ]),
        ]);

        const result = resolveScenePrefab(definition);
        const componentIds = result.definition.entities[0]!.components.map(
            (c) => c.id,
        );
        expect(new Set(componentIds).size).toBe(3);
    });
});

// ---------------------------------------------------------------------------
// Group 5: ID Format Validation
// ---------------------------------------------------------------------------
describe('T-03.5 — ID Format Validation', () => {
    it.todo('prefab IDs should follow scn_ prefix convention');
    // The engine does not currently enforce any ID prefix convention.
    // IDs are plain strings with no format validation.
    // TODO(engine): Consider adding an ID format validator that checks:
    //   - Prefab IDs start with 'scn_'
    //   - Entity nodeIds start with 'ent_'
    //   - Component IDs start with 'cmp_'
    // This could be implemented as a validateScenePrefabIdFormat() function
    // called during createScenePrefabState() or register().

    it.todo('entity nodeIds should follow ent_ prefix convention');
    // No format validation exists. Any non-empty string is accepted as nodeId.

    it.todo('component IDs should follow cmp_ prefix convention');
    // No format validation exists. Component IDs are optional strings.

    it('accepts any non-empty string as prefab ID (no format enforcement)', () => {
        // Documents current behavior: arbitrary strings are accepted.
        const arbitraryIds = [
            'Cube',
            'my-prefab',
            '12345',
            '',
            'scn_valid',
            '___',
            'prefab.with.dots',
            'prefab/with/slashes',
        ];

        for (const id of arbitraryIds) {
            const wf = new ScenePrefabWorkflow();
            // Even empty string IDs are accepted by the registry.
            wf.register(makeDefinition(id));
            expect(wf.getPrefab(id)).toBeDefined();
        }
    });

    it('accepts any non-empty string as nodeId (no format enforcement)', () => {
        // Documents current behavior: the only requirement is non-empty
        // after trimming (enforced by ensureScenePrefabNodeId).
        const definition = makeDefinition('scn_test', [
            makeEntity('arbitrary-node-id', 'Entity'),
        ]);

        const result = resolveScenePrefab(definition);
        expect(result.definition.entities[0]!.nodeId).toBe('arbitrary-node-id');
    });

    it('rejects empty or whitespace-only nodeId', () => {
        // DETECTED: ensureScenePrefabNodeId throws if nodeId is empty/missing.
        const definition = makeDefinition('scn_test', [
            {
                nodeId: '   ',
                parentNodeId: null,
                name: 'BadEntity',
                layer: 0,
                tag: 'default',
                active: true,
                persistent: false,
                pooled: false,
                components: [],
            },
        ]);

        expect(() => resolveScenePrefab(definition)).toThrow(
            ScenePrefabValidationError,
        );
    });

    it('accepts components without IDs (ID is optional)', () => {
        // Components may omit the id field entirely — this is by design.
        const definition = makeDefinition('scn_test', [
            makeEntity('ent_root', 'Root', null, [
                { type: 'Transform', data: { x: 0 } },
                { type: 'MeshRenderer', data: { mesh: 'cube' } },
            ]),
        ]);

        const result = resolveScenePrefab(definition);
        expect(result.definition.entities[0]!.components).toHaveLength(2);
        expect(result.definition.entities[0]!.components[0]!.id).toBeUndefined();
    });
});

// ---------------------------------------------------------------------------
// Group 6: Regression — Cube.prefab / Cube-copy.prefab Scenario
// ---------------------------------------------------------------------------
describe('T-03.6 — Regression: Cube.prefab / Cube-copy.prefab Incident', () => {
    it('two prefabs with identical structure but different IDs coexist correctly', () => {
        // This is the exact scenario that triggered the original bug:
        // Cube.prefab and Cube-copy.prefab had identical internal IDs.
        const cube: ScenePrefabDefinition = {
            id: 'scn_cube_001',
            kind: 'prefab',
            entities: [
                makeEntity('ent_cube_root', 'Cube', null, [
                    makeComponent('cmp_cube_transform', 'Transform', { x: 0, y: 0, z: 0 }),
                    makeComponent('cmp_cube_mesh', 'MeshRenderer', { mesh: 'cube' }),
                ]),
            ],
        };

        const cubeCopy: ScenePrefabDefinition = {
            id: 'scn_cube_copy_002',
            kind: 'prefab',
            entities: [
                makeEntity('ent_cube_copy_root', 'Cube-Copy', null, [
                    makeComponent('cmp_cube_copy_transform', 'Transform', { x: 5, y: 0, z: 0 }),
                    makeComponent('cmp_cube_copy_mesh', 'MeshRenderer', { mesh: 'cube' }),
                ]),
            ],
        };

        const wf = new ScenePrefabWorkflow({ prefabs: [cube, cubeCopy] });

        const resolvedCube = wf.resolvePrefab({ kind: 'registry', prefabId: 'scn_cube_001' });
        const resolvedCopy = wf.resolvePrefab({ kind: 'registry', prefabId: 'scn_cube_copy_002' });

        expect(resolvedCube.definition.entities[0]!.name).toBe('Cube');
        expect(resolvedCopy.definition.entities[0]!.name).toBe('Cube-Copy');

        // Verify all IDs are distinct across both prefabs.
        const allPrefabIds = new Set([
            resolvedCube.definition.id,
            resolvedCopy.definition.id,
        ]);
        expect(allPrefabIds.size).toBe(2);

        const allNodeIds = new Set([
            ...resolvedCube.definition.entities.map((a) => a.nodeId),
            ...resolvedCopy.definition.entities.map((a) => a.nodeId),
        ]);
        expect(allNodeIds.size).toBe(2);

        const allComponentIds = new Set([
            ...resolvedCube.definition.entities.flatMap((a) =>
                a.components.map((c) => c.id),
            ),
            ...resolvedCopy.definition.entities.flatMap((a) =>
                a.components.map((c) => c.id),
            ),
        ]);
        expect(allComponentIds.size).toBe(4);
    });

    it('detects the original bug: identical IDs across two prefab definitions', () => {
        // If someone recreates the original bug (identical IDs), the engine
        // should catch it at the entity level at minimum.
        const sharedNodeId = 'ent_shared_node';

        const cube: ScenePrefabDefinition = {
            id: 'scn_cube',
            kind: 'prefab',
            entities: [makeEntity(sharedNodeId, 'Cube')],
        };

        const cubeCopy: ScenePrefabDefinition = {
            id: 'scn_cube_copy',
            kind: 'prefab',
            // Same nodeId as cube — this is the bug pattern.
            entities: [makeEntity(sharedNodeId, 'Cube-Copy')],
        };

        // Within a single prefab, duplicate nodeIds ARE caught.
        const combined: ScenePrefabDefinition = {
            id: 'scn_combined',
            kind: 'prefab',
            entities: [
                makeEntity(sharedNodeId, 'Cube'),
                makeEntity(sharedNodeId, 'Cube-Copy'),
            ],
        };

        expect(() => resolveScenePrefab(combined)).toThrow(
            ScenePrefabValidationError,
        );

        // However, across separate prefab definitions in the registry,
        // the duplicate nodeIds are NOT detected (they are in different
        // resolution contexts). This is acceptable as long as nested
        // instance scoping prevents runtime collisions.
        const wf = new ScenePrefabWorkflow({ prefabs: [cube, cubeCopy] });
        const r1 = wf.resolvePrefab({ kind: 'registry', prefabId: 'scn_cube' });
        const r2 = wf.resolvePrefab({ kind: 'registry', prefabId: 'scn_cube_copy' });

        // Both resolve independently — no cross-prefab nodeId validation.
        expect(r1.definition.entities[0]!.nodeId).toBe(sharedNodeId);
        expect(r2.definition.entities[0]!.nodeId).toBe(sharedNodeId);
    });
});
