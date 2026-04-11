import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
    RUNTIME_PROFILE_CORE_CAPABILITY_PACKAGES,
} from '@axrone/runtime-profile-core';
import {
    RUNTIME_PROFILE_2D_CAPABILITY_PACKAGES,
} from '@axrone/runtime-profile-2d';
import {
    RUNTIME_PROFILE_3D_CAPABILITY_PACKAGES,
} from '@axrone/runtime-profile-3d';
import {
    RUNTIME_PROFILE_FULL_CAPABILITY_PACKAGES,
} from '@axrone/runtime-profile-full';

const testDir = path.dirname(fileURLToPath(import.meta.url));
const packagesDir = path.resolve(testDir, '../../../packages');

const readDependencyKeys = (packageDirName: string): readonly string[] => {
    const packageJsonPath = path.resolve(packagesDir, packageDirName, 'package.json');
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8')) as {
        dependencies?: Record<string, string>;
    };

    return Object.keys(packageJson.dependencies ?? {}).sort((left, right) =>
        left.localeCompare(right)
    );
};

describe('runtime profile capability graph', () => {
    it('keeps runtime-profile-core aligned with the cross-cutting scene-runtime/input capability seam', () => {
        expect(RUNTIME_PROFILE_CORE_CAPABILITY_PACKAGES).toEqual([
            '@axrone/scene-runtime',
            '@axrone/input-core',
        ]);
        expect(readDependencyKeys('runtime-profile-core')).toEqual([
            '@axrone/input-core',
            '@axrone/scene-runtime',
        ]);
    });

    it('keeps runtime-profile-2d free of 3d-only capabilities', () => {
        expect(RUNTIME_PROFILE_2D_CAPABILITY_PACKAGES).toEqual([
            '@axrone/scene-runtime',
            '@axrone/scene-2d',
            '@axrone/input-core',
            '@axrone/asset-2d',
            '@axrone/render-2d',
            '@axrone/physics-core',
            '@axrone/physics-2d',
        ]);
        expect(readDependencyKeys('runtime-profile-2d')).toEqual([
            '@axrone/asset-2d',
            '@axrone/input-core',
            '@axrone/physics-2d',
            '@axrone/physics-core',
            '@axrone/render-2d',
            '@axrone/scene-2d',
            '@axrone/scene-runtime',
        ]);
        expect(RUNTIME_PROFILE_2D_CAPABILITY_PACKAGES).not.toContain('@axrone/asset-gltf');
        expect(RUNTIME_PROFILE_2D_CAPABILITY_PACKAGES).not.toContain('@axrone/render-3d');
        expect(RUNTIME_PROFILE_2D_CAPABILITY_PACKAGES).not.toContain('@axrone/render-webgl2');
        expect(RUNTIME_PROFILE_2D_CAPABILITY_PACKAGES).not.toContain('@axrone/scene-3d');
    });

    it('keeps runtime-profile-3d free of 2d-only capabilities while modeling the webgl backend seam', () => {
        expect(RUNTIME_PROFILE_3D_CAPABILITY_PACKAGES).toEqual([
            '@axrone/scene-runtime',
            '@axrone/scene-3d',
            '@axrone/input-core',
            '@axrone/asset-core',
            '@axrone/asset-gltf',
            '@axrone/render-3d',
            '@axrone/render-webgl2',
            '@axrone/physics-core',
            '@axrone/physics-3d',
        ]);
        expect(readDependencyKeys('runtime-profile-3d')).toEqual([
            '@axrone/asset-core',
            '@axrone/asset-gltf',
            '@axrone/input-core',
            '@axrone/physics-3d',
            '@axrone/physics-core',
            '@axrone/render-3d',
            '@axrone/render-webgl2',
            '@axrone/scene-3d',
            '@axrone/scene-runtime',
        ]);
        expect(RUNTIME_PROFILE_3D_CAPABILITY_PACKAGES).not.toContain('@axrone/asset-2d');
        expect(RUNTIME_PROFILE_3D_CAPABILITY_PACKAGES).not.toContain('@axrone/render-2d');
        expect(RUNTIME_PROFILE_3D_CAPABILITY_PACKAGES).not.toContain('@axrone/scene-2d');
    });

    it('keeps runtime-profile-full as the explicit union of the 2d and 3d capability graphs', () => {
        expect(RUNTIME_PROFILE_FULL_CAPABILITY_PACKAGES).toEqual([
            '@axrone/scene-runtime',
            '@axrone/scene-2d',
            '@axrone/input-core',
            '@axrone/asset-2d',
            '@axrone/render-2d',
            '@axrone/physics-core',
            '@axrone/physics-2d',
            '@axrone/scene-3d',
            '@axrone/asset-core',
            '@axrone/asset-gltf',
            '@axrone/render-3d',
            '@axrone/render-webgl2',
            '@axrone/physics-3d',
        ]);
        expect(readDependencyKeys('runtime-profile-full')).toEqual([
            '@axrone/asset-2d',
            '@axrone/asset-core',
            '@axrone/asset-gltf',
            '@axrone/input-core',
            '@axrone/physics-2d',
            '@axrone/physics-3d',
            '@axrone/physics-core',
            '@axrone/render-2d',
            '@axrone/render-3d',
            '@axrone/render-webgl2',
            '@axrone/scene-2d',
            '@axrone/scene-3d',
            '@axrone/scene-runtime',
        ]);
    });
});