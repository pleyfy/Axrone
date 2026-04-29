import { Vec3 } from '@axrone/numeric';

export const LEGACY_LIGHTING_LOCAL_LIGHT_TYPES = Object.freeze({
    point: 0,
    spot: 1,
} as const);

export type LegacyLightingUniformField =
    | 'ReceiveLighting'
    | 'AmbientLight'
    | 'SkyLight'
    | 'GroundLight'
    | 'LightDirection'
    | 'LightColor'
    | 'LightIntensity'
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
    | 'SpotLightInnerCone'
    | 'SpotLightOuterCone'
    | 'LocalLightCount'
    | 'LocalLightType'
    | 'LocalLightPosition'
    | 'LocalLightDirection'
    | 'LocalLightColor'
    | 'LocalLightIntensity'
    | 'LocalLightRange'
    | 'LocalLightInnerCone'
    | 'LocalLightOuterCone';

export type LegacyLightingUniformName<
    TField extends LegacyLightingUniformField = LegacyLightingUniformField,
> = `u_${TField}`;

export type LegacyLightingUniformNames = {
    readonly [TField in LegacyLightingUniformField as Uncapitalize<TField>]: LegacyLightingUniformName<TField>;
};

export interface LegacyLightingUniformProperty {
    readonly name: LegacyLightingUniformName;
    readonly type: 'bool' | 'vec3' | 'float' | 'int';
    readonly scope: 'system' | 'frame';
    readonly arrayLength?: number;
}

export interface LegacyLightingUniformLayoutOptions {
    readonly maxLocalLights?: number;
}

export interface LegacyLightingUniformLayout {
    readonly maxLocalLights: number;
    readonly names: LegacyLightingUniformNames;
    readonly properties: readonly LegacyLightingUniformProperty[];
}

export interface LegacyLightingUniformSource {
    readonly ambient: Readonly<Vec3>;
    readonly skyLight: Readonly<Vec3>;
    readonly groundLight: Readonly<Vec3>;
    readonly hasDirectional: boolean;
    readonly directionalDirection: Readonly<Vec3>;
    readonly directionalColor: Readonly<Vec3>;
    readonly directionalIntensity: number;
    readonly pointLightPosition: Readonly<Vec3>;
    readonly pointLightColor: Readonly<Vec3>;
    readonly pointLightIntensity: number;
    readonly pointLightRange: number;
    readonly spotLightPosition: Readonly<Vec3>;
    readonly spotLightDirection: Readonly<Vec3>;
    readonly spotLightColor: Readonly<Vec3>;
    readonly spotLightIntensity: number;
    readonly spotLightRange: number;
    readonly spotLightInnerCone: number;
    readonly spotLightOuterCone: number;
    readonly pointCount: number;
    readonly spotCount: number;
    readonly localLightCount: number;
    readonly localLightTypes: Int32Array;
    readonly localLightPositions: Float32Array;
    readonly localLightDirections: Float32Array;
    readonly localLightColors: Float32Array;
    readonly localLightIntensities: Float32Array;
    readonly localLightRanges: Float32Array;
    readonly localLightInnerCones: Float32Array;
    readonly localLightOuterCones: Float32Array;
}

export type LegacyLightingUniformValue =
    | boolean
    | number
    | Readonly<Vec3>
    | Float32Array
    | Int32Array;

export type LegacyLightingUniformWriter = (
    name: LegacyLightingUniformName,
    value: LegacyLightingUniformValue
) => void;

const NAMES: LegacyLightingUniformNames = Object.freeze({
    receiveLighting: 'u_ReceiveLighting',
    ambientLight: 'u_AmbientLight',
    skyLight: 'u_SkyLight',
    groundLight: 'u_GroundLight',
    lightDirection: 'u_LightDirection',
    lightColor: 'u_LightColor',
    lightIntensity: 'u_LightIntensity',
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
    spotLightInnerCone: 'u_SpotLightInnerCone',
    spotLightOuterCone: 'u_SpotLightOuterCone',
    localLightCount: 'u_LocalLightCount',
    localLightType: 'u_LocalLightType',
    localLightPosition: 'u_LocalLightPosition',
    localLightDirection: 'u_LocalLightDirection',
    localLightColor: 'u_LocalLightColor',
    localLightIntensity: 'u_LocalLightIntensity',
    localLightRange: 'u_LocalLightRange',
    localLightInnerCone: 'u_LocalLightInnerCone',
    localLightOuterCone: 'u_LocalLightOuterCone',
});

