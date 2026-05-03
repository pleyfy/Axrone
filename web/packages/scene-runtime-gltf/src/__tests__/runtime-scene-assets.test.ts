import { describe, expect, it } from 'vitest';
import type { GltfTextureAsset, GltfTextureUsage } from '@axrone/asset-gltf';
import { ColorSpace, FilterMode, TextureFormat, WrapMode } from '@axrone/render-webgl2';
import { createGltfTextureDefinitionFromTextureAsset } from '../internal/runtime-scene-assets';

const createTextureAsset = (usageHints: readonly GltfTextureUsage[]): GltfTextureAsset => ({
	id: 'Texture',
	textureIndex: 0,
	imageIndex: 0,
	sampler: {
		id: 'sampler/default',
		minFilter: FilterMode.LINEAR,
		magFilter: FilterMode.LINEAR,
		wrapS: WrapMode.REPEAT,
		wrapT: WrapMode.REPEAT,
	},
	payload: {
		kind: 'raw',
		bytes: new Uint8Array([255, 255, 255, 255]),
		mimeType: 'image/png',
		width: 1,
		height: 1,
	},
	usageHints,
	runtimeFormat: TextureFormat.RGBA8,
	transcode: {
		status: 'source',
	},
});

describe('scene-runtime glTF runtime scene assets', () => {
	it('marks base color textures as sRGB for runtime upload', () => {
		const built = createGltfTextureDefinitionFromTextureAsset(
			'texture/albedo',
			createTextureAsset(['baseColor']),
		);

		expect(built.definition.colorSpace).toBe(ColorSpace.SRGB);
	});

	it('keeps non-color data textures in linear space', () => {
		const built = createGltfTextureDefinitionFromTextureAsset(
			'texture/normal',
			createTextureAsset(['normal']),
		);

		expect(built.definition.colorSpace).toBe(ColorSpace.LINEAR);
	});
});