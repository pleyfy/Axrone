import { describe, expect, it } from 'vitest';
import { TilemapCollider2D, TilemapRenderer } from '@axrone/scene-runtime/scene-tilemap';
import { createTilemapActor } from '../scene-2d-tilemap';

describe('createTilemapActor', () => {
    it('adds renderer and optional collider components', () => {
        const added: unknown[][] = [];
        const scene = {
            isComponentRegistered: () => true,
            createActor: () => ({
                addComponent: (type: unknown, config: unknown) => {
                    added.push([type, config]);
                },
            }),
        };
        createTilemapActor(scene as never, {
            renderer: { mapId: 'level', tilesetId: 'atlas' },
            collider: { mapId: 'level', collisionLayer: 'walls' },
        });
        expect(added).toHaveLength(2);
        expect(added[0]![0]).toBe(TilemapRenderer);
        expect(added[1]![0]).toBe(TilemapCollider2D);
    });

    it('rejects scenes without the opt-in registry', () => {
        const scene = {
            isComponentRegistered: () => false,
            createActor: () => ({ addComponent: () => undefined }),
        };
        expect(() => createTilemapActor(scene as never)).toThrow();
    });
});
