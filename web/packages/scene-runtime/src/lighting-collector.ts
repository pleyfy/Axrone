import { Quat, Vec3 } from '@axrone/numeric';
import type { Actor } from '../../core/src/component-system/core/actor';
import type { Transform } from '../../core/src/component-system/components/transform';
import { DirectionalLight } from './components/directional-light';
import { PointLight } from './components/point-light';
import { SpotLight } from './components/spot-light';

const DEFAULT_LIGHT_DIRECTION = Object.freeze(new Vec3(0, -1, 0));

export interface SceneLightingState {
    readonly ambient: Vec3;
    hasDirectional: boolean;
    readonly directionalDirection: Vec3;
    readonly directionalColor: Vec3;
    directionalIntensity: number;
    readonly pointLightPosition: Vec3;
    readonly pointLightColor: Vec3;
    pointLightIntensity: number;
    pointLightRange: number;
    readonly spotLightPosition: Vec3;
    readonly spotLightDirection: Vec3;
    readonly spotLightColor: Vec3;
    spotLightIntensity: number;
    spotLightRange: number;
    spotLightInnerCone: number;
    spotLightOuterCone: number;
    pointCount: number;
    spotCount: number;
    localLightCount: number;
    localLightTypes: Int32Array;
    localLightPositions: Float32Array;
    localLightDirections: Float32Array;
    localLightColors: Float32Array;
    localLightIntensities: Float32Array;
    localLightRanges: Float32Array;
    localLightInnerCones: Float32Array;
    localLightOuterCones: Float32Array;
}

const resetVec3 = (vector: Vec3, x: number, y: number, z: number): void => {
    vector.x = x;
    vector.y = y;
    vector.z = z;
};

const copyVec3 = (target: Vec3, source: Vec3): void => {
    target.x = source.x;
    target.y = source.y;
    target.z = source.z;
};

export class SceneLightingCollector {
    private readonly _maxLocalLights: number;
    private readonly _directionScratch = new Vec3(0, -1, 0);
    private readonly _localLightTypesBase: Int32Array;
    private readonly _localLightPositionsBase: Float32Array;
    private readonly _localLightDirectionsBase: Float32Array;
    private readonly _localLightColorsBase: Float32Array;
    private readonly _localLightIntensitiesBase: Float32Array;
    private readonly _localLightRangesBase: Float32Array;
    private readonly _localLightInnerConesBase: Float32Array;
    private readonly _localLightOuterConesBase: Float32Array;
    private readonly _localLightTypesViews: readonly Int32Array[];
    private readonly _localLightPositionsViews: readonly Float32Array[];
    private readonly _localLightDirectionsViews: readonly Float32Array[];
    private readonly _localLightColorsViews: readonly Float32Array[];
    private readonly _localLightIntensitiesViews: readonly Float32Array[];
    private readonly _localLightRangesViews: readonly Float32Array[];
    private readonly _localLightInnerConesViews: readonly Float32Array[];
    private readonly _localLightOuterConesViews: readonly Float32Array[];
    private readonly _state: SceneLightingState;

    constructor(maxLocalLights: number) {
        this._maxLocalLights = Math.max(1, maxLocalLights);
        this._localLightTypesBase = new Int32Array(this._maxLocalLights);
        this._localLightPositionsBase = new Float32Array(this._maxLocalLights * 3);
        this._localLightDirectionsBase = new Float32Array(this._maxLocalLights * 3);
        this._localLightColorsBase = new Float32Array(this._maxLocalLights * 3);
        this._localLightIntensitiesBase = new Float32Array(this._maxLocalLights);
        this._localLightRangesBase = new Float32Array(this._maxLocalLights);
        this._localLightInnerConesBase = new Float32Array(this._maxLocalLights);
        this._localLightOuterConesBase = new Float32Array(this._maxLocalLights);
        this._localLightTypesViews = this._createIntViews(this._localLightTypesBase);
        this._localLightPositionsViews = this._createFloatViews(this._localLightPositionsBase, 3);
        this._localLightDirectionsViews = this._createFloatViews(this._localLightDirectionsBase, 3);
        this._localLightColorsViews = this._createFloatViews(this._localLightColorsBase, 3);
        this._localLightIntensitiesViews = this._createFloatViews(this._localLightIntensitiesBase);
        this._localLightRangesViews = this._createFloatViews(this._localLightRangesBase);
        this._localLightInnerConesViews = this._createFloatViews(this._localLightInnerConesBase);
        this._localLightOuterConesViews = this._createFloatViews(this._localLightOuterConesBase);
        this._state = {
            ambient: new Vec3(),
            hasDirectional: false,
            directionalDirection: new Vec3(0, -1, 0),
            directionalColor: new Vec3(),
            directionalIntensity: 0,
            pointLightPosition: new Vec3(),
            pointLightColor: new Vec3(),
            pointLightIntensity: 0,
            pointLightRange: 0,
            spotLightPosition: new Vec3(),
            spotLightDirection: new Vec3(0, -1, 0),
            spotLightColor: new Vec3(),
            spotLightIntensity: 0,
            spotLightRange: 0,
            spotLightInnerCone: 0,
            spotLightOuterCone: 0,
            pointCount: 0,
            spotCount: 0,
            localLightCount: 0,
            localLightTypes: this._localLightTypesViews[0]!,
            localLightPositions: this._localLightPositionsViews[0]!,
            localLightDirections: this._localLightDirectionsViews[0]!,
            localLightColors: this._localLightColorsViews[0]!,
            localLightIntensities: this._localLightIntensitiesViews[0]!,
            localLightRanges: this._localLightRangesViews[0]!,
            localLightInnerCones: this._localLightInnerConesViews[0]!,
            localLightOuterCones: this._localLightOuterConesViews[0]!,
        };
    }

