import type { SizeConfiguration } from '../core/configuration';
import type { IParticleBuffer } from '../core/interfaces';
import type { ICurve } from '../interfaces';
import { BaseModule } from './base-module';
import { CurveEvaluator } from '../curve-evaluator';
import { Vec3 } from '@axrone/numeric';

export interface SizeStats {
    minSize: number;
    maxSize: number;
    avgSize: number;
    sizeVariance: number;
    processingTime: number;
}

export class SizeModule extends BaseModule<'size'> {
    private _initialSizes: Float32Array = new Float32Array(0);
    private _sizeVelocities: Float32Array = new Float32Array(0);
    private _lastParticleCount = 0;
    private _stats: SizeStats = {
        minSize: 0,
        maxSize: 0,
        avgSize: 0,
        sizeVariance: 0,
        processingTime: 0,
    };

    private readonly _tempTimes = new Float32Array(1024);
    private readonly _tempSeeds = new Uint32Array(1024);
    private readonly _tempResults = new Float32Array(1024);

    constructor(configuration: SizeConfiguration) {
        super('size', configuration, 400);
    }

    protected onInitialize(): void {
        this._buildCurveCaches();
        this._validateConfiguration();
    }

    protected onDestroy(): void {
        this._initialSizes = new Float32Array(0);
        this._sizeVelocities = new Float32Array(0);
        this._resetStats();
    }

    protected onReset(): void {
        this._resetStats();
        this._lastParticleCount = 0;
    }

    protected onUpdate(deltaTime: number): void {
        this._updateSizeDynamics(deltaTime);
    }

    protected onProcess(particles: IParticleBuffer, deltaTime: number): void {
        const config = this.config;
        if (!config.enabled) return;

        const startTime = performance.now();
        this._ensureBufferCapacity(particles.count);

        const sizes = particles.sizes as Float32Array;
        const ages = particles.ages as Float32Array;
        const lifetimes = particles.lifetimes as Float32Array;
        const velocities = particles.velocities as Float32Array;
        const alive = particles.alive as Uint32Array;
        const count = particles.count;

        const batchSize = Math.min(256, count);

        for (let batchStart = 0; batchStart < count; batchStart += batchSize) {
            const batchEnd = Math.min(batchStart + batchSize, count);
            const batchCount = batchEnd - batchStart;

            this._processBatch(particles, batchStart, batchCount, deltaTime);
        }

        this._updateStats(sizes, count);
        this._stats.processingTime = performance.now() - startTime;
    }

    protected onConfigure(newConfig: SizeConfiguration, oldConfig: SizeConfiguration): void {
        if (this._curvesChanged(newConfig, oldConfig)) {
            this._buildCurveCaches();
        }

        this._validateConfiguration();
    }

    getStats(): SizeStats {
        return { ...this._stats };
    }

    setInitialSize(particleIndex: number, size: number | Vec3): void {
        if (particleIndex < 0 || particleIndex >= this._initialSizes.length / 3) return;

        const i3 = particleIndex * 3;
        if (typeof size === 'number') {
            this._initialSizes[i3] = size;
            this._initialSizes[i3 + 1] = size;
            this._initialSizes[i3 + 2] = size;
        } else {
            this._initialSizes[i3] = size.x;
            this._initialSizes[i3 + 1] = size.y;
            this._initialSizes[i3 + 2] = size.z;
        }
    }

    applyAdvancedEffects(particleIndex: number, baseSize: number, time: number): number {
        const config = this.config;
        let modifiedSize = baseSize;

        if (config.randomVariation > 0) {
            const seed = particleIndex * 31 + 17;
            const randomFactor = 1 + ((seed % 1000) / 1000 - 0.5) * 2 * config.randomVariation;
            modifiedSize *= randomFactor;
        }

        if (config.animationMode === 'custom') {
            const pulseFrequency = 2.0;
            const pulseAmplitude = 0.2;
            const pulseOffset = Math.sin(time * pulseFrequency * Math.PI * 2) * pulseAmplitude;
            modifiedSize *= 1 + pulseOffset;
        }

        return modifiedSize;
    }

    calculateDistanceScale(particlePosition: Vec3, cameraPosition: Vec3): number {
        const config = this.config;

        if (!config.scaleWithDistance) return 1.0;

        const distance = Vec3.distance(particlePosition, cameraPosition);
        return Math.max(0.1, 1.0 / (1.0 + distance * config.distanceScaleFactor));
    }

