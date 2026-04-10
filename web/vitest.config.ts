import path from 'path';
import { defineConfig } from 'vitest/config';
import { createWorkspacePackageAliasEntries } from './build/workspace-package-aliases.mjs';

const workspaceAliases = createWorkspacePackageAliasEntries(__dirname);

export default defineConfig({
    test: {
        environment: 'happy-dom',
        globals: true,
        setupFiles: ['./vitest.setup.ts'],
        include: [
            'packages/**/*.{test,spec}.{js,ts}',
            'packages/**/__tests__/**/*.{test,spec}.{js,ts}',
        ],
        exclude: [
            'packages/**/*.browser.{test,spec}.{js,ts}',
            'packages/**/renderer/**/*',
            'packages/**/webgl/**/*',
        ],
    },
    resolve: {
        alias: workspaceAliases,
    },
    esbuild: {
        target: 'es2022',
    },
});