const createLegacyLightingUniformProperties = (
    maxLocalLights: number
): readonly LegacyLightingUniformProperty[] =>
    Object.freeze([
        { name: NAMES.receiveLighting, type: 'bool', scope: 'system' },
        { name: NAMES.ambientLight, type: 'vec3', scope: 'frame' },
        { name: NAMES.skyLight, type: 'vec3', scope: 'frame' },
        { name: NAMES.groundLight, type: 'vec3', scope: 'frame' },
        { name: NAMES.lightDirection, type: 'vec3', scope: 'frame' },
        { name: NAMES.lightColor, type: 'vec3', scope: 'frame' },
        { name: NAMES.lightIntensity, type: 'float', scope: 'frame' },
        { name: NAMES.pointLightCount, type: 'int', scope: 'frame' },
        { name: NAMES.pointLightPosition, type: 'vec3', scope: 'frame' },
        { name: NAMES.pointLightColor, type: 'vec3', scope: 'frame' },
        { name: NAMES.pointLightIntensity, type: 'float', scope: 'frame' },
        { name: NAMES.pointLightRange, type: 'float', scope: 'frame' },
        { name: NAMES.spotLightCount, type: 'int', scope: 'frame' },
        { name: NAMES.spotLightPosition, type: 'vec3', scope: 'frame' },
        { name: NAMES.spotLightDirection, type: 'vec3', scope: 'frame' },
        { name: NAMES.spotLightColor, type: 'vec3', scope: 'frame' },
        { name: NAMES.spotLightIntensity, type: 'float', scope: 'frame' },
        { name: NAMES.spotLightRange, type: 'float', scope: 'frame' },
        { name: NAMES.spotLightInnerCone, type: 'float', scope: 'frame' },
        { name: NAMES.spotLightOuterCone, type: 'float', scope: 'frame' },
        { name: NAMES.localLightCount, type: 'int', scope: 'frame' },
        {
            name: NAMES.localLightType,
            type: 'int',
            scope: 'frame',
            arrayLength: maxLocalLights,
        },
        {
            name: NAMES.localLightPosition,
            type: 'vec3',
            scope: 'frame',
            arrayLength: maxLocalLights,
        },
        {
            name: NAMES.localLightDirection,
            type: 'vec3',
            scope: 'frame',
            arrayLength: maxLocalLights,
        },
        {
            name: NAMES.localLightColor,
            type: 'vec3',
            scope: 'frame',
            arrayLength: maxLocalLights,
        },
        {
            name: NAMES.localLightIntensity,
            type: 'float',
            scope: 'frame',
            arrayLength: maxLocalLights,
        },
        {
            name: NAMES.localLightRange,
            type: 'float',
            scope: 'frame',
            arrayLength: maxLocalLights,
        },
        {
            name: NAMES.localLightInnerCone,
            type: 'float',
            scope: 'frame',
            arrayLength: maxLocalLights,
        },
        {
            name: NAMES.localLightOuterCone,
            type: 'float',
            scope: 'frame',
            arrayLength: maxLocalLights,
        },
    ]);

export const createLegacyLightingUniformLayout = (
    options: LegacyLightingUniformLayoutOptions = {}
): LegacyLightingUniformLayout => {
    const maxLocalLights = Math.max(1, Math.trunc(options.maxLocalLights ?? 4));

    return Object.freeze({
        maxLocalLights,
        names: NAMES,
        properties: createLegacyLightingUniformProperties(maxLocalLights),
    });
};

export const writeLegacyLightingUniformValues = (
    source: LegacyLightingUniformSource,
    receiveLighting: boolean,
    write: LegacyLightingUniformWriter
): void => {
    write(NAMES.receiveLighting, receiveLighting);
    write(NAMES.ambientLight, receiveLighting ? source.ambient : Vec3.ZERO);
    write(NAMES.skyLight, receiveLighting ? source.skyLight : Vec3.ZERO);
    write(NAMES.groundLight, receiveLighting ? source.groundLight : Vec3.ZERO);
    write(NAMES.lightDirection, source.directionalDirection);
    write(
        NAMES.lightColor,
        receiveLighting && source.hasDirectional ? source.directionalColor : Vec3.ZERO
    );
    write(
        NAMES.lightIntensity,
        receiveLighting && source.hasDirectional ? source.directionalIntensity : 0
    );
    write(NAMES.pointLightCount, receiveLighting ? source.pointCount : 0);
    write(NAMES.pointLightPosition, source.pointLightPosition);
    write(
        NAMES.pointLightColor,
        receiveLighting && source.pointCount > 0 ? source.pointLightColor : Vec3.ZERO
    );
    write(
        NAMES.pointLightIntensity,
        receiveLighting && source.pointCount > 0 ? source.pointLightIntensity : 0
    );
    write(
        NAMES.pointLightRange,
        receiveLighting && source.pointCount > 0 ? source.pointLightRange : 0
    );
    write(NAMES.spotLightCount, receiveLighting ? source.spotCount : 0);
    write(NAMES.spotLightPosition, source.spotLightPosition);
    write(NAMES.spotLightDirection, source.spotLightDirection);
    write(
        NAMES.spotLightColor,
        receiveLighting && source.spotCount > 0 ? source.spotLightColor : Vec3.ZERO
    );
    write(
        NAMES.spotLightIntensity,
        receiveLighting && source.spotCount > 0 ? source.spotLightIntensity : 0
    );
    write(
        NAMES.spotLightRange,
        receiveLighting && source.spotCount > 0 ? source.spotLightRange : 0
    );
    write(
        NAMES.spotLightInnerCone,
        receiveLighting && source.spotCount > 0 ? source.spotLightInnerCone : 0
    );
    write(
        NAMES.spotLightOuterCone,
        receiveLighting && source.spotCount > 0 ? source.spotLightOuterCone : 0
    );
    write(NAMES.localLightCount, receiveLighting ? source.localLightCount : 0);
    write(NAMES.localLightType, source.localLightTypes);
    write(NAMES.localLightPosition, source.localLightPositions);
    write(NAMES.localLightDirection, source.localLightDirections);
    write(NAMES.localLightColor, source.localLightColors);
    write(NAMES.localLightIntensity, source.localLightIntensities);
    write(NAMES.localLightRange, source.localLightRanges);
    write(NAMES.localLightInnerCone, source.localLightInnerCones);
    write(NAMES.localLightOuterCone, source.localLightOuterCones);
};