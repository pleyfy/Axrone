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
            'examples/**/*.{test,spec}.{js,ts}',
            'packages/**/*.{test,spec}.{js,ts}',
            'packages/**/__tests__/**/*.{test,spec}.{js,ts}',
            'tests/**/*.{test,spec}.{js,ts}',
        ],
        exclude: [
            '**/.tmp/**',
            // Compiled test copies under dist/ are stale build artifacts;
            // the authoritative suites live under src/.
            'packages/**/dist/**',
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
