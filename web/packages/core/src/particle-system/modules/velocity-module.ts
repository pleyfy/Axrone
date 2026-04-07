import type { IVec3Like } from '@axrone/numeric';
import type { VelocityConfiguration } from '../core/configuration';
import type { IParticleBuffer } from '../core/interfaces';
import type { ParticleId } from '../types';
import { BaseModule } from './base-module';

interface VelocityState {
    initialVelocity: IVec3Like;
    currentVelocity: IVec3Like;
    acceleration: IVec3Like;
    lastPosition: IVec3Like;
    distance: number;
}

export class VelocityModule extends BaseModule<'velocity'> {
    private _particleStates = new Map<ParticleId, VelocityState>();
    private _velocityBuffer: Float32Array;
    private _accelerationBuffer: Float32Array;
    private _maxParticles: number;
    private _gravityAcceleration = { x: 0, y: -9.81, z: 0 };

    constructor(configuration: VelocityConfiguration) {
        super('velocity', configuration, 200);
        this._maxParticles = 10000;
        this._velocityBuffer = new Float32Array(this._maxParticles * 3);
        this._accelerationBuffer = new Float32Array(this._maxParticles * 3);
    }

    protected onInitialize(): void {
        this._particleStates.clear();

        this._velocityBuffer.fill(0);
        this._accelerationBuffer.fill(0);

        if (this.config.gravityModifier !== 0) {
            this._gravityAcceleration.y = -9.81 * this.config.gravityModifier;
        }
    }

    protected onDestroy(): void {
        this._particleStates.clear();
    }

    protected onReset(): void {
        this._particleStates.clear();
        this._velocityBuffer.fill(0);
        this._accelerationBuffer.fill(0);
    }

    protected onUpdate(deltaTime: number): void {
        this._updateGlobalForces(deltaTime);
    }

    protected onProcess(particles: IParticleBuffer, deltaTime: number): void {
        if (!this.config.enabled) return;

        const config = this.config;
        const positions = particles.positions as Float32Array;
        const velocities = particles.velocities as Float32Array;
        const ages = particles.ages as Float32Array;
        const lifetimes = particles.lifetimes as Float32Array;
        const alive = particles.alive as Uint32Array;
        const count = particles.count;

        for (let i = 0; i < count; i++) {
            if (!alive[i]) continue;

            const particleId = particles.getParticleId(i);
            const i3 = i * 3;
            const normalizedAge = lifetimes[i] > 0 ? ages[i] / lifetimes[i] : 0;

            let state = this._particleStates.get(particleId);
            if (!state) {
                state = this._createParticleState(i, positions, velocities);
                this._particleStates.set(particleId, state);
            }

            const currentPos = {
                x: positions[i3],
                y: positions[i3 + 1],
                z: positions[i3 + 2],
            };

            if (state.lastPosition) {
                const dx = currentPos.x - state.lastPosition.x;
                const dy = currentPos.y - state.lastPosition.y;
                const dz = currentPos.z - state.lastPosition.z;
                state.distance += Math.sqrt(dx * dx + dy * dy + dz * dz);
            }
            state.lastPosition = { ...currentPos };

            this._applyLinearVelocity(i, state, normalizedAge, deltaTime);
            this._applyOrbitalVelocity(i, state, currentPos, normalizedAge, deltaTime);
            this._applyRadialVelocity(i, state, currentPos, normalizedAge, deltaTime);
            this._applyVelocityOverLifetime(i, state, normalizedAge, deltaTime);
            this._applyInheritVelocity(i, state, normalizedAge, deltaTime);
            this._applyGravity(i, state, deltaTime);
            this._applyDamping(i, state, normalizedAge, deltaTime);

            velocities[i3] = state.currentVelocity.x;
            velocities[i3 + 1] = state.currentVelocity.y;
            velocities[i3 + 2] = state.currentVelocity.z;
        }

        this._cleanupDeadParticles(particles);
    }

