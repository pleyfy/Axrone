import { describe, expect, it } from 'vitest';
import {
    cloneSceneSerializedValue,
    deepEqualSceneSerializedValue,
    isScenePrefabReference,
    createScenePrefabScopedNodeId,
    serializeScenePrefabPropertyPath,
    createScenePrefabComponentSelector,
    getScenePrefabComponentSelectorKey,
    findScenePrefabComponentIndex,
    hasScenePrefabComposition,
    cloneSceneEntitySnapshot,
    cloneSceneComponentSnapshot,
    cloneScenePrefabDefinition,
    cloneScenePrefabOverrideOperation,
    cloneScenePrefabReference,
    cloneScenePrefabMetadata,
    cloneScenePrefabNodeSource,
    isScenePrefabPropertyPathAncestor,
} from '../scene-prefab-internals';
import type {
    SceneSerializedValue,
    ScenePrefabOverrideOperation,
    ScenePrefabReference,
    SceneEntitySnapshot,
    SceneComponentSnapshot,
    ScenePrefabDefinition,
} from '../types';

// ─── Helpers ───────────────────────────────────────────────────────────────

const makeEntity = (
    nodeId: string,
    name = 'Entity',
    parentNodeId: string | null = null,
): SceneEntitySnapshot => ({
    nodeId,
    parentNodeId,
    name,
    layer: 0,
    tag: 'default',
    active: true,
    persistent: false,
    pooled: false,
    components: [],
});

// ---------------------------------------------------------------------------
// cloneSceneSerializedValue
// ---------------------------------------------------------------------------
describe('cloneSceneSerializedValue', () => {
    it('returns primitives as-is', () => {
        expect(cloneSceneSerializedValue(42)).toBe(42);
        expect(cloneSceneSerializedValue('hello')).toBe('hello');
        expect(cloneSceneSerializedValue(true)).toBe(true);
        expect(cloneSceneSerializedValue(null)).toBeNull();
    });

    it('deep-clones arrays', () => {
        const arr: SceneSerializedValue = [1, 'a', true, null];
        const cloned = cloneSceneSerializedValue(arr);
        expect(cloned).toEqual(arr);
        expect(cloned).not.toBe(arr);
    });

    it('deep-clones nested objects', () => {
        const obj: SceneSerializedValue = { x: 1, y: { z: 2 } };
        const cloned = cloneSceneSerializedValue(obj);
        expect(cloned).toEqual(obj);
        expect(cloned).not.toBe(obj);
        if (typeof cloned === 'object' && cloned !== null && !Array.isArray(cloned)) {
            expect(cloned.y).not.toBe(obj.y);
        }
    });

    it('deep-clones nested arrays', () => {
        const arr: SceneSerializedValue = [[1, 2], [3, [4, 5]]];
        const cloned = cloneSceneSerializedValue(arr);
        expect(cloned).toEqual(arr);
        expect(cloned).not.toBe(arr);
    });
});

// ---------------------------------------------------------------------------
// deepEqualSceneSerializedValue
// ---------------------------------------------------------------------------
describe('deepEqualSceneSerializedValue', () => {
    it('returns true for same reference', () => {
        const val: SceneSerializedValue = { x: 1 };
        expect(deepEqualSceneSerializedValue(val, val)).toBe(true);
    });

    it('compares primitives correctly', () => {
        expect(deepEqualSceneSerializedValue(1, 1)).toBe(true);
        expect(deepEqualSceneSerializedValue(1, 2)).toBe(false);
        expect(deepEqualSceneSerializedValue('a', 'a')).toBe(true);
        expect(deepEqualSceneSerializedValue('a', 'b')).toBe(false);
        expect(deepEqualSceneSerializedValue(null, null)).toBe(true);
        expect(deepEqualSceneSerializedValue(true, false)).toBe(false);
    });

    it('returns false for type mismatch', () => {
        expect(deepEqualSceneSerializedValue(1 as any, '1' as any)).toBe(false);
        expect(deepEqualSceneSerializedValue(null, 1 as any)).toBe(false);
        expect(deepEqualSceneSerializedValue([1] as any, { 0: 1 } as any)).toBe(false);
    });

    it('deep-compares arrays', () => {
        expect(deepEqualSceneSerializedValue([1, 2, 3], [1, 2, 3])).toBe(true);
        expect(deepEqualSceneSerializedValue([1, 2], [1, 2, 3])).toBe(false);
    });

    it('deep-compares objects', () => {
        expect(deepEqualSceneSerializedValue({ x: 1, y: 2 }, { x: 1, y: 2 })).toBe(true);
        expect(deepEqualSceneSerializedValue({ x: 1 }, { x: 2 })).toBe(false);
        expect(deepEqualSceneSerializedValue({ x: 1 }, { x: 1, y: 2 } as any)).toBe(false);
    });

    it('deep-compares nested structures', () => {
        const a: SceneSerializedValue = { pos: { x: 1, y: 2, z: 3 } };
        const b: SceneSerializedValue = { pos: { x: 1, y: 2, z: 3 } };
        const c: SceneSerializedValue = { pos: { x: 1, y: 2, z: 99 } };
        expect(deepEqualSceneSerializedValue(a, b)).toBe(true);
        expect(deepEqualSceneSerializedValue(a, c)).toBe(false);
    });

    it('returns false when one side is null', () => {
        expect(deepEqualSceneSerializedValue(null, { x: 1 })).toBe(false);
        expect(deepEqualSceneSerializedValue({ x: 1 }, null)).toBe(false);
    });
});

