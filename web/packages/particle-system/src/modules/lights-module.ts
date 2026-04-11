import type { IVec3Like } from '@axrone/numeric';
import type { LightsConfiguration } from '../core/configuration';
import type { IParticleBuffer } from '../core/interfaces';
import type { ParticleId } from '../types';
import { BaseModule } from './base-module';

interface Light {
    id: string;
    position: IVec3Like;
    color: { r: number; g: number; b: number };
    intensity: number;
    range: number;
    type: 'point' | 'directional' | 'spot';
    direction?: IVec3Like; // For directional and spot lights
    innerCone?: number; // For spot lights
    outerCone?: number; // For spot lights
    active: boolean;
}

interface ParticleLightInfluence {
    particleId: ParticleId;
    influences: Array<{
        lightId: string;
        influence: number; // 0-1
        distance: number;
    }>;
}

export class LightsModule extends BaseModule<'lights'> {
    private _lights = new Map<string, Light>();
    private _influences = new Map<ParticleId, ParticleLightInfluence>();
    private _lightPool: Light[] = [];
    private _influencePool: ParticleLightInfluence[] = [];
    private _maxLights: number;
    private _lightCounter = 0;

    constructor(configuration: LightsConfiguration) {
        super('lights', configuration, 900);
        this._maxLights = 32; // Default max lights
    }

    protected onInitialize(): void {
        // Pre-allocate light objects
        for (let i = 0; i < this._maxLights; i++) {
            this._lightPool.push({
                id: '',
                position: { x: 0, y: 0, z: 0 },
                color: { r: 1, g: 1, b: 1 },
                intensity: 1,
                range: 10,
                type: 'point',
                active: false,
            });
        }

        // Pre-allocate influence tracking objects
        for (let i = 0; i < 1000; i++) {
            this._influencePool.push({
                particleId: 0 as ParticleId,
                influences: [],
            });
        }

        // Add default lights if configured
        if (this.config.defaultLights) {
            this._addDefaultLights();
        }
    }

    protected onDestroy(): void {
        this._lights.clear();
        this._influences.clear();
        this._lightPool.length = 0;
        this._influencePool.length = 0;
    }

    protected onReset(): void {
        // Return all lights to pool
        for (const light of this._lights.values()) {
            this._returnLightToPool(light);
        }
        this._lights.clear();

        // Clear influences
        for (const influence of this._influences.values()) {
            this._returnInfluenceToPool(influence);
        }
        this._influences.clear();

        // Re-add default lights
        if (this.config.defaultLights) {
            this._addDefaultLights();
        }
    }

    protected onUpdate(deltaTime: number): void {
        if (!this.config.enabled) return;

        const config = this.config;

        // Update animated lights
        for (const light of this._lights.values()) {
            if (config.animateLights) {
                this._updateLightAnimation(light, deltaTime);
            }
        }
    }

    protected onProcess(particles: IParticleBuffer, deltaTime: number): void {
        if (!this.config.enabled || this._lights.size === 0) return;

        const config = this.config;
        const positions = particles.positions as Float32Array;
        const colors = particles.colors as Float32Array;
        const alive = particles.alive as Uint32Array;
        const count = particles.count;

        // Calculate light influences for each particle
        for (let i = 0; i < count; i++) {
            if (!alive[i]) continue;

            const particleId = particles.getParticleId(i);
            const i3 = i * 3;
            const i4 = i * 4;

            const particlePos = {
                x: positions[i3],
                y: positions[i3 + 1],
                z: positions[i3 + 2],
            };

            // Calculate influences from all lights
            const influences = this._calculateLightInfluences(particlePos, config);

            if (influences.length > 0) {
                // Store influences for this particle
                let influence = this._influences.get(particleId);
                if (!influence) {
                    const newInfluence = this._acquireInfluenceFromPool();
                    if (newInfluence) {
                        newInfluence.particleId = particleId;
                        this._influences.set(particleId, newInfluence);
                        influence = newInfluence;
                    }
                }

                if (influence) {
                    influence.influences = influences;
                }

                // Apply lighting to particle color
                if (config.affectParticleColor) {
                    this._applyLightingToParticle(i, particles, influences, config);
                }
            }
        }

        // Clean up influences for dead particles
        for (const [particleId, influence] of this._influences.entries()) {
            const particleIndex = particles.getParticleIndex(particleId);
            if (particleIndex === -1 || !alive[particleIndex]) {
                this._influences.delete(particleId);
                this._returnInfluenceToPool(influence);
            }
        }
    }

