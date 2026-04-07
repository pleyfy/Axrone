import { Vec3, IVec3Like, Mat4 } from '@axrone/numeric';
import { AABB3D } from '../geometry';
import { MemoryPool, PoolableObject } from '@axrone/utility';
import {
    ParticleId,
    SystemId,
    EmitterId,
    EmitterShape,
    SimulationSpace,
    SortMode,
    StopAction,
    CullingMode,
    RingBufferMode,
    Curve,
    Gradient,
    Burst,
    ParticleEvent,
} from './types';

export interface IParticleSystemModule {
    readonly name: string;
    readonly enabled: boolean;
    initialize(system: IParticleSystem): void;
    update(deltaTime: number, particles: IParticleSOA): void;
    reset(): void;
}

export interface IParticleSOA {
    readonly capacity: number;
    readonly count: number;
    readonly positions: Float32Array;
    readonly velocities: Float32Array;
    readonly accelerations: Float32Array;
    readonly lifetimes: Float32Array;
    readonly ages: Float32Array;
    readonly sizes: Float32Array;
    readonly colors: Float32Array;
    readonly rotations: Float32Array;
    readonly angularVelocities: Float32Array;
    readonly customData1: Float32Array;
    readonly customData2: Float32Array;
    readonly ids: Uint32Array;

    addParticle(
        position: IVec3Like,
        velocity: IVec3Like,
        lifetime: number,
        size: number,
        color: number
    ): ParticleId | null;
    removeParticle(index: number): void;
    getParticlePosition(index: number): Vec3;
    setParticlePosition(index: number, position: IVec3Like): void;
    getParticleVelocity(index: number): Vec3;
    setParticleVelocity(index: number, velocity: IVec3Like): void;
    getActiveIndices(): number[];
    clear(): void;
    resize(newCapacity: number): void;
}

export interface ISpatialCell extends PoolableObject {
    bounds: AABB3D;
    particles: ParticleId[];
    neighborCells: ISpatialCell[];
    centerMass?: Vec3;
    density?: number;
}

export interface ISpatialGrid {
    readonly cellSize: Vec3;
    readonly bounds: AABB3D;
    insert(particleId: ParticleId, position: Vec3): void;
    remove(particleId: ParticleId): void;
    update(particleId: ParticleId, oldPosition: Vec3, newPosition: Vec3): void;
    query(bounds: AABB3D): ParticleId[];
    queryRadius(center: Vec3, radius: number): ParticleId[];
    clear(): void;
    getCellAt(position: Vec3): ISpatialCell | null;
    getNeighborCells(cell: ISpatialCell): ISpatialCell[];
}

export interface IParticleSystem {
    readonly id: SystemId;
    readonly isPlaying: boolean;
    readonly isPaused: boolean;
    readonly isStopped: boolean;
    readonly particleCount: number;
    readonly time: number;

    play(): void;
    pause(): void;
    stop(): void;
    clear(): void;
    emit(count: number): void;
    emitFromPosition(position: IVec3Like): void;

    getParticles(): IParticleSOA;
    getSpatialGrid(): ISpatialGrid;
    addEventListener(type: string, listener: (event: ParticleEvent) => void): void;
    removeEventListener(type: string, listener: (event: ParticleEvent) => void): void;
}

export interface IEmissionModule extends IParticleSystemModule {
    rateOverTime: Curve;
    rateOverDistance: Curve;
    burstList: Burst[];
    enabled: boolean;
}

