import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const testDir = path.dirname(fileURLToPath(import.meta.url));
const gltfDir = path.resolve(testDir, '../../../../asset-gltf/src');
const sceneRuntimeGltfDir = path.resolve(testDir, '../../../../scene-runtime-gltf/src');
const allowedAdapterImportFiles = new Set([
    'scene-definition-adapter.ts',
    'scene-runtime-adapter.ts',
    'scene-snapshot-adapter.ts',
]);
const sceneImportPattern = /from ['"](?:(?:\.\.\/)+scene(?:\/[^'"]*)?|@axrone\/scene(?:-[^'"]+)?)['"]/g;

const collectTypeScriptFiles = (dirPath: string): readonly string[] => {
    const files: string[] = [];

    for (const entry of fs.readdirSync(dirPath, { withFileTypes: true })) {
        const fullPath = path.resolve(dirPath, entry.name);
        if (entry.isDirectory()) {
            files.push(...collectTypeScriptFiles(fullPath));
            continue;
        }

        if (entry.isFile() && entry.name.endsWith('.ts')) {
            files.push(fullPath);
        }
    }

    return files;
};

describe('asset gltf boundary', () => {
    it('keeps asset-gltf free of direct scene imports', () => {
        const sceneImportFiles = collectTypeScriptFiles(gltfDir)
            .filter((filePath) => {
                const content = fs.readFileSync(filePath, 'utf8');
                const hasSceneImport = sceneImportPattern.test(content);
                sceneImportPattern.lastIndex = 0;
                return hasSceneImport;
            })
            .map((filePath) => path.relative(gltfDir, filePath).replace(/\\/g, '/'))
            .sort((left, right) => left.localeCompare(right));

        expect(sceneImportFiles).toEqual([]);
    });

    it('keeps scene imports inside the dedicated scene-runtime-gltf adapter files', () => {
        const sceneImportFiles = collectTypeScriptFiles(sceneRuntimeGltfDir)
            .filter((filePath) => {
                const content = fs.readFileSync(filePath, 'utf8');
                const hasSceneImport = sceneImportPattern.test(content);
                sceneImportPattern.lastIndex = 0;
                return hasSceneImport;
            })
            .map((filePath) => path.relative(sceneRuntimeGltfDir, filePath).replace(/\\/g, '/'))
            .sort((left, right) => left.localeCompare(right));

        expect(sceneImportFiles).toEqual([...allowedAdapterImportFiles].sort((left, right) => left.localeCompare(right)));
    });
});
