import { Quat, Vec3 } from '@axrone/numeric';
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
        this._color = toVec3(config.color, Vec3.ONE);
        this._ambientColor = toVec3(config.ambientColor, new Vec3(0.06, 0.06, 0.08));
        this._intensity = config.intensity ?? 1;
        this._primary = config.primary ?? false;
    }

    get color(): Vec3 {
        return this._color;
    }

    set color(value: Vec3 | readonly [number, number, number]) {
        this._color = toVec3(value, Vec3.ONE);
    }

    get ambientColor(): Vec3 {
        return this._ambientColor;
    }

    set ambientColor(value: Vec3 | readonly [number, number, number]) {
        this._ambientColor = toVec3(value, new Vec3(0.06, 0.06, 0.08));
    }

    get intensity(): number {
        return this._intensity;
    }

    set intensity(value: number) {
        this._intensity = value;
    }

    get primary(): boolean {
        return this._primary;
    }

    set primary(value: boolean) {
        this._primary = value;
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
        if (Array.isArray(data.color) && data.color.length === 3) {
            this._color = Vec3.fromArray(data.color);
        }
        if (Array.isArray(data.ambientColor) && data.ambientColor.length === 3) {
            this._ambientColor = Vec3.fromArray(data.ambientColor);
        }
        if (typeof data.intensity === 'number') {
            this._intensity = data.intensity;
        }
        if (typeof data.primary === 'boolean') {
            this._primary = data.primary;
        }
    }
}
