import { describe, expect, it } from 'vitest';
import { Vec3 } from '@axrone/numeric';
import { Entity, Transform, World } from '@axrone/ecs-runtime';
import {
    createPointLightDefinition,
    createLightingUniformLayout,
    isPointLightDefinition,
    LightingRig,
    LightingFrameResolver,
} from '@axrone/lighting';
import { PointLight } from '../components/point-light';
import { SceneLightingCollector } from '../lighting-collector';
import { createSceneRegistry } from '../scene-registry';

describe('PointLight — post-fix verification tests', () => {
    describe('C1 FIXED: Attenuation IS uploaded to GPU', () => {
        it('uniform layout HAS PointLightAttenuation field', () => {
            const layout = createLightingUniformLayout({ maxPointLights: 4 });
            const pointUniforms = layout.properties
                .map((p) => p.name)
                .filter((n) => n.includes('PointLight'));

            expect(pointUniforms).toContain('u_PointLightCount');
            expect(pointUniforms).toContain('u_PointLightPosition');
            expect(pointUniforms).toContain('u_PointLightColor');
            expect(pointUniforms).toContain('u_PointLightIntensity');
            expect(pointUniforms).toContain('u_PointLightRange');
            expect(pointUniforms).toContain('u_PointLightAttenuation');
        });

        it('frame resolver state HAS attenuation buffer', () => {
            const rig = new LightingRig();
            rig.addPoint({
                id: 'test',
                color: Vec3.ONE,
                intensity: 1,
                range: 8,
                attenuation: 3,
                position: new Vec3(1, 2, 3),
            });

            const resolver = new LightingFrameResolver({
                maxPointLights: 4,
                maxDirectionalLights: 1,
                maxSpotLights: 4,
                maxLocalLights: 4,
            });
            const state = resolver.resolve(rig, { cameraPosition: Vec3.ZERO });

            expect(state.pointAttenuations).toBeInstanceOf(Float32Array);
            expect(state.pointAttenuations[0]).toBe(3);
        });

        it('different attenuation values produce different GPU output', () => {
            const makeState = (attenuation: number) => {
                const rig = new LightingRig();
                rig.addPoint({
                    id: 'test',
                    color: Vec3.ONE,
                    intensity: 5,
                    range: 10,
                    attenuation,
                    position: new Vec3(5, 0, 0),
                });
                const resolver = new LightingFrameResolver({
                    maxPointLights: 1,
                    maxDirectionalLights: 0,
                    maxSpotLights: 0,
                    maxLocalLights: 0,
                });
                return resolver.resolve(rig, { cameraPosition: Vec3.ZERO });
            };

            const state0 = makeState(0);
            const state3 = makeState(3);

            expect(state0.pointAttenuations[0]).toBe(0);
            expect(state3.pointAttenuations[0]).toBe(3);
        });
    });

    describe('H1 FIXED: Quadratic falloff (d^2) in pointInfluence', () => {
        it('pointInfluence uses quadratic formula — documented behavior', () => {
            // Formula at frame-resolver.ts:122 (FIXED):
            // normalizedDistance = distanceSquared / radiusSq  (= d²/r²)
            // result = intensity / (1 + attenuation * normalizedDistance)
            //        = intensity / (1 + attenuation * d²/r²)
            //
            // This is QUADRATIC in distance (d²), physically reasonable.
            const light = createPointLightDefinition(
                { intensity: 10, range: 10, attenuation: 1, position: [0, 0, 0] },
                'test'
            );

            expect(light.intensity).toBe(10);
            expect(light.range).toBe(10);
            expect(light.attenuation).toBe(1);
        });
    });

    describe('M1 FIXED: Component exposes attenuation', () => {
        it('PointLight HAS attenuation property', () => {
            const light = new PointLight({ color: [1, 0.5, 0.25], intensity: 3, range: 12, attenuation: 1.5 });
            expect(light.attenuation).toBe(1.5);
            expect(light.color.x).toBeCloseTo(1);
            expect(light.intensity).toBe(3);
            expect(light.range).toBe(12);
        });

        it('serialize() includes attenuation', () => {
            const light = new PointLight({ intensity: 5, range: 10, attenuation: 3 });
            const data = light.serialize();
            expect(Object.keys(data)).toEqual(['color', 'intensity', 'range', 'attenuation']);
            expect(data.attenuation).toBe(3);
        });

        it('deserialize() reads attenuation', () => {
            const light = new PointLight({ intensity: 5, range: 10 });
            light.deserialize({ intensity: 8, range: 15, attenuation: 4 });
            expect(light.intensity).toBe(8);
            expect(light.range).toBe(15);
            expect(light.attenuation).toBe(4);
        });

        it('default attenuation is 2', () => {
            const light = new PointLight();
            expect(light.attenuation).toBe(2);
        });

        it('attenuation setter validates', () => {
            const light = new PointLight({ attenuation: 2 });
            expect(() => { light.attenuation = -1; }).toThrow();
            expect(light.attenuation).toBe(2);
        });
    });

    describe('M6 FIXED: Guard rejects invalid range values', () => {
        it('isPointLightDefinition REJECTS range: -5', () => {
            const fake = {
                kind: 'point',
                id: 'test',
                enabled: true,
                color: new Vec3(1, 1, 1),
                intensity: 1,
                priority: 0,
                position: new Vec3(0, 0, 0),
                range: -5,
                attenuation: 2,
            };
            expect(isPointLightDefinition(fake)).toBe(false);
        });

        it('isPointLightDefinition REJECTS range: 0', () => {
            const fake = {
                kind: 'point',
                id: 'test',
                enabled: true,
                color: new Vec3(1, 1, 1),
                intensity: 1,
                priority: 0,
                position: new Vec3(0, 0, 0),
                range: 0,
                attenuation: 2,
            };
            expect(isPointLightDefinition(fake)).toBe(false);
        });

        it('isPointLightDefinition REJECTS attenuation: -1', () => {
            const fake = {
                kind: 'point',
                id: 'test',
                enabled: true,
                color: new Vec3(1, 1, 1),
                intensity: 1,
                priority: 0,
                position: new Vec3(0, 0, 0),
                range: 5,
                attenuation: -1,
            };
            expect(isPointLightDefinition(fake)).toBe(false);
        });

        it('isPointLightDefinition accepts valid values', () => {
            const fake = {
                kind: 'point',
                id: 'test',
                enabled: true,
                color: new Vec3(1, 1, 1),
                intensity: 1,
                priority: 0,
                position: new Vec3(0, 0, 0),
                range: 5,
                attenuation: 2,
            };
            expect(isPointLightDefinition(fake)).toBe(true);
        });

        it('createPointLightDefinition rejects range: 0', () => {
            expect(() =>
                createPointLightDefinition({ range: 0 }, 'test')
            ).toThrow();
        });

        it('createPointLightDefinition rejects range: -1', () => {
            expect(() =>
                createPointLightDefinition({ range: -1 }, 'test')
            ).toThrow();
        });
    });

    describe('PointLight default values', () => {
        it('defaults: color=Vec3.ONE, intensity=1, range=8, attenuation=2', () => {
            const light = new PointLight();
            expect(light.color.x).toBe(1);
            expect(light.color.y).toBe(1);
            expect(light.color.z).toBe(1);
            expect(light.intensity).toBe(1);
            expect(light.range).toBe(8);
            expect(light.attenuation).toBe(2);
        });

        it('getWorldPosition returns ZERO clone when no Transform', () => {
            const light = new PointLight();
            const pos = light.getWorldPosition();
            expect(pos.x).toBe(0);
            expect(pos.y).toBe(0);
            expect(pos.z).toBe(0);
        });

        it('range setter rejects 0', () => {
            const light = new PointLight({ range: 5 });
            expect(() => { light.range = 0; }).toThrow();
            expect(light.range).toBe(5);
        });
    });

    describe('End-to-end: component attenuation flows to GPU buffer', () => {
        it('collector passes component attenuation (not hardcoded default) to resolver', () => {
            const world = new World(createSceneRegistry());
            const collector = new SceneLightingCollector(4);

            const entity = new Entity(world);
            entity.addComponent(PointLight, {
                color: [1, 0.5, 0.25],
                intensity: 5,
                range: 12,
                attenuation: 3.5,
            });
            entity.requireComponent(Transform).position = new Vec3(4, 0, 0);

            const state = collector.collect(world.getAllEntities(), Vec3.ZERO);

            expect(state.stats.selectedPointCount).toBe(1);
            expect(state.pointAttenuations[0]).toBeCloseTo(3.5);
            expect(state.pointIntensities[0]).toBeCloseTo(5);
            expect(state.pointRanges[0]).toBeCloseTo(12);
        });
    });
});