    protected onConfigure(newConfig: LightsConfiguration, oldConfig: LightsConfiguration): void {
        // Handle configuration changes
        if (newConfig.maxLights !== oldConfig.maxLights) {
            this._maxLights = newConfig.maxLights;
        }

        if (newConfig.defaultLights !== oldConfig.defaultLights) {
            this.onReset();
        }
    }

    private _addDefaultLights(): void {
        // Add a default key light
        this.addLight({
            position: { x: 10, y: 10, z: 10 },
            color: { r: 1, g: 0.9, b: 0.8 },
            intensity: 1.5,
            range: 20,
            type: 'point',
        });

        // Add a default fill light
        this.addLight({
            position: { x: -5, y: 5, z: 5 },
            color: { r: 0.8, g: 0.9, b: 1 },
            intensity: 0.8,
            range: 15,
            type: 'point',
        });
    }

    private _updateLightAnimation(light: Light, deltaTime: number): void {
        // Simple animation - oscillate intensity and position
        const time = performance.now() * 0.001;
        const baseIntensity = 1.0;

        light.intensity = baseIntensity + Math.sin(time * 2) * 0.3;

        // Slight position oscillation for dynamic lighting
        light.position.y += Math.sin(time * 1.5) * 0.1 * deltaTime;
    }

    private _calculateLightInfluences(
        particlePos: IVec3Like,
        config: LightsConfiguration
    ): Array<{ lightId: string; influence: number; distance: number }> {
        const influences: Array<{ lightId: string; influence: number; distance: number }> = [];

        for (const light of this._lights.values()) {
            if (!light.active) continue;

            const distance = this._calculateDistance(particlePos, light.position);

            if (distance <= light.range) {
                let influence = 0;

                switch (light.type) {
                    case 'point':
                        influence = this._calculatePointLightInfluence(
                            distance,
                            light.range,
                            light.intensity
                        );
                        break;
                    case 'directional':
                        influence = light.intensity; // Directional lights affect all particles equally
                        break;
                    case 'spot':
                        influence = this._calculateSpotLightInfluence(
                            particlePos,
                            light.position,
                            light.direction!,
                            light.innerCone!,
                            light.outerCone!,
                            light.range,
                            light.intensity
                        );
                        break;
                }

                if (influence > 0.01) {
                    // Threshold to avoid very small influences
                    influences.push({
                        lightId: light.id,
                        influence: Math.min(influence, 1),
                        distance,
                    });
                }
            }
        }

        // Sort by influence (strongest first) and limit to max influences
        influences.sort((a, b) => b.influence - a.influence);
        return influences.slice(0, config.maxInfluencesPerParticle);
    }

    private _calculatePointLightInfluence(
        distance: number,
        range: number,
        intensity: number
    ): number {
        // Inverse square falloff with smoothing
        const normalizedDistance = distance / range;
        const falloff = 1 / (1 + normalizedDistance * normalizedDistance);
        return falloff * intensity;
    }

    private _calculateSpotLightInfluence(
        particlePos: IVec3Like,
        lightPos: IVec3Like,
        lightDir: IVec3Like,
        innerCone: number,
        outerCone: number,
        range: number,
        intensity: number
    ): number {
        const distance = this._calculateDistance(particlePos, lightPos);
        if (distance > range) return 0;

        // Calculate angle between light direction and particle direction
        const toParticle = {
            x: particlePos.x - lightPos.x,
            y: particlePos.y - lightPos.y,
            z: particlePos.z - lightPos.z,
        };

        const toParticleLength = Math.sqrt(
            toParticle.x * toParticle.x + toParticle.y * toParticle.y + toParticle.z * toParticle.z
        );
        if (toParticleLength === 0) return intensity;

        const lightDirLength = Math.sqrt(
            lightDir.x * lightDir.x + lightDir.y * lightDir.y + lightDir.z * lightDir.z
        );
        if (lightDirLength === 0) return 0;

        const cosAngle =
            (toParticle.x * lightDir.x + toParticle.y * lightDir.y + toParticle.z * lightDir.z) /
            (toParticleLength * lightDirLength);
        const angle = Math.acos(Math.max(-1, Math.min(1, cosAngle)));

        // Calculate cone influence
        if (angle <= innerCone) {
            return this._calculatePointLightInfluence(distance, range, intensity);
        } else if (angle <= outerCone) {
            const t = (angle - innerCone) / (outerCone - innerCone);
            const coneInfluence = 1 - t;
            return this._calculatePointLightInfluence(distance, range, intensity) * coneInfluence;
        }

        return 0;
    }

