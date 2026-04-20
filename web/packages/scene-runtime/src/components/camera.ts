import { Mat4, Vec3, Vec4 } from '@axrone/numeric';
import { Transform } from '@axrone/ecs-runtime';
import { Component } from '@axrone/ecs-runtime';
import { script } from '@axrone/ecs-runtime';
import type { SceneClearFlag } from '../types';

export type CameraFieldOfViewAxis = 'vertical' | 'horizontal';

export interface CameraConfig {
    readonly primary?: boolean;
    readonly near?: number;
    readonly far?: number;
    readonly fieldOfView?: number;
    readonly fieldOfViewAxis?: CameraFieldOfViewAxis;
    readonly orthographic?: boolean;
    readonly orthographicSize?: number;
    readonly clearFlags?: readonly SceneClearFlag[];
    readonly clearDepth?: number;
    readonly clearColor?: Vec4 | readonly [number, number, number, number];
}

const DEFAULT_CLEAR_COLOR = new Vec4(0.08, 0.09, 0.11, 1);
const DEFAULT_CLEAR_FLAGS = Object.freeze(['color', 'depth'] as const satisfies readonly SceneClearFlag[]);

const normalizeFieldOfViewAxis = (value: unknown): CameraFieldOfViewAxis =>
    typeof value === 'string' && value.trim().toLowerCase() === 'horizontal'
        ? 'horizontal'
        : 'vertical';

const cloneClearFlags = (value?: readonly SceneClearFlag[]): SceneClearFlag[] => {
    if (!Array.isArray(value) || value.length === 0) {
        return [...DEFAULT_CLEAR_FLAGS];
    }

    const flags: SceneClearFlag[] = [];
    for (const flag of value) {
        if ((flag === 'color' || flag === 'depth') && !flags.includes(flag)) {
            flags.push(flag);
        }
    }

    return flags;
};

export const resolveCameraVerticalFieldOfViewRadians = (
    fieldOfViewDegrees: number,
    fieldOfViewAxis: CameraFieldOfViewAxis,
    aspectRatio: number
): number => {
    const fieldOfViewRadians = (fieldOfViewDegrees * Math.PI) / 180;
    if (fieldOfViewAxis === 'vertical') {
        return fieldOfViewRadians;
    }

    const safeAspectRatio = Math.max(aspectRatio, 0.001);
    return Math.atan(Math.tan(fieldOfViewRadians / 2) / safeAspectRatio) * 2;
};

const toVec4 = (value?: Vec4 | readonly [number, number, number, number]): Vec4 => {
    if (value instanceof Vec4) {
        return new Vec4(value.x, value.y, value.z, value.w);
    }

    if (Array.isArray(value) && value.length === 4) {
        return new Vec4(value[0], value[1], value[2], value[3]);
    }

    return new Vec4(
        DEFAULT_CLEAR_COLOR.x,
        DEFAULT_CLEAR_COLOR.y,
        DEFAULT_CLEAR_COLOR.z,
        DEFAULT_CLEAR_COLOR.w
    );
};

@script({
    scriptName: 'Camera',
    priority: 900,
    executeInEditMode: true,
    singleton: false,
})
export class Camera extends Component {
    private _primary: boolean;
    private _near: number;
    private _far: number;
    private _fieldOfView: number;
    private _fieldOfViewAxis: CameraFieldOfViewAxis;
    private _orthographic: boolean;
    private _orthographicSize: number;
    private _clearFlags: SceneClearFlag[];
    private _clearDepth: number;
    private _clearColor: Vec4;

    constructor(config: CameraConfig = {}) {
        super();
        this._primary = config.primary ?? false;
        this._near = config.near ?? 0.1;
        this._far = config.far ?? 1000;
        this._fieldOfView = config.fieldOfView ?? 60;
        this._fieldOfViewAxis = normalizeFieldOfViewAxis(config.fieldOfViewAxis);
        this._orthographic = config.orthographic ?? false;
        this._orthographicSize = config.orthographicSize ?? 5;
        this._clearFlags = cloneClearFlags(config.clearFlags);
        this._clearDepth = config.clearDepth ?? 1;
        this._clearColor = toVec4(config.clearColor);
    }

    get primary(): boolean {
        return this._primary;
    }

    set primary(value: boolean) {
        this._primary = value;
    }

    get near(): number {
        return this._near;
    }

    set near(value: number) {
        this._near = value;
    }

    get far(): number {
        return this._far;
    }

    set far(value: number) {
        this._far = value;
    }

    get fieldOfView(): number {
        return this._fieldOfView;
    }

