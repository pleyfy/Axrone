import { Quat, Vec3 } from '@axrone/numeric';
import { Transform } from '@axrone/ecs-runtime';
import { Component } from '@axrone/ecs-runtime';
import { script } from '@axrone/ecs-runtime';

export type AreaLightShape = 'rectangle' | 'disc';

export interface AreaLightConfig {
    readonly color?: Vec3 | readonly [number, number, number];
    readonly intensity?: number;
    readonly width?: number;
    readonly height?: number;
    readonly shape?: AreaLightShape;
    readonly range?: number;
}

const toVec3 = (
    value?: Vec3 | readonly [number, number, number],
    fallback: Vec3 = Vec3.ONE
): Vec3 => {
    if (value instanceof Vec3) {
        return Vec3.from(value);
    }

    if (Array.isArray(value) && value.length === 3) {
        return Vec3.fromArray(value);
    }

    return fallback.clone();
};

const normalizeShape = (value: unknown): AreaLightShape =>
    typeof value === 'string' && value.trim().toLowerCase() === 'disc' ? 'disc' : 'rectangle';

/**
 * AreaLight component provides rectangular or disc-shaped area lighting.
 * Area lights emit light from a defined surface area, creating soft shadows
 * and realistic lighting for architectural and product visualization.
 *
 * @example
 * ```ts
 * const light = new AreaLight({
 *     color: [1, 0.95, 0.9],
 *     intensity: 5,
 *     width: 2,
 *     height: 2,
 *     shape: 'rectangle',
 * });
 * actor.addComponent(AreaLight, light);
 * ```
 */
@script({
    scriptName: 'AreaLight',
    priority: 680,
    executeInEditMode: true,
    singleton: false,
})
export class AreaLight extends Component {
    private _color: Vec3;
    private _intensity: number;
    private _width: number;
    private _height: number;
    private _shape: AreaLightShape;
    private _range: number;

    constructor(config: AreaLightConfig = {}) {
        super();
        this._color = Vec3.ONE.clone();
        this._intensity = 1;
        this._width = 1;
        this._height = 1;
        this._shape = 'rectangle';
        this._range = 10;
        this._applyConfig(config);
    }

    /** Live internal state — read-only view. Mutating it bypasses setter normalization; assign via the setter. */
    get color(): Vec3 {
        return this._color;
    }

    set color(value: Vec3 | readonly [number, number, number]) {
        this._applyConfig({ color: value });
    }

    get intensity(): number {
        return this._intensity;
    }

    set intensity(value: number) {
        this._applyConfig({ intensity: value });
    }

    get width(): number {
        return this._width;
    }

    set width(value: number) {
        this._applyConfig({ width: value });
    }

    get height(): number {
        return this._height;
    }

    set height(value: number) {
        this._applyConfig({ height: value });
    }

    get shape(): AreaLightShape {
        return this._shape;
    }

    set shape(value: AreaLightShape) {
        this._applyConfig({ shape: value });
    }

    get range(): number {
        return this._range;
    }

    set range(value: number) {
        this._applyConfig({ range: value });
    }

    /**
     * Returns the world-space position of the area light.
     */
    getWorldPosition(): Vec3 {
        const transform = this.transform as Transform | undefined;
        if (!transform) {
            return Vec3.ZERO.clone();
        }

        return transform.worldPosition.clone();
    }

    /**
     * Returns the normalized forward direction of the area light.
     * Area lights emit from their front face (local +Z).
     */
    getDirection(): Vec3 {
        const transform = this.transform as Transform | undefined;
        if (!transform) {
            return new Vec3(0, 0, -1);
        }

        const forward = Quat.rotateVector(transform.worldRotation, Vec3.FORWARD, new Vec3());
        return Vec3.normalize(forward, forward);
    }

    /**
     * Returns the normalized right direction of the area light surface.
     */
    getRight(): Vec3 {
        const transform = this.transform as Transform | undefined;
        if (!transform) {
            return Vec3.RIGHT;
        }

        const right = Quat.rotateVector(transform.worldRotation, Vec3.RIGHT, new Vec3());
        return Vec3.normalize(right, right);
    }

    /**
     * Returns the normalized up direction of the area light surface.
     */
    getUp(): Vec3 {
        const transform = this.transform as Transform | undefined;
        if (!transform) {
            return Vec3.UP;
        }

        const up = Quat.rotateVector(transform.worldRotation, Vec3.UP, new Vec3());
        return Vec3.normalize(up, up);
    }

    /**
     * Returns the effective radius for disc-shaped area lights.
     * For rectangular lights, returns half the diagonal.
     */
    getEffectiveRadius(): number {
        if (this._shape === 'disc') {
            return Math.max(this._width, this._height) * 0.5;
        }

        return Math.sqrt(this._width * this._width + this._height * this._height) * 0.5;
    }

    override serialize(): Record<string, unknown> {
        return {
            color: [this._color.x, this._color.y, this._color.z],
            intensity: this._intensity,
            width: this._width,
            height: this._height,
            shape: this._shape,
            range: this._range,
        };
    }

    override deserialize(data: Record<string, any>): void {
        const color =
            Array.isArray(data.color) && data.color.length === 3
                ? ([data.color[0], data.color[1], data.color[2]] as const)
                : undefined;
        const patch: AreaLightConfig = {
            ...(color ? { color } : {}),
            ...(typeof data.intensity === 'number' ? { intensity: data.intensity } : {}),
            ...(typeof data.width === 'number' ? { width: data.width } : {}),
            ...(typeof data.height === 'number' ? { height: data.height } : {}),
            ...(typeof data.shape === 'string' ? { shape: data.shape as AreaLightShape } : {}),
            ...(typeof data.range === 'number' ? { range: data.range } : {}),
        };

        this._applyConfig(patch);
    }

    private _applyConfig(config: AreaLightConfig): void {
        if (config.color !== undefined) {
            this._color = toVec3(config.color, Vec3.ONE);
        }

        if (typeof config.intensity === 'number') {
            this._intensity = Math.max(0, config.intensity);
        }

        if (typeof config.width === 'number') {
            this._width = Math.max(0.001, config.width);
        }

        if (typeof config.height === 'number') {
            this._height = Math.max(0.001, config.height);
        }

        if (config.shape !== undefined) {
            this._shape = normalizeShape(config.shape);
        }

        if (typeof config.range === 'number') {
            this._range = Math.max(0.001, config.range);
        }
    }
}
