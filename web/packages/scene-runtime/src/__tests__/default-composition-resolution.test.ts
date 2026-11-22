import { describe, expect, it } from 'vitest';
import type { SceneBatchRuntimeFactory } from '../rendering/batch-runtime-contract';
import {
    getDefaultSceneRuntimeComposition,
    resolveSceneRuntimeComposition,
} from '../default-composition';

const customFactory: SceneBatchRuntimeFactory = () => ({ sprite: null });

describe('root scene composition resolution', () => {
    it('returns the default composition when the caller provides none', () => {
        const resolved = resolveSceneRuntimeComposition(undefined);

        expect(resolved).toBe(getDefaultSceneRuntimeComposition());
        expect(typeof resolved.createRenderBatchRuntimes).toBe('function');
    });

    it('fills in the default batch factory for partial compositions', () => {
        const partial = { createPhysicsBridges: () => ({ bridge3D: null, bridge2D: null }) };

        const resolved = resolveSceneRuntimeComposition(partial);

        expect(resolved.createPhysicsBridges).toBe(partial.createPhysicsBridges);
        expect(resolved.createRenderBatchRuntimes).toBe(
            getDefaultSceneRuntimeComposition().createRenderBatchRuntimes
        );
    });

    it('keeps a caller-supplied batch factory untouched', () => {
        const composition = { createRenderBatchRuntimes: customFactory };

        expect(resolveSceneRuntimeComposition(composition)).toBe(composition);
    });
});
