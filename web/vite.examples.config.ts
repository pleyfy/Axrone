import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const workspaceDir = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
    root: path.resolve(workspaceDir, 'examples'),
    publicDir: false,
    resolve: {
        alias: {
            '@axrone/core': path.resolve(workspaceDir, 'packages/core/src'),
            '@axrone/numeric': path.resolve(workspaceDir, 'packages/numeric/src'),
            '@axrone/random': path.resolve(workspaceDir, 'packages/random/src'),
            '@axrone/ui': path.resolve(workspaceDir, 'packages/ui/src'),
            '@axrone/ui-webgl2': path.resolve(workspaceDir, 'packages/ui-webgl2/src'),
            '@axrone/utility': path.resolve(workspaceDir, 'packages/utility/src'),
        },
    },
    server: {
        fs: {
            allow: [workspaceDir],
        },
        open: '/index.html',
    },
    preview: {
        open: '/index.html',
    },
    optimizeDeps: {
        exclude: [
            '@axrone/core',
            '@axrone/numeric',
            '@axrone/random',
            '@axrone/ui',
            '@axrone/ui-webgl2',
            '@axrone/utility',
        ],
        include: ['monaco-editor'],
    },
    build: {
        outDir: path.resolve(workspaceDir, 'dist/examples'),
        emptyOutDir: true,
        sourcemap: true,
        rollupOptions: {
            input: {
                index: path.resolve(workspaceDir, 'examples/index.html'),
                'engine-benchmark': path.resolve(workspaceDir, 'examples/engine-benchmark.html'),
            },
        },
    },
    worker: {
        format: 'es',
    },
    css: {
        postcss: path.resolve(workspaceDir, 'postcss.config.js'),
    },
});
