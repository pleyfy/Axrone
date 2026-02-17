import type { IVec3Like } from '@axrone/numeric';
import { LightAttenuationMode } from '../types';
import type {
    ParticleId,
    SystemId,
    ModuleId,
    EmitterId,
    TextureId,
    EmitterShape,
    SimulationSpace,
    SortMode,
    RenderMode,
    CurveMode,
    GradientMode,
} from '../types';

export interface ImmutableVec3 {
    readonly x: number;
    readonly y: number;
    readonly z: number;
}

export interface ImmutableColor {
    readonly r: number;
    readonly g: number;
    readonly b: number;
    readonly a: number;
}

export interface CurveConfiguration {
    readonly mode: CurveMode;
    readonly constant: number;
    readonly constantMin: number;
    readonly constantMax: number;
    readonly curve?: Float32Array;
    readonly curveMin?: Float32Array;
    readonly curveMax?: Float32Array;
    readonly curveMultiplier: number;
}

export interface GradientConfiguration {
    readonly mode: GradientMode;
    readonly color: ImmutableColor;
    readonly colorMin: ImmutableColor;
    readonly colorMax: ImmutableColor;
    readonly gradient?: Float32Array;
    readonly gradientMin?: Float32Array;
    readonly gradientMax?: Float32Array;
    readonly gradientKeys?: ReadonlyArray<{
        readonly time: number;
        readonly color: ImmutableColor;
        readonly interpolation: 'linear' | 'step' | 'smoothstep';
    }>;
}

export interface BurstConfiguration {
    readonly time: number;
    readonly count: { readonly value: number; readonly variance: number };
    readonly cycles: number;
    readonly interval: number;
    readonly probability: number;
}

export interface ParticleSystemConfiguration {
    readonly maxParticles: number;
    readonly bounds: {
        readonly min: ImmutableVec3;
        readonly max: ImmutableVec3;
    };
    readonly cellSize: ImmutableVec3;
    readonly simulationSpace: SimulationSpace;
    readonly enableSpatialOptimization: boolean;
    readonly enableMultithreading: boolean;
    readonly preallocateMemory: boolean;
    readonly autoOptimizeMemory: boolean;
}

export interface ModuleConfiguration {
    readonly enabled: boolean;
    readonly priority: number;
    readonly dependencies?: readonly ModuleId[];
}

export interface EmissionConfiguration extends ModuleConfiguration {
    readonly rateOverTime: CurveConfiguration;
    readonly rateOverDistance: CurveConfiguration;
    readonly rateMultiplier: number;
    readonly bursts: readonly BurstConfiguration[];
    readonly prewarm: boolean;
    readonly prewarmTime: number;
    readonly duration: number;
    readonly startLifetime: CurveConfiguration;
    readonly startLifetimeMultiplier: number;
    readonly startSize: CurveConfiguration;
    readonly startSizeMultiplier: number;
    readonly startColor: GradientConfiguration;
}

export interface ShapeConfiguration extends ModuleConfiguration {
    readonly shape: EmitterShape;
    readonly radius: number;
    readonly radiusThickness: number;
    readonly angle: number;
    readonly length: number;
    readonly boxSize: ImmutableVec3;
    readonly position: ImmutableVec3;
    readonly rotation: ImmutableVec3;
    readonly scale: ImmutableVec3;
    readonly alignToDirection: boolean;
    readonly randomizeDirection: boolean;
    readonly spherizeDirection: boolean;
    readonly randomizePosition: boolean;
}

export interface VelocityConfiguration extends ModuleConfiguration {
    readonly linear: ImmutableVec3;
    readonly space: SimulationSpace;
    readonly orbital: ImmutableVec3;
    readonly radial: number;
    readonly speedModifier: CurveConfiguration;
    readonly gravityModifier: number;
    readonly velocityOverLifetime: CurveConfiguration;
    readonly inheritVelocity: number;
    readonly damping: CurveConfiguration;
}

export interface ForceConfiguration extends ModuleConfiguration {
    readonly forces: readonly {
        readonly type: 'gravity' | 'drag' | 'turbulence' | 'vortex' | 'custom';
        readonly strength: CurveConfiguration;
        readonly direction: ImmutableVec3;
        readonly position?: ImmutableVec3;
        readonly falloffRadius?: number;
    }[];
}

export interface ColorConfiguration extends ModuleConfiguration {
    readonly color: GradientConfiguration;
    readonly colorOverLifetime?: GradientConfiguration;
    readonly velocityInfluence: number;
    readonly ageInfluence: number;
    readonly sizeInfluence: number;
    readonly randomColorVariation: number;
}

