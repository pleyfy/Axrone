import fs from 'node:fs';
import path from 'node:path';
import { builtinModules, createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import commonjs from '@rollup/plugin-commonjs';
import resolve from '@rollup/plugin-node-resolve';
import esbuild from 'rollup-plugin-esbuild';
import dts from 'rollup-plugin-dts';
import peerDepsExternal from 'rollup-plugin-peer-deps-external';

const buildDir = path.dirname(fileURLToPath(import.meta.url));
const workspaceDir = path.resolve(buildDir, '..');
const defaultTsconfigPath = path.join(workspaceDir, 'tsconfig.build.json');

const builtinModuleIds = new Set([
    ...builtinModules,
    ...builtinModules.map((moduleName) => `node:${moduleName}`),
]);

const createExternalMatcher = (packageDir, packageJson, additionalExternalIds) => {
    const packageIds = new Set([
        ...Object.keys(packageJson.dependencies ?? {}),
        ...Object.keys(packageJson.peerDependencies ?? {}),
        ...additionalExternalIds,
    ]);

    // The dts pass resolves bare specifiers of sibling packages (via tsconfig
    // paths or package exports) to absolute file paths, which bypasses the
    // bare-specifier check below and made rollup-plugin-dts inline sibling
    // package type declarations (Actor/World/Vec3 copies in every consumer
    // dist). Resolved files outside this package's directory therefore must
    // stay external too.
    const realPackageDir = fs.realpathSync(packageDir);
    const isInsideOwnPackage = (resolvedId) => {
        let realResolved;
        try {
            realResolved = fs.realpathSync(resolvedId);
        } catch {
            realResolved = resolvedId;
        }
        const relative = path.relative(realPackageDir, realResolved);
        return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
    };

    return (id) => {
        if (builtinModuleIds.has(id)) {
            return true;
        }

        for (const packageId of packageIds) {
            if (id === packageId || id.startsWith(`${packageId}/`)) {
                return true;
            }
        }

        if (path.isAbsolute(id)) {
            return !isInsideOwnPackage(id);
        }

        return false;
    };
};

const require = createRequire(import.meta.url);
const ts = require('typescript');

const sourceFileCache = new Map();
const readSourceCached = (filePath) => {
    const cached = sourceFileCache.get(filePath);
    if (cached !== undefined) {
        return cached;
    }
    let content;
    try {
        content = fs.readFileSync(filePath, 'utf8');
    } catch {
        content = null;
    }
    sourceFileCache.set(filePath, content);
    return content;
};

const astCache = new Map();
const parseModuleStructure = (filePath) => {
    const cached = astCache.get(filePath);
    if (cached) {
        return cached;
    }
    const source = readSourceCached(filePath);
    if (source === null) {
        return null;
    }
    const sourceFile = ts.createSourceFile(filePath, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);

    const exportClauses = [];
    const exportStars = [];
    const importClauses = [];
    const exportDeclarations = [];

    for (const statement of sourceFile.statements) {
        if (ts.isExportDeclaration(statement)) {
            const moduleSpecifier = statement.moduleSpecifier && ts.isStringLiteral(statement.moduleSpecifier)
                ? statement.moduleSpecifier.text
                : null;
            if (statement.exportClause && ts.isNamedExports(statement.exportClause)) {
                const names = statement.exportClause.elements.map((element) => {
                    const propertyName = element.propertyName;
                    return propertyName ? propertyName.text : element.name.text;
                });
                if (moduleSpecifier) {
                    exportClauses.push({ names, moduleSpecifier });
                }
            } else if (!statement.exportClause && moduleSpecifier) {
                exportStars.push({ moduleSpecifier });
            }
        } else if (ts.isImportDeclaration(statement)) {
            const moduleSpecifier = statement.moduleSpecifier && ts.isStringLiteral(statement.moduleSpecifier)
                ? statement.moduleSpecifier.text
                : null;
            if (moduleSpecifier && statement.importClause) {
                const namedBindings = statement.importClause.namedBindings;
                if (namedBindings && ts.isNamedImports(namedBindings)) {
                    const names = namedBindings.elements.map((element) => {
                        const propertyName = element.propertyName;
                        return propertyName ? propertyName.text : element.name.text;
                    });
                    importClauses.push({ names, moduleSpecifier });
                }
            }
        } else if (
            ts.isClassDeclaration(statement) ||
            ts.isFunctionDeclaration(statement) ||
            ts.isInterfaceDeclaration(statement) ||
            ts.isTypeAliasDeclaration(statement) ||
            ts.isEnumDeclaration(statement)
        ) {
            const hasExport = statement.modifiers?.some((mod) => mod.kind === ts.SyntaxKind.ExportKeyword);
            if (hasExport && statement.name) {
                exportDeclarations.push(statement.name.text);
            }
        } else if (ts.isVariableStatement(statement)) {
            const hasExport = statement.modifiers?.some((mod) => mod.kind === ts.SyntaxKind.ExportKeyword);
            if (hasExport) {
                for (const declaration of statement.declarationList.declarations) {
                    if (ts.isIdentifier(declaration.name)) {
                        exportDeclarations.push(declaration.name.text);
                    }
                }
            }
        }
    }

    const result = { exportClauses, exportStars, importClauses, exportDeclarations };
    astCache.set(filePath, result);
    return result;
};

const resolveRelativeModule = (specifier, importerFile) => {
    if (!specifier.startsWith('.')) {
        return null;
    }
    const base = path.resolve(path.dirname(importerFile), specifier);
    const candidates = [base, `${base}.ts`, `${base}.tsx`, path.join(base, 'index.ts')];
    for (const candidate of candidates) {
        try {
            if (fs.statSync(candidate).isFile()) {
                return fs.realpathSync(candidate);
            }
        } catch {
            // Probe the next candidate.
        }
    }
    return null;
};

// Entry names may contain slashes ('core/index' -> dist/core/index.d.ts), so
// cross-entry references must be spelled relative to the referencing entry's
// own dist location, not blindly with a './' prefix.
const entryDistSpecifier = (fromEntryName, toEntryName) => {
    const relative = path.posix.relative(path.posix.dirname(fromEntryName), toEntryName);
    return relative.startsWith('../') ? relative : `./${relative}`;
};

// Graph walk for one entry: which internal modules it reaches and which names
// its files pull from each of them (import and re-export clauses). Never
// descends into another entry of the same package — declarations behind
// another entry are not inlined into this bundle.
const collectEntryGraph = (entryFile, entryAbsolutePaths) => {
    const modules = new Set();
    const namesByModule = new Map();
    const visited = new Set();

    const recordNames = (modulePath, names) => {
        if (names.length === 0) {
            return;
        }
        let bucket = namesByModule.get(modulePath);
        if (!bucket) {
            bucket = new Set();
            namesByModule.set(modulePath, bucket);
        }
        for (const name of names) {
            bucket.add(name);
        }
    };

    const visit = (file) => {
        if (visited.has(file)) {
            return;
        }
        visited.add(file);
        const structure = parseModuleStructure(file);
        if (structure === null) {
            return;
        }

        for (const clause of structure.exportClauses) {
            const target = resolveRelativeModule(clause.moduleSpecifier, file);
            if (!target) {
                continue;
            }
            modules.add(target);
            recordNames(target, clause.names);
            if (target !== entryFile && entryAbsolutePaths.has(target)) {
                continue;
            }
            visit(target);
        }
        for (const clause of structure.importClauses) {
            const target = resolveRelativeModule(clause.moduleSpecifier, file);
            if (!target) {
                continue;
            }
            modules.add(target);
            recordNames(target, clause.names);
        }
        for (const star of structure.exportStars) {
            const target = resolveRelativeModule(star.moduleSpecifier, file);
            if (!target) {
                continue;
            }
            modules.add(target);
            if (target !== entryFile && entryAbsolutePaths.has(target)) {
                continue;
            }
            visit(target);
        }
    };

    visit(entryFile);
    return { modules, namesByModule };
};

// Export-chain walk: the names an entry actually exports, following only
// export statements (imports never contribute to a surface). With
// stopAtEntries the walk yields exactly the names inlined into this bundle's
// dist d.ts (used for the barrel check of rule 2); otherwise it follows
// re-export chains across entry files too (owner coverage for rule 3).
//
// Named re-export clauses filter the walk: `export { A } from './x'` only
// exposes A from x's surface, never x's other declarations. Star re-exports
// pass every name through.
const collectEntryExportSurface = (entryFile, entryAbsolutePaths, stopAtEntries) => {
    const surfaceNames = new Set();
    const visited = new Set();

    const visit = (file, allowedNames) => {
        const filterKey = allowedNames ? [...allowedNames].sort().join('|') : '*';
        const visitedKey = `${file}::${filterKey}`;
        if (visited.has(visitedKey)) {
            return;
        }
        visited.add(visitedKey);
        const structure = parseModuleStructure(file);
        if (structure === null) {
            return;
        }

        for (const name of structure.exportDeclarations) {
            if (!allowedNames || allowedNames.has(name)) {
                surfaceNames.add(name);
            }
        }
        for (const clause of structure.exportClauses) {
            const effective = allowedNames
                ? clause.names.filter((name) => allowedNames.has(name))
                : clause.names;
            for (const name of effective) {
                surfaceNames.add(name);
            }
            if (effective.length === 0) {
                continue;
            }
            const target = resolveRelativeModule(clause.moduleSpecifier, file);
            if (!target) {
                continue;
            }
            if (stopAtEntries && target !== entryFile && entryAbsolutePaths.has(target)) {
                continue;
            }
            // A named clause always restricts what its target contributes,
            // even when this file itself was reached without a filter.
            visit(target, new Set(effective));
        }
        for (const star of structure.exportStars) {
            if (allowedNames && allowedNames.size === 0) {
                continue;
            }
            const target = resolveRelativeModule(star.moduleSpecifier, file);
            if (!target) {
                continue;
            }
            if (stopAtEntries && target !== entryFile && entryAbsolutePaths.has(target)) {
                continue;
            }
            visit(target, allowedNames);
        }
    };

    visit(entryFile, null);
    return { surfaceNames };
};

export const createMultiEntryConfig = ({
    packageDir,
    entries = { index: 'src/index.ts' },
    external = [],
}) => {
    const packageJsonPath = path.join(packageDir, 'package.json');
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
    const packageTsconfigPath = fs.existsSync(path.join(packageDir, 'tsconfig.build.json'))
        ? path.join(packageDir, 'tsconfig.build.json')
        : defaultTsconfigPath;
    const distDir = path.join(packageDir, 'dist');
    const isExternal = createExternalMatcher(packageDir, packageJson, external);

    const jsInput = {};
    for (const [name, relativePath] of Object.entries(entries)) {
        jsInput[name] = path.join(packageDir, relativePath);
    }

    const entryNamesByRelativePath = new Map(
        Object.entries(entries).map(([name, relativePath]) => [
            relativePath.replace(/\\/g, '/'),
            name,
        ])
    );

    // --- Shared-declaration routing for the dts pass ------------------------
    // Each entry is flattened into its own dist/<name>.d.ts bundle. When two
    // entries re-export the same internal module, each bundle inlines its own
    // copy of the declarations and consumers star-exporting both surfaces see
    // two distinct declarations of one name (TS2308). The resolveId rules
    // below keep a single canonical copy per name:
    //   1. relative import that IS another entry   -> './<entry>' specifier
    //   2. clause whose names the barrel exports   -> package root specifier
    //   3. module shared with an earlier non-index entry exporting the same
    //      names                                    -> that entry's specifier
    // The canonical surface keeps the inlined copy; everyone else references
    // it. Runtime output is untouched (dts pass only).
    const entryAbsolutePaths = new Set(
        Object.values(entries).map((entryPath) => path.join(packageDir, entryPath))
    );
    const entryGraphs = new Map(
        Object.entries(entries).map(([name, relativePath]) => [
            name,
            collectEntryGraph(path.join(packageDir, relativePath), entryAbsolutePaths),
        ])
    );
    const entryExportSurfaces = new Map(
        Object.entries(entries).map(([name, relativePath]) => [
            name,
            collectEntryExportSurface(
                path.join(packageDir, relativePath),
                entryAbsolutePaths,
                false
            ),
        ])
    );
    const barrelInlinedSurface = entries.index
        ? collectEntryExportSurface(
              path.join(packageDir, entries.index),
              entryAbsolutePaths,
              true
          )
        : null;
    const packageRootSpecifier = packageJson.name;

    const findCanonicalOwnerEntry = (modulePath, names) => {
        for (const [entryName, surface] of entryExportSurfaces) {
            if (entryName === 'index') {
                continue;
            }
            if (!entryGraphs.get(entryName).modules.has(modulePath)) {
                continue;
            }
            if (![...names].every((clauseName) => surface.surfaceNames.has(clauseName))) {
                continue;
            }
            return entryName;
        }
        return null;
    };

    return [
        {
            input: jsInput,
            external: isExternal,
            output: [
                {
                    dir: distDir,
                    format: 'cjs',
                    sourcemap: true,
                    entryFileNames: '[name].js',
                    chunkFileNames: 'chunks/[name]-[hash].js',
                    exports: 'named',
                },
                {
                    dir: distDir,
                    format: 'es',
                    sourcemap: true,
                    entryFileNames: '[name].mjs',
                    chunkFileNames: 'chunks/[name]-[hash].mjs',
                },
            ],
            plugins: [
                peerDepsExternal(),
                resolve({
                    extensions: ['.mjs', '.js', '.json', '.ts'],
                }),
                commonjs(),
                esbuild({
                    include: /\.ts$/,
                    target: 'es2020',
                    tsconfig: packageTsconfigPath,
                }),
            ],
        },
        ...Object.entries(entries).map(([name, relativePath]) => ({
            input: path.join(packageDir, relativePath),
            external: isExternal,
            output: {
                file: path.join(distDir, `${name}.d.ts`),
                format: 'es',
                // Backstop: if a resolved file outside this package was
                // externalized (cross-package relative import), emit a valid
                // package specifier instead of an absolute build-machine path.
                paths: (id) => {
                    if (!path.isAbsolute(id)) {
                        return id;
                    }

                    const normalizedWorkspace = workspaceDir.replace(/\\/g, '/');
                    const normalizedId = id.replace(/\\/g, '/');
                    const prefix = `${normalizedWorkspace}/packages/`;
                    if (normalizedId.startsWith(prefix)) {
                        const remainder = normalizedId.slice(prefix.length);
                        const packageDirName = remainder.split('/')[0];
                        if (packageDirName) {
                            return `@axrone/${packageDirName}`;
                        }
                    }
                    return id;
                },
            },
            plugins: [
                {
                    name: 'axrone-dts-external-specifiers',
                    resolveId: {
                        order: 'pre',
                        handler: async function (source, importer) {
                            // Keep every external import as its original bare
                            // specifier: bundling only this package's own
                            // sources prevents sibling package type
                            // declarations from being inlined into dist d.ts
                            // (nominal duplicates like Actor/World/Vec3).
                            if (
                                builtinModuleIds.has(source) ||
                                (!path.isAbsolute(source) && !source.startsWith('.'))
                            ) {
                                return { id: source, external: true };
                            }

                            // Imports that resolve to another published entry
                            // of this package are re-exported via that entry's
                            // dist specifier instead of being inlined, so the
                            // barrel and the subpath entry expose the SAME
                            // declarations (no TS2308 ambiguity for consumers
                            // star-exporting both).
                            if (!path.isAbsolute(source) && source.startsWith('.')) {
                                const resolved = await this.resolve(source, importer, {
                                    skipSelf: true,
                                });
                                const resolvedId =
                                    typeof resolved === 'string' ? resolved : resolved?.id;
                                if (resolvedId) {
                                    const relative = path
                                        .relative(packageDir, resolvedId)
                                        .replace(/\\/g, '/');
                                    const entryName = entryNamesByRelativePath.get(relative);
                                    if (entryName) {
                                        return {
                                            id: entryDistSpecifier(name, entryName),
                                            external: true,
                                        };
                                    }

                                    // The barrel itself is the canonical inlined
                                    // copy; only subpath entries route shared
                                    // declarations elsewhere.
                                    if (name !== 'index') {
                                        const clauseNames = entryGraphs
                                            .get(name)
                                            ?.namesByModule.get(resolvedId);
                                        if (clauseNames && clauseNames.size > 0) {
                                            if (
                                                barrelInlinedSurface &&
                                                [...clauseNames].every((clauseName) =>
                                                    barrelInlinedSurface.surfaceNames.has(
                                                        clauseName
                                                    )
                                                )
                                            ) {
                                                return {
                                                    id: packageRootSpecifier,
                                                    external: true,
                                                };
                                            }
                                            const ownerEntry = findCanonicalOwnerEntry(
                                                resolvedId,
                                                clauseNames
                                            );
                                            if (ownerEntry && ownerEntry !== name) {
                                                return {
                                                    id: entryDistSpecifier(name, ownerEntry),
                                                    external: true,
                                                };
                                            }
                                        }
                                    }
                                }
                            }

                            return null;
                        },
                    },
                },
                dts({
                    tsconfig: packageTsconfigPath,
                }),
            ],
        })),
    ];
};
