import type { IVec3Like } from '@axrone/numeric';
import type { ParticleId } from '../types';
import type { IParticleBuffer } from '../core/interfaces';
import type { EmissionConfiguration, CurveConfiguration } from '../core/configuration';
import { BaseModule } from './base-module';

interface BurstState {
    timer: number;
    cycleCount: number;
    completed: boolean;
    nextBurstTime: number;
}

interface EmissionState {
    accumulator: number;
    lastTime: number;
    totalEmitted: number;
    isPrewarming: boolean;
    prewarmProgress: number;
}

export class EmissionModule extends BaseModule<'emission'> {
    private _emissionState: EmissionState;
    private _burstStates: BurstState[] = [];
    private _isPlaying = true;
    private _isPaused = false;
    private _emissionEnabled = true;
    private _seedOffset = 0;

    constructor(config: EmissionConfiguration) {
        super('emission', config, 100);
        this._emissionState = {
            accumulator: 0,
            lastTime: 0,
            totalEmitted: 0,
            isPrewarming: false,
            prewarmProgress: 0,
        };
    }

    protected onInitialize(): void {
        this._resetEmissionState();
        this._initializeBursts();

        if (this.config.prewarm) {
            this._performPrewarm();
        }

        this._seedOffset = Math.floor(Math.random() * 10000);
    }

    protected onDestroy(): void {
        this._resetEmissionState();
        this._burstStates.length = 0;
    }

    protected onReset(): void {
        this._resetEmissionState();
        this._initializeBursts();

        if (this.config.prewarm) {
            this._performPrewarm();
        }
    }

    protected onUpdate(deltaTime: number): void {
        if (!this._isPlaying || this._isPaused) return;

        this._emissionState.lastTime += deltaTime;

        this._updateBurstTimers(deltaTime);
    }

    protected onProcess(particles: IParticleBuffer, deltaTime: number): void {
        this.throwIfNotInitialized();

        if (!this._emissionEnabled || !this._isPlaying || this._isPaused) return;

        const continuousEmission = this._calculateContinuousEmission(deltaTime);

        const burstEmission = this._calculateBurstEmission(deltaTime);

        const totalEmission = continuousEmission + burstEmission;
        if (totalEmission <= 0) return;

        this._emitParticles(particles, Math.floor(totalEmission), deltaTime);

        this._emissionState.totalEmitted += totalEmission;
    }

    protected onConfigure(
        newConfig: EmissionConfiguration,
        oldConfig: EmissionConfiguration
    ): void {
        if (
            newConfig.bursts.length !== oldConfig.bursts.length ||
            this._burstsConfigurationChanged(newConfig.bursts, oldConfig.bursts)
        ) {
            this._initializeBursts();
        }

        if (newConfig.prewarm !== oldConfig.prewarm && newConfig.prewarm) {
            this._performPrewarm();
        }
    }

    private _resetEmissionState(): void {
        this._emissionState.accumulator = 0;
        this._emissionState.lastTime = 0;
        this._emissionState.totalEmitted = 0;
        this._emissionState.isPrewarming = false;
        this._emissionState.prewarmProgress = 0;
    }

    private _initializeBursts(): void {
        this._burstStates = this.config.bursts.map((burst, index) => ({
            timer: burst.time,
            cycleCount: 0,
            completed: false,
            nextBurstTime: burst.time,
        }));
    }

    private _updateBurstTimers(deltaTime: number): void {
        for (let i = 0; i < this._burstStates.length; i++) {
            const state = this._burstStates[i];
            if (!state.completed) {
                state.timer -= deltaTime;
            }
        }
    }

    private _calculateContinuousEmission(deltaTime: number): number {
        const config = this.config;

        const normalizedTime = this._getNormalizedLifetime();
        const emissionRate = this._evaluateCurve(config.rateOverTime, normalizedTime);

        const effectiveRate = emissionRate * config.rateMultiplier;

        this._emissionState.accumulator += effectiveRate * deltaTime;

        const emissionCount = Math.floor(this._emissionState.accumulator);
        this._emissionState.accumulator -= emissionCount;

        return emissionCount;
    }

    private _calculateBurstEmission(deltaTime: number): number {
        let totalBurstEmission = 0;

        for (let i = 0; i < this._burstStates.length; i++) {
            const burst = this.config.bursts[i];
            const state = this._burstStates[i];

            if (state.completed) continue;

            if (state.timer <= 0) {
                const random = this._getSeededRandom(i);
                if (random <= burst.probability) {
                    const baseCount = burst.count.value;
                    const variance = burst.count.variance;
                    const randomVariance = (this._getSeededRandom(i + 1000) * 2 - 1) * variance;
                    const finalCount = Math.max(0, Math.floor(baseCount + randomVariance));

                    totalBurstEmission += finalCount;
                }

                if (burst.cycles > 0) {
                    state.cycleCount++;
                    if (state.cycleCount >= burst.cycles) {
                        state.completed = true;
                    } else {
                        state.timer = burst.interval;
                        state.nextBurstTime = this._emissionState.lastTime + burst.interval;
                    }
                } else {
                    state.timer = burst.interval;
                    state.nextBurstTime = this._emissionState.lastTime + burst.interval;
                }
            }
        }

        return totalBurstEmission;
    }

    private _emitParticles(particles: IParticleBuffer, count: number, deltaTime: number): void {
        const config = this.config;

        for (let i = 0; i < count; i++) {
            const particleTime = i / count;
            const emissionTime = this._emissionState.lastTime + particleTime * deltaTime;

            const particleData = this._generateParticleData(emissionTime);

            try {
                particles.addParticle(
                    particleData.position,
                    particleData.velocity,
                    particleData.lifetime,
                    particleData.size,
                    particleData.color
                );
            } catch (error) {
                console.warn('Particle buffer overflow in EmissionModule');
                break;
            }
        }
    }

