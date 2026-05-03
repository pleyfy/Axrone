import { Quat, Vec3 } from '@axrone/numeric';
import { createDirectionalLightDefinition } from '@axrone/lighting';
import { Transform } from '@axrone/ecs-runtime';
import { Component } from '@axrone/ecs-runtime';
import { script } from '@axrone/ecs-runtime';

export interface DirectionalLightConfig {
    readonly color?: Vec3 | readonly [number, number, number];
    readonly ambientColor?: Vec3 | readonly [number, number, number];
    readonly intensity?: number;
    readonly primary?: boolean;
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

const DEFAULT_AMBIENT_COLOR = Object.freeze(new Vec3(0.06, 0.06, 0.08));

@script({
    scriptName: 'DirectionalLight',
    priority: 700,
    executeInEditMode: true,
    singleton: false,
})
export class DirectionalLight extends Component {
    private _color: Vec3;
    private _ambientColor: Vec3;
    private _intensity: number;
    private _primary: boolean;

    constructor(config: DirectionalLightConfig = {}) {
        super();
        this._color = Vec3.ONE.clone();
        this._ambientColor = Vec3.from(DEFAULT_AMBIENT_COLOR);
        this._intensity = 1;
        this._primary = false;
        this._applyConfig(config);
    }

    get color(): Vec3 {
        return this._color;
    }

    set color(value: Vec3 | readonly [number, number, number]) {
        this._applyConfig({ color: value });
    }

    get ambientColor(): Vec3 {
        return this._ambientColor;
    }

    set ambientColor(value: Vec3 | readonly [number, number, number]) {
        this._applyConfig({ ambientColor: value });
    }

    get intensity(): number {
        return this._intensity;
    }

    set intensity(value: number) {
        this._applyConfig({ intensity: value });
    }

    get primary(): boolean {
        return this._primary;
    }

    set primary(value: boolean) {
        this._applyConfig({ primary: value });
    }

    getDirection(): Vec3 {
        const transform = this.transform as Transform | undefined;
        if (!transform) {
            return new Vec3(0, -1, 0);
        }

        const forward = Quat.rotateVector(transform.worldRotation, Vec3.FORWARD, new Vec3());
        return Vec3.normalize(forward, forward);
    }

    override serialize(): Record<string, unknown> {
        return {
            color: [this._color.x, this._color.y, this._color.z],
            ambientColor: [this._ambientColor.x, this._ambientColor.y, this._ambientColor.z],
            intensity: this._intensity,
            primary: this._primary,
        };
    }

    override deserialize(data: Record<string, any>): void {
        const color =
            Array.isArray(data.color) && data.color.length === 3
                ? ([data.color[0], data.color[1], data.color[2]] as const)
                : undefined;
        const ambientColor =
            Array.isArray(data.ambientColor) && data.ambientColor.length === 3
                ? ([data.ambientColor[0], data.ambientColor[1], data.ambientColor[2]] as const)
                : undefined;
        const patch: DirectionalLightConfig = {
            ...(color ? { color } : {}),
            ...(ambientColor ? { ambientColor } : {}),
            ...(typeof data.intensity === 'number' ? { intensity: data.intensity } : {}),
            ...(typeof data.primary === 'boolean' ? { primary: data.primary } : {}),
        };

        this._applyConfig(patch);
    }

    private _applyConfig(config: DirectionalLightConfig): void {
        const definition = createDirectionalLightDefinition(
            {
                color: config.color ?? this._color,
                ambient: config.ambientColor ?? this._ambientColor,
                intensity: config.intensity ?? this._intensity,
            },
            'scene-runtime:directional-light'
        );

        this._color = Vec3.from(definition.color);
        this._ambientColor = Vec3.from(definition.ambient);
        this._intensity = definition.intensity;
        this._primary = config.primary ?? this._primary;
    }
}
