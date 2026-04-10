import { describe, expect, it } from 'vitest';
import { normalizePlaygroundSource, validateSupportedModuleImports } from './source-compat';

describe('normalizePlaygroundSource', () => {
    it('moves numeric and scene exports from core into owner packages', () => {
        const source = `import { Component, Scene, Transform, Vec3, script } from '@axrone/core';
import type { SceneExample } from './example-types';

const example: SceneExample = {} as SceneExample;

export default example;
`;

        expect(normalizePlaygroundSource(source)).toBe(`import { Component, Transform, script } from '@axrone/core';
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

        expect(normalizePlaygroundSource(source)).toBe(`import { Transform } from '@axrone/core';
import { Quat, Vec3 } from '@axrone/numeric';
import { DirectionalLight, Scene, createUnlitColorShaderDefinition } from '@axrone/scene-3d';
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
});