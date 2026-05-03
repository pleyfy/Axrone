import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPackageConfig } from '../../build/create-package-config.mjs';

const packageDir = path.dirname(fileURLToPath(import.meta.url));

export default [
    ...createPackageConfig({ packageDir }),
    ...createPackageConfig({
        packageDir,
        inputRelativePath: 'src/types.ts',
        outputBasename: 'types',
    }),
    ...createPackageConfig({
        packageDir,
        inputRelativePath: 'src/errors.ts',
        outputBasename: 'errors',
    }),
    ...createPackageConfig({
        packageDir,
        inputRelativePath: 'src/paint.ts',
        outputBasename: 'paint',
    }),
    ...createPackageConfig({
        packageDir,
        inputRelativePath: 'src/shape.ts',
        outputBasename: 'shape',
    }),
    ...createPackageConfig({
        packageDir,
        inputRelativePath: 'src/queries.ts',
        outputBasename: 'queries',
    }),
    ...createPackageConfig({
        packageDir,
        inputRelativePath: 'src/mesh.ts',
        outputBasename: 'mesh',
    }),
    ...createPackageConfig({
        packageDir,
        inputRelativePath: 'src/serialization.ts',
        outputBasename: 'serialization',
    }),
    ...createPackageConfig({
        packageDir,
        inputRelativePath: 'src/registry.ts',
        outputBasename: 'registry',
    }),
];
