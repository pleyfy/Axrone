import { Component, Transform, script } from '@axrone/ecs-runtime';
import { clamp } from '@axrone/numeric';
import type { ParticleSystem as CoreParticleSystem } from '@axrone/particle-system';
import { createCoreParticleSystem, syncCoreRenderData, spawnToCoreBuffer } from './particle-system-bridge';
import { applyParticleSystemConfig, type ParticleSystemConfigHost } from './particle-system-config';
import { evaluateCurve, hexToRgb, rgbToHex } from './particle-system-utils';

/* ------------------------------------------------------------------ */
/* Public types                                                        */
/* ------------------------------------------------------------------ */

export type ParticleShapeType =
    | 'cone'
    | 'sphere'
    | 'hemisphere'
    | 'box'
    | 'circle'
    | 'edge'
    | 'donut';

export type ParticleSimulationSpace = 'local' | 'world';
export type ParticleRenderMode =
    | 'billboard'
    | 'stretched-billboard'
    | 'horizontal-billboard'
    | 'vertical-billboard'
    | 'mesh'
    | 'none';
export type ParticleBlendMode = 'additive' | 'alpha' | 'premultiplied' | 'multiply' | 'screen' | 'soft-additive';
export type ParticleSpriteMode = 'glow' | 'disc' | 'star' | 'spark';
export type ParticleStopAction = 'none' | 'disable' | 'destroy' | 'callback';
export type ParticleColorMode = 'color' | 'gradient' | 'random' | 'two-colors';

export interface ParticleBurst {
    readonly time: number;
    readonly count: number;
    readonly cycles?: number;
    readonly interval?: number;
    readonly probability?: number;
}

export interface ParticleSystemGradientStop {
    readonly position: number;
    readonly color: readonly [number, number, number, number];
}

/**
 * Flat, editor-aligned configuration surface for {@link ParticleSystem}.
 *
 * Property keys intentionally mirror the editor inspector / Rust whitelist
 * model (camelCase) so that values round-trip across all five layers without
 * remapping.
 */
export interface ParticleSystemConfig {
    /* Main */
    readonly duration?: number;
    readonly looping?: boolean;
    readonly prewarm?: boolean;
    readonly startDelay?: number;
    readonly startLifetime?: number;
    readonly startSpeed?: number;
    readonly startSize?: number;
    readonly startRotation?: number;
    readonly startColor?: string;
    readonly endColor?: string;
    readonly colorMode?: ParticleColorMode;
    readonly gravityModifier?: number;
    readonly simulationSpace?: ParticleSimulationSpace;
    readonly simulationSpeed?: number;
    readonly maxParticles?: number;
    readonly playOnLoad?: boolean;
    readonly stopAction?: ParticleStopAction;

    /* Emission */
    readonly emissionEnabled?: boolean;
    readonly rateOverTime?: number;
    readonly rateOverDistance?: number;
    readonly bursts?: readonly ParticleBurst[];

    /* Shape */
    readonly shapeEnabled?: boolean;
    readonly shapeType?: ParticleShapeType;
    readonly shapeRadius?: number;
    readonly shapeRadiusThickness?: number;
    readonly shapeAngle?: number;
    readonly shapeArc?: number;
    readonly shapeLength?: number;
    readonly shapeDonutRadius?: number;
    readonly emitFrom?: 'volume' | 'shell' | 'edge' | 'base';
    readonly randomDirectionAmount?: number;
    readonly spherizeDirection?: number;

    /* Velocity over lifetime */
    readonly velocityEnabled?: boolean;
    readonly velocityLinear?: readonly [number, number, number];
    readonly velocityOrbital?: readonly [number, number, number];
    readonly velocityRadial?: number;
    readonly velocitySpeedModifier?: number;

    /* Force over lifetime */
    readonly forceEnabled?: boolean;
    readonly force?: readonly [number, number, number];

    /* Limit velocity */
    readonly limitVelocityEnabled?: boolean;
    readonly speedLimit?: number;
    readonly limitDampen?: number;
    readonly drag?: number;

    /* Color over lifetime */
    readonly colorOverLifetimeEnabled?: boolean;

    /* Size over lifetime */
    readonly sizeOverLifetimeEnabled?: boolean;
    readonly sizeCurve?: readonly number[];

    /* Rotation over lifetime */
    readonly rotationOverLifetimeEnabled?: boolean;
    readonly angularVelocity?: number;

    /* Noise */
    readonly noiseEnabled?: boolean;
    readonly noiseStrength?: readonly [number, number, number];
    readonly noiseFrequency?: number;
    readonly noiseDamping?: boolean;

    /* Collision */
    readonly collisionEnabled?: boolean;
    readonly collisionBounce?: number;
    readonly collisionDampen?: number;
    readonly collisionLifetimeLoss?: number;
    readonly minKillSpeed?: number;

    /* Renderer */
    readonly renderMode?: ParticleRenderMode;
    readonly blendMode?: ParticleBlendMode;
    readonly spriteMode?: ParticleSpriteMode;
    readonly minParticleSize?: number;
    readonly maxParticleSize?: number;
    readonly sortingFudge?: number;

    /* Texture */
    readonly textureEnabled?: boolean;
    readonly textureSheetTilesX?: number;
    readonly textureSheetTilesY?: number;
    readonly textureSheetFps?: number;
    readonly textureSheetLoop?: boolean;
    readonly textureRegion?: readonly [number, number, number, number];

    /* Trail */
    readonly trailEnabled?: boolean;
    readonly trailMode?: 'particles' | 'ribbon';
    readonly trailLifetime?: number;
    readonly trailWidth?: number;
    readonly trailMinVertexDistance?: number;
    readonly trailRatio?: number;
    readonly trailDieWithParticles?: boolean;
    readonly trailInheritColor?: boolean;
    readonly trailSizeAffectsWidth?: boolean;

    /* Lights */
    readonly lightsEnabled?: boolean;
    readonly lightsMaxCount?: number;
    readonly lightsRange?: number;
    readonly lightsIntensity?: number;
    readonly lightsUseParticleColor?: boolean;
    readonly lightsShadowCasting?: boolean;

    /* Custom data */
    readonly customDataEnabled?: boolean;
}

/* ------------------------------------------------------------------ */
/* Defaults                                                            */
/* ------------------------------------------------------------------ */

export const DEFAULT_PARTICLE_START_COLOR = '#FFCF6B';
export const DEFAULT_PARTICLE_END_COLOR = '#FF3D00';

const DEFAULT_BURSTS: readonly ParticleBurst[] = Object.freeze([
    { time: 0.3, count: 60, cycles: 1, interval: 0.01, probability: 1 },
]);

const DEFAULT_SIZE_CURVE: readonly number[] = Object.freeze([0.35, 1, 0.75, 0.05]);

const MAX_PARTICLES_HARD_LIMIT = 4096;
const DEG_TO_RAD = Math.PI / 180;

/**
 * Snapshot of the live particle buffers, ready to be consumed by a renderer.
 * All arrays are tightly packed: only the first {@link ParticleRenderData.count}
 * entries are meaningful.
 */
