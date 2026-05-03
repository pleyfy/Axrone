import type { Vec3 } from '@axrone/numeric';
import type { JsonValue, ReadonlyTuple3 } from '@axrone/utility';
import type { LightId, LightingRigId, LightingVersion } from './brands';
import type { LightKind, LightSortMode, LightingDocumentVersion } from './constants';

export type Vec3Input = Readonly<Vec3> | ReadonlyTuple3<number>;
export type LightingMetadata = Readonly<Record<string, JsonValue>>;

export interface LightingEnvironment {
    readonly ambient: Readonly<Vec3>;
    readonly sky: Readonly<Vec3>;
    readonly ground: Readonly<Vec3>;
    readonly exposure: number;
    readonly gamma: number;
}

export interface LightingEnvironmentInput {
    readonly ambient?: Vec3Input;
    readonly sky?: Vec3Input;
    readonly ground?: Vec3Input;
    readonly exposure?: number;
    readonly gamma?: number;
}

export interface LightingCapacity {
    readonly maxDirectionalLights: number;
    readonly maxPointLights: number;
    readonly maxSpotLights: number;
    readonly maxLocalLights: number;
}

export interface LightingRigOptions {
    readonly id?: LightingRigId | string;
    readonly environment?: LightingEnvironmentInput;
}

export interface LightingFrameResolverOptions {
    readonly capacity?: Partial<LightingCapacity>;
    readonly sortMode?: LightSortMode;
}

export interface LightingSelectionOptions {
    readonly cameraPosition?: Vec3Input;
    readonly sortMode?: LightSortMode;
}

export interface BaseLightDefinition<K extends LightKind> {
    readonly id: LightId<K>;
    readonly kind: K;
    readonly enabled: boolean;
    readonly color: Readonly<Vec3>;
    readonly intensity: number;
    readonly priority: number;
    readonly metadata?: LightingMetadata;
}

export interface DirectionalLightDefinition extends BaseLightDefinition<'directional'> {
    readonly direction: Readonly<Vec3>;
    readonly ambient: Readonly<Vec3>;
}

export interface PointLightDefinition extends BaseLightDefinition<'point'> {
    readonly position: Readonly<Vec3>;
    readonly range: number;
    readonly attenuation: number;
}

export interface SpotLightDefinition extends BaseLightDefinition<'spot'> {
    readonly position: Readonly<Vec3>;
    readonly direction: Readonly<Vec3>;
    readonly range: number;
    readonly attenuation: number;
    readonly innerConeCosine: number;
    readonly outerConeCosine: number;
}

export interface BaseLightCreateInput<K extends LightKind> {
    readonly id?: LightId<K> | string;
    readonly enabled?: boolean;
    readonly color?: Vec3Input;
    readonly intensity?: number;
    readonly priority?: number;
    readonly metadata?: LightingMetadata | null;
}

export interface DirectionalLightCreateInput extends BaseLightCreateInput<'directional'> {
    readonly direction?: Vec3Input;
    readonly ambient?: Vec3Input;
}

export interface PointLightCreateInput extends BaseLightCreateInput<'point'> {
    readonly position?: Vec3Input;
    readonly range?: number;
    readonly attenuation?: number;
}

export type SpotLightConeInput =
    | {
          readonly coneMode?: 'angle';
          readonly innerConeAngle?: number;
          readonly outerConeAngle?: number;
          readonly innerConeCosine?: never;
          readonly outerConeCosine?: never;
      }
    | {
          readonly coneMode: 'cosine';
          readonly innerConeCosine?: number;
          readonly outerConeCosine?: number;
          readonly innerConeAngle?: never;
          readonly outerConeAngle?: never;
      };

export type SpotLightCreateInput = BaseLightCreateInput<'spot'> & {
    readonly position?: Vec3Input;
    readonly direction?: Vec3Input;
    readonly range?: number;
    readonly attenuation?: number;
} & SpotLightConeInput;

export interface BaseLightPatch {
    readonly enabled?: boolean;
    readonly color?: Vec3Input;
    readonly intensity?: number;
    readonly priority?: number;
    readonly metadata?: LightingMetadata | null;
}

export interface DirectionalLightPatch extends BaseLightPatch {
    readonly direction?: Vec3Input;
    readonly ambient?: Vec3Input;
}

export interface PointLightPatch extends BaseLightPatch {
    readonly position?: Vec3Input;
    readonly range?: number;
    readonly attenuation?: number;
}

export type SpotLightPatch = BaseLightPatch & {
    readonly position?: Vec3Input;
    readonly direction?: Vec3Input;
    readonly range?: number;
    readonly attenuation?: number;
} & SpotLightConeInput;

