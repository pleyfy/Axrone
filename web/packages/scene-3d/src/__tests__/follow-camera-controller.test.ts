import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Transform } from '@axrone/ecs-runtime';
import { Quat, Vec3 } from '@axrone/numeric';
import {
    createSceneOptions,
    installWebGL2Constants,
    ManualScheduler,
} from './test-harness';

let Scene: typeof import('@axrone/scene-3d').Scene;
let FollowCameraController: typeof import('@axrone/scene-3d').FollowCameraController;

describe('FollowCameraController', () => {
    let scheduler: ManualScheduler;

    beforeAll(async () => {
        installWebGL2Constants();
        const sceneModule = await import('@axrone/scene-3d');
        Scene = sceneModule.Scene;
        FollowCameraController = sceneModule.FollowCameraController;
    });

    beforeEach(() => {
        scheduler = new ManualScheduler();
    });

    afterEach(() => {
        document.body.innerHTML = '';
    });

    it('snaps to the target orbit and tracks target changes through the scene loop', () => {
        const canvas = document.createElement('canvas');
        const scene = new Scene(createSceneOptions(scheduler, canvas));

        try {
            const target = scene.createActor({ name: 'Target' });
            const targetTransform = target.requireComponent(Transform);
            targetTransform.position = new Vec3(2, 1, 3);

            const camera = scene.createCameraActor({ name: 'Camera' }, { primary: true });
            const cameraTransform = camera.requireComponent(Transform);
            const controller = camera.addComponent(FollowCameraController, {
                distance: 6,
                azimuth: 0,
                elevation: 0,
                targetOffset: [0, 1, 0],
            });

            controller.setTarget(targetTransform);

            scene.start(0);
            scheduler.flush(16);

            expect(cameraTransform.position.x).toBeCloseTo(2, 5);
            expect(cameraTransform.position.y).toBeCloseTo(2, 5);
            expect(cameraTransform.position.z).toBeCloseTo(9, 5);
            expect(Quat.rotateVector(cameraTransform.rotation, Vec3.BACK).x).toBeCloseTo(0, 5);
            expect(Quat.rotateVector(cameraTransform.rotation, Vec3.BACK).y).toBeCloseTo(0, 5);
            expect(Quat.rotateVector(cameraTransform.rotation, Vec3.BACK).z).toBeCloseTo(-1, 5);

            controller.orbit(Math.PI * 0.5, 0).zoom(-2).snap();
            scheduler.flush(32);

            expect(cameraTransform.position.x).toBeCloseTo(6, 5);
            expect(cameraTransform.position.y).toBeCloseTo(2, 5);
            expect(cameraTransform.position.z).toBeCloseTo(3, 5);
            expect(Quat.rotateVector(cameraTransform.rotation, Vec3.BACK).x).toBeCloseTo(-1, 5);
            expect(Quat.rotateVector(cameraTransform.rotation, Vec3.BACK).y).toBeCloseTo(0, 5);
            expect(Quat.rotateVector(cameraTransform.rotation, Vec3.BACK).z).toBeCloseTo(0, 5);

            targetTransform.position = new Vec3(-1, 1.5, 0.5);
            controller.snap();
            scheduler.flush(48);

            expect(cameraTransform.position.x).toBeCloseTo(3, 5);
            expect(cameraTransform.position.y).toBeCloseTo(2.5, 5);
            expect(cameraTransform.position.z).toBeCloseTo(0.5, 5);
        } finally {
            scene.dispose();
        }
    });
});