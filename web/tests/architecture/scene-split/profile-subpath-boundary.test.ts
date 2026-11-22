import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { listModuleSpecifiers, toWorkspaceRelativePath } from '../_helpers/import-specifiers';

const testDir = path.dirname(fileURLToPath(import.meta.url));
const workspaceDir = path.resolve(testDir, '../../..');

interface ProfileImportRule {
    readonly filePath: string;
    readonly requiredSpecifiers: readonly string[];
}

const rules: readonly ProfileImportRule[] = [
    {
        filePath: path.resolve(
            workspaceDir,
            'packages/runtime-profile-core/src/profile.ts'
        ),
        requiredSpecifiers: ['@axrone/scene-runtime/scene-core-profile'],
    },
    {
        filePath: path.resolve(
            workspaceDir,
            'packages/runtime-profile-2d/src/profile.ts'
        ),
        requiredSpecifiers: ['@axrone/scene-runtime/scene-2d-profile'],
    },
    {
        filePath: path.resolve(
            workspaceDir,
            'packages/runtime-profile-3d/src/profile.ts'
        ),
        requiredSpecifiers: ['@axrone/scene-runtime/scene-3d-profile'],
    },
    {
        filePath: path.resolve(
            workspaceDir,
            'packages/runtime-profile-full/src/profile.ts'
        ),
        requiredSpecifiers: ['@axrone/scene-runtime/scene-full-profile'],
    },
    {
        // Root Scene2D lives in the full-composition subclass; the base
        // `scene-2d.ts` intentionally imports no profile so lean stays light.
        filePath: path.resolve(workspaceDir, 'packages/scene-2d/src/scene-2d-full.ts'),
        requiredSpecifiers: ['@axrone/scene-runtime/scene-2d-profile'],
    },
    {
        filePath: path.resolve(workspaceDir, 'packages/scene-2d/src/profile.ts'),
        requiredSpecifiers: [
            '@axrone/scene-runtime/scene-2d-profile',
            '@axrone/scene-runtime/scene-profile-contract',
            '@axrone/scene-runtime/scene-manifest-profile',
        ],
    },
    {
        filePath: path.resolve(workspaceDir, 'packages/scene-2d/src/types.ts'),
        requiredSpecifiers: [
            '@axrone/scene-runtime/scene-profile-contract',
            '@axrone/scene-runtime/scene-manifest-profile',
        ],
    },
    {
        filePath: path.resolve(workspaceDir, 'packages/scene-2d/src/index.ts'),
        requiredSpecifiers: ['./profile', './types'],
    },
    {
        filePath: path.resolve(workspaceDir, 'packages/scene-3d/src/profile.ts'),
        requiredSpecifiers: [
            '@axrone/scene-runtime/scene-full-profile',
            '@axrone/scene-runtime/scene-profile-contract',
            '@axrone/scene-runtime/scene-manifest-profile',
        ],
    },
    {
        filePath: path.resolve(workspaceDir, 'packages/scene-3d/src/types.ts'),
        requiredSpecifiers: [
            '@axrone/scene-runtime/scene-profile-contract',
            '@axrone/scene-runtime/scene-manifest-profile',
        ],
    },
    {
        filePath: path.resolve(workspaceDir, 'packages/scene-3d/src/index.ts'),
        requiredSpecifiers: ['./profile', './types'],
    },
] as const;

describe('scene profile subpath boundary', () => {
    it('keeps bundle-sensitive profile entrypoints off the shared scene-profile barrel', () => {
        const violatingFiles = rules
            .filter(({ filePath, requiredSpecifiers }) => {
                const specifiers = new Set(listModuleSpecifiers(filePath));
                return (
                    specifiers.has('@axrone/scene-runtime/scene-profile') ||
                    requiredSpecifiers.some((requiredSpecifier) =>
                        specifiers.has(requiredSpecifier) === false
                    )
                );
            })
            .map(({ filePath }) => toWorkspaceRelativePath(workspaceDir, filePath))
            .sort((left, right) => left.localeCompare(right));

        expect(violatingFiles).toEqual([]);
    });
});