export interface LightDefinitionMap {
    readonly directional: DirectionalLightDefinition;
    readonly point: PointLightDefinition;
    readonly spot: SpotLightDefinition;
}

export interface LightCreateInputMap {
    readonly directional: DirectionalLightCreateInput;
    readonly point: PointLightCreateInput;
    readonly spot: SpotLightCreateInput;
}

export interface LightPatchMap {
    readonly directional: DirectionalLightPatch;
    readonly point: PointLightPatch;
    readonly spot: SpotLightPatch;
}

export type LightDefinition<K extends LightKind = LightKind> = LightDefinitionMap[K];
export type LightCreateInput<K extends LightKind = LightKind> = LightCreateInputMap[K];
export type LightPatch<K extends LightKind = LightKind> = LightPatchMap[K];

export interface LightingSelectionStats {
    readonly totalLightCount: number;
    readonly totalDirectionalCount: number;
    readonly totalPointCount: number;
    readonly totalSpotCount: number;
    readonly selectedDirectionalCount: number;
    readonly selectedPointCount: number;
    readonly selectedSpotCount: number;
    readonly selectedLocalLightCount: number;
    readonly omittedDirectionalCount: number;
    readonly omittedPointCount: number;
    readonly omittedSpotCount: number;
    readonly omittedLocalLightCount: number;
}

export interface LightingSelectionState {
    readonly rigId: LightingRigId;
    readonly version: LightingVersion;
    readonly sortMode: LightSortMode;
    readonly capacity: LightingCapacity;
    readonly environment: LightingEnvironment;
    readonly stats: LightingSelectionStats;
    readonly directionalDirections: Float32Array;
    readonly directionalColors: Float32Array;
    readonly directionalAmbientColors: Float32Array;
    readonly directionalIntensities: Float32Array;
    readonly pointPositions: Float32Array;
    readonly pointColors: Float32Array;
    readonly pointIntensities: Float32Array;
    readonly pointRanges: Float32Array;
    readonly spotPositions: Float32Array;
    readonly spotDirections: Float32Array;
    readonly spotColors: Float32Array;
    readonly spotIntensities: Float32Array;
    readonly spotRanges: Float32Array;
    readonly spotInnerConeCosines: Float32Array;
    readonly spotOuterConeCosines: Float32Array;
    readonly localLightKinds: Int32Array;
    readonly localLightPositions: Float32Array;
    readonly localLightDirections: Float32Array;
    readonly localLightColors: Float32Array;
    readonly localLightIntensities: Float32Array;
    readonly localLightRanges: Float32Array;
    readonly localLightInnerConeCosines: Float32Array;
    readonly localLightOuterConeCosines: Float32Array;
}

export interface SerializedLightingEnvironment {
    readonly ambient?: ReadonlyTuple3<number>;
    readonly sky?: ReadonlyTuple3<number>;
    readonly ground?: ReadonlyTuple3<number>;
    readonly exposure?: number;
    readonly gamma?: number;
}

export interface SerializedBaseLight<K extends LightKind> {
    readonly id?: string;
    readonly kind: K;
    readonly enabled?: boolean;
    readonly color?: ReadonlyTuple3<number>;
    readonly intensity?: number;
    readonly priority?: number;
    readonly metadata?: LightingMetadata;
}

export interface SerializedDirectionalLight extends SerializedBaseLight<'directional'> {
    readonly direction?: ReadonlyTuple3<number>;
    readonly ambient?: ReadonlyTuple3<number>;
}

export interface SerializedPointLight extends SerializedBaseLight<'point'> {
    readonly position?: ReadonlyTuple3<number>;
    readonly range?: number;
    readonly attenuation?: number;
}

export type SerializedSpotLight = SerializedBaseLight<'spot'> & {
    readonly position?: ReadonlyTuple3<number>;
    readonly direction?: ReadonlyTuple3<number>;
    readonly range?: number;
    readonly attenuation?: number;
    readonly innerConeCosine?: number;
    readonly outerConeCosine?: number;
};

export type SerializedLight =
    | SerializedDirectionalLight
    | SerializedPointLight
    | SerializedSpotLight;

export interface LightingDocument {
    readonly version?: LightingDocumentVersion | number;
    readonly rigId?: string;
    readonly environment?: SerializedLightingEnvironment;
    readonly lights?: readonly SerializedLight[];
}

export interface LightingIssue {
    readonly code: `lighting.parse.${string}`;
    readonly path: string;
    readonly message: string;
}