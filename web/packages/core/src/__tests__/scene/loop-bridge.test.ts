import { describe, expect, it, vi } from 'vitest';
import { SystemPhase } from '../../component-system/systems/system-manager';
import { createSceneLoopSystems } from '@axrone/scene-3d';

describe('createSceneLoopSystems', () => {
    it('creates the expected scene loop system order', () => {
        const systems = createSceneLoopSystems({
            executePhase: vi.fn(),
            fixedUpdateActors: vi.fn(),
            updateActors: vi.fn(),
            lateUpdateActors: vi.fn(),
            render: vi.fn(),
        });

        expect(systems.map((system) => system.id)).toEqual([
            'scene.pre-update',
            'scene.fixed-update',
            'scene.update',
            'scene.render',
        ]);
    });

    it('routes loop phases through the host contract', () => {
        const executePhase = vi.fn();
        const fixedUpdateActors = vi.fn();
        const updateActors = vi.fn();
        const lateUpdateActors = vi.fn();
        const render = vi.fn();

        const systems = createSceneLoopSystems({
            executePhase,
            fixedUpdateActors,
            updateActors,
            lateUpdateActors,
            render,
        });

        systems[0]?.beforeUpdate?.({
            phase: 'before-update',
            loop: {} as any,
            state: { sceneId: 'scene-1' },
            frame: 1,
            now: 0,
            elapsed: 0,
            delta: 16,
            unscaledDelta: 16,
            accumulator: 0,
            fixedDelta: 16,
            timeScale: 1,
        });
        systems[1]?.fixedUpdate?.({
            phase: 'fixed-update',
            loop: {} as any,
            state: { sceneId: 'scene-1' },
            frame: 1,
            now: 0,
            elapsed: 0,
            delta: 16,
            unscaledDelta: 16,
            accumulator: 0,
            fixedDelta: 16,
            timeScale: 1,
            step: 1,
            maxSteps: 4,
        });
        systems[2]?.update?.({
            phase: 'update',
            loop: {} as any,
            state: { sceneId: 'scene-1' },
            frame: 1,
            now: 0,
            elapsed: 0,
            delta: 8,
            unscaledDelta: 8,
            accumulator: 0,
            fixedDelta: 16,
            timeScale: 1,
        });
        systems[3]?.render?.({
            phase: 'render',
            loop: {} as any,
            state: { sceneId: 'scene-1' },
            frame: 1,
            now: 0,
            elapsed: 0,
            delta: 8,
            unscaledDelta: 8,
            accumulator: 0,
            fixedDelta: 16,
            timeScale: 1,
            alpha: 0.5,
        });

        expect(executePhase.mock.calls).toEqual([
            [SystemPhase.PreUpdate, 16],
            [SystemPhase.Update, 8],
            [SystemPhase.PostUpdate, 8],
            [SystemPhase.Render, 8],
        ]);
        expect(fixedUpdateActors).toHaveBeenCalledWith(16);
        expect(updateActors).toHaveBeenCalledWith(8);
        expect(lateUpdateActors).toHaveBeenCalledWith(8);
        expect(render).toHaveBeenCalledWith(8);
    });
});
