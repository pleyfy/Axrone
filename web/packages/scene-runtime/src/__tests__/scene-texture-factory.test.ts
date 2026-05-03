import { describe, expect, it, vi } from 'vitest';
import { ColorSpace, TextureFormat } from '@axrone/render-webgl2';
import { SceneTextureFactory } from '../scene-texture-factory';

describe('scene texture factory', () => {
	it('forwards the declared texture color space to the texture manager', async () => {
		const createTexture = vi.fn().mockReturnValue({
			width: 1,
			height: 1,
			mipLevels: 1,
			isCompressed: false,
			generateMipmaps: vi.fn(),
			setData: vi.fn(),
			nativeHandle: {},
		});
		const factory = new SceneTextureFactory({
			textureManager: {
				createTexture,
			} as any,
		});

		await factory.create({
			id: 'texture/albedo',
			format: TextureFormat.RGBA8,
			colorSpace: ColorSpace.SRGB,
			source: {
				kind: 'data',
				width: 1,
				height: 1,
				channels: 4,
				data: [255, 255, 255, 255],
			},
		});

		expect(createTexture).toHaveBeenCalledWith(
			expect.objectContaining({
				colorSpace: ColorSpace.SRGB,
			}),
			expect.any(Uint8Array),
		);
	});
});