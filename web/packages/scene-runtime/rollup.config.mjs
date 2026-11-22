import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createMultiEntryConfig } from '../../build/create-package-config.mjs';

const packageDir = path.dirname(fileURLToPath(import.meta.url));

export default createMultiEntryConfig({
    packageDir,
    entries: {
        index: 'src/index.ts',
        types: 'src/types.ts',
        errors: 'src/errors.ts',
        'scene-registry': 'src/scene-registry.ts',
        'scene-profile': 'src/scene-profile.ts',
        'scene-profile-contract': 'src/scene-profile-contract.ts',
        'scene-manifest-profile': 'src/scene-manifest-profile.ts',
        'scene-core-profile': 'src/scene-core-profile.ts',
        'scene-2d-profile': 'src/scene-2d-profile.ts',
        'scene-3d-profile': 'src/scene-3d-profile.ts',
        'scene-full-profile': 'src/scene-full-profile.ts',
        'default-composition': 'src/default-composition.ts',
        'scene-facade': 'src/scene-facade.ts',
        prefab: 'src/prefab.ts',
        'scene-3d-support': 'src/scene-3d-support.ts',
        'scene-2d-support': 'src/scene-2d-support.ts',
        rendering: 'src/rendering/index.ts',
        // Fine-grained entries: lean scene entries import only the modules
        // they actually use so Rollup does not hand them a coarse shared
        // chunk carrying animation, UI, physics or batch component chains.
        'scene-asset-facade': 'src/scene-asset-facade.ts',
        'scene-camera': 'src/scene-camera.ts',
        'scene-capability-guard': 'src/scene-capability-guard.ts',
        'scene-geometry-mesh-builder': 'src/scene-geometry-mesh-builder.ts',
        'scene-mesh-renderer': 'src/scene-mesh-renderer.ts',
        'scene-shader-effect': 'src/scene-shader-effect.ts',
        'scene-sprite-renderer': 'src/scene-sprite-renderer.ts',
        // Render batch composition: root entries inject the full set, the
        // lean 2D entry injects the sprite family only.
        'scene-batch-runtimes': 'src/scene-batch-runtimes.ts',
        'scene-2d-lean-composition': 'src/scene-2d-lean-composition.ts',
        'scene-tilemap': 'src/scene-tilemap.ts',
    },
});
