import { Mat4, Quat, Vec3 } from '@axrone/numeric';
import { Transform } from '@axrone/ecs';
import { Camera } from './components/camera';

interface MutableSceneCameraFrameState {
    camera: Camera;
    readonly viewMatrix: Mat4;
    readonly projectionMatrix: Mat4;
    readonly viewProjectionMatrix: Mat4;
    readonly position: Vec3;
}

export type SceneCameraFrameState = Readonly<MutableSceneCameraFrameState>;

const copyMat4 = (source: Readonly<Mat4>, target: Mat4): Mat4 => {
    const sourceData = source.data;
    const targetData = target.data;

    for (let index = 0; index < 16; index += 1) {
        targetData[index] = sourceData[index] ?? 0;
    }

    return target;
};

export class SceneCameraFrameStateCollector {
    private readonly _inverseRotation = new Quat();
    private readonly _inverseTranslation = new Vec3();
    private readonly _rotationMatrix = new Mat4();
    private readonly _translationMatrix = new Mat4();
    private readonly _state: MutableSceneCameraFrameState = {
        camera: null as unknown as Camera,
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

        const transform = camera.transform as Transform | undefined;
        if (!transform) {
            copyMat4(Mat4.IDENTITY, this._state.viewMatrix);
            this._state.position.x = 0;
            this._state.position.y = 0;
            this._state.position.z = 0;
        } else {
            const worldPosition = transform.worldPosition;
            const worldRotation = transform.worldRotation;

            this._state.position.x = worldPosition.x;
            this._state.position.y = worldPosition.y;
            this._state.position.z = worldPosition.z;

            Quat.inverse(worldRotation, this._inverseRotation);
            this._inverseTranslation.x = -worldPosition.x;
            this._inverseTranslation.y = -worldPosition.y;
            this._inverseTranslation.z = -worldPosition.z;

            Mat4.fromQuaternion(this._inverseRotation, this._rotationMatrix);
            Mat4.translate(this._inverseTranslation, this._translationMatrix);
            Mat4.multiply(this._rotationMatrix, this._translationMatrix, this._state.viewMatrix);
        }

        const aspectRatio = viewportWidth / Math.max(1, viewportHeight);
        if (camera.orthographic) {
            const halfHeight = camera.orthographicSize;
            const halfWidth = halfHeight * aspectRatio;
            Mat4.orthographic(
                -halfWidth,
                halfWidth,
                -halfHeight,
                halfHeight,
                camera.near,
                camera.far,
                this._state.projectionMatrix
            );
        } else {
            Mat4.perspective(
                (camera.fieldOfView * Math.PI) / 180,
                aspectRatio,
                camera.near,
                camera.far,
                this._state.projectionMatrix
            );
        }

        Mat4.multiply(
            this._state.projectionMatrix,
            this._state.viewMatrix,
            this._state.viewProjectionMatrix
        );

        return this._state;
    }
}
