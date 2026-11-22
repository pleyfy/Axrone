import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { TilemapAgent } from '../components/tilemap-agent';
import { TilemapCollider2D } from '../components/tilemap-collider-2d';
import { TilemapRenderer } from '../components/tilemap-renderer';
import { create2DSceneRegistry } from '../scene-2d-registry';
import {
    createTilemapSceneRegistry,
    SCENE_TILEMAP_BUILT_IN_MANIFEST,
    TILEMAP_SCENE_BUILT_IN_MANIFESTS,
} from '../scene-tilemap-registry';

const roundTrip = <T extends { serialize(): Record<string, unknown>; deserialize(data: Record<string, unknown>): void }>(
    component: T,
    factory: () => T
): T => {
    const copy = factory();
    copy.deserialize(component.serialize());
    return copy;
};

describe('tilemap components', () => {
    it('round-trips the renderer config and bumps revision on changes', () => {
        const renderer = new TilemapRenderer({
            mapId: 'level',
            tilesetId: 'atlas',
            visibleLayers: ['ground'],
            sortingLayer: 3,
            renderOrder: 4,
            chunkWindow: 5,
            tint: { r: 1, g: 0.5, b: 0.25, a: 0.75 },
        });
        expect(renderer.mapId).toBe('level');
        expect(renderer.tint.r).toBeCloseTo(1);
        const revision = renderer.revision;
        renderer.sortingLayer = 9;
        expect(renderer.revision).toBeGreaterThan(revision);

        const copy = roundTrip(renderer, () => new TilemapRenderer());
        expect(copy.serialize()).toEqual(renderer.serialize());
        expect(copy.visibleLayers).toEqual(['ground']);
        const copyRevision = copy.revision;
        copy.deserialize({ mapId: 'next' });
        expect(copy.mapId).toBe('next');
        expect(copy.revision).toBeGreaterThan(copyRevision);
    });

    it('round-trips collider settings', () => {
        const collider = new TilemapCollider2D({
            mapId: 'level',
            collisionLayer: 'walls',
            oneWay: true,
        });
        const copy = roundTrip(collider, () => new TilemapCollider2D());
        expect(copy.serialize()).toEqual(collider.serialize());
        expect(copy.enabled).toBe(true);
        copy.enabled = false;
        expect(copy.serialize().enabled).toBe(false);
    });

    it('round-trips agent paths and waypoint progress', () => {
        const agent = new TilemapAgent({ mapId: 'level', speed: 2 });
        agent.requestPath('request-1');
        agent.setPath([0, 0, 16, 0, 16, 16]);
        agent.advanceWaypoint();
        const copy = roundTrip(agent, () => new TilemapAgent());
        expect(copy.waypointCount).toBe(3);
        expect(copy.waypointIndex).toBe(1);
        expect(copy.moving).toBe(true);
        expect(copy.pathRequestId).toBe('request-1');
        expect(copy.waypointAt(2)).toEqual({ x: 16, y: 16 });
        expect(copy.completePath('other')).toBe(false);
        expect(copy.completePath('request-1')).toBe(true);
        expect(copy.pathRequestId).toBeNull();
    });
});

describe('tilemap registry', () => {
    it('adds only tilemap components to the opt-in registry', () => {
        const defaultRegistry = create2DSceneRegistry();
        expect('TilemapRenderer' in defaultRegistry).toBe(false);

        const registry = createTilemapSceneRegistry();
        expect(registry.TilemapRenderer).toBe(TilemapRenderer);
        expect(registry.TilemapCollider2D).toBe(TilemapCollider2D);
        expect(registry.TilemapAgent).toBe(TilemapAgent);
        expect(SCENE_TILEMAP_BUILT_IN_MANIFEST.id).toBe('scene/tilemap');
        expect(SCENE_TILEMAP_BUILT_IN_MANIFEST.builtIns).toEqual([
            'TilemapRenderer',
            'TilemapCollider2D',
            'TilemapAgent',
        ]);
        expect(TILEMAP_SCENE_BUILT_IN_MANIFESTS).toContain(
            SCENE_TILEMAP_BUILT_IN_MANIFEST
        );
    });

    it('keeps the lean entry free of tilemap imports', () => {
        const lean = readFileSync(
            path.resolve(process.cwd(), 'packages/scene-2d/src/lean.ts'),
            'utf8'
        );
        expect(lean.toLowerCase()).not.toContain('tilemap');
    });
});
