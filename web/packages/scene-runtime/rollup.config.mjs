import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPackageConfig } from '../../build/create-package-config.mjs';

const packageDir = path.dirname(fileURLToPath(import.meta.url));

export default [
    ...createPackageConfig({
        packageDir,
    }),
    ...createPackageConfig({
        packageDir,
        inputRelativePath: 'src/scene-registry.ts',
        outputBasename: 'scene-registry',
    }),
    ...createPackageConfig({
        packageDir,
        inputRelativePath: 'src/scene-profile.ts',
        outputBasename: 'scene-profile',
    }),
    ...createPackageConfig({
        packageDir,
        inputRelativePath: 'src/scene-facade.ts',
        outputBasename: 'scene-facade',
    }),
    ...createPackageConfig({
        packageDir,
        inputRelativePath: 'src/scene-3d-support.ts',
        outputBasename: 'scene-3d-support',
    }),
    ...createPackageConfig({
        packageDir,
        inputRelativePath: 'src/scene-2d-support.ts',
        outputBasename: 'scene-2d-support',
    }),
];