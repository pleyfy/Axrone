import type { NoiseConfiguration } from '../core/configuration';
import type { IParticleBuffer } from '../core/interfaces';
import type { ICurve } from '../interfaces';
import { BaseModule } from './base-module';
import { CurveEvaluator } from '../curve-evaluator';
import { createNoise, PerlinNoise, NoiseGenerator } from '@axrone/numeric';

export enum NoiseType {
    Perlin = 'perlin',
    Simplex = 'simplex',
    Worley = 'worley',
    Curl = 'curl',
    Turbulence = 'turbulence',
    Fractal = 'fractal',
}

export interface NoiseSettings {
    readonly type: NoiseType;
    readonly frequency: number;
    readonly amplitude: number;
    readonly octaves: number;
    readonly persistence: number;
    readonly lacunarity: number;
    readonly seed: number;
    readonly animationSpeed: number;
    readonly remapRange: [number, number];
}

export interface NoiseStats {
    samplesPerFrame: number;
    avgComputeTime: number;
    cacheHitRatio: number;
    memoryUsage: number;
}

export class NoiseModule extends BaseModule<'noise'> {
    private _time = 0;
    private _noiseCache = new Map<string, number>();
    private _gradients: number[] = [];
    private _permutation: number[] = [];
    private _worleyPoints: Float32Array = new Float32Array(0);
    private _perlinGen: NoiseGenerator | null = null;

    private readonly _stats: NoiseStats = {
        samplesPerFrame: 0,
        avgComputeTime: 0,
        cacheHitRatio: 0,
        memoryUsage: 0,
    };

    private readonly _tempPositions = new Float32Array(3072);
    private readonly _tempResults = new Float32Array(3072);
    private readonly _tempSeeds = new Uint32Array(1024);

    constructor(configuration: NoiseConfiguration) {
        super('noise', configuration, 600);
        this._initializeNoise();
    }

    protected onInitialize(): void {
        this._initializeNoise();
        this._generatePermutation();
        this._generateGradients();
        this._generateWorleyPoints();
        this._perlinGen = createNoise({
            seed: this.config.seed,
            octaves: Math.max(1, this.config.octaves),
            amplitude: this.config.amplitude,
            frequency: this.config.frequency,
            persistence: this.config.persistence,
            lacunarity: this.config.lacunarity,
        });
    }

    protected onDestroy(): void {
        this._noiseCache.clear();
        this._gradients.length = 0;
        this._permutation.length = 0;
    }

    protected onReset(): void {
        this._time = 0;
        this._noiseCache.clear();
        this._resetStats();
    }

    protected onUpdate(deltaTime: number): void {
        this._time += deltaTime * this.config.animationSpeed;

        if (this._noiseCache.size > 10000) {
            this._noiseCache.clear();
        }
    }

    protected onProcess(particles: IParticleBuffer, deltaTime: number): void {
        const config = this.config;
        if (!config.enabled) return;

        const startTime = performance.now();
        this._resetStats();

        const positions = particles.positions as Float32Array;
        const velocities = particles.velocities as Float32Array;
        const ages = particles.ages as Float32Array;
        const lifetimes = particles.lifetimes as Float32Array;
        const alive = particles.alive as Uint32Array;
        const count = particles.count;

        const batchSize = Math.min(1024, count);

        for (let batchStart = 0; batchStart < count; batchStart += batchSize) {
            const batchEnd = Math.min(batchStart + batchSize, count);
            const batchCount = batchEnd - batchStart;

            this._processBatch(
                positions,
                velocities,
                ages,
                lifetimes,
                alive,
                batchStart,
                batchCount,
                deltaTime
            );
        }

        this._stats.avgComputeTime = performance.now() - startTime;
        this._stats.memoryUsage = this._calculateMemoryUsage();
    }

