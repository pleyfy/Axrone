import { LightKind, LightingDocumentVersion } from './constants';
import { LightingSerializationError } from './errors';
import { isLightKind, isSerializedLight } from './guards';
import { LightingRig } from './rig';
import type {
    LightingDocument,
    LightingIssue,
    SerializedDirectionalLight,
    SerializedLight,
    SerializedPointLight,
    SerializedSpotLight,
} from './types';
import { serializeVec3 } from './validation';

export interface LightingParseSuccess {
    readonly ok: true;
    readonly value: LightingRig;
    readonly issues: readonly LightingIssue[];
}

export interface LightingParseFailure {
    readonly ok: false;
    readonly issues: readonly LightingIssue[];
}

export type LightingParseResult = LightingParseSuccess | LightingParseFailure;

const isObjectRecord = (value: unknown): value is Record<string, unknown> => {
    return typeof value === 'object' && value !== null;
};

const isTuple3 = (value: unknown): value is readonly [number, number, number] => {
    return (
        Array.isArray(value) &&
        value.length === 3 &&
        value.every((entry) => typeof entry === 'number' && Number.isFinite(entry))
    );
};

const pushIssue = (
    issues: LightingIssue[],
    path: string,
    code: LightingIssue['code'],
    message: string
): void => {
    issues.push(Object.freeze({ code, path, message }));
};

const serializeLight = (light: ReturnType<LightingRig['list']>[number]): SerializedLight => {
    switch (light.kind) {
        case LightKind.Directional:
            return Object.freeze({
                id: String(light.id),
                kind: light.kind,
                enabled: light.enabled,
                color: serializeVec3(light.color),
                intensity: light.intensity,
                priority: light.priority,
                metadata: light.metadata,
                direction: serializeVec3(light.direction),
                ambient: serializeVec3(light.ambient),
            } satisfies SerializedDirectionalLight);
        case LightKind.Point:
            return Object.freeze({
                id: String(light.id),
                kind: light.kind,
                enabled: light.enabled,
                color: serializeVec3(light.color),
                intensity: light.intensity,
                priority: light.priority,
                metadata: light.metadata,
                position: serializeVec3(light.position),
                range: light.range,
                attenuation: light.attenuation,
            } satisfies SerializedPointLight);
        case LightKind.Spot:
            return Object.freeze({
                id: String(light.id),
                kind: light.kind,
                enabled: light.enabled,
                color: serializeVec3(light.color),
                intensity: light.intensity,
                priority: light.priority,
                metadata: light.metadata,
                position: serializeVec3(light.position),
                direction: serializeVec3(light.direction),
                range: light.range,
                attenuation: light.attenuation,
                innerConeCosine: light.innerConeCosine,
                outerConeCosine: light.outerConeCosine,
            } satisfies SerializedSpotLight);
    }
};

export const serializeLightingRig = (rig: LightingRig): LightingDocument => {
    return Object.freeze({
        version: LightingDocumentVersion,
        rigId: String(rig.id),
        environment: Object.freeze({
            ambient: serializeVec3(rig.environment.ambient),
            sky: serializeVec3(rig.environment.sky),
            ground: serializeVec3(rig.environment.ground),
            exposure: rig.environment.exposure,
            gamma: rig.environment.gamma,
        }),
        lights: Object.freeze(rig.list().map(serializeLight)),
    });
};

