# @axrone/tilemap

Chunked tilemap data model for Axrone: packed tile words, CRC-checked binary
chunk snapshots, residency-aware chunk storage with write-back, and a typestate
builder. Query, pathfinding and autotile modules land in M2; the asset schemas
and Tiled import land in M3.

This README is the package contract: it records the on-disk formats, the
supported limits, the error model and the benchmark gate that later milestones
must keep. Design rationale lives in ADR-0007 (repository `docs/adr/`).

## Status

| Milestone | Scope | State |
| --- | --- | --- |
| M0 | ADR, package scaffold, baseline benchmark | done |
| M1 | types, codecs, chunk store, pager, engine lifecycle | done |
| M2 | projection queries, viewport, raycast, sweep, A*, autotile | done |
| M3 | asset schemas, Tiled TMX/TSX import, binary chunk storage | pending |

## Package graph

```
@axrone/utility ─┐
@axrone/numeric ─┼─> @axrone/tilemap ──> @axrone/asset-tilemap
@axrone/memory ──┤        │                        │
@axrone/hash ────┘        │                        │
                          v                        v
                   @axrone/scene-runtime <─────────┘
```

- `@axrone/tilemap` imports only `utility`, `numeric`, `memory` and `hash`.
  `profiler` is allowed only from the `/profiler` subpath.
- `@axrone/physics-2d` must never import `@axrone/tilemap`; static bodies are
  built in `scene-runtime`.
- Tilemap modules are opt-in and stay out of the lean 2D entry and the
  `playable-2d` profile.

Subpath exports: `.`, `./codec`, `./grid`, `./query`, `./path`, `./observer`,
`./profiler`, `./errors`. The query, path and observer entries are opt-in and
never load `@axrone/observer` or `@axrone/profiler` from the core entry.

## Quick start

```ts
import { TileCodec, TilemapBuilder, TileTransform } from '@axrone/tilemap';

const engine = TilemapBuilder.create()
    .withProjection({ kind: 'orthogonal', tileWidth: 16, tileHeight: 16 })
    .withChunkShift(4) // 16 x 16 tiles per chunk
    .withCapacity(256) // resident chunk budget
    .withDirtyBudget(32) // dirty chunk budget
    .withLayers([{ name: 'ground' }, { name: 'walls', collision: true }] as const)
    .build()
    .get(); // build() returns Result<TilemapEngine, TilemapError>

const word = TileCodec.pack(
    12, // tileId (16 bits)
    TileTransform.Rotate90, // transform flags (3 bits)
    0b0000_1001, // collision mask (8 bits)
    2 // material (4 bits)
);

engine.setTile('walls', 3, 4, word); // Result<void, TilemapError>
const { word: current, residency } = engine.read('walls', 3, 4);
if (residency === 'resident' && current === word) {
    // chunk was allocated and holds the packed word
}
```

Reads have two forms:

- `read(layer, x, y)` returns `{ word, residency }` where residency is
  `'resident' | 'default' | 'unloaded'`.
- `readAt(layer, x, y)` / `getTile(...)` return the word only and resolve an
  unloaded chunk to the layer default without allocating.

Layers may be addressed by index or by name; an unknown layer is a programming
error and throws `TilemapFault`.

### Paging and shutdown

```ts
import type { IChunkPager } from '@axrone/tilemap';

const engine = TilemapBuilder.create()
    .withPager(myPager) // IChunkPager: load(key, signal) / save(snapshot, signal)
    .withLayers([{ name: 'ground' }] as const)
    .build()
    .get();

await engine.loadChunk(0, 0); // Result<boolean, TilemapError>; false = already resident
await engine.flushDirty(); // writes every dirty chunk through the pager

engine.close(); // rejects new foreground work, allows write-back
await engine.drain(); // waits for in-flight load/flush work
engine.dispose(); // releases the store; no write-back without close()/flush
```

`close()` + `drain()` is the deterministic shutdown path. `dispose()` on its
own drops dirty data. Engines are `Disposable` (`dispose()`), not
`AsyncDisposable`.

## Packed tile word ABI v1

One `uint32` per tile per layer:

| Field | Bits | Shift | Mask |
| --- | --- | --- | --- |
| `tileId` | 16 | 0 | `0x0000ffff` |
| `transform` | 3 | 16 | `0x00070000` |
| `collision` | 8 | 19 | `0x07f80000` |
| `material` | 4 | 27 | `0x78000000` |
| reserved | 1 | 31 | `0x80000000` |

Bit 31 is reserved and must be zero. The plan text listed `material: 5`; that
would occupy the reserved bit, so v1 keeps 4 material bits (16 materials).

`transform` is a flag set: `FlipX = 1`, `FlipY = 2`, `Rotate90 = 4`; the eight
combinations are the dihedral D4 states. `TileCodec.pack` validates and throws
`TilemapFault` instead of truncating. Changing any width, shift or meaning
bumps `TILEMAP_FORMAT_VERSION` and the snapshot `formatVersion`.

## Limits

