import { defineConfig } from 'vitest/config';
import { createWorkspacePackageAliasEntries } from './build/workspace-package-aliases.mjs';

const workspaceAliases = createWorkspacePackageAliasEntries(__dirname);

export default defineConfig({
    test: {
        environment: 'happy-dom',
        globals: true,
        setupFiles: ['./vitest.setup.ts'],
        include: ['tests/architecture/**/*.{test,spec}.{js,ts}'],
    },
    resolve: {
        alias: workspaceAliases,
    },
    esbuild: {
        target: 'es2022',
    },
});