export interface SizeConfiguration extends ModuleConfiguration {
    readonly size: CurveConfiguration;
    readonly sizeX: CurveConfiguration;
    readonly sizeY: CurveConfiguration;
    readonly sizeZ: CurveConfiguration;
    readonly separateAxes: boolean;
    
    readonly minSize: number;
    readonly maxSize: number;
    readonly speedInfluence: number;
    readonly sizeDamping: number;
    readonly sizeAcceleration: number;
    readonly randomVariation: number;
    readonly animationMode: 'constant' | 'overLifetime' | 'bySpeed' | 'byDistance' | 'custom';
    readonly inheritFromParent: boolean;
    readonly scaleWithDistance: boolean;
    readonly distanceScaleFactor: number;
}

export interface RotationConfiguration extends ModuleConfiguration {
    readonly angularVelocity: CurveConfiguration;
    readonly separateAxes: boolean;
    readonly angularVelocityX: CurveConfiguration;
    readonly angularVelocityY: CurveConfiguration;
    readonly angularVelocityZ: CurveConfiguration;

    readonly mode:
        | 'constant'
        | 'overLifetime'
        | 'bySpeed'
        | 'byPosition'
        | 'byVelocity'
        | 'orbital'
        | 'physics';
    readonly space: 'local' | 'world' | 'velocity' | 'custom';
    readonly inheritVelocity: boolean;
    readonly dampingFactor: number;
    readonly maxAngularVelocity: number;
    readonly enablePhysics: boolean;
    readonly momentOfInertia: number;
    readonly angularDrag: number;
}

export interface CollisionConfiguration extends ModuleConfiguration {
    readonly type: 'world' | 'planes' | 'sphere';
    readonly mode: 'ignore' | 'kill' | 'callback';
    readonly bounce: number;
    readonly dampen: number;
    readonly lifetimeLoss: number;
    readonly minKillSpeed: number;
    readonly maxKillSpeed: number;
    readonly radiusScale: number;
    readonly enableDynamicColliders: boolean;
    readonly collisionQuality: 'high' | 'medium' | 'low';

    readonly broadPhase: boolean;
    readonly gridCellSize: number;
    readonly autoOptimize: boolean;
    readonly continuousDetection: boolean;
    readonly maxContacts: number;

    readonly groundPlane?: {
        readonly enabled: boolean;
        readonly height: number;
        readonly bounce: number;
        readonly friction: number;
        readonly dampen: number;
    };

    readonly maxChecksPerFrame: number;
    readonly spatialOptimization: boolean;
}

export interface NoiseConfiguration extends ModuleConfiguration {
    readonly strength: CurveConfiguration;
    readonly frequency: number;
    readonly scrollSpeed: CurveConfiguration;
    readonly damping: boolean;
    readonly octaves: number;
    readonly octaveMultiplier: number;
    readonly octaveScale: number;
    readonly quality: 'high' | 'medium' | 'low';
    readonly positionAmount: ImmutableVec3;
    readonly rotationAmount: ImmutableVec3;
    readonly sizeAmount: ImmutableVec3;

    readonly noiseType: 'perlin' | 'simplex' | 'worley' | 'curl' | 'turbulence' | 'fractal';
    readonly amplitude: number;
    readonly persistence: number;
    readonly lacunarity: number;
    readonly seed: number;
    readonly animationSpeed: number;
    readonly additive: boolean;
    readonly remapRange: readonly [number, number];
    readonly spatialFrequency: ImmutableVec3;
    readonly temporalFrequency: number;
}

export interface TrailConfiguration extends ModuleConfiguration {
    readonly mode: 'particles' | 'ribbon';
    readonly ratio: number;
    readonly lifetime: CurveConfiguration;
    readonly minimumVertexDistance: number;
    readonly width: CurveConfiguration;
    readonly color: GradientConfiguration;
    readonly inheritParticleColor: boolean;
    readonly colorOverLifetime: GradientConfiguration;
    readonly worldSpace: boolean;
    readonly dieWithParticles: boolean;
    readonly sizeAffectsWidth: boolean;
    readonly sizeAffectsLifetime: boolean;
}

export interface LightsConfiguration extends ModuleConfiguration {
    readonly maxLights: number;
    readonly range: CurveConfiguration;
    readonly intensity: CurveConfiguration;
    readonly useParticleColors: boolean;
    readonly shadowCasting: boolean;
    readonly priority: number;
    readonly defaultLights: boolean;
    readonly animateLights: boolean;
    readonly affectParticleColor: boolean;
    readonly maxInfluencesPerParticle: number;
    readonly lightInfluenceMultiplier: number;
    readonly lightBlendFactor: number;
    readonly attenuationMode: LightAttenuationMode;
}