export interface IShapeModule extends IParticleSystemModule {
    enabled: boolean;
    shape: EmitterShape;
    angle: number;
    radius: number;
    donutRadius: number;
    length: number;
    box: Vec3;
    circle: { radius: number; arc: number; arcMode: number; arcSpread: number; thickness: number };
    hemisphere: { radius: number; emitFromShell: boolean };
    cone: {
        angle: number;
        radius: number;
        length: number;
        emitFrom: number;
        randomizeDirection: number;
    };
    donut: { radius: number; donutRadius: number; arc: number; arcMode: number };
    mesh: {
        mesh: any;
        useMeshMaterialIndex: boolean;
        materialIndex: number;
        useMeshColors: boolean;
        normalOffset: number;
    };
    sprite: { sprite: any; normalOffset: number };
    spriteRenderer: { sprite: any; normalOffset: number };
    skinnedMeshRenderer: {
        mesh: any;
        useMeshMaterialIndex: boolean;
        materialIndex: number;
        useMeshColors: boolean;
        normalOffset: number;
    };
    rectangle: { x: number; y: number; z: number };
    edge: { radius: number; radiusMode: number; arc: number; arcMode: number };
    position: Vec3;
    rotation: Vec3;
    scale: Vec3;
    alignToDirection: boolean;
    randomDirectionAmount: number;
    sphericalDirectionAmount: number;
    randomPositionAmount: number;
    biasType: number;
    bias: number;
    texture: any;
    textureClipChannel: number;
    textureClipThreshold: number;
    textureColorAffectsParticles: boolean;
    textureAlphaAffectsParticles: boolean;
    textureBilinearFiltering: boolean;
    textureUVChannel: number;
}

export interface IVelocityModule extends IParticleSystemModule {
    enabled: boolean;
    linear: Vec3;
    orbital: Vec3;
    offset: Vec3;
    radial: Curve;
    speedModifier: Curve;
    space: SimulationSpace;
}

export interface IForceModule extends IParticleSystemModule {
    enabled: boolean;
    force: Vec3;
    relativeTo: SimulationSpace;
    randomizePerFrame: boolean;
}

export interface IColorModule extends IParticleSystemModule {
    enabled: boolean;
    color: Gradient;
}

export interface ISizeModule extends IParticleSystemModule {
    enabled: boolean;
    size: Curve;
    separateAxes: boolean;
    x: Curve;
    y: Curve;
    z: Curve;
}

export interface IRotationModule extends IParticleSystemModule {
    enabled: boolean;
    angularVelocity: Vec3;
    separateAxes: boolean;
    x: Curve;
    y: Curve;
    z: Curve;
}

export interface ICollisionModule extends IParticleSystemModule {
    enabled: boolean;
    type: number;
    mode: number;
    dampen: Curve;
    bounce: Curve;
    lifetimeLoss: Curve;
    minKillSpeed: number;
    maxKillSpeed: number;
    radiusScale: number;
    planes: any[];
    visualization: number;
    visualizeBounds: boolean;
    enableDynamicColliders: boolean;
    maxCollisionShapes: number;
    quality: number;
    voxelSize: number;
    collidesWith: number;
    collidesWithDynamic: boolean;
    interiorCollisions: boolean;
}

export interface INoiseModule extends IParticleSystemModule {
    enabled: boolean;
    separateAxes: boolean;
    strength: Vec3;
    frequency: number;
    scrollSpeed: Vec3;
    damping: boolean;
    octaves: number;
    octaveMultiplier: number;
    octaveScale: number;
    quality: number;
    remap: Vec3;
    remapEnabled: boolean;
    positionAmount: Vec3;
    rotationAmount: Vec3;
    sizeAmount: Vec3;
}

export interface ILimitVelocityModule extends IParticleSystemModule {
    enabled: boolean;
    separateAxes: boolean;
    limit: Vec3;
    limitX: Curve;
    limitY: Curve;
    limitZ: Curve;
    dampen: number;
    space: SimulationSpace;
    drag: Curve;
    multiplyDragByParticleSize: boolean;
    multiplyDragByParticleVelocity: boolean;
}

export interface ITextureSheetModule extends IParticleSystemModule {
    enabled: boolean;
    numTilesX: number;
    numTilesY: number;
    animation: number;
    useRandomRow: boolean;
    frameOverTime: Curve;
    startFrame: Curve;
    cycleCount: number;
    flipU: number;
    flipV: number;
    uvChannelMask: number;
    tiles: Vec3;
    animationType: number;
    rowMode: number;
    sprites: any[];
    speedRange: Vec3;
}

