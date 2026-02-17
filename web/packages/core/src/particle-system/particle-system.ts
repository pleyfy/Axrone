import type { IVec3Like } from '@axrone/numeric';
import type { ParticleId, SystemId, ModuleId, EmitterId } from './types';
import type {
    IParticleSystem,
    IParticleEmitter,
    IModule,
    IParticleData,
    ISpatialIndex,
    ParticleSystemEventMap,
    ParticleBirthEvent,
    ParticleDeathEvent,
    ParticleCollisionEvent,
} from './core/interfaces';
import type { ParticleSystemConfiguration, ModuleType } from './core/configuration';
import { ParticleSystemException } from './core/error';
import { SOAParticleBuffer } from './core/particle-buffer';
import { UniformSpatialGrid } from './core/spatial-index';
import { EventEmitter } from '../event';

export class ParticleSystem implements IParticleSystem {
    private static _nextSystemId = 1;

    private readonly _id: SystemId;
    private readonly _particles: SOAParticleBuffer;
    private readonly _spatialIndex: ISpatialIndex;
    private readonly _modules = new Map<ModuleId, IModule>();
    private readonly _modulesByType = new Map<ModuleType, IModule[]>();
    private readonly _emitters = new Map<EmitterId, IParticleEmitter>();
    private readonly _eventEmitter = new EventEmitter<ParticleSystemEventMap>();

    private _configuration: ParticleSystemConfiguration;
    private _isPlaying = false;
    private _isPaused = false;
    private _time = 0;
    private _lastUpdateTime = 0;
    private _initialized = false;

    constructor(config?: Partial<ParticleSystemConfiguration>) {
        this._id = ParticleSystem._nextSystemId++ as SystemId;

        this._configuration = this._createDefaultConfiguration(config);

        this._particles = new SOAParticleBuffer();
        this._spatialIndex = new UniformSpatialGrid(
            this._configuration.bounds,
            this._configuration.cellSize
        );
    }

    get id(): SystemId {
        return this._id;
    }
    get isPlaying(): boolean {
        return this._isPlaying;
    }
    get isPaused(): boolean {
        return this._isPaused;
    }
    get particleCount(): number {
        return this._particles.count;
    }
    get time(): number {
        return this._time;
    }
    get emitters(): readonly IParticleEmitter[] {
        return Array.from(this._emitters.values());
    }
    get modules(): readonly IModule[] {
        return Array.from(this._modules.values());
    }

    initialize(): void {
        if (this._initialized) return;

        try {
            if (!this._particles.allocate(this._configuration.maxParticles)) {
                throw ParticleSystemException.memoryAllocationFailed(
                    this._configuration.maxParticles
                );
            }

            for (const module of this._modules.values()) {
                module.initialize();
            }

            for (const emitter of this._emitters.values()) {
                emitter.initialize();
            }

            this._initialized = true;
        } catch (error) {
            this.destroy();
            throw error;
        }
    }

    destroy(): void {
        if (!this._initialized) return;

        try {
            this.stop();

            for (const emitter of this._emitters.values()) {
                emitter.destroy();
            }

            for (const module of this._modules.values()) {
                module.destroy();
            }

            this._particles.deallocate();
            this._spatialIndex.clear();

            this._emitters.clear();
            this._modules.clear();
            this._modulesByType.clear();

            this._initialized = false;
        } catch (error) {
            console.warn('Error during particle system destruction:', error);
        }
    }

    reset(): void {
        this._throwIfNotInitialized();

        this._time = 0;
        this._lastUpdateTime = 0;
        this._particles.clear();
        this._spatialIndex.clear();

        for (const module of this._modules.values()) {
            module.reset();
        }

        for (const emitter of this._emitters.values()) {
            emitter.reset();
        }
    }

    play(): void {
        this._throwIfNotInitialized();

        this._isPlaying = true;
        this._isPaused = false;
        this._lastUpdateTime = performance.now() / 1000;
    }

    pause(): void {
        this._isPaused = true;
    }

    stop(): void {
        this._isPlaying = false;
        this._isPaused = false;

        for (const emitter of this._emitters.values()) {
            emitter.stop();
        }
    }

    restart(): void {
        this.stop();
        this.reset();
        this.play();
    }