    protected onConfigure(
        newConfig: VelocityConfiguration,
        oldConfig: VelocityConfiguration
    ): void {
        if (newConfig.gravityModifier !== oldConfig.gravityModifier) {
            this._gravityAcceleration.y = -9.81 * newConfig.gravityModifier;
        }

        if (this._significantConfigChange(newConfig, oldConfig)) {
            this._particleStates.clear();
        }
    }

    private _createParticleState(
        particleIndex: number,
        positions: Float32Array,
        velocities: Float32Array
    ): VelocityState {
        const i3 = particleIndex * 3;

        const initialVelocity = {
            x: velocities[i3],
            y: velocities[i3 + 1],
            z: velocities[i3 + 2],
        };

        return {
            initialVelocity: { ...initialVelocity },
            currentVelocity: { ...initialVelocity },
            acceleration: { x: 0, y: 0, z: 0 },
            lastPosition: {
                x: positions[i3],
                y: positions[i3 + 1],
                z: positions[i3 + 2],
            },
            distance: 0,
        };
    }

    private _updateGlobalForces(deltaTime: number): void {
        if (this.config.gravityModifier !== 0) {
            this._gravityAcceleration.y = -9.81 * this.config.gravityModifier;
        }
    }

    private _applyLinearVelocity(
        particleIndex: number,
        state: VelocityState,
        normalizedAge: number,
        deltaTime: number
    ): void {
        const config = this.config;

        const linearVelX = this._evaluateVectorCurve(config.linear, 'x', normalizedAge);
        const linearVelY = this._evaluateVectorCurve(config.linear, 'y', normalizedAge);
        const linearVelZ = this._evaluateVectorCurve(config.linear, 'z', normalizedAge);

        state.acceleration.x += linearVelX;
        state.acceleration.y += linearVelY;
        state.acceleration.z += linearVelZ;
    }

    private _applyOrbitalVelocity(
        particleIndex: number,
        state: VelocityState,
        position: IVec3Like,
        normalizedAge: number,
        deltaTime: number
    ): void {
        const config = this.config;

        const orbitalX = this._evaluateVectorCurve(config.orbital, 'x', normalizedAge);
        const orbitalY = this._evaluateVectorCurve(config.orbital, 'y', normalizedAge);
        const orbitalZ = this._evaluateVectorCurve(config.orbital, 'z', normalizedAge);

        if (orbitalX !== 0 || orbitalY !== 0 || orbitalZ !== 0) {
            const orbitalVel = {
                x: -position.y * orbitalZ + position.z * orbitalY,
                y: position.x * orbitalZ - position.z * orbitalX,
                z: -position.x * orbitalY + position.y * orbitalX,
            };

            state.currentVelocity.x += orbitalVel.x * deltaTime;
            state.currentVelocity.y += orbitalVel.y * deltaTime;
            state.currentVelocity.z += orbitalVel.z * deltaTime;
        }
    }

    private _applyRadialVelocity(
        particleIndex: number,
        state: VelocityState,
        position: IVec3Like,
        normalizedAge: number,
        deltaTime: number
    ): void {
        const config = this.config;
        const radialVel = this._evaluateCurve(config.radial, normalizedAge);

        if (radialVel !== 0) {
            const length = Math.sqrt(
                position.x * position.x + position.y * position.y + position.z * position.z
            );

            if (length > 0.001) {
                const invLength = 1 / length;
                const radialDir = {
                    x: position.x * invLength,
                    y: position.y * invLength,
                    z: position.z * invLength,
                };

                state.currentVelocity.x += radialDir.x * radialVel * deltaTime;
                state.currentVelocity.y += radialDir.y * radialVel * deltaTime;
                state.currentVelocity.z += radialDir.z * radialVel * deltaTime;
            }
        }
    }

    private _applyVelocityOverLifetime(
        particleIndex: number,
        state: VelocityState,
        normalizedAge: number,
        deltaTime: number
    ): void {
        const config = this.config;

        const velocityMultiplier = this._evaluateCurve(config.velocityOverLifetime, normalizedAge);

        if (Math.abs(velocityMultiplier - 1.0) > 0.001) {
            const factor = velocityMultiplier;
            state.currentVelocity.x *= factor;
            state.currentVelocity.y *= factor;
            state.currentVelocity.z *= factor;
        }
    }

