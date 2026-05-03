import type { Vec3 } from '@axrone/numeric';
import type { LightingCapacity, LightingSelectionState } from './types';
import { resolveLightingCapacity } from './validation';

export type LightingUniformField =
    | 'AmbientLight'
    | 'SkyLight'
    | 'GroundLight'
    | 'Exposure'
    | 'Gamma'
    | 'DirectionalLightCount'
    | 'DirectionalLightDirection'
    | 'DirectionalLightColor'
    | 'DirectionalLightAmbientColor'
    | 'DirectionalLightIntensity'
    | 'PointLightCount'
    | 'PointLightPosition'
    | 'PointLightColor'
    | 'PointLightIntensity'
    | 'PointLightRange'
    | 'SpotLightCount'
    | 'SpotLightPosition'
    | 'SpotLightDirection'
    | 'SpotLightColor'
    | 'SpotLightIntensity'
    | 'SpotLightRange'
    | 'SpotLightInnerConeCosine'
    | 'SpotLightOuterConeCosine'
    | 'LocalLightCount'
    | 'LocalLightKind'
    | 'LocalLightPosition'
    | 'LocalLightDirection'
    | 'LocalLightColor'
    | 'LocalLightIntensity'
    | 'LocalLightRange'
    | 'LocalLightInnerConeCosine'
    | 'LocalLightOuterConeCosine';

export type LightingUniformName<TField extends LightingUniformField = LightingUniformField> =
    `u_${TField}`;

export type LightingUniformNames = {
    readonly [TField in LightingUniformField as Uncapitalize<TField>]: LightingUniformName<TField>;
};

export type LightingUniformPropertyType = 'vec3' | 'float' | 'int';

export interface LightingUniformProperty<TField extends LightingUniformField = LightingUniformField> {
    readonly name: LightingUniformName<TField>;
    readonly type: LightingUniformPropertyType;
    readonly scope: 'frame';
    readonly arrayLength?: number;
}

export interface LightingShaderDefines {
    readonly AXRONE_LIGHTING_MAX_DIRECTIONAL_LIGHTS: string;
    readonly AXRONE_LIGHTING_MAX_POINT_LIGHTS: string;
    readonly AXRONE_LIGHTING_MAX_SPOT_LIGHTS: string;
    readonly AXRONE_LIGHTING_MAX_LOCAL_LIGHTS: string;
}

export interface LightingUniformLayout {
    readonly capacity: Readonly<LightingCapacity>;
    readonly names: LightingUniformNames;
    readonly defines: LightingShaderDefines;
    readonly properties: readonly LightingUniformProperty[];
}

export type LightingUniformValue<TField extends LightingUniformField> =
    TField extends
        | 'Exposure'
        | 'Gamma'
        | 'DirectionalLightCount'
        | 'PointLightCount'
        | 'SpotLightCount'
        | 'LocalLightCount'
        ? number
        : TField extends 'LocalLightKind'
          ? Int32Array
          : TField extends 'AmbientLight' | 'SkyLight' | 'GroundLight'
            ? Readonly<Vec3>
            : Float32Array;

export type LightingUniformValueMap = {
    readonly [TField in LightingUniformField as LightingUniformName<TField>]: LightingUniformValue<TField>;
};

const NAMES: LightingUniformNames = Object.freeze({
    ambientLight: 'u_AmbientLight',
    skyLight: 'u_SkyLight',
    groundLight: 'u_GroundLight',
    exposure: 'u_Exposure',
    gamma: 'u_Gamma',
    directionalLightCount: 'u_DirectionalLightCount',
    directionalLightDirection: 'u_DirectionalLightDirection',
    directionalLightColor: 'u_DirectionalLightColor',
    directionalLightAmbientColor: 'u_DirectionalLightAmbientColor',
    directionalLightIntensity: 'u_DirectionalLightIntensity',
    pointLightCount: 'u_PointLightCount',
    pointLightPosition: 'u_PointLightPosition',
    pointLightColor: 'u_PointLightColor',
    pointLightIntensity: 'u_PointLightIntensity',
    pointLightRange: 'u_PointLightRange',
    spotLightCount: 'u_SpotLightCount',
    spotLightPosition: 'u_SpotLightPosition',
    spotLightDirection: 'u_SpotLightDirection',
    spotLightColor: 'u_SpotLightColor',
    spotLightIntensity: 'u_SpotLightIntensity',
    spotLightRange: 'u_SpotLightRange',
    spotLightInnerConeCosine: 'u_SpotLightInnerConeCosine',
    spotLightOuterConeCosine: 'u_SpotLightOuterConeCosine',
    localLightCount: 'u_LocalLightCount',
    localLightKind: 'u_LocalLightKind',
    localLightPosition: 'u_LocalLightPosition',
    localLightDirection: 'u_LocalLightDirection',
    localLightColor: 'u_LocalLightColor',
    localLightIntensity: 'u_LocalLightIntensity',
    localLightRange: 'u_LocalLightRange',
    localLightInnerConeCosine: 'u_LocalLightInnerConeCosine',
    localLightOuterConeCosine: 'u_LocalLightOuterConeCosine',
});

