import { Vec3 } from '@axrone/numeric';
import { describe, expect, it } from 'vitest';
import { Transform } from '@axrone/ecs-runtime';
import { Entity } from '@axrone/ecs-runtime';
import { World } from '@axrone/ecs-runtime';
import { createSceneRegistry } from '@axrone/scene-3d';
import { DirectionalLight } from '@axrone/scene-3d';
import { PointLight } from '@axrone/scene-3d';
import { SpotLight } from '@axrone/scene-3d';
import { SceneLightingCollector } from '@axrone/scene-3d';

describe('SceneLightingCollector', () => {
    it('collects stable lighting buffers without per-frame reallocation', () => {
        const world = new World(createSceneRegistry());
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

        const first = collector.collect(world.getAllEntities(), new Vec3(0.1, 0.2, 0.3));
        const second = collector.collect(world.getAllEntities(), new Vec3(0.1, 0.2, 0.3));

        expect(second).toBe(first);
        expect(second.localLightPositions).toBe(first.localLightPositions);
        expect(second.localLightKinds).toBe(first.localLightKinds);
        expect(second.environment.ambient.x).toBeCloseTo(0.1);
        expect(second.environment.ambient.y).toBeCloseTo(0.2);
        expect(second.environment.ambient.z).toBeCloseTo(0.3);
        expect(second.stats.selectedPointCount).toBe(1);
        expect(second.stats.selectedSpotCount).toBe(1);
        expect(second.stats.selectedLocalLightCount).toBe(2);
        expect([...second.localLightKinds.slice(0, 2)]).toEqual([2, 1]);
        expect([...second.localLightPositions.slice(0, 6)]).toEqual([-1, 5, 2, 1, 2, 3]);
        expect(second.pointRanges[0]).toBe(9);
        expect(second.spotOuterConeCosines[0]).toBeCloseTo(Math.cos(0.5));
    });

    it('prefers primary directional lights over fallback directional lights', () => {
        const world = new World(createSceneRegistry());
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
});
