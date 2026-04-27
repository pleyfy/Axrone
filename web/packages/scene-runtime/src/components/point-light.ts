import { Vec3 } from '@axrone/numeric';
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
        this._color = toVec3(config.color, Vec3.ONE);
        this._intensity = config.intensity ?? 1;
        this._range = config.range ?? 8;
    }

    get color(): Vec3 {
        return this._color;
    }

    set color(value: Vec3 | readonly [number, number, number]) {
        this._color = toVec3(value, Vec3.ONE);
    }

    get intensity(): number {
        return this._intensity;
    }

    set intensity(value: number) {
        this._intensity = value;
    }

    get range(): number {
        return this._range;
    }

    set range(value: number) {
        this._range = value;
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
        if (Array.isArray(data.color) && data.color.length === 3) {
            this._color = Vec3.fromArray(data.color);
        }
        if (typeof data.intensity === 'number') {
            this._intensity = data.intensity;
        }
        if (typeof data.range === 'number') {
            this._range = data.range;
        }
    }
}
