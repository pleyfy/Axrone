import { describe, expect, it, vi } from 'vitest';
import type { UIFrame, WidgetId } from '@axrone/ui/types';
import { WebGL2UIRenderer, createSceneUIResourceResolver } from '../../index';
import { createMetrics, createFrame, createMockWebGL2Context } from './support/ui-webgl2-harness';

describe('renderer image resources', () => {
    it('renders texture images and delegates material-backed image commands', () => {
        const gl = createMockWebGL2Context();
        const texture = { id: 'texture:image' } as unknown as WebGLTexture;
        const sampler = { id: 'sampler:image' } as unknown as WebGLSampler;
        const materialRender = vi.fn();
        const renderer = new WebGL2UIRenderer({
            gl,
            resolveImageResource(source) {
                if (source.kind === 'material') {
                    return {
                        kind: 'material',
                        render: materialRender,
                    };
                }
                return {
                    kind: 'texture',
                    texture,
                    sampler,
                };
            },
        });
        const frame: UIFrame<never> = {
            viewportWidth: 128,
            viewportHeight: 96,
            metrics: {
                ...createMetrics(),
                renderCount: 2,
                imageCommandCount: 2,
                textCommandCount: 0,
                customCommandCount: 0,
                glyphCount: 0,
            },
            commands: [
                {
                    kind: 'image',
                    widget: 1 as WidgetId,
                    source: {
                        kind: 'texture',
                        resourceId: 'ui:texture',
                        width: 32,
                        height: 32,
                    },
                    x: 8,
                    y: 10,
                    width: 32,
                    height: 32,
                    zIndex: 0,
                    tint: { r: 1, g: 1, b: 1, a: 1 },
                    opacity: 1,
                    sampling: 'linear',
                    radius: { topLeft: 4, topRight: 4, bottomRight: 4, bottomLeft: 4 },
                    clip: null,
                    uvRect: { x: 0, y: 0, width: 1, height: 1 },
                },
                {
                    kind: 'image',
                    widget: 2 as WidgetId,
                    source: {
                        kind: 'material',
                        materialId: 'ui:material',
                        width: 48,
                        height: 24,
                    },
                    x: 40,
                    y: 18,
                    width: 48,
                    height: 24,
                    zIndex: 1,
                    tint: { r: 1, g: 1, b: 1, a: 1 },
                    opacity: 0.85,
                    sampling: 'nearest',
                    radius: { topLeft: 0, topRight: 0, bottomRight: 0, bottomLeft: 0 },
                    clip: { x: 0, y: 0, width: 96, height: 80 },
                    uvRect: { x: 0, y: 0, width: 1, height: 1 },
                },
            ],
        };

        renderer.render(frame);

        expect(gl.drawArraysInstanced).toHaveBeenCalledTimes(1);
    expect(gl.bindSampler).toHaveBeenCalledWith(0, sampler);
        expect(materialRender).toHaveBeenCalledTimes(1);
        expect(renderer.getStats()).toEqual({
            drawCalls: 1,
            quadCount: 0,
            imageCount: 2,
            materialImageCount: 1,
            glyphCount: 0,
            customCommandCount: 0,
            uploadedGlyphCount: 0,
            atlasPageCount: 0,
        });
    });

    it('resolves scene texture and material image sources into native WebGL handles', () => {
        const nativeTexture = { id: 'native:texture' } as unknown as WebGLTexture;
        const nativeSampler = { id: 'native:sampler' } as unknown as WebGLSampler;
        const scene = {
            getTextureResource: vi.fn((id: string) =>
                id === 'scene:icon'
                    ? {
                          id,
                          width: 64,
                          height: 64,
                          samplerId: 'ui',
                          nativeTexture,
                          nativeSampler,
                      }
                    : null
            ),
            getMaterialTextureBinding: vi.fn((materialId: string, uniformName?: string) =>
                materialId === 'scene:card' && uniformName === 'u_BaseColor'
                    ? {
                          materialId,
                          uniformName,
                          textureId: 'scene:albedo',
                          samplerId: 'ui',
                          unit: 0,
                          width: 128,
                          height: 128,
                          nativeTexture,
                          nativeSampler,
                      }
                    : null
            ),
        };
        const resolver = createSceneUIResourceResolver(scene, {
            materialTextureBinding: 'u_BaseColor',
        });
        const context = {
            gl: createMockWebGL2Context(),
            frame: createFrame(),
            command: {
                kind: 'image',
                widget: 1 as WidgetId,
                source: {
                    kind: 'texture',
                    resourceId: 'scene:icon',
                    width: 64,
                    height: 64,
                },
                x: 0,
                y: 0,
                width: 64,
                height: 64,
                zIndex: 0,
                tint: { r: 1, g: 1, b: 1, a: 1 },
                opacity: 1,
                sampling: 'linear' as const,
                radius: { topLeft: 0, topRight: 0, bottomRight: 0, bottomLeft: 0 },
                clip: null,
                uvRect: { x: 0, y: 0, width: 1, height: 1 },
            },
        };

        const textureResource = resolver(
            {
                kind: 'texture',
                resourceId: 'scene:icon',
                width: 64,
                height: 64,
            },
            context
        );
        const materialResource = resolver(
            {
                kind: 'material',
                materialId: 'scene:card',
                textureBinding: 'u_BaseColor',
                width: 128,
                height: 128,
            },
            {
                ...context,
                command: {
                    ...context.command,
                    source: {
                        kind: 'material',
                        materialId: 'scene:card',
                        textureBinding: 'u_BaseColor',
                        width: 128,
                        height: 128,
                    },
                },
            }
        );

        expect(textureResource).toEqual({ kind: 'texture', texture: nativeTexture, sampler: nativeSampler });
        expect(materialResource).toEqual({ kind: 'texture', texture: nativeTexture, sampler: nativeSampler });
        expect(scene.getTextureResource).toHaveBeenCalledWith('scene:icon');
        expect(scene.getMaterialTextureBinding).toHaveBeenCalledWith('scene:card', 'u_BaseColor');
    });

});
