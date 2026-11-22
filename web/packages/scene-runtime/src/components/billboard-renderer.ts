import { Vec3 } from '@axrone/numeric';
import { Transform } from '@axrone/ecs-runtime';
import { Component } from '@axrone/ecs-runtime';
import { script } from '@axrone/ecs-runtime';
import type { Mutable } from '@axrone/utility';

export type BillboardMode = 'spherical' | 'cylindrical' | 'velocity-oriented';

export interface BillboardRendererConfig {
    readonly textureId?: string;
    readonly mode?: BillboardMode;
    readonly width?: number;
    readonly height?: number;
    readonly pivot?: Vec3 | readonly [number, number, number];
    readonly screenSpace?: boolean;
    readonly sizeAttenuation?: boolean;
    readonly depthWrite?: boolean;
    readonly alphaTest?: number;
    readonly color?: Vec3 | readonly [number, number, number];
    readonly opacity?: number;
    readonly flipX?: boolean;
    readonly flipY?: boolean;
    readonly uvRect?: readonly [number, number, number, number];
}

const toVec3 = (
    value?: Vec3 | readonly [number, number, number],
    fallback: Vec3 = Vec3.ZERO
): Vec3 => {
    if (value instanceof Vec3) {
        return Vec3.from(value);
    }

    if (Array.isArray(value) && value.length === 3) {
        return Vec3.fromArray(value);
    }

    return fallback.clone();
};

const DEFAULT_UV_RECT: readonly [number, number, number, number] = [0, 0, 1, 1];

/**
 * BillboardRenderer component renders a texture that always faces the camera.
 * Useful for particles, vegetation, sprites in 3D space, and LOD impostors.
 *
 * @example
 * ```ts
 * const billboard = new BillboardRenderer({
 *     textureId: 'textures/tree.png',
 *     mode: 'cylindrical',
 *     width: 2,
 *     height: 4,
 * });
 * actor.addComponent(BillboardRenderer, billboard);
 * ```
 */
@script({
    scriptName: 'BillboardRenderer',
    priority: 160,
    executeInEditMode: true,
    singleton: false,
})
export class BillboardRenderer extends Component {
    private _textureId: string | null;
    private _mode: BillboardMode;
    private _width: number;
    private _height: number;
    private _pivot: Vec3;
    private _screenSpace: boolean;
    private _sizeAttenuation: boolean;
    private _depthWrite: boolean;
    private _alphaTest: number;
    private _color: Vec3;
    private _opacity: number;
    private _flipX: boolean;
    private _flipY: boolean;
    private _uvRect: [number, number, number, number];
    private _visible: boolean;

    constructor(config: BillboardRendererConfig = {}) {
        super();
        this._textureId = null;
        this._mode = 'spherical';
        this._width = 1;
        this._height = 1;
        this._pivot = new Vec3(0.5, 0.5, 0);
        this._screenSpace = false;
        this._sizeAttenuation = true;
        this._depthWrite = true;
        this._alphaTest = 0;
        this._color = Vec3.ONE.clone();
        this._opacity = 1;
        this._flipX = false;
        this._flipY = false;
        this._uvRect = [...DEFAULT_UV_RECT];
        this._visible = true;
        this._applyConfig(config);
    }

    get textureId(): string | null {
        return this._textureId;
    }

    set textureId(value: string | null) {
        this._textureId = value;
    }

    get mode(): BillboardMode {
        return this._mode;
    }

    set mode(value: BillboardMode) {
        this._mode = value;
    }

    get width(): number {
        return this._width;
    }

    set width(value: number) {
        this._width = Math.max(0, value);
    }

    get height(): number {
        return this._height;
    }

    set height(value: number) {
        this._height = Math.max(0, value);
    }

    /** Live internal state — read-only view. Mutating it bypasses setter normalization; assign via the setter. */
    get pivot(): Vec3 {
        return this._pivot;
    }

    set pivot(value: Vec3 | readonly [number, number, number]) {
        this._pivot = toVec3(value, new Vec3(0.5, 0.5, 0));
    }

    get screenSpace(): boolean {
        return this._screenSpace;
    }

    set screenSpace(value: boolean) {
        this._screenSpace = value;
    }

    get sizeAttenuation(): boolean {
        return this._sizeAttenuation;
    }

    set sizeAttenuation(value: boolean) {
        this._sizeAttenuation = value;
    }

    get depthWrite(): boolean {
        return this._depthWrite;
    }

    set depthWrite(value: boolean) {
        this._depthWrite = value;
    }

    get alphaTest(): number {
        return this._alphaTest;
    }

    set alphaTest(value: number) {
        this._alphaTest = Math.max(0, Math.min(1, value));
    }

    /** Live internal state — read-only view. Mutating it bypasses setter normalization; assign via the setter. */
    get color(): Vec3 {
        return this._color;
    }

    set color(value: Vec3 | readonly [number, number, number]) {
        this._color = toVec3(value, Vec3.ONE);
    }

    get opacity(): number {
        return this._opacity;
    }

    set opacity(value: number) {
        this._opacity = Math.max(0, Math.min(1, value));
    }

    get flipX(): boolean {
        return this._flipX;
    }

    set flipX(value: boolean) {
        this._flipX = value;
    }

    get flipY(): boolean {
        return this._flipY;
    }

    set flipY(value: boolean) {
        this._flipY = value;
    }

    /** Live internal tuple — read-only view. Mutating it bypasses setter normalization; assign via the setter. */
    get uvRect(): readonly [number, number, number, number] {
        return this._uvRect;
    }

