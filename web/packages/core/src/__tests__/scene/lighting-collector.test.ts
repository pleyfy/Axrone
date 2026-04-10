import { Vec3 } from '@axrone/numeric';
import { describe, expect, it } from 'vitest';
import { Transform } from '@axrone/ecs';
import { Actor } from '@axrone/ecs';
import { World } from '@axrone/ecs';
import { createSceneRegistry } from '@axrone/scene-3d';
import { DirectionalLight } from '@axrone/scene-3d';
import { PointLight } from '@axrone/scene-3d';
import { SpotLight } from '@axrone/scene-3d';
import { SceneLightingCollector } from '@axrone/scene-3d';

describe('SceneLightingCollector', () => {
    it('collects stable lighting buffers without per-frame reallocation', () => {
        const world = new World(createSceneRegistry());
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

        const first = collector.collect(world.getAllActors(), new Vec3(0.1, 0.2, 0.3));
        const second = collector.collect(world.getAllActors(), new Vec3(0.1, 0.2, 0.3));

        expect(second).toBe(first);
        expect(second.localLightPositions).toBe(first.localLightPositions);
        expect(second.localLightTypes).toBe(first.localLightTypes);
        expect(second.ambient.x).toBeCloseTo(0.15);
        expect(second.ambient.y).toBeCloseTo(0.24);
        expect(second.ambient.z).toBeCloseTo(0.33);
        expect(second.pointCount).toBe(1);
        expect(second.spotCount).toBe(1);
        expect(second.localLightCount).toBe(2);
        expect([...second.localLightTypes.slice(0, 2)]).toEqual([0, 1]);
        expect([...second.localLightPositions.slice(0, 6)]).toEqual([1, 2, 3, -1, 5, 2]);
        expect(second.pointLightRange).toBe(9);
        expect(second.spotLightOuterCone).toBe(0.5);
    });

    it('prefers primary directional lights over fallback directional lights', () => {
        const world = new World(createSceneRegistry());
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
});
