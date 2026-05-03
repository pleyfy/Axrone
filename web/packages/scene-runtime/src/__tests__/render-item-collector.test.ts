import { describe, expect, it } from 'vitest';
import { Vec3 } from '@axrone/numeric';
import type { Actor } from '@axrone/ecs-runtime';
import { Transform } from '@axrone/ecs-runtime';
import { MeshRenderer } from '../components/mesh-renderer';
import { SceneRenderItemCollector } from '../render-item-collector';

const createMockActor = (transform: Transform, renderer: MeshRenderer): Actor =>
	({
		active: true,
		getComponent(componentType: unknown) {
			if (componentType === Transform) {
				return transform;
			}
			if (componentType === MeshRenderer) {
				return renderer;
			}
			return undefined;
		},
	} as unknown as Actor);

describe('SceneRenderItemCollector', () => {
	it('draws blended renderers back-to-front after opaque renderers at the same render order', () => {
		const opaqueTransform = new Transform();
		opaqueTransform.position = new Vec3(0, 0, 1);
		const opaqueRenderer = new MeshRenderer({
			materialId: 'opaque',
			renderOrder: 0,
			passId: 'main',
		});

		const farBlendTransform = new Transform();
		farBlendTransform.position = new Vec3(0, 0, 8);
		const farBlendRenderer = new MeshRenderer({
			materialId: 'blend-far',
			renderOrder: 0,
			passId: 'main',
		});

		const nearBlendTransform = new Transform();
		nearBlendTransform.position = new Vec3(0, 0, 2);
		const nearBlendRenderer = new MeshRenderer({
			materialId: 'blend-near',
			renderOrder: 0,
			passId: 'main',
		});

		const collector = new SceneRenderItemCollector();
		const renderItems = collector.collect(
			[
				createMockActor(nearBlendTransform, nearBlendRenderer),
				createMockActor(opaqueTransform, opaqueRenderer),
				createMockActor(farBlendTransform, farBlendRenderer),
			],
			'main',
			{
				cameraPosition: new Vec3(0, 0, 0),
				isBlended: (renderer) => renderer.materialId?.startsWith('blend') ?? false,
			}
		);

		expect(renderItems.map((item) => item.renderer.materialId)).toEqual([
			'opaque',
			'blend-far',
			'blend-near',
		]);
	});
});