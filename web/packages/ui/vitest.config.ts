import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';
import { createWorkspacePackageAliasEntries } from '../../build/workspace-package-aliases.mjs';

const packageDir = path.dirname(fileURLToPath(import.meta.url));
const workspaceRoot = path.resolve(packageDir, '../..');

export default defineConfig({
    test: {
        environment: 'happy-dom',
        globals: true,
        setupFiles: [path.join(workspaceRoot, 'vitest.setup.ts')],
        include: ['src/**/*.{test,spec}.ts', 'src/**/__tests__/**/*.{test,spec}.ts'],
        exclude: ['src/**/*.browser.{test,spec}.ts'],
    },
    resolve: {
        alias: createWorkspacePackageAliasEntries(workspaceRoot),
    },
    esbuild: {
        target: 'es2022',
    },
});
