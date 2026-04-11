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
        inputRelativePath: 'src/actor-registry.ts',
        outputBasename: 'actor-registry',
    }),
    ...createPackageConfig({
        packageDir,
        inputRelativePath: 'src/singleton-registry.ts',
        outputBasename: 'singleton-registry',
    }),
    ...createPackageConfig({
        packageDir,
        inputRelativePath: 'src/world-metrics-service.ts',
        outputBasename: 'world-metrics-service',
    }),
];