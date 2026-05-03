import { Quat, Vec3 } from '@axrone/numeric';
import {
    LightKind as LightingLightKind,
    LightingFrameResolver,
    LightingRig,
    LightSortMode,
} from '@axrone/lighting';
import type { LightingSelectionState } from '@axrone/lighting';
import type { Actor, Transform } from '@axrone/ecs-runtime';
import { DirectionalLight } from './components/directional-light';
import { PointLight } from './components/point-light';
import { SpotLight } from './components/spot-light';

const DEFAULT_LIGHT_DIRECTION = Object.freeze(new Vec3(0, -1, 0));
const DEFAULT_LIGHT_ATTENUATION = 2;
const PRIMARY_DIRECTIONAL_PRIORITY = 1_000_000;
const EPSILON = 1e-6;

export type SceneLightingState = LightingSelectionState;

const resetVec3 = (vector: Vec3, x: number, y: number, z: number): void => {
    vector.x = x;
    vector.y = y;
    vector.z = z;
};

const sameNumber = (left: number, right: number): boolean => Math.abs(left - right) <= EPSILON;

const sameVec3 = (left: Readonly<Vec3>, right: Readonly<Vec3>): boolean => {
    return (
        sameNumber(left.x, right.x) &&
        sameNumber(left.y, right.y) &&
        sameNumber(left.z, right.z)
    );
};

const buildLightId = (
    kind: (typeof LightingLightKind)[keyof typeof LightingLightKind],
    componentId: string
): string => `${kind}:${componentId}`;

export class SceneLightingCollector {
    private readonly _rig = new LightingRig();
    private readonly _resolver: LightingFrameResolver;
    private readonly _directionScratch = new Vec3(0, -1, 0);
    private readonly _seenLightIds = new Set<string>();

    constructor(maxLocalLights: number) {
        const resolvedCapacity = Math.max(0, Math.trunc(maxLocalLights));

        this._resolver = new LightingFrameResolver({
            capacity: {
                maxDirectionalLights: 1,
                maxPointLights: resolvedCapacity,
                maxSpotLights: resolvedCapacity,
                maxLocalLights: resolvedCapacity,
            },
            sortMode: LightSortMode.Influence,
        });
    }

    collect(
        actors: readonly Actor[],
        ambientBase: Readonly<Vec3>,
        skyLightBase: Readonly<Vec3> = Vec3.ZERO,
        groundLightBase: Readonly<Vec3> = Vec3.ZERO,
        cameraPosition?: Readonly<Vec3>
    ): SceneLightingState {
        this._seenLightIds.clear();

        for (const actor of actors) {
            if (!actor.active) {
                continue;
            }

            const directional = actor.getComponent(DirectionalLight);
            if (directional && directional.enabled) {
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
        this._syncEnvironment(ambientBase, skyLightBase, groundLightBase);

        return this._resolver.resolve(this._rig, {
            cameraPosition,
        });
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
        ambientBase: Readonly<Vec3>,
        skyLightBase: Readonly<Vec3>,
        groundLightBase: Readonly<Vec3>
    ): void {
        const environment = this._rig.environment;

        if (
            sameVec3(environment.ambient, ambientBase) &&
            sameVec3(environment.sky, skyLightBase) &&
            sameVec3(environment.ground, groundLightBase)
        ) {
            return;
        }

        this._rig.setEnvironment({
            ambient: ambientBase,
            sky: skyLightBase,
            ground: groundLightBase,
        });
    }
}