    protected onConfigure(newConfig: NoiseConfiguration, oldConfig: NoiseConfiguration): void {
        if (newConfig.seed !== oldConfig.seed) {
            this._generatePermutation();
            this._generateGradients();
            this._generateWorleyPoints();
        }

        if (
            newConfig.frequency !== oldConfig.frequency ||
            newConfig.octaves !== oldConfig.octaves
        ) {
            this._noiseCache.clear();
        }
    }

    sampleNoise3D(x: number, y: number, z: number): number {
        return this._sampleNoise(x, y, z, this._time);
    }

    sampleNoise4D(x: number, y: number, z: number, t: number): number {
        return this._sampleNoise(x, y, z, t);
    }

    sampleCurlNoise(x: number, y: number, z: number): [number, number, number] {
        const eps = 0.01;

        const n1 = this._sampleNoise(x, y + eps, z, this._time);
        const n2 = this._sampleNoise(x, y - eps, z, this._time);
        const n3 = this._sampleNoise(x, y, z + eps, this._time);
        const n4 = this._sampleNoise(x, y, z - eps, this._time);
        const n5 = this._sampleNoise(x + eps, y, z, this._time);
        const n6 = this._sampleNoise(x - eps, y, z, this._time);

        const curlX = (n1 - n2) / (2 * eps) - (n3 - n4) / (2 * eps);
        const curlY = (n3 - n4) / (2 * eps) - (n5 - n6) / (2 * eps);
        const curlZ = (n5 - n6) / (2 * eps) - (n1 - n2) / (2 * eps);

        return [curlX, curlY, curlZ];
    }

    getStats(): NoiseStats {
        return { ...this._stats };
    }

    private _initializeNoise(): void {
        const config = this.config;

        switch (config.noiseType) {
            case NoiseType.Perlin:
            case NoiseType.Simplex:
            case NoiseType.Fractal:
                this._generatePermutation();
                this._generateGradients();
                break;

            case NoiseType.Worley:
                this._generateWorleyPoints();
                break;

            case NoiseType.Curl:
            case NoiseType.Turbulence:
                this._generatePermutation();
                this._generateGradients();
                break;
        }
    }

    private _processBatch(
        positions: Float32Array,
        velocities: Float32Array,
        ages: Float32Array,
        lifetimes: Float32Array,
        alive: Uint32Array,
        startIndex: number,
        count: number,
        deltaTime: number
    ): void {
        const config = this.config;

        let validCount = 0;
        for (let i = 0; i < count; i++) {
            const particleIndex = startIndex + i;
            if (!alive[particleIndex]) continue;

            const i3 = particleIndex * 3;
            const vi3 = validCount * 3;

            this._tempPositions[vi3] = positions[i3];
            this._tempPositions[vi3 + 1] = positions[i3 + 1];
            this._tempPositions[vi3 + 2] = positions[i3 + 2];

            this._tempSeeds[validCount] = particleIndex * 31 + Math.floor(this._time * 1000);

            validCount++;
        }

        if (validCount === 0) return;

        this._computeNoiseBatch(validCount);

        validCount = 0;
        for (let i = 0; i < count; i++) {
            const particleIndex = startIndex + i;
            if (!alive[particleIndex]) continue;

            const i3 = particleIndex * 3;
            const vi3 = validCount * 3;

            const normalizedAge =
                lifetimes[particleIndex] > 0 ? ages[particleIndex] / lifetimes[particleIndex] : 0;

            const strengthCurve: ICurve = {
                mode: config.strength.mode,
                constant: config.strength.constant,
                constantMin: config.strength.constantMin,
                constantMax: config.strength.constantMax,
                curve: config.strength.curve,
                curveMin: config.strength.curveMin,
                curveMax: config.strength.curveMax,
                curveLength: config.strength.curve?.length || 0,
                preWrapMode: 0,
                postWrapMode: 0,
            };

            const strengthMultiplier = CurveEvaluator.evaluate(
                strengthCurve,
                normalizedAge,
                this._tempSeeds[validCount]
            );

            const noiseX = this._tempResults[vi3] * strengthMultiplier;
            const noiseY = this._tempResults[vi3 + 1] * strengthMultiplier;
            const noiseZ = this._tempResults[vi3 + 2] * strengthMultiplier;

            if (config.additive) {
                velocities[i3] += noiseX * deltaTime;
                velocities[i3 + 1] += noiseY * deltaTime;
                velocities[i3 + 2] += noiseZ * deltaTime;
            } else {
                velocities[i3] = noiseX;
                velocities[i3 + 1] = noiseY;
                velocities[i3 + 2] = noiseZ;
            }

            validCount++;
        }

        this._stats.samplesPerFrame += validCount;
    }

