import type { Vec3, IVec3Like } from '@axrone/numeric';
import type { ParticleId, SystemId, ModuleId, EmitterId, TextureId } from '../types';
import type {
    ImmutableVec3,
    ImmutableColor,
    ParticleSystemConfiguration,
    ModuleConfigurationMap,
    ModuleType,
} from './configuration';

export interface ReadonlyFloat32Array
    extends Omit<Float32Array, 'set' | 'fill' | 'sort' | 'reverse'> {
    readonly buffer: ArrayBuffer;
    readonly byteLength: number;
    readonly byteOffset: number;
    readonly length: number;
}

export interface ReadonlyUint32Array
    extends Omit<Uint32Array, 'set' | 'fill' | 'sort' | 'reverse'> {
    readonly buffer: ArrayBuffer;
    readonly byteLength: number;
    readonly byteOffset: number;
    readonly length: number;
}

export interface ILifecycle {
    initialize(): void;
    destroy(): void;
    reset(): void;
}

export interface IUpdatable {
    update(deltaTime: number): void;
}

export interface IConfigurable<T> {
    configure(config: T): void;
    getConfiguration(): Readonly<T>;
}

export interface IAllocatable {
    allocate(capacity: number): boolean;
    deallocate(): void;
    resize(newCapacity: number): boolean;
    readonly allocated: boolean;
    readonly capacity: number;
}

export interface IPoolable {
    reset(): void;
    dispose(): void;
}

export interface IParticleData {
    readonly count: number;
    readonly capacity: number;
    readonly alive: ReadonlyUint32Array;
    readonly positions: ReadonlyFloat32Array;
    readonly velocities: ReadonlyFloat32Array;
    readonly accelerations: ReadonlyFloat32Array;
    readonly lifetimes: ReadonlyFloat32Array;
    readonly ages: ReadonlyFloat32Array;
    readonly sizes: ReadonlyFloat32Array;
    readonly colors: ReadonlyFloat32Array;
    readonly rotations: ReadonlyFloat32Array;
    readonly angularVelocities: ReadonlyFloat32Array;
    readonly customData: readonly ReadonlyFloat32Array[];
    readonly ids: ReadonlyUint32Array;
}

export interface IParticleBuffer extends IParticleData, IAllocatable {
    addParticle(
        position: IVec3Like,
        velocity: IVec3Like,
        lifetime: number,
        size: number,
        color: number
    ): ParticleId | null;

    removeParticle(index: number): boolean;
    killParticle(particleId: ParticleId): boolean;

    getParticleIndex(particleId: ParticleId): number;
    getParticleId(index: number): ParticleId;

    getPosition(index: number): Vec3;
    setPosition(index: number, position: IVec3Like): void;

    getVelocity(index: number): Vec3;
    setVelocity(index: number, velocity: IVec3Like): void;

    getLifetime(index: number): number;
    setLifetime(index: number, lifetime: number): void;

    getAge(index: number): number;
    setAge(index: number, age: number): void;

    getSize(index: number): number;
    setSize(index: number, size: number): void;

    getColor(index: number): number;
    setColor(index: number, color: number): void;

    getCustomData(index: number, slot: number): ReadonlyFloat32Array;
    setCustomData(index: number, slot: number, data: Float32Array): void;

    clear(): void;
    compact(): void;
    sort(compareFn?: (a: number, b: number) => number): void;
}

export interface ISpatialIndex {
    insert(particleId: ParticleId, position: IVec3Like): void;
    remove(particleId: ParticleId): boolean;
    update(particleId: ParticleId, oldPosition: IVec3Like, newPosition: IVec3Like): boolean;
    query(bounds: { min: IVec3Like; max: IVec3Like }): readonly ParticleId[];
    queryRadius(center: IVec3Like, radius: number): readonly ParticleId[];
    queryNearest(position: IVec3Like, count: number): readonly ParticleId[];
    clear(): void;
    optimize(): void;
    readonly bounds: { readonly min: ImmutableVec3; readonly max: ImmutableVec3 };
    readonly cellSize: ImmutableVec3;
    readonly particleCount: number;
}

export interface IModule<T extends keyof ModuleConfigurationMap = keyof ModuleConfigurationMap>
    extends ILifecycle,
        IUpdatable,
        IConfigurable<ModuleConfigurationMap[T]> {
    readonly id: ModuleId;
    readonly type: T;
    readonly priority: number;
    readonly enabled: boolean;
    readonly dependencies: readonly ModuleId[];

    setEnabled(enabled: boolean): void;
    canProcess(particles: IParticleData): boolean;
    process(particles: IParticleBuffer, deltaTime: number): void;
}