export interface ParticleRenderData {
    readonly positions: Float32Array;
    readonly colors: Float32Array;
    readonly sizes: Float32Array;
    readonly alphas: Float32Array;
    readonly seeds: Float32Array;
    readonly rotations: Float32Array;
    readonly count: number;
    readonly aliveCount: number;
}

/* ------------------------------------------------------------------ */
/* Component                                                           */
/* ------------------------------------------------------------------ */

/**
 * ParticleSystem emits and simulates a CPU particle cloud.
 *
 * The component owns a fixed-capacity pool of particles and advances them
 * every frame through the full module pipeline (emission → shape → forces →
 * integration → color/size/rotation over lifetime → collision). The resulting
 * buffers are exposed through {@link ParticleSystem.getRenderData} so that any
 * renderer (point sprites, billboards, trails) can draw them.
 *
 * @example
 * ```ts
 * const particles = new ParticleSystem({
 *     rateOverTime: 120,
 *     startSpeed: 3.2,
 *     shapeType: 'cone',
 * });
 * entity.addComponent(ParticleSystem, particles);
 * particles.play();
 * ```
 */
@script({
    scriptName: 'ParticleSystem',
    priority: 200,
    executeInEditMode: false,
    singleton: false,
})
export class ParticleSystem extends Component {
    /* Main */
    private _duration: number;
    private _looping: boolean;
    private _prewarm: boolean;
    private _startDelay: number;
    private _startLifetime: number;
    private _startSpeed: number;
    private _startSize: number;
    private _startRotation: number;
    private _startColorRgb: [number, number, number];
    private _endColorRgb: [number, number, number];
    private _colorMode: ParticleColorMode;
    private _gravityModifier: number;
    private _simulationSpace: ParticleSimulationSpace;
    private _simulationSpeed: number;
    private _maxParticles: number;
    private _playOnLoad: boolean;
    private _stopAction: ParticleStopAction;

    /* Emission */
    private _emissionEnabled: boolean;
    private _rateOverTime: number;
    private _rateOverDistance: number;
    private _bursts: ParticleBurst[];

    /* Shape */
    private _shapeEnabled: boolean;
    private _shapeType: ParticleShapeType;
    private _shapeRadius: number;
    private _shapeRadiusThickness: number;
    private _shapeAngle: number;
    private _shapeArc: number;
    private _shapeLength: number;
    private _shapeDonutRadius: number;
    private _emitFrom: 'volume' | 'shell' | 'edge' | 'base';
    private _randomDirectionAmount: number;
    private _spherizeDirection: number;

    /* Velocity over lifetime */
    private _velocityEnabled: boolean;
    private _velocityLinear: [number, number, number];
    private _velocityOrbital: [number, number, number];
    private _velocityRadial: number;
    private _velocitySpeedModifier: number;

    /* Force over lifetime */
    private _forceEnabled: boolean;
    private _force: [number, number, number];

    /* Limit velocity */
    private _limitVelocityEnabled: boolean;
    private _speedLimit: number;
    private _limitDampen: number;
    private _drag: number;

    /* Color over lifetime */
    private _colorOverLifetimeEnabled: boolean;

    /* Size over lifetime */
    private _sizeOverLifetimeEnabled: boolean;
    private _sizeCurve: number[];

    /* Rotation over lifetime */
    private _rotationOverLifetimeEnabled: boolean;
    private _angularVelocity: number;

    /* Noise */
    private _noiseEnabled: boolean;
    private _noiseStrength: [number, number, number];
    private _noiseFrequency: number;
    private _noiseDamping: boolean;

    /* Collision */
    private _collisionEnabled: boolean;
    private _collisionBounce: number;
    private _collisionDampen: number;
    private _collisionLifetimeLoss: number;
    private _minKillSpeed: number;

    /* Renderer */
    private _renderMode: ParticleRenderMode;
    private _blendMode: ParticleBlendMode;
    private _spriteMode: ParticleSpriteMode;
    private _minParticleSize: number;
    private _maxParticleSize: number;
    private _sortingFudge: number;

    /* Texture */
    private _textureEnabled: boolean;
    private _particleTexture: WebGLTexture | null = null;
    private _textureSheetTilesX: number;
    private _textureSheetTilesY: number;
    private _textureSheetFps: number;
    private _textureSheetLoop: boolean;
    private _textureRegion: [number, number, number, number];
    private _textureFrameIndex: number = 0;
    private _textureFrameAccum: number = 0;

    /* Trail */
    private _trailEnabled: boolean;
    private _trailMode: 'particles' | 'ribbon';
    private _trailLifetime: number;
    private _trailWidth: number;
    private _trailMinVertexDistance: number;
    private _trailRatio: number;
    private _trailDieWithParticles: boolean;
    private _trailInheritColor: boolean;
    private _trailSizeAffectsWidth: boolean;

    /* Lights */
    private _lightsEnabled: boolean;
    private _lightsMaxCount: number;
    private _lightsRange: number;
    private _lightsIntensity: number;
    private _lightsUseParticleColor: boolean;
    private _lightsShadowCasting: boolean;

    /* Custom data */
    private _customDataEnabled: boolean;

    /* Particle pool (structure-of-arrays for cache friendly simulation). */
    private readonly _positions: Float32Array;
    private readonly _velocities: Float32Array;
    private readonly _ages: Float32Array;
    private readonly _lifetimes: Float32Array;
    private readonly _seeds: Float32Array;
    private readonly _sizeMultipliers: Float32Array;
    private readonly _rotations: Float32Array;

    /* Render output buffers. */
    private readonly _renderColors: Float32Array;
    private readonly _renderSizes: Float32Array;
    private readonly _renderAlphas: Float32Array;

    /* Simulation state. */
    private _playing: boolean;
    private _elapsed: number;
    private _loopTime: number;
    private _spawnAccumulator: number;
    private _spawnCursor: number;
    private _aliveCount: number;
    private _burstFired: boolean[];
    private _delayRemaining: number;

    private _coreSystem: CoreParticleSystem | null = null;
    private _useCoreSimulation: boolean = true;

