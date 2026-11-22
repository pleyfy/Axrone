import { beforeAll, describe, expect, it } from 'vitest';
import {
    createMockGL,
    installWebGL2Constants,
} from '../../../../tests/shared/test-harness';
import type { SceneBatchRuntimeFactoryContext } from '../rendering/batch-runtime-contract';
import { SceneBillboardBatchRuntime } from '../rendering/billboard-batch-runtime';
import { SceneLineBatchRuntime } from '../rendering/line-batch-runtime';
import { SceneParticleBatchRuntime } from '../rendering/particle-batch-runtime';
import { SceneRenderStateApplier } from '../rendering/render-state-applier';
import { SceneSpriteBatchRuntime } from '../rendering/sprite-batch-runtime';
import { createLean2DSceneBatchRuntimes } from '../scene-2d-lean-composition';
import { createFullSceneBatchRuntimes } from '../scene-batch-runtimes';
import { SceneMaterialTextureBinder } from '../material-texture-binder';
import { SceneUniformWriter } from '../uniform-writer';

const createContext = (): SceneBatchRuntimeFactoryContext => {
    const canvas = document.createElement('canvas');
    const gl = createMockGL(canvas);

    return {
        gl,
        resources: {} as SceneBatchRuntimeFactoryContext['resources'],
        renderStateApplier: new SceneRenderStateApplier(gl),
        uniformWriter: new SceneUniformWriter(gl),
        materialTextureBinder: new SceneMaterialTextureBinder(gl),
        textureUniformSetter: () => undefined,
    };
};

describe('scene render batch composition', () => {
    beforeAll(() => {
        installWebGL2Constants();
    });

    it('builds every batch family for root scenes', () => {
        const runtimes = createFullSceneBatchRuntimes(createContext());

        expect(runtimes.sprite).toBeInstanceOf(SceneSpriteBatchRuntime);
        expect(runtimes.particle).toBeInstanceOf(SceneParticleBatchRuntime);
        expect(runtimes.line).toBeInstanceOf(SceneLineBatchRuntime);
        expect(runtimes.billboard).toBeInstanceOf(SceneBillboardBatchRuntime);
    });

    it('builds only the sprite family for the lean 2D scene', () => {
        const runtimes = createLean2DSceneBatchRuntimes(createContext());

        expect(runtimes.sprite).toBeInstanceOf(SceneSpriteBatchRuntime);
        expect(runtimes.particle).toBeUndefined();
        expect(runtimes.line).toBeUndefined();
        expect(runtimes.billboard).toBeUndefined();
    });
});
