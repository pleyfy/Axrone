import path from 'path';
import { defineConfig } from 'vitest/config';

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
        alias: {
            '@axrone/core': path.resolve(__dirname, 'packages/core/src'),
            '@axrone/numeric': path.resolve(__dirname, 'packages/numeric/src'),
            '@axrone/utility': path.resolve(__dirname, 'packages/utility/src'),
        },
    },
    esbuild: {
        target: 'es2022',
    },
});
