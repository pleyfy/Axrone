# Lean scene-2d entry

`@axrone/scene-2d/lean` is an additive, tree-shakeable entry for consumers that
only need the 2D scene facade. The root `@axrone/scene-2d` entry is unchanged.

## Surface

Values: `Scene2D`, `Camera`, `SpriteRenderer`, `Color`.

Types: `SceneOptions`, `SceneRegistry`, `SceneRenderStats`,
`SceneRenderPlanningStats`, `SpriteRendererConfig`, `CameraConfig`, plus the
shader/material/mesh/texture definition + handle types from
`@axrone/scene-runtime/types`.

## Adoption

```ts
import { Scene2D } from '@axrone/scene-2d/lean';
```

The identity test (`src/__tests__/lean-entry.test.ts`) proves every lean value
is the same reference as the root export.

## Composition model

A lean 2D registry exposes `Camera` + `SpriteRenderer`; it can never produce
particles, lines, billboards or meshes. The lean `Scene2D` injects
`createLean2DSceneBatchRuntimes` (sprite family only) as its runtime
composition, so the sprite drawing path is preserved while
particle/line/billboard chunks — and the `particle-system` component chain —
stay out of the graph. A caller-supplied composition with its own
`createRenderBatchRuntimes` is kept untouched.

Imports use the fine-grained scene-runtime entries (`scene-asset-facade`,
`scene-camera`, `scene-sprite-renderer`, `scene-capability-guard`,
`scene-2d-lean-composition`) instead of the coarse `scene-facade` /
`scene-2d-support` barrels.

## Measured footprint (2026-11-01)

Method: `benchmark-web/scripts/measure-lean-footprint.mjs` (source) and
`LEAN_MEASURE_DIST=1` (built `dist`), esbuild 0.25.12, browser ESM, minify,
tree-shaken, gzip level 9.

| Graph | Before | After | Delta |
| --- | --- | --- | --- |
| source 2D | 1059.5 KB min / 265.5 KB gzip | 880.4 KB min / 222.7 KB gzip | −42.8 KB gzip (−16.1 %) |
| published dist 2D | 1291.4 KB min / 316.5 KB gzip | 1093.1 KB min / 269.6 KB gzip | −46.9 KB gzip (−14.8 %) |

Chunks that leave the lean 2D dist graph: `scene-facade` (22.5 KB min),
the `scene-runtime` particle component chunk (77.6 KB),
`@axrone/particle-system` (106.6 KB) and the line/billboard runtime code inside
the render chunk. `sprite-batch-runtime` + `render-2d` remain by design.

See `../../scene-3d/docs/lean-entry.md` for the chunk-graph analysis, the
composition contract and the shared residuals (UIHost via the prefab runtime,
lights/mesh draw path, direct runtime/kernel construction caveat).
