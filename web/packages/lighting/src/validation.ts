import { Vec3 } from '@axrone/numeric';
import type { JsonValue, ReadonlyTuple3 } from '@axrone/utility';
import { brandLightId } from './brands';
import { LightKind } from './constants';
import { LightingValidationError } from './errors';
import type {
    DirectionalLightCreateInput,
    DirectionalLightDefinition,
    DirectionalLightPatch,
    LightCreateInput,
    LightDefinition,
    LightPatch,
    LightingCapacity,
    LightingEnvironment,
    LightingEnvironmentInput,
    LightingMetadata,
    PointLightCreateInput,
    PointLightDefinition,
    PointLightPatch,
    SpotLightCreateInput,
    SpotLightDefinition,
    SpotLightPatch,
    Vec3Input,
} from './types';

const DEFAULT_INNER_CONE_ANGLE = Math.PI / 8;
const DEFAULT_OUTER_CONE_ANGLE = Math.PI / 4;

const freezeVec3 = (x: number, y: number, z: number): Readonly<Vec3> =>
    Object.freeze(new Vec3(x, y, z));

const cloneJsonValue = (value: JsonValue): JsonValue => {
    if (value === null || typeof value !== 'object') {
        return value;
    }

    if (Array.isArray(value)) {
        return Object.freeze(value.map((entry) => cloneJsonValue(entry))) as JsonValue;
    }

    const clone: Record<string, JsonValue> = {};

    for (const [key, entry] of Object.entries(value)) {
        clone[key] = cloneJsonValue(entry);
    }

    return Object.freeze(clone) as JsonValue;
};

const cloneMetadata = (value: LightingMetadata | null | undefined): LightingMetadata | undefined => {
    if (value == null) {
        return undefined;
    }

    const clone: Record<string, JsonValue> = {};

    for (const [key, entry] of Object.entries(value)) {
        clone[key] = cloneJsonValue(entry);
    }

    return Object.freeze(clone);
};

const assertFiniteNumber = (
    label: string,
    value: number,
    minimum: number = -Infinity,
    maximum: number = Infinity,
    inclusiveMinimum: boolean = true,
    inclusiveMaximum: boolean = true
): number => {
    if (!Number.isFinite(value)) {
        throw new LightingValidationError('lighting.light.invalid-number', `${label} must be a finite number`, {
            label,
            value,
        });
    }

    if ((inclusiveMinimum ? value < minimum : value <= minimum) || (inclusiveMaximum ? value > maximum : value >= maximum)) {
        throw new LightingValidationError('lighting.light.out-of-range', `${label} is out of range`, {
            label,
            value,
            minimum,
            maximum,
        });
    }

    return value;
};

const assertInteger = (label: string, value: number, minimum: number = 0): number => {
    if (!Number.isInteger(value) || value < minimum) {
        throw new LightingValidationError('lighting.rig.invalid-capacity', `${label} must be an integer >= ${minimum}`, {
            label,
            value,
            minimum,
        });
    }

    return value;
};

const toVec3Components = (
    value: Vec3Input | undefined,
    fallback: Readonly<Vec3>
): readonly [number, number, number] => {
    if (value instanceof Vec3) {
        return [value.x, value.y, value.z];
    }

    if (Array.isArray(value)) {
        if (value.length !== 3) {
            throw new LightingValidationError('lighting.light.invalid-vector', 'Vec3 tuples must contain exactly three numbers', {
                value,
            });
        }

        return [value[0], value[1], value[2]];
    }

    return [fallback.x, fallback.y, fallback.z];
};

const toFrozenVec3 = (value: Vec3Input | undefined, fallback: Readonly<Vec3>): Readonly<Vec3> => {
    const [x, y, z] = toVec3Components(value, fallback);
    return freezeVec3(
        assertFiniteNumber('x', x),
        assertFiniteNumber('y', y),
        assertFiniteNumber('z', z)
    );
};

const toNormalizedDirection = (
    value: Vec3Input | undefined,
    fallback: Readonly<Vec3>
): Readonly<Vec3> => {
    const [x, y, z] = toVec3Components(value, fallback);
    const length = Math.hypot(x, y, z);

    if (!Number.isFinite(length) || length <= 1e-8) {
        throw new LightingValidationError('lighting.light.invalid-direction', 'Light direction must be a non-zero finite vector', {
            value,
        });
    }

    return freezeVec3(x / length, y / length, z / length);
};

