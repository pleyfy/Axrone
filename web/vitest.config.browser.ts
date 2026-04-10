import { defineConfig } from 'vitest/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createWorkspacePackageAliasMap } from './build/workspace-package-aliases.mjs';

const workspaceDir = path.dirname(fileURLToPath(import.meta.url));
const workspaceAliases = createWorkspacePackageAliasMap(workspaceDir);

export default defineConfig({
    test: {
        browser: {
            enabled: true,
            name: 'chromium',
            provider: 'playwright',
            headless: false,
        },
        globals: true,
        setupFiles: ['./vitest.browser.setup.ts'],
        include: [
            'packages/**/*.browser.{test,spec}.{js,ts}',
            'packages/**/renderer/**/*.{test,spec}.{js,ts}',
        ],
    },
    resolve: {
        alias: workspaceAliases,
    },
    esbuild: {
        target: 'es2022',
    },
});