    constructor(config: ParticleSystemConfig = {}) {
        super();

        /* Main */
        this._duration = 5;
        this._looping = true;
        this._prewarm = false;
        this._startDelay = 0;
        this._startLifetime = 2.3;
        this._startSpeed = 3.2;
        this._startSize = 0.55;
        this._startRotation = 0;
        this._startColorRgb = hexToRgb(DEFAULT_PARTICLE_START_COLOR);
        this._endColorRgb = hexToRgb(DEFAULT_PARTICLE_END_COLOR);
        this._colorMode = 'gradient';
        this._gravityModifier = 1.5;
        this._simulationSpace = 'world';
        this._simulationSpeed = 1;
        this._maxParticles = 700;
        this._playOnLoad = true;
        this._stopAction = 'disable';

        /* Emission */
        this._emissionEnabled = true;
        this._rateOverTime = 120;
        this._rateOverDistance = 0;
        this._bursts = DEFAULT_BURSTS.map((burst) => ({ ...burst }));

        /* Shape */
        this._shapeEnabled = true;
        this._shapeType = 'cone';
        this._shapeRadius = 0.3;
        this._shapeRadiusThickness = 1;
        this._shapeAngle = 20;
        this._shapeArc = 360;
        this._shapeLength = 5;
        this._shapeDonutRadius = 0.2;
        this._emitFrom = 'volume';
        this._randomDirectionAmount = 0;
        this._spherizeDirection = 0;

        /* Velocity over lifetime */
        this._velocityEnabled = false;
        this._velocityLinear = [0, 0, 0];
        this._velocityOrbital = [0, 0, 0];
        this._velocityRadial = 0;
        this._velocitySpeedModifier = 1;

        /* Force over lifetime */
        this._forceEnabled = false;
        this._force = [0, 0, 0];

        /* Limit velocity */
        this._limitVelocityEnabled = false;
        this._speedLimit = 1;
        this._limitDampen = 0.5;
        this._drag = 0;

        /* Color over lifetime */
        this._colorOverLifetimeEnabled = true;

        /* Size over lifetime */
        this._sizeOverLifetimeEnabled = true;
        this._sizeCurve = [...DEFAULT_SIZE_CURVE];

        /* Rotation over lifetime */
        this._rotationOverLifetimeEnabled = false;
        this._angularVelocity = 45;

        /* Noise */
        this._noiseEnabled = true;
        this._noiseStrength = [1.7, 1.7, 1.7];
        this._noiseFrequency = 1.1;
        this._noiseDamping = true;

        /* Collision */
        this._collisionEnabled = false;
        this._collisionBounce = 0.55;
        this._collisionDampen = 0.5;
        this._collisionLifetimeLoss = 0;
        this._minKillSpeed = 0;

        /* Renderer */
        this._renderMode = 'billboard';
        this._blendMode = 'additive';
        this._spriteMode = 'glow';
        this._minParticleSize = 0;
        this._maxParticleSize = 0.5;
        this._sortingFudge = 0;

        /* Texture */
        this._textureEnabled = false;
        this._textureSheetTilesX = 1;
        this._textureSheetTilesY = 1;
        this._textureSheetFps = 30;
        this._textureSheetLoop = true;
        this._textureRegion = [0, 0, 1, 1];

        /* Trail */
        this._trailEnabled = false;
        this._trailMode = 'particles';
        this._trailLifetime = 2;
        this._trailWidth = 0.5;
        this._trailMinVertexDistance = 0.1;
        this._trailRatio = 1;
        this._trailDieWithParticles = true;
        this._trailInheritColor = true;
        this._trailSizeAffectsWidth = false;

        /* Lights */
        this._lightsEnabled = false;
        this._lightsMaxCount = 8;
        this._lightsRange = 10;
        this._lightsIntensity = 1.5;
        this._lightsUseParticleColor = true;
        this._lightsShadowCasting = false;

        /* Custom data */
        this._customDataEnabled = false;

        /* Allocate pool at the hard limit so maxParticles can change freely. */
        this._positions = new Float32Array(MAX_PARTICLES_HARD_LIMIT * 3);
        this._velocities = new Float32Array(MAX_PARTICLES_HARD_LIMIT * 3);
        this._ages = new Float32Array(MAX_PARTICLES_HARD_LIMIT).fill(Number.POSITIVE_INFINITY);
        this._lifetimes = new Float32Array(MAX_PARTICLES_HARD_LIMIT).fill(1);
        this._seeds = new Float32Array(MAX_PARTICLES_HARD_LIMIT);
        this._sizeMultipliers = new Float32Array(MAX_PARTICLES_HARD_LIMIT);
        this._rotations = new Float32Array(MAX_PARTICLES_HARD_LIMIT);
        this._renderColors = new Float32Array(MAX_PARTICLES_HARD_LIMIT * 3);
        this._renderSizes = new Float32Array(MAX_PARTICLES_HARD_LIMIT);
        this._renderAlphas = new Float32Array(MAX_PARTICLES_HARD_LIMIT);

        this._playing = false;
        this._elapsed = 0;
        this._loopTime = 0;
        this._spawnAccumulator = 0;
        this._spawnCursor = 0;
        this._aliveCount = 0;
        this._burstFired = this._bursts.map(() => false);
        this._delayRemaining = 0;

        this._applyConfig(config);

        this._initCoreSystem();

        if (this._prewarm && this._coreSystem) {
            const step = 1 / 30;
            for (let i = 0; i < 110; i++) {
                this._updateCoreSimulation(step);
            }
        }

        if (this._playOnLoad) {
            this._playing = true;
            this._delayRemaining = this._startDelay;
        }
    }

    /* ------------------------------------------------------------------ */
    /* Main accessors                                                      */
    /* ------------------------------------------------------------------ */

    get duration(): number {
        return this._duration;
    }

    set duration(value: number) {
        this._duration = Math.max(0.1, value);
    }

    get looping(): boolean {
        return this._looping;
    }

    set looping(value: boolean) {
        this._looping = value;
    }

    get prewarm(): boolean {
        return this._prewarm;
    }

    set prewarm(value: boolean) {
        this._prewarm = value;
        if (value) {
            this._prewarmSimulation();
        }
    }

    get startDelay(): number {
        return this._startDelay;
    }

    set startDelay(value: number) {
        this._startDelay = Math.max(0, value);
    }

    get startLifetime(): number {
        return this._startLifetime;
    }

    set startLifetime(value: number) {
        this._startLifetime = Math.max(0.05, value);
    }

    get startSpeed(): number {
        return this._startSpeed;
    }

    set startSpeed(value: number) {
        this._startSpeed = value;
    }

    get startSize(): number {
        return this._startSize;
    }

    set startSize(value: number) {
        this._startSize = Math.max(0.001, value);
    }

    get startRotation(): number {
        return this._startRotation;
    }

    set startRotation(value: number) {
        this._startRotation = value;
    }

    get startColor(): string {
        return rgbToHex(this._startColorRgb);
    }

    set startColor(value: string) {
        this._startColorRgb = hexToRgb(value);
    }

    get endColor(): string {
        return rgbToHex(this._endColorRgb);
    }

    set endColor(value: string) {
        this._endColorRgb = hexToRgb(value);
    }

    get colorMode(): ParticleColorMode {
        return this._colorMode;
    }

    set colorMode(value: ParticleColorMode) {
        this._colorMode = value;
    }

    get gravityModifier(): number {
        return this._gravityModifier;
    }

    set gravityModifier(value: number) {
        this._gravityModifier = value;
    }

    get simulationSpace(): ParticleSimulationSpace {
        return this._simulationSpace;
    }

    set simulationSpace(value: ParticleSimulationSpace) {
        this._simulationSpace = value;
    }

    get simulationSpeed(): number {
        return this._simulationSpeed;
    }

    set simulationSpeed(value: number) {
        this._simulationSpeed = Math.max(0, value);
    }

    get maxParticles(): number {
        return this._maxParticles;
    }

    set maxParticles(value: number) {
        this._maxParticles = clamp(Math.floor(value), 1, MAX_PARTICLES_HARD_LIMIT);
    }

    get playOnLoad(): boolean {
        return this._playOnLoad;
    }

    set playOnLoad(value: boolean) {
        this._playOnLoad = value;
    }

    get stopAction(): ParticleStopAction {
        return this._stopAction;
    }

    set stopAction(value: ParticleStopAction) {
        this._stopAction = value;
    }

