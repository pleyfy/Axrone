import type { Vec3 } from '@axrone/numeric';

declare const __ParticleIdBrand: unique symbol;
declare const __SystemIdBrand: unique symbol;
declare const __EmitterIdBrand: unique symbol;
declare const __ModuleIdBrand: unique symbol;
declare const __TextureIdBrand: unique symbol;

export type ParticleId = number & { readonly [__ParticleIdBrand]: never };
export type SystemId = number & { readonly [__SystemIdBrand]: never };
export type EmitterId = number & { readonly [__EmitterIdBrand]: never };
export type ModuleId = number & { readonly [__ModuleIdBrand]: never };
export type TextureId = number & { readonly [__TextureIdBrand]: never };

export const enum EmitterShape {
    Point = 0,
    Sphere = 1,
    Hemisphere = 2,
    Cone = 3,
    Circle = 4,
    Box = 5,
    Rectangle = 6,
    Line = 7,
    Mesh = 8,
    Edge = 9,
    Donut = 10,
}

export const enum SimulationSpace {
    Local = 0,
    World = 1,
    Custom = 2,
}

export const enum SortMode {
    None = 0,
    Distance = 1,
    OldestFirst = 2,
    YoungestFirst = 3,
    Custom = 4,
}

export const enum RenderMode {
    Billboard = 0,
    Stretch = 1,
    HorizontalBillboard = 2,
    VerticalBillboard = 3,
    Mesh = 4,
    Trail = 5,
    Ribbon = 6,
}

export const enum StopAction {
    None = 0,
    Disable = 1,
    Destroy = 2,
    Callback = 3,
}

export const enum CullingMode {
    Automatic = 0,
    Pause = 1,
    PauseAndCatchup = 2,
    AlwaysSimulate = 3,
}

export const enum RingBufferMode {
    Disabled = 0,
    PauseUntilReplaced = 1,
    LoopUntilReplaced = 2,
}

export const enum CurveMode {
    Constant = 0,
    Curve = 1,
    TwoCurves = 2,
    TwoConstants = 3,
}

export const enum GradientMode {
    Color = 0,
    Gradient = 1,
    TwoColors = 2,
    TwoGradients = 3,
    RandomColor = 4,
}

export const enum ModuleFlags {
    StartLifetime = 1 << 0,
    StartSpeed = 1 << 1,
    StartSize = 1 << 2,
    StartRotation = 1 << 3,
    StartColor = 1 << 4,
    GravityModifier = 1 << 5,
    SimulationSpace = 1 << 6,
    SimulationSpeed = 1 << 7,
    ScalingMode = 1 << 8,
    PlayOnAwake = 1 << 9,
    MaxParticles = 1 << 10,
    All = (1 << 11) - 1,
}

export interface Curve {
    mode: CurveMode;
    constant: number;
    constantMin: number;
    constantMax: number;
    curve?: Float32Array;
    curveMin?: Float32Array;
    curveMax?: Float32Array;
    curveMultiplier: number;
}

export interface Gradient {
    mode: GradientMode;
    color: { r: number; g: number; b: number; a: number };
    colorMin: { r: number; g: number; b: number; a: number };
    colorMax: { r: number; g: number; b: number; a: number };
    gradient?: Float32Array;
    gradientMin?: Float32Array;
    gradientMax?: Float32Array;
}

export interface Burst {
    time: number;
    count: { value: number; variance: number };
    cycles: number;
    interval: number;
    probability: number;
}

export interface ParticleEvent {
    readonly type: string;
    readonly particleId: ParticleId;
    readonly systemId: SystemId;
    readonly timestamp: number;
    readonly position: { readonly x: number; readonly y: number; readonly z: number };
    readonly velocity: { readonly x: number; readonly y: number; readonly z: number };
}

export const enum LightingMode {
    None = 0,
    Simple = 1,
    Advanced = 2,
    Volumetric = 3,
}

export const enum LightAttenuationMode {
    Linear = 0,
    InverseSquare = 1,
    Exponential = 2,
    Smooth = 3,
}
