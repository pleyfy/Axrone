import { ForceConfiguration } from '../core/configuration';
import { IForce } from '../core/interfaces';
import { IVec3Array, IVec4Array } from '../aligned-arrays';
import { CurveEvaluator } from '../curve-evaluator';
import { Random } from '../../random';

export interface IVec3Like {
    x: number;
    y: number;
    z: number;
}

export interface ForceField {
    readonly type: IForce['type'];
    readonly strength: number;
    readonly direction: IVec3Like;
    readonly position?: IVec3Like;
    readonly range?: number;
    readonly falloff: IForce['falloff'];
    readonly noiseScale?: number;
    readonly noiseSpeed?: number;
    readonly ageMultiplier?: number;
    readonly customFunction?: (position: IVec3Like, velocity: IVec3Like, age: number) => IVec3Like;
}

export interface ForceStats {
    totalForces: number;
    activeForces: number;
    computationsPerFrame: number;
    avgComputationTime: number;
    rangeChecks: number;
    falloffCalculations: number;
}

export enum ForceComputeMode {
    Immediate = 0,
    Batched = 1,
    Optimized = 2,
}

export class ForceModule {
    private readonly _configuration: ForceConfiguration;
    private readonly _forces: ForceField[] = [];
    private readonly _activeForces = new Set<number>();

    private readonly _stats: ForceStats = {
        totalForces: 0,
        activeForces: 0,
        computationsPerFrame: 0,
        avgComputationTime: 0,
        rangeChecks: 0,
        falloffCalculations: 0,
    };

    private readonly _tempForces = new Float32Array(4096 * 3);
    private readonly _tempDistances = new Float32Array(4096);
    private readonly _tempFalloffs = new Float32Array(4096);

    private _noiseTime = 0;
    private readonly _noiseOffsets = new Float32Array(16);

    constructor(configuration: ForceConfiguration) {
        this._configuration = configuration;
        this._initializeForces();
        this._initializeNoise();
    }

    private _initializeForces(): void {
        this._forces.length = 0;
        this._activeForces.clear();

        for (let i = 0; i < this._configuration.forces.length; i++) {
            const forceConfig = this._configuration.forces[i];

            const force: ForceField = {
                type: forceConfig.type,
                strength: 1.0,
                direction: { ...forceConfig.direction },
                position: forceConfig.position ? { ...forceConfig.position } : undefined,
                range: forceConfig.falloffRadius || Infinity,
                falloff: 'linear',
            };

            this._forces.push(force);
            this._activeForces.add(i);
        }

        this._stats.totalForces = this._forces.length;
        this._stats.activeForces = this._activeForces.size;
    }

    private _initializeNoise(): void {
        for (let i = 0; i < this._noiseOffsets.length; i++) {
            this._noiseOffsets[i] = Math.random() * 1000;
        }
    }

    applyForces(
        positions: IVec3Array,
        velocities: IVec3Array,
        ages: Float32Array,
        lifetimes: Float32Array,
        masses: Float32Array,
        count: number,
        deltaTime: number,
        random: Random
    ): void {
        if (this._activeForces.size === 0 || count === 0) return;

        const startTime = performance.now();
        this._stats.computationsPerFrame = 0;
        this._stats.rangeChecks = 0;
        this._stats.falloffCalculations = 0;

        this._noiseTime += deltaTime;

        for (const forceIndex of this._activeForces) {
            const force = this._forces[forceIndex];
            this._applyForce(
                force,
                positions,
                velocities,
                ages,
                lifetimes,
                masses,
                count,
                deltaTime,
                random,
                forceIndex
            );
        }

        this._stats.avgComputationTime = performance.now() - startTime;
    }

    private _applyForce(
        force: ForceField,
        positions: IVec3Array,
        velocities: IVec3Array,
        ages: Float32Array,
        lifetimes: Float32Array,
        masses: Float32Array,
        count: number,
        deltaTime: number,
        random: Random,
        forceIndex: number
    ): void {
        switch (force.type) {
            case 'gravity':
                this._applyGravity(force, velocities, masses, count, deltaTime);
                break;
            case 'drag':
                this._applyDrag(force, velocities, masses, count, deltaTime);
                break;
            case 'turbulence':
                this._applyTurbulence(force, positions, velocities, count, deltaTime, forceIndex);
                break;
            case 'vortex':
                this._applyVortex(force, positions, velocities, masses, count, deltaTime);
                break;
            case 'directional':
                this._applyDirectional(
                    force,
                    velocities,
                    ages,
                    lifetimes,
                    masses,
                    count,
                    deltaTime
                );
                break;
            case 'point':
                this._applyPoint(force, positions, velocities, masses, count, deltaTime);
                break;
            case 'custom':
                this._applyCustom(force, positions, velocities, ages, masses, count, deltaTime);
                break;
        }
    }

