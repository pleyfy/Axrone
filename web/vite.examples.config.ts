import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import {
    createWorkspacePackageAliasMap,
    listWorkspacePackageNames,
} from './build/workspace-package-aliases.mjs';

const workspaceDir = path.dirname(fileURLToPath(import.meta.url));
const workspaceAliases = createWorkspacePackageAliasMap(workspaceDir);
const workspacePackageNames = listWorkspacePackageNames(workspaceDir);

export default defineConfig({
    root: path.resolve(workspaceDir, 'examples'),
    publicDir: false,
    resolve: {
        alias: workspaceAliases,
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
        exclude: workspacePackageNames,
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
