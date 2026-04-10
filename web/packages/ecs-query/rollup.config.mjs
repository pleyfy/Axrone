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
        inputRelativePath: 'src/query-cache.ts',
        outputBasename: 'query-cache',
    }),
    ...createPackageConfig({
        packageDir,
        inputRelativePath: 'src/world-query-runtime.ts',
        outputBasename: 'world-query-runtime',
    }),
];