    private _applyGravity(
        force: ForceField,
        velocities: IVec3Array,
        masses: Float32Array,
        count: number,
        deltaTime: number
    ): void {
        const forceX = force.direction.x * force.strength * deltaTime;
        const forceY = force.direction.y * force.strength * deltaTime;
        const forceZ = force.direction.z * force.strength * deltaTime;

        for (let i = 0; i < count; i++) {
            const mass = masses[i];
            velocities.x[i] += forceX * mass;
            velocities.y[i] += forceY * mass;
            velocities.z![i] += forceZ * mass;
            this._stats.computationsPerFrame++;
        }
    }

    private _applyDrag(
        force: ForceField,
        velocities: IVec3Array,
        masses: Float32Array,
        count: number,
        deltaTime: number
    ): void {
        const dragCoefficient = force.strength * deltaTime;

        for (let i = 0; i < count; i++) {
            const vx = velocities.x[i];
            const vy = velocities.y[i];
            const vz = velocities.z![i];

            const speed = Math.sqrt(vx * vx + vy * vy + vz * vz);
            if (speed > 0.001) {
                const dragForce = (dragCoefficient * speed * speed) / masses[i];
                const dragFactor = Math.max(0, 1 - dragForce);

                velocities.x[i] *= dragFactor;
                velocities.y[i] *= dragFactor;
                velocities.z![i] *= dragFactor;
            }
            this._stats.computationsPerFrame++;
        }
    }

    private _applyTurbulence(
        force: ForceField,
        positions: IVec3Array,
        velocities: IVec3Array,
        count: number,
        deltaTime: number,
        forceIndex: number
    ): void {
        const noiseScale = force.noiseScale || 0.1;
        const noiseSpeed = force.noiseSpeed || 1.0;
        const noiseOffset = this._noiseOffsets[forceIndex % this._noiseOffsets.length];
        const timeOffset = this._noiseTime * noiseSpeed + noiseOffset;

        for (let i = 0; i < count; i++) {
            const px = positions.x[i];
            const py = positions.y[i];
            const pz = positions.z![i];

            const noiseX = this._simpleNoise(px * noiseScale, py * noiseScale, timeOffset);
            const noiseY = this._simpleNoise(py * noiseScale, pz * noiseScale, timeOffset + 100);
            const noiseZ = this._simpleNoise(pz * noiseScale, px * noiseScale, timeOffset + 200);

            const forceMultiplier = force.strength * deltaTime;
            velocities.x[i] += noiseX * forceMultiplier;
            velocities.y[i] += noiseY * forceMultiplier;
            velocities.z![i] += noiseZ * forceMultiplier;

            this._stats.computationsPerFrame++;
        }
    }

    private _applyVortex(
        force: ForceField,
        positions: IVec3Array,
        velocities: IVec3Array,
        masses: Float32Array,
        count: number,
        deltaTime: number
    ): void {
        if (!force.position) return;

        const centerX = force.position.x;
        const centerY = force.position.y;
        const centerZ = force.position.z;
        const axisX = force.direction.x;
        const axisY = force.direction.y;
        const axisZ = force.direction.z;

        for (let i = 0; i < count; i++) {
            const px = positions.x[i] - centerX;
            const py = positions.y[i] - centerY;
            const pz = positions.z![i] - centerZ;

            const distance = Math.sqrt(px * px + py * py + pz * pz);
            this._stats.rangeChecks++;

            if (distance > 0.001 && (force.range === undefined || distance < force.range)) {
                const tangentX = axisY * pz - axisZ * py;
                const tangentY = axisZ * px - axisX * pz;
                const tangentZ = axisX * py - axisY * px;

                const tangentMagnitude = Math.sqrt(
                    tangentX * tangentX + tangentY * tangentY + tangentZ * tangentZ
                );
                if (tangentMagnitude > 0.001) {
                    const falloff = this._calculateFalloff(
                        force.falloff,
                        distance,
                        force.range || 100
                    );
                    const forceMultiplier =
                        (force.strength * falloff * deltaTime) / (masses[i] * tangentMagnitude);

                    velocities.x[i] += tangentX * forceMultiplier;
                    velocities.y[i] += tangentY * forceMultiplier;
                    velocities.z![i] += tangentZ * forceMultiplier;
                }

                this._stats.falloffCalculations++;
            }
            this._stats.computationsPerFrame++;
        }
    }

    private _applyDirectional(
        force: ForceField,
        velocities: IVec3Array,
        ages: Float32Array,
        lifetimes: Float32Array,
        masses: Float32Array,
        count: number,
        deltaTime: number
    ): void {
        for (let i = 0; i < count; i++) {
            const ageNormalized = ages[i] / lifetimes[i];
            const ageMultiplier = force.ageMultiplier ? this._evaluateAgeCurve(ageNormalized) : 1.0;

            const forceMultiplier = (force.strength * ageMultiplier * deltaTime) / masses[i];

            velocities.x[i] += force.direction.x * forceMultiplier;
            velocities.y[i] += force.direction.y * forceMultiplier;
            velocities.z![i] += force.direction.z * forceMultiplier;

            this._stats.computationsPerFrame++;
        }
    }