export interface ICurve {
    readonly mode: number;
    readonly constant: number;
    readonly constantMin: number;
    readonly constantMax: number;
    readonly curve?: Float32Array;
    readonly curveMin?: Float32Array;
    readonly curveMax?: Float32Array;
    readonly curveLength: number;
    readonly preWrapMode: number;
    readonly postWrapMode: number;
}

export interface IGradient {
    readonly mode: number;
    readonly colorKeys: Float32Array;
    readonly alphaKeys: Float32Array;
    readonly keyCount: number;
    readonly blendMode: number;
}

export interface IBurst {
    readonly time: number;
    readonly count: ICurve | any;
    readonly cycles: number;
    readonly interval: number;
    readonly probability: number;
    readonly repeatInterval: number;
}

export interface IEmissionConfig {
    readonly enabled: boolean;
    readonly rateOverTime: ICurve;
    readonly rateOverDistance: ICurve;
    readonly bursts: readonly IBurst[];
    readonly type: number;
}

export interface IShapeConfig {
    readonly enabled: boolean;
    readonly shape: EmitterShape;
    readonly radius: number;
    readonly radiusThickness: number;
    readonly radiusSpeed: ICurve;
    readonly radiusSpread: number;
    readonly angle: number;
    readonly length: number;
    readonly box: Vec3;
    readonly donutRadius: number;
    readonly position: Vec3;
    readonly rotation: Vec3;
    readonly scale: Vec3;
    readonly alignToDirection: boolean;
    readonly randomDirectionAmount: number;
    readonly sphericalDirectionAmount: number;
    readonly randomPositionAmount: number;
    readonly normalOffset: number;
    readonly meshSpawnSpeed: ICurve;
    readonly meshSpawnSpread: number;
    readonly useMeshMaterialIndex: boolean;
    readonly meshMaterialIndex: number;
    readonly useMeshColors: boolean;
    readonly texture: any;
    readonly textureClipChannel: number;
    readonly textureClipThreshold: number;
    readonly textureColorAffectsParticles: boolean;
    readonly textureAlphaAffectsParticles: boolean;
    readonly textureBilinearFiltering: boolean;
}

export interface IVelocityOverLifetimeConfig {
    readonly enabled: boolean;
    readonly linear: Vec3;
    readonly linearCurve: readonly [ICurve, ICurve, ICurve];
    readonly orbital: Vec3;
    readonly orbitalCurve: readonly [ICurve, ICurve, ICurve];
    readonly offset: Vec3;
    readonly offsetCurve: readonly [ICurve, ICurve, ICurve];
    readonly radial: ICurve;
    readonly speedModifier: ICurve;
    readonly space: SimulationSpace;
}

export interface IForceOverLifetimeConfig {
    readonly enabled: boolean;
    readonly force: Vec3;
    readonly forceCurve: readonly [ICurve, ICurve, ICurve];
    readonly space: SimulationSpace;
    readonly randomized: boolean;
}

export interface IColorOverLifetimeConfig {
    readonly enabled: boolean;
    readonly color: IGradient;
}

export interface IColorBySpeedConfig {
    readonly enabled: boolean;
    readonly color: IGradient;
    readonly speedRange: Vec3;
}

export interface ISizeOverLifetimeConfig {
    readonly enabled: boolean;
    readonly size: ICurve;
    readonly sizeCurve: readonly [ICurve, ICurve, ICurve];
    readonly separateAxes: boolean;
}

export interface ISizeBySpeedConfig {
    readonly enabled: boolean;
    readonly size: ICurve;
    readonly sizeCurve: readonly [ICurve, ICurve, ICurve];
    readonly speedRange: Vec3;
    readonly separateAxes: boolean;
}

export interface IRotationOverLifetimeConfig {
    readonly enabled: boolean;
    readonly angularVelocity: Vec3;
    readonly angularVelocityCurve: readonly [ICurve, ICurve, ICurve];
    readonly separateAxes: boolean;
}

export interface IRotationBySpeedConfig {
    readonly enabled: boolean;
    readonly angularVelocity: Vec3;
    readonly angularVelocityCurve: readonly [ICurve, ICurve, ICurve];
    readonly speedRange: Vec3;
    readonly separateAxes: boolean;
}

