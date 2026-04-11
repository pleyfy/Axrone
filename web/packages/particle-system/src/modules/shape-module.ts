import type { IVec3Like, Vec3 } from '@axrone/numeric';
import type { ShapeConfiguration } from '../core/configuration';
import type { IParticleBuffer } from '../core/interfaces';
import { EmitterShape } from '../types';
import { BaseModule } from './base-module';

export class ShapeModule extends BaseModule<'shape'> {
    private _cachedDirection = { x: 0, y: 1, z: 0 };

    constructor(configuration: ShapeConfiguration) {
        super('shape', configuration, 50);
    }

    protected onInitialize(): void {
        this._updateCachedDirection();
    }

    protected onDestroy(): void {}

    protected onReset(): void {
        this._updateCachedDirection();
    }

    protected onUpdate(deltaTime: number): void {}

    protected onProcess(particles: IParticleBuffer, deltaTime: number): void {}

    protected onConfigure(newConfig: ShapeConfiguration, oldConfig: ShapeConfiguration): void {
        if (newConfig.shape !== oldConfig.shape || newConfig.rotation !== oldConfig.rotation) {
            this._updateCachedDirection();
        }
    }

    getEmissionPosition(): IVec3Like {
        const config = this.config;
        const position = { ...config.position };

        switch (config.shape) {
            case EmitterShape.Point:
                break;

            case EmitterShape.Sphere:
                this._applySpherePosition(position, config.radius, config.radiusThickness);
                break;

            case EmitterShape.Hemisphere:
                this._applyHemispherePosition(position, config.radius, config.radiusThickness);
                break;

            case EmitterShape.Circle:
                this._applyCirclePosition(position, config.radius, config.radiusThickness);
                break;

            case EmitterShape.Box:
                this._applyBoxPosition(position, config.boxSize);
                break;

            case EmitterShape.Cone:
                this._applyConePosition(position, config.radius, config.angle, config.length);
                break;

            case EmitterShape.Line:
                this._applyLinePosition(position, config.length);
                break;

            default:
                break;
        }

        if (config.randomizePosition) {
            const noise = 0.1;
            position.x += (Math.random() - 0.5) * noise;
            position.y += (Math.random() - 0.5) * noise;
            position.z += (Math.random() - 0.5) * noise;
        }

        return position;
    }

    getEmissionDirection(): IVec3Like {
        const config = this.config;
        let direction = { ...this._cachedDirection };

        if (config.alignToDirection) {
            switch (config.shape) {
                case EmitterShape.Sphere:
                case EmitterShape.Hemisphere:
                    direction = this._getRadialDirection();
                    break;

                case EmitterShape.Cone:
                    direction = this._getConeDirection(config.angle);
                    break;

                default:
                    break;
            }
        }

        if (config.randomizeDirection) {
            const randomAngle = Math.random() * Math.PI * 2;
            const randomPitch = (Math.random() - 0.5) * Math.PI * 0.5;

            direction.x += Math.cos(randomAngle) * Math.cos(randomPitch) * 0.5;
            direction.y += Math.sin(randomPitch) * 0.5;
            direction.z += Math.sin(randomAngle) * Math.cos(randomPitch) * 0.5;
        }

        if (config.spherizeDirection) {
            const length = Math.sqrt(direction.x ** 2 + direction.y ** 2 + direction.z ** 2);
            if (length > 0) {
                direction.x /= length;
                direction.y /= length;
                direction.z /= length;
            }
        }

        return direction;
    }

    private _updateCachedDirection(): void {
        const config = this.config;
        const { x, y, z } = config.rotation;

        const cosY = Math.cos(y);
        const sinY = Math.sin(y);

        this._cachedDirection = {
            x: sinY,
            y: 0,
            z: cosY,
        };
    }

    private _applySpherePosition(position: IVec3Like, radius: number, thickness: number): void {
        const phi = Math.random() * Math.PI * 2;
        const cosTheta = Math.random() * 2 - 1;
        const sinTheta = Math.sqrt(1 - cosTheta * cosTheta);

        const r = radius * (thickness + (1 - thickness) * Math.random());

        position.x += r * sinTheta * Math.cos(phi);
        position.y += r * cosTheta;
        position.z += r * sinTheta * Math.sin(phi);
    }

    private _applyHemispherePosition(position: IVec3Like, radius: number, thickness: number): void {
        const phi = Math.random() * Math.PI * 2;
        const cosTheta = Math.random();
        const sinTheta = Math.sqrt(1 - cosTheta * cosTheta);

        const r = radius * (thickness + (1 - thickness) * Math.random());

        position.x += r * sinTheta * Math.cos(phi);
        position.y += r * cosTheta;
        position.z += r * sinTheta * Math.sin(phi);
    }

    private _applyCirclePosition(position: IVec3Like, radius: number, thickness: number): void {
        const angle = Math.random() * Math.PI * 2;
        const r = radius * (thickness + (1 - thickness) * Math.random());

        position.x += r * Math.cos(angle);
        position.z += r * Math.sin(angle);
    }

    private _applyBoxPosition(position: IVec3Like, size: IVec3Like): void {
        position.x += (Math.random() - 0.5) * size.x;
        position.y += (Math.random() - 0.5) * size.y;
        position.z += (Math.random() - 0.5) * size.z;
    }

    private _applyConePosition(
        position: IVec3Like,
        radius: number,
        angle: number,
        length: number
    ): void {
        const height = Math.random() * length;
        const coneRadius = radius * (height / length) * Math.tan(angle * 0.5);

        const phi = Math.random() * Math.PI * 2;
        const r = coneRadius * Math.random();

        position.x += r * Math.cos(phi);
        position.y += height;
        position.z += r * Math.sin(phi);
    }

    private _applyLinePosition(position: IVec3Like, length: number): void {
        position.y += (Math.random() - 0.5) * length;
    }

    private _getRadialDirection(): IVec3Like {
        const phi = Math.random() * Math.PI * 2;
        const cosTheta = Math.random() * 2 - 1;
        const sinTheta = Math.sqrt(1 - cosTheta * cosTheta);

        return {
            x: sinTheta * Math.cos(phi),
            y: cosTheta,
            z: sinTheta * Math.sin(phi),
        };
    }

    private _getConeDirection(angle: number): IVec3Like {
        const maxAngle = angle * 0.5;
        const theta = Math.random() * maxAngle;
        const phi = Math.random() * Math.PI * 2;

        const sinTheta = Math.sin(theta);
        const cosTheta = Math.cos(theta);

        return {
            x: sinTheta * Math.cos(phi),
            y: cosTheta,
            z: sinTheta * Math.sin(phi),
        };
    }
}
