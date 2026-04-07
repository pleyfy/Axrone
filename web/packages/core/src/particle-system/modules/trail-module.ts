import type { IVec3Like } from '@axrone/numeric';
import type { TrailConfiguration } from '../core/configuration';
import type { IParticleBuffer } from '../core/interfaces';
import type { ParticleId } from '../types';
import { BaseModule } from './base-module';

interface TrailVertex {
    position: IVec3Like;
    width: number;
    color: { r: number; g: number; b: number; a: number };
    age: number;
    particleId: ParticleId;
}

interface Trail {
    particleId: ParticleId;
    vertices: TrailVertex[];
    lastPosition: IVec3Like;
    totalDistance: number;
    active: boolean;
}

export class TrailModule extends BaseModule<'trail'> {
    private _trails = new Map<ParticleId, Trail>();
    private _trailPool: Trail[] = [];
    private _vertexPool: TrailVertex[] = [];
    private _maxTrails: number;

    constructor(configuration: TrailConfiguration) {
        super('trail', configuration, 800);
        this._maxTrails = 1000;
    }

    protected onInitialize(): void {
        for (let i = 0; i < this._maxTrails; i++) {
            this._trailPool.push({
                particleId: 0 as ParticleId,
                vertices: [],
                lastPosition: { x: 0, y: 0, z: 0 },
                totalDistance: 0,
                active: false,
            });
        }

        for (let i = 0; i < this._maxTrails * 50; i++) {
            this._vertexPool.push({
                position: { x: 0, y: 0, z: 0 },
                width: 1,
                color: { r: 1, g: 1, b: 1, a: 1 },
                age: 0,
                particleId: 0 as ParticleId,
            });
        }
    }

    protected onDestroy(): void {
        this._trails.clear();
        this._trailPool.length = 0;
        this._vertexPool.length = 0;
    }

    protected onReset(): void {
        for (const trail of this._trails.values()) {
            this._returnTrailToPool(trail);
        }
        this._trails.clear();
    }

    protected onUpdate(deltaTime: number): void {
        if (!this.config.enabled) return;

        const config = this.config;

        for (const [particleId, trail] of this._trails.entries()) {
            this._updateTrail(trail, deltaTime, config);

            if (!trail.active || trail.vertices.length === 0) {
                this._trails.delete(particleId);
                this._returnTrailToPool(trail);
            }
        }
    }

    protected onProcess(particles: IParticleBuffer, deltaTime: number): void {
        if (!this.config.enabled) return;

        const config = this.config;
        const positions = particles.positions as Float32Array;
        const colors = particles.colors as Float32Array;
        const sizes = particles.sizes as Float32Array;
        const alive = particles.alive as Uint32Array;
        const count = particles.count;

        for (let i = 0; i < count; i++) {
            if (!alive[i]) continue;

            const particleId = particles.getParticleId(i);
            const i3 = i * 3;
            const i4 = i * 4;

            const currentPos = {
                x: positions[i3],
                y: positions[i3 + 1],
                z: positions[i3 + 2],
            };

            let trail = this._trails.get(particleId);

            if (!trail) {
                const newTrail = this._acquireTrailFromPool();
                if (newTrail) {
                    newTrail.particleId = particleId;
                    newTrail.lastPosition = { ...currentPos };
                    newTrail.totalDistance = 0;
                    newTrail.active = true;
                    this._trails.set(particleId, newTrail);
                    trail = newTrail;
                }
            } else {
                this._updateTrailPosition(trail, currentPos, i, particles, config, deltaTime);
            }
        }

        for (const [particleId, trail] of this._trails.entries()) {
            const particleIndex = particles.getParticleIndex(particleId);
            if (particleIndex === -1 || !alive[particleIndex]) {
                if (config.dieWithParticles) {
                    trail.active = false;
                }
            }
        }
    }

    protected onConfigure(newConfig: TrailConfiguration, oldConfig: TrailConfiguration): void {
        if (newConfig.mode !== oldConfig.mode) {
            this.onReset();
        }
    }

    private _updateTrail(trail: Trail, deltaTime: number, config: TrailConfiguration): void {
        const lifetimeValue = this._evaluateLifetime(config.lifetime, 0);

        for (let i = trail.vertices.length - 1; i >= 0; i--) {
            const vertex = trail.vertices[i];
            vertex.age += deltaTime;

            if (vertex.age > lifetimeValue) {
                this._returnVertexToPool(vertex);
                trail.vertices.splice(i, 1);
            }
        }
    }

