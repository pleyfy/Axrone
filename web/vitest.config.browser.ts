import { defineConfig } from 'vitest/config';

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
        alias: {
            '@axrone/core': './packages/core/src',
            '@axrone/numeric': './packages/numeric/src',
            '@axrone/utility': './packages/utility/src',
        },
    },
    esbuild: {
        target: 'es2022',
    },
});