    /* ------------------------------------------------------------------ */
    /* Emission accessors                                                  */
    /* ------------------------------------------------------------------ */

    get emissionEnabled(): boolean {
        return this._emissionEnabled;
    }

    set emissionEnabled(value: boolean) {
        this._emissionEnabled = value;
    }

    get rateOverTime(): number {
        return this._rateOverTime;
    }

    set rateOverTime(value: number) {
        this._rateOverTime = Math.max(0, value);
    }

    get rateOverDistance(): number {
        return this._rateOverDistance;
    }

    set rateOverDistance(value: number) {
        this._rateOverDistance = Math.max(0, value);
    }

    get bursts(): readonly ParticleBurst[] {
        return this._bursts;
    }

    set bursts(value: readonly ParticleBurst[]) {
        this._bursts = value.map((burst) => ({ ...burst }));
        this._burstFired = this._bursts.map(() => false);
    }

    /* ------------------------------------------------------------------ */
    /* Shape accessors                                                     */
    /* ------------------------------------------------------------------ */

    get shapeEnabled(): boolean {
        return this._shapeEnabled;
    }

    set shapeEnabled(value: boolean) {
        this._shapeEnabled = value;
    }

    get shapeType(): ParticleShapeType {
        return this._shapeType;
    }

    set shapeType(value: ParticleShapeType) {
        this._shapeType = value;
    }

    get shapeRadius(): number {
        return this._shapeRadius;
    }

    set shapeRadius(value: number) {
        this._shapeRadius = Math.max(0.01, value);
    }

    get shapeAngle(): number {
        return this._shapeAngle;
    }

    set shapeAngle(value: number) {
        this._shapeAngle = clamp(value, 0, 90);
    }

    get shapeArc(): number {
        return this._shapeArc;
    }

    set shapeArc(value: number) {
        this._shapeArc = clamp(value, 0, 360);
    }

    /* ------------------------------------------------------------------ */
    /* Module toggles                                                      */
    /* ------------------------------------------------------------------ */

    get velocityEnabled(): boolean {
        return this._velocityEnabled;
    }

    set velocityEnabled(value: boolean) {
        this._velocityEnabled = value;
    }

    get forceEnabled(): boolean {
        return this._forceEnabled;
    }

    set forceEnabled(value: boolean) {
        this._forceEnabled = value;
    }

    get limitVelocityEnabled(): boolean {
        return this._limitVelocityEnabled;
    }

    set limitVelocityEnabled(value: boolean) {
        this._limitVelocityEnabled = value;
    }

    get colorOverLifetimeEnabled(): boolean {
        return this._colorOverLifetimeEnabled;
    }

    set colorOverLifetimeEnabled(value: boolean) {
        this._colorOverLifetimeEnabled = value;
    }

    get sizeOverLifetimeEnabled(): boolean {
        return this._sizeOverLifetimeEnabled;
    }

    set sizeOverLifetimeEnabled(value: boolean) {
        this._sizeOverLifetimeEnabled = value;
    }

    get sizeCurve(): readonly number[] {
        return this._sizeCurve;
    }

    set sizeCurve(value: readonly number[]) {
        this._sizeCurve = [...value];
    }

    get rotationOverLifetimeEnabled(): boolean {
        return this._rotationOverLifetimeEnabled;
    }

    set rotationOverLifetimeEnabled(value: boolean) {
        this._rotationOverLifetimeEnabled = value;
    }

    get noiseEnabled(): boolean {
        return this._noiseEnabled;
    }

    set noiseEnabled(value: boolean) {
        this._noiseEnabled = value;
    }

    get noiseStrength(): readonly [number, number, number] {
        return this._noiseStrength;
    }

    set noiseStrength(value: readonly [number, number, number]) {
        this._noiseStrength = [value[0], value[1], value[2]];
    }

    get noiseFrequency(): number {
        return this._noiseFrequency;
    }

    set noiseFrequency(value: number) {
        this._noiseFrequency = Math.max(0, value);
    }

    get collisionEnabled(): boolean {
        return this._collisionEnabled;
    }

    set collisionEnabled(value: boolean) {
        this._collisionEnabled = value;
    }

    get collisionBounce(): number {
        return this._collisionBounce;
    }

    set collisionBounce(value: number) {
        this._collisionBounce = clamp(value, 0, 2);
    }

    get collisionDampen(): number {
        return this._collisionDampen;
    }

    set collisionDampen(value: number) {
        this._collisionDampen = clamp(value, 0, 1);
    }

    /* ------------------------------------------------------------------ */
    /* Renderer accessors                                                  */
    /* ------------------------------------------------------------------ */

    get renderMode(): ParticleRenderMode {
        return this._renderMode;
    }

    set renderMode(value: ParticleRenderMode) {
        this._renderMode = value;
    }

    get blendMode(): ParticleBlendMode {
        return this._blendMode;
    }

    set blendMode(value: ParticleBlendMode) {
        this._blendMode = value;
    }

    get spriteMode(): ParticleSpriteMode {
        return this._spriteMode;
    }

    set spriteMode(value: ParticleSpriteMode) {
        this._spriteMode = value;
    }

    get textureEnabled(): boolean {
        return this._textureEnabled;
    }

    set textureEnabled(value: boolean) {
        this._textureEnabled = value;
    }

    get particleTexture(): WebGLTexture | null {
        return this._textureEnabled ? this._particleTexture : null;
    }

    set particleTexture(texture: WebGLTexture | null) {
        this._particleTexture = texture;
    }

    get textureSheetParams(): [number, number, number, number] | null {
        if (!this._textureEnabled || !this._particleTexture) return null;
        const totalFrames = this._textureSheetTilesX * this._textureSheetTilesY;
        if (totalFrames <= 1) return null;
        return [
            this._textureSheetTilesX,
            this._textureSheetTilesY,
            this._textureFrameIndex,
            totalFrames,
        ];
    }

    get textureRegion(): [number, number, number, number] {
        return this._textureRegion;
    }

    set textureRegion(region: [number, number, number, number]) {
        this._textureRegion = region;
    }

    /** Advance the flipbook frame based on elapsed time. */
    advanceTextureFrame(dt: number): void {
        if (!this._textureEnabled || !this._particleTexture) return;
        const totalFrames = this._textureSheetTilesX * this._textureSheetTilesY;
        if (totalFrames <= 1) return;

        this._textureFrameAccum += dt * this._textureSheetFps;
        if (this._textureFrameAccum >= 1) {
            const advance = Math.floor(this._textureFrameAccum);
            this._textureFrameAccum -= advance;
            this._textureFrameIndex += advance;

            if (this._textureFrameIndex >= totalFrames) {
                if (this._textureSheetLoop) {
                    this._textureFrameIndex %= totalFrames;
                } else {
                    this._textureFrameIndex = totalFrames - 1;
                }
            }
        }
    }

    /* ------------------------------------------------------------------ */
    /* Playback / status API                                               */
    /* ------------------------------------------------------------------ */

    get isPlaying(): boolean {
        return this._playing;
    }

    get aliveCount(): number {
        return this._aliveCount;
    }

    get elapsed(): number {
        return this._elapsed;
    }

    get useCoreSimulation(): boolean {
        return this._useCoreSimulation;
    }