const toSpotConeCosines = (
    input: SpotLightCreateInput | SpotLightPatch,
    fallbackInnerCosine: number,
    fallbackOuterCosine: number
): { readonly innerConeCosine: number; readonly outerConeCosine: number } => {
    const hasAngleInput = input.innerConeAngle !== undefined || input.outerConeAngle !== undefined;
    const hasCosineInput = input.innerConeCosine !== undefined || input.outerConeCosine !== undefined;
    const cosineMode = input.coneMode === 'cosine' || (input.coneMode === undefined && hasCosineInput && !hasAngleInput);

    if (cosineMode) {
        const innerConeCosine = assertFiniteNumber(
            'innerConeCosine',
            input.innerConeCosine ?? fallbackInnerCosine,
            0,
            1
        );
        const outerConeCosine = assertFiniteNumber(
            'outerConeCosine',
            input.outerConeCosine ?? fallbackOuterCosine,
            0,
            1
        );

        if (innerConeCosine < outerConeCosine) {
            throw new LightingValidationError('lighting.light.invalid-cone', 'innerConeCosine must be greater than or equal to outerConeCosine', {
                innerConeCosine,
                outerConeCosine,
            });
        }

        return { innerConeCosine, outerConeCosine };
    }

    const innerConeAngle = assertFiniteNumber(
        'innerConeAngle',
        input.innerConeAngle ?? Math.acos(Math.min(1, Math.max(0, fallbackInnerCosine))),
        0,
        Math.PI / 2
    );
    const outerConeAngle = assertFiniteNumber(
        'outerConeAngle',
        input.outerConeAngle ?? Math.acos(Math.min(1, Math.max(0, fallbackOuterCosine))),
        0,
        Math.PI / 2,
        false,
        true
    );

    if (innerConeAngle > outerConeAngle) {
        throw new LightingValidationError('lighting.light.invalid-cone', 'innerConeAngle must be less than or equal to outerConeAngle', {
            innerConeAngle,
            outerConeAngle,
        });
    }

    return {
        innerConeCosine: Math.cos(innerConeAngle),
        outerConeCosine: Math.cos(outerConeAngle),
    };
};

export const DEFAULT_LIGHTING_CAPACITY: Readonly<LightingCapacity> = Object.freeze({
    maxDirectionalLights: 1,
    maxPointLights: 8,
    maxSpotLights: 8,
    maxLocalLights: 12,
});

export const DEFAULT_LIGHTING_ENVIRONMENT: LightingEnvironment = Object.freeze({
    ambient: freezeVec3(0.08, 0.08, 0.1),
    sky: freezeVec3(0.08, 0.09, 0.11),
    ground: freezeVec3(0.04, 0.04, 0.045),
    exposure: 1,
    gamma: 2.2,
});

export const serializeVec3 = (value: Readonly<Vec3>): ReadonlyTuple3<number> => [
    value.x,
    value.y,
    value.z,
];

export const createLightingEnvironment = (
    input: LightingEnvironmentInput = {}
): LightingEnvironment => {
    const ambient = toFrozenVec3(input.ambient, DEFAULT_LIGHTING_ENVIRONMENT.ambient);
    const sky = toFrozenVec3(input.sky, DEFAULT_LIGHTING_ENVIRONMENT.sky);
    const ground = toFrozenVec3(input.ground, DEFAULT_LIGHTING_ENVIRONMENT.ground);
    const exposure = assertFiniteNumber('exposure', input.exposure ?? DEFAULT_LIGHTING_ENVIRONMENT.exposure, 0);
    const gamma = assertFiniteNumber('gamma', input.gamma ?? DEFAULT_LIGHTING_ENVIRONMENT.gamma, 0, Infinity, false);

    return Object.freeze({
        ambient,
        sky,
        ground,
        exposure,
        gamma,
    });
};

export const updateLightingEnvironment = (
    current: LightingEnvironment,
    patch: LightingEnvironmentInput
): LightingEnvironment => {
    return createLightingEnvironment({
        ambient: patch.ambient ?? current.ambient,
        sky: patch.sky ?? current.sky,
        ground: patch.ground ?? current.ground,
        exposure: patch.exposure ?? current.exposure,
        gamma: patch.gamma ?? current.gamma,
    });
};

