import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPackageConfig } from '../../build/create-package-config.mjs';

const packageDir = path.dirname(fileURLToPath(import.meta.url));

export default [
    ...createPackageConfig({ packageDir }),
    ...createPackageConfig({
        packageDir,
        inputRelativePath: 'src/runtime.ts',
        outputBasename: 'runtime/index',
    }),
    ...createPackageConfig({
        packageDir,
        inputRelativePath: 'src/layout.ts',
        outputBasename: 'layout/index',
    }),
    ...createPackageConfig({
        packageDir,
        inputRelativePath: 'src/text.ts',
        outputBasename: 'text/index',
    }),
    ...createPackageConfig({
        packageDir,
        inputRelativePath: 'src/font.ts',
        outputBasename: 'font/index',
    }),
    ...createPackageConfig({
        packageDir,
        inputRelativePath: 'src/widget.ts',
        outputBasename: 'widget/index',
    }),
];