    set useCoreSimulation(value: boolean) {
        if (this._useCoreSimulation === value) {
            return;
        }
        this._useCoreSimulation = value;
        if (value && !this._coreSystem) {
            this._initCoreSystem();
        }
        if (this._coreSystem) {
            if (value && this._playing) {
                this._coreSystem.play();
            } else if (!value) {
                this._coreSystem.stop();
            }
        }
    }

    get coreSystem(): CoreParticleSystem | null {
        return this._coreSystem;
    }

    play(): void {
        this._playing = true;
        this._delayRemaining = this._startDelay;
        this._coreSystem?.play();
    }

    pause(): void {
        this._playing = false;
        this._coreSystem?.pause();
    }

    stop(): void {
        this._playing = false;
        this._coreSystem?.stop();
        this.clear();
    }

    /** Kills every live particle and resets the simulation clock. */
    clear(): void {
        this._ages.fill(Number.POSITIVE_INFINITY);
        this._renderAlphas.fill(0);
        this._elapsed = 0;
        this._loopTime = 0;
        this._spawnAccumulator = 0;
        this._aliveCount = 0;
        this._burstFired = this._bursts.map(() => false);
        this._coreSystem?.reset();
    }

    override onDestroy(): void {
        if (this._coreSystem) {
            this._coreSystem.destroy();
            this._coreSystem = null;
        }
    }

    private _handleSystemStopped(): void {
        if (!this._playing) {
            return;
        }
        this._playing = false;
        switch (this._stopAction) {
            case 'disable':
                this.enabled = false;
                break;
            case 'destroy':
                this.entity?.destroy();
                break;
            case 'callback':
                (
                    this.world as
                        | {
                              emitSync?: (event: string, data: Record<string, unknown>) => boolean;
                          }
                        | undefined
                )?.emitSync?.('particle:stopped', {
                    entityUid: this.entity?.id,
                    entity: this.entity,
                });
                break;
            default:
                break;
        }
    }

    /** Immediately emits `count` particles, bypassing the rate limiter. */
    emitBurst(count: number): void {
        const total = Math.max(0, Math.floor(count));
        for (let i = 0; i < total; i++) {
            const slot = this._findFreeSlot();
            if (slot < 0) {
                break;
            }
            this._spawnParticle(slot);
            if (this._useCoreSimulation && this._coreSystem) {
                const i3 = slot * 3;
                const r = this._startColorRgb[0], g = this._startColorRgb[1], b = this._startColorRgb[2];
                spawnToCoreBuffer(
                    this._coreSystem,
                    { x: this._positions[i3], y: this._positions[i3 + 1], z: this._positions[i3 + 2] },
                    { x: this._velocities[i3], y: this._velocities[i3 + 1], z: this._velocities[i3 + 2] },
                    this._lifetimes[slot],
                    this._startSize * (this._sizeMultipliers[slot] || 1),
                    r, g, b, 1,
                );
            }
        }
    }

    /**
     * Returns the tightly-packed render buffers. Only the first
     * `count` entries of each array are valid.
     */
    getRenderData(): ParticleRenderData {
        return {
            positions: this._positions,
            colors: this._renderColors,
            sizes: this._renderSizes,
            alphas: this._renderAlphas,
            seeds: this._seeds,
            rotations: this._rotations,
            count: this._maxParticles,
            aliveCount: this._aliveCount,
        };
    }

    /* ------------------------------------------------------------------ */
    /* Simulation                                                          */
    /* ------------------------------------------------------------------ */

    override update(deltaTime: number): void {
        if (!this._playing) {
            return;
        }

        const dt = Math.min(deltaTime, 0.05) * this._simulationSpeed;
        if (dt <= 0) {
            return;
        }

        if (this._delayRemaining > 0) {
            this._delayRemaining -= dt;
            if (this._delayRemaining > 0) {
                return;
            }
        }

        if (this._useCoreSimulation && this._coreSystem) {
            this._updateCoreSimulation(dt);
            return;
        }

        const canSimulate = this._looping || this._loopTime < this._duration;
        if (canSimulate) {
            this._loopTime += dt;
            this._elapsed += dt;

            if (this._looping && this._loopTime >= this._duration) {
                this._loopTime %= this._duration;
                this._burstFired = this._burstFired.map(() => false);
            }

            this._emitOverTime(dt);
            this._emitBursts();
        }

        this._integrate(dt);
        this.advanceTextureFrame(dt);

        if (!this._looping && this._loopTime >= this._duration && this._aliveCount <= 0) {
            this._handleSystemStopped();
        }
    }

    private _emitOverTime(dt: number): void {
        if (!this._emissionEnabled) {
            return;
        }
        this._spawnAccumulator += this._rateOverTime * dt;
        let toSpawn = Math.floor(this._spawnAccumulator);
        this._spawnAccumulator -= toSpawn;
        while (toSpawn-- > 0) {
            const slot = this._findFreeSlot();
            if (slot < 0) {
                break;
            }
            this._spawnParticle(slot);
        }
    }

    private _emitBursts(): void {
        if (!this._emissionEnabled) {
            return;
        }
        for (let i = 0; i < this._bursts.length; i++) {
            if (this._burstFired[i]) {
                continue;
            }
            const burst = this._bursts[i];
            if (!burst) {
                continue;
            }
            if (this._loopTime >= burst.time) {
                this._burstFired[i] = true;
                const probability = burst.probability ?? 1;
                if (Math.random() <= probability) {
                    const cycles = Math.max(1, burst.cycles ?? 1);
                    this.emitBurst(burst.count * cycles);
                }
            }
        }
    }

    private _findFreeSlot(): number {
        for (let k = 0; k < this._maxParticles; k++) {
            const index = (this._spawnCursor + k) % this._maxParticles;
            if (this._ages[index]! >= this._lifetimes[index]!) {
                this._spawnCursor = index + 1;
                return index;
            }
        }
        return -1;
    }

