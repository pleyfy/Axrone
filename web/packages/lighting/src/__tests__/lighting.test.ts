import { describe, expect, it } from 'vitest';
import { LightKind, LightSortMode } from '../constants';
import { LightingFrameResolver } from '../frame-resolver';
import { LightingRig } from '../rig';
import {
    deserializeLightingRig,
    safeDeserializeLightingRig,
    serializeLightingRig,
} from '../serialization';
import { createLightingUniformValueMap } from '../uniform-layout';

describe('lighting', () => {
    it('selects the highest influence lights into per-kind and local buffers', () => {
        const rig = new LightingRig();

        rig.addDirectional({
            direction: [0, -1, 0],
            ambient: [0.1, 0.1, 0.08],
            intensity: 2,
            color: [1, 0.9, 0.8],
        });
        rig.addPoint({
            id: 'near-red',
            position: [0, 0, 2],
            range: 6,
            intensity: 8,
            color: [1, 0, 0],
        });
        rig.addPoint({
            id: 'far-green',
            position: [0, 0, 9],
            range: 4,
            intensity: 8,
            color: [0, 1, 0],
        });
        rig.addSpot({
            id: 'near-blue',
            position: [0, 0, 1],
            direction: [0, 0, -1],
            range: 8,
            intensity: 6,
            color: [0, 0, 1],
            coneMode: 'angle',
            innerConeAngle: 0.1,
            outerConeAngle: 0.45,
        });

        const resolver = new LightingFrameResolver({
            capacity: {
                maxDirectionalLights: 1,
                maxPointLights: 1,
                maxSpotLights: 1,
                maxLocalLights: 2,
            },
            sortMode: LightSortMode.Influence,
        });
        const state = resolver.resolve(rig, { cameraPosition: [0, 0, 0] });
        const uniforms = createLightingUniformValueMap(state);

        expect(state.stats.selectedDirectionalCount).toBe(1);
        expect(state.stats.selectedPointCount).toBe(1);
        expect(state.stats.selectedSpotCount).toBe(1);
        expect(state.stats.selectedLocalLightCount).toBe(2);
        expect(Array.from(state.pointPositions)).toEqual([0, 0, 2]);
        expect(Array.from(state.localLightKinds)).toEqual([
            1,
            2,
        ]);
        expect(uniforms.u_PointLightCount).toBe(1);
        expect(uniforms.u_LocalLightCount).toBe(2);
        expect(Array.from(uniforms.u_SpotLightDirection)).toEqual([0, 0, -1]);
    });

    it('round-trips a serialized rig without losing canonical values', () => {
        const rig = new LightingRig({
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
            intensity: 3,
        });
        rig.addSpot({
            id: 'lamp',
            position: [1, 2, 3],
            direction: [0, -1, 0],
            range: 5,
            intensity: 2,
            coneMode: 'cosine',
            innerConeCosine: 0.9,
            outerConeCosine: 0.7,
        });

        const document = serializeLightingRig(rig);
        const parsed = deserializeLightingRig(document);
        const lamp = parsed.get('lamp');

        expect(parsed.size).toBe(2);
        expect(parsed.environment.exposure).toBe(1.4);
        expect(parsed.environment.gamma).toBe(2.1);
        expect(lamp?.kind).toBe(LightKind.Spot);

        if (lamp?.kind === LightKind.Spot) {
            expect(lamp.innerConeCosine).toBeCloseTo(0.9);
            expect(lamp.outerConeCosine).toBeCloseTo(0.7);
        }
    });

    it('safe deserialization keeps valid lights and reports malformed ones', () => {
        const result = safeDeserializeLightingRig({
            version: 1,
            lights: [
                {
                    kind: 'point',
                    id: 'ok',
                    position: [0, 0, 0],
                    range: 4,
                    intensity: 1,
                },
                {
                    kind: 'spot',
                    id: 'bad',
                    position: [0, 0, 0],
                    direction: [0, 0, -1],
                    range: 'broken',
                },
            ],
        });

        expect(result.ok).toBe(true);

        if (result.ok) {
            expect(result.value.size).toBe(1);
            expect(result.issues).toHaveLength(1);
            expect(result.value.get('ok')?.kind).toBe(LightKind.Point);
        }
    });

    it('rejects invalid updates', () => {
        const rig = new LightingRig();
        const light = rig.addPoint({ id: 'point', range: 5 });

        expect(() =>
            rig.update(light.id, {
                range: -1,
            })
        ).toThrow();
    });
});