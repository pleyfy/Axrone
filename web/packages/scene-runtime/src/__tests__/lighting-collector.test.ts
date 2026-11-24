import { Entity, Transform, World } from '@axrone/ecs-runtime';
import { Vec3 } from '@axrone/numeric';
import { describe, expect, it } from 'vitest';
import { DirectionalLight } from '../components/directional-light';
import { PointLight } from '../components/point-light';
import { SpotLight } from '../components/spot-light';
import { SceneLightingCollector } from '../lighting-collector';
import { createSceneRegistry } from '../scene-registry';

const createWorld = (): World => new World(createSceneRegistry());

describe('SceneLightingCollector', () => {
    it('reuses the cached modern lighting selection while preserving per-kind light buffers', () => {
        const world = createWorld();
        const collector = new SceneLightingCollector(4);

        const directionalEntity = new Entity(world);
        directionalEntity.addComponent(DirectionalLight, {
            color: [0.8, 0.7, 0.6],
            ambientColor: [0.05, 0.04, 0.03],
            intensity: 2,
            primary: true,
        });

        const pointEntity = new Entity(world);
        pointEntity.addComponent(PointLight, {
            color: [1, 0.5, 0.25],
            intensity: 3,
            range: 9,
        });
        pointEntity.requireComponent(Transform).position = new Vec3(1, 2, 3);

        const spotEntity = new Entity(world);
        spotEntity.addComponent(SpotLight, {
            color: [0.2, 0.4, 1],
            intensity: 8,
            range: 18,
            innerConeAngle: 0.15,
            outerConeAngle: 0.5,
        });
        spotEntity.requireComponent(Transform).position = new Vec3(-1, 5, 2);

        const first = collector.collect(
            world.getAllEntities(),
            new Vec3(0.1, 0.2, 0.3),
            Vec3.ZERO,
            Vec3.ZERO,
            new Vec3(0, 2, 0)
        );
        const second = collector.collect(
            world.getAllEntities(),
            new Vec3(0.1, 0.2, 0.3),
            Vec3.ZERO,
            Vec3.ZERO,
            new Vec3(0, 2, 0)
        );

        expect(second).toBe(first);
        expect(second.pointPositions).toBe(first.pointPositions);
        expect(second.localLightKinds).toBe(first.localLightKinds);
        expect(second.environment.ambient.x).toBeCloseTo(0.1);
        expect(second.environment.ambient.y).toBeCloseTo(0.2);
        expect(second.environment.ambient.z).toBeCloseTo(0.3);
        expect(second.stats.selectedDirectionalCount).toBe(1);
        expect(second.stats.selectedPointCount).toBe(1);
        expect(second.stats.selectedSpotCount).toBe(1);
        expect(second.stats.selectedLocalLightCount).toBe(2);
        expect(second.directionalAmbientColors[0]).toBeCloseTo(0.05);
        expect(second.directionalAmbientColors[1]).toBeCloseTo(0.04);
        expect(second.directionalAmbientColors[2]).toBeCloseTo(0.03);
        expect(second.pointRanges[0]).toBe(9);
        expect(second.spotOuterConeCosines[0]).toBeCloseTo(Math.cos(0.5));
    });

    it('prefers primary directional lights over fallback directional lights', () => {
        const world = createWorld();
        const collector = new SceneLightingCollector(4);

        const fallback = new Entity(world);
        fallback.addComponent(DirectionalLight, {
            color: [1, 0, 0],
            intensity: 1,
            primary: false,
        });

        const primary = new Entity(world);
        primary.addComponent(DirectionalLight, {
            color: [0, 1, 0],
            intensity: 4,
            primary: true,
        });

        const lighting = collector.collect(world.getAllEntities(), Vec3.ZERO);

        expect(lighting.stats.selectedDirectionalCount).toBe(1);
        expect(lighting.directionalColors[0]).toBe(0);
        expect(lighting.directionalColors[1]).toBe(1);
        expect(lighting.directionalIntensities[0]).toBe(4);
    });

    it('uses camera influence when choosing modern local and point-light selections', () => {
        const world = createWorld();
        const collector = new SceneLightingCollector(1);

        const farPointEntity = new Entity(world);
        farPointEntity.addComponent(PointLight, {
            color: [1, 0, 0],
            intensity: 8,
            range: 5,
        });
        farPointEntity.requireComponent(Transform).position = new Vec3(20, 0, 0);

        const nearPointEntity = new Entity(world);
        nearPointEntity.addComponent(PointLight, {
            color: [0, 1, 0],
            intensity: 2,
            range: 8,
        });
        nearPointEntity.requireComponent(Transform).position = new Vec3(1, 0, 0);

        const lighting = collector.collect(world.getAllEntities(), Vec3.ZERO, Vec3.ZERO, Vec3.ZERO, Vec3.ZERO);

        expect(lighting.stats.selectedLocalLightCount).toBe(1);
        expect(lighting.stats.selectedPointCount).toBe(1);
        expect([...lighting.localLightPositions.slice(0, 3)]).toEqual([1, 0, 0]);
        expect([...lighting.pointPositions.slice(0, 3)]).toEqual([1, 0, 0]);
        expect(lighting.pointColors[0]).toBe(0);
        expect(lighting.pointColors[1]).toBe(1);
    });

    it('keeps cosine spot cones and removes stale lights when components disable', () => {
        const world = createWorld();
        const collector = new SceneLightingCollector(2);

        const spotEntity = new Entity(world);
        const spotLight = spotEntity.addComponent(SpotLight, {
            color: [0.25, 0.5, 1],
            intensity: 6,
            range: 12,
            innerConeAngle: 0.2,
            outerConeAngle: 0.6,
        });
        spotEntity.requireComponent(Transform).position = new Vec3(4, 0, 0);

        const first = collector.collect(world.getAllEntities(), Vec3.ZERO);

        expect(first.stats.selectedLocalLightCount).toBe(1);
        expect(first.stats.selectedSpotCount).toBe(1);
        expect(first.localLightInnerConeCosines[0]).toBeCloseTo(Math.cos(0.2));
        expect(first.localLightOuterConeCosines[0]).toBeCloseTo(Math.cos(0.6));
        expect(first.spotInnerConeCosines[0]).toBeCloseTo(Math.cos(0.2));
        expect(first.spotOuterConeCosines[0]).toBeCloseTo(Math.cos(0.6));

        spotLight.enabled = false;

        const second = collector.collect(world.getAllEntities(), Vec3.ZERO);

        expect(second.stats.totalSpotCount).toBe(0);
        expect(second.stats.selectedLocalLightCount).toBe(0);
        expect(second.stats.selectedSpotCount).toBe(0);
        expect(second.spotIntensities[0]).toBe(0);
        expect(second.spotOuterConeCosines[0]).toBe(0);
    });
});