    update(deltaTime: number): void {
        this._throwIfNotInitialized();

        if (!this._isPlaying || this._isPaused) return;

        this._time += deltaTime;

        this._updateParticleLifetime(deltaTime);
        this._updateModules(deltaTime);
        this._updateEmitters(deltaTime);
        this._updateSpatialIndex();

        this._lastUpdateTime = this._time;
    }

    addEmitter(emitter: IParticleEmitter): void {
        this._emitters.set(emitter.id, emitter);

        if (this._initialized) {
            emitter.initialize();
        }
    }

    removeEmitter(emitterId: EmitterId): boolean {
        const emitter = this._emitters.get(emitterId);
        if (!emitter) return false;

        emitter.destroy();
        return this._emitters.delete(emitterId);
    }

    getEmitter(emitterId: EmitterId): IParticleEmitter | null {
        return this._emitters.get(emitterId) ?? null;
    }

    addModule<T extends ModuleType>(module: IModule<T>): void {
        this._modules.set(module.id, module);

        let typeModules = this._modulesByType.get(module.type);
        if (!typeModules) {
            typeModules = [];
            this._modulesByType.set(module.type, typeModules);
        }
        typeModules.push(module);
        typeModules.sort((a, b) => b.priority - a.priority);

        if (this._initialized) {
            module.initialize();
        }
    }

    removeModule(moduleId: ModuleId): boolean {
        const module = this._modules.get(moduleId);
        if (!module) return false;

        module.destroy();
        this._modules.delete(moduleId);

        const typeModules = this._modulesByType.get(module.type);
        if (typeModules) {
            const index = typeModules.indexOf(module);
            if (index !== -1) {
                typeModules.splice(index, 1);
            }
        }

        return true;
    }

    getModule<T extends ModuleType>(moduleId: ModuleId): IModule<T> | null {
        return (this._modules.get(moduleId) as IModule<T>) ?? null;
    }

    getModulesByType<T extends ModuleType>(type: T): readonly IModule<T>[] {
        return (this._modulesByType.get(type) as IModule<T>[]) ?? [];
    }

    getParticles(): IParticleData {
        return this._particles;
    }

    getSpatialIndex(): ISpatialIndex {
        return this._spatialIndex;
    }

    emit(count: number, emitterId?: EmitterId): readonly ParticleId[] {
        this._throwIfNotInitialized();

        if (emitterId) {
            const emitter = this._emitters.get(emitterId);
            if (emitter) {
                return emitter.emit(count);
            }
            return [];
        }

        const result: ParticleId[] = [];
        for (let i = 0; i < count; i++) {
            const particleId = this._particles.addParticle(
                { x: 0, y: 0, z: 0 },
                { x: 0, y: 1, z: 0 },
                5.0,
                1.0,
                0xffffffff
            );

            if (particleId) {
                result.push(particleId);
                this._emitBirthEvent(particleId, emitterId);
            }
        }

        return result;
    }

    killParticle(particleId: ParticleId): boolean {
        const index = this._particles.getParticleIndex(particleId);
        if (index === -1) return false;

        const position = this._particles.getPosition(index);
        const velocity = this._particles.getVelocity(index);
        const age = this._particles.getAge(index);
        const lifetime = this._particles.getLifetime(index);

        this._spatialIndex.remove(particleId);
        const removed = this._particles.removeParticle(index);

        if (removed) {
            this._emitDeathEvent(particleId, 'killed', position, velocity, age, lifetime);
        }

        return removed;
    }

    killAllParticles(): void {
        for (let i = 0; i < this._particles.capacity; i++) {
            if (this._particles.alive[i]) {
                const particleId = this._particles.getParticleId(i);
                this.killParticle(particleId);
            }
        }
    }

    addEventListener<K extends keyof ParticleSystemEventMap>(
        type: K,
        listener: (event: ParticleSystemEventMap[K]) => void
    ): void {
        this._eventEmitter.on(type, listener);
    }

    removeEventListener<K extends keyof ParticleSystemEventMap>(
        type: K,
        listener: (event: ParticleSystemEventMap[K]) => void
    ): void {
        this._eventEmitter.off(type, listener);
    }

    configure(config: Partial<ParticleSystemConfiguration>): void {
        this._configuration = { ...this._configuration, ...config };

        if (
            this._initialized &&
            config.maxParticles &&
            config.maxParticles !== this._particles.capacity
        ) {
            this._particles.resize(config.maxParticles);
        }
    }