    private _spawnParticle(index: number): void {
        const i3 = index * 3;
        const random = Math.random;

        let px = 0;
        let py = 0;
        let pz = 0;
        let dx = 0;
        let dy = 1;
        let dz = 0;

        const radius = Math.max(0.02, this._shapeRadius);

        if (!this._shapeEnabled) {
            dx = random() * 2 - 1;
            dy = random() * 2 - 1;
            dz = random() * 2 - 1;
            const inv = 1 / (Math.hypot(dx, dy, dz) || 1);
            dx *= inv;
            dy *= inv;
            dz *= inv;
        } else {
            switch (this._shapeType) {
                case 'cone':
                case 'hemisphere': {
                    const rr =
                        this._emitFrom === 'shell'
                            ? radius
                            : radius * Math.sqrt(random()) * this._shapeRadiusThickness;
                    const arcAngle = random() * this._shapeArc * DEG_TO_RAD;
                    px = Math.cos(arcAngle) * rr;
                    pz = Math.sin(arcAngle) * rr;
                    const theta = random() * this._shapeAngle * DEG_TO_RAD;
                    const phi = random() * Math.PI * 2;
                    dx = Math.sin(theta) * Math.cos(phi);
                    dy = Math.cos(theta);
                    dz = Math.sin(theta) * Math.sin(phi);
                    break;
                }
                case 'sphere': {
                    const u = random() * 2 - 1;
                    const phi = random() * Math.PI * 2;
                    const sq = Math.sqrt(1 - u * u);
                    dx = sq * Math.cos(phi);
                    dy = u;
                    dz = sq * Math.sin(phi);
                    const rr = this._emitFrom === 'shell' ? radius : radius * Math.cbrt(random());
                    px = dx * rr;
                    py = dy * rr;
                    pz = dz * rr;
                    break;
                }
                case 'box': {
                    px = (random() * 2 - 1) * radius;
                    py = (random() * 2 - 1) * radius * 0.6;
                    pz = (random() * 2 - 1) * radius;
                    break;
                }
                case 'donut': {
                    const arcAngle = random() * this._shapeArc * DEG_TO_RAD;
                    const tubeAngle = random() * Math.PI * 2;
                    const ringRadius = radius + Math.cos(tubeAngle) * this._shapeDonutRadius;
                    px = Math.cos(arcAngle) * ringRadius;
                    pz = Math.sin(arcAngle) * ringRadius;
                    py = Math.sin(tubeAngle) * this._shapeDonutRadius;
                    dy = 1;
                    dx = Math.cos(arcAngle) * 0.2;
                    dz = Math.sin(arcAngle) * 0.2;
                    break;
                }
                default: {
                    /* circle / edge */
                    const arcAngle = random() * this._shapeArc * DEG_TO_RAD;
                    px = Math.cos(arcAngle) * radius;
                    pz = Math.sin(arcAngle) * radius;
                    dx = Math.cos(arcAngle) * 0.35;
                    dz = Math.sin(arcAngle) * 0.35;
                    dy = 0.94;
                    const inv = 1 / Math.hypot(dx, dy, dz);
                    dx *= inv;
                    dy *= inv;
                    dz *= inv;
                    break;
                }
            }
        }

        /* Random direction blending. */
        if (this._randomDirectionAmount > 0) {
            const rx = random() * 2 - 1;
            const ry = random() * 2 - 1;
            const rz = random() * 2 - 1;
            const amount = this._randomDirectionAmount;
            dx = dx * (1 - amount) + rx * amount;
            dy = dy * (1 - amount) + ry * amount;
            dz = dz * (1 - amount) + rz * amount;
            const inv = 1 / (Math.hypot(dx, dy, dz) || 1);
            dx *= inv;
            dy *= inv;
            dz *= inv;
        }

        if (this._simulationSpace === 'world') {
            const transform = this.transform as Transform | undefined;
            if (transform) {
                const world = transform.worldPosition;
                px += world.x;
                py += world.y;
                pz += world.z;
            }
        }

        this._positions[i3] = px;
        this._positions[i3 + 1] = py;
        this._positions[i3 + 2] = pz;

        const speed = this._startSpeed * (1 + (random() - 0.5) * 0.7);
        this._velocities[i3] = dx * speed;
        this._velocities[i3 + 1] = dy * speed;
        this._velocities[i3 + 2] = dz * speed;

        this._ages[index] = 0;
        this._lifetimes[index] = Math.max(0.15, this._startLifetime * (1 + (random() - 0.5) * 0.8));
        this._seeds[index] = random() * 10;
        this._sizeMultipliers[index] = 0.75 + random() * 0.5;
        this._rotations[index] = this._startRotation * DEG_TO_RAD + (random() - 0.5) * 0.5;
    }

    private _integrate(dt: number): void {
        const gravity = this._gravityModifier;
        const noiseOn = this._noiseEnabled;
        const noiseX = this._noiseStrength[0];
        const noiseY = this._noiseStrength[1];
        const noiseZ = this._noiseStrength[2];
        const noiseFreq = this._noiseFrequency;
        const time = this._elapsed;
        const baseSize = this._startSize;

        const velOn = this._velocityEnabled;
        const velX = velOn ? this._velocityLinear[0] : 0;
        const velY = velOn ? this._velocityLinear[1] : 0;
        const velZ = velOn ? this._velocityLinear[2] : 0;

        const forceOn = this._forceEnabled;
        const forceX = forceOn ? this._force[0] : 0;
        const forceY = forceOn ? this._force[1] : 0;
        const forceZ = forceOn ? this._force[2] : 0;

        const colorOn = this._colorOverLifetimeEnabled;
        const [ar, ag, ab] = this._startColorRgb;
        const [br, bg, bb] = this._endColorRgb;

        let alive = 0;

        for (let i = 0; i < this._maxParticles; i++) {
            if (this._ages[i]! >= this._lifetimes[i]!) {
                this._renderAlphas[i] = 0;
                continue;
            }

            this._ages[i]! += dt;
            if (this._ages[i]! >= this._lifetimes[i]!) {
                this._renderAlphas[i] = 0;
                continue;
            }

            alive++;
            const i3 = i * 3;

            /* Accumulate accelerations. */
            this._velocities[i3]! += (velX + forceX) * dt;
            this._velocities[i3 + 1]! += (gravity + velY + forceY) * dt;
            this._velocities[i3 + 2]! += (velZ + forceZ) * dt;

            /* Curl-like procedural noise turbulence. */
            if (noiseOn) {
                const seed = this._seeds[i]!;
                const px = this._positions[i3]!;
                const py = this._positions[i3 + 1]!;
                const pz = this._positions[i3 + 2]!;
                this._velocities[i3]! += Math.sin(py * noiseFreq * 2.1 + time * 2.6 + seed) * noiseX * dt;
                this._velocities[i3 + 2]! +=
                    Math.cos(px * noiseFreq * 2.3 + time * 2.2 + seed * 1.7) * noiseZ * dt;
                this._velocities[i3 + 1]! +=
                    Math.sin(px * noiseFreq * 1.7 + pz * noiseFreq * 1.9 + time * 1.8 + seed) *
                    noiseY *
                    0.6 *
                    dt;
            }

            /* Drag. */
            if (this._drag > 0) {
                const damp = Math.max(0, 1 - this._drag * dt);
                this._velocities[i3]! *= damp;
                this._velocities[i3 + 1]! *= damp;
                this._velocities[i3 + 2]! *= damp;
            }

            /* Speed limit. */
            if (this._limitVelocityEnabled && this._speedLimit > 0) {
                const vx = this._velocities[i3]!;
                const vy = this._velocities[i3 + 1]!;
                const vz = this._velocities[i3 + 2]!;
                const speed = Math.hypot(vx, vy, vz);
                if (speed > this._speedLimit) {
                    const scale = 1 - (1 - this._speedLimit / speed) * this._limitDampen;
                    this._velocities[i3]! *= scale;
                    this._velocities[i3 + 1]! *= scale;
                    this._velocities[i3 + 2]! *= scale;
                }
            }

            /* Integrate position. */
            this._positions[i3]! += this._velocities[i3]! * dt;
            this._positions[i3 + 1]! += this._velocities[i3 + 1]! * dt;
            this._positions[i3 + 2]! += this._velocities[i3 + 2]! * dt;

            /* Ground-plane collision. */
            if (this._collisionEnabled && this._positions[i3 + 1]! < 0.03 && this._velocities[i3 + 1]! < 0) {
                const impactSpeed = Math.abs(this._velocities[i3 + 1]!);
                this._positions[i3 + 1] = 0.03;
                this._velocities[i3 + 1]! *= -this._collisionBounce;
                this._velocities[i3]! *= 1 - this._collisionDampen;
                this._velocities[i3 + 2]! *= 1 - this._collisionDampen;
                if (this._minKillSpeed > 0 && impactSpeed < this._minKillSpeed) {
                    this._ages[i] = this._lifetimes[i]!;
                    this._renderAlphas[i] = 0;
                    continue;
                }
                if (this._collisionLifetimeLoss > 0) {
                    this._ages[i]! += this._lifetimes[i]! * this._collisionLifetimeLoss;
                }
            }

            /* Rotation over lifetime. */
            if (this._rotationOverLifetimeEnabled) {
                this._rotations[i] += this._angularVelocity * dt;
            }

            /* Color over lifetime. */
            const lifeT = this._ages[i]! / this._lifetimes[i]!;
            if (colorOn) {
                this._renderColors[i3] = ar + (br - ar) * lifeT;
                this._renderColors[i3 + 1] = ag + (bg - ag) * lifeT;
                this._renderColors[i3 + 2] = ab + (bb - ab) * lifeT;
            } else {
                this._renderColors[i3] = ar;
                this._renderColors[i3 + 1] = ag;
                this._renderColors[i3 + 2] = ab;
            }

            /* Size over lifetime. */
            this._renderSizes[i] =
                baseSize *
                this._sizeMultipliers[i]! *
                (this._sizeOverLifetimeEnabled ? evaluateCurve(this._sizeCurve, lifeT) : 1);

            /* Fade in / fade out alpha envelope. */
            const fadeIn = lifeT < 0.08 ? lifeT / 0.08 : 1;
            const fadeOut = lifeT > 0.7 ? (1 - lifeT) / 0.3 : 1;
            this._renderAlphas[i] = fadeIn * fadeOut;
        }

        this._aliveCount = alive;

        /* Handle end-of-duration for non-looping systems. */
        if (!this._looping && this._loopTime >= this._duration && alive === 0) {
            this._playing = false;
        }
    }

