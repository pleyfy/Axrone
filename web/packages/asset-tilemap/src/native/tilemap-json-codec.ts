import type { AssetCodecMap } from '@axrone/asset-core';
import type { AssetTilemapSchema } from '../index';
import { chunkAssetCodec } from './chunk-asset-codec';
import { tilemapAssetJsonCodec } from '../tilemap-asset';
import { tilesetJsonCodec } from '../tileset';

/** JSON codec for the native tilemap definition (alias for tooling). */
export const nativeTilemapJsonCodec = tilemapAssetJsonCodec;

/** JSON codec for the tileset definition (alias for tooling). */
export const nativeTilesetJsonCodec = tilesetJsonCodec;

/** Complete codec map required by an `AssetDatabase<AssetTilemapSchema>`. */
export const createAssetTilemapCodecs = (): AssetCodecMap<AssetTilemapSchema> => ({
    tilemap: tilemapAssetJsonCodec,
    tileset: tilesetJsonCodec,
    'tilemap-chunk': chunkAssetCodec,
});