    private _applyLightingToParticle(
        particleIndex: number,
        particles: IParticleBuffer,
        influences: Array<{ lightId: string; influence: number; distance: number }>,
        config: LightsConfiguration
    ): void {
        const i4 = particleIndex * 4;
        const colors = particles.colors as unknown as Uint32Array;
        const originalColor = colors[particleIndex];

        // Extract original color components
        const originalR = ((originalColor >>> 24) & 0xff) / 255;
        const originalG = ((originalColor >>> 16) & 0xff) / 255;
        const originalB = ((originalColor >>> 8) & 0xff) / 255;
        const originalA = (originalColor & 0xff) / 255;

        let totalR = 0,
            totalG = 0,
            totalB = 0;
        let totalInfluence = 0;

        // Accumulate lighting from all influences
        for (const influence of influences) {
            const light = this._lights.get(influence.lightId);
            if (!light) continue;

            const weight = influence.influence * config.lightInfluenceMultiplier;
            totalR += light.color.r * weight;
            totalG += light.color.g * weight;
            totalB += light.color.b * weight;
            totalInfluence += weight;
        }

        if (totalInfluence > 0) {
            // Normalize and blend with original color
            const avgR = totalR / totalInfluence;
            const avgG = totalG / totalInfluence;
            const avgB = totalB / totalInfluence;

            const blendFactor = Math.min(totalInfluence, 1) * config.lightBlendFactor;

            const finalR = originalR * (1 - blendFactor) + avgR * blendFactor;
            const finalG = originalG * (1 - blendFactor) + avgG * blendFactor;
            const finalB = originalB * (1 - blendFactor) + avgB * blendFactor;

            // Pack back to RGBA
            const packedColor =
                (Math.floor(Math.min(255, finalR * 255)) << 24) |
                (Math.floor(Math.min(255, finalG * 255)) << 16) |
                (Math.floor(Math.min(255, finalB * 255)) << 8) |
                Math.floor(originalA * 255);

            colors[particleIndex] = packedColor;
        }
    }

    private _calculateDistance(a: IVec3Like, b: IVec3Like): number {
        const dx = a.x - b.x;
        const dy = a.y - b.y;
        const dz = a.z - b.z;
        return Math.sqrt(dx * dx + dy * dy + dz * dz);
    }

    private _acquireLightFromPool(): Light | null {
        return this._lightPool.pop() || null;
    }

    private _returnLightToPool(light: Light): void {
        light.active = false;
        if (this._lightPool.length < this._maxLights) {
            this._lightPool.push(light);
        }
    }

    private _acquireInfluenceFromPool(): ParticleLightInfluence | null {
        const influence = this._influencePool.pop();
        if (influence) {
            influence.influences.length = 0;
        }
        return influence || null;
    }

    private _returnInfluenceToPool(influence: ParticleLightInfluence): void {
        influence.influences.length = 0;
        if (this._influencePool.length < 1000) {
            this._influencePool.push(influence);
        }
    }

    // Public API
    addLight(options: {
        position: IVec3Like;
        color: { r: number; g: number; b: number };
        intensity: number;
        range: number;
        type: 'point' | 'directional' | 'spot';
        direction?: IVec3Like;
        innerCone?: number;
        outerCone?: number;
    }): string {
        const light = this._acquireLightFromPool();
        if (!light || this._lights.size >= this._maxLights) {
            return '';
        }

        light.id = `light_${this._lightCounter++}`;
        light.position = { ...options.position };
        light.color = { ...options.color };
        light.intensity = options.intensity;
        light.range = options.range;
        light.type = options.type;
        light.direction = options.direction ? { ...options.direction } : undefined;
        light.innerCone = options.innerCone;
        light.outerCone = options.outerCone;
        light.active = true;

        this._lights.set(light.id, light);
        return light.id;
    }

    removeLight(lightId: string): boolean {
        const light = this._lights.get(lightId);
        if (light) {
            this._lights.delete(lightId);
            this._returnLightToPool(light);
            return true;
        }
        return false;
    }

    updateLight(lightId: string, updates: Partial<Omit<Light, 'id' | 'active'>>): boolean {
        const light = this._lights.get(lightId);
        if (light) {
            Object.assign(light, updates);
            return true;
        }
        return false;
    }

    getLightInfluences(
        particleId: ParticleId
    ): readonly { lightId: string; influence: number; distance: number }[] {
        const influence = this._influences.get(particleId);
        return influence ? influence.influences : [];
    }

    getActiveLights(): ReadonlyMap<string, Light> {
        return this._lights;
    }

    getActiveLightCount(): number {
        return this._lights.size;
    }
}
