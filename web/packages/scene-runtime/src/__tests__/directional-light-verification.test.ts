import { Entity, Transform, World } from '@axrone/ecs-runtime';
import { Quat, Vec3 } from '@axrone/numeric';
import { describe, expect, it } from 'vitest';
import { DirectionalLight } from '../components/directional-light';
import { PointLight } from '../components/point-light';
import { SpotLight } from '../components/spot-light';
import { AreaLight } from '../components/area-light';
import { SceneLightingCollector } from '../lighting-collector';
import { createSceneRegistry } from '../scene-registry';

const createWorld = (): World => new World(createSceneRegistry());

describe('DirectionalLight — verification tests for reported bugs', () => {
    describe('getDirection() safety', () => {
        it('returns fallback (0,-1,0) when no Transform is attached', () => {
            const light = new DirectionalLight();
            const dir = light.getDirection();
            expect(dir.x).toBe(0);
            expect(dir.y).toBe(-1);
            expect(dir.z).toBe(0);
        });

        it('returns Vec3.FORWARD (0,0,1) with identity rotation', () => {
            const world = createWorld();
            const entity = new Entity(world);
            const light = entity.addComponent(DirectionalLight, {});
            entity.requireComponent(Transform);

            const dir = light.getDirection();
            // Vec3.FORWARD = (0, 0, 1) in this engine
            expect(dir.x).toBeCloseTo(0);
            expect(dir.y).toBeCloseTo(0);
            expect(dir.z).toBeCloseTo(1);
        });

        it('rotates direction correctly with 90-degree Y rotation', () => {
            const world = createWorld();
            const entity = new Entity(world);
            const light = entity.addComponent(DirectionalLight, {});
            const transform = entity.requireComponent(Transform);
            transform.rotation = Quat.fromEuler(0, 90, 0, new Quat());

            const dir = light.getDirection();
            // Verify it's a unit vector
            expect(Vec3.len(dir)).toBeCloseTo(1, 4);
            // Verify direction changed from default FORWARD (0,0,1)
            expect(Math.abs(dir.z - 1)).toBeGreaterThan(0.1);
        });

        it('throws Error (not NaN) on degenerate zero-length quaternion', () => {
            const world = createWorld();
            const entity = new Entity(world);
            const light = entity.addComponent(DirectionalLight, {});
            const transform = entity.requireComponent(Transform);
            (transform as any)._rotation = new Quat(0, 0, 0, 0);
            (transform as any)._worldDirty = true;

            // Throws from updateWorldState before reaching Vec3.normalize
            expect(() => light.getDirection()).toThrow();
        });
    });

    describe('serialization round-trip fidelity', () => {
        it('preserves all fields through serialize/deserialize', () => {
            const light = new DirectionalLight({
                color: [0.8, 0.6, 0.4],
                ambientColor: [0.05, 0.04, 0.03],
                intensity: 3.5,
                primary: true,
            });

            const serialized = light.serialize();
            const restored = new DirectionalLight();
            restored.deserialize(serialized);

            expect(restored.color.x).toBeCloseTo(0.8);
            expect(restored.color.y).toBeCloseTo(0.6);
            expect(restored.color.z).toBeCloseTo(0.4);
            expect(restored.ambientColor.x).toBeCloseTo(0.05);
            expect(restored.ambientColor.y).toBeCloseTo(0.04);
            expect(restored.ambientColor.z).toBeCloseTo(0.03);
            expect(restored.intensity).toBe(3.5);
            expect(restored.primary).toBe(true);
        });

        it('preserves defaults through serialize/deserialize with empty data', () => {
            const light = new DirectionalLight();
            const serialized = light.serialize();

            expect(serialized.color).toEqual([1, 1, 1]);
            expect(serialized.ambientColor).toEqual([
                expect.closeTo(0.06, 5),
                expect.closeTo(0.06, 5),
                expect.closeTo(0.08, 5),
            ]);
            expect(serialized.intensity).toBe(1);
            expect(serialized.primary).toBe(false);
        });

        it('ignores invalid fields during deserialization without throwing', () => {
            const light = new DirectionalLight({ intensity: 5 });
            light.deserialize({ color: 'not-an-array', intensity: 'bad' });
            expect(light.intensity).toBe(5);
        });
    });

    describe('ambient color default mismatch (M1)', () => {
        it('scene-runtime component defaults ambient to (0.06, 0.06, 0.08)', () => {
            const light = new DirectionalLight();
            expect(light.ambientColor.x).toBeCloseTo(0.06);
            expect(light.ambientColor.y).toBeCloseTo(0.06);
            expect(light.ambientColor.z).toBeCloseTo(0.08);
        });
    });

    describe('primary field — consumed by collector as priority', () => {
        it('primary=true gives priority=1000000, beating higher-intensity non-primary', () => {
            const world = createWorld();
            const collector = new SceneLightingCollector(4);

            const highIntensity = new Entity(world);
            highIntensity.addComponent(DirectionalLight, {
                color: [1, 0, 0],
                intensity: 10,
                primary: false,
            });

            const lowIntensityPrimary = new Entity(world);
            lowIntensityPrimary.addComponent(DirectionalLight, {
                color: [0, 1, 0],
                intensity: 1,
                primary: true,
            });

            const lighting = collector.collect(world.getAllEntities(), Vec3.ZERO);

            expect(lighting.stats.selectedDirectionalCount).toBe(1);
            // primary=true → priority=1000000 → score=1000000*1024+1=1024000001
            // primary=false → priority=0 → score=0*1024+10=10
            // primary light WINS despite lower intensity
            expect(lighting.directionalColors[0]).toBe(0); // green wins (primary)
            expect(lighting.directionalColors[1]).toBe(1);
            expect(lighting.directionalIntensities[0]).toBe(1);
        });
    });

    describe('collector coexisting light types', () => {
        it('collects both PointLight and SpotLight when they coexist on the same entity', () => {
            const world = createWorld();
            const collector = new SceneLightingCollector(4);

            const multiLightEntity = new Entity(world);
            multiLightEntity.addComponent(PointLight, {
                color: [1, 0, 0],
                intensity: 3,
                range: 5,
            });
            multiLightEntity.addComponent(SpotLight, {
                color: [0, 0, 1],
                intensity: 8,
                range: 12,
                innerConeAngle: 0.2,
                outerConeAngle: 0.6,
            });
            multiLightEntity.requireComponent(Transform).position = new Vec3(1, 0, 0);

            const lighting = collector.collect(world.getAllEntities(), Vec3.ZERO);

            // Both PointLight and SpotLight are collected from the same entity
            expect(lighting.stats.selectedPointCount).toBe(1);
            expect(lighting.stats.selectedSpotCount).toBe(1);
            expect(lighting.stats.selectedLocalLightCount).toBe(2);
        });

        it('collects SpotLight when no PointLight is on the same entity', () => {
            const world = createWorld();
            const collector = new SceneLightingCollector(4);

            const spotOnlyEntity = new Entity(world);
            spotOnlyEntity.addComponent(SpotLight, {
                color: [0, 0, 1],
                intensity: 8,
                range: 12,
                innerConeAngle: 0.2,
                outerConeAngle: 0.6,
            });
            spotOnlyEntity.requireComponent(Transform).position = new Vec3(1, 0, 0);

            const lighting = collector.collect(world.getAllEntities(), Vec3.ZERO);

            expect(lighting.stats.selectedSpotCount).toBe(1);
            expect(lighting.stats.selectedLocalLightCount).toBe(1);
        });
    });
});
