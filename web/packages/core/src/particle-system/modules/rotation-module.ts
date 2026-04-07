import type { RotationConfiguration } from '../core/configuration';
import type { IParticleBuffer } from '../core/interfaces';
import type { ICurve } from '../interfaces';
import { BaseModule } from './base-module';
import { CurveEvaluator } from '../curve-evaluator';

export enum RotationMode {
    Constant = 'constant',
    OverLifetime = 'overLifetime',
    BySpeed = 'bySpeed',
    ByPosition = 'byPosition',
    ByVelocity = 'byVelocity',
    Orbital = 'orbital',
    Physics = 'physics',
}

export enum RotationSpace {
    Local = 'local',
    World = 'world',
    Velocity = 'velocity',
    Custom = 'custom',
}

export interface RotationConstraints {
    readonly minAngularVelocity: number;
    readonly maxAngularVelocity: number;
    readonly dampingFactor: number;
    readonly accelerationLimit: number;
    readonly enableInertia: boolean;
    readonly frictionCoefficient: number;
}

export interface RotationStats {
    readonly averageAngularVelocity: number;
    readonly maxAngularVelocity: number;
    readonly totalRotationalEnergy: number;
    readonly constraintViolations: number;
    readonly performanceMs: number;
}

class Quaternion {
    constructor(
        public x = 0,
        public y = 0,
        public z = 0,
        public w = 1
    ) {}

    static fromEuler(x: number, y: number, z: number): Quaternion {
        const cx = Math.cos(x * 0.5);
        const sx = Math.sin(x * 0.5);
        const cy = Math.cos(y * 0.5);
        const sy = Math.sin(y * 0.5);
        const cz = Math.cos(z * 0.5);
        const sz = Math.sin(z * 0.5);

        return new Quaternion(
            sx * cy * cz - cx * sy * sz,
            cx * sy * cz + sx * cy * sz,
            cx * cy * sz - sx * sy * cz,
            cx * cy * cz + sx * sy * sz
        );
    }

    static multiply(a: Quaternion, b: Quaternion): Quaternion {
        return new Quaternion(
            a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
            a.w * b.y + a.y * b.w + a.z * b.x - a.x * b.z,
            a.w * b.z + a.z * b.w + a.x * b.y - a.y * b.x,
            a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z
        );
    }

    normalize(): Quaternion {
        const length = Math.sqrt(
            this.x * this.x + this.y * this.y + this.z * this.z + this.w * this.w
        );
        if (length > 0) {
            this.x /= length;
            this.y /= length;
            this.z /= length;
            this.w /= length;
        }
        return this;
    }

    toEuler(): [number, number, number] {
        const test = this.x * this.y + this.z * this.w;

        if (test > 0.499) {
            return [2 * Math.atan2(this.x, this.w), Math.PI / 2, 0];
        }

        if (test < -0.499) {
            return [-2 * Math.atan2(this.x, this.w), -Math.PI / 2, 0];
        }

        const sqx = this.x * this.x;
        const sqy = this.y * this.y;
        const sqz = this.z * this.z;

        return [
            Math.atan2(2 * this.y * this.w - 2 * this.x * this.z, 1 - 2 * sqy - 2 * sqz),
            Math.asin(2 * test),
            Math.atan2(2 * this.x * this.w - 2 * this.y * this.z, 1 - 2 * sqx - 2 * sqz),
        ];
    }
}

export class RotationModule extends BaseModule<'rotation'> {
    private readonly _quaternions: Float32Array;
    private readonly _angularMomentum: Float32Array;
    private readonly _previousAngularVelocity: Float32Array;
    private readonly _rotationAcceleration: Float32Array;

    private readonly _stats: RotationStats = {
        averageAngularVelocity: 0,
        maxAngularVelocity: 0,
        totalRotationalEnergy: 0,
        constraintViolations: 0,
        performanceMs: 0,
    };

    private readonly _tempQuaternions = new Float32Array(4096);
    private readonly _tempEulers = new Float32Array(3072);
    private readonly _tempSeeds = new Uint32Array(1024);

    constructor(configuration: RotationConfiguration) {
        super('rotation', configuration, 500);

        const maxParticles = 10000;
        this._quaternions = new Float32Array(maxParticles * 4);
        this._angularMomentum = new Float32Array(maxParticles * 3);
        this._previousAngularVelocity = new Float32Array(maxParticles * 3);
        this._rotationAcceleration = new Float32Array(maxParticles * 3);

        for (let i = 0; i < maxParticles; i++) {
            this._quaternions[i * 4 + 3] = 1;
        }
    }