    set fieldOfView(value: number) {
        this._fieldOfView = value;
    }

    get fieldOfViewAxis(): CameraFieldOfViewAxis {
        return this._fieldOfViewAxis;
    }

    set fieldOfViewAxis(value: CameraFieldOfViewAxis) {
        this._fieldOfViewAxis = normalizeFieldOfViewAxis(value);
    }

    get orthographic(): boolean {
        return this._orthographic;
    }

    set orthographic(value: boolean) {
        this._orthographic = value;
    }

    get orthographicSize(): number {
        return this._orthographicSize;
    }

    set orthographicSize(value: number) {
        this._orthographicSize = value;
    }

    get clearFlags(): readonly SceneClearFlag[] {
        return this._clearFlags;
    }

    set clearFlags(value: readonly SceneClearFlag[]) {
        this._clearFlags = cloneClearFlags(value);
    }

    get clearDepth(): number {
        return this._clearDepth;
    }

    set clearDepth(value: number) {
        this._clearDepth = value;
    }

    get clearColor(): Vec4 {
        return this._clearColor;
    }

    set clearColor(value: Vec4 | readonly [number, number, number, number]) {
        this._clearColor = toVec4(value);
    }

    getViewMatrix(): Mat4 {
        const transform = this.transform as Transform | undefined;

        if (!transform) {
            return Mat4.IDENTITY.clone();
        }

        const worldPosition = transform.worldPosition;
        const inverseRotation = transform.worldRotation.clone().inverse();
        const inverseTranslation = new Vec3(-worldPosition.x, -worldPosition.y, -worldPosition.z);

        return Mat4.multiply(
            Mat4.fromQuaternion(inverseRotation),
            Mat4.translate(inverseTranslation)
        );
    }

    getProjectionMatrix(aspectRatio: number): Mat4 {
        if (this._orthographic) {
            const halfHeight = this._orthographicSize;
            const halfWidth = halfHeight * aspectRatio;
            return Mat4.orthographic(
                -halfWidth,
                halfWidth,
                -halfHeight,
                halfHeight,
                this._near,
                this._far
            );
        }

        return Mat4.perspective(
            resolveCameraVerticalFieldOfViewRadians(
                this._fieldOfView,
                this._fieldOfViewAxis,
                aspectRatio
            ),
            aspectRatio,
            this._near,
            this._far
        );
    }

    getViewProjectionMatrix(aspectRatio: number): Mat4 {
        return Mat4.multiply(this.getProjectionMatrix(aspectRatio), this.getViewMatrix());
    }

    getWorldPosition(): Vec3 {
        const transform = this.transform as Transform | undefined;
        if (!transform) {
            return Vec3.ZERO.clone();
        }

        return transform.worldPosition.clone();
    }

    override serialize(): Record<string, unknown> {
        return {
            primary: this._primary,
            near: this._near,
            far: this._far,
            fieldOfView: this._fieldOfView,
            fieldOfViewAxis: this._fieldOfViewAxis,
            orthographic: this._orthographic,
            orthographicSize: this._orthographicSize,
            clearFlags: [...this._clearFlags],
            clearDepth: this._clearDepth,
            clearColor: [
                this._clearColor.x,
                this._clearColor.y,
                this._clearColor.z,
                this._clearColor.w,
            ],
        };
    }

    override deserialize(data: Record<string, any>): void {
        if (typeof data.primary === 'boolean') {
            this._primary = data.primary;
        }
        if (typeof data.near === 'number') {
            this._near = data.near;
        }
        if (typeof data.far === 'number') {
            this._far = data.far;
        }
        if (typeof data.fieldOfView === 'number') {
            this._fieldOfView = data.fieldOfView;
        }
        if (typeof data.fieldOfViewAxis === 'string') {
            this._fieldOfViewAxis = normalizeFieldOfViewAxis(data.fieldOfViewAxis);
        }
        if (typeof data.orthographic === 'boolean') {
            this._orthographic = data.orthographic;
        }
        if (typeof data.orthographicSize === 'number') {
            this._orthographicSize = data.orthographicSize;
        }
        if (Array.isArray(data.clearFlags)) {
            this._clearFlags = cloneClearFlags(data.clearFlags);
        }
        if (typeof data.clearDepth === 'number') {
            this._clearDepth = data.clearDepth;
        }
        if (Array.isArray(data.clearColor) && data.clearColor.length === 4) {
            this._clearColor = new Vec4(
                Number(data.clearColor[0]),
                Number(data.clearColor[1]),
                Number(data.clearColor[2]),
                Number(data.clearColor[3])
            );
        }
    }
}