    collect(actors: readonly Actor[], ambientBase: Readonly<Vec3>): SceneLightingState {
        const state = this._state;
        this._resetState(ambientBase);
        let hasFallbackDirectional = false;

        for (const actor of actors) {
            if (!actor.active) {
                continue;
            }

            const directional = actor.getComponent(DirectionalLight);
            if (directional && directional.enabled) {
                state.ambient.x += directional.ambientColor.x;
                state.ambient.y += directional.ambientColor.y;
                state.ambient.z += directional.ambientColor.z;

                const target =
                    directional.primary || !hasFallbackDirectional || !state.hasDirectional
                        ? state.directionalDirection
                        : null;

                if (target) {
                    this._writeDirection(directional.transform as Transform | undefined, target);
                    copyVec3(state.directionalColor, directional.color);
                    state.directionalIntensity = directional.intensity;
                    state.hasDirectional = true;
                    hasFallbackDirectional = hasFallbackDirectional || !directional.primary;
                }
            }

            if (state.localLightCount >= this._maxLocalLights) {
                continue;
            }

            const point = actor.getComponent(PointLight);
            if (point && point.enabled) {
                this._appendPointLight(point, state.localLightCount);
                state.localLightCount += 1;
                state.pointCount += 1;
                continue;
            }

            const spot = actor.getComponent(SpotLight);
            if (spot && spot.enabled) {
                this._appendSpotLight(spot, state.localLightCount);
                state.localLightCount += 1;
                state.spotCount += 1;
            }
        }

        this._applyViews(state.localLightCount);

        return state;
    }

    private _resetState(ambientBase: Readonly<Vec3>): void {
        const state = this._state;
        state.ambient.x = ambientBase.x;
        state.ambient.y = ambientBase.y;
        state.ambient.z = ambientBase.z;
        state.hasDirectional = false;
        resetVec3(
            state.directionalDirection,
            DEFAULT_LIGHT_DIRECTION.x,
            DEFAULT_LIGHT_DIRECTION.y,
            DEFAULT_LIGHT_DIRECTION.z
        );
        resetVec3(state.directionalColor, 0, 0, 0);
        state.directionalIntensity = 0;
        resetVec3(state.pointLightPosition, 0, 0, 0);
        resetVec3(state.pointLightColor, 0, 0, 0);
        state.pointLightIntensity = 0;
        state.pointLightRange = 0;
        resetVec3(state.spotLightPosition, 0, 0, 0);
        resetVec3(
            state.spotLightDirection,
            DEFAULT_LIGHT_DIRECTION.x,
            DEFAULT_LIGHT_DIRECTION.y,
            DEFAULT_LIGHT_DIRECTION.z
        );
        resetVec3(state.spotLightColor, 0, 0, 0);
        state.spotLightIntensity = 0;
        state.spotLightRange = 0;
        state.spotLightInnerCone = 0;
        state.spotLightOuterCone = 0;
        state.pointCount = 0;
        state.spotCount = 0;
        state.localLightCount = 0;
        this._localLightTypesBase.fill(0);
        this._localLightPositionsBase.fill(0);
        this._localLightDirectionsBase.fill(0);
        this._localLightColorsBase.fill(0);
        this._localLightIntensitiesBase.fill(0);
        this._localLightRangesBase.fill(0);
        this._localLightInnerConesBase.fill(0);
        this._localLightOuterConesBase.fill(0);
    }

