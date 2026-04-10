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

type ModuleNamespace = Record<string, unknown>;

type ParsedImportSpecifier = {
    readonly importedName: string;
    readonly localName: string;
    readonly isTypeOnly: boolean;
};

const coreImportPattern = /import\s*\{([\s\S]*?)\}\s*from\s*['"]@axrone\/core['"]\s*;?/m;
const numericImportPattern = /import\s*\{([\s\S]*?)\}\s*from\s*['"]@axrone\/numeric['"]\s*;?/m;
const namedImportPattern = /import\s*\{([\s\S]*?)\}\s*from\s*['"]([^'"]+)['"]\s*;?/g;
const firstImportPattern = /import[\s\S]*?from\s*['"][^'"]+['"]\s*;?/m;

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

export const normalizePlaygroundSource = (source: string): string => {
    const coreImportMatch = coreImportPattern.exec(source);
    if (!coreImportMatch) {
        return source;
    }

    const coreSpecifiers = parseImportSpecifiers(coreImportMatch[1]);
    const movedNumericSpecifiers = coreSpecifiers.filter(
        (specifier) => !specifier.isTypeOnly && numericRuntimeExports.has(specifier.importedName)
    );

    if (movedNumericSpecifiers.length === 0) {
        return source;
    }

    const remainingCoreSpecifiers = coreSpecifiers.filter(
        (specifier) => !movedNumericSpecifiers.includes(specifier)
    );

    let nextSource = source;
    const nextCoreDeclaration = remainingCoreSpecifiers.length
        ? renderNamedImport('@axrone/core', remainingCoreSpecifiers)
        : '';

    nextSource = nextSource.replace(coreImportMatch[0], nextCoreDeclaration);

    const numericImportMatch = numericImportPattern.exec(nextSource);
    const existingNumericSpecifiers = numericImportMatch
        ? parseImportSpecifiers(numericImportMatch[1])
        : [];
    const nextNumericDeclaration = renderNamedImport(
        '@axrone/numeric',
        mergeImportSpecifiers(existingNumericSpecifiers, movedNumericSpecifiers)
    );

    if (numericImportMatch) {
        nextSource = nextSource.replace(numericImportMatch[0], nextNumericDeclaration);
    } else {
        const insertionIndex = findImportInsertionIndex(nextSource, nextCoreDeclaration);
        const prefix = nextSource.slice(0, insertionIndex);
        const suffix = nextSource.slice(insertionIndex);
        const needsLeadingNewline = prefix.length > 0 && !prefix.endsWith('\n');
        const normalizedSuffix = suffix.startsWith('\n') || suffix.length === 0 ? suffix : `\n${suffix}`;

        nextSource = `${prefix}${needsLeadingNewline ? '\n' : ''}${nextNumericDeclaration}${normalizedSuffix}`;
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

            diagnostics.push(
                `Module "${moduleName}" does not export "${specifier.importedName}".`
            );
        }
    }

    return diagnostics;
};
