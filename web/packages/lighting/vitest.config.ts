import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';
import { createWorkspacePackageAliasEntries } from '../../build/workspace-package-aliases.mjs';

const packageDir = path.dirname(fileURLToPath(import.meta.url));
const workspaceDir = path.resolve(packageDir, '../..');

export default defineConfig({
    test: {
        environment: 'happy-dom',
        globals: true,
        setupFiles: [path.resolve(workspaceDir, 'vitest.setup.ts')],
        include: ['src/**/*.{test,spec}.{js,ts}', 'src/**/__tests__/**/*.{test,spec}.{js,ts}'],
        exclude: ['src/**/*.browser.{test,spec}.{js,ts}', 'src/**/renderer/**/*', 'src/**/webgl/**/*'],
    },
    resolve: {
        alias: createWorkspacePackageAliasEntries(workspaceDir),
    },
    esbuild: {
        target: 'es2022',
    },
});