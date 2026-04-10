const numericRuntimeExports = new Set([
    'Color',
    'Mat2',
    'Mat3',
    'Mat4',
    'Quat',
    'Vec2',
    'Vec3',
    'Vec4',
]);

const scene3DRuntimeExports = new Set([
    'Camera',
    'DirectionalLight',
    'FilterMode',
    'MeshRenderer',
    'OrbitCameraController',
    'Scene',
    'TextureFormat',
    'WrapMode',
    'createUnlitColorShaderDefinition',
]);

type ModuleNamespace = Record<string, unknown>;

type ParsedImportSpecifier = {
    readonly importedName: string;
    readonly localName: string;
    readonly isTypeOnly: boolean;
};

type CoreImportMigration = {
    readonly moduleName: string;
    readonly exportedNames: ReadonlySet<string>;
};

const coreImportMigrations: readonly CoreImportMigration[] = [
    {
        moduleName: '@axrone/numeric',
        exportedNames: numericRuntimeExports,
    },
    {
        moduleName: '@axrone/scene-3d',
        exportedNames: scene3DRuntimeExports,
    },
];

const coreImportPattern = /import\s*\{([\s\S]*?)\}\s*from\s*['"]@axrone\/core['"]\s*;?/m;
const namedImportPattern = /import\s*\{([\s\S]*?)\}\s*from\s*['"]([^'"]+)['"]\s*;?/g;
const firstImportPattern = /import[\s\S]*?from\s*['"][^'"]+['"]\s*;?/m;

const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const parseImportSpecifiers = (clause: string): readonly ParsedImportSpecifier[] =>
    clause
        .split(',')
        .map((part) => part.trim())
        .filter((part) => part.length > 0)
        .map((part) => {
            const isTypeOnly = part.startsWith('type ');
            const normalizedPart = isTypeOnly ? part.slice(5).trim() : part;
            const aliasParts = normalizedPart.split(/\s+as\s+/);
            const importedName = aliasParts[0]?.trim() ?? '';
            const localName = aliasParts[1]?.trim() ?? importedName;

            return {
                importedName,
                localName,
                isTypeOnly,
            };
        })
        .filter((specifier) => specifier.importedName.length > 0);

const renderImportSpecifier = (specifier: ParsedImportSpecifier): string => {
    const aliasSuffix =
        specifier.localName !== specifier.importedName
            ? ` as ${specifier.localName}`
            : '';
    return `${specifier.isTypeOnly ? 'type ' : ''}${specifier.importedName}${aliasSuffix}`;
};

const renderNamedImport = (
    moduleName: string,
    specifiers: readonly ParsedImportSpecifier[]
): string => `import { ${specifiers.map(renderImportSpecifier).join(', ')} } from '${moduleName}';`;

const mergeImportSpecifiers = (
    ...specifierGroups: ReadonlyArray<readonly ParsedImportSpecifier[]>
): readonly ParsedImportSpecifier[] => {
    const merged: ParsedImportSpecifier[] = [];
    const seenKeys = new Set<string>();

    for (const specifiers of specifierGroups) {
        for (const specifier of specifiers) {
            const key = `${specifier.isTypeOnly ? 'type:' : 'value:'}${specifier.importedName}:${specifier.localName}`;
            if (seenKeys.has(key)) {
                continue;
            }

            seenKeys.add(key);
            merged.push(specifier);
        }
    }

    return merged;
};

const findImportInsertionIndex = (source: string, preferredAnchor: string): number => {
    if (preferredAnchor.length > 0) {
        const anchorIndex = source.indexOf(preferredAnchor);
        if (anchorIndex >= 0) {
            return anchorIndex + preferredAnchor.length;
        }
    }

    const firstImportMatch = firstImportPattern.exec(source);
    return firstImportMatch?.index ?? 0;
};

const partitionCoreImportSpecifiers = (specifiers: readonly ParsedImportSpecifier[]) => {
    const migratedSpecifiersByModule = coreImportMigrations
        .map(({ moduleName, exportedNames }) => ({
            moduleName,
            specifiers: specifiers.filter((specifier) => exportedNames.has(specifier.importedName)),
        }))
        .filter((migration) => migration.specifiers.length > 0);

    const remainingCoreSpecifiers = specifiers.filter(
        (specifier) =>
            !coreImportMigrations.some(({ exportedNames }) => exportedNames.has(specifier.importedName))
    );

    return {
        migratedSpecifiersByModule,
        remainingCoreSpecifiers,
    };
};

const upsertNamedImport = (
    source: string,
    moduleName: string,
    specifiers: readonly ParsedImportSpecifier[],
    preferredAnchor: string
) => {
    const importPattern = new RegExp(
        `import\\s*\\{([\\s\\S]*?)\\}\\s*from\\s*['"]${escapeRegExp(moduleName)}['"]\\s*;?`,
        'm'
    );
    const existingImportMatch = importPattern.exec(source);
    const nextDeclaration = renderNamedImport(moduleName, specifiers);

    if (existingImportMatch) {
        return {
            nextSource: source.replace(existingImportMatch[0], nextDeclaration),
            insertedDeclaration: nextDeclaration,
        };
    }

    const insertionIndex = findImportInsertionIndex(source, preferredAnchor);
    const prefix = source.slice(0, insertionIndex);
    const suffix = source.slice(insertionIndex);
    const needsLeadingNewline = prefix.length > 0 && !prefix.endsWith('\n');
    const normalizedSuffix = suffix.startsWith('\n') || suffix.length === 0 ? suffix : `\n${suffix}`;

    return {
        nextSource: `${prefix}${needsLeadingNewline ? '\n' : ''}${nextDeclaration}${normalizedSuffix}`,
        insertedDeclaration: nextDeclaration,
    };
};

export const normalizePlaygroundSource = (source: string): string => {
    const coreImportMatch = coreImportPattern.exec(source);
    if (!coreImportMatch) {
        return source;
    }

    const coreSpecifiers = parseImportSpecifiers(coreImportMatch[1]);
    const { migratedSpecifiersByModule, remainingCoreSpecifiers } =
        partitionCoreImportSpecifiers(coreSpecifiers);

    if (migratedSpecifiersByModule.length === 0) {
        return source;
    }

    let nextSource = source;
    const nextCoreDeclaration = remainingCoreSpecifiers.length
        ? renderNamedImport('@axrone/core', remainingCoreSpecifiers)
        : '';

    nextSource = nextSource.replace(coreImportMatch[0], nextCoreDeclaration);

    let preferredAnchor = nextCoreDeclaration;

    for (const migration of migratedSpecifiersByModule) {
        const importPattern = new RegExp(
            `import\\s*\\{([\\s\\S]*?)\\}\\s*from\\s*['"]${escapeRegExp(migration.moduleName)}['"]\\s*;?`,
            'm'
        );
        const existingImportMatch = importPattern.exec(nextSource);
        const existingSpecifiers = existingImportMatch
            ? parseImportSpecifiers(existingImportMatch[1])
            : [];
        const { nextSource: updatedSource, insertedDeclaration } = upsertNamedImport(
            nextSource,
            migration.moduleName,
            mergeImportSpecifiers(existingSpecifiers, migration.specifiers),
            preferredAnchor
        );

        nextSource = updatedSource;
        preferredAnchor = insertedDeclaration;
    }

    return nextSource.replace(/\n{3,}/g, '\n\n');
};

export const validateSupportedModuleImports = (
    source: string,
    supportedModules: Readonly<Record<string, ModuleNamespace>>
): readonly string[] => {
    const diagnostics: string[] = [];

    for (const match of source.matchAll(namedImportPattern)) {
        const [, clause, moduleName] = match;
        if (!(moduleName in supportedModules)) {
            continue;
        }

        const specifiers = parseImportSpecifiers(clause);
        const moduleNamespace = supportedModules[moduleName]!;

        for (const specifier of specifiers) {
            if (specifier.isTypeOnly) {
                continue;
            }

            if (specifier.importedName in moduleNamespace) {
                continue;
            }

            if (moduleName === '@axrone/core' && numericRuntimeExports.has(specifier.importedName)) {
                diagnostics.push(
                    `Module "${moduleName}" does not export "${specifier.importedName}". Import it from "@axrone/numeric" instead.`
                );
                continue;
            }

            if (moduleName === '@axrone/core' && scene3DRuntimeExports.has(specifier.importedName)) {
                diagnostics.push(
                    `Module "${moduleName}" does not export "${specifier.importedName}". Import it from "@axrone/scene-3d" instead.`
                );
                continue;
            }

            diagnostics.push(
                `Module "${moduleName}" does not export "${specifier.importedName}".`
            );
        }
    }

    return diagnostics;
};
