import { Mat4, Vec2, Vec3 } from '@axrone/numeric';
import type { SceneShaderResource } from './shader-registry';
import type { SceneUniformWriteTarget } from './uniform-writer';

export interface SceneFrameUniformContext {
    readonly modelMatrix: Mat4;
    readonly viewMatrix: Mat4;
    readonly projectionMatrix: Mat4;
    readonly viewProjectionMatrix: Mat4;
    readonly cameraPosition: Vec3;
    readonly elapsedSeconds: number;
    readonly deltaSeconds: number;
    readonly frame: number;
    readonly viewportWidth: number;
    readonly viewportHeight: number;
}

export class SceneFrameUniformBinder {
    private readonly _resolution = new Vec2();
    private readonly _mvpScratch = new Mat4();

    constructor(private readonly _writer: SceneUniformWriteTarget) {}

    apply(shader: SceneShaderResource, context: SceneFrameUniformContext): void {
        this._resolution.x = context.viewportWidth;
        this._resolution.y = context.viewportHeight;

        const mvpMatrix = Mat4.multiply(
            context.viewProjectionMatrix,
            context.modelMatrix,
            this._mvpScratch
        );

        this._writer.write(shader, 'u_Model', context.modelMatrix);
        this._writer.write(shader, 'u_View', context.viewMatrix);
        this._writer.write(shader, 'u_Projection', context.projectionMatrix);
        this._writer.write(shader, 'u_ViewProjection', context.viewProjectionMatrix);
        this._writer.write(shader, 'u_MVP', mvpMatrix);
        this._writer.write(shader, 'u_Time', context.elapsedSeconds);
        this._writer.write(shader, 'u_DeltaTime', context.deltaSeconds);
        this._writer.write(shader, 'u_Frame', context.frame);
        this._writer.write(shader, 'u_Resolution', this._resolution);
        this._writer.write(shader, 'u_CameraPosition', context.cameraPosition);
    }
}