export const resolveLightingCapacity = (
    input: Partial<LightingCapacity> = {}
): Readonly<LightingCapacity> => {
    const maxDirectionalLights = assertInteger(
        'maxDirectionalLights',
        input.maxDirectionalLights ?? DEFAULT_LIGHTING_CAPACITY.maxDirectionalLights,
        0
    );
    const maxPointLights = assertInteger(
        'maxPointLights',
        input.maxPointLights ?? DEFAULT_LIGHTING_CAPACITY.maxPointLights,
        0
    );
    const maxSpotLights = assertInteger(
        'maxSpotLights',
        input.maxSpotLights ?? DEFAULT_LIGHTING_CAPACITY.maxSpotLights,
        0
    );
    const maxLocalLights = Math.min(
        assertInteger(
            'maxLocalLights',
            input.maxLocalLights ?? DEFAULT_LIGHTING_CAPACITY.maxLocalLights,
            0
        ),
        maxPointLights + maxSpotLights
    );

    return Object.freeze({
        maxDirectionalLights,
        maxPointLights,
        maxSpotLights,
        maxLocalLights,
    });
};

const freezeDefinition = <TDefinition extends LightDefinition>(definition: TDefinition): TDefinition =>
    Object.freeze(definition);

export const createDirectionalLightDefinition = (
    input: DirectionalLightCreateInput,
    fallbackId: string
): DirectionalLightDefinition => {
    const id = brandLightId(
        LightKind.Directional,
        typeof input.id === 'string' ? input.id : fallbackId
    );

    return freezeDefinition({
        id,
        kind: LightKind.Directional,
        enabled: input.enabled ?? true,
        color: toFrozenVec3(input.color, Vec3.ONE),
        intensity: assertFiniteNumber('intensity', input.intensity ?? 1, 0),
        priority: assertFiniteNumber('priority', input.priority ?? 0),
        metadata: cloneMetadata(input.metadata),
        direction: toNormalizedDirection(input.direction, Vec3.DOWN),
        ambient: toFrozenVec3(input.ambient, Vec3.ZERO),
    });
};

export const createPointLightDefinition = (
    input: PointLightCreateInput,
    fallbackId: string
): PointLightDefinition => {
    const id = brandLightId(LightKind.Point, typeof input.id === 'string' ? input.id : fallbackId);

    return freezeDefinition({
        id,
        kind: LightKind.Point,
        enabled: input.enabled ?? true,
        color: toFrozenVec3(input.color, Vec3.ONE),
        intensity: assertFiniteNumber('intensity', input.intensity ?? 1, 0),
        priority: assertFiniteNumber('priority', input.priority ?? 0),
        metadata: cloneMetadata(input.metadata),
        position: toFrozenVec3(input.position, Vec3.ZERO),
        range: assertFiniteNumber('range', input.range ?? 8, 0, Infinity, false),
        attenuation: assertFiniteNumber('attenuation', input.attenuation ?? 2, 0),
    });
};

export const createSpotLightDefinition = (
    input: SpotLightCreateInput,
    fallbackId: string
): SpotLightDefinition => {
    const id = brandLightId(LightKind.Spot, typeof input.id === 'string' ? input.id : fallbackId);
    const cones = toSpotConeCosines(
        input,
        Math.cos(DEFAULT_INNER_CONE_ANGLE),
        Math.cos(DEFAULT_OUTER_CONE_ANGLE)
    );

    return freezeDefinition({
        id,
        kind: LightKind.Spot,
        enabled: input.enabled ?? true,
        color: toFrozenVec3(input.color, Vec3.ONE),
        intensity: assertFiniteNumber('intensity', input.intensity ?? 1, 0),
        priority: assertFiniteNumber('priority', input.priority ?? 0),
        metadata: cloneMetadata(input.metadata),
        position: toFrozenVec3(input.position, Vec3.ZERO),
        direction: toNormalizedDirection(input.direction, Vec3.DOWN),
        range: assertFiniteNumber('range', input.range ?? 8, 0, Infinity, false),
        attenuation: assertFiniteNumber('attenuation', input.attenuation ?? 2, 0),
        innerConeCosine: cones.innerConeCosine,
        outerConeCosine: cones.outerConeCosine,
    });
};

