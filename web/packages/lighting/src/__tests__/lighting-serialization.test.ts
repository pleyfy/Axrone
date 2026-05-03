import { describe, expect, it } from 'vitest';
import { LightKind } from '../constants';
import { LightingSerializationError } from '../errors';
import { LightingRig } from '../rig';
import {
    deserializeLightingRig,
    safeDeserializeLightingRig,
    serializeLightingRig,
} from '../serialization';

describe('lighting serialization', () => {
    it('serializes empty rigs with canonical defaults', () => {
        const document = serializeLightingRig(
            new LightingRig({
                id: 'rig',
            })
        );

        expect(document.version).toBe(1);
        expect(document.rigId).toBe('rig');
        expect(document.environment).toEqual({
            ambient: [0.08, 0.08, 0.1],
            sky: [0.08, 0.09, 0.11],
            ground: [0.04, 0.04, 0.045],
            exposure: 1,
            gamma: 2.2,
        });
        expect(document.lights).toEqual([]);
    });

    it('round-trips rigs with all light kinds', () => {
        const rig = new LightingRig({
            id: 'roundtrip',
            environment: {
                ambient: [0.2, 0.1, 0.05],
                exposure: 1.4,
                gamma: 2.1,
            },
        });

        rig.addDirectional({
            id: 'sun',
            direction: [1, -1, 0],
            ambient: [0.01, 0.02, 0.03],
            metadata: {
                tags: ['key'],
            },
        });
        rig.addPoint({
            id: 'fill',
            position: [4, 5, 6],
            range: 9,
            attenuation: 3,
        });
        rig.addSpot({
            id: 'lamp',
            position: [1, 2, 3],
            direction: [0, -1, 0],
            range: 5,
            coneMode: 'cosine',
            innerConeCosine: 0.9,
            outerConeCosine: 0.7,
        });

        const parsed = deserializeLightingRig(serializeLightingRig(rig));

        expect(parsed.size).toBe(3);
        expect(parsed.environment.exposure).toBe(1.4);
        expect(parsed.environment.gamma).toBe(2.1);
        expect(parsed.get('sun')?.kind).toBe(LightKind.Directional);
        expect(parsed.get('fill')?.kind).toBe(LightKind.Point);
        expect(parsed.get('lamp')?.kind).toBe(LightKind.Spot);
    });

    it('reports malformed headers and entries without discarding valid lights', () => {
        const invalidHeaderResult = safeDeserializeLightingRig({
            version: 'broken',
            rigId: 42,
            environment: 'invalid',
            lights: [
                null,
                {
                    kind: LightKind.Directional,
                    id: 'sun',
                    direction: [0, -1, 0],
                },
                {
                    kind: 'unknown',
                },
                {
                    kind: LightKind.Point,
                    id: 'broken-point',
                    range: 'broken',
                },
                {
                    kind: LightKind.Spot,
                    id: 'broken-cone',
                    direction: [0, -1, 0],
                    innerConeCosine: 0.2,
                    outerConeCosine: 0.8,
                },
                {
                    kind: LightKind.Point,
                    id: 'sun',
                    range: 4,
                },
            ],
        });
        const unsupportedVersionResult = safeDeserializeLightingRig({
            version: 2,
        });

        expect(invalidHeaderResult.ok).toBe(true);
        expect(unsupportedVersionResult.ok).toBe(true);

        if (invalidHeaderResult.ok && unsupportedVersionResult.ok) {
            expect(invalidHeaderResult.value.size).toBe(1);
            expect(invalidHeaderResult.value.get('sun')?.kind).toBe(LightKind.Directional);
            expect(invalidHeaderResult.issues.map((issue) => issue.path)).toEqual(
                expect.arrayContaining([
                    '$.version',
                    '$.rigId',
                    '$.environment',
                    '$.lights[0]',
                    '$.lights[2].kind',
                    '$.lights[3]',
                    '$.lights[4]',
                    '$.lights[5]',
                ])
            );
            expect(
                unsupportedVersionResult.issues.map((issue) => issue.path)
            ).toContain('$.version');
        }
    });

    it('throws strict deserialization errors for invalid and partial documents', () => {
        expect(() => deserializeLightingRig(null)).toThrow(LightingSerializationError);

        let error: LightingSerializationError | null = null;

        try {
            deserializeLightingRig({
                lights: [
                    {
                        kind: LightKind.Point,
                        id: 'bad',
                        range: 'broken',
                    },
                ],
            });
        } catch (caught) {
            error = caught as LightingSerializationError;
        }

        expect(error).toBeInstanceOf(LightingSerializationError);
        expect(error?.code).toBe('lighting.serialize.partial');
        expect(error?.details?.issueCount).toBe(1);
    });
});