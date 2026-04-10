import fs from 'node:fs';
import path from 'node:path';

const normalizeWorkspacePath = (filePath) => filePath.replace(/\\/g, '/');

const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const readWorkspacePackageDirectories = (workspaceDir) => {
    const packagesDir = path.resolve(workspaceDir, 'packages');
    if (!fs.existsSync(packagesDir)) {
        return [];
    }

    return fs
        .readdirSync(packagesDir, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name);
};

const readWorkspacePackages = (workspaceDir) => {
    const packages = [];

    for (const packageDirName of readWorkspacePackageDirectories(workspaceDir)) {
        const packageDir = path.resolve(workspaceDir, 'packages', packageDirName);
        const packageJsonPath = path.resolve(packageDir, 'package.json');
        if (!fs.existsSync(packageJsonPath)) {
            continue;
        }

        const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
        if (typeof packageJson.name !== 'string') {
            continue;
        }

        packages.push({
            name: packageJson.name,
            srcDir: normalizeWorkspacePath(path.resolve(packageDir, 'src')),
        });
    }

    return packages.sort((left, right) => left.name.localeCompare(right.name));
};

export const createWorkspacePackageAliasMap = (workspaceDir) => {
    const aliases = {};

    for (const workspacePackage of readWorkspacePackages(workspaceDir)) {
        aliases[workspacePackage.name] = `${workspacePackage.srcDir}/index.ts`;
    }

    return aliases;
};

export const createWorkspacePackageAliasEntries = (workspaceDir) =>
    readWorkspacePackages(workspaceDir).flatMap((workspacePackage) => [
        {
            find: new RegExp(`^${escapeRegExp(workspacePackage.name)}$`),
            replacement: `${workspacePackage.srcDir}/index.ts`,
        },
        {
            find: new RegExp(`^${escapeRegExp(workspacePackage.name)}/(.+)$`),
            replacement: `${workspacePackage.srcDir}/$1`,
        },
    ]);

export const listWorkspacePackageNames = (workspaceDir) =>
    readWorkspacePackages(workspaceDir).map((workspacePackage) => workspacePackage.name);