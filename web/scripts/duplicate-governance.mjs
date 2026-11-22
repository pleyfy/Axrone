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
    '**/vitest.config.ts',
];

// ── GLSL-in-string extraction ────────────────────────────────────────────────
// Extracts template-literal / string contents that look like GLSL from .ts
// sources, writes them to a temp dir as pseudo-.glsl files, and runs a
// dedicated jscpd pass over them.
const glslMarkerPattern = /(?:#version\s|precision\s+(?:low|med|high)p|\bvec[234]\b|\bfloat\s+\w+\s*\(|\bmat[234]\b|\bu?ivec[234]\b|\bsampler(?:2D|3D|Cube)\b|\bvoid\s+main\s*\(\s*\)\s*\{|\bin\s+(?:vec[234]|mat[234]|float|int|u?ivec[234])\s+\w+)/;
const templateLiteralPattern = /`([^`]*?)`/gs;
const glslScanPackages = ['packages/ui', 'packages/ui-webgl2'];
const glslTempDir = path.resolve(workspaceDir, '.tmp', 'duplicate-governance', 'glsl-extracts');

const extractGlslStrings = () => {
    fs.rmSync(glslTempDir, { recursive: true, force: true });
    fs.mkdirSync(glslTempDir, { recursive: true });

    let extractedCount = 0;
    const walk = (dir) => {
        if (!fs.existsSync(dir)) return;
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            const fullPath = path.resolve(dir, entry.name);
            if (entry.isDirectory()) {
                walk(fullPath);
                continue;
            }
            if (!entry.isFile() || !entry.name.endsWith('.ts') || entry.name.endsWith('.d.ts')) continue;
            if (entry.name.includes('.test.') || entry.name.includes('.spec.')) continue;
            if (fullPath.includes('__tests__')) continue;

            const content = fs.readFileSync(fullPath, 'utf8');
            let match;
            templateLiteralPattern.lastIndex = 0;
            while ((match = templateLiteralPattern.exec(content)) !== null) {
                const body = match[1];
                if (glslMarkerPattern.test(body)) {
                    const safeName = `${path.relative(workspaceDir, fullPath).replace(/[\/\\.]/g, '_')}_${extractedCount}.glsl`;
                    fs.writeFileSync(path.resolve(glslTempDir, safeName), body);
                    extractedCount++;
                }
            }
        }
    };

    for (const pkg of glslScanPackages) {
        walk(path.resolve(workspaceDir, pkg, 'src'));
    }

    return extractedCount;
};

const runJscpdOnGlsl = () => {
    const glslFiles = fs.existsSync(glslTempDir) ? fs.readdirSync(glslTempDir).filter((f) => f.endsWith('.glsl')) : [];
    if (glslFiles.length === 0) {
        console.log('\nGLSL duplicate scan: no GLSL strings extracted, skipping.');
        return { duplicates: [], statistics: { formats: { glsl: { total: { sources: 0, clones: 0, duplicatedLines: 0, percentage: '0.00%' } } } } };
    }

    const glslReportDir = path.resolve(workspaceDir, '.tmp', 'duplicate-governance', 'glsl-report');
    const glslReportFile = path.resolve(glslReportDir, 'jscpd-report.json');
    fs.rmSync(glslReportDir, { recursive: true, force: true });
    fs.mkdirSync(glslReportDir, { recursive: true });

    const result = spawnSync(
        process.execPath,
        [
            jscpdEntryPath,
            '--silent',
            '--min-lines', '10',
            '--min-tokens', '60',
            '--format', 'typescript',
            '--reporters', 'json',
            '--output', glslReportDir,
            glslTempDir,
        ],
        { cwd: workspaceDir, encoding: 'utf8' }
    );

    if (result.error || result.status !== 0) {
        const errorOutput = result.error?.message || result.stderr?.trim() || result.stdout?.trim() || 'Unknown jscpd failure';
        throw new Error(`GLSL jscpd scan failed: ${errorOutput}`);
    }

    if (!fs.existsSync(glslReportFile)) {
        return { duplicates: [], statistics: { formats: { glsl: { total: { sources: glslFiles.length, clones: 0, duplicatedLines: 0, percentage: '0.00%' } } } } };
    }

    return JSON.parse(fs.readFileSync(glslReportFile, 'utf8'));
};

// ── Lowered-threshold jscpd pass for ui packages ─────────────────────────────
const runJscpdUiLowered = () => {
    const uiReportDir = path.resolve(workspaceDir, '.tmp', 'duplicate-governance', 'ui-lowered-report');
    const uiReportFile = path.resolve(uiReportDir, 'jscpd-report.json');
    fs.rmSync(uiReportDir, { recursive: true, force: true });
    fs.mkdirSync(uiReportDir, { recursive: true });

    const result = spawnSync(
        process.execPath,
        [
            jscpdEntryPath,
            '--silent',
            '--min-lines', '10',
            '--min-tokens', '60',
            '--format', 'typescript',
            '--ignore', jscpdIgnoreGlobs.join(','),
            '--reporters', 'json',
            '--output', uiReportDir,
            'packages/ui/src',
            'packages/ui-webgl2/src',
        ],
        { cwd: workspaceDir, encoding: 'utf8' }
    );

    if (result.error || result.status !== 0) {
        const errorOutput = result.error?.message || result.stderr?.trim() || result.stdout?.trim() || 'Unknown jscpd failure';
        throw new Error(`UI lowered-threshold jscpd scan failed: ${errorOutput}`);
    }

    if (!fs.existsSync(uiReportFile)) {
        return { duplicates: [], statistics: { formats: { typescript: { total: { sources: 0, clones: 0, duplicatedLines: 0, percentage: '0.00%' } } } } };
    }

    return JSON.parse(fs.readFileSync(uiReportFile, 'utf8'));
};

const approvedCrossPackageDebt = [
    {
        files: [
            'packages/asset-gltf/src/asset-ir.ts',
            'packages/scene-runtime/src/types.ts',
        ],
        maxLines: 40,
        reason: 'Pending extraction of shared scene/gltf texture source and binding contracts.',
    },
    {
        files: [
            'packages/physics-2d/src/core/broadphase.ts',
            'packages/physics-3d/src/core/broadphase-3d.ts',
        ],
        maxLines: 110,
        reason: 'Approved debt: DynamicAABBTree2D/3D simulation kernels stay per-dimension packages; the raycast subsystem extraction (@axrone/raycast, plan 2.2) confirmed these are distinct simulation trees, consolidation deferred.',
    },
    {
        files: [
            'packages/scene-2d/src/errors.ts',
            'packages/scene-3d/src/errors.ts',
        ],
        maxLines: 10,
        reason: 'Approved debt: scene-2d/scene-3d are thin facade packages over scene-runtime; errors.ts re-exports the same 8 error classes. Consolidation pending shared SceneCapabilityGuard extraction (P1-5).',
    },
];

const normalizePath = (filePath) => filePath.replace(/\\/g, '/');

const createFilePairKey = (firstFile, secondFile) =>
    [normalizePath(firstFile), normalizePath(secondFile)].sort((left, right) => left.localeCompare(right)).join(' :: ');

const approvedCrossPackageDebtByPair = new Map(
    approvedCrossPackageDebt.map((entry) => [createFilePairKey(entry.files[0], entry.files[1]), entry])
);

// Approved same-package duplicate debt for the lowered-threshold ui pass.
const approvedUiLoweredDebt = [
    {
        files: ['packages/ui/src/controls/checkbox.ts', 'packages/ui/src/controls/toggle.ts'],
        maxLines: 75,
        reason: 'Checkbox/toggle share track/thumb layout scaffolding; intentionally divergent control semantics.',
    },
    {
        files: ['packages/ui/src/controls/segmented-controller.ts', 'packages/ui/src/controls/tab-controller.ts'],
        maxLines: 35,
        reason: 'Segmented/tab controllers share selection-indicator wiring; different container semantics.',
    },
    {
        files: ['packages/ui/src/controls/button.ts', 'packages/ui/src/controls/toggle.ts'],
        maxLines: 35,
        reason: 'Button/toggle share press-state visual scaffolding; divergent toggle-vs-momentary semantics.',
    },
    {
        files: ['packages/ui/src/controls/page-view.ts', 'packages/ui/src/controls/scroll-view.ts'],
        maxLines: 30,
        reason: 'Page-view/scroll-view share viewport clamping logic; different paging semantics.',
    },
    {
        files: ['packages/ui/src/controls/checkbox-controller.ts', 'packages/ui/src/controls/toggle-controller.ts'],
        maxLines: 25,
        reason: 'Checkbox/toggle controller share boolean-binding glue; divergent event wiring.',
    },
    {
        files: ['packages/ui/src/controls/radio-group-controller.ts', 'packages/ui/src/controls/segmented-controller.ts'],
        maxLines: 20,
        reason: 'Radio/segmented controller share single-selection dispatch; different visual contracts.',
    },
    {
        files: ['packages/ui/src/controls/progress-bar.ts', 'packages/ui/src/controls/slider.ts'],
        maxLines: 20,
        reason: 'Progress-bar/slider share range-clamping helpers; divergent interaction models.',
    },
];

const approvedUiLoweredDebtByPair = new Map(
    approvedUiLoweredDebt.map((entry) => [createFilePairKey(entry.files[0], entry.files[1]), entry])
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

// ── GLSL duplicate scan ──────────────────────────────────────────────────────
const glslExtracted = extractGlslStrings();
const glslReport = runJscpdOnGlsl();
const glslSummary = glslReport.statistics.formats?.glsl?.total ?? { sources: 0, clones: 0, duplicatedLines: 0, percentage: '0.00%' };
const glslDuplicates = (glslReport.duplicates ?? []).map(toDuplicateRecord).sort((left, right) => right.lines - left.lines);

const safePercent = (value) => {
    const num = Number(value);
    return Number.isFinite(num) ? `${num.toFixed(2)}%` : '0.00%';
};

console.log(`\nGLSL string duplicate scan: ${glslExtracted} strings extracted, ${glslSummary.clones} clones, ${glslSummary.duplicatedLines} duplicated lines (${safePercent(glslSummary.percentage)})`);

if (glslDuplicates.length > 0) {
    console.log('GLSL duplicate clusters:');
    for (const dup of glslDuplicates) {
        console.log(`  ${dup.lines} lines | ${dup.firstFile}:${dup.firstStartLine}-${dup.firstEndLine} <-> ${dup.secondFile}:${dup.secondStartLine}-${dup.secondEndLine}`);
    }
}

// ── Lowered-threshold ui pass ────────────────────────────────────────────────
const uiLowerReport = runJscpdUiLowered();
const uiLowerSummary = uiLowerReport.statistics.formats?.typescript?.total ?? { sources: 0, clones: 0, duplicatedLines: 0, percentage: '0.00%' };
const uiLowerDuplicates = (uiLowerReport.duplicates ?? []).map(toDuplicateRecord).sort((left, right) => right.lines - left.lines);

const uiLowerGroups = [...groupBy(
        uiLowerDuplicates.filter((dup) => dup.firstFile !== dup.secondFile),
        (dup) => dup.filePairKey
    ).values()]
    .map(summarizeDuplicatePair)
    .map((group) => {
        const allowance = approvedUiLoweredDebtByPair.get(group.filePairKey);
        return {
            ...group,
            allowance,
            isApproved: Boolean(allowance) && group.lines <= allowance.maxLines,
        };
    })
    .sort((left, right) => right.lines - left.lines);

const unexpectedUiGroups = uiLowerGroups.filter((group) => !group.allowance || group.lines > group.allowance.maxLines);

console.log(`\nUI lowered-threshold scan (min-lines 10, min-tokens 60): ${uiLowerSummary.clones} clones, ${uiLowerSummary.duplicatedLines} duplicated lines (${formatPercent(uiLowerSummary.percentage)})`);

printDuplicateGroup(
    'Approved UI lowered-threshold debt',
    uiLowerGroups.filter((group) => group.isApproved),
    (group) => `${group.firstFile} <-> ${group.secondFile} | ${group.lines} lines | ${group.allowance.reason}`
);

if (unexpectedUiGroups.length > 0) {
    printDuplicateGroup(
        'Unexpected UI duplicate violations (lowered thresholds)',
        unexpectedUiGroups,
        (group) => `${group.firstFile} <-> ${group.secondFile} | ${group.lines} duplicated lines across ${group.count} clone blocks`
    );
    process.exit(1);
}

console.log('\nDuplicate governance checks satisfied.');