export interface IParticleEmitter extends ILifecycle, IUpdatable {
    readonly id: EmitterId;
    readonly isEmitting: boolean;
    readonly emissionRate: number;

    emit(count?: number): readonly ParticleId[];
    setEmissionRate(rate: number): void;
    start(): void;
    stop(): void;
    pause(): void;
    resume(): void;
}

export interface IParticleRenderer {
    render(particles: IParticleData, camera: unknown, deltaTime: number): void;
    setTexture(textureId: TextureId): void;
    setMaterial(material: unknown): void;
    getBounds(): { min: ImmutableVec3; max: ImmutableVec3 };
}

export interface IParticleSystem extends ILifecycle, IUpdatable {
    readonly id: SystemId;
    readonly isPlaying: boolean;
    readonly isPaused: boolean;
    readonly particleCount: number;
    readonly time: number;
    readonly emitters: readonly IParticleEmitter[];
    readonly modules: readonly IModule[];

    play(): void;
    pause(): void;
    stop(): void;
    restart(): void;

    addEmitter(emitter: IParticleEmitter): void;
    removeEmitter(emitterId: EmitterId): boolean;
    getEmitter(emitterId: EmitterId): IParticleEmitter | null;

    addModule<T extends ModuleType>(module: IModule<T>): void;
    removeModule(moduleId: ModuleId): boolean;
    getModule<T extends ModuleType>(moduleId: ModuleId): IModule<T> | null;
    getModulesByType<T extends ModuleType>(type: T): readonly IModule<T>[];

    getParticles(): IParticleData;
    getSpatialIndex(): ISpatialIndex;

    emit(count: number, emitterId?: EmitterId): readonly ParticleId[];
    killParticle(particleId: ParticleId): boolean;
    killAllParticles(): void;

    addEventListener<K extends keyof ParticleSystemEventMap>(
        type: K,
        listener: (event: ParticleSystemEventMap[K]) => void
    ): void;

    removeEventListener<K extends keyof ParticleSystemEventMap>(
        type: K,
        listener: (event: ParticleSystemEventMap[K]) => void
    ): void;

    configure(config: Partial<ParticleSystemConfiguration>): void;
    getConfiguration(): Readonly<ParticleSystemConfiguration>;
}

export interface ParticleEvent {
    readonly type: string;
    readonly particleId: ParticleId;
    readonly systemId: SystemId;
    readonly timestamp: number;
    readonly position: ImmutableVec3;
    readonly velocity: ImmutableVec3;
}

export interface ParticleBirthEvent extends ParticleEvent {
    readonly type: 'birth';
    readonly emitterId: EmitterId;
    readonly initialLifetime: number;
}

export interface ParticleDeathEvent extends ParticleEvent {
    readonly type: 'death';
    readonly reason: 'expired' | 'killed' | 'collision' | 'bounds';
    readonly age: number;
    readonly lifetime: number;
}

export interface ParticleCollisionEvent extends ParticleEvent {
    readonly type: 'collision';
    readonly collider: unknown;
    readonly normal: ImmutableVec3;
    readonly impulse: number;
}

export interface ParticleSystemEventMap {
    readonly birth: ParticleBirthEvent;
    readonly death: ParticleDeathEvent;
    readonly collision: ParticleCollisionEvent;
}

export interface IMemoryManager {
    allocate(size: number, alignment?: number): ArrayBuffer | null;
    deallocate(buffer: ArrayBuffer): void;
    reallocate(buffer: ArrayBuffer, newSize: number): ArrayBuffer | null;
    getStats(): {
        readonly totalAllocated: number;
        readonly totalUsed: number;
        readonly allocationCount: number;
        readonly fragmentationRatio: number;
    };
}

export interface IForce {
    readonly type:
        | 'gravity'
        | 'drag'
        | 'turbulence'
        | 'vortex'
        | 'directional'
        | 'point'
        | 'custom';
    readonly strength: number;
    readonly direction: IVec3Like;
    readonly position?: IVec3Like;
    readonly range?: number;
    readonly falloff: 'none' | 'linear' | 'quadratic' | 'custom';
    readonly ageMultiplier?: number | unknown; // For curve evaluation
    readonly timeVarying?: boolean;
    readonly customFunction?: (
        position: IVec3Like,
        velocity: IVec3Like,
        age: number,
        mass: number,
        deltaTime: number
    ) => IVec3Like;
}

export interface IObjectPool<T extends IPoolable> {
    acquire(): T | null;
    release(item: T): void;
    clear(): void;
    readonly size: number;
    readonly available: number;
}

export interface ISimulationScheduler {
    schedule(task: () => void, priority?: number): void;
    scheduleImmediate(task: () => void): void;
    scheduleDeferred(task: () => void, delay: number): void;
    update(deltaTime: number): void;
    clear(): void;
}
