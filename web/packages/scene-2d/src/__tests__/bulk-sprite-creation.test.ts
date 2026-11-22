import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Actor, Hierarchy, Transform, World } from '@axrone/ecs-runtime';
import { createSceneOptions, installWebGL2Constants, ManualScheduler } from './test-harness';

let Scene2D: typeof import('@axrone/scene-2d').Scene2D;
let SpriteRenderer: typeof import('@axrone/scene-2d').SpriteRenderer;
let Scene2DActorRuntime: typeof import('../scene-2d-actor-runtime').Scene2DActorRuntime;

describe('Scene2D bulk sprite creation', () => {
    let scheduler: ManualScheduler;

    beforeAll(async () => {
        installWebGL2Constants();
        const sceneModule = await import('@axrone/scene-2d');
        Scene2D = sceneModule.Scene2D;
        SpriteRenderer = sceneModule.SpriteRenderer;
        Scene2DActorRuntime = (await import('../scene-2d-actor-runtime')).Scene2DActorRuntime;
    });

    beforeEach(() => {
        scheduler = new ManualScheduler();
    });

    afterEach(() => {
        document.body.innerHTML = '';
    });

    it('creates sprites with components and optional initial transforms', () => {
        const canvas = document.createElement('canvas');
        const scene = new Scene2D(createSceneOptions(scheduler, canvas));

        try {
            const actors = scene.createSpriteActors([
                {
                    actorConfig: { name: 'A' },
                    spriteConfig: { textureId: 'hero', size: [2, 3] },
                    position: [1, 2, 0],
                },
                {
                    actorConfig: { name: 'B' },
                    // Non-homogeneous config still creates; only the render
                    // fast path declines it.
                    spriteConfig: { textureId: 'hero', sliceBorder: [1, 1, 1, 1] },
                },
                {
                    actorConfig: { name: 'C' },
                    spriteConfig: { textureId: 'hero', size: [1, 1] },
                    position: [4, 5, 0],
                    rotation: [0, 0, Math.SQRT1_2, Math.SQRT1_2],
                    scale: [2, 2, 1],
                },
            ]);

            expect(actors.length).toBe(3);
            expect(actors.map((actor) => actor.name)).toEqual(['A', 'B', 'C']);
            for (const actor of actors) {
                expect(actor.getComponent(Transform)).toBeDefined();
                expect(actor.getComponent(SpriteRenderer)).toBeDefined();
            }

            const first = actors[0]!.getComponent(Transform)!;
            expect(first.position.x).toBe(1);
            expect(first.position.y).toBe(2);
            expect(first.position.z).toBe(0);
            expect(actors[0]!.getComponent(SpriteRenderer)!.textureId).toBe('hero');

            const third = actors[2]!.getComponent(Transform)!;
            expect(third.position.x).toBe(4);
            expect(third.position.y).toBe(5);
            expect(third.scale.x).toBe(2);
            expect(third.rotation.z).toBeCloseTo(Math.SQRT1_2);

            expect(scene.createSpriteActors([])).toEqual([]);
        } finally {
            scene.dispose();
        }
    });

    it('creates real actors, components and world events through the bulk path', () => {
        const canvas = document.createElement('canvas');
        const scene = new Scene2D(createSceneOptions(scheduler, canvas));

        try {
            // Seed one sprite to reach the scene world through a public actor.
            const [seed] = scene.createSpriteActors([{ spriteConfig: { textureId: 'hero' } }]);
            const world = seed!.world;

            const created: number[] = [];
            const rendererAdded: number[] = [];
            const transformAdded: number[] = [];
            world.on('EntityCreated' as any, (data: any) => created.push(data.entity));
            world.on('SpriteRendererAdded' as any, (data: any) => rendererAdded.push(data.entity));
            world.on('TransformAdded' as any, (data: any) => transformAdded.push(data.entity));

            const actors = scene.createSpriteActors([
                {
                    actorConfig: { name: 'X' },
                    spriteConfig: { textureId: 'hero' },
                    position: [1, 2, 0],
                },
                {
                    actorConfig: { name: 'Y' },
                    spriteConfig: { textureId: 'hero' },
                    rotationZ: Math.PI / 2,
                    scale: [2, 2, 1],
                },
            ]);

            const entities = actors.map((actor) => actor.entity);
            expect(created).toEqual(entities);
            expect(rendererAdded).toEqual(entities);
            expect(transformAdded).toEqual(entities);

            expect(actors.every((actor) => actor.active && actor.started)).toBe(true);
            expect(new Set(actors.map((actor) => actor.id)).size).toBe(2);
            expect(actors[0]!.requireComponent(Hierarchy)).toBeDefined();
            expect(actors[0]!.requireComponent(Transform).actor).toBe(actors[0]);
            expect(world.getAllActors()).toHaveLength(3);

            const first = actors[0]!.requireComponent(Transform);
            expect([first.position.x, first.position.y, first.position.z]).toEqual([1, 2, 0]);

            const second = actors[1]!.requireComponent(Transform);
            expect(second.rotation.z).toBeCloseTo(Math.sin(Math.PI / 4));
            expect(second.rotation.w).toBeCloseTo(Math.cos(Math.PI / 4));
            expect(second.scale.x).toBe(2);
            expect(second.scale.y).toBe(2);
        } finally {
            scene.dispose();
        }
    });

    it('falls back to incremental creation when no scene world is wired', () => {
        const world = new World({ Hierarchy, Transform, SpriteRenderer } as any);
        const host = {
            isComponentRegistered: (type: any) => world.isComponentRegistered(type),
            createActor: (config: any) => new Actor(world, config),
        };
        const runtime = new Scene2DActorRuntime({ actors: host as any });

        try {
            const actors = runtime.createSpriteActors([
                {
                    actorConfig: { name: 'Fallback' },
                    spriteConfig: { textureId: 'hero', size: [2, 2] },
                    position: [3, 4, 0],
                },
            ]);

            expect(actors).toHaveLength(1);
            expect(actors[0]!.name).toBe('Fallback');
            expect(actors[0]!.requireComponent(SpriteRenderer).textureId).toBe('hero');
            const transform = actors[0]!.requireComponent(Transform);
            expect([transform.position.x, transform.position.y]).toEqual([3, 4]);
            expect(world.getAllActors()).toHaveLength(1);
        } finally {
            world.clear();
        }
    });
});
