import { describe, expect, it } from 'vitest';
import { TilemapCollider2D, TilemapRenderer } from '@axrone/scene-runtime/scene-tilemap';
import { createTilemapEntity } from '../scene-2d-tilemap';

describe('createTilemapEntity', () => {
    it('adds renderer and optional collider components', () => {
        const added: unknown[][] = [];
        const scene = {
            isComponentRegistered: () => true,
            createEntity: () => ({
                addComponent: (type: unknown, config: unknown) => {
                    added.push([type, config]);
                },
            }),
        };
        createTilemapEntity(scene as never, {
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
            createEntity: () => ({ addComponent: () => undefined }),
        };
        expect(() => createTilemapEntity(scene as never)).toThrow();
    });
});