- Grid and chunk coordinates are signed 16-bit: `[-32768, 32767]`.
- `chunkShift ∈ {3, 4, 5, 6}`: 8x8 up to 64x64 tiles per chunk.
- Up to 64 layers.
- One chunk snapshot holds `layerCount * chunkArea` words, capped at
  `1 << 20` words (4 MiB).
- Out-of-range coordinates and snapshots are rejected with
  `INVALID_COORDINATE` / `INVALID_SNAPSHOT`; nothing is truncated.

## Chunk snapshot format v1

Little-endian, 20-byte header followed by `(word, runLength)` RLE pairs:

| Offset | Size | Field |
| --- | --- | --- |
| 0 | 4 | magic `AXTC` (`0x43545841`) |
| 4 | 1 | format version (`1`) |
| 5 | 1 | chunk shift |
| 6 | 1 | layer count |
| 7 | 1 | reserved (`0`) |
| 8 | 4 | chunk key (`uint32`) |
| 12 | 4 | word count (`uint32`) |
| 16 | 4 | CRC32 of the payload |
| 20 | ... | `(word:uint32, runLength:uint32)` pairs |

`wordCount` is `layerCount << (chunkShift * 2)` and words are laid out
`layer * chunkArea + localY * chunkSize + localX`. The payload length must be a
multiple of 8 and every run length must be non-zero. Decoding validates magic,
version, shift, layer count, word count, run totals, the reserved bit and the
CRC32 before allocating or mutating state; every failure returns
`Result.err(TilemapError)`.

`encodeChunkSnapshot(snapshot)` and `decodeChunkSnapshot(bytes)` are exported
from the root and from `@axrone/tilemap/codec`.

## Residency, leases and write-back

- A chunk is resident, default-filled, or unloaded. Reads report which one;
  only writes to a non-default word allocate a chunk.
- Eviction order: free slot, then a clean LRU victim, then a dirty LRU victim
  only when the synchronous `onBeforeEvict` hook succeeds.
- When no candidate can be evicted, allocation returns
  `CHUNK_POOL_EXHAUSTED` with `details.dirtyPressure = true`; dirty data is
  never dropped silently. Call `flushDirty()` and retry.
- `acquireLease(key)` pins a chunk; the returned handle's `release()` is
  idempotent and stale generations cannot unpin a new owner. Leases are one
  small allocation per acquire by design (see ADR-0007); they are not pooled.
- `evict(key, 'write-back' | 'force')` is available on the store; the engine
  exposes `unloadChunk(x, y, mode)`.

## Error model

- `TilemapFault` (throws) is reserved for programming errors: invalid builder
  configuration, invalid brands, unknown layers, bad local coordinates.
- `TilemapError` inside `Result` covers recoverable failures: pager I/O,
  aborted loads, corrupt payloads, checksum mismatches, pool exhaustion, closed
  engines and invalid snapshots.
- Error codes: `INVALID_LAYER`, `INVALID_COORDINATE`, `INVALID_CONFIGURATION`,
  `INVALID_SNAPSHOT`, `CHUNK_POOL_EXHAUSTED`, `CHUNK_PINNED`, `CHUNK_DIRTY`,
  `PAGER_NOT_CONFIGURED`, `PAGER_IO_ERROR`, `CODEC_CORRUPT_PAYLOAD`,
  `CODEC_CHECKSUM_MISMATCH`, `ENGINE_CLOSED`, `OPERATION_ABORTED`,
  `UNSUPPORTED_PROJECTION`, `PATH_POOL_EXHAUSTED`, `PATH_BUFFER_TOO_SMALL`,
  `LEASE_EXPIRED`.

`TilemapError` is a frozen plain record so it can cross worker boundaries and
be serialized without class identity issues.

## Metrics

The core takes a narrow `TilemapMetricsSink` (chunk allocate/load/dirty/flush/
evict/pin/unpin, table rehash, pool exhaustion, plus resident/dirty/pinned/
lease gauges). It deliberately has no per-tile counters.

`@axrone/tilemap/profiler` provides `createProfilerTilemapMetricsSink(recorder)`,
which maps every callback to a `TimelineRecorder` event with
`payload.domain = 'tilemap'` and accumulates counters and gauges on the sink.

## Projections

`ProjectionKind` covers `orthogonal`, `isometric` and `staggered-isometric`
(with `tileWidth`, `tileHeight`, optional origin and stagger axis/index).
`@axrone/tilemap/query` exposes pure `gridToWorld`, `worldToGrid`,
`worldToTile` and `staggerOffset` helpers; `gridToWorld → worldToGrid`
round-trips exactly for integral coordinates, including negatives, for every
projection.

Native JSON is the source of truth; Tiled TMX/TSX is import-only (M3).
`UNSUPPORTED_PROJECTION` is reserved for future projection kinds, not for
isometric.

## Queries

`@axrone/tilemap/query`:

- `viewportGridBounds(projection, camera)` returns the conservative grid
  rectangle for a world-space camera. Orthogonal and isometric bounds are exact;
  staggered bounds carry a one-tile margin.