    private _processBatch(
        particles: IParticleBuffer,
        startIndex: number,
        count: number,
        deltaTime: number
    ): void {
        const config = this.config;
        const sizes = particles.sizes as Float32Array;
        const ages = particles.ages as Float32Array;
        const lifetimes = particles.lifetimes as Float32Array;
        const velocities = particles.velocities as Float32Array;
        const alive = particles.alive as Uint32Array;

        let validCount = 0;
        for (let i = 0; i < count; i++) {
            const particleIndex = startIndex + i;
            if (!alive[particleIndex]) continue;

            const age = ages[particleIndex];
            const lifetime = lifetimes[particleIndex];
            this._tempTimes[validCount] = lifetime > 0 ? Math.min(age / lifetime, 1.0) : 0;
            this._tempSeeds[validCount] = particleIndex * 31 + Math.floor(age * 1000);
            validCount++;
        }

        if (validCount === 0) return;

        if (config.separateAxes) {
            this._processSeparateAxes(particles, startIndex, count, validCount, deltaTime);
        } else {
            this._processUniformSize(particles, startIndex, count, validCount, deltaTime);
        }
    }

    private _processUniformSize(
        particles: IParticleBuffer,
        startIndex: number,
        count: number,
        validCount: number,
        deltaTime: number
    ): void {
        const config = this.config;
        const sizes = particles.sizes as Float32Array;
        const velocities = particles.velocities as Float32Array;
        const alive = particles.alive as Uint32Array;

        const sizeCurve: ICurve = this._createCurveFromConfig(config.size);
        CurveEvaluator.evaluateBatch(
            sizeCurve,
            this._tempTimes,
            this._tempSeeds,
            this._tempResults,
            validCount
        );

        let validIndex = 0;
        for (let i = 0; i < count; i++) {
            const particleIndex = startIndex + i;
            if (!alive[particleIndex]) continue;

            const i3 = particleIndex * 3;
            let finalSize = this._tempResults[validIndex];

            if (config.speedInfluence && config.speedInfluence !== 0) {
                const vi3 = particleIndex * 3;
                const speed = Math.sqrt(
                    velocities[vi3] * velocities[vi3] +
                        velocities[vi3 + 1] * velocities[vi3 + 1] +
                        velocities[vi3 + 2] * velocities[vi3 + 2]
                );
                finalSize *= 1 + speed * config.speedInfluence * 0.1;
            }

            if (config.sizeDamping && config.sizeDamping !== 0) {
                const currentSize = sizes[i3];
                const sizeDiff = finalSize - currentSize;
                finalSize =
                    currentSize + sizeDiff * (1 - Math.exp(-config.sizeDamping * deltaTime));
            }

            if (this._tempTimes[validIndex] < 0.01) {
                this._initialSizes[i3] = finalSize;
                this._initialSizes[i3 + 1] = finalSize;
                this._initialSizes[i3 + 2] = finalSize;
            }

            finalSize = Math.max(
                config.minSize || 0.01,
                Math.min(config.maxSize || 100, finalSize)
            );

            sizes[i3] = finalSize;
            sizes[i3 + 1] = finalSize;
            sizes[i3 + 2] = finalSize;

            validIndex++;
        }
    }

    private _processSeparateAxes(
        particles: IParticleBuffer,
        startIndex: number,
        count: number,
        validCount: number,
        deltaTime: number
    ): void {
        const config = this.config;
        const sizes = particles.sizes as Float32Array;
        const alive = particles.alive as Uint32Array;

        const sizeXCurve = this._createCurveFromConfig(config.sizeX);
        const sizeYCurve = this._createCurveFromConfig(config.sizeY);
        const sizeZCurve = this._createCurveFromConfig(config.sizeZ);

        const tempResultsY = new Float32Array(validCount);
        const tempResultsZ = new Float32Array(validCount);

        CurveEvaluator.evaluateBatch(
            sizeXCurve,
            this._tempTimes,
            this._tempSeeds,
            this._tempResults,
            validCount
        );
        CurveEvaluator.evaluateBatch(
            sizeYCurve,
            this._tempTimes,
            this._tempSeeds,
            tempResultsY,
            validCount
        );
        CurveEvaluator.evaluateBatch(
            sizeZCurve,
            this._tempTimes,
            this._tempSeeds,
            tempResultsZ,
            validCount
        );

        let validIndex = 0;
        for (let i = 0; i < count; i++) {
            const particleIndex = startIndex + i;
            if (!alive[particleIndex]) continue;

            const i3 = particleIndex * 3;

            let sizeX = this._tempResults[validIndex];
            let sizeY = tempResultsY[validIndex];
            let sizeZ = tempResultsZ[validIndex];

            sizeX = Math.max(config.minSize || 0.01, Math.min(config.maxSize || 100, sizeX));
            sizeY = Math.max(config.minSize || 0.01, Math.min(config.maxSize || 100, sizeY));
            sizeZ = Math.max(config.minSize || 0.01, Math.min(config.maxSize || 100, sizeZ));

            if (this._tempTimes[validIndex] < 0.01) {
                this._initialSizes[i3] = sizeX;
                this._initialSizes[i3 + 1] = sizeY;
                this._initialSizes[i3 + 2] = sizeZ;
            }

            sizes[i3] = sizeX;
            sizes[i3 + 1] = sizeY;
            sizes[i3 + 2] = sizeZ;

            validIndex++;
        }
    }

