import { describe, expect, it } from 'vitest';
import { AssetDatabase } from '@axrone/asset-core';
import {
    createAsset2DImportPipeline,
    type Asset2DImportSchema,
} from '../sprite-atlas-importer';

describe('asset-2d sprite atlas import pipeline', () => {
    it('imports canonical atlas JSON into the normalized sprite atlas schema', async () => {
        const database = new AssetDatabase<Asset2DImportSchema>({
            pipeline: createAsset2DImportPipeline(),
        });

        const receipt = await database.import({
            kind: 'json',
            uri: 'content/hero.spriteatlas.json',
            data: {
                id: 'atlas/hero',
                textureId: 'hero-texture',
                textureSize: { width: 64, height: 32 },
                frames: [
                    {
                        id: 'hero/idle-0',
                        region: { x: 0, y: 0, width: 32, height: 32 },
                        sourceSize: { width: 32, height: 32 },
                    },
                ],
                animations: [
                    {
                        id: 'idle',
                        frames: ['hero/idle-0'],
                    },
                ],
            },
        });

        expect(receipt.importerId).toBe('asset-2d.sprite-atlas.json');
        expect(receipt.primary.kind).toBe('spriteAtlas');
        expect(receipt.primary.data.textureId).toBe('hero-texture');
        expect(receipt.primary.data.frames[0]?.id).toBe('hero/idle-0');
        expect(receipt.primary.data.animations[0]?.frames[0]?.frameId).toBe('hero/idle-0');
    });

    it('imports TexturePacker atlas JSON and derives a canonical sprite atlas definition', async () => {
        const database = new AssetDatabase<Asset2DImportSchema>({
            pipeline: createAsset2DImportPipeline(),
        });

        const receipt = await database.import({
            kind: 'text',
            uri: 'content/ui.atlas.json',
            mimeType: 'application/json',
            data: JSON.stringify({
                frames: {
                    'panel/default.png': {
                        frame: { x: 0, y: 0, w: 18, h: 18 },
                        rotated: false,
                        trimmed: false,
                        sourceSize: { w: 18, h: 18 },
                        spriteSourceSize: { x: 0, y: 0, w: 18, h: 18 },
                        pivot: { x: 0.5, y: 0.5 },
                        duration: 90,
                    },
                },
                meta: {
                    image: 'ui-atlas-texture',
                    size: { w: 18, h: 18 },
                    scale: '1',
                },
            }),
        });

        expect(receipt.importerId).toBe('asset-2d.sprite-atlas.texturepacker');
        expect(receipt.primary.kind).toBe('spriteAtlas');
        expect(receipt.primary.data.textureId).toBe('ui-atlas-texture');
        expect(receipt.primary.data.frames[0]?.sourceSize.width).toBe(18);
        expect(receipt.primary.data.frames[0]?.pivot.x).toBe(0.5);
    });
});