    protected onInitialize(): void {
        this._quaternions.fill(0);
        this._angularMomentum.fill(0);
        this._previousAngularVelocity.fill(0);
        this._rotationAcceleration.fill(0);

        for (let i = 0; i < this._quaternions.length / 4; i++) {
            this._quaternions[i * 4 + 3] = 1;
        }
    }

    protected onDestroy(): void {}

    protected onReset(): void {
        this.onInitialize();
        this._resetStats();
    }

    protected onUpdate(deltaTime: number): void {}

    protected onProcess(particles: IParticleBuffer, deltaTime: number): void {
        const config = this.config;
        if (!config.enabled) return;

        const startTime = performance.now();
        this._resetStats();

        const rotations = particles.rotations as Float32Array;
        const angularVelocities = particles.angularVelocities as Float32Array;
        const velocities = particles.velocities as Float32Array;
        const positions = particles.positions as Float32Array;
        const ages = particles.ages as Float32Array;
        const lifetimes = particles.lifetimes as Float32Array;
        const alive = particles.alive as Uint32Array;
        const count = particles.count;

        const batchSize = Math.min(1024, count);

        for (let batchStart = 0; batchStart < count; batchStart += batchSize) {
            const batchEnd = Math.min(batchStart + batchSize, count);
            const batchCount = batchEnd - batchStart;

            this._processBatch(
                rotations,
                angularVelocities,
                velocities,
                positions,
                ages,
                lifetimes,
                alive,
                batchStart,
                batchCount,
                deltaTime
            );
        }

        const stats = this._stats as any;
        stats.performanceMs = performance.now() - startTime;
    }

    protected onConfigure(
        newConfig: RotationConfiguration,
        oldConfig: RotationConfiguration
    ): void {
        if (newConfig.mode !== oldConfig.mode) {
            this.onReset();
        }
    }

    getParticleQuaternion(particleIndex: number): Quaternion {
        const i4 = particleIndex * 4;
        return new Quaternion(
            this._quaternions[i4],
            this._quaternions[i4 + 1],
            this._quaternions[i4 + 2],
            this._quaternions[i4 + 3]
        );
    }

    setParticleQuaternion(particleIndex: number, quaternion: Quaternion): void {
        const i4 = particleIndex * 4;
        this._quaternions[i4] = quaternion.x;
        this._quaternions[i4 + 1] = quaternion.y;
        this._quaternions[i4 + 2] = quaternion.z;
        this._quaternions[i4 + 3] = quaternion.w;
    }

    getStats(): RotationStats {
        return { ...this._stats };
    }

    private _processBatch(
        rotations: Float32Array,
        angularVelocities: Float32Array,
        velocities: Float32Array,
        positions: Float32Array,
        ages: Float32Array,
        lifetimes: Float32Array,
        alive: Uint32Array,
        startIndex: number,
        count: number,
        deltaTime: number
    ): void {
        const config = this.config;

        for (let i = 0; i < count; i++) {
            const particleIndex = startIndex + i;
            if (!alive[particleIndex]) continue;

            const i3 = particleIndex * 3;
            const i4 = particleIndex * 4;

            const age = ages[particleIndex];
            const lifetime = lifetimes[particleIndex];
            const normalizedAge = lifetime > 0 ? age / lifetime : 0;

            const seed = particleIndex * 31 + Math.floor(age * 1000);

            let angularVel: [number, number, number] = [0, 0, 0];

            switch (config.mode) {
                case 'constant':
                    angularVel = this._calculateConstantRotation(config, seed);
                    break;

                case 'overLifetime':
                    angularVel = this._calculateLifetimeRotation(config, normalizedAge, seed);
                    break;

                case 'bySpeed':
                    angularVel = this._calculateSpeedBasedRotation(
                        config,
                        velocities,
                        i3,
                        normalizedAge,
                        seed
                    );
                    break;

                case 'byPosition':
                    angularVel = this._calculatePositionBasedRotation(
                        config,
                        positions,
                        i3,
                        normalizedAge,
                        seed
                    );
                    break;

                case 'byVelocity':
                    angularVel = this._calculateVelocityAlignedRotation(
                        config,
                        velocities,
                        i3,
                        normalizedAge,
                        seed
                    );
                    break;

                case 'orbital':
                    angularVel = this._calculateOrbitalRotation(
                        config,
                        positions,
                        velocities,
                        i3,
                        normalizedAge,
                        seed
                    );
                    break;

                case 'physics':
                    angularVel = this._calculatePhysicsRotation(
                        config,
                        particleIndex,
                        deltaTime,
                        normalizedAge,
                        seed
                    );
                    break;
            }

            angularVel = this._applyConstraints(config, angularVel, particleIndex);

            angularVelocities[i3] = angularVel[0];
            angularVelocities[i3 + 1] = angularVel[1];
            angularVelocities[i3 + 2] = angularVel[2];

            this._updateRotation(
                config,
                rotations,
                angularVel,
                velocities,
                i3,
                i4,
                particleIndex,
                deltaTime
            );

            this._updateStats(angularVel);
        }
    }