    set uvRect(value: readonly [number, number, number, number]) {
        this._uvRect = [value[0], value[1], value[2], value[3]];
    }

    get visible(): boolean {
        return this._visible;
    }

    set visible(value: boolean) {
        this._visible = value;
    }

    get aspectRatio(): number {
        return this._height > 0 ? this._width / this._height : 1;
    }

    /**
     * Gets the world-space position of the billboard.
     */
    getWorldPosition(): Vec3 {
        const transform = this.transform as Transform | undefined;
        if (!transform) {
            return Vec3.ZERO.clone();
        }

        return transform.worldPosition.clone();
    }

    /**
     * Calculates the effective size considering size attenuation and distance.
     * @param distance Distance from camera to billboard
     * @param fovScale Scale factor based on camera FOV
     */
    getEffectiveSize(distance: number, fovScale: number = 1): { width: number; height: number } {
        if (!this._sizeAttenuation || this._screenSpace) {
            return { width: this._width, height: this._height };
        }

        const attenuation = distance * fovScale;
        return {
            width: this._width * attenuation,
            height: this._height * attenuation,
        };
    }

    /**
     * Gets the UV coordinates adjusted for flip settings.
     */
    getAdjustedUVs(): readonly [number, number, number, number] {
        let [u, v, w, h] = this._uvRect;

        if (this._flipX) {
            u = u + w;
            w = -w;
        }

        if (this._flipY) {
            v = v + h;
            h = -h;
        }

        return [u, v, w, h];
    }

    override serialize(): Record<string, unknown> {
        return {
            textureId: this._textureId,
            mode: this._mode,
            width: this._width,
            height: this._height,
            pivot: [this._pivot.x, this._pivot.y, this._pivot.z],
            screenSpace: this._screenSpace,
            sizeAttenuation: this._sizeAttenuation,
            depthWrite: this._depthWrite,
            alphaTest: this._alphaTest,
            color: [this._color.x, this._color.y, this._color.z],
            opacity: this._opacity,
            flipX: this._flipX,
            flipY: this._flipY,
            uvRect: [...this._uvRect],
            visible: this._visible,
        };
    }

    override deserialize(data: Record<string, any>): void {
        type MutableBillboardConfig = Mutable<BillboardRendererConfig>;
        const patch: MutableBillboardConfig = {};

        if (typeof data.textureId === 'string' || data.textureId === null) {
            patch.textureId = data.textureId;
        }
        if (typeof data.mode === 'string') {
            patch.mode = data.mode;
        }
        if (typeof data.width === 'number') {
            patch.width = data.width;
        }
        if (typeof data.height === 'number') {
            patch.height = data.height;
        }
        if (Array.isArray(data.pivot) && data.pivot.length === 3) {
            patch.pivot = data.pivot;
        }
        if (typeof data.screenSpace === 'boolean') {
            patch.screenSpace = data.screenSpace;
        }
        if (typeof data.sizeAttenuation === 'boolean') {
            patch.sizeAttenuation = data.sizeAttenuation;
        }
        if (typeof data.depthWrite === 'boolean') {
            patch.depthWrite = data.depthWrite;
        }
        if (typeof data.alphaTest === 'number') {
            patch.alphaTest = data.alphaTest;
        }
        if (Array.isArray(data.color) && data.color.length === 3) {
            patch.color = data.color;
        }
        if (typeof data.opacity === 'number') {
            patch.opacity = data.opacity;
        }
        if (typeof data.flipX === 'boolean') {
            patch.flipX = data.flipX;
        }
        if (typeof data.flipY === 'boolean') {
            patch.flipY = data.flipY;
        }
        if (Array.isArray(data.uvRect) && data.uvRect.length === 4) {
            patch.uvRect = data.uvRect;
        }

        this._applyConfig(patch);

        if (typeof data.visible === 'boolean') {
            this._visible = data.visible;
        }
    }

    private _applyConfig(config: BillboardRendererConfig): void {
        if (config.textureId !== undefined) {
            this._textureId = config.textureId;
        }
        if (config.mode) {
            this._mode = config.mode;
        }
        if (typeof config.width === 'number') {
            this._width = Math.max(0, config.width);
        }
        if (typeof config.height === 'number') {
            this._height = Math.max(0, config.height);
        }
        if (config.pivot) {
            this._pivot = toVec3(config.pivot, new Vec3(0.5, 0.5, 0));
        }
        if (typeof config.screenSpace === 'boolean') {
            this._screenSpace = config.screenSpace;
        }
        if (typeof config.sizeAttenuation === 'boolean') {
            this._sizeAttenuation = config.sizeAttenuation;
        }
        if (typeof config.depthWrite === 'boolean') {
            this._depthWrite = config.depthWrite;
        }
        if (typeof config.alphaTest === 'number') {
            this._alphaTest = Math.max(0, Math.min(1, config.alphaTest));
        }
        if (config.color) {
            this._color = toVec3(config.color, Vec3.ONE);
        }
        if (typeof config.opacity === 'number') {
            this._opacity = Math.max(0, Math.min(1, config.opacity));
        }
        if (typeof config.flipX === 'boolean') {
            this._flipX = config.flipX;
        }
        if (typeof config.flipY === 'boolean') {
            this._flipY = config.flipY;
        }
        if (config.uvRect) {
            this._uvRect = [config.uvRect[0], config.uvRect[1], config.uvRect[2], config.uvRect[3]];
        }
    }
}