// ---------------------------------------------------------------------------
// isScenePrefabReference
// ---------------------------------------------------------------------------
describe('isScenePrefabReference', () => {
    it('returns true for inline reference', () => {
        expect(isScenePrefabReference({
            kind: 'inline',
            prefab: { id: 'p', kind: 'prefab', entities: [] },
        })).toBe(true);
    });

    it('returns true for registry reference', () => {
        expect(isScenePrefabReference({
            kind: 'registry',
            prefabId: 'some-id',
        })).toBe(true);
    });

    it('returns false for null', () => {
        expect(isScenePrefabReference(null)).toBe(false);
    });

    it('returns false for non-objects', () => {
        expect(isScenePrefabReference('string' as any)).toBe(false);
        expect(isScenePrefabReference(42 as any)).toBe(false);
    });

    it('returns false for objects without kind', () => {
        expect(isScenePrefabReference({} as any)).toBe(false);
        expect(isScenePrefabReference({ kind: 'unknown' } as any)).toBe(false);
    });

    it('returns false for inline without prefab', () => {
        expect(isScenePrefabReference({ kind: 'inline' } as any)).toBe(false);
    });

    it('returns false for registry without prefabId', () => {
        expect(isScenePrefabReference({ kind: 'registry' } as any)).toBe(false);
    });

    it('returns false for arrays', () => {
        expect(isScenePrefabReference([] as any)).toBe(false);
    });
});

// ---------------------------------------------------------------------------
// createScenePrefabScopedNodeId
// ---------------------------------------------------------------------------
describe('createScenePrefabScopedNodeId', () => {
    it('produces instanceId::nodeId', () => {
        expect(createScenePrefabScopedNodeId('inst-1', 'node-a')).toBe('inst-1::node-a');
    });

    it('handles empty strings', () => {
        expect(createScenePrefabScopedNodeId('', 'node')).toBe('::node');
        expect(createScenePrefabScopedNodeId('inst', '')).toBe('inst::');
    });
});

// ---------------------------------------------------------------------------
// serializeScenePrefabPropertyPath
// ---------------------------------------------------------------------------
describe('serializeScenePrefabPropertyPath', () => {
    it('joins string segments with dots', () => {
        expect(serializeScenePrefabPropertyPath(['a', 'b', 'c'])).toBe('a.b.c');
    });

    it('wraps numeric segments in brackets', () => {
        expect(serializeScenePrefabPropertyPath(['items', 0])).toBe('items.[0]');
    });

    it('handles mixed string and numeric segments', () => {
        expect(serializeScenePrefabPropertyPath(['items', 0, 'name'])).toBe('items.[0].name');
    });

    it('escapes dots in segment names', () => {
        expect(serializeScenePrefabPropertyPath(['a.b', 'c'])).toBe('a\\.b.c');
    });

    it('escapes backslashes in segment names', () => {
        expect(serializeScenePrefabPropertyPath(['a\\b'])).toBe('a\\\\b');
    });

    it('returns empty string for empty path', () => {
        expect(serializeScenePrefabPropertyPath([])).toBe('');
    });
});

