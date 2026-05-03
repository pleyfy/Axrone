import { describe, expect, it } from 'vitest';
import { World } from '@axrone/ecs-runtime';
import { createSceneRegistry } from '@axrone/scene-3d';
import { Scene3DActorRuntime } from '@axrone/scene-3d';
import { SceneActorRuntime } from '@axrone/scene-3d';
import { SceneComponentCatalog } from '@axrone/scene-3d';
import { Camera } from '@axrone/scene-3d';
import { MeshRenderer } from '@axrone/scene-3d';
import { SceneCapabilityError } from '@axrone/scene-3d';
import { Transform } from '@axrone/ecs-runtime';

const create3DActorRuntime = (registry = createSceneRegistry()) => {
    const world = new World(registry);
    const actors = new SceneActorRuntime({
        world,
        componentCatalog: new SceneComponentCatalog(registry),
    });

    return new Scene3DActorRuntime({
        actors,
    });
};

describe('Scene3DActorRuntime', () => {
    it('creates camera and renderable actors through the 3d capability boundary', () => {
        const runtime = create3DActorRuntime();

        const cameraActor = runtime.createCameraActor({ name: 'Camera' }, { primary: true });
        const renderableActor = runtime.createRenderableActor(
            { name: 'Renderable' },
            { meshId: 'mesh', materialId: 'material' }
        );

        expect(cameraActor.getComponent(Camera)?.primary).toBe(true);
        expect(renderableActor.getComponent(MeshRenderer)?.meshId).toBe('mesh');
        expect(renderableActor.getComponent(MeshRenderer)?.materialId).toBe('material');
    });

    it('creates batched renderable actors with hot transform and renderer references', () => {
        const runtime = create3DActorRuntime();

        const created = runtime.createRenderableActors([
            {
                actorConfig: { name: 'RenderableA' },
                rendererConfig: { meshId: 'mesh-a', materialId: 'material-a' },
            },
            {
                actorConfig: { name: 'RenderableB' },
                rendererConfig: { meshId: 'mesh-b', materialId: 'material-b' },
            },
        ]);

        expect(created).toHaveLength(2);
        expect(created[0]?.actor.name).toBe('RenderableA');
        expect(created[0]?.renderer.meshId).toBe('mesh-a');
        expect(created[0]?.renderer).toBe(created[0]?.actor.getComponent(MeshRenderer));
        expect(created[0]?.transform).toBe(created[0]?.actor.getComponent(Transform));
        expect(created[1]?.actor.name).toBe('RenderableB');
        expect(created[1]?.renderer.materialId).toBe('material-b');
    });

    it('fails fast when 3d helpers are used without the 3d capability set', () => {
        const runtime = create3DActorRuntime(
            createSceneRegistry({
                builtIns: ['Hierarchy', 'Transform', 'PrefabNodeBinding'] as const,
            })
        );

        expect(() => runtime.createCameraActor({ name: 'Camera' })).toThrow(SceneCapabilityError);
        expect(() =>
            runtime.createRenderableActor(
                { name: 'Renderable' },
                { meshId: 'mesh', materialId: 'material' }
            )
        ).toThrow(SceneCapabilityError);
        expect(() =>
            runtime.createRenderableActors([
                {
                    actorConfig: { name: 'Renderable' },
                    rendererConfig: { meshId: 'mesh', materialId: 'material' },
                },
            ])
        ).toThrow(SceneCapabilityError);
    });
});