    private _prewarmSimulation(): void {
        const step = 1 / 30;
        const wasPlaying = this._playing;
        this._playing = true;
        for (let i = 0; i < 110; i++) {
            this.update(step);
        }
        this._playing = wasPlaying;
    }

    private _initCoreSystem(): void {
        try {
            const config = this._collectConfig();
            this._coreSystem = createCoreParticleSystem(config);
            this._coreSystem.initialize();
            if (this._playing) {
                this._coreSystem.play();
            }
        } catch (error) {
            console.warn(
                `[ParticleSystem] Core simulation init failed, falling back to CPU simulation: ${(error as Error)?.message ?? error}`
            );
            this._coreSystem = null;
        }
    }

    private _rebuildCoreSystem(): void {
        if (this._coreSystem) {
            this._coreSystem.destroy();
            this._coreSystem = null;
        }
        this._initCoreSystem();
    }

    private _updateCoreSimulation(dt: number): void {
        const core = this._coreSystem!;
        const prevCoreCount = core.getParticles().count;

        const canSimulate = this._looping || this._loopTime < this._duration;
        if (canSimulate) {
            this._loopTime += dt;
            this._elapsed += dt;

            if (this._looping && this._loopTime >= this._duration) {
                this._loopTime %= this._duration;
                this._burstFired = this._burstFired.map(() => false);
            }

            this._emitOverTime(dt);
            this._emitBursts();
        }

        // Lightweight aging only — core modules handle all physics
        let aliveCount = 0;
        for (let i = 0; i < this._maxParticles; i++) {
            if (this._ages[i]! >= this._lifetimes[i]!) {
                continue;
            }
            this._ages[i]! += dt;
            if (this._ages[i]! >= this._lifetimes[i]!) {
                continue;
            }
            aliveCount++;
        }
        this._aliveCount = aliveCount;

        const coreData = core.getParticles();
        const newCoreCount = coreData.count;
        if (this._aliveCount > prevCoreCount && newCoreCount < this._aliveCount) {
            const buffer = coreData as unknown as { addParticle(p: {x:number;y:number;z:number}, v: {x:number;y:number;z:number}, lt: number, sz: number, c: number): unknown };
            const start = Math.max(prevCoreCount, newCoreCount);
            const end = Math.min(this._aliveCount, this._maxParticles);
            for (let idx = start; idx < end; idx++) {
                const age = this._ages[idx];
                const lt = this._lifetimes[idx];
                if (age >= lt) continue;
                const i3 = idx * 3;
                const r = this._startColorRgb[0], g = this._startColorRgb[1], b = this._startColorRgb[2];
                const packed = ((Math.round(r * 255) & 0xff) << 24) | ((Math.round(g * 255) & 0xff) << 16) | ((Math.round(b * 255) & 0xff) << 8) | 255;
                const initialSize = this._startSize * (this._sizeMultipliers[idx] ?? 1);
                buffer.addParticle(
                    { x: this._positions[i3], y: this._positions[i3 + 1], z: this._positions[i3 + 2] },
                    { x: this._velocities[i3], y: this._velocities[i3 + 1], z: this._velocities[i3 + 2] },
                    lt - age,
                    initialSize,
                    packed,
                );
            }
        }

        core.update(dt);

        const alive = syncCoreRenderData(core.getParticles(), {
            positions: this._positions,
            renderColors: this._renderColors,
            renderSizes: this._renderSizes,
            renderAlphas: this._renderAlphas,
            seeds: this._seeds,
            rotations: this._rotations,
            maxParticles: this._maxParticles,
        });

        this._aliveCount = alive;
        this.advanceTextureFrame(dt);

        if (!this._looping && this._elapsed >= this._duration && alive === 0) {
            this._handleSystemStopped();
        }
    }