    private _calculateConstantRotation(
        config: RotationConfiguration,
        seed: number
    ): [number, number, number] {
        if (config.separateAxes) {
            const x = this._evaluateCurve(config.angularVelocityX, 0, seed);
            const y = this._evaluateCurve(config.angularVelocityY, 0, seed);
            const z = this._evaluateCurve(config.angularVelocityZ, 0, seed);
            return [x, y, z];
        } else {
            const z = this._evaluateCurve(config.angularVelocity, 0, seed);
            return [0, 0, z];
        }
    }

    private _calculateLifetimeRotation(
        config: RotationConfiguration,
        normalizedAge: number,
        seed: number
    ): [number, number, number] {
        if (config.separateAxes) {
            const x = this._evaluateCurve(config.angularVelocityX, normalizedAge, seed);
            const y = this._evaluateCurve(config.angularVelocityY, normalizedAge, seed);
            const z = this._evaluateCurve(config.angularVelocityZ, normalizedAge, seed);
            return [x, y, z];
        } else {
            const z = this._evaluateCurve(config.angularVelocity, normalizedAge, seed);
            return [0, 0, z];
        }
    }

    private _calculateSpeedBasedRotation(
        config: RotationConfiguration,
        velocities: Float32Array,
        i3: number,
        normalizedAge: number,
        seed: number
    ): [number, number, number] {
        const vx = velocities[i3];
        const vy = velocities[i3 + 1];
        const vz = velocities[i3 + 2];
        const speed = Math.sqrt(vx * vx + vy * vy + vz * vz);

        const speedFactor = speed * 0.1;
        const baseRotation = this._calculateLifetimeRotation(config, normalizedAge, seed);

        return [
            baseRotation[0] * speedFactor,
            baseRotation[1] * speedFactor,
            baseRotation[2] * speedFactor,
        ];
    }

    private _calculatePositionBasedRotation(
        config: RotationConfiguration,
        positions: Float32Array,
        i3: number,
        normalizedAge: number,
        seed: number
    ): [number, number, number] {
        const px = positions[i3];
        const py = positions[i3 + 1];
        const pz = positions[i3 + 2];

        const positionFactor = (Math.sin(px * 0.1) + Math.cos(py * 0.1) + Math.sin(pz * 0.1)) / 3;
        const baseRotation = this._calculateLifetimeRotation(config, normalizedAge, seed);

        return [
            baseRotation[0] * (1 + positionFactor * 0.5),
            baseRotation[1] * (1 + positionFactor * 0.5),
            baseRotation[2] * (1 + positionFactor * 0.5),
        ];
    }

    private _calculateVelocityAlignedRotation(
        config: RotationConfiguration,
        velocities: Float32Array,
        i3: number,
        normalizedAge: number,
        seed: number
    ): [number, number, number] {
        const vx = velocities[i3];
        const vy = velocities[i3 + 1];
        const vz = velocities[i3 + 2];

        const yaw = Math.atan2(vx, vz);
        const pitch = Math.atan2(vy, Math.sqrt(vx * vx + vz * vz));

        const baseZ = this._evaluateCurve(config.angularVelocity, normalizedAge, seed);

        return [pitch * 0.1, yaw * 0.1, baseZ];
    }

    private _calculateOrbitalRotation(
        config: RotationConfiguration,
        positions: Float32Array,
        velocities: Float32Array,
        i3: number,
        normalizedAge: number,
        seed: number
    ): [number, number, number] {
        const centerX = 0;
        const centerY = 0;
        const centerZ = 0;

        const px = positions[i3] - centerX;
        const py = positions[i3 + 1] - centerY;
        const pz = positions[i3 + 2] - centerZ;

        const radius = Math.sqrt(px * px + py * py + pz * pz);
        const orbitalSpeed = this._evaluateCurve(config.angularVelocity, normalizedAge, seed);

        if (radius > 0) {
            const angularVel = orbitalSpeed / radius;
            return [0, angularVel, 0];
        }

        return [0, 0, 0];
    }

