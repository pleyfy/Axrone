import { Vec3 } from '@axrone/numeric';
import { createPointLightDefinition } from '@axrone/lighting';
import { Transform } from '@axrone/ecs-runtime';
import { Component } from '@axrone/ecs-runtime';
import { script } from '@axrone/ecs-runtime';

export interface PointLightConfig {
    readonly color?: Vec3 | readonly [number, number, number];
    readonly intensity?: number;
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

@script({
    scriptName: 'PointLight',
    priority: 650,
    executeInEditMode: true,
    singleton: false,
})
export class PointLight extends Component {
    private _color: Vec3;
    private _intensity: number;
    private _range: number;

    constructor(config: PointLightConfig = {}) {
        super();
        this._color = Vec3.ONE.clone();
        this._intensity = 1;
        this._range = 8;
        this._applyConfig(config);
    }

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

    get range(): number {
        return this._range;
    }

    set range(value: number) {
        this._applyConfig({ range: value });
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
            color: [this._color.x, this._color.y, this._color.z],
            intensity: this._intensity,
            range: this._range,
        };
    }

    override deserialize(data: Record<string, any>): void {
        const color =
            Array.isArray(data.color) && data.color.length === 3
                ? ([data.color[0], data.color[1], data.color[2]] as const)
                : undefined;
        const patch: PointLightConfig = {
            ...(color ? { color } : {}),
            ...(typeof data.intensity === 'number' ? { intensity: data.intensity } : {}),
            ...(typeof data.range === 'number' ? { range: data.range } : {}),
        };

        this._applyConfig(patch);
    }

    private _applyConfig(config: PointLightConfig): void {
        const definition = createPointLightDefinition(
            {
                color: config.color ?? this._color,
                intensity: config.intensity ?? this._intensity,
                range: config.range ?? this._range,
            },
            'scene-runtime:point-light'
        );

        this._color = Vec3.from(definition.color);
        this._intensity = definition.intensity;
        this._range = definition.range;
    }
}