    private _applyInheritVelocity(
        particleIndex: number,
        state: VelocityState,
        normalizedAge: number,
        deltaTime: number
    ): void {
        const config = this.config;

        if (config.inheritVelocity !== 0) {
            const inheritFactor = config.inheritVelocity;

            const emitterVelocity = { x: 0, y: 0, z: 0 };

            state.currentVelocity.x += emitterVelocity.x * inheritFactor;
            state.currentVelocity.y += emitterVelocity.y * inheritFactor;
            state.currentVelocity.z += emitterVelocity.z * inheritFactor;
        }
    }

    private _applyGravity(particleIndex: number, state: VelocityState, deltaTime: number): void {
        if (this.config.gravityModifier !== 0) {
            state.currentVelocity.x += this._gravityAcceleration.x * deltaTime;
            state.currentVelocity.y += this._gravityAcceleration.y * deltaTime;
            state.currentVelocity.z += this._gravityAcceleration.z * deltaTime;
        }
    }

    private _applyDamping(
        particleIndex: number,
        state: VelocityState,
        normalizedAge: number,
        deltaTime: number
    ): void {
        const config = this.config;
        const dampingFactor = this._evaluateCurve(config.damping, normalizedAge);

        if (dampingFactor !== 0) {
            const damping = 1.0 - dampingFactor * deltaTime;
            const clampedDamping = Math.max(0, Math.min(1, damping));

            state.currentVelocity.x *= clampedDamping;
            state.currentVelocity.y *= clampedDamping;
            state.currentVelocity.z *= clampedDamping;
        }
    }

    private _cleanupDeadParticles(particles: IParticleBuffer): void {
        const alive = particles.alive as Uint32Array;

        for (const [particleId, state] of this._particleStates.entries()) {
            const particleIndex = particles.getParticleIndex(particleId);
            if (particleIndex === -1 || !alive[particleIndex]) {
                this._particleStates.delete(particleId);
            }
        }
    }

    private _significantConfigChange(
        newConfig: VelocityConfiguration,
        oldConfig: VelocityConfiguration
    ): boolean {
        return (
            newConfig.space !== oldConfig.space ||
            newConfig.gravityModifier !== oldConfig.gravityModifier
        );
    }

    private _evaluateCurve(curve: any, t: number): number {
        if (!curve) return 0;

        switch (curve.mode) {
            case 0:
                return curve.constant;
            case 2:
                return curve.constantMin + (curve.constantMax - curve.constantMin) * t;
            default:
                return curve.constant || 0;
        }
    }

    private _evaluateVectorCurve(vectorCurve: any, component: 'x' | 'y' | 'z', t: number): number {
        if (!vectorCurve || !vectorCurve[component]) return 0;
        return this._evaluateCurve(vectorCurve[component], t);
    }

    getParticleVelocity(particleId: ParticleId): IVec3Like | null {
        const state = this._particleStates.get(particleId);
        return state ? { ...state.currentVelocity } : null;
    }

    getParticleAcceleration(particleId: ParticleId): IVec3Like | null {
        const state = this._particleStates.get(particleId);
        return state ? { ...state.acceleration } : null;
    }

    getParticleDistance(particleId: ParticleId): number {
        const state = this._particleStates.get(particleId);
        return state ? state.distance : 0;
    }

    setGravity(gravity: IVec3Like): void {
        this._gravityAcceleration = { ...gravity };
    }

    getGravity(): IVec3Like {
        return { ...this._gravityAcceleration };
    }

    getActiveParticleCount(): number {
        return this._particleStates.size;
    }

    getAverageSpeed(): number {
        if (this._particleStates.size === 0) return 0;

        let totalSpeed = 0;
        for (const state of this._particleStates.values()) {
            const vel = state.currentVelocity;
            totalSpeed += Math.sqrt(vel.x * vel.x + vel.y * vel.y + vel.z * vel.z);
        }

        return totalSpeed / this._particleStates.size;
    }
}
