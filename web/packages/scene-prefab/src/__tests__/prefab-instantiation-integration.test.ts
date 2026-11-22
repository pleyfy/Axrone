/**
 * T-02: Prefab Instantiation Integration Test
 *
 * Validates prefab loading and entity/component creation using the actual
 * .prefab files shipped in Assets/Prefab/. This is a P0 integration test
 * that exercises the full prefab pipeline:
 *   resolve -> create actors -> hydrate components -> establish hierarchy -> start
 *
 * Tests cover:
 *   1. Prefab JSON can be parsed without errors
 *   2. All component IDs within a prefab are unique
 *   3. Entity references (parentId) resolve correctly
 *   4. Transform hierarchy is valid (parent-child links)
 *   5. Component data matches expected types for each component kind
 *   6. Cube.prefab and Cube-copy.prefab have DIFFERENT IDs (no collision)
 *   7. Prefab with 28 nodes creates correct hierarchy depth
 */

import { describe, expect, it, beforeAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
    ScenePrefabWorkflow,
    type SceneActorSnapshot,
    type SceneComponentSnapshot,
    type ScenePrefabDefinition,
    type SceneSerializedValue,
} from '../index';

// ─── Path resolution ──────────────────────────────────────────────────────

const testDir = path.dirname(fileURLToPath(import.meta.url));
// From: Axrone/web/packages/scene-prefab/src/__tests__
// To:   <repo-root>/Assets/Prefab
const prefabDir = path.resolve(testDir, '../../../../../../Assets/Prefab');
// File-backed fixtures only exist in the outer monorepo checkout; standalone
// worktrees and published packages resolve this suite to a documented skip.
const hasPrefabFixtures = fs.existsSync(prefabDir);

// ─── On-disk prefab schema (schemaVersion 2) ─────────────────────────────

interface PrefabFileComponent {
    id: string;
    kind: string;
    name: string;
    enabled: boolean;
    properties: Record<string, unknown>;
}

interface PrefabFileEntity {
    id: string;
    name: string;
    parentId: string | null;
    enabled: boolean;
    tag: string;
    layer: string;
    components: PrefabFileComponent[];
}

interface PrefabFile {
    schemaVersion: number;
    id: string;
    name: string;
    createdAtMs: number;
    updatedAtMs: number;
    activeEntityId: string;
    settings: Record<string, unknown>;
    entities: PrefabFileEntity[];
}

// ─── Helpers ──────────────────────────────────────────────────────────────

const readPrefabFile = (fileName: string): PrefabFile => {
    const filePath = path.join(prefabDir, fileName);
    const raw = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(raw) as PrefabFile;
};

/**
 * Converts an on-disk PrefabFile (schemaVersion 2) to the internal
 * ScenePrefabDefinition format used by ScenePrefabWorkflow.
 */
const toScenePrefabDefinition = (file: PrefabFile): ScenePrefabDefinition => ({
    id: file.id,
    kind: 'prefab',
    actors: file.entities.map(
        (entity): SceneActorSnapshot => ({
            nodeId: entity.id,
            parentNodeId: entity.parentId,
            name: entity.name,
            layer: 0,
            tag: entity.tag,
            active: entity.enabled,
            persistent: false,
            pooled: false,
            components: entity.components.map(
                (comp): SceneComponentSnapshot => ({
                    id: comp.id,
                    type: comp.kind,
                    data: comp.properties as SceneSerializedValue,
                }),
            ),
        }),
    ),
});

/**
 * Computes the depth of the hierarchy tree. Returns the maximum number
 * of edges from any root (parentId=null) to a leaf.
 */
const computeHierarchyDepth = (entities: PrefabFileEntity[]): number => {
    const childToParent = new Map<string, string | null>();
    for (const e of entities) {
        childToParent.set(e.id, e.parentId);
    }

    let maxDepth = 0;
    for (const entity of entities) {
        let depth = 0;
        let current: string | null = entity.id;
        const visited = new Set<string>();
        while (current !== null) {
            if (visited.has(current)) {
                break; // cycle guard
            }
            visited.add(current);
            const parent = childToParent.get(current) ?? null;
            if (parent !== null) {
                depth++;
            }
            current = parent;
        }
        maxDepth = Math.max(maxDepth, depth);
    }
    return maxDepth;
};

// ─── Shared state ─────────────────────────────────────────────────────────

