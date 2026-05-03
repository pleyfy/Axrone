import { Vec3 } from '@axrone/numeric';
import type { JsonValue, ReadonlyTuple3 } from '@axrone/utility';
import { LightKind, LightKinds, LightSortMode } from './constants';
import type {
    DirectionalLightDefinition,
    LightDefinition,
    LightingDocument,
    LightingMetadata,
    PointLightDefinition,
    SerializedLight,
    SpotLightDefinition,
} from './types';

const isFiniteNumber = (value: unknown): value is number =>
    typeof value === 'number' && Number.isFinite(value);

const isObjectRecord = (value: unknown): value is Record<string, unknown> => {
    return typeof value === 'object' && value !== null;
};

const isJsonValue = (value: unknown): value is JsonValue => {
    if (
        value === null ||
        typeof value === 'string' ||
        (typeof value === 'number' && Number.isFinite(value)) ||
        typeof value === 'boolean'
    ) {
        return true;
    }

    if (Array.isArray(value)) {
        return value.every(isJsonValue);
    }

    if (!isObjectRecord(value)) {
        return false;
    }

    return Object.values(value).every(isJsonValue);
};

export const isReadonlyTuple3 = (value: unknown): value is ReadonlyTuple3<number> => {
    return Array.isArray(value) && value.length === 3 && value.every(isFiniteNumber);
};

export const isLightingMetadata = (value: unknown): value is LightingMetadata => {
    return isObjectRecord(value) && Object.values(value).every(isJsonValue);
};

export const isLightKind = (value: unknown): value is LightDefinition['kind'] => {
    return typeof value === 'string' && (LightKinds as readonly string[]).includes(value);
};

export const isLightSortMode = (value: unknown): value is typeof LightSortMode[keyof typeof LightSortMode] => {
    return typeof value === 'string' && Object.values(LightSortMode).includes(value as never);
};

export const isDirectionalLightDefinition = (
    value: unknown
): value is DirectionalLightDefinition => {
    if (!isObjectRecord(value)) {
        return false;
    }

    return (
        value.kind === LightKind.Directional &&
        typeof value.id === 'string' &&
        typeof value.enabled === 'boolean' &&
        value.color instanceof Vec3 &&
        isFiniteNumber(value.intensity) &&
        isFiniteNumber(value.priority) &&
        value.direction instanceof Vec3 &&
        value.ambient instanceof Vec3 &&
        (value.metadata === undefined || isLightingMetadata(value.metadata))
    );
};

export const isPointLightDefinition = (value: unknown): value is PointLightDefinition => {
    if (!isObjectRecord(value)) {
        return false;
    }

    return (
        value.kind === LightKind.Point &&
        typeof value.id === 'string' &&
        typeof value.enabled === 'boolean' &&
        value.color instanceof Vec3 &&
        isFiniteNumber(value.intensity) &&
        isFiniteNumber(value.priority) &&
        value.position instanceof Vec3 &&
        isFiniteNumber(value.range) &&
        isFiniteNumber(value.attenuation) &&
        (value.metadata === undefined || isLightingMetadata(value.metadata))
    );
};

export const isSpotLightDefinition = (value: unknown): value is SpotLightDefinition => {
    if (!isObjectRecord(value)) {
        return false;
    }

    return (
        value.kind === LightKind.Spot &&
        typeof value.id === 'string' &&
        typeof value.enabled === 'boolean' &&
        value.color instanceof Vec3 &&
        isFiniteNumber(value.intensity) &&
        isFiniteNumber(value.priority) &&
        value.position instanceof Vec3 &&
        value.direction instanceof Vec3 &&
        isFiniteNumber(value.range) &&
        isFiniteNumber(value.attenuation) &&
        isFiniteNumber(value.innerConeCosine) &&
        isFiniteNumber(value.outerConeCosine) &&
        (value.metadata === undefined || isLightingMetadata(value.metadata))
    );
};

export const isLightDefinition = (value: unknown): value is LightDefinition => {
    return (
        isDirectionalLightDefinition(value) ||
        isPointLightDefinition(value) ||
        isSpotLightDefinition(value)
    );
};

export const isSerializedLight = (value: unknown): value is SerializedLight => {
    if (!isObjectRecord(value) || !isLightKind(value.kind)) {
        return false;
    }

    if (value.id !== undefined && typeof value.id !== 'string') {
        return false;
    }

    if (value.color !== undefined && !isReadonlyTuple3(value.color)) {
        return false;
    }

    if (value.intensity !== undefined && !isFiniteNumber(value.intensity)) {
        return false;
    }

    if (value.priority !== undefined && !isFiniteNumber(value.priority)) {
        return false;
    }

    if (value.metadata !== undefined && !isLightingMetadata(value.metadata)) {
        return false;
    }

    switch (value.kind) {
        case LightKind.Directional:
            return (
                (value.direction === undefined || isReadonlyTuple3(value.direction)) &&
                (value.ambient === undefined || isReadonlyTuple3(value.ambient))
            );
        case LightKind.Point:
            return (
                (value.position === undefined || isReadonlyTuple3(value.position)) &&
                (value.range === undefined || isFiniteNumber(value.range)) &&
                (value.attenuation === undefined || isFiniteNumber(value.attenuation))
            );
        case LightKind.Spot:
            return (
                (value.position === undefined || isReadonlyTuple3(value.position)) &&
                (value.direction === undefined || isReadonlyTuple3(value.direction)) &&
                (value.range === undefined || isFiniteNumber(value.range)) &&
                (value.attenuation === undefined || isFiniteNumber(value.attenuation)) &&
                (value.innerConeCosine === undefined || isFiniteNumber(value.innerConeCosine)) &&
                (value.outerConeCosine === undefined || isFiniteNumber(value.outerConeCosine))
            );
    }
};

export const isLightingDocument = (value: unknown): value is LightingDocument => {
    if (!isObjectRecord(value)) {
        return false;
    }

    if (value.version !== undefined && !isFiniteNumber(value.version)) {
        return false;
    }

    if (value.rigId !== undefined && typeof value.rigId !== 'string') {
        return false;
    }

    if (value.environment !== undefined) {
        if (!isObjectRecord(value.environment)) {
            return false;
        }

        const environment = value.environment;

        if (environment.ambient !== undefined && !isReadonlyTuple3(environment.ambient)) {
            return false;
        }

        if (environment.sky !== undefined && !isReadonlyTuple3(environment.sky)) {
            return false;
        }

        if (environment.ground !== undefined && !isReadonlyTuple3(environment.ground)) {
            return false;
        }

        if (environment.exposure !== undefined && !isFiniteNumber(environment.exposure)) {
            return false;
        }

        if (environment.gamma !== undefined && !isFiniteNumber(environment.gamma)) {
            return false;
        }
    }

    if (value.lights !== undefined) {
        if (!Array.isArray(value.lights)) {
            return false;
        }

        if (!value.lights.every(isSerializedLight)) {
            return false;
        }
    }

    return true;
};