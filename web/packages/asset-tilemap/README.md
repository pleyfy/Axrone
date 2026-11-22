# @axrone/asset-tilemap

Asset layer for tilemaps: versioned tileset/tilemap schemas, a Tiled TMX/TSX
importer, native JSON + binary chunk codecs, and an `IChunkPager` over
`AssetDatabase`.

Depends on `@axrone/asset-core`, `@axrone/tilemap` and `@axrone/utility`.
The package does not import ECS, renderer or physics packages.

## Schemas (`formatVersion: 1`)

`TilesetDefinition`:

- `name`, `image` (asset key), `tileWidth`, `tileHeight`, `margin`, `spacing`,
  `columns`, `tileCount`, `imageWidth`, `imageHeight`, `tiles`.
- `tileCount` must equal `columns * rows`, where
  `rows = floor((imageHeight - 2*margin + spacing) / (tileHeight + spacing))`.
  A partially filled last row is rejected.
- `tiles` reuse `@axrone/tilemap`'s `TileDefinition` (id, name, collision,
  material, animation frames, autotile group); ids and animation tile ids must
  stay inside `tileCount`.

`TilemapAssetDefinition`:

- `projection` and `layers` reuse `@axrone/tilemap` specs (single-sourced
  validation).
- `chunkShift` is 3-6; `tilesets` is a non-empty list of asset keys.
- `chunks` lists `{ chunkX, chunkY, asset }` references; coordinates are signed
  16-bit and pairs must be unique. Chunk words never live in this JSON.

Validation returns `Result<T, TilemapAssetError>`; code (`UNSUPPORTED_VERSION`,
`INVALID_TILESET`, `INVALID_TILEMAP`, ...) is stable for callers. Thrown
`TilemapAssetFault` is reserved for programming errors.

## Tiled importer

`importTiledMap(tmx, { resolveTsx, chunkShift?, mapKey? })` returns the native
definition, tileset definitions, chunk snapshots, collision hints and
diagnostics.

Supported:

- TMX 1.10 map attributes and orthogonal / isometric / staggered orientations.
- Inline and external TSX tilesets (external sources come from `resolveTsx`).
- `<layer>` data as CSV or base64; `zlib`/`gzip` compression uses
  `DecompressionStream` and reports `UNSUPPORTED_COMPRESSION` when unavailable.
- Tiled flip bits map to `TileTransformFlags`
  (`H -> FlipX`, `V -> FlipY`, `D -> Rotate90`; composition order is diagonal
  first, as in Tiled).
- `<objectgroup>` objects become read-only `TiledCollisionHint`s in grid space.

Rejected or diagnostic-only:

- Infinite maps and XML `<tile>` data (`UNSUPPORTED_ENCODING`).
- Unknown compression (`UNSUPPORTED_COMPRESSION`), malformed XML
  (`MALFORMED_SOURCE`), gids outside a tileset (`TILED_ID_OUT_OF_RANGE`),
  missing external TSX (`MISSING_TILESET`).
- `<imagelayer>` is not imported; it emits an `UNSUPPORTED_LAYER_TYPE`
  diagnostic.

The importer writes chunk snapshots with chunk keys and asset keys
`tilemap:<mapKey>:chunk:<x>:<y>`.

## Native codecs and paging

```ts
import { AssetDatabase } from '@axrone/asset-core';
import {
    AssetChunkPager,
    createAssetTilemapCodecs,
    createAssetTilemapImportPipeline,
} from '@axrone/asset-tilemap';

const database = new AssetDatabase({
    codecs: createAssetTilemapCodecs(),
    pipeline: createAssetTilemapImportPipeline({ tiled: { resolveTsx } }),
    binary: { mode: 'inline' },
});

const receipt = await database.import({
    kind: 'text',
    data: tmx,
    uri: 'level.tmx',
});

const pager = new AssetChunkPager(database, {
    mapKey: 'level',
    chunkShift: 4,
    layerCount: receipt.primary.data.layers.length,
});
```

- `chunkAssetCodec` wraps the tilemap chunk snapshot codec; CRC32 is verified
  on decode.
- `AssetChunkPager.save` upserts chunk assets by stable key, so asset-core
  bumps revisions and emits normal upsert/batch events. `load` returns `null`
  for missing chunks and validates key/shift/layer count before returning.
- `createAssetTilemapImportPipeline()` registers the Tiled and native
  importers; it intentionally does not extend `createAsset2DImportPipeline`.

## Tests

```bash
yarn vitest run packages/asset-tilemap
yarn workspace @axrone/asset-tilemap typecheck
yarn workspace @axrone/asset-tilemap build
```

Fixtures cover orthogonal CSV, base64+zlib, external TSX, flip flags, chunk
crossing, objectgroup hints, unsupported compression, malformed XML and
out-of-range gids.
