import { beforeAll, describe, expect, it } from 'vitest';
import { installWebGL2Constants } from './test-harness';

/**
 * The lean entry exposes the same primitives as the root entry, but its
 * `Scene2D` is the lean-profile subclass (sprite-only, no physics bridge).
 * Everything else must be the exact same runtime reference.
 */
const LEAN_VALUE_EXPORTS = [
    'Camera',
    'Color',
    'Scene2D',
    'SpriteRenderer',
].sort();

const SHARED_VALUE_EXPORTS = LEAN_VALUE_EXPORTS.filter((key) => key !== 'Scene2D');

describe('scene-2d lean entry', () => {
    let root: typeof import('@axrone/scene-2d');
    let lean: typeof import('@axrone/scene-2d/lean');

    beforeAll(async () => {
        installWebGL2Constants();
        root = await import('@axrone/scene-2d');
        lean = await import('@axrone/scene-2d/lean');
    });

    it('reuses the root implementations for shared primitives', () => {
        for (const key of SHARED_VALUE_EXPORTS) {
            expect(lean[key as keyof typeof lean]).toBe(root[key as keyof typeof root]);
        }
    });

    it('composes a lean Scene2D subclass that is distinct from the full one', () => {
        expect(lean.Scene2D).not.toBe(root.Scene2D);
        expect(typeof lean.Scene2D).toBe('function');
        expect(typeof root.Scene2D).toBe('function');
    });

    it('exposes only the documented value surface', () => {
        expect(Object.keys(lean).sort()).toEqual(LEAN_VALUE_EXPORTS);
    });

    it('keeps the root entry unchanged', () => {
        expect(root.Scene2D).toBeDefined();
        expect(root.SpriteAnimator).toBeDefined();
        expect(root.createSpriteAtlas).toBeDefined();
        expect('SpriteAnimator' in lean).toBe(false);
        expect('createSpriteAtlas' in lean).toBe(false);
    });
});
