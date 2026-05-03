import { Vec3 } from '@axrone/numeric';
import { describe, expect, it } from 'vitest';
import { LightSortMode } from '../constants';
import { LightingDisposedError } from '../errors';
import { LightingFrameResolver } from '../frame-resolver';
import { LightingRig } from '../rig';
import {
    createLightingUniformLayout,
    createLightingUniformValueMap,
} from '../uniform-layout';

describe('LightingFrameResolver', () => {
    it('preserves insertion order under none sort and exposes uniform layout metadata', () => {
        const rig = new LightingRig();

        rig.addPoint({
            id: 'first',
            position: [0, 0, 10],
            range: 20,
            intensity: 1,
        });
        rig.addPoint({
            id: 'second',
            position: [0, 0, 1],
            range: 20,
            intensity: 50,
        });

        const resolver = new LightingFrameResolver({
            capacity: {
                maxDirectionalLights: 0,
                maxPointLights: 1,
                maxSpotLights: 0,
                maxLocalLights: 1,
            },
            sortMode: LightSortMode.None,
        });
        const state = resolver.resolve(rig, {
            cameraPosition: [0, 0, 0],
        });
        const uniforms = createLightingUniformValueMap(state);
        const layout = createLightingUniformLayout({
            maxDirectionalLights: 0,
            maxPointLights: 1,
            maxSpotLights: 0,
            maxLocalLights: 1,
        });

        expect(Array.from(state.pointPositions)).toEqual([0, 0, 10]);
        expect(state.stats.selectedPointCount).toBe(1);
        expect(state.stats.omittedPointCount).toBe(1);
        expect(layout.defines.AXRONE_LIGHTING_MAX_LOCAL_LIGHTS).toBe('1');
        expect(uniforms.u_PointLightCount).toBe(1);
        expect(uniforms.u_LocalLightCount).toBe(1);
    });

    it('ranks priority mode deterministically and uses insertion order as a tie-breaker', () => {
        const rig = new LightingRig();

        rig.addPoint({
            id: 'first',
            position: [1, 0, 0],
            range: 10,
            intensity: 1,
            priority: 2,
        });
        rig.addPoint({
            id: 'second',
            position: [2, 0, 0],
            range: 10,
            intensity: 1,
            priority: 2,
        });
        rig.addPoint({
            id: 'winner',
            position: [3, 0, 0],
            range: 10,
            intensity: 1,
            priority: 3,
        });

        const state = new LightingFrameResolver({
            capacity: {
                maxDirectionalLights: 0,
                maxPointLights: 2,
                maxSpotLights: 0,
                maxLocalLights: 2,
            },
            sortMode: LightSortMode.Priority,
        }).resolve(rig);

        expect(Array.from(state.pointPositions)).toEqual([3, 0, 0, 1, 0, 0]);
        expect(Array.from(state.localLightKinds)).toEqual([1, 1]);
    });

    it('changes point influence when camera context is present', () => {
        const rig = new LightingRig();

        rig.addPoint({
            id: 'far-strong',
            position: [0, 0, 20],
            range: 4,
            intensity: 11,
        });
        rig.addPoint({
            id: 'near-weak',
            position: [0, 0, 1],
            range: 10,
            intensity: 1,
        });

        const resolver = new LightingFrameResolver({
            capacity: {
                maxDirectionalLights: 0,
                maxPointLights: 1,
                maxSpotLights: 0,
                maxLocalLights: 1,
            },
            sortMode: LightSortMode.Influence,
        });

        const withoutCameraPositions = Array.from(resolver.resolve(rig).pointPositions);
        const withTuplePositions = Array.from(
            resolver.resolve(rig, {
                cameraPosition: [0, 0, 0],
            }).pointPositions
        );
        const withVecState = resolver.resolve(rig, {
            cameraPosition: new Vec3(0, 0, 0),
        });
        const withVecPositions = Array.from(withVecState.pointPositions);
        const cachedState = resolver.resolve(rig, {
            cameraPosition: new Vec3(0, 0, 0),
        });

        expect(withoutCameraPositions).toEqual([0, 0, 20]);
        expect(withTuplePositions).toEqual([0, 0, 1]);
        expect(withVecPositions).toEqual([0, 0, 1]);
        expect(cachedState).toBe(withVecState);
    });

    it('suppresses spot influence outside the cone and re-enables it at the light position', () => {
        const rig = new LightingRig();

        rig.addPoint({
            id: 'point',
            position: [0, 0, 1],
            range: 10,
            intensity: 1,
        });
        rig.addSpot({
            id: 'spot',
            position: [0, 0, 5],
            direction: [0, 1, 0],
            range: 10,
            intensity: 20,
            coneMode: 'cosine',
            innerConeCosine: 0.95,
            outerConeCosine: 0.8,
        });

        const resolver = new LightingFrameResolver({
            capacity: {
                maxDirectionalLights: 0,
                maxPointLights: 1,
                maxSpotLights: 1,
                maxLocalLights: 1,
            },
            sortMode: LightSortMode.Influence,
        });

        const outsideConeKinds = Array.from(
            resolver.resolve(rig, {
                cameraPosition: [0, 0, 0],
            }).localLightKinds
        );
        const atLightKinds = Array.from(
            resolver.resolve(rig, {
                cameraPosition: [0, 0, 5],
            }).localLightKinds
        );

        expect(outsideConeKinds).toEqual([1]);
        expect(atLightKinds).toEqual([2]);
    });

    it('supports zero-capacity resolvers and disposal boundaries', () => {
        const rig = new LightingRig();

        rig.addDirectional({
            direction: [0, -1, 0],
        });

        const resolver = new LightingFrameResolver({
            capacity: {
                maxDirectionalLights: 0,
                maxPointLights: 0,
                maxSpotLights: 0,
                maxLocalLights: 0,
            },
        });
        const state = resolver.resolve(rig);

        expect(resolver.capacity.maxLocalLights).toBe(0);
        expect(resolver.isDisposed).toBe(false);
        expect(state.stats.selectedDirectionalCount).toBe(0);
        expect(state.stats.omittedDirectionalCount).toBe(1);

        resolver.dispose();
        expect(resolver.isDisposed).toBe(true);

        resolver.dispose();
        expect(() => resolver.resolve(rig)).toThrow(LightingDisposedError);
    });
});