    private _updateTrailPosition(
        trail: Trail,
        currentPos: IVec3Like,
        particleIndex: number,
        particles: IParticleBuffer,
        config: TrailConfiguration,
        deltaTime: number
    ): void {
        const dx = currentPos.x - trail.lastPosition.x;
        const dy = currentPos.y - trail.lastPosition.y;
        const dz = currentPos.z - trail.lastPosition.z;
        const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);

        if (distance >= config.minimumVertexDistance) {
            const vertex = this._acquireVertexFromPool();
            if (vertex) {
                vertex.position = { ...currentPos };
                vertex.age = 0;
                vertex.particleId = trail.particleId;

                const widthValue = this._evaluateWidth(config.width, 0);
                if (config.sizeAffectsWidth) {
                    const size = particles.getSize(particleIndex);
                    vertex.width = widthValue * size;
                } else {
                    vertex.width = widthValue;
                }

                if (config.inheritParticleColor) {
                    const particleColor = particles.getColor(particleIndex);
                    vertex.color = {
                        r: ((particleColor >>> 24) & 0xff) / 255,
                        g: ((particleColor >>> 16) & 0xff) / 255,
                        b: ((particleColor >>> 8) & 0xff) / 255,
                        a: (particleColor & 0xff) / 255,
                    };
                } else {
                    vertex.color = this._evaluateTrailColor(config.color, 0);
                }

                trail.vertices.push(vertex);
                trail.lastPosition = { ...currentPos };
                trail.totalDistance += distance;

                const maxVertices = Math.floor(config.ratio * 100);
                while (trail.vertices.length > maxVertices) {
                    const oldVertex = trail.vertices.shift();
                    if (oldVertex) {
                        this._returnVertexToPool(oldVertex);
                    }
                }
            }
        }
    }

    private _acquireTrailFromPool(): Trail | null {
        const trail = this._trailPool.pop();
        if (trail) {
            trail.vertices.length = 0;
            trail.active = true;
            trail.totalDistance = 0;
        }
        return trail || null;
    }

    private _returnTrailToPool(trail: Trail): void {
        for (const vertex of trail.vertices) {
            this._returnVertexToPool(vertex);
        }
        trail.vertices.length = 0;
        trail.active = false;

        if (this._trailPool.length < this._maxTrails) {
            this._trailPool.push(trail);
        }
    }

    private _acquireVertexFromPool(): TrailVertex | null {
        return this._vertexPool.pop() || null;
    }

    private _returnVertexToPool(vertex: TrailVertex): void {
        if (this._vertexPool.length < this._maxTrails * 50) {
            vertex.age = 0;
            this._vertexPool.push(vertex);
        }
    }

    private _evaluateLifetime(curve: TrailConfiguration['lifetime'], t: number): number {
        switch (curve.mode) {
            case 0:
                return curve.constant;
            case 2:
                return curve.constantMin + (curve.constantMax - curve.constantMin) * t;
            default:
                return curve.constant;
        }
    }

    private _evaluateWidth(curve: TrailConfiguration['width'], t: number): number {
        switch (curve.mode) {
            case 0:
                return curve.constant;
            case 2:
                return curve.constantMin + (curve.constantMax - curve.constantMin) * t;
            default:
                return curve.constant;
        }
    }

    private _evaluateTrailColor(
        gradient: TrailConfiguration['color'],
        t: number
    ): { r: number; g: number; b: number; a: number } {
        switch (gradient.mode) {
            case 0:
                return { ...gradient.color };
            case 2:
                return this._lerpColor(gradient.colorMin, gradient.colorMax, t);
            default:
                return { ...gradient.color };
        }
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

    getTrails(): ReadonlyMap<ParticleId, Trail> {
        return this._trails;
    }

    getTrailVertices(particleId: ParticleId): readonly TrailVertex[] {
        const trail = this._trails.get(particleId);
        return trail ? trail.vertices : [];
    }

    getActiveTrailCount(): number {
        return this._trails.size;
    }

    getTotalVertexCount(): number {
        let count = 0;
        for (const trail of this._trails.values()) {
            count += trail.vertices.length;
        }
        return count;
    }
}
