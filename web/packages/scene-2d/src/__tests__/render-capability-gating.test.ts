import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { Actor, Hierarchy, Transform } from '@axrone/ecs-runtime';
import { MeshRenderer } from '@axrone/scene-runtime/scene-3d-support';
import { createSceneOptions, installWebGL2Constants, ManualScheduler } from './test-harness';

let Scene2D: typeof import('@axrone/scene-2d').Scene2D;
let SpriteRenderer: typeof import('@axrone/scene-2d').SpriteRenderer;

const SPRITE_COUNT = 2050;

const NON_RENDERED_2D_COMPONENTS = [
    'MeshRenderer',
    'DirectionalLight',
    'PointLight',
    'SpotLight',
    'AreaLight',
    'ParticleSystem',
    'LineRenderer',
    'TrailRenderer',
    'BillboardRenderer',
] as const;

const registerTexture = (
    scene: InstanceType<typeof Scene2D>,
    id: string
): Promise<void> =>
    scene.registerTexture({
        id,
        source: { kind: 'data', width: 1, height: 1, channels: 4, data: [255, 255, 255, 255] },
        generateMipmaps: false,
    });

const countComponentLookups = (scene: InstanceType<typeof Scene2D>): Map<string, number> => {
    const counts = new Map<string, number>();
    const spy = vi.spyOn(Actor.prototype as any, 'getComponent');

    try {
        scene.renderNow();
        for (const call of spy.mock.calls) {
            const componentType = (call as unknown[])[0] as { name?: string } | undefined;
            const name = componentType?.name ?? 'unknown';
            counts.set(name, (counts.get(name) ?? 0) + 1);
        }
    } finally {
        spy.mockRestore();
    }

    return counts;
};

describe('Scene2D render capability gating', () => {
    let scheduler: ManualScheduler;

    beforeAll(async () => {
        installWebGL2Constants();
        const sceneModule = await import('@axrone/scene-2d');
        Scene2D = sceneModule.Scene2D;
        SpriteRenderer = sceneModule.SpriteRenderer;
    });

    beforeEach(() => {
        scheduler = new ManualScheduler();
    });

    afterEach(() => {
        document.body.innerHTML = '';
    });

    it('never probes 3D-only component families in a pure 2D scene', async () => {
        const canvas = document.createElement('canvas');
        const scene = new Scene2D(createSceneOptions(scheduler, canvas));

        try {
            await registerTexture(scene, 'hero');
            scene.createCameraActor(
                { name: 'Camera' },
                { primary: true, orthographic: true, orthographicSize: 100 }
            );
            scene.createSpriteActors(
                Array.from({ length: SPRITE_COUNT }, (_, index) => ({
                    actorConfig: { name: `Hero${index}` },
                    spriteConfig: { textureId: 'hero' },
                }))
            );

            const counts = countComponentLookups(scene);

            for (const componentName of NON_RENDERED_2D_COMPONENTS) {
                expect(counts.get(componentName) ?? 0).toBe(0);
            }
            // The camera is still resolved; the sprite components are probed by
            // the instance-registry build, which is expected.
            expect(counts.get('Camera') ?? 0).toBeGreaterThanOrEqual(1);
            expect(counts.get('SpriteRenderer') ?? 0).toBeGreaterThanOrEqual(SPRITE_COUNT);
            expect(scene.renderStats.drawCalls).toBe(1);
        } finally {
            scene.dispose();
        }
    });

    it('keeps the mesh collector active when the registry registers a mesh renderer', async () => {
        const canvas = document.createElement('canvas');
        const scene = new Scene2D(
            createSceneOptions(scheduler, canvas, { DebugMesh: MeshRenderer } as any)
        );

        try {
            await registerTexture(scene, 'hero');
            scene.createCameraActor(
                { name: 'Camera' },
                { primary: true, orthographic: true, orthographicSize: 100 }
            );
            scene.createSpriteActors(
                Array.from({ length: SPRITE_COUNT }, (_, index) => ({
                    actorConfig: { name: `Hero${index}` },
                    spriteConfig: { textureId: 'hero' },
                }))
            );

            const counts = countComponentLookups(scene);

            // MeshRenderer is registered, so the render-list collector scans
            // every actor for an enabled mesh renderer (none are attached).
            expect(counts.get('MeshRenderer') ?? 0).toBeGreaterThanOrEqual(SPRITE_COUNT);
            expect(scene.renderStats.drawCalls).toBe(1);
        } finally {
            scene.dispose();
        }
    });

    it('still falls back to the general sprite path for nine-slice sprites', async () => {
        const canvas = document.createElement('canvas');
        const scene = new Scene2D(createSceneOptions(scheduler, canvas));
        const gl = scene.gl as any;

        try {
            await registerTexture(scene, 'hero');
            scene.createCameraActor(
                { name: 'Camera' },
                { primary: true, orthographic: true, orthographicSize: 100 }
            );
            scene.createSpriteActors(
                Array.from({ length: SPRITE_COUNT }, (_, index) => ({
                    actorConfig: { name: `Hero${index}` },
                    spriteConfig: {
                        textureId: 'hero',
                        ...(index === 0
                            ? {
                                  size: [8, 8] as const,
                                  sourceSize: [8, 8] as const,
                                  sliceBorder: [1, 1, 1, 1] as const,
                              }
                            : {}),
                    },
                }))
            );

            scene.renderNow();
            scene.renderNow();
            gl.drawElements.mockClear();
            gl.drawElementsInstanced.mockClear();
            scene.renderNow();

            expect(gl.drawElementsInstanced).not.toHaveBeenCalled();
            expect(gl.drawElements).toHaveBeenCalled();
            // The sliced sprite is submitted through the general batch path
            // (possibly as its own batch), so draw count is not fixed.
            expect(scene.renderStats.drawCalls).toBeGreaterThanOrEqual(1);
        } finally {
            scene.dispose();
        }
    });

    it('propagates an atomic 2D TRS write through cached hierarchy lookups', () => {
        const canvas = document.createElement('canvas');
        const scene = new Scene2D(createSceneOptions(scheduler, canvas));

        try {
            const parentActor = scene.createSpriteActor({ name: 'Parent' }, { textureId: 'hero' });
            const childActor = scene.createSpriteActor({ name: 'Child' }, { textureId: 'hero' });
            const parentTransform = parentActor.getComponent(Transform)!;
            const childTransform = childActor.getComponent(Transform)!;

            const parentHierarchy = parentActor.getComponent(Hierarchy)!;
            const childHierarchy = childActor.getComponent(Hierarchy)!;
            childHierarchy.setParent(parentHierarchy);

            // Warm the transform hierarchy cache on both transforms.
            expect(childTransform.parent).toBe(parentTransform);

            parentTransform.setLocalTRS2D(3, 4, 0, 1, 1);
            expect(childTransform.worldPosition.x).toBeCloseTo(3);
            expect(childTransform.worldPosition.y).toBeCloseTo(4);

            // A component-set change bumps the actor revision and must
            // invalidate the cached hierarchy reference, not corrupt it.
            childActor.removeComponent(SpriteRenderer);
            expect(childTransform.parent).toBe(parentTransform);

            parentTransform.setLocalTRS2D(-2, 1, 0, 1, 1);
            expect(childTransform.worldPosition.x).toBeCloseTo(-2);
            expect(childTransform.worldPosition.y).toBeCloseTo(1);

            expect(childActor.removeComponent(Hierarchy)).toBe(true);
            expect(childTransform.parent).toBeUndefined();
        } finally {
            scene.dispose();
        }
    });
});