export interface CustomDataConfiguration extends ModuleConfiguration {
    readonly slot1: { readonly type: 'float' | 'vector2' | 'vector3' | 'vector4' | 'color' };
    readonly slot2: { readonly type: 'float' | 'vector2' | 'vector3' | 'vector4' | 'color' };
    readonly slot3: { readonly type: 'float' | 'vector2' | 'vector3' | 'vector4' | 'color' };
    readonly slot4: { readonly type: 'float' | 'vector2' | 'vector3' | 'vector4' | 'color' };
}

export interface TextureSheetConfiguration extends ModuleConfiguration {
    readonly tilesX: number;
    readonly tilesY: number;
    readonly animation: 'wholeSheet' | 'singleRow';
    readonly timeMode: 'lifetime' | 'speed' | 'fps';
    readonly fps: number;
    readonly startFrame: CurveConfiguration;
    readonly frameOverTime: CurveConfiguration;
    readonly cycleCount: number;
    readonly flipU: boolean;
    readonly flipV: boolean;
    readonly uvChannelMask: number;
}

export interface LimitVelocityConfiguration extends ModuleConfiguration {
    readonly separateAxes: boolean;
    readonly speed: CurveConfiguration;
    readonly speedX: CurveConfiguration;
    readonly speedY: CurveConfiguration;
    readonly speedZ: CurveConfiguration;
    readonly dampen: number;
    readonly drag: CurveConfiguration;
    readonly multiplyDragByParticleSize: boolean;
    readonly multiplyDragByParticleVelocity: boolean;
}

export type ModuleConfigurationMap = {
    readonly emission: EmissionConfiguration;
    readonly shape: ShapeConfiguration;
    readonly velocity: VelocityConfiguration;
    readonly force: ForceConfiguration;
    readonly color: ColorConfiguration;
    readonly size: SizeConfiguration;
    readonly rotation: RotationConfiguration;
    readonly collision: CollisionConfiguration;
    readonly noise: NoiseConfiguration;
    readonly trail: TrailConfiguration;
    readonly lights: LightsConfiguration;
    readonly custom: CustomDataConfiguration;
    readonly texture: TextureSheetConfiguration;
    readonly limitVelocity: LimitVelocityConfiguration;
};

export type ModuleType = keyof ModuleConfigurationMap;

export interface LightsConfiguration extends ModuleConfiguration {
    readonly intensity: CurveConfiguration;
    readonly range: CurveConfiguration;
    readonly ratio: number;
    readonly useParticleColors: boolean;
    readonly shadowCasting: boolean;
}

export interface LightsConfiguration extends ModuleConfiguration {
    readonly maxLights: number;
    readonly range: CurveConfiguration;
    readonly intensity: CurveConfiguration;
    readonly useParticleColors: boolean;
    readonly shadowCasting: boolean;
    readonly priority: number;
}

export interface CustomDataConfiguration extends ModuleConfiguration {
    readonly slot1: { readonly type: 'float' | 'vector2' | 'vector3' | 'vector4' | 'color' };
    readonly slot2: { readonly type: 'float' | 'vector2' | 'vector3' | 'vector4' | 'color' };
    readonly slot3: { readonly type: 'float' | 'vector2' | 'vector3' | 'vector4' | 'color' };
    readonly slot4: { readonly type: 'float' | 'vector2' | 'vector3' | 'vector4' | 'color' };
}

export interface TextureSheetConfiguration extends ModuleConfiguration {
    readonly tilesX: number;
    readonly tilesY: number;
    readonly animation: 'wholeSheet' | 'singleRow';
    readonly timeMode: 'lifetime' | 'speed' | 'fps';
    readonly fps: number;
    readonly startFrame: CurveConfiguration;
    readonly frameOverTime: CurveConfiguration;
    readonly cycleCount: number;
    readonly flipU: boolean;
    readonly flipV: boolean;
    readonly uvChannelMask: number;
}

export interface LimitVelocityConfiguration extends ModuleConfiguration {
    readonly separateAxes: boolean;
    readonly speed: CurveConfiguration;
    readonly speedX: CurveConfiguration;
    readonly speedY: CurveConfiguration;
    readonly speedZ: CurveConfiguration;
    readonly dampen: number;
    readonly drag: CurveConfiguration;
    readonly multiplyDragByParticleSize: boolean;
    readonly multiplyDragByParticleVelocity: boolean;
}
