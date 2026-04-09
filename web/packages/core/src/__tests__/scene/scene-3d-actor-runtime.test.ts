import { describe, expect, it } from 'vitest';
import { World } from '../../component-system/core/world';
import { createSceneRegistry } from '../../scene';
import { Scene3DActorRuntime } from '../../scene/scene-3d-actor-runtime';
import { SceneActorRuntime } from '../../scene/scene-actor-runtime';
import { SceneComponentCatalog } from '../../scene/component-catalog';
import { Camera } from '../../scene/components/camera';
import { MeshRenderer } from '../../scene/components/mesh-renderer';
import { SceneCapabilityError } from '../../scene/errors';

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
    });
});
