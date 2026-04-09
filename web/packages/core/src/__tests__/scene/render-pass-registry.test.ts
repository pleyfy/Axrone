import { Vec4 } from '@axrone/numeric';
import { describe, expect, it } from 'vitest';
import {
    cloneSceneRenderPassDefinition,
    SceneRenderPassRegistry,
} from '../../scene/render-pass-registry';

const toVec4Tuple = (
    value: Vec4 | readonly [number, number, number, number] | null | undefined
): readonly [number, number, number, number] | null | undefined =>
    value instanceof Vec4 ? [value.x, value.y, value.z, value.w] : value;

describe('SceneRenderPassRegistry', () => {
    it('applies default clear state to the first and default render pass', () => {
        const registry = new SceneRenderPassRegistry({
            defaultPassId: 'main',
            defaultClearColor: new Vec4(0.1, 0.2, 0.3, 1),
        });

        const main = registry.register({
            id: 'main',
        });
        const overlay = registry.register({
            id: 'overlay',
        });

        const mainResource = registry.get('main');
        const overlayResource = registry.get('overlay');

        expect(main).toEqual({
            id: 'main',
            order: 0,
            rendererPassId: 'main',
            enabled: true,
        });
        expect(overlay).toEqual({
            id: 'overlay',
            order: 1,
            rendererPassId: 'overlay',
            enabled: true,
        });
        expect(mainResource?.clearFlags).toEqual(['color', 'depth']);
        expect(toVec4Tuple(mainResource?.clearColor)).toEqual([0.1, 0.2, 0.3, 1]);
        expect(overlayResource?.clearFlags).toEqual([]);
        expect(overlayResource?.clearColor).toBeNull();
    });

    it('stores cloned definitions and returns sorted handles', () => {
        const registry = new SceneRenderPassRegistry({
            defaultPassId: 'main',
            defaultClearColor: new Vec4(0, 0, 0, 1),
        });

        const laterDefinition = {
            id: 'later',
            order: 10,
            clearFlags: [] as ('color' | 'depth')[],
        };
        registry.register(laterDefinition);
        registry.register({
            id: 'earlier',
            order: 1,
            rendererPassId: 'custom',
            enabled: false,
        });

        const handles = registry.getHandles();
        const definitions = registry.getDefinitions();
        laterDefinition.clearFlags.push('depth');

        expect(handles.map((handle) => handle.id)).toEqual(['earlier', 'later']);
        expect(handles[0]?.rendererPassId).toBe('custom');
        expect(handles[0]?.enabled).toBe(false);
        expect(definitions.map((definition) => definition.id)).toEqual(['earlier', 'later']);
        expect(definitions[1]?.clearFlags).toEqual([]);

        registry.clear();
        expect(registry.getHandles()).toEqual([]);
        expect(registry.getDefinitions()).toEqual([]);
    });

    it('reuses ordered and enabled caches until the registry changes', () => {
        const registry = new SceneRenderPassRegistry({
            defaultPassId: 'main',
            defaultClearColor: new Vec4(0, 0, 0, 1),
        });

        registry.register({
            id: 'main',
        });
        registry.register({
            id: 'overlay',
            enabled: false,
            order: 2,
        });

        const firstOrdered = registry.getOrderedResources();
        const firstEnabled = registry.getEnabledResources();
        const firstHandles = registry.getHandles();
        const firstDefinitions = registry.getDefinitions();

        expect(registry.getOrderedResources()).toBe(firstOrdered);
        expect(registry.getEnabledResources()).toBe(firstEnabled);
        expect(registry.getHandles()).toBe(firstHandles);
        expect(registry.getDefinitions()).toBe(firstDefinitions);

        registry.register({
            id: 'before-overlay',
            order: 1,
        });

        expect(registry.getOrderedResources()).not.toBe(firstOrdered);
        expect(registry.getEnabledResources()).not.toBe(firstEnabled);
        expect(registry.getHandles()).not.toBe(firstHandles);
        expect(registry.getDefinitions()).not.toBe(firstDefinitions);
    });

    it('clones render pass definitions without leaking mutable clear colors', () => {
        const definition = {
            id: 'main',
            clearColor: new Vec4(0.2, 0.3, 0.4, 1),
            clearFlags: ['color', 'depth'] as const,
        };

        const cloned = cloneSceneRenderPassDefinition(definition);

        definition.clearColor.x = 1;

        expect(cloned).not.toBe(definition);
        expect(cloned.clearColor).not.toBe(definition.clearColor);
        expect(cloned.clearColor instanceof Vec4).toBe(true);
        expect(toVec4Tuple(cloned.clearColor)).toEqual([0.2, 0.3, 0.4, 1]);
        expect(cloned.clearFlags).toEqual(['color', 'depth']);
    });
});
