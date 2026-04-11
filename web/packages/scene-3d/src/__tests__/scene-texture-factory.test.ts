import { describe, expect, it, vi } from 'vitest';
import { SceneMaterialError } from '@axrone/scene-3d';
import { SceneTextureFactory } from '@axrone/scene-3d';

describe('SceneTextureFactory', () => {
    it('creates regular textures and generates mipmaps when appropriate', async () => {
        const texture = {
            width: 4,
            height: 4,
            mipLevels: 3,
            isCompressed: false,
            generateMipmaps: vi.fn(),
            setData: vi.fn(),
        };
        const textureManager = {
            createTexture: vi.fn(() => texture),
        };
        const factory = new SceneTextureFactory({
            textureManager: textureManager as any,
        });

        const resource = await factory.create({
            id: 'checker',
            source: {
                kind: 'checker',
                size: 4,
            },
        });

        expect(textureManager.createTexture).toHaveBeenCalledTimes(1);
        expect(texture.generateMipmaps).toHaveBeenCalledTimes(1);
        expect(resource).toEqual({
            id: 'checker',
            texture,
            width: 4,
            height: 4,
            samplerId: null,
        });
    });

    it('rejects compressed textures whose mip payload exceeds the source buffer', async () => {
        const texture = {
            width: 8,
            height: 8,
            mipLevels: 1,
            isCompressed: true,
            generateMipmaps: vi.fn(),
            setData: vi.fn(),
        };
        const factory = new SceneTextureFactory({
            textureManager: {
                createTexture: vi.fn(() => texture),
            } as any,
        });

        await expect(
            factory.create({
                id: 'broken-compressed',
                format: 123 as any,
                source: {
                    kind: 'compressed',
                    bytes: new Uint8Array(8),
                    levels: [
                        {
                            level: 0,
                            width: 8,
                            height: 8,
                            byteOffset: 4,
                            byteLength: 16,
                        },
                    ],
                },
            })
        ).rejects.toThrowError(SceneMaterialError);
        expect(texture.setData).not.toHaveBeenCalled();
    });
});