const createLightingUniformProperties = (
    capacity: Readonly<LightingCapacity>
): readonly LightingUniformProperty[] => {
    return Object.freeze([
        { name: NAMES.ambientLight, type: 'vec3', scope: 'frame' },
        { name: NAMES.skyLight, type: 'vec3', scope: 'frame' },
        { name: NAMES.groundLight, type: 'vec3', scope: 'frame' },
        { name: NAMES.exposure, type: 'float', scope: 'frame' },
        { name: NAMES.gamma, type: 'float', scope: 'frame' },
        { name: NAMES.directionalLightCount, type: 'int', scope: 'frame' },
        {
            name: NAMES.directionalLightDirection,
            type: 'vec3',
            scope: 'frame',
            arrayLength: capacity.maxDirectionalLights,
        },
        {
            name: NAMES.directionalLightColor,
            type: 'vec3',
            scope: 'frame',
            arrayLength: capacity.maxDirectionalLights,
        },
        {
            name: NAMES.directionalLightAmbientColor,
            type: 'vec3',
            scope: 'frame',
            arrayLength: capacity.maxDirectionalLights,
        },
        {
            name: NAMES.directionalLightIntensity,
            type: 'float',
            scope: 'frame',
            arrayLength: capacity.maxDirectionalLights,
        },
        { name: NAMES.pointLightCount, type: 'int', scope: 'frame' },
        {
            name: NAMES.pointLightPosition,
            type: 'vec3',
            scope: 'frame',
            arrayLength: capacity.maxPointLights,
        },
        {
            name: NAMES.pointLightColor,
            type: 'vec3',
            scope: 'frame',
            arrayLength: capacity.maxPointLights,
        },
        {
            name: NAMES.pointLightIntensity,
            type: 'float',
            scope: 'frame',
            arrayLength: capacity.maxPointLights,
        },
        {
            name: NAMES.pointLightRange,
            type: 'float',
            scope: 'frame',
            arrayLength: capacity.maxPointLights,
        },
        { name: NAMES.spotLightCount, type: 'int', scope: 'frame' },
        {
            name: NAMES.spotLightPosition,
            type: 'vec3',
            scope: 'frame',
            arrayLength: capacity.maxSpotLights,
        },
        {
            name: NAMES.spotLightDirection,
            type: 'vec3',
            scope: 'frame',
            arrayLength: capacity.maxSpotLights,
        },
        {
            name: NAMES.spotLightColor,
            type: 'vec3',
            scope: 'frame',
            arrayLength: capacity.maxSpotLights,
        },
        {
            name: NAMES.spotLightIntensity,
            type: 'float',
            scope: 'frame',
            arrayLength: capacity.maxSpotLights,
        },
        {
            name: NAMES.spotLightRange,
            type: 'float',
            scope: 'frame',
            arrayLength: capacity.maxSpotLights,
        },
        {
            name: NAMES.spotLightInnerConeCosine,
            type: 'float',
            scope: 'frame',
            arrayLength: capacity.maxSpotLights,
        },
        {
            name: NAMES.spotLightOuterConeCosine,
            type: 'float',
            scope: 'frame',
            arrayLength: capacity.maxSpotLights,
        },
        { name: NAMES.localLightCount, type: 'int', scope: 'frame' },
        {
            name: NAMES.localLightKind,
            type: 'int',
            scope: 'frame',
            arrayLength: capacity.maxLocalLights,
        },
        {
            name: NAMES.localLightPosition,
            type: 'vec3',
            scope: 'frame',
            arrayLength: capacity.maxLocalLights,
        },
        {
            name: NAMES.localLightDirection,
            type: 'vec3',
            scope: 'frame',
            arrayLength: capacity.maxLocalLights,
        },
        {
            name: NAMES.localLightColor,
            type: 'vec3',
            scope: 'frame',
            arrayLength: capacity.maxLocalLights,
        },
        {
            name: NAMES.localLightIntensity,
            type: 'float',
            scope: 'frame',
            arrayLength: capacity.maxLocalLights,
        },
        {
            name: NAMES.localLightRange,
            type: 'float',
            scope: 'frame',
            arrayLength: capacity.maxLocalLights,
        },
        {
            name: NAMES.localLightInnerConeCosine,
            type: 'float',
            scope: 'frame',
            arrayLength: capacity.maxLocalLights,
        },
        {
            name: NAMES.localLightOuterConeCosine,
            type: 'float',
            scope: 'frame',
            arrayLength: capacity.maxLocalLights,
        },
    ]);
};

