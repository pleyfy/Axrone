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

const geometryRuntimeExports = new Set([
    'AABB',
    'AABB2D',
    'AABB3D',
    'AABBError',
    'GeometryBuilder',
    'Octree',
    'QuadTree',
    'VERTEX_ATTRIBUTES',
    'createBox',
    'createCapsule',
    'createCircle',
    'createCone',
    'createCube',
    'createCylinder',
    'createGeometryLayout',
    'createGrid',
    'createIcosphere',
    'createPill',
    'createPlane',
    'createQuad',
    'createRing',
    'createRoundedBox',
    'createSphere',
    'createSpring',
    'createTorus',
    'createTorusKnot',
    'createTruncatedCone',
    'createTube',
    'createUVSphere',
    'createVertexAttribute',
    'getAttributeTypeSize',
]);

const ecsRuntimeExports = new Set([
    'Actor',
    'Component',
    'EntityError',
    'Hierarchy',
    'Transform',
    'World',
    'WorldActorRegistry',
    'WorldDiagnostics',
    'WorldError',
    'WorldEventRuntime',
    'WorldMetricsService',
    'WorldMutationRuntime',
    'WorldQueryExecutionRuntime',
    'WorldQueryRuntime',
    'WorldSingletonRegistry',
    'WorldStorageRuntime',
    'script',
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

const assetCoreRuntimeExports = new Set([
    'AssetDatabase',
    'AssetImportPipeline',
    'AssetImporter',
    'AssetImporterRegistry',
    'createAssetDatabase',
    'createAssetImportPipeline',
    'isAssetDatabaseSnapshot',
    'isAssetImporter',
]);

const sceneRuntimeExports = new Set([
    'Animator',
    'Camera',
    'PrefabNodeBinding',
]);

const renderWebgl2RuntimeExports = new Set([
    'FilterMode',
    'TextureDimension',
    'TextureFormat',
    'TextureUsage',
    'WrapMode',
]);

type ModuleNamespace = Record<string, unknown>;
type SupportedModules = Readonly<Record<string, ModuleNamespace>>;

type ParsedImportSpecifier = {
    readonly importedName: string;
    readonly localName: string;
    readonly isTypeOnly: boolean;
};

type CoreImportMigration = {
    readonly moduleName: string;
    readonly exportedNames: ReadonlySet<string>;
};

const defaultCoreImportMigrations: readonly CoreImportMigration[] = [
    {
        moduleName: '@axrone/asset-core',
        exportedNames: assetCoreRuntimeExports,
    },
    {
        moduleName: '@axrone/ecs-runtime',
        exportedNames: ecsRuntimeExports,
    },
    {
        moduleName: '@axrone/geometry',
        exportedNames: geometryRuntimeExports,
    },
    {
        moduleName: '@axrone/input',
        exportedNames: new Set(['InputSystem', 'createInputSystem']),
    },
    {
        moduleName: '@axrone/physics',
        exportedNames: new Set([
            'PhysicsWorld2D',
            'PhysicsWorld3D',
            'RaycastEngine2D',
            'RaycastEngine3D',
        ]),
    },
    {
        moduleName: '@axrone/render-webgl2',
        exportedNames: renderWebgl2RuntimeExports,
    },
    {
        moduleName: '@axrone/numeric',
        exportedNames: numericRuntimeExports,
    },
    {
        moduleName: '@axrone/scene-runtime',
        exportedNames: sceneRuntimeExports,
    },
    {
        moduleName: '@axrone/scene-3d',
        exportedNames: scene3DRuntimeExports,
    },
];

const coreImportMigrationPriority = [
    '@axrone/asset-core',
    '@axrone/scene-runtime-gltf',
    '@axrone/ecs-runtime',
    '@axrone/input',
    '@axrone/geometry',
    '@axrone/physics',
    '@axrone/render-webgl2',
    '@axrone/numeric',
    '@axrone/random',
    '@axrone/game-loop',
    '@axrone/particle-system',
    '@axrone/scene-runtime',
    '@axrone/scene-2d',
    '@axrone/scene-3d',
    '@axrone/runtime-profile-core',
    '@axrone/runtime-profile-2d',
    '@axrone/runtime-profile-3d',
    '@axrone/runtime-profile-full',
    '@axrone/ui-webgl2',
    '@axrone/ui',
    '@axrone/utility',
    '@axrone/asset-gltf',
] as const;

const coreImportPattern = /import\s*\{([\s\S]*?)\}\s*from\s*['"]@axrone\/core['"]\s*;?/m;
const namedImportPattern = /import\s*\{([\s\S]*?)\}\s*from\s*['"]([^'"]+)['"]\s*;?/g;
const firstImportPattern = /import[\s\S]*?from\s*['"][^'"]+['"]\s*;?/m;

const buildCoreImportMigrations = (
    supportedModules?: SupportedModules
): readonly CoreImportMigration[] => {
    const migrationSets = new Map<string, Set<string>>();

    for (const migration of defaultCoreImportMigrations) {
        migrationSets.set(migration.moduleName, new Set(migration.exportedNames));
    }

    if (supportedModules) {
        for (const moduleName of coreImportMigrationPriority) {
            const moduleNamespace = supportedModules[moduleName];
            if (!moduleNamespace) {
                continue;
            }

            const exportedNames = migrationSets.get(moduleName) ?? new Set<string>();
            for (const exportedName of Object.keys(moduleNamespace)) {
                exportedNames.add(exportedName);
            }
            migrationSets.set(moduleName, exportedNames);
        }
    }

    return coreImportMigrationPriority
        .map((moduleName) => ({
            moduleName,
            exportedNames: migrationSets.get(moduleName) ?? new Set<string>(),
        }))
        .filter((migration) => migration.exportedNames.size > 0);
};

const resolveOwnerModule = (
    importedName: string,
    migrations: readonly CoreImportMigration[]
): string | undefined =>
    migrations.find(({ exportedNames }) => exportedNames.has(importedName))?.moduleName;

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

const partitionCoreImportSpecifiers = (
    specifiers: readonly ParsedImportSpecifier[],
    migrations: readonly CoreImportMigration[]
) => {
    const migratedSpecifiersByModule = migrations
        .map(({ moduleName, exportedNames }) => ({
            moduleName,
            specifiers: specifiers.filter((specifier) => exportedNames.has(specifier.importedName)),
        }))
        .filter((migration) => migration.specifiers.length > 0);

    const remainingCoreSpecifiers = specifiers.filter(
        (specifier) =>
            !migrations.some(({ exportedNames }) => exportedNames.has(specifier.importedName))
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

export const normalizePlaygroundSource = (
    source: string,
    supportedModules?: SupportedModules
): string => {
    const coreImportMatch = coreImportPattern.exec(source);
    if (!coreImportMatch) {
        return source;
    }

    const migrations = buildCoreImportMigrations(supportedModules);
    const coreSpecifiers = parseImportSpecifiers(coreImportMatch[1]);
    const { migratedSpecifiersByModule, remainingCoreSpecifiers } =
        partitionCoreImportSpecifiers(coreSpecifiers, migrations);

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

    return nextSource.replace(/^\n+/, '').replace(/\n{3,}/g, '\n\n');
};

export const validateSupportedModuleImports = (
    source: string,
    supportedModules: SupportedModules
): readonly string[] => {
    const diagnostics: string[] = [];
    const migrations = buildCoreImportMigrations(supportedModules);

    for (const match of source.matchAll(namedImportPattern)) {
        const [, clause, moduleName] = match;
        const specifiers = parseImportSpecifiers(clause);

        for (const specifier of specifiers) {
            if (specifier.isTypeOnly) {
                continue;
            }

            if (moduleName === '@axrone/core') {
                const ownerModule = resolveOwnerModule(specifier.importedName, migrations);
                if (ownerModule) {
                    diagnostics.push(
                        `Module "${moduleName}" has been removed. Import "${specifier.importedName}" from "${ownerModule}" instead.`
                    );
                    continue;
                }

                diagnostics.push(
                    `Module "${moduleName}" has been removed. Import "${specifier.importedName}" from its owner package instead.`
                );
                continue;
            }

            if (!(moduleName in supportedModules)) {
                continue;
            }

            const moduleNamespace = supportedModules[moduleName]!;
            if (specifier.importedName in moduleNamespace) {
                continue;
            }

            diagnostics.push(
                `Module "${moduleName}" does not export "${specifier.importedName}".`
            );
        }
    }

    return diagnostics;
};