// ---------------------------------------------------------------------------
// createScenePrefabComponentSelector
// ---------------------------------------------------------------------------
describe('createScenePrefabComponentSelector', () => {
    const components: SceneComponentSnapshot[] = [
        { type: 'Transform', data: { position: [0, 0, 0] } },
        { type: 'MeshRenderer', id: 'mesh-1', data: { mesh: 'cube' } },
        { type: 'Script', id: 'script-1', data: { enabled: true } },
        { type: 'Script', id: 'script-2', data: { enabled: false } },
    ];

    it('creates by-id selector when component has id', () => {
        const sel = createScenePrefabComponentSelector(components, 1);
        expect(sel.kind).toBe('id');
        if (sel.kind === 'id') {
            expect(sel.componentId).toBe('mesh-1');
        }
    });

    it('creates by-type selector when component has no id', () => {
        const sel = createScenePrefabComponentSelector(components, 0);
        expect(sel.kind).toBe('type');
        if (sel.kind === 'type') {
            expect(sel.type).toBe('Transform');
        }
    });

    it('counts occurrence for by-type selector', () => {
        // Components without ids: two Transforms, should get occurrence counting
        const noIdComponents: SceneComponentSnapshot[] = [
            { type: 'Transform', data: {} },
            { type: 'Script', data: {} },
            { type: 'Transform', data: {} },
        ];
        // Second Transform at index 2 — occurrence should be 1
        const sel = createScenePrefabComponentSelector(noIdComponents, 2);
        expect(sel.kind).toBe('type');
        if (sel.kind === 'type') {
            expect(sel.type).toBe('Transform');
            expect(sel.occurrence).toBe(1);
        }
    });

    it('first occurrence has no occurrence field', () => {
        const sel = createScenePrefabComponentSelector(components, 2);
        if (sel.kind === 'type') {
            expect(sel.occurrence).toBeUndefined();
        }
    });

    it('throws for out-of-range index', () => {
        expect(() => createScenePrefabComponentSelector(components, 10)).toThrow();
    });
});

// ---------------------------------------------------------------------------
// getScenePrefabComponentSelectorKey
// ---------------------------------------------------------------------------
describe('getScenePrefabComponentSelectorKey', () => {
    it('returns id-based key', () => {
        expect(getScenePrefabComponentSelectorKey({ kind: 'id', componentId: 'abc' }))
            .toBe('id:abc');
    });

    it('returns type-based key with occurrence', () => {
        expect(getScenePrefabComponentSelectorKey({ kind: 'type', type: 'Transform', occurrence: 0 }))
            .toBe('type:Transform#0');
        expect(getScenePrefabComponentSelectorKey({ kind: 'type', type: 'Transform', occurrence: 3 }))
            .toBe('type:Transform#3');
    });

    it('defaults occurrence to 0 when not set', () => {
        expect(getScenePrefabComponentSelectorKey({ kind: 'type', type: 'Script' }))
            .toBe('type:Script#0');
    });
});

// ---------------------------------------------------------------------------
// findScenePrefabComponentIndex
// ---------------------------------------------------------------------------
describe('findScenePrefabComponentIndex', () => {
    const components: SceneComponentSnapshot[] = [
        { type: 'Transform', data: { position: [0, 0, 0] } },
        { type: 'MeshRenderer', id: 'mesh-1', data: { mesh: 'cube' } },
        { type: 'Script', id: 'script-1', data: { enabled: true } },
        { type: 'Script', id: 'script-2', data: { enabled: false } },
    ];

    it('finds by id', () => {
        expect(findScenePrefabComponentIndex(components, { kind: 'id', componentId: 'mesh-1' })).toBe(1);
        expect(findScenePrefabComponentIndex(components, { kind: 'id', componentId: 'script-2' })).toBe(3);
    });

    it('returns -1 for missing id', () => {
        expect(findScenePrefabComponentIndex(components, { kind: 'id', componentId: 'nope' })).toBe(-1);
    });

    it('finds by type with occurrence 0 (first match)', () => {
        expect(findScenePrefabComponentIndex(components, { kind: 'type', type: 'Transform', occurrence: 0 })).toBe(0);
    });

    it('finds by type with occurrence 1 (second match)', () => {
        expect(findScenePrefabComponentIndex(components, { kind: 'type', type: 'Script', occurrence: 0 })).toBe(2);
        expect(findScenePrefabComponentIndex(components, { kind: 'type', type: 'Script', occurrence: 1 })).toBe(3);
    });

    it('returns -1 for out-of-range occurrence', () => {
        expect(findScenePrefabComponentIndex(components, { kind: 'type', type: 'Script', occurrence: 5 })).toBe(-1);
    });

    it('returns -1 for unknown type', () => {
        expect(findScenePrefabComponentIndex(components, { kind: 'type', type: 'Unknown', occurrence: 0 })).toBe(-1);
    });

    it('falls back to type-based search when id not found and type is available', () => {
        // id selector with non-existent id but with a type hint
        const result = findScenePrefabComponentIndex(
            components,
            { kind: 'id', componentId: 'nonexistent', type: 'Transform' },
        );
        // Falls through to type-based search and finds Transform at index 0
        expect(result).toBe(0);
    });
});