    private _applyPoint(
        force: ForceField,
        positions: IVec3Array,
        velocities: IVec3Array,
        masses: Float32Array,
        count: number,
        deltaTime: number
    ): void {
        if (!force.position) return;

        const centerX = force.position.x;
        const centerY = force.position.y;
        const centerZ = force.position.z;

        for (let i = 0; i < count; i++) {
            const dx = positions.x[i] - centerX;
            const dy = positions.y[i] - centerY;
            const dz = positions.z![i] - centerZ;

            const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);
            this._stats.rangeChecks++;

            if (distance > 0.001 && (force.range === undefined || distance < force.range)) {
                const falloff = this._calculateFalloff(force.falloff, distance, force.range || 100);
                const forceMultiplier =
                    (force.strength * falloff * deltaTime) / (masses[i] * distance);

                velocities.x[i] += dx * forceMultiplier;
                velocities.y[i] += dy * forceMultiplier;
                velocities.z![i] += dz * forceMultiplier;

                this._stats.falloffCalculations++;
            }
            this._stats.computationsPerFrame++;
        }
    }

    private _applyCustom(
        force: ForceField,
        positions: IVec3Array,
        velocities: IVec3Array,
        ages: Float32Array,
        masses: Float32Array,
        count: number,
        deltaTime: number
    ): void {
        if (!force.customFunction) return;

        for (let i = 0; i < count; i++) {
            const position = {
                x: positions.x[i],
                y: positions.y[i],
                z: positions.z![i],
            };

            const velocity = {
                x: velocities.x[i],
                y: velocities.y[i],
                z: velocities.z![i],
            };

            const customForce = force.customFunction(position, velocity, ages[i]);
            const forceMultiplier = deltaTime / masses[i];

            velocities.x[i] += customForce.x * forceMultiplier;
            velocities.y[i] += customForce.y * forceMultiplier;
            velocities.z![i] += customForce.z * forceMultiplier;

            this._stats.computationsPerFrame++;
        }
    }

    private _calculateFalloff(
        falloffType: IForce['falloff'],
        distance: number,
        range: number
    ): number {
        if (distance >= range) return 0;

        switch (falloffType) {
            case 'none':
                return 1;
            case 'linear':
                return 1 - distance / range;
            case 'quadratic':
                return Math.pow(1 - distance / range, 2);
            case 'custom':
                const t = distance / range;
                return 1 - t * t * (3 - 2 * t);
            default:
                return 1;
        }
    }

    private _simpleNoise(x: number, y: number, z: number): number {
        const n = Math.sin(x * 12.9898 + y * 78.233 + z * 37.719) * 43758.5453;
        return 2 * (n - Math.floor(n)) - 1;
    }

    private _evaluateAgeCurve(normalizedAge: number): number {
        return 1 - normalizedAge * normalizedAge;
    }

    addForce(force: ForceField): number {
        const index = this._forces.length;
        this._forces.push(force);
        this._activeForces.add(index);
        this._stats.totalForces++;
        this._stats.activeForces++;
        return index;
    }

    removeForce(index: number): boolean {
        if (index >= 0 && index < this._forces.length && this._activeForces.has(index)) {
            this._activeForces.delete(index);
            this._stats.activeForces--;
            return true;
        }
        return false;
    }

    setForceEnabled(index: number, enabled: boolean): void {
        if (index >= 0 && index < this._forces.length) {
            if (enabled) {
                if (!this._activeForces.has(index)) {
                    this._activeForces.add(index);
                    this._stats.activeForces++;
                }
            } else {
                if (this._activeForces.has(index)) {
                    this._activeForces.delete(index);
                    this._stats.activeForces--;
                }
            }
        }
    }

    updateForceStrength(index: number, strength: number): void {
        if (index >= 0 && index < this._forces.length) {
            (this._forces[index] as any).strength = strength;
        }
    }

    getStats(): ForceStats {
        return { ...this._stats };
    }

    resetStats(): void {
        this._stats.computationsPerFrame = 0;
        this._stats.avgComputationTime = 0;
        this._stats.rangeChecks = 0;
        this._stats.falloffCalculations = 0;
    }

    getActiveForces(): readonly ForceField[] {
        return Array.from(this._activeForces).map((index) => this._forces[index]);
    }

    clearForces(): void {
        this._forces.length = 0;
        this._activeForces.clear();
        this._stats.totalForces = 0;
        this._stats.activeForces = 0;
    }
}
