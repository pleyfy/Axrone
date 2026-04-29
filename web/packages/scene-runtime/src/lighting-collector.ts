import { Quat, Vec3 } from '@axrone/numeric';
import {
    LightKind as LightingLightKind,
    LightingFrameResolver,
    LightingRig,
    LightSortMode,
    LightTypeCode,
} from '@axrone/lighting';
import type { Actor, Transform } from '@axrone/ecs-runtime';
import type { LightingSelectionState } from '@axrone/lighting';
import { DirectionalLight } from './components/directional-light';
import { PointLight } from './components/point-light';
import { SpotLight } from './components/spot-light';

const DEFAULT_LIGHT_DIRECTION = Object.freeze(new Vec3(0, -1, 0));
const DEFAULT_POINT_LIGHT_RANGE = 8;
const DEFAULT_SPOT_LIGHT_RANGE = 8;
const DEFAULT_LIGHT_ATTENUATION = 2;
const PRIMARY_DIRECTIONAL_PRIORITY = 1_000_000;
const LEGACY_POINT_LIGHT_TYPE = 0;
const LEGACY_SPOT_LIGHT_TYPE = 1;
const LIGHTING_POINT_LIGHT_TYPE = LightTypeCode[LightingLightKind.Point];
const LIGHTING_SPOT_LIGHT_TYPE = LightTypeCode[LightingLightKind.Spot];
const EPSILON = 1e-6;

export interface SceneLightingState {
    readonly ambient: Vec3;
    readonly skyLight: Vec3;
    readonly groundLight: Vec3;
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

const copyArrayVec3 = (
    target: Vec3,
    source: Float32Array,
    offset: number,
    fallback: Readonly<Vec3> = Vec3.ZERO
): void => {
    target.x = source[offset] ?? fallback.x;
    target.y = source[offset + 1] ?? fallback.y;
    target.z = source[offset + 2] ?? fallback.z;
};

const sameNumber = (left: number, right: number): boolean => Math.abs(left - right) <= EPSILON;

const sameVec3 = (left: Readonly<Vec3>, right: Readonly<Vec3>): boolean => {
    return sameNumber(left.x, right.x) && sameNumber(left.y, right.y) && sameNumber(left.z, right.z);
};

const clampCosine = (value: number): number => Math.min(1, Math.max(-1, value));

const angleFromCosine = (value: number): number => Math.acos(clampCosine(value));

const buildLightId = (
    kind: (typeof LightingLightKind)[keyof typeof LightingLightKind],
    componentId: string
): string => `${kind}:${componentId}`;

export class SceneLightingCollector {
    private readonly _maxLocalLights: number;
    private readonly _rig = new LightingRig();
    private readonly _resolver: LightingFrameResolver;
    private readonly _directionScratch = new Vec3(0, -1, 0);
    private readonly _seenLightIds = new Set<string>();
    private readonly _legacyLocalLightTypesBase: Int32Array;
    private readonly _legacyLocalLightInnerConesBase: Float32Array;
    private readonly _legacyLocalLightOuterConesBase: Float32Array;
    private readonly _legacyLocalLightTypesViews: readonly Int32Array[];
    private readonly _legacyLocalLightInnerConesViews: readonly Float32Array[];
    private readonly _legacyLocalLightOuterConesViews: readonly Float32Array[];
    private readonly _state: SceneLightingState;

