import { Quat, Vec3 } from '@axrone/numeric';
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
        this._color = toVec3(config.color, Vec3.ONE);
        this._intensity = config.intensity ?? 1;
        this._range = config.range ?? 8;
        this._innerConeAngle = config.innerConeAngle ?? Math.PI / 8;
        this._outerConeAngle = config.outerConeAngle ?? Math.PI / 4;
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

    get innerConeAngle(): number {
        return this._innerConeAngle;
    }

    set innerConeAngle(value: number) {
        this._innerConeAngle = value;
    }

    get outerConeAngle(): number {
        return this._outerConeAngle;
    }

    set outerConeAngle(value: number) {
        this._outerConeAngle = value;
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
        if (Array.isArray(data.color) && data.color.length === 3) {
            this._color = Vec3.fromArray(data.color);
        }
        if (typeof data.intensity === 'number') {
            this._intensity = data.intensity;
        }
        if (typeof data.range === 'number') {
            this._range = data.range;
        }
        if (typeof data.innerConeAngle === 'number') {
            this._innerConeAngle = data.innerConeAngle;
        }
        if (typeof data.outerConeAngle === 'number') {
            this._outerConeAngle = data.outerConeAngle;
        }
    }
}
