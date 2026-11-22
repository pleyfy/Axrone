import { describe, expect, it } from 'vitest';
import { AnimationController } from '@axrone/animation/controller';
import { Actor, Transform, World } from '@axrone/ecs-runtime';
import { Vec3 } from '@axrone/numeric';
import { SceneRagdollPoseSource } from '../components/ragdoll-pose-source';
import { createSceneRegistry } from '../scene-registry';
import type { Animator } from '../components/animator';

const makeController = (): AnimationController =>
    new AnimationController({
        rig: {
            bones: [
                { name: 'root' },
                { name: 'upper', parent: 'root', translation: [1, 0, 0] },
                { name: 'lower', parent: 'upper', translation: [1, 0, 0] },
            ],
        },
        clips: [{ id: 'idle', tracks: [] }],
        layers: [
            {
                id: 'base',
                stateMachine: {
                    entryState: 'idle',
                    states: [{ id: 'idle', motion: { kind: 'clip', clipId: 'idle' } }],
                },
            },
        ],
    });

const makeStubAnimator = (controller: AnimationController) => {
    const stub = {
        controller,
        appliedCount: 0,
        applyCurrentPose(): void {
            stub.appliedCount += 1;
        },
    };
    return stub as unknown as Animator & { appliedCount: number };
};

const makeBoneActor = (world: World, position: readonly [number, number, number]): Actor => {
    const actor = new Actor(world);
    actor.getComponent(Transform)!.position = new Vec3(position[0], position[1], position[2]);
    return actor;
};

describe('SceneRagdollPoseSource', () => {
    it('blends captured world transforms into the animation pose', () => {
        const world = new World(createSceneRegistry());
        const controller = makeController();
        const animator = makeStubAnimator(controller);

        const root = makeBoneActor(world, [0, 0, 0]);
        const upper = makeBoneActor(world, [1, 0, 0]);
        const lower = makeBoneActor(world, [0, 1, 0]);

        const source = new SceneRagdollPoseSource();
        source.bind(animator, [root, upper, lower]);

        expect(source.count).toBe(1);
        expect(source.capture()).toBe(1);
        expect(source.apply(1)).toBe(1);

        expect(animator.appliedCount).toBe(1);
        expect(controller.currentFrame.pose.translations[2 * 3]).toBeCloseTo(-1, 4);
        expect(controller.currentFrame.pose.translations[2 * 3 + 1]).toBeCloseTo(1, 4);
        expect(controller.currentFrame.pose.translations[2 * 3 + 2]).toBeCloseTo(0, 4);
    });

    it('blends at the requested weight', () => {
        const world = new World(createSceneRegistry());
        const controller = makeController();
        const animator = makeStubAnimator(controller);

        const source = new SceneRagdollPoseSource();
        source.bind(animator, [
            makeBoneActor(world, [0, 0, 0]),
            makeBoneActor(world, [1, 0, 0]),
            makeBoneActor(world, [0, 1, 0]),
        ]);

        source.capture();
        expect(source.apply(0.5)).toBe(1);

        // Animation local is (1, 0, 0); physics local is (-1, 1, 0).
        expect(controller.currentFrame.pose.translations[2 * 3]).toBeCloseTo(0, 4);
        expect(controller.currentFrame.pose.translations[2 * 3 + 1]).toBeCloseTo(0.5, 4);
    });

    it('does nothing when the weight is zero', () => {
        const world = new World(createSceneRegistry());
        const controller = makeController();
        const animator = makeStubAnimator(controller);

        const source = new SceneRagdollPoseSource();
        source.bind(animator, [
            makeBoneActor(world, [0, 0, 0]),
            makeBoneActor(world, [1, 0, 0]),
            makeBoneActor(world, [0, 1, 0]),
        ]);

        source.capture();
        expect(source.apply(0)).toBe(0);
        expect(animator.appliedCount).toBe(0);
    });

    it('requires a binding that covers the rig', () => {
        const world = new World(createSceneRegistry());
        const controller = makeController();
        const animator = makeStubAnimator(controller);
        const source = new SceneRagdollPoseSource();

        expect(() => source.bind(animator, [makeBoneActor(world, [0, 0, 0])])).toThrow(
            /requires 3 bone actors/
        );
    });

    it('skips a binding whose bone actor has no transform', () => {
        const world = new World(createSceneRegistry());
        const controller = makeController();
        const animator = makeStubAnimator(controller);

        const root = makeBoneActor(world, [0, 0, 0]);
        const upper = makeBoneActor(world, [1, 0, 0]);
        const lower = makeBoneActor(world, [0, 1, 0]);
        lower.removeComponent(Transform);

        const source = new SceneRagdollPoseSource();
        source.bind(animator, [root, upper, lower]);

        expect(source.capture()).toBe(0);
        expect(source.apply(1)).toBe(0);
    });

    it('unbinds', () => {
        const world = new World(createSceneRegistry());
        const controller = makeController();
        const animator = makeStubAnimator(controller);

        const source = new SceneRagdollPoseSource();
        source.bind(animator, [
            makeBoneActor(world, [0, 0, 0]),
            makeBoneActor(world, [1, 0, 0]),
            makeBoneActor(world, [2, 0, 0]),
        ]);

        expect(source.has(animator)).toBe(true);
        expect(source.unbind(animator)).toBe(true);
        expect(source.has(animator)).toBe(false);
        expect(source.count).toBe(0);
    });
});