    private _computeNoiseBatch(count: number): void {
        const config = this.config;

        for (let i = 0; i < count; i++) {
            const i3 = i * 3;
            const x = this._tempPositions[i3] * config.frequency;
            const y = this._tempPositions[i3 + 1] * config.frequency;
            const z = this._tempPositions[i3 + 2] * config.frequency;

            let noiseValue = 0;
            let curlNoise: [number, number, number] | null = null;

            switch (config.noiseType) {
                case NoiseType.Perlin:
                    noiseValue = this._perlinNoise3D(x, y, z);
                    break;

                case NoiseType.Simplex:
                    noiseValue = this._simplexNoise3D(x, y, z);
                    break;

                case NoiseType.Worley:
                    noiseValue = this._worleyNoise3D(x, y, z);
                    break;

                case NoiseType.Curl:
                    curlNoise = this.sampleCurlNoise(x, y, z);
                    break;

                case NoiseType.Turbulence:
                    noiseValue = this._turbulenceNoise3D(x, y, z);
                    break;

                case NoiseType.Fractal:
                    noiseValue = this._fractalNoise3D(x, y, z);
                    break;

                default:
                    noiseValue = 0;
            }

            if (curlNoise) {
                this._tempResults[i3] = curlNoise[0] * config.amplitude;
                this._tempResults[i3 + 1] = curlNoise[1] * config.amplitude;
                this._tempResults[i3 + 2] = curlNoise[2] * config.amplitude;
            } else {
                const offsetNoise1 = this._sampleNoise(x + 100, y, z, this._time);
                const offsetNoise2 = this._sampleNoise(x, y + 100, z, this._time);

                this._tempResults[i3] = noiseValue * config.amplitude;
                this._tempResults[i3 + 1] = offsetNoise1 * config.amplitude;
                this._tempResults[i3 + 2] = offsetNoise2 * config.amplitude;
            }
        }
    }

    private _sampleNoise(x: number, y: number, z: number, t: number): number {
        const config = this.config;

        switch (config.noiseType) {
            case NoiseType.Perlin:
                return this._perlinNoise4D(x, y, z, t);
            case NoiseType.Simplex:
                return this._simplexNoise4D(x, y, z, t);
            case NoiseType.Worley:
                return this._worleyNoise3D(x, y, z);
            case NoiseType.Turbulence:
                return this._turbulenceNoise4D(x, y, z, t);
            case NoiseType.Fractal:
                return this._fractalNoise4D(x, y, z, t);
            default:
                return 0;
        }
    }

    private _generatePermutation(): void {
        const config = this.config;
        this._permutation = [];

        for (let i = 0; i < 256; i++) {
            this._permutation[i] = i;
        }

        let seed = config.seed;
        for (let i = 255; i > 0; i--) {
            seed = (seed * 1103515245 + 12345) & 0x7fffffff;
            const j = seed % (i + 1);
            [this._permutation[i], this._permutation[j]] = [
                this._permutation[j],
                this._permutation[i],
            ];
        }

        for (let i = 0; i < 256; i++) {
            this._permutation[256 + i] = this._permutation[i];
        }
    }

    private _generateGradients(): void {
        this._gradients = [
            1, 1, 0, -1, 1, 0, 1, -1, 0, -1, -1, 0, 1, 0, 1, -1, 0, 1, 1, 0, -1, -1, 0, -1, 0, 1, 1,
            0, -1, 1, 0, 1, -1, 0, -1, -1,
        ];
    }

