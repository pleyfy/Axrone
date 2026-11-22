import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

/**
 * Lean entries must not *value*-import the coarse scene-runtime barrels or
 * optional render families. Rollup emits one chunk per entry, so a single
 * value import of `scene-facade`, a support barrel or a batch runtime pulls
 * that entry's whole flattened chunk into the consumer bundle (the source
 * graph tree-shakes, the pre-bundled dist graph cannot).
 *
 * Type-only imports are ignored: they are erased at emit time and cannot add
 * runtime chunks.
 */

const testDir = path.dirname(fileURLToPath(import.meta.url));
const workspaceDir = path.resolve(testDir, '../../..');
const packagesDir = path.resolve(workspaceDir, 'packages');

const isFile = (candidate: string): boolean => {
    try {
        return fs.statSync(candidate).isFile();
    } catch {
        return false;
    }
};

const resolveRelative = (specifier: string, importerFile: string): string | null => {
    const base = path.resolve(path.dirname(importerFile), specifier);
    const candidates = [base, `${base}.ts`, `${base}.tsx`, path.join(base, 'index.ts')];
    return candidates.find(isFile) ?? null;
};

const resolveWorkspaceSpecifier = (
    specifier: string,
    importerFile: string
): string | null => {
    if (specifier.startsWith('.')) {
        return resolveRelative(specifier, importerFile);
    }
    if (!specifier.startsWith('@axrone/')) {
        return null;
    }

    const [packageName, ...subpathParts] = specifier.slice('@axrone/'.length).split('/');
    const packageSrcDir = path.resolve(packagesDir, packageName ?? '', 'src');
    if (!packageName || !fs.existsSync(packageSrcDir)) {
        return null;
    }

    const subpath = subpathParts.join('/');
    const candidates = subpath
        ? [
              path.resolve(packageSrcDir, `${subpath}.ts`),
              path.resolve(packageSrcDir, subpath, 'index.ts'),
          ]
        : [path.resolve(packageSrcDir, 'index.ts')];
    return candidates.find(isFile) ?? null;
};

const parseValueSpecifiers = (filePath: string): readonly string[] => {
    const source = fs.readFileSync(filePath, 'utf8');
    const sourceFile = ts.createSourceFile(
        filePath,
        source,
        ts.ScriptTarget.Latest,
        true,
        ts.ScriptKind.TS
    );
    const specifiers: string[] = [];

    const moduleText = (specifier: ts.Expression | undefined): string | null =>
        specifier && ts.isStringLiteral(specifier) ? specifier.text : null;

    for (const statement of sourceFile.statements) {
        if (ts.isImportDeclaration(statement)) {
            const specifier = moduleText(statement.moduleSpecifier);
            if (!specifier) {
                continue;
            }
            const clause = statement.importClause;
            if (!clause) {
                // Side-effect import: always a value edge.
                specifiers.push(specifier);
                continue;
            }
            if (clause.isTypeOnly) {
                continue;
            }
            let hasValueBinding = clause.name !== undefined;
            const bindings = clause.namedBindings;
            if (bindings) {
                hasValueBinding =
                    hasValueBinding ||
                    (ts.isNamespaceImport(bindings)
                        ? true
                        : bindings.elements.some((element) => !element.isTypeOnly));
            }
            if (hasValueBinding) {
                specifiers.push(specifier);
            }
            continue;
        }

        if (ts.isExportDeclaration(statement) && statement.moduleSpecifier) {
            const specifier = moduleText(statement.moduleSpecifier);
            if (!specifier || statement.isTypeOnly) {
                continue;
            }
            const clause = statement.exportClause;
            if (!clause || (ts.isNamedExports(clause) && clause.elements.some((e) => !e.isTypeOnly))) {
                specifiers.push(specifier);
            }
        }
    }

    return specifiers;
};

const collectValueGraph = (entryFile: string): ReadonlySet<string> => {
    const reachable = new Set<string>();
    const queue = [entryFile];

    while (queue.length > 0) {
        const file = queue.pop()!;
        if (reachable.has(file)) {
            continue;
        }
        reachable.add(file);

        for (const specifier of parseValueSpecifiers(file)) {
            const resolved = resolveWorkspaceSpecifier(specifier, file);
            if (resolved && !reachable.has(resolved)) {
                queue.push(resolved);
            }
        }
    }

    return reachable;
};

const packageFile = (relativePath: string) =>
    path.resolve(packagesDir, relativePath).replace(/\\/g, '/');

