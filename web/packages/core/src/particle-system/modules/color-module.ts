import type { ColorConfiguration } from '../core/configuration';
import type { IParticleBuffer } from '../core/interfaces';
import type { ParticleId } from '../types';
import { BaseModule } from './base-module';

interface ColorState {
    initialColor: { r: number; g: number; b: number; a: number };
    currentColor: { r: number; g: number; b: number; a: number };
    velocityColorCache: { r: number; g: number; b: number; a: number };
    lastVelocityMagnitude: number;
}

interface ColorKeyframe {
    time: number;
    color: { r: number; g: number; b: number; a: number };
    interpolation: 'linear' | 'step' | 'smoothstep';
}

export class ColorModule extends BaseModule<'color'> {
    private _particleStates = new Map<ParticleId, ColorState>();
    private _gradientCache = new Map<string, ColorKeyframe[]>();
    private _colorLookupTable: Uint32Array;
    private _lookupTableSize = 256;

    constructor(configuration: ColorConfiguration) {
        super('color', configuration, 300);
        this._colorLookupTable = new Uint32Array(this._lookupTableSize);
    }

    protected onInitialize(): void {
        this._particleStates.clear();
        this._gradientCache.clear();
        this._buildColorLookupTable();
    }

    protected onDestroy(): void {
        this._particleStates.clear();
        this._gradientCache.clear();
    }

    protected onReset(): void {
        this._particleStates.clear();
        this._buildColorLookupTable();
    }

    protected onUpdate(deltaTime: number): void {
        if (this.config.enabled) {
            this._updateGlobalColorState(deltaTime);
        }
    }

    protected onProcess(particles: IParticleBuffer, deltaTime: number): void {
        if (!this.config.enabled) return;

        const config = this.config;
        const colors = particles.colors as unknown as Uint32Array;
        const velocities = particles.velocities as Float32Array;
        const ages = particles.ages as Float32Array;
        const lifetimes = particles.lifetimes as Float32Array;
        const sizes = particles.sizes as Float32Array;
        const alive = particles.alive as Uint32Array;
        const count = particles.count;

        for (let i = 0; i < count; i++) {
            if (!alive[i]) continue;

            const particleId = particles.getParticleId(i);
            const age = ages[i];
            const lifetime = lifetimes[i];
            const normalizedAge = lifetime > 0 ? age / lifetime : 0;

            let state = this._particleStates.get(particleId);
            if (!state) {
                state = this._createParticleColorState(i, particles, normalizedAge);
                this._particleStates.set(particleId, state);
            }

            const newColor = this._calculateParticleColor(
                i,
                particles,
                state,
                normalizedAge,
                deltaTime
            );

            colors[i] = this._packColor(newColor);

            state.currentColor = { ...newColor };
        }

        this._cleanupDeadParticles(particles);
    }

    protected onConfigure(newConfig: ColorConfiguration, oldConfig: ColorConfiguration): void {
        if (this._gradientConfigurationChanged(newConfig, oldConfig)) {
            this._buildColorLookupTable();
            this._gradientCache.clear();
        }

        if (this._significantConfigChange(newConfig, oldConfig)) {
            this._particleStates.clear();
        }
    }

    private _createParticleColorState(
        particleIndex: number,
        particles: IParticleBuffer,
        normalizedAge: number
    ): ColorState {
        const initialColor = this._evaluateGradient(this.config.color, 0);

        return {
            initialColor: { ...initialColor },
            currentColor: { ...initialColor },
            velocityColorCache: { r: 0, g: 0, b: 0, a: 0 },
            lastVelocityMagnitude: 0,
        };
    }

    private _calculateParticleColor(
        particleIndex: number,
        particles: IParticleBuffer,
        state: ColorState,
        normalizedAge: number,
        deltaTime: number
    ): { r: number; g: number; b: number; a: number } {
        const config = this.config;

        let finalColor = this._evaluateGradient(config.color, normalizedAge);

        if (config.colorOverLifetime) {
            const lifetimeColor = this._evaluateGradient(config.colorOverLifetime, normalizedAge);
            finalColor = this._multiplyColors(finalColor, lifetimeColor);
        }

        if (config.velocityInfluence !== 0) {
            finalColor = this._applyVelocityInfluence(
                particleIndex,
                particles,
                state,
                finalColor,
                config.velocityInfluence
            );
        }

        if (config.ageInfluence !== 0) {
            finalColor = this._applyAgeInfluence(finalColor, normalizedAge, config.ageInfluence);
        }

        if (config.sizeInfluence !== 0) {
            const size = particles.sizes[particleIndex];
            finalColor = this._applySizeInfluence(finalColor, size, config.sizeInfluence);
        }

        if (config.randomColorVariation !== 0) {
            finalColor = this._applyRandomVariation(finalColor, config.randomColorVariation);
        }

        return this._clampColor(finalColor);
    }