    constructor(maxLocalLights: number) {
        this._maxLocalLights = Math.max(1, maxLocalLights);
        this._resolver = new LightingFrameResolver({
            capacity: {
                maxDirectionalLights: 1,
                maxPointLights: this._maxLocalLights,
                maxSpotLights: this._maxLocalLights,
                maxLocalLights: this._maxLocalLights,
            },
            sortMode: LightSortMode.Influence,
        });
        this._legacyLocalLightTypesBase = new Int32Array(this._maxLocalLights);
        this._legacyLocalLightInnerConesBase = new Float32Array(this._maxLocalLights);
        this._legacyLocalLightOuterConesBase = new Float32Array(this._maxLocalLights);
        this._legacyLocalLightTypesViews = this._createIntViews(this._legacyLocalLightTypesBase);
        this._legacyLocalLightInnerConesViews = this._createFloatViews(this._legacyLocalLightInnerConesBase);
        this._legacyLocalLightOuterConesViews = this._createFloatViews(this._legacyLocalLightOuterConesBase);
        this._state = {
            ambient: new Vec3(),
            skyLight: new Vec3(),
            groundLight: new Vec3(),
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
            localLightTypes: this._legacyLocalLightTypesViews[0]!,
            localLightPositions: new Float32Array(1),
            localLightDirections: new Float32Array(1),
            localLightColors: new Float32Array(1),
            localLightIntensities: new Float32Array(1),
            localLightRanges: new Float32Array(1),
            localLightInnerCones: this._legacyLocalLightInnerConesViews[0]!,
            localLightOuterCones: this._legacyLocalLightOuterConesViews[0]!,
        };
    }

    collect(
        actors: readonly Actor[],
        ambientBase: Readonly<Vec3>,
        skyLightBase: Readonly<Vec3> = Vec3.ZERO,
        groundLightBase: Readonly<Vec3> = Vec3.ZERO,
        cameraPosition?: Readonly<Vec3>
    ): SceneLightingState {
        let ambientX = ambientBase.x;
        let ambientY = ambientBase.y;
        let ambientZ = ambientBase.z;
        this._seenLightIds.clear();

        for (const actor of actors) {
            if (!actor.active) {
                continue;
            }

            const directional = actor.getComponent(DirectionalLight);
            if (directional && directional.enabled) {
                ambientX += directional.ambientColor.x;
                ambientY += directional.ambientColor.y;
                ambientZ += directional.ambientColor.z;
                this._syncDirectionalLight(directional);
            }

            const point = actor.getComponent(PointLight);
            if (point && point.enabled) {
                this._syncPointLight(point);
                continue;
            }

            const spot = actor.getComponent(SpotLight);
            if (spot && spot.enabled) {
                this._syncSpotLight(spot);
            }
        }

        this._removeStaleLights();
        this._syncEnvironment(ambientX, ambientY, ambientZ, skyLightBase, groundLightBase);

        return this._applySelection(
            this._resolver.resolve(this._rig, {
                cameraPosition,
            })
        );
    }

    private _syncDirectionalLight(light: DirectionalLight): void {
        const lightId = buildLightId(LightingLightKind.Directional, String(light.id));
        const priority = light.primary ? PRIMARY_DIRECTIONAL_PRIORITY : 0;
        const existing = this._rig.get(lightId);

        this._seenLightIds.add(lightId);
        this._writeDirection(light.transform as Transform | undefined, this._directionScratch);

        if (existing?.kind === LightingLightKind.Directional) {
            if (
                sameVec3(existing.color, light.color) &&
                sameVec3(existing.ambient, light.ambientColor) &&
                sameVec3(existing.direction, this._directionScratch) &&
                sameNumber(existing.intensity, light.intensity) &&
                sameNumber(existing.priority, priority)
            ) {
                return;
            }

            this._rig.update(lightId, {
                color: light.color,
                ambient: light.ambientColor,
                intensity: light.intensity,
                priority,
                direction: this._directionScratch,
            });
            return;
        }

        if (existing) {
            this._rig.remove(lightId);
        }

        this._rig.addDirectional({
            id: lightId,
            color: light.color,
            ambient: light.ambientColor,
            intensity: light.intensity,
            priority,
            direction: this._directionScratch,
        });
    }