- `extractViewportInstances(engine, layer, rect, buffer?)` fills a reusable
  `ViewportTileBuffer` with the non-empty tiles of a grid-space rectangle;
  `visitViewportTiles` streams the same scan without a buffer.
- `raycastTilemap(engine, layer, ox, oy, dx, dy, options?, hit?)` runs a
  projection-aware ray query. Orthogonal and isometric rays use grid-space DDA
  (the affine transform preserves the parameter); staggered rays traverse world
  row/column boundaries and re-derive the tile after each crossing. Hit points
  are grid-exact, normals are returned in world space, and a ray that starts
  inside a solid tile reports `time = 0`.
- `sweepTilemapAabb(engine, layer, box, dx, dy, options?, hit?)` sweeps a world
  AABB through a conservative grid-space box. Start penetration returns
  `time = 0` with the minimum-translation normal and an unchanged position;
  otherwise the resolved position is backed off by `1e-5` world units.

Both queries take an optional `isSolid(word)` predicate; the default treats a
non-zero tile word as solid.

## Pathfinding

`@axrone/tilemap/path`:

- `findPath(engine, layer, startX, startY, goalX, goalY, options?)` returns a
  discriminated `PathResult`: `found`, `no-path`, `limit` or
  `buffer-too-small`.
- The open set is the engine's handle-based min `PriorityQueue` (indexed heap),
  so better routes are decrease-key updates. `PathNode`s come from
  `ObjectPool`; keys are packed `GridKey`s in an open-addressed table, not a
  `Map`.
- Blocking defaults to a non-zero collision mask; step cost defaults to
  `1 + material`. Diagonal steps cost `sqrt(2)` times the base cost and corner
  cutting is refused when either orthogonal neighbour blocks.
- `maxExpandedNodes` returns `limit`, never a partial path. A too-small `out`
  buffer returns `buffer-too-small` with the required waypoint count; no path
  is truncated.

## Autotile, definitions and changes

- `@axrone/tilemap/query` exports `BLOB47_CANONICAL_MASKS`,
  `canonicalizeBlobMask`, `computeBlob47Index` and
  `applyAutotileRect(engine, layer, rect, group)`. The 47-entry transform table
  is applied in one pass with `TileCodec.withTransform`.
- `TileDefinition` and `createTileDefinitionTable` (root export) validate tile
  ids, collision/material ranges and animation frames, and select frames by
  elapsed time.
- `@axrone/tilemap/observer` provides `createTileChangeSubject()` and
  `TileChangeWriter`, which emits one batched event per `write`/`fillRect`
  call (never per tile) through `@axrone/observer`.

## Benchmarks

The harness is deterministic (fixed mulberry32 seeds) and runs each scenario
five times:

```bash
yarn workspace @axrone/tilemap build   # bench imports ../dist/index.mjs
yarn workspace @axrone/tilemap bench -- --update   # record baseline
yarn workspace @axrone/tilemap bench -- --check    # strict gate
yarn workspace @axrone/tilemap bench -- --check --relaxed   # noisy dev machine
```

- `bench/baseline.json` is committed and names its platform/arch/node version.
  `--check` refuses to compare timings recorded on another platform/arch.
- The gate is **no more than 10% slower than baseline on a quiet machine**
  (strict default). It compares the minimum of the five runs (scheduler noise
  only adds time); p50/p95 are recorded for reporting. Because shared dev
  machines swing 25-50% on short scenarios, `--relaxed` widens every gate by
  50% for local checks; CI on a dedicated runner keeps the strict default. The
  `path` scenario keeps a 25% per-scenario gate even in strict mode because
  1k A* queries are pool/GC-heavy; it is the slowest scenario (~35-55 s per
  run), so the full gate takes a few minutes.
- Every run also measures a fixed ALU calibration workload before and after the
  scenarios. `--check` scales the baseline by the current/baseline calibration
  ratio (clamped to 0.5-3x) so ambient CPU load does not masquerade as a
  regression.
- Scenarios: `write` (1M random writes over 256 chunks), `read` (10M reads,
  90% hot), `viewport` (512 camera pans over a 16x16-chunk map), `raycast`
  (100k projection-aware rays), `sweep` (100k AABB sweeps), `path` (1k A*
  queries on a 256x256 map, 4- and 8-neighbour), `codec` (10k RLE+CRC32
  encode/decode of 16x16x4 chunks) and `alloc` (100k lease acquire/release).
- `allocBytes` is the heap delta measured during the run (allocation volume,
  not a leak). For a stable value run `node --expose-gc bench/run.mjs`.
  Leak correctness is covered separately by `chunk-store-leak.test.ts`
  (100k acquire/release cycles, pins return to zero, resident chunks stay
  within capacity).

## Tests and gates

```bash
yarn workspace @axrone/tilemap test          # vitest
yarn workspace @axrone/tilemap typecheck     # tsc -p tsconfig.build.json
yarn workspace @axrone/tilemap typecheck:test
yarn workspace @axrone/tilemap build         # rollup
```

Repository-wide gates that include this package: `yarn test:ci`,
`yarn test:architecture`, `yarn test:hardening`, `yarn generate:knowledge`.
