import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const workspaceDir = path.resolve(scriptDir, '..');
const packagesDir = path.resolve(workspaceDir, 'packages');

const readPackageJson = (packageDir) => {
    const packageJsonPath = path.resolve(packagesDir, packageDir, 'package.json');
    return JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
};

const resolveImportTarget = (exportTarget) => {
    if (typeof exportTarget === 'string') {
        return exportTarget;
    }

    if (!exportTarget || typeof exportTarget !== 'object' || Array.isArray(exportTarget)) {
        return null;
    }

    if (typeof exportTarget.import === 'string') {
        return exportTarget.import;
    }

    if (typeof exportTarget.default === 'string') {
        return exportTarget.default;
    }

    if (typeof exportTarget.require === 'string') {
        return exportTarget.require;
    }

    for (const nestedTarget of Object.values(exportTarget)) {
        const resolvedTarget = resolveImportTarget(nestedTarget);
        if (resolvedTarget) {
            return resolvedTarget;
        }
    }

    return null;
};

const createWorkspaceImportMap = () => {
    const importMap = {};

    for (const entry of fs.readdirSync(packagesDir, { withFileTypes: true })) {
        if (!entry.isDirectory()) {
            continue;
        }

        const packageDir = entry.name;
        const packageRoot = path.resolve(packagesDir, packageDir);
        const packageJson = readPackageJson(packageDir);
        const packageName = packageJson.name;

        if (typeof packageName !== 'string' || !packageName.startsWith('@axrone/')) {
            continue;
        }

        const addImportTarget = (specifier, relativeTarget) => {
            if (typeof relativeTarget !== 'string') {
                return;
            }

            const absoluteTarget = path.resolve(packageRoot, relativeTarget);
            if (!fs.existsSync(absoluteTarget)) {
                return;
            }

            importMap[specifier] = pathToFileURL(absoluteTarget).href;
        };

        const exportsField = packageJson.exports;
        if (exportsField && typeof exportsField === 'object' && !Array.isArray(exportsField)) {
            addImportTarget(
                packageName,
                resolveImportTarget(exportsField['.']) ?? packageJson.module ?? packageJson.main,
            );

            for (const [subpath, exportTarget] of Object.entries(exportsField)) {
                if (!subpath.startsWith('./')) {
                    continue;
                }

                addImportTarget(`${packageName}/${subpath.slice(2)}`, resolveImportTarget(exportTarget));
            }

            continue;
        }

        addImportTarget(packageName, packageJson.module ?? packageJson.main ?? './dist/index.mjs');
    }

    return importMap;
};

const workspaceImportMap = createWorkspaceImportMap();

const runtimeProfileBudgets = [
    {
        packageDir: 'runtime-profile-core',
        packageName: '@axrone/runtime-profile-core',
        expectedDependencies: ['@axrone/input-core', '@axrone/scene-runtime'],
        maxEntryBytes: 2048,
        maxStartupMs: 80,
        maxHeapDeltaKb: 6144,
    },
    {
        packageDir: 'runtime-profile-2d',
        packageName: '@axrone/runtime-profile-2d',
        expectedDependencies: [
            '@axrone/asset-2d',
            '@axrone/input-core',
            '@axrone/physics-2d',
            '@axrone/physics-core',
            '@axrone/render-2d',
            '@axrone/scene-2d',
            '@axrone/scene-runtime',
        ],
        maxEntryBytes: 2048,
        maxStartupMs: 200,
        maxHeapDeltaKb: 16384,
    },
    {
        packageDir: 'runtime-profile-3d',
        packageName: '@axrone/runtime-profile-3d',
        expectedDependencies: [
            '@axrone/asset-core',
            '@axrone/asset-gltf',
            '@axrone/input-core',
            '@axrone/physics-3d',
            '@axrone/physics-core',
            '@axrone/render-3d',
            '@axrone/render-webgl2',
            '@axrone/scene-3d',
            '@axrone/scene-runtime',
        ],
        maxEntryBytes: 2048,
        maxStartupMs: 320,
        maxHeapDeltaKb: 28672,
    },
    {
        packageDir: 'runtime-profile-full',
        packageName: '@axrone/runtime-profile-full',
        expectedDependencies: [
            '@axrone/asset-2d',
            '@axrone/asset-core',
            '@axrone/asset-gltf',
            '@axrone/input-core',
            '@axrone/physics-2d',
            '@axrone/physics-3d',
            '@axrone/physics-core',
            '@axrone/render-2d',
            '@axrone/render-3d',
            '@axrone/render-webgl2',
            '@axrone/scene-2d',
            '@axrone/scene-3d',
            '@axrone/scene-runtime',
        ],
        maxEntryBytes: 4096,
        maxStartupMs: 400,
        maxHeapDeltaKb: 32768,
    },
];

const readDependencyKeys = (packageDir) => {
    const packageJson = readPackageJson(packageDir);
    return Object.keys(packageJson.dependencies ?? {}).sort((left, right) =>
        left.localeCompare(right),
    );
};