    private _syncPointLight(light: PointLight): void {
        const lightId = buildLightId(LightingLightKind.Point, String(light.id));
        const transform = light.transform as Transform | undefined;
        const position = transform?.worldPosition ?? Vec3.ZERO;
        const existing = this._rig.get(lightId);

        this._seenLightIds.add(lightId);

        if (existing?.kind === LightingLightKind.Point) {
            if (
                sameVec3(existing.color, light.color) &&
                sameVec3(existing.position, position) &&
                sameNumber(existing.intensity, light.intensity) &&
                sameNumber(existing.range, light.range)
            ) {
                return;
            }

            this._rig.update(lightId, {
                color: light.color,
                intensity: light.intensity,
                range: light.range,
                attenuation: DEFAULT_LIGHT_ATTENUATION,
                position,
            });
            return;
        }

        if (existing) {
            this._rig.remove(lightId);
        }

        this._rig.addPoint({
            id: lightId,
            color: light.color,
            intensity: light.intensity,
            range: light.range,
            attenuation: DEFAULT_LIGHT_ATTENUATION,
            position,
        });
    }

    private _syncSpotLight(light: SpotLight): void {
        const lightId = buildLightId(LightingLightKind.Spot, String(light.id));
        const transform = light.transform as Transform | undefined;
        const position = transform?.worldPosition ?? Vec3.ZERO;
        const existing = this._rig.get(lightId);

        this._seenLightIds.add(lightId);
        this._writeDirection(transform, this._directionScratch);

        if (existing?.kind === LightingLightKind.Spot) {
            if (
                sameVec3(existing.color, light.color) &&
                sameVec3(existing.position, position) &&
                sameVec3(existing.direction, this._directionScratch) &&
                sameNumber(existing.intensity, light.intensity) &&
                sameNumber(existing.range, light.range) &&
                sameNumber(existing.innerConeCosine, Math.cos(light.innerConeAngle)) &&
                sameNumber(existing.outerConeCosine, Math.cos(light.outerConeAngle))
            ) {
                return;
            }

            this._rig.update(lightId, {
                color: light.color,
                intensity: light.intensity,
                range: light.range,
                attenuation: DEFAULT_LIGHT_ATTENUATION,
                position,
                direction: this._directionScratch,
                coneMode: 'angle',
                innerConeAngle: light.innerConeAngle,
                outerConeAngle: light.outerConeAngle,
            });
            return;
        }

        if (existing) {
            this._rig.remove(lightId);
        }

        this._rig.addSpot({
            id: lightId,
            color: light.color,
            intensity: light.intensity,
            range: light.range,
            attenuation: DEFAULT_LIGHT_ATTENUATION,
            position,
            direction: this._directionScratch,
            coneMode: 'angle',
            innerConeAngle: light.innerConeAngle,
            outerConeAngle: light.outerConeAngle,
        });
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

    private _removeStaleLights(): void {
        const staleIds: string[] = [];

        for (const light of this._rig.list()) {
            const lightId = String(light.id);

            if (!this._seenLightIds.has(lightId)) {
                staleIds.push(lightId);
            }
        }

        for (const lightId of staleIds) {
            this._rig.remove(lightId);
        }
    }

    private _syncEnvironment(
        ambientX: number,
        ambientY: number,
        ambientZ: number,
        skyLightBase: Readonly<Vec3>,
        groundLightBase: Readonly<Vec3>
    ): void {
        const environment = this._rig.environment;

        if (
            sameNumber(environment.ambient.x, ambientX) &&
            sameNumber(environment.ambient.y, ambientY) &&
            sameNumber(environment.ambient.z, ambientZ) &&
            sameVec3(environment.sky, skyLightBase) &&
            sameVec3(environment.ground, groundLightBase)
        ) {
            return;
        }

        this._rig.setEnvironment({
            ambient: [ambientX, ambientY, ambientZ],
            sky: skyLightBase,
            ground: groundLightBase,
        });
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

    private _applySelection(selection: LightingSelectionState): SceneLightingState {
        const state = this._state;
        const localLightCount = selection.stats.selectedLocalLightCount;

        state.ambient.x = selection.environment.ambient.x;
        state.ambient.y = selection.environment.ambient.y;
        state.ambient.z = selection.environment.ambient.z;
        state.skyLight.x = selection.environment.sky.x;
        state.skyLight.y = selection.environment.sky.y;
        state.skyLight.z = selection.environment.sky.z;
        state.groundLight.x = selection.environment.ground.x;
        state.groundLight.y = selection.environment.ground.y;
        state.groundLight.z = selection.environment.ground.z;

        state.hasDirectional = selection.stats.selectedDirectionalCount > 0;
        if (state.hasDirectional) {
            copyArrayVec3(state.directionalDirection, selection.directionalDirections, 0, DEFAULT_LIGHT_DIRECTION);
            copyArrayVec3(state.directionalColor, selection.directionalColors, 0);
            state.directionalIntensity = selection.directionalIntensities[0] ?? 0;
        } else {
            resetVec3(
                state.directionalDirection,
                DEFAULT_LIGHT_DIRECTION.x,
                DEFAULT_LIGHT_DIRECTION.y,
                DEFAULT_LIGHT_DIRECTION.z
            );
            resetVec3(state.directionalColor, 0, 0, 0);
            state.directionalIntensity = 0;
        }

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
        state.localLightCount = localLightCount;
        state.localLightPositions = selection.localLightPositions;
        state.localLightDirections = selection.localLightDirections;
        state.localLightColors = selection.localLightColors;
        state.localLightIntensities = selection.localLightIntensities;
        state.localLightRanges = selection.localLightRanges;

        this._legacyLocalLightTypesBase.fill(0);
        this._legacyLocalLightInnerConesBase.fill(0);
        this._legacyLocalLightOuterConesBase.fill(0);

        for (let index = 0; index < localLightCount; index += 1) {
            const localOffset = index * 3;
            const localType = selection.localLightKinds[index] ?? 0;

            if (localType === LIGHTING_SPOT_LIGHT_TYPE) {
                this._legacyLocalLightTypesBase[index] = LEGACY_SPOT_LIGHT_TYPE;
                this._legacyLocalLightInnerConesBase[index] = angleFromCosine(
                    selection.localLightInnerConeCosines[index] ?? 0
                );
                this._legacyLocalLightOuterConesBase[index] = angleFromCosine(
                    selection.localLightOuterConeCosines[index] ?? 0
                );
                state.spotCount += 1;

                if (state.spotCount === 1) {
                    copyArrayVec3(state.spotLightPosition, selection.localLightPositions, localOffset);
                    copyArrayVec3(
                        state.spotLightDirection,
                        selection.localLightDirections,
                        localOffset,
                        DEFAULT_LIGHT_DIRECTION
                    );
                    copyArrayVec3(state.spotLightColor, selection.localLightColors, localOffset);
                    state.spotLightIntensity = selection.localLightIntensities[index] ?? 0;
                    state.spotLightRange = selection.localLightRanges[index] ?? 0;
                    state.spotLightInnerCone = this._legacyLocalLightInnerConesBase[index]!;
                    state.spotLightOuterCone = this._legacyLocalLightOuterConesBase[index]!;
                }

                continue;
            }

            this._legacyLocalLightTypesBase[index] =
                localType === LIGHTING_POINT_LIGHT_TYPE ? LEGACY_POINT_LIGHT_TYPE : 0;

            if (localType === LIGHTING_POINT_LIGHT_TYPE) {
                state.pointCount += 1;

                if (state.pointCount === 1) {
                    copyArrayVec3(state.pointLightPosition, selection.localLightPositions, localOffset);
                    copyArrayVec3(state.pointLightColor, selection.localLightColors, localOffset);
                    state.pointLightIntensity = selection.localLightIntensities[index] ?? 0;
                    state.pointLightRange = selection.localLightRanges[index] ?? 0;
                }
            }
        }

        state.localLightTypes = this._legacyLocalLightTypesViews[localLightCount]!;
        state.localLightInnerCones = this._legacyLocalLightInnerConesViews[localLightCount]!;
        state.localLightOuterCones = this._legacyLocalLightOuterConesViews[localLightCount]!;

        return state;
    }
}
