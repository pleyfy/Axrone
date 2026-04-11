import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

export const isTestSourceFile = (filePath: string): boolean => {
    const normalized = filePath.replace(/\\/g, '/');
    return (
        normalized.includes('/__tests__/') ||
        normalized.endsWith('.test.ts') ||
        normalized.endsWith('.spec.ts')
    );
};

export const collectTypeScriptFiles = (
    dirPath: string,
    options: {
        readonly exclude?: (filePath: string) => boolean;
    } = {}
): readonly string[] => {
    if (!fs.existsSync(dirPath)) {
        return [];
    }

    const files: string[] = [];

    for (const entry of fs.readdirSync(dirPath, { withFileTypes: true })) {
        const fullPath = path.resolve(dirPath, entry.name);
        if (entry.isDirectory()) {
            files.push(...collectTypeScriptFiles(fullPath, options));
            continue;
        }

        if (!entry.isFile() || !entry.name.endsWith('.ts') || entry.name.endsWith('.d.ts')) {
            continue;
        }

        if (options.exclude?.(fullPath)) {
            continue;
        }

        files.push(fullPath);
    }

    return files;
};

export const listModuleSpecifiers = (filePath: string): readonly string[] => {
    const sourceText = fs.readFileSync(filePath, 'utf8');
    const sourceFile = ts.createSourceFile(
        filePath,
        sourceText,
        ts.ScriptTarget.Latest,
        false,
        ts.ScriptKind.TS
    );
    const specifiers = new Set<string>();

    const visit = (node: ts.Node): void => {
        if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
            specifiers.add(node.moduleSpecifier.text);
        }

        if (ts.isExportDeclaration(node) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
            specifiers.add(node.moduleSpecifier.text);
        }

        if (
            ts.isCallExpression(node) &&
            node.expression.kind === ts.SyntaxKind.ImportKeyword &&
            node.arguments.length > 0 &&
            ts.isStringLiteral(node.arguments[0])
        ) {
            specifiers.add(node.arguments[0].text);
        }

        ts.forEachChild(node, visit);
    };

    visit(sourceFile);

    return [...specifiers];
};

export const toWorkspaceRelativePath = (workspaceDir: string, filePath: string): string =>
    path.relative(workspaceDir, filePath).replace(/\\/g, '/');