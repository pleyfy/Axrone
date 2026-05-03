import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const workspaceDir = path.resolve(scriptDir, '..');
const reportDir = path.resolve(workspaceDir, '.tmp', 'duplicate-governance');
const reportFilePath = path.resolve(reportDir, 'jscpd-report.json');
const jscpdEntryPath = path.resolve(workspaceDir, 'node_modules', 'jscpd', 'bin', 'jscpd');
const jscpdIgnoreGlobs = [
    '**/dist/**',
    '**/__tests__/**',
    '**/*.d.ts',
    '**/*.test.ts',
    '**/*.spec.ts',
];
const approvedCrossPackageDebt = [
    {
        files: [
            'packages/asset-gltf/src/value-serialization.ts',
            'packages/scene-runtime/src/serialization.ts',
        ],
        maxLines: 52,
        reason: 'Pending extraction of shared scene/gltf serialized value encoding contracts.',
    },
    {
        files: [
            'packages/asset-gltf/src/asset-ir.ts',
            'packages/scene-runtime/src/types.ts',
        ],
        maxLines: 40,
        reason: 'Pending extraction of shared scene/gltf texture source and binding contracts.',
    },
];

const normalizePath = (filePath) => filePath.replace(/\\/g, '/');

const createFilePairKey = (firstFile, secondFile) =>
    [normalizePath(firstFile), normalizePath(secondFile)].sort((left, right) => left.localeCompare(right)).join(' :: ');

const approvedCrossPackageDebtByPair = new Map(
    approvedCrossPackageDebt.map((entry) => [createFilePairKey(entry.files[0], entry.files[1]), entry])
);

const getPackageName = (filePath) => normalizePath(filePath).split('/')[1] ?? 'unknown';

const groupBy = (items, createKey) => {
    const groups = new Map();

    for (const item of items) {
        const key = createKey(item);
        const existing = groups.get(key);
        if (existing) {
            existing.push(item);
            continue;
        }

        groups.set(key, [item]);
    }

    return groups;
};

const formatPercent = (value) => `${Number(value).toFixed(2)}%`;

const formatRange = (item, side) =>
    `${item[`${side}File`]}:${item[`${side}StartLine`]}-${item[`${side}EndLine`]}`;

const toDuplicateRecord = (duplicate) => {
    const firstFile = normalizePath(duplicate.firstFile.name);
    const secondFile = normalizePath(duplicate.secondFile.name);

    return {
        lines: Number(duplicate.lines),
        firstFile,
        secondFile,
        firstStartLine: Number(duplicate.firstFile.startLoc.line),
        firstEndLine: Number(duplicate.firstFile.endLoc.line),
        secondStartLine: Number(duplicate.secondFile.startLoc.line),
        secondEndLine: Number(duplicate.secondFile.endLoc.line),
        firstPackage: getPackageName(firstFile),
        secondPackage: getPackageName(secondFile),
        filePairKey: createFilePairKey(firstFile, secondFile),
    };
};

const summarizeDuplicatePair = (items) => {
    const lines = items.reduce((total, item) => total + item.lines, 0);
    const exemplar = items[0];

    return {
        lines,
        count: items.length,
        firstFile: exemplar.firstFile,
        secondFile: exemplar.secondFile,
        firstPackage: exemplar.firstPackage,
        secondPackage: exemplar.secondPackage,
        filePairKey: exemplar.filePairKey,
        ranges: items
            .map((item) => ({
                first: formatRange(item, 'first'),
                second: formatRange(item, 'second'),
                lines: item.lines,
            }))
            .sort((left, right) => right.lines - left.lines),
    };
};

const printDuplicateGroup = (heading, groups, decorateSummary) => {
    if (groups.length === 0) {
        console.log(`\n${heading}`);
        console.log('None');
        return;
    }

    console.log(`\n${heading}`);
    for (const group of groups) {
        const summary = decorateSummary(group);
        console.log(`- ${summary}`);
        for (const range of group.ranges) {
            console.log(`  ${range.lines} lines | ${range.first} <-> ${range.second}`);
        }
    }
};