    private _generateParticleData(emissionTime: number) {
        const config = this.config;

        const normalizedTime = this._getNormalizedLifetime(emissionTime);

        const position: IVec3Like = { x: 0, y: 0, z: 0 };

        const velocity: IVec3Like = { x: 0, y: 0, z: 0 };

        const baseLifetime = this._evaluateCurve(config.startLifetime, normalizedTime);
        const lifetimeVariance = baseLifetime * config.startLifetimeMultiplier;
        const lifetime = Math.max(0.1, baseLifetime + (Math.random() * 2 - 1) * lifetimeVariance);

        const baseSize = this._evaluateCurve(config.startSize, normalizedTime);
        const sizeVariance = baseSize * config.startSizeMultiplier;
        const size = Math.max(0.01, baseSize + (Math.random() * 2 - 1) * sizeVariance);

        const color = this._generateInitialColor(normalizedTime);

        return {
            position,
            velocity,
            lifetime,
            size,
            color,
        };
    }

    private _generateInitialColor(normalizedTime: number): number {
        const config = this.config;

        const startColor = this._evaluateGradient(config.startColor, normalizedTime);

        const r = Math.floor(Math.min(255, Math.max(0, startColor.r * 255)));
        const g = Math.floor(Math.min(255, Math.max(0, startColor.g * 255)));
        const b = Math.floor(Math.min(255, Math.max(0, startColor.b * 255)));
        const a = Math.floor(Math.min(255, Math.max(0, startColor.a * 255)));

        return (r << 24) | (g << 16) | (b << 8) | a;
    }

    private _performPrewarm(): void {
        this._emissionState.isPrewarming = true;

        const prewarmDuration = this.config.prewarmTime;
        const timeStep = 1 / 60;

        let currentTime = 0;
        while (currentTime < prewarmDuration) {
            const deltaTime = Math.min(timeStep, prewarmDuration - currentTime);

            this.onUpdate(deltaTime);

            currentTime += deltaTime;
            this._emissionState.prewarmProgress = currentTime / prewarmDuration;
        }

        this._emissionState.isPrewarming = false;
    }

    private _getNormalizedLifetime(timeOverride?: number): number {
        const currentTime = timeOverride ?? this._emissionState.lastTime;

        if (this.config.duration <= 0) return 0;

        return Math.min(1, currentTime / this.config.duration);
    }

    private _getSeededRandom(seed: number): number {
        const x = Math.sin(seed + this._seedOffset) * 10000;
        return x - Math.floor(x);
    }

    private _burstsConfigurationChanged(
        newBursts: readonly any[],
        oldBursts: readonly any[]
    ): boolean {
        if (newBursts.length !== oldBursts.length) return true;

        for (let i = 0; i < newBursts.length; i++) {
            const newBurst = newBursts[i];
            const oldBurst = oldBursts[i];

            if (
                newBurst.time !== oldBurst.time ||
                newBurst.count.value !== oldBurst.count.value ||
                newBurst.count.variance !== oldBurst.count.variance ||
                newBurst.cycles !== oldBurst.cycles ||
                newBurst.interval !== oldBurst.interval ||
                newBurst.probability !== oldBurst.probability
            ) {
                return true;
            }
        }

        return false;
    }

    private _evaluateCurve(curve: CurveConfiguration, time: number): number {
        switch (curve.mode) {
            case 0:
                return curve.constant;

            case 1:
                if (!curve.curve) return curve.constant;
                return this._sampleCurve(curve.curve, time) * curve.curveMultiplier;

            case 2:
                if (!curve.curveMin || !curve.curveMax) return curve.constant;
                const min = this._sampleCurve(curve.curveMin, time);
                const max = this._sampleCurve(curve.curveMax, time);
                return (min + Math.random() * (max - min)) * curve.curveMultiplier;

            case 3:
                const range = curve.constantMax - curve.constantMin;
                return curve.constantMin + Math.random() * range;

            default:
                return curve.constant;
        }
    }

    private _evaluateGradient(
        gradient: any,
        time: number
    ): { r: number; g: number; b: number; a: number } {
        return { r: 1, g: 1, b: 1, a: 1 };
    }

    private _sampleCurve(curve: ArrayLike<number>, time: number): number {
        if (curve.length === 0) return 0;
        if (curve.length === 1) return curve[0];

        const lastIndex = curve.length - 1;
        if (time <= 0) return curve[0];
        if (time >= 1) return curve[lastIndex];

        const scaledTime = time * lastIndex;
        const index = Math.floor(scaledTime);
        const fraction = scaledTime - index;

        if (index >= lastIndex) return curve[lastIndex];

        return curve[index] * (1 - fraction) + curve[index + 1] * fraction;
    }

    play(): void {
        this._isPlaying = true;
        this._isPaused = false;
    }

    pause(): void {
        this._isPaused = true;
    }

    stop(): void {
        this._isPlaying = false;
        this._isPaused = false;
        this._resetEmissionState();
    }

    enableEmission(): void {
        this._emissionEnabled = true;
    }

    disableEmission(): void {
        this._emissionEnabled = false;
    }

    getTotalEmittedCount(): number {
        return this._emissionState.totalEmitted;
    }

    getEmissionRate(): number {
        const normalizedTime = this._getNormalizedLifetime();
        return (
            this._evaluateCurve(this.config.rateOverTime, normalizedTime) *
            this.config.rateMultiplier
        );
    }

    getBurstStates(): readonly BurstState[] {
        return this._burstStates;
    }

    isPrewarming(): boolean {
        return this._emissionState.isPrewarming;
    }

    getPrewarmProgress(): number {
        return this._emissionState.prewarmProgress;
    }
}
