import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPackageConfig } from '../../build/create-package-config.mjs';

const packageDir = path.dirname(fileURLToPath(import.meta.url));

export default [
    ...createPackageConfig({ packageDir }),
    ...createPackageConfig({
        packageDir,
        inputRelativePath: 'src/renderer.ts',
        outputBasename: 'renderer/index',
    }),
    ...createPackageConfig({
        packageDir,
        inputRelativePath: 'src/pipeline.ts',
        outputBasename: 'pipeline/index',
    }),
];