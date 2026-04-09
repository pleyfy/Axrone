import { describe, expect, it, vi } from 'vitest';
import type { ITextureSampler } from '../../renderer/webgl2/texture/interfaces';
import type { SceneMaterialResource } from '../../scene/material-registry';
import { SceneMaterialTextureBinder } from '../../scene/material-texture-binder';
import type { SceneShaderResource } from '../../scene/shader-registry';
import type { SceneTextureResource } from '../../scene/texture-registry';

describe('SceneMaterialTextureBinder', () => {
    it('reuses its bound unit buffer while binding and unbinding texture slots', () => {
        const gl = {
            bindSampler: vi.fn(),
            activeTexture: vi.fn(),
            bindTexture: vi.fn(),
            TEXTURE0: 32,
            TEXTURE_2D: 3553,
        } as unknown as WebGL2RenderingContext;

        const binder = new SceneMaterialTextureBinder(gl);
        const shader = {} as SceneShaderResource;
        const material = {
            id: 'mat',
            shaderId: 'shader',
            uniforms: new Map(),
            textureBindings: new Map(),
        } satisfies SceneMaterialResource;

        const fallbackSampler = {
            bind: vi.fn(),
        } as unknown as ITextureSampler;
        const customSampler = {
            bind: vi.fn(),
        } as unknown as ITextureSampler;

        const textures = new Map<string, SceneTextureResource>([
            [
                'base',
                {
                    id: 'base',
                    width: 4,
                    height: 4,
                    samplerId: null,
                    texture: {
                        bind: vi.fn(),
                    } as any,
                },
            ],
            [
                'normal',
                {
                    id: 'normal',
                    width: 4,
                    height: 4,
                    samplerId: 'normalSampler',
                    texture: {
                        bind: vi.fn(),
                    } as any,
                },
            ],
        ]);

        const resources = {
            materials: {
                getTextureSlots: () =>
                    [
                        {
                            uniformName: 'u_BaseColor',
                            binding: {
                                textureId: 'base',
                                samplerId: null,
                            },
                            resolvedUnit: 0,
                        },
                        {
                            uniformName: 'u_NormalMap',
                            binding: {
                                textureId: 'normal',
                                samplerId: 'normalSampler',
                            },
                            resolvedUnit: 3,
                        },
                    ] as const,
            },
            textures: {
                get: (textureId: string) => textures.get(textureId),
            },
            resolveSampler: (id: string | null) => (id === 'normalSampler' ? customSampler : fallbackSampler),
        };
        const setUniform = vi.fn();

        const first = binder.bind(shader, material, resources, setUniform);

        expect(first).toEqual([0, 3]);
        expect((textures.get('base')?.texture.bind as any)).toHaveBeenCalledWith(0);
        expect((textures.get('normal')?.texture.bind as any)).toHaveBeenCalledWith(3);
        expect(fallbackSampler.bind).toHaveBeenCalledWith(0);
        expect(customSampler.bind).toHaveBeenCalledWith(3);
        expect(setUniform).toHaveBeenNthCalledWith(1, shader, 'u_BaseColor', 0);
        expect(setUniform).toHaveBeenNthCalledWith(2, shader, 'u_NormalMap', 3);

        binder.unbind();

        expect(gl.bindSampler).toHaveBeenNthCalledWith(1, 0, null);
        expect(gl.bindSampler).toHaveBeenNthCalledWith(2, 3, null);
        expect(gl.activeTexture).toHaveBeenNthCalledWith(1, 32);
        expect(gl.activeTexture).toHaveBeenNthCalledWith(2, 35);
        expect(gl.bindTexture).toHaveBeenNthCalledWith(1, 3553, null);
        expect(gl.bindTexture).toHaveBeenNthCalledWith(2, 3553, null);

        const second = binder.bind(shader, material, resources, setUniform);

        expect(second).toBe(first);
    });
});
