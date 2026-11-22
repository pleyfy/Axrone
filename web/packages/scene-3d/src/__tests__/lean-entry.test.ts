import { beforeAll, describe, expect, it } from 'vitest';
import { installWebGL2Constants } from '../../../../tests/shared/test-harness';

/**
 * The lean entry exposes the same primitives as the root entry, but its
 * `Scene` is the lean-profile subclass (no physics bridge, no full manifest
 * chain). Everything else must be the exact same runtime reference.
 */
const LEAN_VALUE_EXPORTS = [
    'Camera',
    'MeshRenderer',
    'Scene',
    'Scene3DActorRuntime',
    'SceneGeometryMeshBuilder',
    'createUnlitColorShaderDefinition',
].sort();

const SHARED_VALUE_EXPORTS = LEAN_VALUE_EXPORTS.filter((key) => key !== 'Scene');

describe('scene-3d lean entry', () => {
    let root: typeof import('@axrone/scene-3d');
    let lean: typeof import('@axrone/scene-3d/lean');

    beforeAll(async () => {
        installWebGL2Constants();
        root = await import('@axrone/scene-3d');
        lean = await import('@axrone/scene-3d/lean');
    });

    it('reuses the root implementations for shared primitives', () => {
        for (const key of SHARED_VALUE_EXPORTS) {
            expect(lean[key as keyof typeof lean]).toBe(root[key as keyof typeof root]);
        }
    });

    it('composes a lean Scene subclass that is distinct from the full one', () => {
        expect(lean.Scene).not.toBe(root.Scene);
        expect(typeof lean.Scene).toBe('function');
        expect(typeof root.Scene).toBe('function');
    });

    it('exposes only the documented value surface', () => {
        expect(Object.keys(lean).sort()).toEqual(LEAN_VALUE_EXPORTS);
    });

    it('keeps the root entry unchanged', () => {
        expect(root.Scene).toBeDefined();
        expect(root.Terrain).toBeDefined();
        expect(root.SceneRuntimeKernel).toBeDefined();
        expect('Terrain' in lean).toBe(false);
        expect('SceneRuntimeKernel' in lean).toBe(false);
    });
});