    getConfiguration(): Readonly<ParticleSystemConfiguration> {
        return { ...this._configuration };
    }

    private _createDefaultConfiguration(
        config?: Partial<ParticleSystemConfiguration>
    ): ParticleSystemConfiguration {
        return {
            maxParticles: 1000,
            bounds: {
                min: { x: -100, y: -100, z: -100 },
                max: { x: 100, y: 100, z: 100 },
            },
            cellSize: { x: 10, y: 10, z: 10 },
            simulationSpace: 1,
            enableSpatialOptimization: true,
            enableMultithreading: false,
            preallocateMemory: true,
            autoOptimizeMemory: true,
            ...config,
        };
    }

    private _updateParticleLifetime(deltaTime: number): void {
        const particlesToKill: ParticleId[] = [];

        for (let i = 0; i < this._particles.capacity; i++) {
            if (!this._particles.alive[i]) continue;

            const age = this._particles.ages[i] + deltaTime;
            const lifetime = this._particles.lifetimes[i];

            this._particles.setAge(i, age);

            if (age >= lifetime) {
                const particleId = this._particles.getParticleId(i);
                particlesToKill.push(particleId);
            }
        }

        for (const particleId of particlesToKill) {
            this.killParticle(particleId);
        }
    }

    private _updateModules(deltaTime: number): void {
        const sortedModules = Array.from(this._modules.values())
            .filter((m) => m.enabled)
            .sort((a, b) => b.priority - a.priority);

        for (const module of sortedModules) {
            module.update(deltaTime);

            if (module.canProcess(this._particles)) {
                module.process(this._particles, deltaTime);
            }
        }
    }

    private _updateEmitters(deltaTime: number): void {
        for (const emitter of this._emitters.values()) {
            emitter.update(deltaTime);
        }
    }

    private _updateSpatialIndex(): void {
        if (!this._configuration.enableSpatialOptimization) return;

        for (let i = 0; i < this._particles.capacity; i++) {
            if (!this._particles.alive[i]) continue;

            const particleId = this._particles.getParticleId(i);
            const position = this._particles.getPosition(i);

            this._spatialIndex.insert(particleId, position);
        }
    }

    private _emitBirthEvent(particleId: ParticleId, emitterId?: EmitterId): void {
        const index = this._particles.getParticleIndex(particleId);
        if (index === -1) return;

        const position = this._particles.getPosition(index);
        const velocity = this._particles.getVelocity(index);
        const lifetime = this._particles.getLifetime(index);

        const event: ParticleBirthEvent = {
            type: 'birth',
            particleId,
            systemId: this._id,
            timestamp: this._time,
            position,
            velocity,
            emitterId: emitterId ?? (0 as EmitterId),
            initialLifetime: lifetime,
        };

        this._eventEmitter.emit('birth', event);
    }

    private _emitDeathEvent(
        particleId: ParticleId,
        reason: 'expired' | 'killed' | 'collision' | 'bounds',
        position: IVec3Like,
        velocity: IVec3Like,
        age: number,
        lifetime: number
    ): void {
        const event: ParticleDeathEvent = {
            type: 'death',
            particleId,
            systemId: this._id,
            timestamp: this._time,
            position: { x: position.x, y: position.y, z: position.z },
            velocity: { x: velocity.x, y: velocity.y, z: velocity.z },
            reason,
            age,
            lifetime,
        };

        this._eventEmitter.emit('death', event);
    }

    private _emitCollisionEvent(
        particleId: ParticleId,
        collider: unknown,
        normal: IVec3Like,
        impulse: number
    ): void {
        const index = this._particles.getParticleIndex(particleId);
        if (index === -1) return;

        const position = this._particles.getPosition(index);
        const velocity = this._particles.getVelocity(index);

        const event: ParticleCollisionEvent = {
            type: 'collision',
            particleId,
            systemId: this._id,
            timestamp: this._time,
            position,
            velocity,
            collider,
            normal: { x: normal.x, y: normal.y, z: normal.z },
            impulse,
        };

        this._eventEmitter.emit('collision', event);
    }

    private _throwIfNotInitialized(): void {
        if (!this._initialized) {
            throw ParticleSystemException.systemNotInitialized(this._id);
        }
    }
}
