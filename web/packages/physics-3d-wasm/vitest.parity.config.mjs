import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createWorkspacePackageAliasEntries } from '../../build/workspace-package-aliases.mjs';

const workspaceDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

process.env.AXRONE_PHYSICS_PARITY = '1';

export default {
    css: {
        postcss: { plugins: [] },
    },
    resolve: {
        alias: createWorkspacePackageAliasEntries(workspaceDir),
    },
    test: {
        environment: 'node',
        include: ['src/__tests__/engine-parity.test.ts'],
        testTimeout: 240000,
        hookTimeout: 240000,
    },
};