export const createLightingUniformLayout = (
    capacity: Partial<LightingCapacity> = {}
): LightingUniformLayout => {
    const resolvedCapacity = resolveLightingCapacity(capacity);

    return Object.freeze({
        capacity: resolvedCapacity,
        names: NAMES,
        defines: Object.freeze({
            AXRONE_LIGHTING_MAX_DIRECTIONAL_LIGHTS: String(resolvedCapacity.maxDirectionalLights),
            AXRONE_LIGHTING_MAX_POINT_LIGHTS: String(resolvedCapacity.maxPointLights),
            AXRONE_LIGHTING_MAX_SPOT_LIGHTS: String(resolvedCapacity.maxSpotLights),
            AXRONE_LIGHTING_MAX_LOCAL_LIGHTS: String(resolvedCapacity.maxLocalLights),
        }),
        properties: createLightingUniformProperties(resolvedCapacity),
    });
};

export const createLightingUniformValueMap = (
    state: LightingSelectionState
): LightingUniformValueMap => {
    return {
        u_AmbientLight: state.environment.ambient,
        u_SkyLight: state.environment.sky,
        u_GroundLight: state.environment.ground,
        u_Exposure: state.environment.exposure,
        u_Gamma: state.environment.gamma,
        u_DirectionalLightCount: state.stats.selectedDirectionalCount,
        u_DirectionalLightDirection: state.directionalDirections,
        u_DirectionalLightColor: state.directionalColors,
        u_DirectionalLightAmbientColor: state.directionalAmbientColors,
        u_DirectionalLightIntensity: state.directionalIntensities,
        u_PointLightCount: state.stats.selectedPointCount,
        u_PointLightPosition: state.pointPositions,
        u_PointLightColor: state.pointColors,
        u_PointLightIntensity: state.pointIntensities,
        u_PointLightRange: state.pointRanges,
        u_SpotLightCount: state.stats.selectedSpotCount,
        u_SpotLightPosition: state.spotPositions,
        u_SpotLightDirection: state.spotDirections,
        u_SpotLightColor: state.spotColors,
        u_SpotLightIntensity: state.spotIntensities,
        u_SpotLightRange: state.spotRanges,
        u_SpotLightInnerConeCosine: state.spotInnerConeCosines,
        u_SpotLightOuterConeCosine: state.spotOuterConeCosines,
        u_LocalLightCount: state.stats.selectedLocalLightCount,
        u_LocalLightKind: state.localLightKinds,
        u_LocalLightPosition: state.localLightPositions,
        u_LocalLightDirection: state.localLightDirections,
        u_LocalLightColor: state.localLightColors,
        u_LocalLightIntensity: state.localLightIntensities,
        u_LocalLightRange: state.localLightRanges,
        u_LocalLightInnerConeCosine: state.localLightInnerConeCosines,
        u_LocalLightOuterConeCosine: state.localLightOuterConeCosines,
    };
};