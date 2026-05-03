import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = process.cwd();
const SOURCE_ROOTS = ['packages'];
const SKIPPED_DIRECTORIES = new Set([
    'dist',
    'node_modules',
    'coverage',
    '.git',
    '.turbo',
    '.vite',
]);

const TYPE_DECLARATION_RULES = [
    {
        name: 'Brand',
        pattern: /^\s*(?:export\s+)?type\s+Brand\b/m,
        replacement: "import type { Brand } from '@axrone/utility'",
    },
    {
        name: 'Nominal',
        pattern: /^\s*(?:export\s+)?type\s+Nominal\b/m,
        replacement: "import type { Nominal } from '@axrone/utility'",
    },
    {
        name: 'Primitive',
        pattern: /^\s*(?:export\s+)?type\s+Primitive\b/m,
        replacement: "import type { Primitive } from '@axrone/utility'",
    },
    {
        name: 'JsonPrimitive',
        pattern: /^\s*(?:export\s+)?type\s+JsonPrimitive\b/m,
        replacement: "import type { JsonPrimitive } from '@axrone/utility'",
    },
    {
        name: 'JsonObject',
        pattern: /^\s*(?:export\s+)?interface\s+JsonObject\b/m,
        replacement: "import type { JsonObject } from '@axrone/utility'",
    },
    {
        name: 'JsonArray',
        pattern: /^\s*(?:export\s+)?interface\s+JsonArray\b/m,
        replacement: "import type { JsonArray } from '@axrone/utility'",
    },
    {
        name: 'JsonValue',
        pattern: /^\s*(?:export\s+)?type\s+JsonValue\b/m,
        replacement: "import type { JsonValue } from '@axrone/utility'",
    },
    {
        name: 'TypedArray',
        pattern: /^\s*(?:export\s+)?type\s+TypedArray\b/m,
        replacement: "import type { TypedArray } from '@axrone/utility'",
    },
    {
        name: 'TypedArrayConstructor',
        pattern: /^\s*(?:export\s+)?type\s+TypedArrayConstructor\b/m,
        replacement: "import type { TypedArrayConstructor } from '@axrone/utility'",
    },
];

const VECTOR_ARITY = new Map([
    ['Vec2', 2],
    ['Vec3', 3],
    ['Vec4', 4],
    ['Quat', 4],
    ['Color', 4],
]);

const isSourceFile = (filePath) =>
    /\.(ts|tsx|mts|cts)$/.test(filePath) && !filePath.endsWith('.d.ts');

const toPosix = (filePath) => filePath.replaceAll('\\', '/');

const isSkippedPath = (absolutePath) => {
    const rel = toPosix(relative(ROOT, absolutePath));
    return rel.includes('/__tests__/') || rel.includes('/test/') || rel.includes('/tests/');
};

const allowsLocalCentralTypeDeclarations = (relativePath) =>
    relativePath.startsWith('packages/utility/src/') ||
    relativePath.startsWith('packages/memory/src/');

const collectSourceFiles = (directory) => {
    const files = [];

    const visit = (current) => {
        for (const entry of readdirSync(current)) {
            if (SKIPPED_DIRECTORIES.has(entry)) {
                continue;
            }

            const absolutePath = join(current, entry);
            const stat = statSync(absolutePath);
            if (stat.isDirectory()) {
                visit(absolutePath);
                continue;
            }

            if (stat.isFile() && isSourceFile(absolutePath) && !isSkippedPath(absolutePath)) {
                files.push(absolutePath);
            }
        }
    };

    visit(directory);
    return files;
};

const lineOf = (source, index) => source.slice(0, index).split(/\r?\n/u).length;

const splitTopLevelArguments = (source) => {
    const args = [];
    let depth = 0;
    let start = 0;

    for (let index = 0; index < source.length; index += 1) {
        const char = source[index];
        if (char === '(' || char === '[' || char === '{') {
            depth += 1;
            continue;
        }

        if (char === ')' || char === ']' || char === '}') {
            depth -= 1;
            continue;
        }

        if (char === ',' && depth === 0) {
            args.push(source.slice(start, index).trim());
            start = index + 1;
        }
    }

    args.push(source.slice(start).trim());
    return args;
};

const unwrapNumberCall = (arg) => {
    const match = /^Number\s*\(([\s\S]*)\)$/u.exec(arg.trim());
    return match ? match[1].trim() : arg.trim();
};

const simpleIndexedArgument = (arg, expectedIndex) => {
    const normalized = unwrapNumberCall(arg);
    const match = /^([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)\s*\[\s*(\d+)\s*\]$/u.exec(normalized);

    if (!match) {
        return null;
    }

    return Number(match[2]) === expectedIndex ? match[1] : null;
};

const findSimpleVectorConstructors = (source) => {
    const violations = [];
    const constructorPattern = /\bnew\s+(Vec2|Vec3|Vec4|Quat|Color)\s*\(/gu;
    let match;

    while ((match = constructorPattern.exec(source))) {
        const constructorName = match[1];
        const arity = VECTOR_ARITY.get(constructorName);
        const argsStart = constructorPattern.lastIndex;
        let depth = 1;
        let cursor = argsStart;

        for (; cursor < source.length; cursor += 1) {
            const char = source[cursor];
            if (char === '(') {
                depth += 1;
            } else if (char === ')') {
                depth -= 1;
                if (depth === 0) {
                    break;
                }
            }
        }

        if (depth !== 0) {
            continue;
        }

        const args = splitTopLevelArguments(source.slice(argsStart, cursor));
        if (args.length !== arity) {
            continue;
        }

        const sources = args.map((arg, index) => simpleIndexedArgument(arg, index));
        if (sources.every(Boolean) && new Set(sources).size === 1) {
            violations.push({
                index: match.index,
                constructorName,
                sourceName: sources[0],
            });
        }

        constructorPattern.lastIndex = cursor + 1;
    }

    return violations;
};

const files = SOURCE_ROOTS.flatMap((sourceRoot) => collectSourceFiles(join(ROOT, sourceRoot)));
const violations = [];

for (const file of files) {
    const relativePath = toPosix(relative(ROOT, file));
    const source = readFileSync(file, 'utf8');

    if (!allowsLocalCentralTypeDeclarations(relativePath)) {
        for (const rule of TYPE_DECLARATION_RULES) {
            const match = rule.pattern.exec(source);
            if (match) {
                violations.push({
                    file: relativePath,
                    line: lineOf(source, match.index),
                    message: `Local ${rule.name} declaration should use ${rule.replacement}.`,
                });
            }
        }
    }

    if (!relativePath.startsWith('packages/numeric/src/')) {
        for (const violation of findSimpleVectorConstructors(source)) {
            violations.push({
                file: relativePath,
                line: lineOf(source, violation.index),
                message: `Use ${violation.constructorName}.fromArray(${violation.sourceName}) instead of indexed constructor arguments.`,
            });
        }
    }
}

if (violations.length > 0) {
    console.error('Utility governance found reusable helpers that should be centralized:\n');
    for (const violation of violations) {
        console.error(`- ${violation.file}:${violation.line} ${violation.message}`);
    }
    process.exit(1);
}

console.log('Utility governance passed.');
