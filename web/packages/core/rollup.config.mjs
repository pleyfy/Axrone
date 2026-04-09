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
        inputRelativePath: 'src/scene-runtime.ts',
        outputBasename: 'scene-runtime/index',
    }),
    ...createPackageConfig({
        packageDir,
        inputRelativePath: 'src/scene-3d.ts',
        outputBasename: 'scene-3d/index',
    }),
    ...createPackageConfig({
        packageDir,
        inputRelativePath: 'src/runtime-profile-core.ts',
        outputBasename: 'runtime-profile-core/index',
    }),
    ...createPackageConfig({
        packageDir,
        inputRelativePath: 'src/runtime-profile-3d.ts',
        outputBasename: 'runtime-profile-3d/index',
    }),
    ...createPackageConfig({
        packageDir,
        inputRelativePath: 'src/runtime-profile-full.ts',
        outputBasename: 'runtime-profile-full/index',
    }),
];