export interface INoiseConfig {
    readonly enabled: boolean;
    readonly strength: Vec3;
    readonly strengthCurve: readonly [ICurve, ICurve, ICurve];
    readonly frequency: number;
    readonly octaves: number;
    readonly octaveMultiplier: number;
    readonly octaveScale: number;
    readonly damping: boolean;
    readonly scrollSpeed: Vec3;
    readonly scrollSpeedCurve: readonly [ICurve, ICurve, ICurve];
    readonly separateAxes: boolean;
    readonly positionAmount: ICurve;
    readonly rotationAmount: ICurve;
    readonly sizeAmount: ICurve;
    readonly quality: number;
    readonly remapEnabled: boolean;
    readonly remap: Vec3;
    readonly remapCurve: readonly [ICurve, ICurve, ICurve];
}

export interface IPlane {
    readonly normal: IVec3Like;
    readonly distance: number;
}

export interface ICollisionConfig {
    readonly enabled: boolean;
    readonly type: number;
    readonly mode: number;
    readonly dampen: ICurve;
    readonly bounce: ICurve;
    readonly lifetimeLoss: ICurve;
    readonly minKillSpeed: number;
    readonly maxKillSpeed: number;
    readonly radiusScale: number;
    readonly planes: readonly IPlane[];
    readonly enableDynamicColliders: boolean;
    readonly quality: number;
    readonly voxelSize: number;
    readonly collidesWith: number;
    readonly collidesWithDynamic: boolean;
    readonly interiorCollisions: boolean;
    readonly maxCollisionShapes: number;
    readonly sendCollisionMessages: boolean;
    readonly multiplyColliderForceByCollisionAngle: boolean;
    readonly multiplyColliderForceByParticleSpeed: boolean;
    readonly multiplyColliderForceByParticleSize: boolean;
}

export interface ILimitVelocityConfig {
    readonly enabled: boolean;
    readonly limit: Vec3;
    readonly limitCurve: readonly [ICurve, ICurve, ICurve];
    readonly dampen: number;
    readonly separateAxes: boolean;
    readonly space: SimulationSpace;
    readonly drag: ICurve;
    readonly multiplyDragBySize: boolean;
    readonly multiplyDragByVelocity: boolean;
}

export interface ITextureSheetConfig {
    readonly enabled: boolean;
    readonly mode: number;
    readonly tiles: Vec3;
    readonly animation: number;
    readonly frameOverTime: ICurve;
    readonly startFrame: ICurve;
    readonly cycleCount: number;
    readonly flipU: number;
    readonly flipV: number;
    readonly uvChannelMask: number;
    readonly fps: number;
    readonly timeMode: number;
    readonly sprites: readonly any[];
    readonly spriteCount: number;
}

export interface ITrailConfig {
    readonly enabled: boolean;
    readonly mode: number;
    readonly ratio: number;
    readonly lifetime: ICurve;
    readonly lifetimeMultiplier: number;
    readonly minVertexDistance: number;
    readonly textureMode: number;
    readonly worldSpace: boolean;
    readonly dieWithParticles: boolean;
    readonly sizeAffectsWidth: boolean;
    readonly sizeAffectsLifetime: boolean;
    readonly inheritParticleColor: boolean;
    readonly colorOverLifetime: IGradient;
    readonly widthOverTrail: ICurve;
    readonly colorOverTrail: IGradient;
    readonly generateLightingData: boolean;
    readonly shadowBias: number;
    readonly splitSubEmitterRibbons: boolean;
    readonly attachRibbonsToTransform: boolean;
    readonly ribbonCount: number;
}

export interface ISubEmitterConfig {
    readonly enabled: boolean;
    readonly birth: readonly SystemId[];
    readonly collision: readonly SystemId[];
    readonly death: readonly SystemId[];
    readonly trigger: readonly SystemId[];
    readonly manualEmission: readonly SystemId[];
    readonly inherit: number;
    readonly emitProbability: number;
}

