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
        inputRelativePath: 'src/core.ts',
        outputBasename: 'core',
    }),
    ...createPackageConfig({
        packageDir,
        inputRelativePath: 'src/world.ts',
        outputBasename: 'world',
    }),
    ...createPackageConfig({
        packageDir,
        inputRelativePath: 'src/actor.ts',
        outputBasename: 'actor',
    }),
    ...createPackageConfig({
        packageDir,
        inputRelativePath: 'src/component.ts',
        outputBasename: 'component',
    }),
    ...createPackageConfig({
        packageDir,
        inputRelativePath: 'src/decorators.ts',
        outputBasename: 'decorators',
    }),
    ...createPackageConfig({
        packageDir,
        inputRelativePath: 'src/components.ts',
        outputBasename: 'components',
    }),
    ...createPackageConfig({
        packageDir,
        inputRelativePath: 'src/systems.ts',
        outputBasename: 'systems',
    }),
    ...createPackageConfig({
        packageDir,
        inputRelativePath: 'src/observers.ts',
        outputBasename: 'observers',
    }),
    ...createPackageConfig({
        packageDir,
        inputRelativePath: 'src/memory.ts',
        outputBasename: 'memory',
    }),
    ...createPackageConfig({
        packageDir,
        inputRelativePath: 'src/archetype.ts',
        outputBasename: 'archetype',
    }),
    ...createPackageConfig({
        packageDir,
        inputRelativePath: 'src/types.ts',
        outputBasename: 'types',
    }),
];
