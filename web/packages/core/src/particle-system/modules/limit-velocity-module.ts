import type { LimitVelocityConfiguration } from '../core/configuration';
import type { IParticleBuffer } from '../core/interfaces';
import { BaseModule } from './base-module';

export class LimitVelocityModule extends BaseModule<'limitVelocity'> {
    private _tempVelocity = { x: 0, y: 0, z: 0 };

    constructor(configuration: LimitVelocityConfiguration) {
        super('limitVelocity', configuration, 300);
    }

    protected onInitialize(): void {}

    protected onDestroy(): void {}

    protected onReset(): void {}

    protected onUpdate(deltaTime: number): void {}

    protected onProcess(particles: IParticleBuffer, deltaTime: number): void {
        if (!this.config.enabled) return;

        const config = this.config;
        const velocities = particles.velocities as Float32Array;
        const ages = particles.ages as Float32Array;
        const lifetimes = particles.lifetimes as Float32Array;
        const sizes = particles.sizes as Float32Array;
        const alive = particles.alive as Uint32Array;
        const count = particles.count;

        for (let i = 0; i < count; i++) {
            if (!alive[i]) continue;

            const i3 = i * 3;
            const normalizedAge = lifetimes[i] > 0 ? ages[i] / lifetimes[i] : 0;

            this._tempVelocity.x = velocities[i3];
            this._tempVelocity.y = velocities[i3 + 1];
            this._tempVelocity.z = velocities[i3 + 2];

            if (config.separateAxes) {
                this._limitVelocityAxisSeparate(i, normalizedAge, sizes[i], deltaTime);
            } else {
                this._limitVelocityMagnitude(i, normalizedAge, sizes[i], deltaTime);
            }

            this._applyDrag(i, normalizedAge, sizes[i], deltaTime);

            velocities[i3] = this._tempVelocity.x;
            velocities[i3 + 1] = this._tempVelocity.y;
            velocities[i3 + 2] = this._tempVelocity.z;
        }
    }

    protected onConfigure(
        newConfig: LimitVelocityConfiguration,
        oldConfig: LimitVelocityConfiguration
    ): void {}

    private _limitVelocityAxisSeparate(
        particleIndex: number,
        normalizedAge: number,
        particleSize: number,
        deltaTime: number
    ): void {
        const config = this.config;

        const speedX = this._evaluateSpeedX(config.speedX, normalizedAge);
        const speedY = this._evaluateSpeedY(config.speedY, normalizedAge);
        const speedZ = this._evaluateSpeedZ(config.speedZ, normalizedAge);

        if (Math.abs(this._tempVelocity.x) > speedX) {
            this._tempVelocity.x = Math.sign(this._tempVelocity.x) * speedX;
        }

        if (Math.abs(this._tempVelocity.y) > speedY) {
            this._tempVelocity.y = Math.sign(this._tempVelocity.y) * speedY;
        }

        if (Math.abs(this._tempVelocity.z) > speedZ) {
            this._tempVelocity.z = Math.sign(this._tempVelocity.z) * speedZ;
        }
    }

    private _limitVelocityMagnitude(
        particleIndex: number,
        normalizedAge: number,
        particleSize: number,
        deltaTime: number
    ): void {
        const config = this.config;

        const maxSpeed = this._evaluateSpeed(config.speed, normalizedAge);

        const currentSpeed = Math.sqrt(
            this._tempVelocity.x * this._tempVelocity.x +
                this._tempVelocity.y * this._tempVelocity.y +
                this._tempVelocity.z * this._tempVelocity.z
        );

        if (currentSpeed > maxSpeed && currentSpeed > 0) {
            const scale = maxSpeed / currentSpeed;
            this._tempVelocity.x *= scale;
            this._tempVelocity.y *= scale;
            this._tempVelocity.z *= scale;
        }
    }

    private _applyDrag(
        particleIndex: number,
        normalizedAge: number,
        particleSize: number,
        deltaTime: number
    ): void {
        const config = this.config;

        let dragValue = this._evaluateDrag(config.drag, normalizedAge);

        if (config.multiplyDragByParticleSize) {
            dragValue *= particleSize;
        }

        if (config.multiplyDragByParticleVelocity) {
            const currentSpeed = Math.sqrt(
                this._tempVelocity.x * this._tempVelocity.x +
                    this._tempVelocity.y * this._tempVelocity.y +
                    this._tempVelocity.z * this._tempVelocity.z
            );
            dragValue *= currentSpeed;
        }

        const dampenFactor = 1.0 - config.dampen * deltaTime;

        const totalDrag = Math.max(0, Math.min(1, dragValue * deltaTime));
        const combinedFactor = dampenFactor * (1.0 - totalDrag);

        this._tempVelocity.x *= combinedFactor;
        this._tempVelocity.y *= combinedFactor;
        this._tempVelocity.z *= combinedFactor;
    }

    private _evaluateSpeed(curve: LimitVelocityConfiguration['speed'], t: number): number {
        switch (curve.mode) {
            case 0:
                return curve.constant;
            case 2:
                return curve.constantMin + (curve.constantMax - curve.constantMin) * t;
            default:
                return curve.constant;
        }
    }

    private _evaluateSpeedX(curve: LimitVelocityConfiguration['speedX'], t: number): number {
        return this._evaluateSpeed(curve, t);
    }

    private _evaluateSpeedY(curve: LimitVelocityConfiguration['speedY'], t: number): number {
        return this._evaluateSpeed(curve, t);
    }

    private _evaluateSpeedZ(curve: LimitVelocityConfiguration['speedZ'], t: number): number {
        return this._evaluateSpeed(curve, t);
    }

    private _evaluateDrag(curve: LimitVelocityConfiguration['drag'], t: number): number {
        switch (curve.mode) {
            case 0:
                return curve.constant;
            case 2:
                return curve.constantMin + (curve.constantMax - curve.constantMin) * t;
            default:
                return curve.constant;
        }
    }

    getEffectiveSpeedLimit(
        particleIndex: number,
        particleBuffer: IParticleBuffer
    ): number | { x: number; y: number; z: number } {
        const ages = particleBuffer.ages as Float32Array;
        const lifetimes = particleBuffer.lifetimes as Float32Array;
        const normalizedAge =
            lifetimes[particleIndex] > 0 ? ages[particleIndex] / lifetimes[particleIndex] : 0;

        if (this.config.separateAxes) {
            return {
                x: this._evaluateSpeedX(this.config.speedX, normalizedAge),
                y: this._evaluateSpeedY(this.config.speedY, normalizedAge),
                z: this._evaluateSpeedZ(this.config.speedZ, normalizedAge),
            };
        } else {
            return this._evaluateSpeed(this.config.speed, normalizedAge);
        }
    }

    getEffectiveDrag(particleIndex: number, particleBuffer: IParticleBuffer): number {
        const ages = particleBuffer.ages as Float32Array;
        const lifetimes = particleBuffer.lifetimes as Float32Array;
        const sizes = particleBuffer.sizes as Float32Array;
        const normalizedAge =
            lifetimes[particleIndex] > 0 ? ages[particleIndex] / lifetimes[particleIndex] : 0;

        let dragValue = this._evaluateDrag(this.config.drag, normalizedAge);

        if (this.config.multiplyDragByParticleSize) {
            dragValue *= sizes[particleIndex];
        }

        return dragValue;
    }
}