const resolveEntryPath = (packageDir) => {
    const entryPath = path.resolve(packagesDir, packageDir, 'dist', 'index.mjs');
    if (!fs.existsSync(entryPath)) {
        throw new Error(
            `Missing built entry for ${packageDir}. Run \"npm run build\" before runtime-profile governance.`,
        );
    }

    return entryPath;
};

const measureColdImport = (entryPath) => {
    const moduleUrl = pathToFileURL(entryPath).href;
    const childScript = `
        import { registerHooks } from 'node:module';
        import { performance } from 'node:perf_hooks';

        const workspaceImportMap = ${JSON.stringify(workspaceImportMap)};

        registerHooks({
            resolve(specifier, context, nextResolve) {
                const resolvedUrl = workspaceImportMap[specifier];
                if (typeof resolvedUrl === 'string') {
                    return {
                        shortCircuit: true,
                        url: resolvedUrl,
                    };
                }

                return nextResolve(specifier, context);
            },
        });

        let nextWebGl2Constant = 0x2000;

        if (!globalThis.WebGL2RenderingContext) {
            globalThis.WebGL2RenderingContext = new Proxy(class WebGL2RenderingContext {}, {
                get(target, property, receiver) {
                    if (typeof property === 'string' && !(property in target)) {
                        Reflect.set(target, property, nextWebGl2Constant++);
                    }

                    return Reflect.get(target, property, receiver);
                },
            });
        }

        if (!globalThis.ImageBitmap) {
            globalThis.ImageBitmap = class ImageBitmap {};
        }

        if (!globalThis.ImageData) {
            globalThis.ImageData = class ImageData {};
        }

        const beforeHeapUsed = process.memoryUsage().heapUsed;
        const startedAt = performance.now();
        await import(${JSON.stringify(moduleUrl)} + '?governance=' + Date.now() + Math.random());
        const startupMs = performance.now() - startedAt;
        const heapDeltaKb = (process.memoryUsage().heapUsed - beforeHeapUsed) / 1024;

        console.log(JSON.stringify({ startupMs, heapDeltaKb }));
    `;

    const result = spawnSync(process.execPath, ['--input-type=module', '--eval', childScript], {
        cwd: workspaceDir,
        encoding: 'utf8',
    });

    if (result.status !== 0) {
        const errorOutput = result.stderr.trim() || result.stdout.trim() || 'Unknown error';
        throw new Error(`Cold import measurement failed for ${entryPath}: ${errorOutput}`);
    }

    return JSON.parse(result.stdout.trim());
};

const formatNumber = (value) => value.toFixed(2).padStart(8, ' ');

const reportRows = [];
const failures = [];

for (const profile of runtimeProfileBudgets) {
    const entryPath = resolveEntryPath(profile.packageDir);
    const entryBytes = fs.statSync(entryPath).size;
    const dependencyKeys = readDependencyKeys(profile.packageDir);
    const coldImport = measureColdImport(entryPath);

    reportRows.push({
        packageName: profile.packageName,
        entryBytes,
        startupMs: coldImport.startupMs,
        heapDeltaKb: coldImport.heapDeltaKb,
        dependencyCount: dependencyKeys.length,
    });

    if (entryBytes > profile.maxEntryBytes) {
        failures.push(
            `${profile.packageName} entry size ${entryBytes} bytes exceeds budget ${profile.maxEntryBytes} bytes.`,
        );
    }

    if (coldImport.startupMs > profile.maxStartupMs) {
        failures.push(
            `${profile.packageName} cold startup ${coldImport.startupMs.toFixed(2)} ms exceeds budget ${profile.maxStartupMs} ms.`,
        );
    }

    if (coldImport.heapDeltaKb > profile.maxHeapDeltaKb) {
        failures.push(
            `${profile.packageName} heap delta ${coldImport.heapDeltaKb.toFixed(2)} KB exceeds budget ${profile.maxHeapDeltaKb} KB.`,
        );
    }

    const expectedDependencies = [...profile.expectedDependencies].sort((left, right) =>
        left.localeCompare(right),
    );
    if (
        dependencyKeys.length !== expectedDependencies.length ||
        dependencyKeys.some((dependency, index) => dependency !== expectedDependencies[index])
    ) {
        failures.push(
            `${profile.packageName} dependency graph drifted. Expected ${expectedDependencies.join(', ')}, received ${dependencyKeys.join(', ')}.`,
        );
    }
}

console.log('Runtime profile governance report');
console.log('Package'.padEnd(32) + 'Entry'.padStart(8) + '  ' + 'Startup'.padStart(10) + '  ' + 'Heap'.padStart(10) + '  ' + 'Deps'.padStart(6));
for (const row of reportRows) {
    console.log(
        row.packageName.padEnd(32) +
            String(row.entryBytes).padStart(8) +
            '  ' +
            formatNumber(row.startupMs) +
            '  ' +
            formatNumber(row.heapDeltaKb) +
            '  ' +
            String(row.dependencyCount).padStart(6),
    );
}

if (failures.length > 0) {
    console.error('\nRuntime profile governance violations');
    for (const failure of failures) {
        console.error(`- ${failure}`);
    }

    process.exit(1);
}

console.log('\nRuntime profile governance budgets satisfied.');