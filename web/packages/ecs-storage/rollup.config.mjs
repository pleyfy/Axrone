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
        inputRelativePath: 'src/component-pool.ts',
        outputBasename: 'component-pool',
    }),
    ...createPackageConfig({
        packageDir,
        inputRelativePath: 'src/archetype.ts',
        outputBasename: 'archetype',
    }),
    ...createPackageConfig({
        packageDir,
        inputRelativePath: 'src/entity-store.ts',
        outputBasename: 'entity-store',
    }),
    ...createPackageConfig({
        packageDir,
        inputRelativePath: 'src/archetype-store.ts',
        outputBasename: 'archetype-store',
    }),
    ...createPackageConfig({
        packageDir,
        inputRelativePath: 'src/world-storage-runtime.ts',
        outputBasename: 'world-storage-runtime',
    }),
    ...createPackageConfig({
        packageDir,
        inputRelativePath: 'src/types.ts',
        outputBasename: 'types',
    }),
];