    private _generateWorleyPoints(): void {
        const pointCount = 64;
        this._worleyPoints = new Float32Array(pointCount * 3);

        let seed = this.config.seed;
        for (let i = 0; i < pointCount * 3; i++) {
            seed = (seed * 1103515245 + 12345) & 0x7fffffff;
            this._worleyPoints[i] = (seed / 0x7fffffff) * 2 - 1;
        }
    }

    private _perlinNoise3D(x: number, y: number, z: number): number {
        if (this._perlinGen) return this._perlinGen.noise3D(x, y, z);
        return this._perlinNoise4D(x, y, z, this._time);
    }

    private _perlinNoise4D(x: number, y: number, z: number, w: number): number {
        if (this._perlinGen) {
            return this._perlinGen.noise3D(x + w, y + w * 0.7, z + w * 0.3);
        }
        const X = Math.floor(x) & 255;
        const Y = Math.floor(y) & 255;
        const Z = Math.floor(z) & 255;
        const W = Math.floor(w) & 255;

        x -= Math.floor(x);
        y -= Math.floor(y);
        z -= Math.floor(z);
        w -= Math.floor(w);

        const u = this._fade(x);
        const v = this._fade(y);
        const s = this._fade(z);
        const t = this._fade(w);

        const A = this._permutation[X] + Y;
        const AA = this._permutation[A] + Z;
        const AB = this._permutation[A + 1] + Z;
        const B = this._permutation[X + 1] + Y;
        const BA = this._permutation[B] + Z;
        const BB = this._permutation[B + 1] + Z;

        const AAA = this._permutation[AA] + W;
        const ABA = this._permutation[AB] + W;
        const BAA = this._permutation[BA] + W;
        const BBA = this._permutation[BB] + W;
        const AAB = this._permutation[AA + 1] + W;
        const ABB = this._permutation[AB + 1] + W;
        const BAB = this._permutation[BA + 1] + W;
        const BBB = this._permutation[BB + 1] + W;

        return this._lerp(
            t,
            this._lerp(
                s,
                this._lerp(
                    v,
                    this._lerp(
                        u,
                        this._grad4d(this._permutation[AAA], x, y, z, w),
                        this._grad4d(this._permutation[BAA], x - 1, y, z, w)
                    ),
                    this._lerp(
                        u,
                        this._grad4d(this._permutation[ABA], x, y - 1, z, w),
                        this._grad4d(this._permutation[BBA], x - 1, y - 1, z, w)
                    )
                ),
                this._lerp(
                    v,
                    this._lerp(
                        u,
                        this._grad4d(this._permutation[AAB], x, y, z - 1, w),
                        this._grad4d(this._permutation[BAB], x - 1, y, z - 1, w)
                    ),
                    this._lerp(
                        u,
                        this._grad4d(this._permutation[ABB], x, y - 1, z - 1, w),
                        this._grad4d(this._permutation[BBB], x - 1, y - 1, z - 1, w)
                    )
                )
            ),
            this._lerp(
                s,
                this._lerp(
                    v,
                    this._lerp(
                        u,
                        this._grad4d(this._permutation[AAA + 1], x, y, z, w - 1),
                        this._grad4d(this._permutation[BAA + 1], x - 1, y, z, w - 1)
                    ),
                    this._lerp(
                        u,
                        this._grad4d(this._permutation[ABA + 1], x, y - 1, z, w - 1),
                        this._grad4d(this._permutation[BBA + 1], x - 1, y - 1, z, w - 1)
                    )
                ),
                this._lerp(
                    v,
                    this._lerp(
                        u,
                        this._grad4d(this._permutation[AAB + 1], x, y, z - 1, w - 1),
                        this._grad4d(this._permutation[BAB + 1], x - 1, y, z - 1, w - 1)
                    ),
                    this._lerp(
                        u,
                        this._grad4d(this._permutation[ABB + 1], x, y - 1, z - 1, w - 1),
                        this._grad4d(this._permutation[BBB + 1], x - 1, y - 1, z - 1, w - 1)
                    )
                )
            )
        );
    }