    private _applyVelocityInfluence(
        particleIndex: number,
        particles: IParticleBuffer,
        state: ColorState,
        baseColor: { r: number; g: number; b: number; a: number },
        influence: number
    ): { r: number; g: number; b: number; a: number } {
        const velocities = particles.velocities as Float32Array;
        const i3 = particleIndex * 3;

        const velMagnitude = Math.sqrt(
            velocities[i3] ** 2 + velocities[i3 + 1] ** 2 + velocities[i3 + 2] ** 2
        );

        if (Math.abs(velMagnitude - state.lastVelocityMagnitude) < 0.1) {
            return this._addColors(baseColor, state.velocityColorCache);
        }

        const normalizedVelocity = Math.min(velMagnitude * 0.1, 1.0);
        const velocityColor = {
            r: normalizedVelocity * influence * 0.5,
            g: normalizedVelocity * influence * 0.3,
            b: normalizedVelocity * influence * 0.8,
            a: 0,
        };

        state.velocityColorCache = { ...velocityColor };
        state.lastVelocityMagnitude = velMagnitude;

        return this._addColors(baseColor, velocityColor);
    }

    private _applyAgeInfluence(
        baseColor: { r: number; g: number; b: number; a: number },
        normalizedAge: number,
        influence: number
    ): { r: number; g: number; b: number; a: number } {
        const ageFactor = normalizedAge * influence;

        return {
            r: Math.max(baseColor.r - ageFactor * 0.2, 0.0),
            g: Math.max(baseColor.g - ageFactor * 0.3, 0.0),
            b: Math.max(baseColor.b - ageFactor * 0.1, 0.0),
            a: Math.max(baseColor.a - ageFactor * 0.5, 0.0),
        };
    }

    private _applySizeInfluence(
        baseColor: { r: number; g: number; b: number; a: number },
        size: number,
        influence: number
    ): { r: number; g: number; b: number; a: number } {
        const sizeNormalized = Math.min(size * 0.5, 1.0);
        const sizeFactor = sizeNormalized * influence;

        return {
            r: Math.min(baseColor.r + sizeFactor * 0.1, 1.0),
            g: Math.min(baseColor.g + sizeFactor * 0.2, 1.0),
            b: Math.min(baseColor.b + sizeFactor * 0.3, 1.0),
            a: baseColor.a,
        };
    }

    private _applyRandomVariation(
        baseColor: { r: number; g: number; b: number; a: number },
        variation: number
    ): { r: number; g: number; b: number; a: number } {
        const randomR = (Math.random() - 0.5) * variation;
        const randomG = (Math.random() - 0.5) * variation;
        const randomB = (Math.random() - 0.5) * variation;

        return {
            r: baseColor.r + randomR,
            g: baseColor.g + randomG,
            b: baseColor.b + randomB,
            a: baseColor.a,
        };
    }

    private _buildColorLookupTable(): void {
        for (let i = 0; i < this._lookupTableSize; i++) {
            const t = i / (this._lookupTableSize - 1);
            const color = this._evaluateGradient(this.config.color, t);
            this._colorLookupTable[i] = this._packColor(color);
        }
    }

    private _updateGlobalColorState(deltaTime: number): void {}

    private _evaluateGradient(
        gradient: ColorConfiguration['color'],
        t: number
    ): { r: number; g: number; b: number; a: number } {
        if (gradient.mode === 0) {
            return { ...gradient.color };
        }

        if (gradient.mode === 1 && this._colorLookupTable.length > 0) {
            const index = Math.floor(t * (this._lookupTableSize - 1));
            const packedColor = this._colorLookupTable[index];
            return this._unpackColor(packedColor);
        }

        switch (gradient.mode) {
            case 2:
                return this._lerpColor(gradient.colorMin, gradient.colorMax, t);

            case 3:
                return this._evaluateComplexGradient(gradient.gradientKeys as any, t);

            default:
                return { ...gradient.color };
        }
    }

