import { type Camera3D, type CameraProjection } from '@axrone/geometry';
import { Mat4, type IMat4Like, Vec3 } from '@axrone/numeric';
import { Camera } from './components/camera';

interface MutableSceneCameraFrameState {
    camera: Camera;
    camera3D: Readonly<Camera3D<CameraProjection>>;
    readonly viewMatrix: Mat4;
    readonly projectionMatrix: Mat4;
    readonly viewProjectionMatrix: Mat4;
    readonly position: Vec3;
}

export type SceneCameraFrameState = Readonly<MutableSceneCameraFrameState>;

const copyMat4 = (source: Readonly<IMat4Like>, target: Mat4): Mat4 => {
    const sourceData = source.data;
    const targetData = target.data;

    for (let index = 0; index < 16; index += 1) {
        targetData[index] = sourceData[index] ?? 0;
    }

    return target;
};

export class SceneCameraFrameStateCollector {
    private readonly _state: MutableSceneCameraFrameState = {
        camera: null as unknown as Camera,
        camera3D: null as unknown as Readonly<Camera3D<CameraProjection>>,
        viewMatrix: new Mat4(),
        projectionMatrix: new Mat4(),
        viewProjectionMatrix: new Mat4(),
        position: new Vec3(),
    };

    collect(
        camera: Camera | undefined,
        viewportWidth: number,
        viewportHeight: number
    ): SceneCameraFrameState | null {
        if (!camera) {
            return null;
        }

        this._state.camera = camera;
        const aspectRatio = viewportWidth / Math.max(1, viewportHeight);
        const camera3D = camera.getRuntimeCamera(aspectRatio);
        this._state.camera3D = camera3D;

        copyMat4(camera3D.viewMatrix, this._state.viewMatrix);
        copyMat4(camera3D.projectionMatrix, this._state.projectionMatrix);
        copyMat4(camera3D.viewProjectionMatrix, this._state.viewProjectionMatrix);
        this._state.position.x = camera3D.position.x;
        this._state.position.y = camera3D.position.y;
        this._state.position.z = camera3D.position.z;

        return this._state;
    }
}
