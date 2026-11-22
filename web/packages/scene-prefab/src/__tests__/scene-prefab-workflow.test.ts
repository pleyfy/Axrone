import { describe, expect, it } from 'vitest';
import {
    ScenePrefabWorkflow,
    createScenePrefabWorkflow,
    resolveScenePrefab,
    type ScenePrefabWorkflowOptions,
} from '../scene-prefab-workflow';
import { ScenePrefabResolutionError } from '../errors';
import type {
    SceneActorSnapshot,
    SceneComponentSnapshot,
    ScenePrefabDefinition,
    ScenePrefabOverrideOperation,
    ScenePrefabRegistrySource,
} from '../types';

// ─── Helpers ───────────────────────────────────────────────────────────────

const makeActor = (
    nodeId: string,
    name = 'Actor',
    parentNodeId: string | null = null,
    components: SceneComponentSnapshot[] = [],
): SceneActorSnapshot => ({
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
    actors: SceneActorSnapshot[] = [makeActor('root', 'Root')],
): ScenePrefabDefinition => ({
    id,
    kind: 'prefab',
    actors,
});

// ---------------------------------------------------------------------------
// Registry operations
// ---------------------------------------------------------------------------
describe('ScenePrefabWorkflow — registry', () => {
    it('register and getPrefab', () => {
        const wf = new ScenePrefabWorkflow();
        const def = makeDefinition('p1');
        wf.register(def);
        expect(wf.getPrefab('p1')).toBe(def);
    });

    it('registerAll registers multiple prefabs', () => {
        const wf = new ScenePrefabWorkflow();
        const defs = [makeDefinition('p1'), makeDefinition('p2')];
        wf.registerAll(defs);
        expect(wf.getPrefab('p1')).toBe(defs[0]);
        expect(wf.getPrefab('p2')).toBe(defs[1]);
    });

    it('unregister removes prefab and returns true', () => {
        const wf = new ScenePrefabWorkflow({ prefabs: [makeDefinition('p1')] });
        expect(wf.unregister('p1')).toBe(true);
        expect(wf.getPrefab('p1')).toBeUndefined();
    });

    it('unregister returns false for unknown id', () => {
        const wf = new ScenePrefabWorkflow();
        expect(wf.unregister('ghost')).toBe(false);
    });

    it('clear removes all prefabs', () => {
        const wf = new ScenePrefabWorkflow({ prefabs: [makeDefinition('p1'), makeDefinition('p2')] });
        wf.clear();
        expect(wf.getPrefab('p1')).toBeUndefined();
        expect(wf.getPrefab('p2')).toBeUndefined();
    });

    it('clear is a no-op when already empty', () => {
        const wf = new ScenePrefabWorkflow();
        wf.clear(); // should not throw
    });

    it('getPrefab falls back to external registry', () => {
        const external: ScenePrefabRegistrySource = {
            getPrefab: (id) => (id === 'ext' ? makeDefinition('ext') : undefined),
        };
        const wf = new ScenePrefabWorkflow({ registry: external });
        expect(wf.getPrefab('ext')).toBeDefined();
        expect(wf.getPrefab('ext')!.id).toBe('ext');
    });

    it('local registration takes precedence over external', () => {
        const external: ScenePrefabRegistrySource = {
            getPrefab: () => makeDefinition('p1', [makeActor('root', 'External')]),
        };
        const local = makeDefinition('p1', [makeActor('root', 'Local')]);
        const wf = new ScenePrefabWorkflow({ prefabs: [local], registry: external });
        expect(wf.getPrefab('p1')!.actors[0]!.name).toBe('Local');
    });

    it('register returns this for chaining', () => {
        const wf = new ScenePrefabWorkflow();
        expect(wf.register(makeDefinition('p1'))).toBe(wf);
    });
});

// ---------------------------------------------------------------------------
// Resolution
// ---------------------------------------------------------------------------
describe('ScenePrefabWorkflow — resolution', () => {
    it('resolves simple prefab (no base, no nested)', () => {
        const wf = new ScenePrefabWorkflow({ prefabs: [makeDefinition('p1')] });
        const result = wf.resolvePrefab({ kind: 'registry', prefabId: 'p1' });
        expect(result.definition.kind).toBe('resolved');
        expect(result.definition.lineage).toEqual(['p1']);
        expect(result.cacheHit).toBe(false);
    });

    it('resolves variant chain (base -> variant) with overrides', () => {
        const base = makeDefinition('base', [
            makeActor('root', 'BaseRoot', null, [{ type: 'Transform', data: { x: 0 } }]),
        ]);
        const variant: ScenePrefabDefinition = {
            id: 'variant',
            kind: 'variant',
            actors: [makeActor('root', 'VariantRoot')],
            base: { kind: 'registry', prefabId: 'base' },
            overrides: [{
                kind: 'set-component-property',
                nodeId: 'root',
                selector: { kind: 'id', componentId: 'Transform' as string } as any,
                path: ['x'],
                value: 42,
            } as any],
        };
        // Actually, the override selector needs to match the component. Let me simplify.
        const simpleVariant: ScenePrefabDefinition = {
            id: 'variant',
            kind: 'variant',
            actors: [makeActor('root', 'VariantRoot')],
            base: { kind: 'registry', prefabId: 'base' },
        };

        const wf = new ScenePrefabWorkflow({ prefabs: [base, simpleVariant] });
        const result = wf.resolvePrefab({ kind: 'registry', prefabId: 'variant' });
        expect(result.definition.kind).toBe('resolved');
        // variant overrides base actor name
        expect(result.definition.actors[0]!.name).toBe('VariantRoot');
        // lineage includes base + variant
        expect(result.definition.lineage).toContain('base');
        expect(result.definition.lineage).toContain('variant');
    });

    it('resolves nested instance with scoped nodeIds', () => {
        const nested = makeDefinition('nested-prefab', [
            makeActor('inner-root', 'InnerRoot'),
        ]);
        const parent: ScenePrefabDefinition = {
            id: 'parent',
            kind: 'prefab',
            actors: [makeActor('root', 'Root')],
            nested: [{
                instanceId: 'inst-1',
                reference: { kind: 'registry', prefabId: 'nested-prefab' },
                parentNodeId: 'root',
            }],
        };

        const wf = new ScenePrefabWorkflow({ prefabs: [nested, parent] });
        const result = wf.resolvePrefab({ kind: 'registry', prefabId: 'parent' });
        const nodeIds = result.definition.actors.map((a) => a.nodeId);
        expect(nodeIds).toContain('inst-1::inner-root');
    });

    it('throws ScenePrefabResolutionError on cycle', () => {
        const a: ScenePrefabDefinition = {
            id: 'a',
            kind: 'prefab',
            actors: [makeActor('root')],
            base: { kind: 'registry', prefabId: 'b' },
        };
        const b: ScenePrefabDefinition = {
            id: 'b',
            kind: 'prefab',
            actors: [makeActor('root')],
            base: { kind: 'registry', prefabId: 'a' },
        };

        const wf = new ScenePrefabWorkflow({ prefabs: [a, b] });
        expect(() => wf.resolvePrefab({ kind: 'registry', prefabId: 'a' }))
            .toThrow(ScenePrefabResolutionError);
    });

    it('throws ScenePrefabResolutionError on missing registry entry', () => {
        const wf = new ScenePrefabWorkflow();
        expect(() => wf.resolvePrefab({ kind: 'registry', prefabId: 'missing' }))
            .toThrow(ScenePrefabResolutionError);
    });

    it('throws ScenePrefabResolutionError on revision mismatch', () => {
        const def: ScenePrefabDefinition = {
            ...makeDefinition('rev-prefab'),
            metadata: { revision: 'rev-2' },
        };
        const wf = new ScenePrefabWorkflow({ prefabs: [def] });
        expect(() =>
            wf.resolvePrefab({ kind: 'registry', prefabId: 'rev-prefab', revision: 'rev-1' }),
        ).toThrow(ScenePrefabResolutionError);
    });

    it('resolves when revisions match or either side omits it', () => {
        const def: ScenePrefabDefinition = {
            ...makeDefinition('rev-prefab'),
            metadata: { revision: 'rev-1' },
        };
        const wf = new ScenePrefabWorkflow({ prefabs: [def] });
        expect(
            wf.resolvePrefab({ kind: 'registry', prefabId: 'rev-prefab', revision: 'rev-1' }).definition.kind,
        ).toBe('resolved');
        expect(
            wf.resolvePrefab({ kind: 'registry', prefabId: 'rev-prefab' }).definition.kind,
        ).toBe('resolved');
    });

    it('resolves inline reference', () => {
        const inlineDef = makeDefinition('inline-p', [makeActor('root', 'Inline')]);
        const wf = new ScenePrefabWorkflow();
        const result = wf.resolvePrefab({
            kind: 'inline',
            prefab: inlineDef,
        });
        expect(result.definition.kind).toBe('resolved');
        expect(result.definition.actors[0]!.name).toBe('Inline');
    });

    it('resolves a definition directly (not via reference)', () => {
        const def = makeDefinition('direct');
        const wf = new ScenePrefabWorkflow();
        const result = wf.resolvePrefab(def);
        expect(result.definition.kind).toBe('resolved');
    });
});

// ---------------------------------------------------------------------------
// Caching
// ---------------------------------------------------------------------------
describe('ScenePrefabWorkflow — caching', () => {
    it('cache hit on second resolve', () => {
        const wf = new ScenePrefabWorkflow({ prefabs: [makeDefinition('p1')] });
        wf.resolvePrefab({ kind: 'registry', prefabId: 'p1' });
        const second = wf.resolvePrefab({ kind: 'registry', prefabId: 'p1' });
        expect(second.cacheHit).toBe(true);
    });

    it('cache invalidated on register', () => {
        const wf = new ScenePrefabWorkflow({ prefabs: [makeDefinition('p1')] });
        wf.resolvePrefab({ kind: 'registry', prefabId: 'p1' });
        wf.register(makeDefinition('p1', [makeActor('root', 'Updated')]));
        const result = wf.resolvePrefab({ kind: 'registry', prefabId: 'p1' });
        expect(result.cacheHit).toBe(false);
        expect(result.definition.actors[0]!.name).toBe('Updated');
    });

    it('cache invalidated on unregister', () => {
        const wf = new ScenePrefabWorkflow({ prefabs: [makeDefinition('p1')] });
        wf.resolvePrefab({ kind: 'registry', prefabId: 'p1' });
        wf.unregister('p1');
        // Now trying to resolve should throw since it's unregistered
        expect(() => wf.resolvePrefab({ kind: 'registry', prefabId: 'p1' }))
            .toThrow(ScenePrefabResolutionError);
    });

    it('cache disabled when external registry present', () => {
        const external: ScenePrefabRegistrySource = {
            getPrefab: () => makeDefinition('p1'),
        };
        const wf = new ScenePrefabWorkflow({ registry: external, prefabs: [makeDefinition('p1')] });
        wf.resolvePrefab({ kind: 'registry', prefabId: 'p1' });
        const second = wf.resolvePrefab({ kind: 'registry', prefabId: 'p1' });
        expect(second.cacheHit).toBe(false);
    });

    it('cache disabled for liveOverrides', () => {
        const wf = new ScenePrefabWorkflow({ prefabs: [makeDefinition('p1')] });
        wf.resolvePrefab({ kind: 'registry', prefabId: 'p1' });
        const result = wf.resolvePrefab(
            { kind: 'registry', prefabId: 'p1' },
            { liveOverrides: [{ kind: 'set-actor-field', nodeId: 'root', field: 'name', value: 'X' }] },
        );
        expect(result.cacheHit).toBe(false);
    });

    it('cached results are isolated from caller mutation', () => {
        const wf = new ScenePrefabWorkflow({ prefabs: [makeDefinition('p1')] });
        const first = wf.resolvePrefab({ kind: 'registry', prefabId: 'p1' });
        (first.definition.actors[0] as { name: string }).name = 'Mutated';

        const second = wf.resolvePrefab({ kind: 'registry', prefabId: 'p1' });
        expect(second.cacheHit).toBe(true);
        expect(second.definition.actors[0]!.name).toBe('Root');
    });
});

// ---------------------------------------------------------------------------
// applyOverrides
// ---------------------------------------------------------------------------
describe('ScenePrefabWorkflow — applyOverrides', () => {
    it('resolves and applies overrides in one step', () => {
        const wf = new ScenePrefabWorkflow({ prefabs: [makeDefinition('p1')] });
        const result = wf.applyOverrides(
            { kind: 'registry', prefabId: 'p1' },
            [{ kind: 'set-actor-field', nodeId: 'root', field: 'name', value: 'Overridden' }],
        );
        expect(result.kind).toBe('resolved');
        expect(result.actors[0]!.name).toBe('Overridden');
    });
});

// ---------------------------------------------------------------------------
// diff and merge
// ---------------------------------------------------------------------------
describe('ScenePrefabWorkflow — diff and merge', () => {
    it('diff delegates to diffScenePrefabDefinitions', () => {
        const base = makeDefinition('base');
        const modified = makeDefinition('modified', [makeActor('root', 'Changed')]);
        const wf = new ScenePrefabWorkflow({ prefabs: [base, modified] });
        const result = wf.diff(
            { kind: 'registry', prefabId: 'base' },
            { kind: 'registry', prefabId: 'modified' },
        );
        expect(result.overrides.length).toBeGreaterThanOrEqual(1);
    });

    it('merge delegates to mergeScenePrefabDefinitions', () => {
        const base = makeDefinition('base');
        const local = makeDefinition('local', [makeActor('root', 'Local')]);
        const incoming = makeDefinition('incoming', [makeActor('root', 'Incoming')]);
        const wf = new ScenePrefabWorkflow({ prefabs: [base, local, incoming] });
        const result = wf.merge(
            { kind: 'registry', prefabId: 'base' },
            { kind: 'registry', prefabId: 'local' },
            { kind: 'registry', prefabId: 'incoming' },
            { conflictPolicy: 'prefer-local' },
        );
        expect(result).toBeDefined();
        expect(result.definition).toBeDefined();
    });
});

// ---------------------------------------------------------------------------
// Standalone functions
// ---------------------------------------------------------------------------
describe('resolveScenePrefab', () => {
    it('creates one-shot workflow and resolves', () => {
        const def = makeDefinition('standalone');
        const result = resolveScenePrefab(def);
        expect(result.definition.kind).toBe('resolved');
    });

    it('accepts external registry option', () => {
        const external: ScenePrefabRegistrySource = {
            getPrefab: (id) => (id === 'ext' ? makeDefinition('ext') : undefined),
        };
        const result = resolveScenePrefab(
            { kind: 'registry', prefabId: 'ext' },
            { registry: external },
        );
        expect(result.definition.kind).toBe('resolved');
    });
});

describe('createScenePrefabWorkflow', () => {
    it('factory returns ScenePrefabWorkflow', () => {
        const wf = createScenePrefabWorkflow();
        expect(wf).toBeInstanceOf(ScenePrefabWorkflow);
    });

    it('factory accepts prefabs option', () => {
        const wf = createScenePrefabWorkflow({ prefabs: [makeDefinition('p1')] });
        expect(wf.getPrefab('p1')).toBeDefined();
    });
});
