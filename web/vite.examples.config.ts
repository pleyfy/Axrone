import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import {
    createWorkspacePackageAliasEntries,
    listWorkspacePackageNames,
} from './build/workspace-package-aliases.mjs';

const workspaceDir = path.dirname(fileURLToPath(import.meta.url));
const workspaceAliases = createWorkspacePackageAliasEntries(workspaceDir);
const workspacePackageNames = listWorkspacePackageNames(workspaceDir);
const normalizeModuleId = (value: string) => value.replace(/\\/g, '/');

const resolveManualChunk = (id: string): string | undefined => {
    const normalizedId = normalizeModuleId(id);

    if (normalizedId.includes('/node_modules/monaco-editor/')) {
        return 'vendor-monaco';
    }

    if (normalizedId.includes('/node_modules/typescript/')) {
        return 'vendor-typescript';
    }

    if (normalizedId.includes('/node_modules/draco3dgltf/')) {
        return 'vendor-draco';
    }

    if (normalizedId.includes('/examples/playground/live-editor')) {
        return 'playground-editor';
    }

    if (
        normalizedId.includes('/examples/playground/live-example-runtime') ||
        normalizedId.includes('/examples/playground/source-compat')
    ) {
        return 'playground-compiler';
    }

    if (
        normalizedId.includes('/packages/asset-core/') ||
        normalizedId.includes('/packages/asset-gltf/') ||
        normalizedId.includes('/packages/ecs-runtime/') ||
        normalizedId.includes('/packages/ecs-events/') ||
        normalizedId.includes('/packages/ecs-query/') ||
        normalizedId.includes('/packages/ecs-storage/') ||
        normalizedId.includes('/packages/ecs-world-support/') ||
        normalizedId.includes('/packages/game-loop/') ||
        normalizedId.includes('/packages/numeric/') ||
        normalizedId.includes('/packages/random/') ||
        normalizedId.includes('/packages/render-core/') ||
        normalizedId.includes('/packages/render-webgl2/') ||
        normalizedId.includes('/packages/scene-3d/') ||
        normalizedId.includes('/packages/scene-runtime-gltf/') ||
        normalizedId.includes('/packages/scene-runtime/') ||
        normalizedId.includes('/packages/ui-webgl2/') ||
        normalizedId.includes('/packages/ui/') ||
        normalizedId.includes('/packages/utility/')
    ) {
        return 'axrone-engine';
    }

    return undefined;
};

export default defineConfig({
    root: path.resolve(workspaceDir, 'examples'),
    publicDir: path.resolve(workspaceDir, 'examples/public'),
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
            output: {
                manualChunks(id) {
                    return resolveManualChunk(id);
                },
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
