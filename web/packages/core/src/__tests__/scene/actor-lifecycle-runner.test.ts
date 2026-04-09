import { describe, expect, it, vi } from 'vitest';
import { SceneActorLifecycleRunner } from '../../scene/actor-lifecycle-runner';

describe('SceneActorLifecycleRunner', () => {
    it('dispatches each phase against the latest actor collection without allocations', () => {
        const actorA = {
            fixedUpdate: vi.fn(),
            update: vi.fn(),
            lateUpdate: vi.fn(),
        };
        const actorB = {
            fixedUpdate: vi.fn(),
            update: vi.fn(),
            lateUpdate: vi.fn(),
        };

        let actors = [actorA, actorB];
        const runner = new SceneActorLifecycleRunner({
            getActors: () => actors as any,
        });

        runner.fixedUpdate(0.016);
        expect(actorA.fixedUpdate).toHaveBeenCalledWith(0.016);
        expect(actorB.fixedUpdate).toHaveBeenCalledWith(0.016);

        actors = [actorB];
        runner.update(0.033);
        expect(actorA.update).not.toHaveBeenCalled();
        expect(actorB.update).toHaveBeenCalledWith(0.033);

        actors = [actorA];
        runner.lateUpdate(0.05);
        expect(actorA.lateUpdate).toHaveBeenCalledWith(0.05);
        expect(actorB.lateUpdate).not.toHaveBeenCalled();
    });
});
