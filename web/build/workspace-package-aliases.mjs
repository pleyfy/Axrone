import fs from 'node:fs';
import path from 'node:path';

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

export const createWorkspacePackageAliasMap = (workspaceDir) => {
    const aliases = {};

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

        aliases[packageJson.name] = path.resolve(packageDir, 'src');
    }

    return aliases;
};

export const listWorkspacePackageNames = (workspaceDir) =>
    Object.keys(createWorkspacePackageAliasMap(workspaceDir)).sort((left, right) =>
        left.localeCompare(right)
    );