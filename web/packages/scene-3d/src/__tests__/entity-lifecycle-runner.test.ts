import { describe, expect, it, vi } from 'vitest';
import { SceneEntityLifecycleRunner } from '@axrone/scene-3d';

describe('SceneEntityLifecycleRunner', () => {
    it('dispatches each phase against the latest entity collection without allocations', () => {
        const entityA = {
            fixedUpdate: vi.fn(),
            update: vi.fn(),
            lateUpdate: vi.fn(),
        };
        const entityB = {
            fixedUpdate: vi.fn(),
            update: vi.fn(),
            lateUpdate: vi.fn(),
        };

        let entities = [entityA, entityB];
        const runner = new SceneEntityLifecycleRunner({
            getEntitys: () => entities as any,
        });

        runner.fixedUpdate(0.016);
        expect(entityA.fixedUpdate).toHaveBeenCalledWith(0.016);
        expect(entityB.fixedUpdate).toHaveBeenCalledWith(0.016);

        entities = [entityB];
        runner.update(0.033);
        expect(entityA.update).not.toHaveBeenCalled();
        expect(entityB.update).toHaveBeenCalledWith(0.033);

        entities = [entityA];
        runner.lateUpdate(0.05);
        expect(entityA.lateUpdate).toHaveBeenCalledWith(0.05);
        expect(entityB.lateUpdate).not.toHaveBeenCalled();
    });
});