// ---------------------------------------------------------------------------
// hasScenePrefabComposition
// ---------------------------------------------------------------------------
describe('hasScenePrefabComposition', () => {
    it('returns true when base is set', () => {
        expect(hasScenePrefabComposition({
            id: 'p',
            entities: [],
            base: { kind: 'registry', prefabId: 'base-prefab' },
        })).toBe(true);
    });

    it('returns true when nested is non-empty', () => {
        expect(hasScenePrefabComposition({
            id: 'p',
            entities: [],
            nested: [{ instanceId: 'i', reference: { kind: 'registry', prefabId: 'p' } }],
        })).toBe(true);
    });

    it('returns true when overrides is non-empty', () => {
        expect(hasScenePrefabComposition({
            id: 'p',
            entities: [],
            overrides: [{
                kind: 'set-component-property',
                nodeId: 'n',
                selector: { kind: 'id', componentId: 'c' },
                path: ['x'],
                value: 1,
            }],
        })).toBe(true);
    });

    it('returns false for empty/undefined composition', () => {
        expect(hasScenePrefabComposition({ id: 'p', entities: [] })).toBe(false);
        expect(hasScenePrefabComposition({ id: 'p', entities: [], nested: [] })).toBe(false);
        expect(hasScenePrefabComposition({ id: 'p', entities: [], overrides: [] })).toBe(false);
    });
});

// ---------------------------------------------------------------------------
// Clone functions
// ---------------------------------------------------------------------------
describe('cloneSceneEntitySnapshot', () => {
    it('deep-clones an entity', () => {
        const entity: SceneEntitySnapshot = {
            nodeId: 'a',
            parentNodeId: null,
            name: 'Entity',
            layer: 1,
            tag: 'hero',
            active: true,
            persistent: false,
            pooled: false,
            components: [{ type: 'Transform', data: { position: [1, 2, 3] } }],
        };
        const cloned = cloneSceneEntitySnapshot(entity);
        expect(cloned).toEqual(entity);
        expect(cloned).not.toBe(entity);
        expect(cloned.components[0]).not.toBe(entity.components[0]);
    });
});

describe('cloneSceneComponentSnapshot', () => {
    it('deep-clones a component', () => {
        const comp: SceneComponentSnapshot = { type: 'Script', id: 's1', data: { items: [1, 2, 3] } };
        const cloned = cloneSceneComponentSnapshot(comp);
        expect(cloned).toEqual(comp);
        expect(cloned).not.toBe(comp);
    });

    it('preserves absence of id', () => {
        const comp: SceneComponentSnapshot = { type: 'Transform', data: { x: 1 } };
        const cloned = cloneSceneComponentSnapshot(comp);
        expect(cloned).not.toHaveProperty('id');
    });
});

describe('cloneScenePrefabDefinition', () => {
    it('deep-clones a definition', () => {
        const def: ScenePrefabDefinition = {
            id: 'p',
            kind: 'prefab',
            entities: [makeEntity('root')],
        };
        const cloned = cloneScenePrefabDefinition(def);
        expect(cloned).toEqual(def);
        expect(cloned).not.toBe(def);
        expect(cloned.entities[0]).not.toBe(def.entities[0]);
    });

    it('handles deeply nested definitions without infinite loops', () => {
        const inner: ScenePrefabDefinition = {
            id: 'inner',
            kind: 'prefab',
            entities: [makeEntity('root')],
        };
        const outer: ScenePrefabDefinition = {
            id: 'outer',
            kind: 'prefab',
            entities: [makeEntity('root')],
            base: { kind: 'inline', prefab: inner },
        };
        const cloned = cloneScenePrefabDefinition(outer);
        expect(cloned.id).toBe('outer');
        expect(cloned.base).toBeDefined();
        if (cloned.base && cloned.base.kind === 'inline') {
            expect(cloned.base.prefab.id).toBe('inner');
            expect(cloned.base.prefab).not.toBe(inner); // deep-cloned
        }
    });
});

