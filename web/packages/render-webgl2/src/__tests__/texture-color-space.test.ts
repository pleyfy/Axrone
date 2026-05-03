import { beforeAll, describe, expect, it } from 'vitest';
import { ColorSpace, TextureFormat } from '../texture/interfaces';

const webglConstantStub = new Proxy(
	{
		RGBA8: 0x8058,
		RGB8: 0x8051,
		SRGB8: 0x8c41,
		SRGB8_ALPHA8: 0x8c43,
		RGBA: 0x1908,
		RGB: 0x1907,
		UNSIGNED_BYTE: 0x1401,
	},
	{
		get: (target, property) => {
			if (typeof property === 'string' && property in target) {
				return target[property as keyof typeof target];
			}

			return 0;
		},
	},
);

let textureUtils: typeof import('../texture/utils');

beforeAll(async () => {
	Object.assign(globalThis, {
		WebGL2RenderingContext: webglConstantStub,
		WebGLRenderingContext: webglConstantStub,
	});

	textureUtils = await import('../texture/utils');
});

describe('TextureFormatInfo color space overrides', () => {
	it('uses sRGB internal formats for 8-bit color textures when requested', () => {
		const rgbaInfo = textureUtils.TextureFormatInfo.getFormatInfo(
			TextureFormat.RGBA8,
			ColorSpace.SRGB,
		);
		const rgbInfo = textureUtils.TextureFormatInfo.getFormatInfo(
			TextureFormat.RGB8,
			ColorSpace.SRGB,
		);

		expect(rgbaInfo.internalFormat).toBe(webglConstantStub.SRGB8_ALPHA8);
		expect(rgbaInfo.srgb).toBe(true);
		expect(rgbInfo.internalFormat).toBe(webglConstantStub.SRGB8);
		expect(rgbInfo.srgb).toBe(true);
	});

	it('keeps linear internal formats when no sRGB color space is requested', () => {
		const rgbaInfo = textureUtils.TextureFormatInfo.getFormatInfo(TextureFormat.RGBA8);

		expect(rgbaInfo.internalFormat).toBe(webglConstantStub.RGBA8);
		expect(rgbaInfo.srgb).toBe(false);
	});
});