export interface ILightsConfig {
    readonly enabled: boolean;
    readonly ratio: number;
    readonly useRandomDistribution: boolean;
    readonly light: any;
    readonly useParticleColor: boolean;
    readonly sizeAffectsRange: boolean;
    readonly alphaAffectsIntensity: boolean;
    readonly range: ICurve;
    readonly rangeMultiplier: number;
    readonly intensity: ICurve;
    readonly intensityMultiplier: number;
    readonly maxLights: number;
}

export interface ICustomDataConfig {
    readonly enabled: boolean;
    readonly mode0: number;
    readonly vectorComponentCount0: number;
    readonly color0: IGradient;
    readonly vector0: readonly [ICurve, ICurve, ICurve, ICurve];
    readonly mode1: number;
    readonly vectorComponentCount1: number;
    readonly color1: IGradient;
    readonly vector1: readonly [ICurve, ICurve, ICurve, ICurve];
}

export interface IMainConfig {
    readonly duration: number;
    readonly loop: boolean;
    readonly prewarm: boolean;
    readonly prewarmCycles: number;
    readonly startDelay: ICurve;
    readonly startLifetime: ICurve;
    readonly startSpeed: ICurve;
    readonly startSize: ICurve;
    readonly startSizeX: ICurve;
    readonly startSizeY: ICurve;
    readonly startSizeZ: ICurve;
    readonly startRotation: ICurve;
    readonly startRotationX: ICurve;
    readonly startRotationY: ICurve;
    readonly startRotationZ: ICurve;
    readonly startColor: IGradient;
    readonly gravityModifier: ICurve;
    readonly simulationSpace: SimulationSpace;
    readonly simulationSpeed: number;
    readonly deltaTimeScale: number;
    readonly maxParticles: number;
    readonly scalingMode: number;
    readonly playOnAwake: boolean;
    readonly startSize3D: boolean;
    readonly startRotation3D: boolean;
    readonly flipRotation: number;
    readonly stopAction: StopAction;
    readonly cullingMode: CullingMode;
    readonly customSimulationSpace?: Mat4;
    readonly emitterVelocityMode: number;
    readonly inheritVelocity: ICurve;
    readonly ringBufferMode: RingBufferMode;
    readonly ringBufferLoopRange: Vec3;
    readonly useUnscaledTime: boolean;
    readonly autoRandomSeed: boolean;
    readonly randomSeed: number;
}

export interface IForceField {
    readonly type: number;
    readonly position: Vec3;
    readonly rotation: Vec3;
    readonly strength: number;
    readonly range: number;
    readonly falloff: ICurve;
    readonly enabled: boolean;
    readonly affectLifetime: boolean;
    readonly affectSize: boolean;
    readonly affectColor: boolean;
}

export interface ICollisionEvent {
    readonly particleIndex: number;
    readonly position: Vec3;
    readonly velocity: Vec3;
    readonly normal: Vec3;
    readonly otherCollider: any;
}

export interface IParticleSystemConfig {
    readonly main: IMainConfig;
    readonly emission: IEmissionConfig;
    readonly shape: IShapeConfig;
    readonly velocityOverLifetime: IVelocityOverLifetimeConfig;
    readonly forceOverLifetime: IForceOverLifetimeConfig;
    readonly colorOverLifetime: IColorOverLifetimeConfig;
    readonly colorBySpeed: IColorBySpeedConfig;
    readonly sizeOverLifetime: ISizeOverLifetimeConfig;
    readonly sizeBySpeed: ISizeBySpeedConfig;
    readonly rotationOverLifetime: IRotationOverLifetimeConfig;
    readonly rotationBySpeed: IRotationBySpeedConfig;
    readonly noise: INoiseConfig;
    readonly collision: ICollisionConfig;
    readonly limitVelocity: ILimitVelocityConfig;
    readonly textureSheet: ITextureSheetConfig;
    readonly trails: ITrailConfig;
    readonly subEmitters: ISubEmitterConfig;
    readonly lights: ILightsConfig;
    readonly customData: ICustomDataConfig;
}
