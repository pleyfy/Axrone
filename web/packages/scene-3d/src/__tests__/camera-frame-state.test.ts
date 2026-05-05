import { Quat, Vec3 } from '@axrone/numeric';
import { describe, expect, it } from 'vitest';
import { Transform } from '@axrone/ecs-runtime';
import { Actor } from '@axrone/ecs-runtime';
import { World } from '@axrone/ecs-runtime';
import { createSceneRegistry } from '@axrone/scene-3d';
import { Camera } from '@axrone/scene-3d';
import { SceneCameraFrameStateCollector } from '@axrone/scene-3d';

describe('SceneCameraFrameStateCollector', () => {
    it('collects stable camera frame state without reallocating matrices', () => {
        const world = new World(createSceneRegistry());
        const collector = new SceneCameraFrameStateCollector();
        const actor = new Actor(world);
        const camera = actor.addComponent(Camera, {
            fieldOfView: 70,
            near: 0.25,
            far: 400,
        });
        const transform = actor.requireComponent(Transform);

        transform.position = new Vec3(3, 4, 5);
        transform.rotation = Quat.fromEuler(0.1, 0.35, -0.2);

        const first = collector.collect(camera, 1920, 1080);
        const second = collector.collect(camera, 1920, 1080);

        expect(first).not.toBeNull();
        expect(second).toBe(first);
        expect(second?.viewMatrix).toBe(first?.viewMatrix);
        expect(second?.projectionMatrix).toBe(first?.projectionMatrix);
        expect(second?.viewProjectionMatrix).toBe(first?.viewProjectionMatrix);
        expect(second?.position).toBe(first?.position);
        expect(second?.camera3D).toBe(first?.camera3D);
        expect(second?.viewMatrix.equals(camera.getViewMatrix())).toBe(true);
        expect(second?.projectionMatrix.equals(camera.getProjectionMatrix(1920 / 1080))).toBe(true);
        expect(second?.viewProjectionMatrix.equals(camera.getViewProjectionMatrix(1920 / 1080))).toBe(
            true
        );
        expect(second?.camera3D).toBe(camera.getRuntimeCamera(1920 / 1080));
        expect(second?.position.equals(transform.worldPosition)).toBe(true);
    });

    it('returns null when no camera is available', () => {
        const collector = new SceneCameraFrameStateCollector();

        expect(collector.collect(undefined, 1280, 720)).toBeNull();
    });

    it('uses horizontal field of view when requested by the camera', () => {
        const world = new World(createSceneRegistry());
        const collector = new SceneCameraFrameStateCollector();
        const horizontalActor = new Actor(world);
        const verticalActor = new Actor(world);
        const horizontalCamera = horizontalActor.addComponent(Camera, {
            fieldOfView: 90,
            fieldOfViewAxis: 'horizontal',
        });
        const verticalCamera = verticalActor.addComponent(Camera, {
            fieldOfView: 90,
            fieldOfViewAxis: 'vertical',
        });

        const horizontalState = collector.collect(horizontalCamera, 1920, 1080);

        expect(horizontalState?.projectionMatrix.equals(horizontalCamera.getProjectionMatrix(1920 / 1080))).toBe(
            true
        );
        expect(
            horizontalCamera.getProjectionMatrix(1920 / 1080).equals(verticalCamera.getProjectionMatrix(1920 / 1080))
        ).toBe(false);
    });
});