    private _updateSizeDynamics(deltaTime: number): void {
        const config = this.config;

        if (config.animationMode === 'custom' && this._sizeVelocities.length > 0) {
            for (let i = 0; i < this._sizeVelocities.length; i += 3) {
                this._sizeVelocities[i] += config.sizeAcceleration * deltaTime;
                this._sizeVelocities[i + 1] += config.sizeAcceleration * deltaTime;
                this._sizeVelocities[i + 2] += config.sizeAcceleration * deltaTime;

                const dampingFactor = 1 - config.sizeDamping * deltaTime;
                this._sizeVelocities[i] *= dampingFactor;
                this._sizeVelocities[i + 1] *= dampingFactor;
                this._sizeVelocities[i + 2] *= dampingFactor;
            }
        }
    }

    private _createCurveFromConfig(curveConfig: SizeConfiguration['size']): ICurve {
        return {
            mode: curveConfig.mode,
            constant: curveConfig.constant,
            constantMin: curveConfig.constantMin,
            constantMax: curveConfig.constantMax,
            curve: curveConfig.curve,
            curveMin: curveConfig.curveMin,
            curveMax: curveConfig.curveMax,
            curveLength: curveConfig.curve?.length || 0,
            preWrapMode: 0,
            postWrapMode: 0,
        };
    }

    private _buildCurveCaches(): void {
        const config = this.config;

        CurveEvaluator.buildLookupTable(this._createCurveFromConfig(config.size), 'size_main');

        if (config.separateAxes) {
            CurveEvaluator.buildLookupTable(this._createCurveFromConfig(config.sizeX), 'size_x');
            CurveEvaluator.buildLookupTable(this._createCurveFromConfig(config.sizeY), 'size_y');
            CurveEvaluator.buildLookupTable(this._createCurveFromConfig(config.sizeZ), 'size_z');
        }
    }

    private _validateConfiguration(): void {
        const config = this.config;

        if (config.minSize && config.maxSize && config.minSize > config.maxSize) {
            console.warn('SizeModule: minSize is greater than maxSize, swapping values');
        }

        if (config.size.constant < 0) {
            console.warn('SizeModule: Negative size values may cause rendering issues');
        }
    }

    private _curvesChanged(newConfig: SizeConfiguration, oldConfig: SizeConfiguration): boolean {
        return (
            newConfig.size !== oldConfig.size ||
            newConfig.sizeX !== oldConfig.sizeX ||
            newConfig.sizeY !== oldConfig.sizeY ||
            newConfig.sizeZ !== oldConfig.sizeZ ||
            newConfig.separateAxes !== oldConfig.separateAxes
        );
    }

    private _ensureBufferCapacity(particleCount: number): void {
        const requiredSize = particleCount * 3;

        if (this._initialSizes.length < requiredSize) {
            const newSize = Math.max(requiredSize, this._initialSizes.length * 2);

            const newInitialSizes = new Float32Array(newSize);
            const newSizeVelocities = new Float32Array(newSize);

            if (this._initialSizes.length > 0) {
                newInitialSizes.set(this._initialSizes);
                newSizeVelocities.set(this._sizeVelocities);
            }

            this._initialSizes = newInitialSizes;
            this._sizeVelocities = newSizeVelocities;
        }

        this._lastParticleCount = particleCount;
    }

    private _updateStats(sizes: Float32Array, count: number): void {
        if (count === 0) {
            this._resetStats();
            return;
        }

        let minSize = Infinity;
        let maxSize = -Infinity;
        let totalSize = 0;
        let validCount = 0;

        for (let i = 0; i < count * 3; i += 3) {
            const size = (sizes[i] + sizes[i + 1] + sizes[i + 2]) / 3;
            minSize = Math.min(minSize, size);
            maxSize = Math.max(maxSize, size);
            totalSize += size;
            validCount++;
        }

        this._stats.minSize = minSize;
        this._stats.maxSize = maxSize;
        this._stats.avgSize = totalSize / validCount;

        let variance = 0;
        for (let i = 0; i < count * 3; i += 3) {
            const size = (sizes[i] + sizes[i + 1] + sizes[i + 2]) / 3;
            const diff = size - this._stats.avgSize;
            variance += diff * diff;
        }
        this._stats.sizeVariance = variance / validCount;
    }

    private _resetStats(): void {
        this._stats.minSize = 0;
        this._stats.maxSize = 0;
        this._stats.avgSize = 0;
        this._stats.sizeVariance = 0;
        this._stats.processingTime = 0;
    }
}