    private _collectConfig(): ParticleSystemConfig {
        return {
            duration: this._duration,
            looping: this._looping,
            prewarm: this._prewarm,
            startDelay: this._startDelay,
            startLifetime: this._startLifetime,
            startSpeed: this._startSpeed,
            startSize: this._startSize,
            startRotation: this._startRotation,
            startColor: this.startColor,
            endColor: this.endColor,
            colorMode: this._colorMode,
            gravityModifier: this._gravityModifier,
            simulationSpace: this._simulationSpace,
            simulationSpeed: this._simulationSpeed,
            maxParticles: this._maxParticles,
            playOnLoad: this._playOnLoad,
            stopAction: this._stopAction,
            emissionEnabled: this._emissionEnabled,
            rateOverTime: this._rateOverTime,
            rateOverDistance: this._rateOverDistance,
            bursts: this._bursts,
            shapeEnabled: this._shapeEnabled,
            shapeType: this._shapeType,
            shapeRadius: this._shapeRadius,
            shapeRadiusThickness: this._shapeRadiusThickness,
            shapeAngle: this._shapeAngle,
            shapeArc: this._shapeArc,
            shapeLength: this._shapeLength,
            shapeDonutRadius: this._shapeDonutRadius,
            emitFrom: this._emitFrom,
            randomDirectionAmount: this._randomDirectionAmount,
            spherizeDirection: this._spherizeDirection,
            velocityEnabled: this._velocityEnabled,
            velocityLinear: this._velocityLinear,
            velocityOrbital: this._velocityOrbital,
            velocityRadial: this._velocityRadial,
            velocitySpeedModifier: this._velocitySpeedModifier,
            forceEnabled: this._forceEnabled,
            force: this._force,
            limitVelocityEnabled: this._limitVelocityEnabled,
            speedLimit: this._speedLimit,
            limitDampen: this._limitDampen,
            drag: this._drag,
            colorOverLifetimeEnabled: this._colorOverLifetimeEnabled,
            sizeOverLifetimeEnabled: this._sizeOverLifetimeEnabled,
            sizeCurve: this._sizeCurve,
            rotationOverLifetimeEnabled: this._rotationOverLifetimeEnabled,
            angularVelocity: this._angularVelocity,
            noiseEnabled: this._noiseEnabled,
            noiseStrength: this._noiseStrength,
            noiseFrequency: this._noiseFrequency,
            noiseDamping: this._noiseDamping,
            collisionEnabled: this._collisionEnabled,
            collisionBounce: this._collisionBounce,
            collisionDampen: this._collisionDampen,
            collisionLifetimeLoss: this._collisionLifetimeLoss,
            minKillSpeed: this._minKillSpeed,
            renderMode: this._renderMode,
            blendMode: this._blendMode,
            spriteMode: this._spriteMode,
            minParticleSize: this._minParticleSize,
            maxParticleSize: this._maxParticleSize,
            sortingFudge: this._sortingFudge,
            textureEnabled: this._textureEnabled,
            textureSheetTilesX: this._textureSheetTilesX,
            textureSheetTilesY: this._textureSheetTilesY,
            textureSheetFps: this._textureSheetFps,
            textureSheetLoop: this._textureSheetLoop,
            textureRegion: this._textureRegion,
            trailEnabled: this._trailEnabled,
            trailMode: this._trailMode,
            trailLifetime: this._trailLifetime,
            trailWidth: this._trailWidth,
            trailMinVertexDistance: this._trailMinVertexDistance,
            trailRatio: this._trailRatio,
            trailDieWithParticles: this._trailDieWithParticles,
            trailInheritColor: this._trailInheritColor,
            trailSizeAffectsWidth: this._trailSizeAffectsWidth,
            lightsEnabled: this._lightsEnabled,
            lightsMaxCount: this._lightsMaxCount,
            lightsRange: this._lightsRange,
            lightsIntensity: this._lightsIntensity,
            lightsUseParticleColor: this._lightsUseParticleColor,
            lightsShadowCasting: this._lightsShadowCasting,
            customDataEnabled: this._customDataEnabled,
        };
    }

    /* ------------------------------------------------------------------ */
    /* Serialization                                                       */
    /* ------------------------------------------------------------------ */

    override serialize(): Record<string, unknown> {
        return {
            duration: this._duration,
            looping: this._looping,
            prewarm: this._prewarm,
            startDelay: this._startDelay,
            startLifetime: this._startLifetime,
            startSpeed: this._startSpeed,
            startSize: this._startSize,
            startRotation: this._startRotation,
            startColor: this.startColor,
            endColor: this.endColor,
            colorMode: this._colorMode,
            gravityModifier: this._gravityModifier,
            simulationSpace: this._simulationSpace,
            simulationSpeed: this._simulationSpeed,
            maxParticles: this._maxParticles,
            playOnLoad: this._playOnLoad,
            stopAction: this._stopAction,

            emissionEnabled: this._emissionEnabled,
            rateOverTime: this._rateOverTime,
            rateOverDistance: this._rateOverDistance,
            bursts: this._bursts.map((burst) => ({ ...burst })),

            shapeEnabled: this._shapeEnabled,
            shapeType: this._shapeType,
            shapeRadius: this._shapeRadius,
            shapeRadiusThickness: this._shapeRadiusThickness,
            shapeAngle: this._shapeAngle,
            shapeArc: this._shapeArc,
            shapeLength: this._shapeLength,
            shapeDonutRadius: this._shapeDonutRadius,
            emitFrom: this._emitFrom,
            randomDirectionAmount: this._randomDirectionAmount,
            spherizeDirection: this._spherizeDirection,

            velocityEnabled: this._velocityEnabled,
            velocityLinear: [...this._velocityLinear],
            velocityOrbital: [...this._velocityOrbital],
            velocityRadial: this._velocityRadial,
            velocitySpeedModifier: this._velocitySpeedModifier,

            forceEnabled: this._forceEnabled,
            force: [...this._force],

            limitVelocityEnabled: this._limitVelocityEnabled,
            speedLimit: this._speedLimit,
            limitDampen: this._limitDampen,
            drag: this._drag,

            colorOverLifetimeEnabled: this._colorOverLifetimeEnabled,

            sizeOverLifetimeEnabled: this._sizeOverLifetimeEnabled,
            sizeCurve: [...this._sizeCurve],

            rotationOverLifetimeEnabled: this._rotationOverLifetimeEnabled,
            angularVelocity: this._angularVelocity,

            noiseEnabled: this._noiseEnabled,
            noiseStrength: [...this._noiseStrength],
            noiseFrequency: this._noiseFrequency,
            noiseDamping: this._noiseDamping,

            collisionEnabled: this._collisionEnabled,
            collisionBounce: this._collisionBounce,
            collisionDampen: this._collisionDampen,
            collisionLifetimeLoss: this._collisionLifetimeLoss,
            minKillSpeed: this._minKillSpeed,

            renderMode: this._renderMode,
            blendMode: this._blendMode,
            spriteMode: this._spriteMode,
            minParticleSize: this._minParticleSize,
            maxParticleSize: this._maxParticleSize,
            sortingFudge: this._sortingFudge,
            textureEnabled: this._textureEnabled,
            textureSheetTilesX: this._textureSheetTilesX,
            textureSheetTilesY: this._textureSheetTilesY,
            textureSheetFps: this._textureSheetFps,
            textureSheetLoop: this._textureSheetLoop,
            textureRegion: [...this._textureRegion] as [number, number, number, number],

            trailEnabled: this._trailEnabled,
            trailMode: this._trailMode,
            trailLifetime: this._trailLifetime,
            trailWidth: this._trailWidth,
            trailMinVertexDistance: this._trailMinVertexDistance,
            trailRatio: this._trailRatio,
            trailDieWithParticles: this._trailDieWithParticles,
            trailInheritColor: this._trailInheritColor,
            trailSizeAffectsWidth: this._trailSizeAffectsWidth,

            lightsEnabled: this._lightsEnabled,
            lightsMaxCount: this._lightsMaxCount,
            lightsRange: this._lightsRange,
            lightsIntensity: this._lightsIntensity,
            lightsUseParticleColor: this._lightsUseParticleColor,
            lightsShadowCasting: this._lightsShadowCasting,

            customDataEnabled: this._customDataEnabled,
        };
    }

    override deserialize(data: Record<string, any>): void {
        this._applyConfig((data ?? {}) as ParticleSystemConfig);
    }

    private _applyConfig(config: ParticleSystemConfig): void {
        applyParticleSystemConfig(this as unknown as ParticleSystemConfigHost, config);
    }
}
