import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (relative: string): string =>
    readFileSync(path.resolve(process.cwd(), relative), 'utf8');

const readJson = (relative: string): Record<string, unknown> =>
    JSON.parse(read(relative)) as Record<string, unknown>;

describe('tilemap lean boundary', () => {
    it('keeps tilemap imports out of every lean entry', () => {
        for (const file of [
            'packages/scene-2d/src/lean.ts',
            'packages/scene-2d/src/scene-2d-lean.ts',
            'packages/scene-runtime/src/scene-2d-lean-composition.ts',
        ]) {
            expect(read(file).toLowerCase(), file).not.toContain('tilemap');
        }
    });

    it('exposes tilemap through explicit opt-in subpaths only', () => {
        const scene2d = readJson('packages/scene-2d/package.json');
        const sceneRuntime = readJson('packages/scene-runtime/package.json');
        const exports2d = scene2d.exports as Record<string, unknown>;
        const exportsRuntime = sceneRuntime.exports as Record<string, unknown>;
        expect(exports2d['./tilemap']).toBeDefined();
        expect(exportsRuntime['./scene-tilemap']).toBeDefined();
        expect(read('packages/scene-2d/src/index.ts').toLowerCase()).not.toContain(
            'tilemap'
        );
        expect(read('packages/scene-runtime/src/index.ts').toLowerCase()).not.toContain(
            'scene-tilemap'
        );
    });
});