describe('cloneScenePrefabOverrideOperation', () => {
    const testClone = (op: ScenePrefabOverrideOperation) => {
        const cloned = cloneScenePrefabOverrideOperation(op);
        expect(cloned).toEqual(op);
        expect(cloned).not.toBe(op);
    };

    it('clones add-entity', () => {
        testClone({
            kind: 'add-entity',
            entity: makeEntity('a'),
        });
    });

    it('clones remove-entity', () => {
        testClone({ kind: 'remove-entity', nodeId: 'a' });
    });

    it('clones reparent-entity', () => {
        testClone({ kind: 'reparent-entity', nodeId: 'a', parentNodeId: 'b' });
    });

    it('clones set-entity-field', () => {
        testClone({ kind: 'set-entity-field', nodeId: 'a', field: 'name', value: 'New' });
    });

    it('clones add-component', () => {
        testClone({
            kind: 'add-component',
            nodeId: 'a',
            component: { type: 'Script', data: { x: 1 } },
        });
    });

    it('clones remove-component', () => {
        testClone({
            kind: 'remove-component',
            nodeId: 'a',
            selector: { kind: 'id', componentId: 'c' },
        });
    });

    it('clones replace-component', () => {
        testClone({
            kind: 'replace-component',
            nodeId: 'a',
            selector: { kind: 'type', type: 'Script', occurrence: 0 },
            component: { type: 'NewScript', data: {} },
        });
    });

    it('clones set-component-property', () => {
        testClone({
            kind: 'set-component-property',
            nodeId: 'a',
            selector: { kind: 'id', componentId: 'c' },
            path: ['x', 'y'],
            value: 42,
        });
    });

    it('clones unset-component-property', () => {
        testClone({
            kind: 'unset-component-property',
            nodeId: 'a',
            selector: { kind: 'id', componentId: 'c' },
            path: ['x'],
        });
    });
});

describe('cloneScenePrefabReference', () => {
    it('clones inline reference', () => {
        const ref: ScenePrefabReference = {
            kind: 'inline',
            prefab: { id: 'p', kind: 'prefab', entities: [] },
        };
        const cloned = cloneScenePrefabReference(ref);
        expect(cloned).toEqual(ref);
        expect(cloned).not.toBe(ref);
        if (cloned.kind === 'inline') {
            expect(cloned.prefab).not.toBe(ref.prefab);
        }
    });

    it('clones registry reference', () => {
        const ref: ScenePrefabReference = { kind: 'registry', prefabId: 'p1' };
        const cloned = cloneScenePrefabReference(ref);
        expect(cloned).toEqual(ref);
        expect(cloned).not.toBe(ref);
    });
});

describe('cloneScenePrefabMetadata', () => {
    it('clones metadata with optional fields', () => {
        const meta = {
            revision: '1',
            locale: 'en',
            updatedAt: '2024-01-01',
            timeZone: 'UTC',
            tags: ['a', 'b'],
        };
        const cloned = cloneScenePrefabMetadata(meta);
        expect(cloned).toEqual(meta);
        expect(cloned).not.toBe(meta);
        expect(cloned!.tags).not.toBe(meta.tags);
    });

    it('returns undefined for undefined', () => {
        expect(cloneScenePrefabMetadata(undefined)).toBeUndefined();
    });
});

describe('cloneScenePrefabNodeSource', () => {
    it('clones node source', () => {
        const source = { instancePath: ['i1'], prefabId: 'p1', nodeId: 'n1', lineage: ['l1'] };
        const cloned = cloneScenePrefabNodeSource(source);
        expect(cloned).toEqual(source);
        expect(cloned).not.toBe(source);
        expect(cloned!.instancePath).not.toBe(source.instancePath);
    });

    it('returns undefined for undefined', () => {
        expect(cloneScenePrefabNodeSource(undefined)).toBeUndefined();
    });
});

// ---------------------------------------------------------------------------
// isScenePrefabPropertyPathAncestor
// ---------------------------------------------------------------------------
describe('isScenePrefabPropertyPathAncestor', () => {
    it('returns true when ancestor is a prefix of path', () => {
        expect(isScenePrefabPropertyPathAncestor(['a', 'b'], ['a', 'b', 'c'])).toBe(true);
    });

    it('returns true when ancestor equals path (equal is ancestor)', () => {
        expect(isScenePrefabPropertyPathAncestor(['a', 'b'], ['a', 'b'])).toBe(true);
    });

    it('returns false when ancestor is longer than path', () => {
        expect(isScenePrefabPropertyPathAncestor(['a', 'b', 'c'], ['a', 'b'])).toBe(false);
    });

    it('returns false when paths diverge', () => {
        expect(isScenePrefabPropertyPathAncestor(['a', 'x'], ['a', 'b', 'c'])).toBe(false);
    });

    it('empty ancestor is ancestor of any path', () => {
        expect(isScenePrefabPropertyPathAncestor([], ['a'])).toBe(true);
        expect(isScenePrefabPropertyPathAncestor([], [])).toBe(true);
    });
});
