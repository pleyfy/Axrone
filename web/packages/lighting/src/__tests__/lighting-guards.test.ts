import { describe, expect, it } from 'vitest';
import { LightKind, LightSortMode } from '../constants';
import {
    isDirectionalLightDefinition,
    isLightDefinition,
    isLightKind,
    isLightingDocument,
    isLightingMetadata,
    isLightSortMode,
    isPointLightDefinition,
    isReadonlyTuple3,
    isSerializedLight,
    isSpotLightDefinition,
} from '../guards';
import {
    createDirectionalLightDefinition,
    createPointLightDefinition,
    createSpotLightDefinition,
} from '../validation';

describe('lighting guards', () => {
    it('validates primitive discriminators, tuples, and metadata', () => {
        expect(isReadonlyTuple3([1, 2, 3])).toBe(true);
        expect(isReadonlyTuple3([1, 2])).toBe(false);
        expect(isLightKind(LightKind.Point)).toBe(true);
        expect(isLightKind('area')).toBe(false);
        expect(isLightSortMode(LightSortMode.Priority)).toBe(true);
        expect(isLightSortMode('custom')).toBe(false);
        expect(
            isLightingMetadata({
                enabled: true,
                nested: {
                    tags: ['a'],
                },
            })
        ).toBe(true);
        expect(
            isLightingMetadata({
                invalid: () => true,
            })
        ).toBe(false);
    });

    it('validates concrete light definitions', () => {
        const directional = createDirectionalLightDefinition(
            {
                direction: [0, -1, 0],
            },
            'directional'
        );
        const point = createPointLightDefinition(
            {
                position: [1, 2, 3],
                range: 4,
            },
            'point'
        );
        const spot = createSpotLightDefinition(
            {
                direction: [0, -1, 0],
                coneMode: 'cosine',
                innerConeCosine: 0.9,
                outerConeCosine: 0.7,
            },
            'spot'
        );

        expect(isDirectionalLightDefinition(directional)).toBe(true);
        expect(isPointLightDefinition(point)).toBe(true);
        expect(isSpotLightDefinition(spot)).toBe(true);
        expect(isLightDefinition(directional)).toBe(true);
        expect(
            isLightDefinition({
                kind: LightKind.Point,
                id: 'broken',
            })
        ).toBe(false);
    });

    it('validates serialized lights and documents', () => {
        const serializedSpot = {
            kind: LightKind.Spot,
            id: 'spot',
            position: [1, 2, 3],
            direction: [0, -1, 0],
            range: 4,
            attenuation: 2,
            innerConeCosine: 0.9,
            outerConeCosine: 0.7,
        } as const;

        expect(isSerializedLight(serializedSpot)).toBe(true);
        expect(
            isSerializedLight({
                kind: LightKind.Point,
                range: 'broken',
            })
        ).toBe(false);
        expect(
            isLightingDocument({
                version: 1,
                rigId: 'rig',
                environment: {
                    ambient: [0.1, 0.2, 0.3],
                },
                lights: [serializedSpot],
            })
        ).toBe(true);
        expect(
            isLightingDocument({
                version: 'broken',
            })
        ).toBe(false);
        expect(
            isLightingDocument({
                environment: 'broken',
            })
        ).toBe(false);
    });
});