    private _calculatePhysicsRotation(
        config: RotationConfiguration,
        particleIndex: number,
        deltaTime: number,
        normalizedAge: number,
        seed: number
    ): [number, number, number] {
        const i3 = particleIndex * 3;

        const prevAngVelX = this._previousAngularVelocity[i3];
        const prevAngVelY = this._previousAngularVelocity[i3 + 1];
        const prevAngVelZ = this._previousAngularVelocity[i3 + 2];

        const targetRotation = this._calculateLifetimeRotation(config, normalizedAge, seed);

        const damping = 0.98;
        const acceleration = 10.0;

        const newAngVelX =
            prevAngVelX * damping + (targetRotation[0] - prevAngVelX) * acceleration * deltaTime;
        const newAngVelY =
            prevAngVelY * damping + (targetRotation[1] - prevAngVelY) * acceleration * deltaTime;
        const newAngVelZ =
            prevAngVelZ * damping + (targetRotation[2] - prevAngVelZ) * acceleration * deltaTime;

        this._previousAngularVelocity[i3] = newAngVelX;
        this._previousAngularVelocity[i3 + 1] = newAngVelY;
        this._previousAngularVelocity[i3 + 2] = newAngVelZ;

        return [newAngVelX, newAngVelY, newAngVelZ];
    }

    private _applyConstraints(
        config: RotationConfiguration,
        angularVel: [number, number, number],
        particleIndex: number
    ): [number, number, number] {
        const maxAngVel = 10.0;
        const magnitude = Math.sqrt(
            angularVel[0] * angularVel[0] +
                angularVel[1] * angularVel[1] +
                angularVel[2] * angularVel[2]
        );

        if (magnitude > maxAngVel) {
            const scale = maxAngVel / magnitude;
            return [angularVel[0] * scale, angularVel[1] * scale, angularVel[2] * scale];
        }

        return angularVel;
    }

    private _updateRotation(
        config: RotationConfiguration,
        rotations: Float32Array,
        angularVel: [number, number, number],
        velocities: Float32Array,
        i3: number,
        i4: number,
        particleIndex: number,
        deltaTime: number
    ): void {
        const quat = new Quaternion(
            this._quaternions[i4],
            this._quaternions[i4 + 1],
            this._quaternions[i4 + 2],
            this._quaternions[i4 + 3]
        );

        const halfDt = deltaTime * 0.5;
        const rotQuat = Quaternion.fromEuler(
            angularVel[0] * halfDt,
            angularVel[1] * halfDt,
            angularVel[2] * halfDt
        );

        const newQuat = Quaternion.multiply(quat, rotQuat);
        newQuat.normalize();

        this._quaternions[i4] = newQuat.x;
        this._quaternions[i4 + 1] = newQuat.y;
        this._quaternions[i4 + 2] = newQuat.z;
        this._quaternions[i4 + 3] = newQuat.w;

        const euler = newQuat.toEuler();
        rotations[i3] = euler[0];
        rotations[i3 + 1] = euler[1];
        rotations[i3 + 2] = euler[2];
    }

    private _evaluateCurve(curve: any, time: number, seed: number): number {
        const iCurve: ICurve = {
            mode: curve.mode || 0,
            constant: curve.constant || 0,
            constantMin: curve.constantMin || 0,
            constantMax: curve.constantMax || 0,
            curve: curve.curve,
            curveMin: curve.curveMin,
            curveMax: curve.curveMax,
            curveLength: curve.curve?.length || 0,
            preWrapMode: 0,
            postWrapMode: 0,
        };

        return CurveEvaluator.evaluate(iCurve, time, seed);
    }

    private _updateStats(angularVel: [number, number, number]): void {
        const magnitude = Math.sqrt(
            angularVel[0] * angularVel[0] +
                angularVel[1] * angularVel[1] +
                angularVel[2] * angularVel[2]
        );

        const stats = this._stats as any;
        stats.maxAngularVelocity = Math.max(stats.maxAngularVelocity, magnitude);
        stats.totalRotationalEnergy += magnitude * magnitude * 0.5;
    }

    private _resetStats(): void {
        const stats = this._stats as any;
        stats.averageAngularVelocity = 0;
        stats.maxAngularVelocity = 0;
        stats.totalRotationalEnergy = 0;
        stats.constraintViolations = 0;
    }
}
