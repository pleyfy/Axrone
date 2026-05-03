import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPackageConfig } from '../../build/create-package-config.mjs';

const packageDir = path.dirname(fileURLToPath(import.meta.url));

export default [
    ...createPackageConfig({ packageDir }),
    ...createPackageConfig({
        packageDir,
        inputRelativePath: 'src/core.ts',
        outputBasename: 'core/index',
    }),
    ...createPackageConfig({
        packageDir,
        inputRelativePath: 'src/frame.ts',
        outputBasename: 'frame/index',
    }),
    ...createPackageConfig({
        packageDir,
        inputRelativePath: 'src/serialization.ts',
        outputBasename: 'serialization/index',
    }),
];