    private _evaluateComplexGradient(
        keys: any[] | undefined,
        t: number
    ): { r: number; g: number; b: number; a: number } {
        if (!keys || keys.length === 0) {
            return { r: 1, g: 1, b: 1, a: 1 };
        }

        if (keys.length === 1) {
            return { ...keys[0].color };
        }

        for (let i = 0; i < keys.length - 1; i++) {
            const keyA = keys[i];
            const keyB = keys[i + 1];

            if (t >= keyA.time && t <= keyB.time) {
                const localT = (t - keyA.time) / (keyB.time - keyA.time);
                return this._interpolateColors(keyA.color, keyB.color, localT, keyA.interpolation);
            }
        }

        return { ...keys[keys.length - 1].color };
    }

    private _interpolateColors(
        colorA: { r: number; g: number; b: number; a: number },
        colorB: { r: number; g: number; b: number; a: number },
        t: number,
        interpolation: string = 'linear'
    ): { r: number; g: number; b: number; a: number } {
        let factor = t;

        switch (interpolation) {
            case 'step':
                factor = t < 0.5 ? 0 : 1;
                break;
            case 'smoothstep':
                factor = t * t * (3 - 2 * t);
                break;
            case 'linear':
            default:
                break;
        }

        return this._lerpColor(colorA, colorB, factor);
    }

    private _lerpColor(
        colorA: { r: number; g: number; b: number; a: number },
        colorB: { r: number; g: number; b: number; a: number },
        t: number
    ): { r: number; g: number; b: number; a: number } {
        return {
            r: colorA.r + (colorB.r - colorA.r) * t,
            g: colorA.g + (colorB.g - colorA.g) * t,
            b: colorA.b + (colorB.b - colorA.b) * t,
            a: colorA.a + (colorB.a - colorA.a) * t,
        };
    }

    private _addColors(
        colorA: { r: number; g: number; b: number; a: number },
        colorB: { r: number; g: number; b: number; a: number }
    ): { r: number; g: number; b: number; a: number } {
        return {
            r: colorA.r + colorB.r,
            g: colorA.g + colorB.g,
            b: colorA.b + colorB.b,
            a: colorA.a + colorB.a,
        };
    }

    private _multiplyColors(
        colorA: { r: number; g: number; b: number; a: number },
        colorB: { r: number; g: number; b: number; a: number }
    ): { r: number; g: number; b: number; a: number } {
        return {
            r: colorA.r * colorB.r,
            g: colorA.g * colorB.g,
            b: colorA.b * colorB.b,
            a: colorA.a * colorB.a,
        };
    }

    private _clampColor(color: { r: number; g: number; b: number; a: number }): {
        r: number;
        g: number;
        b: number;
        a: number;
    } {
        return {
            r: Math.max(0, Math.min(1, color.r)),
            g: Math.max(0, Math.min(1, color.g)),
            b: Math.max(0, Math.min(1, color.b)),
            a: Math.max(0, Math.min(1, color.a)),
        };
    }

    private _packColor(color: { r: number; g: number; b: number; a: number }): number {
        const r = Math.floor(color.r * 255);
        const g = Math.floor(color.g * 255);
        const b = Math.floor(color.b * 255);
        const a = Math.floor(color.a * 255);

        return (r << 24) | (g << 16) | (b << 8) | a;
    }

    private _unpackColor(packedColor: number): { r: number; g: number; b: number; a: number } {
        return {
            r: ((packedColor >>> 24) & 0xff) / 255,
            g: ((packedColor >>> 16) & 0xff) / 255,
            b: ((packedColor >>> 8) & 0xff) / 255,
            a: (packedColor & 0xff) / 255,
        };
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

    private _gradientConfigurationChanged(
        newConfig: ColorConfiguration,
        oldConfig: ColorConfiguration
    ): boolean {
        return (
            newConfig.color.mode !== oldConfig.color.mode ||
            JSON.stringify(newConfig.color) !== JSON.stringify(oldConfig.color)
        );
    }

    private _significantConfigChange(
        newConfig: ColorConfiguration,
        oldConfig: ColorConfiguration
    ): boolean {
        return (
            newConfig.velocityInfluence !== oldConfig.velocityInfluence ||
            newConfig.ageInfluence !== oldConfig.ageInfluence ||
            newConfig.sizeInfluence !== oldConfig.sizeInfluence
        );
    }

    getParticleColor(
        particleId: ParticleId
    ): { r: number; g: number; b: number; a: number } | null {
        const state = this._particleStates.get(particleId);
        return state ? { ...state.currentColor } : null;
    }

    getGradientColorAtTime(t: number): { r: number; g: number; b: number; a: number } {
        return this._evaluateGradient(this.config.color, t);
    }

    getActiveParticleCount(): number {
        return this._particleStates.size;
    }

    invalidateCache(): void {
        this._gradientCache.clear();
        this._buildColorLookupTable();
    }
}
