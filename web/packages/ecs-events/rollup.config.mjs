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
        inputRelativePath: 'src/event.ts',
        outputBasename: 'event',
    }),
    ...createPackageConfig({
        packageDir,
        inputRelativePath: 'src/observer.ts',
        outputBasename: 'observer',
    }),
    ...createPackageConfig({
        packageDir,
        inputRelativePath: 'src/ecs-observer.ts',
        outputBasename: 'ecs-observer',
    }),
    ...createPackageConfig({
        packageDir,
        inputRelativePath: 'src/world-event-runtime.ts',
        outputBasename: 'world-event-runtime',
    }),
];