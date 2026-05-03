import { Quat, Vec3 } from '@axrone/numeric';
import { createSpotLightDefinition } from '@axrone/lighting';
import { Transform } from '@axrone/ecs-runtime';
import { Component } from '@axrone/ecs-runtime';
import { script } from '@axrone/ecs-runtime';

export interface SpotLightConfig {
    readonly color?: Vec3 | readonly [number, number, number];
    readonly intensity?: number;
    readonly range?: number;
    readonly innerConeAngle?: number;
    readonly outerConeAngle?: number;
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

const clampCosine = (value: number): number => Math.min(1, Math.max(-1, value));

@script({
    scriptName: 'SpotLight',
    priority: 675,
    executeInEditMode: true,
    singleton: false,
})
export class SpotLight extends Component {
    private _color: Vec3;
    private _intensity: number;
    private _range: number;
    private _innerConeAngle: number;
    private _outerConeAngle: number;

    constructor(config: SpotLightConfig = {}) {
        super();
        this._color = Vec3.ONE.clone();
        this._intensity = 1;
        this._range = 8;
        this._innerConeAngle = Math.PI / 8;
        this._outerConeAngle = Math.PI / 4;
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

    get innerConeAngle(): number {
        return this._innerConeAngle;
    }

    set innerConeAngle(value: number) {
        this._applyConfig({ innerConeAngle: value });
    }

    get outerConeAngle(): number {
        return this._outerConeAngle;
    }

    set outerConeAngle(value: number) {
        this._applyConfig({ outerConeAngle: value });
    }

    getWorldPosition(): Vec3 {
        const transform = this.transform as Transform | undefined;
        if (!transform) {
            return Vec3.ZERO.clone();
        }

        return transform.worldPosition.clone();
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
            intensity: this._intensity,
            range: this._range,
            innerConeAngle: this._innerConeAngle,
            outerConeAngle: this._outerConeAngle,
        };
    }

    override deserialize(data: Record<string, any>): void {
        const color =
            Array.isArray(data.color) && data.color.length === 3
                ? ([data.color[0], data.color[1], data.color[2]] as const)
                : undefined;
        const patch: SpotLightConfig = {
            ...(color ? { color } : {}),
            ...(typeof data.intensity === 'number' ? { intensity: data.intensity } : {}),
            ...(typeof data.range === 'number' ? { range: data.range } : {}),
            ...(typeof data.innerConeAngle === 'number' ? { innerConeAngle: data.innerConeAngle } : {}),
            ...(typeof data.outerConeAngle === 'number' ? { outerConeAngle: data.outerConeAngle } : {}),
        };

        this._applyConfig(patch);
    }

    private _applyConfig(config: SpotLightConfig): void {
        const definition = createSpotLightDefinition(
            {
                color: config.color ?? this._color,
                intensity: config.intensity ?? this._intensity,
                range: config.range ?? this._range,
                coneMode: 'angle',
                innerConeAngle: config.innerConeAngle ?? this._innerConeAngle,
                outerConeAngle: config.outerConeAngle ?? this._outerConeAngle,
            },
            'scene-runtime:spot-light'
        );

        this._color = Vec3.from(definition.color);
        this._intensity = definition.intensity;
        this._range = definition.range;
        this._innerConeAngle = Math.acos(clampCosine(definition.innerConeCosine));
        this._outerConeAngle = Math.acos(clampCosine(definition.outerConeCosine));
    }
}