    private _simplexNoise3D(x: number, y: number, z: number): number {
        if (this._perlinGen)
            return this._perlinGen.noise3D(x * 0.866, y * 0.866, z * 0.866) * 0.577;
        return this._simplexNoise4D(x, y, z, this._time);
    }

    private _simplexNoise4D(x: number, y: number, z: number, w: number): number {
        if (this._perlinGen)
            return this._perlinGen.noise3D(x * 0.866 + w, y * 0.866 + w, z * 0.866 + w) * 0.577;
        return this._perlinNoise4D(x * 0.866, y * 0.866, z * 0.866, w * 0.866) * 0.577;
    }

    private _worleyNoise3D(x: number, y: number, z: number): number {
        let minDist = Infinity;

        for (let i = 0; i < this._worleyPoints.length; i += 3) {
            const px = this._worleyPoints[i];
            const py = this._worleyPoints[i + 1];
            const pz = this._worleyPoints[i + 2];

            const dx = x - px;
            const dy = y - py;
            const dz = z - pz;
            const dist = dx * dx + dy * dy + dz * dz;

            if (dist < minDist) {
                minDist = dist;
            }
        }

        return 1.0 - Math.sqrt(minDist);
    }

    private _turbulenceNoise3D(x: number, y: number, z: number): number {
        return this._turbulenceNoise4D(x, y, z, this._time);
    }

    private _turbulenceNoise4D(x: number, y: number, z: number, w: number): number {
        let value = 0;
        let frequency = this.config.frequency;
        let amplitude = this.config.amplitude;

        for (let i = 0; i < this.config.octaves; i++) {
            if (this._perlinGen) {
                value +=
                    Math.abs(
                        this._perlinGen.noise3D(
                            x * frequency + w * frequency,
                            y * frequency,
                            z * frequency
                        )
                    ) * amplitude;
            } else {
                value +=
                    Math.abs(
                        this._perlinNoise4D(
                            x * frequency,
                            y * frequency,
                            z * frequency,
                            w * frequency
                        )
                    ) * amplitude;
            }
            frequency *= this.config.lacunarity;
            amplitude *= this.config.persistence;
        }

        return value;
    }

    private _fractalNoise3D(x: number, y: number, z: number): number {
        return this._fractalNoise4D(x, y, z, this._time);
    }

    private _fractalNoise4D(x: number, y: number, z: number, w: number): number {
        let value = 0;
        let frequency = this.config.frequency;
        let amplitude = this.config.amplitude;

        for (let i = 0; i < this.config.octaves; i++) {
            value +=
                this._perlinNoise4D(x * frequency, y * frequency, z * frequency, w * frequency) *
                amplitude;
            frequency *= this.config.lacunarity;
            amplitude *= this.config.persistence;
        }

        return value;
    }

    private _fade(t: number): number {
        return t * t * t * (t * (t * 6 - 15) + 10);
    }

    private _lerp(t: number, a: number, b: number): number {
        return a + t * (b - a);
    }

    private _grad4d(hash: number, x: number, y: number, z: number, w: number): number {
        const h = hash & 31;
        const a = y,
            b = z,
            c = w;

        switch (h >> 3) {
            case 1:
                return x + a;
            case 2:
                return -x + a;
            case 3:
                return x - a;
            default:
                return -x - a;
        }
    }

    private _resetStats(): void {
        this._stats.samplesPerFrame = 0;
        this._stats.cacheHitRatio =
            this._noiseCache.size > 0 ? this._noiseCache.size / (this._noiseCache.size + 1) : 0;
    }

    private _calculateMemoryUsage(): number {
        return (
            (this._permutation.length * 4 +
                this._gradients.length * 4 +
                this._worleyPoints.length * 4 +
                this._noiseCache.size * 16 +
                this._tempPositions.length * 4 +
                this._tempResults.length * 4 +
                this._tempSeeds.length * 4) /
            1024
        ); // KB
    }
}
