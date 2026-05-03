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
        inputRelativePath: 'src/types.ts',
        outputBasename: 'types',
    }),
    ...createPackageConfig({
        packageDir,
        inputRelativePath: 'src/clip.ts',
        outputBasename: 'clip',
    }),
    ...createPackageConfig({
        packageDir,
        inputRelativePath: 'src/blend-tree.ts',
        outputBasename: 'blend-tree',
    }),
    ...createPackageConfig({
        packageDir,
        inputRelativePath: 'src/state-machine.ts',
        outputBasename: 'state-machine',
    }),
    ...createPackageConfig({
        packageDir,
        inputRelativePath: 'src/retargeting.ts',
        outputBasename: 'retargeting',
    }),
    ...createPackageConfig({
        packageDir,
        inputRelativePath: 'src/ik.ts',
        outputBasename: 'ik',
    }),
    ...createPackageConfig({
        packageDir,
        inputRelativePath: 'src/skinning.ts',
        outputBasename: 'skinning',
    }),
    ...createPackageConfig({
        packageDir,
        inputRelativePath: 'src/controller.ts',
        outputBasename: 'controller',
    }),
    ...createPackageConfig({
        packageDir,
        inputRelativePath: 'src/pose.ts',
        outputBasename: 'pose',
    }),
    ...createPackageConfig({
        packageDir,
        inputRelativePath: 'src/rig.ts',
        outputBasename: 'rig',
    }),
    ...createPackageConfig({
        packageDir,
        inputRelativePath: 'src/errors.ts',
        outputBasename: 'errors',
    }),
];