    private _appendPointLight(light: PointLight, slot: number): void {
        const state = this._state;
        const offset = slot * 3;
        const transform = light.transform as Transform | undefined;
        const position = transform?.worldPosition;

        if (position) {
        this._localLightPositionsBase[offset] = position.x;
        this._localLightPositionsBase[offset + 1] = position.y;
        this._localLightPositionsBase[offset + 2] = position.z;

            if (state.pointCount === 0) {
                copyVec3(state.pointLightPosition, position);
            }
        }

        this._localLightColorsBase[offset] = light.color.x;
        this._localLightColorsBase[offset + 1] = light.color.y;
        this._localLightColorsBase[offset + 2] = light.color.z;
        this._localLightIntensitiesBase[slot] = light.intensity;
        this._localLightRangesBase[slot] = light.range;

        if (state.pointCount === 0) {
            copyVec3(state.pointLightColor, light.color);
            state.pointLightIntensity = light.intensity;
            state.pointLightRange = light.range;
        }
    }

    private _appendSpotLight(light: SpotLight, slot: number): void {
        const state = this._state;
        const offset = slot * 3;
        const transform = light.transform as Transform | undefined;
        const position = transform?.worldPosition;

        if (position) {
        this._localLightPositionsBase[offset] = position.x;
        this._localLightPositionsBase[offset + 1] = position.y;
        this._localLightPositionsBase[offset + 2] = position.z;

            if (state.spotCount === 0) {
                copyVec3(state.spotLightPosition, position);
            }
        }

        this._writeDirection(transform, this._directionScratch);
        this._localLightTypesBase[slot] = 1;
        this._localLightDirectionsBase[offset] = this._directionScratch.x;
        this._localLightDirectionsBase[offset + 1] = this._directionScratch.y;
        this._localLightDirectionsBase[offset + 2] = this._directionScratch.z;
        this._localLightColorsBase[offset] = light.color.x;
        this._localLightColorsBase[offset + 1] = light.color.y;
        this._localLightColorsBase[offset + 2] = light.color.z;
        this._localLightIntensitiesBase[slot] = light.intensity;
        this._localLightRangesBase[slot] = light.range;
        this._localLightInnerConesBase[slot] = light.innerConeAngle;
        this._localLightOuterConesBase[slot] = light.outerConeAngle;

        if (state.spotCount === 0) {
            copyVec3(state.spotLightDirection, this._directionScratch);
            copyVec3(state.spotLightColor, light.color);
            state.spotLightIntensity = light.intensity;
            state.spotLightRange = light.range;
            state.spotLightInnerCone = light.innerConeAngle;
            state.spotLightOuterCone = light.outerConeAngle;
        }
    }

    private _writeDirection(transform: Transform | undefined, target: Vec3): void {
        if (!transform) {
            resetVec3(
                target,
                DEFAULT_LIGHT_DIRECTION.x,
                DEFAULT_LIGHT_DIRECTION.y,
                DEFAULT_LIGHT_DIRECTION.z
            );
            return;
        }

        Quat.rotateVector(transform.worldRotation, Vec3.FORWARD, this._directionScratch);
        Vec3.normalize(this._directionScratch, target);
    }

    private _createIntViews(source: Int32Array): readonly Int32Array[] {
        return Object.freeze(
            Array.from({ length: this._maxLocalLights + 1 }, (_, count) =>
                source.subarray(0, Math.max(1, count))
            )
        );
    }

    private _createFloatViews(source: Float32Array, stride: number = 1): readonly Float32Array[] {
        return Object.freeze(
            Array.from({ length: this._maxLocalLights + 1 }, (_, count) =>
                source.subarray(0, Math.max(1, count) * stride)
            )
        );
    }

    private _applyViews(localLightCount: number): void {
        this._state.localLightTypes = this._localLightTypesViews[localLightCount]!;
        this._state.localLightPositions = this._localLightPositionsViews[localLightCount]!;
        this._state.localLightDirections = this._localLightDirectionsViews[localLightCount]!;
        this._state.localLightColors = this._localLightColorsViews[localLightCount]!;
        this._state.localLightIntensities = this._localLightIntensitiesViews[localLightCount]!;
        this._state.localLightRanges = this._localLightRangesViews[localLightCount]!;
        this._state.localLightInnerCones = this._localLightInnerConesViews[localLightCount]!;
        this._state.localLightOuterCones = this._localLightOuterConesViews[localLightCount]!;
    }
}