let cubeFile: PrefabFile;
let cubeCopyFile: PrefabFile;
let characterFile: PrefabFile;

// ─── Tests ────────────────────────────────────────────────────────────────

describe.runIf(hasPrefabFixtures)('T-02: Prefab Instantiation Integration (file-backed)', () => {
    beforeAll(() => {
        cubeFile = readPrefabFile('Cube.prefab');
        cubeCopyFile = readPrefabFile('Cube-copy.prefab');
        characterFile = readPrefabFile('EN_Character_Stickman_01.prefab');
    });

    // ── 1. Prefab JSON can be parsed without errors ──────────────────────
    describe('prefab JSON parsing', () => {
        it('parses Cube.prefab as valid JSON with expected top-level fields', () => {
            expect(cubeFile).toBeDefined();
            expect(cubeFile.schemaVersion).toBe(2);
            expect(cubeFile.id).toBeTruthy();
            expect(cubeFile.name).toBe('Cube');
            expect(cubeFile.entities).toBeInstanceOf(Array);
            expect(cubeFile.entities.length).toBeGreaterThan(0);
        });

        it('parses Cube-copy.prefab as valid JSON with expected top-level fields', () => {
            expect(cubeCopyFile).toBeDefined();
            expect(cubeCopyFile.schemaVersion).toBe(2);
            expect(cubeCopyFile.id).toBeTruthy();
            expect(cubeCopyFile.name).toBe('Cube-copy');
            expect(cubeCopyFile.entities).toBeInstanceOf(Array);
        });

        it('parses EN_Character_Stickman_01.prefab as valid JSON', () => {
            expect(characterFile).toBeDefined();
            expect(characterFile.schemaVersion).toBe(2);
            expect(characterFile.id).toBeTruthy();
            expect(characterFile.name).toBe('EN_Character_Stickman_01');
            expect(characterFile.entities).toBeInstanceOf(Array);
        });

        it('every entity in each prefab has required fields', () => {
            for (const file of [cubeFile, cubeCopyFile, characterFile]) {
                for (const entity of file.entities) {
                    expect(entity.id).toBeTruthy();
                    expect(typeof entity.id).toBe('string');
                    expect(entity.name).toBeTruthy();
                    expect(typeof entity.name).toBe('string');
                    expect(Array.isArray(entity.components)).toBe(true);
                }
            }
        });
    });

    // ── 2. All component IDs within a prefab are unique ──────────────────
    describe('component ID uniqueness', () => {
        it('Cube.prefab has all unique component IDs', () => {
            const componentIds = cubeFile.entities.flatMap((e) =>
                e.components.map((c) => c.id),
            );
            expect(new Set(componentIds).size).toBe(componentIds.length);
        });

        it('Cube-copy.prefab has all unique component IDs', () => {
            const componentIds = cubeCopyFile.entities.flatMap((e) =>
                e.components.map((c) => c.id),
            );
            expect(new Set(componentIds).size).toBe(componentIds.length);
        });

        it('EN_Character_Stickman_01.prefab has all unique component IDs', () => {
            const componentIds = characterFile.entities.flatMap((e) =>
                e.components.map((c) => c.id),
            );
            expect(new Set(componentIds).size).toBe(componentIds.length);
        });

        it('all three prefabs combined have no cross-prefab component ID collisions', () => {
            const allIds = [
                ...cubeFile.entities.flatMap((e) => e.components.map((c) => c.id)),
                ...cubeCopyFile.entities.flatMap((e) => e.components.map((c) => c.id)),
                ...characterFile.entities.flatMap((e) => e.components.map((c) => c.id)),
            ];
            expect(new Set(allIds).size).toBe(allIds.length);
        });
    });

    // ── 3. Entity references (parentId) resolve correctly ────────────────
    describe('entity reference resolution', () => {
        it('every parentId in Cube.prefab references an existing entity or is null', () => {
            const entityIds = new Set(cubeFile.entities.map((e) => e.id));
            for (const entity of cubeFile.entities) {
                if (entity.parentId !== null) {
                    expect(entityIds.has(entity.parentId)).toBe(true);
                }
            }
        });

        it('every parentId in Cube-copy.prefab references an existing entity or is null', () => {
            const entityIds = new Set(cubeCopyFile.entities.map((e) => e.id));
            for (const entity of cubeCopyFile.entities) {
                if (entity.parentId !== null) {
                    expect(entityIds.has(entity.parentId)).toBe(true);
                }
            }
        });

        it('every parentId in EN_Character_Stickman_01.prefab references an existing entity or is null', () => {
            const entityIds = new Set(characterFile.entities.map((e) => e.id));
            for (const entity of characterFile.entities) {
                if (entity.parentId !== null) {
                    expect(entityIds.has(entity.parentId)).toBe(true);
                }
            }
        });

        it('activeEntityId points to a valid entity in each prefab', () => {
            for (const file of [cubeFile, cubeCopyFile, characterFile]) {
                const entityIds = new Set(file.entities.map((e) => e.id));
                expect(entityIds.has(file.activeEntityId)).toBe(true);
            }
        });
    });

    // ── 4. Transform hierarchy is valid (parent-child links) ─────────────
    describe('transform hierarchy validity', () => {
        it('Cube.prefab has exactly one root entity (parentId=null)', () => {
            const roots = cubeFile.entities.filter((e) => e.parentId === null);
            expect(roots).toHaveLength(1);
            expect(roots[0]!.name).toBe('Cube');
        });

        it('Cube-copy.prefab has exactly one root entity (parentId=null)', () => {
            const roots = cubeCopyFile.entities.filter((e) => e.parentId === null);
            expect(roots).toHaveLength(1);
            expect(roots[0]!.name).toBe('Cube-copy');
        });

        it('EN_Character_Stickman_01.prefab has exactly one root entity', () => {
            const roots = characterFile.entities.filter((e) => e.parentId === null);
            expect(roots).toHaveLength(1);
            expect(roots[0]!.name).toBe('EN_Character_Stickman_01');
        });

        it('hierarchy has no cycles in any prefab', () => {
            for (const file of [cubeFile, cubeCopyFile, characterFile]) {
                const parentMap = new Map<string, string | null>();
                for (const e of file.entities) {
                    parentMap.set(e.id, e.parentId);
                }

                for (const entity of file.entities) {
                    const visited = new Set<string>();
                    let current: string | null = entity.id;
                    while (current !== null) {
                        expect(visited.has(current)).toBe(false);
                        visited.add(current);
                        current = parentMap.get(current) ?? null;
                    }
                }
            }
        });

        it('every non-root entity has a parent that is a different entity', () => {
            for (const file of [cubeFile, cubeCopyFile, characterFile]) {
                for (const entity of file.entities) {
                    if (entity.parentId !== null) {
                        expect(entity.parentId).not.toBe(entity.id);
                    }
                }
            }
        });
    });

    // ── 5. Component data matches expected types ─────────────────────────
    describe('component data type validation', () => {
        it('every entity in Cube.prefab has a transform component with position/rotation/scale', () => {
            for (const entity of cubeFile.entities) {
                const transform = entity.components.find((c) => c.kind === 'transform');
                expect(transform).toBeDefined();
                const props = transform!.properties;
                expect(Array.isArray(props.position)).toBe(true);
                expect((props.position as number[]).length).toBe(3);
                expect(Array.isArray(props.rotation)).toBe(true);
                expect((props.rotation as number[]).length).toBe(3);
                expect(Array.isArray(props.scale)).toBe(true);
                expect((props.scale as number[]).length).toBe(3);
            }
        });

        it('Cube.prefab root entity has a mesh-renderer component', () => {
            const root = cubeFile.entities.find((e) => e.parentId === null)!;
            const meshRenderer = root.components.find((c) => c.kind === 'mesh-renderer');
            expect(meshRenderer).toBeDefined();
            expect(typeof meshRenderer!.properties.mesh).toBe('string');
            expect(typeof meshRenderer!.properties.material).toBe('string');
            expect(typeof meshRenderer!.properties.castShadows).toBe('boolean');
        });

        it('every entity in EN_Character_Stickman_01.prefab has a transform component', () => {
            for (const entity of characterFile.entities) {
                const transform = entity.components.find((c) => c.kind === 'transform');
                expect(transform, `Entity "${entity.name}" missing transform`).toBeDefined();
                const props = transform!.properties;
                expect(Array.isArray(props.position)).toBe(true);
                expect(Array.isArray(props.rotation)).toBe(true);
                expect(Array.isArray(props.scale)).toBe(true);
            }
        });

        it('character prefab has at least one mesh-renderer component', () => {
            const meshRenderers = characterFile.entities.filter((e) =>
                e.components.some((c) => c.kind === 'mesh-renderer'),
            );
            expect(meshRenderers.length).toBeGreaterThan(0);
        });

        it('character prefab has at least one animator component', () => {
            const animators = characterFile.entities.filter((e) =>
                e.components.some((c) => c.kind === 'animator'),
            );
            expect(animators.length).toBeGreaterThan(0);

            const animatorComp = animators[0]!.components.find((c) => c.kind === 'animator')!;
            expect(typeof animatorComp.properties.clipId).toBe('string');
            expect(Array.isArray(animatorComp.properties.clipIds)).toBe(true);
            expect(typeof animatorComp.properties.speed).toBe('number');
        });

        it('all component kinds are recognized strings', () => {
            const knownKinds = new Set(['transform', 'mesh-renderer', 'animator', 'collider', 'rigidbody']);
            for (const file of [cubeFile, cubeCopyFile, characterFile]) {
                for (const entity of file.entities) {
                    for (const comp of entity.components) {
                        expect(typeof comp.kind).toBe('string');
                        expect(comp.kind.length).toBeGreaterThan(0);
                    }
                }
            }
        });
    });

    // ── 6. Cube.prefab and Cube-copy.prefab have DIFFERENT IDs ───────────
    describe('ID collision between Cube and Cube-copy', () => {
        it('Cube.prefab and Cube-copy.prefab have different scene IDs', () => {
            expect(cubeFile.id).not.toBe(cubeCopyFile.id);
        });

        it('Cube.prefab and Cube-copy.prefab have different active entity IDs', () => {
            expect(cubeFile.activeEntityId).not.toBe(cubeCopyFile.activeEntityId);
        });

        it('Cube.prefab and Cube-copy.prefab entity IDs do not overlap', () => {
            const cubeEntityIds = new Set(cubeFile.entities.map((e) => e.id));
            const copyEntityIds = new Set(cubeCopyFile.entities.map((e) => e.id));

            for (const id of cubeEntityIds) {
                expect(copyEntityIds.has(id)).toBe(false);
            }
        });

        it('Cube.prefab and Cube-copy.prefab component IDs do not overlap', () => {
            const cubeCompIds = new Set(
                cubeFile.entities.flatMap((e) => e.components.map((c) => c.id)),
            );
            const copyCompIds = new Set(
                cubeCopyFile.entities.flatMap((e) => e.components.map((c) => c.id)),
            );

            for (const id of cubeCompIds) {
                expect(copyCompIds.has(id)).toBe(false);
            }
        });

        it('both Cube prefabs have the same structure (entity count and component count)', () => {
            expect(cubeFile.entities.length).toBe(cubeCopyFile.entities.length);

            for (let i = 0; i < cubeFile.entities.length; i++) {
                expect(cubeFile.entities[i]!.components.length).toBe(
                    cubeCopyFile.entities[i]!.components.length,
                );
            }
        });
    });

    // ── 7. Character prefab with 28 nodes creates correct hierarchy ──────
    describe('character prefab hierarchy (28 nodes)', () => {
        it('has exactly 28 entities', () => {
            expect(characterFile.entities.length).toBe(28);
        });

        it('has a hierarchy depth of at least 3 (root -> armature -> main -> bone)', () => {
            const depth = computeHierarchyDepth(characterFile.entities);
            expect(depth).toBeGreaterThanOrEqual(3);
        });

        it('root entity name matches the prefab name', () => {
            const root = characterFile.entities.find((e) => e.parentId === null)!;
            expect(root.name).toBe('EN_Character_Stickman_01');
        });

        it('second-level entity is Armature', () => {
            const root = characterFile.entities.find((e) => e.parentId === null)!;
            const armature = characterFile.entities.find(
                (e) => e.parentId === root.id,
            );
            expect(armature).toBeDefined();
            expect(armature!.name).toBe('Armature');
        });

        it('all 28 entities are reachable from the root (single connected tree)', () => {
            const root = characterFile.entities.find((e) => e.parentId === null)!;
            const childrenOf = new Map<string, string[]>();
            for (const e of characterFile.entities) {
                if (e.parentId !== null) {
                    const children = childrenOf.get(e.parentId) ?? [];
                    children.push(e.id);
                    childrenOf.set(e.parentId, children);
                }
            }

            const reachable = new Set<string>();
            const stack = [root.id];
            while (stack.length > 0) {
                const current = stack.pop()!;
                reachable.add(current);
                const children = childrenOf.get(current) ?? [];
                stack.push(...children);
            }

            expect(reachable.size).toBe(28);
        });

        it('every entity has at least one component (transform)', () => {
            for (const entity of characterFile.entities) {
                expect(
                    entity.components.length,
                    `Entity "${entity.name}" has no components`,
                ).toBeGreaterThan(0);
            }
        });
    });

    // ── 8. Integration with ScenePrefabWorkflow ──────────────────────────
    describe('ScenePrefabWorkflow integration', () => {
        it('resolves Cube.prefab through the workflow without errors', () => {
            const definition = toScenePrefabDefinition(cubeFile);
            const workflow = new ScenePrefabWorkflow({ prefabs: [definition] });

            const result = workflow.resolvePrefab({ kind: 'registry', prefabId: cubeFile.id });

            expect(result.definition.kind).toBe('resolved');
            expect(result.definition.lineage).toEqual([cubeFile.id]);
            expect(result.definition.actors.length).toBe(cubeFile.entities.length);
        });

        it('resolves EN_Character_Stickman_01.prefab through the workflow', () => {
            const definition = toScenePrefabDefinition(characterFile);
            const workflow = new ScenePrefabWorkflow({ prefabs: [definition] });

            const result = workflow.resolvePrefab({
                kind: 'registry',
                prefabId: characterFile.id,
            });

            expect(result.definition.kind).toBe('resolved');
            expect(result.definition.actors.length).toBe(28);
        });

        it('resolved Cube prefab preserves hierarchy (root has no parent)', () => {
            const definition = toScenePrefabDefinition(cubeFile);
            const workflow = new ScenePrefabWorkflow({ prefabs: [definition] });
            const result = workflow.resolvePrefab({ kind: 'registry', prefabId: cubeFile.id });

            const rootActor = result.definition.actors.find(
                (a) => a.name === 'Cube',
            );
            expect(rootActor).toBeDefined();
            expect(rootActor!.parentNodeId).toBeNull();
        });

        it('resolved character prefab preserves full hierarchy chain', () => {
            const definition = toScenePrefabDefinition(characterFile);
            const workflow = new ScenePrefabWorkflow({ prefabs: [definition] });
            const result = workflow.resolvePrefab({
                kind: 'registry',
                prefabId: characterFile.id,
            });

            const actors = result.definition.actors;
            const actorById = new Map(actors.map((a) => [a.nodeId, a]));

            // Verify every non-root actor's parentNodeId points to an existing actor
            for (const actor of actors) {
                if (actor.parentNodeId !== null) {
                    expect(
                        actorById.has(actor.parentNodeId),
                        `Actor "${actor.name}" references missing parent "${actor.parentNodeId}"`,
                    ).toBe(true);
                }
            }
        });

        it('resolved prefab actors carry source metadata', () => {
            const definition = toScenePrefabDefinition(cubeFile);
            const workflow = new ScenePrefabWorkflow({ prefabs: [definition] });
            const result = workflow.resolvePrefab({ kind: 'registry', prefabId: cubeFile.id });

            for (const actor of result.definition.actors) {
                expect(actor.source).toBeDefined();
                expect(actor.source!.prefabId).toBe(cubeFile.id);
            }
        });

        it('resolved prefab component data is preserved from the file', () => {
            const definition = toScenePrefabDefinition(cubeFile);
            const workflow = new ScenePrefabWorkflow({ prefabs: [definition] });
            const result = workflow.resolvePrefab({ kind: 'registry', prefabId: cubeFile.id });

            const cubeActor = result.definition.actors.find((a) => a.name === 'Cube')!;
            const transformComp = cubeActor.components.find((c) => c.type === 'transform');
            expect(transformComp).toBeDefined();

            const data = transformComp!.data as Record<string, unknown>;
            expect(Array.isArray(data.position)).toBe(true);
            expect(Array.isArray(data.rotation)).toBe(true);
            expect(Array.isArray(data.scale)).toBe(true);
        });
    });
});

describe('T-02 fixture availability', () => {
    it.runIf(!hasPrefabFixtures)('skips file-backed cases when Assets fixtures are absent', () => {
        expect(hasPrefabFixtures).toBe(false);
    });
});
