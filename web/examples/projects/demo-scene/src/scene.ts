import { createTorusKnot } from '@axrone/geometry';
import { Transform } from '@axrone/ecs-runtime';
import { MeshRenderer, OrbitCameraController } from '@axrone/scene-3d';
import {
	attachOrbitCameraInput,
	createAxesOverlay,
	createGridOverlay,
	createMeshBuilder,
	createPlaygroundHandle,
	createSceneStage,
	registerPlaygroundShaders,
} from '@axrone/playground';
import { Quat, Vec3 } from '@axrone/numeric';
import type { PlaygroundSceneHandle } from '../../shared/playground-types';
import {
	DEMO_AMBIENT,
	DEMO_BACKGROUND,
	DEMO_CLEAR_COLOR,
	DEMO_COLORS,
	DEMO_FILL_LIGHT_COLOR,
	DEMO_FILL_LIGHT_DIRECTION,
	DEMO_GRID_COLOR,
	DEMO_GRID_MAJOR,
	DEMO_KEY_LIGHT_COLOR,
	DEMO_KEY_LIGHT_DIRECTION,
	DEMO_LINE_COLOR,
} from '../assets/palette';

export const createDemoScene = (container: HTMLElement): PlaygroundSceneHandle => {
	const stage = createSceneStage(container, {
		clearColor: DEMO_CLEAR_COLOR,
		ambientLight: DEMO_AMBIENT,
	});
	const { scene } = stage;
	const shaders = registerPlaygroundShaders(scene, 'playground/demo');
	const meshBuilder = createMeshBuilder();
	scene.createBoxMesh('playground/demo/box', 1.4, 1.4, 1.4);
	scene.createSphereMesh('playground/demo/sphere', 0.8, 32);
	scene.createPlaneMesh('playground/demo/floor', 30, 30);

	scene.registerMesh(
		meshBuilder.createDefinition(
			'playground/demo/knot',
			createTorusKnot({
				radius: 0.5,
				tube: 0.18,
				radialSegments: 32,
				tubularSegments: 128,
			})
		),
	);

	const lightingUniforms = {
		u_AmbientColor: DEMO_AMBIENT,
		u_KeyLightDirection: DEMO_KEY_LIGHT_DIRECTION,
		u_KeyLightColor: DEMO_KEY_LIGHT_COLOR,
		u_FillLightDirection: DEMO_FILL_LIGHT_DIRECTION,
		u_FillLightColor: DEMO_FILL_LIGHT_COLOR,
	} as const;

	const registerLitMaterial = (
		id: string,
		color: readonly [number, number, number, number],
		shininess: number,
		polygonMode: 'fill' | 'line',
	) => {
		scene.createMaterial({
			id,
			shaderId: shaders.lit,
			uniforms: {
				u_Color: color,
				u_Shininess: shininess,
				...lightingUniforms,
			},
			rasterizerState: polygonMode === 'line' ? { polygonMode: 'line', lineWidth: 1 } : undefined,
		});
	};

	registerLitMaterial('playground/demo/box-fill', DEMO_COLORS.box, 14, 'fill');
	registerLitMaterial('playground/demo/box-wire', DEMO_LINE_COLOR, 8, 'line');
	registerLitMaterial('playground/demo/sphere-fill', DEMO_COLORS.sphere, 36, 'fill');
	registerLitMaterial('playground/demo/sphere-wire', DEMO_LINE_COLOR, 10, 'line');
	registerLitMaterial('playground/demo/knot-fill', DEMO_COLORS.knot, 18, 'fill');
	registerLitMaterial('playground/demo/knot-wire', DEMO_LINE_COLOR, 10, 'line');
	registerLitMaterial('playground/demo/floor-fill', DEMO_COLORS.floor, 5, 'fill');
	registerLitMaterial('playground/demo/floor-wire', DEMO_LINE_COLOR, 4, 'line');

	const camera = scene.createCameraActor({ name: 'DemoCamera' }, { primary: true, fieldOfView: 60 });
	const orbit = camera.addComponent(OrbitCameraController, {
		target: [0, 0.5, 0],
		distance: 9.3,
		minDistance: 4,
		maxDistance: 18,
		azimuth: 0.62,
		elevation: 0.39,
	});
	const detachInput = attachOrbitCameraInput(container, orbit, {
		minElevation: 0.08,
		maxElevation: 1.25,
	});

	const grid = createGridOverlay(scene, shaders.grid, {
		prefix: 'playground/demo',
		size: 30,
		scale: 1,
		y: 0.01,
		color: DEMO_GRID_MAJOR,
		gridColor: DEMO_GRID_COLOR,
		backgroundColor: DEMO_BACKGROUND,
		backgroundOpacity: 0,
	});
	const axes = createAxesOverlay(scene, shaders.solid, { prefix: 'playground/demo', length: 5 });
	axes.setVisible(false);

	const boxActor = scene.createRenderableActor(
		{ name: 'DemoBox' },
		{ meshId: 'playground/demo/box', materialId: 'playground/demo/box-fill' },
	);
	const sphereActor = scene.createRenderableActor(
		{ name: 'DemoSphere' },
		{ meshId: 'playground/demo/sphere', materialId: 'playground/demo/sphere-fill' },
	);
	const knotActor = scene.createRenderableActor(
		{ name: 'DemoKnot' },
		{ meshId: 'playground/demo/knot', materialId: 'playground/demo/knot-fill' },
	);
	const floorActor = scene.createRenderableActor(
		{ name: 'DemoFloor' },
		{ meshId: 'playground/demo/floor', materialId: 'playground/demo/floor-fill' },
	);

	const boxTransform = boxActor.requireComponent(Transform);
	const sphereTransform = sphereActor.requireComponent(Transform);
	const knotTransform = knotActor.requireComponent(Transform);
	const floorTransform = floorActor.requireComponent(Transform);

	boxTransform.position = new Vec3(-2, 0.9, 0);
	sphereTransform.position = new Vec3(0, 1, 0);
	knotTransform.position = new Vec3(2, 1.2, 0);
	floorTransform.position = new Vec3(0, 0, 0);

	const boxRenderer = boxActor.getComponent(MeshRenderer);
	const sphereRenderer = sphereActor.getComponent(MeshRenderer);
	const knotRenderer = knotActor.getComponent(MeshRenderer);
	const floorRenderer = floorActor.getComponent(MeshRenderer);
	if (!boxRenderer || !sphereRenderer || !knotRenderer || !floorRenderer) {
		throw new Error('Demo scene renderers were not created correctly.');
	}

	const materialPairs = [
		{ renderer: boxRenderer, fill: 'playground/demo/box-fill', wire: 'playground/demo/box-wire' },
		{ renderer: sphereRenderer, fill: 'playground/demo/sphere-fill', wire: 'playground/demo/sphere-wire' },
		{ renderer: knotRenderer, fill: 'playground/demo/knot-fill', wire: 'playground/demo/knot-wire' },
		{ renderer: floorRenderer, fill: 'playground/demo/floor-fill', wire: 'playground/demo/floor-wire' },
	] as const;

	let playing = true;
	let frameHandle = 0;
	let time = 0;
	const loop = (now: number) => {
		if (playing) {
			time += 0.01;
			boxTransform.rotation = Quat.fromEuler(time * 0.8, time * 1.2, 0);
			boxTransform.position = new Vec3(-2, 0.9 + Math.sin(time * 2) * 0.15, 0);
			sphereTransform.position = new Vec3(0, 1 + Math.sin(time * 2.5 + 1) * 0.1, 0);
			knotTransform.rotation = Quat.fromEuler(time * 0.6, time, 0);
			knotTransform.position = new Vec3(2, 1.2 + Math.sin(time * 1.8 + 2) * 0.12, 0);
		}

		frameHandle = globalThis.requestAnimationFrame(loop);
	};
	frameHandle = globalThis.requestAnimationFrame(loop);

	const baseHandle = createPlaygroundHandle({
		container,
		scene,
		disposeScene: false,
		orbit,
		overlays: { grid, axes },
		disposeExtras: [detachInput, () => stage.dispose()],
		setWireframe(enabled: boolean) {
			for (const pair of materialPairs) {
				pair.renderer.materialId = enabled ? pair.wire : pair.fill;
			}
		},
		stats: () => ({
			objectCount: 4,
			summary: '4 objects',
		}),
	});

	return {
		...baseHandle,
		setPlaying(nextPlaying: boolean) {
			playing = nextPlaying;
			baseHandle.setPlaying?.(nextPlaying);
		},
		async dispose() {
			playing = false;
			if (frameHandle !== 0) {
				globalThis.cancelAnimationFrame(frameHandle);
			}
			await baseHandle.dispose();
		},
	};
};