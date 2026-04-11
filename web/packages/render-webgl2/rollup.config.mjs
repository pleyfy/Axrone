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
        inputRelativePath: 'src/buffer.ts',
        outputBasename: 'buffer',
    }),
    ...createPackageConfig({
        packageDir,
        inputRelativePath: 'src/framebuffer.ts',
        outputBasename: 'framebuffer',
    }),
    ...createPackageConfig({
        packageDir,
        inputRelativePath: 'src/vao.ts',
        outputBasename: 'vao',
    }),
    ...createPackageConfig({
        packageDir,
        inputRelativePath: 'src/shader/index.ts',
        outputBasename: 'shader',
    }),
    ...createPackageConfig({
        packageDir,
        inputRelativePath: 'src/material/index.ts',
        outputBasename: 'material',
    }),
    ...createPackageConfig({
        packageDir,
        inputRelativePath: 'src/mesh/index.ts',
        outputBasename: 'mesh',
    }),
    ...createPackageConfig({
        packageDir,
        inputRelativePath: 'src/batch/index.ts',
        outputBasename: 'batch',
    }),
];