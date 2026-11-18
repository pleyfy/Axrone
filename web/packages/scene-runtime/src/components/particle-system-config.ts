import { clamp } from '@axrone/numeric';
import type { ParticleSystem as CoreParticleSystem } from '@axrone/particle-system';
import type {
    ParticleBlendMode,
    ParticleBurst,
    ParticleColorMode,
    ParticleRenderMode,
    ParticleSimulationSpace,
    ParticleShapeType,
    ParticleSpriteMode,
    ParticleStopAction,
    ParticleSystemConfig,
} from './particle-system';

export interface ParticleSystemConfigHost {
    duration: number;
    looping: boolean;
    startDelay: number;
    startLifetime: number;
    startSpeed: number;
    startSize: number;
    startRotation: number;
    startColor: string;
    endColor: string;
    colorMode: ParticleColorMode;
    gravityModifier: number;
    simulationSpace: ParticleSimulationSpace;
    simulationSpeed: number;
    maxParticles: number;
    stopAction: ParticleStopAction;
    emissionEnabled: boolean;
    rateOverTime: number;
    rateOverDistance: number;
    bursts: readonly ParticleBurst[];
    shapeEnabled: boolean;
    shapeType: ParticleShapeType;
    shapeRadius: number;
    shapeAngle: number;
    shapeArc: number;
    velocityEnabled: boolean;
    forceEnabled: boolean;
    limitVelocityEnabled: boolean;
    colorOverLifetimeEnabled: boolean;
    sizeOverLifetimeEnabled: boolean;
    sizeCurve: readonly number[];
    _sizeCurve: number[];
    rotationOverLifetimeEnabled: boolean;
    noiseEnabled: boolean;
    noiseFrequency: number;
    collisionEnabled: boolean;
    collisionBounce: number;
    collisionDampen: number;
    renderMode: ParticleRenderMode;
    blendMode: ParticleBlendMode;
    spriteMode: ParticleSpriteMode;
    _prewarm: boolean;
    _playOnLoad: boolean;
    _shapeRadiusThickness: number;
    _shapeLength: number;
    _shapeDonutRadius: number;
    _emitFrom: 'volume' | 'shell' | 'edge' | 'base';
    _randomDirectionAmount: number;
    _spherizeDirection: number;
    _velocityLinear: [number, number, number];
    _velocityOrbital: [number, number, number];
    _velocityRadial: number;
    _velocitySpeedModifier: number;
    _force: [number, number, number];
    _speedLimit: number;
    _limitDampen: number;
    _drag: number;
    _angularVelocity: number;
    _noiseStrength: [number, number, number];
    _noiseDamping: boolean;
    _collisionLifetimeLoss: number;
 _minKillSpeed: number;
    _minParticleSize: number;
    _maxParticleSize: number;
    _sortingFudge: number;
    _textureEnabled: boolean;
    _textureSheetTilesX: number;
    _textureSheetTilesY: number;
    _textureSheetFps: number;
    _textureSheetLoop: boolean;
    _textureRegion: [number, number, number, number];
    _trailEnabled: boolean;
    _trailMode: 'particles' | 'ribbon';
    _trailLifetime: number;
    _trailWidth: number;
    _trailMinVertexDistance: number;
    _trailRatio: number;
    _trailDieWithParticles: boolean;
    _trailInheritColor: boolean;
    _trailSizeAffectsWidth: boolean;
    _lightsEnabled: boolean;
    _lightsMaxCount: number;
    _lightsRange: number;
    _lightsIntensity: number;
    _lightsUseParticleColor: boolean;
    _lightsShadowCasting: boolean;
    _customDataEnabled: boolean;
    _coreSystem: CoreParticleSystem | null;
    _rebuildCoreSystem(): void;
}

