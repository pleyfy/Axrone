# Lean scene-3d entry

`@axrone/scene-3d/lean` is an additive, tree-shakeable entry for consumers that
only need the 3D scene facade (render-only apps, benchmark harnesses, playable
ads). The root `@axrone/scene-3d` entry is unchanged.

## Surface

Values: `Scene`, `Scene3DActorRuntime`, `MeshRenderer`, `Camera`,
`SceneGeometryMeshBuilder`, `createUnlitColorShaderDefinition`.

Types: `SceneOptions`, `SceneRegistry`, `SceneRenderStats`,
`SceneRenderPlanningStats`, `SceneRenderableActorCreateOptions`,
`SceneRenderableActorInstance`, `Scene3DActorRuntimeOptions`,
`SceneProfilerProbe`, `MeshRendererConfig`, `CameraConfig`, and the
shader/material/mesh/texture definition + handle types from
`@axrone/scene-runtime/types`.

## Adoption

```ts
import {
    Scene,
    SceneGeometryMeshBuilder,
    createUnlitColorShaderDefinition,
} from '@axrone/scene-3d/lean';
import type { SceneRenderableActorInstance } from '@axrone/scene-3d/lean';
```

The identity test (`src/__tests__/lean-entry.test.ts`) proves every lean value
is the same reference as the root export, so switching entries cannot change
runtime behavior.

## Why the source graph needed a published-dist follow-up

The source graph tree-shakes; a pre-bundled Rollup dist does not. Rollup emits
one flattened chunk per entry, and component modules have module-scope decorator
side effects, so a single value import of a coarse entry pulls that entry's
whole chunk family into the consumer. The lean entry used to reach:

- `@axrone/scene-runtime/scene-facade` (`Camera`) — the facade chunk also
  re-exports Animator, UIHost and the animation-streaming bridge;
- `@axrone/scene-runtime/scene-3d-support` (`MeshRenderer`,
  `SceneGeometryMeshBuilder`) — the support chunk also carries particles, line,
  trail, billboard, terrain and lighting components;
- `scene-render-runtime.ts`, which statically constructed sprite, particle,
  line and billboard batch runtimes. The particle batch runtime imports the
  `ParticleSystem` component and `@axrone/particle-system` (106.6 KB minified on
  its own).

## Current composition model

1. Lean scenes import fine-grained scene-runtime entries:
   `scene-asset-facade`, `scene-camera`, `scene-mesh-renderer`,
   `scene-geometry-mesh-builder`, `scene-shader-effect`,
   `scene-capability-guard`.
2. Optional render families are injected through
   `SceneRuntimeComposition.createRenderBatchRuntimes` (see
   `scene-runtime/src/rendering/batch-runtime-contract.ts`). The render runtime
   imports only types for the batch classes; the pipeline already skips a
   family whose runtime is absent.
3. Root `Scene` resolves `getDefaultSceneRuntimeComposition()` (all four batch
   families). `resolveSceneRuntimeComposition` fills the factory in for partial
   caller compositions, so physics-only overrides keep full batch behavior.
4. The lean 3D `Scene` injects no factory: its registry has no sprite,
   particle, line or billboard component, so those chunks never enter the
   graph. The derived instanced-mesh path stays available because it is part of
   the mesh renderer surface (`instancing: 'auto'`).

The regression guard is
`tests/architecture/scene-split/lean-entry-graph-boundary.test.ts`: it walks the
value-import graph from both lean entries and fails if a coarse barrel or a
batch family becomes reachable again.

## Measured footprint (2026-11-01)

Method: esbuild 0.25.12, browser ESM, minify, tree-shaken, gzip level 9,
`define: { 'process.env.NODE_ENV': '"production"' }`, via
`benchmark-web/scripts/measure-lean-footprint.mjs` (source) and
`LEAN_MEASURE_DIST=1` (built `dist`). `three` is imported by the benchmark
adapter itself (camera orientation), not by the engine, and is included in
both 3D numbers.

| Graph | Before | After | Delta |
| --- | --- | --- | --- |
| source 3D | 1309.8 KB min / 322.5 KB gzip | 1062.4 KB min / 262.1 KB gzip | −60.4 KB gzip (−18.7 %) |
| published dist 3D | 1545.1 KB min / 373.9 KB gzip | 1270.1 KB min / 307.7 KB gzip | −66.2 KB gzip (−17.7 %) |
| source 2D | 1059.5 KB min / 265.5 KB gzip | 880.4 KB min / 222.7 KB gzip | −42.8 KB gzip (−16.1 %) |
| published dist 2D | 1291.4 KB min / 316.5 KB gzip | 1093.1 KB min / 269.6 KB gzip | −46.9 KB gzip (−14.8 %) |

Dist module count: 3D 116 → 90, 2D 109 → 94.

Chunks that leave the lean 3D dist graph: `scene-facade` (22.5 KB min),
`scene-runtime` particle component chunk (77.6 KB), `@axrone/particle-system`
(106.6 KB), `sprite-batch-runtime` (45.2 KB), `sprite-mask` (12.6 KB),
`render-2d` (~13 KB) and the line/billboard runtime code inside the render
chunk. The 2D lean graph keeps `sprite-batch-runtime` + `render-2d` and drops
the same particle/line/billboard/facade chunks.

## Residual footprint (known, out of this change)

- `UIHost` (~3.2 KB min) stays reachable because
  `scene-prefab-runtime.ts` resolves a UI host during prefab hydration.
  Removing it needs a prefab-runtime hook.
- Lights (`area-light` ~12 KB min) and the mesh draw path stay in the runtime
  chunk for both profiles; only the batch families are injectable today.
- A lean scene constructed with a caller-supplied full profile but no
  composition no longer builds particle/line/billboard/sprite batches. Pass
  `composition: getDefaultSceneRuntimeComposition()` to opt back into the full
  render family set.
- Direct `new SceneRenderRuntime({...})` / `new SceneRuntimeKernel({...})`
  users now get the family set their composition injects (none by default).
  Root `Scene`/`Scene2D` and the Editor paths are unaffected because they
  install the default composition.
