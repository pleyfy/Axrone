import { createCylinder } from '@axrone/geometry';
import { Transform } from '@axrone/ecs-runtime';
import { MeshRenderer, OrbitCameraController } from '@axrone/scene-3d';
import {
	attachOrbitCameraInput,
	createAxesOverlay,
	createContactShadow,
	createGridOverlay,
	createMeshBuilder,
	createPlaygroundHandle,
	createSceneStage,
	registerPlaygroundShaders,
	registerStudioLitShader,
} from '@axrone/playground';
import { Vec3 } from '@axrone/numeric';
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
	DEMO_RIM,
} from '../assets/palette';

const DEMO_PLATFORM_TOP = 0.3;
const DEMO_OBJECT_COUNT = 8;

export const createDemoScene = (container: HTMLElement): PlaygroundSceneHandle => {
	const stage = createSceneStage(container, {
		clearColor: DEMO_CLEAR_COLOR,
		ambientLight: DEMO_AMBIENT,
		background:
			'radial-gradient(105% 85% at 68% 16%, rgba(255, 216, 170, 0.62), rgba(255, 216, 170, 0) 58%), linear-gradient(180deg, #f4f0ea 0%, #e9e2d9 54%, #cfc4b7 100%)',
	});
	const { scene } = stage;
	const shaders = registerPlaygroundShaders(scene, 'playground/demo');
	const studioShader = registerStudioLitShader(scene, 'playground/demo/studio');
	const meshBuilder = createMeshBuilder();

	scene.createBoxMesh('playground/demo/box', 1.5, 1.5, 1.5);
	scene.createSphereMesh('playground/demo/sphere', 0.88, 40);
	scene.createBoxMesh('playground/demo/platform', 8.2, 0.3, 3.2);
	scene.registerMesh(
		meshBuilder.createDefinition(
			'playground/demo/cylinder',
			createCylinder({
				radiusTop: 0.42,
				radiusBottom: 0.55,
				height: 1.5,
				radialSegments: 64,
			}),
		),
	);

	const lightingUniforms = {
		u_AmbientColor: DEMO_AMBIENT,
		u_KeyLightDirection: DEMO_KEY_LIGHT_DIRECTION,
		u_KeyLightColor: DEMO_KEY_LIGHT_COLOR,
		u_FillLightDirection: DEMO_FILL_LIGHT_DIRECTION,
		u_FillLightColor: DEMO_FILL_LIGHT_COLOR,
	} as const;

	const registerStudioMaterial = (
		id: string,
		color: readonly [number, number, number, number],
		shininess: number,
		rimColor: readonly [number, number, number],
		rimStrength: number,
	) => {
		scene.createMaterial({
			id,
			shaderId: studioShader,
			uniforms: {
				u_Color: color,
				u_Shininess: shininess,
				u_RimColor: rimColor,
				u_RimStrength: rimStrength,
				...lightingUniforms,
			},
		});
	};

	const registerWireMaterial = (id: string) => {
		scene.createMaterial({
			id,
			shaderId: shaders.solid,
			uniforms: { u_Color: DEMO_LINE_COLOR },
			rasterizerState: { polygonMode: 'line', lineWidth: 1 },
		});
	};

	registerStudioMaterial('playground/demo/cube-fill', DEMO_COLORS.cube, 8, DEMO_RIM.cube, 0.18);
	registerStudioMaterial('playground/demo/sphere-fill', DEMO_COLORS.sphere, 24, DEMO_RIM.sphere, 0.22);
	registerStudioMaterial('playground/demo/cylinder-fill', DEMO_COLORS.cylinder, 14, DEMO_RIM.cylinder, 0.18);
	registerStudioMaterial('playground/demo/platform-fill', DEMO_COLORS.platform, 4, DEMO_RIM.platform, 0.1);
	for (const id of ['cube', 'sphere', 'cylinder', 'platform']) {
		registerWireMaterial(`playground/demo/${id}-wire`);
	}

	const camera = scene.createCameraActor({ name: 'StudioCamera' }, { primary: true, fieldOfView: 48 });
	const orbit = camera.addComponent(OrbitCameraController, {
		target: [0, 0.95, 0],
		distance: 9.8,
		minDistance: 4.5,
		maxDistance: 18,
		azimuth: 0.62,
		elevation: 0.32,
	});
	const detachInput = attachOrbitCameraInput(container, orbit, {
		minElevation: 0.08,
		maxElevation: 1.2,
	});

	const grid = createGridOverlay(scene, shaders.grid, {
		prefix: 'playground/demo',
		size: 40,
		scale: 1,
		y: 0.012,
		color: DEMO_GRID_MAJOR,
		gridColor: DEMO_GRID_COLOR,
		backgroundColor: DEMO_BACKGROUND,
		backgroundOpacity: 0,
	});
	const axes = createAxesOverlay(scene, shaders.solid, { prefix: 'playground/demo', length: 5 });
	axes.setVisible(false);

	const platformActor = scene.createRenderableActor(
		{ name: 'StudioPlatform' },
		{ meshId: 'playground/demo/platform', materialId: 'playground/demo/platform-fill' },
	);
	const cubeActor = scene.createRenderableActor(
		{ name: 'ClayCube' },
		{ meshId: 'playground/demo/box', materialId: 'playground/demo/cube-fill' },
	);
	const sphereActor = scene.createRenderableActor(
		{ name: 'GlazedSphere' },
		{ meshId: 'playground/demo/sphere', materialId: 'playground/demo/sphere-fill' },
	);
	const cylinderActor = scene.createRenderableActor(
		{ name: 'BrassCylinder' },
		{ meshId: 'playground/demo/cylinder', materialId: 'playground/demo/cylinder-fill' },
	);

	const platformTransform = platformActor.requireComponent(Transform);
	const cubeTransform = cubeActor.requireComponent(Transform);
	const sphereTransform = sphereActor.requireComponent(Transform);
	const cylinderTransform = cylinderActor.requireComponent(Transform);

	platformTransform.position = new Vec3(0, DEMO_PLATFORM_TOP * 0.5, 0);
	cubeTransform.position = new Vec3(-2.15, DEMO_PLATFORM_TOP + 0.75, 0.15);
	sphereTransform.position = new Vec3(0, DEMO_PLATFORM_TOP + 0.88, -0.1);
	cylinderTransform.position = new Vec3(2.15, DEMO_PLATFORM_TOP + 0.75, 0.1);

	createContactShadow(scene, {
		prefix: 'playground/demo/platform-shadow',
		size: 10.6,
		y: -0.02,
		color: [0.17, 0.11, 0.07, 0.2],
	});
	const cubeShadow = createContactShadow(scene, {
		prefix: 'playground/demo/cube-shadow',
		size: 2.1,
		y: DEMO_PLATFORM_TOP + 0.008,
		color: [0.16, 0.1, 0.06, 0.3],
	});
	const sphereShadow = createContactShadow(scene, {
		prefix: 'playground/demo/sphere-shadow',
		size: 1.9,
		y: DEMO_PLATFORM_TOP + 0.009,
		color: [0.16, 0.1, 0.06, 0.28],
	});
	const cylinderShadow = createContactShadow(scene, {
		prefix: 'playground/demo/cylinder-shadow',
		size: 1.7,
		y: DEMO_PLATFORM_TOP + 0.01,
		color: [0.16, 0.1, 0.06, 0.26],
	});
	cubeShadow.transform.position.x = cubeTransform.position.x;
	cubeShadow.transform.position.z = cubeTransform.position.z;
	sphereShadow.transform.position.x = sphereTransform.position.x;
	sphereShadow.transform.position.z = sphereTransform.position.z;
	cylinderShadow.transform.position.x = cylinderTransform.position.x;
	cylinderShadow.transform.position.z = cylinderTransform.position.z;

	const boxRenderer = cubeActor.getComponent(MeshRenderer);
	const sphereRenderer = sphereActor.getComponent(MeshRenderer);
	const cylinderRenderer = cylinderActor.getComponent(MeshRenderer);
	const platformRenderer = platformActor.getComponent(MeshRenderer);
	if (!boxRenderer || !sphereRenderer || !cylinderRenderer || !platformRenderer) {
		throw new Error('Studio scene renderers were not created correctly.');
	}

	const materialPairs = [
		{ renderer: boxRenderer, fill: 'playground/demo/cube-fill', wire: 'playground/demo/cube-wire' },
		{ renderer: sphereRenderer, fill: 'playground/demo/sphere-fill', wire: 'playground/demo/sphere-wire' },
		{ renderer: cylinderRenderer, fill: 'playground/demo/cylinder-fill', wire: 'playground/demo/cylinder-wire' },
		{ renderer: platformRenderer, fill: 'playground/demo/platform-fill', wire: 'playground/demo/platform-wire' },
	] as const;

	return createPlaygroundHandle({
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
			objectCount: DEMO_OBJECT_COUNT,
			summary: 'Warm studio study',
		}),
	});
};