export function applyParticleSystemConfig(host: ParticleSystemConfigHost, config: ParticleSystemConfig): void {
    if (typeof config.duration === 'number') host.duration = config.duration;
    if (typeof config.looping === 'boolean') host.looping = config.looping;
    if (typeof config.prewarm === 'boolean') host._prewarm = config.prewarm;
    if (typeof config.startDelay === 'number') host.startDelay = config.startDelay;
    if (typeof config.startLifetime === 'number') host.startLifetime = config.startLifetime;
    if (typeof config.startSpeed === 'number') host.startSpeed = config.startSpeed;
    if (typeof config.startSize === 'number') host.startSize = config.startSize;
    if (typeof config.startRotation === 'number') host.startRotation = config.startRotation;
    if (typeof config.startColor === 'string') host.startColor = config.startColor;
    if (typeof config.endColor === 'string') host.endColor = config.endColor;
    if (typeof config.colorMode === 'string') host.colorMode = config.colorMode;
    if (typeof config.gravityModifier === 'number') host.gravityModifier = config.gravityModifier;
    if (typeof config.simulationSpace === 'string') host.simulationSpace = config.simulationSpace;
    if (typeof config.simulationSpeed === 'number') host.simulationSpeed = config.simulationSpeed;
    if (typeof config.maxParticles === 'number') host.maxParticles = config.maxParticles;
    if (typeof config.playOnLoad === 'boolean') host._playOnLoad = config.playOnLoad;
    if (typeof config.stopAction === 'string') host.stopAction = config.stopAction;

    if (typeof config.emissionEnabled === 'boolean') host.emissionEnabled = config.emissionEnabled;
    if (typeof config.rateOverTime === 'number') host.rateOverTime = config.rateOverTime;
    if (typeof config.rateOverDistance === 'number') host.rateOverDistance = config.rateOverDistance;
    if (Array.isArray(config.bursts)) {
        host.bursts = config.bursts.map((burst) => ({
            time: typeof burst?.time === 'number' ? burst.time : 0,
            count: typeof burst?.count === 'number' ? burst.count : 10,
            cycles: typeof burst?.cycles === 'number' ? burst.cycles : 1,
            interval: typeof burst?.interval === 'number' ? burst.interval : 0.01,
            probability: typeof burst?.probability === 'number' ? burst.probability : 1,
        }));
    }

    if (typeof config.shapeEnabled === 'boolean') host.shapeEnabled = config.shapeEnabled;
    if (typeof config.shapeType === 'string') host.shapeType = config.shapeType;
    if (typeof config.shapeRadius === 'number') host.shapeRadius = config.shapeRadius;
    if (typeof config.shapeRadiusThickness === 'number') {
        host._shapeRadiusThickness = clamp(config.shapeRadiusThickness, 0, 1);
    }
    if (typeof config.shapeAngle === 'number') host.shapeAngle = config.shapeAngle;
    if (typeof config.shapeArc === 'number') host.shapeArc = config.shapeArc;
    if (typeof config.shapeLength === 'number') host._shapeLength = Math.max(0.1, config.shapeLength);
    if (typeof config.shapeDonutRadius === 'number') {
        host._shapeDonutRadius = Math.max(0.01, config.shapeDonutRadius);
    }
    if (config.emitFrom) host._emitFrom = config.emitFrom;
    if (typeof config.randomDirectionAmount === 'number') {
        host._randomDirectionAmount = clamp(config.randomDirectionAmount, 0, 1);
    }
    if (typeof config.spherizeDirection === 'number') {
        host._spherizeDirection = clamp(config.spherizeDirection, 0, 1);
    }

    if (typeof config.velocityEnabled === 'boolean') host.velocityEnabled = config.velocityEnabled;
    if (Array.isArray(config.velocityLinear) && config.velocityLinear.length === 3) {
        host._velocityLinear = [
            config.velocityLinear[0] ?? 0,
            config.velocityLinear[1] ?? 0,
            config.velocityLinear[2] ?? 0,
        ];
    }
    if (Array.isArray(config.velocityOrbital) && config.velocityOrbital.length === 3) {
        host._velocityOrbital = [
            config.velocityOrbital[0] ?? 0,
            config.velocityOrbital[1] ?? 0,
            config.velocityOrbital[2] ?? 0,
        ];
    }
    if (typeof config.velocityRadial === 'number') host._velocityRadial = config.velocityRadial;
    if (typeof config.velocitySpeedModifier === 'number') {
        host._velocitySpeedModifier = config.velocitySpeedModifier;
    }

    if (typeof config.forceEnabled === 'boolean') host.forceEnabled = config.forceEnabled;
    if (Array.isArray(config.force) && config.force.length === 3) {
        host._force = [config.force[0] ?? 0, config.force[1] ?? 0, config.force[2] ?? 0];
    }

    if (typeof config.limitVelocityEnabled === 'boolean') {
        host.limitVelocityEnabled = config.limitVelocityEnabled;
    }
    if (typeof config.speedLimit === 'number') host._speedLimit = Math.max(0, config.speedLimit);
    if (typeof config.limitDampen === 'number') host._limitDampen = clamp(config.limitDampen, 0, 1);
    if (typeof config.drag === 'number') host._drag = Math.max(0, config.drag);

    if (typeof config.colorOverLifetimeEnabled === 'boolean') {
        host.colorOverLifetimeEnabled = config.colorOverLifetimeEnabled;
    }

    if (typeof config.sizeOverLifetimeEnabled === 'boolean') {
        host.sizeOverLifetimeEnabled = config.sizeOverLifetimeEnabled;
    }
    if (Array.isArray(config.sizeCurve)) {
        host._sizeCurve = config.sizeCurve.map((value) =>
            typeof value === 'number' ? value : 1
        );
    }

    if (typeof config.rotationOverLifetimeEnabled === 'boolean') {
        host.rotationOverLifetimeEnabled = config.rotationOverLifetimeEnabled;
    }
    if (typeof config.angularVelocity === 'number') host._angularVelocity = config.angularVelocity;

    if (typeof config.noiseEnabled === 'boolean') host.noiseEnabled = config.noiseEnabled;
    if (Array.isArray(config.noiseStrength) && config.noiseStrength.length === 3) {
        host._noiseStrength = [
            config.noiseStrength[0] ?? 0,
            config.noiseStrength[1] ?? 0,
            config.noiseStrength[2] ?? 0,
        ];
    }
    if (typeof config.noiseFrequency === 'number') host.noiseFrequency = config.noiseFrequency;
    if (typeof config.noiseDamping === 'boolean') host._noiseDamping = config.noiseDamping;

    if (typeof config.collisionEnabled === 'boolean') host.collisionEnabled = config.collisionEnabled;
    if (typeof config.collisionBounce === 'number') host.collisionBounce = config.collisionBounce;
    if (typeof config.collisionDampen === 'number') host.collisionDampen = config.collisionDampen;
    if (typeof config.collisionLifetimeLoss === 'number') {
        host._collisionLifetimeLoss = clamp(config.collisionLifetimeLoss, 0, 1);
    }
    if (typeof config.minKillSpeed === 'number') host._minKillSpeed = Math.max(0, config.minKillSpeed);

    if (typeof config.renderMode === 'string') host.renderMode = config.renderMode;
    if (typeof config.blendMode === 'string') host.blendMode = config.blendMode;
    if (typeof config.spriteMode === 'string') host.spriteMode = config.spriteMode;
    if (typeof config.minParticleSize === 'number') {
        host._minParticleSize = clamp(config.minParticleSize, 0, 1);
    }
    if (typeof config.maxParticleSize === 'number') {
        host._maxParticleSize = clamp(config.maxParticleSize, 0, 1);
    }
    if (typeof config.sortingFudge === 'number') host._sortingFudge = config.sortingFudge;

    if (typeof config.textureEnabled === 'boolean') host._textureEnabled = config.textureEnabled;
    if (typeof config.textureSheetTilesX === 'number') {
        host._textureSheetTilesX = Math.max(1, Math.floor(config.textureSheetTilesX));
    }
    if (typeof config.textureSheetTilesY === 'number') {
        host._textureSheetTilesY = Math.max(1, Math.floor(config.textureSheetTilesY));
    }
    if (typeof config.textureSheetFps === 'number') {
        host._textureSheetFps = Math.max(1, config.textureSheetFps);
    }
    if (typeof config.textureSheetLoop === 'boolean') host._textureSheetLoop = config.textureSheetLoop;
    if (config.textureRegion && config.textureRegion.length === 4) {
        host._textureRegion = [
            config.textureRegion[0],
            config.textureRegion[1],
            config.textureRegion[2],
            config.textureRegion[3],
        ];
    }

    if (typeof config.trailEnabled === 'boolean') host._trailEnabled = config.trailEnabled;
    if (config.trailMode === 'particles' || config.trailMode === 'ribbon') {
        host._trailMode = config.trailMode;
    }
    if (typeof config.trailLifetime === 'number') host._trailLifetime = Math.max(0, config.trailLifetime);
    if (typeof config.trailWidth === 'number') host._trailWidth = Math.max(0, config.trailWidth);
    if (typeof config.trailMinVertexDistance === 'number') {
        host._trailMinVertexDistance = Math.max(0, config.trailMinVertexDistance);
    }
    if (typeof config.trailRatio === 'number') host._trailRatio = clamp(config.trailRatio, 0, 1);
    if (typeof config.trailDieWithParticles === 'boolean') {
        host._trailDieWithParticles = config.trailDieWithParticles;
    }
    if (typeof config.trailInheritColor === 'boolean') host._trailInheritColor = config.trailInheritColor;
    if (typeof config.trailSizeAffectsWidth === 'boolean') {
        host._trailSizeAffectsWidth = config.trailSizeAffectsWidth;
    }

    if (typeof config.lightsEnabled === 'boolean') host._lightsEnabled = config.lightsEnabled;
    if (typeof config.lightsMaxCount === 'number') {
        host._lightsMaxCount = Math.max(0, Math.min(64, config.lightsMaxCount));
    }
    if (typeof config.lightsRange === 'number') host._lightsRange = Math.max(0, config.lightsRange);
    if (typeof config.lightsIntensity === 'number') {
        host._lightsIntensity = Math.max(0, config.lightsIntensity);
    }
    if (typeof config.lightsUseParticleColor === 'boolean') {
        host._lightsUseParticleColor = config.lightsUseParticleColor;
    }
    if (typeof config.lightsShadowCasting === 'boolean') {
        host._lightsShadowCasting = config.lightsShadowCasting;
    }

    if (typeof config.customDataEnabled === 'boolean') {
        host._customDataEnabled = config.customDataEnabled;
    }

    if (host._coreSystem) {
        host._rebuildCoreSystem();
    }
}
