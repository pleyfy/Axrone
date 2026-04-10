import { describe, expect, it } from 'vitest';
import {
    cloneSceneTextureDefinition,
    SceneTextureRegistry,
    type SceneTextureResource,
} from '@axrone/scene-3d';

const createTextureResource = (id: string): SceneTextureResource => ({
    id,
    texture: {
        nativeHandle: { id } as WebGLTexture,
        isDisposed: false,
        bind: () => {},
        dispose: () => {},
    } as any,
    width: 4,
    height: 8,
    samplerId: 'linear',
});

describe('SceneTextureRegistry', () => {
    it('stores texture resources and returns handles', () => {
        const registry = new SceneTextureRegistry();
        const result = registry.register(
            {
                id: 'checker',
                source: {
                    kind: 'checker',
                    size: 4,
                },
            },
            createTextureResource('checker')
        );

        expect(result.previous).toBeNull();
        expect(result.handle).toEqual({
            id: 'checker',
            width: 4,
            height: 8,
            samplerId: 'linear',
        });
    });

    it('returns replaced resources and clones deep texture definitions', () => {
        const registry = new SceneTextureRegistry();
        const first = createTextureResource('checker');
        const second = createTextureResource('checker');
        const definition = {
            id: 'checker',
            source: {
                kind: 'compressed' as const,
                bytes: new Uint8Array([1, 2, 3]),
                levels: [{ level: 0, width: 4, height: 4, byteOffset: 0, byteLength: 3 }],
            },
            samplerId: 'linear',
        };

        registry.register(definition, first);
        (definition.source.bytes as Uint8Array)[0] = 9;
        definition.source.levels[0]!.width = 16;

        const result = registry.register(
            {
                id: 'checker',
                source: {
                    kind: 'color',
                    color: [1, 0, 0, 1],
                },
            },
            second
        );

        const cloned = cloneSceneTextureDefinition(definition);

        expect(result.previous).toBe(first);
        expect(registry.getDefinitions()[0]?.source.kind).toBe('color');
        expect(cloned.source.kind).toBe('compressed');
        if (cloned.source.kind === 'compressed') {
            expect([...cloned.source.bytes]).toEqual([9, 2, 3]);
            expect(cloned.source.levels[0]?.width).toBe(16);
        }
    });
});
