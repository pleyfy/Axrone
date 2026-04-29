import { Actor, Transform, World } from '@axrone/ecs-runtime';
import { Vec3 } from '@axrone/numeric';
import { describe, expect, it } from 'vitest';
import { DirectionalLight } from '../components/directional-light';
import { PointLight } from '../components/point-light';
import { SpotLight } from '../components/spot-light';
import { SceneLightingCollector } from '../lighting-collector';
import { createSceneRegistry } from '../scene-registry';

const createWorld = (): World => new World(createSceneRegistry());

describe('SceneLightingCollector', () => {
    it('preserves the legacy lighting surface while reusing cached local-light views', () => {
        const world = createWorld();
        const collector = new SceneLightingCollector(4);

        const directionalActor = new Actor(world);
        directionalActor.addComponent(DirectionalLight, {
            color: [0.8, 0.7, 0.6],
            ambientColor: [0.05, 0.04, 0.03],
            intensity: 2,
            primary: true,
        });

        const pointActor = new Actor(world);
        pointActor.addComponent(PointLight, {
            color: [1, 0.5, 0.25],
            intensity: 3,
            range: 9,
        });
        pointActor.requireComponent(Transform).position = new Vec3(1, 2, 3);

        const spotActor = new Actor(world);
        spotActor.addComponent(SpotLight, {
            color: [0.2, 0.4, 1],
            intensity: 8,
            range: 18,
            innerConeAngle: 0.15,
            outerConeAngle: 0.5,
        });
        spotActor.requireComponent(Transform).position = new Vec3(-1, 5, 2);

        const first = collector.collect(
            world.getAllActors(),
            new Vec3(0.1, 0.2, 0.3),
            Vec3.ZERO,
            Vec3.ZERO,
            new Vec3(0, 2, 0)
        );
        const second = collector.collect(
            world.getAllActors(),
            new Vec3(0.1, 0.2, 0.3),
            Vec3.ZERO,
            Vec3.ZERO,
            new Vec3(0, 2, 0)
        );

        expect(second).toBe(first);
        expect(second.localLightPositions).toBe(first.localLightPositions);
        expect(second.localLightTypes).toBe(first.localLightTypes);
        expect(second.ambient.x).toBeCloseTo(0.15);
        expect(second.ambient.y).toBeCloseTo(0.24);
        expect(second.ambient.z).toBeCloseTo(0.33);
        expect(second.pointCount).toBe(1);
        expect(second.spotCount).toBe(1);
        expect(second.localLightCount).toBe(2);
        expect([...second.localLightTypes.slice(0, 2)].sort((left, right) => left - right)).toEqual([0, 1]);
        expect(second.pointLightRange).toBe(9);
        expect(second.spotLightOuterCone).toBeCloseTo(0.5);
    });

    it('prefers primary directional lights over fallback directional lights', () => {
        const world = createWorld();
        const collector = new SceneLightingCollector(4);

        const fallback = new Actor(world);
        fallback.addComponent(DirectionalLight, {
            color: [1, 0, 0],
            intensity: 1,
            primary: false,
        });

        const primary = new Actor(world);
        primary.addComponent(DirectionalLight, {
            color: [0, 1, 0],
            intensity: 4,
            primary: true,
        });

        const lighting = collector.collect(world.getAllActors(), Vec3.ZERO);

        expect(lighting.hasDirectional).toBe(true);
        expect(lighting.directionalColor.x).toBe(0);
        expect(lighting.directionalColor.y).toBe(1);
        expect(lighting.directionalIntensity).toBe(4);
    });

    it('uses camera influence when choosing local lights for the legacy render path', () => {
        const world = createWorld();
        const collector = new SceneLightingCollector(1);

        const farPointActor = new Actor(world);
        farPointActor.addComponent(PointLight, {
            color: [1, 0, 0],
            intensity: 8,
            range: 5,
        });
        farPointActor.requireComponent(Transform).position = new Vec3(20, 0, 0);

        const nearPointActor = new Actor(world);
        nearPointActor.addComponent(PointLight, {
            color: [0, 1, 0],
            intensity: 2,
            range: 8,
        });
        nearPointActor.requireComponent(Transform).position = new Vec3(1, 0, 0);

        const lighting = collector.collect(world.getAllActors(), Vec3.ZERO, Vec3.ZERO, Vec3.ZERO, Vec3.ZERO);

        expect(lighting.localLightCount).toBe(1);
        expect([...lighting.localLightPositions.slice(0, 3)]).toEqual([1, 0, 0]);
        expect(lighting.pointCount).toBe(1);
        expect(lighting.pointLightColor.x).toBe(0);
        expect(lighting.pointLightColor.y).toBe(1);
    });

    it('keeps legacy spot cone angles and removes stale lights when components disable', () => {
        const world = createWorld();
        const collector = new SceneLightingCollector(2);

        const spotActor = new Actor(world);
        const spotLight = spotActor.addComponent(SpotLight, {
            color: [0.25, 0.5, 1],
            intensity: 6,
            range: 12,
            innerConeAngle: 0.2,
            outerConeAngle: 0.6,
        });
        spotActor.requireComponent(Transform).position = new Vec3(4, 0, 0);

        const first = collector.collect(world.getAllActors(), Vec3.ZERO);

        expect(first.localLightCount).toBe(1);
        expect(first.localLightTypes[0]).toBe(1);
        expect(first.localLightInnerCones[0]).toBeCloseTo(0.2);
        expect(first.localLightOuterCones[0]).toBeCloseTo(0.6);
        expect(first.spotLightInnerCone).toBeCloseTo(0.2);
        expect(first.spotLightOuterCone).toBeCloseTo(0.6);

        spotLight.enabled = false;

        const second = collector.collect(world.getAllActors(), Vec3.ZERO);

        expect(second.localLightCount).toBe(0);
        expect(second.spotCount).toBe(0);
        expect(second.spotLightIntensity).toBe(0);
        expect(second.spotLightOuterCone).toBe(0);
    });
});