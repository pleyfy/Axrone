import {
	Transform,
	World,
	getComponentPropertyMetadata,
} from '@axrone/ecs-runtime';
import { Vec3 } from '@axrone/numeric';
import { describe, expect, it } from 'vitest';
import { SceneComponentCatalog } from '../component-catalog';
import { createSceneRegistry } from '../scene-registry';
import { encodeSceneValue } from '../serialization';
import { SceneEntityRuntime } from '../scene-entity-runtime';
import type { ScenePrefabDefinition } from '../types';
import { HydratedFollower } from './fixtures/HydratedFollower';
import { HydrationMarker } from './fixtures/HydrationMarker';
import { ComponentRefFollower } from './fixtures/ComponentRefFollower';

const createPrefabComponent = (type: string, data: unknown) => ({
	type,
	data: encodeSceneValue(data),
});

const createPrefabHarness = () => {
	const registry = createSceneRegistry({
		registry: {
			HydratedFollower,
			HydrationMarker,
			ComponentRefFollower,
		},
	});
	const world = new World(registry);
	const entities = new SceneEntityRuntime({
		world,
		componentCatalog: new SceneComponentCatalog(registry),
	});

	entities.registerComponent(HydratedFollower);
	entities.registerComponent(HydrationMarker);
	entities.registerComponent(ComponentRefFollower);

	return {
		entities,
		world,
	};
};

const createHydrationPrefab = (): ScenePrefabDefinition => ({
	id: 'prefab/property-hydration',
	entities: [
		{
			nodeId: 'node/source',
			parentNodeId: null,
			name: 'Source',
			layer: 0,
			tag: 'default',
			active: true,
			persistent: false,
			pooled: false,
			components: [
				createPrefabComponent('Transform', {
					position: [0, 0, 0],
					rotation: [0, 0, 0, 1],
					scale: [1, 1, 1],
				}),
				createPrefabComponent('HydratedFollower', {
					scriptPath: 'Scripts/hydrated-follower.ts',
					className: 'HydratedFollower',
					scriptName: 'HydratedFollower',
					executeInEditMode: false,
					propertyValues: {
						targetEntity: {
							kind: 'entity',
							target: 'node/target',
						},
						targetTransform: {
							kind: 'entity',
							target: 'node/target',
						},
						offset: {
							x: 1,
							y: 2,
							z: 3,
						},
						speed: '4.5',
						enabledFlag: true,
						tintHex: '#ff00aa',
					},
				}),
			],
		},
		{
			nodeId: 'node/target',
			parentNodeId: null,
			name: 'Target',
			layer: 0,
			tag: 'default',
			active: true,
			persistent: false,
			pooled: false,
			components: [
				createPrefabComponent('Transform', {
					position: [5, 1, 2],
					rotation: [0, 0, 0, 1],
					scale: [1, 1, 1],
				}),
			],
		},
	],
});

const createComponentRefPrefab = (): ScenePrefabDefinition => ({
	id: 'prefab/component-reference',
	entities: [
		{
			nodeId: 'node/follower',
			parentNodeId: null,
			name: 'Follower',
			layer: 0,
			tag: 'default',
			active: true,
			persistent: false,
			pooled: false,
			components: [
				createPrefabComponent('Transform', {
					position: [0, 0, 0],
					rotation: [0, 0, 0, 1],
					scale: [1, 1, 1],
				}),
				createPrefabComponent('ComponentRefFollower', {
					scriptPath: 'Scripts/component-ref-follower.ts',
					className: 'ComponentRefFollower',
					scriptName: 'ComponentRefFollower',
					executeInEditMode: false,
					propertyValues: {
						marker: {
							kind: 'entity',
							target: 'node/marker-owner',
						},
					},
				}),
			],
		},
		{
			nodeId: 'node/marker-owner',
			parentNodeId: null,
			name: 'MarkerOwner',
			layer: 0,
			tag: 'default',
			active: true,
			persistent: false,
			pooled: false,
			components: [
				createPrefabComponent('Transform', {
					position: [0, 0, 0],
					rotation: [0, 0, 0, 1],
					scale: [1, 1, 1],
				}),
				createPrefabComponent('HydrationMarker', {}),
			],
		},
	],
});

describe('ScenePrefabRuntime property hydration', () => {
	it('hydrates editor propertyValues into live script instances', () => {
		expect(getComponentPropertyMetadata(HydratedFollower).map((entry) => entry.propertyKey)).toEqual([
			'targetEntity',
			'targetTransform',
			'offset',
			'speed',
			'enabledFlag',
			'tintHex',
		]);

		const harness = createPrefabHarness();
		const entities = harness.entities.instantiatePrefab(createHydrationPrefab());
		const sourceEntity = entities.find((entity) => entity.name === 'Source');
		const targetEntity = entities.find((entity) => entity.name === 'Target');
		const component = sourceEntity?.getComponent(HydratedFollower);

		expect(sourceEntity).toBeDefined();
		expect(targetEntity).toBeDefined();
		expect(component).toBeDefined();
		expect(component?.offset).toBeInstanceOf(Vec3);
		expect([component?.offset.x, component?.offset.y, component?.offset.z]).toEqual([1, 2, 3]);
		expect(component?.speed).toBe(4.5);
		expect(component?.enabledFlag).toBe(true);
		expect(component?.tintHex).toBe('#ff00aa');
		expect(component?.targetEntity).toBe(targetEntity);
		expect(component?.targetTransform).toBe(targetEntity?.getComponent(Transform));
	});

	it('resolves a component-typed property to the target component instance', () => {
		const harness = createPrefabHarness();
		const entities = harness.entities.instantiatePrefab(createComponentRefPrefab());
		const followerEntity = entities.find((entity) => entity.name === 'Follower');
		const markerOwnerEntity = entities.find((entity) => entity.name === 'MarkerOwner');
		const follower = followerEntity?.getComponent(ComponentRefFollower);

		expect(follower).toBeDefined();
		expect(markerOwnerEntity).toBeDefined();
		expect(follower?.marker).toBe(markerOwnerEntity?.getComponent(HydrationMarker));
	});
});