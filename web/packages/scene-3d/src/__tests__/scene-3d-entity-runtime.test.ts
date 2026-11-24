import { describe, expect, it } from 'vitest';
import { World } from '@axrone/ecs-runtime';
import { createSceneRegistry } from '@axrone/scene-3d';
import { Scene3DActorRuntime } from '@axrone/scene-3d';
import { SceneEntityRuntime } from '@axrone/scene-3d';
import { SceneComponentCatalog } from '@axrone/scene-3d';
import { Camera } from '@axrone/scene-3d';
import { MeshRenderer } from '@axrone/scene-3d';
import { SceneCapabilityError } from '@axrone/scene-3d';
import { Transform } from '@axrone/ecs-runtime';

const create3DActorRuntime = (registry = createSceneRegistry()) => {
    const world = new World(registry);
    const entities = new SceneEntityRuntime({
        world,
        componentCatalog: new SceneComponentCatalog(registry),
    });

    return new Scene3DActorRuntime({
        entities,
    });
};

describe('Scene3DActorRuntime', () => {
    it('creates camera and renderable entities through the 3d capability boundary', () => {
        const runtime = create3DActorRuntime();

        const cameraEntity = runtime.createCameraEntity({ name: 'Camera' }, { primary: true });
        const renderableEntity = runtime.createRenderableEntity(
            { name: 'Renderable' },
            { meshId: 'mesh', materialId: 'material' }
        );

        expect(cameraEntity.getComponent(Camera)?.primary).toBe(true);
        expect(renderableEntity.getComponent(MeshRenderer)?.meshId).toBe('mesh');
        expect(renderableEntity.getComponent(MeshRenderer)?.materialId).toBe('material');
    });

    it('creates batched renderable entities with hot transform and renderer references', () => {
        const runtime = create3DActorRuntime();

        const created = runtime.createRenderableEntities([
            {
                entityConfig: { name: 'RenderableA' },
                rendererConfig: { meshId: 'mesh-a', materialId: 'material-a' },
            },
            {
                entityConfig: { name: 'RenderableB' },
                rendererConfig: { meshId: 'mesh-b', materialId: 'material-b' },
            },
        ]);

        expect(created).toHaveLength(2);
        expect(created[0]?.entity.name).toBe('RenderableA');
        expect(created[0]?.renderer.meshId).toBe('mesh-a');
        expect(created[0]?.renderer).toBe(created[0]?.entity.getComponent(MeshRenderer));
        expect(created[0]?.transform).toBe(created[0]?.entity.getComponent(Transform));
        expect(created[1]?.entity.name).toBe('RenderableB');
        expect(created[1]?.renderer.materialId).toBe('material-b');
    });

    it('fails fast when 3d helpers are used without the 3d capability set', () => {
        const runtime = create3DActorRuntime(
            createSceneRegistry({
                builtIns: ['Hierarchy', 'Transform', 'PrefabNodeBinding'] as const,
            })
        );

        expect(() => runtime.createCameraEntity({ name: 'Camera' })).toThrow(SceneCapabilityError);
        expect(() =>
            runtime.createRenderableEntity(
                { name: 'Renderable' },
                { meshId: 'mesh', materialId: 'material' }
            )
        ).toThrow(SceneCapabilityError);
        expect(() =>
            runtime.createRenderableEntities([
                {
                    entityConfig: { name: 'Renderable' },
                    rendererConfig: { meshId: 'mesh', materialId: 'material' },
                },
            ])
        ).toThrow(SceneCapabilityError);
    });

    it('creates camera and renderable entities with default empty configs', () => {
        const runtime = create3DActorRuntime();

        const cameraEntity = runtime.createCameraEntity();
        const renderableEntity = runtime.createRenderableEntity();

        expect(cameraEntity).toBeDefined();
        expect(cameraEntity.getComponent(Camera)).toBeDefined();
        expect(renderableEntity).toBeDefined();
        expect(renderableEntity.getComponent(MeshRenderer)).toBeDefined();
    });

    it('returns an empty array when batch-creating zero renderable entities', () => {
        const runtime = create3DActorRuntime();

        const created = runtime.createRenderableEntities([]);

        expect(created).toEqual([]);
    });

    it('accumulates resolveHotRefsMs across multiple batch calls', () => {
        const runtime = create3DActorRuntime();
        const profiling: Record<string, number> = {};

        runtime.createRenderableEntities(
            [
                {
                    entityConfig: { name: 'A' },
                    rendererConfig: { meshId: 'm', materialId: 'mat' },
                },
            ],
            profiling
        );
        runtime.createRenderableEntities(
            [
                {
                    entityConfig: { name: 'B' },
                    rendererConfig: { meshId: 'm2', materialId: 'mat2' },
                },
            ],
            profiling
        );

        expect(typeof profiling.resolveHotRefsMs).toBe('number');
        expect(profiling.resolveHotRefsMs).toBeGreaterThanOrEqual(0);
    });

    it('returns hot transform and renderer references that match entity components', () => {
        const runtime = create3DActorRuntime();

        const [instance] = runtime.createRenderableEntities([
            {
                entityConfig: { name: 'Ref' },
                rendererConfig: { meshId: 'mesh-ref', materialId: 'mat-ref' },
            },
        ]);

        expect(instance).toBeDefined();
        expect(instance!.transform).toBe(instance!.entity.getComponent(Transform));
        expect(instance!.renderer).toBe(instance!.entity.getComponent(MeshRenderer));
    });
});
