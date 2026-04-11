import { describe, expect, it } from 'vitest';
import { normalizePlaygroundSource, validateSupportedModuleImports } from './source-compat';

describe('normalizePlaygroundSource', () => {
    it('moves ecs, numeric, and scene exports from core into owner packages', () => {
        const source = `import { Component, Scene, Transform, Vec3, script } from '@axrone/core';
import type { SceneExample } from './example-types';

const example: SceneExample = {} as SceneExample;

export default example;
`;

        expect(normalizePlaygroundSource(source)).toBe(`import { Component, Transform, script } from '@axrone/ecs-runtime';
import { Vec3 } from '@axrone/numeric';
import { Scene } from '@axrone/scene-3d';
import type { SceneExample } from './example-types';

const example: SceneExample = {} as SceneExample;

export default example;
`);
    });

    it('merges migrated scene exports into an existing scene-3d import', () => {
        const source = `import { Scene, Transform, Vec3, createUnlitColorShaderDefinition } from '@axrone/core';
import { Quat } from '@axrone/numeric';
import { DirectionalLight } from '@axrone/scene-3d';
`;

        expect(normalizePlaygroundSource(source)).toBe(`import { Transform } from '@axrone/ecs-runtime';
import { Quat, Vec3 } from '@axrone/numeric';
import { DirectionalLight, Scene, createUnlitColorShaderDefinition } from '@axrone/scene-3d';
`);
    });

    it('moves asset ownership imports out of core', () => {
        const source = `import { AssetDatabase, type AssetImporter, Transform } from '@axrone/core';
import { createGltfImporter } from '@axrone/asset-gltf';
`;

        expect(normalizePlaygroundSource(source)).toBe(
            [
                "import { AssetDatabase, type AssetImporter } from '@axrone/asset-core';",
                "import { Transform } from '@axrone/ecs-runtime';",
                "import { createGltfImporter } from '@axrone/asset-gltf';",
                '',
            ].join('\n')
        );
    });

    it('moves geometry ownership imports out of core', () => {
        const source = `import { AABB3D, Vec3, createPlane } from '@axrone/core';
`;

        expect(normalizePlaygroundSource(source)).toBe(`import { AABB3D, createPlane } from '@axrone/geometry';
import { Vec3 } from '@axrone/numeric';
`);
    });
});

describe('validateSupportedModuleImports', () => {
    it('reports scene split guidance for stale core imports', () => {
        const diagnostics = validateSupportedModuleImports(
            `import { Scene } from '@axrone/core';`,
            {
                '@axrone/core': {},
                '@axrone/scene-3d': { Scene: class Scene {} },
            }
        );

        expect(diagnostics).toEqual([
            'Module "@axrone/core" does not export "Scene". Import it from "@axrone/scene-3d" instead.',
        ]);
    });

    it('reports ecs ownership guidance for stale core imports', () => {
        const diagnostics = validateSupportedModuleImports(
            `import { Transform } from '@axrone/core';`,
            {
                '@axrone/core': {},
                '@axrone/ecs-runtime': { Transform: class Transform {} },
            }
        );

        expect(diagnostics).toEqual([
            'Module "@axrone/core" does not export "Transform". Import it from "@axrone/ecs-runtime" instead.',
        ]);
    });

    it('reports geometry ownership guidance for stale core imports', () => {
        const diagnostics = validateSupportedModuleImports(
            `import { createPlane } from '@axrone/core';`,
            {
                '@axrone/core': {},
                '@axrone/geometry': { createPlane: () => null },
            }
        );

        expect(diagnostics).toEqual([
            'Module "@axrone/core" does not export "createPlane". Import it from "@axrone/geometry" instead.',
        ]);
    });
});