const toPackagePaths = (graph: ReadonlySet<string>): readonly string[] =>
    [...graph].map((file) => file.replace(/\\/g, '/')).sort();

// `UIHost` is deliberately absent: it stays reachable through
// `scene-prefab-runtime.ts`, which resolves a UI host while hydrating prefab
// bindings. Dropping it needs a prefab-runtime hook, tracked as a follow-up.
const COMMON_BANNED = [
    'scene-runtime/src/index.ts',
    'scene-runtime/src/scene-facade.ts',
    'scene-runtime/src/scene-3d-support.ts',
    'scene-runtime/src/scene-2d-support.ts',
    'scene-runtime/src/scene-batch-runtimes.ts',
    'scene-runtime/src/scene-full-profile.ts',
    'scene-runtime/src/scene-profile.ts',
    'scene-runtime/src/default-composition.ts',
    'scene-runtime/src/rendering/index.ts',
    'scene-runtime/src/rendering/particle-batch-runtime.ts',
    'scene-runtime/src/rendering/line-batch-runtime.ts',
    'scene-runtime/src/rendering/billboard-batch-runtime.ts',
    'scene-runtime/src/components/animator.ts',
    'scene-runtime/src/components/particle-system.ts',
    'scene-runtime/src/components/line-renderer.ts',
    'scene-runtime/src/components/trail-renderer.ts',
    'scene-runtime/src/components/billboard-renderer.ts',
    'scene-runtime/src/components/sprite-animator.ts',
    'particle-system/src/index.ts',
    'physics-2d/src/index.ts',
    'physics-3d/src/index.ts',
    'terrain/src/index.ts',
    'ui/src/index.ts',
];

const SCENE_3D_LEAN_BANNED = [
    ...COMMON_BANNED,
    'scene-runtime/src/rendering/sprite-batch-runtime.ts',
    'scene-runtime/src/components/sprite-renderer.ts',
    'scene-runtime/src/components/sprite-mask.ts',
    'scene-3d/src/index.ts',
    'scene-3d/src/scene-full.ts',
    'scene-3d/src/scene-factory.ts',
];

const SCENE_2D_LEAN_BANNED = [
    ...COMMON_BANNED,
    'scene-2d/src/index.ts',
    'scene-2d/src/scene-2d-full.ts',
    'scene-2d/src/scene-2d-factory.ts',
    'scene-2d/src/scene-2d-animation-runtime.ts',
];

const findViolations = (
    graph: ReadonlySet<string>,
    bannedRelativePaths: readonly string[]
): readonly string[] => {
    const banned = new Set(bannedRelativePaths.map(packageFile));
    return toPackagePaths(graph).filter((file) => banned.has(file));
};

describe('lean entry chunk boundary', () => {
    const scene3dLeanGraph = collectValueGraph(
        path.resolve(packagesDir, 'scene-3d', 'src', 'lean.ts')
    );
    const scene2dLeanGraph = collectValueGraph(
        path.resolve(packagesDir, 'scene-2d', 'src', 'lean.ts')
    );

    it('keeps the 3D lean value graph off coarse barrels and batch families', () => {
        expect(findViolations(scene3dLeanGraph, SCENE_3D_LEAN_BANNED)).toEqual([]);
    });

    it('keeps the 2D lean value graph off coarse barrels and non-sprite families', () => {
        expect(findViolations(scene2dLeanGraph, SCENE_2D_LEAN_BANNED)).toEqual([]);
    });

    it('keeps the sprite batch path on the 2D lean graph and off the 3D one', () => {
        expect(
            toPackagePaths(scene2dLeanGraph).some((file) =>
                file.endsWith('scene-runtime/src/rendering/sprite-batch-runtime.ts')
            )
        ).toBe(true);
        expect(
            toPackagePaths(scene3dLeanGraph).some((file) =>
                file.endsWith('scene-runtime/src/rendering/sprite-batch-runtime.ts')
            )
        ).toBe(false);
    });

    it('keeps lean graphs on the fine-grained scene-runtime entries', () => {
        for (const graph of [scene3dLeanGraph, scene2dLeanGraph]) {
            const files = toPackagePaths(graph);
            expect(files).toContain(packageFile('scene-runtime/src/scene-asset-facade.ts'));
            expect(files).toContain(packageFile('scene-runtime/src/scene-camera.ts'));
        }
    });
});