export const createLightDefinition = <K extends LightKind>(
    kind: K,
    input: LightCreateInput<K>,
    fallbackId: string
): LightDefinition<K> => {
    switch (kind) {
        case LightKind.Directional:
            return createDirectionalLightDefinition(
                input as DirectionalLightCreateInput,
                fallbackId
            ) as LightDefinition<K>;
        case LightKind.Point:
            return createPointLightDefinition(input as PointLightCreateInput, fallbackId) as LightDefinition<K>;
        case LightKind.Spot:
            return createSpotLightDefinition(input as SpotLightCreateInput, fallbackId) as LightDefinition<K>;
    }
};

export const applyDirectionalLightPatch = (
    definition: DirectionalLightDefinition,
    patch: DirectionalLightPatch
): DirectionalLightDefinition => {
    return createDirectionalLightDefinition(
        {
            id: definition.id,
            enabled: patch.enabled ?? definition.enabled,
            color: patch.color ?? definition.color,
            intensity: patch.intensity ?? definition.intensity,
            priority: patch.priority ?? definition.priority,
            metadata: patch.metadata === undefined ? definition.metadata ?? null : patch.metadata,
            direction: patch.direction ?? definition.direction,
            ambient: patch.ambient ?? definition.ambient,
        },
        String(definition.id)
    );
};

export const applyPointLightPatch = (
    definition: PointLightDefinition,
    patch: PointLightPatch
): PointLightDefinition => {
    return createPointLightDefinition(
        {
            id: definition.id,
            enabled: patch.enabled ?? definition.enabled,
            color: patch.color ?? definition.color,
            intensity: patch.intensity ?? definition.intensity,
            priority: patch.priority ?? definition.priority,
            metadata: patch.metadata === undefined ? definition.metadata ?? null : patch.metadata,
            position: patch.position ?? definition.position,
            range: patch.range ?? definition.range,
            attenuation: patch.attenuation ?? definition.attenuation,
        },
        String(definition.id)
    );
};

export const applySpotLightPatch = (
    definition: SpotLightDefinition,
    patch: SpotLightPatch
): SpotLightDefinition => {
    if (patch.coneMode === 'angle' || patch.innerConeAngle !== undefined || patch.outerConeAngle !== undefined) {
        return createSpotLightDefinition(
            {
                id: definition.id,
                enabled: patch.enabled ?? definition.enabled,
                color: patch.color ?? definition.color,
                intensity: patch.intensity ?? definition.intensity,
                priority: patch.priority ?? definition.priority,
                metadata: patch.metadata === undefined ? definition.metadata ?? null : patch.metadata,
                position: patch.position ?? definition.position,
                direction: patch.direction ?? definition.direction,
                range: patch.range ?? definition.range,
                attenuation: patch.attenuation ?? definition.attenuation,
                coneMode: 'angle',
                innerConeAngle: patch.innerConeAngle,
                outerConeAngle: patch.outerConeAngle,
            },
            String(definition.id)
        );
    }

    return createSpotLightDefinition(
        {
            id: definition.id,
            enabled: patch.enabled ?? definition.enabled,
            color: patch.color ?? definition.color,
            intensity: patch.intensity ?? definition.intensity,
            priority: patch.priority ?? definition.priority,
            metadata: patch.metadata === undefined ? definition.metadata ?? null : patch.metadata,
            position: patch.position ?? definition.position,
            direction: patch.direction ?? definition.direction,
            range: patch.range ?? definition.range,
            attenuation: patch.attenuation ?? definition.attenuation,
            coneMode: 'cosine',
            innerConeCosine: patch.innerConeCosine ?? definition.innerConeCosine,
            outerConeCosine: patch.outerConeCosine ?? definition.outerConeCosine,
        },
        String(definition.id)
    );
};

export const applyLightPatch = <K extends LightKind>(
    definition: LightDefinition<K>,
    patch: LightPatch<K>
): LightDefinition<K> => {
    switch (definition.kind) {
        case LightKind.Directional:
            return applyDirectionalLightPatch(
                definition as DirectionalLightDefinition,
                patch as DirectionalLightPatch
            ) as LightDefinition<K>;
        case LightKind.Point:
            return applyPointLightPatch(
                definition as PointLightDefinition,
                patch as PointLightPatch
            ) as LightDefinition<K>;
        case LightKind.Spot:
            return applySpotLightPatch(
                definition as SpotLightDefinition,
                patch as SpotLightPatch
            ) as LightDefinition<K>;
    }
};