const runJscpd = () => {
    if (!fs.existsSync(jscpdEntryPath)) {
        throw new Error(
            'Missing local jscpd binary. Run "npm install" from Axrone/web to install duplicate-governance dependencies.'
        );
    }

    fs.rmSync(reportDir, { recursive: true, force: true });
    fs.mkdirSync(reportDir, { recursive: true });

    const result = spawnSync(
        process.execPath,
        [
            jscpdEntryPath,
            '--silent',
            '--min-lines',
            '20',
            '--min-tokens',
            '120',
            '--format',
            'typescript',
            '--ignore',
            jscpdIgnoreGlobs.join(','),
            '--reporters',
            'json',
            '--output',
            reportDir,
            'packages',
        ],
        {
            cwd: workspaceDir,
            encoding: 'utf8',
        }
    );

    if (result.error || result.status !== 0) {
        const errorOutput =
            result.error?.message ||
            result.stderr?.trim() ||
            result.stdout?.trim() ||
            'Unknown jscpd failure';
        throw new Error(`jscpd scan failed: ${errorOutput}`);
    }

    if (!fs.existsSync(reportFilePath)) {
        throw new Error(`Expected jscpd report at ${reportFilePath}, but no report was generated.`);
    }

    return JSON.parse(fs.readFileSync(reportFilePath, 'utf8'));
};

const report = runJscpd();
const summary = report.statistics.formats.typescript.total;
const duplicates = report.duplicates.map(toDuplicateRecord).sort((left, right) => right.lines - left.lines);
const crossPackageDuplicates = duplicates.filter((duplicate) => duplicate.firstPackage !== duplicate.secondPackage);
const crossPackageGroups = [...groupBy(crossPackageDuplicates, (duplicate) => duplicate.filePairKey).values()]
    .map(summarizeDuplicatePair)
    .map((group) => {
        const allowance = approvedCrossPackageDebtByPair.get(group.filePairKey);

        return {
            ...group,
            allowance,
            isApproved: Boolean(allowance) && group.lines <= allowance.maxLines,
        };
    })
    .sort((left, right) => right.lines - left.lines || left.filePairKey.localeCompare(right.filePairKey));

const samePackageCrossFileGroups = [
    ...groupBy(
        duplicates.filter(
            (duplicate) =>
                duplicate.firstPackage === duplicate.secondPackage && duplicate.firstFile !== duplicate.secondFile
        ),
        (duplicate) => `${duplicate.firstPackage} :: ${duplicate.filePairKey}`
    ).values(),
]
    .map(summarizeDuplicatePair)
    .sort((left, right) => right.lines - left.lines || left.filePairKey.localeCompare(right.filePairKey));

const unexpectedCrossPackageGroups = crossPackageGroups.filter(
    (group) => !group.allowance || group.lines > group.allowance.maxLines
);
const resolvedApprovedDebt = approvedCrossPackageDebt.filter(
    (entry) => !crossPackageGroups.some((group) => group.filePairKey === createFilePairKey(entry.files[0], entry.files[1]))
);

console.log('Duplicate governance report');
console.log(
    `Sources: ${summary.sources}  Exact clones: ${summary.clones}  Duplicated lines: ${summary.duplicatedLines} (${formatPercent(summary.percentage)})`
);

printDuplicateGroup(
    'Approved cross-package duplicate debt',
    crossPackageGroups.filter((group) => group.isApproved),
    (group) =>
        `${group.firstPackage} <-> ${group.secondPackage} | ${group.lines} lines across ${group.count} clone blocks | ${group.allowance.reason}`
);

if (resolvedApprovedDebt.length > 0) {
    console.log('\nResolved approved duplicate debt');
    for (const entry of resolvedApprovedDebt) {
        console.log(`- ${entry.files[0]} <-> ${entry.files[1]}`);
    }
}

printDuplicateGroup(
    'Highest same-package cross-file hotspots',
    samePackageCrossFileGroups.slice(0, 8),
    (group) => `${group.firstPackage} | ${group.lines} duplicated lines across ${group.count} clone blocks`
);

if (unexpectedCrossPackageGroups.length > 0) {
    printDuplicateGroup(
        'Unexpected cross-package duplicate violations',
        unexpectedCrossPackageGroups,
        (group) => `${group.firstPackage} <-> ${group.secondPackage} | ${group.lines} duplicated lines across ${group.count} clone blocks`
    );
    process.exit(1);
}

console.log('\nDuplicate governance checks satisfied.');