export const safeDeserializeLightingRig = (input: unknown): LightingParseResult => {
    const issues: LightingIssue[] = [];

    if (!isObjectRecord(input)) {
        pushIssue(issues, '$', 'lighting.parse.document', 'Lighting documents must be objects');
        return { ok: false, issues: Object.freeze(issues) };
    }

    if (input.version !== undefined) {
        if (typeof input.version !== 'number' || !Number.isFinite(input.version)) {
            pushIssue(issues, '$.version', 'lighting.parse.version', 'version must be a finite number');
        } else if (input.version !== LightingDocumentVersion) {
            pushIssue(
                issues,
                '$.version',
                'lighting.parse.version',
                `Unsupported lighting document version: ${input.version}`
            );
        }
    }

    if (input.rigId !== undefined && typeof input.rigId !== 'string') {
        pushIssue(issues, '$.rigId', 'lighting.parse.rig-id', 'rigId must be a string');
    }

    if (input.environment !== undefined && !isObjectRecord(input.environment)) {
        pushIssue(issues, '$.environment', 'lighting.parse.environment', 'environment must be an object');
    }

    const environment = isObjectRecord(input.environment) ? input.environment : undefined;
    const rig = new LightingRig({
        id: typeof input.rigId === 'string' ? input.rigId : undefined,
        environment: environment
            ? {
                  ambient: isTuple3(environment.ambient) ? environment.ambient : undefined,
                  sky: isTuple3(environment.sky) ? environment.sky : undefined,
                  ground: isTuple3(environment.ground) ? environment.ground : undefined,
                  exposure:
                      typeof environment.exposure === 'number' && Number.isFinite(environment.exposure)
                          ? environment.exposure
                          : undefined,
                  gamma:
                      typeof environment.gamma === 'number' && Number.isFinite(environment.gamma)
                          ? environment.gamma
                          : undefined,
              }
            : undefined,
    });

    if (environment) {
        if (environment.ambient !== undefined && !isTuple3(environment.ambient)) {
            pushIssue(issues, '$.environment.ambient', 'lighting.parse.vector', 'ambient must be a 3-number tuple');
        }
        if (environment.sky !== undefined && !isTuple3(environment.sky)) {
            pushIssue(issues, '$.environment.sky', 'lighting.parse.vector', 'sky must be a 3-number tuple');
        }
        if (environment.ground !== undefined && !isTuple3(environment.ground)) {
            pushIssue(issues, '$.environment.ground', 'lighting.parse.vector', 'ground must be a 3-number tuple');
        }
        if (
            environment.exposure !== undefined &&
            !(typeof environment.exposure === 'number' && Number.isFinite(environment.exposure))
        ) {
            pushIssue(issues, '$.environment.exposure', 'lighting.parse.number', 'exposure must be a finite number');
        }
        if (
            environment.gamma !== undefined &&
            !(typeof environment.gamma === 'number' && Number.isFinite(environment.gamma))
        ) {
            pushIssue(issues, '$.environment.gamma', 'lighting.parse.number', 'gamma must be a finite number');
        }
    }

    if (input.lights === undefined) {
        return { ok: true, value: rig, issues: Object.freeze(issues) };
    }

    if (!Array.isArray(input.lights)) {
        pushIssue(issues, '$.lights', 'lighting.parse.lights', 'lights must be an array');
        return { ok: true, value: rig, issues: Object.freeze(issues) };
    }

    input.lights.forEach((value, index) => {
        const basePath = `$.lights[${index}]`;

        if (!isObjectRecord(value)) {
            pushIssue(issues, basePath, 'lighting.parse.light', 'light entries must be objects');
            return;
        }

        if (!isLightKind(value.kind)) {
            pushIssue(issues, `${basePath}.kind`, 'lighting.parse.kind', 'light kind must be directional, point, or spot');
            return;
        }

        if (!isSerializedLight(value)) {
            pushIssue(issues, basePath, 'lighting.parse.light', 'light entry contains invalid field types');
            return;
        }

        try {
            switch (value.kind) {
                case LightKind.Directional:
                    rig.addDirectional({
                        id: value.id,
                        enabled: value.enabled,
                        color: value.color,
                        intensity: value.intensity,
                        priority: value.priority,
                        metadata: value.metadata,
                        direction: value.direction,
                        ambient: value.ambient,
                    });
                    break;
                case LightKind.Point:
                    rig.addPoint({
                        id: value.id,
                        enabled: value.enabled,
                        color: value.color,
                        intensity: value.intensity,
                        priority: value.priority,
                        metadata: value.metadata,
                        position: value.position,
                        range: value.range,
                        attenuation: value.attenuation,
                    });
                    break;
                case LightKind.Spot:
                    rig.addSpot({
                        id: value.id,
                        enabled: value.enabled,
                        color: value.color,
                        intensity: value.intensity,
                        priority: value.priority,
                        metadata: value.metadata,
                        position: value.position,
                        direction: value.direction,
                        range: value.range,
                        attenuation: value.attenuation,
                        coneMode: 'cosine',
                        innerConeCosine: value.innerConeCosine,
                        outerConeCosine: value.outerConeCosine,
                    });
                    break;
            }
        } catch (error) {
            pushIssue(
                issues,
                basePath,
                'lighting.parse.light',
                error instanceof Error ? error.message : 'Failed to deserialize light'
            );
        }
    });

    return { ok: true, value: rig, issues: Object.freeze(issues) };
};

export const deserializeLightingRig = (input: unknown): LightingRig => {
    const result = safeDeserializeLightingRig(input);

    if (!result.ok) {
        throw new LightingSerializationError('lighting.serialize.document', 'Unable to deserialize lighting document', {
            issueCount: result.issues.length,
            issues: result.issues,
        });
    }

    if (result.issues.length > 0) {
        throw new LightingSerializationError('lighting.serialize.partial', 'Lighting document contains invalid entries', {
            issueCount: result.issues.length,
            issues: result.issues,
        });
    }

    return result.value;
};